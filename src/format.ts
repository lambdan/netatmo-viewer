import type { Trend } from "../shared/types.ts";
import { deltaToUnit, toUnit } from "./units.ts";
import { locale, t } from "./i18n.ts";

// Formatters are slow to create on old Safari, so they're kept per locale and options. Reading
// locale() here also makes the views update when the language is changed.
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale() + JSON.stringify(opts);
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, f = new Intl.NumberFormat(locale(), opts));
  return f;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale() + JSON.stringify(opts);
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, f = new Intl.DateTimeFormat(locale(), { hour12: false, ...opts }));
  return f;
}

const oneDecimal = () => numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integer = () => numberFormat({ maximumFractionDigits: 0 });
const clock = () => dateFormat({ hour: "2-digit", minute: "2-digit" });
const day = () => dateFormat({ weekday: "long", day: "numeric", month: "long" });

/** A temperature (given in °C) in the chosen unit, without the degree sign. */
export function temp(v?: number): string {
  return v === undefined ? "–" : oneDecimal().format(toUnit(v));
}

/** A temperature difference (given in °C) in the chosen unit. */
export function tempDelta(v: number): string {
  return oneDecimal().format(deltaToUnit(v));
}

export function num(v?: number): string {
  return v === undefined ? "–" : integer().format(v);
}

export function time(unixSeconds?: number): string {
  return unixSeconds === undefined ? "" : clock().format(new Date(unixSeconds * 1000));
}

export function clockTime(d: Date): string {
  return clock().format(d);
}

/** "Thursday, November 12" / "Torsdag 12 november": only the first letter is capitalised. */
export function dateLine(d: Date): string {
  const s = day().format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function trendArrow(t?: Trend): string {
  return t === "up" ? "↗" : t === "down" ? "↘" : t === "stable" ? "→" : "";
}

export function ago(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return t("justNow");
  if (min < 60) return t("minAgo", { n: min });
  return t("hAgo", { n: Math.round(min / 60) });
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

/** Locale formatted number with a fixed number of decimals. */
export function fixed(v: number | undefined, decimals: number): string {
  if (v === undefined) return "–";
  return numberFormat({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

export function fmtDate(unixSeconds: number, opts: Intl.DateTimeFormatOptions): string {
  return dateFormat(opts).format(new Date(unixSeconds * 1000));
}
