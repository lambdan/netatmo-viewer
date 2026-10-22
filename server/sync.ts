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
  #modules: Module[] = [];
  /** Each module's first ever measurement (unix seconds), or null if it has none. */
  #firstAt = new Map<string, number | null>();
  #backfilling = false;

  constructor(private netatmo: Netatmo, private archive: Archive) {}

  /** Called after every successful station poll: stores everything newer than the archive. */
  async update(modules: Module[]) {
    this.#deviceId = modules[0].id;
    this.#modules = modules;

    for (const m of modules) await this.archive.upsertModule(m);
    const added: string[] = [];
    for (const m of modules) {
      const state = await this.archive.state(m.id);
      const from = state.syncedUntil ?? now() - INITIAL_LOOKBACK;
      try {
        const { newest, count } = await this.#fetchRange(m, from + 1, now());
        added.push(`${m.name} ${count}`);
        await this.archive.setState(m.id, {
          ...state,
          syncedUntil: newest ?? state.syncedUntil ?? from,
          backfilledFrom: state.backfilledFrom ?? from,
        });
      } catch (e) {
        console.warn(`sync for ${m.name} failed:`, (e as Error).message);
      }
    }
    if (added.length) console.log(`Synced new readings: ${added.join(", ")}`);

    if (!this.#backfilling) {
      this.#backfilling = true;
      this.#backfill().finally(() => (this.#backfilling = false));
    }
  }

  #measure(m: Module, begin: number, end: number, limit: number): Promise<Row[]> {
    return this.netatmo.measure({
      deviceId: this.#deviceId!,
      moduleId: m.kind === "base" ? undefined : m.id,
      types: TYPES[m.kind].map(([t]) => t),
      begin,
      end,
      limit,
    });
  }

  /**
   * When the module first reported anything. Asking for a single point from 1970 onwards returns
   * the oldest one, so modules added later (or set up before the base station's official setup
   * date) stop their backfill at exactly the right place.
   */
  async #firstMeasurement(m: Module): Promise<number | null> {
    if (!this.#firstAt.has(m.id)) {
      const [first] = await this.#measure(m, 0, now(), 1);
      this.#firstAt.set(m.id, first ? first[0] : null);
    }
    return this.#firstAt.get(m.id)!;
  }

  /** Fetches [begin, end] for a module into the archive, paging as needed. */
  async #fetchRange(
    m: Module,
    begin: number,
    end: number,
  ): Promise<{ newest?: number; count: number }> {
    const types = TYPES[m.kind];
    let newest: number | undefined;
    let count = 0;
    while (begin <= end) {
      const rows = await this.#measure(m, begin, end, PAGE_LIMIT);
      count += await this.archive.insert(m.id, types.map(([, c]) => c), rows);
      if (!rows.length) break;
      newest = rows[rows.length - 1][0];
      if (rows.length < PAGE_LIMIT) break;
      begin = newest + 1;
      await sleep(1000);
    }
    return { newest, count };
  }

  async #backfill() {
    let announced = false;
    while (true) {
      // Work on whichever module is furthest from done, so they all move back in time together.
      const states = await Promise.all(
        this.#modules.map(async (m) => ({ m, s: await this.archive.state(m.id) })),
      );
      const pending = states
        .filter(({ s }) => !s.backfillDone && s.backfilledFrom !== undefined)
        .sort((a, b) => b.s.backfilledFrom! - a.s.backfilledFrom!);
      if (!pending.length) return;
      if (!announced) {
        announced = true;
        const names = pending.map(({ m }) => m.name).join(", ");
        console.log(
          `Backfilling history for ${names}, currently back to ${
            month(pending[0].s.backfilledFrom!)
          }. ` +
            "Logs once per month reached; progress also at /api/archive.",
        );
      }

      const { m, s } = pending[0];
      const end = s.backfilledFrom! - 1;
      const begin = end - BACKFILL_WINDOW;
      try {
        const first = await this.#firstMeasurement(m);
        // Nothing older than the module's first measurement exists, so there's nothing to fetch.
        if (first === null || end < first) {
          await this.archive.setState(m.id, { ...s, backfillDone: true });
          console.log(`backfill for ${m.name} complete`);
          continue;
        }
        await this.#fetchRange(m, begin, end);
        const done = begin <= first;
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
