'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const stv = require('../js/seventv.js');
const util = require('../js/util.js');

const NIL = '00000000000000000000000000';
const CHANNEL_SET = '01FE9DRF000009TR6M9N941CYW';
const OTHER_SET = '01HB76NJV00002MN9KWN633MB1';
const PERSONAL_SET = '01JEY2SMVTRMC4ZHWCYKBA6M5R';
const OWNER = '01GJTZ1F90000AXQX83F1Y559G';
const PAINT_A = '01HNFTV3CG0008Y0WDTPT0GPGT';
const PAINT_B = '01JHXJFACX42RV996VE9933TB8';
const BADGE_A = '01GXP5DNHR000CV9HPMT8GM9JZ';
const NEW_SET = '01JJJ74CRHZBRMCM8F4Y2WBN6R';

// v3 ActiveEmote as served by REST and EventAPI (host.url is protocol-relative; GIF entries carry bogus static_name).
function v3Emote(id, name, flags, dataFlags, dataName) {
  const files = [];
  [1, 2, 3, 4].forEach(function (n) {
    files.push({ name: n + 'x.webp', static_name: n + 'x_static.webp', width: 32 * n, height: 32 * n, frame_count: 15, format: 'WEBP' });
    files.push({ name: n + 'x.avif', static_name: n + 'x_static.avif', width: 32 * n, height: 32 * n, frame_count: 15, format: 'AVIF' });
    files.push({ name: n + 'x.gif', static_name: n + 'x_static.gif', width: 32 * n, height: 32 * n, frame_count: 15, format: 'GIF' });
  });
  return {
    id: id, name: name, flags: flags, timestamp: 0, actor_id: null,
    data: { id: id, name: dataName || name, flags: dataFlags, animated: true, host: { url: '//cdn.7tv.app/emote/' + id, files: files } }
  };
}

function entitlement(kind, ref, twitchId) {
  return {
    id: NIL, kind: kind === 'EMOTE_SET' ? 5 : 10,
    object: {
      id: NIL, kind: kind, ref_id: ref,
      user: {
        id: '01GJTZ1F90000AXQX83F1Y5590', username: 'x',
        connections: [{ id: '999', platform: 'DISCORD' }, { id: twitchId, platform: 'TWITCH', username: 'x' }]
      }
    }
  };
}

function recorder() {
  const events = [];
  const bus = new util.Emitter();
  bus.on('changed', function (x) { events.push(x); });
  return { bus: bus, events: events };
}

describe('ids', () => {
  test('isUlid / validId', () => {
    assert.equal(stv.isUlid(CHANNEL_SET), true);
    assert.equal(stv.isUlid(CHANNEL_SET.toLowerCase()), false);
    assert.equal(stv.isUlid('01FE9DRF000009TR6M9N941CYI'), false); // I is not Crockford
    assert.equal(stv.isUlid(CHANNEL_SET.slice(1)), false);
    assert.equal(stv.isUlid(undefined), false);
    assert.equal(stv.isUlid(null), false);
    assert.equal(stv.isUlid(NIL), true);
    assert.equal(stv.validId(NIL), false);
    assert.equal(stv.validId(CHANNEL_SET), true);
  });
});

