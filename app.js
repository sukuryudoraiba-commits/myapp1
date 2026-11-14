'use strict';

/* ============================================================
 * カードクローゼット — カードコレクション管理 (プロトタイプ)
 * データはすべて端末内の IndexedDB に保存されます。
 * ============================================================ */

const RARITIES = ['N', 'R', 'PR', 'CP', 'SR', 'その他'];
const CATEGORIES = ['トップス', 'ボトムス', 'ワンピース', 'シューズ', 'アクセサリー', 'その他'];
const CAT_ICON = { 'トップス': '👚', 'ボトムス': '👖', 'ワンピース': '👗', 'シューズ': '👠', 'アクセサリー': '💍', 'その他': '✨' };
const RAR_COLOR = {
  N: ['#e9e4ee', '#d7cde2'], R: ['#cfe6ff', '#a9cdfa'], PR: ['#ffd1e6', '#ffa6cc'],
  CP: ['#ffe9b8', '#ffc96b'], SR: ['#e7d2ff', '#c69cff'],
};
const NO_SET = '__none';

/* ---------- IndexedDB ---------- */
const DB_NAME = 'card-closet';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('sets')) d.createObjectStore('sets', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const dbAll = (s) => tx(s, 'readonly', (st) => st.getAll());
const dbPut = (s, v) => tx(s, 'readwrite', (st) => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', (st) => st.delete(id));
const dbClear = (s) => tx(s, 'readwrite', (st) => st.clear());

/* ---------- state ---------- */
const state = {
  sets: [],
  cards: [],
  tab: 'home',
  filter: { setId: '', rarity: '', category: '', own: 'all', q: '' },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setById = (id) => state.sets.find((s) => s.id === id);
const cardById = (id) => state.cards.find((c) => c.id === id);
const setName = (id) => setById(id)?.name || '未分類';

function sortCards(list) {
  const order = new Map(state.sets.map((s, i) => [s.id, i]));
  return [...list].sort((a, b) =>
    (order.get(a.setId) ?? 1e9) - (order.get(b.setId) ?? 1e9) ||
    String(a.no).localeCompare(String(b.no), 'ja', { numeric: true }) ||
    a.name.localeCompare(b.name, 'ja'));
}

function setProgress(set) {
  const owned = state.cards.filter((c) => c.setId === set.id && c.qty > 0).length;
  const total = Math.max(set.total || 0, owned);
  return { owned, total, pct: total ? Math.round((owned / total) * 100) : 0 };
}

/* ---------- UI helpers ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

function thumbStyle(card) {
  if (card.photo) return `background-image:url(${card.photo})`;
  const [a, b] = RAR_COLOR[card.rarity] || ['#f3e6ee', '#e6d3df'];
  return `background:linear-gradient(135deg,${a},${b})`;
}
function thumbIcon(card) {
  return card.photo ? '' : CAT_ICON[card.category] || '✨';
}

function openModal(html) {
  const m = $('#modal');
  $('.sheet', m).innerHTML = html;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- views ---------- */
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#fab').hidden = state.tab === 'settings';
  const view = $('#view');
  view.innerHTML = ({ home: viewHome, cards: viewCards, wish: viewWish, dupes: viewDupes, settings: viewSettings })[state.tab]();
}

function viewHome() {
  const kinds = state.cards.filter((c) => c.qty > 0).length;
  const total = state.cards.reduce((n, c) => n + c.qty, 0);
  const extra = state.cards.reduce((n, c) => n + Math.max(0, c.qty - 1), 0);
  const wish = state.cards.filter((c) => c.wish && c.qty === 0).length;

  const sets = state.sets.map((s) => {
    const p = setProgress(s);
    const done = p.total > 0 && p.owned >= p.total;
    return `
      <div class="set ${done ? 'complete' : ''}">
        <button class="name" data-action="open-set" data-id="${s.id}">${esc(s.name)} ›</button>
        <div class="count">${p.owned} / ${p.total || '?'}枚</div>
        <div class="bar"><i style="width:${p.pct}%"></i></div>
        <div class="row">
          <span class="muted">${done ? '<span class="badge">👑 コンプリート！</span>' : p.total ? `あと ${p.total - p.owned} 枚` : '全体の枚数が未設定です'}</span>
          <button class="linkbtn" data-action="edit-set" data-id="${s.id}">編集</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="stats">
      <div class="stat"><b>${kinds}</b><small>所持種類</small></div>
      <div class="stat"><b>${total}</b><small>総枚数</small></div>
      <div class="stat"><b>${extra}</b><small>ダブり</small></div>
      <div class="stat"><b>${wish}</b><small>欲しい</small></div>
    </div>
    <h2>弾ごとのコンプ率 <button class="btn small" data-action="new-set">＋ 弾を追加</button></h2>
    ${sets || `
      <div class="empty"><span class="big">📦</span>
        まずは「弾」を追加しましょう。<br>弾の名前と、その弾のカードの全体枚数を入れるとコンプ率がわかります。
        <p><button class="btn primary" data-action="new-set">＋ 最初の弾を追加</button></p>
      </div>`}
  `;
}

function filteredCards() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  return sortCards(state.cards.filter((c) => {
    if (f.setId === NO_SET ? c.setId : f.setId && c.setId !== f.setId) return false;
    if (f.rarity && c.rarity !== f.rarity) return false;
    if (f.category && c.category !== f.category) return false;
    if (f.own === 'owned' && c.qty === 0) return false;
    if (f.own === 'missing' && c.qty > 0) return false;
    if (q && !`${c.name} ${c.brand} ${c.no} ${c.memo}`.toLowerCase().includes(q)) return false;
    return true;
  }));
}

function option(value, label, selected) {
  return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
}

function cardResults() {
  const list = filteredCards();
  const tiles = list.map((c) => `
    <div class="tile ${c.qty === 0 ? 'unowned' : ''}">
      <button class="thumb" style="${thumbStyle(c)};border:0" data-action="edit-card" data-id="${c.id}" aria-label="${esc(c.name)}を編集">
        ${c.rarity ? `<span class="rar">${esc(c.rarity)}</span>` : ''}
        ${c.wish && c.qty === 0 ? '<span class="wish">💖</span>' : ''}
        ${thumbIcon(c)}
      </button>
      <div class="info">
        <div class="no">${esc(setName(c.setId))}${c.no ? ` · No.${esc(c.no)}` : ''}</div>
        <div class="nm">${esc(c.name)}</div>
      </div>
      <div class="qty">
        <button data-action="dec" data-id="${c.id}" aria-label="1枚減らす">−</button>
        <b>×${c.qty}</b>
        <button data-action="inc" data-id="${c.id}" aria-label="1枚増やす">＋</button>
      </div>
    </div>`).join('');
  return `
    <p class="muted">${list.length} 種類を表示中</p>
    ${list.length ? `<div class="grid">${tiles}</div>` : `
      <div class="empty"><span class="big">🃏</span>
        ${state.cards.length ? '条件に合うカードがありません。' : 'まだカードがありません。<br>右下の「＋」から登録しましょう。'}
      </div>`}`;
}

function viewCards() {
  const f = state.filter;
  const rarities = [...new Set([...RARITIES, ...state.cards.map((c) => c.rarity).filter(Boolean)])];
  return `
    <div class="filters">
      <input type="search" data-filter="q" placeholder="🔍 名前・ブランド・No.で検索" value="${esc(f.q)}">
      <select data-filter="setId">
        ${option('', '全ての弾', f.setId)}
        ${state.sets.map((s) => option(s.id, s.name, f.setId)).join('')}
        ${option(NO_SET, '未分類', f.setId)}
      </select>
      <select data-filter="own">
        ${option('all', '所持：すべて', f.own)}
        ${option('owned', '持っている', f.own)}
        ${option('missing', '持っていない', f.own)}
      </select>
      <select data-filter="rarity">
        ${option('', '全レアリティ', f.rarity)}
        ${rarities.map((r) => option(r, r, f.rarity)).join('')}
      </select>
      <select data-filter="category">
        ${option('', '全部位', f.category)}
        ${CATEGORIES.map((r) => option(r, r, f.category)).join('')}
      </select>
    </div>
    <div id="results">${cardResults()}</div>
  `;
}

function listItem(c, right) {
  return `
    <div class="item">
      <div class="mini" style="${thumbStyle(c)}">${thumbIcon(c)}</div>
      <button style="border:0;background:none;text-align:left;padding:0" data-action="edit-card" data-id="${c.id}">
        <div class="t">${esc(c.name)}</div>
        <div class="s">${esc(setName(c.setId))}${c.no ? ` · No.${esc(c.no)}` : ''}${c.rarity ? ` · ${esc(c.rarity)}` : ''}${c.brand ? ` · ${esc(c.brand)}` : ''}</div>
      </button>
      ${right}
    </div>`;
}

function viewWish() {
  const list = sortCards(state.cards.filter((c) => c.wish && c.qty === 0));
  return `
    <h2>欲しいものリスト <span class="muted">${list.length} 種類</span></h2>
    ${list.length ? `<div class="list">${list.map((c) =>
      listItem(c, `<button class="btn small primary" data-action="got" data-id="${c.id}">ゲット！</button>`)).join('')}</div>
      <p><button class="btn block" data-action="copy-wish">📋 リストをテキストでコピー</button></p>` : `
      <div class="empty"><span class="big">💖</span>
        欲しいカードはまだありません。<br>カード登録時に「欲しい」にチェックするとここに出ます。
      </div>`}
  `;
}

function viewDupes() {
  const list = sortCards(state.cards.filter((c) => c.qty >= 2));
  const extra = list.reduce((n, c) => n + c.qty - 1, 0);
  return `
    <h2>ダブっているカード <span class="muted">余り ${extra} 枚</span></h2>
    ${list.length ? `<div class="list">${list.map((c) =>
      listItem(c, `<span class="badge">余り ×${c.qty - 1}</span>`)).join('')}</div>
      <p><button class="btn block" data-action="copy-dupes">📋 交換用リストをテキストでコピー</button></p>` : `
      <div class="empty"><span class="big">🔁</span>ダブっているカードはありません。</div>`}
  `;
}

function viewSettings() {
  return `
    <h2>データの管理</h2>
    <div class="stack">
      <button class="btn block" data-action="export">⬇️ バックアップを保存（JSON）</button>
      <label class="btn block" style="text-align:center">⬆️ バックアップから復元
        <input type="file" accept="application/json,.json" data-action="import" hidden>
      </label>
      <button class="btn block danger" data-action="wipe">🗑 すべてのデータを削除</button>
    </div>
    <h2>このアプリについて</h2>
    <div class="notice">
      カードクローゼットは、手持ちのカードを記録・整理するための個人用アプリです。<br>
      データはこの端末の中だけに保存され、外部には送信されません。機種変更の前にはバックアップを保存してください。<br><br>
      本アプリは非公式のファンメイドツールであり、カードゲームの権利者とは関係ありません。
      カードの画像はご自身で撮影したものを、個人の記録の範囲でご利用ください。
    </div>
  `;
}

/* ---------- forms ---------- */
function setForm(set) {
  const s = set || { id: '', name: '', total: '' };
  openModal(`
    <h3>${set ? '弾を編集' : '弾を追加'}</h3>
    <form class="form" data-form="set" data-id="${s.id}">
      <label>弾の名前<input name="name" required maxlength="40" value="${esc(s.name)}" placeholder="例：2026 第1弾"></label>
      <label>この弾のカードの全体枚数<input name="total" type="number" min="0" max="999" inputmode="numeric" value="${esc(s.total)}" placeholder="例：60"></label>
      <div class="actions">
        ${set ? '<button type="button" class="btn danger" data-action="delete-set">削除</button>' : ''}
        <div class="right">
          <button type="button" class="btn" data-action="close">キャンセル</button>
          <button class="btn primary">保存</button>
        </div>
      </div>
    </form>
  `);
  $('#modal input[name=name]').focus();
}

let pendingPhoto; // undefined = 変更なし, null = 削除, string = 新しい画像

function cardForm(card) {
  const defaultSet = state.filter.setId && state.filter.setId !== NO_SET ? state.filter.setId : (state.sets.at(-1)?.id || '');
  const c = card || { id: '', setId: defaultSet, no: '', name: '', rarity: '', brand: '', category: '', qty: 1, wish: false, memo: '', photo: null };
  pendingPhoto = undefined;
  const brands = [...new Set(state.cards.map((x) => x.brand).filter(Boolean))];
  const rarities = [...new Set([...RARITIES, ...state.cards.map((x) => x.rarity).filter(Boolean)])];
  openModal(`
    <h3>${card ? 'カードを編集' : 'カードを登録'}</h3>
    <form class="form" data-form="card" data-id="${c.id}">
      <div class="photo">
        <div class="preview" id="preview" style="${c.photo ? `background-image:url(${c.photo})` : ''}">${c.photo ? '' : '📷'}</div>
        <div class="stack">
          <label class="btn" style="text-align:center;color:var(--text)">写真を選ぶ / 撮る
            <input type="file" accept="image/*" data-action="photo" hidden>
          </label>
          <button type="button" class="linkbtn" data-action="clear-photo">写真を外す</button>
        </div>
      </div>
      <label>カード名<input name="name" required maxlength="60" value="${esc(c.name)}" placeholder="例：ピンクリボンブラウス"></label>
      <div class="two">
        <label>弾
          <select name="setId">
            ${option('', '未分類', c.setId)}
            ${state.sets.map((s) => option(s.id, s.name, c.setId)).join('')}
          </select>
        </label>
        <label>カードNo.<input name="no" maxlength="12" value="${esc(c.no)}" placeholder="例：01"></label>
      </div>
      <div class="two">
        <label>レアリティ<input name="rarity" list="dl-rarity" maxlength="12" value="${esc(c.rarity)}" placeholder="例：PR"></label>
        <label>部位
          <select name="category">
            ${option('', '選択しない', c.category)}
            ${CATEGORIES.map((x) => option(x, x, c.category)).join('')}
          </select>
        </label>
      </div>
      <label>ブランド<input name="brand" list="dl-brand" maxlength="40" value="${esc(c.brand)}" placeholder="例：自由に入力"></label>
      <datalist id="dl-rarity">${rarities.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <datalist id="dl-brand">${brands.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <label>持っている枚数
        <div class="stepper">
          <button type="button" data-action="step" data-d="-1">−</button>
          <input name="qty" type="number" min="0" max="999" inputmode="numeric" value="${c.qty}">
          <button type="button" data-action="step" data-d="1">＋</button>
        </div>
      </label>
      <label class="check"><input type="checkbox" name="wish" ${c.wish ? 'checked' : ''}> 💖 欲しいものリストに入れる（持っていないとき表示）</label>
      <label>メモ<textarea name="memo" rows="2" maxlength="200" placeholder="交換の約束、入手した場所など">${esc(c.memo)}</textarea></label>
      <div class="actions">
        ${card ? '<button type="button" class="btn danger" data-action="delete-card">削除</button>' : ''}
        <div class="right">
          <button type="button" class="btn" data-action="close">キャンセル</button>
          <button class="btn primary">保存</button>
        </div>
      </div>
    </form>
  `);
}

function resizeImage(file, max = 520) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

/* ---------- actions ---------- */
async function saveCard(card) {
  card.updatedAt = Date.now();
  await dbPut('cards', card);
  const i = state.cards.findIndex((c) => c.id === card.id);
  if (i >= 0) state.cards[i] = card; else state.cards.push(card);
}

async function changeQty(id, d) {
  const c = cardById(id);
  if (!c) return;
  const qty = Math.max(0, c.qty + d);
  if (qty === c.qty) return;
  await saveCard({ ...c, qty });
  if (state.tab === 'cards') $('#results').innerHTML = cardResults(); else render();
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    openModal(`<h3>コピーできませんでした</h3>
      <p class="muted">下のテキストを長押ししてコピーしてください。</p>
      <textarea style="width:100%;height:200px">${esc(text)}</textarea>
      <div class="actions"><div class="right"><button class="btn" data-action="close">閉じる</button></div></div>`);
  }
}

function cardLine(c) {
  return `・${setName(c.setId)}${c.no ? ` No.${c.no}` : ''} ${c.name}${c.rarity ? `（${c.rarity}）` : ''}`;
}

async function onClick(e) {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (e.target.id === 'modal') return closeModal();

  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action, id } = el.dataset;

  switch (action) {
    case 'close': closeModal(); break;
    case 'new-set': setForm(); break;
    case 'edit-set': setForm(setById(id)); break;
    case 'open-set':
      state.filter = { ...state.filter, setId: id, own: 'all' };
      state.tab = 'cards';
      render();
      break;
    case 'new-card': cardForm(); break;
    case 'edit-card': cardForm(cardById(id)); break;
    case 'inc': await changeQty(id, 1); break;
    case 'dec': await changeQty(id, -1); break;
    case 'got': {
      const c = cardById(id);
      await saveCard({ ...c, qty: Math.max(1, c.qty), wish: false });
      toast(`🎉 ${c.name} をゲット！`);
      render();
      break;
    }
    case 'step': {
      const input = $('#modal input[name=qty]');
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) + Number(el.dataset.d));
      break;
    }
    case 'clear-photo':
      pendingPhoto = null;
      $('#preview').style.backgroundImage = '';
      $('#preview').textContent = '📷';
      break;
    case 'delete-card': {
      const form = $('#modal form');
      const c = cardById(form.dataset.id);
      if (!confirm(`「${c.name}」を削除しますか？`)) return;
      await dbDel('cards', c.id);
      state.cards = state.cards.filter((x) => x.id !== c.id);
      closeModal(); toast('削除しました'); render();
      break;
    }
    case 'delete-set': {
      const form = $('#modal form');
      const s = setById(form.dataset.id);
      const n = state.cards.filter((c) => c.setId === s.id).length;
      if (!confirm(`弾「${s.name}」を削除しますか？\n${n ? `この弾のカード ${n} 種類は「未分類」に移ります。` : ''}`)) return;
      for (const c of state.cards.filter((x) => x.setId === s.id)) await saveCard({ ...c, setId: '' });
      await dbDel('sets', s.id);
      state.sets = state.sets.filter((x) => x.id !== s.id);
      if (state.filter.setId === s.id) state.filter.setId = '';
      closeModal(); toast('削除しました'); render();
      break;
    }
    case 'copy-wish': {
      const list = sortCards(state.cards.filter((c) => c.wish && c.qty === 0));
      await copyText(`【欲しいカード】\n${list.map(cardLine).join('\n')}`, 'コピーしました');
      break;
    }
    case 'copy-dupes': {
      const list = sortCards(state.cards.filter((c) => c.qty >= 2));
      await copyText(`【交換に出せるカード】\n${list.map((c) => `${cardLine(c)} ×${c.qty - 1}`).join('\n')}`, 'コピーしました');
      break;
    }
    case 'export': {
      const data = JSON.stringify({ app: 'card-closet', version: 1, exportedAt: new Date().toISOString(), sets: state.sets, cards: state.cards });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = `card-closet-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'wipe':
      if (!confirm('すべての弾とカードを削除します。元に戻せません。よろしいですか？')) return;
      await dbClear('sets'); await dbClear('cards');
      state.sets = []; state.cards = [];
      toast('すべて削除しました'); render();
      break;
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.dataset.filter && t.tagName === 'SELECT') {
    state.filter[t.dataset.filter] = t.value;
    render();
    return;
  }
  if (t.dataset.action === 'photo' && t.files[0]) {
    try {
      pendingPhoto = await resizeImage(t.files[0]);
      $('#preview').style.backgroundImage = `url(${pendingPhoto})`;
      $('#preview').textContent = '';
    } catch (err) { toast(err.message); }
    return;
  }
  if (t.dataset.action === 'import' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (data.app !== 'card-closet' || !Array.isArray(data.sets) || !Array.isArray(data.cards)) throw new Error();
      if (!confirm(`弾 ${data.sets.length} 件・カード ${data.cards.length} 種類を復元します。\n今のデータは置き換えられます。よろしいですか？`)) return;
      await dbClear('sets'); await dbClear('cards');
      for (const s of data.sets) await dbPut('sets', s);
      for (const c of data.cards) await dbPut('cards', c);
      await load();
      toast('復元しました'); render();
    } catch { toast('バックアップファイルを読み込めませんでした'); }
    t.value = '';
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.filter === 'q') {
    state.filter.q = t.value;
    $('#results').innerHTML = cardResults();
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  if (form.dataset.form === 'set') {
    const old = setById(form.dataset.id);
    const s = { ...(old || { id: uid(), createdAt: Date.now() }), name: fd.get('name').trim(), total: parseInt(fd.get('total'), 10) || 0 };
    if (!s.name) return;
    await dbPut('sets', s);
    if (old) Object.assign(old, s); else state.sets.push(s);
    closeModal(); toast(old ? '保存しました' : '弾を追加しました'); render();
  } else if (form.dataset.form === 'card') {
    const old = cardById(form.dataset.id);
    const c = {
      ...(old || { id: uid(), createdAt: Date.now(), photo: null }),
      name: fd.get('name').trim(),
      setId: fd.get('setId'),
      no: fd.get('no').trim(),
      rarity: fd.get('rarity').trim(),
      brand: fd.get('brand').trim(),
      category: fd.get('category'),
      qty: Math.max(0, parseInt(fd.get('qty'), 10) || 0),
      wish: fd.get('wish') === 'on',
      memo: fd.get('memo').trim(),
    };
    if (!c.name) return;
    if (pendingPhoto !== undefined) c.photo = pendingPhoto;
    await saveCard(c);
    closeModal(); toast(old ? '保存しました' : `「${c.name}」を登録しました`); render();
  }
}

async function load() {
  state.sets = (await dbAll('sets')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.cards = await dbAll('cards');
}

async function init() {
  db = await openDB();
  await load();
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init().catch((err) => {
  $('#view').innerHTML = `<div class="empty"><span class="big">⚠️</span>データを開けませんでした。<br>${esc(err.message)}</div>`;
});
