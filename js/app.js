// ==========================================
// UTILITIES
// ==========================================

const formatMoney = (amount) => {
    if (!amount && amount !== 0) return '-';
    const num = parseFloat(amount.toString().replace(/[^0-9.-]+/g, ''));
    if (isNaN(num)) return amount;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
};

const cleanMoney = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const cleanStr = val.toString().replace(/[^0-9.-]+/g, '');
    return parseFloat(cleanStr) || 0;
};

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;

const formatDate = (dateStr) => {
    if (!dateStr || dateStr === "Unknown Date") return dateStr;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        if (parts[0].length === 4) return `${parts[1]}/${parts[2]}/${parts[0]}`; 
        return dateStr;
    }
    return dateStr;
};

const calculateSnapshotPay = (snapshot) => {
    if (!snapshot || !snapshot.Jobs) return 0;
    let total = 0;
    snapshot.Jobs.forEach(job => {
        // Optimized: Use pre-parsed _rate if available, else parseFloat directly
        const rate = job._rate !== undefined ? job._rate : (parseFloat(job['Annual Salary Rate']) || 0);
        // Optimized: Use pre-parsed _pct if available
        const pct = job._pct !== undefined ? job._pct : (parseFloat(job['Appt Percent']) || 0);

        if (rate > 0) total += rate * (pct / 100);
    });
    return total;
};

const isPersonActive = (person) => {
    if (!person || !person._lastDate) return false;

    // Optimized: Use cached classification to avoid redundant string parsing
    const targetDate = person._isUnclass ? state.latestUnclassDate : state.latestClassDate;
    return !targetDate || person._lastDate === targetDate;
};

// --- UPDATED SPARKLINE FUNCTION ---
const generateSparkline = (timeline) => {
    if (!timeline || timeline.length === 0) return '';

    // 1. Prepare Data & Check Duration (< 3 Years)
    const startTime = timeline[0]._ts;
    const endTime = timeline[timeline.length - 1]._ts;
    const yearsDiff = (endTime - startTime) / MS_PER_YEAR;
    
    // IF LESS THAN 3 YEARS: Return text only, do not render chart
    if (yearsDiff < 3) {
        return `
            <div style="padding: 20px; text-align: center; color: #888; font-size: 0.85rem; background: rgba(255,255,255,0.03); border-radius: 4px;">
                ⚠️ History covers less than 3 years. Trend chart available for longer tenures only.
            </div>
        `;
    }

    // 2. Dynamic Y-Axis Bounds (Lowest to Highest)
    let minVal = timeline[0]._pay;
    let maxVal = minVal;

    for (let i = 1; i < timeline.length; i++) {
        const val = timeline[i]._pay;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
    }

    // Handle flat-line case to prevent division by zero
    if (minVal === maxVal) {
        maxVal = minVal + 1000; 
        minVal = minVal - 1000;
    }

    const width = 600; 
    const height = 100;
    const padding = 15;

    const timeSpan = endTime - startTime || 1;
    const valSpan = maxVal - minVal || 1;

    let d = `M`;
    let dots = '';

    for (let i = 0; i < timeline.length; i++) {
        const pt = timeline[i];
        const x = ((pt._ts - startTime) / timeSpan) * (width - 2 * padding) + padding;
        const y = height - padding - (((pt._pay - minVal) / valSpan) * (height - 2 * padding));
        
        d += `${i === 0 ? '' : ' L'}${x},${y}`;
        
        // INTERACTIVE DOT: Uses data-tooltip for instant custom hover
        dots += `<circle cx="${x}" cy="${y}" r="8" fill="transparent" stroke="none" style="cursor: pointer;" data-tooltip="${pt.Date}: ${formatMoney(pt._pay)}"></circle>`;
        
        // Visual Dot (Visual only, no events)
        dots += `<circle cx="${x}" cy="${y}" r="3" fill="#4ade80" opacity="0.9" style="pointer-events:none;" />`;
    }

    return `
        <div class="sparkline-container" style="width:100%; height:${height}px; position: relative; background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="position:absolute; top:2px; left:5px; font-size:10px; color:#4ade80; opacity:0.8;">Max: ${formatMoney(maxVal)}</div>
            <div style="position:absolute; bottom:2px; left:5px; font-size:10px; color:#888; opacity:0.8;">Min: ${formatMoney(minVal)}</div>
            
            <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                <path d="${d}" fill="none" stroke="#4ade80" stroke-width="2" />
                ${dots}
            </svg>
        </div>
    `;
};

