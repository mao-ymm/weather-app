/* 服予報 — 画面・データ取得・保存 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = window.FukuLogic;
  const STORE_KEY = 'fukuyoho:v1';
  const STALE_MS = 30 * 60 * 1000;
  const defaults = { location: null, bodyType: 0, learned: 0, startHour: 8, endHour: 19, feedback: {}, cache: null };

  function load() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; }
    catch { return { ...defaults }; }
  }
  let state = load();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 容量不足などは無視 */ }
  }
  const offset = () => Number(state.bodyType) + Number(state.learned);
  const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n) + '℃';

  function show(section) {
    ['setup', 'loading', 'error', 'result'].forEach((id) => { $(id).hidden = id !== section; });
  }
  function showError(msg) {
    $('errorMsg').textContent = msg;
    show('error');
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- データ取得 ---------- */
  // 応答がないときに読み込み中のまま止まらないよう、12秒で打ち切る
  function fetchWithTimeout(url, ms = 12000) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(timer));
  }

  async function fetchForecast(loc) {
    const params = new URLSearchParams({
      latitude: loc.lat,
      longitude: loc.lon,
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code',
      current: 'temperature_2m',
      wind_speed_unit: 'ms',
      timezone: 'auto',
      past_days: '1',
      forecast_days: '3',
    });
    const res = await fetchWithTimeout('https://api.open-meteo.com/v1/forecast?' + params);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function toHours(d) {
    const h = d.hourly;
    return h.time.map((t, i) => ({
      time: t,
      temp: h.temperature_2m[i],
      feels: h.apparent_temperature[i],
      pop: h.precipitation_probability[i],
      wind: h.wind_speed_10m[i],
      uv: h.uv_index[i],
      code: h.weather_code[i],
    }));
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }),
        reject,
        { timeout: 10000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  async function searchCity(q) {
    const params = new URLSearchParams({ name: q, count: '8', language: 'ja', format: 'json' });
    const res = await fetchWithTimeout('https://geocoding-api.open-meteo.com/v1/search?' + params);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).results || [];
  }

  /* ---------- 描画 ---------- */
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'日月火水木金土'[d.getUTCDay()]})`;
  }

  function render(data, { fromCache = false } = {}) {
    const plan = L.buildPlan(toHours(data), data.current.time, {
      startHour: state.startHour, endHour: state.endHour, offset: offset(),
    });
    const s = plan.suggestion;
    if (!s) { showError('この時間帯の予報データが見つかりませんでした。'); return; }

    document.body.dataset.mood = s.mood;
    $('dayLabel').textContent = `${plan.isTomorrow ? '明日' : '今日'} ${formatDate(plan.date)}`;
    $('placeName').textContent = state.location.name;
    $('outfitEmoji').textContent = s.level.emoji;
    $('outfitTitle').textContent = s.level.title;

    const off = offset();
    $('tempLine').textContent =
      `体感 ${Math.round(s.feelsAvg)}℃ ・ 最高 ${Math.round(s.tMax)}℃ / 最低 ${Math.round(s.tMin)}℃` +
      (off !== 0 ? `（あなた補正 ${fmtSigned(off)}）` : '');

    const items = $('outfitItems');
    items.replaceChildren(...s.level.items.map((t) => el('li', null, t)));

    const extras = s.extras.length ? s.extras : [{ icon: '✨', text: '小物は特になし。身軽にどうぞ' }];
    $('extras').replaceChildren(...extras.map((x) => {
      const li = el('li');
      li.append(el('span', 'x-icon', x.icon), el('span', null, x.text));
      return li;
    }));

    $('hoursTitle').textContent = `外出時間帯の天気（${state.startHour}時〜${state.endHour}時）`;
    $('hours').replaceChildren(...plan.windowHours.map((h) => {
      const w = L.weatherInfo(h.code);
      const box = el('div', 'hour');
      box.append(
        el('span', 'h', `${parseInt(h.time.slice(11, 13), 10)}時`),
        el('span', 'w', w.icon),
        el('span', 't', Number.isFinite(h.temp) ? `${Math.round(h.temp)}°` : '–'),
        el('span', 'p', Number.isFinite(h.pop) ? `${h.pop}%` : '')
      );
      box.title = w.label;
      return box;
    }));

    renderFeedback(data.current.time.slice(0, 10));

    const t = new Date(state.cache ? state.cache.fetchedAt : Date.now());
    $('updated').textContent =
      `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 更新` +
      (fromCache ? '（オフライン：前回のデータ）' : '');
    show('result');
  }

  /* ---------- フィードバック学習 ---------- */
  let todayKey = null;
  function renderFeedback(today) {
    todayKey = today;
    const done = state.feedback[today];
    document.querySelectorAll('[data-fb]').forEach((b) => {
      b.disabled = !!done;
      b.classList.toggle('picked', b.dataset.fb === done);
    });
    $('fbMsg').textContent = done ? '今日の記録は完了。ありがとう！' : '答えるほど、あなた好みの提案になります';
  }

  function onFeedback(kind) {
    if (!todayKey || state.feedback[todayKey]) return;
    const step = kind === 'cold' ? -0.5 : kind === 'hot' ? 0.5 : 0;
    state.learned = Math.max(-3, Math.min(3, Math.round((state.learned + step) * 10) / 10));
    state.feedback[todayKey] = kind;
    // 古い記録は30件まで
    const keys = Object.keys(state.feedback).sort();
    keys.slice(0, Math.max(0, keys.length - 30)).forEach((k) => delete state.feedback[k]);
    save();
    if (state.cache) render(state.cache.data);
    $('fbMsg').textContent =
      kind === 'cold' ? `了解！次から少し暖かめに提案します（学習補正 ${fmtSigned(state.learned)}）`
      : kind === 'hot' ? `了解！次から少し涼しめに提案します（学習補正 ${fmtSigned(state.learned)}）`
      : 'よかった！この調子で提案します';
  }

  /* ---------- 更新フロー ---------- */
  let refreshing = false;
  async function refresh({ silent = false } = {}) {
    if (!state.location) { openSetup(); return; }
    if (refreshing) return;
    refreshing = true;
    if (!silent || !state.cache) show('loading');
    try {
      if (state.location.type === 'geo') {
        try { state.location = { ...state.location, ...(await getPosition()) }; } catch { /* 前回の位置を使う */ }
      }
      const data = await fetchForecast(state.location);
      state.cache = { data, fetchedAt: Date.now() };
      save();
      render(data);
    } catch (e) {
      if (state.cache) render(state.cache.data, { fromCache: true });
      else showError('天気を取得できませんでした。通信状況を確認して、もう一度お試しください。');
    } finally {
      refreshing = false;
    }
  }

  function setLocation(loc) {
    state.location = loc;
    state.cache = null;
    save();
    refresh();
  }

  function openSetup() {
    $('cancelSetup').hidden = !state.location;
    $('searchResults').replaceChildren();
    $('setupMsg').textContent = '';
    show('setup');
  }

  /* ---------- イベント ---------- */
  $('useGeo').addEventListener('click', async () => {
    $('setupMsg').textContent = '位置情報を取得中…';
    try {
      const p = await getPosition();
      setLocation({ type: 'geo', name: '現在地', ...p });
    } catch {
      $('setupMsg').textContent = '位置情報を取得できませんでした。許可を確認するか、地名で検索してください。';
    }
  });

  $('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('searchInput').value.trim();
    if (!q) return;
    $('setupMsg').textContent = '検索中…';
    try {
      const results = await searchCity(q);
      $('setupMsg').textContent = results.length ? '' : '見つかりませんでした。別の書き方で試してみてください。';
      $('searchResults').replaceChildren(...results.map((r) => {
        const li = el('li');
        const b = el('button', 'result-btn');
        b.append(el('strong', null, r.name), el('span', 'muted small', [r.admin1, r.country].filter(Boolean).join('・')));
        b.addEventListener('click', () => setLocation({ type: 'city', name: r.name, lat: r.latitude, lon: r.longitude }));
        li.append(b);
        return li;
      }));
    } catch {
      $('setupMsg').textContent = '検索できませんでした。通信状況を確認してください。';
    }
  });

  $('cancelSetup').addEventListener('click', () => (state.cache ? render(state.cache.data) : refresh()));
  $('retryBtn').addEventListener('click', () => refresh());
  $('errorChangePlace').addEventListener('click', openSetup);
  document.querySelectorAll('[data-fb]').forEach((b) => b.addEventListener('click', () => onFeedback(b.dataset.fb)));

  // 設定ダイアログ
  const dlg = $('settings');
  const form = $('settingsForm');
  for (const name of ['startHour', 'endHour']) {
    const sel = form.elements[name];
    for (let h = 0; h <= 23; h++) sel.append(new Option(`${h}時`, h));
  }
  function syncLearnedHint() {
    $('learnedHint').textContent = `フィードバックからの学習補正：${fmtSigned(state.learned)}`;
  }
  $('settingsBtn').addEventListener('click', () => {
    form.elements.bodyType.value = String(state.bodyType);
    form.elements.startHour.value = String(state.startHour);
    form.elements.endHour.value = String(state.endHour);
    syncLearnedHint();
    dlg.showModal();
  });
  $('resetLearned').addEventListener('click', () => { state.learned = 0; save(); syncLearnedHint(); });
  $('changePlace').addEventListener('click', () => { dlg.close('cancel'); openSetup(); });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    let start = Number(form.elements.startHour.value);
    let end = Number(form.elements.endHour.value);
    if (end <= start) end = Math.min(23, start + 1);
    if (end <= start) start = end - 1;
    state.bodyType = Number(form.elements.bodyType.value);
    state.startHour = start;
    state.endHour = end;
    save();
    if (state.cache) render(state.cache.data);
  });

  // アプリに戻ってきたとき、古ければ更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.location &&
        (!state.cache || Date.now() - state.cache.fetchedAt > STALE_MS)) {
      refresh({ silent: true });
    }
  });

  /* ---------- 起動 ---------- */
  if (state.cache && state.location) {
    render(state.cache.data); // まず前回の結果を即表示（秒で見える）
    refresh({ silent: true });
  } else {
    refresh();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
