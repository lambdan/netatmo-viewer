import { serveDir } from "@std/http/file-server";
import type { WeatherData } from "../shared/types.ts";
import { Netatmo } from "./netatmo.ts";
import { demoData } from "./demo.ts";

const env = (k: string) => Deno.env.get(k) || undefined;

const PORT = Number(env("PORT") ?? 8080);
// Netatmo stations upload every ~10 minutes, so polling more often than this is pointless.
const POLL_MS = Math.max(60, Number(env("POLL_SECONDS") ?? 300)) * 1000;
const HISTORY_MS = 15 * 60 * 1000;
const STATIC_DIR = env("STATIC_DIR") ?? "./dist";
const DEMO = env("DEMO") === "1" || !env("NETATMO_CLIENT_ID");

const netatmo = DEMO ? undefined : new Netatmo({
  clientId: env("NETATMO_CLIENT_ID")!,
  clientSecret: env("NETATMO_CLIENT_SECRET") ?? "",
  initialRefreshToken: env("NETATMO_REFRESH_TOKEN"),
  dataDir: env("DATA_DIR") ?? "./data",
});

let cache: WeatherData | undefined;
let history = new Map<string, [number, number][]>();
let historyFetchedAt = 0;
let inflight: Promise<void> | undefined;

async function poll() {
  if (!netatmo) {
    cache = demoData();
    return;
  }
  try {
    const data = await netatmo.stations();
    const baseId = data.modules[0].id;

    if (Date.now() - historyFetchedAt > HISTORY_MS) {
      const next = new Map<string, [number, number][]>();
      for (const m of data.modules) {
        if (m.temperature === undefined) continue;
        try {
          next.set(m.id, await netatmo.history(baseId, m.id === baseId ? undefined : m.id));
        } catch (e) {
          console.warn(`history for ${m.name} failed:`, (e as Error).message);
          const old = history.get(m.id);
          if (old) next.set(m.id, old);
        }
      }
      history = next;
      historyFetchedAt = Date.now();
    }
    for (const m of data.modules) m.history = history.get(m.id);

    cache = data;
  } catch (e) {
    const error = (e as Error).message;
    console.error("Netatmo fetch failed:", error);
    cache = cache
      ? { ...cache, error }
      : { stationName: "Weather", fetchedAt: 0, modules: [], error };
  }
}

function refresh(): Promise<void> {
  inflight ??= poll().finally(() => (inflight = undefined));
  return inflight;
}

refresh();
setInterval(refresh, POLL_MS);

console.log(
  `netatmo-viewer on http://0.0.0.0:${PORT} (${DEMO ? "demo data" : "live Netatmo data"})`,
);

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/weather") {
    if (!cache) await refresh();
    return Response.json(cache, { headers: { "Cache-Control": "no-store" } });
  }
  if (pathname === "/healthz") return new Response("ok");

  const res = await serveDir(req, { fsRoot: STATIC_DIR, quiet: true });
  if (res.status === 404) {
    return serveDir(new Request(new URL("/", req.url)), { fsRoot: STATIC_DIR, quiet: true });
  }
  // Hashed assets can be cached forever; index.html must always be revalidated.
  const headers = new Headers(res.headers);
  headers.set(
    "Cache-Control",
    pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  );
  return new Response(res.body, { status: res.status, headers });
});
