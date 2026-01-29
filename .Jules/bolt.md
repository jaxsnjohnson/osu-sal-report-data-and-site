## 2026-01-29 - JSON.stringify in Hot Loops
**Learning:** `JSON.stringify` is expensive when called repeatedly in a filter loop (O(N) operations where N is large).
**Action:** Pre-compute serialized strings for static data during the initialization phase to allow O(1) string lookups during runtime.
