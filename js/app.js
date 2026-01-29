// Utility: Format currency safely
const formatMoney = (amount) => {
    if (!amount && amount !== 0) return '-';
    const num = parseFloat(amount.toString().replace(/,/g, ''));
    if (isNaN(num)) return amount;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
};

// Utility: Clean money string to number
const cleanMoney = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return parseFloat(val.toString().replace(/,/g, '')) || 0;
};

// Utility: Format date nicely
const formatDate = (dateStr) => {
    if (!dateStr || dateStr === "Unknown Date") return dateStr;
    const [y, m, d] = dateStr.split('-');
    if(y && m && d) return `${m}/${d}/${y}`;
    return dateStr;
};

// Global State
const state = {
    masterData: {},
    masterKeys: [], // Sorted list of names
    filteredKeys: [], // Current search results
    visibleCount: 50,
    batchSize: 50,
    isLoading: false,
    filters: {
        text: '',
        type: 'all', // all, classified, unclassified
        role: '',
        minSalary: null,
        maxSalary: null
    }
};

// DOM Elements
const els = {
    searchInput: document.getElementById('search'),
    typeSelect: document.getElementById('type-filter'),
    roleInput: document.getElementById('role-filter'),
    salaryMin: document.getElementById('salary-min'),
    salaryMax: document.getElementById('salary-max'),
    results: document.getElementById('results'),
    stats: document.getElementById('stats-bar'),
    roleDatalist: document.getElementById('role-list'),
    // Dashboard Elements
    dashboard: document.getElementById('stats-dashboard'),
    statTotal: document.getElementById('stat-total'),
    statMedian: document.getElementById('stat-median'),
    barClassified: document.getElementById('bar-classified'),
    barUnclassified: document.getElementById('bar-unclassified'),
    countClassified: document.getElementById('count-classified'),
    countUnclassified: document.getElementById('count-unclassified'),
    // New Chart Elements
    orgLeaderboard: document.getElementById('org-leaderboard'),
    tenureChart: document.getElementById('tenure-chart'),
    roleDonut: document.getElementById('role-donut'),
    roleLegend: document.getElementById('role-legend'),
    ticks: {
        p10: document.getElementById('tick-p10'),
        p25: document.getElementById('tick-p25'),
        p50: document.getElementById('tick-p50'),
        p75: document.getElementById('tick-p75'),
        p90: document.getElementById('tick-p90'),
    },
    vals: {
        p10: document.getElementById('val-p10'),
        p50: document.getElementById('val-p50'),
        p90: document.getElementById('val-p90'),
    }
};

// Initialization
fetch('data.json')
    .then(res => res.json())
    .then(data => {
        state.masterData = data;
        state.masterKeys = Object.keys(data).sort();

        populateRoleOptions(data);
        runSearch(); // Initial render
        updateStats();
        setupInfiniteScroll();
    })
    .catch(err => {
        els.stats.innerHTML = "Error loading data.json.";
        console.error(err);
    });

function populateRoleOptions(data) {
    const roles = new Set();
    Object.values(data).forEach(person => {
        person.Timeline.forEach(snap => {
            snap.Jobs.forEach(job => {
                if (job['Job Title']) roles.add(job['Job Title']);
            });
        });
    });

    const sortedRoles = Array.from(roles).sort();
    els.roleDatalist.innerHTML = sortedRoles.map(r => `<option value="${r}">`).join('');
}

// Search Logic
function runSearch() {
    const term = state.filters.text.toLowerCase();
    const typeFilter = state.filters.type;
    const roleFilter = state.filters.role.toLowerCase();
    const { minSalary, maxSalary } = state.filters;

    state.filteredKeys = state.masterKeys.filter(name => {
        const person = state.masterData[name];

        // 1. Text Match (Name, Org)
        const metaStr = JSON.stringify(person.Meta).toLowerCase();
        const textMatch = name.toLowerCase().includes(term) || metaStr.includes(term);
        if (!textMatch) return false;

        // 2. Type Match (Classified / Unclassified)
        if (typeFilter !== 'all') {
            const hasType = person.Timeline.some(snap => {
                const src = snap.Source.toLowerCase();
                const isUnclass = src.includes('unclass');
                if (typeFilter === 'unclassified') return isUnclass;
                if (typeFilter === 'classified') return src.includes('class') && !isUnclass;
                return false;
            });
            if (!hasType) return false;
        }

        // 3. Role Match
        if (roleFilter) {
            const hasRole = person.Timeline.some(snap =>
                snap.Jobs.some(job => (job['Job Title'] || '').toLowerCase().includes(roleFilter))
            );
            if (!hasRole) return false;
        }

        // 4. Salary Range Match (Based on LATEST snapshot)
        if (minSalary !== null || maxSalary !== null) {
            const lastSnapshot = person.Timeline[person.Timeline.length - 1];
            const lastJob = lastSnapshot.Jobs[0] || {};
            const salary = cleanMoney(lastJob['Annual Salary Rate']);

            if (minSalary !== null && salary < minSalary) return false;
            if (maxSalary !== null && salary > maxSalary) return false;
        }

        return true;
    });

    state.visibleCount = state.batchSize; // Reset scroll
    renderInitial();
    updateStats();

    // Update Dashboard Stats
    const stats = calculateStats(state.filteredKeys);
    updateDashboard(stats);
}

