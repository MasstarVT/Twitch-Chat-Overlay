'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mixitup = require('../js/mixitup.js');

// tests/fixtures/mixitup-*.json: frames built from Mix It Up's source (OverlayChatV3Model, OverlayV3Service,
// UserV2ViewModel), not yet captured from a running Mix It Up; a capture will replace them.
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const ADD = fixture('mixitup-youtube-add.json');
const PACKETS = fixture('mixitup-packets.json');
const GUID = ADD.guid;
const OTHER = '0d9c8b7a-6f5e-4d3c-2b1a-098765432100';
const ZERO = '00000000-0000-0000-0000-000000000000';
const MSG_ID = ADD.packet.Data.Parameters.MessageID;
const ch = (n) => String.fromCharCode(n);
const YT = 'https://yt3.ggpht.com/m6yqTzfmHlsoKKEZRSZCkqf6cGSeHtStY4rIeeXLAk4N9GY_yw3dizdZoxTrjLhlY4r_rkz3GA=w48-h48-c-k-nd';
const BTTV = 'https://cdn.betterttv.net/emote/56e9f494fff3cc5c35e5287e/1x';

// The fixture's add parameters, with changes.
function params(extra, userExtra) {
  const p = JSON.parse(JSON.stringify(ADD.packet.Data.Parameters));
  if (userExtra) Object.assign(p.User, userExtra);
  return Object.assign(p, extra || {});
}
function msg(extra, userExtra) { return mixitup.toMessage(params(extra, userExtra), 1000, GUID); }
// A message of these parts: strings are Text parts.
function said(parts, userExtra) {
  return msg({ Message: parts.map((w) => (typeof w === 'string' ? { Type: 'Text', Content: w } : w)) }, userExtra);
}
const emote = (name, url, provider) => ({ Type: 'Emote', Content: url, Name: name, Provider: provider || 'youtube' });
const emotesOf = (m) => Object.entries(m.youtubeEmotes);
const badgesOf = (roles) => msg(null, { Roles: roles }).youtubeBadges.map((b) => b.type);
function packet(fn, parameters, id) {
  return { $type: 'MixItUp.Base.Services.OverlayV3Packet, MixItUp.Base', Type: 'Function',
    Data: { ID: id === undefined ? GUID : id, FunctionName: fn, Parameters: parameters } };
}
const ytUser = (extra) => Object.assign({ ID: '99999999-8888-4777-8666-555555555555', Platform: 3, PlatformID: 'UCspAmB0t3000xxxxxxxxxxx',
  Username: 'Spam Bot', DisplayName: 'Spam Bot', Roles: [100] }, extra || {});
// A deleted message (remove by id): the simplest event a packet gives.
const del = (id) => packet('remove', { MessageID: 'm-1' }, id);
const DELETED = { type: 'delete', id: 'youtube:m-1' };
// Mix It Up's answer to ConnectionStart: the widget's HTML, naming the widget.
const ANSWER = PACKETS.answer;
const answer = (id) => Object.assign({}, ANSWER, { Data: Object.assign({}, ANSWER.Data, { ID: id }) });
// Mix It Up taking the widget's HTML away: the widget was disabled (or reset or edited: then an Add follows).
const REMOVED = PACKETS.removed;
const removed = (id) => Object.assign({}, REMOVED, { Data: Object.assign({}, REMOVED.Data, { ID: id }) });
const HELLO = { Type: 'ConnectionStart', Data: '' };

// Minimal WebSocket stand-in driven by the test (same shape as tests/kick.test.js).
function fakeSockets() {
  const sockets = [];
  function FakeWS(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    sockets.push(this);
  }
  FakeWS.prototype.send = function (s) { this.sent.push(JSON.parse(s)); };
  FakeWS.prototype.close = function () { this.closed = true; };
  FakeWS.prototype.open = function () { if (this.onopen) this.onopen({}); };
  FakeWS.prototype.recv = function (frame) { if (this.onmessage) this.onmessage({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); };
  FakeWS.prototype.serverClose = function (code, reason) { if (this.onclose) this.onclose({ code: code || 1006, reason: reason || '' }); };
  return { WS: FakeWS, sockets: sockets };
}

function setup(t, opts) {
  if (!t.timersOn) { // a test may set up more than one client
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    t.timersOn = true;
  }
  const f = fakeSockets();
  const events = [];
  const statuses = [];
  let clock = 1760050000000;
  const client = mixitup.createMixItUp(Object.assign({
    guid: GUID,
    WebSocket: f.WS,
    now: () => clock++,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s)
  }, opts || {}));
  client.start();
  return { f, events, statuses, client, sock: (i) => f.sockets[i], types: () => statuses.map((s) => s.type) };
}

// ---------- the widget's link ----------
test('parseLink takes the widget\'s GUID, its link or its socket\'s, on this computer only', () => {
  const U = GUID.toUpperCase();
  [
    [GUID, 8111],
    ['  ' + U + '\n', 8111],
    ['{' + GUID + '}', 8111],
    [' {' + U + '} ', 8111],
    ['http://localhost:8111/overlay/' + GUID, 8111],
    ['http://localhost/overlay/' + GUID, 8111],
    ['http://localhost:8200/overlay/' + GUID + '/', 8200],
    ['HTTP://LOCALHOST:8111/OVERLAY/' + U, 8111],
    ['https://127.0.0.1:9000/overlay/' + GUID + '?x=1&y=<b>', 9000],
    ['http://localhost:8111/overlay/' + GUID + '#top', 8111],
    ['http://localhost:8111/overlay/' + GUID + '/?a=b#c', 8111],
    ['ws://localhost:8111/ws/' + GUID + '/', 8111],
    ['ws://127.0.0.1:8111/ws/' + GUID, 8111],
    ['WSS://LocalHost:12345/WS/' + U + '/', 12345],
    ['http://localhost:1024/overlay/' + GUID, 1024],
    ['http://localhost:65535/overlay/' + GUID, 65535],
    ['http://localhost:08111/overlay/' + GUID, 8111] // a leading zero, read as a browser reads it
  ].forEach(([text, port]) => assert.deepStrictEqual(mixitup.parseLink(text), { guid: GUID, port: port }, text));
  assert.strictEqual(mixitup.DEFAULT_PORT, 8111);
});

test('parseLink refuses other hosts, lookalikes, other paths, bad ports and the default endpoint\'s zero GUID', () => {
  const link = (s) => 'http://' + s + '/overlay/' + GUID;
  [
    // Mix It Up's default endpoint carries every widget's traffic.
    ZERO, '{' + ZERO + '}', 'http://localhost:8111/overlay/' + ZERO, 'ws://localhost:8111/ws/' + ZERO + '/',
    // Ports: digits only, 1024 to 65535.
    link('localhost:80'), link('localhost:1023'), link('localhost:65536'), link('localhost:0'), link('localhost:abc'),
    link('localhost:'), link('localhost:123456'), link('localhost:-8111'), link('localhost:+8111'), link('localhost:8111.0'),
    // Hosts: localhost and 127.0.0.1 only.
    link('[::1]:8111'), link('0.0.0.0:8111'), link('192.168.1.5:8111'), link('example.com:8111'), link('127.0.0.2:8111'),
    link('localhost.evil.com:8111'), link('localhost@evil.com'), link('user@localhost:8111'), link('user:pw@localhost:8111'),
    link('xlocalhost:8111'), link('evil.com/localhost:8111'), link('localhost:8111@evil.com'), link('localhost.:8111'),
    link('127.0.0.1.evil.com'), link('localhost%2Eevil.com'), link('localhost\\@evil.com'),
    // Paths of another shape.
    'http://localhost:8111/ws/' + GUID, 'ws://localhost:8111/overlay/' + GUID, 'ws://localhost:8111/ws/' + GUID + '/?x=1',
    'http://localhost:8111/overlay/' + GUID + '/extra', 'http://localhost:8111/overlay/' + GUID + 'x',
    'http://localhost:8111/overlay//' + GUID, 'http://localhost:8111/overlay/data/' + GUID, 'http://localhost:8111/' + GUID,
    'http://localhost:8111/overlay', 'http://localhost:8111/overlay/', 'http://localhost:8111/overlay/' + GUID + ' and more',
    // Other schemes and shapes.
    '//localhost:8111/overlay/' + GUID, 'localhost:8111/overlay/' + GUID, 'http:/localhost:8111/overlay/' + GUID,
    'ftp://localhost/overlay/' + GUID, 'file:///overlay/' + GUID, 'javascript:alert(1)//' + GUID,
    // Not a GUID.
    '{' + GUID, GUID + '}', '(' + GUID + ')', GUID.slice(1), GUID + 'a', GUID.replace(/-/g, ''), GUID.replace('a', 'g'),
    'x' + GUID, GUID + ' ' + GUID, '{{' + GUID + '}}',
    '', '   ', null, undefined, 8111, {}, [GUID], 'x'.repeat(5000) + GUID
  ].forEach((v) => assert.strictEqual(mixitup.parseLink(v), null, String(v).slice(0, 80)));
});