// ==========================================
// GLOBAL STATE
// ==========================================
const state = {
    masterData: {},
    masterKeys: [],
    filteredKeys: [],
    visibleCount: 50,
    batchSize: 50,
    historyStats: [],
    latestClassDate: "",
    latestUnclassDate: "",
    chartInstances: {}, 
    filters: {
        text: '',
        type: 'all',
        role: '',
        minSalary: null,
        maxSalary: null,
        showInactive: false,
        sort: 'name-asc',   // Default sort: A-Z
        fullTimeOnly: false // Default: Show all FTEs
    }
};

const els = {
    searchInput: document.getElementById('search'),
    clearBtn: document.getElementById('clear-search'),
    typeSelect: document.getElementById('type-filter'),
    roleInput: document.getElementById('role-filter'),
    salaryMin: document.getElementById('salary-min'),
    salaryMax: document.getElementById('salary-max'),
    inactiveToggle: document.getElementById('show-inactive'),
    sortSelect: document.getElementById('sort-order'),
    fteToggle: document.getElementById('fte-toggle'),
    suggestedSearches: document.getElementById('suggested-searches'),
    results: document.getElementById('results'),
    stats: document.getElementById('stats-bar'),
    roleDatalist: document.getElementById('role-list'),
    dashboard: document.getElementById('stats-dashboard'),
    statTotal: document.getElementById('stat-total'),
    statMedian: document.getElementById('stat-median'),
    barClassified: document.getElementById('bar-classified'),
    barUnclassified: document.getElementById('bar-unclassified'),
    countClassified: document.getElementById('count-classified'),
    countUnclassified: document.getElementById('count-unclassified'),
    orgLeaderboard: document.getElementById('org-leaderboard'),
    tenureChart: document.getElementById('tenure-chart'),
    roleDonut: document.getElementById('role-donut'),
    roleLegend: document.getElementById('role-legend')
};

