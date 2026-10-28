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
