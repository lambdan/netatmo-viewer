import { serveDir } from "@std/http/file-server";
import type {
  Module,
  MonthlyResponse,
  RecordsResponse,
  SeriesResponse,
  SetupRequest,
  WeatherData,
} from "../shared/types.ts";
import { AuthError, Netatmo, type NetatmoApp, type Tokens } from "./netatmo.ts";
import { demoData, seedDemoArchive } from "./demo.ts";
import { Archive, connect, isMetric, memoryDb } from "./db.ts";
import { Sync } from "./sync.ts";

const env = (k: string) => Deno.env.get(k) || undefined;

const PORT = Number(env("PORT") ?? 8080);
// Netatmo stations upload every ~10 minutes, so polling more often than this is pointless.
const POLL_MS = Math.max(60, Number(env("POLL_SECONDS") ?? 300)) * 1000;
const STATIC_DIR = env("STATIC_DIR") ?? "./dist";
const DEMO = env("DEMO") === "1";
const DATABASE_URL = env("DATABASE_URL");

if (!DEMO && !DATABASE_URL) {
  console.error("DATABASE_URL is required, e.g. postgres://user:password@host:5432/netatmo");
  Deno.exit(1);
}

// Demo mode runs Postgres in-process (PGlite), so it needs no database server.
const archive = new Archive(DEMO ? await memoryDb() : await connect(DATABASE_URL!));

