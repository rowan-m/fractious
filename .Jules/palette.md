## 2024-03-09 - Emoji-based Icon Accessibility

**Learning:** Emoji-based icons (e.g., `<span class="icon">📍</span>`) inside `<button>` elements are often read aloud by screen readers by their literal emoji name (e.g., "round pushpin") which causes noise and confusion when they act merely as decorative visual cues alongside tooltips (`title` attribute).
**Action:** When adding `aria-label` to buttons containing emojis to provide descriptive functionality (like "Move left"), explicitly apply `aria-hidden="true"` to the inner decorative emoji `<span>` tags to ensure screen readers only announce the functional label.

## 2025-03-09 - Emoji-based Icon Accessibility Update

**Learning:** While hiding decorative emojis with `aria-hidden="true"` is good practice, doing so inside `<label>` elements without other text removes the accessible name for associated inputs.
**Action:** When hiding emojis inside a label, ensure the associated `<input>` element has a descriptive `aria-label` attribute directly applied.

## 2025-03-09 - Avoiding Sticky Focus Rings on Click

**Learning:** Using the generic `:focus` pseudo-class for custom focus indicators (like adding a border to icon buttons) creates a frustrating UX for pointer users, because the indicator becomes "stuck" on the element after a mouse click.
**Action:** Always prefer the `:focus-visible` pseudo-class for interactive UI elements. This ensures focus rings only appear when the user is navigating via keyboard, keeping pointer interactions clean and expected.

## 2025-03-19 - Interactive Canvas Accessibility and Affordance

**Learning:** Interactive `<canvas>` elements lack semantic meaning for screen readers and default visual affordances for pointer users. Without a `role`, screen readers may ignore the canvas entirely or read generic content, and without a cursor change, users may not realize the surface is draggable.
**Action:** Always add `role="img"` and a descriptive `aria-label` to interactive foreground `<canvas>` elements so they are announced as visual regions. Hide purely functional background canvases with `aria-hidden="true"`. Furthermore, apply `cursor: grab` and `cursor: grabbing` on `:active` to direct-manipulation surfaces to establish clear visual affordances for drag interactions.

## 2026-03-20 - Disambiguating Identical Link Text

**Learning:** Hiding decorative emojis with `aria-hidden="true"` inside links can inadvertently create ambiguous link text (multiple links on a page that read exactly the same, like "rowan.fyi") if those emojis were previously providing the visual context to distinguish them.
**Action:** When multiple links share the same visible text (especially after hiding decorative emojis), apply a descriptive `aria-label` directly to the `<a>` tag (e.g., `aria-label="Bluesky profile rowan.fyi"`) to ensure the destinations are clearly distinct for screen reader users.
