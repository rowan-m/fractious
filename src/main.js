import init, { add_coord, init_hooks, sub_coord } from '../wasm/pkg/fractious_lib.js';
import shaderCode from './renderer/shader.wgsl?raw';
import postShaderCode from './renderer/post.wgsl?raw';
import './style.css';

class Fractious {
    constructor() {
        this.config = {
            centerX: "-1.7",
            centerY: "0.0",
            zoom: 2.0,
            rotation: 0.0,
            iter: 200,
            hue: 0.6,
            hueStep: 1.0
        };

        this.state = {
            refX: "-1.7",
            refY: "0.0",
            offsetX: 0.0,
            offsetY: 0.0,
            targetZoom: 2.0,

            workerBusy: false,
            isPendingUpdate: true,

            isFrameScheduled: false,
            screenshotRequested: false,

            currentPass: 0,
            totalPasses: 1,

            dpr: 1,
            width: 0,
            height: 0,
            currentPixels: 0,

            pointers: new Map(),
            prevDiff: -1,
            prevAngle: null,
            prevCenter: null,
            lastX: 0,
            lastY: 0,
        };

        this.el = {
            canvas: document.getElementById('fractal'),
            bgCanvas: document.getElementById('fractal-bg'),
            crosshair: document.getElementById('crosshair'),
            inputs: {
                c_re: document.getElementById('c_re'),
                c_im: document.getElementById('c_im'),
                zoom: document.getElementById('zoom'),
                rotation: document.getElementById('rotation'),
                iterations: document.getElementById('iterations'),
                hue: document.getElementById('hue'),
                hueStep: document.getElementById('huestep'),
            }
        };

        this.worker = null;
        this.currentAbortArray = null;

        // WebGPU objects
        this.device = null;
        this.context = null;
        this.format = null;
        this.pipeline = null;
        this.postPipeline = null;
        this.sampler = null;
        this.bindGroup = null;
        this.uniformBuffer = null;
        this.referenceOrbitBuffer = null;
        this.referenceOrbitSize = 0;
        this.offscreenTexture = null;
        this.offscreenTextureView = null;
        this.uniformBufferSize = 32;
        this.uniformData = new ArrayBuffer(this.uniformBufferSize);
        this.uniformDataView = new DataView(this.uniformData);

        this.frame = this.frame.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
    }

    async init() {
        await init();
        init_hooks();

        this.handleResize();
        this.parseURL();
        const gpuReady = await this.initWebGPU();
        if (!gpuReady) return;

        this.initWorker();
        this.bindEvents();

        this.updateUI();
        this.updateReference();
        this.requestRender();
    }

    handleResize() {
        this.state.dpr = window.devicePixelRatio || 1;
        this.state.width = this.el.canvas.clientWidth;
        this.state.height = this.el.canvas.clientHeight;
        this.state.currentPixels = (this.state.width * this.state.dpr) * (this.state.height * this.state.dpr);
    }

