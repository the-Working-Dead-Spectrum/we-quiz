// API client for REST endpoints

import type { CreateGameResponse } from '$lib/types';
import { getApiBase } from './backend-url';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

async function fetchJson<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, headers, ...init } = options;

  // Absolute when PUBLIC_BACKEND_URL is set; otherwise resolved against the current origin.
  const url = new URL(`${getApiBase()}${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...headers,
  };

  // Add auth token if available
  const token = localStorage.getItem('auth_token');
  if (token) {
    (defaultHeaders as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    ...init,
    headers: defaultHeaders,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  // Auth
  auth: {
    register: (data: { email: string; password: string; name: string }) =>
      fetchJson<{ user: any; token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    login: (data: { email: string; password: string }) =>
      fetchJson<{ user: any; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    me: () => fetchJson<any>('/auth/me'),
  },

  // Quizzes
  quizzes: {
    // The backend scopes the list to the authenticated user (JWT); no client-side filter.
    list: () => fetchJson<any[]>('/quizzes'),

    listPublic: () => fetchJson<any[]>('/quizzes/public'),

    get: (id: string) => fetchJson<any>(`/quizzes/${id}`),

    getForGame: (id: string) => fetchJson<any>(`/quizzes/${id}/game`),

    create: (data: any) =>
      fetchJson<any>('/quizzes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (id: string, data: any) =>
      fetchJson<any>(`/quizzes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      fetchJson<{ message: string }>(`/quizzes/${id}`, {
        method: 'DELETE',
      }),

    // Share functionality
    togglePublic: (id: string) =>
      fetchJson<any>(`/quizzes/${id}/public`, { method: 'PUT' }),

    generateShareToken: (id: string) =>
      fetchJson<any>(`/quizzes/${id}/share`, { method: 'POST' }),

    revokeShareToken: (id: string) =>
      fetchJson<any>(`/quizzes/${id}/share`, { method: 'DELETE' }),

    getByShareToken: (token: string) =>
      fetchJson<any>(`/quizzes/shared/${token}`),

    // Multipart upload: we must NOT set Content-Type, so the browser adds the boundary itself.
    importPreview: async (
      file: File,
      meta: { title: string; description?: string; isPublic?: boolean },
    ): Promise<{
      dto: any | null;
      errors: Array<{ row: number; field?: string; message: string }>;
      questionCount: number;
    }> => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', meta.title);
      if (meta.description) form.append('description', meta.description);
      if (meta.isPublic) form.append('isPublic', 'true');

      const url = new URL(`${getApiBase()}/quizzes/import/preview`, window.location.origin);
      const headers: Record<string, string> = {};
      const token = localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(url.toString(), { method: 'POST', headers, body: form });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Erreur d\'import' }));
        throw new Error(err.message || `HTTP ${response.status}`);
      }
      return response.json();
    },
  },

  // Players
  players: {
    getGamePlayers: (pin: string) =>
      fetchJson<any[]>(`/players/game/${pin}`),

    getGameResults: (sessionId: string) =>
      fetchJson<any>(`/players/session/${sessionId}`),
  },

  // Games
  games: {
    // ADR 0001 §10. The returned hostToken must go to localStorage only, never to a URL.
    createRoom: (quizId: string) =>
      fetchJson<CreateGameResponse>('/games', {
        method: 'POST',
        body: JSON.stringify({ quizId }),
      }),

    getRoom: (code: string) =>
      fetchJson<any>(`/games/${code}`),

    getPlayers: (code: string) =>
      fetchJson<any[]>(`/games/${code}/players`),

    startGame: (code: string) =>
      fetchJson<any>(`/games/${code}/start`, { method: 'POST' }),
  },
};

// Helper to set auth token
export function setAuthToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

export function clearAuthToken(): void {
  localStorage.removeItem('auth_token');
}

export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}