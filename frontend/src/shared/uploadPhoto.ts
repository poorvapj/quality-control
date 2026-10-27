import { API_BASE } from "../services/config";
import { authHeaders } from "../context/AppContext";
import type { Photo } from "../types";
import { watermarkPhoto } from "./watermark";

const DEFAULT_LABEL: Record<string, string> = {
  qc: "QC Evidence", snags: "Snag Photo", progress: "Progress Photo", dpr: "DPR Photo", drawings: "", caseStudies: "Case Study"
};

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
 *  as the rest of the app's optimistic-first approach.
 *
 *  Every actual site photo (qc/snags/progress/dpr) gets date+GPS burned in
 *  via watermarkPhoto — "drawings" is skipped since those are real
 *  drawing files (often PDFs), not site photos, and stamping would corrupt
 *  the document. `label` gives the stamp context (e.g. a unit/stage name);
 *  falls back to a generic one per type when the caller doesn't have one
 *  handy. */
export async function uploadPhoto(
  file: File, type: "snags" | "qc" | "progress" | "drawings" | "dpr" | "caseStudies", label?: string
): Promise<Photo> {
  const isSitePhoto = type !== "drawings" && file.type.startsWith("image/");
  const dataUrl = isSitePhoto
    ? await watermarkPhoto(file, label || DEFAULT_LABEL[type])
    : await fileToDataUrl(file);
  try {
    const r = await fetch(API_BASE + "/api/photo", {
      method: "POST",
      // the token (when there is one) lets the server tell a signed-in user from an anonymous
      // public-form upload; with none (or an expired one) the upload is treated as anonymous
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ dataUrl, type })
    });
    const j = await r.json();
    if (j.url) return { url: j.url, publicId: j.publicId || null };
  } catch {}
  // Upload failed — the raw base64 data URL is kept so the photo still
  // shows in this session, but it's flagged `localOnly` so the caller can
  // warn the user instead of silently saving a huge inline string: that
  // string riding inside a record can push a later offline-save's
  // localStorage write (see AppContext.tsx's queueOps) over quota, which
  // is exactly how a submission went missing with no error shown before.
  return { url: dataUrl, publicId: null, localOnly: true };
}
