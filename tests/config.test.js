'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../js/config.js');

describe('spec', () => {
  test('defaults match the plan', () => {
    const d = config.defaults();
    assert.deepEqual(d, {
      channel: '', kick: '', kick_room: '', platform_icons: true, size: 'medium', text_px: 0, font: 'Inter',
      text_weight: 'semibold', text_color: '', line_height: 135, text_case: 'none', shadow: 2,
      shadow_color: '', shadow_style: 'filter', outline: 0, outline_color: '',
      names: true, name_weight: 'heavy', name_line: false, name_font: '', name_color: '', name_fallback: '', name_sep: 'colon',
      bg: 0, bg_color: '', accent_bar: false, bg_shape: 'round', bg_width: 'fit', spacing: 'normal', layout: 'vertical', align: 'bottom',
      text_align: 'left', line_width: 0, pad_x: 8, edge_fade: 0, row_sep: 'none', animate: true, enter_style: 'slide',
      enter_ms: 180, fade: 0, fade_out_ms: 1000, exit_style: 'fade', smooth_scroll: false, max: 50, bots: false, hide_commands: false, command_prefixes: '!', block: [], block_words: [], allow_users: [],
      role_filter: 'all', min_length: 0, links: 'show',
      events: true, event_subs: true, event_gifts: true, event_raids: true, event_bits_badge: true, event_announcements: true,
      notice_color: '', notice_size: 85, replies: true, reply_style: 'full', first_msg: false, first_msg_color: '',
      history: 5, shared: true, timestamps: 'off', mentions: 'off', mention_color: '', keywords: [], highlight_users: [],
      keyword_color: '', points_highlight: true, points_color: '', role_style: 'off', broadcaster_color: '', mod_color: '',
      vip_color: '', gifs: true,
      gif_size: '3x', emotes_7tv: true, emotes_bttv: true, emotes_ffz: true, emote_scale: 100, emote_only: 'normal', giant_emotes: true,
      badges: true, badges_twitch: true, badges_kick: true, badges_7tv: true, badges_bttv: true, badges_ffz: true,
      badges_ffzap: true, badges_chatterino: true, badges_homies: true, homies_lists: 'all', badge_size: 100,
      paints: true, paint_images: 'animated', stv_lookup: true, readable: true, readable_level: 45, demo: false, debug: false
    });
    assert.deepEqual(config.KEYS, Object.keys(config.SPEC));
  });

  test('defaults() returns fresh copies', () => {
    const d = config.defaults();
    d.block.push('someone');
    assert.deepEqual(config.defaults().block, []);
    assert.deepEqual(config.SPEC.block.def, []);
  });

  test('LIVE_KEYS plus the reload keys partition every key', () => {
    // homies_lists: the Homies lists fill one index, which can't drop a list once it has loaded.
    const reload = ['channel', 'kick', 'kick_room', 'emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'stv_lookup', 'history', 'demo', 'debug',
      'homies_lists'];
    config.LIVE_KEYS.forEach((k) => assert.ok(config.SPEC[k], k + ' is not in SPEC'));
    reload.forEach((k) => assert.ok(!config.LIVE_KEYS.includes(k), k + ' must force a reload'));
    assert.deepEqual([...config.LIVE_KEYS, ...reload].sort(), [...config.KEYS].sort());
  });
});

describe('normalizeChannel', () => {
  test('accepts logins, @/# prefixes, whitespace and uppercase', () => {
    assert.equal(config.normalizeChannel('xqc'), 'xqc');
    assert.equal(config.normalizeChannel('XQC'), 'xqc');
    assert.equal(config.normalizeChannel('  Forsen  '), 'forsen');
    assert.equal(config.normalizeChannel('@xQc'), 'xqc');
    assert.equal(config.normalizeChannel('#caseoh_'), 'caseoh_');
    assert.equal(config.normalizeChannel('a'), 'a');
    assert.equal(config.normalizeChannel('a'.repeat(25)), 'a'.repeat(25));
  });

  test('accepts pasted twitch.tv URLs', () => {
    assert.equal(config.normalizeChannel('https://www.twitch.tv/xQc'), 'xqc');
    assert.equal(config.normalizeChannel('http://twitch.tv/xqc/'), 'xqc');
    assert.equal(config.normalizeChannel('https://m.twitch.tv/xqc?sr=a'), 'xqc');
    assert.equal(config.normalizeChannel('https://www.twitch.tv/xqc/videos'), 'xqc');
    assert.equal(config.normalizeChannel('HTTPS://WWW.TWITCH.TV/XQC#x'), 'xqc');
    assert.equal(config.normalizeChannel('twitch.tv/xqc'), 'xqc');
    assert.equal(config.normalizeChannel('www.twitch.tv/Plaqueboymax'), 'plaqueboymax');
    assert.equal(config.normalizeChannel('https://www.twitch.tv/popout/xqc/chat?popout='), 'xqc');
    assert.equal(config.normalizeChannel('https://www.twitch.tv/embed/xqc/chat?parent=example.com'), 'xqc');
    assert.equal(config.normalizeChannel('https://www.twitch.tv/moderator/xqc'), 'xqc');
    assert.equal(config.normalizeChannel('https://twitch.tv/popout'), 'popout', 'a channel literally named popout');
    assert.equal(config.normalizeChannel('https://www.twitch.tv/subs/xQc'), 'xqc', 'subscribe-page link');
    assert.equal(config.normalizeChannel('twitch.tv/subs/xqc?ref=x'), 'xqc');
    assert.equal(config.normalizeChannel('https://twitch.tv/subs'), 'subs', 'a channel literally named subs');
  });

  test('links that name no channel are rejected, not read as a channel', () => {
    assert.equal(config.normalizeChannel('https://www.twitch.tv/videos/2345678901'), '');
    assert.equal(config.normalizeChannel('twitch.tv/directory/category/just-chatting'), '');
    assert.equal(config.normalizeChannel('https://www.twitch.tv/videos'), 'videos', 'a bare channel link still works');
    assert.equal(config.normalizeChannel('videos'), 'videos');
  });

  test('rejects anything that is not a valid login', () => {
    ['', '   ', 'bad name', 'a'.repeat(26), 'x-y', 'xqc.tv', '<script>', 'https://kick.com/xqc', '@', '#'].forEach((v) => {
      assert.equal(config.normalizeChannel(v), '', JSON.stringify(v));
    });
    assert.equal(config.normalizeChannel(null), '');
    assert.equal(config.normalizeChannel(undefined), '');
  });
});

