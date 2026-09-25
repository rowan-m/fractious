# AGENTS.md — Fractious Contributor & Maintainer Guide

Fractious is a high-performance, zero-framework Mandelbrot set explorer built with **Vanilla JavaScript**, **WebGPU (WGSL)**, and **Rust/WebAssembly** (`dashu` arbitrary-precision arithmetic).

This document equips AI coding agents and engineers with the architectural context, mathematical invariants, UX principles, and quality gates required to contribute as a trusted maintainer.

---

## 1. Core Product & Engineering Philosophy

1. **Performance & Ease of Use Are Paramount**
   - Every interaction (panning, pinching, wheel-zooming, rotating, colour tuning) must feel instantaneous (`60fps+`).
   - **Prefer automatic mathematical/algorithmic solutions over manual UI knobs.** If the fractal loses detail or glitches at deep zooms, solve it in the perturbation math, shader rebasing, or anchor search rather than exposing technical workarounds to the user.
   - Keep the production bundle tiny. Strict size budgets are enforced in `package.json` via `scripts/check-size.js` (`npm run check:size`):
     - Main JS (`dist/assets/index-*.js`): **$\le$ 15 kB**
     - WASM binary (`dist/assets/fractious_lib_bg-*.wasm`): **$\le$ 110 kB**
     - Worker JS (`dist/assets/worker-*.js`): **$\le$ 5 kB**
     - Stylesheet (`dist/assets/index-*.css`): **$\le$ 2 kB**

2. **Clean, Declarative HTML & Native Web Platform UI**
   - Keep UI structure in clean, semantic, declarative HTML in [`index.html`](index.html) and styles in [`src/style.css`](src/style.css).
   - Use native browser capabilities (`popover` API, semantic `<button>` and `<input>` elements, CSS custom properties, glassmorphic `backdrop-filter`) instead of imperative DOM-generation trees or external UI libraries.
   - Never use `.innerHTML` or `insertAdjacentHTML` (enforced by `eslint-plugin-no-unsanitized`).

3. **URL as the Single Source of Truth (Linkable State)**
   - Any user-visible state that defines the fractal view MUST be mirrored to URL query parameters via `history.replaceState` (`src/Fractious.js`) and parsed on startup so every view is 100% shareable and bookmarkable:
     - `x`: Real coordinate string (arbitrary-precision decimal)
     - `y`: Imaginary coordinate string (arbitrary-precision decimal)
     - `z`: Zoom scale (`f64`, vertical span in the complex plane; default `2.0`)
     - `r`: Rotation angle in degrees (`0..360`)
     - `h`: Base palette hue (`0..360`)
     - `s`: Palette hue step / cycling rate (`0..10`)

4. **Responsive Across Mobile, Desktop & Any Form Factor**
   - Always design and verify interactions for **both touch/mobile and mouse/desktop**:
     - **Desktop**: Left-drag pan, `Shift`+drag rotate around viewport center, mouse wheel zoom (on the pinned viewport centre, like the zoom buttons and keys), double-click zoom at the cursor, `Shift`+wheel rotate, and keyboard shortcuts (`WASD`/Arrow keys to pan, `Q`/`E` or `-`/`+` to zoom, `Z`/`X` to rotate, `R`/`T` to shift hue, `F`/`G` to adjust hue step). Holding a key or on-screen button repeats its action (after `HOLD_DELAY_MS`, every `HOLD_REPEAT_MS`), and like a held pointer it keeps the view in interactive preview (pin shown, tracked in `state.held`) until every pointer, key and button is released (`isInteracting()` in `src/State.js`).
     - **Mobile / Touch**: 1-finger drag pan, 2-finger simultaneous pinch-to-zoom (anchored at pinch midpoint, the only continuous zoom not centred on the pin) + twist-to-rotate + midpoint translation, `touch-action: none` on the viewport, and responsive control panels that never obscure the fractal or overflow small viewports.

---

## 2. System Architecture & Data Flow

