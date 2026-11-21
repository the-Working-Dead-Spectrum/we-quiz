<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';
  import { APP_NAME, pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  let name = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let isLoading = false;
  let error: string | null = null;

  async function handleRegister(event: Event) {
    event.preventDefault();

    if (!name || !email || !password || isLoading) return;

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

  // Enter submits the form natively: no extra keydown handler (it caused a double submit).
</script>

<svelte:head>
  <title>{pageTitle('Inscription')}</title>
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-primary-50/60 to-white">
  <main class="min-h-dvh flex items-center justify-center px-4 py-10" style="padding-top: max(2.5rem, env(safe-area-inset-top)); padding-bottom: max(2.5rem, env(safe-area-inset-bottom));">
    <div class="w-full max-w-md animate-fade-in">
      <!-- Logo -->
      <div class="text-center mb-8 sm:mb-10">
        <BrandLogo size="lg" class="mb-6" />
        <h1 class="font-display font-bold text-2xl text-gray-950 mb-2">Créer un compte</h1>
        <p class="text-gray-500">Rejoignez {APP_NAME} et créez vos premiers quiz</p>
      </div>

      {#if error}
        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm animate-slide-down" role="alert">
          {error}
        </div>
      {/if}

      <form on:submit={handleRegister} class="space-y-6">
        <div class="card p-5 sm:p-6 space-y-5 sm:space-y-6">
          <div>
            <label class="label" for="register-name">Nom complet</label>
            <input
              id="register-name"
              bind:value={name}
              type="text"
              placeholder="Votre nom"
              class="input"
              autocomplete="name"
              required
            />
          </div>

          <div>
            <label class="label" for="register-email">Email</label>
            <input
              id="register-email"
              bind:value={email}
              type="email"
              placeholder="votre@email.com"
              class="input"
              autocomplete="email"
              required
            />
          </div>

          <div>
            <label class="label" for="register-password">Mot de passe</label>
            <input
              id="register-password"
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
            <label class="label" for="register-confirm">Confirmer le mot de passe</label>
            <input
              id="register-confirm"
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
          class="btn-primary w-full py-3"
          disabled={isLoading}
        >
          {isLoading ? 'Inscription…' : "S'inscrire"}
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