describe('normalizers', () => {
  test('v3 ActiveEmote: alias, https urls from WEBP Nx files, 1x size', () => {
    const e = stv.normalizeActiveEmoteV3(v3Emote('E1', 'myAlias', 0, 0, 'OriginalName'));
    assert.equal(e.provider, '7tv');
    assert.equal(e.id, 'E1');
    assert.equal(e.name, 'myAlias');
    assert.equal(e.zw, false);
    assert.equal(e.w, 32);
    assert.equal(e.h, 32);
    assert.deepEqual(e.urls, {
      1: 'https://cdn.7tv.app/emote/E1/1x.webp',
      2: 'https://cdn.7tv.app/emote/E1/2x.webp',
      3: 'https://cdn.7tv.app/emote/E1/3x.webp',
      4: 'https://cdn.7tv.app/emote/E1/4x.webp'
    });
  });

  test('v3 zero-width from active flags 1 or data.flags 256', () => {
    assert.equal(stv.normalizeActiveEmoteV3(v3Emote('E1', 'a', 1, 0)).zw, true);
    assert.equal(stv.normalizeActiveEmoteV3(v3Emote('E1', 'a', 0, 256)).zw, true);
    assert.equal(stv.normalizeActiveEmoteV3(v3Emote('E1', 'a', 1 << 16, 1 << 1)).zw, false);
  });

  test('v3 never uses static_name (GIF-only host yields nothing)', () => {
    const ae = v3Emote('E1', 'a', 0, 0);
    ae.data.host.files = ae.data.host.files.filter(function (f) { return f.format === 'GIF'; });
    assert.equal(stv.normalizeActiveEmoteV3(ae), null);
    const full = stv.normalizeActiveEmoteV3(v3Emote('E1', 'a', 0, 0));
    Object.keys(full.urls).forEach(function (k) {
      assert.doesNotMatch(full.urls[k], /_static|\.gif|\.avif/);
    });
  });

  test('v3 returns null without data or host', () => {
    assert.equal(stv.normalizeActiveEmoteV3({ id: 'E1', name: 'a', flags: 0, data: null }), null);
    assert.equal(stv.normalizeActiveEmoteV3({ id: 'E1', name: 'a', flags: 0, data: { id: 'E1' } }), null);
    assert.equal(stv.normalizeActiveEmoteV3(null), null);
  });

  test('v4 item: alias, animated webp preferred per scale, zero-width flags', () => {
    const base = 'https://cdn.7tv.app/emote/E2/';
    const images = [];
    [1, 2, 3, 4].forEach(function (n) {
      images.push({ url: base + n + 'x_static.webp', mime: 'image/webp', scale: n, width: 32 * n, height: 30 * n, frameCount: 1 });
      images.push({ url: base + n + 'x.gif', mime: 'image/gif', scale: n, width: 32 * n, height: 30 * n, frameCount: 12 });
      images.push({ url: base + n + 'x.avif', mime: 'image/avif', scale: n, width: 32 * n, height: 30 * n, frameCount: 12 });
      images.push({ url: base + n + 'x.webp', mime: 'image/webp', scale: n, width: 32 * n, height: 30 * n, frameCount: 12 });
    });
    images.reverse();
    const item = { alias: 'aliasV4', flags: { zeroWidth: false }, emote: { id: 'E2', flags: { defaultZeroWidth: true }, images: images } };
    const e = stv.normalizeEmoteV4(item);
    assert.equal(e.name, 'aliasV4');
    assert.equal(e.id, 'E2');
    assert.equal(e.zw, true);
    assert.equal(e.w, 32);
    assert.equal(e.h, 30);
    assert.deepEqual(e.urls, { 1: base + '1x.webp', 2: base + '2x.webp', 3: base + '3x.webp', 4: base + '4x.webp' });

    item.emote.flags.defaultZeroWidth = false;
    assert.equal(stv.normalizeEmoteV4(item).zw, false);
    item.flags.zeroWidth = true;
    assert.equal(stv.normalizeEmoteV4(item).zw, true);
  });

  test('v4 static emote keeps the main file over *_static', () => {
    const base = 'https://cdn.7tv.app/emote/E3/';
    const e = stv.normalizeEmoteV4({
      alias: 'st', flags: {}, emote: {
        id: 'E3', flags: {}, images: [
          { url: base + '1x_static.webp', mime: 'image/webp', scale: 1, width: 28, height: 28, frameCount: 1 },
          { url: base + '1x.webp', mime: 'image/webp', scale: 1, width: 28, height: 28, frameCount: 1 },
          { url: base + '2x.png', mime: 'image/png', scale: 2, width: 56, height: 56, frameCount: 1 }
        ]
      }
    });
    assert.deepEqual(e.urls, { 1: base + '1x.webp' });
    assert.equal(e.w, 28);
  });

  test('badges: v3 protocol-relative -> https, v4 animated preferred', () => {
    const b3 = stv.normalizeBadgeV3({
      id: BADGE_A, name: 'sub21', tooltip: '7TV Subscriber (1 Year)',
      host: { url: '//cdn.7tv.app/badge/' + BADGE_A, files: [
        { name: '1x.webp', static_name: '1x_static.webp', format: 'WEBP', width: 18, height: 18 },
        { name: '2x.webp', format: 'WEBP', width: 36, height: 36 },
        { name: '3x.webp', format: 'WEBP', width: 54, height: 54 },
        { name: '4x.webp', format: 'WEBP', width: 72, height: 72 },
        { name: '1x.avif', format: 'AVIF', width: 18, height: 18 }
      ] }
    });
    assert.deepEqual(b3, {
      provider: '7tv', title: '7TV Subscriber (1 Year)',
      urls: { 1: 'https://cdn.7tv.app/badge/' + BADGE_A + '/1x.webp', 2: 'https://cdn.7tv.app/badge/' + BADGE_A + '/2x.webp',
        3: 'https://cdn.7tv.app/badge/' + BADGE_A + '/3x.webp', 4: 'https://cdn.7tv.app/badge/' + BADGE_A + '/4x.webp' }
    });
    const base = 'https://cdn.7tv.app/badge/X/';
    const b4 = stv.normalizeBadgeV4({
      id: 'X', name: 'n', description: 'Desc', images: [
        { url: base + '1x_static.webp', mime: 'image/webp', scale: 1, frameCount: 1 },
        { url: base + '1x.webp', mime: 'image/webp', scale: 1, frameCount: 100 },
        { url: base + '2x.webp', mime: 'image/webp', scale: 2, frameCount: 100 },
        { url: base + '2x.gif', mime: 'image/gif', scale: 2, frameCount: 100 }
      ]
    });
    assert.deepEqual(b4, { provider: '7tv', title: 'Desc', urls: { 1: base + '1x.webp', 2: base + '2x.webp' } });
    assert.equal(stv.normalizeBadgeV4({ id: 'X', name: 'Name only', images: [{ url: base + '1x.webp', mime: 'image/webp', scale: 1, frameCount: 1 }] }).title, 'Name only');
  });
});

