// 墜落の火災の決まり（MR.Burn）。THREE / DOM を使わない（Node・サーバーも require できる。netproto.js / explosive.js と同じ UMD）。
//   ゲームの事実（爆風・火の続く秒・地面の火の場所と高さ・壁の火・誘爆・滑る道・残骸の落ち方）だけをここで決める。見た目は crashfx.js（MR.Crashes）。
//   乱数は seed からの mulberry32 だけ（Math.random は使わない）: 同じ seed・spec・cfg・world なら同じ plan（D5。オンラインはサーバーの plan が正）。
//
//   classify(info) → 'water' | 'ground' | 'roof' | 'wall' | 'deck' | 'air'
//     info: { y（墜落の点の高さ）, support（足元の立てる面の高さ | null）, ground（地形 = 道の高さ | null。無ければ support）, water（水面 | null）,
//             box（当たった箱 [x0,y0,z0,x1,y1,z1] | null）, ny（当たった面の法線の y。任意）, deck（空母の甲板の上 = true）, airAgl, roofMin（任意）}
//     順: 甲板 → 箱に当たった（上の面 = 屋上 / 地面、横 = 壁）→ 足元が無く水 → 足元より airAgl m 上 = 空中 → 足元が地形より roofMin m 上 = 屋上 → 地面
//   plan(seed, spec, cfg, world, out) → out（使い回し。無ければ作る）
//     spec: { kind: 'jet'|'heli'|'car'|'missile', stage: 'ground'|'air'|'land', x,y,z, vx,vy,vz, surface（classify の値）, box?: [x0,y0,z0,x1,y1,z1], slide?: true }
//     cfg: game.json の fire（+ 任意の blasts = explosives.blasts。fire.blast[kind] が名前ならそこから { r: radius, dmg: damage }）
//     world: { support(x, z, yRef) → y | null, water(x, z) → 水面 | null, ray(ox,oy,oz, dx,dy,dz, len) → 当たった距離 | -1（任意: 滑る道）}
//     out: { kind, stage, surface, seed, x,y,z, blast: { r, dmg } | null, fireSec, steam, patches: [[x,y,z, r0,r1, t0,t1], …],
//            facade: [x,y,z, nx,nz, t1] | null, secondaries: [[t, x,y,z, r, dmg], …], slide: { x0,z0, x1,z1, sec } | null, debris, scorch: [x,y,z,r] | null }
//     段（D5）: ground = 面の上で爆発（爆風・火・地面の火・壁の火・誘爆・焦げ・破片。水なら湯気だけ）、
//              air = 空中で撃墜（爆風と火の玉・落ちる残骸の火 fireSec。地面の火・壁・誘爆・焦げは無し）、
//              land = air の残骸が落ちた所（爆風なし = 今まで通り。地面の火・壁の火・誘爆・焦げ・湯気はここで決める）
//     地面の火の高さは world.support で決めた値（クライアントとサーバーは自分の world で作る。オンラインはサーバーの plan を送る）。
//     足元が無い・水・墜落の面から maxStep m より上下にずれた所（屋上の縁の外など）の火は作らない。
//     壁の火（facade）: 壁（surface wall）に当たった高い箱（上面 ≥ facade.minBoxTop）の一番近い面、または屋上（roof）で当たった箱の横の面まで
//     facade.edge m 以内（屋上の縁）ならその面の上の端（上面 − facade.edgeDrop m）。
//   cull(plan, keepOut, r) → 消した数。keepOut = [[x, z], …] か [{ x, z }, …] の r m（既定 cfg.patch.keepOut = 6）以内の地面の火を消す
//     （サーバー: スポーン地点、ソロ: 空母の駐機場所）
//   new Field(cfg)（地面の火の記録）: add(plan, by, gen) / addPatch(x,y,z, r0,r1, t0,t1, by, grow, gen) は今の時刻 t からの相対時刻
//     （gen = 連鎖の段: 墜落 0、地面の火で壊れた車の火 1、…。gen ≥ chainMax の火は乗り物を焼かない = 連鎖は chainMax 台まで）、caps.patches を超えたら
//     一番早く消えるものを外す。radius(rec) / state(rec) = 'wait'|'grow'|'burn'|'shrink'|'out'。
//     tick(dt, eachTarget, out) → n: tick 秒ごとに、eachTarget(visit) が visit(t) で渡す目標（{ obj, cls, x, y, z } を使い回してよい）のうち
//     火の輪の中（xz の距離 ≤ 半径・|Δy| < patch.dy）のものに out[i] = { target, cls, dmg, by, gen }（1 つの目標は 1 tick に 1 回。乗り物は vehicleDps）。
//     記録の ft / et / st は見た目（crashfx.js）の板のタイマー（ここでは 0 にするだけ）。
//     消えた記録は外す（配列・記録は使い回す）。clear()。
//   slidePath(p, v, cfg, hit) → { x0,z0, x1,z1, sec } | null: 浅い角（≤ slide.maxAngle°）で minSpeed m/s 以上なら、decel で stopSpeed まで（maxSec まで）
//     滑る道。hit(x0,z0, x1,z1) → 0..1（当たるまでの割合）か 1 以上・負 = 当たらない（任意）。
//   wreckFall(p0, v0, t, out, o) → out [x,y,z, vx,vy,vz]: 撃墜された残骸の t 秒後（閉じた式。jet.js / heli.js の _updateWreck と同じ形:
//     下へ g（o.g、既定 14）で速さ vmax（60）まで、横は 1 − drag（0.3）/ 秒で減る）。サーバーと網の向こうの残骸が使う（§6.8）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.MR = root.MR || {}; root.MR.Burn = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const AIR_AGL = 3, ROOF_MIN = 4, TOP_BAND = 1.5;
  const SURFACES = ['ground', 'roof', 'wall', 'deck', 'water', 'air']; // 番号 = プロトコルの k（§4.5）

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function pair(a, d0, d1) { return Array.isArray(a) && a.length >= 2 ? [num(a[0], d0), num(a[1], d1)] : [d0, d1]; }

  // mulberry32（状態は r.s）
  function rng(seed) {
    const r = { s: (seed >>> 0) || 0x9E3779B9 };
    r.next = function () {
      let t = (r.s = (r.s + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = function (a, b) { return a + (b - a) * r.next(); };
    r.int = function (a, b) { return a + Math.floor(r.next() * (b - a + 1)); };
    return r;
  }

  function classify(info) {
    if (!info) return 'ground';
    if (info.deck) return 'deck';
    const y = num(info.y, 0);
    const airAgl = num(info.airAgl, AIR_AGL), roofMin = num(info.roofMin, ROOF_MIN);
    const sup = typeof info.support === 'number' && isFinite(info.support) ? info.support : null;
    const grd = typeof info.ground === 'number' && isFinite(info.ground) ? info.ground : sup;
    const wat = typeof info.water === 'number' && isFinite(info.water) ? info.water : null;
    const b = info.box;
    if (b && b.length >= 6) {
      const top = typeof info.ny === 'number' ? info.ny > 0.7 : y >= b[4] - TOP_BAND;
      if (top) return (grd != null && b[4] - grd > roofMin) || (grd == null && b[4] > roofMin) ? 'roof' : 'ground';
      return 'wall';
    }
    if (sup == null || (wat != null && wat >= sup)) {
      if (wat != null && y <= wat + airAgl) return 'water';
      if (sup == null && wat == null) return 'ground';
      return 'air';
    }
    if (y - sup > airAgl) return 'air';
    if (grd != null && sup - grd > roofMin) return 'roof';
    return 'ground';
  }

  function blastOf(cfg, kind) {
    const b = cfg && cfg.blast && cfg.blast[kind];
    if (!b) return null;
    if (typeof b === 'string') {
      const s = cfg.blasts && cfg.blasts[b];
      return s ? { r: num(s.radius, 0), dmg: num(s.damage, 0) } : null;
    }
    return { r: num(b.r, 0), dmg: num(b.dmg, 0) };
  }

  function newPlan() {
    return { kind: '', stage: '', surface: '', seed: 0, x: 0, y: 0, z: 0, blast: null, fireSec: 0, steam: 0, patches: [], facade: null,
      secondaries: [], slide: null, debris: 0, scorch: null };
  }

  // 面の上の点 (x, z) の高さ（足元が無い・水・面から maxStep m より離れていれば null）
  function surfaceAt(world, x, z, y0, maxStep) {
    if (!world || typeof world.support !== 'function') return y0;
    const y = world.support(x, z, y0 + maxStep);
    if (typeof y !== 'number' || !isFinite(y)) return null;
    if (Math.abs(y - y0) > maxStep) return null;
    if (typeof world.water === 'function') {
      const w = world.water(x, z);
      if (typeof w === 'number' && isFinite(w) && w >= y - 0.05) return null;
    }
    return y;
  }

  function plan(seed, spec, cfg, world, out) {
    cfg = cfg || {};
    const o = out || newPlan();
    if (!o.patches) o.patches = [];
    if (!o.secondaries) o.secondaries = [];
    o.patches.length = 0; o.secondaries.length = 0;
    o.facade = null; o.slide = null; o.scorch = null; o.blast = null; o.fireSec = 0; o.steam = 0; o.debris = 0;
    const R = rng(seed);
    const kind = spec.kind || 'jet', stage = spec.stage || 'ground';
    const surface = stage === 'air' ? 'air' : (spec.surface || 'ground');
    o.kind = kind; o.stage = stage; o.surface = surface; o.seed = seed >>> 0;
    o.x = num(spec.x, 0); o.y = num(spec.y, 0); o.z = num(spec.z, 0);
    const PC = cfg.patch || {};
    const pk = PC[kind] || null;
    const wreck = num(cfg.wreckSec && cfg.wreckSec[kind], 0);
    if (stage !== 'land') o.blast = blastOf(cfg, kind);
    if (kind === 'missile') return o; // ミサイル: 爆風だけ（火は残らない）
    if (surface === 'water') { o.steam = num(cfg.steamSec, 6); return o; } // 水: 湯気だけ。火は無し
    o.fireSec = wreck;
    if (stage === 'air') return o; // 空中: 落ちる残骸の火だけ（地面の火・壁・誘爆・焦げは land で）
    const vx = num(spec.vx, 0), vz = num(spec.vz, 0), hs = Math.hypot(vx, vz);
    const ang = R.next() * 6.283185307179586; // 横の速さが無いとき（真下に落ちた）の並べる向き
    const dx = hs > 0.5 ? vx / hs : Math.cos(ang), dz = hs > 0.5 ? vz / hs : Math.sin(ang);
    const maxStep = num(PC.maxStep, 3), jit = num(PC.jitter, 2.5);
    // 滑る道（jet。spec.slide で頼まれたときだけ = E3.3）
    if (spec.slide && kind === 'jet' && (surface === 'ground' || surface === 'deck' || surface === 'roof')) {
      const hit = world && typeof world.ray === 'function' ? function (x0, z0, x1, z1) {
        const lx = x1 - x0, lz = z1 - z0, L = Math.hypot(lx, lz);
        if (L < 1e-6) return 1;
        const d = world.ray(x0, o.y + 1, z0, lx / L, 0, lz / L, L);
        return typeof d === 'number' && d >= 0 ? d / L : 1;
      } : null;
      const sl = slidePath([o.x, o.y, o.z], [vx, num(spec.vy, 0), vz], cfg, hit);
      if (sl) o.slide = sl;
    }
    // 地面の火（屋上・地面・甲板。壁は箱の足元 = 下の面）
    if (pk && num(pk.n, 0) > 0) {
      const life = pair(pk.life, 30, 45);
      const n = num(pk.n, 1), sp = num(pk.spacing, 0);
      const bx = o.slide ? o.slide.x1 : o.x, bz = o.slide ? o.slide.z1 : o.z;
      let y0 = o.y;
      if (world && typeof world.support === 'function') {
        const ys = world.support(bx, bz, o.y + 1);
        if (typeof ys === 'number' && isFinite(ys)) y0 = ys;
      }
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) * 0.3) * sp;
        const px = bx + dx * along + (R.next() - 0.5) * 2 * jit, pz = bz + dz * along + (R.next() - 0.5) * 2 * jit;
        const t0 = i * 0.4 + R.next() * 0.5, t1 = t0 + R.range(life[0], life[1]);
        const r0 = num(pk.r0, 2) * (0.85 + R.next() * 0.3), r1 = num(pk.r1, 4) * (0.85 + R.next() * 0.3);
        const py = surfaceAt(world, px, pz, y0, maxStep);
        if (py == null) continue;
        o.patches.push([px, py, pz, r0, Math.max(r0, r1), t0, t1]);
      }
      // 滑った跡（trailEvery m ごと）
      if (o.slide) {
        const ev = num(PC.trailEvery, 14), sx = o.slide.x1 - o.slide.x0, sz = o.slide.z1 - o.slide.z0, L = Math.hypot(sx, sz);
        for (let d = ev; d < L - ev * 0.5; d += ev) {
          const px = o.slide.x0 + sx * d / L, pz = o.slide.z0 + sz * d / L;
          const py = surfaceAt(world, px, pz, o.y, maxStep);
          const t0 = o.slide.sec * d / L, t1 = t0 + R.range(life[0], life[1]) * 0.6;
          if (py != null) o.patches.push([px, py, pz, num(pk.r0, 2) * 0.7, num(pk.r1, 4) * 0.6, t0, t1]);
        }
      }
    }
    // 壁の火（高い建物の横の面）
    const F = cfg.facade || {};
    if (surface === 'wall' && spec.box && spec.box.length >= 6 && spec.box[4] >= num(F.minBoxTop, 30)) {
      const b = spec.box;
      // 一番近い面
      const dxa = o.x - b[0], dxb = b[3] - o.x, dza = o.z - b[2], dzb = b[5] - o.z;
      let nx = -1, nz = 0, m = dxa, fx = b[0], fz = Math.max(b[2], Math.min(b[5], o.z));
      if (dxb < m) { m = dxb; nx = 1; nz = 0; fx = b[3]; }
      if (dza < m) { m = dza; nx = 0; nz = -1; fx = Math.max(b[0], Math.min(b[3], o.x)); fz = b[2]; }
      if (dzb < m) { m = dzb; nx = 0; nz = 1; fx = Math.max(b[0], Math.min(b[3], o.x)); fz = b[5]; }
      const fy = Math.max(b[1], Math.min(b[4], o.y));
      o.facade = [fx, fy, fz, nx, nz, num(F.sec, 50) * (0.85 + R.next() * 0.3)];
    } else if (surface === 'roof' && spec.box && spec.box.length >= 6 && spec.box[4] >= num(F.minBoxTop, 30)) {
      // 屋上の縁（一番近い横の面まで facade.edge m 以内）: その面の上の端に壁の火
      const b = spec.box;
      const dxa = o.x - b[0], dxb = b[3] - o.x, dza = o.z - b[2], dzb = b[5] - o.z;
      let nx = -1, nz = 0, m = dxa, fx = b[0], fz = Math.max(b[2], Math.min(b[5], o.z));
      if (dxb < m) { m = dxb; nx = 1; nz = 0; fx = b[3]; }
      if (dza < m) { m = dza; nx = 0; nz = -1; fx = Math.max(b[0], Math.min(b[3], o.x)); fz = b[2]; }
      if (dzb < m) { m = dzb; nx = 0; nz = 1; fx = Math.max(b[0], Math.min(b[3], o.x)); fz = b[5]; }
      if (m >= -0.5 && m <= num(F.edge, 4)) o.facade = [fx, Math.max(b[1], b[4] - num(F.edgeDrop, 2)), fz, nx, nz, num(F.sec, 50) * (0.85 + R.next() * 0.3)];
    }
    // 誘爆
    const S = cfg.secondary || {};
    const nr = (S.perKind && S.perKind[kind]) ? pair(S.perKind[kind], 0, 0) : pair(S.n, 1, 3);
    const nsec = R.int(nr[0], nr[1]), del = pair(S.delay, 2, 9), spread = num(S.spread, 5);
    for (let i = 0; i < nsec; i++) {
      const t = R.range(del[0], del[1]);
      const sx = o.x + (R.next() - 0.5) * 2 * spread, sz = o.z + (R.next() - 0.5) * 2 * spread;
      let sy = surfaceAt(world, sx, sz, o.y, maxStep);
      if (sy == null) sy = o.y;
      o.secondaries.push([t, sx, sy + 0.5, sz, num(S.radius, 5), num(S.damage, 40)]);
    }
    o.secondaries.sort(function (a, b) { return a[0] - b[0]; });
    // 破片の数・焦げ
    const dn = cfg.debris && cfg.debris[kind];
    if (dn) { const dp = pair(dn, 0, 0); o.debris = R.int(dp[0], dp[1]); }
    const sr = num(cfg.scorch && cfg.scorch[kind], 0);
    if (sr > 0 && surface !== 'wall') {
      const sy = surfaceAt(world, o.x, o.z, o.y, maxStep);
      if (sy != null) o.scorch = [o.x, sy, o.z, sr * (0.9 + R.next() * 0.2)];
    }
    return o;
  }

  // keepOut の近くの地面の火を消す
  function cull(p, keepOut, r) {
    if (!p || !p.patches || !keepOut || !keepOut.length) return 0;
    const rr = num(r, 6);
    let n = 0;
    for (let i = p.patches.length - 1; i >= 0; i--) {
      const q = p.patches[i];
      for (let k = 0; k < keepOut.length; k++) {
        const pt = keepOut[k];
        const kx = Array.isArray(pt) ? pt[0] : pt.x, kz = Array.isArray(pt) ? pt[1] : pt.z;
        if (Math.hypot(q[0] - kx, q[2] - kz) < rr + q[4]) { p.patches.splice(i, 1); n++; break; }
      }
    }
    return n;
  }

  // 滑る道（E3.3）
  function slidePath(p, v, cfg, hit) {
    const S = (cfg && cfg.slide) || {};
    const vx = num(v[0], 0), vy = num(v[1], 0), vz = num(v[2], 0);
    const s = Math.hypot(vx, vz);
    if (s < num(S.minSpeed, 55)) return null;
    if (Math.atan2(Math.abs(Math.min(0, vy)), s) * 180 / Math.PI > num(S.maxAngle, 18)) return null;
    const dec = Math.max(0.1, num(S.decel, 22)), stop = num(S.stopSpeed, 8);
    let sec = Math.min(num(S.maxSec, 4.5), Math.max(0, (s - stop) / dec));
    let dist = s * sec - 0.5 * dec * sec * sec;
    const ux = vx / s, uz = vz / s;
    const x0 = num(p[0], 0), z0 = num(p[2], 0);
    if (hit) {
      const f = hit(x0, z0, x0 + ux * dist, z0 + uz * dist);
      if (typeof f === 'number' && f >= 0 && f < 1) {
        dist *= f;
        // s t − dec t² / 2 = dist の小さい方の t
        const disc = s * s - 2 * dec * dist;
        sec = disc > 0 ? (s - Math.sqrt(disc)) / dec : s / dec;
      }
    }
    return { x0, z0, x1: x0 + ux * dist, z1: z0 + uz * dist, sec };
  }

  // 撃墜された残骸の t 秒後（閉じた式）
  function wreckFall(p0, v0, t, out, o) {
    const g = num(o && o.g, 14), k = num(o && o.drag, 0.3), vmax = num(o && o.vmax, 60);
    const r = out || new Array(6);
    t = Math.max(0, num(t, 0));
    const e = Math.exp(-k * t), h = k > 1e-6 ? (1 - e) / k : t;
    r[0] = p0[0] + v0[0] * h; r[2] = p0[2] + v0[2] * h;
    r[3] = v0[0] * e; r[5] = v0[2] * e;
    const vy0 = Math.max(-vmax, v0[1]);
    const tc = (vy0 + vmax) / g;
    if (t <= tc) { r[1] = p0[1] + vy0 * t - 0.5 * g * t * t; r[4] = vy0 - g * t; }
    else { r[1] = p0[1] + vy0 * tc - 0.5 * g * tc * tc - vmax * (t - tc); r[4] = -vmax; }
    return r;
  }

  // ---------- 地面の火の記録 ----------
  class Field {
    constructor(cfg) {
      this.cfg = cfg || {};
      this.t = 0;
      this.list = [];     // 生きている記録
      this._pool = [];
      this._acc = 0;
      this._out = [];
      this._seen = [];
      this._tk = { out: null, n: 0, dps: 0, vdps: 0, dyMax: 0, chainMax: 2 };
      const self = this;
      this._visit = function (t) { self._visitOne(t); }; // 1 回だけ作る（tick ごとに関数を作らない）
      this.stats = { added: 0, evicted: 0, out: 0, ticks: 0, hits: 0 };
    }
    get count() { return this.list.length; }
    _cap() {
      const C = this.cfg.caps || {};
      return Math.max(1, num(C.patches, 24));
    }
    addPatch(x, y, z, r0, r1, t0, t1, by, grow, gen) {
      const L = this.list;
      if (L.length >= this._cap()) { // 一番早く消えるものを外す
        let k = 0;
        for (let i = 1; i < L.length; i++) if (L[i].t1 < L[k].t1) k = i;
        this._pool.push(L[k]); L.splice(k, 1); this.stats.evicted++;
      }
      const r = this._pool.pop() || { x: 0, y: 0, z: 0, r0: 0, r1: 0, t0: 0, t1: 0, grow: 5, by: null, id: 0, gen: 0, ft: 0, et: 0, st: 0, lv: 0 };
      r.x = x; r.y = y; r.z = z; r.r0 = r0; r.r1 = Math.max(r0, r1); r.t0 = this.t + t0; r.t1 = this.t + t1; r.by = by == null ? null : by;
      r.grow = Math.max(0.1, num(grow, 5));
      r.gen = Math.max(0, num(gen, 0) | 0); r.ft = 0; r.et = 0; r.st = 0; r.lv = 0;
      r.id = ++this.stats.added;
      L.push(r);
      return r;
    }
    add(p, by, gen) {
      if (!p || !p.patches) return 0;
      const pk = (this.cfg.patch || {})[p.kind];
      const grow = num(pk && pk.grow, 5);
      for (let i = 0; i < p.patches.length; i++) { const q = p.patches[i]; this.addPatch(q[0], q[1], q[2], q[3], q[4], q[5], q[6], by, grow, gen); }
      return p.patches.length;
    }
    state(r) {
      const PC = this.cfg.patch || {};
      const t = this.t;
      if (t < r.t0) return 'wait';
      if (t >= r.t1) return 'out';
      const grow = r.grow;
      const shrink = Math.min(num(PC.shrink, 8), (r.t1 - r.t0) * 0.4);
      if (t > r.t1 - shrink) return 'shrink';
      if (t < r.t0 + grow) return 'grow';
      return 'burn';
    }
    radius(r) {
      const PC = this.cfg.patch || {};
      const t = this.t;
      if (t < r.t0 || t >= r.t1) return 0;
      const grow = r.grow;
      const shrink = Math.min(num(PC.shrink, 8), (r.t1 - r.t0) * 0.4);
      let rad = r.r0 + (r.r1 - r.r0) * Math.min(1, (t - r.t0) / grow);
      if (t > r.t1 - shrink) rad *= Math.max(0, (r.t1 - t) / shrink);
      return rad;
    }
    // 時間を進める。tick 秒ごとに火の輪の中の目標へダメージ → out に書いた数
    tick(dt, eachTarget, out) {
      const C = this.cfg;
      this.t += Math.max(0, num(dt, 0));
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) if (this.t >= L[i].t1) { this._pool.push(L[i]); L.splice(i, 1); this.stats.out++; }
      out = out || this._out;
      let n = 0;
      const tk = Math.max(0.02, num(C.tick, 0.25));
      this._acc += Math.max(0, num(dt, 0));
      // 1e-6 の余裕: 1/60 秒を 15 回足しても 0.25 にわずかに届かず、tick が 16 フレームごと（dps が 6.7 % 少ない）になっていた（場面 19 の F14）
      if (this._acc < tk - 1e-6) { out.n = 0; return 0; }
      this._acc = Math.max(0, this._acc - tk);
      if (this._acc > tk) this._acc = 0; // 長く止まった後に何回分も入れない
      this.stats.ticks++;
      if (!L.length || typeof eachTarget !== 'function') { out.n = 0; return 0; }
      const K = this._tk;
      K.out = out; K.n = 0; K.chainMax = num(C.chainMax, 2);
      K.dps = num(C.dps, 12) * tk; K.vdps = num(C.vehicleDps, 25) * tk; K.dyMax = num(C.patch && C.patch.dy, 2.5);
      this._seen.length = 0;
      eachTarget(this._visit);
      this._seen.length = 0;
      n = K.n; K.out = null;
      out.n = n;
      this.stats.hits += n;
      return n;
    }
    _visitOne(t) {
      const K = this._tk, L = this.list, seen = this._seen;
      if (!t || !K.out || seen.indexOf(t.obj) >= 0) return;
      for (let i = 0; i < L.length; i++) {
        const r = L[i];
        if (Math.abs(t.y - r.y) >= K.dyMax) continue;
        if (t.cls === 'vehicle' && r.gen >= K.chainMax) continue; // 連鎖は chainMax 台まで（gen = この火を起こした連鎖の段）
        const rad = this.radius(r);
        if (!(rad > 0)) continue;
        const ddx = t.x - r.x, ddz = t.z - r.z;
        if (ddx * ddx + ddz * ddz > rad * rad) continue;
        const e = K.out[K.n] || (K.out[K.n] = { target: null, cls: '', dmg: 0, by: null, gen: 0 });
        e.target = t.obj; e.cls = t.cls; e.dmg = t.cls === 'vehicle' ? K.vdps : K.dps; e.by = r.by; e.gen = r.gen;
        K.n++; seen.push(t.obj);
        return;
      }
    }
    clear() {
      for (const r of this.list) this._pool.push(r);
      this.list.length = 0;
      this._acc = 0;
    }
  }

  return { classify, plan, newPlan, cull, Field, slidePath, wreckFall, rng, SURFACES, blastOf };
});
