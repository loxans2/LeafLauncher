//! Les comptes : Microsoft (code d'appareil OAuth, puis Xbox Live, XSTS et Minecraft Services,
//! comme le launcher officiel) et hors ligne (un pseudo et l'UUID que le serveur vanilla lui donne).
//!
//! La connexion Microsoft passe par une application Azure (client ID) autorisée par Mojang pour
//! l'API Minecraft ; elle se règle dans les Paramètres. Les jetons restent dans `accounts.json`,
//! dans le dossier de données de l'utilisateur.

use crate::config::{self, now};
use crate::launch::Player;
use crate::net;
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const DEVICE_CODE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";
const XBL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Account {
    /// `microsoft` ou `offline`.
    pub kind: String,
    pub name: String,
    /// Sans tirets.
    pub uuid: String,
    pub xuid: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub access_token: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub refresh_token: String,
    /// Fin de validité du jeton Minecraft (secondes Unix).
    pub expires_at: u64,
    pub added: u64,
}

/// Ce que l'interface voit d'un compte : jamais les jetons.
#[derive(Serialize, Clone, Debug)]
pub struct Public {
    pub kind: String,
    pub name: String,
    pub uuid: String,
}

impl Account {
    pub fn public(&self) -> Public {
        Public {
            kind: self.kind.clone(),
            name: self.name.clone(),
            uuid: self.uuid.clone(),
        }
    }
}

/// Les comptes, leurs jetons déchiffrés. Des jetons encore en clair (versions d'avant) sont
/// rechiffrés tout de suite.
pub fn accounts() -> Vec<Account> {
    let mut list: Vec<Account> = config::load("accounts.json");
    let mut plain = false;
    for account in &mut list {
        for token in [&mut account.access_token, &mut account.refresh_token] {
            if token.is_empty() {
                continue;
            }
            match vault::unprotect(token) {
                Some(clear) => *token = clear,
                None if token.starts_with(vault::PREFIX) => token.clear(),
                None => plain = true,
            }
        }
    }
    if plain {
        let _ = save(&list);
    }
    list
}

/// Enregistre les comptes, leurs jetons chiffrés pour la session Windows de l'utilisateur.
pub fn save(list: &[Account]) -> Result<(), String> {
    let mut sealed = list.to_vec();
    for account in &mut sealed {
        for token in [&mut account.access_token, &mut account.refresh_token] {
            if !token.is_empty() {
                *token = vault::protect(token).ok_or("Impossible de chiffrer le jeton du compte")?;
            }
        }
    }
    config::save("accounts.json", &sealed)
}

/// Le coffre des jetons : DPAPI sous Windows (seul l'utilisateur de cette session peut les
/// déchiffrer, même si le fichier est copié ailleurs).
mod vault {
    pub const PREFIX: &str = "dpapi:";

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn unhex(text: &str) -> Option<Vec<u8>> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
            .collect()
    }

    #[cfg(windows)]
    fn crypt(data: &[u8], seal: bool) -> Option<Vec<u8>> {
        use windows_sys::Win32::Foundation::LocalFree;
        use windows_sys::Win32::Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        };
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe {
            if seal {
                CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            }
        };
        if ok == 0 || out.pbData.is_null() {
            return None;
        }
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe { LocalFree(out.pbData as _) };
        Some(bytes)
    }

    // Ailleurs, le fichier reste dans le dossier de l'utilisateur (droits du système).
    #[cfg(not(windows))]
    fn crypt(data: &[u8], _seal: bool) -> Option<Vec<u8>> {
        Some(data.to_vec())
    }

    pub fn protect(clear: &str) -> Option<String> {
        crypt(clear.as_bytes(), true).map(|b| format!("{PREFIX}{}", hex(&b)))
    }

    /// Le jeton en clair ; aucun s'il n'était pas chiffré, ou ne se déchiffre pas ici.
    pub fn unprotect(sealed: &str) -> Option<String> {
        let bytes = crypt(&unhex(sealed.strip_prefix(PREFIX)?)?, false)?;
        String::from_utf8(bytes).ok()
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn round_trip() {
            let sealed = super::protect("jeton-secret").unwrap();
            assert!(sealed.starts_with(super::PREFIX));
            assert!(!sealed.contains("jeton-secret"));
            assert_eq!(super::unprotect(&sealed).as_deref(), Some("jeton-secret"));
            assert_eq!(super::unprotect("jeton-en-clair"), None);
        }
    }
}