describe('state routing', () => {
  function setup(extra) {
    const rec = recorder();
    const opts = Object.assign({ bus: rec.bus }, extra || {});
    const state = stv.createState(opts);
    const channel = new Map();
    const base = stv.normalizeActiveEmoteV3(v3Emote('E0', 'Base', 0, 0));
    channel.set(base.name, base);
    assert.equal(state.registerChannelSet('71092938', CHANNEL_SET, channel, OWNER), true);
    return { state: state, channel: channel, events: rec.events };
  }

  test('registerChannelSet ignores null / non-ULID set ids', () => {
    const state = stv.createState({});
    assert.equal(state.registerChannelSet('1', null, new Map()), false);
    assert.equal(state.registerChannelSet('1', 'abc', new Map()), false);
    assert.equal(state.registerChannelSet('1', NIL, new Map()), false);
  });

  test('emote_set.update for a non-channel, non-personal set does not touch the channel map', () => {
    const s = setup();
    s.state.handleDispatch('emote_set.update', { id: OTHER_SET, kind: 3, pushed: [{ key: 'emotes', index: 0, type: 'object', value: v3Emote('E9', 'Leak', 0, 0) }] });
    s.state.handleDispatch('emote_set.update', { id: null, pushed: [{ key: 'emotes', value: v3Emote('E8', 'Leak2', 0, 0) }] });
    assert.deepEqual(Array.from(s.channel.keys()), ['Base']);
    assert.equal(s.events.length, 0);
  });

  test('channel set update applies pushed and emits {roomId}', () => {
    const s = setup();
    s.state.handleDispatch('emote_set.update', { id: CHANNEL_SET, kind: 3, pushed: [{ key: 'emotes', index: 1, type: 'object', value: v3Emote('E1', 'NewOne', 1, 0) }] });
    assert.equal(s.channel.get('NewOne').zw, true);
    assert.deepEqual(s.events, [{ roomId: '71092938' }]);
  });

  test('pulled with data null removes by id; by name when id is missing', () => {
    const s = setup();
    s.channel.set('Two', stv.normalizeActiveEmoteV3(v3Emote('E2', 'Two', 0, 0)));
    s.state.handleDispatch('emote_set.update', { id: CHANNEL_SET, pulled: [{ key: 'emotes', index: 0, type: 'object', old_value: { id: 'E0', name: 'RenamedMeanwhile', data: null } }] });
    assert.equal(s.channel.has('Base'), false);
    assert.equal(s.channel.has('Two'), true);
    s.state.handleDispatch('emote_set.update', { id: CHANNEL_SET, pulled: [{ key: 'emotes', old_value: { name: 'Two', data: null } }] });
    assert.equal(s.channel.size, 0);
    assert.equal(s.events.length, 2);
  });

  test('updated renames the alias', () => {
    const s = setup();
    s.state.handleDispatch('emote_set.update', { id: CHANNEL_SET, updated: [{ key: 'emotes', index: 0, type: 'object', old_value: v3Emote('E0', 'Base', 0, 0), value: v3Emote('E0', 'Renamed', 0, 0) }] });
    assert.equal(s.channel.has('Base'), false);
    assert.equal(s.channel.get('Renamed').id, 'E0');
    // rename without image data reuses the old entry
    s.state.handleDispatch('emote_set.update', { id: CHANNEL_SET, updated: [{ key: 'emotes', old_value: { id: 'E0', name: 'Renamed' }, value: { id: 'E0', name: 'Again', data: null } }] });
    assert.deepEqual(Array.from(s.channel.keys()), ['Again']);
    assert.equal(s.channel.get('Again').urls[1], 'https://cdn.7tv.app/emote/E0/1x.webp');
  });

  test('personal set: create -> update(pushed) -> EMOTE_SET entitlement yields userEmoteMaps', () => {
    const s = setup();
    s.state.handleDispatch('emote_set.create', { id: PERSONAL_SET, kind: 3, object: { id: PERSONAL_SET, name: 'Personal Emotes', flags: 4, capacity: 5 } });
    assert.equal(s.state.personalSets.has(PERSONAL_SET), true);
    s.state.handleDispatch('emote_set.update', { id: PERSONAL_SET, kind: 3, pushed: [
      { key: 'emotes', index: 0, type: 'object', value: v3Emote('P1', 'nnysBop', 0, 1) },
      { key: 'emotes', index: 1, type: 'object', value: v3Emote('P2', 'nnysZw', 1, 256) }
    ] });
    assert.deepEqual(s.events, [{ setId: PERSONAL_SET }]);
    assert.deepEqual(Array.from(s.channel.keys()), ['Base']); // not leaked into the channel tier
    assert.deepEqual(s.state.userEmoteMaps('827089046'), []);
    s.state.handleDispatch('entitlement.create', entitlement('EMOTE_SET', PERSONAL_SET, '827089046'));
    const maps = s.state.userEmoteMaps(827089046);
    assert.equal(maps.length, 1);
    assert.deepEqual(Array.from(maps[0].keys()), ['nnysBop', 'nnysZw']);
    assert.equal(maps[0].get('nnysZw').zw, true);
    assert.deepEqual(s.state.usersForSet(PERSONAL_SET), ['827089046']);
    assert.deepEqual(s.state.effective('827089046').sets, [PERSONAL_SET]);
    s.state.handleDispatch('entitlement.delete', entitlement('EMOTE_SET', PERSONAL_SET, '827089046'));
    assert.deepEqual(s.state.userEmoteMaps('827089046'), []);
  });

  test('special sets (flags 11) are personal; plain sets (flags 0) are not', () => {
    const s = setup();
    s.state.handleDispatch('emote_set.create', { id: OTHER_SET, object: { id: OTHER_SET, name: 'NNYS 2024', flags: 11 } });
    s.state.handleDispatch('emote_set.create', { id: NEW_SET, object: { id: NEW_SET, name: 'plain', flags: 0 } });
    assert.equal(s.state.personalSets.has(OTHER_SET), true);
    assert.equal(s.state.personalSets.has(NEW_SET), false);
    s.state.handleDispatch('emote_set.update', { id: NEW_SET, pushed: [{ key: 'emotes', value: v3Emote('Z', 'Z', 0, 0) }] });
    assert.equal(s.events.length, 0);
  });

  test('entitlements: create paint A, create paint B, delete A keeps B', () => {
    const s = setup();
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', PAINT_A, '134043593'));
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', PAINT_B, '134043593'));
    s.state.handleDispatch('entitlement.delete', entitlement('PAINT', PAINT_A, '134043593'));
    assert.equal(s.state.effective('134043593').paint, PAINT_B);
    s.state.handleDispatch('entitlement.create', entitlement('BADGE', BADGE_A, '134043593'));
    s.state.handleDispatch('entitlement.delete', entitlement('BADGE', PAINT_A, '134043593')); // wrong ref
    assert.equal(s.state.effective('134043593').badge, BADGE_A);
    s.state.handleDispatch('entitlement.delete', entitlement('BADGE', BADGE_A, '134043593'));
    s.state.handleDispatch('entitlement.delete', entitlement('PAINT', PAINT_B, '134043593'));
    assert.deepEqual(s.state.effective('134043593'), { paint: null, badge: null, sets: [] });
    // create A, create B, badge create, badge delete, paint B delete (non-matching deletes emit nothing)
    assert.deepEqual(s.events, [
      { userId: '134043593' }, { userId: '134043593' }, { userId: '134043593' }, { userId: '134043593' },
      { userId: '134043593' }
    ]);
  });

  test('entitlements: keyed by TWITCH connection (String), nil refs and unknown kinds ignored', () => {
    const s = setup();
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', PAINT_A, 42));
    assert.equal(s.state.userCos.has('42'), true);
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', NIL, '43'));
    s.state.handleDispatch('entitlement.create', entitlement('AVATAR', PAINT_A, '44'));
    const noTwitch = entitlement('PAINT', PAINT_A, '45');
    noTwitch.object.user.connections = [{ id: '45', platform: 'KICK' }];
    s.state.handleDispatch('entitlement.create', noTwitch);
    s.state.handleDispatch('entitlement.delete', entitlement('PAINT', PAINT_A, '46')); // delete without entry
    ['43', '44', '45', '46'].forEach(function (id) { assert.equal(s.state.userCos.has(id), false, id); });
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', PAINT_A, '42')); // duplicate: no emit
    assert.deepEqual(s.events, [{ userId: '42' }]);
  });

  test('effective(): entitlement entry wins over GQL style; sets only from entitlements', () => {
    const s = setup();
    s.state.setGqlStyle('7', { paint: PAINT_A, badge: BADGE_A });
    assert.deepEqual(s.state.effective('7'), { paint: PAINT_A, badge: BADGE_A, sets: [] });
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', PAINT_B, '7'));
    assert.deepEqual(s.state.effective(7), { paint: PAINT_B, badge: null, sets: [] });
    s.state.setGqlStyle('8', null);
    assert.equal(s.state.gqlStyle.has('8'), true);
    assert.deepEqual(s.state.effective('8'), { paint: null, badge: null, sets: [] });
    assert.equal(s.state.hasUser('8'), true);
    assert.equal(s.state.hasUser('9'), false);
  });

  test('cosmetic.create never overwrites catalog entries; adds absent v3 paint/badge', () => {
    const s = setup();
    const catalogPaint = { id: PAINT_A, name: 'v4', bgImage: 'x', bgColor: null, filter: null };
    s.state.mergeCatalog({ paints: new Map([[PAINT_A, catalogPaint]]), badges: new Map() });
    assert.deepEqual(s.events, [{ all: true }]);
    s.state.handleDispatch('cosmetic.create', { id: PAINT_A, kind: 10, object: { id: PAINT_A, kind: 'PAINT', data: {
      id: PAINT_A, name: 'v3', function: 'LINEAR_GRADIENT', angle: 90, repeat: false, stops: [{ at: 0, color: -1 }, { at: 1, color: -1857617921 }], shadows: []
    } } });
    assert.equal(s.state.paints.get(PAINT_A), catalogPaint);
    s.state.handleDispatch('cosmetic.create', { id: PAINT_B, kind: 10, object: { id: PAINT_B, kind: 'PAINT', data: {
      id: PAINT_B, name: 'City Lights', function: 'LINEAR_GRADIENT', angle: 360, repeat: false, color: null,
      stops: [{ at: 0, color: -33449217 }, { at: 1, color: -1 }], shadows: [{ x_offset: 0, y_offset: 0, radius: 4, color: -16729089 }]
    } } });
    assert.match(s.state.paints.get(PAINT_B).bgImage, /^linear-gradient\(360deg, rgba\(254,1,154,1\) 0%/);
    s.state.handleDispatch('cosmetic.create', { id: BADGE_A, kind: 10, object: { id: BADGE_A, kind: 'BADGE', data: {
      id: BADGE_A, name: 'sub', tooltip: 'Sub', host: { url: '//cdn.7tv.app/badge/' + BADGE_A, files: [{ name: '1x.webp', static_name: '1x_static.webp', format: 'WEBP', width: 18, height: 18 }] }
    } } });
    assert.equal(s.state.badges.get(BADGE_A).urls[1], 'https://cdn.7tv.app/badge/' + BADGE_A + '/1x.webp');
    const badgeRef = s.state.badges.get(BADGE_A);
    s.state.mergeCatalog({ paints: new Map(), badges: new Map([[BADGE_A, { provider: '7tv', title: 'other', urls: {} }]]) });
    assert.equal(s.state.badges.get(BADGE_A), badgeRef);
  });

  test('user.update set switch calls onSetSwitch(roomId, newSetId, ownerId) once', () => {
    const calls = [];
    const s = setup({ onSetSwitch: function (roomId, setId, ownerId) { calls.push([roomId, setId, ownerId]); } });
    const body = { id: OWNER, kind: 1, updated: [{ key: 'connections', index: 0, nested: true, value: [
      { key: 'emote_set', type: 'object', old_value: { id: CHANNEL_SET }, value: { id: NEW_SET } },
      { key: 'emote_set_id', type: 'string', old_value: CHANNEL_SET, value: NEW_SET }
    ] }] };
    s.state.handleDispatch('user.update', body);
    s.state.handleDispatch('user.update', body);
    assert.deepEqual(calls, [['71092938', NEW_SET, OWNER]]);
    s.state.handleDispatch('user.update', Object.assign({}, body, { id: '01GJTZ1F90000AXQX83F1Y5590' })); // unknown owner
    s.state.handleDispatch('user.update', { id: OWNER, updated: [{ key: 'connections', value: [{ key: 'emote_set_id', old_value: NEW_SET, value: null }] }] });
    assert.equal(calls.length, 1);
    // after the overlay registers the new set, its updates route to the room and the old set's do not
    const fresh = new Map();
    s.state.registerChannelSet('71092938', NEW_SET, fresh);
    s.state.handleDispatch('emote_set.update', { id: CHANNEL_SET, pushed: [{ key: 'emotes', value: v3Emote('Q', 'Old', 0, 0) }] });
    s.state.handleDispatch('emote_set.update', { id: NEW_SET, pushed: [{ key: 'emotes', value: v3Emote('R', 'New', 0, 0) }] });
    assert.deepEqual(Array.from(fresh.keys()), ['New']);
    assert.equal(s.channel.has('Old'), false);
    assert.equal(s.state.channelSetOf('71092938'), NEW_SET);
  });

  function switchTo(state, setId) {
    state.handleDispatch('user.update', { id: OWNER, updated: [{ key: 'connections', value: [
      { key: 'emote_set_id', old_value: 'whatever', value: setId }
    ] }] });
  }

  test('switching back A->B->A while B is still loading reaches onSetSwitch', () => {
    const calls = [];
    const s = setup({ onSetSwitch: function (roomId, setId) { calls.push(setId); } });
    switchTo(s.state, NEW_SET);         // A -> B (overlay starts loading B)
    switchTo(s.state, CHANNEL_SET);     // back to A before B's load resolves
    switchTo(s.state, CHANNEL_SET);     // duplicate of the pending A: deduped
    assert.deepEqual(calls, [NEW_SET, CHANNEL_SET]);
    // the overlay registers A; a new switch to B is announced again
    s.state.registerChannelSet('71092938', CHANNEL_SET, s.channel, OWNER);
    switchTo(s.state, CHANNEL_SET);
    assert.deepEqual(calls, [NEW_SET, CHANNEL_SET]);
    switchTo(s.state, NEW_SET);
    assert.deepEqual(calls, [NEW_SET, CHANNEL_SET, NEW_SET]);
  });

  test('registerChannelSet clears a stale announced switch for that room owner', () => {
    const calls = [];
    const s = setup({ onSetSwitch: function (roomId, setId) { calls.push(setId); } });
    switchTo(s.state, NEW_SET);  // announced, but (say) its load failed
    // a channel reload registers some other set that was switched to while the socket was down
    s.state.registerChannelSet('71092938', OTHER_SET, new Map(), OWNER);
    assert.equal(s.state.channelSetOf('71092938'), OTHER_SET);
    switchTo(s.state, NEW_SET);  // a later live switch to the previously announced set is not suppressed
    assert.deepEqual(calls, [NEW_SET, NEW_SET]);
    switchTo(s.state, OTHER_SET); // NEW_SET is pending, so going back to the registered set is announced
    assert.deepEqual(calls, [NEW_SET, NEW_SET, OTHER_SET]);
    // forgetting the room also drops its pending state
    s.state.forgetRoom('71092938');
    switchTo(s.state, CHANNEL_SET);
    assert.equal(calls.length, 3);
  });

  test('unknown dispatch types and junk bodies are ignored', () => {
    const s = setup();
    s.state.handleDispatch('system.announcement', { id: 'x' });
    s.state.handleDispatch('emote_set.update', null);
    s.state.handleDispatch('entitlement.create', { object: null });
    assert.equal(s.events.length, 0);
  });
});

// ---------- EventAPI client ----------
function makeFakeWS() {
  const instances = [];
  function FakeWS(url) { this.url = url; this.sent = []; this.closed = false; instances.push(this); }
  FakeWS.prototype.send = function (s) { this.sent.push(s); };
  FakeWS.prototype.close = function () { this.closed = true; };
  FakeWS.instances = instances;
  return FakeWS;
}
function serverSays(ws, obj) { ws.onmessage({ data: JSON.stringify(obj) }); }
function hello(ws, hb) { serverSays(ws, { op: 1, t: 0, d: { heartbeat_interval: hb || 45000, session_id: 's', subscription_limit: 500 } }); }
function sentFrames(ws) { return ws.sent.map(function (s) { return JSON.parse(s); }); }

describe('event client', () => {
  function setup(t) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    t.mock.method(console, 'warn', function () {});
    const FakeWS = makeFakeWS();
    const state = stv.createState({});
    const ev = stv.createEventClient({ state: state, WebSocket: FakeWS });
    return { FakeWS: FakeWS, state: state, ev: ev };
  }

  test('no object_id subscription unless it is a real ULID; channel id is a string with platform TWITCH', (t) => {
    const s = setup(t);
    assert.equal(s.ev.addChannel(71092938), true);
    assert.equal(s.ev.addChannel('forsen'), false);
    assert.equal(s.ev.addObject('emote_set.update', null), false);
    assert.equal(s.ev.addObject('emote_set.update', undefined), false);
    assert.equal(s.ev.addObject('user.update', NIL), false);
    assert.equal(s.ev.addObject('user.update', 'not-a-ulid'), false);
    assert.equal(s.ev.addObject('bogus.thing', CHANNEL_SET), false);
    const subs = s.ev.subsForTest();
    assert.equal(subs.length, 4);
    subs.forEach(function (p) {
      assert.equal(p.op, 35);
      const c = p.d.condition;
      assert.equal('object_id' in c, false);
      assert.deepEqual(c, { ctx: 'channel', platform: 'TWITCH', id: '71092938' });
      assert.equal(typeof c.id, 'string');
    });
    assert.deepEqual(subs.map(function (p) { return p.d.type; }), ['cosmetic.create', 'entitlement.create', 'entitlement.delete', 'emote_set.*']);
    assert.equal(s.ev.addObject('emote_set.update', CHANNEL_SET), true);
    assert.equal(s.ev.addObject('user.update', OWNER), true);
    s.ev.subsForTest().forEach(function (p) {
      const c = p.d.condition;
      if ('object_id' in c) assert.equal(stv.isUlid(c.object_id), true);
      else assert.equal(c.ctx, 'channel');
    });
  });

  test('subs are sent on Hello (not before), new subs go out immediately, and every Hello re-sends all', (t) => {
    const s = setup(t);
    s.ev.addChannel('71092938');
    s.ev.start();
    const ws1 = s.FakeWS.instances[0];
    assert.equal(ws1.url, 'wss://events.7tv.io/v3');
    ws1.onopen();
    assert.equal(ws1.sent.length, 0);
    hello(ws1);
    assert.equal(ws1.sent.length, 4);
    s.ev.addObject('emote_set.update', CHANNEL_SET);
    assert.equal(ws1.sent.length, 5);
    assert.deepEqual(sentFrames(ws1)[4], { op: 35, d: { type: 'emote_set.update', condition: { object_id: CHANNEL_SET } } });
    s.ev.addObject('emote_set.update', CHANNEL_SET); // duplicate: not re-sent
    assert.equal(ws1.sent.length, 5);

    serverSays(ws1, { op: 4, d: {} }); // server asks for a reconnect
    assert.equal(ws1.closed, true);
    assert.equal(ws1.onclose, null);
    t.mock.timers.tick(2000);
    const ws2 = s.FakeWS.instances[1];
    assert.ok(ws2, 'reconnected within 2 s');
    ws2.onopen();
    hello(ws2);
    const f2 = sentFrames(ws2);
    assert.equal(f2.length, 5);
    assert.ok(f2.every(function (f) { return f.op === 35; }), 'only subscribe frames (no identify/resume/unsubscribe)');
    hello(ws2); // a second Hello re-sends again
    assert.equal(ws2.sent.length, 10);
    assert.equal(s.ev.stats().hellos, 3);
    s.ev.stop();
  });

  test('op7 4005 reconnects after 60-80 s; 4012 quickly; 4002 after 5 min', (t) => {
    const s = setup(t);
    s.ev.addChannel('1');
    s.ev.start();
    const ws1 = s.FakeWS.instances[0];
    ws1.onopen();
    hello(ws1);
    serverSays(ws1, { op: 6, d: { message: 'Too Many Active Subscriptions!' } });
    serverSays(ws1, { op: 7, d: { code: 4005, message: 'Rate limit reached' } });
    assert.equal(ws1.closed, true);
    t.mock.timers.tick(59999);
    assert.equal(s.FakeWS.instances.length, 1);
    t.mock.timers.tick(20001);
    assert.equal(s.FakeWS.instances.length, 2);
    assert.deepEqual(s.ev.stats().lastEnd, { code: 4005, message: 'Rate limit reached' });

    const ws2 = s.FakeWS.instances[1];
    ws2.onopen();
    hello(ws2);
    t.mock.timers.tick(60000); // a stable connection (the hourly TTL case): the backoff resets
    serverSays(ws2, { op: 2, d: {} });
    serverSays(ws2, { op: 7, d: { code: 4012, message: 'Reconnect' } });
    t.mock.timers.tick(2000);
    assert.equal(s.FakeWS.instances.length, 3);

    const ws3 = s.FakeWS.instances[2];
    ws3.onopen();
    hello(ws3);
    serverSays(ws3, { op: 7, d: { code: 4002, message: 'Invalid Payload' } });
    t.mock.timers.tick(299999);
    assert.equal(s.FakeWS.instances.length, 3);
    t.mock.timers.tick(1);
    assert.equal(s.FakeWS.instances.length, 4);
    s.ev.stop();
  });

  test('a server that keeps sending op4 reconnect right after Hello is backed off, not hit every second', (t) => {
    const s = setup(t);
    t.mock.method(Math, 'random', () => 0);
    s.ev.start();
    const gaps = [];
    for (let i = 0; i < 6; i++) {
      const ws = s.FakeWS.instances[i];
      ws.onopen();
      hello(ws);
      serverSays(ws, { op: 4, d: {} });
      let waited = 0;
      while (s.FakeWS.instances.length === i + 1 && waited < 600000) { t.mock.timers.tick(100); waited += 100; }
      gaps.push(waited);
    }
    // first request honored at once (jitter 0), then 2 s, 4 s, 8 s, ... (baseDelay 2000, Math.random = 0)
    assert.deepEqual(gaps, [100, 2000, 4000, 8000, 16000, 32000]);
    s.ev.stop();
  });

  test('watchdog reconnects after 3x heartbeat of silence; traffic resets it', (t) => {
    const s = setup(t);
    s.ev.start();
    const ws1 = s.FakeWS.instances[0];
    ws1.onopen();
    hello(ws1, 1000);
    t.mock.timers.tick(2500);
    serverSays(ws1, { op: 2, d: { count: 1 } });
    t.mock.timers.tick(2999);
    assert.equal(ws1.closed, false);
    t.mock.timers.tick(1);
    assert.equal(ws1.closed, true);
    assert.equal(s.ev.stats().state, 'waiting');
    t.mock.timers.tick(2000); // backoff 1-2 s
    assert.equal(s.FakeWS.instances.length, 2);
    s.ev.stop();
  });

  test('dispatches reach state.handleDispatch; a plain close uses backoff', (t) => {
    const s = setup(t);
    s.ev.start();
    const ws1 = s.FakeWS.instances[0];
    ws1.onopen();
    hello(ws1);
    serverSays(ws1, { op: 5, d: { command: 'SUBSCRIBE', data: {} } });
    serverSays(ws1, { op: 0, d: { type: 'entitlement.create', body: entitlement('PAINT', PAINT_A, '555') } });
    assert.equal(s.state.effective('555').paint, PAINT_A);
    assert.equal(s.ev.stats().acks, 1);
    assert.equal(s.ev.stats().dispatches, 1);
    ws1.onmessage({ data: 'not json' });
    ws1.onclose({ code: 1006 });
    t.mock.timers.tick(2000);
    assert.equal(s.FakeWS.instances.length, 2);
    s.ev.stop();
  });
});

