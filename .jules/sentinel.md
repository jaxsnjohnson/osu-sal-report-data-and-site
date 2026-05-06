## 2023-10-27 - [High] Fix XSS Vulnerability in records.js
**Vulnerability:** XSS via unescaped string interpolation in `createRecordCard` template string assignment to `innerHTML`.
**Learning:** Raw object properties sourced from JSON were interpolated without escaping directly into the DOM.
**Prevention:** Use an `escapeHtml` or `escapeHtmlAttr` wrapper around all untrusted string interpolations before assigning to `innerHTML`, or use safer text assignment methods where possible.
## 2024-05-03 - [High] Fix XSS Vulnerability in app.js updateStats
**Vulnerability:** XSS via unescaped string interpolation of transition filters in `updateStats` template string assignment to `innerHTML`.
**Learning:** Transition filter labels derived from user state were interpolated without escaping directly into the DOM inside `els.stats.innerHTML`.
**Prevention:** Use the `escapeHtml` wrapper around all untrusted string interpolations before assigning to `innerHTML`.
## 2026-05-05 - [High] Fix XSS Vulnerabilities in app.js history rendering
**Vulnerability:** XSS via unescaped string interpolation in `buildHistoryHTML` template string assignment to `innerHTML`.
**Learning:** Raw date and COLA label properties sourced from JSON were interpolated without escaping directly into the DOM (e.g., `snap.Date`, `_colaMissedLabels`, and gap start/end dates).
**Prevention:** Use an `escapeHtml` wrapper around all untrusted string interpolations, including date formatting return values, before assigning to `innerHTML`.
