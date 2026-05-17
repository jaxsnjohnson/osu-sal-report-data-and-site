## 2024-05-24 - DOM XSS in Error Handling
**Vulnerability:** User-provided or dynamically generated error messages (like `err.message` from fetch operations) were being directly injected into `.innerHTML` strings in vanilla JS files (e.g., `js/records.js`).
**Learning:** Even internal error states can be vectors for XSS if the underlying payload (like a mock response or error string containing HTML entities) is rendered unsanitized.
**Prevention:** Always use `escapeHtml()` when interpolating any string into `.innerHTML`, or use safer alternatives like `.textContent` where possible.
## 2024-05-24 - Unescaped HTML attributes in tooltips
**Vulnerability:** Found an unescaped variable injected into a custom data attribute (`data-tooltip`). `colaTooltip` included `person._colaMissedLabels` which is user/data-controlled input. This leads to Attribute-Based XSS if an attacker can manipulate the properties to break out of the quotes.
**Learning:** Even though text in a `data-` attribute is generally read as text, it's injected inside an HTML tag string literal during render. Unescaped quotes inside variables (e.g. `_colaMissedLabels.join(', ')`) will break the HTML tag context and execute injected code.
**Prevention:** Always wrap dynamically generated content used inside HTML attributes with an attribute-specific HTML escaper (like `escapeHtmlAttr()`). Never assume data arrays are clean strings.
