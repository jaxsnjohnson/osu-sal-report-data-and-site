## 2023-10-27 - [High] Fix XSS Vulnerability in records.js
**Vulnerability:** XSS via unescaped string interpolation in `createRecordCard` template string assignment to `innerHTML`.
**Learning:** Raw object properties sourced from JSON were interpolated without escaping directly into the DOM.
**Prevention:** Use an `escapeHtml` or `escapeHtmlAttr` wrapper around all untrusted string interpolations before assigning to `innerHTML`, or use safer text assignment methods where possible.
