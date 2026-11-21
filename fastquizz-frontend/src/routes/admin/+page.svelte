<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore, isAuthenticated, flashMessage, storeHostToken } from '$lib/stores';
  import { api, getAuthToken } from '$lib/utils/api';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';

  function handleLogout() {
    authStore.logout();
    goto('/');
  }

  let quizzes: Array<{
    id: string;
    title: string;
    description: string | null;
    isPublic: boolean;
    shareToken: string | null;
    questions: Array<{ id: string }>;
    createdAt: string;
    updatedAt: string;
  }> = [];
  let isLoading = true;
  let error: string | null = null;
  let roomModal: { pin: string; quizId: string; quizTitle: string; joinUrl: string } | null = null;

  async function loadQuizzes() {
    isLoading = true;
    error = null;
    try {
      if (!getAuthToken()) return;

      quizzes = await api.quizzes.list();
    } catch (err: any) {
      error = err.message || 'Erreur lors du chargement des quiz';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadQuizzes();
    // Message left by a fatal game error (e.g. HOST_UNAUTHORIZED, LOBBY_EXPIRED).
    const flash = flashMessage.consume();
    if (flash) error = flash;
  });

  function handleCreateQuiz() {
    goto('/admin/quiz-builder');
  }

  function handlePlayQuiz(quizId: string) {
    handleCreateRoom(quizId);
  }

  function handleEditQuiz(quizId: string) {
    goto(`/admin/quiz-builder?edit=${quizId}`);
  }

  async function handleDeleteQuiz(quizId: string) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce quiz ?')) return;

    try {
      await api.quizzes.delete(quizId);
      loadQuizzes();
    } catch (err: any) {
      error = err.message || 'Erreur lors de la suppression';
    }
  }

  async function handleTogglePublic(quizId: string, currentIsPublic: boolean) {
    try {
      await api.quizzes.togglePublic(quizId);
      loadQuizzes();
    } catch (err: any) {
      error = err.message || `Erreur lors du ${currentIsPublic ? 'retrait' : 'partage'} public`;
    }
  }

  async function handleCreateRoom(quizId: string) {
    try {
      const result = await api.games.createRoom(quizId);
      // ADR 0001 §3: the hostToken goes to localStorage only, never into a URL.
      storeHostToken(result.pin, result.hostToken);
      const joinUrl = `${window.location.origin}/player/join?code=${encodeURIComponent(result.pin)}`;
      roomModal = { pin: result.pin, quizId, quizTitle: result.quizTitle, joinUrl };
    } catch (err: any) {
      error = err.message || 'Erreur lors de la création du salon';
    }
  }

  function openLobby() {
    if (!roomModal) return;
    const pin = roomModal.pin;
    roomModal = null;
    goto(`/admin/lobby?pin=${encodeURIComponent(pin)}`);
  }

  function closeRoomModal() {
    roomModal = null;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (roomModal && event.key === 'Escape') closeRoomModal();
  }

  function selectInput(event: Event) {
    (event.currentTarget as HTMLInputElement).select();
  }

  // Inline "Copié" feedback instead of a blocking alert().
  let copiedKey: string | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copiedKey = null), 1800);
    } catch {
      /* clipboard unavailable: the field stays selectable */
    }
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<svelte:head>
  <title>{pageTitle('Mes quiz')}</title>
</svelte:head>

<svelte:window on:keydown={handleWindowKeydown} />

