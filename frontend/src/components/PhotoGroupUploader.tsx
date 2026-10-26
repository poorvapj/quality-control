import React, { useRef, useState } from "react";
import { uploadPhoto } from "../shared/uploadPhoto";
import { useApp } from "../context/AppContext";
import type { Photo } from "../types";

function PhotoGroupUploader({ label, photos, onChange, optional }: { label: string; photos: Photo[]; onChange: (photos: Photo[]) => void; optional?: boolean }) {
  const { toast } = useApp();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    // Uploading one at a time (await in a loop) made a 3-photo submission
    // take 3x as long as the slowest single upload — each photo is an
    // independent request, so run them concurrently instead.
    const uploaded = await Promise.all(Array.from(files).map((f) => uploadPhoto(f, "dpr", label)));
    onChange([...photos, ...uploaded]);
    setBusy(false);
    // The upload itself failed (network/Cloudinary) — the photo still
    // shows (kept as raw local data), but silently leaving it at that was
    // exactly how a photo-heavy submission went missing with no warning.
    if (uploaded.some((p) => p.localOnly)) {
      toast("A photo upload failed — it's kept locally for now, but try re-uploading before you submit");
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-main)" }}>{label}</label>
        {optional && <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>optional</span>}
      </div>
      {/* Two explicit pickers so the person chooses: Camera opens the camera
          straight away (capture), Gallery opens the photo library with
          multi-select. A single plain input leaves it to each phone's browser. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {([
          { ref: cameraRef, icon: "📷", text: "Camera", title: "Take a photo with the camera" },
          { ref: galleryRef, icon: "🖼️", text: "Gallery", title: "Choose photos from the gallery" }
        ] as const).map((b) => (
          <button
            key={b.text}
            type="button"
            disabled={busy}
            onClick={() => b.ref.current?.click()}
            style={{
              width: 56,
              height: 56,
              borderRadius: 10,
              border: "1.5px dashed var(--border-strong)",
              background: "var(--bg-subtle)",
              color: "var(--text-muted)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              fontSize: 17,
              cursor: busy ? "default" : "pointer",
              flexShrink: 0
            }}
            title={busy ? "Uploading…" : b.title}
          >
            <span>{busy ? "…" : b.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}>{b.text}</span>
          </button>
        ))}
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

export default React.memo(PhotoGroupUploader);
