import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Reuse the root across hot reloads: https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
const rootElement = document.getElementById("root") as HTMLElement;
import.meta.hot.data.root ??= createRoot(rootElement);
import.meta.hot.data.root.render(app);
