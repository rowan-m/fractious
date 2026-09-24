import { createDefaultConfig, createDefaultState } from './State.js';
import { Renderer } from './Renderer.js';
import { WorkerManager } from './WorkerManager.js';
import { InteractionManager } from './InteractionManager.js';
import { Fractious } from './Fractious.js';
import { bindAutoReload } from './autoReload.js';
import './style.css';

const config = createDefaultConfig();
const state = createDefaultState();

const elements = {
  canvas: document.getElementById('fractal'),
  bgCanvas: document.getElementById('fractal-bg'),
  crosshair: document.getElementById('crosshair'),
  iterIcon: document.getElementById('iter-icon'),
  shortcuts: document.getElementById('shortcuts'),
  inputs: {
    c_re: document.getElementById('c_re'),
    c_im: document.getElementById('c_im'),
    zoom: document.getElementById('zoom'),
    rotation: document.getElementById('rotation'),
    iterations: document.getElementById('iterations'),
    hue: document.getElementById('hue'),
    hueStep: document.getElementById('huestep'),
  },
};

const renderer = new Renderer(elements.canvas, elements.bgCanvas);
const workerManager = new WorkerManager();

const interactionCallbacks = {
  onInteract: (needsNewReference = true) => app.interact(needsNewReference),
  onRequestRender: () => app.requestRender(),
  onResize: () => app.handleResize(),
  onScreenshotRequest: () => app.requestScreenshot(),
  onShareRequest: () => app.requestShare(),
};

const interactionManager = new InteractionManager(
  elements,
  config,
  state,
  interactionCallbacks,
);

const app = new Fractious(
  config,
  state,
  renderer,
  workerManager,
  interactionManager,
);

// Let the render area extend under camera cutouts / system bars (controls stay
// inside the safe area via body padding). Only opt in when installed or in
// fullscreen: a static viewport-fit=cover breaks Chrome's in-tab install sheet.
function bindViewportFit() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const base = 'width=device-width, initial-scale=1';
  const edgeToEdge = window.matchMedia?.(
    '(display-mode: standalone), (display-mode: fullscreen)',
  );
  const update = () => {
    const cover = Boolean(edgeToEdge?.matches || document.fullscreenElement);
    meta.setAttribute('content', cover ? `${base}, viewport-fit=cover` : base);
  };
  edgeToEdge?.addEventListener?.('change', update);
  document.addEventListener('fullscreenchange', update);
  update();
}

// Allow test environments to import this without running it immediately if needed
// eslint-disable-next-line no-undef
if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
  bindViewportFit();
  bindAutoReload(
    () => state.pointers.size > 0 || state.isPendingUpdate || state.workerBusy,
  );
  app.init();
}

export {
  Fractious,
  Renderer,
  WorkerManager,
  InteractionManager,
  createDefaultConfig,
  createDefaultState,
};
