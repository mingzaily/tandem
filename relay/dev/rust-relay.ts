import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

/** Test harness for the separately compiled Rust server. Production needs only the binary. */
export async function startRelay(options: {
  hostToken: string;
  dataFile: string;
  helloMs?: number;
  trustProxy?: boolean;
  staticDir?: string;
}) {
  const binary =
    process.env.TANDEM_RELAY_TEST_BINARY ??
    fileURLToPath(new URL("../target/debug/tandem-relay", import.meta.url));
  const child = spawn(
    binary,
    [`--hello-timeout-ms=${options.helloMs ?? 10_000}`],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        TANDEM_RELAY_HOST_TOKEN: options.hostToken,
        TANDEM_RELAY_DATA_FILE: options.dataFile,
        TANDEM_RELAY_TRUST_PROXY: options.trustProxy ? "1" : "0",
        TANDEM_RELAY_STATIC_DIR: options.staticDir ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "",
    errors = "";
  child.stdout.setEncoding("utf8").on("data", (data) => {
    output += data;
  });
  child.stderr.setEncoding("utf8").on("data", (data) => {
    errors += data;
  });
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  const exited = once(child, "exit");
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null || spawnError)
      return;
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
    try {
      await exited;
    } finally {
      clearTimeout(kill);
    }
  }
  try {
    for (let n = 0; n < 500; n++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null)
        throw new Error(`Rust relay 启动失败：${errors}`);
      const address = output.match(/LISTENING (127\.0\.0\.1:\d+)/)?.[1];
      if (address) {
        try {
          const response = await fetch(`http://${address}/healthz`);
          if (response.ok)
            return {
              url: `ws://${address}/ws`,
              close,
              child,
              logs: () => errors,
            };
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
        }
      }
      await sleep(10);
    }
    throw new Error(`Rust relay 启动超时：${errors}`);
  } catch (error) {
    await close();
    throw error;
  }
}
