'use strict';
// An overlay left open for days watches its site for a new deploy, finds which of its own files changed, and has the
// overlay swap in just those. The site, the clock and the apply step are injected, so nothing here waits or touches the
// network.
const test = require('node:test');
const assert = require('node:assert');
const uc = require('../js/update-check.js');

const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await new Promise((r) => setImmediate(r)); };
const ORIGIN = 'https://chat.masstar.org';
const PAGE = ORIGIN + '/overlay.html?channel=home';
const MIN = 60000;

const html = (o) => '<!doctype html><html><head>\n' +
  '<!-- a comment -->\n' +
  '<meta http-equiv="Content-Security-Policy" content="' + ((o && o.csp) || "default-src 'none'") + '">\n' +
  '<link rel="stylesheet" href="css/overlay.css?v=' + ((o && o.v) || '1.0.0') + '">\n' +
  ((o && o.scripts) || ['js/util.js', 'js/overlay.js']).map((s) => '<script defer src="' + s + '?v=' + ((o && o.v) || '1.0.0') + '"></script>\n').join('') +
  '</head><body><div id="chat"></div></body></html>';

// A fake site. files: path -> text (what it serves now). cached: what the page loaded (the browser's cache), taken when
// the site is made. deployedAt: the deploy's time (its Last-Modified); the clock is site.now.
function makeSite(files, extra) {
  const s = Object.assign({
    files: Object.assign({}, files),
    clock: 1e12,
    deployedAt: 1e12 - 60 * MIN,
    lastModified: true,
    fetched: [],
    down: false,
    now() { return s.clock; },
    deploy(changes) {
      Object.keys(changes).forEach((k) => { if (changes[k] === null) delete s.files[k]; else s.files[k] = changes[k]; });
      s.deployedAt = s.clock;
    },
    fetchText(url, cache) {
      s.fetched.push([url, cache]);
      if (s.down) return Promise.reject(new TypeError('Failed to fetch'));
      const path = new URL(url).pathname;
      const from = cache === 'force-cache' && path in s.cached ? s.cached : s.files;
      const ok = path in from;
      const headers = { date: new Date(s.clock).toUTCString() };
      if (s.lastModified) headers['last-modified'] = new Date(s.deployedAt).toUTCString();
      return Promise.resolve({ ok, status: ok ? 200 : 404, text: ok ? from[path] : '', header: (n) => headers[n.toLowerCase()] || '' });
    }
  }, extra);
  s.cached = Object.assign({}, s.files);
  return s;
}

const FILES = () => ({
  '/overlay.html': html(),
  '/version.json': '{"version":"1.0.0"}',
  '/js/util.js': 'util v1',
  '/js/overlay.js': 'overlay v1',
  '/css/overlay.css': 'css v1',
  '/img/logos/Badge.svg': '<svg>green</svg>',
  '/img/logos/Beta.svg': '<svg>beta</svg>'
});

function rig(siteExtra, extra) {
  const site = makeSite(FILES(), siteExtra);
  const r = { site, applied: [], answer: true };
  r.check = uc.createUpdateCheck(Object.assign({
    version: '1.0.0',
    url: ORIGIN + '/version.json',
    page: PAGE,
    running: () => ({
      scripts: [ORIGIN + '/js/util.js?v=1.0.0', ORIGIN + '/js/overlay.js?v=1.0.0', 'https://elsewhere.example/x.js'],
      styles: [ORIGIN + '/css/overlay.css?v=1.0.0', 'https://fonts.googleapis.com/css2?family=Figtree']
    }),
    assets: ['img/logos/Badge.svg', 'img/logos/Beta.svg'],
    apply(change) { r.applied.push(change); return Promise.resolve(r.answer); },
    fetchText: (u, c) => (r.hook ? r.hook(u, c, site.fetchText) : site.fetchText(u, c)),
    now: site.now
  }, extra));
  r.paths = () => site.fetched.map(([u, c]) => new URL(u).pathname + ' ' + c);
  return r;
}

test('hashText tells two texts apart and is the same for the same text', () => {
  assert.strictEqual(uc.hashText('abc'), uc.hashText('abc'));
  assert.notStrictEqual(uc.hashText('abc'), uc.hashText('abd'));
  assert.notStrictEqual(uc.hashText(''), uc.hashText(' '));
  assert.notStrictEqual(uc.hashText('<svg stroke="#00ff66"/>'), uc.hashText('<svg stroke="#ff9d00"/>'));
});

