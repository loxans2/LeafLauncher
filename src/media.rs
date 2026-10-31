//! La musique en cours sur l'ordinateur, par les contrôles multimédias de Windows (ceux du volume
//! et de la Game Bar) : Spotify, Deezer, Apple Music, YouTube dans le navigateur… sans clé d'API.
//! Le launcher lit le titre, l'artiste, la pochette et la progression, et peut mettre en pause,
//! passer au suivant ou au précédent.

use serde_json::{json, Value};

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;

    fn err(e: windows::core::Error) -> String {
        e.message().to_string()
    }

    fn manager() -> Result<Manager, String> {
        Manager::RequestAsync().map_err(err)?.join().map_err(err)
    }

    /// Un nom lisible pour l'application (`Spotify.exe`, `SpotifyAB.SpotifyMusic_…!Spotify`…).
    fn app_name(id: &str) -> String {
        let id = id.rsplit('!').next().unwrap_or(id);
        let id = id.trim_end_matches(".exe");
        let known = [
            ("spotify", "Spotify"),
            ("liner", "Liner"),
            ("deezer", "Deezer"),
            ("applemusic", "Apple Music"),
            ("itunes", "iTunes"),
            ("msedge", "Microsoft Edge"),
            ("chrome", "Google Chrome"),
            ("firefox", "Firefox"),
            ("brave", "Brave"),
            ("opera", "Opera"),
            ("zunemusic", "Lecteur multimédia"),
            ("tidal", "TIDAL"),
            ("soundcloud", "SoundCloud"),
            ("youtube", "YouTube Music"),
            ("vlc", "VLC"),
        ];
        let lower = id.to_lowercase();
        known
            .iter()
            .find(|(k, _)| lower.contains(k))
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| id.split('.').next_back().unwrap_or(id).to_string())
    }

    fn sessions(mgr: &Manager) -> Vec<Session> {
        mgr.GetSessions().map(|list| list.into_iter().collect()).unwrap_or_default()
    }

    /// La session choisie (par son application), sinon celle que Windows met en avant.
    fn pick(mgr: &Manager, app: &str) -> Option<Session> {
        let all = sessions(mgr);
        if !app.is_empty() {
            if let Some(s) = all.iter().find(|s| s.SourceAppUserModelId().map(|id| id.to_string() == app).unwrap_or(false)) {
                return Some(s.clone());
            }
        }
        mgr.GetCurrentSession().ok().or_else(|| all.into_iter().next())
    }

    fn thumbnail(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        let reference = props.Thumbnail().ok()?;
        let stream = reference.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 4_000_000 {
            return None;
        }
        let kind = stream.ContentType().map(|c| c.to_string()).unwrap_or_default();
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size).ok()?.join().ok()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        let kind = if kind.starts_with("image/") { kind } else { "image/png".into() };
        Some(format!("data:{kind};base64,{}", crate::net::b64(&bytes)))
    }

    pub fn now_playing(app: &str, known_cover: &str) -> Result<Value, String> {
        let mgr = manager()?;
        let apps: Vec<Value> = sessions(&mgr)
            .iter()
            .filter_map(|s| s.SourceAppUserModelId().ok().map(|id| id.to_string()))
            .map(|id| json!({ "id": id, "name": app_name(&id) }))
            .collect();
        let Some(session) = pick(&mgr, app) else {
            return Ok(json!({ "active": false, "apps": apps }));
        };
        let id = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
        let props = session.TryGetMediaPropertiesAsync().map_err(err)?.join().map_err(err)?;
        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
        let status = session.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()).unwrap_or(Status::Closed);
        let timeline = session.GetTimelineProperties().ok();
        let ms = |t: windows::Foundation::TimeSpan| t.Duration / 10_000;
        let position = timeline.as_ref().and_then(|t| t.Position().ok()).map(ms).unwrap_or(0);
        let end = timeline.as_ref().and_then(|t| t.EndTime().ok()).map(ms).unwrap_or(0);
        let updated = timeline.as_ref().and_then(|t| t.LastUpdatedTime().ok()).map(|d| d.UniversalTime).unwrap_or(0);
        // La pochette n'est renvoyée que quand le morceau change.
        let key = format!("{id}|{title}|{artist}");
        let cover = if key == known_cover { Value::Null } else { thumbnail(&props).map(Value::from).unwrap_or(Value::Null) };
        // Position extrapolée depuis la dernière mise à jour de l'application (Spotify ne la
        // rafraîchit que de temps en temps).
        let filetime_now = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
            + 11_644_473_600_000)
            * 10_000;
        let playing = status == Status::Playing;
        let position = if playing && updated > 0 {
            (position + (filetime_now - updated) / 10_000).clamp(0, end.max(position))
        } else {
            position
        };
        Ok(json!({
            "active": !title.is_empty() || playing,
            "app": id,
            "app_name": app_name(&id),
            "title": title,
            "artist": artist,
            "album": album,
            "playing": playing,
            "position": position,
            "duration": end,
            "key": key,
            "cover": cover,
            "apps": apps,
        }))
    }

    pub fn control(app: &str, action: &str) -> Result<(), String> {
        let mgr = manager()?;
        let session = pick(&mgr, app).ok_or("Aucune musique en cours")?;
        let ok = match action {
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            _ => return Err("Action inconnue".into()),
        }
        .map_err(err)?
        .join()
        .map_err(err)?;
        if ok {
            Ok(())
        } else {
            Err("L'application de musique a refusé l'action".into())
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn now_playing(_app: &str, _known: &str) -> Result<Value, String> {
        Ok(json!({ "active": false, "apps": [] }))
    }
    pub fn control(_app: &str, _action: &str) -> Result<(), String> {
        Err("Disponible sous Windows seulement".into())
    }
}

pub use imp::{control, now_playing};

#[cfg(test)]
mod tests {
    /// Affiche la musique en cours sur ce PC. `cargo test --release -- --ignored --nocapture now_playing`
    #[test]
    #[ignore]
    fn now_playing() {
        let mut info = super::now_playing("", "").expect("contrôles multimédias de Windows");
        if let Some(cover) = info["cover"].as_str() {
            info["cover"] = format!("{}… ({} caractères)", &cover[..cover.len().min(30)], cover.len()).into();
        }
        println!("{}", serde_json::to_string_pretty(&info).unwrap());
    }
}
