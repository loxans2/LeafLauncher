//! La bibliothèque Modrinth : recherche de mods, packs de ressources, shaders et modpacks pour la
//! version et le loader d'une instance, installation (chaque fichier vérifié contre le sha512 de
//! Modrinth) avec les dépendances requises, suppression, et création d'une instance depuis un
//! modpack `.mrpack`.

use crate::config::{self, Instance};
use crate::files::{relative, write_file};
use crate::net::{self, enc};
use serde_json::{json, Value};
use sha2::{Digest, Sha512};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::sync::Mutex;

const API: &str = "https://api.modrinth.com/v2";
const INSTALLED: &str = ".leaf-content.json";

fn sha512_hex(data: &[u8]) -> String {
    Sha512::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// Le dossier d'une instance où va un type de contenu.
fn folder(kind: &str) -> Result<&'static str, String> {
    Ok(match kind {
        "mod" => "mods",
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => return Err(format!("Type de contenu inconnu : {kind}")),
    })
}

/// Les loaders Modrinth compatibles avec celui de l'instance (Quilt charge aussi les mods Fabric).
fn loaders_for(loader: &str) -> Vec<&'static str> {
    match loader {
        "fabric" => vec!["fabric"],
        "quilt" => vec!["quilt", "fabric"],
        "forge" => vec!["forge"],
        "neoforge" => vec!["neoforge"],
        _ => vec![],
    }
}

/// Une page de résultats : `kind` (mod, resourcepack, shader, modpack), filtrés par version et loader.
pub fn search(query: &str, kind: &str, version: &str, loader: &str, offset: u32, sort: &str) -> Result<Value, String> {
    let mut facets = vec![json!([format!("project_type:{kind}")])];
    if !version.is_empty() {
        facets.push(json!([format!("versions:{version}")]));
    }
    let loaders = loaders_for(loader);
    if matches!(kind, "mod" | "modpack") && !loaders.is_empty() {
        facets.push(Value::Array(loaders.iter().map(|l| json!(format!("categories:{l}"))).collect()));
    }
    let sort = match sort {
        "downloads" | "follows" | "newest" | "updated" => sort,
        _ => "relevance",
    };
    let url = format!(
        "{API}/search?query={}&limit=24&offset={offset}&index={sort}&facets={}",
        enc(query),
        enc(&Value::Array(facets).to_string())
    );
    net::get_json(&url)
}

pub fn project(id: &str) -> Result<Value, String> {
    relative(id)?;
    net::get_json(&format!("{API}/project/{}", enc(id)))
}

/// Les versions d'un projet qui conviennent, la plus récente d'abord.
pub fn versions(id: &str, game_version: &str, loader: &str, kind: &str) -> Result<Vec<Value>, String> {
    relative(id)?;
    let mut url = format!("{API}/project/{}/version?game_versions={}", enc(id), enc(&json!([game_version]).to_string()));
    let loaders = loaders_for(loader);
    if kind == "mod" && !loaders.is_empty() {
        url.push_str(&format!("&loaders={}", enc(&json!(loaders).to_string())));
    }
    let list = net::get_json(&url)?;
    Ok(list.as_array().cloned().unwrap_or_default())
}

pub fn installed(instance: &str) -> Value {
    let text = std::fs::read_to_string(config::instance_dir(instance).join(INSTALLED)).unwrap_or_default();
    serde_json::from_str(&text).unwrap_or_else(|_| json!({}))
}

fn save_installed(instance: &str, value: &Value) -> Result<(), String> {
    write_file(
        &config::instance_dir(instance).join(INSTALLED),
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
}

/// Télécharge un fichier de version Modrinth vers `dir`, vérifié contre son sha512.
fn fetch_file(file: &Value, dir: &Path) -> Result<String, String> {
    let name = file["filename"].as_str().ok_or("Fichier sans nom")?;
    if name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(format!("Nom de fichier refusé : {name}"));
    }
    let url = file["url"].as_str().ok_or("Fichier sans URL")?;
    let body = net::get(url)?;
    if let Some(expected) = file["hashes"]["sha512"].as_str() {
        if sha512_hex(&body) != expected {
            return Err(format!("{name} n'a pas le sha512 publié par Modrinth"));
        }
    }
    write_file(&dir.join(name), &body)?;
    Ok(name.to_string())
}

