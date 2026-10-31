// 地下鉄の駅の生成（MR.Stations。nyc-complete NC6 = rail-r4 §3.4 の駅）。THREE にも DOM にも依存しない UMD（サーバーも require する = NC8: server/cityworld.js。駅の形を変えたら CityGenNyc.GEN_VERSION を上げる）。
//   core の STAT（citygen_nyc.js _initStations の city.stations: 駅・ホーム・道の入口）と、レベルの JSON の underground.layouts（駅ごとの部屋・
//   通路・改札・どのホーム / 入口を使うか。数は全部データ = NC7 は layouts を足すだけ）から MR.Underground のサイトを作る:
//     入口（STAT の ents）→ 地面の穴（pit。手すりの外の長方形そのまま）+ 階段（斜めの柱 = 向きは自由）+ 屋根のある階段（斜めの空洞）+ 踊り場 + 通路（部屋まで）
//     部屋（改札階 = 中二階。軸に沿った矩形）+ 改札（1.0 m の箱 = 乗り越えられる。幅 gate m の通用口は歩いて通れる・敵の歩行グラフも通る）
//     ホームのまとまり（hall: 同じ高さのホームと線路を 1 つの向きのある空洞に。線路の床 = ホームの上面 − bedBelow、線路（type 'track' の decals）、
//     ホームの柱（WALK）、ホームの端の段（線路へ降りる）、両端の stub m のトンネル（暗い奥の壁）、灯り）
//     ホームへの階段（部屋の縁からホームの軸に沿って下る）
//   殻（見た目だけ NOCOL・cat 'under'）: 空洞ごとに床・天井・4 つの壁（向きのある凸の柱）を作り、ほかの空洞・穴の中にかかる所を凸の多角形の引き算と
//   平面の半平面で正確に抜く（向きの違う空洞どうし = 回ったホームと軸に沿った部屋でも開口がちょうど開く。同じ所に重なる板は先に作った空洞の板だけ残す）。
//   最後にチャンクの格子で切り（切り口の辺は clip = 壁にならない）、チャンクの柱にする。
//   MR.Stations.build(city, ucfg) → { sites, report }   MR.Stations.underground(plan) → MR.Underground（attach で build）| null
(function (root) {
  const MR = root.MR || (root.MR = {});
  const NOCOL = 1, NOLOS = 2, WALK = 4;
  const EA = 1e-3; // 面積の下限（m²）

  // ===== 凸の多角形（[x0, z0, x1, z1, …]、面積 > 0 = 反時計回り）=====
  function area(P) { let a = 0; const n = P.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += P[i * 2] * P[j * 2 + 1] - P[j * 2] * P[i * 2 + 1]; } return a / 2; }
  function ccw(P) { if (area(P) >= 0) return P; const n = P.length >> 1, Q = []; for (let i = n - 1; i >= 0; i--) Q.push(P[i * 2], P[i * 2 + 1]); return Q; }
  // a·x + b·z + c ≤ 0 の側を残す
  function clip(P, a, b, c) {
    const out = [], n = P.length >> 1;
    if (!n) return out;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = P[i * 2], az = P[i * 2 + 1], bx = P[j * 2], bz = P[j * 2 + 1];
      const da = a * ax + b * az + c, db = a * bx + b * bz + c;
      if (da <= 0) out.push(ax, az);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push(ax + (bx - ax) * t, az + (bz - az) * t); }
    }
    return out.length >= 6 ? out : [];
  }
  function edges(Q, fn) { const n = Q.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n, qx = Q[i * 2], qz = Q[i * 2 + 1], dx = Q[j * 2] - qx, dz = Q[j * 2 + 1] - qz; fn(dz, -dx, -(dz * qx - dx * qz)); } }
  function inter(P, Q) { let R = P; edges(Q, (a, b, c) => { if (R.length) R = clip(R, a, b, c); }); return R; }
  // P − Q（凸）→ 凸の多角形の列
  function minus(P, Q) {
    const out = [];
    let cur = P;
    edges(Q, (a, b, c) => {
      if (!cur.length) return;
      const o = clip(cur, -a, -b, -c);
      if (o.length && area(o) > EA) out.push(o);
      cur = clip(cur, a, b, c);
    });
    return out;
  }
  // 平面 [a, bx, cz]（y = a + bx·x + cz·z）
  const flat = (y) => [y, 0, 0];
  const padd = (p, d) => [p[0] + d, p[1], p[2]];
  const pev = (p, x, z) => p[0] + p[1] * x + p[2] * z;
  const isFlat = (p) => Math.abs(p[1]) < 1e-12 && Math.abs(p[2]) < 1e-12;
  // A(x, z) − B(x, z) > e の側を残す
  function clipAbove(P, A, B, e) { return clip(P, -(A[1] - B[1]), -(A[2] - B[2]), -(A[0] - B[0] - e)); }
  function pmin(P, pl) { let m = Infinity; for (let i = 0; i < P.length; i += 2) m = Math.min(m, pev(pl, P[i], P[i + 1])); return m; }
  function pmax(P, pl) { let m = -Infinity; for (let i = 0; i < P.length; i += 2) m = Math.max(m, pev(pl, P[i], P[i + 1])); return m; }
  // 向きのある矩形（中心 x, z・軸 ux, uz・半分の長さ hl / 幅 hw）。横 v = (−uz, ux)（MR.Underground と同じ）
  function rect(x, z, ux, uz, hl, hw) {
    const vx = -uz, vz = ux, P = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push(x + ux * hl * a + vx * hw * b, z + uz * hl * a + vz * hw * b);
    return ccw(P);
  }
  function bbox(P) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < P.length; i += 2) { const x = P[i], z = P[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return [x0, z0, x1, z1]; }
  // 床が s（軸の座標）で線形な空洞の床の平面: 床 = ya + k·(s + hl)、s = (p − c)·u
  function slopePlane(x, z, ux, uz, hl, ya, yb) {
    const k = hl > 0 ? (yb - ya) / (2 * hl) : 0;
    return [ya + k * hl - k * (x * ux + z * uz), k * ux, k * uz];
  }
  function fan(n) { const f = new Uint16Array((n - 2) * 3); for (let i = 0; i < n - 2; i++) { f[i * 3] = 0; f[i * 3 + 1] = i + 1; f[i * 3 + 2] = i + 2; } return f; }
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // 部屋（info.rooms の記録）の中か（縁から pad m 外まで）。回った部屋（rot）は向きのある矩形で
  function roomHas(r, x, z, pad) {
    if (!r.rot) return x > r.rect[0] - pad && x < r.rect[2] + pad && z > r.rect[1] - pad && z < r.rect[3] + pad;
    const dx = x - r.x, dz = z - r.z, s = dx * r.ux + dz * r.uz, l = -dx * r.uz + dz * r.ux;
    return Math.abs(s) < r.hl + pad && Math.abs(l) < r.hw + pad;
  }
  // 度 → 単位ベクトル。0 / 90 / 180 / 270 はちょうどの値（turn と同じ丸め）
  function rotU(ux, uz, deg) { const a = deg * Math.PI / 180, c = Math.round(Math.cos(a) * 1e9) / 1e9, sn = Math.round(Math.sin(a) * 1e9) / 1e9; return [ux * c - uz * sn, ux * sn + uz * c]; }
  // レイアウトのホーム q → { p（STAT のホーム、または set で上書き / 作った物）, y }。q.set: { x, z, yaw（度、STAT と同じ = u = (sin, cos)）, hl, hw, y, flags }。
  //   near が無ければ set だけのホーム（データに無いホーム = i は負の数）
  function layoutPlat(st, q, k, tol) {
    let p = null;
    if (q.near) { p = nearest(st.plats, q.near[0], q.near[1], tol); if (!p) throw new Error('no platform near ' + q.near); }
    else if (!q.set) throw new Error('platform: near or set');
    if (q.set) {
      const S = q.set, b = p || { i: -(k + 1), x: 0, z: 0, ux: 1, uz: 0, hl: 20, hw: 3, y: -10, flags: 3 };
      p = Object.assign({}, b, { synth: !p });
      for (const key of ['x', 'z', 'hl', 'hw', 'y', 'flags']) if (S[key] != null) p[key] = S[key];
      if (S.yaw != null) { const a = S.yaw * Math.PI / 180; p.ux = Math.round(Math.sin(a) * 1e9) / 1e9; p.uz = Math.round(Math.cos(a) * 1e9) / 1e9; }
    }
    return { p, y: q.y != null ? q.y : p.y };
  }

  // ===== 駅のまとまり（1 つの layout）を作る =====
  class Builder {
    constructor(city, cfg) {
      this.city = city;
      this.cfg = cfg;
      this.T = cfg.shell;              // 殻の厚さ
      this.voids = [];                 // { poly, polyX, lo, hi, loX, hiX, mats, faces, base, rec（Underground の void）| null（穴）, idx }
      this.pits = [];
      this.prisms = [];                // 当たりのある柱（ホーム・階段・手すり）
      this.vis = [];                   // 見た目だけ（殻・灯り）
      this.boxes = [];                 // 改札（乗り越え = 箱だけ）
      this.decals = [];
      this.loot = [];
      this.spawns = [];
      this.info = { rooms: {}, halls: [], ents: [], stairs: [], fare: [], links: [], stubs: [] };
    }
    // 空洞（Underground の void + 殻の材質）
    addVoid(o) {
      const n = Math.hypot(o.ux, o.uz) || 1, ux = o.ux / n, uz = o.uz / n, T = this.T;
      const yb = o.yb != null ? o.yb : o.ya;
      const lo = slopePlane(o.x, o.z, ux, uz, o.hl, o.ya, yb), hi = padd(lo, o.h);
      const v = { kind: o.kind, x: o.x, z: o.z, ux, uz, hl: o.hl, hw: o.hw, ya: o.ya, yb, h: o.h, lo, hi, loX: padd(lo, -T), hiX: padd(hi, T),
        poly: rect(o.x, o.z, ux, uz, o.hl, o.hw), polyX: rect(o.x, o.z, ux, uz, o.hl + T, o.hw + T),
        mats: o.mats, faces: o.faces || {}, base: Math.abs(yb - o.ya) < 1e-6 ? o.ya : 0, lamps: o.lamps || null, idx: this.voids.length, pit: false };
      v.rec = { x: o.x, z: o.z, ux, uz, hl: o.hl, hw: o.hw, ya: o.ya, yb, h: o.h, mat: o.mats.wall };
      this.voids.push(v);
      return v;
    }
    // 地面の穴（上は空。中の地面は y）。殻は 4 つの壁（穴の底 − T から歩道の上面 top − 0.01 まで）
    addPit(o) {
      const T = this.T, top = o.top - 0.01; // 歩道の上面の下（上面は歩道の台が描く）
      const v = { kind: 'pit', x: o.x, z: o.z, ux: o.ux, uz: o.uz, hl: o.hl, hw: o.hw, lo: flat(o.y), hi: flat(1e4), loX: flat(o.y - T), hiX: flat(1e4),
        poly: rect(o.x, o.z, o.ux, o.uz, o.hl, o.hw), polyX: rect(o.x, o.z, o.ux, o.uz, o.hl + T, o.hw + T), mats: { wall: this.cfg.mats.pit },
        faces: { floor: false, ceil: false, top }, base: o.y, idx: this.voids.length, pit: true, rec: null };
      this.voids.push(v);
      this.pits.push({ x: o.x, z: o.z, ux: o.ux, uz: o.uz, hl: o.hl, hw: o.hw, y: o.y, top: o.top }); // top: 歩道の上面（world.js の口の視錐台）
      return v;
    }
    // 柱（当たりあり）。ring: 凸の多角形、top: 上面の平面、bp: 下面の平面（t の代わり）、extra: f / mat / mt / mb / cat …
    solid(poly, bot, top, extra) { this.prisms.push(Object.assign({ poly, bot, top }, extra)); }
    // 斜めの柱の階段（上の端 (x0, z0) の高さ y0 から向き (dx, dz) へ len m 下りて y1。幅 w、厚さ t（下面は平行）
    ramp(x0, z0, dx, dz, len, w, y0, y1, t, mat, mw) {
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      const cx = x0 + dx * len / 2, cz = z0 + dz * len / 2, k = (y1 - y0) / len;
      // 上面: y = y0 + k·((p − p0)·d)
      const top = [y0 - k * (x0 * dx + z0 * dz), k * dx, k * dz];
      this.solid(rect(cx, cz, dx, dz, len / 2, w / 2), padd(top, -t), top, { f: WALK, mat: this.cfg.mats.stair, mw: mw || this.cfg.mats.stair, mb: this.cfg.mats.stair, cat: 'under', stair: 1 });
      return top;
    }
    // 階段の横の壁（ramp の上面 top に沿って s0〜s1 m。下は low = 下の床）: 横が開いた階段（部屋・ホームの中）に。横から斜面に乗れない
    //   （敵の経路の始点が斜面の上の節点に付いて、横の段に押し付けたまま止まっていた）
    sideWalls(x0, z0, dx, dz, s0, s1, w, top, low) {
      const c = this.cfg, n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      if (!(s1 - s0 > 0.05) || !(c.stairWallH > 0)) return;
      const vx = -dz, vz = dx, t = c.stairWallT, m = (s0 + s1) / 2, cx = x0 + dx * m, cz = z0 + dz * m;
      for (const sg of [1, -1]) { const o = sg * (w / 2 + t / 2); this.solid(rect(cx + vx * o, cz + vz * o, dx, dz, (s1 - s0) / 2, t / 2), flat(low - 0.05), padd(top, c.stairWallH), { f: 0, mat: c.mats.wall, mt: c.mats.stair, cat: 'under', kind: 'stairwall' }); }
    }
    // (x, z) が部屋（info.rooms の矩形）の中か（縁から pad m 内側まで）
    inRoom(x, z, pad) { for (const k of Object.keys(this.info.rooms)) if (roomHas(this.info.rooms[k], x, z, pad)) return true; return false; }
    lamp(x, z, ux, uz, hl, hw, y) { if (this.city.gameOnly) return; this.vis.push({ poly: rect(x, z, ux, uz, hl, hw), bot: flat(y - 0.1), top: flat(y - 0.02), mat: this.cfg.mats.lamp, mb: this.cfg.mats.lamp, f: NOCOL, cat: 'under' }); } // mb: 下の面（光る面。world.js は y0 ≤ 0.2 の柱の下の面を描かない）

    // ---------- 殻 ----------
    // 空洞 v の殻の板（床・天井・4 つの壁）
    _pieces(v) {
      const T = this.T, out = [], f = v.faces, M = v.mats;
      const ux = v.ux, uz = v.uz, vx = -uz, vz = ux;
      const lo = v.loX, hi = v.hiX; // 壁は床 − T から天井 + T まで
      if (!v.pit) {
        if (f.floor !== false) out.push({ poly: v.polyX, bot: padd(v.lo, -T), top: v.lo, mat: M.floor, mt: M.floor, role: 'floor' });
        if (f.ceil !== false) out.push({ poly: v.polyX, bot: v.hi, top: padd(v.hi, T), mat: M.ceil, mb: M.ceil, role: 'ceil' });
      }
      const wl = v.pit ? flat(v.lo[0] - T) : lo, wh = v.pit ? flat(f.top) : hi;
      for (const s of [1, -1]) {
        out.push({ poly: rect(v.x + vx * s * (v.hw + T / 2), v.z + vz * s * (v.hw + T / 2), ux, uz, v.hl + T, T / 2), bot: wl, top: wh, mat: M.wall, role: 'wall' });
        const em = (s > 0 ? f.endB : f.endA) || M.wall;
        if ((s > 0 ? f.noEndB : f.noEndA)) continue;
        out.push({ poly: rect(v.x + ux * s * (v.hl + T / 2), v.z + uz * s * (v.hl + T / 2), ux, uz, T / 2, v.hw), bot: wl, top: wh, mat: em, role: 'end' });
      }
      for (const p of out) { p.owner = v.idx; p.base = v.base; }
      return out;
    }
    // 板 p から空洞 c の中を抜く（c が先に作った空洞なら c の殻の分 T も = 重なる板は先の空洞の物だけ残す）
    _cut(p, c) {
      const ext = c.idx < p.owner;
      const I = inter(p.poly, ext ? c.polyX : c.poly);
      if (!I.length || area(I) < EA) return null;
      const lo = ext ? c.loX : c.lo, hi = ext ? c.hiX : c.hi;
      let J = clipAbove(I, p.top, lo, 1e-4);
      if (J.length) J = clipAbove(J, hi, p.bot, 1e-4);
      if (!J.length || area(J) < EA) return null;
      const res = [];
      for (const q of minus(p.poly, J)) res.push(Object.assign({}, p, { poly: q }));
      // 床より下・天井より上に残る所。c の床・天井の面と同じ高さになる面は c の床・天井の材質で描く（壁の材質のままだと、同じ面にある床・階段の
      //   面と重なってタイルの帯が見えていた = z-fighting。同じ材質・同じ世界座標の UV なら重なっても見えない）
      const below = clipAbove(J, lo, p.bot, 1e-3); // c の床より下に残る所
      if (below.length && area(below) > EA) res.push(Object.assign({}, p, { poly: below, top: lo }, !ext && c.mats.floor ? { capTop: c.mats.floor } : null));
      const above = clipAbove(J, p.top, hi, 1e-3); // c の天井より上に残る所
      if (above.length && area(above) > EA) res.push(Object.assign({}, p, { poly: above, bot: hi }, !ext && c.mats.ceil ? { capBot: c.mats.ceil } : null));
      return res;
    }
    _shell() {
      let all = [];
      for (const v of this.voids) for (const p of this._pieces(v)) all.push(p);
      const bbs = this.voids.map((v) => bbox(v.polyX));
      for (const c of this.voids) {
        const cb = bbs[c.idx], next = [];
        for (const p of all) {
          if (p.owner === c.idx) { next.push(p); continue; }
          const pb = p.bb || (p.bb = bbox(p.poly));
          if (pb[0] > cb[2] || pb[2] < cb[0] || pb[1] > cb[3] || pb[3] < cb[1]) { next.push(p); continue; }
          const r = this._cut(p, c);
          if (!r) { next.push(p); continue; }
          for (const q of r) { q.bb = null; next.push(q); }
        }
        all = next;
      }
      for (const p of all) {
        let th = -Infinity; // 一番厚い所（斜めの板は縁で 0 になってよい）
        for (let i = 0; i < p.poly.length; i += 2) th = Math.max(th, pev(p.top, p.poly[i], p.poly[i + 1]) - pev(p.bot, p.poly[i], p.poly[i + 1]));
        if (th < 0.01 || area(p.poly) < 0.002) continue;
        this.vis.push(Object.assign(p, { f: NOCOL, cat: 'under' }));
      }
    }

    // ---------- チャンクの格子で切って柱に ----------
    _emitPrism(p, list) {
      const city = this.city, cs = city.cs, X0 = city.minX, Z0 = city.minZ;
      const b = bbox(p.poly);
      for (let i = Math.floor((b[0] - X0) / cs); i <= Math.floor((b[2] - X0 - 1e-9) / cs); i++) for (let j = Math.floor((b[1] - Z0) / cs); j <= Math.floor((b[3] - Z0 - 1e-9) / cs); j++) {
        const x0 = X0 + i * cs, x1 = x0 + cs, z0 = Z0 + j * cs, z1 = z0 + cs;
        let q = p.poly;
        const cx0 = b[0] < x0 - 1e-6, cx1 = b[2] > x1 + 1e-6, cz0 = b[1] < z0 - 1e-6, cz1 = b[3] > z1 + 1e-6;
        if (cx0) q = clip(q, -1, 0, x0);
        if (q.length && cx1) q = clip(q, 1, 0, -x1);
        if (q.length && cz0) q = clip(q, 0, -1, z0);
        if (q.length && cz1) q = clip(q, 0, 1, -z1);
        if (!q.length || area(q) < 0.002) continue;
        const n = q.length >> 1, ring = new Float32Array(q.length);
        for (let k = 0; k < q.length; k++) ring[k] = q[k];
        let clipBits = null;
        if (cx0 || cx1 || cz0 || cz1) { // チャンクの境の切り口（壁にしない）
          for (let e = 0; e < n; e++) {
            const ax = q[e * 2], az = q[e * 2 + 1], bx = q[((e + 1) % n) * 2], bz = q[((e + 1) % n) * 2 + 1];
            const on = (cx0 && Math.abs(ax - x0) < 1e-6 && Math.abs(bx - x0) < 1e-6) || (cx1 && Math.abs(ax - x1) < 1e-6 && Math.abs(bx - x1) < 1e-6) ||
              (cz0 && Math.abs(az - z0) < 1e-6 && Math.abs(bz - z0) < 1e-6) || (cz1 && Math.abs(az - z1) < 1e-6 && Math.abs(bz - z1) < 1e-6);
            if (on) (clipBits || (clipBits = new Uint8Array((n + 7) >> 3)))[e >> 3] |= 1 << (e & 7);
          }
        }
        const o = { ring, holes: [], clip: clipBits, tri: fan(n), f: p.f, mat: p.mat, cat: p.cat || 'under', ck: i + '_' + j };
        if (p.mt) o.mt = p.mt; if (p.mb) o.mb = p.mb; if (p.mw) o.mw = p.mw;
        if (p.base != null) o.base = p.base;
        if (p.stair) o.stair = 1;
        if (p.kind) o.kind = p.kind;
        if (p.station != null) o.station = p.station;
        if (p.rail != null) o.rail = p.rail; // 入口の手すり（入口 i × 4 + 両側 0 / 1・下の端 2。チャンクの境で切れても同じ値）
        const ft = isFlat(p.top), fb = isFlat(p.bot);
        if (p.capTop) { if (ft && fb) o.mt = p.capTop; else { o.mw = p.mw || p.mat; o.mat = p.capTop; } } // 上面の材質（_cut。斜めの柱は mat が上面・mw が壁）
        if (p.capBot) o.mb = p.capBot;
        if (ft && fb) { o.y0 = r3(p.bot[0]); o.y1 = r3(p.top[0]); }
        else { o.top = p.top.slice(); o.bp = p.bot.slice(); o.y0 = pmin(q, p.bot); o.y1 = pmax(q, p.top); o.t = Math.max(0.05, pmax(q, p.top) - pmax(q, p.bot)); }
        list.push(o);
      }
    }
    // 線路の折れ線をチャンクごとに
    _emitTrack(ax, az, bx, bz, y, station) {
      if (this.city.gameOnly) return; // 線路の帯は描画の層だけ（finish の geom と同じ）
      const city = this.city, cs = city.cs, X0 = city.minX, Z0 = city.minZ, ts = [0, 1];
      for (const [a, b, o] of [[ax, bx, X0], [az, bz, Z0]]) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let g = Math.ceil((lo - o) / cs) * cs + o; g < hi; g += cs) if (Math.abs(b - a) > 1e-9) ts.push((g - a) / (b - a));
      }
      ts.sort((p, q) => p - q);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-6) continue;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const c = city.chunkOf(mx, mz);
        this.decals.push({ type: 'track', x: r3(mx), z: r3(mz), pts: [x0, y, z0, x1, y, z1], cls: 0, flags: 2, stub: 1, under: 1, station, ck: c.cx + '_' + c.cz });
      }
    }
    finish(id) {
      // 川底の下: 空洞の天井（+ 殻）は地面（川底・陸 0）より下でなければならない（上に出ると空洞が水の中に入る）。出れば作らない（例外）
      for (const v of this.voids) {
        if (v.pit) continue;
        const pts = v.poly.concat([v.x, v.z]);
        for (let i = 0; i < pts.length; i += 2) {
          if (this.pits.some((q) => MR.Underground.inObb(q, pts[i], pts[i + 1], 0.05))) continue; // 穴の中（上は空）
          const g = this.city.groundAt(pts[i], pts[i + 1]), topY = pev(v.hi, pts[i], pts[i + 1]);
          if (g.water !== null || topY > g.y - 0.05) throw new Error(v.kind + ' void top ' + topY.toFixed(2) + ' above the ground / riverbed ' + g.y.toFixed(2) + ' at ' + pts[i].toFixed(1) + ',' + pts[i + 1].toFixed(1));
        }
      }
      // サーバー（gameOnly）は見た目だけの殻・灯り・線路を作らない（chunkCoarse も gameOnly の chunkFull も読まない。Worker の起動が倍になっていた）
      const geom = !this.city.gameOnly;
      if (geom) this._shell();
      const prisms = [], vis = [];
      for (const p of this.prisms) this._emitPrism(p, prisms);
      if (geom) for (const p of this.vis) this._emitPrism(p, vis);
      const voids = this.voids.filter((v) => !v.pit).map((v) => v.rec);
      return { id, pits: this.pits, voids, boxes: this.boxes, ramps: [], prisms, shellPrisms: vis, decals: this.decals, loot: this.loot, spawns: this.spawns, shell: false, info: this.info };
    }
  }

  // ===== layout → サイト =====
  // ucfg（レベルの underground）: { enabled, shell, slope, bedBelow, trackClear, hallH, stubH, stub, stairW, stairH, landing, lap, corridorW, corridorH,
  //   fareH, fareT, cabinet, lampEvery, stubLampEvery, lootTable, spawnEvery, mats: { … }, layouts: [ … ] }
  function build(city, ucfg) {
    const cfg = Object.assign({ shell: 0.3, slope: 0.6, bedBelow: 1.13, trackClear: 2.2, trackOff: 1.6, hallH: 5, stubH: 4.6, stub: 50, stairW: 2.4, stairH: 3.0, streetStairH: 2.6,
      landing: 2, lap: 1.0, corridorW: 3, corridorH: 3, fareH: 1.0, fareT: 0.3, cabinet: 0.9, lampEvery: 7, stubLampEvery: 15, roomLampEvery: 6, lootTable: 'interior',
      spawnEvery: 30, stairWallH: 1.0, stairWallT: 0.15, railH: 1.1, railT: 0.06, endStepW: 2.0, entTol: 8, platTol: 15, stationTol: 80, entSnap: 0.3, gridCell: 1, stairPass: 1.75,
      mats: { wall: 'subway_tile', floor: 'platform_concrete', ceil: 'platform_concrete', tunnel: 'tunnel_wall', end: 'tunnelDark', stair: 'platform_concrete', pit: 'subway_tile', lamp: 'lampGlow', fare: 'curb', rail: 'railing' } }, ucfg || {});
    cfg.mats = Object.assign({ wall: 'subway_tile', floor: 'platform_concrete', ceil: 'platform_concrete', tunnel: 'tunnel_wall', end: 'tunnelDark', stair: 'platform_concrete', pit: 'subway_tile', lamp: 'lampGlow', fare: 'curb', rail: 'railing' }, (ucfg && ucfg.mats) || {});
    const sites = [], report = [];
    if (!city || !city.stations || cfg.enabled === false) return { sites, report };
    for (const L of cfg.layouts || []) {
      try {
        const r = buildOne(city, cfg, L);
        if (r) { sites.push(r.site); report.push(r.report); }
      } catch (e) { report.push({ id: L.id, error: String(e && e.message || e) }); if (typeof console !== 'undefined') console.warn('[Stations] ' + L.id + ': ' + (e && e.message)); }
    }
    return { sites, report };
  }

  function nearest(list, x, z, tol) { let best = null, bd = tol; for (const e of list) { const d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; best = e; } } return best; }

  function buildOne(city, cfg, L) {
    const st = nearest(city.stations, L.near[0], L.near[1], cfg.stationTol);
    if (!st) throw new Error('no station near ' + L.near);
    const B = new Builder(city, cfg), M = cfg.mats, T = cfg.shell, top = (city.curbH != null ? city.curbH : 0.15);
    const info = B.info;
    info.station = st.i; info.ja = L.ja || null;
    // --- 部屋（改札階。軸に沿った矩形）---
    const rooms = {};
    // rect = 回す前の矩形（世界の軸）、rot（度、任意 = NC7）= 真ん中のまわりに回す（u = (cos, sin)。回ったホームに沿う改札階）
    for (const R of L.rooms || []) {
      const [x0, z0, x1, z1] = R.rect, y = R.y, h = R.h, rot = R.rot || 0;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hl = (x1 - x0) / 2, hw = (z1 - z0) / 2;
      const [ux, uz] = rot ? rotU(1, 0, rot) : [1, 0], vx = -uz, vz = ux;
      const v = B.addVoid({ kind: 'room', x: cx, z: cz, ux, uz, hl, hw, ya: y, h, mats: { wall: M.wall, floor: M.floor, ceil: M.ceil } });
      rooms[R.id] = { v, rect: R.rect, y, h, poly: v.poly, rot, x: cx, z: cz, ux, uz, hl, hw };
      info.rooms[R.id] = rot ? { rect: R.rect.slice(), y, h, rot, x: cx, z: cz, ux, uz, hl, hw } : { rect: R.rect.slice(), y, h };
      const e = cfg.roomLampEvery;
      if (!rot) for (let x = x0 + e / 2; x < x1; x += e) for (let z = z0 + e / 2; z < z1; z += e) B.lamp(x, z, 1, 0, 0.9, 0.12, y + h);
      else for (let a = -hl + e / 2; a < hl; a += e) for (let b = -hw + e / 2; b < hw; b += e) B.lamp(cx + ux * a + vx * b, cz + uz * a + vz * b, ux, uz, 0.9, 0.12, y + h);
      B.loot.push(rot ? { x: cx + ux * 1.3 + vx * 1.1, y, z: cz + uz * 1.3 + vz * 1.1, table: cfg.lootTable } : { x: cx + 1.3, y, z: cz + 1.1, table: cfg.lootTable });
    }
    // --- ホームのまとまり（hall）---
    const halls = [];
    for (const H of L.halls || []) {
      const plats = [];
      for (const [k, q] of H.plats.entries()) { const r = layoutPlat(st, q, k, cfg.platTol); plats.push({ p: r.p, q, y: r.y }); }
      const p0 = plats[0].p, ux = p0.ux, uz = p0.uz, vx = -uz, vz = ux, ox = p0.x, oz = p0.z;
      const S = (x, z) => (x - ox) * ux + (z - oz) * uz, Lp = (x, z) => (x - ox) * vx + (z - oz) * vz;
      const py = plats[0].y, bed = py - cfg.bedBelow;
      let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity;
      const tracks = [];
      for (const { p } of plats) {
        const sc = S(p.x, p.z), lc = Lp(p.x, p.z);
        // ホームの軸のずれ（同じまとまりの中の向きの違い）は ≤ 2° を前提に、まとまりの軸の座標で長さを測る
        s0 = Math.min(s0, sc - p.hl); s1 = Math.max(s1, sc + p.hl);
        l0 = Math.min(l0, lc - p.hw); l1 = Math.max(l1, lc + p.hw);
        // 線路: + 側 = 軸を (uz, −ux) に回した向き（README の STAT）= 横 v の −1 倍
        const pv = (p.uz * vx - p.ux * vz) > 0 ? 1 : -1; // (uz, −ux)·v
        if (p.flags & 1) tracks.push(lc + pv * (p.hw + cfg.trackOff));
        if (p.flags & 2) tracks.push(lc - pv * (p.hw + cfg.trackOff));
      }
      for (const t of H.extraTracks || []) tracks.push(t); // データに無い線路（まとまりの横の座標 = 最初のホームの軸から v の向きへ m）
      tracks.sort((a, b) => a - b);
      const tr = [];
      for (const t of tracks) if (!tr.length || t - tr[tr.length - 1] > 1.0) tr.push(t);
      for (const t of tr) { l0 = Math.min(l0, t - cfg.trackClear); l1 = Math.max(l1, t + cfg.trackClear); }
      const sc = (s0 + s1) / 2, lc = (l0 + l1) / 2, hl = (s1 - s0) / 2, hw = (l1 - l0) / 2;
      const cx = ox + ux * sc + vx * lc, cz = oz + uz * sc + vz * lc;
      const hallH = H.h || cfg.hallH;
      const hall = B.addVoid({ kind: 'hall', x: cx, z: cz, ux, uz, hl, hw, ya: bed, h: hallH, mats: { wall: M.wall, floor: M.tunnel, ceil: M.ceil } });
      const stubL = H.stub != null ? H.stub : cfg.stub;
      const stubLen = H.stubs ? H.stubs : [stubL, stubL]; // 両端の長さ（−軸の端・+軸の端。任意 = NC7）
      const stubs = [];
      for (const sg of [-1, 1]) {
        const stubL = stubLen[sg < 0 ? 0 : 1];
        const sx = cx + ux * sg * (hl + stubL / 2 - 0.25), sz = cz + uz * sg * (hl + stubL / 2 - 0.25);
        const faces = sg > 0 ? { endB: M.end } : { endA: M.end };
        const sv = B.addVoid({ kind: 'stub', x: sx, z: sz, ux, uz, hl: stubL / 2 + 0.25, hw, ya: bed, h: cfg.stubH, mats: { wall: M.tunnel, floor: M.tunnel, ceil: M.tunnel }, faces });
        stubs.push(sv);
        const ex = cx + ux * sg * (hl + stubL), ez = cz + uz * sg * (hl + stubL);
        info.stubs.push({ hall: halls.length, end: [ex, ez], inner: [ex - ux * sg * 1.5, ez - uz * sg * 1.5], y: bed, dir: sg });
        for (let s = cfg.stubLampEvery / 2; s < stubL; s += cfg.stubLampEvery) B.lamp(cx + ux * sg * (hl + s) + vx * lc * 0, cz + uz * sg * (hl + s), ux, uz, 0.6, 0.1, bed + cfg.stubH);
      }
      // 灯り（ホームの上に 2 列）
      for (let s = -hl + cfg.lampEvery / 2; s < hl; s += cfg.lampEvery) for (const o of [-hw / 2, hw / 2]) B.lamp(cx + ux * s + vx * o, cz + uz * s + vz * o, ux, uz, 1.2, 0.12, bed + hallH);
      // 線路（トンネルの奥から奥まで）
      const extA = hl + stubLen[0], extB = hl + stubLen[1];
      for (const t of tr) {
        const ax = cx + ux * -extA + vx * (t - lc), az = cz + uz * -extA + vz * (t - lc), bx = cx + ux * extB + vx * (t - lc), bz = cz + uz * extB + vz * (t - lc);
        B._emitTrack(ax, az, bx, bz, bed, st.i);
      }
      // ホームの柱・端の段・落ちている物・敵の出る点
      const hinfo = { x: cx, z: cz, ux, uz, hl, hw, bed, y: py, plats: [], tracks: tr.map((t) => t - lc), stubL, id: H.id || null, lines: H.lines || null };
      if (H.stubs) hinfo.stubs = stubLen.slice();
      for (const { p, y } of plats) {
        B.solid(rect(p.x, p.z, p.ux, p.uz, p.hl, p.hw), flat(bed - 0.05), flat(y), { f: WALK, mat: M.floor, mt: M.floor, base: bed, cat: 'under', kind: 'platform' });
        const run = (y - bed) / cfg.slope;
        for (const sg of [-1, 1]) {
          const ex = p.x + p.ux * sg * p.hl, ez = p.z + p.uz * sg * p.hl;
          B.ramp(ex - p.ux * sg * 0.05, ez - p.uz * sg * 0.05, p.ux * sg, p.uz * sg, run + 0.05, cfg.endStepW, y, bed, (y - bed) + 0.2, M.stair);
        }
        hinfo.plats.push({ i: p.i, synth: !!p.synth, x: p.x, z: p.z, ux: p.ux, uz: p.uz, hl: p.hl, hw: p.hw, y, ends: [[p.x - p.ux * (p.hl + run + 1), p.z - p.uz * (p.hl + run + 1)], [p.x + p.ux * (p.hl + run + 1), p.z + p.uz * (p.hl + run + 1)]] });
        B.loot.push({ x: p.x + p.ux * p.hl * 0.45, y, z: p.z + p.uz * p.hl * 0.45, table: cfg.lootTable });
      }
      halls.push({ v: hall, stubs, plats, hinfo });
      info.halls.push(hinfo);
    }
    // --- ホームへの階段（部屋の縁 at からホームの軸に沿って dir の向きへ下る）---
    const stairPolys = [];
    for (const [hi, H] of (L.halls || []).entries()) {
      const hall = halls[hi];
      for (const [pi, q] of H.plats.entries()) {
        const { p, y } = hall.plats[pi];
        for (const sd of q.stairs || []) {
          const room = rooms[sd.room];
          if (!room) throw new Error('stair: no room ' + sd.room);
          const d = sd.dir < 0 ? -1 : 1, dx = p.ux * d, dz = p.uz * d;
          const s = (sd.at[0] - p.x) * p.ux + (sd.at[1] - p.z) * p.uz;
          // 上の端（ホームの軸の上。off m = ホームの横 v = (−uz, ux) へずらす: 幅の狭い相対式ホームで階段の横に人が通れる幅を片側に残す = NC7 の検証）
          const off = sd.off || 0, tx = p.x + p.ux * s - p.uz * off, tz = p.z + p.uz * s + p.ux * off;
          const w = sd.w || cfg.stairW, run = (room.y - y) / cfg.slope;
          // 斜めの所が部屋の床に入らない所から下る（部屋の床 = 空洞の床が斜面の上に残らない）
          let L0 = 0.3;
          for (; L0 < 6; L0 += 0.1) { const P = rect(tx + dx * (L0 + 0.5), tz + dz * (L0 + 0.5), dx, dz, 0.5, w / 2 + T); if (area(inter(P, room.poly)) < 1e-4) break; }
          // 踊り場（部屋に lap m 入る）+ 斜めの空洞 + ホームの空洞へ 0.5 m 入る
          const la = cfg.lap, lx = tx + dx * (L0 - la) / 2, lz = tz + dz * (L0 - la) / 2;
          B.addVoid({ kind: 'landing', x: lx, z: lz, ux: dx, uz: dz, hl: (L0 + la) / 2 + 0.25, hw: w / 2, ya: room.y, h: cfg.stairH, mats: { wall: M.wall, floor: M.floor, ceil: M.ceil } });
          const sx0 = tx + dx * L0, sz0 = tz + dz * L0;
          const len = run + 0.5;
          B.addVoid({ kind: 'stair', x: sx0 + dx * len / 2, z: sz0 + dz * len / 2, ux: dx, uz: dz, hl: len / 2, hw: w / 2, ya: room.y, yb: room.y - cfg.slope * len, h: cfg.stairH, mats: { wall: M.wall, floor: M.stair, ceil: M.ceil } });
          const rtop = B.ramp(sx0, sz0, dx, dz, run, w, room.y, y, sd.t || 0.5, M.stair);
          const hallTop = hall.hinfo.bed + (L.halls[hi].h || cfg.hallH); // ホームの空洞の中に出た所だけ（上は斜めの空洞の殻の中）
          B.sideWalls(sx0, sz0, dx, dz, Math.max(0, (room.y + cfg.stairWallH - hallTop) / cfg.slope), run, w, rtop, y);
          const foot = [sx0 + dx * run, sz0 + dz * run];
          stairPolys.push(rect(sx0 + dx * run / 2, sz0 + dz * run / 2, dx, dz, run / 2 + 0.5, w / 2 + 0.3));
          // block: 階段の横の通れる幅（広い側）が stairPass m より狭い = 敵の歩行グラフ（膨らませ 0.45 m）は階段の横を通れない。
          //   敵の道順（route）はホームを階段の上の端と下の端の間で分ける（向こう側へは線路を回る）。sa / sb = ホームの軸の上の範囲
          const sTop = (tx - p.x) * p.ux + (tz - p.z) * p.uz, sFoot = (foot[0] - p.x) * p.ux + (foot[1] - p.z) * p.uz;
          const block = p.hw + Math.abs(off) - w / 2 - cfg.stairWallT < cfg.stairPass;
          info.stairs.push({ room: sd.room, plat: p.i, top: [tx, tz], start: [sx0, sz0], foot, dir: [dx, dz], y0: room.y, y1: y, w, block, sa: Math.min(sTop, sFoot), sb: Math.max(sTop, sFoot) });
        }
      }
    }
    // --- 入口（地面の穴 + 階段 + 屋根のある階段 + 踊り場 + 通路）---
    for (const [k, E] of (L.ents || []).entries()) {
      // set: { x, z, yaw（度 = STAT と同じ u = (sin, cos)）, w, l }（NC7: MTA の入口を置けなかった駅の入口。i は負の数）
      let e;
      if (E.set) { const S = E.set, a = (S.yaw || 0) * Math.PI / 180; e = { i: -(k + 1), x: S.x, z: S.z, ux: Math.round(Math.sin(a) * 1e9) / 1e9, uz: Math.round(Math.cos(a) * 1e9) / 1e9, w: S.w || 1.8, l: S.l || 6, kind: 0, synth: true }; }
      else e = nearest(st.ents, E.near[0], E.near[1], cfg.entTol);
      if (!e) throw new Error('no entrance near ' + E.near);
      const room = rooms[E.room];
      if (!room) throw new Error('entrance: no room ' + E.room);
      // turn（度。レイアウトの上書き = core の STAT の入口は変えない）: 穴の向きを真ん中のまわりに回す。STAT の向きのままだと開いた端
      //   （階段の上の端）が車道を向く入口がある（126 は 3 m 先が 42 丁目の交差点、127 は 1.5 m 先が車道）→ 開いた端が歩道に向く向きに。
      //   NC4 の印は穴の真ん中が口の囲いの中なので出ない（_stationMarks の _inCut）
      let ux = e.ux, uz = e.uz;
      if (E.turn) { const a = E.turn * Math.PI / 180, c = Math.round(Math.cos(a) * 1e9) / 1e9, sn = Math.round(Math.sin(a) * 1e9) / 1e9; ux = e.ux * c - e.uz * sn; uz = e.ux * sn + e.uz * c; }
      // 格子に合わせる（NC7 の直し）: 階段は幅 w（1.8 m）で手すりを敵の歩行グラフの膨らませ（agentRadius 0.45）で太らせると通れる帯は
      //   w − 2 × 0.45 − 手すり < 1 m。1 m 格子の節点がその帯に入るのは階段の中心線が升の真ん中から 0.3 m 以内のときだけ = 軸に沿った入口は
      //   横の座標を升の真ん中（floor(v) + 0.5）へ寄せる（entSnap m より離れているときだけ。最大 0.5 m。STAT の入口の位置は変えない）
      let ex = e.x, ez = e.z;
      //   E.snap（任意）: +1 / −1 = 上 / 下の升の真ん中へ（近い方が建物・車道にかかる入口。city-test-stations が全部の入口の穴を確かめる）
      const gc = cfg.gridCell, snapC = (v) => {
        const lo = (Math.floor(v / gc - 0.5) + 0.5) * gc, hi = lo + gc, c = E.snap > 0 ? hi : E.snap < 0 ? lo : (v - lo < hi - v ? lo : hi);
        return Math.abs(v - c) > cfg.entSnap || E.snap ? c : v;
      };
      if (Math.abs(uz) < 1e-6) ez = snapC(ez); else if (Math.abs(ux) < 1e-6) ex = snapC(ex);
      const vx = -uz, vz = ux, hl = e.l / 2, hw = e.w / 2, ty = room.y;
      const drop = top - ty, run = drop / cfg.slope; // 歩道の上面 → 部屋の床
      const yPitEnd = top - cfg.slope * Math.min(run, 2 * hl);
      const pitY = yPitEnd - 0.05;
      B.addPit({ x: ex, z: ez, ux, uz, hl, hw, y: pitY, top });
      const ax = ex - ux * hl, az = ez - uz * hl; // 下り始め（開いている端）
      // 階段（穴の中から部屋の床まで。下は楔 = 階段の下へ入れない）
      const bx = ax + ux * run, bz = az + uz * run;
      const inRoom = (x, z) => roomHas(room, x, z, 1e-9);
      const endIn = inRoom(bx, bz) && inRoom(ex + ux * hl, ez + uz * hl);
      // 部屋の中に下りる階段の下の楔の横の面は壁のタイル（以前はコンクリートの箱に見えた = NC7 の検証）
      const etop = B.ramp(ax, az, ux, uz, run, 2 * hw, top, ty, drop + 0.3, M.stair, endIn ? M.wall : null);
      // 屋根のある階段（穴の先。部屋の中なら要らない）・踊り場・通路
      const covered = run > 2 * hl + 0.05;
      if (endIn) B.sideWalls(ax, az, ux, uz, 2 * hl, run, 2 * hw, etop, ty); // 部屋の中に下りる所（穴の先）は横が開いている
      if (covered && !endIn) {
        const s0 = 2 * hl - 0.5, len = run - s0 + 0.25, mx = ax + ux * (s0 + len / 2), mz = az + uz * (s0 + len / 2);
        B.addVoid({ kind: 'estair', x: mx, z: mz, ux, uz, hl: len / 2, hw, ya: top - cfg.slope * s0, yb: top - cfg.slope * (s0 + len), h: cfg.streetStairH, mats: { wall: M.wall, floor: M.stair, ceil: M.ceil } });
      }
      let px = bx + ux * cfg.landing, pz = bz + uz * cfg.landing;
      if (!endIn) B.addVoid({ kind: 'landing', x: bx + ux * (cfg.landing / 2 - 0.25), z: bz + uz * (cfg.landing / 2 - 0.25), ux, uz, hl: cfg.landing / 2 + 0.25, hw, ya: ty, h: Math.max(cfg.corridorH, cfg.streetStairH + 0.4), mats: { wall: M.wall, floor: M.floor, ceil: M.ceil } });
      const path = [[px, pz]].concat(E.path || []);
      if (!endIn) for (let k = 0; k + 1 < path.length; k++) addCorridor(B, cfg, path[k], path[k + 1], ty, E.w || cfg.corridorW, E.h || cfg.corridorH, k === 0 ? 0.5 : (E.w || cfg.corridorW) / 2, (E.w || cfg.corridorW) / 2);
      // 手すり（歩道の上: 両側と下の端 = NC4 の印の代わり。開いた端から入る）
      const t = cfg.railT / 2;
      for (const s of [1, -1]) { const o = s * (hw - t); B.solid(rect(ex + vx * o, ez + vz * o, ux, uz, hl, t), flat(top), flat(top + cfg.railH), { f: NOLOS, mat: M.rail, cat: 'fence', kind: 'station', rail: e.i * 4 + (s > 0 ? 0 : 1) }); }
      B.solid(rect(ex + ux * (hl - t), ez + uz * (hl - t), ux, uz, t, hw - 2 * t), flat(top), flat(top + cfg.railH), { f: NOLOS, mat: M.rail, cat: 'fence', kind: 'station', rail: e.i * 4 + 2 });
      info.ents.push({ i: e.i, synth: !!e.synth, x: ex, z: ez, ux, uz, hl, hw, top, street: [ax - ux * 3, az - uz * 3], open: [ax, az], foot: [bx, bz], room: E.room, path: path.map((q) => q.slice()), pitY });
      stairPolys.push(rect(ex + ux * (run / 2 - hl), ez + uz * (run / 2 - hl), ux, uz, run / 2 + 0.3, hw + 0.3));
    }
    // --- 部屋どうしの通路 ---
    for (const K of L.links || []) {
      const y = K.y != null ? K.y : rooms[K.room || Object.keys(rooms)[0]].y;
      for (let k = 0; k + 1 < K.path.length; k++) addCorridor(B, cfg, K.path[k], K.path[k + 1], y, K.w || cfg.corridorW, K.h || cfg.corridorH, (K.w || cfg.corridorW) / 2, (K.w || cfg.corridorW) / 2);
      info.links.push({ path: K.path.map((q) => q.slice()), y });
    }
    // --- 改札（部屋を横切る線。1.0 m の箱 = 乗り越え。gate の間は通用口 = 歩いて通れる）---
    for (const F of L.fare || []) {
      const room = rooms[F.room], r = room.rect, y = room.y, hT = cfg.fareT / 2;
      if (room.rot) throw new Error('fare: room ' + F.room + ' is rotated (fare lines are world-axis boxes)');
      const alongZ = F.axis === 'x'; // x = 一定の線（z に沿う）
      // span（任意 = NC7 の検証）: 線の範囲（無ければ部屋の端から端まで）。部分の線を組み合わせて階段の上を囲う（有料の側 = 囲いの中）。
      //   gate が無い線は通用口なし（囲いのほかの辺）
      const a0 = F.span ? F.span[0] : alongZ ? r[1] : r[0], a1 = F.span ? F.span[1] : alongZ ? r[3] : r[2];
      const g0 = F.gate ? F.gate[0] : a1, g1 = F.gate ? F.gate[1] : a1;
      const seg = (s, e) => {
        if (e - s < 0.05) return;
        const m = (s + e) / 2, L2 = e - s;
        const bx = alongZ ? F.at : m, bz = alongZ ? m : F.at;
        B.boxes.push({ x: bx, y, z: bz, w: alongZ ? cfg.fareT : L2, h: cfg.fareH, d: alongZ ? L2 : cfg.fareT, f: NOLOS, mat: M.fare, cat: 'under', kind: 'fare' });
        for (let c = s + cfg.cabinet / 2; c < e - 0.2; c += cfg.cabinet) { // 改札機の箱（見た目）
          const cx = alongZ ? F.at : c, cz = alongZ ? c : F.at;
          B.boxes.push({ x: cx, y, z: cz, w: alongZ ? 0.8 : 0.22, h: cfg.fareH + 0.05, d: alongZ ? 0.22 : 0.8, f: NOCOL, mat: M.fare, cat: 'under' });
        }
      };
      seg(a0, g0); seg(g1, a1);
      info.fare.push({ room: F.room, axis: F.axis, at: F.at, gate: F.gate ? [g0, g1] : null, span: [a0, a1], y, h: cfg.fareH, hT });
      stairPolys.push(alongZ ? ccw([F.at - 1, a0, F.at + 1, a0, F.at + 1, a1, F.at - 1, a1]) : ccw([a0, F.at - 1, a1, F.at - 1, a1, F.at + 1, a0, F.at + 1]));
    }
    // --- 敵の出る点（ホームの軸に沿って spawnEvery m ごと・部屋の格子。階段・改札の上は除く）---
    const blocked = (x, z) => stairPolys.some((P) => inter(rect(x, z, 1, 0, 0.5, 0.5), P).length > 0);
    for (const hall of halls) for (const { p, y } of hall.plats) {
      for (let s = -p.hl + 6; s <= p.hl - 6; s += cfg.spawnEvery) { const x = p.x + p.ux * s, z = p.z + p.uz * s; if (!blocked(x, z)) B.spawns.push({ x: r3(x), y, z: r3(z), kind: 'platform', station: st.i }); }
    }
    for (const id of Object.keys(rooms)) {
      const R = rooms[id], r = R.rect;
      if (!R.rot) { for (let x = r[0] + 3; x < r[2] - 2; x += 10) for (let z = r[1] + 3; z < r[3] - 2; z += 10) if (!blocked(x, z)) B.spawns.push({ x: r3(x), y: R.y, z: r3(z), kind: 'mezz', station: st.i }); continue; }
      for (let a = -R.hl + 3; a < R.hl - 2; a += 10) for (let b = -R.hw + 3; b < R.hw - 2; b += 10) { const x = R.x + R.ux * a - R.uz * b, z = R.z + R.uz * a + R.ux * b; if (!blocked(x, z)) B.spawns.push({ x: r3(x), y: R.y, z: r3(z), kind: 'mezz', station: st.i }); }
    }
    const site = B.finish('station_' + L.id);
    site.info.id = L.id;
    const report = { id: L.id, station: st.i, rooms: Object.keys(rooms).length, halls: halls.length, ents: info.ents.length, stairs: info.stairs.length, voids: site.voids.length, pits: site.pits.length,
      prisms: site.prisms.length, shell: site.shellPrisms.length, decals: site.decals.length, loot: site.loot.length, spawns: site.spawns.length };
    return { site, report };
  }

  // 通路の 1 区間（a → b、両端を ea / eb m 延ばす = 角で重なる）
  function addCorridor(B, cfg, a, b, y, w, h, ea, eb) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.05) return;
    const ux = dx / L, uz = dz / L, s0 = -ea, s1 = L + eb, hl = (s1 - s0) / 2, m = (s0 + s1) / 2;
    const M = cfg.mats;
    B.addVoid({ kind: 'corridor', x: a[0] + ux * m, z: a[1] + uz * m, ux, uz, hl, hw: w / 2, ya: y, h, mats: { wall: M.wall, floor: M.floor, ceil: M.ceil } });
    for (let s = s0 + cfg.roomLampEvery / 2; s < s1; s += cfg.roomLampEvery) {
      const lx = a[0] + ux * s, lz = a[1] + uz * s;
      if (B.inRoom(lx, lz, 1.0)) continue; // 部屋の中に入った所（部屋の天井の方が高い）に通路の灯りを吊らない（宙に浮いていた）
      B.lamp(lx, lz, ux, uz, 0.9, 0.12, y + h);
    }
    B.info.links.push({ corridor: [[a[0], a[1]], [b[0], b[1]]], y, w });
  }

  // レベルのプラン → MR.Underground（駅は CityGenNyc の attach で作る）。underground が無い・無効・駅が無ければ null
  function underground(plan, opts) {
    const u = plan && plan.underground;
    if (!u || u.enabled === false || !(u.layouts && u.layouts.length) || !MR.Underground) return null;
    const U = new MR.Underground({ build: (city) => { const r = build(city, Object.assign({}, u, opts || {})); U.stations = r.sites.map((s) => s.info); U.report = r.report; return r.sites; } });
    U.stations = [];
    return U;
  }

  // ===== 敵の道順（NC7 の直し）=====
  //   駅の中の歩行グラフの探索は 1 回では長すぎる（通り → 口 → 改札階 → 通路 → 別の部屋 → 改札 → 階段 → ホームは A* が通りと部屋をなめて
  //   6 万個まで展開した）→ 駅の記録（info）の点（入口: 歩道・開いた端・階段の下・通路の角、ホームへの階段: 上・斜面の始め・下、部屋どうしの
  //   通路の角、改札を横切るときは通用口の両側）を順に歩く道順 legs にする。1 区間はどれも短い（展開は数百個）。
  //   place(S, p) → 's'（通り）| 'r:<部屋>' | 'h:<まとまり>' | null。route(S, from, to) → { legs: [{ x, y, z }], key, from, to } | null
  //   （同じ所・駅の外・つながっていない → null。legs は from と to を含まない。key = 行き先の所 = 敵が道順を作り直すかの目安）
  function inHall(h, x, z, m) {
    const st = h.stubs ? Math.max(h.stubs[0], h.stubs[1]) : (h.stubL || 0);
    const dx = x - h.x, dz = z - h.z, s = dx * h.ux + dz * h.uz, l = -dx * h.uz + dz * h.ux;
    return Math.abs(s) <= h.hl + st + m && Math.abs(l) <= h.hw + m;
  }
  function place(S, p) {
    const top = S.ents.length ? S.ents[0].top : 0.15;
    if (p.y > top - 1.2) return 's';
    for (const id of Object.keys(S.rooms)) { const R = S.rooms[id]; if (Math.abs(p.y - R.y) < 1.2 && roomHas(R, p.x, p.z, 0.3)) return 'r:' + id; }
    for (let k = 0; k < S.halls.length; k++) for (const q of S.halls[k].plats) if (Math.abs(p.y - q.y) < 0.6 && MR.Underground.inObb(q, p.x, p.z, 0.3)) {
      // 横を通れない階段（block）の真ん中より先 = 別の所（数）
      const sp = (p.x - q.x) * q.ux + (p.z - q.z) * q.uz;
      let n = 0;
      for (const st of S.stairs) if (st.block && st.plat === q.i && (st.sa + st.sb) / 2 < sp) n++;
      return 'p:' + k + ':' + q.i + (n ? ':' + n : '');
    }
    for (let k = 0; k < S.halls.length; k++) { const h = S.halls[k]; if (p.y > h.bed - 0.6 && p.y < h.y + 2.5 && inHall(h, p.x, p.z, 0.3)) return 'h:' + k; }
    return null;
  }
  // 部屋 id の中を a → b と歩くときに横切る改札の通用口の両側の点（順に）
  function fareVia(S, id, a, b) {
    const out = [];
    for (const f of S.fare || []) {
      if (f.room !== id || !f.gate) continue;
      const ax = f.axis === 'x', sa = (ax ? a.x : a.z) - f.at, sb = (ax ? b.x : b.z) - f.at;
      if (sa * sb >= 0) continue;
      const t = sa / (sa - sb), al = ax ? a.z + (b.z - a.z) * t : a.x + (b.x - a.x) * t; // 線を横切る所が線の範囲（span）の中だけ
      if (al < f.span[0] - 0.5 || al > f.span[1] + 0.5) continue;
      const g = (f.gate[0] + f.gate[1]) / 2, o = sa < 0 ? -1.5 : 1.5;
      for (const d of [o, -o]) out.push(ax ? { x: f.at + d, y: f.y, z: g } : { x: g, y: f.y, z: f.at + d });
    }
    return out;
  }
  function routeGraph(S) {
    if (S._route) return S._route;
    const N = [];
    const add = (x, y, z, pl) => { const n = { x, y, z, pl: pl !== undefined ? pl : place(S, { x, y, z }), adj: [] }; N.push(n); return n; };
    const link = (a, b) => { const c = cost(a, b); a.adj.push([b, c]); b.adj.push([a, c]); };
    const cost = (a, b) => {
      const v = (a.pl && a.pl === b.pl && a.pl[0] === 'r') ? fareVia(S, a.pl.slice(2), a, b) : [];
      let d = 0, p = a;
      for (const q of v.concat([b])) { d += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z); p = q; }
      return d;
    };
    const chain = (list) => { for (let k = 0; k + 1 < list.length; k++) link(list[k], list[k + 1]); };
    for (const e of S.ents) {
      const R = S.rooms[e.room], L = [add(e.street[0], e.top, e.street[1], 's'), add(e.open[0], e.top, e.open[1], null), add(e.foot[0], R.y, e.foot[1])];
      for (const q of (e.path || []).slice(1)) L.push(add(q[0], R.y, q[1])); // path[0] = 踊り場の先（通路の角 = 格子の節点が無いことがある）は飛ばす
      const last = L[L.length - 1];
      if (last.pl !== 'r:' + e.room) last.pl = 'r:' + e.room; // 通路の終わり = 部屋の縁
      chain(L);
    }
    for (const st of S.stairs) {
      const R = S.rooms[st.room];
      let hk = -1;
      S.halls.forEach((h, k) => { if (h.plats.some((p) => p.i === st.plat)) hk = k; });
      const L = [add(st.top[0], R.y, st.top[1], 'r:' + st.room), add(st.start[0], R.y, st.start[1], null), add(st.foot[0], st.y1, st.foot[1], hk >= 0 ? undefined : null)];
      chain(L);
    }
    // ホームの両端: ホームの上の端の手前 1 m → 端の段の先の線路の床（ほかのホーム・トンネルへは線路を通る）
    S.halls.forEach((h, k) => {
      for (const q of h.plats) for (const [j, sg] of [[0, -1], [1, 1]]) {
        const a = add(q.x + q.ux * sg * (q.hl - 1), q.y, q.z + q.uz * sg * (q.hl - 1)), b = add(q.ends[j][0], h.bed, q.ends[j][1], 'h:' + k);
        link(a, b);
      }
    });
    for (const K of S.links || []) {
      if (!K.path) continue;
      chain(K.path.map((q) => add(q[0], K.y, q[1])));
    }
    const groups = {};
    for (const n of N) if (n.pl && n.pl !== 's') (groups[n.pl] || (groups[n.pl] = [])).push(n);
    for (const k of Object.keys(groups)) { const G = groups[k]; for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) link(G[i], G[j]); }
    Object.defineProperty(S, '_route', { value: { N, groups, cost }, enumerable: false, configurable: true });
    return S._route;
  }
  // p がこの駅の中か（駅の所にいる、または地下で駅の道順の点から 60 m 以内 = 通路・階段の途中）
  function has(S, p) {
    const pl = place(S, p);
    if (pl === 's') return false;
    if (pl) return true;
    return routeGraph(S).N.some((n) => Math.abs(n.y - p.y) < 3 && Math.hypot(n.x - p.x, n.z - p.z) < 60);
  }
  function route(S, from, to) {
    const pa = place(S, from), pb = place(S, to);
    if (pa === pb && pa !== null) return null;
    const G = routeGraph(S), N = G.N;
    const ends = (p, pl) => { // 始点 / 終点につなぐ点
      if (pl) return N.filter((n) => n.pl === pl && (pl !== 's' || Math.hypot(n.x - p.x, n.z - p.z) < 400));
      return N.filter((n) => Math.hypot(n.x - p.x, n.z - p.z) < 60 && Math.abs(n.y - p.y) < 2.5).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, 3); // 通路・階段の途中: 近い 3 つ
    };
    const A = ends(from, pa), B = ends(to, pb);
    if (!A.length || !B.length) return null;
    const vs = { x: from.x, y: from.y, z: from.z, pl: pa }, vt = { x: to.x, y: to.y, z: to.z, pl: pb };
    const dist = new Map(), prev = new Map(), done = new Set();
    for (const n of A) { dist.set(n, G.cost(vs, n)); prev.set(n, null); }
    const goalCost = new Map(B.map((n) => [n, G.cost(n, vt)]));
    let best = null, bestD = Infinity;
    for (;;) { // 点は数十個 = 単純な選び方で足りる
      let u = null, ud = Infinity;
      for (const [n, d] of dist) if (!done.has(n) && d < ud) { u = n; ud = d; }
      if (!u || ud >= bestD) break;
      done.add(u);
      if (goalCost.has(u) && ud + goalCost.get(u) < bestD) { bestD = ud + goalCost.get(u); best = u; }
      for (const [v, c] of u.adj) { const nd = ud + c; if (!done.has(v) && nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, u); } }
    }
    if (!best) return null;
    const seq = [];
    for (let n = best; n; n = prev.get(n)) seq.unshift(n);
    const full = [vs].concat(seq, [vt]), legs = [];
    for (let k = 1; k < full.length; k++) {
      const a = full[k - 1], b = full[k];
      if (a.pl && a.pl === b.pl && a.pl[0] === 'r') for (const q of fareVia(S, a.pl.slice(2), a, b)) legs.push(q);
      if (k < full.length - 1) legs.push({ x: b.x, y: b.y, z: b.z });
    }
    // 続けて同じ所の点（1 m 以内）はまとめる
    const out = [];
    for (const q of legs) { const p = out[out.length - 1] || from; if (Math.hypot(q.x - p.x, q.z - p.z) < 1 && Math.abs(q.y - p.y) < 0.5) continue; out.push(q); }
    return { legs: out, key: 'st:' + (S.id || '') + ':' + pb, from: pa, to: pb, cost: bestD };
  }

  MR.Stations = { build, underground, route, place, has, poly: { area, ccw, clip, inter, minus, rect, bbox } };
  if (typeof module !== 'undefined' && module.exports) module.exports = MR.Stations;
})(typeof window !== 'undefined' ? window : globalThis);
