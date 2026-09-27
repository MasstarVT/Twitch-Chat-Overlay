'use strict';
// Chat and third-party data must never run code or inject markup/CSS. These tests pin the rules that keep it
// that way: text only ever becomes text, URLs are https (and pinned where the host is known), CSS values are
// built from validated pieces, and every page carries a script-locking Content-Security-Policy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const util = require('../js/util.js');
const ircParse = require('../js/irc-parse.js');
const tokenizer = require('../js/tokenizer.js');
const renderer = require('../js/renderer.js');
const paintCss = require('../js/paint-css.js');
const twitchBadges = require('../js/twitch-badges.js');

const R = renderer._internal;
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg/onload=alert(1)>',
  'javascript:alert(1)',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<style>*{display:none}</style>'
];

// IRCv3 tag escaping, so payloads can sit in tags too.
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\:').replace(/ /g, '\\s');
function ircLine(tags, text, cmd) {
  const t = Object.assign({ id: 'm1', 'user-id': '5', 'room-id': '1', color: '#1E90FF', 'display-name': 'U', emotes: '' }, tags);
  return '@' + Object.keys(t).map((k) => k + '=' + esc(t[k])).join(';') + ' :u!u@u.tmi.twitch.tv ' + (cmd || 'PRIVMSG') + ' #c :' + text;
}
function model(tags, text, extra) {
  const msg = ircParse.toChatMessage(ircParse.parseLine(ircLine(tags, text)));
  const tk = tokenizer.tokenize(msg, Object.assign({ lookup: () => null, gifs: true }, extra));
  return R.modelFor(msg, R.normalizeCfg({}), { kind: 'chat', items: tk.items, action: tk.action, badges: [],
    name: { text: msg.displayName, color: msg.color } });
}
// Every URL a line can load, and every string that ends up as text.
function urlsOf(m) {
  const out = [];
  m.badges.forEach((b) => out.push(b.url));
  m.parts.forEach((p) => {
    if (p.url) out.push(p.url);
    (p.ov || []).forEach((o) => out.push(o.url));
  });
  return out;
}

