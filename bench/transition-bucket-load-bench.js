#!/usr/bin/env node

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const defaultBucketDir = path.resolve(__dirname, '..', 'data', 'people');
const bucketDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultBucketDir;

const sampleCount = Number(process.env.TRANSITION_BENCH_SAMPLES || 7);
const warmupRounds = Number(process.env.TRANSITION_BENCH_WARMUP || 1);
const concurrencyLimit = Number(process.env.TRANSITION_BENCH_CONCURRENCY || 6);

const toMs = (nanoseconds) => Number(nanoseconds) / 1e6;

const mean = (values) => {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const forEachWithConcurrency = (items, concurrency, iteratee) => {
    if (!Array.isArray(items) || items.length === 0) return Promise.resolve();
    const safeConcurrency = Math.max(1, Math.floor(concurrency) || 1);
    const workerCount = Math.min(safeConcurrency, items.length);
    let nextIndex = 0;

    const runWorker = () => {
        const currentIndex = nextIndex++;
        if (currentIndex >= items.length) return Promise.resolve();
        return Promise.resolve(iteratee(items[currentIndex], currentIndex)).then(runWorker);
    };

    return Promise.all(Array.from({ length: workerCount }, runWorker)).then(() => undefined);
};

const listBucketFiles = async () => {
    const files = (await fs.readdir(bucketDir))
        .filter((name) => name.endsWith('.json'))
        .sort();
    if (!files.length) throw new Error(`No bucket files found in ${bucketDir}`);
    return files;
};

const loadBucketFile = async (fileName) => {
    const filePath = path.join(bucketDir, fileName);
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(text);
    return { text, parsed };
};

const runSample = async (files, strategy) => {
    let inFlight = 0;
    let peakInFlight = 0;
    let totalBytes = 0;
    let totalPeople = 0;

    const started = process.hrtime.bigint();

    const runBucket = async (fileName) => {
        inFlight += 1;
        if (inFlight > peakInFlight) peakInFlight = inFlight;
        try {
            const { text, parsed } = await loadBucketFile(fileName);
            totalBytes += Buffer.byteLength(text);
            totalPeople += Object.keys(parsed).length;
        } finally {
            inFlight -= 1;
        }
    };

    if (strategy === 'unbounded') {
        await Promise.all(files.map((fileName) => runBucket(fileName)));
    } else if (strategy === 'bounded') {
        await forEachWithConcurrency(files, concurrencyLimit, runBucket);
    } else {
        throw new Error(`Unknown strategy: ${strategy}`);
    }

    const elapsedMs = toMs(process.hrtime.bigint() - started);
    return { elapsedMs, peakInFlight, totalBytes, totalPeople };
};

const printSample = (strategy, idx, sample) => {
    console.log(
        `${strategy}_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms ` +
        `peak_in_flight=${sample.peakInFlight} people=${sample.totalPeople} bytes=${sample.totalBytes}`
    );
};

const summarize = (samples) => {
    const elapsedMs = samples.map((sample) => sample.elapsedMs);
    const peakInFlight = samples.map((sample) => sample.peakInFlight);
    return {
        medianElapsedMs: median(elapsedMs),
        meanElapsedMs: mean(elapsedMs),
        medianPeakInFlight: median(peakInFlight)
    };
};

const formatPct = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const main = async () => {
    const files = await listBucketFiles();

    console.log(`Bucket directory: ${bucketDir}`);
    console.log(`buckets=${files.length} warmup=${warmupRounds} samples=${sampleCount} bounded_concurrency=${concurrencyLimit}`);

    for (let i = 0; i < warmupRounds; i += 1) {
        await runSample(files, 'unbounded');
        await runSample(files, 'bounded');
    }

    const runs = {
        unbounded: [],
        bounded: []
    };

    for (let i = 0; i < sampleCount; i += 1) {
        const order = (i % 2 === 0) ? ['unbounded', 'bounded'] : ['bounded', 'unbounded'];
        for (const strategy of order) {
            if (typeof global.gc === 'function') global.gc();
            const sample = await runSample(files, strategy);
            runs[strategy].push(sample);
            printSample(strategy, runs[strategy].length - 1, sample);
        }
    }

    const unboundedSummary = summarize(runs.unbounded);
    const boundedSummary = summarize(runs.bounded);

    const elapsedDeltaPct =
        ((boundedSummary.medianElapsedMs - unboundedSummary.medianElapsedMs) / unboundedSummary.medianElapsedMs) * 100;
    const peakInFlightReductionPct =
        ((unboundedSummary.medianPeakInFlight - boundedSummary.medianPeakInFlight) / unboundedSummary.medianPeakInFlight) * 100;

    console.log(`unbounded_median=${unboundedSummary.medianElapsedMs.toFixed(3)}ms mean=${unboundedSummary.meanElapsedMs.toFixed(3)}ms median_peak_in_flight=${unboundedSummary.medianPeakInFlight}`);
    console.log(`bounded_median=${boundedSummary.medianElapsedMs.toFixed(3)}ms mean=${boundedSummary.meanElapsedMs.toFixed(3)}ms median_peak_in_flight=${boundedSummary.medianPeakInFlight}`);
    console.log(`median_elapsed_change_vs_unbounded=${formatPct(elapsedDeltaPct)}`);
    console.log(`median_peak_in_flight_reduction=${formatPct(peakInFlightReductionPct)}`);
};

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
