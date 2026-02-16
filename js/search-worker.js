let records = [];
let recordMap = new Map();
let isReady = false;

const resultCache = new Map();
const CACHE_LIMIT = 80;
const REGEX_MAX_MATCHES = 3000;
const SUGGESTION_LIMIT = 8;
let editDistancePrev = new Uint32Array(0);
let editDistanceCur = new Uint32Array(0);

const normalizeText = (value) => (value || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokenize = (value) => {
    const text = (value || '').toString().toLowerCase();
    const tokens = [];
    let tokenStart = -1;

    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const isAlphaNum = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);

        if (isAlphaNum) {
            if (tokenStart === -1) tokenStart = i;
        } else if (tokenStart !== -1) {
            tokens.push(text.slice(tokenStart, i));
            tokenStart = -1;
        }
    }

    if (tokenStart !== -1) tokens.push(text.slice(tokenStart));
    return tokens;
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const parseAmount = (value) => {
    if (!value) return null;
    const str = value.toString().trim().toLowerCase().replace(/\$/g, '');
    const mult = str.endsWith('m') ? 1000000 : (str.endsWith('k') ? 1000 : 1);
    const num = parseFloat(mult === 1 ? str : str.slice(0, -1));
    if (Number.isNaN(num)) return null;
    return num * mult;
};

const buildOrgAliases = (orgValue) => {
    const text = (orgValue || '').toString();
    const aliases = [];
    const base = normalizeText(text);
    if (base) aliases.push(base);
    const parts = text.split('-').map(p => p.trim()).filter(Boolean);
    if (parts.length) {
        const code = normalizeText(parts[0]);
        const tail = normalizeText(parts.slice(1).join(' '));
        if (code) aliases.push(code);
        if (tail) {
            aliases.push(tail);
            tail.split(' ').forEach(tok => aliases.push(tok));
        }
    }
    return Array.from(new Set(aliases.filter(Boolean)));
};

const tokenizeQuery = (query) => {
    const tokens = [];
    const re = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = re.exec(query)) !== null) {
        if (match[1]) tokens.push(match[1]);
        else if (match[2]) tokens.push(match[2]);
    }
    return tokens;
};

const parseQuery = (query) => {
    const raw = (query || '').trim();
    const parsed = {
        raw,
        regex: null,
        regexFlags: '',
        regexError: null,
        terms: [],
        negativeTerms: [],
        nameTerms: [],
        orgTerms: [],
        roleTerms: [],
        type: null,
        status: null,
        payMin: null,
        payMax: null,
        sort: null,
        highlightTerms: []
    };

    const regexMatch = raw.match(/^\/(.*)\/([a-z]*)$/i);
    if (regexMatch) {
        parsed.regex = regexMatch[1];
        parsed.regexFlags = regexMatch[2] || '';
        try {
            parsed.regexCompiled = new RegExp(parsed.regex, parsed.regexFlags);
        } catch (err) {
            parsed.regexError = err && err.message ? err.message : 'Invalid regex';
        }
        return parsed;
    }

    const tokens = tokenizeQuery(raw);
    for (const token of tokens) {
        if (!token) continue;
        let current = token;
        let negative = false;
        if (current.startsWith('-') && current.length > 1) {
            negative = true;
            current = current.slice(1);
        }

        const fieldIdx = current.indexOf(':');
        if (fieldIdx > 0) {
            const field = current.slice(0, fieldIdx).toLowerCase();
            const value = current.slice(fieldIdx + 1).trim();
            if (!value) continue;

            if (field === 'name') {
                parsed.nameTerms.push(normalizeText(value));
                continue;
            }
            if (field === 'org') {
                parsed.orgTerms.push(normalizeText(value));
                continue;
            }
            if (field === 'role') {
                parsed.roleTerms.push(normalizeText(value));
                continue;
            }
            if (field === 'type') {
                const v = value.toLowerCase();
                if (v === 'classified' || v === 'unclassified') parsed.type = v;
                continue;
            }
            if (field === 'status') {
                const v = value.toLowerCase();
                if (v === 'active' || v === 'inactive') parsed.status = v;
                continue;
            }
            if (field === 'sort') {
                const v = value.toLowerCase();
                if (v === 'name' || v === 'salary' || v === 'tenure' || v === 'recent') parsed.sort = v;
                continue;
            }
            if (field === 'pay') {
                const payVal = value.replace(/\s+/g, '').toLowerCase();
                if (payVal.includes('-')) {
                    const [low, high] = payVal.split('-');
                    const lowNum = parseAmount(low);
                    const highNum = parseAmount(high);
                    if (lowNum !== null) parsed.payMin = lowNum;
                    if (highNum !== null) parsed.payMax = highNum;
                } else if (payVal.startsWith('>')) {
                    const min = parseAmount(payVal.slice(1));
                    if (min !== null) parsed.payMin = min;
                } else if (payVal.startsWith('<')) {
                    const max = parseAmount(payVal.slice(1));
                    if (max !== null) parsed.payMax = max;
                }
                continue;
            }
        }

        const normalized = normalizeText(current);
        if (!normalized) continue;
        if (negative) parsed.negativeTerms.push(normalized);
        else parsed.terms.push(normalized);
    }

    const highlights = [];
    const pushParts = (arr) => arr.forEach(term => tokenize(term).forEach(tok => {
        if (tok.length > 1) highlights.push(tok);
    }));
    pushParts(parsed.terms);
    pushParts(parsed.nameTerms);
    pushParts(parsed.orgTerms);
    pushParts(parsed.roleTerms);
    parsed.highlightTerms = Array.from(new Set(highlights));
    return parsed;
};

