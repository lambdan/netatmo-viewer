# --- build the Vue frontend ---
FROM denoland/deno:2.9.5 AS build
WORKDIR /app
COPY deno.json deno.lock ./
RUN deno install
COPY . .
RUN deno task build

# --- runtime: just the Deno server + built static files ---
FROM denoland/deno:2.9.5
WORKDIR /app
RUN mkdir /data && chown deno:deno /data
COPY deno.json deno.lock ./
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
USER deno
RUN deno cache server/main.ts

ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD deno eval "const r = await fetch('http://localhost:8080/healthz'); if (!r.ok) Deno.exit(1)"
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write=/data", "server/main.ts"]
