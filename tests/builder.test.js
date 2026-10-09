'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../js/config.js');
const builder = require('../js/builder.js');
// A different valid value for any key (shared with parity.test.js; a new SPEC type gets its case there).
const { flip } = require('./flip.js');

const BASE = 'https://masstarvt.github.io/Twitch-Chat-Overlay/builder.html?x=1#top';

test('every config key except channel is in exactly one form group, with a label', () => {
  const seen = {};
  builder.groupLayout().forEach((g) => g.keys.forEach((k) => {
    assert.ok(!seen[k], 'duplicate key ' + k);
    seen[k] = true;
    assert.ok(builder.META[k] && builder.META[k].label, 'missing label for ' + k);
  }));
  config.KEYS.filter((k) => k !== 'channel').forEach((k) => assert.ok(seen[k], 'missing field for ' + k));
  assert.ok(!seen.channel);
  assert.deepStrictEqual(builder.groupLayout().map((g) => g.title),
    ['Look', 'Kick', 'Messages', 'Chat events', 'Filters', 'Emotes', 'Badges & paints', 'Advanced']);
});

test('sections: one per group plus Add to OBS, each with an id a link can open', () => {
  const ids = builder.sectionIds();
  assert.deepStrictEqual(ids, ['look', 'platforms', 'messages', 'events', 'filters', 'emotes', 'badges', 'advanced', 'obs']);
  assert.strictEqual(new Set(ids).size, ids.length);
  builder.groupLayout().forEach((g) => assert.ok(g.note, g.id + ' says what it holds'));
  assert.strictEqual(builder.sectionFromHash('#obs'), 'obs');
  assert.strictEqual(builder.sectionFromHash('#Badges'), 'badges');
  assert.strictEqual(builder.sectionFromHash('#group-filters'), 'filters');
  // The skip link, an old home-page anchor and prototype names open nothing.
  ['', '#', '#settings', '#setup', '#constructor', '#__proto__', null, undefined]
    .forEach((h) => assert.strictEqual(builder.sectionFromHash(h), '', String(h)));
  // builder.html holds the tab and the panel of the one section that isn't generated.
  const html = fs.readFileSync(path.join(__dirname, '..', 'builder.html'), 'utf8');
  assert.match(html, /id="tab-obs"[^>]*aria-controls="group-obs"/);
  assert.match(html, /<section id="group-obs"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-obs"/);
  // No element carries a bare section name as its id, so #obs opens the section without the browser
  // scrolling the panel to an anchor of that name.
  ids.forEach((id) => assert.ok(html.indexOf('id="' + id + '"') < 0, id));
});

test('a link opens its section when the page loads and when the hash changes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'builder.js'), 'utf8');
  // openHashSection reads the page's hash (unless More in Advanced passes its own) and opens the section it names.
  assert.match(src, /if \(hash === undefined\) hash = root\.location\.hash;\s*var s = sectionFromHash\(hash\);\s*if \(!s\) return false;\s*selectSection\(s, false\);/);
  // start() asks the hash first (when the link's last value doesn't read it as its own: linkSection), then falls back
  // to the section that was open last time.
  assert.match(src, /if \(!linkSection\(root\.location\) \|\| !openHashSection\(\)\) selectSection\(B\.ui\.section, false\);/);
  assert.match(src, /addEventListener\('hashchange', function \(\) \{ if \(openHashSection\(\)\) saveUi\(\); \}\)/);
});

test('the app layout query is the same in builder.js and builder.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'builder.css'), 'utf8');
  assert.ok(css.indexOf('@media ' + builder.APP_LAYOUT + ' {') >= 0, builder.APP_LAYOUT);
  // The queries that refine the app layout (a short window, a narrower top bar) repeat its thresholds.
  const parts = builder.APP_LAYOUT.split(' and ');
  const within = css.match(/@media [^{]*min-height[^{]*\{/g) || [];
  assert.ok(within.length > 1, 'the scan finds the refinements');
  within.forEach((q) => parts.forEach((p) => assert.ok(q.indexOf(p) >= 0, q + ' lacks ' + p)));
});

test('a greyed-out field keeps its chosen option white, dims its buttons once, and a .wrap seg wraps', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'builder.css'), 'utf8');
  // a hover rule on every span of a disabled seg would outrank .seg input:checked + span's #fff
  assert.ok(!/\.field\.disabled \.seg label:hover span\s*[{,]/.test(css));
  assert.ok(css.indexOf('.field.disabled .seg label:hover input:not(:checked) + span {') >= 0);
  assert.ok(/\.field\.disabled \.btn:disabled \{ opacity: 1; \}/.test(css));
  assert.ok(/^\.seg\.wrap \{ flex-wrap: wrap; \}/m.test(css), 'outside the media queries, so it wraps at every width');
});

test('every id, class and element builder.js looks up exists in builder.html or is one it creates', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'builder.html'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'builder.js'), 'utf8');
  const made = /^(?:tab|count|group)-$/; // $('tab-' + id) and the like: built by buildGroups
  const ids = new Set();
  for (const m of src.matchAll(/\$\('([^']+)'/g)) ids.add(m[1]);
  assert.ok(ids.size > 25, 'the scan finds the lookups');
  ids.forEach((id) => {
    if (made.test(id)) return;
    assert.ok(html.indexOf('id="' + id + '"') >= 0, 'builder.html has no #' + id);
  });
  ['pmode', 'backdrop', 'route'].forEach((n) => assert.ok(html.indexOf('name="' + n + '"') >= 0, n));
  // What it finds by class or by element: the sizes in Add to OBS, a button's words, the popover's summary.
  const classes = new Set();
  for (const m of src.matchAll(/querySelector(?:All)?\('\.([\w-]+)'\)/g)) classes.add(m[1]);
  assert.ok(classes.size >= 3, 'the scan finds the class lookups');
  classes.forEach((c) =>
    assert.match(html, new RegExp('class="(?:[^"]* )?' + c + '(?: [^"]*)?"'), 'builder.html has no .' + c));
  // flash() writes a button's words into its .lbl; without one the text replaces the icon too.
  assert.match(html, /<button id="bar-copy"[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<span class="lbl">/);
  assert.match(html, /<details id="paste-box"[^>]*>\s*<summary\b/);
  // No id twice.
  const seen = {};
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    assert.ok(!seen[m[1]], 'duplicate id ' + m[1]);
    seen[m[1]] = true;
  }
});

