//! Leaf Launcher : un launcher Minecraft: Java Edition en Rust (Tauri), bâti sur la base du
//! launcher Horizon. Ce fichier tient les commandes que l'interface appelle, la préparation d'une
//! instance (version, loader, fichiers, Java) et le jeu en cours (logs, temps de jeu).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod config;
mod discord;
mod files;
mod forge;
mod horizon;
mod launch;
mod loaders;
mod media;
mod modrinth;
mod mojang;
mod net;
mod versions;

use config::{Instance, Settings};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

const LOG_LINES: usize = 5000;

#[derive(Default)]
struct Shared {
    /// Arrête la préparation en cours.
    cancel: AtomicBool,
    /// L'instance en préparation.
    preparing: Mutex<Option<String>>,
    /// Les jeux lancés : instance → pid.
    running: Mutex<HashMap<String, u32>>,
    logs: Mutex<HashMap<String, VecDeque<String>>>,
    login_cancel: AtomicBool,
}

type State<'a> = tauri::State<'a, Arc<Shared>>;

/// Lance `f` hors du fil de l'interface.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn total_memory_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() / (1024 * 1024)
}

#[tauri::command]
fn bootstrap(state: State) -> Value {
    let accounts: Vec<_> = auth::accounts().iter().map(auth::Account::public).collect();
    let running: Vec<String> = state.running.lock().unwrap().keys().cloned().collect();
    json!({
        "settings": config::settings(),
        "accounts": accounts,
        "instances": config::instances(),
        "running": running,
        "preparing": state.preparing.lock().unwrap().clone(),
        "installed": versions::installed(&config::minecraft_dir()),
        "data_dir": config::data_dir(),
        "total_memory_mb": total_memory_mb(),
        "version": env!("CARGO_PKG_VERSION"),
        "horizon": horizon::status(),
        "msa_builtin": auth::built_in(),
    })
}

#[tauri::command]
fn save_settings(state: State, settings: Settings) -> Result<(), String> {
    config::save("settings.json", &settings)?;
    discord::configure(discord_config(&settings));
    if state.running.lock().unwrap().is_empty() {
        idle_presence(&settings);
    }
    Ok(())
}

fn discord_config(s: &Settings) -> discord::Config {
    discord::Config {
        enabled: s.discord_rpc,
        app_id: s.discord_app_id.clone(),
        image: s.discord_image.clone(),
        server: s.discord_server.clone(),
        button_label: s.discord_button_label.clone(),
        button_url: s.discord_button_url.clone(),
        button2_label: s.discord_button2_label.clone(),
        button2_url: s.discord_button2_url.clone(),
    }
}

static LAUNCHER_START: std::sync::OnceLock<u64> = std::sync::OnceLock::new();

fn idle_presence(s: &Settings) {
    discord::show(discord::Presence {
        details: if s.discord_idle.trim().is_empty() { "Dans le launcher".into() } else { s.discord_idle.clone() },
        state: server_line(s),
        start: *LAUNCHER_START.get_or_init(config::now),
        small_text: String::new(),
    });
}

fn server_line(s: &Settings) -> String {
    if s.discord_server.trim().is_empty() {
        "Leaf Launcher".into()
    } else {
        format!("🌿 {}", s.discord_server.trim())
    }
}

fn loader_name(loader: &str) -> &'static str {
    match loader {
        "fabric" => "Fabric",
        "quilt" => "Quilt",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        _ => "Vanilla",
    }
}

#[tauri::command]
async fn list_versions(refresh: bool) -> Result<versions::Manifest, String> {
    blocking(move || versions::manifest(!refresh)).await
}

#[tauri::command]
async fn loader_versions(kind: String, minecraft: String) -> Result<Vec<loaders::Listed>, String> {
    blocking(move || {
        if forge::is_forge_like(&kind) {
            forge::versions(&kind, &minecraft)
        } else {
            loaders::versions(loaders::Kind::parse(&kind)?, &minecraft, &net::get)
        }
    })
    .await
}

fn check_instance(instance: &Instance) -> Result<(), String> {
    if instance.name.trim().is_empty() {
        return Err("Donne un nom à l'instance.".into());
    }
    if instance.version.trim().is_empty() {
        return Err("Choisis une version de Minecraft.".into());
    }
    if !matches!(instance.loader.as_str(), "vanilla" | "fabric" | "quilt" | "forge" | "neoforge") {
        return Err("Loader inconnu.".into());
    }
    if instance.engine == "horizon" && instance.version != horizon::MINECRAFT {
        return Err(format!("Horizon (Rust) ne fait tourner que Minecraft {}.", horizon::MINECRAFT));
    }
    files::relative(&instance.version).map(|_| ())
}

