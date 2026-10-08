'use strict';
// Default-parity capture. tests/fixtures/parity-*.json hold what this computed on the untouched 1.5.2 tree
// (607c343), before any 1.6.0 option existed; the parity tests compare the current code against them, so every
// new option must leave its default exactly as 1.5.2 was. Not a *.test.js file: `node --test` never runs it alone.
//
// It only calls functions 1.5.2 already has, with the inputs 1.5.2's own callers pass (partial cfgs included),
// so the same file runs on the old tree (to make the fixtures) and on every later one (to compare):
//   models  renderer modelFor + sigOf for a fixed message set, under a few configs (full and partial cfg)
//   dom     the real createRenderer on tests/fake-dom.js: every element, attribute, style key and SVG child
//   urls    hosted overlay URLs, settings.js snippets, preview / file:// URLs, home demo frames, font hrefs
//   intake  overlay.js booted with stubbed loaders and sockets: a fixed Twitch IRC + Kick transcript through
//           the real handlers, with every message that reaches renderer.push and nameFor / badgesFor /
//           shouldShow / tokensFor for it
// The clock, timers and Math.random are fixed while a capture runs, so two runs give identical JSON.
// The files are written in toJson's format by a small generator kept outside the repo, which runs this file
// against a git archive of 607c343 (never against a changed tree).
const path = require('node:path');
const fs = require('node:fs');
const { mock } = require('node:test');
const { createDocument } = require('./fake-dom.js');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');

const EPOCH = 1767270840000; // 2026-01-01T12:34:00Z: every tmi-sent-ts / created_at, and the mocked clock
const CHANNEL = 'home';
const HOME = '100';
const PARTNER = '200';
const KICK_ROOM = '668';

// ---------- module loading ----------

function fresh() {
  Object.keys(require.cache).forEach((k) => { if (k.startsWith(JS + path.sep)) delete require.cache[k]; });
}
function load(name) { return require(path.join(JS, name + '.js')); }

// The js/ files in overlay.html order (errors.js is the page's own error trap, not a module).
function overlayOrder() {
  const html = fs.readFileSync(path.join(ROOT, 'overlay.html'), 'utf8');
  const out = [];
  const re = /<script[^>]*\ssrc="js\/([\w-]+)\.js[^"]*"/g;
  let m;
  while ((m = re.exec(html))) if (m[1] !== 'errors') out.push(m[1]);
  return out;
}

// Pure modules, loaded fresh (an overlay boot stubs functions on the cached module objects).
function modules() {
  fresh();
  delete globalThis.TCO;
  return {
    util: load('util'), config: load('config'), ircParse: load('irc-parse'), tokenizer: load('tokenizer'),
    kick: load('kick'), paintCss: load('paint-css'), renderer: load('renderer'), builder: load('builder'), home: load('home')
  };
}

// ---------- fixed clock, timers, randomness and globals ----------

const GLOBALS = ['TCO', 'TCO_NO_AUTOBOOT', 'TCO_SETTINGS', '__tcoErrors', 'document', 'location', 'parent', 'addEventListener',
  'fetch', 'WebSocket'];

async function isolated(fn) {
  const saved = {};
  GLOBALS.forEach((k) => { saved[k] = Object.prototype.hasOwnProperty.call(globalThis, k) ? [globalThis[k]] : null; });
  const random = Math.random, warn = console.warn, log = console.log;
  let s = 0x2f6b1d;
  Math.random = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  console.warn = function () {};
  console.log = function () {};
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: EPOCH });
  try {
    return await fn();
  } finally {
    mock.timers.reset();
    Math.random = random;
    console.warn = warn;
    console.log = log;
    GLOBALS.forEach((k) => { if (saved[k]) globalThis[k] = saved[k][0]; else delete globalThis[k]; });
    fresh();
  }
}
const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await new Promise((r) => setImmediate(r)); };
const tick = (ms) => mock.timers.tick(ms);
// JSON-safe copy (functions dropped, key order kept).
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

// ---------- sample data ----------

