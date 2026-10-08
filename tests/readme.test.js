'use strict';
// README.md documents every setting and every stable class name, so a new one can't ship undocumented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../js/config.js');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

// The text of a '## title' section, up to the next '## ' heading.
function section(title) {
  const at = README.indexOf('\n## ' + title + '\n');
  assert.ok(at >= 0, 'README has a "## ' + title + '" section');
  const rest = README.slice(at + 4 + title.length);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
}

// The first cell of every table row in a section (header and separator rows left out). A section may hold
// several tables.
function firstCells(text) {
  const out = [];
  text.split('\n').forEach((line, i, lines) => {
    if (!/^\|/.test(line) || /^\|[\s|:-]+\|$/.test(line)) return;
    if (i + 1 < lines.length && /^\|[\s|:-]+\|$/.test(lines[i + 1])) return; // a header row
    out.push(line.split('|')[1]);
  });
  return out;
}
const codeIn = (cell) => Array.from(cell.matchAll(/`([^`]+)`/g), (m) => m[1]);

test('README: the Options table has a row for every setting, and for nothing else', () => {
  const cells = firstCells(section('Options'));
  assert.ok(cells.length > 20, 'the scan finds the rows');
  const seen = {};
  cells.forEach((cell) => {
    const keys = codeIn(cell);
    assert.ok(keys.length > 0, 'a row names its option: ' + cell);
    // One row may cover several keys (emotes_7tv, emotes_bttv, emotes_ffz).
    keys.forEach((k) => {
      assert.ok(!seen[k], k + ' has two rows');
      seen[k] = true;
    });
  });
  assert.deepStrictEqual(Object.keys(seen).sort(), config.KEYS.slice().sort());
});

test('README: the Custom CSS table names every class overlay.css lists as stable', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'overlay.css'), 'utf8');
  const m = /Stable class names for OBS "Custom CSS":([\s\S]*?)\*\//.exec(css);
  assert.ok(m, 'overlay.css lists its stable class names');
  const stable = Array.from(m[1].matchAll(/[.#][\w-]+/g), (x) => x[0]);
  assert.ok(stable.length > 25, 'the scan finds the names');
  // Every class and id in the table's selectors: `.line.notice` names .line and .notice.
  const named = new Set();
  firstCells(section('Custom CSS')).forEach((cell) => codeIn(cell).forEach((sel) => {
    for (const x of sel.matchAll(/[.#][\w-]+/g)) named.add(x[0]);
  }));
  stable.forEach((c) => assert.ok(named.has(c), 'README Custom CSS has no row for ' + c));
  // and what the table names is in the overlay's stylesheet or drawn by the renderer
  const drawn = css + fs.readFileSync(path.join(ROOT, 'js', 'renderer.js'), 'utf8');
  named.forEach((c) => assert.ok(new RegExp('[\\s.\'"#]' + c.slice(1).replace(/-/g, '\\-') + '\\b').test(drawn), c + ' is real'));
});

// A builder quick look puts every PRESET_KEYS setting at its value or its default, so the note's "Each sets ..."
// names each: one it left out (the name's own line, the name-color bar) would be reset with the README silent on it.
test('README: the Builder quick looks note names every setting a look sets', () => {
  const builder = require('../js/builder.js');
  const note = /\*\*Builder quick looks:\*\*[^\n]*/.exec(README);
  assert.ok(note, 'README has the Builder quick looks note');
  const sets = /Each sets ([^;]+);/.exec(note[0]);
  assert.ok(sets, 'the note says what each look sets');
  const phrase = {
    size: 'text size', text_px: 'text size', text_weight: 'weight', name_weight: 'name weight',
    text_color: 'color and line spacing', line_height: 'line spacing', shadow: 'shadow', shadow_color: 'shadow',
    outline: 'outline', outline_color: 'outline', bg: 'box', bg_color: 'box', bg_shape: 'box', bg_width: 'box',
    spacing: 'space between messages', accent_bar: 'name-color bar', name_line: 'whether the name has a line of its own',
    emote_scale: 'emote', badge_size: 'badge size'
  };
  assert.deepStrictEqual(Object.keys(phrase).sort(), builder.PRESET_KEYS.slice().sort(), 'a phrase for each look setting');
  Object.keys(phrase).forEach((k) => assert.ok(sets[1].indexOf(phrase[k]) >= 0, 'the note names ' + k + ' ("' + phrase[k] + '")'));
});
