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
// page's own copy of builder.js (to try GROUPS or META entries no release has yet). opts.storage: the page's
// localStorage (memoryStorage()); without one the builder remembers nothing, as with storage blocked.
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
  if (opts && opts.storage) put.localStorage = opts.storage;
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

// A localStorage kept in a Map, for open()'s opts.storage.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

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
    ['field field-check badges', 'subgrid', 'field field-check paints', 'field field-check stv_lookup', 'field field-check readable',
      'field field-range badge_size']);
  const grid = body.children[1];
  assert.deepStrictEqual([grid.tagName, grid.getAttribute('role'), grid.getAttribute('aria-label')], ['DIV', 'group', 'Badge sources']);
  const rows = grid.children.slice(0, -1), help = grid.children[grid.children.length - 1];
  assert.deepStrictEqual(rows.map((e) => e.getAttribute('data-key')), p.builder.BADGE_SUBS);
  rows.forEach((e) => assert.strictEqual(e.className, 'field field-check sub'));
  assert.deepStrictEqual([help.tagName, help.className], ['P', 'help']);
  assert.match(help.textContent, /^Twitch covers sub, mod, VIP and bits badges\./);
  // No sub-heading here; the DankChat note, then "More in Advanced" to the lighter-on-PC switches.
  assert.strictEqual(p.$('group-badges').byClass('subhead').length, 0);
  assert.deepStrictEqual(p.$('group-badges').children.map((e) => e.className), ['section-head', 'fields', 'help section-foot', 'section-foot']);
  // One rule over the two: the link's foot drops its own (a section with only one keeps its look).
  const css = fs.readFileSync(path.join(ROOT, 'css', 'builder.css'), 'utf8');
  assert.match(css, /\n\.section-foot \{ padding: 12px 0 4px; border-top: 1px solid var\(--border\); \}/);
  assert.match(css, /\n\.section-foot \+ \.section-foot \{ padding-top: 8px; border-top: 0; \}/);
  const more = p.$('group-badges').children[3].children[0];
  assert.deepStrictEqual([more.tagName, more.textContent, more.href], ['A', 'More in Advanced', '#adv-lighter']);
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