// ==========================================
// INITIALIZATION
// ==========================================
fetch('data.json')
    .then(res => res.json())
    .then(data => {
        let maxClassDate = "";
        let maxUnclassDate = "";
        const allRoles = new Set();
        const statsMap = {};

        Object.keys(data).forEach(key => {
            const p = data[key];
            const uniqueRoles = new Set();

            if (p.Timeline && p.Timeline.length > 0) {
                const lastIdx = p.Timeline.length - 1;
                const lastSnap = p.Timeline[lastIdx];
                const lastJob = (lastSnap.Jobs && lastSnap.Jobs.length > 0) ? lastSnap.Jobs[0] : {};
                const role = lastJob['Job Title'] || '';
                const jobOrg = lastJob['Job Orgn'] || '';

                // Optimized search string: Avoid JSON.stringify and only use relevant fields
                p._searchStr = (key + " " + (p.Meta["Home Orgn"]||"") + " " + (p.Meta["First Hired"]||"") + " " + role + " " + jobOrg).toLowerCase();

                // Optimization: Pre-parse First Hired date
                const hiredStr = p.Meta['First Hired'];
                p._hiredDateTs = 0;
                if (hiredStr) {
                    const d = new Date(hiredStr);
                    if (!isNaN(d)) p._hiredDateTs = d.getTime();
                }

                // Cache Active Status (Optimization)
                p._lastDate = lastSnap.Date;
                // Optimized: Compute isUnclass directly, no need to store _lastSource
                p._isUnclass = (lastSnap.Source || "").toLowerCase().includes('unclass');

                if (lastSnap.Date) {
                    if (p._isUnclass) {
                        if (lastSnap.Date > maxUnclassDate) maxUnclassDate = lastSnap.Date;
                    } else {
                        if (lastSnap.Date > maxClassDate) maxClassDate = lastSnap.Date;
                    }
                }

                // Unified Timeline Iteration (History + Roles)
                // Sort timeline once during initialization
                p.Timeline.sort((a, b) => (a.Date || "").localeCompare(b.Date || ""));

                p.Timeline.forEach((snap, idx) => {
                    // Optimization: Pre-parse salary rates and collect roles
                    if (snap.Jobs) {
                        snap.Jobs.forEach(job => {
                            if (job._rate === undefined) {
                                job._rate = parseFloat(job['Annual Salary Rate']) || 0;
                            }
                            // Optimization: Pre-parse appt percent
                            if (job._pct === undefined) {
                                job._pct = parseFloat(job['Appt Percent']);
                                if (isNaN(job._pct)) job._pct = 0;
                            }
                            if (job['Job Title']) {
                                allRoles.add(job['Job Title']);
                                uniqueRoles.add(job['Job Title'].toLowerCase());
                            }
                        });
                    }

                    // Pre-calculate pay and date object for sparklines
                    snap._pay = calculateSnapshotPay(snap);
                    snap._ts = new Date(snap.Date).getTime();

                    // History Stats Logic
                    const date = snap.Date;
                    if (!statsMap[date]) {
                        statsMap[date] = { date: date, classified: 0, unclassified: 0, payroll: 0 };
                    }
                    const src = (snap.Source || "").toLowerCase();
                    const pay = calculateSnapshotPay(snap);
                    statsMap[date].payroll += pay;
                    if (src.includes('unclass')) statsMap[date].unclassified++;
                    else statsMap[date].classified++;

                    // Set p._totalPay if this is the last snapshot
                    if (idx === lastIdx) {
                        p._totalPay = pay;
                    }
                });

                p._roleStr = Array.from(uniqueRoles).join('\0');

            } else {
                p._searchStr = key.toLowerCase();
                p._totalPay = 0;
                p._roleStr = "";
            }
        });

        state.latestClassDate = maxClassDate;
        state.latestUnclassDate = maxUnclassDate;
        state.historyStats = Object.values(statsMap).sort((a, b) => new Date(a.date) - new Date(b.date));
        state.masterData = data;
        state.masterKeys = Object.keys(data).sort();

        // Populate Roles
        els.roleDatalist.innerHTML = Array.from(allRoles).sort().map(r => `<option value="\${r}">`).join('');

        renderSuggestedSearches();
        
        const targetName = parseUrlParams(); 
        runSearch();
        updateStats();
        setupInfiniteScroll();

        setTimeout(() => {
            renderInteractiveCharts(state.historyStats);
        }, 0);

        if (targetName) {
            autoExpandTarget(targetName);
        }

        setupTooltips();
    })
    .catch(err => {
        els.stats.innerHTML = "Error loading data.json.";
        console.error(err);
    });


// ==========================================
// INTERACTIVE CHARTS
// ==========================================
function renderInteractiveCharts(history) {
    if (typeof Chart === 'undefined') return;

    let container = document.getElementById('historical-charts-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'historical-charts-container';
        
        container.style.display = 'contents';
        
        els.dashboard.appendChild(container);
    }

    const warningBox = `
        <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); color: #facc15; padding: 10px; border-radius: 6px; font-size: 0.8rem; margin-bottom: 15px; display: flex; align-items: flex-start; gap: 8px; line-height: 1.4;">
            <span style="font-size: 1.1rem; line-height: 1;">⚠️</span>
            <span><strong>Data Incomplete:</strong> These historical charts are based on partial records. Gaps in data may skew trends and totals.</span>
        </div>
    `;

    container.innerHTML = `
        <div class="stat-card wide">
            <div class="stat-label">Historical Personnel Count</div>
            ${warningBox}
            <div style="height: 300px; position: relative;">
                <canvas id="chart-personnel"></canvas>
            </div>
        </div>
        <div class="stat-card wide">
            <div class="stat-label">Total Compensation Trend</div>
            ${warningBox}
             <div style="height: 300px; position: relative;">
                <canvas id="chart-payroll"></canvas>
            </div>
        </div>
    `;

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#ccc' } },
            tooltip: { mode: 'index', intersect: false }
        },
        scales: {
            x: { ticks: { color: '#888' }, grid: { color: '#333' } },
            y: { ticks: { color: '#888' }, grid: { color: '#333' } }
        }
    };

    new Chart(document.getElementById('chart-personnel').getContext('2d'), {
        type: 'bar',
        data: {
            labels: history.map(d => d.date),
            datasets: [
                { label: 'Classified', data: history.map(d => d.classified), backgroundColor: '#8b5cf6', stack: 'Stack 0' },
                { label: 'Unclassified', data: history.map(d => d.unclassified), backgroundColor: '#f97316', stack: 'Stack 0' }
            ]
        },
        options: commonOptions
    });

    const calculateMovingAverage = (data, windowSize) => {
        const ma = [];
        for (let i = 0; i < data.length; i++) {
            const start = Math.max(0, i - windowSize + 1);
            const end = i + 1;
            const subset = data.slice(start, end);
            const avg = subset.reduce((sum, item) => sum + item.payroll, 0) / subset.length;
            ma.push(avg);
        }
        return ma;
    };
    
    const trendData = calculateMovingAverage(history, 3);

    new Chart(document.getElementById('chart-payroll').getContext('2d'), {
        type: 'line',
        data: {
            labels: history.map(d => d.date),
            datasets: [
                {
                    label: 'Total Payroll',
                    data: history.map(d => d.payroll),
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.3,
                    order: 2
                },
                {
                    label: '3-Year Moving Avg',
                    data: trendData,
                    borderColor: '#fbbf24',
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    borderWidth: 2,
                    order: 1
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    ticks: {
                        color: '#888',
                        callback: function(value) { return '$' + (value / 1000000).toFixed(1) + 'M'; }
                    }
                }
            }
        }
    });
}

