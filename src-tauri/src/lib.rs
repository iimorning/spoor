mod local_llama;
mod voice_proxy;

use futures_util::StreamExt;
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use local_llama::LocalLlamaChatPayload;

/// State for the localhost voice-mode WS bridge (Tauri production only).
///
/// `shared` is an `Arc<Mutex<Option<u16>>>` written by the proxy server task
/// (once it binds) and read by the `voice_proxy_port` command. Sharing one
/// slot avoids a duplicate copy that could race against the bound port.
struct VoiceProxyState {
    shared: Arc<Mutex<Option<u16>>>,
}

// ─── Server-managed routing (see docs/SUPABASE.md) ────────────────────
//
// The Tauri webview runs the same Vite-built JS as the web build. Logged-in
// users (`useServerKeys` in `src/lib/serverConfig.ts`) hit Supabase Edge
// Functions directly from the webview — `src/services/{ai,volcAsr,
// minimaxTtsStream,search,flux302}.ts` each branch on `isServerManaged()`
// and route the request to `${VITE_SUPABASE_FUNCTIONS_URL}/ai-*` instead of
// invoking a Rust command. The Rust commands below only run for users who
// are NOT logged in (or have opted out of server-managed keys).
//
// `VITE_SUPABASE_FUNCTIONS_URL` is set in `.env.local` and inlined at Vite
// build time, so both `npm run build` (web) and `npm run tauri:build`
// (desktop) pick it up automatically. No `tauri.conf.json` env injection is
// required because the webview reads `import.meta.env` from the bundled JS.
//
// What this file owns:
//   - CORS bypass for non-logged-in users: the LLM and Metaso commands call
//     upstream HTTPS endpoints with the user's local apiKey.
//   - Local GGUF inference (offline desktop path).
//   - Web link unfurl + system browser open (no auth involved).

/// OpenAI-compatible POST to `url` (e.g. Xiaomi MiMo Token Plan: https://token-plan-cn.xiaomimimo.com/v1/chat/completions).
/// Bypasses browser CORS when running in the Tauri webview.
#[tauri::command]
async fn openai_compatible_chat(api_key: String, url: String, body: Value) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;
  openai_compatible_chat_inner(&client, &api_key, &url, body).await
}

/// HTTP body extracted as a `pub(crate)` helper so the integration tests can
/// call it directly with a local reqwest client and a mock HTTP server.
pub async fn openai_compatible_chat_inner(
  client: &reqwest::Client,
  api_key: &str,
  url: &str,
  body: Value,
) -> Result<String, String> {
  let response = client
    .post(url)
    .header("Authorization", format!("Bearer {api_key}"))
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] openai_compatible_chat network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  let text = response.text().await.map_err(|e| e.to_string())?;

  if !status.is_success() {
    let preview: String = text.chars().take(800).collect();
    eprintln!("[Spoor] openai_compatible_chat HTTP {status} url={url} body_preview={preview}");
    return Err(text);
  }

  let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
  let content = json["choices"]
    .get(0)
    .and_then(|c| c.get("message")?.get("content"));

  match content {
    Some(Value::String(s)) => Ok(s.clone()),
    Some(v) => Ok(v.to_string()),
    None => Err(format!("Unexpected API response: {text}")),
  }
}

