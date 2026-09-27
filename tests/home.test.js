'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../js/config.js');
const home = require('../js/home.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('old builder links (any overlay setting in the query) go on to the builder; other queries stay', () => {
  const yes = ['?channel=xqc', '?channel=xqc&size=large&fade=30', '?CHANNEL=xqc', '?size=large', '?demo=1', '?utm_source=x&channel=forsen', 'channel=xqc'];
  const no = ['', '?', '?utm_source=twitter', '?ref=readme&x=1', '?__proto__=1', '?constructor=1', '?toString=1'];
  yes.forEach((s) => assert.strictEqual(home.isBuilderLink(s, config.SPEC), true, s));
  no.forEach((s) => assert.strictEqual(home.isBuilderLink(s, config.SPEC), false, s));
  assert.strictEqual(home.isBuilderLink('?channel=xqc', undefined), false, 'config.js missing: stay on the home page');
  config.KEYS.forEach((k) => assert.strictEqual(home.isBuilderLink('?' + k + '=1', config.SPEC), true, k));
});

function fakeButton() {
  return { hidden: true, textContent: '', heard: [], addEventListener(type, fn) { this.heard.push([type, fn]); }, click() { this.heard.forEach((h) => h[1]()); } };
}

// opts: readyState, without (a demo box left out of the page), reduced (prefers-reduced-motion), buttons (false: none)
function fakePage(search, protocol, opts) {
  opts = opts || {};
  const made = [];
  const boxes = {};
  const buttons = {};
  const heard = [];
  home.DEMOS.forEach((d) => {
    if (d.box === opts.without) return;
    // seen: what the frame carried when it went into the page, which is when a browser starts loading it
    boxes[d.box] = {
      firstChild: { grip: true }, kids: [], seen: [],
      insertBefore(el, before) {
        el.parentNode = this;
        this.kids.push([el, before]);
        this.seen.push({ sandbox: el.attrs.sandbox, loading: el.attrs.loading, src: el.src });
      },
      removeChild(el) { el.parentNode = null; this.removed = (this.removed || 0) + 1; }
    };
    if (opts.buttons !== false) buttons[d.box + '-toggle'] = fakeButton();
  });
  const loc = { search: search, hash: '#setup', protocol: protocol, replaced: null, replace(u) { this.replaced = u; } };
  const doc = {
    readyState: opts.readyState || 'complete',
    addEventListener(type, fn) { heard.push([type, fn]); },
    getElementById: (id) => boxes[id] || buttons[id] || null,
    createElement(tag) {
      const el = { tag: tag, attrs: {}, parentNode: null, setAttribute(k, v) { this.attrs[k] = v; } };
      made.push(el);
      return el;
    }
  };
  return { loc, doc, made, boxes, buttons, heard, reduced: !!opts.reduced };
}

function startWith(page) {
  const keep = { location: globalThis.location, document: globalThis.document, TCO: globalThis.TCO, matchMedia: globalThis.matchMedia };
  // js/home.js reads root.location, root.document, root.matchMedia and root.TCO.config (root is globalThis under node)
  globalThis.location = page.loc;
  globalThis.document = page.doc;
  globalThis.matchMedia = (q) => ({ matches: page.reduced && /prefers-reduced-motion: reduce/.test(q) });
  globalThis.TCO = { config: config };
  try { home.start(); } finally {
    Object.keys(keep).forEach((k) => { if (keep[k] === undefined) delete globalThis[k]; else globalThis[k] = keep[k]; });
  }
}

test('start: a builder link is replaced with builder.html, query and hash untouched, and no demo is started', () => {
  const p = fakePage('?channel=xqc&size=large', 'https:');
  startWith(p);
  assert.strictEqual(p.loc.replaced, 'builder.html?channel=xqc&size=large#setup');
  assert.strictEqual(p.made.length, 0);
});

