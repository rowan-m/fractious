import init, {
  calculate_reference,
  find_best_anchor,
} from '../wasm/pkg/fractious_lib.js';

let isInitialized = false;

async function initialize() {
  if (!isInitialized) {
    await init();
    isInitialized = true;
  }
}

function calculatePrecision(scale) {
  let bits = Math.ceil(-Math.log2(scale)) + 128;
  return Math.min(Math.max(bits, 128), 4096);
}

function calculateUpgradedIter(iter, anchorIter, searchLimit) {
  let calcIter = Math.max(iter, anchorIter);
  if (anchorIter >= searchLimit) {
    calcIter = Math.floor(searchLimit * 1.5);
  } else if (calcIter > iter) {
    calcIter = Math.floor(calcIter * 1.25);
  }
  return Math.min(calcIter, 2500000);
}

async function handleCalculateReference(payload) {
  await initialize();

  try {
    const { centerX, centerY, scale, aspect, iter, abortBuffer } = payload;
    const abortArray = abortBuffer ? new Int32Array(abortBuffer) : null;

    // ⚡ Bolt: Early return optimization. If the main thread has already
    // signalled an abort (e.g. user panned/zoomed quickly), exit immediately
    // before doing expensive precision or anchor calculations.
    if (abortArray && Atomics.load(abortArray, 0) === 1) {
      return self.postMessage({ type: 'result', payload: { aborted: true } });
    }

    const prec = calculatePrecision(scale);
    const searchLimit = Math.max(iter * 3, 5000);

    const anchor = find_best_anchor(
      centerX,
      centerY,
      scale,
      aspect,
      searchLimit,
      prec,
      abortArray
    );
    if (abortArray && Atomics.load(abortArray, 0) === 1) {
      return self.postMessage({ type: 'result', payload: { aborted: true } });
    }

    const calcIter = calculateUpgradedIter(iter, anchor.iter, searchLimit);
    const orbit = calculate_reference(
      anchor.x,
      anchor.y,
      calcIter,
      prec,
      abortArray
    );

    if (abortArray && Atomics.load(abortArray, 0) === 1) {
      return self.postMessage({ type: 'result', payload: { aborted: true } });
    }

    self.postMessage(
      {
        type: 'result',
        payload: { orbit, refX: anchor.x, refY: anchor.y, iter: calcIter },
      },
      [orbit.buffer]
    );
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ type: 'error', error: error.toString() });
  }
}

self.onmessage = async e => {
  const { type, payload } = e.data;
  if (type === 'calculate_reference') {
    await handleCalculateReference(payload);
  }
};
