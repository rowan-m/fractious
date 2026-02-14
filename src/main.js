import init, { add_coord, init_hooks, sub_coord } from '../wasm/pkg/wasm.js';
import shaderCode from './renderer/shader.wgsl?raw';

async function run() {
  await init();
  init_hooks();

  // Initialize Worker
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

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
  const format = navigator.gpu.getPreferredCanvasFormat();
  const canvas = document.getElementById('fractal');
  const context = canvas.getContext('webgpu');

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  // Parse URL parameters
  const params = new URLSearchParams(window.location.search);
  const urlX = params.get('x');
  const urlY = params.get('y');
  const urlZoom = params.get('zoom');
  const urlHue = params.get('h');
  const urlHueStep = params.get('s');
  const urlRotation = params.get('r');

  // State
  let refX = urlX || "-1.7";
  let refY = urlY || "0.0";
  let centerX = refX;
  let centerY = refY;

  let zoom = urlZoom ? parseFloat(urlZoom) : 2.0;
  let rotation = urlRotation ? parseFloat(urlRotation) : 0.0;
  let targetZoom = zoom;
  let iter = 200;
  // Calculate initial iter based on zoom immediately
  if (zoom) {
      const logZoom = Math.log10(zoom);
      iter = Math.floor((200 + 150 * Math.abs(logZoom)) * 1.5);
  }
  let hue = urlHue ? parseFloat(urlHue) : 0.6;
  let hueStep = urlHueStep ? parseFloat(urlHueStep) : 1.0;

  let needUpdateRef = true;

  let offsetX = 0.0;
  let offsetY = 0.0;
  let isDragging = false;
  let isInteracting = false;
  let interactionTimeout;
  let needsRender = true;
  let screenshotRequested = false;
  let lastX = 0;
  let lastY = 0;
  
  // Multi-touch state
  const pointers = new Map();
  let prevDiff = -1;
  let prevAngle = null;
  let prevCenter = null;

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
    rotation: document.getElementById('rotation'),
    hue: document.getElementById('hue'),
    hueStep: document.getElementById('huestep'),
  };

  function updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set('x', centerX);
    params.set('y', centerY);
    params.set('zoom', zoom);
    params.set('r', rotation.toFixed(3));
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
    if (document.activeElement !== elDouble.rotation) {
        const deg = (rotation * 180 / Math.PI) % 360;
        elDouble.rotation.value = deg.toFixed(1);
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
    iter = Math.floor((200 + 150 * Math.abs(logZoom)) * 1.5);

    updateReference();
  }, 500);

  let isCalculating = false;

  worker.onmessage = (e) => {
      const { type, payload, error } = e.data;
      if (type === 'result') {
          const { orbit, refX: newRefX, refY: newRefY, iter: newIter } = payload;
          
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

          iter = newIter;
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

    let renderIter = iter;
    // Capping iterations during interaction causes deep zoom artifacts.
    // We rely on resolution scaling (targetScale) for performance.

    dv.setFloat32(0, offsetX, true);
    dv.setFloat32(4, offsetY, true);
    dv.setFloat32(8, zoom, true);
    dv.setFloat32(12, aspect, true);
    dv.setUint32(16, renderIter, true);
    dv.setFloat32(20, hue, true);
    dv.setFloat32(24, hueStep, true);
    dv.setFloat32(28, rotation, true);

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

    if (screenshotRequested) {
        screenshotRequested = false;
        const d = new Date();
        const timestamp = "" + d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0') + 
                          d.getHours().toString().padStart(2, '0') + d.getMinutes().toString().padStart(2, '0') + d.getSeconds().toString().padStart(2, '0');
        
        const link = document.createElement('a');
        link.download = `fractious-${timestamp}.png`;
        link.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
        link.click();
    }

    requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(entries => {
    for (const {} of entries) {
      // Just trigger a render, the frame loop handles the sizing logic
      needsRender = true;
    }
  });
  observer.observe(canvas);

  const crosshair = document.getElementById('crosshair');

  canvas.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    
    if (pointers.size === 1) {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        crosshair.classList.add('moving');
    } else if (pointers.size === 2) {
        isDragging = true; // Still dragging/interacting
        const points = Array.from(pointers.values());
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        prevDiff = Math.hypot(dx, dy);
        prevAngle = Math.atan2(dy, dx);
        prevCenter = {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2
        };
    }
    needsRender = true;
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Calculate aspect and scales common to both cases
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const widthComplex = 2.0 * zoom * aspect;
    const heightComplex = 2.0 * zoom;
    const scaleX = widthComplex / canvas.clientWidth;
    const scaleY = heightComplex / canvas.clientHeight;

    if (pointers.size === 2) {
        // Multi-touch: Pinch Zoom + Pan + Rotate
        const points = Array.from(pointers.values());
        
        // 1. Calculate new difference (Zoom) and Angle (Rotation)
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        const curDiff = Math.hypot(dx, dy);
        const curAngle = Math.atan2(dy, dx);

        if (prevDiff > 0) {
            // Zoom factor: if distance increases, we want to zoom in (decrease targetZoom)
            const factor = curDiff / prevDiff; 
            targetZoom /= factor; 
            
            // Rotation
            if (prevAngle !== null) {
                let delta = curAngle - prevAngle;
                // Normalize delta
                if (delta > Math.PI) delta -= 2 * Math.PI;
                else if (delta < -Math.PI) delta += 2 * Math.PI;
                
                rotation += delta;
            }
        }
        prevDiff = curDiff;
        prevAngle = curAngle;

        // 2. Calculate new center (Pan)
        const curCenter = {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2
        };

        if (prevCenter) {
            const moveX = curCenter.x - prevCenter.x;
            const moveY = curCenter.y - prevCenter.y;
            
            const s = scaleY;
            const c = Math.cos(rotation);
            const sn = Math.sin(rotation);
            
            // Rotate movement vector to match complex plane orientation
            const dCx = (moveX * c + moveY * sn) * s;
            const dCy = (moveY * c - moveX * sn) * s;
            
            offsetX -= dCx;
            offsetY += dCy;
        }
        prevCenter = curCenter;

    } else if (pointers.size === 1) {
        // Single-touch: Pan only
        if (!isDragging) return;
        
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        const s = scaleY;
        const c = Math.cos(rotation);
        const sn = Math.sin(rotation);
        
        const dCx = (dx * c + dy * sn) * s;
        const dCy = (dy * c - dx * sn) * s;

        offsetX -= dCx;
        offsetY += dCy;
    }

    centerX = add_coord(refX, offsetX);
    centerY = add_coord(refY, offsetY);
    updateUI();
    interact();
    needsRender = true;
  });

  function handlePointerUp(e) {
    pointers.delete(e.pointerId);
    
    if (pointers.size < 2) {
        prevDiff = -1;
        prevAngle = null;
        prevCenter = null;
    }
    
    if (pointers.size === 1) {
        // Reset lastX/Y for the remaining single pointer to prevent jumping
        const point = pointers.values().next().value;
        lastX = point.x;
        lastY = point.y;
    } else if (pointers.size === 0) {
        isDragging = false;
        crosshair.classList.remove('moving');
    }
    needsRender = true;
  }

  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('pointerout', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerUp);

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

  elDouble.rotation.addEventListener('change', () => {
    const deg = parseFloat(elDouble.rotation.value);
    if (!isNaN(deg)) {
        rotation = deg * Math.PI / 180;
        interact();
        needsRender = true;
    } else {
        updateUI();
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
    const dy = moveStep * zoom;
    centerY = add_coord(centerY, dy.toString());
    refY = centerY;
    updateReference();
    needsRender = true;
  };
  document.getElementById('btn-down').onclick = () => {
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

  document.getElementById('btn-rotate-cw').onclick = () => {
    rotation += Math.PI / 12; // 15 degrees
    interact();
    needsRender = true;
  };
  document.getElementById('btn-rotate-ccw').onclick = () => {
    rotation -= Math.PI / 12;
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
    screenshotRequested = true;
    needsRender = true;
  };

  updateUI();
  updateReference();
  requestAnimationFrame(frame);
}

run();