test('shapeOf: comments, script tags and ?v= busters are left out; anything else counts', () => {
  assert.strictEqual(uc.shapeOf(html()), uc.shapeOf(html({ v: '2.0.0', scripts: ['js/a.js', 'js/b.js', 'js/c.js'] })));
  assert.strictEqual(uc.shapeOf(html()), uc.shapeOf(html().replace('a comment', 'another comment').replace(/\n/g, '\n\n  ')));
  assert.notStrictEqual(uc.shapeOf(html()), uc.shapeOf(html({ csp: "default-src 'none'; connect-src https:" })));
  assert.notStrictEqual(uc.shapeOf(html()), uc.shapeOf(html().replace('<div id="chat"></div>', '<div id="chat"></div><div id="x"></div>')));
});

test('filesIn: the page\'s own scripts and stylesheets, in order, absolute; other sites and commented-out tags left out', () => {
  const page = html({ scripts: ['js/util.js', 'settings.js', 'js/overlay.js'] }) +
    '<!-- <script src="js/old.js"></script> --><script src="https://cdn.example/x.js"></script>' +
    '<link href="css/extra.css?a=1&amp;b=2" rel="stylesheet"><link rel="icon" href="data:,">' +
    '<link rel="stylesheet" href="https://cdn.example/style.css">';
  const f = uc.filesIn(page, PAGE);
  assert.deepStrictEqual(f.scripts, [ORIGIN + '/js/util.js?v=1.0.0', ORIGIN + '/settings.js?v=1.0.0', ORIGIN + '/js/overlay.js?v=1.0.0']);
  assert.deepStrictEqual(f.styles, [ORIGIN + '/css/overlay.css?v=1.0.0', ORIGIN + '/css/extra.css?a=1&b=2']);
  assert.deepStrictEqual(uc.filesIn(html(), 'https://owner.github.io/project/overlay.html').scripts,
    ['https://owner.github.io/project/js/util.js?v=1.0.0', 'https://owner.github.io/project/js/overlay.js?v=1.0.0']);
});

test('versionOf: only a plain dotted number from a version.json is a version', () => {
  ['1.10.0', '2', '1.0', '0.0.1.2'].forEach((v) => assert.strictEqual(uc.versionOf({ version: v }), v, v));
  [{ version: '' }, { version: '1.2.3.4.5' }, { version: 'v1.0.0' }, { version: '1.0.0-beta' }, { version: ' 1.0.0' },
    { version: '<html>' }, { version: 1.1 }, { version: null }, {}, null, undefined, 'x', 7, []]
    .forEach((v) => assert.strictEqual(uc.versionOf(v), '', JSON.stringify(v)));
});

test('first check: reads what the page runs from the browser\'s cache, and an old deploy of this version is left alone', async () => {
  const r = rig();
  assert.strictEqual(await r.check.check(), false);
  assert.deepStrictEqual(r.paths(), [
    '/overlay.html force-cache', '/js/util.js force-cache', '/js/overlay.js force-cache', '/css/overlay.css force-cache',
    '/img/logos/Badge.svg force-cache', '/img/logos/Beta.svg force-cache', '/version.json no-store']);
  assert.strictEqual(r.site.fetched[0][0], PAGE, 'the page as it was loaded, query and all');
  assert.deepStrictEqual(r.applied, []);
  r.site.fetched.length = 0;
  r.site.clock += uc.CHECK_MS;
  assert.strictEqual(await r.check.check(), false);
  assert.deepStrictEqual(r.paths(), ['/version.json no-store'], 'the same deploy: one small request per check');
});

