// Small helpers shared by the server modules.

/** The current time in unix seconds. */
export const now = () => Math.floor(Date.now() / 1000);

/** Rounded to one decimal, the precision Netatmo reports temperatures in. */
export const round1 = (v: number) => Math.round(v * 10) / 10;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The message of something thrown, for logs and API errors. */
export const message = (e: unknown) => (e as Error).message;