/// Ajoute ou remplace (même UUID) un compte.
pub fn upsert(account: Account) -> Result<(), String> {
    let mut list = accounts();
    list.retain(|a| a.uuid != account.uuid);
    list.push(account);
    save(&list)
}

/// L'UUID d'un joueur hors ligne : la version 3 du md5 de `OfflinePlayer:<nom>`.
pub fn offline_uuid(name: &str) -> String {
    let mut b: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn valid_name(name: &str) -> bool {
    (3..=16).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

pub fn offline(name: &str) -> Result<Account, String> {
    let name = name.trim();
    if !valid_name(name) {
        return Err("Un pseudo fait 3 à 16 caractères : lettres, chiffres et _.".into());
    }
    Ok(Account {
        kind: "offline".into(),
        name: name.into(),
        uuid: offline_uuid(name),
        xuid: "0".into(),
        added: now(),
        ..Default::default()
    })
}

/// L'application Azure du launcher, intégrée à la compilation (`LEAF_MSA_CLIENT_ID`), comme Prism
/// Launcher ou Horizon intègrent la leur : le joueur n'a rien à régler.
pub const BUILT_IN_CLIENT_ID: Option<&str> = option_env!("LEAF_MSA_CLIENT_ID");

pub fn built_in() -> bool {
    BUILT_IN_CLIENT_ID.is_some_and(|id| !id.trim().is_empty())
}

/// Celle des réglages avancés si elle est donnée, sinon celle du build.
fn client_id() -> Result<String, String> {
    let own = config::settings().ms_client_id.trim().to_string();
    if !own.is_empty() {
        return Ok(own);
    }
    match BUILT_IN_CLIENT_ID.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => Ok(id.to_string()),
        None => Err("Cette version du launcher a été compilée sans application Microsoft \
                     (LEAF_MSA_CLIENT_ID). Utilise une version publiée, ou un compte hors ligne."
            .into()),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval: u64,
    pub expires_in: u64,
}

/// Le code à saisir sur microsoft.com/link.
pub fn start_device_code() -> Result<DeviceCode, String> {
    let id = client_id()?;
    let (status, body) = net::post_form(DEVICE_CODE, &[("client_id", &id), ("scope", SCOPE)])?;
    if status != 200 {
        return Err(oauth_error(&body));
    }
    Ok(DeviceCode {
        user_code: body["user_code"].as_str().unwrap_or_default().into(),
        verification_uri: body["verification_uri"]
            .as_str()
            .unwrap_or("https://www.microsoft.com/link")
            .into(),
        device_code: body["device_code"].as_str().unwrap_or_default().into(),
        interval: body["interval"].as_u64().unwrap_or(5),
        expires_in: body["expires_in"].as_u64().unwrap_or(900),
    })
}

fn oauth_error(body: &Value) -> String {
    let code = body["error"].as_str().unwrap_or("erreur");
    let text = body["error_description"].as_str().unwrap_or("");
    let text = text.lines().next().unwrap_or("");
    format!("Microsoft : {code} {text}").trim().to_string()
}

/// Attend que le joueur ait saisi le code, puis termine la connexion. `cancelled` l'arrête.
pub fn finish_device_code(code: &DeviceCode, cancelled: &dyn Fn() -> bool) -> Result<Account, String> {
    let id = client_id()?;
    let mut interval = code.interval.max(1);
    let deadline = now() + code.expires_in;
    loop {
        for _ in 0..interval * 4 {
            if cancelled() {
                return Err("Connexion annulée.".into());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if now() > deadline {
            return Err("Le code a expiré, recommence la connexion.".into());
        }
        let (status, body) = net::post_form(
            TOKEN,
            &[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("client_id", &id),
                ("device_code", &code.device_code),
            ],
        )?;
        if status == 200 {
            return minecraft_account(&body);
        }
        match body["error"].as_str() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += 5,
            Some("authorization_declined") => return Err("Connexion refusée sur Microsoft.".into()),
            Some("expired_token") => return Err("Le code a expiré, recommence la connexion.".into()),
            _ => return Err(oauth_error(&body)),
        }
    }
}

const AUTHORIZE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";

const DONE_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Leaf Launcher</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#070b0a;color:#e8f3ee;font:16px system-ui">
<div style="text-align:center"><div style="font-size:56px">🌿</div><h1 style="margin:.3em 0">{TITLE}</h1><p style="color:#a7bab2">{TEXT}</p></div>"#;

/// La connexion par le navigateur : la page de connexion Microsoft s'ouvre, puis renvoie vers
/// `http://localhost:<port>` où le launcher attend le code (OAuth avec PKCE). L'application Azure
/// doit avoir `http://localhost` comme URI de redirection (« applications mobiles et de bureau »).
pub fn browser_login(open: &dyn Fn(&str) -> Result<(), String>, cancelled: &dyn Fn() -> bool) -> Result<Account, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    let id = client_id()?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // Le navigateur peut aussi essayer l'IPv6 de localhost.
    let listener6 = TcpListener::bind(("::1", port)).ok();
    for l in std::iter::once(&listener).chain(listener6.iter()) {
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
    }
    let verifier = net::random_b64(48);
    let challenge = net::b64url(&Sha256::digest(verifier.as_bytes()));
    let state = net::random_b64(18);
    let redirect = format!("http://localhost:{port}");
    let url = format!(
        "{AUTHORIZE}?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&code_challenge={challenge}&code_challenge_method=S256&state={state}&prompt=select_account",
        net::enc(&id),
        net::enc(&redirect),
        net::enc(SCOPE)
    );
    open(&url)?;
    let deadline = now() + 600;
    let code = loop {
        if cancelled() {
            return Err("Connexion annulée.".into());
        }
        if now() > deadline {
            return Err("La connexion a pris trop de temps, recommence.".into());
        }
        let accepted = std::iter::once(&listener)
            .chain(listener6.iter())
            .find_map(|l| l.accept().ok());
        let Some((mut stream, _)) = accepted else {
            std::thread::sleep(Duration::from_millis(150));
            continue;
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.split_whitespace().nth(1).unwrap_or("/");
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
        let param = |key: &str| {
            query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == key).map(|(_, v)| net::dec(v)))
        };
        let (title, text, result) = match (param("code"), param("error")) {
            (Some(code), _) if param("state").as_deref() == Some(state.as_str()) => {
                ("Connecté !", "Tu peux fermer cet onglet et revenir au launcher.", Some(Ok(code)))
            }
            (_, Some(error)) => {
                let detail = param("error_description").unwrap_or(error);
                ("Connexion refusée", "Reviens au launcher pour réessayer.", Some(Err(format!("Microsoft : {detail}"))))
            }
            // Une autre requête (favicon…) : on attend la bonne.
            _ => ("Leaf Launcher", "En attente de Microsoft…", None),
        };
        let page = DONE_PAGE.replace("{TITLE}", title).replace("{TEXT}", text);
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
            page.len()
        );
        match result {
            Some(Ok(code)) => break code,
            Some(Err(e)) => return Err(e),
            None => continue,
        }
    };
    let (status, body) = net::post_form(
        TOKEN,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &id),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
            ("scope", SCOPE),
        ],
    )?;
    if status != 200 {
        return Err(oauth_error(&body));
    }
    minecraft_account(&body)
}

