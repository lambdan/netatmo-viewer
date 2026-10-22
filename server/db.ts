// Local SQLite archive of every measurement Netatmo has for the station.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ModuleKind } from "../shared/types.ts";

export const COLUMNS = [
  "temperature",
  "humidity",
  "co2",
  "pressure",
  "noise",
  "rain",
  "wind_strength",
  "wind_angle",
  "gust_strength",
  "gust_angle",
] as const;
export type Column = typeof COLUMNS[number];

/** Columns that can be charted (they're also interpolated into SQL, so keep this a whitelist). */
export const METRICS = ["temperature", "humidity", "co2", "pressure", "noise"] as const;
export type Metric = typeof METRICS[number];

export function isMetric(s: string | null): s is Metric {
  return (METRICS as readonly string[]).includes(s ?? "");
}

/** [unix seconds, values in the order of the requested columns] */
export type Row = [number, (number | null)[]];

export interface SyncState {
  /** Newest measurement timestamp fetched going forward. */
  syncedUntil?: number;
  /** Oldest point the backfill has reached going backwards. */
  backfilledFrom?: number;
  backfillDone: boolean;
}

export class Archive {
  #db: DatabaseSync;
  #inserts = new Map<string, StatementSync>();

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS measurements (
        module_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        ${COLUMNS.map((c) => `${c} REAL`).join(",\n        ")},
        PRIMARY KEY (module_id, ts)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS sync_state (
        module_id TEXT PRIMARY KEY,
        synced_until INTEGER,
        backfilled_from INTEGER,
        backfill_done INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  upsertModule(m: { id: string; name: string; kind: ModuleKind }) {
    this.#db.prepare(
      `INSERT INTO modules (id, name, kind, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
         updated_at = excluded.updated_at`,
    ).run(m.id, m.name, m.kind, Math.floor(Date.now() / 1000));
  }

  /** Inserts rows, ignoring timestamps already stored. Returns how many were new. */
  insert(moduleId: string, columns: Column[], rows: Row[]): number {
    if (!rows.length) return 0;
    const key = columns.join(",");
    let stmt = this.#inserts.get(key);
    if (!stmt) {
      stmt = this.#db.prepare(
        `INSERT INTO measurements (module_id, ts, ${key})
         VALUES (?, ?, ${columns.map(() => "?").join(", ")})
         ON CONFLICT (module_id, ts) DO NOTHING`,
      );
      this.#inserts.set(key, stmt);
    }
    let added = 0;
    this.#db.exec("BEGIN");
    try {
      for (const [ts, values] of rows) {
        added += Number(stmt.run(moduleId, ts, ...values).changes);
      }
      this.#db.exec("COMMIT");
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
    return added;
  }

  state(moduleId: string): SyncState {
    const row = this.#db.prepare(
      "SELECT synced_until, backfilled_from, backfill_done FROM sync_state WHERE module_id = ?",
    ).get(moduleId) as
      | { synced_until: number | null; backfilled_from: number | null; backfill_done: number }
      | undefined;
    return {
      syncedUntil: row?.synced_until ?? undefined,
      backfilledFrom: row?.backfilled_from ?? undefined,
      backfillDone: !!row?.backfill_done,
    };
  }

