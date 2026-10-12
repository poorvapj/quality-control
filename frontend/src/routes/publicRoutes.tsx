import React from "react";
import PublicDprPage from "../pages/public/PublicDprPage";
import PublicDrawingRequestPage from "../pages/public/PublicDrawingRequestPage";
import PublicCustomFormPage from "../pages/public/PublicCustomFormPage";

/* Minimal path-based routing — this app has no URL router anywhere else
   (it's a single-page tab switcher), so this is a new, deliberately small
   pattern: only these no-login paths are recognized; every other URL
   renders the normal app shell. /forms/<id> is the one dynamic path (any
   admin-built custom form, Masters ▸ Form Master) — matched by prefix
   since the id varies; everything else is an exact match. */
export const PUBLIC_ROUTES: Record<string, React.ComponentType> = {
  "/dpr/new": PublicDprPage,
  "/drawing-requests/new": PublicDrawingRequestPage
};

export function matchPublicRoute(pathname: string): React.ComponentType | undefined {
  const path = pathname.replace(/\/+$/, "");
  if (PUBLIC_ROUTES[path]) return PUBLIC_ROUTES[path];
  if (/^\/forms\/[^/]+$/.test(path)) return PublicCustomFormPage;
  return undefined;
}
