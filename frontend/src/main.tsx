import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import PublicDprPage from "./pages/public/PublicDprPage";
import PublicDrawingRequestPage from "./pages/public/PublicDrawingRequestPage";

/* Minimal path-based routing — this app has no URL router anywhere else
   (it's a single-page tab switcher), so this is a new, deliberately small
   pattern: only these two public, no-login paths are recognized; every
   other URL renders the normal app shell. */
const path = window.location.pathname.replace(/\/+$/, "");
const PUBLIC_ROUTES: Record<string, React.ComponentType> = {
  "/dpr/new": PublicDprPage,
  "/drawing-requests/new": PublicDrawingRequestPage
};
const PublicPage = PUBLIC_ROUTES[path];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      {PublicPage ? <PublicPage /> : <App />}
    </AppProvider>
  </React.StrictMode>
);
