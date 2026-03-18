## 2025-02-17 - Early Abort in Worker

**Learning:** Found a performance bottleneck where rapid user interactions (panning/zooming) queued up multiple worker tasks, but the worker still executed initial setup steps (precision calculation, string parsing) even if the task was already aborted.
**Action:** Always check cancellation tokens (`Atomics.load(abortArray, 0)`) as early as possible in worker entry points before performing any computation, not just inside inner loops.
