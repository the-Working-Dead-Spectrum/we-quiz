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
</script>

<svelte:head>
  <title>Jeu en cours - fastquizz</title>
  <!-- Prevent zoom on input focus (mobile) -->
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
</svelte:head>

<div class="min-h-screen bg-gray-900 text-white">
  <!-- Top Bar -->
  <header class="fixed top-0 left-0 right-0 z-40 bg-gray-900/80 backdrop-blur border-b border-gray-800">
    <div class="max-w-md mx-auto px-4">
      <div class="flex items-center justify-between h-14">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <p class="font-semibold text-sm">{$playerNickname}</p>
            <p class="text-xs text-gray-400">Code: {$playerPin ?? ''}</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <!-- Streak -->
          {#if $playerStreak > 0}
            <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span>{$playerStreak}🔥</span>
            </div>
          {/if}

          <!-- Score & Rank -->
          <div class="text-right">
            <p class="font-display font-bold text-lg">{$playerScore} pts</p>
            <p class="text-xs text-gray-400">{$playerRank > 0 ? `#${$playerRank}` : ''}</p>
          </div>

          <!-- Connection status -->
          <div
            class="w-2 h-2 rounded-full { $playerIsConnected ? 'bg-green-500' : 'bg-red-500' }"
            role="img"
            aria-label={$playerIsConnected ? 'Connecté' : 'Déconnecté'}
          />
        </div>
      </div>
    </div>
  </header>

  {#if $playerGameStore.connectionLost}
    <div class="fixed top-14 left-0 right-0 z-50 bg-red-600 text-white text-center py-2 text-sm animate-slide-down" role="alert">
      {$playerError ?? 'Connexion perdue.'} <button class="underline font-semibold" on:click={() => location.reload()}>Recharger la page</button>
    </div>
  {:else if $playerIsReconnecting}
    <div class="fixed top-14 left-0 right-0 z-50 bg-yellow-500 text-white text-center py-2 text-sm animate-slide-down">
      <svg class="w-4 h-4 inline animate-spin mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Reconnexion en cours...
    </div>
  {/if}

  {#if $playerError && !$playerIsReconnecting && !$playerGameStore.connectionLost}
    <div class="fixed top-14 left-0 right-0 z-50 bg-red-500 text-white text-center py-2 text-sm animate-slide-down" role="alert">
      {$playerError}
    </div>
  {/if}

  <main class="pt-20 pb-8 px-4">
    <div class="max-w-md mx-auto">
      <!-- Waiting / Lobby -->
      {#if $playerStatus === 'LOBBY'}
        <div class="animate-fade-in text-center py-16">
          <div class="w-24 h-24 mx-auto rounded-2xl bg-primary-500/20 flex items-center justify-center mb-8">
            <svg class="w-12 h-12 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 class="text-2xl font-semibold mb-2">En attente de l'hôte</h2>
          <p class="text-gray-400">La partie commence bientôt...</p>

          <!-- Lobby countdown (lobby:timer.remaining, ms) -->
          {#if $playerLobbyTimerRemaining > 0}
            <div class="mt-8 max-w-xs mx-auto">
              <p class="text-sm text-gray-400">Démarrage automatique dans</p>
              <p class="font-display font-bold text-3xl font-mono tabular-nums">{formatTime($playerLobbyTimerRemaining)}</p>
              <div class="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-primary-500 h-full transition-all duration-1000 ease-linear"
                  style="width: {Math.min(100, ($playerLobbyTimerRemaining / LOBBY_DURATION_MS) * 100)}%"
                />
              </div>
            </div>
          {/if}
        </div>

      <!-- Question Active -->
      {:else if $playerStatus === 'QUESTION_ACTIVE'}
        {#if $playerQuestion}
          <div class="animate-fade-in">
            <!-- Question Header -->
            <div class="mb-6">
              <div class="flex items-center justify-between mb-3">
                <span class="px-3 py-1 rounded-full text-xs font-medium bg-primary-500/20 text-primary-400">
                  Question {$playerCurrentQuestionIndex + 1} / {$playerQuestionCount}
                </span>
                <div class="text-right">
                  <p class="text-2xl font-display font-bold text-primary-400">{formatTime($playerTimeRemaining)}</p>
                  <p class="text-xs text-gray-500">Temps restant</p>
                </div>
              </div>

              <h2 class="text-2xl sm:text-3xl font-semibold leading-tight mb-4">{$playerQuestion.questionText}</h2>

              {#if $playerQuestion.imageUrl}
                <img
                  src={$playerQuestion.imageUrl}
                  alt="Question"
                  class="rounded-xl max-h-64 mx-auto mb-6 w-full object-cover"
                />
              {/if}
            </div>

            <!-- Answer Buttons - Kahoot Style Grid -->
            <div class="grid grid-cols-2 gap-4 mb-6">
              {#each $playerQuestion.options as option (option.id)}
                {@const selected = $playerGameStore.selectedOptionId === option.id}
                <button
                  on:click={() => handleAnswer(option.id)}
                  disabled={!$canAnswer}
                  aria-pressed={selected}
                  class="kahoot-btn {getOptionColorClass(option.colorIndex)} {!$canAnswer ? (selected ? 'ring-4 ring-white cursor-not-allowed' : 'opacity-50 cursor-not-allowed') : 'hover:scale-[1.02]'}"
                  style="--btn-color: {getColorConfig(option.colorIndex).bg}"
                >
                  <div class="kahoot-btn-shape">
                    {@html getShapeSvg(option.colorIndex)}
                  </div>
                  <span class="relative z-10 text-2xl sm:text-3xl font-bold">{option.text}</span>
                </button>
              {/each}
            </div>

            <!-- Answer status (optimistic 'sent', confirmed by player:answer_accepted) -->
            {#if $playerAnswerStatus !== 'none'}
              <p class="mb-4 text-center text-gray-300" role="status">
                {$playerAnswerStatus === 'accepted' ? 'Réponse enregistrée' : 'Réponse envoyée'}, en attente des autres joueurs…
              </p>
            {/if}

            <!-- Timer Bar -->
            <div class="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-primary-500 transition-all duration-300 ease-out"
                style="width: {timeLimitMs > 0 ? Math.min(100, ($playerTimeRemaining / timeLimitMs) * 100) : 0}%"
              />
            </div>
          </div>
        {/if}

      <!-- Question Results / Feedback: every player, answered or not -->
      {:else if $showQuestionResults}
        <div class="animate-fade-in">
          <!-- Result Card -->
          <div class="card bg-gray-800 border-gray-700 mb-6 overflow-hidden">
            <div class="p-6">
              {#if feedback}
                <!-- Correct / Incorrect / No answer -->
                <div class="flex items-center gap-4 mb-6">
                  <div class="w-16 h-16 rounded-2xl flex items-center justify-center { feedback.isCorrect ? 'bg-green-500/20' : feedback.answered ? 'bg-red-500/20' : 'bg-gray-500/20' }">
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
                <div class="mb-4 p-4 bg-gray-800/50 rounded-xl">
                  <p class="text-sm text-gray-400 mb-2">La bonne réponse était :</p>
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl {getOptionColorClass(correctOption.colorIndex)} flex items-center justify-center">
                      {@html getShapeSvg(correctOption.colorIndex)}
                    </div>
                    <span class="font-medium text-lg">{correctOption.text}</span>
                    <svg class="w-5 h-5 text-green-400 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </div>
              {/if}

                <!-- Score Update -->
                <div class="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p class="text-3xl font-display font-bold text-primary-400">{$playerScore}</p>
                    <p class="text-xs text-gray-400">Score total</p>
                  </div>
                  <div>
                    <p class="text-3xl font-display font-bold text-yellow-400">{$playerRank}</p>
                    <p class="text-xs text-gray-400">Rang</p>
                  </div>
                  <div>
                    <p class="text-3xl font-display font-bold text-purple-400">{$playerStreak}</p>
                    <p class="text-xs text-gray-400">Série</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Answer distribution (question:ended.answerDistribution) -->
            {#if results && resultQuestion}
              <div class="card bg-gray-800 border-gray-700">
                <div class="p-4 border-b border-gray-700">
                  <h3 class="font-semibold">Répartition des réponses</h3>
                </div>
                <div class="divide-y divide-gray-700 max-h-48 overflow-y-auto">
                  {#each resultQuestion.options as option (option.id)}
                    <div class="p-3 flex items-center gap-3">
                      <div class="w-8 h-8 rounded-lg {getOptionColorClass(option.colorIndex)} flex items-center justify-center flex-shrink-0">
                        {@html getShapeSvg(option.colorIndex)}
                      </div>
                      <span class="flex-1 truncate text-sm">{option.text}</span>
                      <span class="text-sm text-gray-400">{results.answerDistribution[option.id] ?? 0} votes</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

      <!-- Final Podium -->
      {:else if $showPodium}
        {#if $playerPodium}
          <div class="animate-fade-in">
            <!-- Personal Result -->
            <div class="card bg-gray-800 border-gray-700 mb-6 overflow-hidden">
              <div class="p-6 text-center">
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

                <div class="mt-6 grid grid-cols-3 gap-4 text-center">
                  <div class="p-4 bg-gray-800/50 rounded-xl">
                    <p class="text-3xl font-display font-bold text-primary-400">{$playerScore}</p>
                    <p class="text-xs text-gray-400">Score final</p>
                  </div>
                  <div class="p-4 bg-gray-800/50 rounded-xl">
                    <p class="text-3xl font-display font-bold text-yellow-400">{$playerRank}</p>
                    <p class="text-xs text-gray-400">Rang final</p>
                  </div>
                  <div class="p-4 bg-gray-800/50 rounded-xl">
                    <p class="text-3xl font-display font-bold text-purple-400">{myFinalEntry?.correctAnswersCount ?? $playerGameStore.correctAnswersCount}</p>
                    <p class="text-xs text-gray-400">Bonnes réponses</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Full Leaderboard -->
            <div class="card bg-gray-800 border-gray-700 mb-6">
              <div class="p-4 border-b border-gray-700">
                <h3 class="font-semibold">Classement final</h3>
              </div>
              <div class="divide-y divide-gray-700 max-h-[50vh] overflow-y-auto">
                {#each $playerPodium.finalLeaderboard as entry, index (entry.playerId)}
                  <div class="p-4 flex items-center gap-4 hover:bg-gray-700/50 transition-colors { entry.playerId === $playerId ? 'bg-primary-500/10' : '' }">
                    <span class="w-10 text-center text-lg font-display font-bold {index < 3 ? 'text-yellow-400' : 'text-gray-400'}">
                      {entry.rank}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate { entry.playerId === $playerId ? 'text-primary-400' : '' }">
                        {entry.nickname} { entry.playerId === $playerId ? '(Vous)' : '' }
                      </p>
                      <p class="text-sm text-gray-400">{entry.correctAnswersCount} bonnes réponses</p>
                    </div>
                    <span class="font-display font-bold text-xl {index < 3 ? 'text-yellow-400' : 'text-white'}">
                      {entry.score} pts
                    </span>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Return Button -->
            <div class="text-center mt-6 animate-fade-in">
              <button
                on:click={handleLeave}
                class="btn-secondary px-8 py-3"
              >
                Revenir à l'accueil
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </main>
</div>