describe('normalizeKick', () => {
  test('accepts names, @names and kick.com links (incl. popout chat)', () => {
    assert.equal(config.normalizeKick('xqc'), 'xqc');
    assert.equal(config.normalizeKick('  XQC '), 'xqc');
    assert.equal(config.normalizeKick('@Adin_Ross'), 'adin_ross');
    assert.equal(config.normalizeKick('some-streamer'), 'some-streamer');
    assert.equal(config.normalizeKick('https://kick.com/xQc'), 'xqc');
    assert.equal(config.normalizeKick('https://www.kick.com/xqc/videos?x=1'), 'xqc');
    assert.equal(config.normalizeKick('kick.com/xqc#chat'), 'xqc');
    assert.equal(config.normalizeKick('https://kick.com/popout/xqc/chat'), 'xqc');
    assert.equal(config.normalizeKick(12345), '12345');
  });

  test('rejects anything that is not a Kick channel name', () => {
    ['', '   ', 'bad name', 'a'.repeat(41), 'xqc.tv', '<script>', '@', 'https://twitch.tv/xqc', null, undefined, true, {}]
      .forEach((v) => assert.equal(config.normalizeKick(v), '', JSON.stringify(v)));
  });

  test('kick and kick_room: empty is valid (no Kick), invalid falls back, booleans are rejected', () => {
    assert.equal(config.coerce('kick', ''), '');
    assert.equal(config.coerce('kick', '  '), '');
    assert.equal(config.coerce('kick', 'https://kick.com/XQC'), 'xqc');
    assert.equal(config.coerce('kick', 'bad name'), undefined);
    assert.equal(config.coerce('kick', true), undefined);
    assert.equal(config.coerce('kick_room', ''), '');
    assert.equal(config.coerce('kick_room', ' 668 '), '668');
    assert.equal(config.coerce('kick_room', 668), '668');
    assert.equal(config.coerce('kick_room', '12a'), undefined);
    assert.equal(config.coerce('kick_room', '-5'), undefined);
    assert.equal(config.coerce('kick_room', 1.5), undefined);
    assert.equal(config.coerce('kick_room', '1'.repeat(13)), undefined);
    assert.equal(config.coerce('kick_room', false), undefined);
  });

  test('an empty ?kick= clears a settings.js Kick channel; an invalid one keeps it', () => {
    const settings = { kick: 'xqc', kick_room: '668' };
    assert.equal(config.parse('', settings).kick, 'xqc');
    assert.equal(config.parse('kick=&kick_room=', settings).kick, '');
    assert.equal(config.parse('kick=&kick_room=', settings).kick_room, '');
    assert.equal(config.parse('kick=bad%20name', settings).kick, 'xqc');
    assert.equal(config.parse('Kick=Other&KICK_ROOM=5', settings).kick_room, '5');
  });

  // A second OBS source on a local folder, opened as overlay.html?kick=other: the settings.js chatroom id is xqc's, and
  // joining it showed xqc's Kick chat as the other channel's.
  test('a settings.js kick_room is left out when the URL names another Kick channel without an id of its own', () => {
    const settings = { kick: 'xqc', kick_room: '668' };
    assert.equal(config.parse('kick=other', settings).kick, 'other');
    assert.equal(config.parse('kick=other', settings).kick_room, '', 'looked up instead');
    assert.equal(config.parse('Kick=https://kick.com/Other', settings).kick_room, '');
    assert.equal(config.parse('kick=other&kick_room=12a', settings).kick_room, '', 'an invalid id of its own is none');
    assert.equal(config.parse('kick=other&kick_room=5', settings).kick_room, '5');
    // The same channel (in any spelling), an invalid name (the settings.js channel stays) or no kick in the URL: kept.
    ['', 'kick=XQC', 'Kick=https://kick.com/xqc', 'kick=bad%20name', 'channel=forsen'].forEach((q) =>
      assert.equal(config.parse(q, settings).kick_room, '668', q));
    // An id in settings.js without a channel stays, as in the builder.
    assert.equal(config.parse('kick=other', { kick_room: '668' }).kick_room, '668');
    assert.equal(config.parse('kick=other', { Kick: 'xqc', KICK_ROOM: '668' }).kick_room, '');
  });

  test('only a set Kick channel and room reach the URL and settings.js', () => {
    const cfg = config.defaults();
    assert.equal(config.toParams(cfg).toString(), '');
    assert.deepEqual(config.toObject(cfg), {});
    cfg.kick = 'xqc';
    cfg.kick_room = '668';
    cfg.platform_icons = false;
    assert.equal(config.toParams(cfg).toString(), 'kick=xqc&kick_room=668&platform_icons=0');
    assert.deepEqual(config.toObject(cfg), { kick: 'xqc', kick_room: '668', platform_icons: false });
  });
});

