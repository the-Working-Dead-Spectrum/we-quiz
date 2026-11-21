<script lang="ts">
  // Install banner (bottom sheet). Platform logic lives in $lib/pwa.
  // Shown automatically once (then snoozed 14 days when dismissed), or on demand via an
  // "Installer l'app" button. Never shown during a live game (`suppressed`).
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { APP_NAME } from '$lib/brand';
  import { initInstall, installMode, installHelpRequested, iosNonSafari, requestInstall } from '$lib/pwa';
  import BrandLogo from './BrandLogo.svelte';

  export let suppressed = false;

  const DISMISS_KEY = 'wequiz_install_dismissed_at';
  const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;
  const SHOW_DELAY_MS = 2500;

  let ready = false;
  let snoozed = false;

  $: autoVisible = ready && !snoozed;
  $: visible = !suppressed && $installMode !== null && (autoVisible || $installHelpRequested);

  function recentlyDismissed(): boolean {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return at > 0 && Date.now() - at < DISMISS_FOR_MS;
    } catch {
      return false;
    }
  }

  function dismiss() {
    snoozed = true;
    installHelpRequested.set(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable (private mode): snoozed for this page only */
    }
  }

  async function install() {
    const outcome = await requestInstall();
    if (outcome === 'dismissed') dismiss();
  }

  onMount(() => {
    snoozed = recentlyDismissed();
    const cleanup = initInstall();
    const timer = setTimeout(() => (ready = true), SHOW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  });
</script>

{#if visible}
  <div
    class="fixed inset-x-0 bottom-0 z-[60] px-3 pointer-events-none"
    style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
    transition:fly={{ y: 80, duration: 250 }}
  >
    <div
      class="pointer-events-auto mx-auto max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 p-4"
      role="dialog"
      aria-labelledby="install-title"
      aria-describedby="install-desc"
    >
      <div class="flex items-start gap-3">
        <div class="rounded-xl bg-primary-50 p-1.5">
          <BrandLogo size="sm" markOnly href={null} />
        </div>
        <div class="flex-1 min-w-0">
          <p id="install-title" class="font-display font-semibold text-gray-950">Installer {APP_NAME}</p>
          {#if $installMode === 'native'}
            <p id="install-desc" class="text-sm text-gray-600 mt-0.5">
              Accès en un geste depuis l'écran d'accueil, en plein écran.
            </p>
          {:else if $installMode === 'ios'}
            <ol id="install-desc" class="text-sm text-gray-600 mt-1 space-y-1">
              <li class="flex items-center gap-1.5 flex-wrap">
                1. Touchez
                <span class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 font-medium text-gray-800">
                  <svg class="w-4 h-4 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0-12L8 7m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
                  </svg>
                  Partager
                </span>
              </li>
              <li class="flex items-center gap-1.5 flex-wrap">
                2. Choisissez
                <span class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 font-medium text-gray-800">
                  <svg class="w-4 h-4 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
                    <path stroke-linecap="round" d="M12 8v8M8 12h8" />
                  </svg>
                  Sur l'écran d'accueil
                </span>
              </li>
              {#if $iosNonSafari}
                <li class="text-xs text-gray-500">Option absente ? Ouvrez cette page dans Safari.</li>
              {/if}
            </ol>
          {:else}
            <ol id="install-desc" class="text-sm text-gray-600 mt-1 space-y-1">
              <li class="flex items-center gap-1.5 flex-wrap">
                1. Ouvrez le menu
                <span class="inline-flex items-center justify-center rounded-md bg-gray-100 w-7 h-6 font-bold text-gray-800" aria-label="menu">⋮</span>
                du navigateur
              </li>
              <li>2. Touchez <strong class="text-gray-800">« Installer l'application »</strong> ou <strong class="text-gray-800">« Ajouter à l'écran d'accueil »</strong></li>
            </ol>
          {/if}
        </div>
        <button class="btn-icon btn-ghost -mr-2 -mt-2 text-gray-400" on:click={dismiss} aria-label="Fermer">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {#if $installMode === 'native'}
        <div class="mt-3 flex gap-2">
          <button class="btn-primary flex-1" on:click={install}>Installer</button>
          <button class="btn-ghost" on:click={dismiss}>Plus tard</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
