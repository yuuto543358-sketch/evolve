// AIの画面：キーの設定・コーチに相談・週のふりかえり・今日のメニュー・食事の見積もり
import * as db from './db.js';
import * as store from './store.js';
import { S } from './store.js';
import { icon } from './icons.js';
import { openSheet, toast, choice, val, num, stepper, confirmDialog } from './ui.js';
import * as ai from './ai.js';
import { notify, app } from './app.js';
import { today, esc, fmtDateLong, fmtNum } from './util.js';
import * as cost from './aicost.js';
import { loadImage } from './photos.js';
import { TOOLS, RECORD_RULES, runTool, undoRecord, toApiMessages, sanitizeHistory, trimHistory, recSummary } from './aitools.js';
import { mealEditor, editWorkout, editCardio } from './records.js';

/** 選べるAIの種類：おすすめ3つ＋このキーで使えるもの */
function modelOptions() {
  const avail = S.meta.aiModels || [];
  const base = ai.AI_MODELS.filter((m) => !avail.length || avail.includes(m.id)).map((m) => ({ value: m.id, label: m.label }));
  const extra = avail.filter((id) => !ai.AI_MODELS.some((m) => m.id === id)).slice(0, 8).map((id) => ({ value: id, label: id }));
  const list = [...base, ...extra];
  if (!list.some((o) => o.value === ai.modelId())) list.unshift({ value: ai.modelId(), label: ai.modelLabel() });
  return list;
}
function modelDesc(id) {
  const m = ai.AI_MODELS.find((x) => x.id === id);
  return m ? m.desc : `${id}（料金はOpenAIの料金表を確認してください）`;
}