function calculateStats(keys) {
    let min = Infinity;
    let max = -Infinity;
    let classified = 0;
    let unclassified = 0;
    let salaries = [];
    let orgs = {};
    let roles = {};
    let tenure = { t0_2: 0, t2_5: 0, t5_10: 0, t10_plus: 0 };

    const now = new Date();

    keys.forEach(key => {
        const p = state.masterData[key];
        const lastSnap = p.Timeline[p.Timeline.length - 1];
        const lastJob = lastSnap.Jobs[0] || {};
        const salary = cleanMoney(lastJob['Annual Salary Rate']);

        // Salary Stats
        if (salary > 0) {
            if (salary < min) min = salary;
            if (salary > max) max = salary;
            salaries.push(salary);
        }

        // Classification
        const src = lastSnap.Source.toLowerCase();
        if (src.includes('unclass')) unclassified++;
        else classified++;

        // Organizations & Roles
        const org = personOrg(p) || 'Unknown';
        orgs[org] = (orgs[org] || 0) + 1;

        const role = lastJob['Job Title'] || 'Unknown';
        roles[role] = (roles[role] || 0) + 1;

        // Tenure
        const hiredStr = p.Meta['First Hired'];
        if (hiredStr) {
            const hiredDate = new Date(hiredStr);
            if (!isNaN(hiredDate)) {
                const years = (now - hiredDate) / (1000 * 60 * 60 * 24 * 365.25);
                if (years < 2) tenure.t0_2++;
                else if (years < 5) tenure.t2_5++;
                else if (years < 10) tenure.t5_10++;
                else tenure.t10_plus++;
            }
        }
    });

    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;

    // Percentiles
    salaries.sort((a, b) => a - b);
    const getP = (p) => {
        if (!salaries.length) return 0;
        const idx = Math.floor((p / 100) * (salaries.length - 1));
        return salaries[idx];
    };

    const percentiles = {
        min, max,
        p10: getP(10),
        p25: getP(25),
        p50: getP(50), // Median
        p75: getP(75),
        p90: getP(90)
    };

    // Top Orgs
    const sortedOrgs = Object.entries(orgs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // Top Roles
    const sortedRoles = Object.entries(roles)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4); // Top 4

    return {
        count: keys.length,
        percentiles,
        classified,
        unclassified,
        topOrgs: sortedOrgs,
        topRoles: sortedRoles,
        tenure
    };
}

function personOrg(p) {
    // Try Meta Home Orgn first, then job orgn
    if (p.Meta['Home Orgn']) return p.Meta['Home Orgn'];
    const lastSnap = p.Timeline[p.Timeline.length - 1];
    if (lastSnap.Jobs[0]) return lastSnap.Jobs[0]['Job Orgn'];
    return null;
}

