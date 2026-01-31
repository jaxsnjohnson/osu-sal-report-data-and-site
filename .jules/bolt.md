## 2024-02-02 - Large Client-Side Data Initialization
**Learning:** This project loads a 95MB JSON file on the client. Naive initialization involving multiple passes (Data Processing + History Stats + Role Collection) resulted in 3x full dataset traversals. On large datasets, "one pass" architecture is critical for TTI.
**Action:** Always check dataset size `ls -lh` before optimizing. Merge initialization loops into a single pass when possible. Pre-calculate derived values (like cleaned numbers) during the initial pass to avoid repetitive parsing in hot paths (like search/filter).

## 2026-01-31 - Optimized Data Initialization
**Learning:** Pre-parsing numeric values (like salary strings) once during the initial data pass yielded a ~45% reduction in initialization time (330ms -> 180ms). Removing redundant JSON stringification for search strings also saved significant CPU time.
**Action:** When handling large static datasets, convert expensive-to-parse fields (regex-heavy) into native types immediately upon load. Avoid generic serialization (JSON.stringify) for building search indices if only specific fields are needed.