test('widgets: switches, segmented choices, steppers, sliders, color pickers', () => {
  const kinds = {};
  config.KEYS.filter((k) => k !== 'channel').forEach((k) => { kinds[k] = builder.widgetFor(k); });
  // The six weights are a slider: six choices in a row wrap unevenly on a phone.
  const SLIDERS = ['text_weight', 'name_weight'];
  Object.keys(config.SPEC).forEach((k) => {
    if (config.SPEC[k].type === 'bool') assert.strictEqual(kinds[k], 'check', k);
    if (config.SPEC[k].type === 'enum') assert.strictEqual(kinds[k], SLIDERS.indexOf(k) >= 0 ? 'range' : 'seg', k);
    if (config.SPEC[k].type === 'color') {
      assert.strictEqual(kinds[k], 'color', k);
      // the picker shows it while the setting is '' (an <input type=color> needs a #rrggbb value)
      assert.match(builder.META[k].swatch, /^#[0-9a-f]{6}$/, k);
    }
  });
  assert.strictEqual(kinds.shadow, 'seg');
  assert.deepStrictEqual(Object.keys(kinds).filter((k) => kinds[k] === 'range').sort(),
    ['badge_size', 'bg', 'emote_scale', 'name_weight', 'notice_size', 'text_weight']);
  ['fade', 'max', 'history', 'line_height', 'line_width', 'pad_x', 'edge_fade', 'text_px'].forEach((k) => assert.strictEqual(kinds[k], 'stepper', k));
  assert.deepStrictEqual(config.SPEC.text_weight.values.map((v) => builder.valueText('text_weight', v)),
    ['Light', 'Regular', 'Semi-bold', 'Bold', 'Heavy', 'Black']);
  assert.strictEqual(builder.valueText('name_weight', 'heavy'), 'Heavy');
  assert.strictEqual(builder.META.text_case.wrap, true);
  assert.strictEqual(kinds.font, 'font');
  assert.strictEqual(kinds.block, 'text');
  assert.strictEqual(kinds.kick, 'text');
  assert.strictEqual(kinds.kick_room, 'text');
  assert.deepStrictEqual(builder.segValues('shadow'), [
    { value: '0', label: 'None' }, { value: '1', label: 'Light' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Strong' }]);
  assert.deepStrictEqual(builder.segValues('size').map((o) => o.value), config.SPEC.size.values);
  assert.deepStrictEqual(builder.segValues('layout').map((o) => o.label), ['Vertical', 'Horizontal']);
  // Every choice is a value the setting takes.
  ['shadow', 'size', 'layout', 'align'].forEach((k) =>
    builder.segValues(k).forEach((o) => assert.strictEqual(String(config.coerce(k, o.value)), o.value, k)));
});

test('valueText and parseStep: what a stepper shows is what it reads back', () => {
  assert.strictEqual(builder.valueText('fade', 0), 'Never');
  assert.strictEqual(builder.valueText('fade', 30), '30 s');
  assert.strictEqual(builder.valueText('history', 0), 'Off');
  assert.strictEqual(builder.valueText('history', 5), '5');
  assert.strictEqual(builder.valueText('max', 50), '50');
  assert.strictEqual(builder.valueText('bg', 0), 'Off');
  assert.strictEqual(builder.valueText('bg', 60), '60%');
  assert.strictEqual(builder.valueText('shadow', 3), 'Strong');
  assert.strictEqual(builder.valueText('line_height', 135), '135%');
  assert.strictEqual(builder.valueText('notice_size', 85), '85%');
  assert.strictEqual(builder.parseStep('line_height', '120%'), 120);
  assert.strictEqual(builder.parseStep('line_height', '90'), 100);
  [100, 101, 135, 200].forEach((v) => assert.strictEqual(builder.parseStep('line_height', builder.valueText('line_height', v)), v));
  ['fade', 'max', 'history'].forEach((k) => {
    const s = config.SPEC[k];
    [s.min, s.min + 1, 7, s.def, s.max].forEach((v) =>
      assert.strictEqual(builder.parseStep(k, builder.valueText(k, v)), v, k + ' ' + v));
  });
  assert.strictEqual(builder.parseStep('fade', ' 45 '), 45);
  assert.strictEqual(builder.parseStep('fade', '45s'), 45);
  assert.strictEqual(builder.parseStep('fade', 'never'), 0);
  // Out of range is clamped, like the overlay does; words and signs are not numbers.
  assert.strictEqual(builder.parseStep('max', '0'), 1);
  assert.strictEqual(builder.parseStep('max', '9999'), 200);
  assert.strictEqual(builder.parseStep('history', '101'), 100);
  ['', ' ', 'soon', '-5', '+5', 'Off', '.5', '1,000', '1 000', '2.5', '5.', '1e2', '12abc', '50 s', null, undefined].forEach((t) =>
    assert.strictEqual(builder.parseStep('max', t), undefined, JSON.stringify(t)));
  // Only the field's own unit may follow the number.
  assert.strictEqual(builder.parseStep('fade', '45 S'), 45);
  assert.strictEqual(builder.parseStep('fade', '007'), 7);
  ['1,000', '10 minutes', '10 sec', '30 s s'].forEach((t) =>
    assert.strictEqual(builder.parseStep('fade', t), undefined, JSON.stringify(t)));
});

test('stepValue moves to the next multiple of the step and stays in range', () => {
  const up = (v, step, min, max) => builder.stepValue(v, 1, step, min, max);
  const down = (v, step, min, max) => builder.stepValue(v, -1, step, min, max);
  assert.strictEqual(up(0, 5, 0, 3600), 5);
  assert.strictEqual(up(30, 5, 0, 3600), 35);
  assert.strictEqual(up(32, 5, 0, 3600), 35);
  assert.strictEqual(up(3598, 5, 0, 3600), 3600);
  assert.strictEqual(up(3600, 5, 0, 3600), 3600);
  assert.strictEqual(down(32, 5, 0, 3600), 30);
  assert.strictEqual(down(30, 5, 0, 3600), 25);
  assert.strictEqual(down(3, 5, 0, 3600), 0);
  assert.strictEqual(down(0, 5, 0, 3600), 0);
  // max starts at 1: 1 -> 5 -> 10, and back down to 1
  assert.strictEqual(up(1, 5, 1, 200), 5);
  assert.strictEqual(up(5, 5, 1, 200), 10);
  assert.strictEqual(down(5, 5, 1, 200), 1);
  assert.strictEqual(down(1, 5, 1, 200), 1);
  assert.strictEqual(up(200, 5, 1, 200), 200);
  assert.strictEqual(up(7, 1, 0, 100), 8);
  assert.strictEqual(down(7, 1, 0, 100), 6);
  // Every press lands on a value the setting takes.
  ['fade', 'max', 'history', 'line_height'].forEach((k) => {
    const s = config.SPEC[k], step = builder.META[k].step;
    assert.ok(step >= 1, k);
    for (let v = s.min, n = 0; n < 1000 && v < s.max; n++) {
      const next = up(v, step, s.min, s.max);
      assert.ok(next > v && next <= s.max, k + ' up from ' + v);
      assert.strictEqual(config.coerce(k, next), next);
      v = next;
    }
  });
});

test('the layout steppers: what they show and read back, and line_width\'s steps over 1 to 4', () => {
  ['line_width', 'pad_x', 'edge_fade'].forEach((k) => assert.strictEqual(builder.widgetFor(k), 'stepper', k));
  assert.deepStrictEqual([0, 5, 30].map((v) => builder.valueText('line_width', v)), ['No limit', '5 em', '30 em']);
  assert.deepStrictEqual([0, 8, 200].map((v) => builder.valueText('pad_x', v)), ['0 px', '8 px', '200 px']);
  assert.deepStrictEqual([0, 2].map((v) => builder.valueText('edge_fade', v)), ['Off', '2 em']);
  assert.deepStrictEqual(['No limit', 'no limit', '30 em', '30em', '3', '0'].map((t) => builder.parseStep('line_width', t)), [0, 0, 30, 30, 5, 0]);
  assert.deepStrictEqual(['8 px', '0', '12px'].map((t) => builder.parseStep('pad_x', t)), [8, 0, 12]);
  assert.deepStrictEqual(['Off', '3 em', '11'].map((t) => builder.parseStep('edge_fade', t)), [0, 3, 10]);
  ['line_width', 'pad_x', 'edge_fade'].forEach((k) => {
    const s = config.SPEC[k];
    [s.min, s.def, s.max].forEach((v) => assert.strictEqual(builder.parseStep(k, builder.valueText(k, v)), v, k + ' ' + v));
  });
  // skipGap: a step that would land on 1..4 goes on to 0 (down) or 5 (up); anything else is left alone.
  assert.strictEqual(builder.skipGap('line_width', 5, 4), 0, 'ArrowDown from 5');
  assert.strictEqual(builder.skipGap('line_width', 0, 1), 5, 'ArrowUp from 0');
  assert.strictEqual(builder.skipGap('line_width', 6, 5), 5);
  assert.strictEqual(builder.skipGap('line_width', 5, 0), 0, 'Less from 5 (step 5)');
  assert.strictEqual(builder.skipGap('line_width', 0, 5), 5, 'More from 0 (step 5)');
  assert.strictEqual(builder.skipGap('line_width', 30, 35), 35);
  assert.strictEqual(builder.skipGap('pad_x', 5, 4), 4, 'no lowest: as stepped');
  assert.strictEqual(builder.skipGap('edge_fade', 0, 1), 1);
  assert.strictEqual(builder.skipGap('max', 2, 1), 1);
  assert.strictEqual(builder.skipGap('constructor', 2, 1), 1);
  // Every press, by button or key, from every value the setting takes, lands on another value it takes (so
  // nothing is stuck, as 5 -> 4 -> coerced to 5 would be), in the direction pressed.
  ['line_width', 'pad_x', 'edge_fade', 'fade', 'max', 'history', 'line_height', 'text_px', 'readable_level'].forEach((k) => {
    const s = config.SPEC[k], step = (builder.META[k] && builder.META[k].step) || 1;
    ['small', 'medium', 'large'].forEach((size) => {
      for (let v = s.min; v <= s.max; v++) {
        if (config.coerce(k, v) !== v) continue;
        [[1, v + 1], [-1, v - 1], [1, builder.stepValue(v, 1, step, s.min, s.max)], [-1, builder.stepValue(v, -1, step, s.min, s.max)]]
          .forEach(([dir, to]) => {
            const n = config.coerce(k, builder.skipGap(k, v, Math.max(s.min, Math.min(s.max, to)), Object.assign(config.defaults(), { size })));
            if (dir > 0 && v < s.max) assert.ok(n > v, k + ' up from ' + v);
            if (dir < 0 && v > s.min) assert.ok(n < v, k + ' down from ' + v);
          });
      }
    });
  });
});

test('Exact text size: what its stepper shows and reads back, and its first step up from Auto', () => {
  assert.strictEqual(builder.widgetFor('text_px'), 'stepper');
  assert.deepStrictEqual([0, 8, 24, 96].map((v) => builder.valueText('text_px', v)), ['Auto', '8 px', '24 px', '96 px']);
  assert.deepStrictEqual(['Auto', 'auto', '24 px', '24px', '3', '0', '120'].map((t) => builder.parseStep('text_px', t)),
    [0, 0, 24, 24, 8, 0, 96]);
  [0, 8, 9, 50, 96].forEach((v) => assert.strictEqual(builder.parseStep('text_px', builder.valueText('text_px', v)), v));
  // From 0 a step up (ArrowUp's 1, PageUp's and More's 2) goes to the Text size's px, which the overlay draws now.
  const at = (size) => Object.assign(config.defaults(), { size });
  assert.deepStrictEqual(['small', 'medium', 'large'].map((s) => builder.skipGap('text_px', 0, 1, at(s))), [18, 24, 32]);
  assert.strictEqual(builder.skipGap('text_px', 0, 2, at('large')), 32);
  assert.strictEqual(builder.skipGap('text_px', 0, 1), 24, 'no cfg: Medium');
  // Down from 8 into 1..7 goes to 0; elsewhere a step is a step.
  assert.strictEqual(builder.skipGap('text_px', 8, 7, at('large')), 0);
  assert.strictEqual(builder.skipGap('text_px', 8, 6, at('large')), 0);
  assert.strictEqual(builder.skipGap('text_px', 9, 8, at('large')), 8);
  assert.strictEqual(builder.skipGap('text_px', 24, 26, at('large')), 26);
  assert.strictEqual(builder.skipGap('text_px', 8, 0), 0);
  // Only text_px starts from somewhere else: line_width's 0 -> 1 is its lowest (5), pad_x's is 1.
  assert.strictEqual(builder.skipGap('line_width', 0, 1, at('large')), 5);
  assert.strictEqual(builder.skipGap('pad_x', 0, 1, at('large')), 1);
  assert.deepStrictEqual(Object.keys(builder.META).filter((k) => builder.META[k].from0), ['text_px']);
  // The Text size steps are the overlay's (renderer.js FONT_PX, which picks the image files).
  assert.deepStrictEqual(builder.TEXT_PX, require('../js/renderer.js')._internal.FONT_PX);
  assert.deepStrictEqual(Object.keys(builder.TEXT_PX), config.SPEC.size.values);
});

test('Name contrast: a stepper over the ratio (45 shows 4.5:1), which reads the ratio back', () => {
  const m = builder.META.readable_level;
  assert.deepStrictEqual([m.scale, m.step, m.unit], [10, 5, ':1']);
  assert.deepStrictEqual([30, 45, 50, 61, 70].map((v) => builder.valueText('readable_level', v)), ['3.0:1', '4.5:1', '5.0:1', '6.1:1', '7.0:1']);
  assert.deepStrictEqual([30, 45, 70].map((v) => builder.stepText('readable_level', v)), ['3.0', '4.5', '7.0']);
  // What is shown, or typed with or without the ':1', is read back; out of range is clamped like any stepper.
  assert.deepStrictEqual(['4.5', '4.5:1', ' 4.5 :1 ', '5', '5:1', '6.1', '2', '9.9', '0.5'].map((t) => builder.parseStep('readable_level', t)),
    [45, 45, 45, 50, 50, 61, 30, 70, 30]);
  // A phone keypad's decimal comma is a point. A number alone reads as in a URL or settings.js (config.coerce): 30
  // to 70 are the field's own values (its tag shows readable_level=30), and under 30 it is the ratio. With ':1' it is
  // always the ratio.
  assert.deepStrictEqual(['4,5', '6,1:1', '30', '45', '50', '70', '21', '8', '45.5', '45:1', '30:1'].map((t) => builder.parseStep('readable_level', t)),
    [45, 61, 30, 45, 50, 70, 70, 70, 46, 70, 70]);
  // A ratio under 3:1 is 3:1, the nearest end, as without the ':1' ('2'): 29 (2.9:1) isn't read again as 29:1.
  assert.deepStrictEqual(['2.9:1', '2:1', '0.5:1', '0:1', '7.1:1'].map((t) => builder.parseStep('readable_level', t)),
    [30, 30, 30, 30, 70]);
  assert.strictEqual(config.SPEC.readable_level.scale, m.scale, 'config reads the same ratio');
  for (let v = 30; v <= 70; v++) {
    assert.strictEqual(builder.parseStep('readable_level', builder.valueText('readable_level', v)), v);
    assert.strictEqual(builder.parseStep('readable_level', builder.stepText('readable_level', v)), v);
  }
  // One decimal only (the scale's), and nothing but the ratio's own ':1' after it.
  ['4.55', '4,55', '4,', '4.', '.5', '4.5:2', '4.5 x', '4.5%', '-4', '1,000', 'soon', ''].forEach((t) =>
    assert.strictEqual(builder.parseStep('readable_level', t), undefined, JSON.stringify(t)));
  // Every other stepper reads and shows as before: no scale, whole numbers only.
  assert.deepStrictEqual(Object.keys(builder.META).filter((k) => builder.META[k].scale), ['readable_level']);
  assert.strictEqual(builder.stepText('fade', 30), '30');
  assert.strictEqual(builder.parseStep('fade', '2.5'), undefined);
  assert.strictEqual(builder.valueText('fade', 30), '30 s');
  assert.strictEqual(builder.valueText('bg', 60), '60%');
});

test('changedKeys, tagText and groupCounts follow the overlay URL', () => {
  const cfg = Object.assign(config.defaults(), { channel: 'forsen' });
  assert.deepStrictEqual(builder.changedKeys(cfg), {}, 'the channel is not a changed setting');
  config.KEYS.filter((k) => k !== 'channel').forEach((k) => assert.strictEqual(builder.tagText(k, cfg), k));
  Object.keys(builder.groupCounts(cfg)).forEach((g) => assert.strictEqual(builder.groupCounts(cfg)[g], 0, g));

  Object.assign(cfg, { bg: 60, fade: 30, bots: true, animate: false, block: ['a_b', 'c'], font: 'Open Sans', badges_7tv: false });
  assert.deepStrictEqual(Object.keys(builder.changedKeys(cfg)).sort(),
    ['animate', 'badges_7tv', 'bg', 'block', 'bots', 'fade', 'font']);
  assert.strictEqual(builder.tagText('bg', cfg), 'bg=60');
  assert.strictEqual(builder.tagText('bots', cfg), 'bots=1');
  assert.strictEqual(builder.tagText('animate', cfg), 'animate=0');
  assert.strictEqual(builder.tagText('block', cfg), 'block=a_b,c');
  assert.strictEqual(builder.tagText('font', cfg), 'font=Open Sans');
  assert.strictEqual(builder.tagText('size', cfg), 'size');
  assert.deepStrictEqual(builder.groupCounts(cfg),
    { look: 3, platforms: 0, messages: 1, events: 0, filters: 2, emotes: 0, badges: 1, advanced: 0 });
  // The changed settings are exactly the URL's parameters after the channel.
  const inUrl = builder.urlParts(builder.overlayUrl(cfg, BASE)).params.map((p) => p.key);
  assert.deepStrictEqual(inUrl.slice(1).sort(), Object.keys(builder.changedKeys(cfg)).sort());
  assert.strictEqual(inUrl[0], 'channel');
  // Prototype names are never settings.
  assert.strictEqual(builder.tagText('constructor', cfg, builder.changedKeys(cfg)), 'constructor');
});

test('urlParts: the pieces put back together are the URL', () => {
  const join = (p) => p.base + p.params.map((x) => x.sep + x.key + (x.eq ? '=' : '') + x.value).join('');
  const cfg = Object.assign(config.defaults(), { channel: 'forsen', size: 'large', font: 'Open Sans', block: ['a', 'b'] });
  [
    builder.overlayUrl(config.defaults(), BASE),
    builder.overlayUrl(cfg, BASE),
    builder.previewUrl(config.defaults(), BASE),
    builder.overlayUrl(cfg, 'file:///E:/Github/Twitch%20Chat%20Overlay/builder.html'),
    'https://example.com/overlay.html?flag&a=b=c&empty='
  ].forEach((u) => assert.strictEqual(join(builder.urlParts(u)), u));
  const p = builder.urlParts(builder.overlayUrl(cfg, BASE));
  assert.strictEqual(p.base, 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html');
  assert.deepStrictEqual(p.params.map((x) => x.sep), ['?', '&', '&', '&']);
  assert.deepStrictEqual(p.params.map((x) => x.key), ['channel', 'size', 'font', 'block']);
  assert.deepStrictEqual(p.params.map((x) => x.value), ['forsen', 'large', 'Open+Sans', 'a,b']);
  assert.deepStrictEqual(builder.urlParts('https://example.com/overlay.html'), { base: 'https://example.com/overlay.html', params: [] });
  assert.deepStrictEqual(builder.urlParts('https://example.com/o.html?a=1#frag').params.map((x) => x.value), ['1']);
  assert.deepStrictEqual(builder.urlParts('https://example.com/o.html?a=b=c').params[0], { sep: '?', key: 'a', eq: true, value: 'b=c' });
  [null, undefined, ''].forEach((u) => assert.deepStrictEqual(builder.urlParts(u), { base: '', params: [] }));
});

test('urlNote: a warning when the URL will not work, else what it holds', () => {
  const found = { state: 'found', login: 'forsen' };
  const cfg = config.defaults();
  assert.deepStrictEqual(builder.urlNote(cfg, { state: 'empty', login: '' }, 'https://x/overlay.html').cls, 'warn');
  assert.match(builder.urlNote(cfg, { state: 'empty', login: '' }, '').text, /Add a channel first/);
  cfg.channel = 'forsen';
  const plain = builder.urlNote(cfg, found, builder.overlayUrl(cfg, BASE));
  assert.strictEqual(plain.cls, '');
  assert.match(plain.text, /Every setting is at its default/);
  cfg.bg = 60;
  assert.match(builder.urlNote(cfg, found, builder.overlayUrl(cfg, BASE)).text, /the 1 setting you changed/);
  cfg.fade = 30;
  assert.match(builder.urlNote(cfg, found, builder.overlayUrl(cfg, BASE)).text, /the 2 settings you changed/);
  // A name Twitch doesn't have, while it is still the one in the URL.
  const missing = builder.urlNote(cfg, { state: 'notfound', login: 'forsen' }, builder.overlayUrl(cfg, BASE));
  assert.strictEqual(missing.cls, 'warn');
  assert.match(missing.text, /no channel called “forsen”/);
  assert.strictEqual(builder.urlNote(cfg, { state: 'notfound', login: 'other' }, builder.overlayUrl(cfg, BASE)).cls, '');
  // From disk the URL lists every setting.
  const file = builder.urlNote(cfg, found, builder.overlayUrl(cfg, 'file:///C:/overlay/builder.html'));
  assert.match(file.text, /lists every setting/);
  assert.strictEqual(builder.urlNote(cfg, null, 'https://x/overlay.html').cls, '');
});

test('urlNote: a Kick channel alone is enough; without its chatroom id the URL gets a warning', () => {
  const cfg = Object.assign(config.defaults(), { kick: 'xqc', kick_room: '668' });
  const ok = builder.urlNote(cfg, { state: 'empty', login: '' }, builder.overlayUrl(cfg, BASE));
  assert.strictEqual(ok.cls, '');
  assert.match(ok.text, /the 2 settings you changed/);
  assert.strictEqual(builder.overlayUrl(cfg, BASE), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?kick=xqc&kick_room=668');
  cfg.kick_room = '';
  const warn = builder.urlNote(cfg, { state: 'empty', login: '' }, builder.overlayUrl(cfg, BASE));
  assert.strictEqual(warn.cls, 'warn');
  assert.match(warn.text, /Kick chatroom id is missing/);
});

// n phrases of len CJK characters, each one different (9 bytes a character once percent-encoded).
function cjkPhrases(n, len) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: len }, (_, j) => String.fromCharCode(0x4e00 + i * len + j)).join(''));
}

test('urlTooLong: the request a host gets (path and query) past 8000 bytes; a file: URL has no such limit', () => {
  assert.strictEqual(builder.MAX_URL_BYTES, 8000);
  const at = (n) => 'https://chat.masstar.org/overlay.html?block_words=' + 'a'.repeat(n);
  const fixed = '/overlay.html?block_words='.length;
  assert.strictEqual(builder.urlTooLong(at(8000 - fixed)), false);
  assert.strictEqual(builder.urlTooLong(at(8001 - fixed)), true);
  // The host and a #fragment are never sent in the request line.
  assert.strictEqual(builder.urlTooLong('https://' + 'h'.repeat(60) + '.example/overlay.html?x=' + 'a'.repeat(7970) + '#' + 'z'.repeat(500)), false);
  assert.strictEqual(builder.urlTooLong('file:///C:/overlay/overlay.html?block_words=' + 'a'.repeat(20000)), false);
  assert.strictEqual(builder.urlTooLong(''), false);
});

test('a long word list in non-Latin text: the URL says it is too long, the preview frame still loads', () => {
  const found = { state: 'found', login: 'forsen' };
  const cfg = Object.assign(config.defaults(), { channel: 'forsen' });
  // Inside the caps (50 phrases of up to 40 characters): 8-character phrases fit the overlay URL, but the preview's
  // URL, which names every setting, is past the limit.
  cfg.block_words = config.coerce('block_words', cjkPhrases(50, 8).join(','));
  cfg.keywords = config.coerce('keywords', cjkPhrases(50, 8).reverse().join(','));
  assert.strictEqual(cfg.block_words.length, 50);
  const url = builder.overlayUrl(cfg, BASE);
  assert.strictEqual(builder.urlTooLong(url), false);
  assert.strictEqual(builder.urlNote(cfg, found, url).cls, '');
  assert.strictEqual(builder.urlTooLong(builder.previewUrl(cfg, BASE)), true, 'the case this covers');
  const src = builder.previewSrc(cfg, BASE);
  assert.strictEqual(builder.urlTooLong(src), false);
  // Every list (all live keys, which reach the frame by postMessage when it loads) is written empty, so a settings.js
  // next to overlay.html still can't fill one in; everything else is as previewUrl writes it.
  const p = new URL(src).searchParams;
  ['block', 'block_words', 'keywords', 'allow_users', 'highlight_users'].forEach((k) => {
    assert.ok(config.LIVE_KEYS.includes(k), k);
    assert.strictEqual(p.get(k), '', k);
  });
  const parsed = config.parse(p);
  assert.deepStrictEqual(Object.assign({}, parsed, { block_words: cfg.block_words, keywords: cfg.keywords }), cfg);
  assert.strictEqual(builder.reloadSignature(parsed), builder.reloadSignature(cfg));
  // 10 characters: the overlay URL itself is too long for the host, and the note says so and what to do instead.
  cfg.block_words = config.coerce('block_words', cjkPhrases(50, 10).join(','));
  cfg.keywords = config.coerce('keywords', cjkPhrases(50, 10).reverse().join(','));
  const long = builder.overlayUrl(cfg, BASE);
  assert.strictEqual(builder.urlTooLong(long), true);
  const note = builder.urlNote(cfg, found, long);
  assert.strictEqual(note.cls, 'warn');
  assert.match(note.text, /too long/);
  assert.match(note.text, /settings\.js/);
  // A channel or Kick warning still comes first; from disk the URL has no such limit.
  assert.match(builder.urlNote(Object.assign({}, cfg, { kick: 'xqc' }), found, long).text, /Kick chatroom id is missing/);
  assert.match(builder.urlNote(cfg, found, builder.overlayUrl(cfg, 'file:///C:/overlay/builder.html')).text, /lists every setting/);
  // At the defaults (and any URL that fits), the preview is today's previewUrl.
  const d = config.defaults();
  assert.strictEqual(builder.previewSrc(d, BASE), builder.previewUrl(d, BASE));
  d.block_words = ['gg'];
  assert.strictEqual(builder.previewSrc(d, BASE), builder.previewUrl(d, BASE));
});

test('builder.css draws the provider logos the fields name, from img/logos', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'builder.css'), 'utf8');
  const logos = new Set();
  Object.keys(builder.META).forEach((k) => {
    const m = builder.META[k];
    if (m.logo) logos.add(m.logo);
  });
  assert.deepStrictEqual([...logos].sort(), ['7tv', 'bttv', 'chatterino', 'ffz', 'ffzap', 'homies', 'kick', 'twitch']);
  logos.forEach((name) => {
    const m = new RegExp('\\.logo-' + name + '\\s*\\{[^}]*url\\(\\.\\./(img/logos/[\\w.-]+)\\)').exec(css);
    assert.ok(m, 'no .logo-' + name + ' rule');
    assert.ok(fs.existsSync(path.join(__dirname, '..', m[1])), m[1]);
  });
  // Every emote and badge provider has a mark; the page may load images from this site.
  ['kick', 'emotes_7tv', 'emotes_bttv', 'emotes_ffz'].concat(builder.BADGE_SUBS).forEach((k) =>
    assert.ok(builder.META[k].logo, k));
  const html = fs.readFileSync(path.join(__dirname, '..', 'builder.html'), 'utf8');
  // and the channel's picture from Twitch's CDN, nothing else.
  assert.match(html, /img-src 'self' file: https:\/\/\*\.jtvnw\.net data:;/);
});

