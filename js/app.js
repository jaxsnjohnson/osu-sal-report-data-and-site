// ==========================================
// UTILITIES
// ==========================================

const formatMoney = (amount) => {
    if (!amount && amount !== 0) return '-';
    const num = parseFloat(amount.toString().replace(/[^0-9.-]+/g, ''));
    if (isNaN(num)) return amount;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
};

const formatHourlyMoney = (amount) => {
    if (!amount && amount !== 0) return '-';
    const num = parseFloat(amount.toString().replace(/[^0-9.-]+/g, ''));
    if (isNaN(num)) return amount;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

const cleanMoney = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const cleanStr = val.toString().replace(/[^0-9.-]+/g, '');
    return parseFloat(cleanStr) || 0;
};

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;
const MIN_TREND_YEARS = 3;

const COLA_EVENTS = [
    { label: '6.5% COLA', effective: '2024-04-01', pct: 6.5 },
    { label: '2% COLA', effective: '2024-11-01', pct: 2.0 },
    { label: '3.5% COLA', effective: '2025-06-01', pct: 3.5 }
];

const DATA_INDEX_URL = 'data/index.json';
const DATA_AGG_URL = 'data/aggregates.json';
const DATA_SEARCH_URL = 'data/search-index.json';
const DATA_BUCKET_DIR = 'data/people';
const SEARCH_ANALYTICS_MAX_QUERY_LEN = 120;
const SEARCH_EVENT_MIN_INTERVAL_MS = 1200;
const ANALYTICS_EVENT_VERSION = 2;
const TRANSITION_BUCKET_LOAD_CONCURRENCY = 6;

const getInflationMap = () => window.INFLATION_INDEX_BY_MONTH || {};
const getInflationBaseMonth = () => window.INFLATION_BASE_MONTH || '';

const hasInflationData = () => {
    const map = getInflationMap();
    const base = getInflationBaseMonth();
    return !!(base && map[base] && Object.keys(map).length > 0);
};

const formatDate = (dateStr) => {
    if (!dateStr || dateStr === "Unknown Date") return dateStr;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        if (parts[0].length === 4) return `${parts[1]}/${parts[2]}/${parts[0]}`; 
        return dateStr;
    }
    return dateStr;
};

const escapeForSingleQuote = (value) => {
    if (value === null || value === undefined) return '';
    return value.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

const escapeHtmlAttr = (value) => {
    if (value === null || value === undefined) return '';
    return value.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
};

const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return value.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const highlightText = (text, terms) => {
    const raw = (text || '').toString();
    const safeTerms = (terms || [])
        .map(t => (t || '').toString().trim())
        .filter(Boolean)
        .filter(t => t.length > 1)
        .slice(0, 12);
    if (!safeTerms.length) return escapeHtml(raw);
    const pattern = safeTerms.map(escapeRegex).join('|');
    if (!pattern) return escapeHtml(raw);
    const regex = new RegExp(`(${pattern})`, 'ig');
    return raw.split(regex).map((part, idx) => {
        if (idx % 2 === 1) return `<mark class="search-hit">${escapeHtml(part)}</mark>`;
        return escapeHtml(part);
    }).join('');
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

const bucketForName = (name) => {
    if (!name) return '_';
    const ch = name.trim().charAt(0).toLowerCase();
    return (ch >= 'a' && ch <= 'z') ? ch : '_';
};

const getBucketUrl = (bucket) => `${DATA_BUCKET_DIR}/${bucket}.json`;

const loadBucket = (bucket) => {
    if (state.bucketCache[bucket]) return Promise.resolve(state.bucketCache[bucket]);
    if (state.bucketPromises[bucket]) return state.bucketPromises[bucket];
    const url = getBucketUrl(bucket);
    state.bucketPromises[bucket] = fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`Failed to load ${url}`);
            return res.json();
        })
        .then(data => {
            state.bucketCache[bucket] = data;
            return data;
        })
        .finally(() => {
            delete state.bucketPromises[bucket];
        });
    return state.bucketPromises[bucket];
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

const hydratePersonDetail = (person) => {
    if (!person || person._hydrated) return;
    if (!person.Timeline || person.Timeline.length === 0) {
        person._hydrated = true;
        return;
    }

    person._snapByDate = {};
    person.Timeline.sort((a, b) => (a.Date || "").localeCompare(b.Date || ""));
    const dateTsCache = new Map();

    person.Timeline.forEach(snap => {
        if (snap.Date) person._snapByDate[snap.Date] = snap;
        if (snap.Jobs) {
            snap.Jobs.forEach(job => {
                const rawRate = job['Annual Salary Rate'];
                const rateNum = parseFloat(rawRate);
                const term = (job['Salary Term'] || '').trim();
                if (term === 'mo' && !isNaN(rateNum) && rateNum > 0 && rateNum <= 12) {
                    job._missingRate = true;
                    job._rate = 0;
                    job['Salary Term'] = `${rateNum} mo`;
                    job['Annual Salary Rate'] = '';
                } else {
                    job._missingRate = false;
                    if (job._rate === undefined) {
                        job._rate = rateNum || 0;
                    }
                }

                if (job._pct === undefined) {
                    job._pct = parseFloat(job['Appt Percent']);
                    if (isNaN(job._pct)) job._pct = 0;
                }
            });
        }

        snap._pay = calculateSnapshotPay(snap);
        const dateStr = snap.Date;
        let ts = dateTsCache.get(dateStr);
        if (ts === undefined) {
            ts = new Date(dateStr).getTime();
            dateTsCache.set(dateStr, ts);
        }
        snap._ts = ts;
    });

    const lastIdx = person.Timeline.length - 1;
    const lastSnap = person.Timeline[lastIdx];
    const lastJob = (lastSnap.Jobs && lastSnap.Jobs.length > 0) ? lastSnap.Jobs[0] : {};
    person._lastSnapshot = lastSnap;
    person._lastJob = lastJob;
    person._totalPay = lastSnap._pay || calculateSnapshotPay(lastSnap);
    person._payMissing = (lastSnap.Jobs || []).some(j => j._missingRate);
    person._lastDate = lastSnap.Date;
    person._isUnclass = (lastSnap.Source || "").toLowerCase().includes('unclass');
    person._isFullTime = false;
    if (lastSnap.Jobs && lastSnap.Jobs.length > 0) {
        person._isFullTime = lastSnap.Jobs.some(job => (job._pct !== undefined ? job._pct : parseFloat(job['Appt Percent'])) >= 100);
    }

    person._hydrated = true;
};

// Compute the first classified -> unclassified transition timestamp for a person, if any.
const getExclusionTransitionTs = (person) => {
    if (!person || !person._wasExcluded || !person.Timeline || person.Timeline.length < 2) return null;
    // Ensure timeline is sorted by date ascending (hydratePersonDetail already sorts)
    const timeline = person.Timeline;
    let sawClassified = false;
    for (let i = 0; i < timeline.length; i++) {
        const snap = timeline[i];
        const src = (snap.Source || '').toLowerCase();
        const isUnclass = src.includes('unclass');
        const isClassified = src.includes('class') && !isUnclass;
        if (isClassified) sawClassified = true;
        if (isUnclass && sawClassified) {
            const ts = new Date(snap.Date).getTime();
            return isNaN(ts) ? null : ts;
        }
    }
    return null;
};

// Load exclusion transition timestamps for all excluded people (uses detail buckets lazily).
const computeExclusionTransitions = () => {
    if (state.exclusionTransitionsReady) return Promise.resolve();

    const excludedKeys = state.masterKeys.filter(name => {
        const p = state.masterData[name];
        return p && p._wasExcluded;
    });

    const tasks = excludedKeys.map(name =>
        loadPersonDetail(name).then(person => {
            if (!person) return;
            if (person._exclusionDate) {
                const tsPre = new Date(person._exclusionDate).getTime();
                if (!isNaN(tsPre)) {
                    state.exclusionTransitionMap[name] = tsPre;
                    return;
                }
            }
            const ts = getExclusionTransitionTs(person);
            if (ts) state.exclusionTransitionMap[name] = ts;
        })
    );

    return Promise.all(tasks).then(() => {
        state.exclusionTransitionsReady = true;
    });
};

