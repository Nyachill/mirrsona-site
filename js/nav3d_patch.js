// 壊れた物で当たり判定と歩行グラフを直す（MR.Nav3D の上に足すだけ。nav3d.js の中は変えない。THREE / DOM 非依存）。
//   destruct.js の記録が外す箱・足す箱を、読み込んであるチャンクにはその場で（dxApply）、これから読むチャンクには読むときに（dxFilter）。
//   歩行グラフは変わった所の 1 m の柱だけ作り直す（dxRegraph: エージェントの半径 + 1 m 広げた正方形。8 m 四方 1〜4 個ぶん、0.2〜2 ms）。
//   作り直しは nav3d の _graphGen そのもの（多角形の柱・空洞などの中身が変わっても同じ式）を、正方形だけを 1 つのチャンクに見せる
//   「代わりの nav」（Object.create(nav)）で回し、出来た節点を本物のグラフの同じ柱へ差し込む（ほかの柱はそのまま）。差し込んだら _search を
//   進める（止まっている経路探索 pathJob は最初からやり直す = 節点の番号が変わる）・梯子の辺も作り直す。
//
//   nav.dxFilter = (key, data) => data'     addChunk の前に呼ぶ（destruct.js の filterNav）
//   nav.dxApply(key, remove: Set<box>, add: [box], region?, ladRemove?: Set<ladder>, ladAdd?: [ladder], rampRemove?: Set<ramp>) → { x0, z0, x1, z1 } | null   読み込んであるチャンクの要素を外す・足す。外す箱は形
//     （x, y, z, w, h, d）で探す（同じチャンクを作り直した別の物でも）。戻り値は変わった範囲（region { x0, z0, x1, z1 } を渡せばそれ。
//     壁の穴は穴の直方体だけ = 長い腰壁を外して残りを足しても、作り直す柱は穴の周りだけ）
//   nav.dxRegraph(x0, z0, x1, z1) → job { step(budgetMs) → true（終わった）| false, done }   歩行グラフの柱の作り直し（予算の中で少しずつ）
//   nav.dxStats { applied, removed, added, regraphs, cols, ms, msMax }
(function (root) {
  const MR = root.MR || (root.MR = {});
  const N3 = MR.Nav3D || (typeof require === 'function' ? require('./nav3d.js') : null);
  if (!N3) return;
  const P = N3.prototype;
  if (P.dxApply) return; // 2 回読まれても 1 回だけ
  const NOCOL = 1, WALK = 4;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  const addChunk0 = P.addChunk;
  P.addChunk = function (key, data) {
    if (this.dxFilter && data) data = this.dxFilter(key, data) || data;
    return addChunk0.call(this, key, data);
  };

  P._dxStats = function () { return this.dxStats || (this.dxStats = { applied: 0, removed: 0, added: 0, regraphs: 0, cols: 0, ms: 0, msMax: 0 }); };

  // 要素の形（nav3d の Item）を、もう入っている要素から借りる（無ければ同じ形のふつうの物）
  P._dxItem = function (k, x0, x1, y0, y1, z0, z1, f, src) {
    let C = this._dxCtor;
    if (!C) {
      for (let i = 0; i < this.items.length; i++) { const it = this.items[i]; if (it) { C = this._dxCtor = it.constructor; break; } }
    }
    if (C && C !== Object) return new C(k, x0, x1, y0, y1, z0, z1, f, src);
    return { k, x0, x1, y0, y1, z0, z1, f, src, slot: 0, seq: 0, stamp: 0, ax: 0, dir: 1, ry0: 0, ry1: 0, t: 0, len: 1, slope: 0, planes: null };
  };

  const gkey = (b) => b.x + ',' + (b.y || 0) + ',' + b.z + ',' + b.w + ',' + b.h + ',' + b.d;
  const GK = new WeakMap(); // 箱 → 形の鍵（Item に後から足すと V8 の形が分かれるので横に持つ）
  const lkey = (l) => l.x + ',' + l.z + ',' + l.y0 + ',' + l.y1;
  // remove: 外す箱（形で探す）、add: 足す箱、region: 変わった所（歩行グラフ）、ladRemove / ladAdd: 外す・足す梯子（給水塔の梯子）
  P.dxApply = function (key, remove, add, region, ladRemove, ladAdd, rampRemove) {
    const ch = this.chunks.get(key);
    if (!ch) return null;
    const st = this._dxStats();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const grow = (a, b, c, d) => { if (a < x0) x0 = a; if (b < z0) z0 = b; if (c > x1) x1 = c; if (d > z1) z1 = d; };
    if (remove && remove.size) {
      // 外す箱の外接矩形の外の要素は見ない（形の文字列を作らない）
      const keys = new Set();
      let rx0 = Infinity, rz0 = Infinity, rx1 = -Infinity, rz1 = -Infinity;
      for (const b of remove) {
        keys.add(gkey(b));
        if (b.x - b.w / 2 < rx0) rx0 = b.x - b.w / 2; if (b.z - b.d / 2 < rz0) rz0 = b.z - b.d / 2;
        if (b.x + b.w / 2 > rx1) rx1 = b.x + b.w / 2; if (b.z + b.d / 2 > rz1) rz1 = b.z + b.d / 2;
      }
      rx0 -= 0.01; rz0 -= 0.01; rx1 += 0.01; rz1 += 0.01;
      for (let i = 0; i < ch.slots.length; i++) {
        const s = ch.slots[i], it = this.items[s];
        if (!it || it.k !== 0 || !it.src) continue;
        if (it.x1 < rx0 || it.x0 > rx1 || it.z1 < rz0 || it.z0 > rz1) continue;
        if (!remove.has(it.src)) { let k = GK.get(it.src); if (k === undefined) { k = gkey(it.src); GK.set(it.src, k); } if (!keys.has(k)) continue; }
        this.items[s] = null; // 枠はチャンクを外すとき（removeChunk）に空く。ハッシュの中の番号は _gather が飛ばす
        grow(it.x0, it.z0, it.x1, it.z1);
        st.removed++;
      }
    }
    const hc = this.hcell, mx = this.minX, mz = this.minZ, hash = this.hash;
    for (const b of add || []) {
      if (b.f & NOCOL) continue;
      const y = b.y || 0;
      const rec = this._dxItem(0, b.x - b.w / 2, b.x + b.w / 2, y, y + b.h, b.z - b.d / 2, b.z + b.d / 2, b.f == null ? WALK : b.f, b);
      const slot = this.freeSlots.length ? this.freeSlots.pop() : this.items.length;
      rec.slot = slot; rec.seq = this.seq++;
      this.items[slot] = rec;
      ch.slots.push(slot);
      const i0 = Math.floor((rec.x0 - mx) / hc), i1 = Math.floor((rec.x1 - mx) / hc), j0 = Math.floor((rec.z0 - mz) / hc), j1 = Math.floor((rec.z1 - mz) / hc);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = (i + 4096) * 8192 + (j + 4096);
        let a = hash.get(k);
        if (!a) { a = []; a.mark = null; hash.set(k, a); }
        a.push(slot);
        if (a.mark !== ch) { a.mark = ch; if (!ch.cells.includes(k)) ch.cells.push(k); }
      }
      grow(rec.x0, rec.z0, rec.x1, rec.z1);
      st.added++;
    }
    // スロープ（階段。destruct-3 M3 の倒壊）: 外すだけ（形で探す。戻すのはチャンクの読み直し = destruct_view の rollback）
    if (rampRemove && rampRemove.size) {
      const rk = (r) => r.x + ',' + r.z + ',' + r.y0 + ',' + r.y1 + ',' + r.w + ',' + r.d, keys = new Set();
      for (const r of rampRemove) keys.add(rk(r));
      for (let i = 0; i < ch.slots.length; i++) {
        const s = ch.slots[i], it = this.items[s];
        if (!it || it.k !== 1 || !it.src) continue;
        if (!(rampRemove.has(it.src) || keys.has(rk(it.src)))) continue;
        this.items[s] = null;
        grow(it.x0, it.z0, it.x1, it.z1);
        st.removed++;
      }
    }
    // 梯子（nav3d の addChunk / removeChunk と同じ記録の形）
    if (ladRemove && ladRemove.size) {
      const keys = new Set();
      for (const l of ladRemove) keys.add(lkey(l));
      for (let i = ch.ladders.length - 1; i >= 0; i--) {
        const l = ch.ladders[i];
        if (!(ladRemove.has(l.src) || keys.has(lkey(l)))) continue;
        ch.ladders.splice(i, 1);
        const k = this._hk(this._ix(l.x), this._iz(l.z)), a = this.lhash.get(k);
        if (a) { const j = a.indexOf(l); if (j >= 0) a.splice(j, 1); if (!a.length) this.lhash.delete(k); }
        grow(l.x - 1, l.z - 1, l.x + 1, l.z + 1);
      }
    }
    for (const l of ladAdd || []) {
      const rec = { x: l.x, z: l.z, y0: l.y0, y1: l.y1, nx: l.nx, nz: l.nz, src: l, chunk: key };
      ch.ladders.push(rec);
      const k = this._hk(this._ix(l.x), this._iz(l.z));
      let a = this.lhash.get(k);
      if (!a) { a = []; this.lhash.set(k, a); }
      a.push(rec);
      grow(l.x - 1, l.z - 1, l.x + 1, l.z + 1);
    }
    st.applied++;
    if (!(x1 >= x0)) return null;
    if (region) { x0 = region.x0; z0 = region.z0; x1 = region.x1; z1 = region.z1; }
    // 作りかけの歩行グラフ（buildGraphStep）は最初から（古い箱で作った区画を使わない）。範囲にかかる周りのチャンクも
    const inf = (this.inflate || 0) + 1, cs = this.chunkSize;
    const cx0 = Math.floor((x0 - inf - this.minX) / cs), cx1 = Math.floor((x1 + inf - this.minX) / cs);
    const cz0 = Math.floor((z0 - inf - this.minZ) / cs), cz1 = Math.floor((z1 + inf - this.minZ) / cs);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunks.get(cx + '_' + cz);
      if (c && !c.graph && this._jobs && this._jobs.has(c.key)) c.inval = (c.inval || 0) + 1;
    }
    this._ladDirty = true;
    return { x0, z0, x1, z1 };
  };

  // 正方形（チャンク ch の柱 c0..c0+n, r0..r0+n）の節点を _graphGen で作る（代わりの nav に正方形だけを 1 つのチャンクとして見せる）
  P._dxSquareGen = function (ch, c0, r0, n) {
    const self = this, gc = this.gcell;
    const px = Object.create(this);
    const ox = this.minX + ch.cx * this.chunkSize + c0 * gc, oz = this.minZ + ch.cz * this.chunkSize + r0 * gc;
    px.minX = ox; px.minZ = oz; px.chunkSize = n * gc; px.gn = n;
    px._ix = function (x) { return Math.floor((x - self.minX) / self.hcell); };
    px._iz = function (z) { return Math.floor((z - self.minZ) / self.hcell); };
    Object.defineProperty(px, '_stamp', { get() { return self._stamp; }, set(v) { self._stamp = v; } });
    px.gslots = []; px.gfree = []; px.gmap = new Map(); px._built = 0; px._ladDirty = false;
    const pch = { key: '__dx', cx: 0, cz: 0, slots: [], cells: [], ladders: [], inval: 0 };
    px.chunks = new Map([[pch.key, pch]]);
    return px._graphGen(pch);
  };

  // 出来た小さなグラフ m（n × n）を本物のグラフ G の柱 (c0, r0) から差し込む。柱は行の順に並んでいるので、変わらない所は
  //   ひと続きのまま写す（行ごとに 前 | 正方形の行 | 後 = 2n + 2 回の set）。colOf は柱の番号なので写すだけで合う
  P._dxSplice = function (G, m, c0, r0, n) {
    const gn = G.n, cs = G.colStart;
    let N = cs[gn * gn];
    for (let r = r0; r < r0 + n; r++) {
      const i0 = r * gn + c0;
      N += (m.colStart[(r - r0) * n + n] - m.colStart[(r - r0) * n]) - (cs[i0 + n] - cs[i0]);
    }
    const colStart = new Int32Array(gn * gn + 1), y = new Float32Array(N), ramp = new Int32Array(N), sx = new Float32Array(N), sz = new Float32Array(N), colOf = new Int32Array(N);
    let w = 0;
    const copyOld = (a0, a1) => { // 古い節点 a0..a1（番号）をそのまま
      if (a1 <= a0) return;
      y.set(G.y.subarray(a0, a1), w); ramp.set(G.ramp.subarray(a0, a1), w); sx.set(G.sx.subarray(a0, a1), w); sz.set(G.sz.subarray(a0, a1), w); colOf.set(G.colOf.subarray(a0, a1), w);
      w += a1 - a0;
    };
    // 正方形の前の行（と最初の行の c0 より前）
    colStart.set(cs.subarray(0, r0 * gn + c0 + 1));
    copyOld(0, cs[r0 * gn + c0]);
    for (let r = r0; r < r0 + n; r++) {
      const i0 = r * gn + c0, j0 = (r - r0) * n;
      // 正方形の行
      for (let k = 0; k < n; k++) {
        colStart[i0 + k] = w;
        const q0 = m.colStart[j0 + k], q1 = m.colStart[j0 + k + 1];
        for (let q = q0; q < q1; q++) { y[w] = m.y[q]; ramp[w] = m.ramp[q]; sx[w] = m.sx[q]; sz[w] = m.sz[q]; colOf[w] = i0 + k; w++; }
      }
      // 正方形の後（次の行の c0 まで。最後の行は全部の後ろまで）
      const e0 = i0 + n, e1 = r < r0 + n - 1 ? (r + 1) * gn + c0 : gn * gn;
      const d = w - cs[e0];
      for (let i = e0; i < e1; i++) colStart[i] = cs[i] + d;
      copyOld(cs[e0], cs[e1]);
    }
    colStart[gn * gn] = w;
    G.colStart = colStart; G.colOf = colOf; G.y = y; G.ramp = ramp; G.sx = sx; G.sz = sz;
    G.g = new Float32Array(N); G.f = new Float32Array(N); G.par = new Int32Array(N); G.seen = new Uint32Array(N); G.closed = new Uint32Array(N);
  };

  // 範囲 (x0, z0)–(x1, z1)（もうエージェントの半径 + 1 m 広げたもの）の柱を作り直す仕事。グラフの無いチャンクは何もしない（作るときに新しい箱で）
  P.dxRegraph = function (x0, z0, x1, z1) {
    const self = this, gc = this.gcell, cs = this.chunkSize, gn = this.gn;
    const jobs = [];
    const cx0 = Math.floor((x0 - this.minX) / cs), cx1 = Math.floor((x1 - this.minX) / cs);
    const cz0 = Math.floor((z0 - this.minZ) / cs), cz1 = Math.floor((z1 - this.minZ) / cs);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const ch = this.chunks.get(cx + '_' + cz);
      if (!ch) continue;
      const bx = this.minX + cx * cs, bz = this.minZ + cz * cs;
      const a0 = Math.max(0, Math.floor((x0 - bx) / gc)), a1 = Math.min(gn - 1, Math.floor((x1 - bx) / gc));
      const b0 = Math.max(0, Math.floor((z0 - bz) / gc)), b1 = Math.min(gn - 1, Math.floor((z1 - bz) / gc));
      if (a1 < a0 || b1 < b0) continue;
      const n = Math.min(gn, Math.max(a1 - a0 + 1, b1 - b0 + 1));
      const c0 = Math.min(a0, gn - n), r0 = Math.min(b0, gn - n);
      jobs.push({ ch, c0, r0, n, it: null });
    }
    const st = this._dxStats();
    st.regraphs++;
    let k = 0;
    const job = {
      done: false,
      step(budgetMs) {
        if (job.done) return true;
        const t0 = now();
        while (k < jobs.length) {
          const J = jobs[k];
          // チャンクが外された・グラフがまだ無い（後で新しい箱で作る）
          if (self.chunks.get(J.ch.key) !== J.ch || !J.ch.graph) { k++; J.it = null; continue; }
          if (!J.it) { J.it = self._dxSquareGen(J.ch, J.c0, J.r0, J.n); J.g = J.ch.graph; }
          let r = J.res || null;
          for (; !r;) {
            const q = J.it.next();
            if (q.done) { r = q; break; }
            if (now() - t0 >= (budgetMs || 0)) { r = q; break; }
          }
          if (!r.done) { const ms = now() - t0; st.ms += ms; if (ms > st.msMax) st.msMax = ms; return false; }
          // 差し込みは次の歩（作るのに予算の半分より使っていれば）
          if (!J.res) { J.res = r; if (now() - t0 >= (budgetMs || 0) * 0.5) { const ms = now() - t0; st.ms += ms; if (ms > st.msMax) st.msMax = ms; return false; } }
          r = J.res;
          if (r.value && J.ch.graph === J.g && J.g) {
            self._dxSplice(J.g, r.value, J.c0, J.r0, J.n);
            st.cols += J.n * J.n;
            self._search++;       // 止まっている経路探索は最初から（節点の番号が変わった）
            self._ladDirty = true; // 梯子の辺は節点の番号で持っている
          }
          k++;
          if (k < jobs.length && now() - t0 >= (budgetMs || 0)) break;
        }
        const ms = now() - t0; st.ms += ms; if (ms > st.msMax) st.msMax = ms;
        if (k >= jobs.length) job.done = true;
        return job.done;
      }
    };
    return job;
  };
})(typeof window !== 'undefined' ? window : globalThis);
