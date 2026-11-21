<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';

  let name = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let isLoading = false;
  let error: string | null = null;

  async function handleRegister(event: Event) {
    event.preventDefault();

    if (!name || !email || !password) return;

    if (password !== confirmPassword) {
      error = 'Les mots de passe ne correspondent pas';
      return;
    }

    if (password.length < 8) {
      error = 'Le mot de passe doit contenir au moins 8 caractères';
      return;
    }

    isLoading = true;
    error = null;

    const result = await authStore.register(email, password, name);

    if (result.success) {
      goto('/admin');
    } else {
      error = result.error || "Erreur lors de l'inscription";
    }

    isLoading = false;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleRegister(event as unknown as Event);
    }
  }
</script>

<svelte:head>
  <title>Inscription - fastquizz</title>
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
        <h1 class="font-display font-bold text-2xl text-gray-900 mb-2">Créer un compte</h1>
        <p class="text-gray-500">Rejoignez fastquizz et créez vos premiers quiz</p>
      </div>

      {#if error}
        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-slide-down">
          {error}
        </div>
      {/if}

      <form on:submit={handleRegister} class="space-y-6">
        <div class="card p-6 space-y-6">
          <div>
            <label class="label">Nom complet</label>
            <input
              bind:value={name}
              type="text"
              placeholder="Votre nom"
              class="input"
              autocomplete="name"
              required
            />
          </div>

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
              autocomplete="new-password"
              required
              minlength="8"
            />
            <p class="text-sm text-gray-500 mt-1">Au moins 8 caractères</p>
          </div>

          <div>
            <label class="label">Confirmer le mot de passe</label>
            <input
              bind:value={confirmPassword}
              type="password"
              placeholder="••••••••"
              class="input"
              autocomplete="new-password"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          class="btn-primary w-full py-3 {isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
          disabled={isLoading}
        >
          {isLoading ? 'Inscription...' : "S'inscrire"}
        </button>
      </form>

      <p class="text-center text-gray-500 text-sm mt-6">
        Déjà un compte ? <a href="/auth/login" class="text-primary-500 hover:underline font-medium">Se connecter</a>
      </p>

      <p class="text-center text-gray-400 text-sm mt-4">
        <a href="/" class="hover:text-gray-600 transition-colors">← Retour à l'accueil</a>
      </p>
    </div>
  </main>
</div>