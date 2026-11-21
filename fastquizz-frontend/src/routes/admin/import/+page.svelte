<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore, isAuthenticated, quizBuilderStore } from '$lib/stores';
  import { api, getAuthToken } from '$lib/utils/api';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';
  import { onMount } from 'svelte';

  type Step = 'form' | 'loading' | 'preview' | 'saving' | 'error';
  type ImportError = { row: number; field?: string; message: string };
  type PreviewOption = { text: string; isCorrect: boolean; colorIndex: number };
  type PreviewQuestion = {
    text: string;
    imageUrl?: string;
    timeLimit: number;
    pointsMultiplier: number;
    options: PreviewOption[];
  };
  type PreviewDto = { title: string; description?: string; questions: PreviewQuestion[] };

  let step: Step = 'form';
  let title = '';
  let description = '';
  let isPublic = false;
  let selectedFile: File | null = null;
  let isDragging = false;

  let dto: PreviewDto | null = null;
  let errors: ImportError[] = [];
  let questionCount = 0;
  let serverError: string | null = null;
  let togglePublicAfterCreate = false;

  onMount(() => {
    if (!getAuthToken()) goto('/auth/login?redirect=/admin/import');
  });

  function handleLogout() {
    authStore.logout();
    goto('/');
  }

  function handleFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    selectedFile = input.files?.[0] || null;
  }

  function handleDrop(ev: DragEvent) {
    ev.preventDefault();
    isDragging = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) selectedFile = file;
  }

  function handleDragOver(ev: DragEvent) {
    ev.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  async function handleAnalyse() {
    serverError = null;
    if (!title.trim()) {
      serverError = 'Le titre est obligatoire.';
      return;
    }
    if (!selectedFile) {
      serverError = 'Veuillez sélectionner un fichier Excel (.xlsx).';
      return;
    }
    if (!/\.xlsx$/i.test(selectedFile.name)) {
      serverError = 'Format attendu : fichier .xlsx.';
      return;
    }
    step = 'loading';
    togglePublicAfterCreate = isPublic;
    try {
      const result = await api.quizzes.importPreview(selectedFile, {
        title: title.trim(),
        description: description.trim() || undefined,
        isPublic,
      });
      dto = result.dto;
      errors = result.errors;
      questionCount = result.questionCount;
      step = 'preview';
    } catch (err: any) {
      serverError = err?.message || "Erreur lors de l'analyse du fichier.";
      step = 'form';
    }
  }

  async function handleConfirm() {
    if (!dto || errors.length > 0) return;
    step = 'saving';
    try {
      const created = await api.quizzes.create(dto);
      if (togglePublicAfterCreate) {
        try {
          await api.quizzes.togglePublic(created.id);
        } catch {
          // Quiz created; public toggle can be retried from /admin.
        }
      }
      goto('/admin');
    } catch (err: any) {
      serverError = err?.message || 'Erreur lors de la création du quiz.';
      step = 'preview';
    }
  }

  function handleEditInBuilder() {
    if (!dto) return;
    quizBuilderStore.loadQuiz({
      title: dto.title,
      description: dto.description,
      questions: dto.questions,
    });
    goto('/admin/quiz-builder');
  }

  function handleCancel() {
    dto = null;
    errors = [];
    questionCount = 0;
    serverError = null;
    selectedFile = null;
    step = 'form';
  }

  function colorDot(idx: number): string {
    const map = ['bg-red-500', 'bg-blue-500', 'bg-yellow-400', 'bg-green-500'];
    return map[idx] || 'bg-gray-300';
  }
</script>

<svelte:head>
  <title>{pageTitle('Importer un quiz')}</title>
</svelte:head>

<div class="min-h-dvh bg-gray-50">
  <header class="fixed top-0 inset-x-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100 pt-safe">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between gap-2 h-16">
        <div class="flex items-center gap-3 min-w-0">
          <BrandLogo size="md" href="/admin" />
          <span class="hidden md:block text-gray-300">/</span>
          <h1 class="hidden md:block font-display font-semibold text-lg text-gray-900 truncate">Importer un quiz</h1>
        </div>
        <div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <a href="/admin" class="btn-ghost text-sm px-2.5 sm:px-4">Retour</a>
          <button on:click={handleLogout} class="hidden sm:inline-flex btn-ghost text-sm">Déconnexion</button>
        </div>
      </div>
    </div>
  </header>

  <main class="px-3 sm:px-6 lg:px-8" style="padding-top: calc(5.5rem + env(safe-area-inset-top)); padding-bottom: calc(3rem + env(safe-area-inset-bottom));">
    <div class="max-w-4xl mx-auto">
      {#if $isAuthenticated}
        {#if step === 'form' || step === 'loading'}
          <div class="mb-6">
            <h2 class="font-display font-bold text-2xl text-gray-900">Importer un quiz depuis Excel</h2>
            <p class="text-gray-500 mt-1">Chargez un fichier <code>.xlsx</code> basé sur notre template, prévisualisez les questions puis confirmez.</p>
          </div>

          {#if serverError}
            <div class="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm" role="alert">
              {serverError}
            </div>
          {/if}

          <div class="card p-6 space-y-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="font-semibold text-gray-900">Template</h3>
                <p class="text-sm text-gray-500">Téléchargez le modèle, remplissez une ligne par question.</p>
              </div>
              <a href="/quiz-import-template.xlsx" download class="btn-secondary text-sm px-4 shrink-0">
                Télécharger le template
              </a>
            </div>

            <div>
              <label for="quiz-title" class="label">Titre du quiz <span class="text-red-500">*</span></label>
              <input id="quiz-title" bind:value={title} type="text" maxlength="100" class="input" placeholder="Ex: Quiz de culture générale" />
            </div>

            <div>
              <label for="quiz-desc" class="label">Description (optionnel)</label>
              <textarea id="quiz-desc" bind:value={description} maxlength="500" rows="2" class="input" placeholder="Courte description affichée aux hôtes"></textarea>
            </div>

            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" bind:checked={isPublic} class="rounded" />
              Rendre ce quiz public après création
            </label>

            <div>
              <label for="quiz-xlsx-input" class="label">Fichier Excel</label>
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <div
                class="border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer {isDragging ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'}"
                on:drop={handleDrop}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:click={() => document.getElementById('quiz-xlsx-input')?.click()}
              >
                <input id="quiz-xlsx-input" type="file" accept=".xlsx" class="hidden" on:change={handleFileChange} />
                {#if selectedFile}
                  <p class="font-medium text-gray-900 break-all">{selectedFile.name}</p>
                  <p class="text-xs text-gray-500 mt-1">{(selectedFile.size / 1024).toFixed(1)} Ko — cliquez pour en choisir un autre</p>
                {:else}
                  <p class="font-medium text-gray-700">Glissez-déposez votre fichier .xlsx</p>
                  <p class="text-xs text-gray-500 mt-1">ou cliquez pour parcourir (max 2 Mo)</p>
                {/if}
              </div>
            </div>

            <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <a href="/admin" class="btn-ghost sm:w-auto">Annuler</a>
              <button class="btn-primary" on:click={handleAnalyse} disabled={step === 'loading'}>
                {step === 'loading' ? 'Analyse…' : 'Analyser le fichier'}
              </button>
            </div>
          </div>
        {:else if step === 'preview' || step === 'saving'}
          <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="font-display font-bold text-2xl text-gray-900">Aperçu avant confirmation</h2>
              <p class="text-gray-500 mt-1">
                <span class="font-medium">{questionCount}</span> question{questionCount > 1 ? 's' : ''} détectée{questionCount > 1 ? 's' : ''} ·
                {#if errors.length === 0}
                  <span class="text-green-600 font-medium">0 erreur</span>
                {:else}
                  <span class="text-red-600 font-medium">{errors.length} erreur{errors.length > 1 ? 's' : ''} à corriger</span>
                {/if}
              </p>
            </div>
            <div class="text-sm text-gray-500">
              <div><span class="text-gray-400">Titre :</span> <span class="font-medium text-gray-900">{title}</span></div>
              {#if description}<div><span class="text-gray-400">Description :</span> {description}</div>{/if}
              <div><span class="text-gray-400">Visibilité :</span> {isPublic ? 'Public' : 'Privé'}</div>
            </div>
          </div>

          {#if serverError}
            <div class="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm" role="alert">{serverError}</div>
          {/if}

          {#if errors.length > 0}
            <div class="card border border-red-200 bg-red-50 mb-5">
              <div class="p-4">
                <h3 class="font-semibold text-red-800 mb-2">Erreurs détectées</h3>
                <ul class="text-sm text-red-700 space-y-1 list-disc list-inside">
                  {#each errors as e}
                    <li>
                      <span class="font-mono">Ligne {e.row}</span>
                      {#if e.field}<span class="text-red-600"> · {e.field}</span>{/if}
                      — {e.message}
                    </li>
                  {/each}
                </ul>
                <p class="text-xs text-red-600 mt-3">Corrigez votre fichier et recommencez l'import.</p>
              </div>
            </div>
          {/if}

          {#if dto && dto.questions.length > 0}
            <div class="space-y-3">
              {#each dto.questions as q, i}
                <div class="card p-4 sm:p-5">
                  <div class="flex items-start justify-between gap-3 mb-3">
                    <div class="min-w-0">
                      <div class="text-xs uppercase tracking-wide text-gray-400">Question {i + 1} / {dto.questions.length}</div>
                      <p class="font-medium text-gray-900 mt-1 break-words">{q.text}</p>
                    </div>
                    <div class="text-right text-xs text-gray-500 shrink-0">
                      <div>⏱ {q.timeLimit}s</div>
                      <div>×{q.pointsMultiplier}</div>
                    </div>
                  </div>
                  {#if q.imageUrl}
                    <p class="text-xs text-gray-500 mb-3 break-all">🖼 {q.imageUrl}</p>
                  {/if}
                  <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {#each q.options as opt}
                      <li class="flex items-center gap-2 p-2 rounded-lg border {opt.isCorrect ? 'border-green-300 bg-green-50' : 'border-gray-200'}">
                        <span class="w-3 h-3 rounded-full {colorDot(opt.colorIndex)}"></span>
                        <span class="flex-1 text-sm text-gray-800 break-words">{opt.text}</span>
                        {#if opt.isCorrect}
                          <span class="text-xs font-semibold text-green-700">✓ bonne</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          {/if}

          <div class="mt-6 sticky bottom-0 bg-gray-50/90 backdrop-blur py-3 flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button class="btn-ghost sm:w-auto" on:click={handleCancel} disabled={step === 'saving'}>Annuler</button>
            <button class="btn-secondary sm:w-auto" on:click={handleEditInBuilder} disabled={!dto || step === 'saving'}>
              Modifier dans le builder
            </button>
            <button
              class="btn-primary sm:w-auto"
              on:click={handleConfirm}
              disabled={!dto || errors.length > 0 || step === 'saving'}
              title={errors.length > 0 ? 'Corrigez les erreurs avant de confirmer' : ''}
            >
              {step === 'saving' ? 'Création…' : 'Confirmer et créer le quiz'}
            </button>
          </div>
        {/if}
      {:else}
        <p class="text-center text-gray-500">Vous devez être connecté pour importer un quiz.</p>
      {/if}
    </div>
  </main>
</div>
