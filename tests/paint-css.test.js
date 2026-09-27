'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const util = require('../js/util.js');
const pc = require('../js/paint-css.js');

const ID = '01GHA42XER0001KT343YQ6DM2E';
const IMG = 'https://cdn.7tv.app/paint/01FQB6K5T0000BDD0YMN21KEXX/layer/01JAMR1DWJ14HBYADTC6Q634WR/';
const hex = (h) => ({ hex: h });
const SHADOW_V4 = { color: hex('#000000FF'), offsetX: 0, offsetY: 0, blur: 0.5 };

// No `background:` shorthand anywhere (it would reset background-clip).
const SHORTHAND_RE = /(^|[;{\s])background\s*:/;
function assertLonghandsOnly(rule) {
  assert.ok(!SHORTHAND_RE.test(rule), 'uses the background shorthand: ' + rule);
}
function v4(layers, shadows, extra) {
  return Object.assign({ id: ID, name: 'Test', data: { layers: layers, shadows: shadows || [] } }, extra);
}
const layer = (ty) => ({ id: 'L1', opacity: 1, ty: ty });

test('intToRgba(-1857617921) is #9146FF opaque', () => {
  assert.equal(util.intToRgba(-1857617921), 'rgba(145,70,255,1)');
});

// The base painted-name style lives in css/overlay.css (the injected .painted.p-<id> rules only add
// background-image/-color and filter). Chromium 103 (OBS 28-30) only honours the -webkit- clip.
test('overlay.css .painted pairs -webkit-background-clip with background-clip and uses no shorthand', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'overlay.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /(^|\})\s*\.painted\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'overlay.css has a .painted block');
  const r = '{' + m[2].split(';').map((d) => d.trim().replace(/\s*:\s*/, ':').replace(/\s+/g, ' ')).filter(Boolean).join(';') + '}';
  assert.ok(r.includes('-webkit-background-clip:text'), r);
  assert.ok(/[;{]background-clip:text/.test(r), r);
  assert.ok(r.includes('-webkit-text-fill-color:transparent'), r);
  assert.ok(r.includes('background-color:currentColor'), r);
  assert.ok(r.includes('background-size:100% 100%'), r);
  assertLonghandsOnly(r);
});

describe('fromV4', () => {
  test('linear gradient (repeating) with shadows', () => {
    const p = pc.fromV4(v4([layer({
      __typename: 'PaintLayerTypeLinearGradient', angle: 66, repeating: true,
      stops: [{ at: 0.57, color: hex('#CA804EFF') }, { at: 0.65, color: hex('#503611FF') }, { at: 1, color: hex('#C89041FF') }]
    })], [SHADOW_V4]));
    assert.deepEqual(p, {
      id: ID, name: 'Test',
      bgImage: 'repeating-linear-gradient(66deg, #CA804EFF 57%, #503611FF 65%, #C89041FF 100%)',
      bgColor: null,
      filter: 'drop-shadow(0px 0px 0.5px #000000FF)'
    });
    const rule = pc.ruleFor(p);
    assert.equal(rule, '.painted.p-' + ID + '{background-image:repeating-linear-gradient(66deg, #CA804EFF 57%, #503611FF 65%, #C89041FF 100%);filter:drop-shadow(0px 0px 0.5px #000000FF)}');
    assertLonghandsOnly(rule);
  });

  test('non-repeating linear gradient; a single stop is doubled (one-stop gradients are invalid CSS)', () => {
    const p = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeLinearGradient', angle: 90, repeating: false, stops: [{ at: 0.5, color: hex('#FF0000FF') }] })]));
    assert.equal(p.bgImage, 'linear-gradient(90deg, #FF0000FF 50%, #FF0000FF 50%)');
    assert.equal(p.filter, null);
  });

  test('radial gradient: CIRCLE and ELLIPSE shapes', () => {
    const stops = [{ at: 0, color: hex('#FFEF8AFF') }, { at: 0.25, color: hex('#EAFF47FF') }, { at: 1, color: hex('#1AC6FFFF') }];
    const c = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeRadialGradient', repeating: false, shape: 'CIRCLE', stops })]));
    assert.equal(c.bgImage, 'radial-gradient(circle, #FFEF8AFF 0%, #EAFF47FF 25%, #1AC6FFFF 100%)');
    const e = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeRadialGradient', repeating: true, shape: 'ELLIPSE', stops })]));
    assert.ok(e.bgImage.startsWith('repeating-radial-gradient(ellipse, '));
    assertLonghandsOnly(pc.ruleFor(e));
  });

  test('image layer: scale-1 webp, animated preferred', () => {
    const images = [
      { url: IMG + '1x_static.webp', mime: 'image/webp', scale: 1, frameCount: 1 },
      { url: IMG + '2x_static.webp', mime: 'image/webp', scale: 2, frameCount: 1 },
      { url: IMG + '2x.webp', mime: 'image/webp', scale: 2, frameCount: 100 },
      { url: IMG + '1x.webp', mime: 'image/webp', scale: 1, frameCount: 100 },
      { url: IMG + '1x.avif', mime: 'image/avif', scale: 1, frameCount: 100 },
      { url: IMG + '1x.gif', mime: 'image/gif', scale: 1, frameCount: 100 }
    ];
    const p = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeImage', images })]));
    assert.equal(p.bgImage, 'url("' + IMG + '1x.webp")');
    const rule = pc.ruleFor(p);
    assert.equal(rule, '.painted.p-' + ID + '{background-image:url("' + IMG + '1x.webp")}');
    assertLonghandsOnly(rule);
    const stat = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeImage', images: images.slice(0, 2) })]));
    assert.equal(stat.bgImage, 'url("' + IMG + '1x_static.webp")');
  });

  test('image URLs outside cdn.7tv.app, non-https, protocol-relative or with quotes are rejected', () => {
    const bad = [
      'https://evil.example/paint.webp',
      'https://cdn.7tv.app.evil.net/p.webp',
      'http://cdn.7tv.app/paint/x/1x.webp',
      '//cdn.7tv.app/paint/x/1x.webp',
      'https://cdn.7tv.app/paint/x")};body{color:red;}/*.webp',
      "https://cdn.7tv.app/paint/x'.webp",
      'https://cdn.7tv.app/paint/x\\.webp'
    ];
    bad.forEach((url) => {
      const p = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeImage', images: [{ url, mime: 'image/webp', scale: 1, frameCount: 1 }] })], [SHADOW_V4]));
      assert.equal(p.bgImage, null, url);
      const rule = pc.ruleFor(p);
      assert.ok(!rule.includes('url('), url);
      assert.ok(rule.includes('filter:drop-shadow('), 'shadows survive: ' + url);
    });
    const v3 = pc.fromV3({ id: ID, function: 'URL', image_url: 'https://evil.example/x.webp', stops: [], shadows: [] });
    assert.equal(v3.bgImage, null);
    assert.equal(pc.ruleFor(v3), null);
  });

  test('single-color layer becomes background-color', () => {
    const p = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeSingleColor', color: hex('#9146FFFF') })]));
    assert.equal(p.bgImage, null);
    assert.equal(p.bgColor, '#9146FFFF');
    const rule = pc.ruleFor(p);
    assert.equal(rule, '.painted.p-' + ID + '{background-color:#9146FFFF}');
    assertLonghandsOnly(rule);
  });

  test('layers stack like 7TV (layer 0 at the bottom) and layer opacity is folded into colors', () => {
    const grad = { __typename: 'PaintLayerTypeLinearGradient', angle: 90, stops: [{ at: 0, color: hex('#FF0000FF') }, { at: 1, color: hex('#0000FF') }] };
    const img = { __typename: 'PaintLayerTypeImage', images: [{ url: IMG + '1x.webp', mime: 'image/webp', scale: 1, frameCount: 1 }] };
    const p = pc.fromV4(v4([
      { opacity: 1, ty: grad },
      { opacity: 0.6, ty: img },
      { opacity: 0.5, ty: { __typename: 'PaintLayerTypeSingleColor', color: hex('#FFFFFFFF') } },
      { opacity: 0, ty: { __typename: 'PaintLayerTypeSingleColor', color: hex('#000000FF') } }
    ]));
    assert.equal(p.bgImage, 'linear-gradient(#FFFFFF80, #FFFFFF80), url("' + IMG + '1x.webp"), linear-gradient(90deg, #FF0000FF 0%, #0000FF 100%)');
    assert.equal(p.bgColor, null);
    const faded = pc.fromV4(v4([{ opacity: 0.5, ty: grad }]));
    assert.equal(faded.bgImage, 'linear-gradient(90deg, #FF000080 0%, #0000FF80 100%)');
    // A single-color bottom layer stays the background color; a missing opacity means opaque.
    const bottom = pc.fromV4(v4([{ ty: { __typename: 'PaintLayerTypeSingleColor', color: hex('#9146FF') } }, { opacity: 1, ty: grad }]));
    assert.equal(bottom.bgColor, '#9146FF');
    assert.equal(bottom.bgImage, 'linear-gradient(90deg, #FF0000FF 0%, #0000FF 100%)');
  });

  test('chained shadows share one reach budget (drop-shadows add up), up to MAX_SHADOWS of them', () => {
    const big = Array.from({ length: 12 }, () => ({ color: hex('#FF00FFFF'), offsetX: 20, offsetY: -20, blur: 20 }));
    const p = pc.fromV4(v4([], big));
    const parts = p.filter.match(/drop-shadow\([^)]*\)/g);
    assert.equal(parts.length, 2, 'shadows trimmed to nothing are not emitted: ' + p.filter);
    let sx = 0, sy = 0, sb = 0;
    parts.forEach((d) => {
      const n = d.match(/-?[\d.]+(?=px)/g).map(Number);
      sx += Math.abs(n[0]); sy += Math.abs(n[1]); sb += n[2];
    });
    assert.ok(sx <= pc.MAX_SHADOW_PX && sy <= pc.MAX_SHADOW_PX && sb <= pc.MAX_SHADOW_PX, p.filter);
    assert.equal(parts[0], 'drop-shadow(20px -20px 20px #FF00FFFF)');
    assert.equal(parts[1], 'drop-shadow(12px -12px 12px #FF00FFFF)');
  });

  test('a trimmed shadow keeps its direction (offset scaled as a whole, not per axis)', () => {
    // WTFIsGoingOn: the second copy has 2px of the y budget left; it must still point down-right, not right.
    const p = pc.fromV4(v4([], [
      { color: hex('#FF0000FF'), offsetX: 4, offsetY: 30, blur: 0 },
      { color: hex('#FF0000FF'), offsetX: 8, offsetY: 32, blur: 0 }
    ]));
    assert.equal(p.filter, 'drop-shadow(4px 30px 0px #FF0000FF) drop-shadow(0.5px 2px 0px #FF0000FF)');
    // Huge offsets: scaled down along their own line; blur is clamped on its own.
    const h = pc.fromV4(v4([], [{ color: hex('#FF0000FF'), offsetX: 5000, offsetY: -250, blur: 999 }]));
    assert.equal(h.filter, 'drop-shadow(32px -1.6px 32px #FF0000FF)');
    // Once every budget is used up nothing more is emitted; a real 0/0/0 shadow is kept as given.
    const z = pc.fromV4(v4([], [{ color: hex('#000000FF'), offsetX: 0, offsetY: 0, blur: 0 }]));
    assert.equal(z.filter, 'drop-shadow(0px 0px 0px #000000FF)');
  });

  test('a real 10-shadow paint keeps its last two (colored) shadows', () => {
    // "Hot Pursuit yx": 8 sub-pixel outlines, then a blue and a red glow.
    const outlines = Array.from({ length: 8 }, (_, i) => ({ color: hex(i % 2 ? '#1E1E1EFF' : '#A0A0A0FF'), offsetX: i % 2 ? 0 : -0.2, offsetY: i % 2 ? -0.1 : 0, blur: 0 }));
    const p = pc.fromV4(v4([], outlines.concat([
      { color: hex('#194BEBFF'), offsetX: 1.6, offsetY: 1, blur: 1.6 },
      { color: hex('#E61414FF'), offsetX: -1.6, offsetY: -0.8, blur: 1.6 }
    ])));
    assert.equal((p.filter.match(/drop-shadow/g) || []).length, 10);
    assert.ok(p.filter.endsWith('drop-shadow(1.6px 1px 1.6px #194BEBFF) drop-shadow(-1.6px -0.8px 1.6px #E61414FF)'), p.filter);
  });

  test('shadow-only paint (zero layers) keeps its filter chain', () => {
    const p = pc.fromV4(v4([], [SHADOW_V4, { color: hex('#FF00BBFF'), offsetX: 1, offsetY: -2, blur: 4 }]));
    assert.equal(p.bgImage, null);
    assert.equal(p.filter, 'drop-shadow(0px 0px 0.5px #000000FF) drop-shadow(1px -2px 4px #FF00BBFF)');
    assert.equal(pc.ruleFor(p), '.painted.p-' + ID + '{filter:drop-shadow(0px 0px 0.5px #000000FF) drop-shadow(1px -2px 4px #FF00BBFF)}');
  });

  test('empty-stop gradient is skipped but shadows are kept', () => {
    const p = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeLinearGradient', angle: 0, repeating: false, stops: [] })], [SHADOW_V4]));
    assert.equal(p.bgImage, null);
    const rule = pc.ruleFor(p);
    assert.ok(!rule.includes('gradient'));
    assert.ok(rule.includes('filter:drop-shadow(0px 0px 0.5px #000000FF)'));
  });

  test('invalid colors are dropped from stops and shadows', () => {
    const p = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeLinearGradient', angle: 0, stops: [{ at: 0, color: hex('red;x') }, { at: 1, color: hex('#00FF00FF') }] })],
      [{ color: hex('url(x)'), offsetX: 0, offsetY: 0, blur: 1 }]));
    assert.equal(p.bgImage, 'linear-gradient(0deg, #00FF00FF 100%, #00FF00FF 100%)');
    assert.equal(p.filter, null);
  });

  test('empty paint gives no rule; bad ids are rejected', () => {
    assert.equal(pc.ruleFor(pc.fromV4(v4([], []))), null);
    assert.equal(pc.fromV4({ id: 'bad id', data: {} }), null);
    assert.equal(pc.fromV4({ id: 'x}{', data: {} }), null);
    assert.equal(pc.fromV4(null), null);
    assert.equal(pc.ruleFor({ id: '../x', bgImage: 'linear-gradient(red, blue)' }), null);
    assert.equal(pc.ruleFor(null), null);
  });
});

