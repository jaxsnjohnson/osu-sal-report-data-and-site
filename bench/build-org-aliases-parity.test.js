#!/usr/bin/env node

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '..', 'js', 'search-worker.js');
const source = fs.readFileSync(targetPath, 'utf8');

const extractConstDeclaration = (text, name, nextName) => {
    const startMarker = `const ${name} =`;
    const endMarker = `\nconst ${nextName} =`;
    const start = text.indexOf(startMarker);
    if (start === -1) throw new Error(`Could not find "${startMarker}" in ${targetPath}`);
    const end = text.indexOf(endMarker, start);
    if (end === -1) throw new Error(`Could not find "${endMarker}" after ${name} in ${targetPath}`);
    return text.slice(start, end).trimEnd();
};

const normalizeDecl = extractConstDeclaration(source, 'normalizeText', 'tokenize');
const buildOrgAliasesDecl = extractConstDeclaration(source, 'buildOrgAliases', 'tokenizeQuery');

const buildOrgAliases = Function(`"use strict";\n${normalizeDecl}\n${buildOrgAliasesDecl}\nreturn buildOrgAliases;`)();

const legacyBuildOrgAliases = Function(
    `"use strict";\n${normalizeDecl}\nreturn (orgValue) => {
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
    };`
)();

let rngState = 0x00c0ffee;
const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
};

const randomInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

const randomValue = () => {
    if (rand() < 0.1) {
        const scalars = [null, undefined, '', '   ', 0, 42, 12345];
        return scalars[randomInt(0, scalars.length - 1)];
    }

    const chunks = ['OSU', 'Medical Center', 'HR', 'Finance', 'Student Life', 'IT', 'A', 'B', '-', '---', '   '];
    const count = randomInt(0, 7);
    let out = '';
    for (let i = 0; i < count; i++) {
        if (i > 0 || rand() < 0.6) out += rand() < 0.75 ? '-' : ' ';
        if (rand() < 0.25) out += ' '.repeat(randomInt(0, 2));
        out += chunks[randomInt(0, chunks.length - 1)];
        if (rand() < 0.25) out += ' '.repeat(randomInt(0, 2));
        if (rand() < 0.2) out += rand() < 0.5 ? '-' : '--';
    }
    return out;
};

const fixedCases = [
    null,
    undefined,
    0,
    42,
    '',
    '   ',
    'NoHyphenOrg',
    'OSU - Medical Center',
    'ABC - Dept - Subdivision',
    'A--B',
    'A -  - C',
    '---',
    ' -Leading',
    'Trailing- ',
    ' - Both - ',
    'OSU--Medical Center - HR',
    ' College of Arts -  Fiscal Operations  - Payroll ',
    '   -Med Center  OSUITOffice '
];

for (const value of fixedCases) {
    assert.deepStrictEqual(
        buildOrgAliases(value),
        legacyBuildOrgAliases(value),
        `Parity mismatch for fixed case ${JSON.stringify(value)}`
    );
}

for (let i = 0; i < 10000; i++) {
    const value = randomValue();
    assert.deepStrictEqual(
        buildOrgAliases(value),
        legacyBuildOrgAliases(value),
        `Parity mismatch for random case ${JSON.stringify(value)}`
    );
}

console.log('PASS: buildOrgAliases parity matches legacy implementation');
