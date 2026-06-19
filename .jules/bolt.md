## 2024-02-02 - Large Client-Side Data Initialization
**Learning:** This project loads a 95MB JSON file on the client. Naive initialization involving multiple passes (Data Processing + History Stats + Role Collection) resulted in 3x full dataset traversals. On large datasets, "one pass" architecture is critical for TTI.
**Action:** Always check dataset size `ls -lh` before optimizing. Merge initialization loops into a single pass when possible. Pre-calculate derived values (like cleaned numbers) during the initial pass to avoid repetitive parsing in hot paths (like search/filter).

## 2026-01-31 - Optimized Data Initialization
**Learning:** Pre-parsing numeric values (like salary strings) once during the initial data pass yielded a ~45% reduction in initialization time (330ms -> 180ms). Removing redundant JSON stringification for search strings also saved significant CPU time.
**Action:** When handling large static datasets, convert expensive-to-parse fields (regex-heavy) into native types immediately upon load. Avoid generic serialization (JSON.stringify) for building search indices if only specific fields are needed.

## 2026-02-02 - Cache Snapshot Date Parsing
**Learning:** `data.json` contains ~115k snapshots but only 23 unique report dates; parsing `new Date(snap.Date)` per snapshot was a measurable chunk of init CPU.
**Action:** When computing per-snapshot timestamps, cache `Date` parsing by date string (e.g., `Map`) and reuse across the dataset.

## 2024-04-29 - O(N) Bucket Extraction Optimization
**Learning:** Using `[...new Set(array.map(fn))]` on a sorted array of ~115,000 strings is an expensive O(N) operation due to map allocation, set insertion hashing overhead, and spread operator array reallocation. Even if the array is sorted, we cannot just assume case-insensitive contiguity (e.g. ASCII sorting puts `A-Z` before `a-z`, so `apple` and `Apple` are separated).
**Action:** Replace the `map` and `Set` operations with a custom `getUniqueBuckets(keys)` utility that uses a bitmask (for `a-z`) and a boolean (for `_`) to track seen buckets in a single O(N) pass. This eliminates intermediate allocations and handles any string ordering safely while running >10x faster.

## 2026-02-05 - Intl.NumberFormat and Regex Instantiation Overhead
**Learning:** `Intl.NumberFormat` instantiation and `RegExp` creation are surprisingly expensive operations. In frequently called utility functions like `formatMoney` or `cleanMoney`, repeatedly creating these objects caused significant CPU overhead, with 10,000 calls taking ~890ms.
**Action:** Extract and cache `Intl.NumberFormat` instances and regular expressions (e.g., `MONEY_REGEX`) into module-scoped constants so they are instantiated only once, avoiding expensive repeated object creation. This reduces overhead dramatically (~13ms for 10,000 calls).

## 2026-02-06 - Optimized calculateMovingAverage
**Learning:** `calculateMovingAverage` was previously using a generic `Array` for its ring buffer which, despite being preallocated with `new Array(bufferSize)`, can be slower for purely numeric operations compared to `Float64Array`.
**Action:** Replace `new Array(bufferSize)` with `new Float64Array(bufferSize)` for numeric ring buffers to improve performance and memory layout.

## 2026-02-06 - Hot Loop Object Allocation (Search Worker)
**Learning:** During initial data hydration (`prepareRecords`), utilizing high-level functional paradigms like `.map().filter()`, widespread `[...a, ...b]` spread operators, and recreating local regular expressions per-item significantly increases Garbage Collection (GC) overhead when processing ~20,000 objects. It was observed that these allocations compounded to over ~830ms.
**Action:** When working on large initialization functions on the frontend: avoid the spread operator inside loops (use `.push()` instead); convert `.map()` to pre-allocated arrays `new Array(len)` and `for` loops; and hoist regular expressions to file scope (resetting `lastIndex` if they have the `/g` flag) to prevent recompilation.

