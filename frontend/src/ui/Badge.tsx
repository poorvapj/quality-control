import React from "react";

type Tone = "pass" | "fail" | "gate" | "wip" | "meas" | "mute" | "crit";

/** Thin wrapper around the app's existing .badge-tag CSS classes. */
export default function Badge({ children, tone = "mute" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`badge-tag ${tone}`}>{children}</span>;
}
