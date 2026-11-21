<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';

  let email = '';
  let password = '';
  let isLoading = false;
  let error: string | null = null;

  async function handleLogin(event: Event) {
    event.preventDefault();

    if (!email || !password) return;

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

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleLogin(event as unknown as Event);
    }
  }
</script>

<svelte:head>
  <title>Connexion - fastquizz</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-gray-50 to-white" on:keydown={handleKeyDown}>
  <main class="min-h-screen flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-md animate-fade-in">
      <!-- Logo -->
      <div class="text-center mb-10">
        <a href="/" class="inline-flex items-center gap-2 mb-6">
          <div class="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span class="font-display font-bold text-xl text-gray-900">fastquizz</span>
        </a>
        <h1 class="font-display font-bold text-2xl text-gray-900 mb-2">Connexion</h1>
        <p class="text-gray-500">Accédez à votre tableau de bord</p>
      </div>

      {#if error}
        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-slide-down">
          {error}
        </div>
      {/if}

      <form on:submit={handleLogin} class="space-y-6">
        <div class="card p-6 space-y-6">
          <div>
            <label class="label">Email</label>
            <input
              bind:value={email}
              type="email"
              placeholder="votre@email.com"
              class="input"
              autocomplete="email"
              required
            />
          </div>

          <div>
            <label class="label">Mot de passe</label>
            <input
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
          class="btn-primary w-full py-3 {isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
          disabled={isLoading}
        >
          {isLoading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>

      <p class="text-center text-gray-500 text-sm mt-6">
        Pas encore de compte ? <a href="/auth/register" class="text-primary-500 hover:underline font-medium">S'inscrire</a>
      </p>

      <p class="text-center text-gray-400 text-sm mt-4">
        <a href="/" class="hover:text-gray-600 transition-colors">← Retour à l'accueil</a>
      </p>
    </div>
  </main>
</div>