/// Same as [`openai_compatible_chat`] but `stream: true` + SSE; emits JSON `{ id, text }` on `lab-ai-stream` as tokens arrive.
#[tauri::command]
async fn openai_compatible_chat_stream(
  app: AppHandle,
  api_key: String,
  url: String,
  mut body: Value,
  stream_id: String,
) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;

  if let Some(obj) = body.as_object_mut() {
    obj.insert("stream".to_string(), Value::Bool(true));
  }

  let response = client
    .post(&url)
    .header(
      "Authorization",
      format!("Bearer {}", api_key.trim()),
    )
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] openai_compatible_chat_stream network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  if !status.is_success() {
    let text = response.text().await.unwrap_or_default();
    let preview: String = text.chars().take(800).collect();
    eprintln!(
      "[Spoor] openai_compatible_chat_stream HTTP {status} url={url} body_preview={preview}"
    );
    return Err(text);
  }

  let mut stream = response.bytes_stream();
  let mut pending = String::new();
  let mut content = String::new();
  let mut reasoning = String::new();

  while let Some(chunk_result) = stream.next().await {
    let chunk = chunk_result.map_err(|e| e.to_string())?;
    pending.push_str(&String::from_utf8_lossy(&chunk));

    loop {
      let nl = match pending.find('\n') {
        Some(i) => i,
        None => break,
      };
      let line = pending[..nl].trim_end_matches('\r').to_string();
      pending = pending[nl + 1..].to_string();

      if let Some(piece) = parse_sse_delta(&line) {
        content.push_str(&piece.content);
        reasoning.push_str(&piece.reasoning);
        let full = sse_transcript(&content, &reasoning);
        if !full.is_empty() {
          let payload = serde_json::json!({ "id": &stream_id, "text": &full });
          let _ = app.emit("lab-ai-stream", payload);
        }
      }
    }
  }

  Ok(sse_transcript(&content, &reasoning))
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SseDeltaPieces {
  pub content: String,
  pub reasoning: String,
}

fn sse_transcript(content: &str, reasoning: &str) -> String {
  if reasoning.is_empty() {
    content.to_string()
  } else {
    format!("<think>{reasoning}</think>{content}")
  }
}

/// Extracts content + reasoning pieces from a single SSE `data:` line.
pub fn parse_sse_delta(line: &str) -> Option<SseDeltaPieces> {
  let trimmed = line.trim();
  let data = trimmed.strip_prefix("data:")?.trim_start();
  if data == "[DONE]" {
    return None;
  }
  let v: Value = serde_json::from_str(data).ok()?;
  let delta = v["choices"].get(0).and_then(|c| c.get("delta"))?;
  let content = delta
    .get("content")
    .and_then(|c| c.as_str())
    .unwrap_or("")
    .to_string();
  let reasoning = ["reasoning_content", "reasoning", "reasoning_text"]
    .iter()
    .find_map(|key| {
      delta
        .get(*key)
        .and_then(|value| value.as_str())
        .filter(|piece| !piece.is_empty())
        .map(|piece| piece.to_string())
    })
    .unwrap_or_default();
  if content.is_empty() && reasoning.is_empty() {
    return None;
  }
  Some(SseDeltaPieces { content, reasoning })
}

/// Extracts the content delta from a single SSE `data:` line.
/// Returns `Some(delta)` for valid data lines (including empty content),
/// `None` for non-data lines, comments, or the `[DONE]` sentinel.
pub fn parse_sse_chunk(line: &str) -> Option<String> {
  parse_sse_delta(line).and_then(|piece| {
    if piece.content.is_empty() {
      None
    } else {
      Some(piece.content)
    }
  })
}

/// Metaso (秘塔) search API proxy.
/// POST https://metaso.cn/api/v1/search — bypasses browser CORS in Tauri webview.
/// `scope`: webpage | image | video | podcast (default webpage). `size`: 1–20 (default 5).
#[tauri::command]
async fn metaso_search(
    api_key: String,
    query: String,
    scope: Option<String>,
    size: Option<u32>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    metaso_search_inner(&client, &api_key, &query, scope, size, METASO_BASE_URL).await
}

/// Default base URL for Metaso. Exposed as a const so the test suite can use
/// the same value in error-message expectations.
pub const METASO_BASE_URL: &str = "https://metaso.cn/api/v1/search";

/// HTTP body of `metaso_search` extracted as a `pub` helper for integration
/// testing. The `base_url` is the full Metaso endpoint URL — the production
/// command passes [`METASO_BASE_URL`]; tests can inject a local mock server.
pub async fn metaso_search_inner(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    scope: Option<String>,
    size: Option<u32>,
    base_url: &str,
) -> Result<String, String> {
    let (scope, size) = normalize_metaso_params(scope, size);

    let body = serde_json::json!({
        "q": query,
        "scope": scope,
        "size": size,
    });

    let response = client
        .post(base_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] metaso_search network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let preview: String = text.chars().take(800).collect();
        eprintln!("[Spoor] metaso_search HTTP {status} body_preview={preview}");
        return Err(text);
    }

    Ok(text)
}

