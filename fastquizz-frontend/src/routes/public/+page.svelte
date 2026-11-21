<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/utils/api';
  import { flashMessage } from '$lib/stores';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  let quizzes: Array<{
    id: string;
    title: string;
    description: string | null;
    questions: Array<{ id: string }>;
    author: { id: string; name: string };
    createdAt: string;
  }> = [];
  let isLoading = true;
  let error: string | null = null;
  // Message left by a failed game creation (QUIZ_NOT_FOUND / QUIZ_INVALID, ADR 0001 §9).
  let notice: string | null = null;

  async function loadPublicQuizzes() {
    isLoading = true;
    error = null;
    try {
      quizzes = await api.quizzes.listPublic();
    } catch (err: any) {
      error = err.message || 'Erreur lors du chargement';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    notice = flashMessage.consume();
    loadPublicQuizzes();
  });

  function handlePlayQuiz(quizId: string) {
    // The lobby sends host:create_game { quizId } (anonymous hosting, ADR 0001 §5).
    goto(`/admin/lobby?quizId=${encodeURIComponent(quizId)}`);
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
  <title>{pageTitle('Quiz publics')}</title>
</svelte:head>

<div class="min-h-dvh bg-gray-50">
  <header class="bg-white border-b border-gray-100 pt-safe">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
      <BrandLogo size="md" />
      <a href="/player/join" class="btn-primary text-sm px-3 sm:px-5">Rejoindre</a>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-3 sm:px-6 py-8 sm:py-12" style="padding-bottom: calc(3rem + env(safe-area-inset-bottom));">
    <div class="mb-6 sm:mb-8">
      <h1 class="font-display font-bold text-2xl sm:text-3xl text-gray-950 mb-2">Quiz publics</h1>
      <p class="text-gray-500">Découvrez et jouez aux quiz partagés par la communauté</p>
    </div>

    {#if notice}
      <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700" role="alert">
        {notice}
      </div>
    {/if}

    {#if error}
      <div class="card p-8 text-center">
        <svg class="w-12 h-12 mx-auto text-red-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p class="text-gray-500">{error}</p>
      </div>
    {:else if isLoading}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {#each Array(6) as _}
          <div class="card animate-pulse">
            <div class="p-6 space-y-4">
              <div class="h-6 bg-gray-200 rounded w-3/4" />
              <div class="h-4 bg-gray-200 rounded w-1/2" />
              <div class="h-4 bg-gray-200 rounded w-1/3" />
              <div class="h-8 bg-gray-200 rounded mt-4" />
            </div>
          </div>
        {/each}
      </div>
    {:else if quizzes.length === 0}
      <div class="card p-12 text-center animate-fade-in">
        <svg class="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <h2 class="font-display font-bold text-xl text-gray-900 mb-2">Aucun quiz public</h2>
        <p class="text-gray-500 mb-6">Soyez le premier à partager un quiz publiquement !</p>
        <a href="/auth/login" class="btn-primary">Se connecter pour créer</a>
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {#each quizzes as quiz}
          <div class="card-hover group flex flex-col">
            <div class="p-4 sm:p-6 flex flex-col flex-1">
              <div class="flex items-start justify-between gap-3 mb-3">
                <h3 class="font-display font-semibold text-lg text-gray-900 group-hover:text-primary-600 transition-colors line-clamp-2 min-w-0">
                  {quiz.title}
                </h3>
                <span class="shrink-0 px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full whitespace-nowrap">
                  {quiz.questions.length} question{quiz.questions.length > 1 ? 's' : ''}
                </span>
              </div>

              {#if quiz.description}
                <p class="text-sm text-gray-500 mb-4 line-clamp-2">{quiz.description}</p>
              {/if}

              <div class="flex items-center justify-between gap-2 text-xs text-gray-400 mb-4 mt-auto">
                <span class="truncate">Par {quiz.author?.name || 'Anonyme'}</span>
                <span>{formatDate(quiz.createdAt)}</span>
              </div>

              <button
                on:click={() => handlePlayQuiz(quiz.id)}
                class="btn-primary w-full"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Jouer
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>