import React from "react";

interface FieldProps {
  label: React.ReactNode;
  required?: boolean;
  full?: boolean;
  hint?: React.ReactNode;
  textarea?: boolean;
  rows?: number;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  placeholder?: string;
  type?: string;
}

/** Label + text input/textarea, matching the app's existing .field/.input/
 *  .textarea CSS exactly — the plain-text counterpart to SField (below),
 *  which handles select-style fields via SearchDropdown. */
export default function Field({ label, required, full = true, hint, textarea, rows = 3, value, onChange, placeholder, type = "text" }: FieldProps) {
  return (
    <div className={"field" + (full ? " full" : "")}>
      <label>{label}{required && " *"}</label>
      {textarea ? (
        <textarea className="textarea" rows={rows} value={value} onChange={onChange} placeholder={placeholder} />
      ) : (
        <input className="input" type={type} value={value} onChange={onChange} placeholder={placeholder} />
      )}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