test('enum option labels cover every SPEC value', () => {
  Object.keys(config.SPEC).forEach((k) => {
    const s = config.SPEC[k];
    if (s.type !== 'enum') return;
    s.values.forEach((v) => assert.ok(builder.META[k].options[v], k + '=' + v));
  });
});

test('reload keys are exactly the non-live keys', () => {
  assert.deepStrictEqual(builder.RELOAD_KEYS.slice().sort(),
    config.KEYS.filter((k) => config.LIVE_KEYS.indexOf(k) < 0).sort());
  ['channel', 'debug', 'demo', 'emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'history', 'stv_lookup']
    .forEach((k) => assert.ok(builder.RELOAD_KEYS.indexOf(k) >= 0, k));
  assert.ok(!builder.isLiveKey('channel'));
});

test('overlayUrl resolves next to the builder and holds only non-default params', () => {
  const cfg = config.defaults();
  assert.strictEqual(builder.overlayUrl(cfg, BASE), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html');
  cfg.channel = 'forsen';
  assert.strictEqual(builder.overlayUrl(cfg, BASE), 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?channel=forsen');
  cfg.size = 'large';
  cfg.animate = false;
  cfg.block = ['nightbot', 'some_user'];
  cfg.font = 'Open Sans';
  const url = builder.overlayUrl(cfg, BASE);
  assert.strictEqual(url, 'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?channel=forsen&size=large&font=Open+Sans&animate=0&block=nightbot,some_user');
  assert.deepStrictEqual(config.parse(new URL(url).searchParams), cfg);
});

test('overlayUrl from a file:// builder lists every setting, so a settings.js there cannot fill any in', () => {
  const cfg = config.defaults();
  cfg.channel = 'xqc';
  cfg.block = ['a_b', 'c'];
  const url = builder.overlayUrl(cfg, 'file:///E:/Github/Twitch%20Chat%20Overlay/builder.html');
  assert.ok(url.startsWith('file:///E:/Github/Twitch%20Chat%20Overlay/overlay.html?channel=xqc&'), url);
  const p = new URL(url).searchParams;
  config.KEYS.forEach((k) => assert.ok(p.has(k), 'missing ' + k));
  assert.strictEqual(p.get('size'), 'medium');
  assert.strictEqual(p.get('bots'), '0');
  assert.strictEqual(p.get('demo'), '0');
  // A settings.js that changes defaults loses to every key in the URL.
  const settings = { channel: 'streamer', kick: 'someone', kick_room: '5', size: 'large', fade: 30, bots: true, demo: true, block: ['x'] };
  assert.deepStrictEqual(config.parse(p, settings), cfg);
  // and the long URL still round-trips through the paste box
  const r = builder.parsePasted(url);
  assert.deepStrictEqual(r.cfg, cfg);
  assert.strictEqual(r.count, config.KEYS.length);
  // Hosted builders keep the short URL.
  assert.strictEqual(builder.overlayUrl(cfg, BASE),
    'https://masstarvt.github.io/Twitch-Chat-Overlay/overlay.html?channel=xqc&block=a_b,c');
});

test('previewUrl sets every key explicitly and round-trips', () => {
  const cfg = config.defaults();
  cfg.demo = true;
  cfg.bg = 40;
  const url = builder.previewUrl(cfg, BASE);
  const p = new URL(url).searchParams;
  assert.strictEqual(p.get('demo'), '1');
  assert.strictEqual(p.get('badges'), '1');
  assert.strictEqual(p.get('block'), '');
  assert.strictEqual(p.get('channel'), '', 'an empty channel is written as channel=');
  assert.strictEqual(p.size === undefined ? [...p.keys()].length : p.size, config.KEYS.length);
  assert.deepStrictEqual(config.parse(p), cfg);
});

test('settingsSnippet evaluates to toObject(cfg)', () => {
  const cfg = config.defaults();
  cfg.channel = 'forsen';
  cfg.fade = 30;
  cfg.block = ['a_b'];
  cfg.stv_lookup = false;
  const snippet = builder.settingsSnippet(cfg);
  assert.match(snippet, /^\/\/ /);
  const sandbox = { window: {} };
  vm.runInNewContext(snippet, sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.window.TCO_SETTINGS)), config.toObject(cfg));
  assert.deepStrictEqual(config.parse('', sandbox.window.TCO_SETTINGS), cfg);
});

test('parsePasted reads overlay URLs, bare queries and settings.js', () => {
  const r1 = builder.parsePasted('  https://example.com/x/overlay.html?channel=Forsen&size=small&bots=1#frag ');
  assert.strictEqual(r1.count, 3);
  assert.strictEqual(r1.cfg.channel, 'forsen');
  assert.strictEqual(r1.cfg.size, 'small');
  assert.strictEqual(r1.cfg.bots, true);
  assert.strictEqual(r1.cfg.font, 'Inter');

  const r2 = builder.parsePasted('channel=xqc&shadow=0');
  assert.strictEqual(r2.cfg.channel, 'xqc');
  assert.strictEqual(r2.cfg.shadow, 0);

  const cfg = config.defaults();
  cfg.channel = 'forsen';
  cfg.readable = false;
  const r3 = builder.parsePasted(builder.settingsSnippet(cfg));
  assert.deepStrictEqual(r3.cfg, cfg);

  assert.strictEqual(builder.parsePasted(''), null);
  assert.strictEqual(builder.parsePasted('forsen'), null);
  assert.strictEqual(builder.parsePasted('https://example.com/overlay.html?foo=1'), null);
  assert.strictEqual(builder.parsePasted('{"nope":1}'), null);

  // A '#' typed in a value is part of it, as the overlay reads the URL (it cut the value and what came after).
  const r4 = builder.parsePasted('https://chat.masstar.org/overlay.html?channel=xqc&text_color=#ff8800&keywords=c#,java&size=large');
  assert.strictEqual(r4.count, 4);
  assert.deepStrictEqual([r4.cfg.text_color, r4.cfg.keywords, r4.cfg.size], ['ff8800', ['c#', 'java'], 'large']);
  // A fragment, or a bare '#' at the end, after a list of names leaves the list whole (it pasted as an empty list).
  assert.deepStrictEqual(builder.parsePasted('https://chat.masstar.org/overlay.html?channel=xqc&block=nightbot#').cfg.block, ['nightbot']);
  assert.deepStrictEqual(builder.parsePasted('https://chat.masstar.org/overlay.html?channel=xqc&block=nightbot#top').cfg.block, ['nightbot']);
  assert.deepStrictEqual(builder.parsePasted('?channel=xqc&allow_users=alice#top').cfg.allow_users, ['alice']);
});

test('parsePasted reads settings.example.js as shipped and once edited by hand', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.js'), 'utf8');
  // The placeholder is not a valid Twitch name, so an unedited copy gets the overlay's "No channel set" hint.
  assert.strictEqual(config.normalizeChannel(builder.relaxedJson(example).channel), '');
  assert.strictEqual(builder.parsePasted(example), null, 'no usable setting in the unedited example');

  // A streamer fills in the channel and uncomments some options (the example's own commas).
  const edited = example
    .replace("'YOUR CHANNEL NAME'", "'xQc'")
    .replace(/^ {2}\/\/ /gm, '  ')
    .replace("size: 'medium'", "size: 'large'")
    .replace("text_color: ''", "text_color: '#FFE08A'")
    .replace('shadow: 2', 'shadow: 0')
    .replace("layout: 'vertical'", "layout: 'horizontal'")
    .replace('bots: false', 'bots: true');
  const r2 = builder.parsePasted(edited);
  assert.ok(r2, 'edited settings.js parses');
  assert.strictEqual(r2.count, 12);
  assert.strictEqual(r2.cfg.text_color, 'ffe08a');
  assert.strictEqual(r2.cfg.layout, 'horizontal');
  assert.strictEqual(r2.cfg.channel, 'xqc');
  assert.strictEqual(r2.cfg.size, 'large');
  assert.strictEqual(r2.cfg.shadow, 0);
  assert.strictEqual(r2.cfg.bots, true);
  assert.strictEqual(r2.cfg.hide_commands, false);
  assert.strictEqual(r2.cfg.font, 'Inter');
});

