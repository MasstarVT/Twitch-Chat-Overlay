'use strict';
// Provider normalizers/parsers (fixtures copied from live payload shapes, 2026-09) plus loader
// fallback logic against a stubbed fetch. No network access.
const test = require('node:test');
const assert = require('node:assert/strict');

const twitchBadges = require('../js/twitch-badges.js');
const bttv = require('../js/bttv.js');
const ffz = require('../js/ffz.js');
const extra = require('../js/extra-badges.js');

// ---------- helpers ----------
// routes: [[string|RegExp, {status, body} | Error | fn(url, init)]]
function stubFetch(t, routes) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    for (const [match, resp] of routes) {
      if (typeof match === 'string' ? url === match : match.test(url)) {
        const r = typeof resp === 'function' ? resp(url, init) : resp;
        if (r instanceof Error) throw r;
        const status = r.status || 200;
        const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return { status, ok: status >= 200 && status < 300, text: async () => body };
      }
    }
    throw new TypeError('fetch failed (unrouted): ' + url);
  };
  t.after(() => { globalThis.fetch = orig; });
  t.mock.method(console, 'warn', () => {});
  return calls;
}

const CDN_B = 'https://static-cdn.jtvnw.net/badges/v1/';
const MOD_UUID = '3267646d-33f0-4b17-b3df-f923a41db1d0';
const SUB_UUID = 'eb0dceb5-9c55-4a8b-b9d9-bb414ab79bb9';
function ivrVersion(id, uuid, title) {
  return {
    id, image_url_1x: CDN_B + uuid + '/1', image_url_2x: CDN_B + uuid + '/2', image_url_4x: CDN_B + uuid + '/3',
    title, description: title, click_action: null, click_url: null
  };
}
const IVR_GLOBAL = [
  { set_id: 'moderator', versions: [ivrVersion('1', MOD_UUID, 'Moderator')] },
  { set_id: 'subscriber', versions: [ivrVersion('0', SUB_UUID, 'Subscriber')] }
];
const IVR_FORSEN = [
  { set_id: 'subscriber', versions: [ivrVersion('0', SUB_UUID, 'Subscriber'), ivrVersion('3006', SUB_UUID, '6-Month Subscriber')] }
];
const GQL_GLOBAL = {
  data: { badges: [
    { setID: 'moderator', version: '1', title: 'Moderator', imageURL: CDN_B + MOD_UUID + '/3' },
    { setID: 'subscriber', version: '0', title: 'Subscriber', imageURL: CDN_B + SUB_UUID + '/3' }
  ] },
  extensions: { durationMilliseconds: 48, requestID: '01M3B72KY8JAT6E50Q900GG8ZE' }
};
const GQL_FORSEN = {
  data: { user: { broadcastBadges: [
    { setID: 'subscriber', version: '48', title: '4-Year Subscriber', imageURL: CDN_B + 'e501f4f7-2ee0-457a-a904-1979bd161810/3' }
  ] } },
  extensions: {}
};
const IVR_USER_XQC = [{
  banned: false, displayName: 'xQc', login: 'xqc', id: '71092938', bio: '', followers: 1,
  logo: 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-profile_image-9298dca608632101-600x600.jpeg',
  roles: { isPartner: true }, badges: []
}];

// ======================= twitch-badges =======================
test('twitchBadges.parseIvrBadges: IVR bare array -> set/version map with 1/2/4 urls', () => {
  const sets = twitchBadges.parseIvrBadges(IVR_GLOBAL);
  const mod = sets.get('moderator').get('1');
  assert.equal(mod.title, 'Moderator');
  assert.deepEqual(mod.urls, { 1: CDN_B + MOD_UUID + '/1', 2: CDN_B + MOD_UUID + '/2', 4: CDN_B + MOD_UUID + '/3' });
  assert.equal(twitchBadges.parseIvrBadges([]).size, 0);
  assert.throws(() => twitchBadges.parseIvrBadges({ statusCode: 404 }));
});

test('twitchBadges.parseGqlGlobal / parseGqlChannel: flat GQL shapes, null user, errors', () => {
  const sets = twitchBadges.parseGqlGlobal(GQL_GLOBAL);
  assert.deepEqual(sets.get('moderator').get('1').urls,
    { 1: CDN_B + MOD_UUID + '/1', 2: CDN_B + MOD_UUID + '/2', 4: CDN_B + MOD_UUID + '/3' });
  assert.throws(() => twitchBadges.parseGqlGlobal({ errors: [{ message: 'service timeout' }] }), /service timeout/);
  assert.equal(twitchBadges.parseGqlChannel(GQL_FORSEN).get('subscriber').get('48').title, '4-Year Subscriber');
  assert.equal(twitchBadges.parseGqlChannel({ data: { user: null } }).size, 0);
  assert.equal(twitchBadges.parseGqlChannel({ data: { user: { broadcastBadges: [] } } }).size, 0);
  assert.throws(() => twitchBadges.parseGqlChannel({ data: { user: null }, errors: [{ message: 'x' }] }));
  assert.throws(() => twitchBadges.parseGqlChannel({ data: null, errors: [{ message: 'x' }] }));
  // A field error (user present, broadcastBadges null) is a failed load that retries, not "no badges".
  assert.throws(() => twitchBadges.parseGqlChannel({ data: { user: { broadcastBadges: null } },
    errors: [{ message: 'service timeout', path: ['user', 'broadcastBadges'] }] }), /service timeout/);
  assert.equal(twitchBadges.parseGqlChannel({ data: { user: { broadcastBadges: null } } }).size, 0);
});

