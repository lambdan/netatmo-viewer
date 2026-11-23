// Receives readings from Shelly H&T Gen3 sensors (and other Gen2+ Shelly sensors with
// temperature/humidity). Battery-powered Shellys sleep between readings, so the server can't
// ask them; instead each sensor is set up with an "outbound WebSocket" to /api/shelly, and on
// every wake-up it connects and sends its status as JSON-RPC notifications.

import type { Module } from "../shared/types.ts";
import type { Archive } from "./db.ts";

const SETTING = "shelly_devices";
/** On batteries the H&T reports at least every 2 hours; on USB power every 5 minutes. */
const STALE_BATTERY = 150 * 60;
const STALE_USB = 40 * 60;
/** Device clocks are set over NTP; ignore a timestamp this far off and use ours instead. */
const MAX_CLOCK_SKEW = 3600;

export interface ShellyDevice {
  id: string;
  name: string;
  model?: string;
  /** Unix seconds of the newest reading. */
  measuredAt?: number;
  temperature?: number;
  humidity?: number;
  battery?: number;
  /** Powered over USB rather than batteries. */
  external?: boolean;
  /** Unix seconds of the last time it connected. */
  lastSeen?: number;
}

/** The parts of a Shelly status notification this cares about. */
interface Status {
  ts?: number;
  "temperature:0"?: { tC?: number | null };
  "humidity:0"?: { rh?: number | null };
  "devicepower:0"?: { battery?: { percent?: number }; external?: { present?: boolean } };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const now = () => Math.floor(Date.now() / 1000);

export class Shelly {
  #devices = new Map<string, ShellyDevice>();

  /** `onUpdate` runs after every new reading, so the page can show it right away. */
  constructor(private archive: Archive, private onUpdate: () => void) {}

  async load() {
    const saved = await this.archive.getSetting<Record<string, ShellyDevice>>(SETTING) ?? {};
    for (const d of Object.values(saved)) this.#devices.set(d.id, d);
    if (this.#devices.size) {
      console.log(
        `Shelly: ${this.#devices.size} known sensor(s): ` +
          [...this.#devices.values()].map((d) => `${d.name} (${d.id})`).join(", "),
      );
    }
  }

  has(id: string) {
    return this.#devices.has(id);
  }

  /** The sensors as modules for /api/weather (without the 24h history, which main.ts adds). */
  modules(): Module[] {
    const t = now();
    return [...this.#devices.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: "indoor" as const,
        reachable: d.measuredAt !== undefined &&
          t - d.measuredAt < (d.external ? STALE_USB : STALE_BATTERY),
        measuredAt: d.measuredAt,
        battery: d.external ? undefined : d.battery,
        temperature: d.temperature,
        humidity: d.humidity,
      }));
  }

  /** Upgrades GET /api/shelly to the WebSocket a sensor talks over. */
  handle(req: Request): Response {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response(
        "Shelly sensors connect here with a WebSocket: in the Shelly app, set " +
          "Settings > Outbound WebSocket to ws://<this server>/api/shelly\n",
        { status: 426 },
      );
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    const from = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sensor";
    let src: string | undefined;
    let asked = false;

    socket.onmessage = async (ev) => {
      let msg: {
        src?: string;
        id?: number;
        method?: string;
        params?: Status;
        result?: { name?: string | null; model?: string; app?: string };
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        console.warn(
          `Shelly: unreadable message from ${src ?? from}: ${String(ev.data).slice(0, 200)}`,
        );
        return;
      }
      if (typeof msg.src !== "string" || !msg.src) return;
      if (!src) {
        src = msg.src;
        console.log(`Shelly: ${src} connected`);
      }
      try {
        // The answer to Shelly.GetDeviceInfo below: the name set in the Shelly app.
        if (msg.id === 1 && msg.result) {
          await this.#rename(msg.src, msg.result.name, msg.result.model ?? msg.result.app);
          return;
        }
        if (msg.method === "NotifyFullStatus" || msg.method === "NotifyStatus") {
          await this.#reading(msg.src, msg.method, msg.params ?? {});
          // Ask for the device's name while it's awake (once per connection).
          if (!asked) {
            asked = true;
            socket.send(
              JSON.stringify({ id: 1, src: "netatmo-viewer", method: "Shelly.GetDeviceInfo" }),
            );
          }
        } else if (msg.method === "NotifyEvent") {
          const events = (msg.params as { events?: { event?: string }[] })?.events ?? [];
          console.log(`Shelly: ${msg.src} event ${events.map((e) => e.event).join(", ") || "?"}`);
        }
      } catch (e) {
        console.warn(`Shelly: handling a message from ${msg.src} failed:`, (e as Error).message);
      }
    };
    socket.onclose = () => console.log(`Shelly: ${src ?? from} disconnected`);
    socket.onerror = (e) =>
      console.warn(`Shelly: socket error from ${src ?? from}:`, (e as ErrorEvent).message ?? e);
    return response;
  }

  async #reading(id: string, method: string, p: Status) {
    const known = this.#devices.get(id);
    const d: ShellyDevice = known ?? { id, name: `Shelly ${id.slice(-4).toUpperCase()}` };
    const t = now();
    // Status notifications may hold only what changed, so keep the other values.
    const temp = p["temperature:0"]?.tC;
    const hum = p["humidity:0"]?.rh;
    if (typeof temp === "number") d.temperature = round1(temp);
    if (typeof hum === "number") d.humidity = Math.round(hum);
    const power = p["devicepower:0"];
    if (typeof power?.battery?.percent === "number") d.battery = power.battery.percent;
    if (typeof power?.external?.present === "boolean") d.external = power.external.present;
    d.lastSeen = t;

    const hasReading = typeof temp === "number" || typeof hum === "number";
    if (hasReading) {
      const ts = typeof p.ts === "number" && Math.abs(p.ts - t) < MAX_CLOCK_SKEW
        ? Math.floor(p.ts)
        : t;
      // Store both values every time, so the newest row always has both.
      await this.archive.upsertModule({ id, name: d.name, kind: "indoor" });
      const added = await this.archive.insert(id, ["temperature", "humidity"], [
        [ts, [d.temperature ?? null, d.humidity ?? null]],
      ]);
      if (added) d.measuredAt = Math.max(d.measuredAt ?? 0, ts);
    }

    this.#devices.set(id, d);
    await this.#save();
    if (!known) console.log(`Shelly: new sensor ${id}, added as "${d.name}"`);
    const parts = [
      d.temperature !== undefined ? `${d.temperature}°` : undefined,
      d.humidity !== undefined ? `${d.humidity}%` : undefined,
      d.external ? "USB power" : d.battery !== undefined ? `battery ${d.battery}%` : undefined,
    ].filter(Boolean);
    console.log(
      `Shelly: ${d.name} ${method}${hasReading ? "" : " (no readings)"}: ${parts.join(" ")}`,
    );
    if (hasReading) this.onUpdate();
  }

  async #rename(id: string, name: string | null | undefined, model?: string) {
    const d = this.#devices.get(id);
    if (!d) return;
    const wanted = name?.trim();
    if (model) d.model = model;
    if (wanted && wanted !== d.name) {
      console.log(`Shelly: ${id} is named "${wanted}" in the Shelly app (was "${d.name}")`);
      d.name = wanted;
      await this.archive.upsertModule({ id, name: d.name, kind: "indoor" });
      this.onUpdate();
    } else if (!wanted) {
      console.log(`Shelly: ${id} has no name; set one in the Shelly app to show it on the page`);
    }
    await this.#save();
  }

  #save() {
    return this.archive.setSetting(SETTING, Object.fromEntries(this.#devices));
  }
}