## 2026-05-01 - DOM Batching and Filter Pre-computation (Records Rendering)
**Learning:** The `renderRecords` function was repeatedly recalculating lowercase string representations of search properties and manually creating DOM elements in a loop. Both of these operations are extremely costly in JS, causing layout thrashing and high garbage collection pressure during the hot path of search filtering.
**Action:** Always pre-calculate derived string operations (like `toLowerCase()` and `.toString()`) during initial data fetching if they will be repeatedly used in search or filter loops. Combine DOM mutations into a `DocumentFragment` before appending them to the document to minimize browser reflows. Utilize "short-circuit" boolean evaluation paths to early-exit array filters as fast as possible.
## 2024-05-04 - Hot Path Garbage Collection and Safe Caching
**Learning:** Chained array manipulation methods (`.map().filter().sort()`) inside frequently executed functions (`buildHistoricalLaborMetrics`, `getRecordGaps`) cause massive garbage collection thrashing and performance degradation when processing large `history` arrays. Additionally, when attempting to mitigate map generation overhead by caching them globally, mutable `state` references require cache invalidation.
**Action:** Always replace chained array iterators on hot paths with pre-allocated `new Array(len)` arrays and manual `for` loops. Combine loops where possible. When adding module-scoped caches for parsed state variables, always implement reference tracking (e.g., `_cachedSnapshotDatesRef !== state.snapshotDates`) to invalidate the cache when the global state updates.
## 2024-05-07 - Redundant Iterator Chains
**Learning:** Functions like `splitFieldTerms` in `js/search-worker.js` were chaining `.filter(Boolean)` after returning from utilities like `tokenize` that already guaranteed no empty string elements, and spread operators (`...splitFieldTerms`) inside loops caused additional intermediate array allocations.
**Action:** When a utility function already sanitizes its output, do not chain redundant iterators (`.filter`). In hot paths, use manual `for` loops instead of spread operators (`...array`) inside `.push()` to prevent unnecessary array reallocation and reduce garbage collection pressure.
## 2026-05-18 - Avoid UI Chart Array Pre-allocation
**Learning:** Manual array pre-allocation (`new Array(len)`) and loop merging for small UI chart datasets (like in `ensurePersonChart` or macro charts) degrades code readability without yielding any measurable performance gain.
**Action:** Do not optimize small UI data array iterations by merging `.map` calls into verbose `for` loops. Reserve array pre-allocation and loop merging for massive, high-frequency data processing loops.

## 2026-05-18 - Optimize Analytics Loops Iteration
**Learning:** Using `Object.values().forEach()`, `Object.entries().forEach()`, or `Array.prototype.forEach()` in heavy analytics processing over large datasets (e.g., iterating through multiple buckets of employee timelines) incurs significant garbage collection overhead due to intermediate array allocations and callback function overhead.
**Action:** Always replace `Object.values().forEach()` and `Object.entries().forEach()` with native `for...in` loops, and `Array.prototype.forEach()` with native `for` loops in hot path analytics data processing to reduce GC pressure and callback overhead. Use `continue` instead of `return` when converting `forEach` to `for` loops.

## 2024-05-10 - Regex Compilation Caching
**Learning:** Instantiating `RegExp` objects repeatedly inside a high-frequency loop (or rapidly called function like a search parser) causes measurable performance overhead.
**Action:** Introduced an LRU-style map cache (`_regexCache`) in `js/search-worker.js` for `parseQuery` to cache compiled `RegExp` instances based on the raw query string. Care must be taken to safely reset `lastIndex = 0` for cached expressions to prevent state bleeding.
## 2026-06-18 - Pre-compile regexes in Python parsing scripts
**Learning:** Python's `re.search`, `re.split`, and `re.findall` with inline string patterns compile the regexes on every execution. In high-frequency loops (e.g., parsing 50,000 text blocks per file), this causes significant CPU overhead.
**Action:** Pre-compiled all frequently used regex patterns (`re.compile(...)`) at the module level in `scripts/salary_report_parser.py` and used the compiled objects' `.search`, `.split`, and `.findall` methods, resulting in a ~22% speedup.

## 2026-05-18 - Optimize Analytics Aggregations and Top-K Selection
**Learning:** `calculateStats` was heavily utilized during search filtering. Creating frequency maps via raw JavaScript objects (`{}`) incurs prototype overhead. Additionally, flattening these objects into arrays with `Object.entries()` followed by a complete `Array.prototype.sort()` to extract only the top 4 or 5 items results in unneeded O(N log N) overhead and memory allocations.
**Action:** Use ES6 `Map`s for high-frequency tracking (e.g., role counts). Replace `Array.sort().slice(0, K)` with an O(N) top-K linear scan function when `K` is small (like 4 or 5) to dramatically reduce sorting time and intermediate array allocations.
## 2024-05-28 - Optimize dictionary-mode object iteration
**Learning:** `for...in` loops in Node.js/V8 incur a significant performance penalty when iterating over very large objects that have fallen into dictionary mode (e.g., parsing large JSON payloads into Javascript maps). Furthermore, `Object.entries()` is inefficient as it allocates thousands of key-value tuples, increasing GC pressure.
**Action:** Replace `for...in` loops with `Object.keys()` + native `for` loops when iterating over large datasets like the ones loaded by `loadBucket` to improve iteration speed and reduce V8 internal transition overhead.

## 2026-05-18 - String Concatenation Loop Optimization
**Learning:** Manual string concatenation inside a loop (`tailJoined += ...`) causes inefficient memory reallocations, and nested tokenization loops (`for (token of tokenize(value))`) inside search matching functions incur heavy iteration overhead.
**Action:** Replace string concatenation loops with array `split` and `join` operations, and replace inner tokenization loops with a single tokenization of a joined array (`tokenize(values.join(' '))`) to eliminate repetitive loops while retaining equivalent token matching logic.

## 2024-05-29 - Optimize Nested Dictionary Construction in split_data.py
**Learning:** In Python, constructing a dictionary using a nested `for` loop with intermediate assignments (`dict[k] = {}`) and inner loops is generally slower than using dictionary comprehensions. Even when an in-place operation like `.sort()` is required, splitting the logic into two passes—a fast outer loop strictly for `.sort()` and a subsequent dictionary comprehension for mapping—can yield small performance gains due to Python's optimized `MAP_ADD` opcode.
**Action:** Replaced the nested loops for building `peer_median_map` in `split_data.py` with a two-pass approach: an initial fast loop to sort the values in-place, followed by a dictionary comprehension to compute and map the medians.

