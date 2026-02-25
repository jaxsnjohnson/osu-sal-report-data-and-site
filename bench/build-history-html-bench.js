#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '..', 'js', 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');

const buildStart = appSource.indexOf('function buildHistoryHTML(person, chartId, name) {');
const buildEnd = appSource.indexOf('\n\nfunction generateCardHTML(name, idx) {', buildStart);
if (buildStart < 0 || buildEnd <= buildStart) {
    throw new Error('Failed to locate buildHistoryHTML in js/app.js');
}
const buildHistoryHTMLSource = appSource.slice(buildStart, buildEnd).trim();

const trendStart = appSource.indexOf('const getPersonTrendHTML = (timeline, chartId) => {');
const trendEnd = trendStart >= 0
    ? appSource.indexOf('\n\n// ==========================================\n// GLOBAL STATE', trendStart)
    : -1;
const trendSource = trendStart >= 0 && trendEnd > trendStart
    ? appSource.slice(trendStart, trendEnd).trim()
    : '';

const timelineYearsStart = appSource.indexOf('function getTimelineYears(timeline) {');
const timelineYearsEnd = timelineYearsStart >= 0
    ? appSource.indexOf('\n\nfunction getMovingAverage(values, windowSize = 3) {', timelineYearsStart)
    : -1;
const timelineYearsSource = timelineYearsStart >= 0 && timelineYearsEnd > timelineYearsStart
    ? appSource.slice(timelineYearsStart, timelineYearsEnd).trim()
    : '';

const minTrendYearsMatch = appSource.match(/\bconst MIN_TREND_YEARS = (\d+);/);
const minTrendYears = minTrendYearsMatch ? Number(minTrendYearsMatch[1]) : 3;

const buildHistoryFactory = Function(
    'state',
    'formatDate',
    'getRecordGaps',
    'MIN_TREND_YEARS',
    'hasInflationData',
    `"use strict";
${timelineYearsSource || 'function getTimelineYears() { return 10; }'}
${trendSource || 'const getPersonTrendHTML = () => "";'}
${buildHistoryHTMLSource}
return buildHistoryHTML;`
);

const state = { masterData: {} };
const formatDate = (value) => String(value || '');
const getRecordGaps = () => [];
const hasInflationData = () => true;
const buildHistoryHTML = buildHistoryFactory(
    state,
    formatDate,
    getRecordGaps,
    minTrendYears,
    hasInflationData
);

const makePerson = (snapshots = 12) => {
    const timeline = [];
    for (let i = 0; i < snapshots; i += 1) {
        const year = 2014 + i;
        timeline.push({
            Date: `${year}-01-01`,
            Source: 'Report',
            Jobs: []
        });
    }
    return {
        Meta: {
            'First Hired': '2010-09-01',
            'Adj Service Date': '2010-09-01'
        },
        Timeline: timeline
    };
};

const person = makePerson();
const chartId = 'person-trend-bench';
const name = 'Benchmark User';

// Warm up JIT and caches.
for (let i = 0; i < 200; i += 1) {
    buildHistoryHTML(person, chartId, name);
}

const samples = Number(process.env.BENCH_SAMPLES || 9);
const iterations = Number(process.env.BENCH_ITERS || 1000);
const lengths = [];
const elapsedMs = [];

let guard = 0;
for (let s = 0; s < samples; s += 1) {
    const start = process.hrtime.bigint();
    let lengthSum = 0;
    for (let i = 0; i < iterations; i += 1) {
        const html = buildHistoryHTML(person, chartId, name);
        lengthSum += html.length;
    }
    const end = process.hrtime.bigint();
    elapsedMs.push(Number(end - start) / 1e6);
    lengths.push(lengthSum / iterations);
    guard += lengthSum;
}

const sorted = [...elapsedMs].sort((a, b) => a - b);
const medianMs = sorted[Math.floor(sorted.length / 2)];
const meanMs = elapsedMs.reduce((sum, n) => sum + n, 0) / elapsedMs.length;
const avgLen = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;

console.log(`Target: ${appPath}`);
console.log(`samples=${samples} iterations=${iterations}`);
elapsedMs.forEach((ms, idx) => {
    console.log(`sample_${idx + 1}: ${ms.toFixed(3)}ms avg_html_len=${lengths[idx].toFixed(1)}`);
});
console.log(`median_ms=${medianMs.toFixed(3)}`);
console.log(`mean_ms=${meanMs.toFixed(3)}`);
console.log(`avg_html_len=${avgLen.toFixed(1)}`);
console.log(`guard=${guard}`);
