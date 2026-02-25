#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'js', 'app.js');
const indexPath = path.resolve(__dirname, '..', 'data', 'index.json');
const aggregatesPath = path.resolve(__dirname, '..', 'data', 'aggregates.json');

const roundsPerSample = Number(process.env.SUGGEST_ROUNDS || 8);
const warmupRounds = Number(process.env.SUGGEST_WARMUP || 2);
const sampleCount = Number(process.env.SUGGEST_SAMPLES || 5);
const perQueryRounds = Number(process.env.SUGGEST_PER_QUERY_ROUNDS || 40);

const source = fs.readFileSync(appPath, 'utf8');
const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const aggregates = JSON.parse(fs.readFileSync(aggregatesPath, 'utf8'));

const extractSlice = (text, startMarker, endMarker) => {
    const start = text.indexOf(startMarker);
    if (start === -1) throw new Error(`Could not find start marker: ${startMarker}`);
    const end = text.indexOf(endMarker, start);
    if (end === -1) throw new Error(`Could not find end marker: ${endMarker}`);
    return text.slice(start, end);
};

const helperSlice = extractSlice(source, 'const buildSearchIndex =', 'const buildWorkerBaseKey =');

const factory = Function(
    `"use strict";
let editDistancePrev = new Uint32Array(0);
let editDistanceCur = new Uint32Array(0);
let editDistanceExactPrev = new Uint32Array(0);
let editDistanceExactCur = new Uint32Array(0);
const state = {
    searchIndex: [],
    searchSuggestionAux: null,
    searchSuggestionCandidateMarks: null,
    searchSuggestionCandidateList: []
};
${helperSlice}
return {
    state,
    buildSearchIndex,
    getSearchSuggestions,
    buildSearchSuggestionAux: (typeof buildSearchSuggestionAux === 'function') ? buildSearchSuggestionAux : null
};`
);

const api = factory();

const names = Object.keys(indexData).sort();
const roles = aggregates.allRoles || [];
api.state.searchIndex = api.buildSearchIndex(names, roles);

let auxBuildMs = null;
if (typeof api.buildSearchSuggestionAux === 'function') {
    const auxStart = process.hrtime.bigint();
    const aux = api.buildSearchSuggestionAux(api.state.searchIndex);
    auxBuildMs = Number(process.hrtime.bigint() - auxStart) / 1e6;
    api.state.searchSuggestionAux = aux;
    api.state.searchSuggestionCandidateMarks = new Uint8Array(aux.itemCount || 0);
    api.state.searchSuggestionCandidateList = [];
}

const queries = [
    'john',
    'math',
    'enginering',
    'coordinatr',
    'admnistration',
    'assistant professr',
    'zzzzzzzz'
];

const runSample = (rounds) => {
    let checksum = 0;
    const started = process.hrtime.bigint();
    for (let round = 0; round < rounds; round++) {
        for (const q of queries) {
            const results = api.getSearchSuggestions(q, 6);
            checksum += results.length;
            if (results[0]) checksum += results[0].value.length;
        }
    }
    const ended = process.hrtime.bigint();
    return {
        elapsedMs: Number(ended - started) / 1e6,
        checksum
    };
};

const measureQuery = (query, rounds) => {
    for (let i = 0; i < 3; i++) api.getSearchSuggestions(query, 6);
    let checksum = 0;
    const started = process.hrtime.bigint();
    for (let i = 0; i < rounds; i++) {
        const results = api.getSearchSuggestions(query, 6);
        checksum += results.length;
        if (results[0]) checksum += results[0].value.length;
    }
    const ended = process.hrtime.bigint();
    const totalMs = Number(ended - started) / 1e6;
    return {
        query,
        rounds,
        totalMs,
        avgMs: totalMs / rounds,
        checksum
    };
};

runSample(warmupRounds);

const samples = [];
for (let i = 0; i < sampleCount; i++) {
    samples.push(runSample(roundsPerSample));
}

const elapsed = samples.map(s => s.elapsedMs);
const sorted = [...elapsed].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const mean = elapsed.reduce((sum, ms) => sum + ms, 0) / elapsed.length;

const perQuery = queries.map((query) => measureQuery(query, perQueryRounds));

console.log(`Target: ${appPath}`);
console.log(`Dataset: ${indexPath} + ${aggregatesPath}`);
console.log(`searchIndex=${api.state.searchIndex.length} rounds=${roundsPerSample} warmup=${warmupRounds} samples=${sampleCount}`);
if (auxBuildMs !== null) {
    console.log(`aux_build: ${auxBuildMs.toFixed(3)}ms`);
} else {
    console.log('aux_build: n/a (legacy implementation)');
}

samples.forEach((sample, idx) => {
    console.log(`sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms checksum=${sample.checksum}`);
});

console.log(`median: ${median.toFixed(3)}ms`);
console.log(`mean: ${mean.toFixed(3)}ms`);

perQuery.forEach((entry) => {
    console.log(
        `query:${JSON.stringify(entry.query)} avg=${entry.avgMs.toFixed(3)}ms total=${entry.totalMs.toFixed(3)}ms checksum=${entry.checksum}`
    );
});