test('wsUrl and widgetUrl are built only from a checked GUID and port', () => {
  assert.strictEqual(mixitup.wsUrl(GUID, 8111), 'ws://localhost:8111/ws/' + GUID + '/');
  assert.strictEqual(mixitup.wsUrl(GUID), 'ws://localhost:8111/ws/' + GUID + '/');
  assert.strictEqual(mixitup.wsUrl(GUID.toUpperCase(), '8200'), 'ws://localhost:8200/ws/' + GUID + '/');
  assert.strictEqual(mixitup.widgetUrl(GUID, 8111), 'http://localhost:8111/overlay/' + GUID);
  assert.strictEqual(mixitup.widgetUrl('{' + GUID + '}', 65535), 'http://localhost:65535/overlay/' + GUID);
  const p = mixitup.parseLink('ws://127.0.0.1:9001/ws/' + GUID);
  assert.strictEqual(mixitup.wsUrl(p.guid, p.port), 'ws://localhost:9001/ws/' + GUID + '/');
  [[ZERO, 8111], ['../' + GUID, 8111], [GUID + '/../x', 8111], ['x', 8111], [null, 8111], [GUID, 80], [GUID, 65536],
    [GUID, '81 11'], [GUID, 8111.5], [GUID, -1], [GUID, NaN], [GUID, '8111/../'], [GUID, {}], [GUID, true]].forEach(([g, port]) => {
    assert.strictEqual(mixitup.wsUrl(g, port), '', String(g) + ' ' + String(port));
    assert.strictEqual(mixitup.widgetUrl(g, port), '', String(g) + ' ' + String(port));
  });
});

// ---------- ids ----------
test('idOf and userKey: namespaced ids, or \'\'', () => {
  assert.strictEqual(mixitup.idOf(MSG_ID), 'youtube:' + MSG_ID);
  assert.strictEqual(mixitup.idOf('LCC.abc-_%3D=='), 'youtube:LCC.abc-_%3D==');
  assert.strictEqual(mixitup.idOf('885196de-cb67-427a-baa8-82f9b0fcd05f'), 'youtube:885196de-cb67-427a-baa8-82f9b0fcd05f');
  assert.strictEqual(mixitup.idOf('x'.repeat(512)), 'youtube:' + 'x'.repeat(512));
  ['', 'a b', 'a\tb', 'a\nb', ' LCC.x', '<x>', 'a"b', "a'b", 'a\\b', 'a`b', 'x'.repeat(513), 'a' + ch(0) + 'b', 'a' + ch(0x85) + 'b',
    'a' + ch(0xa0) + 'b', 'a' + ch(0x2028) + 'b', 123, null, undefined, {}, ['x']].forEach((v) => assert.strictEqual(mixitup.idOf(v), '', String(v)));

  const u = ADD.packet.Data.Parameters.User;
  assert.strictEqual(mixitup.userKey(u), 'youtube:UCxM2a8kJYyHHLqZpQ7sQ1nA');
  // No usable channel id: Mix It Up's own id for the chatter.
  ['UC x', '', 'UC/../x', 'a'.repeat(65), 123, null].forEach((pid) => {
    assert.strictEqual(mixitup.userKey(Object.assign({}, u, { PlatformID: pid })), 'youtube:2b7e1d4c-9a3f-4c61-b8e2-5d0f7a1c3e94', String(pid));
  });
  assert.strictEqual(mixitup.userKey({ ID: '2B7E1D4C-9A3F-4C61-B8E2-5D0F7A1C3E94' }), 'youtube:2b7e1d4c-9a3f-4c61-b8e2-5d0f7a1c3e94');
  assert.strictEqual(mixitup.userKey({ ID: ZERO }), '', 'an unassociated user has no key');
  assert.strictEqual(mixitup.userKey({ ID: 'x' }), '');
  [null, undefined, 'UCxM2a8kJYyHHLqZpQ7sQ1nA', [u], 5].forEach((v) => assert.strictEqual(mixitup.userKey(v), '', String(v)));
});

// ---------- messages ----------
test('toMessage: the fixture\'s YouTube line, in the renderer\'s message shape', () => {
  const m = mixitup.toMessage(ADD.packet.Data.Parameters, () => 1760051112000, GUID);
  const { youtubeEmotes, ...rest } = m;
  assert.deepStrictEqual(rest, {
    platform: 'youtube',
    id: 'youtube:' + MSG_ID,
    sourceId: '',
    roomId: 'youtube:' + GUID,
    sourceRoomId: '',
    mirrored: false,
    userId: 'youtube:UCxM2a8kJYyHHLqZpQ7sQ1nA',
    login: 'pixelfox.plays',
    displayName: 'PixelFox.Plays',
    color: '',
    badges: [],
    sourceBadges: [],
    kickBadges: [],
    youtubeBadges: [{ type: 'member' }],
    ts: 1760051112000,
    historical: false,
    kind: 'chat',
    text: 'hello chat :hand-pink-waving: first stream in a while monkaS :not-an-emoji:',
    action: false,
    emotes: '',
    kickEmotes: '',
    gifs: '',
    bits: 0,
    msgId: '',
    firstMsg: false,
    reply: null
  });
  assert.strictEqual(Object.getPrototypeOf(youtubeEmotes), null);
  // A YouTube emoji and a BetterTTV emote; ':not-an-emoji:' came as text, so it stays text.
  assert.deepStrictEqual(Object.entries(youtubeEmotes), [[':hand-pink-waving:', YT], ['monkaS', BTTV]]);
});

test('toMessage: every field of a Kick line (kick.js base()), plus the YouTube ones', () => {
  const kick = require('../js/kick.js');
  const k = kick.toMessage({ id: 'abc-1', chatroom_id: 1, content: 'hi', sender: { id: 7, username: 'u', identity: {} } });
  const y = msg();
  assert.deepStrictEqual(Object.keys(y).filter((key) => !(key in k)).sort(), ['youtubeBadges', 'youtubeEmotes']);
  // The profile picture (AvatarLink) is not read: nothing draws it.
  assert.ok(!Object.keys(y).some((key) => /avatar/i.test(key)));
  assert.deepStrictEqual(Object.keys(k).filter((key) => !(key in y)), []);
  Object.keys(k).forEach((key) => assert.strictEqual(typeof y[key], typeof k[key], key));
});

test('toMessage: role badges from Mix It Up\'s role numbers or names, most important first, each once', () => {
  assert.deepStrictEqual(badgesOf([100, 601, 600]), ['member']);
  assert.deepStrictEqual(badgesOf([100, 800]), ['moderator']);
  assert.deepStrictEqual(badgesOf([100, 900]), ['owner']);
  assert.deepStrictEqual(badgesOf([301, 601, 100, 800, 900]), ['owner', 'moderator', 'member']);
  assert.deepStrictEqual(mixitup.BADGE_TYPES, ['owner', 'moderator', 'member']);
  assert.deepStrictEqual(badgesOf([600]), ['member'], 'Subscriber comes with YouTubeMember on YouTube');
  assert.deepStrictEqual(badgesOf([601, 600, 601, 800, 800]), ['moderator', 'member']);
  assert.deepStrictEqual(badgesOf(['Streamer', 'MODERATOR', ' YouTubeMember ']), ['owner', 'moderator', 'member']);
  // A YouTube channel subscriber (YouTubeSubscriber, 301) gets no badge.
  assert.deepStrictEqual(badgesOf([301, 'YouTubeSubscriber']), []);
  assert.deepStrictEqual(badgesOf(['Subscriber']), ['member']);
  assert.deepStrictEqual(badgesOf(['900', '800']), ['owner', 'moderator']);
  // Other roles (User, Regular, VIP...) and junk give none.
  assert.deepStrictEqual(badgesOf([100, 400, 0, -1, 900.5, 1e9, NaN, null, {}, [], [900], true, 'constructor', '__proto__', 'toString',
    'hasOwnProperty', 'Owner', 'x'.repeat(100), 'Streamer'.repeat(10)]), []);
  [null, undefined, 'Moderator', 900, { 900: true }].forEach((r) => assert.deepStrictEqual(badgesOf(r), [], String(r)));
  // Bounded: roles past the first 50 are not read.
  assert.deepStrictEqual(badgesOf(new Array(50).fill(100).concat([900])), []);
});

test('toMessage: emote parts are their names in the text, and https images by name in youtubeEmotes', () => {
  const m = said(['hi', emote(':face-blue-smiling:', YT), emote('monkaS', BTTV, 'BetterTTV'), 'there']);
  assert.strictEqual(m.text, 'hi :face-blue-smiling: monkaS there');
  assert.deepStrictEqual(emotesOf(m), [[':face-blue-smiling:', YT], ['monkaS', BTTV]]);
  // The same emote twice is one key; the same name with another image keeps the first.
  const twice = said([emote(':a:', YT), emote(':a:', YT), emote(':a:', BTTV)]);
  assert.strictEqual(twice.text, ':a: :a: :a:');
  assert.deepStrictEqual(emotesOf(twice), [[':a:', YT]]);
  // Type is read in any case; Provider doesn't matter.
  const any = said([{ Type: 'TEXT', Content: 'x' }, { Type: 'emote', Content: YT, Name: ':b:' }, { Type: 'Emote', Content: BTTV, Name: 'c', Provider: 7 }]);
  assert.strictEqual(any.text, 'x :b: c');
  assert.deepStrictEqual(emotesOf(any).map((e) => e[0]), [':b:', 'c']);
  // A protocol-relative image is https.
  assert.deepStrictEqual(emotesOf(said([emote(':p:', '//yt3.ggpht.com/p=w48')])), [[':p:', 'https://yt3.ggpht.com/p=w48']]);
});

