import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractionManager } from './InteractionManager.js';

// Tap a key: press and release it straight away.
function press(interactionManager, key) {
  const code = `Key${key.toUpperCase()}`;
  interactionManager.handleKeyDown({ key, code, preventDefault: () => {} });
  interactionManager.handleKeyUp({ key, code });
}

describe('InteractionManager updateUI', () => {
  let interactionManager;
  let config;
  let state;
  let elements;
  let callbacks;

  beforeEach(() => {
    config = {
      centerX: '1.5',
      centerY: '-0.5',
      zoom: 0.01,
      rotation: Math.PI / 4, // 45 degrees
      iter: 100,
      hue: 0.5,
      hueStep: 0.1,
    };
    state = { pointers: new Map(), held: new Set() };

    elements = {
      crosshair: {
        classList: {
          toggle: vi.fn(),
          add: vi.fn(),
          remove: vi.fn(),
        },
      },
      inputs: {
        c_re: { value: '' },
        c_im: { value: '' },
        zoom: { value: '' },
        rotation: { value: '' },
        iterations: { value: '' },
        hue: { value: '' },
        hueStep: { value: '' },
      },
    };

    callbacks = {
      onInteract: vi.fn(),
      onRequestRender: vi.fn(),
      onResize: vi.fn(),
    };

    // Stub document to simulate active element
    vi.stubGlobal('document', { activeElement: null });

    interactionManager = new InteractionManager(
      elements,
      config,
      state,
      callbacks,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should update UI input values from config when not active', () => {
    interactionManager.updateUI();

    expect(elements.inputs.c_re.value).toBe('1.5');
    expect(elements.inputs.c_im.value).toBe('-0.5');
    expect(elements.inputs.zoom.value).toBe('2.00'); // -Math.log10(0.01) = 2.00
    expect(elements.inputs.rotation.value).toBe('45.0');
    expect(elements.inputs.iterations.value).toBe(100);
    expect(elements.inputs.hue.value).toBe('0.500');
    expect(elements.inputs.hueStep.value).toBe('0.100');
  });

  it('should not update UI input value if it is the active element', () => {
    // Make c_re the active element
    vi.stubGlobal('document', { activeElement: elements.inputs.c_re });
    elements.inputs.c_re.value = 'user_typing';

    interactionManager.updateUI();

    expect(elements.inputs.c_re.value).toBe('user_typing');
    // Other elements should still update
    expect(elements.inputs.c_im.value).toBe('-0.5');
  });

  it('should set input value even if current value is loosely equal but strictly different', () => {
    elements.inputs.c_re.value = '1.50000'; // different string representation

    interactionManager.updateUI();

    expect(elements.inputs.c_re.value).toBe('1.5');
  });

  it('should toggle the shortcuts popover on ? without interacting with the fractal', () => {
    elements.shortcuts = { togglePopover: vi.fn() };
    const preventDefault = vi.fn();

    interactionManager.handleKeyDown({ key: '?', preventDefault });

    expect(elements.shortcuts.togglePopover).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
    expect(callbacks.onInteract).not.toHaveBeenCalled();
  });

  it('should normalize negative rotation angles into [0, 360) degrees', () => {
    config.rotation = -Math.PI / 4; // -45 degrees -> 315.0
    interactionManager.updateUI();

    expect(elements.inputs.rotation.value).toBe('315.0');
  });

  it('should zoom on the centre regardless of cursor position and support Shift+wheel rotation', () => {
    state.width = 400;
    state.height = 400;
    state.offsetX = 0;
    state.offsetY = 0;
    state.targetZoom = 2.0;
    config.rotation = 0;

    // Cursor in the top-right quadrant must not shift the view
    interactionManager.handleWheel({
      preventDefault: vi.fn(),
      deltaY: -100,
      clientX: 300,
      clientY: 100,
      shiftKey: false,
    });

    expect(state.targetZoom).toBeCloseTo(2.0 / 1.05, 10);
    expect(state.offsetX).toBe(0);
    expect(state.offsetY).toBe(0);

    // Shift + wheel rotates without changing targetZoom
    const zoomBeforeRotate = state.targetZoom;
    interactionManager.handleWheel({
      preventDefault: vi.fn(),
      deltaY: 100,
      clientX: 200,
      clientY: 200,
      shiftKey: true,
    });

    expect(state.targetZoom).toBe(zoomBeforeRotate);
    expect(config.rotation).toBeCloseTo(Math.PI / 36, 6);
  });

  it('should zoom around cursor on double-click and zoom out on Shift+double-click', () => {
    state.width = 400;
    state.height = 400;
    state.offsetX = 0;
    state.offsetY = 0;
    state.targetZoom = 1.0;
    config.rotation = 0;

    interactionManager.handleDoubleClick({
      preventDefault: vi.fn(),
      clientX: 300,
      clientY: 100,
      shiftKey: false,
    });

    expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.5, 6);
    expect(state.offsetX).toBeGreaterThan(0);
    expect(state.offsetY).toBeGreaterThan(0);

    interactionManager.handleDoubleClick({
      preventDefault: vi.fn(),
      clientX: 300,
      clientY: 100,
      shiftKey: true,
    });

    expect(state.targetZoom).toBeCloseTo(1.0, 6);
  });

  it('should handle keyboard shortcuts with consistent increments', () => {
    state.targetZoom = 1.0;
    config.zoom = 1.0;
    config.rotation = 0;
    config.hue = 0.5;
    config.hueStep = 1.0;

    // E -> zoom in by 0.1 log10 units
    press(interactionManager, 'e');
    expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.1, 6);

    // Q -> zoom out by 0.1 log10 units
    press(interactionManager, 'q');
    expect(state.targetZoom).toBeCloseTo(1.0, 6);

    // X / Z -> rotate CW / CCW by 15 degrees (Math.PI / 12)
    press(interactionManager, 'x');
    expect(config.rotation).toBeCloseTo(Math.PI / 12, 6);

    press(interactionManager, 'z');
    expect(config.rotation).toBeCloseTo(0, 6);

    // R / T -> hue -0.01 / +0.01
    press(interactionManager, 't');
    expect(config.hue).toBeCloseTo(0.51, 6);
    press(interactionManager, 'r');
    expect(config.hue).toBeCloseTo(0.5, 6);

    // F / G -> hueStep -0.005 / +0.005
    press(interactionManager, 'g');
    expect(config.hueStep).toBeCloseTo(1.005, 6);
    press(interactionManager, 'f');
    expect(config.hueStep).toBeCloseTo(1.0, 6);

    // W / A / S / D -> pan view as a preview interaction (Fractious shows the pin)
    state.offsetX = 0;
    state.offsetY = 0;
    callbacks.onInteract.mockClear();
    press(interactionManager, 'w');
    expect(state.offsetY).toBeCloseTo(0.1, 6);
    expect(callbacks.onInteract).toHaveBeenCalledWith(false);

    press(interactionManager, 'd');
    expect(state.offsetX).toBeCloseTo(0.1, 6);
  });

  it('should ignore keyboard shortcuts when typing in an input or holding modifier keys', () => {
    config.hue = 0.5;
    const preventDefault = vi.fn();

    interactionManager.handleKeyDown({
      key: 't',
      target: { tagName: 'INPUT' },
      preventDefault,
    });
    expect(config.hue).toBe(0.5);
    expect(preventDefault).not.toHaveBeenCalled();

    interactionManager.handleKeyDown({
      key: 'r',
      ctrlKey: true,
      preventDefault,
    });
    expect(config.hue).toBe(0.5);
    expect(preventDefault).not.toHaveBeenCalled();

    const blur = vi.fn();
    interactionManager.handleKeyDown({
      key: 'Enter',
      target: { tagName: 'INPUT', blur },
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);
  });

  describe('holding keys', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const down = (key, extra = {}) =>
      interactionManager.handleKeyDown({
        key,
        code: `Key${key.toUpperCase()}`,
        preventDefault: vi.fn(),
        ...extra,
      });
    const up = (key) =>
      interactionManager.handleKeyUp({ key, code: `Key${key.toUpperCase()}` });

    it('repeats the action while held and finishes the interaction on release', () => {
      state.targetZoom = 1.0;
      down('e');
      expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.1, 6);
      expect(callbacks.onInteract).toHaveBeenLastCalledWith(false);

      vi.advanceTimersByTime(399);
      expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.1, 6);
      vi.advanceTimersByTime(1 + 50 * 3); // repeat delay, then 3 repeats
      expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.4, 6);

      // OS auto-repeat events are ignored; our own timer drives the repeat
      down('e', { repeat: true });
      expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.4, 6);

      up('e');
      expect(callbacks.onInteract).toHaveBeenLastCalledWith(true);
      vi.advanceTimersByTime(1000);
      expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.4, 6);
    });

    it('keeps interacting until every key, button and pointer is released', () => {
      state.targetZoom = 1.0;
      config.rotation = 0;
      down('e');
      down('x');
      state.pointers.set(1, { x: 0, y: 0 });

      up('e');
      interactionManager.handlePointerUp({ pointerId: 1 });
      expect(callbacks.onInteract).not.toHaveBeenCalledWith(true);

      up('x');
      expect(callbacks.onInteract).toHaveBeenLastCalledWith(true);
      expect(state.held.size).toBe(0);
    });

    it('releases everything when the window loses focus', () => {
      down('w');
      down('d');
      interactionManager.releaseAll();
      expect(state.held.size).toBe(0);
      expect(callbacks.onInteract).toHaveBeenLastCalledWith(true);
      const calls = callbacks.onInteract.mock.calls.length;
      vi.advanceTimersByTime(1000);
      expect(callbacks.onInteract.mock.calls).toHaveLength(calls);
    });
  });
});