<div class="min-h-dvh bg-gray-50">
  <!-- Navigation -->
  <nav class="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 pt-safe">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between gap-2 h-16">
        <div class="flex items-center gap-3 min-w-0">
          <BrandLogo size="md" />
          <span class="hidden md:block text-gray-300">/</span>
          <h1 class="hidden md:block font-display font-semibold text-lg text-gray-900 truncate">Tableau de bord</h1>
        </div>

        <div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <a href="/admin/import" class="btn-secondary px-3 sm:px-5 text-sm" aria-label="Importer depuis Excel">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12" />
            </svg>
            <span class="hidden sm:inline">Importer Excel</span>
          </a>
          <button on:click={handleCreateQuiz} class="btn-primary px-3 sm:px-5" aria-label="Nouveau quiz">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            <span class="hidden sm:inline">Nouveau quiz</span>
          </button>
          <button on:click={handleLogout} class="btn-ghost text-sm px-2.5 sm:px-4" aria-label="Déconnexion">
            <svg class="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span class="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </div>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="px-3 sm:px-6 lg:px-8" style="padding-top: calc(5.5rem + env(safe-area-inset-top)); padding-bottom: calc(3rem + env(safe-area-inset-bottom));">
    <div class="max-w-7xl mx-auto">
      {#if error}
        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700" role="alert">
          {error}
        </div>
      {/if}

      {#if $isAuthenticated}
        <div class="mb-8">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-display font-bold text-2xl text-gray-900">Mes quiz</h2>
              <p class="text-gray-500 mt-1">Gérez vos quiz et lancez des parties</p>
            </div>
          </div>
        </div>

        {#if isLoading}
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
            <h3 class="font-semibold text-lg text-gray-900 mb-2">Aucun quiz créé</h3>
            <p class="text-gray-500 mb-6">Commencez par créer votre premier quiz interactif</p>
            <button on:click={handleCreateQuiz} class="btn-primary">
              <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Créer mon premier quiz
            </button>
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

                  <div class="flex flex-col min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between gap-0.5 text-xs text-gray-400 mb-4 mt-auto">
                    <span>Créé le {formatDate(quiz.createdAt)}</span>
                    <span>Modifié le {formatDate(quiz.updatedAt)}</span>
                  </div>

                  <div class="flex items-center gap-1">
                      <button
                        on:click={() => handlePlayQuiz(quiz.id)}
                        class="btn-primary flex-1 text-sm px-3"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Lancer
                      </button>
                      <button
                        on:click={() => handleEditQuiz(quiz.id)}
                        class="btn-icon btn-ghost"
                        title="Modifier"
                        aria-label="Modifier"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        on:click={() => handleTogglePublic(quiz.id, quiz.isPublic)}
                        class="btn-icon btn-ghost {quiz.isPublic ? 'text-green-600' : 'text-gray-600'}"
                        title={quiz.isPublic ? 'Rendre privé' : 'Rendre public'}
                        aria-label={quiz.isPublic ? 'Rendre privé' : 'Rendre public'}
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {#if quiz.isPublic}
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          {:else}
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          {/if}
                        </svg>
                      </button>
                      <button
                        on:click={() => handleDeleteQuiz(quiz.id)}
                        class="btn-icon btn-ghost text-red-600 hover:bg-red-50"
                        title="Supprimer"
                        aria-label="Supprimer"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- Not authenticated - redirect to login or show CTA -->
        <div class="card p-12 text-center animate-fade-in max-w-md mx-auto">
          <svg class="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h2 class="font-display font-bold text-2xl text-gray-900 mb-2">Connexion requise</h2>
          <p class="text-gray-500 mb-6">Connectez-vous pour accéder à votre tableau de bord et gérer vos quiz.</p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/auth/login" class="btn-primary w-full sm:w-auto">
              Se connecter
            </a>
            <a href="/auth/register" class="btn-secondary w-full sm:w-auto">
              S'inscrire
            </a>
          </div>
        </div>
      {/if}
    </div>
  </main>

  <!-- Room Modal -->
  {#if roomModal}
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in">
      <!-- Backdrop: mouse shortcut only; keyboard users close with Escape or the buttons -->
      <div class="absolute inset-0 bg-gray-950/60" role="presentation" on:click={closeRoomModal} />
      <div
        class="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-xl max-w-md w-full p-5 sm:p-6 animate-slide-up max-h-[90dvh] overflow-y-auto"
        style="padding-bottom: max(1.25rem, env(safe-area-inset-bottom));"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-modal-title"
      >
        <div class="flex items-center justify-between mb-4">
          <h3 id="room-modal-title" class="font-display font-semibold text-lg text-gray-900">Salon créé</h3>
          <button on:click={closeRoomModal} class="btn-icon btn-ghost -mr-2 text-gray-400" aria-label="Fermer">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p class="text-sm text-gray-500 mb-4">Partagez le code salon ou le lien pour que les joueurs rejoignent :</p>

        <!-- Room Code -->
        <div class="mb-4">
          <label class="label text-sm mb-2" for="room-modal-pin">Code salon</label>
          <div class="flex gap-2">
            <input
              id="room-modal-pin"
              type="text"
              value={roomModal.pin}
              readonly
              class="flex-1 min-w-0 input bg-gray-50 text-center text-2xl font-mono font-bold tracking-[0.2em]"
              on:click={selectInput}
            />
            <button on:click={() => roomModal && copyText(roomModal.pin, 'pin')} class="btn-primary shrink-0 px-4 w-28">
              {copiedKey === 'pin' ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
        </div>

        <!-- Join Link -->
        <div class="mb-4">
          <label class="label text-sm mb-2" for="room-modal-join-url">Lien de rejoindre</label>
          <div class="flex gap-2">
            <input
              id="room-modal-join-url"
              type="text"
              value={roomModal.joinUrl}
              readonly
              class="flex-1 min-w-0 input bg-gray-50 text-sm"
              on:click={selectInput}
            />
            <button on:click={() => roomModal && copyText(roomModal.joinUrl, 'url')} class="btn-secondary shrink-0 px-4 w-28">
              {copiedKey === 'url' ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
        </div>

        <div class="flex flex-col-reverse sm:flex-row gap-2">
          <button on:click={closeRoomModal} class="btn-ghost sm:flex-1">
            Fermer
          </button>
          <button on:click={openLobby} class="btn-primary sm:flex-1">
            Ouvrir le lobby
          </button>
        </div>

        <p class="text-xs text-gray-400 mt-3 text-center">Le compte à rebours de 59 s démarre à l'ouverture du lobby. 1 joueur minimum pour démarrer.</p>
      </div>
    </div>
  {/if}
</div>

