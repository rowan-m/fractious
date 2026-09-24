/// <reference types="vitest" />
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    wasm(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,wasm,wgsl}'],
        // Screenshots, social preview and install icons are only fetched by the
        // browser/OS on demand; don't make every visitor download them upfront.
        globIgnores: ['**/img/**'],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