function esc(v) { return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\:').replace(/ /g, '\\s'); }
function tagStr(tags) { return '@' + Object.keys(tags).map((k) => k + '=' + esc(tags[k])).join(';'); }
// Twitch emotes tag (code-point ranges) for the given word -> id table.
function emotesTag(text, ids) {
  const cps = Array.from(text);
  const byId = {};
  let word = '', start = 0;
  for (let i = 0; i <= cps.length; i++) {
    if (i === cps.length || cps[i] === ' ') {
      if (word && ids[word]) (byId[ids[word]] = byId[ids[word]] || []).push(start + '-' + (i - 1));
      word = '';
      start = i + 1;
    } else word += cps[i];
  }
  return Object.keys(byId).map((id) => id + ':' + byId[id].join(',')).join('/');
}
const TWITCH_IDS = { Kappa: '25', PogChamp: '305954156' };

const U = {
  sub: { id: '1001', login: 'subfan', name: 'SubFan', color: '#1E90FF', badges: 'subscriber/12' },
  waver: { id: '1002', login: 'waver', name: 'Waver', color: '#FF7F50', badges: '' },
  replier: { id: '1003', login: 'replier', name: 'Replier', color: '#00FF7F', badges: 'vip/1' },
  newbie: { id: '1004', login: 'newbie', name: 'Newbie', color: '#DAA520', badges: '' },
  pointer: { id: '1005', login: 'pointspender', name: 'PointSpender', color: '#B22222', badges: 'subscriber/3' },
  caster: { id: HOME, login: CHANNEL, name: 'Home', color: '#9146FF', badges: 'broadcaster/1,subscriber/0' },
  mod: { id: '1006', login: 'helpfulmod', name: 'HelpfulMod', color: '#00AD03', badges: 'moderator/1,subscriber/24' },
  plain: { id: '1007', login: 'plainviewer', name: 'PlainViewer', color: '', badges: '' },
  dark: { id: '1008', login: 'darkname', name: 'DarkName', color: '#0000FF', badges: '' },
  intl: { id: '1009', login: 'sekai', name: 'セカイ', color: '#FF69B4', badges: '' },
  partner: { id: '2001', login: 'partnerfan', name: 'PartnerFan', color: '#2E8B57', badges: '' },
  dev: { id: '1010', login: 'masstarvt', name: 'MasstarVT', color: '#8A2BE2', badges: 'moderator/1' },
  painted: { id: '1011', login: 'paintedpal', name: 'PaintedPal', color: '#1E90FF', badges: 'subscriber/3' },
  bot: { id: '1012', login: 'nightbot', name: 'Nightbot', color: '#7C7CE1', badges: 'moderator/1' },
  chanbot: { id: '1013', login: 'channelbot', name: 'ChannelBot', color: '#5F9EA0', badges: '' },
  ffzdev: { id: '1014', login: 'ffzdev', name: 'FfzDev', color: '#E0B726', badges: '' },
  ffzbot: { id: '1015', login: 'ffzbot', name: 'FfzBot', color: '#808080', badges: 'moderator/1' },
  extras: { id: '1016', login: 'collector', name: 'Collector', color: '#C71585', badges: 'vip/1' },
  troll: { id: '1017', login: 'troll', name: 'Troll', color: '#696969', badges: '' },
  gifter: { id: '1018', login: 'gifter', name: 'Gifter', color: '#FFD700', badges: 'subscriber/6' },
  raider: { id: '1019', login: 'raider', name: 'Raider', color: '#4169E1', badges: '' }
};

function priv(id, u, text, extra) {
  const tags = Object.assign({ 'badge-info': '', badges: u.badges, color: u.color, 'display-name': u.name,
    emotes: emotesTag(text.replace(/^\u0001ACTION /, '').replace(/\u0001$/, ''), TWITCH_IDS), 'first-msg': '0', id: id,
    'room-id': HOME, 'tmi-sent-ts': String(EPOCH), 'user-id': u.id }, extra || {});
  return tagStr(tags) + ' :' + u.login + '!' + u.login + '@' + u.login + '.tmi.twitch.tv PRIVMSG #' + CHANNEL + ' :' + text;
}
function unotice(id, u, msgId, systemMsg, text, extra) {
  const tags = Object.assign({ 'badge-info': '', badges: u.badges, color: u.color, 'display-name': u.name,
    emotes: text ? emotesTag(text, TWITCH_IDS) : '', id: id, login: u.login, 'msg-id': msgId, 'room-id': HOME,
    'system-msg': systemMsg, 'tmi-sent-ts': String(EPOCH), 'user-id': u.id }, extra || {});
  return tagStr(tags) + ' :tmi.twitch.tv USERNOTICE #' + CHANNEL + (text ? ' :' + text : '');
}
const KICK_AT = new Date(EPOCH).toISOString();
function kickSender(id, username, color, badges) {
  const identity = { badges: badges || [] };
  if (color !== null) identity.color = color;
  return { id: id, username: username, slug: username.toLowerCase(), identity: identity };
}
function kickChat(id, sender, content, extra) {
  return Object.assign({ id: id, chatroom_id: Number(KICK_ROOM), content: content, type: 'message', created_at: KICK_AT, sender: sender }, extra || {});
}

const STV = 'https://cdn.7tv.app/emote/';
function emote(provider, id, name, w, h, urls, extra) { return Object.assign({ provider, id, name, w, h, urls }, extra || {}); }
function stvEmote(id, name, w, extra) {
  return emote('7tv', id, name, w, 32, { 1: STV + id + '/1x.webp', 2: STV + id + '/2x.webp', 3: STV + id + '/3x.webp', 4: STV + id + '/4x.webp' }, extra);
}
function bttvEmote(id, name) {
  const b = 'https://cdn.betterttv.net/emote/' + id + '/';
  return emote('bttv', id, name, 28, 28, { 1: b + '1x.webp', 2: b + '2x.webp', 4: b + '3x.webp' });
}
function ffzEmote(id, name, extra) {
  return emote('ffz', id, name, 32, 30, ffz3('https://cdn.frankerfacez.com/emote/' + id + '/'), extra);
}
// 7TV global, BTTV global (with its prefix modifiers), FFZ global; each a fresh Map per call.
function emoteMaps() {
  return {
    stv: new Map([
      ['PepeLaugh', stvEmote('01GB2V1V7G000F4PJQ6HYRSV2R', 'PepeLaugh', 32)],
      ['RainTime', stvEmote('01GAXSFBAR0003RH7M52VJT1D3', 'RainTime', 32, { zw: true })],
      ['WideHype', stvEmote('01GCQ7DMPR000BE8PJZ06EK2ST', 'WideHype', 96)]
    ]),
    stvHome: new Map([['HomeEmote', stvEmote('01HQ7Y8Z9A0B1C2D3E4F5G6H7E', 'HomeEmote', 32)]]),
    bttv: new Map([['catJAM', bttvEmote('5f1b0186cf6d2144653d2970', 'catJAM')]]),
    bttvPrefixes: new Set(['h!', 'v!', 'w!', 'c!', 'l!', 'r!', 'z!', 'p!', 's!']),
    ffz: new Map([['OMEGALUL', ffzEmote('128054', 'OMEGALUL')], ['ffzX', ffzEmote('720507', 'ffzX', { hidden: true, flags: 2 })]])
  };
}

const PAINT_GRAD = '01HQ7Y8Z9A0B1C2D3E4F5G6H7J';
const PAINT_IMAGE = '01HQ7Y8Z9A0B1C2D3E4F5G6H7K';
const STV_BADGE = '01HQ7Y8Z9A0B1C2D3E4F5G6H7M';
function paints(paintCss) {
  return {
    [PAINT_GRAD]: paintCss.fromV3({ id: PAINT_GRAD, name: 'Sunset', function: 'LINEAR_GRADIENT', angle: 90, repeat: false,
      stops: [{ at: 0, color: -16776961 }, { at: 1, color: 16711935 }], shadows: [{ x_offset: 0, y_offset: 0, radius: 2, color: 255 }] }),
    [PAINT_IMAGE]: paintCss.fromV3({ id: PAINT_IMAGE, name: 'Sparkle', function: 'URL', image_url: 'https://cdn.7tv.app/paint/' + PAINT_IMAGE + '/layer/1/1x.webp' })
  };
}

// Badges as overlay.js hands them to the renderer.
const same3 = (u) => ({ 1: u, 2: u, 4: u });
const ffz3 = (b) => ({ 1: b + '1', 2: b + '2', 4: b + '4' });
function twitchBadge(set, version, title) {
  const b = 'https://static-cdn.jtvnw.net/badges/v1/' + set + '-' + version + '/';
  return { provider: 'twitch', title: title, urls: { 1: b + '1', 2: b + '2', 4: b + '3' } };
}
const STV_BADGE_URL = 'https://cdn.7tv.app/badge/' + STV_BADGE + '/';
const AVATAR = 'https://static-cdn.jtvnw.net/jtv_user_pictures/partner-profile_image-70x70.png';
const B = {
  sub12: twitchBadge('subscriber', '12', '1-Year Subscriber'),
  sub3: twitchBadge('subscriber', '3', '3-Month Subscriber'),
  sub0: twitchBadge('subscriber', '0', 'Subscriber'),
  vip: twitchBadge('vip', '1', 'VIP'),
  caster: twitchBadge('broadcaster', '1', 'Broadcaster'),
  mod: twitchBadge('moderator', '1', 'Moderator'),
  ffzMod: { provider: 'ffz', title: 'Moderator', urls: ffz3('https://cdn.frankerfacez.com/room-badge/mod/home/'), bg: '#34AE0A' },
  ffzDev: { provider: 'ffz', title: 'FFZ Developer', urls: ffz3('https://cdn.frankerfacez.com/badge/2/'), bg: '#E0B726' },
  stv: { provider: '7tv', title: '7TV Subscriber',
    urls: { 1: STV_BADGE_URL + '1x.webp', 2: STV_BADGE_URL + '2x.webp', 3: STV_BADGE_URL + '3x.webp', 4: STV_BADGE_URL + '4x.webp' } },
  avatar: { provider: 'avatar', title: 'Partner', urls: same3(AVATAR) },
  dev: { provider: 'developer', title: 'MasstarVT developer', urls: same3('img/logos/Badge.svg') },
  // relative: 1.5.2's renderer drops it, today's draws it (parity.test.js withFixes)
  beta: { provider: 'beta-tester', title: 'Beta Tester', urls: same3('img/logos/Beta.svg') },
  twitch: { provider: 'platform', icon: 'twitch', title: 'Twitch' },
  kick: { provider: 'platform', icon: 'kick', title: 'Kick' },
  kickMod: { provider: 'kick', icon: 'kick-moderator', title: 'Moderator' },
  kickSub: { provider: 'kick', icon: 'kick-subscriber', title: 'Subscriber (2 months)' },
  kickOg: { provider: 'kick', icon: 'kick-og', title: 'OG' },
  kickVip: { provider: 'kick', icon: 'kick-vip', title: 'VIP' }
};

const GIF = 'https://media.giphy.com/media/3oFzm0o2jMKftsaBoc/giphy.gif';
const KICK = {
  fan: kickSender(9000001, 'KickFan', '#53FC19', [{ type: 'moderator', text: 'Moderator' }, { type: 'subscriber', text: 'Subscriber', count: 2 }]),
  plain: kickSender(9000002, 'KickPlain', null, []),
  og: kickSender(9000003, 'KickOG', '#E9113C', [{ type: 'og', text: 'OG' }, { type: 'vip', text: 'VIP' }]),
  bot: kickSender(9000004, 'BotRix', '#00FF00', [])
};

// The fixed message set. irc: a raw line; kick: [event, data]. badges / noName / paint / noReply: what the
// model and DOM captures hand the renderer for it (the intake capture asks the real overlay.js instead).
function sampleSet() {
  return [
    { key: 'chat', irc: priv('m-chat', U.sub, 'hello chat Kappa how are you'), badges: [B.sub12, B.stv] },
    { key: 'action', irc: priv('m-action', U.waver, '\u0001ACTION waves at everyone\u0001'), badges: [] },
    { key: 'reply', irc: priv('m-reply', U.replier, '@SubFan thanks for that', { 'reply-parent-msg-id': 'm-chat', 'reply-parent-user-id': U.sub.id,
      'reply-parent-user-login': U.sub.login, 'reply-parent-display-name': U.sub.name, 'reply-parent-msg-body': 'hello chat Kappa how are you' }), badges: [B.vip] },
    { key: 'reply-gone', noReply: true, irc: priv('m-reply-gone', U.replier, '@Troll what did you say', { 'reply-parent-msg-id': 'm-gone', 'reply-parent-user-id': U.troll.id,
      'reply-parent-user-login': U.troll.login, 'reply-parent-display-name': U.troll.name, 'reply-parent-msg-body': 'deleted words' }), badges: [B.vip] },
    { key: 'first-msg', irc: priv('m-first', U.newbie, 'hi everyone, first time here!', { 'first-msg': '1' }), badges: [] },
    { key: 'points-highlight', irc: priv('m-points', U.pointer, 'look at my highlighted message', { 'msg-id': 'highlighted-message', 'custom-reward-id': 'r1' }), badges: [B.sub3] },
    { key: 'announcement', irc: unotice('n-ann', U.mod, 'announcement', '', 'Stream starts in 5 minutes PogChamp', { 'msg-param-color': 'BLUE' }), badges: [B.mod, B.sub12] },
    { key: 'resub', irc: unotice('n-resub', U.sub, 'resub', 'SubFan subscribed at Tier 1. They\'ve subscribed for 12 months!', 'still here Kappa',
      { 'msg-param-cumulative-months': '12', 'msg-param-sub-plan': '1000' }), badges: [B.sub12] },
    { key: 'sub', irc: unotice('n-sub', U.newbie, 'sub', 'Newbie subscribed with Prime.', '', { 'msg-param-sub-plan': 'Prime' }), badges: [] },
    { key: 'raid', irc: unotice('n-raid', U.raider, 'raid', '15 raiders from Raider have joined!', '', { 'msg-param-viewerCount': '15' }), badges: [] },
    { key: 'kick-chat', kick: ['ChatMessageEvent', kickChat('a1b2c3d4-0001', KICK.fan, 'hi from kick [emote:37226:KEKW] PepeLaugh')], badges: [B.kick, B.kickMod, B.kickSub] },
    { key: 'kick-notice', kick: ['SubscriptionEvent', { chatroom_id: Number(KICK_ROOM), username: 'KickFan', months: 5 }], badges: [B.kick] },
    { key: 'kick-nocolor', kick: ['ChatMessageEvent', kickChat('a1b2c3d4-0002', KICK.plain, 'no colour on kick')], badges: [B.kick] },
    { key: 'kick-reply', kick: ['ChatMessageEvent', kickChat('a1b2c3d4-0003', KICK.og, 'yes indeed', { type: 'reply',
      metadata: { original_sender: { id: 9000001, username: 'KickFan' }, original_message: { id: 'a1b2c3d4-0001', content: 'hi from kick [emote:37226:KEKW] PepeLaugh' } }
    })], badges: [B.kick, B.kickOg, B.kickVip] },
    { key: 'mirrored', irc: priv('m-mirror', U.partner, 'hello from the other channel PepeLaugh', { 'source-room-id': PARTNER, 'source-id': 'src-mirror',
      'source-badges': 'subscriber/6' }), badges: [B.avatar] },
    { key: 'home-shared', irc: priv('m-homeshared', U.mod, 'welcome partner chat', { 'source-room-id': HOME, 'source-id': 'src-home' }), badges: [B.ffzMod, B.sub12] },
    { key: 'zero-width', irc: priv('m-zw', U.sub, 'PepeLaugh RainTime w! catJAM OMEGALUL ffzX r! catJAM z! PepeLaugh WideHype'), badges: [B.sub12] },
    { key: 'gigantified', irc: priv('m-giant', U.sub, 'so big Kappa', { 'msg-id': 'gigantified-emote-message' }), badges: [B.sub12] },
    { key: 'cheer', irc: priv('m-cheer', U.extras, 'Cheer100 great stream Kappa', { bits: '100' }), badges: [B.vip] },
    { key: 'gif', irc: priv('m-gif', U.newbie, 'look [GIF] nice', { gifs: '5-9|3oFzm0o2jMKftsaBoc|' + GIF }), badges: [] },
    { key: 'cjk-rtl', irc: priv('m-intl', U.intl, 'こんにちは 世界 مرحبا بالجميع שלום 👋🏽 Z\u0334\u0321a\u0336l\u0337g\u0338o'), badges: [] },
    { key: 'colourless', irc: priv('m-plain', U.plain, 'i have no colour set'), badges: [] },
    { key: 'dark', irc: priv('m-dark', U.dark, 'my name is dark blue'), badges: [] },
    { key: 'mention', irc: priv('m-mention', U.sub, '@home you rock, and @SubFan too'), badges: [B.sub12] },
    { key: 'link', irc: priv('m-link', U.waver, 'check https://example.com/page?x=1 and www.test.org/a'), badges: [] },
    { key: 'command', irc: priv('m-cmd', U.newbie, '!points'), badges: [] },
    { key: 'emote-only', irc: priv('m-emoteonly', U.sub, 'Kappa PogChamp PepeLaugh'), badges: [B.sub12] },
    { key: 'broadcaster', irc: priv('m-caster', U.caster, 'thanks for watching!'), badges: [B.caster, B.sub0] },
    { key: 'moderator', irc: priv('m-mod', U.mod, 'please be nice'), badges: [B.mod, B.sub12] },
    { key: 'painted', paint: PAINT_GRAD, irc: priv('m-painted', U.painted, 'my name has a paint'), badges: [B.sub3, B.stv] },
    { key: 'painted-image', paint: PAINT_IMAGE, irc: priv('m-painted2', U.ffzdev, 'my paint is an image'), badges: [B.ffzDev] },
    { key: 'developer', irc: priv('m-dev', U.dev, 'hello from the dev'), badges: [B.dev, B.beta, B.mod] },
    { key: 'no-name', noName: true, irc: priv('m-noname', Object.assign({}, U.plain, { name: '' }), 'nameFor gave nothing'), badges: [] }
  ];
}

// The message a sample stands for, the way overlay.js turns its line into one (handlePrivmsg / handleUsernotice).
const NOTICE_TYPES = { sub: 1, resub: 1, subgift: 1, submysterygift: 1, giftpaidupgrade: 1, anongiftpaidupgrade: 1, raid: 1, bitsbadgetier: 1 };
function sampleMsg(M, s) {
  if (s.kick) return M.kick.parseEvent('App\\Events\\' + s.kick[0], JSON.stringify(s.kick[1])).msg;
  const p = M.ircParse.parseLine(s.irc);
  if (p.command === 'PRIVMSG') {
    const m = M.ircParse.toChatMessage(p);
    if (m.msgId === 'highlighted-message') m.highlight = true;
    return m;
  }
  const n = M.ircParse.toNoticeMessage(p);
  if (n.type === 'announcement') {
    n.kind = 'chat';
    n.announcement = n.announceColor || 'PRIMARY';
  } else if (!NOTICE_TYPES[n.type]) n.kind = 'chat';
  return n;
}

function lookupIn(maps) {
  return (word) => {
    for (const m of maps) { const e = m.get(word); if (e) return e; }
    return null;
  };
}
// overlay.js tokensFor at the given cfg (7TV, BTTV and FFZ global emotes; Kick lines get 7TV only).
function tokensFor(M, maps, cfg, m) {
  if (m.platform === 'kick') return M.tokenizer.tokenize(m, { lookup: lookupIn([maps.stv]), bttvPrefixes: null, gifs: false }).items;
  const r = M.tokenizer.tokenize(m, { lookup: lookupIn([maps.stvHome, maps.stv, maps.bttv, maps.ffz]), bttvPrefixes: maps.bttvPrefixes, gifs: cfg.gifs !== false });
  let items = r.items;
  if (cfg.replies !== false && m.reply) items = M.tokenizer.stripReplyPrefix(items, m.reply);
  return items;
}
// overlay.js nameFor at defaults (readable names, paints on).
function nameFor(M, s, m) {
  if (s.noName) return {};
  return { text: m.displayName || m.login || '', color: M.util.readableColor(m.color || M.util.defaultColor(m.userId, m.login)), paintId: s.paint || null };
}

// ---------- (1) models ----------

// key -> [cfg overrides, partial]: partial cfgs are what tests and the renderer's own callers may pass.
const MODEL_VARIANTS = {
  defaults: [{}, false],
  'defaults-partial': [{}, true],
  horizontal: [{ layout: 'horizontal' }, false],
  'horizontal-partial': [{ layout: 'horizontal' }, true],
  bg40: [{ bg: 40 }, false],
  'size-large': [{ size: 'large' }, false],
  'size-large-partial': [{ size: 'large' }, true],
  'size-small': [{ size: 'small' }, false]
};
// The builder preview on a HiDPI screen asks for bigger images (OBS draws at 1).
const DPRS = { defaults: [1, 2], 'size-large': [1, 2] };

// The renderer compares lines by sigOf(model) (JSON.stringify); a model holds no integer-like keys, so the
// parsed sig written to the fixture gives back the same string, key order included.
function sigModel(R, model) {
  const sig = R.sigOf(model);
  const o = JSON.parse(sig);
  if (JSON.stringify(o) !== sig) throw new Error('parity-capture: a model does not round-trip through JSON: ' + sig);
  return o;
}

function captureModels() {
  return isolated(() => {
    const M = modules();
    const R = M.renderer._internal;
    const maps = emoteMaps();
    const samples = sampleSet().map((s) => Object.assign({}, s, { msg: sampleMsg(M, s) }));
    const out = {};
    Object.keys(MODEL_VARIANTS).forEach((v) => {
      const over = MODEL_VARIANTS[v][0];
      const cfg = R.normalizeCfg(MODEL_VARIANTS[v][1] ? Object.assign({}, over) : Object.assign(M.config.defaults(), over));
      (DPRS[v] || [1]).forEach((dpr) => {
        const name = dpr === 1 ? v : v + '@' + dpr + 'x';
        const rows = {};
        samples.forEach((s) => {
          const chat = (m) => {
            const nm = nameFor(M, s, m);
            const pid = cfg.paints !== false && nm.paintId ? String(nm.paintId) : '';
            return R.modelFor(m, cfg, {
              kind: 'chat', items: R.normTokens(tokensFor(M, maps, cfg, m), m).items, action: !!m.action,
              badges: s.badges, name: { text: nm.text, color: nm.color, paint: pid || null }, dpr: dpr, noReply: !!s.noReply
            });
          };
          const list = [];
          if (s.msg.kind === 'notice') {
            list.push(R.modelFor(s.msg, cfg, { kind: 'notice', badges: s.badges }));
            if (s.msg.text && /\S/.test(s.msg.text)) list.push(chat(R.userPart(s.msg)));
          } else list.push(chat(s.msg));
          rows[s.key] = list.map((model) => sigModel(R, model));
        });
        out[name] = rows;
      });
    });
    return out;
  });
}

// ---------- (2) DOM ----------

const BASE_KEYS = new Set(['ownerDocument', 'nodeType', 'parentNode', 'childNodes', 'tagName', 'className', 'style',
  'attributes', 'listeners', 'classList', 'sheet', 'data']);
function sorted(o) {
  const out = {};
  Object.keys(o).sort().forEach((k) => { out[k] = typeof o[k] === 'function' ? '[function]' : o[k]; });
  return out;
}
// Every element: tag, class, attributes, every own Style key (setProperty and direct assignment alike), own
// properties (src, alt, namespaceURI, onerror...), listeners, a <style>'s rules, and the children in order.
function serialize(n) {
  if (n.nodeType === 3) return { text: n.data };
  const o = { tag: n.tagName };
  if (n.className) o.cls = n.className;
  const attrs = sorted(n.attributes || {});
  if (Object.keys(attrs).length) o.attrs = attrs;
  const style = sorted(Object.assign({}, n.style));
  if (Object.keys(style).length) o.style = style;
  const props = {};
  Object.keys(n).filter((k) => !BASE_KEYS.has(k)).sort().forEach((k) => { props[k] = typeof n[k] === 'function' ? '[function]' : plain(n[k]); });
  if (Object.keys(props).length) o.props = props;
  const heard = {};
  Object.keys(n.listeners || {}).sort().forEach((k) => { if (n.listeners[k].length) heard[k] = n.listeners[k].length; });
  if (Object.keys(heard).length) o.listeners = heard;
  if (n.sheet) o.rules = n.sheet.cssRules.slice();
  if (n.parentNode && n.parentNode.className === 'lines') o.textContent = n.textContent;
  if (n.childNodes.length) o.kids = n.childNodes.map(serialize);
  return o;
}

const DOM_VARIANTS = {
  defaults: [{}, 1],
  horizontal: [{ layout: 'horizontal' }, 1],
  bg40: [{ bg: 40 }, 1],
  'size-large': [{ size: 'large' }, 1]
};

// The real renderer on a fresh fake document with every sample pushed and flushed. cfg is what the overlay
// passes (config.parse output); the deps answer like overlay.js at defaults. M: modules().
function renderSamples(M, cfg, dpr) {
  const maps = emoteMaps();
  const rules = {};
  const P = paints(M.paintCss);
  Object.keys(P).forEach((id) => { rules[id] = M.paintCss.ruleFor(P[id]); });
  const samples = sampleSet().map((s) => Object.assign({}, s, { msg: sampleMsg(M, s) }));
  const byId = new Map();
  samples.forEach((s) => byId.set(s.msg.id, s));
  const sampleOf = (m) => byId.get(m.id) || byId.get(m.noticeId);
  const doc = createDocument({ dpr: dpr || 1 });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const r = M.renderer.createRenderer({
    root: root, cfg: cfg,
    deps: {
      tokensFor: (m) => tokensFor(M, maps, cfg, m),
      badgesFor: (m) => sampleOf(m).badges,
      nameFor: (m) => nameFor(M, sampleOf(m), m),
      paintRule: (id) => rules[id] || null,
      shouldShow: () => true
    }
  });
  const applied = { cls: root.className, style: sorted(Object.assign({}, root.style)) };
  r.clearMessage('m-gone'); // the parent of 'reply-gone' was deleted: its reply loses the header
  samples.forEach((s) => r.push(s.msg));
  r.flush();
  return { r: r, doc: doc, root: root, applied: applied, samples: samples };
}

function captureDom() {
  return isolated(() => {
    const M = modules();
    const out = {};
    Object.keys(DOM_VARIANTS).forEach((v) => {
      const x = renderSamples(M, Object.assign(M.config.defaults(), DOM_VARIANTS[v][0]), DOM_VARIANTS[v][1]);
      out[v] = { root: x.applied, chat: serialize(x.root), head: serialize(x.doc.head) };
      x.r.destroy();
    });
    return out;
  });
}

// ---------- (3) URLs, settings.js and demo frames; (4) Google Fonts links ----------

const HOSTED = ['https://chat.masstar.org/builder.html', 'http://localhost:8080/builder.html'];
const FILE = 'file:///E:/Github/Twitch%20Chat%20Overlay/builder.html';
const URL_SAMPLES = {
  defaults: {},
  channel: { channel: 'forsen' },
  'look-mix': { channel: 'forsen', size: 'large', animate: false, block: ['nightbot', 'some_user'], font: 'Open Sans' },
  'kick-only': { kick: 'xqc', kick_room: '668' },
  'twitch-kick': { channel: 'home', kick: 'kickname', kick_room: '668', platform_icons: false },
  'row-top': { channel: 'home', layout: 'horizontal', align: 'top', bg: 40, shadow: 0 },
  'fade-max': { channel: 'home', fade: 30, max: 20, history: 0 },
  filters: { channel: 'home', bots: true, hide_commands: true, events: false, replies: false, first_msg: true },
  'look-off': { channel: 'home', badges: false, paints: false, readable: false, gifs: false, shared: false },
  'providers-off': { channel: 'home', badges_7tv: false, badges_ffzap: false, badges_homies: false, badges_kick: false, stv_lookup: false,
    emotes_7tv: false, emotes_bttv: false, emotes_ffz: false },
  'system-font': { channel: 'home', font: 'system-ui', size: 'small', shadow: 3, debug: true },
  'pixel-font': { channel: 'home', font: 'Press Start 2P', bg: 100, shadow: 1 },
  demo: { demo: true, kick: 'demo' }
};
function params(url) {
  const out = [];
  new URL(url).searchParams.forEach((v, k) => out.push([k, v]));
  return out;
}

function captureUrls() {
  return isolated(() => {
    const M = modules();
    const samples = {};
    Object.keys(URL_SAMPLES).forEach((k) => {
      const cfg = Object.assign(M.config.defaults(), URL_SAMPLES[k]);
      const preview = M.builder.previewUrl(cfg, HOSTED[0]);
      const file = M.builder.overlayUrl(cfg, FILE);
      samples[k] = {
        hosted: HOSTED.map((b) => M.builder.overlayUrl(cfg, b)),
        toParams: M.config.toParams(cfg).toString(),
        toObject: plain(M.config.toObject(cfg)),
        settings: M.builder.settingsSnippet(cfg),
        // These list every key, so they grow when keys are added: compare the 1.5.2 keys, in this order.
        preview: { url: preview, params: params(preview) },
        file: { url: file, params: params(file) }
      };
    });
    const demos = [];
    M.home.DEMOS.forEach((d) => {
      [d.src, d.src + '&animate=0'].forEach((src) => {
        const url = M.home.demoSrc(src, M.config);
        demos.push({ src: src, url: url, params: params('https://x/' + url) });
      });
    });
    return { samples: samples, demoSrc: demos };
  });
}

// The Google Fonts links overlay.js adds: at boot (Inter, the default), then for live font changes.
function captureFonts() {
  return isolated(async () => {
    const h = await bootOverlay('?channel=' + CHANNEL);
    const at = (i) => h.links.slice(i).map((l) => ({ rel: l.rel, href: l.href }));
    const boot = at(0);
    globalThis.parent = {};
    const live = {};
    ['Open Sans', 'press start 2p', 'Arial', 'system-ui', 'serif', 'Inter', 'Roboto'].forEach((font) => {
      const before = h.links.length;
      h.listeners.message.forEach((fn) => fn({ source: globalThis.parent, data: { type: 'tco-config', cfg: { font: font } } }));
      live[font] = at(before);
    });
    return { boot: boot, inter: boot.length ? boot[0].href : null, live: live };
  });
}

// ---------- (5) intake: overlay.js with stubbed loaders and sockets ----------

function fakeEl(tag) {
  return {
    tagName: tag, hidden: true, textContent: '', children: [], parentNode: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
  };
}

// Boots js/overlay.js the way tests/overlay.test.js does; loaders answer with the fixed data below.
async function bootOverlay(search, history) {
  fresh();
  delete globalThis.TCO;
  delete globalThis.TCO_SETTINGS;
  delete globalThis.__tcoErrors;
  const h = {
    calls: [], pushed: [], cleared: [], clearPreds: [], links: [], listeners: {}, lookupWants: [], kick: null, irc: null,
    els: { chat: fakeEl('div'), hint: fakeEl('div'), debug: fakeEl('div') }
  };
  const head = fakeEl('head');
  head.appendChild = function (c) { c.parentNode = this; h.links.push(c); return c; };
  globalThis.document = { readyState: 'complete', head: head, getElementById: (id) => h.els[id] || null, createElement: (tag) => fakeEl(tag) };
  globalThis.TCO_NO_AUTOBOOT = true;
  globalThis.location = { search: search };
  globalThis.parent = globalThis;
  globalThis.addEventListener = (type, fn) => { (h.listeners[type] = h.listeners[type] || []).push(fn); };
  // Every loader is stubbed below; anything that still reaches the network is listed with them, and fails.
  globalThis.fetch = (u) => { h.calls.push('fetch(' + String(u && u.url || u) + ')'); return Promise.reject(new TypeError('Failed to fetch')); };
  globalThis.WebSocket = function (u) { h.calls.push('WebSocket(' + String(u) + ')'); throw new Error('parity-capture: no sockets'); };
  overlayOrder().forEach(load);
  const T = globalThis.TCO;
  const maps = emoteMaps();

  function stub(obj, name, label, impl) {
    obj[name] = function () {
      const args = Array.from(arguments);
      h.calls.push(label + '(' + args.filter((a) => a === null || /^(string|number|boolean)$/.test(typeof a)).map(String).join(',') + ')');
      return impl.apply(null, args);
    };
  }
  const ok = (v) => () => Promise.resolve(typeof v === 'function' ? v() : v);
  const never = () => new Promise(() => {});
  const badgeSet = (pairs) => new Map(pairs.map((p) => [p[0], new Map(p[1].map((v) => [v[0], v[1]]))]));
  const tb = (b) => ({ title: b.title, urls: b.urls });
  stub(T.twitchBadges, 'loadGlobal', 'twitch-global', ok(() => badgeSet([
    ['broadcaster', [['1', tb(B.caster)]]], ['moderator', [['1', tb(B.mod)]]], ['vip', [['1', tb(B.vip)]]],
    ['subscriber', [['0', tb(B.sub0)]]], ['bits', [['100', tb(twitchBadge('bits', '100', 'cheer 100'))]]]
  ])));
  stub(T.twitchBadges, 'loadChannel', 'twitch-channel', ok(() => badgeSet([
    ['subscriber', [['0', tb(B.sub0)], ['3', tb(B.sub3)], ['12', tb(B.sub12)]]]
  ])));
  stub(T.twitchBadges, 'lookupUser', 'lookupUser', (login) => Promise.resolve({ id: HOME, login: login, displayName: 'Home',
    logo: 'https://static-cdn.jtvnw.net/jtv_user_pictures/home-profile_image-300x300.png', banned: false }));
  stub(T.twitchBadges, 'lookupUserById', 'lookupUserById', (id) => Promise.resolve({ id: id, login: 'partner', displayName: 'Partner',
    logo: B.avatar.urls[1] }));
  stub(T.seventv, 'loadGlobal', '7tv-global', ok(() => maps.stv));
  stub(T.seventv, 'loadChannel', '7tv-channel', ok(() => ({ emotes: new Map(maps.stvHome), setId: null, ownerId: null })));
  stub(T.seventv, 'loadCatalog', '7tv-catalog', never);
  stub(T.seventv, 'loadSet', '7tv-set', ok(() => new Map()));
  stub(T.bttv, 'loadGlobal', 'bttv-global', ok(() => ({ emotes: maps.bttv, prefixes: maps.bttvPrefixes })));
  stub(T.bttv, 'loadChannel', 'bttv-channel', ok(() => ({ emotes: new Map(), bots: new Set([U.chanbot.login]) })));
  const one = (b) => new Map([[U.extras.id, [b]]]); // collector wears one of each
  stub(T.bttv, 'loadStaffBadges', 'bttv-badges', ok(() => one({ provider: 'bttv', title: 'BTTV Staff', urls: { 1: 'https://cdn.betterttv.net/badges/staff.svg' } })));
  stub(T.ffz, 'loadGlobal', 'ffz-global', ok(() => maps.ffz));
  stub(T.ffz, 'loadRoom', 'ffz-room', ok(() => ({ emotes: new Map(), modUrls: null, vipUrls: null, userBadges: new Map() })));
  stub(T.ffz, 'loadBadges', 'ffz-badges', ok(() => ({
    defs: new Map([['2', { id: 2, title: 'FFZ Developer', urls: B.ffzDev.urls, color: '#E0B726' }],
      ['3', { id: 3, title: 'Bot', urls: { 1: 'https://cdn.frankerfacez.com/badge/3/1' }, replaces: 'moderator' }]]),
    users: new Map([[U.ffzdev.id, [2]], [U.ffzbot.id, [3]]])
  })));
  stub(T.extraBadges, 'loadChatterino', 'chatterino', ok(() => one({ provider: 'chatterino', title: 'Chatterino Top Donator',
    urls: { 1: 'https://fourtf.com/chatterino/badges/top-donator.png' } })));
  stub(T.extraBadges, 'loadFfzap', 'ffzap', ok(() => one({ provider: 'ffzap', title: 'FFZ:AP Supporter', urls: { 1: 'https://api.ffzap.com/v1/user/badge/1016/1' } })));
  stub(T.extraBadges, 'loadHomiesSource', 'homies', (i, into) => Promise.resolve(into));
  stub(T.irc, 'loadHistory', 'history', ok(() => (history || []).map((raw) => T.ircParse.parseLine(raw))));
  stub(T.kick, 'lookupChannel', 'kick-lookup', () => Promise.reject(new TypeError('Failed to fetch')));
  T.kick.createKick = function (o) {
    h.kick = { opts: o, start() {}, kick() {},
      send(event, data) { o.onEvent(globalThis.TCO.kick.parseEvent('App\\Events\\' + event, JSON.stringify(data))); } };
    return h.kick;
  };
  T.irc.createIrc = function (o) {
    const seen = new Set();
    h.irc = {
      onLine: o.onLine, onStatus: o.onStatus, start() {}, kick() {},
      markSeen(id) { const had = seen.has(id); seen.add(id); return had; },
      receive(p) {
        if (p.command === 'PRIVMSG' && p.tags.id) { if (seen.has(p.tags.id)) return; seen.add(p.tags.id); }
        o.onLine(p);
      }
    };
    return h.irc;
  };
  T.seventv.createEventClient = function () { return { addChannel() {}, addObject() {}, removeObject() {}, start() {}, kick() {} }; };
  T.seventv.createLookup = function () { return { want(uid) { h.lookupWants.push(uid); } }; };
  T.bttv.createLive = function () { return { start() {}, kick() {} }; };
  T.renderer.createRenderer = function (o) {
    h.deps = o.deps;
    return {
      push(m) {
        const shown = !!o.deps.shouldShow(m);
        h.pushed.push({ m: m, msg: plain(m), shown: shown });
        return shown;
      },
      clearUser(u) { h.cleared.push('user:' + u); },
      clearAll(pred) { if (pred) { h.clearPreds.push(pred); h.cleared.push('some'); } else h.cleared.push('all'); },
      clearMessage(id) { h.cleared.push('msg:' + id); },
      rerender(pred) { h.pushed.forEach((p) => { if (typeof pred === 'function') pred(p.m); }); return 0; },
      refilter() {},
      setConfig() {}, hold() {}, hasUser() { return false; }, stats() { return null; }
    };
  };
  T.overlay.boot();
  await settle();
  return h;
}

const HISTORY = [
  priv('h-1', U.waver, 'an older line from history', { 'tmi-sent-ts': String(EPOCH - 60000), 'rm-received-ts': String(EPOCH - 59000) }),
  priv('h-gone', U.troll, 'a deleted history line', { 'rm-deleted': '1' }),
  priv('h-2', U.sub, 'history Kappa', { 'tmi-sent-ts': String(EPOCH - 30000) })
];
// Lines only the intake capture feeds: filtered chatters, gifts, gates, moderation.
function extraTranscript() {
  return [
    { irc: priv('x-bot', U.bot, 'Nightbot says hi') },
    { irc: priv('x-chanbot', U.chanbot, 'channel bot line') },
    { irc: priv('x-troll', U.troll, 'troll line') },
    { irc: priv('x-reply-troll', U.replier, '@Troll no u', { 'reply-parent-msg-id': 'x-troll', 'reply-parent-user-id': U.troll.id,
      'reply-parent-user-login': U.troll.login, 'reply-parent-display-name': U.troll.name, 'reply-parent-msg-body': 'troll line' }) },
    { irc: priv('x-reply-cmd', U.replier, '@Nightbot !discord', { 'reply-parent-msg-id': 'x-bot', 'reply-parent-user-login': U.bot.login,
      'reply-parent-display-name': U.bot.name }) },
    { irc: priv('x-ffzbot', U.ffzbot, 'ffz bot badge replaces mod') },
    { irc: priv('x-extras', U.extras, 'chatterino, ffzap and bttv badges') },
    { irc: priv('x-beta', { id: '1020', login: 'musicalfox30', name: 'Musicalfox30', color: '', badges: '' }, 'beta tester here') },
    { irc: unotice('x-mystery', U.gifter, 'submysterygift', 'Gifter is gifting 2 Tier 1 Subs!', '', { 'msg-param-community-gift-id': 'G1', 'msg-param-mass-gift-count': '2' }) },
    { irc: unotice('x-gift1', U.gifter, 'subgift', 'Gifter gifted a sub to A!', '', { 'msg-param-community-gift-id': 'G1' }) },
    { irc: unotice('x-gift2', U.gifter, 'subgift', 'Gifter gifted a sub to B!', '', { 'msg-param-community-gift-id': 'G1' }) },
    { irc: unotice('x-gift3', U.gifter, 'subgift', 'Gifter gifted a sub to C!', '') },
    { irc: unotice('x-upgrade', U.newbie, 'giftpaidupgrade', 'Newbie is continuing the Gift Sub they got from Gifter!', '') },
    { irc: unotice('x-bitsbadge', U.extras, 'bitsbadgetier', 'bits badge tier notification', 'wow', { 'msg-param-threshold': '1000' }) },
    { irc: unotice('x-ritual', U.newbie, 'ritual', 'Newbie is new to chat! Say hello!', 'HeyGuys I am new') },
    { irc: unotice('x-milestone', U.sub, 'viewermilestone', 'SubFan watched 10 consecutive streams!', '') },
    { irc: unotice('x-shared-resub', U.partner, 'sharedchatnotice', 'PartnerFan subscribed at Tier 1.', 'partner resub text',
      { 'source-msg-id': 'resub', 'source-room-id': PARTNER, 'source-id': 'src-resub' }) },
    { irc: unotice('x-shared-home', U.sub, 'sharedchatnotice', 'SubFan subscribed.', 'home copy', { 'source-msg-id': 'resub', 'source-room-id': HOME }) },
    { irc: unotice('x-shared-ann', U.partner, 'sharedchatnotice', '', 'partner announcement', { 'source-msg-id': 'announcement',
      'source-room-id': PARTNER, 'msg-param-color': 'GREEN' }) },
    { kick: ['ChatMessageEvent', kickChat('a1b2c3d4-0004', KICK.bot, 'kick bot line')] },
    { kick: ['GiftedSubscriptionsEvent', { chatroom_id: Number(KICK_ROOM), gifter_username: 'KickFan', gifted_usernames: ['a', 'b', 'c'] }] },
    { kick: ['GiftedSubscriptionsEvent', { chatroom_id: Number(KICK_ROOM), gifter_username: 'KickFan', gifted_usernames: ['KickPlain'] }] },
    { kick: ['StreamHostEvent', { chatroom_id: Number(KICK_ROOM), host_username: 'KickHost', number_viewers: 12 }] },
    { kick: ['SubscriptionEvent', { chatroom_id: Number(KICK_ROOM), username: 'KickPlain', months: 1 }] },
    { kick: ['MessageDeletedEvent', { message: { id: 'a1b2c3d4-0002' } }] },
    { kick: ['UserBannedEvent', { user: { id: 9000004, username: 'BotRix' } }] },
    { irc: tagStr({ 'room-id': HOME, 'target-msg-id': 'x-troll', 'tmi-sent-ts': String(EPOCH) }) + ' :tmi.twitch.tv CLEARMSG #' + CHANNEL + ' :troll line' },
    { irc: tagStr({ 'room-id': HOME, 'target-user-id': U.troll.id, 'tmi-sent-ts': String(EPOCH) }) + ' :tmi.twitch.tv CLEARCHAT #' + CHANNEL + ' :troll' },
    { irc: tagStr({ 'room-id': HOME, 'tmi-sent-ts': String(EPOCH) }) + ' :tmi.twitch.tv CLEARCHAT #' + CHANNEL },
    { kick: ['ChatroomClearEvent', { id: 'clear-1' }] }
  ];
}

const INTAKE_BOOTS = {
  defaults: '?channel=' + CHANNEL + '&kick=kickname&kick_room=' + KICK_ROOM,
  // Today's filters on, to pin what they hide (and the reply headers deliver drops).
  filtered: '?channel=' + CHANNEL + '&kick=kickname&kick_room=' + KICK_ROOM + '&block=troll,botrix&hide_commands=1&events=0&shared=0&bots=1'
};

// overlay.js booted with search, the history, then the sample set and the extra transcript fed through its
// handlers (with two painted 7TV users set up through the state's own maps). Returns bootOverlay's handle:
// h.pushed holds every message that reached renderer.push, h.deps the overlay's real renderer deps.
async function intakeWorld(search) {
  const h = await bootOverlay(search, HISTORY);
  await settle();
  tick(6000); // tier 2 (3 s) and tier 3 (5 s) loaders
  await settle();
  h.irc.onStatus('joined', globalThis.TCO.ircParse.parseLine('@room-id=' + HOME + ' :tmi.twitch.tv ROOMSTATE #' + CHANNEL));
  await settle();
  const S = globalThis.TCO.overlay.state();
  // A painted 7TV user, through the state's own maps.
  const P = paints(globalThis.TCO.paintCss);
  Object.keys(P).forEach((id) => S.stv.paints.set(id, P[id]));
  S.stv.badges.set(STV_BADGE, B.stv);
  S.stv.gqlStyle.set(U.painted.id, { paint: PAINT_GRAD, badge: STV_BADGE });
  S.stv.gqlStyle.set(U.ffzdev.id, { paint: PAINT_IMAGE, badge: null });
  sampleSet().concat(extraTranscript()).forEach((s) => {
    if (s.kick) h.kick.send(s.kick[0], s.kick[1]);
    else h.irc.receive(globalThis.TCO.ircParse.parseLine(s.irc));
  });
  await settle();
  tick(1000);
  await settle();
  return h;
}

async function intakeRun(search) {
  const h = await intakeWorld(search);
  const d = h.deps;
  const records = h.pushed.map((p) => {
    const nm = d.nameFor(p.m);
    const rec = { msg: p.msg, shown: p.shown, showNow: !!d.shouldShow(p.m), name: plain(nm), badges: plain(d.badgesFor(p.m)) };
    if (p.m.kind === 'chat') rec.tokens = plain(d.tokensFor(p.m));
    if (nm && nm.paintId) rec.paintRule = d.paintRule(nm.paintId);
    return rec;
  });
  return {
    loaders: h.calls.slice().sort(),
    records: records,
    cleared: h.cleared.slice(),
    clearAllPicks: h.clearPreds.map((pred) => h.pushed.map((p) => !!pred(p.m))),
    lookupWants: h.lookupWants.slice(),
    hint: h.els.hint.hidden ? null : h.els.hint.children.map((c) => c.textContent)
  };
}

function captureIntake() {
  return isolated(async () => {
    const out = {};
    for (const k of Object.keys(INTAKE_BOOTS)) out[k] = await intakeRun(INTAKE_BOOTS[k]);
    return out;
  });
}

// ---------- everything ----------

// The fixture file format: JSON with anything that fits in WIDTH characters on one line, so a changed model,
// element or intake record shows up as a short diff. Deterministic: keys stay in insertion order.
const WIDTH = 120;
function toJson(v, indent) {
  indent = indent || '';
  if (v === undefined || typeof v === 'function') return 'null'; // as JSON.stringify writes them in an array
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || flat.length + indent.length <= WIDTH) return flat;
  const inner = indent + '  ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((x) => inner + toJson(x, inner)).join(',\n') + '\n' + indent + ']';
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function');
  if (!keys.length) return '{}';
  return '{\n' + keys.map((k) => inner + JSON.stringify(k) + ': ' + toJson(v[k], inner)).join(',\n') + '\n' + indent + '}';
}

// Each capture fixes the clock and restores the globals it touched; run them one at a time.
async function captureAll() {
  const models = await captureModels();
  const dom = await captureDom();
  const urls = await captureUrls();
  urls.fonts = await captureFonts();
  const intake = await captureIntake();
  return { models: models, dom: dom, urls: urls, intake: intake };
}

module.exports = {
  captureAll, captureModels, captureDom, captureUrls, captureFonts, captureIntake, toJson,
  // For the parity tests: the same inputs, to re-run them against the current code. bootOverlay sets globals
  // and needs the fixed clock: call it inside isolated().
  modules, sampleSet, sampleMsg, emoteMaps, tokensFor, nameFor, serialize, renderSamples, bootOverlay, intakeWorld, isolated,
  sorted, MODEL_VARIANTS, DOM_VARIANTS, URL_SAMPLES, INTAKE_BOOTS, HOSTED, FILE, EPOCH
};
