// ide/docs.js — Markdown docs loader
//
// Fetches langIntro.md and langDetail.md from the project root,
// renders them as HTML, and injects them into #lang-docs.
// Runs automatically on import (IIFE at bottom of file).

// ── Markdown renderer ─────────────────────────────────────────────────────────

function mdToHtml(md) {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let html = '';
  let inCode = false, codeBuf = '';
  let inTable = false, tableBuf = [];
  let inBlockquote = false;
  let inList = false, listBuf = [];

  function flushList() {
    if (!inList) return;
    html += '<ul>' + listBuf.join('') + '</ul>\n';
    listBuf = [];
    inList = false;
  }
  function flushBlockquote() {
    if (inBlockquote) { html += '</blockquote>\n'; inBlockquote = false; }
  }
  function flushTable() {
    if (!inTable) return;
    let t = '<table>';
    for (let r = 0; r < tableBuf.length; r++) {
      const tag = r === 0 ? 'th' : 'td';
      const cells = tableBuf[r].split('|').filter(c => c.trim() !== '');
      t += '<tr>' + cells.map(c => `<${tag}>${inlineFormat(c.trim())}</${tag}>`).join('') + '</tr>';
    }
    t += '</table>\n';
    html += t;
    tableBuf = [];
    inTable = false;
  }

  function inlineFormat(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }

  const lines = escaped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) { html += codeBuf + '</code></pre>\n'; codeBuf = ''; }
      else { flushList(); flushBlockquote(); flushTable(); html += '<pre><code>'; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeBuf += line + '\n'; continue; }

    // table row
    if (line.includes('|') && line.trim().startsWith('|')) {
      // skip separator rows (|---|---| etc.)
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      flushList(); flushBlockquote();
      inTable = true;
      tableBuf.push(line);
      continue;
    } else { flushTable(); }

    // empty line
    if (line.trim() === '') { flushList(); flushBlockquote(); continue; }

    // heading
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) {
      flushList(); flushBlockquote();
      const lvl = hm[1].length;
      html += `<h${lvl}>${inlineFormat(hm[2])}</h${lvl}>\n`;
      continue;
    }

    // hr
    if (/^---+$/.test(line.trim())) { flushList(); flushBlockquote(); html += '<hr>\n'; continue; }

    // blockquote
    if (line.startsWith('&gt;')) {
      flushList();
      if (!inBlockquote) { html += '<blockquote>'; inBlockquote = true; }
      html += inlineFormat(line.replace(/^&gt;\s?/, '')) + '<br>';
      continue;
    } else { flushBlockquote(); }

    // list
    if (/^- /.test(line)) {
      if (!inList) inList = true;
      listBuf.push('<li>' + inlineFormat(line.replace(/^- /, '')) + '</li>');
      continue;
    } else { flushList(); }

    // paragraph
    html += '<p>' + inlineFormat(line) + '</p>\n';
  }
  flushList(); flushBlockquote(); flushTable();
  if (inCode) html += codeBuf + '</code></pre>\n';
  return html;
}

// ── Loader ────────────────────────────────────────────────────────────────────

(async function loadLangDocs() {
  const container = document.getElementById('lang-docs');
  if (!container) return;
  try {
    const [introResp, detailResp] = await Promise.all([
      fetch('../langIntro.md'),
      fetch('../langDetail.md'),
    ]);
    const introMd  = await introResp.text();
    const detailMd = await detailResp.text();
    container.innerHTML =
      '<div class="doc-part">' + mdToHtml(introMd) + '</div>' +
      '<hr>' +
      '<div class="doc-part">' + mdToHtml(detailMd) + '</div>';
  } catch (e) {
    container.textContent = 'Failed to load docs: ' + e.message;
  }
})();