/// Metaso Q&A (`/api/v1/chat`). Search stays on [`metaso_search`].
#[tauri::command]
async fn metaso_chat(
    api_key: String,
    query: String,
    scope: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    metaso_chat_inner(&client, &api_key, &query, scope, METASO_CHAT_URL).await
}

pub const METASO_CHAT_URL: &str = "https://metaso.cn/api/v1/chat";

pub async fn metaso_chat_inner(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    scope: Option<String>,
    base_url: &str,
) -> Result<String, String> {
    let (scope, _) = normalize_metaso_params(scope, None);
    let body = serde_json::json!({
        "q": query,
        "scope": scope,
        "model": "fast",
        "format": "chat_completions",
        "stream": false,
        "conciseSnippet": true,
    });

    let response = client
        .post(base_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] metaso_chat network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let preview: String = text.chars().take(800).collect();
        eprintln!("[Spoor] metaso_chat HTTP {status} body_preview={preview}");
        return Err(text);
    }

    Ok(text)
}

/// Pure helper: normalizes the optional `scope` and `size` parameters for Metaso.
/// `scope`: "image" | "video" | "podcast" pass through (after trim); anything else → "webpage".
/// `size`: defaults to 5, clamped to [1, 20].
pub fn normalize_metaso_params(scope: Option<String>, size: Option<u32>) -> (String, u32) {
    let scope = match scope.as_deref().map(str::trim).unwrap_or("webpage") {
        "image" => "image",
        "video" => "video",
        "podcast" => "podcast",
        _ => "webpage",
    };
    let size = size.unwrap_or(5).clamp(1, 20);
    (scope.to_string(), size)
}

/// Validate a URL for `open_external_url`: trims, requires `http://` or `https://` prefix.
pub fn open_external_url_validate(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Only http:// and https:// URLs are allowed".into());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are allowed".into());
    }
    Ok(trimmed.to_string())
}

/// Open an http(s) URL in the system default browser. Webview `target=_blank` is unreliable in Tauri.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let validated = open_external_url_validate(&url)?;
    open::that(validated).map_err(|e| e.to_string())
}

/// Max response body size for [`fetch_url`] (512 KiB).
pub const FETCH_URL_MAX_BYTES: usize = 512 * 1024;

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FetchUrlResult {
    pub final_url: String,
    pub content_type: String,
    pub body: String,
}

/// Truncate raw bytes for HTML parsing; lossy UTF-8.
pub fn truncate_fetch_body(bytes: &[u8], max_bytes: usize) -> String {
    let slice = if bytes.len() > max_bytes {
        &bytes[..max_bytes]
    } else {
        bytes
    };
    String::from_utf8_lossy(slice).into_owned()
}

/// Whether a Content-Type looks safe to treat as page markup for link unfurl.
pub fn fetch_url_content_type_ok(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    if ct.is_empty() {
        // Some servers omit Content-Type; still attempt parse.
        return true;
    }
    ct.contains("text/html")
        || ct.contains("application/xhtml")
        || ct.contains("text/plain")
}

/// HTTP body of `fetch_url` extracted for integration tests (inject mock base via client + url).
pub async fn fetch_url_inner(
    client: &reqwest::Client,
    url: &str,
) -> Result<FetchUrlResult, String> {
    let validated = open_external_url_validate(url)?;
    let response = client
        .get(&validated)
        .header(
            "User-Agent",
            BROWSER_UA,
        )
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] fetch_url network error: {e} (url={validated})");
            e.to_string()
        })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !status.is_success() {
        eprintln!("[Spoor] fetch_url HTTP {status} url={final_url}");
        return Err(format!("HTTP {status}"));
    }

    if !fetch_url_content_type_ok(&content_type) {
        return Err(format!("Unsupported content type: {content_type}"));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let body = truncate_fetch_body(&bytes, FETCH_URL_MAX_BYTES);
    if body.trim().is_empty() {
        return Err("Empty response body".into());
    }

    Ok(FetchUrlResult {
        final_url,
        content_type,
        body,
    })
}

/// Fetch an http(s) page for canvas link unfurl (desktop only; size/time limited).
#[tauri::command]
async fn fetch_url(url: String) -> Result<FetchUrlResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    fetch_url_inner(&client, &url).await
}

/// Max image body for [`fetch_image`] (8 MiB).
pub const FETCH_IMAGE_MAX_BYTES: usize = 8 * 1024 * 1024;

