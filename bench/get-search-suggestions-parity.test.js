#!/usr/bin/env node

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'js', 'app.js');
const indexPath = path.resolve(__dirname, '..', 'data', 'index.json');
const aggregatesPath = path.resolve(__dirname, '..', 'data', 'aggregates.json');

const appSource = fs.readFileSync(appPath, 'utf8');

const extractSlice = (text, startMarker, endMarker) => {
    const start = text.indexOf(startMarker);
    if (start === -1) throw new Error(`Could not find start marker: ${startMarker}`);
    const end = text.indexOf(endMarker, start);
    if (end === -1) throw new Error(`Could not find end marker: ${endMarker}`);
    return text.slice(start, end);
};

const helperSlice = extractSlice(appSource, 'const buildSearchIndex =', 'const buildWorkerBaseKey =');

const createOptimizedApi = () => Function(
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
    buildSearchSuggestionAux,
    getSearchSuggestions
};`
)();

const createLegacyApi = () => {
    let editDistancePrev = new Uint32Array(0);
    let editDistanceCur = new Uint32Array(0);
    const state = { searchIndex: [] };

    const buildSearchIndex = (names, roles) => {
        const seen = new Set();
        const index = [];
        const addItem = (value, type) => {
            if (!value) return;
            const key = value.toLowerCase();
            if (seen.has(`${type}:${key}`)) return;
            seen.add(`${type}:${key}`);
            const tokens = key.split(/[^a-z0-9]+/).filter(Boolean);
            index.push({ value, key, type, tokens });
        };
        names.forEach(name => addItem(name, 'name'));
        roles.forEach(role => addItem(role, 'role'));
        index.sort((a, b) => a.key < b.key ? -1 : (a.key > b.key ? 1 : 0));
        return index;
    };

    const boundedEditDistance = (a, b, maxDist) => {
        const alen = a.length;
        const blen = b.length;
        if (Math.abs(alen - blen) > maxDist) return maxDist + 1;

        const rowSize = blen + 1;
        if (editDistancePrev.length < rowSize) {
            editDistancePrev = new Uint32Array(rowSize);
            editDistanceCur = new Uint32Array(rowSize);
        }

        let prev = editDistancePrev;
        let cur = editDistanceCur;
        for (let j = 0; j <= blen; j++) prev[j] = j;

        for (let i = 1; i <= alen; i++) {
            cur[0] = i;
            let rowMin = i;
            for (let j = 1; j <= blen; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                const next = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
                cur[j] = next;
                if (next < rowMin) rowMin = next;
            }
            if (rowMin > maxDist) return maxDist + 1;
            const swap = prev;
            prev = cur;
            cur = swap;
        }
        return prev[blen];
    };

    const findPrefixRange = (index, prefix) => {
        let low = 0;
        let high = index.length - 1;
        let start = -1;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (index[mid].key >= prefix) {
                start = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        if (start === -1 || !index[start].key.startsWith(prefix)) {
            return { start: -1 };
        }
        return { start };
    };

    const getSearchSuggestions = (term, limit = 6) => {
        const query = term.trim().toLowerCase();
        if (!query || query.length < 3) return [];
        const maxDist = query.length <= 4 ? 1 : (query.length <= 6 ? 2 : 3);
        const scored = [];

        const { start } = findPrefixRange(state.searchIndex, query);
        let prefixEnd = -1;

        if (start !== -1) {
            for (let i = start; i < state.searchIndex.length; i++) {
                const item = state.searchIndex[i];
                if (!item.key.startsWith(query)) {
                    prefixEnd = i;
                    break;
                }
                scored.push({ score: 0, value: item.value, type: item.type });
            }
            if (prefixEnd === -1) prefixEnd = state.searchIndex.length;
        }

        if (scored.length >= limit) {
            scored.sort((a, b) => a.value.length - b.value.length);
            const results = [];
            const seen = new Set();
            for (const item of scored) {
                const key = item.value.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                results.push(item);
                if (results.length >= limit) break;
            }
            return results;
        }

        const searchRest = (startIndex, endIndex) => {
            for (let i = startIndex; i < endIndex; i++) {
                const item = state.searchIndex[i];
                const key = item.key;
                let score = null;

                if (key.includes(query)) {
                    score = 1;
                } else {
                    let bestDist = maxDist + 1;
                    for (const token of item.tokens) {
                        if (token.length < 3) continue;
                        const dist = boundedEditDistance(query, token, maxDist);
                        if (dist < bestDist) bestDist = dist;
                        if (bestDist === 0) break;
                    }
                    if (bestDist <= maxDist) score = 2 + bestDist;
                }
                if (score !== null) scored.push({ score, value: item.value, type: item.type });
            }
        };

        if (start === -1) {
            searchRest(0, state.searchIndex.length);
        } else {
            searchRest(0, start);
            searchRest(prefixEnd, state.searchIndex.length);
        }

        scored.sort((a, b) => (a.score - b.score) || (a.value.length - b.value.length));
        const results = [];
        const seen = new Set();
        for (const item of scored) {
            const key = item.value.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(item);
            if (results.length >= limit) break;
        }
        return results;
    };

    return { state, buildSearchIndex, getSearchSuggestions };
};

const prepareOptimizedState = (api, searchIndex) => {
    api.state.searchIndex = searchIndex;
    api.state.searchSuggestionAux = api.buildSearchSuggestionAux(searchIndex);
    api.state.searchSuggestionCandidateMarks = new Uint8Array(api.state.searchSuggestionAux.itemCount || 0);
    api.state.searchSuggestionCandidateList = [];
};

const assertParity = (label, legacyApi, optimizedApi, queries) => {
    for (const item of queries) {
        const term = typeof item === 'string' ? item : item.term;
        const limit = typeof item === 'string' ? 6 : item.limit;
        const expected = legacyApi.getSearchSuggestions(term, limit);
        const actual = optimizedApi.getSearchSuggestions(term, limit);
        assert.deepStrictEqual(actual, expected, `${label} parity mismatch for term=${JSON.stringify(term)} limit=${limit}`);
    }
};

const legacySmall = createLegacyApi();
const optimizedSmall = createOptimizedApi();
const smallNames = [
    'Coordinator',
    'Coordination Lead',
    'Administrative Assistant',
    'Ann Able',
    'Annie Baker',
    'Anne Bell'
];
const smallRoles = [
    'Coordinator',
    'Assistant Professor',
    'Professor Assistant',
    'Administration Manager'
];
const smallLegacyIndex = legacySmall.buildSearchIndex(smallNames, smallRoles);
const smallOptimizedIndex = optimizedSmall.buildSearchIndex(smallNames, smallRoles);
assert.deepStrictEqual(smallOptimizedIndex, smallLegacyIndex, 'buildSearchIndex output mismatch on small fixture');
legacySmall.state.searchIndex = smallLegacyIndex;
prepareOptimizedState(optimizedSmall, smallOptimizedIndex);

assertParity('small-fixture', legacySmall, optimizedSmall, [
    { term: '', limit: 6 },
    { term: 'ab', limit: 6 },
    { term: 'coo', limit: 6 },
    { term: 'coordinatr', limit: 6 },
    { term: 'adminstration', limit: 6 },
    { term: 'assistant professr', limit: 6 },
    { term: 'ann', limit: 1 },
    { term: 'ann', limit: 20 },
    { term: 'professor', limit: 6 }
]);

// Also exercise the fallback branch by disabling aux structures.
optimizedSmall.state.searchSuggestionAux = null;
optimizedSmall.state.searchSuggestionCandidateMarks = null;
optimizedSmall.state.searchSuggestionCandidateList = [];
assertParity('small-fixture-fallback', legacySmall, optimizedSmall, [
    { term: 'coordinatr', limit: 6 },
    { term: 'ann', limit: 20 }
]);

const realIndexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const realAggregates = JSON.parse(fs.readFileSync(aggregatesPath, 'utf8'));
const realNames = Object.keys(realIndexData).sort();
const realRoles = realAggregates.allRoles || [];

const legacyReal = createLegacyApi();
const optimizedReal = createOptimizedApi();
const legacyRealIndex = legacyReal.buildSearchIndex(realNames, realRoles);
const optimizedRealIndex = optimizedReal.buildSearchIndex(realNames, realRoles);
assert.deepStrictEqual(optimizedRealIndex, legacyRealIndex, 'buildSearchIndex output mismatch on real dataset');
legacyReal.state.searchIndex = legacyRealIndex;
prepareOptimizedState(optimizedReal, optimizedRealIndex);

assertParity('real-dataset', legacyReal, optimizedReal, [
    { term: 'john', limit: 6 },
    { term: 'math', limit: 6 },
    { term: 'enginering', limit: 6 },
    { term: 'coordinatr', limit: 6 },
    { term: 'admnistration', limit: 6 },
    { term: 'assistant professr', limit: 6 },
    { term: 'zzzzzzzz', limit: 6 },
    { term: 'professor', limit: 1 },
    { term: 'professor', limit: 20 },
    { term: 'director', limit: 6 }
]);

console.log('PASS: getSearchSuggestions parity matches legacy implementation (small fixture + real dataset)');
