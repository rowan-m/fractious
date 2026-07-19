import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fractious } from './Fractious.js';

vi.mock('../wasm/pkg/fractious_lib.js', () => ({
  default: vi.fn(),
  init_hooks: vi.fn(),
  sub_coord: vi.fn(),
}));

describe('Fractious URL parsing', () => {
  let fractious;
  let config;
  let state;

  beforeEach(() => {
    config = {
      centerX: '-1.7',
      centerY: '0.0',
    };
    state = {
      refX: '-1.7',
      refY: '0.0',
    };

    // Mock window using vi.stubGlobal
    vi.stubGlobal('window', { location: { search: '' } });

    fractious = new Fractious(config, state, {}, {}, {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse URL parameters correctly', () => {
    window.location.search = '?x=-0.5&y=0.5';
    fractious.parseURL();

    expect(config.centerX).toBe('-0.5');
    expect(config.centerY).toBe('0.5');
    expect(state.refX).toBe('-0.5');
    expect(state.refY).toBe('0.5');
  });

  it('should handle missing URL parameters gracefully', () => {
    window.location.search = '';
    fractious.parseURL();

    expect(config.centerX).toBe('-1.7'); // defaults
    expect(config.centerY).toBe('0.0');
  });

  it('should handle some parameters present and others missing', () => {
    window.location.search = '?x=1.5';
    fractious.parseURL();

    expect(config.centerX).toBe('1.5');
    expect(config.centerY).toBe('0.0'); // default
  });

  it('should update URL parameters correctly', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      history: { replaceState: vi.fn() },
    });

    config.centerX = '2.0';
    config.centerY = '1.0';
    config.zoom = 0.01;
    config.rotation = Math.PI;
    config.hue = 0.5;
    config.hueStep = 0.1;

    fractious.updateURL();

    expect(window.history.replaceState).toHaveBeenCalledWith(
      {},
      '',
      '?x=2.0&y=1.0&z=2.000&r=3.142&h=0.500&s=0.100'
    );
  });
});

describe('Fractious interaction debouncing', () => {
  let fractious;
  let config;
  let state;
  let renderer;
  let workerManager;
  let interactionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(cb => setTimeout(cb, 16)));

    config = {
      centerX: '0.0',
      centerY: '0.0',
      zoom: 1.0,
      iter: 1000,
    };
    state = {
      isPendingUpdate: false,
      workerBusy: false,
    };
    renderer = {
      init: vi.fn(),
      render: vi.fn(),
    };
    workerManager = {
      init: vi.fn(),
      updateReference: vi.fn(),
    };
    interactionManager = {
      updateUI: vi.fn(),
      el: {
        canvas: {
          width: 800,
          height: 600,
        },
      },
    };

    fractious = new Fractious(config, state, renderer, workerManager, interactionManager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call updateReference immediately when needsNewReference is true', () => {
    fractious.interact(true);

    expect(workerManager.updateReference).toHaveBeenCalledTimes(1);
    expect(state.isPendingUpdate).toBe(true);
  });

  it('should debounce updateReference when needsNewReference is false', () => {
    fractious.interact(false);

    // Should not call updateReference immediately
    expect(workerManager.updateReference).not.toHaveBeenCalled();
    expect(state.isPendingUpdate).toBe(true);

    // Call again to verify reset of timeout (coalescing)
    vi.advanceTimersByTime(100);
    fractious.interact(false);

    vi.advanceTimersByTime(150);
    // Still shouldn't be called because the timer was reset
    expect(workerManager.updateReference).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    // Now it should be called exactly once
    expect(workerManager.updateReference).toHaveBeenCalledTimes(1);
  });
});
