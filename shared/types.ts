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

export type Metric = "temperature" | "humidity" | "co2" | "pressure" | "noise";

/** /api/history: [bucket start, avg, min, max] */
export interface SeriesResponse {
  points: [number, number, number, number][];
}

export type RecordPeriod = "today" | "month" | "year" | "all";

/** /api/records */
export interface RecordsResponse {
  /** Oldest archived measurement for the module. */
  since?: number;
  /** False while the backfill is still importing older history. */
  complete: boolean;
  /** min/max as [value, unix seconds] */
  periods: Record<RecordPeriod, { min?: [number, number]; max?: [number, number] }>;
}

/** /api/monthly: [year, month 1-12, average, samples] */
export interface MonthlyResponse {
  months: [number, number, number, number][];
}
