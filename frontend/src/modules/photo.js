/* ===========================================================================
   Photo capture + watermarking + Cloudinary upload. Extracted verbatim.
   =========================================================================== */

import { state, $, toast } from "../state/appState.js";
import { Store } from "../services/store.js";
import { API_BASE } from "../services/config.js";
import { byId, me, refLabel } from "./helpers.js";
import { logEvent } from "./actions.js";
import { reopenDrawer } from "../components/drawer.js";

export function capturePhoto(kind, id, stageId) {
  const input = $("photoInput");
  input.value = "";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    toast("Processing photo…");
    const dataUrl = await watermark(file, kind === "snag" ? refLabel("snags", id) : refLabel(kind === "unit" ? "units" : "floors", id));
    // Cloudinary folder segregation: snag evidence vs hidden-work measurement evidence.
    const photoType = kind === "snag" ? "snags" : "progress";
    let photo = { url: dataUrl, publicId: null };
    if (Store.mode === "live") {
      try {
        const r = await fetch(API_BASE + "/api/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, type: photoType })
        });
        const j = await r.json();
        if (j.url) photo = { url: j.url, publicId: j.publicId || null };
      } catch {}
    }
    if (kind === "snag") {
      const s = byId("snags", id);
      Store.apply([{ op: "upsert", coll: "snags", rec: Object.assign({}, s, { photos: (s.photos || []).concat([photo]) }) }]);
    } else {
      Store.apply([
        { op: "progress", key: id + "::" + stageId, patch: { meas: Date.now(), measBy: state.currentUserId, photo } },
        logEvent("MEASURE", id, stageId, "Hidden work measured and photographed")
      ]);
    }
    reopenDrawer();
    toast("Photo attached");
  };
  input.click();
}

/* Shrink + stamp the image so the evidence carries its own context. */
export function watermark(file, label) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const pad = Math.round(c.width * 0.02);
      const fs = Math.max(12, Math.round(c.width * 0.028));
      const text = `${label} · ${new Date().toLocaleString("en-IN")} · ${me() ? me().name : ""}`;
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(pad, c.height - pad - fs * 1.8, w + fs, fs * 1.8);
      ctx.fillStyle = "#00ff66";
      ctx.fillText(text, pad + fs / 2, c.height - pad - fs * 0.5);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve("");
    img.src = URL.createObjectURL(file);
  });
}
