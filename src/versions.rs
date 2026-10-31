//! La liste des versions de Minecraft publiée par Mojang (piston-meta), gardée en cache pour
//! jouer sans connexion, et le fichier de chaque version, vérifié contre le sha1 de la liste.

use crate::config::data_dir;
use crate::files::{read_json, relative, sha1_file, sha1_hex, write_file};
use crate::net;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Serialize, Clone, Debug)]
pub struct Version {
    pub id: String,
    /// `release`, `snapshot`, `old_beta`, `old_alpha`.
    pub kind: String,
    pub released: String,
    #[serde(skip)]
    pub url: String,
    #[serde(skip)]
    pub sha1: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Manifest {
    pub latest_release: String,
    pub latest_snapshot: String,
    pub versions: Vec<Version>,
    /// Lue depuis le cache, faute de connexion.
    pub offline: bool,
}

fn cache() -> PathBuf {
    data_dir().join("cache").join("version_manifest_v2.json")
}

fn parse(json: &Value, offline: bool) -> Result<Manifest, String> {
    let versions = json["versions"]
        .as_array()
        .ok_or("La liste des versions de Mojang est vide")?
        .iter()
        .filter_map(|v| {
            Some(Version {
                id: v["id"].as_str()?.to_string(),
                kind: v["type"].as_str().unwrap_or("release").to_string(),
                released: v["releaseTime"].as_str().unwrap_or_default().to_string(),
                url: v["url"].as_str()?.to_string(),
                sha1: v["sha1"].as_str().unwrap_or_default().to_string(),
            })
        })
        .collect();
    Ok(Manifest {
        latest_release: json["latest"]["release"].as_str().unwrap_or_default().into(),
        latest_snapshot: json["latest"]["snapshot"].as_str().unwrap_or_default().into(),
        versions,
        offline,
    })
}

/// La liste, depuis Mojang (puis gardée), ou depuis le cache quand Mojang ne répond pas.
pub fn manifest(prefer_cache: bool) -> Result<Manifest, String> {
    let path = cache();
    if prefer_cache {
        if let Ok(json) = read_json(&path) {
            return parse(&json, false);
        }
    }
    match net::get(MANIFEST) {
        Ok(bytes) => {
            let json: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            let _ = write_file(&path, &bytes);
            parse(&json, false)
        }
        Err(e) => match read_json(&path) {
            Ok(json) => parse(&json, true),
            Err(_) => Err(e),
        },
    }
}

/// Le fichier de version de `id` dans `minecraft/versions/<id>/<id>.json`, téléchargé s'il manque
/// ou n'a pas le sha1 que donne la liste.
pub fn version_json(id: &str, minecraft: &Path) -> Result<PathBuf, String> {
    let path = minecraft
        .join("versions")
        .join(relative(id)?)
        .join(format!("{id}.json"));
    let list = manifest(path.is_file())?;
    let Some(version) = list.versions.iter().find(|v| v.id == id) else {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("Mojang ne publie pas de version {id}"));
    };
    if version.sha1.is_empty() || sha1_file(&path).as_deref() == Some(version.sha1.as_str()) {
        if path.is_file() {
            return Ok(path);
        }
    }
    match net::get(&version.url) {
        Ok(body) => {
            let actual = sha1_hex(&body);
            if !version.sha1.is_empty() && actual != version.sha1 {
                return Err(format!(
                    "Le fichier de la version {id} n'est pas celui de Mojang (sha1 {actual})"
                ));
            }
            write_file(&path, &body)?;
            Ok(path)
        }
        // Sans connexion, un fichier déjà là suffit.
        Err(_) if path.is_file() => Ok(path),
        Err(e) => Err(e),
    }
}

/// Les versions déjà téléchargées (celles qui ont leur client).
pub fn installed(minecraft: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(minecraft.join("versions")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().into_owned();
            e.path().join(".leaf-complete").is_file().then_some(id)
        })
        .collect()
}
