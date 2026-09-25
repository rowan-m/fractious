const IDLE_MS = 3000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown'];

// When a new service worker takes control, the open page keeps running the old
// code until it is reloaded. The URL holds the whole view, so reload onto the new
// version as soon as the page is hidden, or once the user has been idle for a moment.
export function bindAutoReload(isBusy, win = window) {
  const sw = win.navigator.serviceWorker;
  // An uncontrolled page is a first install: there is no stale version to replace.
  if (!sw?.controller) return;

  const doc = win.document;
  let lastInput = Date.now();
  let timer;
  const onInput = () => (lastInput = Date.now());
  for (const type of INPUT_EVENTS) {
    win.addEventListener(type, onInput, { passive: true });
  }

  const tryReload = () => {
    if (doc.hidden || (!isBusy() && Date.now() - lastInput >= IDLE_MS)) {
      win.location.reload();
    } else {
      timer = setTimeout(tryReload, 1000);
    }
  };

  sw.addEventListener('controllerchange', () => timer || tryReload());
  // Installed apps can stay open for days, so check for updates on resume too.
  doc.addEventListener('visibilitychange', () => {
    if (timer && doc.hidden) return tryReload();
    if (!doc.hidden) {
      sw.getRegistration()
        .then((reg) => reg?.update())
        .catch(() => {});
    }
  });
}
