// 街の読み込みのリング（MR.Streamer）と、生成したチャンクデータのキャッシュ（MR.CityChunkCache）。
//
//   近景（full）  : カメラからチャンクの箱（x, z の範囲 × 高さ 0..中身の一番上）までの距離が fullIn 未満になったら作り、fullOut を
//                   超えたら捨てる（ヒステリシス。fullOut < 128 なので多くても 3 × 3）。作るのは world.buildFull（ジェネレーター）を
//                   1 フレーム buildMsPerFrame ms まで進める。1 フレームに進める近景のチャンクは maxFullPerFrame（2）まで。出来上がるまでは
//                   遠景（LOD）がそのチャンクを描いている（穴は開かない）。出来上がったら遠景のそのチャンクの分を消す（uHide）。
//   遠景 LOD      : 512 m 区画（superChunk）ごと。lodIn 未満で chunkLod + 木の塊で作り、lodOut を超えたら捨てる。作っている間・
//                   作る前はスカイラインの区画が見えている。
//   スカイライン  : 全体を起動時に 1 回（world.buildSkyline）。LOD が出来上がった区画のものは隠す。
//   先読み        : 近景・当たり判定の外側 prefetchRadius チャンクのデータ（chunkFull）を、手が空いているフレームに作っておく。
//   先の所（lead）: { x, z }（game.js が死んでいる間に入れる = 選んだ復活の場所）。その所の立っているチャンクの近景もカメラのリングの外で
//                   作っておき、lead の間は捨てない（作りかけの次 = 死んだ所のリングより先。予算はいつも通り）。復活のフレームで立っているチャンクの
//                   近景が無い（予算 3 倍 = 組み立て 12〜18 ms）にならない。lead が外れたらリングの外のものは次のフレームで捨てる
//   距離はカメラの位置（高さを含む）で測るので、高い所（ヘリ）では近景が減り、遠景が広がる。
//   作る順番: 近景（近い順、視線の前を少し優先）→ LOD（近い順）→ 先読み → 手が空けば画像の無い材質の Canvas のテクスチャ（world.warmStep）。
//                   立っているチャンクの近景が無いときは近景だけ（予算 3 倍）。見えている所に穴（出来ていない近景 / LOD）があるフレームは
//                   予算を detailBoost / lodBoost 倍（_run の説明）。LOD の取り分（lodShare、既定 0）で LOD を先にもできる。
//   1 歩の長さ: world.buildFull / buildLod が buildStepMs（既定 2 ms）の目安で yield する。chunkFull の生成（full:gen・先読み）は分けられない
//   前もって作った遠景（world.bake = MR.CityBake の far.bin）があれば: chunkTops とスカイラインは起動前に復元したものを使い（作らない）、
//                   LOD の区画は world.lodJob が復元した形を使う。ワーカーの復元は lodIn + bake.prefetchMargin m に入ったら始める（lodIn に入ったときには
//                   出来ている。起動時の prime の間はしない = prime はメインスレッドで同じ区画を復元する）。まだなら待つ歩（'wait'）でその区画を
//                   置いて（park）次の仕事へ（予算を使わない。次のフレームにまた見る。waitFrames を過ぎたら作る）。出来上がった区画・先読みしたが
//                   入らなかった区画の復元結果は捨てる（bake.forget / prune）。stats.bake = { tops, sky, lod, lodGen, waits }
//   stats: { full, fullBuilt, lod, lodBuilt, sky, skyVisible, queue, buildMs（直近のフレーム）, buildMsMax, buildMsAvg, steps, jobs, overruns,
//            stepMs（ラベルごとの 1 歩の最大）, stepMsMax, stepMsMaxEx（chunkFull の生成を除く）, lodShareMs, lodWaitMax,
//            budget（直近のフレームの予算 ms）, boostFrames（穴が見えて予算を増やしたフレームの数）,
//            landmarkMs / landmarkMeshes（ランドマークの GLB が届いたときの invalidateLandmarks の ms と、部品を切ったメッシュの数）}
window.MR = window.MR || {};

