// Shape of /api/weather, shared by the Deno server and the Vue app.

export type Trend = "up" | "down" | "stable";

export type ModuleKind = "base" | "outdoor" | "indoor" | "rain" | "wind";

export interface Module {
  id: string;
  name: string;
  kind: ModuleKind;
  reachable: boolean;
  /** Unix seconds of the module's last measurement. */
  measuredAt?: number;
  /** 0-100, only for battery powered modules. */
  battery?: number;

  temperature?: number;
  tempTrend?: Trend;
  minTemp?: number;
  maxTemp?: number;
  minTempAt?: number;
  maxTempAt?: number;
  humidity?: number;
  co2?: number;
  noise?: number;
  /** Sea level pressure in mbar (base station only). */
  pressure?: number;
  pressureTrend?: Trend;

  rain?: number;
  rain1h?: number;
  rain24h?: number;

  wind?: number;
  windAngle?: number;
  gust?: number;
  gustAngle?: number;

  /** Last 24h of temperature as [unix seconds, °C]. */
  history?: [number, number][];
}

export interface WeatherData {
  stationName: string;
  /** Unix ms when the server last fetched successfully. */
  fetchedAt: number;
  modules: Module[];
  /** Set when the latest fetch failed; modules then hold the last good data. */
  error?: string;
  demo?: boolean;
}