```text
index.html + src/style.css (Declarative UI)
   │
   ▼
src/main.js ──► src/Fractious.js (Orchestrator & URL State Sync)
                   ├──► src/State.js (Config + Render/Progressive Pass State)
                   ├──► src/InteractionManager.js (Unified Mouse/Touch/Wheel & UI Binding)
                   ├──► src/WorkerManager.js ◄──(SharedArrayBuffer + Transferable)──► src/worker.js
                   │                                                                     │
                   │                                                                     ▼
                   │                                                             wasm/src/lib.rs
                   │                                                       (dashu DBig/FBig Anchor
                   │                                                        Search & Orbit Gen)
                   └──► src/Renderer.js (WebGPU Pipeline & Dual-Canvas Manager)
                           ├──► src/renderer/shader.wgsl (F32 / DS / QS Perturbation + Rebasing)
                           └──► src/renderer/post.wgsl (Full-Screen Blit Pass)
```

### Module Responsibilities

| File                                                     | Responsibility                                                                                                                                                                                                                                                                                                 |
| :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`index.html`](index.html)                               | Declarative markup for the dual canvases (`#fractal-bg`, `#canvas-main`), loading toast, pin overlay, and settings popover.                                                                                                                                                                                    |
| [`src/Fractious.js`](src/Fractious.js)                   | Top-level application coordinator. Manages `requestAnimationFrame` loop, adaptive iteration scaling, URL synchronization, and handoff between `WorkerManager` and `Renderer`.                                                                                                                                  |
| [`src/Renderer.js`](src/Renderer.js)                     | WebGPU device/pipeline lifecycle, dynamic precision tier switching (`F32` $\to$ `DS` $\to$ `QS`), progressive horizontal-slice rendering, and `#fractal-bg` snapshot compositing.                                                                                                                              |
| [`src/renderer/shader.wgsl`](src/renderer/shader.wgsl)   | Perturbation theory fragment shaders across 3 floating-point emulation tiers (`fs_main_f32`, `fs_main_ds`, `fs_main_qs`) with **Zhuoran's Orbit Rebasing**.                                                                                                                                                    |
| [`src/InteractionManager.js`](src/InteractionManager.js) | Unified pointer/touch/wheel gesture mathematics (zoom-around-point for pinch and double-click, 2-finger pinch/rotate) and DOM input event bindings.                                                                                                                                                            |
| [`src/WorkerManager.js`](src/WorkerManager.js)           | Main-thread bridge to the Web Worker. Signals cooperative cancellation via a 4-byte `SharedArrayBuffer` (`Atomics.store(abortArray, 0, 1)`).                                                                                                                                                                   |
| [`src/autoReload.js`](src/autoReload.js)                 | After a new service worker takes control, reloads the page onto the new version once it is hidden or the user is idle (the URL preserves the view), and checks for updates on resume.                                                                                                                          |
| [`src/worker.js`](src/worker.js)                         | Web Worker entry point. Computes required bit precision from `scale`, invokes `compute_reference`, and transfers `orbit.buffer` back zero-copy.                                                                                                                                                                |
| [`wasm/src/lib.rs`](wasm/src/lib.rs)                     | Rust/WASM core using `dashu`. Implements arbitrary-precision coordinate arithmetic (`add_coord`, `sub_coord`), and `compute_reference`: a coarse-to-fine perturbation-accelerated anchor search whose winning orbit is reused and extended into the quad-float reference orbit, truncated at its escape point. |
| `src/*.test.js`                                          | Co-located Vitest unit tests (`Fractious.test.js`, `InteractionManager.test.js`, `main.test.js`, `worker.test.js`). There is no separate `tests/` directory for web tests; mock WASM imports via `vi.mock('../wasm/pkg/fractious_lib.js', ...)`.                                                               |

---

## 3. Key Technical & Mathematical Invariants

### 3.1 Perturbation Theory & Three GPU Precision Tiers

Direct GPU evaluation fails around `scale < 1e-7` (`f32` mantissa exhaustion). Fractious computes a single arbitrary-precision reference orbit $X_0, X_1, \dots, X_M$ on the CPU (in Rust/WASM) and evaluates per-pixel deltas $\Delta_n = Z_n - X_m$ on the GPU:
$$\Delta_{n+1} = 2 X_m \Delta_n + \Delta_n^2 + \Delta c$$

