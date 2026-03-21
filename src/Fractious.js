import init, { init_hooks, sub_coord } from "../wasm/pkg/fractious_lib.js";

export class Fractious {
  constructor(config, state, renderer, workerManager, interactionManager) {
    this.config = config;
    this.state = state;
    this.renderer = renderer;
    this.workerManager = workerManager;
    this.interactionManager = interactionManager;

    this.frame = this.frame.bind(this);
  }

  async init() {
    await init();
    init_hooks();

    this.handleResize();
    this.parseURL();

    const gpuReady = await this.renderer.init();
    if (!gpuReady) return;

    this.setupWorker();

    this.interactionManager.bindEvents();
    this.interactionManager.updateUI();

    this.updateReference();
    this.requestRender();
  }

  setupWorker() {
    this.workerManager.init();

    this.workerManager.onResult = (payload) => {
      this.state.refX = payload.refX;
      this.state.refY = payload.refY;

      this.state.offsetX = sub_coord(this.config.centerX, this.state.refX);
      this.state.offsetY = sub_coord(this.config.centerY, this.state.refY);

      this.renderer.updateOrbitBuffer(payload.orbit);

      this.config.iter = payload.iter;
      this.interactionManager.updateUI();

      this.state.isPendingUpdate = false;
      this.state.workerBusy = false;
      this.requestRender();
    };

    this.workerManager.onError = (error) => {
      console.error("Worker error:", error);
      this.state.isPendingUpdate = false;
      this.state.workerBusy = false;
    };
  }

  handleResize() {
    this.state.dpr = window.devicePixelRatio || 1;
    this.state.width = this.interactionManager.el.canvas.clientWidth;
    this.state.height = this.interactionManager.el.canvas.clientHeight;
    this.state.currentPixels =
      this.state.width * this.state.dpr * (this.state.height * this.state.dpr);
  }

  parseURL() {
    const params = new URLSearchParams(window.location.search);

    const x = params.get("x");
    if (x && !isNaN(parseFloat(x)) && isFinite(x)) this.config.centerX = x;

    const y = params.get("y");
    if (y && !isNaN(parseFloat(y)) && isFinite(y)) this.config.centerY = y;

    this.state.refX = this.config.centerX;
    this.state.refY = this.config.centerY;

    const z = params.get("z");
    if (z && !isNaN(parseFloat(z))) this.config.zoom = Math.pow(10, -parseFloat(z));

    const r = params.get("r");
    if (r && !isNaN(parseFloat(r))) this.config.rotation = parseFloat(r);

    const h = params.get("h");
    if (h && !isNaN(parseFloat(h))) this.config.hue = parseFloat(h);

    const s = params.get("s");
    if (s && !isNaN(parseFloat(s))) this.config.hueStep = parseFloat(s);

    this.state.targetZoom = this.config.zoom;

    if (this.config.zoom) {
      const logZoom = Math.log10(this.config.zoom);
      this.config.iter = Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);
    }
  }

  updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set("x", this.config.centerX);
    params.set("y", this.config.centerY);
    params.set("z", (-Math.log10(this.config.zoom)).toFixed(3));
    params.set("r", this.config.rotation.toFixed(3));
    params.set("h", this.config.hue.toFixed(3));
    params.set("s", this.config.hueStep.toFixed(3));
    window.history.replaceState({}, "", `?${params.toString()}`);
  }

  updateReference() {
    this.state.workerBusy = true;
    this.workerManager.updateReference(
      this.config,
      this.interactionManager.el.canvas.width,
      this.interactionManager.el.canvas.height,
    );
  }

  interact(needsNewReference = true) {
    this.state.isPendingUpdate = true;
    this.interactionManager.updateUI();
    this.requestRender();

    if (needsNewReference) {
      this.updateReference();
    } else {
      if (this._interactionTimeout) clearTimeout(this._interactionTimeout);
      this._interactionTimeout = setTimeout(() => {
        this.state.isPendingUpdate = false;
        this.requestRender();
      }, 250);
    }
  }

  requestRender() {
    if (!this.state.isPendingUpdate && !this.state.workerBusy) {
      this.updateURL();
    }
    this.state.currentPass = 0;
    if (!this.state.isFrameScheduled) {
      this.state.isFrameScheduled = true;
      requestAnimationFrame(this.frame);
    }
  }

  requestScreenshot() {
    this.state.screenshotRequested = true;
    if (!this.state.isFrameScheduled) {
      this.state.isFrameScheduled = true;
      requestAnimationFrame(this.frame);
    }
  }

  frame() {
    this.state.isFrameScheduled = false;

    const needsMorePasses = this.renderer.render(this.config, this.state);

    if (needsMorePasses && !this.state.isFrameScheduled) {
      this.state.isFrameScheduled = true;
      this.renderer.onSubmittedWorkDone().then(() => {
        requestAnimationFrame(this.frame);
      });
    }
  }
}