describe('fromV3', () => {
  test('LINEAR_GRADIENT decodes int colors', () => {
    const p = pc.fromV3({
      id: ID, name: 'City Lights', function: 'LINEAR_GRADIENT', color: null, angle: 45, repeat: false,
      stops: [{ at: 0, color: -1857617921 }, { at: 1, color: -1 }],
      shadows: [{ x_offset: 0, y_offset: 0, radius: 4, color: -16729089 }]
    });
    assert.deepEqual(p, {
      id: ID, name: 'City Lights',
      bgImage: 'linear-gradient(45deg, rgba(145,70,255,1) 0%, rgba(255,255,255,1) 100%)',
      bgColor: null,
      filter: 'drop-shadow(0px 0px 4px rgba(255,0,187,1))'
    });
    assertLonghandsOnly(pc.ruleFor(p));
  });

  test('RADIAL_GRADIENT with repeat and circle shape', () => {
    const p = pc.fromV3({ id: ID, function: 'RADIAL_GRADIENT', repeat: true, shape: 'circle',
      stops: [{ at: 0.17, color: -1 }, { at: 0.34, color: -4663297 }], shadows: [] });
    assert.equal(p.bgImage, 'repeating-radial-gradient(circle, rgba(255,255,255,1) 17%, rgba(255,184,215,1) 34%)');
    assert.equal(p.filter, null);
  });

  test('URL paint', () => {
    const p = pc.fromV3({ id: ID, function: 'URL', image_url: IMG + '1x.webp', stops: [], shadows: [{ x_offset: 1, y_offset: 1, radius: 0.1, color: -1 }] });
    assert.equal(p.bgImage, 'url("' + IMG + '1x.webp")');
    assert.equal(p.filter, 'drop-shadow(1px 1px 0.1px rgba(255,255,255,1))');
    const rule = pc.ruleFor(p);
    assertLonghandsOnly(rule);
    assert.ok(rule.startsWith('.painted.p-' + ID + '{background-image:url("'));
  });

  test('empty stops (shadow-only paints): no gradient, shadows kept', () => {
    const p = pc.fromV3({ id: ID, function: 'LINEAR_GRADIENT', color: null, angle: 0, stops: [],
      shadows: [{ x_offset: 0, y_offset: 0, radius: 1, color: -4656385 }] });
    assert.equal(p.bgImage, null);
    assert.equal(pc.ruleFor(p), '.painted.p-' + ID + '{filter:drop-shadow(0px 0px 1px rgba(255,184,242,1))}');
  });

  test('single color arrives as LINEAR_GRADIENT with empty stops plus color', () => {
    const p = pc.fromV3({ id: ID, function: 'LINEAR_GRADIENT', color: -1857617921, stops: [], shadows: [] });
    assert.equal(p.bgImage, null);
    assert.equal(p.bgColor, 'rgba(145,70,255,1)');
    assert.equal(pc.ruleFor(p), '.painted.p-' + ID + '{background-color:rgba(145,70,255,1)}');
  });

  test('bad ids are rejected', () => {
    assert.equal(pc.fromV3({ id: 'a b', function: 'URL' }), null);
    assert.equal(pc.fromV3(undefined), null);
  });
});