`Renderer.js` automatically selects the cheapest sufficient WGSL pipeline based on `scale`:

- **Tier 1 (`fs_main_f32`)**: `scale > 1.0e-6` — Native hardware `f32` (~7 decimal digits).
- **Tier 2 (`fs_main_ds`)**: `1.0e-6 >= scale > 1.0e-13` — Knuth/Dekker Double-Single (`vec2<f32>`, ~14 decimal digits).
- **Tier 3 (`fs_main_qs`)**: `scale <= 1.0e-13` — Quad-Single (`vec4<f32>`, ~28 decimal digits).
- All three fragment entry points share a single colouring helper `compute_color(i, zn_sq, zn_sp, uv)` in `src/renderer/shader.wgsl`.
- In `InteractionManager.js`, colour/rotation/view tweaks invoke `this.callbacks.onInteract(false)` (immediate 60fps GPU re-render with a 200ms debounced reference check), whereas coordinate jumps invoke `onInteract(true)` (immediate WASM reference orbit recalculation).

### 3.2 Zhuoran's GPU Orbit Rebasing (`shader.wgsl` & `Renderer.js`)

In `shader.wgsl`, the pixel's total iteration count `i` (`0..uniforms.iter`) is decoupled from the reference orbit lookup index `m` (`0..uniforms.ref_iter`):

