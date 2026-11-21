// Single source of truth for user-facing brand strings.
export const APP_NAME = 'weQuiz';
export const PUBLISHER = 'We.info';
export const PUBLISHER_TAGLINE = 'La tech, ensemble.';
export const APP_DESCRIPTION = 'Quiz interactifs en temps réel : créez, lancez et jouez depuis n’importe quel écran.';

/** `<title>` helper: "Lobby · weQuiz". */
export function pageTitle(page?: string): string {
  return page ? `${page} · ${APP_NAME}` : `${APP_NAME} · Quiz interactifs en temps réel`;
}
