#!/usr/bin/env node

// Regression parity check: worker and legacy recent-exclusion cutoff semantics
// should both use UTC-day boundaries.
const assert = require('node:assert');

const DAY_MS = 24 * 60 * 60 * 1000;

const computeUtcDayCutoffTs = (nowTs) => {
    const utcDayKey = Math.floor(nowTs / DAY_MS);
    return (utcDayKey - 365) * DAY_MS;
};

const workerRecentIncluded = (exclusionDate, nowTs) => {
    const exclusionTs = exclusionDate ? new Date(exclusionDate).getTime() : 0;
    if (!exclusionTs) return false;
    return exclusionTs >= computeUtcDayCutoffTs(nowTs);
};

const legacyRecentIncluded = ({ exclusionDate, transitionTs }, nowTs) => {
    const cutoff = computeUtcDayCutoffTs(nowTs);
    let ts = null;
    if (exclusionDate) ts = new Date(exclusionDate).getTime();
    else if (transitionTs) ts = transitionTs;
    if (!ts) return false;
    return ts >= cutoff;
};

const morningTs = Date.parse('2026-02-18T00:00:00Z');
const eveningTs = Date.parse('2026-02-18T23:59:59Z');
const nextDayTs = Date.parse('2026-02-19T00:00:00Z');
const exclusionDate = '2025-02-18';

assert.strictEqual(workerRecentIncluded(exclusionDate, morningTs), true, 'worker should include at day boundary');
assert.strictEqual(workerRecentIncluded(exclusionDate, eveningTs), true, 'worker should include later same UTC day');
assert.strictEqual(workerRecentIncluded(exclusionDate, nextDayTs), false, 'worker should exclude on next UTC day');

assert.strictEqual(
    legacyRecentIncluded({ exclusionDate, transitionTs: null }, morningTs),
    workerRecentIncluded(exclusionDate, morningTs),
    'legacy should match worker at day boundary'
);
assert.strictEqual(
    legacyRecentIncluded({ exclusionDate, transitionTs: null }, eveningTs),
    workerRecentIncluded(exclusionDate, eveningTs),
    'legacy should match worker later same UTC day'
);
assert.strictEqual(
    legacyRecentIncluded({ exclusionDate, transitionTs: null }, nextDayTs),
    workerRecentIncluded(exclusionDate, nextDayTs),
    'legacy should match worker on next UTC day rollover'
);

console.log('PASS: legacy recent cutoff semantics match worker UTC-day boundaries');
