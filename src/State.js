export function createDefaultConfig() {
  return {
    centerX: '-1.7',
    centerY: '0.0',
    zoom: 2.0,
    rotation: 0.0,
    iter: 200,
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
    isPendingUpdate: true,

    isFrameScheduled: false,
    screenshotRequested: false,

    currentPass: 0,
    totalPasses: 1,

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
