#!/usr/bin/env node

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'js', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

const statsHeader = '// ==========================================\n// STATISTICS & DASHBOARD\n// ==========================================\n';
const statsStart = appSource.indexOf(statsHeader);
const calcStart = appSource.indexOf('function calculateStats(keys) {', statsStart);
const updateDashboardStart = appSource.indexOf('\nfunction updateDashboard(', calcStart);
const personOrgStart = appSource.indexOf('function personOrg(p) {');
const personOrgEnd = appSource.indexOf('\n\n// ==========================================', personOrgStart);

assert.ok(statsStart >= 0, 'stats section header must exist');
assert.ok(calcStart > statsStart, 'calculateStats must exist after stats header');
assert.ok(updateDashboardStart > calcStart, 'updateDashboard must exist after calculateStats');
assert.ok(personOrgStart >= 0 && personOrgEnd > personOrgStart, 'personOrg must exist');

const statsHelpersSource = appSource.slice(statsStart + statsHeader.length, calcStart).trim();
const calculateStatsSource = appSource.slice(calcStart, updateDashboardStart).trim();
const personOrgSource = appSource.slice(personOrgStart, personOrgEnd).trim();

const buildMedianHelper = Function(
    `"use strict";\n${statsHelpersSource}\nreturn { medianFromUnsorted };`
);
const { medianFromUnsorted } = buildMedianHelper();

assert.strictEqual(typeof medianFromUnsorted, 'function', 'medianFromUnsorted should be defined');

const legacyMedian = (values) => {
    if (!values.length) return 0;
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
};

const expectMedian = (input, expected, label) => {
    const actual = medianFromUnsorted(input.slice());
    assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
};

expectMedian([], 0, 'empty');
expectMedian([42], 42, 'single');
expectMedian([9, 1, 5], 5, 'odd count');
expectMedian([10, 2, 8, 4], 6, 'even count');
expectMedian([7, 7, 7, 7], 7, 'duplicates');
expectMedian([1, 2, 3, 4, 5, 6], 3.5, 'sorted input');
expectMedian([6, 5, 4, 3, 2, 1], 3.5, 'reverse-sorted input');

let seed = 0x51f15e;
const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
};

for (let i = 0; i < 1000; i++) {
    const len = Math.floor(rand() * 200);
    const values = [];
    for (let j = 0; j < len; j++) values.push(Math.floor(rand() * 500000));

    const expected = legacyMedian(values.slice());
    const actual = medianFromUnsorted(values.slice());
    assert.strictEqual(actual, expected, `random parity failed at case ${i} (len=${len})`);
}

const legacyMedianBlock = `
    salaries.sort((a, b) => a - b);
    let median = 0;
    if (salaries.length > 0) {
        const mid = Math.floor(salaries.length / 2);
        median = salaries.length % 2 !== 0 ? salaries[mid] : (salaries[mid - 1] + salaries[mid]) / 2;
    }
`;

assert.ok(
    calculateStatsSource.includes('const median = medianFromUnsorted(salaries);'),
    'calculateStats should use medianFromUnsorted'
);

const legacyCalculateStatsSource = calculateStatsSource.replace(
    'const median = medianFromUnsorted(salaries);',
    legacyMedianBlock.trim()
);

const buildCalculateStats = (calcSource) => Function(
    'state',
    'MS_PER_YEAR',
    `"use strict";\n${statsHelpersSource}\n${personOrgSource}\n${calcSource}\nreturn calculateStats;`
);

const fixtureState = {
    masterData: {
        alpha: {
            _hasTimeline: true,
            _totalPay: 100,
            _isUnclass: false,
            _lastJob: { 'Job Title': 'Analyst' },
            _hiredDateTs: Date.now() - (1 * 365.25 * 24 * 60 * 60 * 1000),
            Meta: { 'Home Orgn': 'Org A' }
        },
        beta: {
            _hasTimeline: true,
            _totalPay: 300,
            _isUnclass: true,
            _lastJob: { 'Job Title': 'Engineer' },
            _hiredDateTs: Date.now() - (4 * 365.25 * 24 * 60 * 60 * 1000),
            Meta: { 'Home Orgn': 'Org B' }
        },
        gamma: {
            _hasTimeline: true,
            _totalPay: 200,
            _isUnclass: false,
            _lastJob: { 'Job Title': 'Analyst' },
            _hiredDateTs: Date.now() - (7 * 365.25 * 24 * 60 * 60 * 1000),
            Meta: { 'Home Orgn': 'Org A' }
        },
        hidden: {
            _hasTimeline: false,
            _totalPay: 999,
            _isUnclass: false,
            _lastJob: { 'Job Title': 'Hidden' },
            _hiredDateTs: Date.now(),
            Meta: { 'Home Orgn': 'Org C' }
        }
    }
};

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;
const currentCalculateStats = buildCalculateStats(calculateStatsSource)(fixtureState, MS_PER_YEAR);
const legacyCalculateStats = buildCalculateStats(legacyCalculateStatsSource)(fixtureState, MS_PER_YEAR);

const currentStats = currentCalculateStats(['alpha', 'beta', 'gamma', 'hidden']);
const legacyStats = legacyCalculateStats(['alpha', 'beta', 'gamma', 'hidden']);
assert.deepStrictEqual(currentStats, legacyStats, 'calculateStats output should match legacy median implementation');

console.log('PASS: calculateStats median helper matches legacy sort median and preserves calculateStats parity');
