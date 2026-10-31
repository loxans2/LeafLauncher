//! Discord Rich Presence par l'IPC local de Discord (le tube `discord-ipc-N`), sans dépendance :
//! une poignée de main avec l'application Discord (son ID), puis `SET_ACTIVITY` à chaque
//! changement. Un fil à part s'en occupe : il se reconnecte quand Discord est relancé et ne bloque
//! jamais le launcher.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Config {
    pub enabled: bool,
    pub app_id: String,
    /// Clé d'une image de l'application Discord, ou une URL https.
    pub image: String,
    /// L'adresse du serveur mis en avant (`play.leafsmp.fr`).
    pub server: String,
    pub button_label: String,
    pub button_url: String,
    pub button2_label: String,
    pub button2_url: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Presence {
    pub details: String,
    pub state: String,
    /// Début (secondes Unix) : Discord affiche le temps écoulé.
    pub start: u64,
    pub small_text: String,
}

enum Msg {
    Config(Config),
    Presence(Presence),
}

static TX: OnceLock<Sender<Msg>> = OnceLock::new();

fn sender() -> &'static Sender<Msg> {
    TX.get_or_init(|| {
        let (tx, rx) = channel::<Msg>();
        std::thread::spawn(move || {
            let mut config = Config::default();
            let mut presence = Presence::default();
            let mut pipe: Option<std::fs::File> = None;
            let mut dirty = true;
            loop {
                match rx.recv_timeout(Duration::from_secs(20)) {
                    Ok(Msg::Config(c)) => {
                        if c.app_id != config.app_id {
                            pipe = None;
                        }
                        dirty |= c != config;
                        config = c;
                    }
                    Ok(Msg::Presence(p)) => {
                        dirty |= p != presence;
                        presence = p;
                    }
                    // Toutes les 20 s : se reconnecter si Discord vient de démarrer.
                    Err(RecvTimeoutError::Timeout) => dirty |= pipe.is_none(),
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                if !dirty {
                    continue;
                }
                let active = config.enabled && !config.app_id.trim().is_empty();
                if !active {
                    if let Some(p) = pipe.as_mut() {
                        let _ = set_activity(p, Value::Null);
                    }
                    pipe = None;
                    dirty = false;
                    continue;
                }
                if pipe.is_none() {
                    pipe = connect(config.app_id.trim());
                }
                if let Some(p) = pipe.as_mut() {
                    if set_activity(p, activity(&config, &presence)).is_ok() {
                        dirty = false;
                    } else {
                        pipe = None;
                    }
                }
            }
        });
        tx
    })
}

pub fn configure(config: Config) {
    let _ = sender().send(Msg::Config(config));
}

pub fn show(presence: Presence) {
    let _ = sender().send(Msg::Presence(presence));
}

fn activity(config: &Config, presence: &Presence) -> Value {
    let mut buttons = Vec::new();
    for (label, url) in [
        (&config.button_label, &config.button_url),
        (&config.button2_label, &config.button2_url),
    ] {
        if !label.trim().is_empty() && url.starts_with("https://") {
            buttons.push(json!({ "label": label.trim().chars().take(32).collect::<String>(), "url": url.trim() }));
        }
    }
    let mut assets = json!({});
    if !config.image.trim().is_empty() {
        assets["large_image"] = config.image.trim().into();
        assets["large_text"] = if config.server.is_empty() {
            "Leaf Launcher".into()
        } else {
            format!("Rejoins-nous : {}", config.server).into()
        };
    }
    if !presence.small_text.is_empty() {
        assets["small_text"] = presence.small_text.clone().into();
    }
    let mut activity = json!({
        "details": clip(&presence.details),
        "state": clip(&presence.state),
        "assets": assets,
        "instance": false,
    });
    if presence.start > 0 {
        activity["timestamps"] = json!({ "start": presence.start });
    }
    if !buttons.is_empty() {
        activity["buttons"] = Value::Array(buttons);
    }
    activity
}

/// Discord refuse les textes de moins de 2 ou plus de 128 caractères.
fn clip(text: &str) -> String {
    let text: String = text.chars().take(128).collect();
    if text.chars().count() < 2 {
        format!("{text}  ")
    } else {
        text
    }
}

fn frame(pipe: &mut std::fs::File, op: u32, payload: &Value) -> Result<Value, String> {
    let body = payload.to_string();
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body.as_bytes());
    pipe.write_all(&out).map_err(|e| e.to_string())?;
    let mut header = [0u8; 8];
    pipe.read_exact(&mut header).map_err(|e| e.to_string())?;
    let len = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    let mut reply = vec![0u8; len.min(1 << 20)];
    pipe.read_exact(&mut reply).map_err(|e| e.to_string())?;
    let op = u32::from_le_bytes(header[0..4].try_into().unwrap());
    if op == 2 {
        return Err("Discord a fermé la connexion".into());
    }
    Ok(serde_json::from_slice(&reply).unwrap_or(Value::Null))
}

fn connect(app_id: &str) -> Option<std::fs::File> {
    for n in 0..10 {
        let path = if cfg!(windows) {
            format!(r"\\.\pipe\discord-ipc-{n}")
        } else {
            let dir = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
                .iter()
                .find_map(|k| std::env::var(k).ok())
                .unwrap_or_else(|| "/tmp".into());
            format!("{dir}/discord-ipc-{n}")
        };
        let Some(mut pipe) = open_pipe(&path) else {
            continue;
        };
        if frame(&mut pipe, 0, &json!({ "v": 1, "client_id": app_id })).is_ok() {
            return Some(pipe);
        }
    }
    None
}

/// Ouvre le tube de Discord (`\\.\pipe\discord-ipc-N` sous Windows, par CreateFileW).
#[cfg(windows)]
fn open_pipe(path: &str) -> Option<std::fs::File> {
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, OPEN_EXISTING};
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let handle = unsafe {
        CreateFileW(wide.as_ptr(), GENERIC_READ | GENERIC_WRITE, 0, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut())
    };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }
    Some(unsafe { std::fs::File::from_raw_handle(handle as _) })
}

#[cfg(not(windows))]
fn open_pipe(path: &str) -> Option<std::fs::File> {
    std::fs::OpenOptions::new().read(true).write(true).open(path).ok()
}

fn set_activity(pipe: &mut std::fs::File, activity: Value) -> Result<(), String> {
    let reply = frame(
        pipe,
        1,
        &json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": crate::config::new_id(),
        }),
    )?;
    if reply["evt"] == "ERROR" {
        return Err(reply["data"]["message"].as_str().unwrap_or("erreur Discord").into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parle au vrai Discord local avec un ID invalide : il doit répondre et refuser.
    /// `cargo test --release -- --ignored --nocapture discord_ipc`
    #[test]
    #[ignore]
    fn discord_ipc() {
        let mut pipe = open_pipe(r"\\.\pipe\discord-ipc-0").expect("Discord ne tourne pas");
        let reply = frame(&mut pipe, 0, &json!({ "v": 1, "client_id": "1" }));
        println!("Réponse de Discord : {reply:?}");
        assert!(reply.is_err(), "un ID invalide doit être refusé");
    }
}