// focused: what a sub-heading's focus() was called on.
function watchFocus(focused) {
  return (b, doc) => {
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
  const p = open(t, HREF + '#adv-box', { setup: watchFocus(focused) });
  assert.strictEqual(p.$('group-advanced').hidden, false);
  assert.strictEqual(p.$('tab-advanced').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(focused, []);
});

test('sub-headings go above their field; More in Advanced opens Advanced at its heading and moves the focus there', (t) => {
  const focused = [];
  const p = open(t, HREF, { setup: watchFocus(focused) });
  const fields = (id) => p.$(id).children.filter((e) => e.className === 'fields')[0].children;
  const outline = (id) => fields(id).map((e) => (e.tagName === 'H3' ? e.textContent + (e.id ? '#' + e.id : '')
    : e.classList.contains('field-presets') ? 'quick looks' : e.getAttribute('data-key')));
  fields('group-look').filter((e) => e.tagName === 'H3').forEach((e) => {
    assert.strictEqual(e.className, 'eyebrow subhead');
    assert.strictEqual(e.id, undefined, 'only Advanced headings are anchors');
  });
  // Look starts with the quick looks, above its first heading.
  assert.deepStrictEqual(outline('group-look'), ['quick looks', 'Layout', 'layout', 'align', 'text_align', 'Text', 'size', 'font', 'text_weight',
    'text_color', 'shadow', 'outline', 'Names', 'name_color', 'name_line', 'Box', 'bg', 'bg_color', 'accent_bar', 'Animation', 'animate',
    'enter_style']);
  assert.deepStrictEqual(outline('group-advanced'), ['Troubleshooting#adv-trouble', 'debug', 'demo', 'Text#adv-text', 'text_px',
    'line_height', 'text_case', 'shadow_color', 'outline_color', 'Names#adv-names', 'names', 'name_weight', 'name_font', 'name_fallback',
    'name_sep', 'readable_level', 'Box#adv-box', 'bg_shape', 'bg_width', 'spacing', 'Layout#adv-layout', 'line_width', 'pad_x', 'edge_fade',
    'row_sep', 'Animation#adv-animation', 'enter_ms', 'fade_out_ms', 'exit_style', 'Chat events#adv-events', 'notice_color', 'notice_size', 'first_msg_color', 'reply_style', 'Highlights#adv-highlights',
    'mention_color', 'keywords', 'highlight_users', 'keyword_color', 'points_highlight', 'points_color', 'role_style', 'broadcaster_color',
    'mod_color', 'vip_color', 'Filters#adv-filters', 'allow_users', 'min_length', 'command_prefixes', 'Emotes#adv-emotes', 'gif_size',
    'giant_emotes', 'Lighter on PC#adv-lighter', 'shadow_style', 'paint_images', 'homies_lists']);
  // Chat events: the Event types grid under its switch, and a heading over the mentions and timestamps (no anchor:
  // only Advanced's headings have one).
  assert.deepStrictEqual(outline('group-events'), ['events', null, 'replies', 'first_msg', 'shared', 'Highlights & timestamps', 'mentions',
    'timestamps']);
  // Filters: no heading, and its foot links Advanced's Filters.
  assert.deepStrictEqual(outline('group-filters'), ['bots', 'hide_commands', 'block', 'block_words', 'links', 'role_filter']);
  assert.strictEqual(p.$('group-filters').children[2].children[0].href, '#adv-filters');
  // Emotes: no sub-heading, the two sizes after the GIF switch, and its foot links Advanced's Emotes.
  assert.deepStrictEqual(outline('group-emotes'), ['emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'gifs', 'emote_scale', 'emote_only']);
  assert.strictEqual(p.$('group-emotes').children[2].children[0].href, '#adv-emotes');
  const adv = fields('group-advanced').filter((e) => e.tagName === 'H3');
  adv.forEach((e) => assert.strictEqual(e.tabIndex, -1, e.id));
  // The link is the section's foot: an <a> to the heading's anchor. Chat events has one too.
  const foot = p.$('group-look').children[2];
  assert.strictEqual(foot.className, 'section-foot');
  const link = foot.children[0];
  assert.deepStrictEqual([link.tagName, link.className, link.textContent, link.href], ['A', 'btn ghost', 'More in Advanced', '#adv-text']);
  assert.strictEqual(p.$('group-events').children[2].children[0].href, '#adv-events');
  // Followed: the hash changes, Advanced opens and its heading scrolls into view and takes the focus.
  const heading = adv.filter((e) => e.id === 'adv-text')[0];
  let scrolled = false;
  heading.scrollIntoView = () => { scrolled = true; };
  p.doc.activeElement = link;
  globalThis.location.hash = '#adv-text';
  p.doc.defaultView.dispatch('hashchange');
  assert.strictEqual(p.$('group-advanced').hidden, false);
  assert.strictEqual(p.$('group-look').hidden, true);
  assert.strictEqual(scrolled, true);
  assert.deepStrictEqual(focused, [heading]);
});

// A color field's three controls: the picker, the hex box and Default.
function colorField(p, key) {
  const row = rowOf(p, key);
  const [pick, hex, dflt] = row.byClass('text-row')[0].children;
  return { row, pick, hex, dflt, tag: () => p.$('l-' + key).parentNode.byClass('tag')[0].textContent, err: p.$('e-' + key) };
}
const OVERLAY = 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html';

test('a color field: the picker, a typed hex code, a bad one and Default, live in the preview without a reload', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  assert.ok(frame, 'the preview frame');
  const posted = [];
  frame.contentWindow = { postMessage: (m) => posted.push(m) };
  const c = colorField(p, 'text_color');
  assert.strictEqual(c.row.className, 'field field-color');
  assert.deepStrictEqual([c.pick.tagName, c.pick.type, c.hex.type, c.hex.id, c.dflt.textContent, c.dflt.type],
    ['INPUT', 'color', 'text', 'f-text_color', 'Default', 'button']);
  assert.strictEqual(c.pick.getAttribute('aria-labelledby'), 'l-text_color');
  // '': the picker shows the built-in white, the box is empty, and there is nothing to reset.
  assert.deepStrictEqual([c.pick.value, c.hex.value, c.hex.placeholder, c.dflt.disabled], ['#ffffff', '', '#ffffff', true]);

  c.pick.value = '#ff8800';
  c.pick.dispatch('input');
  assert.deepStrictEqual([c.hex.value, c.dflt.disabled, c.tag()], ['#ff8800', false, 'text_color=ff8800']);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?text_color=ff8800');
  t.mock.timers.tick(30);
  assert.strictEqual(posted[posted.length - 1].cfg.text_color, 'ff8800', 'sent to the preview');

  // Typed: 3 digits, no '#', upper case. While typing the box is left alone; on change it reads back.
  c.hex.value = '0AF';
  c.hex.dispatch('input');
  t.mock.timers.tick(600);
  assert.strictEqual(c.tag(), 'text_color=00aaff');
  assert.strictEqual(c.hex.value, '0AF');
  assert.strictEqual(c.pick.value, '#00aaff');
  c.hex.dispatch('change');
  assert.strictEqual(c.hex.value, '#00aaff');

  // A bad one: an error under the field, the setting as it was.
  c.hex.value = 'orange';
  c.hex.dispatch('change');
  assert.deepStrictEqual([c.err.hidden, c.hex.getAttribute('aria-invalid'), c.tag()], [false, 'true', 'text_color=00aaff']);
  assert.match(c.hex.getAttribute('aria-describedby'), /e-text_color/);

  // Default: back to '', the error gone, the button off again. The focus goes to the picker, not the hex box
  // (which would bring up a phone's keyboard).
  const focused = [];
  c.pick.focus = () => focused.push('pick');
  c.hex.focus = () => focused.push('hex');
  c.dflt.dispatch('click');
  assert.deepStrictEqual([c.hex.value, c.pick.value, c.dflt.disabled, c.err.hidden, c.tag()], ['', '#ffffff', true, true, 'text_color']);
  assert.deepStrictEqual(focused, ['pick']);
  assert.strictEqual(p.text('bar-url'), OVERLAY);
  t.mock.timers.tick(30);
  assert.strictEqual(posted[posted.length - 1].cfg.text_color, '');
  // Live settings: the frame was never reloaded.
  t.mock.timers.tick(2000);
  assert.strictEqual(p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0], frame);
});

test('a color field\'s Default stays off at the built-in color after other changes, a paste, Reset and a layout switch', (t) => {
  const p = open(t, HREF);
  const c = colorField(p, 'text_color'), b = colorField(p, 'bg_color');
  const bots = p.$('f-bots');
  bots.checked = true;
  bots.dispatch('change');
  assert.strictEqual(c.dflt.disabled, true, 'another setting changed');
  // bg_color needs a box: everything in its row is off while bg is 0.
  assert.deepStrictEqual([b.row.classList.contains('disabled'), b.pick.disabled, b.hex.disabled, b.dflt.disabled], [true, true, true, true]);
  p.$('paste').value = '?bg=40&bg_color=%23123&text_color=fff';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual([b.row.classList.contains('disabled'), b.pick.disabled, b.hex.disabled, b.dflt.disabled], [false, false, false, false]);
  assert.deepStrictEqual([b.hex.value, b.pick.value, c.hex.value, c.dflt.disabled], ['#112233', '#112233', '#ffffff', false]);
  p.$('paste').value = '?bg=40';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual([b.hex.value, b.pick.value, b.dflt.disabled, b.pick.disabled], ['', '#000000', true, false], 'pasted without a color');
  assert.strictEqual(c.dflt.disabled, true);
  const pick = (v) => {
    const r = p.doc.querySelectorAll('input[name="f-layout"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  pick('horizontal');
  assert.deepStrictEqual([c.dflt.disabled, b.dflt.disabled, b.pick.disabled], [true, true, false]);
  pick('vertical');
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([c.dflt.disabled, b.dflt.disabled, b.pick.disabled, b.row.classList.contains('disabled')], [true, true, true, true]);
});

test('the stage-2 dependencies: greyed out while bg, events, first_msg or names is off, or in a row', (t) => {
  const p = open(t, HREF);
  const off = (key) => rowOf(p, key).classList.contains('disabled');
  const keys = ['bg_color', 'bg_shape', 'bg_width', 'name_line', 'notice_color', 'notice_size', 'first_msg_color'];
  const state = () => keys.filter(off);
  assert.deepStrictEqual(state(), ['bg_color', 'bg_shape', 'bg_width', 'first_msg_color'], 'defaults: no box, no first-message bar');
  p.$('paste').value = '?bg=40&first_msg=1';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual(state(), []);
  const flip = (id, v) => { const e = p.$(id); e.checked = v; e.dispatch('change'); };
  flip('f-events', false);
  assert.deepStrictEqual(state(), ['notice_color', 'notice_size']);
  flip('f-events', true);
  flip('f-names', false);
  assert.deepStrictEqual(state(), ['name_line'], 'only the name line goes with the names');
  assert.strictEqual(off('name_weight'), false);
  flip('f-names', true);
  const r = p.doc.querySelectorAll('input[name="f-layout"]').filter((x) => x.value === 'horizontal')[0];
  r.checked = true;
  r.dispatch('change');
  assert.deepStrictEqual(state(), ['bg_width', 'name_line'], 'column only');
  // The range and stepper of this stage: disabled inputs, enabled again.
  flip('f-events', false);
  assert.strictEqual(p.$('f-notice_size').disabled, true);
  flip('f-events', true);
  assert.strictEqual(p.$('f-notice_size').disabled, false);
});

test('the stage-3 fields: greyed out while shadow, outline, paints or the Homies badges are off; only homies_lists reloads', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const off = (key) => rowOf(p, key).classList.contains('disabled');
  const keys = ['shadow_color', 'outline_color', 'shadow_style', 'paint_images', 'homies_lists'];
  const state = () => keys.filter(off);
  assert.deepStrictEqual(state(), ['outline_color'], 'defaults: no outline yet');
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const flip = (id, v) => { const e = p.$(id); e.checked = v; e.dispatch('change'); };
  // Look's outline: a segmented field from None to Thick, live in the preview.
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-outline"]').map((r) => r.value), ['0', '1', '2', '3']);
  seg('outline', '2');
  assert.deepStrictEqual(state(), []);
  seg('shadow_style', 'text');
  flip('f-accent_bar', true);
  seg('paint_images', 'static');
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?shadow_style=text&outline=2&accent_bar=1&paint_images=static');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.outline, last.shadow_style, last.accent_bar, last.paint_images], [2, 'text', true, 'static']);
  seg('homies_lists', 'light');
  t.mock.timers.tick(2000);
  assert.notStrictEqual(frame(), first, 'the Homies lists load at start: a new preview');
  assert.match(frame().src, /[?&]homies_lists=light(&|$)/);
  // What each depends on.
  seg('shadow', '0');
  assert.deepStrictEqual(state(), ['shadow_color', 'shadow_style']);
  seg('outline', '0');
  flip('f-paints', false);
  flip('f-badges_homies', false);
  assert.deepStrictEqual(state(), keys);
  flip('f-badges_homies', true);
  assert.strictEqual(off('homies_lists'), false);
  flip('f-badges', false);
  assert.strictEqual(off('homies_lists'), true, 'badges off too');
});

test('the weights are sliders over their six names; the letter case is a segmented field that may wrap', (t) => {
  const p = open(t, HREF);
  assert.strictEqual(p.$('l-text_case').parentNode.parentNode.byClass('seg')[0].className, 'seg wrap field-control');
  const tw = p.$('f-text_weight'), out = tw.parentNode.byClass('range-value')[0];
  assert.deepStrictEqual([tw.type, tw.min, tw.max, tw.step, tw.value], ['range', '0', '5', '1', '2']);
  assert.deepStrictEqual([out.textContent, tw.getAttribute('aria-valuetext')], ['Semi-bold', 'Semi-bold']);
  assert.deepStrictEqual([p.$('f-name_weight').value, p.$('f-name_weight').parentNode.byClass('range-value')[0].textContent], ['4', 'Heavy']);
  tw.value = '5';
  tw.dispatch('input');
  assert.deepStrictEqual([out.textContent, tw.getAttribute('aria-valuetext')], ['Black', 'Black']);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?text_weight=black');
  // A paste moves the slider to the pasted name.
  p.$('paste').value = '?text_weight=light&name_weight=regular';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual([tw.value, out.textContent, p.$('f-name_weight').value], ['0', 'Light', '1']);
  p.$('paste').value = '?text_weight=black';
  p.$('paste-load').dispatch('click');
  const lh = p.$('f-line_height');
  assert.strictEqual(lh.value, '135%');
  lh.parentNode.children[2].dispatch('click');
  assert.strictEqual(lh.value, '140%');
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?text_weight=black&line_height=140');
});

test('Max message width steps over 1 to 4: 5 -> ArrowDown -> 0, 0 -> PageUp or ArrowUp -> 5, by button too', (t) => {
  const p = open(t, HREF);
  const lw = p.$('f-line_width');
  const [less, , more] = lw.parentNode.children;
  const key = (k) => lw.dispatch('keydown', { key: k, preventDefault() {} });
  assert.deepStrictEqual([lw.value, lw.getAttribute('aria-valuetext'), less.getAttribute('aria-label')], ['No limit', 'No limit', 'Less']);
  key('ArrowUp');
  assert.deepStrictEqual([lw.value, p.text('bar-url')], ['5 em', OVERLAY + '?line_width=5']);
  key('ArrowDown');
  assert.deepStrictEqual([lw.value, p.text('bar-url')], ['No limit', OVERLAY], 'not 4, which would be 5 again');
  key('PageUp');
  assert.strictEqual(lw.value, '5 em');
  key('ArrowUp');
  assert.strictEqual(lw.value, '6 em');
  key('PageDown');
  assert.strictEqual(lw.value, '5 em');
  key('PageDown');
  assert.strictEqual(lw.value, 'No limit');
  more.dispatch('click');
  more.dispatch('click');
  assert.strictEqual(lw.value, '10 em');
  less.dispatch('click');
  less.dispatch('click');
  assert.strictEqual(lw.value, 'No limit');
  // A number typed in the gap reads as 5.
  lw.value = '3';
  lw.dispatch('input');
  t.mock.timers.tick(400);
  assert.deepStrictEqual([lw.getAttribute('aria-valuetext'), p.text('bar-url')], ['5 em', OVERLAY + '?line_width=5']);
  key('ArrowDown');
  assert.strictEqual(lw.value, 'No limit', 'from the 3 in the box, which is 5');
  // The other two step as usual: side padding by 4 px, the soft edge by 1 em from Off.
  const px = p.$('f-pad_x'), fade = p.$('f-edge_fade');
  assert.deepStrictEqual([px.value, fade.value], ['8 px', 'Off']);
  px.parentNode.children[0].dispatch('click');
  fade.parentNode.children[2].dispatch('click');
  assert.deepStrictEqual([px.value, fade.value], ['4 px', '1 em']);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?pad_x=4&edge_fade=1');
});

test('the layout options: live in the preview; text alignment greys out in a row, the mark between messages in a column', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const off = (key) => rowOf(p, key).classList.contains('disabled');
  const keys = ['text_align', 'line_width', 'pad_x', 'edge_fade', 'row_sep'];
  const state = () => keys.filter(off);
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-text_align"]').map((r) => r.value), ['left', 'center', 'right']);
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-row_sep"]').map((r) => r.value), ['none', 'dot', 'bar', 'diamond']);
  assert.deepStrictEqual(state(), ['row_sep'], 'a column: no mark between messages');
  assert.ok(p.doc.querySelectorAll('input[name="f-row_sep"]').every((r) => r.disabled));
  seg('text_align', 'right');
  seg('layout', 'horizontal');
  assert.deepStrictEqual(state(), ['text_align'], 'a row: no text alignment');
  assert.ok(p.doc.querySelectorAll('input[name="f-text_align"]').every((r) => r.disabled));
  seg('row_sep', 'diamond');
  p.$('f-edge_fade').parentNode.children[2].dispatch('click');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.text_align, last.row_sep, last.edge_fade, last.layout], ['right', 'diamond', 1, 'horizontal']);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?layout=horizontal&text_align=right&edge_fade=1&row_sep=diamond');
  seg('layout', 'vertical');
  assert.deepStrictEqual(state(), ['row_sep'], 'and back');
  // A paste and Reset follow too.
  p.$('paste').value = '?layout=horizontal';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual(state(), ['text_align']);
  p.$('reset').dispatch('click');
  assert.deepStrictEqual(state(), ['row_sep']);
});

