/* DOM rendering: pending queue, line lifecycle (fade, trim, moderation), indexes, paint stylesheet, re-render. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var icons = typeof require === 'function' ? require('./icons.js') : root.TCO.icons;
  var api = factory(root, util, icons);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).renderer = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, icons) {
  'use strict';

  // ---------- constants ----------
  var FONT_PX = { small: 18, medium: 24, large: 32 };
  var EMOTE_EM = 1.75;        // emote height in em (--emote-h)
  var EMOTE_BASE_PX = 28;     // height of a 1x emote / cheermote
  var BADGE_BASE_PX = 18;     // size of a 1x badge
  var GIPHY_FIXED_PX = 200;   // height of Giphy's tallest fixed-height GIF file, the one tokenizer.js asks for
  var SHADOWS = [
    'none',
    'drop-shadow(1px 1px 1px rgba(0,0,0,.8))',
    'drop-shadow(0 0 1px rgba(0,0,0,.9)) drop-shadow(1px 2px 2px rgba(0,0,0,.75))',
    'drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000) drop-shadow(2px 3px 4px rgba(0,0,0,.9))'
  ];
  var DEFAULT_SHADOW = 2;
  // shadow_style=text: each level as text-shadow layers on the letters, not a filter over the whole line. A
  // drop-shadow's blur is a standard deviation and a text-shadow's a radius (twice that), so the blurs double.
  var TEXT_SHADOWS = [
    '',
    '1px 1px 2px rgba(0,0,0,.8)',
    '0 0 2px rgba(0,0,0,.9), 1px 2px 4px rgba(0,0,0,.75)',
    '0 0 4px #000, 0 0 2px #000, 2px 3px 8px rgba(0,0,0,.9)'
  ];
  // How far each level's text shadow reaches past the letters (offset plus blur, the farther axis): the room it
  // needs where an edge is clipped.
  var TEXT_SHADOW_ROOM = ['', '3px', '6px', '11px'];
  // outline=1..3: how far the eight sharp copies of the text that draw the outline sit from it.
  var OUTLINE_EM = ['', '.04em', '.06em', '.08em'];
  var OUTLINE_DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  var IN_MS = 180;            // tco-in / tco-in-x (animate=1): enter_ms's default
  var SLIDE_MS = 250;         // animate=1: a row glides left (and with smooth_scroll a column up or down) to make room
  var LAYOUT_SETTLE_MS = 300; // after a live layout switch no trimming, until the builder has resized the preview too
  var FADE_OUT_MS = 1000;     // tco-fade length (fade_out_ms's default); the line is gone exactly `fade` s after it arrived
  var FLUSH_FALLBACK_MS = 250;
  var FLUSH_GAP_MS = 100;     // busy chat: at most one flush (layout + paint) per this many ms
  var SWEEP_MS = 1000;        // fade safety sweep, in case animationend never fires
  var DELETED_TTL_MS = 600000;
  var DELETED_CAP = 5000;
  var CLEARED_TTL_MS = 3600000; // timed-out / banned users: replies quoting their earlier messages lose the header
  var CLEARED_CAP = 1000;
  var MAX_IMAGES = 200;       // emote images per message (base + overlays); the rest render as their names
  var PAINT_ID_RE = /^[0-9A-Za-z]{1,40}$/;
  var HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
  var ANN_COLORS = ['PRIMARY', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE'];
  // Platforms other than Twitch that mark their lines with a class (.line.platform-kick). Twitch lines get none.
  var LINE_PLATFORMS = { kick: 1 };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Kept equal to config.GENERIC_FONT_NAMES (tests/renderer-dom.test.js checks).
  var GENERIC_FONTS = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
    'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];
  var RERENDER_KEYS = ['size', 'badges', 'badges_twitch', 'badges_kick', 'platform_icons', 'badges_7tv', 'badges_bttv',
    'badges_ffz', 'badges_ffzap', 'badges_chatterino', 'badges_homies', 'paints', 'readable', 'replies', 'gifs',
    'first_msg', 'shared', 'layout', // layout: a row draws gigantified emotes at emote height, so it picks smaller files
    'accent_bar',
    // The sizes: images are fetched for the size they are drawn at, and an emote-only line gets its class. gif_size
    // too: a GIF drawn taller than Giphy's 200 px file loads the original (partsFor).
    'text_px', 'badge_size', 'emote_scale', 'emote_only', 'giant_emotes', 'gif_size',
    // The name colors come from deps.nameFor (overlay.js reads these); the rest are drawn into the line.
    'name_color', 'name_fallback', 'readable_level', 'name_sep', 'timestamps', 'reply_style',
    // The highlights are line classes (lineClasses); their colors are #chat variables (ROOT_KEYS).
    'mentions', 'keywords', 'highlight_users', 'points_highlight', 'role_style',
    // links=shorten rewrites the text (overlay.js tokensFor) and reply headers; links=hide is a filter, and a reply
    // header quoting a link goes (deps.quoteHidden).
    'links'];
  // Each line goes by deps.shouldShow (overlay.js): a change sweeps the lines it now hides.
  var FILTER_KEYS = ['bots', 'hide_commands', 'block', 'events', 'shared', 'event_subs', 'event_gifts', 'event_raids',
    'event_bits_badge', 'event_announcements', 'role_filter', 'allow_users', 'block_words', 'min_length', 'links',
    'command_prefixes'];
  // setConfig handles these itself: applyRoot (#chat classes and variables), reordering, fade re-timing, capping.
  var ROOT_KEYS = ['size', 'font', 'shadow', 'bg', 'layout', 'align', 'animate', 'fade', 'max', 'text_weight',
    'text_color', 'line_height', 'text_case', 'names', 'name_weight', 'name_line', 'bg_color', 'bg_shape', 'bg_width',
    'spacing', 'notice_color', 'notice_size', 'first_msg_color', 'shadow_color', 'shadow_style', 'outline',
    'outline_color', 'paint_images', 'text_align', 'line_width', 'pad_x', 'edge_fade', 'row_sep', 'text_px', 'badge_size',
    'emote_scale', 'emote_only', 'gif_size', 'name_font', 'mention_color', 'keyword_color', 'points_color',
    'broadcaster_color', 'mod_color', 'vip_color',
    // The animations: new lines take the entrance; a timing or exit change re-times the fades (restartFades).
    'enter_style', 'enter_ms', 'fade_out_ms', 'exit_style',
    // A column's glide: the next new line starts one (glideOf); turned off, a running one stops (stopGlide).
    'smooth_scroll'];

  // config.js weight names -> font-weight. The stylesheet's own are 600 (text) and 800 (names).
  var WEIGHT_NAMES = ['light', 'regular', 'semibold', 'bold', 'heavy', 'black'];
  var WEIGHTS = { light: 300, regular: 400, semibold: 600, bold: 700, heavy: 800, black: 900 };
  // bg_shape: the box corners. round is the stylesheet's .4em (.3em on a channel-points highlighted line).
  var BG_RADIUS = { square: '0', soft: '.2em', pill: '1em' };
  // spacing: the gap between messages. A column pads (or, with bg, spaces) each line by .15em at normal; a row
  // leaves 1em between messages, .4em between boxes (the second value).
  var LINE_GAP = { tight: '.05em', loose: '.3em', extra: '.5em' };
  var ROW_GAP = { tight: ['.5em', '.2em'], loose: ['1.5em', '.6em'], extra: ['2em', '.8em'] };
  // emote_only: how many times as tall an emote-only line draws its emotes (--eo). normal draws them as any other.
  var EMOTE_ONLY = { big: 2, huge: 3 };
  // gif_size: a GIF's height in emote heights (--gif-mul); 3x is the stylesheet's. At 1x a GIF also takes an emote's
  // margins (--gif-margin), so its line is no taller than one with emotes: as css/overlay.css gives an emote in a column,
  // -.3em .05em, except that it reaches past its line only as far as there is room: one taller than its line (emote_scale
  // above 100) never above it and at most .2em below it, less at a line_height below 135, and at spacing=tight without a
  // box no more than twice the gap (--emote-hang). A row draws GIFs with its own margins. --gif-margin is set on #chat,
  // where --emote-h, --line-height and --emote-hang are too, so the var()s below take #chat's values.
  var GIF_MUL = { '1x': '1', '2x': '2' };
  var EMOTE_ROOM = '.3em, var(--emote-hang, .3em), 2.05em - var(--emote-h, 1.75em), ' +
    '(2 * var(--line-height, 1.35) - .65) * 1em - var(--emote-h, 1.75em)';
  var GIF_1X_MARGIN = 'calc(-1 * max(0em, min(' + EMOTE_ROOM + '))) .05em ' +
    'calc(-1 * max(min(.2em, var(--emote-hang, .3em)), min(' + EMOTE_ROOM + ')))';
  // name_sep: what goes between the name and the message (a /me line keeps its space). Never '': the name and
  // the message would run together.
  var NAME_SEPS = { colon: ': ', space: ' ', dash: ' – ', arrow: ' › ' };
  // enter_style: each entrance's keyframes (css/overlay.css) in a column and in a row. slide is the column's rise and
  // the row's slide in from the right, as always; pop grows a row's message from its middle.
  var ENTER = { slide: ['tco-in', 'tco-in-x'], fade: ['tco-in-fade', 'tco-in-fade'], pop: ['tco-in-pop', 'tco-in-pop-x'],
    drop: ['tco-in-drop', 'tco-in-drop'] };
  // exit_style=slide: the line moves out toward the edge old lines leave by as it fades: the top of a column, the bottom
  // of one with the newest line on top (newestFirst), the left end of a row.
  var EXIT_SLIDE = { up: 'tco-out-slide', down: 'tco-out-slide-down', left: 'tco-out-slide-x' };
  // Every name onAnimEnd acts on, whatever the settings were when the animation began.
  var ENTER_NAMES = ['tco-in', 'tco-in-x', 'tco-in-fade', 'tco-in-pop', 'tco-in-pop-x', 'tco-in-drop'];
  var EXIT_NAMES = ['tco-fade', 'tco-out-slide', 'tco-out-slide-down', 'tco-out-slide-x'];
  // Text that draws nothing: spaces, and format and other invisible characters (U+E0000 and U+034F, the suffixes
  // chat clients add to send the same message twice). An emote-only line may have them between its emotes.
  var BLANK_RE = /^[\s\p{Cf}\p{Default_Ignorable_Code_Point}]*$/u;

  // The values normalizeCfg makes safe, each with its config.js default (tests/parity.test.js checks they
  // match SPEC): values = the enum's choices, min/max = an int's range, bool = missing means the default,
  // str = a string or the default, hex = a config color (bare lowercase rrggbb) or the default ''. Tests and
  // older callers pass partial cfgs, so a missing key reads as today.
  var NORM = {
    size: { values: ['small', 'medium', 'large'], def: 'medium' },
    layout: { values: ['vertical', 'horizontal'], def: 'vertical' },
    align: { values: ['bottom', 'top'], def: 'bottom' },
    shadow: { min: 0, max: 3, def: DEFAULT_SHADOW },
    bg: { min: 0, max: 100, def: 0 },
    fade: { min: 0, max: 3600, def: 0 },
    max: { min: 1, max: 200, def: 50 },
    animate: { bool: true, def: true },
    enter_style: { values: ['slide', 'fade', 'pop', 'drop'], def: 'slide' },
    enter_ms: { min: 50, max: 1000, def: IN_MS },
    fade_out_ms: { min: 0, max: 10000, def: FADE_OUT_MS },
    exit_style: { values: ['fade', 'slide'], def: 'fade' },
    smooth_scroll: { bool: true, def: false },
    font: { str: true, def: 'Inter' },
    text_weight: { values: WEIGHT_NAMES, def: 'semibold' },
    text_color: { hex: true, def: '' },
    line_height: { min: 100, max: 200, def: 135 },
    text_case: { values: ['none', 'upper', 'lower', 'smallcaps'], def: 'none' },
    names: { bool: true, def: true },
    name_weight: { values: WEIGHT_NAMES, def: 'heavy' },
    name_line: { bool: true, def: false },
    bg_color: { hex: true, def: '' },
    bg_shape: { values: ['square', 'soft', 'round', 'pill'], def: 'round' },
    bg_width: { values: ['fit', 'full'], def: 'fit' },
    spacing: { values: ['tight', 'normal', 'loose', 'extra'], def: 'normal' },
    notice_color: { hex: true, def: '' },
    notice_size: { min: 50, max: 150, def: 85 },
    first_msg_color: { hex: true, def: '' },
    shadow_color: { hex: true, def: '' },
    shadow_style: { values: ['filter', 'text'], def: 'filter' },
    outline: { min: 0, max: 3, def: 0 },
    outline_color: { hex: true, def: '' },
    paint_images: { values: ['animated', 'static'], def: 'animated' },
    text_align: { values: ['left', 'center', 'right'], def: 'left' },
    line_width: { min: 0, max: 100, def: 0 },
    pad_x: { min: 0, max: 200, def: 8 },
    edge_fade: { min: 0, max: 10, def: 0 },
    row_sep: { values: ['none', 'dot', 'bar', 'diamond'], def: 'none' },
    text_px: { min: 0, max: 96, def: 0 }, // 1..7 is drawn as 8 (pxFor), as config.js stores it
    badge_size: { min: 50, max: 200, def: 100 },
    emote_scale: { min: 50, max: 200, def: 100 },
    emote_only: { values: ['normal', 'big', 'huge'], def: 'normal' },
    gif_size: { values: ['1x', '2x', '3x'], def: '3x' },
    giant_emotes: { bool: true, def: true },
    name_font: { str: true, def: '' },
    name_sep: { values: ['colon', 'space', 'dash', 'arrow'], def: 'colon' },
    timestamps: { values: ['off', '12h', '24h'], def: 'off' },
    reply_style: { values: ['full', 'name'], def: 'full' },
    mentions: { values: ['off', 'at', 'name'], def: 'off' },
    mention_color: { hex: true, def: '' },
    keyword_color: { hex: true, def: '' },
    points_highlight: { bool: true, def: true },
    points_color: { hex: true, def: '' },
    role_style: { values: ['off', 'bar', 'tint'], def: 'off' },
    broadcaster_color: { hex: true, def: '' },
    mod_color: { hex: true, def: '' },
    vip_color: { hex: true, def: '' }
  };
  var NORM_KEYS = Object.keys(NORM);
  var NORM_DEFAULTS = {};
  for (var nk = 0; nk < NORM_KEYS.length; nk++) NORM_DEFAULTS[NORM_KEYS[nk]] = NORM[NORM_KEYS[nk]].def;

  // ---------- pure helpers (exported as _internal for tests) ----------
  function clampInt(v, min, max, def) {
    var n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? parseFloat(v) : NaN;
    if (!isFinite(n)) return def;
    n = Math.round(n);
    return n < min ? min : n > max ? max : n;
  }

  function normValue(n, v) {
    if (n.values) return n.values.indexOf(v) >= 0 ? v : n.def;
    if (n.bool) return v === undefined ? n.def : !!v;
    if (n.str) return typeof v === 'string' ? v : n.def;
    if (n.hex) return hexRgb(v) === null ? n.def : v;
    return clampInt(v, n.min, n.max, n.def);
  }

  // Snapshot of the config with the values the renderer relies on made safe (NORM).
  function normalizeCfg(c) {
    var o = {};
    if (c && typeof c === 'object') {
      for (var k in c) {
        if (Object.prototype.hasOwnProperty.call(c, k)) o[k] = Array.isArray(c[k]) ? c[k].slice() : c[k];
      }
    }
    for (var i = 0; i < NORM_KEYS.length; i++) o[NORM_KEYS[i]] = normValue(NORM[NORM_KEYS[i]], o[NORM_KEYS[i]]);
    return o;
  }

  // A #chat custom property: set, or removed when value is null (an option at its default leaves the
  // stylesheet's own value, and OBS Custom CSS, in charge).
  function setVar(st, name, value) {
    if (value === null || value === undefined) st.removeProperty(name);
    else st.setProperty(name, String(value));
  }

  // A config color (bare lowercase rrggbb, config.js) as 'r, g, b' for rgba(); null for anything else, so
  // only checked digits ever reach a CSS value.
  function hexRgb(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-f]{6}$/.test(hex)) return null;
    return parseInt(hex.slice(0, 2), 16) + ', ' + parseInt(hex.slice(2, 4), 16) + ', ' + parseInt(hex.slice(4, 6), 16);
  }
  // The same color as '#rrggbb' for a CSS color value; null for anything else.
  function hexColor(hex) { return hexRgb(hex) === null ? null : '#' + hex; }

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
  // The text size in px: text_px while it is set (8 at least, as config.js stores 1..7), else the size step's.
  function pxFor(c) {
    var n = clampInt(c && c.text_px, 0, 96, 0);
    return n > 0 ? Math.max(8, n) : fontPx(c && c.size);
  }
  // badge_size and emote_scale (percent) as a factor: 1 at 100, or when left out.
  function sizeScale(v) { return clampInt(v, 50, 200, 100) / 100; }
  function ceilSafe(x) { return Math.ceil(x - 1e-9); }
  // Images are requested at the drawn size times the device pixel ratio. OBS draws at DPR 1, and scaling a
  // source in OBS scales the finished page, so bigger files would only cost download, decode and memory.
  // baseH: the emote's 1x height (baseHeight): a provider's files are 2x, 3x, 4x that, and every emote is drawn as tall
  // as an emote line's emotes whatever its own height. scale: emote_scale (times an emote-only line's factor) or
  // badge_size; 1 when left out. Past a provider's largest file pickUrl takes that one, so nothing smaller than the
  // drawn size is fetched while a big enough file exists.
  function wantEmote(px, big, dpr, baseH, scale) {
    return ceilSafe(px * EMOTE_EM * (big ? 3 : 1) * (scale > 0 ? scale : 1) * (dpr > 0 ? dpr : 1) /
      (baseH > 0 ? baseH : EMOTE_BASE_PX));
  }
  function wantBadge(px, dpr, scale) { return ceilSafe(px * (scale > 0 ? scale : 1) * (dpr > 0 ? dpr : 1) / BADGE_BASE_PX); }
  // A provider's 1x emote height (dim: 0 when unknown). A short one (an FFZ emote 20 px tall, a wide 7TV one) is its
  // own: it is stretched to the same drawn height, so it needs a bigger file than a 28 px emote. 28 to 31 px count as
  // 28 (7TV's are 32), and anything taller as 32, so odd metadata can't pick a smaller file than those would.
  function baseHeight(h) { return h >= 32 ? 32 : h > 0 && h < EMOTE_BASE_PX ? h : EMOTE_BASE_PX; }

  // A built-in shadow in a config color: the same offsets, blurs and alphas, with the color's rgb for black.
  // Anything but a config color (hexRgb checks it) leaves the shadow black.
  function tint(s, hex) {
    var rgb = hexRgb(hex);
    if (rgb === null) return s;
    return s.replace(/rgba\(0,0,0,/g, 'rgba(' + rgb.replace(/ /g, '') + ',').replace(/#000\b/g, '#' + hex);
  }
  // --shadow: the level's filter, exactly as written above while shadow_color is '' (black).
  function shadowCss(level, color) {
    var s = SHADOWS[clampInt(level, 0, 3, DEFAULT_SHADOW)];
    return color ? tint(s, color) : s;
  }
  function outlineAt(d, w) { return d === 0 ? '0' : d < 0 ? '-' + w : w; }
  // --tshadow, the text-shadow layers (null when there are none): the outline (outline=1..3), eight sharp copies of
  // the text around it in outline_color (black by default), then shadow_style=text's shadow in shadow_color.
  function tshadow(c) {
    var layers = [];
    var w = OUTLINE_EM[clampInt(c.outline, 0, 3, 0)];
    if (w) {
      var col = hexColor(c.outline_color) || '#000';
      for (var i = 0; i < OUTLINE_DIRS.length; i++) {
        layers.push(outlineAt(OUTLINE_DIRS[i][0], w) + ' ' + outlineAt(OUTLINE_DIRS[i][1], w) + ' 0 ' + col);
      }
    }
    if (c.shadow_style === 'text' && c.shadow > 0) layers.push(tint(TEXT_SHADOWS[clampInt(c.shadow, 0, 3, 0)], c.shadow_color));
    return layers.length ? layers.join(', ') : null;
  }
  // --tshadow-room (null without layers): how far --tshadow reaches past the letters, so a row's line and a reply
  // header leave that much room at their clipped edges: the text shadow's reach, or else the outline's width. One
  // plain length, as overflow-clip-margin takes no calc() or max(). With both on, the shadow's 3px or more covers
  // the outline too (.08em stays under 3px up to a 37px font); a bigger text_px takes the outline's width in px.
  function tshadowRoom(c) {
    var w = OUTLINE_EM[clampInt(c.outline, 0, 3, 0)];
    if (c.shadow_style === 'text' && c.shadow > 0) {
      var room = TEXT_SHADOW_ROOM[clampInt(c.shadow, 0, 3, 0)];
      var o = w ? Math.ceil(parseFloat(w) * pxFor(c) - 1e-9) : 0;
      return o > parseInt(room, 10) ? o + 'px' : room;
    }
    return w || null;
  }
  function bgAlpha(bg) { return clampInt(bg, 0, 100, 0) / 100; }
  // line_width's cap on a notice (--line-max-n), in the notice's own em: notice_size makes that em smaller (or
  // larger) than the chat text's, so the same number of them would make notices narrower than the chat lines.
  function noticeMax(width, noticeSize) {
    return Math.round(width * 100000 / clampInt(noticeSize, 50, 150, 85)) / 1000 + 'em';
  }

  // Value for --font: a quoted family name, or a bare generic keyword ("system-ui" must stay unquoted).
  function fontVar(name) {
    var s = String(name === undefined || name === null ? '' : name).replace(/[^A-Za-z0-9 \-]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) s = 'Inter';
    var lower = s.toLowerCase();
    if (GENERIC_FONTS.indexOf(lower) >= 0) return lower;
    return '"' + s + '"';
  }

  // timestamps: when a message was sent (msg.ts: Twitch's tmi-sent-ts, Kick's created_at) on the PC's own clock,
  // '24h' as 15:07 (09:05 zero-padded), '12h' as 3:07 (no AM/PM; 0:30 is 12:30). '' without a usable ts, never
  // the time now: a line's signature must not change from one minute to the next.
  function timeText(ts, mode) {
    var n = Number(ts);
    if ((mode !== '12h' && mode !== '24h') || !isFinite(n) || n <= 0) return '';
    var d = new Date(n), hh = d.getHours(), mm = d.getMinutes();
    if (!isFinite(hh) || !isFinite(mm)) return '';
    if (mode === '12h') hh = hh % 12 || 12;
    else if (hh < 10) hh = '0' + hh;
    return hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // Fade: the line disappears `fade` s after it arrived; the last outMs (fade_out_ms, FADE_OUT_MS when left out) is
  // the visible fade-out, never longer than the whole life. delay > 0: still fully visible; delay < 0: already
  // part-way through the fade-out.
  // Returns null (no fade), {expired:true} (drop it), or {expired:false, delay, duration} in ms.
  function fadeTiming(fadeS, ageMs, outMs) {
    var total = Number(fadeS) * 1000;
    if (!(total > 0)) return null;
    var age = Math.max(0, Number(ageMs) || 0);
    if (age >= total) return { expired: true };
    var dur = Math.min(typeof outMs === 'number' && outMs >= 0 ? outMs : FADE_OUT_MS, total);
    return { expired: false, delay: Math.round(total - dur - age), duration: Math.round(dur) };
  }

  // Lines are in DOM order, newest last, except in a vertical chat with align=top (newest first).
  // A horizontal row always ends with the newest line on the right; align only moves the row up or down.
  function newestFirst(c) { return !!c && c.layout !== 'horizontal' && c.align === 'top'; }

  // Which way the lines glide to make room for new ones (animate=1): a row 'left', as always; a column only with
  // smooth_scroll, 'up' (newest last) or 'down' (newest first). null: nothing glides and nothing is measured for it.
  function glideOf(c) {
    if (!c || !c.animate) return null;
    if (c.layout === 'horizontal') return 'left';
    if (c.smooth_scroll !== true) return null;
    return newestFirst(c) ? 'down' : 'up';
  }
  // row_sep: whether a row draws marks between its messages (css/overlay.css draws them for a row only).
  function rowMarks(c) {
    return !!c && c.layout === 'horizontal' && (c.row_sep === 'dot' || c.row_sep === 'bar' || c.row_sep === 'diamond');
  }

  // Inline `animation` value for a line ('' = none). A horizontal row slides new lines in sideways. style (enter_style),
  // inMs (enter_ms) and exitName (exitFor's keyframes) may be left out: the line then comes in and fades as in 1.5.
  // Only the listed keyframe names and clamped numbers ever reach the string.
  function animString(isNew, animate, timing, layout, style, inMs, exitName) {
    var parts = [];
    if (isNew && animate) {
      var names = Object.prototype.hasOwnProperty.call(ENTER, style) ? ENTER[style] : ENTER.slide;
      parts.push(names[layout === 'horizontal' ? 1 : 0] + ' ' + clampInt(inMs, 50, 1000, IN_MS) + 'ms ease-out');
    }
    if (timing && !timing.expired) {
      parts.push((EXIT_NAMES.indexOf(exitName) >= 0 ? exitName : 'tco-fade') + ' ' + timing.duration + 'ms linear ' +
        timing.delay + 'ms forwards');
    }
    return parts.join(', ');
  }
  // The exit's keyframes for a config: tco-fade, or with exit_style=slide the one toward the edge old lines leave by.
  function exitFor(c) {
    if (!c || c.exit_style !== 'slide') return 'tco-fade';
    if (c.layout === 'horizontal') return EXIT_SLIDE.left;
    return newestFirst(c) ? EXIT_SLIDE.down : EXIT_SLIDE.up;
  }
  // The four animation options at their defaults. A fade-out that begins during the entrance then runs along with it,
  // as in 1.5 (fade=1: the line rises while it fades). Off them, the entrance always plays out first: the fade-out
  // would take over opacity (and transform) the moment it began and cut the entrance short (insertGroups, onAnimEnd).
  function animDefaults(c) {
    return c.enter_style === 'slide' && c.enter_ms === IN_MS && c.fade_out_ms === FADE_OUT_MS && c.exit_style === 'fade';
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

  // Deleted message ids (or cleared user ids) with a TTL and a size cap, each with an optional value.
  // Insertion order == expiry order.
  function DeletedIds(ttlMs, cap) {
    this.ttl = ttlMs;
    this.cap = cap;
    this.map = new Map(); // id -> [expiry, value]
  }
  DeletedIds.prototype.prune = function (now) {
    while (this.map.size) {
      var first = this.map.entries().next().value;
      if (first[1][0] > now) break;
      this.map.delete(first[0]);
    }
  };
  DeletedIds.prototype.add = function (id, now, value) {
    if (!id) return;
    this.map.delete(id);
    this.map.set(id, [now + this.ttl, value]);
    this.prune(now);
    while (this.map.size > this.cap) this.map.delete(this.map.keys().next().value);
  };
  DeletedIds.prototype.has = function (id, now) {
    if (!id) return false;
    var e = this.map.get(id);
    if (e === undefined) return false;
    if (e[0] <= now) { this.map.delete(id); return false; }
    return true;
  };
  // The value stored with a live id, else undefined.
  DeletedIds.prototype.get = function (id, now) {
    return this.has(id, now) ? this.map.get(id)[1] : undefined;
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

  // layout=horizontal: lines sit in one row, oldest first on the left. Count the leading lines whose
  // right edge is at or left of viewLeft (reads stop at the first line still in view).
  function overflowCountX(n, rectAt, viewLeft) {
    var c = 0;
    for (var i = 0; i < n; i++) {
      if (rectAt(i).right <= viewLeft) c++;
      else break;
    }
    return c;
  }

  // How far (px) a running slide still had to go when a new one starts: what the row (or column) showed on
  // screen, at most the slide's own offset. After SLIDE_MS the slide is over even if a paused renderer (a hidden
  // OBS source, where flushes come from the fallback timer) never drew it, so offsets can't pile up.
  function slideLeft(visualShift, slideDx, elapsed) {
    if (!(slideDx > 0) || !(elapsed < SLIDE_MS) || !(visualShift > 0)) return 0;
    return Math.min(visualShift, slideDx);
  }

  // Where the next slide starts (px right of home): what was left, plus how far the newest old line moved
  // left when the new lines went in. Under a pixel is no slide. At most maxDx (the chat width): a start
  // further right than one view shows nothing, and in a burst the carried-over part would pile up. A column
  // (smooth_scroll) passes its edges the same way round, so dx is how far below (or above) home it starts, at
  // most the chat height.
  function slideDelta(left, xBefore, xAfter, maxDx) {
    var dx = (left > 0 ? left : 0) + (xBefore - xAfter);
    if (maxDx > 0 && dx > maxDx) dx = maxDx;
    return dx >= 1 ? dx : 0;
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

  // The app's own badge images (overlay.js badgesFor), allowed as these exact relative paths: off the hosted https page
  // (a local folder, OBS's "Local file" source, a local http server) they are not made absolute.
  var LOCAL_BADGES = { 'img/logos/Badge.svg': 1, 'img/logos/Beta.svg': 1 };
  function pickUrl(urls, want) {
    if (!urls || typeof urls !== 'object') return null;
    var raw = util.pickScale(urls, want);
    if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(LOCAL_BADGES, raw)) return raw;
    var u = util.absUrl(raw);
    return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : null; // provider images are https; the local app badges are allowlisted above
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

  // ---------- highlights (mentions, keywords, highlight_users, role_style) ----------
  // A letter, mark, digit or underscore: what a word is made of, in a regex with the u flag (Chromium 103 has \p{}
  // and lookbehind). A name or phrase matches only where it isn't part of a longer word.
  var WORD_CH = '[\\p{L}\\p{M}\\p{N}_]';
  var WORD_CH_RE = /^[\p{L}\p{M}\p{N}_]$/u;
  // Scripts written without spaces between words (Chinese, Japanese, Thai, ...; Korean's particles join the word
  // before them): a letter of theirs beside a keyword doesn't make it part of a longer word.
  var NOSP = '\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}';
  var NOSP_RE = new RegExp('^[' + NOSP + ']$', 'u');
  var SPACED_CH = '(?:(?![' + NOSP + '])' + WORD_CH + ')';
  // What can continue a Twitch login or a Kick slug, which are ASCII: a Latin letter (é too: @homé is another word),
  // a mark, a digit or '_', and (the mention matcher's '-?') a '-' before one, as a Kick slug can go on (@home-made),
  // after the Twitch login too. A Japanese or Korean suffix (@homeさん, @home님, @home-さん) or a word before the '@' doesn't.
  var LOGIN_CH = '[\\p{Script=Latin}\\p{M}\\p{Nd}_]';
  var MAX_PHRASES = 50; // config.js keeps keywords to as many
  // Literal text in a regex. Only the syntax characters: the u flag rejects any other escaped one ('\-').
  function escapeRe(s) { return String(s).replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&'); }
  // Kick writes a username's '_' as '-' in its channel slug: either one names the same channel.
  function slugKey(s) { return String(s).toLowerCase().replace(/-/g, '_'); }

  // A keyword as a pattern: whole words at its ends (a phrase that starts or ends with a sign, or with a letter of a
  // script without spaces, matches there as it is; a letter of such a script beside it doesn't count as more word),
  // any run of spaces where it has one.
  function wordEnd(ch) { return WORD_CH_RE.test(ch) && !NOSP_RE.test(ch); }
  function phrasePattern(p) {
    var cps = Array.from(p);
    return (wordEnd(cps[0]) ? '(?<!' + SPACED_CH + ')' : '') + escapeRe(p).replace(/ +/g, '\\s+') +
      (wordEnd(cps[cps.length - 1]) ? '(?!' + SPACED_CH + ')' : '');
  }
  function makeRe(src) {
    try { return new RegExp(src, 'iu'); } catch (e) { return null; }
  }
  // Text as it is drawn, for the word matchers: without default-ignorable characters (U+034F, the duplicate-bypass
  // suffix a bare one of which is a mark and would make a word look longer; zero-width spaces and joiners; soft hyphens;
  // variation signs; U+E0000), which show as nothing. Taken off the keywords and block_words as well, so an emoji keyword
  // with its variation sign, or a phrase with a joiner in it, still matches.
  var IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;
  function visibleText(t) { return t.replace(IGNORABLE_RE, ''); }
  // The i flag never takes a Turkish dotted capital I ('İ') for an 'i', and lower case makes it an 'i' and a dot above
  // (as config.js keeps the keywords and block_words). The keywords and the text both have each of these folded to a
  // plain 'i', so 'İyi', 'İYİ' and 'iyi' are one word in any letter case on either side.
  var DOTTED_I_RE = /\u0130|[iI]\u0307/g;
  function foldDottedI(t) { return t.replace(DOTTED_I_RE, 'i'); }

  // What lineClasses matches chat lines against, built once per cfg object (setConfig makes a new one for every
  // change), in a WeakMap: nothing is stored on the cfg. mention: the channel's names (the Twitch login and the Kick
  // slug, whichever are set) after an '@' (mentions=at), or also on their own (name), but not after '/' or '.' (a
  // twitch.tv/name link, a domain); null while mentions is off or there is no channel. keyword: any of the keywords.
  // users: the highlight_users logins.
  var MATCHERS = new WeakMap();
  var NO_MATCHERS = { mention: null, channel: '', kickKey: '', keyword: null, users: null };
  function buildMatchers(c) {
    var out = { mention: null, channel: '', kickKey: '', keyword: null, users: null };
    if (c.mentions === 'at' || c.mentions === 'name') {
      var ch = typeof c.channel === 'string' ? c.channel.toLowerCase() : '';
      var kk = typeof c.kick === 'string' ? c.kick.toLowerCase() : '';
      if (!/^[a-z0-9_]{1,25}$/.test(ch)) ch = '';
      if (!/^[a-z0-9_-]{1,40}$/.test(kk)) kk = '';
      var names = [];
      if (ch) names.push(ch);
      if (kk) names.push(kk.split(/[-_]/).map(escapeRe).join('[-_]'));
      if (names.length) {
        out.channel = ch;
        out.kickKey = kk ? slugKey(kk) : '';
        out.mention = makeRe((c.mentions === 'at' ? '(?<!' + LOGIN_CH + ')@' : '(?<![\\p{Script=Latin}\\p{M}\\p{Nd}_/.@])@?') +
          '(?:' + names.join('|') + ')(?!-?' + LOGIN_CH + ')');
      }
    }
    var kw = Array.isArray(c.keywords) ? c.keywords : [], pats = [];
    for (var i = 0; i < kw.length && pats.length < MAX_PHRASES; i++) {
      var p = typeof kw[i] === 'string' ? foldDottedI(visibleText(kw[i])).trim() : '';
      if (p) pats.push(phrasePattern(p));
    }
    if (pats.length) out.keyword = makeRe(pats.join('|'));
    var hu = Array.isArray(c.highlight_users) ? c.highlight_users : [];
    for (var j = 0; j < hu.length; j++) {
      if (typeof hu[j] === 'string' && hu[j]) (out.users = out.users || Object.create(null))[hu[j].toLowerCase()] = 1;
    }
    return out;
  }
  function matchersFor(c) {
    if (!c || typeof c !== 'object') return NO_MATCHERS;
    var m = MATCHERS.get(c);
    if (!m) {
      m = buildMatchers(c);
      MATCHERS.set(c, m);
    }
    return m;
  }

  // A chat line that mentions the channel: its name in the text (as drawn: visibleText), or a reply to the channel. The
  // channel's own lines don't count (on Twitch its login, on Kick its slug).
  function mentionsChannel(msg, m) {
    var kick = msg.platform === 'kick';
    var login = typeof msg.login === 'string' ? msg.login.toLowerCase() : '';
    if (kick ? m.kickKey && slugKey(login) === m.kickKey : m.channel && login === m.channel) return false;
    var to = msg.reply && typeof msg.reply === 'object' && typeof msg.reply.login === 'string' ? msg.reply.login.toLowerCase() : '';
    if (to && (kick ? m.kickKey && slugKey(to) === m.kickKey : m.channel && to === m.channel)) return true;
    return typeof msg.text === 'string' && m.mention.test(visibleText(msg.text));
  }

  // The text (as drawn: visibleText) has a keyword (a pattern of keywords folded by foldDottedI): as it is, or with a
  // Turkish 'İ' folded the same way.
  function hasKeyword(text, re) {
    text = visibleText(text);
    if (re.test(text)) return true;
    var folded = foldDottedI(text);
    return folded !== text && re.test(folded);
  }

  // The chatter's role, from the badges the message carries (the tags, not what is drawn, so it works with badges
  // off): 'broadcaster', 'mod' (lead_moderator too), 'vip', 'sub' (subscriber, founder) or null, the highest when
  // there are several. A Shared Chat line from another channel goes by its badges there (source-badges), a Kick line
  // by its Kick badge types.
  var ROLE_OF_BADGE = { broadcaster: 'broadcaster', lead_moderator: 'mod', moderator: 'mod', vip: 'vip', subscriber: 'sub',
    founder: 'sub' };
  var ROLE_RANK = { broadcaster: 4, mod: 3, vip: 2, sub: 1 };
  function roleOf(msg) {
    if (!msg || typeof msg !== 'object') return null;
    var kick = msg.platform === 'kick';
    var list = kick ? msg.kickBadges : msg.mirrored ? msg.sourceBadges : msg.badges;
    if (!Array.isArray(list)) return null;
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var name = list[i] && (kick ? list[i].type : list[i].set);
      var r = typeof name === 'string' && Object.prototype.hasOwnProperty.call(ROLE_OF_BADGE, name) ? ROLE_OF_BADGE[name] : null;
      if (r && (!best || ROLE_RANK[r] > ROLE_RANK[best])) best = r;
    }
    return best;
  }
  // The roles role_style marks (subscribers are not).
  var MARKED_ROLES = { broadcaster: 1, mod: 1, vip: 1 };

  // A chat line's highlight classes (never an announcement's: it has a bar of its own). One tint at most, the first
  // of: the channel-points highlight (lineClasses adds it), a mention of the channel (mention), a keyword (keyword) or
  // highlight user (user-hl), and role_style=tint's tint (role-tint). role_style also adds role-<role>, and with bar
  // role-bar (the stylesheet puts a first message's bar over it, and it over the name-color bar).
  function highlightClasses(msg, cfg, highlighted) {
    var out = [], m = matchersFor(cfg);
    var tint = highlighted ? 'highlight' : '';
    if (!tint && m.mention && mentionsChannel(msg, m)) tint = 'mention';
    if (!tint && m.keyword && typeof msg.text === 'string' && hasKeyword(msg.text, m.keyword)) tint = 'keyword';
    if (!tint && m.users && typeof msg.login === 'string' && m.users[msg.login.toLowerCase()] === 1) tint = 'user-hl';
    if (tint && !highlighted) out.push(tint);
    var role = cfg.role_style === 'bar' || cfg.role_style === 'tint' ? roleOf(msg) : null;
    if (role && MARKED_ROLES[role] === 1) {
      out.push('role-' + role);
      if (cfg.role_style === 'bar') out.push('role-bar');
      else if (!tint) out.push('role-tint');
    }
    return out;
  }

  // emoteOnly: the line is one modelFor found to be emotes alone (emote_only=big/huge, in a column).
  function lineClasses(msg, cfg, kind, action, emoteOnly) {
    var c = ['line'];
    if (kind === 'notice') {
      c.push('notice');
    } else {
      if (action) c.push('action');
      if (cfg.first_msg && msg.firstMsg) c.push('first-msg');
      // points_highlight=0: a channel-points highlighted message is drawn like any other (another tint may take it).
      var highlighted = cfg.points_highlight !== false && (msg.highlight || msg.msgId === 'highlighted-message');
      if (highlighted) c.push('highlight');
      var ann = annClass(msg.announcement);
      if (ann) c.push('announcement', ann);
      else {
        // accent_bar: a bar in the name color (renderInto sets it), except on an announcement, whose own bar it
        // would cover. A first message's bar wins in the stylesheet.
        if (cfg.accent_bar === true) c.push('accent');
        c.push.apply(c, highlightClasses(msg, cfg, highlighted));
      }
      if (emoteOnly) c.push('emote-only');
    }
    if (msg.mirrored) c.push('mirrored');
    if (typeof msg.platform === 'string' && Object.prototype.hasOwnProperty.call(LINE_PLATFORMS, msg.platform)) c.push('platform-' + msg.platform);
    return c.join(' ');
  }

  // ---------- filters (overlay.js shouldShow, quotesHidden and tokensFor) ----------
  // A link: 'https://', 'http://' or 'www.' where a word starts, up to the next space (any letter case), or up to a ',',
  // ';' or '|' with another link straight after it ('https://a.com,https://b.com' is two links; a link inside one with
  // no such sign before it, as in a redirect's '?u=https://...', is still part of it). A bare domain never is one ('e.g.',
  // 'lol.exe' and 'ok.so' are words), nor another scheme: 'steam://run/1' or 'C://Users' would shorten to a word that is
  // no site.
  var LINK_SRC = '(?:\\bhttps?:\\/\\/|\\bwww\\.)(?:(?![,;|](?:https?:\\/\\/|www\\.))\\S)+';
  var LINK_RE = new RegExp(LINK_SRC, 'i');
  var LINKS_RE = new RegExp(LINK_SRC, 'gi');
  function hasLink(text) { return typeof text === 'string' && LINK_RE.test(text); }
  // links=shorten: each link as its site's host name ('https://clips.twitch.tv/x?y' is 'clips.twitch.tv'), still as
  // text (a link is never made clickable). The signs a sentence puts after a link stay after the host, and so does a
  // closing bracket, unless the link has an opening one of its own ('…/Foo_(bar)'). A link the URL parser rejects, or
  // one without a host, stays as it is.
  function shortenLinks(text) {
    if (!hasLink(text)) return text;
    return text.replace(LINKS_RE, function (url) {
      var tail = (/[(\[{<]/.test(url) ? /[.,!?;:'"]+$/ : /[.,!?;:'")\]}>]+$/).exec(url);
      var core = tail ? url.slice(0, tail.index) : url;
      var host = '';
      try { host = new URL(/^www\./i.test(core) ? 'http://' + core : core).hostname; } catch (e) { host = ''; }
      return host ? host + (tail ? tail[0] : '') : url;
    });
  }
  // The same over tokenizer items: only text items change (emotes, cheers and GIFs are items of their own). A changed
  // item is a copy, so the items handed in are left as they were.
  function shortenItems(items) {
    if (!Array.isArray(items)) return items;
    var out = items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || it.type !== 'text' || !hasLink(it.text)) continue;
      var copy = {};
      for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) copy[k] = it[k];
      copy.text = shortenLinks(it.text);
      if (out === items) out = items.slice();
      out[i] = copy;
    }
    return out;
  }

  // What overlay.js's chat filters match against, built once per cfg object in a WeakMap like MATCHERS (onMessage
  // makes a new cfg for every live change, and copies its properties, so nothing is stored on it). block: block_words
  // as one pattern, matched like keywords (any letter case, whole words at its ends, the text as drawn; hasWords).
  // command: a message that starts with one of command_prefixes after any spaces, every sign escaped in the class, so
  // '-' and '^' stand for themselves ('!' when there are none, as before the setting).
  var FILTERS = new WeakMap();
  function buildFilters(c) {
    var out = { block: null, command: null };
    var bw = Array.isArray(c.block_words) ? c.block_words : [], pats = [];
    for (var i = 0; i < bw.length && pats.length < MAX_PHRASES; i++) {
      var p = typeof bw[i] === 'string' ? foldDottedI(visibleText(bw[i])).trim() : '';
      if (p) pats.push(phrasePattern(p));
    }
    if (pats.length) out.block = makeRe(pats.join('|'));
    var pre = typeof c.command_prefixes === 'string' ? c.command_prefixes : '', cls = '';
    // ASCII signs only: a backslash before any of them is the sign itself (no u flag), never a class like \d.
    for (var j = 0; j < pre.length; j++) if (/^[!-\/:-@\[-`{-~]$/.test(pre.charAt(j))) cls += '\\' + pre.charAt(j);
    out.command = new RegExp('^\\s*[' + (cls || '\\!') + ']');
    return out;
  }
  function filtersFor(c) {
    if (!c || typeof c !== 'object') return buildFilters({});
    var f = FILTERS.get(c);
    if (!f) {
      f = buildFilters(c);
      FILTERS.set(c, f);
    }
    return f;
  }
  // The text has one of the words of a filtersFor pattern (re: block). As hasKeyword, for a Turkish 'İ' too.
  function hasWords(text, re) { return !!re && typeof text === 'string' && hasKeyword(text, re); }

  // short (reply_style=name): the header names who is answered, without what they said ({name, short}). shorten
  // (links=shorten): links in what they said show as their host name, as in the message itself.
  function replyModel(reply, short, shorten) {
    if (!reply) return null;
    var name = String(reply.name || reply.login || '');
    if (!name) return null;
    if (short) return { name: '@' + util.capMarks(name), short: true };
    var body = String(reply.body || '').replace(/^\u0001ACTION /, '').replace(/\u0001$/, '').replace(/[\r\n]+/g, ' ');
    if (shorten) body = shortenLinks(body);
    return { name: '@' + util.capMarks(name), body: util.capMarks(body) };
  }

  // With badges off, only the Shared Chat source avatar (provider 'avatar') and the platform icon (provider
  // 'platform') are kept: they mark where a message came from rather than who wrote it.
  function marksSource(b) { return !!b && (b.provider === 'avatar' || b.provider === 'platform'); }
  function visibleBadges(list, cfg) {
    if (!Array.isArray(list)) return [];
    if (!cfg || cfg.badges !== false) return list;
    return list.filter(marksSource);
  }

  // A badge is an image ({urls}) or a built-in icon ({icon: a js/icons.js key}, drawn as inline SVG).
  function badgeModels(list, want) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b) continue;
      if (b.icon !== undefined) {
        if (icons && icons.has(b.icon)) out.push({ icon: b.icon, title: String(b.title || ''), platform: b.provider === 'platform' });
        continue;
      }
      var url = pickUrl(b.urls, want);
      if (!url) continue;
      out.push({
        url: url,
        title: String(b.title || ''),
        avatar: b.provider === 'avatar',
        bg: typeof b.bg === 'string' && HEX_COLOR_RE.test(b.bg) ? b.bg : null // hex only (every provider's shape)
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

  // emote_only: a message of emote images alone (cheers and GIFs are not emotes), with no text but blanks between
  // them. An emote without a usable image is drawn as its name, which is text.
  function emoteOnly(items) {
    if (!Array.isArray(items)) return false;
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      if (it.type === 'emote') {
        if (!pickUrl(it.emote && it.emote.urls, 1)) return false;
        n++;
      } else if (it.type !== 'text' || !BLANK_RE.test(it.text === undefined || it.text === null ? '' : String(it.text))) {
        return false;
      }
    }
    return n > 0;
  }

  // Tokenizer items -> render parts (plain data; urls resolved, spaces folded into text parts).
  // opts: { px: font px, dpr, flatBig: big emotes drawn at emote height (horizontal row), gifs, scale: emote_scale
  // as a factor (1 when left out), giant: false draws gigantified emotes like any other (the default is true),
  // eo: an emote-only line's factor (emote_only; 1 when left out), gifMul: a GIF's height in emote heights in a column
  // (gif_size; 3 when left out) }
  function partsFor(items, opts) {
    var parts = [];
    if (!Array.isArray(items)) return parts;
    var px = opts.px, dpr = opts.dpr;
    var big3 = !opts.flatBig;
    var giant = opts.giant !== false;
    var scale = opts.scale > 0 ? opts.scale : 1;
    // An emote-only line draws its emotes eo times as tall, except a gigantified one, which keeps its 3.
    var eoScale = opts.eo > 1 ? scale * opts.eo : scale;
    // How tall a GIF is drawn, in CSS px: an emote's height (emote_scale too) times gif_size, or once in a row.
    var gifPx = px * EMOTE_EM * scale * (opts.flatBig ? 1 : opts.gifMul > 0 ? opts.gifMul : 3);
    var imgs = 0; // emote images so far; a history line can be far longer than Twitch's 500 chars
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var space = parts.length > 0 && !!it.sp;
      if (it.type === 'emote') {
        var e = it.emote || {};
        var ename = util.capMarks(String(e.name || ''));
        // giant_emotes=0: no 3x box and no 3x file. In a row (flatBig) the class stays, and the stylesheet draws it
        // at emote height.
        var big = !!it.big && big3 && giant;
        var es = big ? scale : eoScale;
        var url = imgs < MAX_IMAGES ? pickUrl(e.urls, wantEmote(px, big, dpr, baseHeight(dim(e.h)), es)) : null;
        if (!url) { addText(parts, (space ? ' ' : '') + ename); continue; }
        imgs++;
        var fx = it.fx || {};
        var sx = num(fx.sx, 1), sy = num(fx.sy, 1), rot = num(fx.rot, 0);
        var zs = !!fx.zs;
        if (space && !zs) addText(parts, ' ');
        var w = dim(e.w) || EMOTE_BASE_PX, h = dim(e.h) || EMOTE_BASE_PX;
        var ov = [];
        var seen = [url]; // the same image stacked twice in one spot looks the same as once
        var overlays = Array.isArray(it.overlays) ? it.overlays : [];
        for (var j = 0; j < overlays.length && imgs < MAX_IMAGES; j++) {
          var o = overlays[j];
          var ou = o && pickUrl(o.urls, wantEmote(px, big, dpr, baseHeight(dim(o.h)), es));
          if (!ou || seen.indexOf(ou) >= 0) continue;
          seen.push(ou);
          imgs++;
          ov.push({ name: String(o.name || ''), url: ou, w: dim(o.w) || EMOTE_BASE_PX, h: dim(o.h) || EMOTE_BASE_PX });
        }
        parts.push({
          t: 'emote', name: ename, url: url, w: w, h: h,
          big: !!it.big && giant, grow: !!fx.grow, cursed: !!fx.cursed, zs: zs,
          fx: sx !== 1 || sy !== 1 || rot !== 0 ? { sx: sx, sy: sy, rot: rot } : null,
          ov: ov
        });
      } else if (it.type === 'gif') {
        var title = util.capMarks(String(it.title || ''));
        var gurl = opts.gifs && util.isSafeUrl(it.url) ? it.url : null;
        if (!gurl) { addText(parts, (space ? ' ' : '') + title); continue; }
        if (space) addText(parts, ' ');
        // orig: the tag's own URL, tried once when Giphy has no 200 px rendition for this GIF.
        var gorig = it.orig && it.orig !== gurl && util.isSafeUrl(it.orig) ? it.orig : null;
        var gp = { t: 'gif', url: gurl, title: title };
        // Drawn taller than Giphy's largest fixed-height file (text_px, emote_scale, gif_size), the GIF loads the
        // original as animated WebP (Giphy has no taller fixed-height one), with the 200 px file (alt) to fall back on.
        // In CSS px: every default (168 px at most) keeps the 200 px file at any DPR, and OBS draws at DPR 1.
        var gbig = gorig && gifPx > GIPHY_FIXED_PX ? util.giphyFile(gorig, 'giphy.webp') : null;
        if (gbig && gbig !== gurl && util.isSafeUrl(gbig)) {
          gp.url = gbig;
          gp.alt = gurl;
        }
        if (gorig) gp.orig = gorig;
        parts.push(gp);
      } else if (it.type === 'cheer') {
        if (space) addText(parts, ' ');
        parts.push({
          t: 'cheer',
          prefix: String(it.prefix || ''),
          amount: String(it.amount === undefined ? '' : it.amount),
          color: HEX_COLOR_RE.test(it.color || '') ? it.color : null,
          url: pickUrl(it.urls, wantEmote(px, false, dpr, 0, scale))
        });
      } else {
        var txt = it.text === undefined || it.text === null ? '' : String(it.text);
        if (txt) addText(parts, (space ? ' ' : '') + txt);
      }
    }
    // Only after tokenizing: Twitch emote ranges index the original code points.
    for (var k = 0; k < parts.length; k++) if (parts[k].t === 'text') parts[k].s = util.capMarks(parts[k].s);
    return parts;
  }

  // Everything a line shows, as plain data.
  // d: {kind, items, action, badges, name:{text, color, paint}, dpr, noReply: the replied-to message was moderated (or
  //   a filter hides what it said: deps.quoteHidden), alone: a notice's own text line whose notice line is no longer
  //   drawn (events turned off)}
  function modelFor(msg, cfg, d) {
    cfg = cfg || {};
    d = d || {};
    // timestamps: model.time only while they are on and the message has a time, so the model (and its signature)
    // is as before otherwise. The user's own line under a notice that is drawn shows none: the notice has it.
    var time = cfg.timestamps === '12h' || cfg.timestamps === '24h' ? timeText(msg.ts, cfg.timestamps) : '';
    if (d.kind === 'notice') {
      var nm0 = { kind: 'notice', cls: lineClasses(msg, cfg, 'notice', false), system: util.capMarks(String(msg.systemMsg || '')) };
      // A notice shows only the platform icon (in a combined Twitch + Kick chat), never the user's badges.
      var marks = badgeModels(Array.isArray(d.badges) ? d.badges.filter(function (b) { return b && b.provider === 'platform'; }) : [], 1);
      if (marks.length) nm0.badges = marks;
      if (time) nm0.time = time;
      return nm0;
    }
    if (msg.noticeId !== undefined && msg.systemMsg && !d.alone) time = '';
    var px = pxFor(cfg);
    var action = !!d.action;
    var nm = d.name || {};
    var text = util.capMarks(typeof nm.text === 'string' && nm.text ? nm.text : String(msg.displayName || msg.login || ''));
    var color = typeof nm.color === 'string' && nm.color ? nm.color : util.defaultColor(msg.userId, msg.login);
    var paint = typeof nm.paint === 'string' && PAINT_ID_RE.test(nm.paint) ? nm.paint : null;
    var dpr = d.dpr > 0 ? d.dpr : 1;
    // emote_only=big/huge, in a column: a message of emotes alone gets its class (the stylesheet draws its emotes
    // --eo times as tall), and its emotes are fetched that much bigger. Only looked for while it is on.
    var eo = cfg.layout !== 'horizontal' && Object.prototype.hasOwnProperty.call(EMOTE_ONLY, cfg.emote_only)
      ? EMOTE_ONLY[cfg.emote_only] : 0;
    var only = eo > 0 && emoteOnly(d.items);
    var model = {
      kind: 'chat',
      cls: lineClasses(msg, cfg, 'chat', action, only),
      reply: cfg.replies === false || d.noReply ? null : replyModel(msg.reply, cfg.reply_style === 'name', cfg.links === 'shorten'),
      badges: badgeModels(visibleBadges(d.badges, cfg), wantBadge(px, dpr, sizeScale(cfg.badge_size))),
      name: { text: text, color: color, paint: paint },
      // name_sep: one of the fixed NAME_SEPS strings; ': ' for anything else (a partial cfg).
      colon: action ? ' ' : Object.prototype.hasOwnProperty.call(NAME_SEPS, cfg.name_sep) ? NAME_SEPS[cfg.name_sep] : ': ',
      msgColor: action ? color : null,
      parts: partsFor(d.items, { px: px, dpr: dpr, flatBig: cfg.layout === 'horizontal', gifs: cfg.gifs !== false,
        scale: sizeScale(cfg.emote_scale), giant: cfg.giant_emotes !== false, eo: only ? eo : 1,
        gifMul: Object.prototype.hasOwnProperty.call(GIF_MUL, cfg.gif_size) ? Number(GIF_MUL[cfg.gif_size]) : 3 })
    };
    if (time) model.time = time;
    return model;
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
  // opts: { root: #chat element, cfg, deps: {tokensFor, badgesFor, nameFor, paintRule, paintStaticRule, shouldShow} }
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
    // Moderation of reply parents. cleared: user id -> mseq of the latest timeout/ban. spoke: message id ->
    // mseq, noted only for messages from a cleared user, so a reply to what they said afterwards keeps its header.
    var cleared = new DeletedIds(CLEARED_TTL_MS, CLEARED_CAP);
    var spoke = new DeletedIds(CLEARED_TTL_MS, DELETED_CAP);
    var mseq = 0;
    var byId = new Map();        // msg id / source id -> line
    var byUser = new Map();      // user id -> Set<line>
    var recs = new WeakMap();    // line -> {msg, src, kind, gid, born, sig, ids, userId, fadeLater}
    var paintState = new Map();  // paint id -> true (rule inserted) | false (rule rejected)
    var stillState = new Map();  // paint_images=static: paint id -> true (still rule inserted) | false (none)
    var styleEl = null;
    var held = false, destroyed = false;
    var scheduled = false, rafId = null, flushTimer = null, gapTimer = null, lastFlushAt = 0;
    var trimTimer = null, sweepTimer = null;
    var slideAt = 0, slideDx = 0;
    var settleUntil = 0, settleTimer = null;
    var seq = 0, flushes = 0;
    var ro = null;
    // Images are fetched for this pixel ratio: 1 in OBS, 2 in the builder preview on a HiDPI screen.
    var dpr = Math.min(3, Math.max(1, Number(win.devicePixelRatio) || 1));

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

    // ----- paints: one rule per paint id in our own <style> (two with still paints) -----
    function paintSheet() {
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.setAttribute('data-tco', 'paints');
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
      return styleEl.sheet || null;
    }
    function ensurePaint(id) {
      if (!paintState.has(id)) {
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
      }
      var ok = paintState.get(id);
      if (ok && cfg.paint_images === 'static') ensureStill(id);
      return ok;
    }
    // paint_images=static: a second rule with the paint's still images, which applies only while #chat has
    // .paint-static. Added only once static is chosen, so by default the sheet holds one rule per paint as
    // before. A paint without an animated image has none, and a rejected one leaves the paint as it was.
    function ensureStill(id) {
      if (stillState.has(id)) return;
      var rule = callDep('paintStaticRule', id);
      var sheet = typeof rule === 'string' && rule ? paintSheet() : null;
      if (!sheet) { stillState.set(id, false); return; }
      try {
        sheet.insertRule(rule, sheet.cssRules.length);
        stillState.set(id, true);
      } catch (e) {
        util.warn('renderer: still paint rule rejected', id, e && e.message);
        stillState.set(id, false);
      }
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
    // A colored (FFZ / FFZ:AP) badge is a transparent mask: the color is the img's own background, so
    // there is no wrapper, and Custom CSS on .badge (display, margin, size) treats every badge alike.
    // A built-in icon: inline SVG from the js/icons.js registry (constant shapes and colors; the title is text).
    function svgEl(tag, attrs) {
      var e = doc.createElementNS(SVG_NS, tag);
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k]));
      return e;
    }
    function iconNode(b) {
      var ic = icons.get(b.icon);
      var svg = svgEl('svg', {
        'class': 'badge icon icon-' + b.icon + (b.platform ? ' platform' : ''),
        viewBox: ic.vb, width: BADGE_BASE_PX, height: BADGE_BASE_PX, role: 'img', 'aria-label': b.title
      });
      if (b.title) {
        var t = svgEl('title', {});
        t.textContent = b.title;
        svg.appendChild(t);
      }
      var vb = ic.vb.split(' ').map(Number);
      if (ic.tile) svg.appendChild(svgEl('rect', { x: vb[0], y: vb[1], width: vb[2], height: vb[3], rx: vb[2] * 0.2, fill: ic.tile }));
      for (var i = 0; i < ic.shapes.length; i++) svg.appendChild(svgEl('path', { d: ic.shapes[i].d, fill: ic.shapes[i].fill }));
      if (ic.text) {
        var tx = svgEl('text', {
          x: vb[0] + vb[2] / 2, y: vb[1] + vb[3] / 2 + ic.text.size * 0.36, 'text-anchor': 'middle',
          'font-size': ic.text.size, 'font-weight': 800, fill: ic.text.fill
        });
        tx.textContent = ic.text.s;
        svg.appendChild(tx);
      }
      return svg;
    }
    function badgeNode(b) {
      if (b.icon) return iconNode(b);
      var cls = b.avatar ? 'badge avatar' : 'badge';
      var img = makeImg(b.bg ? cls + ' colored' : cls, b.url, BADGE_BASE_PX, BADGE_BASE_PX, b.title, detach);
      if (!b.bg) return img;
      img.style.backgroundColor = b.bg;
      return img;
    }
    function emoteNode(p) {
      // Turned sideways (r!/l!), a wide emote would reach over the lines above and below: it is drawn in a
      // square box instead (.rot), which a quarter turn leaves in place. w! is moot once it stands upright.
      var rot = !!p.fx && p.fx.rot % 180 !== 0;
      var grow = p.grow && !rot;
      var cls = 'emote-stack';
      if (p.big) cls += ' big';
      if (p.fx) cls += ' fx';
      if (rot) cls += ' rot';
      if (p.cursed) cls += ' cursed';
      if (p.zs) cls += ' zs';
      var stack = el('span', cls);
      if (p.fx) {
        stack.style.setProperty('--sx', String(p.fx.sx));
        stack.style.setProperty('--sy', String(p.fx.sy));
        stack.style.setProperty('--rot', p.fx.rot + 'deg');
      }
      // w! doubles the width; the ratio is capped so a hostile 9999x1 emote can't span the screen.
      var r = grow && p.h > 0 ? Math.min(2 * p.w / p.h, 16) : 0;
      var base = makeImg('emote', p.url, r ? r * p.h : grow ? p.w * 2 : p.w, p.h, p.name, function () {
        replaceWithText(stack, p.name);
      });
      if (r) base.style.width = 'calc(var(--eh) * ' + Math.round(r * 1000) / 1000 + ')';
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
        // A GIF that won't load tries its fallbacks in turn: a big GIF's 200 px file (alt), then the tag's own URL
        // (orig), and then shows its title.
        var next = [];
        if (p.alt) next.push(p.alt);
        if (p.orig) next.push(p.orig);
        return makeImg('gif', p.url, 0, 0, p.title, function retry(img) {
          if (!next.length) return replaceWithText(img, p.title);
          img.onerror = function () { img.onerror = null; retry(img); };
          img.src = next.shift();
        });
      }
      return doc.createTextNode(p.s || '');
    }

    // Replace a line's content with the model. The line element (and its fade animation) is kept.
    function renderInto(line, model) {
      line.className = model.cls;
      line.textContent = '';
      // accent_bar: the name color as the line's own --line-accent, taken off again with the class (a rerender
      // keeps the line element and its style).
      if (model.kind === 'chat' && / accent( |$)/.test(model.cls) && HEX_COLOR_RE.test(model.name.color)) {
        line.style.setProperty('--line-accent', model.name.color);
      } else if (line.style.getPropertyValue('--line-accent')) {
        line.style.removeProperty('--line-accent');
      }
      if (model.kind === 'notice') {
        if (model.time) line.appendChild(span('time', model.time));
        if (model.badges) {
          var nb = el('span', 'badges');
          for (var n = 0; n < model.badges.length; n++) nb.appendChild(badgeNode(model.badges[n]));
          line.appendChild(nb);
        }
        line.appendChild(span('message', model.system));
        return;
      }
      if (model.reply) {
        var r = el('div', 'reply');
        r.appendChild(doc.createTextNode('↪ '));
        r.appendChild(span('reply-name', model.reply.name));
        // reply_style=name: the name alone (an empty body still draws "↪ @name: ", as it always has).
        if (!model.reply.short) {
          r.appendChild(doc.createTextNode(': '));
          r.appendChild(span('reply-body', model.reply.body));
        }
        line.appendChild(r);
      }
      // timestamps: after the reply header (a block of its own), before the badges.
      if (model.time) line.appendChild(span('time', model.time));
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

    // alone: a notice's own text line, rebuilt after its notice line left (see noticeDrawn).
    function buildModel(msg, kind, alone) {
      if (kind === 'notice') return modelFor(msg, cfg, { kind: 'notice', badges: callDep('badgesFor', msg) });
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
        name: { text: nm.text, color: nm.color, paint: paint },
        dpr: dpr,
        // A moderated quote, or one the overlay's filters hide (block_words, links=hide; asked again on each redraw).
        noReply: replyGone(msg.reply, Date.now()) || (!!msg.reply && !!callDep('quoteHidden', msg.reply)),
        alone: !!alone
      });
    }

    // Whether a group's notice line is on screen. A notice's own text line shows no time under it; once the notice
    // has gone (events turned off live sweeps notices but keeps chat lines), the text line shows the time itself.
    function noticeDrawn(gid) {
      for (var l = linesEl.firstElementChild; l; l = l.nextElementSibling) {
        var rec = recs.get(l);
        if (rec && rec.gid === gid && rec.kind === 'notice') return true;
      }
      return false;
    }

    // The message a reply quotes was deleted, or its author was timed out or banned after sending it:
    // the "↪ @user: text" header would put the moderated text back on stream.
    function replyGone(r, now) {
      if (!r || typeof r !== 'object') return false;
      var pid = util.idStr(r.id);
      if (pid && deleted.has(pid, now)) return true;
      var uid = util.idStr(r.userId);
      var at = uid ? cleared.get(uid, now) : undefined;
      if (at === undefined) return false;
      var said = pid ? spoke.get(pid, now) : undefined;
      return !(said > at); // unknown or older than the latest clear: moderated
    }
    // Rebuild the lines whose reply header quotes what match(reply) picks (after a moderation event).
    function rerenderReplies(match) {
      rerender(function (m) { return !!m.reply && typeof m.reply === 'object' && match(m.reply); });
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
    // row_sep: a line's mark, and the space after it, is drawn only after another line (.line + .line). When the first
    // line of a row leaves while out of view past the left edge (trimmed, or its fade ran out there), the line after it
    // would lose them in view, its box narrowing at once: it keeps them instead (.keep-sep, put back on a rerender). A
    // first line that leaves in view takes the mark after it along, as before.
    function keepSepAfter(line) {
      var next = line.nextElementSibling;
      if (!next || line !== linesEl.firstElementChild || !rowMarks(cfg)) return;
      var nrec = recs.get(next);
      if (!nrec || nrec.keepSep) return;
      var view = rootEl.getBoundingClientRect();
      if (!(view.width > 0) || !(line.getBoundingClientRect().right <= view.left)) return;
      nrec.keepSep = true;
      next.classList.add('keep-sep');
    }
    // A kept mark stays only while the line before it would still be out of view. Once the row has moved right past that
    // (a mod deleted or timed out the newer lines, a /clear or a filter took some, the source got wider), the first line
    // would show it in view with nothing before it: it drops the mark and the space after it. keepSepAfter marks a line
    // that starts at most the row's gap right of the view's left edge, so further in than that (where it sits at home: a
    // running slide's offset, the row's transform, taken off) is past it.
    function dropLoneSep() {
      if (!cfg || cfg.layout !== 'horizontal') return;
      var first = linesEl.firstElementChild;
      var rec = first && recs.get(first);
      if (!rec || !rec.keepSep) return;
      var view = rootEl.getBoundingClientRect();
      if (!(view.width > 0)) return;
      var slid = linesEl.getBoundingClientRect().left - view.left;
      var cs = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(linesEl) : null;
      var gap = cs ? parseFloat(cs.columnGap) || 0 : 0;
      if (first.getBoundingClientRect().left - slid <= view.left + gap + 1) return;
      unkeepSep(first, rec);
    }
    function unkeepSep(line, rec) {
      rec.keepSep = false;
      line.classList.remove('keep-sep');
    }
    // The single place a line leaves the DOM; clears every index.
    function removeLine(line) {
      if (!line) return;
      var rec = recs.get(line);
      if (rec) {
        keepSepAfter(line);
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
        if (msg.text && /\S/.test(msg.text)) {
          // The user's own text follows the chat rules (hide_commands), not the notice's.
          var part = userPart(msg);
          if (showable(part)) out.push(makeLine(part, 'chat', msg, gid, born));
        }
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
      var top = newestFirst(cfg);
      var frag = doc.createDocumentFragment();
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[top ? groups.length - 1 - gi : gi];
        for (var li = 0; li < g.length; li++) {
          var line = g[li];
          var rec = recs.get(line);
          var t = fadeTiming(cfg.fade, now - rec.born, cfg.fade_out_ms);
          // tco-in and tco-fade both animate opacity, and two such animations on one element both run on the
          // main thread. So while the fade-out is further off than the entrance, only tco-in goes on now and
          // onAnimEnd adds the fade when it ends (same timing: the fade is anchored to the arrival). The same for
          // every entrance (enter_style) and exit (exit_style). Off their defaults the fade always waits, so it
          // never cuts an entrance short (animDefaults).
          rec.fadeLater = !!(cfg.animate && t && !t.expired && (t.delay >= cfg.enter_ms || !animDefaults(cfg)));
          var anim = animString(true, cfg.animate, rec.fadeLater ? null : t, cfg.layout, cfg.enter_style, cfg.enter_ms,
            exitFor(cfg));
          if (anim) line.style.animation = anim;
          frag.appendChild(line);
        }
      }
      if (top) linesEl.insertBefore(frag, linesEl.firstChild);
      else linesEl.appendChild(frag);
    }

    function gidOf(line) {
      var rec = line && recs.get(line);
      return rec ? rec.gid : null;
    }
    // max counts messages: a notice and the user's own line under it leave together.
    function capLines() {
      if (linesEl.childElementCount <= cfg.max) return false;
      var groups = 0, prev = null;
      for (var l = linesEl.firstElementChild; l; l = l.nextElementSibling) {
        var g = gidOf(l);
        if (g === null || g !== prev) groups++;
        prev = g;
      }
      if (groups <= cfg.max) return false;
      var top = newestFirst(cfg);
      for (; groups > cfg.max; groups--) {
        var edge = top ? linesEl.lastElementChild : linesEl.firstElementChild;
        var gid = gidOf(edge);
        do {
          removeLine(edge);
          edge = top ? linesEl.lastElementChild : linesEl.firstElementChild;
        } while (edge && gid !== null && gidOf(edge) === gid);
      }
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
    // slack (px): the row (or with smooth_scroll the column) is about to slide in from that far right (below, or
    // above with the newest on top), so a line counts as outside only if it is also out of view at the start of
    // the slide. Without slack the lines are measured where they are drawn, mid-slide too: one out of view then
    // only moves further out.
    function trimOverflow(slack) {
      if (destroyed) return;
      var wait = settleUntil - Date.now();
      if (wait > 0) {
        if (!settleTimer) {
          settleTimer = setTimeout(function () {
            settleTimer = null;
            trimOverflow();
          }, wait + 10);
        }
        return;
      }
      var kids = linesEl.children;
      var n = kids.length;
      if (!n) return;
      var view = rootEl.getBoundingClientRect();
      var rectAt = function (i) { return kids[i].getBoundingClientRect(); };
      var cnt;
      var s = slack > 0 ? slack : 0;
      // Not laid out (hidden iframe, display:none): measure nothing.
      if (cfg.layout === 'horizontal') {
        if (!(view.width > 0)) return;
        cnt = overflowCountX(n, rectAt, view.left - s);
      } else {
        if (!(view.height > 0)) return;
        cnt = overflowCount(n, rectAt, cfg.align, view.top - s, view.bottom + s);
      }
      cnt = Math.min(cnt, n - 1);
      if (cnt) {
        var top = newestFirst(cfg);
        var victims = [];
        for (var i = 0; i < cnt; i++) victims.push(top ? kids[n - 1 - i] : kids[i]);
        for (var j = 0; j < victims.length; j++) removeLine(victims[j]);
      }
      // Every flush, and every resize (a wider source moves the row right): a kept mark that is no longer kept for anything.
      dropLoneSep();
    }
    function scheduleTrim() {
      // Deferred out of ResizeObserver callbacks so removals never cause an RO loop error.
      if (trimTimer || destroyed) return;
      trimTimer = setTimeout(function () {
        trimTimer = null;
        trimOverflow();
      }, 0);
    }

    // ----- slide (animate=1): a row (layout=horizontal), and a column with smooth_scroll -----
    // A new line at the right end pushes the whole row left; one at the bottom of a column pushes the lines
    // above it up (one at the top, newest first, pushes them down). Measure the newest old line before and
    // after the new lines go in, start the lines that much further right (below, above), and let them glide back.
    // No slide, where none can be running: slideStart has just cancelled it, or nothing glides (glideOf).
    function clearSlide() {
      slideDx = 0;
      linesEl.style.transition = '';
      linesEl.style.transform = '';
    }
    // A slide (a row's or a column's) stopped where it is: the lines go home now. transition 'none' cancels the running
    // transition at the style flush, which '' alone would leave running under the initial `transition: all`. Then ''
    // leaves no inline value behind, and starts nothing: transform is already home.
    function stopGlide() {
      slideDx = 0;
      linesEl.style.transition = 'none';
      linesEl.style.transform = '';
      void linesEl.offsetWidth; // style flush
      linesEl.style.transition = '';
    }
    // The newest old line's edge the slide follows: a row's right end, a column's top.
    function edgeOf(el, dir) {
      var r = el.getBoundingClientRect();
      return dir === 'left' ? r.right : r.top;
    }
    // Before new lines go in: stop any running slide, noting how far it still had to go.
    function slideStart(now) {
      var dir = glideOf(cfg);
      if (!dir) return null;
      // The newest old line: the last, or the first in a column with the newest on top (new lines go in before it).
      var el = dir === 'down' ? linesEl.firstElementChild : linesEl.lastElementChild;
      if (!el) return null;
      var running = slideDx > 0 && now - slideAt < SLIDE_MS;
      var visual = running ? edgeOf(el, dir) : 0; // includes the running transform
      linesEl.style.transition = 'none';
      linesEl.style.transform = 'none';
      var x = edgeOf(el, dir);
      // A slide down started above home, so what it still had to go is how far the line was still above.
      return { el: el, x: x, dir: dir,
        left: running ? slideLeft(dir === 'down' ? x - visual : visual - x, slideDx, now - slideAt) : 0 };
    }
    // After: how far right (below, above) the lines must start so the ones already on screen don't jump.
    // Capped at the chat width or height (free here: the read before it already laid out).
    function slideOffset(s) {
      if (s.el.parentNode !== linesEl) return 0;
      if (s.dir === 'left') return slideDelta(s.left, s.x, edgeOf(s.el, s.dir), rootEl.clientWidth);
      var y = edgeOf(s.el, s.dir);
      return s.dir === 'down' ? slideDelta(s.left, y, s.x, rootEl.clientHeight) : slideDelta(s.left, s.x, y, rootEl.clientHeight);
    }
    function startSlide(dx, now, dir) {
      if (!(dx > 0)) { clearSlide(); return; }
      slideAt = now;
      slideDx = dx;
      var px = Math.round(dx * 100) / 100 + 'px)';
      linesEl.style.transform = dir === 'left' ? 'translateX(' + px : dir === 'down' ? 'translateY(-' + px : 'translateY(' + px;
      void linesEl.offsetWidth; // style flush: the transition starts from the shifted position
      linesEl.style.transition = 'transform ' + SLIDE_MS + 'ms ease-out';
      linesEl.style.transform = '';
      // Lines still peeking in at the left edge (a column's top, or bottom) when the slide started are out of view
      // once it ends. They are clipped and removing them moves nothing, so the next flush's trim takes them (no
      // extra frame).
    }

    // Re-time every line's fade from its arrival time (after align/fade changes or a reorder). keepEntering (a new
    // fade-out length or exit): a line still coming in keeps its entrance, and onAnimEnd gives it the new fade-out.
    function restartFades(now, keepEntering) {
      var list = children();
      if (keepEntering) list = list.filter(function (l) { var r = recs.get(l); return !(r && r.fadeLater); });
      if (!list.length) return;
      for (var i = 0; i < list.length; i++) list[i].style.animation = 'none';
      void linesEl.offsetHeight; // style flush: cancels the running animations so the new ones start now
      var exit = exitFor(cfg);
      for (var j = 0; j < list.length; j++) {
        var rec = recs.get(list[j]);
        var t = rec ? fadeTiming(cfg.fade, now - rec.born, cfg.fade_out_ms) : null;
        if (rec) rec.fadeLater = false;
        if (t && t.expired) removeLine(list[j]);
        else list[j].style.animation = animString(false, false, t, cfg.layout, null, null, exit);
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
      var list = children(), notices = false;
      for (var i = 0; i < list.length; i++) {
        var rec = recs.get(list[i]);
        // Each line by its own message: a resub's text line is a chat message (see buildGroup).
        if (rec && !showable(rec.msg)) {
          if (rec.kind === 'notice') notices = true;
          removeLine(list[i]);
        }
      }
      queue.filter(function (en) { return showable(en.msg); });
      // A resub's text line left without its notice shows the time itself now (timestamps; see noticeDrawn).
      if (notices && cfg && cfg.timestamps !== 'off') rerender(function (m) { return m.noticeId !== undefined; });
    }

    // Runs only while fade > 0 and there are lines, so an empty or idle chat never wakes the page.
    function ensureSweepTimer() {
      var want = !destroyed && cfg && cfg.fade > 0 && !!linesEl.firstElementChild;
      if (want && !sweepTimer) {
        sweepTimer = setInterval(function () {
          if (sweepExpired(Date.now())) scheduleTrim();
          ensureSweepTimer();
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
      if (gapTimer !== null) {
        clearTimeout(gapTimer);
        gapTimer = null;
      }
    }
    function schedule() {
      if (held || destroyed || scheduled) return;
      scheduled = true;
      flushTimer = setTimeout(flush, FLUSH_FALLBACK_MS);
      if (typeof win.requestAnimationFrame !== 'function') return;
      // Busy chat: wait out FLUSH_GAP_MS since the last flush, then take the next frame. Nobody reads
      // line-by-line updates at that rate, and each flush costs a layout and a repaint.
      var wait = lastFlushAt + FLUSH_GAP_MS - Date.now();
      if (wait > 0 && wait <= FLUSH_GAP_MS) {
        gapTimer = setTimeout(function () {
          gapTimer = null;
          rafId = win.requestAnimationFrame(flush);
        }, wait);
      } else {
        rafId = win.requestAnimationFrame(flush);
      }
    }

    function flush() {
      clearSchedule();
      if (held || destroyed) return;
      // Hidden: nothing is painted, so build nothing. The queue keeps the newest cfg.max messages, and
      // onVisibility flushes them once the page shows again.
      if (doc.visibilityState === 'hidden') return;
      var now = Date.now();
      lastFlushAt = now;
      var changed = false;
      var entries = queue.drain();
      var slide = entries.length ? slideStart(now) : null;
      if (entries.length) {
        // Newest first so at most cfg.max messages get built, then back to arrival order.
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
            count++;
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
      if (changed) {
        var dx = slide ? slideOffset(slide) : 0;
        trimOverflow(dx);
        if (slide) startSlide(dx, now, slide.dir);
      } else if (slide) {
        startSlide(slide.left, now, slide.dir); // nothing went in after all: finish the interrupted slide
      }
      ensureSweepTimer();
      flushes++;
    }

    // ----- events -----
    function onAnimEnd(e) {
      var t = e.target;
      if (!t || t.parentNode !== linesEl) return;
      var rec = recs.get(t);
      if (!rec) return;
      var name = e.animationName;
      if (EXIT_NAMES.indexOf(name) >= 0) {
        removeLine(t);
      } else if (ENTER_NAMES.indexOf(name) >= 0 && rec.fadeLater) {
        // The entrance is over: now the fade-out alone, timed from the arrival (see insertGroups). Off the animation
        // defaults, one that should have begun already starts now, from full, over the time left: still gone at `fade`.
        rec.fadeLater = false;
        var ft = fadeTiming(cfg.fade, Date.now() - rec.born, cfg.fade_out_ms);
        if (ft && ft.expired) removeLine(t);
        else {
          if (ft && ft.delay < 0 && !animDefaults(cfg)) {
            ft = { expired: false, delay: 0, duration: ft.duration + ft.delay };
          }
          t.style.animation = animString(false, false, ft, cfg.layout, null, null, exitFor(cfg));
        }
      }
    }
    // While hidden nothing renders, so CSS animations of lines inserted meanwhile never started.
    // On show: flush, then re-time every line from its arrival (no mass fade-in, correct fades).
    function onShown() {
      // A column's slide (smooth_scroll) whose time ran out while nothing was drawn would only start once frames
      // resume, moving lines that are long in place: it is over, so they go home now.
      if (slideDx > 0 && glideOf(cfg) !== 'left' && Date.now() - slideAt >= SLIDE_MS) stopGlide();
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
      cl.toggle('layout-horizontal', c.layout === 'horizontal');
      cl.toggle('layout-vertical', c.layout !== 'horizontal');
      cl.toggle('align-top', c.align === 'top');
      cl.toggle('align-bottom', c.align !== 'top');
      cl.toggle('has-bg', c.bg > 0);
      // The options below add a class or a variable only off their default (css/overlay.css has the rules, with
      // today's values as the var() fallbacks), and take it away again when set back.
      cl.toggle('case-upper', c.text_case === 'upper');
      cl.toggle('case-lower', c.text_case === 'lower');
      cl.toggle('case-smallcaps', c.text_case === 'smallcaps');
      cl.toggle('no-names', !c.names);
      cl.toggle('name-line', c.name_line); // the stylesheet applies it to a column only
      cl.toggle('bg-full', c.bg_width === 'full'); // and this to a column with bg only
      // shadow_style=text: the shadow goes on the letters (--tshadow), and the line's filter is dropped.
      var shadowText = c.shadow_style === 'text' && c.shadow > 0;
      cl.toggle('has-outline', c.outline > 0);
      cl.toggle('shadow-text', shadowText);
      cl.toggle('paint-static', c.paint_images === 'static');
      // text_align is for a column and row_sep for a row: the stylesheet scopes each to its layout.
      cl.toggle('text-center', c.text_align === 'center');
      cl.toggle('text-right', c.text_align === 'right');
      cl.toggle('has-maxw', c.line_width > 0);
      cl.toggle('edge-fade', c.edge_fade > 0);
      cl.toggle('sep-dot', c.row_sep === 'dot');
      cl.toggle('sep-bar', c.row_sep === 'bar');
      cl.toggle('sep-diamond', c.row_sep === 'diamond');
      // name_font: names (and reply headers' names) in their own font, only while one is set.
      cl.toggle('has-name-font', !!c.name_font);
      var st = rootEl.style;
      setVar(st, '--font', fontVar(c.font));
      setVar(st, '--name-font', c.name_font ? fontVar(c.name_font) : null);
      setVar(st, '--shadow', shadowText ? 'none' : shadowCss(c.shadow, c.shadow_color));
      setVar(st, '--bg-alpha', bgAlpha(c.bg));
      setVar(st, '--tshadow', tshadow(c));
      setVar(st, '--tshadow-room', tshadowRoom(c));
      // text_px: the text size in px, over the size-* class (badges and emotes are in em, so they follow).
      setVar(st, 'font-size', c.text_px > 0 ? pxFor(c) + 'px' : null);
      // --emote-h only while emote_scale is changed: else the stylesheet's 1.75em (EMOTE_EM), which OBS Custom CSS
      // can set instead.
      setVar(st, '--emote-h', c.emote_scale === 100 ? null : Math.round(EMOTE_EM * c.emote_scale * 100) / 10000 + 'em');
      setVar(st, '--badge-h', c.badge_size === 100 ? null : c.badge_size / 100 + 'em');
      setVar(st, '--eo', EMOTE_ONLY[c.emote_only] ? String(EMOTE_ONLY[c.emote_only]) : null);
      setVar(st, '--gif-mul', GIF_MUL[c.gif_size] || null);
      setVar(st, '--gif-margin', c.gif_size === '1x' ? GIF_1X_MARGIN : null);
      setVar(st, '--text-weight', c.text_weight === 'semibold' ? null : WEIGHTS[c.text_weight]);
      setVar(st, '--name-weight', c.name_weight === 'heavy' ? null : WEIGHTS[c.name_weight]);
      setVar(st, '--text-color', hexColor(c.text_color));
      // Unitless, so the smaller reply header and notice lines keep their own spacing.
      setVar(st, '--line-height', c.line_height === 135 ? null : String(c.line_height / 100));
      setVar(st, '--bg-rgb', hexRgb(c.bg_color));
      setVar(st, '--bg-radius', BG_RADIUS[c.bg_shape]);
      var row = c.layout === 'horizontal' ? ROW_GAP[c.spacing] : null;
      setVar(st, '--line-gap', c.layout === 'horizontal' ? null : LINE_GAP[c.spacing]);
      setVar(st, '--row-gap', row ? row[c.bg > 0 ? 1 : 0] : null);
      setVar(st, '--notice-color', hexColor(c.notice_color));
      setVar(st, '--notice-size', c.notice_size === 85 ? null : c.notice_size / 100 + 'em');
      setVar(st, '--first-color', hexColor(c.first_msg_color));
      setVar(st, '--line-max', c.line_width > 0 ? c.line_width + 'em' : null);
      setVar(st, '--line-max-n', c.line_width > 0 ? noticeMax(c.line_width, c.notice_size) : null);
      setVar(st, '--pad-x', c.pad_x === 8 ? null : c.pad_x + 'px');
      setVar(st, '--edge-fade', c.edge_fade > 0 ? c.edge_fade + 'em' : null);
      // The highlight colors, as 'r, g, b' for the tints and bars (the line classes come from lineClasses).
      setVar(st, '--mention-rgb', hexRgb(c.mention_color));
      setVar(st, '--kw-rgb', hexRgb(c.keyword_color));
      setVar(st, '--hl-rgb', hexRgb(c.points_color));
      setVar(st, '--role-broadcaster-rgb', hexRgb(c.broadcaster_color));
      setVar(st, '--role-mod-rgb', hexRgb(c.mod_color));
      setVar(st, '--role-vip-rgb', hexRgb(c.vip_color));
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
      if (newestFirst(prev) !== newestFirst(cfg)) {
        reverseLines();
        restart = true; // moving nodes restarts CSS animations
      }
      if (prev.layout !== cfg.layout) {
        // Lines that don't fit the new layout at the old size may fit once the builder resizes the
        // preview (it sends the layout first), so trim once both have landed.
        settleUntil = Date.now() + LAYOUT_SETTLE_MS;
      }
      // A kept row_sep mark (.keep-sep) is for the row it was kept in: a switch to a column (and back) or row_sep=none
      // ends it, so a row drawn again marks only the lines after another.
      if (prev.layout !== cfg.layout || !rowMarks(cfg)) {
        children().forEach(function (l) {
          var r = recs.get(l);
          if (r && r.keepSep) unkeepSep(l, r);
        });
      }
      // A slide that no longer applies stops where it is and the lines go home at once: a row's on a switch to a column
      // or animate=0, a column's glide (smooth_scroll) turned off, turned round by an align flip (the lines were just
      // reversed), or ended by a layout switch or animate=0. Left running, a row's would carry the column in sideways.
      var glide = glideOf(prev);
      if (glide && glide !== glideOf(cfg)) stopGlide();
      // Switched to still paints: the paints already in use get their still rule now (applyRoot set the class).
      // Back to animated, the rules stay, unused without the class.
      if (cfg.paint_images === 'static' && prev.paint_images !== 'static') {
        paintState.forEach(function (ok, id) { if (ok) ensureStill(id); });
      }
      if (prev.fade !== cfg.fade) restart = true;
      // The fades on screen take a new length or exit at once (and the exit's direction when the layout turns), so
      // they still end `fade` s after arrival; lines still coming in get theirs as the entrance ends (onAnimEnd). A
      // new enter_ms re-times nothing: it only decides, for new lines, whether the fade waits (insertGroups).
      var retime = cfg.fade > 0 && (prev.fade_out_ms !== cfg.fade_out_ms || exitFor(prev) !== exitFor(cfg));
      if (restart || retime) restartFades(Date.now(), !restart);
      if (changedAny(prev, cfg, FILTER_KEYS)) sweepFilters();
      if (changedAny(prev, cfg, RERENDER_KEYS)) rerender();
      // block and block_words decide which reply headers quote a blocked user or a hidden message (deps.quoteHidden):
      // only replies change.
      else if (changedAny(prev, cfg, ['block_words', 'block'])) rerender(function (m) { return !!m.reply; });
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
      // Back after a timeout: replies to what this user says from now on keep their header.
      var uid = util.idStr(msg.userId);
      if (id && uid && cleared.has(uid, now)) spoke.add(id, now, ++mseq);
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
      cleared.add(uid, Date.now(), ++mseq);
      queue.filter(function (en) { return util.idStr(en.msg.userId) !== uid; });
      var set = byUser.get(uid);
      var list = set ? Array.from(set) : [];
      for (var i = 0; i < list.length; i++) removeLine(list[i]);
      // Other people's replies quoting this user lose the header (see replyGone).
      rerenderReplies(function (r) { return util.idStr(r.userId) === uid; });
      // A row moves right when newer lines go (no resize to trim on): in the same frame, not one later.
      dropLoneSep();
    }

    function clearMessage(msgId) {
      var id = util.idStr(msgId);
      if (!id || destroyed) return;
      deleted.add(id, Date.now());
      queue.filter(function (en) { return util.idStr(en.msg.id) !== id && util.idStr(en.msg.sourceId) !== id; });
      removeLine(byId.get(id));
      removeLine(byId.get(id + ':m'));
      rerenderReplies(function (r) { return util.idStr(r.id) === id; });
      dropLoneSep();
    }

    // Without pred: every line. With pred(msg): only the queued and on-screen lines it matches (a Twitch /clear
    // keeps the Kick lines of a combined chat, and a Kick clear keeps the Twitch ones).
    function clearAll(pred) {
      if (destroyed) return;
      if (typeof pred === 'function') {
        var hit = function (m) { try { return !!pred(m); } catch (e) { return false; } };
        queue.filter(function (en) { return !hit(en.msg); });
        var list = children();
        for (var i = 0; i < list.length; i++) {
          var rec = recs.get(list[i]);
          if (rec && hit(rec.src || rec.msg)) removeLine(list[i]);
        }
        dropLoneSep();
        return;
      }
      queue.clear();
      byId.clear();
      byUser.clear();
      // A row's slide or a column's glide (smooth_scroll) stops too: left running, it would carry the next line in from
      // the side or from below. Without either nothing can be running (setConfig stops one as it goes).
      if (glideOf(cfg)) stopGlide();
      else clearSlide();
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
          var model = buildModel(rec.msg, rec.kind, rec.kind === 'chat' && rec.msg.noticeId !== undefined && !noticeDrawn(rec.gid));
          var sig = sigOf(model);
          if (sig === rec.sig) continue; // unchanged: keep the DOM (animated images don't restart)
          renderInto(line, model);
          if (rec.keepSep) line.classList.add('keep-sep');
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

    // overlay.js reads lines/queued (debug line); the rest is for tests.
    function stats() {
      return {
        lines: linesEl.childElementCount,
        queued: queue.size,
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
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (ro) { ro.disconnect(); ro = null; }
      linesEl.removeEventListener('animationend', onAnimEnd);
      doc.removeEventListener('visibilitychange', onVisibility);
      if (win.removeEventListener) win.removeEventListener('obsSourceVisibleChanged', onObsVisible);
      queue.clear();
      byId.clear();
      byUser.clear();
      paintState.clear();
      stillState.clear();
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
      // Drops lines that the filters now reject (e.g. a bot list that landed after they were shown).
      refilter: function () { if (!destroyed) sweepFilters(); },
      hasUser: hasUser,
      stats: stats,
      destroy: destroy
    };
  }

  // A CSS generic family (system-ui, serif, ...): nothing to fetch from Google Fonts for it.
  function isGenericFont(name) {
    return GENERIC_FONTS.indexOf(String(name === undefined || name === null ? '' : name).trim().toLowerCase()) >= 0;
  }

  return {
    createRenderer: createRenderer,
    isGenericFont: isGenericFont,
    roleOf: roleOf,
    // overlay.js's filters (shouldShow, quotesHidden) and links=shorten (tokensFor).
    filtersFor: filtersFor,
    hasWords: hasWords,
    hasLink: hasLink,
    shortenLinks: shortenLinks,
    shortenItems: shortenItems,
    _internal: {
      FONT_PX: FONT_PX,
      EMOTE_EM: EMOTE_EM,
      SHADOWS: SHADOWS,
      TEXT_SHADOWS: TEXT_SHADOWS,
      OUTLINE_EM: OUTLINE_EM,
      TEXT_SHADOW_ROOM: TEXT_SHADOW_ROOM,
      IN_MS: IN_MS,
      SLIDE_MS: SLIDE_MS,
      LAYOUT_SETTLE_MS: LAYOUT_SETTLE_MS,
      FADE_OUT_MS: FADE_OUT_MS,
      FLUSH_FALLBACK_MS: FLUSH_FALLBACK_MS,
      FLUSH_GAP_MS: FLUSH_GAP_MS,
      SWEEP_MS: SWEEP_MS,
      DELETED_TTL_MS: DELETED_TTL_MS,
      DELETED_CAP: DELETED_CAP,
      CLEARED_TTL_MS: CLEARED_TTL_MS,
      MAX_IMAGES: MAX_IMAGES,
      RERENDER_KEYS: RERENDER_KEYS,
      FILTER_KEYS: FILTER_KEYS,
      ROOT_KEYS: ROOT_KEYS,
      NORM: NORM,
      NORM_DEFAULTS: NORM_DEFAULTS,
      GENERIC_FONTS: GENERIC_FONTS,
      clampInt: clampInt,
      normalizeCfg: normalizeCfg,
      setVar: setVar,
      hexRgb: hexRgb,
      hexColor: hexColor,
      WEIGHTS: WEIGHTS,
      changedAny: changedAny,
      fontPx: fontPx,
      pxFor: pxFor,
      sizeScale: sizeScale,
      emoteOnly: emoteOnly,
      EMOTE_ONLY: EMOTE_ONLY,
      wantEmote: wantEmote,
      wantBadge: wantBadge,
      baseHeight: baseHeight,
      shadowCss: shadowCss,
      tshadow: tshadow,
      tshadowRoom: tshadowRoom,
      bgAlpha: bgAlpha,
      noticeMax: noticeMax,
      fontVar: fontVar,
      NAME_SEPS: NAME_SEPS,
      timeText: timeText,
      fadeTiming: fadeTiming,
      newestFirst: newestFirst,
      glideOf: glideOf,
      animString: animString,
      exitFor: exitFor,
      animDefaults: animDefaults,
      ENTER: ENTER,
      ENTER_NAMES: ENTER_NAMES,
      EXIT_NAMES: EXIT_NAMES,
      Ring: Ring,
      DeletedIds: DeletedIds,
      overflowCount: overflowCount,
      overflowCountX: overflowCountX,
      slideLeft: slideLeft,
      slideDelta: slideDelta,
      reverseGroups: reverseGroups,
      pickUrl: pickUrl,
      annClass: annClass,
      roleOf: roleOf,
      matchersFor: matchersFor,
      filtersFor: filtersFor,
      escapeRe: escapeRe,
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
