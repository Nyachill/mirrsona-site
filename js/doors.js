// 入れる建物の入口の自動ドア（MR.Doors / MR.DoorsView）。前半（find / Manager）は THREE にも DOM にも依存しない（Node のテストでも動く）。
//   扉の場所は家具と同じ chunkFull の出力から決める（citygen.js は変えない・決定的）: interiors.js が家具を入れる建物（Interiors.wants）の
//   1 階の外壁（SHELL）で、床から 2 m 以上あいている幅 minWidth〜maxWidth の隙間 = 扉。使い方（Interiors.groundUse）で種類を決める:
//     事務所・お店・ロビー → ガラスの引き戸（2 枚が左右へ開く） / 住まい・倉庫・作業場 → 開き戸（内側へ開く。幅が広ければ両開き）。
//   当たり判定は持たない（nav に箱を入れない）= 人・敵の動き・経路を決してふさがない。見た目だけ（オンラインでもクライアントだけ。サーバーは知らない）。
//   開く: プレイヤー・敵・ほかのプレイヤー（今の位置と lead 秒先）が扉から openRadius m・上下 openHeight m 以内。だれもいなくなって closeDelay 秒で閉じる。
//   開く速さは slideTime / swingTime 秒（走って近づいても着く前に開ききる）。開き始め・閉じ始めにやわらかい音（audio の door_slide / door_swing）。
//   数値はすべて game.json の city.doors（見た目は render.city.doors）。
(function (root) {
  'use strict';
  const MR = root.MR = root.MR || {};
  const SHELL = 16, NOCOL = 1;
  const DEF = { openRadius: 4, openHeight: 2.6, lead: 0.4, closeDelay: 3, slideTime: 0.6, swingTime: 0.8, swingAngle: 92,
    minWidth: 1.2, maxWidth: 6, minHeight: 2.0, maxHeight: 6.5, wall: 0.3, volume: 0.5, soundDist: 30 };

  // ---------- 扉を探す ----------
  // b: buildings の記録、boxes: その建物の矩形 ± 0.5 m の箱（外壁 SHELL と室内の間仕切り・柱）。戻り値 [{ x, y, z, nx, nz, ux, uz, w, h, type, use, id }]
  // around: 建物の外の箱（隣の建物の外壁。隣のチャンクの物も）。扉のすぐ外がふさがっている隙間は扉にしない
  function findBuilding(b, boxes, cfg, use, around) {
    cfg = cfg || DEF;
    const wt = cfg.wall || 0.3;
    const inside = (q) => q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1;
    let by = Infinity;
    for (const q of boxes) if ((q.f & SHELL) && inside(q) && q.y < by) by = q.y;
    if (!isFinite(by)) return [];
    const out = [];
    // 4 つの面: 面に沿う軸 s（x か z）、壁の帯（外側の線 c から wt）、外向き
    const faces = [
      { ax: 'x', c: b.z0, inw: 1, n: [0, -1] }, { ax: 'x', c: b.z1, inw: -1, n: [0, 1] },
      { ax: 'z', c: b.x0, inw: 1, n: [-1, 0] }, { ax: 'z', c: b.x1, inw: -1, n: [1, 0] }
    ];
    const lo = by + 0.15, hi = by + (cfg.minHeight || 2) - 0.05;
    for (let fi = 0; fi < 4; fi++) {
      const F = faces[fi];
      const s0 = F.ax === 'x' ? b.x0 : b.z0, s1 = F.ax === 'x' ? b.x1 : b.z1;
      const band0 = F.inw > 0 ? F.c - 0.05 : F.c - wt - 0.05, band1 = F.inw > 0 ? F.c + wt + 0.05 : F.c + 0.05;
      const iv = [], tops = [], full = [];
      for (const q of boxes) {
        if (!(q.f & SHELL) || (q.f & NOCOL)) continue;
        const n0 = F.ax === 'x' ? q.z - q.d / 2 : q.x - q.w / 2, n1 = F.ax === 'x' ? q.z + q.d / 2 : q.x + q.w / 2;
        if (n1 < band0 || n0 > band1) continue;
        const a0 = F.ax === 'x' ? q.x - q.w / 2 : q.z - q.d / 2, a1 = F.ax === 'x' ? q.x + q.w / 2 : q.z + q.d / 2;
        if (a1 < s0 - 0.01 || a0 > s1 + 0.01) continue;
        if (q.y < hi && q.y + q.h > lo) { iv.push([a0, a1]); if (q.y <= lo + 0.01 && q.y + q.h >= by + 2.3) full.push([a0, a1]); }
        else if (q.y >= hi - 0.01 && q.y < by + (cfg.maxHeight || 6.5) + 0.5) tops.push([a0, a1, q.y]);
      }
      if (!iv.length) continue; // 壁が無い面（ガラスの塔の正面など）は扉にしない
      iv.sort((p, q) => p[0] - q[0]);
      // 覆われていない区間（角から wt の内側）
      let cur = s0 + wt;
      const gaps = [];
      for (const [a0, a1] of iv) {
        if (a0 > cur + 0.01) gaps.push([cur, Math.min(a0, s1 - wt)]);
        if (a1 > cur) cur = a1;
      }
      if (cur < s1 - wt - 0.01) gaps.push([cur, s1 - wt]);
      for (const g of gaps) {
        const w = g[1] - g[0];
        if (w < (cfg.minWidth || 1.2) - 0.01 || w > (cfg.maxWidth || 6) + 0.01) continue;
        let top = Infinity;
        for (const t of tops) if (t[1] > g[0] + 0.05 && t[0] < g[1] - 0.05) top = Math.min(top, t[2]);
        const h = top - by;
        if (!(h >= (cfg.minHeight || 2) - 0.01 && h <= (cfg.maxHeight || 6.5))) continue;
        const sm = (g[0] + g[1]) / 2, cm = F.c + F.inw * wt / 2;
        // 扉の通り道（隙間の幅 − 0.3 m × 壁の外の面から内へ 1.2 m × 床から 2 m）に壁以外の当たる箱（間仕切り・柱）があれば扉にしない
        //   （citygen が裏口の真ん中へ間仕切りを通した所。扉を付けると通れそうに見えて、通り道が半分になっている）
        let blockedIn = false;
        for (const q of boxes) {
          if ((q.f & SHELL) || (q.f & NOCOL) || !(q.y < by + 2 && q.y + q.h > by + 0.1)) continue;
          const a0 = F.ax === 'x' ? q.x - q.w / 2 : q.z - q.d / 2, a1 = F.ax === 'x' ? q.x + q.w / 2 : q.z + q.d / 2;
          const n0 = F.ax === 'x' ? q.z - q.d / 2 : q.x - q.w / 2, n1 = F.ax === 'x' ? q.z + q.d / 2 : q.x + q.w / 2;
          const in0 = F.inw > 0 ? F.c : F.c - 1.2, in1 = F.inw > 0 ? F.c + 1.2 : F.c;
          if (a1 > g[0] + 0.15 && a0 < g[1] - 0.15 && n1 > in0 && n0 < in1) { blockedIn = true; break; }
        }
        if (blockedIn) continue;
        // 扉のすぐ外（外へ 0.1〜0.8 m）に隣の建物の外壁があれば扉にしない（開けると壁）
        let blockedOut = false;
        for (const q of around || []) {
          if (!(q.y < by + 2 && q.y + q.h > by + 0.1)) continue;
          const a0 = F.ax === 'x' ? q.x - q.w / 2 : q.z - q.d / 2, a1 = F.ax === 'x' ? q.x + q.w / 2 : q.z + q.d / 2;
          const n0 = F.ax === 'x' ? q.z - q.d / 2 : q.x - q.w / 2, n1 = F.ax === 'x' ? q.z + q.d / 2 : q.x + q.w / 2;
          const o0 = F.inw > 0 ? F.c - 0.8 : F.c + 0.1, o1 = F.inw > 0 ? F.c - 0.1 : F.c + 0.8;
          if (a1 > g[0] + 0.15 && a0 < g[1] - 0.15 && n1 > o0 && n0 < o1) { blockedOut = true; break; }
        }
        if (blockedOut) continue;
        // 引き戸の板が入る壁（隙間の左右の、床から 2.3 m 以上ある壁の続く長さ）。窓の前に板を止めない
        full.sort((p, q) => p[0] - q[0]);
        const pocket = (from, dir) => {
          let x = from, moved = true;
          while (moved) { moved = false; for (const f of full) { if (dir < 0 ? (f[0] < x - 0.01 && f[1] >= x - 0.02) : (f[1] > x + 0.01 && f[0] <= x + 0.02)) { x = dir < 0 ? f[0] : f[1]; moved = true; } } }
          return Math.abs(x - from);
        };
        const pL = pocket(g[0], -1), pR = pocket(g[1], 1);
        const x = F.ax === 'x' ? sm : cm, z = F.ax === 'x' ? cm : sm;
        let type = use === 'apartment' || use === 'warehouse' || use === 'workshop' ? 'swing' : 'slide';
        // 引き戸: 左右とも半分ずつ入るなら左右へ、片側に幅いっぱい入るならそちらへ 2 枚重ねて（slide1）、どちらも無ければ開き戸
        let side = 0, noPocket = 0;
        if (type === 'slide') {
          const half = w / 2;
          if (pL >= half - 0.05 && pR >= half - 0.05) side = 0;
          else if (pL >= w - 0.1 || pR >= w - 0.1) side = pL >= pR ? -1 : 1;
          else { type = 'swing'; noPocket = 1; } // 引き戸の板を入れる壁が無い（両側が窓）
        }
        out.push({ id: b.id + ':' + fi + ':' + Math.round(sm * 10), b: b.id, x: r3(x), y: r3(by), z: r3(z), nx: F.n[0], nz: F.n[1], ux: F.ax === 'x' ? 1 : 0, uz: F.ax === 'x' ? 0 : 1, w: r3(w), h: r3(h), type, side, use, wt, noPocket });
      }
    }
    return out;
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  // チャンク 1 つ（chunkFull）の扉。ctx: { levelId, city }
  function findChunk(full, ctx, cfg) {
    const I = MR.Interiors;
    if (!full || !full.buildings || !I) return [];
    const list = full.buildings.filter((b) => I.wants(b, ctx.levelId));
    if (!list.length) return [];
    const per = list.map(() => []);
    for (const q of full.boxes) {
      if ((q.f & NOCOL) || (!(q.f & SHELL) && q.cat !== 'interior')) continue; // 外壁と、扉の通り道を確かめる間仕切り・柱
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (q.x + q.w / 2 < b.x0 - 0.5 || q.x - q.w / 2 > b.x1 + 0.5 || q.z + q.d / 2 < b.z0 - 0.5 || q.z - q.d / 2 > b.z1 + 0.5) continue;
        per[i].push(q);
      }
    }
    // 建物の外の箱 = 区画の建物の段（citygen の lots。ワールドプランの静的なデータなので隣のチャンクを作らなくてよい・決定的）:
    //   このチャンクと、はみ出し（maxOverhang）の分の隣の区画から、建物の矩形 + 1 m に掛かるもの
    let ux0 = Infinity, uz0 = Infinity, ux1 = -Infinity, uz1 = -Infinity;
    for (const b of list) { ux0 = Math.min(ux0, b.x0 - 1); uz0 = Math.min(uz0, b.z0 - 1); ux1 = Math.max(ux1, b.x1 + 1); uz1 = Math.max(uz1, b.z1 + 1); }
    const outer = [], C = ctx.city;
    if (C && C.lots && C.ixLots && full.cx != null) {
      const o = 1 + Math.ceil((C.plan.maxOverhang || 64) / C.cs), seen = new Set();
      for (let dz = -o; dz <= o; dz++) for (let dx = -o; dx <= o; dx++) {
        const x = full.cx + dx, z = full.cz + dz;
        if (x < 0 || z < 0 || x >= C.ncx || z >= C.ncz) continue;
        for (const li of C.ixLots[z * C.ncx + x]) {
          if (seen.has(li)) continue;
          seen.add(li);
          for (const t of C.lots[li].tiers) {
            if (t[2] < ux0 || t[0] > ux1 || t[3] < uz0 || t[1] > uz1) continue;
            outer.push({ x: (t[0] + t[2]) / 2, z: (t[1] + t[3]) / 2, w: t[2] - t[0], d: t[3] - t[1], y: t[4], h: t[5] - t[4] });
          }
        }
      }
    }
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const use = I.groundUse ? I.groundUse(list[i], ctx) : 'office';
      const b = list[i];
      const around = outer.filter((q) => !(q.x > b.x0 - 0.01 && q.x < b.x1 + 0.01 && q.z > b.z0 - 0.01 && q.z < b.z1 + 0.01)); // 自分の段（中心が矩形の中）は除く
      for (const d of findBuilding(b, per[i], cfg, use, around)) out.push(d);
    }
    return out;
  }

  // ---------- 開け閉め（CityWorld が持つ）----------
  //   doors: プレイヤーの周り 3 × 3 の、土台のチャンクが nav にあるものの扉。1 フレームに 1 チャンクまで探す（結果は覚える）
  class Manager {
    constructor(world, cfg) {
      this.world = world;
      this.cfg = Object.assign({}, DEF, cfg || {});
      this.ctx = { levelId: (cfg && cfg.levelId) || 'midtown', city: world.city };
      // 家具を切っていても（?furn=0 など）扉の建物・種類は同じに: interiors.json を自分で入れる
      if (cfg && cfg.json && MR.Interiors && MR.Interiors.configure) MR.Interiors.configure(cfg.json);
      this.byKey = new Map();   // チャンクのキー → 扉の配列（探した結果）
      this.active = new Map();  // 今出している: キー → 扉の配列
      this.list = [];           // 今出している扉（state つき）
      this.ver = 0;             // 出し入れのたびに 1 増える（描画が詰め直す）
      this.onSound = null;      // (type, door, opening) → game.js が鳴らす
      this.stats = { chunks: 0, doors: 0, findMsMax: 0, opens: 0, closes: 0 };
    }
    _wanted(cx, cz) {
      const nav = this.world.nav, city = this.world.city, out = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= city.ncx || z >= city.ncz) continue;
        const k = x + '_' + z;
        if (nav.hasChunk(k)) out.push(k);
      }
      return out;
    }
    _find(key) {
      const p = key.split('_'), full = this.world.cache.full(+p[0], +p[1]);
      if (!full) return null;
      const t0 = now();
      const ds = findChunk(full, this.ctx, this.cfg);
      const ms = now() - t0;
      if (ms > this.stats.findMsMax) this.stats.findMsMax = ms;
      for (const d of ds) { d.amt = 0; d.target = 0; d.timer = 0; d.key = key; }
      this.byKey.set(key, ds);
      if (this.byKey.size > 24) this.byKey.delete(this.byKey.keys().next().value);
      return ds;
    }
    // 毎フレーム。p: プレイヤーの足元（周り 3 × 3 を決める）、agents: [{ x, y, z, vx?, vz? }]
    update(dt, p, agents) {
      if (!p) return;
      const c = this.world.city.chunkOf(p.x, p.z);
      const want = this._wanted(c.cx, c.cz);
      let changed = false;
      for (const k of Array.from(this.active.keys())) if (want.indexOf(k) < 0) { this.active.delete(k); changed = true; }
      let found = 0;
      for (const k of want) {
        if (this.active.has(k)) continue;
        let ds = this.byKey.get(k);
        if (!ds) { if (found > 0) continue; ds = this._find(k); found++; if (!ds) continue; }
        else { this.byKey.delete(k); this.byKey.set(k, ds); }
        this.active.set(k, ds); changed = true;
      }
      if (changed) {
        this.list = [];
        for (const ds of this.active.values()) for (const d of ds) this.list.push(d);
        this.ver++;
        this.stats.chunks = this.active.size; this.stats.doors = this.list.length;
      }
      // 開け閉め
      const C = this.cfg, R2 = C.openRadius * C.openRadius, lead = C.lead;
      for (const d of this.list) {
        let near = false;
        for (const a of agents) {
          if (Math.abs(a.y - d.y) > C.openHeight) continue;
          const dx = a.x - d.x, dz = a.z - d.z;
          if (dx * dx + dz * dz <= R2) { near = true; break; }
          if (lead > 0 && (a.vx || a.vz)) { const ex = dx + (a.vx || 0) * lead, ez = dz + (a.vz || 0) * lead; if (ex * ex + ez * ez <= R2) { near = true; break; } }
        }
        const tp = d.target;
        if (near) { d.target = 1; d.timer = C.closeDelay; }
        else if (d.target === 1) { d.timer -= dt; if (d.timer <= 0) d.target = 0; }
        if (d.target !== tp) {
          if (d.target === 1) this.stats.opens++; else this.stats.closes++;
          if (this.onSound) this.onSound(d.type, d, d.target === 1);
        }
        if (d.amt !== d.target) {
          const sp = dt / Math.max(0.05, d.type === 'slide' ? C.slideTime : C.swingTime);
          d.amt = d.target > d.amt ? Math.min(d.target, d.amt + sp) : Math.max(d.target, d.amt - sp);
          d.moving = true;
        } else d.moving = false;
      }
    }
    // 扉の開き具合（テスト用）: 一番近い扉
    nearest(x, z) {
      let best = null, bd = Infinity;
      for (const d of this.list) { const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
      return best;
    }
    clear() { this.active.clear(); this.list = []; this.ver++; }
    info() { return Object.assign({ shown: this.list.length, open: this.list.filter((d) => d.amt > 0).length }, this.stats); }
  }
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  MR.Doors = { DEF, findBuilding, findChunk, Manager };

  // ---------- 見た目（THREE があるときだけ）----------
  //   InstancedMesh 2 つ: ガラス（引き戸の板。半透明）と、枠・開き戸の板（色つき）。扉ごとに部品の番号を覚え、動いている扉だけ行列を書き直す
  if (typeof THREE !== 'undefined') {
    const VDEF = { maxDoors: 400, glassColor: '#9fc4d6', glassOpacity: 0.32, frameColor: '#3a4048', woodColor: '#6b4a32', metalColor: '#6d747c', drawDist: 70 };
    class DoorsView {
      constructor(world, cfg) {
        this.world = world;
        this.cfg = Object.assign({}, VDEF, cfg || {});
        const geo = new THREE.BoxBufferGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0); // 原点は下の真ん中
        this.geo = geo;
        const n = this.cfg.maxDoors;
        this.glassMat = new THREE.MeshStandardMaterial({ color: MR.srgb(this.cfg.glassColor), roughness: 0.08, metalness: 0.1, transparent: true, opacity: this.cfg.glassOpacity, depthWrite: false });
        this.solidMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 });
        this.glass = new THREE.InstancedMesh(geo, this.glassMat, n * 2);
        this.solid = new THREE.InstancedMesh(geo, this.solidMat, n * 3);
        this.solid.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3 * 3), 3);
        for (const m of [this.glass, this.solid]) { m.count = 0; m.frustumCulled = false; m.matrixAutoUpdate = false; m.name = 'doors'; world.scene.add(m); }
        this.glass.renderOrder = 3;
        this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
        this._col = { frame: MR.srgb(this.cfg.frameColor), wood: MR.srgb(this.cfg.woodColor), metal: MR.srgb(this.cfg.metalColor) };
        this._ver = -1;
        this.stats = { doors: 0, glass: 0, solid: 0, rebuilds: 0 };
      }
      // 扉 d の部品を書く（gi / si: ガラス・板の番号の始まり）
      _write(d) {
        const m = this._m, q = this._q, p = this._p, s = this._s;
        const yaw = Math.atan2(-d.uz, d.ux); // 箱の +X を面に沿う軸へ（Y まわりに yaw 回すと +X → (cos, 0, −sin)）
        if (d.type === 'slide') {
          // 2 枚のガラスが左右へ（1 枚 = 幅の半分 + 0.04 の重なり）。開くと壁の中へ半分の幅だけ動く
          const half = d.w / 2;
          for (let k = 0; k < 2; k++) {
            const sg = k === 0 ? -1 : 1;
            // side 0: 左右へ半分ずつ。side ±1: 2 枚ともその側へ（遠い方の板は幅いっぱい、近い方は半分。奥行きを少しずらして重ねる）
            const tr = !d.side ? sg * (half - 0.06) : d.side * (sg === d.side ? half - 0.06 : d.w - 0.1);
            const off = sg * half / 2 + tr * d.amt;
            const dz2 = d.side && sg !== d.side ? 0.045 : 0; // 重ねる板は少し内側
            p.set(d.x + d.ux * off - d.nx * dz2, d.y + 0.03, d.z + d.uz * off - d.nz * dz2);
            q.setFromAxisAngle(this._up, yaw);
            s.set(half + 0.04, d.h - 0.06, 0.035);
            m.compose(p, q, s);
            this.glass.setMatrixAt(d._gi + k, m);
            // 縦の枠（ガラスの外側の端）
            const ex = off + sg * ((half + 0.04) / 2 - 0.02);
            p.set(d.x + d.ux * ex - d.nx * dz2, d.y + 0.03, d.z + d.uz * ex - d.nz * dz2);
            s.set(0.05, d.h - 0.06, 0.05);
            m.compose(p, q, s);
            this.solid.setMatrixAt(d._si + k, m);
          }
          // 上の箱（レールのカバー）
          p.set(d.x, d.y + d.h - 0.12, d.z); q.setFromAxisAngle(this._up, yaw); s.set(d.w, 0.12, 0.12); m.compose(p, q, s);
          this.solid.setMatrixAt(d._si + 2, m);
        } else {
          // 開き戸: 幅が 1.8 m 以上なら両開き（1 枚 1 m 前後。扉の内側の空けておく所の中で回る）。蝶番は隙間の端、内側（外向きの逆）へ開く
          const two = d.w >= 1.8, leaves = two ? 2 : 1, lw = d.w / leaves - 0.03;
          const a = (this.world.doors.cfg.swingAngle || 92) * Math.PI / 180 * d.amt;
          for (let k = 0; k < 3; k++) {
            if (k >= leaves) { m.makeScale(0, 0, 0); this.solid.setMatrixAt(d._si + k, m); continue; }
            const sg = k === 0 ? -1 : 1; // 蝶番の側（面に沿う軸の − / +）
            const hx = d.x + d.ux * sg * (d.w / 2 - 0.015), hz = d.z + d.uz * sg * (d.w / 2 - 0.015);
            // 板の向き: 閉じていると面に沿う。開くと内側へ回る（内向き = −n）
            const ca = Math.cos(a), sa = Math.sin(a);
            const dirx = -sg * d.ux * ca - d.nx * sa, dirz = -sg * d.uz * ca - d.nz * sa; // 蝶番から板の先へ
            p.set(hx + dirx * lw / 2, d.y + 0.02, hz + dirz * lw / 2);
            q.setFromAxisAngle(this._up, Math.atan2(-dirz, dirx));
            s.set(lw, d.h - 0.05, 0.05);
            m.compose(p, q, s);
            this.solid.setMatrixAt(d._si + k, m);
          }
        }
      }
      _rebuild(list) {
        const max = this.cfg.maxDoors;
        let gi = 0, si = 0, n = 0;
        for (const d of list) {
          if (n >= max) { d._gi = -1; continue; }
          d._gi = gi; d._si = si; n++;
          const col = d.type === 'slide' ? this._col.frame : (d.use === 'apartment' ? this._col.wood : this._col.metal);
          for (let k = 0; k < 3; k++) this.solid.setColorAt(si + k, col);
          if (d.type === 'slide') gi += 2;
          si += 3;
          this._write(d);
        }
        this.glass.count = gi; this.solid.count = si;
        this.glass.instanceMatrix.needsUpdate = true; this.solid.instanceMatrix.needsUpdate = true;
        if (this.solid.instanceColor) this.solid.instanceColor.needsUpdate = true;
        this.stats.doors = n; this.stats.glass = gi; this.stats.solid = si; this.stats.rebuilds++;
      }
      update() {
        const D = this.world.doors;
        if (!D) return;
        if (D.ver !== this._ver) { this._ver = D.ver; this._rebuild(D.list); return; }
        let dirty = false;
        for (const d of D.list) if (d.moving && d._gi !== -1) { this._write(d); dirty = true; }
        if (dirty) { this.glass.instanceMatrix.needsUpdate = true; this.solid.instanceMatrix.needsUpdate = true; }
      }
      info() { return Object.assign({}, this.stats); }
      dispose() {
        for (const m of [this.glass, this.solid]) { if (m.parent) m.parent.remove(m); m.dispose(); }
        this.geo.dispose(); this.glassMat.dispose(); this.solidMat.dispose();
      }
    }
    MR.DoorsView = DoorsView;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = MR.Doors;
})(typeof window !== 'undefined' ? window : globalThis);
