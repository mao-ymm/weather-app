/* 服予報 — 服装判定ロジック（DOMに依存しない純粋な関数だけをここに置く） */
(function (root) {
  'use strict';

  // 判定温度（体感温度＋個人補正）ごとの服装。上から順に min 以上かどうかを見る。
  const LEVELS = [
    { min: 28, emoji: '👕', title: '半袖でOK', items: ['半袖Tシャツ', '通気性のいいボトムス'] },
    { min: 24, emoji: '👕', title: '半袖＋薄い羽織り', items: ['半袖', '冷房対策の薄手シャツ'] },
    { min: 20, emoji: '👔', title: '長袖シャツ1枚', items: ['長袖シャツ', '薄手のカットソー'] },
    { min: 16, emoji: '🧶', title: 'カーディガン・パーカー', items: ['長袖', 'カーディガン or パーカー'] },
    { min: 12, emoji: '🧥', title: 'ジャケット・トレンチ', items: ['ニット or スウェット', 'トレンチ or ジャケット'] },
    { min: 8, emoji: '🧥', title: '厚手のコート', items: ['ニット', '厚手のコート'] },
    { min: 5, emoji: '🧣', title: '冬コート＋マフラー', items: ['ニット', '冬用コート', 'マフラー'] },
    { min: -Infinity, emoji: '🥶', title: 'ダウン＋防寒小物', items: ['ダウン', 'マフラー', '手袋', '発熱インナー'] },
  ];

  // WMO weather code → 絵文字・ラベル
  function weatherInfo(code) {
    if (code === 0) return { icon: '☀️', label: '快晴' };
    if (code === 1) return { icon: '🌤️', label: '晴れ' };
    if (code === 2) return { icon: '⛅', label: '晴れ時々曇り' };
    if (code === 3) return { icon: '☁️', label: '曇り' };
    if (code === 45 || code === 48) return { icon: '🌫️', label: '霧' };
    if (code >= 51 && code <= 57) return { icon: '🌦️', label: '霧雨' };
    if (code >= 61 && code <= 67) return { icon: '🌧️', label: '雨' };
    if (code >= 71 && code <= 77) return { icon: '🌨️', label: '雪' };
    if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'にわか雨' };
    if (code === 85 || code === 86) return { icon: '🌨️', label: 'にわか雪' };
    if (code >= 95) return { icon: '⛈️', label: '雷雨' };
    return { icon: '🌡️', label: '' };
  }

  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const round1 = (x) => Math.round(x * 10) / 10;
  const hourOf = (h) => parseInt(h.time.slice(11, 13), 10);

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function inWindow(h, date, startHour, endHour) {
    const hr = hourOf(h);
    return h.time.slice(0, 10) === date && hr >= startHour && hr <= endHour;
  }

  // 外出時間帯が終わっていたら「明日」の提案に切り替える
  function pickTarget(nowStr, endHour) {
    const today = nowStr.slice(0, 10);
    const nowHour = parseInt(nowStr.slice(11, 13), 10);
    return nowHour >= endHour
      ? { date: addDays(today, 1), isTomorrow: true }
      : { date: today, isTomorrow: false };
  }

  function moodOf(j) {
    if (j >= 28) return 'hot';
    if (j >= 20) return 'warm';
    if (j >= 14) return 'mild';
    if (j >= 8) return 'cool';
    return 'cold';
  }

  function suggest(windowHours, prevHours, offset) {
    const valid = windowHours.filter((h) => Number.isFinite(h.feels) && Number.isFinite(h.temp));
    if (!valid.length) return null;

    const feelsAvg = avg(valid.map((h) => h.feels));
    const judge = round1(feelsAvg + offset);
    const level = LEVELS.find((l) => judge >= l.min);

    const temps = valid.map((h) => h.temp);
    const tMax = Math.max(...temps);
    const tMin = Math.min(...temps);
    const range = round1(tMax - tMin);
    const nums = (k) => valid.map((h) => h[k]).filter(Number.isFinite);
    const popMax = Math.max(0, ...nums('pop'));
    const windMax = Math.max(0, ...nums('wind'));
    const uvMax = Math.max(0, ...nums('uv'));
    const feelsMin = Math.min(...valid.map((h) => h.feels)) + offset;

    const extras = [];
    if (popMax >= 60) extras.push({ icon: '☔', text: `雨の可能性大（最大${popMax}%）。長傘と濡れてもいい靴を` });
    else if (popMax >= 30) extras.push({ icon: '🌂', text: `降水確率 最大${popMax}%。折りたたみ傘を` });

    if (windMax >= 8) extras.push({ icon: '🌬️', text: `強風（最大${windMax.toFixed(1)}m/s）。傘より合羽が安心` });
    else if (windMax >= 5) extras.push({ icon: '🌬️', text: `風が強め（最大${windMax.toFixed(1)}m/s）。風を通さないアウターを` });

    if (range >= 8) extras.push({ icon: '🔁', text: `寒暖差${range}℃。脱ぎ着しやすい羽織りを` });
    if (feelsMin < 5 && judge >= 8) extras.push({ icon: '🧣', text: `朝晩は体感${Math.round(feelsMin)}℃まで下がります。マフラーがあると安心` });
    if (uvMax >= 6) extras.push({ icon: '🧢', text: `紫外線が強め（UV ${Math.round(uvMax)}）。帽子・日焼け止めを` });

    let diff = null;
    const prevValid = (prevHours || []).filter((h) => Number.isFinite(h.temp));
    if (prevValid.length) {
      diff = round1(avg(temps) - avg(prevValid.map((h) => h.temp)));
      if (diff <= -5) extras.unshift({ icon: '📉', text: `前日より${Math.abs(diff)}℃寒い。1枚多めに` });
      else if (diff >= 5) extras.unshift({ icon: '📈', text: `前日より${diff}℃暖かい。1枚少なめでOK` });
    }

    return { judge, feelsAvg: round1(feelsAvg), tMax, tMin, range, popMax, windMax, uvMax, level, extras, diff, mood: moodOf(judge) };
  }

  function buildPlan(hours, nowStr, opts) {
    const { startHour, endHour, offset } = opts;
    const target = pickTarget(nowStr, endHour);
    const windowHours = hours.filter((h) => inWindow(h, target.date, startHour, endHour));
    const prevHours = hours.filter((h) => inWindow(h, addDays(target.date, -1), startHour, endHour));
    return { ...target, windowHours, suggestion: suggest(windowHours, prevHours, offset) };
  }

  const api = { LEVELS, weatherInfo, addDays, pickTarget, suggest, buildPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FukuLogic = api;
})(typeof self !== 'undefined' ? self : this);
