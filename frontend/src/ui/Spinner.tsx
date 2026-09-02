import React from "react";

/** Plain centered loading label — matches the app's existing .empty CSS
 *  treatment, used for full-page/section loading states. */
export default function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="empty">{label}</div>;
}
