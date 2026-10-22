// Postgres archive of every measurement Netatmo has for the station (plus the API tokens).

import type { ModuleKind, StationEvent } from "../shared/types.ts";

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
  /** Newest measurement timestamp fetched going forward (unix seconds). */
  syncedUntil?: number;
  /** Oldest point the backfill has reached going backwards (unix seconds). */
  backfilledFrom?: number;
  backfillDone: boolean;
}

/** The little bit of a Postgres client the archive needs. */
export interface Db {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements, no parameters. */
  exec(text: string): Promise<void>;
}

export async function connect(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  return {
    query: <T>(text: string, params: unknown[] = []) =>
      // deno-lint-ignore no-explicit-any
      sql.unsafe(text, params as any[]) as unknown as Promise<T[]>,
    exec: async (text) => void (await sql.unsafe(text).simple()),
  };
}

/** In-process Postgres (WebAssembly) for demo mode, so no database server is needed. */
export async function memoryDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await db.query<T>(text, params)).rows,
    exec: async (text) => void (await db.exec(text)),
  };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS modules (
    id text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS measurements (
    module_id text NOT NULL REFERENCES modules (id),
    ts timestamptz NOT NULL,
    ${COLUMNS.map((c) => `${c} double precision`).join(",\n    ")},
    PRIMARY KEY (module_id, ts)
  );
  CREATE TABLE IF NOT EXISTS sync_state (
    module_id text PRIMARY KEY REFERENCES modules (id),
    synced_until timestamptz,
    backfilled_from timestamptz,
    backfill_done boolean NOT NULL DEFAULT false
  );
  CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id serial PRIMARY KEY,
    at timestamptz NOT NULL,
    label text NOT NULL,
    -- The modules it affected
    module_ids text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

/** Unix seconds out of a timestamptz column, as a plain JS number. */
const epoch = (col: string) => `extract(epoch from ${col})::float8`;

/** Rows per INSERT; keeps the parameter count well under Postgres' 65535 limit. */
const INSERT_CHUNK = 1000;

export class Archive {
  constructor(private db: Db) {}

  init(): Promise<void> {
    return this.db.exec(SCHEMA);
  }

  async upsertModule(m: { id: string; name: string; kind: ModuleKind }) {
    await this.db.query(
      `INSERT INTO modules (id, name, kind) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, updated_at = now()`,
      [m.id, m.name, m.kind],
    );
  }

  /** Inserts rows, ignoring timestamps already stored. Returns how many were new. */
  async insert(moduleId: string, columns: Column[], rows: Row[]): Promise<number> {
    const width = columns.length + 2;
    let added = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const params: unknown[] = [];
      const values = chunk.map(([ts, vals], r) => {
        params.push(moduleId, ts, ...vals);
        const n = r * width;
        const cols = columns.map((_, c) => `$${n + 3 + c}::float8`);
        return `($${n + 1}, to_timestamp($${n + 2}::float8), ${cols.join(", ")})`;
      });
      const inserted = await this.db.query(
        `INSERT INTO measurements (module_id, ts, ${columns.join(", ")})
         VALUES ${values.join(", ")}
         ON CONFLICT (module_id, ts) DO NOTHING
         RETURNING 1`,
        params,
      );
      added += inserted.length;
    }
    return added;
  }

  async state(moduleId: string): Promise<SyncState> {
    const [row] = await this.db.query<
      { synced_until: number | null; backfilled_from: number | null; backfill_done: boolean }
    >(
      `SELECT ${epoch("synced_until")} AS synced_until, ${
        epoch("backfilled_from")
      } AS backfilled_from,
         backfill_done
       FROM sync_state WHERE module_id = $1`,
      [moduleId],
    );
    return {
      syncedUntil: row?.synced_until ?? undefined,
      backfilledFrom: row?.backfilled_from ?? undefined,
      backfillDone: !!row?.backfill_done,
    };
  }

  async setState(moduleId: string, s: SyncState) {
    await this.db.query(
      `INSERT INTO sync_state (module_id, synced_until, backfilled_from, backfill_done)
       VALUES ($1, to_timestamp($2::float8), to_timestamp($3::float8), $4)
       ON CONFLICT (module_id) DO UPDATE SET synced_until = excluded.synced_until,
         backfilled_from = excluded.backfilled_from, backfill_done = excluded.backfill_done`,
      [moduleId, s.syncedUntil ?? null, s.backfilledFrom ?? null, s.backfillDone],
    );
  }

  /**
   * One row per bucket: [bucket start, avg, min, max]. Buckets are aligned to wall-clock time in
   * `tz` (an IANA zone like "Europe/Stockholm"), so a day bucket starts at local midnight even
   * across daylight saving changes.
   */
  async series(
    moduleId: string,
    metric: Metric,
    from: number,
    to: number,
    bucket: number,
    tz: string,
  ): Promise<[number, number, number, number][]> {
    const rows = await this.db.query<{ t: number; avg: number; lo: number; hi: number }>(
      `SELECT ${
        epoch(
          `date_bin(make_interval(secs => $4::float8), ts AT TIME ZONE $5, timestamp '2000-01-01')
           AT TIME ZONE $5`,
        )
      } AS t,
         round(avg(${metric})::numeric, 2)::float8 AS avg, min(${metric}) AS lo, max(${metric}) AS hi
       FROM measurements
       WHERE module_id = $1 AND ts >= to_timestamp($2::float8) AND ts < to_timestamp($3::float8)
         AND ${metric} IS NOT NULL
       GROUP BY 1 ORDER BY 1`,
      [moduleId, from, to, Math.max(1, bucket), tz],
    );
    return rows.map((r) => [r.t, r.avg, r.lo, r.hi]);
  }

  /** Lowest and highest value since `from` (all time if omitted), as [value, unix seconds]. */
  async extremes(moduleId: string, metric: Metric, from = 0) {
    const pick = (dir: "ASC" | "DESC") =>
      `(SELECT '${dir}' AS dir, ${metric} AS v, ${epoch("ts")} AS ts FROM measurements
        WHERE module_id = $1 AND ts >= to_timestamp($2::float8) AND ${metric} IS NOT NULL
        ORDER BY ${metric} ${dir}, ts DESC LIMIT 1)`;
    const rows = await this.db.query<{ dir: string; v: number; ts: number }>(
      `${pick("ASC")} UNION ALL ${pick("DESC")}`,
      [moduleId, from],
    );
    const get = (dir: string) => {
      const r = rows.find((r) => r.dir === dir);
      return r ? [r.v, r.ts] as [number, number] : undefined;
    };
    return { min: get("ASC"), max: get("DESC") };
  }

  /** Monthly averages in local time: [year, month (1-12), avg, number of samples]. */
  async monthly(moduleId: string, metric: Metric, tz: string) {
    const rows = await this.db.query<{ y: number; m: number; avg: number; n: number }>(
      `SELECT extract(year FROM local)::int AS y, extract(month FROM local)::int AS m,
         round(avg(v)::numeric, 2)::float8 AS avg, count(*)::int AS n
       FROM (
         SELECT date_trunc('month', ts AT TIME ZONE $2) AS local, ${metric} AS v FROM measurements
         WHERE module_id = $1 AND ${metric} IS NOT NULL
       ) x
       GROUP BY local ORDER BY local`,
      [moduleId, tz],
    );
    return rows.map((r) => [r.y, r.m, r.avg, r.n] as [number, number, number, number]);
  }

  async oldest(moduleId: string): Promise<number | undefined> {
    const [r] = await this.db.query<{ ts: number | null }>(
      `SELECT ${epoch("min(ts)")} AS ts FROM measurements WHERE module_id = $1`,
      [moduleId],
    );
    return r?.ts ?? undefined;
  }

  stats() {
    return this.db.query(
      `SELECT m.id, m.name, m.kind, count(x.ts)::int AS rows,
         min(x.ts) AS oldest, max(x.ts) AS newest, coalesce(s.backfill_done, false) AS "backfillDone"
       FROM modules m
       LEFT JOIN measurements x ON x.module_id = m.id
       LEFT JOIN sync_state s ON s.module_id = m.id
       GROUP BY m.id, s.backfill_done ORDER BY m.kind, m.name`,
    );
  }

  events(): Promise<StationEvent[]> {
    return this.db.query<StationEvent>(
      `SELECT id, ${epoch("at")} AS at, label, module_ids AS "moduleIds" FROM events ORDER BY at`,
    );
  }

  async addEvent(at: number, label: string, moduleIds: string[]): Promise<StationEvent> {
    const [e] = await this.db.query<StationEvent>(
      `INSERT INTO events (at, label, module_ids) VALUES (to_timestamp($1::float8), $2, $3::text[])
       RETURNING id, ${epoch("at")} AS at, label, module_ids AS "moduleIds"`,
      [at, label, moduleIds],
    );
    return e;
  }

  async deleteEvent(id: number) {
    await this.db.query("DELETE FROM events WHERE id = $1", [id]);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const [r] = await this.db.query<{ value: T }>("SELECT value FROM settings WHERE key = $1", [
      key,
    ]);
    return r?.value;
  }

  async setSetting(key: string, value: unknown) {
    await this.db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::text::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
}
