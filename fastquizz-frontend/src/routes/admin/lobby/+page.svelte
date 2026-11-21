<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import {
    hostGameStore,
    hostPin,
    hostQuizTitle,
    hostStatus,
    hostPlayers,
    hostPlayerCount,
    hostIsConnected,
    hostError,
    hostLobbyTimerRemaining,
    flashMessage,
  } from '$lib/stores';
  import { authStore } from '$lib/stores/auth';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  // ADR 0001 §8: lobby duration.
  const LOBBY_DURATION_MS = 59000;

  // Host shown in the join instructions (the real deployed domain, not a hard-coded one).
  let joinHost = '';
  let copied = false;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  let mounted = false;
  // Set right before navigating to /admin/live so the cleanup keeps the socket open.
  let leavingToLive = false;
  let fatalHandled = false;
  // ADR 0001 §9: a creation error (QUIZ_NOT_FOUND / QUIZ_INVALID) returns to the previous page.
  let createReturnUrl = '/admin';

  function handleLogout() {
    authStore.logout();
    goto('/');
  }

  onMount(() => {
    joinHost = window.location.host;
    const params = new URLSearchParams(window.location.search);
    const pin = (params.get('pin') || '').trim().toUpperCase();
    const quizId = params.get('quizId') || '';
    const shareToken = params.get('shareToken') || undefined;

    if (pin) {
      // Refresh or "Ouvrir le lobby": re-join with the stored hostToken, never re-create.
      if (!hostGameStore.isActiveFor(pin) && !hostGameStore.joinGame(pin)) {
        flashMessage.set("Aucune session d'animation pour cette partie sur ce navigateur.");
        goto('/admin', { replaceState: true });
        return;
      }
    } else if (quizId) {
      createReturnUrl = shareToken ? `/quiz/${encodeURIComponent(shareToken)}` : '/public';
      hostGameStore.createGame(quizId, shareToken);
    } else {
      goto('/admin', { replaceState: true });
      return;
    }

    mounted = true;
    return () => {
      mounted = false;
      if (!leavingToLive) hostGameStore.disconnect();
    };
  });

  // Create flow: once the server assigned the pin, the URL only carries the pin (never the
  // hostToken), so a refresh re-joins instead of creating a second game. Only reached after a
  // server round trip, i.e. after the SvelteKit router has started (replaceState throws before).
  $: if (mounted && $hostPin && !new URLSearchParams(window.location.search).has('pin')) {
    replaceState(`/admin/lobby?pin=${encodeURIComponent($hostPin)}`, {});
  }

  // Fatal host error (ADR 0001 §9): the store already cleared the hostToken and closed the socket.
  $: hostFatal = $hostGameStore.fatal;
  $: if (mounted && !fatalHandled && hostFatal) {
    fatalHandled = true;
    flashMessage.set(hostFatal.message);
    const creationError = hostFatal.code === 'QUIZ_NOT_FOUND' || hostFatal.code === 'QUIZ_INVALID';
    goto(creationError ? createReturnUrl : '/admin', { replaceState: true });
  }

  // Leaving the lobby state (manual start, auto-start, or re-join of a running game):
  // go to the live screen and keep the same socket.
  $: if (mounted && !leavingToLive && !fatalHandled && $hostPin && $hostStatus !== 'LOBBY') {
    leavingToLive = true;
    goto(`/admin/live?pin=${encodeURIComponent($hostPin)}`);
  }

  function handleStartGame() {
    hostGameStore.startGame();
  }

  async function copyCode() {
    if (!$hostPin) return;
    try {
      await navigator.clipboard.writeText($hostPin);
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 1800);
    } catch {
      /* clipboard unavailable (insecure context): the code stays selectable */
    }
  }

  // Window-level shortcut (no keydown handler on a non-interactive element). Keys pressed on a
  // focused control are left to the browser, so a focused button is not activated twice.
  function handleKeyDown(event: KeyboardEvent) {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) return;
    event.preventDefault();
    if ($hostStatus === 'LOBBY' && $hostPlayerCount > 0) {
      handleStartGame();
    }
  }

  function formatLobbyTime(ms: number): string {
    const seconds = Math.ceil(ms / 1000);
    return `${seconds}s`;
  }
</script>

<svelte:head>
  <title>{pageTitle('Lobby')}</title>
  <meta name="theme-color" content="#0b141f" />
</svelte:head>

<svelte:window on:keydown={handleKeyDown} />