test('twitchBadges.parseUser: bare array -> {id,login,displayName,logo}; [] -> null', () => {
  const u = twitchBadges.parseUser(IVR_USER_XQC, 'xqc');
  assert.equal(u.id, '71092938');
  assert.equal(u.login, 'xqc');
  assert.equal(u.displayName, 'xQc');
  // IVR's 600x600 logo becomes the 70x70 rendition (the avatar badge is 1em).
  assert.equal(u.logo, 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-profile_image-9298dca608632101-70x70.jpeg');
  const logo = (l) => twitchBadges.parseUser([{ id: 1, login: 'a', logo: l }]).logo;
  assert.equal(logo('https://static-cdn.jtvnw.net/user-default-pictures-uv/ebe4cd89-b4f4-4cd9-adac-2f30151b4209-profile_image-300x300.png'),
    'https://static-cdn.jtvnw.net/user-default-pictures-uv/ebe4cd89-b4f4-4cd9-adac-2f30151b4209-profile_image-70x70.png');
  assert.equal(logo('https://static-cdn.jtvnw.net/jtv_user_pictures/a.png'), 'https://static-cdn.jtvnw.net/jtv_user_pictures/a.png');
  assert.equal(logo('https://evil.example/x-profile_image-600x600.png'), null);
  assert.equal(u.banned, false);
  assert.equal(twitchBadges.parseUser([], 'xqc'), null);
  assert.equal(twitchBadges.parseUser([{ id: 5, login: 'someoneelse' }], 'xqc'), null, 'an answer for another login');
  assert.equal(twitchBadges.parseUser([{ id: 5, login: 'someoneelse' }], null).id, '5', 'by-id lookups keep the first entry');
  assert.equal(twitchBadges.parseUser({ error: 'x' }), null);
  assert.equal(twitchBadges.parseUser([{ id: 123, login: 'a', logo: 'javascript:alert(1)' }]).id, '123');
  assert.equal(twitchBadges.parseUser([{ id: 123, login: 'a', logo: 'javascript:alert(1)' }]).logo, null);
});

test('twitchBadges.loadGlobal: IVR first, GET without headers', async (t) => {
  const calls = stubFetch(t, [['https://api.ivr.fi/v2/twitch/badges/global', { body: IVR_GLOBAL }]]);
  const sets = await twitchBadges.loadGlobal();
  assert.equal(sets.size, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers, undefined);
  assert.equal(calls[0].init.method, 'GET');
});

test('twitchBadges.loadGlobal: IVR 5xx -> GQL POST with Client-ID; both failing rejects', async (t) => {
  let gqlInit = null;
  const calls = stubFetch(t, [
    [/api\.ivr\.fi/, { status: 503, body: 'down' }],
    ['https://gql.twitch.tv/gql', (url, init) => { gqlInit = init; return { body: GQL_GLOBAL }; }]
  ]);
  const sets = await twitchBadges.loadGlobal();
  assert.equal(sets.get('subscriber').get('0').title, 'Subscriber');
  assert.equal(calls.length, 2);
  assert.equal(gqlInit.method, 'POST');
  assert.equal(gqlInit.headers['Client-ID'], 'kimne78kx3ncx6brgo4mv6wki5h1ko');
  assert.deepEqual(JSON.parse(gqlInit.body), { query: 'query{badges{setID version title imageURL(size:QUADRUPLE)}}' });

  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(twitchBadges.loadGlobal());
});

test('twitchBadges.loadChannel: 404 and [] are empty, network error falls back to GQL, bad id rejects', async (t) => {
  let mode = '404';
  const calls = stubFetch(t, [
    [/api\.ivr\.fi\/v2\/twitch\/badges\/channel\?id=\d+$/, () => mode === '404'
      ? { status: 404, body: { statusCode: 404, error: { message: 'Channel was not found' } } }
      : mode === 'empty' ? { body: [] } : mode === 'ok' ? { body: IVR_FORSEN } : new TypeError('network')],
    ['https://gql.twitch.tv/gql', { body: GQL_FORSEN }]
  ]);
  assert.equal((await twitchBadges.loadChannel('999999999999')).size, 0);
  mode = 'empty';
  assert.equal((await twitchBadges.loadChannel(552120296)).size, 0);
  mode = 'ok';
  assert.equal((await twitchBadges.loadChannel('22484632')).get('subscriber').size, 2);
  assert.equal(calls.filter((c) => /gql/.test(c.url)).length, 0);
  mode = 'down';
  const viaGql = await twitchBadges.loadChannel('22484632');
  assert.ok(viaGql.get('subscriber').get('48'));
  const q = JSON.parse(calls[calls.length - 1].init.body).query;
  assert.equal(q, 'query{user(id:"22484632"){broadcastBadges{setID version title imageURL(size:QUADRUPLE)}}}');
  const before = calls.length;
  await assert.rejects(twitchBadges.loadChannel('12"){x}'));
  assert.equal(calls.length, before);
});

test('twitchBadges.lookupUser / lookupUserById', async (t) => {
  const calls = stubFetch(t, [
    ['https://api.ivr.fi/v2/twitch/user?login=xqc', { body: IVR_USER_XQC }],
    ['https://api.ivr.fi/v2/twitch/user?login=nobody_here', { body: [] }],
    ['https://api.ivr.fi/v2/twitch/user?id=71092938', { body: IVR_USER_XQC }],
    ['https://api.ivr.fi/v2/twitch/user?login=_bad', { status: 400, body: { error: 'pattern' } }]
  ]);
  assert.equal((await twitchBadges.lookupUser('XQC')).id, '71092938');
  assert.equal(await twitchBadges.lookupUser('nobody_here'), null);
  assert.equal(await twitchBadges.lookupUser('_bad'), null);
  assert.equal((await twitchBadges.lookupUserById(71092938)).login, 'xqc');
  const n = calls.length;
  assert.equal(await twitchBadges.lookupUser('bad name!'), null);
  assert.equal(await twitchBadges.lookupUserById('abc'), null);
  assert.equal(calls.length, n);
});

// ======================= bttv =======================
const BTTV_GLOBAL = [
  { id: '54fa8f1401e468494b85b537', code: ':tf:', imageType: 'png', animated: false, userId: '5561169bd6b9d206222a8c19', modifier: false },
  { id: '566ca04265dbbdab32ec054a', code: 'SourPls', imageType: 'gif', animated: true, userId: '5561169bd6b9d206222a8c19', modifier: false, width: 28, height: 28 },
  { id: '6468f7acaee1f7f47567708e', code: 'c!', imageType: 'png', animated: false, userId: '5561169bd6b9d206222a8c19', modifier: true },
  { id: '6468f845aee1f7f47567709b', code: 'h!', imageType: 'png', animated: false, userId: '5561169bd6b9d206222a8c19', modifier: true },
  { id: '5e76d399d6581c3724c0f0b8', code: 'cvMask', imageType: 'png', animated: false, userId: '54ee2465b822020506c52a52', modifier: false },
  { id: '5e76d338d6581c3724c0f0b2', code: 'cvHazmat', imageType: 'png', animated: false, userId: '54ee2465b822020506c52a52', modifier: false }
];
const BTTV_FORSEN = {
  id: '5561c9b1d6b9d206222a8c73',
  bots: ['snusbot', 'SnusBot', ''],
  avatar: 'https://static-cdn.jtvnw.net/jtv_user_pictures/forsen-profile_image.png',
  channelEmotes: [
    { id: '5f3eb452b2efd65d77e867ed', code: 'forsenBlunder', imageType: 'png', animated: false, userId: '555943515393e61c772ee968' },
    { id: '5e4e7a1f08b4447d56a92967', code: 'forsenWide', imageType: 'png', animated: false, userId: '555943515393e61c772ee968', width: 112, height: 28 }
  ],
  sharedEmotes: [
    { id: '54fa92ee01e468494b85b553', code: 'RebeccaBlack', imageType: 'png', animated: false, user: { id: '5561169bd6b9d206222a8c19', name: 'nightdev', displayName: 'NightDev', providerId: '29045896' } },
    { id: '579f9ac281108bf71a550e97', code: 'MegaLUL', codeOriginal: 'MEGALUL', imageType: 'png', animated: false, user: { id: '5565cd1e7a134a6c027700d1', name: 'con_no_1', displayName: 'Con_No_1', providerId: '27033225' } },
    { id: '5e76d399d6581c3724c0f0b8', code: 'cvMask', imageType: 'png', animated: false, user: { id: 'x', name: 'x', displayName: 'x', providerId: '1' } },
    { id: '000000000000000000000001', code: 'forsenBlunder', imageType: 'png', animated: false, user: { id: 'y', name: 'y', displayName: 'y', providerId: '2' } }
  ]
};
const BTTV_BADGES = [
  { id: '54ee2465b822020506c52a52', name: 'night', displayName: 'Night', providerId: '11785491', badge: { type: 1, description: 'NightDev Developer', svg: 'https://cdn.betterttv.net/badges/developer.svg' } },
  { id: 'aaa', name: 'translator1', displayName: 'T1', providerId: '11785491', badge: { type: 4, description: 'BetterTTV Translator', svg: 'https://cdn.betterttv.net/badges/translator.svg' } },
  { id: 'bbb', name: 'ghost', displayName: 'Ghost', providerId: '', badge: { type: 4, description: 'BetterTTV Translator', svg: 'https://cdn.betterttv.net/badges/translator.svg' } }
];
const LOOKUP_PRO = {
  name: 'someprouser', providerId: '72566781', channel: 'twitch:22484632', pro: true, subscribed: true, glow: false,
  usernameEffect: null, usernameHoverEffect: null,
  badge: { url: 'https://cdn.betterttv.net/badges/pro/14ecc0f1-1111-2222-3333-444455556666.webp', startedAt: '2024-11-09T18:33:11.000Z' },
  emotes: [{ id: '60b0c36388e2a4b54e61d8a2', code: 'cvMask', imageType: 'gif', animated: true, user: { id: 'u', name: 'someprouser' }, channel: 'twitch:22484632', urlTemplate: 'https://cdn.betterttv.net/emote/{id}/{{image}}', url: 'https://cdn.betterttv.net/emote/60b0c36388e2a4b54e61d8a2/1x' }]
};
const LOOKUP_NULL_BADGE = { name: 'yetiapocalypse', providerId: '72566780', channel: 'twitch:22484632', pro: true, subscribed: false, emotes: [], badge: null };

test('bttv.normalizeEmote: webp urls 1x/2x/3x -> keys 1/2/4, default 28x28, zw only for global codes', () => {
  const e = bttv.normalizeEmote(BTTV_GLOBAL[4], true);
  assert.deepEqual(e, {
    provider: 'bttv', id: '5e76d399d6581c3724c0f0b8', name: 'cvMask', w: 28, h: 28,
    urls: {
      1: 'https://cdn.betterttv.net/emote/5e76d399d6581c3724c0f0b8/1x.webp',
      2: 'https://cdn.betterttv.net/emote/5e76d399d6581c3724c0f0b8/2x.webp',
      4: 'https://cdn.betterttv.net/emote/5e76d399d6581c3724c0f0b8/3x.webp'
    },
    zw: true
  });
  assert.equal(bttv.normalizeEmote(BTTV_GLOBAL[4], false).zw, false);
  const wide = bttv.normalizeEmote(BTTV_FORSEN.channelEmotes[1], false);
  assert.equal(wide.w, 112);
  assert.equal(wide.h, 28);
  assert.equal(bttv.normalizeEmote({ id: '../x', code: 'Bad' }), null);
  assert.equal(bttv.normalizeEmote({ id: 'abc' }), null);
  assert.ok(bttv.ZW_CODES instanceof Set && bttv.ZW_CODES.size === 8 && bttv.ZW_CODES.has('SoSnowy'));
});

test('bttv.parseGlobal: modifiers become prefixes and never emotes', () => {
  const g = bttv.parseGlobal(BTTV_GLOBAL);
  assert.deepEqual([...g.prefixes].sort(), ['c!', 'h!']);
  assert.equal(g.emotes.has('c!'), false);
  assert.equal(g.emotes.size, 4);
  assert.equal(g.emotes.get('cvHazmat').zw, true);
  assert.equal(g.emotes.get('SourPls').zw, false);
  assert.throws(() => bttv.parseGlobal({ message: 'x' }));
  assert.equal(bttv.parseGlobal({ __notFound: true }).emotes.size, 0);
});

test('bttv.parseChannel: merges channel + shared by code, aliases by code, lowercases bots, 404 empty', () => {
  const c = bttv.parseChannel(BTTV_FORSEN);
  assert.equal(c.emotes.size, 5);
  assert.ok(c.emotes.has('MegaLUL'));
  assert.equal(c.emotes.has('MEGALUL'), false);
  assert.equal(c.emotes.get('forsenBlunder').id, '5f3eb452b2efd65d77e867ed'); // channel-owned wins
  assert.equal(c.emotes.get('cvMask').zw, false); // channel emotes are never zero-width
  assert.deepEqual([...c.bots], ['snusbot']);
  const nf = bttv.parseChannel({ __notFound: true });
  assert.equal(nf.emotes.size, 0);
  assert.equal(nf.bots.size, 0);
  const xqc = bttv.parseChannel({ id: 'x', bots: ['xqcbot'], avatar: '', channelEmotes: [], sharedEmotes: [] });
  assert.equal(xqc.emotes.size, 0);
  assert.ok(xqc.bots.has('xqcbot'));
});

test('bttv.parseStaffBadges: keyed by providerId, svg for every scale, empty ids skipped', () => {
  const m = bttv.parseStaffBadges(BTTV_BADGES);
  assert.equal(m.size, 1);
  const list = m.get('11785491');
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    provider: 'bttv', title: 'NightDev Developer',
    urls: { 1: 'https://cdn.betterttv.net/badges/developer.svg', 2: 'https://cdn.betterttv.net/badges/developer.svg', 4: 'https://cdn.betterttv.net/badges/developer.svg' }
  });
});

