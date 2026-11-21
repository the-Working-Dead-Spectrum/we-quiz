<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import InstallPrompt from '$lib/components/InstallPrompt.svelte';

  // Never interrupt a live game or a lobby with the install banner.
  const FOCUS_ROUTES = ['/player/game', '/admin/live', '/admin/lobby'];
  $: inFocusRoute = FOCUS_ROUTES.some((route) => $page.url.pathname.startsWith(route));
</script>

<div class="min-h-dvh">
  <slot />
</div>

<InstallPrompt suppressed={inFocusRoute} />