describe('coerce', () => {
  test('enum', () => {
    assert.equal(config.coerce('size', 'LARGE'), 'large');
    assert.equal(config.coerce('align', ' Top '), 'top');
    assert.equal(config.coerce('layout', ' Horizontal '), 'horizontal');
    assert.equal(config.coerce('layout', 'vertical'), 'vertical');
    assert.equal(config.coerce('layout', 'diagonal'), undefined);
    assert.equal(config.coerce('size', 'huge'), undefined);
    assert.equal(config.coerce('size', ''), undefined);
  });

  test('int: parses, clamps to range, rejects non-integers', () => {
    assert.equal(config.coerce('shadow', '3'), 3);
    assert.equal(config.coerce('shadow', ' 1 '), 1);
    assert.equal(config.coerce('shadow', '9'), 3);
    assert.equal(config.coerce('shadow', '-2'), 0);
    assert.equal(config.coerce('max', '0'), 1);
    assert.equal(config.coerce('max', '500'), 200);
    assert.equal(config.coerce('fade', '3600'), 3600);
    assert.equal(config.coerce('fade', '99999'), 3600);
    assert.equal(config.coerce('history', '101'), 100);
    assert.equal(config.coerce('bg', 50), 50);
    assert.equal(config.coerce('bg', 2.6), 3);
    ['1.5', 'abc', '', '10px', '0x10'].forEach((v) => assert.equal(config.coerce('shadow', v), undefined, JSON.stringify(v)));
    [NaN, Infinity, true, {}].forEach((v) => assert.equal(config.coerce('shadow', v), undefined, String(v)));
  });

  test('bool spellings', () => {
    ['1', 'true', 'TRUE', 'yes', 'Yes', 'on', 'ON', ' on ', true, 1].forEach((v) => {
      assert.equal(config.coerce('bots', v), true, JSON.stringify(v));
    });
    ['0', 'false', 'False', 'no', 'NO', 'off', 'Off', false, 0].forEach((v) => {
      assert.equal(config.coerce('bots', v), false, JSON.stringify(v));
    });
    ['2', 'maybe', '', 'null', 2, -1].forEach((v) => {
      assert.equal(config.coerce('bots', v), undefined, JSON.stringify(v));
    });
  });

  test('font: a safe family name only', () => {
    assert.equal(config.coerce('font', 'Comic Sans MS'), 'Comic Sans MS');
    assert.equal(config.coerce('font', '  Open   Sans '), 'Open Sans');
    assert.equal(config.coerce('font', 'Noto Sans JP'), 'Noto Sans JP');
    assert.equal(config.coerce('font', 'Press Start 2P'), 'Press Start 2P');
    ['Roboto;}body{', "Font'x", 'a"b', '-dash', 'a'.repeat(61), '', 'x<y'].forEach((v) => {
      assert.equal(config.coerce('font', v), undefined, JSON.stringify(v));
    });
  });

  test('name_font: a font name, or empty for the same font as `font` (font itself never takes empty)', () => {
    assert.strictEqual(config.SPEC.name_font.empty, true);
    assert.ok(!config.SPEC.font.empty);
    assert.equal(config.coerce('name_font', '  Press   Start 2P '), 'Press Start 2P');
    assert.equal(config.coerce('name_font', ''), '', 'same as font');
    assert.equal(config.coerce('name_font', '   '), '');
    assert.equal(config.coerce('font', ''), undefined);
    ['Roboto;}body{', 'a"b', '-dash', 'a'.repeat(61), 'x<y'].forEach((v) =>
      assert.equal(config.coerce('name_font', v), undefined, JSON.stringify(v)));
    // An empty one clears settings.js; an invalid one keeps it; at its default it is never written.
    assert.equal(config.parse('name_font=', { name_font: 'Bangers' }).name_font, '');
    assert.equal(config.parse('name_font=bad%3B', { name_font: 'Bangers' }).name_font, 'Bangers');
    assert.equal(config.toParams(config.defaults()).toString(), '');
    assert.equal(config.toParams(Object.assign(config.defaults(), { name_font: 'Open Sans' })).toString(), 'name_font=Open+Sans');
    assert.deepEqual(config.toObject(Object.assign(config.defaults(), { name_font: 'Bangers' })), { name_font: 'Bangers' });
  });

  test('names, timestamps and the reply header: their choices', () => {
    assert.deepEqual(config.SPEC.name_sep.values, ['colon', 'space', 'dash', 'arrow']);
    assert.equal(config.coerce('name_sep', 'Arrow'), 'arrow');
    assert.equal(config.coerce('name_sep', 'none'), undefined, 'space, never nothing');
    assert.deepEqual(config.SPEC.timestamps.values, ['off', '12h', '24h']);
    assert.equal(config.coerce('timestamps', '24H'), '24h');
    assert.equal(config.coerce('timestamps', 'on'), undefined);
    assert.deepEqual(config.SPEC.reply_style.values, ['full', 'name']);
    assert.equal(config.coerce('reply_style', 'NAME'), 'name');
    // readable_level: the contrast times 10, from 3:1 to 7:1. A number under 30 is the ratio itself, so 4.5 written
    // in settings.js or a URL is 45 (not 5, clamped to 3:1); 30 to 70 are the setting's own values.
    assert.equal(config.SPEC.readable_level.scale, 10);
    assert.deepEqual([45, '30', 71, '70', 30.4, '45.6'].map((v) => config.coerce('readable_level', v)), [45, 30, 70, 70, 30, 46]);
    assert.deepEqual([4.5, '4.5', ' 6.1 ', 5, '3', 2.9, 0, '0.5', 8, '21', -4].map((v) => config.coerce('readable_level', v)),
      [45, 45, 61, 50, 30, 30, 30, 30, 70, 70, 30]);
    ['4,5', '4.', '.5', '4.5:1', '1e1', 'x', ''].forEach((v) => assert.equal(config.coerce('readable_level', v), undefined, v));
    [true, null, NaN, Infinity].forEach((v) => assert.equal(config.coerce('readable_level', v), undefined, String(v)));
    assert.equal(config.parse('readable_level=4.5').readable_level, 45);
    assert.equal(config.parse('readable_level=6.5').readable_level, 65);
    // Only readable_level has a scale: every other int still takes whole numbers only.
    assert.deepEqual(config.KEYS.filter((k) => config.SPEC[k].scale !== undefined), ['readable_level']);
    assert.equal(config.coerce('bg', '4.5'), undefined);
    assert.equal(config.coerce('bg', 4.5), 5);
    assert.equal(config.coerce('name_color', '#F80'), 'ff8800');
    assert.equal(config.coerce('name_fallback', 'red'), undefined);
    assert.equal(config.toParams(Object.assign(config.defaults(), { name_sep: 'dash', timestamps: '12h', reply_style: 'name',
      readable_level: 60, name_color: 'ff8800', name_fallback: 'abcdef' })).toString(),
    'name_color=ff8800&name_fallback=abcdef&name_sep=dash&reply_style=name&timestamps=12h&readable_level=60');
  });

  test('highlights: their choices, live, and nothing in the URL at the defaults', () => {
    assert.deepEqual(config.SPEC.mentions.values, ['off', 'at', 'name']);
    assert.equal(config.coerce('mentions', 'AT'), 'at');
    assert.equal(config.coerce('mentions', 'on'), undefined);
    assert.deepEqual(config.SPEC.role_style.values, ['off', 'bar', 'tint']);
    assert.equal(config.coerce('role_style', 'name'), undefined, 'no name mode');
    assert.equal(config.coerce('points_highlight', '0'), false);
    assert.deepEqual(config.coerce('highlight_users', '@PaintedPal, kick_user'), ['paintedpal', 'kick_user'], 'logins, like block');
    ['mention_color', 'keyword_color', 'points_color', 'broadcaster_color', 'mod_color', 'vip_color'].forEach((k) => {
      assert.equal(config.SPEC[k].type, 'color', k);
      assert.equal(config.coerce(k, '#E91916'), 'e91916', k);
    });
    ['mentions', 'mention_color', 'keywords', 'highlight_users', 'keyword_color', 'points_highlight', 'points_color', 'role_style',
      'broadcaster_color', 'mod_color', 'vip_color'].forEach((k) => assert.ok(config.LIVE_KEYS.includes(k), k + ' is live'));
    assert.equal(config.toParams(config.defaults()).toString(), '');
    assert.equal(config.toParams(Object.assign(config.defaults(), { mentions: 'name', keywords: ['good game', 'gg'],
      highlight_users: ['a', 'b'], points_highlight: false, role_style: 'tint', vip_color: 'e005b9' })).toString(),
    'mentions=name&keywords=good+game%2Cgg&highlight_users=a%2Cb&points_highlight=0&role_style=tint&vip_color=e005b9');
    assert.deepEqual(config.toObject(Object.assign(config.defaults(), { keywords: ['gg'], points_highlight: false })),
      { keywords: ['gg'], points_highlight: false });
  });

  test('words: comma-separated words and phrases, trimmed, lowercased, deduped and capped', () => {
    assert.deepEqual(config.coerce('keywords', 'Good  Game, gg ,GG, overlay,,'), ['good game', 'gg', 'overlay']);
    assert.deepEqual(config.coerce('keywords', ' Tab\there\nnow '), ['tab here now'], 'any run of spaces is one space');
    assert.deepEqual(config.coerce('keywords', 'c++, a.b, (x), !!, ünïcode, 日本語'), ['c++', 'a.b', '(x)', '!!', 'ünïcode', '日本語']);
    // Arrays too (settings.js), and an item may hold commas of its own: the value reads back the same from the URL.
    assert.deepEqual(config.coerce('keywords', ['a,b', 'C', 5, '', true, { a: 1 }, ['x'], null]), ['a', 'b', 'c', '5']);
    assert.deepEqual(config.coerce('keywords', ''), [], 'an empty one clears settings.js');
    assert.deepEqual(config.parse('keywords=', { keywords: ['gg'] }).keywords, []);
    [true, false, null, undefined, { a: 1 }].forEach((v) => assert.equal(config.coerce('keywords', v), undefined, String(v)));
    // At most 50, each at most 40 characters (counted as characters, so an emoji is one); a longer one is left out.
    const many = Array.from({ length: 60 }, (_, i) => 'w' + i);
    assert.deepEqual(config.coerce('keywords', many.join(',')), many.slice(0, 50));
    assert.deepEqual(config.coerce('keywords', 'x'.repeat(41) + ',' + 'y'.repeat(40) + ',' + '😀'.repeat(40)),
      ['y'.repeat(40), '😀'.repeat(40)]);
    assert.equal(config.serialize('keywords', ['good game', 'gg']), 'good game,gg');
    assert.equal(config.serialize('keywords', undefined), '');
    const v = config.coerce('keywords', ['Good Game', 'gg!', 'a b c']);
    assert.deepEqual(config.coerce('keywords', config.serialize('keywords', v)), v);
    assert.deepEqual(config.parse(config.toParams(Object.assign(config.defaults(), { keywords: v }))).keywords, v);
    assert.equal(config.isDefault('keywords', []), true);
    assert.equal(config.isDefault('keywords', ['gg']), false);
  });

  test('filters and event switches: their values, live, and nothing in the URL at the defaults', () => {
    assert.deepEqual(config.SPEC.role_filter.values, ['all', 'subs', 'vips', 'mods']);
    assert.deepEqual(config.SPEC.links.values, ['show', 'shorten', 'hide']);
    assert.equal(config.coerce('role_filter', 'MODS'), 'mods');
    assert.equal(config.coerce('role_filter', 'subscribers'), undefined);
    assert.equal(config.coerce('links', 'Hide'), 'hide');
    assert.equal(config.coerce('links', 'remove'), undefined);
    assert.deepEqual([config.coerce('min_length', '150'), config.coerce('min_length', '-3'), config.coerce('min_length', '4')], [100, 0, 4]);
    assert.deepEqual(config.coerce('allow_users', '@PaintedPal, kick_user, bad name!'), ['paintedpal', 'kick_user', 'bad'],
      'logins, like block');
    assert.deepEqual(config.coerce('block_words', 'Spoiler, BAD  words'), ['spoiler', 'bad words'], 'words, like keywords');
    ['event_subs', 'event_gifts', 'event_raids', 'event_bits_badge', 'event_announcements'].forEach((k) => {
      assert.equal(config.SPEC[k].type, 'bool', k);
      assert.equal(config.SPEC[k].def, true, k);
      assert.equal(config.coerce(k, '0'), false, k);
    });
    ['event_subs', 'event_gifts', 'event_raids', 'event_bits_badge', 'event_announcements', 'role_filter', 'allow_users', 'block_words',
      'min_length', 'links', 'command_prefixes'].forEach((k) => assert.ok(config.LIVE_KEYS.includes(k), k + ' is live'));
    assert.equal(config.toParams(Object.assign(config.defaults(), { event_gifts: false, role_filter: 'vips', allow_users: ['a', 'b'],
      block_words: ['bad words', 'x'], min_length: 3, links: 'shorten', command_prefixes: '!#+' })).toString(),
    'command_prefixes=%21%23%2B&block_words=bad+words%2Cx&allow_users=a%2Cb&role_filter=vips&min_length=3&links=shorten&event_gifts=0');
    assert.deepEqual(config.toObject(Object.assign(config.defaults(), { command_prefixes: '?', event_raids: false })),
      { command_prefixes: '?', event_raids: false });
  });

  test('chars: command prefixes, signs from the allowed set only, each once, at most 8, spaces left out', () => {
    assert.equal(config.SPEC.command_prefixes.type, 'chars');
    assert.equal(config.SPEC.command_prefixes.def, '!');
    assert.equal(config.PREFIX_CHARS, '!$%&*+-./:;=?@#~^');
    assert.equal(config.MAX_PREFIXES, 8);
    assert.equal(config.coerce('command_prefixes', '!?'), '!?');
    assert.equal(config.coerce('command_prefixes', ' ! ? '), '!?', 'spaces are left out');
    assert.equal(config.coerce('command_prefixes', '!?!?!'), '!?', 'a repeat is dropped, the order kept');
    assert.equal(config.coerce('command_prefixes', '^-'), '^-');
    assert.equal(config.coerce('command_prefixes', config.PREFIX_CHARS.slice(0, 8)), '!$%&*+-.');
    assert.equal(config.coerce('command_prefixes', config.PREFIX_CHARS.slice(0, 9)), undefined, 'more than 8');
    ['', '  ', 'a', '!a', '!,', '\\', '[', '!¡', true, false, 5, null, undefined, { a: 1 }, ['!']].forEach((v) =>
      assert.equal(config.coerce('command_prefixes', v), undefined, JSON.stringify(v)));
    // Every allowed sign survives the URL: URLSearchParams writes # & + % as escapes, and reads them back.
    const all = config.PREFIX_CHARS.split('');
    for (let i = 0; i < all.length; i += 8) {
      const v = all.slice(i, i + 8).join('');
      const back = config.parse(config.toParams(Object.assign(config.defaults(), { command_prefixes: v })));
      assert.equal(back.command_prefixes, v);
      assert.equal(config.coerce('command_prefixes', config.serialize('command_prefixes', v)), v);
    }
    // A hand-written '+' in a URL is a space there, so it is lost; %2B keeps it.
    assert.equal(config.parse('command_prefixes=!+?').command_prefixes, '!?');
    assert.equal(config.parse('command_prefixes=!%2B').command_prefixes, '!+');
    assert.equal(config.parse('command_prefixes=', { command_prefixes: '?' }).command_prefixes, '?', 'empty is no value');
    assert.equal(config.isDefault('command_prefixes', '!'), true);
    assert.equal(config.isDefault('command_prefixes', '!?'), false);
  });

  test('color: hex, # optional, 3 or 6 digits, stored as bare lowercase rrggbb; empty is the built-in color', () => {
    assert.equal(config.coerce('text_color', 'FF8800'), 'ff8800');
    assert.equal(config.coerce('text_color', '#ff8800'), 'ff8800');
    assert.equal(config.coerce('text_color', ' #F80 '), 'ff8800');
    assert.equal(config.coerce('bg_color', 'abc'), 'aabbcc');
    assert.equal(config.coerce('notice_color', '#000000'), '000000');
    assert.equal(config.coerce('first_msg_color', ''), '', 'Default');
    assert.equal(config.coerce('first_msg_color', '  '), '');
    assert.equal(config.coerce('first_msg_color', '#'), '');
    ['red', 'ff88001a', '#ff88001a', 'ff88', '#ff880', 'ggg', '##fff', 'ff 880', 'rgb(1,2,3)', 'ff8800;}',
      'url(x)', 'var(--x)', true, false, 123456, 0].forEach((v) => assert.equal(config.coerce('text_color', v), undefined, JSON.stringify(v)));
    // Through the URL, and back out without a '#' (which would start the URL's fragment).
    assert.equal(config.parse('text_color=%23F80').text_color, 'ff8800');
    assert.equal(config.parse('text_color=F80').text_color, 'ff8800');
    assert.equal(config.parse('text_color=', { text_color: '00ff00' }).text_color, '', 'an empty one clears settings.js');
    assert.equal(config.parse('text_color=nope', { text_color: '00ff00' }).text_color, '00ff00');
    assert.equal(config.toParams(Object.assign(config.defaults(), { text_color: 'ff8800' })).toString(), 'text_color=ff8800');
    assert.equal(config.serialize('bg_color', ''), '');
    assert.equal(config.isDefault('bg_color', ''), true);
    assert.equal(config.isDefault('bg_color', '000000'), false, 'black picked is a choice, not the default');
  });

  test('text and name weights: six names, lightest first', () => {
    const w = ['light', 'regular', 'semibold', 'bold', 'heavy', 'black'];
    assert.deepEqual(config.SPEC.text_weight.values, w);
    assert.deepEqual(config.SPEC.name_weight.values, w);
    assert.equal(config.coerce('text_weight', 'Black'), 'black');
    assert.equal(config.coerce('name_weight', '800'), undefined, 'names, not numbers');
    assert.equal(config.coerce('line_height', '99'), 100);
    assert.equal(config.coerce('notice_size', 500), 150);
  });

  test('outline, shadow and the lighter-on-PC choices', () => {
    assert.equal(config.coerce('outline', 9), 3);
    assert.equal(config.coerce('outline', '-1'), 0);
    assert.equal(config.coerce('shadow_style', 'TEXT'), 'text');
    assert.equal(config.coerce('shadow_style', 'none'), undefined);
    assert.equal(config.coerce('paint_images', 'Static'), 'static');
    assert.equal(config.coerce('paint_images', 'still'), undefined, 'the value, not the builder\'s label');
    assert.equal(config.coerce('homies_lists', 'light'), 'light');
    assert.equal(config.coerce('accent_bar', 'on'), true);
    assert.equal(config.coerce('outline_color', '#123'), '112233');
    assert.equal(config.coerce('shadow_color', 'red'), undefined);
    // homies_lists doesn't start with badges_: overlay.js reads the live badges_* keys as badge sources.
    assert.ok(config.KEYS.filter((k) => /^badges_/.test(k)).every((k) => config.SPEC[k].type === 'bool'));
    assert.equal(config.toParams(Object.assign(config.defaults(), { outline: 2, homies_lists: 'light' })).toString(), 'outline=2&homies_lists=light');
  });

  test('int lowest: line_width is 0 (no limit) or 5 to 100; 1 to 4 become 5', () => {
    assert.equal(config.SPEC.line_width.lowest, 5);
    assert.deepEqual([0, 1, 2, 4, 5, 6, 100, 101, -3].map((v) => config.coerce('line_width', v)), [0, 5, 5, 5, 5, 6, 100, 100, 0]);
    assert.deepEqual(['0', '3', ' 4 ', '30', 4.4, 4.6].map((v) => config.coerce('line_width', v)), [0, 5, 5, 30, 5, 5]);
    assert.equal(config.coerce('line_width', 'wide'), undefined);
    assert.equal(config.parse('line_width=2').line_width, 5);
    assert.equal(config.parse('', { line_width: 3 }).line_width, 5);
    // Only line_width and text_px have a lowest; the other ints clamp as before (max=0 is 1, pad_x=1 stays 1).
    assert.deepEqual(config.KEYS.filter((k) => config.SPEC[k].lowest !== undefined), ['text_px', 'line_width']);
    assert.equal(config.coerce('pad_x', 1), 1);
    assert.equal(config.coerce('edge_fade', 1), 1);
    assert.equal(config.coerce('max', 0), 1);
  });

  test('int lowest: text_px is 0 (use size) or 8 to 96 px; 1 to 7 become 8, so the URL says what is drawn', () => {
    assert.equal(config.SPEC.text_px.lowest, 8);
    assert.deepEqual([0, 1, 7, 8, 9, 24, 96, 97, -1].map((v) => config.coerce('text_px', v)), [0, 8, 8, 8, 9, 24, 96, 96, 0]);
    assert.deepEqual(['0', '3', '40', '200'].map((v) => config.coerce('text_px', v)), [0, 8, 40, 96]);
    assert.equal(config.coerce('text_px', '28px'), undefined);
    assert.equal(config.parse('text_px=5').text_px, 8);
    assert.equal(config.toParams(Object.assign(config.defaults(), { text_px: 8 })).toString(), 'text_px=8');
  });

  test('sizing: badge and emote size, emote-only messages, GIF size and gigantified emotes', () => {
    assert.deepEqual([49, 50, 100, 135, 200, 201, '125'].map((v) => config.coerce('badge_size', v)), [50, 50, 100, 135, 200, 200, 125]);
    assert.deepEqual([0, 50, 125, 300].map((v) => config.coerce('emote_scale', v)), [50, 50, 125, 200]);
    assert.equal(config.coerce('emote_only', 'HUGE'), 'huge');
    assert.equal(config.coerce('emote_only', 'hide'), undefined, 'no hide value');
    assert.equal(config.coerce('gif_size', '1X'), '1x');
    assert.equal(config.coerce('gif_size', 'small'), undefined);
    assert.equal(config.coerce('gif_size', 1), undefined, 'the value is 1x, not a number');
    assert.equal(config.coerce('giant_emotes', 'off'), false);
    ['text_px', 'badge_size', 'emote_scale', 'emote_only', 'gif_size', 'giant_emotes'].forEach((k) =>
      assert.ok(config.LIVE_KEYS.includes(k), k + ' is live'));
    assert.equal(config.toParams(Object.assign(config.defaults(), { text_px: 30, gif_size: '1x', emote_scale: 150, emote_only: 'big',
      giant_emotes: false, badge_size: 75 })).toString(), 'text_px=30&gif_size=1x&emote_scale=150&emote_only=big&giant_emotes=0&badge_size=75');
    assert.deepEqual(config.parse('gif_size=2x&giant_emotes=0&emote_only=huge'), Object.assign(config.defaults(),
      { gif_size: '2x', giant_emotes: false, emote_only: 'huge' }));
  });

  test('layout: text alignment, side padding, soft edge and the mark between messages', () => {
    assert.equal(config.coerce('text_align', 'Right'), 'right');
    assert.equal(config.coerce('text_align', 'start'), undefined);
    assert.equal(config.coerce('row_sep', 'DIAMOND'), 'diamond');
    assert.equal(config.coerce('row_sep', '•'), undefined);
    assert.equal(config.coerce('pad_x', 500), 200);
    assert.equal(config.coerce('pad_x', '-1'), 0);
    assert.equal(config.coerce('edge_fade', 11), 10);
    ['text_align', 'line_width', 'pad_x', 'edge_fade', 'row_sep'].forEach((k) => assert.ok(config.LIVE_KEYS.includes(k), k + ' is live'));
    assert.equal(config.toParams(config.defaults()).toString(), '');
    assert.equal(config.toParams(Object.assign(config.defaults(), { text_align: 'center', line_width: 30, pad_x: 0, edge_fade: 3, row_sep: 'dot' }))
      .toString(), 'text_align=center&line_width=30&pad_x=0&edge_fade=3&row_sep=dot');
  });

  test('animations: entrance style and length, fade-out length and exit style', () => {
    assert.equal(config.coerce('enter_style', 'POP'), 'pop');
    assert.equal(config.coerce('enter_style', 'none'), undefined, 'animate=0 is the off switch');
    // No 0 ms entrance: the fade would wait on an animationend a hidden OBS source never fires.
    assert.deepEqual([0, 49, 50, 180, '400', 1000, 5000].map((v) => config.coerce('enter_ms', v)), [50, 50, 50, 180, 400, 1000, 1000]);
    // 0 is a fade-out of no length: the line vanishes at `fade`.
    assert.deepEqual([0, 250, 1000, 10000, 20000, -5].map((v) => config.coerce('fade_out_ms', v)), [0, 250, 1000, 10000, 10000, 0]);
    assert.equal(config.coerce('exit_style', 'Slide'), 'slide');
    assert.equal(config.coerce('exit_style', 'none'), undefined, 'fade_out_ms=0 is the vanish');
    ['enter_style', 'enter_ms', 'fade_out_ms', 'exit_style'].forEach((k) => assert.ok(config.LIVE_KEYS.includes(k), k + ' is live'));
    assert.equal(config.toParams(Object.assign(config.defaults(), { enter_style: 'drop', enter_ms: 300, fade: 30, fade_out_ms: 0,
      exit_style: 'slide' })).toString(), 'enter_style=drop&enter_ms=300&fade=30&fade_out_ms=0&exit_style=slide');
    assert.deepEqual(config.parse('enter_style=fade&fade_out_ms=2500'), Object.assign(config.defaults(),
      { enter_style: 'fade', fade_out_ms: 2500 }));
  });

  test('smooth_scroll: a live switch, off by default and out of the URL until turned on', () => {
    assert.equal(config.SPEC.smooth_scroll.type, 'bool');
    assert.equal(config.defaults().smooth_scroll, false);
    assert.deepEqual(['1', 'true', 'yes', '0', 'false', 'no'].map((v) => config.coerce('smooth_scroll', v)),
      [true, true, true, false, false, false]);
    assert.ok(config.LIVE_KEYS.includes('smooth_scroll'), 'the builder preview turns it on without a reload');
    assert.equal(config.toParams(config.defaults()).toString(), '');
    assert.equal(config.toParams(Object.assign(config.defaults(), { smooth_scroll: true })).toString(), 'smooth_scroll=1');
    assert.equal(config.parse('smooth_scroll=1&align=top').smooth_scroll, true);
    assert.equal(config.parse('', { smooth_scroll: true }).smooth_scroll, true, 'settings.js');
  });

  test('list: normalized, deduped logins from strings or arrays', () => {
    assert.deepEqual(config.coerce('block', 'Nightbot, @StreamElements  #moobot,,'), ['nightbot', 'streamelements', 'moobot']);
    assert.deepEqual(config.coerce('block', 'a,A,a'), ['a']);
    assert.deepEqual(config.coerce('block', ['Foo', '@bar', 'not valid!', '']), ['foo', 'bar']);
    assert.deepEqual(config.coerce('block', ''), []);
  });

  test('list: large lists dedupe in linear time, first occurrence order kept', () => {
    const names = [];
    for (let i = 0; i < 40000; i++) names.push('user' + (i % 20000));
    const t0 = Date.now();
    const out = config.coerce('block', names.join(','));
    assert.equal(out.length, 20000);
    assert.equal(out[0], 'user0');
    assert.equal(out[19999], 'user19999');
    assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0) + ' ms');
    assert.deepEqual(config.coerce('block', ['constructor', '__proto__', 'constructor']), ['constructor', '__proto__']);
  });

  test('channel and unknown keys', () => {
    assert.equal(config.coerce('channel', 'https://twitch.tv/XQC'), 'xqc');
    assert.equal(config.coerce('channel', 'bad name'), undefined);
    assert.equal(config.coerce('nope', '1'), undefined);
    assert.equal(config.coerce('bots', null), undefined);
    assert.equal(config.coerce('bots', undefined), undefined);
  });
});

