'use strict';
const E = window.JawikiEngine;

let DATA = null;                 // { fullwidth, index }
const $ = (id) => document.getElementById(id);
const patternEl = $('pattern');
const litInput = $('litinput');
const patternWrap = $('patternWrap');

// ---- パターンモデル（カーソルは自前管理）----
// tokens: [{kind:'type', val:'漢'} | {kind:'lit', val:'君'}]
// caret : 0..tokens.length（この位置の直前に挿入する）
let tokens = [];
let caret = 0;
let composing = false;          // IME 変換中フラグ

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

// ---- 描画 ----
function render() {
  patternEl.innerHTML = '';
  patternEl.classList.toggle('empty', tokens.length === 0);
  for (let i = 0; i <= tokens.length; i++) {
    if (i === caret) patternEl.appendChild(makeCaret());
    if (i < tokens.length) patternEl.appendChild(makeToken(tokens[i], i));
  }
}

function makeCaret() {
  const c = document.createElement('span');
  c.className = 'caret';
  return c;
}

function makeToken(tok, i) {
  const span = document.createElement('span');
  span.dataset.i = i;
  if (tok.kind === 'type') {
    span.className = 'chip';
    span.textContent = tok.val;
  } else {
    span.className = 'lit';
    span.textContent = tok.val;
  }
  return span;
}

// ---- 編集操作 ----
function insertType(sym) {
  tokens.splice(caret, 0, { kind: 'type', val: sym });
  caret++;
  render();
}

function insertLiterals(str) {
  for (const ch of str) {              // コードポイント単位
    tokens.splice(caret, 0, { kind: 'lit', val: ch });
    caret++;
  }
  render();
}

function backspace() {
  if (caret > 0) {
    tokens.splice(caret - 1, 1);
    caret--;
    render();
  }
}

function clearPattern() {
  tokens = [];
  caret = 0;
  render();
}

function moveCaret(delta) {
  const n = Math.max(0, Math.min(tokens.length, caret + delta));
  if (n !== caret) { caret = n; render(); }
}

// パターン文字列へ変換（型は [漢]、リテラルはそのまま）
function getPattern() {
  let out = '';
  for (const t of tokens) out += (t.kind === 'type') ? '[' + t.val + ']' : t.val;
  return out;
}

// ---- フォーカス（キーボード表示）----
function focusInput() {
  patternWrap.classList.add('focused');
  // iOS はユーザー操作中でないと focus が効かないため、呼び出しは gesture 内で
  litInput.focus({ preventScroll: true });
}

// タップ位置からカーソル位置を決める
function caretFromPoint(clientX, target) {
  const chip = target.closest('.chip, .lit');
  if (chip && chip.dataset.i !== undefined) {
    const i = parseInt(chip.dataset.i, 10);
    const r = chip.getBoundingClientRect();
    caret = (clientX > r.left + r.width / 2) ? i + 1 : i;   // 右半分なら後ろへ
  } else {
    caret = tokens.length;                                  // 余白タップ→末尾
  }
  render();
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
  // パレット（ボタン押下でフォーカスを奪わせない）
  $('palette').addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  $('palette').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'bsp') backspace();
    else if (btn.id === 'clr') clearPattern();
    else if (btn.dataset.type) insertType(btn.dataset.type);
    focusInput();
  });

  // パターン欄タップ → カーソル移動＋キーボード表示
  patternEl.addEventListener('mousedown', (e) => {
    e.preventDefault();               // 既定の選択を抑止
    caretFromPoint(e.clientX, e.target);
    focusInput();
  });

  // リテラル文字入力（隠し input 経由。IME 対応）
  litInput.addEventListener('compositionstart', () => { composing = true; });
  litInput.addEventListener('compositionend', () => {
    composing = false;
    flushLiteral();
  });
  litInput.addEventListener('input', () => {
    if (!composing) flushLiteral();
  });
  litInput.addEventListener('keydown', (e) => {
    if (composing) return;
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    else if (e.key === 'Backspace' && litInput.value === '') { e.preventDefault(); backspace(); }
    else if (e.key === 'ArrowLeft' && litInput.value === '') { e.preventDefault(); moveCaret(-1); }
    else if (e.key === 'ArrowRight' && litInput.value === '') { e.preventDefault(); moveCaret(1); }
  });
  litInput.addEventListener('focus', () => patternWrap.classList.add('focused'));
  litInput.addEventListener('blur', () => patternWrap.classList.remove('focused'));

  // 検索・結果
  $('search').addEventListener('click', runSearch);
  $('clearres').addEventListener('click', () => {
    $('results').innerHTML = '';
    $('status').textContent = '';
  });
  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) copyText(li.textContent);
  });

  // 並び確認
  const updateCheck = () => {
    const v = $('check').value;
    $('checkout').textContent = v ? E.signature(v, $('fw').checked) : '';
  };
  $('check').addEventListener('input', updateCheck);
  $('fw').addEventListener('change', updateCheck);
}

// 隠し input に入った文字をリテラルとして取り込む
function flushLiteral() {
  const v = litInput.value;
  if (!v) return;
  litInput.value = '';
  insertLiterals(v.replace(/\r?\n/g, ''));
}

// ---- 起動 ----
async function init() {
  wire();
  render();                          // 最初は空欄
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
