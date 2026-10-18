import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Capture the browser's prompt before React mounts, including on cached visits.
let state: { prompt: InstallPrompt | null; error: boolean } = { prompt: null, error: false };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const standalone = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
};

window.addEventListener('beforeinstallprompt', (event) => {
  if (standalone()) return;
  event.preventDefault();
  state = { prompt: event as InstallPrompt, error: false };
  notify();
});
window.addEventListener('appinstalled', () => {
  state = { prompt: null, error: false };
  notify();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getState = () => state;
const serverState: typeof state = { prompt: null, error: false };
const getServerState = () => serverState;

export function InstallApp() {
  const { prompt, error } = useSyncExternalStore(subscribe, getState, getServerState);

  async function install() {
    if (!prompt || state.prompt !== prompt) return;
    // Each browser event can only be used once, even if installation is declined.
    const attempt = { prompt: null, error: false };
    state = attempt;
    notify();
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      if (state === attempt) {
        state = { prompt: null, error: true };
        notify();
      }
    }
  }

  if (standalone() || (!prompt && !error)) return null;
  return <div className="install-offer">
    {prompt ? <>
      <span>Keep your local forecast handy.</span>
      <button type="button" onClick={install}>Install weather app</button>
    </> : <p role="status">Installation couldn’t start. Refresh this page and try again.</p>}
  </div>;
}