test('demoSrc: every setting is named and the channel is empty, so a settings.js cannot change a demo', () => {
  home.DEMOS.forEach((d) => {
    assert.match(d.src, /^overlay\.html\?demo=1(?:&[a-z_]+=[a-z0-9]+)*$/, 'a relative URL on this site');
    const url = home.demoSrc(d.src, config);
    assert.ok(url.startsWith('overlay.html?'), url);
    const q = new URLSearchParams(url.slice(url.indexOf('?')));
    assert.deepStrictEqual([...q.keys()].sort(), [...config.KEYS].sort());
    assert.strictEqual(q.get('channel'), '');
    // what a folder's settings.js might hold loses to the URL on every key
    const local = { channel: 'someone', layout: 'horizontal', size: 'large', bots: true, block: ['a'], history: 50, demo: false, fade: 9 };
    const want = config.parse(d.src.slice(d.src.indexOf('?')));
    assert.deepStrictEqual(config.parse(url.slice(url.indexOf('?')), local), want);
    assert.strictEqual(want.demo, true);
    assert.strictEqual(want.channel, '');
  });
  assert.strictEqual(config.parse(home.demoSrc(home.DEMOS[0].src, config).split('?')[1]).layout, 'vertical');
  assert.strictEqual(config.parse(home.demoSrc(home.DEMOS[1].src, config).split('?')[1]).layout, 'horizontal');
  assert.strictEqual(home.demoSrc('overlay.html?demo=1', undefined), 'overlay.html?demo=1', 'config.js missing: the plain URL');
  assert.strictEqual(config.parse(home.demoSrc('overlay.html?demo=1&animate=0', config).split('?')[1]).animate, false);
});

test('start: the demo frames are overlay.html in demo mode on this site, sandboxed to scripts only', () => {
  const p = fakePage('', 'https:');
  startWith(p);
  assert.strictEqual(p.loc.replaced, null);
  assert.deepStrictEqual(p.made.map((f) => f.src), home.DEMOS.map((d) => home.demoSrc(d.src, config)));
  p.made.forEach((f, i) => {
    assert.strictEqual(f.tag, 'iframe');
    assert.strictEqual(f.attrs.sandbox, 'allow-scripts');
    assert.ok(f.title.length > 10, 'the frame is named for screen readers');
    assert.strictEqual(f.attrs.tabindex, '-1', 'not a Tab stop: nothing inside takes focus');
    const box = p.boxes[home.DEMOS[i].box];
    assert.strictEqual(box.kids[0][0], f);
    assert.strictEqual(box.kids[0][1], box.firstChild, 'under the frame handles');
    assert.strictEqual(config.parse(f.src.slice(f.src.indexOf('?'))).animate, true);
  });
  assert.strictEqual(p.made[0].attrs.loading, undefined, 'the first demo is on screen at once');
  assert.strictEqual(p.made[1].attrs.loading, 'lazy');
});

test('start: while the page is still loading (home.js is in the head), the demos wait for DOMContentLoaded', () => {
  const p = fakePage('', 'https:', { readyState: 'loading' });
  startWith(p);
  assert.strictEqual(p.made.length, 0, 'the boxes are not in the page yet');
  assert.deepStrictEqual(p.heard.map((h) => h[0]), ['DOMContentLoaded']);
  const keep = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false });
  try { p.heard[0][1](); } finally { if (keep === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = keep; }
  assert.deepStrictEqual(p.made.map((f) => f.src), home.DEMOS.map((d) => home.demoSrc(d.src, config)));
});

test('start: a frame is sandboxed and marked lazy before it goes into the page, not after', () => {
  const p = fakePage('', 'https:');
  startWith(p);
  home.DEMOS.forEach((d) => {
    assert.deepStrictEqual(p.boxes[d.box].seen,
      [{ sandbox: 'allow-scripts', loading: d.lazy ? 'lazy' : undefined, src: home.demoSrc(d.src, config) }], d.box);
  });
});

test('start: a demo whose box is missing is skipped, and the other one still starts', () => {
  const p = fakePage('', 'https:', { without: home.DEMOS[0].box });
  startWith(p);
  assert.deepStrictEqual(p.made.map((f) => f.src), [home.demoSrc(home.DEMOS[1].src, config)]);
  assert.strictEqual(home.addDemo(p.doc, 'https:', home.DEMOS[0], config), null);
});