test('Exact text size: up from Auto to that size\'s px, down from 8 to 0 (never 7); Text size greys out meanwhile', (t) => {
  const p = open(t, HREF);
  const tp = p.$('f-text_px');
  const [less, , more] = tp.parentNode.children;
  const key = (k) => tp.dispatch('keydown', { key: k, preventDefault() {} });
  const size = (v) => {
    const r = p.doc.querySelectorAll('input[name="f-size"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const sizeOff = () => [rowOf(p, 'size').classList.contains('disabled'), p.doc.querySelectorAll('input[name="f-size"]').every((r) => r.disabled)];
  assert.deepStrictEqual([tp.value, tp.getAttribute('aria-valuetext'), less.getAttribute('aria-label')], ['Auto', 'Auto', 'Less']);
  assert.deepStrictEqual(sizeOff(), [false, false]);
  assert.match(p.$('h-size').textContent, /Exact text size \(Advanced\)/, 'the help says what takes over');
  more.dispatch('click');
  assert.deepStrictEqual([tp.value, p.text('bar-url')], ['24 px', OVERLAY + '?text_px=24'], 'Medium is 24 px: More starts there');
  assert.deepStrictEqual(sizeOff(), [true, true], 'Text size does nothing while it is set');
  more.dispatch('click');
  assert.strictEqual(tp.value, '26 px');
  less.dispatch('click');
  less.dispatch('click');
  assert.strictEqual(tp.value, '22 px');
  // A number typed in 1 to 7 reads as 8; a step down from 8 goes to 0, not 7 (which would be 8 again).
  tp.value = '3';
  tp.dispatch('input');
  t.mock.timers.tick(400);
  assert.deepStrictEqual([tp.getAttribute('aria-valuetext'), p.text('bar-url')], ['8 px', OVERLAY + '?text_px=8']);
  key('ArrowDown');
  assert.deepStrictEqual([tp.value, p.text('bar-url')], ['Auto', OVERLAY]);
  assert.deepStrictEqual(sizeOff(), [false, false], 'Text size counts again');
  // From 0, ArrowUp and PageUp go to the chosen Text size's px.
  size('large');
  key('ArrowUp');
  assert.strictEqual(tp.value, '32 px');
  key('ArrowDown');
  assert.strictEqual(tp.value, '31 px');
  key('PageDown');
  assert.strictEqual(tp.value, '30 px');
  tp.value = '8';
  tp.dispatch('input');
  t.mock.timers.tick(400);
  less.dispatch('click');
  assert.strictEqual(tp.value, 'Auto', 'Less from 8 (step 2): 0');
  size('small');
  key('PageUp');
  assert.deepStrictEqual([tp.value, p.text('bar-url')], ['18 px', OVERLAY + '?size=small&text_px=18']);
  // A paste and Reset follow too.
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([tp.value, sizeOff()], ['Auto', [false, false]]);
  p.$('paste').value = '?text_px=40';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual([tp.value, sizeOff()], ['40 px', [true, true]]);
});

test('the sizes: live in the preview; emote-only and GIF size grey out in a row, GIF size without GIFs; badge size never', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const off = (key) => rowOf(p, key).classList.contains('disabled');
  const keys = ['text_px', 'badge_size', 'emote_scale', 'emote_only', 'gif_size', 'giant_emotes'];
  const state = () => keys.filter(off);
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const flip = (id, v) => { const e = p.$(id); e.checked = v; e.dispatch('change'); };
  assert.deepStrictEqual(state(), []);
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-emote_only"]').map((r) => r.value), ['normal', 'big', 'huge']);
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-gif_size"]').map((r) => r.value), ['1x', '2x', '3x']);
  // The two percentages are sliders from 50% to 200%.
  const bs = p.$('f-badge_size'), es = p.$('f-emote_scale');
  [bs, es].forEach((r) => {
    assert.deepStrictEqual([r.type, r.min, r.max, r.step, r.value], ['range', '50', '200', '1', '100']);
    assert.strictEqual(r.parentNode.byClass('range-value')[0].textContent, '100%');
  });
  es.value = '150';
  es.dispatch('input');
  bs.value = '75';
  bs.dispatch('input');
  assert.strictEqual(bs.getAttribute('aria-valuetext'), '75%');
  seg('emote_only', 'huge');
  seg('gif_size', '1x');
  flip('f-giant_emotes', false);
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.emote_scale, last.badge_size, last.emote_only, last.gif_size, last.giant_emotes], [150, 75, 'huge', '1x', false]);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?gif_size=1x&emote_scale=150&emote_only=huge&giant_emotes=0&badge_size=75');
  // GIF size needs GIFs; badge size stays with badges off (the platform icons and Shared Chat avatars use it).
  flip('f-gifs', false);
  flip('f-badges', false);
  assert.deepStrictEqual(state(), ['gif_size']);
  flip('f-gifs', true);
  seg('layout', 'horizontal');
  assert.deepStrictEqual(state(), ['emote_only', 'gif_size', 'giant_emotes'], 'a row: none of the three');
  assert.ok(p.doc.querySelectorAll('input[name="f-emote_only"]').every((r) => r.disabled));
  seg('layout', 'vertical');
  assert.deepStrictEqual(state(), []);
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([state(), es.value, bs.value, p.text('bar-url')], [[], '100', '100', OVERLAY]);
});

