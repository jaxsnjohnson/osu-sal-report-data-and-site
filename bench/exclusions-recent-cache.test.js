#!/usr/bin/env node

// Regression: recent exclusion filter should be stable throughout a UTC day
// and remain consistent regardless of cache state.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'search-worker.js'), 'utf8');

const workerFactory = Function(
    'performance',
    'self',
    'postMessage',
    'fetch',
    `"use strict";\n${source}\nreturn {
        prepareRecords,
        parseAndSearch,
        setRecords: (next) => { records = next; },
        clearCache: () => { resultCache.clear(); }
    };`
);

const api = workerFactory(
    { now: () => Date.now() },
    {},
    () => {},
    async () => { throw new Error('fetch is unavailable in the test harness'); }
);

const records = api.prepareRecords([
    {
        name: 'Stale Excluded',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Engineer'],
        totalPay: 100000,
        firstHiredYear: 2020,
        lastDate: '2025-02-18',
        isUnclass: true,
        isActive: true,
        wasExcluded: true,
        exclusionDate: '2025-02-18'
    }
]);

api.setRecords(records);
api.clearCache();

const basePayload = {
    query: '',
    roleFilter: '',
    minSalary: null,
    maxSalary: null,
    dataFlagsOnly: false,
    exclusionsMode: 'recent',
    sort: 'name-asc',
    transitionNames: null,
    transitionKey: '',
    baseKey: 'test',
    baseNames: null
};

const morning = api.parseAndSearch({
    ...basePayload,
    nowTs: Date.parse('2026-02-18T00:00:00Z')
});

assert.deepStrictEqual(
    morning.names,
    ['Stale Excluded'],
    'record should be included on the UTC-day boundary'
);

const eveningCached = api.parseAndSearch({
    ...basePayload,
    nowTs: Date.parse('2026-02-18T23:59:59Z')
});

assert.deepStrictEqual(
    eveningCached.names,
    ['Stale Excluded'],
    'same-day query should remain stable when served from cache'
);

api.clearCache();

const eveningFresh = api.parseAndSearch({
    ...basePayload,
    nowTs: Date.parse('2026-02-18T23:59:59Z')
});

assert.deepStrictEqual(
    eveningFresh.names,
    ['Stale Excluded'],
    'same-day query should match cached behavior after cache clear'
);

const nextDay = api.parseAndSearch({
    ...basePayload,
    nowTs: Date.parse('2026-02-19T00:00:00Z')
});

assert.deepStrictEqual(
    nextDay.names,
    [],
    'record should drop at the next UTC day after the 365-day window'
);

console.log('PASS: recent exclusion filter is UTC-day stable and cache-consistent');
