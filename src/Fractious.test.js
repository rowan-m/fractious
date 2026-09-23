import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fractious } from './Fractious.js';

vi.mock('../wasm/pkg/fractious_lib.js', () => ({
  default: vi.fn(),
  init_hooks: vi.fn(),
  sub_coord: vi.fn(),
  add_coord: vi.fn((val) => val),
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
      '?x=2.0&y=1.0&z=2.000&r=180.0&h=0.500&s=0.100',
    );
  });

  it('should parse URL rotation parameter in degrees and convert to radians', () => {
    window.location.search = '?r=90';
    fractious.parseURL();

    expect(config.rotation).toBeCloseTo(Math.PI / 2, 6);
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
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb) => setTimeout(cb, 16)),
    );
    vi.stubGlobal('window', {
      location: { search: '' },
      history: { replaceState: vi.fn() },
    });

    config = {
      centerX: '0.0',
      centerY: '0.0',
      zoom: 1.0,
      rotation: 0.0,
      hue: 0.6,
      hueStep: 1.0,
      iter: 1000,
    };
    state = {
      refX: '0.0',
      refY: '0.0',
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
      setPinVisible: vi.fn(),
      el: {
        canvas: {
          width: 800,
          height: 600,
        },
      },
    };

    fractious = new Fractious(
      config,
      state,
      renderer,
      workerManager,
      interactionManager,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should call updateReference immediately when needsNewReference is true', () => {
    fractious.interact(true);

    expect(workerManager.updateReference).toHaveBeenCalledTimes(1);
    expect(state.isPendingUpdate).toBe(true);
  });

  it('should debounce updateReference and show/hide center pin when needsNewReference is false and view moved', () => {
    fractious.interact(false);

    // Should show pin immediately and not call updateReference yet
    expect(interactionManager.setPinVisible).toHaveBeenLastCalledWith(true);
    expect(workerManager.updateReference).not.toHaveBeenCalled();
    expect(state.isPendingUpdate).toBe(true);

    // Call again to verify reset of timeout (coalescing) and pin stays visible
    vi.advanceTimersByTime(100);
    fractious.interact(false);
    expect(interactionManager.setPinVisible).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(150);
    // Still shouldn't be called because the timer was reset
    expect(workerManager.updateReference).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    // Now it should hide the pin and call updateReference exactly once
    expect(interactionManager.setPinVisible).toHaveBeenLastCalledWith(false);
    expect(workerManager.updateReference).toHaveBeenCalledTimes(1);
  });

  it('should render a 200ms low-res preview and then upgrade to full-res without worker recalc when coordinates/zoom are unchanged', () => {
    state.offsetX = -0.25;
    state.offsetY = 0.1;
    state.targetZoom = 1.0;
    fractious._lastRefOffsetX = -0.25;
    fractious._lastRefOffsetY = 0.1;
    fractious._lastRefZoom = 1.0;

    fractious.interact(false);

    // Immediate low-res preview during rapid cycling
    expect(state.isPendingUpdate).toBe(true);
    expect(workerManager.updateReference).not.toHaveBeenCalled();

    // After 200ms pause, upgrades directly to full-res render & URL sync without worker recalc
    vi.advanceTimersByTime(200);
    expect(state.isPendingUpdate).toBe(false);
    expect(workerManager.updateReference).not.toHaveBeenCalled();
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('should not fire the 200ms worker debounce timer while pointers are actively held down', () => {
    state.pointers = new Map([[1, { x: 100, y: 100 }]]);
    state.offsetX = 0.5;
    state.offsetY = 0.5;
    state.targetZoom = 0.5;

    fractious.interact(false);

    expect(config.zoom).toBe(0.5);
    expect(state.isPendingUpdate).toBe(true);
    vi.advanceTimersByTime(500);
    expect(workerManager.updateReference).not.toHaveBeenCalled();
  });

  it('should skip worker recalculation on interact(true) when coordinates and zoom are unchanged (e.g. Shift+drag release)', () => {
    state.pointers = new Map();
    state.offsetX = -0.25;
    state.offsetY = 0.1;
    state.targetZoom = 1.0;
    fractious._lastRefOffsetX = -0.25;
    fractious._lastRefOffsetY = 0.1;
    fractious._lastRefZoom = 1.0;

    fractious.interact(true);

    expect(state.isPendingUpdate).toBe(false);
    expect(workerManager.updateReference).not.toHaveBeenCalled();
  });

  it('should trigger worker recalculation when refX/refY are edited directly even if offsetX and offsetY are 0', () => {
    state.pointers = new Map();
    state.offsetX = 0;
    state.offsetY = 0;
    state.targetZoom = 1.0;
    fractious._lastRefOffsetX = 0;
    fractious._lastRefOffsetY = 0;
    fractious._lastRefZoom = 1.0;

    // Simulate user editing #c_re input directly
    state.refX = '-0.75';
    config.centerX = '-0.75';

    fractious.interact(true);

    expect(workerManager.updateReference).toHaveBeenCalledTimes(1);
  });
});