// ---------- GQL lookup ----------
describe('lookup', () => {
  const flush = function () { return new Promise(function (r) { setImmediate(r); }); };

  function setup(t, relevant) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const state = stv.createState({});
    const requests = [];
    const results = [];
    const lookup = stv.createLookup({
      state: state,
      isRelevant: relevant || function () { return true; },
      onResult: function (id) { results.push(id); },
      post: function (body) {
        return new Promise(function (resolve, reject) {
          const ids = [];
          body.query.replace(/platformId:"(\d+)"/g, function (_, id) { ids.push(id); });
          requests.push({ ids: ids, query: body.query, resolve: resolve, reject: reject });
        });
      }
    });
    return { state: state, lookup: lookup, requests: requests, results: results };
  }

  function reply(req, fn) {
    const users = {};
    req.ids.forEach(function (id, i) { users['u' + i] = fn(id, i); });
    req.resolve({ data: { users: users } });
  }

  test('batches of <= 50 aliases, one request in flight, >= 1.5 s apart', async (t) => {
    const s = setup(t);
    for (let i = 1; i <= 120; i++) s.lookup.want(String(1000 + i));
    assert.equal(s.lookup.want('1001'), false); // already queued
    assert.equal(s.lookup.want('abc'), false);
    t.mock.timers.tick(299);
    await flush();
    assert.equal(s.requests.length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(s.requests.length, 1);
    assert.equal(s.requests[0].ids.length, 50);
    assert.match(s.requests[0].query, /^query\{users\{u0:userByConnection\(platform:TWITCH, platformId:"1001"\)\{style\{activePaintId activeBadgeId\}\} u1:/);
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(s.requests.length, 1, 'only one in flight');
    reply(s.requests[0], function () { return null; });
    await flush();
    t.mock.timers.tick(1);
    await flush();
    assert.equal(s.requests.length, 2);
    reply(s.requests[1], function () { return null; });
    await flush();
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(s.requests.length, 2, 'min gap from the previous request start');
    t.mock.timers.tick(500);
    await flush();
    assert.equal(s.requests.length, 3);
    assert.equal(s.requests[2].ids.length, 20);
    s.lookup.stop();
  });

  test('errors and errors[] requeue with backoff and cache nothing; null cached only on success', async (t) => {
    const s = setup(t);
    s.lookup.want('11');
    s.lookup.want('12');
    t.mock.timers.tick(300);
    await flush();
    assert.equal(s.requests.length, 1);
    s.requests[0].reject(new Error('network'));
    await flush();
    assert.equal(s.state.gqlStyle.has('11'), false);
    assert.equal(s.lookup.want('11'), false, 'still pending');
    t.mock.timers.tick(1999);
    await flush();
    assert.equal(s.requests.length, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(s.requests.length, 2);
    assert.deepEqual(s.requests[1].ids, ['11', '12']);
    s.requests[1].resolve({ errors: [{ message: 'Query is too complex.' }], data: { users: { u0: null, u1: null } } });
    await flush();
    assert.equal(s.state.gqlStyle.has('11'), false);
    assert.equal(s.state.gqlStyle.has('12'), false);
    t.mock.timers.tick(3999);
    await flush();
    assert.equal(s.requests.length, 2, 'backoff doubled to 4 s');
    t.mock.timers.tick(1);
    await flush();
    assert.equal(s.requests.length, 3);
    reply(s.requests[2], function (id) { return id === '11' ? null : { style: { activePaintId: PAINT_A, activeBadgeId: null } }; });
    await flush();
    assert.equal(s.state.gqlStyle.has('11'), true);
    assert.equal(s.state.gqlStyle.get('11'), null);
    assert.deepEqual(s.state.gqlStyle.get('12'), { paint: PAINT_A, badge: null });
    assert.deepEqual(s.results, ['12']);
    assert.equal(s.lookup.want('12'), false, 'cached');
    s.lookup.stop();
  });

  test('skips users with entitlement data and drops ids no longer relevant', async (t) => {
    const relevant = new Set(['21', '23']);
    const s = setup(t, function (id) { return relevant.has(id); });
    s.state.handleDispatch('entitlement.create', entitlement('PAINT', PAINT_A, '20'));
    assert.equal(s.lookup.want('20'), false);
    s.lookup.want('21');
    s.lookup.want('22');
    s.lookup.want('23');
    s.state.setGqlStyle('23', null); // resolved elsewhere meanwhile
    t.mock.timers.tick(300);
    await flush();
    assert.equal(s.requests.length, 1);
    assert.deepEqual(s.requests[0].ids, ['21']);
    s.lookup.stop();
  });
});

// ---------- catalog ----------
describe('catalog', () => {
  const pc = require('../js/paint-css.js');
  const BADGE_BASE = 'https://cdn.7tv.app/badge/' + BADGE_A + '/';
  function gqlReply(t, data) {
    t.mock.method(globalThis, 'fetch', async function () {
      return { status: 200, ok: true, text: async function () { return JSON.stringify({ data: data }); } };
    });
  }
  const linear = (id) => ({ id: id, name: id, data: { layers: [{ id: 'L', opacity: 1, ty: {
    __typename: 'PaintLayerTypeLinearGradient', angle: 0, repeating: false,
    stops: [null, { at: 0, color: { hex: '#FF0000FF' } }, { at: 1, color: { hex: '#00FF00FF' } }]
  } }], shadows: [] } });

  test('v4: a malformed paint (null stop, throwing normalizer) is skipped, not the whole catalog', async (t) => {
    t.mock.method(console, 'warn', function () {});
    const orig = pc.fromV4;
    t.mock.method(pc, 'fromV4', function (p) {
      if (p && p.id === PAINT_B) throw new TypeError('boom');
      return orig(p);
    });
    gqlReply(t, {
      paints: { paints: [linear(PAINT_A), linear(PAINT_B), null] },
      badges: { badges: [null, { id: BADGE_A, name: 'b', description: 'Badge', images: [
        { url: BADGE_BASE + '1x.webp', mime: 'image/webp', scale: 1, frameCount: 1 }] }] }
    });
    const cat = await stv._sources.catalogV4();
    assert.deepEqual(Array.from(cat.paints.keys()), [PAINT_A]);
    assert.equal(cat.paints.get(PAINT_A).bgImage, 'linear-gradient(0deg, #FF0000FF 0%, #00FF00FF 100%)');
    assert.deepEqual(Array.from(cat.badges.keys()), [BADGE_A]);
  });

  test('v3: a null stop no longer throws; other entries survive a throwing normalizer', async (t) => {
    t.mock.method(console, 'warn', function () {});
    const orig = pc.fromV3;
    t.mock.method(pc, 'fromV3', function (p) {
      if (p && p.id === PAINT_B) throw new TypeError('boom');
      return orig(p);
    });
    gqlReply(t, { cosmetics: {
      paints: [
        { id: PAINT_A, name: 'a', function: 'LINEAR_GRADIENT', angle: 0, stops: [null, { at: 1, color: -1 }], shadows: [] },
        { id: PAINT_B, name: 'b', function: 'LINEAR_GRADIENT', angle: 0, stops: [], shadows: [] }
      ],
      badges: []
    } });
    const cat = await stv._sources.catalogV3();
    assert.deepEqual(Array.from(cat.paints.keys()), [PAINT_A]);
  });
});
