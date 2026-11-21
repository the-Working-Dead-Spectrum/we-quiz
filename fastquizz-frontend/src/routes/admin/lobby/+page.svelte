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

  // ADR 0001 §8: lobby duration.
  const LOBBY_DURATION_MS = 59000;

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

  function copyCode() {
    if ($hostPin) navigator.clipboard.writeText($hostPin);
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
  <title>Lobby - fastquizz</title>
</svelte:head>

<svelte:window on:keydown={handleKeyDown} />

<div class="min-h-screen bg-gray-900 text-white">
  <!-- Connection Status -->
  <div class="fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium { $hostIsConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400' }">
    <span class="w-2 h-2 rounded-full { $hostIsConnected ? 'bg-green-500' : 'bg-red-500' }" />
    { $hostIsConnected ? 'Connecté' : $hostGameStore.isReconnecting ? 'Reconnexion…' : 'Déconnecté' }
  </div>
  <div class="fixed top-4 left-4 z-50">
    <button on:click={handleLogout} class="btn-ghost text-sm px-3 py-1.5 bg-gray-900/80 backdrop-blur text-white border border-gray-700">
      Déconnexion
    </button>
  </div>

  {#if $hostError}
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-lg animate-slide-down">
      {$hostError}
    </div>
  {/if}

  <!-- Main Lobby -->
  <main class="min-h-screen flex flex-col items-center justify-center px-4 py-12">
    <!-- Logo -->
    <div class="mb-12 animate-fade-in">
      <div class="w-24 h-24 mx-auto rounded-2xl bg-primary-500 flex items-center justify-center mb-6">
        <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <h1 class="font-display font-bold text-4xl sm:text-5xl text-center mb-2">{$hostQuizTitle || 'Quiz en cours'}</h1>
      <p class="text-gray-400 text-center">Partagez le code salon aux joueurs</p>
    </div>

    <!-- Lobby Timer Countdown -->
    {#if $hostStatus === 'LOBBY' && $hostLobbyTimerRemaining > 0}
      <div class="mb-8 animate-fade-in">
        <div class="flex items-center justify-center gap-3">
          <div class="w-12 h-12 rounded-full border-4 border-primary-500/30 flex items-center justify-center">
            <svg class="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="text-left">
            <p class="text-sm text-gray-400">Démarrage automatique dans</p>
            <p class="font-display font-bold text-3xl text-white font-mono tabular-nums">{formatLobbyTime($hostLobbyTimerRemaining)}</p>
          </div>
        </div>
        <div class="w-full max-w-xs mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
          <div class="bg-primary-500 h-full transition-all duration-1000 ease-linear" 
               style="width: {Math.min(100, $hostLobbyTimerRemaining / LOBBY_DURATION_MS * 100)}%"></div>
        </div>
      </div>
    {/if}

    <!-- Giant Room Code Display -->
    <div class="mb-12 animate-scale-in">
      <div class="relative inline-block">
        <div class="bg-gray-800 border-4 border-gray-700 rounded-3xl p-8 sm:p-12 shadow-2xl">
          <div class="font-display font-bold tracking-widest text-6xl sm:text-8xl lg:text-9xl text-white font-mono select-all"
               style="letter-spacing: 0.5em;">
            {$hostPin || '------'}
          </div>
        </div>
        <!-- Copy button -->
        <button
          on:click={copyCode}
          class="absolute -top-3 -right-3 sm:-top-4 sm:-right-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full p-2 hover:bg-white/20 transition-colors"
          aria-label="Copier le code salon"
        >
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
        </button>
      </div>
      <p class="text-gray-500 mt-4 text-center">Code de la partie</p>
    </div>

    <!-- Players List -->
    <div class="w-full max-w-md animate-slide-up">
      <div class="card bg-gray-800 border-gray-700 overflow-hidden">
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="font-semibold text-lg flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Joueurs ({$hostPlayerCount})
          </h2>
          <span class="text-sm text-gray-400">{$hostPlayerCount}/500</span>
        </div>

        <div class="max-h-[400px] overflow-y-auto">
          {#if $hostPlayers.length === 0}
            <div class="p-8 text-center text-gray-500">
              <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <p>Aucun joueur pour le moment</p>
              <p class="text-sm mt-1">Les joueurs rejoignent via l'app</p>
            </div>
          {:else}
            <ul class="divide-y divide-gray-700">
              {#each $hostPlayers as player (player.id)}
                <li class="p-4 flex items-center gap-4 hover:bg-gray-700/50 transition-colors">
                  <div class="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium truncate">{player.nickname}</p>
                    <p class="text-sm text-gray-400">{player.connected ? 'Connecté' : 'Déconnecté'}</p>
                  </div>
                  <span class="text-sm text-gray-500">{player.score} pts</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </div>

    <!-- Start Button -->
    <div class="w-full max-w-md mt-8 animate-fade-in">
      <button
        on:click={handleStartGame}
        class="btn-primary w-full py-4 text-lg { $hostPlayerCount === 0 ? 'opacity-50 cursor-not-allowed' : '' }"
        disabled={$hostPlayerCount === 0 || $hostStatus !== 'LOBBY' || !$hostIsConnected}
      >
        {$hostPlayerCount === 0 ? 'En attente de joueurs...' : 'Lancer le quiz'}
        <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {#if $hostPlayerCount === 0}
        <p class="text-center text-gray-500 text-sm mt-2">Au moins 1 joueur requis pour commencer</p>
      {/if}
    </div>

    <!-- Instructions -->
    <div class="mt-12 w-full max-w-md text-center text-gray-500 text-sm animate-fade-in">
      <p>Les joueurs vont sur <strong class="text-white">fastquizz.com</strong> et entrent le code salon</p>
    </div>
  </main>

  <!-- Keyboard hint -->
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/80 backdrop-blur text-gray-400 text-xs px-3 py-2 rounded-lg">
    Appuyez sur <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">Espace</kbd> ou <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">Entrée</kbd> pour lancer
  </div>
</div>