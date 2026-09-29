'use strict';
// A minimal DOM, just enough to run js/renderer.js under node:test (no dependencies).
// Layout: getBoundingClientRect() asks doc.layout(el) when a test sets it, else returns zeros (the
// renderer then measures nothing and trims nothing). Only text and structure are modelled.

function Style() {}
Style.prototype.setProperty = function (k, v) { this[k] = String(v); };
Style.prototype.getPropertyValue = function (k) { return this[k] === undefined ? '' : this[k]; };
Style.prototype.removeProperty = function (k) { delete this[k]; };

const ZERO = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };

class Node {
  constructor(doc, type) {
    this.ownerDocument = doc;
    this.nodeType = type;
    this.parentNode = null;
    this.childNodes = [];
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const sib = this.parentNode.childNodes;
    for (let i = sib.indexOf(this) + 1; i < sib.length; i++) if (sib[i].nodeType === 1) return sib[i];
    return null;
  }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  _take(node) {
    // a fragment moves its children; any node leaves its old parent first
    if (node.nodeType === 11) {
      const kids = node.childNodes.slice();
      node.childNodes = [];
      for (const k of kids) k.parentNode = null;
      return kids;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    return [node];
  }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    const list = this._take(node);
    let at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    if (at < 0) throw new Error('insertBefore: ref is not a child');
    for (const n of list) {
      n.parentNode = this;
      this.childNodes.splice(at++, 0, n);
    }
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i < 0) throw new Error('removeChild: not a child');
    this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(node, old) {
    this.insertBefore(node, old);
    return this.removeChild(old);
  }
}

class Text extends Node {
  constructor(doc, s) { super(doc, 3); this.data = s; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class Element extends Node {
  constructor(doc, tag) {
    super(doc, 1);
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.style = new Style();
    this.attributes = {};
    this.listeners = {};
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).indexOf(c) >= 0,
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, on) => {
        const want = on === undefined ? !self.classList.contains(c) : !!on;
        if (want) self.classList.add(c); else self.classList.remove(c);
        return want;
      }
    };
    if (this.tagName === 'STYLE') {
      const rules = [];
      this.sheet = {
        cssRules: rules,
        insertRule(rule, i) {
          if (/INVALID/.test(rule)) throw new Error('bad rule');
          rules.splice(i, 0, rule);
          return i;
        }
      };
    }
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v); // SVG elements get their class this way
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this.listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  // Fires on this element only (enough for the renderer, which listens on the element it cares about).
  dispatch(type, props) {
    const e = Object.assign({ type: type, target: this }, props || {});
    for (const fn of (this.listeners[type] || []).slice()) fn(e);
    return e;
  }
  getBoundingClientRect() {
    this.ownerDocument.reads++;
    const r = this.ownerDocument.layout ? this.ownerDocument.layout(this) : null;
    return r || ZERO;
  }
  get clientWidth() { return this.getBoundingClientRect().width; }
  get clientHeight() { return this.getBoundingClientRect().height; }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  // The first descendant that matches '.class' or a tag name (the two forms the pages use on an element).
  querySelector(sel) {
    const cls = /^\.([\w-]+)$/.exec(sel), tag = /^[a-z][\w-]*$/i.test(sel) ? sel.toUpperCase() : null;
    if (!cls && !tag) throw new Error('querySelector: not modelled: ' + sel);
    let hit = null;
    const walk = (n) => {
      for (const k of n.childNodes) {
        if (hit) return;
        if (k.nodeType !== 1) continue;
        if (cls ? k.classList.contains(cls[1]) : k.tagName === tag) { hit = k; return; }
        walk(k);
      }
    };
    walk(this);
    return hit;
  }
  // All descendants (elements) matching a class, in document order.
  byClass(c) {
    const out = [];
    const walk = (n) => {
      for (const k of n.childNodes) {
        if (k.nodeType !== 1) continue;
        if (k.classList.contains(c)) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
}

class Fragment extends Node {
  constructor(doc) { super(doc, 11); }
}

// opts: { rAF: true to give the window a requestAnimationFrame (frames run on win.frame()), dpr }
function createDocument(opts) {
  opts = opts || {};
  const doc = {
    reads: 0,
    layout: null,
    visibilityState: 'visible',
    listeners: {},
    createElement: (t) => new Element(doc, t),
    createElementNS: (ns, t) => Object.assign(new Element(doc, t), { namespaceURI: ns }),
    createTextNode: (s) => new Text(doc, String(s)),
    createDocumentFragment: () => new Fragment(doc),
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const l = doc.listeners[type] || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    dispatch(type, props) {
      const e = Object.assign({ type: type }, props || {});
      for (const fn of (doc.listeners[type] || []).slice()) fn(e);
    }
  };
  doc.documentElement = new Element(doc, 'html');
  doc.head = new Element(doc, 'head');
  doc.body = new Element(doc, 'body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  const win = {
    devicePixelRatio: opts.dpr || 1,
    listeners: {},
    addEventListener(type, fn) { (win.listeners[type] = win.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const l = win.listeners[type] || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    dispatch(type, props) {
      const e = Object.assign({ type: type }, props || {});
      for (const fn of (win.listeners[type] || []).slice()) fn(e);
    }
  };
  if (opts.rAF) {
    let next = 1;
    const frames = new Map();
    win.requestAnimationFrame = (fn) => { frames.set(next, fn); return next++; };
    win.cancelAnimationFrame = (id) => { frames.delete(id); };
    win.pendingFrames = () => frames.size;
    win.frame = () => {
      const due = Array.from(frames.values());
      frames.clear();
      for (const fn of due) fn();
    };
  }
  doc.defaultView = win;
  return doc;
}

module.exports = { createDocument: createDocument };
