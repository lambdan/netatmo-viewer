// Fake data so the UI can be tried without a Netatmo account (DEMO=1).

import type { WeatherData } from "../shared/types.ts";

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