/// Du jeton Microsoft au compte Minecraft : Xbox Live, XSTS, Minecraft Services, profil.
fn minecraft_account(oauth: &Value) -> Result<Account, String> {
    let ms_token = oauth["access_token"].as_str().ok_or("Microsoft n'a pas donné de jeton")?;
    let refresh = oauth["refresh_token"].as_str().unwrap_or_default().to_string();
    let (status, xbl) = net::post_json(
        XBL,
        &json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_token}"),
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT",
        }),
    )?;
    if status != 200 {
        return Err(format!("Xbox Live a refusé la connexion (HTTP {status})."));
    }
    let xbl_token = xbl["Token"].as_str().ok_or("Xbox Live n'a pas donné de jeton")?;
    let uhs = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or_default();
    let (status, xsts) = net::post_json(
        XSTS,
        &json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT",
        }),
    )?;
    if status != 200 {
        return Err(match xsts["XErr"].as_u64() {
            Some(2148916233) => "Ce compte Microsoft n'a pas de profil Xbox : crée-le sur xbox.com.".into(),
            Some(2148916235) => "Xbox Live n'est pas disponible dans ce pays.".into(),
            Some(2148916236) | Some(2148916237) => "Ce compte doit être vérifié comme adulte sur xbox.com.".into(),
            Some(2148916238) => "Compte enfant : un adulte doit l'ajouter à une famille Microsoft.".into(),
            _ => format!("XSTS a refusé la connexion (HTTP {status})."),
        });
    }
    let xsts_token = xsts["Token"].as_str().ok_or("XSTS n'a pas donné de jeton")?;
    let xuid = xsts["DisplayClaims"]["xui"][0]["xid"].as_str().unwrap_or("0").to_string();
    let (status, mc) = net::post_json(
        MC_LOGIN,
        &json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts_token}") }),
    )?;
    if status != 200 {
        return Err(format!(
            "Minecraft Services a refusé la connexion (HTTP {status}). L'application Azure \
             doit être autorisée par Mojang pour l'API Minecraft."
        ));
    }
    let token = mc["access_token"].as_str().ok_or("Minecraft n'a pas donné de jeton")?;
    let expires = mc["expires_in"].as_u64().unwrap_or(86400);
    let (status, profile) = net::get_json_bearer(MC_PROFILE, token)?;
    if status == 404 {
        return Err("Ce compte ne possède pas Minecraft: Java Edition.".into());
    }
    if status != 200 {
        return Err(format!("Le profil Minecraft n'a pas pu être lu (HTTP {status})."));
    }
    Ok(Account {
        kind: "microsoft".into(),
        name: profile["name"].as_str().unwrap_or("Joueur").into(),
        uuid: profile["id"].as_str().unwrap_or_default().into(),
        xuid,
        access_token: token.into(),
        refresh_token: refresh,
        expires_at: now() + expires,
        added: now(),
    })
}