// ==========================================
// SEARCH & FILTER LOGIC
// ==========================================
window.applySearch = function(term) {
    els.searchInput.value = term;
    state.filters.text = term;
    els.clearBtn.classList.remove('hidden');
    runSearch();
};

function runSearch() {
    const term = state.filters.text.toLowerCase();
    const typeFilter = state.filters.type;
    const roleFilter = state.filters.role.toLowerCase();
    const { minSalary, maxSalary, showInactive, sort, fullTimeOnly } = state.filters;

    // 1. FILTERING
    let results = state.masterKeys.filter(name => {
        const person = state.masterData[name];
        
        // Active/Inactive Check (Optimized)
        // If _lastDate is missing, treat as inactive (or empty data)
        const isActive = person._lastDate && (person._isUnclass
            ? (!state.latestUnclassDate || person._lastDate === state.latestUnclassDate)
            : (!state.latestClassDate || person._lastDate === state.latestClassDate));

        if (!showInactive && !isActive) return false;

        // Search Text
        if (person._searchStr && !person._searchStr.includes(term)) return false;

        // Full-Time Check (1.0 FTE)
        if (fullTimeOnly) {
            const lastSnap = person.Timeline[person.Timeline.length - 1];
            // Check if any single job is >= 100% or if you prefer total FTE, you'd sum them.
            // Using logic: At least one job record must be >= 100% (1.0)
            const isFT = lastSnap.Jobs && lastSnap.Jobs.some(j => {
                const pct = parseFloat(j['Appt Percent']);
                return !isNaN(pct) && pct >= 100;
            });
            if (!isFT) return false;
        }

        // Type Filter (Optimized with cached _isUnclass)
        if (typeFilter !== 'all') {
            if (typeFilter === 'unclassified' && !person._isUnclass) return false;
            if (typeFilter === 'classified' && person._isUnclass) return false;
        }

        // Role Filter
        if (roleFilter) {
            if (!person._roleStr || !person._roleStr.includes(roleFilter)) return false;
        }

        // Salary Range (Optimized)
        if (minSalary !== null || maxSalary !== null) {
            const salary = person._totalPay;
            if (minSalary !== null && salary < minSalary) return false;
            if (maxSalary !== null && salary > maxSalary) return false;
        }
        return true;
    });

    // 2. SORTING
    results.sort((keyA, keyB) => {
        const pA = state.masterData[keyA];
        const pB = state.masterData[keyB];

        switch (sort) {
            case 'salary-desc':
                return pB._totalPay - pA._totalPay;
            case 'salary-asc':
                return pA._totalPay - pB._totalPay;
            case 'tenure-desc':
                return pA._hiredDateTs - pB._hiredDateTs; // Older date = Higher Tenure
            case 'tenure-asc':
                return pB._hiredDateTs - pA._hiredDateTs; // Newer date = Lower Tenure
            case 'name-desc':
                return keyB.localeCompare(keyA);
            case 'name-asc':
            default:
                return keyA.localeCompare(keyB);
        }
    });

    state.filteredKeys = results;
    state.visibleCount = state.batchSize;
    renderInitial();
    updateStats();
    updateDashboard(calculateStats(state.filteredKeys));
}

