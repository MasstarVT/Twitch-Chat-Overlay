'use strict';
// flip(cfg, k): cfg with a different valid value for k, whatever its type. Shared by builder.test.js (reload
// signatures) and parity.test.js (round-trips, revert and effect tests). A new SPEC type needs a case here:
// flip throws on a type it doesn't know, so a test that walks every key fails until it has one.
const config = require('../js/config.js');

function flip(cfg, k) {
  const c = Object.assign({}, cfg);
  const s = config.SPEC[k];
  if (s.type === 'bool') c[k] = !c[k];
  else if (s.type === 'int') {
    c[k] = c[k] === s.max ? s.min : c[k] + 1;
    if (s.lowest && c[k] > 0 && c[k] < s.lowest) c[k] = s.lowest; // line_width: 1 is no value, 5 is
  }
  else if (s.type === 'enum') c[k] = s.values.filter((v) => v !== c[k])[0];
  else if (s.type === 'channel') c[k] = c[k] === 'xqc' ? 'forsen' : 'xqc';
  else if (s.type === 'font') c[k] = c[k] === 'Roboto' ? 'Inter' : 'Roboto';
  else if (s.type === 'kick') c[k] = c[k] === 'xqc' ? 'forsen' : 'xqc';
  else if (s.type === 'room') c[k] = c[k] === '668' ? '4598' : '668';
  else if (s.type === 'list') c[k] = (c[k] || []).concat('someone');
  else if (s.type === 'words') c[k] = (c[k] || []).concat('some words');
  else if (s.type === 'color') c[k] = c[k] === 'ff8800' ? '336699' : 'ff8800';
  else throw new Error('flip: no case for type ' + s.type);
  return c;
}

module.exports = { flip };
