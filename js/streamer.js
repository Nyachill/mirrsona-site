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
//   距離はカメラの位置（高さを含む）で測るので、高い所（ヘリ）では近景が減り、遠景が広がる。
//   作る順番: 近景（近い順、視線の前を少し優先）→ LOD（近い順）→ 先読み → 手が空けば画像の無い材質の Canvas のテクスチャ（world.warmStep）。
//                   立っているチャンクの近景が無いときは近景だけ（予算 3 倍）。見えている所に穴（出来ていない近景 / LOD）があるフレームは
//                   予算を detailBoost / lodBoost 倍（_run の説明）。LOD の取り分（lodShare、既定 0）で LOD を先にもできる。
//   1 歩の長さ: world.buildFull / buildLod が buildStepMs（既定 2 ms）の目安で yield する。chunkFull の生成（full:gen・先読み）は分けられない
//   stats: { full, fullBuilt, lod, lodBuilt, sky, skyVisible, queue, buildMs（直近のフレーム）, buildMsMax, buildMsAvg, steps, jobs, overruns,
//            stepMs（ラベルごとの 1 歩の最大）, stepMsMax, stepMsMaxEx（chunkFull の生成を除く）, lodShareMs, lodWaitMax,
//            budget（直近のフレームの予算 ms）, boostFrames（穴が見えて予算を増やしたフレームの数）}
window.MR = window.MR || {};

