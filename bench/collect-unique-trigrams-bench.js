#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const defaultDataset = path.resolve(__dirname, '..', 'data', 'search-index.json');

const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;
const datasetPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultDataset;

const sampleCount = Number(process.env.TRIGRAM_BENCH_SAMPLES || 9);
const warmupRounds = Number(process.env.TRIGRAM_BENCH_WARMUP || 2);
const recordRounds = Number(process.env.TRIGRAM_RECORD_ROUNDS || 8);
const literalRounds = Number(process.env.TRIGRAM_LITERAL_ROUNDS || 120000);
const randomParityCases = Number(process.env.TRIGRAM_PARITY_RANDOM || 6000);
const corpusParityCases = Number(process.env.TRIGRAM_PARITY_CORPUS || 4000);

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
    `"use strict";\n${source}\nreturn { prepareRecords, collectUniqueTrigrams };`
);

const api = workerFactory(
    { now: () => Number(process.hrtime.bigint()) / 1e6 },
    {},
    () => {},
    async () => {
        throw new Error('fetch is unavailable in benchmark mode');
    }
);

if (typeof api.prepareRecords !== 'function' || typeof api.collectUniqueTrigrams !== 'function') {
    throw new Error('Failed to load prepareRecords/collectUniqueTrigrams from worker source');
}

// Snapshot of pre-optimization behavior for parity/perf comparison.
const legacyCollectUniqueTrigrams = (value) => {
    const text = (value || '').toString();
    if (text.length < 3) return [];
    const seen = new Set();
    const out = [];
    for (let i = 0; i <= (text.length - 3); i++) {
        const gram = text.slice(i, i + 3);
        if (seen.has(gram)) continue;
        seen.add(gram);
        out.push(gram);
    }
    return out;
};

const workerCollectUniqueTrigrams = api.collectUniqueTrigrams;
const preparedRecords = api.prepareRecords(rawRecords);
const recordCorpus = preparedRecords
    .map(rec => (rec && rec.searchText ? rec.searchText : ''))
    .filter(text => text.length >= 3);

if (!recordCorpus.length) {
    throw new Error('Prepared record corpus does not include any trigram-capable searchText values');
}

const literalCorpus = [
    'john',
    'smith',
    'engineer',
    'director',
    'manager',
    'science',
    'operations',
    'assistant professor',
    'academic services',
    'j.*n',
    'abc',
    'zzz'
];

let rngState = 0x8f31d2c1;
const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
};

const randomInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

const randomChar = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_/.,';
    return chars[randomInt(0, chars.length - 1)];
};

const randomValue = () => {
    if (rand() < 0.15) {
        const scalars = [null, undefined, true, false, 0, 42, 12345, '', 'a', 'ab'];
        return scalars[randomInt(0, scalars.length - 1)];
    }
    const len = randomInt(0, 60);
    let out = '';
    for (let i = 0; i < len; i++) out += randomChar();
    return out;
};

const arraysEqual = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const verifyParity = () => {
    const edgeCases = [
        null,
        undefined,
        '',
        'a',
        'ab',
        'abc',
        'aaaa',
        'AaAa',
        0,
        12345,
        true,
        false,
        'john john',
        'KED - College of Education',
        '   ',
        '___'
    ];

    for (const value of edgeCases) {
        const legacy = legacyCollectUniqueTrigrams(value);
        const worker = workerCollectUniqueTrigrams(value);
        if (!arraysEqual(legacy, worker)) {
            throw new Error(
                `Parity mismatch (edge case) for ${JSON.stringify(value)}\n` +
                `legacy=${JSON.stringify(legacy)}\nworker=${JSON.stringify(worker)}`
            );
        }
    }

    for (let i = 0; i < randomParityCases; i++) {
        const value = randomValue();
        const legacy = legacyCollectUniqueTrigrams(value);
        const worker = workerCollectUniqueTrigrams(value);
        if (!arraysEqual(legacy, worker)) {
            throw new Error(
                `Parity mismatch (random case ${i}) for ${JSON.stringify(value)}\n` +
                `legacy=${JSON.stringify(legacy)}\nworker=${JSON.stringify(worker)}`
            );
        }
    }

    for (let i = 0; i < corpusParityCases; i++) {
        const value = recordCorpus[(i * 7919) % recordCorpus.length];
        const legacy = legacyCollectUniqueTrigrams(value);
        const worker = workerCollectUniqueTrigrams(value);
        if (!arraysEqual(legacy, worker)) {
            throw new Error(
                `Parity mismatch (corpus case ${i})\n` +
                `legacy=${JSON.stringify(legacy)}\nworker=${JSON.stringify(worker)}`
            );
        }
    }
};

