//! Le téléchargement d'une version depuis Mojang, comme le fait le launcher officiel : le client,
//! les bibliothèques de ce système, la config de logs, l'index et les objets des assets, et le
//! Java de Mojang. Chaque fichier est vérifié contre la taille et le sha1 que liste Mojang et
//! écrit entier ; un téléchargement interrompu garde les fichiers finis.
//!
//! Repris de `launcher/src/mojang.rs` du launcher Horizon (MIT), avec la progression envoyée à
//! l'interface et une vérification rapide (par la taille) des fichiers déjà là.

use crate::files::{read_json, relative, sha1_file, sha1_hex, text, write_file};
use crate::net;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::Relaxed};
use std::sync::Mutex;
use std::time::Duration;

const OBJECTS: &str = "https://resources.download.minecraft.net";
/// L'index des Java de Mojang, celui que lit le launcher officiel.
const JAVA_RUNTIMES: &str = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

pub const CANCELLED: &str = "Téléchargement annulé. Relance pour reprendre là où il s'est arrêté.";

/// Une préparation en cours : annulation, nombre de téléchargements en parallèle, progression.
pub struct Task<'a> {
    pub cancel: &'a AtomicBool,
    pub jobs: usize,
    /// Revérifier le sha1 des fichiers déjà là (sinon la taille suffit).
    pub verify: bool,
    /// Étape, fichiers faits, sur combien.
    pub report: &'a (dyn Fn(&str, usize, usize) + Sync),
    pub log: &'a (dyn Fn(String) + Sync),
}

struct File {
    url: String,
    sha1: String,
    size: Option<u64>,
    path: PathBuf,
}

/// Télécharge la version `version` (son JSON, sans loader) dans `dir`.
pub fn download_game(version: &Value, dir: &Path, os: &str, task: &Task) -> Result<(), String> {
    let v = text(version, "id")?;
    let versions = dir.join("versions").join(relative(&v)?);
    let client = &version["downloads"]["client"];
    let mut game = vec![File {
        url: text(client, "url")?,
        sha1: text(client, "sha1")?,
        size: client["size"].as_u64(),
        path: versions.join(format!("{v}.jar")),
    }];
    let libraries = version["libraries"]
        .as_array()
        .ok_or("Le fichier de version n'a pas de bibliothèques")?;
    for library in libraries.iter().filter(|l| allowed(l, os)) {
        // Avant 1.19, les natives d'une bibliothèque pour ce système sont un classifier à part.
        let native = native_classifier(library, os)
            .map(|key| &library["downloads"]["classifiers"][key.as_str()]);
        for artifact in [Some(&library["downloads"]["artifact"]), native]
            .into_iter()
            .flatten()
            .filter(|a| !a.is_null())
        {
            game.push(File {
                url: text(artifact, "url")?,
                sha1: text(artifact, "sha1")?,
                size: artifact["size"].as_u64(),
                path: dir.join("libraries").join(relative(&text(artifact, "path")?)?),
            });
        }
    }
    // La config de logs : pour 1.7 à 1.18, celle de Mojang tient Log4Shell à l'écart.
    let logging = &version["logging"]["client"]["file"];
    if !logging.is_null() {
        game.push(File {
            url: text(logging, "url")?,
            sha1: text(logging, "sha1")?,
            size: logging["size"].as_u64(),
            path: dir.join("assets/log_configs").join(relative(&text(logging, "id")?)?),
        });
    }
    (task.log)(format!(
        "Minecraft {v} : le jeu et {} bibliothèques",
        game.len() - 1
    ));
    fetch_each(&game, task, "Bibliothèques", true)?;
    let index = &version["assetIndex"];
    let index = File {
        url: text(index, "url")?,
        sha1: text(index, "sha1")?,
        size: index["size"].as_u64(),
        path: dir
            .join("assets/indexes")
            .join(relative(&format!("{}.json", text(index, "id")?))?),
    };
    fetch_each(std::slice::from_ref(&index), task, "Index des ressources", true)?;
    let objects = objects(&read_json(&index.path)?, dir)?;
    (task.log)(format!("Ressources : {} fichiers", objects.len()));
    match fetch_each(&objects, task, "Ressources", false) {
        Err(e) if e == CANCELLED => return Err(e),
        Err(e) => (task.log)(format!("Des ressources n'ont pas pu être téléchargées : {e}")),
        Ok(()) => {}
    }
    Ok(())
}

