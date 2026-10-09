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
  var PAINT_BASE_PX = 32;     // height of a 1x 7TV paint image (1x to 4x)
  var NAME_BOX_EM = 1.21;     // a painted name's box, Inter's content area: the paint image is stretched over it
  var PAINT_STRETCH = 1.25;   // how far a paint file may be stretched before a bigger one is taken (see paintScale)
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
  // Moderation is kept for reply headers about as long as a stream lasts (a reply can come long after: Chatterino lets a
  // viewer reply to a deleted or greyed-out message), the caps bounding the memory: deleted messages, and timed-out /
  // banned users and chat clears, whose earlier messages a reply then quotes without its header.
  var DELETED_TTL_MS = 86400000;
  var DELETED_CAP = 5000;
  var CLEARED_TTL_MS = 86400000;
  var CLEARED_CAP = 1000;
  var MAX_CLEARS = 8;           // chat clears kept for reply headers (one per platform is the usual most)
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
    // align: in a row along the top edge a reply's line is laid out as a row of its own parts (.inline-reply).
    'align',
    'accent_bar',
    // The sizes: images are fetched for the size they are drawn at, and an emote-only line gets its class. gif_size
    // too: a GIF drawn taller than Giphy's 200 px file loads the original (partsFor).
    'text_px', 'badge_size', 'emote_scale', 'emote_only', 'giant_emotes', 'gif_size',
    // row_grow: a row draws emote-only messages, GIFs and gigantified emotes at their column sizes, from bigger files.
    'row_grow',
    // The name colors come from deps.nameFor (overlay.js reads these); the rest are drawn into the line.
    'name_color', 'name_fallback', 'readable_level', 'name_sep', 'timestamps', 'reply_style',
    // The highlights are line classes (lineClasses); their colors are #chat variables (ROOT_KEYS).
    'mentions', 'keywords', 'highlight_users', 'points_highlight', 'role_style',
    // links=shorten rewrites the text (overlay.js tokensFor) and reply headers; links=hide is a filter, and a reply
    // header quoting a link goes (deps.quoteHidden).
    'links'];
  // Each line goes by deps.shouldShow (overlay.js): a change sweeps the lines it now hides. replies too: block_words
  // matches a reply's "@Parent" only while it is drawn (replies=0).
  var FILTER_KEYS = ['bots', 'hide_commands', 'block', 'events', 'shared', 'event_subs', 'event_gifts', 'event_raids',
    'event_bits_badge', 'event_announcements', 'role_filter', 'allow_users', 'block_words', 'min_length', 'links',
    'command_prefixes', 'replies'];
  // Each reply header goes by deps.quoteHidden (overlay.js), which these decide: a change redraws the replies.
  var REPLY_QUOTE_KEYS = ['block_words', 'block', 'bots', 'hide_commands', 'command_prefixes'];
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
    'smooth_scroll',
    // A row's alignment while it isn't full (a class; trimOverflow and dropLoneSep read it), and row_grow's class.
    'row_align', 'row_grow'];

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
  // above 100) never above it and at most .2em below it, less at a line_height below 135 (--emote-floor below 120), at
  // spacing=tight without a box no more than twice the gap (--emote-hang), and in a box no more than its .2em padding
  // below, and so .2em above too (--emote-drop: equal margins keep it centred on the text). A row draws GIFs at emote
  // height whatever gif_size is, with the same margins written into its own rule (.layout-horizontal .gif), so
  // --gif-margin is a column's. It is set on #chat, where --emote-h, --line-height and the others are too, so the var()s
  // below take #chat's values. With those .05em sides a GIF wider than its line is fitted to the line less its sides
  // (--gif-maxw, as .cheer-img is), so it ends where the line's other text does instead of .05em past it; the 100% and
  // the .1em are worked out on the GIF itself (its line's width, its own em). 2x and 3x have no sides: 100%, as ever.
  var GIF_MUL = { '1x': '1', '2x': '2' };
  var GIF_1X_MAXW = 'calc(100% - .1em)';
  var EMOTE_ROOM = 'var(--emote-hang, .3em), 2.05em - var(--emote-h, 1.75em), ' +
    '(2 * var(--line-height, 1.35) - .65) * 1em - var(--emote-h, 1.75em)';
  var GIF_1X_MARGIN = 'calc(-1 * max(0em, min(.3em, var(--emote-drop, .3em), ' + EMOTE_ROOM + '))) .05em ' +
    'calc(-1 * max(min(.2em, var(--emote-hang, .3em), var(--emote-floor, .2em)), min(var(--emote-drop, .3em), ' + EMOTE_ROOM + ')))';
  // name_sep: what goes between the name and the message (a /me line keeps its space). Never '': the name and
  // the message would run together.
  var NAME_SEPS = { colon: ': ', space: ' ', dash: ' – ', arrow: ' › ' };
  // enter_style: each entrance's keyframes (css/overlay.css) in a column and in a row. slide is the column's rise and
  // the row's slide in from the right, as always; pop grows a row's message from its middle.
  var ENTER = { slide: ['tco-in', 'tco-in-x'], fade: ['tco-in-fade', 'tco-in-fade'], pop: ['tco-in-pop', 'tco-in-pop-x'],
    drop: ['tco-in-drop', 'tco-in-drop'], bounce: ['tco-in-bounce', 'tco-in-bounce-x'], spring: ['tco-in-spring', 'tco-in-spring-x'],
    zoom: ['tco-in-zoom', 'tco-in-zoom-x'], flip: ['tco-in-flip', 'tco-in-flip'], tilt: ['tco-in-tilt', 'tco-in-tilt'],
    unfold: ['tco-in-unfold', 'tco-in-unfold'], glitch: ['tco-in-glitch', 'tco-in-glitch'], scan: ['tco-in-scan', 'tco-in-scan-x'],
    decode: ['tco-in-decode', 'tco-in-decode'] };
  // exit_style=slide: the line moves out toward the edge old lines leave by as it fades: the top of a column, the bottom
  // of one with the newest line on top (newestFirst), the left end of a row.
  var EXIT_SLIDE = { up: 'tco-out-slide', down: 'tco-out-slide-down', left: 'tco-out-slide-x' };
  var ENTER_STYLES = Object.keys(ENTER);
  // Every name onAnimEnd acts on, whatever the settings were when the animation began.
  var ENTER_NAMES = ['tco-in', 'tco-in-x', 'tco-in-fade', 'tco-in-pop', 'tco-in-pop-x', 'tco-in-drop', 'tco-in-bounce',
    'tco-in-bounce-x', 'tco-in-spring', 'tco-in-spring-x', 'tco-in-zoom', 'tco-in-zoom-x', 'tco-in-flip', 'tco-in-tilt',
    'tco-in-unfold', 'tco-in-glitch', 'tco-in-scan', 'tco-in-scan-x', 'tco-in-decode'];
  // enter_style=decode: the name's and the message's letters A-Z, a-z and digits start as random ones of their own kind
  // and settle into place from the first to the last over the entrance (enter_ms). Only those, so a line keeps about
  // its width while it decodes: other letters, emoji, emotes and badges are drawn as they are. Redrawn every
  // DECODE_TICK_MS; at most DECODE_MAX lines at once (a burst's others only fade in).
  var DECODE_TICK_MS = 40;
  var DECODE_MAX = 12;
  var DECODE_SETS = [[/[A-Z]/, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], [/[a-z]/, 'abcdefghijklmnopqrstuvwxyz'], [/[0-9]/, '0123456789']];
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
    enter_style: { values: ENTER_STYLES, def: 'slide' },
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
    row_align: { values: ['left', 'center', 'right'], def: 'right' },
    line_width: { min: 0, max: 100, def: 0 },
    pad_x: { min: 0, max: 200, def: 8 },
    edge_fade: { min: 0, max: 10, def: 0 },
    row_sep: { values: ['none', 'dot', 'bar', 'diamond'], def: 'none' },
    text_px: { min: 0, max: 96, def: 0 }, // 1..7 is drawn as 8 (pxFor), as config.js stores it
    badge_size: { min: 50, max: 200, def: 100 },
    emote_scale: { min: 50, max: 200, def: 100 },
    emote_only: { values: ['normal', 'big', 'huge'], def: 'normal' },
    row_grow: { bool: true, def: false },
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
  // A 7TV paint's image file (1x to 4x, paint-css.js ruleFor's scale) for a name drawn at px: its box (NAME_BOX_EM) times
  // the pixel ratio, stretched no more than PAINT_STRETCH, so a name at medium or large in OBS (29 and 39 px tall) keeps
  // the 1x file it always had, and text_px=96 (116 px) takes the 3x.
  function paintScale(px, dpr) {
    return Math.min(4, Math.max(1, ceilSafe(px * NAME_BOX_EM * (dpr > 0 ? dpr : 1) / (PAINT_BASE_PX * PAINT_STRETCH))));
  }
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
  // larger) than the chat text's, so the same number of them would make notices narrower than the chat lines. A column's
  // only: in a row a notice's line keeps the row's em (css/overlay.css), so --line-max caps it there.
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
  // decode: chars (code points) with the first `keep` as they are and the rest of A-Z, a-z and 0-9 swapped for a random
  // one of the same kind. rnd: a random number in [0, 1), Math.random unless a test passes its own.
  function decodeText(chars, keep, rnd) {
    var out = '';
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i], set = null;
      if (i >= keep) {
        for (var j = 0; j < DECODE_SETS.length; j++) if (DECODE_SETS[j][0].test(c)) { set = DECODE_SETS[j][1]; break; }
      }
      out += set ? set.charAt(Math.floor((rnd || Math.random)() * set.length)) : c;
    }
    return out;
  }
  // Whether text has a character decode scrambles.
  function decodable(text) { return /[A-Za-z0-9]/.test(text); }

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
  // after the Twitch login too; a bare name (mentions=name) the same way in front (my-home). A Japanese or Korean suffix
  // (@homeさん, @home님, @home-さん) or a word before the '@' doesn't.
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
  // twitch.tv/name link, a domain) or a '-' that joins them to a longer name (my-home, another Kick slug); null while
  // mentions is off or there is no channel. keyword: any of the keywords.
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
        // name: the '@' form as at finds it, or the bare name, which a '-' joined to a name character before it makes
        // part of a longer name too (jelly-bean, kick.com/my-home), as one after it does.
        var atForm = '(?<!' + LOGIN_CH + ')@';
        out.mention = makeRe((c.mentions === 'at' ? atForm
          : '(?:' + atForm + '|(?<![\\p{Script=Latin}\\p{M}\\p{Nd}_/.@])(?<!' + LOGIN_CH + '-))') +
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

  // A chat line that mentions the channel: its name in the text (as drawn: visibleText, and drawnText's links), or a reply
  // to the channel. The channel's own lines don't count (on Twitch its login, on Kick its slug).
  function mentionsChannel(msg, m, cfg) {
    var kick = msg.platform === 'kick';
    var login = typeof msg.login === 'string' ? msg.login.toLowerCase() : '';
    if (kick ? m.kickKey && slugKey(login) === m.kickKey : m.channel && login === m.channel) return false;
    var to = msg.reply && typeof msg.reply === 'object' && typeof msg.reply.login === 'string' ? msg.reply.login.toLowerCase() : '';
    if (to && (kick ? m.kickKey && slugKey(to) === m.kickKey : m.channel && to === m.channel)) return true;
    return typeof msg.text === 'string' && m.mention.test(visibleText(drawnText(msg.text, cfg)));
  }

  // links=shorten: a text with each link as the host name it is drawn as (overlay.js tokensFor shortens the drawn text so),
  // so the keywords, mentions, block_words and min_length match and count what is seen, not a path that isn't drawn.
  function drawnText(text, cfg) { return cfg && cfg.links === 'shorten' ? shortenLinks(text) : text; }

  // A chat line's text as it is drawn, for the keywords: a Twitch reply without its leading "@Parent" while replies are on
  // (overlay.js tokensFor leaves it out with tokenizer.stripReplyPrefix, whose rule this is; with replies=0 it is drawn,
  // and matched); a Kick line as Kick sends it; links as drawnText draws them. overlay.js matches block_words against
  // the same text (shownText).
  function shownText(msg, cfg) {
    var t = msg.text, r = msg.reply;
    if (cfg.replies === false || msg.platform === 'kick' || !r || typeof r !== 'object' || t.charAt(0) !== '@') return drawnText(t, cfg);
    var low = t.toLowerCase(), names = [r.name, r.login];
    for (var i = 0; i < names.length; i++) {
      if (!names[i]) continue;
      var n = '@' + String(names[i]).toLowerCase();
      if (low.indexOf(n) === 0 && (low.length === n.length || low.charAt(n.length) === ' ')) return drawnText(t.slice(n.length).replace(/^ /, ''), cfg);
    }
    return drawnText(t, cfg);
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
    if (!tint && m.mention && mentionsChannel(msg, m, cfg)) tint = 'mention';
    if (!tint && m.keyword && typeof msg.text === 'string' && hasKeyword(shownText(msg, cfg), m.keyword)) tint = 'keyword';
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

  // emoteOnly: the line is one modelFor found to be emotes alone (emote_only=big/huge, in a column, or in a row with
  // row_grow). rtl: a row's message that starts right to left (startsRtl): the stylesheet gives it a box of its own, to
  // end in its own ellipsis.
  // inlineReply: a chat line with a reply header in a row along the top edge (.inline-reply, css/overlay.css).
  function lineClasses(msg, cfg, kind, action, emoteOnly, rtl, inlineReply) {
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
      if (rtl) c.push('rtl');
      if (inlineReply) c.push('inline-reply');
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
  // one without a host, stays as it is. An international name is shown in its own letters ('www.müller.de'), as
  // links=show and a browser's address bar show it, not as the parser writes it ('www.xn--mller-kva.de'), unless it
  // could pass for another name: then it keeps that xn-- form, as the address bar keeps it (see spoofable).
  function shortenLinks(text) {
    if (!hasLink(text)) return text;
    return text.replace(LINKS_RE, function (url) {
      var tail = (/[(\[{<]/.test(url) ? /[.,!?;:'"]+$/ : /[.,!?;:'")\]}>]+$/).exec(url);
      var core = tail ? url.slice(0, tail.index) : url;
      var host = '';
      try { host = new URL(/^www\./i.test(core) ? 'http://' + core : core).hostname; } catch (e) { host = ''; }
      return host ? hostLetters(host) + (tail ? tail[0] : '') : url;
    });
  }
  // A host name from the URL parser with each 'xn--' label (the parser's ASCII form of an international name) decoded.
  // A label that doesn't decode stays as it is. The name stays as the parser wrote it, whole, as a browser shows it, when
  // its letters are not the name the host stands for (sameHost), or a label could pass for another name (spoofable).
  function hostLetters(host) {
    if (host.indexOf('xn--') < 0) return host;
    var ascii = false;
    var labels = host.split('.').map(function (label) {
      var u = label.slice(0, 4) === 'xn--' ? punyDecode(label.slice(4)) : null;
      // An xn-- label is the ASCII form of a name with a letter past ASCII: one that decodes to plain ASCII stands for
      // no name ('xn--paypal-' is not 'paypal').
      if (u && !NON_ASCII_RE.test(u)) ascii = true;
      return u || label;
    });
    var shown = labels.join('.');
    if (ascii || !sameHost(shown, host)) return host;
    var tld = labels[labels.length - 1];
    for (var i = 0; i < labels.length; i++) if (spoofable(labels[i], tld)) return host;
    return shown;
  }
  var NON_ASCII_RE = /[^\x00-\x7F]/;
  // The URL parser's host for a name, '' when it refuses it.
  function parsedHost(name) {
    try { return new URL('http://' + name + '/').hostname; } catch (e) { return ''; }
  }
  // Chromium before 110 (OBS's CEF 103) maps the four letters IDNA 2003 and 2008 read apart (ß, ς and the two joiners)
  // as IDNA 2003 did: 'faß' is parsed as 'fass' there.
  var DEVIATION_RE = /[\u00DF\u03C2\u200C\u200D]/;
  var TRANSITIONAL = parsedHost('\u00DF') === 'ss';
  // Whether shown (host with its xn-- labels decoded) is the name host is the ASCII form of: parsed again, it gives host
  // back. Chromium's parser takes an all-ASCII host as it is, so an xn-- label no name can have gets this far: one that
  // decodes to capitals ('xn--pwaapwhl' to 'ΑΜΑΖΟΝ', whose own form is 'xn--mxaapwhl'), to text no name is written in,
  // or a top-level name that decodes to another one ('xn--ru-' to 'ru'). Where the parser maps ß, ς and the joiners
  // away (TRANSITIONAL), a name with one can't come back as itself: it passes when the parser takes it and it is written
  // as a name is (lower case, NFC).
  function sameHost(shown, host) {
    var back = parsedHost(shown);
    if (back === host) return true;
    return TRANSITIONAL && back !== '' && DEVIATION_RE.test(shown) && shown === shown.toLowerCase() &&
      (typeof shown.normalize !== 'function' || shown === shown.normalize('NFC'));
  }
  // Scripts with letters that look like Latin ones (the core of Chromium's IDN display rule, which keeps such names in
  // their xn-- form): the script, its lower-case Latin look-alikes, and the country names under which a name made of
  // them alone is that country's own (Chromium allows those).
  var LOOKALIKE_SCRIPTS = [
    { script: new RegExp('\\p{Script=Cyrillic}', 'u'),
      like: /^[\u0430\u0441\u0501\u0435\u04BB\u0456\u0458\u04CF\u043E\u0440\u051B\u0455\u051D\u0445\u0443\u044A\u044C\u04BD\u043F\u0433\u0475\u0461]$/,
      tlds: ['bg', 'by', 'kg', 'kz', 'mk', 'mn', 'rs', 'ru', 'su', 'tj', 'ua', 'uz'] },
    { script: new RegExp('\\p{Script=Greek}', 'u'),
      like: /^[\u03B1\u03B2\u03B3\u03B5\u03B9\u03BA\u03BD\u03BF\u03C1\u03C4\u03C5\u03C7\u03C9\u03AC\u03AD\u03AF\u03CC\u03CD\u03CE]$/,
      tlds: ['gr', 'cy'] },
    { script: new RegExp('\\p{Script=Armenian}', 'u'), like: /^[\u0585\u057D\u0578\u0570\u0566\u0581\u0575]$/, tlds: ['am'] }
  ];
  var LETTER_RE = new RegExp('\\p{L}', 'u');
  var CODE_POINTS_RE = new RegExp('[\\s\\S]', 'gu');
  // The scripts a name may be written in (UTS 31's Recommended scripts, the ones a browser's address bar shows in their
  // letters), each matched by Script_Extensions, so a sign some of them share (the Japanese 'ー') counts for each. A
  // letter of any other script (Cherokee 'Ꭺ', Lisu 'ꓲ', and the other Limited Use or historic ones) keeps the xn-- form.
  var NAME_SCRIPTS = ['Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Thaana', 'Devanagari', 'Bengali',
    'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar',
    'Georgian', 'Hangul', 'Ethiopic', 'Khmer', 'Han', 'Hiragana', 'Katakana', 'Bopomofo'].map(function (name) {
    return { name: name, re: new RegExp('\\p{Script_Extensions=' + name + '}', 'u') };
  });
  // The scripts that may share one name (UTS 39's Highly Restrictive level, as Chromium shows names): Latin with Chinese,
  // Japanese or Korean. Any other mix ('www.аpple.com', a Cyrillic 'а' among Latin letters) keeps the xn-- form.
  var NAME_MIXES = [['Latin', 'Han', 'Hiragana', 'Katakana'], ['Latin', 'Han', 'Bopomofo'], ['Latin', 'Han', 'Hangul']];
  var LATIN_ONLY = ['Latin'];
  var LATIN_SCRIPT_RE = new RegExp('\\p{Script=Latin}', 'u');
  // The Latin letters past ASCII a name may use (UTS 39 Identifier_Status=Allowed): not the IPA, phonetic, small-capital
  // and other rare ones ('ɡoogle' with U+0261, 'ᴀpple' with U+1D00).
  var LATIN_OK_RE = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u0113\u0116-\u012B\u012E-\u0131\u0134-\u0137\u0139-\u013E\u0141-\u0148\u014A-\u014D\u0150-\u0155\u0158-\u0161\u0164-\u017E\u0181\u0186\u0189\u018A\u018E-\u0192\u0194\u0196-\u0199\u019D\u01A0\u01A1\u01AF\u01B0\u01B2-\u01B4\u01B7\u01CD-\u01D4\u01DD\u01E6-\u01E9\u01EE\u01EF\u01F8\u01F9\u0218-\u021B\u0244\u024C\u024D\u0253\u0254\u0256\u0257\u0259\u025B\u0263\u0268\u0269\u0272\u0289\u028B\u0292\u1E0C\u1E0D\u1E12\u1E13\u1E20\u1E21\u1E24\u1E25\u1E36\u1E37\u1E3C-\u1E3F\u1E42-\u1E4B\u1E5A\u1E5B\u1E62\u1E63\u1E6C\u1E6D\u1E70\u1E71\u1E8C\u1E8D\u1E92\u1E93\u1E9E\u1EA0-\u1EF9\uA78D\uA7AA]/;
  // Of those, the ones that look like an ASCII letter (UTS 39 confusables): a name whose only other letters are ASCII
  // ('gıthub', 'aþþle') passes for an ASCII one.
  var LATIN_LIKE_RE = /^[\u0131\u00FE\u0192\u0263\u0269\u028B]$/;
  // Signs of no script of their own (Common, Inherited) a name may use, beside ASCII digits and '-': the Japanese 'ー' and
  // the Arabic vowel signs. Any other (a symbol, an emoji, a loose accent, a joiner) keeps the xn-- form.
  var SHARED_SIGN_RE = new RegExp('[\\p{Script=Common}\\p{Script=Inherited}]', 'u');
  var SHARED_OK_RE = /^[\u30FC\u064B-\u0652\u0654\u0655\u0670]$/;
  // The scripts (NAME_SCRIPTS names) a character can be written in; [] for none of them.
  function scriptsOf(ch) {
    var out = [];
    for (var i = 0; i < NAME_SCRIPTS.length; i++) if (NAME_SCRIPTS[i].re.test(ch)) out.push(NAME_SCRIPTS[i].name);
    return out;
  }
  function overlaps(a, b) {
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return true;
    return false;
  }
  // Whether a decoded label could pass for another name (a homograph), close to Chromium's rule for showing a name in
  // its letters: it keeps the xn-- form when it has a character no name should use (a rare Latin letter, a letter of a
  // script outside NAME_SCRIPTS, a symbol or emoji), mixes scripts other than as NAME_MIXES allows, is Latin with only
  // ASCII look-alikes past ASCII, or is made only of Cyrillic, Greek or Armenian look-alikes of Latin letters ('аррӏе.com')
  // where the top-level name (tld, decoded) is neither in that script ('яндекс.рф') nor its country's. ASCII digits and
  // hyphens don't count. Every other name ('www.müller.de', '例え.jp', 'コーヒー.jp', 'кириллица.com') is shown in its letters.
  function spoofable(label, tld) {
    var chars = label.match(CODE_POINTS_RE) || [];
    var sets = [], like = false, past = false, s;
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (/^[0-9-]$/.test(ch)) continue;
      if (/^[a-z]$/.test(ch)) {
        s = LATIN_ONLY;
      } else if (LATIN_SCRIPT_RE.test(ch)) {
        if (!LATIN_OK_RE.test(ch)) return true;
        if (LATIN_LIKE_RE.test(ch)) like = true;
        else past = true;
        s = LATIN_ONLY;
      } else {
        if (SHARED_SIGN_RE.test(ch) && !SHARED_OK_RE.test(ch)) return true;
        s = scriptsOf(ch);
        if (!s.length) return true;
      }
      sets.push(s);
    }
    if (!sets.length) return false;
    // One script for every character, or else one of the mixes that covers each.
    var one = sets[0].filter(function (name) {
      for (var k = 1; k < sets.length; k++) if (sets[k].indexOf(name) < 0) return false;
      return true;
    });
    if (!one.length && !NAME_MIXES.some(function (mix) {
      for (var k = 0; k < sets.length; k++) if (!overlaps(sets[k], mix)) return false;
      return true;
    })) return true;
    // A Latin name: an ASCII one in disguise when its only letters past ASCII look like ASCII ones.
    if (one.length === 1 && one[0] === 'Latin') return like && !past;
    var look = -1, allLike = true;
    for (var j = 0; j < chars.length; j++) {
      if (!LETTER_RE.test(chars[j])) continue;
      var sj = -1;
      for (var q = 0; q < LOOKALIKE_SCRIPTS.length && sj < 0; q++) if (LOOKALIKE_SCRIPTS[q].script.test(chars[j])) sj = q;
      if (sj < 0) return false; // a letter of another script: no look-alike name
      look = sj;
      if (!LOOKALIKE_SCRIPTS[sj].like.test(chars[j])) allLike = false;
    }
    if (look < 0) return false;
    var sc = LOOKALIKE_SCRIPTS[look];
    return allLike && !sc.script.test(tld) && sc.tlds.indexOf(tld) < 0;
  }
  // RFC 3492 punycode: the letters a label's part after 'xn--' stands for, or null when it is not valid punycode (a
  // digit that isn't one, an overflow, no code point).
  var PUNY_MAX = 2147483647;
  function punyAdapt(delta, points, first) {
    var k = 0;
    delta = first ? Math.floor(delta / 700) : delta >> 1;
    delta += Math.floor(delta / points);
    for (; delta > 455; k += 36) delta = Math.floor(delta / 35);
    return Math.floor(k + 36 * delta / (delta + 38));
  }
  function punyDecode(s) {
    var out = [], n = 128, i = 0, bias = 72;
    var basic = Math.max(s.lastIndexOf('-'), 0);
    for (var j = 0; j < basic; j++) {
      if (s.charCodeAt(j) >= 0x80) return null;
      out.push(s.charCodeAt(j));
    }
    for (var at = basic > 0 ? basic + 1 : 0; at < s.length;) {
      var old = i;
      for (var w = 1, k = 36; ; k += 36) {
        if (at >= s.length) return null;
        var c = s.charCodeAt(at++);
        var digit = c >= 48 && c < 58 ? c - 22 : c >= 65 && c < 91 ? c - 65 : c >= 97 && c < 123 ? c - 97 : 36;
        if (digit >= 36 || digit > Math.floor((PUNY_MAX - i) / w)) return null;
        i += digit * w;
        var t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
        if (digit < t) break;
        if (w > Math.floor(PUNY_MAX / (36 - t))) return null;
        w *= 36 - t;
      }
      var len = out.length + 1;
      bias = punyAdapt(i - old, len, old === 0);
      if (Math.floor(i / len) > PUNY_MAX - n) return null;
      n += Math.floor(i / len);
      i %= len;
      if (n > 0x10FFFF) return null;
      out.splice(i++, 0, n);
    }
    try { return out.length ? String.fromCodePoint.apply(String, out) : null; } catch (e) { return null; }
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
  // command: a message that starts with one of command_prefixes after any spaces, followed straight away by a letter or
  // a digit: the command's name ('!points', '?song', '!8ball', '!été'). A sign alone, or with more signs or a space after
  // it, is chat ('!!!', '! wow', '???', ':)', '...', '-_-'; renderer-css round 3: these were hidden too). With ':' a
  // message such as ':D' still counts (D is a letter). Signs are escaped in the class where they could mean something
  // there, so '-' and '^' stand for themselves ('!' when there are none, as before the setting).
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
    // ASCII signs only. The u flag (for \p{L}) takes a backslash in a class only before a sign with a meaning of its own
    // and '/' or '-' (any other escaped sign is a SyntaxError), so only those get one; the rest are themselves as they are.
    for (var j = 0; j < pre.length; j++) {
      var ch = pre.charAt(j);
      if (/^[!-\/:-@\[-`{-~]$/.test(ch)) cls += (/^[\^$\\.*+?()[\]{}|\/\-]$/.test(ch) ? '\\' : '') + ch;
    }
    out.command = new RegExp('^\\s*[' + (cls || '!') + '](?=[\\p{L}\\p{N}])', 'u');
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
  // (links=shorten): links in what they said show as their host name, as in the message itself. The header puts one '@'
  // before the name: a name that has its own (Kick's StreamElements bot is "@StreamElements") gets no second one. A
  // Twitch name never starts with one, so its header is unchanged.
  function replyModel(reply, short, shorten) {
    if (!reply) return null;
    var name = String(reply.name || reply.login || '');
    if (!name) return null;
    var shown = '@' + util.capMarks(name.replace(/^@+/, '') || name);
    if (short) return { name: shown, short: true };
    var body = String(reply.body || '').replace(/^\u0001ACTION /, '').replace(/\u0001$/, '').replace(/[\r\n]+/g, ' ');
    // A quoted repeat's Chatterino/7TV suffix, as the message's own is taken off (tokenizer.cleanText).
    body = body.replace(/(?: ?\u{E0000})+$/u, '').replace(/ ?͏$/, '');
    if (shorten) body = shortenLinks(body);
    return { name: shown, body: util.capMarks(body) };
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

  // Whether text starts right to left: its first letter (or direction mark) is a right-to-left one, as the stylesheet's
  // unicode-bidi: plaintext finds it (Unicode's rule P2). Digits, signs, spaces and emoji have no direction of their own
  // and are passed over. Right to left: the letters of the blocks given to Hebrew, Arabic, Syriac, Thaana, N'Ko and the
  // other right-to-left scripts (U+0590 to U+08FF, their presentation forms, and U+10800 to U+10FFF and U+1E800 to
  // U+1EFFF above U+FFFF), and the right-to-left and Arabic letter marks. A message or a reply's quote that does is drawn
  // in a box of its own wherever it ends in an ellipsis (a row, a reply header), so it is cut at its own end: the box it
  // is in otherwise runs left to right, and cuts it at its start, which right-to-left text has on the right.
  var FIRST_STRONG_RE = /[\p{L}\u200E\u200F\u061C]/u;
  function startsRtl(text) {
    var m = typeof text === 'string' ? FIRST_STRONG_RE.exec(text) : null;
    if (!m) return false;
    var cp = m[0].codePointAt(0);
    return cp === 0x200F || (cp >= 0x590 && cp <= 0x8FF) || (cp >= 0xFB1D && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF) ||
      (cp >= 0x10800 && cp <= 0x10FFF) || (cp >= 0x1E800 && cp <= 0x1EFFF);
  }
  // The text a message's parts draw, in order (emotes, cheers and GIFs are pictures, with no direction of their own).
  function partsText(parts) {
    var s = '';
    for (var i = 0; i < parts.length; i++) if (parts[i].t === 'text') s += parts[i].s;
    return s;
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
  // opts: { px: font px, dpr, flatBig: big emotes and GIFs drawn at emote height (a horizontal row without row_grow), gifs,
  // scale: emote_scale as a factor (1 when left out), giant: false draws gigantified emotes like any other (the default is
  // true), eo: an emote-only line's factor (emote_only; 1 when left out), gifMul: a GIF's height in emote heights where
  // it isn't flat (gif_size; 3 when left out) }
  function partsFor(items, opts) {
    var parts = [];
    if (!Array.isArray(items)) return parts;
    var px = opts.px, dpr = opts.dpr;
    var big3 = !opts.flatBig;
    var giant = opts.giant !== false;
    var scale = opts.scale > 0 ? opts.scale : 1;
    // An emote-only line draws its emotes eo times as tall, except a gigantified one, which keeps its 3.
    var eoScale = opts.eo > 1 ? scale * opts.eo : scale;
    // How tall a GIF is drawn, in CSS px: an emote's height (emote_scale too) times gif_size, or once in a flat row.
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
    // A row draws GIFs, gigantified emotes and emote-only messages at emote height (flat), unless row_grow lets them
    // grow the row: then they are drawn, and fetched, at their column sizes.
    var flat = cfg.layout === 'horizontal' && cfg.row_grow !== true;
    // emote_only=big/huge, in a column (or such a row): a message of emotes alone gets its class (the stylesheet draws
    // its emotes --eo times as tall), and its emotes are fetched that much bigger. Only looked for while it is on.
    var eo = !flat && Object.prototype.hasOwnProperty.call(EMOTE_ONLY, cfg.emote_only) ? EMOTE_ONLY[cfg.emote_only] : 0;
    var only = eo > 0 && emoteOnly(d.items);
    var parts = partsFor(d.items, { px: px, dpr: dpr, flatBig: flat, gifs: cfg.gifs !== false,
      scale: sizeScale(cfg.emote_scale), giant: cfg.giant_emotes !== false, eo: only ? eo : 1,
      gifMul: Object.prototype.hasOwnProperty.call(GIF_MUL, cfg.gif_size) ? Number(GIF_MUL[cfg.gif_size]) : 3 });
    // In a row a message never wraps: one that starts right to left gets the class that ends it in its own ellipsis.
    var rtl = cfg.layout === 'horizontal' && startsRtl(partsText(parts));
    var reply = cfg.replies === false || d.noReply ? null : replyModel(msg.reply, cfg.reply_style === 'name', cfg.links === 'shorten');
    // Along the top edge of a row the header sits before the message on the same row: the line is a row of its parts,
    // so the header gives way to the reply's own name (the stylesheet).
    var inlineReply = !!reply && cfg.layout === 'horizontal' && cfg.align === 'top';
    var model = {
      kind: 'chat',
      cls: lineClasses(msg, cfg, 'chat', action, only, rtl, inlineReply),
      reply: reply,
      badges: badgeModels(visibleBadges(d.badges, cfg), wantBadge(px, dpr, sizeScale(cfg.badge_size))),
      name: { text: text, color: color, paint: paint },
      // name_sep: one of the fixed NAME_SEPS strings; ': ' for anything else (a partial cfg).
      colon: action ? ' ' : Object.prototype.hasOwnProperty.call(NAME_SEPS, cfg.name_sep) ? NAME_SEPS[cfg.name_sep] : ': ',
      msgColor: action ? color : null,
      parts: parts
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
    // Shared Chat: a partner's message has two ids, the home copy's own and the partner's (its source id), and a reply, a
    // deletion or a robotty rm-deleted line may name either. alias: each one -> the other, for every message pushed or
    // noted with both, so a deletion by one takes the quotes that name the other, and a reply naming either finds the
    // deletion or the return after a timeout (quoteModerated). Kept as long as spoke.
    var alias = new DeletedIds(CLEARED_TTL_MS, DELETED_CAP);
    var mseq = 0;
    // Chat clears (clearAll), oldest first: { seq: mseq at the clear, at: ms, pred: the lines it took (null: all) }. A reply
    // on a line a clear covers loses its header when the message it quotes is from before that clear: one the clear took,
    // or one the overlay hasn't heard of since (it had already left the screen, or came before the overlay started).
    // heard: message id (and source id) -> mseq, noted for every message pushed while a clear is kept, so a reply to
    // what is said after the clear keeps its header. A clear is kept CLEARED_TTL_MS, as a ban is, and only while heard
    // still holds every message since it (DELETED_CAP).
    var clears = [];
    var heard = new Map();
    // Messages whose reply quote was found moderated: it stays out for good, also when the line is redrawn after the
    // deletion, ban or clear has left the lists above (expired, or pushed out by their caps in a busy chat).
    var goneQuotes = new WeakSet();
    var byId = new Map();        // msg id / source id -> line
    var byUser = new Map();      // user id -> Set<line>
    var recs = new WeakMap();    // line -> {msg, src, kind, gid, born, sig, ids, userId, fadeLater}
    var paintState = new Map();  // paint id -> true (rule inserted) | false (rule rejected)
    var stillState = new Map();  // paint_images=static: paint id -> true (still rule inserted) | false (none)
    var paintAt = 1;             // the paint files the rules are for (paintScale of the text size and dpr)
    var styleEl = null;
    var held = false, destroyed = false;
    var scheduled = false, rafId = null, flushTimer = null, gapTimer = null, lastFlushAt = 0;
    var trimTimer = null, sweepTimer = null;
    var slideAt = 0, slideDx = 0;
    var gliders = [], glideTimer = null; // row_align=left/center: lines easing into the room a leaving line left
    var settleUntil = 0, settleTimer = null;
    var decoding = [], decodeTimer = null; // enter_style=decode: lines whose letters are settling (startDecode)
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

    function callDep(name, arg, arg2) {
      var fn = deps[name];
      if (typeof fn !== 'function') return undefined;
      try { return arg2 === undefined ? fn(arg) : fn(arg, arg2); } catch (e) {
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
        var rule = callDep('paintRule', id, paintAt);
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
      var rule = callDep('paintStaticRule', id, paintAt);
      // undefined: not known yet (overlay.js is looking for a v3 paint's still frame): asked again on the next render, or
      // at once when it is found (stillReady).
      if (rule === undefined && typeof deps.paintStaticRule === 'function') return;
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
    // A text size that wants other paint files (paintScale): every paint rule in use is made again for them, in the same
    // <style>. The names keep their classes, so nothing is redrawn for it. Called once cfg is the new one.
    function rescalePaints() {
      var s = paintScale(pxFor(cfg), dpr);
      if (s === paintAt) return;
      paintAt = s;
      if (!paintState.size && !stillState.size) return;
      var ids = [];
      paintState.forEach(function (ok, id) { if (ok) ids.push(id); });
      var sheet = styleEl && styleEl.sheet;
      if (sheet) {
        try {
          while (sheet.cssRules.length) sheet.deleteRule(sheet.cssRules.length - 1);
        } catch (e) {
          util.warn('renderer: paint rules not cleared', e && e.message);
          return;
        }
      }
      paintState.clear();
      stillState.clear();
      for (var i = 0; i < ids.length; i++) ensurePaint(ids[i]);
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
        // .rtl: a quote that starts right to left gets a box of its own (the stylesheet), to end in its own ellipsis.
        var r = el('div', !model.reply.short && startsRtl(model.reply.body) ? 'reply rtl' : 'reply');
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
        // A moderated quote, or one the overlay's filters hide (bots, hide_commands, block_words, links=hide; asked again on
        // each redraw, with the reply's message: whose bot list applies depends on where it was said).
        noReply: replyGone(msg, Date.now()) || (!!msg.reply && !!callDep('quoteHidden', msg.reply, msg)),
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

    // ----- chat clears (see clears) -----
    // Whether pred (a clear's) covers msg: a throwing pred covers nothing, as in clearAll.
    function covers(pred, msg) {
      if (!pred) return true;
      try { return !!pred(msg); } catch (e) { return false; }
    }
    // Clears older than CLEARED_TTL_MS go; with none left, nothing more is noted.
    function pruneClears(now) {
      while (clears.length && now - clears[0].at >= CLEARED_TTL_MS) clears.shift();
      if (!clears.length) heard.clear();
    }
    function hear(id) {
      if (!id) return;
      heard.delete(id);
      heard.set(id, ++mseq);
      if (heard.size <= DELETED_CAP) return;
      // The oldest goes: a clear from before it no longer knows everything said since, and goes too.
      var first = heard.entries().next().value;
      heard.delete(first[0]);
      while (clears.length && clears[0].seq < first[1]) clears.shift();
      if (!clears.length) heard.clear();
    }
    // A reply on msg's line quotes pid, a message from before a clear that covers the line.
    function clearedBefore(msg, pid, now) {
      if (!clears.length) return false;
      var said = pid && heard.has(pid) ? heard.get(pid) : 0;
      for (var i = 0; i < clears.length; i++) {
        var c = clears[i];
        if (now - c.at < CLEARED_TTL_MS && said <= c.seq && covers(c.pred, msg)) return true;
      }
      return false;
    }

    // The message a reply quotes was deleted, or its author was timed out or banned after sending it, or a chat clear
    // took it: the "↪ @user: text" header would put the moderated text back on stream.
    function replyGone(msg, now) {
      var r = msg.reply;
      if (!r || typeof r !== 'object') return false;
      if (goneQuotes.has(msg)) return true;
      if (!quoteModerated(msg, r, now)) return false;
      goneQuotes.add(msg);
      return true;
    }
    function quoteModerated(msg, r, now) {
      var pid = util.idStr(r.id);
      // The parent by either of its Shared Chat ids (alias): the reply may name the one the moderation didn't.
      var other = pid ? alias.get(pid, now) : undefined;
      if (pid && (deleted.has(pid, now) || deleted.has(other, now))) return true;
      if (clearedBefore(msg, pid, now)) return true;
      var uid = util.idStr(r.userId);
      var at = uid ? cleared.get(uid, now) : undefined;
      if (at === undefined) return false;
      var said = pid ? spoke.get(pid, now) : undefined;
      if (said === undefined && other) said = spoke.get(other, now);
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
    // first line that leaves in view takes the mark after it along, as before. leading: line is the last of a run of
    // lines leaving together from the row's start (removeLines), so the line after it is the new first.
    function keepSepAfter(line, leading) {
      var next = line.nextElementSibling;
      if (!next || !(leading || line === linesEl.firstElementChild) || !rowMarks(cfg)) return;
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
    // running slide's offset, the row's transform, taken off) is past it. A row aligned left or center (row_align) that no
    // longer fills the source sits at its left end or in its middle, wherever that is: its first line is in view then.
    function dropLoneSep() {
      if (!cfg || cfg.layout !== 'horizontal') return;
      var first = linesEl.firstElementChild;
      var rec = first && recs.get(first);
      if (!rec || !rec.keepSep) return;
      var view = rootEl.getBoundingClientRect();
      if (!(view.width > 0)) return;
      var box = linesEl.getBoundingClientRect(), slid = box.left - view.left;
      var cs = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(linesEl) : null;
      var gap = cs ? parseFloat(cs.columnGap) || 0 : 0;
      if (first.getBoundingClientRect().left - slid <= view.left + gap + 1 && !(rowAligned() && rowRoom(box, cs))) return;
      unkeepSep(first, rec);
    }
    // row_align=left or center: a row that doesn't fill the source sits at its left end or in its middle (the stylesheet's
    // auto margins take the room left over); one that does ends at the right edge with its newest line, as always.
    function rowAligned() { return cfg.layout === 'horizontal' && cfg.row_align !== 'right'; }
    // Such a row has room left at its right end: its last line ends short of .lines' content box (box: .lines' rect, cs:
    // its computed style, or null where there is none). Both are measured where they are drawn, mid-slide too.
    function rowRoom(box, cs) {
      var last = linesEl.lastElementChild;
      var pad = cs ? parseFloat(cs.paddingRight) || 0 : 0;
      return !!last && last.getBoundingClientRect().right < box.right - pad - 1;
    }
    function unkeepSep(line, rec) {
      rec.keepSep = false;
      line.classList.remove('keep-sep');
    }
    // row_align=left or center: a row that doesn't fill the source has no right edge holding its lines, so a line that
    // leaves (faded out, deleted, timed out, over max) would make the ones after it (at center, all of them) jump into its
    // room. They glide there instead, in SLIDE_MS like the row's own slide: each line that moved is put back where it was
    // drawn with `left` (position: relative; not transform, which the entrances and exits animate) and eases home.
    // Right, the default, holds its lines at the right edge, and nothing changes there.
    function glideOn() {
      return !!(cfg && cfg.animate && rowAligned() && doc.visibilityState !== 'hidden');
    }
    // Where each line that stays is drawn now (a glide still running included), before the leaving ones go.
    function glideFrom(leaving) {
      var gone = new Set(leaving), from = [];
      for (var l = linesEl.firstElementChild; l; l = l.nextElementSibling) {
        if (!gone.has(l)) from.push({ el: l, x: l.getBoundingClientRect().left });
      }
      return from;
    }
    // After they went: every line that moved starts back where it was and eases home.
    function glideHome(from) {
      endGlides(); // every line at home, so each is measured where it now sits
      var moved = [];
      for (var i = 0; i < from.length; i++) {
        var el = from[i].el;
        if (el.parentNode !== linesEl) continue;
        var dx = from[i].x - el.getBoundingClientRect().left;
        if (Math.abs(dx) > 0.5) moved.push({ el: el, dx: dx });
      }
      if (!moved.length) return;
      for (var j = 0; j < moved.length; j++) {
        var st = moved[j].el.style;
        st.position = 'relative';
        st.transition = 'none';
        st.left = Math.round(moved[j].dx * 100) / 100 + 'px';
        gliders.push(moved[j].el);
      }
      void linesEl.offsetWidth; // style flush: the transitions start from where the lines were
      for (var k = 0; k < moved.length; k++) {
        moved[k].el.style.transition = 'left ' + SLIDE_MS + 'ms ease-out';
        moved[k].el.style.left = '0px';
      }
      glideTimer = setTimeout(endGlides, SLIDE_MS + 50);
    }
    // Every glide over (or cut short by the next one): the lines at home with no inline value left behind, as a line
    // that never glided. transition 'none' first stops a running one (see stopGlide).
    function endGlides() {
      if (glideTimer) { clearTimeout(glideTimer); glideTimer = null; }
      if (!gliders.length) return;
      for (var i = 0; i < gliders.length; i++) {
        var st = gliders[i].style;
        st.transition = 'none';
        st.left = '';
        st.position = '';
      }
      void linesEl.offsetWidth; // style flush
      for (var j = 0; j < gliders.length; j++) gliders[j].style.transition = '';
      gliders = [];
    }
    // The single place a line leaves the DOM; clears every index. batch: removeLines has done keepSepAfter's part (and
    // the glide's).
    function removeLine(line, batch) {
      if (!line) return;
      var from = !batch && line.parentNode === linesEl && glideOn() ? glideFrom([line]) : null;
      var rec = recs.get(line);
      if (rec) {
        if (!batch) keepSepAfter(line);
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
      if (from) glideHome(from);
    }
    // Several lines at once (a trim, the max cap, faded lines, a filter, a clear): what removeLine one by one would leave,
    // with keepSepAfter's measurement done once, on the last of the lines leaving from the row's start, before any goes.
    // One by one, each removal after the first forced a layout of the whole row (a 200-line backlog: ~150 ms).
    function removeLines(list) {
      if (!list.length) return;
      var from = glideOn() ? glideFrom(list) : null;
      if (rowMarks(cfg)) {
        var gone = new Set(list), last = null;
        for (var l = linesEl.firstElementChild; l && gone.has(l); l = l.nextElementSibling) last = l;
        if (last) keepSepAfter(last, true);
      }
      for (var i = 0; i < list.length; i++) removeLine(list[i], true);
      if (from) glideHome(from);
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
      if (cfg.animate && cfg.enter_style === 'decode') {
        for (var di = 0; di < groups.length; di++) for (var dj = 0; dj < groups[di].length; dj++) startDecode(groups[di][dj], now);
      }
    }

    // ----- enter_style=decode (see decodeText) -----
    // The text nodes of a line's name and message, in order, each with its text and its code points.
    function decodeNodes(line) {
      var out = [];
      var walk = function (node) {
        for (var k = 0; k < node.childNodes.length; k++) {
          var c = node.childNodes[k];
          if (c.nodeType === 3) {
            if (decodable(c.data)) out.push({ node: c, text: c.data, chars: Array.from(c.data) });
          } else if (c.nodeType === 1) walk(c);
        }
      };
      for (var c = line.firstElementChild; c; c = c.nextElementSibling) {
        if (c.classList && (c.classList.contains('name') || c.classList.contains('message'))) walk(c);
      }
      return out;
    }
    function startDecode(line, now) {
      if (decoding.length >= DECODE_MAX) return;
      var items = decodeNodes(line);
      if (!items.length) return;
      var total = 0;
      for (var i = 0; i < items.length; i++) total += items[i].chars.length;
      var d = { line: line, items: items, total: total, start: now, ms: cfg.enter_ms };
      decoding.push(d);
      paintDecode(d, 0);
      if (!decodeTimer) decodeTimer = setTimeout(decodeTick, DECODE_TICK_MS);
    }
    // Shows a line's decode p (0 to 1) of the way through: that share of its characters settled, from the first.
    function paintDecode(d, p) {
      var keep = Math.floor(p * d.total), at = 0;
      for (var i = 0; i < d.items.length; i++) {
        var it = d.items[i];
        var k = Math.max(0, Math.min(it.chars.length, keep - at));
        it.node.data = k >= it.chars.length ? it.text : decodeText(it.chars, k);
        at += it.chars.length;
      }
    }
    function decodeTick() {
      decodeTimer = null;
      if (destroyed) return;
      var now = Date.now(), left = [];
      for (var i = 0; i < decoding.length; i++) {
        var d = decoding[i];
        // Gone, or redrawn (a rerender writes the line anew, with its real text): nothing more to settle.
        if (d.line.parentNode !== linesEl || !d.line.contains(d.items[0].node)) continue;
        var p = (now - d.start) / d.ms;
        paintDecode(d, Math.min(1, p));
        if (p < 1) left.push(d);
      }
      decoding = left;
      if (decoding.length) decodeTimer = setTimeout(decodeTick, DECODE_TICK_MS);
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
      // From the oldest end, whole groups at a time.
      var kids = children(), victims = [], step = top ? -1 : 1, at = top ? kids.length - 1 : 0;
      for (; groups > cfg.max && kids[at]; groups--) {
        var gid = gidOf(kids[at]);
        do {
          victims.push(kids[at]);
          at += step;
        } while (kids[at] && gid !== null && gidOf(kids[at]) === gid);
      }
      removeLines(victims);
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
      removeLines(dead);
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
      // row_align=left or center: a row that no longer filled the source once these lines left would move the rest (to its
      // left end, or half as far) after a slide's offset was measured with them in. So the leading lines go only up to one
      // whose next line starts at or left of where the row starts (.lines' content box): the row still fills the source
      // and nothing moves, as in a row at the right. A later flush takes the others, which new lines push further out.
      if (cnt && rowAligned()) {
        var cs = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(linesEl) : null;
        var start = linesEl.getBoundingClientRect().left + (cs ? parseFloat(cs.paddingLeft) || 0 : 0);
        while (cnt > 0 && rectAt(cnt).left > start + 0.5) cnt--;
      }
      if (cnt) {
        var top = newestFirst(cfg);
        var victims = [], notices = false;
        for (var i = 0; i < cnt; i++) {
          victims.push(top ? kids[n - 1 - i] : kids[i]);
          var vr = recs.get(victims[i]);
          if (vr && vr.kind === 'notice') notices = true;
        }
        // Measured just now, nothing changed since: removeLines' one measurement costs no layout.
        removeLines(victims);
        // A resub's text line whose notice line went off the edge before it shows the time itself now (timestamps; see
        // noticeDrawn), as when a filter sweeps the notice.
        if (notices && cfg.timestamps !== 'off') rerender(function (m) { return m.noticeId !== undefined; });
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
      var list = children(), notices = false, out = [];
      for (var i = 0; i < list.length; i++) {
        var rec = recs.get(list[i]);
        // Each line by its own message: a resub's text line is a chat message (see buildGroup).
        if (rec && !showable(rec.msg)) {
          if (rec.kind === 'notice') notices = true;
          out.push(list[i]);
        }
      }
      removeLines(out);
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
      // A slide (a row's, or a column's with smooth_scroll) whose time ran out while nothing was drawn would only start
      // once frames resume, sweeping lines that are long in place across the source: it is over, so they go home now. One
      // still inside its SLIDE_MS plays on.
      if (slideDx > 0 && Date.now() - slideAt >= SLIDE_MS) stopGlide();
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
      cl.toggle('name-line', c.name_line); // the stylesheet applies it with names shown, in either layout
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
      // row_align and row_grow are for a row too (right, the default, and row_grow=0 add nothing).
      cl.toggle('row-left', c.row_align === 'left');
      cl.toggle('row-center', c.row_align === 'center');
      cl.toggle('row-grow', c.row_grow === true);
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
      setVar(st, '--gif-maxw', c.gif_size === '1x' ? GIF_1X_MAXW : null);
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
      rescalePaints();
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
      // block, block_words, bots and hide_commands (with its command_prefixes) decide which reply headers quote a blocked
      // user or a hidden message (deps.quoteHidden): only replies change.
      else if (changedAny(prev, cfg, REPLY_QUOTE_KEYS)) rerender(function (m) { return !!m.reply; });
      capLines();
      scheduleTrim();
    }

    // After a chat clear: what is said from now on is newer than it (clearedBefore), shown or not.
    function heardNow(id, sid, now) {
      if (clears.length) pruneClears(now);
      if (clears.length) {
        hear(id);
        if (sid !== id) hear(sid);
      }
    }

    // A message said with both Shared Chat ids: each names the other (alias).
    function noteAlias(id, sid, now) {
      if (!id || !sid || id === sid) return;
      alias.add(id, now, sid);
      alias.add(sid, now, id);
    }
    // Back after a timeout: replies to what this user says from now on keep their header, whichever id they name.
    function noteSpoke(id, sid, uid, now) {
      if (!id || !uid || !cleared.has(uid, now)) return;
      var at = ++mseq;
      spoke.add(id, now, at);
      if (sid && sid !== id) spoke.add(sid, now, at);
    }

    // ----- public API -----
    function push(msg) {
      if (destroyed || !msg || typeof msg !== 'object') return false;
      var now = Date.now();
      var id = util.idStr(msg.id), sid = util.idStr(msg.sourceId);
      heardNow(id, sid, now);
      noteAlias(id, sid, now);
      if (id) {
        if (deleted.has(id, now) || byId.has(id)) return false;
        if (queue.some(function (en) { return util.idStr(en.msg.id) === id; })) return false;
      }
      if (sid && deleted.has(sid, now)) return false;
      noteSpoke(id, sid, util.idStr(msg.userId), now);
      if (!showable(msg)) return false;
      // Live lines age from arrival (immune to clock skew); history ages from tmi-sent-ts.
      var ts = Number(msg.ts);
      var born = msg.historical && isFinite(ts) && ts > 0 ? Math.min(ts, now) : now;
      queue.push({ msg: msg, born: born });
      schedule();
      return true;
    }

    // A message that was said but is not to be shown (history older than the lines shown), noted as push notes one: a
    // clear or timeout from before it doesn't take the header off a reply quoting it.
    function note(msg) {
      if (destroyed || !msg || typeof msg !== 'object') return;
      var now = Date.now();
      var id = util.idStr(msg.id), sid = util.idStr(msg.sourceId);
      heardNow(id, sid, now);
      noteAlias(id, sid, now);
      noteSpoke(id, sid, util.idStr(msg.userId), now);
    }

    function clearUser(userId) {
      var uid = util.idStr(userId);
      if (!uid || destroyed) return;
      cleared.add(uid, Date.now(), ++mseq);
      queue.filter(function (en) { return util.idStr(en.msg.userId) !== uid; });
      var set = byUser.get(uid);
      removeLines(set ? Array.from(set) : []);
      // Other people's replies quoting this user lose the header (see replyGone).
      rerenderReplies(function (r) { return util.idStr(r.userId) === uid; });
      // A row moves right when newer lines go (no resize to trim on): in the same frame, not one later.
      dropLoneSep();
    }

    // altId: the message's other Shared Chat id, when the caller knows it (overlay.js has the message, or a robotty
    // rm-deleted line carries both). The renderer adds what it knows itself: the alias of a message pushed or noted, and
    // the ids of the line on screen. Every one counts as deleted, and every quote naming one goes.
    function clearMessage(msgId, altId) {
      var id = util.idStr(msgId);
      if (!id || destroyed) return;
      var now = Date.now();
      var ids = [id];
      var also = function (x) {
        x = util.idStr(x);
        if (x && ids.indexOf(x) < 0) ids.push(x);
      };
      also(altId);
      also(alias.get(id, now));
      var shown = recs.get(byId.get(id));
      if (shown) shown.ids.forEach(also);
      noteAlias(ids[0], ids[1], now);
      var gone = function (x) { return ids.indexOf(util.idStr(x)) >= 0; };
      ids.forEach(function (x) { deleted.add(x, now); });
      queue.filter(function (en) { return !gone(en.msg.id) && !gone(en.msg.sourceId); });
      ids.forEach(function (x) {
        removeLine(byId.get(x));
        removeLine(byId.get(x + ':m'));
      });
      rerenderReplies(function (r) { return gone(r.id); });
      dropLoneSep();
    }

    // Without pred: every line. With pred(msg): only the queued and on-screen lines it matches (a Twitch /clear
    // keeps the Kick lines of a combined chat, and a Kick clear keeps the Twitch ones). Like a deletion, the clear keeps
    // what it took out of reply headers (replyGone): the messages it took count as deleted (a copy delivered again is
    // refused too), and the clear is kept (clears) for the ones that had already left the screen.
    function clearAll(pred) {
      if (destroyed) return;
      var now = Date.now();
      if (typeof pred !== 'function') pred = null;
      pruneClears(now);
      // A newer clear of the same lines makes an older one redundant (what is from before it is from before this one).
      for (var c = clears.length - 1; c >= 0; c--) if (clears[c].pred === pred || !pred) clears.splice(c, 1);
      clears.push({ seq: ++mseq, at: now, pred: pred });
      if (clears.length > MAX_CLEARS) clears.shift();
      var forget = function (m) {
        deleted.add(util.idStr(m.id), now);
        deleted.add(util.idStr(m.sourceId), now);
      };
      var list = children(), i, rec;
      if (pred) {
        queue.filter(function (en) {
          if (!covers(pred, en.msg)) return true;
          forget(en.msg);
          return false;
        });
        var out = [];
        for (i = 0; i < list.length; i++) {
          rec = recs.get(list[i]);
          if (!rec || !covers(pred, rec.src || rec.msg)) continue;
          forget(rec.msg);
          if (rec.src) forget(rec.src);
          out.push(list[i]);
        }
        removeLines(out);
        dropLoneSep();
        return;
      }
      queue.forEach(function (en) { forget(en.msg); });
      for (i = 0; i < list.length; i++) {
        rec = recs.get(list[i]);
        if (!rec) continue;
        forget(rec.msg);
        if (rec.src) forget(rec.src);
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

    // A paint's still frame that deps.paintStaticRule didn't know yet (undefined) is known now: its rule goes in at once,
    // for the lines already drawn with the paint (the rule is a class rule, so they need no redraw).
    function stillReady(id) {
      if (destroyed || !cfg || cfg.paint_images !== 'static' || paintState.get(id) !== true) return;
      ensureStill(id);
    }

    // The queued and on-screen lines pred(msg) picks go, as lines that should never have come (the overlay found it had
    // joined the wrong Kick chatroom), not as moderation: no clear or deletion is noted, so replies keep their headers.
    function drop(pred) {
      if (destroyed || typeof pred !== 'function') return;
      queue.filter(function (en) { return !covers(pred, en.msg); });
      var list = children(), out = [];
      for (var i = 0; i < list.length; i++) {
        var rec = recs.get(list[i]);
        if (rec && covers(pred, rec.src || rec.msg)) out.push(list[i]);
      }
      removeLines(out);
      dropLoneSep();
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
      if (glideTimer) { clearTimeout(glideTimer); glideTimer = null; }
      if (decodeTimer) { clearTimeout(decodeTimer); decodeTimer = null; }
      decoding = [];
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
      note: note,
      clearUser: clearUser,
      clearMessage: clearMessage,
      clearAll: clearAll,
      drop: drop,
      stillReady: stillReady,
      rerender: rerender,
      setConfig: setConfig,
      hold: hold,
      flush: function () { flush(); },
      // Drops lines that the filters now reject (e.g. a bot list that landed after they were shown). A row moves right
      // when newer lines go (no resize to trim on): a kept mark that comes into view goes in the same frame (dropLoneSep).
      refilter: function () {
        if (destroyed) return;
        sweepFilters();
        dropLoneSep();
      },
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
    drawnText: drawnText,
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
      startsRtl: startsRtl,
      partsText: partsText,
      EMOTE_ONLY: EMOTE_ONLY,
      wantEmote: wantEmote,
      wantBadge: wantBadge,
      paintScale: paintScale,
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
      decodeText: decodeText,
      DECODE_TICK_MS: DECODE_TICK_MS,
      DECODE_MAX: DECODE_MAX,
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
