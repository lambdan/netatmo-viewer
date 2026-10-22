import type { Metric, Module } from "../shared/types.ts";
import { tempColor } from "./format.ts";

export interface MetricInfo {
  label: string;
  unit: string;
  decimals: number;
  lowWord: string;
  highWord: string;
  color(light: boolean, value?: number): string;
}

const fixedHue = (hue: number) => (light: boolean) =>
  light ? `hsl(${hue}, 65%, 42%)` : `hsl(${hue}, 70%, 65%)`;

export const METRIC_INFO: Record<Metric, MetricInfo> = {
  temperature: {
    label: "Temp",
    unit: "°",
    decimals: 1,
    lowWord: "Coldest",
    highWord: "Warmest",
    // Tinted by the period's average: blue in winter, orange in summer.
    color: (light, v) => tempColor(v, light),
  },
  humidity: {
    label: "Humidity",
    unit: "%",
    decimals: 0,
    lowWord: "Lowest",
    highWord: "Highest",
    color: fixedHue(205),
  },
  co2: {
    label: "CO₂",
    unit: " ppm",
    decimals: 0,
    lowWord: "Lowest",
    highWord: "Highest",
    color: fixedHue(150),
  },
  pressure: {
    label: "Pressure",
    unit: " mbar",
    decimals: 0,
    lowWord: "Lowest",
    highWord: "Highest",
    color: fixedHue(265),
  },
  noise: {
    label: "Noise",
    unit: " dB",
    decimals: 0,
    lowWord: "Quietest",
    highWord: "Loudest",
    color: fixedHue(320),
  },
};

/** Metrics a module actually reports. */
export function metricsFor(m: Module): Metric[] {
  return (Object.keys(METRIC_INFO) as Metric[]).filter((k) => m[k] !== undefined);
}
