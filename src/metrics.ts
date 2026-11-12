import type { Metric, Module } from "../shared/types.ts";
import { tempColor } from "./format.ts";
import type { MessageKey } from "./i18n.ts";

export interface MetricInfo {
  /** Texts, translated with t() where shown. */
  label: MessageKey;
  unit: string;
  decimals: number;
  lowWord: MessageKey;
  highWord: MessageKey;
  color(light: boolean, value?: number): string;
}

const fixedHue = (hue: number) => (light: boolean) =>
  light ? `hsl(${hue}, 65%, 42%)` : `hsl(${hue}, 70%, 65%)`;

export const METRIC_INFO: Record<Metric, MetricInfo> = {
  temperature: {
    label: "mTemperature",
    unit: "°",
    decimals: 1,
    lowWord: "coldest",
    highWord: "warmest",
    // Tinted by the period's average: blue in winter, orange in summer.
    color: (light, v) => tempColor(v, light),
  },
  humidity: {
    label: "mHumidity",
    unit: "%",
    decimals: 0,
    lowWord: "lowest",
    highWord: "highest",
    color: fixedHue(205),
  },
  co2: {
    label: "mCo2",
    unit: " ppm",
    decimals: 0,
    lowWord: "lowest",
    highWord: "highest",
    color: fixedHue(150),
  },
  pressure: {
    label: "mPressure",
    unit: " mbar",
    decimals: 0,
    lowWord: "lowest",
    highWord: "highest",
    color: fixedHue(265),
  },
  noise: {
    label: "mNoise",
    unit: " dB",
    decimals: 0,
    lowWord: "quietest",
    highWord: "loudest",
    color: fixedHue(320),
  },
};

/** Metrics a module actually reports. */
export function metricsFor(m: Module): Metric[] {
  return (Object.keys(METRIC_INFO) as Metric[]).filter((k) => m[k] !== undefined);
}
