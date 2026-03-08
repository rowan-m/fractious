import init, { calculate_reference, find_best_anchor } from '../wasm/pkg/fractious_lib.js';

let isInitialized = false;

async function initialize() {
    if (!isInitialized) {
        await init();
        isInitialized = true;
    }
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'calculate_reference') {
        await initialize();

        try {
            const { centerX, centerY, scale, aspect, iter, abortBuffer } = payload;
            
            const abortArray = abortBuffer ? new Int32Array(abortBuffer) : null;
            
            // Calculate precision dynamically
            // Scale is roughly the radius of the view. Smaller scale = deeper zoom = more bits needed.
            let bits = Math.ceil(-Math.log2(scale)) + 128;
            if (bits < 128) bits = 128;
            if (bits > 4096) bits = 4096; // Safety cap
            const prec = bits;

            // 1. Find best anchor with expanded search limit
            // Search deeper to detect if we are near a structure that needs more iterations
            const searchLimit = Math.max(iter * 3, 5000);
            
            const anchor = find_best_anchor(centerX, centerY, scale, aspect, searchLimit, prec, abortArray);
            const refX = anchor.x;
            const refY = anchor.y;
            
            if (abortArray && Atomics.load(abortArray, 0) === 1) {
                self.postMessage({ type: 'result', payload: { aborted: true } });
                return;
            }

            // If the anchor needs more iterations than currently requested, upgrade.
            let calcIter = Math.max(iter, anchor.iter);
            
            // If the anchor hit the search limit, it's likely "in the set" or a very deep structure.
            // We should boost the iterations significantly to try and resolve it.
            if (anchor.iter >= searchLimit) {
                calcIter = Math.floor(searchLimit * 1.5);
            } else if (calcIter > iter) {
                 // Moderate boost if we just found something deeper than expected
                calcIter = Math.floor(calcIter * 1.25);
            }
            
            // Hard cap to prevent GPU timeouts
            calcIter = Math.min(calcIter, 2500000);

            // 2. Calculate orbit
            const orbit = calculate_reference(refX, refY, calcIter, prec, abortArray);
            
            if (abortArray && Atomics.load(abortArray, 0) === 1) {
                self.postMessage({ type: 'result', payload: { aborted: true } });
                return;
            }
            
            self.postMessage({
                type: 'result',
                payload: {
                    orbit: orbit,
                    refX,
                    refY,
                    iter: calcIter // Return the potentially upgraded iter
                }
            }, [orbit.buffer]);

        } catch (error) {
            console.error("Worker error:", error);
            self.postMessage({ type: 'error', error: error.toString() });
        }
    }
};
