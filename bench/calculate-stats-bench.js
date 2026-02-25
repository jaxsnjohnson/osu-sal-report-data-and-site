#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '..', 'js', 'app.js');
const datasetPath = path.resolve(__dirname, '..', 'data', 'index.json');

const roundsPerSubset = Number(process.env.CALC_STATS_ROUNDS || 4);
const warmupRounds = Number(process.env.CALC_STATS_WARMUP || 2);
const sampleCount = Number(process.env.CALC_STATS_SAMPLES || 7);

const source = fs.readFileSync(targetPath, 'utf8');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const allKeys = Object.keys(dataset || {});

if (!allKeys.length) throw new Error(`No records found in ${datasetPath}`);

const statsHeader = '// ==========================================\n// STATISTICS & DASHBOARD\n// ==========================================\n';
const statsStart = source.indexOf(statsHeader);
const calcStart = source.indexOf('function calculateStats(keys) {', statsStart);
const updateDashboardStart = source.indexOf('\nfunction updateDashboard(', calcStart);
const personOrgStart = source.indexOf('function personOrg(p) {');
const personOrgEnd = source.indexOf('\n\n// ==========================================', personOrgStart);

if (statsStart < 0 || calcStart < 0 || updateDashboardStart < 0) {
    throw new Error(`Could not find stats helpers/calculateStats in ${targetPath}`);
}
if (personOrgStart < 0 || personOrgEnd < 0) {
    throw new Error(`Could not find personOrg in ${targetPath}`);
}

const statsHelpersSource = source.slice(statsStart + statsHeader.length, calcStart).trim();
const calculateStatsSource = source.slice(calcStart, updateDashboardStart).trim();
const personOrgSource = source.slice(personOrgStart, personOrgEnd).trim();

const legacyCalculateStatsSource = calculateStatsSource.replace(
    'const median = medianFromUnsorted(salaries);',
    `
    salaries.sort((a, b) => a - b);
    let median = 0;
    if (salaries.length > 0) {
        const mid = Math.floor(salaries.length / 2);
        median = salaries.length % 2 !== 0 ? salaries[mid] : (salaries[mid - 1] + salaries[mid]) / 2;
    }
`.trim()
);

if (legacyCalculateStatsSource === calculateStatsSource) {
    throw new Error('Expected calculateStats to call medianFromUnsorted(salaries)');
}

const buildCalculateStats = (calcSource) => Function(
    'state',
    'MS_PER_YEAR',
    `"use strict";\n${statsHelpersSource}\n${personOrgSource}\n${calcSource}\nreturn calculateStats;`
);

const state = { masterData: dataset };
const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;

const currentCalculateStats = buildCalculateStats(calculateStatsSource)(state, MS_PER_YEAR);
const legacyCalculateStats = buildCalculateStats(legacyCalculateStatsSource)(state, MS_PER_YEAR);

let seed = 0x5f3759df;
const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
};

const shuffledKeys = allKeys.slice();
for (let i = shuffledKeys.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
}

const subsetSizes = [250, 1000, 5000, allKeys.length]
    .filter(size => size > 0 && size <= allKeys.length)
    .filter((size, idx, arr) => arr.indexOf(size) === idx);
const subsets = subsetSizes.map(size => shuffledKeys.slice(0, size));

const stableJson = (value) => JSON.stringify(value);
for (const keys of subsets) {
    const legacyStats = legacyCalculateStats(keys);
    const currentStats = currentCalculateStats(keys);
    if (stableJson(legacyStats) !== stableJson(currentStats)) {
        throw new Error(`Parity mismatch for subset size ${keys.length}`);
    }
}

const runSample = (fn) => {
    let checksum = 0;
    const started = process.hrtime.bigint();

    for (const keys of subsets) {
        for (let round = 0; round < roundsPerSubset; round++) {
            const stats = fn(keys);
            checksum += (
                stats.count +
                Math.round(stats.medianSalary) +
                stats.classified +
                stats.unclassified +
                stats.topOrgs.length +
                stats.topRoles.length
            );
        }
    }

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return { elapsedMs, checksum };
};

const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

runSample(legacyCalculateStats);
runSample(currentCalculateStats);
for (let i = 0; i < warmupRounds - 1; i++) {
    runSample(legacyCalculateStats);
    runSample(currentCalculateStats);
}

const legacySamples = [];
const currentSamples = [];
for (let i = 0; i < sampleCount; i++) {
    legacySamples.push(runSample(legacyCalculateStats));
    currentSamples.push(runSample(currentCalculateStats));
}

const printSeries = (label, samples) => {
    samples.forEach((sample, idx) => {
        console.log(`${label}_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms checksum=${sample.checksum}`);
    });
    const elapsed = samples.map(sample => sample.elapsedMs);
    const medianMs = median(elapsed);
    const meanMs = elapsed.reduce((sum, ms) => sum + ms, 0) / elapsed.length;
    console.log(`${label}_median: ${medianMs.toFixed(3)}ms`);
    console.log(`${label}_mean: ${meanMs.toFixed(3)}ms`);
    return { medianMs, meanMs };
};

console.log(`Target: ${targetPath}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`records=${allKeys.length} subsets=${subsetSizes.join(',')} roundsPerSubset=${roundsPerSubset} warmup=${warmupRounds} samples=${sampleCount}`);
console.log('parity: PASS');

const legacySummary = printSeries('legacy', legacySamples);
const currentSummary = printSeries('current', currentSamples);

const speedup = legacySummary.medianMs / currentSummary.medianMs;
const reduction = ((legacySummary.medianMs - currentSummary.medianMs) / legacySummary.medianMs) * 100;

console.log(`delta_median_ms: ${(currentSummary.medianMs - legacySummary.medianMs).toFixed(3)}ms`);
console.log(`speedup_vs_legacy: ${speedup.toFixed(3)}x`);
console.log(`median_time_reduction: ${reduction.toFixed(2)}%`);