const loadPersonDetail = (name) => {
    if (state.detailCache[name]) return Promise.resolve(state.detailCache[name]);
    const bucket = bucketForName(name);
    return loadBucket(bucket).then(bucketData => {
        const person = bucketData[name];
        if (!person) {
            state.detailCache[name] = null;
            return null;
        }
        // Bring over flags that are stored in masterData but absent in bucket files.
        const masterPerson = state.masterData[name];
        if (masterPerson && masterPerson._wasExcluded !== undefined) {
            person._wasExcluded = masterPerson._wasExcluded;
        }
        if (masterPerson && masterPerson._exclusionDate !== undefined) {
            person._exclusionDate = masterPerson._exclusionDate;
        }
        hydratePersonDetail(person);
        state.detailCache[name] = person;
        return person;
    });
};

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
    let prev = new Array(blen + 1);
    for (let j = 0; j <= blen; j++) prev[j] = j;
    for (let i = 1; i <= alen; i++) {
        const cur = [i];
        let rowMin = cur[0];
        for (let j = 1; j <= blen; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + cost
            );
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > maxDist) return maxDist + 1;
        prev = cur;
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

    // 1. Prefix matches (Score 0) using Binary Search
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

    // Optimization: If enough prefix matches, return early
    if (scored.length >= limit) {
        // Sort by length (shortest first)
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

    // 2. Substring & Fuzzy matches (Score 1 & 2+)
    // Iterate everything OUTSIDE the prefix range
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

const buildWorkerBaseKey = (names) => {
    if (!Array.isArray(names) || names.length === 0) return 'empty';
    return `${names.length}:${names[0]}:${names[names.length - 1]}`;
};

const initSearchWorker = () => {
    if (typeof Worker === 'undefined') return;
    try {
        const worker = new Worker('js/search-worker.js');
        state.searchWorker = worker;
        state.searchWorkerReady = false;
        state.searchWorkerErrored = false;

        worker.onmessage = (event) => {
            const msg = event.data || {};
            const id = msg.id;
            if (msg.type === 'ready') {
                state.searchWorkerReady = true;
                runSearch();
                return;
            }
            if (msg.type === 'error') {
                state.searchWorkerErrored = true;
                state.searchWorkerReady = false;
                if (id && state.searchPending.has(id)) {
                    const pending = state.searchPending.get(id);
                    state.searchPending.delete(id);
                    pending.reject(new Error(msg.message || 'Search worker error'));
                }
                return;
            }
            if (msg.type === 'result' && id && state.searchPending.has(id)) {
                const pending = state.searchPending.get(id);
                state.searchPending.delete(id);
                pending.resolve(msg.payload || {});
            }
        };

        worker.onerror = () => {
            state.searchWorkerErrored = true;
            state.searchWorkerReady = false;
        };

        const initId = `init:${Date.now()}`;
        worker.postMessage({ type: 'init', id: initId, payload: { url: DATA_SEARCH_URL } });
    } catch (err) {
        state.searchWorkerErrored = true;
        state.searchWorkerReady = false;
    }
};

const sendSearchToWorker = (payload) => {
    if (!state.searchWorker || !state.searchWorkerReady) {
        return Promise.reject(new Error('Search worker unavailable'));
    }
    const id = `search:${++state.searchRequestSeq}`;
    return new Promise((resolve, reject) => {
        state.searchPending.set(id, { resolve, reject });
        state.searchWorker.postMessage({ type: 'search', id, payload });
        setTimeout(() => {
            if (!state.searchPending.has(id)) return;
            state.searchPending.delete(id);
            reject(new Error('Search worker timeout'));
        }, 5000);
    });
};

const medianOf = (arr) => {
    if (!arr || arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const formatPct = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

const getMonthKey = (dateStr) => {
    if (!dateStr || dateStr.length < 7) return null;
    return dateStr.slice(0, 7);
};

const getInflationIndex = (dateStr) => {
    const map = getInflationMap();
    const monthKey = getMonthKey(dateStr);
    if (!monthKey) return null;
    if (map[monthKey]) return map[monthKey];

    let [year, month] = monthKey.split('-').map(Number);
    for (let i = 0; i < 24; i++) {
        month -= 1;
        if (month === 0) {
            month = 12;
            year -= 1;
        }
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (map[key]) return map[key];
    }
    return null;
};

const adjustForInflation = (amount, dateStr) => {
    const map = getInflationMap();
    const base = map[getInflationBaseMonth()];
    const idx = getInflationIndex(dateStr);
    if (!base || !idx) return amount;
    return amount * (base / idx);
};

const isPersonActive = (person) => {
    if (!person || !person._lastDate) return false;

    // Optimized: Use cached classification to avoid redundant string parsing
    const targetDate = person._isUnclass ? state.latestUnclassDate : state.latestClassDate;
    return !targetDate || person._lastDate === targetDate;
};

const getTimelineYears = (timeline) => {
    if (!timeline || timeline.length === 0) return 0;
    const startTime = timeline[0]._ts;
    const endTime = timeline[timeline.length - 1]._ts;
    if (!startTime || !endTime) return 0;
    return (endTime - startTime) / MS_PER_YEAR;
};

const calculateMovingAverage = (data, windowSize, accessor = (d) => d) => {
    const length = data.length;
    if (length === 0) return [];

    const maxWindow = Math.ceil(windowSize);
    if (maxWindow <= 0) return new Array(length).fill(NaN);

    const ma = new Array(length);
    if (maxWindow === 1) {
        for (let i = 0; i < length; i++) {
            ma[i] = accessor(data[i]);
        }
        return ma;
    }

    const bufferSize = Math.min(maxWindow, length);
    const buffer = new Array(bufferSize);
    let head = 0;
    let count = 0;
    let sum = 0;

    for (let i = 0; i < length; i++) {
        const val = accessor(data[i]);
        sum += val;

        if (count === bufferSize) {
            sum -= buffer[head];
        } else {
            count += 1;
        }

        buffer[head] = val;
        head += 1;
        if (head === bufferSize) head = 0;

        ma[i] = sum / count;
    }

    return ma;
};

const getChartOptions = ({ yTickCallback, legend = true, animation = true, xTickLimit } = {}) => {
    const xTicks = { color: '#888' };
    if (xTickLimit) xTicks.maxTicksLimit = xTickLimit;

    const yTicks = { color: '#888' };
    if (yTickCallback) yTicks.callback = yTickCallback;

    return {
        responsive: true,
        maintainAspectRatio: false,
        animation,
        plugins: {
            legend: { display: legend, labels: { color: '#ccc' } },
            tooltip: { mode: 'index', intersect: false }
        },
        scales: {
            x: { ticks: xTicks, grid: { color: '#333' } },
            y: { ticks: yTicks, grid: { color: '#333' } }
        }
    };
};

const getPersonTrendHTML = (timeline, chartId) => {
    if (!timeline || timeline.length === 0) return '';
    const yearsDiff = getTimelineYears(timeline);
    if (yearsDiff < MIN_TREND_YEARS) {
        return `
            <div class="trend-empty">
                ⚠️ History covers less than ${MIN_TREND_YEARS} years. Trend chart available for longer tenures only.
            </div>
        `;
    }
    const inflationReady = hasInflationData();
    const inflationTooltip = inflationReady ? '' : 'Inflation data not loaded yet.';
    const inflationSelect = inflationReady
        ? `
            <select class="trend-mode" data-chart-id="${chartId}" data-ready="true">
                <option value="off" selected>Inflation: Off</option>
                <option value="adjusted">Inflation: Adjusted (graph wide)</option>
                <option value="compare">Inflation: Adjusted (separate line)</option>
            </select>
        `
        : `
            <select class="trend-mode" data-chart-id="${chartId}" disabled data-tooltip="${inflationTooltip}">
                <option value="off" selected>Inflation: Off (data missing)</option>
            </select>
        `;
    return `
        <div class="trend-header">
            <div class="stat-label">Total Compensation Trend</div>
            <div class="trend-controls">
                ${inflationSelect}
                <label class="trend-toggle">
                    <input type="checkbox" class="gap-toggle-input" data-chart-id="${chartId}">
                    Missing data
                </label>
            </div>
        </div>
        <div class="person-chart-wrap">
            <canvas id="${chartId}" data-person-chart="true" role="img" aria-label="Total compensation trend"></canvas>
            <div class="trend-legend hidden">
                <span class="legend-item"><span class="legend-line missing"></span> Missing data</span>
            </div>
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
    classTransitions: [],
    latestClassDate: "",
    latestUnclassDate: "",
    snapshotDates: [],
    peerMedianMap: {},
    keyBuckets: {},
    personCharts: {},
    detailCache: {},
    bucketCache: {},
    bucketPromises: {},
    searchIndex: [],
    focusIndex: -1,
    historicalChartsRendered: false,
    exclusionTransitionMap: {},
    exclusionTransitionsReady: false,
    transitionChart: null,
    transitionMemberIndex: null,
    transitionIndexPromise: null,
    searchWorker: null,
    searchWorkerReady: false,
    searchWorkerErrored: false,
    searchRequestSeq: 0,
    searchRunToken: 0,
    searchPending: new Map(),
    lastSearchSuggestions: [],
    lastHighlightTerms: [],
    regexMode: false,
    searchWarning: '',
    autocompleteItems: [],
    autocompleteFocus: -1,
    analytics: {
        nextSearchSource: 'unknown',
        lastSearchSignature: '',
        lastSearchTs: 0
    },
    filters: {
        text: '',
        type: 'all',
        role: '',
        minSalary: null,
        maxSalary: null,
        showInactive: false,
        sort: 'name-asc',   // Default sort: A-Z
        fullTimeOnly: false, // Default: Show all FTEs
        dataFlagsOnly: false,
        exclusionsMode: 'off', // off | all | recent
        transition: null // { year, direction } where direction is toUnclassified | toClassified
    }
};

const els = {
    searchInput: document.getElementById('search'),
    clearBtn: document.getElementById('clear-search'),
    regexPill: document.getElementById('regex-pill'),
    autocomplete: document.getElementById('search-autocomplete'),
    typeSelect: document.getElementById('type-filter'),
    roleInput: document.getElementById('role-filter'),
    salaryMin: document.getElementById('salary-min'),
    salaryMax: document.getElementById('salary-max'),
    inactiveToggle: document.getElementById('show-inactive'),
    sortSelect: document.getElementById('sort-order'),
    fteToggle: document.getElementById('fte-toggle'),
    dataFlagsToggle: document.getElementById('data-flags-toggle'),
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedSearch: document.getElementById('advanced-search'),
    exclusionsMode: document.getElementById('exclusions-mode'),
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

function captureAnalyticsEvent(eventName, properties = {}) {
    if (window.__DISABLE_ANALYTICS__) return;
    if (!window.posthog || typeof window.posthog.capture !== 'function') return;
    const query = (state.filters.text || '').trim();
    const payload = {
        event_version: ANALYTICS_EVENT_VERSION,
        page: window.location.pathname || '/',
        query: query.slice(0, SEARCH_ANALYTICS_MAX_QUERY_LEN),
        query_length: query.length,
        result_count: state.filteredKeys.length,
        source: state.analytics.nextSearchSource || 'unknown',
        dataset_latest_class_date: state.latestClassDate || '',
        dataset_latest_unclass_date: state.latestUnclassDate || '',
        has_active_filters: hasActiveSearchFilters(),
        regex_mode: !!state.regexMode,
        ...properties
    };
    try {
        window.posthog.capture(eventName, payload);
    } catch (err) {
        // Analytics must never break UI interactions.
    }
}

function registerAnalyticsContext() {
    if (window.__DISABLE_ANALYTICS__) return;
    if (!window.posthog || typeof window.posthog.register !== 'function') return;
    try {
        window.posthog.register({
            event_version: ANALYTICS_EVENT_VERSION,
            dataset_latest_class_date: state.latestClassDate || '',
            dataset_latest_unclass_date: state.latestUnclassDate || ''
        });
    } catch (err) {
        // Analytics context registration should be best effort only.
    }
}

function setSearchSource(source) {
    state.analytics.nextSearchSource = source || 'unknown';
}

function consumeSearchSource() {
    const source = state.analytics.nextSearchSource || 'unknown';
    state.analytics.nextSearchSource = 'unknown';
    return source;
}

function hasActiveSearchFilters() {
    const filters = state.filters;
    return !!(
        (filters.text && filters.text.trim()) ||
        filters.type !== 'all' ||
        (filters.role && filters.role.trim()) ||
        filters.minSalary !== null ||
        filters.maxSalary !== null ||
        filters.showInactive ||
        filters.sort !== 'name-asc' ||
        filters.fullTimeOnly ||
        filters.dataFlagsOnly ||
        filters.exclusionsMode !== 'off' ||
        !!filters.transition
    );
}

function isUserInitiatedSearchSource(source) {
    return source !== 'initial_load';
}

function getResultBucket(resultCount) {
    if (resultCount <= 0) return '0';
    if (resultCount <= 5) return '1-5';
    if (resultCount <= 25) return '6-25';
    if (resultCount <= 100) return '26-100';
    return '100+';
}

function trackFilterChanged(filterName, newValue) {
    captureAnalyticsEvent('filter_changed', {
        source: 'filter_change',
        filter_name: filterName,
        new_value: newValue
    });
}

function trackSearchEvent(resultCount, meta = {}) {
    const source = consumeSearchSource();
    if (!isUserInitiatedSearchSource(source)) return;

    const query = (state.filters.text || '').trim();
    const payload = {
        source,
        query: query.slice(0, SEARCH_ANALYTICS_MAX_QUERY_LEN),
        query_length: query.length,
        result_count: resultCount,
        latency_ms: meta.latencyMs || 0,
        used_worker: !!meta.usedWorker,
        result_bucket: getResultBucket(resultCount),
        regex_mode: !!state.regexMode,
        type_filter: state.filters.type,
        show_inactive: !!state.filters.showInactive,
        full_time_only: !!state.filters.fullTimeOnly,
        data_flags_only: !!state.filters.dataFlagsOnly,
        exclusions_mode: state.filters.exclusionsMode || 'off',
        sort_order: state.filters.sort || 'name-asc',
        has_transition_filter: !!state.filters.transition
    };

    const signature = JSON.stringify({
        source: payload.source,
        query: payload.query,
        query_length: payload.query_length,
        result_count: payload.result_count,
        used_worker: payload.used_worker,
        result_bucket: payload.result_bucket,
        regex_mode: payload.regex_mode,
        type_filter: payload.type_filter,
        show_inactive: payload.show_inactive,
        full_time_only: payload.full_time_only,
        data_flags_only: payload.data_flags_only,
        exclusions_mode: payload.exclusions_mode,
        sort_order: payload.sort_order,
        has_transition_filter: payload.has_transition_filter
    });
    const now = Date.now();
    if (signature === state.analytics.lastSearchSignature && (now - state.analytics.lastSearchTs) < SEARCH_EVENT_MIN_INTERVAL_MS) {
        return;
    }

    state.analytics.lastSearchSignature = signature;
    state.analytics.lastSearchTs = now;
    captureAnalyticsEvent('search_executed', payload);
    captureAnalyticsEvent('search_performed', payload);
    if (resultCount === 0) {
        captureAnalyticsEvent('search_zero_results', payload);
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
const inflationReady = window.loadInflationData ? window.loadInflationData() : Promise.resolve();

Promise.all([
    fetch(DATA_INDEX_URL).then(res => res.json()),
    fetch(DATA_AGG_URL).then(res => res.json())
])
    .then(([indexData, aggregates]) => {
        state.masterData = indexData;
        state.masterKeys = Object.keys(indexData).sort();
        state.latestClassDate = aggregates.latestClassDate || "";
        state.latestUnclassDate = aggregates.latestUnclassDate || "";
        state.snapshotDates = aggregates.snapshotDates || [];
        state.historyStats = aggregates.historyStats || [];
        state.classTransitions = aggregates.classTransitions || [];
        state.peerMedianMap = aggregates.peerMedianMap || {};

        // Preload exclusion transition map when dates are already present in index.
        state.exclusionTransitionMap = {};
        state.masterKeys.forEach(name => {
            const p = indexData[name];
            if (p && p._exclusionDate) {
                const ts = new Date(p._exclusionDate).getTime();
                if (!isNaN(ts)) state.exclusionTransitionMap[name] = ts;
            }
        });
        if (Object.keys(state.exclusionTransitionMap).length) {
            state.exclusionTransitionsReady = true;
        }

        state.masterKeys.forEach(name => {
            const p = state.masterData[name];
            const hiredStr = p?.Meta?.['First Hired'];
            p._hiredDateTs = 0;
            if (hiredStr) {
                const d = new Date(hiredStr);
                if (!isNaN(d)) p._hiredDateTs = d.getTime();
            }
        });

        buildKeyBucketsAndCola();
        registerAnalyticsContext();

        // Populate Roles
        const roles = aggregates.allRoles || [];
        els.roleDatalist.innerHTML = roles.map(r => `<option value="${r}">`).join('');
        state.searchIndex = buildSearchIndex(state.masterKeys, roles);
        initSearchWorker();

        renderSuggestedSearches();

        const targetName = parseUrlParams();
        setSearchSource(state.filters.text ? 'url_param' : 'initial_load');
        runSearch();
        updateStats();
        setupInfiniteScroll();

        setupHistoricalChartsToggle();

        inflationReady.then(() => {
            refreshInflationControls();
            document.querySelectorAll('.card.expanded').forEach(card => rebuildPersonChart(card));
        });

        if (targetName) {
            autoExpandTarget(targetName);
        }

        setupTooltips();
        setupAdvancedSearchToggle();
    })
    .catch(err => {
        els.stats.innerHTML = "Error loading data files.";
        console.error(err);
    });


// ==========================================
// INTERACTIVE CHARTS
// ==========================================
function renderInteractiveCharts(history) {
    if (typeof Chart === 'undefined') return;

    let container = document.getElementById('historical-charts-container');
    if (!container) return;

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
        <div class="stat-card wide">
            <div class="stat-label help-cursor" data-tooltip="Counts a transition when a person switches classification between consecutive snapshots. Year reflects the later snapshot.">
                Classification Transitions
            </div>
            ${warningBox}
            <div style="height: 260px; position: relative;">
                <canvas id="chart-transitions"></canvas>
            </div>
            <div class="stat-sub">Classified → Unclassified (exclusions) and the reverse.</div>
        </div>
        <div class="stat-card wide" id="exclusions-list-card">
            <div class="stat-label help-cursor" data-tooltip="Average total pay per person in each snapshot.">
                Avg Pay Per Person
            </div>
            ${warningBox}
            <div style="height: 260px; position: relative;">
                <canvas id="chart-per-capita"></canvas>
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

    const trendData = calculateMovingAverage(history, 3, (d) => d.payroll);

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

    const transitions = state.classTransitions || [];
    if (transitions.length) {
        state.transitionChart = new Chart(document.getElementById('chart-transitions').getContext('2d'), {
            type: 'bar',
            data: {
                labels: transitions.map(d => d.year),
                datasets: [
                    {
                        label: 'Classified → Unclassified',
                        data: transitions.map(d => d.toUnclassified || 0),
                        backgroundColor: '#f97316'
                    },
                    {
                        label: 'Unclassified → Classified',
                        data: transitions.map(d => d.toClassified || 0),
                        backgroundColor: '#8b5cf6'
                    }
                ]
            },
            options: {
                ...commonOptions,
                onClick: (_, activeElements) => {
                    if (!activeElements || !activeElements.length) return;
                    const { index, datasetIndex } = activeElements[0];
                    const point = transitions[index];
                    if (!point) return;
                    const direction = datasetIndex === 0 ? 'toUnclassified' : 'toClassified';
                    applyTransitionFilter(point.year, direction);
                },
                onHover: (event, activeElements) => {
                    const canvas = event?.native?.target;
                    if (!canvas) return;
                    canvas.style.cursor = (activeElements && activeElements.length) ? 'pointer' : 'default';
                }
            }
        });
    }

    const perCapitaAll = history.map(d => {
        const count = (d.classified || 0) + (d.unclassified || 0);
        return count > 0 ? d.payroll / count : 0;
    });
    const perCapitaClassified = history.map(d => {
        const count = d.classified || 0;
        return count > 0 ? (d.payrollClassified || 0) / count : 0;
    });
    const perCapitaUnclassified = history.map(d => {
        const count = d.unclassified || 0;
        return count > 0 ? (d.payrollUnclassified || 0) / count : 0;
    });
    new Chart(document.getElementById('chart-per-capita').getContext('2d'), {
        type: 'line',
        data: {
            labels: history.map(d => d.date),
            datasets: [
                {
                    label: 'All',
                    data: perCapitaAll,
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96, 165, 250, 0.12)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Classified',
                    data: perCapitaClassified,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.08)',
                    fill: false,
                    tension: 0.3
                },
                {
                    label: 'Unclassified',
                    data: perCapitaUnclassified,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.08)',
                    fill: false,
                    tension: 0.3
                }
            ]
        },
        options: getChartOptions({
            yTickCallback: (value) => formatMoney(value),
            animation: false,
            xTickLimit: 6
        })
    });
}

// ==========================================
// BUCKETING
// ==========================================
function buildKeyBucketsAndCola() {
    const buckets = {
        all: state.masterKeys,
        classified: [],
        unclassified: [],
        active_all: [],
        active_classified: [],
        active_unclassified: [],
        fulltime_all: [],
        fulltime_classified: [],
        fulltime_unclassified: [],
        fulltime_active_all: [],
        fulltime_active_classified: [],
        fulltime_active_unclassified: []
    };

    state.masterKeys.forEach(name => {
        const person = state.masterData[name];
        const isClassified = !person._isUnclass;
        const isActive = isPersonActive(person);
        person._isActive = isActive;
        const isFullTime = !!person._isFullTime;

        if (isClassified) buckets.classified.push(name);
        else buckets.unclassified.push(name);

        if (isActive) {
            buckets.active_all.push(name);
            if (isClassified) buckets.active_classified.push(name);
            else buckets.active_unclassified.push(name);
        }

        if (isFullTime) {
            buckets.fulltime_all.push(name);
            if (isClassified) buckets.fulltime_classified.push(name);
            else buckets.fulltime_unclassified.push(name);

            if (isActive) {
                buckets.fulltime_active_all.push(name);
                if (isClassified) buckets.fulltime_active_classified.push(name);
                else buckets.fulltime_active_unclassified.push(name);
            }
        }
    });

    state.keyBuckets = buckets;
}

function getBaseKeys() {
    const { type, showInactive, fullTimeOnly } = state.filters;
    const buckets = state.keyBuckets;

    if (fullTimeOnly) {
        if (showInactive) {
            if (type === 'classified') return buckets.fulltime_classified;
            if (type === 'unclassified') return buckets.fulltime_unclassified;
            return buckets.fulltime_all;
        }
        if (type === 'classified') return buckets.fulltime_active_classified;
        if (type === 'unclassified') return buckets.fulltime_active_unclassified;
        return buckets.fulltime_active_all;
    }

    if (showInactive) {
        if (type === 'classified') return buckets.classified;
        if (type === 'unclassified') return buckets.unclassified;
        return buckets.all;
    }

    if (type === 'classified') return buckets.active_classified;
    if (type === 'unclassified') return buckets.active_unclassified;
    return buckets.active_all;
}

function hasInactiveSearchMatch(term) {
    const query = (term || '').trim().toLowerCase();
    if (!query) return false;
    return state.keyBuckets.all.some(name => {
        const person = state.masterData[name];
        return !!(person && person._isActive === false && person._searchStr && person._searchStr.includes(query));
    });
}

window.showFormerEmployeesInSearch = function() {
    state.filters.showInactive = true;
    if (els.inactiveToggle) els.inactiveToggle.checked = true;
    setSearchSource('show_former_suggestion');
    runSearch();
};

// ==========================================
// PERSON CHARTS
// ==========================================
function destroyPersonCharts() {
    Object.values(state.personCharts).forEach(chart => {
        try { chart.destroy(); } catch (e) { /* no-op */ }
        if (chart && chart._gapPulseTimer) {
            clearInterval(chart._gapPulseTimer);
        }
    });
    state.personCharts = {};
}

function ensurePersonChart(cardEl) {
    if (!cardEl || typeof Chart === 'undefined') return;
    const canvas = cardEl.querySelector('canvas[data-person-chart="true"]');
    if (!canvas) return;

    const chartId = canvas.id;
    if (state.personCharts[chartId]) return;

    const name = cardEl.getAttribute('data-name');
    const person = state.detailCache[name];
    if (!person || !person.Timeline || person.Timeline.length === 0) return;

    const yearsDiff = getTimelineYears(person.Timeline);
    if (yearsDiff < MIN_TREND_YEARS) return;

    const inflationSelect = cardEl.querySelector('.trend-mode');
    const gapToggle = cardEl.querySelector('.gap-toggle-input');
    const inflationReady = hasInflationData();
    let mode = inflationSelect ? inflationSelect.value : 'off';
    if (!inflationReady) mode = 'off';
    const showGaps = !!(gapToggle && gapToggle.checked);

    const labels = person.Timeline.map(s => s.Date);
    const tsList = person.Timeline.map(s => s._ts || 0);
    const lastIdx = labels.length - 1;
    const rawSeries = person.Timeline.map(s => s._pay);
    const adjustedSeries = person.Timeline.map(s => adjustForInflation(s._pay, s.Date));
    const primarySeries = (mode === 'adjusted') ? adjustedSeries : rawSeries;

    const peerSeries = person.Timeline.map(s => {
        const primaryJob = (s.Jobs && s.Jobs.length > 0) ? s.Jobs[0] : null;
        if (!primaryJob) return null;
        const org = primaryJob['Job Orgn'] || 'Unknown';
        const role = primaryJob['Job Title'] || 'Unknown';
        const key = `${org}||${role}`;
        const median = state.peerMedianMap?.[s.Date]?.[key];
        if (!median) return null;
        return (mode === 'adjusted') ? adjustForInflation(median, s.Date) : median;
    });

    const jobChangePoints = [];
    let roleStartIdx = 0;
    let prevTitle = null;
    person.Timeline.forEach((s, idx) => {
        const primaryJob = (s.Jobs && s.Jobs.length > 0) ? s.Jobs[0] : null;
        const title = primaryJob ? (primaryJob['Job Title'] || '') : '';
        if (idx === 0) {
            jobChangePoints.push(null);
            prevTitle = title;
            return;
        }
        if (title && prevTitle && title !== prevTitle) {
            jobChangePoints.push(primarySeries[idx]);
            roleStartIdx = idx;
        } else {
            jobChangePoints.push(null);
        }
        prevTitle = title || prevTitle;
    });
    const hasJobChanges = jobChangePoints.some(val => val !== null);

    const roleStartDate = labels[roleStartIdx] || labels[0];
    const roleTenureYears = (tsList[lastIdx] - tsList[roleStartIdx]) / MS_PER_YEAR;

    let peerPercentile = null;
    const summary = state.masterData[name];
    if (summary && summary._peerPercentile !== null && summary._peerPercentile !== undefined) {
        peerPercentile = summary._peerPercentile;
    }

    const yoyMarkers = [];
    for (let i = 1; i < tsList.length; i++) {
        const targetTs = tsList[i] - MS_PER_YEAR;
        let j = i - 1;
        while (j >= 0 && tsList[j] > targetTs) j--;
        if (j >= 0 && primarySeries[j] > 0) {
            const pct = ((primarySeries[i] - primarySeries[j]) / primarySeries[j]) * 100;
            yoyMarkers.push({ index: i, pct });
        }
    }

    const colaBands = (!person._isUnclass) ? COLA_EVENTS.map(event => {
        let beforeIdx = null;
        let afterIdx = null;
        for (let i = 0; i < labels.length; i++) {
            const d = labels[i];
            if (d <= event.effective) beforeIdx = i;
            if (afterIdx === null && d >= event.effective) afterIdx = i;
        }
        if (beforeIdx === null || afterIdx === null) return null;
        return { label: event.label, beforeIdx, afterIdx };
    }).filter(Boolean) : [];

    const globalIdxMap = new Map((state.snapshotDates || []).map((d, i) => [d, i]));
    const gapSegments = [];
    if (showGaps) {
        for (let i = 0; i < labels.length - 1; i++) {
            const idxA = globalIdxMap.get(labels[i]);
            const idxB = globalIdxMap.get(labels[i + 1]);
            if (idxA === undefined || idxB === undefined) continue;
            if (idxB - idxA > 1) {
                gapSegments.push({ leftIdx: i, rightIdx: i + 1, missingCount: idxB - idxA - 1 });
            }
        }
    }

    const overlayPlugin = {
        id: `overlay-${chartId}`,
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;

            gapSegments.forEach(seg => {
                const xLeft = xScale.getPixelForValue(labels[seg.leftIdx]);
                const xRight = xScale.getPixelForValue(labels[seg.rightIdx]);
                const xMid = (xLeft + xRight) / 2;
                ctx.save();
                const left = Math.min(xLeft, xRight);
                const width = Math.max(1, Math.abs(xRight - xLeft));
                ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
                ctx.fillRect(left, yScale.top, width, yScale.bottom - yScale.top);
                ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
                ctx.setLineDash([6, 6]);
                ctx.lineWidth = 1.5;

                const drawLine = (x) => {
                    ctx.beginPath();
                    ctx.moveTo(x, yScale.top);
                    ctx.lineTo(x, yScale.bottom);
                    ctx.stroke();
                };

                drawLine(xMid);
                if (seg.missingCount >= 3) {
                    drawLine(xMid - 5);
                    drawLine(xMid + 5);
                }

                ctx.restore();
            });

            colaBands.forEach(band => {
                const xStart = xScale.getPixelForValue(labels[band.beforeIdx]);
                const xEnd = xScale.getPixelForValue(labels[band.afterIdx]);
                const left = Math.min(xStart, xEnd);
                const width = Math.max(1, Math.abs(xEnd - xStart));
                ctx.save();
                ctx.fillStyle = 'rgba(168, 85, 247, 0.08)';
                ctx.fillRect(left, yScale.top, width, yScale.bottom - yScale.top);
                ctx.restore();
            });
        }
    };

    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Total Compensation',
                    data: primarySeries,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    order: 2
                },
                {
                    label: 'Peer Median (Org + Role)',
                    data: peerSeries,
                    borderColor: '#60a5fa',
                    borderDash: [4, 4],
                    fill: false,
                    pointRadius: 0,
                    borderWidth: 2,
                    order: 0
                }
            ].concat((mode === 'compare' && inflationReady) ? [{
                label: 'Inflation-Adjusted (CPI-U)',
                data: adjustedSeries,
                borderColor: '#a855f7',
                borderDash: [2, 4],
                fill: false,
                pointRadius: 0,
                borderWidth: 2,
                order: 1
            }] : []).concat(hasJobChanges ? [{
                label: 'Job Title Change',
                data: jobChangePoints,
                showLine: false,
                pointRadius: 4,
                pointStyle: 'triangle',
                borderColor: '#f97316',
                backgroundColor: '#f97316',
                order: 3
            }] : [])
        },
        options: getChartOptions({
            yTickCallback: (value) => formatMoney(value),
            animation: false,
            xTickLimit: 6
        }),
        plugins: [overlayPlugin]
    });
    state.personCharts[chartId] = chart;

    const legendEl = cardEl.querySelector('.trend-legend');
    if (legendEl) legendEl.classList.toggle('hidden', !showGaps);

    // Static rendering; no pulsing redraw

    const insightsEl = cardEl.querySelector(`.trend-insights-section[data-chart-insights="${chartId}"] .trend-insights`);
    if (insightsEl) {
        const insights = buildTrendInsights({
            labels,
            rawSeries,
            adjustedSeries,
            peerSeries,
            tsList,
            inflationReady,
            mode,
            hasJobChanges,
            jobChangePoints,
            roleStartDate,
            roleTenureYears,
            peerPercentile
        });
        insightsEl.innerHTML = insights;
    }
}

function buildTrendInsights({
    labels,
    rawSeries,
    adjustedSeries,
    peerSeries,
    tsList,
    inflationReady,
    mode,
    hasJobChanges,
    jobChangePoints,
    roleStartDate,
    roleTenureYears,
    peerPercentile
}) {
    const items = [];
    const lastIdx = labels.length - 1;

    if (labels.length >= 2) {
        let peakIdx = 0;
        for (let i = 1; i < rawSeries.length; i++) {
            if (rawSeries[i] > rawSeries[peakIdx]) peakIdx = i;
        }
        const peakVal = rawSeries[peakIdx];
        const currentVal = rawSeries[lastIdx];
        if (peakVal > 0 && currentVal > 0) {
            if (peakIdx === lastIdx) {
                items.push(`Current pay is at peak (${formatDate(labels[peakIdx])}).`);
            } else {
                const diff = currentVal - peakVal;
                const pct = Math.abs(diff / peakVal) * 100;
                items.push(`Current pay is ${formatMoney(Math.abs(diff))} (${pct.toFixed(1)}%) below peak (${formatDate(labels[peakIdx])}).`);
            }
        }
    }
    if (labels.length >= 2 && rawSeries[0] > 0 && rawSeries[lastIdx] > 0) {
        const nominalPct = ((rawSeries[lastIdx] - rawSeries[0]) / rawSeries[0]) * 100;
        items.push(`Nominal change since ${labels[0]}: ${formatPct(nominalPct)}`);
    }

    if (inflationReady && adjustedSeries[0] > 0 && adjustedSeries[lastIdx] > 0) {
        const realPct = ((adjustedSeries[lastIdx] - adjustedSeries[0]) / adjustedSeries[0]) * 100;
        const inflationNote = realPct >= 0 ? 'outpaced inflation' : 'behind inflation';
        items.push(`Inflation-adjusted change since ${labels[0]}: ${formatPct(realPct)} (${inflationNote})`);
    }

    if (tsList.length > 1) {
        const targetTs = tsList[lastIdx] - MS_PER_YEAR;
        let j = lastIdx - 1;
        while (j >= 0 && tsList[j] > targetTs) j--;
        if (j >= 0 && rawSeries[j] > 0) {
            const yoyPct = ((rawSeries[lastIdx] - rawSeries[j]) / rawSeries[j]) * 100;
            items.push(`YoY change: ${formatPct(yoyPct)} (vs ${labels[j]})`);
        }
    }

    const peerVal = peerSeries[lastIdx];
    if (peerVal && rawSeries[lastIdx]) {
        const diff = rawSeries[lastIdx] - peerVal;
        const diffPct = (diff / peerVal) * 100;
        const label = diff >= 0 ? 'above' : 'below';
        items.push(`Current vs peer median: ${formatMoney(diff)} (${formatPct(diffPct)} ${label})`);
    }

    if (peerPercentile !== null) {
        items.push(`Peer percentile (org + role): ${peerPercentile.toFixed(0)}th`);
    }

    if (roleStartDate && roleTenureYears >= 0) {
        items.push(`Current role tenure: ${roleTenureYears.toFixed(1)} years (since ${formatDate(roleStartDate)})`);
    }

    if (labels.length >= 2) {
        let maxChangeIdx = -1;
        let maxChangeVal = 0;
        for (let i = 1; i < rawSeries.length; i++) {
            const diff = rawSeries[i] - rawSeries[i - 1];
            const abs = Math.abs(diff);
            if (abs > maxChangeVal) {
                maxChangeVal = abs;
                maxChangeIdx = i;
            }
        }
        if (maxChangeIdx > 0 && rawSeries[maxChangeIdx - 1] > 0) {
            const diff = rawSeries[maxChangeIdx] - rawSeries[maxChangeIdx - 1];
            const pct = (diff / rawSeries[maxChangeIdx - 1]) * 100;
            items.push(`Largest single change: ${formatMoney(diff)} (${formatPct(pct)}) on ${formatDate(labels[maxChangeIdx])}`);
        }
    }

    if (hasJobChanges) {
        const changes = jobChangePoints.filter(v => v !== null).length;
        items.push(`Job title changes detected: ${changes}`);
    }

    if (items.length === 0) {
        return '<div class="insight-item">No insights available for this timeline.</div>';
    }

    return items.map(text => `<div class="insight-item">${text}</div>`).join('');
}

// ==========================================
// SEARCH & FILTER LOGIC
// ==========================================
window.applySearch = function(term, source = 'search_apply') {
    els.searchInput.value = term;
    state.filters.text = term;
    els.clearBtn.classList.toggle('hidden', !term);
    hideAutocomplete();
    setSearchSource(source);
    runSearch();
};

function buildWorkerPayload(baseKeys, transitionSet) {
    return {
        query: state.filters.text || '',
        roleFilter: (state.filters.role || '').trim().toLowerCase(),
        minSalary: state.filters.minSalary,
        maxSalary: state.filters.maxSalary,
        dataFlagsOnly: !!state.filters.dataFlagsOnly,
        exclusionsMode: state.filters.exclusionsMode || 'off',
        sort: state.filters.sort || 'name-asc',
        transitionNames: transitionSet ? Array.from(transitionSet) : null,
        transitionKey: state.filters.transition ? `${state.filters.transition.year}|${state.filters.transition.direction}` : '',
        baseKey: buildWorkerBaseKey(baseKeys),
        baseNames: baseKeys,
        nowTs: Date.now()
    };
}

function applySearchResults(results, searchMeta = {}) {
    state.filteredKeys = results;
    state.visibleCount = state.batchSize;
    state.focusIndex = -1;
    renderInitial();
    updateStats();
    updateDashboard(calculateStats(state.filteredKeys));
    updateSearchSuggestions();
    trackSearchEvent(results.length, searchMeta);
}

function runSearchLegacy(baseKeys = null, transitionSet = null, searchStartedAt = Date.now()) {
    // If user asked for recent exclusions but transition map not ready, compute then rerun.
    if (state.filters.exclusionsMode === 'recent' && !state.exclusionTransitionsReady) {
        computeExclusionTransitions().then(() => runSearch());
        return;
    }

    const term = state.filters.text.toLowerCase();
    const roleFilter = state.filters.role.toLowerCase();
    const { minSalary, maxSalary, sort, dataFlagsOnly, exclusionsMode, transition } = state.filters;
    const localTransitionSet = transitionSet || (transition && state.transitionMemberIndex ? state.transitionMemberIndex[`${transition.year}|${transition.direction}`] : null);

    // 1. FILTERING
    const keys = baseKeys || getBaseKeys();
    let results = keys.filter(name => {
        const person = state.masterData[name];

        // Search Text
        if (term && person._searchStr && !person._searchStr.includes(term)) return false;

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

        // Data Flags filter
        if (dataFlagsOnly) {
            const hasFlags = !!(person._payMissing || person._colaMissing);
            if (!hasFlags) return false;
        }

        // Exclusions filter (classified -> unclassified at any point)
        if (exclusionsMode !== 'off') {
            if (!person._wasExcluded) return false;
            if (exclusionsMode === 'recent') {
                const cutoff = Date.now() - (365 * 24 * 60 * 60 * 1000);
                let ts = null;
                if (person._exclusionDate) {
                    ts = new Date(person._exclusionDate).getTime();
                } else if (state.exclusionTransitionMap[name]) {
                    ts = state.exclusionTransitionMap[name];
                }
                if (!ts || ts < cutoff) return false;
            }
        }

        // Transition filter from "Classification Transitions" chart.
        if (transition) {
            if (!localTransitionSet || !localTransitionSet.has(name)) return false;
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

    applySearchResults(results, {
        usedWorker: false,
        latencyMs: Date.now() - searchStartedAt
    });
}

function runSearch() {
    // If user asked for recent exclusions but transition map not ready, compute then rerun.
    if (state.filters.exclusionsMode === 'recent' && !state.exclusionTransitionsReady) {
        computeExclusionTransitions().then(() => runSearch());
        return;
    }

    const transition = state.filters.transition;
    const transitionKey = transition ? `${transition.year}|${transition.direction}` : null;
    const transitionSet = transitionKey && state.transitionMemberIndex ? state.transitionMemberIndex[transitionKey] : null;
    const baseKeys = getBaseKeys();
    const searchStartedAt = Date.now();

    updateSearchUrl();

    if (!state.searchWorker || !state.searchWorkerReady || state.searchWorkerErrored) {
        hideAutocomplete();
        runSearchLegacy(baseKeys, transitionSet, searchStartedAt);
        updateRegexPill(false, '');
        return;
    }

    const token = ++state.searchRunToken;
    sendSearchToWorker(buildWorkerPayload(baseKeys, transitionSet))
        .then(payload => {
            if (token !== state.searchRunToken) return;
            const names = (payload.names || []).filter(name => !!state.masterData[name]);
            state.lastSearchSuggestions = payload.suggestions || [];
            state.lastHighlightTerms = payload.highlightTerms || [];
            state.searchWarning = payload.warning || '';
            state.regexMode = !!payload.regexMode;
            updateRegexPill(!!payload.regexMode, payload.warning || '');
            renderAutocomplete(state.lastSearchSuggestions);
            applySearchResults(names, {
                usedWorker: true,
                latencyMs: Date.now() - searchStartedAt
            });
        })
        .catch(() => {
            if (token !== state.searchRunToken) return;
            state.searchWorkerErrored = true;
            hideAutocomplete();
            runSearchLegacy(baseKeys, transitionSet, searchStartedAt);
            updateRegexPill(false, '');
        });
}

function updateSearchSuggestions() {
    const container = document.getElementById('search-suggestions');
    if (!container) return;
    const term = state.filters.text.trim();
    if (!term || state.filteredKeys.length > 0) {
        container.classList.add('hidden');
        return;
    }
    const suggestFormer = !state.filters.showInactive && hasInactiveSearchMatch(term);
    const suggestions = state.lastSearchSuggestions && state.lastSearchSuggestions.length
        ? state.lastSearchSuggestions
        : getSearchSuggestions(term);
    if (!suggestions.length && !suggestFormer) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="suggestions-title">No exact matches. Try:</div>
        <div class="suggestion-chips">
            ${suggestFormer ? `
                <button class="suggestion-chip" data-tooltip="Include former/inactive employees in results" onclick="showFormerEmployeesInSearch()">
                    Show former employees
                </button>
            ` : ''}
            ${suggestions.map(item => `
                <button class="suggestion-chip" data-tooltip="Suggested ${item.type}" onclick="applySearch('${escapeForSingleQuote(item.value)}', 'search_suggestion')">
                    ${escapeHtml(item.value)}
                </button>
            `).join('')}
        </div>
    `;
}

function updateRegexPill(isRegex, warningText) {
    if (!els.regexPill) return;
    if (!isRegex) {
        els.regexPill.classList.add('hidden');
        els.regexPill.removeAttribute('data-tooltip');
        return;
    }
    els.regexPill.classList.remove('hidden');
    if (warningText) {
        els.regexPill.setAttribute('data-tooltip', warningText);
    } else {
        els.regexPill.setAttribute('data-tooltip', 'Regex mode enabled. Use /pattern/flags syntax.');
    }
}

function hideAutocomplete() {
    state.autocompleteItems = [];
    state.autocompleteFocus = -1;
    if (!els.autocomplete) return;
    els.autocomplete.classList.add('hidden');
    els.autocomplete.innerHTML = '';
}

function renderAutocomplete(items) {
    if (!els.autocomplete) return;
    const term = (state.filters.text || '').trim();
    if (!term || !items || items.length === 0) {
        hideAutocomplete();
        return;
    }
    state.autocompleteItems = items.slice(0, 8);
    state.autocompleteFocus = -1;
    els.autocomplete.classList.remove('hidden');
    els.autocomplete.innerHTML = state.autocompleteItems.map((item, idx) => `
        <button class="autocomplete-item" data-idx="${idx}" data-value="${escapeHtmlAttr(item.value || '')}" role="option" aria-selected="false">
            <span>${escapeHtml(item.value || '')}</span>
            <span class="autocomplete-type">${escapeHtml(item.type || 'suggestion')}</span>
        </button>
    `).join('');
}

function applyAutocompleteIndex(idx) {
    if (idx < 0 || idx >= state.autocompleteItems.length) return;
    const item = state.autocompleteItems[idx];
    if (!item) return;
    captureAnalyticsEvent('search_autocomplete_selected', {
        source: 'autocomplete',
        selected_value: (item.value || '').slice(0, SEARCH_ANALYTICS_MAX_QUERY_LEN),
        selected_rank: idx + 1,
        suggestion_type: item.type || 'suggestion',
        typed_query: (state.filters.text || '').trim().slice(0, SEARCH_ANALYTICS_MAX_QUERY_LEN)
    });
    window.applySearch(item.value || '', 'autocomplete');
    hideAutocomplete();
}

function stepAutocomplete(delta) {
    if (!state.autocompleteItems.length) return;
    const len = state.autocompleteItems.length;
    state.autocompleteFocus = (state.autocompleteFocus + delta + len) % len;
    if (!els.autocomplete) return;
    els.autocomplete.querySelectorAll('.autocomplete-item').forEach((node, idx) => {
        const isActive = idx === state.autocompleteFocus;
        node.classList.toggle('active', isActive);
        node.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function updateSearchUrl() {
    const query = (state.filters.text || '').trim();
    const url = new URL(window.location.href);
    if (query) {
        url.searchParams.set('q', query);
    } else {
        url.searchParams.delete('q');
    }
    if (url.searchParams.has('name')) url.searchParams.delete('name');
    window.history.replaceState({ path: url.href }, '', url.href);
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
        
        if (!p._hasTimeline) return;

        count++; 
        // Optimization: Use cached pay and status
        const salary = p._totalPay;
        if (salary > 0) salaries.push(salary);
        if (p._isUnclass) unclassified++; else classified++;

        const org = personOrg(p) || 'Unknown';
        orgs[org] = (orgs[org] || 0) + 1;
        
        const lastJob = p._lastJob || {};
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
    if (p._lastJob && p._lastJob['Job Orgn']) return p._lastJob['Job Orgn'];
    if (p.Timeline && p.Timeline.length > 0) {
        const lastSnap = p.Timeline[p.Timeline.length - 1];
        if (lastSnap.Jobs && lastSnap.Jobs.length > 0) return lastSnap.Jobs[0]['Job Orgn'];
    }
    return null;
}

// ==========================================
// CARD GENERATION
// ==========================================
function buildHistoryHTML(person, chartId, name) {
    if (!person || !person.Timeline || person.Timeline.length === 0) {
        return `<div class="history-loading">No detailed history available.</div>`;
    }

    const reversedTimeline = person.Timeline.slice().reverse();
    const reportHistoryHTML = person.Timeline.map(snap => `<span class="badge badge-source" style="margin-right:4px; margin-bottom:4px;">${snap.Date}</span>`).join('');
    const recordGaps = getRecordGaps(person);
    const recordGapHTML = recordGaps.length
        ? recordGaps.map(gap => `<div class="record-gap">No data between ${formatDate(gap.start)} and ${formatDate(gap.end)}</div>`).join('')
        : '';
    const summary = name ? (state.masterData[name] || {}) : {};
    const dataFlags = [];
    if (summary._payMissing) dataFlags.push('Missing salary rate in one or more appointments.');
    if (summary._colaMissing) {
        const labels = summary._colaMissedLabels && summary._colaMissedLabels.length
            ? ` (${summary._colaMissedLabels.join(', ')})`
            : '';
        dataFlags.push(`Possible COLA not received${labels}.`);
    }
    if (recordGaps.length) dataFlags.push(`Missing ${recordGaps.length} snapshot gap${recordGaps.length === 1 ? '' : 's'} in timeline.`);
    const dataQualityHTML = dataFlags.length
        ? `<div class="data-quality"><strong>Data quality flags:</strong>${dataFlags.map(flag => `<div>${flag}</div>`).join('')}</div>`
        : '';

    return `
            <div class="history-meta" style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #444; font-size: 0.9rem; color: #a0a0a0;">
                <strong>Hired:</strong> ${formatDate(person.Meta["First Hired"])} &nbsp;&bull;&nbsp;
                <strong>Adj Service:</strong> ${formatDate(person.Meta["Adj Service Date"])}
            </div>
            ${dataQualityHTML}

            <div class="personal-trend-section">
                ${getPersonTrendHTML(person.Timeline, chartId)}
            </div>

            <div class="collapsible-section trend-insights-section" data-chart-insights="${chartId}">
                <button class="section-toggle" type="button" aria-expanded="false">Key Insights</button>
                <div class="collapsible-body hidden">
                    <div class="trend-insights">
                        <div class="insight-item">Insights will appear once the chart loads.</div>
                    </div>
                </div>
            </div>

            <div class="collapsible-section record-appearances">
                <button class="section-toggle" type="button" aria-expanded="false">Record appearances</button>
                <div class="collapsible-body hidden">
                    <div style="display: flex; flex-wrap: wrap;">${reportHistoryHTML}</div>
                    ${recordGapHTML}
                </div>
            </div>

            <div class="collapsible-section">
                <button class="section-toggle" type="button" aria-expanded="false">Date & Source / Job Details / Type / Salary</button>
                <div class="collapsible-body hidden">
                    <div class="table-wrap" tabindex="0" aria-label="Job history table">
                    <table>
                        <thead><tr><th>Date & Source</th><th>Job Details</th><th>Type</th><th>Salary</th></tr></thead>
                        <tbody>
                            ${reversedTimeline.map((snap, snapIdx) => {
                                const prevSnap = reversedTimeline[snapIdx + 1];
                                return (snap.Jobs || []).map(job => {
                                    let diffHTML = '';
                                    if (prevSnap && prevSnap.Jobs && !job._missingRate) {
                                        const prevJob = prevSnap.Jobs.find(j => j['Posn-Suff'] === job['Posn-Suff']);
                                        if (prevJob && !prevJob._missingRate) {
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
                                    const termBadge = job['Salary Term'] ? ` <span class="term-badge">${job['Salary Term']}</span>` : '';
                                    const hourlyRate = cleanMoney(job['Hourly Rate']);
                                    const hourlyRateText = hourlyRate > 0
                                        ? `<div class="hourly-rate">Hourly: ${formatHourlyMoney(hourlyRate)}/hr</div>`
                                        : '';
                                    const salaryText = job._missingRate
                                        ? `<span class="missing-pay" data-tooltip="Report lists only the appointment term; no salary rate was provided.">Rate missing</span>${termBadge}`
                                        : `${formatMoney(job['Annual Salary Rate'])}${termBadge}`;
                                    return `<tr><td class="date-cell"><div>${formatDate(snap.Date)}</div><div class="badge badge-source">${(snap.Source || '').substring(0, 15)}...</div></td>
                                        <td><div style="font-weight:600;">${job['Job Title'] || ''}</div><div style="font-size:0.85rem; color:#64748b;">${job['Job Orgn'] || ''}</div></td>
                                        <td><span class="badge badge-type">${job['Job Type'] || '?'}</span></td>
                                        <td class="money-cell">${salaryText}${hourlyRateText}${diffHTML}</td></tr>`;
                                }).join('')
                            }).join('')}
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>
    `;
}

function generateCardHTML(name, idx) {
    const person = state.masterData[name];
    if (!person._hasTimeline) return '';
    
    const lastJob = person._lastJob || {};
    const highlightedName = highlightText(name, state.lastHighlightTerms);
    const highlightedHomeOrg = highlightText(person.Meta["Home Orgn"] || 'N/A', state.lastHighlightTerms);
    const highlightedRole = highlightText(lastJob['Job Title'] || 'Unknown', state.lastHighlightTerms);
    
    const cardId = `card-${idx}`;
    const historyId = `history-${idx}`;
    const chartId = `person-trend-${idx}`;
    const attrName = name.replace(/"/g, '&quot;');
    const totalPay = person._totalPay || 0;
    const totalPayLabel = person._payMissing
        ? (totalPay > 0 ? `${formatMoney(totalPay)}*` : 'Pay missing')
        : formatMoney(totalPay);
    const totalPayTooltip = person._payMissing
        ? 'Total calculated from available rates. One or more appointments list only a term (e.g., 9 or 12 months) with no salary rate in the report.'
        : 'Total calculated from all active appointments';
    const isLatest = isPersonActive(person);
    
    const badgeHTML = !isLatest ? `<span class="badge" style="background:#ef4444; color:white; margin-left:10px;">FORMER / INACTIVE</span>` : '';
    const colaTooltip = (person._colaMissedLabels && person._colaMissedLabels.length > 0)
        ? `Possible COLA not received (${person._colaMissedLabels.join(', ')})`
        : 'Possible COLA not received for listed events.';
    const colaWarningHTML = (!person._isUnclass && person._colaMissing)
        ? `<span class="cola-warning" data-tooltip="${colaTooltip}">!</span>`
        : '';
    const exclusionTooltip = 'Possible exclusion (classified → unclassified at some point).';
    const exclusionWarningHTML = person._wasExcluded
        ? `<span class="exclusion-warning" data-tooltip="${exclusionTooltip}">E</span>`
        : '';
    const dataFlags = [];
    if (person._payMissing) dataFlags.push('Missing salary rate in one or more appointments.');
    if (person._colaMissing) {
        const labels = person._colaMissedLabels && person._colaMissedLabels.length
            ? ` (${person._colaMissedLabels.join(', ')})`
            : '';
        dataFlags.push(`Possible COLA not received${labels}.`);
    }
    if (person._wasExcluded) dataFlags.push('Possible exclusion (classified → unclassified at some point).');
    const dataFlagHTML = dataFlags.length
        ? `<div class="data-flag" data-tooltip="${escapeHtmlAttr(dataFlags.join(' '))}">Data flags</div>`
        : '';

    return `
    <div class="card" id="${cardId}" data-name="${attrName}" data-chart-id="${chartId}" style="${!isLatest ? 'opacity: 0.8;' : ''}">
        <div class="card-header" onclick="toggleCard('${cardId}')" onkeydown="handleCardKey(event, '${cardId}')" tabindex="0" role="button" aria-expanded="false" aria-controls="${historyId}">
            <div class="person-info">
                <div class="name-header">
                    <h2>${highlightedName} ${badgeHTML} ${colaWarningHTML} ${exclusionWarningHTML}</h2>
                    <button class="link-btn-card" data-linkname="${attrName}" onclick="copyLink(event, this.dataset.linkname)" aria-label="Copy link">🔗</button>
                    <button class="link-btn-card report-btn" data-report-name="${escapeHtmlAttr(name)}" data-tooltip="Report a data issue" aria-label="Report a data issue">!</button>
                </div>
                <p>Home Org: ${highlightedHomeOrg}</p>
            </div>
            <div class="latest-stat">
                <div class="latest-salary" data-tooltip="${totalPayTooltip}">${totalPayLabel}</div>
                <div class="latest-role">${highlightedRole}</div>
                ${dataFlagHTML}
            </div>
        </div>

        <div id="${historyId}" class="history" role="region" aria-label="Job History" data-loaded="false">
            <div class="history-loading">Expand to load details...</div>
        </div>
    </div>`;
}

function loadAndRenderPersonDetails(cardEl) {
    if (!cardEl) return Promise.resolve(null);
    const historyEl = cardEl.querySelector('.history');
    if (!historyEl) return Promise.resolve(null);
    if (historyEl.dataset.loaded === 'true') {
        const name = cardEl.getAttribute('data-name');
        return Promise.resolve(state.detailCache[name] || null);
    }
    historyEl.innerHTML = `<div class="history-loading">Loading details...</div>`;

    const name = cardEl.getAttribute('data-name');
    return loadPersonDetail(name)
        .then(person => {
            if (!person) {
                historyEl.innerHTML = `<div class="history-loading">No details available.</div>`;
                historyEl.dataset.loaded = 'true';
                return null;
            }
            const chartId = cardEl.dataset.chartId;
            historyEl.innerHTML = buildHistoryHTML(person, chartId, name);
            historyEl.dataset.loaded = 'true';
            if (hasInflationData()) refreshInflationControls();
            return person;
        })
        .catch(err => {
            historyEl.innerHTML = `<div class="history-loading">Error loading details.</div>`;
            console.error(err);
            return null;
        });
}

// ==========================================
// RENDERING & HELPERS
// ==========================================
function renderInitial() {
    destroyPersonCharts();
    const keys = state.filteredKeys.slice(0, state.visibleCount);
    if (keys.length === 0) {
        const suggestFormer = !state.filters.showInactive && hasInactiveSearchMatch(state.filters.text || '');
        const quickSuggestions = (state.lastSearchSuggestions || []).slice(0, 4);
        const formerBtn = suggestFormer
            ? `<button class="suggestion-chip" onclick="showFormerEmployeesInSearch()">Show former employees</button>`
            : '';
        const suggestionBtns = quickSuggestions.map(item => `
            <button class="suggestion-chip" onclick="applySearch('${escapeForSingleQuote(item.value || '')}', 'search_suggestion')">${escapeHtml(item.value || '')}</button>
        `).join('');
        const warning = state.searchWarning ? `<div class="suggestions-title">${escapeHtml(state.searchWarning)}</div>` : '';
        els.results.innerHTML = `
            <div class="no-results-panel">
                <div class="no-results-title">No matching records found.</div>
                ${warning}
                <div>Try broader terms or field syntax such as <code>org:engineering</code> and <code>pay:60k-90k</code>.</div>
                <div class="no-results-actions">${formerBtn}${suggestionBtns}</div>
            </div>
        `;
        return;
    }
    els.results.innerHTML = keys.map((name, idx) => generateCardHTML(name, idx)).join('') + getSentinel();
    observeSentinel();
}

function focusCardByIndex(idx) {
    if (idx < 0 || idx >= state.filteredKeys.length) return;
    while (idx >= state.visibleCount) appendNextBatch();
    const card = document.getElementById(`card-${idx}`);
    if (!card) return;
    const header = card.querySelector('.card-header');
    if (header) {
        header.focus();
        state.focusIndex = idx;
    }
}

function appendNextBatch() {
    const startIdx = state.visibleCount;
    const endIdx = Math.min(startIdx + state.batchSize, state.filteredKeys.length);
    if (startIdx >= state.filteredKeys.length) return;
    const html = state.filteredKeys.slice(startIdx, endIdx).map((name, idx) => generateCardHTML(name, startIdx + idx)).join('');
    document.getElementById('scroll-sentinel')?.remove();
    els.results.insertAdjacentHTML('beforeend', html + getSentinel());
    state.visibleCount = endIdx;
    captureAnalyticsEvent('results_batch_loaded', {
        source: 'infinite_scroll',
        start_idx: startIdx,
        end_idx: endIdx,
        total_results: state.filteredKeys.length
    });
    observeSentinel();
}

const getSentinel = () => `<div id="scroll-sentinel" class="loader-sentinel">${state.visibleCount < state.filteredKeys.length ? 'Loading more...' : 'End of results'}</div>`;
function getTransitionFilterLabel() {
    const transition = state.filters.transition;
    if (!transition) return '';
    const directionLabel = transition.direction === 'toUnclassified'
        ? 'Classified -> Unclassified'
        : 'Unclassified -> Classified';
    return `${directionLabel} in ${transition.year}`;
}
function updateStats() {
    const transitionLabel = getTransitionFilterLabel();
    const transitionText = transitionLabel ? ` (Transition filter: ${transitionLabel})` : '';
    const warning = state.searchWarning ? ` ${escapeHtml(state.searchWarning)}` : '';
    els.stats.innerHTML = `Found ${state.filteredKeys.length} matching personnel records.${transitionText}${warning}`;
}

function getClassStateFromSource(source) {
    const src = (source || '').toLowerCase();
    const isUnclass = src.includes('unclass');
    const isClassified = src.includes('class') && !isUnclass;
    if (isUnclass) return 'unclassified';
    if (isClassified) return 'classified';
    return null;
}

function computeTransitionMemberIndex() {
    if (state.transitionMemberIndex) return Promise.resolve(state.transitionMemberIndex);
    if (state.transitionIndexPromise) return state.transitionIndexPromise;

    const buckets = [...new Set(state.masterKeys.map(bucketForName))];
    const index = {};

    const add = (year, direction, name) => {
        if (!year || !direction || !name) return;
        const key = `${year}|${direction}`;
        if (!index[key]) index[key] = new Set();
        index[key].add(name);
    };

    const processBucketData = (bucketData) => {
        Object.entries(bucketData).forEach(([name, person]) => {
            if (!person || !person.Timeline || person.Timeline.length < 2) return;
            hydratePersonDetail(person);

            let prevState = null;
            person.Timeline.forEach(snap => {
                const currentState = getClassStateFromSource(snap.Source);
                if (!currentState) return;
                if (prevState && prevState !== currentState) {
                    const year = new Date(snap.Date).getFullYear();
                    if (!isNaN(year)) {
                        const direction = currentState === 'unclassified' ? 'toUnclassified' : 'toClassified';
                        add(year, direction, name);
                    }
                }
                prevState = currentState;
            });
        });
    };

    state.transitionIndexPromise = forEachWithConcurrency(
        buckets,
        TRANSITION_BUCKET_LOAD_CONCURRENCY,
        (bucket) => loadBucket(bucket).then(processBucketData)
    )
        .then(() => {
            state.transitionMemberIndex = index;
            return index;
        })
        .catch(err => {
            console.error('Failed to build transition member index', err);
            throw err;
        })
        .finally(() => {
            state.transitionIndexPromise = null;
        });

    return state.transitionIndexPromise;
}

function applyTransitionFilter(year, direction) {
    const current = state.filters.transition;
    const isSame = current && current.year === year && current.direction === direction;
    if (isSame) {
        state.filters.transition = null;
        captureAnalyticsEvent('transition_filter_applied', {
            source: 'transition_filter',
            year,
            direction,
            enabled: false
        });
        setSearchSource('transition_filter');
        runSearch();
        return;
    }

    els.stats.innerHTML = 'Loading transition worker list...';
    computeTransitionMemberIndex()
        .then(() => {
            state.filters.transition = { year, direction };
            captureAnalyticsEvent('transition_filter_applied', {
                source: 'transition_filter',
                year,
                direction,
                enabled: true
            });
            setSearchSource('transition_filter');
            runSearch();
        })
        .catch(() => {
            state.filters.transition = null;
            captureAnalyticsEvent('transition_filter_applied', {
                source: 'transition_filter',
                year,
                direction,
                enabled: false
            });
            setSearchSource('transition_filter');
            runSearch();
        });
}
function toggleCard(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('expanded');
    const expanded = el.classList.contains('expanded');
    el.querySelector('.card-header')?.setAttribute('aria-expanded', expanded);
    if (expanded) {
        const name = el.getAttribute('data-name') || '';
        const resultIndex = state.filteredKeys.indexOf(name);
        captureAnalyticsEvent('person_card_opened', {
            source: 'result_card',
            person_name: name,
            result_index: resultIndex,
            visible_count: state.visibleCount
        });
        loadAndRenderPersonDetails(el).then(() => ensurePersonChart(el));
    }
}

function rebuildPersonChart(cardEl) {
    if (!cardEl) return;
    const name = cardEl.getAttribute('data-name');
    if (!state.detailCache[name]) {
        loadAndRenderPersonDetails(cardEl).then(() => ensurePersonChart(cardEl));
        return;
    }
    const canvas = cardEl.querySelector('canvas[data-person-chart="true"]');
    if (!canvas) return;
    const chartId = canvas.id;
    if (state.personCharts[chartId]) {
        try { state.personCharts[chartId].destroy(); } catch (e) { /* no-op */ }
        delete state.personCharts[chartId];
    }
    ensurePersonChart(cardEl);
}

function getRecordGaps(person) {
    if (!person || !person.Timeline || person.Timeline.length < 2) return [];
    if (!state.snapshotDates || state.snapshotDates.length < 2) return [];
    const dates = person.Timeline.map(s => s.Date).filter(Boolean).sort();
    const idxMap = new Map(state.snapshotDates.map((d, i) => [d, i]));
    const gaps = [];

    for (let i = 0; i < dates.length - 1; i++) {
        const idxA = idxMap.get(dates[i]);
        const idxB = idxMap.get(dates[i + 1]);
        if (idxA === undefined || idxB === undefined) continue;
        if (idxB - idxA > 1) {
            const start = state.snapshotDates[idxA + 1];
            const end = state.snapshotDates[idxB - 1];
            if (start && end) gaps.push({ start, end });
        }
    }
    return gaps;
}

function refreshInflationControls() {
    if (!hasInflationData()) return;
    document.querySelectorAll('.trend-mode').forEach(select => {
        if (select.dataset.ready === 'true') return;
        select.dataset.ready = 'true';
        select.disabled = false;
        select.innerHTML = `
            <option value="off" selected>Inflation: Off</option>
            <option value="adjusted">Inflation: Adjusted (graph wide)</option>
            <option value="compare">Inflation: Adjusted (separate line)</option>
        `;
    });
}
window.handleCardKey = function(e, id) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(id); } };

let observer;
function setupInfiniteScroll() {
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => { if (entry.isIntersecting && state.visibleCount < state.filteredKeys.length) appendNextBatch(); });
    }, { root: null, rootMargin: '100px', threshold: 0.1 });
}
function observeSentinel() { const s = document.getElementById('scroll-sentinel'); if (s && observer) observer.observe(s); }

function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }
const handleSearch = debounce(() => {
    state.filters.text = els.searchInput.value;
    setSearchSource('search_input');
    runSearch();
}, 250);

els.searchInput.addEventListener('input', (e) => {
    els.clearBtn.classList.toggle('hidden', !e.target.value);
    handleSearch();
});
els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && state.autocompleteItems.length) {
        e.preventDefault();
        stepAutocomplete(1);
        return;
    }
    if (e.key === 'ArrowUp' && state.autocompleteItems.length) {
        e.preventDefault();
        stepAutocomplete(-1);
        return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && state.autocompleteItems.length && state.autocompleteFocus >= 0) {
        e.preventDefault();
        applyAutocompleteIndex(state.autocompleteFocus);
        return;
    }
    if (e.key === 'Escape') {
        hideAutocomplete();
    }
});

