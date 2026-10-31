// 天気のモデル（MR.Weather）。THREE にも DOM にも依存しない（Node のテスト、後でサーバーも require できる）。
//   ブラウザ: <script> で読む → MR.Weather      Node: require('../www/js/weather.js') → Weather（globalThis.MR.Weather にも入る）
//   見た目・音（雲のドーム・雨・雷の光・音）は weather_view.js（MR.WeatherView）。ここは数だけ。
//
// ■ 予定（schedule）: 時刻 t（秒）を slotSec ごとの枠 k = floor(t / slotSec) に分け、枠ごとに状態 (s, age) を 1 つ決める。
//   age = その状態がこの枠の前に何枠続いたか。u_k = hash01(seed, k)。
//   - リセット: u_k < resetP の枠（と k が resetScanCap の倍数の枠）は前が何でも (hub, 0)。hub（曇り）はどの状態の隣でもよい。
//   - ほか: age + 1 < minSlots なら同じ状態のまま。age + 1 ≥ maxSlots なら自分へ戻る重みを消す。残りは next の重み
//     （weight 0 の状態は選ばない。next が無ければ各状態の weight）から (u_k − resetP) / (1 − resetP) の逆関数法で選ぶ。
//   - 枠 k の状態は「いちばん近いリセットの枠から前へ走らせた結果」。途中から入った端末も同じ状態になる（オンライン）。
//     resetScanCap の倍数の枠を必ずリセットにしてあるので、さかのぼるのは最大 resetScanCap 枠（ふだんは 1 / resetP ≈ 12 枠）。
//   - 移り変わり: 前の枠と状態が違えば、枠の頭から T = min(transitionSec, slotSec × 0.5) 秒かけて smoothstep で混ぜる
//     （数は 2 つの状態の表の線形補間。色はリニア）。T ≤ 枠の半分なので次の枠までに必ず混ぜ終わる。
//   - 割合: Weather.stationary(cfg) が (状態, age) の連鎖の定常分布から出す（テストは 20 シード × 30 日と ±0.03 で比べる）。
//   - cycle（?weather=cycle、見本）: cycleSlotSec ごとに予定される状態（weight > 0）を順に回す。
//   - |t| > 1e15 秒（壊れた時計）は update が前の値のまま返し、雷は 0（MAX_T）。
//
// ■ 時計: ソロは game.time + soloOffset(seed)、オンライン（M5）は Weather.Clock（serverNow へ滑らかに寄せる。clockSnap 秒より
//   ずれたら飛ぶ = jumped）。update(t, jumped) は jumped・最初の 1 回・t が戻った・jumpSec より進んだ フレームを「飛んだ」とし、
//   そのフレームは changed（変わった知らせ）を出さず、雷も数えない。
//
// ■ 出力 p（update が毎回同じオブジェクトを埋める。割り当て無し）:
//   id / prevId / blend（0..1）/ k / age / t / changed（状態が変わった最初の 1 回だけ true）/ jumped
//   雲: cov soft erode over cirrus hazeDist、色 lit / shade / ov / cir（[r,g,b] リニア）、haze + hasHaze（0..1。0 = 霧の色を使う）
//   hazeDense（霧が濃いとき地平線から下を霧の色で埋める 0..1。min(fogMul, farMul) が 1 → haze.denseFrom で 0 → 1）
//   光: bgMul sunMul hemiMul exposure envMul、sunCol + hasSun（0 = レベルの太陽の色のまま）
//   霧: fog + hasFog（0 = レベルの霧の色のまま。見た目 = mix(レベルの色, fog, hasFog)）、fogMul farMul
//   雨: rain snow wetTarget、風: windBase（状態の風）gust（1 + gustAmp × ノイズ）wind（= windBase × gust、m/s）windDir（吹いてくる方位、
//   北 = 0・時計回り、北 = −Z・東 = +X）windX / windZ（風が吹いて行く向きの速度）、lightningPerMin、vis（敵の見える距離の倍率）skyRefl glint
//   色の「無し（null）」は色 × 重みで混ぜる（重み付きの平均）ので、片方だけ色がある移り変わりでも見た目は線形に変わる。
//
// ■ 雷: strikesBetween(t0, t1, out) が (t0, t1] の落雷を out（Weather.strikeBuffer(n) で作る）に入れて数を返す。枠ごとに
//   ハッシュで最大の頻度の候補を作り、その時刻の lightningPerMin で間引く（どの端末も同じ時刻・方位・距離）。
//   t1 < t0・t1 − t0 > lightning.maxGap は 0。out は lightning.queue 個まで（あふれた分は stats.dropped）。
//   strikesSinceLast(out) は最後の update の区間（飛んだフレームは 0）。
//
// ■ 毎フレーム（update / strikesSinceLast / stateAt / Clock.step）はオブジェクト・配列・クロージャを作らない（tools/weather-test.js が
//   V8 のサンプリングのヒーププロファイラで weather.js の関数が作った物を数える）。p はプロパティを全部書いたリテラル、時刻のフィールドに
//   null を入れない、数を引数・戻り値で渡す小さな関数を毎フレームの道に置かない（V8 は inline されない境目で小数を箱にする）。
//
// ■ force(id | null, { instant }): ソロ・テストだけ。今の値から T 秒でその状態へ（null で予定に戻る）。instant は次の update を
//   「飛んだ」にする（知らせ無し）。オンラインでは使わない。
//
// ■ 設定は game.json の weather（M1 から。無いキーは Weather.DEFAULTS）。レベルごとの値は weather.levels.<id>（levels/*.json には
//   書かない: midtown.json を変えると server/citycache.json が古くなる）。Weather.levelConfig(cfg, id, isCity)。
(function (root) {
  const MR = root.MR || (root.MR = {});

  // ---------- 決定的なハッシュ（整数だけ。loot / citygen と同じ混ぜ方）----------
  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16; return h >>> 0;
  }
  function strHash(s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  const U32 = 4294967296;
  // seed（32 bit）+ 整数 k（±2^53 まで。負でもよい）+ salt → 32 bit
  function h32(seed, k, salt) {
    const lo = k - Math.floor(k / U32) * U32;           // 0 .. 2^32 − 1
    const hi = Math.floor(k / U32);
    let h = fmix(((seed >>> 0) ^ Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca77)) >>> 0);
    if (salt) h = fmix((h + Math.imul(salt, 0x27d4eb2d)) >>> 0);
    return h;
  }
  function h01(seed, k, salt) { return h32(seed, k, salt) / U32; }
  // 候補 i ごと
  function h01i(seed, k, i, salt) { return fmix((h32(seed, k, salt) + Math.imul(i + 1, 0x165667b1)) >>> 0) / U32; }
  const SALT = { u: 0, dir: 101, gust: 102, off: 103, gap: 201, acc: 202, bear: 203, near: 204, dist: 205, col: 206, dbl: 207, flash: 208 };

  function smooth01(x) { x = x < 0 ? 0 : (x > 1 ? 1 : x); return x * x * (3 - 2 * x); }
  // これより大きな |t|（秒）は壊れた時計として無視する（枠の番号 k が 2^53 に近づくと k − 1 === k になり、さかのぼりが終わらない。
  //   オンラインの serverNow / 1000 は約 1.8e9。1e15 秒 ≈ 3 千万年）
  const MAX_T = 1e15;
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  // '#rgb' / '#rrggbb' → リニア（three r128 の Color.convertSRGBToLinear と同じ式 = MR.srgb と同じ値）
  function srgbToLin(c) { return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4); }
  function hexLin(hex, out, o) {
    let s = typeof hex === 'string' ? hex.trim() : '';
    if (s[0] === '#') s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return false;
    const n = parseInt(s, 16);
    out[o] = srgbToLin(((n >> 16) & 255) / 255); out[o + 1] = srgbToLin(((n >> 8) & 255) / 255); out[o + 2] = srgbToLin((n & 255) / 255);
    return true;
  }

  // ---------- 既定値（game.json の weather に無いキー）----------
  const DEFAULTS = {
    enabled: true,
    slotSec: 180,            // 予定の枠（どの状態もこれより短くは続かない）
    transitionSec: 45,       // 移り変わりの時間（slotSec × 0.5 まで）
    resetP: 0.08,            // 枠ごとに hub へ戻る確率（どの端末も同じ状態にそろう）
    hub: 'cloudy',
    resetScanCap: 512,       // この倍数の枠は必ずリセット（さかのぼりの上限）
    cycleSlotSec: 20,        // ?weather=cycle
    jumpSec: 2,              // update の t がこれより進んだら「飛んだ」
    solo: { offsetSpan: 1000000, startState: 'auto' },
    online: { enabled: true, drift: false, clockSlew: 0.5, clockSnap: 30 },
    toastMs: 3500,
    levelDefaults: { enabled: 'city', cloudH: 1600, cirrusH: 8000, scaleA: 12000, scaleB: 3000, windDir: 250 },
    levels: { arena01: { enabled: false } },
    wet: { riseSec: 60, drySec: 240, puddleLight: 0.05, puddleStorm: 0.30, maskTile: 6, darken: 0.3, rough: 0.5, roughMottle: 1.4, mottle: [0.55, 0.9],
      puddleRough: 0.05, puddleDark: 0.35, puddleEdge: 0.04, puddleKnee: 0.8, farDarken: 0.28 },
    wind: { dirDriftDegPerMin: 6, dirAmpDeg: 40, gustAmp: 0.35, gustPeriod: 23 },
    drift: { chute: 0.6, heli: 0.25, jet: 0.15, heliAglFrom: 5, heliAglFull: 20, jetAglFrom: 30 },
    lightning: { near: 1500, nearShare: 0.3, minDist: 400, maxDist: 8000, inCloudFrom: 3000, flashMs: [60, 140], doubleChance: 0.4,
      boltShowMs: 180, sound: 343, thunderRef: 40, maxGap: 1.0, queue: 4 },
    enemy: { minAttackMul: 0.7 },
    haze: { denseFrom: 0.6, bandDeg: 4, fadeDeg: 12 },
    env: { minScale: 0.25 },
    states: {
      clear: { weight: 4, minSlots: 2, next: { clear: 5, cloudy: 3, fog: 1 },
        name: '晴れ', toast: '晴れてきた', icon: 'sun',
        clouds: { coverage: 0.16, softness: 0.10, erode: 0.30, overcast: 0, cirrus: 0.55,
          lit: '#ffd8bc', shade: '#8a7f95', ov: '#8a8590', cir: '#f3c6b0', hazeDist: 22000 },
        bgMul: 1, sunMul: 1, hemiMul: 1, exposure: 1, sun: null, fog: null, fogMul: 1, farMul: 1, envMul: 1,
        rain: 0, wet: 0, wind: 4, lightningPerMin: 0, vis: 1, skyRefl: 1, glint: 1 },
      cloudy: { weight: 4, minSlots: 2, next: { cloudy: 3, clear: 3, rain: 2, fog: 1 },
        name: '曇り', toast: '曇ってきた', icon: 'cloud',
        clouds: { coverage: 0.55, softness: 0.12, erode: 0.30, overcast: 0, cirrus: 0.30,
          lit: '#f2c4a8', shade: '#6a6476', ov: '#7a7682', cir: '#e9c0b0', hazeDist: 18000 },
        bgMul: 0.85, sunMul: 0.55, hemiMul: 0.95, exposure: 0.97, sun: null, fog: '#a8857c', fogMul: 1, farMul: 1, envMul: 0.7,
        rain: 0, wet: 0, wind: 6, lightningPerMin: 0, vis: 1, skyRefl: 0.85, glint: 0.5 },
      rain: { weight: 3, minSlots: 2, maxSlots: 5, next: { rain: 4, cloudy: 3, storm: 1.5, fog: 0.5 },
        name: '雨', toast: '雨が降ってきた', icon: 'rain',
        clouds: { coverage: 0.85, softness: 0.20, erode: 0.20, overcast: 0.92, cirrus: 0,
          lit: '#8f8686', shade: '#3c3c45', ov: '#5a5c66', cir: '#888888', hazeDist: 9000 },
        bgMul: 0.45, sunMul: 0.15, hemiMul: 0.7, exposure: 0.9, sun: '#b9b2ac', fog: '#5e5f66', fogMul: 0.6, farMul: 1, envMul: 0.4,
        rain: 0.55, wet: 0.8, wind: 7, lightningPerMin: 0, vis: 0.8, skyRefl: 0.5, glint: 0.15 },
      storm: { weight: 1, minSlots: 1, maxSlots: 3, next: { storm: 2, rain: 4, cloudy: 1 },
        name: '雷雨', toast: '雷雨になった', icon: 'bolt',
        clouds: { coverage: 0.95, softness: 0.22, erode: 0.20, overcast: 1, cirrus: 0,
          lit: '#5e5964', shade: '#202129', ov: '#2e2f37', cir: '#555555', hazeDist: 7000 },
        bgMul: 0.25, sunMul: 0.05, hemiMul: 0.55, exposure: 0.85, sun: '#a7a6b0', fog: '#3a3b42', fogMul: 0.5, farMul: 1, envMul: 0.3,
        rain: 1, wet: 1, wind: 12, lightningPerMin: 5, vis: 0.7, skyRefl: 0.35, glint: 0 },
      fog: { weight: 2, minSlots: 2, maxSlots: 4, next: { fog: 3, cloudy: 3, clear: 2 },
        name: '霧', toast: '霧が出てきた', icon: 'fog',
        clouds: { coverage: 0.40, softness: 0.25, erode: 0.15, overcast: 0.80, cirrus: 0,
          lit: '#b3aeb0', shade: '#7c7980', ov: '#8f8c8f', cir: '#999999', hazeDist: 2500 },
        bgMul: 0.6, sunMul: 0.35, hemiMul: 0.9, exposure: 0.95, sun: '#d8d0c8', fog: '#8e8b8d', fogMul: 0.25, farMul: 0.3, envMul: 0.45,
        rain: 0, wet: 0.3, wind: 2, lightningPerMin: 0, vis: 0.55, skyRefl: 0.4, glint: 0.2 },
      snow: { weight: 0, minSlots: 2, maxSlots: 4, next: { snow: 3, cloudy: 3 },
        name: '雪', toast: '雪が降ってきた', icon: 'snow',
        clouds: { coverage: 0.9, softness: 0.25, erode: 0.2, overcast: 0.9, cirrus: 0,
          lit: '#d6d4dc', shade: '#8a8c98', ov: '#a4a6b0', cir: '#bbbbbb', hazeDist: 6000 },
        bgMul: 0.55, sunMul: 0.25, hemiMul: 0.9, exposure: 0.97, sun: '#dcdce6', fog: '#b4b6be', fogMul: 0.55, farMul: 1, envMul: 0.5,
        rain: 0, snow: 1, wet: 0.2, wind: 5, lightningPerMin: 0, vis: 0.75, skyRefl: 0.5, glint: 0.2 }
    }
  };
  // 状態の表に無いキー
  const STATE_DEFAULT = {
    weight: 0, minSlots: 1, maxSlots: 0, next: null, name: '', toast: '', icon: '',
    clouds: { coverage: 0, softness: 0.1, erode: 0.3, overcast: 0, cirrus: 0, lit: '#ffffff', shade: '#888888', ov: '#888888', cir: '#ffffff',
      haze: null, hazeDist: 22000 },
    bgMul: 1, sunMul: 1, hemiMul: 1, exposure: 1, envMul: 1, sun: null, fog: null, fogMul: 1, farMul: 1,
    rain: 0, snow: 0, wet: 0, wind: 4, lightningPerMin: 0, vis: 1, skyRefl: 1, glint: 1
  };

  // ---------- 設定のマージ（オブジェクトは深く、配列と next は丸ごと置き換え）----------
  const REPLACE = { next: true };
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return isObj(v) ? merge(v, null) : (Array.isArray(v) ? v.slice() : v); }
  function merge(base, over) {
    const out = {};
    if (base) for (const k in base) out[k] = clone(base[k]);
    if (over) for (const k in over) {
      const v = over[k];
      if (v === undefined) continue;
      out[k] = (isObj(v) && isObj(out[k]) && !REPLACE[k]) ? merge(out[k], v) : clone(v);
    }
    return out;
  }

  // ---------- 状態の表 → 数の並び（Float64Array）。色は「色 × 重み」と重み（無し = 0）----------
  const SCAL = [
    ['cov', 'clouds', 'coverage'], ['soft', 'clouds', 'softness'], ['erode', 'clouds', 'erode'], ['over', 'clouds', 'overcast'],
    ['cirrus', 'clouds', 'cirrus'], ['hazeDist', 'clouds', 'hazeDist'],
    ['bgMul', null, 'bgMul'], ['sunMul', null, 'sunMul'], ['hemiMul', null, 'hemiMul'], ['exposure', null, 'exposure'], ['envMul', null, 'envMul'],
    ['fogMul', null, 'fogMul'], ['farMul', null, 'farMul'], ['rain', null, 'rain'], ['snow', null, 'snow'], ['wetTarget', null, 'wet'],
    ['windBase', null, 'wind'], ['lightningPerMin', null, 'lightningPerMin'], ['vis', null, 'vis'], ['skyRefl', null, 'skyRefl'], ['glint', null, 'glint']
  ];
  const COLS = [['lit', 'clouds', 'lit'], ['shade', 'clouds', 'shade'], ['ov', 'clouds', 'ov'], ['cir', 'clouds', 'cir']];
  const OPTC = [['haze', 'hasHaze', 'clouds', 'haze'], ['fog', 'hasFog', null, 'fog'], ['sunCol', 'hasSun', null, 'sun']];
  const IX = {};
  let NV = 0;
  for (const f of SCAL) IX[f[0]] = NV++;
  for (const f of COLS) { IX[f[0]] = NV; NV += 3; }
  for (const f of OPTC) { IX[f[0]] = NV; NV += 3; IX[f[1]] = NV++; }

  function compileState(st, warn) {
    const v = new Float64Array(NV);
    const get = (grp, key) => {
      const src = grp ? (st[grp] || {}) : st;
      const def = grp ? STATE_DEFAULT[grp] : STATE_DEFAULT;
      return src[key] !== undefined ? src[key] : def[key];
    };
    for (const f of SCAL) {
      const x = Number(get(f[1], f[2]));
      v[IX[f[0]]] = isFinite(x) ? x : 0;
      if (!isFinite(x)) warn(f[2] + ' is not a number');
    }
    for (const f of COLS) {
      const hex = get(f[1], f[2]);
      if (!hexLin(hex, v, IX[f[0]])) { warn(f[2] + ': bad colour ' + hex); v[IX[f[0]]] = v[IX[f[0]] + 1] = v[IX[f[0]] + 2] = 1; }
    }
    for (const f of OPTC) {
      const hex = get(f[2], f[3]);
      const o = IX[f[0]];
      if (hex === null || hex === undefined || hex === '') { v[o] = v[o + 1] = v[o + 2] = 0; v[IX[f[1]]] = 0; continue; }
      if (!hexLin(hex, v, o)) { warn(f[3] + ': bad colour ' + hex); v[o] = v[o + 1] = v[o + 2] = 0; v[IX[f[1]]] = 0; continue; }
      v[IX[f[1]]] = 1;
    }
    return v;
  }
  // 2 つの状態の混ぜ方: out = a × (1 − b) + c × b（b = 0 で a、b = 1 で c にぴったり）。毎フレームの道（_schedVec / update）に直接書いてある

  // p はプロパティを全部書いたリテラル（V8 / JSC の速いオブジェクトのまま = 毎フレームの数の書き込みで箱を作らない）
  function makeParams() {
    return {
      id: '', prevId: '', blend: 1, k: 0, age: 0, t: 0, changed: false, jumped: true,
      cov: 0, soft: 0, erode: 0, over: 0, cirrus: 0, hazeDist: 0,
      bgMul: 1, sunMul: 1, hemiMul: 1, exposure: 1, envMul: 1, fogMul: 1, farMul: 1,
      rain: 0, snow: 0, wetTarget: 0, windBase: 0, lightningPerMin: 0, vis: 1, skyRefl: 1, glint: 1,
      // 色の配列は小数で作る（double の配列のまま = 書き込みで種類が変わらない）
      lit: [0.5, 0.5, 0.5], shade: [0.5, 0.5, 0.5], ov: [0.5, 0.5, 0.5], cir: [0.5, 0.5, 0.5],
      haze: [0.5, 0.5, 0.5], hasHaze: 0, fog: [0.5, 0.5, 0.5], hasFog: 0, sunCol: [0.5, 0.5, 0.5], hasSun: 0,
      hazeDense: 0, windDir: 0, gust: 1, wind: 0, windX: 0, windZ: 0
    };
  }

  class Weather {
    // cfg = game.json の weather、levelCfg = Weather.levelConfig(cfg, levelId)（省略で levelDefaults）、
    // opts: { seed（32 bit）, force（最初から決めた状態）, cycle（true = 見本の巡回）}
    constructor(cfg, levelCfg, opts) {
      opts = opts || {};
      const c = this.cfg = Weather.mergeConfig(cfg);
      this.level = merge(c.levelDefaults, levelCfg || null);
      this.seed = (Number(opts.seed) >>> 0);
      this.cycle = !!opts.cycle;
      this.slotSec = Math.max(1, this.cycle ? c.cycleSlotSec : c.slotSec);
      this.T = Math.max(0, Math.min(c.transitionSec, this.slotSec * 0.5));
      this.resetP = clamp(Number(c.resetP) || 0, 0, 0.999);
      this.cap = Math.max(1, Math.floor(c.resetScanCap) || 1);
      this.warnings = [];
      const warn = (id) => (m) => this.warnings.push(id + ': ' + m);
      // 状態
      this.ids = Object.keys(c.states);
      const N = this.ids.length;
      this.vecs = this.ids.map((id) => compileState(merge(STATE_DEFAULT, c.states[id]), warn(id)));
      this.weight = this.ids.map((id) => Math.max(0, Number(c.states[id].weight) || 0));
      this.minSlots = this.ids.map((id) => Math.max(1, Math.floor(c.states[id].minSlots || 1)));
      this.maxSlots = this.ids.map((id) => Math.max(0, Math.floor(c.states[id].maxSlots || 0)));
      this.sched = [];
      for (let i = 0; i < N; i++) if (this.weight[i] > 0) this.sched.push(i);
      let hub = this.ids.indexOf(c.hub);
      if (hub < 0 || this.weight[hub] <= 0) { hub = this.sched.length ? this.sched[0] : 0; if (N) this.warnings.push('hub ' + c.hub + ' is not scheduled; using ' + this.ids[hub]); }
      this.hub = hub;
      this.nextW = this.ids.map((id) => {
        const nx = c.states[id].next;
        const w = new Float64Array(N);
        for (let t = 0; t < N; t++) {
          if (this.weight[t] <= 0) continue;
          const x = isObj(nx) ? Number(nx[this.ids[t]]) || 0 : this.weight[t];
          w[t] = Math.max(0, x);
        }
        return w;
      });
      let lpm = 0;
      for (const v of this.vecs) lpm = Math.max(lpm, v[IX.lightningPerMin]);
      this.lpmMax = lpm;
      this._candMax = Math.ceil(lpm / 60 * this.slotSec * 4 + 32);
      // 風
      const W = c.wind;
      this._dirAmp = Number(W.dirAmpDeg) || 0;
      // ノイズの傾きは 1 単位あたり最大 3 → 周期（分）= 3 × 振れ幅 / 1 分あたりの変化
      this._dirPeriodMin = this._dirAmp > 0 && W.dirDriftDegPerMin > 0 ? 3 * this._dirAmp / W.dirDriftDegPerMin : 1;
      this._dir0 = Number(this.level.windDir) || 0;
      this._gustAmp = Number(W.gustAmp) || 0;
      this._gustPeriod = W.gustPeriod > 0 ? Number(W.gustPeriod) : 1;
      this._denseK = 1 / Math.max(1e-6, 1 - Number(c.haze.denseFrom));   // hazeDense = smoothstep((1 − min(fogMul, farMul)) × これ)
      // 値ノイズの格子のキャッシュ（_wind）
      this._dI = NaN; this._dA = 0; this._dB = 0; this._gI = NaN; this._gA = 0; this._gB = 0;
      // 状態
      this.p = makeParams();
      const p = this.p;
      this._cols = [p.lit, p.shade, p.ov, p.cir];
      this._colIx = new Int32Array(COLS.map((f) => IX[f[0]]));
      this._opts = [p.haze, p.fog, p.sunCol];
      this._optIx = new Int32Array(OPTC.map((f) => IX[f[0]]));
      this._optW = new Int32Array(OPTC.map((f) => IX[f[1]]));
      this.stats = { scans: 0, maxScan: 0, steps: 0, dropped: 0 };
      this._vec = new Float64Array(NV);
      this._sw = new Float64Array(2);   // 雷の区間（_strikes）
      this._bS = 1;
      this._ovFrom = new Float64Array(NV);
      this._k = NaN; this._sP = hub; this._aP = 0; this._sC = hub; this._aC = 0;
      this._ns = 0; this._na = 0;
      // 時刻は数のまま持つ（null を入れると数を書くたびに箱を作る）。_has = 1 回でも update したか
      this._has = false; this._t = 0; this._prevT = 0; this._lastId = null;
      this._ov = false; this._ovTo = -1; this._ovHasT0 = false; this._ovT0 = 0; this._ovInstant = false; this._ovFromId = ''; this._jumpNext = false;
      this._up = [];
      this._st = { cur: '', prev: '', k: 0, blend: 1, age: 0, reset: false };
      if (opts.force) this.force(opts.force, { instant: true });
    }

    // ---------- 予定 ----------
    _isReset(k) {
      const m = k - Math.floor(k / this.cap) * this.cap;
      return m === 0 || h01(this.seed, k, SALT.u) < this.resetP;
    }
    // (s, a) の次の枠 k → this._ns / this._na
    _step(s, a, k) {
      this.stats.steps++;
      if (this._isReset(k)) { this._ns = this.hub; this._na = 0; return; }
      const run = a + 1;
      if (run < this.minSlots[s]) { this._ns = s; this._na = run; return; }
      const w = this.nextW[s];
      const N = w.length;
      const selfW = (this.maxSlots[s] > 0 && run >= this.maxSlots[s]) ? 0 : w[s];
      let total = 0;
      for (let t = 0; t < N; t++) total += t === s ? selfW : w[t];
      if (!(total > 0)) {
        if (s === this.hub) { this._ns = s; this._na = run; } else { this._ns = this.hub; this._na = 0; }
        return;
      }
      const u = h01(this.seed, k, SALT.u);
      let x = (u - this.resetP) / (1 - this.resetP) * total;
      let pick = -1, last = -1;
      for (let t = 0; t < N; t++) {
        const wt = t === s ? selfW : w[t];
        if (wt <= 0) continue;
        last = t;
        if (x < wt) { pick = t; break; }
        x -= wt;
      }
      if (pick < 0) pick = last;
      if (pick === s) { this._ns = s; this._na = run; } else { this._ns = pick; this._na = 0; }
    }
    // cycle の枠 k の状態（矢印関数を使わない: this を捕まえると呼ぶたびにコンテキストを作る）
    _cycleAt(k) {
      const L = this.sched.length;
      return L ? this.sched[((k % L) + L) % L] : this.hub;
    }
    // 枠 k とその前の枠の状態をそろえる（同じ k なら何もしない、1 つ進んだなら 1 歩、ほかはリセットからさかのぼる）
    _ensure(k) {
      if (k === this._k || !isFinite(k)) return;
      if (this.cycle) {
        this._sP = this._cycleAt(k - 1); this._sC = this._cycleAt(k); this._aP = 0; this._aC = this._sP === this._sC ? 1 : 0;
        this._k = k; return;
      }
      if (k === this._k + 1) {
        this._sP = this._sC; this._aP = this._aC;
        this._step(this._sC, this._aC, k);
        this._sC = this._ns; this._aC = this._na;
        this._k = k; return;
      }
      // k − 1 からさかのぼっていちばん近いリセットを探す（resetScanCap の倍数の枠は必ずリセット）
      let j = k - 1;
      while (j > k - this.cap && !this._isReset(j)) j--;
      const scan = k - j;
      this.stats.scans++;
      if (scan > this.stats.maxScan) this.stats.maxScan = scan;
      let s = this.hub, a = 0;
      for (let i = j + 1; i <= k - 1; i++) { this._step(s, a, i); s = this._ns; a = this._na; }
      this._sP = s; this._aP = a;
      this._step(s, a, k);
      this._sC = this._ns; this._aC = this._na;
      this._k = k;
    }
    // 予定だけの値（force は入らない）を this._vec へ、混ぜ具合を this._bS へ（小数を引数・戻り値で渡さない: inline されない V8 の
    //   境目で箱になる。smooth01 / lerpVec と同じ式をここに書く = 同じ値）
    _schedVec(t) {
      const S = this.slotSec;
      const k = Math.floor(t / S);
      this._ensure(k);
      let b = 1;
      if (this._sP !== this._sC && this.T > 0) {
        let x = (t - k * S) / this.T;
        x = x < 0 ? 0 : (x > 1 ? 1 : x);
        b = x * x * (3 - 2 * x);
      }
      const out = this._vec, a = this.vecs[this._sP], c = this.vecs[this._sC], ib = 1 - b;
      for (let i = 0; i < NV; i++) out[i] = a[i] * ib + c[i] * b;
      this._bS = b;
    }
    // 1 つの値だけ（雷の間引き用）。force も入る。状態は変えない（キャッシュは動く）
    _compAt(t, ix) {
      const S = this.slotSec;
      const k = Math.floor(t / S);
      this._ensure(k);
      let b = 1;
      if (this._sP !== this._sC) b = this.T > 0 ? smooth01((t - k * S) / this.T) : 1;
      let x = this.vecs[this._sP][ix] * (1 - b) + this.vecs[this._sC][ix] * b;
      if (this._ov) {
        const s = this._ovInstant ? 1 : (!this._ovHasT0 ? 0 : (this.T > 0 ? smooth01((t - this._ovT0) / this.T) : 1));
        const to = this._ovTo >= 0 ? this.vecs[this._ovTo][ix] : x;
        x = this._ovFrom[ix] * (1 - s) + to * s;
      }
      return x;
    }

    // 予定の状態（force は入らない）。戻り値は毎回同じオブジェクト
    stateAt(t) {
      if (!(Math.abs(t) <= MAX_T)) t = this._has ? this._t : 0;   // 壊れた時計
      const S = this.slotSec;
      const k = Math.floor(t / S);
      this._ensure(k);
      const st = this._st;
      st.k = k; st.cur = this.ids[this._sC]; st.prev = this.ids[this._sP]; st.age = this._aC;
      st.reset = !this.cycle && this._isReset(k);
      st.blend = this._sP === this._sC ? 1 : (this.T > 0 ? smooth01((t - k * S) / this.T) : 1);
      return st;
    }

    // 次の n 枠の状態の id（今の枠は入らない）。force 中はその状態。out 省略で内部の配列（次の呼び出しで書き換わる）
    upcoming(t, n, out) {
      out = out || this._up;
      out.length = n;
      if (!(Math.abs(t) <= MAX_T)) t = this._has ? this._t : 0;   // 壊れた時計
      if (this._ov && this._ovTo >= 0) { for (let i = 0; i < n; i++) out[i] = this.ids[this._ovTo]; return out; }
      const k = Math.floor(t / this.slotSec);
      this._ensure(k);
      if (this.cycle) {
        for (let i = 0; i < n; i++) out[i] = this.ids[this._cycleAt(k + 1 + i)];
        return out;
      }
      let s = this._sC, a = this._aC;
      for (let i = 0; i < n; i++) { this._step(s, a, k + 1 + i); s = this._ns; a = this._na; out[i] = this.ids[s]; }
      return out;
    }

    // ---------- 毎フレーム ----------
    // t = 天気の時計（秒）。jumped = 時計が飛んだ（オンラインの Clock.jumped）。戻り値 p（毎回同じオブジェクト）
    update(t, jumped) {
      if (!isFinite(t) || Math.abs(t) > MAX_T) return this.p;   // 壊れた時計は無視（前の値のまま）
      const jump = !this._has || !!jumped || this._jumpNext || !(t >= this._t) || (t - this._t) > this.cfg.jumpSec;
      this._has = true;
      this._jumpNext = false;
      if (jump) this._prevT = t; else this._prevT = this._t;
      this._t = t;
      if (this._ov && !this._ovHasT0) { this._ovT0 = t; this._ovHasT0 = true; }
      const p = this.p;
      const out = this._vec;
      this._schedVec(t);
      p.k = this._k; p.age = this._aC;
      p.id = this.ids[this._sC]; p.prevId = this.ids[this._sP]; p.blend = this._bS;
      if (this._ov) {
        let s = 1;
        if (!this._ovInstant && this.T > 0) { let x = (t - this._ovT0) / this.T; x = x < 0 ? 0 : (x > 1 ? 1 : x); s = x * x * (3 - 2 * x); }
        const a = this._ovFrom, c = this._ovTo >= 0 ? this.vecs[this._ovTo] : out, is = 1 - s;
        for (let i = 0; i < NV; i++) out[i] = a[i] * is + c[i] * s;
        if (this._ovTo >= 0) p.id = this.ids[this._ovTo];
        else if (s >= 1) this._ov = false;
        p.prevId = this._ovFromId; p.blend = s;
      }
      this._finalize();
      this._wind();
      p.changed = !jump && this._lastId !== null && p.id !== this._lastId;
      p.jumped = jump;
      this._lastId = p.id;
      return p;
    }

    // _vec → p（時刻は this._t。数を引数で渡さない = V8 で箱を作らない）
    _finalize() {
      const p = this.p, v = this._vec, X = IX;
      p.t = this._t;
      p.cov = v[X.cov]; p.soft = v[X.soft]; p.erode = v[X.erode]; p.over = v[X.over]; p.cirrus = v[X.cirrus]; p.hazeDist = v[X.hazeDist];
      p.bgMul = v[X.bgMul]; p.sunMul = v[X.sunMul]; p.hemiMul = v[X.hemiMul]; p.exposure = v[X.exposure]; p.envMul = v[X.envMul];
      p.fogMul = v[X.fogMul]; p.farMul = v[X.farMul]; p.rain = v[X.rain]; p.snow = v[X.snow]; p.wetTarget = v[X.wetTarget];
      p.windBase = v[X.windBase]; p.lightningPerMin = v[X.lightningPerMin]; p.vis = v[X.vis]; p.skyRefl = v[X.skyRefl]; p.glint = v[X.glint];
      const C = this._cols, CI = this._colIx;
      for (let j = 0; j < 4; j++) { const a = C[j], o = CI[j]; a[0] = v[o]; a[1] = v[o + 1]; a[2] = v[o + 2]; }
      // 「色 × 重み」→ 色（重み 0 なら 0）
      const O = this._opts, OI = this._optIx, OW = this._optW;
      for (let j = 0; j < 3; j++) {
        const a = O[j], o = OI[j], w = v[OW[j]];
        if (w > 1e-9) { a[0] = v[o] / w; a[1] = v[o + 1] / w; a[2] = v[o + 2] / w; } else { a[0] = 0; a[1] = 0; a[2] = 0; }
      }
      p.hasHaze = Math.min(1, Math.max(0, v[X.hasHaze]));
      p.hasFog = Math.min(1, Math.max(0, v[X.hasFog]));
      p.hasSun = Math.min(1, Math.max(0, v[X.hasSun]));
      // 霧が濃いときの地平線の霞
      const x = Math.min(1, Math.max(0, (1 - Math.min(p.fogMul, p.farMul)) * this._denseK));
      p.hazeDense = x * x * (3 - 2 * x);
    }
    // 風（t の関数。どの端末も同じ）。1 次元の値ノイズ（格子の点ごとにハッシュの −1..1、間は smoothstep。傾きは 1 単位あたり最大 3）:
    //   向き = windDir + dirAmpDeg × noise(t / 60 / 周期)（周期（分）= 3 × dirAmpDeg / dirDriftDegPerMin → 1 分に dirDriftDegPerMin 度まで）、
    //   速さ = 状態の wind × (1 + gustAmp × noise(t / gustPeriod))。格子の 2 点は格子が変わった時だけハッシュする（毎フレームは足し算だけ）
    _wind() {
      const p = this.p, t = this._t;
      const xd = t / (60 * this._dirPeriodMin);
      const id = Math.floor(xd);
      if (id !== this._dI) { this._dI = id; this._dA = h01(this.seed, id, SALT.dir) * 2 - 1; this._dB = h01(this.seed, id + 1, SALT.dir) * 2 - 1; }
      let f = xd - id;
      let dir = this._dir0 + this._dirAmp * (this._dA + (this._dB - this._dA) * f * f * (3 - 2 * f));
      dir -= Math.floor(dir / 360) * 360;
      const xg = t / this._gustPeriod;
      const ig = Math.floor(xg);
      if (ig !== this._gI) { this._gI = ig; this._gA = h01(this.seed, ig, SALT.gust) * 2 - 1; this._gB = h01(this.seed, ig + 1, SALT.gust) * 2 - 1; }
      f = xg - ig;
      const gust = 1 + this._gustAmp * (this._gA + (this._gB - this._gA) * f * f * (3 - 2 * f));
      const sp = p.windBase * gust;
      const r = dir * Math.PI / 180;
      p.windDir = dir; p.gust = gust; p.wind = sp;
      p.windX = -Math.sin(r) * sp; p.windZ = Math.cos(r) * sp;   // 吹いてくる方位の反対へ（北 = −Z、東 = +X）
    }

    // 今の値から T 秒でその状態へ（null = 予定に戻る）。instant: すぐ（次の update は飛んだ扱い = 知らせ無し）
    force(id, opts) {
      let instant = !!(opts && opts.instant);
      let to = -1;
      if (id !== null && id !== undefined) { to = this.ids.indexOf(id); if (to < 0) return false; }
      if (!this._has) instant = true;
      this._ovFrom.set(this._vec);
      this._ovFromId = this.p.id;
      this._ov = true; this._ovTo = to; this._ovT0 = this._t; this._ovHasT0 = this._has; this._ovInstant = instant;
      if (instant) this._jumpNext = true;
      return true;
    }
    get forced() { return this._ov && this._ovTo >= 0 ? this.ids[this._ovTo] : null; }

    // ---------- 雷 ----------
    // (t0, t1] の落雷を out へ（時刻の順）。戻り値 = 数（lightning.queue と out.length まで）
    strikesBetween(t0, t1, out) {
      this._sw[0] = t0; this._sw[1] = t1;
      return this._strikes(out);
    }
    // 区間は this._sw（Float64Array: 0 = t0、1 = t1）から読む（小数を引数で渡さない = V8 が inline しない境目で箱を作らない。
    //   strikesSinceLast は毎フレーム呼ばれる）
    _strikes(out) {
      const L = this.cfg.lightning, t0 = this._sw[0], t1 = this._sw[1];
      if (!(t1 >= t0) || t1 - t0 > L.maxGap || !(this.lpmMax > 0) || !(Math.abs(t0) <= MAX_T) || !(Math.abs(t1) <= MAX_T)) return 0;
      const cap = Math.min(L.queue, out ? out.length : 0);
      const S = this.slotSec, lam = this.lpmMax / 60, seed = this.seed;
      let n = 0;
      const k0 = Math.floor(t0 / S), k1 = Math.floor(t1 / S);
      for (let k = k0; k <= k1; k++) {
        let tc = k * S;
        const end = tc + S;
        for (let i = 0; i < this._candMax; i++) {
          tc += -Math.log(1 - h01i(seed, k, i, SALT.gap)) / lam;
          if (tc >= end || tc > t1) break;
          if (tc <= t0) continue;
          if (h01i(seed, k, i, SALT.acc) * this.lpmMax >= this._compAt(tc, IX.lightningPerMin)) continue;
          if (n >= cap) { this.stats.dropped++; continue; }
          const o = out[n++];
          o.t = tc; o.k = k; o.i = i;
          o.bearing = h01i(seed, k, i, SALT.bear) * Math.PI * 2;
          const ud = h01i(seed, k, i, SALT.dist);
          o.dist = h01i(seed, k, i, SALT.near) < L.nearShare ? L.minDist + (L.near - L.minDist) * ud : L.near + (L.maxDist - L.near) * ud;
          o.near = o.dist < L.near;
          o.col = o.dist >= L.inCloudFrom ? 3 : Math.min(2, Math.floor(h01i(seed, k, i, SALT.col) * 3));
          o.dbl = h01i(seed, k, i, SALT.dbl) < L.doubleChance;
          o.flashMs = L.flashMs[0] + (L.flashMs[1] - L.flashMs[0]) * h01i(seed, k, i, SALT.flash);
          o.thunderAt = tc + o.dist / L.sound;
        }
      }
      return n;
    }
    // 最後の update の区間（飛んだフレームは 0）
    strikesSinceLast(out) {
      if (!this._has || this.p.jumped) return 0;
      this._sw[0] = this._prevT; this._sw[1] = this._t;
      return this._strikes(out);
    }

    // ---------- static ----------
    static mergeConfig(cfg) { return merge(DEFAULTS, cfg || null); }
    static hash(str) { return fmix(strHash(str)); }
    static hash01(seed, k, salt) { return h01(seed >>> 0, k, salt || 0); }
    static strikeBuffer(n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ t: 0, k: 0, i: 0, bearing: 0, dist: 0, near: false, col: 0, dbl: false, flashMs: 0, thunderAt: 0 });
      return a;
    }
    // '?weather=rain' など → 'off' | 'cycle' | 状態の id | null（無い・知らない値・予定に入っていない状態 = weight 0 / まだ作っていない雪など）
    static parseUrl(search, cfg) {
      const m = /[?&]weather=([^&#]*)/i.exec(String(search || ''));
      if (!m) return null;
      let v = '';
      try { v = decodeURIComponent(m[1]); } catch (e) { return null; }
      v = v.trim().toLowerCase();
      if (v === 'off' || v === 'cycle') return v;
      const states = cfg ? Weather.mergeConfig(cfg).states : DEFAULTS.states;
      return Object.prototype.hasOwnProperty.call(states, v) && Number(states[v].weight) > 0 ? v : null;
    }
    // 変わった知らせの文（hud）: 行き先の状態の toastFrom[前の状態]（「雨がやんだ」「霧が晴れてきた」「雷がおさまった」）> toast（「曇ってきた」）。
    //   cfg はマージ済み（weather.cfg）でも game.json の weather でもよい
    static toastText(cfg, from, to) {
      const st = cfg && cfg.states ? cfg.states[to] : null;
      if (!st) return '';
      const tf = st.toastFrom;
      if (from && from !== to && isObj(tf) && typeof tf[from] === 'string' && tf[from]) return tf[from];
      return st.toast || '';
    }
    // レベルごとの値（levelDefaults + levels[id]）。enabled: 'city' は isCity（省略 = 街として true）
    static levelConfig(cfg, id, isCity) {
      const c = Weather.mergeConfig(cfg);
      const lc = merge(c.levelDefaults, (c.levels && id != null && isObj(c.levels[id])) ? c.levels[id] : null);
      lc.enabled = lc.enabled === 'city' ? (isCity === undefined ? true : !!isCity) : lc.enabled !== false;
      lc.id = id == null ? null : id;
      return lc;
    }
    static enabledFor(cfg, id, isCity) {
      const c = Weather.mergeConfig(cfg);
      return c.enabled !== false && Weather.levelConfig(c, id, isCity).enabled;
    }
    // ソロの時計のずらし（seed ごと）。startState が状態の id なら、その状態が混ざり終わった時刻から始める
    static soloOffset(cfg, seed, startState) {
      const c = Weather.mergeConfig(cfg);
      const base = h01(seed >>> 0, 0, SALT.off) * (Number(c.solo.offsetSpan) || 0);
      const st = startState || c.solo.startState;
      if (!st || st === 'auto') return base;
      const w = new Weather(c, null, { seed });
      const idx = w.ids.indexOf(st);
      if (idx < 0 || w.weight[idx] <= 0) return base;
      let k = Math.floor(base / w.slotSec);
      for (let n = 0; n < 4096; n++, k++) {
        w._ensure(k);
        if (w._sC === idx) return k * w.slotSec + w.T;
      }
      return base;
    }
    // 予定の割合（(状態, age) の連鎖の定常分布。resetScanCap の倍数のリセットは入れない = 1 / resetScanCap 程度の差）
    static stationary(cfg) {
      const w = new Weather(cfg, null, { seed: 1 });
      const N = w.ids.length;
      const A = [];
      const base = [];
      let M = 0;
      for (let s = 0; s < N; s++) {
        A.push(Math.max(1, w.minSlots[s], w.maxSlots[s] || 0));
        base.push(M); M += A[s];
      }
      const node = (s, a) => base[s] + Math.min(a, A[s] - 1);
      // 遷移: [from, to, prob]
      const tr = [];
      const r = w.resetP;
      for (let s = 0; s < N; s++) for (let a = 0; a < A[s]; a++) {
        const from = node(s, a);
        if (r > 0) tr.push([from, node(w.hub, 0), r]);
        const run = a + 1;
        if (run < w.minSlots[s]) { tr.push([from, node(s, run), 1 - r]); continue; }
        const wt = w.nextW[s];
        const selfW = (w.maxSlots[s] > 0 && run >= w.maxSlots[s]) ? 0 : wt[s];
        let tot = 0;
        for (let t = 0; t < N; t++) tot += t === s ? selfW : wt[t];
        if (!(tot > 0)) { tr.push([from, s === w.hub ? node(s, run) : node(w.hub, 0), 1 - r]); continue; }
        for (let t = 0; t < N; t++) {
          const x = t === s ? selfW : wt[t];
          if (x > 0) tr.push([from, t === s ? node(s, run) : node(t, 0), (1 - r) * x / tot]);
        }
      }
      let pi = new Float64Array(M).fill(0);
      // 予定される状態から始める
      for (const s of w.sched) pi[node(s, 0)] = 1 / w.sched.length;
      if (!w.sched.length) pi[node(w.hub, 0)] = 1;
      let it = 0;
      for (; it < 100000; it++) {
        const nx = new Float64Array(M);
        for (const e of tr) nx[e[1]] += pi[e[0]] * e[2];
        let d = 0;
        for (let i = 0; i < M; i++) d += Math.abs(nx[i] - pi[i]);
        pi = nx;
        if (d < 1e-14) break;
      }
      const shares = {};
      for (let s = 0; s < N; s++) {
        let x = 0;
        for (let a = 0; a < A[s]; a++) x += pi[base[s] + a];
        shares[w.ids[s]] = x;
      }
      Object.defineProperty(shares, 'iterations', { value: it, enumerable: false });
      return shares;
    }
  }

  // ---------- オンラインの時計（M5）: serverNow（秒）へ滑らかに寄せる ----------
  //   step(dt, serverSec): 予測（t + dt）とのずれ err が clockSnap 秒を超えたら飛ぶ（jumped = true）。ほかは
  //   t += dt × (1 + clamp(err × clockSlew, −0.5, 0.5))（戻らない・速さは 0.5〜1.5 倍）。最初の 1 回も飛んだ扱い
  class Clock {
    constructor(onlineCfg) {
      const o = merge(DEFAULTS.online, onlineCfg || null);
      this.slew = Number(o.clockSlew) || 0;
      this.snap = Number(o.clockSnap) > 0 ? Number(o.clockSnap) : 30;
      this.started = false; this.t = 0; this.jumped = true; this.rate = 1; this.err = 0;
    }
    step(dt, serverSec) {
      if (!this.started || !isFinite(this.t)) { this.started = true; this.t = serverSec; this.jumped = true; this.rate = 1; this.err = 0; return this.t; }
      dt = dt > 0 ? dt : 0;
      const err = serverSec - (this.t + dt);
      this.err = err;
      if (!(Math.abs(err) <= this.snap)) { this.t = serverSec; this.jumped = true; this.rate = 1; return this.t; }
      this.rate = 1 + clamp(err * this.slew, -0.5, 0.5);
      this.t += dt * this.rate;
      this.jumped = false;
      return this.t;
    }
  }

  Weather.Clock = Clock;
  Weather.DEFAULTS = DEFAULTS;
  Weather.STATE_DEFAULT = STATE_DEFAULT;
  Weather.FIELDS = { scalars: SCAL.map((f) => f[0]), colours: COLS.map((f) => f[0]), optional: OPTC.map((f) => [f[0], f[1]]) };
  Weather.hexToLinear = function (hex) { const a = [0, 0, 0]; return hexLin(hex, a, 0) ? a : null; };
  MR.Weather = Weather;
  if (typeof module !== 'undefined' && module.exports) module.exports = Weather;
})(typeof window !== 'undefined' ? window : globalThis);
