import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { nextId } from "../shared/helpers";
import Card from "../ui/tw/Card";
import PhotoGroupUploader from "./PhotoGroupUploader";
import SearchDropdown from "./SearchDropdown";
import type { CustomFormDef, Photo } from "../types";

type OptionPhotos = { work: Photo[]; before: Photo[]; after: Photo[] };
const emptyOptionPhotos = (): OptionPhotos => ({ work: [], before: [], after: [] });

/** Renders one CustomFormDef's fields and submits a CustomFormSubmission.
 *  Used both standalone (pages/public/PublicCustomFormPage.tsx, no login)
 *  and from inside the app (Masters ▸ Form Master ▸ "Fill form", any
 *  logged-in user) — same component either way, since the backend already
 *  accepts an anonymous formSubmissions upsert for public forms and a
 *  normal authenticated one for everything else. */
export default function CustomFormFill({ form, onDone }: { form: CustomFormDef; onDone: (id: string) => void }) {
  const { data, apply, currentUserId, toast } = useApp();
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  function setV(k: string, v: any) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function submit() {
    for (const f of form.fields) {
      const v = values[f.key];
      const empty = f.type === "multiselect" ? !Array.isArray(v) || v.length === 0 : (v === undefined || v === "" || v == null);
      if (f.required && empty) {
        toast(f.label + " is required");
        return;
      }
      if (f.type === "multiselect" && f.photoEvidence && (f.minPhotos || 0) > 0 && Array.isArray(v)) {
        const min = f.minPhotos || 0;
        const photosByOption: Record<string, OptionPhotos> = values[f.key + "__photos"] || {};
        const missing = v.find((o: string) => {
          const p = photosByOption[o];
          const count = p ? p.work.length + p.before.length + p.after.length : 0;
          return count < min;
        });
        if (missing) {
          toast(`"${missing}" needs at least ${min} photo${min === 1 ? "" : "s"}`);
          return;
        }
      }
    }
    setSaving(true);
    const id = nextId("SUB", coll(data, "formSubmissions"));
    await apply([
      {
        op: "upsert", coll: "formSubmissions",
        rec: {
          id, formId: form.id, values, submittedAt: Date.now(),
          submittedByUserId: currentUserId || null, isPublic: !currentUserId
        } as any
      }
    ]);
    setSaving(false);
    onDone(id);
  }

  const simpleFields = form.fields.filter((f) => f.type !== "multiselect");
  const multiFields = form.fields.filter((f) => f.type === "multiselect");

  function renderSimpleField(f: typeof form.fields[number]) {
    const v = values[f.key];
    const full = f.type === "textarea";
    let inner: React.ReactNode;
    if (f.type === "bool") {
      const yesLabel = f.yesLabel || "Yes";
      const noLabel = f.noLabel || "No";
      return (
        <div key={f.key}>
          <div className="field"><label>{f.label}{f.required ? " *" : ""}</label></div>
          <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
            <label className="cf-option">
              <input type="radio" name={"cf-" + f.key} checked={v === true} onChange={() => setV(f.key, true)} /> {yesLabel}
            </label>
            <label className="cf-option">
              <input type="radio" name={"cf-" + f.key} checked={v === false} onChange={() => setV(f.key, false)} /> {noLabel}
            </label>
          </div>
        </div>
      );
    } else if (f.type === "select") {
      // SearchDropdown instead of a plain native <select> — a long option
      // list (e.g. all 164 contractors) otherwise dumps its entire native
      // listbox on screen with no search and no cap; this keeps the panel
      // to a fixed scrollable height and lets you type to filter.
      inner = (
        <SearchDropdown
          value={v ?? ""}
          onChange={(val) => setV(f.key, val)}
          options={(f.options || []).map((o) => ({ value: o, label: o }))}
        />
      );
    } else if (f.type === "textarea") {
      inner = <textarea className="textarea" value={v ?? ""} onChange={(e) => setV(f.key, e.target.value)} />;
    } else {
      inner = (
        <input
          className="input" type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
          value={v ?? ""} onChange={(e) => setV(f.key, e.target.value)}
        />
      );
    }
    return (
      <div className={"field" + (full ? " full" : "")} key={f.key}>
        <label>{f.label}{f.required ? " *" : ""}</label>
        {inner}
      </div>
    );
  }

  return (
    <div>
      {form.description && <div className="hint" style={{ marginBottom: 16 }}>{form.description}</div>}

      {simpleFields.length > 0 && (
        <Card className="mb-4">
          <div className="form-grid">{simpleFields.map(renderSimpleField)}</div>
        </Card>
      )}

      {multiFields.map((f) => {
        const v = values[f.key];
        const selected: string[] = Array.isArray(v) ? v : [];
        const photosKey = f.key + "__photos";
        const photosByOption: Record<string, OptionPhotos> = values[photosKey] || {};

        function setOptionPhotos(option: string, group: keyof OptionPhotos, photos: Photo[]) {
          const current = photosByOption[option] || emptyOptionPhotos();
          setV(photosKey, { ...photosByOption, [option]: { ...current, [group]: photos } });
        }

        return (
          <Card key={f.key} className="mb-4">
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{f.label}{f.required ? " *" : ""}</div>
            <div className="cf-option-grid">
              {(f.options || []).map((o) => (
                <label key={o} className="cf-option">
                  <input
                    type="checkbox" checked={selected.includes(o)}
                    onChange={(e) => setV(f.key, e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))}
                  /> {o}
                </label>
              ))}
            </div>

            {f.photoEvidence && selected.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {selected.length} item{selected.length === 1 ? "" : "s"} selected — {(f.minPhotos || 0) > 0 ? `at least ${f.minPhotos} photo${f.minPhotos === 1 ? "" : "s"} required per item` : "photos optional"}
                </div>
                {selected.map((o) => {
                  const p = photosByOption[o] || emptyOptionPhotos();
                  return (
                    <div key={o} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{o}</div>
                      <PhotoGroupUploader label="Work Photos" photos={p.work} onChange={(ph) => setOptionPhotos(o, "work", ph)} optional={!(f.minPhotos && f.minPhotos > 0)} />
                      <PhotoGroupUploader label="Before Photo" photos={p.before} onChange={(ph) => setOptionPhotos(o, "before", ph)} optional={!(f.minPhotos && f.minPhotos > 0)} />
                      <PhotoGroupUploader label="After Photo" photos={p.after} onChange={(ph) => setOptionPhotos(o, "after", ph)} optional={!(f.minPhotos && f.minPhotos > 0)} />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      <button className="btn btn-primary" style={{ marginTop: 4, width: "100%" }} disabled={saving} onClick={submit}>
        {saving ? "Submitting…" : "Submit Report"}
      </button>
    </div>
  );
}
