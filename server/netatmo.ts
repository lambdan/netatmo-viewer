// Minimal Netatmo Connect client: token refresh + station data + raw measurements.
// https://dev.netatmo.com/apidocumentation/weather

import type { Module, ModuleKind, Trend, WeatherData } from "../shared/types.ts";

const API = "https://api.netatmo.com";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms */
  expiresAt: number;
}

/** The client ID/secret of the user's app on dev.netatmo.com. */
export interface NetatmoApp {
  clientId: string;
  clientSecret: string;
}

export interface NetatmoConfig extends Partial<NetatmoApp> {
  initialRefreshToken?: string;
  /** Where the current tokens are kept between restarts. */
  tokenStore: {
    load(): Promise<Tokens | undefined>;
    save(tokens: Tokens): Promise<void>;
  };
}

class NetatmoError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

/** Netatmo rejected the app credentials or refresh token: they have to be entered again. */
export class AuthError extends Error {}

export class Netatmo {
  #tokens?: Tokens;
  #refreshing?: Promise<Tokens>;

  constructor(private config: NetatmoConfig) {}

  get configured(): boolean {
    return !!this.config.clientId && !!this.config.clientSecret;
  }

  /** The current tokens, once a refresh has succeeded. */
  get tokens(): Tokens | undefined {
    return this.#tokens;
  }

  /** Switches to new, already verified credentials. */
  async configure(app: NetatmoApp, tokens: Tokens) {
    this.config.clientId = app.clientId;
    this.config.clientSecret = app.clientSecret;
    // The env token belonged to the old setup.
    this.config.initialRefreshToken = undefined;
    this.#tokens = tokens;
    await this.config.tokenStore.save(tokens);
  }

  async #loadTokens(): Promise<Tokens> {
    this.#tokens ??= await this.config.tokenStore.load();
    if (this.#tokens) return this.#tokens;
    if (!this.config.initialRefreshToken) {
      throw new AuthError("No Netatmo refresh token has been set up");
    }
    // Force a refresh on first use.
    return { accessToken: "", refreshToken: this.config.initialRefreshToken, expiresAt: 0 };
  }