if (els.autocomplete) {
    els.autocomplete.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.autocomplete-item');
        if (!item) return;
        e.preventDefault();
        const idx = parseInt(item.dataset.idx || '-1', 10);
        applyAutocompleteIndex(idx);
    });
}

document.addEventListener('click', (e) => {
    if (!els.autocomplete || els.autocomplete.classList.contains('hidden')) return;
    if (e.target === els.searchInput || e.target.closest('#search-autocomplete')) return;
    hideAutocomplete();
});

els.clearBtn.addEventListener('click', () => {
    const previousQuery = (state.filters.text || '').trim();
    captureAnalyticsEvent('search_cleared', {
        source: 'clear_search',
        query: previousQuery.slice(0, SEARCH_ANALYTICS_MAX_QUERY_LEN),
        query_length: previousQuery.length
    });
    els.searchInput.value = '';
    els.clearBtn.classList.add('hidden');
    state.filters.text = '';
    state.lastHighlightTerms = [];
    state.searchWarning = '';
    updateRegexPill(false, '');
    hideAutocomplete();
    setSearchSource('clear_search');
    runSearch();
    els.searchInput.focus();
});
els.typeSelect.addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    trackFilterChanged('type', e.target.value);
    setSearchSource('filter_change');
    runSearch();
});
els.roleInput.addEventListener('input', debounce((e) => {
    state.filters.role = e.target.value;
    trackFilterChanged('role', (e.target.value || '').trim().slice(0, SEARCH_ANALYTICS_MAX_QUERY_LEN));
    setSearchSource('filter_change');
    runSearch();
}, 300));
els.salaryMin.addEventListener('input', debounce((e) => {
    state.filters.minSalary = parseFloat(e.target.value) || null;
    trackFilterChanged('salary_min', state.filters.minSalary);
    setSearchSource('filter_change');
    runSearch();
}, 300));
els.salaryMax.addEventListener('input', debounce((e) => {
    state.filters.maxSalary = parseFloat(e.target.value) || null;
    trackFilterChanged('salary_max', state.filters.maxSalary);
    setSearchSource('filter_change');
    runSearch();
}, 300));
els.inactiveToggle.addEventListener('change', (e) => {
    state.filters.showInactive = e.target.checked;
    trackFilterChanged('show_inactive', e.target.checked);
    setSearchSource('filter_change');
    runSearch();
});
els.sortSelect.addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    trackFilterChanged('sort_order', e.target.value);
    setSearchSource('filter_change');
    runSearch();
});
els.fteToggle.addEventListener('change', (e) => {
    state.filters.fullTimeOnly = e.target.checked;
    trackFilterChanged('full_time_only', e.target.checked);
    setSearchSource('filter_change');
    runSearch();
});
els.dataFlagsToggle.addEventListener('change', (e) => {
    state.filters.dataFlagsOnly = e.target.checked;
    trackFilterChanged('data_flags_only', e.target.checked);
    setSearchSource('filter_change');
    runSearch();
});
if (els.exclusionsMode) {
    els.exclusionsMode.addEventListener('change', (e) => {
        state.filters.exclusionsMode = e.target.value;
        trackFilterChanged('exclusions_mode', e.target.value);
        setSearchSource('filter_change');
        runSearch();
    });
}