// ==========================================
// STATISTICS & DASHBOARD
// ==========================================
function calculateStats(keys) {
    let count = 0, classified = 0, unclassified = 0, salaries = [];
    let orgs = {}, roles = {};
    let tenure = { t0_2: 0, t2_5: 0, t5_10: 0, t10_plus: 0 };
    const now = new Date().getTime();

    keys.forEach(key => {
        const p = state.masterData[key];
        // Calculate stats based on VISIBLE records (matching user filters)
        // Note: If you want stats to ALWAYS be "active only" regardless of view, use isPersonActive(p).
        // Current logic: Stats reflect exactly what is in the filtered list.
        
        if (!p.Timeline || p.Timeline.length === 0) return;

        count++; 
        // Optimization: Use cached pay and status
        const salary = p._totalPay;
        if (salary > 0) salaries.push(salary);
        if (p._isUnclass) unclassified++; else classified++;

        const org = personOrg(p) || 'Unknown';
        orgs[org] = (orgs[org] || 0) + 1;
        
        const lastSnap = p.Timeline[p.Timeline.length - 1];
        const lastJob = (lastSnap.Jobs && lastSnap.Jobs.length > 0) ? lastSnap.Jobs[0] : {};
        const role = lastJob['Job Title'] || 'Unknown';
        roles[role] = (roles[role] || 0) + 1;

        // Optimization: Use pre-parsed _hiredDateTs
        const hiredTs = p._hiredDateTs;
        if (hiredTs) {
            const years = (now - hiredTs) / MS_PER_YEAR;
            if (years < 2) tenure.t0_2++;
            else if (years < 5) tenure.t2_5++;
            else if (years < 10) tenure.t5_10++;
            else tenure.t10_plus++;
        }
    });

    salaries.sort((a, b) => a - b);
    let median = 0;
    if (salaries.length > 0) {
        const mid = Math.floor(salaries.length / 2);
        median = salaries.length % 2 !== 0 ? salaries[mid] : (salaries[mid - 1] + salaries[mid]) / 2;
    }

    return { 
        count, 
        medianSalary: median, 
        classified, 
        unclassified, 
        topOrgs: Object.entries(orgs).sort((a, b) => b[1] - a[1]).slice(0, 5), 
        topRoles: Object.entries(roles).sort((a, b) => b[1] - a[1]).slice(0, 4), 
        tenure 
    };
}

function updateDashboard(stats) {
    els.dashboard.classList.remove('hidden');
    els.statTotal.textContent = stats.count.toLocaleString();
    els.statMedian.textContent = formatMoney(stats.medianSalary);

    const totalTypes = stats.classified + stats.unclassified;
    const classPct = totalTypes ? (stats.classified / totalTypes) * 100 : 0;
    const unclassPct = totalTypes ? (stats.unclassified / totalTypes) * 100 : 0;
    els.barClassified.style.width = `${classPct}%`;
    els.barUnclassified.style.width = `${unclassPct}%`;
    els.countClassified.textContent = stats.classified.toLocaleString();
    els.countUnclassified.textContent = stats.unclassified.toLocaleString();

    const tTotal = stats.tenure.t0_2 + stats.tenure.t2_5 + stats.tenure.t5_10 + stats.tenure.t10_plus || 1;
    els.tenureChart.innerHTML = `
        <div class="tenure-seg t1" style="width:${(stats.tenure.t0_2 / tTotal) * 100}%" data-tooltip="< 2 Years: ${stats.tenure.t0_2}"></div>
        <div class="tenure-seg t2" style="width:${(stats.tenure.t2_5 / tTotal) * 100}%" data-tooltip="2-5 Years: ${stats.tenure.t2_5}"></div>
        <div class="tenure-seg t3" style="width:${(stats.tenure.t5_10 / tTotal) * 100}%" data-tooltip="5-10 Years: ${stats.tenure.t5_10}"></div>
        <div class="tenure-seg t4" style="width:${(stats.tenure.t10_plus / tTotal) * 100}%" data-tooltip="10+ Years: ${stats.tenure.t10_plus}"></div>
    `;

    const maxCount = stats.topOrgs[0] ? stats.topOrgs[0][1] : 1;
    els.orgLeaderboard.innerHTML = stats.topOrgs.map(([name, count]) => `
        <div class="lb-row"><div class="lb-label" data-tooltip="${name}">${name}</div>
        <div class="lb-bar-container"><div class="lb-bar" style="width: ${(count/maxCount)*100}%"></div><div class="lb-val">${count}</div></div></div>
    `).join('');

    updateDonut(stats.topRoles, stats.count);
}

