// 動く足場（船・これからの列車。THREE / DOM 非依存。サーバーも require できる）。boats 計画 §3.5 の共通の形:
//   MR.Platforms(opts)            addProvider(p)  p = { prefix: 's' | 'r', near(x, y, z, r, out) → n, byId(id) → entry | null, types: { typeId: data } }
//     entry = { id（'s:<番号>' / 'r:<路線>:<列車>:<車両>'）, typeId, pose { x, y, z, yaw, pitch, roll }, prevPose, vel { x, y, z }, wy, speed,
//               flags { doorsClosed, strikes, solid } }。data は ships.json の形（boxes / decks / ramps / edges / bbox）
//     問い合わせ（out を渡せばメモリを確保しない）:
//       near(x, y, z, r, out) → n                     supportAt(x, z, yFeet, step, out) → { y, entry, box } | null（一番高い甲板）
//       pushCircle(x, z, r, lo, hi, out, mode) → out = [x, z, 押した?, entry]（mode 'walker' は strikes の物を飛ばす。'vehicle' は全部）
//       pushCapsule(pos, r, h, out) → { x, z, pushed, entry }   raycast(ox, oy, oz, dx, dy, dz, maxT, out, opts) → { t, x, y, z, nx, ny, nz, entry } | null
//       segmentBlocked(ax, ay, az, bx, by, bz) → bool（視線。柵・ガラス NOLOS は通す）   insideSolid(x, y, z, m) → entry | null
//       sweepSphere(ax, ay, az, bx, by, bz, r) → entry | null（戦闘機の粗い判定: 船の箱を r だけ広げた OBB と線分）
//       toLocal(e, x, y, z, out) / toWorld(e, lx, ly, lz, out)   pointVel(e, x, z, out)（= v + ω × r）
//       localNav(typeId) → MR.Nav3D（船のローカル。境界 ±1e4 m・地形なし = groundAt は { y: -Infinity, water: null }）
//   MR.PlatformNav(worldNav, platforms)  player.update に渡す nav の代わり（setActive(entries, n) で近くの船を最大 2 つ）。
//     resolveCapsule / groundInfo / groundHeight / ceilingHeight / raycast / lineOfSight は世界と船のローカルを合わせる。
//     水・地形・梯子・そのほかは世界の nav のまま（lastEntry: 立っている面の船）
//   MR.Platforms.Clock            ソロ: t = epoch + ゲームの時間（止めている間は進まない）。オンライン: サーバーの時計を後戻りせずに追う
//                                 （50 ms 以下のずれは 0.5 秒かけて寄せる、それより大きいとすぐ合わせて jumped を立てる）
// 船のローカル: 船首 +Z・左舷 +X・原点は喫水線の中心。世界 → ローカル: lx = dx cos(yaw) − dz sin(yaw)、lz = dx sin(yaw) + dz cos(yaw)（vehicle.js と同じ）
(function (root) {
  const MR = root.MR || (root.MR = {});
  if (!MR.Nav3D && typeof require === 'function') { try { MR.Nav3D = require('./nav3d.js'); } catch (e) { /* ブラウザは nav3d.js が先 */ } }
  const NOLOS = 2, WALK = 4;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const NOGROUND = { y: -Infinity, water: null };
  const BOUND = 1e4;

  // 船の data（ships.json の 1 種類）→ ローカルの Nav3D
  function buildLocalNav(data, deckMat) {
    const nav = new MR.Nav3D({ minX: -BOUND, minZ: -BOUND, maxX: BOUND, maxZ: BOUND, chunkSize: 128, hashCell: 8, graphCell: 1, stepUp: 0.45, headroom: 1.8, agentRadius: 0.3 });
    nav.groundAt = () => NOGROUND;
    const mat = deckMat || data.deckMat || 'metal';
    const boxes = [];
    for (const b of data.boxes || []) {
      const tag = b[7] || '';
      boxes.push({ x: (b[0] + b[3]) / 2, y: b[1], z: (b[2] + b[5]) / 2, w: b[3] - b[0], h: b[4] - b[1], d: b[5] - b[2], f: b[6], cat: 'ship', mat: /rail|edge|windbreak|stack|mast|winch|bitt|bollard/.test(tag) ? 'metal' : mat, tag, platform: true });
    }
    for (const d of data.decks || []) boxes.push({ x: (d[0] + d[2]) / 2, y: d[4] - 0.25, z: (d[1] + d[3]) / 2, w: d[2] - d[0], h: 0.25, d: d[3] - d[1], f: WALK, cat: 'ship', mat, tag: 'deck', platform: true });
    for (const e of data.edges || []) boxes.push({ x: (e[0] + e[2]) / 2, y: e[4], z: (e[1] + e[3]) / 2, w: Math.max(0.05, e[2] - e[0]), h: e[5] - e[4], d: Math.max(0.05, e[3] - e[1]), f: NOLOS, cat: 'ship', mat: 'metal', tag: 'edge', platform: true });
    const ramps = (data.ramps || []).map((r) => ({ x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2, w: r[2] - r[0], d: r[3] - r[1], y0: r[4], y1: r[5], axis: r[6], dir: r[7], t: 0.3, f: 0, cat: 'ship', mat, tag: 'stairs', platform: true }));
    nav.addChunk('0_0', { cx: 0, cz: 0, boxes, ramps });
    return nav;
  }

  // 円を箱から押し出す（heli.js の Helicopter.pushCircle と同じ規則。THREE を使わない写し）
  function pushCircleItems(cands, x, z, r, lo, hi, out) {
    let pushed = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let n = 0; n < cands.length; n++) {
        const b = cands[n];
        if (b.f & 1) continue;
        const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
        let top = b.y1, bot = b.y0;
        if (b.k === 1) { top = MR.Nav3D.itemTop(b, cx, cz); bot = top - (b.t || 0.3); }
        if (top <= lo || bot >= hi) continue;
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) { const d = Math.sqrt(d2), p = r - d; x += dx / d * p; z += dz / d * p; }
        else {
          const a0 = x - b.x0, a1 = b.x1 - x, c0 = z - b.z0, c1 = b.z1 - z, m = Math.min(a0, a1, c0, c1);
          if (m === a0) x = b.x0 - r; else if (m === a1) x = b.x1 + r; else if (m === c0) z = b.z0 - r; else z = b.z1 + r;
        }
        moved = true; pushed = true;
      }
      if (!moved) break;
    }
    out[0] = x; out[1] = z; out[2] = pushed;
    return out;
  }

  class Platforms {
    constructor(opts) {
      opts = opts || {};
      this.providers = [];
      this.types = {};
      this._navs = {};
      this._buf = new Array(32);
      this._items = [];
      this._pc = [0, 0, false, null];
      this._l = { x: 0, y: 0, z: 0 };
      this._w = { x: 0, y: 0, z: 0 };
      this.nearRange = opts.nearRange == null ? 6 : opts.nearRange;
      this.deckMats = opts.deckMats || {}; // 種類ごとの甲板の材質（game.json の ships.types.<id>.deckMat。足音）
    }
    addProvider(p) {
      this.providers.push(p);
      for (const k in p.types || {}) if (p.types[k]) this.types[k] = p.types[k];
      return p;
    }
    localNav(typeId) {
      let nav = this._navs[typeId];
      if (!nav) { const d = this.types[typeId]; if (!d) return null; nav = this._navs[typeId] = buildLocalNav(d, this.deckMats[typeId]); }
      return nav;
    }
    near(x, y, z, r, out) {
      out = out || this._buf;
      let n = 0;
      const tmp = this._tmpN || (this._tmpN = new Array(32));
      for (const p of this.providers) {
        const k = p.near(x, y, z, r, tmp);
        for (let i = 0; i < k && n < out.length; i++) out[n++] = tmp[i];
      }
      return n;
    }
    byId(id) {
      if (!id) return null;
      for (const p of this.providers) if (String(id).indexOf(p.prefix + ':') === 0) return p.byId(id);
      return null;
    }
    toLocal(e, x, y, z, out) {
      out = out || {};
      const p = e.pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z;
      out.x = dx * c - dz * s; out.y = y - p.y; out.z = dx * s + dz * c;
      return out;
    }
    toWorld(e, lx, ly, lz, out) {
      out = out || {};
      const p = e.pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      out.x = p.x + lx * c + lz * s; out.y = p.y + ly; out.z = p.z - lx * s + lz * c;
      return out;
    }
    // ローカルの向き → 世界の向き（法線）
    dirToWorld(e, lx, lz, out) {
      const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
      out.x = lx * c + lz * s; out.z = -lx * s + lz * c;
      return out;
    }
    pointVel(e, x, z, out) {
      out = out || {};
      const rx = x - e.pose.x, rz = z - e.pose.z;
      out.x = e.vel.x + e.wy * rz; out.y = e.vel.y || 0; out.z = e.vel.z - e.wy * rx;
      return out;
    }
    // 一番高い甲板（足 yFeet + step より上は除く）
    supportAt(x, z, yFeet, step, out, r) {
      const n = this.near(x, yFeet, z, 1, this._buf);
      let best = -Infinity, be = null, bb = null;
      const l = this._l;
      for (let i = 0; i < n; i++) {
        const e = this._buf[i], nav = this.localNav(e.typeId);
        if (!nav) continue;
        this.toLocal(e, x, yFeet, z, l);
        const g = nav.groundInfo(l.x, l.z, l.y + (step == null ? 0 : step - nav.stepUp), r || 0);
        if (g.y === null) continue;
        const wy = g.y + e.pose.y;
        if (wy > best) { best = wy; be = e; bb = g.box; }
      }
      if (!be) return null;
      out = out || {};
      out.y = best; out.entry = be; out.box = bb;
      return out;
    }
    pushCircle(x, z, r, lo, hi, out, mode) {
      out = out || this._pc;
      out[0] = x; out[1] = z; out[2] = false; out[3] = null;
      const n = this.near(x, lo, z, r + 1, this._buf);
      const l = this._l, w = this._w;
      for (let i = 0; i < n; i++) {
        const e = this._buf[i];
        if (mode === 'walker' && e.flags && e.flags.strikes) continue;
        const nav = this.localNav(e.typeId);
        if (!nav) continue;
        this.toLocal(e, out[0], lo, out[1], l);
        const items = this._items; items.length = 0;
        nav.itemsIn(l.x - r - 0.5, l.z - r - 0.5, l.x + r + 0.5, l.z + r + 0.5, items);
        if (!items.length) continue;
        const res = pushCircleItems(items, l.x, l.z, r, lo - e.pose.y, hi - e.pose.y, this._pcl || (this._pcl = [0, 0, false]));
        if (!res[2]) continue;
        this.toWorld(e, res[0], 0, res[1], w);
        out[0] = w.x; out[1] = w.z; out[2] = true; out[3] = e;
      }
      return out;
    }
    // 泳いでいる・歩いている人（カプセル）を船の箱の外へ（横だけ）
    pushCapsule(pos, r, h, out) {
      out = out || {};
      const res = this.pushCircle(pos.x, pos.z, r, pos.y + 0.3, pos.y + h, this._pcc || (this._pcc = [0, 0, false, null]), 'vehicle');
      out.x = res[0]; out.z = res[1]; out.pushed = res[2]; out.entry = res[3];
      return out;
    }
    raycast(ox, oy, oz, dx, dy, dz, maxT, out, opts) {
      const L = maxT;
      const mx = ox + dx * L * 0.5, mz = oz + dz * L * 0.5;
      const n = this.near(mx, oy, mz, L * 0.5 + 1, this._buf);
      let best = null, bt = maxT;
      const l = this._l;
      for (let i = 0; i < n; i++) {
        const e = this._buf[i], nav = this.localNav(e.typeId);
        if (!nav) continue;
        this.toLocal(e, ox, oy, oz, l);
        const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
        const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
        // OBB の粗い判定（箱の囲み）
        const b = e.data.bbox;
        const tb = MR.Nav3D.rayBox(l.x, l.y, l.z, ldx, dy, ldz, b[0][0] - 0.5, b[0][1] - 0.5, b[0][2] - 0.5, b[1][0] + 0.5, b[1][1] + 0.5, b[1][2] + 0.5);
        const inside = l.x > b[0][0] && l.x < b[1][0] && l.z > b[0][2] && l.z < b[1][2] && l.y > b[0][1] && l.y < b[1][1];
        if (!inside && (tb === null || tb > bt)) continue;
        const h = nav.raycast(l.x, l.y, l.z, ldx, dy, ldz, bt, opts);
        if (h && h.t < bt) {
          bt = h.t;
          best = out || {};
          best.t = h.t; best.x = ox + dx * h.t; best.y = oy + dy * h.t; best.z = oz + dz * h.t;
          best.nx = h.nx * c + h.nz * s; best.ny = h.ny; best.nz = -h.nx * s + h.nz * c; best.entry = e; best.box = h.box;
        }
      }
      return best;
    }
    segmentBlocked(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return false;
      return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, this._rc || (this._rc = {})) !== null;
    }
    insideSolid(x, y, z, m) {
      m = m || 0;
      const n = this.near(x, y, z, m + 1, this._buf);
      const l = this._l;
      for (let i = 0; i < n; i++) {
        const e = this._buf[i], nav = this.localNav(e.typeId);
        if (!nav) continue;
        this.toLocal(e, x, y, z, l);
        const items = this._items; items.length = 0;
        nav.itemsIn(l.x - m, l.z - m, l.x + m, l.z + m, items);
        for (const b of items) {
          if (b.f & NOLOS) continue;
          const top = b.k === 1 ? MR.Nav3D.itemTop(b, l.x, l.z) : b.y1, bot = b.k === 1 ? top - b.t : b.y0;
          if (l.x > b.x0 - m && l.x < b.x1 + m && l.z > b.z0 - m && l.z < b.z1 + m && l.y > bot && l.y < top) return e;
        }
      }
      return null;
    }
    sweepSphere(ax, ay, az, bx, by, bz, r) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const n = this.near((ax + bx) / 2, ay, (az + bz) / 2, len / 2 + r + 1, this._buf);
      const l = this._l;
      for (let i = 0; i < n; i++) {
        const e = this._buf[i], b = e.data.bbox;
        this.toLocal(e, ax, ay, az, l);
        const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
        const inv = len > 1e-9 ? 1 / len : 0;
        const ldx = (dx * c - dz * s) * inv, ldz = (dx * s + dz * c) * inv;
        const inside = l.x > b[0][0] - r && l.x < b[1][0] + r && l.z > b[0][2] - r && l.z < b[1][2] + r && l.y > b[0][1] - r && l.y < b[1][1] + r;
        if (inside) return e;
        if (len < 1e-9) continue;
        const t = MR.Nav3D.rayBox(l.x, l.y, l.z, ldx, dy * inv, ldz, b[0][0] - r, b[0][1] - r, b[0][2] - r, b[1][0] + r, b[1][1] + r, b[1][2] + r);
        if (t !== null && t <= len) return e;
      }
      return null;
    }
  }

  // ---------- player.update に渡す nav ----------
  class PlatformNav {
    constructor(world, platforms) {
      this.world = world; this.platforms = platforms;
      this.active = []; this.n = 0;
      this.lastEntry = null;
      this._l = { x: 0, y: 0, z: 0 }; this._w = { x: 0, y: 0, z: 0 };
      this._gi = { y: null, water: null, box: null, entry: null };
    }
    setActive(list, n) { this.n = 0; for (let i = 0; i < n && i < 2; i++) this.active[this.n++] = list[i]; }
    get stepUp() { return this.world.stepUp; }
    resolveCapsule(pos, r, h, su, opts) {
      const res = this.world.resolveCapsule(pos, r, h, su, opts);
      res.entry = null;
      this.lastEntry = null;
      const P = this.platforms, l = this._l, w = this._w;
      for (let i = 0; i < this.n; i++) {
        const e = this.active[i], nav = P.localNav(e.typeId);
        if (!nav) continue;
        P.toLocal(e, res.x, res.y, res.z, l);
        const q = nav.resolveCapsule(l, r, h, su, opts);
        P.toWorld(e, q.x, q.y, q.z, w);
        if (q.hitWall) { res.x = w.x; res.z = w.z; res.hitWall = true; }
        if (q.ground !== null) {
          const gw = q.ground + e.pose.y;
          if (res.ground === null || gw > res.ground) {
            res.ground = gw; res.y = w.y; res.grounded = q.grounded; res.box = q.box; res.entry = e;
            if (q.grounded) this.lastEntry = e;
          }
        }
        if (q.hitCeiling && w.y < res.y) { res.y = w.y; res.hitCeiling = true; }
      }
      return res;
    }
    groundInfo(x, z, yFeet, r) {
      const g = this.world.groundInfo(x, z, yFeet, r);
      const o = this._gi;
      o.y = g.y; o.water = g.water; o.box = g.box; o.entry = null;
      const P = this.platforms, l = this._l;
      for (let i = 0; i < this.n; i++) {
        const e = this.active[i], nav = P.localNav(e.typeId);
        if (!nav) continue;
        P.toLocal(e, x, yFeet, z, l);
        const q = nav.groundInfo(l.x, l.z, l.y, r);
        if (q.y === null) continue;
        const gw = q.y + e.pose.y;
        if (o.y === null || gw > o.y) { o.y = gw; o.box = q.box; o.entry = e; }
      }
      return o;
    }
    groundHeight(x, z, yFeet, r) { return this.groundInfo(x, z, yFeet, r).y; }
    ceilingHeight(x, z, yHead, r) {
      let c = this.world.ceilingHeight(x, z, yHead, r);
      const P = this.platforms, l = this._l;
      for (let i = 0; i < this.n; i++) {
        const e = this.active[i], nav = P.localNav(e.typeId);
        if (!nav) continue;
        P.toLocal(e, x, yHead, z, l);
        const q = nav.ceilingHeight(l.x, l.z, l.y, r) + e.pose.y;
        if (q < c) c = q;
      }
      return c;
    }
    raycast(ox, oy, oz, dx, dy, dz, maxDist, opts) {
      const a = this.world.raycast(ox, oy, oz, dx, dy, dz, maxDist, opts);
      const b = this.platforms.raycast(ox, oy, oz, dx, dy, dz, a ? a.t : maxDist, null, opts);
      if (b && (!a || b.t < a.t)) return { t: b.t, dist: b.t, x: b.x, y: b.y, z: b.z, nx: b.nx, ny: b.ny, nz: b.nz, box: this._worldBox(b.entry, b.box, ox, oz, dx, dz), entry: b.entry };
      return a;
    }
    // 船の箱（ローカル）→ 世界の軸の箱（乗り越え _tryVault 用）: レイが箱から出る距離が船の座標と同じになるように作る
    _worldBox(e, lb, ox, oz, dx, dz) {
      if (!lb || lb.w == null || lb.d == null) return lb;
      const l = this.platforms.toLocal(e, ox, 0, oz, this._l), c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
      const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
      const x0 = lb.x - lb.w / 2, x1 = lb.x + lb.w / 2, z0 = lb.z - lb.d / 2, z1 = lb.z + lb.d / 2;
      const tx = ldx > 1e-6 ? (x1 - l.x) / ldx : ldx < -1e-6 ? (x0 - l.x) / ldx : Infinity;
      const tz = ldz > 1e-6 ? (z1 - l.z) / ldz : ldz < -1e-6 ? (z0 - l.z) / ldz : Infinity;
      const tE = Math.min(tx, tz, 1e4);
      const ex = ox + dx * tE, ez = oz + dz * tE, F = 50;
      const bx0 = dx > 1e-6 ? ex - F : dx < -1e-6 ? ex : ox - F, bx1 = dx > 1e-6 ? ex : dx < -1e-6 ? ex + F : ox + F;
      const bz0 = dz > 1e-6 ? ez - F : dz < -1e-6 ? ez : oz - F, bz1 = dz > 1e-6 ? ez : dz < -1e-6 ? ez + F : oz + F;
      const o = {}; // 呼ぶ側（_tryVault）は何本ものレイの箱を持つので毎回新しく（船の箱に当たったときだけ）
      o.x = (bx0 + bx1) / 2; o.w = bx1 - bx0; o.z = (bz0 + bz1) / 2; o.d = bz1 - bz0;
      o.y = lb.y + e.pose.y; o.h = lb.h; o.f = lb.f; o.mat = lb.mat; o.cat = lb.cat; o.tag = lb.tag; o.platform = true; o.local = lb; o.entry = e;
      return o;
    }
    lineOfSight(ax, ay, az, bx, by, bz) { return this.world.lineOfSight(ax, ay, az, bx, by, bz) && !this.platforms.segmentBlocked(ax, ay, az, bx, by, bz); }
    waterLevelAt(x, z, y) { return this.world.waterLevelAt(x, z, y); }
    groundAt(x, z) { return this.world.groundAt(x, z); }
    ladderAt(x, y, z, r) { return this.world.ladderAt(x, y, z, r); }
    laddersNear(x, z, radius, out) { return this.world.laddersNear(x, z, radius, out); }
    itemsIn(x0, z0, x1, z1, out) { return this.world.itemsIn(x0, z0, x1, z1, out); }
    nearestFree(x, z, m, y) { return this.world.nearestFree(x, z, m, y); }
    resolveCircle(x, z, r, y, su, h) { return this.world.resolveCircle(x, z, r, y, su, h); }
  }

  // ---------- 時計 ----------
  class Clock {
    constructor(epoch) { this.epoch = epoch || 0; this.t = this.epoch; this.jumped = false; this._slew = 0; this.server = false; }
    // ソロ: dt だけ進める。オンライン: target（サーバーの今。秒）へ後戻りせずに寄せる
    now(dt, target) {
      this.jumped = false;
      if (typeof target === 'number' && isFinite(target)) {
        this.server = true;
        const pred = this.t + dt, d = target - pred;
        if (Math.abs(d) > 0.05) { this.t = Math.max(this.t, target); this.jumped = true; this._slew = 0; }
        else { this._slew = d; this.t = Math.max(this.t, pred + Math.max(-dt * 0.5, Math.min(dt * 0.5, d * Math.min(1, dt / 0.5)))); }
      } else this.t += Math.max(0, dt || 0);
      return this.t;
    }
  }
  Platforms.Clock = Clock;
  Platforms.buildLocalNav = buildLocalNav;
  Platforms.pushCircleItems = pushCircleItems;

  MR.Platforms = Platforms;
  MR.PlatformNav = PlatformNav;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Platforms, PlatformNav, Clock };
})(typeof window !== 'undefined' ? window : globalThis);