// The database may still be starting (e.g. when started together with docker compose).
for (let attempt = 1;; attempt++) {
  try {
    await archive.init();
    break;
  } catch (e) {
    const wait = Math.min(30, attempt * 2);
    console.warn(`Database not ready (${(e as Error).message}), retrying in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}
if (DEMO) await seedDemoArchive(archive);

// Netatmo app credentials come from the env if set there, otherwise from the setup form.
const APP_SETTING = "netatmo_app";
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
const sync = netatmo ? new Sync(netatmo, archive) : undefined;

let cache: WeatherData | undefined;
let inflight: Promise<void> | undefined;

async function poll() {
  if (!netatmo || !sync) {
    cache = demoData();
    return;
  }
  if (!netatmo.configured) {
    cache = { ...emptyData(), setup: { state: "required", fromEnv: false } };
    return;
  }
  try {
    const data = await netatmo.stations();
    console.log(`Polled ${data.stationName}: ${data.modules.map(describe).join(" · ")}`);
    await sync.update(data.modules);

    // The 24h chart comes from the archive, in 30 minute buckets. If the database is having
    // trouble, still show the current readings.
    const now = Math.floor(Date.now() / 1000);
    for (const m of data.modules) {
      if (m.temperature === undefined) continue;
      try {
        const points = await archive.series(
          m.id,
          "temperature",
          now - 24 * 3600,
          now + 1,
          1800,
          "UTC",
        );
        m.history = points.map(([t, avg]) => [t, Math.round(avg * 10) / 10]);
      } catch (e) {
        console.warn(`24h history for ${m.name} failed:`, (e as Error).message);
      }
    }

    cache = data;
  } catch (e) {
    const error = (e as Error).message;
    console.error("Netatmo fetch failed:", error);
    const setup = e instanceof AuthError
      ? { state: "rejected" as const, fromEnv: !!envApp }
      : undefined;
    cache = { ...(cache ?? emptyData()), error, setup };
  }
}

/** One module's current readings for the log, e.g. "Köket 22.9° 37% 593ppm". */
function describe(m: Module): string {
  const parts = [m.name];
  if (m.temperature !== undefined) parts.push(`${m.temperature}°`);
  if (m.humidity !== undefined) parts.push(`${m.humidity}%`);
  if (m.co2 !== undefined) parts.push(`${m.co2}ppm`);
  if (m.pressure !== undefined) parts.push(`${m.pressure}mbar`);
  if (m.rain1h !== undefined) parts.push(`${m.rain1h}mm/h`);
  if (m.wind !== undefined) parts.push(`${m.wind}km/h`);
  if (!m.reachable) parts.push("(offline)");
  return parts.join(" ");
}

function emptyData(): WeatherData {
  return { stationName: "Weather", fetchedAt: 0, modules: [] };
}

/** Checks credentials against Netatmo and, if they work, switches to them. */
async function setup(req: Request): Promise<Response> {
  if (!netatmo) return json({ error: "Not available in demo mode" }, 404);
  if (envApp) {
    return json(
      { error: "Credentials are set with environment variables; change them there." },
      403,
    );
  }
  // Once it works, the form is closed so nobody else on the network can swap the account.
  if (netatmo.configured && cache?.setup?.state !== "rejected") {
    return json({ error: "Already set up" }, 403);
  }

  const body = await req.json().catch(() => ({})) as Partial<SetupRequest>;
  const app = {
    clientId: body.clientId?.trim() ?? "",
    clientSecret: body.clientSecret?.trim() ?? "",
  };
  const refreshToken = body.refreshToken?.trim() ?? "";
  if (!app.clientId || !app.clientSecret || !refreshToken) {
    return json({ error: "All three fields are required" }, 400);
  }

  const probe = new Netatmo({
    ...app,
    initialRefreshToken: refreshToken,
    tokenStore: { load: () => Promise.resolve(undefined), save: () => Promise.resolve() },
  });
  try {
    await probe.stations();
  } catch (e) {
    const msg = (e as Error).message;
    const error = msg.includes("invalid_client")
      ? "Netatmo didn't accept the client ID or client secret."
      : msg.includes("invalid_grant")
      ? "Netatmo didn't accept the refresh token. Generate a new one and try again."
      : `Netatmo said: ${msg}`;
    return json({ error }, 400);
  }

  await archive.setSetting(APP_SETTING, app);
  await netatmo.configure(app, probe.tokens!);
  console.log("Netatmo credentials set up from the web page");
  // Let any poll still using the old credentials finish, then fetch with the new ones.
  await inflight;
  await refresh();
  return json({ ok: true });
}

function refresh(): Promise<void> {
  inflight ??= poll().finally(() => (inflight = undefined));
  return inflight;
}

refresh();
setInterval(refresh, POLL_MS);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

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
    const body: RecordsResponse = {
      since,
      complete: DEMO || state.backfillDone,
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

/** GET /api/events, POST /api/events {at, label, moduleIds}, DELETE /api/events/:id */
async function eventsApi(req: Request, pathname: string): Promise<Response> {
  if (pathname === "/api/events" && req.method === "GET") return json(await archive.events());
  if (pathname === "/api/events" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const at = Number(body.at);
    const label = String(body.label ?? "").trim().slice(0, 100);
    const moduleIds: string[] = Array.isArray(body.moduleIds)
      ? body.moduleIds.filter((id: unknown) => typeof id === "string" && id)
      : [];
    // Netatmo weather stations exist since 2012; allow a bit of future for planned moves.
    if (!label || !(at > Date.UTC(2012, 0, 1) / 1000 && at < Date.now() / 1000 + 366 * 86400)) {
      return json({ error: "An event needs a label and a date" }, 400);
    }
    if (!moduleIds.length) return json({ error: "Pick at least one module" }, 400);
    const event = await archive.addEvent(at, label, moduleIds);
    console.log(
      `Added event "${event.label}" for ${moduleIds.join(", ")} at ` +
        new Date(event.at * 1000).toISOString(),
    );
    return json(event);
  }
  const id = Number(pathname.split("/")[3]);
  if (req.method === "DELETE" && Number.isInteger(id)) {
    await archive.deleteEvent(id);
    console.log(`Deleted event ${id}`);
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}

console.log(
  `netatmo-viewer on http://0.0.0.0:${PORT} (${DEMO ? "demo data" : "live Netatmo data"})`,
);

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/api/weather") {
    if (!cache) await refresh();
    return json(cache);
  }
  if (pathname === "/api/setup" && req.method === "POST") return setup(req);
  if (pathname.startsWith("/api/")) {
    try {
      if (pathname.startsWith("/api/events")) return await eventsApi(req, pathname);
      return await archiveApi(pathname, url.searchParams);
    } catch (e) {
      console.warn(`${pathname} failed:`, (e as Error).message);
      return json({ error: (e as Error).message }, 500);
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
