//! Fichiers : sha1, écriture atomique, chemins sûrs et JSON (repris de sources.rs et mojang.rs
//! du launcher Horizon).

use serde_json::Value;
use sha1::{Digest, Sha1};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub fn sha1_hex(data: &[u8]) -> String {
    Sha1::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha1_file(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hash = Sha1::new();
    let mut buffer = vec![0; 1 << 20];
    loop {
        match file.read(&mut buffer).ok()? {
            0 => break,
            n => hash.update(&buffer[..n]),
        }
    }
    Some(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Écrit un fichier entier : un fichier à moitié écrit ne prend jamais sa place.
pub fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let error = |e: std::io::Error| format!("{} : {e}", path.display());
    fs::create_dir_all(path.parent().unwrap()).map_err(error)?;
    let partial = path.with_file_name(format!(
        "{}.partial",
        path.file_name().unwrap().to_string_lossy()
    ));
    fs::write(&partial, data)
        .and_then(|_| fs::rename(&partial, path))
        .map_err(error)
}

/// Un chemin venu d'un fichier de version, refusé s'il pourrait sortir du dossier.
pub fn relative(path: &str) -> Result<PathBuf, String> {
    let safe = !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    safe.then(|| PathBuf::from(path))
        .ok_or_else(|| format!("Chemin dangereux {path:?} dans le fichier de version"))
}

pub fn read_json(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{} : {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{} : {e}", path.display()))
}

pub fn text(v: &Value, key: &str) -> Result<String, String> {
    v[key]
        .as_str()
        .map(String::from)
        .ok_or_else(|| format!("Le fichier de version n'a pas de {key}"))
}

/// Taille d'un dossier, en octets.
pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}