test('toMessage: an emote image that is not a plain https URL is dropped, and its name stays text', () => {
  ['http://yt3.ggpht.com/x', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://x.example/a b', 'https://x.example/"onerror="x',
    'https://x.example/a)', "https://x.example/a'", 'https://x.example/<b>', 'ftp://x.example/a', 'https://x.example/' + 'a'.repeat(2100),
    '', null, 5, {}, ['https://x.example/a']].forEach((url) => {
    const m = said(['look', emote(':bad:', url)]);
    assert.strictEqual(m.text, 'look :bad:', String(url).slice(0, 60));
    assert.deepStrictEqual(emotesOf(m), [], String(url).slice(0, 60));
  });
  // A good image elsewhere in the message still names that word.
  assert.deepStrictEqual(emotesOf(said([emote(':e:', 'http://x/a'), emote(':e:', YT)])), [[':e:', YT]]);
});

test('toMessage: an emote name is one word; a nameless emote gets a placeholder per image', () => {
  const m = said([emote(' :face with spaces: ', YT), emote('a' + ch(0) + ch(0x1b) + 'b' + ch(0x85), BTTV)]);
  assert.strictEqual(m.text, ':facewithspaces: ab');
  assert.deepStrictEqual(emotesOf(m), [[':facewithspaces:', YT], ['ab', BTTV]]);
  const u1 = 'https://yt3.ggpht.com/one', u2 = 'https://yt3.ggpht.com/two';
  const nameless = said([emote('', u1), emote(null, u2), { Type: 'Emote', Content: u1 }, emote('  ', 'javascript:x'), 'end']);
  assert.strictEqual(nameless.text, ':emoji-1: :emoji-2: :emoji-1: end', 'a nameless emote without an image is left out');
  assert.deepStrictEqual(emotesOf(nameless), [[':emoji-1:', u1], [':emoji-2:', u2]]);
  // A long name is cut at 100 code points.
  const long = said([emote(':' + 'x'.repeat(300) + ':', YT)]);
  assert.strictEqual(long.text, ':' + 'x'.repeat(99));
  assert.deepStrictEqual(emotesOf(long).map((e) => e[0]), [':' + 'x'.repeat(99)]);
});

test('toMessage: words like __proto__ and constructor are plain keys of youtubeEmotes', () => {
  const m = said([emote('__proto__', YT), emote('constructor', BTTV), emote('toString', YT), 'hasOwnProperty', '__proto__', 'valueOf']);
  assert.strictEqual(m.text, '__proto__ constructor toString hasOwnProperty __proto__ valueOf');
  const map = m.youtubeEmotes;
  assert.strictEqual(Object.getPrototypeOf(map), null);
  assert.deepStrictEqual(Object.keys(map), ['__proto__', 'constructor', 'toString']);
  assert.strictEqual(map.__proto__, YT);
  assert.strictEqual(map.constructor, BTTV);
  assert.ok(!Object.prototype.hasOwnProperty.call(map, 'hasOwnProperty'));
  assert.strictEqual(({}).constructor, Object, 'Object.prototype untouched');
  assert.strictEqual(typeof ({}).toString, 'function');
  // As a lookup would read it, and after a JSON round trip.
  const has = (w) => Object.prototype.hasOwnProperty.call(map, w);
  assert.deepStrictEqual(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'].map(has), [true, true, true, false, false]);
  const copy = JSON.parse(JSON.stringify(map));
  assert.deepStrictEqual(Object.keys(copy), ['__proto__', 'constructor', 'toString']);
  // A role or a platform named so is no role and no platform.
  assert.strictEqual(msg({ Platform: '__proto__' }), null);
});

test('toMessage: text is the words joined by one space; empty parts are skipped, line breaks are spaces', () => {
  assert.strictEqual(said(['', ' ', 'a  b', '\t', 'c\nd', '  e  ', 'f\r\ng' + ch(0x2028) + 'h']).text, 'a  b c d e f  g h');
  assert.strictEqual(said(['solo']).text, 'solo');
  // Not a part: skipped.
  assert.strictEqual(said([null, 'x', 5, 'y', [], { Type: 5, Content: 'z' }, { Type: 'Text' }, { Type: 'Text', Content: 7 },
    { Type: 'Text', Content: { a: 1 } }, { Type: 'Link', Content: 'https://x' }, { Content: 'w' }]).text, 'x y');
  // Nothing to show: no message.
  [[], ['', '  ', '\n'], [null, 5], [emote('', 'http://x')]].forEach((parts) => assert.strictEqual(said(parts), null, JSON.stringify(parts)));
  [undefined, null, 'hello', { 0: { Type: 'Text', Content: 'x' } }].forEach((v) => assert.strictEqual(msg({ Message: v }), null, String(v)));
});

test('toMessage: hostile sizes are bounded (1000 code points of text, 500 parts, 100 emote images)', () => {
  assert.strictEqual(said(['x'.repeat(5000)]).text, 'x'.repeat(1000));
  assert.strictEqual(said(['x'.repeat(10000000)]).text.length, 1000);
  const smile = String.fromCodePoint(0x1f600);
  const emoji = said([smile.repeat(2000)]).text;
  assert.strictEqual(Array.from(emoji).length, 1000);
  assert.strictEqual(emoji, smile.repeat(1000), 'no half of a surrogate pair');
  // Parts past the 500th are not read.
  assert.strictEqual(said(new Array(100000).fill('a')).text.split(' ').length, 500);
  // Words: 995 code points, then an emote that doesn't fit is not cut in half (nor named), and the text stops there.
  const fill = new Array(199).fill('abcd').concat(['abc']); // 199 * 5 + 3 = 998 with the spaces
  assert.strictEqual(said(fill).text.length, 998);
  const cut = said(fill.concat([emote(':wave:', YT), 'more']));
  assert.strictEqual(cut.text.length, 998);
  assert.deepStrictEqual(emotesOf(cut), []);
  // A text word is cut to fit.
  const last = said(fill.concat(['wxyz']));
  assert.strictEqual(last.text.length, 1000);
  assert.ok(last.text.endsWith(' w'));
  // 150 different emotes: all in the text, the first 100 with images.
  const many = said(Array.from({ length: 150 }, (_, i) => emote(':e' + i + ':', 'https://yt3.ggpht.com/e' + i)));
  assert.strictEqual(many.text.split(' ').length, 150);
  assert.strictEqual(emotesOf(many).length, 100);
  assert.deepStrictEqual(emotesOf(many)[99], [':e99:', 'https://yt3.ggpht.com/e99']);
  // Every key is a whole word of the text.
  const wordsOf = new Set(many.text.split(' '));
  Object.keys(many.youtubeEmotes).forEach((k) => assert.ok(wordsOf.has(k), k));
});

test('toMessage: YouTube only; null for another platform, garbage or unusable ids and names', () => {
  // The widget sends every platform's chat by default: Twitch and Kick lines come from the overlay's own connections.
  ['Twitch', 'Kick', 'Velora', 'Mock', 'All', '', 'YouTube2', 'You Tube', 2, 7, 99999, null, undefined, {}, ['YouTube']].forEach((p) => {
    assert.strictEqual(msg({ Platform: p }), null, String(p));
  });
  ['youtube', 'YOUTUBE', ' YouTube ', 3].forEach((p) => assert.ok(msg({ Platform: p }), String(p)));
  [null, undefined, 'x', 5, [], [params()], true].forEach((v) => assert.strictEqual(mixitup.toMessage(v, 1), null, String(v)));
  [undefined, null, '', 'a b', '<x>', 'x'.repeat(513), 42, {}].forEach((id) => assert.strictEqual(msg({ MessageID: id }), null, String(id)));
  [undefined, null, 'PixelFox', [], 5].forEach((u) => assert.strictEqual(msg({ User: u }), null, String(u)));
  assert.strictEqual(msg(null, { PlatformID: null, ID: ZERO }), null, 'no user key');
  assert.strictEqual(msg(null, { PlatformID: null }).userId, 'youtube:2b7e1d4c-9a3f-4c61-b8e2-5d0f7a1c3e94');
  // The name: DisplayName, else Username; none (or only invisible characters) is no message.
  assert.strictEqual(msg(null, { DisplayName: '' }).displayName, 'PixelFox.Plays');
  assert.strictEqual(msg(null, { DisplayName: 5, Username: 'Other' }).displayName, 'Other');
  assert.strictEqual(msg(null, { DisplayName: '', Username: '' }), null);
  assert.strictEqual(msg(null, { DisplayName: '  ', Username: ch(0) + ch(0x202e) + ' ' }), null);
  assert.strictEqual(msg(null, { DisplayName: null, Username: null }), null);
  // Twitch's fields mean nothing here.
  const m = msg({ IsFirstMessage: true, IsHighlightedMessage: true, BitsAmount: 500, MessageType: 'user_intro' });
  assert.deepStrictEqual([m.firstMsg, m.bits, m.msgId, m.action, m.reply], [false, 0, '', false, null]);
});

test('toMessage: names are shown as YouTube has them, cleaned of control characters; the login is the name in lower case', () => {
  const name = (n) => msg(null, { DisplayName: n });
  assert.deepStrictEqual([name('Ana María López').displayName, name('Ana María López').login], ['Ana María López', 'ana maría lópez']);
  assert.strictEqual(name('日本語の名前').login, '日本語の名前');
  assert.deepStrictEqual([name('@Handle').displayName, name('@Handle').login], ['@Handle', 'handle']);
  assert.strictEqual(name('  Padded  ').displayName, 'Padded');
  // A YouTube handle may hold '-' and '.': shown as it is; in the login '-' is '_' (config.normalizeLogin writes the
  // block list and the other name lists so) and '.' stays.
  assert.deepStrictEqual([name('Some-Handle.yt').displayName, name('Some-Handle.yt').login], ['Some-Handle.yt', 'some_handle.yt']);
  assert.deepStrictEqual(['@@x-y', 'a--b', '@', '-', 'Mod Squad-Lead'].map((s) => mixitup.loginOf(s)), ['x_y', 'a__b', '@', '_', 'mod squad_lead']);
  // Control characters and bidi overrides (which would turn the rest of the line around) are taken out.
  const evil = name('Evil' + ch(0x202e) + 'eman' + ch(0) + ch(0x1b) + ch(0x85) + ch(0x2066) + ch(0x2069) + '!');
  assert.strictEqual(evil.displayName, 'Evileman!');
  assert.strictEqual(name('x'.repeat(300)).displayName, 'x'.repeat(100));
  const smiles = name(String.fromCodePoint(0x1f600).repeat(150)).displayName;
  assert.strictEqual(Array.from(smiles).length, 100);
  assert.strictEqual(smiles.length, 200, 'no half of a surrogate pair');
  // Markup is only text.
  assert.strictEqual(name('<img src=x onerror=alert(1)>').displayName, '<img src=x onerror=alert(1)>');
});

test('toMessage: a name of only invisible characters is no name: the other name field, else no message', () => {
  const blanks = [
    ch(0x200b), ch(0x200c) + ch(0x200d), ch(0x200e) + ch(0x200f) + ch(0x061c), ch(0x2060) + ch(0x2061) + ch(0x2062) + ch(0x2063) + ch(0x2064),
    ch(0xfeff), String.fromCodePoint(0xe0041, 0xe0062, 0xe007f), ch(0x3164), ch(0x115f) + ch(0x1160), ch(0xffa0), ch(0x00ad),
    ch(0x034f), ch(0x180e), ' ' + ch(0x200b) + ' ' + ch(0x3000) + ch(0xa0), ch(0x202e) + ch(0x200b)
  ];
  blanks.forEach((b) => {
    const label = Array.from(b).map((c) => c.codePointAt(0).toString(16)).join(' ');
    const m = msg(null, { DisplayName: b, Username: 'Fallback-Name' });
    assert.deepStrictEqual([m.displayName, m.login], ['Fallback-Name', 'fallback_name'], label);
    assert.strictEqual(msg(null, { DisplayName: 'Shown', Username: b }).displayName, 'Shown', label);
    assert.strictEqual(msg(null, { DisplayName: b, Username: b }), null, label);
  });
  // Invisible characters inside a visible name stay (an emoji's joiner, a mark in a script that needs it).
  const family = String.fromCodePoint(0x1f468) + ch(0x200d) + String.fromCodePoint(0x1f469);
  assert.strictEqual(msg(null, { DisplayName: family }).displayName, family);
  assert.strictEqual(msg(null, { DisplayName: 'a' + ch(0x200b) + 'b' }).displayName, 'a' + ch(0x200b) + 'b');
  // A ban names the chatter the same way.
  const ban = mixitup.parsePacket(packet('remove', { Username: 'From-Params', User: ytUser({ DisplayName: ch(0x200b), Username: ch(0xfeff) }) }));
  assert.deepStrictEqual(ban, [{ type: 'ban', userId: 'youtube:UCspAmB0t3000xxxxxxxxxxx', login: 'from_params' }]);
});

test('toMessage: a color only when it is #rrggbb (YouTube names have none unless set in Mix It Up); ColorInApp is never one', () => {
  assert.strictEqual(msg().color, '', 'the fixture: Color null, ColorInApp a WPF resource key');
  assert.strictEqual(msg(null, { Color: '#1E90FF' }).color, '#1E90FF');
  assert.strictEqual(msg(null, { Color: '#a1b2c3' }).color, '#a1b2c3');
  ['#abc', 'red', '#1E90FF; x', '#1E90FFAA', ' #1E90FF', 'MaterialDesign.Brush.Foreground', 0x1e90ff, null, {}].forEach((c) => {
    assert.strictEqual(msg(null, { Color: c }).color, '', String(c));
  });
  assert.strictEqual(msg(null, { Color: null, ColorInApp: '#FF0000' }).color, '');
});

test('toMessage: stamped when it arrives (Mix It Up sends no time), never historical; the room is the widget\'s', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1760000000000 });
  const p = params();
  assert.strictEqual(mixitup.toMessage(p, () => 1760051112345).ts, 1760051112345);
  assert.strictEqual(mixitup.toMessage(p, 1760051112999).ts, 1760051112999);
  [undefined, null, () => { throw new Error('clock'); }, () => NaN, () => -5, () => 'soon', NaN, Infinity, 'x'].forEach((now) => {
    assert.strictEqual(mixitup.toMessage(p, now).ts, 1760000000000, String(now));
  });
  assert.strictEqual(mixitup.toMessage(p, 1).historical, false);
  assert.strictEqual(mixitup.toMessage(p, 1, GUID.toUpperCase()).roomId, 'youtube:' + GUID);
  assert.strictEqual(mixitup.toMessage(p, 1, '{' + GUID + '}').roomId, 'youtube:' + GUID);
  [undefined, '', 'x', ZERO, 5].forEach((g) => assert.strictEqual(mixitup.toMessage(p, 1, g).roomId, 'youtube:', String(g)));
});

