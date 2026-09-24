import init, {
  init_hooks,
  sub_coord,
  add_coord,
} from '../wasm/pkg/fractious_lib.js';
import { calculateBaseIter, radToNormDeg } from './State.js';

export class Fractious {
  constructor(config, state, renderer, workerManager, interactionManager) {
    this.config = config;
    this.state = state;
    this.renderer = renderer;
    this.workerManager = workerManager;
    this.interactionManager = interactionManager;

    this._lastRefX = state.refX;
    this._lastRefY = state.refY;
    this._lastRefOffsetX = state.offsetX;
    this._lastRefOffsetY = state.offsetY;
    this._lastRefZoom = config.zoom;

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
      // The request was made for a view the user may have moved away from
      // since (pan, keys, wheel). Rebase the requested centre onto the new
      // anchor, then re-apply whatever movement happened in the meantime.
      const req = this._pendingRequest;
      const baseOffsetX = sub_coord(req.centerX, payload.refX);
      const baseOffsetY = sub_coord(req.centerY, payload.refY);

      this.state.offsetX = baseOffsetX + (this.state.offsetX - req.offsetX);
      this.state.offsetY = baseOffsetY + (this.state.offsetY - req.offsetY);
      this.state.refX = payload.refX;
      this.state.refY = payload.refY;

      this._lastRefX = this.state.refX;
      this._lastRefY = this.state.refY;
      this._lastRefOffsetX = baseOffsetX;
      this._lastRefOffsetY = baseOffsetY;
      this._lastRefZoom = req.zoom;

      this.renderer.updateOrbitBuffer(payload.orbit);

      this.config.iter = payload.iter;

      // Stay in low-res preview if a pointer is down or the view has moved
      // (a follow-up reference request is already pending in that case).
      this.state.isPendingUpdate =
        this.state.pointers.size > 0 || !this._isSameReferenceView();
      this.state.workerBusy = false;
      this.requestRender();
    };

    this.workerManager.onError = (error) => {
      console.error('Worker error:', error);
      this.state.isPendingUpdate = false;
      this.state.workerBusy = false;
      this.state.isRendering = false;
      this.interactionManager.updateUI();
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
    this._urlParams = new URLSearchParams(window.location.search);
    const params = this._urlParams;

    const parseNumStr = (key, callback) => {
      if (params.has(key)) {
        const val = params.get(key);
        if (val.length <= 2000 && !isNaN(parseFloat(val)) && isFinite(val)) {
          callback(val);
        }
      }
    };

    const parseNum = (key, callback) => {
      if (params.has(key)) {
        const val = parseFloat(params.get(key));
        if (!isNaN(val)) callback(val);
      }
    };

    parseNumStr('x', (x) => (this.config.centerX = x));
    parseNumStr('y', (y) => (this.config.centerY = y));

    this.state.refX = this.config.centerX;
    this.state.refY = this.config.centerY;

    parseNum('z', (z) => (this.config.zoom = Math.pow(10, -z)));
    parseNum('r', (r) => (this.config.rotation = (r * Math.PI) / 180));
    parseNum('h', (h) => (this.config.hue = h));
    parseNum('s', (s) => (this.config.hueStep = s));

    this.state.targetZoom = this.config.zoom;

    if (this.config.zoom) {
      this.config.iter = calculateBaseIter(this.config.zoom);
    }
  }

  updateURL() {
    // ⚡ Bolt: Reuse URLSearchParams object to avoid redundant parsing and garbage collection.
    if (!this._urlParams) {
      this._urlParams = new URLSearchParams(window.location.search);
    }
    const params = this._urlParams;
    params.set('x', this.config.centerX);
    params.set('y', this.config.centerY);
    params.set('z', (-Math.log10(this.config.zoom)).toFixed(3));
    params.set('r', radToNormDeg(this.config.rotation).toFixed(1));
    params.set('h', this.config.hue.toFixed(3));
    params.set('s', this.config.hueStep.toFixed(3));
    window.history.replaceState({}, '', `?${params.toString()}`);
  }

