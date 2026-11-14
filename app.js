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
  let dayChoice = null; // null = 自動（外出時間帯が終わったら明日）

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

  /* ---------- アイコン（すべて自作SVG） ---------- */
  const SUN = '<path d="M16 3.5v2.8M16 25.7v2.8M3.5 16h2.8M25.7 16h2.8M7.2 7.2l2 2M22.8 22.8l2 2M7.2 24.8l2-2M22.8 9.2l2-2" stroke="#FFD60A" stroke-width="2.3" stroke-linecap="round"/><circle cx="16" cy="16" r="6" fill="#FFD60A"/>';
  const MOON = '<path d="M20.5 4.8A11.2 11.2 0 1 0 27.6 22 9.4 9.4 0 0 1 20.5 4.8z" fill="#F2F2F7"/>';
  const CLOUD = 'M9.6 26h13.6a5.4 5.4 0 0 0 .7-10.8 7.6 7.6 0 0 0-14.6 1.6A4.6 4.6 0 0 0 9.6 26z';
  const cloud = (dy, fill = '#fff') => `<path d="${CLOUD}" transform="translate(0 ${dy})" fill="${fill}"/>`;
  const WICON = {
    sun: SUN,
    moon: MOON,
    partlyDay: `<g transform="translate(-1 -1) scale(.66)">${SUN}</g>${cloud(1)}`,
    partlyNight: `<g transform="translate(5 -1) scale(.62)">${MOON}</g>${cloud(1)}`,
    cloud: `<path d="${CLOUD}" transform="translate(4 -4) scale(.8)" fill="#AEB4C2"/>${cloud(1, '#F2F2F7')}`,
    fog: `${cloud(-5, '#E5E5EA')}<path d="M7 24.5h18M10 28.5h12" stroke="#C7C7CC" stroke-width="2.2" stroke-linecap="round"/>`,
    drizzle: `${cloud(-5)}<path d="M11.5 24.5l-.9 2.2M16.5 24.5l-.9 2.2M21.5 24.5l-.9 2.2" stroke="#64D2FF" stroke-width="2.2" stroke-linecap="round"/>`,
    rain: `${cloud(-5)}<path d="M11.5 24l-1.6 4.4M16.5 24l-1.6 4.4M21.5 24l-1.6 4.4" stroke="#64D2FF" stroke-width="2.2" stroke-linecap="round"/>`,
    snow: `${cloud(-5)}<g fill="#fff"><circle cx="11" cy="25" r="1.5"/><circle cx="16.5" cy="28" r="1.5"/><circle cx="22" cy="25" r="1.5"/></g>`,
    thunder: `${cloud(-5)}<path d="M17.2 20.5l-4.4 6.2h3.6l-1.6 4.6 5.4-6.8h-3.6l1.6-4z" fill="#FFD60A"/>`,
  };
  function weatherKey(code, isDay = true) {
    if (code === 0) return isDay ? 'sun' : 'moon';
    if (code === 1 || code === 2) return isDay ? 'partlyDay' : 'partlyNight';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'thunder';
    return 'cloud';
  }
  function weatherIcon(code, isDay, cls) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = WICON[weatherKey(code, isDay)];
    return s;
  }

  // 服（線画・48グリッド）
  const SLEEVE_LONG = 'M17 9l-6 2c-2 .8-3 2.4-3.4 4.4L5.5 36.5l5 1L14 22v18h20V22l3.5 15.5 5-1-2.1-21.1c-.4-2-1.4-3.6-3.4-4.4l-6-2';
  const NECK = 'M17 9c1 3 3.8 5 7 5s6-2 7-5';
  const CLOTHES = {
    tshirt: 'M17 9l-7 3-5 7 5 4 4-3v20h20V20l4 3 5-4-5-7-7-3' + ' ' + NECK,
    longsleeve: SLEEVE_LONG + ' ' + NECK,
    hoodie: SLEEVE_LONG + ' M17 9c0-3.6 3-6 7-6s7 2.4 7 6 M20 12.5l-1 6 M28 12.5l1 6 M18 31h12v5H18z',
    jacket: SLEEVE_LONG + ' M17 9l4 9 3-3 3 3 4-9 M24 15v25 M17 30h4 M27 30h4',
    coat: 'M17 7l-6 2c-2 .8-3 2.4-3.4 4.4L5.5 35.5l5 1L14 20l-1 24h22l-1-24 3.5 16.5 5-1-2.1-22.1c-.4-2-1.4-3.6-3.4-4.4l-6-2 M17 7l5 11 2-3.5 2 3.5 5-11 M24 14.5V44 M20.5 26h.01 M20.5 33h.01 M27.5 26h.01 M27.5 33h.01',
    coatScarf: 'M17 7l-6 2c-2 .8-3 2.4-3.4 4.4L5.5 35.5l5 1L14 20l-1 24h22l-1-24 3.5 16.5 5-1-2.1-22.1c-.4-2-1.4-3.6-3.4-4.4l-6-2 M16.5 8.5c2 3.5 13 3.5 15 0 M16.5 8.5c-.3 3 1 5 3 5.6h9c2-.6 3.3-2.6 3-5.6 M26 14l.8 11h4l-1.4-11 M24 18v26',
    down: 'M18 6h12v4H18z M18 9l-7 2.5c-2 .8-3 2.4-3.4 4.4L5.5 37l5.5 1L14 23v17.5c0 1.4 1.1 2.5 2.5 2.5h15c1.4 0 2.5-1.1 2.5-2.5V23l3 15 5.5-1-2.1-21.1c-.4-2-1.4-3.6-3.4-4.4L30 9 M14 22h20 M14 29h20 M14 36h20 M7 23l5 1 M41 23l-5 1 M6.2 30l5 1 M41.8 30l-5 1 M24 10v33',
  };
  function levelIconKey(level) {
    if (level.min >= 24) return 'tshirt';
    if (level.min >= 20) return 'longsleeve';
    if (level.min >= 16) return 'hoodie';
    if (level.min >= 12) return 'jacket';
    if (level.min >= 8) return 'coat';
    if (level.min >= 5) return 'coatScarf';
    return 'down';
  }
  function clothesIcon(key) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 48 48');
    s.innerHTML = `<path d="${CLOTHES[key]}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    return s;
  }

  // 小さな線アイコン（24グリッド）
  const GLYPH = {
    umbrella: 'M12 3.5a8.5 8.5 0 0 1 8.5 8.5h-17A8.5 8.5 0 0 1 12 3.5z M12 12v6.5a2 2 0 0 0 4 0',
    wind: 'M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5 M3 13h15a2.5 2.5 0 1 1-2.5 2.5 M3 17.5h7',
    layers: 'M12 4l8.5 4.5L12 13 3.5 8.5z M3.5 13L12 17.5l8.5-4.5',
    scarf: 'M6 6c3.6 2.6 8.4 2.6 12 0 M7 6.6v3.4c0 2 2 3.2 5 3.2s5-1.2 5-3.2V6.6 M13.5 13l1 7h3l-1.3-7.3',
    uv: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4',
    down: 'M3.5 7.5l6 6 4-4 7 7 M20.5 11.5v5h-5',
    up: 'M3.5 16.5l6-6 4 4 7-7 M20.5 12.5v-5h-5',
    check: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M8 12.3l2.7 2.7L16.2 9.5',
    clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 7.5V12l3 2',
    calendar: 'M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3.5 10h17 M8 3v4 M16 3v4',
    thermo: 'M10 4.5a2 2 0 0 1 4 0v9.3a4.2 4.2 0 1 1-4 0z M12 10v6',
    feels: 'M12 3.5c3 3.5 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2.5-6.5 5.5-10z',
    hanger: 'M10 6.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3V11 M12 11L3.5 17a1 1 0 0 0 .6 1.8h15.8a1 1 0 0 0 .6-1.8z',
    sliders: 'M4 7.5h9 M17 7.5h3 M4 16.5h3 M11 16.5h9 M15 5.5v4 M9 14.5v4',
    arrow: 'M20 4L4 11l7 2 2 7z',
  };
  function glyph(name, fill) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.innerHTML = fill
      ? `<path d="${GLYPH[name]}" fill="currentColor"/>`
      : `<path d="${GLYPH[name]}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`;
    return s;
  }
  const EXTRA_GLYPH = { '☔': 'umbrella', '🌂': 'umbrella', '🌬️': 'wind', '🔁': 'layers', '🧣': 'scarf', '🧢': 'uv', '📉': 'down', '📈': 'up', '✨': 'check' };
  function setLabel(id, icon, text) {
    const n = $(id);
    n.replaceChildren(glyph(icon), document.createTextNode(text));
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
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code,is_day',
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
    return h.time.map((t, i) => {
      const hr = parseInt(t.slice(11, 13), 10);
      return {
        time: t,
        temp: h.temperature_2m[i],
        feels: h.apparent_temperature[i],
        pop: h.precipitation_probability[i],
        wind: h.wind_speed_10m[i],
        uv: h.uv_index[i],
        code: h.weather_code[i],
        isDay: h.is_day ? !!h.is_day[i] : hr >= 6 && hr < 17,
      };
    });
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
    if (sky === 'night' && code < 3) {
      s.append(svg('circle', { cx: 302, cy: 66, r: 34, fill: 'url(#glow)', opacity: '0.35' }),
        svg('circle', { cx: 302, cy: 66, r: 15, fill: '#f6f1dc' }),
        svg('circle', { cx: 309, cy: 61, r: 13, fill: 'var(--top)' }));
    } else if ((sky === 'day' || sky === 'dusk') && code < 3) {
      const y = sky === 'dusk' ? 175 : 62;
      s.append(svg('circle', { cx: 304, cy: y, r: 60, fill: 'url(#glow)', opacity: '0.7' }),
        svg('circle', { cx: 304, cy: y, r: 20, fill: sky === 'dusk' ? '#ffc58a' : '#fff4c7' }));
    }
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
    return WEEK[new Date(dateStr + 'T00:00:00Z').getUTCDay()] + '曜';
  }
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEK[d.getUTCDay()]})`;
  }
  // 気温 → 色（青 → 緑 → 黄 → 橙 → 赤）
  const TEMP_STOPS = [[0, [90, 200, 250]], [10, [143, 209, 106]], [18, [255, 214, 10]], [26, [255, 159, 10]], [33, [255, 69, 58]]];
  function tempColor(t) {
    if (t <= TEMP_STOPS[0][0]) return `rgb(${TEMP_STOPS[0][1]})`;
    for (let i = 1; i < TEMP_STOPS.length; i++) {
      const [t1, c1] = TEMP_STOPS[i];
      const [t0, c0] = TEMP_STOPS[i - 1];
      if (t <= t1) {
        const k = (t - t0) / (t1 - t0);
        return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k))})`;
      }
    }
    return `rgb(${TEMP_STOPS[TEMP_STOPS.length - 1][1]})`;
  }

  function renderHours(all, nowStr) {
    const COL = 56;
    const startKey = nowStr.slice(0, 13);
    let i0 = all.findIndex((h) => h.time.slice(0, 13) === startKey);
    if (i0 < 0) i0 = 0;
    const hours = all.slice(i0, i0 + 25);
    const cols = el('div', 'hour-cols');
    hours.forEach((h, i) => {
      const hr = parseInt(h.time.slice(11, 13), 10);
      const c = el('div', 'hour-col' + (hr < state.startHour || hr > state.endHour ? ' out' : ''));
      c.title = L.weatherInfo(h.code).label;
      c.append(
        el('span', i === 0 ? 'h now' : 'h', i === 0 ? '今' : `${hr}時`),
        weatherIcon(h.code, h.isDay, 'w'),
        el('span', 'p', Number.isFinite(h.pop) && h.pop >= 20 ? `${h.pop}%` : '')
      );
      cols.append(c);
    });
    const temps = hours.map((h) => h.temp).filter(Number.isFinite);
    const width = hours.length * COL;
    const g = svg('svg', { class: 'hour-graph', width, height: 64, viewBox: `0 0 ${width} 64` });
    if (temps.length) {
      const max = Math.max(...temps), min = Math.min(...temps);
      const span = max - min || 1;
      const pts = hours.map((h, i) => [i * COL + COL / 2, 8 + ((max - (Number.isFinite(h.temp) ? h.temp : min)) / span) * 26]);
      const grad = svg('linearGradient', { id: 'tl', x1: '0', y1: '0', x2: '1', y2: '0' });
      hours.forEach((h, i) => {
        if (Number.isFinite(h.temp)) grad.append(svg('stop', { offset: `${(i / Math.max(1, hours.length - 1)) * 100}%`, 'stop-color': tempColor(h.temp) }));
      });
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
        if (!Number.isFinite(hours[i].temp)) return;
        g.append(svg('circle', { cx: x, cy: y, r: i === 0 ? 4.5 : 3, fill: '#fff' }));
        g.append(svg('text', { x, y: y + 24 }, `${r(hours[i].temp)}°`));
      });
    }
    const track = $('hourTrack');
    track.style.width = width + 'px';
    track.replaceChildren(cols, g);

    // 要約文
    const rainy = hours.find((h) => h.pop >= 50);
    const lo = Math.min(...temps), hi = Math.max(...temps);
    $('hourSummary').textContent = rainy
      ? `${parseInt(rainy.time.slice(11, 13), 10)}時ごろから雨の可能性（${rainy.pop}%）。この先の気温は${r(lo)}〜${r(hi)}°。`
      : `${L.weatherInfo(hours[0].code).label || '穏やかな天気'}。この先24時間の気温は${r(lo)}〜${r(hi)}°。`;
  }

  function renderDaily(data, today, curTemp) {
    const dd = data.daily;
    const gmin = Math.min(...dd.temperature_2m_min), gmax = Math.max(...dd.temperature_2m_max);
    const span = gmax - gmin || 1;
    $('dailyList').replaceChildren(...dd.time.map((t, i) => {
      const lo = dd.temperature_2m_min[i], hi = dd.temperature_2m_max[i];
      const li = el('li', dayDiff(t, today) < 0 ? 'past' : '');
      const w = el('span', 'dw');
      w.append(weatherIcon(dd.weather_code[i], true));
      const pop = dd.precipitation_probability_max[i];
      if (Number.isFinite(pop) && pop >= 20) w.append(el('span', 'dp', `${pop}%`));
      const bar = el('span', 'bar');
      const fill = el('i');
      fill.style.left = `${((lo - gmin) / span) * 100}%`;
      fill.style.width = `${Math.max(4, ((hi - lo) / span) * 100)}%`;
      fill.style.background = `linear-gradient(90deg, ${tempColor(lo)}, ${tempColor(hi)})`;
      bar.append(fill);
      if (t === today && Number.isFinite(curTemp)) {
        const dot = el('b');
        dot.style.left = `${Math.min(100, Math.max(0, ((curTemp - gmin) / span) * 100))}%`;
        bar.append(dot);
      }
      li.append(el('span', 'd', dayName(t, today)), w, el('span', 'lo', `${r(lo)}°`), bar, el('span', 'hi', `${r(hi)}°`));
      return li;
    }));
  }

  function render(data, { fromCache = false } = {}) {
    const hoursAll = toHours(data);
    const today = data.current.time.slice(0, 10);
    const cur = data.current;
    const opts = { startHour: state.startHour, endHour: state.endHour, offset: offset() };
    let plan = L.buildPlan(hoursAll, cur.time, opts);
    if (dayChoice) {
      const date = dayChoice === 'today' ? today : L.addDays(today, 1);
      plan = L.buildPlan(hoursAll, `${date}T00:00`, opts);
    }
    const s = plan.suggestion;
    if (!s) { showError('この時間帯の予報データが見つかりませんでした。'); return; }

    const sky = skyType(data);
    document.body.dataset.sky = sky;
    drawScene(sky, cur.weather_code);

    // ヘッダー・ヒーロー
    $('placeName').textContent = state.location.name;
    const sub = $('placeSub');
    if (state.location.type === 'geo') sub.replaceChildren(glyph('arrow', true), document.createTextNode('現在地'));
    else sub.replaceChildren();
    $('heroTemp').textContent = `${r(cur.temperature_2m)}°`;
    $('heroCond').textContent = L.weatherInfo(cur.weather_code).label || '';
    const ti = data.daily.time.indexOf(today);
    $('heroHiLo').textContent = ti >= 0 ? `最高 ${r(data.daily.temperature_2m_max[ti])}°  最低 ${r(data.daily.temperature_2m_min[ti])}°` : '';

    // 服装
    const isToday = plan.date === today;
    setLabel('outfitLabel', 'hanger', `${formatDate(plan.date)}のコーデ`);
    document.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', (b.dataset.day === 'today') === isToday));
    $('outfitIcon').replaceChildren(clothesIcon(levelIconKey(s.level)));
    $('outfitTitle').textContent = s.level.title;
    const off = offset();
    $('outfitSub').textContent = `${state.startHour}〜${state.endHour}時の体感 ${r(s.feelsAvg)}°（気温 ${r(s.tMin)}〜${r(s.tMax)}°）` + (off !== 0 ? ` ・ 補正 ${fmtSigned(off)}` : '');
    $('outfitItems').replaceChildren(...s.level.items.map((t) => el('li', null, t)));
    const extras = s.extras.length ? s.extras : [{ icon: '✨', text: '小物は特になし。身軽にどうぞ' }];
    $('extras').replaceChildren(...extras.map((x) => {
      const li = el('li');
      const ic = el('span', 'x-icon');
      ic.append(glyph(EXTRA_GLYPH[x.icon] || 'check'));
      li.append(ic, el('span', null, x.text));
      return li;
    }));

    // 時間ごと（今から24時間。外出時間帯以外は薄く表示）
    setLabel('hourLabel', 'clock', '24時間の予報');
    renderHours(hoursAll, cur.time);

    // 日別
    setLabel('dailyLabel', 'calendar', '日別の予報');
    renderDaily(data, today, cur.temperature_2m);

    // タイル：前日比・体感温度
    setLabel('cmpLabel', 'thermo', isToday ? '昨日との差' : '今日との差');
    if (s.diff == null) {
      $('cmpValue').textContent = '—';
      $('cmpText').textContent = '比較できるデータがありません';
    } else {
      const dlt = Math.round(s.diff);
      $('cmpValue').textContent = dlt === 0 ? '±0°' : `${dlt > 0 ? '+' : '−'}${Math.abs(dlt)}°`;
      $('cmpText').textContent =
        dlt <= -3 ? '外出中は前日より寒くなります' : dlt <= -1 ? '前日より少し涼しくなります'
        : dlt >= 3 ? '外出中は前日より暖かくなります' : dlt >= 1 ? '前日より少し暖かくなります' : '前日とほぼ同じ気温です';
    }
    setLabel('feelsLabel', 'feels', '体感温度');
    $('feelsValue').textContent = `${r(cur.apparent_temperature)}°`;
    const fd = cur.apparent_temperature - cur.temperature_2m;
    $('feelsText').textContent = fd <= -2 ? '風などの影響で、実際の気温より寒く感じます' : fd >= 2 ? '湿気などの影響で、実際の気温より暑く感じます' : '実際の気温とほぼ同じです';

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
      kind === 'cold' ? `次から少し暖かめに提案します（学習補正 ${fmtSigned(state.learned)}）`
      : kind === 'hot' ? `次から少し涼しめに提案します（学習補正 ${fmtSigned(state.learned)}）`
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
  $('settingsBtn').append(glyph('sliders'));
  $('useGeo').prepend(glyph('arrow', true));
  $('useGeo').querySelector('svg').setAttribute('style', 'display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:-2px');

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
  document.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    dayChoice = b.dataset.day;
    if (state.cache) render(state.cache.data);
  }));

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
      dayChoice = null;
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
