## 2023-10-27 - [High] Fix XSS Vulnerability in records.js
**Vulnerability:** XSS via unescaped string interpolation in `createRecordCard` template string assignment to `innerHTML`.
**Learning:** Raw object properties sourced from JSON were interpolated without escaping directly into the DOM.
**Prevention:** Use an `escapeHtml` or `escapeHtmlAttr` wrapper around all untrusted string interpolations before assigning to `innerHTML`, or use safer text assignment methods where possible.
## 2024-05-24 - Cross-Site Scripting (XSS) in Vanilla JS DOM Injections
**Vulnerability:** Several dynamically generated components (like the dashboard org leaderboard, role legend, and personnel history tables) were using template literals to inject properties directly from the untrusted dataset into `element.innerHTML` without proper HTML escaping. This could allow an attacker who controls the input JSON data to inject arbitrary HTML and script code (XSS).
**Learning:** Vanilla JS template literals do not automatically escape input. Data injected into `innerHTML` must always be sanitized manually. It's easy to overlook dataset fields as "trusted," but any string originating from JSON data needs to be treated as untrusted to prevent potential injection vulnerabilities if the data layer is ever compromised or misused.
**Prevention:** Always use the local `escapeHtml()` and `escapeHtmlAttr()` functions when interpolating dynamic data into `innerHTML` strings, specifically for properties that can contain unconstrained text (names, titles, organizations).