- At each step, the shader computes the true orbit position $Z = X_{m+1} + \Delta$.
- Whenever $|Z|^2 < |\Delta|^2$ (the pixel's orbit passes closer to the critical point $X_0 = (0, 0)$ than to the reference orbit $X_{m+1}$) **or** `next_m >= uniforms.ref_iter` (the reference orbit itself escaped at step `ref_iter`), the shader **rebases** the perturbation:
  $$\Delta \leftarrow Z, \quad m \leftarrow 0$$
- This prevents precision loss (Pauldelbrot glitches) in off-center minibrots and ensures pixels continue iterating accurately even when the reference anchor escapes earlier than `uniforms.iter`.

### 3.3 GPU Buffer Layouts (`Renderer.js` $\leftrightarrow$ `shader.wgsl`)

- **`Uniforms` Buffer (`80 bytes`, 16-byte WebGPU struct alignment)**:
  - Bytes `0..31`: `center0..center3` (`4 × vec2<f32>` quad-float representation of `(state.offsetX, state.offsetY)` relative to the reference anchor)
  - Bytes `32..47`: `zoom` (`vec4<f32>` quad-float representation of `config.zoom`)
  - Byte `48`: `aspect_ratio` (`f32`)
  - Byte `52`: `iter` (`u32`, target max iterations)
  - Byte `56`: `hue` (`f32`)
  - Byte `60`: `huestep` (`f32`)
  - Byte `64`: `rotation` (`f32`, radians)
  - Byte `68`: `slice_scale` (`f32`, progressive slice vertical scale)
  - Byte `72`: `slice_offset` (`f32`, progressive slice vertical NDC offset)
  - Byte `76`: `ref_iter` (`u32`, valid pre-escape length of `reference_orbit`)
- **`reference_orbit` Storage Buffer (`(calcIter + 1) * 32 bytes`)**:
  - Each orbit step `m` occupies `2 × vec4<f32>` (`32 bytes`): `[zx0, zx1, zx2, zx3]` at byte offset `m * 32` (`m * 2u`) and `[zy0, zy1, zy2, zy3]` at byte offset `m * 32 + 16` (`m * 2u + 1u`).
  - The orbit ends at the anchor's escape point (or `calcIter`), so `ref_iter` is simply `orbit.byteLength / 32 - 1`.

### 3.4 Dual-Canvas Zero-Latency Interaction (`#fractal-bg` + `#fractal`)

While dragging/zooming or waiting for the WASM worker to compute a new reference orbit:

1. `#fractal-bg` (a 2D canvas behind `#fractal`) is updated via `_updateBackgroundCanvas()` (`bgCtx.drawImage(this.canvas, 0, 0)`) whenever a render completes (`state.nextRow >= canvas.height`), including single-slice low-resolution interactive previews.
2. When the viewport transitions from a completed low-res preview to a multi-slice progressive high-res render (`this.canvas.width` / `height` resize), `#fractal-bg` retains the low-res preview underneath `#fractal` so there is never a black flash or stale-frame jump while progressive slices fill in.
3. Progressive high-res slices in `Fractious.frame()` are gated on `device.queue.onSubmittedWorkDone()` and a monotonically increasing `_renderGeneration` token so GPU submissions never saturate the browser compositor queue and user input can preempt in-flight progressive passes within a single frame.
4. Progressive slice height is adaptive: `Renderer.recordSliceTime()` learns per-tier GPU throughput (in worst-case ops per ms) from each slice's submit-to-done time, and `_sliceRows()` sizes the next slice to about `TARGET_SLICE_MS` (10ms). Slower measurements apply immediately, faster ones at most double the estimate, and slices are capped at `MAX_SLICE_BUDGETS` × the fixed worst-case budget to bound stalls when a slice runs into interior. Each full-res render records a `fractious:full-res` User Timing measure for traces.

---

## 4. Coding Standards & Linter Constraints

Several strict static analysis plugins run on `npm run check`. Keep these rules in mind when writing code:

1. **No Dynamic Bracket Indexing in JS (`security/detect-object-injection`)**
   - `eslint-plugin-security` flags `array[index]` or `obj[key]` when `index`/`key` is a variable.
   - Use `DataView` methods (`dv.getFloat32(byteOffset, true)`), `.at(index)`, or destructuring instead of `arr[i]` in `src/`.
2. **Worker Module Isolation (`dependency-cruiser`)**
   - `src/worker.js` must **never** import DOM-dependent modules (`src/Renderer.js`, `src/InteractionManager.js`, `src/main.js`, `src/Fractious.js`).
   - Circular dependencies anywhere in `src/` are forbidden (`no-circular`).
3. **Cognitive Complexity (`eslint-plugin-sonarjs`)**
   - Keep functions focused and modular; extract helper methods when branching depth grows (limit is `15`).
4. **Rust Formatting & Clippy (`cargo fmt --check` & `cargo clippy -- -D warnings`)**
   - All Rust code in `wasm/src/lib.rs` must pass `cargo fmt --check` (100-column max width, 4-space indent) and trigger zero Clippy warnings (e.g., keep function parameter counts $\le 7$ to satisfy `clippy::too_many_arguments`).

---

## 5. Development Workflow & Pre-Commit Quality Checks

**Always run the quality checks before committing code.**

### Full Verification Suite

```bash
npm run format        # Formats JS/HTML/CSS (Prettier) and Rust (cargo fmt)
npm run build:wasm    # Compiles wasm/ into wasm/pkg/ via wasm-pack
npm run check         # Runs format:check, eslint, clippy, wgslender, audit-ci, and depcruise
npm run test          # Builds WASM and runs both wasm-pack tests and Vitest unit tests
```

### Individual Targeted Checks

- **Format web files**: `npm run format:web`
- **Validate WGSL shaders**: `npm run lint:shaders`
- **Lint JS**: `npm run lint`
- **Check module dependency rules**: `npm run depcruise`
- **Run JS unit tests**: `npm run test:web`
- **Lint & test Rust/WASM**: `npm run lint:rust && npm run test:wasm`

> **Tip for Environments Without `wasm-pack` / `cargo` Installed Locally**:
> `wasm/pkg/` is gitignored and generated by `npm run build:wasm`. If running `npm run depcruise` or `npm run test:web` in a container without a local Rust toolchain, create a temporary ESM stub at `wasm/pkg/fractious_lib.js` exporting `default`, `init_hooks`, `compute_reference`, `add_coord`, and `sub_coord`, run the checks, and `rm -rf wasm/pkg` before committing.
