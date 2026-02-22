#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'app.js'), 'utf8');
const startMarker = '// HISTORICAL_METRICS_START';
const endMarker = '// HISTORICAL_METRICS_END';
const startIdx = appSource.indexOf(startMarker);
const endIdx = appSource.indexOf(endMarker);

assert.ok(startIdx >= 0 && endIdx > startIdx, 'metrics helper markers must exist in app.js');

const metricsSource = appSource.slice(startIdx + startMarker.length, endIdx).trim();
const buildFactory = Function(
    'hasInflationData',
    'adjustForInflation',
    `"use strict";\n${metricsSource}\nreturn buildHistoricalLaborMetrics;`
);

const buildHistoricalLaborMetrics = buildFactory(
    () => true,
    (amount, date) => {
        if (date === '2024-01-01') return amount * 1.10;
        if (date === '2024-06-01') return amount * 1.20;
        return amount;
    }
);

const sampleHistory = [
    {
        date: '2024-01-01',
        classified: 100,
        unclassified: 100,
        payroll: 16000000,
        payrollClassified: 6000000,
        payrollUnclassified: 10000000
    },
    {
        date: '2024-06-01',
        classified: 110,
        unclassified: 90,
        payroll: 16600000,
        payrollClassified: 7150000,
        payrollUnclassified: 9450000
    }
];

const sampleTransitions = [
    { year: '2024', toUnclassified: 20, toClassified: 5 }
];

const metrics = buildHistoricalLaborMetrics(sampleHistory, sampleTransitions);
assert.strictEqual(metrics.points.length, 2, 'should keep both history points');

const latest = metrics.latest;
assert.ok(latest, 'latest point should exist');
assert.strictEqual(Math.round(latest.perCapitaClassified), 65000, 'classified per-capita should be correct');
assert.strictEqual(Math.round(latest.perCapitaUnclassified), 105000, 'unclassified per-capita should be correct');
assert.strictEqual(Math.round(latest.perCapitaAll), 83000, 'overall per-capita should be correct');
assert.ok(Math.abs(latest.headcountShareClassifiedPct - 55) < 0.0001, 'headcount share should be correct');
assert.ok(Math.abs(latest.payrollShareClassifiedPct - 43.0722891566265) < 0.0001, 'payroll share should be correct');
assert.strictEqual(Math.round(latest.payGapDollar), 40000, 'pay-gap dollar should be correct');
assert.ok(Math.abs(latest.payGapRatio - (105000 / 65000)) < 0.0001, 'pay-gap ratio should be correct');

const transition = metrics.transitionPoints[0];
assert.strictEqual(transition.yearEndHeadcount, 200, 'transition denominator should use same-year ending headcount');
assert.ok(Math.abs(transition.transitionRatePer1000 - 125) < 0.0001, 'transition intensity should be per 1,000 workers');

assert.ok(Math.abs(metrics.points[0].classifiedIndexedReal - 100) < 0.0001, 'classified baseline index should start at 100');
assert.ok(Math.abs(metrics.points[0].unclassifiedIndexedReal - 100) < 0.0001, 'unclassified baseline index should start at 100');

const zeroSafeMetrics = buildHistoricalLaborMetrics(
    [{
        date: '2025-01-01',
        classified: 0,
        unclassified: 10,
        payroll: 500000,
        payrollClassified: 0,
        payrollUnclassified: 500000
    }],
    []
);

const zeroSafePoint = zeroSafeMetrics.points[0];
assert.strictEqual(zeroSafePoint.perCapitaClassified, null, 'division-by-zero should return null');
assert.strictEqual(zeroSafePoint.payGapDollar, null, 'pay gap should be null when a side is missing');
assert.strictEqual(zeroSafePoint.payGapRatio, null, 'pay-gap ratio should be null when denominator is zero');

// Quantile helper tests
const quantileStart = appSource.indexOf('// HISTORICAL_QUANTILE_START');
const quantileEnd = appSource.indexOf('// HISTORICAL_QUANTILE_END');
assert.ok(quantileStart >= 0 && quantileEnd > quantileStart, 'quantile helper markers must exist');
const quantileSource = appSource.slice(quantileStart + '// HISTORICAL_QUANTILE_START'.length, quantileEnd).trim();
const quantileValue = Function(`\"use strict\";${quantileSource}; return quantileValue;`)();

const samplePays = [10, 20, 30, 40, 50];
assert.strictEqual(Math.round(quantileValue(samplePays, 0.1)), 14, 'P10 should interpolate correctly');
assert.strictEqual(Math.round(quantileValue(samplePays, 0.5)), 30, 'P50 should equal median');
assert.strictEqual(Math.round(quantileValue(samplePays, 0.9)), 46, 'P90 should interpolate correctly');
assert.strictEqual(quantileValue([42], 0.5), null, 'quantile returns null for single element');
assert.strictEqual(quantileValue([], 0.5), null, 'quantile returns null for empty input');

// Tenure share helper tests
const tenureStart = appSource.indexOf('// HISTORICAL_TENURE_HELPERS_START');
const tenureEnd = appSource.indexOf('// HISTORICAL_TENURE_HELPERS_END');
assert.ok(tenureStart >= 0 && tenureEnd > tenureStart, 'tenure helper markers must exist');
const tenureSource = appSource.slice(tenureStart + '// HISTORICAL_TENURE_HELPERS_START'.length, tenureEnd).trim();
const computeTenureShares = Function(`\"use strict\";${tenureSource}; return computeTenureShares;`)();

const tenureCounts = { lt3: 2, threeTo7: 3, sevenTo15: 1, fifteenPlus: 4 };
const tenureShares = computeTenureShares(tenureCounts, 10);
assert.ok(Math.abs(tenureShares.lt3 - 20) < 0.0001, 'lt3 share should be 20%');
assert.ok(Math.abs(tenureShares.threeTo7 - 30) < 0.0001, '3-7 share should be 30%');
assert.ok(Math.abs(tenureShares.sevenTo15 - 10) < 0.0001, '7-15 share should be 10%');
assert.ok(Math.abs(tenureShares.fifteenPlus - 40) < 0.0001, '15+ share should be 40%');

const tenureSharesZero = computeTenureShares({ lt3: 0 }, 0);
assert.strictEqual(tenureSharesZero.lt3, null, 'shares should be null when total is zero');
assert.strictEqual(tenureSharesZero.fifteenPlus, null, 'shares should be null when total is zero');

console.log('PASS: historical labor metrics calculations are correct and divide-by-zero safe');
