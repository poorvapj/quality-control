/* Stamps every site photo with date/time + GPS coordinates (+ who took it,
   when known) directly onto the image pixels — burned in, not EXIF/metadata,
   so it survives however the photo gets viewed/downloaded/shared later.
   Centralized here so every capture path (hidden-work measurement + snag
   photos via hooks/useActions.ts, and QC-evidence/DPR photos via
   shared/uploadPhoto.ts) stamps identically instead of each having its own
   copy. Reverse geocoding to a human address would need a paid API key
   this app doesn't have configured — raw lat/long (4 decimal places, ~11m
   precision) is honest and needs no external service. */

function getGeoText(): Promise<string> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve(""); return; }
    const timer = setTimeout(() => resolve(""), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const lat = pos.coords.latitude.toFixed(4);
        const lon = pos.coords.longitude.toFixed(4);
        resolve(`${lat}°N, ${lon}°E`);
      },
      () => { clearTimeout(timer); resolve(""); },
      { enableHighAccuracy: true, timeout: 5500, maximumAge: 60000 }
    );
  });
}

export function watermarkPhoto(file: File, label: string, byName?: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const geo = await getGeoText();
      const maxW = 1280;
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);

      const lines = [
        `${label} · ${new Date().toLocaleString("en-IN")}${byName ? " · " + byName : ""}`,
        geo ? `📍 ${geo}` : "📍 Location unavailable"
      ];
      const pad = Math.round(c.width * 0.02);
      const fs = Math.max(11, Math.round(c.width * 0.026));
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      const w = Math.max(...lines.map((t) => ctx.measureText(t).width));
      const boxH = fs * 1.6 * lines.length + fs * 0.4;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(pad, c.height - pad - boxH, w + fs, boxH);
      ctx.fillStyle = "#00ff66";
      lines.forEach((t, i) => {
        ctx.fillText(t, pad + fs / 2, c.height - pad - boxH + fs * 1.6 * (i + 1) - fs * 0.3);
      });
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => resolve("");
    img.src = URL.createObjectURL(file);
  });
}
