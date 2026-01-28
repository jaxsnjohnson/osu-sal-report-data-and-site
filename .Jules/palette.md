# Palette Journal

## 2025-05-23 - Accessible Expandable Cards
**Learning:** Adding standard button semantics (`role="button"`, `tabindex="0"`) and keyboard listeners (`Enter`/`Space`) to `div`-based toggles dramatically improves usability for power users and screen reader reliability, transforming a mouse-only feature into a universally accessible one.
**Action:** Always wrap clickable `div`s with button semantics or replace with `<button>` tags where possible, and ensure visual state indicators (like rotating arrows) are coupled with `aria-expanded` states.
