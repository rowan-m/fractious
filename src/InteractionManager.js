import { radToNormDeg } from './State.js';

const ZOOM_STEP_FACTOR = Math.pow(10, 0.1);
const ROTATE_BTN_STEP = Math.PI / 12; // 15 degrees
const HUE_STEP_INCREMENT = 0.005;
const HUE_INCREMENT = 0.01;
const MOVE_STEP = 0.1;

export class InteractionManager {
  constructor(elements, config, state, callbacks) {
    this.el = elements;
    this.config = config;
    this.state = state;
    this.callbacks = callbacks;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);

    this._keyActions = this._createKeyActionMap();
  }

  _setVal(input, val) {
    if (document.activeElement !== input && input.value !== String(val)) {
      input.value = val;
    }
  }

  updateUI() {
    const { inputs } = this.el;

    this._setVal(inputs.c_re, this.config.centerX);
    this._setVal(inputs.c_im, this.config.centerY);
    this._setVal(inputs.zoom, (-Math.log10(this.config.zoom)).toFixed(2));
    this._setVal(
      inputs.rotation,
      radToNormDeg(this.config.rotation).toFixed(1),
    );

    this._setVal(inputs.iterations, this.config.iter);
    this._setVal(inputs.hue, this.config.hue.toFixed(3));
    this._setVal(inputs.hueStep, this.config.hueStep.toFixed(3));
    if (this.el.iterIcon) {
      this.el.iterIcon.classList.toggle(
        'busy',
        Boolean(this.state.workerBusy || this.state.isRendering),
      );
    }
  }

  applyRotation(dx, dy, scale) {
    const c = Math.cos(this.config.rotation);
    const sn = Math.sin(this.config.rotation);

    const dCx = (dx * c + dy * sn) * scale;
    const dCy = (dy * c - dx * sn) * scale;

    this.state.offsetX -= dCx;
    this.state.offsetY += dCy;
  }

  _wrapAngleDelta(delta) {
    if (delta > Math.PI) return delta - 2 * Math.PI;
    if (delta < -Math.PI) return delta + 2 * Math.PI;
    return delta;
  }

  _zoomAroundPoint(clientX, clientY, factor) {
    const oldZoom = this.state.targetZoom;
    this.state.targetZoom = oldZoom * factor;

    if (this.state.width > 0 && this.state.height > 0) {
      const relX = clientX - this.state.width / 2;
      const relY = clientY - this.state.height / 2;
      const scaleDiff = ((1.0 - factor) * 2.0 * oldZoom) / this.state.height;
      this.applyRotation(-relX, -relY, scaleDiff);
    }
  }

  setPinVisible(visible) {
    if (this.el.crosshair) {
      this.el.crosshair.classList.toggle('moving', Boolean(visible));
    }
  }

  _notifyInteract(needsNewReference = false) {
    this.setPinVisible(
      !needsNewReference ||
        Boolean(this.state.pointers && this.state.pointers.size > 0),
    );
    this.callbacks.onInteract(needsNewReference);
  }

  handlePointerDown(e) {
    this.state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.el.canvas.setPointerCapture(e.pointerId);

    if (this.state.pointers.size === 1) {
      this.state.lastX = e.clientX;
      this.state.lastY = e.clientY;
    } else if (this.state.pointers.size === 2) {
      const iter = this.state.pointers.values();
      const p1 = iter.next().value;
      const p2 = iter.next().value;
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      this.state.prevDiff = Math.hypot(dx, dy);
      this.state.prevAngle = Math.atan2(dy, dx);
      this.state.prevCenter = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };
    }

    this._notifyInteract(false);
  }

  _handlePinchZoom(scaleY) {
    const iter = this.state.pointers.values();
    const p1 = iter.next().value;
    const p2 = iter.next().value;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const curDiff = Math.hypot(dx, dy);
    const curAngle = Math.atan2(dy, dx);
    const curCenter = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };

    if (this.state.prevDiff > 0) {
      const factor = curDiff / this.state.prevDiff;
      this._zoomAroundPoint(curCenter.x, curCenter.y, 1.0 / factor);

      if (this.state.prevAngle !== null) {
        this.config.rotation += this._wrapAngleDelta(
          curAngle - this.state.prevAngle,
        );
      }
    }
    this.state.prevDiff = curDiff;
    this.state.prevAngle = curAngle;

    if (this.state.prevCenter) {
      const moveX = curCenter.x - this.state.prevCenter.x;
      const moveY = curCenter.y - this.state.prevCenter.y;

      this.applyRotation(moveX, moveY, scaleY);
    }
    this.state.prevCenter = curCenter;
  }

  _handlePan(e, scaleY) {
    if (e.shiftKey) {
      const cx = (this.state.width || 512) / 2;
      const cy = (this.state.height || 512) / 2;
      const prevAngle = Math.atan2(
        this.state.lastY - cy,
        this.state.lastX - cx,
      );
      const curAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      this.config.rotation += this._wrapAngleDelta(curAngle - prevAngle);
      this.state.lastX = e.clientX;
      this.state.lastY = e.clientY;
      return;
    }

    const dx = e.clientX - this.state.lastX;
    const dy = e.clientY - this.state.lastY;
    this.state.lastX = e.clientX;
    this.state.lastY = e.clientY;

    this.applyRotation(dx, dy, scaleY);
  }

  handlePointerMove(e) {
    const pointer = this.state.pointers.get(e.pointerId);
    if (!pointer) return;

    pointer.x = e.clientX;
    pointer.y = e.clientY;

    const heightComplex = 2.0 * this.config.zoom;
    const scaleY = heightComplex / this.state.height;

    if (this.state.pointers.size === 2) {
      this._handlePinchZoom(scaleY);
    } else if (this.state.pointers.size === 1) {
      this._handlePan(e, scaleY);
    }

    this._notifyInteract(false);
  }

  handlePointerUp(e) {
    if (!this.state.pointers.has(e.pointerId)) return;
    this.state.pointers.delete(e.pointerId);

    if (this.state.pointers.size < 2) {
      this.state.prevDiff = -1;
      this.state.prevAngle = null;
      this.state.prevCenter = null;
    }

    if (this.state.pointers.size === 1) {
      const point = this.state.pointers.values().next().value;
      this.state.lastX = point.x;
      this.state.lastY = point.y;
      this.callbacks.onRequestRender();
    } else if (this.state.pointers.size === 0) {
      this._notifyInteract(true);
    }
  }

  handleWheel(e) {
    e.preventDefault();
    if (e.shiftKey) {
      const step = Math.PI / 36;
      this.config.rotation += e.deltaY > 0 ? step : -step;
      this._notifyInteract(false);
      return;
    }
    const factor = e.deltaY > 0 ? 1.05 : 1.0 / 1.05;
    this._zoomAroundPoint(e.clientX || 0, e.clientY || 0, factor);
    this._notifyInteract(false);
  }

  handleDoubleClick(e) {
    e.preventDefault();
    const factor = e.shiftKey ? Math.pow(10, 0.5) : Math.pow(10, -0.5);
    this._zoomAroundPoint(e.clientX || 0, e.clientY || 0, factor);
    this._notifyInteract(false);
  }

  bindEvents() {
    const { canvas } = this.el;

    const observer = new ResizeObserver(() => {
      this.callbacks.onResize();
      this.callbacks.onRequestRender();
    });
    observer.observe(canvas);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    ['pointerup', 'pointercancel', 'pointerout', 'pointerleave'].forEach((e) =>
      canvas.addEventListener(e, this.handlePointerUp),
    );
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('dblclick', this.handleDoubleClick);
    window.addEventListener('keydown', this.handleKeyDown);

    if (typeof document.querySelectorAll === 'function') {
      document.querySelectorAll('form').forEach((form) => {
        form.addEventListener('submit', (e) => e.preventDefault());
      });
    }

    this.bindInputEvents();
    this.bindButtonEvents();
  }

  bindInputEvents() {
    const { inputs } = this.el;

    inputs.c_re.addEventListener('change', () => {
      this.config.centerX = inputs.c_re.value;
      this.state.refX = this.config.centerX;
      this.state.offsetX = 0;
      this._notifyInteract(true);
    });

    inputs.c_im.addEventListener('change', () => {
      this.config.centerY = inputs.c_im.value;
      this.state.refY = this.config.centerY;
      this.state.offsetY = 0;
      this._notifyInteract(true);
    });

    inputs.zoom.addEventListener('change', () => {
      const level = parseFloat(inputs.zoom.value);
      if (!isNaN(level)) {
        this.config.zoom = Math.pow(10, -level);
        this.state.targetZoom = this.config.zoom;
        this._notifyInteract(false);
      } else this.updateUI();
    });

    inputs.rotation.addEventListener('change', () => {
      const deg = parseFloat(inputs.rotation.value);
      if (!isNaN(deg)) {
        this.config.rotation = (deg * Math.PI) / 180;
        this._notifyInteract(false);
      } else this.updateUI();
    });

    inputs.hue.addEventListener('change', () => {
      const v = parseFloat(inputs.hue.value);
      if (!isNaN(v)) {
        this.config.hue = v;
        this._notifyInteract(false);
      } else this.updateUI();
    });

    inputs.hueStep.addEventListener('change', () => {
      const v = parseFloat(inputs.hueStep.value);
      if (!isNaN(v)) {
        this.config.hueStep = v;
        this._notifyInteract(false);
      } else this.updateUI();
    });
  }

  _bindBtn(id, action) {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = action;
  }

  _aspect() {
    const w = this.state.width || (this.el.canvas && this.el.canvas.width);
    const h = this.state.height || (this.el.canvas && this.el.canvas.height);
    if (w > 0 && h > 0) {
      return w / h;
    }
    return 1.0;
  }

  _moveView(shiftX, shiftY) {
    const c = Math.cos(this.config.rotation);
    const s = Math.sin(this.config.rotation);
    const dx = shiftX * c - shiftY * s;
    const dy = shiftX * s + shiftY * c;

    this.state.offsetX = (this.state.offsetX || 0) + dx;
    this.state.offsetY = (this.state.offsetY || 0) + dy;
    this._notifyInteract(false);
  }

  _createKeyActionMap() {
    const moveUp = () => this._moveView(0, MOVE_STEP * this.config.zoom);
    const moveDown = () => this._moveView(0, -MOVE_STEP * this.config.zoom);
    const moveLeft = () =>
      this._moveView(-MOVE_STEP * this.config.zoom * this._aspect(), 0);
    const moveRight = () =>
      this._moveView(MOVE_STEP * this.config.zoom * this._aspect(), 0);
    const zoomIn = () => {
      this.state.targetZoom /= ZOOM_STEP_FACTOR;
      this._notifyInteract(false);
    };
    const zoomOut = () => {
      this.state.targetZoom *= ZOOM_STEP_FACTOR;
      this._notifyInteract(false);
    };
    const rotateCCW = () => {
      this.config.rotation -= ROTATE_BTN_STEP;
      this._notifyInteract(false);
    };
    const rotateCW = () => {
      this.config.rotation += ROTATE_BTN_STEP;
      this._notifyInteract(false);
    };
    const hueDec = () => {
      this.config.hue -= HUE_INCREMENT;
      this._notifyInteract(false);
    };
    const hueInc = () => {
      this.config.hue += HUE_INCREMENT;
      this._notifyInteract(false);
    };
    const hueStepDec = () => {
      this.config.hueStep -= HUE_STEP_INCREMENT;
      this._notifyInteract(false);
    };
    const hueStepInc = () => {
      this.config.hueStep += HUE_STEP_INCREMENT;
      this._notifyInteract(false);
    };

    return new Map([
      ['w', moveUp],
      ['arrowup', moveUp],
      ['s', moveDown],
      ['arrowdown', moveDown],
      ['a', moveLeft],
      ['arrowleft', moveLeft],
      ['d', moveRight],
      ['arrowright', moveRight],
      ['q', zoomOut],
      ['-', zoomOut],
      ['_', zoomOut],
      ['e', zoomIn],
      ['+', zoomIn],
      ['=', zoomIn],
      ['z', rotateCCW],
      ['x', rotateCW],
      ['r', hueDec],
      ['t', hueInc],
      ['f', hueStepDec],
      ['g', hueStepInc],
      ['?', () => this.el.shortcuts?.togglePopover?.()],
    ]);
  }

  handleKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target) {
      const tag = target.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      ) {
        if (e.key === 'Enter' && typeof target.blur === 'function') {
          e.preventDefault();
          target.blur();
        }
        return;
      }
    }

    const action = this._keyActions.get(e.key.toLowerCase());
    if (action) {
      e.preventDefault();
      action();
    }
  }

  _bindNavigationButtons() {
    this._bindBtn('btn-up', this._keyActions.get('w'));
    this._bindBtn('btn-down', this._keyActions.get('s'));
    this._bindBtn('btn-left', this._keyActions.get('a'));
    this._bindBtn('btn-right', this._keyActions.get('d'));
  }

  _bindTransformButtons() {
    this._bindBtn('btn-zoom-in', this._keyActions.get('e'));
    this._bindBtn('btn-zoom-out', this._keyActions.get('q'));
    this._bindBtn('btn-rotate-cw', this._keyActions.get('x'));
    this._bindBtn('btn-rotate-ccw', this._keyActions.get('z'));
  }

  _bindColorButtons() {
    this._bindBtn('btn-cycle-in', this._keyActions.get('g'));
    this._bindBtn('btn-cycle-out', this._keyActions.get('f'));
    this._bindBtn('btn-hue-left', this._keyActions.get('r'));
    this._bindBtn('btn-hue-right', this._keyActions.get('t'));
  }

  _bindUtilityButtons() {
    this._bindBtn('btn-screenshot', () => {
      this.callbacks.onScreenshotRequest();
    });

    this._bindBtn('btn-share', () => {
      this.callbacks.onShareRequest();
    });

    const btnFullscreen = document.getElementById('btn-fullscreen');
    if (btnFullscreen) {
      btnFullscreen.onclick = () => {
        if (!document.fullscreenElement)
          document.documentElement.requestFullscreen();
        else if (document.exitFullscreen) document.exitFullscreen();
      };

      document.addEventListener('fullscreenchange', () => {
        const target = btnFullscreen.querySelector('span') || btnFullscreen;
        target.textContent = document.fullscreenElement ? '⏬' : '⏫';
      });
    }
  }

  bindButtonEvents() {
    this._bindNavigationButtons();
    this._bindTransformButtons();
    this._bindColorButtons();
    this._bindUtilityButtons();
  }
}
