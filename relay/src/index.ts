import { createRelay } from "./server.ts";
const relay = await createRelay({
  hostToken: process.env.TANDEM_RELAY_HOST_TOKEN ?? "",
  dataFile: process.env.TANDEM_RELAY_DATA_FILE ?? "./data/tokens.json",
  log: console.info,
  trustProxy: process.env.TANDEM_RELAY_TRUST_PROXY === "1",
});
relay.server.listen(
  Number(process.env.PORT ?? 8787),
  process.env.HOST ?? "127.0.0.1",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void relay.close();
  });
