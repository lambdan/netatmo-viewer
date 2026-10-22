// Year-over-year view of monthly averages.

import type { MonthlyResponse } from "../shared/types.ts";

export interface YearTrend {
  year: number;
  /** Monthly averages, Jan..Dec; null where there's no data. */
  months: (number | null)[];
  /** Mean of this year's (well covered) monthly averages. */
  avg?: number;
  /** e.g. "Jan–Oct" when the year isn't complete. */
  partial?: string;
  /** Difference to the previous year, compared over the months both years have. */
  delta?: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function buildYears(rows: MonthlyResponse["months"], monthName: (m: number) => string): YearTrend[] {
  // A month with less than half the samples of a typical month (e.g. the month the station was
  // set up, or a long outage) would skew averages, so it's drawn but not counted.
  const maxSamples = Math.max(0, ...rows.map((r) => r[3]));
  const byYear = new Map<number, { months: (number | null)[]; good: (number | null)[] }>();
  for (const [year, month, avg, n] of rows) {
    let y = byYear.get(year);
    if (!y) {
      y = { months: new Array(12).fill(null), good: new Array(12).fill(null) };
      byYear.set(year, y);
    }
    y.months[month - 1] = avg;
    if (n >= maxSamples * 0.5) y.good[month - 1] = avg;
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((year, i) => {
    const { months, good } = byYear.get(year)!;
    const covered = good.map((v, m) => (v === null ? -1 : m)).filter((m) => m >= 0);
    const t: YearTrend = { year, months };
    if (covered.length) {
      t.avg = mean(covered.map((m) => good[m]!));
      if (covered.length < 12) {
        const first = covered[0];
        const last = covered[covered.length - 1];
        t.partial = first === last ? monthName(first) : `${monthName(first)}–${monthName(last)}`;
      }
    }
    const prev = i > 0 ? byYear.get(years[i - 1]) : undefined;
    if (prev) {
      const both = covered.filter((m) => prev.good[m] !== null);
      if (both.length) t.delta = mean(both.map((m) => good[m]!)) - mean(both.map((m) => prev.good[m]!));
    }
    return t;
  });
}

/** Oldest years blue-ish, newest orange-ish, so the newest stands out. */
export function yearColor(index: number, count: number, light: boolean): string {
  const f = count <= 1 ? 1 : index / (count - 1);
  const hue = Math.round(210 - f * 185);
  return light ? `hsl(${hue}, ${45 + f * 35}%, ${55 - f * 15}%)` : `hsl(${hue}, ${35 + f * 45}%, ${50 + f * 15}%)`;
}