test('a deploy that changes none of the overlay\'s files changes nothing, and is compared no more once it is old', async () => {
  const r = rig();
  await r.check.check();
  r.site.deploy({ '/builder.html': 'new builder', '/README.md': 'docs' });
  r.site.clock += uc.SETTLE_MS;
  r.site.fetched.length = 0;
  assert.strictEqual(await r.check.check(), false);
  assert.deepStrictEqual(r.applied, []);
  const page = r.site.fetched.find(([u]) => new URL(u).pathname === '/overlay.html');
  assert.strictEqual(page[1], 'no-store');
  assert.match(page[0], /^https:\/\/chat\.masstar\.org\/overlay\.html\?u=[0-9a-z]+$/, 'the page itself, without its settings');
  r.site.fetched.filter(([u]) => /\.(js|css|svg)\b/.test(u)).forEach(([u, c]) => {
    assert.strictEqual(c, 'reload', u);
    assert.match(u, /[?&]u=[0-9a-z]+$/, u);
  });
  r.site.fetched.length = 0;
  r.site.clock += uc.CHECK_MS;
  await r.check.check();
  assert.deepStrictEqual(r.paths(), ['/version.json no-store']);
});

test('a new badge image is swapped in, with no reload, and only once', async () => {
  const r = rig();
  await r.check.check();
  r.site.clock += uc.CHECK_MS;
  r.site.deploy({ '/img/logos/Badge.svg': '<svg>orange</svg>' });
  r.site.clock += 2 * MIN;
  assert.strictEqual(await r.check.check(), true);
  assert.strictEqual(r.applied.length, 1);
  assert.deepStrictEqual(r.applied[0].styles, []);
  assert.strictEqual(r.applied[0].assets.length, 1);
  assert.strictEqual(r.applied[0].assets[0].path, 'img/logos/Badge.svg');
  assert.match(r.applied[0].assets[0].url, /^https:\/\/chat\.masstar\.org\/img\/logos\/Badge\.svg\?u=[0-9a-z]+$/);
  assert.ok(!r.applied.some((c) => c.reload));
  // The deploy is still young: it is compared again later (a CDN may still have had the old copy), but nothing new is found.
  for (let i = 0; i < 4; i++) {
    r.site.clock += uc.CHECK_MS;
    await r.check.check();
  }
  assert.strictEqual(r.applied.length, 1);
});

test('a new stylesheet is swapped in; when the swap fails it is tried again at the next check', async () => {
  const r = rig();
  await r.check.check();
  r.site.deploy({ '/css/overlay.css': 'css v2' });
  r.answer = false;
  r.site.clock += uc.CHECK_MS;
  assert.strictEqual(await r.check.check(), false);
  assert.strictEqual(r.applied.length, 1);
  assert.deepStrictEqual(r.applied[0].styles.map((s) => s.path), ['/css/overlay.css']);
  assert.match(r.applied[0].styles[0].url, /^https:\/\/chat\.masstar\.org\/css\/overlay\.css\?v=1\.0\.0&u=[0-9a-z]+$/);
  r.answer = true;
  r.site.clock += uc.SETTLE_MS;
  assert.strictEqual(await r.check.check(), true);
  assert.strictEqual(r.applied.length, 2);
  r.site.clock += uc.CHECK_MS;
  await r.check.check();
  assert.strictEqual(r.applied.length, 2, 'took: nothing more to do');
});

test('a new script reloads the page, but only once the deploy is old enough and never in the page\'s first minutes', async () => {
  const r = rig();
  await r.check.check();
  r.site.deploy({ '/js/overlay.js': 'overlay v2' });
  r.site.clock += uc.CHECK_MS;
  assert.strictEqual(await r.check.check(), false, 'young deploy: wait');
  assert.deepStrictEqual(r.applied, []);
  r.site.clock = r.site.deployedAt + uc.SETTLE_MS;
  assert.strictEqual(await r.check.check(), true);
  assert.deepStrictEqual(r.applied, [{ reload: true }]);

  // A page that only just loaded, from before a deploy that is young: compared at once, but no reload in its first minutes.
  const fresh = rig();
  fresh.site.files['/js/util.js'] = 'util v2';
  fresh.site.deployedAt = fresh.site.clock - 1;
  assert.strictEqual(await fresh.check.check(), false);
  assert.deepStrictEqual(fresh.applied, [], 'not in the first minutes');
  fresh.site.clock = fresh.site.deployedAt + uc.SETTLE_MS;
  assert.strictEqual(await fresh.check.check(), true);
  assert.deepStrictEqual(fresh.applied, [{ reload: true }]);
});