describe('parse', () => {
  test('empty / missing input gives defaults', () => {
    assert.deepEqual(config.parse(''), config.defaults());
    assert.deepEqual(config.parse(undefined), config.defaults());
    assert.deepEqual(config.parse(null), config.defaults());
    assert.deepEqual(config.parse('?', {}), config.defaults());
  });

  test('reads URL params with coercion and clamping; ignores unknown keys', () => {
    const cfg = config.parse('?channel=XQC&size=large&shadow=0&animate=off&block=a,B&max=999&unknown=1');
    assert.equal(cfg.channel, 'xqc');
    assert.equal(cfg.size, 'large');
    assert.equal(cfg.shadow, 0);
    assert.equal(cfg.animate, false);
    assert.deepEqual(cfg.block, ['a', 'b']);
    assert.equal(cfg.max, 200);
    assert.equal('unknown' in cfg, false);
  });

  test('accepts a URLSearchParams instance, case-insensitive keys, last value wins', () => {
    const cfg = config.parse(new URLSearchParams('CHANNEL=forsen&Size=small&size=large'));
    assert.equal(cfg.channel, 'forsen');
    assert.equal(cfg.size, 'large');
  });

  test('layout: horizontal from the URL, emitted only when not the default', () => {
    assert.equal(config.parse('?channel=xqc&layout=horizontal').layout, 'horizontal');
    assert.equal(config.parse('?channel=xqc&layout=sideways').layout, 'vertical');
    assert.equal(config.parse('', { layout: 'HORIZONTAL' }).layout, 'horizontal');
    const cfg = config.defaults();
    cfg.channel = 'xqc';
    assert.equal(config.toParams(cfg).toString(), 'channel=xqc');
    cfg.layout = 'horizontal';
    assert.equal(config.toParams(cfg).toString(), 'channel=xqc&layout=horizontal');
    assert.deepEqual(config.toObject(cfg), { channel: 'xqc', layout: 'horizontal' });
    assert.ok(config.LIVE_KEYS.includes('layout'), 'the builder preview switches layout without a reload');
    assert.ok(config.LIVE_KEYS.includes('shared'), 'the renderer applies Shared Chat in place');
  });

  test('decodes an encoded channel URL', () => {
    assert.equal(config.parse('?channel=https%3A%2F%2Fwww.twitch.tv%2FxQc').channel, 'xqc');
  });

  test('invalid values fall back to the default', () => {
    const cfg = config.parse('?size=huge&shadow=abc&bots=maybe&font=%3Cscript%3E&channel=bad%20name&max=');
    assert.deepEqual(cfg, config.defaults());
  });

  test('settings.js < URL params', () => {
    const settings = { channel: 'forsen', size: 'large', shadow: 3, bots: true, block: ['a'], font: 'Roboto' };
    const cfg = config.parse('?size=small&channel=xqc', settings);
    assert.equal(cfg.channel, 'xqc');
    assert.equal(cfg.size, 'small');
    assert.equal(cfg.shadow, 3);
    assert.equal(cfg.bots, true);
    assert.deepEqual(cfg.block, ['a']);
    assert.equal(cfg.font, 'Roboto');
  });

  test('an explicit empty channel= clears the settings.js channel; an invalid one falls back to it', () => {
    assert.equal(config.parse('?channel=', { channel: 'forsen' }).channel, '');
    assert.equal(config.parse('?channel=%20', { channel: 'forsen' }).channel, '');
    assert.equal(config.parse('?channel=bad%20name', { channel: 'forsen' }).channel, 'forsen');
    assert.equal(config.parse('?size=small', { channel: 'forsen' }).channel, 'forsen');
  });

  test('an invalid URL value keeps the settings.js value', () => {
    assert.equal(config.parse('?size=huge', { size: 'large' }).size, 'large');
  });

  test('settings.js may use native types or strings; invalid ones are ignored', () => {
    const cfg = config.parse('', { animate: 'no', max: '10', fade: 30.4, bg: 'lots', align: 'TOP', history: 20 });
    assert.equal(cfg.animate, false);
    assert.equal(cfg.max, 10);
    assert.equal(cfg.fade, 30);
    assert.equal(cfg.bg, 0);
    assert.equal(cfg.align, 'top');
    assert.equal(cfg.history, 20);
    assert.deepEqual(config.parse('', 'not an object'), config.defaults());
  });

  test('does not mutate the settings object', () => {
    const settings = { block: ['A'] };
    const cfg = config.parse('', settings);
    assert.deepEqual(settings, { block: ['A'] });
    assert.notEqual(cfg.block, settings.block);
  });
});

