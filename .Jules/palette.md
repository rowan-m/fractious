## 2024-03-09 - Emoji-based Icon Accessibility

**Learning:** Emoji-based icons (e.g., `<span class="icon">📍</span>`) inside `<button>` elements are often read aloud by screen readers by their literal emoji name (e.g., "round pushpin") which causes noise and confusion when they act merely as decorative visual cues alongside tooltips (`title` attribute).
**Action:** When adding `aria-label` to buttons containing emojis to provide descriptive functionality (like "Move left"), explicitly apply `aria-hidden="true"` to the inner decorative emoji `<span>` tags to ensure screen readers only announce the functional label.

## 2025-03-09 - Emoji-based Icon Accessibility Update

**Learning:** While hiding decorative emojis with `aria-hidden="true"` is good practice, doing so inside `<label>` elements without other text removes the accessible name for associated inputs.
**Action:** When hiding emojis inside a label, ensure the associated `<input>` element has a descriptive `aria-label` attribute directly applied.
## 2025-03-09 - Avoiding Sticky Focus Rings on Click
**Learning:** Using the generic `:focus` pseudo-class for custom focus indicators (like adding a border to icon buttons) creates a frustrating UX for pointer users, because the indicator becomes "stuck" on the element after a mouse click.
**Action:** Always prefer the `:focus-visible` pseudo-class for interactive UI elements. This ensures focus rings only appear when the user is navigating via keyboard, keeping pointer interactions clean and expected.
