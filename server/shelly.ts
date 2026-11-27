// Receives readings from Shelly H&T Gen3 sensors (and other Gen2+ Shelly sensors with
// temperature/humidity). Battery-powered Shellys sleep between readings, so the server can't
// ask them; instead each sensor is set up with an "outbound WebSocket" to this server (on its own
// port, SHELLY_PORT), and on every wake-up it connects and sends its status as JSON-RPC
// notifications.

import type { Module } from "../shared/types.ts";
import type { Archive } from "./db.ts";
import { message, now, round1 } from "./util.ts";

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

  /**
   * Listens for sensors on their own port. Deno's HTTP server can't be used for this: Shellys
   * send `Content-Length: 0` with their WebSocket handshake, which it rejects with a 400 before
   * the request reaches any handler. So this does the (small) WebSocket protocol itself.
   */
  listen(port: number) {
    const listener = Deno.listen({ port, hostname: "0.0.0.0" });
    console.log(`Shelly: sensors connect to ws://<server>:${port}/`);
    (async () => {
      for await (const conn of listener) {
        this.#serve(conn).catch((e) =>
          console.warn(
            `Shelly: connection from ${host(conn)} failed:`,
            message(e),
          )
        );
      }
    })();
  }

  async #serve(conn: Deno.Conn) {
    const from = host(conn);
    const ws = new WsConn(conn);
    try {
      const ok = await ws.handshake();
      if (!ok) return;
      let src: string | undefined;
      let asked = false;
      let sleeping = false;
      for (let text; (text = await ws.receive()) !== null;) {
        let msg: {
          src?: string;
          id?: number;
          method?: string;
          params?: Status;
          result?: { name?: string | null; model?: string; app?: string };
        };
        try {
          msg = JSON.parse(text);
        } catch {
          console.warn(`Shelly: unreadable message from ${src ?? from}: ${text.slice(0, 200)}`);
          continue;
        }
        if (typeof msg.src !== "string" || !msg.src) continue;
        if (!src) {
          src = msg.src;
          console.log(`Shelly: ${src} connected from ${from}`);
        }
        try {
          // The answer to Shelly.GetDeviceInfo below: the name set in the Shelly app.
          if (msg.id === 1 && msg.result) {
            await this.#rename(msg.src, msg.result.name, msg.result.model ?? msg.result.app);
          } else if (msg.method === "NotifyFullStatus" || msg.method === "NotifyStatus") {
            await this.#reading(msg.src, msg.method, msg.params ?? {});
            // Ask for the device's name while it's awake (once per connection).
            if (!asked) {
              asked = true;
              await ws.send(
                JSON.stringify({ id: 1, src: "netatmo-viewer", method: "Shelly.GetDeviceInfo" }),
              );
            }
          } else if (msg.method === "NotifyEvent") {
            const events = (msg.params as { events?: { event?: string }[] })?.events ?? [];
            if (events.some((e) => e.event === "sleep")) sleeping = true;
            console.log(
              `Shelly: ${msg.src} event ${events.map((e) => e.event).join(", ") || "?"}`,
            );
          }
        } catch (e) {
          console.warn(`Shelly: handling a message from ${msg.src} failed:`, message(e));
        }
      }
      console.log(`Shelly: ${src ?? from} disconnected${sleeping ? " (went to sleep)" : ""}`);
    } finally {
      ws.close();
    }
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

const host = (conn: Deno.Conn) => (conn.remoteAddr as Deno.NetAddr).hostname;

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** A sleeping sensor can vanish without closing its connection; give up on it after this. */
const IDLE_MS = 10 * 60 * 1000;
/** Shelly status messages are a few kB; anything this big is not a sensor. */
const MAX_MESSAGE = 1 << 20;
const MAX_HEADERS = 16 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Just enough of a WebSocket server (RFC 6455) for Shelly sensors: text messages, ping, close. */
class WsConn {
  #buf: Uint8Array = new Uint8Array(0);
  #idle?: number;
  #closed = false;

  constructor(private conn: Deno.Conn) {}

