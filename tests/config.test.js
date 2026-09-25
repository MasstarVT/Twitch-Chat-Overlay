'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../js/config.js');

describe('spec', () => {
  test('defaults match the plan', () => {
    const d = config.defaults();
    assert.deepEqual(d, {
      channel: '', size: 'medium', font: 'Inter', shadow: 2, bg: 0, layout: 'vertical', align: 'bottom', animate: true,
      fade: 0, max: 50, bots: false, hide_commands: false, block: [],
      events: true, replies: true, first_msg: false, history: 0, shared: true, gifs: true,
      emotes_7tv: true, emotes_bttv: true, emotes_ffz: true,
      badges: true, badges_twitch: true, badges_7tv: true, badges_bttv: true, badges_ffz: true,
      badges_ffzap: true, badges_chatterino: true, badges_homies: true,
      paints: true, stv_lookup: true, readable: true, demo: false, debug: false
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
    const reload = ['channel', 'emotes_7tv', 'emotes_bttv', 'emotes_ffz', 'stv_lookup', 'history', 'shared', 'demo', 'debug'];
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
  });

  test('rejects anything that is not a valid login', () => {
    ['', '   ', 'bad name', 'a'.repeat(26), 'x-y', 'xqc.tv', '<script>', 'https://kick.com/xqc', '@', '#'].forEach((v) => {
      assert.equal(config.normalizeChannel(v), '', JSON.stringify(v));
    });
    assert.equal(config.normalizeChannel(null), '');
    assert.equal(config.normalizeChannel(undefined), '');
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

  test('list: normalized, deduped logins from strings or arrays', () => {
    assert.deepEqual(config.coerce('block', 'Nightbot, @StreamElements  #moobot,,'), ['nightbot', 'streamelements', 'moobot']);
    assert.deepEqual(config.coerce('block', 'a,A,a'), ['a']);
    assert.deepEqual(config.coerce('block', ['Foo', '@bar', 'not valid!', '']), ['foo', 'bar']);
    assert.deepEqual(config.coerce('block', ''), []);
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
});

test('isSystemFont', () => {
  ['Arial', 'segoe ui', 'Comic Sans MS', 'system-ui', 'Times New Roman'].forEach((f) => assert.equal(config.isSystemFont(f), true, f));
  ['Inter', 'Roboto', '', undefined].forEach((f) => assert.equal(config.isSystemFont(f), false, String(f)));
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
    assert.equal(cfg.size, 'large');
    assert.equal(cfg.channel, '');
    assert.equal(({}).channel, undefined);
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
      'times new roman', 'courier new', 'consolas', 'comic sans ms', 'impact', 'system-ui']);
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
      // Unknown with capitals: kept as typed.
      ['Noto Sans JP', 'Noto Sans JP'],
      ['Space GROTESK', 'Space Grotesk'], // known, so fixed anyway
      ['MyFont xYz', 'MyFont xYz'],
      ['ZCOOL KuaiLe', 'ZCOOL KuaiLe'],
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
});