const getSortKey = (sortFromFilters, sortFromDsl) => {
    if (sortFromDsl === 'salary') return 'salary-desc';
    if (sortFromDsl === 'tenure') return 'tenure-desc';
    if (sortFromDsl === 'recent') return 'recent-desc';
    if (sortFromDsl === 'name') return 'name-asc';
    return sortFromFilters || 'name-asc';
};

const scoreTokenInText = (term, text) => {
    if (!term || !text) return null;
    if (text === term) return 0;
    if (text.startsWith(term)) return 0;
    if (text.includes(term)) return 1;
    const maxDist = term.length <= 4 ? 1 : (term.length <= 6 ? 2 : 3);
    let best = maxDist + 1;
    const tokens = tokenize(text);
    for (const token of tokens) {
        if (token.length < 3) continue;
        const dist = boundedEditDistance(term, token, maxDist);
        if (dist < best) best = dist;
        if (best === 0) break;
    }
    if (best <= maxDist) return 2 + best;
    return null;
};

const matchesFieldTerm = (term, values) => {
    if (!term) return false;
    for (const value of values) {
        if (!value) continue;
        if (value.includes(term)) return true;
        const maxDist = term.length <= 5 ? 1 : 2;
        for (const token of tokenize(value)) {
            if (token.length < 3) continue;
            if (boundedEditDistance(term, token, maxDist) <= maxDist) return true;
        }
    }
    return false;
};

const appliesCommonFilters = (rec, payload, parsed, transitionSet, cutoffTs) => {
    if (payload.baseSet && !payload.baseSet.has(rec.name)) return false;
    if (payload.roleFilter && !rec.roleSearch.includes(payload.roleFilter)) return false;

    if (payload.minSalary !== null && rec.totalPay < payload.minSalary) return false;
    if (payload.maxSalary !== null && rec.totalPay > payload.maxSalary) return false;

    if (payload.dataFlagsOnly && !rec.hasFlags) return false;

    if (payload.exclusionsMode !== 'off') {
        if (!rec.wasExcluded) return false;
        if (payload.exclusionsMode === 'recent') {
            if (!rec.exclusionTs || rec.exclusionTs < cutoffTs) return false;
        }
    }

    if (transitionSet && !transitionSet.has(rec.name)) return false;

    if (parsed.type) {
        if (parsed.type === 'classified' && rec.isUnclass) return false;
        if (parsed.type === 'unclassified' && !rec.isUnclass) return false;
    }

    if (parsed.status) {
        if (parsed.status === 'active' && !rec.isActive) return false;
        if (parsed.status === 'inactive' && rec.isActive) return false;
    }

    if (parsed.payMin !== null && rec.totalPay < parsed.payMin) return false;
    if (parsed.payMax !== null && rec.totalPay > parsed.payMax) return false;

    return true;
};

