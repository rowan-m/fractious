## 2025-02-17 - Early Abort in Worker

**Learning:** Found a performance bottleneck where rapid user interactions (panning/zooming) queued up multiple worker tasks, but the worker still executed initial setup steps (precision calculation, string parsing) even if the task was already aborted.
**Action:** Always check cancellation tokens (`Atomics.load(abortArray, 0)`) as early as possible in worker entry points before performing any computation, not just inside inner loops.

## 2025-03-08 - WebGPU Progressive Rendering Sync Overhead
**Learning:** For progressive rendering loops, calling `this.renderer.onSubmittedWorkDone().then()` immediately before queuing the next frame with `requestAnimationFrame` creates unnecessary CPU-GPU synchronization stalls and lowers frame throughput. `requestAnimationFrame` intrinsically synchronizes with display refresh and the WebGPU command queue.
**Action:** When implementing progressive rendering rendering loops, let `requestAnimationFrame` handle the pacing instead of forcing a sync stall with `onSubmittedWorkDone` unless reading back data to the CPU is explicitly required for the next frame.
