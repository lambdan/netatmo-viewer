// Fun facts for the home view, like "Today's low of -8.3° is the coldest since 14 March".
//
// Everything is worked out from daily summaries (local days in the viewer's time zone) of the
// hourly table, so it's cheap even with years of history. Each fact is an id plus values; the page
// words it in the viewer's language and formats the values in their locale and unit.

import type { Fact, FactVars, Module } from "../shared/types.ts";
import type { Archive, Metric } from "./db.ts";

export interface Day {
  /** Local date, YYYY-MM-DD */
  day: string;
  avg: number;
  lo: number;
  hi: number;
}

/** What the facts are computed from; every part is optional. */
export interface FactInput {
  /** Local date of today, YYYY-MM-DD */
  today: string;
  outdoor?: {
    temp: Day[];
    /** Current temperature and the one 24 hours ago. */
    now?: number;
    dayAgo?: number;
  };
  /** Current indoor temperature (base station), for the inside vs outside comparison. */
  indoor?: number;
  pressure?: Day[];
  /** Indoor humidity per module. */
  humidity?: { name: string; days: Day[] }[];
}

const DAY_MS = 86400 * 1000;
const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;
const daysBetween = (a: string, b: string) => Math.round(dayNumber(b) - dayNumber(a));
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Finds the most recent day before today at least as extreme as today's value. Returns how many
 * days ago that was, or "record" if there is none in at least a year of history.
 */
function since(
  days: Day[],
  todayIdx: number,
  pick: "lo" | "hi" | "avg",
  lower: boolean,
): { day: string; gap: number } | "record" | undefined {
  const v = days[todayIdx][pick];
  for (let i = todayIdx - 1; i >= 0; i--) {
    const x = days[i][pick];
    if (lower ? x <= v : x >= v) return { day: days[i].day, gap: daysBetween(days[i].day, days[todayIdx].day) };
  }
  return daysBetween(days[0].day, days[todayIdx].day) >= 365 ? "record" : undefined;
}

/** Score for an "X since" fact: rarer is more interesting. */
const gapScore = (gap: number) => Math.min(90, 20 + Math.sqrt(gap) * 3);

/**
 * Adds an "... since <d>" fact when it's been at least `minGap` days, or "... on record" (rec: 1,
 * d: the first day of history) when it has never happened before.
 */
function sinceFact(
  facts: Fact[],
  days: Day[],
  idx: number,
  pick: "lo" | "hi" | "avg",
  lower: boolean,
  minGap: number,
  id: string,
  vars: FactVars,
  icon: string,
) {
  const s = since(days, idx, pick, lower);
  if (s === "record") {
    facts.push({ id, vars: { ...vars, d: days[0].day, rec: 1 }, score: 95, icon });
  } else if (s && s.gap >= minGap) {
    facts.push({ id, vars: { ...vars, d: s.day }, score: gapScore(s.gap), icon });
  }
}

/** Number of days in a row, ending at index `end`, that match. */
function streak(days: Day[], end: number, match: (d: Day) => boolean): number {
  let n = 0;
  for (let i = end; i >= 0 && match(days[i]); i--) {
    // A missing day (module offline) breaks the streak.
    if (i < end && daysBetween(days[i].day, days[i + 1].day) !== 1) break;
    n++;
  }
  return n;
}

