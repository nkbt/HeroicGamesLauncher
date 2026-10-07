// nk: #6 - setup file for the Frontend jest project (node environment, no
// jsdom).
// nk: #5 - a minimal `window` with an empty `api`: some frontend modules
// (frontend/helpers) read `window.api.*` when they are imported. Tests put
// the functions they need on `window.api` themselves.
const globals = globalThis as unknown as { window?: { api: object } }
globals.window = globals.window ?? { api: {} }

export {}