test('bttv.parseLookupUser: Pro badge from badge.url, null badge allowed, personal emotes normalized', () => {
  const u = bttv.parseLookupUser(LOOKUP_PRO);
  assert.equal(u.userId, '72566781');
  assert.equal(u.badge.title, 'BTTV Pro');
  assert.equal(u.badge.urls[4], LOOKUP_PRO.badge.url);
  assert.equal(u.emotes.get('cvMask').zw, false);
  assert.equal(u.emotes.get('cvMask').urls[1], 'https://cdn.betterttv.net/emote/60b0c36388e2a4b54e61d8a2/1x.webp');
  const n = bttv.parseLookupUser(LOOKUP_NULL_BADGE);
  assert.equal(n.badge, null);
  assert.equal(n.emotes.size, 0);
  assert.equal(bttv.parseLookupUser({ providerId: '' }), null);
});

test('bttv.upsertEmote / removeEmoteById handle renames by id', () => {
  const m = new Map();
  bttv.upsertEmote(m, bttv.normalizeEmote({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'Old' }));
  bttv.upsertEmote(m, bttv.normalizeEmote({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'New' }));
  assert.deepEqual([...m.keys()], ['New']);
  assert.equal(bttv.removeEmoteById(m, 'aaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.equal(m.size, 0);
});

test('bttv live emote_update is a patch: a rename without a size keeps the old size', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { FakeWS, sockets } = fakeSocketFactory();
  const m = bttv.parseChannel(BTTV_FORSEN).emotes; // forsenWide is 112x28
  const live = bttv.createLive({ roomId: 22484632, WebSocket: FakeWS, onEmoteUpdate: (e) => bttv.upsertEmote(m, e) });
  live.start();
  sockets[0].onopen();
  const send = (o) => sockets[0].onmessage({ data: JSON.stringify(o) });
  send({ name: 'emote_update', data: { channel: 'twitch:22484632', emote: { id: '5e4e7a1f08b4447d56a92967', code: 'forsenWider' } } });
  assert.equal(m.has('forsenWide'), false);
  assert.deepEqual([m.get('forsenWider').w, m.get('forsenWider').h], [112, 28]);
  // an update that carries a size uses it; one for an unknown id gets the 28x28 default
  send({ name: 'emote_update', data: { channel: 'twitch:22484632', emote: { id: '5e4e7a1f08b4447d56a92967', code: 'forsenWider', width: 56, height: 28 } } });
  assert.equal(m.get('forsenWider').w, 56);
  send({ name: 'emote_update', data: { channel: 'twitch:22484632', emote: { id: 'eeeeeeeeeeeeeeeeeeeeeeee', code: 'New' } } });
  assert.deepEqual([m.get('New').w, m.get('New').h], [28, 28]);
  live.stop();
});

test('bttv: emote sizes under 1 px are broken payloads and use the default', () => {
  const b = bttv.normalizeEmote({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'X', width: 112, height: 0.001 });
  assert.deepEqual([b.w, b.h], [112, 28]);
  assert.equal(bttv.normalizeEmote({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', code: 'X', width: 1e-20, height: 28 }).w, 28);
});

test('bttv loaders: plain GETs (no headers) to the cached routes', async (t) => {
  const calls = stubFetch(t, [
    ['https://api.betterttv.net/3/cached/emotes/global', { body: BTTV_GLOBAL }],
    ['https://api.betterttv.net/3/cached/users/twitch/22484632', { body: BTTV_FORSEN }],
    ['https://api.betterttv.net/3/cached/users/twitch/1', { status: 404, body: { message: 'user not found' } }],
    ['https://api.betterttv.net/3/cached/badges/twitch', { body: BTTV_BADGES }]
  ]);
  assert.equal((await bttv.loadGlobal()).prefixes.size, 2);
  assert.equal((await bttv.loadChannel(22484632)).emotes.size, 5);
  assert.equal((await bttv.loadChannel('1')).emotes.size, 0);
  assert.equal((await bttv.loadStaffBadges()).size, 1);
  for (const c of calls) {
    assert.equal(c.init.headers, undefined);
    assert.equal(c.init.method, 'GET');
  }
  // Bad room ids (including path traversal from a Shared Chat tag) reject without any request.
  const n = calls.length;
  for (const id of ['abc', '1/../../x', '../../emotes/global?', '', '1 2']) await assert.rejects(bttv.loadChannel(id), /invalid room id/);
  assert.equal(calls.length, n);
});

test('bttv.loadChannel: {fresh:true} revalidates (cache no-cache); a normal load uses the browser cache', async (t) => {
  const util = require('../js/util.js');
  const seen = [];
  t.mock.method(util, 'fetchJson', async (url, opts) => { seen.push([url, opts]); return BTTV_FORSEN; });
  await bttv.loadChannel(22484632);
  await bttv.loadChannel('22484632', { fresh: true });
  assert.equal(seen[0][0], 'https://api.betterttv.net/3/cached/users/twitch/22484632');
  assert.equal(seen[0][1].cache, undefined);
  assert.equal(seen[1][1].cache, 'no-cache');
  assert.equal(seen[1][1].headers, undefined, 'still a plain GET (the cached routes reject preflights)');
});

function fakeSocketFactory() {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.closed = false; sockets.push(this); }
    send(s) { this.sent.push(s); }
    close() { this.closed = true; }
  }
  return { FakeWS, sockets };
}

test('bttv.createLive: joins the channel, filters by channel, forwards emote and user events', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { FakeWS, sockets } = fakeSocketFactory();
  const ev = [];
  const live = bttv.createLive({
    roomId: 22484632,
    WebSocket: FakeWS,
    onEmoteAdd: (e) => ev.push(['add', e.name, e.zw]),
    onEmoteUpdate: (e) => ev.push(['update', e.name]),
    onEmoteRemove: (id) => ev.push(['remove', id]),
    onUser: (uid, info) => ev.push(['user', uid, info.badge && info.badge.title, info.emotes.size])
  });
  live.start();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'wss://sockets.betterttv.net/ws');
  sockets[0].onopen();
  assert.deepEqual(sockets[0].sent.map((s) => JSON.parse(s)), [{ name: 'join_channel', data: { name: 'twitch:22484632' } }]);

  const send = (o) => sockets[0].onmessage({ data: JSON.stringify(o) });
  send({ name: 'emote_create', data: { channel: 'twitch:71092938', emote: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', code: 'Other' } } });
  send({ name: 'emote_create', data: { channel: 'twitch:22484632', emote: { id: 'cccccccccccccccccccccccc', code: 'cvMask', imageType: 'png', animated: false, user: {} } } });
  send({ name: 'emote_update', data: { channel: 'twitch:22484632', emote: { id: 'cccccccccccccccccccccccc', code: 'Renamed' } } });
  send({ name: 'emote_delete', data: { channel: 'twitch:22484632', emoteId: 'cccccccccccccccccccccccc' } });
  send({ name: 'emote_delete', data: { channel: 'twitch:1', emoteId: 'dddddddddddddddddddddddd' } });
  send({ name: 'lookup_user', data: LOOKUP_PRO });
  send({ name: 'lookup_user', data: LOOKUP_NULL_BADGE });
  sockets[0].onmessage({ data: 'not json' });
  send({ name: 'settings_update', data: {} });

  assert.deepEqual(ev, [
    ['add', 'cvMask', false],
    ['update', 'Renamed'],
    ['remove', 'cccccccccccccccccccccccc'],
    ['user', '72566781', 'BTTV Pro', 1],
    ['user', '72566780', null, 0]
  ]);
  for (const s of sockets[0].sent) assert.notEqual(JSON.parse(s).name, 'broadcast_me');
  live.stop();
  assert.equal(sockets[0].closed, true);
});

test('bttv.createLive: proactive reconnect every 45 min, rejoins on the new socket', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { FakeWS, sockets } = fakeSocketFactory();
  const live = bttv.createLive({ roomId: '22484632', WebSocket: FakeWS });
  live.start();
  sockets[0].onopen();
  t.mock.timers.tick(bttv.REFRESH_MS - 1);
  assert.equal(sockets[0].closed, false);
  t.mock.timers.tick(1);
  assert.equal(sockets[0].closed, true);
  t.mock.timers.tick(2000);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.equal(JSON.parse(sockets[1].sent[0]).name, 'join_channel');
  live.stop();
});

test('bttv.createLive: onReopen after a dropped socket reopens, not on the first open or the planned refresh', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(console, 'warn', () => {});
  const { FakeWS, sockets } = fakeSocketFactory();
  let reopens = 0;
  const live = bttv.createLive({ roomId: '22484632', WebSocket: FakeWS, onReopen: () => { reopens++; } });
  live.start();
  sockets[0].onopen();
  assert.equal(reopens, 0, 'first open');
  sockets[0].onclose({ code: 1006 }); // dropped
  t.mock.timers.tick(300000);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.equal(reopens, 1, 'reopened after a drop: the caller refetches');
  t.mock.timers.tick(bttv.REFRESH_MS);
  t.mock.timers.tick(2000); // planned refresh
  assert.equal(sockets.length, 3);
  sockets[2].onopen();
  assert.equal(reopens, 1, 'the planned refresh does not refetch');
  t.mock.timers.tick(bttv.REFRESH_MS);
  t.mock.timers.tick(2000); // a planned refresh whose new socket fails before opening
  assert.equal(sockets.length, 4);
  sockets[3].onclose({ code: 1006 });
  t.mock.timers.tick(300000);
  sockets[4].onopen();
  assert.equal(reopens, 2, 'a failed refresh is a drop');
  live.stop();
});

test('bttv.createLive: a refresh whose socket hits the connect timeout (no onopen/onclose) counts as a drop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(console, 'warn', () => {});
  const { FakeWS, sockets } = fakeSocketFactory();
  let reopens = 0;
  const live = bttv.createLive({ roomId: '22484632', WebSocket: FakeWS, onReopen: () => { reopens++; } });
  live.start();
  sockets[0].onopen();
  t.mock.timers.tick(bttv.REFRESH_MS);
  t.mock.timers.tick(2000); // planned refresh
  assert.equal(sockets.length, 2);
  t.mock.timers.tick(20000); // the refresh socket never answers: connect timeout, handlers nulled
  assert.equal(sockets[1].closed, true);
  assert.equal(sockets[1].onclose, null, 'onclose never runs on this path');
  t.mock.timers.tick(300000);
  assert.equal(sockets.length, 3);
  sockets[2].onopen();
  assert.equal(reopens, 1, 'the gap after a timed-out refresh is resynced');
  // A refresh after that is still planned.
  t.mock.timers.tick(bttv.REFRESH_MS);
  t.mock.timers.tick(300000);
  sockets[3].onopen();
  assert.equal(reopens, 1, 'the next planned refresh does not refetch');
  live.stop();
});