// ---------- packets ----------
test('parsePacket: one packet, as text or parsed; $type and the User\'s other fields are ignored', () => {
  const fromText = mixitup.parsePacket(JSON.stringify(ADD.packet), { now: () => 7, guid: GUID });
  const fromObject = mixitup.parsePacket(ADD.packet, { now: () => 7, guid: GUID });
  assert.strictEqual(fromText.length, 1);
  assert.strictEqual(fromText[0].type, 'message');
  assert.deepStrictEqual(fromObject, fromText);
  assert.strictEqual(fromText[0].msg.ts, 7);
  assert.strictEqual(fromText[0].msg.roomId, 'youtube:' + GUID);
  const bare = JSON.parse(JSON.stringify(ADD.packet));
  delete bare.$type;
  assert.deepStrictEqual(mixitup.parsePacket(bare, { now: () => 7, guid: GUID }), fromText);
  bare.$type = { evil: true };
  assert.deepStrictEqual(mixitup.parsePacket(bare, { now: () => 7, guid: GUID }), fromText);
  const m = mixitup.toMessage(ADD.packet.Data.Parameters, 7, GUID);
  assert.deepStrictEqual(fromText[0].msg, m);
});

test('parsePacket: a batched frame -> its chat events in order; other widgets\' calls, other platforms and non-chat packets left out', () => {
  const evs = mixitup.parsePacket(JSON.stringify(PACKETS.frame), { now: () => 9, guid: PACKETS.guid });
  assert.deepStrictEqual(evs.map((e) => e.type), ['message', 'delete', 'ban', 'widget']);
  const m = evs[0].msg;
  assert.deepStrictEqual([m.text, m.displayName, m.login, m.userId, m.color], ['please keep it friendly', 'Mod Squad Lead', 'mod squad lead',
    'youtube:UC9zY8xW7vU6tS5rQ4pO3nMl', '']);
  assert.deepStrictEqual(m.youtubeBadges, [{ type: 'moderator' }]);
  assert.deepStrictEqual(evs[1], { type: 'delete', id: 'youtube:' + MSG_ID });
  assert.deepStrictEqual(evs[2], { type: 'ban', userId: 'youtube:UCspAmB0t3000xxxxxxxxxxx', login: 'spam bot 3000' });
  assert.deepStrictEqual(evs[3], { type: 'widget', id: GUID }, 'the widget\'s HTML (Add): only its guid is read');
  // Without a guid, nothing is told apart by widget: the other widget's YouTube line comes too.
  assert.deepStrictEqual(mixitup.parsePacket(PACKETS.frame, { now: () => 9 }).map((e) => e.type), ['message', 'message', 'delete', 'ban', 'widget']);
  assert.deepStrictEqual(mixitup.parsePacket(PACKETS.frame).map((e) => e.type), ['message', 'message', 'delete', 'ban', 'widget']);
});

