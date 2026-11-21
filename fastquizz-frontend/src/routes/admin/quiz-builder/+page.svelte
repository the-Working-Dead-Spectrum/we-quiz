<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { quizBuilderStore, activeQuestion, questionCount, canAddQuestion, isValid, validationErrors } from '$lib/stores';
  import { authStore } from '$lib/stores/auth';
  import { api } from '$lib/utils/api';
  import QuestionEditor from '$lib/components/QuestionEditor.svelte';
  import BrandLogo from '$lib/components/BrandLogo.svelte';
  import { pageTitle } from '$lib/brand';

  let questionTextArea: HTMLTextAreaElement;

  function handleLogout() {
    authStore.logout();
    goto('/');
  }

  onMount(() => {
    setTimeout(() => questionTextArea?.focus(), 100);
  });

  function handleSave() {
    const errors = get(validationErrors);
    if (errors.length > 0) {
      quizBuilderStore.setError(errors.join(', '));
      return;
    }

    quizBuilderStore.setSaving(true);
    quizBuilderStore.setError(null);

    const payload = quizBuilderStore.getPayload();

    api.quizzes.create(payload)
      .then((quiz) => {
        quizBuilderStore.clearDraft();
        quizBuilderStore.reset();
        goto(`/admin/quiz-builder?success=${quiz.id}`);
      })
      .catch((error) => {
        quizBuilderStore.setSaving(false);
        quizBuilderStore.setError(error.message || "Erreur lors de la sauvegarde");
      });
  }

  // A button (not a link): declining the confirmation must keep the user in the editor.
  function handleCancel() {
    if (get(quizBuilderStore).isDirty) {
      if (confirm('Vous avez des modifications non sauvegardées. Voulez-vous vraiment quitter ?')) {
        quizBuilderStore.clearDraft();
        quizBuilderStore.reset();
        goto('/admin');
      }
    } else {
      goto('/admin');
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      handleSave();
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Créer un quiz')}</title>
</svelte:head>

<svelte:window on:keydown={handleKeyDown} />

<div class="min-h-dvh bg-gray-50">
  <!-- Top Bar -->
  <header class="fixed top-0 inset-x-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 pt-safe">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between gap-2 h-16">
        <div class="flex items-center gap-3 min-w-0">
          <BrandLogo size="md" href="/admin" />
          <span class="hidden md:block text-gray-300">/</span>
          <h1 class="hidden md:block font-display font-semibold text-lg text-gray-900 truncate">Créer un quiz</h1>
        </div>

        <div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button type="button" class="btn-ghost text-sm px-2.5 sm:px-4" on:click={handleCancel}>Annuler</button>
          <button class="btn-primary px-3 sm:px-5" on:click={handleSave} disabled={$quizBuilderStore.isSaving}>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            {$quizBuilderStore.isSaving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
          <button on:click={handleLogout} class="hidden sm:inline-flex btn-ghost text-sm">
            Déconnexion
          </button>
        </div>
      </div>
    </div>
  </header>

  <!-- Error Toast -->
  {#if $quizBuilderStore.error}
    <div class="fixed left-3 right-3 sm:left-auto sm:right-4 z-50 animate-slide-down bg-red-50 border border-red-200 rounded-xl p-4 sm:max-w-md shadow-lg" style="top: calc(5rem + env(safe-area-inset-top));" role="alert">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
        </svg>
        <p class="text-red-700 text-sm flex-1">{$quizBuilderStore.error}</p>
        <button on:click={() => quizBuilderStore.setError(null)} class="text-red-500 hover:text-red-700" aria-label="Fermer">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  {/if}

  <!-- Success Toast -->
  {#if $quizBuilderStore.success}
    <div class="fixed left-3 right-3 sm:left-auto sm:right-4 z-50 animate-slide-down bg-green-50 border border-green-200 rounded-xl p-4 sm:max-w-md shadow-lg" style="top: calc(5rem + env(safe-area-inset-top));" role="status">
      <div class="flex items-center gap-3">
        <svg class="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <p class="text-green-700 text-sm flex-1">Quiz sauvegardé avec succès !</p>
      </div>
    </div>
  {/if}

  <!-- Main Content -->
  <main class="px-3 sm:px-6 lg:px-8" style="padding-top: calc(5.5rem + env(safe-area-inset-top)); padding-bottom: calc(3rem + env(safe-area-inset-bottom));">
    <div class="max-w-4xl mx-auto">
      <!-- Quiz Title & Description -->
      <div class="card mb-4 sm:mb-6 animate-fade-in">
        <div class="p-4 sm:p-6">
          <div class="mb-5 sm:mb-6">
            <label for="quiz-title" class="label">Titre du quiz *</label>
            <input
              id="quiz-title"
              bind:value={$quizBuilderStore.title}
              on:input={() => quizBuilderStore.setTitle($quizBuilderStore.title)}
              placeholder="Ex: Quiz Culture Générale"
              class="input text-lg sm:text-2xl font-semibold"
              maxlength="100"
              bind:this={questionTextArea}
            />
            <p class="text-sm text-gray-500 mt-1">{$quizBuilderStore.title.length}/100</p>
          </div>
          <div>
            <label for="quiz-description" class="label">Description (optionnelle)</label>
            <textarea
              id="quiz-description"
              bind:value={$quizBuilderStore.description}
              on:input={() => quizBuilderStore.setDescription($quizBuilderStore.description)}
              placeholder="Description du quiz pour les participants..."
              class="input min-h-[80px] resize-y"
              maxlength="500"
            ></textarea>
            <p class="text-sm text-gray-500 mt-1">{$quizBuilderStore.description.length}/500</p>
          </div>
        </div>
      </div>

      <!-- Questions List Sidebar (Desktop) -->
      <div class="hidden lg:block lg:fixed lg:top-24 lg:right-8 lg:w-64 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto animate-fade-in">
        <div class="card sticky top-24">
          <div class="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 class="font-semibold text-gray-900">Questions ({$questionCount})</h3>
            {#if $canAddQuestion}
              <button on:click={() => quizBuilderStore.addQuestion()} class="btn-primary text-sm px-3 py-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            {/if}
          </div>
          <div class="p-2">
            {#each $quizBuilderStore.questions as question, index}
              <button
                class="w-full text-left p-3 rounded-xl transition-colors {index === $quizBuilderStore.activeQuestionIndex
                  ? 'bg-primary-50 text-primary-700'
                  : 'hover:bg-gray-50 text-gray-700'}"
                on:click={() => quizBuilderStore.setActiveQuestion(index)}
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium text-sm truncate pr-2">
                    Q{index + 1}: {question.text || 'Nouvelle question'}
                  </span>
                  <span class="text-xs text-gray-400">{question.options.filter(o => o.text).length}/4 options</span>
                </div>
                <div class="flex items-center gap-1 mt-1">
                  {#each question.options as option, optIndex}
                    {#if option.text}
                      <span class="w-2 h-2 rounded-full {getColorConfig(optIndex).bg} {option.isCorrect ? 'ring-2 ring-offset-2 ring-offset-white' : ''}" />
                    {:else}
                      <span class="w-2 h-2 rounded-full bg-gray-200" />
                    {/if}
                  {/each}
                </div>
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Question Editor -->
      <div class="lg:pr-80 animate-slide-up">
        {#if $quizBuilderStore.questions.length > 0}
          <QuestionEditor
            question={$activeQuestion}
            index={$quizBuilderStore.activeQuestionIndex}
            total={$questionCount}
            onUpdateText={(text) => quizBuilderStore.updateQuestionText($quizBuilderStore.activeQuestionIndex, text)}
            onUpdateImage={(url) => quizBuilderStore.updateQuestionImage($quizBuilderStore.activeQuestionIndex, url)}
            onUpdateTimeLimit={(time) => quizBuilderStore.updateQuestionTimeLimit($quizBuilderStore.activeQuestionIndex, time)}
            onUpdatePoints={(points) => quizBuilderStore.updateQuestionPointsMultiplier($quizBuilderStore.activeQuestionIndex, points)}
            onUpdateOptionText={(optIndex, text) => quizBuilderStore.updateOptionText($quizBuilderStore.activeQuestionIndex, optIndex, text)}
            onSetCorrect={(optIndex) => quizBuilderStore.setCorrectOption($quizBuilderStore.activeQuestionIndex, optIndex)}
            onDuplicate={() => quizBuilderStore.duplicateQuestion($quizBuilderStore.activeQuestionIndex)}
            onDelete={() => quizBuilderStore.removeQuestion($quizBuilderStore.activeQuestionIndex)}
            onReorder={(dir) => quizBuilderStore.reorderQuestions($quizBuilderStore.activeQuestionIndex, $quizBuilderStore.activeQuestionIndex + dir)}
          />
        {:else}
          <div class="card p-12 text-center">
            <svg class="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 class="font-semibold text-lg text-gray-900 mb-2">Aucune question</h3>
            <p class="text-gray-500 mb-6">Ajoutez votre première question pour commencer</p>
            <button on:click={() => quizBuilderStore.addQuestion()} class="btn-primary">
              <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Ajouter une question
            </button>
          </div>
        {/if}
      </div>

      <!-- Mobile Questions List -->
      <div class="lg:hidden mt-6 animate-fade-in">
        <div class="card">
          <div class="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 class="font-semibold text-gray-900">Questions ({$questionCount})</h3>
            {#if $canAddQuestion}
              <button on:click={() => quizBuilderStore.addQuestion()} class="btn-primary text-sm px-3 py-1.5">+ Ajouter</button>
            {/if}
          </div>
          <div class="p-2 max-h-64 overflow-y-auto">
            {#each $quizBuilderStore.questions as question, index}
              <button
                class="w-full text-left p-3 rounded-xl transition-colors {index === $quizBuilderStore.activeQuestionIndex
                  ? 'bg-primary-50 text-primary-700'
                  : 'hover:bg-gray-50 text-gray-700'}"
                on:click={() => quizBuilderStore.setActiveQuestion(index)}
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium text-sm truncate pr-2">Q{index + 1}: {question.text || 'Nouvelle question'}</span>
                  <div class="flex items-center gap-1">
                    {#each question.options as option, optIndex}
                      {#if option.text}
                        <span class="w-2 h-2 rounded-full {getColorConfig(optIndex).bg} {option.isCorrect ? 'ring-2 ring-offset-2 ring-offset-white' : ''}" />
                      {:else}
                        <span class="w-2 h-2 rounded-full bg-gray-200" />
                      {/if}
                    {/each}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- Keyboard shortcut hint -->
  <div class="fixed bottom-4 right-4 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg opacity-70 hidden lg:block">
    <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">⌘/Ctrl</kbd> + <kbd class="px-1.5 py-0.5 bg-gray-700 rounded">S</kbd> pour sauvegarder
  </div>
</div>

<script context="module" lang="ts">
  import { getColorConfig } from '$lib/types';
</script>