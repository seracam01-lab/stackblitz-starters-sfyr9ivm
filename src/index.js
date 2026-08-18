import { DurableObject } from "cloudflare:workers";
import QRCode from "qrcode";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function cors(response) {
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}

function safeSid(value) {
  const sid = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(sid)) return "";
  return sid;
}

export class PhotoFinishRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    this.state = {
      signals: [],
      seq: 0,
      timer: { running: false, startAt: 0, elapsed: 0 },
      clients: {},
    };

    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get("room-state");
      if (saved && typeof saved === "object") {
        this.state = {
          signals: Array.isArray(saved.signals) ? saved.signals : [],
          seq: Number(saved.seq || 0),
          timer: saved.timer || { running: false, startAt: 0, elapsed: 0 },
          clients: saved.clients || {},
        };
      }
    });
  }

  async persist() {
    await this.ctx.storage.put("room-state", this.state);
  }

  async fetch(request) {
    await this.ready;

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname === "/api/heartbeat" && request.method === "POST") {
        const body = await request.json();
        const role = body.role === "cam2" ? "cam2" : "main";

        this.state.clients[role] = {
          lastSeen: Date.now(),
          clientId: String(body.clientId || ""),
        };

        await this.persist();
        return cors(json({ ok: true }));
      }

      if (url.pathname === "/api/room" && request.method === "GET") {
        const now = Date.now();
        const clients = this.state.clients || {};
        const mainOnline = !!(
          clients.main &&
          now - Number(clients.main.lastSeen || 0) < 5000
        );
        const cam2Online = !!(
          clients.cam2 &&
          now - Number(clients.cam2.lastSeen || 0) < 5000
        );

        return cors(
          json({
            timer: this.state.timer,
            mainOnline,
            cam2Online,
          }),
        );
      }

      if (url.pathname === "/api/signal" && request.method === "POST") {
        const body = await request.json();

        this.state.seq += 1;
        this.state.signals.push({
          seq: this.state.seq,
          from: String(body.from || ""),
          to: String(body.to || ""),
          type: String(body.type || ""),
          data: body.data ?? null,
          ts: Date.now(),
        });

        if (this.state.signals.length > 300) {
          this.state.signals.splice(0, this.state.signals.length - 300);
        }

        await this.persist();
        return cors(json({ ok: true, seq: this.state.seq }));
      }

      if (url.pathname === "/api/signals" && request.method === "GET") {
        const to = String(url.searchParams.get("to") || "");
        const after = Number(url.searchParams.get("after") || 0);

        const signals = this.state.signals.filter(
          (item) => item.seq > after && item.to === to,
        );

        return cors(
          json({
            signals,
            lastSeq: this.state.seq,
          }),
        );
      }

      if (url.pathname === "/api/timer" && request.method === "POST") {
        const body = await request.json();

        if (body.action === "start") {
          this.state.timer = {
            running: true,
            startAt: Date.now() + 250,
            elapsed: 0,
          };
        } else if (body.action === "stop") {
          if (this.state.timer.running) {
            this.state.timer.elapsed = Math.max(
              0,
              Date.now() - Number(this.state.timer.startAt || 0),
            );
          }
          this.state.timer.running = false;
        }

        await this.persist();
        return cors(json({ ok: true, timer: this.state.timer }));
      }

      return cors(json({ ok: false, error: "API endpoint not found" }, 404));
    } catch (error) {
      console.error("Durable Object error:", error);
      return cors(
        json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        ),
      );
    }
  }
}

async function getSidFromRequest(request, url) {
  if (request.method === "GET") {
    return safeSid(url.searchParams.get("sid"));
  }

  if (request.method === "POST") {
    try {
      const clone = request.clone();
      const body = await clone.json();
      return safeSid(body.sid);
    } catch {
      return "";
    }
  }

  return "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    // Health/info endpoint.
    if (url.pathname === "/api/info") {
      return cors(
        json({
          state: "ready",
          message: "Cloudflare HTTPS พร้อม",
          server: true,
          publicUrl: url.origin,
        }),
      );
    }

    // QR is generated inside this Worker, not by an external website.
    if (url.pathname === "/api/qr") {
      try {
        const data = String(url.searchParams.get("data") || "").trim();

        if (!data || data.length > 4096) {
          return new Response("Missing or invalid QR data", { status: 400 });
        }

        const svg = await QRCode.toString(data, {
          type: "svg",
          width: 220,
          margin: 2,
          errorCorrectionLevel: "M",
        });

        return new Response(svg, {
          status: 200,
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      } catch (error) {
        console.error("QR error:", error);
        return new Response("QR generation failed", { status: 500 });
      }
    }

    // All stateful API requests for the same SID go to the same Durable Object.
    if (url.pathname.startsWith("/api/")) {
      const sid = await getSidFromRequest(request, url);

      if (!sid) {
        return cors(json({ ok: false, error: "Invalid or missing sid" }, 400));
      }

      const room = env.PHOTO_ROOMS.getByName(sid);
      return room.fetch(request);
    }

    // Everything else is the website in /public.
    return env.ASSETS.fetch(request);
  },
};