/** かんたんな整形（太字と改行だけ） */
export function mdLite(text) {
  return esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

/** キーがなければ設定画面を出す。あれば fn を実行 */
export async function withKey(fn) {
  if (await ai.getKey()) return fn();
  openAISetup({ onReady: fn });
  return null;
}

function showError(e) {
  if (e instanceof ai.AIError) {
    if (e.kind === 'aborted') return;
    const action = (e.kind === 'auth' || e.kind === 'nokey') ? { label: '設定', onClick: () => openAISetup() }
      : (e.kind === 'network' || e.kind === 'other') ? { label: 'しらべる', onClick: () => openAISetup({ diag: true }) } : null;
    const more = e.detail ? `<br><small>${esc(e.status ? `${e.status}：` : '')}${esc(e.detail)}</small>` : '';
    toast(esc(e.message) + more, { icon: 'info', duration: 7000, action });
  } else {
    console.error(e);
    toast('うまくいきませんでした。もう一度お試しください。', { icon: 'info' });
  }
}

/* ---------- キーの設定 ---------- */
export async function openAISetup({ onReady = null, diag = false } = {}) {
  const cur = await ai.getKey();
  openSheet({
    title: 'AIの設定',
    subtitle: 'あなたのOpenAIのAPIキーで、アプリの中のAIが動きます',
    html: `
      <div class="imp-card">
        <div class="imp-card-h"><span class="ic-sq" style="--sq:#7A68C9">${icon('spark', 17)}</span><div><strong>APIキー</strong><small>${cur ? `設定済み（…${esc(cur.slice(-4))}）。変えるときだけ入力してください` : 'OpenAIのサイトでつくったAPIキーを貼り付けます'}</small></div></div>
        <input class="input" type="password" name="key" placeholder="sk-..." autocomplete="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="btn btn-primary btn-block" data-save>${icon('check', 18)}保存して、つながるか確かめる</button>
        ${cur ? `<button type="button" class="btn btn-text-danger" data-remove>${icon('trash', 16)}この端末からキーを消す</button>` : ''}
      </div>
      <div class="imp-card">
        <div class="imp-card-h"><span class="ic-sq" style="--sq:#1F8070">${icon('bolt', 17)}</span><div><strong>使うAIの種類</strong><small>あとからいつでも変えられます</small></div></div>
        ${choice('model', modelOptions(), ai.modelId())}
        <p class="hint" data-model-desc>${modelDesc(ai.modelId())}</p>
      </div>
      <div class="imp-card">
        <div class="imp-card-h"><span class="ic-sq" style="--sq:#3B7FA8">${icon('info', 17)}</span><div><strong>接続のテスト</strong><small>「AIに接続できません」と出るとき、どこで止まっているかを調べます。ごく少量のAIを数回使うので、1〜数円かかることがあります</small></div></div>
        <button type="button" class="btn btn-soft btn-block" data-diag>${icon('check', 18)}接続をしらべる</button>
        <div class="diag" data-diag-out hidden></div>
      </div>
      <div class="guide">
        <h3 class="mini-h">APIキーの作り方（最初に1回だけ）</h3>
        <ol class="steps">
          <li>Safariで <b>platform.openai.com</b> を開き、ログインします（ChatGPTと同じアカウントで入れます）</li>
          <li>設定の <b>「Billing（請求）」</b> でクレジットカードを登録し、使う分のお金（クレジット）を先に入れます。まずは <b>5ドル</b> で十分です</li>
          <li><b>「API keys」</b> → <b>「Create new secret key」</b> を押して、名前を「EVOLVE」などにして作ります</li>
          <li>出てきた <b>sk- で始まる長い文字</b> をコピーして、上の欄に貼り付けます（この文字は1回しか表示されません）</li>
        </ol>
        <h3 class="mini-h">知っておいてほしいこと</h3>
        <ul class="steps">
          <li>料金は<b>使った分だけ</b>かかります。ChatGPTの月額プラン（Plusなど）とは別の料金です</li>
          <li>OpenAIの「Billing」で自動チャージ（Auto recharge）をオフにしておくと、入れたクレジットがなくなったら止まるので安心です</li>
          <li>APIキーは<b>このiPhoneの中にだけ</b>保存します。バックアップファイルには入りません。ほかの人には教えないでください</li>
          <li>AIを使うときは、相談の内容と、あなたの記録のまとめ（体重・運動・食事など）がOpenAIのAIに送られます</li>
          <li>コーチとの会話で話した食事や運動は、AIが自動で記録します。記録は会話の中の「修正」「取り消す」で、いつでも直せます</li>
          <li>利用料金は、ホームの「AIの利用料金」で目安を確かめられます</li>
          <li>AIの答えは参考です。体調に不安があるときは、無理をせず専門家に相談してください</li>
        </ul>
      </div>`,
    onMount(body, close) {
      const runDiag = async () => {
        const btn = body.querySelector('[data-diag]');
        const out = body.querySelector('[data-diag-out]');
        out.hidden = false; out.innerHTML = '';
        btn.disabled = true; btn.textContent = 'しらべています…';
        const draw = (rows, running) => {
          out.innerHTML = rows.map((r) => `<div class="diag-row ${r.ok ? (r.warn ? 'warn' : 'ok') : 'ng'}"><span class="diag-mark">${r.ok ? (r.warn ? '！' : '✓') : '✕'}</span><div><strong>${esc(r.label)}</strong><span>${esc(r.note)}</span>${r.detail ? `<small>${esc(r.status ? `${r.status}：` : '')}${esc(r.detail)}</small>` : ''}</div></div>`).join('')
            + (running ? '<div class="diag-row run"><span class="diag-mark spin"></span><div><strong>しらべています…</strong></div></div>' : '');
        };
        let rows = [];
        try { rows = await ai.diagnose((r, all) => draw(all, true)); } catch (err) { console.error(err); rows = [{ id: 'x', label: 'テスト', ok: false, note: 'テストの途中で問題が起きました。', detail: String(err && err.message) }]; }
        draw(rows, false);
        const bad = rows.filter((r) => !r.ok).length; const warn = rows.filter((r) => r.ok && r.warn).length;
        out.insertAdjacentHTML('beforeend', `<p class="diag-sum ${bad ? 'ng' : 'ok'}">${bad ? `うまくいかなかった項目が${bad}つあります。` : warn ? '使えますが、注意の項目があります。' : 'すべて問題ありません。'}</p><button type="button" class="btn btn-ghost btn-block" data-diag-copy>結果をコピー</button>`);
        out.dataset.text = ai.diagText(rows);
        btn.disabled = false; btn.innerHTML = `${icon('check', 18)}もう一度しらべる`;
      };
      body.addEventListener('change', async (e) => {
        if (e.target.name === 'model') {
          await store.setSettings({ aiModel: e.target.value });
          body.querySelector('[data-model-desc]').textContent = modelDesc(e.target.value);
        }
      });
      body.addEventListener('click', async (e) => {
        if (e.target.closest('[data-diag]')) { runDiag(); return; }
        if (e.target.closest('[data-diag-copy]')) {
          const text = body.querySelector('[data-diag-out]').dataset.text || '';
          try { await navigator.clipboard.writeText(text); toast('結果をコピーしました。貼り付けて見せてください', { icon: 'check' }); } catch {
            const ta = document.createElement('textarea'); ta.className = 'input'; ta.rows = 8; ta.value = text; ta.readOnly = true;
            body.querySelector('[data-diag-out]').appendChild(ta); ta.focus(); ta.select();
            toast('下の文字を長押しして、コピーしてください', { icon: 'info' });
          }
          return;
        }
        if (e.target.closest('[data-remove]')) {
          await ai.setKey('');
          close();
          toast('APIキーを消しました');
          app.refresh();
          return;
        }
        const btn = e.target.closest('[data-save]');
        if (!btn) return;
        const k = ai.cleanKey(val(body, 'key'));
        if (!k && !cur) { toast('APIキーを貼り付けてください', { icon: 'info' }); return; }
        if (k && /^sk-ant-/.test(k)) { toast('これはAnthropicのキーのようです。OpenAIのキー（sk- で始まるもの）を入れてください', { icon: 'info', duration: 5000 }); return; }
        if (k && !/^sk-/.test(k)) { toast('APIキーは「sk-」で始まります。コピーした文字を確かめてください', { icon: 'info', duration: 4500 }); return; }
        if (k && !ai.keyLooksValid(k)) { toast('キーに、使えない文字がまじっているようです。コピーし直して貼り付けてください', { icon: 'info', duration: 5000 }); return; }
        const prev = cur;
        if (k) await ai.setKey(k);
        btn.disabled = true; btn.innerHTML = '確かめています…';
        try {
          const ids = await ai.testKey();
          // 選んでいる種類がこのキーで使えないときは、使えるものに切りかえる
          if (ids.length && !ids.includes(ai.modelId())) {
            const pick = ai.AI_MODELS.map((m) => m.id).find((id) => ids.includes(id)) || ids[0];
            await store.setSettings({ aiModel: pick });
          }
          close();
          toast('AIにつながりました', { icon: 'spark' });
          app.refresh();
          if (onReady) setTimeout(onReady, 300);
        } catch (err) {
          if (k && err instanceof ai.AIError && err.kind === 'auth') await ai.setKey(prev || '');
          btn.disabled = false; btn.innerHTML = `${icon('check', 18)}保存して、つながるか確かめる`;
          showError(err);
        }
      });
      if (diag) setTimeout(runDiag, 450);
    },
  });
}

/* ---------- AIコーチに相談（会話の中で、そのまま記録もできる） ---------- */
const SUGGEST = [
  { text: '今日食べたものを話して、記録する', send: '今日食べたものを、聞き取って記録してください。', accent: true },
  { text: '今日の運動を話して、記録する', send: '今日やった運動を、聞き取って記録してください。', accent: true },
  { text: '今日は何をすればいい？' },
  { text: '最近の記録を見て、アドバイスして' },
];

const HELLO = `<div class="chat-hello">${icon('spark', 22)}
  <p><b>「昼にラーメンを食べた」「スクワットを30回3セットやった」</b>と話しかけると、そのまま記録します。足りないことは、こちらから聞きます。</p>
  <p class="sub">運動・食事・体重の相談もできます。キーボードのマイクボタンを使うと、声でも話せます。</p></div>`;

const KIND_ICON = { meals: 'meal', workouts: 'dumbbell', cardio: 'run' };
const KIND_COLOR = { meals: '#C99B47', workouts: '#1F8070', cardio: '#3B7FA8' };

/** 会話の中の「記録しました」カード。いまの記録の中身を見て作るので、あとで直した内容もそのまま映る */
function cardHTML(m) {
  const ui = m.ui;
  if (!ui) return '';
  if (ui.type === 'note') return `<div class="act-note ${esc(ui.tone || '')}">${icon('info', 13)}<span>${esc(ui.text)}</span></div>`;
  const rec = (S[ui.kind] || []).find((r) => r.id === ui.id);
  if (!rec) return `<div class="act-card gone"><span class="ic-sq" style="--sq:#B5BCBA">${icon('trash', 15)}</span><span class="act-text"><small class="k">この記録は削除されました</small><span>${esc(ui.summary || '')}</span></span></div>`;
  const sm = recSummary(ui.kind, rec);
  return `<div class="act-card" data-call="${esc(m.tool_call_id)}">
    <span class="ic-sq" style="--sq:${KIND_COLOR[ui.kind]}">${icon(KIND_ICON[ui.kind], 16)}</span>
    <span class="act-text"><small class="k">${esc(sm.label)}を${ui.op === 'update' ? '修正' : '記録'}しました</small><strong>${esc(sm.main)}</strong><span>${esc(sm.sub)}</span></span>
    <span class="act-btns"><button type="button" class="act-btn" data-act-edit>修正</button>${ui.op === 'create' ? '<button type="button" class="act-btn danger" data-act-undo>取り消す</button>' : ''}</span>
  </div>`;
}

function renderMsg(m) {
  if (m.role === 'user') return `<div class="chat-msg user"><div class="chat-bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
  if (m.role === 'assistant') return m.content ? `<div class="chat-msg assistant"><div class="chat-bubble">${mdLite(m.content)}</div></div>` : '';
  if (m.role === 'tool') return cardHTML(m);
  return '';
}

function openRecordEditor(kind, rec) {
  if (kind === 'meals') mealEditor({ rec });
  else if (kind === 'workouts') editWorkout(rec);
  else editCardio(rec);
}

export function openCoach({ first = null } = {}) {
  return withKey(async () => {
    let history = sanitizeHistory((await db.kvGet('aiChat')) || []);
    let busy = false; let ctrl = null;
    let notice = null; // 会話の最後に出す、エラーなどのお知らせ（履歴には保存しない）
    let unsub = () => {}; let detach = () => {};
    openSheet({
      title: 'AIコーチ',
      subtitle: '記録も、話しかけるだけでOK',
      cls: 'sheet-chat',
      onClose() { if (ctrl) ctrl.abort(); unsub(); detach(); },
      html: `
        <div class="chat-scroll" data-scroll>
          <div class="chat-list" data-list></div>
          <div class="chat-suggest" data-suggest>${SUGGEST.map((x) => `<button type="button" class="suggest-chip ${x.accent ? 'accent' : ''}" data-s="${esc(x.send || x.text)}"><span>${esc(x.text)}</span></button>`).join('')}</div>
        </div>
        <div class="chat-input">
          <textarea class="input" name="msg" rows="1" placeholder="例：昼にラーメンを食べた" enterkeyhint="send"></textarea>
          <button type="button" class="chat-send" data-send aria-label="送信">${icon('right', 20)}</button>
        </div>
        <div class="chat-foot"><button type="button" class="link" data-clear>${icon('trash', 13)}会話を消す</button><span>答えは参考です（記録のまとめをAIに送ります）</span></div>`,
      onMount(body) {
        const scroller = body.querySelector('[data-scroll]');
        const list = body.querySelector('[data-list]');
        const input = body.querySelector('[name=msg]');
        const suggest = body.querySelector('[data-suggest]');
        // 下のほうを見ているときだけ、新しい文章に合わせて自動で下までスクロールする
        let stick = true;
        scroller.addEventListener('scroll', () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90; }, { passive: true });
        const follow = (force = false) => { if (force) stick = true; if (stick) scroller.scrollTop = scroller.scrollHeight; };
        const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; };
        const noticeHTML = () => {
          if (!notice) return '';
          return `<div class="chat-notice ${notice.tone || 'warn'}"><span class="cn-text">${esc(notice.text)}</span>${notice.detail ? `<small>${esc(notice.detail)}</small>` : ''}<span class="cn-btns">${notice.retry ? '<button type="button" class="act-btn" data-retry>もう一度送る</button>' : ''}${notice.setup ? '<button type="button" class="act-btn" data-notice-setup>AIの設定</button>' : ''}${notice.diag ? '<button type="button" class="act-btn" data-notice-diag>接続をしらべる</button>' : ''}</span></div>`;
        };
        const draw = () => {
          const empty = history.length === 0;
          scroller.classList.toggle('is-empty', empty);
          list.innerHTML = (empty ? HELLO : history.map(renderMsg).join('')) + noticeHTML();
          suggest.hidden = !empty;
          follow();
        };

        const send = async (raw) => {
          const text = (raw || '').trim();
          if (!text || busy) return;
          busy = true; notice = null;
          input.value = ''; resize();
          history.push({ role: 'user', content: text });
          const before = history.length;
          draw(); follow(true);
          ctrl = new AbortController();
          let holder = null;
          let made = 0; let fixed = 0;
          try {
            await ai.runChat({
              system: `${ai.COACH_SYSTEM}\n\n${RECORD_RULES}\n\n<ユーザーの記録>\n${ai.buildContext()}\n${ai.weekSummary()}\n</ユーザーの記録>`,
              messages: history, tools: TOOLS, toApi: toApiMessages, execute: runTool, signal: ctrl.signal, tag: 'coach',
              onRound: () => {
                holder = document.createElement('div');
                holder.className = 'chat-msg assistant';
                holder.innerHTML = '<div class="chat-bubble typing"><i></i><i></i><i></i></div>';
                list.appendChild(holder); follow();
              },
              onText: (full) => {
                if (!holder) return;
                const b = holder.firstChild;
                b.classList.remove('typing');
                b.innerHTML = mdLite(full);
                follow();
              },
              onMessage: (m) => {
                if (m.role === 'assistant') {
                  if (!m.content && holder) holder.remove(); // 文章なしで道具だけ呼んだときは、入力中の表示を消す
                  holder = null;
                } else if (m.role === 'tool') {
                  if (m.ui && m.ui.type === 'rec') { if (m.ui.op === 'update') fixed++; else made++; }
                  const html = cardHTML(m);
                  if (html) { list.insertAdjacentHTML('beforeend', html); follow(); }
                }
              },
            });
          } catch (err) {
            if (holder) holder.remove();
            // 何も記録されていないときは、入力した文章をもどす（記録されたものがあるときは会話に残す）
            const nothing = history.length === before;
            if (nothing) { history.pop(); input.value = text; resize(); }
            if (err instanceof ai.AIError) {
              if (err.kind !== 'aborted') {
                notice = {
                  tone: 'warn', text: err.message,
                  detail: err.detail ? `${err.status ? `${err.status}：` : ''}${err.detail}` : (err.status ? `エラー番号 ${err.status}` : ''),
                  retry: nothing ? text : null, setup: err.kind === 'auth' || err.kind === 'nokey', diag: err.kind === 'network' || err.kind === 'other',
                };
              }
            } else {
              console.error(err);
              notice = { tone: 'warn', text: 'うまくいきませんでした。もう一度お試しください。', retry: nothing ? text : null };
            }
          } finally {
            busy = false; ctrl = null;
            if (!notice && ai.toolsOff()) notice = { tone: 'muted', text: 'このAIの種類では、会話からの自動記録が使えませんでした。記録は、画面下の＋ボタンからお願いします（AIの設定で、別の種類にすると使えることがあります）。', setup: true };
            history = trimHistory(history);
            try { await db.kvSet('aiChat', history); } catch { /* 保存できなくても続ける */ }
            if (list.isConnected) draw();
            if (made + fixed) await notify({ message: made ? `AIが${made}件を記録しました` : '記録を直しました', silentXP: !made });
          }
        };

        body.addEventListener('click', async (e) => {
          const sg = e.target.closest('[data-s]');
          if (sg) { send(sg.dataset.s); return; }
          if (e.target.closest('[data-retry]')) { const t = notice && notice.retry; if (t) send(t); return; }
          if (e.target.closest('[data-notice-setup]')) { openAISetup(); return; }
          if (e.target.closest('[data-notice-diag]')) { openAISetup({ diag: true }); return; }
          if (e.target.closest('[data-send]')) { send(input.value); return; }
          if (e.target.closest('[data-clear]')) {
            if (busy) return;
            history = []; await db.kvSet('aiChat', []); draw();
            return;
          }
          const card = e.target.closest('.act-card[data-call]');
          if (!card) return;
          const m = history.find((x) => x.role === 'tool' && x.tool_call_id === card.dataset.call);
          const ui = m && m.ui;
          if (!ui || ui.type !== 'rec') return;
          if (e.target.closest('[data-act-edit]')) {
            const rec = (S[ui.kind] || []).find((r) => r.id === ui.id);
            if (rec) openRecordEditor(ui.kind, rec);
          } else if (e.target.closest('[data-act-undo]')) {
            await undoRecord(ui);
            await notify({ message: '取り消しました', silentXP: true });
          }
        });
        input.addEventListener('input', resize);
        // Enter（送信キー）で送る。日本語の変換を確定するEnterでは送らない
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input.value); }
        });
        // 記録を直したり消したりしたとき、会話の中のカードも新しくする
        unsub = store.onChange(() => { if (!busy && list.isConnected) draw(); });
        // キーボードが出たり消えたりして画面の高さが変わったら、下までスクロールし直す
        const vv = window.visualViewport;
        const onVV = () => follow();
        if (vv) vv.addEventListener('resize', onVV);
        detach = () => { if (vv) vv.removeEventListener('resize', onVV); };
        draw();
        if (first) send(first);
      },
    });
  });
}

/* ---------- 週のふりかえり ---------- */
export function openWeeklyReview() {
  return withKey(() => {
    const saved = S.meta.aiReview;
    let ctrl = null;
    openSheet({
      title: '今週のふりかえり',
      subtitle: 'この7日間の記録を、AIコーチがまとめます',
      onClose() { if (ctrl) ctrl.abort(); },
      html: `
        <div class="review" data-review>${saved ? `<p class="review-date">${fmtDateLong(saved.date)}のふりかえり</p><div class="review-text">${mdLite(saved.text)}</div>` : `<div class="chat-hello">${icon('growth', 22)}<p>この1週間の運動・食事・体重を見て、良かったところと、来週のおすすめを3つ以内でお伝えします。</p></div>`}</div>
        <button type="button" class="btn btn-primary btn-block btn-lg" data-run>${icon('spark', 18)}${saved ? '新しくふりかえる' : 'ふりかえりを作る'}</button>`,
      onMount(body) {
        body.addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-run]');
          if (!btn) return;
          btn.disabled = true; btn.innerHTML = 'AIが記録を読んでいます…';
          const box = body.querySelector('[data-review]');
          box.innerHTML = '<div class="chat-bubble typing"><i></i><i></i><i></i></div>';
          ctrl = new AbortController();
          try {
            const { text } = await ai.streamText({
              system: `${ai.COACH_SYSTEM}\n\n<ユーザーの記録>\n${ai.buildContext({ days: 14 })}\n${ai.weekSummary()}\n</ユーザーの記録>`,
              messages: [{ role: 'user', content: 'この7日間をふりかえってください。次の順番で、全部で300字くらいまでで書いてください。\n1. 今週よかったところ（記録の中の具体的な事実を1〜3個）\n2. からだの変化（体重などの記録があれば、ひとこと）\n3. 来週のおすすめ（すぐできる小さなことを3つ以内）\n最後に、はげましのひとことを1文。' }],
              signal: ctrl.signal,
              onText: (_, full) => { box.innerHTML = `<div class="review-text">${mdLite(full)}</div>`; },
            });
            await store.setMeta({ aiReview: { date: today(), text } });
            box.innerHTML = `<p class="review-date">${fmtDateLong(today())}のふりかえり</p><div class="review-text">${mdLite(text)}</div>`;
            app.refresh();
          } catch (err) {
            box.innerHTML = saved ? `<div class="review-text">${mdLite(saved.text)}</div>` : '';
            showError(err);
          } finally {
            ctrl = null;
            btn.disabled = false; btn.innerHTML = `${icon('spark', 18)}新しくふりかえる`;
          }
        });
      },
    });
  });
}

/* ---------- 今日のメニューをAIが作る ---------- */
export function todayAIMenu() {
  const m = S.meta.aiMenu;
  return m && m.date === today() ? m : null;
}

export function makeAIMenu() {
  return withKey(async () => {
    const names = S.exercises.map((x) => x.name);
    if (!names.length) { toast('先に筋トレの種目を登録してください', { icon: 'info' }); return; }
    toast('AIが今日のメニューを考えています…', { icon: 'spark', duration: 6000 });
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'メニューの短い名前（12文字以内）' },
        note: { type: 'string', description: 'このメニューにした理由と、ひとことアドバイス（80字以内）' },
        items: {
          type: 'array',
          description: '筋トレの種目。休養をすすめる日は空でよい',
          items: {
            type: 'object',
            properties: {
              exercise: { type: 'string', enum: names },
              reps: { type: 'integer', description: '1セットの回数、または秒数' },
              sets: { type: 'integer' },
            },
            required: ['exercise', 'reps', 'sets'], additionalProperties: false,
          },
        },
        cardio_kind: { type: 'string', enum: ['none', 'walk', 'run', 'cycle'] },
        cardio_minutes: { type: 'integer' },
      },
      required: ['title', 'note', 'items', 'cardio_kind', 'cardio_minutes'], additionalProperties: false,
    };
    try {
      const r = await ai.askJSON({
        system: `${ai.COACH_SYSTEM}\n\nあなたは今日1日ぶんのトレーニングメニューを作り、JSONで返します。\n- 「登録している筋トレ種目」の名前だけを使う。\n- 回数とセット数は、その種目の前回の記録を基準に、同じか少しだけ多くする。未実施の種目は軽めから。\n- 今日の予定、直近数日の運動の内容（同じ部位が続いていないか）、疲れ具合を考える。\n- 時間がない日・疲れている日は、1〜2種目や休養でもよい。無理をさせない。\n- 種目は多くても4つまで。\n\n<ユーザーの記録>\n${ai.buildContext({ days: 10 })}\n</ユーザーの記録>`,
        messages: [{ role: 'user', content: '今日のトレーニングメニューを作ってください。' }],
        schema, effort: 'medium', tag: 'menu',
      });
      const items = (r.items || []).map((it) => {
        const ex = S.exercises.find((x) => x.name === it.exercise);
        if (!ex) return null;
        return { exerciseId: ex.id, name: ex.name, unit: ex.unit, reps: Math.max(1, Math.min(ex.unit === 'sec' ? 600 : 200, Math.round(it.reps) || 10)), sets: Math.max(1, Math.min(6, Math.round(it.sets) || 3)) };
      }).filter(Boolean).slice(0, 4);
      const cardio = r.cardio_kind && r.cardio_kind !== 'none' && r.cardio_minutes > 0 ? { kind: r.cardio_kind, minutes: Math.max(5, Math.min(120, Math.round(r.cardio_minutes))) } : null;
      await store.setMeta({ aiMenu: { date: today(), title: String(r.title || 'AIのおすすめメニュー').slice(0, 24), note: String(r.note || '').slice(0, 200), items, cardio } });
      toast('AIが今日のメニューを作りました', { icon: 'spark' });
      app.refresh();
    } catch (err) { showError(err); }
  });
}

export async function clearAIMenu() {
  await store.setMeta({ aiMenu: null });
  app.refresh();
}

/* ---------- 食事を文章や写真で見積もる ---------- */
async function fileToJpegBase64(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '食事の短い名前（20文字以内）。例：牛丼（並）とみそ汁' },
    protein_g: { type: 'number' },
    fat_g: { type: 'number' },
    kcal: { type: 'number' },
    comment: { type: 'string', description: '見積もりの根拠をひとこと（40字以内）。量が分からず仮定したときは、その仮定を書く' },
  },
  required: ['name', 'protein_g', 'fat_g', 'kcal', 'comment'], additionalProperties: false,
};

/**
 * 食事の文章・写真から、タンパク質・脂質・カロリーを見積もる
 * @returns {Promise<{name, protein, fat, kcal, comment}|null>}
 */
export async function estimateMeal({ text = '', file = null }) {
  if (!(await ai.getKey())) { openAISetup(); return null; }
  const content = [];
  if (file) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${await fileToJpegBase64(file)}` } });
  content.push({ type: 'text', text: `${text ? `食べたもの：${text}\n` : ''}${file ? 'この写真の食事について、' : ''}タンパク質(g)・脂質(g)・カロリー(kcal)を見積もってください。` });
  try {
    const r = await ai.askJSON({
      system: 'あなたは日本の食事にくわしい栄養の見積もり係です。答えはJSONで返します。ユーザーが食べたものの説明や写真から、1食ぶんのタンパク質・脂質・カロリーを現実的な数字で見積もります。量が書かれていないときは、日本の一般的な1人前を仮定します。外食チェーンやコンビニの定番商品は、よく知られている栄養成分に近い数字にします。数字は目安なので、細かすぎる端数にはしません。食べたことを評価したり注意したりはしません。',
      messages: [{ role: 'user', content }],
      schema: MEAL_SCHEMA, effort: 'low', tag: 'meal',
    });
    const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    return { name: String(r.name || text || '食事').slice(0, 40), protein: n(r.protein_g, 300), fat: n(r.fat_g, 300), kcal: Math.round(n(r.kcal, 5000) / 10) * 10, comment: String(r.comment || '').slice(0, 80) };
  } catch (err) { showError(err); return null; }
}

