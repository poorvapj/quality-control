import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./theme/tailwind.css";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { matchPublicRoute } from "./routes/publicRoutes";

const PublicPage = matchPublicRoute(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      {PublicPage ? <PublicPage /> : <App />}
    </AppProvider>
  </React.StrictMode>
);
