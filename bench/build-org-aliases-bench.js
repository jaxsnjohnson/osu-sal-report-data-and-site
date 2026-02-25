#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;

const iterations = Number(process.env.ORG_ALIAS_ITERATIONS || 1000000);
const warmupIterations = Number(process.env.ORG_ALIAS_WARMUP || 200000);
const sampleCount = Number(process.env.ORG_ALIAS_SAMPLES || 7);
const randomCases = Number(process.env.ORG_ALIAS_RANDOM_CASES || 10000);

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
const buildOrgAliasesDecl = extractConstDeclaration(source, 'buildOrgAliases', 'tokenizeQuery');

const workerBuildOrgAliases = Function(
    `"use strict";\n${normalizeDecl}\n${buildOrgAliasesDecl}\nreturn buildOrgAliases;`
)();

const legacyBuildOrgAliases = Function(
    `"use strict";\n${normalizeDecl}\nreturn (orgValue) => {
        const text = (orgValue || '').toString();
        const aliases = [];
        const base = normalizeText(text);
        if (base) aliases.push(base);
        const parts = text.split('-').map(p => p.trim()).filter(Boolean);
        if (parts.length) {
            const code = normalizeText(parts[0]);
            const tail = normalizeText(parts.slice(1).join(' '));
            if (code) aliases.push(code);
            if (tail) {
                aliases.push(tail);
                tail.split(' ').forEach(tok => aliases.push(tok));
            }
        }
        return Array.from(new Set(aliases.filter(Boolean)));
    };`
)();

if (typeof workerBuildOrgAliases !== 'function') throw new Error('Failed to load buildOrgAliases from worker source');

let rngState = 0x51f15e;
const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
};

const randomInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

const randomChunk = () => {
    const chunks = [
        'OSU',
        'Medical Center',
        'Department of Public Safety',
        'HR',
        'Finance',
        'Student Life',
        'IT',
        'Office',
        'Research',
        'Admin',
        '---',
        '-',
        '   ',
        'A',
        'B'
    ];
    return chunks[randomInt(0, chunks.length - 1)];
};

const randomValue = () => {
    if (rand() < 0.08) {
        const scalarPool = [null, undefined, '', '   ', 0, 42, 12345];
        return scalarPool[randomInt(0, scalarPool.length - 1)];
    }

    const partCount = randomInt(0, 7);
    let out = '';
    for (let i = 0; i < partCount; i++) {
        if (i > 0 || rand() < 0.6) out += rand() < 0.7 ? '-' : ' ';
        if (rand() < 0.3) out += ' '.repeat(randomInt(0, 2));
        out += randomChunk();
        if (rand() < 0.3) out += ' '.repeat(randomInt(0, 2));
        if (rand() < 0.2) out += rand() < 0.5 ? '-' : '--';
    }
    return out;
};

const buildCorpus = () => {
    const corpus = [
        null,
        undefined,
        0,
        42,
        '',
        '   ',
        'NoHyphenOrg',
        'OSU - Medical Center',
        'ABC - Dept - Subdivision',
        'A--B',
        'A -  - C',
        '---',
        ' -Leading',
        'Trailing- ',
        ' - Both - ',
        'OSU--Medical Center - HR',
        ' College of Arts -  Fiscal Operations  - Payroll ',
        '   -Med Center  OSUITOffice '
    ];

    for (let i = 0; i < randomCases; i++) corpus.push(randomValue());
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
        const legacy = legacyBuildOrgAliases(value);
        const worker = workerBuildOrgAliases(value);
        if (!arraysEqual(legacy, worker)) {
            throw new Error(
                `buildOrgAliases mismatch for ${JSON.stringify(value)}\n` +
                `legacy=${JSON.stringify(legacy)}\nworker=${JSON.stringify(worker)}`
            );
        }
    }
};

const runSample = (fn, corpus, runs) => {
    let checksum = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) checksum += fn(corpus[i % corpus.length]).length;
    const end = process.hrtime.bigint();
    return {
        elapsedMs: Number(end - start) / 1e6,
        checksum
    };
};

const summarize = (label, fn, corpus) => {
    runSample(fn, corpus, warmupIterations);
    const samples = [];
    for (let i = 0; i < sampleCount; i++) samples.push(runSample(fn, corpus, iterations));

    const elapsedList = samples.map(s => s.elapsedMs);
    const sortedElapsed = [...elapsedList].sort((a, b) => a - b);
    const medianElapsedMs = sortedElapsed[Math.floor(sortedElapsed.length / 2)];
    const meanElapsedMs = elapsedList.reduce((sum, ms) => sum + ms, 0) / elapsedList.length;
    const medianOpsPerSec = Math.round((iterations / medianElapsedMs) * 1000);

    return { label, samples, medianElapsedMs, meanElapsedMs, medianOpsPerSec };
};

const printResult = (result) => {
    result.samples.forEach((sample, idx) => {
        const opsPerSec = Math.round((iterations / sample.elapsedMs) * 1000);
        console.log(`${result.label}_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${opsPerSec.toLocaleString()} ops/s) checksum=${sample.checksum}`);
    });
    console.log(`${result.label}_median: ${result.medianElapsedMs.toFixed(3)}ms (${result.medianOpsPerSec.toLocaleString()} ops/s)`);
    console.log(`${result.label}_mean: ${result.meanElapsedMs.toFixed(3)}ms`);
};

const corpus = buildCorpus();
verifyParity(corpus);

const legacyResults = summarize('legacy', legacyBuildOrgAliases, corpus);
const workerResults = summarize('worker', workerBuildOrgAliases, corpus);

const speedup = workerResults.medianOpsPerSec / legacyResults.medianOpsPerSec;
const reduction = ((legacyResults.medianElapsedMs - workerResults.medianElapsedMs) / legacyResults.medianElapsedMs) * 100;

console.log(`Target: ${targetPath}`);
console.log(`corpus=${corpus.length} randomParityCases=${randomCases} iterations=${iterations} warmup=${warmupIterations} samples=${sampleCount}`);
printResult(legacyResults);
printResult(workerResults);
console.log(`delta_median_ms: ${(workerResults.medianElapsedMs - legacyResults.medianElapsedMs).toFixed(3)}ms`);
console.log(`speedup_vs_legacy: ${speedup.toFixed(3)}x`);
console.log(`median_time_reduction: ${reduction.toFixed(2)}%`);
