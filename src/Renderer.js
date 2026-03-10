import shaderCode from './renderer/shader.wgsl?raw';
import postShaderCode from './renderer/post.wgsl?raw';

export class Renderer {
    constructor(canvas, bgCanvas) {
        this.canvas = canvas;
        this.bgCanvas = bgCanvas;

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
    }

    async init() {
        if (!navigator.gpu) {
            console.error("WebGPU not supported");
            document.body.textContent = "WebGPU not supported in this browser.";
            return false;
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.error("No WebGPU adapter found");
            return false;
        }

        this.device = await adapter.requestDevice();
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context = this.canvas.getContext('webgpu');

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

        // initial minimal size, will be updated when orbit arrives
        this.referenceOrbitSize = 200 * 2 * 4;
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

        const postModule = this.device.createShaderModule({ code: postShaderCode });

        this.postPipeline = this.device.createRenderPipeline({
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

    updateOrbitBuffer(orbitArrayBuffer) {
        const requiredSize = orbitArrayBuffer.byteLength;
        if (requiredSize > this.referenceOrbitSize) {
            this.referenceOrbitSize = requiredSize;
            this.referenceOrbitBuffer = this.device.createBuffer({
                size: this.referenceOrbitSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }
        this.device.queue.writeBuffer(this.referenceOrbitBuffer, 0, orbitArrayBuffer);
        this.createBindGroup();
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

    render(config, state) {
        const { dpr, width, height, currentPixels, workerBusy, isPendingUpdate } = state;

        const interactionMaxOps = 40000000;
        const progressiveMaxOps = 200000000;
        let targetScale = 1.0;

        const isDragging = state.pointers.size > 0;

        if (isDragging || workerBusy || isPendingUpdate) {
            const idealPixels = interactionMaxOps / (config.iter || 1);
            targetScale = Math.sqrt(idealPixels / currentPixels);
            targetScale = Math.min(0.5, targetScale);
            state.totalPasses = 1;
        } else {
            const totalOps = currentPixels * config.iter;
            state.totalPasses = Math.max(1, Math.ceil(totalOps / progressiveMaxOps));
        }

        if (width > 0 && height > 0) {
            const targetWidth = Math.max(1, Math.min(Math.floor(width * dpr * targetScale), this.device.limits.maxTextureDimension2D));
            const targetHeight = Math.max(1, Math.min(Math.floor(height * dpr * targetScale), this.device.limits.maxTextureDimension2D));

            if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
                this.canvas.width = targetWidth;
                this.canvas.height = targetHeight;
                state.currentPass = 0;
            }
        }

        if (state.currentPass >= state.totalPasses && !state.screenshotRequested) {
            return false; // No more passes needed
        }

        this.resizeOffscreenTexture(this.canvas.width, this.canvas.height);

        config.zoom = state.targetZoom;

        const aspect = this.canvas.width / this.canvas.height;
        const dv = this.uniformDataView;

        dv.setFloat32(0, state.offsetX, true);
        dv.setFloat32(4, state.offsetY, true);
        dv.setFloat32(8, config.zoom, true);
        dv.setFloat32(12, aspect, true);
        dv.setUint32(16, config.iter, true);
        dv.setFloat32(20, config.hue, true);
        dv.setFloat32(24, config.hueStep, true);
        dv.setFloat32(28, config.rotation, true);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

        const commandEncoder = this.device.createCommandEncoder();

        if (state.currentPass < state.totalPasses) {
            const sliceHeight = Math.ceil(this.canvas.height / state.totalPasses);
            const yOffset = state.currentPass * sliceHeight;
            const currentSliceHeight = Math.min(sliceHeight, this.canvas.height - yOffset);

            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: this.offscreenTextureView,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: state.currentPass === 0 ? 'clear' : 'load',
                    storeOp: 'store',
                }],
            });

            passEncoder.setPipeline(this.pipeline);
            passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
            if (currentSliceHeight > 0) {
                passEncoder.setScissorRect(0, yOffset, this.canvas.width, currentSliceHeight);
            }

            if (this.bindGroup) {
                passEncoder.setBindGroup(0, this.bindGroup);
                passEncoder.draw(6);
            }
            passEncoder.end();

            state.currentPass++;
        }

        const destTexture = this.context.getCurrentTexture();
        if (!destTexture) return false;

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
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        postPass.setPipeline(this.postPipeline);
        postPass.setBindGroup(0, postBindGroup);
        postPass.draw(6);
        postPass.end();

        this.device.queue.submit([commandEncoder.finish()]);

        if (state.totalPasses === 1 && this.canvas.width > 0 && this.canvas.height > 0 && this.bgCanvas) {
            const bgCtx = this.bgCanvas.getContext('2d', { alpha: false, desynchronized: true });
            if (this.bgCanvas.width !== this.canvas.width || this.bgCanvas.height !== this.canvas.height) {
                this.bgCanvas.width = this.canvas.width;
                this.bgCanvas.height = this.canvas.height;
            }
            bgCtx.drawImage(this.canvas, 0, 0);
        }

        if (state.screenshotRequested && state.currentPass >= state.totalPasses) {
            state.screenshotRequested = false;
            const d = new Date();
            const timestamp = "" + d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0') +
                d.getHours().toString().padStart(2, '0') + d.getMinutes().toString().padStart(2, '0') + d.getSeconds().toString().padStart(2, '0');

            this.canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = `fractious-${timestamp}.png`;
                link.href = url;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, "image/png");
        }

        return state.currentPass < state.totalPasses || state.screenshotRequested;
    }

    onSubmittedWorkDone() {
        return this.device.queue.onSubmittedWorkDone();
    }
}