// ---------- names, timestamps and the reply header (stage 6) ----------

test('Name font: empty is the same font as Font, typed names get Google\'s spelling, and it clears back to empty', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const nf = p.$('f-name_font'), font = p.$('f-font');
  assert.deepStrictEqual([nf.value, nf.placeholder, nf.getAttribute('list'), font.placeholder], ['', 'Same as Font', 'font-list', 'Inter']);
  nf.value = 'press start 2p';
  nf.dispatch('change');
  assert.deepStrictEqual([nf.value, p.text('bar-url')], ['Press Start 2P', OVERLAY + '?name_font=Press+Start+2P']);
  // Cleared (by typing, or on change): '' again, with no error, and out of the URL.
  nf.value = '';
  nf.dispatch('input');
  t.mock.timers.tick(600);
  assert.deepStrictEqual([p.text('bar-url'), p.$('e-name_font').hidden], [OVERLAY, true]);
  nf.value = 'Bangers';
  nf.dispatch('change');
  nf.value = '  ';
  nf.dispatch('change');
  assert.deepStrictEqual([nf.value, p.text('bar-url')], ['', OVERLAY]);
  // A bad name is refused as in Font; Font itself, emptied, goes back to Inter (it has no empty).
  nf.value = 'Comic;Sans';
  nf.dispatch('change');
  assert.deepStrictEqual([p.$('e-name_font').hidden, p.text('bar-url')], [false, OVERLAY]);
  font.value = '';
  font.dispatch('change');
  assert.strictEqual(font.value, 'Inter');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  assert.strictEqual(posted[posted.length - 1].cfg.name_font, '');
  // A paste gets the spelling fixed too.
  p.$('paste').value = '?name_font=roboto%20slab';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual([nf.value, p.text('bar-url')], ['Roboto Slab', OVERLAY + '?name_font=Roboto+Slab']);
  // Names off leaves it on: reply headers keep their names.
  const nm = p.$('f-names');
  nm.checked = false;
  nm.dispatch('change');
  assert.strictEqual(rowOf(p, 'name_font').classList.contains('disabled'), false);
});

test('Name contrast reads 4.5:1 and steps by 0.5; typed as 6.1 or 6.1:1; greyed out with Brighten dark name colors off', (t) => {
  const p = open(t, HREF);
  const rl = p.$('f-readable_level');
  rl.select = () => {};
  const [less, , more] = rl.parentNode.children;
  const key = (k) => rl.dispatch('keydown', { key: k, preventDefault() {} });
  assert.deepStrictEqual([rl.value, rl.getAttribute('aria-valuetext'), rl.getAttribute('aria-valuenow'), rl.inputMode], ['4.5:1', '4.5:1', '45', 'decimal']);
  more.dispatch('click');
  assert.deepStrictEqual([rl.value, p.text('bar-url')], ['5.0:1', OVERLAY + '?readable_level=50']);
  less.dispatch('click');
  less.dispatch('click');
  assert.strictEqual(rl.value, '4.0:1');
  // Typing: the box holds the number alone, and what is typed reads as a ratio.
  rl.dispatch('focus');
  assert.strictEqual(rl.value, '4.0');
  rl.value = '6.1';
  key('Enter');
  assert.deepStrictEqual([rl.getAttribute('aria-valuetext'), p.text('bar-url')], ['6.1:1', OVERLAY + '?readable_level=61']);
  key('ArrowDown');
  assert.strictEqual(rl.value, '6.0');
  rl.value = '3:1';
  rl.dispatch('blur');
  assert.deepStrictEqual([rl.value, p.text('bar-url')], ['3.0:1', OVERLAY + '?readable_level=30']);
  // The URL's own number (the tag shows readable_level=30) and a phone keypad's decimal comma read as meant.
  rl.dispatch('focus');
  rl.value = '50';
  key('Enter');
  assert.deepStrictEqual([rl.getAttribute('aria-valuetext'), p.text('bar-url')], ['5.0:1', OVERLAY + '?readable_level=50']);
  rl.value = '4,5';
  key('Enter');
  assert.deepStrictEqual([rl.getAttribute('aria-valuetext'), p.text('bar-url')], ['4.5:1', OVERLAY]);
  rl.dispatch('blur');
  // One Name color for everyone is never lightened: greyed out then too.
  const nc = p.$('f-name_color');
  nc.value = 'f80';
  nc.dispatch('change');
  assert.deepStrictEqual([rowOf(p, 'readable_level').classList.contains('disabled'), rl.disabled], [true, true]);
  assert.match(p.$('h-readable_level').textContent, /not used while a Name color \(Look\) is set/);
  nc.value = '';
  nc.dispatch('change');
  assert.strictEqual(rl.disabled, false);
  const rd = p.$('f-readable');
  rd.checked = false;
  rd.dispatch('change');
  assert.deepStrictEqual([rowOf(p, 'readable_level').classList.contains('disabled'), rl.disabled, more.disabled], [true, true, true]);
  assert.match(p.$('h-readable_level').textContent, /Brighten dark name colors \(Badges & paints\)/);
});

