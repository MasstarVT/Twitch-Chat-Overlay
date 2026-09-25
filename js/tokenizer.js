/* Message text -> render tokens (Twitch emote ranges, 3rd-party emotes, zero-width, modifiers, cheers, GIFs). Pure. */
(function (root, factory) {
  var ircParse = typeof require === 'function' ? require('./irc-parse.js') : root.TCO.ircParse;
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, ircParse, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).tokenizer = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, ircParse, util) {
  'use strict';

  var TWITCH_EMOTE_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
  var GIPHY_HOST_RE = /(^|\.)giphy\.com$/;

  // Global cheermote prefixes verified to exist on the public cheer CDN (2026-09).
  var CHEER_PREFIXES = ['cheerwhal', 'cheer', 'doodlecheer', 'corgo', 'pride', 'party', 'seemsgood', 'kappa',
    'frankerz', 'uni', 'showlove', 'anon', '4head', 'notlikethis', 'swiftrage', 'muxy', 'streamlabs',
    'vohiyo', 'mrdestructoid', 'bday', 'ripcheer', 'shamrock', 'kreygasm', 'trihard', 'heyguys'];
  var CHEER_100K = { cheer: true, doodlecheer: true, anon: true };
  var CHEER_RE = new RegExp('^(' + CHEER_PREFIXES.join('|') + ')(\\d+)$', 'i');
  var TIER_COLORS = { 1: '#979797', 100: '#9C3EE8', 1000: '#1DB2A5', 5000: '#0099FE', 10000: '#F43021', 100000: '#F3A71A' };

  // BTTV prefix modifiers -> effects applied to the following emote.
  var BTTV_PREFIX_FX = {
    'h!': { sx: -1 }, 'v!': { sy: -1 }, 'w!': { grow: true }, 'c!': { cursed: true },
    'l!': { rot: -90 }, 'r!': { rot: 90 }, 'z!': { zs: true }, 'p!': {}, 's!': {}
  };
  var BTTV_PREFIXES = Object.keys(BTTV_PREFIX_FX);

  // FFZ modifier_flags bits we render (static effects only).
  var FFZ_HIDDEN = 1, FFZ_FLIP_X = 2, FFZ_FLIP_Y = 4, FFZ_GROW_X = 8, FFZ_CURSED = 16384;

  function twitchEmote(id, name) {
    var base = 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/default/dark/';
    return { provider: 'twitch', id: id, name: name, w: 28, h: 28, urls: { 1: base + '1.0', 2: base + '2.0', 4: base + '3.0' } };
  }

  function cheerFor(word) {
    var m = CHEER_RE.exec(word);
    if (!m) return null;
    var amount = parseInt(m[2], 10);
    if (!(amount >= 1)) return null;
    var prefix = m[1].toLowerCase();
    var tiers = CHEER_100K[prefix] ? [1, 100, 1000, 5000, 10000, 100000] : [1, 100, 1000, 5000, 10000];
    var tier = 1;
    for (var i = 0; i < tiers.length; i++) if (amount >= tiers[i]) tier = tiers[i];
    var base = 'https://d3aqoihi2n8ty8.cloudfront.net/actions/' + prefix + '/dark/animated/' + tier + '/';
    return {
      type: 'cheer',
      prefix: m[1],
      amount: amount,
      tier: tier,
      color: TIER_COLORS[tier] || TIER_COLORS[1],
      urls: { 1: base + '1.gif', 2: base + '2.gif', 3: base + '3.gif', 4: base + '4.gif' },
      text: word
    };
  }

  function cleanText(text, action) {
    var t = text || '';
    var a = !!action;
    if (!a) {
      var s = ircParse.stripAction(t);
      t = s.text;
      a = s.action;
    }
    t = t.replace(/ ?\u034F$/, '');         // 7TV/Chatterino duplicate-bypass suffix (U+034F)
    t = t.replace(/\u{E0002}/gu, '\u200D'); // Chatterino-escaped ZWJ (U+E0002) -> real ZWJ
    return { text: t, action: a };
  }

  function mergeFx(fx, add) {
    fx = fx || { sx: 1, sy: 1, rot: 0, grow: false, cursed: false, zs: false };
    if (add.sx) fx.sx *= add.sx;
    if (add.sy) fx.sy *= add.sy;
    if (add.rot) fx.rot = add.rot;
    if (add.grow) fx.grow = true;
    if (add.cursed) fx.cursed = true;
    if (add.zs) fx.zs = true;
    return fx;
  }

  function ffzFx(flags) {
    var add = {};
    if (flags & FFZ_FLIP_X) add.sx = -1;
    if (flags & FFZ_FLIP_Y) add.sy = -1;
    if (flags & FFZ_GROW_X) add.grow = true;
    if (flags & FFZ_CURSED) add.cursed = true;
    return add;
  }

  // msg: { text, action, emotes, gifs, bits, msgId }
  // opts: { lookup(word) -> emote|null, bttvPrefixes: Set, gifs: bool, cheers: bool }
  // Emote objects: { provider, id, name, zw, hidden, flags, w, h, urls }
  function tokenize(msg, opts) {
    opts = opts || {};
    var cleaned = cleanText(msg.text, msg.action);
    var cps = Array.from(cleaned.text);
    var ranges = [];
    var emoteRanges = ircParse.parseEmotesTag(msg.emotes);
    for (var i = 0; i < emoteRanges.length; i++) {
      var er = emoteRanges[i];
      if (er.end < cps.length && TWITCH_EMOTE_ID_RE.test(er.id)) ranges.push({ start: er.start, end: er.end, kind: 'twitch', id: er.id });
    }
    if (opts.gifs !== false && msg.gifs) {
      var gifs = ircParse.parseGifsTag(msg.gifs);
      for (var g = 0; g < gifs.length; g++) {
        var gr = gifs[g];
        if (gr.end < cps.length && util.isSafeUrl(gr.url, GIPHY_HOST_RE)) {
          ranges.push({ start: gr.start, end: gr.end, kind: 'gif', url: gr.url });
        }
      }
    }
    ranges.sort(function (a, b) { return a.start - b.start; });

    // 1) Split into pieces: words and ranges, each with a "preceded by space" flag.
    var pieces = [];
    var pendingSpace = false;
    function pushWords(str) {
      var parts = str.split(' ');
      for (var k = 0; k < parts.length; k++) {
        if (k > 0) pendingSpace = true;
        if (parts[k] === '') continue;
        pieces.push({ kind: 'word', text: parts[k], sp: pendingSpace });
        pendingSpace = false;
      }
    }
    var pos = 0;
    for (var r = 0; r < ranges.length; r++) {
      var rg = ranges[r];
      if (rg.start < pos) continue; // overlapping range
      if (rg.start > pos) pushWords(cps.slice(pos, rg.start).join(''));
      pieces.push({ kind: rg.kind, range: rg, text: cps.slice(rg.start, rg.end + 1).join(''), sp: pendingSpace });
      pendingSpace = false;
      pos = rg.end + 1;
    }
    if (pos < cps.length) pushWords(cps.slice(pos).join(''));

    // 2) Resolve pieces into items.
    var items = [];
    var lastEmote = null;
    var pendingPrefix = [];
    var prefixSet = opts.bttvPrefixes || null;
    var cheersOn = opts.cheers !== false && msg.bits > 0;

    function emitText(word, sp) {
      var last = items[items.length - 1];
      if (last && last.type === 'text') last.text += (sp ? ' ' : '') + word;
      else items.push({ type: 'text', text: word, sp: sp });
      lastEmote = null;
    }
    function flushPrefixes() {
      for (var p = 0; p < pendingPrefix.length; p++) emitText(pendingPrefix[p].word, pendingPrefix[p].sp);
      pendingPrefix = [];
    }
    function handleEmote(e, sp) {
      if (e.hidden) {
        if (lastEmote && !pendingPrefix.length) {
          lastEmote.fx = mergeFx(lastEmote.fx, ffzFx(e.flags || 0));
          return;
        }
      } else if (e.zw && lastEmote && !pendingPrefix.length) {
        lastEmote.overlays.push(e);
        return;
      }
      var item = { type: 'emote', emote: e, overlays: [], fx: null, big: false, sp: sp };
      if (pendingPrefix.length) {
        item.sp = pendingPrefix[0].sp;
        for (var p = 0; p < pendingPrefix.length; p++) item.fx = mergeFx(item.fx, BTTV_PREFIX_FX[pendingPrefix[p].word] || {});
        pendingPrefix = [];
      }
      items.push(item);
      lastEmote = item;
    }

    for (var j = 0; j < pieces.length; j++) {
      var pc = pieces[j];
      if (pc.kind === 'twitch') {
        handleEmote(twitchEmote(pc.range.id, pc.text), pc.sp);
        continue;
      }
      if (pc.kind === 'gif') {
        flushPrefixes();
        items.push({ type: 'gif', url: pc.range.url, title: pc.text, sp: pc.sp });
        lastEmote = null;
        continue;
      }
      var w = pc.text;
      if (prefixSet && prefixSet.has(w) && BTTV_PREFIX_FX[w]) {
        pendingPrefix.push({ word: w, sp: pc.sp });
        continue;
      }
      if (cheersOn) {
        var ch = cheerFor(w);
        if (ch) {
          flushPrefixes();
          ch.sp = pc.sp;
          items.push(ch);
          lastEmote = null;
          continue;
        }
      }
      var em = opts.lookup ? opts.lookup(w) : null;
      if (em) { handleEmote(em, pc.sp); continue; }
      flushPrefixes();
      emitText(w, pc.sp);
    }
    flushPrefixes();

    if (msg.msgId === 'gigantified-emote-message') {
      for (var b = items.length - 1; b >= 0; b--) {
        if (items[b].type === 'emote' && items[b].emote.provider === 'twitch') { items[b].big = true; break; }
      }
    }
    if (items.length) items[0].sp = false;
    return { items: items, action: cleaned.action };
  }

  // Remove a leading "@ParentName " from a reply, after tokenizing (Twitch emote indices include it).
  function stripReplyPrefix(items, reply) {
    if (!reply || !items.length || items[0].type !== 'text') return items;
    var first = items[0];
    var lower = first.text.toLowerCase();
    var names = [reply.name, reply.login].filter(Boolean).map(function (n) { return '@' + String(n).toLowerCase(); });
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (lower.indexOf(n) === 0 && (lower.length === n.length || lower[n.length] === ' ')) {
        var rest = first.text.slice(n.length).replace(/^ /, '');
        if (rest) {
          first.text = rest;
        } else {
          items.shift();
          if (items.length) items[0].sp = false;
        }
        break;
      }
    }
    return items;
  }

  // Plain text of a token list (for filters and alt text).
  function plainText(items) {
    var out = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (i > 0 && it.sp) out += ' ';
      out += it.type === 'text' ? it.text : it.type === 'emote' ? it.emote.name : it.type === 'gif' ? it.title : it.text;
    }
    return out;
  }

  return {
    tokenize: tokenize,
    stripReplyPrefix: stripReplyPrefix,
    plainText: plainText,
    cleanText: cleanText,
    cheerFor: cheerFor,
    twitchEmote: twitchEmote,
    CHEER_PREFIXES: CHEER_PREFIXES,
    BTTV_PREFIXES: BTTV_PREFIXES,
    TIER_COLORS: TIER_COLORS
  };
});
