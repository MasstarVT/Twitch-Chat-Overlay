'use strict';
// builder.start() against builder.html, read into the fake DOM: what the page draws, not only what the helpers return.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createDocument } = require('./fake-dom.js');

const ROOT = path.join(__dirname, '..');
const VOID = /^(?:meta|link|input|br|hr|img)$/;
const PROPS = ['id', 'type', 'name', 'value'];

function walk(node, fn) {
  for (const k of node.childNodes) {
    if (k.nodeType !== 1) continue;
    fn(k);
    walk(k, fn);
  }
}

// builder.html's <body> as fake-dom elements (tags, attributes and text; no scripts, no comments).
function readPage(doc) {
  const html = fs.readFileSync(path.join(ROOT, 'builder.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const body = html.slice(html.indexOf('<body'));
  const stack = [doc.body];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { if (m[4].trim()) top.appendChild(doc.createTextNode(m[4])); continue; }
    const tag = m[2].toLowerCase();
    if (tag === 'body' || tag === 'html') continue;
    if (m[1]) { assert.strictEqual(stack.pop().tagName, tag.toUpperCase(), 'builder.html nests its tags'); continue; }
    const el = doc.createElement(tag);
    if (tag === 'input' || tag === 'textarea') el.value = ''; // as in a browser, where a field holds '' until told otherwise
    for (const a of m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      el.setAttribute(a[1], a[2] || '');
      if (PROPS.indexOf(a[1]) >= 0) el[a[1]] = a[2];
      if (a[1] === 'class') el.className = a[2];
      if (a[1] === 'hidden' || a[1] === 'checked') el[a[1]] = true;
    }
    top.appendChild(el);
    if (!VOID.test(tag) && !/\/\s*$/.test(m[3])) stack.push(el);
  }
  assert.strictEqual(stack.length, 1, 'every tag in builder.html is closed');
}

// A page with builder.js started on it. Timers are the test's (t.mock), so no preview reload runs by itself.
// opts.app: the window is one that gets the app layout.
function open(t, href, opts) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  readPage(doc);
  doc.getElementById = (id) => {
    let hit = null;
    walk(doc.documentElement, (e) => { if (!hit && e.id === id) hit = e; });
    return hit;
  };
  doc.querySelectorAll = (sel) => {
    const out = [], byName = /^input\[name="([\w-]+)"\]$/.exec(sel), byClass = /^\.([\w-]+)$/.exec(sel);
    assert.ok(byName || byClass, 'a selector this page does not model: ' + sel);
    walk(doc.documentElement, (e) => {
      if (byName ? e.tagName === 'INPUT' && e.name === byName[1] : e.classList.contains(byClass[1])) out.push(e);
    });
    return out;
  };
  const url = new URL(href);
  const win = doc.defaultView;
  const keep = {};
  const put = {
    document: doc,
    location: { href: url.href, search: url.search, hash: url.hash, protocol: url.protocol, pathname: url.pathname },
    addEventListener: win.addEventListener,
    getComputedStyle: () => ({}),
    innerHeight: 900,
    TCO_NO_AUTOBOOT: true
  };
  if (opts && opts.app) put.matchMedia = () => ({ matches: true, addEventListener() {} });
  Object.keys(put).forEach((k) => { keep[k] = Object.getOwnPropertyDescriptor(globalThis, k); globalThis[k] = put[k]; });
  t.after(() => Object.keys(put).forEach((k) => {
    delete globalThis[k];
    if (keep[k]) Object.defineProperty(globalThis, k, keep[k]);
  }));
  // A page of its own: builder.js keeps the started page in the module.
  const file = require.resolve('../js/builder.js');
  delete require.cache[file];
  const builder = require(file);
  builder.start();
  const $ = (id) => doc.getElementById(id);
  return { doc, $, builder, text: (id) => $(id).textContent, kids: (id, cls) => $(id).byClass(cls).map((e) => e.textContent) };
}

const HREF = 'https://masstarvt.github.io/Twitch-Chat-Overlay/builder.html';

test('start: every section has a tab that controls it, and one is open', (t) => {
  const p = open(t, HREF);
  const tabs = p.$('tabs').children.filter((e) => e.getAttribute('role') === 'tab');
  assert.deepStrictEqual(tabs.map((e) => e.getAttribute('data-section')), p.builder.sectionIds());
  tabs.forEach((tab) => {
    const panel = p.$(tab.getAttribute('aria-controls'));
    assert.ok(panel, tab.id + ' controls ' + tab.getAttribute('aria-controls'));
    assert.strictEqual(panel.getAttribute('role'), 'tabpanel');
    assert.strictEqual(panel.getAttribute('aria-labelledby'), tab.id);
    assert.strictEqual(!panel.hidden, tab.getAttribute('aria-selected') === 'true', tab.id);
  });
  assert.deepStrictEqual(tabs.filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => e.id), ['tab-look']);
});

