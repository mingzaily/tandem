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
        if response.starts_with("HTTP/1.1 200 ") && response.contains("{\"ok\":true,\"v\":1}") {
            Ok(())
        } else {
            Err(io::Error::other("健康检查失败"))
        }
    })
    .await
    .map_err(io::Error::other)?
}
