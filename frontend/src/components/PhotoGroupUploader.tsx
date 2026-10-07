import React, { useRef, useState } from "react";
import { uploadPhoto } from "../shared/uploadPhoto";
import type { Photo } from "../types";

export default function PhotoGroupUploader({ label, photos, onChange, optional }: { label: string; photos: Photo[]; onChange: (photos: Photo[]) => void; optional?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const uploaded: Photo[] = [];
    for (const f of Array.from(files)) uploaded.push(await uploadPhoto(f, "dpr", label));
    onChange([...photos, ...uploaded]);
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-main)" }}>{label}</label>
        {optional && <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>optional</span>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          style={{
            width: 56,
            height: 56,
            borderRadius: 10,
            border: "1.5px dashed var(--border-strong)",
            background: "var(--bg-subtle)",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            cursor: busy ? "default" : "pointer",
            flexShrink: 0
          }}
          title={busy ? "Uploading…" : "Add photo"}
        >
          {busy ? "…" : "📷"}
        </button>
        {photos.map((p, i) => (
          <div key={i} style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
            <img
              className="photo-thumb"
              src={p.url}
              onClick={() => window.open(p.url, "_blank")}
              style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}
            />
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, pi) => pi !== i))}
              style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 99, border: "none", background: "var(--color-fail)", color: "#fff", fontSize: 10, cursor: "pointer" }}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