  setState(moduleId: string, s: SyncState) {
    this.#db.prepare(
      `INSERT INTO sync_state (module_id, synced_until, backfilled_from, backfill_done)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (module_id) DO UPDATE SET synced_until = excluded.synced_until,
         backfilled_from = excluded.backfilled_from, backfill_done = excluded.backfill_done`,
    ).run(moduleId, s.syncedUntil ?? null, s.backfilledFrom ?? null, s.backfillDone ? 1 : 0);
  }

  /** Average temperature per `bucket` seconds since `since`. */
  temperatureHistory(moduleId: string, since: number, bucket: number): [number, number][] {
    // JS numbers bind as REAL, which would make the division non-integer; inline it instead.
    const b = Math.max(1, Math.floor(bucket));
    const rows = this.#db.prepare(
      `SELECT (ts / ${b}) * ${b} AS t, ROUND(AVG(temperature), 1) AS v FROM measurements
       WHERE module_id = ? AND ts >= ? AND temperature IS NOT NULL
       GROUP BY t ORDER BY t`,
    ).all(moduleId, since) as { t: number; v: number }[];
    return rows.map((r) => [r.t, r.v]);
  }

  /**
   * One row per bucket: [bucket start, avg, min, max]. `tzOffset` (seconds east of UTC) aligns
   * day-sized buckets with local midnight.
   */
  series(
    moduleId: string,
    metric: Metric,
    from: number,
    to: number,
    bucket: number,
    tzOffset: number,
  ): [number, number, number, number][] {
    const b = Math.max(1, Math.floor(bucket));
    const off = Math.floor(tzOffset);
    const rows = this.#db.prepare(
      `SELECT ((ts + ${off}) / ${b}) * ${b} - ${off} AS t,
         ROUND(AVG(${metric}), 2) AS avg, MIN(${metric}) AS lo, MAX(${metric}) AS hi
       FROM measurements
       WHERE module_id = ? AND ts >= ? AND ts < ? AND ${metric} IS NOT NULL
       GROUP BY t ORDER BY t`,
    ).all(moduleId, from, to) as { t: number; avg: number; lo: number; hi: number }[];
    return rows.map((r) => [r.t, r.avg, r.lo, r.hi]);
  }

  /** Lowest and highest value since `from` (all time if omitted), as [value, unix seconds]. */
  extremes(moduleId: string, metric: Metric, from = 0) {
    // SQLite returns the ts of the row that produced a lone MIN()/MAX().
    const one = (fn: "MIN" | "MAX") =>
      this.#db.prepare(
        `SELECT ${fn}(${metric}) AS v, ts FROM measurements
         WHERE module_id = ? AND ts >= ? AND ${metric} IS NOT NULL`,
      ).get(moduleId, from) as { v: number | null; ts: number | null };
    const pick = (r: { v: number | null; ts: number | null }) =>
      r.v === null || r.ts === null ? undefined : [r.v, r.ts] as [number, number];
    return { min: pick(one("MIN")), max: pick(one("MAX")) };
  }

  /** Monthly averages in local time: [year, month (1-12), avg, number of samples]. */
  monthly(moduleId: string, metric: Metric, tzOffset: number): [number, number, number, number][] {
    const off = Math.floor(tzOffset);
    const rows = this.#db.prepare(
      `SELECT strftime('%Y-%m', ts + ${off}, 'unixepoch') AS ym,
         ROUND(AVG(${metric}), 2) AS avg, COUNT(*) AS n
       FROM measurements
       WHERE module_id = ? AND ${metric} IS NOT NULL
       GROUP BY ym ORDER BY ym`,
    ).all(moduleId) as { ym: string; avg: number; n: number }[];
    return rows.map((r) => [Number(r.ym.slice(0, 4)), Number(r.ym.slice(5, 7)), r.avg, r.n]);
  }

  oldest(moduleId: string): number | undefined {
    const r = this.#db.prepare("SELECT MIN(ts) AS ts FROM measurements WHERE module_id = ?")
      .get(moduleId) as { ts: number | null };
    return r.ts ?? undefined;
  }

  stats() {
    return this.#db.prepare(
      `SELECT m.id, m.name, m.kind, COUNT(x.ts) AS rows, MIN(x.ts) AS oldest, MAX(x.ts) AS newest,
         s.backfill_done AS backfillDone
       FROM modules m
       LEFT JOIN measurements x ON x.module_id = m.id
       LEFT JOIN sync_state s ON s.module_id = m.id
       GROUP BY m.id ORDER BY m.kind, m.name`,
    ).all();
  }
}
