<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { flashMessage, getStoredPlayerSession } from '$lib/stores';
  import { getColorConfig, getShapeSvg } from '$lib/types';
  import { pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';
  import InstallButton from '$lib/components/InstallButton.svelte';

  // ADR 0001 §2: pin format ^[A-Z0-9]{6,8}$. 6 boxes by default; an 8-char pin (rare fallback)
  // arrives through ?code= and then gets 8 boxes.
  const DEFAULT_CODE_LENGTH = 6;
  const MAX_CODE_LENGTH = 8;
  const PIN_PATTERN = /^[A-Z0-9]{6,8}$/;
  // eslint-disable-next-line no-control-regex
  const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

  let codeInputs: HTMLInputElement[] = [];
  let chars: string[] = Array(DEFAULT_CODE_LENGTH).fill('');
  let nickname = '';
  let formError: string | null = null;
  let submitting = false;

  $: code = chars.join('');
  $: canSubmit = PIN_PATTERN.test(code) && nickname.trim().length > 0 && !submitting;

  function sanitize(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function setCode(value: string) {
    const clean = sanitize(value).slice(0, MAX_CODE_LENGTH);
    const length = Math.max(DEFAULT_CODE_LENGTH, clean.length);
    chars = Array.from({ length }, (_, i) => clean[i] ?? '');
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = sanitize(params.get('code') || '');

    // Resume an existing session only if it is complete and not for another game.
    const session = getStoredPlayerSession();
    if (session && (!urlCode || urlCode === session.pin)) {
      goto('/player/game', { replaceState: true });
      return;
    }

    // Message from a refused join / fatal game error (ADR 0001 §9).
    formError = flashMessage.consume();

    if (urlCode) {
      setCode(urlCode);
    }
    const urlNickname = params.get('nickname');
    if (urlNickname) {
      nickname = urlNickname.slice(0, 20);
    }

    if (!urlCode) {
      tick().then(() => codeInputs[0]?.focus());
    }
  });

  // Single submit path: the form's submit event (Enter in any field or the button click).
  function handleJoin() {
    if (submitting) return;
    formError = null;

    const codeValue = code.trim().toUpperCase();
    const nicknameValue = nickname.trim();

    if (!PIN_PATTERN.test(codeValue)) {
      formError = 'Le code doit contenir 6 à 8 caractères (lettres et chiffres).';
      return;
    }
    if (nicknameValue.length < 1 || nicknameValue.length > 20) {
      formError = 'Le pseudo doit contenir entre 1 et 20 caractères.';
      return;
    }
    if (CONTROL_CHARS.test(nicknameValue)) {
      formError = 'Le pseudo contient des caractères non autorisés.';
      return;
    }

    submitting = true;
    // The game page performs player:join, then removes these params from the URL.
    goto(`/player/game?code=${encodeURIComponent(codeValue)}&nickname=${encodeURIComponent(nicknameValue)}`);
  }

  function handleCodeInput(e: Event, index: number) {
    const input = e.currentTarget as HTMLInputElement;
    const value = sanitize(input.value);
    chars[index] = value.slice(-1);
    // Keep the box in sync even when the sanitized value did not change (e.g. "-" typed).
    input.value = chars[index];
    chars = chars;
    if (chars[index]) {
      codeInputs[index + 1]?.focus();
    }
  }

  function handleCodePaste(e: ClipboardEvent, index: number) {
    const pasted = sanitize(e.clipboardData?.getData('text') ?? '');
    if (!pasted) return;
    e.preventDefault();
    const next = [...chars];
    for (let i = 0; i < pasted.length && index + i < MAX_CODE_LENGTH; i++) {
      next[index + i] = pasted[i];
    }
    setCode(next.join(''));
    const last = Math.min(index + pasted.length, chars.length - 1);
    tick().then(() => codeInputs[last]?.focus());
  }

  function handleCodeKeydown(e: KeyboardEvent, index: number) {
    if (e.key === 'Backspace' && !chars[index] && index > 0) {
      e.preventDefault();
      chars[index - 1] = '';
      chars = chars;
      codeInputs[index - 1]?.focus();
    }
  }

  function selectOnFocus(e: FocusEvent) {
    (e.currentTarget as HTMLInputElement).select();
  }
</script>

<svelte:head>
  <title>{pageTitle('Rejoindre une partie')}</title>
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-primary-50/60 to-white">
  {#if formError}
    <div class="fixed top-0 inset-x-0 z-50 bg-red-500 text-white text-center px-3 py-2 text-sm animate-slide-down pt-safe" role="alert">
      {formError}
    </div>
  {/if}

  <main class="min-h-dvh flex items-center justify-center px-4 py-10" style="padding-top: max(2.5rem, env(safe-area-inset-top)); padding-bottom: max(2.5rem, env(safe-area-inset-bottom));">
    <div class="w-full max-w-md animate-fade-in">
      <!-- Logo -->
      <div class="text-center mb-8 sm:mb-10">
        <BrandLogo size="lg" class="mb-6" />
        <h1 class="font-display font-bold text-2xl sm:text-3xl text-gray-950 mb-2">Rejoindre une partie</h1>
        <p class="text-gray-500">Entrez le code salon affiché sur l'écran</p>
      </div>

      <form on:submit|preventDefault={handleJoin} class="space-y-5 sm:space-y-6" novalidate>
        <div class="card p-4 sm:p-6">
          <label class="label text-center block mb-4" for="code-input-0">Code salon</label>

          <!-- One box per character (6 by default, 8 when an 8-char code comes from the link).
               Boxes share the available width so 8 boxes still fit on a 320px screen. -->
          <div class="flex items-center justify-center gap-1.5 sm:gap-3 mb-6" role="group" aria-label="Code salon">
            {#each chars as char, i}
              <input
                id={`code-input-${i}`}
                type="text"
                class="flex-1 min-w-0 max-w-[3.5rem] h-12 sm:h-14 text-center text-xl min-[400px]:text-2xl sm:text-3xl font-bold uppercase bg-white border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                maxlength="1"
                autocomplete="off"
                autocapitalize="characters"
                inputmode="text"
                aria-label={`Caractère ${i + 1} du code`}
                value={char}
                on:input={(e) => handleCodeInput(e, i)}
                on:keydown={(e) => handleCodeKeydown(e, i)}
                on:paste={(e) => handleCodePaste(e, i)}
                on:focus={selectOnFocus}
                bind:this={codeInputs[i]}
              />
            {/each}
          </div>

          <!-- Nickname -->
          <div class="mt-6">
            <label class="label" for="nickname">Votre pseudo</label>
            <input
              id="nickname"
              bind:value={nickname}
              type="text"
              placeholder="Votre pseudo..."
              class="input text-lg"
              maxlength="20"
              autocomplete="nickname"
              required
            />
            <p class="text-sm text-gray-500 mt-1 text-right">{nickname.length}/20</p>
          </div>
        </div>

        <!-- Join Button -->
        <button
          type="submit"
          class="btn-primary w-full py-4 text-lg"
          disabled={!canSubmit}
        >
          Rejoindre la partie
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </button>

        <!-- Color legend -->
        <div class="card p-4 bg-gray-50">
          <p class="text-sm text-gray-600 text-center mb-3">Les réponses apparaissent sous forme de :</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {#each [0, 1, 2, 3] as idx}
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-9 h-9 shrink-0 rounded-xl {getColorConfig(idx).bg} {getColorConfig(idx).text} flex items-center justify-center">
                  {@html getShapeSvg(idx, 'w-5 h-5')}
                </div>
                <span class="text-sm font-medium text-gray-700 truncate">{getColorConfig(idx).label}</span>
              </div>
            {/each}
          </div>
        </div>
      </form>

      <!-- Footer -->
      <div class="mt-6 flex justify-center">
        <InstallButton class="btn-ghost text-primary-700 hover:bg-primary-50 text-sm" />
      </div>
      <p class="text-center text-gray-400 text-sm mt-4">
        <a href="/" class="hover:text-primary-500 transition-colors">← Retour à l'accueil</a>
      </p>
    </div>
  </main>
</div>