describe('toParams / toObject', () => {
  function custom() {
    const cfg = config.defaults();
    Object.assign(cfg, {
      channel: 'xqc', size: 'large', shadow: 0, animate: false, bots: true, block: ['a', 'b'],
      font: 'Comic Sans MS', history: 50, badges_homies: false, fade: 30
    });
    return cfg;
  }

  test('toParams emits only non-default values, channel first', () => {
    assert.equal(config.toParams(config.defaults()).toString(), '');
    const only = config.defaults();
    only.channel = 'xqc';
    assert.equal(config.toParams(only).toString(), 'channel=xqc');
    const p = config.toParams(custom());
    const keys = [...p.keys()];
    assert.equal(keys[0], 'channel');
    assert.deepEqual(keys.sort(), ['animate', 'badges_homies', 'block', 'bots', 'channel', 'fade', 'font', 'history', 'shadow', 'size']);
    assert.equal(p.get('animate'), '0');
    assert.equal(p.get('bots'), '1');
    assert.equal(p.get('block'), 'a,b');
    assert.equal(p.get('shadow'), '0');
    assert.equal(p.get('font'), 'Comic Sans MS');
  });

  test('toParams round-trips through parse', () => {
    const cfg = custom();
    assert.deepEqual(config.parse(config.toParams(cfg).toString()), cfg);
    assert.deepEqual(config.parse('?' + config.toParams(cfg).toString()), cfg);
  });

  test('toObject emits native types for non-defaults and round-trips as settings', () => {
    const cfg = custom();
    const o = config.toObject(cfg);
    assert.deepEqual(o, {
      channel: 'xqc', size: 'large', font: 'Comic Sans MS', shadow: 0, animate: false, fade: 30, bots: true,
      block: ['a', 'b'], history: 50, badges_homies: false
    });
    assert.notEqual(o.block, cfg.block);
    assert.deepEqual(config.parse('', o), cfg);
    assert.deepEqual(config.toObject(config.defaults()), {});
  });

  test('serialize writes a value as the URL does, and isDefault tells a default apart', () => {
    assert.equal(config.serialize('bots', true), '1');
    assert.equal(config.serialize('bots', false), '0');
    assert.equal(config.serialize('block', ['a', 'b']), 'a,b');
    assert.equal(config.serialize('block', undefined), '', 'a missing list is an empty one');
    assert.equal(config.serialize('shadow', 0), '0');
    assert.equal(config.serialize('font', 'Open Sans'), 'Open Sans');
    assert.equal(config.serialize('kick_room', ''), '');
    assert.equal(config.isDefault('block', []), true);
    assert.equal(config.isDefault('block', undefined), true);
    assert.equal(config.isDefault('block', ['a']), false);
    assert.equal(config.isDefault('history', 5), true);
    assert.equal(config.isDefault('history', 0), false);
    assert.equal(config.isDefault('size', 'medium'), true);
    // What toParams writes for each changed key is serialize's value.
    const cfg = custom();
    const p = config.toParams(cfg);
    config.KEYS.filter((k) => k !== 'channel' && !config.isDefault(k, cfg[k])).forEach((k) => assert.equal(p.get(k), config.serialize(k, cfg[k]), k));
  });

  test('history is on by default: 5 is left out, 0 (off) is written and read back', () => {
    assert.equal(config.parse('?channel=xqc').history, 5);
    assert.equal(config.parse('?channel=xqc&history=0').history, 0);
    assert.equal(config.parse('?history=abc', { history: 0 }).history, 0, 'an invalid URL value keeps the settings.js 0');
    const cfg = Object.assign(config.defaults(), { channel: 'xqc' });
    assert.equal(config.toParams(cfg).toString(), 'channel=xqc');
    assert.deepEqual(config.toObject(cfg), { channel: 'xqc' });
    cfg.history = 0;
    assert.equal(config.toParams(cfg).toString(), 'channel=xqc&history=0');
    assert.deepEqual(config.toObject(cfg), { channel: 'xqc', history: 0 });
    assert.deepEqual(config.parse(config.toParams(cfg)), cfg);
    assert.deepEqual(config.parse('', config.toObject(cfg)), cfg);
  });
});