const scoreRecord = (rec, parsed) => {
    let score = 0;

    for (const term of parsed.negativeTerms) {
        if (rec.searchText.includes(term)) return null;
    }

    for (const term of parsed.nameTerms) {
        const fieldScore = scoreTokenInText(term, rec.nameNorm);
        if (fieldScore === null) return null;
        score += fieldScore;
    }

    for (const term of parsed.orgTerms) {
        const matches = matchesFieldTerm(term, [rec.homeOrgNorm, rec.lastOrgNorm, ...(rec.orgAliases || [])]);
        if (!matches) return null;
        score += 1;
    }

    for (const term of parsed.roleTerms) {
        const matches = matchesFieldTerm(term, [rec.roleSearch, ...(rec.rolesNorm || []), ...(rec.roleAliases || [])]);
        if (!matches) return null;
        score += 1;
    }

    for (const term of parsed.terms) {
        const nameScore = scoreTokenInText(term, rec.nameNorm);
        const roleScore = scoreTokenInText(term, rec.roleSearch);
        const orgScore = scoreTokenInText(term, rec.orgSearch);
        const searchScore = scoreTokenInText(term, rec.searchText);
        const best = [nameScore, roleScore === null ? null : roleScore + 1, orgScore === null ? null : orgScore + 1, searchScore === null ? null : searchScore + 2]
            .filter(v => v !== null)
            .sort((a, b) => a - b)[0];

        if (best === undefined) return null;
        score += best;
    }

    if (rec.isActive) score -= 0.1;
    return score;
};

const sortResults = (items, sortKey) => {
    const sorted = items.slice();

    if (sortKey === 'salary-desc') {
        sorted.sort((a, b) => (b.totalPay - a.totalPay) || (a.score - b.score) || a.name.localeCompare(b.name));
        return sorted;
    }
    if (sortKey === 'salary-asc') {
        sorted.sort((a, b) => (a.totalPay - b.totalPay) || (a.score - b.score) || a.name.localeCompare(b.name));
        return sorted;
    }
    if (sortKey === 'tenure-desc') {
        sorted.sort((a, b) => (a.firstHiredYear - b.firstHiredYear) || (a.score - b.score) || a.name.localeCompare(b.name));
        return sorted;
    }
    if (sortKey === 'tenure-asc') {
        sorted.sort((a, b) => (b.firstHiredYear - a.firstHiredYear) || (a.score - b.score) || a.name.localeCompare(b.name));
        return sorted;
    }
    if (sortKey === 'recent-desc') {
        sorted.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || (a.score - b.score) || a.name.localeCompare(b.name));
        return sorted;
    }
    if (sortKey === 'name-desc') {
        sorted.sort((a, b) => b.name.localeCompare(a.name) || (a.score - b.score));
        return sorted;
    }

    sorted.sort((a, b) => (a.score - b.score) || a.name.localeCompare(b.name));
    return sorted;
};

const buildSuggestions = (queryNorm, parsed, payload, transitionSet, cutoffTs) => {
    if (!queryNorm || parsed.regex) return [];

    const suggestions = [];
    const seen = new Set();
    const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    for (const rec of records) {
        if (suggestions.length >= SUGGESTION_LIMIT) break;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if ((now - start) > 20) break;
        if (!appliesCommonFilters(rec, payload, parsed, transitionSet, cutoffTs)) continue;

        if (rec.nameNorm.startsWith(queryNorm) || rec.nameNorm.includes(queryNorm)) {
            const key = `name:${rec.nameNorm}`;
            if (!seen.has(key)) {
                seen.add(key);
                suggestions.push({ type: 'name', value: rec.name });
                if (suggestions.length >= SUGGESTION_LIMIT) break;
            }
        }

        for (const role of rec.roles) {
            const roleNorm = normalizeText(role);
            if (!roleNorm || (!roleNorm.startsWith(queryNorm) && !roleNorm.includes(queryNorm))) continue;
            const key = `role:${roleNorm}`;
            if (!seen.has(key)) {
                seen.add(key);
                suggestions.push({ type: 'role', value: role });
                if (suggestions.length >= SUGGESTION_LIMIT) break;
            }
        }

        const orgCandidates = [rec.homeOrg, rec.lastOrg];
        for (const org of orgCandidates) {
            const orgNorm = normalizeText(org);
            if (!orgNorm || (!orgNorm.startsWith(queryNorm) && !orgNorm.includes(queryNorm))) continue;
            const key = `org:${orgNorm}`;
            if (!seen.has(key)) {
                seen.add(key);
                suggestions.push({ type: 'org', value: org });
                if (suggestions.length >= SUGGESTION_LIMIT) break;
            }
        }
    }

    return suggestions;
};