#[tauri::command]
fn create_instance(mut instance: Instance) -> Result<Instance, String> {
    if instance.loader.is_empty() {
        instance.loader = "vanilla".into();
    }
    if instance.engine.is_empty() {
        instance.engine = "java".into();
    }
    check_instance(&instance)?;
    instance.id = config::new_id();
    instance.created = config::now();
    instance.name = instance.name.trim().to_string();
    let mut list = config::instances();
    list.push(instance.clone());
    config::save_instances(&list)?;
    std::fs::create_dir_all(config::instance_dir(&instance.id)).map_err(|e| e.to_string())?;
    Ok(instance)
}

#[tauri::command]
fn update_instance(instance: Instance) -> Result<(), String> {
    check_instance(&instance)?;
    let mut list = config::instances();
    let slot = list
        .iter_mut()
        .find(|i| i.id == instance.id)
        .ok_or("Cette instance n'existe plus.")?;
    // Le temps de jeu et les dates restent ceux du launcher.
    let (created, last, playtime) = (slot.created, slot.last_played, slot.playtime);
    *slot = Instance { created, last_played: last, playtime, ..instance };
    config::save_instances(&list)
}

#[tauri::command]
fn duplicate_instance(id: String) -> Result<Instance, String> {
    let list = config::instances();
    let from = list.iter().find(|i| i.id == id).ok_or("Cette instance n'existe plus.")?;
    let copy = Instance {
        id: String::new(),
        name: format!("{} (copie)", from.name),
        last_played: 0,
        playtime: 0,
        favorite: false,
        ..from.clone()
    };
    let created = create_instance(copy)?;
    copy_dir(&config::instance_dir(&id), &config::instance_dir(&created.id))?;
    Ok(created)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).into_iter().flatten().flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_instance(state: State, id: String, remove_files: bool) -> Result<(), String> {
    if state.running.lock().unwrap().contains_key(&id) {
        return Err("Ferme le jeu avant de supprimer l'instance.".into());
    }
    let mut list = config::instances();
    list.retain(|i| i.id != id);
    config::save_instances(&list)?;
    if remove_files {
        let dir = config::instance_dir(&id);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("{} : {e}", dir.display()))?;
        }
    }
    Ok(())
}

/// Ce que contient le dossier d'une instance : mondes, mods, packs, captures.
#[tauri::command]
async fn instance_details(id: String) -> Result<Value, String> {
    blocking(move || {
        let dir = config::instance_dir(&id);
        let names = |sub: &str| -> Vec<String> {
            let mut list: Vec<String> = std::fs::read_dir(dir.join(sub))
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| !n.starts_with('.'))
                .collect();
            list.sort();
            list
        };
        Ok(json!({
            "worlds": names("saves"),
            "mods": names("mods"),
            "resourcepacks": names("resourcepacks"),
            "shaderpacks": names("shaderpacks"),
            "screenshots": names("screenshots").len(),
            "size": files::dir_size(&dir),
        }))
    })
    .await
}

#[derive(Serialize, Clone)]
struct Progress<'a> {
    id: &'a str,
    stage: &'a str,
    done: usize,
    total: usize,
}

/// Prépare l'instance puis lance le jeu, dans un fil à part ; l'interface suit par événements.
#[tauri::command]
fn launch(app: AppHandle, state: State, id: String, repair: bool) -> Result<(), String> {
    if state.running.lock().unwrap().contains_key(&id) {
        return Err("Cette instance est déjà en jeu.".into());
    }
    {
        let mut preparing = state.preparing.lock().unwrap();
        if preparing.is_some() {
            return Err("Une préparation est déjà en cours.".into());
        }
        *preparing = Some(id.clone());
    }
    state.cancel.store(false, Relaxed);
    let shared = Arc::clone(state.inner());
    std::thread::spawn(move || {
        let result = prepare_and_start(&app, &shared, &id, repair);
        *shared.preparing.lock().unwrap() = None;
        if let Err(e) = result {
            let _ = app.emit("launch-error", json!({ "id": id, "error": e }));
        }
    });
    Ok(())
}

fn push_log(app: &AppHandle, shared: &Shared, id: &str, line: String) {
    {
        let mut logs = shared.logs.lock().unwrap();
        let buf = logs.entry(id.to_string()).or_default();
        if buf.len() >= LOG_LINES {
            buf.pop_front();
        }
        buf.push_back(line.clone());
    }
    let _ = app.emit("game-log", json!({ "id": id, "line": line }));
}

