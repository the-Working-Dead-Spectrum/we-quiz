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

  function getShapeSvgSafe(index: number): string {
    return getShapeSvg(index);
  }

  const STATUS_LABELS: Record<string, string> = {
    LOBBY: 'Lobby',
    QUESTION_ACTIVE: 'Question en cours',
    QUESTION_RESULT: 'Résultats',
    PODIUM: 'Podium',
  };
</script>

<svelte:head>
  <title>Live - fastquizz</title>
</svelte:head>

<svelte:window on:keydown={handleKeyDown} />

<div class="min-h-screen bg-gray-900 text-white">
  <!-- Top Bar -->
  <header class="fixed top-0 left-0 right-0 z-40 bg-gray-900/80 backdrop-blur border-b border-gray-800">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <div class="flex items-center gap-4">
          <div class="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h1 class="font-display font-semibold text-lg">{$hostQuizTitle}</h1>
            <p class="text-xs text-gray-400">PIN: {$hostPin ?? ''}</p>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium { $hostIsConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400' }">
            <span class="w-2 h-2 rounded-full { $hostIsConnected ? 'bg-green-500' : 'bg-red-500' }" />
            {$hostIsConnected ? 'Live' : $hostGameStore.isReconnecting ? 'Reconnexion…' : 'Déconnecté'}
          </div>
          <span class="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 border border-gray-700">
            {$hostPlayerCount} joueurs
          </span>
          <button on:click={handleLogout} class="btn-ghost text-sm px-3 py-1.5">
            Déconnexion
          </button>
        </div>
      </div>
    </div>
  </header>

  {#if $hostError}
    <div class="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-lg animate-slide-down">
      {$hostError}
    </div>
  {/if}

  <!-- Main Content -->
  <main class="pt-20 pb-12 px-4 sm:px-6 lg:px-8">
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
        <div class="card bg-gray-800 border-gray-700 text-center py-16 animate-fade-in">
          <svg class="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 class="text-2xl font-semibold mb-2">Prêt à commencer</h2>
          <p class="text-gray-400 mb-6">{$hostPlayerCount} joueur{$hostPlayerCount > 1 ? 's' : ''} connecté{$hostPlayerCount > 1 ? 's' : ''}</p>
          <button
            on:click={handleStartGame}
            class="btn-primary px-8 py-3"
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
            <div class="card bg-gray-800 border-gray-700 mb-6">
              <div class="p-6">
                <div class="flex items-start justify-between mb-4">
                  <div>
                    <span class="px-3 py-1 rounded-full text-xs font-medium bg-primary-500/20 text-primary-400 mb-2 block">
                      Question {$hostCurrentQuestion.questionIndex + 1} / {$hostCurrentQuestion.questionCount}
                    </span>
                    <h2 class="text-2xl sm:text-3xl font-semibold leading-tight">{$hostCurrentQuestion.questionText}</h2>
                  </div>
                  <div class="text-right">
                    <p class="text-3xl font-display font-bold text-primary-400">{formatTime($hostTimeRemaining)}</p>
                    <p class="text-gray-500 text-sm">{$hostAnswerCount.answered} / {$hostAnswerCount.total} réponses</p>
                  </div>
                </div>

                {#if $hostCurrentQuestion.imageUrl}
                  <img src={$hostCurrentQuestion.imageUrl} alt="Question" class="rounded-xl max-h-64 mx-auto mb-4" />
                {/if}

                <!-- Options Grid -->
                <div class="grid grid-cols-2 gap-4">
                  {#each $hostCurrentQuestion.options as option}
                    <div class="p-4 rounded-xl border-2 {getOptionColorClass(option.colorIndex)} bg-gray-800/50 flex items-center gap-3">
                      <div class="w-10 h-10 rounded-lg {getOptionColorClass(option.colorIndex)} flex items-center justify-center flex-shrink-0">
                        {@html getShapeSvgSafe(option.colorIndex)}
                      </div>
                      <span class="font-medium text-lg">{option.text}</span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>

            <!-- Live Answer Count -->
            <div class="card bg-gray-800 border-gray-700 p-4 animate-pulse-slow">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
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
            <div class="card bg-gray-800 border-gray-700 mb-6 overflow-hidden">
              <div class="p-6">
                <div class="flex items-center gap-4 mb-4">
                  <div class="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
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
                      <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-lg {getOptionColorClass(option.colorIndex)} flex items-center justify-center flex-shrink-0">
                          {@html getShapeSvgSafe(option.colorIndex)}
                        </div>
                        <div class="flex-1">
                          <div class="flex items-center justify-between text-sm mb-1">
                            <span class="font-medium">{option.text}</span>
                            <span class="text-gray-400">{votes} votes</span>
                          </div>
                          <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
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
            <div class="card bg-gray-800 border-gray-700">
              <div class="p-4 border-b border-gray-700 flex items-center justify-between">
                <h3 class="font-semibold">Classement provisoire</h3>
                <span class="text-sm text-gray-400">Top {$hostQuestionResults.leaderboard.length}</span>
              </div>
              <div class="divide-y divide-gray-700">
                {#each $hostQuestionResults.leaderboard as entry, index (entry.playerId)}
                  <div class="p-4 flex items-center gap-4 hover:bg-gray-700/50 transition-colors">
                    <span class="w-8 text-center text-lg font-display font-bold {index < 3 ? 'text-yellow-400' : 'text-gray-400'}">
                      {entry.rank}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate">{entry.nickname}</p>
                      <p class="text-sm text-gray-400">{entry.score} pts</p>
                    </div>
                    <span class="text-gray-500">{entry.score} pts</span>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Next Button -->
            <div class="mt-6 text-center animate-fade-in">
              <button
                on:click={handleNextStep}
                class="btn-primary px-8 py-3 text-lg"
                disabled={!$hostIsConnected}
              >
                {isLastQuestion ? 'Voir le podium' : 'Question suivante'}
                <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
              <p class="text-gray-500 text-sm mt-2">Ou appuyez sur Espace/Entrée</p>
            </div>
          </div>
        {/if}

      {:else if $hostStatus === 'PODIUM'}
        <!-- Final Podium -->
        {#if $hostPodium}
          <div class="animate-fade-in">
            <!-- Podium Top 3 -->
            <div class="mb-8">
              <div class="flex items-end justify-center gap-4 relative">
                <!-- 2nd place -->
                <div class="flex flex-col items-center">
                  <div class="w-24 h-24 rounded-t-2xl bg-gray-700 border-4 border-gray-600 flex items-center justify-center mb-2 relative">
                    <span class="text-3xl font-display font-bold text-gray-400">2</span>
                    <div class="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-700 flex items-center justify-center">
                      <svg class="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.493 3.268c-.693-.08-1.384.195-1.754.746l-2.842 4.27-3.816-.823c-.832-.18-1.686.388-1.866 1.218l-.766 3.208 2.725 2.66c.24.234.376.584.376.945l-.001 1.485c0 .743-.904 1.21-1.505.795l-2.67-2.224-.877 3.248c-.083.309-.037.629.211.886.148.153.335.276.533.362.273.122.554.186.84.186h11.002c.286 0 .567-.064.84-.186.198-.086.385-.209.533-.362.248-.257.294-.577.211-.886l-.877-3.248-2.67 2.224c-.602.414-1.505-.053-1.505-.794l.001-1.485c0-.36.136-.71.377-.944l2.725-2.66-.766-3.208c-.18-.831-.317-1.72.414-2.37l3.817-.823 2.842 4.27c.37.55 1.06.825 1.753.745l2.233-.38c.693-.119 1.195-.768.959-1.472l-1.13-3.372c-.114-.34-.46-.591-.807-.591H13.493z" />
                      </svg>
                    </div>
                  </div>
                  <p class="text-center mt-2 font-medium">{$hostPodium.podium[1]?.nickname || '—'}</p>
                  <p class="text-center text-gray-400 text-sm">{$hostPodium.podium[1]?.score || 0} pts</p>
                </div>

                <!-- 1st place -->
                <div class="flex flex-col items-center">
                  <div class="w-32 h-32 rounded-t-2xl bg-yellow-500 border-4 border-yellow-400 flex items-center justify-center mb-2 relative">
                    <span class="text-4xl font-display font-bold text-gray-900">1</span>
                    <div class="absolute -top-4 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-yellow-400 border-2 border-yellow-300 flex items-center justify-center animate-bounce-slow">
                      <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.493 3.268c-.693-.08-1.384.195-1.754.746l-2.842 4.27-3.816-.823c-.832-.18-1.686.388-1.866 1.218l-.766 3.208 2.725 2.66c.24.234.376.584.376.945l-.001 1.485c0 .743-.904 1.21-1.505.795l-2.67-2.224-.877 3.248c-.083.309-.037.629.211.886.148.153.335.276.533.362.273.122.554.186.84.186h11.002c.286 0 .567-.064.84-.186.198-.086.385-.209.533-.362.248-.257.294-.577.211-.886l-.877-3.248-2.67 2.224c-.602.414-1.505-.053-1.505-.794l.001-1.485c0-.36.136-.71.377-.944l2.725-2.66-.766-3.208c-.18-.831-.317-1.72.414-2.37l3.817-.823 2.842 4.27c.37.55 1.06.825 1.753.745l2.233-.38c.693-.119 1.195-.768.959-1.472l-1.13-3.372c-.114-.34-.46-.591-.807-.591H13.493z" />
                      </svg>
                    </div>
                  </div>
                  <p class="text-center mt-2 font-semibold text-lg">{$hostPodium.podium[0]?.nickname || '—'}</p>
                  <p class="text-center text-yellow-400 text-sm font-medium">{$hostPodium.podium[0]?.score || 0} pts</p>
                </div>

                <!-- 3rd place -->
                <div class="flex flex-col items-center">
                  <div class="w-24 h-24 rounded-t-2xl bg-gray-700 border-4 border-gray-600 flex items-center justify-center mb-2 relative">
                    <span class="text-3xl font-display font-bold text-gray-400">3</span>
                    <div class="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-700 flex items-center justify-center">
                      <svg class="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13.493 3.268c-.693-.08-1.384.195-1.754.746l-2.842 4.27-3.816-.823c-.832-.18-1.686.388-1.866 1.218l-.766 3.208 2.725 2.66c.24.234.376.584.376.945l-.001 1.485c0 .743-.904 1.21-1.505.795l-2.67-2.224-.877 3.248c-.083.309-.037.629.211.886.148.153.335.276.533.362.273.122.554.186.84.186h11.002c.286 0 .567-.064.84-.186.198-.086.385-.209.533-.362.248-.257.294-.577.211-.886l-.877-3.248-2.67 2.224c-.602.414-1.505-.053-1.505-.794l.001-1.485c0-.36.136-.71.377-.944l2.725-2.66-.766-3.208c-.18-.831-.317-1.72.414-2.37l3.817-.823 2.842 4.27c.37.55 1.06.825 1.753.745l2.233-.38c.693-.119 1.195-.768.959-1.472l-1.13-3.372c-.114-.34-.46-.591-.807-.591H13.493z" />
                      </svg>
                    </div>
                  </div>
                  <p class="text-center mt-2 font-medium">{$hostPodium.podium[2]?.nickname || '—'}</p>
                  <p class="text-center text-gray-400 text-sm">{$hostPodium.podium[2]?.score || 0} pts</p>
                </div>
              </div>
            </div>

            <!-- Full Leaderboard -->
            <div class="card bg-gray-800 border-gray-700 mb-6">
              <div class="p-4 border-b border-gray-700">
                <h3 class="font-semibold">Classement final</h3>
              </div>
              <div class="divide-y divide-gray-700 max-h-[400px] overflow-y-auto">
                {#each $hostPodium.finalLeaderboard as entry, index}
                  <div class="p-4 flex items-center gap-4 hover:bg-gray-700/50 transition-colors">
                    <span class="w-10 text-center text-lg font-display font-bold {index < 3 ? 'text-yellow-400' : 'text-gray-400'}">
                      {entry.rank}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate">{entry.nickname}</p>
                      <p class="text-sm text-gray-400">{entry.correctAnswersCount} bonnes réponses</p>
                    </div>
                    <span class="font-display font-bold text-xl {index < 3 ? 'text-yellow-400' : 'text-white'}">
                      {entry.score} pts
                    </span>
                  </div>
                {/each}
              </div>
            </div>

            <!-- End Game -->
            <div class="text-center animate-fade-in">
              <button
                on:click={handleEndGame}
                class="btn-secondary px-8 py-3 text-lg"
              >
                Terminer et revenir au tableau de bord
                <svg class="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </main>

  <!-- Keyboard hint -->
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/80 backdrop-blur text-gray-400 text-xs px-3 py-2 rounded-lg">
    {#if $hostStatus === 'QUESTION_RESULT'}
      Appuyez sur <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">Espace</kbd> ou <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">Entrée</kbd> pour continuer
    {:else if $hostStatus === 'PODIUM'}
      Partie terminée
    {/if}
  </div>
</div>