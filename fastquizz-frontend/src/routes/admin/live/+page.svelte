<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    hostGameStore,
    hostPin,
    hostQuizTitle,
    hostStatus,
    hostPlayerCount,
    hostCurrentQuestion,
    hostQuestionResults,
    hostPodium,
    hostAnswerCount,
    hostTimeRemaining,
    hostIsConnected,
    hostError,
    flashMessage,
  } from '$lib/stores';
  import { authStore } from '$lib/stores/auth';
  import { getColorConfig, getShapeSvg } from '$lib/types';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  let mounted = false;
  let fatalHandled = false;

  function handleLogout() {
    authStore.logout();
    goto('/');
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const pin = (params.get('pin') || '').trim().toUpperCase();

    if (!pin) {
      goto('/admin', { replaceState: true });
      return;
    }

    // Coming from the lobby: reuse the open socket. Refresh: re-join with the stored hostToken.
    // This page never creates a game.
    if (!hostGameStore.isActiveFor(pin) && !hostGameStore.joinGame(pin)) {
      flashMessage.set("Aucune session d'animation pour cette partie sur ce navigateur.");
      goto('/admin', { replaceState: true });
      return;
    }

    mounted = true;
    return () => {
      mounted = false;
      hostGameStore.disconnect();
    };
  });

  // Fatal host error (ADR 0001 §9): token already cleared by the store, back to /admin.
  $: hostFatal = $hostGameStore.fatal;
  $: if (mounted && !fatalHandled && hostFatal) {
    fatalHandled = true;
    flashMessage.set(hostFatal.message);
    goto('/admin', { replaceState: true });
  }

  // Current question for display: `question:started` is not part of the QUESTION_RESULT
  // snapshot (ADR 0001 §7), so after a refresh on the result screen it may be missing.
  $: resultQuestion =
    $hostCurrentQuestion && $hostQuestionResults && $hostCurrentQuestion.questionIndex === $hostQuestionResults.questionIndex
      ? $hostCurrentQuestion
      : null;
  $: questionNumber = $hostGameStore.currentQuestionIndex >= 0 ? $hostGameStore.currentQuestionIndex + 1 : 0;
  $: timeLimitMs = $hostCurrentQuestion ? $hostCurrentQuestion.timeLimit * 1000 : 0;
  $: totalVotes = $hostQuestionResults
    ? Object.values($hostQuestionResults.answerDistribution).reduce((sum, n) => sum + n, 0)
    : 0;
  $: isLastQuestion = $hostGameStore.questionCount > 0 && questionNumber >= $hostGameStore.questionCount;

  function handleStartGame() {
    hostGameStore.startGame();
  }

  function handleNextStep() {
    hostGameStore.nextStep();
  }

  function handleEndGame() {
    hostGameStore.reset();
    goto('/admin');
  }

  // Window-level shortcut (no keydown handler on a non-interactive element). Keys pressed on a
  // focused control are left to the browser, so a focused button is not activated twice.
  function handleKeyDown(event: KeyboardEvent) {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) return;
    if ($hostStatus === 'QUESTION_RESULT') {
      event.preventDefault();
      handleNextStep();
    }
  }

  function formatTime(ms: number): string {
    return `${Math.ceil(ms / 1000)}s`;
  }

  function getOptionColorClass(index: number): string {
    return getColorConfig(index).bg;
  }

  function getOptionTextClass(index: number): string {
    return getColorConfig(index).text;
  }

  function getOptionBorderClass(index: number): string {
    return getColorConfig(index).border;
  }

  function getShapeSvgSafe(index: number, sizeClass = 'w-5 h-5'): string {
    return getShapeSvg(index, sizeClass);
  }

  const STATUS_LABELS: Record<string, string> = {
    LOBBY: 'Lobby',
    QUESTION_ACTIVE: 'Question en cours',
    QUESTION_RESULT: 'Résultats',
    PODIUM: 'Podium',
  };
</script>

<svelte:head>
  <title>{pageTitle('Live')}</title>
  <meta name="theme-color" content="#0b141f" />
</svelte:head>

<svelte:window on:keydown={handleKeyDown} />

