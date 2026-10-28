/* Editing a Masters record used to send the WHOLE record as it was when the form opened (plus the form's fields).
   Every field the form does not show — and every field someone else changed while the form was open — was written
   back with the old value. Now only the fields that actually changed are sent (always with the id): the server merges
   them field by field, so a colleague's unrelated change to the same record survives.

   `null` and `undefined` count as the same "empty", so an untouched empty field is not sent; clearing a field that had a
   value sends `null` (which the server removes). Pure; tested in tests/recordDiff.test.mjs. */
export function diffRecord<T extends { id?: string }>(original: Record<string, any> | null | undefined, updated: T): Partial<T> & { id?: string } {
  const out: Record<string, any> = { id: updated.id };
  const orig = original || {};
  for (const k of Object.keys(updated)) {
    if (k === "id") continue;
    const before = orig[k], after = (updated as any)[k];
    const same = (before == null && after == null) || JSON.stringify(before) === JSON.stringify(after);
    if (!same) out[k] = after;
  }
  return out as any;
}

/* Permission grants are { moduleKey: { view, create, edit, delete } }. Saving the whole object made the last admin to
   save overwrite every module another admin had just changed for the same user/role. This returns only the modules
   that differ from what was loaded, as dotted keys ("grants.masters": {...}, or null to remove one), which the server
   $sets one by one. */
export function grantPatch(base: Record<string, any> | null | undefined, next: Record<string, any>, prefix: string = "grants"): Record<string, any> {
  const out: Record<string, any> = {};
  const b = base || {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(next)])) {
    if (JSON.stringify(b[k]) === JSON.stringify(next[k])) continue;
    out[prefix + "." + k] = next[k] === undefined ? null : next[k];
  }
  return out;
}
