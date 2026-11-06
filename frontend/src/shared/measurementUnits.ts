import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "./rules";

// Fallback used only if Masters ▸ Measurement Units is empty (fresh DB
// before it's been populated) — identical to the previous hardcoded list.
const FALLBACK_UNITS = ["sq.ft", "R.ft", "Rmt", "Cum", "Sqm", "Kg", "MT", "Nos", "Bag", "Ltr"];

export function useMeasurementUnits(): string[] {
  const { data } = useApp();
  const rows = coll(data, "measurementUnits") as { name: string; order?: number; active?: boolean }[];
  return useMemo(() => {
    const live = (rows || []).filter((r) => r.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    return live.length ? live.map((r) => r.name) : FALLBACK_UNITS;
  }, [rows]);
}
