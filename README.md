# Fractious

A deep-zooming viewer for the Mandelbrot set hosted at https://fractious-deep.web.app/.

The architecture combines :
- **Rust & WebAssembly** for calculating high-precision reference orbits on the CPU (using the `dashu` arbitrary-precision crate).
- **WebGPU** then renders via a `f32` fragment shader.
- **Web Workers** for offloading the heavy math from the UI thread.

Ping <https://bsky.app/profile/rowan.fyi> or <https://mastodon.social/@rowan_m> with questions.

## Running the app locally

This project uses [Vite](https://vitejs.dev/) as a build tool and dev server, and `wasm-pack` to compile the Rust code to WebAssembly.

Before the initial run, ensure you have Node.js and Rust installed. Then, install the npm dependencies:

```bash
npm install
```

### Build the WebAssembly Module

You need to compile the Rust arbitrary-precision math library into a WebAssembly module before the app will work:

```bash
npm run build:wasm
```

### Start the Development Server

Start the local Vite development server:

```bash
npm run dev
```

The server will run on a local port (usually `http://localhost:5173/`), which will be printed in your console.

### Build for Production

To create an optimized production build (output to the `dist/` directory):

```bash
npm run build
```