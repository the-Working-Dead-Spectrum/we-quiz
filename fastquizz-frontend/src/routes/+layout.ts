// SPA mode: the app is browser-only (localStorage auth, native WebSocket), so server rendering
// brings nothing. It also avoids a SvelteKit 2.x + Svelte 4 bug where adapter-node's bundle
// defeats Kit's legacy-mode detection and crashes SSR with "$state is not defined".
// Revisit when migrating to Svelte 5 (see docs/tech-debt.md).
export const ssr = false;
