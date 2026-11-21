<script lang="ts">
  // Brand logo.
  // - Full logo: the official We.info image (src/logo-weinfo.png, variants in $lib/assets):
  //   compact (no tagline) for small sizes, full (with "La tech, ensemble.") for large ones,
  //   and a "dark" variant where the navy ink turns white for dark backgrounds.
  // - markOnly: the square app mark (magnifier + "?"), same as the PWA icon, for tight spots.
  import { APP_NAME, PUBLISHER } from '$lib/brand';
  import logoFull from '$lib/assets/logo-weinfo.png';
  import logoFullDark from '$lib/assets/logo-weinfo-dark.png';
  import logoCompact from '$lib/assets/logo-weinfo-compact.png';
  import logoCompactDark from '$lib/assets/logo-weinfo-compact-dark.png';

  /** Visual size. `sm`/`md` drop the tagline so it stays legible. */
  export let size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  /** `dark` = on a dark background (navy ink turns white). */
  export let tone: 'light' | 'dark' = 'light';
  /** Show the square app mark only (an accessible name is kept). */
  export let markOnly = false;
  /** Optional link target; renders a plain element when null. */
  export let href: string | null = '/';

  const MARK = { sm: 'w-8 h-8', md: 'w-9 h-9', lg: 'w-14 h-14', xl: 'w-20 h-20' } as const;
  const LOGO_HEIGHT = { sm: 'h-7', md: 'h-8 sm:h-9', lg: 'h-14 sm:h-16', xl: 'h-16 sm:h-20' } as const;

  $: compact = size === 'sm' || size === 'md';
  $: src = compact ? (tone === 'dark' ? logoCompactDark : logoCompact) : tone === 'dark' ? logoFullDark : logoFull;
  // Intrinsic ratios of the generated assets (avoid layout shift).
  $: ratio = compact ? 837 / 273 : 854 / 273;

  $: inkClass = tone === 'dark' ? 'text-white' : 'text-gray-950';
  $: blueClass = tone === 'dark' ? 'text-primary-400' : 'text-primary-500';
</script>

<svelte:element
  this={href ? 'a' : 'span'}
  href={href ?? undefined}
  class="inline-flex items-center shrink-0 {$$props.class ?? ''}"
  aria-label={href ? `${APP_NAME} — accueil` : undefined}
>
  {#if markOnly}
    <svg class="{MARK[size]} shrink-0" viewBox="0 0 48 48" fill="none" role="img" aria-label={APP_NAME} focusable="false">
      <circle cx="28" cy="20" r="14.5" stroke="currentColor" class={blueClass} stroke-width="5" />
      <path d="M17.6 30.4 6.5 41.5" stroke="currentColor" class={blueClass} stroke-width="6" stroke-linecap="round" />
      <path
        d="M23.4 16.2a4.6 4.6 0 1 1 6.9 4c-1.5.9-2.3 1.8-2.3 3.4v.6"
        stroke="currentColor"
        class={inkClass}
        stroke-width="3.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="28" cy="28.6" r="2.1" fill="currentColor" class={inkClass} />
    </svg>
  {:else}
    <img
      {src}
      alt={PUBLISHER}
      class="{LOGO_HEIGHT[size]} w-auto select-none"
      style="aspect-ratio: {ratio};"
      draggable="false"
      decoding="async"
    />
  {/if}
</svelte:element>