  async #refresh(refreshToken: string, reason: string): Promise<Tokens> {
    const res = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId ?? "",
        client_secret: this.config.clientSecret ?? "",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      const message = `Token refresh failed (${res.status}): ${text}`;
      // 400/401/403 mean bad client ID/secret or a revoked/invalid refresh token; other statuses
      // (5xx etc.) are Netatmo having trouble and worth retrying.
      throw res.status >= 400 && res.status < 500 && res.status !== 429
        ? new AuthError(message)
        : new Error(message);
    }
    const json = await res.json();
    const tokens: Tokens = {
      accessToken: json.access_token,
      // Netatmo may rotate the refresh token; always keep the newest one.
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    console.log(
      `Refreshed Netatmo access token (${reason}), valid for ${
        Math.round(json.expires_in / 60)
      } min` +
        (tokens.refreshToken !== refreshToken ? "; Netatmo also issued a new refresh token" : ""),
    );
    this.#tokens = tokens;
    try {
      await this.config.tokenStore.save(tokens);
    } catch (e) {
      // Not fatal: the tokens still work from memory, they just won't survive a restart.
      console.warn("Could not save tokens:", (e as Error).message);
    }
    return tokens;
  }

  /** `rejected` is Netatmo's complaint about the current token, which forces a refresh. */
  async #accessToken(rejected?: string): Promise<string> {
    // Polling and the backfill run concurrently; make them share a single refresh.
    if (this.#refreshing) return (await this.#refreshing).accessToken;
    const tokens = await this.#loadTokens();
    if (rejected || Date.now() >= tokens.expiresAt) {
      const reason = rejected
        ? `Netatmo rejected the old one: ${rejected}`
        : tokens.accessToken
        ? "the old one expired"
        : "first use";
      this.#refreshing = this.#refreshWithFallback(tokens, reason).finally(() => {
        this.#refreshing = undefined;
      });
      return (await this.#refreshing).accessToken;
    }
    return tokens.accessToken;
  }

  async #refreshWithFallback(tokens: Tokens, reason: string): Promise<Tokens> {
    const fallback = this.config.initialRefreshToken;
    try {
      return await this.#refresh(tokens.refreshToken, reason);
    } catch (e) {
      // A stored token that no longer works can be replaced by putting a new one in the env.
      if (!fallback || fallback === tokens.refreshToken) throw e;
      console.warn("Stored refresh token rejected, trying NETATMO_REFRESH_TOKEN");
      return await this.#refresh(fallback, reason);
    }
  }

  // deno-lint-ignore no-explicit-any
  async #get(path: string, params: Record<string, string> = {}, rejected?: string): Promise<any> {
    const token = await this.#accessToken(rejected);
    const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = json?.error?.code;
      // 2 = invalid token, 3 = expired token
      if (!rejected && (code === 2 || code === 3)) {
        return this.#get(path, params, `${json.error.message} (code ${code})`);
      }
      throw new NetatmoError(json?.error?.message ?? res.statusText, res.status, code);
    }
    return json.body;
  }

  /** Current readings of the (first) station and its modules. */
  async stations(): Promise<WeatherData> {
    const body = await this.#get("/api/getstationsdata");
    const device = body.devices?.[0];
    if (!device) throw new Error("No weather station found on this account");

    const modules: Module[] = [toModule(device, device.dashboard_data, "base")];
    for (const m of device.modules ?? []) {
      modules.push(toModule(m, m.dashboard_data, kindOf(m.type)));
    }
    // Mark the base station as unreachable if Netatmo says so.
    modules[0].reachable = device.reachable !== false;

    return {
      stationName: device.home_name ?? device.station_name ?? "Weather",
      fetchedAt: Date.now(),
      modules,
    };
  }

  /** Raw measurements at full resolution (~5 min), oldest first, at most `limit` points. */
  async measure(q: {
    deviceId: string;
    /** Omit for the base station itself. */
    moduleId?: string;
    types: string[];
    begin: number;
    end: number;
    limit: number;
  }): Promise<[number, (number | null)[]][]> {
    const params: Record<string, string> = {
      device_id: q.deviceId,
      scale: "max",
      type: q.types.join(","),
      date_begin: String(q.begin),
      date_end: String(q.end),
      limit: String(q.limit),
      optimize: "false",
      real_time: "true",
    };
    if (q.moduleId) params.module_id = q.moduleId;
    const body = await this.#get("/api/getmeasure", params);
    return Object.entries(body ?? {})
      .map(([t, v]) =>
        [Number(t), (v as (number | null)[]).map((x) => x ?? null)] as [
          number,
          (number | null)[],
        ]
      )
      .sort((a, b) => a[0] - b[0]);
  }
}

function kindOf(type: string): ModuleKind {
  switch (type) {
    case "NAModule1":
      return "outdoor";
    case "NAModule2":
      return "wind";
    case "NAModule3":
      return "rain";
    default:
      return "indoor"; // NAModule4 = extra indoor module
  }
}

function trend(t: unknown): Trend | undefined {
  return t === "up" || t === "down" || t === "stable" ? t : undefined;
}

// deno-lint-ignore no-explicit-any
function toModule(raw: any, d: any = {}, kind: ModuleKind): Module {
  return {
    id: raw._id,
    name: raw.module_name ?? (kind === "base" ? "Indoor" : kind),
    kind,
    reachable: raw.reachable !== false,
    measuredAt: d.time_utc,
    battery: raw.battery_percent,
    temperature: d.Temperature,
    tempTrend: trend(d.temp_trend),
    minTemp: d.min_temp,
    maxTemp: d.max_temp,
    minTempAt: d.date_min_temp,
    maxTempAt: d.date_max_temp,
    humidity: d.Humidity,
    co2: d.CO2,
    noise: d.Noise,
    pressure: d.Pressure,
    pressureTrend: trend(d.pressure_trend),
    rain: d.Rain,
    rain1h: d.sum_rain_1,
    rain24h: d.sum_rain_24,
    wind: d.WindStrength,
    windAngle: d.WindAngle,
    gust: d.GustStrength,
    gustAngle: d.GustAngle,
  };
}
