export function calculateBaseIter(zoom) {
  const logZoom = Math.log10(zoom || 2.0);
  return Math.floor((1000 + 300 * Math.abs(logZoom)) * 1.5);
}

export function radToNormDeg(rad) {
  return ((((rad * 180) / Math.PI) % 360) + 360) % 360;
}

export function createDefaultConfig() {
  return {
    centerX: '-1.7',
    centerY: '0.0',
    zoom: 2.0,
    rotation: 0.0,
    iter: calculateBaseIter(2.0),
    hue: 0.6,
    hueStep: 1.0,
  };
}

export function createDefaultState() {
  return {
    refX: '-1.7',
    refY: '0.0',
    offsetX: 0.0,
    offsetY: 0.0,
    targetZoom: 2.0,

    workerBusy: false,
    isRendering: false,
    isPendingUpdate: true,

    isFrameScheduled: false,
    screenshotRequested: false,
    shareRequested: false,

    nextRow: 0,

    dpr: 1,
    width: 0,
    height: 0,
    currentPixels: 0,

    pointers: new Map(),
    prevDiff: -1,
    prevAngle: null,
    prevCenter: null,
    lastX: 0,
    lastY: 0,
  };
}
