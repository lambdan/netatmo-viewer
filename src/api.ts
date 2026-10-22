import type { Metric, MonthlyResponse, RecordsResponse, SeriesResponse } from "../shared/types.ts";

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = Object.keys(params).map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
  const res = await fetch(`${path}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  history: (q: { module: string; metric: Metric; from: number; to: number; bucket: number; tz: number }) =>
    get<SeriesResponse>("/api/history", q),
  records: (q: { module: string; metric: Metric; today: number; month: number; year: number }) =>
    get<RecordsResponse>("/api/records", q),
  monthly: (q: { module: string; metric: Metric; tz: number }) =>
    get<MonthlyResponse>("/api/monthly", q),
};