test('isSystemFont', () => {
  ['Arial', 'segoe ui', 'Comic Sans MS', 'system-ui', 'Times New Roman'].forEach((f) => assert.equal(config.isSystemFont(f), true, f));
  ['Inter', 'Roboto', '', undefined].forEach((f) => assert.equal(config.isSystemFont(f), false, String(f)));
});

test('isSystemFont: CSS generic keywords and stock Windows fonts are never fetched from Google Fonts', () => {
  ['serif', 'Sans-Serif', 'monospace', 'cursive', 'fantasy', 'ui-rounded', 'math', 'emoji', 'fangsong']
    .forEach((f) => assert.equal(config.isSystemFont(f), true, f));
  ['Calibri', 'cambria', 'Arial Black', 'Lucida Console', 'Palatino Linotype', 'Bahnschrift']
    .forEach((f) => assert.equal(config.isSystemFont(f), true, f));
  config.GENERIC_FONT_NAMES.forEach((f) => assert.equal(config.canonicalFont(f.toUpperCase()), f, f));
  assert.equal(config.isSystemFont('constructor'), false);
});

describe('prototype names are not settings', () => {
  test('parse ignores __proto__, constructor and other Object.prototype names', () => {
    const cfg = config.parse('?__proto__=x&constructor=y&toString=1&hasOwnProperty=2&valueOf=3&CONSTRUCTOR=4');
    assert.deepEqual(cfg, config.defaults());
    assert.equal(Object.getPrototypeOf(cfg), Object.prototype);
    assert.equal(({}).x, undefined);
    assert.equal(config.parse('?channel=xqc&constructor=1').channel, 'xqc');
  });

  test('coerce rejects prototype names as keys', () => {
    ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach((k) => {
      assert.equal(config.coerce(k, '1'), undefined, k);
      assert.equal(config.coerce(k, 1), undefined, k);
    });
  });

  test('settings objects with prototype names are ignored', () => {
    const settings = JSON.parse('{"__proto__": {"channel": "evil"}, "constructor": 1, "size": "large"}');
    const cfg = config.parse('', settings);
    // Strict deep-equal checks own keys, values and the prototype: nothing but 'size' may leak in.
    assert.deepEqual(cfg, Object.assign(config.defaults(), { size: 'large' }));
    assert.equal(Object.getPrototypeOf(cfg), Object.prototype);
    assert.deepEqual(Object.keys(cfg), config.KEYS);
    assert.equal(({}).channel, undefined);
  });

  test('settings object keys are case-insensitive, like URL keys', () => {
    const cfg = config.parse('', { Channel: 'Forsen', SIZE: 'large', Block: ['A'] });
    assert.equal(cfg.channel, 'forsen');
    assert.equal(cfg.size, 'large');
    assert.deepEqual(cfg.block, ['a']);
    assert.equal(config.parse('', { Size: 'small', size: 'large' }).size, 'large', 'a later spelling wins');
    assert.deepEqual(Object.keys(config.parse('', { Size: 'small', Nope: 1 })), config.KEYS);
    assert.equal(config.parse('?size=small', { SIZE: 'large' }).size, 'small', 'URL still wins');
  });

  test('values that are not strings, numbers or booleans are ignored instead of throwing', () => {
    const bad = JSON.parse('{"toString": 1}');
    ['channel', 'size', 'font', 'shadow', 'bots', 'block'].forEach((k) => {
      assert.equal(config.coerce(k, bad), undefined, k);
      assert.equal(config.coerce(k, Symbol('x')), undefined, k);
    });
    assert.deepEqual(config.coerce('block', ['ok', bad, { a: 1 }, ['x'], 7, 'Ok']), ['ok', '7']);
    const cfg = config.parse('', { size: bad, font: bad, block: [bad], channel: 'xqc' });
    assert.deepEqual(cfg, Object.assign(config.defaults(), { channel: 'xqc' }));
  });
});

