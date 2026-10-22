import type { Trend } from "../shared/types.ts";

const locale = navigator.language || "en";

const oneDecimal = new Intl.NumberFormat(locale, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
const clock = new Intl.DateTimeFormat(locale, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });

export function temp(v?: number): string {
  return v === undefined ? "–" : oneDecimal.format(v);
}

export function num(v?: number): string {
  return v === undefined ? "–" : integer.format(v);
}

export function time(unixSeconds?: number): string {
  return unixSeconds === undefined ? "" : clock.format(new Date(unixSeconds * 1000));
}

export function clockTime(d: Date): string {
  return clock.format(d);
}

export function dateLine(d: Date): string {
  return day.format(d);
}

export function trendArrow(t?: Trend): string {
  return t === "up" ? "↗" : t === "down" ? "↘" : t === "stable" ? "→" : "";
}

export function ago(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return `${h} h ago`;
}

/** Hue for a temperature: blue when cold, green when mild, orange/red when warm. */
export function tempColor(v?: number, light = false): string {
  if (v === undefined) return light ? "hsl(210, 10%, 45%)" : "hsl(210, 10%, 70%)";
  const stops: [number, number][] = [[-15, 230], [0, 200], [10, 165], [18, 95], [24, 38], [32, 8]];
  let hue = stops[0][1];
  if (v >= stops[stops.length - 1][0]) hue = stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, h0] = stops[i];
    const [t1, h1] = stops[i + 1];
    if (v >= t0 && v < t1) hue = h0 + ((v - t0) / (t1 - t0)) * (h1 - h0);
  }
  // Darker on the light theme so it stays readable on white.
  return light ? `hsl(${Math.round(hue)}, 80%, 38%)` : `hsl(${Math.round(hue)}, 75%, 62%)`;
}

/** CO2 comfort level, roughly following common indoor air guidelines. */
export function co2Level(ppm?: number): "good" | "fair" | "poor" | undefined {
  if (ppm === undefined) return undefined;
  return ppm < 1000 ? "good" : ppm < 1500 ? "fair" : "poor";
}

const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function direction(deg?: number): string {
  return deg === undefined ? "" : compass[Math.round(deg / 45) % 8];
}

const numberFormats = new Map<number, Intl.NumberFormat>();
/** Locale formatted number with a fixed number of decimals. */
export function fixed(v: number | undefined, decimals: number): string {
  if (v === undefined) return "–";
  let f = numberFormats.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(decimals, f);
  }
  return f.format(v);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
export function fmtDate(unixSeconds: number, opts: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(opts);
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { hour12: false, ...opts });
    dateFormats.set(key, f);
  }
  return f.format(new Date(unixSeconds * 1000));
}
