import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindAutoReload } from './autoReload.js';

function createWin({ controlled = true } = {}) {
  const listeners = new Map();
  const on = (target) => (type, fn) => {
    const key = `${target}:${type}`;
    listeners.set(key, [...(listeners.get(key) || []), fn]);
  };
  const update = vi.fn();
  const win = {
    addEventListener: on('win'),
    location: { reload: vi.fn() },
    document: { hidden: false, addEventListener: on('doc') },
    navigator: {
      serviceWorker: {
        controller: controlled ? {} : null,
        addEventListener: on('sw'),
        getRegistration: vi.fn().mockResolvedValue({ update }),
      },
    },
  };
  const fire = (key) => (listeners.get(key) || []).forEach((fn) => fn());
  return { win, fire, update };
}

describe('bindAutoReload', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ignores the first install of the service worker', () => {
    const { win, fire } = createWin({ controlled: false });
    bindAutoReload(() => false, win);
    fire('sw:controllerchange');
    vi.advanceTimersByTime(10000);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('waits for the user to be idle and not busy before reloading', () => {
    const { win, fire } = createWin();
    let busy = true;
    bindAutoReload(() => busy, win);
    fire('win:pointerdown');
    fire('sw:controllerchange');
    vi.advanceTimersByTime(5000);
    expect(win.location.reload).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(1000);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads straight away when the page is hidden', () => {
    const { win, fire } = createWin();
    bindAutoReload(() => true, win);
    fire('sw:controllerchange');
    expect(win.location.reload).not.toHaveBeenCalled();

    win.document.hidden = true;
    fire('doc:visibilitychange');
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('checks for an update when the page becomes visible', async () => {
    const { win, fire, update } = createWin();
    bindAutoReload(() => false, win);
    fire('doc:visibilitychange');
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
  });
});