// The widget's clear call comes whenever any platform's chat is cleared (a Twitch /clear: Mix It Up's ChatService
// clears for all), and Mix It Up clears nothing on YouTube: it must never wipe YouTube lines.
test('parsePacket: the widget\'s clear is no YouTube clear: no event', () => {
  ['clear', 'CLEAR', 'Clear'].forEach((fn) => {
    assert.deepStrictEqual(mixitup.parsePacket(packet(fn, {})), [], fn);
    assert.deepStrictEqual(mixitup.parsePacket(packet(fn, {}), { guid: GUID }), [], fn);
  });
  assert.deepStrictEqual(mixitup.parsePacket('{"Type":"Function","Data":{"FunctionName":"clear","Parameters":7}}'), []);
  assert.ok(!mixitup.parsePacket(PACKETS.frame).some((e) => e.type === 'clear'));
  // The widget-HTML Clear packet is no chat clear either.
  assert.deepStrictEqual(mixitup.parsePacket({ Type: 'Clear', Data: { ID: ZERO } }), []);
});

test('parsePacket: the widget\'s id is matched in any case or braces; a call without one is kept, the zero endpoint\'s is not', () => {
  const types = (p, guid) => mixitup.parsePacket(p, { guid: guid }).map((e) => e.type);
  assert.deepStrictEqual(types(del(GUID.toUpperCase()), GUID), ['delete']);
  assert.deepStrictEqual(types(del('{' + GUID + '}'), GUID.toUpperCase()), ['delete']);
  assert.deepStrictEqual(types(del(OTHER), GUID), []);
  assert.deepStrictEqual(types(del(ZERO), GUID), []);
  assert.deepStrictEqual(types(del('not a guid'), GUID), []);
  assert.deepStrictEqual(types(del(undefined), GUID), ['delete']);
  assert.deepStrictEqual(types(del(5), GUID), ['delete']);
  // A guid that is no GUID matches no widget.
  assert.deepStrictEqual(types(del(GUID), 'nonsense'), []);
  assert.deepStrictEqual(types(del(OTHER), ''), ['delete'], 'no guid given');
});

// Mix It Up answers ConnectionStart with the widget's HTML, an Add packet naming the widget, when the link is an enabled
// Single Widget URL widget's; another endpoint's link gets other widgets' HTML, and a wrong one nothing.
test('parsePacket: the widget\'s HTML (Add) gives a widget event naming it; another widget\'s, or none, gives nothing', () => {
  assert.deepStrictEqual(mixitup.parsePacket(ANSWER, { guid: GUID }), [{ type: 'widget', id: GUID }]);
  assert.deepStrictEqual(mixitup.parsePacket(JSON.stringify(ANSWER), { guid: GUID }), [{ type: 'widget', id: GUID }]);
  assert.deepStrictEqual(mixitup.parsePacket(answer(GUID.toUpperCase()), { guid: GUID }), [{ type: 'widget', id: GUID }]);
  assert.deepStrictEqual(mixitup.parsePacket(answer('{' + GUID + '}'), { guid: '{' + GUID.toUpperCase() + '}' }), [{ type: 'widget', id: GUID }]);
  [OTHER, ZERO, 'not a guid', '', 5, null, undefined, { ID: GUID }].forEach((id) => {
    assert.deepStrictEqual(mixitup.parsePacket(answer(id), { guid: GUID }), [], String(id));
  });
  // Without a guid: any widget's, by its guid.
  assert.deepStrictEqual(mixitup.parsePacket(answer(OTHER)), [{ type: 'widget', id: OTHER }]);
  assert.deepStrictEqual(mixitup.parsePacket(answer(ZERO)), []);
  [{ Type: 'Add' }, { Type: 'Add', Data: null }, { Type: 'Add', Data: [GUID] }, { Type: 'Add', Data: GUID }, { Type: 'add', Data: { ID: GUID } },
    { Type: 'ADD', Data: { ID: GUID } }].forEach((p) => assert.deepStrictEqual(mixitup.parsePacket(p, { guid: GUID }), [], JSON.stringify(p)));
  // A named endpoint's batch: other widgets' HTML, then ours.
  assert.deepStrictEqual(mixitup.parsePacket([answer(OTHER), answer(ZERO), ANSWER], { guid: GUID }), [{ type: 'widget', id: GUID }]);
});

// A widget disabled while the socket is open: Mix It Up takes its HTML away (Remove naming it) and says nothing more.
test('parsePacket: the widget\'s HTML taken away (Remove) gives a gone event naming it; another widget\'s gives nothing', () => {
  assert.deepStrictEqual(mixitup.parsePacket(REMOVED, { guid: GUID }), [{ type: 'gone', id: GUID }]);
  assert.deepStrictEqual(mixitup.parsePacket(JSON.stringify(REMOVED), { guid: GUID }), [{ type: 'gone', id: GUID }]);
  assert.deepStrictEqual(mixitup.parsePacket(removed(GUID.toUpperCase()), { guid: GUID }), [{ type: 'gone', id: GUID }]);
  assert.deepStrictEqual(mixitup.parsePacket(removed('{' + GUID + '}'), { guid: '{' + GUID.toUpperCase() + '}' }), [{ type: 'gone', id: GUID }]);
  [OTHER, ZERO, 'not a guid', '', 5, null, undefined, { ID: GUID }].forEach((id) => {
    assert.deepStrictEqual(mixitup.parsePacket(removed(id), { guid: GUID }), [], String(id));
  });
  assert.deepStrictEqual(mixitup.parsePacket(removed(OTHER)), [{ type: 'gone', id: OTHER }], 'without a guid: any widget\'s');
  [{ Type: 'Remove' }, { Type: 'Remove', Data: null }, { Type: 'Remove', Data: GUID }, { Type: 'remove', Data: { ID: GUID } }].forEach((p) => {
    assert.deepStrictEqual(mixitup.parsePacket(p, { guid: GUID }), [], JSON.stringify(p));
  });
  // A reset or an edit, batched: taken away, then given again.
  assert.deepStrictEqual(mixitup.parsePacket([REMOVED, ANSWER], { guid: GUID }), [{ type: 'gone', id: GUID }, { type: 'widget', id: GUID }]);
});

test('parsePacket: remove with a message id deletes it (any platform\'s); remove with a user bans a YouTube one only', () => {
  const ev = (p) => mixitup.parsePacket(packet('remove', p));
  assert.deepStrictEqual(ev({ MessageID: MSG_ID }), [{ type: 'delete', id: 'youtube:' + MSG_ID }]);
  // A Twitch message's id: namespaced, it matches no YouTube line.
  assert.deepStrictEqual(ev({ MessageID: '885196de-cb67-427a-baa8-82f9b0fcd05f' }), [{ type: 'delete', id: 'youtube:885196de-cb67-427a-baa8-82f9b0fcd05f' }]);
  // An unusable id is nothing, and never a ban of the user beside it.
  ['', 'a b', '<x>', 5, {}, 'x'.repeat(600)].forEach((id) => assert.deepStrictEqual(ev({ MessageID: id, User: ytUser() }), [], String(id)));
  assert.deepStrictEqual(ev({ Username: 'Spam Bot', User: ytUser() }), [{ type: 'ban', userId: 'youtube:UCspAmB0t3000xxxxxxxxxxx', login: 'spam bot' }]);
  assert.deepStrictEqual(ev({ User: ytUser({ Platform: 'YouTube' }) }).map((e) => e.type), ['ban']);
  assert.deepStrictEqual(ev({ User: ytUser({ PlatformID: null }) }), [{ type: 'ban', userId: 'youtube:99999999-8888-4777-8666-555555555555', login: 'spam bot' }]);
  assert.deepStrictEqual(ev({ Username: 'Named', User: ytUser({ DisplayName: null, Username: null }) })[0].login, 'named');
  assert.deepStrictEqual(ev({ User: ytUser({ DisplayName: null, Username: null }) })[0].login, '');
  assert.deepStrictEqual(ev({ User: ytUser({ DisplayName: 'Spam-Bot.yt' }) })[0].login, 'spam_bot.yt');
  // Another platform's ban (Twitch, Kick) is the overlay's own connection's to report.
  [2, 7, 'Twitch', 'Kick', 0, null, undefined, '3', 'youtube!'].forEach((pl) => assert.deepStrictEqual(ev({ User: ytUser({ Platform: pl }) }), [], String(pl)));
  assert.deepStrictEqual(ev({ User: ytUser({ PlatformID: null, ID: ZERO }) }), [], 'no user key');
  [{}, { Username: 'x' }, { User: null }, { User: 'x' }, { User: [ytUser()] }].forEach((p) => assert.deepStrictEqual(ev(p), [], JSON.stringify(p)));
  assert.deepStrictEqual(mixitup.parsePacket(packet('remove', null)), []);
});

test('parsePacket: Mix It Up\'s connection test, and everything else ignored', () => {
  assert.deepStrictEqual(mixitup.parsePacket(packet('REMOVE', { MessageID: 'm-1' })), [DELETED], 'function names in any case');
  assert.deepStrictEqual(mixitup.parsePacket(packet('Add', params())).map((e) => e.type), ['message']);
  assert.deepStrictEqual(mixitup.parsePacket(PACKETS.test), [{ type: 'test' }]);
  assert.deepStrictEqual(mixitup.parsePacket({ Type: 'Test', Data: { ID: OTHER } }, { guid: GUID }), [{ type: 'test' }], 'the test is for every socket');
  assert.deepStrictEqual(mixitup.parsePacket(PACKETS.debug), []);
  ['update', 'removeAll', 'add ', '', 'x'.repeat(100), 'constructor', '__proto__', 'clear'].forEach((fn) => {
    assert.deepStrictEqual(mixitup.parsePacket(packet(fn, params())), [], fn);
  });
  ['Clear', 'Debug', 'ResponsiveVoice', 'Exception', 'ConnectionStart', 'remove', 'REMOVE', 'function', 'FUNCTION', 'test', '', null, 5].forEach((type) => {
    assert.deepStrictEqual(mixitup.parsePacket({ Type: type, Data: { ID: GUID, FunctionName: 'remove', Parameters: { MessageID: 'm-1' } } }), [], String(type));
  });
});

