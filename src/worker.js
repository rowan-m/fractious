import init, { compute_reference } from '../wasm/pkg/fractious_lib.js';

let isInitialized = false;

async function initialize() {
  if (!isInitialized) {
    await init();
    isInitialized = true;
  }
}

function calculatePrecision(scale) {
  const bits = Math.ceil(-Math.log2(scale)) + 128;
  return Math.min(Math.max(bits, 128), 4096);
}

async function handleCalculateReference(payload, id) {
  await initialize();

  const aborted = () =>
    self.postMessage({ type: 'result', id, payload: { aborted: true } });

  try {
    const { centerX, centerY, scale, aspect, iter, abortBuffer } = payload;
    const abortArray = abortBuffer ? new Int32Array(abortBuffer) : null;

    // ⚡ Bolt: Early return optimization. If the main thread has already
    // signalled an abort (e.g. user panned/zoomed quickly), exit immediately
    // before doing expensive precision or anchor calculations.
    if (abortArray && Atomics.load(abortArray, 0) === 1) {
      return aborted();
    }

    const ref = compute_reference(
      centerX,
      centerY,
      scale,
      aspect,
      iter,
      calculatePrecision(scale),
      abortArray,
    );
    const orbit = ref.take_orbit();
    const result = { orbit, refX: ref.x, refY: ref.y, iter: ref.iter };
    ref.free();

    if (abortArray && Atomics.load(abortArray, 0) === 1) {
      return aborted();
    }

    self.postMessage({ type: 'result', id, payload: result }, [orbit.buffer]);
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ type: 'error', id, error: error.toString() });
  }
}

self.onmessage = async (e) => {
  const { type, payload, id } = e.data;
  if (type === 'calculate_reference') {
    await handleCalculateReference(payload, id);
  }
};
