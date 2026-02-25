#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const defaultDataset = path.resolve(__dirname, '..', 'data', 'search-index.json');

const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;
const datasetPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultDataset;

const warmupCount = Number(process.env.PREP_WARMUP || 2);
const sampleCount = Number(process.env.PREP_SAMPLES || 7);

const source = fs.readFileSync(targetPath, 'utf8');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const rawRecords = Array.isArray(dataset) ? dataset : (dataset.records || []);

if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    throw new Error(`No records found in ${datasetPath}`);
}

const workerFactory = Function(
    'performance',
    'self',
    'postMessage',
    'fetch',
    `"use strict";\n${source}\nreturn { prepareRecords };`
);

const api = workerFactory(
    { now: () => Number(process.hrtime.bigint()) / 1e6 },
    {},
    () => {},
    async () => {
        throw new Error('fetch is unavailable in benchmark mode');
    }
);

if (typeof api.prepareRecords !== 'function') {
    throw new Error('Failed to load prepareRecords from worker source');
}

const consume = (prepared) => {
    if (!prepared.length) return 0;
    const first = prepared[0];
    const last = prepared[prepared.length - 1];
    return prepared.length
        + (first.orgAliases ? first.orgAliases.length : 0)
        + (first.roleAliases ? first.roleAliases.length : 0)
        + (last.orgAliases ? last.orgAliases.length : 0)
        + (last.roleAliases ? last.roleAliases.length : 0)
        + (first.roleSearch ? first.roleSearch.length : 0)
        + (last.orgSearch ? last.orgSearch.length : 0);
};

const runSample = () => {
    const start = process.hrtime.bigint();
    const prepared = api.prepareRecords(rawRecords);
    const end = process.hrtime.bigint();
    return {
        elapsedMs: Number(end - start) / 1e6,
        checksum: consume(prepared)
    };
};

let guard = 0;
for (let i = 0; i < warmupCount; i++) {
    guard += runSample().checksum;
}

const samples = [];
for (let i = 0; i < sampleCount; i++) {
    const sample = runSample();
    samples.push(sample);
    guard += sample.checksum;
}

const elapsedValues = samples.map(sample => sample.elapsedMs);
const sortedElapsed = [...elapsedValues].sort((a, b) => a - b);
const medianElapsedMs = sortedElapsed[Math.floor(sortedElapsed.length / 2)];
const meanElapsedMs = elapsedValues.reduce((sum, ms) => sum + ms, 0) / elapsedValues.length;

console.log(`Target: ${targetPath}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`records=${rawRecords.length} warmup=${warmupCount} samples=${sampleCount}`);
samples.forEach((sample, idx) => {
    console.log(`sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms checksum=${sample.checksum}`);
});
console.log(`median_ms=${medianElapsedMs.toFixed(3)}`);
console.log(`mean_ms=${meanElapsedMs.toFixed(3)}`);
console.log(`guard=${guard}`);