test('parsePacket: malformed, nested and oversized input gives [] (or what can be read), never a throw', () => {
  ['', '{', '{"Type":', 'null', '5', '"str"', 'true', '[]', '[null, 5, "x", [], {}]', 'undefined', '{"Type":"Function","Data":null}',
    '{"Type":"Function","Data":[]}', '{"Type":"Function","Data":"remove"}', '{"Type":"Function","Data":{"FunctionName":5}}',
    '{"Type":"Function","Data":{"FunctionName":["remove"]}}', '{"Type":"Function","Data":{"FunctionName":"add","Parameters":null}}',
    '{"Type":"Function","Data":{"FunctionName":"add","Parameters":[1,2]}}', '{"Type":"Function","Data":{"FunctionName":"add"}}',
    '{"Type":"Function","Data":{"FunctionName":"remove","Parameters":7}}'
  ].forEach((s) => assert.deepStrictEqual(mixitup.parsePacket(s), [], s));
  [null, undefined, 5, true, () => {}, Symbol('x')].forEach((v) => assert.deepStrictEqual(mixitup.parsePacket(v), [], String(v)));
  // Deep nesting is no message.
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  assert.deepStrictEqual(mixitup.parsePacket(deep), []);
  const nested = params({ User: { PlatformID: { $type: 'x', value: [[[]]] }, DisplayName: { a: { b: 1 } }, Roles: [[[[900]]]] },
    Message: [[{ Type: 'Text', Content: 'x' }], { Type: { Type: 'Text' }, Content: 'y' }] });
  assert.deepStrictEqual(mixitup.parsePacket(packet('add', nested)), []);
  // A frame over 8 MB is not read; one just under it is (an add carries a whole user, ~4.4 KB, and a frame may batch
  // hundreds).
  const one = JSON.stringify(del());
  const pad = (n) => one + ' '.repeat(n);
  assert.deepStrictEqual(mixitup.parsePacket(pad(8 * 1024 * 1024 - one.length)), [DELETED]);
  assert.deepStrictEqual(mixitup.parsePacket(pad(8 * 1024 * 1024 - one.length + 1)), []);
  const batch = JSON.stringify(new Array(400).fill(ADD.packet));
  assert.ok(batch.length > 1024 * 1024);
  assert.strictEqual(mixitup.parsePacket(batch, { guid: GUID }).length, 400);
  // At most 500 packets of a batch are read.
  assert.strictEqual(mixitup.parsePacket(new Array(600).fill(del())).length, 500);
  assert.strictEqual(mixitup.parsePacket(JSON.stringify(new Array(600).fill(del()))).length, 500);
  // opts of any kind.
  [null, 'x', 5, [], { now: 'x', guid: 5 }].forEach((o) => assert.deepStrictEqual(mixitup.parsePacket(del(), o), [DELETED]));
});

// ---------- socket client ----------
test('connects to the widget\'s socket on this computer and says ConnectionStart, as Mix It Up\'s own page does', (t) => {
  const s = setup(t);
  assert.strictEqual(s.sock(0).url, 'ws://localhost:8111/ws/' + GUID + '/');
  assert.deepStrictEqual([s.client.guid, s.client.port], [GUID, 8111]);
  s.sock(0).open();
  assert.deepStrictEqual(s.sock(0).sent, [HELLO]);
  assert.deepStrictEqual(s.statuses, [{ type: 'open' }]);
  s.sock(0).recv(ANSWER);
  assert.deepStrictEqual(s.statuses, [{ type: 'open' }, { type: 'ready' }]);
  assert.deepStrictEqual(s.events, [], 'the widget\'s HTML is not passed on');
  t.mock.timers.tick(600000);
  assert.strictEqual(s.f.sockets.length, 1, 'a quiet socket the widget answered is not a dead one');
  assert.deepStrictEqual(s.sock(0).sent, [HELLO]);
  s.client.stop();
  const other = setup(t, { guid: '{' + GUID.toUpperCase() + '}', port: '8200' });
  assert.strictEqual(other.sock(0).url, 'ws://localhost:8200/ws/' + GUID + '/');
  assert.deepStrictEqual([other.client.guid, other.client.port], [GUID, 8200]);
  other.client.stop();
  const custom = setup(t, { url: 'ws://127.0.0.1:9999/ws/' + GUID + '/' });
  assert.strictEqual(custom.sock(0).url, 'ws://127.0.0.1:9999/ws/' + GUID + '/');
  custom.client.stop();
});

test('ready once a connection: on the widget\'s answer or its first chat event; never on a test or another widget\'s HTML', (t) => {
  // The first chat event: ready before it is passed on.
  const s = setup(t, { onEvent: (e) => s.statuses.push({ event: e.type }) });
  s.sock(0).open();
  s.sock(0).recv(ADD.packet);
  s.sock(0).recv([ANSWER, ANSWER]);
  s.sock(0).recv(del());
  assert.deepStrictEqual(s.statuses, [{ type: 'open' }, { type: 'ready' }, { event: 'message' }, { event: 'delete' }]);
  s.client.stop();
  // A delete or a ban counts too.
  [del(), packet('remove', { User: ytUser() })].forEach((p) => {
    const d = setup(t);
    d.sock(0).open();
    d.sock(0).recv(p);
    assert.deepStrictEqual(d.types(), ['open', 'ready'], JSON.stringify(p).slice(0, 60));
    d.client.stop();
  });
  // Not: a connection test, another widget's or the default endpoint's HTML, a Twitch line, another widget's chat.
  const n = setup(t);
  n.sock(0).open();
  [PACKETS.test, answer(OTHER), answer(ZERO), answer('nope'), PACKETS.frame[1], PACKETS.frame[2], del(OTHER), packet('clear', {}), PACKETS.debug]
    .forEach((p) => n.sock(0).recv(p));
  assert.deepStrictEqual(n.types(), ['open']);
  assert.deepStrictEqual(n.events, []);
  // The widget's answer, its guid in another case or in braces.
  n.sock(0).recv(answer('{' + GUID.toUpperCase() + '}'));
  assert.deepStrictEqual(n.types(), ['open', 'ready']);
  // Each connection is ready on its own.
  n.sock(0).serverClose(1006);
  t.mock.timers.tick(500);
  n.sock(1).open();
  assert.deepStrictEqual(n.sock(1).sent, [HELLO]);
  n.sock(1).recv(ANSWER);
  assert.deepStrictEqual(n.types(), ['open', 'ready', 'closed', 'open', 'ready']);
  n.client.stop();
});

test('a connection the widget never answers goes silent after 6 s: dropped, made again, and silent again', (t) => {
  t.mock.method(Math, 'random', () => 0); // every backoff delay is half its cap: 250, 500, 1000, 2000, 2000...
  const s = setup(t);
  s.sock(0).open();
  t.mock.timers.tick(5999);
  assert.deepStrictEqual(s.types(), ['open']);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(s.types(), ['open', 'silent'], 'no closed: the client dropped it');
  assert.ok(s.sock(0).closed);
  s.sock(0).recv(ANSWER); // too late: that socket is gone
  assert.deepStrictEqual(s.types(), ['open', 'silent']);
  t.mock.timers.tick(250);
  assert.strictEqual(s.f.sockets.length, 2);
  // Again and again, every few seconds (the backoff stops at 4 s), each one silent.
  const waits = [];
  for (let i = 1; i < 7; i++) {
    s.sock(i).open();
    assert.deepStrictEqual(s.sock(i).sent, [HELLO]);
    t.mock.timers.tick(6000);
    let waited = 0;
    while (s.f.sockets.length === i + 1) { t.mock.timers.tick(50); waited += 50; }
    waits.push(waited);
  }
  assert.deepStrictEqual(waits, [500, 1000, 2000, 2000, 2000, 2000]);
  assert.deepStrictEqual(s.types().slice(2), new Array(6).fill(['open', 'silent']).flat());
  // Mix It Up got to the widget at last: ready, and the backoff starts over at once.
  s.sock(7).open();
  s.sock(7).recv(ANSWER);
  assert.deepStrictEqual(s.types().slice(-2), ['open', 'ready']);
  t.mock.timers.tick(60000);
  assert.strictEqual(s.f.sockets.length, 8, 'ready: not dropped');
  s.sock(7).serverClose(1006);
  t.mock.timers.tick(249);
  assert.strictEqual(s.f.sockets.length, 8);
  t.mock.timers.tick(1);
  assert.strictEqual(s.f.sockets.length, 9);
  s.client.stop();
  // readyMs is an option.
  const q = setup(t, { readyMs: 1000 });
  q.sock(0).open();
  t.mock.timers.tick(999);
  assert.deepStrictEqual(q.types(), ['open']);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(q.types(), ['open', 'silent']);
  q.client.stop();
});

