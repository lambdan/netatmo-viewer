# --- build the Vue frontend ---
# The frontend output is platform independent, so build it natively even for multi-arch images.
FROM --platform=$BUILDPLATFORM denoland/deno:2.9.5 AS build
WORKDIR /app
COPY deno.json deno.lock ./
RUN deno install
COPY . .
RUN deno task build

# --- runtime: just the Deno server + built static files ---
FROM denoland/deno:2.9.5
WORKDIR /app
COPY deno.json deno.lock ./
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
# deno cache sets up node_modules here for the npm packages (postgres, pglite).
RUN chown deno:deno /app
USER deno
RUN deno cache server/main.ts

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD deno eval "const r = await fetch('http://localhost:8080/healthz'); if (!r.ok) Deno.exit(1)"
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "server/main.ts"]
