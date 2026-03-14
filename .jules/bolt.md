## 2024-05-18 - History API Performance Overhead
**Learning:** High-frequency events (like canvas panning/zooming) that update the URL can trigger slow, redundant DOM and History API operations. Micro-optimizing cold paths (like `Object.entries` vs `for...in` on startup initialization) should be avoided entirely if it trips security/linting warnings, as speed should not sacrifice overall code safety.
**Action:** When updating the URL during frequent interactions, check if the string actually changed before calling `window.history.replaceState`.
