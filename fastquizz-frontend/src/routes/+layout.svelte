<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores';

  // Initialize auth on mount
  onMount(() => {
    // Auth store initializes itself
  });
</script>

<div class="min-h-screen">
  <slot />
</div>