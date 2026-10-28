/* Avatar mode (avatar=blob, bot, cat or custom): a picture in a bottom corner of the source says each chat message in
   a speech bubble, typing it out while its mouth moves. createAvatar takes the renderer's options and gives the
   renderer's API, so overlay.js uses it in the renderer's place. It draws with a renderer of its own, into #chat, whose
   .lines is the bubble (css/overlay.css): that renderer is handed one message at a time, as its turn comes, so a line in
   the bubble shows everything a chat line does (emotes, badges, paints, highlights) and goes as a chat line goes when a
   moderator deletes it, times out or bans its author, or clears the chat. The messages waiting their turn are kept here,
   bubble_queue of them at most (the oldest waiting goes when another comes), and moderation takes them as well. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var renderer = typeof require === 'function' ? require('./renderer.js') : root.TCO.renderer;
  var api = factory(root, util, renderer);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).avatar = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, renderer) {
  'use strict';

  // The bundled pictures, by avatar's value: [idle, talking], beside overlay.html.
  var PRESETS = {
    blob: ['img/avatars/blob-idle.png', 'img/avatars/blob-talk.png'],
    bot: ['img/avatars/bot-idle.png', 'img/avatars/bot-talk.png'],
    cat: ['img/avatars/cat-idle.png', 'img/avatars/cat-talk.png']
  };

  // ----- timing -----
  var FLAP_MS = 110;          // the mouth opens or shuts this often while letters come
  var POP_MS = 240;           // the bubble's exit (css/overlay.css: its transition)
  var GAP_MS = 160;           // between one bubble going and the next coming
  var TYPE_MAX_MS = 8000;     // the longest a message takes to type out: a longer one types faster
  var READ_BASE_MS = 1500;    // a typed message stays this long, plus READ_CHAR_MS a letter (an emote counts as two),
  var READ_CHAR_MS = 55;      // at least READ_MIN_MS and at most bubble_time
  var READ_MIN_MS = 2500;
  var BUSY_TYPE = 2;          // with other messages waiting their turn: typed twice as fast,
  var BUSY_READ = 0.5;        // and kept half as long, but at least BUSY_MIN_MS
  var BUSY_MIN_MS = 1200;
  var TALK_CHAR_MS = 45;      // bubble_speed=0 (the whole message at once): the mouth moves this long a letter,
  var TALK_MAX_MS = 4000;     // at most this long
  var EMOTE_UNITS = 2;        // an emote takes as long to type as two letters
  var PAUSE_END = 5;          // after . ! ? and the like, a pause as long as so many letters, with the mouth shut,
  var PAUSE_MID = 2;          // and after , ; :
  var NO_PICTURE_MS = 8000;   // avatar=custom with no picture by then: a hint says so
  var LOOK_MS = 1000;         // how often the picture is looked for while it isn't known (Custom CSS comes late)
  var LOOK_FOR_MS = 60000;    // ... and for how long
  var FIT_MARGIN = 6;         // px left between a bubble and the top of the source

  // ----- pure helpers (unit tested) -----

  // The renderer's config for the bubble: the message as a line in a column, with no box, shadow or animation of its own
  // (the bubble has its own look and pops in itself), and one message at a time. No picture frames either: the bubble is
  // the message's box.
  var INNER = { layout: 'vertical', align: 'bottom', animate: false, smooth_scroll: false, fade: 0, max: 1, bg: 0, shadow: 0,
    line_width: 0, edge_fade: 0, row_sep: 'none', row_grow: false, box_image: '', name_image: '' };
  function innerCfg(cfg) {
    var c = {};
    for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) c[k] = cfg[k];
    for (var j in INNER) c[j] = INNER[j];
    return c;
  }

  // The pictures cfg names, { idle, talk } ('' for none): a bundled pair, or custom's own (talk falls back to idle in the
  // stylesheet). Custom without an idle picture gives none: it may come from OBS's Custom CSS.
  function pictures(cfg) {
    var p = cfg && Object.prototype.hasOwnProperty.call(PRESETS, cfg.avatar) ? PRESETS[cfg.avatar] : null;
    if (p) return { idle: p[0], talk: p[1] };
    return { idle: (cfg && cfg.avatar_idle) || '', talk: (cfg && cfg.avatar_idle && cfg.avatar_talk) || '' };
  }

  var cssUrl = util.cssUrl;

  // The bubble's color and what is drawn on it: color (white unless bubble_color is set: set), ink, the text and outline
  // (text_color when set, else dark on a light bubble and white on a dark one), notice, a sub or raid notice's text
  // there, and back, the backdrop util.readableColor darkens light names on (null on a dark bubble). Only 6 checked hex
  // digits are ever taken from either setting.
  var INK_DARK = '#1d1d22', INK_LIGHT = '#ffffff', NOTICE_DARK = '#5b34c9', NOTICE_LIGHT = '#e2d6ff';
  function checkedHex(v) { return typeof v === 'string' && /^[0-9a-f]{6}$/.test(v) ? v : ''; }
  function bubbleLook(cfg) {
    var own = checkedHex(cfg && cfg.bubble_color), text = checkedHex(cfg && cfg.text_color);
    var back = util.boxBackdrop(own || 'ffffff', 1), light = util.lightBackdrop(back);
    return { color: '#' + (own || 'ffffff'), set: !!own, ink: text ? '#' + text : light ? INK_DARK : INK_LIGHT,
      notice: light ? NOTICE_DARK : NOTICE_LIGHT, back: light ? back : null };
  }

  // What a unit of a message counts as for its timing: a space (shown with what comes after it), the end of a sentence
  // or a pause inside one (the mouth shuts), an emote, or a letter.
  var END_RE = /^[.!?…。！？‼⁇]+$/;
  var MID_RE = /^[,;:、，；：]+$/;
  function unitKind(g) {
    if (/^\s+$/.test(g)) return 'space';
    if (END_RE.test(g)) return 'end';
    if (MID_RE.test(g)) return 'mid';
    return 'char';
  }

  // When each unit shows, in ms from the start (at), how long typing takes (total), and a letter's time (base). speed:
  // bubble_speed; busy: others are waiting. Over TYPE_MAX_MS it all goes faster.
  function typeSchedule(kinds, speed, busy) {
    var base = 1000 / Math.max(1, speed) / (busy ? BUSY_TYPE : 1);
    var t = 0, at = [];
    for (var i = 0; i < kinds.length; i++) {
      at.push(t);
      var k = kinds[i];
      if (k === 'space') continue;
      t += base * (k === 'emote' ? EMOTE_UNITS : 1);
      if (k === 'end') t += base * PAUSE_END;
      else if (k === 'mid') t += base * PAUSE_MID;
    }
    var s = t > TYPE_MAX_MS ? TYPE_MAX_MS / t : 1;
    return { at: at.map(function (x) { return x * s; }), total: t * s, base: base * s };
  }

  // How many letters a message's units count as (an emote two, a space none): what its reading time goes by.
  function letters(kinds) {
    var n = 0;
    for (var i = 0; i < kinds.length; i++) n += kinds[i] === 'space' ? 0 : kinds[i] === 'emote' ? EMOTE_UNITS : 1;
    return n;
  }

  // How long a typed message stays, in ms: its reading time within READ_MIN_MS and bubble_time, cut by half (to
  // BUSY_MIN_MS at least) while others wait.
  function holdMs(n, cfg, busy) {
    var most = Math.max(1, Number(cfg && cfg.bubble_time) || 6) * 1000;
    var ms = Math.min(most, Math.max(READ_MIN_MS, READ_BASE_MS + READ_CHAR_MS * n));
    return busy ? Math.min(ms, Math.max(BUSY_MIN_MS, ms * BUSY_READ)) : ms;
  }

  // bubble_speed=0: how long the mouth moves for a message shown whole.
  function talkMs(n, busy) { return Math.min(TALK_MAX_MS, n * TALK_CHAR_MS) / (busy ? BUSY_TYPE : 1); }

  // ----- the avatar -----
  function createAvatar(opts) {
    opts = opts || {};
    var rootEl = opts.root;
    if (!rootEl || !rootEl.ownerDocument) throw new Error('avatar: a root element is required');
    var doc = rootEl.ownerDocument;
    var win = doc.defaultView || root;
    var deps = opts.deps || {};
    var onHint = typeof opts.onHint === 'function' ? opts.onHint : function () {};
    var cfg = opts.cfg || {};
    var inner = renderer.createRenderer({ root: rootEl, cfg: innerCfg(cfg), deps: deps });
    var linesEl = null;
    for (var c = rootEl.firstElementChild; c; c = c.nextElementSibling) {
      if (c.classList && c.classList.contains('lines')) { linesEl = c; break; }
    }

    // .speaker > .speaker-bob (bobs as the mouth opens) > .speaker-body (lively's breathing) > the two pictures. Before
    // .lines, so the bubble is drawn over the avatar where they meet.
    var el = function (cls) { var e = doc.createElement('div'); e.className = cls; return e; };
    var speaker = el('speaker'), bob = el('speaker-bob'), body = el('speaker-body');
    var idleEl = el('speaker-idle'), talkEl = el('speaker-talk');
    speaker.setAttribute('aria-hidden', 'true');
    body.appendChild(idleEl);
    body.appendChild(talkEl);
    bob.appendChild(body);
    speaker.appendChild(bob);
    rootEl.insertBefore(speaker, linesEl);
    rootEl.classList.add('has-avatar');

    var waiting = [];      // { msg, born, shown }: the messages waiting their turn, oldest first
    var cur = null;        // the message being said: { msg, born, shown, phase, lines, units, sched, at, t0, ... }
    var held = false, destroyed = false;
    var nextTimer = null, typeTimer = null, holdTimer = null, outTimer = null, flapTimer = null;
    var mouthOpen = false, talkUntil = 0;
    var mo = null, headMo = null, lookTimer = null, lookUntil = 0, noPictureTimer = null;
    var shownSrc = null, ratioSeq = 0;
    var graphemes;

    function now() { return Date.now(); }
    function hidden() { return doc.visibilityState === 'hidden'; }
    function idOf(m) { return util.idStr(m && m.id); }
    function showable(msg) {
      if (typeof deps.shouldShow !== 'function') return true;
      try { return !!deps.shouldShow(msg); } catch (e) {
        util.warn('avatar: deps.shouldShow threw', e);
        return true;
      }
    }
    function covers(pred, msg) {
      if (!pred) return true;
      try { return !!pred(msg); } catch (e) { return false; }
    }
    function setVar(name, value) {
      if (value === null || value === undefined) rootEl.style.removeProperty(name);
      else rootEl.style.setProperty(name, String(value));
    }
    function clear(t) { if (t) clearTimeout(t); return null; }
    function setClass(name, on) { rootEl.classList.toggle(name, !!on); }

    // ----- the look -----
    function applyLook(c) {
      var cl = rootEl.classList;
      cl.toggle('avatar-left', c.avatar_side !== 'right');
      cl.toggle('avatar-right', c.avatar_side === 'right');
      cl.toggle('bubble-side', c.bubble_pos !== 'above');
      cl.toggle('bubble-above', c.bubble_pos === 'above');
      cl.toggle('avatar-flip', c.avatar_flip === true);
      ['bounce', 'lively', 'none'].forEach(function (m) { cl.toggle('motion-' + m, (c.avatar_motion || 'bounce') === m); });
      var p = pictures(c), look = bubbleLook(c), base = pageBase();
      setVar('--avatar-idle', p.idle ? cssUrl(p.idle, base) : null);
      setVar('--avatar-talk', p.talk ? cssUrl(p.talk, base) : null);
      setVar('--avatar-size', (Number(c.avatar_size) > 0 ? Math.round(Number(c.avatar_size)) : 300) + 'px');
      setVar('--bubble-w', (Number(c.bubble_width) > 0 ? Math.round(Number(c.bubble_width)) : 18) + 'em');
      setVar('--bubble-color', look.set ? look.color : null);
      setVar('--bubble-ink', look.ink);
      setVar('--bubble-notice', look.notice);
      look4Picture();
    }

    // The picture in use: the idle picture's computed background once #chat is in the page (a bundled one, cfg's own, or
    // OBS's Custom CSS), else the one cfg names.
    function currentSrc() {
      var bg = '';
      if (rootEl.isConnected !== false && typeof win.getComputedStyle === 'function') {
        try { bg = win.getComputedStyle(idleEl).backgroundImage || ''; } catch (e) { bg = ''; }
      }
      var m = /url\((['"]?)(.*?)\1\)/.exec(bg);
      if (m && m[2]) return m[2];
      var p = pictures(cfg).idle;
      if (!p) return '';
      try { return new URL(p, pageBase()).href; } catch (e) { return p; }
    }
    function pageBase() { return doc.baseURI || (win.location && win.location.href) || ''; }
    // The picture in use is loaded once more, unseen, for its width to its height (--avatar-ratio), so the avatar's box is
    // the picture's shape and the bubble starts at its edge. A hint says when it doesn't load.
    function measure() {
      if (destroyed) return;
      var src = currentSrc();
      if (src === shownSrc) return;
      shownSrc = src;
      var seq = ++ratioSeq;
      if (!src) { setVar('--avatar-ratio', null); return; }
      if (noPictureTimer) noPictureTimer = clear(noPictureTimer);
      if (typeof win.Image !== 'function') return;
      var img = new win.Image();
      img.onload = function () {
        if (seq !== ratioSeq || destroyed) return;
        var r = img.naturalWidth / img.naturalHeight;
        if (r > 0 && isFinite(r)) setVar('--avatar-ratio', String(Math.round(Math.min(5, Math.max(0.2, r)) * 1000) / 1000));
        onHint(null);
      };
      img.onerror = function () {
        if (seq !== ratioSeq || destroyed) return;
        onHint('The avatar picture didn’t load' + (/^data:/i.test(src) ? '' : ' (' + shortSrc(src) + ')') +
          '. Check that the link opens the picture itself, on https, from a host that lets other sites show it.');
      };
      img.src = src;
    }
    function shortSrc(src) {
      var s = String(src);
      return s.length > 60 ? s.slice(0, 57) + '…' : s;
    }
    // Looks for the picture now and every LOOK_MS while it isn't known (OBS adds a source's Custom CSS once the page has
    // loaded, and a copy started beside a running one draws into a #chat that joins the page later), for LOOK_FOR_MS.
    function look4Picture() {
      lookUntil = now() + LOOK_FOR_MS;
      measure();
      if (!lookTimer) lookTimer = setTimeout(lookAgain, LOOK_MS);
      if (cfg.avatar === 'custom' && !pictures(cfg).idle && !noPictureTimer && !shownSrc) {
        noPictureTimer = setTimeout(function () {
          noPictureTimer = null;
          if (!destroyed && !shownSrc) {
            onHint('Avatar mode has no picture yet. Add one under Avatar mode in the builder’s Advanced tab (avatar_idle), or ' +
              'paste the Custom CSS the builder gives into this source’s properties.');
          }
        }, NO_PICTURE_MS);
      }
    }
    function lookAgain() {
      lookTimer = null;
      if (destroyed) return;
      measure();
      if ((!shownSrc || !rootEl.isConnected) && now() < lookUntil) lookTimer = setTimeout(lookAgain, LOOK_MS);
    }

    // ----- the mouth -----
    function setMouth(open) {
      if (open === mouthOpen) return;
      mouthOpen = open;
      setClass('mouth-open', open);
    }
    function talk(ms) {
      talkUntil = Math.max(talkUntil, now() + ms);
      if (flapTimer) return;
      setMouth(true);
      flapTimer = setInterval(flap, FLAP_MS);
    }
    function flap() {
      if (now() >= talkUntil) { hush(); return; }
      setMouth(!mouthOpen);
    }
    function hush() {
      talkUntil = 0;
      if (flapTimer) { clearInterval(flapTimer); flapTimer = null; }
      setMouth(false);
    }
    function hop() {
      if (rootEl.classList.contains('motion-none')) return;
      speaker.classList.remove('hop');
      void speaker.offsetWidth; // the same animation again starts over only after a style without it
      speaker.classList.add('hop');
    }

    // ----- typing -----
    function segment(text) {
      if (graphemes === undefined) {
        graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
      }
      if (!graphemes) return Array.from(text);
      return Array.from(graphemes.segment(text), function (s) { return s.segment; });
    }
    // A part of a message shown whole as it is typed: an emote (with its zero-width layers), a cheer, a GIF or a
    // picture of any kind.
    function whole(node) {
      var cls = ' ' + (typeof node.className === 'string' ? node.className : node.getAttribute && node.getAttribute('class') || '') + ' ';
      return node.tagName === 'IMG' || /svg/i.test(node.tagName) || / (emote-stack|emote|cheer|gif|badge) /.test(cls) ||
        !!(node.querySelector && node.querySelector('img'));
    }
    var RTL_RE = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
    // The units a line's message is typed in, each hidden until its turn (.tw): every letter (a grapheme) of its text in
    // a span of its own, and every emote, cheer or GIF whole. What comes before the message (a reply's header, the time,
    // the badges and the name) shows at once. A message in right-to-left script shows whole: spans would cut its letters
    // apart.
    function unitsOf(line) {
      var msg = null;
      for (var ch = line.firstElementChild; ch; ch = ch.nextElementSibling) if (ch.classList.contains('message')) msg = ch;
      if (!msg || RTL_RE.test(msg.textContent || '')) return [];
      var out = [];
      var walk = function (node) {
        var kids = Array.prototype.slice.call(node.childNodes);
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (k.nodeType === 3) {
            var t = k.data;
            if (!t) continue;
            var frag = doc.createDocumentFragment();
            var parts = segment(t);
            for (var j = 0; j < parts.length; j++) {
              var s = doc.createElement('span');
              s.className = 'tw';
              s.textContent = parts[j];
              frag.appendChild(s);
              out.push({ el: s, kind: unitKind(parts[j]) });
            }
            node.replaceChild(frag, k);
          } else if (k.nodeType === 1) {
            if (whole(k)) {
              k.classList.add('tw');
              out.push({ el: k, kind: 'emote' });
            } else walk(k);
          }
        }
      };
      walk(msg);
      return out;
    }
    function reveal(u) { u.el.classList.remove('tw'); }

    // A message too long for the room above the bubble's anchor is cut short with an ellipsis, so the bubble never runs
    // off the top of the source: the units that would reach past it are left out. Measured with every unit in place
    // (hidden ones keep their room), in layout px (offsetTop and offsetHeight: the bubble may be scaled as it pops in).
    function fitUnits(units) {
      if (!units.length || !(linesEl.offsetHeight > 0) || typeof units[0].el.offsetTop !== 'number') return units;
      // The bubble keeps its bottom edge: it may be this tall at most.
      var most = linesEl.offsetTop + linesEl.offsetHeight - FIT_MARGIN;
      if (linesEl.offsetHeight <= most) return units;
      var cs = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(linesEl) : null;
      var edgeTop = cs ? parseFloat(cs.borderTopWidth) || 0 : 0;
      var below = cs ? (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0) : 0;
      var cut = -1;
      for (var i = 0; i < units.length; i++) {
        var e = units[i].el;
        if (e.offsetParent !== linesEl) continue; // a part inside a positioned box: measured with that box
        if (edgeTop + e.offsetTop + e.offsetHeight + below > most) { cut = i; break; }
      }
      if (cut < 0) return units;
      // Two units back, to make room for the ellipsis, and back to the end of a word when one ends a little before.
      cut = Math.max(0, cut - 2);
      for (var w = cut - 1; w > 0 && w >= cut - 12; w--) {
        if (units[w].kind === 'space') { cut = w; break; }
      }
      for (var j = cut; j < units.length; j++) units[j].el.classList.add('tw-cut');
      var dots = doc.createElement('span');
      dots.className = 'tw';
      dots.textContent = '…';
      var before = cut > 0 ? units[cut - 1].el : null;
      if (before && before.parentNode) before.parentNode.insertBefore(dots, before.nextSibling);
      else if (units[0].el.parentNode) units[0].el.parentNode.insertBefore(dots, units[0].el);
      return units.slice(0, cut).concat({ el: dots, kind: 'char' });
    }

    // ----- turns -----
    function busy() { return waiting.length > 0; }

    function next() {
      nextTimer = clear(nextTimer);
      if (destroyed || held || cur || hidden()) return;
      var en = waiting.shift();
      if (!en) return;
      cur = { msg: en.msg, born: en.born, shown: !!en.shown, phase: 'draw', lines: [], units: [], at: 0 };
      // Moderated meanwhile, or no longer let through by the filters: the renderer refuses it, and the next goes.
      if (!showable(en.msg) || !inner.push(en.msg)) {
        cur = null;
        nextTimer = setTimeout(next, 0);
        return;
      }
      inner.flush();
      sync();
    }

    // The bubble's lines, whatever drew or took them: the renderer draws the message pushed (at once, or once the page
    // shows again), and takes it away for a moderator.
    function sync() {
      if (!cur || destroyed) return;
      var lines = Array.prototype.slice.call(linesEl.children);
      if (cur.phase === 'draw') {
        if (lines.length) begin(lines);
        return;
      }
      if ((cur.phase === 'type' || cur.phase === 'hold') && !cur.lines.some(function (l) { return l.parentNode === linesEl; })) taken();
    }

    function begin(lines) {
      cur.lines = lines;
      var speed = Number(cfg.bubble_speed) || 0;
      var units = [];
      if (!cur.shown && speed > 0) {
        for (var i = 0; i < lines.length; i++) units = units.concat(unitsOf(lines[i]));
      }
      cur.units = fitUnits(units);
      cur.busy = busy();
      setClass('bubble-cut', false);
      setClass('bubble-on', true);
      setClass('talking', true);
      if (!cur.shown) hop();
      if (cur.units.length) {
        cur.phase = 'type';
        cur.sched = typeSchedule(cur.units.map(function (u) { return u.kind; }), speed, cur.busy);
        cur.t0 = now();
        cur.at = 0;
        tick();
        return;
      }
      // Shown whole: at once (bubble_speed=0, a right-to-left message), or as it was on screen before a restart.
      var n = lines.reduce(function (s, l) {
        var m = l.querySelector ? l.querySelector('.message') : null;
        return s + segment(((m || l).textContent || '').replace(/\s+/g, '')).length;
      }, 0);
      var said = cur.shown ? 0 : talkMs(n, cur.busy);
      if (said > 0) talk(said);
      cur.letters = n;
      typed(said);
    }

    function tick() {
      typeTimer = null;
      if (!cur || cur.phase !== 'type' || destroyed) return;
      // Redrawn while it types (a paint or a badge came in): the new line shows whole, and the bubble holds it.
      if (cur.units[0].el.isConnected === false) {
        cur.letters = letters(cur.units.map(function (u) { return u.kind; }));
        cur.units = [];
        typed(0);
        return;
      }
      var u = cur.units, s = cur.sched, el = now() - cur.t0;
      while (cur.at < u.length && s.at[cur.at] <= el) {
        var x = u[cur.at++];
        reveal(x);
        // The mouth keeps moving a little past each letter, and shuts over a pause.
        if (x.kind === 'char' || x.kind === 'emote') talk(s.base * (x.kind === 'emote' ? EMOTE_UNITS : 1.6));
      }
      if (cur.at >= u.length) {
        cur.letters = letters(u.map(function (v) { return v.kind; }));
        typed(0);
        return;
      }
      typeTimer = setTimeout(tick, Math.max(16, s.at[cur.at] - el));
    }

    // Typed out: the bubble stays its reading time (after the mouth's last words, said ms from now).
    function typed(said) {
      cur.phase = 'hold';
      cur.busy = cur.busy || busy();
      cur.holdAt = now();
      cur.holdFor = (said || 0) + holdMs(cur.letters || 0, cfg, cur.busy);
      holdTimer = clear(holdTimer);
      holdTimer = setTimeout(out, cur.holdFor);
    }

    // Another message came while one is held: that one goes sooner (its busy reading time).
    function hurry() {
      if (!cur || cur.phase !== 'hold' || cur.busy) return;
      cur.busy = true;
      var left = cur.holdAt + Math.min(cur.holdFor, holdMs(cur.letters || 0, cfg, true)) - now();
      holdTimer = clear(holdTimer);
      holdTimer = setTimeout(out, Math.max(0, left));
    }

    function out() {
      holdTimer = clear(holdTimer);
      typeTimer = clear(typeTimer);
      if (!cur) return;
      cur.phase = 'out';
      hush();
      setClass('bubble-on', false);
      setClass('talking', false);
      outTimer = setTimeout(finish, POP_MS);
    }

    function finish() {
      outTimer = null;
      var said = cur && cur.msg;
      cur = null;
      if (said) inner.drop(function (m) { return m === said; });
      if (!destroyed) nextTimer = setTimeout(next, GAP_MS);
    }

    // A moderator took the message (a deletion, a timeout or ban, a clear): the bubble goes at once.
    function taken() {
      typeTimer = clear(typeTimer);
      holdTimer = clear(holdTimer);
      hush();
      setClass('bubble-cut', true);
      setClass('bubble-on', false);
      setClass('talking', false);
      cur = null;
      nextTimer = clear(nextTimer);
      nextTimer = setTimeout(next, GAP_MS);
    }

    // At most bubble_queue messages wait: the oldest go first, but not one shown before a restart (it is on screen).
    function trim() {
      var cap = Math.max(1, Number(cfg.bubble_queue) || 5);
      while (waiting.length > cap) waiting.splice(waiting[0].shown && waiting.length > 1 ? 1 : 0, 1);
    }

    function onShown() { if (!hidden()) next(); }

    if (typeof win.MutationObserver === 'function') {
      mo = new win.MutationObserver(function () { sync(); });
      mo.observe(linesEl, { childList: true });
      if (doc.head) {
        headMo = new win.MutationObserver(function () { measure(); });
        headMo.observe(doc.head, { childList: true });
      }
    }
    doc.addEventListener('visibilitychange', onShown);
    if (win.addEventListener) {
      win.addEventListener('obsSourceVisibleChanged', onShown);
      win.addEventListener('load', measure);
    }

    // ----- the renderer's API -----
    function push(msg) {
      if (destroyed || !msg || typeof msg !== 'object') return false;
      // The avatar says live chat only: the recent lines a reload or a reconnect brings back are noted, not said.
      if (msg.historical) { inner.note(msg); return false; }
      var id = idOf(msg);
      if (id && ((cur && idOf(cur.msg) === id) || waiting.some(function (en) { return idOf(en.msg) === id; }))) return false;
      inner.note(msg);
      if (!showable(msg)) return false;
      waiting.push({ msg: msg, born: now() });
      trim();
      hurry();
      next();
      return true;
    }

    function setConfig(next0) {
      if (destroyed) return;
      cfg = next0 || {};
      inner.setConfig(innerCfg(cfg));
      applyLook(cfg);
      waiting = waiting.filter(function (en) { return showable(en.msg); });
      trim();
      sync(); // a filter turned on may have taken the line being said
    }

    function forget(pred) { waiting = waiting.filter(function (en) { return !pred(en.msg); }); }

    function clearMessage(msgId, altId) {
      var ids = [util.idStr(msgId), util.idStr(altId)].filter(Boolean);
      if (!ids.length || destroyed) return;
      forget(function (m) { return ids.indexOf(idOf(m)) >= 0 || ids.indexOf(util.idStr(m.sourceId)) >= 0; });
      if (altId === undefined) inner.clearMessage(msgId); else inner.clearMessage(msgId, altId);
      sync();
    }

    function clearUser(userId) {
      var uid = util.idStr(userId);
      if (!uid || destroyed) return;
      forget(function (m) { return util.idStr(m.userId) === uid; });
      inner.clearUser(userId);
      sync();
    }

    function clearAll(pred) {
      if (destroyed) return;
      if (typeof pred === 'function') forget(function (m) { return covers(pred, m); });
      else waiting = [];
      inner.clearAll(pred);
      sync();
    }

    function drop(pred) {
      if (destroyed || typeof pred !== 'function') return;
      forget(function (m) { return covers(pred, m); });
      inner.drop(pred);
      sync();
    }

    // The renderer redraws the message being said; a waiting one is drawn as it is when its turn comes. pred sees
    // those too (overlay.js walks the messages on screen with it: their rooms stay loaded, their chatters looked up).
    function rerender(pred) {
      if (destroyed) return 0;
      if (typeof pred === 'function') waiting.forEach(function (en) { covers(pred, en.msg); });
      var n = inner.rerender(pred);
      sync();
      return n;
    }

    function hold(on) {
      if (destroyed) return;
      held = !!on;
      inner.hold(on);
      sync();
      if (!held) next();
    }

    function hasUser(userId) {
      var uid = util.idStr(userId);
      if (!uid) return false;
      return inner.hasUser(userId) || waiting.some(function (en) { return util.idStr(en.msg.userId) === uid; });
    }

    // An update restarts the overlay in place (overlay.js): the message being said comes first (speaking: it is in the
    // bubble, so the new copy shows it as it is, untyped), then the ones waiting.
    function snapshot() {
      var out = [];
      if (cur && cur.phase !== 'out') {
        inner.snapshot().forEach(function (en, i) {
          if (i === 0) en.speaking = true;
          out.push(en);
        });
      }
      waiting.forEach(function (en) { out.push({ msg: en.msg, born: en.born }); });
      return out;
    }

    // The other copy's messages (snapshot) take their turns before the ones that came here meanwhile; of those, only
    // what is newer than its newest stays (it had the rest). Its moderation goes to the renderer, which refuses a
    // message deleted since when its turn comes. Returns how many were taken.
    function adopt(list, mod, down) {
      if (destroyed || !Array.isArray(list)) return 0;
      inner.adopt([], mod, down);
      var t = now(), last = 0, ids = new Set(), took = [];
      list.forEach(function (en) {
        var msg = en && en.msg;
        if (!msg || typeof msg !== 'object' || msg.historical) return;
        var born = Number(en.born);
        born = isFinite(born) && born > 0 ? Math.min(born, t) : t;
        if (born > last) last = born;
        var id = idOf(msg);
        if (id && ids.has(id)) return;
        inner.note(msg);
        if (!showable(msg)) return;
        if (id) ids.add(id);
        took.push({ msg: msg, born: born, shown: en.speaking === true });
      });
      waiting = took.concat(waiting.filter(function (en) {
        var id = idOf(en.msg);
        return en.born > last && !(id && ids.has(id));
      }));
      trim();
      next();
      return took.length;
    }

    function stats() {
      var s = inner.stats();
      s.queued += waiting.length;
      s.waiting = waiting.length;
      s.saying = cur ? cur.phase : '';
      return s;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      [nextTimer, typeTimer, holdTimer, outTimer, lookTimer, noPictureTimer].forEach(function (t) { if (t) clearTimeout(t); });
      hush();
      if (mo) mo.disconnect();
      if (headMo) headMo.disconnect();
      doc.removeEventListener('visibilitychange', onShown);
      if (win.removeEventListener) {
        win.removeEventListener('obsSourceVisibleChanged', onShown);
        win.removeEventListener('load', measure);
      }
      waiting = [];
      cur = null;
      inner.destroy();
      if (speaker.parentNode) speaker.parentNode.removeChild(speaker);
      ['has-avatar', 'avatar-left', 'avatar-right', 'bubble-side', 'bubble-above', 'avatar-flip', 'motion-bounce',
        'motion-lively', 'motion-none', 'bubble-on', 'bubble-cut', 'talking', 'mouth-open'].forEach(function (k) { setClass(k, false); });
      ['--avatar-idle', '--avatar-talk', '--avatar-size', '--avatar-ratio', '--bubble-w', '--bubble-color', '--bubble-ink',
        '--bubble-notice'].forEach(function (v) { rootEl.style.removeProperty(v); });
    }

    applyLook(cfg);

    return {
      push: push,
      note: function (msg) { if (!destroyed) inner.note(msg); },
      clearUser: clearUser,
      clearMessage: clearMessage,
      clearAll: clearAll,
      drop: drop,
      stillReady: function (id) { if (!destroyed) inner.stillReady(id); },
      repaint: function (ids) { if (!destroyed) inner.repaint(ids); },
      rerender: rerender,
      setConfig: setConfig,
      hold: hold,
      flush: function () {
        if (destroyed) return;
        inner.flush();
        sync();
      },
      refilter: function () {
        if (destroyed) return;
        waiting = waiting.filter(function (en) { return showable(en.msg); });
        inner.refilter();
        sync();
      },
      hasUser: hasUser,
      snapshot: snapshot,
      moderation: function () { return inner.moderation(); },
      adopt: adopt,
      stats: stats,
      destroy: destroy
    };
  }

  // Whether cfg turns avatar mode on.
  function isOn(cfg) { return !!cfg && typeof cfg.avatar === 'string' && cfg.avatar !== 'off' && cfg.avatar !== ''; }

  // The live settings setConfig applies here, around the renderer (the builder's preview changes them in place). avatar
  // itself isn't one: it picks this or the plain renderer, so changing it reloads.
  var LIVE_KEYS = ['avatar_idle', 'avatar_talk', 'avatar_size', 'avatar_side', 'avatar_flip', 'avatar_motion', 'bubble_pos',
    'bubble_width', 'bubble_color', 'bubble_speed', 'bubble_time', 'bubble_queue'];

  return {
    createAvatar: createAvatar,
    isOn: isOn,
    PRESETS: PRESETS,
    LIVE_KEYS: LIVE_KEYS,
    _internal: {
      INNER: INNER,
      FLAP_MS: FLAP_MS,
      POP_MS: POP_MS,
      GAP_MS: GAP_MS,
      TYPE_MAX_MS: TYPE_MAX_MS,
      READ_MIN_MS: READ_MIN_MS,
      BUSY_MIN_MS: BUSY_MIN_MS,
      TALK_MAX_MS: TALK_MAX_MS,
      EMOTE_UNITS: EMOTE_UNITS,
      innerCfg: innerCfg,
      pictures: pictures,
      cssUrl: cssUrl,
      bubbleLook: bubbleLook,
      unitKind: unitKind,
      typeSchedule: typeSchedule,
      letters: letters,
      holdMs: holdMs,
      talkMs: talkMs
    }
  };
});