test('settings.example.js runs with any of its options uncommented', () => {
  const example = fs.readFileSync(path.join(__dirname, '..', 'settings.example.js'), 'utf8');
  const lines = example.split(/\r?\n/);
  const optional = lines.map((l, i) => (/^ {2}\/\/ \w+:/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.ok(optional.length >= 8);
  const run = (on) => {
    const text = lines.map((l, i) => (on.indexOf(i) >= 0 ? l.replace('// ', '') : l)).join('\n');
    const sandbox = { window: {} };
    vm.runInNewContext(text, sandbox);
    return sandbox.window.TCO_SETTINGS;
  };
  assert.deepStrictEqual(Object.keys(run([])), ['channel']);
  optional.forEach((i) => assert.strictEqual(Object.keys(run([i])).length, 2, lines[i]));
  assert.strictEqual(Object.keys(run(optional)).length, optional.length + 1);
  // Each optional line shows its default, so uncommenting them unedited changes nothing.
  assert.deepStrictEqual(config.toObject(config.parse('', run(optional))), {});
});

test('parsePasted counts only the settings it applies, and ignores a paste with none', () => {
  // A settings.js value that isn't valid is not applied, so it isn't counted, and a paste with
  // nothing usable leaves the builder (and its channel) alone.
  assert.strictEqual(builder.parsePasted('{ "fade": "soon", "max": "lots", "nope": 1 }'), null);
  const r = builder.parsePasted('{ "channel": "xqc", "size": "huge", "max": "lots" }');
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.cfg.size, 'medium');
  // The count is what config.parse takes from the object, whatever the key's case.
  const mixed = builder.parsePasted('{ "channel": "xqc", "Size": "large" }');
  assert.strictEqual(mixed.count, 2);
  assert.strictEqual(mixed.cfg.size, 'large');
  // URL keys are case-insensitive (as in the overlay); a bad value doesn't count.
  assert.strictEqual(builder.parsePasted('?SIZE=large&fade=soon').count, 1);
  assert.strictEqual(builder.parsePasted('?size=huge&channel=a%20b'), null);
  // The last value wins, as in config.parse.
  assert.strictEqual(builder.parsePasted('?size=huge&size=small').count, 1);
});

test('parsePasted reads a hand-written settings.js: comments, single quotes, unquoted keys, trailing commas', () => {
  const text = [
    '/* my overlay {not: "json"} */',
    'window.TCO_SETTINGS = {',
    "  channel: 'https://www.twitch.tv/Forsen', // pasted link, with // inside a string",
    '  "size": \'large\',',
    "  'font': \"Comic Sans MS\",",
    '  fade: 30, /* seconds */',
    "  block: ['Nightbot', \"@StreamElements\",],",
    '  bots: true,',
    '  history: 20,',
    '};',
    '// }'
  ].join('\n');
  const r = builder.parsePasted(text);
  assert.ok(r, 'parses');
  assert.strictEqual(r.count, 7);
  const want = config.defaults();
  Object.assign(want, { channel: 'forsen', size: 'large', font: 'Comic Sans MS', fade: 30,
    block: ['nightbot', 'streamelements'], bots: true, history: 20 });
  assert.deepStrictEqual(r.cfg, want);

  // Windows line endings, and a bare object with a leading comment (no window.TCO_SETTINGS).
  assert.strictEqual(builder.parsePasted(text.replace(/\n/g, '\r\n')).count, 7);
  const bare = builder.parsePasted("// mine\n{ channel: 'xqc', max: 10 }");
  assert.strictEqual(bare.count, 2);
  assert.strictEqual(bare.cfg.max, 10);
  assert.strictEqual(builder.parsePasted('window.TCO_SETTINGS = { channel: "x" };').cfg.channel, 'x');
});

test('parsePasted never evaluates a pasted settings.js', () => {
  delete globalThis.__tcoPwned;
  [
    "window.TCO_SETTINGS = { channel: (function () { globalThis.__tcoPwned = 1; return 'x'; })() };",
    "window.TCO_SETTINGS = { channel: 'x', size: globalThis.__tcoPwned = 1 };",
    "window.TCO_SETTINGS = { channel: 'unterminated };",
    "window.TCO_SETTINGS = { channel: 'x' ", // no closing brace
    'window.TCO_SETTINGS = 5;'
  ].forEach((t) => assert.strictEqual(builder.parsePasted(t), null, t));
  // A template literal is read as plain text: its ${…} is never run (and isn't a valid channel).
  const tpl = builder.parsePasted('window.TCO_SETTINGS = { channel: `x${globalThis.__tcoPwned = 1}`, size: `small` };');
  assert.strictEqual(tpl.cfg.channel, '');
  assert.strictEqual(tpl.cfg.size, 'small');
  assert.strictEqual(globalThis.__tcoPwned, undefined);
});

test('relaxedJson turns a JS object literal into data', () => {
  assert.deepStrictEqual(builder.relaxedJson(String.raw`{a: 'it\'s', b: "x\ny", c: 'A', d: [1, -2, true, false, null,], }`),
    { a: "it's", b: 'x\ny', c: 'A', d: [1, -2, true, false, null] });
  assert.deepStrictEqual(builder.relaxedJson("x = { url: 'https://a/b?c=d,}', note: \"a, b: c\" }; // }"),
    { url: 'https://a/b?c=d,}', note: 'a, b: c' });
  const protoKeys = builder.relaxedJson("{ '__proto__': 1, constructor: 2 }");
  assert.strictEqual(Object.getPrototypeOf(protoKeys), Object.prototype, 'no prototype change');
  assert.deepStrictEqual(Object.keys(protoKeys).sort(), ['__proto__', 'constructor']);
  assert.strictEqual(({}).constructor, Object);
  assert.throws(() => builder.relaxedJson('{ a: someVariable }'));
  assert.throws(() => builder.relaxedJson('{ a: 1,, b: 2 }'));
  assert.throws(() => builder.relaxedJson('no object here'));
});

test('parsePasted ignores prototype names: __proto__, constructor and toString are not settings', () => {
  assert.strictEqual(builder.parsePasted('{"__proto__": 1}'), null);
  assert.strictEqual(builder.parsePasted('{"constructor": 1, "toString": 2}'), null);
  assert.strictEqual(builder.parsePasted('window.TCO_SETTINGS = { __proto__: 1, constructor: 2 };'), null);
  assert.strictEqual(builder.parsePasted('?constructor=1'), null);
  assert.strictEqual(builder.parsePasted('https://example.com/overlay.html?__proto__=1&hasOwnProperty=2&toString=3'), null);
  const r = builder.parsePasted('?channel=xqc&constructor=1&__proto__=2');
  assert.strictEqual(r.count, 1);
  assert.deepStrictEqual(r.cfg, Object.assign(config.defaults(), { channel: 'xqc' }));
  assert.strictEqual(({}).channel, undefined);
});

test('badge and paint switches are live keys, so turning one on needs no preview reload', () => {
  ['badges', 'paints'].concat(builder.BADGE_SUBS).forEach((k) => assert.ok(builder.isLiveKey(k), k));
});

test('reloadSignature: live keys never reload the preview; reload keys do, except those a demo ignores', () => {
  const live = Object.assign(config.defaults(), { channel: 'forsen' });
  const sig = builder.reloadSignature(live);
  config.LIVE_KEYS.forEach((k) => assert.strictEqual(builder.reloadSignature(flip(live, k)), sig, k));
  builder.RELOAD_KEYS.forEach((k) => assert.notStrictEqual(builder.reloadSignature(flip(live, k)), sig, k));
  // In demo mode the keys the demo ignores don't reload it; everything else still does.
  const demo = Object.assign({}, live, { demo: true });
  const dsig = builder.reloadSignature(demo);
  assert.deepStrictEqual(builder.DEMO_INERT.slice().sort(), ['history', 'kick_room', 'shared', 'stv_lookup']);
  builder.RELOAD_KEYS.forEach((k) => {
    assert.strictEqual(builder.reloadSignature(flip(demo, k)) === dsig, builder.DEMO_INERT.indexOf(k) >= 0, k);
  });
});

test('the preview frame is sandboxed to scripts only, except from disk where it could not load', () => {
  assert.strictEqual(builder.frameSandbox('https:'), 'allow-scripts');
  assert.strictEqual(builder.frameSandbox('http:'), 'allow-scripts');
  assert.strictEqual(builder.frameSandbox('file:'), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'builder.js'), 'utf8');
  assert.match(src, /setAttribute\('sandbox', sb\)/);
  ['js/builder.js', 'builder.html', 'js/home.js', 'index.html'].forEach((f) =>
    assert.ok(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').indexOf('allow-same-origin') < 0, f));
});

test('folderOf: builder memory from disk is keyed by folder, so index.html and builder.html share it', () => {
  assert.strictEqual(builder.folderOf('/E:/Github/Twitch%20Chat%20Overlay/builder.html'), '/E:/Github/Twitch%20Chat%20Overlay/');
  assert.strictEqual(builder.folderOf('/E:/Github/Twitch%20Chat%20Overlay/index.html'), builder.folderOf('/E:/Github/Twitch%20Chat%20Overlay/builder.html'));
  assert.strictEqual(builder.folderOf('/C:/other/builder.html') === builder.folderOf('/C:/else/builder.html'), false);
  assert.strictEqual(builder.folderOf('/folder/'), '/folder/');
  assert.strictEqual(builder.folderOf('builder.html'), '');
  assert.strictEqual(builder.folderOf(null), '');
});

test('lastSnapshot: the snapshot saved as index.html counts only until the folder has one of its own', () => {
  assert.strictEqual(builder.lastSnapshot(null, '{"size":"large"}'), '{"size":"large"}', 'first open after the rename');
  assert.strictEqual(builder.lastSnapshot('{"size":"small"}', '{"size":"large"}'), '{"size":"small"}',
    'settings.js went back to what index.html last saw: that is a change since the last load');
  assert.strictEqual(builder.lastSnapshot('{}', '{"size":"large"}'), '{}');
  assert.strictEqual(builder.lastSnapshot(null, null), null);
  assert.strictEqual(builder.lastSnapshot(undefined, null), null);
});

test('sub-headings: each above a field of its own section, in order; Advanced\'s have ids a link can open', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'builder.html'), 'utf8');
  const sections = builder.sectionIds();
  const ids = [];
  builder.groupLayout().forEach((g) => {
    assert.ok(Array.isArray(g.subs) && typeof g.more === 'string', g.id + ': groupLayout passes subs and more on');
    let at = -1;
    g.subs.forEach((s) => {
      assert.ok(s.title, g.id + ': a heading has a title');
      const i = g.keys.indexOf(s.first);
      assert.ok(i > at, g.id + ': ' + s.first + ' is a field of the section, after the heading before');
      at = i;
      if (g.id !== 'advanced') return;
      assert.match(s.id, /^adv-[a-z0-9-]+$/, s.id);
      assert.ok(ids.indexOf(s.id) < 0, s.id + ' twice');
      ids.push(s.id);
      assert.ok(sections.indexOf(s.id) < 0, s.id + ' is a section id');
      assert.ok(html.indexOf('id="' + s.id + '"') < 0, s.id + ' is an id in builder.html');
      assert.strictEqual(builder.sectionFromHash('#' + s.id), 'advanced', s.id);
    });
  });
  assert.deepStrictEqual(builder.advIds(), ids);
  builder.groupLayout().forEach((g) => {
    if (g.more) assert.ok(ids.indexOf(g.more) >= 0, g.id + ': More in Advanced goes to a heading of Advanced');
  });
  // README names every heading's link, and no other.
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.deepStrictEqual(Array.from(new Set(Array.from(readme.matchAll(/`#(adv-[a-z0-9-]+)`/g), (m) => m[1]))), ids);
});

