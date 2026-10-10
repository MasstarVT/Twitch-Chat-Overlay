/* Overlay settings: one spec shared by the overlay, the builder and the README. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).config = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // Font weights, lightest first: 300, 400, 600, 700, 800 and 900 (renderer.js WEIGHTS).
  var WEIGHTS = ['light', 'regular', 'semibold', 'bold', 'heavy', 'black'];

  // type: channel | kick | room | mixitup | enum | int | bool | font | list | words | color | chars
  // mixitup: the id of a Mix It Up chat widget (a GUID), or the widget's link, which gives the same id (normalizeMixItUp).
  // list: Twitch/Kick logins. words: words or phrases, separated by commas or line breaks (a phrase keeps its spaces;
  // WORD_SEP).
  // chars: command prefixes, a few signs from PREFIX_CHARS written together ('!?').
  // color: a hex color stored as bare lowercase rrggbb ('' = the overlay's built-in color).
  // int lowest: 0 is off, and the smallest value that does anything else is lowest (1..lowest-1 is raised to it).
  // int scale: the value is a ratio times scale, and a number under min is the ratio itself (readable_level 4.5 is 45).
  // font empty: '' is a value too (name_font: the same font as `font`).
  var SPEC = {
    channel: { type: 'channel', def: '' },
    kick: { type: 'kick', def: '' },
    kick_room: { type: 'room', def: '' },
    mixitup: { type: 'mixitup', def: '' },
    mixitup_port: { type: 'int', min: 1024, max: 65535, def: 8111 },
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
    name_font: { type: 'font', empty: true, def: '' },
    name_color: { type: 'color', def: '' },
    name_fallback: { type: 'color', def: '' },
    name_sep: { type: 'enum', values: ['colon', 'space', 'dash', 'arrow'], def: 'colon' },
    bg: { type: 'int', min: 0, max: 100, def: 0 },
    bg_color: { type: 'color', def: '' },
    accent_bar: { type: 'bool', def: false },
    bg_shape: { type: 'enum', values: ['square', 'soft', 'round', 'pill'], def: 'round' },
    bg_width: { type: 'enum', values: ['fit', 'full'], def: 'fit' },
    spacing: { type: 'enum', values: ['tight', 'normal', 'loose', 'extra'], def: 'normal' },
    layout: { type: 'enum', values: ['vertical', 'horizontal'], def: 'vertical' },
    align: { type: 'enum', values: ['bottom', 'top'], def: 'bottom' },
    text_align: { type: 'enum', values: ['left', 'center', 'right'], def: 'left' },
    // Where a horizontal row's messages sit while they don't fill it (right: at the right end, as always).
    row_align: { type: 'enum', values: ['left', 'center', 'right'], def: 'right' },
    line_width: { type: 'int', min: 0, max: 100, lowest: 5, def: 0 },
    pad_x: { type: 'int', min: 0, max: 200, def: 8 },
    edge_fade: { type: 'int', min: 0, max: 10, def: 0 },
    row_sep: { type: 'enum', values: ['none', 'dot', 'bar', 'diamond'], def: 'none' },
    animate: { type: 'bool', def: true },
    enter_style: { type: 'enum', values: ['slide', 'fade', 'pop', 'drop', 'bounce', 'spring', 'zoom', 'flip', 'tilt', 'unfold',
      'glitch', 'scan', 'decode'], def: 'slide' },
    // No 0: animate=0 is the off switch (a 0 ms entrance would leave the fade waiting on its end).
    enter_ms: { type: 'int', min: 50, max: 1000, def: 180 },
    fade: { type: 'int', min: 0, max: 3600, def: 0 },
    fade_out_ms: { type: 'int', min: 0, max: 10000, def: 1000 },
    exit_style: { type: 'enum', values: ['fade', 'slide'], def: 'fade' },
    smooth_scroll: { type: 'bool', def: false },
    max: { type: 'int', min: 1, max: 200, def: 50 },
    bots: { type: 'bool', def: false },
    hide_commands: { type: 'bool', def: false },
    command_prefixes: { type: 'chars', def: '!' },
    block: { type: 'list', def: [] },
    block_words: { type: 'words', def: [] },
    allow_users: { type: 'list', def: [] },
    role_filter: { type: 'enum', values: ['all', 'subs', 'vips', 'mods'], def: 'all' },
    min_length: { type: 'int', min: 0, max: 100, def: 0 },
    links: { type: 'enum', values: ['show', 'shorten', 'hide'], def: 'show' },
    events: { type: 'bool', def: true },
    event_subs: { type: 'bool', def: true },
    event_gifts: { type: 'bool', def: true },
    event_raids: { type: 'bool', def: true },
    event_bits_badge: { type: 'bool', def: true },
    event_announcements: { type: 'bool', def: true },
    notice_color: { type: 'color', def: '' },
    notice_size: { type: 'int', min: 50, max: 150, def: 85 },
    replies: { type: 'bool', def: true },
    reply_style: { type: 'enum', values: ['full', 'name'], def: 'full' },
    first_msg: { type: 'bool', def: false },
    first_msg_color: { type: 'color', def: '' },
    history: { type: 'int', min: 0, max: 100, def: 5 },
    shared: { type: 'bool', def: true },
    timestamps: { type: 'enum', values: ['off', '12h', '24h'], def: 'off' },
    mentions: { type: 'enum', values: ['off', 'at', 'name'], def: 'off' },
    mention_color: { type: 'color', def: '' },
    keywords: { type: 'words', def: [] },
    highlight_users: { type: 'list', def: [] },
    keyword_color: { type: 'color', def: '' },
    points_highlight: { type: 'bool', def: true },
    points_color: { type: 'color', def: '' },
    role_style: { type: 'enum', values: ['off', 'bar', 'tint'], def: 'off' },
    broadcaster_color: { type: 'color', def: '' },
    mod_color: { type: 'color', def: '' },
    vip_color: { type: 'color', def: '' },
    gifs: { type: 'bool', def: true },
    gif_size: { type: 'enum', values: ['1x', '2x', '3x'], def: '3x' },
    emotes_7tv: { type: 'bool', def: true },
    emotes_bttv: { type: 'bool', def: true },
    emotes_ffz: { type: 'bool', def: true },
    emote_scale: { type: 'int', min: 50, max: 200, def: 100 },
    emote_only: { type: 'enum', values: ['normal', 'big', 'huge'], def: 'normal' },
    // A horizontal row draws emote_only, gif_size and gigantified emotes at their column sizes, and grows to fit them.
    row_grow: { type: 'bool', def: false },
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
    // The contrast readable lightens dark names to, times 10 (45 = 4.5:1, util.readableColor's own target).
    readable_level: { type: 'int', min: 30, max: 70, def: 45, scale: 10 },
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
    'gif_size', 'giant_emotes', 'name_font', 'name_color', 'name_fallback', 'name_sep', 'readable_level', 'timestamps',
    'reply_style', 'mentions', 'mention_color', 'keywords', 'highlight_users', 'keyword_color', 'points_highlight',
    'points_color', 'role_style', 'broadcaster_color', 'mod_color', 'vip_color', 'event_subs', 'event_gifts', 'event_raids',
    'event_bits_badge', 'event_announcements', 'role_filter', 'allow_users', 'block_words', 'min_length', 'links',
    'command_prefixes', 'enter_style', 'enter_ms', 'fade_out_ms', 'exit_style', 'smooth_scroll', 'row_align', 'row_grow'];

  // words: at most this many phrases, each at most this many characters (a longer one is left out).
  var MAX_WORDS = 50, MAX_WORD_LEN = 40;
  // The commas that separate the items of a words or list value: ',' and the ones a Chinese, Japanese or Korean input
  // method types for the comma key (fullwidth U+FF0C, ideographic U+3001, and their halfwidth and small forms), the
  // Arabic, Persian and Urdu comma (U+060C), and the Armenian, NKo, Ethiopic and Mongolian commas. Without them a list
  // typed with a Japanese IME ('kusa<U+3001>www') would be one phrase that no message ever matches.
  var SEP_CHARS = ',\uff0c\u3001\uff64\ufe50\ufe51\u060c\u055d\u07f8\u1363\u1802\u1808';
  // words: a line break separates phrases too, so a list written one phrase a line (a settings.js string, a pasted
  // list) is never one long phrase. Never part of a stored phrase, so the value reads back the same from the URL.
  var WORD_SEP = new RegExp('[' + SEP_CHARS + '\\r\\n]');
  // list: logins, separated by commas or spaces.
  var LIST_SEP = new RegExp('[\\s' + SEP_CHARS + ']+');
  // chars: the signs a command may start with, and how many of them one value holds at most.
  var PREFIX_CHARS = '!$%&*+-./:;=?@#~^', MAX_PREFIXES = 8;

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

  // Every Google Fonts family canonicalFont() would otherwise misspell, typed in lower case or in Title Case: a word
  // in capitals or with a capital inside it ('k2d' must become 'K2D', 'mclaren' 'McLaren', 'dm serif text' 'DM Serif
  // Text': fonts.googleapis.com refuses 'K2d', 'Mclaren' and 'Dm Serif Text'), a joining word it would leave lowercase
  // ('covered by your grace' -> 'Covered By Your Grace'), or one Google keeps lowercase ('Fredericka The Great' ->
  // 'Fredericka the Great'). Spelling fixes only, not offered as builder suggestions. Generated from Google's family
  // list (fonts.google.com/metadata/fonts, October 2026): each family not in GOOGLE_FONTS whose name, lowercased or
  // Title Cased, canonicalFont's word-by-word rule (below) doesn't spell back. A family Google adds later may need
  // adding by hand; the builder warns when a font doesn't load.
  var FONT_CANON_EXTRA = [
    'ABeeZee', 'Abyssinica SIL', 'ADLaM Display', 'Alegreya Sans SC', 'Alegreya SC', 'Almendra SC', 'Alumni Sans SC',
    'Annapurna SIL', 'Anton SC', 'AR One Sans', 'Arsenal SC', 'Baskervville SC', 'BBH Bartle', 'BBH Bogle',
    'BBH Hegarty', 'BenchNine', 'Betania Patmos GDL', 'Betania Patmos In GDL', 'BhuTuka Expanded One', 'BioRhyme',
    'BioRhyme Expanded', 'BIZ UDGothic', 'BIZ UDMincho', 'BIZ UDPGothic', 'BIZ UDPMincho', 'BJCree',
    'Black And White Picture', 'Bodoni Moda SC', 'Bona Nova SC', 'Bowlby One SC', 'Bruno Ace SC', 'Carrois Gothic SC',
    'Charis SIL', 'Chiron GoRound TC', 'Chiron Hei HK', 'Chiron Sung HK', 'Cormorant SC', 'Covered By Your Grace',
    'Dai Banna SIL', 'Dawning of a New Day', 'Diplomata SC', 'DM Serif Text', 'DotGothic16', 'DynaPuff',
    'Edu AU VIC WA NT Arrows', 'Edu AU VIC WA NT Dots', 'Edu AU VIC WA NT Guides', 'Edu AU VIC WA NT Hand',
    'Edu AU VIC WA NT Pre', 'Edu NSW ACT Cursive', 'Edu NSW ACT Foundation', 'Edu NSW ACT Hand Pre',
    'Edu QLD Beginner', 'Edu QLD Hand', 'Edu SA Beginner', 'Edu SA Hand', 'Edu TAS Beginner',
    'Edu VIC WA NT Beginner', 'Edu VIC WA NT Hand', 'Edu VIC WA NT Hand Pre', 'Encode Sans SC',
    'Fredericka the Great', 'GFS Didot', 'GFS Neohellenic', 'Holtwood One SC', 'IBM Plex Sans Arabic',
    'IBM Plex Sans Condensed', 'IBM Plex Sans Devanagari', 'IBM Plex Sans Hebrew', 'IBM Plex Sans JP',
    'IBM Plex Sans KR', 'IBM Plex Sans Thai', 'IBM Plex Sans Thai Looped', 'IM Fell Double Pica',
    'IM Fell Double Pica SC', 'IM Fell DW Pica', 'IM Fell DW Pica SC', 'IM Fell English', 'IM Fell English SC',
    'IM Fell French Canon', 'IM Fell French Canon SC', 'IM Fell Great Primer', 'IM Fell Great Primer SC', 'K2D',
    'Kaisei HarunoUmi', 'KoHo', 'Libre Barcode EAN13 Text', 'LINE Seed JP', 'Love Ya Like A Sister',
    'Loved by the King', 'LXGW Marker Gothic', 'LXGW WenKai Mono TC', 'LXGW WenKai TC', 'M PLUS 1', 'M PLUS 1 Code',
    'M PLUS 1p', 'M PLUS 2', 'M PLUS Code Latin', 'M PLUS U', 'Marcellus SC', 'Mate SC', 'McLaren', 'MedievalSharp',
    'MonteCarlo', 'Mountains of Christmas', 'MuseoModerno', 'Noto Sans Linear A', 'Noto Sans NKo',
    'Noto Sans NKo Unjoined', 'Noto Sans PhagsPa', 'Noto Sans SignWriting', 'Noto Serif HK', 'Noto Serif KR',
    'Noto Serif NP Hmong', 'Noto Serif SC', 'Noto Serif TC', 'NTR', 'Nuosu SIL', 'Old Standard TT',
    'Over the Rainbow', 'Overlock SC', 'Patrick Hand SC', 'Playfair Display SC', 'Playwrite AR',
    'Playwrite AR Guides', 'Playwrite AT', 'Playwrite AT Guides', 'Playwrite AU NSW', 'Playwrite AU NSW Guides',
    'Playwrite AU QLD', 'Playwrite AU QLD Guides', 'Playwrite AU SA', 'Playwrite AU SA Guides', 'Playwrite AU TAS',
    'Playwrite AU TAS Guides', 'Playwrite AU VIC', 'Playwrite AU VIC Guides', 'Playwrite BE VLG',
    'Playwrite BE VLG Guides', 'Playwrite BE WAL', 'Playwrite BE WAL Guides', 'Playwrite BR', 'Playwrite BR Guides',
    'Playwrite CA', 'Playwrite CA Guides', 'Playwrite CL', 'Playwrite CL Guides', 'Playwrite CO',
    'Playwrite CO Guides', 'Playwrite CU', 'Playwrite CU Guides', 'Playwrite CZ', 'Playwrite CZ Guides',
    'Playwrite DE Grund', 'Playwrite DE Grund Guides', 'Playwrite DE LA', 'Playwrite DE LA Guides',
    'Playwrite DE SAS', 'Playwrite DE SAS Guides', 'Playwrite DE VA', 'Playwrite DE VA Guides', 'Playwrite DK Loopet',
    'Playwrite DK Loopet Guides', 'Playwrite DK Uloopet', 'Playwrite DK Uloopet Guides', 'Playwrite ES',
    'Playwrite ES Deco', 'Playwrite ES Deco Guides', 'Playwrite ES Guides', 'Playwrite FR Moderne',
    'Playwrite FR Moderne Guides', 'Playwrite FR Trad', 'Playwrite FR Trad Guides', 'Playwrite GB J',
    'Playwrite GB J Guides', 'Playwrite GB S', 'Playwrite GB S Guides', 'Playwrite HR', 'Playwrite HR Guides',
    'Playwrite HR Lijeva', 'Playwrite HR Lijeva Guides', 'Playwrite HU', 'Playwrite HU Guides', 'Playwrite ID',
    'Playwrite ID Guides', 'Playwrite IE', 'Playwrite IE Guides', 'Playwrite IN', 'Playwrite IN Guides',
    'Playwrite IS', 'Playwrite IS Guides', 'Playwrite IT Moderna', 'Playwrite IT Moderna Guides', 'Playwrite IT Trad',
    'Playwrite IT Trad Guides', 'Playwrite MX', 'Playwrite MX Guides', 'Playwrite NG Modern',
    'Playwrite NG Modern Guides', 'Playwrite NL', 'Playwrite NL Guides', 'Playwrite NO', 'Playwrite NO Guides',
    'Playwrite NZ', 'Playwrite NZ Basic', 'Playwrite NZ Basic Guides', 'Playwrite NZ Guides', 'Playwrite PE',
    'Playwrite PE Guides', 'Playwrite PL', 'Playwrite PL Guides', 'Playwrite PT', 'Playwrite PT Guides',
    'Playwrite RO', 'Playwrite RO Guides', 'Playwrite SK', 'Playwrite SK Guides', 'Playwrite TZ',
    'Playwrite TZ Guides', 'Playwrite US Modern', 'Playwrite US Modern Guides', 'Playwrite US Trad',
    'Playwrite US Trad Guides', 'Playwrite VN', 'Playwrite VN Guides', 'Playwrite ZA', 'Playwrite ZA Guides',
    'PT Sans Caption', 'PT Serif Caption', 'REM', 'Rock 3D', 'RocknRoll One', 'Sedan SC', 'SN Pro', 'Spectral SC',
    'STIX Two Math', 'STIX Two Text', 'SUSE', 'SUSE Mono', 'Swanky and Moo Moo', 'TASA Explorer', 'TASA Orbiter',
    'TikTok Sans', 'UnifrakturCook', 'UnifrakturMaguntia', 'UoqMunThenKhung', 'Vollkorn SC',
    'Waiting for the Sunrise', 'WDXL Lubrifont JP N', 'WDXL Lubrifont SC', 'WDXL Lubrifont TC', 'WindSong',
    'Ysabeau SC', 'Zalando Sans SemiExpanded', 'ZCOOL KuaiLe', 'ZCOOL QingKe HuangYou', 'ZCOOL XiaoWei'];
  // Lowercased name -> canonical spelling. No prototype, so 'constructor' etc. never match.
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

  // A Mix It Up chat widget: its GUID, or the link Mix It Up gives it (http://localhost:8111/overlay/<guid>, or the
  // ws://localhost:8111/ws/<guid>/ address behind it) -> { guid (lowercase), port (a link's own, else 8111), link }, or null.
  // The host must be exactly localhost or 127.0.0.1 and the port plain digits, so nothing but this PC is ever contacted.
  // The all-zero GUID is Mix It Up's shared default endpoint: it carries every widget's traffic, so it is not accepted.
  var MIXITUP_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // The same links mixitup.js parseLink takes (a test keeps the two equal): the page link on http(s) with /overlay/, the
  // socket address on ws(s) with /ws/, and a bare GUID, in braces or not.
  var MIXITUP_LINK_RE = /^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?\/overlay\/([^/?#\s]*)\/?(?:[?#]\S*)?|wss?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?\/ws\/([^/?#\s]*)\/?)$/i;
  function parseMixItUp(v) {
    if (typeof v !== 'string' || v.length > 2048) return null;
    var s = v.trim(), port = 0, guid = s;
    var m = MIXITUP_LINK_RE.exec(s);
    if (m) {
      guid = m[2] !== undefined ? m[2] : m[4];
      var p = m[1] !== undefined ? m[1] : m[3];
      if (p !== undefined) {
        port = parseInt(p, 10);
        if (!(port >= 1024 && port <= 65535)) return null;
      }
    } else {
      guid = guid.replace(/^\{([^{}]*)\}$/, '$1');
    }
    guid = guid.toLowerCase();
    if (!MIXITUP_GUID_RE.test(guid) || /^[0-]+$/.test(guid)) return null;
    return { guid: guid, port: port || 8111, link: !!m };
  }
  function normalizeMixItUp(v) {
    var p = parseMixItUp(typeof v === 'number' ? '' : v);
    return p ? p.guid : '';
  }

  // A login in a list of names (block, allow_users, highlight_users) -> lowercased, or ''. Kick spells a username's
  // underscores as hyphens in its slug and in kick.com/<slug> links, and Kick chat is matched by the username
  // (kick.loginOf), so '-' is read as '_' (no Twitch login has '-'). A pasted twitch.tv or kick.com link gives its name.
  function normalizeLogin(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return '';
    var s = String(v || '').trim();
    if (/^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\//i.test(s)) return normalizeChannel(s);
    var k = s.replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\/(?:popout\/)?/i, '');
    if (k !== s) s = k.split(/[/?#]/)[0];
    s = s.replace(/^[@#]+/, '').toLowerCase().replace(/-/g, '_');
    // A '.' too: YouTube handles have them (no Twitch or Kick login does, so nothing else changes), and up to 30 characters.
    return /^[a-z0-9_.]{1,30}$/.test(s) ? s : '';
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
    // Strings, numbers and booleans only (arrays too for a list, words or chars): String() on an object or symbol can throw.
    var tv = typeof v;
    var many = spec.type === 'list' || spec.type === 'words' || spec.type === 'chars';
    if (tv !== 'string' && tv !== 'number' && tv !== 'boolean' && !(many && Array.isArray(v))) return undefined;
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
      // Mix It Up widget id: '' is a valid value (no YouTube chat), so an empty ?mixitup= clears settings.js.
      case 'mixitup': {
        if (tv !== 'string') return undefined;
        if (v.trim() === '') return '';
        return normalizeMixItUp(v) || undefined;
      }
      case 'enum': {
        var e = String(v).trim().toLowerCase();
        return spec.values.indexOf(e) >= 0 ? e : undefined;
      }
      case 'int': {
        // scale: a decimal is a value too, so 4.5 (in settings.js) and '4.5' (in a URL) are readable_level 45.
        if (typeof v === 'string' && !(spec.scale ? /^\s*-?\d+(?:\.\d+)?\s*$/ : /^\s*-?\d+\s*$/).test(v)) return undefined;
        var n = typeof v === 'number' || (spec.scale && typeof v === 'string') ? Number(v) : parseInt(v, 10);
        if (!isFinite(n)) return undefined;
        if (spec.scale && n < spec.min) n *= spec.scale;
        n = Math.round(n);
        n = Math.max(spec.min, Math.min(spec.max, n));
        // lowest: 1..lowest-1 is raised to it (a 3em line_width would wrap a column almost letter by letter, and the
        // overlay draws text_px at 8 px at least, so the URL says what is drawn).
        return spec.lowest && n > 0 && n < spec.lowest ? spec.lowest : n;
      }
      case 'bool':
        return parseBool(v);
      case 'font': {
        var f = String(v).trim().replace(/\s+/g, ' ');
        // empty: '' is valid (name_font's "same as font"), so an empty ?name_font= clears settings.js and the
        // builder's cleared field reaches a live preview.
        if (f === '' && spec.empty && tv === 'string') return '';
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
      // Logins separated by commas or spaces, in a string or in each item of an array (settings.js: ['nightbot, moobot']
      // is two names, as the string is). true or false is no list of names.
      case 'list': {
        if (tv === 'boolean') return undefined;
        var src = Array.isArray(v) ? v : [v], arr = [];
        for (var k = 0; k < src.length; k++) {
          if (typeof src[k] !== 'string' && typeof src[k] !== 'number') continue;
          var names = String(src[k]).split(LIST_SEP);
          for (var b = 0; b < names.length; b++) arr.push(names[b]);
        }
        var out = [], seen = Object.create(null); // linear dedupe: block lists can be long
        for (var i = 0; i < arr.length; i++) {
          var l = normalizeLogin(arr[i]);
          if (l && !seen[l]) { seen[l] = 1; out.push(l); }
        }
        return out;
      }
      // Words or phrases, separated by commas ('good game, gg') or line breaks, so a phrase keeps its spaces (runs of
      // them, and other control characters, become one space). Stored lowercased (the overlay matches any letter case)
      // and deduped. A phrase over MAX_WORD_LEN characters is left out, and so is every phrase after the first
      // MAX_WORDS. An array item may hold commas too (settings.js), so the value always reads back the same from the URL.
      case 'words': {
        if (tv === 'boolean') return undefined;
        var items = Array.isArray(v) ? v : [v];
        var words = [], had = Object.create(null);
        for (var j = 0; j < items.length && words.length < MAX_WORDS; j++) {
          if (typeof items[j] !== 'string' && typeof items[j] !== 'number') continue;
          var parts = String(items[j]).split(WORD_SEP);
          for (var p = 0; p < parts.length && words.length < MAX_WORDS; p++) {
            var w = parts[p].replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().toLowerCase();
            if (w && Array.from(w).length <= MAX_WORD_LEN && !had[w]) { had[w] = 1; words.push(w); }
          }
        }
        return words;
      }
      // Command prefixes ('!?'): signs from PREFIX_CHARS only, each once, in the order typed; spaces are left out
      // ('! ?' is '!?'). Any other character, none at all, or more than MAX_PREFIXES make the value invalid, so the
      // default '!' (or settings.js) stays. settings.js may give them as an array, as it gives block and keywords
      // (['!', '?'] is '!?'); an item that isn't a string is skipped, as in a list.
      case 'chars': {
        if (tv === 'boolean') return undefined;
        var cs = (Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }).join('') : String(v))
          .replace(/\s+/g, ''), pre = '';
        for (var ci = 0; ci < cs.length; ci++) {
          var ch = cs.charAt(ci);
          if (PREFIX_CHARS.indexOf(ch) < 0) return undefined;
          if (pre.indexOf(ch) < 0) pre += ch;
        }
        return pre && pre.length <= MAX_PREFIXES ? pre : undefined;
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

  // The settings a query names: keys lowercased, the last value wins, own keys only ('__proto__', 'constructor' aren't
  // settings).
  function urlValues(search) {
    var params = typeof search === 'string' || search === undefined || search === null
      ? new URLSearchParams(search || '')
      : search;
    var fromUrl = {};
    params.forEach(function (value, key) {
      var k = String(key).toLowerCase();
      if (own(SPEC, k)) fromUrl[k] = value;
    });
    return fromUrl;
  }

  // A hand-written URL's query with a '#' in it read back as part of a value. search: the part between '?' and the first
  // '#'; hash: the part after that '#' (null when there is none). A '#' typed in a value (text_color=#ff8800, keywords=c#,
  // channel=#xqc) starts the URL's fragment, which cut that value and every setting after it. overlay.html uses no
  // fragment, so it goes back on as '%23' + itself; only where that spoils the value the '#' cut (a real fragment after a
  // whole value, as in 'bots=1#top') is that value kept as it was before the '#'. A list of names is spoiled when it
  // loses a name it had before the '#' ('block=nightbot#top'): a name may only lead with a '#', so one after a name is
  // the fragment's (coerce leaves 'nightbot#top' out of the list rather than refusing it). Returns the query, without
  // the '?'.
  function withHash(search, hash) {
    var q = String(search || '').replace(/^\?/, '');
    if (hash === null || hash === undefined) return q;
    var before = [], joined = [];
    new URLSearchParams(q).forEach(function (v, k) { before.push([k, v]); });
    new URLSearchParams(q + '%23' + String(hash).replace(/^#/, '')).forEach(function (v, k) { joined.push([k, v]); });
    var i = before.length - 1, cut = joined[i];
    if (i >= 0 && cut && cut[0] === before[i][0] && cut[1] !== before[i][1]) {
      var k = String(cut[0]).toLowerCase();
      if (own(SPEC, k)) {
        var nv = coerce(k, cut[1]);
        if (nv === undefined) cut[1] = before[i][1];
        else if (SPEC[k].type === 'list') {
          var had = coerce(k, before[i][1]) || [];
          for (var h = 0; h < had.length; h++) {
            if (nv.indexOf(had[h]) < 0) { cut[1] = before[i][1]; break; }
          }
        }
      }
    }
    var out = new URLSearchParams();
    for (var j = 0; j < joined.length; j++) out.append(joined[j][0], joined[j][1]);
    return out.toString();
  }

  // A page's query (loc: its location), a '#' typed in a value and what follows it included (withHash): read from the
  // whole href, where a URL ending in '#' still shows it. The overlay reads its own URL so, and the builder its start-up
  // link. Without a '?' before the first '#', location.search as it is.
  function pageQuery(loc) {
    if (!loc) return '';
    var href = typeof loc.href === 'string' ? loc.href : '', q = href.indexOf('?'), f = href.indexOf('#');
    if (q < 0 || (f >= 0 && f < q)) return loc.search || '';
    return withHash(f < 0 ? href.slice(q) : href.slice(q, f), f < 0 ? null : href.slice(f + 1));
  }

  // A settings.js value by its key, which is not case-sensitive (the last spelling wins, as applyObject's does), or undefined.
  function settingOf(settings, key) {
    var v;
    if (settings && typeof settings === 'object') Object.keys(settings).forEach(function (sk) { if (sk.toLowerCase() === key) v = settings[sk]; });
    return v;
  }

  // The Twitch channel, Kick channel and Mix It Up widget the URL or settings.js named with a value coerce refuses ('xqc!', 'my channel'):
  // { channel, kick, mixitup }, each null or { value (as written, trimmed), from: 'url' | 'settings' }. A URL key is read as parse
  // reads it; a settings.js one only when the URL doesn't give that key, as parse lets the URL's win.
  function refusedChannels(search, settings) {
    var fromUrl = urlValues(search), out = { channel: null, kick: null, mixitup: null };
    ['channel', 'kick', 'mixitup'].forEach(function (key) {
      var v, from = 'url';
      if (own(fromUrl, key)) v = fromUrl[key];
      else if (settings && typeof settings === 'object') {
        from = 'settings';
        v = settingOf(settings, key);
      }
      if ((typeof v !== 'string' && typeof v !== 'number') || String(v).trim() === '' || coerce(key, v) !== undefined) return;
      out[key] = { value: String(v).trim(), from: from };
    });
    return out;
  }

  // search: URLSearchParams | string ; settings: window.TCO_SETTINGS (optional)
  // Precedence: defaults < settings.js < URL params.
  function parse(search, settings) {
    var cfg = defaults();
    applyObject(cfg, settings);
    var setKick = cfg.kick;
    var fromUrl = urlValues(search);
    applyObject(cfg, fromUrl);
    // An explicit empty channel= clears a settings.js channel (an invalid non-empty one still falls back).
    if (own(fromUrl, 'channel') && String(fromUrl.channel).trim() === '') cfg.channel = '';
    // A settings.js chatroom id is its Kick channel's: a URL that names another Kick channel and gives no valid id of its
    // own leaves it out, so the overlay looks the new channel up instead of joining the old one's chat (builder.startCfg
    // does the same with its remembered config). An id set in settings.js without a channel stays.
    if (setKick && cfg.kick !== setKick && (!own(fromUrl, 'kick_room') || coerce('kick_room', fromUrl.kick_room) === undefined)) {
      cfg.kick_room = '';
    }
    // A Mix It Up link written with its own port (http://localhost:8112/overlay/<guid>) sets mixitup_port, unless a
    // mixitup_port is given at the same level (both in the URL, or both in settings.js). As everywhere, the URL wins: a link
    // in the URL beats a mixitup_port in settings.js, and a mixitup_port in the URL beats any link.
    var urlLink = coerce('mixitup', fromUrl.mixitup) ? fromUrl.mixitup : undefined;
    var linkText = urlLink !== undefined ? urlLink : settingOf(settings, 'mixitup');
    var link = cfg.mixitup && typeof linkText === 'string' ? parseMixItUp(linkText) : null;
    var portGiven = coerce('mixitup_port', fromUrl.mixitup_port) !== undefined ||
      (urlLink === undefined && coerce('mixitup_port', settingOf(settings, 'mixitup_port')) !== undefined);
    if (link && link.link && link.guid === cfg.mixitup && !portGiven) cfg.mixitup_port = link.port;
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
    if (t === 'list' || t === 'words') return (value || []).join(',');
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

  // A name spelled exactly as one canonicalFont knows: a listed Google font (GOOGLE_FONTS, FONT_CANON_EXTRA), a stock
  // Windows font or a generic name. Any other name is only a guess at Google's spelling (the builder checks it).
  function isKnownFont(name) {
    return typeof name === 'string' && FONT_CANON[name.toLowerCase()] === name;
  }

  // The weights the overlay asks Google Fonts for a font in (css2's ':wght@' list), which the builder's font check asks
  // for too: Google refuses a request that names none of a family's weights. The four the overlay draws by default, plus
  // Light (300) and Black (900) only while text_weight or name_weight uses one, so the usual request (and the font a
  // browser has cached for it) never changes.
  function fontWeights(cfg) {
    var w = [400, 600, 700, 800], c = cfg || {};
    if (c.text_weight === 'light' || c.name_weight === 'light') w.unshift(300);
    if (c.text_weight === 'black' || c.name_weight === 'black') w.push(900);
    return w.join(';');
  }

  return {
    SPEC: SPEC,
    KEYS: KEYS,
    LIVE_KEYS: LIVE_KEYS,
    SYSTEM_FONTS: SYSTEM_FONTS,
    SYSTEM_FONT_NAMES: SYSTEM_FONT_NAMES,
    GENERIC_FONT_NAMES: GENERIC_FONT_NAMES,
    GOOGLE_FONTS: GOOGLE_FONTS,
    FONT_CANON_EXTRA: FONT_CANON_EXTRA,
    PREFIX_CHARS: PREFIX_CHARS,
    MAX_PREFIXES: MAX_PREFIXES,
    WORD_SEP: WORD_SEP,
    defaults: defaults,
    parse: parse,
    withHash: withHash,
    pageQuery: pageQuery,
    refusedChannels: refusedChannels,
    applyObject: applyObject,
    coerce: coerce,
    isDefault: isDefault,
    serialize: serialize,
    toParams: toParams,
    toObject: toObject,
    normalizeChannel: normalizeChannel,
    normalizeKick: normalizeKick,
    parseMixItUp: parseMixItUp,
    normalizeMixItUp: normalizeMixItUp,
    normalizeLogin: normalizeLogin,
    parseBool: parseBool,
    isSystemFont: isSystemFont,
    isKnownFont: isKnownFont,
    canonicalFont: canonicalFont,
    fontWeights: fontWeights
  };
});
