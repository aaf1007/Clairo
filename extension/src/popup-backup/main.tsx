import React from "react";
import ReactDOM from "react-dom/client";
import App from "../entrypoints/popup/App";
import "../entrypoints/popup/style.css";

document.body.dataset.surface = "popup";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App surface="popup" />
  </React.StrictMode>,
);
