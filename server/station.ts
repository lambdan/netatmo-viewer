// The current readings shown on the home view (/api/weather): polled from Netatmo, completed from
// the archive, plus the Shelly sensors. Also handles connecting a Netatmo account from the page.

import type { Module, SetupRequest, WeatherData } from "../shared/types.ts";
import type { Archive } from "./db.ts";
import { demoData } from "./demo.ts";
import { AuthError, Netatmo, type NetatmoApp } from "./netatmo.ts";
import type { Shelly } from "./shelly.ts";
import type { Sync } from "./sync.ts";
import { message, now, round1 } from "./util.ts";

/** Where the app credentials from the setup form are stored. */
export const APP_SETTING = "netatmo_app";
// Modules report every 5 minutes and upload every ~10; this long without a reading means offline.
const STALE_SECONDS = 40 * 60;

export interface StationConfig {
  archive: Archive;
  shelly: Shelly;
  /** Missing in demo mode. */
  netatmo?: Netatmo;
  sync?: Sync;
  /** The credentials are set with environment variables, so the page can't change them. */
  appFromEnv: boolean;
}

export class Station {
  #data?: WeatherData;
  #inflight?: Promise<void>;
  /** Modules Netatmo currently sends no current readings for, to log changes only once. */
  #missingCurrent = new Set<string>();

  constructor(private config: StationConfig) {}

  /** The latest data, fetched first if there is none yet. */
  async data(): Promise<WeatherData> {
    if (!this.#data) await this.refresh();
    return this.#data!;
  }

  /** Modules from the latest data, without waiting for a fetch. */
  get modules(): Module[] {
    return this.#data?.modules ?? [];
  }

  /** Polls Netatmo; concurrent calls share one poll. */
  refresh(): Promise<void> {
    this.#inflight ??= this.#poll().finally(() => (this.#inflight = undefined));
    return this.#inflight;
  }

  async #poll() {
    const { netatmo, sync, appFromEnv } = this.config;
    if (!netatmo || !sync) {
      const data = demoData();
      data.modules.push(...await this.#shellyModules());
      this.#data = data;
      return;
    }
    if (!netatmo.configured) {
      this.#data = { ...emptyData(), setup: { state: "required", fromEnv: false } };
      return;
    }
    try {
      const data = await netatmo.stations();
      await sync.update(data.modules);
      await this.#fillFromArchive(data.modules);
      console.log(`Polled ${data.stationName}: ${data.modules.map(describe).join(" · ")}`);
      await this.#addHistory(data.modules);
      data.modules.push(...await this.#shellyModules());
      this.#data = data;
    } catch (e) {
      const error = message(e);
      console.error("Netatmo fetch failed:", error);
      const setup = e instanceof AuthError
        ? { state: "rejected" as const, fromEnv: appFromEnv }
        : undefined;
      this.#data = { ...(this.#data ?? emptyData()), error, setup };
    }
  }

  /**
   * The 24h chart comes from the archive, in 30 minute buckets. If the database is having trouble,
   * still show the current readings.
   */
  async #addHistory(modules: Module[]) {
    const t = now();
    for (const m of modules) {
      if (m.temperature === undefined) continue;
      try {
        const points = await this.config.archive.series(
          m.id,
          "temperature",
          t - 24 * 3600,
          t + 1,
          1800,
          "UTC",
        );
        m.history = points.map(([t, avg]) => [t, round1(avg)]);
        // Min/max over the last 24 hours rather than Netatmo's "since midnight", which right
        // after midnight is just the current reading.
        const { min, max } = await this.config.archive.extremes(
          m.id,
          "temperature",
          t - 24 * 3600,
        );
        if (min && max) {
          [m.minTemp, m.minTempAt] = min;
          [m.maxTemp, m.maxTempAt] = max;
        }
      } catch (e) {
        console.warn(`24h history for ${m.name} failed:`, message(e));
      }
    }
  }

  async #shellyModules(): Promise<Module[]> {
    const modules = this.config.shelly.modules();
    await this.#addHistory(modules);
    return modules;
  }

