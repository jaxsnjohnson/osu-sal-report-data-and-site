const tokenize = (text) => {
    if (!text) return [];
    let current = '';
    const tokens = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ' || char === '\t' || char === '\n' || char === '-' || char === '_' || char === '/' || char === '\\' || char === ',' || char === '.') {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
};
const boundedEditDistance = (a, b, maxDist) => 5; // dummy

const term = "XYZ";
const values = ["Software Engineer III", "Engineering Department", "Senior"];
const preTokens = null;

const matchesFieldTerm_Original = (term, values, preTokens) => {
    if (!term) return false;
    for (const value of values) {
        if (!value) continue;
        if (value.includes(term)) return true;
    }

    const maxDist = term.length <= 5 ? 1 : 2;
    if (preTokens) {
        for (const token of preTokens) {
            if (token.length < 3) continue;
            if (boundedEditDistance(term, token, maxDist) <= maxDist) return true;
        }
        return false;
    }

    for (const value of values) {
        for (const token of tokenize(value)) {
            if (token.length < 3) continue;
            if (boundedEditDistance(term, token, maxDist) <= maxDist) return true;
        }
    }
    return false;
};

const matchesFieldTerm_New = (term, values, preTokens) => {
    if (!term) return false;
    for (const value of values) {
        if (!value) continue;
        if (value.includes(term)) return true;
    }

    const maxDist = term.length <= 5 ? 1 : 2;
    const tokensToSearch = preTokens || tokenize(values.join(' '));
    for (const token of tokensToSearch) {
        if (token.length < 3) continue;
        if (boundedEditDistance(term, token, maxDist) <= maxDist) return true;
    }
    return false;
};

console.time("original");
for(let k=0; k<100000; k++) {
    matchesFieldTerm_Original(term, values, preTokens);
}
console.timeEnd("original");

console.time("new");
for(let k=0; k<100000; k++) {
    matchesFieldTerm_New(term, values, preTokens);
}
console.timeEnd("new");
