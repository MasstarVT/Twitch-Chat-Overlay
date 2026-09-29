/* Built-in badge icons (platform logos, Kick role badges), drawn as inline SVG by the renderer: no image
   requests, so they also work from a local file (the overlay's CSP only allows https images). Chat data can
   only pick an icon by key; every shape and color here is a constant. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  (root.TCO = root.TCO || {}).icons = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Platform logos: path data from Simple Icons 16.33.0 (CC0, https://simpleicons.org; see
  // img/logos/NOTICE.md). The marks belong to Twitch and Kick; they only say where a message came from.
  var TWITCH_D = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z';
  // The inside of the Twitch speech bubble, filled white under the outline (as in Twitch's own logo).
  var TWITCH_INSIDE_D = 'M20.571 11.143L17.143 14.571H13.714L10.714 17.571V14.571H6.857V1.714H20.571Z';
  var KICK_D = 'M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z';
  var KICK_GREEN = '#53FC19';
  var INK = '#0B0E0F';
  var WHITE = '#FFFFFF';

  // Kick role badges: simple glyphs on colored tiles (16 x 16), drawn for this overlay.
  var CAMERA_D = 'M2.5 5h7.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM11.8 7.3l2.7-1.6v4.6l-2.7-1.6z';
  var SHIELD_D = 'M8 2.4l4.6 1.7v3.8c0 2.8-1.9 4.9-4.6 5.7-2.7-.8-4.6-2.9-4.6-5.7V4.1z';
  var DIAMOND_D = 'M5.3 3.5h5.4L13 6.6 8 12.8 3 6.6z';
  var CHECK_D = 'M6.6 11.6L3.3 8.3l1.2-1.2 2.1 2.1 4.9-4.9 1.2 1.2z';
  var STAR_D = 'M8 2.4l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z';
  var GIFT_D = 'M2.5 6.4h11v2.4h-11zM3.4 8.8h9.2v4.6H3.4zM8 6.3C7 4 4.6 4 5 5.7c.3.6 1.4.6 3 .6zm0 0C9 4 11.4 4 11 5.7c-.3.6-1.4.6-3 .6z';
  var RIBBON_D = 'M7.3 6.4h1.4v7H7.3z';

  // icon: { vb: viewBox, tile: color of a rounded square filling the viewBox, or null,
  //         shapes: [{ d, fill }], text: { s, fill, size } or null }
  var ICONS = {
    twitch: { vb: '0 0 24 24', tile: null, shapes: [{ d: TWITCH_INSIDE_D, fill: WHITE }, { d: TWITCH_D, fill: '#9146FF' }], text: null },
    kick: { vb: '-4 -4 32 32', tile: INK, shapes: [{ d: KICK_D, fill: KICK_GREEN }], text: null },
    'kick-broadcaster': { vb: '0 0 16 16', tile: '#E9113C', shapes: [{ d: CAMERA_D, fill: WHITE }], text: null },
    'kick-moderator': { vb: '0 0 16 16', tile: '#00A86B', shapes: [{ d: SHIELD_D, fill: WHITE }], text: null },
    'kick-vip': { vb: '0 0 16 16', tile: '#E5418F', shapes: [{ d: DIAMOND_D, fill: WHITE }], text: null },
    'kick-og': { vb: '0 0 16 16', tile: '#1B8FE3', shapes: [], text: { s: 'OG', fill: WHITE, size: 8 } },
    'kick-founder': { vb: '0 0 16 16', tile: '#F2A900', shapes: [], text: { s: 'F', fill: INK, size: 10.5 } },
    'kick-verified': { vb: '0 0 16 16', tile: KICK_GREEN, shapes: [{ d: CHECK_D, fill: INK }], text: null },
    'kick-staff': { vb: '0 0 16 16', tile: INK, shapes: [], text: { s: 'K', fill: KICK_GREEN, size: 11 } },
    'kick-subscriber': { vb: '0 0 16 16', tile: KICK_GREEN, shapes: [{ d: STAR_D, fill: INK }], text: null },
    'kick-sub_gifter': { vb: '0 0 16 16', tile: '#7B61FF', shapes: [{ d: GIFT_D, fill: WHITE }, { d: RIBBON_D, fill: '#7B61FF' }], text: null }
  };

  var hasOwn = Object.prototype.hasOwnProperty;
  function has(key) { return typeof key === 'string' && hasOwn.call(ICONS, key); }
  function get(key) { return has(key) ? ICONS[key] : null; }

  return { has: has, get: get, KEYS: Object.keys(ICONS) };
});