test('a script added to or dropped from the page, or a page that changed beyond its scripts, is a reload too', async () => {
  for (const change of [
    { '/overlay.html': html({ scripts: ['js/util.js', 'js/new.js', 'js/overlay.js'] }), '/js/new.js': 'new' },
    { '/overlay.html': html({ scripts: ['js/overlay.js'] }) },
    { '/overlay.html': html({ csp: "default-src 'none'; connect-src https:" }) },
    { '/css/overlay.css': null }
  ]) {
    const r = rig();
    await r.check.check();
    r.site.deploy(change);
    r.site.clock += uc.SETTLE_MS;
    assert.strictEqual(await r.check.check(), true, JSON.stringify(Object.keys(change)));
    assert.deepStrictEqual(r.applied, [{ reload: true }], JSON.stringify(Object.keys(change)));
  }
});

test('a version bump with only a new ?v= and new scripts reloads; the version alone (no Last-Modified) still triggers a look', async () => {
  const r = rig({ lastModified: false });
  await r.check.check();
  r.site.clock += uc.RELOAD_FLOOR_MS;
  r.site.deploy({ '/version.json': '{"version":"1.0.1"}', '/overlay.html': html({ v: '1.0.1' }) });
  assert.strictEqual(await r.check.check(), false, 'a new version with the same files: nothing to swap');
  assert.deepStrictEqual(r.applied, []);
  r.site.fetched.length = 0;
  await r.check.check();
  assert.deepStrictEqual(r.paths(), ['/version.json no-store'], 'compared once, not at every check');
  r.site.deploy({ '/version.json': '{"version":"1.0.2"}', '/js/util.js': 'util v2' });
  assert.strictEqual(await r.check.check(), true);
  assert.deepStrictEqual(r.applied, [{ reload: true }]);
});

test('an answer that is not a version.json, or none at all, or a site that drops out mid-compare, changes nothing', async () => {
  const bad = ['', 'not json', '{"version":5}', '{"version":"latest"}', '<html>404</html>'];
  for (const body of bad) {
    const r = rig();
    await r.check.check();
    r.site.deploy({ '/version.json': body, '/css/overlay.css': 'css v2' });
    r.site.clock += uc.SETTLE_MS;
    assert.strictEqual(await r.check.check(), false, JSON.stringify(body));
    assert.deepStrictEqual(r.applied, [], JSON.stringify(body));
  }
  const gone = rig();
  await gone.check.check();
  gone.site.deploy({ '/version.json': null, '/css/overlay.css': 'css v2' });
  gone.site.clock += uc.SETTLE_MS;
  assert.strictEqual(await gone.check.check(), false);
  assert.deepStrictEqual(gone.applied, []);

  const off = rig();
  await off.check.check();
  off.site.deploy({ '/css/overlay.css': 'css v2' });
  off.site.clock += uc.SETTLE_MS;
  off.site.down = true;
  assert.strictEqual(await off.check.check(), false);
  off.site.down = false;
  let n = 0;
  off.hook = (u, c, get) => (/overlay\.js\?.*u=/.test(u) && n++ === 0 ? Promise.reject(new TypeError('Failed to fetch')) : get(u, c));
  assert.strictEqual(await off.check.check(), false, 'one file missing from the answer: nothing decided');
  assert.deepStrictEqual(off.applied, []);
  assert.strictEqual(await off.check.check(), true, 'the next check gets it all');
  assert.deepStrictEqual(off.applied.map((c) => c.styles.map((s) => s.path)), [['/css/overlay.css']]);
});

test('a page that can\'t read its own files from the cache tries again at the next check, and decides nothing before', async () => {
  const r = rig();
  r.site.down = true;
  assert.strictEqual(await r.check.check(), false);
  r.site.down = false;
  r.site.fetched.length = 0;
  assert.strictEqual(await r.check.check(), false);
  assert.ok(r.paths().includes('/overlay.html force-cache'), 'the first look again');
});