const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FetchImageResult {
    pub content_type: String,
    pub data_base64: String,
}

pub fn fetch_image_content_type_ok(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    if ct.is_empty() {
        return true;
    }
    ct.starts_with("image/") || ct.contains("octet-stream")
}

pub fn encode_base64(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < bytes.len() {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

pub async fn fetch_image_inner(
    client: &reqwest::Client,
    url: &str,
    referer: Option<&str>,
) -> Result<FetchImageResult, String> {
    let validated = open_external_url_validate(url)?;
    let mut req = client
        .get(&validated)
        .header("User-Agent", BROWSER_UA)
        .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
    if let Some(referer) = referer {
        let r = referer.trim();
        if r.starts_with("http://") || r.starts_with("https://") {
            req = req.header("Referer", r);
        }
    }
    let response = req.send().await.map_err(|e| {
        eprintln!("[Spoor] fetch_image network error: {e} (url={validated})");
        e.to_string()
    })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !status.is_success() {
        eprintln!("[Spoor] fetch_image HTTP {status} url={final_url}");
        return Err(format!("HTTP {status}"));
    }
    if !fetch_image_content_type_ok(&content_type) {
        return Err(format!("Unsupported content type: {content_type}"));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("Empty image body".into());
    }
    if bytes.len() > FETCH_IMAGE_MAX_BYTES {
        return Err("Image too large".into());
    }

    Ok(FetchImageResult {
        content_type: if content_type.is_empty() {
            "image/jpeg".into()
        } else {
            content_type
        },
        data_base64: encode_base64(&bytes),
    })
}

/// Fetch a remote image for canvas display (hotlink CDNs need the page Referer).
#[tauri::command]
async fn fetch_image(url: String, referer: Option<String>) -> Result<FetchImageResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    fetch_image_inner(&client, &url, referer.as_deref()).await
}

/// 内置 llama.cpp：加载本地 GGUF，使用模型自带 chat 模板完成一轮对话（桌面端离线）。
#[tauri::command]
async fn local_llama_chat(payload: LocalLlamaChatPayload) -> Result<String, String> {
  tokio::task::spawn_blocking(move || local_llama::chat(payload))
    .await
    .map_err(|e| format!("推理任务异常: {e}"))?
}

/// 返回本地 LLM 日志文件路径（每次推理的命令行/stdout/stderr/耗时都会写入此文件）。
#[tauri::command]
fn get_local_llama_log_path() -> String {
  local_llama::log_path().to_string_lossy().to_string()
}

/// Returns the TCP port the in-process voice-mode WS proxy is bound to, or
/// `None` if startup hasn't bound yet. The webview reads this to compute
/// `ws://127.0.0.1:<port>/...` URLs for Volc ASR / MiniMax TTS in Tauri
/// production (where the Vite plugin isn't available).
#[tauri::command]
fn voice_proxy_port(state: tauri::State<'_, VoiceProxyState>) -> Option<u16> {
  *state.shared.lock()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Shared with the proxy server: bound port is published here, the
  // `voice_proxy_port` command reads from this same slot via Tauri's managed
  // state.
  let voice_proxy_port_slot: Arc<Mutex<Option<u16>>> = Arc::new(Mutex::new(None));
  let slot_for_manage = Arc::clone(&voice_proxy_port_slot);

  tauri::Builder::default()
    .manage(VoiceProxyState {
      shared: slot_for_manage,
    })
    .setup({
      let port_slot = Arc::clone(&voice_proxy_port_slot);
      move |_app| {
        let (bound_tx, _bound_rx) = tokio::sync::oneshot::channel();
        // Spawn the proxy server; it reports the bound port through `bound_tx`
        // and writes to the shared slot.
        tauri::async_runtime::spawn(async move {
          voice_proxy::run_with_port_slot(bound_tx, port_slot).await;
        });
        Ok(())
      }
    })
    .invoke_handler(tauri::generate_handler![
      openai_compatible_chat,
      openai_compatible_chat_stream,
      metaso_search,
      metaso_chat,
      open_external_url,
      fetch_url,
      fetch_image,
      local_llama_chat,
      get_local_llama_log_path,
      voice_proxy_port
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
