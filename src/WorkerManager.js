export class WorkerManager {
  constructor() {
    this.worker = null;
    this.currentAbortArray = null;
    this.onResult = null;
    this.onError = null;
  }

  init() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = e => {
      const {type, payload, error} = e.data;

      if (type === 'error') {
        if (this.onError) this.onError(error);
        return;
      }

      if (type !== 'result') return;
      if (payload.aborted) return;
      if (this.onResult) this.onResult(payload);
    };
  }

  updateReference(config, canvasWidth, canvasHeight) {
    if (this.currentAbortArray) {
      Atomics.store(this.currentAbortArray, 0, 1);
    }

    const aspect = canvasWidth / canvasHeight;
    const logZoom = Math.log10(config.zoom);
    const requestedIter = Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);

    let abortBuffer = null;
    if (typeof SharedArrayBuffer !== 'undefined') {
      abortBuffer = new SharedArrayBuffer(4);
      this.currentAbortArray = new Int32Array(abortBuffer);
    } else {
      this.currentAbortArray = null;
    }

    this.worker.postMessage({
      type: 'calculate_reference',
      payload: {
        centerX: config.centerX,
        centerY: config.centerY,
        scale: config.zoom,
        aspect,
        iter: requestedIter,
        abortBuffer,
      },
    });
  }
}
