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
    statGap: document.getElementById('stat-gap'),
    statGapRange: document.getElementById('stat-gap-range'),
    barClassified: document.getElementById('bar-classified'),
    barUnclassified: document.getElementById('bar-unclassified'),
    countClassified: document.getElementById('count-classified'),
    countUnclassified: document.getElementById('count-unclassified')
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

    keys.forEach(key => {
        const p = state.masterData[key];
        const lastSnap = p.Timeline[p.Timeline.length - 1];
        const lastJob = lastSnap.Jobs[0] || {};
        const salary = cleanMoney(lastJob['Annual Salary Rate']);

        if (salary > 0) {
            if (salary < min) min = salary;
            if (salary > max) max = salary;
        }

        // Classification based on source file name
        const src = lastSnap.Source.toLowerCase();
        if (src.includes('unclass')) {
            unclassified++;
        } else {
            classified++;
        }
    });

    if (min === Infinity) min = 0;
    if (max === -Infinity) max = 0;

    return { count: keys.length, min, max, classified, unclassified };
}

function updateDashboard(stats) {
    els.dashboard.classList.remove('hidden');
    els.statTotal.textContent = stats.count.toLocaleString();
    els.statGap.textContent = formatMoney(stats.max - stats.min);
    els.statGapRange.textContent = `${formatMoney(stats.min)} - ${formatMoney(stats.max)}`;

    const totalTypes = stats.classified + stats.unclassified;
    const classPct = totalTypes ? (stats.classified / totalTypes) * 100 : 0;
    const unclassPct = totalTypes ? (stats.unclassified / totalTypes) * 100 : 0;

    els.barClassified.style.width = `${classPct}%`;
    els.barUnclassified.style.width = `${unclassPct}%`;
    els.countClassified.textContent = stats.classified.toLocaleString();
    els.countUnclassified.textContent = stats.unclassified.toLocaleString();
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