test('start: builder.html#obs opens Add to OBS, with one route shown at a time', (t) => {
  const p = open(t, HREF + '#obs');
  assert.strictEqual(p.$('group-obs').hidden, false);
  assert.strictEqual(p.$('group-look').hidden, true);
  assert.deepStrictEqual([p.$('obs-url').hidden, p.$('obs-local').hidden], [false, true]);
  const local = p.doc.querySelectorAll('input[name="route"]').filter((r) => r.value === 'local')[0];
  local.checked = true;
  local.dispatch('change');
  assert.deepStrictEqual([p.$('obs-url').hidden, p.$('obs-local').hidden], [true, false]);
});

test('the form: switches, and steppers that read "Never" and "5 s" and step the way their buttons say', (t) => {
  const p = open(t, HREF);
  const bots = p.$('f-bots');
  assert.strictEqual(bots.type, 'checkbox');
  assert.strictEqual(bots.getAttribute('role'), 'switch');
  assert.strictEqual(bots.checked, false);
  const fade = p.$('f-fade');
  assert.strictEqual(fade.getAttribute('role'), 'spinbutton');
  assert.strictEqual(fade.value, 'Never');
  const [less, , more] = fade.parentNode.children;
  assert.deepStrictEqual([less.getAttribute('aria-label'), more.getAttribute('aria-label')], ['Less', 'More']);
  // a count has fewer, not less
  assert.strictEqual(p.$('f-max').parentNode.children[0].getAttribute('aria-label'), 'Fewer');
  more.dispatch('click');
  assert.strictEqual(fade.value, '5 s');
  assert.strictEqual(fade.getAttribute('aria-valuenow'), '5');
  more.dispatch('click');
  assert.strictEqual(fade.value, '10 s');
  less.dispatch('click');
  assert.strictEqual(fade.value, '5 s');
  assert.strictEqual(p.text('out-url'), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?fade=5');
});

test('a changed setting shows in its tag, on its tab and in the URL bar', (t) => {
  const p = open(t, HREF);
  const tagOf = (key) => p.$('l-' + key).parentNode.byClass('tag')[0];
  const group = (key) => p.builder.groupLayout().filter((g) => g.keys.indexOf(key) >= 0)[0].id;
  assert.strictEqual(tagOf('bots').textContent, 'bots');
  assert.strictEqual(tagOf('bots').classList.contains('changed'), false);
  assert.strictEqual(p.text('count-' + group('bots')), '');
  assert.strictEqual(p.text('bar-url'), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html');
  assert.deepStrictEqual(p.kids('bar-url', 'k'), []);

  const bots = p.$('f-bots');
  bots.checked = true;
  bots.dispatch('change');
  assert.strictEqual(tagOf('bots').textContent, 'bots=1');
  assert.strictEqual(tagOf('bots').classList.contains('changed'), true);
  assert.strictEqual(tagOf('size').classList.contains('changed'), false);
  assert.strictEqual(p.text('count-' + group('bots')), '1');
  assert.strictEqual(p.$('tab-' + group('bots')).getAttribute('aria-label'), 'Filters, 1 changed');
  assert.strictEqual(p.text('bar-url'), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?bots=1');
  assert.deepStrictEqual(p.kids('bar-url', 'k'), ['bots']);
  assert.deepStrictEqual(p.kids('bar-url', 'v'), ['1']);
  assert.strictEqual(p.$('bar-open').href, p.text('bar-url'));
  // The URL is one flex item, so that a selection of it copies no line breaks.
  assert.deepStrictEqual(p.$('bar-url').children.map((e) => e.className), ['url-line']);

  bots.checked = false;
  bots.dispatch('change');
  assert.strictEqual(tagOf('bots').textContent, 'bots');
  assert.strictEqual(tagOf('bots').classList.contains('changed'), false);
  assert.strictEqual(p.text('count-' + group('bots')), '');
  assert.deepStrictEqual(p.kids('bar-url', 'k'), []);
});

test('the channel field: a name typed but not looked up says how to look it up', (t) => {
  const p = open(t, HREF);
  const field = p.$('channel');
  assert.match(p.text('channel-status'), /^Enter your channel/);
  assert.strictEqual(field.classList.contains('need'), true);
  field.value = 'fors';
  field.dispatch('input');
  assert.strictEqual(p.text('channel-status'), 'Press Enter or Check to look up the name.');
  // Nothing is committed by typing: the URL keeps what was checked.
  assert.strictEqual(p.text('bar-url'), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html');
  assert.match(p.text('bar-note'), /^Add a channel first/);
  field.value = '';
  field.dispatch('input');
  assert.match(p.text('channel-status'), /^Enter your channel/);
});

test('a stepper button says the new value, which the button that keeps the focus cannot', (t) => {
  const p = open(t, HREF);
  const [less, , more] = p.$('f-fade').parentNode.children;
  more.dispatch('click');
  more.dispatch('click');
  t.mock.timers.tick(30);
  assert.strictEqual(p.text('sr-status'), '10 s', 'two fast clicks: the later value');
  less.dispatch('click');
  less.dispatch('click');
  t.mock.timers.tick(30);
  assert.strictEqual(p.text('sr-status'), 'Never');
});

test('what did not change is not written again: the channel status, and the URL with a selection on it', (t) => {
  const p = open(t, HREF);
  const status = p.$('channel-status').childNodes[0], line = p.$('bar-url').children[0];
  const snippet = p.$('out-settings').childNodes[0];
  assert.match(status.textContent, /^Enter your channel/);
  p.$('reset').dispatch('click');
  assert.strictEqual(p.$('channel-status').childNodes[0], status);
  assert.strictEqual(p.$('bar-url').children[0], line);
  assert.strictEqual(p.$('out-settings').childNodes[0], snippet);
  // Enter on the empty field commits the same nothing
  p.$('channel').dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(p.$('channel-status').childNodes[0], status);
  // a change is written
  const bots = p.$('f-bots');
  bots.checked = true;
  bots.dispatch('change');
  assert.notStrictEqual(p.$('bar-url').children[0], line);
  assert.strictEqual(p.text('bar-url'), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?bots=1');
  assert.match(p.text('out-settings'), /bots/);
  p.$('channel').value = 'fors';
  p.$('channel').dispatch('input');
  assert.notStrictEqual(p.$('channel-status').childNodes[0], status);
});

test('the paste box: over the page, a click elsewhere closes it, but not the end of a selection dragged out of it', (t) => {
  const p = open(t, HREF, { app: true });
  const box = p.$('paste-box'), tab = p.$('tab-look');
  box.open = true;
  p.doc.dispatch('pointerdown', { target: p.$('paste') });
  p.doc.dispatch('click', { target: p.$('builder') });
  assert.strictEqual(box.open, true, 'pressed inside, released outside');
  p.doc.dispatch('pointerdown', { target: p.$('paste') });
  p.doc.dispatch('click', { target: p.$('paste') });
  assert.strictEqual(box.open, true, 'a click inside');
  p.doc.dispatch('pointerdown', { target: tab });
  p.doc.dispatch('click', { target: tab });
  assert.strictEqual(box.open, false, 'a click elsewhere');
  box.open = true;
  p.doc.dispatch('click', { target: tab }); // from the keyboard: no press comes first
  assert.strictEqual(box.open, false);
});

test('the paste box: in one column it is part of the page, and a click elsewhere leaves it open', (t) => {
  const p = open(t, HREF);
  const box = p.$('paste-box'), tab = p.$('tab-look');
  box.open = true;
  p.doc.dispatch('pointerdown', { target: tab });
  p.doc.dispatch('click', { target: tab });
  assert.strictEqual(box.open, true);
});

test('the tag line: its two halves are in builder.html, and the mode is the one written', (t) => {
  const p = open(t, HREF);
  assert.deepStrictEqual(p.$('tag-text').children.map((e) => e.id), ['tag-src', 'tag-mode']);
  assert.strictEqual(p.text('tag-text'), 'Browser source · demo');
  assert.strictEqual(p.$('tag-src').hidden, false);
});

test('the app layout: the settings come before the preview, Home and GitHub end the top bar', (t) => {
  const p = open(t, HREF, { app: true });
  assert.deepStrictEqual(p.$('channel-card').parentNode.children.map((e) => e.id || e.className),
    ['brand-h', 'channel-card', 'paste-box', 'site']);
  assert.deepStrictEqual(p.$('builder').children.map((e) => e.id || e.className),
    ['top', 'settings', 'preview', 'bar']);
});

test('the top bar: Home and GitHub follow the brand in one column', (t) => {
  const p = open(t, HREF);
  const top = p.$('channel-card').parentNode;
  assert.deepStrictEqual(top.children.map((e) => e.id || e.className),
    ['brand-h', 'site', 'channel-card', 'paste-box']);
  // and the settings follow the preview, as they do on screen there
  assert.deepStrictEqual(p.$('builder').children.map((e) => e.id || e.className),
    ['top', 'preview', 'settings', 'bar']);
});