  /** Swaps fresh Shelly readings into the current data, without waiting for the next poll. */
  async updateShelly() {
    try {
      const modules = await this.#shellyModules();
      if (!this.#data) return;
      const { shelly } = this.config;
      this.#data = {
        ...this.#data,
        modules: [...this.#data.modules.filter((m) => !shelly.has(m.id)), ...modules],
      };
    } catch (e) {
      console.warn("Updating Shelly readings failed:", message(e));
    }
  }

  /**
   * Netatmo's current-status endpoint sometimes reports modules as unreachable without any current
   * values, while their measurements keep arriving. So "online" is decided from the archive (a
   * reading in the last STALE_SECONDS), and missing values are filled in from the newest reading.
   */
  async #fillFromArchive(modules: Module[]) {
    const t = now();
    for (const m of modules) {
      const missing = m.measuredAt === undefined;
      if (missing !== this.#missingCurrent.has(m.id)) {
        if (missing) {
          this.#missingCurrent.add(m.id);
          console.log(
            `Netatmo sent no current readings for ${m.name} (reachable=${m.reachable}); ` +
              "using the newest archived reading instead",
          );
        } else {
          this.#missingCurrent.delete(m.id);
          console.log(`Netatmo is sending current readings for ${m.name} again`);
        }
      }
      try {
        const latest = await this.config.archive.latest(m.id);
        if (latest && latest[0] > (m.measuredAt ?? 0)) {
          const [ts, values] = latest;
          m.measuredAt = ts;
          Object.assign(m, values);
          // Netatmo's trends belong to its own (older or missing) reading.
          m.tempTrend = undefined;
          m.pressureTrend = undefined;
        }
      } catch (e) {
        console.warn(`latest reading for ${m.name} failed:`, message(e));
      }
      if (m.measuredAt !== undefined) m.reachable = t - m.measuredAt < STALE_SECONDS;
    }
  }

  /**
   * Checks credentials from the setup form against Netatmo and, if they work, switches to them.
   * Returns an HTTP status and, if it didn't work, why.
   */
  async setup(body: Partial<SetupRequest>): Promise<{ status: number; error?: string }> {
    const { netatmo, archive, appFromEnv } = this.config;
    if (!netatmo) return { status: 404, error: "Not available in demo mode" };
    if (appFromEnv) {
      return {
        status: 403,
        error: "Credentials are set with environment variables; change them there.",
      };
    }
    // Once it works, the form is closed so nobody else on the network can swap the account.
    if (netatmo.configured && this.#data?.setup?.state !== "rejected") {
      return { status: 403, error: "Already set up" };
    }

    const app: NetatmoApp = {
      clientId: body.clientId?.trim() ?? "",
      clientSecret: body.clientSecret?.trim() ?? "",
    };
    const refreshToken = body.refreshToken?.trim() ?? "";
    if (!app.clientId || !app.clientSecret || !refreshToken) {
      return { status: 400, error: "All three fields are required" };
    }

    const probe = new Netatmo({
      ...app,
      initialRefreshToken: refreshToken,
      tokenStore: { load: () => Promise.resolve(undefined), save: () => Promise.resolve() },
    });
    try {
      await probe.stations();
    } catch (e) {
      const msg = message(e);
      const error = msg.includes("invalid_client")
        ? "Netatmo didn't accept the client ID or client secret."
        : msg.includes("invalid_grant")
        ? "Netatmo didn't accept the refresh token. Generate a new one and try again."
        : `Netatmo said: ${msg}`;
      return { status: 400, error };
    }

    await archive.setSetting(APP_SETTING, app);
    await netatmo.configure(app, probe.tokens!);
    console.log("Netatmo credentials set up from the web page");
    // Let any poll still using the old credentials finish, then fetch with the new ones.
    await this.#inflight;
    await this.refresh();
    return { status: 200 };
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
  if (!m.reachable) {
    parts.push(
      m.measuredAt
        ? `(offline, last reading ${new Date(m.measuredAt * 1000).toISOString()})`
        : "(offline, no readings)",
    );
  }
  return parts.join(" ");
}

function emptyData(): WeatherData {
  return { stationName: "Weather", fetchedAt: 0, modules: [] };
}
