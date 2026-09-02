import React, { useRef, useState } from "react";
import { uploadPhoto } from "../shared/uploadPhoto";
import type { Photo } from "../types";

export default function PhotoGroupUploader({ label, photos, onChange }: { label: string; photos: Photo[]; onChange: (photos: Photo[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const uploaded: Photo[] = [];
    for (const f of Array.from(files)) uploaded.push(await uploadPhoto(f, "dpr"));
    onChange([...photos, ...uploaded]);
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-sub)" }}>{label}</label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Uploading…" : "📷 Add"}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, pi) => pi !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 99, border: "none", background: "var(--color-fail)", color: "#fff", fontSize: 10, cursor: "pointer" }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
