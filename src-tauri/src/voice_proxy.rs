//! Voice-mode WebSocket proxy for Tauri production.
//!
//! The web build runs behind the Vite dev plugin (`vite-plugins/volcAsrProxyPlugin.ts`,
//! `vite-plugins/minimaxTtsProxyPlugin.ts`) which mints opaque tokens server-side and
//! bridges WebSocket frames. Tauri production does not include those plugins, so this
//! module spins up a localhost axum server bound to 127.0.0.1 on an OS-assigned port
//! that exposes the same protocol.
//!
//! Routes:
//!   - `POST /volc-asr/issue-token`     body: `{apiKey?, appId?, accessToken?}` → `{token, expiresIn}`
//!   - `POST /volc-asr/recognize-flash` body: `{apiKey?, format, data}` → `{text}` (file ASR)
//!   - `WS   /volc-asr/ws?token=…&resourceId=…&requestId=…` → bridges to `openspeech.bytedance.com`
//!   - `POST /minimax-tts/issue-token`  body: `{apiKey}` → `{token, expiresIn}`
//!   - `WS   /minimax-tts/ws?token=…`   → bridges to `api.minimaxi.com` with `Authorization: Bearer`
//!
//! Only invoked for callers that are **not** in the server-managed (Supabase Edge
//! Function) path; logged-in users route through `ai-volc-asr-ws` etc. instead.
//!
//! The frontend asks Tauri for the bound port via [`voice_proxy_port`].

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::routing::{any, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as TMessage;
use uuid::Uuid;

/// Default TTL for minted tokens. Matches the Vite plugin's TTL so callers
/// don't see different expiry windows between web and desktop.
const TOKEN_TTL: Duration = Duration::from_secs(10 * 60);

/// Upstream endpoints. Same as `vite-plugins/volcAsrProxyPlugin.ts` /
/// `minimaxTtsProxyPlugin.ts`.
const VOLC_ASR_UPSTREAM: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const VOLC_ASR_FLASH_UPSTREAM: &str =
    "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const VOLC_ASR_FLASH_RESOURCE_ID: &str = "volc.bigasr.auc_turbo";
const VOLC_ASR_FLASH_MAX_BODY: usize = 28 * 1024 * 1024;
const MINIMAX_TTS_UPSTREAM: &str = "wss://api.minimaxi.com/ws/v1/t2a_v2";

// ─── Token store ───────────────────────────────────────────────────────

#[derive(Debug)]
enum VolcCreds {
    NewConsole { api_key: String },
    Legacy { app_id: String, access_token: String },
}

#[derive(Debug)]
enum MiniMaxCreds {
    Bearer { api_key: String },
}

#[derive(Debug)]
struct VolcEntry {
    creds: VolcCreds,
    expires_at: Instant,
}

#[derive(Debug)]
struct MiniMaxEntry {
    creds: MiniMaxCreds,
    expires_at: Instant,
}

#[derive(Default)]
pub(crate) struct TokenStore {
    volc: Mutex<HashMap<String, VolcEntry>>,
    minimax: Mutex<HashMap<String, MiniMaxEntry>>,
}

impl TokenStore {
    fn issue_volc(&self, creds: VolcCreds) -> String {
        let token = Uuid::new_v4().to_string();
        self.volc.lock().insert(
            token.clone(),
            VolcEntry {
                creds,
                expires_at: Instant::now() + TOKEN_TTL,
            },
        );
        token
    }

    fn issue_minimax(&self, creds: MiniMaxCreds) -> String {
        let token = Uuid::new_v4().to_string();
        self.minimax.lock().insert(
            token.clone(),
            MiniMaxEntry {
                creds,
                expires_at: Instant::now() + TOKEN_TTL,
            },
        );
        token
    }

    fn take_volc(&self, token: &str) -> Option<VolcCreds> {
        let mut map = self.volc.lock();
        let entry = map.remove(token)?;
        if entry.expires_at <= Instant::now() {
            return None;
        }
        Some(entry.creds)
    }

    fn take_minimax(&self, token: &str) -> Option<MiniMaxCreds> {
        let mut map = self.minimax.lock();
        let entry = map.remove(token)?;
        if entry.expires_at <= Instant::now() {
            return None;
        }
        Some(entry.creds)
    }

    /// Periodic sweep so old entries don't accumulate forever.
    fn sweep(&self) {
        let now = Instant::now();
        self.volc.lock().retain(|_, e| e.expires_at > now);
        self.minimax.lock().retain(|_, e| e.expires_at > now);
    }
}

// ─── Shared app state ───────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    tokens: Arc<TokenStore>,
}

// ─── HTTP / WS handlers ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct VolcIssueBody {
    apiKey: Option<String>,
    appId: Option<String>,
    accessToken: Option<String>,
    resourceId: Option<String>,
}

