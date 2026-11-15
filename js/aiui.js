// AIの画面：キーの設定・コーチに相談・週のふりかえり・今日のメニュー・食事の見積もり
import * as db from './db.js';
import * as store from './store.js';
import { S } from './store.js';
import { icon } from './icons.js';
import { openSheet, toast, choice, val } from './ui.js';
import * as ai from './ai.js';
import { notify, app } from './app.js';
import { today, esc, fmtDateLong } from './util.js';
import { loadImage } from './photos.js';

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
    toast(esc(e.message), { icon: 'info', duration: 5000, action: e.kind === 'auth' || e.kind === 'nokey' ? { label: '設定', onClick: () => openAISetup() } : null });
  } else {
    console.error(e);
    toast('うまくいきませんでした。もう一度お試しください。', { icon: 'info' });
  }
}

/* ---------- キーの設定 ---------- */
export async function openAISetup({ onReady = null } = {}) {
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
          <li>AIの答えは参考です。体調に不安があるときは、無理をせず専門家に相談してください</li>
        </ul>
      </div>`,
    onMount(body, close) {
      body.addEventListener('change', async (e) => {
        if (e.target.name === 'model') {
          await store.setSettings({ aiModel: e.target.value });
          body.querySelector('[data-model-desc]').textContent = modelDesc(e.target.value);
        }
      });
      body.addEventListener('click', async (e) => {
        if (e.target.closest('[data-remove]')) {
          await ai.setKey('');
          close();
          toast('APIキーを消しました');
          app.refresh();
          return;
        }
        const btn = e.target.closest('[data-save]');
        if (!btn) return;
        const k = val(body, 'key').trim();
        if (!k && !cur) { toast('APIキーを貼り付けてください', { icon: 'info' }); return; }
        if (k && /^sk-ant-/.test(k)) { toast('これはAnthropicのキーのようです。OpenAIのキー（sk- で始まるもの）を入れてください', { icon: 'info', duration: 5000 }); return; }
        if (k && !/^sk-/.test(k)) { toast('APIキーは「sk-」で始まります。コピーした文字を確かめてください', { icon: 'info', duration: 4500 }); return; }
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
    },
  });
}

/* ---------- AIコーチに相談 ---------- */
const SUGGEST = ['今日は何をすればいい？', '最近の記録を見て、アドバイスして', 'タンパク質を増やすコツは？', 'お腹まわりを引き締めるには？'];

export function openCoach({ first = null } = {}) {
  return withKey(async () => {
    let history = (await db.kvGet('aiChat')) || [];
    let busy = false; let ctrl = null;
    const bubble = (m) => `<div class="chat-msg ${m.role}"><div class="chat-bubble">${m.role === 'assistant' ? mdLite(m.content) : esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    openSheet({
      title: 'AIコーチ',
      subtitle: 'あなたの記録を見たうえで答えます',
      onClose() { if (ctrl) ctrl.abort(); },
      html: `
        <div class="chat" data-chat>
          <div class="chat-list" data-list></div>
          <div class="chat-suggest" data-suggest>${SUGGEST.map((s) => `<button type="button" class="suggest-chip" data-s="${esc(s)}"><span>${esc(s)}</span></button>`).join('')}</div>
        </div>
        <div class="chat-input">
          <textarea class="input" name="msg" rows="1" placeholder="コーチに聞いてみる" enterkeyhint="send"></textarea>
          <button type="button" class="chat-send" data-send aria-label="送信">${icon('right', 20)}</button>
        </div>
        <div class="chat-foot"><button type="button" class="link" data-clear>${icon('trash', 13)}会話を消して最初から</button><span>答えは参考です。記録のまとめをAIに送ります</span></div>`,
      onMount(body, close) {
        const list = body.querySelector('[data-list]');
        const input = body.querySelector('[name=msg]');
        const scroller = body;
        const draw = () => {
          list.innerHTML = history.length ? history.map(bubble).join('') : `<div class="chat-hello">${icon('spark', 22)}<p>こんにちは。運動・食事・体重のことなど、なんでも聞いてください。</p></div>`;
          body.querySelector('[data-suggest]').hidden = history.length > 0;
          scroller.scrollTop = scroller.scrollHeight;
        };
        const send = async (text) => {
          text = (text || '').trim();
          if (!text || busy) return;
          busy = true; input.value = ''; input.style.height = '';
          history.push({ role: 'user', content: text });
          draw();
          const holder = document.createElement('div');
          holder.className = 'chat-msg assistant';
          holder.innerHTML = '<div class="chat-bubble typing"><i></i><i></i><i></i></div>';
          list.appendChild(holder);
          scroller.scrollTop = scroller.scrollHeight;
          const bub = holder.querySelector('.chat-bubble');
          ctrl = new AbortController();
          try {
            const { text: answer } = await ai.streamText({
              system: `${ai.COACH_SYSTEM}\n\n<ユーザーの記録>\n${ai.buildContext()}\n${ai.weekSummary()}\n</ユーザーの記録>`,
              messages: history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
              signal: ctrl.signal,
              onText: (_, full) => {
                bub.classList.remove('typing');
                bub.innerHTML = mdLite(full);
                scroller.scrollTop = scroller.scrollHeight;
              },
            });
            history.push({ role: 'assistant', content: answer || '（答えが空でした。もう一度聞いてみてください）' });
            history = history.slice(-40);
            await db.kvSet('aiChat', history);
            draw();
          } catch (err) {
            history.pop();
            draw();
            input.value = text;
            showError(err);
          } finally { busy = false; ctrl = null; }
        };
        body.addEventListener('click', async (e) => {
          const s = e.target.closest('[data-s]');
          if (s) { send(s.dataset.s); return; }
          if (e.target.closest('[data-send]')) { send(input.value); return; }
          if (e.target.closest('[data-clear]')) { history = []; await db.kvSet('aiChat', []); draw(); }
        });
        input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });
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
        schema, effort: 'medium',
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
      schema: MEAL_SCHEMA, effort: 'low',
    });
    const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    return { name: String(r.name || text || '食事').slice(0, 40), protein: n(r.protein_g, 300), fat: n(r.fat_g, 300), kcal: Math.round(n(r.kcal, 5000) / 10) * 10, comment: String(r.comment || '').slice(0, 80) };
  } catch (err) { showError(err); return null; }
}

export { notify };
