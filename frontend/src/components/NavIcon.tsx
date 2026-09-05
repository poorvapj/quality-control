import React from "react";
import {
  LayoutDashboard, Zap, Grid3x3, AlertTriangle, Users, ClipboardList, PenTool, Settings,
  Award, Bug, Clock, TrendingUp, MapPin, Pencil, Trash2, Eye, EyeOff,
  ChevronsLeft, ChevronsRight, Check, ChevronDown, Search, Calendar, Download, Database,
  MoreHorizontal, Circle, type LucideIcon
} from "lucide-react";

/* Same {name, size} public API as the old hand-drawn SVG set — every one
   of the 62 call sites elsewhere in the app is unaffected by this swap.
   Internally now backed by lucide-react instead of inline <svg> paths. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  work: Zap,
  board: Grid3x3,
  snags: AlertTriangle,
  team: Users,
  dpr: ClipboardList,
  drawing: PenTool,
  masters: Settings,
  award: Award,
  bug: Bug,
  clock: Clock,
  trend: TrendingUp,
  pin: MapPin,
  edit: Pencil,
  trash: Trash2,
  eye: Eye,
  eyeOff: EyeOff,
  chevronsLeft: ChevronsLeft,
  chevronsRight: ChevronsRight,
  check: Check,
  chevronDown: ChevronDown,
  search: Search,
  calendar: Calendar,
  download: Download,
  database: Database,
  moreHorizontal: MoreHorizontal
};

export default function NavIcon({ name, size = 17 }: { name: string; size?: number }) {
  const Icon = ICONS[name] || Circle;
  return <Icon width={size} height={size} strokeWidth={2} />;
}
