import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';

vi.mock('../wasm/pkg/fractious_lib.js', () => ({
  default: vi.fn(),
  init_hooks: vi.fn(),
  add_coord: vi.fn((val) => val),
  sub_coord: vi.fn(),
}));

// Mock Renderer globally before importing main
vi.mock('./Renderer.js', () => ({
  Renderer: class {
    async init() {
      return true;
    }
    render() {
      return false;
    }
    onSubmittedWorkDone() {
      return Promise.resolve();
    }
  },
}));

describe('main.js initialization', () => {
  let window;
  let document;

  beforeEach(() => {
    window = new Window({ url: 'http://localhost/?x=-1.5&y=0.0' });
    document = window.document;
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', document);

    // Mock replaceState on history
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    // Mock ResizeObserver
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
      },
    );

    document.body.innerHTML = `
            <canvas id="fractal"></canvas>
            <canvas id="fractal-bg"></canvas>
            <div id="crosshair"></div>
            <input id="c_re" />
            <input id="c_im" />
            <input id="zoom" />
            <input id="rotation" />
            <input id="iterations" />
            <input id="hue" />
            <input id="huestep" />
        `;

    // Mock requestAnimationFrame and console.error
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure web worker doesn't fail
    vi.stubGlobal(
      'Worker',
      class {
        postMessage() {}
        addEventListener() {}
      },
    );

    vi.stubGlobal('import', { meta: { url: 'file:///app/src/main.js' } });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('should initialize app and update UI', async () => {
    vi.stubGlobal('process', { env: { NODE_ENV: 'production' } });

    await import('./main.js');

    // Wait a small tick for async init to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(document.getElementById('c_re').value).toBe('-1.5');
    expect(document.getElementById('c_im').value).toBe('0.0');
  });

  it.each([
    [false, 'width=device-width, initial-scale=1'],
    [true, 'width=device-width, initial-scale=1, viewport-fit=cover'],
  ])(
    'should set viewport-fit=cover only when installed (standalone=%s)',
    async (matches, expected) => {
      vi.stubGlobal('process', { env: { NODE_ENV: 'production' } });
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      meta.setAttribute('content', 'width=device-width, initial-scale=1');
      document.head.appendChild(meta);
      window.matchMedia = vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
      }));

      await import('./main.js');

      expect(meta.getAttribute('content')).toBe(expected);
      meta.remove();
    },
  );
});
