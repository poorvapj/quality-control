/** Cloudinary serves whatever size is asked for via a transform segment in the
 *  URL — our stored Photo.url is always the untransformed original, so every
 *  56px list thumbnail was pulling the full (up to 1280px-wide) image. This
 *  inserts a small fixed-size/auto-format/auto-quality transform right after
 *  "/upload/" for thumbnail <img> tags, while leaving the stored/original URL
 *  untouched for full-size viewing (photoViewer, downloads, etc). */
export function thumbUrl(url: string, size = 112): string {
  if (!url) return url;
  const marker = "/upload/";
  const i = url.indexOf(marker);
  if (i === -1 || url.includes("res.cloudinary.com") === false) return url;
  const at = i + marker.length;
  return url.slice(0, at) + `c_fill,w_${size},h_${size},q_auto,f_auto/` + url.slice(at);
}
