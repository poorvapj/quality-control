import React from "react";
import Badge, { type BadgeColor } from "./Badge";

export type StatusKey =
  | "Locked" | "Pending" | "In Progress" | "Completed"
  | "Snagged" | "Handover Ready" | "Critical" | "Overdue";

/* Single source of truth for status → color across the app's newer
   Tailwind-built pages — every page that needs a status pill imports this
   instead of picking a Badge color ad hoc, so "Completed" always renders
   the same green everywhere, "Critical"/"Overdue"/"Snagged" the same red,
   etc. Colors reuse Badge's existing palette (Badge.tsx) — no new colors
   introduced, matching the app's existing orange/grey/enterprise theme. */
export const STATUS_COLOR: Record<StatusKey, BadgeColor> = {
  Locked: "gray",
  Pending: "amber",
  "In Progress": "blue",
  Completed: "green",
  Snagged: "red",
  "Handover Ready": "green",
  Critical: "red",
  Overdue: "red"
};

export default function StatusBadge({ status, label }: { status: StatusKey; label?: string }) {
  return <Badge color={STATUS_COLOR[status]}>{label ?? status}</Badge>;
}