test('start: the first check comes shortly after start, then every interval, one at a time; stop ends it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  r.check.start();
  r.check.start();
  await settle();
  assert.strictEqual(r.site.fetched.length, 0, 'nothing while the page is starting');
  t.mock.timers.tick(uc.START_MS);
  await settle();
  const first = r.site.fetched.length;
  assert.ok(first > 0);
  t.mock.timers.tick(uc.CHECK_MS - 1);
  await settle();
  assert.strictEqual(r.site.fetched.length, first);
  t.mock.timers.tick(1);
  await settle();
  assert.strictEqual(r.site.fetched.length, first + 1, 'one timer: one version.json');
  r.check.stop();
  t.mock.timers.tick(uc.CHECK_MS * 3);
  await settle();
  assert.strictEqual(r.site.fetched.length, first + 1);
});

test('start: checks never overlap; the next is timed from the end of a slow one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  let release = null;
  const fetch0 = r.site.fetchText;
  r.check = uc.createUpdateCheck({ version: '1.0.0', url: ORIGIN + '/version.json', page: PAGE, running: () => ({ scripts: [], styles: [] }),
    apply() { return true; }, now: r.site.now,
    fetchText(u, c) {
      if (/version\.json/.test(u)) return new Promise((res) => { release = () => res(fetch0(u, c)); });
      return fetch0(u, c);
    } });
  r.check.start();
  t.mock.timers.tick(uc.START_MS);
  await settle();
  assert.ok(release, 'asked');
  const asked = r.site.fetched.length;
  t.mock.timers.tick(uc.CHECK_MS * 3);
  await settle();
  assert.strictEqual(r.site.fetched.length, asked, 'no second request while one is out');
  release();
  release = null;
  await settle();
  t.mock.timers.tick(uc.CHECK_MS - 1);
  await settle();
  assert.strictEqual(release, null);
  t.mock.timers.tick(1);
  await settle();
  assert.ok(release, 'the next one, an interval after the slow one ended');
  r.check.stop();
});

test('start: without a version, an address, the page or a way to apply there is nothing to check', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const missing of [{ version: '' }, { url: '' }, { page: '' }, { apply: null }]) {
    const r = rig({}, missing);
    r.check.start();
    t.mock.timers.tick(uc.START_MS + uc.CHECK_MS * 2);
    await settle();
    assert.strictEqual(r.site.fetched.length, 0, JSON.stringify(missing));
  }
});

test('with no fetchText given it uses fetch: a GET with the cache mode asked for, credentials kept to the site', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push([url, init]);
    if (/version\.json/.test(url)) return new Response('{"version":"1.0.0"}', { status: 200, headers: { 'Last-Modified': 'Sun, 11 Oct 2026 01:31:53 GMT' } });
    if (/settings\.js/.test(url)) return new Response('Not Found', { status: 404 });
    return new Response('file ' + new URL(url).pathname, { status: 200 });
  });
  const applied = [];
  const c = uc.createUpdateCheck({ version: '1.0.0', url: ORIGIN + '/version.json', page: PAGE,
    running: () => ({ scripts: [ORIGIN + '/settings.js?v=1.0.0'], styles: [] }), apply(x) { applied.push(x); return true; } });
  assert.strictEqual(await c.check(), false);
  assert.deepStrictEqual(calls.map(([u, i]) => [new URL(u).pathname, i.method, i.cache, i.credentials]), [
    ['/overlay.html', 'GET', 'force-cache', 'same-origin'],
    ['/settings.js', 'GET', 'force-cache', 'same-origin'],
    ['/version.json', 'GET', 'no-store', 'same-origin']]);
  assert.ok(calls.every(([, i]) => i.signal), 'a hung request ends');
  assert.deepStrictEqual(applied, []);
});

test('overlay.html loads it before overlay.js, and its CSP lets the page reach its own site over https', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'overlay.html'), 'utf8');
  const at = (f) => page.indexOf('src="js/' + f + '?v=');
  assert.ok(at('update-check.js') > 0 && at('update-check.js') < at('overlay.js'), 'before overlay.js (boot reads TCO.updateCheck)');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page)[1];
  const connect = csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === 'connect-src');
  assert.ok(connect && connect.indexOf('https:') > 0, 'connect-src allows https, which the files are fetched over');
  // What the check compares is what the page names.
  const named = uc.filesIn(page, PAGE);
  assert.ok(named.scripts.some((u) => /\/js\/overlay\.js\?v=/.test(u)));
  assert.deepStrictEqual(named.styles.map((u) => new URL(u).pathname), ['/css/overlay.css']);
});
