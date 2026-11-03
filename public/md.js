// Safe Markdown → DOM renderer (no innerHTML). Paragraphs, headings, lists, tables, quotes, code,
// bold/italic/code/links and [n] citations linked to sources.
(() => {
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const safeUrl = u => { try { const x = new URL(u, location.href); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
  function inline(text, parent, sources) {
    const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[(\d{1,2})\])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
      if (m[2] || m[3]) { const b = h('strong'); inline(m[2] || m[3], b, sources); parent.append(b); }
      else if (m[4] || m[5]) { const i = h('em'); inline(m[4] || m[5], i, sources); parent.append(i); }
      else if (m[6]) parent.append(h('code', '', m[6]));
      else if (m[7]) { const url = safeUrl(m[8]); if (url) { const a = h('a', '', m[7]); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); } else parent.append(document.createTextNode(m[7])); }
      else if (m[9]) { const n = Number(m[9]), src = (sources || []).find(s => s.n === n); const sup = h(src ? 'a' : 'span', 'cite', String(n)); if (src) { const url = safeUrl(src.url); if (url) { sup.href = url; sup.target = '_blank'; sup.rel = 'noopener noreferrer'; sup.title = src.title; } } parent.append(sup); }
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
  }
  function render(md, { sources = [] } = {}) {
    const root = document.createDocumentFragment(), lines = String(md || '').replace(/\r/g, '').split('\n');
    let i = 0;
    const isTable = (a, b) => /^\s*\|.*\|\s*$/.test(a || '') && /^\s*\|?\s*:?-{2,}/.test(b || '');
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^```/.test(line)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; const pre = h('pre'); pre.append(h('code', '', buf.join('\n'))); root.append(pre); continue; }
      const hd = line.match(/^(#{1,4})\s+(.*)$/); if (hd) { const e = h('h' + Math.min(4, hd[1].length + 1)); inline(hd[2], e, sources); root.append(e); i++; continue; }
      if (isTable(line, lines[i + 1])) {
        const wrap = h('div', 'table-wrap'), t = h('table'), head = h('thead'), tr = h('tr'); for (const c of cells(line)) { const th = h('th'); inline(c, th, sources); tr.append(th); } head.append(tr); t.append(head); i += 2;
        const body = h('tbody'); while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { const r = h('tr'); for (const c of cells(lines[i])) { const td = h('td'); inline(c, td, sources); r.append(td); } body.append(r); i++; }
        t.append(body); wrap.append(t); root.append(wrap); continue;
      }
      if (/^\s*>/.test(line)) { const q = h('blockquote'), buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); const p = h('p'); inline(buf.join(' '), p, sources); q.append(p); root.append(q); continue; }
      const li = l => l.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (li(line)) {
        const ordered = /\d/.test(li(line)[1]), list = h(ordered ? 'ol' : 'ul');
        if (ordered) list.start = Number(li(line)[1].replace(/\D/g, '')) || 1;
        while (i < lines.length && li(lines[i]) && /\d/.test(li(lines[i])[1]) === ordered) { const item = h('li'); inline(li(lines[i])[2], item, sources); list.append(item); i++; }
        root.append(list); continue;
      }
      const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*•]|\d+[.)])\s)/.test(lines[i]) && !isTable(lines[i], lines[i + 1])) buf.push(lines[i++]);
      const p = h('p'); inline(buf.join(' '), p, sources); root.append(p);
    }
    return root;
  }
  window.renderMarkdown = render;
})();