test('no code in js/ can turn a string into markup or code', () => {
  const SINKS = /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\b|\bsrcdoc\b|createContextualFragment|DOMParser|setAttribute\(\s*['"]on|(?:setAttribute\(|setAttributeNS\([^,)]*,)\s*['"](?:xlink:)?(?:href|src|srcset|style|poster|action|formaction)['"]|set(?:Timeout|Interval)\(\s*['"`]|\bcssText\b|\.style\s*=(?!=)/;
  // on* properties may only be given a function (or null, or chained to another on* property): a string is code.
  const HANDLER = /\.on[a-z]+\s*=(?!=)/g;
  const HANDLER_OK = /^\s*(?:function\b|null\b|[\w$.]+\.on[a-z]+\s*=(?!=))/;
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10);
  // URL and style attributes set by name are sinks too; other attributes are not.
  ["setAttribute('srcset', x)", 'setAttribute("href", u)', "setAttribute('style', s)", "setAttributeNS(XL, 'xlink:href', u)",
    "setAttribute('poster', p)", "setAttribute('action', a)"].forEach((l) => assert.ok(SINKS.test(l), l));
  ["setAttribute('aria-invalid', 'false')", "setAttribute('list', 'font-list')", "setAttribute('data-key', key)"]
    .forEach((l) => assert.ok(!SINKS.test(l), l));
  files.forEach((f) => {
    const src = read('js/' + f);
    src.split('\n').forEach((line, i) => {
      const where = 'js/' + f + ':' + (i + 1) + ' ' + line.trim();
      assert.ok(!SINKS.test(line), where);
      HANDLER.lastIndex = 0;
      let m;
      while ((m = HANDLER.exec(line))) assert.match(line.slice(m.index + m[0].length), HANDLER_OK, where);
    });
  });
});

// Every URL property assignment in js/ (.href, .src, .srcset, .poster, .formAction, or el['src'] and the
// like) is a reviewed one, keyed on the file and the exact assignment text (not line numbers). A new one must be checked (https only, no chat or provider text
// reaching it unvalidated) and then added here.
test('every URL property assignment in js/ is a reviewed one', () => {
  const REVIEWED = {
    'builder.js': [
      /^img\.src = (?:small|full)$/, // the channel avatar preview: IVR logo, isSafeUrl(jtvnw.net) checked
      /^\$\('(?:bar|out)-open'\)\.href = url$/, // the generated overlay URL on this site
      /^a\.href = href$/, // builder links on this site
      /^f\.src = src$/, // the preview iframe: overlay.html on this site
      /^s\.src = 'settings\.js\?t=' \+ Date\.now\(\)$/
    ],
    'home.js': [
      /^f\.src = src$/ // the demo frames: overlay.html on this site, from the DEMOS constants
    ],
    'overlay.js': [
      /^a\.href = 'builder\.html' \+ /, // back to the builder, channel URI-encoded
      /^link\.href = 'https:\/\/fonts\.googleapis\.com\/css2\?family=' \+ encodeURIComponent\(/
    ],
    'renderer.js': [
      /^img\.src = url$/, // url comes from pickUrl (https only)
      /^img\.src = p\.orig$/ // a GIF's original URL: partsFor keeps it only when util.isSafeUrl (https)
    ]
  };
  // .action is left out: plain objects use it (m.action); a form's action attribute goes through setAttribute (SINKS).
  const ASSIGN = /([^\s;{}]*)(?:\.(href|src|srcset|poster|formAction)|\[\s*['"](href|src|srcset|poster|formAction)['"]\s*\])\s*=(?!=)([^;]*)/g;
  const exprOf = (m) => (m[1] + '.' + (m[2] || m[3]) + ' = ' + m[4].trim()).replace(/\s+/g, ' ');
  let seen = 0;
  fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).forEach((f) => {
    read('js/' + f).split('\n').forEach((line, i) => {
      ASSIGN.lastIndex = 0;
      let m;
      while ((m = ASSIGN.exec(line))) {
        const expr = exprOf(m);
        seen++;
        assert.ok((REVIEWED[f] || []).some((re) => re.test(expr)), 'unreviewed URL sink js/' + f + ':' + (i + 1) + ' ' + expr);
      }
    });
  });
  assert.ok(seen >= 5, 'the scan finds the known sinks');
  // The scan itself catches the other spellings of a URL sink.
  const hits = (line) => { ASSIGN.lastIndex = 0; const m = ASSIGN.exec(line); return m ? exprOf(m) : null; };
  assert.equal(hits("img.srcset = x;"), 'img.srcset = x');
  assert.equal(hits("el['src'] = u;"), 'el.src = u');
  assert.equal(hits('v.poster = p;'), 'v.poster = p');
  assert.equal(hits('b.formAction = a;'), 'b.formAction = a');
  assert.equal(hits('if (img.src == x) {}'), null);
  assert.equal(hits('m.action = a.action;'), null);
});

// Navigation is a URL sink too: every location.replace(), location.assign() and .open() call in js/ is a reviewed
// one, keyed the same way. (String replace and Object.assign have other receivers, so they are not matched.)
test('every navigation call in js/ is a reviewed one', () => {
  const REVIEWED = {
    'home.js': [
      /^loc\.replace\(BUILDER \+ loc\.search \+ loc\.hash\)$/ // an old builder link: builder.html on this site, query and hash passed on
    ]
  };
  const NAV = /([\w$.]*\b(?:location|loc)\.(?:replace|assign)|[\w$.]*\.open)\s*\(([^;]*)\)/g;
  const exprOf = (m) => (m[1] + '(' + m[2].trim() + ')').replace(/\s+/g, ' ');
  let seen = 0;
  fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).forEach((f) => {
    read('js/' + f).split('\n').forEach((line, i) => {
      NAV.lastIndex = 0;
      let m;
      while ((m = NAV.exec(line))) {
        const expr = exprOf(m);
        seen++;
        assert.ok((REVIEWED[f] || []).some((re) => re.test(expr)), 'unreviewed navigation js/' + f + ':' + (i + 1) + ' ' + expr);
      }
    });
  });
  assert.ok(seen >= 1, 'the scan finds the known call');
  // The scan itself catches the other spellings, and leaves string and object helpers alone.
  const hits = (line) => { NAV.lastIndex = 0; const m = NAV.exec(line); return m ? exprOf(m) : null; };
  assert.equal(hits('root.location.assign(u);'), 'root.location.assign(u)');
  assert.equal(hits("window.open(u, '_blank');"), "window.open(u, '_blank')");
  assert.equal(hits("s = s.replace(/a/g, 'b');"), null);
  assert.equal(hits('Object.assign(a, b);'), null);
});

test('every page: a Content-Security-Policy that only runs the site\'s own script files, and nothing inline', () => {
  ['overlay.html', 'builder.html', 'index.html'].forEach((page) => {
    const html = read(page);
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    assert.ok(m, page + ' has a CSP');
    assert.ok(html.indexOf(m[0]) < html.search(/<script|<link rel="stylesheet"/), page + ': the CSP comes before any script or style');
    const csp = {};
    m[1].split(';').forEach((d) => { const w = d.trim().split(/\s+/); csp[w[0]] = w.slice(1); });
    assert.deepStrictEqual(csp['default-src'], ["'none'"], page);
    assert.deepStrictEqual(csp['script-src'], ["'self'", 'file:'], page + ': no inline, eval or remote scripts');
    assert.deepStrictEqual(csp['base-uri'], ["'none'"], page);
    assert.ok(!csp['object-src'] || csp['object-src'][0] === "'none'");
    // Every <script> is an external file with no inline body, and no element has an on* handler attribute.
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.ok(scripts.length > 0);
    scripts.forEach((s) => assert.match(s, /^<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>$/, page + ': ' + s.slice(0, 60)));
    assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), page + ': inline event handler');
  });
  // OBS applies Custom CSS as an inline style, so the overlay (only) must allow inline styles.
  assert.match(read('overlay.html'), /style-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(read('builder.html'), /'unsafe-inline'/);
  assert.doesNotMatch(read('index.html'), /'unsafe-inline'/);
});

test('overlay.html records settings.js errors from a file, loaded before settings.js', () => {
  const html = read('overlay.html');
  const errors = html.indexOf('src="js/errors.js');
  assert.ok(errors > 0 && errors < html.indexOf('src="settings.js'));
  assert.match(read('js/errors.js'), /document\.readyState === 'loading' \? 'settings\.js'/);
});

test('hostile chat text, names, replies and tags come out as text, never as markup or unsafe URLs', () => {
  PAYLOADS.forEach((p) => {
    const m = model({ 'display-name': p, 'reply-parent-msg-id': 'x', 'reply-parent-display-name': p, 'reply-parent-msg-body': p }, p + ' hi');
    assert.strictEqual(m.name.text, p, 'the name is kept as literal text');
    assert.strictEqual(m.reply.name, '@' + p);
    assert.strictEqual(m.reply.body, p);
    assert.deepStrictEqual(m.parts, [{ t: 'text', s: p + ' hi' }], 'the message is one text part');
    assert.strictEqual(m.cls, 'line');
  });
  // colors: anything but #rrggbb is replaced (and would only ever reach a CSSOM setter)
  ['red;background:url(https://evil.example/x)', 'expression(alert(1))', '#fff}body{x:y'].forEach((c) => {
    assert.match(model({ color: c }, 'hi').name.color, /^#[0-9a-f]{6}$/i, c);
  });
  // msg-id / announcement colors can't add classes
  assert.strictEqual(R.lineClasses({ announcement: 'BLUE onmouseover=x' }, {}, 'chat', false), 'line announcement ann-primary');
  assert.strictEqual(R.lineClasses({ msgId: 'highlighted-message x y' }, {}, 'chat', false), 'line');
  // emote ranges over markup, out of range, or with an odd id: text stays text, URLs stay on Twitch's CDN
  [['25:0-4', PAYLOADS[0]], ['25:5-999', 'short'], ['emotesv2_x/../../evil:0-2', 'abc hi']].forEach(([emotes, text]) => {
    const m = model({ emotes }, text);
    urlsOf(m).forEach((u) => assert.match(u, /^https:\/\/static-cdn\.jtvnw\.net\//, u));
    m.parts.filter((p) => p.t === 'text').forEach((p) => assert.ok(text.indexOf(p.s.trim()) >= 0));
  });
});

test('GIF tags only ever load https giphy URLs', () => {
  ['javascript:alert(1)', 'http://media.giphy.com/x.gif', 'https://evil.example/x.gif', 'https://giphy.com.evil.example/x',
    'https://media.giphy.com/x.gif" onerror="alert(1)', 'data:image/gif;base64,R0lGOD'].forEach((u) => {
    const msg = ircParse.toChatMessage(ircParse.parseLine(ircLine({}, 'GIFTEXT')));
    msg.gifs = '0-6|id|' + u;
    const tk = tokenizer.tokenize(msg, { lookup: () => null, gifs: true });
    const parts = R.partsFor(tk.items, { want: 2, wantBig: 6, gifs: true });
    assert.deepStrictEqual(parts, [{ t: 'text', s: 'GIFTEXT' }], u);
  });
});

test('provider emotes and badges: names are text, only https URLs are used', () => {
  const evil = '<img/src=x/onerror=alert(1)>';
  const items = [
    { type: 'emote', emote: { name: evil, urls: { 1: 'https://cdn.7tv.app/emote/x/1x.webp' } }, sp: false },
    { type: 'emote', emote: { name: 'JsUrl', urls: { 1: 'javascript:alert(1)' } }, sp: true },
    { type: 'emote', emote: { name: 'DataUrl', urls: { 1: 'data:image/png;base64,x' } }, sp: true },
    { type: 'emote', emote: { name: 'PlainHttp', urls: { 1: 'http://tracker.example/x.png' } }, sp: true },
    { type: 'emote', emote: { name: 'ProtoRel', urls: { 1: '//cdn.betterttv.net/emote/x/1x' } }, sp: true }
  ];
  const parts = R.partsFor(items, { want: 1, wantBig: 3, gifs: true });
  assert.strictEqual(parts[0].t, 'emote');
  assert.strictEqual(parts[0].name, evil, 'an emote name only becomes alt text');
  assert.deepStrictEqual(parts[1], { t: 'text', s: ' JsUrl DataUrl PlainHttp ' }, 'unusable URLs fall back to the name as text');
  assert.strictEqual(parts[2].url, 'https://cdn.betterttv.net/emote/x/1x', 'protocol-relative becomes https');
  const badges = R.badgeModels([
    { title: evil, urls: { 1: 'https://cdn.frankerfacez.com/badge/2/1' }, bg: 'red;background-image:url(x)' },
    { title: 'js', urls: { 1: 'javascript:alert(1)' } },
    { title: 'http', urls: { 1: 'http://tracker.example/b.png' } }
  ], 1);
  assert.strictEqual(badges.length, 1);
  assert.strictEqual(badges[0].title, evil, 'a badge title only becomes alt text');
  // A badge bg only ever reaches the CSSOM backgroundColor setter, which rejects anything but one color,
  // so 'red;background-image:url(x)' cannot add a declaration.
  const bgSinks = read('js/renderer.js').split('\n').filter((l) => /\bb\.bg\b/.test(l) && /style|css|setAttribute/i.test(l));
  assert.ok(bgSinks.length > 0);
  bgSinks.forEach((l) => assert.match(l.trim(), /^[\w$.]+\.style\.backgroundColor = b\.bg;$/, l.trim()));
  // The Shared Chat avatar (from IVR) must be a Twitch profile image.
  assert.strictEqual(twitchBadges.parseUser([{ id: 1, login: 'a', logo: 'https://evil.example/l.png' }]).logo, null);
  assert.strictEqual(twitchBadges.parseUser([{ id: 1, login: 'a', logo: 'http://static-cdn.jtvnw.net/a-profile_image-600x600.png' }]).logo, null);
  assert.strictEqual(twitchBadges.parseUser([{ id: 1, login: 'a', logo: 'https://static-cdn.jtvnw.net.evil.example/a-profile_image-600x600.png' }]).logo, null);
  assert.strictEqual(twitchBadges.parseUser([{ id: 1, login: 'a', logo: 'https://static-cdn.jtvnw.net/jtv_user_pictures/a.png' }]).logo,
    'https://static-cdn.jtvnw.net/jtv_user_pictures/a.png');
});

test('7TV paints: hostile values never escape their rule, and stay near the name', () => {
  const hostile = [
    paintCss.fromV3({ id: 'a1', function: 'URL', image_url: 'https://cdn.7tv.app/x.png");}*{display:none}.a{b:url("' }),
    paintCss.fromV3({ id: 'a2', function: 'URL', image_url: 'https://evil.example/x.png' }),
    paintCss.fromV3({ id: 'a3', function: 'LINEAR_GRADIENT', angle: '1deg);}*{x:y', stops: [{ at: '1)', color: 1 }, { at: 0.5, color: 'red}' }] }),
    paintCss.fromV4({ id: 'a4', data: { layers: [
      { ty: { __typename: 'PaintLayerTypeLinearGradient', angle: '0;x', stops: [{ at: 0, color: { hex: '#fff;}*{' } }, { at: 1, color: { hex: '#ffffff' } }] } },
      { ty: { __typename: 'PaintLayerTypeImage', images: [{ url: 'https://cdn.7tv.app/a b)' }, { url: 'https://cdn.7tv.app.evil.example/x' }] } }],
    shadows: [{ color: { hex: '#000000' }, offsetX: '1px) url(https://evil.example/s)', offsetY: -900, blur: 1e30 }] } }),
    paintCss.fromV3({ id: 'a5}*{display:none', function: 'LINEAR_GRADIENT', stops: [{ at: 0, color: 255 }] })
  ];
  hostile.forEach((p, i) => {
    const rule = paintCss.ruleFor(p);
    if (!rule) return;
    assert.match(rule, /^\.painted\.p-[0-9A-Za-z]+\{[^{}]*\}$/, 'one rule, one block: ' + i);
    assert.doesNotMatch(rule, /url\((?!"https:\/\/cdn\.7tv\.app\/)/, 'no url() off cdn.7tv.app: ' + i);
    assert.doesNotMatch(rule, /[;{}]\s*[;{}]|\*|@import|expression|e\+/i, 'nothing smuggled: ' + i);
  });
  // offsets and blur are clamped, and there are at most MAX_SHADOWS shadows and MAX_LAYERS layers
  const big = paintCss.fromV4({ id: 'b1', data: {
    layers: Array.from({ length: 50 }, () => ({ ty: { __typename: 'PaintLayerTypeLinearGradient', angle: 90, stops: [{ at: 0, color: { hex: '#ff0000' } }, { at: 1, color: { hex: '#0000ff' } }] } })),
    shadows: Array.from({ length: 50 }, () => ({ color: { hex: '#ff0000' }, offsetX: 5000, offsetY: -300, blur: 999 })) } });
  const rule = paintCss.ruleFor(big);
  assert.strictEqual((rule.match(/linear-gradient/g) || []).length, paintCss.MAX_LAYERS);
  // the shared budget can end the chain before MAX_SHADOWS (here the first shadow spends it all)
  const nShadows = (rule.match(/drop-shadow/g) || []).length;
  assert.ok(nShadows >= 1 && nShadows <= paintCss.MAX_SHADOWS, 'shadows ' + nShadows);
  // the offset is scaled as a whole (direction kept): x hits the 32px cap, y shrinks by the same factor
  assert.match(rule, /drop-shadow\(32px -1\.92px 32px #ff0000\)/);
  // drop-shadows stack (each offsets the previous result): the whole chain shares one budget per axis and for blur
  const sums = [0, 0, 0];
  (rule.match(/drop-shadow\((-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px/g) || []).forEach((d) => {
    const n = d.match(/-?[\d.]+/g).map(Number);
    for (let k = 0; k < 3; k++) sums[k] += Math.abs(n[k]);
  });
  sums.forEach((v) => assert.ok(v <= paintCss.MAX_SHADOW_PX, 'chain total ' + v));
  const v3 = paintCss.ruleFor(paintCss.fromV3({ id: 'b2', function: 'LINEAR_GRADIENT', stops: Array.from({ length: 100 }, (_, i) => ({ at: i / 100, color: 255 })),
    shadows: [{ x_offset: 0, y_offset: -400, radius: 3, color: 255 }] }));
  assert.strictEqual((v3.match(/rgba\(/g) || []).length, paintCss.MAX_STOPS + 1, 'stops capped (+1 for the shadow color)');
  assert.match(v3, /drop-shadow\(0px -32px 3px /);
});

test('Zalgo: runs of combining marks are capped at 4, real scripts and emoji are untouched', () => {
  const zalgo = 'H' + '\u030D\u0352\u0316\u0353'.repeat(120);
  assert.strictEqual(util.capMarks(zalgo), 'H\u030D\u0352\u0316\u0353');
  const zwj = 'a' + '\u0300\u0301\u0302\u200D'.repeat(160);
  assert.ok([...util.capMarks(zwj)].length <= 1 + 4 * 2, 'format characters between marks do not reset the count');
  ['é', 'ệ', 'Tiếng Việt', 'क्षत्रिय', 'नमस्ते', 'สวัสดีครับ', 'שָׁלוֹם', '1️⃣', '#️⃣', '❤️', '👍🏽', '🏳️‍🌈', '👩🏽‍❤️‍💋‍👨🏻', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'].forEach((s) => {
    assert.strictEqual(util.capMarks(s), s, s);
  });
  assert.strictEqual(util.capMarks(undefined), undefined);
  // Through the renderer: message text, name, reply and notice text are capped...
  const m = model({ 'reply-parent-msg-id': 'x', 'reply-parent-display-name': 'R', 'reply-parent-msg-body': zalgo }, zalgo + ' hi');
  assert.strictEqual(m.parts[0].s, 'H\u030D\u0352\u0316\u0353 hi');
  assert.strictEqual(m.reply.body, 'H\u030D\u0352\u0316\u0353');
  assert.strictEqual(R.modelFor({ systemMsg: zalgo }, R.normalizeCfg({}), { kind: 'notice' }).system, 'H\u030D\u0352\u0316\u0353');
  // ...after tokenizing, so Twitch emote ranges (code points in the original text) still line up.
  const withEmote = model({ emotes: '25:7-11' }, 'a\u0300\u0301\u0302\u0303\u0304 Kappa'); // a + 5 marks + space = 7 code points
  assert.strictEqual(withEmote.parts[1].t, 'emote');
  assert.strictEqual(withEmote.parts[1].name, 'Kappa');
  // a long hostile string is fast (no catastrophic backtracking)
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) util.capMarks(('a' + '\u0300'.repeat(30) + '\u200D').repeat(50));
  assert.ok(Date.now() - t0 < 1000);
});

test('pickUrl: https only', () => {
  assert.strictEqual(R.pickUrl({ 1: 'https://cdn.7tv.app/x' }, 1), 'https://cdn.7tv.app/x');
  assert.strictEqual(R.pickUrl({ 1: '//cdn.7tv.app/x' }, 1), 'https://cdn.7tv.app/x');
  ['http://cdn.7tv.app/x', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/png,x', 'blob:https://x/y', '/relative.png', 'https://a b'].forEach((u) => {
    assert.strictEqual(R.pickUrl({ 1: u }, 1), null, u);
  });
});
