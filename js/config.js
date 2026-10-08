/* Overlay settings: one spec shared by the overlay, the builder and the README. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).config = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // Font weights, lightest first: 300, 400, 600, 700, 800 and 900 (renderer.js WEIGHTS).
  var WEIGHTS = ['light', 'regular', 'semibold', 'bold', 'heavy', 'black'];

  // type: channel | kick | room | enum | int | bool | font | list | color
  // color: a hex color stored as bare lowercase rrggbb ('' = the overlay's built-in color).
  // int lowest: 0 is off, and the smallest value that does anything else is lowest (1..lowest-1 is raised to it).
  var SPEC = {
    channel: { type: 'channel', def: '' },
    kick: { type: 'kick', def: '' },
    kick_room: { type: 'room', def: '' },
    platform_icons: { type: 'bool', def: true },
    size: { type: 'enum', values: ['small', 'medium', 'large'], def: 'medium' },
    text_px: { type: 'int', min: 0, max: 96, lowest: 8, def: 0 },
    font: { type: 'font', def: 'Inter' },
    text_weight: { type: 'enum', values: WEIGHTS.slice(), def: 'semibold' },
    text_color: { type: 'color', def: '' },
    line_height: { type: 'int', min: 100, max: 200, def: 135 },
    text_case: { type: 'enum', values: ['none', 'upper', 'lower', 'smallcaps'], def: 'none' },
    shadow: { type: 'int', min: 0, max: 3, def: 2 },
    shadow_color: { type: 'color', def: '' },
    shadow_style: { type: 'enum', values: ['filter', 'text'], def: 'filter' },
    outline: { type: 'int', min: 0, max: 3, def: 0 },
    outline_color: { type: 'color', def: '' },
    names: { type: 'bool', def: true },
    name_weight: { type: 'enum', values: WEIGHTS.slice(), def: 'heavy' },
    name_line: { type: 'bool', def: false },
    bg: { type: 'int', min: 0, max: 100, def: 0 },
    bg_color: { type: 'color', def: '' },
    accent_bar: { type: 'bool', def: false },
    bg_shape: { type: 'enum', values: ['square', 'soft', 'round', 'pill'], def: 'round' },
    bg_width: { type: 'enum', values: ['fit', 'full'], def: 'fit' },
    spacing: { type: 'enum', values: ['tight', 'normal', 'loose', 'extra'], def: 'normal' },
    layout: { type: 'enum', values: ['vertical', 'horizontal'], def: 'vertical' },
    align: { type: 'enum', values: ['bottom', 'top'], def: 'bottom' },
    text_align: { type: 'enum', values: ['left', 'center', 'right'], def: 'left' },
    line_width: { type: 'int', min: 0, max: 100, lowest: 5, def: 0 },
    pad_x: { type: 'int', min: 0, max: 200, def: 8 },
    edge_fade: { type: 'int', min: 0, max: 10, def: 0 },
    row_sep: { type: 'enum', values: ['none', 'dot', 'bar', 'diamond'], def: 'none' },
    animate: { type: 'bool', def: true },
    fade: { type: 'int', min: 0, max: 3600, def: 0 },
    max: { type: 'int', min: 1, max: 200, def: 50 },
    bots: { type: 'bool', def: false },
    hide_commands: { type: 'bool', def: false },
    block: { type: 'list', def: [] },
    events: { type: 'bool', def: true },
    notice_color: { type: 'color', def: '' },
    notice_size: { type: 'int', min: 50, max: 150, def: 85 },
    replies: { type: 'bool', def: true },
    first_msg: { type: 'bool', def: false },
    first_msg_color: { type: 'color', def: '' },
    history: { type: 'int', min: 0, max: 100, def: 5 },
    shared: { type: 'bool', def: true },
    gifs: { type: 'bool', def: true },
    gif_size: { type: 'enum', values: ['1x', '2x', '3x'], def: '3x' },
    emotes_7tv: { type: 'bool', def: true },
    emotes_bttv: { type: 'bool', def: true },
    emotes_ffz: { type: 'bool', def: true },
    emote_scale: { type: 'int', min: 50, max: 200, def: 100 },
    emote_only: { type: 'enum', values: ['normal', 'big', 'huge'], def: 'normal' },
    giant_emotes: { type: 'bool', def: true },
    badges: { type: 'bool', def: true },
    badges_twitch: { type: 'bool', def: true },
    badges_kick: { type: 'bool', def: true },
    badges_7tv: { type: 'bool', def: true },
    badges_bttv: { type: 'bool', def: true },
    badges_ffz: { type: 'bool', def: true },
    badges_ffzap: { type: 'bool', def: true },
    badges_chatterino: { type: 'bool', def: true },
    badges_homies: { type: 'bool', def: true },
    homies_lists: { type: 'enum', values: ['all', 'light'], def: 'all' },
    badge_size: { type: 'int', min: 50, max: 200, def: 100 },
    paints: { type: 'bool', def: true },
    paint_images: { type: 'enum', values: ['animated', 'static'], def: 'animated' },
    stv_lookup: { type: 'bool', def: true },
    readable: { type: 'bool', def: true },
    demo: { type: 'bool', def: false },
    debug: { type: 'bool', def: false }
  };

  var KEYS = Object.keys(SPEC);

  // Settings the overlay can apply in place (the builder sends these via postMessage). homies_lists is not one:
  // the Homies lists fill one index, which can't drop a list once it is loaded.
  var LIVE_KEYS = ['size', 'font', 'shadow', 'bg', 'layout', 'align', 'animate', 'fade', 'max', 'bots',
    'hide_commands', 'block', 'events', 'replies', 'first_msg', 'gifs', 'badges', 'badges_twitch',
    'badges_kick', 'badges_7tv', 'badges_bttv', 'badges_ffz', 'badges_ffzap', 'badges_chatterino', 'badges_homies',
    'paints', 'readable', 'shared', 'platform_icons', 'text_weight', 'text_color', 'line_height', 'text_case', 'names',
    'name_weight', 'name_line', 'bg_color', 'bg_shape', 'bg_width', 'spacing', 'notice_color', 'notice_size',
    'first_msg_color', 'shadow_color', 'shadow_style', 'outline', 'outline_color', 'accent_bar', 'paint_images',
    'text_align', 'line_width', 'pad_x', 'edge_fade', 'row_sep', 'text_px', 'badge_size', 'emote_scale', 'emote_only',
    'gif_size', 'giant_emotes'];

  // Fonts every Windows 10/11 PC has (never requested from Google Fonts, which doesn't host
  // them), in their canonical spelling.
  var SYSTEM_FONT_NAMES = ['Arial', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia',
    'Times New Roman', 'Courier New', 'Consolas', 'Comic Sans MS', 'Impact', 'system-ui',
    'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Constantia', 'Corbel', 'Gabriola',
    'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sylfaen'];
  var SYSTEM_FONTS = SYSTEM_FONT_NAMES.map(function (f) { return f.toLowerCase(); });
  // CSS generic family keywords (renderer.fontVar leaves them unquoted). Never a web font.
  var GENERIC_FONT_NAMES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
    'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];

  // Popular Google Fonts families, spelled exactly as fonts.googleapis.com expects (the family
  // name is case-sensitive there: 'roboto' is a 400 error, 'Roboto' loads). The builder offers
  // these as suggestions and canonicalFont() uses them to fix the case of typed names.
  var GOOGLE_FONTS = ['Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Nunito', 'Nunito Sans',
    'Rubik', 'Oswald', 'Raleway', 'Ubuntu', 'Quicksand', 'Fredoka', 'Comfortaa', 'Comic Neue', 'Bebas Neue',
    'Press Start 2P', 'Source Sans 3', 'Noto Sans', 'Work Sans', 'IBM Plex Sans', 'Outfit', 'Lexend', 'Baloo 2',
    'Kanit', 'Pixelify Sans', 'VT323', 'Silkscreen', 'DM Sans', 'Manrope', 'Figtree', 'Plus Jakarta Sans',
    'Space Grotesk', 'Barlow', 'Fira Sans', 'PT Sans', 'Titillium Web', 'Exo 2', 'Rajdhani', 'Teko', 'Orbitron',
    'Chakra Petch', 'Russo One', 'Righteous', 'Bungee', 'Bangers', 'Lilita One', 'Luckiest Guy', 'Permanent Marker',
    'Varela Round', 'Mulish', 'Karla', 'Josefin Sans', 'Atkinson Hyperlegible', 'Roboto Mono', 'JetBrains Mono',
    'Space Mono', 'Source Code Pro', 'Share Tech Mono', 'Merriweather', 'Playfair Display', 'Caveat', 'Pacifico',
    'Lobster', 'Dancing Script', 'Patrick Hand', 'Indie Flower', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC',
    'M PLUS Rounded 1c', 'Noto Sans TC', 'Noto Sans HK', 'Noto Serif JP', 'PT Serif', 'PT Mono', 'PT Sans Narrow',
    'EB Garamond', 'IBM Plex Mono', 'IBM Plex Serif', 'DM Serif Display', 'DM Mono', 'Amatic SC'];

  // Lowercased name -> canonical spelling. No prototype, so 'constructor' etc. never match.
  // Google families that capitalize a joining word canonicalFont() otherwise leaves lowercase
  // ('covered by your grace' must become 'Covered By Your Grace'). Spelling fixes only, not
  // offered as builder suggestions.
  var FONT_CANON_EXTRA = ['Covered By Your Grace', 'Love Ya Like A Sister', 'Black And White Picture'];
  var FONT_CANON = Object.create(null);
  GOOGLE_FONTS.concat(SYSTEM_FONT_NAMES, GENERIC_FONT_NAMES, FONT_CANON_EXTRA).forEach(function (f) { FONT_CANON[f.toLowerCase()] = f; });

  function own(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  function normalizeChannel(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    // Pasted links, with or without the scheme, incl. popout/embed chat and subscribe-page URLs.
    var t = s.replace(/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/(?:(?:popout|embed|moderator|subs)\/)?/i, '');
    var fromUrl = t !== s;
    s = t.replace(/^[@#]+/, ''); // before the split, or '#name' would become ''
    var parts = s.split(/[/?#]/);
    s = parts[0].trim().toLowerCase();
    // twitch.tv/videos/<id> and /directory/... name no channel ('videos' is a real, banned account).
    if (fromUrl && parts.length > 1 && (s === 'videos' || s === 'directory')) return '';
    return /^[a-z0-9_]{1,25}$/.test(s) ? s : '';
  }

  // A Kick channel: a name, @name or kick.com link (incl. popout chat) -> the lowercased channel slug, or ''.
  function normalizeKick(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return '';
    var s = String(v).trim();
    s = s.replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\/(?:popout\/)?/i, '').replace(/^@+/, '');
    s = s.split(/[/?#]/)[0].trim().toLowerCase();
    return /^[a-z0-9_-]{1,40}$/.test(s) ? s : '';
  }

  function normalizeLogin(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return '';
    var s = String(v || '').trim().replace(/^[@#]+/, '').toLowerCase();
    return /^[a-z0-9_]{1,25}$/.test(s) ? s : '';
  }

  function parseBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : undefined;
    var s = String(v).trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
    return undefined;
  }

  // Returns the normalized value, or undefined when invalid.
  function coerce(key, v) {
    var spec = own(SPEC, key) ? SPEC[key] : null;
    if (!spec || v === undefined || v === null) return undefined;
    // Strings, numbers and booleans only (arrays too for a list): String() on an object or symbol can throw.
    var tv = typeof v;
    if (tv !== 'string' && tv !== 'number' && tv !== 'boolean' && !(spec.type === 'list' && Array.isArray(v))) {
      return undefined;
    }
    switch (spec.type) {
      case 'channel': {
        var c = normalizeChannel(v);
        return c || undefined;
      }
      // Kick channel and chatroom id: '' is a valid value (no Kick), so an empty ?kick= clears settings.js.
      case 'kick': {
        if (tv === 'boolean') return undefined;
        if (String(v).trim() === '') return '';
        return normalizeKick(v) || undefined;
      }
      case 'room': {
        if (tv === 'boolean') return undefined;
        var r = String(v).trim();
        return r === '' || /^\d{1,12}$/.test(r) ? r : undefined;
      }
      case 'enum': {
        var e = String(v).trim().toLowerCase();
        return spec.values.indexOf(e) >= 0 ? e : undefined;
      }
      case 'int': {
        if (typeof v === 'string' && !/^\s*-?\d+\s*$/.test(v)) return undefined;
        var n = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
        if (!isFinite(n)) return undefined;
        n = Math.max(spec.min, Math.min(spec.max, n));
        // lowest: 1..lowest-1 is raised to it (a 3em line_width would wrap a column almost letter by letter, and the
        // overlay draws text_px at 8 px at least, so the URL says what is drawn).
        return spec.lowest && n > 0 && n < spec.lowest ? spec.lowest : n;
      }
      case 'bool':
        return parseBool(v);
      case 'font': {
        var f = String(v).trim().replace(/\s+/g, ' ');
        return /^[A-Za-z0-9][A-Za-z0-9 \-]{0,59}$/.test(f) ? f : undefined;
      }
      // A hex color, '#' optional, 3 or 6 digits ('F80' -> 'ff8800'). '' is valid (the built-in color), so an
      // empty ?text_color= clears settings.js and the builder's Default reaches a live preview.
      case 'color': {
        if (tv !== 'string') return undefined;
        var x = v.trim().replace(/^#/, '').toLowerCase();
        if (x === '') return '';
        if (/^[0-9a-f]{3}$/.test(x)) x = x.charAt(0) + x.charAt(0) + x.charAt(1) + x.charAt(1) + x.charAt(2) + x.charAt(2);
        return /^[0-9a-f]{6}$/.test(x) ? x : undefined;
      }
      case 'list': {
        var arr = Array.isArray(v) ? v : String(v).split(/[\s,]+/);
        var out = [], seen = Object.create(null); // linear dedupe: block lists can be long
        for (var i = 0; i < arr.length; i++) {
          var l = normalizeLogin(arr[i]);
          if (l && !seen[l]) { seen[l] = 1; out.push(l); }
        }
        return out;
      }
    }
    return undefined;
  }

  function defaults() {
    var cfg = {};
    for (var i = 0; i < KEYS.length; i++) {
      var d = SPEC[KEYS[i]].def;
      cfg[KEYS[i]] = Array.isArray(d) ? d.slice() : d;
    }
    return cfg;
  }

  // Apply a plain object of overrides (native types or strings) onto cfg. Keys are case-insensitive,
  // like URL keys ('Size' works); own keys only, and a later spelling of the same key wins.
  function applyObject(cfg, obj) {
    if (!obj || typeof obj !== 'object') return cfg;
    var ks = Object.keys(obj);
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i].toLowerCase();
      if (!own(SPEC, k)) continue;
      var v = coerce(k, obj[ks[i]]);
      if (v !== undefined) cfg[k] = v;
    }
    return cfg;
  }

  // search: URLSearchParams | string ; settings: window.TCO_SETTINGS (optional)
  // Precedence: defaults < settings.js < URL params.
  function parse(search, settings) {
    var cfg = defaults();
    applyObject(cfg, settings);
    var params = typeof search === 'string' || search === undefined || search === null
      ? new URLSearchParams(search || '')
      : search;
    var fromUrl = {};
    params.forEach(function (value, key) {
      var k = String(key).toLowerCase();
      if (own(SPEC, k)) fromUrl[k] = value; // last value wins; own keys only ('__proto__', 'constructor' aren't settings)
    });
    applyObject(cfg, fromUrl);
    // An explicit empty channel= clears a settings.js channel (an invalid non-empty one still falls back).
    if (own(fromUrl, 'channel') && String(fromUrl.channel).trim() === '') cfg.channel = '';
    return cfg;
  }

  function isDefault(key, value) {
    var d = SPEC[key].def;
    if (Array.isArray(d)) return !value || value.length === 0;
    return value === d;
  }

  // A value as the URL writes it (the builder, its preview and the home page's demo frames use this too).
  function serialize(key, value) {
    var t = SPEC[key].type;
    if (t === 'bool') return value ? '1' : '0';
    if (t === 'list') return (value || []).join(',');
    return String(value);
  }

  // Only non-default settings; channel first.
  function toParams(cfg) {
    var p = new URLSearchParams();
    if (cfg.channel) p.set('channel', cfg.channel);
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (k === 'channel') continue;
      if (cfg[k] === undefined || isDefault(k, cfg[k])) continue;
      p.set(k, serialize(k, cfg[k]));
    }
    return p;
  }

  // Non-default settings as a plain object with native types (for settings.js).
  function toObject(cfg) {
    var o = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (k === 'channel') { if (cfg.channel) o.channel = cfg.channel; continue; }
      if (cfg[k] === undefined || isDefault(k, cfg[k])) continue;
      o[k] = Array.isArray(cfg[k]) ? cfg[k].slice() : cfg[k];
    }
    return o;
  }

  // Installed Windows fonts and CSS generic keywords: nothing to fetch from Google Fonts.
  function isSystemFont(name) {
    var n = String(name || '').toLowerCase();
    return SYSTEM_FONTS.indexOf(n) >= 0 || GENERIC_FONT_NAMES.indexOf(n) >= 0;
  }

  // The spelling to request a font by. Google Fonts family names are case-sensitive, CSS font-family
  // matching isn't. A known Google or system font gets its exact spelling ('press start 2p' ->
  // 'Press Start 2P'). Any other name gets the first letter of each word capitalized ('my font' ->
  // 'My Font', 'Roboto slab' -> 'Roboto Slab'); nothing is lowercased ('ZCOOL KuaiLe' stays), and
  // joining words after the first are left as typed ('Fredericka the Great', 'Waiting for the Sunrise').
  var SMALL_WORD_RE = /^(?:a|and|by|for|of|the)$/;
  function canonicalFont(name) {
    var s = String(name === undefined || name === null ? '' : name).trim().replace(/\s+/g, ' ');
    if (!s) return s;
    var known = FONT_CANON[s.toLowerCase()];
    if (known) return known;
    var words = s.split(' ');
    for (var i = 0; i < words.length; i++) {
      if (i > 0 && SMALL_WORD_RE.test(words[i])) continue;
      words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1);
    }
    return words.join(' ');
  }

  return {
    SPEC: SPEC,
    KEYS: KEYS,
    LIVE_KEYS: LIVE_KEYS,
    SYSTEM_FONTS: SYSTEM_FONTS,
    SYSTEM_FONT_NAMES: SYSTEM_FONT_NAMES,
    GENERIC_FONT_NAMES: GENERIC_FONT_NAMES,
    GOOGLE_FONTS: GOOGLE_FONTS,
    defaults: defaults,
    parse: parse,
    applyObject: applyObject,
    coerce: coerce,
    isDefault: isDefault,
    serialize: serialize,
    toParams: toParams,
    toObject: toObject,
    normalizeChannel: normalizeChannel,
    normalizeKick: normalizeKick,
    normalizeLogin: normalizeLogin,
    parseBool: parseBool,
    isSystemFont: isSystemFont,
    canonicalFont: canonicalFont
  };
});