test('bttv.createLive: a refresh whose socket constructor throws counts as a drop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(console, 'warn', () => {});
  const sockets = [];
  let failNext = false;
  class FlakyWS {
    constructor(url) {
      if (failNext) { failNext = false; throw new Error('boom'); }
      this.url = url; this.sent = []; this.closed = false; sockets.push(this);
    }
    send(s) { this.sent.push(s); }
    close() { this.closed = true; }
  }
  let reopens = 0;
  const live = bttv.createLive({ roomId: '22484632', WebSocket: FlakyWS, onReopen: () => { reopens++; } });
  live.start();
  sockets[0].onopen();
  failNext = true;
  t.mock.timers.tick(bttv.REFRESH_MS);
  t.mock.timers.tick(2000); // planned refresh: constructor throws
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(300000);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.equal(reopens, 1);
  live.stop();
});

test('bttv.createLive: invalid room id gives an inert controller that never opens a socket', (t) => {
  t.mock.method(console, 'warn', () => {});
  let made = 0;
  class CountingWS { constructor() { made++; } send() {} close() {} }
  for (const roomId of ['abc', '1/../../x', '../../emotes/global?', '']) {
    const live = bttv.createLive({ roomId, WebSocket: CountingWS });
    assert.doesNotThrow(() => { live.start(); live.kick(); live.stop(); });
  }
  assert.equal(made, 0);
  const ok = bttv.createLive({ roomId: '1', WebSocket: CountingWS });
  ok.start();
  assert.equal(made, 1, 'the counting stub does see a valid room');
  ok.stop();
});

