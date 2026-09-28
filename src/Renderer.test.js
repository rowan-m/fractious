import { describe, it, expect } from 'vitest';
import { Renderer } from './Renderer.js';

const tier = { name: 'QS', opsMultiplier: 8.0 };
const config = { iter: 5000 };

function createRenderer(width = 1000, height = 1000) {
  return new Renderer({ width, height }, null);
}

function progressiveState(nextRow = 0) {
  return {
    nextRow,
    pointers: new Map(),
    held: new Set(),
    workerBusy: false,
    isPendingUpdate: false,
  };
}

describe('Renderer adaptive progressive slices', () => {
  it('renders the whole canvas in one slice while interacting', () => {
    const renderer = createRenderer();
    const state = { ...progressiveState(), workerBusy: true };
    expect(renderer._sliceRows(config, state, tier)).toBe(1000);
  });

  it('starts from the fixed worst-case budget before anything is measured', () => {
    const renderer = createRenderer();
    // ceil(200M ops / (1000 px * 5000 iter)) = 40 rows
    expect(renderer._sliceRows(config, progressiveState(), tier)).toBe(40);
  });

  it('grows slices at most twofold per measurement and shrinks immediately', () => {
    const renderer = createRenderer();
    const slice = { tier: 'QS', ops: 20000000 };

    renderer.recordSliceTime(slice, 10); // 2M ops/ms
    renderer.recordSliceTime(slice, 0.1); // very fast, capped at 2x
    expect(renderer.throughput.get('QS')).toBe(4000000);

    renderer.recordSliceTime(slice, 100); // slow slice wins straight away
    expect(renderer.throughput.get('QS')).toBe(200000);
  });

  it('sizes slices to the target time, floored at a 32-row tile strip and capped by stall limit and rows left', () => {
    const renderer = createRenderer();
    renderer.throughput.set('QS', 10000000); // 320M ops per 32ms = 64 rows
    expect(renderer._sliceRows(config, progressiveState(), tier)).toBe(64);

    // When single-thread serial iteration latency exceeds TARGET_SLICE_MS, slices
    // floor at MIN_SLICE_ROWS (32) rather than collapsing into 1-row slices
    renderer.recordSliceTime({ tier: 'QS', ops: 160000000 }, 100);
    expect(renderer._sliceRows(config, progressiveState(), tier)).toBe(32);

    renderer.throughput.set('QS', 1e12); // capped at 16 * 200M ops = 640 rows
    expect(renderer._sliceRows(config, progressiveState(), tier)).toBe(640);
    expect(renderer._sliceRows(config, progressiveState(990), tier)).toBe(10);
  });

  it('computes slice geometry from the next row and discounts skipped SA iterations', () => {
    const renderer = createRenderer(1000, 100);
    renderer.throughput.set('QS', 1e12);
    renderer.skipIter = 600;
    const slice = renderer._getSliceGeometry(
      { iter: 1000 },
      progressiveState(0),
      tier,
    );
    expect(slice).toMatchObject({ yOffset: 0, rows: 100, sliceScale: 1 });
    expect(slice.sliceOffset).toBeCloseTo(0, 10);
    expect(slice.ops).toBe(100 * 1000 * 400);
  });
});
