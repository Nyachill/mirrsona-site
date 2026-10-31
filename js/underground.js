// 地下の口（MR.Underground。nyc-complete NC5 = rail-r4 §3.4 の地下のエンジンの街側）。THREE にも DOM にも依存しない UMD
//   （サーバーも require する = NC8: server/cityworld.js が gameOnly の街に駅を入れる。Node 専用のモジュールを require しない）。
//   CityGenNyc の R4 のフック（opts.rail）に渡す物: 地面の穴（pit）・地下の空洞（void）・その中の箱 / スロープを「サイト」ごとに持ち、
//   citygen_nyc.js の口から引かれる:
//     4 pitAt(x, z) → 穴の記録（.y = 穴の底）| null            groundAt の最初（穴の中は地面が穴の底 = 陸の壁が開く）
//     5 cuts()  → citygen の口の囲いと同じ形の矩形の配列        台（歩道・広場）の穴・地面のメッシュの穴（groundHoles）・路面の印 / 小物を抜く（_inCut）
//     2 emit(out, cx, cz, geom)                                  チャンクの boxes / ramps / voids（geom = 描画の層も: 空洞と穴の殻 = NOCOL の cat 'under'）
//     9 floorAt(x, z, y) → 地下の床の y | null                   supportHeightAt(x, z, y) の地下（y が地面より下のときだけ）
//       pitPush(x, z, r) → { x, z } | null                       乗り物（vehicle.js の地形モード）は穴に入らない（円を穴の外へ押し出す）
//   サイト: { id, pits: [{ x, z, ux, uz, hl, hw, y }], voids: [{ x, z, ux, uz, hl, hw, ya, yb, h }], boxes: [citygen の箱], ramps: [スロープ],
//            shell: true（軸に沿った空洞と穴の殻を自動で作る。回った空洞の殻は NC6 の駅の生成が自分で書く）,
//            NC6（MR.Stations = www/js/stations.js の駅）: prisms（当たりのある柱: ホーム・階段・柵。ck = 置くチャンクのキー、無ければ重心のチャンク）,
//            shellPrisms（見た目だけの殻 NOCOL・灯り。描画の層 = geom のときだけ）, decals（線路。geom のときだけ）, loot（[{ x, y, z, table }]）,
//            spawns（敵の出る点 [{ x, y, z, kind }]。this.spawns にまとめる）}
//   loot(list, cx, cz): chunkFull / lootSpawns の今の物の後ろに駅の物を足す（id = cx_cz_n の n は今の数から = 今までの物の id は変わらない）
//   opts.build(city, U) → [サイト]: attach（CityGenNyc のコンストラクタ）で 1 回だけ呼ぶ（core の STAT から駅を作る = MR.Stations.underground）
//     pit  = 向きのある矩形（中心 x, z・軸 ux, uz・半分の長さ hl / 幅 hw）。中の地面は y（穴の底）。上は空（階段の口）
//     void = 地面の無い向きのある箱（Nav3D の空洞の形。床は −軸の端 ya → +軸の端 yb、高さ h）。Nav3D.addChunk の voids へそのまま
//   空洞は外接矩形がかかる全部のチャンクに出す（Nav3D は同じ空洞が何度入ってもよい）、箱・スロープは中心のチャンクだけ。
//   MR.Underground.testSite(spec) はテストの空洞（データ無し: 歩道から階段の穴 → 4 × 20 × 3 m の箱、床 −6 m）を作る（N12・city-test）
(function (root) {
  const MR = root.MR || (root.MR = {});
  const NOCOL = 1, NOLOS = 2, WALK = 4;
  const SHELL_T = 0.3;

  // 向きのある矩形の中か（m 広げる）
  function inObb(o, x, z, m) {
    const dx = x - o.x, dz = z - o.z, s = dx * o.ux + dz * o.uz, l = -dx * o.uz + dz * o.ux;
    return s >= -o.hl - m && s <= o.hl + m && l >= -o.hw - m && l <= o.hw + m;
  }
  function obbRing(o) {
    const vx = -o.uz, vz = o.ux, r = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) r.push(o.x + o.ux * o.hl * a + vx * o.hw * b, o.z + o.uz * o.hl * a + vz * o.hw * b);
    return r;
  }
  function obbBB(o, m) {
    m = m || 0;
    const ex = Math.abs(o.ux) * o.hl + Math.abs(o.uz) * o.hw + m, ez = Math.abs(o.uz) * o.hl + Math.abs(o.ux) * o.hw + m;
    return [o.x - ex, o.z - ez, o.x + ex, o.z + ez];
  }
  const axisAligned = (o) => Math.abs(o.ux) < 1e-9 || Math.abs(o.uz) < 1e-9;
  // 箱 a − 箱 b（[x0, y0, z0, x1, y1, z1]）→ 0〜6 個
  function boxMinus(a, b, out) {
    if (b[0] >= a[3] || b[3] <= a[0] || b[1] >= a[4] || b[4] <= a[1] || b[2] >= a[5] || b[5] <= a[2]) { out.push(a); return; }
    let [x0, y0, z0, x1, y1, z1] = a;
    if (b[0] > x0) { out.push([x0, y0, z0, b[0], y1, z1]); x0 = b[0]; }
    if (b[3] < x1) { out.push([b[3], y0, z0, x1, y1, z1]); x1 = b[3]; }
    if (b[1] > y0) { out.push([x0, y0, z0, x1, b[1], z1]); y0 = b[1]; }
    if (b[4] < y1) { out.push([x0, b[4], z0, x1, y1, z1]); y1 = b[4]; }
    if (b[2] > z0) { out.push([x0, y0, z0, x1, y1, b[2]]); z0 = b[2]; }
    if (b[5] < z1) out.push([x0, y0, b[5], x1, y1, z1]);
  }
  function minusAll(boxes, cutters) {
    let cur = boxes;
    for (const c of cutters) { const nx = []; for (const a of cur) boxMinus(a, c, nx); cur = nx; }
    return cur.filter((a) => a[3] - a[0] > 0.02 && a[4] - a[1] > 0.02 && a[5] - a[2] > 0.02);
  }

  class Underground {
    // opts: { sites: [サイト], minX, minZ, chunkSize（既定 −∞ 原点・128）, cell（穴の索引のセル m、既定 32）}
    constructor(opts) {
      opts = opts || {};
      this.sites = [];
      this.pits = [];
      this.voids = [];
      this.cell = opts.cell || 32;
      this.chunkSize = opts.chunkSize || 128;
      this.minX = opts.minX != null ? opts.minX : 0; this.minZ = opts.minZ != null ? opts.minZ : 0;
      this._grid = new Map();   // 穴のセル → [pit]
      this._chunks = new Map(); // チャンクのキー → { boxes, ramps, voids, shell }
      this._cuts = [];
      this._push = { x: 0, z: 0 };
      this.spawns = [];
      this._build = typeof opts.build === 'function' ? opts.build : null;
      this._built = false;
      for (const s of opts.sites || []) this.addSite(s);
    }
    // 街の格子に合わせる（CityGenNyc のコンストラクタが呼ぶ。サイトを足す前でも後でもよい）
    attach(city) {
      if (!(this.minX === city.minX && this.minZ === city.minZ && this.chunkSize === city.cs)) {
        this.minX = city.minX; this.minZ = city.minZ; this.chunkSize = city.cs;
        const sites = this.sites;
        this.sites = []; this.pits = []; this.voids = []; this.spawns = []; this._grid.clear(); this._chunks.clear(); this._cuts = [];
        for (const s of sites) this.addSite(s);
      }
      if (this._build && !this._built) { this._built = true; for (const s of this._build(city, this) || []) this.addSite(s); }
    }
    _ck(x, z) { return Math.floor((x - this.minX) / this.chunkSize) + '_' + Math.floor((z - this.minZ) / this.chunkSize); }
    _chunk(k) { let c = this._chunks.get(k); if (!c) this._chunks.set(k, (c = { boxes: [], ramps: [], voids: [], shell: [], prisms: [], vis: [], decals: [], loot: [] })); return c; }
    _ckRing(r) { let x = 0, z = 0; const n = r.length >> 1; for (let i = 0; i < n; i++) { x += r[i * 2]; z += r[i * 2 + 1]; } return this._ck(x / n, z / n); }
    _eachChunk(bb, fn) {
      const cs = this.chunkSize;
      for (let i = Math.floor((bb[0] - this.minX) / cs); i <= Math.floor((bb[2] - this.minX) / cs); i++)
        for (let j = Math.floor((bb[1] - this.minZ) / cs); j <= Math.floor((bb[3] - this.minZ) / cs); j++) fn(i + '_' + j);
    }
    addSite(site) {
      this.sites.push(site);
      for (const p of site.pits || []) {
        const n = Math.hypot(p.ux, p.uz) || 1;
        const q = Object.assign({}, p, { ux: p.ux / n, uz: p.uz / n, site: site.id });
        q.bb = obbBB(q, 0);
        this.pits.push(q);
        const c = this.cell;
        for (let i = Math.floor(q.bb[0] / c); i <= Math.floor(q.bb[2] / c); i++) for (let j = Math.floor(q.bb[1] / c); j <= Math.floor(q.bb[3] / c); j++) {
          const k = i * 65536 + j;
          let L = this._grid.get(k);
          if (!L) this._grid.set(k, (L = []));
          L.push(q);
        }
        // citygen の口の囲いの形（_cutPits / _inCut / groundHoles）: 口の座標 s（軸）× l（横）。o + u·s + v·l
        const vx = -q.uz, vz = q.ux, ox = q.x - q.ux * q.hl - vx * q.hw, oz = q.z - q.uz * q.hl - vz * q.hw;
        this._cuts.push({ ox, oz, ux: q.ux, uz: q.uz, vx, vz, s0: 0, s1: 2 * q.hl, l0: 0, l1: 2 * q.hw, ring: obbRing(q), bb: q.bb.slice(), pit: q });
      }
      for (const v of site.voids || []) {
        const n = Math.hypot(v.ux, v.uz) || 1;
        const q = { x: v.x, z: v.z, ux: v.ux / n, uz: v.uz / n, hl: v.hl, hw: v.hw, ya: v.ya, yb: v.yb != null ? v.yb : v.ya, h: v.h, site: site.id, mat: v.mat || 'concrete' };
        this.voids.push(q);
        this._eachChunk(obbBB(q, 0), (k) => this._chunk(k).voids.push(q));
      }
      for (const b of site.boxes || []) this._chunk(this._ck(b.x, b.z)).boxes.push(b);
      for (const r of site.ramps || []) this._chunk(this._ck(r.x, r.z)).ramps.push(r);
      if (site.shell !== false) for (const b of this._shell(site)) this._chunk(this._ck(b.x, b.z)).shell.push(b);
      for (const p of site.prisms || []) this._chunk(p.ck || this._ckRing(p.ring)).prisms.push(p);
      for (const p of site.shellPrisms || []) this._chunk(p.ck || this._ckRing(p.ring)).vis.push(p);
      for (const d of site.decals || []) this._chunk(d.ck || this._ck(d.x, d.z)).decals.push(d);
      for (const l of site.loot || []) this._chunk(this._ck(l.x, l.z)).loot.push(l);
      for (const q of site.spawns || []) this.spawns.push(q);
    }
    // 軸に沿った空洞・穴の殻（見た目だけ: NOCOL、cat 'under'）。空洞の床・天井・4 つの壁、穴の 4 つの壁（穴の底から地面まで）と底。
    //   どれも空洞と穴の中を抜く（つながった所は開く）
    _shell(site) {
      const T = SHELL_T, raw = [], cut = [], cutFloor = [], ground = site.ground != null ? site.ground : 0;
      const vs = (site.voids || []).filter(axisAligned), ps = (site.pits || []).filter(axisAligned);
      for (const v0 of vs) {
        const v = Object.assign({}, v0, { yb: v0.yb != null ? v0.yb : v0.ya });
        const b = obbBB(v, 0), f = Math.min(v.ya, v.yb), top = Math.max(v.ya, v.yb) + v.h;
        cut.push([b[0], f, b[1], b[2], top, b[3]]);
        cutFloor.push([b[0], -Infinity, b[1], b[2], f, b[3]]);
        raw.push({ b: [b[0] - T, f - T, b[1] - T, b[2] + T, f, b[3] + T], floor: 1 });
        raw.push({ b: [b[0] - T, top, b[1] - T, b[2] + T, top + T, b[3] + T] });
        raw.push({ b: [b[0] - T, f, b[1] - T, b[0], top, b[3] + T] }, { b: [b[2], f, b[1] - T, b[2] + T, top, b[3] + T] });
        raw.push({ b: [b[0], f, b[1] - T, b[2], top, b[1]] }, { b: [b[0], f, b[3], b[2], top, b[3] + T] });
      }
      for (const p of ps) {
        const b = p.bb || obbBB(p, 0), y = p.y;
        cut.push([b[0], y, b[1], b[2], Infinity, b[3]]);
        raw.push({ b: [b[0], y - T, b[1], b[2], y, b[3]], floor: 2 });
        raw.push({ b: [b[0] - T, y - T, b[1] - T, b[0], ground, b[3] + T] }, { b: [b[2], y - T, b[1] - T, b[2] + T, ground, b[3] + T] });
        raw.push({ b: [b[0], y - T, b[1] - T, b[2], ground, b[1]] }, { b: [b[0], y - T, b[3], b[2], ground, b[3] + T] });
      }
      const out = [];
      for (const r of raw) for (const a of minusAll([r.b], r.floor === 2 ? cut.concat(cutFloor) : cut)) {
        out.push({ x: (a[0] + a[3]) / 2, y: a[1], z: (a[2] + a[5]) / 2, w: a[3] - a[0], h: a[4] - a[1], d: a[5] - a[2], f: NOCOL, mat: 'concrete', cat: 'under', under: 1 });
      }
      return out;
    }

    // ===== citygen_nyc.js のフック =====
    pitAt(x, z) {
      const c = this.cell, L = this._grid.get(Math.floor(x / c) * 65536 + Math.floor(z / c));
      if (!L) return null;
      for (let i = 0; i < L.length; i++) { const p = L[i]; if (x >= p.bb[0] && x <= p.bb[2] && z >= p.bb[1] && z <= p.bb[3] && inObb(p, x, z, 0)) return p; }
      return null;
    }
    cuts() { return this._cuts; }
    emit(out, cx, cz, geom) {
      const c = this._chunks.get(cx + '_' + cz);
      if (!c) return;
      for (const b of c.boxes) out.boxes.push(b);
      for (const r of c.ramps) out.ramps.push(r);
      if (geom) for (const b of c.shell) out.boxes.push(b);
      if (c.prisms.length || c.vis.length) { const P = out.prisms || (out.prisms = []); for (const p of c.prisms) P.push(p); if (geom) for (const p of c.vis) P.push(p); }
      if (geom && c.decals.length) { const D = out.decals || (out.decals = []); for (const d of c.decals) D.push(d); }
      const V = out.voids || (out.voids = []);
      for (const v of c.voids) V.push(v);
    }
    // 駅の落ちている物（chunkFull().loot / lootSpawns の後ろに足す。id の n は今の物の数から）
    loot(list, cx, cz) {
      const c = this._chunks.get(cx + '_' + cz);
      if (!c || !c.loot.length) return;
      const base = list.length;
      for (let k = 0; k < c.loot.length; k++) { const l = c.loot[k]; list.push({ id: cx + '_' + cz + '_' + (base + k), x: l.x, y: l.y, z: l.z, table: l.table, under: 1 }); }
    }
    // (x, z) の地下で高さ y の体が立つ床（空洞の床・空洞の中の立てる箱の上面のうち y + 0.5 以下で一番高い物）。地下でなければ null
    floorAt(x, z, y) {
      let best = null;
      for (const v of this.voids) {
        if (!inObb(v, x, z, 0)) continue;
        const s = (x - v.x) * v.ux + (z - v.z) * v.uz, f = v.ya + (v.yb - v.ya) * (Math.max(-v.hl, Math.min(v.hl, s)) + v.hl) / (2 * v.hl);
        if (y < f - 0.5 || y > f + v.h) continue;
        if (best === null || f > best) best = f;
      }
      if (best === null) return null;
      const ch = this._chunks.get(this._ck(x, z)); // 空洞の中の立てる箱（ホーム・中二階の床。NC6）
      if (ch) for (const b of ch.boxes) {
        if (!(b.f & WALK) || (b.f & NOCOL)) continue;
        const t = (b.y || 0) + b.h;
        if (t > y + 0.5 || t <= best || Math.abs(x - b.x) > b.w / 2 || Math.abs(z - b.z) > b.d / 2) continue;
        best = t;
      }
      if (ch) for (const p of ch.prisms) { // 柱（NC6: ホーム・階段。凸の輪）
        if ((p.f & NOCOL) || !(p.f & WALK) || !inRing(p.ring, x, z)) continue;
        const t = p.top ? p.top[0] + p.top[1] * x + p.top[2] * z : p.y1;
        if (t > y + 0.5 || t <= best) continue;
        best = t;
      }
      return best;
    }
    // 円 (x, z, r) が穴に掛かっていれば穴の外へ押し出した点（使い回しの物）。掛からなければ null
    pitPush(x, z, r) {
      let hit = false;
      for (let it = 0; it < 3; it++) {
        let moved = false;
        const c = this.cell;
        for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c) && !moved; i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c) && !moved; j++) {
          const L = this._grid.get(i * 65536 + j);
          if (!L) continue;
          for (const p of L) {
            const dx = x - p.x, dz = z - p.z, s = dx * p.ux + dz * p.uz, l = -dx * p.uz + dz * p.ux;
            const cs = Math.max(-p.hl, Math.min(p.hl, s)), cl = Math.max(-p.hw, Math.min(p.hw, l));
            const es = s - cs, el = l - cl, d2 = es * es + el * el;
            if (d2 >= r * r) continue;
            let ns, nl;
            if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d; ns = s + es * k; nl = l + el * k; }
            else { // 中心が穴の中: 一番近い縁の外へ
              const a = [p.hl - s, s + p.hl, p.hw - l, l + p.hw], m = Math.min(a[0], a[1], a[2], a[3]);
              ns = s; nl = l;
              if (m === a[0]) ns = p.hl + r; else if (m === a[1]) ns = -p.hl - r; else if (m === a[2]) nl = p.hw + r; else nl = -p.hw - r;
            }
            x = p.x + p.ux * ns - p.uz * nl; z = p.z + p.uz * ns + p.ux * nl;
            hit = true; moved = true;
            break;
          }
        }
        if (!moved) break;
      }
      if (!hit) return null;
      this._push.x = x; this._push.z = z;
      return this._push;
    }

    // ===== テストの空洞（データ無し）=====
    // spec: { x, z（階段の上の端の真ん中）, ux, uz（下りる向き。既定 +x）, top（歩道の上面。既定 0.15）, depth（床 −depth。既定 6）,
    //         stairW（2.4）, slope（0.6）, landing（1）, voidW（4）, voidL（20）, voidH（3）, railH（1.1）}
    //   穴（stairW × 階段 + 踊り場）、くさびのスロープ（階段。下は穴の底まで固い = 階段の裏に潜らない）、穴の 3 辺の手すり（上の端は開いている）、
    //   空洞（踊り場から先へ voidL m。幅 voidW・高さ voidH）
    static testSite(spec) {
      const s = Object.assign({ ux: 1, uz: 0, top: 0.15, depth: 6, stairW: 2.4, slope: 0.6, landing: 1, voidW: 4, voidL: 20, voidH: 3, railH: 1.1, railT: 0.1, id: 'test' }, spec || {});
      const n = Math.hypot(s.ux, s.uz) || 1, ux = s.ux / n, uz = s.uz / n, vx = -uz, vz = ux;
      const fy = -s.depth, drop = s.top - fy, Ls = drop / s.slope, Lp = Ls + s.landing;
      const P = (a, l) => [s.x + ux * a + vx * l, s.z + uz * a + vz * l];
      const ax = Math.abs(ux) > 0.5; // 軸に沿う向き（スロープ・手すりの箱は軸に沿う形だけ）
      if (!(Math.abs(ux) < 1e-9 || Math.abs(uz) < 1e-9)) throw new Error('Underground.testSite: axis-aligned only');
      const pc = P(Lp / 2, 0);
      const pits = [{ x: pc[0], z: pc[1], ux, uz, hl: Lp / 2, hw: s.stairW / 2, y: fy }];
      const sc = P(Ls / 2, 0), dirSign = (ax ? ux : uz) > 0 ? -1 : 1; // 上の端（a = 0）が高い
      const ramps = [{ x: sc[0], z: sc[1], w: ax ? Ls : s.stairW, d: ax ? s.stairW : Ls, y0: fy, y1: s.top, axis: ax ? 'x' : 'z', dir: dirSign, t: drop + 0.5, f: WALK, mat: 'concrete', cat: 'stair', under: 1 }];
      const boxes = [];
      const rail = (a0, a1, l0, l1) => { const c = P((a0 + a1) / 2, (l0 + l1) / 2), la = Math.abs(a1 - a0), ll = Math.abs(l1 - l0); boxes.push({ x: c[0], y: s.top, z: c[1], w: ax ? la : ll, h: s.railH, d: ax ? ll : la, f: NOLOS, mat: 'railing', cat: 'fence', under: 1 }); };
      const hw = s.stairW / 2, t = s.railT;
      rail(0, Lp + t, hw, hw + t); rail(0, Lp + t, -hw - t, -hw); rail(Lp, Lp + t, -hw, hw);
      const vc = P(Ls + s.voidL / 2, 0);
      const voids = [{ x: vc[0], z: vc[1], ux, uz, hl: s.voidL / 2, hw: s.voidW / 2, ya: fy, yb: fy, h: s.voidH }];
      return { id: s.id, pits, voids, ramps, boxes, shell: true, ground: 0, spec: s, info: { top: s.top, floor: fy, Ls, Lp, stairTop: P(0, 0), stairBottom: P(Ls, 0), voidEnd: P(Ls + s.voidL, 0), voidCenter: vc, axis: [ux, uz], side: [vx, vz] } };
    }
  }
  // 凸の輪の中か（向きはどちらでもよい）
  function inRing(r, x, z) {
    const n = r.length >> 1;
    let sg = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, c = (r[j * 2] - r[i * 2]) * (z - r[i * 2 + 1]) - (r[j * 2 + 1] - r[i * 2 + 1]) * (x - r[i * 2]);
      if (Math.abs(c) < 1e-9) continue;
      const s = c > 0 ? 1 : -1;
      if (!sg) sg = s; else if (s !== sg) return false;
    }
    return true;
  }
  Underground.inObb = inObb;
  Underground.inRing = inRing;

  MR.Underground = Underground;
  if (typeof module !== 'undefined' && module.exports) module.exports = Underground;
})(typeof window !== 'undefined' ? window : globalThis);
