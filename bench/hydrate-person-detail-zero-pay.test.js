#!/usr/bin/env node

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'js', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

const fnStart = appSource.indexOf('const hydratePersonDetail = (person) => {');
const fnEnd = appSource.indexOf('\n\n// Compute the first classified -> unclassified transition timestamp for a person, if any.', fnStart);

assert.ok(fnStart >= 0 && fnEnd > fnStart, 'hydratePersonDetail source must exist');

const hydrateSource = appSource.slice(fnStart, fnEnd).trim();

let calculateSnapshotPayCalls = 0;
const calculateSnapshotPayStub = (snapshot) => {
    calculateSnapshotPayCalls += 1;
    return snapshot && snapshot._forcePay !== undefined ? snapshot._forcePay : 0;
};

const hydratePersonDetail = Function(
    'calculateSnapshotPay',
    `"use strict";\n${hydrateSource}\nreturn hydratePersonDetail;`
)(calculateSnapshotPayStub);

const person = {
    Timeline: [
        {
            Date: '2025-01-01',
            Source: 'Classified',
            _forcePay: 0,
            Jobs: [
                {
                    'Annual Salary Rate': '0',
                    'Appt Percent': '100',
                    'Salary Term': 'yr',
                    'Job Title': 'Test Role'
                }
            ]
        }
    ]
};

hydratePersonDetail(person);

assert.strictEqual(calculateSnapshotPayCalls, 1, 'zero-pay last snapshot should not trigger a second pay recalculation');
assert.strictEqual(person._totalPay, 0, 'total pay should preserve cached zero');
assert.strictEqual(person._lastSnapshot._pay, 0, 'snapshot pay should remain zero');
assert.strictEqual(person._hydrated, true, 'person should be marked hydrated');

hydratePersonDetail(person);
assert.strictEqual(calculateSnapshotPayCalls, 1, 'hydrating an already hydrated person should be a no-op');

console.log('PASS: hydratePersonDetail preserves zero snapshot pay without redundant recalculation');