// ======================= ffz =======================
const FFZ_EMOTE = (o) => Object.assign({
  id: 9, name: 'ZrehplaR', height: 30, width: 33, public: false, hidden: true, modifier: false, modifier_flags: 0,
  offset: null, margins: null, css: null, owner: { _id: 2, name: 'dansalvato', display_name: 'dansalvato' }, artist: null,
  urls: { 1: 'https://cdn.frankerfacez.com/emote/9/1', 2: 'https://cdn.frankerfacez.com/emote/9/2', 4: 'https://cdn.frankerfacez.com/emote/9/4' },
  status: 1, usage_count: 1
}, o);
const FFZ_GLOBAL = {
  default_sets: [3, 1539687],
  sets: {
    3: { id: 3, _type: 0, title: 'Global Emotes', emoticons: [FFZ_EMOTE({})] },
    1532818: { id: 1532818, _type: 0, title: 'Subwoofer Emote Effects', emoticons: [FFZ_EMOTE({ id: 720001, name: 'ffzHyper', modifier: true, modifier_flags: 12289 })] },
    1539687: { id: 1539687, _type: 0, title: 'Emote Effects', emoticons: [
      FFZ_EMOTE({ id: 723890, name: 'ffzW', width: 32, height: 32, modifier: true, modifier_flags: 9, hidden: false }),
      FFZ_EMOTE({ id: 723891, name: 'ffzX', modifier: true, modifier_flags: 3 })
    ] }
  },
  user_ids: { 1532818: [49267024, 222216085] }
};
const FFZ_XQC_ROOM = {
  room: {
    _id: 166895, twitch_id: 71092938, youtube_id: null, id: 'xqc', is_group: false, display_name: 'xQc', set: 166907,
    moderator_badge: 'https://cdn.frankerfacez.com/room-badge/mod/id/71092938/v/98a226c4/1', vip_badge: null,
    mod_urls: { 1: 'https://cdn.frankerfacez.com/room-badge/mod/id/71092938/v/98a226c4/1' },
    user_badges: {}, user_badge_ids: {}, css: null
  },
  sets: { 166907: { id: 166907, _type: 1, icon: null, title: 'Channel: xQc', css: null, emoticons: [
    FFZ_EMOTE({ id: 246878, name: 'WideHard', height: 20, width: 50, public: true, hidden: false,
      urls: { 1: 'https://cdn.frankerfacez.com/emote/246878/1', 2: 'https://cdn.frankerfacez.com/emote/246878/2', 4: 'https://cdn.frankerfacez.com/emote/246878/4' } })
  ] } }
};
const PAJ_VIP = 'https://cdn.frankerfacez.com/room-badge/vip/id/11148817/v/bc2bbe0d/';
const PAJ_MOD = 'https://cdn.frankerfacez.com/room-badge/mod/id/11148817/v/e47297b4/';
const FFZ_PAJLADA_ROOM = {
  room: {
    _id: 64515, twitch_id: 11148817, youtube_id: null, id: 'pajlada', is_group: false, display_name: 'pajlada', set: 64515,
    moderator_badge: PAJ_MOD + '1',
    vip_badge: { 1: PAJ_VIP + '1', 2: PAJ_VIP + '2', 4: PAJ_VIP + '4' },
    mod_urls: { 1: PAJ_MOD + '1', 2: PAJ_MOD + '2', 4: PAJ_MOD + '4' },
    user_badges: { 2: ['pajbot', 'supibot'] },
    user_badge_ids: { 2: [82008718, 68136884], 3: [82008718] },
    css: null
  },
  sets: { 64515: { id: 64515, emoticons: [
    FFZ_EMOTE({ id: 720707, name: 'forsenLaughingAtYou', height: 28, width: 28, public: true, hidden: false,
      urls: { 1: 'https://cdn.frankerfacez.com/emote/720707/1', 2: 'https://cdn.frankerfacez.com/emote/720707/2', 4: 'https://cdn.frankerfacez.com/emote/720707/4' },
      animated: { 1: 'https://cdn.frankerfacez.com/emote/720707/animated/1', 2: 'https://cdn.frankerfacez.com/emote/720707/animated/2', 4: 'https://cdn.frankerfacez.com/emote/720707/animated/4' } }),
    FFZ_EMOTE({ id: 5, name: 'Proto', urls: { 1: '//cdn.frankerfacez.com/emote/5/1' }, animated: null })
  ] } }
};
const FFZ_BADGES = {
  badges: [
    { id: 2, name: 'bot', title: 'Bot', slot: 1, replaces: 'moderator', color: '#595959', image: 'https://cdn.frankerfacez.com/badge/2/1',
      urls: { 1: 'https://cdn.frankerfacez.com/badge/2/1', 2: 'https://cdn.frankerfacez.com/badge/2/2', 4: 'https://cdn.frankerfacez.com/badge/2/4' }, css: null },
    { id: 3, name: 'supporter', title: 'FFZ Supporter', slot: 5, replaces: null, color: '#755000', image: 'https://cdn.frankerfacez.com/badge/3/1',
      urls: { 1: 'https://cdn.frankerfacez.com/badge/3/1', 2: 'https://cdn.frankerfacez.com/badge/3/2', 4: 'https://cdn.frankerfacez.com/badge/3/4' }, css: null }
  ],
  users: { 2: [73227142, 82455692], 3: [88100526, 73227142], 99: [1] }
};

