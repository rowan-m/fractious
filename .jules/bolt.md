## 2025-02-17 - Early Abort in Worker

**Learning:** Found a performance bottleneck where rapid user interactions (panning/zooming) queued up multiple worker tasks, but the worker still executed initial setup steps (precision calculation, string parsing) even if the task was already aborted.
**Action:** Always check cancellation tokens (`Atomics.load(abortArray, 0)`) as early as possible in worker entry points before performing any computation, not just inside inner loops.

## 2025-03-19 - WebGPU CPU-GPU Synchronization Stalls

**Learning:** Chaining `requestAnimationFrame` inside `onSubmittedWorkDone().then()` in a WebGPU render loop forces an unnecessary CPU-GPU synchronization stall. This interrupts native browser pipelining and significantly reduces frame throughput during progressive rendering tasks.
**Action:** Always call `requestAnimationFrame` directly instead of waiting for `onSubmittedWorkDone()` to resolve. Let the browser and WebGPU API manage queueing and pipelining natively to maximize performance.

## 2025-03-19 - Rust Vec Pre-allocation in Wasm

**Learning:** Calling push() repeatedly inside a high-frequency loop adds bounds-checking and potential reallocation overhead, even when capacity is pre-allocated.
**Action:** Favor Vec::resize() or macro initialization to pre-allocate exact sizes before the loop, and use direct index assignment for zero-padding or bulk element population.

## 2025-03-19 - WebGPU BindGroup Re-creation

**Learning:** Re-creating a GPUBindGroup every time its underlying buffer's data changes is a redundant and expensive operation. device.queue.writeBuffer() updates the data in-place.
**Action:** Only re-create the GPUBindGroup when the underlying buffer object itself is replaced (e.g., when resizing the buffer). Otherwise, reuse the existing bind group.

## 2025-03-22 - WebGPU Render Loop BindGroup Caching

**Learning:** Re-creating a `GPUBindGroup` on every render pass (e.g., inside a `_dispatchDrawCalls` loop) is a significant and unnecessary CPU-side performance penalty. In a progressive rendering architecture where the render pass executes multiple times to accumulate a final image, this overhead compounds rapidly.
**Action:** When a `GPUBindGroup` depends on a texture view that only changes upon resize (like an offscreen buffer), instantiate the `GPUBindGroup` once during the resize event and cache it as a class property (e.g., `this.postBindGroup`). Reuse this cached instance inside the hot render loop.
