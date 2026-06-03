FROM oven/bun:1.3.14-debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates caddy nodejs python3 tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run tailwind:build

ENV METIDOS_APP_DATA_DIR=/data
ENV METIDOS_PORT=7599
ENV METIDOS_WEB_SERVER_SHARE_HOST=127.0.0.1

EXPOSE 443
VOLUME ["/data"]

COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
COPY deploy/docker/entrypoint.sh /usr/local/bin/metidos-entrypoint
RUN chmod +x /usr/local/bin/metidos-entrypoint

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/metidos-entrypoint"]
