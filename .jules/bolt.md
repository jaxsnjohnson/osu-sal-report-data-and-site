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