test('ffz.normalizeEmote: animated preferred, absUrl, modifier flags -> zw/hidden/flags', () => {
  const anim = ffz.normalizeEmote(FFZ_PAJLADA_ROOM.sets[64515].emoticons[0]);
  assert.equal(anim.urls[1], 'https://cdn.frankerfacez.com/emote/720707/animated/1');
  assert.equal(anim.urls[4], 'https://cdn.frankerfacez.com/emote/720707/animated/4');
  assert.deepEqual([anim.provider, anim.id, anim.w, anim.h, anim.zw, anim.hidden, anim.flags], ['ffz', '720707', 28, 28, false, false, 0]);
  const proto = ffz.normalizeEmote(FFZ_PAJLADA_ROOM.sets[64515].emoticons[1]);
  assert.deepEqual(proto.urls, { 1: 'https://cdn.frankerfacez.com/emote/5/1' });
  const w = ffz.normalizeEmote(FFZ_GLOBAL.sets[1539687].emoticons[0]);
  assert.deepEqual([w.hidden, w.zw, w.flags], [true, false, 9]);
  const overlay = ffz.normalizeEmote(FFZ_EMOTE({ id: 7, name: 'ffzOverlay', modifier: true, modifier_flags: 0 }));
  assert.deepEqual([overlay.hidden, overlay.zw], [false, true]);
  const plain = ffz.normalizeEmote(FFZ_EMOTE({}));
  assert.deepEqual([plain.hidden, plain.zw, plain.w, plain.h], [false, false, 33, 30]); // API `hidden:true` is not our Hidden
  assert.equal(ffz.normalizeEmote(FFZ_EMOTE({ urls: {} })), null);
});

test('ffz.parseGlobal: default_sets only', () => {
  const g = ffz.parseGlobal(FFZ_GLOBAL);
  assert.deepEqual([...g.keys()].sort(), ['ZrehplaR', 'ffzW', 'ffzX']);
  assert.equal(g.has('ffzHyper'), false);
  assert.throws(() => ffz.parseGlobal({ sets: {} }));
});

test('ffz.parseRoom: xqc (mod_urls {1} only, no vip), pajlada (vip map, user_badge_ids inverted), 404', () => {
  const x = ffz.parseRoom(FFZ_XQC_ROOM);
  assert.equal(x.emotes.get('WideHard').w, 50);
  assert.deepEqual(x.modUrls, { 1: 'https://cdn.frankerfacez.com/room-badge/mod/id/71092938/v/98a226c4/1' });
  assert.equal(x.vipUrls, null);
  assert.equal(x.userBadges.size, 0);
  const p = ffz.parseRoom(FFZ_PAJLADA_ROOM);
  assert.deepEqual(p.vipUrls, { 1: PAJ_VIP + '1', 2: PAJ_VIP + '2', 4: PAJ_VIP + '4' });
  assert.deepEqual(p.modUrls, { 1: PAJ_MOD + '1', 2: PAJ_MOD + '2', 4: PAJ_MOD + '4' });
  assert.deepEqual(p.userBadges.get('82008718'), ['2', '3']);
  assert.deepEqual(p.userBadges.get('68136884'), ['2']);
  assert.equal(p.userBadges.has(82008718), false);
  assert.equal(p.emotes.size, 2);
  const nf = ffz.parseRoom({ __notFound: true });
  assert.deepEqual([nf.emotes.size, nf.modUrls, nf.vipUrls, nf.userBadges.size], [0, null, null, 0]);
  const legacy = ffz.parseRoom({ room: { set: 1, mod_urls: null, moderator_badge: '//cdn.frankerfacez.com/room-badge/mod/id/1/1', vip_badge: 'x' }, sets: {} });
  assert.deepEqual(legacy.modUrls, { 1: 'https://cdn.frankerfacez.com/room-badge/mod/id/1/1' });
  assert.equal(legacy.vipUrls, null);
});

test('ffz.parseBadges: defs keyed by String id, numeric user ids -> String, unknown badge ids dropped', () => {
  const b = ffz.parseBadges(FFZ_BADGES);
  const bot = b.defs.get('2');
  assert.equal(bot.title, 'Bot');
  assert.equal(bot.color, '#595959');
  assert.equal(bot.replaces, 'moderator');
  assert.equal(bot.urls[4], 'https://cdn.frankerfacez.com/badge/2/4');
  assert.equal(b.defs.get('3').replaces, null);
  assert.deepEqual(b.users.get('73227142'), ['2', '3']);
  assert.deepEqual(b.users.get('88100526'), ['3']);
  assert.equal(b.users.has('1'), false);
  assert.equal(b.users.has(73227142), false);
  // Users with the same badges share one frozen list (the live list is ~40k users, nearly all ['3']).
  const big = ffz.parseBadges({ badges: FFZ_BADGES.badges, users: { 2: [7, 8], 3: [5, 6, 7, 8] } });
  assert.equal(big.users.get('5'), big.users.get('6'));
  assert.equal(big.users.get('7'), big.users.get('8'));
  assert.deepEqual(big.users.get('7'), ['2', '3']);
  assert.ok(Object.isFrozen(big.users.get('5')));
  assert.notEqual(big.users.get('5'), big.users.get('7'));
});

test('ffz: emote sizes under 1 px are broken payloads and use the default', () => {
  const f = ffz.normalizeEmote(FFZ_EMOTE({ width: 33, height: 1e-20 }));
  assert.deepEqual([f.w, f.h], [33, 28]);
  assert.equal(ffz.normalizeEmote(FFZ_EMOTE({ width: 0.001 })).w, 28);
  assert.equal(ffz.normalizeEmote(FFZ_EMOTE({ width: 1, height: 1 })).w, 1);
});

test('ffz loaders: urls and 404 handling', async (t) => {
  const calls = stubFetch(t, [
    ['https://api.frankerfacez.com/v1/set/global/ids', { body: FFZ_GLOBAL }],
    ['https://api.frankerfacez.com/v1/room/id/11148817', { body: FFZ_PAJLADA_ROOM }],
    ['https://api.frankerfacez.com/v1/room/id/1', { status: 404, body: { status: 404, error: 'Not Found', message: 'No such room' } }],
    ['https://api.frankerfacez.com/v1/badges/ids', { body: FFZ_BADGES }]
  ]);
  assert.equal((await ffz.loadGlobal()).size, 3);
  assert.equal((await ffz.loadRoom(11148817)).vipUrls[2], PAJ_VIP + '2');
  assert.equal((await ffz.loadRoom('1')).emotes.size, 0);
  assert.equal((await ffz.loadBadges()).defs.size, 2);
  assert.equal(calls.length, 4);
  // Bad room ids (including path traversal from a Shared Chat tag) reject without any request.
  for (const id of ['x', '1/../../x', '../../set/global/ids?', '', '1 2']) await assert.rejects(ffz.loadRoom(id), /invalid room id/);
  assert.equal(calls.length, 4);
});

