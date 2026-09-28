import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Import first in UI test files, before React: react-dom checks for a DOM when
// it loads. bunfig's `isolate` gives each file a fresh global, so these
// globals never reach the proxy tests.
GlobalRegistrator.register();
