#!/usr/bin/env node

'use strict';

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
        clearCache: () => { resultCache.clear(); },
        setRegexPrefilterEnabled
    };`
);

const api = workerFactory(
    { now: () => Date.now() },
    {},
    () => {},
    async () => { throw new Error('fetch is unavailable in the test harness'); }
);

if (typeof api.setRegexPrefilterEnabled !== 'function') {
    throw new Error('Expected setRegexPrefilterEnabled helper to exist');
}

const basePayload = {
    roleFilter: '',
    minSalary: null,
    maxSalary: null,
    dataFlagsOnly: false,
    exclusionsMode: 'off',
    sort: 'name-asc',
    transitionNames: null,
    transitionKey: '',
    baseKey: 'search-worker-regex-prefilter-parity',
    baseNames: null,
    nowTs: Date.parse('2026-02-20T00:00:00Z')
};

const runBoth = (payload) => {
    api.setRegexPrefilterEnabled(true);
    api.clearCache();
    const enabled = api.parseAndSearch(payload);

    api.setRegexPrefilterEnabled(false);
    api.clearCache();
    const disabled = api.parseAndSearch(payload);

    api.setRegexPrefilterEnabled(true);
    api.clearCache();

    return { enabled, disabled };
};

const assertParity = (label, payload) => {
    const { enabled, disabled } = runBoth(payload);
    assert.deepStrictEqual(
        {
            names: enabled.names,
            regexMode: enabled.regexMode,
            regexTooBroad: enabled.regexTooBroad,
            warning: enabled.warning,
            highlightTerms: enabled.highlightTerms
        },
        {
            names: disabled.names,
            regexMode: disabled.regexMode,
            regexTooBroad: disabled.regexTooBroad,
            warning: disabled.warning,
            highlightTerms: disabled.highlightTerms
        },
        `Regex prefilter parity mismatch for ${label}`
    );
};

const fixtureRecords = api.prepareRecords([
    {
        name: 'John Active Director',
        homeOrg: 'Engineering',
        lastOrg: 'Engineering',
        roles: ['Director'],
        totalPay: 130000,
        firstHiredYear: 2018,
        lastDate: '2026-02-01',
        isUnclass: true,
        isActive: true,
        hasFlags: true,
        wasExcluded: true,
        exclusionDate: '2025-11-15'
    },
    {
        name: 'Jane Old Manager',
        homeOrg: 'Engineering',
        lastOrg: 'Operations',
        roles: ['Manager'],
        totalPay: 120000,
        firstHiredYear: 2012,
        lastDate: '2026-01-15',
        isUnclass: true,
        isActive: false,
        hasFlags: true,
        wasExcluded: true,
        exclusionDate: '2023-01-15'
    },
    {
        name: 'Jon Analyst',
        homeOrg: 'Finance',
        lastOrg: 'Finance',
        roles: ['Analyst'],
        totalPay: 70000,
        firstHiredYear: 2021,
        lastDate: '2026-02-10',
        isUnclass: false,
        isActive: true,
        hasFlags: false,
        wasExcluded: false
    },
    {
        name: 'Johnny Engineer',
        homeOrg: 'Research',
        lastOrg: 'Engineering',
        roles: ['Software Engineer'],
        totalPay: 95000,
        firstHiredYear: 2019,
        lastDate: '2026-02-05',
        isUnclass: true,
        isActive: true,
        hasFlags: false,
        wasExcluded: false
    }
]);

api.setRecords(fixtureRecords);
api.clearCache();

assertParity('simple-literal', { ...basePayload, query: '/john/' });
assertParity('anchored-literal', { ...basePayload, query: '/^john/' });
assertParity('literal-alternation', { ...basePayload, query: '/(director|manager)/' });
assertParity('complex-fallback', { ...basePayload, query: '/j.*n/' });
assertParity('invalid-regex', { ...basePayload, query: '/[/' });
assertParity('payload-filters', {
    ...basePayload,
    query: '/(john|manager)/',
    roleFilter: 'director',
    minSalary: 100000,
    maxSalary: 150000,
    dataFlagsOnly: true,
    exclusionsMode: 'recent'
});
assertParity('base-set-and-transition-set', {
    ...basePayload,
    query: '/john/',
    baseNames: ['John Active Director', 'Johnny Engineer'],
    transitionNames: ['John Active Director'],
    transitionKey: 'fixture-transitions'
});

const realDataset = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'search-index.json'), 'utf8'));
const realRawRecords = Array.isArray(realDataset) ? realDataset : (realDataset.records || []);
api.setRecords(api.prepareRecords(realRawRecords));
api.clearCache();

assertParity('real-literal', { ...basePayload, query: '/john/' });
assertParity('real-anchored', { ...basePayload, query: '/^john/' });
assertParity('real-alternation', { ...basePayload, query: '/(director|manager)/' });
assertParity('real-complex-fallback', { ...basePayload, query: '/j.*n/' });
assertParity('real-broad', { ...basePayload, query: '/.*/' });

console.log('PASS: regex prefilter parity matches full regex scan (fixture + real dataset)');
