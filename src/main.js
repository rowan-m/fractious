import init, { add_coord, init_hooks, sub_coord } from '../wasm/pkg/wasm.js';
import shaderCode from './renderer/shader.wgsl?raw';

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
        this.bindGroup = null;
        this.uniformBuffer = null;
        this.referenceOrbitBuffer = null;
        this.referenceOrbitSize = 0;
        this.offscreenTexture = null;
        this.offscreenTextureView = null;
        this.uniformBufferSize = 32;

        this.frame = this.frame.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.commitAndRecalc = this.debounce(() => this.updateReference(), 500);
    }

    debounce(func, wait) {
        let timeout;
        let cancel = () => clearTimeout(timeout);
        let wrapped = (...args) => {
            cancel();
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
        wrapped.cancel = cancel;
        return wrapped;
    }

    async init() {
        await init();
        init_hooks();

        this.parseURL();
        const gpuReady = await this.initWebGPU();
        if (!gpuReady) return;

        this.initWorker();
        this.bindEvents();

        this.updateUI();
        this.updateReference();
        this.requestRender();
    }

    parseURL() {
        const params = new URLSearchParams(window.location.search);
        
        if (params.has('x')) this.config.centerX = params.get('x');
        if (params.has('y')) this.config.centerY = params.get('y');
        
        this.state.refX = this.config.centerX;
        this.state.refY = this.config.centerY;

        if (params.has('z')) this.config.zoom = Math.pow(10, -parseFloat(params.get('z')));
        if (params.has('r')) this.config.rotation = parseFloat(params.get('r'));
        if (params.has('h')) this.config.hue = parseFloat(params.get('h'));
        if (params.has('s')) this.config.hueStep = parseFloat(params.get('s'));

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
        const inputs = this.el.inputs;
        if (document.activeElement !== inputs.c_re) inputs.c_re.value = this.config.centerX.substring(0, 15);
        if (document.activeElement !== inputs.c_im) inputs.c_im.value = this.config.centerY.substring(0, 15);
        if (document.activeElement !== inputs.zoom) inputs.zoom.value = (-Math.log10(this.config.zoom)).toFixed(2);
        
        if (document.activeElement !== inputs.rotation) {
            const deg = (this.config.rotation * 180 / Math.PI) % 360;
            inputs.rotation.value = deg.toFixed(1);
        }
        
        inputs.iterations.value = this.config.iter;
        if (document.activeElement !== inputs.hue) inputs.hue.value = this.config.hue.toFixed(3);
        if (document.activeElement !== inputs.hueStep) inputs.hueStep.value = this.config.hueStep.toFixed(3);
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
                    this.referenceOrbitBuffer.destroy();
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
                this.el.inputs.c_re.textContent = ""; 
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

    interact() {
        this.state.isPendingUpdate = true;
        this.commitAndRecalc();
        this.requestRender();
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

        const dpr = window.devicePixelRatio || 1;
        const width = this.el.canvas.clientWidth;
        const height = this.el.canvas.clientHeight;
        const currentPixels = (width * dpr) * (height * dpr);
        
        const interactionMaxOps = 40000000;
        const progressiveMaxOps = 200000000;
        let targetScale = 1.0;
        
        const { workerBusy, isPendingUpdate } = this.state;
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
        const uniformData = new ArrayBuffer(this.uniformBufferSize);
        const dv = new DataView(uniformData);

        dv.setFloat32(0, this.state.offsetX, true);
        dv.setFloat32(4, this.state.offsetY, true);
        dv.setFloat32(8, this.config.zoom, true);
        dv.setFloat32(12, aspect, true);
        dv.setUint32(16, this.config.iter, true);
        dv.setFloat32(20, this.config.hue, true);
        dv.setFloat32(24, this.config.hueStep, true);
        dv.setFloat32(28, this.config.rotation, true);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

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
        commandEncoder.copyTextureToTexture(
            { texture: this.offscreenTexture },
            { texture: destTexture },
            [this.el.canvas.width, this.el.canvas.height, 1]
        );

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
            
            const link = document.createElement('a');
            link.download = `fractious-${timestamp}.png`;
            link.href = this.el.canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
            link.click();
        }

        if (this.state.currentPass < this.state.totalPasses || this.state.screenshotRequested) {
            if (!this.state.isFrameScheduled) {
                this.state.isFrameScheduled = true;
                requestAnimationFrame(this.frame);
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
        this.requestRender();
    }

    handlePointerMove(e) {
        if (!this.state.pointers.has(e.pointerId)) return;
        this.state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        const aspect = this.el.canvas.clientWidth / this.el.canvas.clientHeight;
        const widthComplex = 2.0 * this.config.zoom * aspect;
        const heightComplex = 2.0 * this.config.zoom;
        const scaleX = widthComplex / this.el.canvas.clientWidth;
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
        this.updateUI();
        this.interact();
        this.requestRender();
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
        this.requestRender();
    }

    bindEvents() {
        const { canvas } = this.el;
        
        const observer = new ResizeObserver(() => this.requestRender());
        observer.observe(canvas);

        canvas.addEventListener('pointerdown', this.handlePointerDown);
        canvas.addEventListener('pointermove', this.handlePointerMove);
        canvas.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('pointercancel', this.handlePointerUp);
        canvas.addEventListener('pointerout', this.handlePointerUp);
        canvas.addEventListener('pointerleave', this.handlePointerUp);
        canvas.addEventListener('wheel', this.handleWheel, { passive: false });

        this.bindInputEvents();
        this.bindButtonEvents();
    }

    bindInputEvents() {
        const { inputs } = this.el;

        inputs.c_re.addEventListener('change', () => {
            this.config.centerX = inputs.c_re.value;
            this.state.refX = this.config.centerX;
            this.updateReference();
            this.requestRender();
        });

        inputs.c_im.addEventListener('change', () => {
            this.config.centerY = inputs.c_im.value;
            this.state.refY = this.config.centerY;
            this.updateReference();
            this.requestRender();
        });

        inputs.zoom.addEventListener('change', () => {
            const level = parseFloat(inputs.zoom.value);
            if (!isNaN(level)) {
                this.config.zoom = Math.pow(10, -level);
                this.state.targetZoom = this.config.zoom;
                this.interact();
                this.requestRender();
            } else this.updateUI();
        });

        inputs.rotation.addEventListener('change', () => {
            const deg = parseFloat(inputs.rotation.value);
            if (!isNaN(deg)) {
                this.config.rotation = deg * Math.PI / 180;
                this.interact();
                this.requestRender();
            } else this.updateUI();
        });
        
        inputs.hue.addEventListener('change', () => {
            const v = parseFloat(inputs.hue.value);
            if(!isNaN(v)) { this.config.hue = v; this.updateURL(); this.requestRender(); } else this.updateUI();
        });

        inputs.hueStep.addEventListener('change', () => {
            const v = parseFloat(inputs.hueStep.value);
            if(!isNaN(v)) { this.config.hueStep = v; this.updateURL(); this.requestRender(); } else this.updateUI();
        });
    }

    bindButtonEvents() {
        const moveStep = 0.1;

        document.getElementById('btn-up').onclick = () => {
            const dy = moveStep * this.config.zoom;
            this.config.centerY = add_coord(this.config.centerY, dy.toString());
            this.state.refY = this.config.centerY;
            this.updateReference();
            this.requestRender();
        };

        document.getElementById('btn-down').onclick = () => {
            const dy = -moveStep * this.config.zoom;
            this.config.centerY = add_coord(this.config.centerY, dy.toString());
            this.state.refY = this.config.centerY;
            this.updateReference();
            this.requestRender();
        };

        document.getElementById('btn-left').onclick = () => {
            const aspect = this.el.canvas.width / this.el.canvas.height;
            const dx = -moveStep * this.config.zoom * aspect;
            this.config.centerX = add_coord(this.config.centerX, dx.toString());
            this.state.refX = this.config.centerX;
            this.updateReference();
            this.requestRender();
        };

        document.getElementById('btn-right').onclick = () => {
            const aspect = this.el.canvas.width / this.el.canvas.height;
            const dx = moveStep * this.config.zoom * aspect;
            this.config.centerX = add_coord(this.config.centerX, dx.toString());
            this.state.refX = this.config.centerX;
            this.updateReference();
            this.requestRender();
        };

        document.getElementById('btn-zoom-in').onclick = () => {
            this.state.targetZoom /= 1.5;
            this.interact();
            this.requestRender();
        };

        document.getElementById('btn-zoom-out').onclick = () => {
            this.state.targetZoom *= 1.5;
            this.interact();
            this.requestRender();
        };

        document.getElementById('btn-rotate-cw').onclick = () => {
            this.config.rotation += Math.PI / 12;
            this.interact();
            this.requestRender();
        };

        document.getElementById('btn-rotate-ccw').onclick = () => {
            this.config.rotation -= Math.PI / 12;
            this.interact();
            this.requestRender();
        };

        document.getElementById('btn-cycle-in').onclick = () => {
            this.config.hueStep += 0.05;
            this.updateURL();
            this.requestRender();
        };

        document.getElementById('btn-cycle-out').onclick = () => {
            this.config.hueStep -= 0.05;
            this.updateURL();
            this.requestRender();
        };

        document.getElementById('btn-hue-left').onclick = () => {
            this.config.hue -= 0.05;
            this.updateURL();
            this.requestRender();
        };

        document.getElementById('btn-hue-right').onclick = () => {
            this.config.hue += 0.05;
            this.updateURL();
            this.requestRender();
        };

        const btnFullscreen = document.getElementById('btn-fullscreen');
        btnFullscreen.onclick = () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else if (document.exitFullscreen) document.exitFullscreen();
        };

        document.addEventListener('fullscreenchange', () => {
            btnFullscreen.textContent = document.fullscreenElement ? '⏬' : '⏫';
        });

        document.getElementById('btn-screenshot').onclick = () => {
          this.state.screenshotRequested = true;
          if (!this.state.isFrameScheduled) {
            this.state.isFrameScheduled = true;
            requestAnimationFrame(this.frame);
          }
        };
    }
}

const app = new Fractious();
app.init();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });
}