#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;

const iterations = Number(process.env.TOK_ITERATIONS || 1000000);
const warmupIterations = Number(process.env.TOK_WARMUP || 200000);
const sampleCount = Number(process.env.TOK_SAMPLES || 7);
const corpusSize = Number(process.env.TOK_CORPUS_SIZE || 25000);
const randomCases = Number(process.env.TOK_RANDOM_CASES || 5000);

const source = fs.readFileSync(targetPath, 'utf8');

const extractConstDeclaration = (text, name, nextName) => {
    const startMarker = `const ${name} =`;
    const endMarker = `\nconst ${nextName} =`;
    const start = text.indexOf(startMarker);
    if (start === -1) throw new Error(`Could not find "${startMarker}" in ${targetPath}`);
    const end = text.indexOf(endMarker, start);
    if (end === -1) throw new Error(`Could not find "${endMarker}" after ${name} in ${targetPath}`);
    return text.slice(start, end).trimEnd();
};

const normalizeDecl = extractConstDeclaration(source, 'normalizeText', 'tokenize');
const tokenizeDecl = extractConstDeclaration(source, 'tokenize', 'escapeRegex');

const workerTokenize = Function(`"use strict";\n${normalizeDecl}\n${tokenizeDecl}\nreturn tokenize;`)();
if (typeof workerTokenize !== 'function') throw new Error('Failed to load tokenize from worker source');

const legacyNormalizeText = (value) => (value || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const legacyTokenize = (value) => legacyNormalizeText(value).split(' ').filter(Boolean);

let rngState = 0x0badf00d;
const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
};

const randomInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

const randomChar = () => {
    const groups = [
        'abcdefghijklmnopqrstuvwxyz',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        '0123456789',
        '-_/.,;:?!@#$%^&*()[]{}+=~ ',
        '\u00e9\u00f1\u00f8\u00df\u6771\u4eac\ud83d\ude42'
    ];
    const group = groups[randomInt(0, groups.length - 1)];
    return group[randomInt(0, group.length - 1)];
};

const randomString = () => {
    const length = randomInt(0, 64);
    let out = '';
    for (let i = 0; i < length; i++) out += randomChar();
    return out;
};

const buildCorpus = () => {
    const staticTexts = [
        'Assistant Principal - Special Education',
        'CITY OF COLUMBUS - Department of Public Safety',
        'Facilities Manager (Interim) / Operations',
        'Director, Human Resources',
        'Sergeant - 2nd Shift',
        'Parks & Recreation Supervisor',
        'Temporary Employee #1234',
        'Multi---dash___token!!!example',
        '',
        '   ',
        'OneWord',
        'ALL CAPS STRING',
        'numbers 1234 and symbols $$$',
        'Unicode caf\u00e9 r\u00e9sum\u00e9 \u6771\u4eac'
    ];

    const corpus = [];
    for (let i = 0; i < corpusSize; i++) {
        const base = staticTexts[i % staticTexts.length];
        corpus.push(`${base} ${i} ${(i % 7 === 0) ? 'ACTIVE' : 'INACTIVE'}`);
    }

    corpus.push(null);
    corpus.push(undefined);
    corpus.push(0);
    corpus.push(12345);
    return corpus;
};

const arraysEqual = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const verifyParity = (corpus) => {
    for (const value of corpus) {
        const legacy = legacyTokenize(value);
        const worker = workerTokenize(value);
        if (!arraysEqual(legacy, worker)) {
            throw new Error(`Tokenizer mismatch for corpus value: ${JSON.stringify(value)}\nlegacy=${JSON.stringify(legacy)}\nworker=${JSON.stringify(worker)}`);
        }
    }

    for (let i = 0; i < randomCases; i++) {
        const value = randomString();
        const legacy = legacyTokenize(value);
        const worker = workerTokenize(value);
        if (!arraysEqual(legacy, worker)) {
            throw new Error(`Tokenizer mismatch for random value: ${JSON.stringify(value)}\nlegacy=${JSON.stringify(legacy)}\nworker=${JSON.stringify(worker)}`);
        }
    }
};

const runSample = (tokenizeFn, corpus, runs) => {
    let checksum = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) {
        checksum += tokenizeFn(corpus[i % corpus.length]).length;
    }
    const end = process.hrtime.bigint();
    return {
        elapsedMs: Number(end - start) / 1e6,
        checksum
    };
};

const summarize = (label, tokenizeFn, corpus) => {
    runSample(tokenizeFn, corpus, warmupIterations);
    const samples = [];
    for (let i = 0; i < sampleCount; i++) samples.push(runSample(tokenizeFn, corpus, iterations));
    const elapsedList = samples.map(s => s.elapsedMs);
    const sortedElapsed = [...elapsedList].sort((a, b) => a - b);
    const medianElapsedMs = sortedElapsed[Math.floor(sortedElapsed.length / 2)];
    const meanElapsedMs = elapsedList.reduce((sum, ms) => sum + ms, 0) / elapsedList.length;
    const medianOpsPerSec = Math.round((iterations / medianElapsedMs) * 1000);
    return { label, samples, medianElapsedMs, meanElapsedMs, medianOpsPerSec };
};

const corpus = buildCorpus();
verifyParity(corpus);

const legacyResults = summarize('legacy', legacyTokenize, corpus);
const workerResults = summarize('worker', workerTokenize, corpus);

const speedup = workerResults.medianOpsPerSec / legacyResults.medianOpsPerSec;
const reduction = ((legacyResults.medianElapsedMs - workerResults.medianElapsedMs) / legacyResults.medianElapsedMs) * 100;

console.log(`Target: ${targetPath}`);
console.log(`corpus=${corpus.length} randomParityCases=${randomCases} iterations=${iterations} warmup=${warmupIterations} samples=${sampleCount}`);

const printResult = (result) => {
    result.samples.forEach((sample, idx) => {
        const opsPerSec = Math.round((iterations / sample.elapsedMs) * 1000);
        console.log(`${result.label}_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${opsPerSec.toLocaleString()} ops/s) checksum=${sample.checksum}`);
    });
    console.log(`${result.label}_median: ${result.medianElapsedMs.toFixed(3)}ms (${result.medianOpsPerSec.toLocaleString()} ops/s)`);
    console.log(`${result.label}_mean: ${result.meanElapsedMs.toFixed(3)}ms`);
};

printResult(legacyResults);
printResult(workerResults);
console.log(`delta_median_ms: ${(workerResults.medianElapsedMs - legacyResults.medianElapsedMs).toFixed(3)}ms`);
console.log(`speedup_vs_legacy: ${speedup.toFixed(3)}x`);
console.log(`median_time_reduction: ${reduction.toFixed(2)}%`);
