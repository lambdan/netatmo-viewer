// Copies Netatmo's measurement history into the local archive: new data on every poll, and a
// slow background backfill that walks back to the day the station was set up.

import type { Module, ModuleKind } from "../shared/types.ts";
import type { Archive, Column, Row } from "./db.ts";
import type { Netatmo } from "./netatmo.ts";

/** Netatmo measure type -> archive column, per module kind. */
const TYPES: Record<ModuleKind, [string, Column][]> = {
  base: [
    ["temperature", "temperature"],
    ["humidity", "humidity"],
    ["co2", "co2"],
    ["pressure", "pressure"],
    ["noise", "noise"],
  ],
  outdoor: [["temperature", "temperature"], ["humidity", "humidity"]],
  indoor: [["temperature", "temperature"], ["humidity", "humidity"], ["co2", "co2"]],
  rain: [["rain", "rain"]],
  wind: [
    ["windstrength", "wind_strength"],
    ["windangle", "wind_angle"],
    ["guststrength", "gust_strength"],
    ["gustangle", "gust_angle"],
  ],
};

/** getmeasure returns at most this many points per call. */
const PAGE_LIMIT = 1024;
/** 3 days of 5 minute data is ~864 points, so a window usually fits in one call. */
const BACKFILL_WINDOW = 3 * 24 * 3600;
/** Netatmo allows 500 requests/hour; leave plenty of room for normal polling. */
const BACKFILL_DELAY_MS = 12 * 1000;
const ERROR_DELAY_MS = 5 * 60 * 1000;
/** On a fresh archive, start live sync this far back so the 24h chart works right away. */
const INITIAL_LOOKBACK = 2 * 24 * 3600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const month = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 7);

export class Sync {
  #deviceId?: string;
  #setupAt?: number;
  #modules: Module[] = [];
  #backfilling = false;

  constructor(private netatmo: Netatmo, private archive: Archive) {}

  /** Called after every successful station poll: stores everything newer than the archive. */
  async update(modules: Module[], setupAt?: number) {
    this.#deviceId = modules[0].id;
    this.#setupAt = setupAt;
    this.#modules = modules;

    for (const m of modules) await this.archive.upsertModule(m);
    for (const m of modules) {
      const state = await this.archive.state(m.id);
      const from = state.syncedUntil ?? now() - INITIAL_LOOKBACK;
      try {
        const newest = await this.#fetchRange(m, from + 1, now());
        await this.archive.setState(m.id, {
          ...state,
          syncedUntil: newest ?? state.syncedUntil ?? from,
          backfilledFrom: state.backfilledFrom ?? from,
        });
      } catch (e) {
        console.warn(`sync for ${m.name} failed:`, (e as Error).message);
      }
    }

    if (!this.#backfilling) {
      this.#backfilling = true;
      this.#backfill().finally(() => (this.#backfilling = false));
    }
  }

  /** Fetches [begin, end] for a module into the archive, paging as needed. Returns newest ts. */
  async #fetchRange(m: Module, begin: number, end: number): Promise<number | undefined> {
    const types = TYPES[m.kind];
    let newest: number | undefined;
    while (begin <= end) {
      const rows: Row[] = await this.netatmo.measure({
        deviceId: this.#deviceId!,
        moduleId: m.kind === "base" ? undefined : m.id,
        types: types.map(([t]) => t),
        begin,
        end,
        limit: PAGE_LIMIT,
      });
      await this.archive.insert(m.id, types.map(([, c]) => c), rows);
      if (!rows.length) break;
      newest = rows[rows.length - 1][0];
      if (rows.length < PAGE_LIMIT) break;
      begin = newest + 1;
      await sleep(1000);
    }
    return newest;
  }

  async #backfill() {
    while (true) {
      // Work on whichever module is furthest from done, so they all move back in time together.
      const states = await Promise.all(
        this.#modules.map(async (m) => ({ m, s: await this.archive.state(m.id) })),
      );
      const pending = states
        .filter(({ s }) => !s.backfillDone && s.backfilledFrom !== undefined)
        .sort((a, b) => b.s.backfilledFrom! - a.s.backfilledFrom!);
      if (!pending.length) return;

      const { m, s } = pending[0];
      const end = s.backfilledFrom! - 1;
      const begin = end - BACKFILL_WINDOW;
      try {
        await this.#fetchRange(m, begin, end);
        // Stop at the station's setup date. Without one, keep going back until 2012, the year
        // Netatmo launched the weather station.
        const done = begin <= (this.#setupAt ?? Date.UTC(2012, 0, 1) / 1000);
        await this.archive.setState(m.id, { ...s, backfilledFrom: begin, backfillDone: done });
        if (done) console.log(`backfill for ${m.name} complete`);
        // Log once per month of history.
        else if (month(begin) !== month(end)) {
          console.log(`backfill for ${m.name} reached ${month(begin)}`);
        }
        await sleep(BACKFILL_DELAY_MS);
      } catch (e) {
        console.warn(`backfill for ${m.name} failed, retrying later:`, (e as Error).message);
        await sleep(ERROR_DELAY_MS);
      }
    }
  }
}