#[derive(Serialize)]
struct IssueResponse {
    token: String,
    expiresIn: u64,
}

async fn volc_issue(
    State(state): State<AppState>,
    Json(body): Json<VolcIssueBody>,
) -> Result<Json<IssueResponse>, (axum::http::StatusCode, String)> {
    let api_key = body.apiKey.as_deref().unwrap_or("").trim().to_string();
    let app_id = body.appId.as_deref().unwrap_or("").trim().to_string();
    let access_token = body.accessToken.as_deref().unwrap_or("").trim().to_string();
    let creds = if !api_key.is_empty() {
        VolcCreds::NewConsole { api_key }
    } else if !app_id.is_empty() && !access_token.is_empty() {
        VolcCreds::Legacy { app_id, access_token }
    } else {
        return Err((axum::http::StatusCode::BAD_REQUEST, "missing_volc_asr_credentials".into()));
    };
    // Keep resource_id alive by re-issuing it on every WS upgrade via query
    // param — we don't need to store it server-side.
    let _ = body.resourceId;
    Ok(Json(IssueResponse {
        token: state.tokens.issue_volc(creds),
        expiresIn: TOKEN_TTL.as_secs(),
    }))
}

#[derive(Deserialize)]
struct VolcFlashBody {
    apiKey: Option<String>,
    appId: Option<String>,
    accessToken: Option<String>,
    format: Option<String>,
    data: Option<String>,
}

#[derive(Serialize)]
struct FlashOk {
    text: String,
}

#[derive(Serialize)]
struct FlashErr {
    error: String,
}

fn parse_flash_text(body: &serde_json::Value) -> String {
    if let Some(text) = body
        .pointer("/result/text")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return text.to_string();
    }
    let Some(utts) = body.pointer("/result/utterances").and_then(|v| v.as_array()) else {
        return String::new();
    };
    let mut out = String::new();
    for u in utts {
        if let Some(t) = u.get("text").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
            out.push_str(t);
        }
    }
    out
}

async fn volc_flash(
    Json(body): Json<VolcFlashBody>,
) -> Result<Json<FlashOk>, (axum::http::StatusCode, Json<FlashErr>)> {
    let api_key = body.apiKey.as_deref().unwrap_or("").trim().to_string();
    let app_id = body.appId.as_deref().unwrap_or("").trim().to_string();
    let access_token = body.accessToken.as_deref().unwrap_or("").trim().to_string();
    let format = body.format.as_deref().unwrap_or("").trim().to_string();
    let data = body.data.as_deref().unwrap_or("").trim().to_string();
    if data.is_empty() || (api_key.is_empty() && (app_id.is_empty() || access_token.is_empty())) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(FlashErr {
                error: "missing_volc_asr_credentials_or_audio".into(),
            }),
        ));
    }

    let request_id = Uuid::new_v4().to_string();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(FlashErr {
                    error: format!("http_client: {e}"),
                }),
            ));
        }
    };

    let mut req = client.post(VOLC_ASR_FLASH_UPSTREAM);
    req = req
        .header("Content-Type", "application/json")
        .header("X-Api-Resource-Id", VOLC_ASR_FLASH_RESOURCE_ID)
        .header("X-Api-Request-Id", &request_id)
        .header("X-Api-Sequence", "-1");
    if !api_key.is_empty() {
        req = req.header("X-Api-Key", api_key);
    } else {
        req = req
            .header("X-Api-App-Key", app_id)
            .header("X-Api-Access-Key", access_token);
    }

    let payload = serde_json::json!({
        "user": { "uid": "spoor" },
        "audio": { "format": if format.is_empty() { "mp3".into() } else { format }, "data": data },
        "request": { "model_name": "bigmodel", "enable_itn": true, "enable_punc": true },
    });

    let upstream = match req.json(&payload).send().await {
        Ok(r) => r,
        Err(e) => {
            return Err((
                axum::http::StatusCode::BAD_GATEWAY,
                Json(FlashErr {
                    error: format!("upstream_unreachable: {e}"),
                }),
            ));
        }
    };

    let http_status = upstream.status();
    let status_code = upstream
        .headers()
        .get("x-api-status-code")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();
    const OK_CODES: &[&str] = &["", "20000000", "0", "200"];
    let json: serde_json::Value = match upstream.json().await {
        Ok(v) => v,
        Err(e) => {
            return Err((
                axum::http::StatusCode::BAD_GATEWAY,
                Json(FlashErr {
                    error: format!("upstream_json: {e}"),
                }),
            ));
        }
    };

    if !http_status.is_success() || (!OK_CODES.contains(&status_code.as_str()) && !status_code.is_empty()) {
        let msg = json
            .get("message")
            .or_else(|| json.get("msg"))
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("flash_failed");
        let error = if status_code.is_empty() {
            format!("Volc ASR flash HTTP {}: {msg}", http_status.as_u16())
        } else {
            format!("Volc ASR flash error {status_code}: {msg}")
        };
        return Err((
            axum::http::StatusCode::BAD_GATEWAY,
            Json(FlashErr { error }),
        ));
    }

    Ok(Json(FlashOk {
        text: parse_flash_text(&json),
    }))
}