  updateReference() {
    if (this.state.targetZoom !== undefined) {
      this.config.zoom = this.state.targetZoom;
    }
    this.config.centerX = add_coord(this.state.refX, this.state.offsetX);
    this.config.centerY = add_coord(this.state.refY, this.state.offsetY);
    this._pendingRequest = {
      centerX: this.config.centerX,
      centerY: this.config.centerY,
      offsetX: this.state.offsetX,
      offsetY: this.state.offsetY,
      zoom: this.config.zoom,
    };
    this.state.workerBusy = true;
    this.interactionManager.updateUI();

    const width = this.state.width || this.interactionManager.el.canvas.width;
    const height =
      this.state.height || this.interactionManager.el.canvas.height;
    this.workerManager.updateReference(this.config, width, height);
  }

  _isSameReferenceView() {
    return (
      this.state.refX === this._lastRefX &&
      this.state.refY === this._lastRefY &&
      this.state.offsetX !== undefined &&
      this.state.offsetX === this._lastRefOffsetX &&
      this.state.offsetY === this._lastRefOffsetY &&
      this.state.targetZoom === this._lastRefZoom
    );
  }

  interact(needsNewReference = true) {
    if (this.state.targetZoom !== undefined) {
      this.config.zoom = this.state.targetZoom;
    }

    if (this._interactionTimeout) {
      clearTimeout(this._interactionTimeout);
      this._interactionTimeout = null;
    }

    const isPointerActive = Boolean(
      this.state.pointers && this.state.pointers.size > 0,
    );
    this.interactionManager.setPinVisible?.(
      isPointerActive || !needsNewReference,
    );

    if (needsNewReference && this._isSameReferenceView() && !isPointerActive) {
      this.state.isPendingUpdate = false;
      this.requestRender();
      return;
    }

    this.state.isPendingUpdate = true;
    this.requestRender();

    // Never fire background reference updates or switch out of interactive low-res mode
    // while a pointer/touch is still actively held down on the canvas.
    if (isPointerActive) {
      return;
    }

    if (needsNewReference) {
      this.updateReference();
    } else {
      this._interactionTimeout = setTimeout(() => {
        this._interactionTimeout = null;
        this.interactionManager.setPinVisible?.(false);
        if (this._isSameReferenceView()) {
          this.state.isPendingUpdate = false;
          this.requestRender();
        } else {
          this.updateReference();
        }
      }, 200); // Debounce 200ms of inactivity before full-res pass / worker update
    }
  }

  _scheduleFrame() {
    if (!this.state.isFrameScheduled) {
      this.state.isFrameScheduled = true;
      requestAnimationFrame(this.frame);
    }
  }

  requestRender() {
    this._renderGeneration = (this._renderGeneration || 0) + 1;
    const isFullResRender =
      !this.state.isPendingUpdate && !this.state.workerBusy;
    if (isFullResRender) {
      this.updateURL();
    }
    this.state.isRendering = isFullResRender;
    this.interactionManager.updateUI();
    this.state.currentPass = 0;
    this._scheduleFrame();
  }

  requestScreenshot() {
    this.state.screenshotRequested = true;
    this._scheduleFrame();
  }

  requestShare() {
    this.state.shareRequested = true;
    this._scheduleFrame();
  }

  frame() {
    this.state.isFrameScheduled = false;

    const needsMorePasses = this.renderer.render(this.config, this.state);

    if (
      (needsMorePasses && !this.state.isFrameScheduled) ||
      (!needsMorePasses && this.state.isRendering)
    ) {
      const passGen = this._renderGeneration;
      const onDone = this.renderer.onSubmittedWorkDone
        ? this.renderer.onSubmittedWorkDone()
        : Promise.resolve();
      onDone.then(() => {
        if (this._renderGeneration !== passGen) return;
        if (needsMorePasses) {
          this._scheduleFrame();
        } else {
          this.state.isRendering = false;
          this.interactionManager.updateUI();
        }
      });
    }
  }
}
