import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

const rootElement = document.getElementById("root") as HTMLElement;
// Reuse the root across hot reloads: https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
// Keep this exact one-expression form. Production builds rewrite it to
// createRoot(rootElement).render(app); split into two statements, the build
// leaves `root` undefined and the page stays blank.
// biome-ignore lint/suspicious/noAssignInExpressions: see above
(import.meta.hot.data.root ??= createRoot(rootElement)).render(app);
