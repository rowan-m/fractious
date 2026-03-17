## 2024-05-18 - Missing Content Security Policy
**Vulnerability:** The application lacks a Content Security Policy (CSP), making it susceptible to Cross-Site Scripting (XSS) and unauthorized resource loading.
**Learning:** WebAssembly (Rust/Wasm) and Web Workers require specific CSP directives (`script-src 'wasm-unsafe-eval'` and `worker-src 'self' blob:`) to function correctly while maintaining a strong security posture.
**Prevention:** Always implement a strict CSP, ensuring allowances for modern web capabilities like WebAssembly are explicitly and narrowly defined.