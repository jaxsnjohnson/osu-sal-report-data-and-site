## 2024-05-24 - DOM XSS in Error Handling
**Vulnerability:** User-provided or dynamically generated error messages (like `err.message` from fetch operations) were being directly injected into `.innerHTML` strings in vanilla JS files (e.g., `js/records.js`).
**Learning:** Even internal error states can be vectors for XSS if the underlying payload (like a mock response or error string containing HTML entities) is rendered unsanitized.
**Prevention:** Always use `escapeHtml()` when interpolating any string into `.innerHTML`, or use safer alternatives like `.textContent` where possible.
## 2024-05-24 - Unescaped HTML attributes in tooltips
**Vulnerability:** Found an unescaped variable injected into a custom data attribute (`data-tooltip`). `colaTooltip` included `person._colaMissedLabels` which is user/data-controlled input. This leads to Attribute-Based XSS if an attacker can manipulate the properties to break out of the quotes.
**Learning:** Even though text in a `data-` attribute is generally read as text, it's injected inside an HTML tag string literal during render. Unescaped quotes inside variables (e.g. `_colaMissedLabels.join(', ')`) will break the HTML tag context and execute injected code.
**Prevention:** Always wrap dynamically generated content used inside HTML attributes with an attribute-specific HTML escaper (like `escapeHtmlAttr()`). Never assume data arrays are clean strings.
## 2024-05-24 - DOM XSS in Inline JavaScript Event Handlers
**Vulnerability:** `escapeForSingleQuote` was escaping only single quotes and backslashes for use in inline event handlers (e.g. `onclick="applySearch('${value}')"`). The browser parses and decodes HTML entities inside attribute values *before* the JavaScript runtime executes the handler. By providing an entity like `&apos;`, an attacker can break out of the string context in the decoded JavaScript string.
**Learning:** Single-quote escaping (`\'`) is insufficient when the string is injected into an HTML attribute that evaluates as JavaScript (like `onclick`). The browser HTML parser processes the string first, allowing HTML entities to bypass simple JS escapes.
**Prevention:** Always perform full HTML entity escaping (`&`, `<`, `>`, `"`) in addition to JavaScript escaping (`\'`, `\\`) for dynamically injected inline event handlers.
## 2024-05-24 - Unescaped User Input in DOM Interpolation
**Vulnerability:** User-controlled JSON data attributes (`item.type` and `job['Salary Term']`) were dynamically injected into the DOM as HTML text and inside HTML attributes (`data-tooltip`) without appropriate sanitization.
**Learning:** Even variables fetched from backend APIs or JSON datasets should be treated as potentially malicious input. Interpolating them without an escaping function opens the application to DOM-based XSS attacks.
**Prevention:** Always explicitly wrap dynamically loaded data in HTML templates with sanitization utilities such as `escapeHtml()` for generic string nodes and `escapeHtmlAttr()` for HTML attributes.
## 2026-05-25 - DOM XSS via unescaped variables in innerHTML
**Vulnerability:** Unescaped variables like `latestDateLabel`, `metrics.indexBaseDate`, and `month` (in `inflation.html`) were injected directly into `.innerHTML` templates, creating a Cross-Site Scripting (XSS) vulnerability if any user-controlled input manages to reach these template interpolations.
**Learning:** Even variables that seem safe or format-controlled (like dates) should be explicitly HTML-escaped before being rendered into `.innerHTML` as a defense-in-depth measure. When dealing with global data objects or generated labels, ensuring all interpolations are wrapped in `escapeHtml` is critical.
**Prevention:** Always wrap dynamically generated content used inside HTML text content with an HTML escaper (like `escapeHtml()`) before injecting it via `.innerHTML`. Ensure `escapeHtml()` is available in the scope where it is called (e.g., redefined in `inflation.html`).

## 2026-06-01 - DOM XSS in HTML Attribute Interpolation
**Vulnerability:** The custom `escapeHtmlAttr` function only escaped ampersands (`&`) and double quotes (`"`). This left elements vulnerable to DOM XSS if attributes were constructed using single quotes (e.g., `value='...'`) or if the payload contained `<` or `>` characters to break out of elements when injecting values dynamically into `innerHTML`. Specifically, single-quote strings injected inside inline JS event handlers (like `onclick="applySearch('${...}')"`) were vulnerable despite `escapeForSingleQuote` being used, since the HTML parser evaluates entities before JS execution.
**Learning:** Browser HTML parsing decodes HTML entities inside attributes *before* passing the literal value to the inline JavaScript execution context.
**Prevention:** Ensure that all HTML attribute escaping utilities rigorously replace all standard HTML entities: `&`, `<`, `>`, `"`, and `'`.

## 2024-05-24 - DOM XSS Defense-in-Depth via innerHTML template variables
**Vulnerability:** Found variables dynamically interpolated into `.innerHTML` templates (like `fmtPct(...)` and `perCapitaGapLabel` in `js/app.js`) without explicit escaping. Even if these variables are currently generated safely (e.g., as numbers or fixed formats), they act as potential injection vectors if the upstream data logic changes.
**Learning:** Variables that are presumed safe due to formatting functions can still be a source of XSS if the formatting function is bypassed or modified. Explicitly escaping all variables injected into HTML text ensures a robust defense-in-depth posture.
**Prevention:** Always wrap dynamically generated content used inside HTML text content with an HTML escaper (like `escapeHtml()`) before injecting it via `.innerHTML`, regardless of the presumed type or format of the data.

## 2024-05-24 - DOM XSS in Inline HTML Event Handlers via Insufficient Attribute Escaping
**Vulnerability:** `escapeHtmlAttr` in `js/app.js` and `js/records.js` only escaped `&` and `"`. When generating `onclick` attribute strings like `onclick="applySearch('${escapeHtmlAttr(value)}')"`, this was insufficient because the browser's HTML parser runs before the JavaScript execution context. Unescaped single quotes (`'`) allowed breaking out of the JavaScript string literal.
**Learning:** For defense in depth against DOM XSS, especially when inserting untrusted data into inline HTML event handlers, the escaping routine MUST escape all HTML control characters (`&`, `<`, `>`, `"`, `'`) because the browser decodes HTML entities before handing the payload to the JS runtime.
**Prevention:** `escapeHtmlAttr` was updated to fully escape `&`, `<`, `>`, `"`, and `'`. Ensure any custom attribute escapers mimic standard HTML entity encoding for all five major control characters.