fn prepare_and_start(app: &AppHandle, shared: &Arc<Shared>, id: &str, repair: bool) -> Result<(), String> {
    let settings = config::settings();
    let instance = config::instances()
        .into_iter()
        .find(|i| i.id == id)
        .ok_or("Cette instance n'existe plus.")?;
    let minecraft = config::minecraft_dir();
    let os = launch::os_name();
    shared.logs.lock().unwrap().remove(id);
    let report = |stage: &str, done: usize, total: usize| {
        let _ = app.emit("launch-progress", Progress { id, stage, done, total });
    };
    let log = |line: String| push_log(app, shared, id, format!("[Leaf] {line}"));
    let task = mojang::Task {
        cancel: &shared.cancel,
        jobs: settings.download_jobs.clamp(1, 64) as usize,
        verify: repair || settings.verify_on_launch,
        report: &report,
        log: &log,
    };
    let horizon_engine = instance.engine == "horizon";
    // Horizon ne démarre que pour un compte Microsoft qui possède le jeu (sa règle).
    if horizon_engine {
        let account = auth::active(&settings.active_account)?;
        if account.kind != "microsoft" {
            return Err("Horizon (Rust) demande un compte Microsoft qui possède Minecraft: Java Edition.                         Connecte-en un dans Comptes, ou repasse l'instance en Minecraft officiel."
                .into());
        }
    }
    // Horizon se prépare depuis les fichiers de 26.3 et le Java de Mojang : les mêmes que Vanilla.
    let java_instance = if horizon_engine {
        Instance { version: horizon::MINECRAFT.into(), loader: "vanilla".into(), ..instance.clone() }
    } else {
        instance.clone()
    };
    let (version, profile, java) = prepare(&java_instance, &settings, &minecraft, os, &task)?;
    if shared.cancel.load(Relaxed) {
        return Err(mojang::CANCELLED.into());
    }

    report("Compte", 0, 1);
    let player = auth::player(&settings.active_account)?;
    let (mut cmd, session) = if horizon_engine {
        let build = horizon::ensure_build(false, &task)?;
        let resources = horizon::prepare(&build, &minecraft, &java, &task)?;
        let game_dir = config::instance_dir(&instance.id);
        std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
        let (w, h) = if instance.width > 0 && instance.height > 0 {
            (instance.width, instance.height)
        } else {
            (settings.width.max(640), settings.height.max(360))
        };
        let server = Some(instance.server.trim()).filter(|s| !s.is_empty());
        let session = json!({
            "name": player.name, "uuid": player.uuid, "access_token": player.token,
            "user_type": "msa", "xuid": player.xuid,
        });
        (horizon::command(&build, &resources, &game_dir, (w, h), settings.fullscreen, server), Some(session.to_string()))
    } else {
        (command(&instance, &settings, &version, &profile, &java, &player)?, None)
    };
    report("Lancement", 1, 1);
    log(if horizon_engine {
        format!("Lancement de {} avec Horizon (Minecraft {} en Rust)", instance.name, horizon::MINECRAFT)
    } else {
        format!("Lancement de {} ({profile}), Java : {}", instance.name, java.display())
    });
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Le jeu n'a pas pu démarrer : {e}"))?;
    if let (Some(session), Some(mut stdin)) = (session, child.stdin.take()) {
        use std::io::Write;
        let _ = stdin.write_all(session.as_bytes());
    }
    discord::show(discord::Presence {
        details: format!("Joue à {}", instance.name),
        state: server_line(&settings),
        start: config::now(),
        small_text: if horizon_engine {
            format!("Horizon {} (Rust)", horizon::MINECRAFT)
        } else {
            format!("Minecraft {} · {}", instance.version, loader_name(&instance.loader))
        },
    });
    let pid = child.id();
    shared.running.lock().unwrap().insert(id.to_string(), pid);
    let started = config::now();
    update_stats(id, |i| i.last_played = started);
    let _ = app.emit("game-started", json!({ "id": id, "pid": pid }));

    if let Some(window) = app.get_webview_window("main") {
        match settings.after_launch.as_str() {
            "minimize" => {
                let _ = window.minimize();
            }
            "hide" => {
                let _ = window.hide();
            }
            "close" => app.exit(0),
            _ => {}
        }
    }

    let readers: Vec<_> = [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|stream| {
        let (app, shared, id) = (app.clone(), Arc::clone(shared), id.to_string());
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                push_log(&app, &shared, &id, line);
            }
        })
    })
    .collect();
    let (app, shared, id) = (app.clone(), Arc::clone(shared), id.to_string());
    let after = settings.after_launch.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        for reader in readers {
            let _ = reader.join();
        }
        shared.running.lock().unwrap().remove(&id);
        let played = config::now().saturating_sub(started);
        update_stats(&id, |i| i.playtime += played);
        let _ = app.emit("game-exit", json!({ "id": id, "code": code, "played": played }));
        if shared.running.lock().unwrap().is_empty() {
            idle_presence(&config::settings());
        }
        if matches!(after.as_str(), "minimize" | "hide") {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    });
    Ok(())
}

