// Test-only no-op stand-in for the `server-only` package.
//
// The real `server-only` module throws at import time — it is a Next.js
// build-time marker that flags a module as server-exclusive. That guard makes
// any module doing `import "server-only"` impossible to import under vitest's
// node/jsdom runtime. vitest.config.mts aliases `server-only` to this empty
// module so server-only adapters (e.g. the Box client) can be imported
// and unit/property-tested directly. The production Next.js build still
// resolves the real throwing package, so the server-side guard is unchanged.
export {};
