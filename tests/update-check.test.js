'use strict';
// An overlay left open for days asks its site which version it serves and reloads itself when that isn't the one it runs.
// The fetch and the reload are injected, and setTimeout is mocked, so nothing here waits or touches the network.
const test = require('node:test');
const assert = require('node:assert');
const uc = require('../js/update-check.js');

const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
const URL_ = 'https://chat.masstar.org/version.json';

// fetchJson answers from `answer` (a value, or a function returning a value or a promise) and records its calls.
function rig(answer, extra) {
  const r = { fetched: [], reloads: 0 };
  r.check = uc.createUpdateCheck(Object.assign({
    version: '1.10.0',
    url: URL_,
    fetchJson(url, opts) {
      r.fetched.push([url, opts]);
      return Promise.resolve(typeof answer === 'function' ? answer() : answer);
    },
    reload() { r.reloads++; }
  }, extra));
  return r;
}

test('versionOf: only a plain dotted number from a version.json is a version', () => {
  ['1.10.0', '2', '1.0', '0.0.1.2'].forEach((v) => assert.strictEqual(uc.versionOf({ version: v }), v, v));
  [{ version: '' }, { version: '1.2.3.4.5' }, { version: 'v1.0.0' }, { version: '1.0.0-beta' }, { version: ' 1.0.0' },
    { version: '<html>' }, { version: 1.1 }, { version: null }, {}, null, undefined, 'x', 7, [], { __notFound: true }]
    .forEach((v) => assert.strictEqual(uc.versionOf(v), '', JSON.stringify(v)));
});

test('check: the same version does nothing', async () => {
  const r = rig({ version: '1.10.0' });
  assert.strictEqual(await r.check.check(), false);
  assert.strictEqual(r.reloads, 0);
});

test('check: asks for the site\'s own file, skipping the browser cache', async () => {
  const r = rig({ version: '1.10.0' });
  await r.check.check();
  assert.strictEqual(r.fetched.length, 1);
  assert.strictEqual(r.fetched[0][0], URL_);
  assert.strictEqual(r.fetched[0][1].cache, 'no-store');
  assert.ok(r.fetched[0][1].timeout > 0, 'a hung request ends');
});

test('check: a different version reloads once, newer or older (a rollback is what a reload would load too)', async () => {
  for (const site of ['1.10.1', '1.11.0', '2.0.0', '1.9.0']) {
    const r = rig({ version: site });
    assert.strictEqual(await r.check.check(), true, site);
    assert.strictEqual(r.reloads, 1, site);
  }
});

test('check: an answer that is not a version.json, or none at all, leaves the page alone', async () => {
  const answers = [{ __notFound: true }, null, {}, { version: 5 }, { version: 'latest' }, 'text', [],
    () => { throw new Error('offline'); }, () => Promise.reject(new TypeError('Failed to fetch'))];
  for (const a of answers) {
    const r = rig(a);
    assert.strictEqual(await r.check.check(), false, String(a));
    assert.strictEqual(r.reloads, 0, String(a));
  }
});

test('check: fetchJson throwing at once (no fetch in this browser) is an answer of "can\'t tell", not a crash', async () => {
  const r = rig(null, { fetchJson() { throw new ReferenceError('fetch is not defined'); } });
  assert.strictEqual(await r.check.check(), false);
  assert.strictEqual(r.reloads, 0);
});

test('check: a reload that throws does not escape', async () => {
  const r = rig({ version: '2.0.0' }, { reload() { throw new Error('nope'); } });
  assert.strictEqual(await r.check.check(), false);
});

test('start: the first check comes after the cache lifetime, not at once, and then every interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig({ version: '1.10.0' });
  r.check.start();
  await settle();
  assert.strictEqual(r.fetched.length, 0, 'a page that just loaded does not check');
  t.mock.timers.tick(uc.CHECK_MS - 1);
  await settle();
  assert.strictEqual(r.fetched.length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.strictEqual(r.fetched.length, 1);
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.fetched.length, 2);
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.fetched.length, 3);
  assert.strictEqual(r.reloads, 0);
  r.check.stop();
});

test('CHECK_MS is the 10 minutes GitHub Pages lets a cache keep a file', () => {
  assert.strictEqual(uc.CHECK_MS, 10 * 60 * 1000);
});

test('start: a release is noticed at the next check and reloads the page', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let site = '1.10.0';
  const r = rig(() => ({ version: site }));
  r.check.start();
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.reloads, 0);
  site = '1.10.1';
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.reloads, 1);
  r.check.stop();
});

