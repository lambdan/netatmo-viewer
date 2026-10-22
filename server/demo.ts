// Fake data so the UI can be tried without a Netatmo account (DEMO=1).

import type { WeatherData } from "../shared/types.ts";
import type { Archive, Row } from "./db.ts";

function curve(base: number, amp: number, phase: number): [number, number][] {
  const now = Math.floor(Date.now() / 1000);
  const out: [number, number][] = [];
  for (let t = now - 24 * 3600; t <= now; t += 1800) {
    const hour = (t / 3600) % 24;
    const v = base + amp * Math.sin(((hour - phase) / 24) * 2 * Math.PI) + Math.random() * 0.3;
    out.push([t, Math.round(v * 10) / 10]);
  }
  return out;
}

export function demoData(): WeatherData {
  const now = Math.floor(Date.now() / 1000);
  const outdoor = curve(7, 4, 9);
  const living = curve(21.5, 0.8, 12);
  const bedroom = curve(19, 0.6, 14);
  const last = (h: [number, number][]) => h[h.length - 1][1];
  const min = (h: [number, number][]) => Math.min(...h.map((p) => p[1]));
  const max = (h: [number, number][]) => Math.max(...h.map((p) => p[1]));

  return {
    stationName: "Home (demo)",
    fetchedAt: Date.now(),
    demo: true,
    modules: [
      {
        id: "base",
        name: "Living room",
        kind: "base",
        reachable: true,
        measuredAt: now - 120,
        temperature: last(living),
        tempTrend: "stable",
        minTemp: min(living),
        maxTemp: max(living),
        humidity: 41,
        co2: 734,
        noise: 38,
        pressure: 1013.4,
        pressureTrend: "down",
        history: living,
      },
      {
        id: "outdoor",
        name: "Outdoor",
        kind: "outdoor",
        reachable: true,
        measuredAt: now - 200,
        battery: 72,
        temperature: last(outdoor),
        tempTrend: "down",
        minTemp: min(outdoor),
        maxTemp: max(outdoor),
        minTempAt: now - 8 * 3600,
        maxTempAt: now - 3 * 3600,
        humidity: 83,
        history: outdoor,
      },
      {
        id: "bedroom",
        name: "Bedroom",
        kind: "indoor",
        reachable: true,
        measuredAt: now - 250,
        battery: 18,
        temperature: last(bedroom),
        tempTrend: "up",
        minTemp: min(bedroom),
        maxTemp: max(bedroom),
        humidity: 47,
        co2: 1240,
        history: bedroom,
      },
    ],
  };
}

/** Fills an (in-memory) archive with ~2 years of plausible 30 minute data for the demo modules. */
export async function seedDemoArchive(archive: Archive) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 2 * 365 * 24 * 3600 - 60 * 24 * 3600;
  const step = 1800;
  const year = 365.25 * 24 * 3600;
  let pressure = 1013;

  const outdoor: Row[] = [];
  const living: Row[] = [];
  const bedroom: Row[] = [];
  for (let t = start; t <= now; t += step) {
    // Coldest around late January, warmest late July, slowly warming over the years.
    const season = -Math.cos(((t / year) % 1 - 0.06) * 2 * Math.PI);
    const daily = Math.sin((((t / 3600) % 24) - 9) / 24 * 2 * Math.PI);
    const weather = Math.sin(t / 290000) * 2.5 + Math.sin(t / 61000) * 1.5;
    const trend = ((t - start) / year) * 0.3;
    const out = 7 + 10 * season + (3 + 2 * season) * daily + weather + trend;
    pressure = Math.min(1045, Math.max(975, pressure + (Math.random() - 0.5) * 0.8));

    outdoor.push([t, [round(out), Math.round(80 - 15 * season - 8 * daily)]]);
    living.push([t, [
      round(21.5 + 0.8 * daily + 0.3 * season),
      Math.round(40 + 8 * season),
      Math.round(550 + 350 * Math.max(0, daily)),
      round(pressure),
      Math.round(35 + 10 * Math.max(0, daily)),
    ]]);
    bedroom.push([t, [
      round(19.5 + 0.6 * daily + 0.5 * season),
      Math.round(45 + 6 * season),
      Math.round(600 + 600 * Math.max(0, -daily)),
    ]]);
  }
  for (const m of demoData().modules) await archive.upsertModule(m);
  await archive.insert("outdoor", ["temperature", "humidity"], outdoor);
  await archive.insert("base", ["temperature", "humidity", "co2", "pressure", "noise"], living);
  await archive.insert("bedroom", ["temperature", "humidity", "co2"], bedroom);
  await archive.addEvent(now - 400 * 24 * 3600, "Moved to the new house", ["base", "outdoor"]);
  await archive.addEvent(now - 120 * 24 * 3600, "Moved next to the window", ["bedroom"]);
}

const round = (v: number) => Math.round(v * 10) / 10;
