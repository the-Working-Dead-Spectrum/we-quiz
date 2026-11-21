<script lang="ts">
  import { getColorConfig } from '$lib/types';
  import type { CreateQuestionDto } from '$lib/types';

  export let question: CreateQuestionDto;
  export let index: number;
  export let total: number;
  export let onUpdateText: (text: string) => void;
  export let onUpdateImage: (url: string) => void;
  export let onUpdateTimeLimit: (time: number) => void;
  export let onUpdatePoints: (points: number) => void;
  export let onUpdateOptionText: (optIndex: number, text: string) => void;
  export let onSetCorrect: (optIndex: number) => void;
  export let onDuplicate: () => void;
  export let onDelete: () => void;
  export let onReorder: (dir: number) => void;

  const colorConfig = [
    { index: 0, name: 'red', label: 'Triangle', shape: 'triangle' },
    { index: 1, name: 'blue', label: 'Losange', shape: 'diamond' },
    { index: 2, name: 'yellow', label: 'Cercle', shape: 'circle' },
    { index: 3, name: 'green', label: 'Carré', shape: 'square' },
  ];

  function getShapeSvg(shape: string, color: string) {
    switch (shape) {
      case 'triangle':
        return `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5"><path d="M12 2L2 22h20L12 2z"/></svg>`;
      case 'diamond':
        return `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="${color}"><path d="M12 2L22 12L12 22L2 12Z"/></svg>`;
      case 'circle':
        return `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="${color}"><circle cx="12" cy="12" r="9"/></svg>`;
      case 'square':
        return `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="${color}"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
      default:
        return '';
    }
  }

  // Helper to get color config by index (avoids 'as 0|1|2|3' in template)
  function getConfig(index: number) {
    return getColorConfig(index as 0 | 1 | 2 | 3);
  }

  // Event handler helpers to avoid type casts in template
  function handleTextInput(e: Event) {
    onUpdateText((e.target as HTMLTextAreaElement).value);
  }
  function handleImageInput(e: Event) {
    onUpdateImage((e.target as HTMLInputElement).value);
  }
  function handleTimeInput(e: Event) {
    onUpdateTimeLimit(Number((e.target as HTMLInputElement).value));
  }
  function handlePointsChange(e: Event) {
    onUpdatePoints(Number((e.target as HTMLSelectElement).value));
  }
  function handleOptionInput(optIndex: number, e: Event) {
    onUpdateOptionText(optIndex, (e.target as HTMLInputElement).value);
  }

  // Local state for image URL visibility (checkbox expects boolean)
  let showImageUrl = !!question.imageUrl;
  $: showImageUrl = !!question.imageUrl;
  function toggleImageUrl(checked: boolean) {
    if (!checked) {
      onUpdateImage('');
    }
  }

  function handleImageToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    toggleImageUrl(checked);
  }
</script>

<div class="card overflow-hidden">
  <!-- Question Header -->
  <div class="p-4 border-b border-gray-100 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-sm font-medium text-gray-500">Question {index + 1} / {total}</span>
      <div class="flex items-center gap-1">
        {#each question.options as option, optIndex}
          {#if option.text}
            <span
              class="w-6 h-6 rounded-lg flex items-center justify-center {getConfig(optIndex).bg} {option.isCorrect ? 'ring-2 ring-offset-2 ring-offset-white shadow-sm' : ''}"
              title={colorConfig[optIndex].label}
            >
              {@html getShapeSvg(colorConfig[optIndex].shape, 'white')}
            </span>
          {:else}
            <span class="w-6 h-6 rounded-lg bg-gray-100" />
          {/if}
        {/each}
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button
        on:click={onDuplicate}
        class="btn-ghost p-2"
        title="Dupliquer"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </button>
      {#if index > 0}
        <button on:click={() => onReorder(-1)} class="btn-ghost p-2" title="Monter">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      {/if}
      {#if index < total - 1}
        <button on:click={() => onReorder(1)} class="btn-ghost p-2" title="Descendre">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V4" />
          </svg>
        </button>
      {/if}
      <button
        on:click={onDelete}
        class="btn-ghost p-2 text-red-600 hover:bg-red-50"
        title="Supprimer"
        disabled={total <= 1}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Question Content -->
  <div class="p-6 space-y-6">
    <!-- Question Text -->
    <div>
      <label for="question-text" class="label">Texte de la question *</label>
      <textarea
        id="question-text"
        bind:value={question.text}
        on:input={handleTextInput}
        placeholder="Ex: Quelle est la capitale de la France ?"
        class="input min-h-[100px] resize-y font-medium text-lg"
        maxlength="500"
        rows="3"
      ></textarea>
      <div class="flex items-center justify-between mt-1">
        <span class="text-sm text-gray-500">{question.text.length}/500</span>
        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" bind:checked={showImageUrl} on:change={handleImageToggle} class="rounded border-gray-300" />
          Ajouter une image
        </label>
      </div>
      {#if showImageUrl}
        <input
          bind:value={question.imageUrl}
          on:input={handleImageInput}
          placeholder="URL de l'image (https://...)"
          class="input mt-2"
        />
      {/if}
    </div>

    <!-- Settings Row -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label for="time-limit" class="label">Temps limite (secondes) *</label>
        <input
          id="time-limit"
          type="number"
          bind:value={question.timeLimit}
          on:input={handleTimeInput}
          min="5"
          max="120"
          step="5"
          class="input"
        />
        <p class="text-sm text-gray-500 mt-1">Entre 5 et 120 secondes</p>
      </div>
      <div>
        <label for="points-multiplier" class="label">Multiplicateur de points *</label>
        <select
          id="points-multiplier"
          bind:value={question.pointsMultiplier}
          on:change={handlePointsChange}
          class="input"
        >
          <option value="0.5">0.5x (Moins de points)</option>
          <option value="1">1x (Standard)</option>
          <option value="1.5">1.5x (Plus de points)</option>
          <option value="2">2x (Double points)</option>
        </select>
        <p class="text-sm text-gray-500 mt-1">Ajuste le score maximum (base: 1000 pts)</p>
      </div>
    </div>

    <!-- Options -->
    <div>
      <h3 class="label">Réponses (exactement une correcte) *</h3>
      <div class="space-y-3">
        {#each question.options as option, optIndex}
          <div class="flex items-center gap-3">
            <!-- Color/Shape Indicator -->
            <div class="flex-shrink-0 w-12 h-12 rounded-xl {getConfig(optIndex).bg} flex items-center justify-center {option.isCorrect ? 'ring-2 ring-offset-2 ring-offset-white shadow' : ''}">
              {@html getShapeSvg(colorConfig[optIndex].shape, 'white')}
            </div>

            <!-- Option Input -->
            <div class="flex-1 relative">
              <input
                type="text"
                bind:value={option.text}
                on:input={(e) => handleOptionInput(optIndex, e)}
                placeholder={`Réponse ${optIndex + 1}`}
                class="input pr-12"
                maxlength="100"
              />
              <button
                type="button"
                on:click={() => onSetCorrect(optIndex)}
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors {option.isCorrect ? 'bg-green-100 text-green-600' : 'text-gray-400 hover:bg-gray-100'}"
                aria-label={option.isCorrect ? 'Bonne réponse sélectionnée' : 'Définir comme bonne réponse'}
              >
                {#if option.isCorrect}
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                {:else}
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>

      <div class="mt-3 p-3 bg-gray-50 rounded-lg">
        <p class="text-sm text-gray-600">
          <strong>Codes couleurs :</strong>
          Rouge = Triangle · Bleu = Losange · Jaune = Cercle · Vert = Carré
        </p>
      </div>
    </div>
  </div>
</div>