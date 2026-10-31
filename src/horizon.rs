//! Horizon : Minecraft Java Edition 26.3 réécrit en Rust (github.com/horizon-rust/horizon). Le
//! launcher installe un build publié (la Nightly), le prépare depuis les fichiers de 26.3 qu'il a
//! téléchargés pour le joueur (`horizon-prepare`, avec le Java 25 de Mojang), puis lance
//! `horizon-client` en lui passant le compte comme le décrit l'API de lancement d'Horizon
//! (`--session-stdin`). Comme le demande Horizon, seul un compte Microsoft qui possède le jeu le lance.

use crate::config::data_dir;
use crate::files::{read_json, relative, sha1_hex, text, write_file};
use crate::mojang::Task;
use crate::net;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// La seule version de Minecraft qu'Horizon fait tourner.
pub const MINECRAFT: &str = "26.3";
const RELEASE: &str = "https://api.github.com/repos/horizon-rust/horizon/releases/tags/nightly";

fn asset_name() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "horizon-windows-x64.zip",
        ("linux", "x86_64") => "horizon-linux-x86_64.tar.gz",
        ("macos", "aarch64") => "horizon-macos-arm64.zip",
        _ => return Err("Horizon n'a pas de build pour ce système.".into()),
    })
}

fn root() -> PathBuf {
    data_dir().join("horizon")
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Le build installé : son dossier et son nom.
pub fn current() -> Option<(PathBuf, String)> {
    let info = read_json(&root().join("current.json")).ok()?;
    let dir = root().join("builds").join(info["dir"].as_str()?);
    dir.join(exe("horizon-client")).is_file().then(|| (dir, info["name"].as_str().unwrap_or("Horizon").to_string()))
}

/// L'état pour l'interface : build installé, préparé ou non.
pub fn status() -> Value {
    match current() {
        Some((dir, name)) => json!({ "installed": true, "name": name, "prepared": resources(&dir).is_dir() }),
        None => json!({ "installed": false, "prepared": false }),
    }
}

fn resources(build: &Path) -> PathBuf {
    build.join(".local").join("horizon-client").join(MINECRAFT)
}

/// Installe la dernière Nightly si elle n'est pas déjà là (ou si `update`), vérifiée contre le
/// SHA256SUMS de sa release, et renvoie son dossier.
pub fn ensure_build(update: bool, task: &Task) -> Result<PathBuf, String> {
    if let (Some((dir, _)), false) = (current(), update) {
        return Ok(dir);
    }
    (task.report)("Horizon", 0, 1);
    let release = net::get_json(RELEASE)?;
    let name = release["name"].as_str().unwrap_or("Nightly").to_string();
    let commit = release["target_commitish"].as_str().unwrap_or("build");
    let folder: String = format!("{}-{}", release["published_at"].as_str().unwrap_or(""), &commit[..commit.len().min(10)])
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    let dir = root().join("builds").join(&folder);
    if dir.join(exe("horizon-client")).is_file() {
        write_file(&root().join("current.json"), json!({ "dir": folder, "name": name }).to_string().as_bytes())?;
        return Ok(dir);
    }
    let wanted = asset_name()?;
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let url_of = |n: &str| {
        assets
            .iter()
            .find(|a| a["name"] == n)
            .and_then(|a| a["browser_download_url"].as_str().map(String::from))
            .ok_or_else(|| format!("La release Horizon n'a pas {n}"))
    };
    let sums = String::from_utf8_lossy(&net::get(&url_of("SHA256SUMS")?)?).into_owned();
    let expected = sums
        .lines()
        .find_map(|l| l.split_whitespace().collect::<Vec<_>>().split_first().and_then(|(h, rest)| {
            rest.iter().any(|f| f.trim_start_matches('*') == wanted).then(|| h.to_string())
        }))
        .ok_or("SHA256SUMS ne liste pas ce build")?;
    (task.log)(format!("Téléchargement d'Horizon ({name})"));
    (task.report)("Horizon", 0, 2);
    let body = net::get(&url_of(wanted)?)?;
    let actual: String = Sha256::digest(&body).iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected {
        return Err("Le build d'Horizon n'a pas le sha256 de sa release".into());
    }
    (task.report)("Horizon", 1, 2);
    if !wanted.ends_with(".zip") {
        return Err("Seuls les builds .zip sont pris en charge pour l'instant.".into());
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(body)).map_err(|e| e.to_string())?;
    let partial = dir.with_extension("partial");
    let _ = std::fs::remove_dir_all(&partial);
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else { continue };
        // Les archives ont un dossier racine (horizon-windows-x64/).
        let rest: PathBuf = name.components().skip(1).collect();
        if rest.as_os_str().is_empty() || entry.is_dir() {
            continue;
        }
        let out = partial.join(rest);
        std::fs::create_dir_all(out.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&partial, &dir).map_err(|e| e.to_string())?;
    write_file(&root().join("current.json"), json!({ "dir": folder, "name": name }).to_string().as_bytes())?;
    (task.report)("Horizon", 2, 2);
    Ok(dir)
}

fn hidden(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd;
}

/// Lance une étape de `horizon-prepare`, chaque ligne envoyée au journal et à la progression.
fn run_prepare(build: &Path, args: &[&std::ffi::OsStr], java_home: &Path, task: &Task, label: &str) -> Result<(), String> {
    let mut cmd = Command::new(build.join(exe("horizon-prepare")));
    cmd.args(args)
        .current_dir(build)
        .env("JAVA_HOME", java_home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    hidden(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("horizon-prepare : {e}"))?;
    let err = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || BufReader::new(err).lines().map_while(Result::ok).collect::<Vec<_>>());
    let mut step = 0;
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        step += 1;
        (task.report)(label, step.min(39), 40);
        (task.log)(format!("Horizon : {line}"));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let errors = errors.join().unwrap_or_default();
    for line in &errors {
        (task.log)(format!("Horizon : {line}"));
    }
    if !status.success() {
        return Err(format!(
            "La préparation d'Horizon a échoué : {}",
            errors.iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_else(|| status.to_string())
        ));
    }
    Ok(())
}

/// Prépare les ressources du build depuis les fichiers de 26.3 (une fois par build : quelques
/// minutes), avec le serveur 26.3 de Mojang et ses sons.
pub fn prepare(build: &Path, minecraft: &Path, java: &Path, task: &Task) -> Result<PathBuf, String> {
    let out = resources(build);
    if out.is_dir() {
        return Ok(out);
    }
    let version = read_json(&minecraft.join("versions").join(MINECRAFT).join(format!("{MINECRAFT}.json")))?;
    let server = &version["downloads"]["server"];
    let server_jar = minecraft.join("versions").join(MINECRAFT).join(format!("server-{MINECRAFT}.jar"));
    let sha1 = text(server, "sha1")?;
    if crate::files::sha1_file(&server_jar).as_deref() != Some(sha1.as_str()) {
        (task.report)("Serveur 26.3", 0, 1);
        let body = net::get(&text(server, "url")?)?;
        if sha1_hex(&body) != sha1 {
            return Err("Le serveur 26.3 n'a pas le sha1 de Mojang".into());
        }
        write_file(&server_jar, &body)?;
    }
    // JAVA_HOME : le dossier au-dessus de bin/.
    let java_home = java.parent().and_then(Path::parent).ok_or("Java introuvable")?;
    (task.log)("Préparation d'Horizon depuis tes fichiers de Minecraft 26.3 (quelques minutes, une seule fois)".into());
    let os = |s: &str| std::ffi::OsString::from(s);
    run_prepare(
        build,
        &[&os("--prepare"), &os("--server-jar"), server_jar.as_os_str(), &os("--minecraft-dir"), minecraft.as_os_str()],
        java_home,
        task,
        "Préparation d'Horizon",
    )?;
    run_prepare(build, &[&os("sounds"), &os("--minecraft-dir"), minecraft.as_os_str()], java_home, task, "Sons d'Horizon")?;
    relative(MINECRAFT)?;
    Ok(out)
}

/// La commande qui lance Horizon pour une instance ; le compte est à écrire sur son entrée standard.
pub fn command(
    build: &Path,
    resources: &Path,
    game_dir: &Path,
    window: (u32, u32),
    fullscreen: bool,
    server: Option<&str>,
) -> Command {
    let mut cmd = Command::new(build.join(exe("horizon-client")));
    cmd.arg("--resources")
        .arg(resources)
        .arg("--game-dir")
        .arg(game_dir)
        .arg("--home")
        .arg(game_dir)
        .args(["--width", &window.0.to_string(), "--height", &window.1.to_string()])
        .arg("--session-stdin")
        .current_dir(game_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());
    if fullscreen {
        cmd.arg("--fullscreen");
    }
    if let Some(server) = server {
        cmd.args(["--server", server]);
    }
    hidden(&mut cmd);
    cmd
}
