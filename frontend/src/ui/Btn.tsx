import React from "react";

type Variant = "primary" | "secondary" | "success" | "danger";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: React.ReactNode;
  variant?: Variant;
  loading?: boolean;
  full?: boolean;
}

/** Thin wrapper around the app's existing .btn CSS classes — gives call
 *  sites a single reusable component instead of repeating className +
 *  disabled/loading-label plumbing everywhere. */
export default function Btn({ label, variant = "primary", loading = false, full = false, className = "", disabled, style, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${className}`.trim()}
      disabled={disabled || loading}
      style={{ ...(full ? { width: "100%", justifyContent: "center" } : {}), ...style }}
      {...rest}
    >
      {loading ? "Saving…" : label}
    </button>
  );
}
