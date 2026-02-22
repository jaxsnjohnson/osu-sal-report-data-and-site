#!/usr/bin/env node

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

const basePayload = {
    roleFilter: '',
    minSalary: null,
    maxSalary: null,
    dataFlagsOnly: false,
    exclusionsMode: 'off',
    sort: 'name-asc',
    transitionNames: null,
    transitionKey: '',
    baseKey: 'search-dsl-regressions',
    baseNames: null,
    nowTs: Date.parse('2026-02-20T00:00:00Z')
};

// Regression A: comma-separated pay filter should parse as full numbers.
api.setRecords(api.prepareRecords([
    {
        name: 'Low Salary',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Analyst'],
        totalPay: 500,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    },
    {
        name: 'Mid Salary',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Analyst'],
        totalPay: 75000,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    },
    {
        name: 'High Salary',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Analyst'],
        totalPay: 200000,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    }
]));
api.clearCache();

const payNoComma = api.parseAndSearch({
    ...basePayload,
    query: 'pay:>100000'
});
const payWithComma = api.parseAndSearch({
    ...basePayload,
    query: 'pay:>100,000'
});
const payRangeWithCommas = api.parseAndSearch({
    ...basePayload,
    query: 'pay:60,000-90,000'
});

assert.deepStrictEqual(
    payNoComma.names,
    ['High Salary'],
    'pay filter without commas should return only high salary record'
);
assert.deepStrictEqual(
    payWithComma.names,
    payNoComma.names,
    'comma-separated pay filter should behave the same as non-comma filter'
);
assert.deepStrictEqual(
    payRangeWithCommas.names,
    ['Mid Salary'],
    'comma-separated pay range should parse both bounds correctly'
);

// Regression B: quoted field terms must stay field-scoped and split into tokens.
api.setRecords(api.prepareRecords([
    {
        name: 'Exact Match',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Research Assistant'],
        totalPay: 90000,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    },
    {
        name: 'Reversed Role',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Assistant Research'],
        totalPay: 92000,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    },
    {
        name: 'Assistant Bob',
        homeOrg: 'Org',
        lastOrg: 'Org',
        roles: ['Research Scientist'],
        totalPay: 95000,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    },
    {
        name: 'Scientist',
        homeOrg: 'Assistant Office',
        lastOrg: 'Org',
        roles: ['Research Scientist'],
        totalPay: 96000,
        firstHiredYear: 2020,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true
    }
]));
api.clearCache();

const quotedRole = api.parseAndSearch({
    ...basePayload,
    query: 'role:"research assistant"'
});

assert.deepStrictEqual(
    quotedRole.names,
    ['Exact Match', 'Reversed Role'],
    'quoted role field should require both tokens in the role field and avoid cross-field leaks'
);

console.log('PASS: search DSL regressions for pay commas and quoted field scoping');
