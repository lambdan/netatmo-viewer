// Just enough of a WebSocket server for the Shelly sensors (see shelly.ts for why Deno's own
// can't be used).

export const host = (conn: Deno.Conn) => (conn.remoteAddr as Deno.NetAddr).hostname;

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** A sleeping sensor can vanish without closing its connection; give up on it after this. */
const IDLE_MS = 10 * 60 * 1000;
/** Shelly status messages are a few kB; anything this big is not a sensor. */
const MAX_MESSAGE = 1 << 20;
const MAX_HEADERS = 16 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Just enough of a WebSocket server (RFC 6455) for Shelly sensors: text messages, ping, close. */
export class WsConn {
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