const runSample = (fn, values, rounds) => {
    let checksum = 0;
    const started = process.hrtime.bigint();
    for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < values.length; i++) checksum += fn(values[i]).length;
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
        elapsedMs,
        opsPerSec: Math.round(((rounds * values.length) / elapsedMs) * 1000),
        checksum
    };
};

const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { median, mean };
};

const runWorkload = (label, values, rounds) => {
    for (let i = 0; i < warmupRounds; i++) {
        runSample(legacyCollectUniqueTrigrams, values, 1);
        runSample(workerCollectUniqueTrigrams, values, 1);
    }

    const legacySamples = [];
    const workerSamples = [];
    for (let i = 0; i < sampleCount; i++) {
        const legacy = runSample(legacyCollectUniqueTrigrams, values, rounds);
        const worker = runSample(workerCollectUniqueTrigrams, values, rounds);
        if (legacy.checksum !== worker.checksum) {
            throw new Error(
                `${label}: checksum mismatch for sample ${i + 1}\n` +
                `legacy=${legacy.checksum}\nworker=${worker.checksum}`
            );
        }
        legacySamples.push(legacy);
        workerSamples.push(worker);
    }

    const legacySummary = summarize(legacySamples.map(item => item.elapsedMs));
    const workerSummary = summarize(workerSamples.map(item => item.elapsedMs));
    const medianReductionPct = ((legacySummary.median - workerSummary.median) / legacySummary.median) * 100;
    const meanReductionPct = ((legacySummary.mean - workerSummary.mean) / legacySummary.mean) * 100;
    const speedup = legacySummary.median / workerSummary.median;

    console.log(`\n[${label}]`);
    console.log(`values=${values.length} rounds=${rounds} warmup=${warmupRounds} samples=${sampleCount}`);
    legacySamples.forEach((sample, idx) => {
        console.log(`legacy_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${sample.opsPerSec.toLocaleString()} ops/s) checksum=${sample.checksum}`);
    });
    workerSamples.forEach((sample, idx) => {
        console.log(`worker_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${sample.opsPerSec.toLocaleString()} ops/s) checksum=${sample.checksum}`);
    });
    console.log(`legacy_median: ${legacySummary.median.toFixed(3)}ms`);
    console.log(`worker_median: ${workerSummary.median.toFixed(3)}ms`);
    console.log(`legacy_mean: ${legacySummary.mean.toFixed(3)}ms`);
    console.log(`worker_mean: ${workerSummary.mean.toFixed(3)}ms`);
    console.log(`median_time_reduction: ${medianReductionPct.toFixed(2)}%`);
    console.log(`mean_time_reduction: ${meanReductionPct.toFixed(2)}%`);
    console.log(`speedup_vs_legacy: ${speedup.toFixed(3)}x`);

    return {
        legacySummary,
        workerSummary,
        medianReductionPct
    };
};

verifyParity();

console.log(`Target: ${targetPath}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`prepared_records=${preparedRecords.length} parity_random=${randomParityCases} parity_corpus=${corpusParityCases}`);

const recordResults = runWorkload('record-searchText-corpus', recordCorpus, recordRounds);
const literalResults = runWorkload('short-regex-literals', literalCorpus, literalRounds);

console.log('\n[summary]');
console.log(`record_corpus_median_reduction: ${recordResults.medianReductionPct.toFixed(2)}%`);
console.log(`literal_corpus_median_reduction: ${literalResults.medianReductionPct.toFixed(2)}%`);