test('Look and Advanced: the headings and what is under each; Troubleshooting stays first', () => {
  const g = (id) => builder.groupLayout().filter((x) => x.id === id)[0];
  // Each heading with the fields under it, up to the next heading.
  const outline = (grp) => {
    const out = [];
    grp.keys.forEach((k) => {
      const s = grp.subs.filter((x) => x.first === k)[0];
      if (s) out.push([s.id ? s.title + ' #' + s.id : s.title]);
      out[out.length - 1].push(k);
    });
    return out;
  };
  assert.deepStrictEqual(outline(g('look')), [
    ['Layout', 'layout', 'align', 'text_align', 'row_align'],
    ['Text', 'size', 'font', 'text_weight', 'text_color', 'shadow', 'outline'],
    ['Names', 'name_color', 'name_line'],
    ['Box', 'bg', 'bg_color', 'accent_bar'],
    ['Animation', 'animate', 'enter_style']
  ]);
  assert.deepStrictEqual(outline(g('advanced')), [
    ['Troubleshooting #adv-trouble', 'debug', 'demo'],
    ['Text #adv-text', 'text_px', 'line_height', 'text_case', 'shadow_color', 'outline_color'],
    ['Names #adv-names', 'names', 'name_weight', 'name_font', 'name_fallback', 'name_sep', 'readable_level'],
    ['Box #adv-box', 'bg_shape', 'bg_width', 'spacing'],
    ['Layout #adv-layout', 'line_width', 'pad_x', 'edge_fade', 'row_sep'],
    ['Animation #adv-animation', 'enter_ms', 'fade_out_ms', 'exit_style', 'smooth_scroll'],
    ['Chat events #adv-events', 'notice_color', 'notice_size', 'first_msg_color', 'reply_style'],
    ['Highlights #adv-highlights', 'mention_color', 'keywords', 'highlight_users', 'keyword_color', 'points_highlight', 'points_color',
      'role_style', 'broadcaster_color', 'mod_color', 'vip_color'],
    ['Filters #adv-filters', 'allow_users', 'min_length', 'command_prefixes'],
    ['Emotes #adv-emotes', 'gif_size', 'giant_emotes'],
    ['Lighter on PC #adv-lighter', 'shadow_style', 'paint_images', 'homies_lists']
  ]);
  // Chat events: the event types right under their switch, the mentions and the timestamps last, under a heading of
  // their own.
  assert.deepStrictEqual(g('events').keys, ['events', 'event_subs', 'event_gifts', 'event_raids', 'event_bits_badge',
    'event_announcements', 'replies', 'first_msg', 'shared', 'mentions', 'timestamps']);
  assert.deepStrictEqual(g('events').subs, [{ title: 'Highlights & timestamps', first: 'mentions' }]);
  // Filters: the common three after what is there, the rest under Advanced's Filters.
  assert.deepStrictEqual(g('filters').keys, ['bots', 'hide_commands', 'block', 'block_words', 'links', 'role_filter']);
  assert.strictEqual(g('filters').more, 'adv-filters');
  assert.deepStrictEqual(builder.META.role_filter.options, { all: 'Everyone', subs: 'Subs+', vips: 'VIPs+', mods: 'Mods' });
  assert.strictEqual(builder.META.role_filter.wrap, true);
  assert.deepStrictEqual(builder.META.links.options, { show: 'Show', shorten: 'Shorten', hide: 'Hide' });
  assert.deepStrictEqual(['block_words', 'allow_users', 'command_prefixes', 'min_length', 'links', 'role_filter'].map(builder.widgetFor),
    ['text', 'text', 'text', 'stepper', 'seg', 'seg']);
  assert.strictEqual(builder.valueText('min_length', 0), 'Off');
  assert.strictEqual(builder.valueText('min_length', 5), '5');
  assert.match(builder.META.block_words.help, /Try overlay to see it in the preview/);
  assert.match(builder.META.block_words.help, /settings\.js/);
  // The cap (config.coerce's words) is said where the list is typed, and holds in settings.js as well.
  assert.match(builder.META.block_words.help, /Up to 50, each up to 40 characters; more are left out, in settings\.js too/);
  assert.match(builder.META.keywords.help, /Up to 50, each up to 40 characters/);
  // Inside that cap a list in Japanese or Korean can make a URL the host refuses (urlTooLong): both fields say so.
  ['block_words', 'keywords'].forEach((k) =>
    assert.match(builder.META[k].help, /about 8,000 characters long, and a letter outside A–Z takes 6 to 9 of them, .*settings\.js\.$/, k));
  // What the field says it left out: past the first 50, or over 40 characters; not a repeat, a case or an empty one.
  const fifty = Array.from({ length: 55 }, (_, i) => 'w' + i);
  const kept = config.coerce('block_words', fifty.join(','));
  assert.strictEqual(kept.length, 50);
  assert.strictEqual(builder.wordsLeftOut('block_words', fifty.join(', '), kept), 5);
  assert.strictEqual(builder.wordsLeftOut('block_words', 'a, ' + 'x'.repeat(41) + ', b', ['a', 'b']), 1);
  assert.strictEqual(builder.wordsLeftOut('keywords', 'GG, gg ,  , good  game,,', ['gg', 'good game']), 0);
  assert.strictEqual(builder.wordsLeftOut('keywords', '', []), 0);
  // A Japanese or Chinese input method's comma separates phrases there too: the long one after it is counted.
  const jp = '草、' + 'x'.repeat(41) + '、www';
  assert.deepEqual(config.coerce('keywords', jp), ['草', 'www']);
  assert.strictEqual(builder.wordsLeftOut('keywords', jp, ['草', 'www']), 1);
  assert.strictEqual(builder.wordsLeftOut('keywords', '加油，好看، شكرا', config.coerce('keywords', '加油，好看، شكرا')), 0);
  // The block list goes by name on both platforms (overlay.js shouldShow; kick.js sets a Kick line's login).
  assert.match(builder.META.block.help, /Twitch and Kick alike/);
  assert.doesNotMatch(builder.META.block.help, /Twitch usernames/);
  assert.match(builder.META.links.help, /a demo message has a link/);
  assert.match(builder.META.links.help, /never clickable/);
  assert.match(builder.META.min_length.help, /4 hides gg, o7 and LUL/);
  assert.match(builder.META.allow_users.help, /notices still show/);
  assert.match(builder.META.role_filter.help, /broadcaster always shows/);
  assert.match(builder.META.hide_commands.help, /Command prefixes \(Advanced\)/);
  // Every sign Command prefixes takes is named in its help and its error text.
  config.PREFIX_CHARS.split('').forEach((ch) => {
    assert.ok(builder.META.command_prefixes.help.indexOf(' ' + ch) >= 0, ch);
    assert.ok(builder.META.command_prefixes.bad.indexOf(' ' + ch) >= 0, ch);
  });
  // The event switches: short labels, one help under the grid saying what the demo shows of them.
  assert.deepStrictEqual(builder.EVENT_SUBS.map((k) => builder.META[k].label),
    ['Subs and resubs', 'Gift subs', 'Raids and Kick hosts', 'Bits badges', 'Announcements']);
  assert.match(builder.SUBGRIDS.events.help, /resubscriber’s own message still shows/);
  assert.match(builder.SUBGRIDS.events.help, /cheers always show/);
  assert.match(builder.SUBGRIDS.events.help, /The demo has a resub and a raid only/);
  // The highlights: short labels that wrap in a narrow panel, the help naming the demo words that show them.
  assert.deepStrictEqual(builder.META.mentions.options, { off: 'Off', at: '@name', name: 'Plain too' });
  assert.strictEqual(builder.META.mentions.wrap, true);
  assert.deepStrictEqual(builder.META.role_style.options, { off: 'Off', bar: 'Bar', tint: 'Tint' });
  assert.deepStrictEqual(['keywords', 'highlight_users'].map(builder.widgetFor), ['text', 'text']);
  assert.match(builder.META.keywords.help, /Try overlay to see it in the preview/);
  assert.match(builder.META.highlight_users.help, /Try paintedpal to see it in the preview/);
  assert.match(builder.META.mentions.help, /Needs a Twitch or Kick channel/);
  assert.match(builder.META.role_style.help, /works with badges off/);
  assert.deepStrictEqual(['mention_color', 'keyword_color', 'points_color', 'broadcaster_color', 'mod_color', 'vip_color']
    .map((k) => [builder.widgetFor(k), builder.META[k].swatch]),
  [['color', '#e91916'], ['color', '#ffb31a'], ['color', '#9146ff'], ['color', '#e91916'], ['color', '#00ad03'], ['color', '#e005b9']]);
  assert.deepStrictEqual(builder.META.timestamps.options, { off: 'Off', '12h': '12-hour', '24h': '24-hour' });
  assert.deepStrictEqual(builder.META.name_sep.options, { colon: 'Colon', space: 'Space', dash: 'Dash', arrow: 'Arrow' });
  assert.deepStrictEqual(builder.META.reply_style.options, { full: 'Full', name: 'Name only' });
  assert.strictEqual(builder.META.reply_style.wrap, true);
  assert.strictEqual(builder.META.name_font.placeholder, 'Same as Font');
  assert.strictEqual(builder.widgetFor('name_font'), 'font');
  assert.strictEqual(builder.widgetFor('readable_level'), 'stepper');
  // The common sizes are on their own tabs, after what is there already.
  assert.deepStrictEqual(g('emotes').keys, ['emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'gifs', 'emote_scale', 'emote_only', 'row_grow']);
  assert.deepStrictEqual(g('badges').keys.slice(-4), ['paints', 'stv_lookup', 'readable', 'badge_size']);
  assert.strictEqual(g('look').more, 'adv-text');
  assert.strictEqual(g('events').more, 'adv-events');
  assert.strictEqual(g('emotes').more, 'adv-emotes');
  assert.strictEqual(g('badges').more, 'adv-lighter');
  assert.deepStrictEqual(builder.GROUPS.filter((x) => x.more).map((x) => x.id), ['look', 'messages', 'events', 'filters', 'emotes', 'badges']);
  // Messages: as before, and its foot links Advanced's Animation (the fade-out length and the exit).
  assert.deepStrictEqual(g('messages').keys, ['fade', 'max', 'history']);
  assert.strictEqual(g('messages').more, 'adv-animation');
  assert.deepStrictEqual(builder.META.emote_only.options, { normal: 'Normal', big: 'Big', huge: 'Huge' });
  assert.deepStrictEqual(builder.segValues('gif_size').map((v) => v.label), ['1×', '2×', '3×']);
  assert.match(builder.META.gif_size.help, /The demo has no GIF/);
  assert.match(builder.META.emote_scale.help, /look soft/);
  assert.match(builder.META.badge_size.help, /even with badges off/);
  assert.match(builder.META.text_px.help, /100 px tall source/);
  // The lighter-on-PC switches name what they save and what they cost.
  assert.deepStrictEqual(builder.META.shadow_style.options, { filter: 'Whole line', text: 'Text only' });
  assert.deepStrictEqual(builder.META.paint_images.options, { animated: 'Animated', static: 'Still' });
  assert.deepStrictEqual(builder.META.homies_lists.options, { all: 'All lists', light: 'Light' });
  assert.match(builder.META.shadow_style.help, /half/);
  assert.match(builder.META.shadow_style.help, /Emotes, badges, GIFs, the box and painted names then have no shadow/);
  assert.match(builder.META.homies_lists.help, /9,400/);
  assert.match(builder.META.shadow_color.help, /emotes, badges and the box/);
  assert.deepStrictEqual(builder.META.outline.names, ['None', 'Thin', 'Medium', 'Thick']);
  assert.deepStrictEqual(builder.segValues('outline').map((v) => v.label), ['None', 'Thin', 'Medium', 'Thick']);
});

test('the look options grey out while the setting they need is off, and their help names it', () => {
  const d = config.defaults();
  const off = (k, over) => builder.fieldOff(k, Object.assign({}, d, over || {}));
  const needs = {
    bg_color: [{ bg: 0 }, { bg: 1 }, 'Line background'],
    bg_shape: [{ bg: 0 }, { bg: 40 }, 'Line background'],
    bg_width: [{ bg: 0 }, { bg: 40 }, 'Line background'],
    name_line: [{ names: false }, {}, 'Show names'],
    notice_color: [{ events: false }, {}, 'Show subs'],
    notice_size: [{ events: false }, {}, 'Show subs'],
    first_msg_color: [{ first_msg: false }, { first_msg: true }, 'Mark first-time chatters'],
    shadow_color: [{ shadow: 0 }, {}, 'Text shadow'],
    shadow_style: [{ shadow: 0 }, { shadow: 1 }, 'Text shadow'],
    outline_color: [{ outline: 0 }, { outline: 1 }, 'Text outline'],
    paint_images: [{ paints: false }, {}, '7TV name paints'],
    stv_lookup: [{ paints: false, badges_7tv: false }, { paints: false }, '7TV name paints, or Show badges and 7TV'],
    homies_lists: [{ badges_homies: false }, {}, 'Chatterino Homies'],
    size: [{ text_px: 8 }, { text_px: 0 }, 'Exact text size'],
    gif_size: [{ gifs: false }, {}, 'Show GIFs posted in chat'],
    name_fallback: [{ name_color: 'ff8800' }, {}, 'Name color (Look)'],
    name_sep: [{ names: false }, {}, 'Show names'],
    readable_level: [{ readable: false }, {}, 'Brighten dark name colors (Badges & paints)'],
    readable: [{ name_color: 'ff8800' }, { name_fallback: 'ff8800' }, 'Not used while a Name color (Look) is set'],
    reply_style: [{ replies: false }, {}, 'Show what replies are answering'],
    mention_color: [{}, { mentions: 'at', channel: 'home' }, 'Highlight channel mentions (Chat events)'],
    mentions: [{ mentions: 'at' }, { mentions: 'at', channel: 'home' }, 'Needs a Twitch or Kick channel'],
    platform_icons: [{}, { kick: 'kickname' }, 'a Kick channel'],
    keyword_color: [{}, { keywords: ['gg'] }, 'Highlight words'],
    points_color: [{ points_highlight: false }, {}, 'Channel-points highlights'],
    broadcaster_color: [{ role_style: 'off' }, { role_style: 'bar' }, 'Mark broadcaster, mods, VIPs'],
    mod_color: [{}, { role_style: 'tint' }, 'Mark broadcaster, mods, VIPs'],
    vip_color: [{}, { role_style: 'bar' }, 'Mark broadcaster, mods, VIPs'],
    command_prefixes: [{}, { hide_commands: true }, 'Hide !commands (Filters)'],
    enter_style: [{ animate: false }, {}, 'Animate new messages'],
    enter_ms: [{ animate: false }, {}, 'Animate new messages (Look)'],
    fade_out_ms: [{}, { fade: 30 }, 'Remove messages after (Messages)'],
    exit_style: [{ fade: 0 }, { fade: 5 }, 'Remove messages after (Messages) and a Fade-out length other than Instant'],
    smooth_scroll: [{ animate: false }, {}, 'Animate new messages on (Look)']
  };
  // The highlight word color is for the users too.
  assert.strictEqual(off('keyword_color', { highlight_users: ['a'] }), false);
  assert.strictEqual(off('mention_color', { mentions: 'name', kick: 'kickname' }), false);
  assert.strictEqual(off('mention_color', { mentions: 'name' }), true, 'no channel to mention');
  assert.match(builder.META.keyword_color.help, /Highlight these users/);
  Object.keys(needs).forEach((k) => {
    assert.strictEqual(off(k, needs[k][0]), true, k + ' off');
    assert.strictEqual(off(k, needs[k][1]), false, k + ' on');
    assert.ok(builder.META[k].help.indexOf(needs[k][2]) >= 0, k + ' help names ' + needs[k][2]);
  });
  // Two more needs each: no separator is drawn under a name on its own line, in a column or (1.6.1) in a row (overlay.css
  // hides .colon), and one Name color for everyone is never lightened.
  assert.strictEqual(off('name_sep', { name_line: true }), true);
  assert.strictEqual(off('name_sep', { name_line: true, layout: 'horizontal' }), true);
  assert.strictEqual(off('name_sep', { layout: 'horizontal' }), false);
  assert.match(builder.META.name_sep.help, /isn’t drawn under Name on its own line \(Look\)\./);
  assert.doesNotMatch(builder.META.name_sep.help, /vertical layout/);
  assert.strictEqual(off('readable_level', { name_color: 'ff8800' }), true);
  assert.strictEqual(off('readable_level', { name_fallback: 'ff8800' }), false);
  assert.match(builder.META.readable_level.help, /not used while a Name color \(Look\) is set/);
  // 7TV is asked about chatters only for what the overlay draws of theirs (overlay.js stvStyleOn): with paints off and
  // the 7TV badges off (or badges off), the lookup switch does nothing, and only then is it greyed out.
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'overlay.js'), 'utf8');
  const body = /function stvStyleOn\(c\) \{ return ([^;]+); \}/.exec(src);
  assert.ok(body, 'overlay.js stvStyleOn');
  const looksUp = new Function('c', 'return ' + body[1]);
  [false, true].forEach((paints) => [false, true].forEach((badges) => [false, true].forEach((stv) => {
    const over = { paints: paints, badges: badges, badges_7tv: stv };
    assert.strictEqual(off('stv_lookup', over), !looksUp(Object.assign({}, d, over, { stv_lookup: true })),
      JSON.stringify(over));
  })));
  // The platform icons need a Kick channel (overlay.js showPlatforms, in the demo preview: the Twitch channel is
  // needed outside it), and a mention a channel to mention (renderer.js buildMatchers): greyed out exactly while
  // they draw nothing.
  const showsBody = /function showPlatforms\(\) \{ return ([^;]+); \}/.exec(src);
  const twitchBody = /function twitchOn\(\) \{ return ([^;]+); \}/.exec(src);
  assert.ok(showsBody && twitchBody, 'overlay.js showPlatforms and twitchOn');
  const twitchOn = new Function('S', 'return ' + twitchBody[1]);
  const shows = new Function('S', 'twitchOn', 'return ' + showsBody[1]);
  const matchers = require('../js/renderer.js')._internal.matchersFor;
  ['', 'home'].forEach((channel) => ['', 'kickname'].forEach((kick) => {
    const over = { channel: channel, kick: kick }, at = JSON.stringify(over);
    const S = { cfg: Object.assign({}, d, over, { platform_icons: true, demo: true }) };
    assert.strictEqual(off('platform_icons', over), !shows(S, () => twitchOn(S)), 'platform_icons ' + at);
    ['at', 'name'].forEach((mentions) => {
      const tints = !!matchers(Object.assign({}, d, over, { mentions: mentions })).mention;
      assert.strictEqual(off('mentions', over), !tints, 'mentions ' + at);
      assert.strictEqual(off('mention_color', Object.assign({ mentions: mentions }, over)), !tints, 'mention_color ' + at);
    });
    assert.strictEqual(off('mention_color', Object.assign({ mentions: 'off' }, over)), true, 'mentions off ' + at);
  }));
  // Column only: off in a row whatever else is set.
  ['bg_width', 'text_align', 'smooth_scroll'].forEach((k) => {
    assert.strictEqual(builder.META[k].only, 'vertical', k);
    assert.strictEqual(off(k, { bg: 40, layout: 'horizontal' }), true, k);
    assert.match(builder.META[k].help, /Vertical layout only/, k);
  });
  // 1.6.1: a name on its own line makes cards of a row, which wants about twice the height.
  assert.strictEqual(builder.META.name_line.only, undefined);
  assert.strictEqual(off('name_line', { layout: 'horizontal' }), false);
  assert.strictEqual(off('name_line', { layout: 'horizontal', names: false }), true);
  assert.match(builder.META.name_line.help, /small card of two lines/);
  assert.match(builder.META.name_line.help, /about 130 px in place of 100/);
  assert.doesNotMatch(builder.META.name_line.help, /Vertical layout only/);
  // Drawn as a column draws them, and in a row only with Let big emotes grow the row (row_grow): off in a row without it,
  // and their help names it. GIF size still needs GIFs.
  ['emote_only', 'gif_size', 'giant_emotes'].forEach((k) => {
    assert.strictEqual(builder.META[k].only, undefined, k);
    assert.strictEqual(off(k), false, k);
    assert.strictEqual(off(k, { layout: 'horizontal' }), true, k);
    assert.strictEqual(off(k, { layout: 'horizontal', row_grow: true }), false, k);
    assert.strictEqual(off(k, { row_grow: true }), false, k);
    assert.match(builder.META[k].help, /In a horizontal row only with Let big emotes grow the row on/, k);
    assert.doesNotMatch(builder.META[k].help, /Vertical layout only/, k);
  });
  assert.strictEqual(off('gif_size', { layout: 'horizontal', row_grow: true, gifs: false }), true);
  // Row only: the mark between messages, the row's alignment and the switch that lets big emotes grow it.
  ['row_sep', 'row_align', 'row_grow'].forEach((k) => {
    assert.strictEqual(builder.META[k].only, 'horizontal', k);
    assert.strictEqual(off(k), true, k);
    assert.strictEqual(off(k, { layout: 'horizontal' }), false, k);
    assert.match(builder.META[k].help, /Horizontal layout only/, k);
  });
  assert.strictEqual(builder.META.row_align.label, 'Row alignment');
  assert.deepStrictEqual(builder.META.row_align.options, { left: 'Left', center: 'Center', right: 'Right' });
  assert.deepStrictEqual(builder.segValues('row_align').map((v) => v.label), ['Left', 'Center', 'Right']);
  assert.match(builder.META.row_align.help, /newest one is always at the right end/);
  assert.strictEqual(builder.META.row_grow.label, 'Let big emotes grow the row');
  assert.strictEqual(builder.widgetFor('row_grow'), 'check');
  assert.match(builder.META.row_grow.help, /Emote-only messages/);
  assert.match(builder.META.row_grow.help, /GIF size/);
  assert.match(builder.META.row_grow.help, /gigantified emotes/);
  assert.match(builder.META.row_grow.help, /tall enough for them, or they are cut off/);
  // The soft edge's two limits, as the README states them.
  assert.match(builder.META.edge_fade.help, /stays clear unless it is taller than that/);
  assert.match(builder.META.edge_fade.help, /In a row the newest message starts after the fade/);
  // The other layout options apply in both layouts, with nothing else needed.
  ['line_width', 'pad_x', 'edge_fade'].forEach((k) => {
    assert.strictEqual(off(k), false, k);
    assert.strictEqual(off(k, { layout: 'horizontal' }), false, k);
  });
  assert.strictEqual(off('text_align'), false);
  // The sizes apply in both layouts (but the column ones above), and badge size even with badges off: the
  // platform icons and Shared Chat avatars are badges too.
  ['text_px', 'badge_size', 'emote_scale'].forEach((k) => {
    assert.strictEqual(off(k, { layout: 'horizontal', badges: false, gifs: false }), false, k);
  });
  assert.strictEqual(off('size', { text_px: 96 }), true);
  // Names off greys out only what draws a name line: name_weight and name_font still style reply headers, and the
  // name colors still color /me messages.
  const namesOff = Object.keys(builder.META).filter((k) => !off(k) && off(k, { names: false }));
  assert.deepStrictEqual(namesOff, ['name_line', 'name_sep']);
  ['name_font', 'name_color', 'name_fallback', 'readable_level', 'timestamps']
    .forEach((k) => assert.strictEqual(off(k, { names: false, layout: 'horizontal' }), false, k));
  ['text_weight', 'text_color', 'line_height', 'text_case', 'names', 'name_weight', 'spacing']
    .forEach((k) => assert.strictEqual(off(k, { bg: 0, events: false, first_msg: false, layout: 'horizontal' }), false, k));
});