// chunkFull / chunkLod / chunkDecor の結果を覚えておく（LRU）。pin されているもの（当たり判定・作りかけの近景）は捨てない
//   v2 の街（citygen_nyc.js、ブラウザ）は要るタイルがまだ届いていないと null を返す。null は覚えない（次に呼ばれたらまた作る）で
//   stats.waits を数える（タイルは chunkFull の中で city.request が頼んでいる）。範囲の外の null は数えない
MR.CityChunkCache = class CityChunkCache {
  constructor(city, opts) {
    opts = opts || {};
    this.city = city;
    this.cap = opts.cap || 40;
    this.map = new Map();
    this.stats = { generated: 0, genMs: 0, genMsMax: 0, evicted: 0, lod: 0, decor: 0, waits: 0 };
  }
  get size() { return this.map.size; }
  _entry(cx, cz) {
    const key = cx + '_' + cz;
    let e = this.map.get(key);
    if (e) { this.map.delete(key); this.map.set(key, e); return e; } // 最近使った順に
    e = { key, cx, cz, full: null, lod: null, decor: null, pins: null };
    this.map.set(key, e);
    this._evict();
    return e;
  }
  has(cx, cz) { const e = this.map.get(cx + '_' + cz); return !!(e && e.full); }
  hasDecor(cx, cz) { const e = this.map.get(cx + '_' + cz); return !!(e && e.decor); }
  full(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz) return null;
    const e = this._entry(cx, cz);
    if (!e.full) {
      const t0 = MR.CityWorld.now();
      e.full = this.city.chunkFull(cx, cz);
      const ms = MR.CityWorld.now() - t0;
      if (!e.full) { this.stats.waits++; return null; } // まだタイルが無い（v2）: 覚えない
      this.stats.generated++; this.stats.genMs += ms; if (ms > this.stats.genMsMax) this.stats.genMsMax = ms;
    }
    return e.full;
  }
  lod(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz) return null;
    const e = this._entry(cx, cz);
    if (!e.lod) { e.lod = this.city.chunkLod(cx, cz); if (!e.lod) { this.stats.waits++; return null; } this.stats.lod++; }
    return e.lod;
  }
  decor(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz) return null;
    const e = this._entry(cx, cz);
    if (!e.decor) { e.decor = this.city.chunkDecor(cx, cz); if (!e.decor) { this.stats.waits++; return null; } this.stats.decor++; }
    return e.decor;
  }
  pin(key, who) { const e = this.map.get(key); if (!e) return; (e.pins || (e.pins = new Set())).add(who); }
  // 満杯のとき次に捨てられる（一番古い・pin されていない）チャンクが (cx, cz) の周り R チャンクの中か。先読みはそれなら止める
  //  （当たり判定の pin が多いと空きが先読みの範囲より少なくなり、作った先読みのデータを次の先読みが捨てる繰り返しになる）
  victimNear(cx, cz, R) {
    if (this.map.size < this.cap) return false;
    for (const e of this.map.values()) {
      if (e.pins) continue;
      return Math.abs(e.cx - cx) <= R && Math.abs(e.cz - cz) <= R;
    }
    return true; // 全部 pin されている
  }
  unpin(key, who) { const e = this.map.get(key); if (e && e.pins) { e.pins.delete(who); if (!e.pins.size) e.pins = null; } this._evict(); }
  _evict() {
    if (this.map.size <= this.cap) return;
    for (const [k, e] of this.map) {
      if (this.map.size <= this.cap) break;
      if (e.pins) continue;
      this.map.delete(k);
      this.stats.evicted++;
    }
  }
  clear() { this.map.clear(); }
};