/// Installe un projet dans une instance (la version donnée, ou la plus récente qui convient), avec
/// ses dépendances requises. Renvoie les titres installés.
pub fn install(instance: &Instance, project_id: &str, version_id: Option<&str>, kind: &str) -> Result<Vec<String>, String> {
    if kind == "mod" && loaders_for(&instance.loader).is_empty() {
        return Err("Les mods demandent un loader : Fabric, Quilt, Forge ou NeoForge. Change le loader de l'instance.".into());
    }
    let mut done = Vec::new();
    let mut seen = HashSet::new();
    install_one(instance, project_id, version_id, kind, &mut seen, &mut done, 0)?;
    Ok(done)
}

fn install_one(
    instance: &Instance,
    project_id: &str,
    version_id: Option<&str>,
    kind: &str,
    seen: &mut HashSet<String>,
    done: &mut Vec<String>,
    depth: u32,
) -> Result<(), String> {
    if !seen.insert(project_id.to_string()) || depth > 6 {
        return Ok(());
    }
    let mut record = installed(&instance.id);
    if depth > 0 && record.get(project_id).is_some() {
        return Ok(());
    }
    let version = match version_id {
        Some(v) => {
            relative(v)?;
            net::get_json(&format!("{API}/version/{}", enc(v)))?
        }
        None => {
            let list = versions(project_id, &instance.version, &instance.loader, kind)?;
            if list.is_empty() {
                return Err(format!("Pas de version pour Minecraft {} ({}).", instance.version, instance.loader));
            }
            // La plus récente d'abord ; si l'une de ses dépendances manque (une version « universelle »
            // peut en demander une d'un autre loader), les deux précédentes.
            let mut last = String::new();
            for candidate in list.iter().take(3) {
                seen.remove(project_id);
                match install_one(instance, project_id, candidate["id"].as_str(), kind, seen, done, depth) {
                    Ok(()) => return Ok(()),
                    Err(e) => last = e,
                }
            }
            return Err(last);
        }
    };
    // Un slug (« sodium ») et l'ID du projet désignent le même mod : on range par ID.
    let key = version["project_id"].as_str().unwrap_or(project_id).to_string();
    if depth > 0 && record.get(&key).is_some() {
        return Ok(());
    }
    let files = version["files"].as_array().cloned().unwrap_or_default();
    let file = files
        .iter()
        .find(|f| f["primary"] == true)
        .or(files.first())
        .ok_or("Cette version n'a pas de fichier")?;
    let dir = config::instance_dir(&instance.id).join(folder(kind)?);
    // Une mise à jour remplace l'ancien fichier.
    if let Some(old) = record[&key]["file"].as_str() {
        if Some(old) != file["filename"].as_str() {
            let _ = std::fs::remove_file(dir.join(old));
        }
    }
    let name = fetch_file(file, &dir)?;
    let title = project(project_id).ok().and_then(|p| p["title"].as_str().map(String::from)).unwrap_or(name.clone());
    record[&key] = json!({
        "file": name,
        "kind": kind,
        "title": title,
        "version": version["version_number"],
        "version_id": version["id"],
        "dependency": depth > 0,
    });
    save_installed(&instance.id, &record)?;
    done.push(title.clone());
    if kind == "mod" {
        for dep in version["dependencies"].as_array().into_iter().flatten() {
            if dep["dependency_type"] == "required" {
                if let Some(id) = dep["project_id"].as_str() {
                    if let Err(e) = install_one(instance, id, None, "mod", seen, done, depth + 1) {
                        // Sans sa dépendance, le mod ferait planter le jeu : on le retire.
                        let _ = std::fs::remove_file(dir.join(&name));
                        let mut record = installed(&instance.id);
                        if let Some(map) = record.as_object_mut() {
                            map.remove(&key);
                        }
                        save_installed(&instance.id, &record)?;
                        done.retain(|t| t != &title);
                        let dep_name = project(id).ok().and_then(|p| p["title"].as_str().map(String::from)).unwrap_or(id.to_string());
                        return Err(if e.starts_with("Pas de version") {
                            format!("{title} demande {dep_name}, qui n'existe pas encore pour Minecraft {} ({}).", instance.version, instance.loader)
                        } else {
                            format!("{title} : {e}")
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

/// Retire un contenu installé par Modrinth (ou un fichier posé à la main, par son nom).
pub fn remove(instance: &str, key: &str, kind: &str) -> Result<(), String> {
    let mut record = installed(instance);
    let dir = config::instance_dir(instance).join(folder(kind)?);
    let file = match record[key]["file"].as_str() {
        Some(f) => f.to_string(),
        None => key.to_string(),
    };
    if file.contains(['/', '\\']) || file.starts_with('.') {
        return Err("Nom de fichier refusé".into());
    }
    let path = dir.join(&file);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    if let Some(map) = record.as_object_mut() {
        map.remove(key);
    }
    save_installed(instance, &record)
}

/// Crée une instance depuis un modpack Modrinth : le `.mrpack` dit la version de Minecraft, le
/// loader, les fichiers à télécharger (sha512) et les `overrides` à copier.
pub fn install_modpack(
    project_id: &str,
    version_id: Option<&str>,
    report: &(dyn Fn(&str, usize, usize) + Sync),
) -> Result<Instance, String> {
    let info = project(project_id)?;
    let version = match version_id {
        Some(v) => net::get_json(&format!("{API}/version/{}", enc(v)))?,
        None => net::get_json(&format!("{API}/project/{}/version", enc(project_id)))?
            .as_array()
            .and_then(|l| l.first().cloned())
            .ok_or("Ce modpack n'a pas de version")?,
    };
    let file = version["files"]
        .as_array()
        .and_then(|f| f.iter().find(|f| f["primary"] == true).or(f.first()).cloned())
        .ok_or("Ce modpack n'a pas de fichier")?;
    report("Modpack", 0, 1);
    let url = file["url"].as_str().ok_or("Fichier sans URL")?;
    let body = net::get(url)?;
    if let Some(expected) = file["hashes"]["sha512"].as_str() {
        if sha512_hex(&body) != expected {
            return Err("Le modpack n'a pas le sha512 publié par Modrinth".into());
        }
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(body)).map_err(|e| format!("mrpack : {e}"))?;
    let mut text = String::new();
    zip.by_name("modrinth.index.json")
        .map_err(|_| "Ce fichier n'est pas un modpack Modrinth")?
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    let index: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let deps = &index["dependencies"];
    let minecraft = deps["minecraft"].as_str().ok_or("Le modpack ne dit pas sa version de Minecraft")?;
    let (loader, loader_version) = [
        ("fabric-loader", "fabric"),
        ("quilt-loader", "quilt"),
        ("neoforge", "neoforge"),
        ("forge", "forge"),
    ]
    .iter()
    .find_map(|(key, name)| deps[*key].as_str().map(|v| (name.to_string(), v.to_string())))
    .unwrap_or(("vanilla".into(), String::new()));
    // Forge nomme ses versions `<mc>-<forge>` dans son dépôt.
    let loader_version = if loader == "forge" && !loader_version.starts_with(minecraft) {
        format!("{minecraft}-{loader_version}")
    } else {
        loader_version
    };
    let instance = crate::create_instance(Instance {
        name: info["title"].as_str().unwrap_or("Modpack").to_string(),
        version: minecraft.to_string(),
        loader,
        loader_version,
        icon: "emerald".into(),
        engine: "java".into(),
        modpack: format!("{} {}", info["title"].as_str().unwrap_or(""), version["version_number"].as_str().unwrap_or("")),
        ..Default::default()
    })?;
    let dir = config::instance_dir(&instance.id);
    let files: Vec<Value> = index["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| f["env"]["client"] != "unsupported")
        .cloned()
        .collect();
    let done = AtomicUsize::new(0);
    let next = AtomicUsize::new(0);
    let failed = Mutex::new(None::<String>);
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                while let Some(f) = files.get(next.fetch_add(1, Relaxed)) {
                    if failed.lock().unwrap().is_some() {
                        break;
                    }
                    let got = (|| -> Result<(), String> {
                        let path = relative(f["path"].as_str().ok_or("Fichier sans chemin")?)?;
                        let url = f["downloads"][0].as_str().ok_or("Fichier sans lien")?;
                        let body = net::get(url)?;
                        if let Some(expected) = f["hashes"]["sha512"].as_str() {
                            if sha512_hex(&body) != expected {
                                return Err(format!("{} n'a pas le bon sha512", path.display()));
                            }
                        }
                        write_file(&dir.join(path), &body)
                    })();
                    if let Err(e) = got {
                        failed.lock().unwrap().get_or_insert(e);
                    }
                    report("Fichiers du modpack", done.fetch_add(1, Relaxed) + 1, files.len());
                }
            });
        }
    });
    if let Some(e) = failed.into_inner().unwrap() {
        return Err(e);
    }
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else { continue };
        let rest: PathBuf = match name.strip_prefix("overrides").or_else(|_| name.strip_prefix("client-overrides")) {
            Ok(rest) if !rest.as_os_str().is_empty() => rest.to_path_buf(),
            _ => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        write_file(&dir.join(rest), &data)?;
    }
    Ok(instance)
}
