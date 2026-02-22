#!/usr/bin/env node

// Minimal regression test: role filters should be normalized the same way as
// stored role strings (hyphens vs spaces should not block matches).
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
        name: 'Jane Doe',
        homeOrg: 'Science',
        lastOrg: 'Science',
        roles: ['Assistant Professor'],
        totalPay: 120000,
        firstHiredYear: 2020,
        lastDate: '2026-02-03',
        isUnclass: true,
        isActive: true
    }
]);

api.setRecords(records);
api.clearCache();

const result = api.parseAndSearch({
    query: '',
    roleFilter: 'assistant-professor',
    minSalary: null,
    maxSalary: null,
    dataFlagsOnly: false,
    exclusionsMode: 'off',
    sort: 'name-asc',
    baseNames: ['Jane Doe'],
    baseKey: '1:Jane Doe:Jane Doe',
    nowTs: Date.now()
});

assert.deepStrictEqual(
    result.names,
    ['Jane Doe'],
    'hyphenated role filter should still match normalized role strings'
);

console.log('PASS: hyphenated role filter returns matching record');
