import init, { add_coord, init_hooks, sub_coord } from '../wasm/pkg/fractious_lib.js';
import shaderCode from './renderer/shader.wgsl?raw';

async function run() {
  await init();
  init_hooks();

  // Initialize Worker
  let worker;
  let currentAbortArray = null;

  function initWorker() {
      if (worker) {
          return;
      }
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      
      worker.onmessage = (e) => {
          const { type, payload, error } = e.data;
          if (type === 'result') {
              const { orbit, refX: newRefX, refY: newRefY, iter: newIter, aborted } = payload;
              
              if (aborted) {
                  // Ignore aborted results
                  return;
              }

              refX = newRefX;
              refY = newRefY;
              
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
              isPendingCalculation = false;
              requestRender();
              
              elDouble.c_re.textContent = ""; 

          } else if (type === 'error') {
              console.error("Worker error:", error);
              isPendingCalculation = false;
          }
          
          isCalculating = false;
          needUpdateRef = false;
      };
  }
  
  initWorker();

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
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });

  // Parse URL parameters
  const params = new URLSearchParams(window.location.search);
  const urlX = params.get('x');
  const urlY = params.get('y');
  const urlZoom = params.get('z');
  const urlHue = params.get('h');
  const urlHueStep = params.get('s');
  const urlRotation = params.get('r');

  // State
  let refX = urlX || "-1.7";
  let refY = urlY || "0.0";
  let centerX = refX;
  let centerY = refY;

  // Zoom is stored as raw scale internally, but presented as -log10(zoom) (Zoom Level)
  let zoom = urlZoom ? Math.pow(10, -parseFloat(urlZoom)) : 2.0;
  let rotation = urlRotation ? parseFloat(urlRotation) : 0.0;
  let targetZoom = zoom;
  let iter = 200;
  // Calculate initial iter based on zoom immediately
  if (zoom) {
      const logZoom = Math.log10(zoom);
      iter = Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);
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
  let isFrameScheduled = false;

  function requestRender() {
      needsRender = true;
      if (!isFrameScheduled) {
          isFrameScheduled = true;
          requestAnimationFrame(frame);
      }
  }
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
    iterations: document.getElementById('iterations'),
    hue: document.getElementById('hue'),
    hueStep: document.getElementById('huestep'),
  };

  function updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set('x', centerX);
    params.set('y', centerY);
    params.set('z', (-Math.log10(zoom)).toFixed(3));
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
        elDouble.zoom.value = (-Math.log10(zoom)).toFixed(2);
    }
    if (document.activeElement !== elDouble.rotation) {
        const deg = (rotation * 180 / Math.PI) % 360;
        elDouble.rotation.value = deg.toFixed(1);
    }
    elDouble.iterations.value = iter;
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
    updateReference();
  }, 500);

  let isCalculating = false;

  function updateReference() {
    if (isCalculating && currentAbortArray) {
        Atomics.store(currentAbortArray, 0, 1);
    }
    isCalculating = true;
    needUpdateRef = false;

    const aspect = canvas.width / canvas.height;
    const logZoom = Math.log10(zoom);
    const requestedIter = Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);

    const abortBuffer = new SharedArrayBuffer(4);
    currentAbortArray = new Int32Array(abortBuffer);

    worker.postMessage({
        type: 'calculate_reference',
        payload: {
            centerX,
            centerY,
            scale: zoom,
            aspect,
            iter: requestedIter,
            abortBuffer
        }
    });
  }

  let isPendingCalculation = false;

  function interact() {
    isInteracting = true;
    isPendingCalculation = true;
    clearTimeout(interactionTimeout);
    interactionTimeout = setTimeout(() => {
      isInteracting = false;
      requestRender();
    }, 300);
    commitAndRecalc();
    requestRender();
  }

  let offscreenTexture = null;
  let offscreenTextureView = null;

  function resizeOffscreenTexture(w, h) {
      if (offscreenTexture && offscreenTexture.width === w && offscreenTexture.height === h) return;
      if (offscreenTexture) offscreenTexture.destroy();
      if (w === 0 || h === 0) return;
      offscreenTexture = device.createTexture({
          size: [w, h, 1],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      offscreenTextureView = offscreenTexture.createView();
  }

  let currentPass = 0;
  let totalPasses = 1;

  function frame() {
    isFrameScheduled = false;

    if (needUpdateRef) {
      updateReference();
    }

    if (needsRender) {
        currentPass = 0;
        needsRender = false;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const currentPixels = (width * dpr) * (height * dpr);
    
    // Dynamic Resolution & Progressive Rendering Logic
    // Allow much larger maxOps for progressive rendering to speed it up
    const interactionMaxOps = 40000000;
    const progressiveMaxOps = 200000000;
    let targetScale = 1.0;
    
    // Stay in interactive (low res) mode if we are dragging, interacting, or waiting for a calculation to finish
    if (isInteracting || isDragging || isCalculating || isPendingCalculation) {
        const idealPixels = interactionMaxOps / (iter || 1);
        targetScale = Math.sqrt(idealPixels / currentPixels);
        targetScale = Math.min(0.5, targetScale); // Unconstrained lower bound
        totalPasses = 1;
    } else {
        const totalOps = currentPixels * iter;
        totalPasses = Math.max(1, Math.ceil(totalOps / progressiveMaxOps));
    }

    if (width > 0 && height > 0) {
        const targetWidth = Math.max(1, Math.min(Math.floor(width * dpr * targetScale), device.limits.maxTextureDimension2D));
        const targetHeight = Math.max(1, Math.min(Math.floor(height * dpr * targetScale), device.limits.maxTextureDimension2D));
        
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            currentPass = 0;
        }
    }

    if (currentPass >= totalPasses && !needUpdateRef && !screenshotRequested) {
        return;
    }

    resizeOffscreenTexture(canvas.width, canvas.height);

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
    dv.setUint32(16, iter, true);
    dv.setFloat32(20, hue, true);
    dv.setFloat32(24, hueStep, true);
    dv.setFloat32(28, rotation, true);

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const commandEncoder = device.createCommandEncoder();

    if (currentPass < totalPasses) {
        const sliceHeight = Math.ceil(canvas.height / totalPasses);
        const yOffset = currentPass * sliceHeight;
        const currentSliceHeight = Math.min(sliceHeight, canvas.height - yOffset);

        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: offscreenTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: currentPass === 0 ? 'clear' : 'load',
            storeOp: 'store',
          }],
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setViewport(0, 0, canvas.width, canvas.height, 0, 1);
        if (currentSliceHeight > 0) {
            passEncoder.setScissorRect(0, yOffset, canvas.width, currentSliceHeight);
        }

        if (bindGroup) {
          passEncoder.setBindGroup(0, bindGroup);
          passEncoder.draw(6);
        }
        passEncoder.end();
        
        currentPass++;
    }

    const destTexture = context.getCurrentTexture();
    commandEncoder.copyTextureToTexture(
      { texture: offscreenTexture },
      { texture: destTexture },
      [canvas.width, canvas.height, 1]
    );

    device.queue.submit([commandEncoder.finish()]);

    // Snapshot the interactive frame to the background canvas so it stays visible
    // while the high-res progressive render paints over it transparently.
    if (totalPasses === 1 && canvas.width > 0 && canvas.height > 0) {
        const bgCanvas = document.getElementById('fractal-bg');
        if (bgCanvas) {
            const bgCtx = bgCanvas.getContext('2d', { alpha: false, desynchronized: true });
            if (bgCanvas.width !== canvas.width || bgCanvas.height !== canvas.height) {
                bgCanvas.width = canvas.width;
                bgCanvas.height = canvas.height;
            }
            bgCtx.drawImage(canvas, 0, 0);
        }
    }

    if (screenshotRequested && currentPass >= totalPasses) {
        screenshotRequested = false;
        const d = new Date();
        const timestamp = "" + d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0') + 
                          d.getHours().toString().padStart(2, '0') + d.getMinutes().toString().padStart(2, '0') + d.getSeconds().toString().padStart(2, '0');
        
        const link = document.createElement('a');
        link.download = `fractious-${timestamp}.png`;
        link.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
        link.click();
    }

    if (currentPass < totalPasses || needUpdateRef || screenshotRequested) {
        if (!isFrameScheduled) {
            isFrameScheduled = true;
            requestAnimationFrame(frame);
        }
    }
  }

  const observer = new ResizeObserver(entries => {
    for (const {} of entries) {
      // Just trigger a render, the frame loop handles the sizing logic
      requestRender();
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
    requestRender();
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
    requestRender();
  });

  function handlePointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    
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
    requestRender();
  }

  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('pointerout', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerUp);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.05 : 1.0 / 1.05;
    targetZoom *= factor;
    interact();
    requestRender();
  }, { passive: false });

  // Handle manual input changes
  elDouble.c_re.addEventListener('change', () => {
    centerX = elDouble.c_re.value;
    refX = centerX; // Update reference for high precision
    updateReference();
    requestRender();
  });

  elDouble.c_im.addEventListener('change', () => {
    centerY = elDouble.c_im.value;
    refY = centerY;
    updateReference();
    requestRender();
  });

  elDouble.zoom.addEventListener('change', () => {
    const level = parseFloat(elDouble.zoom.value);
    if (!isNaN(level)) {
        zoom = Math.pow(10, -level);
        targetZoom = zoom;
        interact();
        requestRender();
    } else {
        updateUI(); // Revert to valid value
    }
  });

  elDouble.rotation.addEventListener('change', () => {
    const deg = parseFloat(elDouble.rotation.value);
    if (!isNaN(deg)) {
        rotation = deg * Math.PI / 180;
        interact();
        requestRender();
    } else {
        updateUI();
    }
  });
  
  elDouble.hue.addEventListener('change', () => {
    const v = parseFloat(elDouble.hue.value);
    if(!isNaN(v)) { hue = v; updateURL(); requestRender(); } else { updateUI(); }
  });

  elDouble.hueStep.addEventListener('change', () => {
    const v = parseFloat(elDouble.hueStep.value);
    if(!isNaN(v)) { hueStep = v; updateURL(); requestRender(); } else { updateUI(); }
  });

  // Footer button listeners
  const moveStep = 0.1;
  document.getElementById('btn-up').onclick = () => {
    const dy = moveStep * zoom;
    centerY = add_coord(centerY, dy.toString());
    refY = centerY;
    updateReference();
    requestRender();
  };
  document.getElementById('btn-down').onclick = () => {
    const dy = -moveStep * zoom;
    centerY = add_coord(centerY, dy.toString());
    refY = centerY;
    updateReference();
    requestRender();
  };
  document.getElementById('btn-left').onclick = () => {
    const aspect = canvas.width / canvas.height;
    const dx = -moveStep * zoom * aspect;
    centerX = add_coord(centerX, dx.toString());
    refX = centerX;
    updateReference();
    requestRender();
  };
  document.getElementById('btn-right').onclick = () => {
    const aspect = canvas.width / canvas.height;
    const dx = moveStep * zoom * aspect;
    centerX = add_coord(centerX, dx.toString());
    refX = centerX;
    updateReference();
    requestRender();
  };

  document.getElementById('btn-zoom-in').onclick = () => {
    targetZoom /= 1.5;
    interact();
    requestRender();
  };
  document.getElementById('btn-zoom-out').onclick = () => {
    targetZoom *= 1.5;
    interact();
    requestRender();
  };

  document.getElementById('btn-rotate-cw').onclick = () => {
    rotation += Math.PI / 12; // 15 degrees
    interact();
    requestRender();
  };
  document.getElementById('btn-rotate-ccw').onclick = () => {
    rotation -= Math.PI / 12;
    interact();
    requestRender();
  };

  document.getElementById('btn-cycle-in').onclick = () => {
    hueStep += 0.05;
    updateURL();
    requestRender();
  };
  document.getElementById('btn-cycle-out').onclick = () => {
    hueStep -= 0.05;
    updateURL();
    requestRender();
  };
  document.getElementById('btn-hue-left').onclick = () => {
    hue -= 0.05;
    updateURL();
    requestRender();
  };
  document.getElementById('btn-hue-right').onclick = () => {
    hue += 0.05;
    updateURL();
    requestRender();
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
    requestRender();
  };

  updateUI();
  updateReference();
  requestRender();
}

run();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('ServiceWorker registration failed: ', err);
    });
  });
}