test('the name colors, the separator, timestamps and the reply header: live, and greyed out while they can\'t apply', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const off = (key) => rowOf(p, key).classList.contains('disabled');
  const keys = ['name_color', 'name_fallback', 'name_sep', 'readable_level', 'timestamps', 'reply_style', 'name_font'];
  const state = () => keys.filter(off);
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const flip = (id, v) => { const e = p.$(id); e.checked = v; e.dispatch('change'); };
  assert.deepStrictEqual(state(), []);
  const nc = colorField(p, 'name_color'), fb = colorField(p, 'name_fallback');
  // A mid-grey swatch while unset (no one color is drawn then), so picking white is a change the picker reports.
  assert.deepStrictEqual([nc.hex.placeholder, fb.hex.placeholder, nc.pick.value, fb.pick.value, nc.dflt.disabled],
    ['Their own', 'Twitch colors', '#808080', '#808080', true]);
  assert.deepStrictEqual([nc.pick.getAttribute('aria-describedby'), fb.pick.getAttribute('aria-describedby')], ['h-name_color', 'h-name_fallback']);
  assert.strictEqual(colorField(p, 'text_color').pick.getAttribute('aria-describedby'), null, 'a built-in color: as before');
  nc.pick.value = '#ffffff';
  nc.pick.dispatch('input');
  assert.deepStrictEqual([nc.hex.value, p.text('bar-url')], ['#ffffff', OVERLAY + '?name_color=ffffff']);
  nc.dflt.dispatch('click');
  assert.deepStrictEqual([nc.hex.value, nc.pick.value, p.text('bar-url')], ['', '#808080', OVERLAY]);
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-name_sep"]').map((r) => r.value), ['colon', 'space', 'dash', 'arrow']);
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-timestamps"]').map((r) => r.value), ['off', '12h', '24h']);
  assert.strictEqual(p.$('l-reply_style').parentNode.parentNode.byClass('seg')[0].className, 'seg wrap field-control');
  fb.hex.value = '#336699';
  fb.hex.dispatch('change');
  seg('name_sep', 'arrow');
  seg('timestamps', '24h');
  seg('reply_style', 'name');
  // One Name color for everyone: the color for names without one, and the contrast, have nothing left to do.
  nc.hex.value = 'f80';
  nc.hex.dispatch('change');
  assert.deepStrictEqual(state(), ['name_fallback', 'readable_level']);
  assert.deepStrictEqual([fb.pick.disabled, fb.hex.disabled, fb.dflt.disabled], [true, true, true]);
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.name_color, last.name_fallback, last.name_sep, last.timestamps, last.reply_style],
    ['ff8800', '336699', 'arrow', '24h', 'name']);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?name_color=ff8800&name_fallback=336699&name_sep=arrow&reply_style=name&timestamps=24h');
  nc.dflt.dispatch('click');
  assert.deepStrictEqual([state(), fb.dflt.disabled], [[], false]);
  // A name on its own line in a column draws no separator; in a row it does.
  flip('f-name_line', true);
  assert.deepStrictEqual(state(), ['name_sep']);
  seg('layout', 'horizontal');
  assert.deepStrictEqual(state(), []);
  seg('layout', 'vertical');
  flip('f-name_line', false);
  assert.deepStrictEqual(state(), []);
  // Names off greys out the separator only; replies off, the reply header.
  flip('f-names', false);
  flip('f-replies', false);
  assert.deepStrictEqual(state(), ['name_sep', 'reply_style']);
  assert.ok(p.doc.querySelectorAll('input[name="f-reply_style"]').every((r) => r.disabled));
  // A row changes none of them.
  seg('layout', 'horizontal');
  assert.deepStrictEqual(state(), ['name_sep', 'reply_style']);
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([state(), p.text('bar-url')], [[], OVERLAY]);
});

// ---------- highlights (stage 7) ----------

test('the highlights: live, the words and users as typed lists, and each color greyed out until what it colors is on', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const colors = ['mention_color', 'keyword_color', 'points_color', 'broadcaster_color', 'mod_color', 'vip_color'];
  const state = () => colors.filter((k) => rowOf(p, k).classList.contains('disabled'));
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const type = (key, v) => { const e = p.$('f-' + key); e.value = v; e.dispatch('change'); };
  // At the defaults only the channel-points color applies (its highlight is on).
  assert.deepStrictEqual(state(), ['mention_color', 'keyword_color', 'broadcaster_color', 'mod_color', 'vip_color']);
  assert.deepStrictEqual(colorField(p, 'mod_color').pick.value, '#00ad03', 'the built-in color as the swatch');
  // Default's name keeps an acronym's capitals.
  assert.deepStrictEqual(['vip_color', 'mention_color', 'points_color'].map((k) => colorField(p, k).dflt.getAttribute('aria-label')),
    ['Default VIP color', 'Default mention color', 'Default points highlight color']);
  const mentions = p.doc.querySelectorAll('input[name="f-mentions"]');
  assert.deepStrictEqual(mentions.map((r) => [r.value, r.parentNode.textContent]), [['off', 'Off'], ['at', '@name'], ['name', 'Plain too']]);
  assert.strictEqual(p.$('l-mentions').parentNode.parentNode.byClass('seg')[0].className, 'seg wrap field-control');
  seg('mentions', 'at');
  assert.deepStrictEqual(state(), ['keyword_color', 'broadcaster_color', 'mod_color', 'vip_color']);
  // A words field: phrases kept, lowercased and deduped, shown back with ', '; a users field takes logins.
  type('keywords', 'Good  Game, GG,gg ,');
  assert.strictEqual(p.$('f-keywords').value, 'good game, gg');
  assert.deepStrictEqual(state(), ['broadcaster_color', 'mod_color', 'vip_color']);
  type('keywords', '');
  assert.deepStrictEqual(state(), ['keyword_color', 'broadcaster_color', 'mod_color', 'vip_color']);
  type('highlight_users', '@PaintedPal not valid!, kick_fan');
  assert.strictEqual(p.$('f-highlight_users').value, 'paintedpal, not, kick_fan');
  assert.deepStrictEqual(state(), ['broadcaster_color', 'mod_color', 'vip_color']);
  type('keywords', 'overlay');
  seg('role_style', 'tint');
  assert.deepStrictEqual(state(), []);
  const pf = p.$('f-points_highlight');
  pf.checked = false;
  pf.dispatch('change');
  assert.deepStrictEqual(state(), ['points_color']);
  const vip = colorField(p, 'vip_color');
  vip.hex.value = '#123';
  vip.hex.dispatch('change');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.mentions, last.keywords, last.highlight_users, last.points_highlight, last.role_style, last.vip_color],
    ['at', ['overlay'], ['paintedpal', 'not', 'kick_fan'], false, 'tint', '112233']);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?mentions=at&keywords=overlay&highlight_users=paintedpal,not,kick_fan' +
    '&points_highlight=0&role_style=tint&vip_color=112233');
  // Advanced's Highlights has a link of its own; the Chat events count takes the mentions.
  assert.strictEqual(p.$('adv-highlights').textContent, 'Highlights');
  assert.strictEqual(p.text('count-events'), '1');
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([state(), p.text('bar-url'), p.$('f-keywords').value, p.$('f-highlight_users').value],
    [['mention_color', 'keyword_color', 'broadcaster_color', 'mod_color', 'vip_color'], OVERLAY, '', '']);
});