function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

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

function setupAdvancedSearchToggle() {
    if (!els.advancedToggle || !els.advancedSearch) return;
    els.advancedToggle.addEventListener('click', () => {
        const isHidden = els.advancedSearch.classList.contains('hidden');
        els.advancedSearch.classList.toggle('hidden', !isHidden);
        els.advancedToggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });
}

function setupHistoricalChartsToggle() {
    const toggle = document.getElementById('historical-toggle');
    const wrapper = document.getElementById('historical-charts');
    if (!toggle || !wrapper) return;

    toggle.addEventListener('click', () => {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;
        toggle.setAttribute('aria-expanded', String(nextExpanded));
        wrapper.classList.toggle('hidden', !nextExpanded ? true : false);
        wrapper.setAttribute('aria-hidden', String(!nextExpanded));
        toggle.textContent = nextExpanded ? 'Hide historical charts' : 'Show historical charts';
        captureAnalyticsEvent('historical_charts_toggled', {
            source: 'historical_toggle',
            expanded: nextExpanded
        });

        if (nextExpanded && !state.historicalChartsRendered) {
            renderInteractiveCharts(state.historyStats);
            state.historicalChartsRendered = true;
        }
    });
}

function setupHotkeys() {
    document.addEventListener('focusin', (e) => {
        const card = e.target.closest('.card');
        if (!card || !card.id) return;
        const match = card.id.match(/^card-(\d+)$/);
        if (match) state.focusIndex = parseInt(match[1], 10);
    });

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('info-modal');
        const isModalOpen = modal && !modal.classList.contains('hidden');

        if (e.key === 'Escape') {
            if (isModalOpen) {
                modal.classList.add('hidden');
                return;
            }
            hideAutocomplete();
            if (els.searchInput.value) {
                els.searchInput.value = '';
                els.clearBtn.classList.add('hidden');
                state.filters.text = '';
                setSearchSource('clear_search');
                runSearch();
            }
            return;
        }

        if (isModalOpen) return;

        if (isTypingTarget(e.target)) return;

        if (e.key === '?' ) {
            if (modal) {
                modal.classList.remove('hidden');
                captureAnalyticsEvent('info_modal_opened', { source: 'hotkey' });
                const hotkeys = document.getElementById('hotkeys-section');
                if (hotkeys) hotkeys.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
        }

        if (e.key === '/' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            els.searchInput.focus();
            return;
        }

        if (e.key === 'j' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = state.focusIndex >= 0 ? state.focusIndex + 1 : 0;
            focusCardByIndex(Math.min(next, state.filteredKeys.length - 1));
            return;
        }

        if (e.key === 'k' || e.key === 'ArrowUp') {
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            const prev = state.focusIndex > 0 ? state.focusIndex - 1 : 0;
            focusCardByIndex(prev);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('info-modal');
    if (modal) {
        document.getElementById('info-btn').addEventListener('click', () => {
            modal.classList.remove('hidden');
            captureAnalyticsEvent('info_modal_opened', { source: 'info_button' });
        });
        document.getElementById('close-modal').addEventListener('click', () => modal.classList.add('hidden'));
        window.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.add('hidden'); });
        document.querySelectorAll('.collapsible-btn').forEach(btn => btn.addEventListener('click', () => {
            btn.setAttribute('aria-expanded', !(btn.getAttribute('aria-expanded') === 'true'));
            btn.nextElementSibling.classList.toggle('hidden');
        }));
    }

    document.body.addEventListener('change', (e) => {
        const target = e.target;
        if (target && (target.classList.contains('trend-mode') || target.classList.contains('gap-toggle-input'))) {
            const cardEl = target.closest('.card');
            if (cardEl) rebuildPersonChart(cardEl);
        }
    });

    setupHotkeys();

    document.body.addEventListener('click', (e) => {
        const reportBtn = e.target.closest('.report-btn');
        if (reportBtn) {
            const name = reportBtn.getAttribute('data-report-name') || '';
            openCorrectionIssue(name);
            return;
        }
        const btn = e.target.closest('.section-toggle');
        if (!btn) return;
        const body = btn.nextElementSibling;
        if (!body) return;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', (!expanded).toString());
        body.classList.toggle('hidden', expanded);
    });
});