// Disable in Mix It Up while the overlay is connected: a Remove naming the widget, then nothing. A reset or an edit:
// Remove, then Add. Either way the connection is unready as if it had just opened.
test('the widget taken away and given again (reset, edit): ready again, never silent', (t) => {
  const s = setup(t);
  s.sock(0).open();
  s.sock(0).recv(ANSWER);
  t.mock.timers.tick(30000);
  s.sock(0).recv(REMOVED);
  assert.deepStrictEqual(s.types(), ['open', 'ready'], 'no status of its own');
  t.mock.timers.tick(5999);
  s.sock(0).recv(ANSWER);
  assert.deepStrictEqual(s.types(), ['open', 'ready', 'ready']);
  t.mock.timers.tick(600000);
  assert.deepStrictEqual(s.types(), ['open', 'ready', 'ready']);
  assert.strictEqual(s.f.sockets.length, 1);
  // Batched in one frame.
  s.sock(0).recv([REMOVED, ANSWER]);
  assert.deepStrictEqual(s.types().slice(3), ['ready']);
  // Chat after it is as good as its HTML, and is passed on.
  s.sock(0).recv(REMOVED);
  s.sock(0).recv(ADD.packet);
  assert.deepStrictEqual(s.types().slice(4), ['ready']);
  assert.deepStrictEqual(s.events.map((e) => e.type), ['message'], 'nothing but the chat is passed on');
  t.mock.timers.tick(600000);
  assert.strictEqual(s.f.sockets.length, 1);
  s.client.stop();
});

test('the widget taken away (disabled) and not given again: silent after readyMs, dropped and made again', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const s = setup(t);
  s.sock(0).open();
  s.sock(0).recv(ANSWER);
  t.mock.timers.tick(20000);
  s.sock(0).recv(REMOVED);
  t.mock.timers.tick(5999);
  assert.deepStrictEqual(s.types(), ['open', 'ready']);
  assert.ok(!s.sock(0).closed);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(s.types(), ['open', 'ready', 'silent'], 'no closed: the client dropped it');
  assert.ok(s.sock(0).closed);
  // Made again as for a socket that never got ready: the backoff (reset when it was ready) starts at 250 ms.
  t.mock.timers.tick(250);
  assert.strictEqual(s.f.sockets.length, 2);
  s.sock(1).open();
  assert.deepStrictEqual(s.sock(1).sent, [HELLO]);
  // Still disabled: Mix It Up says nothing, so silent again.
  t.mock.timers.tick(6000);
  assert.deepStrictEqual(s.types().slice(3), ['open', 'silent']);
  t.mock.timers.tick(500);
  assert.strictEqual(s.f.sockets.length, 3);
  // Enabled again: the next connection's ConnectionStart is answered.
  s.sock(2).open();
  s.sock(2).recv(ANSWER);
  assert.deepStrictEqual(s.types().slice(5), ['open', 'ready']);
  s.client.stop();
  // With readyMs set, that is the wait.
  const q = setup(t, { readyMs: 1500 });
  q.sock(0).open();
  q.sock(0).recv(ANSWER);
  q.sock(0).recv(REMOVED);
  t.mock.timers.tick(1499);
  assert.deepStrictEqual(q.types(), ['open', 'ready']);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(q.types(), ['open', 'ready', 'silent']);
  q.client.stop();
});

test('another widget\'s HTML taken away changes nothing; the widget\'s own, before ready, starts the wait again', (t) => {
  const s = setup(t);
  s.sock(0).open();
  s.sock(0).recv(ANSWER);
  [removed(OTHER), removed(ZERO), removed('nope'), { Type: 'Remove', Data: {} }, { Type: 'remove', Data: { ID: GUID } }]
    .forEach((p) => s.sock(0).recv(p));
  t.mock.timers.tick(600000);
  assert.deepStrictEqual(s.types(), ['open', 'ready']);
  assert.strictEqual(s.f.sockets.length, 1);
  assert.deepStrictEqual(s.events, []);
  s.client.stop();
  // Before ready: the wait starts over from the Remove.
  const b = setup(t);
  b.sock(0).open();
  t.mock.timers.tick(4000);
  b.sock(0).recv(REMOVED);
  t.mock.timers.tick(5999);
  assert.deepStrictEqual(b.types(), ['open'], '9.999 s after open, 5.999 s after the Remove');
  t.mock.timers.tick(1);
  assert.deepStrictEqual(b.types(), ['open', 'silent']);
  b.client.stop();
  // Before ready, then given: ready.
  const c = setup(t);
  c.sock(0).open();
  c.sock(0).recv(REMOVED);
  c.sock(0).recv(ANSWER);
  t.mock.timers.tick(600000);
  assert.deepStrictEqual(c.types(), ['open', 'ready']);
  c.client.stop();
  // A stop() while it waits: no silent.
  const d = setup(t);
  d.sock(0).open();
  d.sock(0).recv(ANSWER);
  d.sock(0).recv(REMOVED);
  d.client.stop();
  t.mock.timers.tick(600000);
  assert.deepStrictEqual(d.types(), ['open', 'ready']);
});

test('a ready connection starts the backoff over at once, not after a minute', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const s = setup(t);
  // Mix It Up not running for a while: the backoff climbs to its cap.
  for (let i = 0; i < 5; i++) {
    s.sock(i).serverClose(1006);
    t.mock.timers.tick(4000);
  }
  assert.strictEqual(s.f.sockets.length, 6);
  // Open but never ready: the backoff stays where it was.
  s.sock(5).open();
  s.sock(5).serverClose(1006);
  t.mock.timers.tick(1999);
  assert.strictEqual(s.f.sockets.length, 6);
  t.mock.timers.tick(1);
  assert.strictEqual(s.f.sockets.length, 7);
  // Ready, then a drop a second later: the next attempt comes after the first delay again.
  s.sock(6).open();
  s.sock(6).recv(ADD.packet);
  t.mock.timers.tick(1000);
  s.sock(6).serverClose(1006);
  t.mock.timers.tick(250);
  assert.strictEqual(s.f.sockets.length, 8);
  s.client.stop();
});

test('passes the widget\'s chat events on in order, stamped as they arrive', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(ADD.packet);
  ws.recv(PACKETS.frame);
  ws.recv('not json');
  ws.recv(del(OTHER));
  ws.recv(PACKETS.debug);
  ws.recv(ANSWER);
  assert.deepStrictEqual(s.events.map((e) => e.type), ['message', 'message', 'delete', 'ban']);
  assert.strictEqual(s.events[0].msg.text, 'hello chat :hand-pink-waving: first stream in a while monkaS :not-an-emoji:');
  assert.strictEqual(s.events[1].msg.displayName, 'Mod Squad Lead');
  assert.ok(s.events[1].msg.ts > s.events[0].msg.ts);
  assert.strictEqual(s.events[0].msg.roomId, 'youtube:' + GUID);
  // Frames that aren't text (a Blob or an ArrayBuffer) are not Mix It Up's.
  if (ws.onmessage) ws.onmessage({ data: { toString: () => JSON.stringify(del()) } });
  assert.strictEqual(s.events.length, 4);
  s.client.stop();
});

test('answers Mix It Up\'s connection test, once a frame, and does not pass it on', (t) => {
  const s = setup(t);
  const ws = s.sock(0);
  ws.open();
  ws.recv(PACKETS.test);
  assert.deepStrictEqual(ws.sent, [HELLO, { Type: 'Test', Data: '' }]);
  ws.recv([{ Type: 'Test' }, del(), { Type: 'Test' }, { Type: 'Test' }]);
  assert.deepStrictEqual(ws.sent, [HELLO, { Type: 'Test', Data: '' }, { Type: 'Test', Data: '' }]);
  assert.deepStrictEqual(s.events, [DELETED]);
  s.client.stop();
});

test('reconnects after a drop every 0.25 to 4 s, reporting each drop and each failed attempt', (t) => {
  const s = setup(t);
  s.sock(0).open();
  s.sock(0).recv(ANSWER);
  s.sock(0).serverClose(1006);
  assert.deepStrictEqual(s.statuses, [{ type: 'open' }, { type: 'ready' }, { type: 'closed', code: 1006, reason: '' }]);
  t.mock.timers.tick(500);
  assert.strictEqual(s.f.sockets.length, 2);
  // Mix It Up not running: each attempt is refused, and each says so (a run of 'closed' with no 'open').
  s.sock(1).serverClose(1006);
  t.mock.timers.tick(1000);
  assert.strictEqual(s.f.sockets.length, 3);
  s.sock(2).serverClose(1006, 'refused');
  assert.deepStrictEqual(s.types().slice(2), ['closed', 'closed', 'closed']);
  assert.deepStrictEqual(s.statuses[4], { type: 'closed', code: 1006, reason: 'refused' });
  t.mock.timers.tick(2000);
  assert.strictEqual(s.f.sockets.length, 4);
  // Never more than 4 s apart.
  for (let i = 3; i < 10; i++) {
    s.sock(i).serverClose(1006);
    t.mock.timers.tick(4000);
    assert.strictEqual(s.f.sockets.length, i + 2);
  }
  s.sock(10).open();
  assert.deepStrictEqual(s.types().slice(-1), ['open']);
  s.client.stop();
});