test('event types and filters: a labelled grid under Show subs…, greyed out with it; the filters live; Command prefixes', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const type = (key, v) => { const e = p.$('f-' + key); e.value = v; e.dispatch('change'); };
  const flip = (key, on) => { const e = p.$('f-' + key); e.checked = on; e.dispatch('change'); };
  // The grid: built like Badge sources (labelled for assistive tech, its help last), right under its switch.
  const body = p.$('group-events').children.filter((e) => e.className === 'fields')[0];
  const grid = body.children[1];
  assert.deepStrictEqual([grid.tagName, grid.className, grid.getAttribute('role'), grid.getAttribute('aria-label')],
    ['DIV', 'subgrid', 'group', 'Event types']);
  const rows = grid.children.slice(0, -1), help = grid.children[grid.children.length - 1];
  assert.deepStrictEqual(rows.map((e) => e.getAttribute('data-key')), p.builder.EVENT_SUBS);
  rows.forEach((e) => assert.strictEqual(e.className, 'field field-check sub'));
  assert.deepStrictEqual([help.tagName, help.className, help.textContent], ['P', 'help', p.builder.SUBGRIDS.events.help]);
  const off = () => p.builder.EVENT_SUBS.filter((k) => rowOf(p, k).classList.contains('disabled'));
  assert.deepStrictEqual(off(), []);
  flip('events', false);
  assert.deepStrictEqual(off(), p.builder.EVENT_SUBS);
  assert.ok(p.builder.EVENT_SUBS.every((k) => p.$('f-' + k).disabled), 'every switch off');
  flip('events', true);
  assert.deepStrictEqual(off(), []);
  flip('event_gifts', false);
  flip('event_announcements', false);
  // Command prefixes: greyed out until Hide !commands is on; the signs written together; a bad value says which
  // signs it takes; an emptied box is '!' again.
  const cp = p.$('f-command_prefixes');
  assert.deepStrictEqual([rowOf(p, 'command_prefixes').classList.contains('disabled'), cp.disabled, cp.value], [true, true, '!']);
  flip('hide_commands', true);
  assert.deepStrictEqual([rowOf(p, 'command_prefixes').classList.contains('disabled'), cp.disabled], [false, false]);
  type('command_prefixes', ' ! ? # ');
  assert.strictEqual(cp.value, '!?#');
  type('command_prefixes', '!a');
  assert.deepStrictEqual([cp.getAttribute('aria-invalid'), p.$('e-command_prefixes').hidden], ['true', false]);
  assert.strictEqual(p.$('e-command_prefixes').textContent, p.builder.META.command_prefixes.bad);
  assert.strictEqual(p.$('f-hide_commands').parentNode.parentNode.byClass('tag')[0].textContent, 'hide_commands=1');
  type('command_prefixes', '');
  assert.deepStrictEqual([cp.value, cp.getAttribute('aria-invalid')], ['!', 'false']);
  // While it is still being typed in (the input's own commit, 600 ms on): a bad sign shows its error, an emptied box
  // none, and keeps the value until it is left.
  const typing = (v) => { cp.value = v; cp.dispatch('input'); t.mock.timers.tick(600); };
  typing('!a');
  assert.deepStrictEqual([cp.getAttribute('aria-invalid'), p.$('e-command_prefixes').hidden], ['true', false]);
  typing('');
  assert.deepStrictEqual([cp.value, cp.getAttribute('aria-invalid'), p.$('e-command_prefixes').hidden], ['', 'false', true]);
  assert.ok(p.text('bar-url').indexOf('command_prefixes') < 0, 'still the default');
  cp.dispatch('change');
  assert.strictEqual(cp.value, '!');
  type('command_prefixes', '!?#');
  // The other filters, as typed lists, choices and a stepper.
  type('block_words', 'Spoiler,  BAD  words,spoiler');
  assert.strictEqual(p.$('f-block_words').value, 'spoiler, bad words');
  type('allow_users', '@KickFan, bad name!');
  assert.strictEqual(p.$('f-allow_users').value, 'kickfan, bad');
  assert.deepStrictEqual(p.doc.querySelectorAll('input[name="f-role_filter"]').map((r) => r.parentNode.textContent),
    ['Everyone', 'Subs+', 'VIPs+', 'Mods']);
  assert.strictEqual(p.$('l-role_filter').parentNode.parentNode.byClass('seg')[0].className, 'seg wrap field-control');
  seg('role_filter', 'vips');
  seg('links', 'shorten');
  const ml = p.$('f-min_length');
  assert.strictEqual(ml.value, 'Off');
  ml.parentNode.children[2].dispatch('click');
  ml.parentNode.children[2].dispatch('click');
  assert.strictEqual(ml.value, '2');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.event_gifts, last.event_announcements, last.hide_commands, last.command_prefixes, last.block_words,
    last.allow_users, last.role_filter, last.links, last.min_length],
  [false, false, true, '!?#', ['spoiler', 'bad words'], ['kickfan', 'bad'], 'vips', 'shorten', 2]);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?hide_commands=1&command_prefixes=%21%3F%23&block_words=spoiler,bad+words' +
    '&allow_users=kickfan,bad&role_filter=vips&min_length=2&links=shorten&event_gifts=0&event_announcements=0');
  // The counts: Filters has its three and Hide !commands, Advanced its three, Chat events the two switches.
  assert.deepStrictEqual(['filters', 'advanced', 'events'].map((g) => p.text('count-' + g)), ['4', '3', '2']);
  assert.strictEqual(p.$('adv-filters').textContent, 'Filters');
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([p.text('bar-url'), cp.value, cp.disabled, p.$('f-block_words').value, ml.value], [OVERLAY, '!', true, '', 'Off']);
});

test('the animation options: live, greyed out while animate or fade is off (fade is on another tab), Messages links them', (t) => {
  const p = open(t, HREF);
  t.mock.timers.tick(1000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  const keys = ['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'];
  const state = () => keys.filter((k) => rowOf(p, k).classList.contains('disabled'));
  // Messages: its foot links Advanced's Animation heading.
  const foot = p.$('group-messages').children.filter((e) => e.className === 'section-foot')[0];
  assert.deepStrictEqual([foot.children[0].textContent, foot.children[0].href], ['More in Advanced', '#adv-animation']);
  assert.strictEqual(p.$('adv-animation').textContent, 'Animation');
  assert.strictEqual(p.$('l-animate').textContent, 'Animate new messages');
  // At the defaults fade is Never: the fade-out length and the exit wait for it.
  assert.deepStrictEqual(state(), ['fade_out_ms', 'exit_style']);
  const fo = p.$('f-fade_out_ms'), em = p.$('f-enter_ms');
  assert.deepStrictEqual([fo.value, fo.disabled, em.value, em.disabled], ['1000 ms', true, '180 ms', false]);
  assert.match(p.$('h-fade_out_ms').textContent, /Needs Remove messages after \(Messages\)/);
  p.$('f-fade').parentNode.children[2].dispatch('click');
  assert.deepStrictEqual(state(), []);
  // Off animate: the entrance only; the fade-out and the exit don't need it.
  const an = p.$('f-animate');
  an.checked = false;
  an.dispatch('change');
  assert.deepStrictEqual(state(), ['enter_style', 'enter_ms']);
  assert.ok(p.doc.querySelectorAll('input[name="f-enter_style"]').every((r) => r.disabled));
  an.checked = true;
  an.dispatch('change');
  seg('enter_style', 'pop');
  em.parentNode.children[2].dispatch('click');
  assert.strictEqual(em.value, '200 ms');
  seg('exit_style', 'slide');
  fo.parentNode.children[0].dispatch('click');
  fo.parentNode.children[0].dispatch('click');
  fo.parentNode.children[0].dispatch('click');
  assert.deepStrictEqual([fo.value, state()], ['250 ms', []]);
  // An Instant fade-out moves nothing: the exit greys out, keeping its Slide.
  fo.parentNode.children[0].dispatch('click');
  assert.deepStrictEqual([fo.value, state()], ['Instant', ['exit_style']]);
  assert.ok(p.doc.querySelectorAll('input[name="f-exit_style"]').every((r) => r.disabled));
  assert.match(p.$('h-exit_style').textContent, /a Fade-out length other than Instant/);
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.enter_style, last.enter_ms, last.fade_out_ms, last.exit_style, last.fade], ['pop', 200, 0, 'slide', 5]);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?enter_style=pop&enter_ms=200&fade=5&fade_out_ms=0&exit_style=slide');
  // The counts: Look its entrance, Messages the fade, Advanced its three.
  assert.deepStrictEqual(['look', 'messages', 'advanced'].map((g) => p.text('count-' + g)), ['1', '1', '3']);
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([p.text('bar-url'), state(), fo.value, em.value], [OVERLAY, ['fade_out_ms', 'exit_style'], '1000 ms', '180 ms']);
});

// ---------- quick looks (stage 10) ----------

