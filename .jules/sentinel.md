## 2024-05-20 - Missing URL parameter validation for high-precision arithmetic strings
**Vulnerability:** URL parameters `x` and `y` intended for high-precision arithmetic in Wasm/Rust were directly read and assigned without validation.
**Learning:** Because these parameters are stored as strings to avoid JS precision loss before passing to the backend, they bypassed typical frontend numeric parsing, allowing arbitrary string injections into the visualization state (`config.centerX`, `config.centerY`) from crafted URLs.
**Prevention:** Validate string-based high-precision inputs using `!isNaN(parseFloat(val)) && isFinite(val)` to ensure they represent valid, finite numeric strings before assignment.