/// Le nom de ce système dans l'index des Java de Mojang.
fn java_platform() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "mac-os-arm64",
        ("macos", "x86_64") => "mac-os",
        ("linux", "x86_64") => "linux",
        ("linux", "x86") => "linux-i386",
        ("windows", "x86_64") => "windows-x64",
        ("windows", "aarch64") => "windows-arm64",
        ("windows", "x86") => "windows-x86",
        _ => return None,
    })
}

/// Le programme `java` d'un Java de Mojang installé dans `home`.
pub fn java_exe(home: &Path) -> PathBuf {
    if cfg!(windows) {
        home.join("bin").join("java.exe")
    } else if cfg!(target_os = "macos") {
        home.join("jre.bundle/Contents/Home/bin/java")
    } else {
        home.join("bin").join("java")
    }
}

/// Télécharge le Java `component` de Mojang (`javaVersion.component` du fichier de version, par
/// exemple `java-runtime-delta`) dans `runtime/<component>/<plateforme>/<component>/` et renvoie
/// son programme `java`. Un Java déjà complet n'est pas revérifié, sauf `task.verify`.
pub fn java_runtime(component: &str, runtime: &Path, task: &Task) -> Result<PathBuf, String> {
    let platform = java_platform().ok_or("Mojang ne fournit pas de Java pour ce système")?;
    let home = runtime.join(relative(component)?).join(platform).join(component);
    let marker = home.join(".leaf-complete");
    if marker.is_file() && !task.verify && java_exe(&home).is_file() {
        return Ok(java_exe(&home));
    }
    (task.report)("Java", 0, 1);
    let index = net::get_json(JAVA_RUNTIMES)?;
    let entry = &index[platform][component][0];
    if entry.is_null() {
        return Err(format!("Mojang n'a pas de {component} pour {platform}"));
    }
    let manifest = &entry["manifest"];
    let url = text(manifest, "url")?;
    let body = net::get(&url)?;
    if sha1_hex(&body) != text(manifest, "sha1")? {
        return Err(format!("Le manifeste {component} de Mojang n'a pas le bon sha1"));
    }
    let manifest: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    let files = manifest["files"]
        .as_object()
        .ok_or_else(|| format!("Le manifeste {component} ne liste aucun fichier"))?;
    let mut downloads = Vec::new();
    let mut executables = Vec::new();
    for (name, file) in files {
        let path = home.join(relative(name)?);
        if file["type"].as_str() == Some("file") {
            let raw = &file["downloads"]["raw"];
            if file["executable"] == true {
                executables.push(path.clone());
            }
            downloads.push(File {
                url: text(raw, "url")?,
                sha1: text(raw, "sha1")?,
                size: raw["size"].as_u64(),
                path,
            });
        }
    }
    let name = entry["version"]["name"].as_str().unwrap_or(component);
    (task.log)(format!("Java {name} de Mojang : {} fichiers", downloads.len()));
    fetch_each(&downloads, task, &format!("Java {name}"), true)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in &executables {
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
        }
    }
    #[cfg(not(unix))]
    let _ = executables;
    write_file(&marker, name.as_bytes())?;
    Ok(java_exe(&home))
}

/// Si les règles d'une bibliothèque laissent ce système l'utiliser : la dernière qui
/// correspond décide.
fn allowed(library: &Value, os: &str) -> bool {
    let Some(rules) = library["rules"].as_array() else {
        return true;
    };
    rules
        .iter()
        .rfind(|rule| rule["os"]["name"].as_str().is_none_or(|name| name == os))
        .is_some_and(|rule| rule["action"] == "allow")
}

/// Le classifier des natives d'une bibliothèque pour `os` ; `${arch}` est la taille des mots.
pub fn native_classifier(library: &Value, os: &str) -> Option<String> {
    let arch = if cfg!(target_pointer_width = "64") { "64" } else { "32" };
    library["natives"][os]
        .as_str()
        .map(|key| key.replace("${arch}", arch))
}

