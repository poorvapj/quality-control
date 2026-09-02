import React from "react";
import PublicDprPage from "../pages/public/PublicDprPage";
import PublicDrawingRequestPage from "../pages/public/PublicDrawingRequestPage";

/* Minimal path-based routing — this app has no URL router anywhere else
   (it's a single-page tab switcher), so this is a new, deliberately small
   pattern: only these two public, no-login paths are recognized; every
   other URL renders the normal app shell. */
export const PUBLIC_ROUTES: Record<string, React.ComponentType> = {
  "/dpr/new": PublicDprPage,
  "/drawing-requests/new": PublicDrawingRequestPage
};

export function matchPublicRoute(pathname: string): React.ComponentType | undefined {
  const path = pathname.replace(/\/+$/, "");
  return PUBLIC_ROUTES[path];
}