export function computeFacts(input: FactInput): Fact[] {
  const facts: Fact[] = [];
  const { today } = input;
  const out = input.outdoor;

  if (out && out.temp.length) {
    const days = out.temp;
    const ti = days.length - 1;
    const hasToday = days[ti].day === today;
    const t = hasToday ? days[ti] : undefined;
    const yi = hasToday ? ti - 1 : ti;
    const yesterday = days[yi]?.day === addDays(today, -1) ? days[yi] : undefined;

    if (t) {
      sinceFact(facts, days, ti, "lo", true, 14, "lowSince", { t: t.lo }, "❄️");
      sinceFact(facts, days, ti, "hi", false, 14, "highSince", { t: t.hi }, "☀️");
    }
    if (yesterday) {
      sinceFact(facts, days, yi, "avg", true, 21, "coldestDaySince", {}, "🥶");
      sinceFact(facts, days, yi, "avg", false, 21, "warmestDaySince", {}, "🌡️");
    }

    // Compared with this time yesterday.
    if (out.now !== undefined && out.dayAgo !== undefined) {
      const diff = r1(out.now - out.dayAgo);
      if (Math.abs(diff) < 0.5) {
        facts.push({ id: "sameAsYesterday", vars: {}, score: 8, icon: "🔁" });
      } else {
        facts.push({
          id: diff > 0 ? "warmerThanYesterday" : "colderThanYesterday",
          vars: { dt: Math.abs(diff) },
          score: 10 + Math.abs(diff) * 3,
          icon: diff > 0 ? "📈" : "📉",
        });
      }
    }

    // The same date in earlier years.
    if (t) {
      const md = today.slice(5);
      const earlier = days.filter((d) => d.day.slice(5) === md && d.day < today);
      const coldRecord = earlier.length >= 1 && t.lo < Math.min(...earlier.map((d) => d.lo));
      const warmRecord = earlier.length >= 1 && t.hi > Math.max(...earlier.map((d) => d.hi));
      if (earlier.length >= 2) {
        const n = earlier.length + 1;
        if (coldRecord) {
          facts.push({ id: "coldestDate", vars: { md, n }, score: 80, icon: "📅" });
        } else if (warmRecord) {
          facts.push({ id: "warmestDate", vars: { md, n }, score: 80, icon: "📅" });
        }
      }
      const lastYear = earlier.find((d) => d.day === addDays(today, -365) || d.day === addDays(today, -366));
      if (lastYear && lastYear.day.slice(5) === md) {
        facts.push({ id: "yearAgo", vars: { t: r1(lastYear.lo), t2: r1(lastYear.hi) }, score: 12, icon: "🗓️" });
      }
      if (earlier.length >= 1 && !coldRecord && !warmRecord) {
        const coldest = earlier.reduce((a, b) => (b.lo < a.lo ? b : a));
        const warmest = earlier.reduce((a, b) => (b.hi > a.hi ? b : a));
        facts.push(
          { id: "dateColdestWas", vars: { md, y: coldest.day.slice(0, 4), t: r1(coldest.lo) }, score: 9, icon: "📜" },
          { id: "dateWarmestWas", vars: { md, y: warmest.day.slice(0, 4), t: r1(warmest.hi) }, score: 8, icon: "📜" },
        );
      }
    }

    // This month so far vs the same days of the month in earlier years.
    const dom = +today.slice(8);
    if (dom >= 3) {
      const ym = today.slice(0, 7);
      const month = today.slice(5, 7);
      const mean = (ds: Day[]) => ds.reduce((s, d) => s + d.avg, 0) / ds.length;
      const thisMonth = days.filter((d) => d.day.startsWith(ym));
      const byYear = new Map<string, Day[]>();
      for (const d of days) {
        if (d.day.slice(5, 7) !== month || d.day >= ym || +d.day.slice(8) > dom) continue;
        const y = d.day.slice(0, 4);
        byYear.set(y, [...(byYear.get(y) ?? []), d]);
      }
      // Only years with (nearly) every day, so a half-recorded month doesn't skew it.
      const others = [...byYear.values()].filter((ds) => ds.length >= dom - 1).map(mean);
      if (thisMonth.length >= dom - 1 && others.length) {
        const now = mean(thisMonth);
        const usual = others.reduce((a, b) => a + b, 0) / others.length;
        const diff = r1(now - usual);
        const m = +month;
        if (others.length >= 2 && others.every((o) => now < o)) {
          facts.push({ id: "coldestStart", vars: { m, n: others.length + 1 }, score: 60, icon: "🧊" });
        } else if (others.length >= 2 && others.every((o) => now > o)) {
          facts.push({ id: "warmestStart", vars: { m, n: others.length + 1 }, score: 60, icon: "🔥" });
        } else if (Math.abs(diff) >= 0.5) {
          facts.push({
            id: diff > 0 ? "monthWarmer" : "monthColder",
            vars: { m, dt: Math.abs(diff) },
            score: 15 + Math.abs(diff) * 3,
            icon: diff > 0 ? "📈" : "📉",
          });
        } else {
          facts.push({ id: "monthNormal", vars: { m }, score: 6, icon: "😐" });
        }
      }
    }

    // Freezing streaks and firsts.
    if (t && t.lo < 0) {
      const n = streak(days, ti, (d) => d.lo < 0);
      if (n >= 2) {
        facts.push({ id: "frostNights", vars: { o: n }, score: 18 + n * 2, icon: "❄️" });
      } else {
        const frosty = days.map((d) => ({ ...d, lo: d.lo < 0 ? 1 : 0 }));
        sinceFact(facts, frosty, ti, "lo", false, 30, "firstFrostSince", {}, "❄️");
      }
    }
    if (yesterday && yesterday.hi < 0) {
      const n = streak(days, yi, (d) => d.hi < 0);
      facts.push(
        n >= 2
          ? { id: "iceDays", vars: { n }, score: 20 + n * 3, icon: "🧊" }
          : { id: "iceYesterday", vars: {}, score: 23, icon: "🧊" },
      );
    }
    if (t && t.hi >= 20) {
      const warm = days.map((d) => ({ ...d, hi: d.hi >= 20 ? 1 : 0 }));
      sinceFact(facts, warm, ti, "hi", false, 60, "firstWarmSince", { t: 20 }, "🌷");
    }
    if (t && t.hi >= 25) {
      const n = streak(days, ti, (d) => d.hi >= 25);
      if (n >= 2) facts.push({ id: "summerStreak", vars: { o: n, t: 25 }, score: 20 + n * 2, icon: "😎" });
    }

    // Frost nights this winter (from 1 July) vs last winter by the same date.
    const month = +today.slice(5, 7);
    if (month >= 9 || month <= 5) {
      const start = month >= 7 ? `${today.slice(0, 4)}-07-01` : `${+today.slice(0, 4) - 1}-07-01`;
      const frost = (from: string, to: string) => days.filter((d) => d.day >= from && d.day <= to && d.lo < 0).length;
      const n = frost(start, today);
      const lastStart = addDays(start, -365);
      if (n > 0) {
        const vars: FactVars = { n };
        if (days[0].day <= lastStart) vars.n2 = frost(lastStart, addDays(today, -365));
        facts.push({ id: "frostWinter", vars, score: 11, icon: "⛄" });
      }
    }

    // Inside vs outside.
    if (out.now !== undefined && input.indoor !== undefined) {
      const diff = r1(input.indoor - out.now);
      if (diff >= 10) facts.push({ id: "insideWarmer", vars: { dt: diff }, score: 7 + diff / 4, icon: "🏠" });
    }
  }

  // Air pressure.
  const p = input.pressure;
  if (p?.length && p[p.length - 1].day === today) {
    const i = p.length - 1;
    sinceFact(facts, p, i, "lo", true, 30, "pressureLowSince", { n: p[i].lo }, "🌀");
    sinceFact(facts, p, i, "hi", false, 30, "pressureHighSince", { n: p[i].hi }, "🌤️");
  }

  // Dry indoor air in winter.
  for (const h of input.humidity ?? []) {
    const i = h.days.length - 1;
    if (i < 0 || h.days[i].day !== today) continue;
    sinceFact(facts, h.days, i, "lo", true, 30, "driestSince", { name: h.name, n: h.days[i].lo }, "🏜️");
  }

  return facts.sort((a, b) => b.score - a.score);
}

function addDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Local date (YYYY-MM-DD) of a unix time in a time zone. */
function localDay(fmt: Intl.DateTimeFormat, unixSeconds: number): string {
  // en-CA formats dates as YYYY-MM-DD.
  return fmt.format(new Date(unixSeconds * 1000));
}

/** Loads what computeFacts needs from the archive. */
export async function loadFacts(archive: Archive, modules: Module[], tz: string): Promise<Fact[]> {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const now = Math.floor(Date.now() / 1000);
  const daily = async (id: string, metric: Metric): Promise<Day[]> =>
    (await archive.series(id, metric, 0, now + 1, 86400, tz)).map(([t, avg, lo, hi]) => ({
      day: localDay(fmt, t),
      avg,
      lo,
      hi,
    }));

  const input: FactInput = { today: localDay(fmt, now) };
  const outdoor = modules.find((m) => m.kind === "outdoor");
  const base = modules.find((m) => m.kind === "base");

  const tasks: Promise<void>[] = [];
  if (outdoor) {
    tasks.push((async () => {
      const [temp, latest, ago] = await Promise.all([
        daily(outdoor.id, "temperature"),
        archive.latest(outdoor.id),
        archive.series(outdoor.id, "temperature", now - 24 * 3600 - 1800, now - 24 * 3600 + 1800, 300, tz),
      ]);
      // The reading closest to exactly 24 hours ago.
      const target = now - 24 * 3600;
      const dayAgo = ago.length
        ? ago.reduce((a, b) => (Math.abs(b[0] - target) < Math.abs(a[0] - target) ? b : a))[1]
        : undefined;
      input.outdoor = { temp, now: latest?.[1].temperature, dayAgo };
    })());
  }
  if (base) {
    input.indoor = base.temperature;
    tasks.push((async () => {
      input.pressure = await daily(base.id, "pressure");
    })());
  }
  const indoors = modules.filter((m) => m.kind === "base" || m.kind === "indoor");
  tasks.push((async () => {
    input.humidity = await Promise.all(
      indoors.map(async (m) => ({ name: m.name, days: await daily(m.id, "humidity") })),
    );
  })());
  await Promise.all(tasks);
  return computeFacts(input);
}
