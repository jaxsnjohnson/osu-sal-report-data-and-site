#!/usr/bin/env node

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const source = fs.readFileSync(targetPath, 'utf8');

const workerFactory = Function(
    'performance',
    'self',
    'postMessage',
    'fetch',
    `"use strict";\n${source}\nreturn { prepareRecords, normalizeText, tokenize, buildOrgAliases };`
);

const api = workerFactory(
    { now: () => Date.now() },
    {},
    () => {},
    async () => {
        throw new Error('fetch is unavailable in the test harness');
    }
);

const { prepareRecords, normalizeText, tokenize, buildOrgAliases } = api;
if (typeof prepareRecords !== 'function') throw new Error('prepareRecords unavailable');

const legacyAliasFields = (rec) => {
    const homeOrgNorm = normalizeText(rec.homeOrgNorm || rec.homeOrg || '');
    const lastOrgNorm = normalizeText(rec.lastOrgNorm || rec.lastOrg || '');
    const rolesNorm = (rec.rolesNorm || []).map(normalizeText).filter(Boolean);
    const roles = rec.roles || [];
    const orgAliasesRaw = (rec.orgAliases && rec.orgAliases.length)
        ? rec.orgAliases
        : [...buildOrgAliases(rec.homeOrg), ...buildOrgAliases(rec.lastOrg)];
    const orgAliases = Array.from(new Set(orgAliasesRaw.map(normalizeText).filter(Boolean)));
    const roleAliasesRaw = (rec.roleAliases && rec.roleAliases.length)
        ? rec.roleAliases
        : roles.flatMap(role => tokenize(role));
    const roleAliases = Array.from(new Set(roleAliasesRaw.map(normalizeText).filter(Boolean)));
    const roleSearch = normalizeText((roles || []).join(' ') + ' ' + roleAliases.join(' '));
    const orgSearch = normalizeText(`${homeOrgNorm} ${lastOrgNorm} ${orgAliases.join(' ')}`);
    const orgMatchValues = [homeOrgNorm, lastOrgNorm, ...orgAliases].filter(Boolean);
    const roleMatchValues = [roleSearch, ...rolesNorm, ...roleAliases].filter(Boolean);

    return {
        orgAliases,
        roleAliases,
        roleSearch,
        orgSearch,
        orgMatchValues,
        roleMatchValues
    };
};

const baseRecord = {
    name: 'Parity Case',
    totalPay: 1,
    firstHiredYear: 2024,
    lastDate: '2026-02-01',
    isUnclass: false,
    isActive: true
};

const cases = [
    {
        label: 'explicit aliases normalize and dedupe',
        rec: {
            ...baseRecord,
            homeOrg: 'Finance',
            lastOrg: 'Finance',
            roles: ['Assistant Professor', 'Director'],
            orgAliases: [' Finance ', 'FINANCE', '', 'Fin-ance', null],
            roleAliases: ['Assistant', 'assistant ', 'DIRECTOR', '', null, 'Dir-ector']
        }
    },
    {
        label: 'fallback aliases dedupe across home and last org and role tokens',
        rec: {
            ...baseRecord,
            homeOrg: 'OSU - IT Services',
            lastOrg: 'OSU - IT Services - Security',
            roles: ['IT Manager', 'IT-Manager', 'Security Manager']
        }
    },
    {
        label: 'ordering preserved for fallback aliases and tokens',
        rec: {
            ...baseRecord,
            homeOrg: 'ABC - Dept',
            lastOrg: 'XYZ - Dept',
            roles: ['Alpha Beta', 'Beta Gamma', 'Alpha Delta']
        }
    },
    {
        label: 'empty and missing values',
        rec: {
            ...baseRecord,
            homeOrg: null,
            lastOrg: undefined,
            roles: [null, '', '   '],
            orgAliases: [],
            roleAliases: []
        }
    },
    {
        label: 'hyphenated roles tokenize parity',
        rec: {
            ...baseRecord,
            homeOrg: 'Science',
            lastOrg: 'Science',
            roles: ['Assistant-Professor', 'Associate Professor - Biology']
        }
    }
];

for (const testCase of cases) {
    const prepared = prepareRecords([testCase.rec]);
    assert.strictEqual(prepared.length, 1, `${testCase.label}: expected one prepared record`);

    const actual = prepared[0];
    const expected = legacyAliasFields(testCase.rec);

    assert.deepStrictEqual(actual.orgAliases, expected.orgAliases, `${testCase.label}: orgAliases mismatch`);
    assert.deepStrictEqual(actual.roleAliases, expected.roleAliases, `${testCase.label}: roleAliases mismatch`);
    assert.strictEqual(actual.roleSearch, expected.roleSearch, `${testCase.label}: roleSearch mismatch`);
    assert.strictEqual(actual.orgSearch, expected.orgSearch, `${testCase.label}: orgSearch mismatch`);
    assert.deepStrictEqual(actual.orgMatchValues, expected.orgMatchValues, `${testCase.label}: orgMatchValues mismatch`);
    assert.deepStrictEqual(actual.roleMatchValues, expected.roleMatchValues, `${testCase.label}: roleMatchValues mismatch`);
}

console.log('PASS: prepareRecords alias fields match legacy behavior');