function updateDonut(roles, total) {
    if (!roles.length) return;
    const colors = ['#D73F09', '#b83508', '#992c06', '#7a2205', '#444444'];
    let currentDeg = 0, gradientParts = [], otherCount = total;

    roles.forEach(([role, count], idx) => {
        const deg = (count / total) * 360;
        gradientParts.push(`${colors[idx]} ${currentDeg}deg ${currentDeg + deg}deg`);
        currentDeg += deg;
        otherCount -= count;
    });
    if (otherCount > 0) gradientParts.push(`${colors[4]} ${currentDeg}deg 360deg`);

    els.roleDonut.style.background = `conic-gradient(${gradientParts.join(', ')})`;
    els.roleLegend.innerHTML = roles.map(([role, count], idx) => `
        <div class="legend-item"><span class="dot" style="background:${colors[idx]}"></span> ${role} (${Math.round(count/total*100)}%)</div>
    `).join('') + (otherCount > 0 ? `<div class="legend-item"><span class="dot" style="background:${colors[4]}"></span> Other (${Math.round(otherCount/total*100)}%)</div>` : '');
}

function personOrg(p) {
    if (p.Meta['Home Orgn']) return p.Meta['Home Orgn'];
    if (p.Timeline && p.Timeline.length > 0) {
        const lastSnap = p.Timeline[p.Timeline.length - 1];
        if (lastSnap.Jobs && lastSnap.Jobs.length > 0) return lastSnap.Jobs[0]['Job Orgn'];
    }
    return null;
}

