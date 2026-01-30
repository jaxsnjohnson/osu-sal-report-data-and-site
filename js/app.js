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

// Utility: Calculate total pay for the latest snapshot
const getPersonTotalPay = (person) => {
    if (!person || !person.Timeline || person.Timeline.length === 0) return 0;

    const lastSnapshot = person.Timeline[person.Timeline.length - 1];
    if (!lastSnapshot.Jobs) return 0;

    let total = 0;
    lastSnapshot.Jobs.forEach(job => {
        const rate = cleanMoney(job['Annual Salary Rate']);
        // Parse Appt Percent, default to 100 if missing or invalid, then divide by 100
        let pct = parseFloat(job['Appt Percent']);
        if (isNaN(pct)) pct = 0;

        if (rate > 0) {
             total += rate * (pct / 100);
        }
    });
    return total;
};

// Utility: Format date nicely
const formatDate = (dateStr) => {
    if (!dateStr || dateStr === "Unknown Date") return dateStr;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        // Handle YYYY-MM-DD
        if (parts[0].length === 4) {
            return `${parts[1]}/${parts[2]}/${parts[0]}`;
        }
        // Handle DD-MON-YYYY (return as is, e.g., 01-AUG-2022)
        return dateStr;
    }
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
    clearBtn: document.getElementById('clear-search'),
    typeSelect: document.getElementById('type-filter'),
    roleInput: document.getElementById('role-filter'),
    salaryMin: document.getElementById('salary-min'),
    salaryMax: document.getElementById('salary-max'),
    suggestedSearches: document.getElementById('suggested-searches'),
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
    roleLegend: document.getElementById('role-legend')
};

// Initialization
fetch('data.json')
    .then(res => res.json())
    .then(data => {
        // Pre-compute search strings for performance
        Object.keys(data).forEach(key => {
            const p = data[key];
            const lastSnap = p.Timeline[p.Timeline.length - 1];
            const lastJob = (lastSnap && lastSnap.Jobs.length > 0) ? lastSnap.Jobs[0] : {};
            const role = lastJob['Job Title'] || '';
            const jobOrg = lastJob['Job Orgn'] || '';

            p._searchStr = (key + " " + JSON.stringify(p.Meta) + " " + role + " " + jobOrg).toLowerCase();
        });

        state.masterData = data;
        state.masterKeys = Object.keys(data).sort();

        populateRoleOptions(data);
        renderSuggestedSearches();

        // Check for deep link before first render
        const targetName = parseUrlParams();

        runSearch(); // Initial render
        updateStats();
        setupInfiniteScroll();

        if (targetName) {
            autoExpandTarget(targetName);
        }

        setupTooltips();
    })
    .catch(err => {
        els.stats.innerHTML = "Error loading data.json.";
        console.error(err);
    });

function setupTooltips() {
    const tooltipEl = document.getElementById('custom-tooltip');

    document.addEventListener('mouseover', (e) => {
        // Traverse up to find data-tooltip (in case of nested spans)
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            tooltipEl.textContent = target.getAttribute('data-tooltip');
            tooltipEl.classList.remove('hidden');
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!tooltipEl.classList.contains('hidden')) {
            // Add offset to avoid covering cursor
            const x = e.clientX + 10;
            const y = e.clientY + 10;

            // Boundary check (basic)
            const rightEdge = window.innerWidth - tooltipEl.offsetWidth - 20;
            const bottomEdge = window.innerHeight - tooltipEl.offsetHeight - 20;

            tooltipEl.style.left = `${Math.min(x, rightEdge)}px`;
            tooltipEl.style.top = `${Math.min(y, bottomEdge)}px`;
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            tooltipEl.classList.add('hidden');
        }
    });
}

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

function renderSuggestedSearches() {
    if (!els.suggestedSearches) return;

    const suggestions = ['Professor', 'Athletics', 'Physics', 'Coach', 'Dean'];
    els.suggestedSearches.innerHTML = suggestions.map(term =>
        `<button class="chip" onclick="applySearch('${term}')">${term}</button>`
    ).join('');
}

