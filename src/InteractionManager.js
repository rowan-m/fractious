import { add_coord, sub_coord } from "../wasm/pkg/fractious_lib.js";

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
      (((this.config.rotation * 180) / Math.PI) % 360).toFixed(1),
    );

    this._setVal(inputs.iterations, this.config.iter);
    this._setVal(inputs.hue, this.config.hue.toFixed(3));
    this._setVal(inputs.hueStep, this.config.hueStep.toFixed(3));
  }

  applyRotation(dx, dy, scale) {
    const c = Math.cos(this.config.rotation);
    const sn = Math.sin(this.config.rotation);

    const dCx = (dx * c + dy * sn) * scale;
    const dCy = (dy * c - dx * sn) * scale;

    this.state.offsetX -= dCx;
    this.state.offsetY += dCy;
  }

  handlePointerDown(e) {
    this.state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.el.canvas.setPointerCapture(e.pointerId);

    if (this.state.pointers.size === 1) {
      this.state.lastX = e.clientX;
      this.state.lastY = e.clientY;
      this.el.crosshair.classList.add("moving");
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
  }

  _handlePinchZoom(scaleY) {
    const iter = this.state.pointers.values();
    const p1 = iter.next().value;
    const p2 = iter.next().value;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const curDiff = Math.hypot(dx, dy);
    const curAngle = Math.atan2(dy, dx);

    if (this.state.prevDiff > 0) {
      const factor = curDiff / this.state.prevDiff;
      this.state.targetZoom /= factor;

      if (this.state.prevAngle !== null) {
        let delta = curAngle - this.state.prevAngle;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        else if (delta < -Math.PI) delta += 2 * Math.PI;
        this.config.rotation += delta;
      }
    }
    this.state.prevDiff = curDiff;
    this.state.prevAngle = curAngle;

    const curCenter = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };

    if (this.state.prevCenter) {
      const moveX = curCenter.x - this.state.prevCenter.x;
      const moveY = curCenter.y - this.state.prevCenter.y;

      this.applyRotation(moveX, moveY, scaleY);
    }
    this.state.prevCenter = curCenter;
  }

  _handlePan(e, scaleY) {
    const dx = e.clientX - this.state.lastX;
    const dy = e.clientY - this.state.lastY;
    this.state.lastX = e.clientX;
    this.state.lastY = e.clientY;

    this.applyRotation(dx, dy, scaleY);
  }

  handlePointerMove(e) {
    if (!this.state.pointers.has(e.pointerId)) return;
    this.state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const heightComplex = 2.0 * this.config.zoom;
    const scaleY = heightComplex / this.el.canvas.clientHeight;

    if (this.state.pointers.size === 2) {
      this._handlePinchZoom(scaleY);
    } else if (this.state.pointers.size === 1) {
      this._handlePan(e, scaleY);
    }

    this.config.centerX = add_coord(this.state.refX, this.state.offsetX);
    this.config.centerY = add_coord(this.state.refY, this.state.offsetY);
    this.callbacks.onInteract(true);
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
    } else if (this.state.pointers.size === 0) {
      this.el.crosshair.classList.remove("moving");
    }
    this.callbacks.onRequestRender();
  }

  handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.05 : 1.0 / 1.05;
    this.state.targetZoom *= factor;
    this.callbacks.onInteract(true);
  }

  bindEvents() {
    const { canvas } = this.el;

    const observer = new ResizeObserver(() => {
      this.callbacks.onResize();
      this.callbacks.onRequestRender();
    });
    observer.observe(canvas);

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    ["pointerup", "pointercancel", "pointerout", "pointerleave"].forEach((e) =>
      canvas.addEventListener(e, this.handlePointerUp),
    );
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });

    this.bindInputEvents();
    this.bindButtonEvents();
  }

  bindInputEvents() {
    const { inputs } = this.el;

    inputs.c_re.addEventListener("change", () => {
      this.config.centerX = inputs.c_re.value;
      this.state.offsetX = sub_coord(this.config.centerX, this.state.refX);
      this.callbacks.onInteract(true);
    });

    inputs.c_im.addEventListener("change", () => {
      this.config.centerY = inputs.c_im.value;
      this.state.offsetY = sub_coord(this.config.centerY, this.state.refY);
      this.callbacks.onInteract(true);
    });

    inputs.zoom.addEventListener("change", () => {
      const level = parseFloat(inputs.zoom.value);
      if (!isNaN(level)) {
        this.config.zoom = Math.pow(10, -level);
        this.state.targetZoom = this.config.zoom;
        this.callbacks.onInteract(true);
      } else this.updateUI();
    });

    inputs.rotation.addEventListener("change", () => {
      const deg = parseFloat(inputs.rotation.value);
      if (!isNaN(deg)) {
        this.config.rotation = (deg * Math.PI) / 180;
        this.callbacks.onInteract(false);
      } else this.updateUI();
    });

    inputs.hue.addEventListener("change", () => {
      const v = parseFloat(inputs.hue.value);
      if (!isNaN(v)) {
        this.config.hue = v;
        this.callbacks.onInteract(false);
      } else this.updateUI();
    });

    inputs.hueStep.addEventListener("change", () => {
      const v = parseFloat(inputs.hueStep.value);
      if (!isNaN(v)) {
        this.config.hueStep = v;
        this.callbacks.onInteract(false);
      } else this.updateUI();
    });
  }

  bindButtonEvents() {
    const moveStep = 0.1;

    const moveView = (shiftX, shiftY) => {
      const c = Math.cos(this.config.rotation);
      const s = Math.sin(this.config.rotation);
      const dx = shiftX * c - shiftY * s;
      const dy = shiftX * s + shiftY * c;

      this.config.centerX = add_coord(this.config.centerX, dx.toString());
      this.state.offsetX = sub_coord(this.config.centerX, this.state.refX);
      this.config.centerY = add_coord(this.config.centerY, dy.toString());
      this.state.offsetY = sub_coord(this.config.centerY, this.state.refY);
      this.callbacks.onInteract(true);
    };

    const aspect = () => this.el.canvas.width / this.el.canvas.height;

    const buttonActions = {
      "btn-up": () => moveView(0, moveStep * this.config.zoom),
      "btn-down": () => moveView(0, -moveStep * this.config.zoom),
      "btn-left": () => moveView(-moveStep * this.config.zoom * aspect(), 0),
      "btn-right": () => moveView(moveStep * this.config.zoom * aspect(), 0),
      "btn-zoom-in": () => {
        this.state.targetZoom /= 1.5;
        this.callbacks.onInteract(true);
      },
      "btn-zoom-out": () => {
        this.state.targetZoom *= 1.5;
        this.callbacks.onInteract(true);
      },
      "btn-rotate-cw": () => {
        this.config.rotation += Math.PI / 12;
        this.callbacks.onInteract(false);
      },
      "btn-rotate-ccw": () => {
        this.config.rotation -= Math.PI / 12;
        this.callbacks.onInteract(false);
      },
      "btn-cycle-in": () => {
        this.config.hueStep += 0.05;
        this.callbacks.onInteract(false);
      },
      "btn-cycle-out": () => {
        this.config.hueStep -= 0.05;
        this.callbacks.onInteract(false);
      },
      "btn-hue-left": () => {
        this.config.hue -= 0.05;
        this.callbacks.onInteract(false);
      },
      "btn-hue-right": () => {
        this.config.hue += 0.05;
        this.callbacks.onInteract(false);
      },
      "btn-screenshot": () => {
        this.callbacks.onScreenshotRequest();
      },
    };

    const bindBtn = (id, action) => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = action;
    };

    bindBtn("btn-up", buttonActions["btn-up"]);
    bindBtn("btn-down", buttonActions["btn-down"]);
    bindBtn("btn-left", buttonActions["btn-left"]);
    bindBtn("btn-right", buttonActions["btn-right"]);
    bindBtn("btn-zoom-in", buttonActions["btn-zoom-in"]);
    bindBtn("btn-zoom-out", buttonActions["btn-zoom-out"]);
    bindBtn("btn-rotate-cw", buttonActions["btn-rotate-cw"]);
    bindBtn("btn-rotate-ccw", buttonActions["btn-rotate-ccw"]);
    bindBtn("btn-cycle-in", buttonActions["btn-cycle-in"]);
    bindBtn("btn-cycle-out", buttonActions["btn-cycle-out"]);
    bindBtn("btn-hue-left", buttonActions["btn-hue-left"]);
    bindBtn("btn-hue-right", buttonActions["btn-hue-right"]);
    bindBtn("btn-screenshot", buttonActions["btn-screenshot"]);

    const btnFullscreen = document.getElementById("btn-fullscreen");
    if (btnFullscreen) {
      btnFullscreen.onclick = () => {
        if (!document.fullscreenElement)
          document.documentElement.requestFullscreen();
        else if (document.exitFullscreen) document.exitFullscreen();
      };

      document.addEventListener("fullscreenchange", () => {
        const span = btnFullscreen.querySelector("span");
        if (span) {
          span.textContent = document.fullscreenElement ? "⏬" : "⏫";
        } else {
          btnFullscreen.textContent = document.fullscreenElement ? "⏬" : "⏫";
        }
      });
    }
  }
}
