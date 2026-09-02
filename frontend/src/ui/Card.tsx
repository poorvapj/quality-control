import React from "react";

/** Thin wrapper around the app's existing .card / .card-pad CSS classes. */
export default function Card({ children, padded = true, style, className = "" }: { children: React.ReactNode; padded?: boolean; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={`card ${padded ? "card-pad" : ""} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