// Exposed globally so onclick works
window.applySearch = function(term) {
    els.searchInput.value = term;
    state.filters.text = term;
    els.clearBtn.classList.remove('hidden');
    runSearch();
};

// Search Logic
function runSearch() {
    const term = state.filters.text.toLowerCase();
    const typeFilter = state.filters.type;
    const roleFilter = state.filters.role.toLowerCase();
    const { minSalary, maxSalary } = state.filters;

    state.filteredKeys = state.masterKeys.filter(name => {
        const person = state.masterData[name];

        // 1. Text Match (Name, Org)
        // Optimization: Use pre-computed search string to avoid repeated JSON.stringify
        if (!person._searchStr.includes(term)) return false;

        // 2. Type Match (Classified / Unclassified)
        if (typeFilter !== 'all') {
            const lastSnap = person.Timeline[person.Timeline.length - 1];
            if (!lastSnap) return false;

            const src = lastSnap.Source.toLowerCase();
            const isUnclass = src.includes('unclass');

            if (typeFilter === 'unclassified') {
                if (!isUnclass) return false;
            } else if (typeFilter === 'classified') {
                if (!src.includes('class') || isUnclass) return false;
            }
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
            const salary = getPersonTotalPay(person);

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
        const salary = getPersonTotalPay(p);

        // Salary Stats
        if (salary > 0) {
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

    // Median Salary
    salaries.sort((a, b) => a - b);
    let median = 0;
    if (salaries.length > 0) {
        const mid = Math.floor(salaries.length / 2);
        median = salaries.length % 2 !== 0 ? salaries[mid] : (salaries[mid - 1] + salaries[mid]) / 2;
    }

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
        medianSalary: median,
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
    els.statMedian.textContent = formatMoney(stats.medianSalary);

    // Classification
    const totalTypes = stats.classified + stats.unclassified;
    const classPct = totalTypes ? (stats.classified / totalTypes) * 100 : 0;
    const unclassPct = totalTypes ? (stats.unclassified / totalTypes) * 100 : 0;
    els.barClassified.style.width = `${classPct}%`;
    els.barUnclassified.style.width = `${unclassPct}%`;
    els.barClassified.setAttribute('data-tooltip', `Classified: ${stats.classified.toLocaleString()} (${Math.round(classPct)}%)`);
    els.barUnclassified.setAttribute('data-tooltip', `Unclassified: ${stats.unclassified.toLocaleString()} (${Math.round(unclassPct)}%)`);
    els.barClassified.removeAttribute('title');
    els.barUnclassified.removeAttribute('title');
    els.countClassified.textContent = stats.classified.toLocaleString();
    els.countUnclassified.textContent = stats.unclassified.toLocaleString();

    // Tenure Chart
    const tTotal = stats.tenure.t0_2 + stats.tenure.t2_5 + stats.tenure.t5_10 + stats.tenure.t10_plus || 1;
    const tPcts = [
        (stats.tenure.t0_2 / tTotal) * 100,
        (stats.tenure.t2_5 / tTotal) * 100,
        (stats.tenure.t5_10 / tTotal) * 100,
        (stats.tenure.t10_plus / tTotal) * 100
    ];

    els.tenureChart.innerHTML = `
        <div class="tenure-seg t1" style="width:${tPcts[0]}%" data-tooltip="< 2 Years: ${stats.tenure.t0_2}"></div>
        <div class="tenure-seg t2" style="width:${tPcts[1]}%" data-tooltip="2-5 Years: ${stats.tenure.t2_5}"></div>
        <div class="tenure-seg t3" style="width:${tPcts[2]}%" data-tooltip="5-10 Years: ${stats.tenure.t5_10}"></div>
        <div class="tenure-seg t4" style="width:${tPcts[3]}%" data-tooltip="10+ Years: ${stats.tenure.t10_plus}"></div>
    `;

    // Leaderboard
    const maxCount = stats.topOrgs[0] ? stats.topOrgs[0][1] : 1;
    els.orgLeaderboard.innerHTML = stats.topOrgs.map(([name, count]) => `
        <div class="lb-row">
            <div class="lb-label" data-tooltip="${name}">${name}</div>
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
    els.roleDonut.setAttribute('data-tooltip', roles.map(([r, c]) => `${r}: ${c} (${Math.round(c/total*100)}%)`).join('\n'));
    els.roleDonut.removeAttribute('title');

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
    const historyId = `history-${idx}`;
    const safeName = name.replace(/'/g, "\\'"); // For JS string
    const attrName = name.replace(/"/g, '&quot;'); // For HTML attribute

    const totalPay = getPersonTotalPay(person);

    const reversedTimeline = person.Timeline.slice().reverse();

    return `
    <div class="card" id="${cardId}" data-name="${attrName}">
        <div class="card-header" onclick="toggleCard('${cardId}')" onkeydown="handleCardKey(event, '${cardId}')" tabindex="0" role="button" aria-expanded="false" aria-controls="${historyId}">
            <div class="person-info">
                <div class="name-header">
                    <h2>${name}</h2>
                    <button class="link-btn-card" data-linkname="${attrName}" onclick="copyLink(event, this.dataset.linkname)" aria-label="Copy link to ${attrName}" data-tooltip="Copy Link">
                        🔗
                    </button>
                </div>
                <p>Home Org: ${person.Meta["Home Orgn"] || 'N/A'}</p>
            </div>
            <div class="latest-stat">
                <div class="latest-salary" data-tooltip="Total calculated from all active appointments">
                    ${formatMoney(totalPay)}
                </div>
                <div class="latest-role">${lastJob['Job Title'] || 'Unknown'}</div>
            </div>
        </div>

        <div id="${historyId}" class="history" role="region" aria-label="Job History">
            <div class="history-meta" style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #444; font-size: 0.9rem; color: #a0a0a0;">
                <strong>Hired:</strong> ${formatDate(person.Meta["First Hired"])} &nbsp;&bull;&nbsp;
                <strong>Adj Service:</strong> ${formatDate(person.Meta["Adj Service Date"])}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Date & Source</th>
                        <th>Job Details</th>
                        <th><span class="help-cursor" data-tooltip="Job Classification Code">Type</span></th>
                        <th><span class="help-cursor" data-tooltip="Annual Salary Rate (Base Pay)">Salary</span></th>
                    </tr>
                </thead>
                <tbody>
                    ${reversedTimeline.map((snap, snapIdx) => {
                        // Find previous snapshot (which is next in reversed array)
                        const prevSnap = reversedTimeline[snapIdx + 1];

                        return snap.Jobs.map(job => {
                            let diffHTML = '';
                            if (prevSnap) {
                                const prevJob = prevSnap.Jobs.find(j => j['Posn-Suff'] === job['Posn-Suff']);
                                if (prevJob) {
                                    const currRate = cleanMoney(job['Annual Salary Rate']);
                                    const prevRate = cleanMoney(prevJob['Annual Salary Rate']);
                                    const diff = currRate - prevRate;

                                    if (diff !== 0 && prevRate > 0) {
                                        const pct = (diff / prevRate) * 100;
                                        const sign = diff > 0 ? '+' : '';
                                        const colorClass = diff > 0 ? 'diff-positive' : 'diff-negative';
                                        diffHTML = `<span class="diff-val ${colorClass}">${sign}${formatMoney(diff)} (${sign}${pct.toFixed(1)}%)</span>`;
                                    }
                                }
                            }

                            return `
                            <tr>
                                <td class="date-cell">
                                    <div>${formatDate(snap.Date)}</div>
                                    <div class="badge badge-source">${snap.Source.replace('.txt','').substring(0, 15)}...</div>
                                </td>
                                <td>
                                    <div style="font-weight:600;">${job['Job Title'] || ''}</div>
                                    <div style="font-size:0.85rem; color:#64748b;">${job['Job Orgn'] || ''}</div>
                                    <div class="job-meta-grid" style="font-size: 0.8rem; color: #475569; margin-top: 4px; line-height: 1.4;">
                                        ${job['Rank'] && job['Rank'] !== 'No Rank' ? `<div><span class="help-cursor" data-tooltip="Academic or Administrative Rank">Rank: ${job['Rank']}</span> (Eff: ${formatDate(job['Rank Effective Date'])})</div>` : ''}
                                        <div>
                                            <span class="help-cursor" data-tooltip="Position Number - Suffix">Pos: ${job['Posn-Suff'] || 'N/A'}</span>
                                            ${job['Appt Percent'] ? `| <span class="help-cursor" data-tooltip="Appointment Percent (FTE)">Appt: ${job['Appt Percent']}%</span>` : ''}
                                        </div>
                                        <div>
                                            Dates: ${formatDate(job['Appt Begin Date'])} - ${job['Appt End Date'] ? formatDate(job['Appt End Date']) : 'Present'}
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <span class="badge badge-type" data-tooltip="Job Type Code">${job['Job Type'] || '?'}</span>
                                </td>
                                <td class="money-cell">
                                    ${formatMoney(job['Annual Salary Rate'])}
                                    ${job['Salary Term'] ? `<span class="term-badge">${job['Salary Term']}</span>` : ''}
                                    ${diffHTML}
                                </td>
                            </tr>
                        `}).join('')
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
    if(el) {
        el.classList.toggle('expanded');
        const header = el.querySelector('.card-header');
        if (header) {
            header.setAttribute('aria-expanded', el.classList.contains('expanded'));
        }
    }
}

window.handleCardKey = function(e, id) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCard(id);
    }
};

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
const handleSearch = debounce(() => {
    state.filters.text = els.searchInput.value;
    runSearch();
}, 300);

els.searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val) els.clearBtn.classList.remove('hidden');
    else els.clearBtn.classList.add('hidden');
    handleSearch();
});

els.clearBtn.addEventListener('click', () => {
    els.searchInput.value = '';
    els.clearBtn.classList.add('hidden');
    state.filters.text = '';
    runSearch();
    els.searchInput.focus();
});

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
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('info-modal');
    const infoBtn = document.getElementById('info-btn');
    const closeBtn = document.getElementById('close-modal');

    if (infoBtn && modal && closeBtn) {
        infoBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            closeBtn.focus();
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            infoBtn.focus();
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
                infoBtn.focus();
            }
        });

        // Collapsible Sections in Modal
        const collapseBtns = modal.querySelectorAll('.collapsible-btn');
        collapseBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const isExpanded = btn.getAttribute('aria-expanded') === 'true';
                btn.setAttribute('aria-expanded', !isExpanded);

                // Toggle content visibility
                const content = btn.nextElementSibling;
                if (content && content.classList.contains('collapsible-content')) {
                    content.classList.toggle('hidden');
                }
            });
        });
    }
});

// Ctrl+F Trap
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        els.searchInput.focus();
    }
});

// Deep Linking & Sharing
function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) {
        state.filters.text = name;
        els.searchInput.value = name;
        els.clearBtn.classList.remove('hidden');
        return name;
    }
    return null;
}

function autoExpandTarget(name) {
    // Find the card with data-name matching the target
    // Note: escape double quotes for the selector
    const selector = `.card[data-name="${name.replace(/"/g, '\\"')}"]`;
    const card = document.querySelector(selector);
    if (card) {
        card.classList.add('expanded');
        setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

function copyLink(e, name) {
    e.stopPropagation(); // Prevent card expansion

    const url = new URL(window.location.href);
    url.searchParams.set('name', name);

    // Update browser history without reload
    window.history.pushState({ path: url.href }, '', url.href);

    navigator.clipboard.writeText(url.href).then(() => {
        showToast(`Link copied for ${name}`);
    }).catch(err => {
        console.error('Failed to copy link', err);
        showToast('Failed to copy link');
    });
}

function showToast(msg) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.textContent = msg;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
