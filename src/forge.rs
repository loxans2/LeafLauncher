//! Forge et NeoForge. Leurs versions viennent de leurs dépôts Maven ; l'installation lance leur
//! installateur officiel en mode client (`--installClient`) sur le dossier du jeu, comme le
//! launcher officiel : il écrit `versions/<id>/<id>.json` (qui `inheritsFrom` la version de
//! Minecraft) et les bibliothèques, en exécutant ses processeurs. `launch::resolve` fusionne ensuite
//! le profil comme celui de Fabric.

use crate::files::{relative, write_file};
use crate::loaders::Listed;
use crate::net;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};

const FORGE_META: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const FORGE_PROMOS: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEO_META: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const NEO_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";

pub fn is_forge_like(loader: &str) -> bool {
    matches!(loader, "forge" | "neoforge")
}

/// Le préfixe des versions NeoForge d'une version de Minecraft : `1.21.1` → `21.1.`,
/// `1.21` → `21.0.`, `26.3` → `26.3.0.`, `26.1.2` → `26.1.2.`.
fn neo_prefix(minecraft: &str) -> String {
    match minecraft.strip_prefix("1.") {
        Some(rest) if rest.contains('.') => format!("{rest}."),
        Some(rest) => format!("{rest}.0."),
        None if minecraft.matches('.').count() == 1 => format!("{minecraft}.0."),
        None => format!("{minecraft}."),
    }
}

/// Les versions du loader pour `minecraft`, la plus récente d'abord ; la recommandée de Forge
/// est marquée stable, les bêtas de NeoForge ne le sont pas.
pub fn versions(loader: &str, minecraft: &str) -> Result<Vec<Listed>, String> {
    let mut listed: Vec<Listed> = match loader {
        "forge" => {
            let meta = net::get_json(FORGE_META)?;
            let recommended = net::get_json(FORGE_PROMOS)
                .ok()
                .and_then(|p| p["promos"][format!("{minecraft}-recommended")].as_str().map(String::from));
            meta[minecraft]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|full| Listed {
                    stable: recommended
                        .as_deref()
                        .is_none_or(|r| full.ends_with(&format!("-{r}"))),
                    version: full.to_string(),
                })
                .collect()
        }
        "neoforge" => {
            let meta = net::get_json(NEO_META)?;
            let prefix = neo_prefix(minecraft);
            meta["versions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|v| v.starts_with(&prefix))
                .map(|v| Listed { stable: !v.contains("beta"), version: v.to_string() })
                .collect()
        }
        _ => return Err(format!("Loader inconnu : {loader}")),
    };
    listed.reverse();
    if listed.is_empty() {
        return Err(format!(
            "{} n'existe pas encore pour Minecraft {minecraft}.",
            name(loader)
        ));
    }
    Ok(listed)
}

pub fn name(loader: &str) -> &'static str {
    if loader == "neoforge" {
        "NeoForge"
    } else {
        "Forge"
    }
}

/// La version voulue, ou la recommandée (sinon la plus récente).
pub fn pick(loader: &str, minecraft: &str, wanted: Option<&str>) -> Result<String, String> {
    if let Some(v) = wanted.filter(|v| !v.is_empty() && *v != "latest") {
        return Ok(v.to_string());
    }
    let listed = versions(loader, minecraft)?;
    Ok(listed
        .iter()
        .find(|l| l.stable)
        .or(listed.first())
        .map(|l| l.version.clone())
        .unwrap())
}

/// L'id de profil que l'installateur écrira, lu dans son `install_profile.json`.
fn profile_id(installer: &Path) -> Result<String, String> {
    let file = std::fs::File::open(installer).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("installateur : {e}"))?;
    let mut text = String::new();
    zip.by_name("install_profile.json")
        .map_err(|e| format!("installateur sans install_profile.json : {e}"))?
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    let profile: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    profile["version"]
        .as_str()
        .or(profile["versionInfo"]["id"].as_str())
        .map(String::from)
        .ok_or("L'installateur ne donne pas l'id de sa version".into())
}

/// Installe `version` du loader dans le dossier du jeu avec `java` ; renvoie l'id du profil.
pub fn install(
    loader: &str,
    version: &str,
    minecraft_dir: &Path,
    java: &Path,
    log: &(dyn Fn(String) + Sync),
) -> Result<String, String> {
    relative(version)?;
    let url = match loader {
        "forge" => format!("{FORGE_MAVEN}/{version}/forge-{version}-installer.jar"),
        _ => format!("{NEO_MAVEN}/{version}/neoforge-{version}-installer.jar"),
    };
    let installer = crate::config::data_dir()
        .join("cache")
        .join("installers")
        .join(format!("{loader}-{version}-installer.jar"));
    if !installer.is_file() {
        log(format!("Téléchargement de l'installateur {} {version}", name(loader)));
        write_file(&installer, &net::get(&url)?)?;
    }
    let id = profile_id(&installer)?;
    let profile = minecraft_dir.join("versions").join(relative(&id)?).join(format!("{id}.json"));
    if profile.is_file() {
        return Ok(id);
    }
    // L'installateur veut un dossier du launcher officiel : il lui faut launcher_profiles.json.
    let profiles = minecraft_dir.join("launcher_profiles.json");
    if !profiles.is_file() {
        write_file(&profiles, br#"{"profiles":{},"selectedProfile":null}"#)?;
    }
    log(format!("Installation de {} {version} (cela peut prendre une minute)", name(loader)));
    let mut cmd = Command::new(java);
    cmd.arg("-jar")
        .arg(&installer)
        .arg("--installClient")
        .arg(minecraft_dir)
        .current_dir(installer.parent().unwrap())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Java : {e}"))?;
    let err = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || {
        BufReader::new(err).lines().map_while(Result::ok).collect::<Vec<_>>()
    });
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        if !line.trim().is_empty() && !line.starts_with("  ") {
            log(format!("{}: {line}", name(loader)));
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let errors = errors.join().unwrap_or_default();
    if !status.success() || !profile.is_file() {
        let last = errors.iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_default();
        return Err(format!("L'installateur {} a échoué ({status}) {last}", name(loader)));
    }
    Ok(id)
}
