<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  let email = '';
  let password = '';
  let isLoading = false;
  let error: string | null = null;

  async function handleLogin(event: Event) {
    event.preventDefault();

    if (!email || !password || isLoading) return;

    isLoading = true;
    error = null;

    const result = await authStore.login(email, password);

    if (result.success) {
      goto('/admin');
    } else {
      error = result.error || 'Erreur de connexion';
    }

    isLoading = false;
  }

  // Enter submits the form natively: no extra keydown handler (it caused a double submit).
</script>

<svelte:head>
  <title>{pageTitle('Connexion')}</title>
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-primary-50/60 to-white">
  <main class="min-h-dvh flex items-center justify-center px-4 py-10" style="padding-top: max(2.5rem, env(safe-area-inset-top)); padding-bottom: max(2.5rem, env(safe-area-inset-bottom));">
    <div class="w-full max-w-md animate-fade-in">
      <!-- Logo -->
      <div class="text-center mb-8 sm:mb-10">
        <BrandLogo size="lg" class="mb-6" />
        <h1 class="font-display font-bold text-2xl text-gray-950 mb-2">Connexion</h1>
        <p class="text-gray-500">Accédez à votre tableau de bord</p>
      </div>

      {#if error}
        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-slide-down" role="alert">
          {error}
        </div>
      {/if}

      <form on:submit={handleLogin} class="space-y-6">
        <div class="card p-5 sm:p-6 space-y-5 sm:space-y-6">
          <div>
            <label class="label" for="login-email">Email</label>
            <input
              id="login-email"
              bind:value={email}
              type="email"
              placeholder="votre@email.com"
              class="input"
              autocomplete="email"
              required
            />
          </div>

          <div>
            <label class="label" for="login-password">Mot de passe</label>
            <input
              id="login-password"
              bind:value={password}
              type="password"
              placeholder="••••••••"
              class="input"
              autocomplete="current-password"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          class="btn-primary w-full py-3"
          disabled={isLoading}
        >
          {isLoading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>

      <p class="text-center text-gray-400 text-sm mt-6">
        <a href="/" class="hover:text-gray-600 transition-colors">← Retour à l'accueil</a>
      </p>
    </div>
  </main>
</div>