test('start: checks never overlap; the next is timed from the end of a slow one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  const r = rig(() => new Promise((res) => { release = () => res({ version: '1.10.0' }); }));
  r.check.start();
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.fetched.length, 1);
  t.mock.timers.tick(uc.CHECK_MS * 3); // still waiting on the first answer: nothing else is scheduled
  await settle();
  assert.strictEqual(r.fetched.length, 1, 'no second request while one is out');
  release();
  await settle();
  t.mock.timers.tick(uc.CHECK_MS - 1);
  await settle();
  assert.strictEqual(r.fetched.length, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.strictEqual(r.fetched.length, 2);
  r.check.stop();
});

test('start: a failed check does not end the checking', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  const r = rig(() => { n++; if (n === 1) throw new Error('offline'); return { version: '1.10.0' }; });
  r.check.start();
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.fetched.length, 2);
  r.check.stop();
});

test('start twice is one timer; stop ends it, also for a check that is out when it is called', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig({ version: '1.10.0' });
  r.check.start();
  r.check.start();
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  assert.strictEqual(r.fetched.length, 1, 'one timer, one request');
  r.check.stop();
  t.mock.timers.tick(uc.CHECK_MS * 3);
  await settle();
  assert.strictEqual(r.fetched.length, 1, 'stopped');

  let release;
  const slow = rig(() => new Promise((res) => { release = () => res({ version: '1.10.0' }); }));
  slow.check.start();
  t.mock.timers.tick(uc.CHECK_MS);
  await settle();
  slow.check.stop();
  release();
  await settle();
  t.mock.timers.tick(uc.CHECK_MS * 3);
  await settle();
  assert.strictEqual(slow.fetched.length, 1, 'an answer that lands after stop() does not start it again');
});

test('start: without a version, an address or a way to reload there is nothing to check', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const missing of [{ version: '' }, { url: '' }, { reload: null }]) {
    const r = rig({ version: '9.9.9' }, missing);
    r.check.start();
    t.mock.timers.tick(uc.CHECK_MS * 2);
    await settle();
    assert.strictEqual(r.fetched.length, 0, JSON.stringify(missing));
    assert.strictEqual(r.reloads, 0);
  }
});

test('every: the interval can be set, and a bad one falls back to the default', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const quick = rig({ version: '1.10.0' }, { every: 1000 });
  quick.check.start();
  t.mock.timers.tick(1000);
  await settle();
  assert.strictEqual(quick.fetched.length, 1);
  quick.check.stop();
  for (const bad of [0, -5, 'x', NaN]) {
    const r = rig({ version: '1.10.0' }, { every: bad });
    r.check.start();
    t.mock.timers.tick(uc.CHECK_MS - 1);
    await settle();
    assert.strictEqual(r.fetched.length, 0, String(bad));
    t.mock.timers.tick(1);
    await settle();
    assert.strictEqual(r.fetched.length, 1, String(bad));
    r.check.stop();
  }
});

test('with no fetchJson given it uses util.fetchJson: a plain GET with no credentials, skipping the browser cache', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({ version: '2.0.0' }), { status: 200 });
  });
  let reloads = 0;
  const c = uc.createUpdateCheck({ version: '1.10.0', url: URL_, reload() { reloads++; } });
  assert.strictEqual(await c.check(), true);
  assert.strictEqual(reloads, 1);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], URL_);
  assert.strictEqual(calls[0][1].method, 'GET');
  assert.strictEqual(calls[0][1].credentials, 'omit');
  assert.strictEqual(calls[0][1].cache, 'no-store');
});

test('a missing version.json (404) is "can\'t tell", through the real util.fetchJson', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Not Found', { status: 404 }));
  let reloads = 0;
  const c = uc.createUpdateCheck({ version: '1.10.0', url: URL_, reload() { reloads++; } });
  assert.strictEqual(await c.check(), false);
  assert.strictEqual(reloads, 0);
});

test('overlay.html loads it between util.js and overlay.js, and its CSP lets the page reach its own site over https', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'overlay.html'), 'utf8');
  const at = (f) => html.indexOf('src="js/' + f + '?v=');
  assert.ok(at('util.js') > 0 && at('util.js') < at('update-check.js'), 'after util.js (it uses util.fetchJson)');
  assert.ok(at('update-check.js') > 0 && at('update-check.js') < at('overlay.js'), 'before overlay.js (boot reads TCO.updateCheck)');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  const connect = csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === 'connect-src');
  assert.ok(connect && connect.indexOf('https:') > 0, 'connect-src allows https, which version.json is fetched over');
});