// The Quick look row: its buttons, Undo (last), and which look is pressed.
function looks(p) {
  const row = p.$('group-look').children.filter((e) => e.className === 'fields')[0].children[0];
  const group = row.byClass('btns')[0];
  const all = group.children, btns = all.slice(0, -1);
  return {
    row, group, btns, undo: all[all.length - 1],
    pressed: () => btns.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    filled: () => btns.filter((b) => b.classList.contains('primary')).map((b) => b.textContent),
    click: (label) => btns.filter((b) => b.textContent === label)[0].dispatch('click')
  };
}

test('Quick look: a row of five buttons at the top of Look, Default pressed at the defaults, Undo off', (t) => {
  const p = open(t, HREF);
  const L = looks(p);
  assert.strictEqual(L.row.className, 'field field-presets span-all');
  assert.strictEqual(L.row.nextElementSibling.className, 'eyebrow subhead', 'above the first heading');
  assert.strictEqual(L.row.byClass('field-label')[0].textContent, 'Quick look');
  assert.deepStrictEqual(L.row.byClass('tag'), [], 'no setting of its own, so no name tag');
  assert.deepStrictEqual([L.group.tagName, L.group.className, L.group.getAttribute('role'), L.group.getAttribute('aria-label'),
    L.group.getAttribute('aria-describedby')], ['DIV', 'btns field-control', 'group', 'Quick look', 'h-presets']);
  const help = p.$('h-presets');
  assert.strictEqual(help.parentNode, L.row);
  assert.match(help.textContent, /^Sets text size, weight and color, shadow, outline, box, spacing, and emote and badge size\./);
  assert.match(help.textContent, /Your font, name colors, layout and position stay\./);
  assert.match(help.textContent, /Big & bold’s bigger emotes can reach into the line above, and it can be cut off in a 1920 × 100 horizontal source\./);
  assert.deepStrictEqual(L.btns.map((b) => [b.tagName, b.type, b.textContent]),
    [['BUTTON', 'button', 'Default'], ['BUTTON', 'button', 'Boxed'], ['BUTTON', 'button', 'Outlined'], ['BUTTON', 'button', 'Cards'],
      ['BUTTON', 'button', 'Big & bold']]);
  assert.deepStrictEqual(L.btns.map((b) => [b.className, b.getAttribute('aria-pressed')]),
    [['btn primary', 'true'], ['btn', 'false'], ['btn', 'false'], ['btn', 'false'], ['btn', 'false']]);
  assert.deepStrictEqual([L.undo.textContent, L.undo.className, L.undo.type, L.undo.getAttribute('aria-label'), L.undo.disabled,
    !!L.undo.hidden], ['Undo', 'btn ghost', 'button', 'Undo quick look', true, false]);
  assert.strictEqual(p.text('count-look'), '', 'the row is no changed setting');
});

test('a quick look click never moves the buttons: Undo is always in the row, only switched on and off', (t) => {
  const p = open(t, HREF);
  const L = looks(p);
  const shape = () => L.group.children.map((b) => [b.textContent, !!b.hidden]);
  const before = shape();
  assert.strictEqual(before.length, 6);
  L.click('Boxed');
  assert.deepStrictEqual([shape(), L.undo.disabled], [before, false]);
  L.click('Outlined');
  L.undo.dispatch('click');
  assert.deepStrictEqual([shape(), L.undo.disabled], [before, true]);
  L.click('Cards');
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([shape(), L.undo.disabled], [before, true]);
});

test('a quick look: the form, the URL and the preview follow, live, with a bad channel name too; nothing else changes', (t) => {
  const p = open(t, HREF);
  // Settings no look touches (the channels too), then a Twitch name that isn't valid.
  p.$('paste').value = '?kick=xqc&kick_room=668&block=a_b,c&badges_7tv=0&align=top&font=Roboto&name_color=f80&shadow_style=text' +
    '&paint_images=static&homies_lists=light&text_px=20&outline_color=00f';
  p.$('paste-load').dispatch('click');
  p.$('channel').value = 'not valid!';
  p.$('channel').dispatch('change');
  assert.match(p.text('channel-status'), /isn’t a valid Twitch name/);
  t.mock.timers.tick(2000); // the demo preview loads
  const frame = () => p.$('frame-box').children.filter((e) => e.tagName === 'IFRAME')[0];
  const first = frame();
  assert.ok(first, 'the preview frame');
  const posted = [];
  first.contentWindow = { postMessage: (m) => posted.push(m) };
  const L = looks(p);
  assert.deepStrictEqual(L.pressed(), []);
  L.click('Cards');
  // The form.
  const radio = (key) => p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((r) => r.checked).map((r) => r.value)[0];
  assert.deepStrictEqual([p.$('f-bg').value, radio('shadow'), radio('bg_shape'), radio('bg_width'), radio('spacing'),
    p.$('f-accent_bar').checked, p.$('f-name_line').checked, p.$('f-text_px').value, p.$('f-outline_color').value],
  ['80', '0', 'soft', 'full', 'loose', true, true, 'Auto', '']);
  assert.strictEqual(rowOf(p, 'bg_color').classList.contains('disabled'), false, 'a box now: its color applies');
  assert.strictEqual(rowOf(p, 'size').classList.contains('disabled'), false, 'Exact text size is Auto again');
  assert.strictEqual(p.$('l-bg').parentNode.byClass('tag')[0].textContent, 'bg=80');
  // The URL: the look's settings, and everything else as it was.
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?kick=xqc&kick_room=668&font=Roboto&shadow=0&shadow_style=text&name_line=1' +
    '&name_color=ff8800&bg=80&accent_bar=1&bg_shape=soft&bg_width=full&spacing=loose&align=top&block=a_b,c&badges_7tv=0' +
    '&homies_lists=light&paint_images=static');
  assert.deepStrictEqual([L.pressed(), L.filled(), L.undo.disabled], [['Cards'], ['Cards'], false]);
  t.mock.timers.tick(30);
  assert.strictEqual(p.text('sr-status'), 'Applied Cards');
  // Live: posted to the frame, which is never reloaded, and the channel is never looked up again.
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first, 'live: the preview keeps its frame');
  const last = posted[posted.length - 1].cfg;
  assert.deepStrictEqual([last.bg, last.shadow, last.bg_shape, last.bg_width, last.spacing, last.accent_bar, last.name_line, last.text_px],
    [80, 0, 'soft', 'full', 'loose', true, true, 0]);
  assert.deepStrictEqual([last.kick, last.kick_room, last.block, last.font, last.name_color, last.align, last.badges_7tv,
    last.shadow_style, last.paint_images, last.homies_lists], ['xqc', '668', ['a_b', 'c'], 'Roboto', 'ff8800', 'top', false, 'text',
    'static', 'light']);
  assert.deepStrictEqual([p.$('channel').value, p.text('channel-status').indexOf('isn’t a valid') >= 0], ['not valid!', true]);
  // Another look, then Default: the same frame still, and the look settings back at their defaults.
  L.click('Big & bold');
  L.click('Default');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first);
  assert.strictEqual(p.text('bar-url'), OVERLAY + '?kick=xqc&kick_room=668&font=Roboto&shadow_style=text&name_color=ff8800&align=top' +
    '&block=a_b,c&badges_7tv=0&homies_lists=light&paint_images=static');
  assert.deepStrictEqual(L.pressed(), ['Default']);
  // In a row the layout stays, and the column-only settings Cards sets are kept, greyed out.
  const row = p.doc.querySelectorAll('input[name="f-layout"]').filter((x) => x.value === 'horizontal')[0];
  row.checked = true;
  row.dispatch('change');
  L.click('Cards');
  t.mock.timers.tick(2000);
  assert.strictEqual(frame(), first);
  assert.deepStrictEqual([radio('layout'), radio('bg_width'), rowOf(p, 'bg_width').classList.contains('disabled'),
    rowOf(p, 'name_line').classList.contains('disabled'), L.pressed()], ['horizontal', 'full', true, true, ['Cards']]);
  assert.deepStrictEqual([posted[posted.length - 1].cfg.layout, posted[posted.length - 1].cfg.bg_width], ['horizontal', 'full']);
});

