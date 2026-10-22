// Minimal Netatmo Connect client: token refresh + station data + temperature history.
// https://dev.netatmo.com/apidocumentation/weather

import type { Module, ModuleKind, Trend, WeatherData } from "../shared/types.ts";

const API = "https://api.netatmo.com";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms */
  expiresAt: number;
}

export interface NetatmoConfig {
  clientId: string;
  clientSecret: string;
  initialRefreshToken?: string;
  dataDir: string;
}

class NetatmoError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

export class Netatmo {
  #tokens?: Tokens;
  #tokenFile: string;

  constructor(private config: NetatmoConfig) {
    this.#tokenFile = `${config.dataDir}/tokens.json`;
  }

  async #loadTokens(): Promise<Tokens> {
    if (this.#tokens) return this.#tokens;
    try {
      this.#tokens = JSON.parse(await Deno.readTextFile(this.#tokenFile));
      return this.#tokens!;
    } catch {
      if (!this.config.initialRefreshToken) {
        throw new Error(
          `No tokens in ${this.#tokenFile} and NETATMO_REFRESH_TOKEN is not set`,
        );
      }
      // Force a refresh on first use.
      return { accessToken: "", refreshToken: this.config.initialRefreshToken, expiresAt: 0 };
    }
  }

  async #refresh(refreshToken: string): Promise<Tokens> {
    const res = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json();
    const tokens: Tokens = {
      accessToken: json.access_token,
      // Netatmo may rotate the refresh token; always keep the newest one.
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    };
    await Deno.mkdir(this.config.dataDir, { recursive: true });
    await Deno.writeTextFile(this.#tokenFile, JSON.stringify(tokens, null, 2));
    this.#tokens = tokens;
    return tokens;
  }

  async #accessToken(forceRefresh = false): Promise<string> {
    let tokens = await this.#loadTokens();
    if (forceRefresh || Date.now() >= tokens.expiresAt) {
      const fallback = this.config.initialRefreshToken;
      try {
        tokens = await this.#refresh(tokens.refreshToken);
      } catch (e) {
        // A stored token that no longer works can be replaced by putting a new one in the env.
        if (!fallback || fallback === tokens.refreshToken) throw e;
        console.warn("Stored refresh token rejected, trying NETATMO_REFRESH_TOKEN");
        tokens = await this.#refresh(fallback);
      }
    }
    return tokens.accessToken;
  }

  // deno-lint-ignore no-explicit-any
  async #get(path: string, params: Record<string, string> = {}, retried = false): Promise<any> {
    const token = await this.#accessToken(retried);
    const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = json?.error?.code;
      // 2 = invalid token, 3 = expired token
      if (!retried && (code === 2 || code === 3)) return this.#get(path, params, true);
      throw new NetatmoError(json?.error?.message ?? res.statusText, res.status, code);
    }
    return json.body;
  }

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

  /** Last 24h of temperature, 30 min resolution. */
  async history(deviceId: string, moduleId?: string): Promise<[number, number][]> {
    const params: Record<string, string> = {
      device_id: deviceId,
      scale: "30min",
      type: "temperature",
      date_begin: String(Math.floor(Date.now() / 1000) - 24 * 3600),
      optimize: "false",
      real_time: "true",
    };
    if (moduleId) params.module_id = moduleId;
    const body = await this.#get("/api/getmeasure", params);
    return Object.entries(body ?? {})
      .map(([t, v]) => [Number(t), (v as number[])[0]] as [number, number])
      .filter(([, v]) => typeof v === "number")
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
