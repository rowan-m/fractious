import shaderCode from './renderer/shader.wgsl?raw';
import postShaderCode from './renderer/post.wgsl?raw';

const INTERACTION_MAX_OPS = 20000000;
const PROGRESSIVE_MAX_OPS = 25000000;
const INTERACTION_SCALE_LIMIT = 0.5;

export class Renderer {
  constructor(canvas, bgCanvas) {
    this.canvas = canvas;
    this.bgCanvas = bgCanvas;

    this.device = null;
    this.context = null;
    this.format = null;
    this.pipelineF32 = null;
    this.pipelineDS = null;
    this.pipelineQS = null;
    this.postPipeline = null;
    this.sampler = null;
    this.bindGroupF32 = null;
    this.bindGroupDS = null;
    this.bindGroupQS = null;
    this.postBindGroup = null;
    this.uniformBuffer = null;
    this.referenceOrbitBuffer = null;
    this.referenceOrbitSize = 0;
    this.referenceOrbitMaxIter = 200;
    this.offscreenTexture = null;
    this.offscreenTextureView = null;
    this.lastPipelineName = null;
    this.uniformBufferSize = 80;
    this.uniformData = new ArrayBuffer(this.uniformBufferSize);
    this.uniformDataView = new DataView(this.uniformData);
  }

  _showFatalError(message) {
    document.body.style.color = '#f1f5f9';
    document.body.style.padding = '2rem';
    document.body.textContent = message;
  }