/// Un compte Microsoft dont le jeton expire bientôt est renouvelé avec son refresh token.
fn refreshed(account: Account) -> Result<Account, String> {
    if account.kind != "microsoft" || account.expires_at > now() + 300 {
        return Ok(account);
    }
    if account.refresh_token.is_empty() {
        return Err("La session Microsoft a expiré : reconnecte le compte.".into());
    }
    let id = client_id()?;
    let (status, body) = net::post_form(
        TOKEN,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &id),
            ("refresh_token", &account.refresh_token),
            ("scope", SCOPE),
        ],
    )?;
    if status != 200 {
        return Err(format!("La session Microsoft a expiré ({}) : reconnecte le compte.", oauth_error(&body)));
    }
    let mut fresh = minecraft_account(&body)?;
    fresh.added = account.added;
    upsert(fresh.clone())?;
    Ok(fresh)
}

/// Le compte actif, son jeton Microsoft renouvelé au besoin.
pub fn active(uuid: &str) -> Result<Account, String> {
    let account = accounts()
        .into_iter()
        .find(|a| a.uuid == uuid)
        .ok_or("Ajoute un compte (Microsoft ou hors ligne) avant de jouer.")?;
    refreshed(account)
}

/// Le joueur du compte actif, prêt à lancer le jeu.
pub fn player(uuid: &str) -> Result<Player, String> {
    let account = active(uuid)?;
    Ok(Player {
        name: account.name,
        uuid: account.uuid,
        token: if account.kind == "microsoft" { account.access_token } else { "0".into() },
        xuid: account.xuid,
        user_type: if account.kind == "microsoft" { "msa".into() } else { "legacy".into() },
    })
}
