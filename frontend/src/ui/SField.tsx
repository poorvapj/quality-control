import React from "react";
import SearchDropdown, { type DropdownOption } from "../components/SearchDropdown";

interface SFieldProps {
  label: React.ReactNode;
  required?: boolean;
  full?: boolean;
  hint?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder?: string;
}

/** Label + searchable select field — the select-style counterpart to
 *  Field.tsx, built on the app's existing SearchDropdown component instead
 *  of a plain native <select>. */
export default function SField({ label, required, full = true, hint, value, onChange, options, placeholder = "Select…" }: SFieldProps) {
  return (
    <div className={"field" + (full ? " full" : "")}>
      <label>{label}{required && " *"}</label>
      <SearchDropdown
        value={value}
        onChange={onChange}
        options={value ? options : [{ value: "", label: placeholder }, ...options]}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
