// Backend location resolution.
//
// Local dev: PUBLIC_BACKEND_URL is unset → same-origin `/api` (Vite proxy) and `ws://localhost:3000/game`.
// Deployed (front and back on different hosts, e.g. Render): PUBLIC_BACKEND_URL is the backend
// origin, e.g. `https://we-quiz-api.onrender.com`. It is read at runtime ($env/dynamic/public), so
// changing it only needs a service restart, not a rebuild.

import { env } from '$env/dynamic/public';

type LocationLike = Pick<Location, 'hostname' | 'port' | 'protocol' | 'host'>;

/** Validates and normalizes the configured backend origin. Returns null when unset. */
export function parseBackendUrl(raw: string | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`PUBLIC_BACKEND_URL is not a valid URL: "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`PUBLIC_BACKEND_URL must use http(s), got "${url.protocol}"`);
  }
  // Keep the origin only: paths are appended by the resolvers below.
  return new URL(url.origin);
}

/** REST base: `<backend>/api`, or same-origin `/api` when no backend URL is configured. */
export function resolveApiBase(backend: URL | null): string {
  return backend ? `${backend.origin}/api` : '/api';
}

/** Game WebSocket URL (ADR 0001 §1): the gateway listens on path `/game` of the backend host. */
export function resolveGameSocketUrl(backend: URL | null, location: LocationLike): string {
  if (backend) {
    const wsProtocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${backend.host}/game`;
  }
  const { hostname, port, protocol, host } = location;
  if (hostname === 'localhost' && port === '5173') return 'ws://localhost:3000/game';
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/game`;
}

export function getApiBase(): string {
  return resolveApiBase(parseBackendUrl(env.PUBLIC_BACKEND_URL));
}

export function getBackendSocketUrl(): string {
  return resolveGameSocketUrl(parseBackendUrl(env.PUBLIC_BACKEND_URL), window.location);
}
