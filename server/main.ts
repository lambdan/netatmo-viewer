// Starts everything up and serves the API and the page.

import { serveDir } from "@std/http/file-server";
import type {
  Fact,
  MonthlyResponse,
  RecordsResponse,
  SeriesResponse,
  StationEvent,
} from "../shared/types.ts";
import { Netatmo, type NetatmoApp, type Tokens } from "./netatmo.ts";
import { seedDemoArchive } from "./demo.ts";
import { Archive, connect, isMetric, memoryDb } from "./db.ts";
import { Sync } from "./sync.ts";
import { loadFacts } from "./facts.ts";
import { Shelly } from "./shelly.ts";
import { APP_SETTING, Station } from "./station.ts";
import { message, sleep } from "./util.ts";

const env = (k: string) => Deno.env.get(k) || undefined;

const PORT = Number(env("PORT") ?? 8080);
// Shelly sensors connect here (see shelly.ts for why it can't be the same port).
const SHELLY_PORT = Number(env("SHELLY_PORT") ?? 8083);
// Netatmo stations upload every ~10 minutes, so polling more often than this is pointless.
const POLL_MS = Math.max(60, Number(env("POLL_SECONDS") ?? 300)) * 1000;
const STATIC_DIR = env("STATIC_DIR") ?? "./dist";
const DEMO = env("DEMO") === "1";
const DATABASE_URL = env("DATABASE_URL");

if (!DEMO && !DATABASE_URL) {
  console.error("DATABASE_URL is required, e.g. postgres://user:password@host:5432/netatmo");
  Deno.exit(1);
}

// --- startup ---

// Demo mode runs Postgres in-process (PGlite), so it needs no database server.
const archive = new Archive(DEMO ? await memoryDb() : await connect(DATABASE_URL!));

// The database may still be starting (e.g. when started together with docker compose).
for (let attempt = 1;; attempt++) {
  try {
    await archive.init();
    break;
  } catch (e) {
    const wait = Math.min(30, attempt * 2);
    console.warn(`Database not ready (${message(e)}), retrying in ${wait}s`);
    await sleep(wait * 1000);
  }
}
if (DEMO) await seedDemoArchive(archive);

// Shelly sensors push their readings over a WebSocket; show them as soon as they arrive.
const shelly = new Shelly(archive, () => void station.updateShelly());
await shelly.load();

// Netatmo app credentials come from the env if set there, otherwise from the setup form.
const envApp: NetatmoApp | undefined = env("NETATMO_CLIENT_ID") && env("NETATMO_CLIENT_SECRET")
  ? { clientId: env("NETATMO_CLIENT_ID")!, clientSecret: env("NETATMO_CLIENT_SECRET")! }
  : undefined;

const netatmo = DEMO ? undefined : new Netatmo({
  ...(envApp ?? await archive.getSetting<NetatmoApp>(APP_SETTING)),
  initialRefreshToken: env("NETATMO_REFRESH_TOKEN"),
  tokenStore: {
    load: () => archive.getSetting<Tokens>("netatmo_tokens"),
    save: (tokens) => archive.setSetting("netatmo_tokens", tokens),
  },
});

const station = new Station({
  archive,
  shelly,
  netatmo,
  sync: netatmo ? new Sync(netatmo, archive) : undefined,
  appFromEnv: !!envApp,
});
station.refresh();
setInterval(() => station.refresh(), POLL_MS);
// Only once there's a station to pass their readings to.
shelly.listen(SHELLY_PORT);

// --- API ---

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** GET /api/history, /api/records, /api/monthly and /api/archive */
async function archiveApi(pathname: string, q: URLSearchParams): Promise<Response> {
  if (pathname === "/api/archive") return json(await archive.stats());

  const moduleId = q.get("module") ?? "";
  const metric = q.get("metric");
  if (!isMetric(metric)) return json({ error: "bad metric" }, 400);
  const num = (k: string) => Number(q.get(k) ?? 0) || 0;
  // IANA time zone of the viewer, e.g. Europe/Stockholm; Postgres validates it.
  const tz = q.get("tz") || "UTC";

  if (pathname === "/api/history") {
    const body: SeriesResponse = {
      points: await archive.series(moduleId, metric, num("from"), num("to"), num("bucket"), tz),
    };
    return json(body);
  }
  if (pathname === "/api/records") {
    const [since, state, today, month, year, all] = await Promise.all([
      archive.oldest(moduleId),
      archive.state(moduleId),
      archive.extremes(moduleId, metric, num("today")),
      archive.extremes(moduleId, metric, num("month")),
      archive.extremes(moduleId, metric, num("year")),
      archive.extremes(moduleId, metric),
    ]);
    // Shelly sensors have no history to import, only what they've pushed since being added.
    const isShelly = shelly.has(moduleId);
    const body: RecordsResponse = {
      since,
      complete: DEMO || isShelly || state.backfillDone,
      lastReading: isShelly ? await archive.newest(moduleId) : undefined,
      periods: { today, month, year, all },
    };
    return json(body);
  }
  if (pathname === "/api/monthly") {
    const body: MonthlyResponse = { months: await archive.monthly(moduleId, metric, tz) };
    return json(body);
  }
  return json({ error: "not found" }, 404);
}

