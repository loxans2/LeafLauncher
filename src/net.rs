//! HTTP : un agent partagé (TLS du système), les fichiers entiers, le JSON et les formulaires.

use serde_json::Value;
use std::io::Read;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

static AGENT: OnceLock<ureq::Agent> = OnceLock::new();

fn agent() -> &'static ureq::Agent {
    AGENT.get_or_init(|| {
        let mut builder = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(60))
            .user_agent(concat!("LeafLauncher/", env!("CARGO_PKG_VERSION")));
        if let Ok(tls) = native_tls::TlsConnector::new() {
            builder = builder.tls_connector(Arc::new(tls));
        }
        builder.build()
    })
}

fn body(url: &str, resp: ureq::Response) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    resp.into_reader()
        .take(1 << 31)
        .read_to_end(&mut buf)
        .map_err(|e| format!("{url} : {e}"))?;
    Ok(buf)
}

/// Le corps entier d'une réponse 200.
pub fn get(url: &str) -> Result<Vec<u8>, String> {
    let resp = agent().get(url).call().map_err(|e| describe(url, e))?;
    body(url, resp)
}

pub fn get_json(url: &str) -> Result<Value, String> {
    serde_json::from_slice(&get(url)?).map_err(|e| format!("{url} : {e}"))
}

/// GET avec un jeton ; renvoie le statut et le JSON (une 404 n'est pas une erreur ici).
pub fn get_json_bearer(url: &str, token: &str) -> Result<(u16, Value), String> {
    let got = agent()
        .get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/json")
        .call();
    status_and_json(url, got)
}

/// POST d'un JSON ; renvoie le statut et le JSON de la réponse, même pour une erreur HTTP.
pub fn post_json(url: &str, payload: &Value) -> Result<(u16, Value), String> {
    let got = agent()
        .post(url)
        .set("Accept", "application/json")
        .send_json(payload.clone());
    status_and_json(url, got)
}

/// POST d'un formulaire (OAuth) ; statut et JSON, même pour une erreur HTTP.
pub fn post_form(url: &str, form: &[(&str, &str)]) -> Result<(u16, Value), String> {
    let got = agent().post(url).send_form(form);
    status_and_json(url, got)
}

fn status_and_json(url: &str, got: Result<ureq::Response, ureq::Error>) -> Result<(u16, Value), String> {
    let resp = match got {
        Ok(resp) => resp,
        Err(ureq::Error::Status(_, resp)) => resp,
        Err(e) => return Err(describe(url, e)),
    };
    let status = resp.status();
    let bytes = body(url, resp)?;
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Ok((status, json))
}

fn describe(url: &str, e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => format!("{url} : HTTP {code}"),
        ureq::Error::Transport(t) => format!("{url} : pas de connexion ({t})"),
    }
}

/// Encode une valeur pour une URL (tout sauf les caractères non réservés).
pub fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Décode une valeur d'URL (`%XX` et `+`).
pub fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
        match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(v)) => {
                out.push(v);
                i += 3;
                continue;
            }
            (b'+', _) => out.push(b' '),
            (b, _) => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Les octets de `n` aléatoires, encodés en base64url sans remplissage.
pub fn random_b64(n: usize) -> String {
    let mut buf = vec![0u8; n];
    let _ = getrandom::getrandom(&mut buf);
    b64url(&buf)
}

pub fn b64url(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, &b)| n | (b as u32) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}