function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q');
    const name = params.get('name');
    const target = query || name;
    if (target) {
        state.filters.text = target;
        els.searchInput.value = target;
        els.clearBtn.classList.remove('hidden');
    }
    if (query) return null;
    if (name) return name;
    return null;
}
function autoExpandTarget(name) {
    const card = document.querySelector(`.card[data-name="${name.replace(/"/g, '\\"')}"]`);
    if (card) {
        card.classList.add('expanded');
        loadAndRenderPersonDetails(card).then(() => ensurePersonChart(card));
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
}
function copyLink(e, name) {
    e.stopPropagation();
    const url = new URL(window.location.href); url.searchParams.set('name', name);
    window.history.pushState({ path: url.href }, '', url.href);
    captureAnalyticsEvent('person_link_copied', {
        source: 'person_link',
        person_name: name
    });
    navigator.clipboard.writeText(url.href).then(() => showToast(`Link copied for ${name}`)).catch(console.error);
}

function openCorrectionIssue(name) {
    captureAnalyticsEvent('correction_issue_opened', {
        source: 'correction_button',
        person_name: name || 'Unknown'
    });
    const base = 'https://github.com/jaxsnjohnson/osu-sal-report-data-and-site/issues/new';
    const safeName = name || 'Unknown';
    const title = `Data correction request: ${safeName}`;
    const body = [
        `Person: ${safeName}`,
        'Report date:',
        'Field:',
        'Observed value:',
        'Expected value:',
        'Source link or notes:'
    ].join('\\n');
    const params = new URLSearchParams({ title, body });
    window.open(`${base}?${params.toString()}`, '_blank', 'noopener');
}
function showToast(msg) {
    let t = document.getElementById('toast-notification');
    if (!t) { t = document.createElement('div'); t.id = 'toast-notification'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
}

function renderSuggestedSearches() {
    if (!els.suggestedSearches) return;
    els.suggestedSearches.innerHTML = ['Professor', 'Athletics', 'Physics', 'Coach', 'Dean'].map(term =>
        `<button class="chip" onclick="applySearch('${term}', 'suggested_chip')">${term}</button>`
    ).join('');
}
