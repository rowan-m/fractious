import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InteractionManager } from './InteractionManager.js';

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
    state = {};

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

  it('should normalize negative rotation angles into [0, 360) degrees', () => {
    config.rotation = -Math.PI / 4; // -45 degrees -> 315.0
    interactionManager.updateUI();

    expect(elements.inputs.rotation.value).toBe('315.0');
  });

  it('should anchor wheel zoom around cursor position and support Shift+wheel rotation', () => {
    state.width = 400;
    state.height = 400;
    state.offsetX = 0;
    state.offsetY = 0;
    state.targetZoom = 2.0;
    config.rotation = 0;

    // Zoom in at top-right quadrant (clientX = 300, clientY = 100)
    interactionManager.handleWheel({
      preventDefault: vi.fn(),
      deltaY: -100,
      clientX: 300,
      clientY: 100,
      shiftKey: false,
    });

    expect(state.targetZoom).toBeLessThan(2.0);
    expect(state.offsetX).toBeGreaterThan(0);
    expect(state.offsetY).toBeGreaterThan(0);

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

  it('should handle keyboard shortcuts with consistent increments', () => {
    state.targetZoom = 1.0;
    config.zoom = 1.0;
    config.rotation = 0;
    config.hue = 0.5;
    config.hueStep = 1.0;

    // E -> zoom in by 0.1 log10 units
    interactionManager.handleKeyDown({
      key: 'e',
      preventDefault: vi.fn(),
    });
    expect(-Math.log10(state.targetZoom)).toBeCloseTo(0.1, 6);

    // Q -> zoom out by 0.1 log10 units
    interactionManager.handleKeyDown({
      key: 'q',
      preventDefault: vi.fn(),
    });
    expect(state.targetZoom).toBeCloseTo(1.0, 6);

    // X / Z -> rotate CW / CCW by 15 degrees (Math.PI / 12)
    interactionManager.handleKeyDown({
      key: 'x',
      preventDefault: vi.fn(),
    });
    expect(config.rotation).toBeCloseTo(Math.PI / 12, 6);

    interactionManager.handleKeyDown({
      key: 'z',
      preventDefault: vi.fn(),
    });
    expect(config.rotation).toBeCloseTo(0, 6);

    // R / T -> hue -0.01 / +0.01
    interactionManager.handleKeyDown({
      key: 't',
      preventDefault: vi.fn(),
    });
    expect(config.hue).toBeCloseTo(0.51, 6);
    interactionManager.handleKeyDown({
      key: 'r',
      preventDefault: vi.fn(),
    });
    expect(config.hue).toBeCloseTo(0.5, 6);

    // F / G -> hueStep -0.005 / +0.005
    interactionManager.handleKeyDown({
      key: 'g',
      preventDefault: vi.fn(),
    });
    expect(config.hueStep).toBeCloseTo(1.005, 6);
    interactionManager.handleKeyDown({
      key: 'f',
      preventDefault: vi.fn(),
    });
    expect(config.hueStep).toBeCloseTo(1.0, 6);

    // W / A / S / D -> pan view and show center .pin
    state.offsetX = 0;
    state.offsetY = 0;
    elements.crosshair.classList.toggle.mockClear();
    interactionManager.handleKeyDown({
      key: 'w',
      preventDefault: vi.fn(),
    });
    expect(state.offsetY).toBeCloseTo(0.1, 6);
    expect(elements.crosshair.classList.toggle).toHaveBeenCalledWith(
      'moving',
      true,
    );

    interactionManager.handleKeyDown({
      key: 'd',
      preventDefault: vi.fn(),
    });
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
});