test('Undo after a run of quick looks puts back the look from before the first, and only that; the focus goes to the pressed look', (t) => {
  const store = memoryStorage();
  const p = open(t, HREF, { storage: store });
  const stored = () => JSON.parse(store.getItem('tco-builder-cfg'));
  const L = looks(p);
  const focused = [];
  L.btns.forEach((b) => { b.focus = () => focused.push(b.textContent); });
  p.$('paste').value = '?size=small&bg=40&bg_color=123&text_color=f00&line_height=150&bots=1';
  p.$('paste-load').dispatch('click');
  const mine = p.text('bar-url'), mineStored = stored();
  assert.deepStrictEqual(mineStored, { size: 'small', bg: 40, bg_color: '112233', text_color: 'ff0000', line_height: 150, bots: true });
  assert.deepStrictEqual([L.pressed(), L.undo.disabled], [[], true]);
  L.click('Default');
  assert.deepStrictEqual([p.text('bar-url'), L.undo.disabled], [OVERLAY + '?bots=1', false]);
  L.click('Boxed');
  L.click('Outlined');
  assert.deepStrictEqual([L.pressed(), p.text('bar-url')], [['Outlined'], OVERLAY + '?shadow=0&outline=2&bots=1']);
  // Remembered like any change, so a look is still there when the builder opens again.
  assert.deepStrictEqual(stored(), { shadow: 0, outline: 2, bots: true });
  L.undo.dispatch('click');
  // The look from before Default, the form with it; bots (no look setting) as it was all along.
  assert.deepStrictEqual([p.text('bar-url'), L.undo.disabled, L.pressed()], [mine, true, []]);
  assert.deepStrictEqual([p.$('f-bg').value, p.$('f-text_color').value, p.$('f-line_height').value, p.$('f-bots').checked],
    ['40', '#ff0000', '150%', true]);
  assert.deepStrictEqual(stored(), mineStored, 'and the undone look is remembered too');
  assert.deepStrictEqual(focused, ['Default'], 'no look is pressed: the first takes the focus from Undo, now off');
  t.mock.timers.tick(30);
  assert.strictEqual(p.text('sr-status'), 'Quick look undone');
  // From the defaults, Undo goes back to Default, pressed again and focused.
  p.$('reset').dispatch('click');
  L.click('Big & bold');
  L.undo.dispatch('click');
  assert.deepStrictEqual([p.text('bar-url'), L.pressed(), focused], [OVERLAY, ['Default'], ['Default', 'Default']]);
  L.click('Cards');
  L.click('Big & bold');
  L.undo.dispatch('click');
  assert.deepStrictEqual([p.text('bar-url'), L.pressed(), focused.length], [OVERLAY, ['Default'], 3]);
  // A click on the look that is on already changes nothing, so it offers no Undo.
  L.click('Default');
  assert.strictEqual(L.undo.disabled, true);
  t.mock.timers.tick(30);
  assert.strictEqual(p.text('sr-status'), 'Applied Default');
});

test('Undo goes with any other change: an edit, a look setting set by hand, a paste and Reset', (t) => {
  const p = open(t, HREF);
  const L = looks(p);
  const focused = [];
  L.btns.forEach((b) => { b.focus = () => focused.push(b.textContent); });
  const offered = () => !L.undo.disabled;
  L.click('Boxed');
  assert.strictEqual(offered(), true);
  // An edit elsewhere ends the run, and Undo with it.
  const bots = p.$('f-bots');
  bots.checked = true;
  bots.dispatch('change');
  assert.strictEqual(offered(), false);
  // The next run starts from there: its Undo is back to Boxed, with bots.
  L.click('Cards');
  L.undo.dispatch('click');
  assert.deepStrictEqual([p.text('bar-url'), L.pressed()], [OVERLAY + '?shadow=0&bg=70&bots=1', ['Boxed']]);
  // A look setting changed by hand.
  L.click('Cards');
  const bg = p.$('f-bg');
  bg.value = '50';
  bg.dispatch('input');
  assert.deepStrictEqual([offered(), L.pressed(), L.filled()], [false, [], []]);
  // With the focus on Undo as it goes, the focus moves to the look pressed (or the first): never to the page.
  L.click('Cards');
  p.doc.activeElement = L.undo;
  bots.checked = false;
  bots.dispatch('change');
  assert.deepStrictEqual([offered(), focused], [false, ['Boxed', 'Cards']], 'Boxed after the Undo above, then Cards');
  p.doc.activeElement = undefined;
  // A paste and Reset.
  L.click('Outlined');
  p.$('paste').value = '?bots=1';
  p.$('paste-load').dispatch('click');
  assert.strictEqual(offered(), false);
  L.click('Outlined');
  p.$('reset').dispatch('click');
  assert.deepStrictEqual([offered(), L.pressed(), p.text('bar-url')], [false, ['Default'], OVERLAY]);
});

test('the pressed look follows every change: an edit by hand, set back, and a paste', (t) => {
  const p = open(t, HREF);
  const L = looks(p);
  assert.deepStrictEqual(L.pressed(), ['Default']);
  const seg = (key, v) => {
    const r = p.doc.querySelectorAll('input[name="f-' + key + '"]').filter((x) => x.value === v)[0];
    r.checked = true;
    r.dispatch('change');
  };
  seg('shadow', '0');
  assert.deepStrictEqual([L.pressed(), L.filled()], [[], []]);
  const bg = p.$('f-bg');
  bg.value = '70';
  bg.dispatch('input');
  assert.deepStrictEqual([L.pressed(), L.filled()], [['Boxed'], ['Boxed']], 'by hand, Boxed is what the settings are');
  assert.strictEqual(L.undo.disabled, true, 'no look was clicked: nothing to undo');
  seg('outline', '1');
  assert.deepStrictEqual(L.pressed(), []);
  seg('outline', '0');
  seg('layout', 'horizontal');
  assert.deepStrictEqual(L.pressed(), ['Boxed'], 'the layout is no part of a look');
  // A paste: Outlined, then with a font and a name color (no look settings), then with an exact text size.
  p.$('paste').value = '?shadow=0&outline=2';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual(L.pressed(), ['Outlined']);
  p.$('paste').value = '?shadow=0&outline=2&font=Roboto&name_color=f80';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual(L.pressed(), ['Outlined']);
  p.$('paste').value = '?shadow=0&outline=2&text_px=20';
  p.$('paste-load').dispatch('click');
  assert.deepStrictEqual([L.pressed(), L.filled()], [[], []]);
  p.$('reset').dispatch('click');
  assert.deepStrictEqual(L.pressed(), ['Default']);
});

test('a settings.js loaded from the folder ends a run of quick looks, like a paste; a look then ends its note', async (t) => {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); }); // the channel lookup
  const p = open(t, 'file:///E:/tco/builder.html');
  const script = p.doc.head.children.filter((e) => e.tagName === 'SCRIPT')[0];
  assert.ok(script && /^settings\.js\?t=\d+$/.test(script.src), 'the builder asks for the folder\'s settings.js');
  const L = looks(p);
  L.click('Boxed');
  assert.strictEqual(L.undo.disabled, false);
  t.after(() => { delete globalThis.TCO_SETTINGS; });
  globalThis.TCO_SETTINGS = { channel: 'forsen', shadow: 0, outline: 2 };
  script.onload();
  await settle();
  assert.deepStrictEqual([L.undo.disabled, L.pressed()], [true, ['Outlined']]);
  assert.match(p.text('file-loaded'), /^Loaded the settings\.js/);
  assert.strictEqual(p.text('bar-note'), 'Loaded the settings.js from this folder.');
  // The note beside the URL says what the file did until the first change, and a look is one.
  L.click('Cards');
  assert.strictEqual(p.text('bar-note'), 'The URL lists every setting, so a settings.js in the overlay’s folder can’t change this source.');
});
