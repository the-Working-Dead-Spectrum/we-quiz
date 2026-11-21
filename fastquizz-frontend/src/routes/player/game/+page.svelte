<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import {
    playerGameStore,
    playerPin,
    playerNickname,
    playerId,
    playerStatus,
    playerScore,
    playerRank,
    playerStreak,
    playerQuestion,
    playerFeedback,
    playerQuestionResults,
    playerAnswerStatus,
    playerPodium,
    playerTimeRemaining,
    playerLobbyTimerRemaining,
    playerLobbyPlayers,
    playerIsConnected,
    playerIsReconnecting,
    playerError,
    canAnswer,
    showQuestionResults,
    showPodium,
    playerCurrentQuestionIndex,
    playerQuestionCount,
    flashMessage,
  } from '$lib/stores';
  import { getColorConfig, getShapeSvg } from '$lib/types';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  // ADR 0001 §8: lobby duration.
  const LOBBY_DURATION_MS = 59000;

  let mounted = false;
  let fatalHandled = false;

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('code') || '').trim().toUpperCase();
    const nickname = (params.get('nickname') || '').trim();

    if (code && nickname) {
      // Explicit join from /player/join (first-time player:join).
      playerGameStore.join(code, nickname);
    } else if (!playerGameStore.resume()) {
      // No stored session (player_token + player_pin): nothing to resume.
      goto(code ? `/player/join?code=${encodeURIComponent(code)}` : '/player/join', { replaceState: true });
      return;
    }

    mounted = true;
    return () => {
      mounted = false;
      // Keep the stored session: a refresh or a return to this page resumes it.
      playerGameStore.disconnect();
    };
  });

  // Once joined, drop ?code=&nickname= from the URL so a refresh resumes (player:reconnect)
  // instead of re-joining with the same nickname. Only reached after a server round trip, i.e.
  // after the SvelteKit router has started (replaceState throws in dev before that).
  $: if (mounted && $playerGameStore.playerToken && new URLSearchParams(window.location.search).has('nickname')) {
    replaceState('/player/game', {});
  }

  // Fatal errors and join refusals (ADR 0001 §9): back to /player/join with the message.
  $: playerFatal = $playerGameStore.fatal;
  $: if (mounted && !fatalHandled && playerFatal) {
    fatalHandled = true;
    flashMessage.set(playerFatal.message);
    const target = playerFatal.prefillCode
      ? `/player/join?code=${encodeURIComponent(playerFatal.prefillCode)}`
      : '/player/join';
    goto(target, { replaceState: true });
  }

  // Result screen data, robust to the arrival order of question:ended / player:feedback.
  $: resultIndex = $playerCurrentQuestionIndex;
  $: feedback = $playerFeedback && $playerFeedback.questionIndex === resultIndex ? $playerFeedback : null;
  $: results =
    $playerQuestionResults && $playerQuestionResults.questionIndex === resultIndex ? $playerQuestionResults : null;
  $: resultQuestion = $playerQuestion && $playerQuestion.questionIndex === resultIndex ? $playerQuestion : null;
  $: correctOptionId = feedback?.correctOptionId ?? results?.correctOptionId ?? null;
  $: correctOption = resultQuestion && correctOptionId ? resultQuestion.options.find((o) => o.id === correctOptionId) ?? null : null;
  $: myFinalEntry = $playerPodium?.finalLeaderboard.find((e) => e.playerId === $playerId) ?? null;
  $: timeLimitMs = $playerQuestion ? $playerQuestion.timeLimit * 1000 : 0;

  function handleAnswer(optionId: string) {
    if ($canAnswer) {
      playerGameStore.submitAnswer(optionId);
    }
  }

  function handleLeave() {
    playerGameStore.leave();
    goto('/');
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

  // Timer turns amber then red in the last seconds.
  $: timerUrgency =
    $playerTimeRemaining <= 5000 ? 'text-red-400' : $playerTimeRemaining <= 10000 ? 'text-amber-300' : 'text-primary-300';
  $: timerBarColor =
    $playerTimeRemaining <= 5000 ? 'bg-red-500' : $playerTimeRemaining <= 10000 ? 'bg-amber-400' : 'bg-primary-500';
</script>

<svelte:head>
  <title>{pageTitle('Jeu en cours')}</title>
  <meta name="theme-color" content="#0b141f" />
</svelte:head>

<div class="min-h-dvh bg-gray-950 text-white">
  <!-- Top Bar (safe-area aware for the installed PWA) -->
  <header class="fixed top-0 inset-x-0 z-40 bg-gray-950/85 backdrop-blur border-b border-gray-800 pt-safe">
    <div class="max-w-3xl mx-auto px-3 sm:px-4">
      <div class="flex items-center justify-between gap-2 h-14">
        <div class="flex items-center gap-2.5 min-w-0">
          <BrandLogo size="sm" tone="dark" markOnly href={null} />
          <div class="min-w-0">
            <p class="font-semibold text-sm truncate">{$playerNickname}</p>
            <p class="text-xs text-gray-400">Code {$playerPin ?? ''}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
          {#if $playerStreak > 0}
            <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-400/15 text-amber-300 text-xs font-semibold" aria-label="Série de {$playerStreak}">
              <span aria-hidden="true">🔥</span>{$playerStreak}
            </div>
          {/if}

          <div class="text-right leading-tight">
            <p class="font-display font-bold text-base sm:text-lg tabular-nums">{$playerScore} pts</p>
            {#if $playerRank > 0}
              <p class="text-xs text-gray-400">#{$playerRank}</p>
            {/if}
          </div>

          <span
            class="w-2.5 h-2.5 rounded-full { $playerIsConnected ? 'bg-green-500' : 'bg-red-500' }"
            role="img"
            aria-label={$playerIsConnected ? 'Connecté' : 'Déconnecté'}
          />
        </div>
      </div>
    </div>

    {#if $playerGameStore.connectionLost}
      <div class="bg-red-600 text-white text-center px-3 py-2 text-sm animate-slide-down" role="alert">
        {$playerError ?? 'Connexion perdue.'} <button class="underline font-semibold" on:click={() => location.reload()}>Recharger la page</button>
      </div>
    {:else if $playerIsReconnecting}
      <div class="bg-amber-500 text-gray-950 text-center px-3 py-2 text-sm font-medium animate-slide-down" role="status">
        <svg class="w-4 h-4 inline animate-spin mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Reconnexion en cours…
      </div>
    {:else if $playerError}
      <div class="bg-red-500 text-white text-center px-3 py-2 text-sm animate-slide-down" role="alert">
        {$playerError}
      </div>
    {/if}
  </header>

  <main class="px-3 sm:px-4" style="padding-top: calc(4.5rem + env(safe-area-inset-top)); padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));">
    <div class="max-w-3xl mx-auto">
      <!-- Waiting / Lobby -->
      {#if $playerStatus === 'LOBBY'}
        <div class="animate-fade-in text-center py-6 sm:py-12 max-w-xl mx-auto">
          <div class="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-3xl bg-primary-500/15 flex items-center justify-center mb-6 sm:mb-8">
            <svg class="w-10 h-10 sm:w-12 sm:h-12 text-primary-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 class="font-display text-2xl font-semibold mb-2">Vous êtes dans la partie !</h2>
          <p class="text-gray-400">En attente du lancement par l'hôte…</p>

          <!-- Lobby countdown (lobby:timer.remaining, ms) -->
          {#if $playerLobbyTimerRemaining > 0}
            <div class="mt-8 max-w-xs mx-auto">
              <p class="text-sm text-gray-400">Démarrage automatique dans</p>
              <p class="font-display font-bold text-4xl tabular-nums">{formatTime($playerLobbyTimerRemaining)}</p>
              <div class="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-primary-500 h-full transition-all duration-1000 ease-linear"
                  style="width: {Math.min(100, ($playerLobbyTimerRemaining / LOBBY_DURATION_MS) * 100)}%"
                />
              </div>
            </div>
          {/if}

          <!-- Everyone in the game: earlier arrivals from the join snapshot, later ones live -->
          <section class="mt-8 text-left card bg-gray-900 border-gray-800" aria-labelledby="lobby-players-title">
            <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 id="lobby-players-title" class="font-semibold flex items-center gap-2">
                <svg class="w-5 h-5 text-primary-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Joueurs dans la partie
              </h3>
              <span class="text-sm font-semibold tabular-nums text-primary-300" aria-live="polite">{$playerLobbyPlayers.length}</span>
            </div>
            <ul class="flex flex-wrap gap-2 p-3 max-h-[40vh] overflow-y-auto overscroll-contain">
              {#each $playerLobbyPlayers as player (player.id)}
                {@const isMe = player.id === $playerId}
                <li
                  class="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium animate-scale-in
                    {isMe ? 'bg-primary-500 text-white' : 'bg-gray-800 text-gray-100'}"
                >
                  <span class="truncate">{player.nickname}</span>
                  {#if isMe}<span class="text-xs opacity-80">(vous)</span>{/if}
                </li>
              {/each}
            </ul>
          </section>
        </div>

      <!-- Question Active -->
      {:else if $playerStatus === 'QUESTION_ACTIVE'}
        {#if $playerQuestion}
          <div class="animate-fade-in">
            <!-- Question header: counter + big timer, then the full question text -->
            <div class="mb-4 sm:mb-6">
              <div class="flex items-center justify-between gap-3 mb-3">
                <span class="px-3 py-1 rounded-full text-xs sm:text-sm font-medium bg-primary-500/15 text-primary-300">
                  Question {$playerCurrentQuestionIndex + 1} / {$playerQuestionCount}
                </span>
                <p class="font-display font-bold text-3xl tabular-nums {timerUrgency}" aria-live="off">
                  {formatTime($playerTimeRemaining)}
                </p>
              </div>
              <div class="h-2 bg-gray-800 rounded-full overflow-hidden mb-4" aria-hidden="true">
                <div
                  class="h-full {timerBarColor} transition-all duration-300 ease-out"
                  style="width: {timeLimitMs > 0 ? Math.min(100, ($playerTimeRemaining / timeLimitMs) * 100) : 0}%"
                />
              </div>

              <h2 class="font-display text-xl sm:text-2xl md:text-3xl font-semibold leading-snug text-balance">
                {$playerQuestion.questionText}
              </h2>

              {#if $playerQuestion.imageUrl}
                <img
                  src={$playerQuestion.imageUrl}
                  alt=""
                  class="rounded-xl max-h-48 sm:max-h-64 mx-auto mt-4 w-full object-contain bg-gray-900"
                />
              {/if}
            </div>

            <!-- Answers: one full-width row per answer on phones, 2 columns from `sm` -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-4">
              {#each $playerQuestion.options as option (option.id)}
                {@const selected = $playerGameStore.selectedOptionId === option.id}
                <button
                  type="button"
                  on:click={() => handleAnswer(option.id)}
                  disabled={!$canAnswer}
                  aria-pressed={selected}
                  aria-label="{getColorConfig(option.colorIndex).label} : {option.text}"
                  class="answer-tile {getOptionColorClass(option.colorIndex)} {getOptionTextClass(option.colorIndex)}
                    {$canAnswer ? 'active:scale-[0.98] sm:hover:brightness-110' : selected ? 'ring-4 ring-white cursor-default' : 'opacity-35 cursor-default'}"
                >
                  <span class="answer-shape">{@html getShapeSvg(option.colorIndex)}</span>
                  <span class="answer-text">{option.text}</span>
                  {#if selected}
                    <svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m5 13 4 4L19 7" />
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>

            <!-- Answer status (optimistic 'sent', confirmed by player:answer_accepted) -->
            {#if $playerAnswerStatus !== 'none'}
              <p class="mt-5 text-center text-gray-300" role="status">
                {$playerAnswerStatus === 'accepted' ? 'Réponse enregistrée' : 'Réponse envoyée'}, en attente des autres joueurs…
              </p>
            {/if}
          </div>
        {/if}

      <!-- Question Results / Feedback: every player, answered or not -->
      {:else if $showQuestionResults}
        <div class="animate-fade-in max-w-xl mx-auto">
          <!-- Result Card -->
          <div class="card bg-gray-900 border-gray-800 mb-4 sm:mb-6 overflow-hidden">
            <div class="p-4 sm:p-6">
              {#if feedback}
                <!-- Correct / Incorrect / No answer -->
                <div class="flex items-center gap-4 mb-5 sm:mb-6">
                  <div class="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl flex items-center justify-center { feedback.isCorrect ? 'bg-green-500/20' : feedback.answered ? 'bg-red-500/20' : 'bg-gray-500/20' }">
                    {#if feedback.isCorrect}
                      <svg class="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    {:else if feedback.answered}
                      <svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m-2 2l2 2m-2-2l-2 2m2-2l-2-2" />
                      </svg>
                    {:else}
                      <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    {/if}
                  </div>
                  <div>
                    <p class="text-2xl font-semibold { feedback.isCorrect ? 'text-green-400' : feedback.answered ? 'text-red-400' : 'text-gray-300' }">
                      {feedback.isCorrect ? 'Correct !' : feedback.answered ? 'Incorrect' : 'Pas de réponse'}
                    </p>
                    <p class="text-gray-400">+{feedback.pointsEarned} pts</p>
                  </div>
                </div>
              {:else}
                <p class="mb-6 text-gray-300" role="status">Calcul de votre résultat…</p>
              {/if}

              <!-- Show correct answer -->
              {#if correctOption}
                <div class="mb-4 p-3 sm:p-4 bg-gray-800/60 rounded-xl">
                  <p class="text-sm text-gray-400 mb-2">La bonne réponse était :</p>
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 shrink-0 rounded-xl {getOptionColorClass(correctOption.colorIndex)} {getOptionTextClass(correctOption.colorIndex)} flex items-center justify-center">
                      {@html getShapeSvg(correctOption.colorIndex, 'w-5 h-5')}
                    </div>
                    <span class="flex-1 min-w-0 font-medium text-base sm:text-lg">{correctOption.text}</span>
                    <svg class="w-5 h-5 shrink-0 text-green-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </div>
              {/if}

              <!-- Score Update -->
              <div class="grid grid-cols-3 gap-2 sm:gap-4 text-center">
                <div class="p-2 sm:p-3 rounded-xl bg-gray-800/60">
                  <p class="text-2xl sm:text-3xl font-display font-bold text-primary-300 tabular-nums">{$playerScore}</p>
                  <p class="text-xs text-gray-400">Score total</p>
                </div>
                <div class="p-2 sm:p-3 rounded-xl bg-gray-800/60">
                  <p class="text-2xl sm:text-3xl font-display font-bold text-amber-300 tabular-nums">{$playerRank || '—'}</p>
                  <p class="text-xs text-gray-400">Rang</p>
                </div>
                <div class="p-2 sm:p-3 rounded-xl bg-gray-800/60">
                  <p class="text-2xl sm:text-3xl font-display font-bold text-white tabular-nums">{$playerStreak}</p>
                  <p class="text-xs text-gray-400">Série</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Answer distribution (question:ended.answerDistribution) -->
          {#if results && resultQuestion}
            <div class="card bg-gray-900 border-gray-800">
              <div class="p-4 border-b border-gray-800">
                <h3 class="font-semibold">Répartition des réponses</h3>
              </div>
              <ul class="divide-y divide-gray-800">
                {#each resultQuestion.options as option (option.id)}
                  <li class="p-3 flex items-center gap-3">
                    <div class="w-8 h-8 shrink-0 rounded-lg {getOptionColorClass(option.colorIndex)} {getOptionTextClass(option.colorIndex)} flex items-center justify-center">
                      {@html getShapeSvg(option.colorIndex, 'w-4 h-4')}
                    </div>
                    <span class="flex-1 min-w-0 text-sm">{option.text}</span>
                    <span class="shrink-0 text-sm text-gray-400 tabular-nums">{results.answerDistribution[option.id] ?? 0} vote{(results.answerDistribution[option.id] ?? 0) > 1 ? 's' : ''}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>

      <!-- Final Podium -->
      {:else if $showPodium}
        {#if $playerPodium}
          <div class="animate-fade-in max-w-xl mx-auto">
            <!-- Personal Result -->
            <div class="card bg-gray-900 border-gray-800 mb-4 sm:mb-6 overflow-hidden">
              <div class="p-4 sm:p-6 text-center">
                {#if $playerPodium.podium[0]?.playerId === $playerId}
                  <div class="mb-4">
                    <svg class="w-16 h-16 mx-auto text-yellow-400 animate-bounce-slow" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13.493 3.268c-.693-.08-1.384.195-1.754.746l-2.842 4.27-3.816-.823c-.832-.18-1.686.388-1.866 1.218l-.766 3.208 2.725 2.66c.24.234.376.584.376.945l-.001 1.485c0 .743-.904 1.21-1.505.795l-2.67-2.224-.877 3.248c-.083.309-.037.629.211.886.148.153.335.276.533.362.273.122.554.186.84.186h11.002c.286 0 .567-.064.84-.186.198-.086.385-.209.533-.362.248-.257.294-.577.211-.886l-.877-3.248-2.67 2.224c-.602.414-1.505-.053-1.505-.794l.001-1.485c0-.36.136-.71.377-.944l2.725-2.66-.766-3.208c-.18-.831-.317-1.72.414-2.37l3.817-.823 2.842 4.27c.37.55 1.06.825 1.753.745l2.233-.38c.693-.119 1.195-.768.959-1.472l-1.13-3.372c-.114-.34-.46-.591-.807-.591H13.493z" />
                    </svg>
                  </div>
                  <h2 class="text-3xl font-display font-bold text-yellow-400 mb-2">🏆 Victoire !</h2>
                  <p class="text-gray-400">Vous avez gagné la partie !</p>
                {:else if $playerPodium.podium[1]?.playerId === $playerId}
                  <h2 class="text-2xl font-semibold text-gray-300 mb-2">2ème place</h2>
                  <p class="text-gray-400">Excellent résultat !</p>
                {:else if $playerPodium.podium[2]?.playerId === $playerId}
                  <h2 class="text-2xl font-semibold text-gray-300 mb-2">3ème place</h2>
                  <p class="text-gray-400">Sur le podium !</p>
                {:else}
                  <h2 class="text-2xl font-semibold text-gray-300 mb-2">Partie terminée</h2>
                  <p class="text-gray-400">Classement final : #{$playerRank}</p>
                {/if}

                <div class="mt-5 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-4 text-center">
                  <div class="p-2 sm:p-4 bg-gray-800/60 rounded-xl">
                    <p class="text-2xl sm:text-3xl font-display font-bold text-primary-300 tabular-nums">{$playerScore}</p>
                    <p class="text-xs text-gray-400">Score final</p>
                  </div>
                  <div class="p-2 sm:p-4 bg-gray-800/60 rounded-xl">
                    <p class="text-2xl sm:text-3xl font-display font-bold text-amber-300 tabular-nums">{$playerRank || '—'}</p>
                    <p class="text-xs text-gray-400">Rang final</p>
                  </div>
                  <div class="p-2 sm:p-4 bg-gray-800/60 rounded-xl">
                    <p class="text-2xl sm:text-3xl font-display font-bold text-white tabular-nums">{myFinalEntry?.correctAnswersCount ?? $playerGameStore.correctAnswersCount}</p>
                    <p class="text-xs text-gray-400">Bonnes réponses</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Full Leaderboard -->
            <div class="card bg-gray-900 border-gray-800 mb-4 sm:mb-6">
              <div class="p-4 border-b border-gray-800">
                <h3 class="font-semibold">Classement final</h3>
              </div>
              <ol class="divide-y divide-gray-800 max-h-[50vh] overflow-y-auto overscroll-contain">
                {#each $playerPodium.finalLeaderboard as entry, index (entry.playerId)}
                  {@const isMe = entry.playerId === $playerId}
                  <li class="px-3 py-3 sm:p-4 flex items-center gap-3 { isMe ? 'bg-primary-500/15' : '' }">
                    <span class="w-8 shrink-0 text-center text-lg font-display font-bold {index < 3 ? 'text-amber-300' : 'text-gray-400'}">
                      {entry.rank}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate { isMe ? 'text-primary-300' : '' }">
                        {entry.nickname}{isMe ? ' (vous)' : ''}
                      </p>
                      <p class="text-xs sm:text-sm text-gray-400">{entry.correctAnswersCount} bonne{entry.correctAnswersCount > 1 ? 's' : ''} réponse{entry.correctAnswersCount > 1 ? 's' : ''}</p>
                    </div>
                    <span class="shrink-0 font-display font-bold text-base sm:text-xl tabular-nums {index < 3 ? 'text-amber-300' : 'text-white'}">
                      {entry.score} pts
                    </span>
                  </li>
                {/each}
              </ol>
            </div>

            <!-- Return Button -->
            <div class="text-center mt-6 animate-fade-in">
              <button on:click={handleLeave} class="btn-primary w-full sm:w-auto px-8">
                Revenir à l'accueil
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </main>
</div>