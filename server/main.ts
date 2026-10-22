import { serveDir } from "@std/http/file-server";
import type {
  MonthlyResponse,
  RecordsResponse,
  SeriesResponse,
  WeatherData,
} from "../shared/types.ts";
import { Netatmo } from "./netatmo.ts";
import { demoData, seedDemoArchive } from "./demo.ts";
import { Archive, isMetric } from "./db.ts";
import { Sync } from "./sync.ts";

const env = (k: string) => Deno.env.get(k) || undefined;

const PORT = Number(env("PORT") ?? 8080);
// Netatmo stations upload every ~10 minutes, so polling more often than this is pointless.
const POLL_MS = Math.max(60, Number(env("POLL_SECONDS") ?? 300)) * 1000;
const STATIC_DIR = env("STATIC_DIR") ?? "./dist";
const DEMO = env("DEMO") === "1" || !env("NETATMO_CLIENT_ID");

const DATA_DIR = env("DATA_DIR") ?? "./data";

const netatmo = DEMO ? undefined : new Netatmo({
  clientId: env("NETATMO_CLIENT_ID")!,
  clientSecret: env("NETATMO_CLIENT_SECRET") ?? "",
  initialRefreshToken: env("NETATMO_REFRESH_TOKEN"),
  dataDir: DATA_DIR,
});

let archive: Archive;
if (netatmo) {
  await Deno.mkdir(DATA_DIR, { recursive: true });
  archive = new Archive(`${DATA_DIR}/netatmo.sqlite`);
} else {
  archive = new Archive(":memory:");
  seedDemoArchive(archive);
}
const sync = netatmo ? new Sync(netatmo, archive) : undefined;

let cache: WeatherData | undefined;
let inflight: Promise<void> | undefined;

async function poll() {
  if (!netatmo || !sync) {
    cache = demoData();
    return;
  }
  try {
    const { data, setupAt } = await netatmo.stations();
    await sync.update(data.modules, setupAt);

    // The 24h chart comes from the local archive, in 30 minute buckets.
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    for (const m of data.modules) {
      if (m.temperature !== undefined) m.history = archive.temperatureHistory(m.id, since, 1800);
    }

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

function json(body: unknown) {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

console.log(
  `netatmo-viewer on http://0.0.0.0:${PORT} (${DEMO ? "demo data" : "live Netatmo data"})`,
);

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/weather") {
    if (!cache) await refresh();
    return Response.json(cache, { headers: { "Cache-Control": "no-store" } });
  }
  if (pathname === "/api/archive") return json(archive.stats());
  if (pathname.startsWith("/api/")) {
    const q = new URL(req.url).searchParams;
    const moduleId = q.get("module") ?? "";
    const metric = q.get("metric");
    if (!isMetric(metric)) return new Response("bad metric", { status: 400 });
    const num = (k: string) => Number(q.get(k) ?? 0) || 0;

    if (pathname === "/api/history") {
      const body: SeriesResponse = {
        points: archive.series(moduleId, metric, num("from"), num("to"), num("bucket"), num("tz")),
      };
      return json(body);
    }
    if (pathname === "/api/records") {
      const body: RecordsResponse = {
        since: archive.oldest(moduleId),
        complete: !netatmo || archive.state(moduleId).backfillDone,
        periods: {
          today: archive.extremes(moduleId, metric, num("today")),
          month: archive.extremes(moduleId, metric, num("month")),
          year: archive.extremes(moduleId, metric, num("year")),
          all: archive.extremes(moduleId, metric),
        },
      };
      return json(body);
    }
    if (pathname === "/api/monthly") {
      const body: MonthlyResponse = { months: archive.monthly(moduleId, metric, num("tz")) };
      return json(body);
    }
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
