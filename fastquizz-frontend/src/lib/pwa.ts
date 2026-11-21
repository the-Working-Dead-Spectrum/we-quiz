// PWA install state shared by the install banner and the "Installer l'app" buttons.
//
// Platforms:
// - Chromium (Android Chrome/Edge/Samsung Internet/Opera, desktop Chrome/Edge): native prompt via
//   `beforeinstallprompt`. The event often fires before the app mounts, so app.html captures it
//   early into `window.__wqInstallEvent`; we pick it up here.
// - Android without the event (Firefox, prompt cooldown after a dismissal, criteria not met yet):
//   instructions through the browser menu.
// - iOS / iPadOS (Safari; Chrome/Edge since iOS 16.4): no install API, "Share → Add to Home Screen".
import { writable } from 'svelte/store';

export type InstallMode = 'native' | 'ios' | 'android-menu' | null;

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __wqInstallEvent?: BeforeInstallPromptEvent | null;
  }
}

/** How the app can be installed here; null = not installable or already installed. */
export const installMode = writable<InstallMode>(null);
/** Set by an explicit "Installer l'app" click: shows the help banner even if it was dismissed. */
export const installHelpRequested = writable(false);
/** True when the iOS browser is not Safari (Add to Home Screen may be missing). */
export const iosNonSafari = writable(false);

const ANDROID_FALLBACK_DELAY_MS = 3500;

let deferred: BeforeInstallPromptEvent | null = null;
let initialized = false;

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Idempotent; call once from the root layout. Returns a cleanup function. */
export function initInstall(): () => void {
  if (initialized || isStandalone()) return () => {};
  initialized = true;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  const useEvent = (e: BeforeInstallPromptEvent) => {
    deferred = e;
    window.__wqInstallEvent = null;
    installMode.set('native');
  };

  // Event captured before the app mounted (see app.html).
  if (window.__wqInstallEvent) useEvent(window.__wqInstallEvent);

  const onBeforeInstall = (e: Event) => {
    e.preventDefault();
    useEvent(e as BeforeInstallPromptEvent);
  };
  const onInstalled = () => {
    deferred = null;
    installMode.set(null);
    installHelpRequested.set(false);
  };
  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onInstalled);

  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  if (isIOS) {
    iosNonSafari.set(/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua));
    installMode.set('ios');
  } else if (isAndroid && !deferred) {
    // No native prompt (yet): offer the browser-menu path, upgraded if the event arrives later.
    fallbackTimer = setTimeout(() => {
      if (!deferred) installMode.set('android-menu');
    }, ANDROID_FALLBACK_DELAY_MS);
  }

  return () => {
    clearTimeout(fallbackTimer);
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/** Native prompt when available; otherwise opens the instructions banner. */
export async function requestInstall(): Promise<'accepted' | 'dismissed' | 'instructions'> {
  if (!deferred) {
    installHelpRequested.set(true);
    return 'instructions';
  }
  const event = deferred;
  deferred = null; // a prompt can only be shown once per event
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') {
    installMode.set(null);
  } else if (/Android/i.test(navigator.userAgent)) {
    // Chrome will not re-fire the event soon: keep a manual path available.
    installMode.set('android-menu');
  } else {
    installMode.set(null);
  }
  return outcome;
}