// ==========================================
// CARD GENERATION
// ==========================================
function generateCardHTML(name, idx) {
    const person = state.masterData[name];
    if (!person.Timeline || person.Timeline.length === 0) return '';
    
    const lastSnapshot = person.Timeline[person.Timeline.length - 1];
    const lastJob = (lastSnapshot.Jobs && lastSnapshot.Jobs.length > 0) ? lastSnapshot.Jobs[0] : {};
    
    const cardId = `card-${idx}`;
    const historyId = `history-${idx}`;
    const attrName = name.replace(/"/g, '&quot;');
    const totalPay = person._totalPay || 0;
    const reversedTimeline = person.Timeline.slice().reverse();

    const isLatest = isPersonActive(person);
    
    const badgeHTML = !isLatest ? `<span class="badge" style="background:#ef4444; color:white; margin-left:10px;">FORMER / INACTIVE</span>` : '';
    const reportHistoryHTML = person.Timeline.map(snap => `<span class="badge badge-source" style="margin-right:4px; margin-bottom:4px;">${snap.Date}</span>`).join('');

    return `
    <div class="card" id="${cardId}" data-name="${attrName}" style="${!isLatest ? 'opacity: 0.8;' : ''}">
        <div class="card-header" onclick="toggleCard('${cardId}')" onkeydown="handleCardKey(event, '${cardId}')" tabindex="0" role="button" aria-expanded="false" aria-controls="${historyId}">
            <div class="person-info">
                <div class="name-header">
                    <h2>${name} ${badgeHTML}</h2>
                    <button class="link-btn-card" data-linkname="${attrName}" onclick="copyLink(event, this.dataset.linkname)" aria-label="Copy link">🔗</button>
                </div>
                <p>Home Org: ${person.Meta["Home Orgn"] || 'N/A'}</p>
            </div>
            <div class="latest-stat">
                <div class="latest-salary" data-tooltip="Total calculated from all active appointments">${formatMoney(totalPay)}</div>
                <div class="latest-role">${lastJob['Job Title'] || 'Unknown'}</div>
            </div>
        </div>

        <div id="${historyId}" class="history" role="region" aria-label="Job History">
            <div class="history-meta" style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #444; font-size: 0.9rem; color: #a0a0a0;">
                <strong>Hired:</strong> ${formatDate(person.Meta["First Hired"])} &nbsp;&bull;&nbsp;
                <strong>Adj Service:</strong> ${formatDate(person.Meta["Adj Service Date"])}
            </div>
            <table>
                <thead><tr><th>Date & Source</th><th>Job Details</th><th>Type</th><th>Salary</th></tr></thead>
                <tbody>
                    ${reversedTimeline.map((snap, snapIdx) => {
                        const prevSnap = reversedTimeline[snapIdx + 1];
                        return (snap.Jobs || []).map(job => {
                            let diffHTML = '';
                            if (prevSnap && prevSnap.Jobs) {
                                const prevJob = prevSnap.Jobs.find(j => j['Posn-Suff'] === job['Posn-Suff']);
                                if (prevJob) {
                                    // Optimization: Use pre-parsed _rate
                                    const currRate = job._rate !== undefined ? job._rate : cleanMoney(job['Annual Salary Rate']);
                                    const prevRate = prevJob._rate !== undefined ? prevJob._rate : cleanMoney(prevJob['Annual Salary Rate']);
                                    const diff = currRate - prevRate;
                                    if (diff !== 0 && prevRate > 0) {
                                        const pct = (diff / prevRate) * 100;
                                        diffHTML = `<span class="diff-val ${diff > 0 ? 'diff-positive' : 'diff-negative'}">${diff > 0 ? '+' : ''}${formatMoney(diff)} (${diff > 0 ? '+' : ''}${pct.toFixed(1)}%)</span>`;
                                    }
                                }
                            }
                            return `<tr><td class="date-cell"><div>${formatDate(snap.Date)}</div><div class="badge badge-source">${(snap.Source || '').substring(0, 15)}...</div></td>
                                <td><div style="font-weight:600;">${job['Job Title'] || ''}</div><div style="font-size:0.85rem; color:#64748b;">${job['Job Orgn'] || ''}</div></td>
                                <td><span class="badge badge-type">${job['Job Type'] || '?'}</span></td>
                                <td class="money-cell">${formatMoney(job['Annual Salary Rate'])}${diffHTML}</td></tr>`;
                        }).join('')
                    }).join('')}
                </tbody>
            </table>
            
            <div class="personal-trend-section" style="margin-top: 20px; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                <div class="stat-label" style="font-size: 0.75rem; margin-bottom: 10px;">Individual Salary Trend</div>
                ${generateSparkline(person.Timeline)}
            </div>

            <div style="margin-top: 15px; border-top: 1px solid #444; padding-top: 10px;">
                <div style="font-size: 0.8rem; color: #888; margin-bottom: 5px;">Record appearances:</div>
                <div style="display: flex; flex-wrap: wrap;">${reportHistoryHTML}</div>
            </div>
        </div>
    </div>`;
}

// ==========================================
// RENDERING & HELPERS
// ==========================================
function renderInitial() {
    const keys = state.filteredKeys.slice(0, state.visibleCount);
    if (keys.length === 0) { els.results.innerHTML = `<p style="text-align:center; color:#888;">No matching records found.</p>`; return; }
    els.results.innerHTML = keys.map((name, idx) => generateCardHTML(name, idx)).join('') + getSentinel();
    observeSentinel();
}

function appendNextBatch() {
    const startIdx = state.visibleCount;
    const endIdx = Math.min(startIdx + state.batchSize, state.filteredKeys.length);
    if (startIdx >= state.filteredKeys.length) return;
    const html = state.filteredKeys.slice(startIdx, endIdx).map((name, idx) => generateCardHTML(name, startIdx + idx)).join('');
    document.getElementById('scroll-sentinel')?.remove();
    els.results.insertAdjacentHTML('beforeend', html + getSentinel());
    state.visibleCount = endIdx;
    observeSentinel();
}

const getSentinel = () => `<div id="scroll-sentinel" class="loader-sentinel">${state.visibleCount < state.filteredKeys.length ? 'Loading more...' : 'End of results'}</div>`;
function updateStats() { els.stats.innerHTML = `Found ${state.filteredKeys.length} matching personnel records.`; }
function toggleCard(id) { const el = document.getElementById(id); if(el) { el.classList.toggle('expanded'); el.querySelector('.card-header')?.setAttribute('aria-expanded', el.classList.contains('expanded')); } }
window.handleCardKey = function(e, id) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(id); } };