describe('fonts', () => {
  test('GOOGLE_FONTS are valid, unique, not system fonts, and spelled canonically', () => {
    assert.ok(config.GOOGLE_FONTS.length >= 40);
    const seen = new Set();
    config.GOOGLE_FONTS.forEach((f) => {
      assert.equal(config.coerce('font', f), f, f);
      assert.equal(config.isSystemFont(f), false, f);
      assert.ok(!seen.has(f.toLowerCase()), 'duplicate ' + f);
      seen.add(f.toLowerCase());
      assert.equal(config.canonicalFont(f), f, f);
      assert.equal(config.canonicalFont(f.toLowerCase()), f, f.toLowerCase());
      assert.equal(config.canonicalFont(f.toUpperCase()), f, f.toUpperCase());
    });
    ['Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Nunito', 'Rubik', 'Oswald', 'Raleway',
      'Ubuntu', 'Fredoka', 'Comic Neue', 'Press Start 2P', 'Bebas Neue', 'Quicksand', 'Source Sans 3', 'Noto Sans',
      'Work Sans', 'IBM Plex Sans', 'Outfit', 'Lexend', 'Baloo 2', 'Kanit', 'Pixelify Sans', 'VT323', 'Silkscreen']
      .forEach((f) => assert.ok(config.GOOGLE_FONTS.includes(f), f));
    assert.equal(config.GOOGLE_FONTS[0], config.SPEC.font.def);
  });

  test('SYSTEM_FONT_NAMES are the canonical spellings of SYSTEM_FONTS', () => {
    assert.deepEqual(config.SYSTEM_FONT_NAMES.map((f) => f.toLowerCase()), config.SYSTEM_FONTS);
    assert.deepEqual(config.SYSTEM_FONTS, ['arial', 'segoe ui', 'verdana', 'tahoma', 'trebuchet ms', 'georgia',
      'times new roman', 'courier new', 'consolas', 'comic sans ms', 'impact', 'system-ui',
      'arial black', 'bahnschrift', 'calibri', 'cambria', 'candara', 'constantia', 'corbel', 'gabriola',
      'lucida console', 'lucida sans unicode', 'palatino linotype', 'segoe print', 'segoe script', 'sylfaen']);
    config.SYSTEM_FONT_NAMES.forEach((f) => {
      assert.equal(config.coerce('font', f), f, f);
      assert.equal(config.isSystemFont(f), true, f);
    });
  });

  test('canonicalFont fixes the case Google Fonts needs', () => {
    const cases = [
      ['roboto', 'Roboto'],
      ['open sans', 'Open Sans'],
      ['OPEN SANS', 'Open Sans'],
      ['  open   sans ', 'Open Sans'],
      ['press start 2p', 'Press Start 2P'],
      ['Press start 2P', 'Press Start 2P'],
      ['ibm plex sans', 'IBM Plex Sans'],
      ['vt323', 'VT323'],
      ['baloo 2', 'Baloo 2'],
      ['m plus rounded 1c', 'M PLUS Rounded 1c'],
      ['segoe ui', 'Segoe UI'],
      ['comic sans ms', 'Comic Sans MS'],
      ['SYSTEM-UI', 'system-ui'],
      // Unknown, all lowercase: title-case each word.
      ['my cool font', 'My Cool Font'],
      ['noto serif display', 'Noto Serif Display'],
      ['x 2', 'X 2'],
      // Unknown with capitals: each word's first letter is capitalized, nothing is lowercased.
      ['Noto Sans JP', 'Noto Sans JP'],
      ['Space GROTESK', 'Space Grotesk'], // known, so fixed anyway
      ['MyFont xYz', 'MyFont XYz'],
      ['ZCOOL KuaiLe', 'ZCOOL KuaiLe'],
      ['Roboto slab', 'Roboto Slab'],
      ['Libre baskerville', 'Libre Baskerville'],
      // Joining words after the first keep the case Google uses.
      ['Fredericka the Great', 'Fredericka the Great'],
      ['waiting for the sunrise', 'Waiting for the Sunrise'],
      ['dawning of a new day', 'Dawning of a New Day'],
      ['Covered By Your Grace', 'Covered By Your Grace'],
      // Families that capitalize a joining word keep it capitalized from lowercase input.
      ['covered by your grace', 'Covered By Your Grace'],
      ['love ya like a sister', 'Love Ya Like A Sister'],
      ['loved by the king', 'Loved by the King'],
      ['the girl next door', 'The Girl Next Door'],
      // Acronym families are listed, so their capitals are restored.
      ['noto sans tc', 'Noto Sans TC'],
      ['pt serif', 'PT Serif'],
      ['Ibm Plex Mono', 'IBM Plex Mono'],
      ['eb garamond', 'EB Garamond'],
      // CSS generic keywords stay lowercase; stock Windows fonts get their spelling.
      ['Serif', 'serif'],
      ['MONOSPACE', 'monospace'],
      ['calibri', 'Calibri'],
      // Prototype names are not known fonts.
      ['constructor', 'Constructor'],
      ['__proto__', '__proto__'],
      ['', ''],
      ['   ', '']
    ];
    cases.forEach(([k, v]) => assert.equal(config.canonicalFont(k), v, JSON.stringify(k)));
    assert.equal(config.canonicalFont(undefined), '');
    assert.equal(config.canonicalFont(null), '');
  });

  test('canonicalFont keeps a valid font value valid', () => {
    ['roboto', 'my font-name 2', 'a', 'x'.repeat(60), 'Inter'].forEach((f) => {
      assert.ok(config.coerce('font', f) !== undefined, f);
      assert.equal(config.coerce('font', config.canonicalFont(f)), config.canonicalFont(f), f);
    });
  });

  test('canonicalFont spells Google families with a word in capitals as Google does, typed in any case', () => {
    // Title case would give 'Dm Serif Text', 'Pt Sans Caption', 'Noto Serif Sc'…: fonts.googleapis.com answers 400.
    [['dm serif text', 'DM Serif Text'], ['pt sans caption', 'PT Sans Caption'], ['noto serif sc', 'Noto Serif SC'],
      ['ibm plex sans condensed', 'IBM Plex Sans Condensed'], ['zcool kuaile', 'ZCOOL KuaiLe'], ['im fell english', 'IM Fell English'],
      ['m plus 1p', 'M PLUS 1p'], ['biz udpgothic', 'BIZ UDPGothic'], ['dotgothic16', 'DotGothic16'], ['Ibm Plex Sans Jp', 'IBM Plex Sans JP']]
      .forEach(([k, v]) => assert.equal(config.canonicalFont(k), v, k));
    const google = new Set(config.GOOGLE_FONTS.map((f) => f.toLowerCase()));
    const seen = new Set();
    config.FONT_CANON_EXTRA.forEach((f) => {
      assert.equal(config.coerce('font', f), f, f);
      assert.equal(config.isSystemFont(f), false, f);
      assert.ok(!google.has(f.toLowerCase()) && !seen.has(f.toLowerCase()), 'listed once: ' + f);
      seen.add(f.toLowerCase());
      assert.equal(config.canonicalFont(f.toLowerCase()), f, f.toLowerCase());
      assert.equal(config.canonicalFont(f.toUpperCase()), f, f.toUpperCase());
    });
  });

  test('isKnownFont: only a name spelled exactly as a listed font', () => {
    ['Inter', 'Press Start 2P', 'DM Serif Text', 'Covered By Your Grace', 'Segoe UI', 'serif', 'system-ui'].forEach((f) =>
      assert.equal(config.isKnownFont(f), true, f));
    ['inter', 'Dm Serif Text', 'Roboto Slab', 'My Font', '', 'constructor', '__proto__', undefined, null, 7].forEach((f) =>
      assert.equal(config.isKnownFont(f), false, String(f)));
  });
});
