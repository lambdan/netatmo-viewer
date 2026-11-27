// Temperatures are stored and sent in °C everywhere; °F is only applied when showing them.

import { settings } from "./settings.ts";

export const fahrenheit = () => settings.tempUnit === "F";

/** A temperature in the chosen unit. */
export const toUnit = (c: number) => (fahrenheit() ? c * 1.8 + 32 : c);

/** A temperature difference in the chosen unit (no offset, just the scale). */
export const deltaToUnit = (d: number) => (fahrenheit() ? d * 1.8 : d);

/** Back to °C, e.g. for colours, which are tuned to °C. */
export const toCelsius = (v: number) => (fahrenheit() ? (v - 32) / 1.8 : v);

/** Where the freezing line goes on temperature charts (in the chosen unit), if it's switched on. */
export const freezingLine = () => (settings.freezingLine ? (fahrenheit() ? 32 : 0) : undefined);
