import init, { add_coord, init_hooks, sub_coord } from '../wasm/pkg/wasm.js';
import shaderCode from './renderer/shader.wgsl?raw';

async function run() {
  await init();
  init_hooks();
  // console.log("Wasm initialized in main thread");

  // Initialize Worker
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  const canvas = document.getElementById('fractal');
  if (!navigator.gpu) {
    console.error("WebGPU not supported");
    document.body.innerHTML = "WebGPU not supported in this browser.";
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error("No WebGPU adapter found");
    return;
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  // Parse URL parameters
  const params = new URLSearchParams(window.location.search);
  const urlX = params.get('x');
  const urlY = params.get('y');
  const urlZoom = params.get('zoom');
  const urlHue = params.get('h');
  const urlHueStep = params.get('s');

  // State
  let refX = urlX || "-1.7";
  let refY = urlY || "0.0";
  let centerX = refX;
  let centerY = refY;

  let zoom = urlZoom ? parseFloat(urlZoom) : 2.0;
  let targetZoom = zoom;
  let iter = 200;
  // Calculate initial iter based on zoom immediately
  if (zoom) {
      const logZoom = Math.log10(zoom);
      iter = Math.floor((5000 + 1500 * Math.abs(logZoom)) * 1.5);
  }
  let renderIter = iter;
  let hue = urlHue ? parseFloat(urlHue) : 0.6;
  let hueStep = urlHueStep ? parseFloat(urlHueStep) : 1.0;

  let needUpdateRef = true;

  let offsetX = 0.0;
  let offsetY = 0.0;
  let isDragging = false;
  let isInteracting = false;
  let interactionTimeout;
  let needsRender = true;
  let lastX = 0;
  let lastY = 0;

  const uniformBufferSize = 32;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  let referenceOrbitSize = iter * 2 * 4;
  let referenceOrbitBuffer = device.createBuffer({
    size: Math.max(referenceOrbitSize, 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const module = device.createShaderModule({ code: shaderCode });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs_main',
    },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  let bindGroup;

  const elDouble = {
    c_re: document.getElementById('c_re'),
    c_im: document.getElementById('c_im'),
    zoom: document.getElementById('zoom'),
    hue: document.getElementById('hue'),
    hueStep: document.getElementById('huestep'),
  };

  function updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set('x', centerX);
    params.set('y', centerY);
    params.set('zoom', zoom);
    params.set('h', hue.toFixed(3));
    params.set('s', hueStep.toFixed(3));
    window.history.replaceState({}, '', `?${params.toString()}`);
  }

  function updateUI() {
    if (document.activeElement !== elDouble.c_re) {
        elDouble.c_re.value = centerX.substring(0, 15);
    }
    if (document.activeElement !== elDouble.c_im) {
        elDouble.c_im.value = centerY.substring(0, 15);
    }
    if (document.activeElement !== elDouble.zoom) {
        elDouble.zoom.value = zoom.toExponential(2);
    }
    if (document.activeElement !== elDouble.hue) {
        elDouble.hue.value = hue.toFixed(3);
    }
    if (document.activeElement !== elDouble.hueStep) {
        elDouble.hueStep.value = hueStep.toFixed(3);
    }
  }

  function createBindGroup() {
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: referenceOrbitBuffer } },
      ],
    });
  }

  function debounce(func, wait) {
    let timeout;
    let cancel = () => clearTimeout(timeout);
    let wrapped = function (...args) {
      cancel();
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
    wrapped.cancel = cancel;
    return wrapped;
  }

  // Update Reference Orbit with Auto-Commit
  const commitAndRecalc = debounce(() => {
    // Current logical center
    // Note: centerX/Y are already updated in interact()

    const logZoom = Math.log10(zoom);
    iter = Math.floor((5000 + 1500 * Math.abs(logZoom)) * 1.5);

    updateReference();
  }, 500);

  let isCalculating = false;

  worker.onmessage = (e) => {
      const { type, payload, error } = e.data;
      if (type === 'result') {
          const { orbit, refX: newRefX, refY: newRefY, iter: newIter } = payload;
          
          // console.log("Worker returned reference for", newRefX, newRefY);

          // Update state with confirmed calculation
          refX = newRefX;
          refY = newRefY;
          
          // Recalculate offset relative to the *new* reference
          // Because centerX might have changed slightly while worker was running?
          // Ideally, we treat the worker's refX/Y as the truth for the orbit buffer.
          offsetX = sub_coord(centerX, refX);
          offsetY = sub_coord(centerY, refY);

          const requiredSize = orbit.byteLength;
          if (requiredSize > referenceOrbitSize) {
            referenceOrbitBuffer.destroy();
            referenceOrbitSize = requiredSize;
            referenceOrbitBuffer = device.createBuffer({
                size: referenceOrbitSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
          }

          device.queue.writeBuffer(referenceOrbitBuffer, 0, orbit);
          createBindGroup();

          renderIter = newIter;
          updateUI();
          updateURL();
          needsRender = true;
          
          elDouble.c_re.textContent = ""; // Clear optimizing text if any

      } else if (type === 'error') {
          console.error("Worker error:", error);
      }
      
      isCalculating = false;
      needUpdateRef = false;
  };

  function updateReference() {
    if (isCalculating) return;
    isCalculating = true;

    // console.log("Optimize reference...", centerX, centerY, iter);
    // elDouble.c_re.textContent = "Optimizing..."; // This property doesn't exist on input, removed

    const scale = 1.0 / zoom;
    const aspect = canvas.width / canvas.height;

    worker.postMessage({
        type: 'calculate_reference',
        payload: {
            centerX,
            centerY,
            scale: zoom,
            aspect,
            iter
        }
    });
  }

  function interact() {
    isInteracting = true;
    clearTimeout(interactionTimeout);
    interactionTimeout = setTimeout(() => {
      isInteracting = false;
      needsRender = true;
    }, 300);
    commitAndRecalc();
    needsRender = true;
  }

  function frame() {
    if (needUpdateRef) {
      updateReference();
    }

    // Dynamic Resolution Logic
    const targetScale = (isInteracting || isDragging) ? 0.25 : 1.0;
    const dpr = window.devicePixelRatio || 1;
    // Check if we need to resize
    // We compare canvas width with what it *should* be
    // canvas.clientWidth is the CSS width in pixels
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    if (width > 0 && height > 0) {
        const targetWidth = Math.max(1, Math.min(Math.floor(width * dpr * targetScale), device.limits.maxTextureDimension2D));
        const targetHeight = Math.max(1, Math.min(Math.floor(height * dpr * targetScale), device.limits.maxTextureDimension2D));
        
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            needsRender = true;
        }
    }

    if (!needsRender && !needUpdateRef) {
        requestAnimationFrame(frame);
        return;
    }
    needsRender = false;

    // Direct zoom instead of smooth interpolation
    zoom = targetZoom;
    updateUI();


    const aspect = canvas.width / canvas.height;

    const uniformData = new ArrayBuffer(uniformBufferSize);
    const dv = new DataView(uniformData);

    dv.setFloat32(0, offsetX, true);
    dv.setFloat32(4, offsetY, true);
    dv.setFloat32(8, zoom, true);
    dv.setFloat32(12, aspect, true);
    dv.setUint32(16, renderIter, true);
    dv.setFloat32(20, hue, true);
    dv.setFloat32(24, hueStep, true);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    passEncoder.setPipeline(pipeline);
    if (bindGroup) {
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(6);
    }
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      // Just trigger a render, the frame loop handles the sizing logic
      needsRender = true;
    }
  });
  observer.observe(canvas);

  const crosshair = document.getElementById('crosshair');

  canvas.addEventListener('pointerdown', e => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    crosshair.style.opacity = '1';
    needsRender = true;
  });

  canvas.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const aspect = canvas.width / canvas.height;
    const widthComplex = 2.0 * zoom * aspect;
    const heightComplex = 2.0 * zoom;

    const scaleX = widthComplex / canvas.width;
    const scaleY = heightComplex / canvas.height;

    offsetX -= dx * scaleX;
    offsetY += dy * scaleY;

    centerX = add_coord(refX, offsetX);
    centerY = add_coord(refY, offsetY);
    updateUI();
    interact();
    needsRender = true;
  });

  canvas.addEventListener('pointerup', e => {
    isDragging = false;
    crosshair.style.opacity = '0';
    needsRender = true;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 1.0 / 1.1;
    targetZoom *= factor;
    interact();
    needsRender = true;
  }, { passive: false });

  // Handle manual input changes
  elDouble.c_re.addEventListener('change', () => {
    centerX = elDouble.c_re.value;
    refX = centerX; // Update reference for high precision
    updateReference();
    needsRender = true;
  });

  elDouble.c_im.addEventListener('change', () => {
    centerY = elDouble.c_im.value;
    refY = centerY;
    updateReference();
    needsRender = true;
  });

  elDouble.zoom.addEventListener('change', () => {
    const newZoom = parseFloat(elDouble.zoom.value);
    if (!isNaN(newZoom) && newZoom > 0) {
        zoom = newZoom;
        targetZoom = newZoom;
        interact();
        needsRender = true;
    } else {
        updateUI(); // Revert to valid value
    }
  });
  
  elDouble.hue.addEventListener('change', () => {
    const v = parseFloat(elDouble.hue.value);
    if(!isNaN(v)) { hue = v; updateURL(); needsRender = true; } else { updateUI(); }
  });

  elDouble.hueStep.addEventListener('change', () => {
    const v = parseFloat(elDouble.hueStep.value);
    if(!isNaN(v)) { hueStep = v; updateURL(); needsRender = true; } else { updateUI(); }
  });

  // Footer button listeners
  const moveStep = 0.1;
  document.getElementById('btn-up').onclick = () => {
    const aspect = canvas.width / canvas.height;
    const dy = moveStep * zoom;
    centerY = add_coord(centerY, dy.toString());
    refY = centerY;
    updateReference();
    needsRender = true;
  };
  document.getElementById('btn-down').onclick = () => {
    const aspect = canvas.width / canvas.height;
    const dy = -moveStep * zoom;
    centerY = add_coord(centerY, dy.toString());
    refY = centerY;
    updateReference();
    needsRender = true;
  };
  document.getElementById('btn-left').onclick = () => {
    const aspect = canvas.width / canvas.height;
    const dx = -moveStep * zoom * aspect;
    centerX = add_coord(centerX, dx.toString());
    refX = centerX;
    updateReference();
    needsRender = true;
  };
  document.getElementById('btn-right').onclick = () => {
    const aspect = canvas.width / canvas.height;
    const dx = moveStep * zoom * aspect;
    centerX = add_coord(centerX, dx.toString());
    refX = centerX;
    updateReference();
    needsRender = true;
  };

  document.getElementById('btn-zoom-in').onclick = () => {
    targetZoom /= 1.5;
    interact();
    needsRender = true;
  };
  document.getElementById('btn-zoom-out').onclick = () => {
    targetZoom *= 1.5;
    interact();
    needsRender = true;
  };

  document.getElementById('btn-cycle-in').onclick = () => {
    hueStep *= 1.1;
    updateURL();
    needsRender = true;
  };
  document.getElementById('btn-cycle-out').onclick = () => {
    hueStep /= 1.1;
    updateURL();
    needsRender = true;
  };
  document.getElementById('btn-hue-left').onclick = () => {
    hue -= 0.05;
    updateURL();
    needsRender = true;
  };
  document.getElementById('btn-hue-right').onclick = () => {
    hue += 0.05;
    updateURL();
    needsRender = true;
  };

  const btnFullscreen = document.getElementById('btn-fullscreen');
  btnFullscreen.onclick = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        btnFullscreen.textContent = '⏬';
    } else {
        btnFullscreen.textContent = '⏫';
    }
  });

  document.getElementById('btn-screenshot').onclick = () => {
    const d = new Date();
    const timestamp = "" + d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0') + 
                      d.getHours().toString().padStart(2, '0') + d.getMinutes().toString().padStart(2, '0') + d.getSeconds().toString().padStart(2, '0');
    
    const link = document.createElement('a');
    link.download = `fractious-${timestamp}.png`;
    link.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
    link.click();
  };

  updateUI();
  updateReference();
  requestAnimationFrame(frame);
}

run();