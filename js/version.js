// Single source of truth for the app version.
//
// Loaded by index.html (shown in the header) AND by sw.js via importScripts,
// so bumping this one line both updates what you see on screen and changes the
// Service Worker's cache name - which is what actually forces a stale cached
// copy to be replaced. Bump it on every deploy; if the header still shows the
// old number after refreshing, the update genuinely hasn't landed yet.
const APP_VERSION = "v0.0.006";