// ======================= extra-badges =======================
const CHATTERINO = { badges: [
  { tooltip: 'Chatterino Top Donator', image1: 'https://fourtf.com/chatterino/badges/topd.png', image2: 'https://fourtf.com/chatterino/badges/topd2x.png', image3: 'https://fourtf.com/chatterino/badges/topd3x.png', users: ['241105451'] },
  { tooltip: 'Chatterino Developer', image1: 'https://fourtf.com/chatterino/badges/dev.png', image2: 'https://fourtf.com/chatterino/badges/dev2x.png', image3: 'https://fourtf.com/chatterino/badges/dev3x.png', users: ['117691339', '11148817', ''] },
  { tooltip: 'Chatterino Supporter', image1: 'https://fourtf.com/chatterino/badges/supporter.png', image2: 'https://fourtf.com/chatterino/badges/supporter2x.png', image3: 'https://fourtf.com/chatterino/badges/supporter3x.png', users: ['11148817'] }
] };
const FFZAP = [
  { id: '19709686', tier: 1 },
  { id: '41064621', badge_color: '#D1008C', badge_is_colored: 0, tier: 2 },
  { id: '41064622', tier: 2 },
  { id: '4867723', badge_color: '#812FA8', badge_is_colored: 0, tier: 3 },
  { id: '11819690', tier: 3, badge_color: '#FFD700', badge_is_colored: 0, admin: 1 },
  { id: '22025290', tier: 3 },
  { id: '23161357', tier: 3, badge_color: '#123456', badge_is_colored: 1 },
  { id: '23161358', tier: 3, badge_is_colored: 0 },
  { id: '../x', tier: 1 }
];
const HOMIES_1 = { badges: [
  { id: '1', tooltip: 'Homies Developer', image1: 'https://itzalex.github.io/badgesusers/dev/badge.png', users: ['59842770', '536387934'], image2: 'https://itzalex.github.io/badgesusers/dev/badge2x.png', image3: 'https://itzalex.github.io/badgesusers/dev/badge3x.png' },
  { id: '3', tooltip: 'Homies Supporter', image1: 'https://itzalex.github.io/badgesusers/supporter2/badge.png', users: ['195025348'], image2: 'https://itzalex.github.io/badgesusers/supporter2/badge2x.png', image3: 'https://itzalex.github.io/badgesusers/supporter2/badge3x.png' }
] };
const HOMIES_2 = { badges: [
  { tooltip: 'Homies Developer', image1: 'https://itzalex.github.io/badgesusers/dev/badge.png', users: [''], image2: 'https://itzalex.github.io/badgesusers/dev/badge2x.png', image3: 'https://itzalex.github.io/badgesusers/dev/badge3x.png' },
  { tooltip: 'Homies Mod', image1: 'https://itzalex.github.io/badgesusers/mod2/badge.png', users: ['96150961', '59842770'], image2: 'https://itzalex.github.io/badgesusers/mod2/badge2x.png', image3: 'https://itzalex.github.io/badgesusers/mod2/badge3x.png' },
  { tooltip: 'Homies Developer', image1: 'https://itzalex.github.io/badgesusers/dev/badge.png', users: ['59842770'], image2: 'https://itzalex.github.io/badgesusers/dev/badge2x.png', image3: 'https://itzalex.github.io/badgesusers/dev/badge3x.png' }
] };
const HB = 'https://cdn.chatterinohomies.com/badges/90b5d49e-b5fd-4a0a-bc92-6a74408bee82/';
const HOMIES_3 = { badges: [
  { badgeFileType: 'image/webp', badgeId: '68d98dd23d60203ffbfdce6a', image1: HB + '18.webp', image2: HB + '36.webp', image3: HB + '72.webp', tooltip: 'usVesper Badge', userId: '95700563', username: 'usVesper' },
  { badgeFileType: 'image/webp', badgeId: '68d98dd23d60203ffbfdce6c', image1: HB + '18.webp', image2: HB + '36.webp', image3: HB + '72.webp', tooltip: 'Empty', userId: '', username: 'nobody' }
] };

test('extraBadges.parseChatterino: image2/3 -> 2/4 (image1 only when alone), string ids, empty ids skipped, shared badge objects', () => {
  const m = extra.parseChatterino(CHATTERINO);
  assert.equal(m.has(''), false);
  // Badges are always requested at 2x or more, so the 18 px image is not kept next to larger ones.
  assert.deepEqual(m.get('241105451')[0], {
    provider: 'chatterino', title: 'Chatterino Top Donator',
    urls: { 2: 'https://fourtf.com/chatterino/badges/topd2x.png', 4: 'https://fourtf.com/chatterino/badges/topd3x.png' }
  });
  assert.equal(m.get('117691339')[0], m.get('11148817')[0], 'one badge object per list entry');
  assert.deepEqual(m.get('11148817').map((b) => b.title), ['Chatterino Developer', 'Chatterino Supporter']);
  assert.throws(() => extra.parseChatterino([]));
  const only1 = extra.parseChatterino({ badges: [{ tooltip: 'x', image1: 'https://fourtf.com/x.png', users: ['1'] }] });
  assert.deepEqual(only1.get('1')[0].urls, { 1: 'https://fourtf.com/x.png' });
});

test('extraBadges.parseFfzap: badge urls /1 /2 /3 and ChatIS background rules', () => {
  const m = extra.parseFfzap(FFZAP);
  const b = (id) => m.get(id)[0];
  assert.deepEqual(b('19709686'), {
    provider: 'ffzap', title: 'FFZ:AP Supporter', bg: '#755000',
    urls: { 1: 'https://api.ffzap.com/v1/user/badge/19709686/1', 2: 'https://api.ffzap.com/v1/user/badge/19709686/2', 4: 'https://api.ffzap.com/v1/user/badge/19709686/3' }
  });
  assert.equal(b('41064621').bg, '#D1008C');
  assert.equal(b('41064622').bg, '#755000');
  assert.equal(b('4867723').bg, '#812FA8');
  assert.equal(b('11819690').bg, '#FFD700');
  assert.equal('bg' in b('22025290'), false);
  assert.equal('bg' in b('23161357'), false);
  assert.equal(b('23161358').bg, '#755000');
  assert.equal(m.has('../x'), false);
  assert.equal(m.size, 8);
});

test('extraBadges.parseHomies: users[] and userId shapes, badges2 [""] skipped, merged with dedupe', () => {
  const m = new Map();
  extra.parseHomies(HOMIES_1, m);
  extra.parseHomies(HOMIES_2, m);
  extra.parseHomies(HOMIES_3, m);
  assert.equal(m.has(''), false);
  assert.deepEqual(m.get('59842770').map((b) => b.title), ['Homies Developer', 'Homies Mod']);
  assert.equal(m.get('95700563')[0].provider, 'homies');
  assert.deepEqual(m.get('95700563')[0].urls, { 2: HB + '36.webp', 4: HB + '72.webp' });
  assert.equal(m.size, 5);
});

