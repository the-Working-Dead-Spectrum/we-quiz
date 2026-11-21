<script lang="ts">
  import { APP_NAME, PUBLISHER, PUBLISHER_TAGLINE, pageTitle } from '$lib/brand';
  import BrandLogo from '$lib/components/BrandLogo.svelte';
  import InstallButton from '$lib/components/InstallButton.svelte';

  const year = new Date().getFullYear();

  const features = [
    {
      icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
      title: "Création intuitive",
      description: "Éditeur visuel drag-and-drop, import de questions, modèles prêts à l'emploi."
    },
    {
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
      title: "Temps réel",
      description: "WebSocket natif, latence < 50ms, jusqu'à 500 joueurs par salle."
    },
    {
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
      title: "Analytics détaillées",
      description: "Classements en direct, exports CSV, rapports par question et par joueur."
    },
  ];

  const steps = [
    {
      number: 1,
      title: "Créez votre quiz",
      description: "Ajoutez questions, images, minuteurs et scores. Choisissez parmi 4 types de réponses."
    },
    {
      number: 2,
      title: "Lancez la partie",
      description: "Partagez le code PIN à 6 chiffres. Les joueurs rejoignent depuis leur mobile."
    },
    {
      number: 3,
      title: "Analysez les résultats",
      description: "Podium final, statistiques détaillées, export des réponses pour le suivi."
    },
  ];
</script>

<svelte:head>
  <title>{pageTitle()}</title>
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-primary-50/60 via-white to-white">
  <!-- Navigation -->
  <nav class="fixed top-0 inset-x-0 z-50 bg-white/85 backdrop-blur-sm border-b border-gray-100 pt-safe">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between gap-2 h-16">
        <BrandLogo size="md" />

        <div class="flex items-center gap-1 sm:gap-3">
          <a href="/public" class="btn-ghost text-sm hidden md:inline-flex">Quiz publics</a>
          <a href="/admin" class="btn-ghost text-sm hidden sm:inline-flex">Tableau de bord</a>
          <a href="/player/join" class="btn-primary text-sm px-3 sm:px-5">
            <span class="sm:hidden">Rejoindre</span>
            <span class="hidden sm:inline">Rejoindre une partie</span>
          </a>
        </div>
      </div>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20" style="padding-top: calc(6.5rem + env(safe-area-inset-top));">
    <div class="max-w-7xl mx-auto text-center">
      <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-100/70 text-primary-700 text-xs sm:text-sm font-medium mb-6 sm:mb-8 animate-fade-in">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-primary-500"></span>
        </span>
        {APP_NAME} · une solution {PUBLISHER}
      </div>

      <h1 class="font-display font-bold text-[2rem] leading-tight sm:text-5xl lg:text-6xl text-gray-950 tracking-tight mb-5 sm:mb-6 animate-slide-up text-balance">
        Des quiz interactifs qui <span class="text-primary-500">captivent</span> votre audience
      </h1>

      <p class="text-base sm:text-xl text-gray-600 max-w-3xl mx-auto mb-8 sm:mb-10 animate-slide-up" style="animation-delay: 100ms;">
        Créez des quiz en minutes, lancez-les en direct, et engagez jusqu'à 500 joueurs simultanément.
        Parfait pour la formation, l'éducation et vos événements.
      </p>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up" style="animation-delay: 200ms;">
        <a href="/admin" class="btn-primary w-full sm:w-auto text-lg px-8 py-4">
          Créer mon premier quiz
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </a>
        <a href="/player/join" class="btn-secondary w-full sm:w-auto text-lg px-8 py-4">
          Rejoindre une partie
        </a>
      </div>
      <div class="mt-4 flex justify-center animate-fade-in">
        <InstallButton class="btn-ghost text-primary-700 hover:bg-primary-50" />
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="py-14 sm:py-20 px-4 sm:px-6 lg:px-8 bg-white border-y border-gray-100">
    <div class="max-w-7xl mx-auto">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
        {#each features as feature}
          <div class="card-hover p-6 sm:p-8 text-center group">
            <div class="w-16 h-16 mx-auto mb-6 rounded-2xl bg-primary-100 flex items-center justify-center group-hover:bg-primary-500 group-hover:text-white transition-colors duration-300">
              <svg class="w-8 h-8 text-primary-600 group-hover:text-white transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={feature.icon} />
              </svg>
            </div>
            <h3 class="font-display font-semibold text-xl text-gray-900 mb-3">{feature.title}</h3>
            <p class="text-gray-600">{feature.description}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- How it works -->
  <section class="py-14 sm:py-20 px-4 sm:px-6 lg:px-8">
    <div class="max-w-7xl mx-auto">
      <div class="text-center mb-12 sm:mb-16">
        <h2 class="font-display font-bold text-3xl sm:text-4xl text-gray-900 mb-4">Comment ça marche</h2>
        <p class="text-gray-600 max-w-2xl mx-auto">Trois étapes simples pour lancer votre premier quiz interactif</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
        {#each steps as step}
          <div class="relative text-center">
            <div class="absolute left-1/2 top-0 -translate-x-1/2 w-14 h-14 rounded-full bg-primary-500 text-white flex items-center justify-center text-2xl font-bold font-display z-10">
              {step.number}
            </div>
            <div class="card p-8 pt-16">
              <h3 class="font-display font-semibold text-xl text-gray-900 mb-3">{step.title}</h3>
              <p class="text-gray-600">{step.description}</p>
            </div>
            {#if step.number < 3}
              <div class="absolute top-7 left-[50%] w-full h-1 bg-gray-200 z-0 hidden md:block" />
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="py-14 sm:py-20 px-4 sm:px-6 lg:px-8 bg-gray-950">
    <div class="max-w-4xl mx-auto text-center">
      <h2 class="font-display font-bold text-3xl sm:text-4xl text-white mb-4">Prêt à commencer ?</h2>
      <p class="text-gray-300 mb-8">Lancez votre premier {APP_NAME} en quelques minutes et engagez votre audience.</p>
      <div class="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
        <a href="/admin" class="btn w-full sm:w-auto text-lg px-8 py-4 bg-white text-gray-950 hover:bg-gray-100 focus-visible:ring-white">
          Commencer gratuitement
        </a>
        <a href="/player/join" class="btn w-full sm:w-auto text-lg px-8 py-4 border border-gray-700 text-gray-100 hover:bg-gray-800 focus-visible:ring-white">
          Essayer comme joueur
        </a>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-10 sm:py-12 px-4 sm:px-6 lg:px-8 bg-white border-t border-gray-100" style="padding-bottom: calc(2.5rem + env(safe-area-inset-bottom));">
    <div class="max-w-7xl mx-auto">
      <div class="flex flex-col md:flex-row items-center justify-between gap-5 text-center md:text-left">
        <div class="flex flex-col items-center md:items-start gap-1">
          <BrandLogo size="lg" />
        </div>
        <p class="text-gray-500 text-sm">© {year} {APP_NAME} — {PUBLISHER}. {PUBLISHER_TAGLINE}</p>
        <nav class="flex items-center gap-5 text-sm text-gray-500" aria-label="Liens">
          <a href="/public" class="hover:text-gray-800 transition-colors">Quiz publics</a>
          <a href="/player/join" class="hover:text-gray-800 transition-colors">Rejoindre</a>
          <a href="/auth/login" class="hover:text-gray-800 transition-colors">Connexion</a>
        </nav>
      </div>
    </div>
  </footer>
</div>