<div class="min-h-dvh bg-gray-950 text-white flex flex-col">
  <!-- Top bar: logout · logo · connection status (in flow, safe-area aware) -->
  <header class="pt-safe">
    <div class="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
      <button on:click={handleLogout} class="btn-ghost text-gray-300 hover:bg-gray-800 text-sm px-2 sm:px-3" aria-label="Déconnexion">
        <svg class="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        <span class="hidden sm:inline">Déconnexion</span>
      </button>
      <BrandLogo size="sm" tone="dark" href={null} />
      <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium { $hostIsConnected ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400' }">
        <span class="w-2 h-2 rounded-full { $hostIsConnected ? 'bg-green-500' : 'bg-red-500' }" />
        <span class="hidden min-[400px]:inline">{ $hostIsConnected ? 'Connecté' : $hostGameStore.isReconnecting ? 'Reconnexion…' : 'Déconnecté' }</span>
      </div>
    </div>
  </header>

  {#if $hostError}
    <div class="mx-3 sm:mx-auto sm:max-w-md mt-2 bg-red-500/95 text-white px-4 py-3 rounded-xl shadow-lg animate-slide-down text-center" role="alert">
      {$hostError}
    </div>
  {/if}

  <main class="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-10" style="padding-bottom: calc(2rem + env(safe-area-inset-bottom));">
    <!-- Title -->
    <div class="text-center mb-6 sm:mb-10 animate-fade-in">
      <h1 class="font-display font-bold text-2xl sm:text-4xl lg:text-5xl text-balance mb-2">{$hostQuizTitle || 'Quiz en cours'}</h1>
      <p class="text-gray-400 text-sm sm:text-base">
        Rejoignez sur <strong class="text-white break-all">{joinHost}/player/join</strong> avec le code ci-dessous
      </p>
    </div>

    <div class="grid gap-6 lg:gap-10 lg:grid-cols-2 lg:items-start">
      <!-- Code + countdown + start -->
      <section class="flex flex-col items-center" aria-label="Code de la partie">
        <div class="relative w-full max-w-md animate-scale-in">
          <div class="bg-gray-900 border-2 border-primary-500/40 rounded-3xl px-4 py-6 sm:p-10 shadow-2xl text-center">
            <p class="text-xs sm:text-sm uppercase tracking-widest text-primary-300 mb-2">Code de la partie</p>
            <p class="font-mono font-bold text-white select-all text-5xl min-[400px]:text-6xl sm:text-7xl lg:text-8xl tracking-[0.12em] sm:tracking-[0.2em] leading-none break-all">
              {$hostPin || '------'}
            </p>
          </div>
          <button
            on:click={copyCode}
            class="absolute -top-3 -right-1 sm:-top-4 sm:-right-4 btn-icon rounded-full bg-primary-500 text-white shadow-lg hover:bg-primary-600"
            aria-label={copied ? 'Code copié' : 'Copier le code salon'}
          >
            {#if copied}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="m5 13 4 4L19 7" />
              </svg>
            {:else}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            {/if}
          </button>
        </div>

        <!-- Lobby Timer Countdown -->
        {#if $hostStatus === 'LOBBY' && $hostLobbyTimerRemaining > 0}
          <div class="mt-6 w-full max-w-md animate-fade-in">
            <div class="flex items-center justify-between text-sm mb-2">
              <span class="text-gray-400">Démarrage automatique</span>
              <span class="font-display font-bold text-2xl tabular-nums">{formatLobbyTime($hostLobbyTimerRemaining)}</span>
            </div>
            <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div class="bg-primary-500 h-full transition-all duration-1000 ease-linear" style="width: {Math.min(100, ($hostLobbyTimerRemaining / LOBBY_DURATION_MS) * 100)}%"></div>
            </div>
          </div>
        {/if}

        <!-- Start Button -->
        <div class="w-full max-w-md mt-6 animate-fade-in">
          <button
            on:click={handleStartGame}
            class="btn-primary w-full py-4 text-lg"
            disabled={$hostPlayerCount === 0 || $hostStatus !== 'LOBBY' || !$hostIsConnected}
          >
            {$hostPlayerCount === 0 ? 'En attente de joueurs…' : 'Lancer le quiz'}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {#if $hostPlayerCount === 0}
            <p class="text-center text-gray-500 text-sm mt-2">Au moins 1 joueur requis pour commencer</p>
          {/if}
          <p class="hidden md:block text-center text-gray-500 text-xs mt-3">
            Raccourci : <kbd class="px-1.5 py-0.5 bg-gray-800 rounded">Espace</kbd> ou <kbd class="px-1.5 py-0.5 bg-gray-800 rounded">Entrée</kbd>
          </p>
        </div>
      </section>

      <!-- Players List -->
      <section class="w-full max-w-md mx-auto lg:max-w-none animate-slide-up" aria-label="Joueurs">
        <div class="card bg-gray-900 border-gray-800 overflow-hidden">
          <div class="p-4 border-b border-gray-800 flex items-center justify-between">
            <h2 class="font-semibold text-lg flex items-center gap-2">
              <svg class="w-5 h-5 text-primary-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              Joueurs
            </h2>
            <span class="text-sm text-gray-400 tabular-nums">{$hostPlayerCount}/500</span>
          </div>

          <div class="max-h-[45vh] lg:max-h-[60vh] overflow-y-auto overscroll-contain">
            {#if $hostPlayers.length === 0}
              <div class="p-8 text-center text-gray-500">
                <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <p>Aucun joueur pour le moment</p>
                <p class="text-sm mt-1">Partagez le code pour qu'ils rejoignent</p>
              </div>
            {:else}
              <ul class="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2 p-3">
                {#each $hostPlayers as player (player.id)}
                  <li class="flex items-center gap-2.5 rounded-xl bg-gray-800/70 px-3 py-2.5 animate-scale-in">
                    <span class="w-2 h-2 shrink-0 rounded-full {player.connected ? 'bg-green-500' : 'bg-gray-500'}" role="img" aria-label={player.connected ? 'Connecté' : 'Déconnecté'} />
                    <p class="flex-1 min-w-0 font-medium truncate">{player.nickname}</p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </section>
    </div>
  </main>
</div>
