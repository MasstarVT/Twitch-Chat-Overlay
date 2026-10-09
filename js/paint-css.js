/* 7TV name paints (v4 GQL "layers" format and v3 EventAPI format) -> CSS rules. Pure. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).paintCss = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  var ID_RE = /^[0-9A-Za-z]{1,40}$/;
  var HEX_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  var PAINT_HOST_RE = /^cdn\.7tv\.app$/;
  // Real paints use a few layers, stops and shadows of a few px (the most shadows in the live catalog is
  // 10). The limits keep a paint (the data comes from 7TV) from drawing far outside the name over other
  // lines, or stacking costly filters. Chained drop-shadows add up (each one shadows the result of the
  // previous one), so MAX_SHADOW_PX is a budget for the whole chain on each axis and for the blur.
  var MAX_LAYERS = 8, MAX_STOPS = 32, MAX_SHADOWS = 10, MAX_SHADOW_PX = 32;

  function clamp(n, lo, hi) {
    var x = Number(n);
    return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0;
  }

  function round3(x) { return Math.round(x * 1000) / 1000 || 0; } // || 0: no -0

  function fmt(n) {
    var x = clamp(n, -10000, 10000); // no exponent notation
    return String(Math.round(x * 1000) / 1000);
  }

  function hexColor(c) {
    var h = c && c.hex;
    return typeof h === 'string' && HEX_RE.test(h) ? h : null;
  }

  // #RRGGBB[AA] with its alpha multiplied by a (0 < a < 1): a v4 layer's opacity folded into its colors.
  function withAlpha(h, a) {
    if (!h || !(a < 1)) return h;
    var al = h.length === 9 ? parseInt(h.slice(7), 16) : 255;
    var x = Math.round(al * a).toString(16);
    return h.slice(0, 7) + (x.length < 2 ? '0' + x : x);
  }

  function stopsCss(stops, colorFn) {
    var out = [];
    if (!Array.isArray(stops)) return out;
    for (var i = 0; i < stops.length && out.length < MAX_STOPS; i++) {
      var s = stops[i];
      if (!s || typeof s !== 'object') continue; // malformed stop: skip it, keep the rest of the paint
      var col = colorFn(s.color);
      if (!col) continue;
      out.push(col + ' ' + fmt((Number(s.at) || 0) * 100) + '%');
    }
    return out;
  }

  function gradient(kind, repeating, head, stops) {
    if (stops.length === 0) return null; // "linear-gradient(0deg)" is invalid CSS
    if (stops.length === 1) stops = [stops[0], stops[0]];
    return (repeating ? 'repeating-' : '') + kind + '-gradient(' + head + ', ' + stops.join(', ') + ')';
  }

  function cssUrl(u) {
    return util.isSafeUrl(u, PAINT_HOST_RE) ? 'url("' + u + '")' : null;
  }

  // The webps of a v4 image layer, smallest scale first: the animated ones when there are any, or with still the
  // single-frame ones (paint_images=static; 7TV gives every animated layer a <n>x_static.webp too).
  function v4Files(images, still) {
    if (!Array.isArray(images)) return [];
    var webp = images.filter(function (im) { return im && im.mime === 'image/webp' && typeof im.url === 'string'; });
    if (!webp.length) webp = images.filter(function (im) { return im && typeof im.url === 'string'; });
    var want = webp.filter(function (im) { return still ? (im.frameCount || 1) <= 1 : (im.frameCount || 1) > 1; });
    var pool = want.length ? want : webp;
    pool.sort(function (a, b) { return (a.scale || 1) - (b.scale || 1); });
    return pool;
  }

  // The scale (2 to 4) a caller wants a paint's images at, or 0 for the files as stored (scale 1, none, or junk).
  function wantScale(scale) {
    var s = Math.floor(Number(scale));
    return s >= 2 ? Math.min(4, s) : 0;
  }

  // A layer's file for a name drawn s times as tall as a 1x file (7TV's are 32 px tall): the smallest at least that big,
  // else the largest (as renderer.js picks emotes). Without s, the smallest, as always.
  function pickAt(pool, s) {
    if (!pool.length) return null;
    if (s) for (var i = 0; i < pool.length; i++) if ((pool[i].scale || 1) >= s) return pool[i].url;
    return pool[s ? pool.length - 1 : 0].url;
  }

  function shadowsCss(shadows, pick) {
    if (!Array.isArray(shadows) || !shadows.length) return null;
    var parts = [];
    var bx = MAX_SHADOW_PX, by = MAX_SHADOW_PX, bb = MAX_SHADOW_PX; // what is left of the chain's budget
    for (var i = 0; i < shadows.length && parts.length < MAX_SHADOWS && (bx > 0 || by > 0 || bb > 0); i++) {
      var s = pick(shadows[i]);
      if (!s || !s.color) continue;
      var x = clamp(s.x, -10000, 10000), y = clamp(s.y, -10000, 10000), b = clamp(s.blur, 0, 10000);
      // Scale the offset as a whole so a trimmed shadow keeps its direction and only reaches less far;
      // the blur has no direction and is clamped on its own.
      var f = 1, ax = Math.abs(x), ay = Math.abs(y);
      if (ax > bx) f = bx / ax;
      if (ay > by) f = Math.min(f, by / ay);
      x = round3(x * f); y = round3(y * f); b = round3(Math.min(b, bb));
      // Trimmed down to nothing (its axis budget is used up): it would draw nothing, skip the filter pass.
      if (x === 0 && y === 0 && b === 0 && (ax || ay || s.blur > 0)) continue;
      bx = Math.max(0, round3(bx - Math.abs(x))); by = Math.max(0, round3(by - Math.abs(y))); bb = Math.max(0, round3(bb - b));
      parts.push('drop-shadow(' + fmt(x) + 'px ' + fmt(y) + 'px ' + fmt(b) + 'px ' + s.color + ')');
    }
    return parts.length ? parts.join(' ') : null;
  }

  // v4: {id, name, data:{layers:[{opacity, ty:{__typename, ...}}], shadows:[{color:{hex}, offsetX, offsetY, blur}]}}
  // 7TV draws layer 0 at the bottom; CSS draws the first background-image on top, so walk the layers
  // top-down. A layer's opacity is folded into its colors (CSS cannot fade one background image).
  // bgImageStatic: the same layers with each image's still frame, only for a paint with an animated image.
  // bgImageAt / bgImageStaticAt (a paint with an image): the same at scales 2 to 4, for a name drawn bigger (ruleFor).
  function fromV4(p) {
    if (!p || !ID_RE.test(p.id || '')) return null;
    var data = p.data || {};
    var images = [], stills = [], files = [];
    var add = function (css, still, f) { images.push(css); stills.push(still || css); files.push(f || null); };
    var bgColor = null;
    var layers = Array.isArray(data.layers) ? data.layers.slice(0, MAX_LAYERS) : [];
    for (var i = layers.length - 1; i >= 0; i--) {
      var ty = layers[i] && layers[i].ty;
      if (!ty) continue;
      var op = layers[i].opacity;
      var a = op === undefined || op === null ? 1 : Number(op);
      if (!isFinite(a)) a = 1;
      if (a <= 0) continue; // invisible layer
      var colorFn = a < 1 ? function (c) { return withAlpha(hexColor(c), a); } : hexColor;
      switch (ty.__typename) {
        case 'PaintLayerTypeSingleColor': {
          var c = colorFn(ty.color);
          if (!c) break;
          // The bottom layer is the background color; a color over other layers must keep its place.
          if (i === 0) bgColor = c;
          else add('linear-gradient(' + c + ', ' + c + ')');
          break;
        }
        case 'PaintLayerTypeLinearGradient': {
          var g = gradient('linear', ty.repeating, fmt(ty.angle) + 'deg', stopsCss(ty.stops || [], colorFn));
          if (g) add(g);
          break;
        }
        case 'PaintLayerTypeRadialGradient': {
          var shape = String(ty.shape || 'ellipse').toLowerCase() === 'circle' ? 'circle' : 'ellipse';
          var r = gradient('radial', ty.repeating, shape, stopsCss(ty.stops || [], colorFn));
          if (r) add(r);
          break;
        }
        case 'PaintLayerTypeImage': {
          var anim = v4Files(ty.images), still = v4Files(ty.images, true);
          var u = cssUrl(pickAt(anim, 0));
          if (u) add(u, cssUrl(pickAt(still, 0)), { anim: anim, still: still });
          break;
        }
      }
    }
    var filter = shadowsCss(data.shadows, function (s) {
      return s ? { x: s.offsetX, y: s.offsetY, blur: s.blur, color: hexColor(s.color) } : null;
    });
    var out = { id: p.id, name: p.name || '', bgImage: images.length ? images.join(', ') : null, bgColor: bgColor, filter: filter };
    if (out.bgImage && stills.join(', ') !== out.bgImage) out.bgImageStatic = stills.join(', ');
    // Each image layer's file at scales 2 to 4 (a bigger file off cdn.7tv.app leaves the layer's own). A still frame takes
    // its own bigger file; a layer whose still is its animated file (none, or one off the CDN) takes the animated one's.
    if (files.some(Boolean)) {
      out.bgImageAt = {};
      if (out.bgImageStatic) out.bgImageStaticAt = {};
      for (var s = 2; s <= 4; s++) {
        var at = [], stAt = [];
        for (var k = 0; k < images.length; k++) {
          var f = files[k];
          var big = f ? cssUrl(pickAt(f.anim, s)) || images[k] : images[k];
          at.push(big);
          stAt.push(f && stills[k] !== images[k] ? cssUrl(pickAt(f.still, s)) || stills[k] : f ? big : stills[k]);
        }
        out.bgImageAt[s] = at.join(', ');
        if (out.bgImageStaticAt) out.bgImageStaticAt[s] = stAt.join(', ');
      }
    }
    return out;
  }

  // v3: {id, name, function, color, angle, shape, image_url, repeat, stops:[{at, color:int}], shadows:[{x_offset, y_offset, radius, color:int}]}
  // An image paint names one file and doesn't say whether it is animated, so it has no bgImageStatic: v3StillUrl names
  // the file its still frame would be, which overlay.js asks for before setStill takes it.
  function fromV3(p) {
    if (!p || !ID_RE.test(p.id || '')) return null;
    var image = null;
    var fn = String(p.function || '').toUpperCase();
    if (fn === 'URL') {
      image = cssUrl(p.image_url);
    } else if (fn === 'RADIAL_GRADIENT') {
      var shape = String(p.shape || 'ellipse').toLowerCase() === 'circle' ? 'circle' : 'ellipse';
      image = gradient('radial', p.repeat, shape, stopsCss(p.stops || [], util.intToRgba));
    } else {
      image = gradient('linear', p.repeat, fmt(p.angle || 0) + 'deg', stopsCss(p.stops || [], util.intToRgba));
    }
    var bgColor = typeof p.color === 'number' ? util.intToRgba(p.color) : null;
    var filter = shadowsCss(p.shadows, function (s) {
      return s ? { x: s.x_offset, y: s.y_offset, blur: s.radius, color: util.intToRgba(s.color) } : null;
    });
    return { id: p.id, name: p.name || '', bgImage: image, bgColor: bgColor, filter: filter };
  }

  function className(id) { return 'p-' + id; }

  // A paint's images (still: its still frames) for a name drawn `scale` times as tall as a 1x paint file, 2 to 4 (the
  // renderer's paintScale; 1, none or junk: as stored). A v4 paint has each layer's file at that scale (bgImageAt). A v3
  // image paint names one file, its 1x: 7TV's CDN keeps the 2x to 4x of a paint image (and of its still frame) beside it,
  // and never one smaller than the file named is taken.
  var V3_SCALE_RE = /^(url\("https:\/\/cdn\.7tv\.app\/paint\/[0-9A-Za-z]{1,40}(?:\/layer\/[0-9A-Za-z]{1,40})?\/)([1-4])(x(?:_static)?\.webp"\))$/;
  function imagesAt(paint, scale, still) {
    var css = still ? paint.bgImageStatic : paint.bgImage;
    var s = wantScale(scale);
    if (!s || !css) return css;
    if (paint.bgImageAt) {
      var at = still ? paint.bgImageStaticAt : paint.bgImageAt;
      return at && typeof at[s] === 'string' && at[s] ? at[s] : css;
    }
    var m = V3_SCALE_RE.exec(css);
    return m && Number(m[2]) < s ? m[1] + s + m[3] : css;
  }

  // Longhands only: the `background` shorthand would reset background-clip. scale: see imagesAt.
  function ruleFor(paint, scale) {
    if (!paint || !ID_RE.test(paint.id || '')) return null;
    var decl = [];
    if (paint.bgImage) decl.push('background-image:' + imagesAt(paint, scale, false));
    if (paint.bgColor) decl.push('background-color:' + paint.bgColor);
    if (paint.filter) decl.push('filter:' + paint.filter);
    if (!decl.length) return null;
    return '.painted.' + className(paint.id) + '{' + decl.join(';') + '}';
  }

  // paint_images=static: the paint's still images, for #chat.paint-static only (one class more than ruleFor's
  // selector, and no #chat in it, so OBS Custom CSS written as `#chat .name { ... }` still wins). null for a paint
  // without an animated image, and for one in the older v3 format until setStill gave it its still frame.
  function staticRuleFor(paint, scale) {
    if (!paint || !ID_RE.test(paint.id || '') || !paint.bgImageStatic) return null;
    return '.paint-static .painted.' + className(paint.id) + '{background-image:' + imagesAt(paint, scale, true) + '}';
  }

  // A v3 image paint (one file on 7TV's CDN, cdn.7tv.app/paint/<id>[/layer/<id>]/<n>x.webp): where its still frame would
  // be, the <n>x_static.webp beside it. The CDN keeps one only beside an animated file, so it is a guess until it loads
  // (a still paint has none, and is left as it is). null for anything else: a gradient, a v4 paint, another file.
  var V3_IMAGE_RE = /^url\("(https:\/\/cdn\.7tv\.app\/paint\/[0-9A-Za-z]{1,40}(?:\/layer\/[0-9A-Za-z]{1,40})?\/[1-4]x)\.webp"\)$/;
  function v3StillUrl(paint) {
    if (!paint || paint.bgImageStatic || typeof paint.bgImage !== 'string') return null;
    var m = V3_IMAGE_RE.exec(paint.bgImage);
    return m ? m[1] + '_static.webp' : null;
  }
  // The still frame v3StillUrl named, once it loaded: the paint now has one (staticRuleFor). False for any other URL.
  function setStill(paint, url) {
    if (!paint || typeof url !== 'string' || url !== v3StillUrl(paint)) return false;
    var u = cssUrl(url);
    if (!u) return false;
    paint.bgImageStatic = u;
    return true;
  }

  return {
    MAX_LAYERS: MAX_LAYERS,
    MAX_STOPS: MAX_STOPS,
    MAX_SHADOWS: MAX_SHADOWS,
    MAX_SHADOW_PX: MAX_SHADOW_PX,
    fromV4: fromV4,
    fromV3: fromV3,
    ruleFor: ruleFor,
    staticRuleFor: staticRuleFor,
    v3StillUrl: v3StillUrl,
    setStill: setStill,
    className: className,
    ID_RE: ID_RE
  };
});