test('the animation options: labels, steppers and what each needs', () => {
  const m = builder.META;
  const off = (k, over) => builder.fieldOff(k, Object.assign(config.defaults(), over || {}));
  // animate is relabelled now that it has a choice of entrances; the switch itself is unchanged.
  assert.strictEqual(m.animate.label, 'Animate new messages');
  // Lengths, both (a higher number is slower, so not a "speed").
  assert.deepStrictEqual([m.enter_ms.label, m.fade_out_ms.label], ['Entrance length', 'Fade-out length']);
  assert.strictEqual(builder.widgetFor('animate'), 'check');
  assert.deepStrictEqual(m.enter_style.options, { slide: 'Slide', fade: 'Fade', pop: 'Pop', drop: 'Drop' });
  assert.deepStrictEqual(m.exit_style.options, { fade: 'Fade', slide: 'Slide' });
  assert.deepStrictEqual(['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'].map(builder.widgetFor), ['seg', 'stepper', 'stepper', 'seg']);
  // Steps of 50 and 250 ms; a fade-out of 0 shows as Instant (the entrance has no 0: animate=0 is its off switch).
  assert.deepStrictEqual([m.enter_ms.step, m.enter_ms.unit, m.enter_ms.zero], [50, 'ms', undefined]);
  assert.deepStrictEqual([m.fade_out_ms.step, m.fade_out_ms.unit, m.fade_out_ms.zero], [250, 'ms', 'Instant']);
  assert.deepStrictEqual([50, 180, 1000].map((v) => builder.valueText('enter_ms', v)), ['50 ms', '180 ms', '1000 ms']);
  assert.deepStrictEqual([0, 250, 1000].map((v) => builder.valueText('fade_out_ms', v)), ['Instant', '250 ms', '1000 ms']);
  assert.deepStrictEqual(['180 ms', '180ms', '300', '0', '20', '5000', '1 s', '2.5'].map((x) => builder.parseStep('enter_ms', x)),
    [180, 180, 300, 50, 50, 1000, undefined, undefined]);
  assert.deepStrictEqual(['Instant', 'instant', '0', '1000 ms', '12000'].map((x) => builder.parseStep('fade_out_ms', x)), [0, 0, 0, 1000, 10000]);
  ['enter_ms', 'fade_out_ms'].forEach((k) => {
    const s = config.SPEC[k];
    [s.min, s.def, s.max].forEach((v) => assert.strictEqual(builder.parseStep(k, builder.valueText(k, v)), v, k + ' ' + v));
    // Every press lands on a value the setting takes, up and down.
    for (let v = s.min; v < s.max;) {
      const next = builder.stepValue(v, 1, m[k].step, s.min, s.max);
      assert.ok(next > v && config.coerce(k, next) === next, k + ' up from ' + v);
      assert.ok(builder.stepValue(next, -1, m[k].step, s.min, s.max) < next, k + ' down from ' + next);
      v = next;
    }
  });
  // The entrance needs animate; the fade-out and the exit need fade, whatever animate is, in both layouts.
  assert.deepStrictEqual(['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'].map((k) => off(k)), [false, false, true, true]);
  assert.deepStrictEqual(['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'].map((k) => off(k, { animate: false, fade: 30 })),
    [true, true, false, false]);
  ['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'].forEach((k) =>
    assert.strictEqual(off(k, { fade: 30, layout: 'horizontal' }), false, k));
  // An Instant fade-out leaves the exit nothing to move in (the length itself stays on, to be raised again).
  assert.deepStrictEqual(['fade_out_ms', 'exit_style'].map((k) => off(k, { fade: 30, fade_out_ms: 0 })), [false, true]);
  assert.strictEqual(off('exit_style', { fade: 30, fade_out_ms: 250 }), false);
  // The fade's own help follows the fade-out length (no more "the last second").
  assert.doesNotMatch(m.fade.help, /The last second fades out/);
  assert.match(m.fade.help, /Fade-out length/);
  assert.match(m.fade_out_ms.help, /never longer than it stays/);
  assert.match(m.enter_ms.help, /its fade-out waits for the entrance to end and takes the time left/);
  assert.match(m.exit_style.help, /up, down when new messages appear at the top, or left in a row/);
  assert.match(m.enter_style.help, /older messages still glide left/);
  // Smooth scrolling: a switch in Advanced > Animation, for a column with animate on; it says what still jumps.
  assert.strictEqual(m.smooth_scroll.label, 'Smooth scrolling');
  assert.strictEqual(builder.widgetFor('smooth_scroll'), 'check');
  assert.ok(builder.isLiveKey('smooth_scroll'));
  assert.deepStrictEqual([off('smooth_scroll'), off('smooth_scroll', { align: 'top' }), off('smooth_scroll', { animate: false }),
    off('smooth_scroll', { layout: 'horizontal' })], [false, false, true, true]);
  assert.match(m.smooth_scroll.help, /down when new messages appear at the top/);
  assert.match(m.smooth_scroll.help, /removed from the middle.*still closes its gap at once/);
  assert.strictEqual(builder.groupCounts(Object.assign(config.defaults(), { smooth_scroll: true })).advanced, 1);
});

test('sectionFromHash: an Advanced sub-heading id opens Advanced; every other hash as before', () => {
  const adv = ['adv-trouble', 'adv-lighter'];
  assert.strictEqual(builder.sectionFromHash('#adv-lighter', null, adv), 'advanced');
  assert.strictEqual(builder.sectionFromHash('#ADV-Trouble', null, adv), 'advanced');
  assert.strictEqual(builder.sectionFromHash('adv-trouble', null, adv), 'advanced');
  ['#adv-nope', '#adv-', '#group-adv-trouble', '#advanced-trouble'].forEach((h) =>
    assert.strictEqual(builder.sectionFromHash(h, null, adv), '', h));
  assert.strictEqual(builder.sectionFromHash('#adv-nope'), '', 'only the headings GROUPS has');
  assert.strictEqual(builder.sectionFromHash('#obs', null, adv), 'obs');
  assert.strictEqual(builder.sectionFromHash('#group-filters', null, adv), 'filters');
  assert.strictEqual(builder.sectionFromHash('#advanced', null, adv), 'advanced');
});

