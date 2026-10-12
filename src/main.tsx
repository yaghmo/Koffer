import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import UpdatePrompt from "./components/UpdatePrompt";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { logUi } from "./lib/log";

// Anything that escapes a component ends up in the app log, so a crash the
// user hit yesterday is still readable today.
window.addEventListener("error", (e) => logUi("warn", "window", `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => logUi("warn", "window", `unhandled rejection: ${String(e.reason)}`));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <UpdatePrompt />
  </React.StrictMode>
);
