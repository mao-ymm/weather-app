/* 服予報 — 画面・データ取得・保存 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = window.FukuLogic;
  const STORE_KEY = 'fukuyoho:v1';
  const STALE_MS = 30 * 60 * 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const defaults = { location: null, bodyType: 0, learned: 0, startHour: 8, endHour: 19, feedback: {}, cache: null };

  function load() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; }
    catch { return { ...defaults }; }
  }
  let state = load();
  // 旧バージョンのキャッシュ（日別データなし）は捨てる
  if (state.cache && !(state.cache.data && state.cache.data.daily)) state.cache = null;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 容量不足などは無視 */ }
  }
  const offset = () => Number(state.bodyType) + Number(state.learned);
  const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n) + '℃';
  const r = (n) => Math.round(n);

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
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
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
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
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

  /* ---------- 空の背景（時間帯と天気で変わる） ---------- */
  function skyType(data) {
    const c = data.current;
    if (c.weather_code >= 51) return 'rain';
    if (!c.is_day) return 'night';
    const now = Date.parse(c.time);
    const today = c.time.slice(0, 10);
    const i = data.daily.time.indexOf(today);
    if (i >= 0) {
      const near = (t) => t && Math.abs(now - Date.parse(t)) < 50 * 60 * 1000;
      if (near(data.daily.sunrise[i]) || near(data.daily.sunset[i])) return 'dusk';
    }
    return c.weather_code >= 3 ? 'cloudy' : 'day';
  }

  function drawScene(sky, code) {
    const s = $('scene');
    s.replaceChildren();
    const defs = svg('defs', {});
    const glow = svg('radialGradient', { id: 'glow' });
    glow.append(svg('stop', { offset: '0%', 'stop-color': '#fff6d5', 'stop-opacity': '0.9' }),
      svg('stop', { offset: '100%', 'stop-color': '#fff6d5', 'stop-opacity': '0' }));
    const lake = svg('linearGradient', { id: 'lake', x1: '0', y1: '0', x2: '0', y2: '1' });
    lake.append(svg('stop', { offset: '0%', 'stop-color': 'var(--lake)', 'stop-opacity': '0.9' }),
      svg('stop', { offset: '100%', 'stop-color': 'var(--hill3)', 'stop-opacity': '1' }));
    defs.append(glow, lake);
    s.append(defs);

    // 星（決まった並びになるよう簡単な乱数）
    if (sky === 'night' || sky === 'dusk') {
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = sky === 'night' ? 70 : 18;
      for (let i = 0; i < n; i++) {
        const st = svg('circle', { cx: (rand() * 400).toFixed(1), cy: (rand() * 170).toFixed(1), r: (rand() * 1.1 + 0.3).toFixed(2), fill: '#fff', opacity: (rand() * 0.6 + 0.3).toFixed(2) });
        if (i % 4 === 0) { st.setAttribute('class', 'twinkle'); st.style.animationDelay = (rand() * 3).toFixed(2) + 's'; }
        s.append(st);
      }
    }
    // 月 or 太陽
    if (sky === 'night' && code < 3) {
      s.append(svg('circle', { cx: 318, cy: 64, r: 34, fill: 'url(#glow)', opacity: '0.35' }),
        svg('circle', { cx: 318, cy: 64, r: 15, fill: '#f6f1dc' }),
        svg('circle', { cx: 325, cy: 59, r: 13, fill: 'var(--top)' }));
    } else if ((sky === 'day' || sky === 'dusk') && code < 3) {
      const y = sky === 'dusk' ? 175 : 62;
      s.append(svg('circle', { cx: 312, cy: y, r: 60, fill: 'url(#glow)', opacity: '0.7' }),
        svg('circle', { cx: 312, cy: y, r: 20, fill: sky === 'dusk' ? '#ffc58a' : '#fff4c7' }));
    }
    // 雲
    if (code >= 2) {
      const cloudFill = sky === 'night' ? '#8a9ccc' : '#ffffff';
      const op = sky === 'rain' ? 0.32 : sky === 'night' ? 0.22 : 0.55;
      const g = svg('g', { class: 'drift', fill: cloudFill, opacity: op });
      [[70, 70, 1], [250, 45, 0.8], [180, 120, 1.2], [350, 105, 0.9]].forEach(([x, y, k]) => {
        g.append(svg('ellipse', { cx: x, cy: y, rx: 46 * k, ry: 15 * k }),
          svg('ellipse', { cx: x - 16 * k, cy: y - 9 * k, rx: 22 * k, ry: 16 * k }),
          svg('ellipse', { cx: x + 12 * k, cy: y - 13 * k, rx: 26 * k, ry: 19 * k }));
      });
      s.append(g);
    }
    // 雨・雪
    if (code >= 51) {
      const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
      const g = svg('g', { class: 'rain', stroke: '#cfe0ff', 'stroke-width': snow ? 3 : 1.2, 'stroke-linecap': 'round', opacity: '0.55' });
      for (let i = 0; i < 46; i++) {
        const x = (i * 37) % 410, y = (i * 53) % 210;
        const line = svg('line', { x1: x, y1: y, x2: snow ? x : x - 4, y2: snow ? y + 0.1 : y + 12 });
        line.style.animationDelay = ((i % 9) * 0.1).toFixed(1) + 's';
        g.append(line);
      }
      s.append(g);
    }
    // 湖と丘（オリジナルのシルエット）
    s.append(
      svg('rect', { x: 0, y: 218, width: 400, height: 82, fill: 'url(#lake)' }),
      svg('path', { d: 'M0 214 C60 196 110 204 160 210 C220 198 280 190 330 204 C360 210 385 206 400 202 L400 222 L0 222Z', fill: 'var(--hill1)' }),
      svg('path', { d: 'M-10 300 L-10 262 C60 246 120 252 170 262 C230 274 280 250 340 246 C370 244 395 250 410 254 L410 300Z', fill: 'var(--hill2)' }),
      svg('path', { d: 'M-10 300 L-10 282 C70 270 150 286 230 280 C300 275 360 268 410 276 L410 300Z', fill: 'var(--hill3)' })
    );
    for (let i = 0; i < 6; i++) {
      s.append(svg('line', { x1: 40 + i * 62, y1: 230 + (i % 3) * 8, x2: 70 + i * 62, y2: 230 + (i % 3) * 8, stroke: '#ffffff', 'stroke-opacity': '0.18', 'stroke-width': 1 }));
    }
    const theme = getComputedStyle(document.body).getPropertyValue('--top').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && theme) meta.setAttribute('content', theme);
  }

  /* ---------- 描画 ---------- */
  const WEEK = '日月火水木金土';
  function dayDiff(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }
  function dayName(dateStr, today) {
    const d = dayDiff(dateStr, today);
    if (d === -1) return '昨日';
    if (d === 0) return '今日';
    if (d === 1) return '明日';
    return WEEK[new Date(dateStr + 'T00:00:00Z').getUTCDay()] + '曜日';
  }
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
  }

  function renderHours(hours) {
    const COL = 64;
    const track = $('hourTrack');
    const cols = el('div', 'hour-cols');
    hours.forEach((h) => {
      const w = L.weatherInfo(h.code);
      const c = el('div', 'hour-col');
      c.title = w.label;
      c.append(
        el('span', 'h', `${parseInt(h.time.slice(11, 13), 10)}:00`),
        el('span', 'w', w.icon),
        el('span', 'p', Number.isFinite(h.pop) ? `☂ ${h.pop}%` : '')
      );
      cols.append(c);
    });
    const temps = hours.map((h) => h.temp).filter(Number.isFinite);
    const width = hours.length * COL;
    const g = svg('svg', { class: 'hour-graph', width, height: 74, viewBox: `0 0 ${width} 74` });
    if (temps.length) {
      const max = Math.max(...temps), min = Math.min(...temps);
      const span = max - min || 1;
      const pts = hours.map((h, i) => [i * COL + COL / 2, 10 + ((max - (Number.isFinite(h.temp) ? h.temp : min)) / span) * 30]);
      const grad = svg('linearGradient', { id: 'tl', x1: '0', y1: '0', x2: '1', y2: '0' });
      grad.append(svg('stop', { offset: '0%', 'stop-color': '#ffd84d' }), svg('stop', { offset: '100%', 'stop-color': '#cdd6ea' }));
      const defs = svg('defs', {});
      defs.append(grad);
      g.append(defs);
      const d = pts.map(([x, y], i) => {
        if (!i) return `M${x} ${y}`;
        const [px, py] = pts[i - 1];
        const mx = (px + x) / 2;
        return `C${mx} ${py} ${mx} ${y} ${x} ${y}`;
      }).join(' ');
      g.append(svg('path', { d, fill: 'none', stroke: 'url(#tl)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
      pts.forEach(([x, y], i) => {
        g.append(svg('circle', { cx: x, cy: y, r: 5, fill: '#fff' }));
        if (Number.isFinite(hours[i].temp)) g.append(svg('text', { x, y: y + 26 }, `${r(hours[i].temp)}°`));
      });
    }
    track.style.width = width + 'px';
    track.replaceChildren(cols, g);
  }

  function renderDaily(data, today) {
    const dd = data.daily;
    $('dailyList').replaceChildren(...dd.time.map((t, i) => {
      const li = el('li', dayDiff(t, today) < 0 ? 'past' : '');
      const w = L.weatherInfo(dd.weather_code[i]);
      const pop = dd.precipitation_probability_max[i];
      const temps = el('span', 'dt', `${r(dd.temperature_2m_max[i])}°`);
      temps.append(el('span', null, `${r(dd.temperature_2m_min[i])}°`));
      li.append(
        el('span', 'd', dayName(t, today)),
        el('span', 'dp', Number.isFinite(pop) ? `☂ ${pop}%` : ''),
        el('span', 'di', w.icon),
        temps
      );
      return li;
    }));
  }

  function render(data, { fromCache = false } = {}) {
    const plan = L.buildPlan(toHours(data), data.current.time, {
      startHour: state.startHour, endHour: state.endHour, offset: offset(),
    });
    const s = plan.suggestion;
    if (!s) { showError('この時間帯の予報データが見つかりませんでした。'); return; }
    const today = data.current.time.slice(0, 10);
    const cur = data.current;
    const w = L.weatherInfo(cur.weather_code);

    // 空
    const sky = skyType(data);
    document.body.dataset.sky = sky;
    drawScene(sky, cur.weather_code);

    // ヒーロー
    $('placeName').textContent = state.location.name;
    $('heroTemp').textContent = `${r(cur.temperature_2m)}°`;
    $('heroCond').textContent = w.label || '—';
    const ti = data.daily.time.indexOf(today);
    $('heroHiLo').textContent = ti >= 0 ? `↑${r(data.daily.temperature_2m_max[ti])}° / ↓${r(data.daily.temperature_2m_min[ti])}°` : '';
    $('heroFeels').textContent = `体感温度${r(cur.apparent_temperature)}°`;

    // 服装
    const dayWord = plan.isTomorrow ? '明日' : '今日';
    $('outfitLabel').textContent = `${dayWord}のコーデ ・ ${formatDate(plan.date)} ${state.startHour}〜${state.endHour}時`;
    $('outfitEmoji').textContent = s.level.emoji;
    $('outfitTitle').textContent = s.level.title;
    const off = offset();
    $('tempLine').textContent = `外出中の体感 ${r(s.feelsAvg)}℃（${r(s.tMin)}〜${r(s.tMax)}℃）` + (off !== 0 ? ` ・ あなた補正 ${fmtSigned(off)}` : '');
    $('outfitItems').replaceChildren(...s.level.items.map((t) => el('li', null, t)));
    const extras = s.extras.length ? s.extras : [{ icon: '✨', text: '小物は特になし。身軽にどうぞ' }];
    $('extras').replaceChildren(...extras.map((x) => {
      const li = el('li');
      li.append(el('span', 'x-icon', x.icon), el('span', null, x.text));
      return li;
    }));

    // 時間ごと
    const codes = plan.windowHours.map((h) => h.code).filter(Number.isFinite);
    const mainCode = codes.length ? Math.max(...codes) : cur.weather_code;
    $('hourSummary').textContent = `${dayWord}の外出中は${L.weatherInfo(mainCode).label || '—'}。${r(s.tMin)}〜${r(s.tMax)}℃。`;
    renderHours(plan.windowHours);

    // 前日比
    $('cmpTitle').textContent = `🌡 ${dayWord}の気温`;
    if (s.diff == null) {
      $('cmpText').textContent = '前日のデータがありません';
      $('cmpValue').textContent = '';
    } else {
      const dlt = Math.round(s.diff);
      $('cmpText').textContent =
        dlt <= -3 ? '前日より気温が下がる' : dlt <= -1 ? '前日より少し気温が下がる'
        : dlt >= 3 ? '前日より気温が上がる' : dlt >= 1 ? '前日より少し気温が上がる' : '前日とほぼ同じ';
      $('cmpValue').textContent = dlt === 0 ? '±0°' : `${Math.abs(dlt)}°${dlt < 0 ? '↓' : '↑'}`;
    }

    renderDaily(data, today);
    renderFeedback(today);

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
      $('searchResults').replaceChildren(...results.map((res) => {
        const li = el('li');
        const b = el('button', 'result-btn');
        b.append(el('strong', null, res.name), el('span', 'muted small', [res.admin1, res.country].filter(Boolean).join('・')));
        b.addEventListener('click', () => setLocation({ type: 'city', name: res.name, lat: res.latitude, lon: res.longitude }));
        li.append(b);
        return li;
      }));
    } catch {
      $('setupMsg').textContent = '検索できませんでした。通信状況を確認してください。';
    }
  });

  $('placeBtn').addEventListener('click', openSetup);
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.location &&
        (!state.cache || Date.now() - state.cache.fetchedAt > STALE_MS)) {
      refresh({ silent: true });
    }
  });

  /* ---------- 起動 ---------- */
  if (state.cache && state.location) {
    render(state.cache.data);
    refresh({ silent: true });
  } else {
    refresh();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