MR.Streamer = class Streamer {
  constructor(world, cfg) {
    this.world = world;
    this.city = world.city;
    this.cfg = cfg;
    this.cs = this.city.cs;
    this.S = Math.max(1, Math.round((this.city.plan.superChunk || 512) / this.cs));
    this.nsx = Math.ceil(this.city.ncx / this.S);
    this.nsz = Math.ceil(this.city.ncz / this.S);
    // chunkTops: far.bin にあればそれ（citygen の skyline() を作らない。起動時の約 100 ms）
    const bk = world.bake, t0t = MR.CityWorld.now();
    const bt = bk ? bk.request('tops') : null;
    this.tops = bt && bt.length === this.city.ncx * this.city.ncz ? bt : this.city.chunkTops();
    this.topsMs = MR.CityWorld.now() - t0t;
    this.superTops = new Float32Array(this.nsx * this.nsz);
    for (let cz = 0; cz < this.city.ncz; cz++) for (let cx = 0; cx < this.city.ncx; cx++) {
      const k = Math.floor(cz / this.S) * this.nsx + Math.floor(cx / this.S);
      this.superTops[k] = Math.max(this.superTops[k], this.tops[cz * this.city.ncx + cx]);
    }
    this.full = new Map();   // key → { key, cx, cz, state: 'queued'|'building'|'built', job, out, d, cancel, rebuild, lead }
    this.lead = null;        // { x, z }: 先に近景を作っておく所（死んでいる間の復活する場所。game.js）
    this.lod = new Map();    // 'sx_sz' → { key, sx, sz, state, job, out, d, cancel }
    this.calm = 0; // 予算を増やさないフレームの数（_run。復活のフレーム）
    this.stats = { full: 0, fullBuilt: 0, lod: 0, lodBuilt: 0, sky: 0, skyVisible: 0, queue: 0, prefetch: 0, buildMs: 0, buildMsMax: 0, buildMsAvg: 0, steps: 0, jobs: 0, overruns: 0, frames: 0, stepMsMax: 0, stepMs: {}, stepMsMaxEx: 0, lodShareMs: 0, lodWaitMax: 0, budget: 0, boostFrames: 0, waits: 0,
      bake: { tops: bt === this.tops ? 1 : 0, sky: 0, lod: 0, lodGen: 0, waits: 0 } };
    this._stepEma = { full: 1, lod: 1, lodBake: 0.3, prefetch: 2, gen: 4 };
    this._lodWait = 0;     // LOD の仕事があるのに 1 歩も進めなかったフレームの数（stats.lodWaitMax）
    this._frame = 0;       // _run の回数（LOD の区画が待っているフレーム数を数える）
    this._lodCredit = 0;   // LOD の取り分の貯金（ms。_run）
    this._reqOK = typeof this.city.request === 'function'; // v2 の街（タイル）: 近景・先読みの前にタイルを頼む
    this._cam = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, -1);
    const t0 = MR.CityWorld.now();
    this.sky = world.skylineMeshes ? world.skylineMeshes(this.S) : world.buildSkyline(this.S);
    this.stats.sky = this.sky.size;
    this.stats.skylineMs = MR.CityWorld.now() - t0;
    this.stats.topsMs = this.topsMs;
    this.stats.bake.sky = world.skySource === 'bake' ? 1 : 0;
    this._hideDirty = true;
  }

  // カメラの位置からチャンク (cx, cz) の箱までの距離
  chunkDist(cam, cx, cz) {
    const c = this.city, x0 = c.minX + cx * this.cs, z0 = c.minZ + cz * this.cs;
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + this.cs)), dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + this.cs));
    const top = this.tops[cz * c.ncx + cx] || 0;
    const dy = Math.max(0, cam.y - top - 2, -cam.y - 20);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  superDist(cam, sx, sz) {
    const c = this.city, side = this.S * this.cs, x0 = c.minX + sx * side, z0 = c.minZ + sz * side;
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + side)), dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + side));
    const dy = Math.max(0, cam.y - (this.superTops[sz * this.nsx + sx] || 0) - 2);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  // 視線の前にあるものを少し先に作る（距離から引く m）
  _viewBonus(cam, x, z) {
    const dx = x - cam.x, dz = z - cam.z, L = Math.hypot(dx, dz);
    if (L < 1) return 0;
    const f = this._fwd, fl = Math.hypot(f.x, f.z) || 1;
    const dot = (dx * f.x + dz * f.z) / (L * fl);
    return dot > 0.4 ? 40 * dot : 0;
  }

  // 毎フレーム。cam: カメラのワールド座標、forward: 視線の向き（無くてよい）
  update(cam, forward, budgetMs) {
    this._cam.copy(cam);
    if (forward) this._fwd.copy(forward);
    const cfg = this.cfg, city = this.city;
    // --- 近景のリング ---
    const c0 = city.chunkOf(cam.x, cam.z);
    const R = 2;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = c0.cx + dx, cz = c0.cz + dz;
      if (cx < 0 || cz < 0 || cx >= city.ncx || cz >= city.ncz) continue;
      const key = cx + '_' + cz;
      if (this.full.has(key)) continue;
      const d = this.chunkDist(cam, cx, cz);
      if (d < cfg.fullIn) this.full.set(key, { key, cx, cz, state: 'queued', job: null, out: null, d, cancel: false, rebuild: false });
    }
    // 先の所（lead）の立っているチャンク: リングの外でも作る・捨てない
    let leadKey = null;
    if (this.lead) {
      const lc = city.chunkOf(this.lead.x, this.lead.z);
      if (lc.cx >= 0 && lc.cz >= 0 && lc.cx < city.ncx && lc.cz < city.ncz) {
        leadKey = lc.cx + '_' + lc.cz;
        if (!this.full.has(leadKey)) {
          this.full.set(leadKey, { key: leadKey, cx: lc.cx, cz: lc.cz, state: 'queued', job: null, out: null, d: this.chunkDist(cam, lc.cx, lc.cz), cancel: false, rebuild: false, lead: true });
          this.stats.leadQueued = (this.stats.leadQueued || 0) + 1;
        }
      }
    }
    for (const rec of this.full.values()) {
      rec.d = this.chunkDist(cam, rec.cx, rec.cz);
      rec.lead = rec.key === leadKey;
      if (rec.d > cfg.fullOut && !rec.lead) this._dropFull(rec);
    }
    // --- LOD のリング（512 m 区画）---
    const side = this.S * this.cs;
    const s0x = Math.floor((cam.x - city.minX) / side), s0z = Math.floor((cam.z - city.minZ) / side);
    const SR = Math.ceil(cfg.lodOut / side) + 1;
    // 前もって作った遠景: ワーカーで復元を始めておく（lodIn + prefetchMargin に入ったら = lodIn に入ったときには出来ている）。起動時の prime の間は
    //   しない（prime はメインスレッドで同じ区画を復元する = 2 回復元しない・ワーカーと CPU を取り合わない。prime の後に残った区画を先読み）
    const bake = this._priming ? null : this.world.bake, pm = this.world.bake && cfg.bake && cfg.bake.prefetchMargin >= 0 ? cfg.bake.prefetchMargin : 150;
    for (let dz = -SR; dz <= SR; dz++) for (let dx = -SR; dx <= SR; dx++) {
      const sx = s0x + dx, sz = s0z + dz;
      if (sx < 0 || sz < 0 || sx >= this.nsx || sz >= this.nsz) continue;
      const key = sx + '_' + sz;
      if (this.lod.has(key)) continue;
      const d = this.superDist(cam, sx, sz);
      if (d < cfg.lodIn) {
        this.lod.set(key, { key, sx, sz, state: 'queued', job: null, out: null, d, cancel: false, rebuild: false, f0: this._frame });
        if (bake) bake.prefetch('lod', sx, sz);
      } else if (bake && d < cfg.lodIn + pm) bake.prefetch('lod', sx, sz);
    }
    // v2: 木のデータ（タイル）が無いまま出来た区画は、そのタイルが届いたら作り直す（0.5 秒ごとに見る。出来ている形を見せたまま）
    if (this._reqOK && this.city.chunkReady && (this._frame % 30) === 0) {
      for (const rec of this.lod.values()) {
        const pd = rec.state === 'built' && !rec.rebuild && rec.out && rec.out.pending;
        if (!pd) continue;
        for (let i = 0; i < pd.length; i += 2) if (this.city.chunkReady(pd[i], pd[i + 1])) { rec.rebuild = true; this.stats.decorRebuilds = (this.stats.decorRebuilds || 0) + 1; break; }
      }
    }
    // 先読みしたがリングに入らなかった区画の復元結果は時々捨てる（持ち続けない。1 つ平均 0.2 MB）
    if (bake && this._frame % 30 === 0) bake.prune((sx, sz) => this.lod.has(sx + '_' + sz) || this.superDist(cam, sx, sz) < cfg.lodIn + pm + side * 0.5);
    for (const rec of this.lod.values()) {
      rec.d = this.superDist(cam, rec.sx, rec.sz);
      if (rec.d > cfg.lodOut) this._dropLod(rec);
    }
    // --- 組み立て ---
    this._run(budgetMs != null ? budgetMs : cfg.buildMsPerFrame);
    // --- 表示の切り替え ---
    if (this._hideDirty) this._applyHide();
    const idist = cfg.interiorDist;
    for (const rec of this.full.values()) {
      if (rec.state !== 'built' || !rec.out) continue;
      const r = rec.out.rect;
      const dx = Math.max(r[0] - cam.x, 0, cam.x - r[2]), dz = Math.max(r[1] - cam.z, 0, cam.z - r[3]);
      rec.out.int.visible = dx * dx + dz * dz < idist * idist && cam.y < (this.tops[rec.cz * city.ncx + rec.cx] || 0) + idist;
    }
    let skyVisible = 0;
    for (const [k, s] of this.sky) {
      const l = this.lod.get(k);
      s.mesh.visible = !(l && l.state === 'built' && l.out) && !s.mesh.userData.cutEmpty; // cutEmpty: GLB のランドマークの部品だけだった区画
      if (s.mesh.visible) skyVisible++;
    }
    this._count(skyVisible);
  }

  _count(skyVisible) {
    let fb = 0, lb = 0, q = 0;
    for (const r of this.full.values()) { if (r.state === 'built') fb++; if (r.state !== 'built' || r.rebuild) q++; }
    for (const r of this.lod.values()) { if (r.state === 'built') lb++; if (r.state !== 'built' || r.rebuild) q++; }
    const st = this.stats;
    st.full = this.full.size; st.fullBuilt = fb; st.lod = this.lod.size; st.lodBuilt = lb; st.queue = q; st.skyVisible = skyVisible;
  }

  // LOD の仕事で次にやるもの（作りかけ → 近い順）。late: lodShareAfter フレームより長く待っている仕事だけ
  _pickLod(late) {
    let best = null, bestScore = Infinity;
    const after = this.cfg.lodShareAfter == null ? 2 : this.cfg.lodShareAfter, now = this._frame;
    for (const rec of this.lod.values()) {
      if (rec.state === 'built' && !rec.rebuild) continue;
      if (rec.park === now) continue; // 前もって作った形の復元を待っている（このフレームはもう見ない）
      if (late && rec.state !== 'building' && now - (rec.f0 || 0) < after) continue;
      const s = rec.d - (rec.state === 'building' ? 1000 : 0);
      if (s < bestScore) { bestScore = s; best = rec; }
    }
    return best;
  }

  // 作る仕事を 1 つ選ぶ: 近景（近い順）→ LOD → 先読み
  _pick(fullUsed) {
    let best = null, bestScore = Infinity;
    if (!fullUsed) {
      for (const rec of this.full.values()) {
        if (rec.state === 'built' && !rec.rebuild) continue;
        if (!rec.job && !this._dataReady(rec)) continue; // v2: タイルがまだ（頼んである）。このフレームは LOD が描く
        const c = this.city, x = c.minX + (rec.cx + 0.5) * this.cs, z = c.minZ + (rec.cz + 0.5) * this.cs;
        // 先の所（遠い lead）は作りかけの次（死んでいる間は死んだ所のリングより先: 待ち時間の 3 秒で間に合わせる）
        const s = (rec.lead && rec.d > this.cfg.fullOut ? -500 : rec.d - this._viewBonus(this._cam, x, z)) - (rec.state === 'building' ? 1000 : 0);
        if (s < bestScore) { bestScore = s; best = rec; }
      }
      if (best) return { rec: best, kind: 'full' };
    }
    const lod = this._pickLod();
    if (lod) return { rec: lod, kind: 'lod' };
    // 先読み: カメラの周りのチャンクデータ（近景・当たり判定に入る前に）
    const R = this.cfg.prefetchRadius || 0;
    if (R > 0) {
      const c = this.city.chunkOf(this._cam.x, this._cam.z);
      let pb = null, pd = Infinity;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const cx = c.cx + dx, cz = c.cz + dz;
        if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz || this.world.cache.has(cx, cz)) continue;
        if (this._cam.y > (this.tops[cz * this.city.ncx + cx] || 0) + 150) continue; // 高い所では要らない
        if (this._reqOK && !this.city.request(cx, cz)) continue; // v2: タイルを頼む（届いたら次のフレームで先読み）
        const d = Math.abs(dx) + Math.abs(dz);
        if (d < pd) { pd = d; pb = { cx, cz }; }
      }
      if (pb && !this.world.cache.victimNear(c.cx, c.cz, R)) return { rec: pb, kind: 'prefetch' };
    }
    return null;
  }

  // 近景のチャンクのデータを作れるか（v2 の街: 要るタイルが届いているか。届いていなければ頼む）。v1 の街（request が無い）はいつも true
  _dataReady(rec) {
    if (!this._reqOK || this.world.cache.has(rec.cx, rec.cz)) return true;
    if (this.city.request(rec.cx, rec.cz)) return true;
    rec.waits = (rec.waits || 0) + 1;
    this.stats.waits++;
    return false;
  }

  // 仕事を 1 歩進める（終わったら _finish）
  _step(cur) {
    const s0 = MR.CityWorld.now();
    let r;
    try { r = cur.rec.job.next(); } catch (e) {
      console.error('[Streamer] 組み立てに失敗:', cur.rec.key, e);
      if (cur.rec.ctx) for (const g of cur.rec.ctx.geos) this.world._release(g);
      r = { done: true, value: null };
    }
    const ms = MR.CityWorld.now() - s0;
    const label = cur.kind + ':' + (r.done ? 'finish' : (r.value || 'step'));
    if (r.value === 'wait' && !r.done) { // 前もって作った形の復元待ち: この区画は置いて次の仕事へ（予算・1 歩の記録に数えない）
      cur.rec.park = this._frame; cur.done = true; this.stats.bake.waits++;
      return ms;
    }
    this._ema(this.cfg.buildFill !== false && label === 'full:gen' ? 'gen' : (cur.rec.baked ? 'lodBake' : cur.kind), ms); // chunkFull の生成は別に（buildFill の予測）
    if (label === 'lod:inflate' || label === 'lod:decode') cur.rec.baked = true;
    cur.rec.stepped = true;
    this._stepStat(label, ms);
    if (r.done) {
      cur.done = true;
      cur.rec.ctx = null;
      this._finish(cur.rec, cur.kind, r.value);
      this.stats.jobs++;
    }
    return ms;
  }
  // 1 歩の最大（ラベルごと）。stepMsMax は組み立ての歩の最大、stepMsMaxEx はチャンクのデータの生成（full:gen・先読み）を除いた最大
  _stepStat(label, ms) {
    const st = this.stats;
    if (!(ms <= st.stepMs[label])) st.stepMs[label] = Math.round(ms * 100) / 100;
    if (label === 'prefetch') return;
    if (ms > st.stepMsMax) st.stepMsMax = ms;
    if (label !== 'full:gen' && !(ms <= st.stepMsMaxEx)) st.stepMsMaxEx = ms;
  }

  // 予算（ms）の間、仕事を 1 歩ずつ進める。（LOD の取り分があれば先に LOD）→ 近景 → LOD → 先読み → 手が空けば Canvas のテクスチャの先作り
  //   予算: buildMsPerFrame。立っているチャンクの近景が無いときは 3 倍（近景だけ）。見えている所に穴があるときは detailBoost 倍
  //   （出来ていない近景のチャンクが視線の前か boostNear m 以内）/ lodBoost 倍（出来ていない LOD の区画が視線の前か boostNearLod m 以内）。
  //   以前は「次の 1 歩で予算を大きく超えそうなら止める」だけで、1 歩が長かった頃は歩の分だけ予算を超えて（1 フレーム 8〜25 ms、遅い端末は
  //   その数倍）たまたま速く出来ていた。1 歩を短くして予算を守ると、ファイルのある端末の真似（ベンチの --prewarm）で近景の出遅れが
  //   変更前より 18〜21 % 悪くなった（瞬間移動の後に近景がそろうまでは LOD の取り分のせい）。今は予算の使い方を変えずに、穴が見えている
  //   フレームだけ予算を増やす（1 フレームの組み立ては予算 × boost まで。1 歩が短いので超えるのは最後の 1 歩の分だけ）
  //   buildFill（既定 true）: 予算の中は歩を続ける（「次の歩が予算を超えそうか」の予測で止めない。chunkFull の生成 'full:gen' だけは
  //   その長さ（_stepEma.gen）で予測して止める）。maxFullPerFrame（2）: 1 フレームに進める近景のチャンクの数（1 つ目が途中で出来たら 2 つ目）
  _run(budget) {
    const t0 = MR.CityWorld.now();
    this._frame++;
    const cfg = this.cfg, fill = cfg.buildFill !== false, maxFull = cfg.maxFullPerFrame > 0 ? cfg.maxFullPerFrame : 2;
    let fullJobs = 0, steps = 0, lodSteps = 0, current = null;
    const dBoost = cfg.detailBoost > 1 ? cfg.detailBoost : 1, lBoost = cfg.lodBoost > 1 ? cfg.lodBoost : 1;
    let urgent = false, seen = false, seenLod = false;
    for (const rec of this.full.values()) {
      if (rec.state === 'built') continue;
      if (rec.d === 0) { urgent = true; break; }
      if (!seen && dBoost > 1 && !(rec.lead && rec.d > cfg.fullOut)) { // 先の所（遠い lead）は見えている穴ではない
        const c = this.city;
        seen = rec.d < (cfg.boostNear == null ? 40 : cfg.boostNear) || this._viewBonus(this._cam, c.minX + (rec.cx + 0.5) * this.cs, c.minZ + (rec.cz + 0.5) * this.cs) > 0;
      }
    }
    if (!urgent && lBoost > 1) {
      const side = this.S * this.cs, c = this.city;
      for (const rec of this.lod.values()) {
        if (rec.state === 'built') continue;
        if (rec.d < (cfg.boostNearLod == null ? 100 : cfg.boostNearLod) || this._viewBonus(this._cam, c.minX + (rec.sx + 0.5) * side, c.minZ + (rec.sz + 0.5) * side) > 0) { seenLod = true; break; }
      }
    }
    // calm（フレーム数。game.js が復活のフレームに入れる）: そのフレームは予算を増やさず半分に（復活のフレームは当たり判定・家具・
    //   乗り物の読み込みで重い。見えない間は #respawn-fade で暗いので、近景は次のフレームから増やした予算で）
    if (this.calm > 0) { this.calm--; urgent = false; seen = false; seenLod = false; budget *= 0.5; this.stats.calmFrames = (this.stats.calmFrames || 0) + 1; }
    if (urgent) budget *= 3;
    else if (seen || seenLod) { budget *= Math.max(seen ? dBoost : 1, seenLod ? lBoost : 1); this.stats.boostFrames++; }
    this.stats.budget = budget;
    // LOD の取り分（lodShare。既定 0 = 使わない）: lodShareAfter フレームより長く待っている（か作りかけの）区画があるとき、組み立て時間の
    //  lodShare の割合を先に LOD に。lodShareAbove（m）があればカメラがその高さより上のときだけ。取り分は時間の貯金（_lodCredit: 待っている
    //  フレームごとに budget × lodShare ms、上限 × lodShareCap。LOD の 1 歩はかかった ms を引く）。M0 は 0.4 にしていたが、瞬間移動の後に
    //  近景がそろうまでが長くなり（ベンチの --prewarm で heli40 / heli150 / jet80 の tp full 12 / 12 / 14 → 19 / 17 / 19）、LOD が早くなったのは
    //  jet80 だけだった。今は見えている穴の boost（lodBoost）で LOD も早い
    const shareOn = cfg.lodShareAbove == null || this._cam.y >= cfg.lodShareAbove;
    const lodWork = !!this._pickLod(), lodLate = lodWork && !urgent && shareOn && !!this._pickLod(true);
    const frac = cfg.lodShare > 0 ? cfg.lodShare : 0;
    if (lodLate && frac > 0) this._lodCredit = Math.min(budget * frac * (cfg.lodShareCap == null ? 2 : cfg.lodShareCap), this._lodCredit + budget * frac);
    else this._lodCredit = 0;
    if (lodLate && this._lodCredit > 0) {
      let cur = null;
      for (let guard = 0; guard < 10000; guard++) {
        if (this._lodCredit <= 0 || MR.CityWorld.now() - t0 >= budget) break;
        if (!cur || cur.done) {
          const rec = this._pickLod(true);
          if (!rec) break;
          cur = { rec, kind: 'lod' };
          if (!rec.job) this._start(rec, 'lod');
        }
        this._lodCredit -= this._step(cur);
        steps++; lodSteps++;
      }
      this.stats.lodShareMs = MR.CityWorld.now() - t0;
    } else this.stats.lodShareMs = 0;
    for (let guard = 0; guard < 10000; guard++) {
      const el = MR.CityWorld.now() - t0;
      if (el >= budget) break;
      if (!current || current.done) {
        const p = this._pick(fullJobs >= maxFull);
        if (!p) break;
        if (p.kind === 'prefetch') {
          if (steps > 0 && el + this._stepEma.prefetch > budget) break;
          const s0 = MR.CityWorld.now();
          this.world.cache.full(p.rec.cx, p.rec.cz);
          const ms = MR.CityWorld.now() - s0;
          this._ema('prefetch', ms);
          this._stepStat('prefetch', ms);
          this.stats.prefetch++;
          steps++;
          current = null;
          continue;
        }
        current = p;
        if (p.kind === 'full') fullJobs++; // 1 フレームに進める近景のチャンクは maxFullPerFrame まで（新しいチャンクの形を GPU に送るのが重ならないように）
        if (!p.rec.job) this._start(p.rec, p.kind);
      }
      if (steps > 0) {
        if (fill) {
          // 予算の中は続ける。次が chunkFull の生成（作り始めの 1 歩でデータがまだ無い）で、大きく超えそうなら次のフレームへ
          const genNext = current.kind === 'full' && !current.rec.stepped && !this.world.cache.has(current.rec.cx, current.rec.cz);
          if (genNext && el + this._stepEma.gen > budget * 1.25) break;
        } else if (el + this._stepEma[current.kind] > budget * 1.25) break; // 次の 1 歩で大きく超えそうなら次のフレームへ（以前の形）
      }
      this._step(current);
      steps++;
      if (current.kind === 'lod') lodSteps++;
    }
    // 手の空いた時間（予算の残り）: 画像の無い材質の Canvas のテクスチャを少しずつ（world.warmStep。起動時の prime ではしない = 起動を長くしない）
    const w = this.world;
    if (w._warmQueue && w._warmQueue.length && !this._priming && !urgent) {
      const s0 = MR.CityWorld.now();
      if (s0 - t0 < budget) { w.warmStep(t0 + budget); this._stepStat('warm', MR.CityWorld.now() - s0); steps++; }
    }
    // LOD の仕事があるのに進めなかったフレームが続いた数（取り分が効いているか）
    if (lodWork && !lodSteps) { this._lodWait++; if (this._lodWait > this.stats.lodWaitMax) this.stats.lodWaitMax = this._lodWait; } else this._lodWait = 0;
    const ms = MR.CityWorld.now() - t0;
    const st = this.stats;
    st.buildMs = ms; st.steps += steps; st.frames++;
    if (ms > st.buildMsMax) st.buildMsMax = ms;
    st.buildMsAvg += (ms - st.buildMsAvg) * 0.05;
    if (ms > budget * 1.5 && steps > 0) st.overruns++;
  }
  _ema(kind, ms) { this._stepEma[kind] += (ms - this._stepEma[kind]) * 0.2; }

  _start(rec, kind) {
    rec.state = rec.state === 'built' ? 'built' : 'building';
    rec.stepped = false;
    rec.ctx = { geos: [] };
    if (kind === 'full') {
      this.world.cache.pin(rec.key, 'build');
      rec.job = this.world.buildFull(rec.cx, rec.cz, rec.ctx);
    } else {
      rec.baked = false;
      rec.job = this.world.lodJob ? this.world.lodJob(rec.sx, rec.sz, rec.ctx) : this.world.buildLod(rec.sx, rec.sz, rec.ctx);
    }
  }

  _finish(rec, kind, out) {
    rec.job = null;
    if (kind === 'lod' && out && out.geos && out.geos[0]) { if (out.geos[0].userData.baked) this.stats.bake.lod++; else this.stats.bake.lodGen++; }
    if (kind === 'lod' && this.world.bake) this.world.bake.forget('lod', rec.sx, rec.sz); // ほかの道（メインスレッド・その場で作った）で出来た: ワーカーの復元は要らない
    if (kind === 'full') this.world.cache.unpin(rec.key, 'build');
    if (rec.cancel) { this._disposeOut(out, kind); return; }
    // v2: データが作れなかった（タイルが捨てられた・まだ）近景は出来上がりにしない（次のフレームからまた待つ。LOD が描いたまま）
    if (kind === 'full' && !out && this._reqOK && !this.world.cache.has(rec.cx, rec.cz)) { if (rec.state !== 'built') rec.state = 'queued'; return; }
    if (rec.out) this._disposeOut(rec.out, kind); // 作り直し: 古いものと入れ替える
    rec.out = out;
    rec.state = 'built';
    rec.rebuild = false;
    if (kind === 'full' && out) {
      this.world.root.add(out.root);
      this._hideDirty = true;
      this.world.props.markDirty();
      if (this.onFullBuilt) this.onFullBuilt(rec, out); // 壊れた物の形を合わせる（destruct_view.js）
    }
  }

  _disposeOut(out, kind) {
    if (!out) return;
    if (kind === 'full') { if (out.root.parent) out.root.parent.remove(out.root); }
    else if (out.mesh && out.mesh.parent) out.mesh.parent.remove(out.mesh);
    for (const g of out.geos || []) this.world._release(g);
  }

  _dropFull(rec) {
    this.full.delete(rec.key);
    if (rec.job) this._abort(rec, 'full'); // 作りかけ: それまでに作った BufferGeometry（ctx.geos）を解放して捨てる
    this._disposeOut(rec.out, 'full');
    rec.out = null;
    this._hideDirty = true;
    this.world.props.markDirty();
  }
  _dropLod(rec) {
    this.lod.delete(rec.key);
    if (this.world.bake) this.world.bake.forget('lod', rec.sx, rec.sz); // 復元しておいた形が残っていれば捨てる
    if (rec.job) this._abort(rec, 'lod');
    this._disposeOut(rec.out, 'lod');
    rec.out = null;
  }
  _abort(rec, kind) {
    try { rec.job.return(null); } catch (e) { /* 終わっている */ }
    rec.job = null;
    if (rec.ctx) { for (const g of rec.ctx.geos) this.world._release(g); rec.ctx = null; } // 作りかけの形
    rec.cancel = true;
    if (kind === 'full') this.world.cache.unpin(rec.key, 'build');
  }

  // 作りかけの仕事を捨てて最初から（ランドマークが届いた）。出来上がった形があればそれを見せたまま作り直す
  _restart(rec, kind) {
    try { rec.job.return(null); } catch (e) { /* 終わっている */ }
    rec.job = null;
    if (rec.ctx) { for (const g of rec.ctx.geos) this.world._release(g); rec.ctx = null; }
    if (kind === 'full') this.world.cache.unpin(rec.key, 'build');
    if (rec.out) { rec.state = 'built'; rec.rebuild = true; } else rec.state = 'queued';
  }

  // 遠景から消すチャンク = 出来上がった近景
  _applyHide() {
    this._hideDirty = false;
    const list = [];
    for (const rec of this.full.values()) if (rec.state === 'built' && rec.out) list.push(rec);
    list.sort((a, b) => a.d - b.d);
    this.world.setHidden(list);
  }

  // ランドマークの GLB が読めた（world.lmLoaded に入った後に呼ばれる）: 出来上がっている近景・LOD・スカイラインのメッシュから代わりの箱の
  //   部分（lm セグメント）を切るだけ（CityWorld.cutSegments: インデックスの並べ替え。作り直さない・スカイラインも作り直さない）。
  //   以前はスカイラインを全部その場で作り直し（124〜252 ms）、LOD と lm のある近景を全部作り直しの待ち行列に入れていた。
  //   作りかけ（job がある）のものは M0 のとおり最初からやり直す（_restart。組み立ての最後の歩でも今の lmLoaded で切るので、
  //   やり直さなくても形は正しい。やり直しても待ち行列に戻るのは作りかけの数個だけ）。stats.landmarkMs / landmarkMeshes に時間と切った数
  invalidateLandmarks(nodes) {
    const t0 = MR.CityWorld.now(), W = this.world;
    const set = {};
    for (const n of nodes) set[n] = true;
    const hasLm = (list) => { for (const b of list || []) if (b.lm && set[b.lm]) return true; return false; };
    let n = 0;
    for (const rec of this.full.values()) {
      if (rec.job) {
        const d = W.cache.map.get(rec.key);
        if (!d || !d.full || hasLm(d.full.boxes) || hasLm(d.full.ramps)) this._restart(rec, 'full');
      }
      if (rec.out) n += W._cutObject(rec.out.root);
    }
    for (const rec of this.lod.values()) {
      if (rec.job) this._restart(rec, 'lod');
      if (rec.out) n += W._cutObject(rec.out.mesh);
    }
    for (const s of this.sky.values()) n += W._cutObject(s.mesh);
    this.stats.landmarkMs = MR.CityWorld.now() - t0;
    this.stats.landmarkMeshes = n;
  }

  // 起動時: 立っている所の近景と LOD を、maxMs まで続けて作る（最初のフレームから街が見えるように）
  prime(cam, maxMs) {
    const t0 = MR.CityWorld.now();
    this._priming = true;
    for (let i = 0; i < 2000; i++) {
      const s0 = this.stats.steps;
      this.update(cam, null, 50);
      if (!this.stats.queue || MR.CityWorld.now() - t0 > maxMs) break;
      if (this._reqOK && this.stats.steps === s0) break; // v2: 残りはタイル待ちだけ（待っても届かない。続きは毎フレームの update）
    }
    this._priming = false;
    const bk = this.world.bake; // prime で出来なかった LOD の区画（maxMs を過ぎた）はワーカーで復元を始めておく
    if (bk) for (const rec of this.lod.values()) if (rec.state === 'queued' && !rec.job) bk.prefetch('lod', rec.sx, rec.sz);
    this.resetTimings();
    return MR.CityWorld.now() - t0;
  }
  // 1 フレームの組み立て時間の記録をやり直す（起動時のまとめての組み立ては数えない）
  resetTimings() {
    const st = this.stats;
    st.buildMsMax = 0; st.stepMsMax = 0; st.stepMsMaxEx = 0; st.overruns = 0; st.frames = 0; st.steps = 0; st.stepMs = {}; st.lodWaitMax = 0; st.boostFrames = 0;
  }

  // 全部捨てる（停止・テスト）
  dispose() {
    for (const rec of Array.from(this.full.values())) this._dropFull(rec);
    for (const rec of Array.from(this.lod.values())) this._dropLod(rec);
    for (const s of this.sky.values()) this._disposeOut(s, 'lod');
    this.sky = new Map();
    this.world.setHidden([]);
  }
};
