#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const defaultDataset = path.resolve(__dirname, '..', 'data', 'search-index.json');

const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;
const datasetPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultDataset;

const roundsPerSample = Number(process.env.SEARCH_REGEX_ROUNDS || 20);
const warmupRounds = Number(process.env.SEARCH_REGEX_WARMUP || 3);
const sampleCount = Number(process.env.SEARCH_REGEX_SAMPLES || 7);
const prefilterEnabled = process.env.SEARCH_REGEX_PREFILTER !== '0';

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
        setRecords: (next) => { records = next; },
        clearCache: () => { resultCache.clear(); },
        setRegexPrefilterEnabled
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

if (typeof api.setRegexPrefilterEnabled === 'function') {
    api.setRegexPrefilterEnabled(prefilterEnabled);
}

const preparedRecords = api.prepareRecords(rawRecords);
api.setRecords(preparedRecords);

const basePayload = {
    roleFilter: '',
    minSalary: null,
    maxSalary: null,
    dataFlagsOnly: false,
    exclusionsMode: 'off',
    sort: 'name-asc',
    transitionNames: null,
    transitionKey: '',
    baseNames: null,
    nowTs: Date.parse('2026-02-20T00:00:00Z')
};

const scenarios = [
    { query: '/john/' },
    { query: '/smith/' },
    { query: '/engineer/' },
    { query: '/(director|manager)/' },
    { query: '/^john/' },
    { query: '/j.*n/' }
];

const runOneQuery = (query, rounds, sampleId) => {
    let checksum = 0;
    const started = process.hrtime.bigint();
    for (let round = 0; round < rounds; round++) {
        const result = api.parseAndSearch({
            ...basePayload,
            query,
            baseKey: `regex-bench-${sampleId}-${query}-${round}`
        });
        checksum += (result.names ? result.names.length : 0);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
        elapsedMs,
        msPerSearch: elapsedMs / rounds,
        checksum
    };
};

const runSample = (rounds, sampleId) => {
    api.clearCache();
    const byQuery = {};
    let totalElapsedMs = 0;
    let totalChecksum = 0;
    for (const scenario of scenarios) {
        const stats = runOneQuery(scenario.query, rounds, sampleId);
        byQuery[scenario.query] = stats;
        totalElapsedMs += stats.elapsedMs;
        totalChecksum += stats.checksum;
    }
    return {
        byQuery,
        totalElapsedMs,
        totalMsPerSearch: totalElapsedMs / (rounds * scenarios.length),
        checksum: totalChecksum
    };
};

for (let i = 0; i < warmupRounds; i++) {
    runSample(1, `warmup-${i}`);
}

const samples = [];
for (let i = 0; i < sampleCount; i++) {
    samples.push(runSample(roundsPerSample, i));
}

const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { median, mean };
};

console.log(`Target: ${targetPath}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`mode=${prefilterEnabled ? 'prefilter-on' : 'prefilter-off'} records=${preparedRecords.length} rounds=${roundsPerSample} warmup=${warmupRounds} samples=${sampleCount}`);
console.log(`queries=${scenarios.map(item => `"${item.query}"`).join(', ')}`);

samples.forEach((sample, idx) => {
    console.log(`sample_${idx + 1}: total=${sample.totalElapsedMs.toFixed(3)}ms (${sample.totalMsPerSearch.toFixed(3)}ms/search) checksum=${sample.checksum}`);
});

for (const scenario of scenarios) {
    const perSearchValues = samples.map(sample => sample.byQuery[scenario.query].msPerSearch);
    const summary = summarize(perSearchValues);
    const checksums = samples.map(sample => sample.byQuery[scenario.query].checksum);
    console.log(
        `${scenario.query}: median=${summary.median.toFixed(3)}ms/search mean=${summary.mean.toFixed(3)}ms/search checksum=${checksums[0]}`
    );
}

const totalPerSearchValues = samples.map(sample => sample.totalMsPerSearch);
const totalSummary = summarize(totalPerSearchValues);
console.log(`overall: median=${totalSummary.median.toFixed(3)}ms/search mean=${totalSummary.mean.toFixed(3)}ms/search`);
