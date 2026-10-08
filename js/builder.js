/* Config builder: form generated from config.SPEC, live preview iframe, overlay URL and settings.js output. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var config = typeof require === 'function' ? require('./config.js') : root.TCO.config;
  var kick = typeof require === 'function' ? require('./kick.js') : root.TCO.kick;
  var api = factory(root, util, config, kick);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).builder = api;
  if (typeof document !== 'undefined' && document.getElementById && !root.TCO_NO_AUTOBOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.start(); });
    else api.start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, config, kick) {
  'use strict';

  var IVR_USER = 'https://api.ivr.fi/v2/twitch/user?login=';
  var AVATAR_HOST_RE = /(^|\.)jtvnw\.net$/;
  var RELOAD_DELAY = 800;
  var FLASH_MS = 1600;
  var STORE_CFG = 'tco-builder-cfg';
  var STORE_UI = 'tco-builder-ui';
  var STORE_FILE_BASE = 'tco-builder-file:'; // + folder path: the settings.js last loaded from there
  var STORE_CFG_PATH = 'tco-builder-cfg-path'; // file: only: the folder whose builder saved STORE_CFG
  var HIDDEN_GRACE = 60000; // a live preview left in a hidden tab disconnects after this (ms)
  var BACKDROPS = ['dark', 'light', 'checker', 'busy'];
  var SIZE_LIMITS = { w: [100, 3840], h: [100, 2160] };
  var RAIL_FADE = 24; // px: the rail's faded edge where it scrolls (css/builder.css .rail.more-below)
  var OBS_SECTION = 'obs'; // the one section that isn't a group of settings (its markup is in builder.html)
  var UI_DEFAULTS = { w: 450, h: 700, backdrop: 'dark', section: 'look' };
  // Suggested OBS source size per layout: a column, or a full-width bar on a 1080p canvas.
  var LAYOUT_SIZES = { vertical: { w: 450, h: 700 }, horizontal: { w: 1920, h: 100 } };
  // The window that gets the app layout (css/builder.css uses the same query). Any other is one scrolling column.
  var APP_LAYOUT = '(min-width: 1100px) and (min-height: 600px)';

  // Font suggestions live in config.js, which the overlay shares (config.canonicalFont uses them).
  var GOOGLE_FONTS = config.GOOGLE_FONTS;
  var SYSTEM_FONT_NAMES = config.SYSTEM_FONT_NAMES;

  // A badge source only applies while badges are on (META.when), and so on.
  function badgesOn(cfg) { return !!cfg.badges; }
  function bgOn(cfg) { return cfg.bg > 0; }
  function namesOn(cfg) { return !!cfg.names; }
  function eventsOn(cfg) { return !!cfg.events; }
  function firstMsgOn(cfg) { return !!cfg.first_msg; }

  // text_weight and name_weight: six steps from light to black, on a slider (a row of six choices wraps
  // unevenly on a phone).
  var WEIGHT_LABELS = { light: 'Light', regular: 'Regular', semibold: 'Semi-bold', bold: 'Bold', heavy: 'Heavy', black: 'Black' };

  // Human labels and help text per config key. Widgets default from SPEC types.
  // logo: a provider logo drawn by css/builder.css (.logo-<name>).
  // when(cfg): the field only applies while this is true; only: 'vertical' or 'horizontal', the one layout it
  // applies to. Either way it is greyed out (syncDisabled) and keeps its value.
  // wrap: a segmented field whose labels may wrap in a narrow panel (like Add to OBS's two routes).
  // swatch: a color field's built-in color, which its picker shows while the setting is '' (Default).
  var META = {
    kick: { label: 'Kick channel', logo: 'kick', check: true, placeholder: 'yourname or a kick.com link',
      bad: 'That isn’t a valid Kick name. Use letters, numbers, _ and - only.',
      help: 'Adds this Kick channel’s chat to the overlay, with the Twitch channel above or on its own.' },
    kick_room: { label: 'Kick chatroom id', placeholder: 'Check fills this in', parse: 'kickRoom',
      bad: 'Use the number only, or paste the whole channel page.',
      help: 'Kick’s chat needs this number. Check fills it in when Kick allows the lookup. If it doesn’t, open the link Check shows, and paste that whole page (or the number after "chatroom":{"id":) here.' },
    platform_icons: { label: 'Show a Twitch or Kick icon on each message',
      help: 'Only when both a Twitch and a Kick channel are set. Shows even with badges off.' },
    size: { label: 'Text size', options: { small: 'Small', medium: 'Medium', large: 'Large' } },
    font: { label: 'Font', help: 'Any Google Fonts family, or a font installed on the streaming PC (Arial, Segoe UI…).' },
    text_weight: { label: 'Text weight', widget: 'range', options: WEIGHT_LABELS,
      help: 'Message and notice text. Light and Black load one more weight of the font; a font without it draws the nearest.' },
    text_color: { label: 'Text color', swatch: '#ffffff',
      help: 'Message text, white by default. Names, /me messages and notices keep their own colors.' },
    line_height: { label: 'Line spacing', widget: 'stepper', step: 5, unit: '%',
      help: 'Line height as a share of the text size (135% by default). Below about 115% emotes reach into the next line. In a row it sets the row’s height.' },
    text_case: { label: 'Letter case', options: { none: 'As typed', upper: 'UPPER', lower: 'lower', smallcaps: 'Small caps' },
      wrap: true, help: 'Names, messages and reply headers. Emotes work either way.' },
    shadow: { label: 'Text shadow', widget: 'seg', names: ['None', 'Light', 'Medium', 'Strong'] },
    names: { label: 'Show names',
      help: 'Off hides the name and colon before each message. Reply headers and sub or raid notices keep their names.' },
    name_weight: { label: 'Name weight', widget: 'range', options: WEIGHT_LABELS,
      help: 'Names before messages and in reply headers. A name inside a sub or raid notice follows Text weight (Look).' },
    name_line: { label: 'Name on its own line', only: 'vertical', when: namesOn,
      help: 'Each message starts on a new line under the name. Vertical layout only, with Show names on (Advanced).' },
    bg: { label: 'Line background', widget: 'range', unit: '%', zero: 'Off',
      help: 'A rounded box behind each message, black unless you pick a Box color. Helps on bright or busy scenes.' },
    bg_color: { label: 'Box color', swatch: '#000000', when: bgOn,
      help: 'Black by default. A light box needs a dark Text color (and Notice text color, in Advanced). Needs Line background (Look).' },
    bg_shape: { label: 'Box corners', options: { square: 'Square', soft: 'Soft', round: 'Round', pill: 'Pill' }, when: bgOn,
      help: 'Pill gives a one-line box round ends. Needs Line background (Look).' },
    bg_width: { label: 'Box width', options: { fit: 'Fit the text', full: 'Full width' }, when: bgOn, only: 'vertical',
      help: 'Full width makes every box as wide as the column. Vertical layout only, with Line background on (Look).' },
    spacing: { label: 'Space between messages', options: { tight: 'Tight', normal: 'Normal', loose: 'Loose', extra: 'Extra' },
      help: 'In a column, the space above and below each message; in a row, the gap between messages.' },
    layout: { label: 'Layout', options: { vertical: 'Vertical', horizontal: 'Horizontal' },
      help: 'Vertical stacks messages in a column. Horizontal runs them in one row, like a ticker.' },
    align: { label: 'New messages appear', options: { bottom: 'At the bottom', top: 'At the top' },
      // Shown instead while layout is horizontal (see syncLabels).
      horizontal: { label: 'Row sits', help: 'Whether the row runs along the bottom or the top edge of the source. New messages always come in on the right.' } },
    animate: { label: 'Slide in new messages' },
    fade: { label: 'Remove messages after', widget: 'stepper', step: 5, unit: 's', zero: 'Never',
      help: 'Seconds. The last second fades out. Never keeps messages until newer ones push them out.' },
    max: { label: 'Max messages on screen', widget: 'stepper', step: 5, help: 'From 1 to 200.' },
    bots: { label: 'Show bot messages',
      help: 'Nightbot, StreamElements, Streamlabs, Moobot, Fossabot and similar bots, plus the bots listed on the channel’s BetterTTV page.' },
    hide_commands: { label: 'Hide !commands', help: 'Hides messages that start with “!”.' },
    block: { label: 'Hide these users', help: 'Twitch usernames, separated by commas.', placeholder: 'username1, username2' },
    events: { label: 'Show subs, gifts, raids and announcements',
      help: 'Sub, resub, gift sub, raid and bits badge notices, plus /announce messages. When off, all of these are hidden; a resubscriber’s own chat message still shows.' },
    notice_color: { label: 'Notice text color', swatch: '#e2d6ff', when: eventsOn,
      help: 'Sub, gift, raid and bits badge notices, light purple by default. Announcements keep Text color. Needs Show subs, gifts, raids and announcements (Chat events).' },
    notice_size: { label: 'Notice text size', widget: 'range', unit: '%', when: eventsOn,
      help: 'Next to the chat text (85% by default). Above 100% a notice can be cut off in a short horizontal source. Needs Show subs, gifts, raids and announcements (Chat events).' },
    replies: { label: 'Show what replies are answering', help: 'Adds a small “↪ @user: message” line above a reply.' },
    first_msg: { label: 'Mark first-time chatters', help: 'A colored bar beside someone’s first message in the channel.' },
    first_msg_color: { label: 'First-message bar color', swatch: '#9146ff', when: firstMsgOn,
      help: 'Purple by default. Needs Mark first-time chatters (Chat events).' },
    history: { label: 'Recent messages on load', widget: 'stepper', step: 5, zero: 'Off',
      help: 'Shows up to this many recent messages (from recent-messages.robotty.de) when the overlay starts.' },
    shared: { label: 'Include Shared Chat',
      help: 'During a Shared Chat session, also show the other channels’ messages. Every message is marked with its channel’s avatar.' },
    gifs: { label: 'Show GIFs posted in chat' },
    emotes_7tv: { label: '7TV', logo: '7tv', help: 'Channel and global emotes, updated live when the channel changes them. Also shown in Kick chat.' },
    emotes_bttv: { label: 'BetterTTV', logo: 'bttv' },
    emotes_ffz: { label: 'FrankerFaceZ', logo: 'ffz' },
    badges: { label: 'Show badges', help: 'Master switch for every badge source below.' },
    badges_twitch: { label: 'Twitch', logo: 'twitch', when: badgesOn },
    badges_kick: { label: 'Kick', logo: 'kick', when: badgesOn },
    badges_7tv: { label: '7TV', logo: '7tv', when: badgesOn },
    badges_bttv: { label: 'BetterTTV', logo: 'bttv', when: badgesOn },
    badges_ffz: { label: 'FrankerFaceZ', logo: 'ffz', when: badgesOn },
    badges_ffzap: { label: 'FFZ:AP', logo: 'ffzap', when: badgesOn },
    badges_chatterino: { label: 'Chatterino', logo: 'chatterino', when: badgesOn },
    badges_homies: { label: 'Chatterino Homies', logo: 'homies', when: badgesOn },
    paints: { label: '7TV name paints', help: 'Gradient and image name colors from 7TV.' },
    stv_lookup: { label: 'Look up 7TV cosmetics for every chatter',
      help: '7TV only announces paints and badges for people running a 7TV extension. This asks 7TV about everyone else, in small rate-limited batches. The answer isn’t checked against subscriptions, so it can show paints for lapsed 7TV subs.' },
    readable: { label: 'Brighten dark name colors', help: 'Lightens very dark usernames so they stay readable.' },
    demo: { label: 'Demo messages in OBS too',
      help: 'Plays fake chat in the real overlay, handy for positioning. The preview has its own Demo / Live chat switch.' },
    debug: { label: 'Debug status line', help: 'Shows which providers loaded or failed, and logs details to the browser console.' }
  };

  var BADGE_SUBS = ['badges_twitch', 'badges_kick', 'badges_7tv', 'badges_bttv', 'badges_ffz', 'badges_ffzap',
    'badges_chatterino', 'badges_homies'];
  // What the short source names leave out.
  var BADGE_SUBS_HELP = 'Twitch covers sub, mod, VIP and bits badges. Kick covers broadcaster, mod, VIP, OG, founder, ' +
    'verified, staff, sub and gifter badges. BetterTTV covers Pro and staff. FrankerFaceZ includes custom mod and VIP ' +
    'badges. FFZ:AP covers its supporters.';

  // Switches drawn as one grid under the switch that rules them (keyed by it): label names the grid for
  // assistive tech, help goes under it.
  var SUBGRIDS = {
    badges: { keys: BADGE_SUBS, label: 'Badge sources', help: BADGE_SUBS_HELP }
  };

  // One section of the settings panel each; the rail lists them in this order, then "Add to OBS".
  // keys: every field of the section, in order. subs: [{id, title, first}] sub-headings, each drawn above the
  // field `first`; in Advanced its id is an anchor (builder.html#adv-text opens Advanced there). more: such an
  // id, linked at the foot of the section as "More in Advanced".
  var GROUPS = [
    { id: 'look', title: 'Look', note: 'Layout, text, names, boxes and how new messages come in.',
      keys: ['layout', 'align', 'size', 'font', 'text_weight', 'text_color', 'shadow', 'name_line', 'bg', 'bg_color', 'animate'],
      subs: [{ title: 'Layout', first: 'layout' }, { title: 'Text', first: 'size' }, { title: 'Names', first: 'name_line' },
        { title: 'Box', first: 'bg' }, { title: 'Animation', first: 'animate' }],
      more: 'adv-text' },
    { id: 'platforms', title: 'Kick', note: 'Kick chat alongside Twitch, in one overlay.',
      foot: 'Kick chat shows Kick and 7TV emotes, and Kick badges. It has no recent-message history.',
      keys: ['kick', 'kick_room', 'platform_icons'] },
    { id: 'messages', title: 'Messages', note: 'How many messages show, and for how long.',
      keys: ['fade', 'max', 'history'] },
    { id: 'events', title: 'Chat events', note: 'Subs, raids, replies and first messages.',
      keys: ['events', 'replies', 'first_msg', 'shared'], more: 'adv-events' },
    { id: 'filters', title: 'Filters', note: 'Who and what stays out of the overlay.',
      keys: ['bots', 'hide_commands', 'block'] },
    { id: 'emotes', title: 'Emotes', note: 'Twitch and Kick emotes are always shown.',
      keys: ['emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'gifs'] },
    { id: 'badges', title: 'Badges & paints', note: 'Each badge source has its own switch.',
      foot: 'DankChat badges can’t be shown: DankChat’s server doesn’t allow requests from web pages (no CORS header).',
      keys: ['badges'].concat(BADGE_SUBS, ['paints', 'stv_lookup', 'readable']) },
    { id: 'advanced', title: 'Advanced', note: 'Troubleshooting first, then finer settings for the other sections.',
      keys: ['debug', 'demo', 'line_height', 'text_case', 'names', 'name_weight', 'bg_shape', 'bg_width', 'spacing',
        'notice_color', 'notice_size', 'first_msg_color'],
      subs: [{ id: 'adv-trouble', title: 'Troubleshooting', first: 'debug' }, { id: 'adv-text', title: 'Text', first: 'line_height' },
        { id: 'adv-names', title: 'Names', first: 'names' }, { id: 'adv-box', title: 'Box', first: 'bg_shape' },
        { id: 'adv-events', title: 'Chat events', first: 'notice_color' }] }
  ];

  // ---------- pure helpers (unit tested) ----------

  function isLiveKey(k) { return config.LIVE_KEYS.indexOf(k) >= 0; }

  var RELOAD_KEYS = config.KEYS.filter(function (k) { return !isLiveKey(k); });

  // Keys a demo overlay ignores: it loads no history (overlay.js loadHistory), looks up no chatters
  // on 7TV and has no Shared Chat, so changing one (when it is a reload key) needs no demo reload.
  var DEMO_INERT = ['history', 'shared', 'stv_lookup', 'kick_room'];

  // Live keys reach the frame by postMessage, so only reload keys decide whether to reload.
  function reloadSignature(pc) {
    return RELOAD_KEYS.map(function (k) {
      return pc.demo && DEMO_INERT.indexOf(k) >= 0 ? '-' : config.serialize(k, pc[k]);
    }).join('|');
  }

  // GROUPS plus any SPEC key the builder doesn't know yet (appended to Advanced).
  function groupLayout() {
    var seen = {};
    var out = GROUPS.map(function (g) {
      g.keys.forEach(function (k) { seen[k] = true; });
      return { id: g.id, title: g.title, keys: g.keys.filter(function (k) { return !!config.SPEC[k]; }),
        note: g.note, foot: g.foot, subs: g.subs || [], more: g.more || '' };
    });
    var extra = config.KEYS.filter(function (k) { return k !== 'channel' && !seen[k]; });
    if (extra.length) out[out.length - 1].keys = out[out.length - 1].keys.concat(extra);
    return out;
  }

  // The SUBGRIDS grid a field is drawn in, or null.
  function subgridOf(key) {
    for (var k in SUBGRIDS) if (SUBGRIDS[k].keys.indexOf(key) >= 0) return k;
    return null;
  }

  // Commas are legal in a query string; keep block lists readable.
  function tidyQuery(q) { return q.replace(/%2C/gi, ','); }

  // The URL to paste into OBS: only non-default params (config.toParams). A file:/// overlay always
  // loads the settings.js in its folder, which fills in every key the URL leaves out, so there the
  // URL lists every setting (like the preview) and a settings.js can't change the source.
  function overlayUrl(cfg, baseHref) {
    var u = new URL('overlay.html', baseHref);
    if (u.protocol === 'file:') return previewUrl(cfg, baseHref);
    var q = tidyQuery(config.toParams(cfg).toString());
    u.search = q ? '?' + q : '';
    u.hash = '';
    return u.href;
  }

  // The preview iframe URL: every key explicit, so a settings.js next to overlay.html can't leak in.
  // An empty channel is written too (channel=), for the overlay to read as "no channel".
  function previewUrl(cfg, baseHref) {
    var u = new URL('overlay.html', baseHref);
    var p = new URLSearchParams();
    for (var i = 0; i < config.KEYS.length; i++) {
      var k = config.KEYS[i], v = cfg[k];
      if (k === 'channel') { p.set(k, v ? String(v) : ''); continue; }
      if (v === undefined || v === null) continue;
      p.set(k, config.serialize(k, v));
    }
    u.search = '?' + tidyQuery(p.toString());
    u.hash = '';
    return u.href;
  }

  // The preview frame's sandbox. An opaque-origin frame may not load file: resources, so from disk the
  // preview would stay blank; there it runs unsandboxed (Chrome still gives each file: page an origin
  // of its own, and OBS runs overlay.html unsandboxed from file: anyway).
  function frameSandbox(protocol) { return protocol === 'file:' ? null : 'allow-scripts'; }

  // IVR's logo is the 600x600 rendition; the builder shows it at 28 px. Twitch serves the same image
  // at 70x70 (the builder falls back to the full one if that ever fails).
  function smallAvatar(url) { return String(url).replace(/-(\d+)x\1(\.\w+)$/, '-70x70$2'); }

  function settingsSnippet(cfg) {
    return '// Twitch Chat Overlay settings. Save as settings.js next to overlay.html.\n' +
      '// Settings in the overlay URL override these.\n' +
      'window.TCO_SETTINGS = ' + JSON.stringify(config.toObject(cfg), null, 2) + ';\n';
  }

  // Own SPEC keys only: '__proto__', 'constructor', 'toString'… are not settings.
  function isKnown(k) { return Object.prototype.hasOwnProperty.call(config.SPEC, String(k).toLowerCase()); }

  // How many settings config.parse will actually take from obj: the ones config.applyObject accepts
  // (a known key with a valid value), onto an empty object.
  function countApplied(obj) { return Object.keys(config.applyObject({}, obj)).length; }

  var JS_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

  // A hand-written settings.js (JS object literal: comments, 'single quotes', unquoted keys,
  // trailing commas) -> the object it assigns, via JSON.parse. Reads the text as data and never
  // evaluates it, so anything that isn't a plain literal (a function call, a variable) throws.
  function relaxedJson(src) {
    src = String(src);
    var out = '', i = 0, n = src.length, comma = false, c, j;
    var emit = function (tok) {
      if (comma && tok !== '}' && tok !== ']') out += ','; // a comma right before } or ] is dropped
      comma = false;
      out += tok;
    };
    while (i < n) {
      c = src.charAt(i);
      if (c === '/' && src.charAt(i + 1) === '/') { j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && src.charAt(i + 1) === '*') { j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        var str = '';
        i++;
        while (i < n && src.charAt(i) !== c) {
          if (src.charAt(i) !== '\\') { str += src.charAt(i++); continue; }
          var e = src.charAt(i + 1), hex = src.substr(i + 2, 4);
          if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(hex)) { str += String.fromCharCode(parseInt(hex, 16)); i += 6; }
          else { str += Object.prototype.hasOwnProperty.call(JS_ESCAPES, e) ? JS_ESCAPES[e] : e; i += 2; }
        }
        if (i >= n) throw new SyntaxError('Unterminated string');
        i++;
        emit(JSON.stringify(str));
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        j = i + 1;
        while (j < n && /[\w$]/.test(src.charAt(j))) j++;
        var word = src.slice(i, j), k = j;
        while (k < n && /\s/.test(src.charAt(k))) k++;
        emit(src.charAt(k) === ':' ? JSON.stringify(word) : word); // unquoted key -> "key"
        i = j;
        continue;
      }
      if (c === ',') { if (comma) out += ','; comma = true; i++; continue; }
      if (/\s/.test(c)) out += c;
      else emit(c);
      i++;
    }
    var a = out.indexOf('{'), b = out.lastIndexOf('}');
    if (a < 0 || b <= a) throw new SyntaxError('No object literal');
    return JSON.parse(out.slice(a, b + 1));
  }

  // An object literal, maybe after leading comments: '{…}' or '// note\n{…}'.
  function startsWithObject(s) {
    var i = 0, n = s.length, c, j;
    while (i < n) {
      c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && s.charAt(i + 1) === '/') { j = s.indexOf('\n', i); if (j < 0) return false; i = j + 1; continue; }
      if (c === '/' && s.charAt(i + 1) === '*') { j = s.indexOf('*/', i + 2); if (j < 0) return false; i = j + 2; continue; }
      return c === '{';
    }
    return false;
  }

  // settings.js text -> its settings object, or null. The builder's own snippet is JSON; a
  // hand-edited copy of settings.example.js needs relaxedJson. Nothing is ever evaluated.
  function readSettingsObject(s) {
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* not JSON: hand-written */ }
    }
    try { return relaxedJson(s); } catch (e2) { return null; }
  }

  // Pasted overlay URL, bare query string, or settings.js / JSON object -> {cfg, count} or null.
  function parsePasted(text) {
    var s = String(text || '').trim();
    if (!s) return null;
    if (/TCO_SETTINGS/.test(s) || startsWithObject(s)) {
      var obj = readSettingsObject(s);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      var n = countApplied(obj);
      return n ? { cfg: config.parse('', obj), count: n } : null;
    }
    var q = s.indexOf('?');
    var search;
    if (q >= 0) search = s.slice(q + 1);
    else if (s.indexOf('=') > 0) search = s;
    else return null;
    search = search.split('#')[0];
    var params = new URLSearchParams(search);
    // As config.parse reads a query: keys lowercased, the last value wins.
    var fromUrl = {};
    params.forEach(function (v, k) { if (isKnown(k)) fromUrl[String(k).toLowerCase()] = v; });
    var count = countApplied(fromUrl);
    return count ? { cfg: config.parse(params), count: count } : null;
  }

  // The builder's first config, from its query string and the remembered config. A link with only
  // ?channel= (the overlay's hints link here) keeps the remembered look and filters; a link with more
  // settings is a whole setup, over the defaults.
  function startCfg(search, stored) {
    var params = new URLSearchParams(search || '');
    var known = [];
    params.forEach(function (v, k) { if (isKnown(k)) known.push(String(k).toLowerCase()); });
    var base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
    if (known.length) {
      var onlyChannel = known.every(function (k) { return k === 'channel' || k === 'kick' || k === 'kick_room'; });
      return { cfg: config.parse(params, onlyChannel ? base : null), fromQuery: true, fromStore: false };
    }
    if (base) return { cfg: config.parse('', base), fromQuery: false, fromStore: true };
    return { cfg: config.defaults(), fromQuery: false, fromStore: false };
  }

  // The preview size to switch to when the layout changes, or null to keep the current one. Only a
  // size still at the old layout's suggestion is swapped, so a size the user typed in stays.
  function layoutPreviewSize(ui, prevLayout, nextLayout) {
    var from = LAYOUT_SIZES[prevLayout], to = LAYOUT_SIZES[nextLayout];
    if (!from || !to || prevLayout === nextLayout || !ui) return null;
    return ui.w === from.w && ui.h === from.h ? { w: to.w, h: to.h } : null;
  }

  // A field's label and help for the current layout (a META entry's `horizontal` overrides them).
  function fieldText(key, layout) {
    var m = META[key] || {};
    var alt = layout === 'horizontal' && m.horizontal ? m.horizontal : {};
    return { label: alt.label || m.label || key, help: alt.help || m.help || '' };
  }

  // The full-width preview row (.wide-preview) is for a horizontal chat in a landscape source; a portrait
  // source keeps the tall side column, where it stays readable. In the app layout (app) the row takes its
  // height from the settings below it, so there only a bar-shaped source (4:1 or wider) gets it.
  function wantsWidePreview(layout, w, h, app) { return layout === 'horizontal' && (app ? w >= 4 * h : w > h); }

  // Height (px, border-box) of the wide preview's stage: the source's shape at the available width plus
  // the stage's own chrome (padding, border, the tag line and any hint). Never under 150px (180px, the
  // design's row, in a window 960px high or taller) and never over 45% of the window. room (app layout):
  // the height the window can spare once the settings have theirs, which wins over the 150px; the
  // suggested 1920x100 bar always fits.
  function wideStageHeight(availW, chrome, w, h, winH, room) {
    var want = Math.ceil(availW * h / w) + chrome;
    var max = Math.max(150, Math.round(winH * 0.45));
    if (typeof room === 'number') {
      max = Math.min(max, Math.max(room,
        Math.ceil(availW * LAYOUT_SIZES.horizontal.h / LAYOUT_SIZES.horizontal.w) + chrome));
    }
    var min = Math.min(max, Math.max(150, Math.min(180, Math.round(winH * 0.1875))));
    return Math.max(min, Math.min(max, want || min));
  }

  // Scale factor (<= 1) that fits a w×h source into the available box.
  function fitScale(w, h, availW, availH) {
    if (!(w > 0) || !(h > 0) || !(availW > 0) || !(availH > 0)) return 1;
    return Math.max(0.05, Math.min(1, availW / w, availH / h));
  }

  // IVR /v2/twitch/user bare array -> {state:'found', user} | {state:'notfound'} | {state:'error'}.
  // Like the overlay's own lookup: the entry whose login matches, and only with a numeric id. A reply
  // that doesn't fit is 'error' (the overlay still tries the name), never a missing channel.
  function describeIvrUser(r, login) {
    if (Array.isArray(r) && r.length) {
      var want = String(login || '').toLowerCase();
      // Asked for a login: an answer about someone else is no answer (the overlay ignores it too).
      var u = want ? r.filter(function (x) { return x && String(x.login || '').toLowerCase() === want; })[0] : r[0];
      if (!u || !/^\d+$/.test(util.idStr(u.id))) return { state: 'error' };
      return { state: 'found', user: {
        id: util.idStr(u.id), login: String(u.login || ''), displayName: String(u.displayName || u.login || ''),
        logo: typeof u.logo === 'string' ? u.logo : null, banned: !!u.banned } };
    }
    return { state: 'notfound' };
  }

  // The settings that differ from their defaults (the ones the overlay URL has to carry), as {key: true}.
  function changedKeys(cfg) {
    var o = config.toObject(cfg), out = {};
    Object.keys(o).forEach(function (k) { if (k !== 'channel') out[k] = true; });
    return out;
  }

  // A field's tag: the setting's name in the URL, with its value once it is off the default.
  function tagText(key, cfg, changed) {
    return (changed || changedKeys(cfg))[key] === true ? key + '=' + config.serialize(key, cfg[key]) : key;
  }

  // Changed settings per section, for the counts in the rail.
  function groupCounts(cfg) {
    var changed = changedKeys(cfg), out = {};
    groupLayout().forEach(function (g) {
      out[g.id] = g.keys.filter(function (k) { return changed[k] === true; }).length;
    });
    return out;
  }

  // An overlay URL in pieces, for drawing its parameters in color: the text of base and every
  // sep + key + (eq ? '=' : '') + value, joined, is the URL again.
  function urlParts(url) {
    var s = String(url === undefined || url === null ? '' : url);
    var hash = s.indexOf('#');
    if (hash >= 0) s = s.slice(0, hash);
    var q = s.indexOf('?');
    if (q < 0) return { base: s, params: [] };
    var params = [];
    s.slice(q + 1).split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      params.push({ sep: params.length ? '&' : '?', key: eq < 0 ? pair : pair.slice(0, eq), eq: eq >= 0,
        value: eq < 0 ? '' : pair.slice(eq + 1) });
    });
    return { base: s.slice(0, q), params: params };
  }

  // The line beside the overlay URL: what is wrong with it, or what it holds.
  function urlNote(cfg, ch, url) {
    if (!cfg.channel && !cfg.kick) return { text: 'Add a channel first. Without one the overlay only shows a hint.', cls: 'warn' };
    if (cfg.kick && !cfg.kick_room) {
      return { text: 'The Kick chatroom id is missing, and Kick may refuse the overlay’s own lookup. Press Check next to the Kick channel.', cls: 'warn' };
    }
    if (ch && ch.state === 'notfound' && ch.login === cfg.channel) {
      return { text: 'Twitch has no channel called “' + cfg.channel + '”. Check the spelling.', cls: 'warn' };
    }
    if (/^file:/i.test(String(url))) {
      return { text: 'The URL lists every setting, so a settings.js in the overlay’s folder can’t change this source.', cls: '' };
    }
    var n = Object.keys(changedKeys(cfg)).length;
    return { text: n
      ? 'Holds only the ' + n + ' setting' + (n === 1 ? '' : 's') + ' you changed. The rest use the defaults.'
      : 'Every setting is at its default, so the URL only needs the channel.', cls: '' };
  }

  // A number setting as the form shows it: a name (shadow), a word for zero (fade: Never), or with its unit.
  // A choice on a slider (text_weight) shows its label.
  function valueText(key, v) {
    var m = META[key] || {}, s = config.SPEC[key];
    if (s && s.type === 'enum') return (m.options && m.options[v]) || String(v);
    if (m.names && s) return m.names[v - s.min] || String(v);
    if (v === 0 && m.zero) return m.zero;
    return String(v) + (m.unit === '%' ? '%' : m.unit ? ' ' + m.unit : '');
  }

  // What someone typed into a stepper -> the setting's value (clamped), or undefined. Takes the shown
  // form too: '30 s', 'Never'. Anything else that isn't a whole number is no value.
  function parseStep(key, text) {
    var s = String(text === undefined || text === null ? '' : text).trim(), m = META[key] || {};
    if (m.zero && s.toLowerCase() === m.zero.toLowerCase()) return config.coerce(key, 0);
    // A whole number, with nothing after it but the field's own unit: '1,000', '2.5' and '1e2' are not 1, 2 and 1.
    var d = /^(\d+)\s*(\S*)$/.exec(s);
    if (!d || (d[2] && d[2].toLowerCase() !== String(m.unit || '').toLowerCase())) return undefined;
    return config.coerce(key, d[1]);
  }

  // The next multiple of step above or below v, within min..max (1 -> 5 -> 10 … and back down to 1).
  function stepValue(v, dir, step, min, max) {
    var n = dir > 0 ? (Math.floor(v / step) + 1) * step : (Math.ceil(v / step) - 1) * step;
    return Math.max(min, Math.min(max, n));
  }

  // The choices of a segmented field: an enum's values, or every step of a small number (shadow 0..3).
  function segValues(key) {
    var s = config.SPEC[key], m = META[key] || {};
    if (s.type === 'enum') {
      return s.values.map(function (v) { return { value: v, label: (m.options && m.options[v]) || v }; });
    }
    var out = [];
    for (var i = s.min; i <= s.max; i++) out.push({ value: String(i), label: valueText(key, i) });
    return out;
  }

  function sectionIds() { return groupLayout().map(function (g) { return g.id; }).concat(OBS_SECTION); }

  // The ids of Advanced's sub-headings (GROUPS subs), each an anchor a link can open.
  function advIds() {
    var out = [];
    groupLayout().forEach(function (g) {
      if (g.id === 'advanced') g.subs.forEach(function (s) { if (s.id) out.push(String(s.id)); });
    });
    return out;
  }

  // builder.html#obs, #badges, #group-badges: the section a link opens; #adv-text and the other Advanced
  // sub-heading ids open Advanced. '' for any other hash.
  function sectionFromHash(hash, ids, adv) {
    var raw = String(hash || '').replace(/^#/, '');
    if (raw && (adv || advIds()).indexOf(raw.toLowerCase()) >= 0) return 'advanced';
    var s = raw.replace(/^group-/, '').toLowerCase();
    return s && (ids || sectionIds()).indexOf(s) >= 0 ? s : '';
  }

  // Whether a field is greyed out under cfg: its META.when is false, or its META.only is the other layout.
  function fieldOff(key, cfg) {
    var m = META[key] || {};
    if (m.only && m.only !== (cfg.layout === 'horizontal' ? 'horizontal' : 'vertical')) return true;
    return typeof m.when === 'function' && !m.when(cfg);
  }

  function clampInt(v, min, max, def) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  function sameValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.join(',') === b.join(',');
    return a === b;
  }

  function copyCfg(cfg) {
    var o = {};
    for (var k in cfg) o[k] = Array.isArray(cfg[k]) ? cfg[k].slice() : cfg[k];
    return o;
  }

  // ---------- DOM runtime ----------
  var B = null; // builder state, created by start()

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function storage() {
    if (B.storage === undefined) B.storage = util.safeStorage();
    return B.storage;
  }
  function loadStored(key) {
    var s = storage();
    if (!s) return null;
    try { return JSON.parse(s.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function store(key, v) {
    var s = storage();
    if (!s) return;
    try { s.setItem(key, JSON.stringify(v)); } catch (e) { /* quota or blocked */ }
  }
  function saveCfg() {
    store(STORE_CFG, config.toObject(B.cfg));
    // Every file:// page shares one localStorage, so remember which folder these settings came from.
    if (root.location.protocol === 'file:') store(STORE_CFG_PATH, folderOf(root.location.pathname));
  }
  // A page's folder. Keys are per folder, not per file, so a renamed builder file keeps its memory
  // (the builder was index.html before it was builder.html, and old keys hold that full path).
  function folderOf(pathname) { return String(pathname || '').replace(/[^\/]*$/, ''); }
  // The settings.js snapshot last loaded from a folder. Until one is saved under the folder, the one the
  // builder saved as index.html counts; after that the old one is never looked at again.
  function lastSnapshot(folderSnap, legacySnap) {
    return folderSnap === null || folderSnap === undefined ? legacySnap : folderSnap;
  }
  function saveUi() { store(STORE_UI, { w: B.ui.w, h: B.ui.h, backdrop: B.ui.backdrop, section: B.ui.section }); }

  function announce(text) {
    var r = $('sr-status');
    if (!r) return;
    r.textContent = '';
    clearTimeout(B.sayTimer); // two in a row (a stepper clicked fast): only the later one is read
    B.sayTimer = setTimeout(function () { r.textContent = text; }, 30);
  }

  // ---------- form fields ----------
  function labelFor(key) { return (META[key] && META[key].label) || key; }

  function addHelp(row, key, input) {
    var m = META[key] || {};
    if (!m.help && !m.horizontal) return null; // text that follows the layout needs the element either way
    var p = h('p', 'help', m.help || '');
    p.hidden = !m.help;
    p.id = 'h-' + key;
    row.appendChild(p);
    if (input) input.setAttribute('aria-describedby', p.id);
    return p;
  }

  function widgetFor(key) {
    var s = config.SPEC[key], m = META[key] || {};
    if (m.widget) return m.widget;
    if (s.type === 'bool') return 'check';
    if (s.type === 'enum') return 'seg';
    if (s.type === 'int') return 'stepper';
    if (s.type === 'font') return 'font';
    if (s.type === 'color') return 'color';
    return 'text'; // list, kick, room
  }

  // The provider mark beside a field: the images are css/builder.css backgrounds, so no URL is set here.
  function logoFor(key) {
    var m = META[key] || {};
    if (!m.logo) return null;
    var e = h('span', 'logo logo-' + m.logo);
    e.setAttribute('aria-hidden', 'true');
    return e;
  }

  function buildField(key) {
    var spec = config.SPEC[key], m = META[key] || {};
    var row = h('div', 'field field-' + widgetFor(key));
    row.setAttribute('data-key', key);
    var id = 'f-' + key;
    var head = h('div', 'field-head');
    var name = h('div', 'field-name');
    var tag = h('code', 'tag', key);
    var field = { key: key, row: row, tag: tag, set: function () {}, inputs: [] };
    var logo = logoFor(key);
    if (logo) head.appendChild(logo);
    head.appendChild(name);
    row.appendChild(head);
    // A <label> for a single input; a plain name (the group's aria-labelledby) for a set of them.
    var addLabel = function (single) {
      var l = h(single ? 'label' : 'span', 'field-label', labelFor(key));
      l.id = 'l-' + key;
      if (single) l.htmlFor = id;
      name.appendChild(l);
      name.appendChild(tag);
      field.labelEl = l;
    };
    var control = function (el) {
      el.classList.add('field-control');
      head.appendChild(el);
      return el;
    };

    switch (widgetFor(key)) {
      case 'check': {
        addLabel(true);
        var cb = h('input', 'switch');
        cb.type = 'checkbox';
        cb.id = id;
        cb.setAttribute('role', 'switch');
        control(cb);
        field.helpEl = addHelp(row, key, cb);
        cb.addEventListener('change', function () { update(key, cb.checked); });
        field.inputs.push(cb);
        field.set = function (v) { cb.checked = !!v; };
        break;
      }
      case 'seg': {
        addLabel(false);
        var seg = control(h('div', m.wrap ? 'seg wrap' : 'seg'));
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-labelledby', 'l-' + key);
        var radios = [];
        segValues(key).forEach(function (o) {
          var l = h('label');
          var r = h('input');
          r.type = 'radio';
          r.name = id;
          r.value = o.value;
          r.addEventListener('change', function () { if (r.checked) update(key, o.value); });
          l.appendChild(r);
          l.appendChild(h('span', null, o.label));
          seg.appendChild(l);
          radios.push(r);
        });
        field.helpEl = addHelp(row, key, seg);
        field.inputs = radios;
        field.set = function (v) { radios.forEach(function (r) { r.checked = r.value === String(v); }); };
        break;
      }
      case 'range': {
        addLabel(true);
        // A number, or a choice (text_weight): then the slider moves along its values, in order, by index.
        var steps = spec.type === 'enum' ? spec.values : null;
        var wrap = control(h('div', 'range'));
        var rg = h('input');
        rg.type = 'range';
        rg.id = id;
        rg.min = steps ? '0' : String(spec.min);
        rg.max = steps ? String(steps.length - 1) : String(spec.max);
        rg.step = '1';
        var out = h('output', steps ? 'range-value names' : 'range-value');
        out.htmlFor = id;
        // An <output> is a live region by default, and the slider already says its own value.
        out.setAttribute('aria-live', 'off');
        wrap.appendChild(rg);
        wrap.appendChild(out);
        field.helpEl = addHelp(row, key, rg);
        var showRange = function (v) {
          out.textContent = valueText(key, v);
          rg.setAttribute('aria-valuetext', valueText(key, v));
        };
        var rangeValue = function () { return steps ? steps[Number(rg.value)] : Number(rg.value); };
        rg.addEventListener('input', function () { showRange(rangeValue()); update(key, rangeValue()); });
        field.inputs.push(rg);
        field.set = function (v) { rg.value = String(steps ? steps.indexOf(v) : v); showRange(v); };
        break;
      }
      case 'stepper': {
        addLabel(true);
        var step = m.step || 1;
        var st = control(h('div', 'stepper'));
        st.setAttribute('role', 'group');
        st.setAttribute('aria-labelledby', 'l-' + key);
        var less = h('button', 'step less');
        less.type = 'button';
        less.setAttribute('aria-label', m.unit ? 'Less' : 'Fewer'); // seconds, or a count
        var more = h('button', 'step more');
        more.type = 'button';
        more.setAttribute('aria-label', 'More');
        // A text box, so it can read '30 s' or 'Never' while it isn't being typed in.
        var sv = h('input', 'step-value');
        sv.type = 'text';
        sv.id = id;
        sv.inputMode = 'numeric';
        sv.autocomplete = 'off';
        sv.setAttribute('role', 'spinbutton');
        sv.setAttribute('aria-valuemin', String(spec.min));
        sv.setAttribute('aria-valuemax', String(spec.max));
        st.appendChild(less);
        st.appendChild(sv);
        st.appendChild(more);
        field.helpEl = addHelp(row, key, sv);
        var typing = false, stt = null;
        var showStep = function (v) {
          sv.value = typing ? String(v) : valueText(key, v);
          sv.setAttribute('aria-valuenow', String(v));
          sv.setAttribute('aria-valuetext', valueText(key, v));
        };
        var commit = function () {
          clearTimeout(stt);
          var n = parseStep(key, sv.value);
          if (n === undefined) return;
          update(key, n);
          // The box keeps what was typed until blur or Enter; what assistive tech reads follows the setting.
          sv.setAttribute('aria-valuenow', String(B.cfg[key]));
          sv.setAttribute('aria-valuetext', valueText(key, B.cfg[key]));
        };
        // say: the Fewer / More buttons keep the focus, so the new value is spoken through the status region.
        var jump = function (n, say) {
          clearTimeout(stt);
          update(key, n);
          showStep(B.cfg[key]);
          if (say) announce(valueText(key, B.cfg[key]));
        };
        sv.addEventListener('focus', function () { typing = true; showStep(B.cfg[key]); sv.select(); });
        // Debounced: typing "50" passes through "5", and max=5 or fade=5 would wipe the preview's lines.
        sv.addEventListener('input', function () { clearTimeout(stt); stt = setTimeout(commit, 400); });
        sv.addEventListener('blur', function () { commit(); typing = false; showStep(B.cfg[key]); });
        sv.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); commit(); showStep(B.cfg[key]); sv.select(); return; }
          // Step from what is in the box: a number typed less than 400 ms ago is not in B.cfg yet.
          var n, cur = parseStep(key, sv.value);
          if (cur === undefined) cur = B.cfg[key];
          if (e.key === 'ArrowUp') n = cur + 1;
          else if (e.key === 'ArrowDown') n = cur - 1;
          else if (e.key === 'PageUp') n = stepValue(cur, 1, step, spec.min, spec.max);
          else if (e.key === 'PageDown') n = stepValue(cur, -1, step, spec.min, spec.max);
          else return;
          e.preventDefault();
          jump(n);
        });
        less.addEventListener('click', function () { jump(stepValue(B.cfg[key], -1, step, spec.min, spec.max), true); });
        more.addEventListener('click', function () { jump(stepValue(B.cfg[key], 1, step, spec.min, spec.max), true); });
        field.inputs.push(less, sv, more);
        field.set = function (v) { clearTimeout(stt); showStep(v); };
        break;
      }
      case 'font': {
        addLabel(true);
        var fi = control(h('input', 'text'));
        fi.type = 'text';
        fi.id = id;
        fi.setAttribute('list', 'font-list');
        fi.autocomplete = 'off';
        fi.spellcheck = false;
        fi.placeholder = String(spec.def);
        var fh = addHelp(row, key, fi);
        field.helpEl = fh;
        var bad = h('p', 'status err', 'Use letters, numbers, spaces and dashes only.');
        bad.id = 'e-' + key;
        bad.hidden = true;
        row.appendChild(bad);
        var timer = null;
        var commitFont = function (final) {
          clearTimeout(timer);
          var raw = fi.value.trim();
          if (!raw && final) raw = String(spec.def);
          if (!raw) return;
          // Google Fonts only loads the exact spelling: 'roboto' -> 'Roboto', 'press start 2p' -> 'Press Start 2P'.
          var ok = update(key, config.canonicalFont(raw));
          if (!ok && bad.hidden) announce(bad.textContent);
          bad.hidden = ok;
          fi.setAttribute('aria-invalid', ok ? 'false' : 'true');
          fi.setAttribute('aria-describedby', (fh ? fh.id + ' ' : '') + (ok ? '' : bad.id));
          if (ok && final) fi.value = B.cfg[key];
        };
        // Debounced so the preview doesn't request a Google Font for every keystroke.
        fi.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { commitFont(false); }, 600); });
        fi.addEventListener('change', function () { commitFont(true); });
        field.inputs.push(fi);
        field.set = function (v) { fi.value = v; bad.hidden = true; fi.setAttribute('aria-invalid', 'false'); };
        break;
      }
      case 'color': {
        // The browser's color picker as a swatch, the hex code to type or paste, and Default (the setting's '').
        addLabel(true);
        var crow = control(h('div', 'text-row'));
        var pick = h('input');
        pick.type = 'color';
        pick.setAttribute('aria-labelledby', 'l-' + key);
        var hex = h('input', 'text');
        hex.type = 'text';
        hex.id = id;
        hex.autocomplete = 'off';
        hex.spellcheck = false;
        hex.placeholder = m.swatch;
        var dflt = h('button', 'btn ghost', 'Default');
        dflt.type = 'button';
        dflt.setAttribute('aria-label', 'Default ' + labelFor(key).toLowerCase());
        crow.appendChild(pick);
        crow.appendChild(hex);
        crow.appendChild(dflt);
        var ch = addHelp(row, key, hex);
        field.helpEl = ch;
        var cbad = h('p', 'status err', 'Use a hex color: 6 digits such as ff8800 (or 3, such as f80), with or without #.');
        cbad.id = 'e-' + key;
        cbad.hidden = true;
        row.appendChild(cbad);
        var cOff = false, ct = null;
        var showBadColor = function (ok) {
          if (!ok && cbad.hidden) announce(cbad.textContent);
          cbad.hidden = ok;
          hex.setAttribute('aria-invalid', ok ? 'false' : 'true');
          hex.setAttribute('aria-describedby', (ch ? ch.id : '') + (ok ? '' : ' ' + cbad.id));
        };
        // skip: the input the value came from, which keeps what it shows (a hex code half typed, the picker's own).
        var showColor = function (v, skip) {
          if (skip !== hex) hex.value = v ? '#' + v : '';
          if (skip !== pick) pick.value = v ? '#' + v : m.swatch;
          dflt.disabled = cOff || !v;
        };
        var commitColor = function (final) {
          clearTimeout(ct);
          var ok = update(key, hex.value);
          showBadColor(ok);
          if (ok) showColor(B.cfg[key], final ? null : hex);
        };
        pick.addEventListener('input', function () {
          clearTimeout(ct);
          update(key, pick.value);
          showBadColor(true);
          showColor(B.cfg[key], pick);
        });
        hex.addEventListener('input', function () {
          clearTimeout(ct);
          ct = setTimeout(function () { commitColor(false); }, 600);
        });
        hex.addEventListener('change', function () { commitColor(true); });
        hex.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commitColor(true); } });
        dflt.addEventListener('click', function () {
          clearTimeout(ct);
          update(key, '');
          showBadColor(true);
          showColor(B.cfg[key]);
          // The button that had the focus is disabled now. The picker takes it (the hex box would bring up a
          // phone's keyboard).
          if (pick.focus) pick.focus();
        });
        field.inputs.push(pick, hex, dflt);
        field.set = function (v) { clearTimeout(ct); showColor(v); showBadColor(true); };
        // Greyed out like any field, except that Default also stays off while there is nothing to reset.
        field.setDisabled = function (off) {
          cOff = off;
          pick.disabled = off;
          hex.disabled = off;
          dflt.disabled = off || !B.cfg[key];
          if (off) row.classList.add('disabled'); else row.classList.remove('disabled');
        };
        break;
      }
      default: { // text: a list of names (block), or one value (kick, kick_room)
        addLabel(true);
        var isList = spec.type === 'list';
        var li = h('input', 'text');
        li.type = 'text';
        li.id = id;
        li.autocomplete = 'off';
        li.spellcheck = false;
        if (m.placeholder) li.placeholder = m.placeholder;
        if (m.check) {
          // The input and its Check button share one control row.
          var rowc = control(h('div', 'text-row'));
          rowc.appendChild(li);
        } else {
          control(li);
        }
        var th = addHelp(row, key, li);
        field.helpEl = th;
        var lt = null;
        if (isList) {
          li.addEventListener('input', function () {
            clearTimeout(lt);
            lt = setTimeout(function () { update(key, li.value); }, 400);
          });
          li.addEventListener('change', function () {
            clearTimeout(lt);
            update(key, li.value);
            li.value = (B.cfg[key] || []).join(', ');
          });
          field.inputs.push(li);
          field.set = function (v) { li.value = (v || []).join(', '); };
          break;
        }
        var tbad = h('p', 'status err', m.bad || 'That value isn’t valid.');
        tbad.id = 'e-' + key;
        tbad.hidden = true;
        row.appendChild(tbad);
        var showBad = function (ok) {
          if (!ok && tbad.hidden) announce(tbad.textContent);
          tbad.hidden = ok;
          li.setAttribute('aria-invalid', ok ? 'false' : 'true');
          li.setAttribute('aria-describedby', (th ? th.id : '') + (ok ? '' : ' ' + tbad.id));
        };
        var commitText = function (final) {
          clearTimeout(lt);
          var raw = li.value.trim();
          // kick_room takes the pasted channel page too: the chatroom id is read out of it.
          if (raw && m.parse === 'kickRoom') raw = kick.roomFromText(raw) || raw;
          var before = B.cfg[key];
          var ok = update(key, raw);
          showBad(ok);
          if (!ok || !final) return;
          li.value = B.cfg[key];
          if (key === 'kick' && B.cfg.kick !== before) onKickChanged(before);
        };
        li.addEventListener('input', function () {
          clearTimeout(lt);
          lt = setTimeout(function () { commitText(false); }, 600);
        });
        li.addEventListener('change', function () { commitText(true); });
        li.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commitText(true); } });
        field.inputs.push(li);
        field.set = function (v) { li.value = v || ''; showBad(true); };
        if (m.check) {
          var cbtn = h('button', 'btn', 'Check');
          cbtn.type = 'button';
          rowc.appendChild(cbtn);
          var kst = h('div', 'status');
          kst.setAttribute('role', 'status');
          kst.setAttribute('aria-live', 'polite');
          row.appendChild(kst);
          field.statusEl = kst;
          cbtn.addEventListener('click', function () { commitText(true); checkKick(true); });
          field.inputs.push(cbtn);
        }
      }
    }
    // Greyed out while the field doesn't apply (syncDisabled): every input off, the row dimmed.
    if (!field.setDisabled) {
      field.setDisabled = function (off) {
        field.inputs.forEach(function (i) { i.disabled = off; });
        if (off) row.classList.add('disabled'); else row.classList.remove('disabled');
      };
    }
    return field;
  }

  // A sub-heading in a section's fields. Advanced's carry their id, so a link can open them and move the
  // focus there (showSubhead).
  function subhead(g, s) {
    var e = h('h3', 'eyebrow subhead', s.title);
    if (g.id === 'advanced' && s.id) {
      e.id = s.id;
      e.tabIndex = -1;
      B.subheads[s.id] = e;
    }
    return e;
  }

  // The foot of a section whose finer settings are under an Advanced sub-heading.
  function moreLink(id) {
    var p = h('p', 'section-foot');
    var a = h('a', 'btn ghost', 'More in Advanced');
    var href = '#' + id;
    a.href = href;
    p.appendChild(a);
    return p;
  }

  // One tab in the rail and one section in the panel per group. "Add to OBS" is in builder.html already.
  function buildGroups() {
    var host = $('groups'), tabs = $('tabs'), rule = $('tab-rule');
    clear(host);
    B.subheads = Object.create(null);
    groupLayout().forEach(function (g) {
      var old = $('tab-' + g.id);
      if (old) old.parentNode.removeChild(old);
      var tab = h('button', 'tab');
      tab.type = 'button';
      tab.id = 'tab-' + g.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'group-' + g.id);
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('data-section', g.id);
      tab.tabIndex = -1;
      tab.appendChild(h('span', 'mark'));
      tab.appendChild(h('span', 'name', g.title));
      var count = h('span', 'count');
      count.id = 'count-' + g.id;
      tab.appendChild(count);
      tabs.insertBefore(tab, rule);

      var sec = h('section', 'section');
      sec.id = 'group-' + g.id;
      sec.setAttribute('role', 'tabpanel');
      sec.setAttribute('aria-labelledby', tab.id);
      sec.hidden = true;
      var head = h('div', 'section-head');
      head.appendChild(h('h2', null, g.title));
      if (g.note) head.appendChild(h('p', 'section-note', g.note));
      sec.appendChild(head);
      var body = h('div', 'fields');
      var heads = Object.create(null), grids = Object.create(null);
      g.subs.forEach(function (s) { heads[s.first] = s; });
      g.keys.forEach(function (key) {
        if (heads[key]) body.appendChild(subhead(g, heads[key]));
        var f = buildField(key);
        B.fields[key] = f;
        var sg = subgridOf(key);
        if (sg) {
          if (!grids[sg]) {
            grids[sg] = h('div', 'subgrid');
            grids[sg].setAttribute('role', 'group');
            grids[sg].setAttribute('aria-label', SUBGRIDS[sg].label);
            body.appendChild(grids[sg]);
          }
          f.row.className += ' sub';
          grids[sg].appendChild(f.row);
        } else {
          body.appendChild(f.row);
        }
      });
      Object.keys(grids).forEach(function (sg) {
        if (SUBGRIDS[sg].help) grids[sg].appendChild(h('p', 'help', SUBGRIDS[sg].help));
      });
      sec.appendChild(body);
      if (g.more) sec.appendChild(moreLink(g.more));
      if (g.foot) sec.appendChild(h('p', 'help section-foot', g.foot));
      host.appendChild(sec);
    });

    var dl = $('font-list');
    if (dl) {
      clear(dl);
      GOOGLE_FONTS.forEach(function (f) { var o = h('option'); o.value = f; o.label = 'Google Fonts'; dl.appendChild(o); });
      SYSTEM_FONT_NAMES.forEach(function (f) { var o = h('option'); o.value = f; o.label = 'Installed font'; dl.appendChild(o); });
    }
  }

  // ---------- sections ----------
  function panelOf(id) { return $('group-' + id); }

  function isAppLayout() { return !!(root.matchMedia && root.matchMedia(APP_LAYOUT).matches); }

  function selectSection(id, focusTab) {
    var ids = sectionIds();
    if (ids.indexOf(id) < 0) id = ids[0];
    B.ui.section = id;
    ids.forEach(function (s) {
      var on = s === id, t = $('tab-' + s), p = panelOf(s);
      if (t) {
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      }
      if (p) p.hidden = !on;
    });
    var body = $('panel-body');
    if (body) body.scrollTop = 0;
    var tab = $('tab-' + id);
    if (!tab) return;
    if (focusTab) tab.focus();
    showTab();
  }

  // Keep the chosen tab in view. In one column the tabs can be a row that scrolls sideways; in the app
  // layout the rail scrolls when the window leaves it too little height. The page itself stays put.
  function showTab() {
    var tab = $('tab-' + B.ui.section), list = $('tabs');
    if (!tab || !list) return;
    if (list.scrollWidth > list.clientWidth) {
      var left = tab.offsetLeft - list.offsetLeft, right = left + tab.offsetWidth;
      if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 16);
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 16;
    }
    var rail = list.parentNode;
    if (rail && rail.scrollHeight > rail.clientHeight) {
      var r = rail.getBoundingClientRect(), t = tab.getBoundingClientRect();
      if (t.top < r.top + RAIL_FADE) rail.scrollTop -= r.top + RAIL_FADE - t.top;
      else if (t.bottom > r.bottom - RAIL_FADE) rail.scrollTop += t.bottom - r.bottom + RAIL_FADE;
    }
    railEdges();
  }

  // A rail too long for its window fades out at the edge it runs on past (css/builder.css .more-above,
  // .more-below): it has no scrollbar, and a cut row of tabs alone does not say there are more.
  function railEdges() {
    var rail = $('tabs').parentNode, more = rail.scrollHeight - rail.clientHeight;
    var above = more > 1 && rail.scrollTop > 1, below = more > 1 && rail.scrollTop < more - 1;
    if (above) rail.classList.add('more-above'); else rail.classList.remove('more-above');
    if (below) rail.classList.add('more-below'); else rail.classList.remove('more-below');
  }

  // builder.html#obs and the like. In one column the settings are below the preview, so the page goes to
  // them; the app layout shows both. False when the hash names no section.
  function openHashSection() {
    var s = sectionFromHash(root.location.hash);
    if (!s) return false;
    selectSection(s, false);
    var main = $('settings');
    if (!isAppLayout() && main && main.scrollIntoView) main.scrollIntoView();
    showSubhead(root.location.hash);
    return true;
  }

  // builder.html#adv-text and the like: the Advanced sub-heading is scrolled into view. Reached from the page
  // ("More in Advanced", or a hash typed into the address bar) it takes the focus too, so the keyboard goes on
  // from there; on page load the focus stays where the browser put it.
  function showSubhead(hash) {
    var e = B.subheads[String(hash || '').replace(/^#/, '').toLowerCase()];
    if (!e) return;
    if (e.scrollIntoView) e.scrollIntoView();
    if (!B.started || !e.focus) return;
    var a = document.activeElement, body = $('panel-body');
    if (!a || a === document.body || (body && body.contains(a))) e.focus({ preventScroll: true });
  }

  // The tab the user picks replaces the one a link asked for: a section hash left in the address bar
  // would open its section again on reload. replaceState fires no hashchange and adds no history entry.
  function dropSectionHash() {
    if (!sectionFromHash(root.location.hash)) return;
    try {
      root.history.replaceState(root.history.state, '', String(root.location.href).split('#')[0]);
    } catch (e) { /* not allowed here: the hash stays */ }
  }

  function wireSections() {
    var list = $('tabs');
    var tabOf = function (node) {
      while (node && node !== list) {
        if (node.getAttribute && node.getAttribute('role') === 'tab') return node;
        node = node.parentNode;
      }
      return null;
    };
    list.addEventListener('click', function (e) {
      var t = tabOf(e.target);
      if (!t) return;
      selectSection(t.getAttribute('data-section'), false);
      dropSectionHash();
      saveUi();
    });
    // Arrow keys move along the tabs and open each one, in either direction the rail may run.
    list.addEventListener('keydown', function (e) {
      var t = tabOf(e.target);
      if (!t) return;
      var ids = sectionIds(), i = ids.indexOf(t.getAttribute('data-section')), n = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % ids.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i + ids.length - 1) % ids.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = ids.length - 1;
      if (n < 0) return;
      e.preventDefault();
      selectSection(ids[n], true);
      dropSectionHash();
      saveUi();
    });
    root.addEventListener('hashchange', function () { if (openHashSection()) saveUi(); });
    list.parentNode.addEventListener('scroll', railEdges);

    var mq =root.matchMedia ? root.matchMedia(APP_LAYOUT) : null;
    var orient = function () {
      list.setAttribute('aria-orientation', mq && mq.matches ? 'vertical' : 'horizontal');
      fitSoon();
    };
    if (mq && mq.addEventListener) mq.addEventListener('change', orient);
    else if (mq && mq.addListener) mq.addListener(orient);
    orient();
  }

  // Fields that only apply while another setting allows it (META.when, META.only): after every change.
  function syncDisabled() {
    for (var k in B.fields) {
      var m = META[k];
      if (m && (m.when || m.only)) B.fields[k].setDisabled(fieldOff(k, B.cfg));
    }
  }

  // Fields whose wording depends on the layout (META `horizontal`).
  function syncLabels() {
    for (var k in B.fields) {
      var f = B.fields[k];
      if (!f.labelEl || !META[k] || !META[k].horizontal) continue;
      var t = fieldText(k, B.cfg.layout);
      f.labelEl.textContent = t.label;
      if (f.helpEl) {
        f.helpEl.textContent = t.help;
        f.helpEl.hidden = !t.help;
      }
    }
  }

  // Every field's URL tag, and the count of changed settings on each tab.
  function syncTags() {
    var changed = changedKeys(B.cfg), counts = groupCounts(B.cfg);
    for (var k in B.fields) {
      var f = B.fields[k];
      f.tag.textContent = tagText(k, B.cfg, changed);
      if (changed[k] === true) f.tag.classList.add('changed'); else f.tag.classList.remove('changed');
    }
    groupLayout().forEach(function (g) {
      var n = counts[g.id] || 0, c = $('count-' + g.id), t = $('tab-' + g.id);
      if (c) c.textContent = n ? String(n) : '';
      if (t) t.setAttribute('aria-label', g.title + (n ? ', ' + n + ' changed' : ''));
    });
  }

  function syncForm() {
    for (var k in B.fields) B.fields[k].set(B.cfg[k]);
    syncDisabled();
    syncLabels();
  }

  // After a layout change: relabel, and the preview size becomes a bar (or a column again) unless the
  // user set it. fit() then picks the preview row or column.
  function followLayout(prevLayout, nextLayout) {
    // The frame hears about the layout before it is resized, so the overlay holds off trimming lines
    // until both have landed (renderer LAYOUT_SETTLE_MS) instead of trimming for the wrong one.
    postNow();
    syncLabels();
    syncDisabled();
    var s = layoutPreviewSize(B.ui, prevLayout, nextLayout);
    if (s) {
      B.ui.w = s.w;
      B.ui.h = s.h;
      $('pw').value = String(s.w);
      $('ph').value = String(s.h);
      renderSizes();
      saveUi();
    }
    fit();
  }

  // One setting changed from the form. Returns false when the value is invalid.
  function update(key, raw) {
    var v = config.coerce(key, raw);
    if (v === undefined) return false;
    if (sameValue(B.cfg[key], v)) return true;
    var prev = B.cfg[key];
    B.cfg[key] = v;
    if (key === 'layout') followLayout(prev, v);
    onChanged(key);
    return true;
  }

  function onChanged(key) {
    B.fileNote = '';
    syncDisabled();
    renderOutputs();
    saveCfg();
    if (isLiveKey(key)) postLive();
    else scheduleReload(RELOAD_DELAY);
  }

  // Swap the whole config (paste, reset, settings.js); reload only if a reload key changed.
  function replaceCfg(next) {
    var prev = B.cfg, reload = false;
    if (typeof next.font === 'string' && next.font) next.font = config.canonicalFont(next.font);
    B.cfg = next;
    B.fileNote = '';
    RELOAD_KEYS.forEach(function (k) { if (!sameValue(prev[k], next[k])) reload = true; });
    syncForm();
    if (prev.layout !== next.layout) followLayout(prev.layout, next.layout);
    $('channel').value = next.channel || '';
    if (next.kick !== prev.kick) checkKick(false);
    if (next.channel !== B.ch.login || B.ch.state === 'bad') checkChannel(next.channel);
    else renderChannelStatus(); // the field was rewritten: nothing typed is pending any more
    renderOutputs();
    showTab(); // the counts just put on the tabs change their widths
    saveCfg();
    postLive();
    if (reload) scheduleReload(RELOAD_DELAY);
  }

  // ---------- channel ----------
  function commitChannel(force) {
    var input = $('channel');
    var raw = input.value.trim();
    var login = raw ? config.normalizeChannel(raw) : '';
    if (raw && !login) {
      B.chSeq++;
      B.ch = { state: 'bad', login: raw, user: null };
      if (B.cfg.channel) { B.cfg.channel = ''; onChanged('channel'); }
      renderChannel();
      return;
    }
    if (input.value !== login) input.value = login;
    var changed = login !== B.cfg.channel;
    if (changed) { B.cfg.channel = login; onChanged('channel'); }
    if (changed || force || B.ch.login !== login || B.ch.state === 'error' || B.ch.state === 'bad') checkChannel(login);
  }

  function checkChannel(login) {
    var seq = ++B.chSeq;
    if (!login) {
      B.ch = { state: 'empty', login: '', user: null };
      renderChannel();
      scheduleReload(RELOAD_DELAY);
      return;
    }
    var cached = B.chCache.get(login);
    if (cached) { applyChannel(login, cached); return; }
    B.ch = { state: 'checking', login: login, user: null };
    renderChannel();
    util.fetchJson(IVR_USER + encodeURIComponent(login), { timeout: 8000 }).then(function (r) {
      if (seq !== B.chSeq) return;
      var res = util.isNotFound(r) ? { state: 'notfound' } : describeIvrUser(r, login);
      // An odd reply isn't kept: the next check (or the Check button) asks again.
      if (res.state !== 'error') B.chCache.set(login, res);
      applyChannel(login, res);
    }, function (e) {
      if (seq !== B.chSeq) return;
      // IVR answers 400 for names Twitch can't have (e.g. a leading underscore).
      applyChannel(login, e && e.status === 400 ? { state: 'notfound' } : { state: 'error' });
    });
  }

  function applyChannel(login, res) {
    B.ch = { state: res.state, login: login, user: res.user || null };
    renderChannel();
    scheduleReload(150);
  }

  // The channel's picture, or its initial in a circle when there is none to show.
  function avatarFor(u, login) {
    var name = String(u.displayName || login || '');
    var initial = function () {
      var s = h('span', 'avatar', name.charAt(0).toUpperCase());
      s.setAttribute('aria-hidden', 'true');
      return s;
    };
    if (!u.logo || !util.isSafeUrl(u.logo, AVATAR_HOST_RE)) return initial();
    var img = h('img', 'avatar');
    var full = u.logo, small = smallAvatar(full);
    img.src = small;
    img.alt = '';
    img.width = 28;
    img.height = 28;
    img.decoding = 'async';
    img.onerror = function () {
      if (small !== full) { small = full; img.src = full; return; } // no 70x70 rendition: the full image, once
      if (img.parentNode) img.parentNode.replaceChild(initial(), img);
    };
    return img;
  }

  // What the field holds that hasn't been looked up: 'typed', 'cleared', or '' when it is the checked name.
  function channelDraft() {
    var raw = $('channel').value.trim();
    if ((raw && config.normalizeChannel(raw) || raw) === B.ch.login) return '';
    return raw ? 'typed' : 'cleared';
  }

  function renderChannel() {
    renderChannelStatus();
    renderOutputs();
  }

  // The line beside the channel field. While a name is being typed it says how to look it up, not what
  // the last lookup found. (The overlay URL keeps the checked channel until the new one is committed.)
  function renderChannelStatus() {
    var box = $('channel-status');
    var draft = B.chDraft = channelDraft();
    var st = draft === 'typed' ? 'typed' : draft === 'cleared' ? 'empty' : B.ch.state, login = B.ch.login;
    var input = $('channel');
    input.setAttribute('aria-invalid', st === 'bad' || st === 'notfound' ? 'true' : 'false');
    if (st === 'empty' || st === 'typed') input.classList.add('need'); else input.classList.remove('need');
    // A live region: the same line written again (Reset, a paste, Enter on a cleared field) is read out again.
    var found = st === 'found' ? B.ch.user : null;
    var key = st + '|' + (st === 'empty' || st === 'typed' ? '' : login) +
      (found ? '|' + found.displayName + '|' + !!found.banned + '|' + found.logo : '');
    if (key === B.chStatusKey) return;
    B.chStatusKey = key;
    clear(box);
    var cls = { empty: '', bad: 'err', checking: 'busy', found: 'ok', notfound: 'err', error: 'warn' }[st] || '';
    box.className = 'status' + (cls ? ' ' + cls : '');
    if (st === 'typed') {
      box.textContent = 'Press Enter or Check to look up the name.';
    } else if (st === 'empty') {
      box.textContent = 'Enter your channel to preview its emotes and badges.';
    } else if (st === 'bad') {
      box.textContent = 'That isn’t a valid Twitch name. Use letters, numbers and _ only.';
    } else if (st === 'checking') {
      box.textContent = 'Checking “' + login + '”…';
    } else if (st === 'found') {
      var u = B.ch.user;
      box.appendChild(avatarFor(u, login));
      var t = h('span');
      t.appendChild(h('strong', null, u.displayName || login));
      t.appendChild(document.createTextNode(' found'));
      if (u.banned) {
        box.className = 'status warn';
        t.appendChild(document.createTextNode(', but the channel is suspended, so its chat may stay empty.'));
      }
      box.appendChild(t);
    } else if (st === 'notfound') {
      box.textContent = 'No Twitch channel called “' + login + '” was found.';
    } else {
      box.textContent = 'Couldn’t check “' + login + '” right now. The overlay will still try this name.';
    }
  }

  // ---------- Kick ----------
  // A new Kick channel: the old chatroom id belongs to the old channel, so it goes, and the new one is looked up.
  function onKickChanged(before) {
    if (before && B.cfg.kick_room) {
      update('kick_room', '');
      B.fields.kick_room.set('');
    }
    checkKick(false);
  }

  // Look up the Kick channel's chatroom id (kick.com's channel API) and fill in kick_room. Kick may refuse the
  // request from another site (Cloudflare): then the status line says how to copy the id by hand.
  // force: the Check button (looks up even when an id is already set).
  function checkKick(force) {
    var f = B.fields.kick;
    if (!f || !f.statusEl) return;
    var box = f.statusEl, slug = B.cfg.kick;
    var seq = ++B.kickSeq;
    clear(box);
    box.className = 'status';
    if (!slug || (B.cfg.kick_room && !force)) return;
    box.className = 'status busy';
    box.textContent = 'Looking up “' + slug + '” on Kick…';
    kick.lookupChannel(slug, { timeout: 8000 }).then(function (c) {
      if (seq !== B.kickSeq) return;
      clear(box);
      if (!c) {
        box.className = 'status err';
        box.textContent = 'No Kick channel called “' + slug + '” was found.';
        return;
      }
      update('kick_room', c.chatroomId);
      B.fields.kick_room.set(B.cfg.kick_room);
      box.className = 'status ok';
      var t = h('span');
      t.appendChild(h('strong', null, c.username || slug));
      t.appendChild(document.createTextNode(' found. Chatroom id ' + c.chatroomId + ' is filled in below.'));
      box.appendChild(t);
    }, function () {
      if (seq !== B.kickSeq) return;
      clear(box);
      box.className = 'status warn';
      var t = h('span');
      t.appendChild(document.createTextNode('Kick didn’t allow the lookup from this page. Open '));
      var a = h('a', null, 'the channel page');
      a.href = kick.apiUrl(slug);
      a.target = '_blank';
      a.rel = 'noopener';
      t.appendChild(a);
      t.appendChild(document.createTextNode(', then paste the whole page (or the number after "chatroom":{"id":) into the chatroom id below.'));
      box.appendChild(t);
    });
  }

  // ---------- paste existing URL ----------
  function loadPasted() {
    var input = $('paste'), st = $('paste-status');
    var text = input.value.trim();
    if (!text) { st.className = 'status'; st.textContent = ''; return; }
    var res = parsePasted(text);
    if (!res) {
      st.className = 'status err';
      st.textContent = 'No overlay settings found. Paste the full overlay URL (…/overlay.html?channel=…) or a settings.js.';
      return;
    }
    replaceCfg(res.cfg);
    st.className = 'status ok';
    st.textContent = 'Loaded ' + res.count + ' setting' + (res.count === 1 ? '' : 's') + '. Everything else is back to its default.';
  }

  // ---------- outputs ----------
  function renderNote() {
    var n = $('bar-note');
    var note = urlNote(B.cfg, B.ch, B.url);
    if (B.copied) note = { text: 'Copied. Paste it into an OBS Browser source.', cls: 'ok' };
    // What a settings.js on disk did at load, until the first change (a warning still comes first).
    else if (B.fileNote && note.cls !== 'warn') note = { text: B.fileNote, cls: 'ok' };
    n.textContent = note.text;
    n.className = 'status' + (note.cls ? ' ' + note.cls : '');
  }

  function renderOutputs() {
    var url = overlayUrl(B.cfg, root.location.href);
    var changed = url !== B.url;
    // The URL that was copied is no longer the one shown.
    if (changed && B.copied) { B.copied = false; clearTimeout(B.copiedTimer); }
    B.url = url;
    // Written only when it changes: writing it again would drop a selection made on it, and a lookup
    // that ends renders all of this again.
    if (changed) {
      // The URL with its parameters in color: names as the tags beside each setting, values in yellow.
      // One flex item holds every piece: flex items are blocks, and a selection copies a line break between blocks.
      var bar = $('bar-url'), parts = urlParts(url);
      clear(bar);
      var line = h('span', 'url-line');
      bar.appendChild(line);
      line.appendChild(h('span', 'u', parts.base));
      parts.params.forEach(function (p) {
        line.appendChild(h('span', 'q', p.sep));
        line.appendChild(h('span', 'k', p.key));
        if (p.eq) line.appendChild(h('span', 'q', '='));
        line.appendChild(h('span', 'v', p.value));
      });
      $('bar-open').href = url;
      $('out-url').textContent = url;
    }
    var snippet = settingsSnippet(B.cfg), out = $('out-settings');
    if (out.textContent !== snippet) out.textContent = snippet;
    renderNote();
    syncTags();
  }

  function renderSizes() {
    var ws = document.querySelectorAll('.obs-w'), hs = document.querySelectorAll('.obs-h');
    for (var i = 0; i < ws.length; i++) ws[i].textContent = String(B.ui.w);
    for (var j = 0; j < hs.length; j++) hs[j].textContent = String(B.ui.h);
  }

  // A button's words: its .lbl when it also holds an icon, else the button itself.
  function labelOf(btn) { return (btn.querySelector && btn.querySelector('.lbl')) || btn; }

  function flash(btn, text) {
    if (!btn) return;
    var lbl = labelOf(btn);
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', lbl.textContent);
    lbl.textContent = text;
    btn.classList.add('flash');
    clearTimeout(btn._tcoTimer);
    btn._tcoTimer = setTimeout(function () {
      lbl.textContent = btn.getAttribute('data-label');
      btn.classList.remove('flash');
    }, FLASH_MS);
    announce(text);
  }

  function execCopy(text) {
    var active = document.activeElement;
    var ta = h('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (active && active.focus) { try { active.focus(); } catch (e) { /* ignore */ } }
    return ok;
  }

  function selectNode(node) {
    try {
      if (node.select) { node.focus(); node.select(); return; }
      var r = document.createRange();
      r.selectNodeContents(node);
      var sel = root.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { /* ignore */ }
  }

  // navigator.clipboard needs a secure context (not OBS docks / LAN http); fall back to execCommand.
  function copyText(text, btn, fallbackNode, then) {
    var done = function (ok) {
      flash(btn, ok ? 'Copied!' : 'Press Ctrl+C');
      if (!ok && fallbackNode) selectNode(fallbackNode);
      if (then) then(ok);
    };
    var nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText && root.isSecureContext) {
      nav.clipboard.writeText(text).then(function () { done(true); }, function () { done(execCopy(text)); });
    } else {
      done(execCopy(text));
    }
  }

  // The URL was copied: the note beside it says what to do next, until the button resets or the URL changes.
  function noteCopied(ok) {
    if (!ok) return;
    B.copied = true;
    renderNote();
    clearTimeout(B.copiedTimer);
    B.copiedTimer = setTimeout(function () { B.copied = false; renderNote(); }, FLASH_MS);
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
      var href = URL.createObjectURL(blob);
      var a = h('a');
      a.href = href;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(href); }, 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- preview ----------
  function previewChannel() {
    var st = B.ch.state;
    return B.cfg.channel && B.ch.login === B.cfg.channel && (st === 'found' || st === 'error') ? B.cfg.channel : '';
  }

  function previewCfg() {
    var c = copyCfg(B.cfg);
    c.channel = previewChannel();
    c.demo = B.mode === 'demo' || !!B.cfg.demo;
    return c;
  }

  // The hint sits under the frame and takes its height from the stage, so the frame is fitted again.
  function setHint(text) {
    var el = $('stage-hint');
    var next = text || '';
    // The hint is a live region: writing the same text again would have it read out again.
    if ((el.hidden ? '' : el.textContent) === next) return;
    el.textContent = next;
    el.hidden = !next;
    fit();
  }

  function scheduleReload(delay) {
    clearTimeout(B.reloadTimer);
    B.reloadTimer = setTimeout(doReload, delay === undefined ? RELOAD_DELAY : delay);
  }

  function doReload() {
    B.reloadTimer = null;
    if (B.paused) return; // a live preview in a hidden tab: rebuilt when the tab shows again
    if (B.ch.state === 'checking') { setHint(B.frame ? '' : 'Checking the channel…'); return; } // the result reschedules
    var pc = previewCfg();
    var st = B.ch.state, hint = '';
    if (!pc.channel) {
      if (st === 'notfound') hint = 'Channel “' + B.ch.login + '” was not found.';
      else if (st === 'bad') hint = 'The channel name isn’t valid.';
      if (pc.demo) hint = (hint ? hint + ' ' : '') + 'Demo chat with global emotes only. Enter a channel to preview its own emotes and badges.';
      else if (!pc.kick) hint = (hint ? hint + ' ' : '') + 'Enter a channel (then press Enter) to watch its live chat here.';
    } else if (B.mode === 'live' && B.cfg.demo) {
      hint = 'Demo messages are switched on under Advanced, so the overlay shows fake chat.';
    }
    var modeEl = $('tag-mode'), mode = pc.demo ? 'demo' : 'live chat';
    if (modeEl.textContent !== mode) { modeEl.textContent = mode; fitSoon(); } // fit() picks how much of the tag line fits
    setHint(hint);
    if (!pc.channel && !pc.kick && !pc.demo) setFrame(null, null);
    // Badge and paint data a source turned on later is loaded by the overlay when the setting arrives.
    else setFrame(previewUrl(pc, root.location.href), reloadSignature(pc));
  }

  function setFrame(src, sig) {
    if (sig === B.frameSig && (sig === null || B.frame)) return;
    if (B.frame) {
      // Removing the frame unloads the old overlay, which closes its sockets.
      B.frame.parentNode.removeChild(B.frame);
      B.frame = null;
    }
    B.frameSig = sig;
    if (!src) return;
    var f = h('iframe', 'preview-frame');
    f.title = 'Overlay preview';
    // The preview can show any channel's live chat, so it runs sandboxed: scripts only, in an origin of its
    // own, with no reach into this page or its storage. (Settings still arrive by postMessage.) Not from
    // disk, where a sandboxed frame can't load overlay.html's files (see frameSandbox).
    var sb = frameSandbox(root.location.protocol);
    if (sb) f.setAttribute('sandbox', sb);
    f.src = src;
    f.addEventListener('load', function () { if (B.frame === f) postLive(); });
    B.frame = f;
    $('frame-box').appendChild(f);
    fit();
  }

  function postNow() {
    clearTimeout(B.postTimer);
    B.postTimer = null;
    var f = B.frame;
    if (!f || !f.contentWindow) return;
    try { f.contentWindow.postMessage({ type: 'tco-config', cfg: previewCfg() }, '*'); } catch (e) { /* ignore */ }
  }

  // Coalesce bursts (slider drags) into one message per ~frame.
  function postLive() {
    if (B.postTimer) return;
    B.postTimer = setTimeout(postNow, 30);
  }

  function px(v) { return parseFloat(v) || 0; }

  // Tab order follows the DOM, so the DOM follows the layout. The settings come before the preview only
  // where they sit to its left (the app layout without .wide-preview); Home and GitHub follow the brand only
  // where they share its row (one column). The preview is never the node moved: moving an iframe reloads it.
  function placeForLayout(wide) {
    var app = $('builder'), main = $('settings'), prev = $('preview');
    var top = app.querySelector('.top'), site = app.querySelector('.site'), ch = $('channel-card');
    var inApp = isAppLayout(), first = inApp && !wide;
    if ((main.nextElementSibling === prev) !== first) {
      var a = document.activeElement, keep = a && main.contains(a) ? a : null;
      var body = $('panel-body'), tabs = $('tabs'), st = body.scrollTop, sl = tabs.scrollLeft;
      app.insertBefore(main, first ? prev : app.querySelector('.bar'));
      body.scrollTop = st;
      tabs.scrollLeft = sl;
      if (keep) keep.focus({ preventScroll: true });
    }
    if ((site.nextElementSibling === ch) === inApp) {
      var b = document.activeElement, keepSite = b && site.contains(b) ? b : null;
      top.insertBefore(site, inApp ? null : ch);
      if (keepSite) keepSite.focus({ preventScroll: true });
    }
  }

  // Height (px) the settings need to show the whole rail: its tabs down to the last one, and the foot under it.
  // From the tabs, not the rail, which is as tall as it is given.
  function panelNeed() {
    var list = $('tabs'), rail = list.parentNode;
    return Math.ceil(list.getBoundingClientRect().bottom - rail.getBoundingClientRect().top + rail.scrollTop +
      px(root.getComputedStyle(rail).paddingBottom)) + document.querySelector('.panel-foot').offsetHeight;
  }

  // Size the source frame to the stage. The stage also holds the tag line above the frame and, at times,
  // a hint below it; the frame gets the height that is left.
  function fit(again) {
    var stage = $('stage'), box = $('frame-box'), tag = $('frame-tag'), hint = $('stage-hint');
    var app = isAppLayout();
    var wide = wantsWidePreview(B.cfg.layout, B.ui.w, B.ui.h, app);
    $('builder').classList.toggle('wide-preview', wide);
    placeForLayout(wide);
    var cs = root.getComputedStyle(stage);
    var padV = px(cs.paddingTop) + px(cs.paddingBottom);
    var aw = stage.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    var tagH = tag.offsetHeight;
    var extra = tagH + px(root.getComputedStyle(tag.parentNode).rowGap);
    if (!hint.hidden) extra += hint.offsetHeight + px(cs.rowGap);
    // In the app layout the window is shared out: top bar, the preview's own bar, this stage, the settings
    // (every tab of the rail, and Reset below it) and the URL bar.
    var room = wide && app ? root.innerHeight - document.querySelector('.top').offsetHeight -
      document.querySelector('.bar').offsetHeight - ($('preview').offsetHeight - stage.offsetHeight) - panelNeed() : null;
    stage.style.height = wide ? wideStageHeight(aw, padV + extra + px(cs.borderTopWidth) +
      px(cs.borderBottomWidth), B.ui.w, B.ui.h, root.innerHeight, room) + 'px' : '';
    var ah = stage.clientHeight - padV - extra;
    var s = fitScale(B.ui.w, B.ui.h, aw, ah);
    box.style.width = Math.floor(B.ui.w * s) + 'px';
    box.style.height = Math.floor(B.ui.h * s) + 'px';
    if (B.frame) {
      B.frame.style.width = B.ui.w + 'px';
      B.frame.style.height = B.ui.h + 'px';
      B.frame.style.transform = s < 1 ? 'scale(' + s + ')' : 'none';
    }
    var note = $('scale-note'), pct = Math.round(s * 100) + '%', text = $('tag-text'), src = $('tag-src');
    var fw = Math.floor(B.ui.w * s), gap = px(root.getComputedStyle(tag).columnGap);
    src.hidden = false;
    note.textContent = B.ui.w + ' × ' + B.ui.h + (s < 1 ? ' · shown at ' + pct : ' · 100%');
    // A frame too narrow for that line (a phone) gets the short note, and one too narrow even for that
    // drops the words "Browser source", so the tag is no wider than the frame.
    if (text.offsetWidth + gap + note.offsetWidth > fw) note.textContent = s < 1 ? 'at ' + pct : '100%';
    if (text.offsetWidth + gap + note.offsetWidth > fw) src.hidden = true;
    // In a narrow stage the tag wraps, and the new note can change that: measure once more.
    if (again !== true && tag.offsetHeight !== tagH) { fit(true); return; }
    // The moon is decoration, and the tag line's light text is lost on it.
    var moon = stage.querySelector('.moon').getBoundingClientRect();
    var onMoon = Array.prototype.some.call(tag.children, function (el) {
      var r = el.getBoundingClientRect();
      return r.right > moon.left && r.left < moon.right && r.bottom > moon.top && r.top < moon.bottom;
    });
    if (onMoon) stage.classList.add('tag-on-moon'); else stage.classList.remove('tag-on-moon');
    // The rail's height follows the stage (app layout). The one-column row only when its width changes
    // (a new layout, a turned phone): a phone's address bar resizes the window at every scroll, and that
    // would undo a swipe through the row.
    var rowW = $('tabs').clientWidth;
    if (app || rowW !== B.tabsW) showTab();
    B.tabsW = rowW;
  }

  function fitSoon() {
    if (!B || B.fitQueued) return;
    B.fitQueued = true;
    var run = function () { B.fitQueued = false; fit(); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function setBackdrop(v) {
    B.ui.backdrop = v;
    var stage = $('stage');
    BACKDROPS.forEach(function (b) { stage.classList.remove('bd-' + b); });
    stage.classList.add('bd-' + v);
  }

  function wirePreview() {
    var modes = document.querySelectorAll('input[name="pmode"]');
    Array.prototype.forEach.call(modes, function (r) {
      r.checked = r.value === B.mode;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        B.mode = r.value === 'live' ? 'live' : 'demo';
        scheduleReload(RELOAD_DELAY);
      });
    });
    var bds = document.querySelectorAll('input[name="backdrop"]');
    Array.prototype.forEach.call(bds, function (r) {
      r.checked = r.value === B.ui.backdrop;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        setBackdrop(r.value);
        fit(); // each backdrop has its own moon, or none
        saveUi();
      });
    });
    setBackdrop(B.ui.backdrop);

    ['w', 'h'].forEach(function (dim) {
      var inp = $(dim === 'w' ? 'pw' : 'ph');
      var lim = SIZE_LIMITS[dim];
      inp.min = String(lim[0]);
      inp.max = String(lim[1]);
      inp.value = String(B.ui[dim]);
      inp.addEventListener('input', function () {
        var n = parseInt(inp.value, 10);
        if (!isFinite(n) || n < lim[0] || n > lim[1]) return;
        B.ui[dim] = n;
        fit();
        renderSizes();
        saveUi();
      });
      inp.addEventListener('change', function () {
        B.ui[dim] = clampInt(inp.value, lim[0], lim[1], B.ui[dim]);
        inp.value = String(B.ui[dim]);
        fit();
        renderSizes();
        saveUi();
      });
    });

    // A frame later: fit() may resize the stage it observes, which inside the callback is a loop warning.
    // The hint too: it takes height from the frame, and it wraps differently once the web font arrives.
    if (root.ResizeObserver) {
      var ro = new root.ResizeObserver(fitSoon);
      ro.observe($('stage'));
      ro.observe($('stage-hint'));
      ro.observe($('tabs')); // a count that wraps a tab's name changes what the settings need (panelNeed)
    }
    // Also for height-only window changes: the wide stage's height follows the window.
    root.addEventListener('resize', fitSoon);
    // The tag line is picked by measuring its text, which is wider in the web font than in the fallback.
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fitSoon);

    // A window change can hide the focused site link (Home at 1100-1299px, GitHub under 480px), and the
    // focus would fall to the page. It goes to the nearest link before it that is shown (the brand is Home).
    var site = $('builder').querySelector('.site'), brand = $('builder').querySelector('.brand');
    if (site && brand) site.addEventListener('focusout', function (e) {
      var t = e.target;
      if (e.relatedTarget) return;
      setTimeout(function () {
        if (document.activeElement !== document.body || t.getClientRects().length) return;
        var links = [brand].concat(Array.prototype.slice.call(site.children));
        for (var i = links.indexOf(t) - 1; i >= 0; i--) {
          if (links[i].getClientRects().length) { links[i].focus({ preventScroll: true }); return; }
        }
      }, 0);
    });

    // A live preview is a second chat client (IRC, 7TV and BTTV sockets, lookups). In a tab left hidden
    // it disconnects after a while; a quick switch to OBS to paste the URL keeps it.
    var hideTimer = null;
    document.addEventListener('visibilitychange', function () {
      clearTimeout(hideTimer);
      if (document.hidden) {
        hideTimer = setTimeout(function () {
          if (!document.hidden || previewCfg().demo || !B.frame) return;
          B.paused = true;
          setFrame(null, null);
        }, HIDDEN_GRACE);
      } else if (B.paused) {
        B.paused = false;
        scheduleReload(0);
      }
    });
  }

  // ---------- wiring ----------
  function wireChannel() {
    var ch = $('channel');
    ch.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitChannel(false); }
    });
    ch.addEventListener('change', function () { commitChannel(false); });
    // Only when the pending state flips, so the live status isn't read out again at every keystroke.
    ch.addEventListener('input', function () { if (channelDraft() !== B.chDraft) renderChannelStatus(); });
    $('channel-check').addEventListener('click', function () {
      var login = config.normalizeChannel(ch.value);
      // The blur before this click may already have started the same lookup.
      if (B.ch.state === 'checking' && B.ch.login === login) return;
      B.chCache.delete(login);
      commitChannel(true);
    });
  }

  // "Edit an existing overlay": a <details>. In the app layout it opens over the page, so there Escape, a
  // click elsewhere or focus moving on closes it; in one column it is part of the page and covers nothing,
  // so only its summary, or Escape inside it, closes it.
  function wirePaste() {
    var box = $('paste-box'), paste = $('paste');
    box.addEventListener('toggle', function () { if (box.open) paste.focus(); });
    // Only a press that starts outside closes it: a text selection dragged past its edge sends the
    // click to an element the press and release share, which is outside the box.
    var downIn = false;
    document.addEventListener('pointerdown', function (e) { downIn = box.contains(e.target); }, true);
    document.addEventListener('click', function (e) {
      var fromIn = downIn;
      downIn = false;
      if (box.open && isAppLayout() && !fromIn && !box.contains(e.target)) box.open = false;
    });
    // A click in the preview goes to the frame's own document and never reaches this one;
    // this window loses focus to the frame instead.
    root.addEventListener('blur', function () {
      setTimeout(function () {
        var a = document.activeElement;
        if (box.open && isAppLayout() && a && a.tagName === 'IFRAME') box.open = false;
      }, 0);
    });
    // It must never hide the control that has focus. relatedTarget is null when the whole window loses
    // focus: a trip to OBS and back keeps it as it was.
    box.addEventListener('focusout', function (e) {
      if (box.open && isAppLayout() && e.relatedTarget && !box.contains(e.relatedTarget)) box.open = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !box.open) return;
      var a = document.activeElement, inside = !!a && box.contains(a);
      if (!inside && !isAppLayout()) return;
      box.open = false;
      var s = box.querySelector('summary');
      if (s && (inside || !a || a === document.body)) s.focus();
    });
    // A textarea (keeps a pasted settings.js's line breaks): Enter loads, Shift+Enter adds a line.
    paste.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); loadPasted(); }
    });
    paste.addEventListener('paste', function () { setTimeout(loadPasted, 0); });
    $('paste-load').addEventListener('click', loadPasted);
  }

  // Add to OBS shows one route at a time: a Browser source with the URL, or Local file with settings.js.
  function setRoute(v) {
    B.route = v === 'local' ? 'local' : 'url';
    $('obs-url').hidden = B.route !== 'url';
    $('obs-local').hidden = B.route !== 'local';
    var rs = document.querySelectorAll('input[name="route"]');
    Array.prototype.forEach.call(rs, function (r) { r.checked = r.value === B.route; });
  }

  function wireOutputs() {
    $('bar-copy').addEventListener('click', function () { copyText(B.url, $('bar-copy'), $('bar-url'), noteCopied); });
    $('out-copy').addEventListener('click', function () { copyText(B.url, $('out-copy'), $('out-url'), noteCopied); });
    $('settings-copy').addEventListener('click', function () {
      copyText($('out-settings').textContent, $('settings-copy'), $('out-settings'));
    });
    $('settings-dl').addEventListener('click', function () {
      var ok = download('settings.js', $('out-settings').textContent);
      flash($('settings-dl'), ok ? 'Downloaded' : 'Download failed: copy it instead');
    });
    // Reached with the keyboard, the URL is selected whole, ready for Ctrl+C.
    $('bar-url').addEventListener('focus', function () {
      var el = this, byKey = true;
      try { byKey = el.matches(':focus-visible'); } catch (e) { /* an old browser: select anyway */ }
      if (byKey) selectNode(el);
    });
    // Clicked, it is selected whole as well, as a read-only field would be. A drag or a double click
    // keeps its own selection.
    $('bar-url').addEventListener('click', function () {
      if (String(root.getSelection()) === '') selectNode(this);
    });
    var rs = document.querySelectorAll('input[name="route"]');
    Array.prototype.forEach.call(rs, function (r) {
      r.addEventListener('change', function () { if (r.checked) setRoute(r.value); });
    });
    setRoute(B.route);
    $('reset').addEventListener('click', function () {
      var d = config.defaults();
      d.channel = B.cfg.channel;
      d.kick = B.cfg.kick;
      d.kick_room = B.cfg.kick_room;
      replaceCfg(d);
      flash($('reset'), 'Reset');
    });
  }

  // Local-file flow: opened from disk, show the settings.js route first and pick up an existing settings.js.
  // A settings.js the builder already loaded once doesn't replace the edits made here since (a snapshot of
  // it per folder says so); a new or changed settings.js does.
  function setupLocalFile(hasQuery, fromStore) {
    if (root.location.protocol !== 'file:') return;
    document.body.classList.add('is-file');
    setRoute('local');
    $('file-intro').hidden = false;
    $('file-url-note').hidden = false;
    var get = $('step-get-files');
    if (get) get.hidden = true;
    if (hasQuery) return;
    var s = document.createElement('script');
    s.src = 'settings.js?t=' + Date.now();
    s.onload = function () {
      var o = root.TCO_SETTINGS;
      if (!o || typeof o !== 'object') return;
      var fileCfg = config.parse('', o);
      var snap = JSON.stringify(config.toObject(fileCfg));
      var key = STORE_FILE_BASE + folderOf(root.location.pathname);
      var seen = lastSnapshot(loadStored(key), loadStored(key + 'index.html'));
      // Said where it can be seen whatever section is open (beside the URL, until the first change), and
      // to screen readers; Add to OBS keeps its copy.
      var note = $('file-loaded');
      var say = function (text) {
        if (note) { note.textContent = text; note.hidden = false; }
        B.fileNote = text;
        renderNote();
        announce(text);
      };
      if (fromStore && seen === snap) {
        say('Kept your changes from last time: the settings.js in this folder hasn’t changed since the builder loaded it.');
        return;
      }
      store(key, snap);
      replaceCfg(fileCfg);
      say('Loaded the settings.js from this folder.'); // after replaceCfg, which clears the note
    };
    s.onerror = function () { /* no settings.js yet: fine */ };
    document.head.appendChild(s);
  }

  function initialCfg() { return startCfg(root.location.search, loadStored(STORE_CFG)); }

  function start() {
    if (B || !$('builder')) return;
    // The font stylesheet comes in as media="print" so a slow font host can't hold up the page or
    // its scripts (the CSP allows no inline onload); it applies once loaded.
    var font = $('font-css');
    if (font) {
      var useFont = function () { font.media = 'all'; fitSoon(); };
      if (font.sheet) useFont(); else font.addEventListener('load', useFont);
    }
    B = {
      cfg: config.defaults(),
      fields: {},
      ch: { state: 'empty', login: '', user: null },
      chSeq: 0,
      kickSeq: 0,
      chDraft: '',
      chStatusKey: '',
      chCache: new Map(),
      mode: 'demo',
      route: 'url',
      url: '',
      copied: false,
      copiedTimer: null,
      fileNote: '',
      ui: { w: UI_DEFAULTS.w, h: UI_DEFAULTS.h, backdrop: UI_DEFAULTS.backdrop, section: UI_DEFAULTS.section },
      frame: null,
      frameSig: null,
      reloadTimer: null,
      postTimer: null,
      fitQueued: false,
      tabsW: null,
      sayTimer: null,
      paused: false,
      storage: undefined,
      subheads: Object.create(null), // Advanced sub-heading id -> its <h3> (buildGroups)
      started: false // start() is done: a hash from now on comes from the user
    };
    var u = loadStored(STORE_UI);
    if (u && typeof u === 'object') {
      B.ui.w = clampInt(u.w, SIZE_LIMITS.w[0], SIZE_LIMITS.w[1], UI_DEFAULTS.w);
      B.ui.h = clampInt(u.h, SIZE_LIMITS.h[0], SIZE_LIMITS.h[1], UI_DEFAULTS.h);
      if (BACKDROPS.indexOf(u.backdrop) >= 0) B.ui.backdrop = u.backdrop;
      if (typeof u.section === 'string' && sectionIds().indexOf(u.section) >= 0) B.ui.section = u.section;
    }

    buildGroups();
    wireSections();
    wireChannel();
    wirePaste();
    wireOutputs();
    wirePreview();
    renderSizes();
    // A link can open a section (builder.html#obs); otherwise the one that was open last time.
    if (!openHashSection()) selectSection(B.ui.section, false);

    var init = initialCfg();
    // Read before replaceCfg saves: stored settings from another folder's builder aren't "your changes" here.
    var ownStore = init.fromStore && folderOf(loadStored(STORE_CFG_PATH)) === folderOf(root.location.pathname);
    renderChannel();
    replaceCfg(init.cfg);
    // A stored preview size may belong to the other layout (1920×100 saved in a horizontal session,
    // then ?channel=… opens a vertical one): swap it like a layout switch would.
    var other = B.cfg.layout === 'horizontal' ? 'vertical' : 'horizontal';
    if (layoutPreviewSize(B.ui, other, B.cfg.layout)) followLayout(other, B.cfg.layout);
    scheduleReload(0);
    setupLocalFile(init.fromQuery, ownStore);
    fit();
    B.started = true;
  }

  return {
    start: start,
    META: META,
    GROUPS: GROUPS,
    BADGE_SUBS: BADGE_SUBS,
    SUBGRIDS: SUBGRIDS,
    DEMO_INERT: DEMO_INERT,
    LAYOUT_SIZES: LAYOUT_SIZES,
    RELOAD_KEYS: RELOAD_KEYS,
    GOOGLE_FONTS: GOOGLE_FONTS,
    SYSTEM_FONT_NAMES: SYSTEM_FONT_NAMES,
    APP_LAYOUT: APP_LAYOUT,
    isLiveKey: isLiveKey,
    groupLayout: groupLayout,
    overlayUrl: overlayUrl,
    previewUrl: previewUrl,
    settingsSnippet: settingsSnippet,
    parsePasted: parsePasted,
    relaxedJson: relaxedJson,
    reloadSignature: reloadSignature,
    frameSandbox: frameSandbox,
    folderOf: folderOf,
    lastSnapshot: lastSnapshot,
    smallAvatar: smallAvatar,
    layoutPreviewSize: layoutPreviewSize,
    wantsWidePreview: wantsWidePreview,
    wideStageHeight: wideStageHeight,
    fieldText: fieldText,
    fitScale: fitScale,
    describeIvrUser: describeIvrUser,
    startCfg: startCfg,
    changedKeys: changedKeys,
    tagText: tagText,
    groupCounts: groupCounts,
    urlParts: urlParts,
    urlNote: urlNote,
    valueText: valueText,
    parseStep: parseStep,
    stepValue: stepValue,
    segValues: segValues,
    sectionIds: sectionIds,
    sectionFromHash: sectionFromHash,
    advIds: advIds,
    fieldOff: fieldOff,
    subgridOf: subgridOf,
    widgetFor: widgetFor
  };
});
