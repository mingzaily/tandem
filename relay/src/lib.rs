mod admission_io;
mod hub;
mod protocol;
mod store;

use admission_io::AdmissionIo;
use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use hub::{Hub, Outbox};
use hyper_util::rt::TokioIo;
use protocol::*;
use serde_json::{Value, json};
use std::{
    io,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{Instant, timeout},
};
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{
        Error as WsError, Message,
        handshake::server::create_response,
        protocol::{CloseFrame, Role, WebSocketConfig, frame::coding::CloseCode},
    },
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};

pub struct Config {
    pub host_token: String,
    pub data_file: PathBuf,
    pub static_dir: Option<PathBuf>,
    pub trust_proxy: bool,
    pub hello_timeout: Duration,
}

struct Relay {
    hub: Mutex<Hub>,
    slots: Arc<Semaphore>,
    shutdown: CancellationToken,
    tasks: TaskTracker,
    trust_proxy: bool,
    hello_timeout: Duration,
}

pub async fn serve(
    listener: TcpListener,
    config: Config,
    stop: CancellationToken,
) -> io::Result<()> {
    if config.host_token.is_empty() {
        return Err(io::Error::other("TANDEM_RELAY_HOST_TOKEN 必须设置"));
    }
    let (store, grants, persistence) = store::Store::open(config.data_file).await?;
    let relay = Arc::new(Relay {
        hub: Mutex::new(Hub::new(grants, &config.host_token, store)),
        slots: Arc::new(Semaphore::new(256)),
        shutdown: stop.clone(),
        tasks: TaskTracker::new(),
        trust_proxy: config.trust_proxy,
        hello_timeout: config.hello_timeout,
    });
    let mut app = Router::new()
        .route(
            "/healthz",
            get(|| async { Json(json!({"ok":true,"v":1,"version":env!("CARGO_PKG_VERSION")})) }),
        )
        .route("/", get(|| async { deployment_page() }))
        .route("/ws", get(upgrade));
    if let Some(directory) = config.static_dir {
        // The PWA uses root-relative assets and keeps its CSP in index.html.
        let files = ServeDir::new(directory)
            .precompressed_gzip()
            .append_index_html_on_directories(true);
        app = app.fallback_service(files);
    }
    let app = app
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            header::HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-cache"),
        ))
        .with_state(relay.clone());
    let prune = relay.clone();
    relay.tasks.spawn(async move {
        let mut clock = tokio::time::interval(Duration::from_secs(30));
        loop {
            tokio::select! {
                _ = prune.shutdown.cancelled() => break,
                _ = clock.tick() => prune.hub.lock().expect("hub mutex is healthy").prune(now_ms()),
            }
        }
    });
    let result = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(stop.clone().cancelled_owned())
    .await;
    stop.cancel();
    relay.tasks.close();
    relay.tasks.wait().await;
    drop(relay);
    persistence.await.map_err(io::Error::other)?;
    result
}