<div class="min-h-dvh bg-gray-950 text-white">
  <!-- Top Bar -->
  <header class="fixed top-0 inset-x-0 z-40 bg-gray-950/85 backdrop-blur border-b border-gray-800 pt-safe">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between gap-2 h-14 sm:h-16">
        <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <BrandLogo size="sm" tone="dark" markOnly href={null} />
          <div class="min-w-0">
            <h1 class="font-display font-semibold text-sm sm:text-lg truncate">{$hostQuizTitle}</h1>
            <p class="text-xs text-gray-400">PIN <span class="font-mono tracking-wider text-gray-200">{$hostPin ?? ''}</span></p>
          </div>
        </div>

        <div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium { $hostIsConnected ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400' }">
            <span class="w-2 h-2 rounded-full { $hostIsConnected ? 'bg-green-500' : 'bg-red-500' }" />
            <span class="hidden min-[400px]:inline">{$hostIsConnected ? 'Live' : $hostGameStore.isReconnecting ? 'Reconnexion…' : 'Déconnecté'}</span>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 tabular-nums" aria-label="{$hostPlayerCount} joueurs">
            <span aria-hidden="true">👥</span> {$hostPlayerCount}
          </span>
          <button on:click={handleLogout} class="btn-ghost text-gray-300 hover:bg-gray-800 text-sm px-2 sm:px-3" aria-label="Déconnexion">
            <svg class="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span class="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </div>
    </div>
  </header>

  {#if $hostError}
    <div class="fixed left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 bg-red-500/95 text-white px-4 sm:px-6 py-3 rounded-xl shadow-lg animate-slide-down text-center" style="top: calc(4.5rem + env(safe-area-inset-top));" role="alert">
      {$hostError}
    </div>
  {/if}

  <!-- Main Content -->
  <main class="px-3 sm:px-6 lg:px-8" style="padding-top: calc(4.75rem + env(safe-area-inset-top)); padding-bottom: calc(4rem + env(safe-area-inset-bottom));">
    <div class="max-w-5xl mx-auto">
      <!-- Status Bar -->
      <div class="mb-6 animate-fade-in">
        <div class="flex items-center justify-between mb-3">
          <span class="font-semibold text-lg">{STATUS_LABELS[$hostStatus] ?? $hostStatus}</span>
          {#if questionNumber > 0}
            <span class="text-gray-400">Question {questionNumber} / {$hostGameStore.questionCount}</span>
          {/if}
        </div>
        {#if $hostStatus === 'QUESTION_ACTIVE'}
          <div class="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-primary-500 transition-all duration-300 ease-out"
              style="width: {timeLimitMs > 0 ? Math.min(100, ($hostTimeRemaining / timeLimitMs) * 100) : 0}%"
            />
          </div>
          <p class="text-sm text-gray-400 mt-1">Temps restant: {formatTime($hostTimeRemaining)}</p>
        {/if}
      </div>

      <!-- Content based on status -->
      {#if $hostStatus === 'LOBBY'}
        <!-- Waiting to start -->
        <div class="card bg-gray-900 border-gray-800 text-center py-12 sm:py-16 px-4 animate-fade-in">
          <svg class="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 class="text-2xl font-semibold mb-2">Prêt à commencer</h2>
          <p class="text-gray-400 mb-6">{$hostPlayerCount} joueur{$hostPlayerCount > 1 ? 's' : ''} connecté{$hostPlayerCount > 1 ? 's' : ''}</p>
          <button
            on:click={handleStartGame}
            class="btn-primary w-full sm:w-auto px-8 py-3"
            disabled={$hostPlayerCount === 0 || !$hostIsConnected}
          >
            Lancer la première question
            <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
          </button>
        </div>

      {:else if $hostStatus === 'QUESTION_ACTIVE'}
        <!-- Question Active - Show question and timer -->
        {#if $hostCurrentQuestion}
          <div class="animate-fade-in">
            <!-- Question Card -->
            <div class="card bg-gray-900 border-gray-800 mb-4 sm:mb-6">
              <div class="p-4 sm:p-6">
                <div class="flex flex-col-reverse sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                  <div class="min-w-0">
                    <span class="inline-block px-3 py-1 rounded-full text-xs font-medium bg-primary-500/15 text-primary-300 mb-2">
                      Question {$hostCurrentQuestion.questionIndex + 1} / {$hostCurrentQuestion.questionCount}
                    </span>
                    <h2 class="font-display text-xl sm:text-3xl font-semibold leading-snug text-balance">{$hostCurrentQuestion.questionText}</h2>
                  </div>
                  <div class="flex sm:flex-col items-baseline sm:items-end justify-between gap-2 shrink-0">
                    <p class="text-3xl sm:text-4xl font-display font-bold text-primary-300 tabular-nums">{formatTime($hostTimeRemaining)}</p>
                    <p class="text-gray-400 text-sm tabular-nums">{$hostAnswerCount.answered} / {$hostAnswerCount.total} réponses</p>
                  </div>
                </div>

                {#if $hostCurrentQuestion.imageUrl}
                  <img src={$hostCurrentQuestion.imageUrl} alt="" class="rounded-xl max-h-48 sm:max-h-64 mx-auto mb-4 object-contain" />
                {/if}

                <!-- Options Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-4">
                  {#each $hostCurrentQuestion.options as option}
                    <div class="p-3 sm:p-4 rounded-xl border-l-8 {getOptionBorderClass(option.colorIndex)} bg-gray-800/70 flex items-center gap-3">
                      <div class="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-lg {getOptionColorClass(option.colorIndex)} {getOptionTextClass(option.colorIndex)} flex items-center justify-center">
                        {@html getShapeSvgSafe(option.colorIndex)}
                      </div>
                      <span class="flex-1 min-w-0 font-medium text-base sm:text-lg leading-snug">{option.text}</span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>

            <!-- Live Answer Count -->
            <div class="card bg-gray-900 border-gray-800 p-4">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 shrink-0 rounded-xl bg-primary-500/15 flex items-center justify-center">
                    <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-sm text-gray-400">Réponses reçues</p>
                    <p class="text-2xl font-display font-bold">{$hostAnswerCount.answered} / {$hostAnswerCount.total}</p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm text-gray-400">Taux de réponse</p>
                  <p class="text-2xl font-display font-bold text-primary-400">{$hostAnswerCount.total > 0 ? Math.round(($hostAnswerCount.answered / $hostAnswerCount.total) * 100) : 0}%</p>
                </div>
              </div>
            </div>
          </div>
        {/if}

      {:else if $hostStatus === 'QUESTION_RESULT'}
        <!-- Question Results -->
        {#if $hostQuestionResults}
          <div class="animate-fade-in">
            <!-- Correct Answer Reveal -->
            <div class="card bg-gray-900 border-gray-800 mb-4 sm:mb-6 overflow-hidden">
              <div class="p-4 sm:p-6">
                <div class="flex items-center gap-4 mb-4">
                  <div class="w-12 h-12 shrink-0 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <svg class="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p class="text-sm text-gray-400">Bonne réponse</p>
                    <p class="font-semibold text-lg">
                      {#if resultQuestion}
                        {#each resultQuestion.options as option (option.id)}
                          {#if option.id === $hostQuestionResults.correctOptionId}
                            {option.text}
                          {/if}
                        {/each}
                      {:else}
                        —
                      {/if}
                    </p>
                  </div>
                </div>

                <!-- Answer Distribution -->
                <div class="space-y-3">
                  <p class="text-sm text-gray-400">Répartition des réponses ({totalVotes} vote{totalVotes > 1 ? 's' : ''})</p>
                  {#if resultQuestion}
                    {#each resultQuestion.options as option (option.id)}
                      {@const votes = $hostQuestionResults.answerDistribution[option.id] ?? 0}
                      <div class="flex items-center gap-3 sm:gap-4">
                        <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-lg {getOptionColorClass(option.colorIndex)} {getOptionTextClass(option.colorIndex)} flex items-center justify-center flex-shrink-0">
                          {@html getShapeSvgSafe(option.colorIndex)}
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-start justify-between gap-2 text-sm mb-1">
                            <span class="font-medium min-w-0">{option.text}</span>
                            <span class="shrink-0 text-gray-400 tabular-nums">{votes} vote{votes > 1 ? 's' : ''}</span>
                          </div>
                          <div class="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              class="h-full {getOptionColorClass(option.colorIndex)} transition-all duration-500"
                              style="width: {totalVotes > 0 ? (votes / totalVotes) * 100 : 0}%"
                            />
                          </div>
                        </div>
                        {#if option.id === $hostQuestionResults.correctOptionId}
                          <svg class="w-5 h-5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                          </svg>
                        {/if}
                      </div>
                    {/each}
                  {:else}
                    <p class="text-sm text-gray-500">Détail des réponses indisponible après rechargement de la page.</p>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Leaderboard -->
            <div class="card bg-gray-900 border-gray-800">
              <div class="p-4 border-b border-gray-800 flex items-center justify-between">
                <h3 class="font-semibold">Classement provisoire</h3>
                <span class="text-sm text-gray-400">Top {$hostQuestionResults.leaderboard.length}</span>
              </div>
              <ol class="divide-y divide-gray-800">
                {#each $hostQuestionResults.leaderboard as entry, index (entry.playerId)}
                  <li class="px-3 py-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                    <span class="w-8 shrink-0 text-center text-lg font-display font-bold {index < 3 ? 'text-amber-300' : 'text-gray-400'}">
                      {entry.rank}
                    </span>
                    <p class="flex-1 min-w-0 font-medium truncate">{entry.nickname}</p>
                    <span class="shrink-0 font-display font-semibold tabular-nums {index < 3 ? 'text-amber-300' : 'text-gray-200'}">{entry.score} pts</span>
                  </li>
                {/each}
              </ol>
            </div>

            <!-- Next Button (sticky on phones so it stays reachable under a long leaderboard) -->
            <div class="mt-6 text-center animate-fade-in sticky bottom-0 sm:static -mx-3 sm:mx-0 px-3 sm:px-0 py-3 sm:py-0 bg-gray-950/90 sm:bg-transparent backdrop-blur sm:backdrop-blur-none" style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));">
              <button
                on:click={handleNextStep}
                class="btn-primary w-full sm:w-auto px-8 py-3 text-lg"
                disabled={!$hostIsConnected}
              >
                {isLastQuestion ? 'Voir le podium' : 'Question suivante'}
                <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
              <p class="hidden md:block text-gray-500 text-sm mt-2">Ou appuyez sur Espace/Entrée</p>
            </div>
          </div>
        {/if}

      {:else if $hostStatus === 'PODIUM'}
        <!-- Final Podium -->
        {#if $hostPodium}
          <div class="animate-fade-in">
            <!-- Podium Top 3: 2nd · 1st · 3rd, steps scale down on phones -->
            <div class="mb-6 sm:mb-8 pt-6">
              <div class="grid grid-cols-3 items-end gap-2 sm:gap-4 max-w-xl mx-auto">
                {#each [1, 0, 2] as place}
                  {@const entry = $hostPodium.podium[place]}
                  {@const isFirst = place === 0}
                  <div class="flex flex-col items-center min-w-0">
                    <span class="text-2xl sm:text-3xl mb-1" aria-hidden="true">{place === 0 ? '🥇' : place === 1 ? '🥈' : '🥉'}</span>
                    <p class="w-full text-center font-semibold truncate {isFirst ? 'text-base sm:text-lg' : 'text-sm sm:text-base'}">{entry?.nickname || '—'}</p>
                    <p class="text-center text-xs sm:text-sm font-medium tabular-nums mb-2 {isFirst ? 'text-amber-300' : 'text-gray-400'}">{entry?.score ?? 0} pts</p>
                    <div
                      class="w-full rounded-t-2xl flex items-start justify-center pt-2 sm:pt-3 font-display font-bold
                        {isFirst ? 'h-28 sm:h-36 bg-gradient-to-b from-amber-300 to-amber-500 text-gray-950 text-4xl sm:text-5xl' : place === 1 ? 'h-20 sm:h-28 bg-gray-700 text-gray-300 text-3xl sm:text-4xl' : 'h-14 sm:h-20 bg-gray-800 text-gray-400 text-2xl sm:text-3xl'}"
                    >
                      {place + 1}
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Full Leaderboard -->
            <div class="card bg-gray-900 border-gray-800 mb-6">
              <div class="p-4 border-b border-gray-800">
                <h3 class="font-semibold">Classement final</h3>
              </div>
              <ol class="divide-y divide-gray-800 max-h-[50vh] overflow-y-auto overscroll-contain">
                {#each $hostPodium.finalLeaderboard as entry, index}
                  <li class="px-3 py-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                    <span class="w-8 shrink-0 text-center text-lg font-display font-bold {index < 3 ? 'text-amber-300' : 'text-gray-400'}">
                      {entry.rank}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate">{entry.nickname}</p>
                      <p class="text-xs sm:text-sm text-gray-400">{entry.correctAnswersCount} bonne{entry.correctAnswersCount > 1 ? 's' : ''} réponse{entry.correctAnswersCount > 1 ? 's' : ''}</p>
                    </div>
                    <span class="shrink-0 font-display font-bold text-base sm:text-xl tabular-nums {index < 3 ? 'text-amber-300' : 'text-white'}">
                      {entry.score} pts
                    </span>
                  </li>
                {/each}
              </ol>
            </div>

            <!-- End Game -->
            <div class="text-center animate-fade-in">
              <button on:click={handleEndGame} class="btn-primary w-full sm:w-auto px-8 py-3 text-base sm:text-lg">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Terminer et revenir au tableau de bord
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </main>

  <!-- Keyboard hint (desktop / projector only) -->
  {#if $hostStatus === 'QUESTION_RESULT'}
    <div class="hidden md:block fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/80 backdrop-blur text-gray-400 text-xs px-3 py-2 rounded-lg">
      Appuyez sur <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">Espace</kbd> ou <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">Entrée</kbd> pour continuer
    </div>
  {/if}
</div>
