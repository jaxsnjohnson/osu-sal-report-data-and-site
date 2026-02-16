#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultTarget = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;

const pairCount = Number(process.env.BED_PAIR_COUNT || 4000);
const iterations = Number(process.env.BED_ITERATIONS || 800000);
const warmupIterations = Number(process.env.BED_WARMUP || 80000);
const sampleCount = Number(process.env.BED_SAMPLES || 7);

const source = fs.readFileSync(targetPath, 'utf8');

const extractConstArrowFunction = (text, name) => {
    const marker = `const ${name} =`;
    const start = text.indexOf(marker);
    if (start === -1) throw new Error(`Could not find "${marker}" in ${targetPath}`);

    const arrow = text.indexOf('=>', start);
    if (arrow === -1) throw new Error(`Could not find arrow token for ${name}`);

    const bodyStart = text.indexOf('{', arrow);
    if (bodyStart === -1) throw new Error(`Could not find function body start for ${name}`);

    let depth = 0;
    let bodyEnd = -1;
    for (let i = bodyStart; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                bodyEnd = i;
                break;
            }
        }
    }

    if (bodyEnd === -1) throw new Error(`Could not find function body end for ${name}`);

    const semicolon = text.indexOf(';', bodyEnd);
    if (semicolon === -1) throw new Error(`Could not find trailing semicolon for ${name}`);
    return text.slice(start, semicolon + 1);
};

const fnSource = extractConstArrowFunction(source, 'boundedEditDistance');
const dependencyDecls = [];
const dependencyNames = ['editDistancePrev', 'editDistanceCur'];
for (const dep of dependencyNames) {
    const match = source.match(new RegExp(`(?:let|const|var)\\s+${dep}\\s*=\\s*[^;]+;`));
    if (match) dependencyDecls.push(match[0]);
}

const boundedEditDistance = Function(`"use strict";\n${dependencyDecls.join('\n')}\n${fnSource}\nreturn boundedEditDistance;`)();
if (typeof boundedEditDistance !== 'function') {
    throw new Error('Failed to load boundedEditDistance');
}

let rngState = 0x12345678;
const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
};

const letters = 'abcdefghijklmnopqrstuvwxyz';
const randomInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const randomLetter = () => letters[randomInt(0, letters.length - 1)];

const randomWord = (minLen, maxLen) => {
    const len = randomInt(minLen, maxLen);
    let out = '';
    for (let i = 0; i < len; i++) out += randomLetter();
    return out;
};

const mutateWord = (word) => {
    if (!word) return randomWord(3, 6);
    const op = randomInt(0, 3);

    if (op === 0 && word.length >= 2) {
        const idx = randomInt(0, word.length - 2);
        const arr = word.split('');
        const tmp = arr[idx];
        arr[idx] = arr[idx + 1];
        arr[idx + 1] = tmp;
        return arr.join('');
    }

    if (op === 1) {
        const idx = randomInt(0, word.length - 1);
        return word.slice(0, idx) + randomLetter() + word.slice(idx + 1);
    }

    if (op === 2) {
        const idx = randomInt(0, word.length);
        return word.slice(0, idx) + randomLetter() + word.slice(idx);
    }

    if (word.length > 1) {
        const idx = randomInt(0, word.length - 1);
        return word.slice(0, idx) + word.slice(idx + 1);
    }
    return word;
};

const maxDistanceFor = (term) => (term.length <= 4 ? 1 : (term.length <= 6 ? 2 : 3));

const buildPairs = (count) => {
    const pairs = new Array(count);
    for (let i = 0; i < count; i++) {
        const base = randomWord(3, 14);
        const mode = randomInt(0, 9);

        let target;
        if (mode <= 4) target = mutateWord(base);
        else if (mode <= 6) target = base;
        else target = randomWord(3, 14);

        pairs[i] = [base, target, maxDistanceFor(base)];
    }
    return pairs;
};

const pairs = buildPairs(pairCount);

const runSample = (runs) => {
    let checksum = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) {
        const pair = pairs[i % pairs.length];
        checksum += boundedEditDistance(pair[0], pair[1], pair[2]);
    }
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1e6;
    return { elapsedMs, checksum };
};

runSample(warmupIterations);

const samples = [];
for (let i = 0; i < sampleCount; i++) {
    samples.push(runSample(iterations));
}

const elapsedList = samples.map(s => s.elapsedMs);
const sortedElapsed = [...elapsedList].sort((a, b) => a - b);
const mid = Math.floor(sortedElapsed.length / 2);
const medianElapsedMs = sortedElapsed.length % 2 === 0
    ? (sortedElapsed[mid - 1] + sortedElapsed[mid]) / 2
    : sortedElapsed[mid];

const meanElapsedMs = elapsedList.reduce((sum, ms) => sum + ms, 0) / elapsedList.length;
const medianOpsPerSec = Math.round((iterations / medianElapsedMs) * 1000);

console.log(`Target: ${targetPath}`);
console.log(`pairs=${pairCount} iterations=${iterations} warmup=${warmupIterations} samples=${sampleCount}`);
samples.forEach((sample, idx) => {
    const opsPerSec = Math.round((iterations / sample.elapsedMs) * 1000);
    console.log(`sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms (${opsPerSec.toLocaleString()} ops/s) checksum=${sample.checksum}`);
});
console.log(`median: ${medianElapsedMs.toFixed(3)}ms (${medianOpsPerSec.toLocaleString()} ops/s)`);
console.log(`mean: ${meanElapsedMs.toFixed(3)}ms`);