  /** Reads the HTTP upgrade request and answers it. False if it wasn't a WebSocket request. */
  async handshake(): Promise<boolean> {
    let end: number;
    while ((end = indexOf(this.#buf, enc.encode("\r\n\r\n"))) < 0) {
      if (this.#buf.length > MAX_HEADERS) throw new Error("request headers too large");
      await this.#fill();
    }
    const [requestLine, ...lines] = dec.decode(this.#buf.subarray(0, end)).split("\r\n");
    this.#buf = this.#buf.slice(end + 4);
    const headers = new Map<string, string>();
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
    const key = headers.get("sec-websocket-key");
    if (headers.get("upgrade")?.toLowerCase() !== "websocket" || !key) {
      const body = "This port is for Shelly sensors. In the sensor's settings, set Outbound " +
        "WebSocket to ws://<this server>:<this port>/\n";
      await this.#write(enc.encode(
        "HTTP/1.1 426 Upgrade Required\r\nContent-Type: text/plain\r\nConnection: close\r\n" +
          `Content-Length: ${enc.encode(body).length}\r\n\r\n${body}`,
      ));
      console.log(`Shelly: non-WebSocket request from ${host(this.conn)}: ${requestLine}`);
      return false;
    }
    const digest = await crypto.subtle.digest("SHA-1", enc.encode(key + WS_GUID));
    const accept = btoa(String.fromCharCode(...new Uint8Array(digest)));
    // Shellys ask for the "json-rpc" subprotocol and may hang up if it isn't confirmed.
    const protocol = headers.get("sec-websocket-protocol")?.split(",")[0].trim();
    await this.#write(enc.encode(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        (protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : "") + "\r\n",
    ));
    return true;
  }

  /** The next text message, or null once the connection is closed. */
  async receive(): Promise<string | null> {
    const parts: Uint8Array[] = [];
    let size = 0;
    while (!this.#closed) {
      const b = await this.#take(2);
      if (!b) return null;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      if (len === 126) {
        const x = await this.#take(2);
        if (!x) return null;
        len = (x[0] << 8) | x[1];
      } else if (len === 127) {
        const x = await this.#take(8);
        if (!x) return null;
        len = Number(new DataView(x.buffer, x.byteOffset, 8).getBigUint64(0));
      }
      if (size + len > MAX_MESSAGE) throw new Error(`message too large (${size + len} bytes)`);
      const mask = masked ? await this.#take(4) : undefined;
      const payload = await this.#take(len);
      if (!payload || (masked && !mask)) return null;
      if (mask) { for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }

      if (op === 0x8) {
        // Close: answer it, then we're done.
        await this.#frame(0x8, payload.subarray(0, 2)).catch(() => {});
        this.close();
        return null;
      }
      if (op === 0x9) {
        await this.#frame(0xa, payload);
        continue;
      }
      if (op === 0xa) continue;
      // 0x1 text, 0x2 binary, 0x0 continuation of either.
      parts.push(payload);
      size += payload.length;
      if (fin) return dec.decode(concat(parts));
    }
    return null;
  }

  send(text: string) {
    return this.#frame(0x1, enc.encode(text));
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#idle);
    try {
      this.conn.close();
    } catch {
      // already closed
    }
  }

  /** Server frames are never masked. */
  #frame(op: number, payload: Uint8Array) {
    const n = payload.length;
    const head = n < 126 ? [0x80 | op, n] : n < 65536 ? [0x80 | op, 126, n >> 8, n & 0xff] : [
      0x80 | op,
      127,
      0,
      0,
      0,
      0,
      (n >>> 24) & 0xff,
      (n >> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff,
    ];
    return this.#write(concat([new Uint8Array(head), payload]));
  }

  async #write(data: Uint8Array) {
    for (let off = 0; off < data.length;) off += await this.conn.write(data.subarray(off));
  }

  /** Exactly n bytes, or null if the connection ends first. */
  async #take(n: number): Promise<Uint8Array | null> {
    while (this.#buf.length < n) {
      if (!(await this.#fill())) return null;
    }
    const out = this.#buf.slice(0, n);
    this.#buf = this.#buf.slice(n);
    return out;
  }

  async #fill(): Promise<boolean> {
    if (this.#closed) return false;
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.close(), IDLE_MS);
    const chunk = new Uint8Array(8192);
    let n: number | null;
    try {
      n = await this.conn.read(chunk);
    } catch (e) {
      // A sensor going to sleep drops the connection without closing it; that's normal.
      if (
        this.#closed || e instanceof Deno.errors.ConnectionReset ||
        e instanceof Deno.errors.BrokenPipe
      ) {
        this.close();
        return false;
      }
      throw e;
    }
    if (n === null) {
      if (this.#buf.length === 0 && !this.#closed) this.close();
      return false;
    }
    this.#buf = concat([this.#buf, chunk.subarray(0, n)]);
    return true;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
