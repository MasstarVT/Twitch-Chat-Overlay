'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rooms = require('../js/rooms.js');

function quiet(t) {
  const orig = console.warn;
  console.warn = function () {};
  t.after(function () { console.warn = orig; });
}

test('newContext returns an empty RoomContext', function () {
  const c = rooms.newContext(123, 'Foo');
  assert.strictEqual(c.id, '123');
  assert.strictEqual(c.login, 'foo');
  assert.strictEqual(c.logo, null);
  assert.ok(c.twitchBadges instanceof Map);
  assert.ok(c.stv.emotes instanceof Map);
  assert.strictEqual(c.stv.setId, null);
  assert.strictEqual(c.stv.ownerId, null);
  assert.ok(c.bttv.emotes instanceof Map);
  assert.ok(c.bttv.bots instanceof Set);
  assert.ok(c.ffz.emotes instanceof Map);
  assert.ok(c.ffz.userBadges instanceof Map);
  assert.strictEqual(c.ffz.modUrls, null);
  assert.strictEqual(c.ffz.vipUrls, null);
  assert.strictEqual(c.retry, null);
  assert.deepStrictEqual(c.parts, {});
  assert.notStrictEqual(rooms.newContext(1).parts, rooms.newContext(2).parts, 'each room its own');
  assert.strictEqual(typeof c.lastSeen, 'number');
});

test('setHome / home / get / forEach', async function () {
  let loads = 0;
  const r = rooms.createRooms({ load: function () { loads++; return Promise.resolve(); } });
  assert.strictEqual(r.home(), null);
  assert.strictEqual(r.setHome('', 'x'), null);
  const h = r.setHome('71092938', 'xqc');
  assert.strictEqual(h.id, '71092938');
  assert.strictEqual(h.login, 'xqc');
  assert.strictEqual(r.home(), h);
  assert.strictEqual(r.get('71092938'), h);
  assert.strictEqual(r.get(71092938), h, 'ids are normalized with String()');
  assert.strictEqual(r.get('999'), null);
  assert.strictEqual(r.setHome('71092938'), h, 'same id keeps the same ctx');
  assert.strictEqual(await r.ensure('71092938'), h, 'home resolves without load()');
  assert.strictEqual(loads, 0);
  const other = r.ensure('22484632');
  assert.strictEqual(r.get('22484632').id, '22484632', 'get() returns a loading room synchronously');
  await other;
  const seen = [];
  r.forEach(function (ctx, id) { seen.push(id); });
  assert.deepStrictEqual(seen, ['71092938', '22484632']);
});

test('ensure() dedupes concurrent calls (load called once)', async function () {
  let loads = 0;
  let release;
  const r = rooms.createRooms({
    load: function (ctx) {
      loads++;
      return new Promise(function (res) { release = function () { ctx.logo = 'https://x/a.png'; res(); }; });
    }
  });
  const a = r.ensure('1');
  const b = r.ensure('1');
  const c = r.ensure(1);
  assert.strictEqual(loads, 1);
  assert.strictEqual(r.get('1').logo, null);
  release();
  const res = await Promise.all([a, b, c]);
  assert.strictEqual(res[0], res[1]);
  assert.strictEqual(res[0], res[2]);
  assert.strictEqual(res[0].logo, 'https://x/a.png');
  assert.strictEqual(await r.ensure('1'), res[0]);
  assert.strictEqual(loads, 1);
  assert.strictEqual(await r.ensure(''), null);
  assert.strictEqual(loads, 1);
});

test('failed load is cached for failureTtl, then retried', async function (t) {
  quiet(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  let loads = 0;
  let fail = true;
  const r = rooms.createRooms({
    failureTtl: 300000,
    load: function () { loads++; return fail ? Promise.reject(new Error('down')) : Promise.resolve(); }
  });
  assert.strictEqual(await r.ensure('5'), null);
  assert.strictEqual(loads, 1);
  assert.strictEqual(r.get('5'), null, 'failed rooms are not exposed');
  t.mock.timers.tick(299999);
  assert.strictEqual(await r.ensure('5'), null);
  assert.strictEqual(loads, 1);
  t.mock.timers.tick(1);
  fail = false;
  const ctx = await r.ensure('5');
  assert.strictEqual(loads, 2);
  assert.strictEqual(ctx.id, '5');
  assert.strictEqual(r.get('5'), ctx);
});

test('ensure() called from inside load() gets the same pending promise', async function () {
  let inner = null;
  let loads = 0;
  const r = rooms.createRooms({
    load: function (ctx) { loads++; inner = r.ensure(ctx.id); return Promise.resolve(); }
  });
  const outer = r.ensure('8');
  assert.strictEqual(inner, outer);
  assert.strictEqual((await outer).id, '8');
  assert.strictEqual(loads, 1);
});

test('a synchronously throwing load() counts as a failure', async function (t) {
  quiet(t);
  const r = rooms.createRooms({ load: function () { throw new Error('sync'); } });
  assert.strictEqual(await r.ensure('7'), null);
  assert.strictEqual(r.get('7'), null);
});

test('sweep evicts idle non-home rooms only; touch/ensure keep rooms alive', async function (t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  let loads = 0;
  const r = rooms.createRooms({ idleTtl: 1800000, load: function () { loads++; return Promise.resolve(); } });
  const h = r.setHome('100', 'home');
  await r.ensure('200');
  await r.ensure('300');
  await r.ensure('400');
  t.mock.timers.tick(1000000);
  r.touch('300');
  await r.ensure('400');
  assert.deepStrictEqual(r.sweep(), []);
  t.mock.timers.tick(800001);
  assert.deepStrictEqual(r.sweep(), ['200']);
  assert.strictEqual(r.get('200'), null);
  assert.ok(r.get('300'));
  assert.ok(r.get('400'));
  t.mock.timers.tick(1800001);
  assert.deepStrictEqual(r.sweep().sort(), ['300', '400']);
  assert.strictEqual(r.home(), h, 'home is never evicted');
  assert.strictEqual(r.get('100'), h);
  await r.ensure('200');
  assert.strictEqual(loads, 4, 'an evicted room loads again');
});

test('sweep drops expired failures so they can be retried', async function (t) {
  quiet(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const r = rooms.createRooms({ failureTtl: 300000, load: function () { return Promise.reject(new Error('x')); } });
  await r.ensure('9');
  assert.deepStrictEqual(r.sweep(), []);
  t.mock.timers.tick(300000);
  assert.deepStrictEqual(r.sweep(), ['9']);
});