/// Les objets de l'index des ressources, une fois chacun.
fn objects(index: &Value, dir: &Path) -> Result<Vec<File>, String> {
    let objects = index["objects"]
        .as_object()
        .ok_or("L'index des ressources n'a pas d'objets")?;
    let mut list: Vec<(&str, Option<u64>)> = objects
        .values()
        .filter_map(|o| Some((o["hash"].as_str()?, o["size"].as_u64())))
        .collect();
    list.sort_unstable_by_key(|(hash, _)| *hash);
    list.dedup_by_key(|(hash, _)| *hash);
    list.into_iter()
        .map(|(hash, size)| {
            if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(format!("Mauvais hash {hash:?} dans l'index des ressources"));
            }
            let path = format!("{}/{hash}", &hash[..2]);
            Ok(File {
                url: format!("{OBJECTS}/{path}"),
                sha1: hash.to_string(),
                size,
                path: dir.join("assets/objects").join(path),
            })
        })
        .collect()
}

/// Déjà là et entier : la bonne taille, et le bon sha1 quand on revérifie (ou sans taille).
fn present(file: &File, verify: bool) -> bool {
    let Ok(meta) = fs::metadata(&file.path) else {
        return false;
    };
    match file.size {
        Some(size) if meta.len() != size => false,
        Some(_) if !verify => true,
        _ => sha1_file(&file.path).as_deref() == Some(file.sha1.as_str()),
    }
}

/// Un fichier de Mojang, refusé s'il n'a pas la taille et le sha1 listés ; réessayé deux fois.
fn fetch_file(file: &File) -> Result<Vec<u8>, String> {
    let mut last = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(400 * attempt));
        }
        match net::get(&file.url) {
            Ok(body) => {
                if let Some(size) = file.size.filter(|&s| s != body.len() as u64) {
                    last = format!("fait {} octets au lieu de {size}", body.len());
                    continue;
                }
                let actual = sha1_hex(&body);
                if actual == file.sha1 {
                    return Ok(body);
                }
                last = format!("n'a pas le sha1 de Mojang ({actual})");
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Télécharge ceux qui manquent, `task.jobs` à la fois, en annonçant la progression. Avec
/// `stop_on_error`, s'arrête à la première erreur ; sinon finit les autres et la rapporte.
fn fetch_each(files: &[File], task: &Task, label: &str, stop_on_error: bool) -> Result<(), String> {
    let errors = AtomicUsize::new(0);
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let failed = Mutex::new(None);
    (task.report)(label, 0, files.len());
    std::thread::scope(|scope| {
        let workers: Vec<_> = (0..task.jobs.clamp(1, files.len().max(1)))
            .map(|_| {
                scope.spawn(|| {
                    while let Some(file) = files.get(next.fetch_add(1, Relaxed)) {
                        if stop_on_error && failed.lock().unwrap().is_some() {
                            break;
                        }
                        if task.cancel.load(Relaxed) {
                            failed.lock().unwrap().get_or_insert(CANCELLED.to_string());
                            break;
                        }
                        if !present(file, task.verify) {
                            let got = fetch_file(file)
                                .map_err(|e| format!("{} {e}", file.url))
                                .and_then(|body| write_file(&file.path, &body));
                            if let Err(e) = got {
                                errors.fetch_add(1, Relaxed);
                                failed.lock().unwrap().get_or_insert(e);
                            }
                        }
                        done.fetch_add(1, Relaxed);
                    }
                })
            })
            .collect();
        while !workers.iter().all(|w| w.is_finished()) {
            std::thread::sleep(Duration::from_millis(120));
            (task.report)(label, done.load(Relaxed), files.len());
        }
    });
    (task.report)(label, done.load(Relaxed), files.len());
    match failed.into_inner().unwrap() {
        Some(e) if !stop_on_error && e != CANCELLED => Err(format!(
            "{} fichiers sur {} ont échoué, le premier : {e}",
            errors.load(Relaxed),
            files.len()
        )),
        Some(e) => Err(e),
        None => Ok(()),
    }
}