// chunkFull / chunkLod / chunkDecor の結果を覚えておく（LRU）。pin されているもの（当たり判定・作りかけの近景）は捨てない
MR.CityChunkCache = class CityChunkCache {
  constructor(city, opts) {
    opts = opts || {};
    this.city = city;
    this.cap = opts.cap || 40;
    this.map = new Map();
    this.stats = { generated: 0, genMs: 0, genMsMax: 0, evicted: 0, lod: 0, decor: 0 };
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
      this.stats.generated++; this.stats.genMs += ms; if (ms > this.stats.genMsMax) this.stats.genMsMax = ms;
    }
    return e.full;
  }
  lod(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz) return null;
    const e = this._entry(cx, cz);
    if (!e.lod) { e.lod = this.city.chunkLod(cx, cz); this.stats.lod++; }
    return e.lod;
  }
  decor(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz) return null;
    const e = this._entry(cx, cz);
    if (!e.decor) { e.decor = this.city.chunkDecor(cx, cz); this.stats.decor++; }
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
    this.tops = this.city.chunkTops();
    this.superTops = new Float32Array(this.nsx * this.nsz);
    for (let cz = 0; cz < this.city.ncz; cz++) for (let cx = 0; cx < this.city.ncx; cx++) {
      const k = Math.floor(cz / this.S) * this.nsx + Math.floor(cx / this.S);
      this.superTops[k] = Math.max(this.superTops[k], this.tops[cz * this.city.ncx + cx]);
    }
    this.full = new Map();   // key → { key, cx, cz, state: 'queued'|'building'|'built', job, out, d, cancel, rebuild }
    this.lod = new Map();    // 'sx_sz' → { key, sx, sz, state, job, out, d, cancel }
    this.stats = { full: 0, fullBuilt: 0, lod: 0, lodBuilt: 0, sky: 0, skyVisible: 0, queue: 0, prefetch: 0, buildMs: 0, buildMsMax: 0, buildMsAvg: 0, steps: 0, jobs: 0, overruns: 0, frames: 0, stepMsMax: 0, stepMs: {}, stepMsMaxEx: 0, lodShareMs: 0, lodWaitMax: 0, budget: 0, boostFrames: 0 };
    this._stepEma = { full: 1, lod: 1, prefetch: 2, gen: 4 };
    this._lodWait = 0;     // LOD の仕事があるのに 1 歩も進めなかったフレームの数（stats.lodWaitMax）
    this._frame = 0;       // _run の回数（LOD の区画が待っているフレーム数を数える）
    this._lodCredit = 0;   // LOD の取り分の貯金（ms。_run）
    this._cam = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, -1);
    const t0 = MR.CityWorld.now();
    this.sky = world.buildSkyline(this.S);
    this.stats.sky = this.sky.size;
    this.stats.skylineMs = MR.CityWorld.now() - t0;
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
    for (const rec of this.full.values()) {
      rec.d = this.chunkDist(cam, rec.cx, rec.cz);
      if (rec.d > cfg.fullOut) this._dropFull(rec);
    }
    // --- LOD のリング（512 m 区画）---
    const side = this.S * this.cs;
    const s0x = Math.floor((cam.x - city.minX) / side), s0z = Math.floor((cam.z - city.minZ) / side);
    const SR = Math.ceil(cfg.lodOut / side) + 1;
    for (let dz = -SR; dz <= SR; dz++) for (let dx = -SR; dx <= SR; dx++) {
      const sx = s0x + dx, sz = s0z + dz;
      if (sx < 0 || sz < 0 || sx >= this.nsx || sz >= this.nsz) continue;
      const key = sx + '_' + sz;
      if (this.lod.has(key)) continue;
      const d = this.superDist(cam, sx, sz);
      if (d < cfg.lodIn) this.lod.set(key, { key, sx, sz, state: 'queued', job: null, out: null, d, cancel: false, rebuild: false, f0: this._frame });
    }
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
      s.mesh.visible = !(l && l.state === 'built' && l.out);
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
        const c = this.city, x = c.minX + (rec.cx + 0.5) * this.cs, z = c.minZ + (rec.cz + 0.5) * this.cs;
        const s = rec.d - this._viewBonus(this._cam, x, z) - (rec.state === 'building' ? 1000 : 0);
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
        const d = Math.abs(dx) + Math.abs(dz);
        if (d < pd) { pd = d; pb = { cx, cz }; }
      }
      if (pb && !this.world.cache.victimNear(c.cx, c.cz, R)) return { rec: pb, kind: 'prefetch' };
    }
    return null;
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
    this._ema(this.cfg.buildFill !== false && label === 'full:gen' ? 'gen' : cur.kind, ms); // chunkFull の生成は別に（buildFill の予測）
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
      if (!seen && dBoost > 1) {
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
    } else rec.job = this.world.buildLod(rec.sx, rec.sz, rec.ctx);
  }

  _finish(rec, kind, out) {
    rec.job = null;
    if (kind === 'full') this.world.cache.unpin(rec.key, 'build');
    if (rec.cancel) { this._disposeOut(out, kind); return; }
    if (rec.out) this._disposeOut(rec.out, kind); // 作り直し: 古いものと入れ替える
    rec.out = out;
    rec.state = 'built';
    rec.rebuild = false;
    if (kind === 'full' && out) {
      this.world.root.add(out.root);
      this._hideDirty = true;
      this.world.props.markDirty();
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

  // ランドマークの GLB が読めた: 代わりの箱を含む近景・LOD・スカイラインを作り直す
  //   作りかけ（job がある）のものは、それまでの歩で代わりの箱を書いているので最初からやり直す（_finish は rebuild を消すので、
  //   印を付けるだけだと代わりの箱が残った）
  invalidateLandmarks(nodes) {
    const set = {};
    for (const n of nodes) set[n] = true;
    const hasLm = (list) => { for (const b of list || []) if (b.lm && set[b.lm]) return true; return false; };
    for (const rec of this.full.values()) {
      const d = this.world.cache.map.get(rec.key);
      const lm = !d || !d.full || hasLm(d.full.boxes) || hasLm(d.full.ramps);
      if (rec.job) { if (lm) this._restart(rec, 'full'); } else if (d && d.full && lm) rec.rebuild = true;
      else if (!d || !d.full) rec.rebuild = rec.state === 'built';
    }
    for (const rec of this.lod.values()) {
      if (rec.job) this._restart(rec, 'lod');
      else rec.rebuild = rec.rebuild || rec.state === 'built';
    }
    // スカイラインは全部作り直す（数十 ms。起動直後の 1 回だけ）
    for (const s of this.sky.values()) this._disposeOut(s, 'lod');
    this.sky = this.world.buildSkyline(this.S);
    this.stats.sky = this.sky.size;
  }

  // 起動時: 立っている所の近景と LOD を、maxMs まで続けて作る（最初のフレームから街が見えるように）
  prime(cam, maxMs) {
    const t0 = MR.CityWorld.now();
    this._priming = true;
    for (let i = 0; i < 2000; i++) {
      this.update(cam, null, 50);
      if (!this.stats.queue || MR.CityWorld.now() - t0 > maxMs) break;
    }
    this._priming = false;
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
