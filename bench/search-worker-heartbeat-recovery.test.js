#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'search-worker.js'), 'utf8');

const messages = [];
const dataset = {
    records: [
        {
            name: 'Alpha, Person',
            nameNorm: 'alpha person',
            homeOrg: 'SCI - Biology',
            lastOrg: 'SCI - Biology',
            roles: ['Research Assistant'],
            rolesNorm: ['research assistant'],
            isUnclass: true,
            isActive: true,
            isFullTime: true,
            totalPay: 50000,
            firstHiredYear: 2020,
            lastDate: '2026-02-03',
            hasFlags: false,
            wasExcluded: false,
            exclusionDate: '',
            searchText: 'alpha person biology research assistant'
        }
    ]
};

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    performance: { now: () => Date.now() },
    postMessage: (msg) => messages.push(msg),
    fetch: async () => ({
        ok: true,
        async json() {
            return dataset;
        }
    }),
    self: {}
};
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

function send(msg) {
    sandbox.self.onmessage({ data: msg });
}

function waitForMessage(matchFn, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = () => {
            const idx = messages.findIndex(matchFn);
            if (idx >= 0) {
                const [msg] = messages.splice(idx, 1);
                resolve(msg);
                return;
            }
            if ((Date.now() - started) >= timeoutMs) {
                reject(new Error('Timed out waiting for worker message'));
                return;
            }
            setTimeout(poll, 10);
        };
        poll();
    });
}

(async () => {
    send({ type: 'ping', id: 'ping-before-init', payload: {} });
    const pingBeforeInit = await waitForMessage((msg) => msg.type === 'pong' && msg.id === 'ping-before-init');
    assert.strictEqual(pingBeforeInit.ready, false, 'ping should report not ready before init');

    send({ type: 'search', id: 'search-before-init', payload: { query: 'alpha' } });
    const earlySearch = await waitForMessage((msg) => msg.type === 'result' && msg.id === 'search-before-init');
    assert.strictEqual(earlySearch.payload.warning, 'Search worker not ready.', 'search should warn when worker is not ready');
    assert.strictEqual((earlySearch.payload.names || []).length, 0, 'search should return no names when worker is not ready');

    send({ type: 'init', id: 'init-1', payload: { url: 'data/search-index.json' } });
    await waitForMessage((msg) => msg.type === 'ready' && msg.id === 'init-1');

    send({ type: 'ping', id: 'ping-after-init', payload: {} });
    const pingAfterInit = await waitForMessage((msg) => msg.type === 'pong' && msg.id === 'ping-after-init');
    assert.strictEqual(pingAfterInit.ready, true, 'ping should report ready after init');

    send({ type: 'search', id: 'search-after-init', payload: { query: 'alpha', sort: 'name-asc', exclusionsMode: 'off', nowTs: Date.now() } });
    const searchAfterInit = await waitForMessage((msg) => msg.type === 'result' && msg.id === 'search-after-init');
    assert.strictEqual((searchAfterInit.payload.names || []).join('|'), 'Alpha, Person', 'search should return expected result after init');

    // Simulate app-driven worker recovery by re-initializing the worker dataset.
    send({ type: 'init', id: 'init-2', payload: { url: 'data/search-index.json' } });
    await waitForMessage((msg) => msg.type === 'ready' && msg.id === 'init-2');

    send({ type: 'search', id: 'search-after-reinit', payload: { query: 'alpha', sort: 'name-asc', exclusionsMode: 'off', nowTs: Date.now() } });
    const searchAfterReinit = await waitForMessage((msg) => msg.type === 'result' && msg.id === 'search-after-reinit');
    assert.strictEqual((searchAfterReinit.payload.names || []).join('|'), 'Alpha, Person', 'search should still work after re-init recovery');

    console.log('PASS: worker heartbeat and re-init recovery behavior');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
