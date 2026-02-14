import init, { calculate_reference, find_best_anchor } from '../wasm/pkg/wasm.js';

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
            const { centerX, centerY, scale, aspect, iter } = payload;
            
            // Calculate precision dynamically
            // Scale is roughly the radius of the view. Smaller scale = deeper zoom = more bits needed.
            let bits = Math.ceil(-Math.log2(scale)) + 64;
            if (bits < 64) bits = 64;
            if (bits > 4096) bits = 4096; // Safety cap
            const prec = bits;

            // 1. Find best anchor
            const anchorResult = find_best_anchor(centerX, centerY, scale, aspect, iter, prec);
            const refX = anchorResult[0];
            const refY = anchorResult[1];

            // 2. Calculate orbit
            const orbit = calculate_reference(refX, refY, iter, prec);
            
            // Transfer the orbit array as a Transferable object for performance
            const orbitF32 = new Float32Array(orbit);

            self.postMessage({
                type: 'result',
                payload: {
                    orbit: orbitF32,
                    refX,
                    refY,
                    iter
                }
            }, [orbitF32.buffer]);

        } catch (error) {
            console.error("Worker error:", error);
            self.postMessage({ type: 'error', error: error.toString() });
        }
    }
};
