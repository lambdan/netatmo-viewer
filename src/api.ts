import type {
  Metric,
  MonthlyResponse,
  RecordsResponse,
  SeriesResponse,
  StationEvent,
} from "../shared/types.ts";

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = Object.keys(params).map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
  const res = await fetch(`${path}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const api = {
  events: () => get<StationEvent[]>("/api/events", {}),
  addEvent: (at: number, label: string, moduleIds: string[]) =>
    send<StationEvent>("POST", "/api/events", { at, label, moduleIds }),
  updateEvent: (id: number, at: number, label: string, moduleIds: string[]) =>
    send<StationEvent>("PUT", `/api/events/${id}`, { at, label, moduleIds }),
  deleteEvent: (id: number) => send<{ ok: true }>("DELETE", `/api/events/${id}`),
  history: (q: { module: string; metric: Metric; from: number; to: number; bucket: number; tz: string }) =>
    get<SeriesResponse>("/api/history", q),
  records: (q: { module: string; metric: Metric; today: number; month: number; year: number }) =>
    get<RecordsResponse>("/api/records", q),
  monthly: (q: { module: string; metric: Metric; tz: string }) =>
    get<MonthlyResponse>("/api/monthly", q),
};