// Facts change slowly; recomputing them at most every 10 minutes per time zone is plenty.
const FACTS_TTL_MS = 10 * 60 * 1000;
const factsCache = new Map<string, { at: number; facts: Fact[] }>();

/** GET /api/facts?tz= */
async function factsApi(q: URLSearchParams): Promise<Response> {
  const tz = q.get("tz") || "UTC";
  const cached = factsCache.get(tz);
  if (cached && Date.now() - cached.at < FACTS_TTL_MS) return json(cached.facts);
  if (!station.modules.length) return json([]);
  const started = performance.now();
  const facts = await loadFacts(archive, station.modules, tz);
  factsCache.set(tz, { at: Date.now(), facts });
  console.log(
    `Computed ${facts.length} facts for ${tz} in ${Math.round(performance.now() - started)} ms:` +
      facts.map((f) => `\n  ${f.icon} [${Math.round(f.score)}] ${f.id} ${JSON.stringify(f.vars)}`)
        .join(""),
  );
  return json(facts);
}

/** Validates an event body from the page; returns an error message instead if it's bad. */
async function parseEvent(
  req: Request,
): Promise<{ at: number; label: string; moduleIds: string[] } | string> {
  const body = await req.json().catch(() => ({}));
  const at = Number(body.at);
  const label = String(body.label ?? "").trim().slice(0, 100);
  const moduleIds: string[] = Array.isArray(body.moduleIds)
    ? body.moduleIds.filter((id: unknown) => typeof id === "string" && id)
    : [];
  // Netatmo weather stations exist since 2012; allow a bit of future for planned moves.
  if (!label || !(at > Date.UTC(2012, 0, 1) / 1000 && at < Date.now() / 1000 + 366 * 86400)) {
    return "An event needs a label and a date";
  }
  if (!moduleIds.length) return "Pick at least one module";
  return { at, label, moduleIds };
}

const describeEvent = (e: StationEvent) =>
  `"${e.label}" for ${e.moduleIds.join(", ")} at ${new Date(e.at * 1000).toISOString()}`;

/** GET/POST /api/events, PUT/DELETE /api/events/:id (body: {at, label, moduleIds}) */
async function eventsApi(req: Request, pathname: string): Promise<Response> {
  if (pathname === "/api/events" && req.method === "GET") return json(await archive.events());
  if (pathname === "/api/events" && req.method === "POST") {
    const e = await parseEvent(req);
    if (typeof e === "string") return json({ error: e }, 400);
    const event = await archive.addEvent(e.at, e.label, e.moduleIds);
    console.log(`Added event ${describeEvent(event)}`);
    return json(event);
  }
  const id = Number(pathname.split("/")[3]);
  if (!Number.isInteger(id)) return json({ error: "not found" }, 404);
  if (req.method === "PUT") {
    const e = await parseEvent(req);
    if (typeof e === "string") return json({ error: e }, 400);
    const event = await archive.updateEvent(id, e.at, e.label, e.moduleIds);
    if (!event) return json({ error: "No such event" }, 404);
    console.log(`Updated event ${id}: ${describeEvent(event)}`);
    return json(event);
  }
  if (req.method === "DELETE") {
    await archive.deleteEvent(id);
    console.log(`Deleted event ${id}`);
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}

// --- HTTP server ---

console.log(
  `netatmo-viewer on http://0.0.0.0:${PORT} (${DEMO ? "demo data" : "live Netatmo data"})`,
);

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  const started = performance.now();
  const res = await handle(req, url);
  const ms = Math.round(performance.now() - started);
  if (url.pathname.startsWith("/api/") && ms > 500) {
    console.log(`Slow request: ${url.pathname}${url.search} took ${ms} ms`);
  }
  return res;
});

async function handle(req: Request, url: URL): Promise<Response> {
  const { pathname } = url;

  if (pathname === "/api/weather") return json(await station.data());
  if (pathname === "/api/setup" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { status, error } = await station.setup(body);
    return json(error ? { error } : { ok: true }, status);
  }
  if (pathname === "/api/shelly") {
    return new Response(
      `Shelly sensors connect to their own port: set the sensor's Outbound WebSocket to ` +
        `ws://<this server>:${SHELLY_PORT}/ (the port as published by Docker, if it maps it)\n`,
      { status: 404 },
    );
  }
  if (pathname.startsWith("/api/")) {
    try {
      if (pathname.startsWith("/api/events")) return await eventsApi(req, pathname);
      if (pathname === "/api/facts") return await factsApi(url.searchParams);
      return await archiveApi(pathname, url.searchParams);
    } catch (e) {
      console.warn(`${pathname} failed:`, message(e));
      return json({ error: message(e) }, 500);
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
}