test('className', () => {
  assert.equal(pc.className(ID), 'p-' + ID);
});

test('null / non-object gradient stops are skipped instead of throwing', () => {
  const v4p = pc.fromV4(v4([layer({
    __typename: 'PaintLayerTypeLinearGradient', angle: 90, repeating: false,
    stops: [null, 'x', 7, { at: 0, color: hex('#FF0000FF') }, { at: 1, color: hex('#0000FFFF') }]
  })]));
  assert.equal(v4p.bgImage, 'linear-gradient(90deg, #FF0000FF 0%, #0000FFFF 100%)');
  const onlyNull = pc.fromV4(v4([layer({ __typename: 'PaintLayerTypeRadialGradient', shape: 'CIRCLE', stops: [null] })]));
  assert.equal(onlyNull.bgImage, null);
  const v3p = pc.fromV3({ id: ID, function: 'LINEAR_GRADIENT', angle: 0, stops: [null, { at: 1, color: -1 }], shadows: [] });
  assert.equal(v3p.bgImage, 'linear-gradient(0deg, rgba(255,255,255,1) 100%, rgba(255,255,255,1) 100%)');
  const odd = pc.fromV3({ id: ID, function: 'RADIAL_GRADIENT', stops: { length: 2 }, shadows: [] });
  assert.equal(odd.bgImage, null);
});
