/* ===========================================================================
   The store — talks to /api/state, /api/rev, /api/ops, /api/photo, /api/reset.
   Extracted verbatim from the original app.js. Logic and endpoints unchanged.
   =========================================================================== */

import { API_BASE } from "./config.js";
import { $, toast } from "../state/appState.js";

/* Set by main.js once, after renderAll() exists, so this module never has to
   import the page renderers directly (would create an import cycle). */
let renderAllFn = () => {};
let reopenDrawerFn = () => {};
export function wireStore(renderAll, reopenDrawer) {
  renderAllFn = renderAll;
  reopenDrawerFn = reopenDrawer;
}

export const Store = {
  data: null,
  rev: 0,
  mode: "connecting", // live | local | offline
  LS_KEY: "neoteric_board_v5",

  async init() {
    try {
      const r = await fetch(API_BASE + "/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      this.data = j.data;
      this.rev = j.rev;
      this.mode = "live";
      setInterval(() => this.poll(), 5000);
    } catch {
      // file:// or server down — fall back to a private copy on this device.
      const raw = localStorage.getItem(this.LS_KEY);
      if (raw) { try { this.data = JSON.parse(raw); } catch {} }
      this.mode = "local";
      if (!this.data) {
        this.mode = "offline";
        this.data = null;
      }
    }
    paintSync();
  },

  async poll() {
    if (this.mode !== "live") return;
    try {
      const r = await fetch(API_BASE + "/api/rev", { cache: "no-store" });
      const j = await r.json();
      if (j.rev !== this.rev) {
        const s = await (await fetch(API_BASE + "/api/state", { cache: "no-store" })).json();
        this.data = s.data;
        this.rev = s.rev;
        renderAllFn();
        reopenDrawerFn();
      }
      if (this.mode !== "live") { this.mode = "live"; paintSync(); }
    } catch {
      this.mode = "offline";
      paintSync();
    }
  },

  /* Apply locally first so the UI never waits on the network, then push. */
  async apply(ops) {
    applyOpsLocal(this.data, ops);
    renderAllFn();
    if (this.mode === "local" || this.mode === "offline") {
      try { localStorage.setItem(this.LS_KEY, JSON.stringify(this.data)); } catch {}
      return;
    }
    try {
      const r = await fetch(API_BASE + "/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops })
      });
      const j = await r.json();
      if (j.data) { this.data = j.data; this.rev = j.rev; renderAllFn(); }
    } catch {
      this.mode = "offline";
      paintSync();
      toast("Offline — change kept on this device only");
    }
  },

  async reset(mode) {
    if (this.mode !== "live") return toast("Reset needs the server");
    const r = await fetch(API_BASE + "/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    const j = await r.json();
    this.data = j.data; this.rev = j.rev;
    renderAllFn();
    toast(mode === "blank" ? "Blank board created" : "Demo data reloaded");
  }
};

/* Mirror of the server's op handler so optimistic updates match exactly. */
export function applyOpsLocal(d, ops) {
  for (const op of ops) {
    if (op.op === "upsert") {
      const list = (d[op.coll] = d[op.coll] || []);
      const i = list.findIndex((r) => r.id === op.rec.id);
      const merged = i === -1 ? op.rec : Object.assign({}, list[i], op.rec);
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (i === -1) list.push(merged);
      else list[i] = merged;
    } else if (op.op === "delete") {
      d[op.coll] = (d[op.coll] || []).filter((r) => r.id !== op.id);
    } else if (op.op === "progress") {
      const next = Object.assign({}, d.progress[op.key] || {}, op.patch);
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
      d.progress[op.key] = next;
    } else if (op.op === "event") {
      d.events.unshift(op.ev);
      if (d.events.length > 5000) d.events.length = 5000;
    }
  }
}

export function paintSync() {
  const p = $("syncPill");
  const map = {
    live: ["", "LIVE · SHARED"],
    local: ["local", "THIS DEVICE ONLY"],
    offline: ["off", "OFFLINE"],
    connecting: ["local", "CONNECTING"]
  };
  const [cls, text] = map[Store.mode] || map.connecting;
  p.className = "sync-pill " + cls;
  p.innerHTML = '<span class="dot"></span> ' + text;
  p.title = Store.mode === "live"
    ? "Connected to the shared board on this server. Everyone on the Network URL sees these changes."
    : "The server is not reachable, so changes stay on this device.";
}
