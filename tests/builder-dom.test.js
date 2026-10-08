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
// opts.app: the window is one that gets the app layout. opts.setup(builder, doc): runs before start(), on this
// page's own copy of builder.js (to try GROUPS or META entries no release has yet).
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
  if (opts && opts.setup) opts.setup(builder, doc);
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

test('Kick field: Check fills in the chatroom id; when Kick refuses, it links the page to copy the id from', async (t) => {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  let reply = () => ({ status: 200, body: { slug: 'xqc', user_id: 676, chatroom: { id: 668 }, user: { username: 'xQc' } } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    const r = reply();
    if (r.throws) throw new TypeError('Failed to fetch');
    const txt = JSON.stringify(r.body || {});
    return { status: r.status, ok: r.status === 200, headers: { get: () => null }, text: async () => txt };
  });
  const p = open(t, HREF + '?kick=https://kick.com/XQC');
  await settle();
  assert.deepStrictEqual(calls, ['https://kick.com/api/v2/channels/xqc'], 'a ?kick= link without a chatroom id looks it up');
  const room = p.$('f-kick_room');
  assert.strictEqual(room.value, '668');
  const row = p.$('f-kick').parentNode.parentNode.parentNode;
  const status = row.children.filter((e) => e.getAttribute('role') === 'status')[0];
  assert.strictEqual(status.className, 'status ok');
  assert.match(status.textContent, /xQc found\. Chatroom id 668/);
  assert.match(p.text('bar-url'), /overlay\.html\?kick=xqc&kick_room=668$/);
  assert.strictEqual(p.$('tab-platforms').getAttribute('data-section'), 'platforms');

  // Another channel: the old id goes, and Kick refusing the lookup shows how to copy the id by hand.
  reply = () => ({ throws: true });
  const input = p.$('f-kick');
  input.value = '@Someone_Else';
  input.dispatch('change');
  await settle();
  assert.strictEqual(input.value, 'someone_else');
  assert.strictEqual(room.value, '');
  assert.strictEqual(status.className, 'status warn');
  assert.match(status.textContent, /Kick didn’t allow the lookup/);
  const link = status.children[0].children.filter((e) => e.tagName === 'A')[0];
  assert.strictEqual(link.href, 'https://kick.com/api/v2/channels/someone_else');
  assert.strictEqual(link.rel, 'noopener');
  assert.match(p.text('bar-note'), /chatroom id is missing/);

  // Pasting the whole channel page into the chatroom id field reads the id out of it.
  room.value = JSON.stringify({ slug: 'someone_else', chatroom: { id: 4598 } });
  room.dispatch('change');
  assert.strictEqual(room.value, '4598');
  room.value = 'not a number';
  room.dispatch('change');
  assert.strictEqual(room.getAttribute('aria-invalid'), 'true');
  assert.match(p.text('bar-url'), /kick=someone_else&kick_room=4598$/);
});

// A field's row, from its label (label < .field-name < .field-head < .field).
const rowOf = (p, key) => p.$('l-' + key).parentNode.parentNode.parentNode;

test('Badges & paints: the sources are one labelled grid under Show badges, with their help last', (t) => {
  const p = open(t, HREF);
  const body = p.$('group-badges').children.filter((e) => e.className === 'fields')[0];
  assert.deepStrictEqual(body.children.map((e) => e.className + (e.getAttribute('data-key') ? ' ' + e.getAttribute('data-key') : '')),
    ['field field-check badges', 'subgrid', 'field field-check paints', 'field field-check stv_lookup', 'field field-check readable']);
  const grid = body.children[1];
  assert.deepStrictEqual([grid.tagName, grid.getAttribute('role'), grid.getAttribute('aria-label')], ['DIV', 'group', 'Badge sources']);
  const rows = grid.children.slice(0, -1), help = grid.children[grid.children.length - 1];
  assert.deepStrictEqual(rows.map((e) => e.getAttribute('data-key')), p.builder.BADGE_SUBS);
  rows.forEach((e) => assert.strictEqual(e.className, 'field field-check sub'));
  assert.deepStrictEqual([help.tagName, help.className], ['P', 'help']);
  assert.match(help.textContent, /^Twitch covers sub, mod, VIP and bits badges\./);
  // No sub-heading or "More in Advanced" anywhere until a section has one.
  ['group-look', 'group-badges', 'group-advanced'].forEach((id) => {
    assert.deepStrictEqual(p.$(id).byClass('subhead'), [], id);
    assert.deepStrictEqual(p.$(id).children.map((e) => e.className), ['section-head', 'fields'].concat(id === 'group-badges' ? ['help section-foot'] : []), id);
  });
});