test('each demo has a button that stops it (the frame is removed) and starts it again', () => {
  const p = fakePage('', 'https:');
  startWith(p);
  home.DEMOS.forEach((d) => {
    const btn = p.buttons[d.box + '-toggle'];
    const box = p.boxes[d.box];
    assert.strictEqual(btn.hidden, false);
    assert.strictEqual(btn.textContent, 'Pause ' + d.name);
    btn.click();
    assert.strictEqual(box.removed, 1);
    assert.strictEqual(box.kids[0][0].parentNode, null);
    assert.strictEqual(btn.textContent, 'Play ' + d.name);
    btn.click();
    assert.strictEqual(box.kids.length, 2, 'a fresh frame');
    assert.strictEqual(box.kids[1][0].attrs.sandbox, 'allow-scripts');
    assert.strictEqual(btn.textContent, 'Pause ' + d.name);
  });
  assert.strictEqual(new Set(home.DEMOS.map((d) => d.name)).size, home.DEMOS.length, 'the buttons have different names');
});

test('reduced motion: no demo starts by itself, and one started by hand does not slide messages in', () => {
  const p = fakePage('', 'https:', { reduced: true });
  startWith(p);
  assert.strictEqual(p.made.length, 0);
  home.DEMOS.forEach((d) => {
    const btn = p.buttons[d.box + '-toggle'];
    assert.strictEqual(btn.hidden, false);
    assert.strictEqual(btn.textContent, 'Play ' + d.name);
    btn.click();
    const f = p.boxes[d.box].kids[0][0];
    const cfg = config.parse(f.src.slice(f.src.indexOf('?')));
    assert.strictEqual(cfg.animate, false);
    assert.strictEqual(cfg.demo, true);
    assert.strictEqual(btn.textContent, 'Pause ' + d.name);
  });
  // without its button a demo could never be started, so it starts (still without the slide)
  const q = fakePage('', 'https:', { reduced: true, buttons: false });
  startWith(q);
  assert.strictEqual(q.made.length, home.DEMOS.length);
  q.made.forEach((f) => assert.strictEqual(config.parse(f.src.slice(f.src.indexOf('?'))).animate, false));
});

test('start: from disk the demo frames run unsandboxed, like the builder preview', () => {
  assert.strictEqual(home.frameSandbox('https:'), 'allow-scripts');
  assert.strictEqual(home.frameSandbox('http:'), 'allow-scripts');
  assert.strictEqual(home.frameSandbox('file:'), null);
  const p = fakePage('', 'file:');
  startWith(p);
  assert.strictEqual(p.made.length, 2);
  p.made.forEach((f) => assert.strictEqual(f.attrs.sandbox, undefined));
  assert.ok(read('js/home.js').indexOf('allow-same-origin') < 0);
});

test('index.html: the demo boxes and their buttons exist, config.js loads before home.js, and the builder is linked', () => {
  const html = read('index.html');
  home.DEMOS.forEach((d) => {
    assert.match(html, new RegExp('id="' + d.box + '"'), d.box);
    assert.match(html, new RegExp('<button type="button" class="toggle" id="' + d.box + '-toggle" hidden>Pause ' + d.name + '</button>'), d.box + ' button');
  });
  const cfgAt = html.indexOf('src="js/config.js');
  const homeAt = html.indexOf('src="js/home.js');
  assert.ok(cfgAt > 0 && cfgAt < homeAt);
  assert.ok(homeAt < html.indexOf('<link rel="stylesheet"'), 'an old builder link is passed on before the page is styled or drawn');
  assert.ok((html.match(/href="builder\.html"/g) || []).length >= 3, 'nav, hero and closing all open the builder');
  assert.doesNotMatch(html, /\sstyle="/, 'no inline styles: the policy would drop them');
  assert.ok(fs.existsSync(path.join(ROOT, home.BUILDER)));
});

test('index.html: every local image, stylesheet and script it names exists', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1])
    .filter((u) => !/^(?:https?:|data:)/.test(u))
    .map((u) => u.replace(/\?.*$/, ''));
  assert.ok(refs.length > 5);
  refs.forEach((u) => assert.ok(fs.existsSync(path.join(ROOT, u)), u + ' is missing'));
});
