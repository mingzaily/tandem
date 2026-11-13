# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-alpine AS pwa
WORKDIR /build/pwa
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY pwa/package.json pwa/pnpm-lock.yaml ./
RUN --mount=type=cache,id=tandem-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store --network-concurrency=4
COPY pwa/ ./
COPY desktop/design/tokens/ /build/desktop/design/tokens/
RUN pnpm build

FROM rust:1.91-alpine AS rust
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY relay/Cargo.toml relay/Cargo.lock ./
COPY relay/src/ ./src/
RUN cargo build --locked --release && mkdir /data

FROM scratch
COPY LICENSE NOTICE /licenses/
COPY --from=rust /build/target/release/tandem-relay /tandem-relay
COPY --from=rust /data/ /data/
COPY --from=pwa /build/pwa/dist/ /pwa/
ENV HOST=0.0.0.0 PORT=8787 TANDEM_RELAY_DATA_FILE=/data/tokens.json TANDEM_RELAY_STATIC_DIR=/pwa
VOLUME ["/data"]
EXPOSE 8787
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/tandem-relay", "healthcheck"]
ENTRYPOINT ["/tandem-relay"]
