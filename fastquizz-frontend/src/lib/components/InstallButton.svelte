<script lang="ts">
  // "Installer l'app" button: native prompt on Chromium, instructions banner elsewhere.
  // Renders nothing when the app is already installed or not installable here.
  import { installMode, requestInstall } from '$lib/pwa';

  /** Extra classes (button style). */
  let className = 'btn-secondary';
  export { className as class };
  export let label = "Installer l'app";
</script>

{#if $installMode !== null}
  <button type="button" class={className} on:click={requestInstall}>
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
    </svg>
    {label}
  </button>
{/if}
