#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const defaultDataset = path.resolve(__dirname, '..', 'data', 'search-index.json');

const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;
const datasetPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultDataset;

const roundsPerSample = Number(process.env.SCORE_ROUNDS || 6);
const warmupRounds = Number(process.env.SCORE_WARMUP || 1);
const sampleCount = Number(process.env.SCORE_SAMPLES || 7);

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
        parseQuery,
        scoreRecord,
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

if (
    typeof api.prepareRecords !== 'function' ||
    typeof api.parseQuery !== 'function' ||
    typeof api.scoreRecord !== 'function'
) {
    throw new Error('Failed to load benchmark API from worker source');
}

const preparedRecords = api.prepareRecords(rawRecords);
api.setRecords(preparedRecords);

const scenarios = [
    'andersn professer enginering',
    'name:anderson org:enginering role:managr',
    'saftey officr patrol',
    'org:admnistration role:coordinator'
].map((query) => ({ query, parsed: api.parseQuery(query) }));

const runSample = (rounds) => {
    let checksum = 0;
    const started = process.hrtime.bigint();

    for (let round = 0; round < rounds; round++) {
        const scenario = scenarios[round % scenarios.length];
        for (const rec of preparedRecords) {
            const score = api.scoreRecord(rec, scenario.parsed);
            if (score !== null) checksum += Math.round(score * 10);
        }
    }

    const ended = process.hrtime.bigint();
    const elapsedMs = Number(ended - started) / 1e6;
    const evaluations = rounds * preparedRecords.length;
    const evalsPerSec = Math.round((evaluations / elapsedMs) * 1000);
    return { elapsedMs, evalsPerSec, checksum, evaluations };
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

const evalsPerSecValues = samples.map(sample => sample.evalsPerSec);
const sortedEvalsPerSec = [...evalsPerSecValues].sort((a, b) => a - b);
const medianEvalsPerSec = sortedEvalsPerSec[Math.floor(sortedEvalsPerSec.length / 2)];
const meanEvalsPerSec = Math.round(evalsPerSecValues.reduce((sum, value) => sum + value, 0) / evalsPerSecValues.length);

console.log(`Target: ${targetPath}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`records=${preparedRecords.length} rounds=${roundsPerSample} warmup=${warmupRounds} samples=${sampleCount}`);
console.log(`queries=${scenarios.map(item => `"${item.query}"`).join(', ')}`);

samples.forEach((sample, idx) => {
    console.log(
        `sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${sample.evalsPerSec.toLocaleString()} evals/s) checksum=${sample.checksum}`
    );
});

console.log(`median: ${medianElapsedMs.toFixed(3)}ms (${medianEvalsPerSec.toLocaleString()} evals/s)`);
console.log(`mean: ${meanElapsedMs.toFixed(3)}ms (${meanEvalsPerSec.toLocaleString()} evals/s)`);
