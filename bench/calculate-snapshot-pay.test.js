#!/usr/bin/env node

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'js', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

const fnStart = appSource.indexOf('const calculateSnapshotPay = (snapshot) => {');
const fnEnd = appSource.indexOf('\n\nconst bucketForName =', fnStart);

assert.ok(fnStart >= 0 && fnEnd > fnStart, 'calculateSnapshotPay source must exist');

const currentSource = appSource.slice(fnStart, fnEnd).trim();
const calculateSnapshotPay = Function(`"use strict";\n${currentSource}\nreturn calculateSnapshotPay;`)();

function legacyCalculateSnapshotPay(snapshot) {
    if (!snapshot || !snapshot.Jobs) return 0;
    let total = 0;
    snapshot.Jobs.forEach(job => {
        const rate = job._rate !== undefined ? job._rate : (parseFloat(job['Annual Salary Rate']) || 0);
        const pct = job._pct !== undefined ? job._pct : (parseFloat(job['Appt Percent']) || 0);
        if (rate > 0) total += rate * (pct / 100);
    });
    return total;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

const parityFixtures = [
    null,
    {},
    { Jobs: [] },
    {
        Jobs: [
            { 'Annual Salary Rate': '100000', 'Appt Percent': '50' },
            { 'Annual Salary Rate': '25000', 'Appt Percent': '100' }
        ]
    },
    {
        Jobs: [
            { 'Annual Salary Rate': '', 'Appt Percent': '100' },
            { 'Annual Salary Rate': 'not-a-number', 'Appt Percent': '80' },
            { 'Annual Salary Rate': '55000', 'Appt Percent': '' }
        ]
    },
    {
        Jobs: [
            { 'Annual Salary Rate': '50000', 'Appt Percent': '0' },
            { 'Annual Salary Rate': '0', 'Appt Percent': '100' }
        ]
    },
    {
        Jobs: [
            { 'Annual Salary Rate': '40000', 'Appt Percent': '25', _rate: 45000 },
            { 'Annual Salary Rate': '70000', 'Appt Percent': '100', _pct: 60 },
            { 'Annual Salary Rate': '60000', 'Appt Percent': '50', _rate: 61000, _pct: 10 }
        ]
    }
];

for (const fixture of parityFixtures) {
    const legacyValue = legacyCalculateSnapshotPay(clone(fixture));
    const currentValue = calculateSnapshotPay(clone(fixture));
    assert.strictEqual(currentValue, legacyValue, 'current helper should match legacy output');
}

const memoFixture = {
    Jobs: [
        { 'Annual Salary Rate': '75000', 'Appt Percent': '80' },
        { 'Annual Salary Rate': '55000', 'Appt Percent': '20' }
    ]
};

const firstValue = calculateSnapshotPay(memoFixture);
assert.strictEqual(typeof memoFixture.Jobs[0]._rate, 'number', 'first job _rate should be memoized');
assert.strictEqual(typeof memoFixture.Jobs[0]._pct, 'number', 'first job _pct should be memoized');
assert.strictEqual(typeof memoFixture.Jobs[1]._rate, 'number', 'second job _rate should be memoized');
assert.strictEqual(typeof memoFixture.Jobs[1]._pct, 'number', 'second job _pct should be memoized');

const secondValue = calculateSnapshotPay(memoFixture);
assert.strictEqual(secondValue, firstValue, 'memoized second call should match first call');

const generatedFixtures = [];
for (let i = 0; i < 200; i++) {
    const jobs = [];
    for (let j = 0; j < 6; j++) {
        jobs.push({
            'Annual Salary Rate': (j % 4 === 0) ? '' : String(30000 + i * 123 + j * 456),
            'Appt Percent': (j % 3 === 0) ? '' : String(50 + ((i + j) % 6) * 10)
        });
    }
    generatedFixtures.push({ Jobs: jobs });
}

let legacyChecksum = 0;
let currentChecksum = 0;
generatedFixtures.forEach((fixture) => {
    legacyChecksum += legacyCalculateSnapshotPay(clone(fixture));
    currentChecksum += calculateSnapshotPay(clone(fixture));
});
assert.strictEqual(Math.round(currentChecksum), Math.round(legacyChecksum), 'generated fixture checksum parity should hold');

console.log('PASS: calculateSnapshotPay preserves output parity and memoizes parsed fallback values');
