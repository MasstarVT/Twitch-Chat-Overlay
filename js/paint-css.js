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

  function fmt(n) {
    var x = Number(n);
    if (!isFinite(x)) return '0';
    return String(Math.round(x * 1000) / 1000);
  }

  function hexColor(c) {
    var h = c && c.hex;
    return typeof h === 'string' && HEX_RE.test(h) ? h : null;
  }

  function stopsCss(stops, colorFn) {
    var out = [];
    if (!Array.isArray(stops)) return out;
    for (var i = 0; i < stops.length; i++) {
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

  function pickV4Image(images) {
    if (!Array.isArray(images)) return null;
    var webp = images.filter(function (im) { return im && im.mime === 'image/webp' && typeof im.url === 'string'; });
    if (!webp.length) webp = images.filter(function (im) { return im && typeof im.url === 'string'; });
    var animated = webp.filter(function (im) { return (im.frameCount || 1) > 1; });
    var pool = animated.length ? animated : webp;
    pool.sort(function (a, b) { return (a.scale || 1) - (b.scale || 1); });
    return pool.length ? pool[0].url : null;
  }

  function shadowsCss(shadows, pick) {
    if (!Array.isArray(shadows) || !shadows.length) return null;
    var parts = [];
    for (var i = 0; i < shadows.length; i++) {
      var s = pick(shadows[i]);
      if (!s || !s.color) continue;
      parts.push('drop-shadow(' + fmt(s.x) + 'px ' + fmt(s.y) + 'px ' + fmt(s.blur) + 'px ' + s.color + ')');
    }
    return parts.length ? parts.join(' ') : null;
  }

  // v4: {id, name, data:{layers:[{opacity, ty:{__typename, ...}}], shadows:[{color:{hex}, offsetX, offsetY, blur}]}}
  function fromV4(p) {
    if (!p || !ID_RE.test(p.id || '')) return null;
    var data = p.data || {};
    var images = [];
    var bgColor = null;
    var layers = Array.isArray(data.layers) ? data.layers : [];
    for (var i = 0; i < layers.length; i++) {
      var ty = layers[i] && layers[i].ty;
      if (!ty) continue;
      switch (ty.__typename) {
        case 'PaintLayerTypeSingleColor':
          bgColor = bgColor || hexColor(ty.color);
          break;
        case 'PaintLayerTypeLinearGradient': {
          var g = gradient('linear', ty.repeating, fmt(ty.angle) + 'deg', stopsCss(ty.stops || [], hexColor));
          if (g) images.push(g);
          break;
        }
        case 'PaintLayerTypeRadialGradient': {
          var shape = String(ty.shape || 'ellipse').toLowerCase() === 'circle' ? 'circle' : 'ellipse';
          var r = gradient('radial', ty.repeating, shape, stopsCss(ty.stops || [], hexColor));
          if (r) images.push(r);
          break;
        }
        case 'PaintLayerTypeImage': {
          var u = cssUrl(pickV4Image(ty.images));
          if (u) images.push(u);
          break;
        }
      }
    }
    var filter = shadowsCss(data.shadows, function (s) {
      return s ? { x: s.offsetX, y: s.offsetY, blur: s.blur, color: hexColor(s.color) } : null;
    });
    return { id: p.id, name: p.name || '', bgImage: images.length ? images.join(', ') : null, bgColor: bgColor, filter: filter };
  }

  // v3: {id, name, function, color, angle, shape, image_url, repeat, stops:[{at, color:int}], shadows:[{x_offset, y_offset, radius, color:int}]}
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

  // Longhands only: the `background` shorthand would reset background-clip.
  function ruleFor(paint) {
    if (!paint || !ID_RE.test(paint.id || '')) return null;
    var decl = [];
    if (paint.bgImage) decl.push('background-image:' + paint.bgImage);
    if (paint.bgColor) decl.push('background-color:' + paint.bgColor);
    if (paint.filter) decl.push('filter:' + paint.filter);
    if (!decl.length) return null;
    return '.painted.' + className(paint.id) + '{' + decl.join(';') + '}';
  }

  // Base painted-name style (also present in overlay.css; exported for tests/documentation).
  var BASE_RULE = '.painted{-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
    'background-color:currentColor;-webkit-text-stroke:0;text-shadow:none;background-size:100% 100%;background-repeat:no-repeat}';

  return {
    fromV4: fromV4,
    fromV3: fromV3,
    ruleFor: ruleFor,
    className: className,
    BASE_RULE: BASE_RULE,
    ID_RE: ID_RE
  };
});
