import React from "react";
import NavIcon from "../../components/NavIcon";

type BtnColor = "primary" | "secondary" | "danger";

/* Tailwind-utility version of the plain-CSS ../Btn.tsx (kept separate —
   see ui/tw/Card.tsx's header comment for why this subfolder exists).
   Same three colors, same small/default sizing, built from the style
   guide's conventions (rounded-lg default shape, orange primary,
   font-semibold). */
export default function Btn({
  label, icon, color = "primary", size = "md", full, loading, className = "", disabled, ...rest
}: {
  label: string;
  icon?: string;
  color?: BtnColor;
  size?: "sm" | "md";
  full?: boolean;
  loading?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">) {
  const base = "inline-flex items-center justify-center gap-2 rounded-radius-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const sizeCls = size === "sm" ? "text-[12.5px] px-3 py-1.5" : "text-[13px] px-4 py-2.5";
  const colorCls =
    color === "primary" ? "bg-primary text-white hover:bg-primary-hover" :
    color === "danger" ? "bg-[var(--color-fail)] text-white hover:opacity-90" :
    "bg-[var(--bg-subtle)] text-[var(--text-main)] border border-[var(--border)] hover:bg-[var(--bg-card-hover)]";

  return (
    <button
      className={`${base} ${sizeCls} ${colorCls} ${full ? "w-full" : ""} ${className}`}
      disabled={loading || disabled}
      {...rest}
    >
      {icon && <NavIcon name={icon} size={size === "sm" ? 13 : 15} />}
      {loading ? "…" : label}
    </button>
  );
}
