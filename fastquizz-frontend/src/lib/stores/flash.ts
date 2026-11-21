// One-shot message carried across a client-side navigation (e.g. a fatal game error that sends
// the user back to /admin or /player/join). Kept in memory only: a full page reload drops it.

import { writable, get } from 'svelte/store';

const message = writable<string | null>(null);

export const flashMessage = {
  subscribe: message.subscribe,
  set(value: string): void {
    message.set(value);
  },
  /** Returns the pending message (if any) and clears it. */
  consume(): string | null {
    const value = get(message);
    message.set(null);
    return value;
  },
};