/// Tout ce qu'il faut pour jouer à l'instance : le fichier de version (le loader fusionné), les
/// fichiers du jeu, le loader et Java. Renvoie la version résolue, son id et le programme java.
fn prepare(
    instance: &Instance,
    settings: &Settings,
    minecraft: &Path,
    os: &str,
    task: &mojang::Task,
) -> Result<(Value, String, PathBuf), String> {
    let report = task.report;
    report("Version", 0, 1);
    let path = versions::version_json(&instance.version, minecraft)?;
    let vanilla = launch::read(&path)?;
    let marker = path.with_file_name(".leaf-complete");
    if !marker.is_file() || task.verify {
        mojang::download_game(&vanilla, minecraft, os, task)?;
        files::write_file(&marker, b"ok")?;
    }

    let mut profile = instance.version.clone();
    // Java d'abord : l'installateur de Forge en a besoin.
    let java = if settings.java_path.trim().is_empty() {
        let component = vanilla["javaVersion"]["component"].as_str().unwrap_or("jre-legacy");
        mojang::java_runtime(component, &config::runtime_dir(), task)?
    } else {
        PathBuf::from(settings.java_path.trim())
    };
    if forge::is_forge_like(&instance.loader) {
        report(forge::name(&instance.loader), 0, 1);
        let wanted = Some(instance.loader_version.as_str()).filter(|v| !v.is_empty());
        let version = forge::pick(&instance.loader, &instance.version, wanted)?;
        profile = forge::install(&instance.loader, &version, minecraft, &java, task.log)?;
    } else if instance.loader != "vanilla" {
        let kind = loaders::Kind::parse(&instance.loader)?;
        report(kind.name(), 0, 1);
        let wanted = Some(instance.loader_version.as_str()).filter(|v| !v.is_empty());
        let installed = wanted.map(|v| kind.profile_id(v, &instance.version)).filter(|p| {
            minecraft.join("versions").join(p).join(format!("{p}.json")).is_file()
        });
        profile = match installed {
            Some(p) if !task.verify => p,
            _ => {
                let loader = loaders::choose(kind.id(), &instance.version, wanted)?;
                loaders::install(&loader, &instance.version, minecraft, &net::get, task.log)?
            }
        };
    }
    let version = launch::resolve(
        launch::read(&minecraft.join("versions").join(&profile).join(format!("{profile}.json")))?,
        minecraft,
    )?;

    Ok((version, profile, java))
}

