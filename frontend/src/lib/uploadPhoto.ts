import { API_BASE } from "../services/config";
import type { Photo } from "../types";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Uploads to the existing /api/photo endpoint (Cloudinary). Falls back to
 *  keeping the raw data URL locally if the network call fails, same pattern
 *  as the rest of the app's optimistic-first approach. */
export async function uploadPhoto(file: File, type: "snags" | "qc" | "progress" | "drawings" | "dpr"): Promise<Photo> {
  const dataUrl = await fileToDataUrl(file);
  try {
    const r = await fetch(API_BASE + "/api/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, type })
    });
    const j = await r.json();
    if (j.url) return { url: j.url, publicId: j.publicId || null };
  } catch {}
  return { url: dataUrl, publicId: null };
}
