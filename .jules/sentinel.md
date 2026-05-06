## 2024-05-24 - DOM XSS in Error Handling
**Vulnerability:** User-provided or dynamically generated error messages (like `err.message` from fetch operations) were being directly injected into `.innerHTML` strings in vanilla JS files (e.g., `js/records.js`).
**Learning:** Even internal error states can be vectors for XSS if the underlying payload (like a mock response or error string containing HTML entities) is rendered unsanitized.
**Prevention:** Always use `escapeHtml()` when interpolating any string into `.innerHTML`, or use safer alternatives like `.textContent` where possible.
