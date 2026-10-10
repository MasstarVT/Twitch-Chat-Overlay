/* Config builder: form generated from config.SPEC, live preview iframe, overlay URL and settings.js output. */
(function (root, factory) {
  var util = typeof require === 'function' ? require('./util.js') : root.TCO.util;
  var config = typeof require === 'function' ? require('./config.js') : root.TCO.config;
  var kick = typeof require === 'function' ? require('./kick.js') : root.TCO.kick;
  var mixitup = typeof require === 'function' ? require('./mixitup.js') : root.TCO.mixitup;
  var api = factory(root, util, config, kick, mixitup);
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).builder = api;
  if (typeof document !== 'undefined' && document.getElementById && !root.TCO_NO_AUTOBOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.start(); });
    else api.start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root, util, config, kick, mixitup) {
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
  var RAIL_FADE = 24; // px: the faded edge of the rail's tabs where they scroll (css/builder.css .tab-groups.more-below)
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
  function shadowOn(cfg) { return cfg.shadow > 0; }
  function outlineOn(cfg) { return cfg.outline > 0; }
  function paintsOn(cfg) { return !!cfg.paints; }
  function homiesOn(cfg) { return !!(cfg.badges && cfg.badges_homies); }
  // 7TV is asked about chatters (stv_lookup) only for what the overlay draws of theirs: their paints, or their 7TV
  // badges. overlay.js stvStyleOn without its stv_lookup term: keep the two the same.
  function stvCosmeticsOn(cfg) { return !!(cfg.paints || (cfg.badges && cfg.badges_7tv)); }
  function gifsOn(cfg) { return !!cfg.gifs; }
  function repliesOn(cfg) { return !!cfg.replies; }
  function readableOn(cfg) { return !!cfg.readable; }
  // The color for names without one, and how far dark names are lightened, are moot while one Name color is set
  // for everyone.
  function ownNameColors(cfg) { return !cfg.name_color; }
  function readableOwn(cfg) { return readableOn(cfg) && ownNameColors(cfg); }
  // What follows the name: hidden under a name on its own line, in either layout (overlay.css hides .colon there).
  function sepShown(cfg) { return namesOn(cfg) && !cfg.name_line; }
  // emote_only, gif_size and giant_emotes: a column draws them, and a row only with row_grow (else at emote height).
  function bigDrawn(cfg) { return cfg.layout !== 'horizontal' || !!cfg.row_grow; }
  function gifSizeOn(cfg) { return gifsOn(cfg) && bigDrawn(cfg); }
  // Text size applies until Exact text size (text_px) takes over.
  function sizeOn(cfg) { return !(cfg.text_px > 0); }
  // The chats the overlay shows: a Twitch channel, a Kick channel and YouTube (a Mix It Up widget), each one counted
  // once it is set. Any of them is enough (chatOn: what the "no channel" checks ask). Every value here is a valid one:
  // a refused name or widget is never committed.
  function chatCount(cfg) { return (cfg.channel ? 1 : 0) + (cfg.kick ? 1 : 0) + (cfg.mixitup ? 1 : 0); }
  function chatOn(cfg) { return chatCount(cfg) > 0; }
  // The platform icons need two or more of them (overlay.js showPlatforms), and a mention a channel to name (renderer.js
  // buildMatchers, demo.js mentioned): a Twitch or Kick name, as YouTube's widget names no one.
  function twoOn(cfg) { return chatCount(cfg) >= 2; }
  function channelOn(cfg) { return !!(cfg.channel || cfg.kick); }
  // The highlight colors: each only while what it colors is on.
  function mentionsOn(cfg) { return !!cfg.mentions && cfg.mentions !== 'off'; }
  function mentionColorOn(cfg) { return mentionsOn(cfg) && channelOn(cfg); }
  function wordsOrUsersOn(cfg) {
    return !!((cfg.keywords && cfg.keywords.length) || (cfg.highlight_users && cfg.highlight_users.length));
  }
  function pointsOn(cfg) { return !!cfg.points_highlight; }
  function rolesOn(cfg) { return !!cfg.role_style && cfg.role_style !== 'off'; }
  function commandsOn(cfg) { return !!cfg.hide_commands; }
  // The entrance needs animate; the fade-out and the exit need fade (Messages), and are independent of animate. The
  // exit also needs a fade-out to run in (an Instant one moves nothing).
  function animateOn(cfg) { return !!cfg.animate; }
  function fadeOn(cfg) { return cfg.fade > 0; }
  function fadeOutOn(cfg) { return cfg.fade > 0 && cfg.fade_out_ms > 0; }

  // Each Text size in px (renderer.js FONT_PX): where Exact text size starts from Auto (META.from0).
  var TEXT_PX = { small: 18, medium: 24, large: 32 };
  function textPxFrom0(cfg) { return TEXT_PX[cfg && cfg.size] || TEXT_PX.medium; }

  // enter_style: each entrance's keyframes in a column and in a row, as js/renderer.js ENTER (tests hold them equal).
  // css/builder.css has a copy of each, so the Entrance list plays them on its own words.
  var ENTER_FRAMES = { slide: ['tco-in', 'tco-in-x'], fade: ['tco-in-fade', 'tco-in-fade'], pop: ['tco-in-pop', 'tco-in-pop-x'],
    drop: ['tco-in-drop', 'tco-in-drop'], bounce: ['tco-in-bounce', 'tco-in-bounce-x'], spring: ['tco-in-spring', 'tco-in-spring-x'],
    zoom: ['tco-in-zoom', 'tco-in-zoom-x'], flip: ['tco-in-flip', 'tco-in-flip'], tilt: ['tco-in-tilt', 'tco-in-tilt'],
    unfold: ['tco-in-unfold', 'tco-in-unfold'], glitch: ['tco-in-glitch', 'tco-in-glitch'], scan: ['tco-in-scan', 'tco-in-scan-x'],
    decode: ['tco-in-decode', 'tco-in-decode'] };
  // A played entrance lasts Entrance length, but never less than this: 180 ms is over before the eye finds it.
  var PLAY_MIN_MS = 500;
  // Decode's letters, played on a word as js/renderer.js does on a line (decodeText): A-Z, a-z and 0-9 start as random
  // ones of their kind and settle from the first to the last, redrawn every DECODE_TICK_MS.
  var DECODE_TICK_MS = 40;
  var DECODE_SETS = [[/[A-Z]/, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], [/[a-z]/, 'abcdefghijklmnopqrstuvwxyz'], [/[0-9]/, '0123456789']];
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

  // text_weight and name_weight: six steps from light to black, on a slider (a row of six choices wraps
  // unevenly on a phone).
  var WEIGHT_LABELS = { light: 'Light', regular: 'Regular', semibold: 'Semi-bold', bold: 'Bold', heavy: 'Heavy', black: 'Black' };

  // Human labels and help text per config key. Widgets default from SPEC types.
  // logo: a provider logo drawn by css/builder.css (.logo-<name>).
  // when(cfg): the field only applies while this is true; only: 'vertical' or 'horizontal', the one layout it
  // applies to. Either way it is greyed out (syncDisabled) and keeps its value.
  // wrap: a segmented field whose labels may wrap in a narrow panel (like Add to OBS's two routes).
  // swatch: a color field's built-in color, which its picker shows while the setting is '' (Default). A setting with
  // no one color there (each chatter's own) shows a mid grey: a picker fires only on a change, so picking white
  // from a white swatch would set nothing.
  // placeholder: a text, font or color field's empty box (a color field's swatch otherwise).
  // from0(cfg): a stepper's first step up from 0 goes to this value instead of the next number (skipGap).
  // scale: a stepper shows (and reads) the value divided by this (readable_level 45 is 4.5:1), config.SPEC's scale.
  var META = {
    // top: drawn in the top bar beside the Twitch channel (toTopBar), though it stays one of the Kick & YouTube tab's
    // settings. check: a Check button beside the box (checkKick, checkMixItUp).
    kick: { label: 'Kick channel', logo: 'kick', check: true, top: true, placeholder: 'yourname or a link',
      bad: 'That isn’t a valid Kick name. Use letters, numbers, _ and - only.',
      help: 'Adds this Kick channel’s chat to the overlay, with the Twitch channel above or on its own.' },
    kick_room: { label: 'Kick chatroom id', placeholder: 'Check fills this in', parse: 'kickRoom',
      bad: 'Use the number only, or paste the whole channel page.',
      help: 'Kick’s chat needs this number. Check, beside the Kick channel in the top bar, fills it in when Kick allows the lookup. If it doesn’t, open the link shown here, and paste that whole page (or the number after "chatroom":{"id":) in this box.' },
    // YouTube chat, through the Mix It Up app (on the Kick & YouTube tab, under the steps to its link: mixitupSteps). A
    // widget link with a port of its own sets mixitup_port too (commitText), as config.parse does.
    mixitup: { label: 'Mix It Up widget link', logo: 'youtube', check: true, placeholder: 'http://localhost:8111/overlay/…',
      bad: 'That isn’t a Mix It Up widget link. In Mix It Up, copy your Chat widget’s link (Overlay Widgets) and paste it whole.',
      help: 'Adds YouTube chat to the overlay, with Twitch and Kick or on its own. Check asks Mix It Up on this PC whether it has the widget.' },
    // Emptied, it is 8111 again (commitText); a port outside 1024 to 65535 is refused, not moved into the range.
    mixitup_port: { label: 'Mix It Up port', widget: 'text', placeholder: '8111', bad: 'Use a number from 1024 to 65535.',
      help: 'Only change this if you changed the Overlay port on Mix It Up’s Services page. A pasted widget link sets it.' },
    platform_icons: { label: 'Show a Twitch, Kick or YouTube icon on each message', when: twoOn,
      help: 'Only when at least two of Twitch, Kick and YouTube are set. Shows even with badges off.' },
    size: { label: 'Text size', options: { small: 'Small', medium: 'Medium', large: 'Large' }, when: sizeOn,
      help: '18, 24 or 32 px. While Exact text size (Advanced) is set, it decides instead.' },
    text_px: { label: 'Exact text size', widget: 'stepper', step: 2, unit: 'px', zero: 'Auto', from0: textPxFrom0,
      help: 'In px, in place of Text size (Look); badges and emotes follow it. Auto uses Text size, and 1 to 7 become 8. Above about 46 px a horizontal row no longer fits the suggested 100 px tall source, and along its bottom edge a reply’s header no longer fits above about 32 px.' },
    font: { label: 'Font', help: 'Any Google Fonts family, spelled as Google does (DM Serif Text), or a font installed on the streaming PC (Arial, Segoe UI…).' },
    text_weight: { label: 'Text weight', widget: 'range', options: WEIGHT_LABELS,
      help: 'Message and notice text. Light and Black load one more weight of the font; a font without it draws the nearest.' },
    text_color: { label: 'Text color', swatch: '#ffffff',
      help: 'Message text, white by default. Names, /me messages and notices keep their own colors.' },
    line_height: { label: 'Line spacing', widget: 'stepper', step: 5, unit: '%',
      help: 'Line height as a share of the text size (135% by default). Below 135%, in a column, a line with emotes is made taller to fit them, so they don’t reach into the lines next to it. In a row it sets the row’s height.' },
    text_case: { label: 'Letter case', options: { none: 'As typed', upper: 'UPPER', lower: 'lower', smallcaps: 'Small caps' },
      wrap: true, help: 'Names, messages and reply headers. Emotes work either way.' },
    shadow: { label: 'Text shadow', widget: 'seg', names: ['None', 'Light', 'Medium', 'Strong'] },
    shadow_color: { label: 'Shadow color', swatch: '#000000', when: shadowOn,
      help: 'Black by default. The shadow is drawn around the whole message, so emotes, badges and the box get this color too (unless Shadow method, below, is Text only). Needs Text shadow.' },
    outline: { label: 'Text outline', widget: 'seg', names: ['None', 'Thin', 'Medium', 'Thick'],
      help: 'A sharp edge around the letters, black unless you pick an Outline color (below). Emotes and painted names get none.' },
    outline_color: { label: 'Outline color', swatch: '#000000', when: outlineOn,
      help: 'Black by default. Needs Text outline.' },
    names: { label: 'Show names',
      help: 'Off hides the name, and what follows it (After the name), before each message. Reply headers and sub or raid notices keep their names.' },
    name_weight: { label: 'Name weight', widget: 'range', options: WEIGHT_LABELS,
      help: 'Names before messages and in reply headers. A name inside a sub or raid notice follows Text weight (Look).' },
    name_line: { label: 'Name on its own line', when: namesOn,
      help: 'Each message starts on a new line under the name. In a horizontal row each message becomes a small card of two lines, so the row needs about twice the height: about 130 px in place of 100. Needs Show names.' },
    name_font: { label: 'Name font', placeholder: 'Same as Font',
      help: 'Names before messages and in reply headers, in a font of their own: any Google Fonts family, or one installed on the streaming PC. Empty uses Font (Look). A name inside a sub or raid notice keeps the message font.' },
    name_color: { label: 'Name color', swatch: '#808080', placeholder: 'Their own',
      help: 'One color for every name, in place of each chatter’s own. 7TV name paints still show over it, and /me messages take it too. Brighten dark name colors leaves it as picked.' },
    name_fallback: { label: 'Color for names without one', swatch: '#808080', placeholder: 'Twitch colors', when: ownNameColors,
      help: 'For Twitch and Kick chatters who never picked a name color, in place of Twitch’s 15 default colors. Drawn as picked (Brighten dark name colors leaves it alone). Not used while a Name color (Look) is set.' },
    name_sep: { label: 'After the name', options: { colon: 'Colon', space: 'Space', dash: 'Dash', arrow: 'Arrow' }, when: sepShown,
      help: 'What sits between the name and the message: “Name: hi”, “Name hi”, “Name – hi” or “Name › hi”. A /me message keeps its space, and a reply header its colon. Needs Show names, and isn’t drawn under Name on its own line.' },
    bg: { label: 'Line background', widget: 'range', unit: '%', zero: 'Off',
      help: 'A rounded box behind each message, black unless you pick a Box color. Helps on bright or busy scenes.' },
    bg_color: { label: 'Box color', swatch: '#000000', when: bgOn,
      help: 'Black by default. A light box needs a dark Text color (and Notice text color, in Chat events); on one, Brighten dark name colors darkens light names instead. Needs Line background.' },
    accent_bar: { label: 'Name-color bar',
      help: 'A bar in the chatter’s name color beside each message. A first-time chatter’s bar takes its place, and announcements keep their own.' },
    bg_shape: { label: 'Box corners', options: { square: 'Square', soft: 'Soft', round: 'Round', pill: 'Pill' }, when: bgOn,
      help: 'Pill gives a one-line box round ends. Needs Line background.' },
    bg_width: { label: 'Box width', options: { fit: 'Fit the text', full: 'Full width' }, when: bgOn, only: 'vertical',
      help: 'Full width makes every box as wide as the column. Vertical layout only, with Line background on.' },
    spacing: { label: 'Space between messages', options: { tight: 'Tight', normal: 'Normal', loose: 'Loose', extra: 'Extra' },
      help: 'In a column, the space above and below each message; in a row, the gap between messages. At Tight, in a column without Line background, a message with emotes keeps the room they need, so emotes don’t overlap.' },
    layout: { label: 'Layout', options: { vertical: 'Vertical', horizontal: 'Horizontal' },
      help: 'Vertical stacks messages in a column; Horizontal runs them in one row, like a ticker.' },
    align: { label: 'New messages appear', options: { bottom: 'At the bottom', top: 'At the top' },
      // Shown instead while layout is horizontal (see syncLabels).
      horizontal: { label: 'Row sits', help: 'Whether the row runs along the bottom or the top edge of the source. New messages always come in on the right.' } },
    text_align: { label: 'Text alignment', options: { left: 'Left', center: 'Center', right: 'Right' }, only: 'vertical',
      help: 'Where messages sit in the column, with their boxes. Name-color, first-message and announcement bars stay on the left. Vertical layout only.' },
    row_align: { label: 'Row alignment', options: { left: 'Left', center: 'Center', right: 'Right' }, only: 'horizontal',
      help: 'Where the messages sit while they don’t fill the row yet. Once they do, the newest one is always at the right end and older ones slide off the left. Horizontal layout only.' },
    line_width: { label: 'Max message width', widget: 'stepper', step: 5, unit: 'em', zero: 'No limit',
      help: 'In em, the text size: 30 em is about 55 letters. A longer message wraps, or in a row ends in “…”. 1 to 4 become 5.' },
    pad_x: { label: 'Side padding', widget: 'stepper', step: 4, unit: 'px',
      help: 'Space between the messages and the left and right edges of the source (8 px by default). At 0, shadows and emotes at the edges are cut off.' },
    edge_fade: { label: 'Soft edge', widget: 'stepper', unit: 'em', zero: 'Off',
      help: 'Old messages fade out over this distance (in em, the text size) as they reach the edge they leave by: the top, the bottom when new messages appear at the top, or the left end of a row. It covers at most half the source, so the newest message stays clear unless it is taller than that. In a row the newest message starts after the fade, so a long one is cut that much shorter. Some extra PC work while animated emotes are on screen.' },
    row_sep: { label: 'Mark between messages', options: { none: 'None', dot: 'Dot', bar: 'Bar', diamond: 'Diamond' }, only: 'horizontal',
      help: 'A small mark in the text color between messages in the row. Horizontal layout only.' },
    animate: { label: 'Animate new messages' },
    enter_style: { label: 'Entrance', widget: 'select', play: ENTER_FRAMES, when: animateOn,
      options: { slide: 'Slide', fade: 'Fade', pop: 'Pop', drop: 'Drop', bounce: 'Bounce', spring: 'Spring', zoom: 'Zoom',
        flip: 'Flip', tilt: 'Tilt', unfold: 'Unfold', glitch: 'Glitch', scan: 'Scan', decode: 'Decode' },
      help: 'How a new message comes in. Point at one in the list, or move to it with the arrow keys, to see it play (for at least half a second, so a short one can be seen). Slide rises from below (in a row, in from the right), Bounce rises and bounces as it lands, Pop and Spring grow into place, Zoom shrinks into place, Drop comes down from above, Flip swings down, Tilt rises turned a little, and Unfold opens out. Glitch flickers and jumps into place, Scan is drawn in from the top (in a row, from the left), and Decode fades in with its letters scrambled, settling one after another: it reads best with an Entrance length of 600 ms or more. Decode scrambles A to Z and digits only, so other scripts and emotes simply fade in. Scan and Decode cost the streaming PC a little more than the others while a message comes in. In a row the older messages still glide left to make room. Needs Animate new messages.' },
    enter_ms: { label: 'Entrance length', widget: 'stepper', step: 50, unit: 'ms', when: animateOn,
      help: 'How long a new message takes to come in, in milliseconds (180 by default). When a message is removed soon after (Remove messages after, in Messages), its fade-out waits for the entrance to end and takes the time left. Needs Animate new messages.' },
    fade: { label: 'Remove messages after', widget: 'stepper', step: 5, unit: 's', zero: 'Never',
      help: 'Seconds. The message fades out over the end of that time: the last second, or the Fade-out length set below. Never keeps messages until newer ones push them out.' },
    fade_out_ms: { label: 'Fade-out length', widget: 'stepper', step: 250, unit: 'ms', zero: 'Instant', when: fadeOn,
      help: 'How long a message takes to fade out at the end of Remove messages after, in milliseconds (1000, one second, by default), and never longer than it stays. The message is gone at the same moment either way. Instant removes it without a fade. Needs Remove messages after.' },
    exit_style: { label: 'Exit', options: { fade: 'Fade', slide: 'Slide' }, when: fadeOutOn,
      help: 'Slide moves a message out as it fades, toward the edge old messages leave by: up, down when new messages appear at the top, or left in a row. Works with or without Animate new messages. Needs Remove messages after and a Fade-out length other than Instant.' },
    smooth_scroll: { label: 'Smooth scrolling', only: 'vertical', when: animateOn,
      help: 'Older messages glide up (down when new messages appear at the top) to make room for a new one instead of jumping, the way a row glides left. In a busy chat they keep moving. A message removed from the middle, such as one a moderator deletes, still closes its gap at once. Vertical layout only, with Animate new messages on.' },
    max: { label: 'Max messages on screen', widget: 'stepper', step: 5, help: 'From 1 to 200.' },
    bots: { label: 'Show bot messages',
      help: 'Nightbot, StreamElements, Streamlabs, Moobot, Fossabot, Kick’s KickBot and similar bots, any account with Twitch’s or Kick’s own Bot badge, plus the bots listed on the channel’s BetterTTV page. While they are hidden, a reply to one shows without quoting it.' },
    hide_commands: { label: 'Hide !commands',
      help: 'Hides commands: messages that start with a command prefix, “!” or the signs set in Command prefixes (below), with the command’s name straight after it (!points). “!!!” or “! wow” still shows. A reply to a hidden command shows without quoting it.' },
    command_prefixes: { label: 'Command prefixes', placeholder: '!', when: commandsOn,
      bad: 'Use up to 8 of these signs, written together: ! $ % & * + - . / : ; = ? @ # ~ ^',
      help: 'The signs a command starts with, written together: !? hides both !points and ?points, but not ? or ??? (a sign counts only with a letter or a digit straight after it). Up to 8 of ! $ % & * + - . / : ; = ? @ # ~ ^. With @, a message that starts by naming someone is hidden too (a reply still shows). Needs Hide !commands.' },
    block: { label: 'Hide these users', help: 'Usernames, separated by commas; a name counts on Twitch and Kick alike.', placeholder: 'username1, username2' },
    block_words: { label: 'Hide messages containing', placeholder: 'word, two words',
      help: 'Hides chat messages with any of these words or phrases, in any letter case. Separate them with commas; a phrase may have spaces. Whole words only: gg doesn’t hide eggs. Up to 50, each up to 40 characters; more are left out, in settings.js too. A reply to a hidden message shows without quoting it. Try overlay to see it in the preview. A URL can be about 8,000 characters long, and a letter outside A–Z takes 6 to 9 of them, so a long list (above all one in Japanese or Korean) is better kept in settings.js.' },
    links: { label: 'Links', options: { show: 'Show', shorten: 'Shorten', hide: 'Hide' },
      help: 'Shorten shows each link as its site’s name (clips.twitch.tv); Hide hides messages with a link. A link starts with https://, http:// or www. (a bare example.com is left as it is), and is never clickable. While it isn’t Show, a demo message has a link.' },
    role_filter: { label: 'Only show messages from', options: { all: 'Everyone', subs: 'Subs+', vips: 'VIPs+', mods: 'Mods' }, wrap: true,
      help: 'Subs+ is subscribers (founders too), VIPs, mods and the broadcaster; VIPs+ is VIPs, mods and the broadcaster. Read from their badges, so it works with badges off. The broadcaster always shows, and sub, raid and other notices follow Chat events.' },
    allow_users: { label: 'Only show these users', placeholder: 'username1, username2',
      help: 'While any are listed, only their chat messages show: usernames, separated by commas, Twitch and Kick alike. Sub, raid and other notices still show, and every other filter still applies.' },
    min_length: { label: 'Hide messages shorter than', widget: 'stepper', zero: 'Off',
      help: 'In characters (an emoji is one, and an emote counts as its name: LUL is 3), so 4 hides gg, o7 and LUL. A reply’s @name isn’t counted while “Show what replies are answering” is on. A resubscriber’s message under its notice is hidden too; the notice stays.' },
    events: { label: 'Show subs, gifts, raids and announcements',
      help: 'Sub, resub, gift sub, raid and bits badge notices, plus /announce messages. When off, all of these are hidden; a resubscriber’s own chat message still shows. The Event types switches pick which ones show.' },
    event_subs: { label: 'Subs and resubs', when: eventsOn },
    event_gifts: { label: 'Gift subs', when: eventsOn },
    event_raids: { label: 'Raids and Kick hosts', when: eventsOn },
    event_bits_badge: { label: 'Bits badges', when: eventsOn },
    event_announcements: { label: 'Announcements', when: eventsOn },
    notice_color: { label: 'Notice text color', swatch: '#e2d6ff', when: eventsOn,
      help: 'Sub, gift, raid and bits badge notices, light purple by default. Announcements keep Text color. Needs Show subs, gifts, raids and announcements.' },
    notice_size: { label: 'Notice text size', widget: 'range', unit: '%', when: eventsOn,
      help: 'Next to the chat text (85% by default). Above 100% a notice can be cut off in a short horizontal source. Needs Show subs, gifts, raids and announcements.' },
    replies: { label: 'Show what replies are answering', help: 'Adds a small “↪ @user: message” line above a reply.' },
    reply_style: { label: 'Reply header', options: { full: 'Full', name: 'Name only' }, wrap: true, when: repliesOn,
      help: 'Name only shows “↪ @user” without the message being answered. Needs Show what replies are answering.' },
    first_msg: { label: 'Mark first-time chatters', help: 'A colored bar beside someone’s first message in the channel.' },
    first_msg_color: { label: 'First-message bar color', swatch: '#9146ff', when: firstMsgOn,
      help: 'Purple by default. Needs Mark first-time chatters.' },
    history: { label: 'Recent messages on load', widget: 'stepper', step: 5, zero: 'Off',
      help: 'Shows up to this many recent messages (Twitch’s from recent-messages.robotty.de, Kick’s from kick.com) when the overlay starts, and catches up on what a Twitch or Kick reconnect missed.' },
    shared: { label: 'Include Shared Chat',
      help: 'During a Shared Chat session, also show the other channels’ messages. Every message is marked with its channel’s avatar.' },
    timestamps: { label: 'Timestamps', options: { off: 'Off', '12h': '12-hour', '24h': '24-hour' },
      help: 'The time each message was sent, by the streaming PC’s clock, before its badges: 3:07 (12-hour, without AM or PM) or 15:07. Recent messages loaded at the start show when they were sent.' },
    mentions: { label: 'Highlight channel mentions', options: { off: 'Off', at: '@name', name: 'Plain too' }, wrap: true,
      when: channelOn,
      help: 'Tints messages that mention your channel: @name, or with Plain too the bare name as well (not in a link). Replies to you count, your own messages don’t. Needs a Twitch or Kick channel; the preview’s first demo message then mentions you. The color is below.' },
    mention_color: { label: 'Mention color', swatch: '#e91916', when: mentionColorOn,
      help: 'Red by default, see-through over the message. Needs Highlight channel mentions.' },
    keywords: { label: 'Highlight words', placeholder: 'word, two words',
      help: 'Tints messages with any of these words or phrases, in any letter case. Separate them with commas; a phrase may have spaces. Whole words only: gg doesn’t match eggs. Up to 50, each up to 40 characters. Try overlay to see it in the preview. A URL can be about 8,000 characters long, and a letter outside A–Z takes 6 to 9 of them, so a long list (above all one in Japanese or Korean) is better kept in settings.js.' },
    highlight_users: { label: 'Highlight these users', placeholder: 'username1, username2',
      help: 'Their messages get the Highlight words tint. Usernames, separated by commas; a name counts on Twitch and Kick alike. Try paintedpal to see it in the preview.' },
    keyword_color: { label: 'Highlight word color', swatch: '#ffb31a', when: wordsOrUsersOn,
      help: 'Amber by default, for Highlight words and Highlight these users. Needs one of them.' },
    points_highlight: { label: 'Channel-points highlights',
      help: 'A purple tint on messages highlighted with channel points. Off shows them like any other message (a mention or a highlight word still tints one).' },
    points_color: { label: 'Points highlight color', swatch: '#9146ff', when: pointsOn,
      help: 'Purple by default. Needs Channel-points highlights.' },
    role_style: { label: 'Mark broadcaster, mods, VIPs', options: { off: 'Off', bar: 'Bar', tint: 'Tint' },
      help: 'A bar beside their messages, or a tint behind them, in a color for each role (below). Read from their badges, so it works with badges off; subscribers aren’t marked. A first-time chatter’s bar wins over the role bar, and the tints above win over the role tint. Announcements keep their own look.' },
    broadcaster_color: { label: 'Broadcaster color', swatch: '#e91916', when: rolesOn,
      help: 'Red by default. Needs Mark broadcaster, mods, VIPs.' },
    mod_color: { label: 'Moderator color', swatch: '#00ad03', when: rolesOn,
      help: 'Green by default. Needs Mark broadcaster, mods, VIPs.' },
    vip_color: { label: 'VIP color', swatch: '#e005b9', when: rolesOn,
      help: 'Pink by default. Needs Mark broadcaster, mods, VIPs.' },
    gifs: { label: 'Show GIFs posted in chat' },
    gif_size: { label: 'GIF size', options: { '1x': '1×', '2x': '2×', '3x': '3×' }, when: gifSizeOn,
      help: 'How tall a GIF is, in emote heights (3× by default); at 1× its line is no taller than one with emotes. The demo has no GIF. In a horizontal row only with Let big emotes grow the row on (below); without it a row draws GIFs at emote height. Needs Show GIFs posted in chat.' },
    emotes_7tv: { label: '7TV', logo: '7tv', help: 'Channel and global emotes, updated live when the channel changes them. Also shown in Kick chat.' },
    emotes_bttv: { label: 'BetterTTV', logo: 'bttv' },
    emotes_ffz: { label: 'FrankerFaceZ', logo: 'ffz' },
    emote_scale: { label: 'Emote size', widget: 'range', unit: '%',
      help: 'Emotes, cheers and GIFs next to the text (100% by default). Images load at the size drawn, up to the largest each emote service has: past that they look soft. A GIF drawn taller than 200 px loads Giphy’s original file. An emote taller than its line makes the line taller: with Medium text, above about 150% (165% without a box) a reply’s header no longer fits a horizontal row along the bottom of the suggested 100 px tall source.' },
    emote_only: { label: 'Emote-only messages', options: { normal: 'Normal', big: 'Big', huge: 'Huge' }, when: bigDrawn,
      help: 'A message of emotes alone, drawn two (Big) or three (Huge) times as tall. Gigantified emotes keep their own size, and a very wide emote is fitted to the column. In a horizontal row only with Let big emotes grow the row on (below); without it a row draws them at emote height.' },
    row_grow: { label: 'Let big emotes grow the row', only: 'horizontal',
      help: 'Draws emote-only messages (Emote-only messages), GIFs (GIF size) and gigantified emotes as big as the vertical layout does, and lets their messages grow the row taller to fit them; the text stays on one line. The source has to be tall enough for them, or they are cut off: about 150 px for Huge with Medium text, more with larger text or Name on its own line (Look). Off draws them at emote height. Horizontal layout only.' },
    giant_emotes: { label: 'Gigantified emotes', when: bigDrawn,
      help: 'Twitch’s Gigantify an Emote power-up draws the emote three times as tall. Off draws it like any other emote, from a smaller image. In a horizontal row only with Let big emotes grow the row on (Emotes); without it a row draws it at emote height either way.' },
    badges: { label: 'Show badges', help: 'Master switch for every badge source below. The overlay’s own developer and Beta Tester badges always show.' },
    badges_twitch: { label: 'Twitch', logo: 'twitch', when: badgesOn },
    badges_kick: { label: 'Kick', logo: 'kick', when: badgesOn },
    badges_7tv: { label: '7TV', logo: '7tv', when: badgesOn },
    badges_bttv: { label: 'BetterTTV', logo: 'bttv', when: badgesOn },
    badges_ffz: { label: 'FrankerFaceZ', logo: 'ffz', when: badgesOn },
    badges_ffzap: { label: 'FFZ:AP', logo: 'ffzap', when: badgesOn },
    badges_chatterino: { label: 'Chatterino', logo: 'chatterino', when: badgesOn },
    badges_homies: { label: 'Chatterino Homies', logo: 'homies', when: badgesOn },
    homies_lists: { label: 'Chatterino Homies lists', options: { all: 'All lists', light: 'Light' }, when: homiesOn,
      help: 'Light skips the big chatterinohomies.com list: about 0.5 MB less to download, 4 MB less to read and 1 to 2 MB less memory, but about 9,400 people lose their Homies badge. Needs Show badges and Chatterino Homies.' },
    paints: { label: '7TV name paints', help: 'Gradient and image name colors from 7TV.' },
    paint_images: { label: '7TV image paints', options: { animated: 'Animated', static: 'Still' }, when: paintsOn,
      help: 'Still shows the first frame of an animated paint, so painted names stop redrawing many times a second while chat is quiet. Needs 7TV name paints.' },
    shadow_style: { label: 'Shadow method', options: { filter: 'Whole line', text: 'Text only' }, when: shadowOn,
      help: 'Text only draws the shadow on the letters alone, about half the PC work while animated emotes are on screen. Emotes, badges, GIFs, the box and painted names then have no shadow. Needs Text shadow.' },
    stv_lookup: { label: 'Look up 7TV cosmetics for every chatter', when: stvCosmeticsOn,
      help: '7TV only announces paints and badges for people running a 7TV extension. This asks 7TV about everyone else, in small rate-limited batches. The answer isn’t checked against subscriptions, so it can show paints for lapsed 7TV subs. Needs 7TV name paints, or Show badges and 7TV.' },
    readable: { label: 'Brighten dark name colors', when: ownNameColors,
      help: 'Lightens very dark usernames so they stay readable. On a light Box color (white at a Line background of about 50% or more) it darkens light ones instead. Not used while a Name color (Look) is set.' },
    readable_level: { label: 'Name contrast', widget: 'stepper', step: 5, scale: 10, unit: ':1', when: readableOwn,
      help: 'How light Brighten dark name colors makes a dark name: its contrast with black, from 3:1 to 7:1 (4.5:1 by default); on a light Box color, how dark it makes a light name: its contrast with the box. It lightens in steps, so a small change may leave a name as it was. Needs Brighten dark name colors; not used while a Name color (Look) is set.' },
    badge_size: { label: 'Badge size', widget: 'range', unit: '%',
      help: 'Next to the text (100% by default), with the Twitch, Kick and YouTube icons and Shared Chat avatars, which show even with badges off. Above about 135% lines with badges get taller.' },
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

  var EVENT_SUBS = ['event_subs', 'event_gifts', 'event_raids', 'event_bits_badge', 'event_announcements'];
  // What each event switch covers, and what the demo can show of them.
  var EVENT_SUBS_HELP = 'A switch that is off hides those notices only: a resubscriber’s own message still shows. Subs ' +
    'include upgrades from a gift or Prime sub, gifts include gifts paid forward, and cheers always show. Announcements ' +
    'are hidden whole, as they are with all events off. Kick’s subs, gifts and hosts follow these too. The demo has a ' +
    'resub and a raid only.';

  // Switches drawn as one grid under the switch that rules them (keyed by it): label names the grid for
  // assistive tech, help goes under it.
  var SUBGRIDS = {
    badges: { keys: BADGE_SUBS, label: 'Badge sources', help: BADGE_SUBS_HELP },
    events: { keys: EVENT_SUBS, label: 'Event types', help: EVENT_SUBS_HELP }
  };

  // One section of the settings panel each; the rail lists them in this order, then "Add to OBS".
  // keys: every field of the section, in order. subs: [{id, title, first}] sub-headings, each drawn above the
  // field `first`; in Advanced its id is an anchor (builder.html#adv-text opens Advanced there). more: such an
  // id, linked at the foot of the section as "More in Advanced". fold: each sub-heading opens and closes the fields
  // under it (buildGroups), and a sub's `open` says it starts open: the ones most looks are made with.
  var GROUPS = [
    { id: 'look', title: 'Look', note: 'Quick looks, layout, text, names, boxes and how new messages come in.',
      keys: ['layout', 'align', 'text_align', 'row_align', 'size', 'font', 'text_weight', 'text_color', 'shadow', 'shadow_color',
        'shadow_style', 'outline', 'outline_color', 'names', 'name_color', 'name_line', 'name_sep', 'bg', 'bg_color', 'bg_shape',
        'bg_width', 'accent_bar', 'animate', 'enter_style', 'enter_ms', 'smooth_scroll'],
      fold: true,
      subs: [{ title: 'Layout', first: 'layout', open: true }, { title: 'Text', first: 'size', open: true },
        { title: 'Names', first: 'names' }, { title: 'Box', first: 'bg' }, { title: 'Animation', first: 'animate' }],
      more: 'adv-text' },
    // The icons first, as they are for every chat; then each platform under its own heading: Kick's starts with where
    // its channel went (the top bar: kickPointer), YouTube's with the steps to the Mix It Up widget's link (mixitupSteps).
    // after: a help line drawn after that field, which ends its part (what Kick chat shows, before YouTube's heading).
    { id: 'platforms', title: 'Kick & YouTube', note: 'Kick and YouTube chat in one overlay with Twitch’s, or on their own.',
      keys: ['platform_icons', 'kick', 'kick_room', 'mixitup', 'mixitup_port'],
      subs: [{ title: 'Kick', first: 'kick' }, { title: 'YouTube', first: 'mixitup' }],
      after: { kick_room: 'Kick chat shows Kick and 7TV emotes, and Kick badges. Its recent messages load only when kick.com lets the overlay look the channel up.' } },
    { id: 'messages', title: 'Messages', note: 'How many messages show, and for how long.',
      keys: ['fade', 'fade_out_ms', 'exit_style', 'max', 'history'] },
    { id: 'events', title: 'Chat events', note: 'Subs, raids, replies, highlights and timestamps.',
      keys: ['events'].concat(EVENT_SUBS, ['notice_color', 'notice_size', 'replies', 'reply_style', 'first_msg', 'first_msg_color',
        'shared', 'mentions', 'mention_color', 'timestamps']),
      subs: [{ title: 'Highlights & timestamps', first: 'mentions' }], more: 'adv-highlights' },
    { id: 'filters', title: 'Filters', note: 'Who and what stays out of the overlay.',
      keys: ['bots', 'hide_commands', 'command_prefixes', 'block', 'block_words', 'links', 'role_filter'], more: 'adv-filters' },
    { id: 'emotes', title: 'Emotes', note: 'Twitch and Kick emotes are always shown.',
      keys: ['emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'gifs', 'gif_size', 'emote_scale', 'emote_only', 'row_grow'], more: 'adv-emotes' },
    { id: 'badges', title: 'Badges & paints', note: 'Each badge source has its own switch.',
      foot: 'DankChat badges can’t be shown: DankChat’s server doesn’t allow requests from web pages (no CORS header).',
      keys: ['badges'].concat(BADGE_SUBS, ['homies_lists', 'paints', 'paint_images', 'stv_lookup', 'readable', 'readable_level',
        'badge_size']) },
    // A setting that needs a switch sits under that switch, on its tab; Advanced keeps the fine-tuning that needs none.
    { id: 'advanced', title: 'Advanced', note: 'Fine-tuning for text, names, layout, highlights, filters and emotes, and troubleshooting last.',
      keys: ['text_px', 'line_height', 'text_case', 'name_weight', 'name_font', 'name_fallback', 'spacing',
        'line_width', 'pad_x', 'edge_fade', 'row_sep', 'keywords', 'highlight_users', 'keyword_color', 'points_highlight',
        'points_color', 'role_style', 'broadcaster_color', 'mod_color', 'vip_color', 'allow_users', 'min_length',
        'giant_emotes', 'debug', 'demo'],
      // Troubleshooting last: the two switches are for finding a fault, not for the look, and opened Advanced at them.
      subs: [{ id: 'adv-text', title: 'Text', first: 'text_px' }, { id: 'adv-names', title: 'Names', first: 'name_weight' },
        { id: 'adv-layout', title: 'Layout', first: 'spacing' }, { id: 'adv-highlights', title: 'Highlights', first: 'keywords' },
        { id: 'adv-filters', title: 'Filters', first: 'allow_users' }, { id: 'adv-emotes', title: 'Emotes', first: 'giant_emotes' },
        { id: 'adv-trouble', title: 'Troubleshooting', first: 'debug' }] }
  ];
  // Advanced headings whose settings moved to the tab of the switch they need: an old link to one opens that tab.
  var MOVED_SUBS = { 'adv-box': 'look', 'adv-animation': 'look', 'adv-events': 'events', 'adv-lighter': 'badges' };

  // Quick looks, a row of buttons at the top of Look. Each sets every PRESET_KEYS setting: the ones in its `set` to
  // those values, the rest to their defaults. So a look never depends on the one picked before it, Default is the
  // look of an overlay with no settings, and the URL carries only what a look changes. All of them are live keys
  // (the preview keeps its frame). Font, name colors, layout, position and the channels are never among them.
  var PRESET_KEYS = ['size', 'text_px', 'text_weight', 'name_weight', 'line_height', 'text_color', 'shadow', 'shadow_color',
    'outline', 'outline_color', 'bg', 'bg_color', 'bg_shape', 'bg_width', 'spacing', 'accent_bar', 'name_line', 'emote_scale',
    'badge_size'];
  var PRESETS = [
    { id: 'default', label: 'Default', set: {} },
    { id: 'boxed', label: 'Boxed', set: { bg: 70, shadow: 0 } },
    { id: 'outlined', label: 'Outlined', set: { shadow: 0, outline: 2 } },
    { id: 'cards', label: 'Cards', set: { bg: 80, shadow: 0, bg_shape: 'soft', bg_width: 'full', spacing: 'loose', accent_bar: true,
      name_line: true } },
    { id: 'big', label: 'Big & bold', set: { size: 'large', text_weight: 'bold', shadow: 3, emote_scale: 125 } }
  ];
  // Its first sentence names every PRESET_KEYS setting (tests/builder-dom.test.js holds it to that): a look resets each.
  var PRESETS_HELP = 'Sets text size, weight and color, shadow, outline, box, name-color bar, spacing, whether the name ' +
    'has a line of its own, and emote and badge size. Your font, name colors, layout and position stay. Big & bold ' +
    'can be cut off in a 1920 × 100 horizontal source, and Cards wants one about 130 px tall.';

  // ---------- pure helpers (unit tested) ----------

  function isLiveKey(k) { return config.LIVE_KEYS.indexOf(k) >= 0; }

  var RELOAD_KEYS = config.KEYS.filter(function (k) { return !isLiveKey(k); });

  // Keys a demo overlay ignores: it loads no history (overlay.js loadHistory), looks up no chatters
  // on 7TV, has no Shared Chat and joins no chat (Kick's chatroom, Mix It Up's port), so changing one (when it is a
  // reload key) needs no demo reload.
  var DEMO_INERT = ['history', 'shared', 'stv_lookup', 'kick_room', 'mixitup_port'];

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
        note: g.note, foot: g.foot, subs: g.subs || [], more: g.more || '', fold: !!g.fold, after: g.after || {} };
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

  // GitHub Pages, which hosts the overlay, answers 414 "URI Too Long" once a request's path and query pass about
  // 8 KB, and OBS then shows that error in place of chat. A letter outside A-Z takes 6 to 12 bytes in a URL, so word
  // lists in Japanese or Korean get there inside their caps. A file: URL is read from disk and has no such limit.
  var MAX_URL_BYTES = 8000;
  var URL_LONG_NOTE = 'This URL is too long for the overlay’s host: OBS would show “URI Too Long”. Shorten the lists, or use settings.js.';
  function urlTooLong(url) {
    var u;
    try { u = new URL(String(url)); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return (u.pathname + u.search).length > MAX_URL_BYTES;
  }

  // The settings that can make a URL long: the lists of names and words. All are live keys.
  var LIST_KEYS = config.KEYS.filter(function (k) {
    var t = config.SPEC[k].type;
    return (t === 'list' || t === 'words') && isLiveKey(k);
  });

  // The preview frame's URL: previewUrl, unless the host would refuse it. Then the lists are written empty (still
  // there, so a settings.js can't fill them in) and reach the frame with the other live settings once it has loaded.
  function previewSrc(pc, baseHref) {
    var url = previewUrl(pc, baseHref);
    if (!urlTooLong(url)) return url;
    var c = copyCfg(pc);
    LIST_KEYS.forEach(function (k) { c[k] = []; });
    return previewUrl(c, baseHref);
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
    // A '#' typed in a value (text_color=#ff8800, keywords=c#) is part of it, as the overlay reads it (config.withHash).
    var h = search.indexOf('#');
    if (h >= 0) search = config.withHash(search.slice(0, h), search.slice(h + 1));
    var params = new URLSearchParams(search);
    // As config.parse reads a query: keys lowercased, the last value wins.
    var fromUrl = {};
    params.forEach(function (v, k) { if (isKnown(k)) fromUrl[String(k).toLowerCase()] = v; });
    var count = countApplied(fromUrl);
    return count ? { cfg: config.parse(params), count: count } : null;
  }

  // The builder's first config, from its query string and the remembered config. A link with only the channels
  // (CHANNEL_KEYS: ?channel=, ?kick=, ?mixitup=…, as the overlay's hints link here) keeps the remembered look and
  // filters; a link with more settings is a whole setup, over the defaults.
  function startCfg(search, stored) {
    var params = new URLSearchParams(search || '');
    var known = [];
    params.forEach(function (v, k) { if (isKnown(k)) known.push(String(k).toLowerCase()); });
    var base = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
    if (known.length) {
      var onlyChannel = known.every(function (k) { return CHANNEL_KEYS.indexOf(k) >= 0; });
      var cfg = config.parse(params, onlyChannel ? base : null);
      // The remembered chatroom id is the remembered Kick channel's: a link naming another channel without one (the
      // overlay's hint link) leaves it out, so the new channel is looked up (replaceCfg). As in onKickChanged, an id
      // remembered without a channel stays.
      if (onlyChannel && base && known.indexOf('kick_room') < 0) {
        var was = config.parse('', base).kick;
        if (was && cfg.kick !== was) cfg.kick_room = '';
      }
      return { cfg: cfg, fromQuery: true, fromStore: false };
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

  // In one column a source shown whole can be too small to read: a 1920 × 100 row on a phone is at 19%, and so is a
  // column in the docked preview. There the preview shows the end the new messages come in at, at a size that reads:
  // a column at its full width, cut to its bottom (its top with align=top); a row at its full height and at most 60%,
  // cut to its right-hand end (the left end or the middle with row_align, where its messages sit until they fill it).
  // Null when the whole source reads well enough, or a cut would gain little. s: the scale; bw, bh: the part shown (px).
  var CROP_BELOW = 0.45; // a source shown whole at less than this is cut
  var ROW_SCALE = 0.6; // a cut row: medium text (24px) at about 14px, and room for two or three messages on a phone
  function cropView(cfg, w, h, availW, availH) {
    if (!(w > 0) || !(h > 0) || !(availW > 0) || !(availH > 0)) return null;
    var whole = fitScale(w, h, availW, availH);
    if (whole >= CROP_BELOW) return null;
    var row = cfg.layout === 'horizontal';
    var s = row ? Math.min(1, availH / h, ROW_SCALE) : Math.min(1, availW / w);
    if (s < whole * 1.25) return null;
    var at = row ? (cfg.row_align === 'left' ? 'left' : cfg.row_align === 'center' ? 'middle' : 'right')
      : (cfg.align === 'top' ? 'top' : 'bottom');
    return { s: s, at: at, bw: Math.floor(Math.min(w * s, availW)), bh: Math.floor(Math.min(h * s, availH)) };
  }
  // What the tag line calls a cut part (cropView's at), in full and short.
  var CROP_NAMES = { right: ['right-hand end', 'right end'], left: ['left-hand end', 'left end'], middle: ['middle', 'middle'],
    bottom: ['bottom', 'bottom'], top: ['top', 'top'] };

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

  // The channels, with the Kick chatroom id that goes with a Kick one, and the Mix It Up widget: what the overlay is for,
  // not a setting changed from its default, so the counts and the URL note leave them out.
  var CHATS = ['channel', 'kick', 'kick_room', 'mixitup'];
  // They and the port Mix It Up is reached on (which a widget's link can set, and the overlay's hint link names): a link
  // that names only these keeps the remembered look (startCfg), and Reset keeps them. The port off its default is a
  // setting changed all the same, as its tag and the URL show.
  var CHANNEL_KEYS = CHATS.concat('mixitup_port');
  function settingsChanged(cfg) {
    return Object.keys(changedKeys(cfg)).filter(function (k) { return CHATS.indexOf(k) < 0; });
  }

  // Changed settings per section, for the counts in the rail.
  function groupCounts(cfg) {
    var changed = changedKeys(cfg), out = {};
    groupLayout().forEach(function (g) {
      out[g.id] = g.keys.filter(function (k) { return changed[k] === true && CHATS.indexOf(k) < 0; }).length;
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
    if (!chatOn(cfg)) return { text: 'Add a channel first. Without one the overlay only shows a hint.', cls: 'warn' };
    if (cfg.kick && !cfg.kick_room) {
      return { text: 'The Kick chatroom id is missing, and Kick may refuse the overlay’s own lookup. Press Check next to the Kick channel, or add the id by hand on the Kick & YouTube tab.', cls: 'warn' };
    }
    if (ch && ch.state === 'notfound' && ch.login === cfg.channel) {
      return { text: 'Twitch has no channel called “' + cfg.channel + '”. Check the spelling.', cls: 'warn' };
    }
    if (urlTooLong(url)) {
      return { text: URL_LONG_NOTE, cls: 'warn' };
    }
    if (/^file:/i.test(String(url))) {
      return { text: 'The URL lists every setting, so a settings.js in the overlay’s folder can’t change this source.', cls: '' };
    }
    var n = settingsChanged(cfg).length;
    return { text: n
      ? 'Holds only the ' + n + ' setting' + (n === 1 ? '' : 's') + ' you changed. The rest use the defaults.'
      : 'Every setting is at its default, so the URL only needs the ' + (chatCount(cfg) > 1 ? 'channels'
        : cfg.mixitup ? 'Mix It Up widget' : 'channel') + '.', cls: '' };
  }

  // The chats cfg sets, by name, joined as a sentence says them: 'Twitch', 'Kick and YouTube', 'Twitch, Kick and YouTube'.
  function chatNames(cfg) {
    var names = [];
    if (cfg.channel) names.push('Twitch');
    if (cfg.kick) names.push('Kick');
    if (cfg.mixitup) names.push('YouTube');
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join('');
  }

  // A number setting as the form shows it: a name (shadow), a word for zero (fade: Never), or with its unit.
  // A choice on a slider (text_weight) shows its label.
  function valueText(key, v) {
    var m = META[key] || {}, s = config.SPEC[key];
    if (s && s.type === 'enum') return (m.options && m.options[v]) || String(v);
    if (m.names && s) return m.names[v - s.min] || String(v);
    if (v === 0 && m.zero) return m.zero;
    // A unit that is a word follows a space ('30 s'); '%' and ':1' follow the number.
    return stepText(key, v) + (!m.unit ? '' : /^[a-z]/i.test(m.unit) ? ' ' + m.unit : m.unit);
  }

  // A stepper's number as it is typed: the value, or with META.scale the value divided by it (45 -> '4.5').
  function stepText(key, v) {
    var m = META[key] || {};
    return m.scale > 1 ? (v / m.scale).toFixed(String(m.scale).length - 1) : String(v);
  }

  // What someone typed into a stepper -> the setting's value (clamped), or undefined. Takes the shown
  // form too: '30 s', 'Never', '4.5:1'. Anything else that isn't a whole number is no value.
  function parseStep(key, text) {
    var s = String(text === undefined || text === null ? '' : text).trim(), m = META[key] || {};
    if (m.zero && s.toLowerCase() === m.zero.toLowerCase()) return config.coerce(key, 0);
    // A whole number, with nothing after it but the field's own unit: '1,000', '2.5' and '1e2' are not 1, 2 and 1.
    // With META.scale, as many decimals as the scale has zeros, and a decimal comma (a phone keypad's) as a point.
    // With the unit it is the ratio ('4.5:1' is readable_level 45); without, it reads as in a URL: a number under the
    // setting's min is the ratio ('4.5', '4,5', '5'), and 30 to 70 are the setting's own values.
    var dec = m.scale > 1 ? String(m.scale).length - 1 : 0;
    if (dec) s = s.replace(/^(\d+),(\d)/, '$1.$2');
    var d = (dec ? new RegExp('^(\\d+(?:\\.\\d{1,' + dec + '})?)\\s*(\\S*)$') : /^(\d+)\s*(\S*)$/).exec(s);
    if (!d || (d[2] && d[2].toLowerCase() !== String(m.unit || '').toLowerCase())) return undefined;
    // The ratio on the setting's own scale, kept within min..max first: '2.9:1' is 29, which coerce would read as 29:1.
    if (dec && d[2]) {
      var sp = config.SPEC[key];
      return config.coerce(key, Math.max(sp.min, Math.min(sp.max, Math.round(parseFloat(d[1]) * m.scale))));
    }
    return config.coerce(key, d[1]);
  }

  // How many of the phrases typed into a words field (keywords, block_words) its setting left out: those after the
  // first 50 and any over 40 characters (config.coerce's words). Each phrase is read as coerce reads it on its own,
  // split where coerce splits it (config.WORD_SEP: a Chinese, Japanese or Korean input method's comma counts too).
  function wordsLeftOut(key, text, kept) {
    var have = Object.create(null), out = Object.create(null), n = 0;
    (kept || []).forEach(function (w) { have[w] = 1; });
    String(text === undefined || text === null ? '' : text).split(config.WORD_SEP).forEach(function (part) {
      var w = config.coerce(key, part) || [];
      // [] is an empty phrase, or one too long: it has more than spaces and control characters in it.
      var id = w.length ? w[0] : /[^\s\u0000-\u001f\u007f]/.test(part) ? '\u0000' + part.trim().toLowerCase() : '';
      if (id && !have[id] && !out[id]) { out[id] = 1; n++; }
    });
    return n;
  }

  // Text pasted into a words field (keywords, block_words) over value's start..end. A list one phrase a line, as a bot or
  // Twitch exports blocked terms (or a row of spreadsheet cells), would reach the one-line box with its line breaks
  // turned into spaces: one long phrase. So each run of line breaks or tabs becomes ', ', and so does the edge with
  // the phrases already around the selection (the spaces there go). Returns { start, end, text }: the range of value to
  // replace, a little wider than the selection, and what goes there. null: no line break or tab, so the browser pastes it.
  function pastedWords(value, start, end, text) {
    var t = String(text === undefined || text === null ? '' : text);
    if (!/[\r\n\t]/.test(t)) return null;
    var v = String(value === undefined || value === null ? '' : value);
    t = t.replace(/[\s,]*[\r\n\t][\s,]*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
    if (!t) return { start: start, end: end, text: '' };
    var lead = v.slice(0, start).replace(/\s+$/, ''), tail = v.slice(end).replace(/^\s+/, '');
    if (lead) t = (config.WORD_SEP.test(lead.slice(-1)) ? ' ' : ', ') + t;
    if (tail && !config.WORD_SEP.test(tail.charAt(0))) t += ', ';
    return { start: lead.length, end: v.length - tail.length, text: t };
  }

  // The next multiple of step above or below v, within min..max (1 -> 5 -> 10 … and back down to 1).
  function stepValue(v, dir, step, min, max) {
    var n = dir > 0 ? (Math.floor(v / step) + 1) * step : (Math.ceil(v / step) - 1) * step;
    return Math.max(min, Math.min(max, n));
  }

  // A step from `from` to `to` on a setting with SPEC lowest (line_width, text_px): 1..lowest-1 isn't a value
  // (config.coerce raises it to lowest), so a step down into it goes on to 0 and a step up into it goes to lowest.
  // Otherwise ArrowDown from 5 would land on 4, which is 5 again. With META.from0 (text_px) a step up from 0 goes
  // to from0(cfg) instead: the px of the Text size it takes over from.
  function skipGap(key, from, to, cfg) {
    var s = config.SPEC[key], m = Object.prototype.hasOwnProperty.call(META, key) ? META[key] : {};
    if (from === 0 && to > 0 && typeof m.from0 === 'function') return m.from0(cfg || {});
    if (!s || !(s.lowest > 0) || !(to > 0 && to < s.lowest)) return to;
    return to < from ? 0 : s.lowest;
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
    if (Object.prototype.hasOwnProperty.call(MOVED_SUBS, raw.toLowerCase())) return MOVED_SUBS[raw.toLowerCase()];
    var s = raw.replace(/^group-/, '').toLowerCase();
    return s && (ids || sectionIds()).indexOf(s) >= 0 ? s : '';
  }

  // Whether a field is greyed out under cfg: its META.when is false, or its META.only is the other layout.
  function fieldOff(key, cfg) {
    if (fieldAway(key, cfg)) return true;
    var m = META[key] || {};
    return typeof m.when === 'function' && !m.when(cfg);
  }

  // Whether a field is left out of the form under cfg: its META.only is the other layout. A field of the other layout
  // can't be turned on from here (only a Layout switch brings it back), so it is hidden, not greyed out. One that waits
  // on a setting nearby (META.when) stays in view, greyed: it says what that setting would add, and hiding it would
  // move the fields under it as the setting is changed.
  function fieldAway(key, cfg) {
    var m = META[key] || {};
    return !!m.only && m.only !== (cfg.layout === 'horizontal' ? 'horizontal' : 'vertical');
  }

  // Each setting's tab title (GROUPS doesn't change, so it is worked out once).
  var TAB_TITLES = null;
  function tabTitles() {
    if (!TAB_TITLES) {
      TAB_TITLES = {};
      groupLayout().forEach(function (g) { g.keys.forEach(function (k) { TAB_TITLES[k] = g.title; }); });
    }
    return TAB_TITLES;
  }

  // The line under a greyed-out field (META.when false): what it waits for, in a few words, so no row is greyed out
  // without a reason. A setting is named as its own field is, with its tab when that is another one. Where a when has
  // two parts, the one that is off is named. '' while the field applies.
  function whyOff(key, cfg) {
    var parts = whyParts(key, cfg);
    return parts ? parts.map(function (p) { return typeof p === 'string' ? p : p.text; }).join('') : '';
  }

  // whyOff in pieces: text, and { key, text } for each setting it names, which showWhyOff makes a link to that setting
  // (goToSetting). null while the field applies.
  function whyParts(key, cfg) {
    var m = META[key] || {};
    var w = m.when;
    if (typeof w !== 'function' || w(cfg)) return null;
    var tabs = tabTitles();
    var n = function (k) { return { key: k, text: labelFor(k) + (tabs[k] && tabs[k] !== tabs[key] ? ' (' + tabs[k] + ')' : '') }; };
    var needs = function (k) { return ['Needs ', n(k), '.']; };
    var row = ['In a horizontal row, needs ', n('row_grow'), '.'];
    var channels = [{ key: 'channel', text: 'Twitch' }, ' or ', { key: 'kick', text: 'Kick channel' }];
    // As its help starts, so the line under it isn't said twice (showWhyOff).
    if (w === twoOn) {
      return ['Only when at least two of ', { key: 'channel', text: 'Twitch' }, ', ', { key: 'kick', text: 'Kick' }, ' and ',
        { key: 'mixitup', text: 'YouTube' }, ' are set.'];
    }
    if (w === channelOn) return ['Needs a '].concat(channels, '.');
    if (w === sizeOn) return ['Not used while ', n('text_px'), ' is set.'];
    if (w === ownNameColors) return ['Not used while a ', n('name_color'), ' is set.'];
    if (w === readableOwn) return ownNameColors(cfg) ? needs('readable') : ['Not used while a ', n('name_color'), ' is set.'];
    if (w === sepShown) return namesOn(cfg) ? ['Not drawn under ', n('name_line'), '.'] : needs('names');
    if (w === fadeOutOn) return fadeOn(cfg) ? ['Needs a ', n('fade_out_ms'), ' other than Instant.'] : needs('fade');
    if (w === mentionColorOn) return mentionsOn(cfg) ? ['Needs a '].concat(channels, '.') : needs('mentions');
    if (w === wordsOrUsersOn) return ['Needs ', n('keywords'), ' or ', n('highlight_users'), '.'];
    if (w === gifSizeOn) return gifsOn(cfg) ? row : needs('gifs');
    if (w === bigDrawn) return row;
    if (w === homiesOn) return badgesOn(cfg) ? needs('badges_homies') : needs('badges');
    if (w === stvCosmeticsOn) return ['Needs ', n('paints'), ', or ', n('badges'), ' with 7TV.'];
    var simple = [[shadowOn, 'shadow'], [outlineOn, 'outline'], [namesOn, 'names'], [bgOn, 'bg'], [animateOn, 'animate'],
      [fadeOn, 'fade'], [commandsOn, 'hide_commands'], [eventsOn, 'events'], [repliesOn, 'replies'],
      [firstMsgOn, 'first_msg'], [pointsOn, 'points_highlight'], [rolesOn, 'role_style'], [badgesOn, 'badges'],
      [paintsOn, 'paints'], [readableOn, 'readable']];
    for (var i = 0; i < simple.length; i++) if (simple[i][0] === w) return needs(simple[i][1]);
    return ['Needs another setting turned on first.'];
  }

  // A help text as shown under its field: its first sentence (lead), and the rest behind a More button. Help that
  // fits on about one line shows whole, and so does one sentence alone. A lead shorter than HELP_LEAD_MIN ('Seconds.')
  // takes the next sentence too. A sentence ends at . ! or ? before a capital, a digit or an opening quote, so
  // '… or www. (a bare …' and 'example.com' don't end one.
  var HELP_LINE = 80, HELP_LEAD_MIN = 12;
  function helpParts(text) {
    var t = String(text || '');
    if (t.length <= HELP_LINE) return { lead: t, rest: '' };
    var re = /[.!?](?=\s+[A-Z0-9“"‘])/g, m;
    while ((m = re.exec(t))) {
      if (m.index + 1 < HELP_LEAD_MIN) continue;
      var rest = t.slice(m.index + 1).replace(/^\s+/, '');
      return rest ? { lead: t.slice(0, m.index + 1), rest: rest } : { lead: t, rest: '' };
    }
    return { lead: t, rest: '' };
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

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  // cfg with a quick look applied: every PRESET_KEYS setting at the look's value or its default, the rest as they were.
  function presetCfg(cfg, id) {
    var p = presetById(id), out = copyCfg(cfg), d = config.defaults();
    if (!p) return out;
    PRESET_KEYS.forEach(function (k) { out[k] = Object.prototype.hasOwnProperty.call(p.set, k) ? p.set[k] : d[k]; });
    return out;
  }

  // The quick look cfg is at (every PRESET_KEYS setting as it sets them), or ''.
  function presetOf(cfg) {
    for (var i = 0; i < PRESETS.length; i++) {
      var want = presetCfg(cfg, PRESETS[i].id);
      if (PRESET_KEYS.every(function (k) { return sameValue(cfg[k], want[k]); })) return PRESETS[i].id;
    }
    return '';
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
    var o = config.toObject(B.cfg);
    // A pause in typing commits a new Kick name, but the old channel's chatroom id goes only as the field is left
    // (onKickChanged). Reloaded or closed before that, with no change event, the builder must not remember the pair:
    // opened again, it would call the old channel's id the new one's. Without it the new channel is looked up.
    if (B.kickFor && B.cfg.kick !== B.kickFor) delete o.kick_room;
    store(STORE_CFG, o);
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
  function saveUi() {
    store(STORE_UI, { w: B.ui.w, h: B.ui.h, backdrop: B.ui.backdrop, section: B.ui.section, folds: B.ui.folds, obs: B.ui.obsSeen,
      dock: !B.ui.dockShut });
  }

  function announce(text) {
    var r = $('sr-status');
    if (!r) return;
    r.textContent = '';
    clearTimeout(B.sayTimer); // two in a row (a stepper clicked fast): only the later one is read
    B.sayTimer = setTimeout(function () { r.textContent = text; }, 30);
  }

  // ---------- form fields ----------
  function labelFor(key) { return (META[key] && META[key].label) || key; }

  // A help paragraph: the text in a span of its own (id: what a control's aria-describedby names), then a More
  // button when helpParts leaves some of it out. The part left out stays in the page for assistive tech (css
  // .help-rest), so a description is read whole and the button is the sighted reader's way to it. about: what the
  // help is for, in the button's name ("More about Text size"), as a panel has many a More.
  function helpBlock(id, text, about) {
    var p = h('p', 'help');
    var t = h('span', 'help-text');
    t.id = id;
    p.appendChild(t);
    p._tcoAbout = about;
    setHelpText(p, text);
    return p;
  }

  // Fills a helpBlock (again, as syncLabels does), folded.
  function setHelpText(p, text) {
    var t = p.firstChild, parts = helpParts(text);
    clear(t);
    if (p.lastChild !== t) p.removeChild(p.lastChild);
    p.classList.remove('open');
    t.appendChild(h('span', 'help-lead', parts.lead + (parts.rest ? ' ' : '')));
    if (!parts.rest) return;
    t.appendChild(h('span', 'help-rest', parts.rest));
    var more = h('button', 'help-more', 'More');
    more.type = 'button';
    more.setAttribute('aria-controls', t.id);
    var show = function (open) {
      if (open) p.classList.add('open'); else p.classList.remove('open');
      more.textContent = open ? 'Less' : 'More';
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.setAttribute('aria-label', (open ? 'Less' : 'More') + ' about ' + p._tcoAbout);
    };
    show(false);
    more.addEventListener('click', function () { show(!p.classList.contains('open')); });
    p.appendChild(more);
  }

  // A field's help under it. Returns the text's span (h-<key>), which the field's controls are described by.
  function addHelp(row, key, input) {
    var m = META[key] || {};
    if (!m.help && !m.horizontal) return null; // text that follows the layout needs the element either way
    var p = helpBlock('h-' + key, m.help || '', labelFor(key));
    p.hidden = !m.help;
    row.appendChild(p);
    if (input) input.setAttribute('aria-describedby', 'h-' + key);
    return p.firstChild;
  }

  function widgetFor(key) {
    var s = config.SPEC[key], m = META[key] || {};
    if (m.widget) return m.widget;
    if (s.type === 'bool') return 'check';
    if (s.type === 'enum') return 'seg';
    if (s.type === 'int') return 'stepper';
    if (s.type === 'font') return 'font';
    if (s.type === 'color') return 'color';
    return 'text'; // list, words, kick, room, mixitup, chars
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
        // Greyed out, a switch shows what the overlay does (off: what it waits for is off), not a value it keeps for
        // later; the line under it says why (whyOff).
        field.set = function (v) { cb.checked = !!v && !cb.disabled; };
        field.setDisabled = function (off) {
          cb.disabled = off;
          cb.checked = !off && !!B.cfg[key];
          if (off) row.classList.add('disabled'); else row.classList.remove('disabled');
        };
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
      case 'select': {
        // A choice in a list that opens under a button (a select-only combobox): the focus stays on the button and the
        // arrow keys move along the options. With META.play (enter_style), the option under the pointer or the keys
        // plays its animation on its own name, and so does the button's under the pointer. Its name is no <label>: a
        // click on it would open the list.
        addLabel(false);
        var sel = control(h('div', 'select'));
        var btn = h('button', 'select-btn');
        btn.type = 'button';
        btn.id = id;
        btn.setAttribute('role', 'combobox');
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', id + '-list');
        btn.setAttribute('aria-labelledby', 'l-' + key);
        var shown = h('span', 'select-value');
        btn.appendChild(shown);
        sel.appendChild(btn);
        var list = h('ul', 'select-list');
        list.id = id + '-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-labelledby', 'l-' + key);
        list.hidden = true;
        sel.appendChild(list);
        field.helpEl = addHelp(row, key, btn);
        var opts = segValues(key).map(function (o) {
          var li = h('li', 'select-opt');
          li.id = id + '-' + o.value;
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          var word = h('span', 'select-word', o.label);
          li.appendChild(word);
          list.appendChild(li);
          return { value: o.value, label: o.label, li: li, word: word };
        });
        var active = -1;
        // Decode's letters on a word: settled over ms, or at once (stopDecode) when it plays again or is rewritten.
        var stopDecode = function (el) {
          if (!el._tcoDecode) return;
          clearTimeout(el._tcoDecode.timer);
          el.textContent = el._tcoDecode.text;
          el._tcoDecode = null;
        };
        var decodeWord = function (el, ms) {
          stopDecode(el);
          if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          var d = el._tcoDecode = { text: el.textContent, ticks: 0, timer: null };
          var chars = Array.from(d.text);
          var tick = function () {
            var p = d.ticks++ * DECODE_TICK_MS / ms; // counted in ticks: a word on screen gets each one
            if (p >= 1) { stopDecode(el); return; }
            el.textContent = decodeText(chars, Math.floor(p * chars.length));
            d.timer = setTimeout(tick, DECODE_TICK_MS);
          };
          tick();
        };
        var play = function (el, value) {
          if (!m.play || !m.play[value]) return;
          var name = m.play[value][B.cfg.layout === 'horizontal' ? 1 : 0];
          var ms = Math.max(PLAY_MIN_MS, Number(B.cfg.enter_ms) || 0);
          el.style.animation = 'none';
          void el.offsetWidth; // the same animation again starts over only after a style without it
          el.style.animation = name + ' ' + ms + 'ms ease-out';
          if (value === 'decode') decodeWord(el, ms); else stopDecode(el);
        };
        var indexOf = function (v) {
          for (var i = 0; i < opts.length; i++) if (opts[i].value === String(v)) return i;
          return -1;
        };
        var setActive = function (i, playIt) {
          if (i < 0 || i >= opts.length) return;
          if (active >= 0) opts[active].li.classList.remove('active');
          active = i;
          opts[i].li.classList.add('active');
          btn.setAttribute('aria-activedescendant', opts[i].li.id);
          if (opts[i].li.scrollIntoView) opts[i].li.scrollIntoView({ block: 'nearest' });
          if (playIt) play(opts[i].word, opts[i].value);
        };
        var isOpen = function () { return !list.hidden; };
        var openList = function () {
          if (isOpen() || btn.disabled) return;
          list.hidden = false;
          sel.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
          // all of it in sight: near the foot of the panel it would open past the panel's edge
          if (list.scrollIntoView) list.scrollIntoView({ block: 'nearest' });
          setActive(Math.max(0, indexOf(B.cfg[key])), true);
        };
        var closeList = function () {
          if (!isOpen()) return;
          list.hidden = true;
          sel.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
          btn.removeAttribute('aria-activedescendant');
          if (active >= 0) opts[active].li.classList.remove('active');
          active = -1;
        };
        var choose = function (i) {
          closeList();
          if (!opts[i] || opts[i].value === String(B.cfg[key])) return;
          update(key, opts[i].value);
          field.set(B.cfg[key]); // update redraws every field but the one that changed
        };
        btn.addEventListener('click', function () { if (isOpen()) closeList(); else openList(); });
        btn.addEventListener('mouseenter', function () { if (!isOpen()) play(shown, B.cfg[key]); });
        btn.addEventListener('blur', closeList);
        btn.addEventListener('keydown', function (e) {
          var k = e.key;
          if (!isOpen()) {
            if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); openList(); }
            return;
          }
          if (k === 'ArrowDown') setActive(Math.min(opts.length - 1, active + 1), true);
          else if (k === 'ArrowUp') setActive(Math.max(0, active - 1), true);
          else if (k === 'Home') setActive(0, true);
          else if (k === 'End') setActive(opts.length - 1, true);
          else if (k === 'Enter' || k === ' ') choose(active);
          else if (k === 'Escape') closeList();
          else if (k === 'Tab') { closeList(); return; }
          else if (k && k.length === 1 && /\S/.test(k)) {
            // the next option whose name starts with the letter typed, after the one the keys are on
            for (var n = 1; n <= opts.length; n++) {
              var j = (active + n) % opts.length;
              if (opts[j].label.charAt(0).toLowerCase() === k.toLowerCase()) { setActive(j, true); break; }
            }
          } else return;
          e.preventDefault();
        });
        opts.forEach(function (o, i) {
          // pressed, the button keeps the focus (and the list stays open until the click chooses)
          o.li.addEventListener('mousedown', function (e) { e.preventDefault(); });
          o.li.addEventListener('mouseenter', function () { setActive(i, true); });
          o.li.addEventListener('click', function () { choose(i); });
        });
        field.inputs.push(btn);
        field.set = function (v) {
          var i = indexOf(v);
          stopDecode(shown);
          shown.textContent = i >= 0 ? opts[i].label : String(v);
          opts.forEach(function (o, j) { o.li.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
        };
        field.setDisabled = function (off) {
          if (off) closeList();
          btn.disabled = off;
          if (off) row.classList.add('disabled'); else row.classList.remove('disabled');
        };
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
        sv.inputMode = m.scale > 1 ? 'decimal' : 'numeric';
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
          sv.value = typing ? stepText(key, v) : valueText(key, v);
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
        // A step from `from` to n (over line_width's gap, or from text_px's 0: skipGap). say: the Fewer / More buttons
        // keep the focus, so the new value is spoken through the status region.
        var jump = function (from, n, say) {
          clearTimeout(stt);
          update(key, skipGap(key, from, n, B.cfg));
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
          // Within min..max before config.coerce reads it: with a scale, a number under min is a ratio (29 is 29:1, so
          // ArrowDown at readable_level's 3.0:1 would go to 7.0:1).
          if (e.key === 'ArrowUp') n = Math.min(spec.max, cur + 1);
          else if (e.key === 'ArrowDown') n = Math.max(spec.min, cur - 1);
          else if (e.key === 'PageUp') n = stepValue(cur, 1, step, spec.min, spec.max);
          else if (e.key === 'PageDown') n = stepValue(cur, -1, step, spec.min, spec.max);
          else return;
          e.preventDefault();
          jump(cur, n);
        });
        less.addEventListener('click', function () { jump(B.cfg[key], stepValue(B.cfg[key], -1, step, spec.min, spec.max), true); });
        more.addEventListener('click', function () { jump(B.cfg[key], stepValue(B.cfg[key], 1, step, spec.min, spec.max), true); });
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
        fi.placeholder = m.placeholder || String(spec.def);
        var fh = addHelp(row, key, fi);
        field.helpEl = fh;
        var bad = h('p', 'status err', 'Use letters, numbers, spaces and dashes only.');
        bad.id = 'e-' + key;
        bad.hidden = true;
        row.appendChild(bad);
        // Google Fonts didn't load the name: a warning, not an error, as it may be a font installed on the streaming PC.
        var miss = h('p', 'status warn');
        miss.id = 'w-' + key;
        miss.hidden = true;
        row.appendChild(miss);
        // The help, then whichever of the two lines shows ('h-font' alone, as addHelp wrote it, while neither does).
        var describeFont = function () {
          fi.setAttribute('aria-describedby', (fh ? fh.id : '') + (bad.hidden ? '' : ' ' + bad.id) + (miss.hidden ? '' : ' ' + miss.id));
        };
        var showBadFont = function (ok) {
          if (!ok && bad.hidden) announce(bad.textContent);
          bad.hidden = ok;
          fi.setAttribute('aria-invalid', ok ? 'false' : 'true');
          describeFont();
        };
        // Any name but a listed one is a guess at Google's spelling, which is case-sensitive ('Dm Serif Text' is refused,
        // 'DM Serif Text' loads), and the overlay then quietly draws its fallback font. So the builder asks Google Fonts
        // for it too, in the weights the overlay asks for (config.fontWeights: Google refuses a request naming none of a
        // family's weights, so Sunflower, without 400, loads only in those): a stylesheet for print, fetched but never
        // applied, and removed once it answers. again: ask even if the miss line already speaks for this name (it was
        // committed once more). A weight setting that changes the weights asks again (B.fontProbes).
        var probeSeq = 0, probed = null;
        var probeFont = function (name, again) {
          var weights = config.fontWeights(B.cfg), asked = name + ':' + weights;
          if (asked === probed && !again) return;
          probed = asked;
          var seq = ++probeSeq;
          if (!miss.hidden) { miss.hidden = true; describeFont(); }
          if (!name || config.isSystemFont(name) || config.isKnownFont(name) || B.fontsOk[asked]) return;
          var link = document.createElement('link');
          var answer = function (ok) {
            if (link.parentNode) link.parentNode.removeChild(link);
            if (ok) B.fontsOk[asked] = true;
            if (ok || seq !== probeSeq) return;
            miss.textContent = 'Google Fonts didn’t load “' + name + '”. Check its spelling and capitals (such as DM, PT or SC), and ' +
              'the connection. Unless it is installed on the streaming PC, the overlay draws its fallback font.';
            miss.hidden = false;
            describeFont();
            announce(miss.textContent);
          };
          link.rel = 'stylesheet';
          link.media = 'print';
          link.addEventListener('load', function () { answer(true); });
          link.addEventListener('error', function () { answer(false); });
          link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') +
            ':wght@' + weights + '&display=swap';
          document.head.appendChild(link);
        };
        B.fontProbes.push(function () { probeFont(B.cfg[key]); });
        var timer = null;
        var commitFont = function (final) {
          clearTimeout(timer);
          var raw = fi.value.trim();
          if (!raw && final) raw = String(spec.def);
          // An emptied box is the default font again, or (spec.empty: name_font) '' itself.
          if (!raw && !spec.empty) return;
          // Google Fonts only loads the exact spelling: 'roboto' -> 'Roboto', 'press start 2p' -> 'Press Start 2P'.
          var ok = update(key, config.canonicalFont(raw));
          showBadFont(ok);
          if (ok && final) {
            fi.value = B.cfg[key];
            probeFont(B.cfg[key], true);
          }
        };
        // Debounced so the preview doesn't request a Google Font for every keystroke.
        fi.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { commitFont(false); }, 600); });
        fi.addEventListener('change', function () { commitFont(true); });
        field.inputs.push(fi);
        // A paste, Reset or settings.js: the error goes, from the description too, and a new name is checked.
        field.set = function (v) {
          clearTimeout(timer);
          fi.value = v;
          showBadFont(true);
          probeFont(v);
        };
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
        hex.placeholder = m.placeholder || m.swatch;
        var dflt = h('button', 'btn ghost', 'Default');
        dflt.type = 'button';
        // 'Default text color', but 'Default VIP color': an acronym keeps its capitals.
        var dl = labelFor(key);
        dflt.setAttribute('aria-label', 'Default ' + (/^[A-Z][a-z]/.test(dl) ? dl.charAt(0).toLowerCase() + dl.slice(1) : dl));
        crow.appendChild(pick);
        crow.appendChild(hex);
        crow.appendChild(dflt);
        var ch = addHelp(row, key, hex);
        field.helpEl = ch;
        // No one built-in color (name_color: each chatter's own): the picker's grey is described by the help too.
        if (m.placeholder && ch) pick.setAttribute('aria-describedby', ch.id);
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
      default: { // text: a list of names (block, highlight_users) or words (keywords), or one value (kick, kick_room, mixitup,
        // mixitup_port, command_prefixes)
        addLabel(true);
        var isList = spec.type === 'list' || spec.type === 'words';
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
          // words (keywords, block_words): a line under the box says when phrases were left out (empty, it isn't shown).
          var lcut = null;
          if (spec.type === 'words') {
            lcut = h('p', 'status warn');
            lcut.id = 'w-' + key;
            row.appendChild(lcut);
          }
          // While the line shows, it is part of the box's description (after the help), so a screen reader reads it
          // whenever it comes back to the box, not only in the one announcement. A warning, not an error: what is kept
          // is a valid list, so aria-invalid isn't set.
          var showCut = function (n) {
            var say = n ? (n === 1 ? '1 phrase was' : n + ' phrases were') + ' left out: up to 50 are used, each up to 40 characters.' : '';
            if (say && say !== lcut.textContent) announce(say);
            lcut.textContent = say;
            var desc = ((th ? th.id : '') + (say ? ' ' + lcut.id : '')).replace(/^ /, '');
            if (desc) li.setAttribute('aria-describedby', desc);
            else if (li.removeAttribute) li.removeAttribute('aria-describedby');
          };
          var queue = function () {
            clearTimeout(lt);
            lt = setTimeout(function () { update(key, li.value); }, 400);
          };
          li.addEventListener('input', queue);
          if (lcut) {
            // A list pasted one phrase a line (or a row of cells): the box is one line, and the browser would join the
            // lines with spaces into a single phrase no message has. Each line becomes a phrase of its own (pastedWords).
            li.addEventListener('paste', function (e) {
              var cd = e.clipboardData, v = li.value;
              var a = typeof li.selectionStart === 'number' ? li.selectionStart : v.length;
              var b = typeof li.selectionEnd === 'number' ? li.selectionEnd : a;
              var r = pastedWords(v, a, b, cd && cd.getData ? cd.getData('text/plain') : '');
              if (!r) return;
              e.preventDefault();
              // The browser's own insert keeps the paste in the box's undo (Ctrl+Z), and fires input as typing does.
              var ok = false;
              try {
                if (li.setSelectionRange) li.setSelectionRange(r.start, r.end);
                ok = !!(document.execCommand && document.execCommand('insertText', false, r.text));
              } catch (err) { ok = false; }
              if (ok) return;
              li.value = v.slice(0, r.start) + r.text + v.slice(r.end);
              try { li.setSelectionRange(r.start + r.text.length, r.start + r.text.length); } catch (err) { /* ignore */ }
              queue();
            });
          }
          li.addEventListener('change', function () {
            clearTimeout(lt);
            var typed = li.value;
            update(key, typed);
            li.value = (B.cfg[key] || []).join(', ');
            if (lcut) showCut(wordsLeftOut(key, typed, B.cfg[key]));
          });
          field.inputs.push(li);
          field.set = function (v) { li.value = (v || []).join(', '); if (lcut) showCut(0); };
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
        // Returns false when the value is refused (its error shows).
        var commitText = function (final) {
          clearTimeout(lt);
          var raw = li.value.trim();
          // kick_room takes the pasted channel page too: the chatroom id is read out of it.
          if (raw && m.parse === 'kickRoom') raw = kick.roomFromText(raw) || raw;
          // An emptied Command prefixes or Mix It Up port box is the default again once it is left or Enter is pressed (''
          // is no value for it); while it is still being typed in, it shows no error.
          if (!raw && (spec.type === 'chars' || key === 'mixitup_port')) {
            if (!final) { showBad(true); return true; }
            raw = String(spec.def);
          }
          var before = B.cfg[key];
          // A port is plain digits from 1024 to 65535, or refused: config.coerce would read '-1', '1e4' or '80' as a number
          // and move it into the range, and any other port than the one typed would never reach Mix It Up.
          var refused = key === 'mixitup_port' && !(/^\d{1,5}$/.test(raw) && +raw >= spec.min && +raw <= spec.max);
          var ok = !refused && update(key, raw);
          showBad(ok);
          if (ok && key === 'kick' && B.cfg.kick !== before) dropKickLookup();
          // A Mix It Up widget link names the port Mix It Up answers on (http://localhost:8112/overlay/…): it sets the
          // port as config.parse does, 8111 for a link without one. A bare id leaves the port as it is.
          var link = ok && key === 'mixitup' ? config.parseMixItUp(raw) : null;
          if (link && link.link && update('mixitup_port', link.port)) B.fields.mixitup_port.set(B.cfg.mixitup_port);
          // A Kick name or a widget refused as it is left: the URL keeps the last valid one, but the status line goes.
          if (!ok && final && key === 'kick') hushKick();
          if (!ok && final && key === 'mixitup') dropMixCheck(false);
          if (!ok || !final) return ok;
          li.value = String(B.cfg[key]);
          // Against the channel the chatroom id is for, not `before`: a pause in typing has usually committed the new
          // name already (commitText(false)), and the old id would stay with it.
          if (key === 'kick' && (B.cfg.kick !== B.kickFor || B.kickDropped)) onKickChanged(B.kickFor);
          return true;
        };
        li.addEventListener('input', function () {
          clearTimeout(lt);
          lt = setTimeout(function () { commitText(false); }, 600);
        });
        li.addEventListener('change', function () { commitText(true); });
        li.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commitText(true); } });
        field.inputs.push(li);
        field.set = function (v) { li.value = String(v || ''); showBad(true); };
        if (m.check) {
          var cbtn = h('button', 'btn', 'Check');
          cbtn.type = 'button';
          rowc.appendChild(cbtn);
          var kst = h('div', 'status');
          kst.setAttribute('role', 'status');
          kst.setAttribute('aria-live', 'polite');
          row.appendChild(kst);
          field.statusEl = kst;
          if (key === 'kick') {
            // A refused name looks nothing up: B.cfg still holds the previous channel. A new name's lookup has already
            // started as it was committed (onKickChanged), so it isn't asked for twice. A mouse press leaves the box
            // first (its change commits the name), and kick.com may answer before the button comes up: a lookup started
            // since the press is this Check's too. The keyboard (detail 0) has no press, so it looks up as before.
            var pressAsked = -1;
            cbtn.addEventListener('mousedown', function () { pressAsked = B.kickAsked; });
            cbtn.addEventListener('click', function (e) {
              var pressed = !!(e && e.detail > 0) && pressAsked >= 0 && B.kickAsked !== pressAsked;
              pressAsked = -1;
              if (commitText(true) && kst.className !== 'status busy' && !pressed) checkKick(true);
            });
          } else {
            // Mix It Up is asked only from here, never as a link is pasted or the page opens: the browser may ask to
            // allow access to local devices, which should come with a press of Check. A refused link checks nothing.
            cbtn.addEventListener('click', function () { if (commitText(true)) checkMixItUp(); });
          }
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
    // What a greyed-out field waits for, under its label (syncDisabled fills it in). A switch in a grid has the
    // grid's one line instead (buildGroups).
    if (m.when && !subgridOf(key)) {
      field.needsEl = h('p', 'needs');
      field.needsEl.hidden = true;
      row.insertBefore(field.needsEl, head.nextSibling);
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

  // A sub-heading that opens and closes the fields under it (GROUPS fold): a button, which counts the settings under it
  // that are off their defaults while they are out of sight, and the part they go in. Closed, that part is hidden
  // until-found: the browser's find in page still finds a setting in it, and opens it (beforematch).
  function foldPart(g, s) {
    var id = g.id + '-' + s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    var head = h('h3', 'eyebrow subhead fold');
    var btn = h('button', 'fold-btn');
    btn.type = 'button';
    btn.setAttribute('aria-controls', 'fold-' + id);
    // The chevron is drawn by css/builder.css (.fold-btn::before), so the page needs no inline SVG here.
    btn.appendChild(h('span', 'fold-name', s.title));
    var count = h('span', 'count');
    count.setAttribute('aria-hidden', 'true');
    btn.appendChild(count);
    head.appendChild(btn);
    var body = h('div', 'fold-body');
    body.id = 'fold-' + id;
    var part = { id: id, title: s.title, head: head, btn: btn, count: count, body: body, keys: [] };
    btn.addEventListener('click', function () {
      setFold(part, !B.ui.folds[id]);
      saveUi();
    });
    body.addEventListener('beforematch', function () {
      setFold(part, true);
      saveUi();
    });
    if (typeof B.ui.folds[id] !== 'boolean') B.ui.folds[id] = !!s.open;
    B.folds[id] = part;
    setFold(part, B.ui.folds[id]);
    return part;
  }

  function setFold(part, open) {
    B.ui.folds[part.id] = open;
    part.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    // A browser that doesn't know until-found reads it as plain hidden.
    part.body.hidden = open ? false : 'until-found';
    syncFoldCount(part);
  }

  // The count on a closed sub-heading: its settings off their defaults (open, each field's own tag says so). In its
  // name too, as the rail's tabs do.
  function syncFoldCount(part, changed) {
    changed = changed || changedKeys(B.cfg);
    var n = B.ui.folds[part.id] ? 0 : part.keys.filter(function (k) { return changed[k] === true; }).length;
    part.count.textContent = n ? String(n) : '';
    part.btn.setAttribute('aria-label', part.title + (n ? ', ' + n + ' changed' : ''));
  }

  // The Kick channel's field (META.top) sits in the top bar beside Twitch's, so a multistreamer sets both in one place.
  // It is the same field (one value, one status line, one Check), drawn the way the Twitch one is: the logo and a short
  // name as its label, the help for assistive tech only (the bar has no room for it; the Kick & YouTube tab says it).
  function toTopBar(f) {
    var row = f.row, logo = row.querySelector('.logo');
    row.className = 'ch ch-' + f.key;
    clear(f.labelEl);
    f.labelEl.className = 'ch-label';
    if (logo) f.labelEl.appendChild(logo);
    f.labelEl.appendChild(h('span', 'ch-name', 'Kick'));
    f.labelEl.appendChild(h('span', 'sr-only', ' channel'));
    // Its tag stays up to date (syncTags) but out of the page: the bar names no settings.
    if (f.tag.parentNode) f.tag.parentNode.removeChild(f.tag);
    if (f.helpEl) f.helpEl.parentNode.hidden = true;
    $('channel-card').appendChild(row);
  }

  // Where the Kick channel went, at the top of Kick's part of its tab: a button there.
  function kickPointer() {
    var p = h('p', 'help kick-pointer span-all');
    p.appendChild(document.createTextNode('Your Kick channel goes in the top bar, beside Twitch’s. Its Check fills in the chatroom id below. '));
    var b = h('button', 'help-more', 'Go to Kick channel');
    b.type = 'button';
    b.addEventListener('click', function () {
      var input = B.fields.kick.inputs[0];
      input.focus();
      if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' });
    });
    p.appendChild(b);
    return p;
  }

  // Above the Mix It Up widget's field: how to get its link, which is all the setup there is.
  var MIXITUP_STEPS = [
    'In Mix It Up, connect your YouTube channel, and connect Overlay (both on the Services page).',
    'Under Overlay Widgets, add a Chat widget. Set Display Option to Single Widget URL, leave Platforms on YouTube (or all), and enable it.',
    'Copy the widget’s link and paste it into the field below.',
    'Don’t add that link to OBS: it is only where the overlay reads chat from. OBS gets the overlay URL, as usual.'
  ];
  var MIXITUP_NOTE = 'Mix It Up checks YouTube every 5 to 10 seconds, so YouTube lines arrive a few seconds late. The overlay ' +
    'needs to run on the same PC as Mix It Up, as it does in OBS on that PC.';
  function mixitupSteps() {
    var box = h('div', 'help mixitup-steps span-all');
    box.appendChild(h('p', null, 'YouTube chat comes through the Mix It Up app, from a Chat widget’s link:'));
    var ol = h('ol');
    MIXITUP_STEPS.forEach(function (s) { ol.appendChild(h('li', null, s)); });
    box.appendChild(ol);
    box.appendChild(h('p', null, MIXITUP_NOTE));
    return box;
  }

  // The foot of a section whose finer settings are under an Advanced sub-heading. A plain click goes there the
  // way a tab does, with no history entry: a followed #adv-... link would leave one that Back returns from to
  // the bare builder.html, which names no section, so Back would leave Advanced open (at the scroll spot of the
  // page before) and only a second Back would leave. Ctrl-, Shift- or middle-click still open the link anew.
  function moreLink(id) {
    var p = h('p', 'section-foot');
    var a = h('a', 'btn ghost', 'More in Advanced');
    var href = '#' + id;
    a.href = href;
    a.addEventListener('click', function (e) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      try {
        root.history.replaceState(root.history.state, '', String(root.location.href).split('#')[0] + href);
      } catch (err) { /* not allowed here: the address stays as it is */ }
      // replaceState fires no hashchange (nor would a hash the address bar already shows), so it opens here.
      if (openHashSection(href)) saveUi();
    });
    p.appendChild(a);
    return p;
  }

  // The Quick look row at the top of Look: a button per look (the one the settings are at is pressed), and Undo,
  // hidden until a click changes the look (shown but off, it read as a sixth look). Undo sits at the end of the
  // label's line, which is there either way: among the looks it wrapped onto a row of its own and pushed the page
  // down under the pointer. Like a field, without a setting's name: it is no setting of its own.
  function buildPresets() {
    var row = h('div', 'field field-presets span-all');
    var head = h('div', 'field-head'), name = h('div', 'field-name');
    name.appendChild(h('span', 'field-label', 'Quick look'));
    head.appendChild(name);
    var btns = h('div', 'btns field-control');
    btns.setAttribute('role', 'group');
    btns.setAttribute('aria-label', 'Quick look');
    btns.setAttribute('aria-describedby', 'h-presets');
    B.presetBtns = {};
    PRESETS.forEach(function (p) {
      var b = h('button', 'btn', p.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { applyPreset(p.id); });
      btns.appendChild(b);
      B.presetBtns[p.id] = b;
    });
    var undo = h('button', 'preset-undo', 'Undo');
    undo.type = 'button';
    undo.setAttribute('aria-label', 'Undo quick look');
    undo.disabled = true;
    undo.hidden = true;
    undo.addEventListener('click', undoPreset);
    name.appendChild(undo);
    B.presetUndoBtn = undo;
    head.appendChild(btns);
    row.appendChild(head);
    row.appendChild(helpBlock('h-presets', PRESETS_HELP, 'Quick look'));
    return row;
  }

  // One tab in the rail and one section in the panel per group. "Add to OBS" is in builder.html already, under them.
  function buildGroups() {
    var host = $('groups'), tabs = $('tab-groups');
    clear(host);
    B.subheads = Object.create(null);
    B.folds = Object.create(null);
    B.gridNeeds = Object.create(null);
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
      tabs.appendChild(tab);

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
      if (g.id === 'look') body.appendChild(buildPresets());
      var heads = Object.create(null), grids = Object.create(null);
      g.subs.forEach(function (s) { heads[s.first] = s; });
      // Where the next field goes: the section's fields, or (g.fold) the part under the sub-heading above it.
      var into = body, fold = null;
      g.keys.forEach(function (key) {
        if (heads[key]) {
          if (g.fold) {
            fold = foldPart(g, heads[key]);
            body.appendChild(fold.head);
            body.appendChild(fold.body);
            into = fold.body;
          } else {
            body.appendChild(subhead(g, heads[key]));
          }
        }
        if (fold) fold.keys.push(key);
        var f = buildField(key);
        B.fields[key] = f;
        var sg = subgridOf(key);
        if (key === 'mixitup') into.appendChild(mixitupSteps());
        if (META[key] && META[key].top) {
          toTopBar(f);
          into.appendChild(kickPointer());
        } else if (sg) {
          if (!grids[sg]) {
            grids[sg] = h('div', 'subgrid');
            grids[sg].setAttribute('role', 'group');
            grids[sg].setAttribute('aria-label', SUBGRIDS[sg].label);
            // The grid's switches wait for the same one: one line says what (syncDisabled), above them.
            var gn = h('p', 'needs');
            gn.hidden = true;
            grids[sg].appendChild(gn);
            B.gridNeeds[sg] = gn;
            into.appendChild(grids[sg]);
          }
          f.row.className += ' sub';
          grids[sg].appendChild(f.row);
        } else {
          into.appendChild(f.row);
        }
        if (g.after[key]) into.appendChild(h('p', 'help part-foot span-all', g.after[key]));
      });
      Object.keys(grids).forEach(function (sg) {
        if (SUBGRIDS[sg].help) grids[sg].appendChild(helpBlock('h-' + sg + '-grid', SUBGRIDS[sg].help, SUBGRIDS[sg].label));
      });
      sec.appendChild(body);
      if (g.foot) sec.appendChild(h('p', 'help section-foot', g.foot));
      if (g.more) sec.appendChild(moreLink(g.more));
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
    if (id === OBS_SECTION) B.ui.obsSeen = true;
    // The note beside the URL points to Add to OBS only while it is closed, and says what comes next until it has
    // been open once. (Not before the first render of the URL, which writes the note.)
    if (B.url) renderNote();
    var tab = $('tab-' + id);
    if (!tab) return;
    if (focusTab) tab.focus();
    showTab();
  }

  // Keep the chosen tab in view. In one column the tabs can be a row that scrolls sideways; in the app
  // layout the settings' tabs scroll when the window leaves them too little height (Add to OBS, pinned
  // under them, is always in view). The page itself stays put.
  function showTab() {
    var tab = $('tab-' + B.ui.section), list = $('tabs');
    if (!tab || !list) return;
    if (list.scrollWidth > list.clientWidth) {
      var left = tab.offsetLeft - list.offsetLeft, right = left + tab.offsetWidth;
      if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - 16);
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 16;
    }
    var rail = $('tab-groups');
    if (rail.contains(tab) && rail.scrollHeight > rail.clientHeight) {
      var r = rail.getBoundingClientRect(), t = tab.getBoundingClientRect();
      if (t.top < r.top + RAIL_FADE) rail.scrollTop -= r.top + RAIL_FADE - t.top;
      else if (t.bottom > r.bottom - RAIL_FADE) rail.scrollTop += t.bottom - r.bottom + RAIL_FADE;
    }
    railEdges();
  }

  // Tabs too many for their window fade out at the edge they run on past (css/builder.css .more-above,
  // .more-below): they have no scrollbar, and a cut row of tabs alone does not say there are more.
  function railEdges() {
    var rail = $('tab-groups'), more = rail.scrollHeight - rail.clientHeight;
    var above = more > 1 && rail.scrollTop > 1, below = more > 1 && rail.scrollTop < more - 1;
    if (above) rail.classList.add('more-above'); else rail.classList.remove('more-above');
    if (below) rail.classList.add('more-below'); else rail.classList.remove('more-below');
  }

  // builder.html#obs and the like. In one column the settings are below the preview, so the page goes to
  // them; the app layout shows both. False when the hash names no section. hash: the address bar's when left out.
  function openHashSection(hash) {
    if (hash === undefined) hash = root.location.hash;
    var s = sectionFromHash(hash);
    if (!s) return false;
    selectSection(s, false);
    var main = $('settings');
    if (!isAppLayout() && main && main.scrollIntoView) main.scrollIntoView();
    showSubhead(hash);
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
    $('tab-groups').addEventListener('scroll', railEdges);
    list.addEventListener('scroll', rowEdges, { passive: true });
    // The one-column row scrolls sideways, which a mouse wheel cannot: over the row it turns the wheel sideways, until
    // the row's end, where the page scrolls on as before. A trackpad's sideways swipe, and Shift with the wheel, are
    // left to the browser.
    list.addEventListener('wheel', function (e) {
      var more = list.scrollWidth - list.clientWidth;
      if (isAppLayout() || more <= 1 || e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? list.clientWidth : 1);
      if ((d < 0 && list.scrollLeft <= 0) || (d > 0 && list.scrollLeft >= more - 1)) return;
      e.preventDefault();
      list.scrollLeft += d;
    }, { passive: false });

    var mq = root.matchMedia ? root.matchMedia(APP_LAYOUT) : null;
    var orient = function () {
      list.setAttribute('aria-orientation', mq && mq.matches ? 'vertical' : 'horizontal');
      fitSoon();
    };
    if (mq && mq.addEventListener) mq.addEventListener('change', orient);
    else if (mq && mq.addListener) mq.addListener(orient);
    orient();
  }

  // Fields that only apply while another setting allows it (META.when, META.only): after every change.
  // A field of the other layout only (fieldAway) is hidden as well.
  function syncDisabled() {
    for (var k in B.fields) {
      var m = META[k];
      if (m && (m.when || m.only)) B.fields[k].setDisabled(fieldOff(k, B.cfg));
      if (m && m.only) B.fields[k].row.hidden = fieldAway(k, B.cfg);
      if (B.fields[k].needsEl) showWhyOff(B.fields[k].needsEl, whyParts(k, B.cfg), B.fields[k].helpEl);
    }
    for (var sg in B.gridNeeds) showWhyOff(B.gridNeeds[sg], whyParts(SUBGRIDS[sg].keys[0], B.cfg), null);
  }

  // A why-greyed-out line, each setting it names a link there. Written only when it changes. Where the help's first
  // line says it already, the line is left out and those words in the help become the links instead, so it isn't
  // said twice; they go back to plain text when the field applies again.
  function showWhyOff(el, parts, helpEl) {
    var why = parts ? parts.map(function (p) { return typeof p === 'string' ? p : p.text; }).join('') : '';
    var lead = helpEl && helpEl.firstChild && helpEl.firstChild.className === 'help-lead' ? helpEl.firstChild : null;
    var leadText = lead ? (lead._tcoText = lead._tcoText || lead.textContent) : '';
    var inHelp = !!why && leadText.indexOf(why) >= 0;
    if (lead) {
      var key = inHelp ? why : '';
      if (lead._tcoWhy !== key) {
        lead._tcoWhy = key;
        clear(lead);
        if (inHelp) {
          var at = leadText.indexOf(why);
          lead.appendChild(document.createTextNode(leadText.slice(0, at)));
          whyInto(lead, parts);
          lead.appendChild(document.createTextNode(leadText.slice(at + why.length)));
        } else lead.appendChild(document.createTextNode(leadText));
      }
    }
    var text = inHelp ? '' : why;
    if (el._tcoWhy !== text) {
      el._tcoWhy = text;
      clear(el);
      if (text) whyInto(el, parts);
    }
    el.hidden = !text;
  }

  function whyInto(el, parts) {
    parts.forEach(function (p) {
      if (typeof p === 'string') { el.appendChild(document.createTextNode(p)); return; }
      var b = h('button', 'help-more needs-link', p.text);
      b.type = 'button';
      b.setAttribute('aria-label', 'Go to ' + p.text);
      b.addEventListener('click', function () { goToSetting(p.key); });
      el.appendChild(b);
    });
  }

  // A "Needs …" link's target: its tab opened (and its folded sub-heading), the page scrolled to it, the focus on its
  // first control, and the row marked for a moment so the eye finds it. The channels are in the top bar.
  function goToSetting(key) {
    var f = B.fields[key];
    var input = key === 'channel' ? $('channel') : f && f.inputs[0];
    var row = key === 'channel' ? input && input.parentNode : f && f.row;
    if (!row) return;
    if (!(key === 'channel' || META[key] && META[key].top)) {
      for (var id in B.folds) if (B.folds[id].keys.indexOf(key) >= 0 && !B.ui.folds[id]) setFold(B.folds[id], true);
      var node = row;
      while (node && !(node.id && /^group-/.test(node.id))) node = node.parentNode;
      if (node) {
        var sec = node.id.replace(/^group-/, '');
        if (sec !== B.ui.section) { dropSectionHash(); selectSection(sec, false); }
      }
      saveUi();
    }
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    var to = input && !input.disabled ? input : row;
    if (to === row) row.tabIndex = -1;
    if (to.focus) to.focus({ preventScroll: true });
    row.classList.remove('arrived');
    void row.offsetWidth;
    row.classList.add('arrived');
    clearTimeout(row._tcoArrived);
    row._tcoArrived = setTimeout(function () { row.classList.remove('arrived'); }, 1600);
  }

  // Fields whose wording depends on the layout (META `horizontal`).
  function syncLabels() {
    for (var k in B.fields) {
      var f = B.fields[k];
      if (!f.labelEl || !META[k] || !META[k].horizontal) continue;
      var t = fieldText(k, B.cfg.layout);
      f.labelEl.textContent = t.label;
      if (f.helpEl) {
        var box = f.helpEl.parentNode;
        box._tcoAbout = t.label;
        setHelpText(box, t.help);
        box.hidden = !t.help;
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
    for (var id in B.folds) syncFoldCount(B.folds[id], changed);
  }

  function syncForm() {
    for (var k in B.fields) B.fields[k].set(B.cfg[k]);
    // Labels first: a layout's help text is written anew there, and syncDisabled then puts its Needs links back in.
    syncLabels();
    syncDisabled();
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
  // auto: filled in by the builder (the Kick chatroom id a lookup found), not edited.
  function update(key, raw, auto) {
    var v = config.coerce(key, raw);
    if (v === undefined) return false;
    if (sameValue(B.cfg[key], v)) return true;
    var prev = B.cfg[key];
    B.cfg[key] = v;
    if (key === 'layout') followLayout(prev, v);
    onChanged(key, auto);
    return true;
  }

  function onChanged(key, auto) {
    // A value the builder filled in is no change of the user's: a run of quick looks keeps its Undo (no look setting
    // was touched), and the note on what a settings.js did stays.
    if (!auto) {
      dropPresetUndo();
      dropResetUndo();
      B.fileNote = '';
    }
    syncDisabled();
    renderOutputs();
    saveCfg();
    // A weight may change the weights the font fields' check asks for (a paste, Reset or a quick look go through
    // syncForm, which checks again too).
    if (key === 'text_weight' || key === 'name_weight') B.fontProbes.forEach(function (fn) { fn(); });
    if (key === 'kick_room' && !auto) kickRoomByHand();
    // The empty channel field's line says whether another chat is set (any one will do).
    if (key === 'kick' || key === 'mixitup') renderChannelStatus();
    // A new widget or port: what the Mix It Up line said (or a check still out) was about the old one.
    if (key === 'mixitup' || key === 'mixitup_port') dropMixCheck(true);
    if (key === 'channel' || key === 'kick' || key === 'mixitup') { kickIdle(); mixIdle(); }
    if (isLiveKey(key)) postLive();
    else scheduleReload(RELOAD_DELAY);
  }

  // Swap the whole config (paste, reset, settings.js); reload only if a reload key changed.
  function replaceCfg(next) {
    var prev = B.cfg, reload = false;
    dropPresetUndo();
    dropResetUndo();
    ['font', 'name_font'].forEach(function (k) {
      if (typeof next[k] === 'string' && next[k]) next[k] = config.canonicalFont(next[k]);
    });
    B.cfg = next;
    B.fileNote = '';
    RELOAD_KEYS.forEach(function (k) { if (!sameValue(prev[k], next[k])) reload = true; });
    syncForm();
    if (prev.layout !== next.layout) followLayout(prev.layout, next.layout);
    $('channel').value = next.channel || '';
    // A whole config's chatroom id is for its own Kick channel. A new channel or chatroom id clears the status line
    // (it spoke of the old one), and a channel without an id is looked up, the same channel as before too.
    B.kickFor = next.kick;
    if (next.kick !== prev.kick || !sameValue(next.kick_room, prev.kick_room) || B.kickDropped) checkKick(false);
    // Mix It Up isn't asked here (only Check asks it): a new widget or port only clears what the line said of the old,
    // and once the page is up (a paste, Reset's undo, a settings.js), says Check tests the new one.
    if (next.mixitup !== prev.mixitup || next.mixitup_port !== prev.mixitup_port) dropMixCheck(B.started);
    if (next.channel !== B.ch.login || B.ch.state === 'bad') checkChannel(next.channel);
    else renderChannelStatus(); // the field was rewritten: nothing typed is pending any more
    kickIdle();
    mixIdle();
    renderOutputs();
    showTab(); // the counts just put on the tabs change their widths
    saveCfg();
    postLive();
    if (reload) scheduleReload(RELOAD_DELAY);
  }

  // ---------- quick looks ----------
  // Writes the PRESET_KEYS settings of vals over the current ones. Not replaceCfg: the channels and every other
  // setting stay as they are, nothing is looked up again, and as all of them are live keys the preview keeps its frame.
  function writePresetKeys(vals) {
    PRESET_KEYS.forEach(function (k) { B.cfg[k] = vals[k]; });
    B.fileNote = '';
    syncForm();
    renderOutputs();
    saveCfg();
    postLive();
  }

  // A quick look clicked. The settings from before the first click of a run are kept, so Undo goes back to them
  // however many looks were tried; a click that changes nothing (the look already on) leaves Undo as it is.
  function applyPreset(id) {
    var p = presetById(id);
    if (!p) return;
    var next = presetCfg(B.cfg, id);
    if (PRESET_KEYS.some(function (k) { return !sameValue(B.cfg[k], next[k]); })) {
      if (!B.presetUndo) {
        B.presetUndo = {};
        PRESET_KEYS.forEach(function (k) { B.presetUndo[k] = B.cfg[k]; });
      }
      dropResetUndo();
      writePresetKeys(next);
      B.presetUndoBtn.disabled = false;
      B.presetUndoBtn.hidden = false; // the focus stays on the look clicked
    }
    announce('Applied ' + p.label);
  }

  // Undo: the PRESET_KEYS settings as they were before the run, and only those. The button goes, so the focus
  // moves to the look now pressed, or the first.
  function undoPreset() {
    var snap = B.presetUndo;
    if (!snap) return;
    B.presetUndo = null;
    writePresetKeys(snap);
    B.presetUndoBtn.disabled = true;
    B.presetUndoBtn.hidden = true;
    focusPreset();
    announce('Quick look undone');
  }

  function focusPreset() {
    var b = B.presetBtns[presetOf(B.cfg)] || B.presetBtns[PRESETS[0].id];
    if (b && b.focus) b.focus();
  }

  // Any other change (a setting edited, a paste, Reset, a settings.js) ends the run: Undo would undo it too.
  function dropPresetUndo() {
    B.presetUndo = null;
    var u = B.presetUndoBtn;
    if (!u || u.disabled) return;
    var had = document.activeElement === u;
    u.disabled = true;
    u.hidden = true;
    if (had) focusPreset(); // a hidden button drops the focus to the page
  }

  // Undo reset goes with the next change too. If it had the focus, Reset beside it takes it.
  function dropResetUndo() {
    B.resetUndo = null;
    var u = $('reset-undo');
    if (!u || u.hidden) return;
    var had = document.activeElement === u;
    u.hidden = true;
    var r = $('reset');
    if (had && r.focus) r.focus();
  }

  // The look the settings are at is pressed. aria-pressed says so to assistive tech and draws it too (css/builder.css):
  // marked as a chosen segment is, not filled like the main button, so Copy URL stays the one purple fill.
  function syncPresets() {
    if (!B.presetBtns) return;
    var on = presetOf(B.cfg);
    PRESETS.forEach(function (p) {
      B.presetBtns[p.id].setAttribute('aria-pressed', p.id === on ? 'true' : 'false');
    });
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
    // Any chat will do: with a Kick channel or YouTube set, an empty Twitch field is optional, not missing. (Counted
    // without the Twitch channel, which a cleared field may still hold until it is committed.)
    var others = (B.cfg.kick ? 1 : 0) + (B.cfg.mixitup ? 1 : 0);
    var optional = st === 'empty' && others > 0;
    if ((st === 'empty' && !optional) || st === 'typed') input.classList.add('need'); else input.classList.remove('need');
    // A live region: the same line written again (Reset, a paste, Enter on a cleared field) is read out again.
    var found = st === 'found' ? B.ch.user : null;
    var key = st + '|' + (st === 'empty' || st === 'typed' ? '' : login) + (optional ? '|optional' + others : '') +
      (found ? '|' + found.displayName + '|' + !!found.banned + '|' + found.logo : '');
    if (key === B.chStatusKey) return;
    B.chStatusKey = key;
    clear(box);
    var cls = { empty: '', bad: 'err', checking: 'busy', found: 'ok', notfound: 'err', error: 'warn' }[st] || '';
    box.className = 'status' + (cls ? ' ' + cls : '');
    if (st === 'typed') {
      box.textContent = 'Press Enter or Check to look up the name.';
    } else if (st === 'empty') {
      box.textContent = optional ? optionalText('Twitch', others) : 'Enter your channel to see its emotes and badges.';
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
  // before: the channel the chatroom id was for (B.kickFor). An id typed in before there was a channel stays.
  function onKickChanged(before) {
    if (before && before !== B.cfg.kick && B.cfg.kick_room) {
      update('kick_room', '');
      B.fields.kick_room.set('');
    }
    checkKick(false);
  }

  // The Kick channel is being typed over: a lookup still out for the old name is dropped, so it can't fill in that
  // channel's chatroom id under the new one. It is done again if the old name is typed back (B.kickDropped).
  function dropKickLookup() {
    var box = B.fields.kick && B.fields.kick.statusEl;
    if (!box || box.className !== 'status busy') return;
    B.kickSeq++;
    B.kickDropped = true;
    clear(box);
    box.className = 'status';
  }

  // The line under the chatroom id (Kick & YouTube tab): how to copy it by hand, after Kick refused the lookup (checkKick).
  // null clears it. The top bar's status line has no room for the steps, so it links here.
  function kickRoomNote(node) {
    var f = B.fields.kick_room;
    if (!f) return;
    if (!f.noteEl) {
      f.noteEl = h('div', 'status warn');
      f.noteEl.setAttribute('role', 'status');
      f.noteEl.setAttribute('aria-live', 'polite');
      f.row.appendChild(f.noteEl);
    }
    clear(f.noteEl);
    if (node) f.noteEl.appendChild(node);
  }

  // A Kick name refused (Enter, leaving the field, Check): the status line goes, so it never speaks for a channel other
  // than the one in the box. A lookup still out is dropped, and done again once a valid name is committed.
  function hushKick() {
    var box = B.fields.kick && B.fields.kick.statusEl;
    if (!box) return;
    kickRoomNote(null);
    if (box.className === 'status busy') { dropKickLookup(); return; }
    clear(box);
    box.className = 'status';
    // With no Kick channel before it, the line that says one is optional stays.
    kickIdle();
  }

  // An empty channel field's line once another chat is set: name, the platform; others, how many chats are set.
  function optionalText(name, others) {
    return 'Optional: add ' + name + ' to show ' + (others > 1 ? 'all three' : 'both') + ' chats.';
  }

  // The Kick status line with nothing to report: with no Kick channel, that one is optional (any chat will do). With no
  // chat at all it says YouTube will do too, and links to its field on the Kick & YouTube tab (the top bar has none).
  function kickIdle() {
    var box = B.fields.kick && B.fields.kick.statusEl;
    if (!box || B.cfg.kick || box.className !== 'status') return;
    var others = (B.cfg.channel ? 1 : 0) + (B.cfg.mixitup ? 1 : 0);
    var text = others ? optionalText('Kick', others) : 'Or a Kick channel, or YouTube chat.';
    if (box.textContent === text) return;
    if (others) { box.textContent = text; return; }
    clear(box);
    box.appendChild(document.createTextNode('Or a Kick channel, or '));
    box.appendChild(youtubeLink());
    box.appendChild(document.createTextNode('.'));
  }

  // "YouTube chat" in the Kick line: opens the Kick & YouTube tab at the Mix It Up widget's field, as a Needs link does. A
  // link to #platforms, so that Ctrl- or middle-click open it anew.
  function youtubeLink() {
    var a = h('a', null, 'YouTube chat');
    var href = '#platforms';
    a.href = href;
    a.addEventListener('click', function (e) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      goToSetting('mixitup');
    });
    return a;
  }

  // Look up the Kick channel's chatroom id (kick.com's channel API) and fill in kick_room. Kick may refuse the
  // request from another site (Cloudflare): then the status line says how to copy the id by hand.
  // force: the Check button (looks up even when an id is already set).
  function checkKick(force) {
    var f = B.fields.kick;
    // From here kick_room and the status line are for this channel (commitText compares a new name with it).
    B.kickFor = B.cfg.kick;
    B.kickDropped = false;
    if (!f || !f.statusEl) return;
    var box = f.statusEl, slug = B.cfg.kick;
    var seq = ++B.kickSeq;
    clear(box);
    box.className = 'status';
    kickRoomNote(null);
    B.kickRefused = false;
    if (!slug) kickIdle();
    if (!slug || (B.cfg.kick_room && !force)) return;
    box.className = 'status busy';
    box.textContent = 'Looking up “' + slug + '” on Kick…';
    B.kickAsked++;
    // A lookup for this name still out (dropped as another name was typed, then the name typed back) is waited for, not
    // asked again. Its answer counts only for this call: seq says whether it is still wanted.
    var req = B.kickReq;
    if (!req || req.slug !== slug) {
      req = B.kickReq = { slug: slug, p: kick.lookupChannel(slug, { timeout: 8000 }) };
      var done = function () { if (B.kickReq === req) B.kickReq = null; };
      req.p.then(done, done);
    }
    req.p.then(function (c) {
      if (seq !== B.kickSeq) return;
      clear(box);
      if (!c) {
        box.className = 'status err';
        box.textContent = 'No Kick channel called “' + slug + '” was found.';
        return;
      }
      update('kick_room', c.chatroomId, true);
      B.fields.kick_room.set(B.cfg.kick_room);
      box.className = 'status ok';
      // The chatroom id is filled in on its tab, out of sight: the line says what was found, as Twitch's does.
      var t = h('span');
      t.appendChild(h('strong', null, c.username || slug));
      t.appendChild(document.createTextNode(' found.'));
      box.appendChild(t);
    }, function () {
      if (seq !== B.kickSeq) return;
      clear(box);
      box.className = 'status warn';
      B.kickRefused = true;
      // The steps go under the chatroom id on its tab (with the page to copy it from); this line links there.
      var t = h('span');
      // Short, so that it fits on one line under the box in the app layout's top bar.
      t.appendChild(document.createTextNode('Lookup refused. '));
      t.appendChild(roomLink());
      box.appendChild(t);
      var n = h('span');
      n.appendChild(document.createTextNode('Kick didn’t allow the lookup from this page. Open '));
      var a = h('a', null, 'the channel page');
      a.href = kick.apiUrl(slug);
      a.target = '_blank';
      a.rel = 'noopener';
      n.appendChild(a);
      n.appendChild(document.createTextNode(', then paste the whole page (or the number after "chatroom":{"id":) in this box.'));
      kickRoomNote(n);
    });
  }

  // The top bar's link to the chatroom id on the Kick & YouTube tab: opens the tab and puts the focus in the box.
  function roomLink() {
    var a = h('a', null, 'Add the chatroom id by hand');
    var href = '#platforms';
    a.href = href;
    a.addEventListener('click', function (e) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      selectSection('platforms', false);
      saveUi();
      var room = B.fields.kick_room.inputs[0];
      room.focus();
      if (room.scrollIntoView) room.scrollIntoView({ block: 'nearest' });
    });
    return a;
  }

  // A chatroom id put in by hand after a refused lookup: the steps are done, and the top bar says so.
  function kickRoomByHand() {
    if (!B.kickRefused || !B.cfg.kick_room) return;
    B.kickRefused = false;
    kickRoomNote(null);
    var box = B.fields.kick.statusEl;
    clear(box);
    box.className = 'status ok';
    box.textContent = 'Chatroom id added.';
  }

  // ---------- YouTube (Mix It Up) ----------
  // Mix It Up runs on this PC: it answers at once, or isn't there (ms). The first check of a page waits longer: the
  // browser may hold it while it asks whether this page may reach devices on the local network.
  var MIXITUP_TIMEOUT = 4000;
  var MIXITUP_FIRST_TIMEOUT = 10000;

  function mixBox() { return B.fields.mixitup && B.fields.mixitup.statusEl; }

  // The Mix It Up status line with nothing to report: with no widget and another chat set, YouTube is optional. With no
  // chat at all it is empty: the steps above say what goes in the field.
  function mixIdle() {
    var box = mixBox();
    if (!box || B.cfg.mixitup || box.className !== 'status') return;
    var others = (B.cfg.channel ? 1 : 0) + (B.cfg.kick ? 1 : 0);
    var text = others ? optionalText('YouTube', others) : '';
    if (box.textContent !== text) box.textContent = text;
  }

  // A new widget or port, or a link refused as the field is left: a check still out is dropped (its answer was about
  // the old one), and so is the line that spoke of the old one. ask: the widget is new, and the line says Check tests it.
  function dropMixCheck(ask) {
    var box = mixBox();
    if (!box) return;
    B.mixSeq++;
    clearTimeout(B.mixTimer);
    if (B.mixCtrl) B.mixCtrl.abort();
    B.mixCtrl = null;
    B.mixFor = '';
    clear(box);
    box.className = 'status';
    if (ask && B.cfg.mixitup) box.textContent = 'Press Check to test the connection to Mix It Up.';
    mixIdle();
  }

  // Check, beside the Mix It Up widget's field: asks Mix It Up for the widget's page (only its status is read). Mix It Up
  // answers 200 for an id it has (any widget, enabled or not), 400 for one it doesn't know, and nothing at all when it
  // isn't running, its Overlay service is off, or the browser keeps the page from this PC. Pressed again while the same
  // widget and port are being checked, that check answers for both presses; an answer about a widget or port since
  // changed is dropped (mixSeq).
  function checkMixItUp() {
    var box = mixBox(), guid = B.cfg.mixitup, port = B.cfg.mixitup_port;
    if (!box) return;
    if (!guid) {
      dropMixCheck(false);
      box.className = 'status warn';
      box.textContent = 'Paste the link of your Mix It Up Chat widget first.';
      return;
    }
    // The widget's page on this PC, as the overlay reads its chat (http://localhost:<port>/overlay/<guid>), or '' for a
    // value mixitup.js doesn't take: nothing else is ever asked.
    var url = mixitup.widgetUrl(guid, port);
    if (!url) return;
    var target = guid + ':' + port;
    if (box.className === 'status busy' && B.mixFor === target) return;
    dropMixCheck(false);
    var seq = B.mixSeq, done = false;
    var ctrl = B.mixCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    B.mixFor = target;
    box.className = 'status busy';
    box.textContent = 'Checking Mix It Up at localhost:' + port + '…';
    var away = 'Couldn’t reach Mix It Up at localhost:' + port + '. Is it running, and is Overlay connected on its Services ' +
      'page? If your browser asked to allow access to local devices, allow it, then press Check again.';
    // Once: a fetch aborted at the timeout fails after the line has said so.
    var answer = function (cls, text) {
      if (done || seq !== B.mixSeq) return;
      done = true;
      B.mixEnded = true;
      clearTimeout(B.mixTimer);
      if (B.mixCtrl === ctrl) B.mixCtrl = null;
      clear(box);
      box.className = 'status ' + cls;
      box.textContent = text;
    };
    B.mixTimer = setTimeout(function () {
      if (seq !== B.mixSeq) return;
      if (ctrl) ctrl.abort();
      answer('warn', away);
    }, B.mixEnded ? MIXITUP_TIMEOUT : MIXITUP_FIRST_TIMEOUT);
    var init = { cache: 'no-store', credentials: 'omit' };
    if (ctrl) init.signal = ctrl.signal;
    var p;
    try { p = Promise.resolve(fetch(url, init)); } catch (e) { p = Promise.reject(e); }
    p.then(function (res) {
      // The page itself is never read.
      try {
        if (res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(function () { /* ignore */ });
      } catch (e) { /* ignore */ }
      // 200 says only that Mix It Up has a widget with this id: not that it is a Chat widget, enabled, with YouTube.
      if (res.status === 200) {
        answer('ok', 'Mix It Up has this widget. If no YouTube lines show up, check that it is an enabled Chat widget and ' +
          'that YouTube is among its platforms.');
      } else if (res.status === 400) {
        answer('err', 'Mix It Up doesn’t know this widget. Copy the Chat widget’s link again.');
      } else {
        // Something else on that port (another app), or a Mix It Up that answers in a way it didn't use to.
        answer('warn', 'Something at localhost:' + port + ' answered, but not as Mix It Up does (HTTP ' + res.status +
          '). Check the Mix It Up port.');
      }
    }, function () { answer('warn', away); });
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
    // Copied, a warning still shows (a URL too long for the host, no channel, no Kick chatroom id): never a green "paste
    // it into OBS" over what is wrong with it.
    if (B.copied) note = copiedNote(note, B.cfg, B.ui);
    // What a settings.js on disk did at load, until the first change (a warning still comes first).
    else if (B.fileNote && note.cls !== 'warn') note = { text: B.fileNote, cls: 'ok' };
    // Until Add to OBS has been opened once, the note says what comes next.
    else if (note.cls !== 'warn' && !B.ui.obsSeen) note = nextNote(note);
    clear(n);
    // The note it stands in for, where the bar has room for it (css/builder.css .note-plain).
    if (note.plain) n.appendChild(h('span', 'note-plain', note.plain + ' '));
    if (note.parts) {
      // Both are written, and the width shows one (css/builder.css .note-short): a turned phone needs no new note.
      [['note-full', note.parts], ['note-short', note.short]].forEach(function (v) {
        var span = h('span', v[0]);
        v[1].forEach(function (p) { span.appendChild(typeof p === 'string' ? document.createTextNode(p) : h('strong', null, p[0])); });
        n.appendChild(span);
      });
      // The way to every step, unless they are open already. Until Add to OBS has been opened once, the link and
      // the rail's tab stand out a little more: that is where a first overlay goes wrong.
      if (B.ui.section !== OBS_SECTION) n.appendChild(obsLink(!B.ui.obsSeen));
    } else {
      n.textContent = note.text;
    }
    n.className = 'status' + (note.cls ? ' ' + note.cls : '');
    // Without a channel the URL only shows a hint in OBS: Copy URL stays (its note says what is missing) but outlined,
    // so the channel field that still wants a name is the one purple thing to act on.
    $('bar-copy').classList.toggle('alt', !chatOn(B.cfg));
    $('tab-obs').classList.toggle('nudge', B.copied && !!note.parts && !B.ui.obsSeen && B.ui.section !== OBS_SECTION);
  }

  // Before the first copy, the step after it is easy to miss: Add to OBS is the last tab. A line before the link to
  // it (renderNote), until Add to OBS has been opened once; the copied note says the rest. plain: the note it
  // replaces, still shown beside it in the app layout's bar.
  function nextNote(note) {
    var parts = ['Next: ', ['Copy URL'], ', then the '];
    return { plain: note.text, parts: parts, short: parts,
      text: note.text + ' Next: Copy URL, then the Add to OBS steps.', cls: 'next' };
  }

  // "Add to OBS steps" in the copied note. Opens the section as its tab does and takes the focus there (to the tab),
  // so the keyboard goes on from Add to OBS. A link to #obs, so that Ctrl- or middle-click open it anew.
  function obsLink(first) {
    var a = h('a', 'note-link' + (first ? ' first' : ''), 'Add to OBS steps'), href = '#' + OBS_SECTION;
    a.href = href;
    a.addEventListener('click', function (e) {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      dropSectionHash();
      selectSection(OBS_SECTION, true);
      var main = $('settings');
      if (!isAppLayout() && main && main.scrollIntoView) main.scrollIntoView();
      saveUi();
    });
    return a;
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
      // Add to OBS says why a URL that long won't load, and what to do instead (said aloud as it gets too long).
      var longNote = $('url-long'), tooLong = urlTooLong(url);
      if (longNote.hidden === tooLong) {
        longNote.hidden = !tooLong;
        if (tooLong) announce(URL_LONG_NOTE);
      }
    }
    var snippet = settingsSnippet(B.cfg), out = $('out-settings');
    if (out.textContent !== snippet) out.textContent = snippet;
    renderNote();
    syncTags();
    syncPresets();
  }

  function renderSizes() {
    var ws = document.querySelectorAll('.obs-w'), hs = document.querySelectorAll('.obs-h');
    for (var i = 0; i < ws.length; i++) ws[i].textContent = String(B.ui.w);
    for (var j = 0; j < hs.length; j++) hs[j].textContent = String(B.ui.h);
    if (B.copied) renderNote(); // the copied note names the size
  }

  // A button's words: its .lbl when it also holds an icon, else the button itself.
  function labelOf(btn) { return (btn.querySelector && btn.querySelector('.lbl')) || btn; }

  // A button says for a moment what it did. bad: it didn't (a copy the browser refused), so not in the done green.
  function flash(btn, text, bad) {
    if (!btn) return;
    var lbl = labelOf(btn);
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', lbl.textContent);
    lbl.textContent = text;
    btn.classList.add('flash');
    if (bad) btn.classList.add('fail'); else btn.classList.remove('fail');
    clearTimeout(btn._tcoTimer);
    btn._tcoTimer = setTimeout(function () {
      lbl.textContent = btn.getAttribute('data-label');
      btn.classList.remove('flash');
      btn.classList.remove('fail');
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
      flash(btn, ok ? 'Copied!' : 'Press Ctrl+C', !ok);
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

  // The note beside the URL once it is copied: the warning that still applies, or what to do next. Next are the two
  // things in OBS that most often go wrong: the source's size (the preview's, ui.w x ui.h), and the two boxes that
  // reconnect and wipe the chat on every scene switch, by the first words OBS gives them. parts: the text shown, a
  // [string] in bold; text: all of it as a screen reader says it (the boxes' whole names, "by" for the times sign).
  // With two or more chats the note says the one URL carries them all, so it doesn't read as Twitch's alone.
  function copiedNote(note, cfg, ui) {
    if (note.cls === 'warn') return { text: 'Copied. ' + note.text, cls: 'warn' };
    var lead = chatCount(cfg) > 1 ? 'Copied: ' + chatNames(cfg) + ' chat in one source. ' : 'Copied. ';
    return {
      parts: [lead + 'In OBS, add a Browser source at ', [ui.w + ' × ' + ui.h], ' and untick ', ['Shutdown source'], ' and ',
        ['Refresh browser'], '. '],
      // a phone's, in a line under the docked preview: the box names are in Add to OBS, where its link goes
      short: ['Copied. ', [ui.w + ' × ' + ui.h], ', untick 2 boxes. '],
      text: lead + 'In OBS, add a Browser source at ' + ui.w + ' by ' + ui.h + ', and untick Shutdown source when not visible ' +
        'and Refresh browser when scene becomes active.',
      cls: 'ok'
    };
  }

  // The URL was copied: the note beside it says what to do next, until the URL changes; a warning, until the button
  // resets. Either is said in place of the button's bare "Copied!" (announce keeps the later of the two), so a screen
  // reader hears it once.
  function noteCopied(ok) {
    if (!ok) return;
    B.copied = true;
    renderNote();
    var note = copiedNote(urlNote(B.cfg, B.ch, B.url), B.cfg, B.ui);
    announce(note.text);
    clearTimeout(B.copiedTimer);
    if (note.cls === 'warn') B.copiedTimer = setTimeout(function () { B.copied = false; renderNote(); }, FLASH_MS);
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
    // The demo draws Twitch lines beside a Kick channel's, and so their icons, which OBS never shows with Kick alone
    // (overlay.js showPlatforms counts the demo as a Twitch channel): the preview shows what OBS will, which counts
    // Twitch only with a channel or Demo messages on.
    if ((B.cfg.channel || B.cfg.demo ? 1 : 0) + (B.cfg.kick ? 1 : 0) + (B.cfg.mixitup ? 1 : 0) < 2) c.platform_icons = false;
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
      // With a Kick channel or YouTube alone, the demo still draws global emotes only (the overlay looks Kick up only
      // for live chat): no channel is missing, so the hint points to Live chat instead.
      if (pc.demo && (pc.kick || pc.mixitup) && !B.cfg.channel) {
        hint = (hint ? hint + ' ' : '') + (B.mode === 'live'
          ? 'Demo messages are switched on under Advanced, so the overlay shows fake chat.'
          : 'Demo chat with global emotes only. Switch to Live chat to watch your ' + chatNames(B.cfg) + ' chat.');
      } else if (pc.demo) hint = (hint ? hint + ' ' : '') + 'Demo chat with global emotes only. Enter a channel to preview its own emotes and badges.';
      else if (!pc.kick && !pc.mixitup) hint = (hint ? hint + ' ' : '') + 'Enter a channel (then press Enter) to watch its live chat here.';
    } else if (B.mode === 'live' && B.cfg.demo) {
      hint = 'Demo messages are switched on under Advanced, so the overlay shows fake chat.';
    }
    var modeEl = $('tag-mode'), mode = pc.demo ? 'demo' : 'live chat';
    if (modeEl.textContent !== mode) { modeEl.textContent = mode; fitSoon(); } // fit() picks how much of the tag line fits
    setHint(hint);
    if (!pc.channel && !pc.kick && !pc.mixitup && !pc.demo) setFrame(null, null);
    // Badge and paint data a source turned on later is loaded by the overlay when the setting arrives.
    else setFrame(previewSrc(pc, root.location.href), reloadSignature(pc));
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
  // From the tabs, not the rail, which is as tall as it is given; plus what the settings' tabs scroll out of view.
  function panelNeed() {
    var list = $('tabs'), rail = list.parentNode, groups = $('tab-groups');
    return Math.ceil(list.getBoundingClientRect().bottom - rail.getBoundingClientRect().top +
      Math.max(0, groups.scrollHeight - groups.clientHeight || 0) +
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
    dock(true);
    // Docked and hidden down to its bar: the frame keeps its last fit, for when it shows again.
    if (B.docked && B.ui.dockShut) {
      stage.style.height = '';
      $('dock-note').textContent = B.ui.w + ' × ' + B.ui.h;
      rowEdges();
      return;
    }
    var cs = root.getComputedStyle(stage);
    var padV = px(cs.paddingTop) + px(cs.paddingBottom);
    var aw = stage.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    var tagH = tag.offsetHeight;
    // (in the docked stage neither the tag line nor the hint is shown)
    var extra = tagH ? tagH + px(root.getComputedStyle(tag.parentNode).rowGap) : 0;
    if (!hint.hidden && hint.offsetHeight) extra += hint.offsetHeight + px(cs.rowGap);
    // In the app layout the window is shared out: top bar, the preview's own bar, this stage, the settings
    // (every tab of the rail, and Reset below it) and the URL bar.
    var room = wide && app ? root.innerHeight - document.querySelector('.top').offsetHeight -
      document.querySelector('.bar').offsetHeight - ($('preview').offsetHeight - stage.offsetHeight) - panelNeed() : null;
    // The docked stage takes its height from the stylesheet (--dock-h).
    stage.style.height = wide && !B.docked ? wideStageHeight(aw, padV + extra + px(cs.borderTopWidth) +
      px(cs.borderBottomWidth), B.ui.w, B.ui.h, root.innerHeight, room) + 'px' : '';
    var ah = stage.clientHeight - padV - extra;
    var s = fitScale(B.ui.w, B.ui.h, aw, ah);
    var cut = app ? null : cropView(B.cfg, B.ui.w, B.ui.h, aw, ah);
    if (cut) s = cut.s;
    var bw = cut ? cut.bw : Math.floor(B.ui.w * s), bh = cut ? cut.bh : Math.floor(B.ui.h * s);
    box.style.width = bw + 'px';
    box.style.height = bh + 'px';
    // A docked stage no taller than its frame needs (a row): the settings get the rest.
    var need = Math.ceil(bh + padV + extra + px(cs.borderTopWidth) + px(cs.borderBottomWidth));
    if (B.docked && need < stage.offsetHeight) stage.style.height = need + 'px';
    // A cut part: the source moved so that its chosen end is in the box, and the frame open on the edges it is cut on.
    var dx = 0, dy = 0, at = cut ? cut.at : '';
    if (at === 'right') dx = bw - B.ui.w * s;
    else if (at === 'middle') dx = (bw - B.ui.w * s) / 2;
    else if (at === 'bottom') dy = bh - B.ui.h * s;
    var frame = $('frame');
    frame.classList.toggle('cut-l', at === 'right' || at === 'middle');
    frame.classList.toggle('cut-r', at === 'left' || at === 'middle');
    frame.classList.toggle('cut-t', at === 'bottom');
    frame.classList.toggle('cut-b', at === 'top');
    if (B.frame) {
      B.frame.style.width = B.ui.w + 'px';
      B.frame.style.height = B.ui.h + 'px';
      B.frame.style.transform = (dx || dy ? 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px) ' : '') +
        (s < 1 ? 'scale(' + s + ')' : '') || 'none';
    }
    var note = $('scale-note'), pct = Math.round(s * 100) + '%', text = $('tag-text'), src = $('tag-src');
    var fw = bw, gap = px(root.getComputedStyle(tag).columnGap);
    var names = cut ? CROP_NAMES[at] : null;
    src.hidden = false;
    note.textContent = B.ui.w + ' × ' + B.ui.h + (names ? ' · ' + names[0] + ' at ' + pct : s < 1 ? ' · shown at ' + pct : ' · 100%');
    $('dock-note').textContent = note.textContent;
    // A frame too narrow for that line (a phone) gets the short note, and one too narrow even for that
    // drops the words "Browser source", so the tag is no wider than the frame.
    if (text.offsetWidth + gap + note.offsetWidth > fw) note.textContent = names ? names[1] + ' · ' + pct : s < 1 ? 'at ' + pct : '100%';
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
    rowEdges();
  }

  // One column: once the preview has gone off the top of the window, its stage is docked there in small (css/builder.css
  // .docked) and stays in view while the settings scroll under it; it undocks as its place comes back into view. That
  // place keeps its height meanwhile, so the page under it does not jump. noFit: called from fit(), which goes on to
  // fit the frame to the stage as it now is.
  function dock(noFit) {
    var app = $('builder'), prev = $('preview');
    if (!app || !prev) return;
    var want = !isAppLayout() && (B.docked ? prev.getBoundingClientRect().bottom <= 0
      : prev.getBoundingClientRect().bottom <= 0 && prev.offsetHeight > 0);
    if (want === !!B.docked) return;
    if (want) prev.style.height = prev.offsetHeight + 'px';
    else prev.style.height = '';
    B.docked = want;
    app.classList.toggle('docked', want);
    if (!noFit) fit();
  }

  function wireDock() {
    var btn = $('dock-toggle');
    var show = function () {
      $('builder').classList.toggle('dock-shut', !!B.ui.dockShut);
      btn.setAttribute('aria-expanded', B.ui.dockShut ? 'false' : 'true');
    };
    btn.addEventListener('click', function () {
      B.ui.dockShut = !B.ui.dockShut;
      show();
      fit();
      saveUi();
    });
    show();
    var queued = false;
    root.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      var run = function () { queued = false; dock(); };
      if (root.requestAnimationFrame) root.requestAnimationFrame(run); else setTimeout(run, 16);
    }, { passive: true });
  }

  // The one-column row of tabs fades at the end it runs on past (css/builder.css .tabs.more-left), as the rail does.
  function rowEdges() {
    var list = $('tabs'), more = list.scrollWidth - list.clientWidth;
    var row = !isAppLayout() && more > 1;
    list.classList.toggle('more-left', row && list.scrollLeft > 1);
    list.classList.toggle('more-right', row && list.scrollLeft < more - 1);
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
    // its name beside the swatches: its swatch's tooltip
    var name = $('bd-name'), label = null;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="backdrop"]'), function (r) {
      if (r.value === v) label = r.parentNode.getAttribute('title');
    });
    if (name && label) name.textContent = label;
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
    $('settings-copy').addEventListener('click', function () {
      copyText($('out-settings').textContent, $('settings-copy'), $('out-settings'));
    });
    $('settings-dl').addEventListener('click', function () {
      var ok = download('settings.js', $('out-settings').textContent);
      flash($('settings-dl'), ok ? 'Downloaded' : 'Download failed: copy it instead', !ok);
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
      var d = config.defaults(), before = copyCfg(B.cfg);
      CHANNEL_KEYS.forEach(function (k) { d[k] = B.cfg[k]; });
      var changes = config.KEYS.some(function (k) { return !sameValue(before[k], d[k]); });
      replaceCfg(d);
      flash($('reset'), 'Reset');
      // Undo reset is offered beside it until the next change. The focus stays on Reset.
      if (changes) {
        B.resetUndo = before;
        $('reset-undo').hidden = false;
        announce('Settings reset to their defaults. Undo reset is next.');
      }
    });
    $('reset-undo').addEventListener('click', function () {
      var snap = B.resetUndo;
      if (!snap) return;
      replaceCfg(snap); // which takes Undo reset away
      var r = $('reset');
      if (r.focus) r.focus();
      announce('Reset undone');
    });
  }

  // Local-file flow: opened from disk, show the settings.js route first and pick up an existing settings.js.
  // A settings.js the builder already loaded once doesn't replace the edits made here since (a snapshot of
  // it per folder says so); a new or changed settings.js does. hasQuery: a link's settings were applied, which a
  // settings.js doesn't replace; it is still read, so that once the link is gone from the address bar (dropQuery) a
  // reload doesn't take it for a new one and put it over the link's settings and the edits made since.
  function setupLocalFile(hasQuery, fromStore) {
    if (root.location.protocol !== 'file:') return;
    document.body.classList.add('is-file');
    setRoute('local');
    $('file-intro').hidden = false;
    $('file-url-note').hidden = false;
    var get = $('step-get-files');
    if (get) get.hidden = true;
    var s = document.createElement('script');
    s.src = 'settings.js?t=' + Date.now();
    s.onload = function () {
      var o = root.TCO_SETTINGS;
      if (!o || typeof o !== 'object') return;
      var fileCfg = config.parse('', o);
      var snap = JSON.stringify(config.toObject(fileCfg));
      var key = STORE_FILE_BASE + folderOf(root.location.pathname);
      if (hasQuery) { store(key, snap); return; }
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

  // The section the start-up link's hash opens (sectionFromHash), loc: the builder's location; '' for none. A section's
  // name is a valid login and phrase too, so it is the page's only where the overlay, reading the same query
  // (config.pageQuery), takes nothing from it: ?channel=x#obs, ?bots=1#badges and a bare #adv-text open their section,
  // but ?channel=#emotes names the channel emotes, and ?keywords=#events and ?keywords=c,#events have the keyword
  // #events, as on overlay.html.
  function linkSection(loc) {
    var s = loc ? sectionFromHash(loc.hash) : '';
    if (!s || !loc.search) return s;
    var read = function (q) { return JSON.stringify(config.parse(String(q || ''))); };
    return read(config.pageQuery(loc)) === read(loc.search) ? s : '';
  }

  // The query the builder starts from (startCfg), loc: its location. Read as the overlay reads its own (config.pageQuery):
  // a '#' typed in a value (text_color=#ff8800, keywords=c#, channel=#xqc, channel=#emotes) and what follows it are part
  // of the link. A section's or an Advanced heading's hash the overlay reads nothing from (?channel=x#obs, #adv-text) is
  // the page's: it opens that section (linkSection).
  function startSearch(loc) {
    if (!loc) return '';
    return linkSection(loc) ? String(loc.search || '') : config.pageQuery(loc);
  }

  function initialCfg() { return startCfg(startSearch(root.location), loadStored(STORE_CFG)); }

  // A link's settings are applied once, at start (then saved as the remembered ones). Left in the address bar, a reload,
  // a tab the browser restores or one opened from the page (More in Advanced with Ctrl) would apply them again, over
  // every change made since and over the remembered settings. A section's hash stays to open its section; any other
  // fragment was read as part of the link (startSearch), and goes with it. replaceState adds no history entry.
  function dropQuery() {
    var loc = root.location;
    if (!root.history || !loc) return;
    try {
      root.history.replaceState(root.history.state, '', loc.pathname + (linkSection(loc) ? loc.hash : ''));
    } catch (e) { /* not allowed here: the link stays, and a reload applies it again */ }
  }

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
      kickAsked: 0, // lookups checkKick has started (the Check button tells its own press's lookup from an earlier one)
      kickReq: null, // the kick.com lookup still out: { slug, p } (checkKick)
      kickFor: '', // the Kick channel kick_room and the Kick status line are for (checkKick, replaceCfg)
      kickDropped: false, // a lookup for kickFor was dropped while a new name was typed (dropKickLookup)
      kickRefused: false, // kick.com refused kickFor's lookup, and its tab says how to add the id by hand (checkKick)
      mixSeq: 0, // Mix It Up checks started or dropped: one still out answers only while it is the last (checkMixItUp)
      mixFor: '', // 'guid:port' the Mix It Up status line speaks of, or '' (checkMixItUp, dropMixCheck)
      mixCtrl: null, // the AbortController of the Mix It Up check still out
      mixTimer: null, // that check's timeout
      mixEnded: false, // a Mix It Up check has ended (answered or timed out): later ones wait MIXITUP_TIMEOUT, not the first's
      fontsOk: Object.create(null), // name + ':' + weights Google Fonts has loaded for the font fields' check (probeFont)
      fontProbes: [], // each font field's check of its current name, run again when the weights it asks for change
      chDraft: '',
      chStatusKey: '',
      chCache: new Map(),
      mode: 'demo',
      route: 'url',
      url: '',
      copied: false,
      copiedTimer: null,
      fileNote: '',
      // folds: a GROUPS fold sub-heading's id ('look-names') -> open, as last left (foldPart fills in the rest)
      // obsSeen: Add to OBS has been open in this browser (until then the note beside the URL says it is next, and
      // points to it harder: renderNote)
      // dockShut: the docked preview is hidden down to its bar (one column: dock)
      ui: { w: UI_DEFAULTS.w, h: UI_DEFAULTS.h, backdrop: UI_DEFAULTS.backdrop, section: UI_DEFAULTS.section, folds: {}, obsSeen: false,
        dockShut: false },
      frame: null,
      frameSig: null,
      reloadTimer: null,
      postTimer: null,
      fitQueued: false,
      docked: false, // one column: the stage is pinned to the top of the window (dock)
      tabsW: null,
      sayTimer: null,
      paused: false,
      storage: undefined,
      subheads: Object.create(null), // Advanced sub-heading id -> its <h3> (buildGroups)
      folds: Object.create(null), // a fold sub-heading's id -> its parts (foldPart)
      gridNeeds: Object.create(null), // a SUBGRIDS id -> the line saying what its switches wait for (buildGroups)
      presetBtns: null, // quick look id -> its button (buildPresets)
      presetUndoBtn: null,
      presetUndo: null, // the PRESET_KEYS settings from before a run of quick looks, while Undo is offered
      resetUndo: null, // the settings from before Reset, while Undo reset is offered
      started: false // start() is done: a hash from now on comes from the user
    };
    var u = loadStored(STORE_UI);
    if (u && typeof u === 'object') {
      B.ui.w = clampInt(u.w, SIZE_LIMITS.w[0], SIZE_LIMITS.w[1], UI_DEFAULTS.w);
      B.ui.h = clampInt(u.h, SIZE_LIMITS.h[0], SIZE_LIMITS.h[1], UI_DEFAULTS.h);
      if (BACKDROPS.indexOf(u.backdrop) >= 0) B.ui.backdrop = u.backdrop;
      if (typeof u.section === 'string' && sectionIds().indexOf(u.section) >= 0) B.ui.section = u.section;
      if (u.obs === true) B.ui.obsSeen = true;
      if (u.dock === false) B.ui.dockShut = true;
      if (u.folds && typeof u.folds === 'object') {
        Object.keys(u.folds).forEach(function (id) { if (typeof u.folds[id] === 'boolean') B.ui.folds[id] = u.folds[id]; });
      }
    }

    buildGroups();
    wireSections();
    wireChannel();
    wirePaste();
    wireOutputs();
    wirePreview();
    wireDock();
    renderSizes();
    // A link can open a section (builder.html#obs); otherwise the one that was open last time. A hash the link's last
    // value reads as its own (?channel=#emotes) opens none (linkSection).
    if (!linkSection(root.location) || !openHashSection()) selectSection(B.ui.section, false);

    var init = initialCfg();
    // Read before replaceCfg saves: stored settings from another folder's builder aren't "your changes" here.
    var ownStore = init.fromStore && folderOf(loadStored(STORE_CFG_PATH)) === folderOf(root.location.pathname);
    renderChannel();
    replaceCfg(init.cfg);
    if (init.fromQuery) dropQuery();
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
    ENTER_FRAMES: ENTER_FRAMES,
    decodeText: decodeText,
    GROUPS: GROUPS,
    BADGE_SUBS: BADGE_SUBS,
    EVENT_SUBS: EVENT_SUBS,
    SUBGRIDS: SUBGRIDS,
    PRESETS: PRESETS,
    PRESET_KEYS: PRESET_KEYS,
    DEMO_INERT: DEMO_INERT,
    LAYOUT_SIZES: LAYOUT_SIZES,
    TEXT_PX: TEXT_PX,
    RELOAD_KEYS: RELOAD_KEYS,
    GOOGLE_FONTS: GOOGLE_FONTS,
    SYSTEM_FONT_NAMES: SYSTEM_FONT_NAMES,
    APP_LAYOUT: APP_LAYOUT,
    isLiveKey: isLiveKey,
    groupLayout: groupLayout,
    overlayUrl: overlayUrl,
    previewUrl: previewUrl,
    previewSrc: previewSrc,
    MAX_URL_BYTES: MAX_URL_BYTES,
    urlTooLong: urlTooLong,
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
    cropView: cropView,
    describeIvrUser: describeIvrUser,
    startCfg: startCfg,
    startSearch: startSearch,
    linkSection: linkSection,
    changedKeys: changedKeys,
    tagText: tagText,
    groupCounts: groupCounts,
    urlParts: urlParts,
    urlNote: urlNote,
    valueText: valueText,
    stepText: stepText,
    parseStep: parseStep,
    wordsLeftOut: wordsLeftOut,
    pastedWords: pastedWords,
    stepValue: stepValue,
    skipGap: skipGap,
    segValues: segValues,
    sectionIds: sectionIds,
    sectionFromHash: sectionFromHash,
    advIds: advIds,
    fieldOff: fieldOff,
    fieldAway: fieldAway,
    whyOff: whyOff,
    helpParts: helpParts,
    subgridOf: subgridOf,
    widgetFor: widgetFor,
    presetCfg: presetCfg,
    presetOf: presetOf
  };
});