export { notify };


/* ---------- AIの利用料金（くわしく） ---------- */
function usageHTML() {
  const sm = cost.summarize();
  const rate = cost.yenRate();
  const yen = (usd) => `約${cost.fmtYen(usd, rate)}円`;
  const cell = (b) => `<b class="num">${yen(b.usd)}</b><small>${cost.fmtUsd(b.usd)}${b.unknown ? '＋料金不明' : ''}</small>`;
  const period = (label, b) => `<div class="u-row"><span class="u-name">${label}<small>${b.n}回 ・ ${cost.fmtTokens(b.i + b.o)}トークン</small></span><span class="u-val">${cell(b)}</span></div>`;
  const model = ai.modelId();
  const pr = cost.priceFor(model) || { in: '', cached: '', out: '' };
  const estNote = sm.total.e ? `<p class="hint">※ ${sm.total.e}回ぶんは、通信が途中で切れて使った量が分からなかったため、文字数から推定して足しています。</p>` : '';
  return `
    <div class="u-hero">
      <span>${Number(today().slice(5, 7))}月の利用料金</span>
      <b class="num">${yen(sm.month.usd)}</b>
      <small>${cost.fmtUsd(sm.month.usd)} ・ ${sm.month.n}回${sm.month.unknown ? ' ・ 料金不明のモデルあり' : ''}</small>
    </div>
    <div class="group u-group">
      ${period('今日', sm.today)}
      ${period('今月', sm.month)}
      ${period('先月', sm.prevMonth)}
      ${period(`累計${sm.since ? `（${fmtDateLong(sm.since).replace(/（.）/, '')}から）` : ''}`, sm.total)}
    </div>
    ${sm.tags.length ? `<p class="u-h">機能ごと（累計）</p><div class="group u-group">${sm.tags.map((t) => `<div class="u-row"><span class="u-name">${esc(cost.TAG_LABEL[t.tag] || t.tag)}<small>${t.n}回</small></span><span class="u-val">${cell(t)}</span></div>`).join('')}</div>` : ''}
    ${sm.models.length ? `<p class="u-h">AIの種類ごと（累計）</p><div class="group u-group">${sm.models.map((m) => `<div class="u-row"><span class="u-name">${esc(m.model)}<small>${m.n}回 ・ 入力${cost.fmtTokens(m.i)} 出力${cost.fmtTokens(m.o)}</small></span><span class="u-val">${m.known ? cell({ usd: m.usd }) : '<b class="num">料金不明</b><small>下で単価を入れてください</small>'}</span></div>`).join('')}</div>` : ''}
    ${estNote}
    <p class="u-h">料金の計算（目安）</p>
    <form class="form u-form" onsubmit="return false">
      <p class="hint top">いま使っているAI「${esc(model)}」の単価（100万トークンあたり・ドル）です。OpenAIの料金表が変わったときや、料金不明と出たときは、ここで直せます。</p>
      <div class="field"><span class="field-label">入力 <em>送った文章</em></span>${stepper('pin', pr.in, { step: 0.05, min: 0, max: 1000, unit: '$', decimals: 2, placeholder: '0' })}</div>
      <div class="field"><span class="field-label">入力（キャッシュ） <em>空欄＝入力と同じ</em></span>${stepper('pcache', pr.cached, { step: 0.01, min: 0, max: 1000, unit: '$', decimals: 2, placeholder: '' })}</div>
      <div class="field"><span class="field-label">出力 <em>AIの答え</em></span>${stepper('pout', pr.out, { step: 0.1, min: 0, max: 1000, unit: '$', decimals: 2, placeholder: '0' })}</div>
      <div class="field"><span class="field-label">1ドルは何円で計算する？</span>${stepper('rate', rate, { step: 1, min: 50, max: 400, unit: '円', decimals: 0 })}</div>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-price-reset>初期値にもどす</button><button type="button" class="btn btn-primary" data-price-save>保存する</button></div>
    </form>
    <p class="fine">料金は「使ったトークン数 × 単価」で計算した目安です。実際の請求額は、OpenAIのサイトの「Usage」「Billing」で確かめてください。このアプリを入れていない端末や、ほかのアプリでAPIキーを使った分は含まれません。</p>
    <button type="button" class="btn btn-text-danger" data-usage-reset>${icon('trash', 16)}利用料金の記録をリセットする</button>`;
}