const buildCacheKey = (payload, parsed) => {
    const parts = [
        parsed.raw,
        payload.roleFilter || '',
        payload.minSalary === null ? '' : payload.minSalary,
        payload.maxSalary === null ? '' : payload.maxSalary,
        payload.dataFlagsOnly ? '1' : '0',
        payload.exclusionsMode || 'off',
        payload.transitionKey || '',
        payload.baseKey || '',
        parsed.type || '',
        parsed.status || '',
        parsed.payMin === null ? '' : parsed.payMin,
        parsed.payMax === null ? '' : parsed.payMax,
        parsed.sort || ''
    ];
    return parts.join('|');
};

const parseAndSearch = (payload) => {
    const queryText = payload.query || '';
    const parsed = parseQuery(queryText);
    if (parsed.regexError) {
        return {
            names: [],
            suggestions: [],
            regexMode: true,
            regexTooBroad: false,
            warning: `Regex error: ${parsed.regexError}`,
            highlightTerms: [],
            queryUsedSort: null
        };
    }

    const transitionSet = payload.transitionNames ? new Set(payload.transitionNames) : null;
    const payloadWithSets = {
        ...payload,
        baseSet: payload.baseNames ? new Set(payload.baseNames) : null
    };
    const cutoffTs = (payload.nowTs || Date.now()) - (365 * 24 * 60 * 60 * 1000);
    const sortKey = getSortKey(payload.sort, parsed.sort);

    const cacheKey = buildCacheKey(payload, parsed);
    const cached = resultCache.get(cacheKey);
    if (cached) {
        const sorted = sortResults(cached.items, sortKey);
        return {
            names: sorted.map(item => item.name),
            suggestions: cached.suggestions,
            regexMode: !!parsed.regex,
            regexTooBroad: !!cached.regexTooBroad,
            warning: cached.warning || '',
            highlightTerms: parsed.highlightTerms,
            queryUsedSort: parsed.sort || null
        };
    }

    const items = [];
    let regexTooBroad = false;
    let warning = '';

    if (parsed.regex) {
        const regex = parsed.regexCompiled;
        for (const rec of records) {
            if (!appliesCommonFilters(rec, payloadWithSets, parsed, transitionSet, cutoffTs)) continue;
            regex.lastIndex = 0;
            if (!regex.test(rec.searchText)) continue;
            items.push({
                name: rec.name,
                score: 0,
                totalPay: rec.totalPay,
                firstHiredYear: rec.firstHiredYear,
                lastDate: rec.lastDate
            });
            if (items.length > REGEX_MAX_MATCHES) {
                regexTooBroad = true;
                warning = 'Regex is too broad. Add anchors or more specific terms.';
                break;
            }
        }
    } else {
        for (const rec of records) {
            if (!appliesCommonFilters(rec, payloadWithSets, parsed, transitionSet, cutoffTs)) continue;
            const score = scoreRecord(rec, parsed);
            if (score === null) continue;
            items.push({
                name: rec.name,
                score,
                totalPay: rec.totalPay,
                firstHiredYear: rec.firstHiredYear,
                lastDate: rec.lastDate
            });
        }
    }

    const queryNorm = normalizeText(parsed.raw);
    const suggestions = buildSuggestions(queryNorm, parsed, payloadWithSets, transitionSet, cutoffTs);
    const sorted = sortResults(items, sortKey);

    resultCache.set(cacheKey, { items, suggestions, regexTooBroad, warning });
    if (resultCache.size > CACHE_LIMIT) {
        const first = resultCache.keys().next();
        if (!first.done) resultCache.delete(first.value);
    }

    return {
        names: sorted.map(item => item.name),
        suggestions,
        regexMode: !!parsed.regex,
        regexTooBroad,
        warning,
        highlightTerms: parsed.highlightTerms,
        queryUsedSort: parsed.sort || null
    };
};

