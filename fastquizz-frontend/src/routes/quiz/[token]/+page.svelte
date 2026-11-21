<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/utils/api';
  import { flashMessage } from '$lib/stores';

  let quiz: any = null;
  let isLoading = true;
  let error: string | null = null;
  // Message left by a failed game creation (QUIZ_NOT_FOUND / QUIZ_INVALID, ADR 0001 §9).
  let notice: string | null = null;

  async function loadQuiz() {
    const token = $page.params.token;
    if (!token) {
      error = 'Lien de partage invalide';
      isLoading = false;
      return;
    }

    isLoading = true;
    error = null;
    try {
      quiz = await api.quizzes.getByShareToken(token);
    } catch (err: any) {
      error = err.message || 'Quiz non trouvé ou lien expiré';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    notice = flashMessage.consume();
    loadQuiz();
  });

  function handlePlayQuiz() {
    const token = $page.params.token;
    if (!quiz || !token) return;
    // The lobby sends host:create_game { quizId, shareToken } (ADR 0001 §5).
    goto(`/admin/lobby?quizId=${encodeURIComponent(quiz.id)}&shareToken=${encodeURIComponent(token)}`);
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
</script>

<svelte:head>
  <title>{quiz?.title || 'Chargement...'} - fastquizz</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-gray-50 to-white">
  <header class="bg-white border-b border-gray-100">
    <div class="max-w-3xl mx-auto px-4 py-4">
      <a href="/" class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <span class="font-display font-bold text-xl text-gray-900">fastquizz</span>
      </a>
    </div>
  </header>

  <main class="max-w-3xl mx-auto px-4 py-12">
    {#if notice}
      <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700" role="alert">
        {notice}
      </div>
    {/if}

    {#if isLoading}
      <div class="card animate-pulse">
        <div class="p-8 space-y-4">
          <div class="h-8 bg-gray-200 rounded w-1/2" />
          <div class="h-4 bg-gray-200 rounded w-1/3" />
          <div class="grid grid-cols-2 gap-4">
            <div class="h-16 bg-gray-200 rounded" />
            <div class="h-16 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    {:else if error}
      <div class="card p-12 text-center animate-fade-in">
        <svg class="w-16 h-16 mx-auto text-red-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h2 class="font-display font-bold text-xl text-gray-900 mb-2">Quiz inaccessible</h2>
        <p class="text-gray-500 mb-6">{error}</p>
        <a href="/" class="btn-primary">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Retour à l'accueil
        </a>
      </div>
    {:else if quiz}
      <div class="card animate-fade-in">
        <div class="p-8">
          <div class="flex items-center justify-between mb-6">
            <div>
              <span class="px-3 py-1 text-xs font-medium bg-purple-100 text-purple-700 rounded-full mb-2 inline-block">
                Partagé via lien
              </span>
              <h1 class="font-display font-bold text-3xl text-gray-900 mb-2">{quiz.title}</h1>
              {#if quiz.description}
                <p class="text-gray-500">{quiz.description}</p>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div class="bg-gray-50 rounded-xl p-4">
              <p class="text-sm text-gray-500 mb-1">Questions</p>
              <p class="font-display font-bold text-2xl text-gray-900">{quiz.questions.length}</p>
            </div>
            <div class="bg-gray-50 rounded-xl p-4">
              <p class="text-sm text-gray-500 mb-1">Auteur</p>
              <p class="font-medium text-gray-900">{quiz.author?.name || 'Inconnu'}</p>
            </div>
          </div>

          <div class="mb-6">
            <h3 class="font-semibold text-gray-900 mb-3">Aperçu des questions</h3>
            <div class="space-y-3 max-h-64 overflow-y-auto">
              {#each quiz.questions as question, index}
                <div class="bg-gray-50 rounded-xl p-4">
                  <div class="flex items-start gap-3">
                    <span class="flex-shrink-0 w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-semibold text-sm">
                      {index + 1}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-gray-900">{question.text}</p>
                      <div class="flex flex-wrap gap-2 mt-2">
                        {#each question.options as option}
                          <span class="px-2 py-1 text-xs rounded-full bg-white border border-gray-200">
                            {option.text}
                          </span>
                        {/each}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="flex items-center gap-4 pt-6 border-t border-gray-100">
            <button on:click={handlePlayQuiz} class="btn-primary flex-1 py-3">
              <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Lancer une partie
            </button>
            <a href="/" class="btn-ghost flex-1 py-3 text-center">
              Retour à l'accueil
            </a>
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>