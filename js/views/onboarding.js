// 初回起動時のかんたん設定
import * as store from '../store.js';
import { GOALS } from '../store.js';
import { logoMark, icon } from '../icons.js';
import { stepper, chips, num, toast } from '../ui.js';
import { today, esc } from '../util.js';

export function renderOnboarding(root, done) {
  const data = { age: 25, height: 170, weight: 65, bodyFat: null, sex: '', proteinGoal: 100, goal: 'hosomacho' };
  let step = 0;

  const steps = [
    () => `
      <div class="ob-hero">
        <div class="ob-mark">${logoMark(96, 5)}</div>
        <h1 class="wordmark big">EVOLVE</h1>
        <p class="ob-copy">昨日の自分を、少しずつ超えていく。</p>
        <ul class="ob-points">
          <li>${icon('bolt', 18)}<span>運動・食事・身体の変化を、ひとつにまとめて記録</span></li>
          <li>${icon('growth', 18)}<span>経験値とレベルで、成長がゲームのように見える</span></li>
          <li>${icon('heart', 18)}<span>完璧じゃなくていい。記録しない日があっても大丈夫</span></li>
        </ul>
      </div>
      <button type="button" class="btn btn-primary btn-block btn-lg" data-next>はじめる</button>
      <p class="ob-note">入力はあとからいつでも変更できます</p>`,
    () => `
      <p class="ob-step">STEP 1 / 3</p>
      <h2 class="ob-h">あなたのことを教えてください</h2>
      <p class="muted">消費カロリーの目安を計算するために使います。</p>
      <div class="field"><span class="field-label">年齢</span>${stepper('age', data.age, { step: 1, min: 10, max: 100, unit: '歳' })}</div>
      <div class="field"><span class="field-label">身長</span>${stepper('height', data.height, { step: 1, min: 100, max: 230, unit: 'cm' })}</div>
      <div class="field"><span class="field-label">体重</span>${stepper('weight', data.weight, { step: 0.1, min: 25, max: 250, unit: 'kg', decimals: 1 })}</div>
      <div class="field"><span class="field-label">体脂肪率 <em>任意</em></span>${stepper('bodyFat', data.bodyFat, { step: 0.1, min: 3, max: 60, unit: '%', decimals: 1, placeholder: '15' })}</div>
      <div class="field"><span class="field-label">性別 <em>任意・基礎代謝の目安に使用</em></span>
        <div class="choice" data-choice="sex"><input type="hidden" name="sex" value="${data.sex}">
          ${[['', '未設定'], ['male', '男性'], ['female', '女性']].map(([v, l]) => `<button type="button" class="chip ${data.sex === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="ob-actions"><button type="button" class="btn btn-ghost" data-back>戻る</button><button type="button" class="btn btn-primary" data-next>次へ</button></div>`,
    () => `
      <p class="ob-step">STEP 2 / 3</p>
      <h2 class="ob-h">タンパク質の目標</h2>
      <p class="muted">身体づくりで一番大切にしたい栄養素です。まずは1日100gがおすすめ。細かいカロリー計算は必要ありません。</p>
      <div class="field"><span class="field-label">1日の目標</span>${stepper('proteinGoal', data.proteinGoal, { step: 5, min: 30, max: 300, unit: 'g' })}
      ${chips('proteinGoal', [60, 80, 100, 120, 140], data.proteinGoal, { labels: ['60g', '80g', '100g', '120g', '140g'] })}</div>
      <div class="ob-actions"><button type="button" class="btn btn-ghost" data-back>戻る</button><button type="button" class="btn btn-primary" data-next>次へ</button></div>`,
    () => `
      <p class="ob-step">STEP 3 / 3</p>
      <h2 class="ob-h">目指す身体のイメージ</h2>
      <div class="goal-list">
        ${GOALS.map((g) => `
          <button type="button" class="goal-card ${data.goal === g.id ? 'on' : ''}" data-goal="${g.id}">
            <strong>${g.name}${g.id === 'hosomacho' ? '<span class="badge">おすすめ</span>' : ''}</strong>
            <span>${esc(g.desc)}</span>
          </button>`).join('')}
      </div>
      <div class="ob-actions"><button type="button" class="btn btn-ghost" data-back>戻る</button><button type="button" class="btn btn-primary" data-finish>EVOLVEをはじめる</button></div>`,
  ];

  function collect() {
    const f = root.querySelector('.ob-form');
    for (const k of ['age', 'height', 'weight', 'bodyFat', 'proteinGoal']) {
      if (f.querySelector(`[name="${k}"]`)) data[k] = num(f, k);
    }
    const sex = f.querySelector('[name="sex"]');
    if (sex) data.sex = sex.value;
  }

  function draw() {
    root.innerHTML = `<div class="onboarding"><div class="ob-form scope">${steps[step]()}</div></div>`;
    window.scrollTo(0, 0);
  }

  root.onclick = async (e) => {
    if (!root.querySelector('.onboarding')) return;
    if (e.target.closest('[data-next]')) {
      if (step > 0) collect();
      if (step === 1 && (!data.age || !data.height || !data.weight)) { toast('年齢・身長・体重を入力してください'); return; }
      step = Math.min(steps.length - 1, step + 1); draw();
    } else if (e.target.closest('[data-back]')) {
      collect(); step = Math.max(0, step - 1); draw();
    } else if (e.target.closest('[data-goal]')) {
      data.goal = e.target.closest('[data-goal]').dataset.goal;
      root.querySelectorAll('[data-goal]').forEach((b) => b.classList.toggle('on', b.dataset.goal === data.goal));
    } else if (e.target.closest('[data-finish]')) {
      const btn = e.target.closest('[data-finish]');
      btn.disabled = true;
      await store.setProfile({
        age: data.age, height: data.height, weight: data.weight, bodyFat: data.bodyFat,
        sex: data.sex, proteinGoal: data.proteinGoal || 100, goal: data.goal, goalNote: '',
        onboarded: true, startDate: today(), createdAt: Date.now(),
      });
      // 最初の体重を「はじまりの記録」として保存
      await store.saveRecord('body', {
        date: today(), weight: data.weight, bodyFat: data.bodyFat || null, muscle: null, waist: null, note: 'はじまりの記録',
      }, { silent: true });
      root.onclick = null;
      done();
    }
  };
  draw();
}