/// La commande Java qui lance l'instance, sa sortie redirigée vers le launcher.
fn command(
    instance: &Instance,
    settings: &Settings,
    version: &Value,
    profile: &str,
    java: &Path,
    player: &launch::Player,
) -> Result<std::process::Command, String> {
    let minecraft = config::minecraft_dir();
    let game_dir = config::instance_dir(&instance.id);
    let natives = config::data_dir().join("natives").join(profile);
    let memory = if instance.memory_mb > 0 { instance.memory_mb } else { settings.memory_mb };
    let jvm_text = if instance.jvm_args.trim().is_empty() { &settings.jvm_args } else { &instance.jvm_args };
    let jvm_args: Vec<String> = jvm_text.split_whitespace().map(String::from).collect();
    let (width, height) = if instance.width > 0 && instance.height > 0 {
        (instance.width, instance.height)
    } else {
        (settings.width, settings.height)
    };
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    let server = Some(instance.server.trim()).filter(|s| !s.is_empty());
    let mut cmd = launch::command(
        version,
        &launch::Launch {
            minecraft: &minecraft,
            game_dir: &game_dir,
            natives: &natives,
            java,
            memory_mb: memory.max(512),
            min_memory_mb: settings.min_memory_mb,
            fullscreen: settings.fullscreen,
            jvm_args: &jvm_args,
            player,
            os: launch::os_name(),
            window: (width > 0 && height > 0).then_some((width, height)),
            server,
        },
    )?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

fn update_stats(id: &str, change: impl FnOnce(&mut Instance)) {
    let mut list = config::instances();
    if let Some(instance) = list.iter_mut().find(|i| i.id == id) {
        change(instance);
        let _ = config::save_instances(&list);
    }
}

#[tauri::command]
fn cancel_launch(state: State) {
    state.cancel.store(true, Relaxed);
}

#[tauri::command]
fn stop_game(state: State, id: String) -> Result<(), String> {
    let pid = *state.running.lock().unwrap().get(&id).ok_or("Le jeu n'est pas lancé.")?;
    let status = if cfg!(windows) {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        cmd.status()
    } else {
        std::process::Command::new("kill").args(["-9", &pid.to_string()]).status()
    };
    status.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn game_logs(state: State, id: String) -> Vec<String> {
    state
        .logs
        .lock()
        .unwrap()
        .get(&id)
        .map(|l| l.iter().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
fn add_offline(name: String) -> Result<auth::Public, String> {
    let account = auth::offline(&name)?;
    let public = account.public();
    auth::upsert(account)?;
    select(&public.uuid)?;
    Ok(public)
}

#[tauri::command]
async fn ms_start() -> Result<auth::DeviceCode, String> {
    blocking(auth::start_device_code).await
}

#[tauri::command]
async fn ms_finish(state: State<'_>, code: auth::DeviceCode) -> Result<auth::Public, String> {
    state.login_cancel.store(false, Relaxed);
    let shared = Arc::clone(state.inner());
    blocking(move || {
        let account = auth::finish_device_code(&code, &|| shared.login_cancel.load(Relaxed))?;
        let public = account.public();
        auth::upsert(account)?;
        select(&public.uuid)?;
        Ok(public)
    })
    .await
}

#[tauri::command]
fn ms_cancel(state: State) {
    state.login_cancel.store(true, Relaxed);
}

fn select(uuid: &str) -> Result<(), String> {
    let mut settings = config::settings();
    settings.active_account = uuid.to_string();
    config::save("settings.json", &settings)
}

#[tauri::command]
fn select_account(uuid: String) -> Result<(), String> {
    select(&uuid)
}

#[tauri::command]
fn remove_account(uuid: String) -> Result<(), String> {
    let mut list = auth::accounts();
    list.retain(|a| a.uuid != uuid);
    auth::save(&list)?;
    let settings = config::settings();
    if settings.active_account == uuid {
        select(list.first().map(|a| a.uuid.as_str()).unwrap_or(""))?;
    }
    Ok(())
}

/// Ouvre un dossier du launcher : `data`, ou `<sous-dossier>:<instance>`.
#[tauri::command]
fn open_folder(target: String) -> Result<(), String> {
    let dir = match target.split_once(':') {
        None if target == "data" => config::data_dir(),
        None if target == "minecraft" => config::minecraft_dir(),
        Some((sub, id)) => {
            files::relative(id)?;
            let base = config::instance_dir(id);
            match sub {
                "instance" => base,
                "mods" | "saves" | "screenshots" | "resourcepacks" | "shaderpacks" | "logs" => base.join(sub),
                _ => return Err("Dossier inconnu.".into()),
            }
        }
        _ => return Err("Dossier inconnu.".into()),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_path(dir.as_os_str())
}

fn open_path(path: &std::ffi::OsStr) -> Result<(), String> {
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Ouvre un lien https dans le navigateur.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(['"', ' ', '\n']) {
        return Err("Lien refusé.".into());
    }
    if cfg!(windows) {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else {
        open_path(std::ffi::OsStr::new(&url))
    }
}

/// La connexion Microsoft par le navigateur (page Microsoft, retour sur localhost).
#[tauri::command]
async fn ms_browser(state: State<'_>) -> Result<auth::Public, String> {
    state.login_cancel.store(false, Relaxed);
    let shared = Arc::clone(state.inner());
    blocking(move || {
        let account = auth::browser_login(&|url| open_url(url.to_string()), &|| shared.login_cancel.load(Relaxed))?;
        let public = account.public();
        auth::upsert(account)?;
        select(&public.uuid)?;
        Ok(public)
    })
    .await
}

fn instance_by_id(id: &str) -> Result<Instance, String> {
    config::instances()
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| "Cette instance n'existe plus.".to_string())
}

#[tauri::command]
async fn modrinth_search(
    query: String,
    kind: String,
    version: String,
    loader: String,
    offset: u32,
    sort: String,
) -> Result<Value, String> {
    blocking(move || modrinth::search(&query, &kind, &version, &loader, offset, &sort)).await
}

#[tauri::command]
async fn modrinth_project(id: String, version: String, loader: String, kind: String) -> Result<Value, String> {
    blocking(move || {
        let project = modrinth::project(&id)?;
        let versions = if version.is_empty() {
            Vec::new()
        } else {
            modrinth::versions(&id, &version, &loader, &kind).unwrap_or_default()
        };
        Ok(json!({ "project": project, "versions": versions.into_iter().take(30).collect::<Vec<_>>() }))
    })
    .await
}

#[tauri::command]
async fn modrinth_install(instance: String, project: String, version: Option<String>, kind: String) -> Result<Vec<String>, String> {
    blocking(move || modrinth::install(&instance_by_id(&instance)?, &project, version.as_deref(), &kind)).await
}

#[tauri::command]
fn modrinth_installed(instance: String) -> Value {
    modrinth::installed(&instance)
}

#[tauri::command]
fn modrinth_remove(instance: String, key: String, kind: String) -> Result<(), String> {
    modrinth::remove(&instance, &key, &kind)
}

/// Crée une instance depuis un modpack Modrinth ; la progression arrive par `modpack-progress`.
#[tauri::command]
async fn modrinth_modpack(app: AppHandle, project: String, version: Option<String>) -> Result<Instance, String> {
    blocking(move || {
        let report = |stage: &str, done: usize, total: usize| {
            let _ = app.emit("modpack-progress", json!({ "stage": stage, "done": done, "total": total }));
        };
        modrinth::install_modpack(&project, version.as_deref(), &report)
    })
    .await
}

/// Installe (ou met à jour) le build d'Horizon tout de suite.
#[tauri::command]
async fn horizon_update(app: AppHandle) -> Result<Value, String> {
    blocking(move || {
        let cancel = AtomicBool::new(false);
        let report = |stage: &str, done: usize, total: usize| {
            let _ = app.emit("horizon-progress", json!({ "stage": stage, "done": done, "total": total }));
        };
        let log = |_line: String| {};
        let task = mojang::Task { cancel: &cancel, jobs: 8, verify: false, report: &report, log: &log };
        horizon::ensure_build(true, &task)?;
        Ok(horizon::status())
    })
    .await
}

/// La musique en cours (Spotify, Deezer, navigateur…). `known` : la pochette déjà affichée.
#[tauri::command]
async fn now_playing(app: String, known: String) -> Result<Value, String> {
    blocking(move || media::now_playing(&app, &known)).await
}

#[tauri::command]
async fn media_control(app: String, action: String) -> Result<(), String> {
    blocking(move || media::control(&app, &action)).await
}

fn media_dir() -> PathBuf {
    config::data_dir().join("media")
}

/// Enregistre une vidéo, une image ou un son choisi par le joueur (corps binaire de la requête,
/// `x-kind` et `x-name` en en-têtes) dans `media/`, et renvoie son chemin.
#[tauri::command]
async fn save_media(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let kind = header("x-kind");
    let name = net::dec(&header("x-name")).to_lowercase();
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Fichier manquant".into());
    };
    let ext = name.rsplit('.').next().unwrap_or("").to_string();
    let allowed: &[&str] = match kind.as_str() {
        "video" | "intro" => &["mp4", "webm", "m4v", "mov"],
        "image" => &["png", "jpg", "jpeg", "webp", "gif"],
        "audio" => &["mp3", "ogg", "wav", "m4a", "flac", "mp4", "webm"],
        _ => return Err("Type de fichier inconnu".into()),
    };
    if !allowed.contains(&ext.as_str()) {
        return Err(format!("Format non pris en charge : .{ext} (acceptés : {})", allowed.join(", ")));
    }
    if data.len() > 600 * 1024 * 1024 {
        return Err("Fichier trop lourd (600 Mo au maximum).".into());
    }
    let data = data.clone();
    blocking(move || {
        let dir = media_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Un seul fichier par usage : le précédent est remplacé.
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            if entry.file_name().to_string_lossy().starts_with(&format!("{kind}-")) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        let path = dir.join(format!("{kind}-{}.{ext}", config::new_id()));
        files::write_file(&path, &data)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
fn remove_media(kind: String) -> Result<(), String> {
    for entry in std::fs::read_dir(media_dir()).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().starts_with(&format!("{kind}-")) {
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Le Pack Leaf Client : performances, freelook, zoom et HUD déplaçable, depuis Modrinth.
const CLIENT_PACK: [(&str, &str); 10] = [
    ("sodium", "Sodium"),
    ("lithium", "Lithium"),
    ("ferrite-core", "FerriteCore"),
    ("immediatelyfast", "ImmediatelyFast"),
    ("entityculling", "Entity Culling"),
    ("freelook", "Freelook"),
    ("zoomify", "Zoomify"),
    ("evergreenhud", "EvergreenHUD"),
    ("modmenu", "Mod Menu"),
    ("appleskin", "AppleSkin"),
];

#[tauri::command]
async fn client_pack(app: AppHandle, instance: String) -> Result<Value, String> {
    blocking(move || {
        let inst = instance_by_id(&instance)?;
        if !matches!(inst.loader.as_str(), "fabric" | "quilt") {
            return Err("Le Pack Leaf Client demande une instance Fabric ou Quilt.".into());
        }
        let (mut installed, mut missing) = (Vec::new(), Vec::new());
        for (i, (slug, name)) in CLIENT_PACK.iter().enumerate() {
            let _ = app.emit("modpack-progress", json!({ "stage": format!("Pack Leaf Client : {name}"), "done": i, "total": CLIENT_PACK.len() }));
            match modrinth::install(&inst, slug, None, "mod") {
                Ok(names) => installed.extend(names),
                Err(e) => missing.push(json!({ "name": name, "error": e })),
            }
        }
        let _ = app.emit("modpack-progress", json!({ "stage": "Pack Leaf Client", "done": CLIENT_PACK.len(), "total": CLIENT_PACK.len() }));
        Ok(json!({ "installed": installed, "missing": missing }))
    })
    .await
}

const NOTES: &str = "https://launchercontent.mojang.com/v2/javaPatchNotes.json";
const CONTENT: &str = "https://launchercontent.mojang.com/v2/";

/// Les notes de version de Mojang (celles du launcher officiel), gardées pour le hors-ligne.
#[tauri::command]
async fn patch_notes() -> Result<Value, String> {
    blocking(|| {
        let cache = config::data_dir().join("cache").join("patch_notes.json");
        let json = match net::get(NOTES) {
            Ok(bytes) => {
                let _ = files::write_file(&cache, &bytes);
                serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())?
            }
            Err(e) => files::read_json(&cache).map_err(|_| e)?,
        };
        let notes: Vec<Value> = json["entries"]
            .as_array()
            .into_iter()
            .flatten()
            .take(60)
            .map(|e| {
                let image = e["image"]["url"].as_str().unwrap_or_default();
                json!({
                    "title": e["title"],
                    "version": e["version"],
                    "kind": e["type"],
                    "date": e["date"],
                    "short": e["shortText"],
                    "content": e["contentPath"],
                    "image": if image.is_empty() { Value::Null } else {
                        format!("https://launchercontent.mojang.com{}", image).into()
                    },
                })
            })
            .collect();
        Ok(Value::Array(notes))
    })
    .await
}

#[tauri::command]
async fn patch_note_body(content: String) -> Result<String, String> {
    blocking(move || {
        files::relative(&content)?;
        let json = net::get_json(&format!("{CONTENT}{content}"))?;
        Ok(json["body"].as_str().unwrap_or_default().to_string())
    })
    .await
}

/// La place que prennent les fichiers du launcher.
#[tauri::command]
async fn storage() -> Result<Value, String> {
    blocking(|| {
        let data = config::data_dir();
        Ok(json!({
            "minecraft": files::dir_size(&data.join("minecraft")),
            "runtime": files::dir_size(&data.join("runtime")),
            "instances": files::dir_size(&data.join("instances")),
            "horizon": files::dir_size(&data.join("horizon")),
        }))
    })
    .await
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(Shared::default()))
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_settings,
            list_versions,
            loader_versions,
            create_instance,
            update_instance,
            duplicate_instance,
            delete_instance,
            instance_details,
            launch,
            cancel_launch,
            stop_game,
            game_logs,
            add_offline,
            ms_start,
            ms_finish,
            ms_cancel,
            select_account,
            remove_account,
            open_folder,
            open_url,
            patch_notes,
            patch_note_body,
            storage,
            ms_browser,
            modrinth_search,
            modrinth_project,
            modrinth_install,
            modrinth_installed,
            modrinth_remove,
            modrinth_modpack,
            horizon_update,
            now_playing,
            media_control,
            save_media,
            remove_media,
            client_pack,
        ])
        .setup(|app| {
            // Les vidéos, images et sons du joueur sont lus par le protocole asset, dans media/ seulement.
            let _ = std::fs::create_dir_all(media_dir());
            let _ = app.asset_protocol_scope().allow_directory(media_dir(), false);
            let settings = config::settings();
            discord::configure(discord_config(&settings));
            idle_presence(&settings);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Leaf Launcher n'a pas pu démarrer");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le vrai parcours, de bout en bout : télécharge la version (et son loader et son Java) depuis
    /// Mojang, lance le jeu hors ligne et attend qu'il ouvre sa fenêtre, puis le ferme.
    /// `LEAF_TEST_VERSION=1.21.11 LEAF_TEST_LOADER=vanilla cargo test --release -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_launch() {
        let version = std::env::var("LEAF_TEST_VERSION").unwrap_or("26.3".into());
        let loader = std::env::var("LEAF_TEST_LOADER").unwrap_or("fabric".into());
        let instance = Instance {
            id: format!("test-{loader}-{version}"),
            name: "Test".into(),
            version,
            loader,
            ..Default::default()
        };
        let settings = Settings::default();
        let cancel = AtomicBool::new(false);
        let last = Mutex::new(String::new());
        let report = |stage: &str, done: usize, total: usize| {
            let line = format!("{stage} {done}/{total}");
            let mut last = last.lock().unwrap();
            if done == total && *last != line {
                println!("  {line}");
            }
            *last = line;
        };
        let log = |line: String| println!("[Leaf] {line}");
        let task = mojang::Task { cancel: &cancel, jobs: 16, verify: false, report: &report, log: &log };
        let started = std::time::Instant::now();
        let (version, profile, java) =
            prepare(&instance, &settings, &config::minecraft_dir(), launch::os_name(), &task).unwrap();
        println!("Prêt en {:?} : {profile}, {}", started.elapsed(), java.display());
        let player = auth::offline("LeafTest").map(|a| launch::Player {
            name: a.name,
            uuid: a.uuid,
            token: "0".into(),
            xuid: "0".into(),
            user_type: "legacy".into(),
        });
        let mut cmd = command(&instance, &settings, &version, &profile, &java, &player.unwrap()).unwrap();
        let mut child = cmd.spawn().unwrap();
        let out = child.stdout.take().unwrap();
        let err = child.stderr.take().unwrap();
        std::thread::spawn(move || BufReader::new(err).lines().map_while(Result::ok).for_each(|l| eprintln!("  ! {l}")));
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(150);
        let mut ok = false;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(std::time::Duration::from_secs(1)) {
                Ok(line) => {
                    println!("  | {line}");
                    // Le jeu a ouvert sa fenêtre et chargé ses ressources.
                    if line.contains("Sound engine started") || line.contains("Created:") && line.contains("textures-atlas") {
                        ok = true;
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(status)) = child.try_wait() {
                        panic!("Le jeu s'est arrêté : {status}");
                    }
                }
                Err(_) => break,
            }
        }
        let _ = child.kill();
        assert!(ok, "Le jeu n'a pas fini de démarrer");
        println!("Minecraft {} ({profile}) a démarré en {:?}", instance.version, started.elapsed());
    }
}

#[cfg(test)]
mod content_tests {
    use super::*;

    /// Installe Sodium depuis Modrinth (avec ses dépendances) dans une instance Fabric de test.
    /// `cargo test --release -- --ignored --nocapture modrinth_install`
    #[test]
    #[ignore]
    fn modrinth_install() {
        let instance = Instance {
            id: "test-modrinth".into(),
            name: "Test".into(),
            version: std::env::var("LEAF_TEST_VERSION").unwrap_or("1.21.11".into()),
            loader: "fabric".into(),
            ..Default::default()
        };
        let found = modrinth::search("sodium", "mod", &instance.version, "fabric", 0, "relevance").unwrap();
        println!("{} résultats", found["total_hits"]);
        let done = modrinth::install(&instance, "AANobbMI", None, "mod").unwrap();
        println!("Installés : {done:?}");
        let record = modrinth::installed(&instance.id);
        let file = record["AANobbMI"]["file"].as_str().unwrap();
        assert!(config::instance_dir(&instance.id).join("mods").join(file).is_file());
        modrinth::remove(&instance.id, "AANobbMI", "mod").unwrap();
        assert!(!config::instance_dir(&instance.id).join("mods").join(file).is_file());
    }
}

#[cfg(test)]
mod pack_tests {
    use super::*;

    /// Installe le Pack Leaf Client dans l'instance de test de `real_launch` (même id), pour
    /// lancer ensuite le jeu avec ces mods. `cargo test --release -- --ignored --nocapture client_pack_install`
    #[test]
    #[ignore]
    fn client_pack_install() {
        let version = std::env::var("LEAF_TEST_VERSION").unwrap_or("26.3".into());
        let instance = Instance {
            id: format!("test-fabric-{version}"),
            name: "Test".into(),
            version,
            loader: "fabric".into(),
            ..Default::default()
        };
        for (slug, name) in CLIENT_PACK {
            match modrinth::install(&instance, slug, None, "mod") {
                Ok(done) => println!("✓ {name} : {done:?}"),
                Err(e) => println!("✗ {name} : {e}"),
            }
        }
        let record = modrinth::installed(&instance.id);
        println!("{} fichiers suivis", record.as_object().map(|m| m.len()).unwrap_or(0));
    }
}