const prepareRecords = (rawRecords) => rawRecords.map(rec => {
    const homeOrgNorm = normalizeText(rec.homeOrgNorm || rec.homeOrg || '');
    const lastOrgNorm = normalizeText(rec.lastOrgNorm || rec.lastOrg || '');
    const rolesNorm = (rec.rolesNorm || []).map(normalizeText).filter(Boolean);
    const roles = rec.roles || [];
    const orgAliasesRaw = (rec.orgAliases && rec.orgAliases.length)
        ? rec.orgAliases
        : [...buildOrgAliases(rec.homeOrg), ...buildOrgAliases(rec.lastOrg)];
    const orgAliases = Array.from(new Set(orgAliasesRaw.map(normalizeText).filter(Boolean)));
    const roleAliasesRaw = (rec.roleAliases && rec.roleAliases.length)
        ? rec.roleAliases
        : roles.flatMap(role => tokenize(role));
    const roleAliases = Array.from(new Set(roleAliasesRaw.map(normalizeText).filter(Boolean)));
    const exclusionTs = rec.exclusionDate ? new Date(rec.exclusionDate).getTime() : 0;
    return {
        name: rec.name,
        nameNorm: normalizeText(rec.nameNorm || rec.name || ''),
        homeOrg: rec.homeOrg || '',
        homeOrgNorm,
        lastOrg: rec.lastOrg || '',
        lastOrgNorm,
        roles,
        rolesNorm,
        orgAliases,
        roleAliases,
        roleSearch: normalizeText((roles || []).join(' ') + ' ' + roleAliases.join(' ')),
        orgSearch: normalizeText(`${homeOrgNorm} ${lastOrgNorm} ${orgAliases.join(' ')}`),
        isUnclass: !!rec.isUnclass,
        isActive: !!rec.isActive,
        isFullTime: !!rec.isFullTime,
        totalPay: Number(rec.totalPay) || 0,
        firstHiredYear: Number(rec.firstHiredYear) || 9999,
        lastDate: rec.lastDate || '',
        hasFlags: !!rec.hasFlags,
        wasExcluded: !!rec.wasExcluded,
        exclusionTs: Number.isFinite(exclusionTs) ? exclusionTs : 0,
        searchText: normalizeText(rec.searchText || `${rec.name || ''} ${rec.homeOrg || ''} ${rec.lastOrg || ''} ${(roles || []).join(' ')}`)
    };
});

const initWorker = async (id, payload) => {
    try {
        const response = await fetch(payload.url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`Failed to load search index: ${response.status}`);
        const data = await response.json();
        records = prepareRecords(data.records || []);
        recordMap = new Map(records.map(rec => [rec.name, rec]));
        resultCache.clear();
        isReady = true;
        postMessage({ type: 'ready', id, count: records.length });
    } catch (err) {
        postMessage({ type: 'error', id, message: err && err.message ? err.message : 'Worker init failed' });
    }
};

self.onmessage = (event) => {
    const msg = event.data || {};
    const type = msg.type;
    const id = msg.id;
    const payload = msg.payload || {};

    if (type === 'init') {
        initWorker(id, payload);
        return;
    }

    if (type === 'search') {
        if (!isReady) {
            postMessage({ type: 'result', id, payload: { names: [], suggestions: [], warning: 'Search worker not ready.' } });
            return;
        }
        try {
            const result = parseAndSearch(payload);
            postMessage({ type: 'result', id, payload: result });
        } catch (err) {
            postMessage({ type: 'error', id, message: err && err.message ? err.message : 'Search failed' });
        }
    }
};
