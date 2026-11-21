// Auth store using Svelte writable stores

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { api, setAuthToken, clearAuthToken, getAuthToken } from '$lib/utils/api';
import type { User } from '$lib/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

function createAuthStore() {
  const initialState: AuthState = {
    user: null,
    token: browser ? getAuthToken() : null,
    isLoading: false,
    error: null,
  };

  const { subscribe, set, update } = writable<AuthState>(initialState);

  // Initialize from localStorage on browser
  if (browser) {
    const token = getAuthToken();
    if (token) {
      // Validate token by fetching user profile
      api.auth.me()
        .then((user) => {
          set({ ...get(authStore), user, token, isLoading: false });
        })
        .catch(() => {
          clearAuthToken();
          set({ ...initialState, isLoading: false });
        });
    }
  }

  return {
    subscribe,

    async login(email: string, password: string) {
      update((state) => ({ ...state, isLoading: true, error: null }));

      try {
        const { user, token } = await api.auth.login({ email, password });
        setAuthToken(token);
        set({ user, token, isLoading: false, error: null });
        return { success: true };
      } catch (error: any) {
        const message = error.message || 'Échec de la connexion';
        update((state) => ({ ...state, isLoading: false, error: message }));
        return { success: false, error: message };
      }
    },

    async register(email: string, password: string, name: string) {
      update((state) => ({ ...state, isLoading: true, error: null }));

      try {
        const { user, token } = await api.auth.register({ email, password, name });
        setAuthToken(token);
        set({ user, token, isLoading: false, error: null });
        return { success: true };
      } catch (error: any) {
        const message = error.message || "Échec de l'inscription";
        update((state) => ({ ...state, isLoading: false, error: message }));
        return { success: false, error: message };
      }
    },

    logout() {
      clearAuthToken();
      set({ user: null, token: null, isLoading: false, error: null });
    },

    clearError() {
      update((state) => ({ ...state, error: null }));
    },
  };
}

export const authStore = createAuthStore();

// Derived stores
export const isAuthenticated = derived(authStore, ($auth) => !!$auth.token && !!$auth.user);
export const currentUser = derived(authStore, ($auth) => $auth.user);
export const authLoading = derived(authStore, ($auth) => $auth.isLoading);
export const authError = derived(authStore, ($auth) => $auth.error);