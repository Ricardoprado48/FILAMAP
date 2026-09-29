import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { startWebTelemetry } from "./observability/webTelemetry";
import { GuidePage, PrivacyPage, publicPageFor } from "./components/PublicPages";

startWebTelemetry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {publicPageFor(window.location.pathname) === "guia" ? <GuidePage /> : publicPageFor(window.location.pathname) === "privacidade" ? <PrivacyPage /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