function updateDashboard(stats) {
    els.dashboard.classList.remove('hidden');
    els.statTotal.textContent = stats.count.toLocaleString();
    els.statMedian.textContent = formatMoney(stats.percentiles.p50);

    // Classification
    const totalTypes = stats.classified + stats.unclassified;
    const classPct = totalTypes ? (stats.classified / totalTypes) * 100 : 0;
    const unclassPct = totalTypes ? (stats.unclassified / totalTypes) * 100 : 0;
    els.barClassified.style.width = `${classPct}%`;
    els.barUnclassified.style.width = `${unclassPct}%`;
    els.countClassified.textContent = stats.classified.toLocaleString();
    els.countUnclassified.textContent = stats.unclassified.toLocaleString();

    // Percentiles (Logarithmic Scale)
    const { min, max, p10, p25, p50, p75, p90 } = stats.percentiles;

    const getLogPos = (val) => {
        if (val <= 0 || min <= 0) return 0;
        const logMin = Math.log(min || 1);
        const logMax = Math.log(max || 100000); // Default max if 0
        const logVal = Math.log(val);
        const pos = ((logVal - logMin) / (logMax - logMin)) * 100;
        return Math.max(0, Math.min(100, pos));
    };

    els.ticks.p10.style.left = `${getLogPos(p10)}%`;
    els.ticks.p25.style.left = `${getLogPos(p25)}%`;
    els.ticks.p50.style.left = `${getLogPos(p50)}%`;
    els.ticks.p75.style.left = `${getLogPos(p75)}%`;
    els.ticks.p90.style.left = `${getLogPos(p90)}%`;

    els.vals.p10.textContent = formatMoney(p10);
    els.vals.p50.textContent = formatMoney(p50);
    els.vals.p90.textContent = formatMoney(p90);

    // Tenure Chart
    const tTotal = stats.tenure.t0_2 + stats.tenure.t2_5 + stats.tenure.t5_10 + stats.tenure.t10_plus || 1;
    const tPcts = [
        (stats.tenure.t0_2 / tTotal) * 100,
        (stats.tenure.t2_5 / tTotal) * 100,
        (stats.tenure.t5_10 / tTotal) * 100,
        (stats.tenure.t10_plus / tTotal) * 100
    ];

    els.tenureChart.innerHTML = `
        <div class="tenure-seg t1" style="width:${tPcts[0]}%" title="< 2 Years: ${stats.tenure.t0_2}"></div>
        <div class="tenure-seg t2" style="width:${tPcts[1]}%" title="2-5 Years: ${stats.tenure.t2_5}"></div>
        <div class="tenure-seg t3" style="width:${tPcts[2]}%" title="5-10 Years: ${stats.tenure.t5_10}"></div>
        <div class="tenure-seg t4" style="width:${tPcts[3]}%" title="10+ Years: ${stats.tenure.t10_plus}"></div>
    `;

    // Leaderboard
    const maxCount = stats.topOrgs[0] ? stats.topOrgs[0][1] : 1;
    els.orgLeaderboard.innerHTML = stats.topOrgs.map(([name, count]) => `
        <div class="lb-row">
            <div class="lb-label" title="${name}">${name}</div>
            <div class="lb-bar-container">
                <div class="lb-bar" style="width: ${(count/maxCount)*100}%"></div>
                <div class="lb-val">${count}</div>
            </div>
        </div>
    `).join('');

    // Role Donut Chart
    updateDonut(stats.topRoles, stats.count);
}

function updateDonut(roles, total) {
    if (!roles.length) return;

    const colors = ['#D73F09', '#b83508', '#992c06', '#7a2205', '#444444'];
    let currentDeg = 0;
    let gradientParts = [];
    let otherCount = total;

    roles.forEach(([role, count], idx) => {
        const deg = (count / total) * 360;
        gradientParts.push(`${colors[idx]} ${currentDeg}deg ${currentDeg + deg}deg`);
        currentDeg += deg;
        otherCount -= count;
    });

    // Add "Other" segment
    if (otherCount > 0) {
        gradientParts.push(`${colors[4]} ${currentDeg}deg 360deg`);
    }

    els.roleDonut.style.background = `conic-gradient(${gradientParts.join(', ')})`;

    // Legend
    els.roleLegend.innerHTML = roles.map(([role, count], idx) => `
        <div class="legend-item"><span class="dot" style="background:${colors[idx]}"></span> ${role} (${Math.round(count/total*100)}%)</div>
    `).join('') + (otherCount > 0 ? `<div class="legend-item"><span class="dot" style="background:${colors[4]}"></span> Other (${Math.round(otherCount/total*100)}%)</div>` : '');
}

function generateCardHTML(name, idx) {
    const person = state.masterData[name];
    const lastSnapshot = person.Timeline[person.Timeline.length - 1];
    const lastJob = lastSnapshot.Jobs[0] || {};
    // Use simple index-based ID to avoid issues with special characters in names (e.g. O'Connor)
    const cardId = `card-${idx}`;

    return `
    <div class="card" id="${cardId}">
        <div class="card-header" onclick="toggleCard('${cardId}')">
            <div class="person-info">
                <h2>${name}</h2>
                <p>Home Org: ${person.Meta["Home Orgn"] || 'N/A'}</p>
            </div>
            <div class="latest-stat">
                <div class="latest-salary">
                    ${formatMoney(lastJob['Annual Salary Rate'])}
                </div>
                <div class="latest-role">${lastJob['Job Title'] || 'Unknown'}</div>
            </div>
        </div>

        <div class="history">
            <table>
                <thead>
                    <tr>
                        <th>Date & Source</th>
                        <th>Job Details</th>
                        <th>Type</th>
                        <th>Salary</th>
                    </tr>
                </thead>
                <tbody>
                    ${person.Timeline.slice().reverse().map(snap => {
                        return snap.Jobs.map(job => `
                            <tr>
                                <td class="date-cell">
                                    <div>${formatDate(snap.Date)}</div>
                                    <div class="badge badge-source">${snap.Source.replace('.txt','').substring(0, 15)}...</div>
                                </td>
                                <td>
                                    <div style="font-weight:600;">${job['Job Title'] || ''}</div>
                                    <div style="font-size:0.85rem; color:#64748b;">${job['Job Orgn'] || ''}</div>
                                </td>
                                <td>
                                    <span class="badge badge-type">${job['Job Type'] || '?'}</span>
                                </td>
                                <td class="money-cell">
                                    ${formatMoney(job['Annual Salary Rate'])}
                                    ${job['Salary Term'] ? `<span class="term-badge">${job['Salary Term']}</span>` : ''}
                                </td>
                            </tr>
                        `).join('')
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>
    `;
}

