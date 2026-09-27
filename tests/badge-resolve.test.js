'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const br = require('../js/badge-resolve.js');

// Fake but well-formed badge uuids so urls look like the real CDN.
let uuidN = 0;
function uuid() { uuidN++; return ('00000000' + uuidN.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; }
function ver(id, title) {
  const b = 'https://static-cdn.jtvnw.net/badges/v1/' + uuid() + '/';
  return { id: String(id), image_url_1x: b + '1', image_url_2x: b + '2', image_url_4x: b + '3', title: title || String(id), description: '', click_action: null, click_url: null };
}
function set(setId, versions) { return { set_id: setId, versions: versions.map((v) => ver(v, setId + '/' + v)) }; }

// IVR /v2/twitch/badges/global shape (trimmed): global subscriber has only 0-6, no 2000/3000 variants.
const GLOBAL = br.fromHelixLike([
  set('subscriber', [0, 1, 2, 3, 4, 5, 6]),
  set('bits', [1, 100, 1000, 5000, 10000, 25000, 100000]),
  set('moderator', [1]),
  set('vip', [1]),
  set('broadcaster', [1]),
  set('premium', [1]),
  set('founder', [0]),
  set('predictions', ['blue-1', 'pink-2'])
]);
// plaqueboymax (672238954): custom sub badges only at 2072 and 3072, plus arbitrary channel-only sets.
const PLAQUE = br.fromHelixLike([
  set('campaign-672238954-05f4b05d-1111-2222-3333-444444444444-sub', [1]),
  set('plaqueboymax-mixtape', [1]),
  set('subscriber', [2072, 3072])
]);
// xqc-like: full tiers and channel bits.
const XQC = br.fromHelixLike([
  set('subscriber', [0, 2, 3, 6, 9, 12, 2000, 2012, 3000, 3012]),
  set('bits', [100, 1000, 5000, 10000])
]);
// zackrawrr (552120296): IVR returns [] (no custom badges).
const ZACK = br.fromHelixLike([]);

const title = (b) => (b ? b.title : null);

describe('fromHelixLike / fromGqlFlat', () => {
  test('IVR array -> Map<set, Map<version, {set,version,title,urls{1,2,4}}>>', () => {
    const m = br.fromHelixLike([{ set_id: 'moderator', versions: [{ id: '1', title: 'Moderator',
      image_url_1x: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1',
      image_url_2x: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/2',
      image_url_4x: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3' }] }]);
    assert.ok(m instanceof Map);
    const b = m.get('moderator').get('1');
    assert.deepEqual(b, {
      set: 'moderator', version: '1', title: 'Moderator',
      urls: {
        1: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1',
        2: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/2',
        4: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3'
      }
    });
  });

  const CDN1 = 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1';

  test('badge images must be https on static-cdn.jtvnw.net; anything else is dropped', () => {
    const m = br.fromHelixLike([{ set_id: 'sub', versions: [
      { id: '0', image_url_1x: 'http://static-cdn.jtvnw.net/badges/v1/x/1' },
      { id: '1', image_url_1x: 'https://tracker.example/p.gif' },
      { id: '2', image_url_1x: 'javascript:alert(1)' },
      { id: '3', image_url_1x: 'https://static-cdn.jtvnw.net.evil.example/x' },
      { id: '4', image_url_1x: CDN1, image_url_2x: 'https://evil.example/2', image_url_4x: 'data:image/png,x' }
    ] }]);
    assert.deepEqual([...m.get('sub').keys()], ['4']);
    assert.deepEqual(m.get('sub').get('4').urls, { 1: CDN1, 2: CDN1, 4: CDN1 }, 'bad sizes fall back to the good one');
    const g = br.fromGqlFlat([{ setID: 'a', version: '1', imageURL: 'https://evil.example/x/3' },
      { setID: 'b', version: '1', imageURL: 'http://static-cdn.jtvnw.net/badges/v1/x/3' }]);
    assert.equal(g.size, 0);
  });

  test('numeric version ids become string keys; bad entries are skipped', () => {
    const m = br.fromHelixLike([
      { set_id: 'bits', versions: [{ id: 100, image_url_1x: CDN1 }, { id: '5' }, null] },
      null, { versions: [] }, { set_id: 'nov' }
    ]);
    assert.deepEqual([...m.keys()], ['bits']);
    assert.deepEqual([...m.get('bits').keys()], ['100']);
    const b = m.get('bits').get('100');
    assert.equal(b.title, 'bits', 'title falls back to the set id');
    assert.deepEqual(b.urls, { 1: CDN1, 2: CDN1, 4: CDN1 }, 'missing sizes fall back');
    assert.equal(br.fromHelixLike(null).size, 0);
    assert.equal(br.fromHelixLike({}).size, 0);
  });

  test('Twitch GQL flat list (imageURL /3) -> same shape with /1 /2 /3', () => {
    const base = 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0';
    const m = br.fromGqlFlat([
      { setID: 'moderator', version: '1', title: 'Moderator', imageURL: base + '/3' },
      { setID: 'bits', version: 10000, title: 'cheer 10000', imageURL: base + '/1' },
      { setID: 'broken', version: '1' }, null, { version: '1', imageURL: base + '/3' }
    ]);
    assert.deepEqual(m.get('moderator').get('1'), { set: 'moderator', version: '1', title: 'Moderator', urls: { 1: base + '/1', 2: base + '/2', 4: base + '/3' } });
    assert.equal(m.get('bits').get('10000').urls[4], base + '/3');
    assert.deepEqual([...m.keys()], ['moderator', 'bits']);
    assert.equal(br.fromGqlFlat(undefined).size, 0);
  });

  test('get()', () => {
    assert.equal(title(br.get(GLOBAL, 'moderator', 1)), 'moderator/1');
    assert.equal(br.get(GLOBAL, 'moderator', '2'), null);
    assert.equal(br.get(GLOBAL, 'nope', '1'), null);
    assert.equal(br.get(null, 'moderator', '1'), null);
  });
});

describe('resolve: exact hits', () => {
  test('channel exact hit wins over global', () => {
    const b = br.resolve('subscriber', '0', XQC, GLOBAL);
    assert.equal(b, XQC.get('subscriber').get('0'));
    assert.equal(title(br.resolve('subscriber', '12', XQC, GLOBAL)), 'subscriber/12');
    assert.equal(br.resolve('bits', '100', XQC, GLOBAL), XQC.get('bits').get('100'));
  });

  test('global exact hit', () => {
    assert.equal(br.resolve('moderator', '1', XQC, GLOBAL), GLOBAL.get('moderator').get('1'));
    assert.equal(title(br.resolve('predictions', 'blue-1', XQC, GLOBAL)), 'predictions/blue-1');
    assert.equal(title(br.resolve('founder', '0', ZACK, GLOBAL)), 'founder/0');
  });

  test('arbitrary channel-only set names resolve from the channel', () => {
    assert.equal(title(br.resolve('plaqueboymax-mixtape', '1', PLAQUE, GLOBAL)), 'plaqueboymax-mixtape/1');
    assert.equal(title(br.resolve('campaign-672238954-05f4b05d-1111-2222-3333-444444444444-sub', '1', PLAQUE, GLOBAL)),
      'campaign-672238954-05f4b05d-1111-2222-3333-444444444444-sub/1');
    assert.equal(br.resolve('plaqueboymax-mixtape', '2', PLAQUE, GLOBAL), null, 'no fallback for other sets');
  });

  test('unknown set -> null (skip the badge)', () => {
    assert.equal(br.resolve('not-a-badge', '1', XQC, GLOBAL), null);
    assert.equal(br.resolve('moderator', '7', XQC, GLOBAL), null);
  });
});

describe('resolve: subscriber fallbacks', () => {
  test('plaqueboymax (channel has only 2072 & 3072)', () => {
    const globalSub0 = GLOBAL.get('subscriber').get('0');
    // Tier 1, badges subscriber/0 with badge-info subscriber/5: the image comes from global subscriber/0.
    assert.equal(br.resolve('subscriber', '0', PLAQUE, GLOBAL), globalSub0);
    assert.equal(br.resolve('subscriber', '2080', PLAQUE, GLOBAL), PLAQUE.get('subscriber').get('2072'));
    assert.equal(br.resolve('subscriber', '2072', PLAQUE, GLOBAL), PLAQUE.get('subscriber').get('2072'));
    assert.equal(br.resolve('subscriber', '3100', PLAQUE, GLOBAL), PLAQUE.get('subscriber').get('3072'));
    // Nothing <= 3000 in the 3000 block (3072 is above it): global subscriber/0.
    assert.equal(br.resolve('subscriber', '3000', PLAQUE, GLOBAL), globalSub0);
    assert.equal(br.resolve('subscriber', '2000', PLAQUE, GLOBAL), globalSub0);
    assert.equal(br.resolve('subscriber', '12', PLAQUE, GLOBAL), globalSub0);
  });

  test('zackrawrr (no channel set): everything falls back to global', () => {
    const globalSub0 = GLOBAL.get('subscriber').get('0');
    assert.equal(br.resolve('subscriber', '0', ZACK, GLOBAL), globalSub0);
    assert.equal(br.resolve('subscriber', '3', ZACK, GLOBAL), GLOBAL.get('subscriber').get('3'));
    assert.equal(br.resolve('subscriber', '24', ZACK, GLOBAL), globalSub0);
    assert.equal(br.resolve('subscriber', '2000', ZACK, GLOBAL), globalSub0);
    assert.equal(br.resolve('subscriber', '0', null, GLOBAL), globalSub0, 'channel badges not loaded yet');
  });

  test('highest channel version <= N within the same tier block only', () => {
    assert.equal(title(br.resolve('subscriber', '10', XQC, GLOBAL)), 'subscriber/9');
    assert.equal(title(br.resolve('subscriber', '2005', XQC, GLOBAL)), 'subscriber/2000');
    assert.equal(title(br.resolve('subscriber', '2099', XQC, GLOBAL)), 'subscriber/2012');
    assert.equal(title(br.resolve('subscriber', '3050', XQC, GLOBAL)), 'subscriber/3012');
    assert.equal(title(br.resolve('subscriber', 3050, XQC, GLOBAL)), 'subscriber/3012', 'numeric version');
    const tier1Only = br.fromHelixLike([set('subscriber', [0, 3, 3000])]);
    assert.equal(br.resolve('subscriber', '2012', tier1Only, GLOBAL), GLOBAL.get('subscriber').get('0'), 'never crosses into another tier block');
  });

  test('unparseable versions and missing globals', () => {
    assert.equal(br.resolve('subscriber', 'abc', XQC, GLOBAL), null);
    assert.equal(br.resolve('subscriber', '24', ZACK, null), null);
    assert.equal(br.resolve('subscriber', '24', null, null), null);
  });
});

describe('resolve: bits fallbacks', () => {
  test('highest channel tier <= N, then highest global tier <= N', () => {
    assert.equal(br.resolve('bits', '1000', XQC, GLOBAL), XQC.get('bits').get('1000'));
    assert.equal(br.resolve('bits', '7500', XQC, GLOBAL), XQC.get('bits').get('5000'));
    assert.equal(br.resolve('bits', '50', XQC, GLOBAL), GLOBAL.get('bits').get('1'), 'nothing in channel <= 50');
    assert.equal(br.resolve('bits', '30000', PLAQUE, GLOBAL), GLOBAL.get('bits').get('25000'), 'no channel bits set');
    assert.equal(br.resolve('bits', '1', ZACK, GLOBAL), GLOBAL.get('bits').get('1'));
    assert.equal(br.resolve('bits', '0', ZACK, GLOBAL), null);
  });
});