#[derive(Deserialize)]
struct WsUpgradeParams {
    token: Option<String>,
    resourceId: Option<String>,
    requestId: Option<String>,
}

async fn volc_ws(
    State(state): State<AppState>,
    Query(params): Query<WsUpgradeParams>,
    ws: WebSocketUpgrade,
) -> Result<axum::response::Response, axum::http::StatusCode> {
    let token = params.token.as_deref().unwrap_or("").trim().to_string();
    if token.is_empty() {
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    }
    let creds = state.tokens.take_volc(&token).ok_or(axum::http::StatusCode::UNAUTHORIZED)?;
    let resource_id = params
        .resourceId
        .unwrap_or_else(|| "volc.seedasr.sauc.duration".into());
    let request_id = params.requestId.unwrap_or_else(|| Uuid::new_v4().to_string());
    Ok(ws.on_upgrade(move |socket| bridge_volc(socket, creds, resource_id, request_id)))
}

async fn bridge_volc(
    client_socket: WebSocket,
    creds: VolcCreds,
    resource_id: String,
    request_id: String,
) {
    let mut upstream_req = VOLC_ASR_UPSTREAM
        .into_client_request()
        .expect("static URL parses");
    {
        let headers = upstream_req.headers_mut();
        let resource_id_value = HeaderValue::from_str(&resource_id)
            .unwrap_or_else(|_| HeaderValue::from_static("volc.seedasr.sauc.duration"));
        headers.insert("X-Api-Resource-Id", resource_id_value);
        let request_id_value = HeaderValue::from_str(&request_id)
            .unwrap_or_else(|_| HeaderValue::from_static("0"));
        headers.insert("X-Api-Request-Id", request_id_value.clone());
        headers.insert("X-Api-Connect-Id", request_id_value);
        headers.insert("X-Api-Sequence", HeaderValue::from_static("-1"));
        match &creds {
            VolcCreds::NewConsole { api_key } => {
                if let Ok(v) = HeaderValue::from_str(api_key) {
                    headers.insert("X-Api-Key", v);
                }
            }
            VolcCreds::Legacy { app_id, access_token } => {
                if let Ok(v) = HeaderValue::from_str(app_id) {
                    headers.insert("X-Api-App-Key", v);
                }
                if let Ok(v) = HeaderValue::from_str(access_token) {
                    headers.insert("X-Api-Access-Key", v);
                }
            }
        }
    }

    let upstream_result = tokio_tungstenite::connect_async(upstream_req).await;
    let (mut upstream, _upstream_resp) = match upstream_result {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[Spoor voice-proxy] volc upstream connect failed: {e}");
            // Best-effort: send an error message to the webview then drop.
            let (mut sink, _) = client_socket.split();
            let payload = serde_json::json!({ "error": format!("upstream_connect: {e}") }).to_string();
            let _ = sink.send(Message::Text(payload)).await;
            return;
        }
    };

    // Build (sink, stream) for both sides and bridge. tokio-tungstenite's
    // `connect_async` returns only after the WS handshake completes, so the
    // upstream is open by the time we enter the pump loops.
    let (mut client_sink, mut client_stream) = client_socket.split();
    let (mut upstream_sink, mut upstream_stream) = upstream.split();

    // Spawn upstream reader → client writer.
    let client_writer = {
        let mut upstream_stream = upstream_stream;
        let mut client_sink = client_sink;
        tokio::spawn(async move {
            while let Some(msg) = upstream_stream.next().await {
                match msg {
                    Ok(TMessage::Binary(bin)) => {
                        if client_sink.send(Message::Binary(bin)).await.is_err() {
                            break;
                        }
                    }
                    Ok(TMessage::Text(txt)) => {
                        if client_sink.send(Message::Text(txt)).await.is_err() {
                            break;
                        }
                    }
                    Ok(TMessage::Close(_)) => {
                        let _ = client_sink.send(Message::Close(None)).await;
                        break;
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("[Spoor voice-proxy] volc upstream read error: {e}");
                        break;
                    }
                }
            }
        })
    };

    // Pump client → upstream directly.
    while let Some(msg) = client_stream.next().await {
        match msg {
            Ok(Message::Binary(bin)) => {
                if upstream_sink.send(TMessage::Binary(bin)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Text(txt)) => {
                if upstream_sink.send(TMessage::Text(txt)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                let _ = upstream_sink.send(TMessage::Close(None)).await;
                break;
            }
            Ok(_) => {}
            Err(e) => {
                eprintln!("[Spoor voice-proxy] volc client read error: {e}");
                break;
            }
        }
    }

    let _ = client_writer.await;
}

#[derive(Deserialize)]
struct MiniMaxIssueBody {
    apiKey: Option<String>,
}

async fn minimax_issue(
    State(state): State<AppState>,
    Json(body): Json<MiniMaxIssueBody>,
) -> Result<Json<IssueResponse>, (axum::http::StatusCode, String)> {
    let api_key = body.apiKey.as_deref().unwrap_or("").trim().to_string();
    if api_key.is_empty() {
        return Err((axum::http::StatusCode::BAD_REQUEST, "missing_minimax_api_key".into()));
    }
    Ok(Json(IssueResponse {
        token: state.tokens.issue_minimax(MiniMaxCreds::Bearer { api_key }),
        expiresIn: TOKEN_TTL.as_secs(),
    }))
}

async fn minimax_ws(
    State(state): State<AppState>,
    Query(params): Query<WsUpgradeParams>,
    ws: WebSocketUpgrade,
) -> Result<axum::response::Response, axum::http::StatusCode> {
    let token = params.token.as_deref().unwrap_or("").trim().to_string();
    if token.is_empty() {
        return Err(axum::http::StatusCode::UNAUTHORIZED);
    }
    let creds = state
        .tokens
        .take_minimax(&token)
        .ok_or(axum::http::StatusCode::UNAUTHORIZED)?;
    Ok(ws.on_upgrade(move |socket| bridge_minimax(socket, creds)))
}

async fn bridge_minimax(client_socket: WebSocket, creds: MiniMaxCreds) {
    let MiniMaxCreds::Bearer { api_key } = creds;
    let mut upstream_req = MINIMAX_TTS_UPSTREAM
        .into_client_request()
        .expect("static URL parses");
    if let Ok(v) = HeaderValue::from_str(&format!("Bearer {api_key}")) {
        upstream_req.headers_mut().insert("Authorization", v);
    }

    let upstream_result = tokio_tungstenite::connect_async(upstream_req).await;
    let (mut upstream, _resp) = match upstream_result {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[Spoor voice-proxy] minimax upstream connect failed: {e}");
            return;
        }
    };

    let (mut client_sink, mut client_stream) = client_socket.split();
    let (mut upstream_sink, mut upstream_stream) = upstream.split();

    // upstream → client
    let client_writer = tokio::spawn(async move {
        while let Some(msg) = upstream_stream.next().await {
            match msg {
                Ok(TMessage::Text(t)) => {
                    if client_sink.send(Message::Text(t)).await.is_err() {
                        break;
                    }
                }
                Ok(TMessage::Binary(b)) => {
                    if client_sink.send(Message::Binary(b)).await.is_err() {
                        break;
                    }
                }
                Ok(TMessage::Close(_)) => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    // client → upstream
    while let Some(msg) = client_stream.next().await {
        match msg {
            Ok(Message::Text(t)) => {
                if upstream_sink.send(TMessage::Text(t)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Binary(b)) => {
                if upstream_sink.send(TMessage::Binary(b)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                let _ = upstream_sink.send(TMessage::Close(None)).await;
                break;
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = client_writer.await;
}

// ─── Server lifecycle ──────────────────────────────────────────────────

/// Bind to 127.0.0.1 on an OS-assigned port, run the server, and report the
/// bound TCP address back through `bound_tx` so the caller can publish it to
/// the webview. The server runs until the process exits.
pub(crate) async fn run_with_port_slot(
    bound_tx: oneshot::Sender<SocketAddr>,
    port_slot: Arc<Mutex<Option<u16>>>,
) {
    let state = AppState {
        tokens: Arc::new(TokenStore::default()),
    };

    let flash = Router::new()
        .route("/volc-asr/recognize-flash", post(volc_flash))
        .layer(DefaultBodyLimit::max(VOLC_ASR_FLASH_MAX_BODY));

    let app = Router::new()
        .merge(flash)
        .route("/volc-asr/issue-token", post(volc_issue))
        .route("/volc-asr/ws", any(volc_ws))
        .route("/minimax-tts/issue-token", post(minimax_issue))
        .route("/minimax-tts/ws", any(minimax_ws))
        .with_state(state.clone());

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[Spoor voice-proxy] bind failed: {e}");
            return;
        }
    };
    let addr = listener.local_addr().unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap());

    // Spawn periodic sweeper so old tokens don't accumulate.
    let sweep_state = state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            sweep_state.tokens.sweep();
        }
    });

    // Report the bound port through both channels.
    let _ = bound_tx.send(addr);
    *port_slot.lock() = Some(addr.port());

    let server = axum::serve(listener, app);
    if let Err(e) = server.await {
        eprintln!("[Spoor voice-proxy] server exited with error: {e}");
    }
}