test('extraBadges Homies index: per-user CDN badges are packed, read like a Map, same badges as the plain parse', () => {
  const plain = new Map();
  const idx = extra.createHomies();
  for (const list of [HOMIES_1, HOMIES_2, HOMIES_3]) { extra.parseHomies(list, plain); extra.parseHomies(list, idx); }
  assert.equal(idx.packed.size, 1, 'the single-user chatterinohomies entry is packed');
  assert.equal(idx.size, plain.size);
  assert.equal(idx.has('95700563'), true);
  assert.equal(idx.has(''), false);
  const all = [];
  idx.forEach((list, uid) => all.push([uid, list]));
  assert.deepEqual(new Map(all), plain, 'forEach sees the same badges');
  assert.equal(idx.packed.size, 1, 'forEach does not unpack');
  plain.forEach((list, uid) => assert.deepEqual(idx.get(uid), list, uid));
  assert.equal(idx.get('95700563'), idx.get('95700563'), 'unpacked once, then the same list');
  assert.equal(idx.packed.size, 0);
  assert.equal(idx.get('nobody'), undefined);

  // Order and dedupe: a user with a list badge and a packed one, then the same packed badge again.
  const HB2 = 'https://cdn.chatterinohomies.com/badges/00000000-0000-4000-8000-000000000002/';
  const packedEntry = (uid, title, base) => ({ image1: base + '18.webp', image2: base + '36.webp', image3: base + '72.webp', tooltip: title, userId: uid });
  const h = extra.createHomies();
  extra.parseHomies(HOMIES_1, h);
  extra.parseHomies({ badges: [packedEntry('59842770', 'Mine', HB2), packedEntry('7', 'Seven', HB2), packedEntry('7', 'Seven', HB2),
    packedEntry('7', 'Other', HB)] }, h);
  assert.deepEqual(h.get('59842770').map((b) => b.title), ['Homies Developer', 'Mine']);
  assert.deepEqual(h.get('7').map((b) => b.title), ['Seven', 'Other']);
  // Anything that is not exactly cdn/<uuid>/{18,36,72}.webp takes the normal path (and https is still required).
  const odd = extra.createHomies();
  extra.parseHomies({ badges: [
    { image1: HB + '18.webp', image2: HB + '36.webp', image3: HB2 + '72.webp', tooltip: 'mixed', userId: '1' },
    { image2: 'http://cdn.chatterinohomies.com/badges/00000000-0000-4000-8000-000000000002/36.webp', tooltip: 'http', userId: '2' },
    { image1: 'https://x.example/a.png', tooltip: 'plain', userId: '3' }] }, odd);
  assert.equal(odd.packed.size, 0);
  assert.deepEqual(odd.get('1')[0].urls, { 2: HB + '36.webp', 4: HB2 + '72.webp' });
  assert.equal(odd.has('2'), false);
  assert.deepEqual(odd.get('3')[0].urls, { 1: 'https://x.example/a.png' });
});

test('extraBadges Homies index: a user\'s badges follow list order whatever order the lists arrive in', () => {
  const HB2 = 'https://cdn.chatterinohomies.com/badges/00000000-0000-4000-8000-000000000002/';
  const L0 = { badges: [{ tooltip: 'Zero', image2: 'https://itzalex.github.io/z.png', users: ['1', '2'] },
    { tooltip: 'Dup', image2: 'https://itzalex.github.io/d.png', users: ['1'] }] };
  const L1 = { badges: [{ tooltip: 'One', image2: 'https://itzalex.github.io/o.png', users: ['1'] },
    { tooltip: 'Dup', image2: 'https://itzalex.github.io/d.png', users: ['1'] }] };
  const L2 = { badges: [{ image1: HB2 + '18.webp', image2: HB2 + '36.webp', image3: HB2 + '72.webp', tooltip: 'Two', userId: '1' },
    { image1: HB + '18.webp', image2: HB + '36.webp', image3: HB + '72.webp', tooltip: 'Two', userId: '2' }] };
  const lists = [L0, L1, L2];
  const perms = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2]];
  for (const order of perms) {
    const walked = extra.createHomies();
    const h = extra.createHomies();
    for (const i of order) { extra.parseHomies(lists[i], h, i); extra.parseHomies(lists[i], walked, i); }
    const seen = new Map();
    walked.forEach((list, uid) => seen.set(uid, list.map((b) => b.title)));
    assert.deepEqual(seen.get('1'), ['Zero', 'Dup', 'One', 'Two'], 'forEach, order ' + order);
    assert.deepEqual(h.get('1').map((b) => b.title), ['Zero', 'Dup', 'One', 'Two'], 'order ' + order);
    assert.deepEqual(h.get('2').map((b) => b.title), ['Zero', 'Two'], 'order ' + order);
  }
});

test('extraBadges Homies index: first() gives one list without walking the index', () => {
  const empty = extra.createHomies();
  assert.equal(empty.first(), null);
  const packedOnly = extra.createHomies();
  extra.parseHomies(HOMIES_3, packedOnly, 2);
  assert.deepEqual(packedOnly.first().map((b) => b.title), ['usVesper Badge']);
  assert.deepEqual(packedOnly.first()[0].urls, { 2: HB + '36.webp', 4: HB + '72.webp' });
  assert.equal(packedOnly.packed.size, 1, 'first() does not unpack into the index');
  const h = extra.createHomies();
  extra.parseHomies(HOMIES_1, h, 0);
  extra.parseHomies(HOMIES_3, h, 2);
  assert.deepEqual(h.first().map((b) => b.title), ['Homies Developer']);
});

test('extraBadges.loadHomiesSource: one list per call into a shared index; failures reject for a retry', async (t) => {
  let fail3 = true;
  const calls = stubFetch(t, [
    ['https://itzalex.github.io/badges', { body: HOMIES_1 }],
    ['https://itzalex.github.io/badges2', { body: HOMIES_2 }],
    ['https://chatterinohomies.com/api/badges/list', () => (fail3 ? new TypeError('timeout') : { body: HOMIES_3 })]
  ]);
  assert.equal(extra.HOMIES_COUNT, 3);
  const idx = extra.createHomies();
  assert.equal(await extra.loadHomiesSource(0, idx), idx);
  await assert.rejects(extra.loadHomiesSource(2, idx), /timeout/);
  assert.equal(idx.size, 3);
  fail3 = false;
  await extra.loadHomiesSource(2, idx);
  await extra.loadHomiesSource(1, idx);
  assert.equal(idx.size, 5);
  assert.equal(calls.length, 4, 'only the failed list is fetched again');
  assert.deepEqual(idx.get('59842770').map((b) => b.title), ['Homies Developer', 'Homies Mod'], 'list order, not arrival order');
  assert.ok((await extra.loadHomiesSource(1)).has('96150961'), 'a new index when none is given');
  await assert.rejects(extra.loadHomiesSource(3), /no Homies list/);
});

test('extraBadges: the Homies lists get more than the 8 MB default body cap', async (t) => {
  const util = require('../js/util.js');
  const orig = util.fetchJson;
  const seen = [];
  util.fetchJson = (url, opts) => { seen.push(opts.maxBytes); return Promise.resolve({ badges: [] }); };
  t.after(() => { util.fetchJson = orig; });
  await extra.loadHomiesSource(2, extra.createHomies());
  await extra.loadHomies();
  assert.strictEqual(seen.length, 4);
  seen.forEach((b) => assert.ok(b >= 16 * 1024 * 1024));
});

test('extraBadges.loadHomies: per-list failures tolerated, rejects only when all fail', async (t) => {
  let fail3 = true;
  stubFetch(t, [
    ['https://itzalex.github.io/badges', { body: HOMIES_1 }],
    ['https://itzalex.github.io/badges2', { status: 500, body: 'oops' }],
    ['https://chatterinohomies.com/api/badges/list', () => (fail3 ? new TypeError('timeout') : { body: HOMIES_3 })]
  ]);
  const m = await extra.loadHomies();
  assert.equal(m.size, 3);
  assert.equal(m.has('96150961'), false);
  fail3 = false;
  assert.equal((await extra.loadHomies()).size, 4);
  assert.deepEqual((await extra.loadHomies()).get('95700563')[0].urls, { 2: HB + '36.webp', 4: HB + '72.webp' });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(extra.loadHomies(), /all Homies/);
});

test('extraBadges.loadChatterino / loadFfzap', async (t) => {
  const calls = stubFetch(t, [
    ['https://api.chatterino.com/badges', { body: CHATTERINO }],
    ['https://api.ffzap.com/v1/supporters', { body: FFZAP }]
  ]);
  assert.equal((await extra.loadChatterino()).size, 3);
  assert.equal((await extra.loadFfzap()).size, 8);
  for (const c of calls) assert.equal(c.init.headers, undefined);
});