test('a field that only applies while another setting allows it is greyed out and back, after every kind of change', (t) => {
  const p = open(t, HREF, { setup: (b) => { b.META.first_msg.only = 'vertical'; b.META.shadow.wrap = true; } });
  const state = (key) => {
    const row = rowOf(p, key);
    return [row.classList.contains('disabled'), row.byClass('switch').every((i) => i.disabled === true)];
  };
  const subs = p.builder.BADGE_SUBS;
  subs.forEach((k) => assert.deepStrictEqual(state(k), [false, false], k));
  const master = p.$('f-badges');
  master.checked = false;
  master.dispatch('change');
  subs.forEach((k) => assert.deepStrictEqual(state(k), [true, true], k + ' with badges off'));
  assert.deepStrictEqual(state('paints'), [false, false], 'other fields are not touched');
  master.checked = true;
  master.dispatch('change');
  subs.forEach((k) => assert.deepStrictEqual(state(k), [false, false], k + ' with badges on again'));
  // A paste, and Reset
  p.$('paste').value = '?badges=0';
  p.$('paste-load').dispatch('click');
  subs.forEach((k) => assert.deepStrictEqual(state(k), [true, true], k + ' after a paste'));
  p.$('reset').dispatch('click');
  subs.forEach((k) => assert.deepStrictEqual(state(k), [false, false], k + ' after Reset'));
  // META.only follows the layout.
  assert.deepStrictEqual(state('first_msg'), [false, false]);
  const pick = (v) => {
    const r = p.doc.querySelectorAll('input[name="f-layout"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  pick('horizontal');
  assert.deepStrictEqual(state('first_msg'), [true, true], 'vertical only: off in a row');
  pick('vertical');
  assert.deepStrictEqual(state('first_msg'), [false, false]);
  // META.wrap: a segmented field that may wrap, like Add to OBS's routes.
  assert.strictEqual(p.$('l-shadow').parentNode.parentNode.byClass('seg')[0].className, 'seg wrap field-control');
  assert.strictEqual(p.$('l-size').parentNode.parentNode.byClass('seg')[0].className, 'seg field-control');
});

// Look with a sub-heading and a More in Advanced link, Advanced with a heading. focused: what a heading's
// focus() was called on.
function withHeadings(focused) {
  return (b, doc) => {
    b.GROUPS[0].subs = [{ title: 'Text', first: 'size' }];
    b.GROUPS[0].more = 'adv-trouble';
    b.GROUPS[b.GROUPS.length - 1].subs = [{ id: 'adv-trouble', title: 'Troubleshooting', first: 'debug' }];
    const make = doc.createElement;
    doc.createElement = (tag) => {
      const e = make(tag);
      if (tag === 'h3') e.focus = () => focused.push(e);
      return e;
    };
  };
}

test('a link to an Advanced sub-heading opens Advanced, and leaves the focus alone while the page loads', (t) => {
  const focused = [];
  const p = open(t, HREF + '#adv-trouble', { setup: withHeadings(focused) });
  assert.strictEqual(p.$('group-advanced').hidden, false);
  assert.strictEqual(p.$('tab-advanced').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(focused, []);
});

test('sub-headings go above their field; More in Advanced opens Advanced at its heading and moves the focus there', (t) => {
  const focused = [];
  const p = open(t, HREF, { setup: withHeadings(focused) });
  const fields = (id) => p.$(id).children.filter((e) => e.className === 'fields')[0].children;
  const look = fields('group-look');
  const i = look.findIndex((e) => e.tagName === 'H3');
  assert.deepStrictEqual([look[i].className, look[i].textContent, !!look[i].id], ['eyebrow subhead', 'Text', false]);
  assert.strictEqual(look[i + 1].getAttribute('data-key'), 'size');
  const adv = fields('group-advanced');
  assert.deepStrictEqual(adv.map((e) => e.tagName === 'H3' ? 'h3#' + e.id : e.getAttribute('data-key')), ['h3#adv-trouble', 'debug', 'demo']);
  const heading = adv[0];
  assert.strictEqual(heading.tabIndex, -1);
  // The link is the section's foot: an <a> to the heading's anchor.
  const foot = p.$('group-look').children[2];
  assert.strictEqual(foot.className, 'section-foot');
  const link = foot.children[0];
  assert.deepStrictEqual([link.tagName, link.className, link.textContent, link.href], ['A', 'btn ghost', 'More in Advanced', '#adv-trouble']);
  // Followed: the hash changes, Advanced opens and its heading scrolls into view and takes the focus.
  let scrolled = false;
  heading.scrollIntoView = () => { scrolled = true; };
  p.doc.activeElement = link;
  globalThis.location.hash = '#adv-trouble';
  p.doc.defaultView.dispatch('hashchange');
  assert.strictEqual(p.$('group-advanced').hidden, false);
  assert.strictEqual(p.$('group-look').hidden, true);
  assert.strictEqual(scrolled, true);
  assert.deepStrictEqual(focused, [heading]);
});
