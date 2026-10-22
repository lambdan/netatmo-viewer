// Calendar periods for the history view, in the iPad's local time.

import { fmtDate } from "./format.ts";

export type RangeKind = "day" | "week" | "month" | "year";

export interface Tick {
  /** Where the grid line goes (unix seconds). */
  t: number;
  /** Where the label goes; defaults to `t`. */
  labelAt: number;
  label: string;
}

export interface Period {
  kind: RangeKind;
  from: number;
  to: number;
  /** Seconds per chart point. */
  bucket: number;
  label: string;
  ticks: Tick[];
  tipFormat: Intl.DateTimeFormatOptions;
}

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function startOf(kind: RangeKind, d: Date): Date {
  switch (kind) {
    case "day":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    case "week": // Monday
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    case "month":
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case "year":
      return new Date(d.getFullYear(), 0, 1);
  }
}

/** Moves `d` by `n` periods. Date's overflow handling takes care of month lengths and DST. */
export function shift(kind: RangeKind, d: Date, n: number): Date {
  const s = startOf(kind, d);
  switch (kind) {
    case "day":
      return new Date(s.getFullYear(), s.getMonth(), s.getDate() + n);
    case "week":
      return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * n);
    case "month":
      return new Date(s.getFullYear(), s.getMonth() + n, 1);
    case "year":
      return new Date(s.getFullYear() + n, 0, 1);
  }
}

export function periodFor(kind: RangeKind, anchor: Date): Period {
  const start = startOf(kind, anchor);
  const end = shift(kind, start, 1);
  const from = secs(start);
  const to = secs(end);
  const y = start.getFullYear();
  const m = start.getMonth();
  const d = start.getDate();
  const ticks: Tick[] = [];
  const at = (t: Date, label: string, labelAt = t) =>
    ticks.push({ t: secs(t), labelAt: secs(labelAt), label });

  let bucket: number;
  let label: string;
  let tipFormat: Intl.DateTimeFormatOptions;

  switch (kind) {
    case "day":
      bucket = 600;
      label = fmtDate(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      tipFormat = { hour: "2-digit", minute: "2-digit" };
      for (let h = 3; h < 24; h += 3) {
        const t = new Date(y, m, d, h);
        at(t, fmtDate(secs(t), { hour: "2-digit", minute: "2-digit" }));
      }
      break;
    case "week":
      bucket = 3600;
      label = `${fmtDate(from, { day: "numeric", month: "short" })} – ${
        fmtDate(to - 1, { day: "numeric", month: "short", year: "numeric" })
      }`;
      tipFormat = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
      for (let i = 0; i < 7; i++) {
        const t = new Date(y, m, d + i);
        at(t, fmtDate(secs(t), { weekday: "short", day: "numeric" }), new Date(y, m, d + i, 12));
      }
      break;
    case "month":
      bucket = 3 * 3600;
      label = fmtDate(from, { month: "long", year: "numeric" });
      tipFormat = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
      for (const day of [5, 10, 15, 20, 25]) {
        const t = new Date(y, m, day);
        at(t, String(day));
      }
      break;
    case "year":
      bucket = 86400;
      label = String(y);
      tipFormat = { weekday: "short", day: "numeric", month: "long" };
      for (let i = 0; i < 12; i++) {
        const t = new Date(y, i, 1);
        at(t, fmtDate(secs(t), { month: "short" }), new Date(y, i, 15));
      }
      break;
  }

  // Some locales (e.g. Swedish) don't capitalise weekdays and months.
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return { kind, from, to, bucket, label, ticks, tipFormat };
}

/** The viewer's IANA time zone, so the server can bucket by local days and months. */
export const timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Start of today, this month and this year, for the records query. */
export function recordStarts(now = new Date()) {
  return {
    today: secs(startOf("day", now)),
    month: secs(startOf("month", now)),
    year: secs(startOf("year", now)),
  };
}

/** Nice round step for about `count` grid lines across `span`. */
export function niceStep(span: number, count = 5): number {
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}
