/* Message text -> render tokens (Twitch and Kick emote ranges, 3rd-party emotes, zero-width, modifiers, cheers, GIFs). Pure. */
(function (root, factory) {
  var ircParse = typeof require === 'function' ? require('./irc-parse.js') : root.TCO.ircParse;
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var api = factory(root, ircParse, util);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).tokenizer = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, ircParse, util) {
  'use strict';

  var TWITCH_EMOTE_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
  var KICK_EMOTE_ID_RE = /^\d{1,12}$/;
  var GIPHY_HOST_RE = /(^|\.)giphy\.com$/;
  // Giphy's 'original' rendition (the gifs tag's URL) is the uploaded file at any size. Swap it for the
  // 200 px fixed-height rendition (util.giphyFile; only the known shape), still taller than the box at every `size`
  // (<= 168 px). A GIF that text_px, emote_scale or gif_size draws taller loads the original as WebP instead
  // (renderer.js partsFor, from orig).

  // Hostile-input bounds, far above anything real Twitch chat can send (500 characters per message):
  // text past MAX_CPS code points is dropped, at most MAX_IMAGES images (emote bases, zero-width
  // layers, GIFs and cheermotes) per message, at most MAX_ZW zero-width layers on one emote.
  var MAX_CPS = 1000, MAX_IMAGES = 300, MAX_ZW = 4;

  // Twitch's global cheermote prefixes (Twitch GQL cheerConfig, 2026-10), each on the public cheer CDN. 'pride' is the
  // older name of PrideCheer, which the CDN still serves. Only Cheer and DoodleCheer have a 100000 tier.
  var CHEER_PREFIXES = ['cheerwhal', 'cheer', 'doodlecheer', 'corgo', 'pride', 'pridecheer', 'party', 'seemsgood', 'kappa',
    'frankerz', 'uni', 'showlove', 'anon', '4head', 'notlikethis', 'swiftrage', 'muxy', 'streamlabs',
    'vohiyo', 'mrdestructoid', 'bday', 'ripcheer', 'shamrock', 'kreygasm', 'trihard', 'heyguys', 'dansgame', 'failfish',
    'pjsalt', 'bitboss', 'holidaycheer', 'goal', 'scoops'];
  var CHEER_100K = { cheer: true, doodlecheer: true };
  var CHEER_RE = new RegExp('^(' + CHEER_PREFIXES.join('|') + ')(\\d{1,7})$', 'i'); // <= 9,999,999 bits
  var TIER_COLORS = { 1: '#979797', 100: '#9C3EE8', 1000: '#1DB2A5', 5000: '#0099FE', 10000: '#F43021', 100000: '#F3A71A' };

  // BTTV prefix modifiers -> effects applied to the following emote.
  var BTTV_PREFIX_FX = {
    'h!': { sx: -1 }, 'v!': { sy: -1 }, 'w!': { grow: true }, 'c!': { cursed: true },
    'l!': { rot: -90 }, 'r!': { rot: 90 }, 'z!': { zs: true }, 'p!': {}, 's!': {}
  };
  var BTTV_PREFIXES = Object.keys(BTTV_PREFIX_FX);
  var hasOwn = Object.prototype.hasOwnProperty; // chat words like 'constructor' are not prefixes

  // FFZ modifier_flags bits we render (static effects only).
  var FFZ_HIDDEN = 1, FFZ_FLIP_X = 2, FFZ_FLIP_Y = 4, FFZ_GROW_X = 8, FFZ_CURSED = 16384;

  function twitchEmote(id, name) {
    var base = 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/default/dark/';
    return { provider: 'twitch', id: id, name: name, w: 28, h: 28, urls: { 1: base + '1.0', 2: base + '2.0', 4: base + '3.0' } };
  }

  // Kick serves one size per emote; the URL is built from the digit id only.
  function kickEmote(id, name) {
    var url = 'https://files.kick.com/emotes/' + id + '/fullsize';
    return { provider: 'kick', id: id, name: name, w: 28, h: 28, urls: { 1: url, 2: url, 4: url } };
  }

  // A channel's own cheermote (twitchBadges.loadCheermotes' map: lower-case prefix -> {prefix, tiers, template}): the
  // longest prefix in the map that the word starts with, followed by 1-7 digits (a prefix may end in a digit itself).
  var CHEER_SLOTS_RE = /\b(?:PREFIX|TIER|BACKGROUND|ANIMATION|SCALE|EXTENSION)\b/g;
  function customCheer(word, map) {
    var m = word.length <= 40 ? /^([A-Za-z0-9]*?)(\d+)$/.exec(word) : null;
    if (!m) return null;
    var digits = m[2];
    for (var k = digits.length - 1; k >= 0; k--) {
      var amountText = digits.slice(k);
      if (amountText.length > 7) break;
      var prefix = m[1] + digits.slice(0, k);
      var e = prefix ? map.get(prefix.toLowerCase()) : null;
      if (!e) continue;
      var amount = parseInt(amountText, 10);
      if (!(amount >= 1)) return null;
      var tier = e.tiers[0];
      for (var i = 0; i < e.tiers.length; i++) if (amount >= e.tiers[i]) tier = e.tiers[i];
      var urls = {};
      [1, 2, 3, 4].forEach(function (scale) {
        var vals = { PREFIX: prefix.toLowerCase(), TIER: tier, BACKGROUND: 'dark', ANIMATION: 'animated', SCALE: scale, EXTENSION: 'gif' };
        urls[scale] = e.template.replace(CHEER_SLOTS_RE, function (slot) { return String(vals[slot]); });
      });
      return { type: 'cheer', prefix: prefix, amount: amount, tier: tier, color: tierColor(tier), urls: urls, text: word };
    }
    return null;
  }

  // Twitch colors an amount by the highest of its color steps the tier reaches (a channel's tiers may be other numbers).
  var COLOR_STEPS = [1, 100, 1000, 5000, 10000, 100000];
  function tierColor(tier) {
    var c = 1;
    for (var i = 0; i < COLOR_STEPS.length; i++) if (tier >= COLOR_STEPS[i]) c = COLOR_STEPS[i];
    return TIER_COLORS[c];
  }

  // Whether a bits message's text has a word that looks like a cheer (letters and digits, ending in digits) that no global
  // cheermote is: the channel's own cheermotes are looked up for it (overlay.js), once per channel.
  function unknownCheers(text) {
    var words = typeof text === 'string' ? text.slice(0, 2000).split(' ') : [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length <= 40 && /^[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*\d$/.test(w) && !CHEER_RE.test(w)) return true;
    }
    return false;
  }

  // map: a channel's own cheermotes (optional), looked up first.
  function cheerFor(word, map) {
    if (map && map.size) {
      var own = customCheer(word, map);
      if (own) return own;
    }
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
    // Chatterino's and 7TV's newer one, ' U+E0000' (twice on some repeats): its space was drawn, so a repeated message
    // ended a space wider (past a box's edge, or wrapped onto an empty line). Only U+E0000: other invisible characters at
    // the end (an emoji's U+FE0F, a flag's tag characters) are part of what was said.
    t = t.replace(/(?: ?\u{E0000})+$/u, '');
    t = t.replace(/\u{E0002}/gu, '\u200D'); // Chatterino-escaped ZWJ (U+E0002) -> real ZWJ
    return { text: t, action: a };
  }

  function mergeFx(fx, add) {
    fx = fx || { sx: 1, sy: 1, rot: 0, grow: false, cursed: false, zs: false };
    if (add.sx) fx.sx = -1; // flips are flags (FFZ ORs them, BTTV sets a class): a repeat keeps them
    if (add.sy) fx.sy = -1;
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

  function smallGif(url) {
    return util.giphyFile(url, '200.webp') || url;
  }

  // msg: { text, action, emotes, kickEmotes (Kick emote ranges, in the emotes tag format), gifs, bits, msgId }
  // opts: { lookup(word) -> emote|null, bttvPrefixes: Set, gifs: bool, cheers: bool, cheerMap: the channel's own cheermotes }
  // Emote objects: { provider, id, name, zw, hidden, flags, w, h, urls }
  function tokenize(msg, opts) {
    opts = opts || {};
    var cleaned = cleanText(msg.text, msg.action);
    var gifsOn = opts.gifs !== false && !!msg.gifs;
    // Code points are only needed to map Twitch/Kick/GIF ranges, or to cut an over-long (history) text.
    var cps = msg.emotes || msg.kickEmotes || gifsOn || cleaned.text.length > MAX_CPS ? Array.from(cleaned.text) : null;
    if (cps && cps.length > MAX_CPS) cps.length = MAX_CPS;
    var ranges = [];
    var emoteRanges = ircParse.parseEmotesTag(msg.emotes);
    for (var i = 0; i < emoteRanges.length; i++) {
      var er = emoteRanges[i];
      if (er.end < cps.length && TWITCH_EMOTE_ID_RE.test(er.id)) ranges.push({ start: er.start, end: er.end, kind: 'twitch', id: er.id });
    }
    var kickRanges = ircParse.parseEmotesTag(msg.kickEmotes);
    for (var q = 0; q < kickRanges.length; q++) {
      var kr = kickRanges[q];
      if (kr.end < cps.length && KICK_EMOTE_ID_RE.test(kr.id)) ranges.push({ start: kr.start, end: kr.end, kind: 'kick', id: kr.id });
    }
    if (gifsOn) {
      var gifs = ircParse.parseGifsTag(msg.gifs);
      for (var g = 0; g < gifs.length; g++) {
        var gr = gifs[g];
        if (gr.end < cps.length && util.isSafeUrl(gr.url, GIPHY_HOST_RE)) {
          ranges.push({ start: gr.start, end: gr.end, kind: 'gif', url: smallGif(gr.url), orig: gr.url });
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
    if (!cps) pushWords(cleaned.text);
    else if (pos < cps.length) pushWords(cps.slice(pos).join(''));

    // 2) Resolve pieces into items.
    var items = [];
    var lastEmote = null;
    var pendingPrefix = [];
    var prefixSet = opts.bttvPrefixes || null;
    var cheersOn = opts.cheers !== false && msg.bits > 0;
    var images = 0; // images so far: emotes, layers, GIFs, cheermotes (MAX_IMAGES)

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
        if (lastEmote.overlays.length < MAX_ZW && images < MAX_IMAGES) { lastEmote.overlays.push(e); images++; }
        return; // extra layers are dropped
      }
      if (images >= MAX_IMAGES) return false; // caller shows the word as text
      images++;
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
      if (pc.kind === 'twitch' || pc.kind === 'kick') {
        var native = pc.kind === 'kick' ? kickEmote(pc.range.id, pc.text) : twitchEmote(pc.range.id, pc.text);
        if (handleEmote(native, pc.sp) === false) { flushPrefixes(); emitText(pc.text, pc.sp); }
        continue;
      }
      if (pc.kind === 'gif') {
        flushPrefixes();
        if (images >= MAX_IMAGES) { emitText(pc.text, pc.sp); continue; }
        images++;
        items.push({ type: 'gif', url: pc.range.url, orig: pc.range.orig, title: pc.text, sp: pc.sp });
        lastEmote = null;
        continue;
      }
      var w = pc.text;
      if (prefixSet && prefixSet.has(w) && hasOwn.call(BTTV_PREFIX_FX, w)) {
        pendingPrefix.push({ word: w, sp: pc.sp });
        continue;
      }
      if (cheersOn && images < MAX_IMAGES) {
        var ch = cheerFor(w, opts.cheerMap);
        if (ch) {
          flushPrefixes();
          ch.sp = pc.sp;
          images++;
          items.push(ch);
          lastEmote = null;
          continue;
        }
      }
      var em = opts.lookup ? opts.lookup(w) : null;
      if (em && handleEmote(em, pc.sp) !== false) continue;
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
    unknownCheers: unknownCheers,
    twitchEmote: twitchEmote,
    kickEmote: kickEmote,
    CHEER_PREFIXES: CHEER_PREFIXES,
    BTTV_PREFIXES: BTTV_PREFIXES,
    TIER_COLORS: TIER_COLORS
  };
});
