## 2024-05-18 - Prevent Reverse Tabnabbing

**Vulnerability:** External links (`<a>` tags) in `index.html` were missing `target="_blank"` and `rel="noopener"`.
**Learning:** For a web app with advanced capabilities (e.g. cross-origin isolation, WebAssembly, Web Workers), it's essential to open external links safely. If external links are clicked, the new page could run on the same thread/process, or maliciously modify the `window.opener` object to hijack the original page (Reverse Tabnabbing).
**Prevention:** Always use `target="_blank" rel="noopener"` for external links to ensure they open in a new, unlinked context.