## 2025-02-12 - XML element parsing overhead
**Learning:** Using `ElementTree.iterfind` and `.find` with namespace strings (e.g. `a:t`) triggers the expensive XPath compiler inside hot loops, making XML traversal very slow for large documents like `sharedStrings.xml` and `sheet1.xml`.
**Action:** Replace `iterfind` and `.find` in hot loops with `.iter(tag)` and `.find(tag)` using directly formatted URI tags (e.g., `f"{{{SPREADSHEET_NS['a']}}}t"`). This simple string formatting bypasses the XPath engine, yielding over 30-70% performance improvements depending on node depth and size.

## 2024-06-11 - Fast File Iteration with Promise.all and Native Loops
**Learning:** Loading many JSON chunks sequentially and iterating through dictionary-like objects with `forEach` over `Object.keys()` is extremely slow. `fs.readFile` inside `for...of` loops prevents concurrent reads.
**Action:** Always batch I/O bound tasks using `Promise.all` and native array iterations (e.g., standard `for (let i = 0; i < keys.length; i++)`) rather than `.forEach()` which introduces heavy call-stack overhead and reduces V8's optimization capabilities in hot loops over massive keysets.

## 2024-06-12 - Hot Loop Function Overhead (calculateStats)
**Learning:** During heavy filtering loops over large datasets (e.g., `calculateStats` over `state.filteredKeys`), repeatedly invoking helper functions like `personOrg(p)` causes measurable performance degradation due to function call overhead.
**Action:** Inline or cache properties like `p._lastJob['Job Orgn']` and `p.Meta['Home Orgn']` directly within hot loops instead of abstracting property resolution into separate function calls.

## 2026-06-13 - Node.js File I/O Optimization
**Learning:** In Node.js scripts (like `check_mixed_classification.js`), parsing multiple JSON files sequentially inside a `for...of` loop creates a severe I/O bottleneck due to synchronous-like waiting.
**Action:** Always batch file loading and JSON parsing using `Promise.all` combined with `.map()` for concurrent operations when processing multiple files. This significantly reduces I/O wait times and improves execution speed.

## 2026-06-13 - Iterate Over Object Keys Efficiently
**Learning:** Iterating over object properties using `Object.keys(obj).forEach()` incurs callback overhead for every iteration and adds minor garbage collection pressure, which becomes measurable over large datasets.
**Action:** Replace `Object.keys(obj).forEach()` with standard, indexed `for` loops (e.g., `const keys = Object.keys(obj); for (let i = 0; i < keys.length; i++)`) in hot paths and data scripts.

## 2026-05-18 - Avoid Object.keys().forEach() in Analytics Loops
**Learning:** `check_mixed_classification.js` processed all user timelines using `Object.keys(data).forEach()`. Iterating over potentially large parsed JSON datasets using Array `forEach` on keys creates unnecessary callback allocations and garbage collection pressure in a hot loop context.
**Action:** Replace `Object.keys().forEach()` with native `for` loops (e.g. `const keys = Object.keys(data); for (let i = 0; i < keys.length; i++)`) in backend scripts that perform deep data analytics to minimize iteration overhead.

## 2026-06-18 - Pre-compiled RegExp for Multi-Character Validation
**Learning:** String scanning for multiple invalid characters using iterative `.includes()` checks or explicit character-by-character loops inside `extractRegexLiteralBranches` causes significant CPU overhead in hot paths compared to using V8's optimized regex engine.
**Action:** Replace multiple `.includes()` checks and individual character comparisons with a module-level pre-compiled RegExp (e.g., `/[()\\.*+?\[\]{}]/.test(str)`). This leverages the native regex engine, consistently improving parsing speed by ~20%.

## 2026-06-18 - Optimize Heavy Object Property Access
**Learning:** In high-frequency iteration loops (like `calculateStats`), repeatedly accessing deep properties (e.g., `p._lastJob['Job Title']`) or evaluating derived fields with fallback chains (e.g., `personOrg(p)`) introduces N+1 performance bottlenecks due to property lookups and function call overhead.
**Action:** When evaluating static or slowly-changing derived properties over large datasets during frequent filtering cycles, add inline caching (e.g., `p._cachedOrg`, `p._cachedRole`) to reduce functional bottlenecks into O(1) object property lookups.
## 2026-06-19 - Hoist regular expressions out of nested loops in UI Analytics
**Learning:** In frontend analytics reports like `upper-middle-mang-report.html`, compiling ad-hoc regular expressions (e.g., `/[,\s]/g` for stripping commas in salary formats) inside the innermost loop for every parsed job causes unnecessary CPU overhead.
**Action:** When performing string sanitization inside hot paths/deeply nested loops, hoist the `RegExp` literal (e.g., `const commaSpaceRe = /[,\s]/g;`) out of the loops to eliminate repeated compilation.