test('subgrids: a block of switches in the section of the switch that rules them, greyed out while it is off', () => {
  const groups = builder.groupLayout();
  assert.strictEqual(builder.SUBGRIDS.badges.keys, builder.BADGE_SUBS);
  assert.strictEqual(builder.SUBGRIDS.badges.label, 'Badge sources');
  assert.strictEqual(builder.SUBGRIDS.events.keys, builder.EVENT_SUBS);
  assert.strictEqual(builder.SUBGRIDS.events.label, 'Event types');
  assert.deepStrictEqual(Object.keys(builder.SUBGRIDS), ['badges', 'events']);
  Object.keys(builder.SUBGRIDS).forEach((master) => {
    const sg = builder.SUBGRIDS[master];
    assert.strictEqual(config.SPEC[master].type, 'bool', master);
    assert.ok(sg.label, master + ': the grid has a name for assistive tech');
    const g = groups.filter((x) => x.keys.indexOf(master) >= 0)[0];
    const at = sg.keys.map((k) => g.keys.indexOf(k));
    assert.ok(at[0] > g.keys.indexOf(master), master + ': the grid comes after its switch');
    assert.deepStrictEqual(at, at.map((_, i) => at[0] + i), master + ': one block of fields');
    const off = Object.assign(config.defaults(), { [master]: false });
    sg.keys.forEach((k) => {
      assert.strictEqual(config.SPEC[k].type, 'bool', k);
      assert.strictEqual(builder.subgridOf(k), master, k);
      assert.strictEqual(builder.fieldOff(k, config.defaults()), false, k);
      assert.strictEqual(builder.fieldOff(k, off), true, k + ' with ' + master + ' off');
    });
  });
  assert.strictEqual(builder.subgridOf('paints'), null);
  assert.strictEqual(builder.subgridOf('constructor'), null);
});

test('META.when reads settings only, and META.only names a layout', () => {
  let n = 0;
  Object.keys(builder.META).forEach((k) => {
    const m = builder.META[k];
    if (m.only !== undefined) assert.ok(['vertical', 'horizontal'].indexOf(m.only) >= 0, k);
    if (m.when === undefined) return;
    n++;
    assert.strictEqual(typeof m.when, 'function', k);
    const read = new Set();
    const cfg = new Proxy(config.defaults(), { get(o, p) { read.add(p); return o[p]; } });
    assert.strictEqual(typeof m.when(cfg), 'boolean', k);
    assert.ok(read.size > 0, k + ' depends on a setting');
    read.forEach((p) => assert.ok(Object.prototype.hasOwnProperty.call(config.SPEC, p), k + ' reads ' + String(p)));
    assert.ok(!read.has(k), k + ' does not depend on itself');
  });
  assert.ok(n >= builder.BADGE_SUBS.length, 'the badge sources depend on badges');
  // META.only: off in the other layout, and only there.
  const m = builder.META.first_msg;
  m.only = 'vertical';
  try {
    assert.strictEqual(builder.fieldOff('first_msg', config.defaults()), false);
    assert.strictEqual(builder.fieldOff('first_msg', Object.assign(config.defaults(), { layout: 'horizontal' })), true);
  } finally {
    delete m.only;
  }
  assert.strictEqual(builder.fieldOff('first_msg', Object.assign(config.defaults(), { layout: 'horizontal' })), false);
});

test('every GROUPS key is a SPEC key, listed once, and together they are every setting but channel', () => {
  const all = [].concat(...builder.GROUPS.map((g) => g.keys));
  all.forEach((k) => assert.ok(Object.prototype.hasOwnProperty.call(config.SPEC, k), 'stale GROUPS key ' + k));
  assert.deepStrictEqual(all.slice().sort(), config.KEYS.filter((k) => k !== 'channel').sort());
});

test('startCfg: a ?channel= link keeps the remembered settings; a full link starts from defaults', () => {
  const stored = config.toObject(Object.assign(config.defaults(), { channel: 'old', size: 'large', fade: 30 }));
  const a = builder.startCfg('?channel=NewOne', stored);
  assert.strictEqual(a.fromQuery, true);
  assert.strictEqual(a.cfg.channel, 'newone');
  assert.strictEqual(a.cfg.size, 'large');
  assert.strictEqual(a.cfg.fade, 30);
  const b = builder.startCfg('?channel=x&size=small', stored);
  assert.deepStrictEqual(b.cfg, Object.assign(config.defaults(), { channel: 'x', size: 'small' }));
  const c = builder.startCfg('', stored);
  assert.strictEqual(c.fromStore, true);
  assert.strictEqual(c.fromQuery, false);
  assert.strictEqual(c.cfg.fade, 30);
  // The overlay's hint links name the Twitch and Kick channels: that still keeps the remembered look.
  const k = builder.startCfg('?channel=a&kick=b&kick_room=1', stored);
  assert.deepStrictEqual([k.cfg.channel, k.cfg.kick, k.cfg.kick_room, k.cfg.size], ['a', 'b', '1', 'large']);
  // A remembered chatroom id is the remembered Kick channel's: a link naming another channel without an id (the
  // overlay's hint link) leaves it out, so the builder looks the new channel up. The same channel keeps it.
  const kstored = { kick: 'xqc', kick_room: '668', bg: 50 };
  const kick = (q) => { const s = builder.startCfg(q, kstored).cfg; return [s.kick, s.kick_room, s.bg]; };
  assert.deepStrictEqual(kick('?kick=someone_else'), ['someone_else', '', 50]);
  assert.deepStrictEqual(kick('?channel=a&kick=https://kick.com/Other'), ['other', '', 50]);
  assert.deepStrictEqual(kick('?channel=a&kick=XQC'), ['xqc', '668', 50]);
  assert.deepStrictEqual(kick('?channel=a'), ['xqc', '668', 50]);
  assert.deepStrictEqual(kick('?kick=b&kick_room=9'), ['b', '9', 50]);
  assert.deepStrictEqual(kick('?kick='), ['', '', 50]);
  // An id remembered without a channel stays, as one typed in before the channel does (onKickChanged).
  assert.strictEqual(builder.startCfg('?kick=b', { kick_room: '7' }).cfg.kick_room, '7');
  assert.deepStrictEqual(kstored, { kick: 'xqc', kick_room: '668', bg: 50 }, 'the remembered config is left as it is');
  assert.strictEqual(builder.startCfg('?utm=1', null).fromStore, false);
  assert.deepStrictEqual(builder.startCfg('?utm=1', ['x']).cfg, config.defaults());
});

// The builder read only location.search at start-up, which a '#' typed in a value cuts: ?text_color=#ff8800&bg=60 loaded
// neither, ?keywords=c#,gg&bots=1 loaded keywords=c alone, and ?channel=#xqc (a channel-only link) cleared the remembered
// channel. The overlay reads all of it (config.pageQuery); a section's hash still opens its section.
test('startSearch: the builder reads its start-up link as the overlay reads it; a section hash is left to open its section', () => {
  const loc = (href) => { const u = new URL(href); return { href: u.href, search: u.search, hash: u.hash, pathname: u.pathname }; };
  const B = 'https://chat.masstar.org/builder.html';
  const start = (href, stored) => builder.startCfg(builder.startSearch(loc(href)), stored || null);
  const url = (href, stored) => builder.overlayUrl(start(href, stored).cfg, B);
  assert.strictEqual(url(B + '?channel=abc&text_color=#ff8800&bg=60&layout=horizontal'),
    'https://chat.masstar.org/overlay.html?' + config.toParams(config.parse('?channel=abc&text_color=ff8800&bg=60&layout=horizontal')));
  assert.deepStrictEqual(start(B + '?keywords=c#,gg&bots=1').cfg, Object.assign(config.defaults(), { keywords: ['c#', 'gg'], bots: true }));
  // A channel-only link keeps the remembered look, and names the channel it says.
  const s = start(B + '?channel=#xqc', { channel: 'oldchan', size: 'large' });
  assert.deepStrictEqual([s.fromQuery, s.cfg.channel, s.cfg.size], [true, 'xqc', 'large']);
  // A section's or an Advanced heading's hash is the page's, not a value's.
  assert.strictEqual(builder.startSearch(loc(B + '?channel=abc#obs')), '?channel=abc');
  assert.strictEqual(builder.startSearch(loc(B + '?channel=abc#adv-text')), '?channel=abc');
  assert.strictEqual(builder.startSearch(loc(B + '?channel=abc&size=large#group-look')), '?channel=abc&size=large');
  // The home page passes an old link's #setup on: no section, and no value of size's either.
  assert.deepStrictEqual(start(B + '?channel=xqc&size=large#setup').cfg, Object.assign(config.defaults(), { channel: 'xqc', size: 'large' }));
  assert.strictEqual(builder.startSearch(loc(B + '#obs')), '');
  assert.strictEqual(builder.startSearch(loc(B)), '');
});

// Any hash that named a section was taken for the page's, though a section's name is a valid login and phrase too:
// ?channel=#emotes opened Emotes and, a channel-only link with an empty channel, wiped the remembered channel;
// ?keywords=#events opened Chat events and put every remembered setting back to its default. The overlay reads the
// channel emotes and the keyword #events.
test('linkSection: a section\'s name after the link is the page\'s, unless the overlay reads it as part of the last value', () => {
  const loc = (href) => { const u = new URL(href); return { href: u.href, search: u.search, hash: u.hash, pathname: u.pathname }; };
  const B = 'https://chat.masstar.org/builder.html';
  const overlayReads = (href) => config.parse(config.pageQuery(loc(href)));
  const start = (href, stored) => builder.startCfg(builder.startSearch(loc(href)), stored || null);
  // Part of the value, as on overlay.html: no section, and the builder reads what the overlay reads.
  const values = ['?channel=#emotes', '?keywords=#events', '?keywords=#look', '?keywords=c,#events', '?keywords=gg+#obs',
    '?block=nightbot,#obs', '?block=nightbot+#obs', '?channel=abc&keywords=#filters', '?kick=abc&channel=#badges',
    '?keywords=gg#filters'];
  values.forEach((h) => {
    assert.strictEqual(builder.linkSection(loc(B + h)), '', h);
    assert.deepStrictEqual(start(B + h).cfg, overlayReads(B + h), h);
  });
  assert.deepStrictEqual(overlayReads(B + '?keywords=c,#events').keywords, ['c', '#events']);
  assert.deepStrictEqual(overlayReads(B + '?block=nightbot+#obs').block, ['nightbot', 'obs']);
  // A channel-only link keeps the remembered look and names the channel it says; a whole setup is the link's.
  const s = start(B + '?channel=#emotes', { channel: 'remembered', size: 'large' });
  assert.deepStrictEqual([s.fromQuery, s.cfg.channel, s.cfg.size], [true, 'emotes', 'large']);
  const w = start(B + '?keywords=#events', { channel: 'remembered', size: 'large' });
  assert.deepStrictEqual(w.cfg, Object.assign(config.defaults(), { keywords: ['#events'] }));
  // The page's: a hash the overlay reads no differently (a value it can't be part of, a key no setting has, no link).
  const pages = { '?channel=x#obs': 'obs', '?channel=x&#obs': 'obs', '?channel=abc#adv-text': 'advanced',
    '?channel=abc&size=large#group-look': 'look', '?bots=1#badges': 'badges', '?utm=1#obs': 'obs', '?utm=#events': 'events',
    '?text_color=ff8800#look': 'look', '?block=nightbot#obs': 'obs', '?channel=#adv-text': 'advanced',
    '#obs': 'obs', '#adv-text': 'advanced', '#Emotes': 'emotes', '': '' };
  Object.keys(pages).forEach((h) => {
    assert.strictEqual(builder.linkSection(loc(B + h)), pages[h], h);
    assert.deepStrictEqual(start(B + h).cfg, overlayReads(B + h), h);
  });
  assert.strictEqual(builder.startSearch(loc(B + '?channel=x#obs')), '?channel=x');
  // A hash that is no section is the link's either way (?channel=xqc&size=large#setup), and none at all is no section.
  assert.strictEqual(builder.linkSection(loc(B + '?channel=xqc#setup')), '');
  assert.strictEqual(builder.linkSection(null), '');
  assert.strictEqual(builder.linkSection({ href: B, search: '', hash: '' }), '');
});

test('smallAvatar asks Twitch for the 70x70 rendition', () => {
  assert.strictEqual(builder.smallAvatar('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-600x600.png'),
    'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png');
  assert.strictEqual(builder.smallAvatar('https://static-cdn.jtvnw.net/x/y.jpeg'), 'https://static-cdn.jtvnw.net/x/y.jpeg');
});

test('events help mentions announcements', () => {
  assert.match(builder.META.events.label, /announcements/);
  assert.match(builder.META.events.help, /announce/);
});

test('layout: first in Look, and the align field reads differently for a horizontal row', () => {
  assert.strictEqual(builder.groupLayout()[0].keys[0], 'layout');
  assert.ok(builder.META.layout.help);
  const v = builder.fieldText('align', 'vertical');
  const hz = builder.fieldText('align', 'horizontal');
  assert.strictEqual(v.label, builder.META.align.label);
  assert.notStrictEqual(hz.label, v.label);
  assert.match(hz.help, /right/);
  // fields without a horizontal wording read the same in both layouts
  assert.deepStrictEqual(builder.fieldText('size', 'horizontal'), builder.fieldText('size', 'vertical'));
  assert.strictEqual(builder.fieldText('bg', 'horizontal').help, builder.META.bg.help);
});

test('layoutPreviewSize swaps a suggested preview size and keeps one the user typed', () => {
  const S = builder.LAYOUT_SIZES;
  assert.deepStrictEqual(S.vertical, { w: 450, h: 700 });
  assert.deepStrictEqual(builder.layoutPreviewSize({ w: 450, h: 700 }, 'vertical', 'horizontal'), S.horizontal);
  assert.deepStrictEqual(builder.layoutPreviewSize({ w: S.horizontal.w, h: S.horizontal.h }, 'horizontal', 'vertical'), S.vertical);
  assert.strictEqual(builder.layoutPreviewSize({ w: 600, h: 700 }, 'vertical', 'horizontal'), null, 'a size the user typed stays');
  assert.strictEqual(builder.layoutPreviewSize({ w: 450, h: 700 }, 'vertical', 'vertical'), null);
  assert.strictEqual(builder.layoutPreviewSize({ w: 450, h: 700 }, 'vertical', 'diagonal'), null);
  assert.strictEqual(builder.layoutPreviewSize(null, 'vertical', 'horizontal'), null);
});

