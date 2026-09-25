/* DOM rendering: pending queue, line lifecycle (fade, trim, moderation), indexes, paint stylesheet, re-render. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).renderer = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util) {
  'use strict';

  // ---------- constants ----------
  var FONT_PX = { small: 18, medium: 24, large: 32 };
  var EMOTE_EM = 1.75;        // emote height in em (--emote-h)
  var EMOTE_BASE_PX = 28;     // height of a 1x emote / cheermote
  var BADGE_BASE_PX = 18;     // size of a 1x badge
  var SHADOWS = [
    'none',
    'drop-shadow(1px 1px 1px rgba(0,0,0,.8))',
    'drop-shadow(0 0 1px rgba(0,0,0,.9)) drop-shadow(1px 2px 2px rgba(0,0,0,.75))',
    'drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000) drop-shadow(2px 3px 4px rgba(0,0,0,.9))'
  ];
  var DEFAULT_SHADOW = 2;
  var IN_MS = 180;            // tco-in (animate=1)
  var FADE_OUT_MS = 1000;     // tco-fade length; the line is gone exactly `fade` seconds after it arrived
  var FLUSH_FALLBACK_MS = 250;
  var SWEEP_MS = 1000;        // fade safety sweep, in case animationend never fires
  var DELETED_TTL_MS = 600000;
  var DELETED_CAP = 5000;
  var PAINT_ID_RE = /^[0-9A-Za-z]{1,40}$/;
  var HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
  var ANN_COLORS = ['PRIMARY', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE'];
  var GENERIC_FONTS = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
    'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];
  var RERENDER_KEYS = ['size', 'badges', 'badges_twitch', 'badges_7tv', 'badges_bttv', 'badges_ffz', 'badges_ffzap',
    'badges_chatterino', 'badges_homies', 'paints', 'readable', 'replies', 'gifs', 'first_msg', 'shared'];
  var FILTER_KEYS = ['bots', 'hide_commands', 'block', 'events', 'shared'];

  // ---------- pure helpers (exported as _internal for tests) ----------
  function clampInt(v, min, max, def) {
    var n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? parseFloat(v) : NaN;
    if (!isFinite(n)) return def;
    n = Math.round(n);
    return n < min ? min : n > max ? max : n;
  }

  // Snapshot of the config with the values the renderer relies on made safe.
  function normalizeCfg(c) {
    var o = {};
    if (c && typeof c === 'object') {
      for (var k in c) {
        if (Object.prototype.hasOwnProperty.call(c, k)) o[k] = Array.isArray(c[k]) ? c[k].slice() : c[k];
      }
    }
    o.size = FONT_PX[o.size] ? o.size : 'medium';
    o.align = o.align === 'top' ? 'top' : 'bottom';
    o.shadow = clampInt(o.shadow, 0, 3, DEFAULT_SHADOW);
    o.bg = clampInt(o.bg, 0, 100, 0);
    o.fade = clampInt(o.fade, 0, 3600, 0);
    o.max = clampInt(o.max, 1, 200, 50);
    o.animate = o.animate === undefined ? true : !!o.animate;
    o.font = typeof o.font === 'string' ? o.font : 'Inter';
    return o;
  }

  function sameValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.join(',') === b.join(',');
    }
    return a === b;
  }
  function changedAny(a, b, keys) {
    for (var i = 0; i < keys.length; i++) if (!sameValue(a[keys[i]], b[keys[i]])) return true;
    return false;
  }

  function fontPx(size) { return FONT_PX[size] || FONT_PX.medium; }
  function ceilSafe(x) { return Math.ceil(x - 1e-9); }
  // Images are requested at 2x their rendered size (OBS renders at DPR 1 and sources are often scaled up).
  function wantEmote(px, big) { return ceilSafe(px * EMOTE_EM * (big ? 3 : 1) * 2 / EMOTE_BASE_PX); }
  function wantBadge(px) { return ceilSafe(px * 2 / BADGE_BASE_PX); }

  function shadowCss(level) { return SHADOWS[clampInt(level, 0, 3, DEFAULT_SHADOW)]; }
  function bgAlpha(bg) { return clampInt(bg, 0, 100, 0) / 100; }

  // Value for --font: a quoted family name, or a bare generic keyword ("system-ui" must stay unquoted).
  function fontVar(name) {
    var s = String(name === undefined || name === null ? '' : name).replace(/[^A-Za-z0-9 \-]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) s = 'Inter';
    var lower = s.toLowerCase();
    if (GENERIC_FONTS.indexOf(lower) >= 0) return lower;
    return '"' + s + '"';
  }

  // Fade: the line disappears `fade` s after it arrived; the last FADE_OUT_MS is the visible fade-out.
  // delay > 0: still fully visible; delay < 0: already part-way through the fade-out.
  // Returns null (no fade), {expired:true} (drop it), or {expired:false, delay, duration} in ms.
  function fadeTiming(fadeS, ageMs) {
    var total = Number(fadeS) * 1000;
    if (!(total > 0)) return null;
    var age = Math.max(0, Number(ageMs) || 0);
    if (age >= total) return { expired: true };
    var dur = Math.min(FADE_OUT_MS, total);
    return { expired: false, delay: Math.round(total - dur - age), duration: Math.round(dur) };
  }

  // Inline `animation` value for a line ('' = none).
  function animString(isNew, animate, timing) {
    var parts = [];
    if (isNew && animate) parts.push('tco-in ' + IN_MS + 'ms ease-out');
    if (timing && !timing.expired) parts.push('tco-fade ' + timing.duration + 'ms linear ' + timing.delay + 'ms forwards');
    return parts.join(', ');
  }

  // Fixed-capacity FIFO; pushing into a full ring drops the oldest entry.
  function Ring(cap) {
    this.cap = Math.max(1, cap | 0 || 1);
    this.clear();
  }
  Ring.prototype.clear = function () {
    this.buf = new Array(this.cap);
    this.head = 0;
    this.size = 0;
  };
  Ring.prototype.push = function (v) {
    var dropped;
    if (this.size === this.cap) {
      dropped = this.buf[this.head];
      this.buf[this.head] = v;
      this.head = (this.head + 1) % this.cap;
    } else {
      this.buf[(this.head + this.size) % this.cap] = v;
      this.size++;
    }
    return dropped;
  };
  Ring.prototype.toArray = function () {
    var out = [];
    for (var i = 0; i < this.size; i++) out.push(this.buf[(this.head + i) % this.cap]);
    return out;
  };
  Ring.prototype.drain = function () {
    var a = this.toArray();
    this.clear();
    return a;
  };
  Ring.prototype.forEach = function (fn) {
    for (var i = 0; i < this.size; i++) fn(this.buf[(this.head + i) % this.cap]);
  };
  Ring.prototype.some = function (fn) {
    for (var i = 0; i < this.size; i++) if (fn(this.buf[(this.head + i) % this.cap])) return true;
    return false;
  };
  // Keep only entries where keep(v) is truthy; returns how many were removed.
  Ring.prototype.filter = function (keep) {
    var a = this.toArray();
    var kept = a.filter(keep);
    if (kept.length === a.length) return 0;
    this.clear();
    for (var i = 0; i < kept.length; i++) this.push(kept[i]);
    return a.length - kept.length;
  };
  Ring.prototype.resize = function (cap) {
    cap = Math.max(1, cap | 0 || 1);
    if (cap === this.cap) return;
    var a = this.toArray();
    this.cap = cap;
    this.clear();
    for (var i = Math.max(0, a.length - cap); i < a.length; i++) this.push(a[i]);
  };

  // Deleted message ids with a TTL and a size cap. Insertion order == expiry order.
  function DeletedIds(ttlMs, cap) {
    this.ttl = ttlMs;
    this.cap = cap;
    this.map = new Map();
  }
  DeletedIds.prototype.prune = function (now) {
    while (this.map.size) {
      var first = this.map.entries().next().value;
      if (first[1] > now) break;
      this.map.delete(first[0]);
    }
  };
  DeletedIds.prototype.add = function (id, now) {
    if (!id) return;
    this.map.delete(id);
    this.map.set(id, now + this.ttl);
    this.prune(now);
    while (this.map.size > this.cap) this.map.delete(this.map.keys().next().value);
  };
  DeletedIds.prototype.has = function (id, now) {
    if (!id) return false;
    var exp = this.map.get(id);
    if (exp === undefined) return false;
    if (exp <= now) { this.map.delete(id); return false; }
    return true;
  };
  Object.defineProperty(DeletedIds.prototype, 'size', { get: function () { return this.map.size; } });

  // How many lines overflow the chat box. rectAt(i) -> {top, bottom} in DOM order (reads stop early).
  // bottom: oldest first, count leading lines whose bottom is above the chat top.
  // top: newest first, count trailing lines whose top is below the chat bottom.
  function overflowCount(n, rectAt, align, viewTop, viewBottom) {
    var c = 0, i;
    if (align === 'top') {
      for (i = n - 1; i >= 0; i--) {
        if (rectAt(i).top >= viewBottom) c++;
        else break;
      }
    } else {
      for (i = 0; i < n; i++) {
        if (rectAt(i).bottom <= viewTop) c++;
        else break;
      }
    }
    return c;
  }

  // New DOM order (indexes) after reversing lines, keeping each notice + its message line together.
  function reverseGroups(keys) {
    var groups = [];
    for (var i = 0; i < keys.length; i++) {
      var g = groups[groups.length - 1];
      if (g && keys[i] !== undefined && keys[i] !== null && keys[i] === g.key) g.idx.push(i);
      else groups.push({ key: keys[i], idx: [i] });
    }
    var out = [];
    for (var j = groups.length - 1; j >= 0; j--) out.push.apply(out, groups[j].idx);
    return out;
  }

  function pickUrl(urls, want) {
    if (!urls || typeof urls !== 'object') return null;
    var u = util.absUrl(util.pickScale(urls, want));
    return typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null;
  }

  function num(v, def) {
    var n = Number(v);
    return isFinite(n) ? n : def;
  }
  function dim(v) {
    var n = Number(v);
    return n > 0 && n < 10000 ? n : 0;
  }

  function annClass(v) {
    if (!v) return null;
    var s = String(v).toUpperCase();
    return 'ann-' + (ANN_COLORS.indexOf(s) >= 0 ? s : 'PRIMARY').toLowerCase();
  }

  function lineClasses(msg, cfg, kind, action) {
    var c = ['line'];
    if (kind === 'notice') {
      c.push('notice');
    } else {
      if (action) c.push('action');
      if (cfg.first_msg && msg.firstMsg) c.push('first-msg');
      if (msg.highlight || msg.msgId === 'highlighted-message') c.push('highlight');
      var ann = annClass(msg.announcement);
      if (ann) c.push('announcement', ann);
    }
    if (msg.mirrored) c.push('mirrored');
    return c.join(' ');
  }

  function replyModel(reply) {
    if (!reply) return null;
    var name = String(reply.name || reply.login || '');
    if (!name) return null;
    var body = String(reply.body || '').replace(/^\u0001ACTION /, '').replace(/\u0001$/, '').replace(/[\r\n]+/g, ' ');
    return { name: '@' + name, body: body };
  }

  // With badges off, only the Shared Chat source avatar (provider 'avatar') is kept: it marks the source
  // channel rather than the user.
  function visibleBadges(list, cfg) {
    if (!Array.isArray(list)) return [];
    if (!cfg || cfg.badges !== false) return list;
    return list.filter(function (b) { return b && b.provider === 'avatar'; });
  }

  function badgeModels(list, want) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b) continue;
      var url = pickUrl(b.urls, want);
      if (!url) continue;
      out.push({
        url: url,
        title: String(b.title || ''),
        avatar: b.provider === 'avatar',
        bg: typeof b.bg === 'string' && b.bg ? b.bg : null
      });
    }
    return out;
  }

  function addText(parts, s) {
    if (!s) return;
    var last = parts[parts.length - 1];
    if (last && last.t === 'text') last.s += s;
    else parts.push({ t: 'text', s: s });
  }

  // Tokenizer items -> render parts (plain data; urls resolved, spaces folded into text parts).
  // opts: { want, wantBig, gifs }
  function partsFor(items, opts) {
    var parts = [];
    if (!Array.isArray(items)) return parts;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var space = parts.length > 0 && !!it.sp;
      if (it.type === 'emote') {
        var e = it.emote || {};
        var ename = String(e.name || '');
        var want = it.big ? opts.wantBig : opts.want;
        var url = pickUrl(e.urls, want);
        if (!url) { addText(parts, (space ? ' ' : '') + ename); continue; }
        var fx = it.fx || {};
        var sx = num(fx.sx, 1), sy = num(fx.sy, 1), rot = num(fx.rot, 0);
        var zs = !!fx.zs;
        if (space && !zs) addText(parts, ' ');
        var w = dim(e.w) || EMOTE_BASE_PX, h = dim(e.h) || EMOTE_BASE_PX;
        var ov = [];
        var overlays = Array.isArray(it.overlays) ? it.overlays : [];
        for (var j = 0; j < overlays.length; j++) {
          var o = overlays[j];
          var ou = o && pickUrl(o.urls, want);
          if (ou) ov.push({ name: String(o.name || ''), url: ou, w: dim(o.w) || EMOTE_BASE_PX, h: dim(o.h) || EMOTE_BASE_PX });
        }
        parts.push({
          t: 'emote', name: ename, url: url, w: w, h: h,
          big: !!it.big, grow: !!fx.grow, cursed: !!fx.cursed, zs: zs,
          fx: sx !== 1 || sy !== 1 || rot !== 0 ? { sx: sx, sy: sy, rot: rot } : null,
          ov: ov
        });
      } else if (it.type === 'gif') {
        var title = String(it.title || '');
        var gurl = opts.gifs && util.isSafeUrl(it.url) ? it.url : null;
        if (!gurl) { addText(parts, (space ? ' ' : '') + title); continue; }
        if (space) addText(parts, ' ');
        parts.push({ t: 'gif', url: gurl, title: title });
      } else if (it.type === 'cheer') {
        if (space) addText(parts, ' ');
        parts.push({
          t: 'cheer',
          prefix: String(it.prefix || ''),
          amount: String(it.amount === undefined ? '' : it.amount),
          color: HEX_COLOR_RE.test(it.color || '') ? it.color : null,
          url: pickUrl(it.urls, opts.want)
        });
      } else {
        var txt = it.text === undefined || it.text === null ? '' : String(it.text);
        if (txt) addText(parts, (space ? ' ' : '') + txt);
      }
    }
    return parts;
  }

  // Everything a line shows, as plain data. d: {kind, items, action, badges, name:{text, color, paint}}
  function modelFor(msg, cfg, d) {
    cfg = cfg || {};
    d = d || {};
    if (d.kind === 'notice') {
      return { kind: 'notice', cls: lineClasses(msg, cfg, 'notice', false), system: String(msg.systemMsg || '') };
    }
    var px = fontPx(cfg.size);
    var action = !!d.action;
    var nm = d.name || {};
    var text = typeof nm.text === 'string' && nm.text ? nm.text : String(msg.displayName || msg.login || '');
    var color = typeof nm.color === 'string' && nm.color ? nm.color : util.defaultColor(msg.userId, msg.login);
    var paint = typeof nm.paint === 'string' && PAINT_ID_RE.test(nm.paint) ? nm.paint : null;
    return {
      kind: 'chat',
      cls: lineClasses(msg, cfg, 'chat', action),
      reply: cfg.replies === false ? null : replyModel(msg.reply),
      badges: badgeModels(visibleBadges(d.badges, cfg), wantBadge(px)),
      name: { text: text, color: color, paint: paint },
      colon: action ? ' ' : ': ',
      msgColor: action ? color : null,
      parts: partsFor(d.items, { want: wantEmote(px, false), wantBig: wantEmote(px, true), gifs: cfg.gifs !== false })
    };
  }

  function sigOf(model) { return JSON.stringify(model); }

  // deps.tokensFor may return an items array or the tokenizer's {items, action}.
  function normTokens(res, msg) {
    if (Array.isArray(res)) return { items: res, action: false };
    if (res && Array.isArray(res.items)) return { items: res.items, action: !!res.action };
    var t = msg && msg.text ? String(msg.text) : '';
    return { items: t ? [{ type: 'text', text: t, sp: false }] : [], action: false };
  }

  // The user's own message attached to a USERNOTICE, rendered as a chat line under the notice.
  function userPart(msg) {
    var m = {};
    for (var k in msg) if (Object.prototype.hasOwnProperty.call(msg, k)) m[k] = msg[k];
    m.kind = 'chat';
    m.id = msg.id ? String(msg.id) + ':m' : '';
    m.sourceId = msg.sourceId ? String(msg.sourceId) + ':m' : '';
    m.noticeId = msg.id || '';
    m.reply = null;
    m.firstMsg = false;
    if (msg.type === 'announcement' && !m.announcement) m.announcement = msg.announceColor || 'PRIMARY';
    return m;
  }

  // ---------- renderer ----------
  // opts: { root: #chat element, cfg, deps: {tokensFor, badgesFor, nameFor, paintRule, shouldShow} }
  function createRenderer(opts) {
    opts = opts || {};
    var rootEl = opts.root;
    if (!rootEl || !rootEl.ownerDocument) throw new Error('renderer: a root element is required');
    var doc = rootEl.ownerDocument;
    var win = doc.defaultView || root;
    var deps = opts.deps || {};
    var cfg = null;

    var queue = new Ring(50);
    var deleted = new DeletedIds(DELETED_TTL_MS, DELETED_CAP);
    var byId = new Map();        // msg id / source id -> line
    var byUser = new Map();      // user id -> Set<line>
    var recs = new WeakMap();    // line -> {msg, src, kind, gid, born, sig, ids, userId}
    var paintState = new Map();  // paint id -> true (rule inserted) | false (rule rejected)
    var styleEl = null;
    var held = false, destroyed = false;
    var scheduled = false, rafId = null, flushTimer = null;
    var trimTimer = null, sweepTimer = null;
    var seq = 0, flushes = 0;
    var ro = null;

    var linesEl = null;
    for (var c = rootEl.firstElementChild; c; c = c.nextElementSibling) {
      if (c.classList && c.classList.contains('lines')) { linesEl = c; break; }
    }
    if (!linesEl) {
      linesEl = doc.createElement('div');
      linesEl.className = 'lines';
      rootEl.appendChild(linesEl);
    }

    // ----- small DOM helpers -----
    function el(tag, cls) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      return e;
    }
    function span(cls, text) {
      var s = el('span', cls);
      s.textContent = text;
      return s;
    }
    function detach(node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    function replaceWithText(node, text) {
      var p = node && node.parentNode;
      if (p) p.replaceChild(doc.createTextNode(text), node);
    }
    function children() { return Array.prototype.slice.call(linesEl.children); }

    function callDep(name, arg) {
      var fn = deps[name];
      if (typeof fn !== 'function') return undefined;
      try { return fn(arg); } catch (e) {
        util.warn('renderer: deps.' + name + ' threw', e);
        return undefined;
      }
    }
    function showable(msg) {
      if (typeof deps.shouldShow !== 'function') return true;
      try { return !!deps.shouldShow(msg); } catch (e) {
        util.warn('renderer: deps.shouldShow threw', e);
        return true;
      }
    }

    // ----- paints: one rule per paint id in our own <style> -----
    function paintSheet() {
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.setAttribute('data-tco', 'paints');
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
      return styleEl.sheet || null;
    }
    function ensurePaint(id) {
      if (paintState.has(id)) return paintState.get(id);
      var rule = callDep('paintRule', id);
      if (typeof rule !== 'string' || !rule) return false; // not known yet: retried on the next render
      var sheet = paintSheet();
      if (!sheet) return false;
      try {
        sheet.insertRule(rule, sheet.cssRules.length);
        paintState.set(id, true);
      } catch (e) {
        util.warn('renderer: paint rule rejected', id, e && e.message);
        paintState.set(id, false);
      }
      return paintState.get(id);
    }

    // ----- images: one factory, per-kind fallbacks -----
    function makeImg(cls, url, w, h, alt, onFail) {
      var img = doc.createElement('img');
      img.className = cls;
      if (w > 0) img.setAttribute('width', String(Math.max(1, Math.round(w))));
      if (h > 0) img.setAttribute('height', String(Math.max(1, Math.round(h))));
      img.setAttribute('decoding', 'async');
      img.alt = alt || '';
      img.onerror = function () {
        img.onerror = null;
        if (onFail) onFail(img);
      };
      img.src = url;
      return img;
    }
    function dropBadge(img) {
      var p = img.parentNode;
      if (p && p.classList && p.classList.contains('badge-wrap')) detach(p);
      else detach(img);
    }
    function badgeNode(b) {
      var img = makeImg(b.avatar ? 'badge avatar' : 'badge', b.url, BADGE_BASE_PX, BADGE_BASE_PX, b.title, dropBadge);
      if (!b.bg) return img;
      var wrap = el('span', 'badge-wrap');
      wrap.style.backgroundColor = b.bg;
      wrap.appendChild(img);
      return wrap;
    }
    function emoteNode(p) {
      var cls = 'emote-stack';
      if (p.big) cls += ' big';
      if (p.fx) cls += ' fx';
      if (p.grow) cls += ' grow';
      if (p.cursed) cls += ' cursed';
      if (p.zs) cls += ' zs';
      var stack = el('span', cls);
      if (p.fx) {
        stack.style.setProperty('--sx', String(p.fx.sx));
        stack.style.setProperty('--sy', String(p.fx.sy));
        stack.style.setProperty('--rot', p.fx.rot + 'deg');
      }
      var base = makeImg('emote', p.url, p.grow ? p.w * 2 : p.w, p.h, p.name, function () {
        replaceWithText(stack, p.name);
      });
      if (p.grow) base.style.width = 'calc(var(--eh) * ' + Math.round(2 * p.w / p.h * 1000) / 1000 + ')';
      stack.appendChild(base);
      for (var i = 0; i < p.ov.length; i++) {
        var o = p.ov[i];
        stack.appendChild(makeImg('emote zw', o.url, o.w, o.h, o.name, detach));
      }
      return stack;
    }
    function cheerNode(p) {
      var s = el('span', 'cheer');
      if (p.url) {
        s.appendChild(makeImg('cheer-img', p.url, EMOTE_BASE_PX, EMOTE_BASE_PX, p.prefix, function (img) {
          replaceWithText(img, p.prefix);
        }));
      } else {
        s.appendChild(doc.createTextNode(p.prefix));
      }
      var amt = span('cheer-amount', p.amount);
      if (p.color) amt.style.color = p.color;
      s.appendChild(amt);
      return s;
    }
    function partNode(p) {
      if (p.t === 'emote') return emoteNode(p);
      if (p.t === 'cheer') return cheerNode(p);
      if (p.t === 'gif') {
        return makeImg('gif', p.url, 0, 0, p.title, function (img) { replaceWithText(img, p.title); });
      }
      return doc.createTextNode(p.s || '');
    }

    // Replace a line's content with the model. The line element (and its fade animation) is kept.
    function renderInto(line, model) {
      line.className = model.cls;
      line.setAttribute('data-kind', model.kind);
      line.textContent = '';
      if (model.kind === 'notice') {
        line.appendChild(span('message', model.system));
        return;
      }
      if (model.reply) {
        var r = el('div', 'reply');
        r.appendChild(doc.createTextNode('↪ '));
        r.appendChild(span('reply-name', model.reply.name));
        r.appendChild(doc.createTextNode(': '));
        r.appendChild(span('reply-body', model.reply.body));
        line.appendChild(r);
      }
      var bs = el('span', 'badges');
      for (var i = 0; i < model.badges.length; i++) bs.appendChild(badgeNode(model.badges[i]));
      line.appendChild(bs);
      var nm = span(model.name.paint ? 'name painted p-' + model.name.paint : 'name', model.name.text);
      if (model.name.color) nm.style.color = model.name.color;
      line.appendChild(nm);
      line.appendChild(span('colon', model.colon));
      var ms = el('span', 'message');
      if (model.msgColor) ms.style.color = model.msgColor;
      for (var j = 0; j < model.parts.length; j++) ms.appendChild(partNode(model.parts[j]));
      line.appendChild(ms);
    }

    function buildModel(msg, kind) {
      if (kind === 'notice') return modelFor(msg, cfg, { kind: 'notice' });
      var tk = normTokens(callDep('tokensFor', msg), msg);
      // Always asked: with badges off, badgesFor still supplies the Shared Chat avatar (modelFor keeps only that).
      var badges = callDep('badgesFor', msg);
      var nm = callDep('nameFor', msg) || {};
      var pid = cfg.paints !== false && nm.paintId !== undefined && nm.paintId !== null ? String(nm.paintId) : '';
      var paint = pid && PAINT_ID_RE.test(pid) && ensurePaint(pid) ? pid : null;
      return modelFor(msg, cfg, {
        kind: 'chat',
        items: tk.items,
        action: !!(msg.action || tk.action),
        badges: Array.isArray(badges) ? badges : [],
        name: { text: nm.text, color: nm.color, paint: paint }
      });
    }

    // ----- lines and indexes -----
    function makeLine(msg, kind, src, gid, born) {
      var model = buildModel(msg, kind);
      var line = doc.createElement('div');
      renderInto(line, model);
      recs.set(line, { msg: msg, src: src, kind: kind, gid: gid, born: born, sig: sigOf(model), ids: [], userId: '' });
      return line;
    }
    function indexLine(line) {
      var rec = recs.get(line);
      var m = rec.msg;
      var id = util.idStr(m.id), sid = util.idStr(m.sourceId);
      if (id) rec.ids.push(id);
      if (sid && sid !== id) rec.ids.push(sid);
      for (var i = 0; i < rec.ids.length; i++) byId.set(rec.ids[i], line);
      var uid = rec.kind === 'chat' ? util.idStr(m.userId) : '';
      if (uid) {
        rec.userId = uid;
        var set = byUser.get(uid);
        if (!set) { set = new Set(); byUser.set(uid, set); }
        set.add(line);
      }
    }
    // The single place a line leaves the DOM; clears every index.
    function removeLine(line) {
      if (!line) return;
      var rec = recs.get(line);
      if (rec) {
        for (var i = 0; i < rec.ids.length; i++) {
          if (byId.get(rec.ids[i]) === line) byId.delete(rec.ids[i]);
        }
        if (rec.userId) {
          var set = byUser.get(rec.userId);
          if (set) {
            set.delete(line);
            if (!set.size) byUser.delete(rec.userId);
          }
        }
        recs.delete(line);
      }
      detach(line);
    }

    // A notice renders as a .notice line plus (when the user wrote something) a chat line under it.
    function buildGroup(msg, born) {
      var gid = msg.id ? String(msg.id) : 'g' + (++seq);
      var out = [];
      if (msg.kind === 'notice') {
        if (msg.systemMsg) out.push(makeLine(msg, 'notice', msg, gid, born));
        if (msg.text && /\S/.test(msg.text)) out.push(makeLine(userPart(msg), 'chat', msg, gid, born));
      } else {
        out.push(makeLine(msg, 'chat', msg, gid, born));
      }
      for (var i = 0; i < out.length; i++) indexLine(out[i]);
      return out;
    }

    function isGone(msg, now) {
      var id = util.idStr(msg.id), sid = util.idStr(msg.sourceId);
      if (id && (byId.has(id) || deleted.has(id, now))) return true;
      return !!(sid && deleted.has(sid, now));
    }

    function insertGroups(groups, now) {
      var top = cfg.align === 'top';
      var frag = doc.createDocumentFragment();
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[top ? groups.length - 1 - gi : gi];
        for (var li = 0; li < g.length; li++) {
          var line = g[li];
          var anim = animString(true, cfg.animate, fadeTiming(cfg.fade, now - recs.get(line).born));
          if (anim) line.style.animation = anim;
          frag.appendChild(line);
        }
      }
      if (top) linesEl.insertBefore(frag, linesEl.firstChild);
      else linesEl.appendChild(frag);
    }

    function capLines() {
      var extra = linesEl.childElementCount - cfg.max;
      if (extra <= 0) return false;
      var top = cfg.align === 'top';
      for (; extra > 0; extra--) removeLine(top ? linesEl.lastElementChild : linesEl.firstElementChild);
      return true;
    }

    function sweepExpired(now) {
      if (!(cfg.fade > 0)) return false;
      var limit = cfg.fade * 1000;
      var dead = [];
      for (var line = linesEl.firstElementChild; line; line = line.nextElementSibling) {
        var rec = recs.get(line);
        if (rec && now - rec.born >= limit) dead.push(line);
      }
      for (var i = 0; i < dead.length; i++) removeLine(dead[i]);
      return dead.length > 0;
    }

    // Remove lines that are fully outside the chat box (the newest line is never removed).
    function trimOverflow() {
      if (destroyed) return;
      var kids = linesEl.children;
      var n = kids.length;
      if (!n) return;
      var view = rootEl.getBoundingClientRect();
      if (!(view.height > 0)) return; // not laid out (hidden iframe, display:none): measure nothing
      var top = cfg.align === 'top';
      var cnt = overflowCount(n, function (i) { return kids[i].getBoundingClientRect(); }, cfg.align, view.top, view.bottom);
      if (!cnt) return;
      var victims = [];
      for (var i = 0; i < cnt; i++) victims.push(top ? kids[n - 1 - i] : kids[i]);
      for (var j = 0; j < victims.length; j++) removeLine(victims[j]);
    }
    function scheduleTrim() {
      // Deferred out of ResizeObserver callbacks so removals never cause an RO loop error.
      if (trimTimer || destroyed) return;
      trimTimer = setTimeout(function () {
        trimTimer = null;
        trimOverflow();
      }, 0);
    }

    // Re-time every line's fade from its arrival time (after align/fade changes or a reorder).
    function restartFades(now) {
      var list = children();
      if (!list.length) return;
      for (var i = 0; i < list.length; i++) list[i].style.animation = 'none';
      void linesEl.offsetHeight; // style flush: cancels the running animations so the new ones start now
      for (var j = 0; j < list.length; j++) {
        var rec = recs.get(list[j]);
        var t = rec ? fadeTiming(cfg.fade, now - rec.born) : null;
        if (t && t.expired) removeLine(list[j]);
        else list[j].style.animation = animString(false, false, t);
      }
    }

    function reverseLines() {
      var list = children();
      if (list.length < 2) return;
      var order = reverseGroups(list.map(function (line) {
        var rec = recs.get(line);
        return rec ? rec.gid : undefined;
      }));
      var frag = doc.createDocumentFragment();
      for (var i = 0; i < order.length; i++) frag.appendChild(list[order[i]]);
      linesEl.appendChild(frag);
    }

    function sweepFilters() {
      if (typeof deps.shouldShow !== 'function') return;
      var list = children();
      for (var i = 0; i < list.length; i++) {
        var rec = recs.get(list[i]);
        if (rec && !showable(rec.src)) removeLine(list[i]);
      }
      queue.filter(function (en) { return showable(en.msg); });
    }

    function ensureSweepTimer() {
      var want = !destroyed && cfg && cfg.fade > 0;
      if (want && !sweepTimer) {
        sweepTimer = setInterval(function () {
          if (sweepExpired(Date.now())) scheduleTrim();
        }, SWEEP_MS);
      } else if (!want && sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
    }

    // ----- flush scheduling (rAF, with a timer fallback because rAF stalls in hidden OBS sources) -----
    function clearSchedule() {
      scheduled = false;
      if (rafId !== null) {
        if (win.cancelAnimationFrame) win.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    }
    function schedule() {
      if (held || destroyed || scheduled) return;
      scheduled = true;
      if (typeof win.requestAnimationFrame === 'function') rafId = win.requestAnimationFrame(flush);
      flushTimer = setTimeout(flush, FLUSH_FALLBACK_MS);
    }

    function flush() {
      clearSchedule();
      if (held || destroyed) return;
      var now = Date.now();
      var changed = false;
      var entries = queue.drain();
      if (entries.length) {
        // Newest first so at most cfg.max lines get built, then back to arrival order.
        var groups = [];
        var count = 0;
        for (var i = entries.length - 1; i >= 0 && count < cfg.max; i--) {
          var en = entries[i];
          var t = fadeTiming(cfg.fade, now - en.born);
          if ((t && t.expired) || isGone(en.msg, now)) continue;
          var g;
          try { g = buildGroup(en.msg, en.born); } catch (e) {
            util.warn('renderer: failed to render a message', e);
            continue;
          }
          if (g.length) {
            groups.push(g);
            count += g.length;
          }
        }
        if (groups.length) {
          groups.reverse();
          insertGroups(groups, now);
          changed = true;
        }
      }
      if (sweepExpired(now)) changed = true;
      if (capLines()) changed = true;
      if (changed) trimOverflow();
      flushes++;
    }

    // ----- events -----
    function onAnimEnd(e) {
      if (e.animationName !== 'tco-fade') return;
      var t = e.target;
      if (t && t.parentNode === linesEl && recs.has(t)) removeLine(t);
    }
    // While hidden nothing renders, so CSS animations of lines inserted meanwhile never started.
    // On show: flush, then re-time every line from its arrival (no mass fade-in, correct fades).
    function onShown() {
      flush();
      if (!held && !destroyed) restartFades(Date.now());
    }
    function onVisibility() {
      if (doc.visibilityState !== 'hidden') onShown();
    }
    function onObsVisible(e) {
      if (e && e.detail && e.detail.visible === false) return;
      onShown();
    }
    linesEl.addEventListener('animationend', onAnimEnd);
    doc.addEventListener('visibilitychange', onVisibility);
    if (win.addEventListener) win.addEventListener('obsSourceVisibleChanged', onObsVisible);
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(function () { scheduleTrim(); });
      ro.observe(linesEl);
      ro.observe(rootEl);
    }

    // ----- config -----
    function applyRoot(c) {
      var cl = rootEl.classList;
      var sizes = Object.keys(FONT_PX);
      for (var i = 0; i < sizes.length; i++) cl.toggle('size-' + sizes[i], c.size === sizes[i]);
      cl.toggle('align-top', c.align === 'top');
      cl.toggle('align-bottom', c.align !== 'top');
      cl.toggle('animate', !!c.animate);
      cl.toggle('has-bg', c.bg > 0);
      var st = rootEl.style;
      st.setProperty('--font', fontVar(c.font));
      st.setProperty('--shadow', shadowCss(c.shadow));
      st.setProperty('--bg-alpha', String(bgAlpha(c.bg)));
      st.setProperty('--emote-h', EMOTE_EM + 'em');
    }

    function setConfig(next) {
      if (destroyed) return;
      var prev = cfg;
      cfg = normalizeCfg(next);
      applyRoot(cfg);
      queue.resize(cfg.max);
      ensureSweepTimer();
      if (!prev) return;
      var restart = false;
      if (prev.align !== cfg.align) {
        reverseLines();
        restart = true; // moving nodes restarts CSS animations
      }
      if (prev.fade !== cfg.fade) restart = true;
      if (restart) restartFades(Date.now());
      if (changedAny(prev, cfg, FILTER_KEYS)) sweepFilters();
      if (changedAny(prev, cfg, RERENDER_KEYS)) rerender();
      capLines();
      scheduleTrim();
    }

    // ----- public API -----
    function push(msg) {
      if (destroyed || !msg || typeof msg !== 'object') return false;
      var now = Date.now();
      var id = util.idStr(msg.id);
      if (id) {
        if (deleted.has(id, now) || byId.has(id)) return false;
        if (queue.some(function (en) { return util.idStr(en.msg.id) === id; })) return false;
      }
      var sid = util.idStr(msg.sourceId);
      if (sid && deleted.has(sid, now)) return false;
      if (!showable(msg)) return false;
      // Live lines age from arrival (immune to clock skew); history ages from tmi-sent-ts.
      var ts = Number(msg.ts);
      var born = msg.historical && isFinite(ts) && ts > 0 ? Math.min(ts, now) : now;
      queue.push({ msg: msg, born: born });
      schedule();
      return true;
    }

    function clearUser(userId) {
      var uid = util.idStr(userId);
      if (!uid || destroyed) return;
      queue.filter(function (en) { return util.idStr(en.msg.userId) !== uid; });
      var set = byUser.get(uid);
      if (!set) return;
      var list = Array.from(set);
      for (var i = 0; i < list.length; i++) removeLine(list[i]);
    }

    function clearMessage(msgId) {
      var id = util.idStr(msgId);
      if (!id || destroyed) return;
      deleted.add(id, Date.now());
      queue.filter(function (en) { return util.idStr(en.msg.id) !== id && util.idStr(en.msg.sourceId) !== id; });
      removeLine(byId.get(id));
      removeLine(byId.get(id + ':m'));
    }

    function clearAll() {
      if (destroyed) return;
      queue.clear();
      byId.clear();
      byUser.clear();
      linesEl.textContent = '';
    }

    // Rebuild the content of on-screen lines where pred(msg) is true (all lines without pred).
    // The line element stays, so its fade keeps its timing. Returns how many lines changed.
    function rerender(pred) {
      if (destroyed || !cfg) return 0;
      var n = 0;
      var list = children();
      for (var i = 0; i < list.length; i++) {
        var line = list[i];
        var rec = recs.get(line);
        if (!rec) continue;
        var match = true;
        if (typeof pred === 'function') {
          try { match = !!pred(rec.msg); } catch (e) { match = false; }
        }
        if (!match) continue;
        try {
          var model = buildModel(rec.msg, rec.kind);
          var sig = sigOf(model);
          if (sig === rec.sig) continue; // unchanged: keep the DOM (animated images don't restart)
          renderInto(line, model);
          rec.sig = sig;
          n++;
        } catch (e) {
          util.warn('renderer: rerender failed', e);
        }
      }
      if (n) scheduleTrim();
      return n;
    }

    function hold(on) {
      if (destroyed) return;
      held = !!on;
      if (held) clearSchedule();
      else flush();
    }

    function hasUser(userId) {
      var uid = util.idStr(userId);
      if (!uid) return false;
      if (byUser.has(uid)) return true;
      return queue.some(function (en) { return util.idStr(en.msg.userId) === uid; });
    }

    // User ids with a line on screen or waiting in the queue.
    function userIds() {
      var set = new Set(byUser.keys());
      queue.forEach(function (en) {
        var u = util.idStr(en.msg.userId);
        if (u) set.add(u);
      });
      return Array.from(set);
    }

    function stats() {
      return {
        lines: linesEl.childElementCount,
        queued: queue.size,
        pending: queue.size,
        users: byUser.size,
        ids: byId.size,
        deleted: deleted.size,
        paints: paintState.size,
        held: held,
        flushes: flushes
      };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearSchedule();
      if (trimTimer) { clearTimeout(trimTimer); trimTimer = null; }
      if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
      if (ro) { ro.disconnect(); ro = null; }
      linesEl.removeEventListener('animationend', onAnimEnd);
      doc.removeEventListener('visibilitychange', onVisibility);
      if (win.removeEventListener) win.removeEventListener('obsSourceVisibleChanged', onObsVisible);
      queue.clear();
      byId.clear();
      byUser.clear();
      paintState.clear();
      detach(linesEl);
      detach(styleEl);
      styleEl = null;
    }

    setConfig(opts.cfg || {});

    return {
      push: push,
      clearUser: clearUser,
      clearMessage: clearMessage,
      clearAll: clearAll,
      rerender: rerender,
      setConfig: setConfig,
      hold: hold,
      flush: function () { flush(); },
      hasUser: hasUser,
      userIds: userIds,
      stats: stats,
      destroy: destroy
    };
  }

  return {
    createRenderer: createRenderer,
    _internal: {
      FONT_PX: FONT_PX,
      EMOTE_EM: EMOTE_EM,
      SHADOWS: SHADOWS,
      IN_MS: IN_MS,
      FADE_OUT_MS: FADE_OUT_MS,
      FLUSH_FALLBACK_MS: FLUSH_FALLBACK_MS,
      DELETED_TTL_MS: DELETED_TTL_MS,
      DELETED_CAP: DELETED_CAP,
      RERENDER_KEYS: RERENDER_KEYS,
      FILTER_KEYS: FILTER_KEYS,
      clampInt: clampInt,
      normalizeCfg: normalizeCfg,
      changedAny: changedAny,
      fontPx: fontPx,
      wantEmote: wantEmote,
      wantBadge: wantBadge,
      shadowCss: shadowCss,
      bgAlpha: bgAlpha,
      fontVar: fontVar,
      fadeTiming: fadeTiming,
      animString: animString,
      Ring: Ring,
      DeletedIds: DeletedIds,
      overflowCount: overflowCount,
      reverseGroups: reverseGroups,
      pickUrl: pickUrl,
      annClass: annClass,
      lineClasses: lineClasses,
      replyModel: replyModel,
      badgeModels: badgeModels,
      visibleBadges: visibleBadges,
      partsFor: partsFor,
      modelFor: modelFor,
      sigOf: sigOf,
      normTokens: normTokens,
      userPart: userPart
    }
  };
});