fn deployment_page() -> Response {
    let version = env!("CARGO_PKG_VERSION");
    let body = format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>中转已部署</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f1ea; color: #1c1b19;
    font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; }}
  main {{ width: min(440px, calc(100% - 48px)); }}
  p {{ margin: 0; }}
  .status {{ font-size: 13px; color: #2f6f3e; }}
  h1 {{ margin: 8px 0 0; font-size: 32px; line-height: 1.25; font-weight: 650; letter-spacing: -0.03em; }}
  .intro {{ margin-top: 16px; color: #5e5a52; }}
  .intro + .intro {{ margin-top: 8px; }}
  .version {{ margin-top: 20px; font-size: 13px; color: #8a847a; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #161616; color: #f3f1ea; }}
    .status {{ color: #8dcc98; }}
    .intro {{ color: #b9b3a8; }}
    .version {{ color: #8d887f; }}
  }}
</style>
</head>
<body>
<main>
  <p class="status">部署成功</p>
  <h1>中转正在运行</h1>
  <p class="intro">这里只在你的电脑和手机之间转发加密消息，不会读取内容。</p>
  <p class="intro">手机从 Tandem 官网打开。桌面端填写这个域名和部署令牌，再生成配对码。</p>
  <p class="version">版本 {version}</p>
</main>
</body>
</html>"#
    );
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(body))
        .expect("deployment page response is valid")
}

fn client_ip(socket: SocketAddr, forwarded: Option<&str>, trust: bool) -> String {
    if trust
        && let Some(ip) = forwarded
            .and_then(|s| s.split(',').next_back())
            .map(str::trim)
            .filter(|s| !s.is_empty())
    {
        return ip.into();
    }
    socket.ip().to_string()
}

async fn upgrade(
    State(relay): State<Arc<Relay>>,
    ConnectInfo(socket): ConnectInfo<SocketAddr>,
    req: Request,
) -> Response {
    let ip = client_ip(
        socket,
        req.headers()
            .get("x-forwarded-for")
            .and_then(|h| h.to_str().ok()),
        relay.trust_proxy,
    );
    let (parts, _) = req.into_parts();
    let request = axum::http::Request::from_parts(parts, ());
    let response = match create_response(&request) {
        Ok(response) => response,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let upgrade = hyper::upgrade::on(request);
    let permit = relay.slots.clone().try_acquire_owned().ok();
    let tracker = relay.tasks.clone();
    tracker.spawn(async move {
        match upgrade.await {
            Ok(stream) => {
                let config = WebSocketConfig::default()
                    .read_buffer_size(4096)
                    .write_buffer_size(0)
                    .max_message_size(Some(HARD_MAX))
                    .max_frame_size(Some(HARD_MAX));
                let ws = WebSocketStream::from_raw_socket(
                    AdmissionIo::new(TokioIo::new(stream)),
                    Role::Server,
                    Some(config),
                )
                .await;
                connection(ws, relay, ip, permit).await;
            }
            Err(error) => eprintln!("WebSocket 升级失败：{error}"),
        }
    });
    response.map(|_| Body::empty())
}

type Socket = WebSocketStream<AdmissionIo<TokioIo<hyper::upgrade::Upgraded>>>;

fn log_close(code: u16) {
    let reason = match code {
        1000 => "连接正常结束",
        1001 => "中转正在停止，或对端超过 90 秒没有响应",
        1009 => "单条消息超过大小限制",
        1011 => "准入文件没有写入成功",
        4400 => "收到的消息无法解析",
        4401 => "部署令牌或配对码不正确",
        4409 => "新的桌面端替换了这个连接",
        4410 => "这台手机的准入已撤销",
        4411 => "桌面端断开了这台手机",
        4429 => "这个地址的连接或失败次数达到上限",
        _ => "没有更具体的原因",
    };
    eprintln!("关闭连接 {code}：{reason}");
}

async fn close(socket: &mut Socket, code: u16) {
    log_close(code);
    let frame = CloseFrame {
        code: CloseCode::from(code),
        reason: "".into(),
    };
    let _ = timeout(Duration::from_secs(1), socket.close(Some(frame))).await;
}

async fn hello(socket: &mut Socket, relay: &Relay) -> Result<Value, u16> {
    let receive = async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(raw))) => {
                    if raw.len() > MAX_HELLO {
                        return Err(4401);
                    }
                    return serde_json::from_str::<Value>(&raw).map_err(|_| 4400u16);
                }
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {
                    if socket.flush().await.is_err() {
                        return Err(4401);
                    }
                }
                Some(Err(WsError::Capacity(_))) => return Err(4401),
                Some(Ok(Message::Binary(_))) => return Err(4400),
                _ => return Err(4401),
            }
        }
    };
    tokio::select! {
        _ = relay.shutdown.cancelled() => Err(1001),
        result = timeout(relay.hello_timeout, receive) => result.unwrap_or(Err(4401)),
    }
}

async fn connection(
    mut socket: Socket,
    relay: Arc<Relay>,
    ip: String,
    _permit: Option<OwnedSemaphorePermit>,
) {
    if _permit.is_none()
        || relay
            .hub
            .lock()
            .expect("hub mutex is healthy")
            .limited(&ip, now_ms())
    {
        close(&mut socket, 4429).await;
        return;
    }
    let (out, mut receiver, mut closing) = Outbox::new();
    let admission = match hello(&mut socket, &relay).await {
        Ok(frame) => {
            relay
                .hub
                .lock()
                .expect("hub mutex is healthy")
                .admit(&frame, out.clone(), now_ms())
        }
        Err(code) => Err(code),
    };
    let peer = match admission {
        Ok(peer) => peer,
        Err(code) => {
            let code = if code == 4401 {
                relay
                    .hub
                    .lock()
                    .expect("hub mutex is healthy")
                    .fail(&ip, now_ms())
            } else {
                code
            };
            close(&mut socket, code).await;
            return;
        }
    };
    eprintln!(
        "{}",
        if peer.host {
            "桌面端已接入"
        } else {
            "手机已接入"
        }
    );
    socket.get_mut().admitted = true;
    let (mut sink, mut source) = socket.split();
    let stopped = relay.shutdown.clone();
    let writer_out = out.clone();
    let writer = async move {
        // Final protocol replies precede the close frame. Bound the drain so a slow revoked
        // peer releases its connection; backpressure closes immediately.
        let interrupt = async {
            let code = (*closing
                .wait_for(Option::is_some)
                .await
                .expect("outbox lives with the writer"))
            .expect("close signal carries a code");
            if code != 1013 {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            code
        };
        tokio::pin!(interrupt);
        let code = loop {
            tokio::select! {
                biased;
                _ = stopped.cancelled() => break 1001,
                code = &mut interrupt => break code,
                Some(message) = receiver.recv() => {
                    let bytes = message.len();
                    let closing_code = match &message { Message::Close(Some(frame)) => Some(u16::from(frame.code)), _ => None };
                    let result = tokio::select! {
                        biased;
                        _ = stopped.cancelled() => break 1001,
                        code = &mut interrupt => break code,
                        result = sink.send(message) => result,
                    };
                    if closing_code.is_none() { writer_out.delivered(bytes); }
                    if result.is_err() { return; }
                    if let Some(code) = closing_code { log_close(code); return; }
                }
            }
        };
        log_close(code);
        let _ = timeout(
            Duration::from_secs(1),
            sink.send(Message::Close(Some(CloseFrame {
                code: code.into(),
                reason: "".into(),
            }))),
        )
        .await;
    };
    let reader = async {
        let mut heartbeat = tokio::time::interval_at(
            Instant::now() + Duration::from_secs(30),
            Duration::from_secs(30),
        );
        let mut last_pong = Instant::now();
        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    if last_pong.elapsed() >= Duration::from_secs(90) { out.close(1001); return; }
                    out.enqueue(Message::Ping(Vec::new().into()));
                }
                frame = source.next() => {
                    let raw = match frame {
                        Some(Ok(Message::Text(text))) => text,
                        Some(Ok(Message::Pong(_))) => { last_pong = Instant::now(); continue; }
                        Some(Ok(Message::Ping(_))) => continue,
                        Some(Ok(Message::Binary(bytes))) if bytes.len() > MAX_MESSAGE => {
                            out.send(json!({"t":"error","code":"PAYLOAD_TOO_LARGE"}));
                            continue;
                        }
                        Some(Ok(Message::Close(_))) | None => { out.close(1000); return; }
                        Some(Err(WsError::Capacity(_))) => { out.close(1009); return; }
                        Some(Err(error)) => { eprintln!("读取连接失败：{error}"); return; }
                        _ => { out.close(4400); return; }
                    };
                    if raw.len() > MAX_MESSAGE { out.send(json!({"t":"error","code":"PAYLOAD_TOO_LARGE"})); continue; }
                    let frame: Value = match serde_json::from_str(&raw) {
                        Ok(Value::Object(map)) => Value::Object(map),
                        _ => { out.close(4400); return; }
                    };
                    let result = relay.hub.lock().expect("hub mutex is healthy").process(&peer, &frame, now_ms());
                    match result {
                        Ok(receipt) => {
                            if let Some(receipt) = receipt && !matches!(receipt.await, Ok(Ok(()))) { out.close(1011); return; }
                            if hub::string(&frame,"t") == Some("allow") && let Some(id) = hub::string(&frame,"id") { out.send(json!({"t":"allow-ack","id":id})); }
                        }
                        Err(code) => { out.close(code); return; }
                    }
                }
            }
        }
    };
    tokio::pin!(writer);
    tokio::select! {
        _ = &mut writer => {},
        _ = reader => { out.close(1000); writer.await; }
    }
    relay
        .hub
        .lock()
        .expect("hub mutex is healthy")
        .disconnected(&peer);
    eprintln!(
        "{}",
        if peer.host {
            "桌面端已断开"
        } else {
            "手机已断开"
        }
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proxy_uses_only_the_last_hop_when_explicitly_enabled() {
        let socket = "127.0.0.1:5000".parse().unwrap();
        assert_eq!(
            client_ip(socket, Some("spoofed, 198.51.100.7"), true),
            "198.51.100.7"
        );
        assert_eq!(client_ip(socket, Some("198.51.100.7"), false), "127.0.0.1");
        assert_eq!(client_ip(socket, None, true), "127.0.0.1");
    }
}
