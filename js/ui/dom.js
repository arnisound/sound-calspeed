// Tiny DOM helpers.

/** h('div.cls#id', {attrs, on: {click}}, ...children) */
export function h(tag, attrs, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function field(label, input, hint) {
  return h('label.field', h('span.field-label', label), input, hint ? h('small.hint', hint) : null);
}

export function select(options, value, onChange) {
  const s = h('select', { on: { change: () => onChange && onChange(s.value) } },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o.value ?? o.id, o.label ?? o.name];
      return h('option', { value: v, selected: String(v) === String(value) }, l);
    }));
  return s;
}

export function numberInput(value, { min, max, step = 'any', onChange, width } = {}) {
  const i = h('input', { type: 'number', value, min, max, step, inputMode: 'decimal', style: width ? { width } : null });
  i.addEventListener('change', () => {
    const v = parseFloat(i.value.replace(',', '.'));
    if (Number.isFinite(v) && onChange) onChange(v);
  });
  return i;
}

export function toast(msg, kind = 'info', ms = 3500) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div#toasts');
    document.body.appendChild(host);
  }
  const t = h(`div.toast.${kind}`, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function card(title, ...children) {
  return h('section.card', title ? h('h3', title) : null, ...children);
}

export function fmtMs(ms) {
  return `${ms >= 0 ? '' : '−'}${Math.abs(ms).toFixed(2)} ms`;
}

export function download(filename, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function readFile(accept) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept });
    i.addEventListener('change', async () => {
      const f = i.files[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    });
    i.click();
  });
}