    parseURL() {
        const params = new URLSearchParams(window.location.search);

        if (params.has('x')) this.config.centerX = params.get('x');
        if (params.has('y')) this.config.centerY = params.get('y');

        this.state.refX = this.config.centerX;
        this.state.refY = this.config.centerY;

        if (params.has('z')) {
            const z = parseFloat(params.get('z'));
            if (!isNaN(z)) this.config.zoom = Math.pow(10, -z);
        }
        if (params.has('r')) {
            const r = parseFloat(params.get('r'));
            if (!isNaN(r)) this.config.rotation = r;
        }
        if (params.has('h')) {
            const h = parseFloat(params.get('h'));
            if (!isNaN(h)) this.config.hue = h;
        }
        if (params.has('s')) {
            const s = parseFloat(params.get('s'));
            if (!isNaN(s)) this.config.hueStep = s;
        }

        this.state.targetZoom = this.config.zoom;

        if (this.config.zoom) {
            const logZoom = Math.log10(this.config.zoom);
            this.config.iter = Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);
        }
    }

    updateURL() {
        const params = new URLSearchParams(window.location.search);
        params.set('x', this.config.centerX);
        params.set('y', this.config.centerY);
        params.set('z', (-Math.log10(this.config.zoom)).toFixed(3));
        params.set('r', this.config.rotation.toFixed(3));
        params.set('h', this.config.hue.toFixed(3));
        params.set('s', this.config.hueStep.toFixed(3));
        window.history.replaceState({}, '', `?${params.toString()}`);
    }

    updateUI() {
        const setVal = (input, val) => { if (document.activeElement !== input) input.value = val; };
        const { inputs } = this.el;

        setVal(inputs.c_re, this.config.centerX);
        setVal(inputs.c_im, this.config.centerY);
        setVal(inputs.zoom, (-Math.log10(this.config.zoom)).toFixed(2));
        setVal(inputs.rotation, ((this.config.rotation * 180 / Math.PI) % 360).toFixed(1));

        inputs.iterations.value = this.config.iter;
        setVal(inputs.hue, this.config.hue.toFixed(3));
        setVal(inputs.hueStep, this.config.hueStep.toFixed(3));
    }

    async initWebGPU() {
        if (!navigator.gpu) {
            console.error("WebGPU not supported");
            document.body.innerHTML = "WebGPU not supported in this browser.";
            return false;
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("No WebGPU adapter found");
            return false;
        }

        this.device = await adapter.requestDevice();
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context = this.el.canvas.getContext('webgpu');

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        });

        this.uniformBuffer = this.device.createBuffer({
            size: this.uniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.referenceOrbitSize = this.config.iter * 2 * 4;
        this.referenceOrbitBuffer = this.device.createBuffer({
            size: Math.max(this.referenceOrbitSize, 16),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const module = this.device.createShaderModule({ code: shaderCode });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs_main' },
            fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.format }] },
            primitive: { topology: 'triangle-list' },
        });

        const postModule = this.device.createShaderModule({ code: postShaderCode }); this.postPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: postModule, entryPoint: 'vs_main' },
            fragment: { module: postModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
            primitive: { topology: 'triangle-list' },
        });

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        return true;
    }

    createBindGroup() {
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.referenceOrbitBuffer } },
            ],
        });
    }

    initWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            const { type, payload, error } = e.data;
            if (type === 'result') {
                if (payload.aborted) return;

                this.state.refX = payload.refX;
                this.state.refY = payload.refY;

                this.state.offsetX = sub_coord(this.config.centerX, this.state.refX);
                this.state.offsetY = sub_coord(this.config.centerY, this.state.refY);

                const requiredSize = payload.orbit.byteLength;
                if (requiredSize > this.referenceOrbitSize) {
                    this.referenceOrbitSize = requiredSize;
                    this.referenceOrbitBuffer = this.device.createBuffer({
                        size: this.referenceOrbitSize,
                        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                    });
                }

                this.device.queue.writeBuffer(this.referenceOrbitBuffer, 0, payload.orbit);
                this.createBindGroup();

                this.config.iter = payload.iter;
                this.updateUI();
                this.updateURL();

                this.state.isPendingUpdate = false;
                this.requestRender();
            } else if (type === 'error') {
                console.error("Worker error:", error);
                this.state.isPendingUpdate = false;
            }

            this.state.workerBusy = false;
        };
    }

    updateReference() {
        if (this.state.workerBusy && this.currentAbortArray) {
            Atomics.store(this.currentAbortArray, 0, 1);
        }
        this.state.workerBusy = true;

        const aspect = this.el.canvas.width / this.el.canvas.height;
        const logZoom = Math.log10(this.config.zoom);
        const requestedIter = Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);

        const abortBuffer = new SharedArrayBuffer(4);
        this.currentAbortArray = new Int32Array(abortBuffer);

        this.worker.postMessage({
            type: 'calculate_reference',
            payload: {
                centerX: this.config.centerX,
                centerY: this.config.centerY,
                scale: this.config.zoom,
                aspect,
                iter: requestedIter,
                abortBuffer
            }
        });
    }

    interact(needsNewReference = true) {
        this.state.isPendingUpdate = true;
        this.updateUI();
        this.requestRender();

        if (needsNewReference) {
            this.updateReference();
        } else {
            this.updateURL();
            if (this._interactionTimeout) clearTimeout(this._interactionTimeout);
            this._interactionTimeout = setTimeout(() => {
                this.state.isPendingUpdate = false;
                this.requestRender();
            }, 250);
        }
    }

    requestRender() {
        this.state.currentPass = 0;
        if (!this.state.isFrameScheduled) {
            this.state.isFrameScheduled = true;
            requestAnimationFrame(this.frame);
        }
    }

    resizeOffscreenTexture(w, h) {
        if (this.offscreenTexture && this.offscreenTexture.width === w && this.offscreenTexture.height === h) return;
        if (this.offscreenTexture) this.offscreenTexture.destroy();
        if (w === 0 || h === 0) return;

        this.offscreenTexture = this.device.createTexture({
            size: [w, h, 1],
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this.offscreenTextureView = this.offscreenTexture.createView();
    }

    frame() {
        this.state.isFrameScheduled = false;

        const { dpr, width, height, currentPixels, workerBusy, isPendingUpdate } = this.state;

        const interactionMaxOps = 40000000;
        const progressiveMaxOps = 200000000;
        let targetScale = 1.0;

        const isDragging = this.state.pointers.size > 0;

        if (isDragging || workerBusy || isPendingUpdate) {
            const idealPixels = interactionMaxOps / (this.config.iter || 1);
            targetScale = Math.sqrt(idealPixels / currentPixels);
            targetScale = Math.min(0.5, targetScale);
            this.state.totalPasses = 1;
        } else {
            const totalOps = currentPixels * this.config.iter;
            this.state.totalPasses = Math.max(1, Math.ceil(totalOps / progressiveMaxOps));
        }

        if (width > 0 && height > 0) {
            const targetWidth = Math.max(1, Math.min(Math.floor(width * dpr * targetScale), this.device.limits.maxTextureDimension2D));
            const targetHeight = Math.max(1, Math.min(Math.floor(height * dpr * targetScale), this.device.limits.maxTextureDimension2D));

            if (this.el.canvas.width !== targetWidth || this.el.canvas.height !== targetHeight) {
                this.el.canvas.width = targetWidth;
                this.el.canvas.height = targetHeight;
                this.state.currentPass = 0;
            }
        }

        if (this.state.currentPass >= this.state.totalPasses && !this.state.screenshotRequested) {
            return;
        }

        this.resizeOffscreenTexture(this.el.canvas.width, this.el.canvas.height);

        this.config.zoom = this.state.targetZoom;
        this.updateUI();

        const aspect = this.el.canvas.width / this.el.canvas.height;
        const dv = this.uniformDataView;

        dv.setFloat32(0, this.state.offsetX, true);
        dv.setFloat32(4, this.state.offsetY, true);
        dv.setFloat32(8, this.config.zoom, true);
        dv.setFloat32(12, aspect, true);
        dv.setUint32(16, this.config.iter, true);
        dv.setFloat32(20, this.config.hue, true);
        dv.setFloat32(24, this.config.hueStep, true);
        dv.setFloat32(28, this.config.rotation, true);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

        const commandEncoder = this.device.createCommandEncoder();

        if (this.state.currentPass < this.state.totalPasses) {
            const sliceHeight = Math.ceil(this.el.canvas.height / this.state.totalPasses);
            const yOffset = this.state.currentPass * sliceHeight;
            const currentSliceHeight = Math.min(sliceHeight, this.el.canvas.height - yOffset);

            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.offscreenTextureView,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: this.state.currentPass === 0 ? 'clear' : 'load',
                    storeOp: 'store',
                }],
            });

            passEncoder.setPipeline(this.pipeline);
            passEncoder.setViewport(0, 0, this.el.canvas.width, this.el.canvas.height, 0, 1);
            if (currentSliceHeight > 0) {
                passEncoder.setScissorRect(0, yOffset, this.el.canvas.width, currentSliceHeight);
            }

            if (this.bindGroup) {
                passEncoder.setBindGroup(0, this.bindGroup);
                passEncoder.draw(6);
            }
            passEncoder.end();

            this.state.currentPass++;
        }

        const destTexture = this.context.getCurrentTexture();
        const postBindGroup = this.device.createBindGroup({
            layout: this.postPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.offscreenTextureView },
                { binding: 1, resource: this.sampler },
            ],
        });

        const postPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: destTexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        postPass.setPipeline(this.postPipeline);
        postPass.setBindGroup(0, postBindGroup);
        postPass.draw(6);
        postPass.end();

        this.device.queue.submit([commandEncoder.finish()]);

        if (this.state.totalPasses === 1 && this.el.canvas.width > 0 && this.el.canvas.height > 0 && this.el.bgCanvas) {
            const bgCtx = this.el.bgCanvas.getContext('2d', { alpha: false, desynchronized: true });
            if (this.el.bgCanvas.width !== this.el.canvas.width || this.el.bgCanvas.height !== this.el.canvas.height) {
                this.el.bgCanvas.width = this.el.canvas.width;
                this.el.bgCanvas.height = this.el.canvas.height;
            }
            bgCtx.drawImage(this.el.canvas, 0, 0);
        }

        if (this.state.screenshotRequested && this.state.currentPass >= this.state.totalPasses) {
            this.state.screenshotRequested = false;
            const d = new Date();
            const timestamp = "" + d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0') +
                d.getHours().toString().padStart(2, '0') + d.getMinutes().toString().padStart(2, '0') + d.getSeconds().toString().padStart(2, '0');

            this.el.canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = `fractious-${timestamp}.png`;
                link.href = url;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, "image/png");
        }

        if (this.state.currentPass < this.state.totalPasses || this.state.screenshotRequested) {
            if (!this.state.isFrameScheduled) {
                this.state.isFrameScheduled = true;
                this.device.queue.onSubmittedWorkDone().then(() => {
                    requestAnimationFrame(this.frame);
                });
            }
        }
    }

    handlePointerDown(e) {
        this.state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.el.canvas.setPointerCapture(e.pointerId);

        if (this.state.pointers.size === 1) {
            this.state.lastX = e.clientX;
            this.state.lastY = e.clientY;
            this.el.crosshair.classList.add('moving');
        } else if (this.state.pointers.size === 2) {
            const points = Array.from(this.state.pointers.values());
            const dx = points[0].x - points[1].x;
            const dy = points[0].y - points[1].y;
            this.state.prevDiff = Math.hypot(dx, dy);
            this.state.prevAngle = Math.atan2(dy, dx);
            this.state.prevCenter = {
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };
        }
    }

    handlePointerMove(e) {
        if (!this.state.pointers.has(e.pointerId)) return;
        this.state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        const heightComplex = 2.0 * this.config.zoom;
        const scaleY = heightComplex / this.el.canvas.clientHeight;

        if (this.state.pointers.size === 2) {
            const points = Array.from(this.state.pointers.values());
            const dx = points[0].x - points[1].x;
            const dy = points[0].y - points[1].y;
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
                x: (points[0].x + points[1].x) / 2,
                y: (points[0].y + points[1].y) / 2
            };

            if (this.state.prevCenter) {
                const moveX = curCenter.x - this.state.prevCenter.x;
                const moveY = curCenter.y - this.state.prevCenter.y;

                const s = scaleY;
                const c = Math.cos(this.config.rotation);
                const sn = Math.sin(this.config.rotation);

                const dCx = (moveX * c + moveY * sn) * s;
                const dCy = (moveY * c - moveX * sn) * s;

                this.state.offsetX -= dCx;
                this.state.offsetY += dCy;
            }
            this.state.prevCenter = curCenter;

        } else if (this.state.pointers.size === 1) {
            const dx = e.clientX - this.state.lastX;
            const dy = e.clientY - this.state.lastY;
            this.state.lastX = e.clientX;
            this.state.lastY = e.clientY;

            const s = scaleY;
            const c = Math.cos(this.config.rotation);
            const sn = Math.sin(this.config.rotation);

            const dCx = (dx * c + dy * sn) * s;
            const dCy = (dy * c - dx * sn) * s;

            this.state.offsetX -= dCx;
            this.state.offsetY += dCy;
        }

        this.config.centerX = add_coord(this.state.refX, this.state.offsetX);
        this.config.centerY = add_coord(this.state.refY, this.state.offsetY);
        this.interact(true);
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
            this.el.crosshair.classList.remove('moving');
        }
        this.requestRender();
    }

    handleWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.05 : 1.0 / 1.05;
        this.state.targetZoom *= factor;
        this.interact();
    }

    bindEvents() {
        const { canvas } = this.el;

        const observer = new ResizeObserver(() => {
            this.handleResize();
            this.requestRender();
        });
        observer.observe(canvas);

        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        ['pointerup', 'pointercancel', 'pointerout', 'pointerleave'].forEach(e =>
            canvas.addEventListener(e, this.handlePointerUp)
        );
        canvas.addEventListener('wheel', this.handleWheel, { passive: false });

        this.bindInputEvents();
        this.bindButtonEvents();
    }

    bindInputEvents() {
        const { inputs } = this.el;

        inputs.c_re.addEventListener('change', () => {
            this.config.centerX = inputs.c_re.value;
            this.state.offsetX = sub_coord(this.config.centerX, this.state.refX);
            this.interact(true);
        });

        inputs.c_im.addEventListener('change', () => {
            this.config.centerY = inputs.c_im.value;
            this.state.offsetY = sub_coord(this.config.centerY, this.state.refY);
            this.interact(true);
        });

        inputs.zoom.addEventListener('change', () => {
            const level = parseFloat(inputs.zoom.value);
            if (!isNaN(level)) {
                this.config.zoom = Math.pow(10, -level);
                this.state.targetZoom = this.config.zoom;
                this.interact(true);
            } else this.updateUI();
        });

        inputs.rotation.addEventListener('change', () => {
            const deg = parseFloat(inputs.rotation.value);
            if (!isNaN(deg)) {
                this.config.rotation = deg * Math.PI / 180;
                this.interact(false);
            } else this.updateUI();
        });

        inputs.hue.addEventListener('change', () => {
            const v = parseFloat(inputs.hue.value);
            if (!isNaN(v)) { this.config.hue = v; this.interact(false); } else this.updateUI();
        });

        inputs.hueStep.addEventListener('change', () => {
            const v = parseFloat(inputs.hueStep.value);
            if (!isNaN(v)) { this.config.hueStep = v; this.interact(false); } else this.updateUI();
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
            this.interact(true);
        };

        const aspect = () => this.el.canvas.width / this.el.canvas.height;

        const buttonActions = {
            'btn-up': () => moveView(0, moveStep * this.config.zoom),
            'btn-down': () => moveView(0, -moveStep * this.config.zoom),
            'btn-left': () => moveView(-moveStep * this.config.zoom * aspect(), 0),
            'btn-right': () => moveView(moveStep * this.config.zoom * aspect(), 0),
            'btn-zoom-in': () => { this.state.targetZoom /= 1.5; this.interact(true); },
            'btn-zoom-out': () => { this.state.targetZoom *= 1.5; this.interact(true); },
            'btn-rotate-cw': () => { this.config.rotation += Math.PI / 12; this.interact(false); },
            'btn-rotate-ccw': () => { this.config.rotation -= Math.PI / 12; this.interact(false); },
            'btn-cycle-in': () => { this.config.hueStep += 0.05; this.interact(false); },
            'btn-cycle-out': () => { this.config.hueStep -= 0.05; this.interact(false); },
            'btn-hue-left': () => { this.config.hue -= 0.05; this.interact(false); },
            'btn-hue-right': () => { this.config.hue += 0.05; this.interact(false); },
            'btn-screenshot': () => {
                this.state.screenshotRequested = true;
                if (!this.state.isFrameScheduled) {
                    this.state.isFrameScheduled = true;
                    requestAnimationFrame(this.frame);
                }
            }
        };

        for (const [id, handler] of Object.entries(buttonActions)) {
            document.getElementById(id).onclick = handler;
        }

        const btnFullscreen = document.getElementById('btn-fullscreen');
        btnFullscreen.onclick = () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else if (document.exitFullscreen) document.exitFullscreen();
        };

        document.addEventListener('fullscreenchange', () => {
            btnFullscreen.textContent = document.fullscreenElement ? '⏬' : '⏫';
        });
    }
}

const app = new Fractious();
app.init();