test('the wide preview row is for a horizontal chat in a landscape source', () => {
  assert.strictEqual(builder.wantsWidePreview('horizontal', 1920, 100), true);
  assert.strictEqual(builder.wantsWidePreview('horizontal', 450, 800), false, 'a portrait source keeps the side column');
  assert.strictEqual(builder.wantsWidePreview('vertical', 1920, 100), false);
  // In the app layout the row takes its height from the settings, so only a bar (4:1 or wider) gets it.
  assert.strictEqual(builder.wantsWidePreview('horizontal', 1920, 100, true), true);
  assert.strictEqual(builder.wantsWidePreview('horizontal', 1920, 480, true), true);
  assert.strictEqual(builder.wantsWidePreview('horizontal', 1920, 1080, true), false);
  assert.strictEqual(builder.wantsWidePreview('horizontal', 1920, 1080, false), true, 'one column scrolls');
  assert.strictEqual(builder.wantsWidePreview('vertical', 1920, 100, true), false);
  // stage height follows the source's shape, within 150..180px (by window height) .. 45% of the window
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 100, 950), 178);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 100, 960), 180);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 100, 768), 150);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 300, 950), 265);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 1080, 950), 428);
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 1080, 200), 150, 'never under 150px');
  assert.strictEqual(builder.wideStageHeight(0, 30, 1920, 100, 950), 178);
  // room: what the window can spare once the settings below have their height
  assert.strictEqual(builder.wideStageHeight(1318, 64, 1920, 480, 768, 230), 230);
  assert.strictEqual(builder.wideStageHeight(1318, 112, 1920, 100, 650, 112), 181, 'the suggested bar is never shrunk');
  assert.strictEqual(builder.wideStageHeight(1318, 64, 1920, 480, 768, -50), 133, 'short of room: what the suggested bar needs');
  assert.strictEqual(builder.wideStageHeight(1052, 64, 1920, 100, 700, 138), 138, 'room wins over the 150px floor');
  assert.strictEqual(builder.wideStageHeight(1500, 30, 1920, 300, 950, 2000), 265, 'room to spare changes nothing');
  assert.strictEqual(builder.wideStageHeight(1232, 112, 1920, 100, 720, 158), 177, 'the bar keeps its size, its hint too');
});

test('fitScale scales down only', () => {
  assert.strictEqual(builder.fitScale(450, 700, 1000, 1000), 1);
  assert.strictEqual(builder.fitScale(450, 700, 450, 350), 0.5);
  assert.strictEqual(builder.fitScale(1000, 100, 500, 1000), 0.5);
  assert.strictEqual(builder.fitScale(450, 700, 0, 0), 1);
});

test('describeIvrUser handles the bare-array IVR shape', () => {
  const found = builder.describeIvrUser([{ id: '22484632', login: 'forsen', displayName: 'forsen', logo: 'https://static-cdn.jtvnw.net/x.png', banned: false }]);
  assert.strictEqual(found.state, 'found');
  assert.strictEqual(found.user.id, '22484632');
  assert.strictEqual(found.user.banned, false);
  assert.strictEqual(builder.describeIvrUser([]).state, 'notfound');
  assert.strictEqual(builder.describeIvrUser(null).state, 'notfound');
  assert.strictEqual(builder.describeIvrUser([{ id: 5 }]).user.id, '5');
  // Like the overlay's lookup: a numeric id only (else 'error', not a missing channel), and the entry
  // whose login matches.
  ['', ' ', 'abc', {}, null].forEach((id) =>
    assert.strictEqual(builder.describeIvrUser([{ id, login: 'x' }], 'x').state, 'error', JSON.stringify(id)));
  assert.strictEqual(builder.describeIvrUser([null]).state, 'error');
  // An answer only about another login is no answer, as in the overlay.
  assert.strictEqual(builder.describeIvrUser([{ id: '1', login: 'other' }], 'forsen').state, 'error');
  assert.strictEqual(builder.describeIvrUser([{ id: '1', login: 'other' }, { id: '2', login: 'Forsen' }], 'forsen').user.id, '2');
});

test('font suggestions are all valid font values', () => {
  builder.GOOGLE_FONTS.concat(builder.SYSTEM_FONT_NAMES).forEach((f) => {
    assert.strictEqual(config.coerce('font', f), f);
  });
  builder.SYSTEM_FONT_NAMES.forEach((f) => assert.ok(config.isSystemFont(f), f));
  builder.GOOGLE_FONTS.forEach((f) => assert.ok(!config.isSystemFont(f), f));
});

test('builder font lists are the config lists', () => {
  assert.strictEqual(builder.GOOGLE_FONTS, config.GOOGLE_FONTS);
  assert.strictEqual(builder.SYSTEM_FONT_NAMES, config.SYSTEM_FONT_NAMES);
});

// ---------- quick looks (stage 10) ----------

// A config with every setting but the channels off its default, so a quick look's reach shows.
function busyCfg() {
  let c = Object.assign(config.defaults(), { channel: 'forsen', kick: 'xqc', kick_room: '668' });
  config.KEYS.filter((k) => ['channel', 'kick', 'kick_room'].indexOf(k) < 0).forEach((k) => { c = flip(c, k); });
  return c;
}

test('quick looks: five, each value one its setting takes, only the 19 look settings, all live', () => {
  const P = builder.PRESET_KEYS;
  assert.deepStrictEqual(P, ['size', 'text_px', 'text_weight', 'name_weight', 'line_height', 'text_color', 'shadow', 'shadow_color',
    'outline', 'outline_color', 'bg', 'bg_color', 'bg_shape', 'bg_width', 'spacing', 'accent_bar', 'name_line', 'emote_scale',
    'badge_size']);
  P.forEach((k) => {
    assert.ok(config.SPEC[k], k + ' is a setting');
    assert.ok(builder.isLiveKey(k), k + ' is live: a quick look never reloads the preview');
  });
  // Font, name colors, layout, position and the channels are never part of a look.
  ['channel', 'kick', 'kick_room', 'font', 'name_font', 'name_color', 'name_fallback', 'layout', 'align', 'text_align', 'pad_x',
    'line_width', 'demo', 'debug'].forEach((k) => assert.ok(P.indexOf(k) < 0, k));
  assert.deepStrictEqual(builder.PRESETS.map((p) => [p.id, p.label]),
    [['default', 'Default'], ['boxed', 'Boxed'], ['outlined', 'Outlined'], ['cards', 'Cards'], ['big', 'Big & bold']]);
  const d = config.defaults();
  builder.PRESETS.forEach((p) => Object.keys(p.set).forEach((k) => {
    assert.ok(P.indexOf(k) >= 0, p.id + ': ' + k + ' is a look setting');
    assert.deepStrictEqual(config.coerce(k, p.set[k]), p.set[k], p.id + ': ' + k + ' coerces to itself');
    assert.notDeepStrictEqual(p.set[k], d[k], p.id + ': ' + k + ' differs from its default, or it would not be listed');
  }));
  assert.deepStrictEqual(builder.PRESETS.map((p) => p.set), [
    {},
    { bg: 70, shadow: 0 },
    { shadow: 0, outline: 2 },
    { bg: 80, shadow: 0, bg_shape: 'soft', bg_width: 'full', spacing: 'loose', accent_bar: true, name_line: true },
    { size: 'large', text_weight: 'bold', shadow: 3, emote_scale: 125 }
  ]);
  // No look asks Google Fonts for another weight (overlay.js fontWeights adds one for light or black only): Big &
  // bold's 700 is in the usual request.
  builder.PRESETS.forEach((p) => {
    const c = builder.presetCfg(d, p.id);
    assert.ok(['light', 'black'].indexOf(c.text_weight) < 0 && ['light', 'black'].indexOf(c.name_weight) < 0, p.id);
  });
});

test('presetCfg: every look setting to the look or its default, nothing else touched, whatever was picked before', () => {
  const busy = busyCfg(), d = config.defaults();
  builder.PRESETS.forEach((p) => {
    const out = builder.presetCfg(busy, p.id);
    config.KEYS.forEach((k) => {
      if (builder.PRESET_KEYS.indexOf(k) < 0) assert.deepStrictEqual(out[k], busy[k], p.id + ' leaves ' + k);
      else assert.deepStrictEqual(out[k], k in p.set ? p.set[k] : d[k], p.id + ' sets ' + k);
    });
    // A copy: the config given is left as it was.
    assert.notStrictEqual(out, busy);
    assert.notStrictEqual(out.block, busy.block);
    // Order independence: A then B is B.
    builder.PRESETS.forEach((q) => assert.deepStrictEqual(builder.presetCfg(builder.presetCfg(busy, q.id), p.id), out, q.id + ' then ' + p.id));
  });
  assert.deepStrictEqual(busy, busyCfg());
  // Default is the defaults on the look settings; on a default config it changes nothing at all.
  builder.PRESET_KEYS.forEach((k) => assert.deepStrictEqual(builder.presetCfg(busy, 'default')[k], d[k], k));
  assert.deepStrictEqual(builder.presetCfg(d, 'default'), d);
  // An unknown look is no look.
  assert.deepStrictEqual(builder.presetCfg(busy, 'nope'), busy);
  assert.deepStrictEqual(builder.presetCfg(busy, '__proto__'), busy);
});

test('presetOf: the look whose 19 settings a config has, whatever else it has; else none', () => {
  const busy = busyCfg();
  assert.strictEqual(builder.presetOf(config.defaults()), 'default');
  assert.strictEqual(builder.presetOf(busy), '');
  builder.PRESETS.forEach((p) => {
    const on = builder.presetCfg(busy, p.id);
    assert.strictEqual(builder.presetOf(on), p.id);
    // Any one look setting changed: no look (no two looks are one setting apart).
    builder.PRESET_KEYS.forEach((k) => assert.strictEqual(builder.presetOf(flip(on, k)), '', p.id + ' with ' + k + ' changed'));
  });
  // Settings outside the looks don't count: font, layout and the name color may be anything.
  assert.strictEqual(builder.presetOf(Object.assign(config.defaults(), { font: 'Roboto', layout: 'horizontal', name_color: 'ff8800' })), 'default');
});

test('quick looks in the URL: Default on a default config is today\'s URL; each look carries only what it changes', () => {
  const base = Object.assign(config.defaults(), { channel: 'forsen' });
  const hosted = 'https://chat.masstar.org/builder.html';
  assert.strictEqual(builder.overlayUrl(builder.presetCfg(base, 'default'), hosted), 'https://chat.masstar.org/overlay.html?channel=forsen');
  assert.strictEqual(builder.overlayUrl(builder.presetCfg(base, 'default'), BASE), builder.overlayUrl(base, BASE));
  assert.strictEqual(builder.settingsSnippet(builder.presetCfg(base, 'default')), builder.settingsSnippet(base));
  builder.PRESETS.forEach((p) => {
    const keys = builder.urlParts(builder.overlayUrl(builder.presetCfg(base, p.id), hosted)).params.map((x) => x.key);
    assert.deepStrictEqual(keys.slice(1).sort(), Object.keys(p.set).sort(), p.id);
  });
  assert.strictEqual(builder.overlayUrl(builder.presetCfg(base, 'cards'), hosted),
    'https://chat.masstar.org/overlay.html?channel=forsen&shadow=0&name_line=1&bg=80&accent_bar=1&bg_shape=soft&bg_width=full&spacing=loose');
  assert.strictEqual(builder.overlayUrl(builder.presetCfg(base, 'big'), hosted),
    'https://chat.masstar.org/overlay.html?channel=forsen&size=large&text_weight=bold&shadow=3&emote_scale=125');
});

test('pastedWords: a list pasted one per line (or in cells) into a words field becomes comma-separated phrases', () => {
  const pw = builder.pastedWords;
  // No line break or tab: the browser pastes it as it is.
  assert.strictEqual(pw('', 0, 0, 'good game'), null);
  assert.strictEqual(pw('', 0, 0, ''), null);
  assert.strictEqual(pw('', 0, 0, undefined), null);
  assert.deepStrictEqual(pw('', 0, 0, 'badword\nworse word\r\nthird\n'), { start: 0, end: 0, text: 'badword, worse word, third' });
  assert.deepStrictEqual(pw('', 0, 0, ' a ,\n\n, b\t c '), { start: 0, end: 0, text: 'a, b, c' });
  // Its edges: a comma where the phrases around the selection would run into it, and the spaces there go.
  assert.deepStrictEqual(pw('gg ', 3, 3, 'a\nb'), { start: 2, end: 3, text: ', a, b' });
  assert.deepStrictEqual(pw('gg, ', 4, 4, 'a\nb'), { start: 3, end: 4, text: ' a, b' });
  assert.deepStrictEqual(pw('草、', 2, 2, 'a\nb'), { start: 2, end: 2, text: ' a, b' }, 'an input method\'s comma is one');
  assert.deepStrictEqual(pw('x y', 0, 0, 'a\nb'), { start: 0, end: 0, text: 'a, b, ' });
  assert.deepStrictEqual(pw('x, y', 1, 1, 'a\nb'), { start: 1, end: 1, text: ', a, b' });
  // Over a selection; nothing but line breaks takes the selection away.
  assert.deepStrictEqual(pw('one two', 4, 7, 'three\nfour'), { start: 3, end: 7, text: ', three, four' });
  assert.deepStrictEqual(pw('one two', 0, 4, '\r\n'), { start: 0, end: 4, text: '' });
  // What it gives is read back as the lines were.
  const v = 'gg', r = pw(v, 2, 2, 'Bad Word\nworse');
  assert.deepStrictEqual(config.coerce('block_words', v.slice(0, r.start) + r.text + v.slice(r.end)), ['gg', 'bad word', 'worse']);
});
