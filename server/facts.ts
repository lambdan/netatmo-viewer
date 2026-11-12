// Fun facts for the home view, like "Today's low of -8.3° is the coldest since 14 March".
//
// Everything is worked out from daily summaries (local days in the viewer's time zone) of the
// hourly table, so it's cheap even with years of history. The texts hold tokens the page formats
// in the viewer's locale: {t:-8.3} a temperature, {d:2025-03-14} a date, {md:11-12} a day of the
// year, {m:11} a month, {n:985} a number.

import type { Fact, Module } from "../shared/types.ts";
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

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

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

function sinceFact(
  facts: Fact[],
  days: Day[],
  idx: number,
  pick: "lo" | "hi" | "avg",
  lower: boolean,
  minGap: number,
  text: (since: string) => string,
  icon: string,
) {
  const s = since(days, idx, pick, lower);
  if (s === "record") {
    facts.push({ text: text(`on record (since {d:${days[0].day}})`), score: 95, icon });
  } else if (s && s.gap >= minGap) {
    facts.push({ text: text(`since {d:${s.day}}`), score: gapScore(s.gap), icon });
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
      sinceFact(facts, days, ti, "lo", true, 14, (s) => `Today's low of {t:${t.lo}} is the coldest ${s}`, "❄️");
      sinceFact(facts, days, ti, "hi", false, 14, (s) => `Today's high of {t:${t.hi}} is the warmest ${s}`, "☀️");
    }
    if (yesterday) {
      sinceFact(facts, days, yi, "avg", true, 21, (s) => `Yesterday was the coldest day ${s}`, "🥶");
      sinceFact(facts, days, yi, "avg", false, 21, (s) => `Yesterday was the warmest day ${s}`, "🌡️");
    }

    // Compared with this time yesterday.
    if (out.now !== undefined && out.dayAgo !== undefined) {
      const diff = r1(out.now - out.dayAgo);
      if (Math.abs(diff) < 0.5) {
        facts.push({ text: "Just about the same temperature as this time yesterday", score: 8, icon: "🔁" });
      } else {
        facts.push({
          text: `{t:${Math.abs(diff)}} ${diff > 0 ? "warmer" : "colder"} than this time yesterday`,
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
        const years = earlier.length + 1;
        if (coldRecord) {
          facts.push({ text: `The coldest {md:${md}} in ${years} years of records`, score: 80, icon: "📅" });
        } else if (warmRecord) {
          facts.push({ text: `The warmest {md:${md}} in ${years} years of records`, score: 80, icon: "📅" });
        }
      }
      const lastYear = earlier.find((d) => d.day === addDays(today, -365) || d.day === addDays(today, -366));
      if (lastYear && lastYear.day.slice(5) === md) {
        facts.push({
          text: `A year ago today it was between {t:${r1(lastYear.lo)}} and {t:${r1(lastYear.hi)}}`,
          score: 12,
          icon: "🗓️",
        });
      }
      if (earlier.length >= 1 && !coldRecord && !warmRecord) {
        const coldest = earlier.reduce((a, b) => (b.lo < a.lo ? b : a));
        const warmest = earlier.reduce((a, b) => (b.hi > a.hi ? b : a));
        facts.push({
          text: `The coldest {md:${md}} on record was in ${coldest.day.slice(0, 4)}: {t:${r1(coldest.lo)}}`,
          score: 9,
          icon: "📜",
        }, {
          text: `The warmest {md:${md}} on record was in ${warmest.day.slice(0, 4)}: {t:${r1(warmest.hi)}}`,
          score: 8,
          icon: "📜",
        });
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
        if (others.length >= 2 && others.every((o) => now < o)) {
          facts.push({ text: `The coldest start to {m:${month}} in ${others.length + 1} years`, score: 60, icon: "🧊" });
        } else if (others.length >= 2 && others.every((o) => now > o)) {
          facts.push({ text: `The warmest start to {m:${month}} in ${others.length + 1} years`, score: 60, icon: "🔥" });
        } else if (Math.abs(diff) >= 0.5) {
          facts.push({
            text: `{m:${month}} so far is {t:${Math.abs(diff)}} ${diff > 0 ? "warmer" : "colder"} than usual`,
            score: 15 + Math.abs(diff) * 3,
            icon: diff > 0 ? "📈" : "📉",
          });
        } else {
          facts.push({ text: `{m:${month}} so far is a pretty normal one`, score: 6, icon: "😐" });
        }
      }
    }

    // Freezing streaks and firsts.
    if (t && t.lo < 0) {
      const n = streak(days, ti, (d) => d.lo < 0);
      if (n >= 2) {
        facts.push({ text: `The ${ordinal(n)} night in a row below freezing`, score: 18 + n * 2, icon: "❄️" });
      } else {
        sinceFact(facts, days.map((d) => ({ ...d, lo: d.lo < 0 ? 1 : 0 })), ti, "lo", false, 30, (s) => `First frost ${s}`, "❄️");
      }
    }
    if (yesterday && yesterday.hi < 0) {
      const n = streak(days, yi, (d) => d.hi < 0);
      facts.push({
        text: n >= 2
          ? `${n} days in a row that never got above freezing`
          : "Yesterday never got above freezing",
        score: 20 + n * 3,
        icon: "🧊",
      });
    }
    if (t && t.hi >= 20) {
      sinceFact(facts, days.map((d) => ({ ...d, hi: d.hi >= 20 ? 1 : 0 })), ti, "hi", false, 60, (s) => `First day above 20° ${s}`, "🌷");
    }
    if (t && t.hi >= 25) {
      const n = streak(days, ti, (d) => d.hi >= 25);
      if (n >= 2) facts.push({ text: `The ${ordinal(n)} summer day (25°+) in a row`, score: 20 + n * 2, icon: "😎" });
    }

    // Frost nights this winter (from 1 July) vs last winter by the same date.
    const m = +today.slice(5, 7);
    if (m >= 9 || m <= 5) {
      const start = m >= 7 ? `${today.slice(0, 4)}-07-01` : `${+today.slice(0, 4) - 1}-07-01`;
      const frost = (from: string, to: string) => days.filter((d) => d.day >= from && d.day <= to && d.lo < 0).length;
      const n = frost(start, today);
      const lastStart = addDays(start, -365);
      const hasLast = days[0].day <= lastStart;
      const last = frost(lastStart, addDays(today, -365));
      if (n > 0) {
        facts.push({
          text: `${n} frost night${n === 1 ? "" : "s"} so far this winter` +
            (hasLast ? ` (last winter by now: ${last})` : ""),
          score: 11,
          icon: "⛄",
        });
      }
    }

    // Inside vs outside.
    if (out.now !== undefined && input.indoor !== undefined) {
      const diff = r1(input.indoor - out.now);
      if (diff >= 10) {
        facts.push({ text: `It's {t:${diff}} warmer inside than outside`, score: 7 + diff / 4, icon: "🏠" });
      }
    }
  }

  // Air pressure.
  const p = input.pressure;
  if (p?.length && p[p.length - 1].day === today) {
    const i = p.length - 1;
    sinceFact(facts, p, i, "lo", true, 30, (s) => `Air pressure dropped to {n:${p[i].lo}} mbar, the lowest ${s}`, "🌀");
    sinceFact(facts, p, i, "hi", false, 30, (s) => `Air pressure reached {n:${p[i].hi}} mbar, the highest ${s}`, "🌤️");
  }

  // Dry indoor air in winter.
  for (const h of input.humidity ?? []) {
    const i = h.days.length - 1;
    if (i < 0 || h.days[i].day !== today) continue;
    sinceFact(
      facts,
      h.days,
      i,
      "lo",
      true,
      30,
      (s) => `The air in ${h.name} is the driest ${s} ({n:${h.days[i].lo}}%)`,
      "🏜️",
    );
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
