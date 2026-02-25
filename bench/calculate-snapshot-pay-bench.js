#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '..', 'js', 'app.js');
const rounds = Number(process.env.SNAP_PAY_ROUNDS || 200000);
const warmupRounds = Number(process.env.SNAP_PAY_WARMUP || 2);
const sampleCount = Number(process.env.SNAP_PAY_SAMPLES || 7);

const source = fs.readFileSync(targetPath, 'utf8');
const fnStart = source.indexOf('const calculateSnapshotPay = (snapshot) => {');
const fnEnd = source.indexOf('\n\nconst bucketForName =', fnStart);

if (fnStart < 0 || fnEnd < 0) {
    throw new Error(`Could not find calculateSnapshotPay in ${targetPath}`);
}

const currentSource = source.slice(fnStart, fnEnd).trim();

const buildCurrentCalculateSnapshotPay = () => Function(
    `"use strict";\n${currentSource}\nreturn calculateSnapshotPay;`
)();

function legacyCalculateSnapshotPay(snapshot) {
    if (!snapshot || !snapshot.Jobs) return 0;
    let total = 0;
    snapshot.Jobs.forEach(job => {
        const rate = job._rate !== undefined ? job._rate : (parseFloat(job['Annual Salary Rate']) || 0);
        const pct = job._pct !== undefined ? job._pct : (parseFloat(job['Appt Percent']) || 0);
        if (rate > 0) total += rate * (pct / 100);
    });
    return total;
}

const currentCalculateSnapshotPay = buildCurrentCalculateSnapshotPay();

const clone = (value) => JSON.parse(JSON.stringify(value));

const makeJob = (i) => ({
    'Annual Salary Rate': (i % 11 === 0) ? '' : String(42000 + (i % 31) * 1731.41),
    'Appt Percent': (i % 13 === 0) ? '' : String(40 + (i % 7) * 10),
    'Salary Term': 'yr'
});

const hydrateSnapshot = (snapshot) => {
    (snapshot.Jobs || []).forEach(job => {
        job._rate = parseFloat(job['Annual Salary Rate']) || 0;
        job._pct = parseFloat(job['Appt Percent']) || 0;
    });
    return snapshot;
};

const baseJobs = Array.from({ length: 24 }, (_, i) => makeJob(i));

const scenarios = [
    {
        name: 'reused_uncached_snapshot',
        createWorkload() {
            return { snapshot: { Jobs: clone(baseJobs) } };
        },
        run(fn, workload) {
            return fn(workload.snapshot);
        }
    },
    {
        name: 'reused_hydrated_snapshot',
        createWorkload() {
            return { snapshot: hydrateSnapshot({ Jobs: clone(baseJobs) }) };
        },
        run(fn, workload) {
            return fn(workload.snapshot);
        }
    },
    {
        name: 'mixed_snapshot_array',
        createWorkload() {
            const snapshots = [];
            for (let i = 0; i < 48; i++) {
                const jobs = clone(baseJobs).map((job, idx) => ({
                    ...job,
                    'Annual Salary Rate': String((idx % 9 === 0 ? 0 : 35000) + i * 10 + idx * 3),
                    'Appt Percent': String((idx % 5 === 0) ? 0 : 50 + ((i + idx) % 6) * 10)
                }));
                const snap = { Jobs: jobs };
                snapshots.push(i % 2 === 0 ? hydrateSnapshot(snap) : snap);
            }
            return { snapshots };
        },
        run(fn, workload) {
            let total = 0;
            workload.snapshots.forEach((snap) => {
                total += fn(snap);
            });
            return total;
        }
    }
];

const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const runScenarioSample = (scenario, fn, loopRounds) => {
    const workload = scenario.createWorkload();
    let checksum = 0;
    const started = process.hrtime.bigint();
    for (let i = 0; i < loopRounds; i++) {
        checksum += scenario.run(fn, workload);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return { elapsedMs, checksum };
};

const summarize = (samples) => {
    const elapsed = samples.map(sample => sample.elapsedMs);
    const medianMs = median(elapsed);
    const meanMs = elapsed.reduce((sum, ms) => sum + ms, 0) / elapsed.length;
    return { medianMs, meanMs };
};

console.log(`Target: ${targetPath}`);
console.log(`rounds=${rounds} warmup=${warmupRounds} samples=${sampleCount}`);

for (const scenario of scenarios) {
    const parityLegacy = runScenarioSample(scenario, legacyCalculateSnapshotPay, 10);
    const parityCurrent = runScenarioSample(scenario, currentCalculateSnapshotPay, 10);
    if (Math.round(parityLegacy.checksum) !== Math.round(parityCurrent.checksum)) {
        throw new Error(`Parity mismatch for ${scenario.name}`);
    }

    for (let i = 0; i < warmupRounds; i++) {
        runScenarioSample(scenario, legacyCalculateSnapshotPay, rounds);
        runScenarioSample(scenario, currentCalculateSnapshotPay, rounds);
    }

    const legacySamples = [];
    const currentSamples = [];
    for (let i = 0; i < sampleCount; i++) {
        legacySamples.push(runScenarioSample(scenario, legacyCalculateSnapshotPay, rounds));
        currentSamples.push(runScenarioSample(scenario, currentCalculateSnapshotPay, rounds));
    }

    const legacySummary = summarize(legacySamples);
    const currentSummary = summarize(currentSamples);
    const deltaMs = currentSummary.medianMs - legacySummary.medianMs;
    const speedup = legacySummary.medianMs / currentSummary.medianMs;
    const reduction = ((legacySummary.medianMs - currentSummary.medianMs) / legacySummary.medianMs) * 100;

    console.log(`scenario=${scenario.name} parity=PASS checksum=${Math.round(parityCurrent.checksum)}`);
    legacySamples.forEach((sample, idx) => {
        console.log(`scenario=${scenario.name} legacy_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms checksum=${Math.round(sample.checksum)}`);
    });
    currentSamples.forEach((sample, idx) => {
        console.log(`scenario=${scenario.name} current_sample_${idx + 1}: ${sample.elapsedMs.toFixed(3)}ms checksum=${Math.round(sample.checksum)}`);
    });
    console.log(`scenario=${scenario.name} legacy_median: ${legacySummary.medianMs.toFixed(3)}ms`);
    console.log(`scenario=${scenario.name} legacy_mean: ${legacySummary.meanMs.toFixed(3)}ms`);
    console.log(`scenario=${scenario.name} current_median: ${currentSummary.medianMs.toFixed(3)}ms`);
    console.log(`scenario=${scenario.name} current_mean: ${currentSummary.meanMs.toFixed(3)}ms`);
    console.log(`scenario=${scenario.name} delta_median_ms: ${deltaMs.toFixed(3)}ms`);
    console.log(`scenario=${scenario.name} speedup_vs_legacy: ${speedup.toFixed(3)}x`);
    console.log(`scenario=${scenario.name} median_time_reduction: ${reduction.toFixed(2)}%`);
}