export function openUsageSheet() {
  openSheet({
    title: 'AIの利用料金',
    subtitle: 'OpenAIの料金表で計算した目安です',
    html: usageHTML(),
    onMount(body, close) {
      body.addEventListener('click', async (e) => {
        const model = ai.modelId();
        if (e.target.closest('[data-price-save]')) {
          const pin = num(body, 'pin'); const pout = num(body, 'pout'); const pc = num(body, 'pcache'); const rate = num(body, 'rate');
          if (pin === null || pout === null) { toast('入力と出力の単価を入れてください', { icon: 'info' }); return; }
          await store.setSettings({
            yenRate: rate || cost.DEFAULT_YEN_RATE,
            aiPrices: { ...(S.settings.aiPrices || {}), [model]: { in: pin, cached: pc, out: pout } },
          });
          close();
          toast('料金の計算を保存しました', { icon: 'check' });
          app.refresh();
        } else if (e.target.closest('[data-price-reset]')) {
          const prices = { ...(S.settings.aiPrices || {}) };
          delete prices[model];
          await store.setSettings({ aiPrices: prices });
          close();
          toast('単価を初期値にもどしました', { icon: 'check' });
          app.refresh();
        } else if (e.target.closest('[data-usage-reset]')) {
          if (!(await confirmDialog('利用料金の記録をリセットしますか？<br><small>このアプリに残っている記録だけが消えます。OpenAIの請求には影響しません。</small>', { ok: 'リセットする', danger: true }))) return;
          await cost.resetUsage();
          close();
          toast('記録をリセットしました', { icon: 'check' });
          app.refresh();
        }
      });
    },
  });
}
