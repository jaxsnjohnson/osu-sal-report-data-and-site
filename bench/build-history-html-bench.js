const fs = require('fs');

// We use the same mock state and logic as before to test the optimization
global.state = {
    masterData: {
        "Test Person": {
            _hasTimeline: true,
            Meta: {
                "First Hired": "2010-01-01",
                "Adj Service Date": "2010-01-01"
            },
            Timeline: []
        }
    }
};

function formatDate(d) { return d; }
function cleanMoney(v) { return typeof v === 'number' ? v : parseFloat((v||"0").replace(/[^0-9.-]+/g,"")) || 0; }
function formatMoney(v) { return "$" + (typeof v === 'number' ? v : cleanMoney(v)).toFixed(2); }
function formatHourlyMoney(v) { return "$" + (typeof v === 'number' ? v : cleanMoney(v)).toFixed(2); }
function getRecordGaps() { return []; }

const person = global.state.masterData["Test Person"];
const numSnapshots = 50;
const numJobsPerSnapshot = 200;

for (let i = 0; i < numSnapshots; i++) {
    const jobs = [];
    for (let j = 0; j < numJobsPerSnapshot; j++) {
        jobs.push({
            'Posn-Suff': `P${j}-S1`,
            'Annual Salary Rate': `$${50000 + (i * 1000) + j}`,
            'Hourly Rate': "$0",
            'Job Title': `Job ${j}`,
            'Job Orgn': `Org ${j}`,
            'Job Type': 'Classified'
        });
    }
    person.Timeline.push({
        Date: `2020-01-0${(i%9)+1}`,
        Source: `Source ${i}`,
        Jobs: jobs
    });
}

function runBenchmark(isOptimized) {
    const appJs = fs.readFileSync('../js/app.js', 'utf8');

    let codeToEval = appJs.substring(appJs.indexOf("function buildHistoryHTML("), appJs.indexOf("function generateCardHTML("));

    if (!isOptimized) {
        // Revert to original code dynamically for the baseline measurement
        codeToEval = codeToEval.replace(
            `let prevJobsMap = null;
                                if (prevSnap && prevSnap.Jobs) {
                                    prevJobsMap = new Map();
                                    for (const pj of prevSnap.Jobs) {
                                        if (pj['Posn-Suff']) prevJobsMap.set(pj['Posn-Suff'], pj);
                                    }
                                }
                                return (snap.Jobs || []).map(job => {
                                    let diffHTML = '';
                                    if (prevJobsMap && !job._missingRate) {
                                        const prevJob = prevJobsMap.get(job['Posn-Suff']);`,
            `return (snap.Jobs || []).map(job => {
                                    let diffHTML = '';
                                    if (prevSnap && prevSnap.Jobs && !job._missingRate) {
                                        const prevJob = prevSnap.Jobs.find(j => j['Posn-Suff'] === job['Posn-Suff']);`
        );
    }

    eval(codeToEval);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
        buildHistoryHTML(person, "chart-1", "Test Person");
    }
    const end = performance.now();
    return end - start;
}

const origTime = runBenchmark(false);
const optTime = runBenchmark(true);

console.log(`Original Time: ${origTime.toFixed(2)} ms`);
console.log(`Optimized Time: ${optTime.toFixed(2)} ms`);
console.log(`Improvement: ${((origTime - optTime) / origTime * 100).toFixed(2)}%`);