test('a socket that never opens times out after 8 s: closed, then another attempt', (t) => {
  const s = setup(t);
  t.mock.timers.tick(7999);
  assert.deepStrictEqual(s.statuses, []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(s.statuses, [{ type: 'closed', code: 0, reason: 'connect timeout' }]);
  assert.ok(s.sock(0).closed);
  t.mock.timers.tick(500);
  assert.strictEqual(s.f.sockets.length, 2);
  // An attempt that opens in time is not timed out.
  s.sock(1).open();
  s.sock(1).recv(ANSWER);
  t.mock.timers.tick(60000);
  assert.deepStrictEqual(s.types(), ['closed', 'open', 'ready']);
  assert.strictEqual(s.f.sockets.length, 2);
  s.client.stop();
});

test('a socket that can\'t be made (refused by the page) is a failed attempt too, and is tried again', (t) => {
  t.mock.method(console, 'warn', () => {});
  let refuse = 2;
  const made = [];
  function PickyWS(url) {
    if (refuse > 0) { refuse--; throw new Error('SecurityError: refused to connect to ' + url); }
    this.url = url;
    this.sent = [];
    made.push(this);
  }
  PickyWS.prototype.send = function (x) { this.sent.push(x); };
  PickyWS.prototype.close = function () {};
  const s = setup(t, { WebSocket: PickyWS });
  assert.deepStrictEqual(s.statuses, [{ type: 'closed', code: 0, reason: 'socket refused' }]);
  t.mock.timers.tick(500);
  assert.deepStrictEqual(s.types(), ['closed', 'closed']);
  t.mock.timers.tick(1000);
  assert.strictEqual(made.length, 1);
  made[0].onopen({});
  assert.deepStrictEqual(s.types(), ['closed', 'closed', 'open']);
  assert.deepStrictEqual(made[0].sent, [JSON.stringify(HELLO)]);
  s.client.stop();
});

// util.SocketClient used to overwrite a stop() made while its socket was being made, and went on reconnecting.
test('a stop() from onStatus while a socket is refused stops for good', (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let made = 0;
  function NoWS() { made++; throw new Error('refused'); }
  const statuses = [];
  const client = mixitup.createMixItUp({ guid: GUID, WebSocket: NoWS, onStatus: (st) => { statuses.push(st); client.stop(); } });
  client.start();
  assert.strictEqual(made, 1);
  assert.deepStrictEqual(statuses, [{ type: 'closed', code: 0, reason: 'socket refused' }]);
  t.mock.timers.tick(600000);
  assert.strictEqual(made, 1, 'no reconnect');
  assert.strictEqual(statuses.length, 1, 'nothing reported after stop()');
});

test('stop() stops: no more attempts, statuses or events', (t) => {
  const s = setup(t);
  s.sock(0).open();
  const ws = s.sock(0);
  s.client.stop();
  assert.ok(ws.closed);
  ws.recv(del());
  ws.recv(ANSWER);
  t.mock.timers.tick(600000);
  assert.strictEqual(s.f.sockets.length, 1);
  assert.deepStrictEqual(s.events, []);
  assert.deepStrictEqual(s.types(), ['open'], 'no silent after stop');
  // Stopped while connecting: no timeout reported later.
  const c = setup(t);
  c.client.stop();
  t.mock.timers.tick(600000);
  assert.deepStrictEqual(c.statuses, []);
  assert.strictEqual(c.f.sockets.length, 1);
  // Started again after a stop.
  c.client.start();
  assert.strictEqual(c.f.sockets.length, 2);
  c.client.stop();
  // Stopped from the open status: no ConnectionStart, nothing more.
  let o = null;
  o = setup(t, { onStatus: (st) => { o.statuses.push(st); o.client.stop(); } });
  o.sock(0).open();
  assert.deepStrictEqual(o.sock(0).sent, []);
  t.mock.timers.tick(600000);
  assert.deepStrictEqual(o.types(), ['open']);
  // Stopped from the ready status: the event that made it ready is not passed on.
  let r = null;
  r = setup(t, { onStatus: (st) => { r.statuses.push(st); if (st.type === 'ready') r.client.stop(); } });
  r.sock(0).open();
  r.sock(0).recv(ADD.packet);
  assert.deepStrictEqual(r.types(), ['open', 'ready']);
  assert.deepStrictEqual(r.events, []);
});

test('mixitup() tries again at once while waiting to reconnect', (t) => {
  const s = setup(t);
  s.sock(0).serverClose(1006);
  assert.strictEqual(s.f.sockets.length, 1);
  s.client.mixitup();
  assert.strictEqual(s.f.sockets.length, 2);
  s.client.mixitup();
  assert.strictEqual(s.f.sockets.length, 2, 'not while connecting');
  s.client.stop();
});

test('a throwing onEvent or onStatus is caught; each event is delivered on its own, and a stop in onEvent ends the frame', (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = fakeSockets();
  const got = [];
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let client;
  client = mixitup.createMixItUp({
    guid: GUID,
    WebSocket: f.WS,
    onEvent: (e) => {
      got.push(e.type);
      if (got.length === 1) throw new Error('renderer blew up');
      if (e.type === 'ban') client.stop();
    },
    onStatus: () => { throw new Error('status blew up'); }
  });
  client.start();
  f.sockets[0].open();
  assert.deepStrictEqual(f.sockets[0].sent, [HELLO], 'a throwing open status still says ConnectionStart');
  f.sockets[0].recv(PACKETS.frame);
  assert.deepStrictEqual(got, ['message', 'delete', 'ban']);
  t.mock.timers.tick(600000);
  assert.strictEqual(f.sockets.length, 1);
});

test('an invalid GUID or port never connects: fatal at start', (t) => {
  [[{ guid: 'nope' }, 'invalid Mix It Up widget link'], [{ guid: ZERO }, 'invalid Mix It Up widget link'],
    [{ guid: '' }, 'invalid Mix It Up widget link'], [{ guid: GUID, port: 80 }, 'invalid Mix It Up port'],
    [{ guid: GUID, port: 'abc' }, 'invalid Mix It Up port'], [{ guid: GUID, port: 70000 }, 'invalid Mix It Up port'],
    [{ guid: 'http://localhost:8111/overlay/' + GUID }, 'invalid Mix It Up widget link']].forEach(([o, message]) => {
    const s = setup(t, o);
    assert.strictEqual(s.f.sockets.length, 0, JSON.stringify(o));
    assert.deepStrictEqual(s.statuses, [{ type: 'fatal', message: message }], JSON.stringify(o));
    t.mock.timers.tick(600000);
    assert.strictEqual(s.f.sockets.length, 0);
    s.client.stop();
    s.client.mixitup();
  });
  // No options at all.
  const statuses = [];
  const c = mixitup.createMixItUp();
  assert.doesNotThrow(() => c.start());
  const d = mixitup.createMixItUp({ onStatus: (x) => statuses.push(x) });
  d.start();
  assert.deepStrictEqual(statuses, [{ type: 'fatal', message: 'invalid Mix It Up widget link' }]);
});

// ---------- drawn ----------
// The message shape is the renderer's: hostile names and words come out as text, and the only images are the ones
// youtubeEmotes names (looked up as overlay.js would: own keys only).
test('hostile YouTube chat is drawn as text; emote images only from youtubeEmotes, https', () => {
  const tokenizer = require('../js/tokenizer.js');
  const R = require('../js/renderer.js')._internal;
  const PAYLOADS = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '"><svg/onload=alert(1)>', 'javascript:alert(1)',
    '<style>*{display:none}</style>'];
  PAYLOADS.forEach((p) => {
    const m = said([p, emote(p, 'javascript:alert(1)'), emote(':ok:', YT), '__proto__', 'constructor'],
      { DisplayName: p, Color: p, AvatarLink: p, Roles: [p, 900] });
    assert.ok(m, p);
    const own = (w) => Object.prototype.hasOwnProperty.call(m.youtubeEmotes, w);
    const lookup = (w) => (own(w) ? { provider: 'youtube', id: w, name: w, w: 28, h: 28, urls: { 1: m.youtubeEmotes[w] } } : null);
    const tk = tokenizer.tokenize(m, { lookup: lookup, bttvPrefixes: null, gifs: false });
    const d = R.modelFor(m, R.normalizeCfg({}), { kind: 'chat', items: tk.items, action: tk.action, badges: [], name: { text: m.displayName, color: m.color } });
    assert.strictEqual(d.name.text, p, 'the name is literal text');
    assert.match(d.name.color, /^#[0-9a-f]{6}$/i, 'a hostile color is replaced');
    const urls = [];
    d.parts.forEach((x) => { if (x.url) urls.push(x.url); (x.ov || []).forEach((o) => urls.push(o.url)); });
    assert.deepStrictEqual(urls, [YT]);
    const text = d.parts.filter((x) => x.t === 'text').map((x) => x.s).join('');
    assert.ok(text.indexOf(p) >= 0, 'the words are literal text');
    assert.deepStrictEqual(m.youtubeBadges, [{ type: 'owner' }]);
  });
});