function renderInitial() {
    const { filteredKeys, visibleCount } = state;
    const keysToRender = filteredKeys.slice(0, visibleCount);

    if (keysToRender.length === 0) {
        els.results.innerHTML = `<p style="text-align:center; color:#888;">No matching records found.</p>`;
        return;
    }

    const html = keysToRender.map((name, idx) => generateCardHTML(name, idx)).join('');

    // Sentinel
    const sentinelHTML = `<div id="scroll-sentinel" class="loader-sentinel">${visibleCount < filteredKeys.length ? 'Loading more...' : 'End of results'}</div>`;

    els.results.innerHTML = html + sentinelHTML;
    observeSentinel();
}

function appendNextBatch() {
    const { filteredKeys, visibleCount, batchSize } = state;
    // Calculate range
    const startIdx = visibleCount; // Current count is where we start
    const endIdx = Math.min(startIdx + batchSize, filteredKeys.length);

    if (startIdx >= filteredKeys.length) return;

    const keysToRender = filteredKeys.slice(startIdx, endIdx);
    const html = keysToRender.map((name, idx) => generateCardHTML(name, startIdx + idx)).join('');

    // Remove old sentinel
    const oldSentinel = document.getElementById('scroll-sentinel');
    if (oldSentinel) oldSentinel.remove();

    // Create a temp container to convert string to nodes
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Append new cards
    while (tempDiv.firstChild) {
        els.results.appendChild(tempDiv.firstChild);
    }

    // Update state
    state.visibleCount = endIdx;

    // Add new sentinel
    const sentinelHTML = `<div id="scroll-sentinel" class="loader-sentinel">${state.visibleCount < filteredKeys.length ? 'Loading more...' : 'End of results'}</div>`;
    els.results.insertAdjacentHTML('beforeend', sentinelHTML);

    observeSentinel();
}

function updateStats() {
    els.stats.innerHTML = `Found ${state.filteredKeys.length} matching personnel records.`;
}

function toggleCard(id) {
    const el = document.getElementById(id);
    if(el) el.classList.toggle('expanded');
}

// Infinite Scroll Observer
let observer;
function setupInfiniteScroll() {
    const options = { root: null, rootMargin: '100px', threshold: 0.1 };
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && state.visibleCount < state.filteredKeys.length) {
                appendNextBatch();
            }
        });
    }, options);
}

function observeSentinel() {
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel && observer) observer.observe(sentinel);
}

// Event Listeners
// Debounce Function
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// Search Inputs
els.searchInput.addEventListener('input', debounce((e) => {
    state.filters.text = e.target.value;
    runSearch();
}, 300));

els.typeSelect.addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    runSearch();
});

els.roleInput.addEventListener('input', debounce((e) => {
    state.filters.role = e.target.value;
    runSearch();
}, 300));

els.salaryMin.addEventListener('input', debounce((e) => {
    state.filters.minSalary = e.target.value ? parseFloat(e.target.value) : null;
    runSearch();
}, 300));

els.salaryMax.addEventListener('input', debounce((e) => {
    state.filters.maxSalary = e.target.value ? parseFloat(e.target.value) : null;
    runSearch();
}, 300));

// Modal Logic
const modal = document.getElementById('info-modal');
const infoBtn = document.getElementById('info-btn');
const closeBtn = document.getElementById('close-modal');

if (infoBtn && modal && closeBtn) {
    infoBtn.onclick = () => modal.classList.remove('hidden');
    closeBtn.onclick = () => modal.classList.add('hidden');
    window.onclick = (e) => { if (e.target == modal) modal.classList.add('hidden'); }
}

// Ctrl+F Trap
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        els.searchInput.focus();
    }
});
