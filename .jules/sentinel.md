## 2025-01-01 - External Links Security
**Vulnerability:** External links (`<a href="...">`) lack `target="_blank" rel="noopener noreferrer"`.
**Learning:** In applications using cross-origin isolation headers (which is needed for advanced WebAssembly/Web Worker features), external links without explicit `target="_blank" rel="noopener noreferrer"` can be a risk, and lacking `rel="noopener noreferrer"` can lead to Reverse Tabnabbing.
**Prevention:** Always add `target="_blank" rel="noopener noreferrer"` to external links.