  async init() {
    if (!navigator.gpu) {
      console.error('WebGPU not supported');
      this._showFatalError('WebGPU not supported in this browser.');
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.error('No WebGPU adapter found');
      this._showFatalError('No WebGPU adapter found in this browser.');
      return false;
    }

    this.device = await adapter.requestDevice();
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = this.canvas.getContext('webgpu');

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });

    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // initial minimal size, will be updated when orbit arrives
    this.referenceOrbitSize = (200 + 1) * 8 * 4;
    this.referenceOrbitBuffer = this.device.createBuffer({
      size: Math.max(this.referenceOrbitSize, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const module = this.device.createShaderModule({ code: shaderCode });
    const postModule = this.device.createShaderModule({ code: postShaderCode });

    // Parallelize pipeline compilations asynchronously on background helper threads
    const [pipelineF32, pipelineDS, pipelineQS, postPipeline] =
      await Promise.all([
        this.device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs_main' },
          fragment: {
            module,
            entryPoint: 'fs_main_f32',
            targets: [{ format: this.format }],
          },
          primitive: { topology: 'triangle-list' },
        }),
        this.device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs_main' },
          fragment: {
            module,
            entryPoint: 'fs_main_ds',
            targets: [{ format: this.format }],
          },
          primitive: { topology: 'triangle-list' },
        }),
        this.device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs_main' },
          fragment: {
            module,
            entryPoint: 'fs_main_qs',
            targets: [{ format: this.format }],
          },
          primitive: { topology: 'triangle-list' },
        }),
        this.device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module: postModule, entryPoint: 'vs_main' },
          fragment: {
            module: postModule,
            entryPoint: 'fs_main',
            targets: [{ format: this.format }],
          },
          primitive: { topology: 'triangle-list' },
        }),
      ]);

    this.pipelineF32 = pipelineF32;
    this.pipelineDS = pipelineDS;
    this.pipelineQS = pipelineQS;
    this.postPipeline = postPipeline;

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    return true;
  }

  createBindGroup() {
    this.bindGroupF32 = this.device.createBindGroup({
      layout: this.pipelineF32.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.referenceOrbitBuffer } },
      ],
    });
    this.bindGroupDS = this.device.createBindGroup({
      layout: this.pipelineDS.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.referenceOrbitBuffer } },
      ],
    });
    this.bindGroupQS = this.device.createBindGroup({
      layout: this.pipelineQS.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.referenceOrbitBuffer } },
      ],
    });
  }

  updateOrbitBuffer(orbitArrayBuffer) {
    const requiredSize = orbitArrayBuffer.byteLength;
    // The worker truncates the orbit at its escape point, so the last stored
    // point index is the valid reference length.
    this.referenceOrbitMaxIter = Math.max(0, Math.floor(requiredSize / 32) - 1);

    let bufferRecreated = false;
    if (requiredSize > this.referenceOrbitSize) {
      if (this.referenceOrbitBuffer) {
        this.referenceOrbitBuffer.destroy();
      }
      this.referenceOrbitSize = requiredSize;
      this.referenceOrbitBuffer = this.device.createBuffer({
        size: this.referenceOrbitSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      bufferRecreated = true;
    }
    this.device.queue.writeBuffer(
      this.referenceOrbitBuffer,
      0,
      orbitArrayBuffer,
    );

    // ⚡ Bolt: Avoid redundant GPUBindGroup re-creation. writeBuffer updates
    // data in-place. Only re-create if the buffer itself was newly allocated.
    if (bufferRecreated || !this.bindGroupQS) {
      this.createBindGroup();
    }
  }

  resizeOffscreenTexture(w, h) {
    if (
      this.offscreenTexture &&
      this.offscreenTexture.width === w &&
      this.offscreenTexture.height === h
    )
      return;
    if (this.offscreenTexture) this.offscreenTexture.destroy();
    if (w === 0 || h === 0) return;

    this.offscreenTexture = this.device.createTexture({
      size: [w, h, 1],
      format: this.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.offscreenTextureView = this.offscreenTexture.createView();

    // ⚡ Bolt: Cache postBindGroup here rather than recreating per-pass.
    // It only needs recreation when the offscreen texture is resized.
    this.postBindGroup = this.device.createBindGroup({
      layout: this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.offscreenTextureView },
        { binding: 1, resource: this.sampler },
      ],
    });
  }

  _getPrecisionTier(zoom) {
    const logZoom = -Math.log10(zoom);
    if (logZoom < 7.0) {
      return {
        logZoom,
        opsMultiplier: 12.0, // Tier 1: F32 (~300M ops/slice -> ~15-20ms worst-case interior slice)
        pipeline: this.pipelineF32,
        bindGroup: this.bindGroupF32,
        name: 'F32 (Tier 1 - Native Hardware)',
      };
    }
    if (logZoom < 14.0) {
      return {
        logZoom,
        opsMultiplier: 3.0, // Tier 2: Double-Single (~75M ops/slice)
        pipeline: this.pipelineDS,
        bindGroup: this.bindGroupDS,
        name: 'Double-Single (Tier 2 - Emulated 64-bit)',
      };
    }
    return {
      logZoom,
      opsMultiplier: 1.0, // Tier 3: Quad-Single (~25M ops/slice)
      pipeline: this.pipelineQS,
      bindGroup: this.bindGroupQS,
      name: 'Quad-Single (Tier 3 - Emulated 128-bit)',
    };
  }

  _getSliceGeometry(state) {
    if (state.totalPasses <= 1 || this.canvas.height <= 0) {
      return {
        yOffset: 0,
        currentSliceHeight: this.canvas.height,
        sliceScale: 1.0,
        sliceOffset: 0.0,
      };
    }
    const sliceHeight = Math.ceil(this.canvas.height / state.totalPasses);
    const yOffset = state.currentPass * sliceHeight;
    const currentSliceHeight = Math.min(
      sliceHeight,
      this.canvas.height - yOffset,
    );
    const sliceScale = currentSliceHeight / this.canvas.height;
    // Invert Y coordinate mapping because WebGPU Scissor Rect Y starts at TOP (0),
    // but WebGPU NDC Y starts at BOTTOM (-1.0).
    const yOffsetBottom = this.canvas.height - yOffset - currentSliceHeight;
    const sliceOffset =
      -1.0 + (2.0 * yOffsetBottom + currentSliceHeight) / this.canvas.height;
    return { yOffset, currentSliceHeight, sliceScale, sliceOffset };
  }

  _calculatePassesAndResize(config, state, tier) {
    const { dpr, width, height, currentPixels, workerBusy, isPendingUpdate } =
      state;
    let targetScale = 1.0;

    const isDragging = state.pointers.size > 0;

    if (isDragging || workerBusy || isPendingUpdate) {
      const idealPixels = INTERACTION_MAX_OPS / (config.iter || 1);
      targetScale = Math.sqrt(idealPixels / currentPixels);
      targetScale = Math.min(INTERACTION_SCALE_LIMIT, targetScale);
      state.totalPasses = 1;
    } else {
      const totalOps = currentPixels * config.iter;
      state.totalPasses = Math.max(
        1,
        Math.ceil(totalOps / (PROGRESSIVE_MAX_OPS * tier.opsMultiplier)),
      );
    }

    if (width > 0 && height > 0) {
      const targetWidth = Math.max(
        1,
        Math.min(
          Math.floor(width * dpr * targetScale),
          this.device.limits.maxTextureDimension2D,
        ),
      );
      const targetHeight = Math.max(
        1,
        Math.min(
          Math.floor(height * dpr * targetScale),
          this.device.limits.maxTextureDimension2D,
        ),
      );

      // Clamp total progressive passes to the physical canvas height to avoid empty/redundant draw calls.
      if (!(isDragging || workerBusy || isPendingUpdate)) {
        state.totalPasses = Math.min(state.totalPasses, targetHeight);
      }

      if (
        this.canvas.width !== targetWidth ||
        this.canvas.height !== targetHeight
      ) {
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
        state.currentPass = 0;
      }
    }
  }

  _updateUniforms(config, state, slice) {
    const aspect = this.canvas.width / this.canvas.height;
    const dv = this.uniformDataView;

    const writeSplitF64 = (val, off0, off1, off2, off3) => {
      const fround = Math.fround;
      const part0 = fround(val);
      const r1 = val - part0;
      const part1 = fround(r1);
      const r2 = r1 - part1;
      const part2 = fround(r2);
      dv.setFloat32(off0, part0, true);
      dv.setFloat32(off1, part1, true);
      dv.setFloat32(off2, part2, true);
      dv.setFloat32(off3, 0.0, true);
    };

    const zoom = config.zoom || 1.0;
    writeSplitF64(state.offsetX, 0, 8, 16, 24);
    writeSplitF64(state.offsetY, 4, 12, 20, 28);
    writeSplitF64(zoom, 32, 36, 40, 44);

    const maxBufferIter = Math.max(
      0,
      Math.floor(this.referenceOrbitSize / 32) - 1,
    );
    const refIter = Math.max(
      1,
      Math.min(this.referenceOrbitMaxIter || maxBufferIter, maxBufferIter),
    );

    dv.setFloat32(48, aspect, true);
    dv.setUint32(52, config.iter, true);
    dv.setFloat32(56, config.hue, true);
    dv.setFloat32(60, config.hueStep, true);
    dv.setFloat32(64, config.rotation, true);
    dv.setFloat32(68, slice.sliceScale, true);
    dv.setFloat32(72, slice.sliceOffset, true);
    dv.setUint32(76, refIter, true);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  _dispatchDrawCalls(state, tier, slice) {
    const commandEncoder = this.device.createCommandEncoder();

    if (state.currentPass < state.totalPasses) {
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.offscreenTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: state.currentPass === 0 ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      });

      if (tier.name !== this.lastPipelineName) {
        console.info(
          `[WebGPU] Active Precision: ${tier.name} (Log10 Zoom: -${tier.logZoom.toFixed(2)})`,
        );
        this.lastPipelineName = tier.name;
      }

      passEncoder.setPipeline(tier.pipeline);
      passEncoder.setViewport(
        0,
        0,
        this.canvas.width,
        this.canvas.height,
        0,
        1,
      );
      if (slice.currentSliceHeight > 0) {
        passEncoder.setScissorRect(
          0,
          slice.yOffset,
          this.canvas.width,
          slice.currentSliceHeight,
        );
      }

      if (tier.bindGroup) {
        passEncoder.setBindGroup(0, tier.bindGroup);
        passEncoder.draw(6);
      }
      passEncoder.end();

      state.currentPass++;
    }

    const destTexture = this.context.getCurrentTexture();
    if (!destTexture) return false;

    if (this.postBindGroup) {
      const postPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: destTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      postPass.setPipeline(this.postPipeline);
      postPass.setBindGroup(0, this.postBindGroup);
      postPass.draw(6);
      postPass.end();
    }

    this.device.queue.submit([commandEncoder.finish()]);
    return true;
  }

  _updateBackgroundCanvas(state) {
    if (
      state.currentPass >= state.totalPasses &&
      this.canvas.width > 0 &&
      this.canvas.height > 0 &&
      this.bgCanvas
    ) {
      const bgCtx = this.bgCanvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
      });
      if (
        this.bgCanvas.width !== this.canvas.width ||
        this.bgCanvas.height !== this.canvas.height
      ) {
        this.bgCanvas.width = this.canvas.width;
        this.bgCanvas.height = this.canvas.height;
      }
      bgCtx.drawImage(this.canvas, 0, 0);
    }
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _handleScreenshot(state) {
    if (state.screenshotRequested && state.currentPass >= state.totalPasses) {
      state.screenshotRequested = false;
      const d = new Date();
      const timestamp =
        '' +
        d.getFullYear() +
        (d.getMonth() + 1).toString().padStart(2, '0') +
        d.getDate().toString().padStart(2, '0') +
        d.getHours().toString().padStart(2, '0') +
        d.getMinutes().toString().padStart(2, '0') +
        d.getSeconds().toString().padStart(2, '0');

      this.canvas.toBlob((blob) => {
        if (blob) this._downloadBlob(blob, `fractious-${timestamp}.png`);
      }, 'image/png');
    }
  }

  _handleShare(state) {
    if (state.shareRequested && state.currentPass >= state.totalPasses) {
      state.shareRequested = false;

      this.canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], 'mandelbrot-fractious.png', {
          type: 'image/png',
        });

        const shareData = {
          title: 'Fractious Mandelbrot',
          text: 'Look what I found in the Mandelbrot fractal with #fractious',
          url: window.location.href,
        };

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }

        if (navigator.share) {
          navigator.share(shareData).catch((err) => {
            console.error('Error sharing:', err);
          });
        } else {
          this._downloadBlob(blob, 'mandelbrot-fractious.png');
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
              .writeText(window.location.href)
              .catch((err) => console.error('Error copying link:', err));
          }
          const btnShare = document.getElementById('btn-share');
          if (btnShare) {
            const target = btnShare.querySelector('span') || btnShare;
            const prevText = target.textContent;
            const prevTitle = btnShare.title;
            target.textContent = '✅';
            btnShare.title = 'Link copied & screenshot downloaded!';
            setTimeout(() => {
              target.textContent = prevText;
              btnShare.title = prevTitle;
            }, 1500);
          }
        }
      }, 'image/png');
    }
  }

  render(config, state) {
    const tier = this._getPrecisionTier(state.targetZoom);
    this._calculatePassesAndResize(config, state, tier);

    if (
      state.currentPass >= state.totalPasses &&
      !state.screenshotRequested &&
      !state.shareRequested
    ) {
      return false; // No more passes needed
    }

    this.resizeOffscreenTexture(this.canvas.width, this.canvas.height);

    config.zoom = state.targetZoom;

    const slice = this._getSliceGeometry(state);
    this._updateUniforms(config, state, slice);

    const drawSuccess = this._dispatchDrawCalls(state, tier, slice);
    if (!drawSuccess) return false;

    this._updateBackgroundCanvas(state);
    this._handleScreenshot(state);
    this._handleShare(state);

    return (
      state.currentPass < state.totalPasses ||
      state.screenshotRequested ||
      state.shareRequested
    );
  }

  onSubmittedWorkDone() {
    return this.device.queue.onSubmittedWorkDone();
  }
}
