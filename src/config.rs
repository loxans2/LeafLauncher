//! Les réglages, les instances et les dossiers du launcher, en JSON dans son dossier de données.

use crate::files::write_file;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// `%APPDATA%\LeafLauncher` (ou l'équivalent du système) ; `LEAF_DATA_DIR` s'il est donné, ou
/// `data\` à côté de l'exécutable quand un fichier `portable` s'y trouve (mode portable).
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("LEAF_DATA_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(PathBuf::from)) {
        if exe_dir.join("portable").is_file() {
            return exe_dir.join("data");
        }
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LeafLauncher")
}

/// Les fichiers du jeu partagés par toutes les instances : `versions/`, `libraries/`, `assets/`.
pub fn minecraft_dir() -> PathBuf {
    data_dir().join("minecraft")
}

pub fn runtime_dir() -> PathBuf {
    data_dir().join("runtime")
}

pub fn instance_dir(id: &str) -> PathBuf {
    data_dir().join("instances").join(id)
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn load<T: DeserializeOwned + Default>(name: &str) -> T {
    fs::read_to_string(data_dir().join(name))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save<T: Serialize>(name: &str, value: &T) -> Result<(), String> {
    let text = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_file(&data_dir().join(name), &text)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// Mémoire maximale du jeu (-Xmx), en Mo.
    pub memory_mb: u32,
    /// Mémoire de départ (-Xms), en Mo ; 0 : celle de Java.
    pub min_memory_mb: u32,
    /// Le programme `java` ; vide : le Java de Mojang qui convient à la version.
    pub java_path: String,
    pub jvm_args: String,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    /// Après le lancement : `keep`, `minimize`, `hide` (revient à la fermeture du jeu) ou `close`.
    pub after_launch: String,
    pub open_console: bool,
    pub download_jobs: u32,
    /// Revérifier le sha1 de chaque fichier à chaque lancement.
    pub verify_on_launch: bool,
    pub accent: String,
    pub animations: bool,
    pub particles: bool,
    pub glass: bool,
    pub background: String,
    pub show_snapshots: bool,
    pub show_old: bool,
    /// L'application Azure (client ID) pour la connexion Microsoft.
    pub ms_client_id: String,
    pub selected_instance: String,
    pub active_account: String,
    pub sounds: bool,
    /// Discord Rich Presence : l'application Discord (son ID), l'image et le serveur mis en avant.
    pub discord_rpc: bool,
    pub discord_app_id: String,
    pub discord_image: String,
    pub discord_server: String,
    pub discord_idle: String,
    pub discord_button_label: String,
    pub discord_button_url: String,
    pub discord_button2_label: String,
    pub discord_button2_url: String,
    /// Le thème personnalisé (couleurs, fond, police, rayons…), tel que l'interface le décrit.
    pub theme: serde_json::Value,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            memory_mb: 4096,
            min_memory_mb: 0,
            java_path: String::new(),
            jvm_args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200".into(),
            width: 1280,
            height: 720,
            fullscreen: false,
            after_launch: "minimize".into(),
            open_console: false,
            download_jobs: 16,
            verify_on_launch: false,
            accent: "leaf".into(),
            animations: true,
            particles: true,
            glass: true,
            background: "aurora".into(),
            show_snapshots: false,
            show_old: false,
            ms_client_id: String::new(),
            selected_instance: String::new(),
            active_account: String::new(),
            sounds: true,
            discord_rpc: true,
            discord_app_id: String::new(),
            discord_image: "logo".into(),
            discord_server: "play.leafsmp.fr".into(),
            discord_idle: "Dans le launcher".into(),
            discord_button_label: "Rejoindre LeafSMP".into(),
            discord_button_url: String::new(),
            discord_button2_label: String::new(),
            discord_button2_url: String::new(),
            theme: serde_json::Value::Null,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Instance {
    pub id: String,
    pub name: String,
    /// La version de Minecraft : `26.3`, `1.21.11`, `25w41a`…
    pub version: String,
    /// `vanilla`, `fabric`, `quilt`, `forge` ou `neoforge`.
    pub loader: String,
    /// `java` (Minecraft officiel) ou `horizon` (Minecraft 26.3 réécrit en Rust).
    pub engine: String,
    /// Le modpack Modrinth d'où vient l'instance.
    pub modpack: String,
    /// Vide : la dernière version stable du loader.
    pub loader_version: String,
    pub icon: String,
    /// 0 : les réglages généraux.
    pub memory_mb: u32,
    pub jvm_args: String,
    pub width: u32,
    pub height: u32,
    /// Un serveur à rejoindre dès le lancement (`hôte` ou `hôte:port`).
    pub server: String,
    pub created: u64,
    pub last_played: u64,
    /// Temps de jeu total, en secondes.
    pub playtime: u64,
    pub favorite: bool,
}

pub fn settings() -> Settings {
    load("settings.json")
}

pub fn instances() -> Vec<Instance> {
    load("instances.json")
}

pub fn save_instances(list: &[Instance]) -> Result<(), String> {
    save("instances.json", &list)
}

/// Un identifiant d'instance court et unique.
pub fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos & 0xffff_ffff_ffff)
}