let observer;
function setupInfiniteScroll() {
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if (entry.isIntersecting && state.visibleCount < state.filteredKeys.length) appendNextBatch(); });
    }, { root: null, rootMargin: '100px', threshold: 0.1 });
}
function observeSentinel() { const s = document.getElementById('scroll-sentinel'); if (s && observer) observer.observe(s); }

function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }
const handleSearch = debounce(() => { state.filters.text = els.searchInput.value; runSearch(); }, 300);

els.searchInput.addEventListener('input', (e) => { els.clearBtn.classList.toggle('hidden', !e.target.value); handleSearch(); });
els.clearBtn.addEventListener('click', () => { els.searchInput.value = ''; els.clearBtn.classList.add('hidden'); state.filters.text = ''; runSearch(); els.searchInput.focus(); });
els.typeSelect.addEventListener('change', (e) => { state.filters.type = e.target.value; runSearch(); });
els.roleInput.addEventListener('input', debounce((e) => { state.filters.role = e.target.value; runSearch(); }, 300));
els.salaryMin.addEventListener('input', debounce((e) => { state.filters.minSalary = parseFloat(e.target.value) || null; runSearch(); }, 300));
els.salaryMax.addEventListener('input', debounce((e) => { state.filters.maxSalary = parseFloat(e.target.value) || null; runSearch(); }, 300));
els.inactiveToggle.addEventListener('change', (e) => { state.filters.showInactive = e.target.checked; runSearch(); });
els.sortSelect.addEventListener('change', (e) => { state.filters.sort = e.target.value; runSearch(); });
els.fteToggle.addEventListener('change', (e) => { state.filters.fullTimeOnly = e.target.checked; runSearch(); });

function setupTooltips() {
    const tooltipEl = document.getElementById('custom-tooltip');
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) { tooltipEl.textContent = target.getAttribute('data-tooltip'); tooltipEl.classList.remove('hidden'); }
    });
    document.addEventListener('mousemove', (e) => {
        if (!tooltipEl.classList.contains('hidden')) {
            tooltipEl.style.left = `${Math.min(e.clientX + 10, window.innerWidth - tooltipEl.offsetWidth - 20)}px`;
            tooltipEl.style.top = `${Math.min(e.clientY + 10, window.innerHeight - tooltipEl.offsetHeight - 20)}px`;
        }
    });
    document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tooltip]')) tooltipEl.classList.add('hidden'); });
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('info-modal');
    if (modal) {
        document.getElementById('info-btn').addEventListener('click', () => modal.classList.remove('hidden'));
        document.getElementById('close-modal').addEventListener('click', () => modal.classList.add('hidden'));
        window.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.add('hidden'); });
        document.querySelectorAll('.collapsible-btn').forEach(btn => btn.addEventListener('click', () => {
            btn.setAttribute('aria-expanded', !(btn.getAttribute('aria-expanded') === 'true'));
            btn.nextElementSibling.classList.toggle('hidden');
        }));
    }
});

function parseUrlParams() {
    const name = new URLSearchParams(window.location.search).get('name');
    if (name) { state.filters.text = name; els.searchInput.value = name; els.clearBtn.classList.remove('hidden'); return name; }
    return null;
}
function autoExpandTarget(name) {
    const card = document.querySelector(`.card[data-name="${name.replace(/"/g, '\\"')}"]`);
    if (card) { card.classList.add('expanded'); setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }
}
function copyLink(e, name) {
    e.stopPropagation();
    const url = new URL(window.location.href); url.searchParams.set('name', name);
    window.history.pushState({ path: url.href }, '', url.href);
    navigator.clipboard.writeText(url.href).then(() => showToast(`Link copied for ${name}`)).catch(console.error);
}
function showToast(msg) {
    let t = document.getElementById('toast-notification');
    if (!t) { t = document.createElement('div'); t.id = 'toast-notification'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
}

function renderSuggestedSearches() {
    if (!els.suggestedSearches) return;
    els.suggestedSearches.innerHTML = ['Professor', 'Athletics', 'Physics', 'Coach', 'Dean'].map(term =>
        `<button class="chip" onclick="applySearch('${term}')">${term}</button>`
    ).join('');
}