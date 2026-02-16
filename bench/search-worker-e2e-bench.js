#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const defaultDataset = path.resolve(__dirname, '..', 'data', 'search-index.json');

const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;
const datasetPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultDataset;

const roundsPerSample = Number(process.env.SEARCH_E2E_ROUNDS || 4);
const warmupRounds = Number(process.env.SEARCH_E2E_WARMUP || 1);
const sampleCount = Number(process.env.SEARCH_E2E_SAMPLES || 5);

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
    `"use strict";\n${source}\nreturn {
        prepareRecords,
        parseAndSearch,
        parseQuery,
        setRecords: (next) => { records = next; },
        clearCache: () => { resultCache.clear(); }
    };`
);

const benchmarkPerformance = {
    now: () => Number(process.hrtime.bigint()) / 1e6
};

const api = workerFactory(
    benchmarkPerformance,
    {},
    () => {},
    async () => {
        throw new Error('fetch is unavailable in benchmark mode');
    }
);

if (typeof api.prepareRecords !== 'function' || typeof api.parseAndSearch !== 'function') {
    throw new Error('Failed to load benchmark API from worker source');
}

const preparedRecords = api.prepareRecords(rawRecords);
api.setRecords(preparedRecords);

const scenarios = [
    { query: 'john' },
    { query: 'name:smith org:engineering role:director' },
    { query: 'pay:>100k status:active type:classified' },
    { query: 'role:professor org:education' }
];

const runSample = (rounds) => {
    api.clearCache();
    let checksum = 0;
    let cacheKeyCounter = 0;
    const started = process.hrtime.bigint();

    for (let round = 0; round < rounds; round++) {
        for (const basePayload of scenarios) {
            const payload = { ...basePayload, baseKey: `bench-${cacheKeyCounter++}` };
            const result = api.parseAndSearch(payload);
            checksum += (result.names ? result.names.length : 0);
        }
    }

    const ended = process.hrtime.bigint();
    const elapsedMs = Number(ended - started) / 1e6;
    const searches = rounds * scenarios.length;
    const searchesPerSec = Math.round((searches / elapsedMs) * 1000);
    return { elapsedMs, searchesPerSec, checksum, searches };
};

runSample(warmupRounds);

const samples = [];
for (let i = 0; i < sampleCount; i++) {
    samples.push(runSample(roundsPerSample));
}

const elapsedValues = samples.map(sample => sample.elapsedMs);
const sortedElapsed = [...elapsedValues].sort((a, b) => a - b);
const medianElapsedMs = sortedElapsed[Math.floor(sortedElapsed.length / 2)];
const meanElapsedMs = elapsedValues.reduce((sum, ms) => sum + ms, 0) / elapsedValues.length;

const searchesPerSecValues = samples.map(sample => sample.searchesPerSec);
const sortedSearchesPerSec = [...searchesPerSecValues].sort((a, b) => a - b);
const medianSearchesPerSec = sortedSearchesPerSec[Math.floor(sortedSearchesPerSec.length / 2)];
const meanSearchesPerSec = Math.round(searchesPerSecValues.reduce((sum, value) => sum + value, 0) / searchesPerSecValues.length);

console.log(`Target: ${targetPath}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`records=${preparedRecords.length} rounds=${roundsPerSample} warmup=${warmupRounds} samples=${sampleCount}`);
console.log(`queries=${scenarios.map(item => `"${item.query}"`).join(', ')}`);

samples.forEach((sample, idx) => {
    console.log(
        `sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${sample.searchesPerSec.toLocaleString()} searches/s) checksum=${sample.checksum}`
    );
});

console.log(`median: ${medianElapsedMs.toFixed(3)}ms (${medianSearchesPerSec.toLocaleString()} searches/s)`);
console.log(`mean: ${meanElapsedMs.toFixed(3)}ms (${meanSearchesPerSec.toLocaleString()} searches/s)`);
