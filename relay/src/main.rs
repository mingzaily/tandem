use std::{env, io, path::PathBuf, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::CancellationToken;

#[tokio::main(worker_threads = 2)]
async fn main() -> io::Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8787".into())
        .parse()
        .map_err(|_| io::Error::other("PORT 必须是 0 到 65535 的整数"))?;
    if args.first().is_some_and(|arg| arg == "healthcheck") {
        return healthcheck(&host, port).await;
    }
    let mut hello_timeout = Duration::from_secs(10);
    for arg in args {
        if let Some(value) = arg.strip_prefix("--hello-timeout-ms=") {
            hello_timeout = Duration::from_millis(
                value
                    .parse()
                    .map_err(|_| io::Error::other("准入超时必须是毫秒整数"))?,
            );
        } else {
            return Err(io::Error::other(
                "支持的命令：healthcheck，--hello-timeout-ms=<毫秒>",
            ));
        }
    }
    let config = tandem_relay::Config {
        host_token: env::var("TANDEM_RELAY_HOST_TOKEN").unwrap_or_default(),
        data_file: PathBuf::from(
            env::var("TANDEM_RELAY_DATA_FILE").unwrap_or_else(|_| "./data/tokens.json".into()),
        ),
        static_dir: env::var_os("TANDEM_RELAY_STATIC_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        trust_proxy: env::var("TANDEM_RELAY_TRUST_PROXY").is_ok_and(|value| value == "1"),
        hello_timeout,
    };
    if config.host_token.is_empty() {
        return Err(io::Error::other("TANDEM_RELAY_HOST_TOKEN 必须设置"));
    }
    let listener = TcpListener::bind((host.as_str(), port)).await?;
    println!("LISTENING {}", listener.local_addr()?);
    let stop = CancellationToken::new();
    let signal = stop.clone();
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler installs at startup");
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        signal.cancel();
    });
    tandem_relay::serve(listener, config, stop).await
}

async fn healthcheck(host: &str, port: u16) -> io::Result<()> {
    let host = match host {
        "0.0.0.0" => "127.0.0.1",
        "::" => "::1",
        other => other,
    };
    tokio::time::timeout(Duration::from_secs(3), async {
        let mut stream = TcpStream::connect((host, port)).await?;
        stream
            .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await?;
        let mut bytes = Vec::new();
        stream.take(4096).read_to_end(&mut bytes).await?;
        let response = String::from_utf8_lossy(&bytes);
        if valid_health_response(&response) {
            Ok(())
        } else {
            Err(io::Error::other("健康检查失败"))
        }
    })
    .await
    .map_err(io::Error::other)?
}

fn valid_health_response(response: &str) -> bool {
    let Some((headers, body)) = response.split_once("\r\n\r\n") else { return false };
    headers.starts_with("HTTP/1.1 200 ") && serde_json::from_str::<serde_json::Value>(body)
        .is_ok_and(|value| value.get("ok").and_then(serde_json::Value::as_bool) == Some(true)
            && value.get("v").and_then(serde_json::Value::as_u64) == Some(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_response_checks_status_and_json_fields_independently_of_formatting() {
        for body in [r#"{"ok":true,"v":1}"#, r#"{ "v": 1, "ok": true, "version": "0.1.2026111101" }"#] {
            assert!(valid_health_response(&format!("HTTP/1.1 200 OK\r\n\r\n{body}")));
        }
        for response in ["HTTP/1.1 503 Unavailable\r\n\r\n{\"ok\":true,\"v\":1}",
            "HTTP/1.1 200 OK\r\n\r\n{\"ok\":false,\"v\":1}", "HTTP/1.1 200 OK\r\n\r\n{\"ok\":true,\"v\":2}",
            "HTTP/1.1 200 OK\r\n\r\ninvalid", "HTTP/1.1 200 OK"] {
            assert!(!valid_health_response(response));
        }
    }

    #[tokio::test]
    async fn healthcheck_accepts_a_valid_health_response_with_the_product_version() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 256];
            let amount = stream.read(&mut request).await.unwrap();
            assert!(amount > 0);
            let body = r#"{"ok":true,"v":1,"version":"0.1.2026111101"}"#;
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
        });
        let result = healthcheck("127.0.0.1", port).await;
        server.await.unwrap();
        assert!(result.is_ok(), "{result:?}");
    }
}
