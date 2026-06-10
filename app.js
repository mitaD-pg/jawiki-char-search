'use strict';
const E = window.JawikiEngine;
const NBSP = String.fromCharCode(160);

let DATA = null;            // { fullwidth, index }
const $ = (id) => document.getElementById(id);
const patternEl = $('pattern');

// ---- データ読み込み（gzip を手動展開。ホスト差異に強くする）----
async function loadData() {
  const res = await fetch('data/index.json.gz', { cache: 'force-cache' });
  if (!res.ok) throw new Error('データ取得失敗 (' + res.status + ')');
  const buf = new Uint8Array(await res.arrayBuffer());
  let text;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {       // gzip マジックバイト
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('このブラウザは未対応です（iOS 16.4 以降が必要）');
    }
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder('utf-8').decode(buf);
  }
  return JSON.parse(text);
}

// ---- パターン入力の操作 ----
function getPattern() {
  let out = '';
  for (const node of patternEl.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains('chip')) out += '[' + node.dataset.type + ']';
      else out += node.textContent;            // br 等は文字として
    }
  }
  return out.split(NBSP).join(' ');             // contenteditable の nbsp を半角空白に
}

function makeChip(sym) {
  const span = document.createElement('span');
  span.className = 'chip';
  span.dataset.type = sym;
  span.textContent = sym;
  span.contentEditable = 'false';
  return span;
}

function insertNodeAtCaret(node) {
  patternEl.focus();
  const sel = window.getSelection();
  let range;
  if (sel.rangeCount && patternEl.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(patternEl);
    range.collapse(false);
  }
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function backspacePattern() {
  patternEl.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { range.deleteContents(); return; }
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node === patternEl) {
    if (offset > 0) patternEl.childNodes[offset - 1].remove();
  } else if (node.nodeType === Node.TEXT_NODE) {
    if (offset > 0) node.deleteData(offset - 1, 1);
    else if (node.previousSibling) node.previousSibling.remove();
  }
}

function setDefaultPattern() {
  patternEl.innerHTML = '';
  for (const s of ['漢', 'あ', '漢', 'あ', '@']) {
    patternEl.appendChild(makeChip(s));
  }
}

// ---- 検索 ----
function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function runSearch() {
  if (!DATA) return;
  const pattern = getPattern();
  if (!pattern) { toast('パターンを入力してください'); return; }
  const fw = $('fw').checked;
  const limit = parseInt($('limit').value || '0', 10) || 0;
  const mode = currentMode();

  const t0 = performance.now();
  let hits;
  try {
    hits = (mode === 'regex')
      ? E.searchRegex(DATA, pattern, fw, limit)
      : E.searchMixed(DATA, pattern, fw, limit);
  } catch (err) {
    $('status').textContent = 'エラー: ' + err.message;
    return;
  }
  const ms = Math.round(performance.now() - t0);
  renderResults(hits);
  const capped = limit && hits.length >= limit;
  $('status').textContent =
    (capped ? `上限 ${limit} 件で打ち切り（さらに一致あり）` : `${hits.length} 件`)
    + ` ・ ${ms}ms`;
}

function renderResults(hits) {
  const ul = $('results');
  ul.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const t of hits) {
    const li = document.createElement('li');
    li.textContent = t;
    frag.appendChild(li);
  }
  ul.appendChild(frag);
}

// ---- コピー（タップ）----
function copyText(text) {
  const done = () => toast('コピー: ' + text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) {}
  ta.remove();
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---- イベント結線 ----
function wire() {
  $('palette').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'bsp') backspacePattern();
    else if (btn.id === 'clr') { patternEl.innerHTML = ''; patternEl.focus(); }
    else if (btn.dataset.type) insertNodeAtCaret(makeChip(btn.dataset.type));
  });

  // Enter で検索（改行させない）
  patternEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });
  // リッチペースト防止（プレーンテキスト化）
  patternEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, text.replace(/\r?\n/g, ''));
  });

  $('search').addEventListener('click', runSearch);
  $('clearres').addEventListener('click', () => {
    $('results').innerHTML = '';
    $('status').textContent = '';
  });

  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) copyText(li.textContent);
  });

  const updateCheck = () => {
    const v = $('check').value;
    $('checkout').textContent = v ? E.signature(v, $('fw').checked) : '';
  };
  $('check').addEventListener('input', updateCheck);
  $('fw').addEventListener('change', updateCheck);
}

// ---- 起動 ----
async function init() {
  wire();
  setDefaultPattern();
  try {
    DATA = await loadData();
    const kinds = Object.keys(DATA.index).length.toLocaleString();
    $('loading').classList.add('hidden');
    $('status').textContent = `準備完了（署名 ${kinds} 種）`;
  } catch (err) {
    $('loadmsg').textContent = '読み込みに失敗: ' + err.message;
  }
}

// Service Worker 登録（オフライン対応）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

init();
