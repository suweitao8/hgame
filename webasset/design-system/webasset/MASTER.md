# WebAsset — UI Design System

> Source of truth for WebAsset interface work. Read this before changing page structure, styling, or interactions.

## Product and design direction

- **Product:** local, desktop-first character asset workstation. This is a working tool, not a landing page or marketing dashboard.
- **Direction:** minimalist, visual-first, compact, calm, and functional.
- **Design dials:** variance 2/10, motion 1/10, density 4/10. Keep layout predictable, motion nearly invisible, and information compact without making controls cramped.
- **Primary content:** character imagery and interactive 3D models. UI chrome should support these assets rather than compete with them.
- **Architecture:** preserve the current vanilla HTML/CSS/JavaScript + Three.js stack.

## Layout hierarchy

1. Character list and search stay in the left navigation rail.
2. The main workspace prioritizes reference images and generated images.
3. Character settings and the 3D model viewer remain clearly separated; the model viewer should receive enough width and height to inspect the asset.
4. Keep the existing mode controls: **影视 / 模型** and **高模 / 低模 / UV**. Capsule styling is reserved for these mutually exclusive view switches.
5. On narrow screens, stack regions in task order and prevent horizontal scrolling.

Do not introduce a hero section, FAQ layout, generic analytics dashboard, or bento-card grid by default. Those patterns do not match this product.

## Content rules

- Use short Chinese labels and action verbs: e.g. `新增角色`, `上传 GLB`, `播放 Run`.
- One concise heading per functional area. Do not repeat the same information in headings, badges, helper text, and buttons.
- No marketing slogans, decorative English eyebrow labels, long introductions, or permanent paragraphs explaining obvious controls.
- Prefer icons, thumbnails, filenames, and direct visual state over explanatory prose where the meaning is clear.
- Put optional explanations in a tooltip or contextual help. Keep empty/error messages to one short sentence and offer the next action when useful.
- Keep field labels visible; placeholders are examples, not labels.

## Visual language

Preserve the established dark forest/graphite theme unless the user explicitly requests a redesign of the theme. Start from the current CSS variables:

| Role | Existing token | Value |
|---|---|---|
| Background | `--bg` | `#10130f` |
| Panel | `--panel` | `#171c16` |
| Raised panel | `--panel-raised` | `#1d241b` |
| Border | `--line` | `rgba(226, 235, 215, .11)` |
| Primary text | `--text` | `#f2f3ec` |
| Secondary text | `--muted` | `#9ca795` |
| Accent | `--accent` | `#d5e4b4` |

- Keep the palette restrained. Use the accent for active states and primary actions, not as a large decorative fill.
- Prefer flat surfaces, thin separators, and subtle state changes. Avoid gradients, glassmorphism, neon, heavy shadows, and decorative texture.
- Avoid excessive rounded cards. Use modest radii for real controls and panels; reserve pill shapes for segmented mode controls and compact status indicators.
- Keep the existing system Chinese font stack unless there is a clear, tested reason to change it. Do not load remote fonts for cosmetic reasons.
- Maintain readable contrast. Secondary text may be quieter, but must remain legible.
- Use a compact spacing rhythm based on 4, 8, 12, 16, and 24px. Do not add large editorial whitespace to a dense working surface.

## Interaction and accessibility

- Every control must have a clear purpose, state, and feedback. Avoid hidden actions and hover-only functionality.
- Icon-only buttons require an accessible name and a visible tooltip/title.
- Preserve keyboard operation, visible `:focus-visible` states, semantic form labels, and appropriate ARIA/live-region feedback.
- Use concise loading, success, failure, and empty states. Do not silently fail or show placeholder content as if it were real data.
- Use restrained transitions for state feedback only. Do not add scroll-triggered reveals or ambient motion. Respect `prefers-reduced-motion`.
- Ensure touch targets are comfortably usable on narrow/touch layouts and keep adequate spacing between adjacent actions.

## 3D workspace

- Give the model viewport the largest practical area within its panel.
- Keep high/low/UV switching and Run controls adjacent to the viewport and visually secondary to the model.
- Do not surround the viewport with multiple nested cards or explanatory text.
- Keep model loading, missing-model, missing-UV, and animation states explicit but concise.
- Do not trade model readability or rendering performance for decorative UI effects.

## Non-goals

- No marketing-page layout or oversized hero copy.
- No decorative cards, badges, gradients, animations, or shadows without a functional reason.
- No framework migration or dependency additions for visual polish alone.
- No broad visual redesign or theme change unless the user requests it.

## Before delivery

- Check the page at the normal desktop size and a narrow viewport.
- Confirm that the primary images and 3D model remain the visual focus.
- Confirm there is no repeated or unnecessary explanatory copy.
- Test the main controls, keyboard focus, empty/error states, and responsive layout.
- For a formal UI review, run the installed `web-design-guidelines` skill against the changed files using its latest guideline source.

