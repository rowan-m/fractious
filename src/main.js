import { createDefaultConfig, createDefaultState } from "./State.js";
import { Renderer } from "./Renderer.js";
import { WorkerManager } from "./WorkerManager.js";
import { InteractionManager } from "./InteractionManager.js";
import { Fractious } from "./Fractious.js";
import "./style.css";

const config = createDefaultConfig();
const state = createDefaultState();

const elements = {
  canvas: document.getElementById("fractal"),
  bgCanvas: document.getElementById("fractal-bg"),
  crosshair: document.getElementById("crosshair"),
  inputs: {
    c_re: document.getElementById("c_re"),
    c_im: document.getElementById("c_im"),
    zoom: document.getElementById("zoom"),
    rotation: document.getElementById("rotation"),
    iterations: document.getElementById("iterations"),
    hue: document.getElementById("hue"),
    hueStep: document.getElementById("huestep"),
  },
};

const renderer = new Renderer(elements.canvas, elements.bgCanvas);
const workerManager = new WorkerManager();

let app;

const interactionCallbacks = {
  onInteract: (needsNewReference = true) => app.interact(needsNewReference),
  onRequestRender: () => app.requestRender(),
  onResize: () => app.handleResize(),
  onScreenshotRequest: () => app.requestScreenshot(),
};

const interactionManager = new InteractionManager(
  elements,
  config,
  state,
  interactionCallbacks,
);

app = new Fractious(config, state, renderer, workerManager, interactionManager);

// Allow test environments to import this without running it immediately if needed
// eslint-disable-next-line no-undef
if (typeof process === "undefined" || process.env.NODE_ENV !== "test") {
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
