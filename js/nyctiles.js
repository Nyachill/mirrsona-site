// 「本物のニューヨーク」のタイル（assets/levels/nyc/t_<tx>_<tz>.bin）を必要な分だけ読んでデコードしておく係（MR.NycTiles）。
//   THREE にも DOM にも依存しない（citygen.js / nycdata.js と同じ UMD）。
//   ブラウザ: <script> で読む → MR.NycTiles      Node / Worker: require('../www/js/nyctiles.js') → NycTiles（globalThis.MR.NycTiles にも入る）
//   デコードは MR.NycData.decodeTile。タイルの版（v1 / v2）は気にしない（知らないセクションは nycdata.js が飛ばす）。
//
// ■ 2 つの読み方（backend）
//   NycTiles.fromAssets(assets, meta?, opts)  ブラウザ: assets.fetchLazy(path, { priority }) → Promise<ArrayBuffer>（無ければ assets.getBuffer、
//                                            それも無ければ assets.server からそのまま fetch）。届いたものはデコードの待ち行列に入り、pump(budgetMs) が
//                                            1 回に 1 つまでデコードする。なので「まだ無い」（ready() が false）ことがある
//   NycTiles.fromFs(dir, meta, opts)         Node: 初めて使ったときにその場で読んでデコードする（同期）。ready() は常に true
//                                            meta を省くと assets.data['levels/nyc/nyc.json']（opts.metaPath。nyc.json は lazy でない）。
//                                            priority は fetchLazy の向き（小さいほど先）に直して渡す（NycTiles.lazyPriority）
//   meta = nyc.json（bounds / tile / tilesX / tilesZ / tiles / tileFile）。meta.tiles に無いタイル = ファイルが無い = 全部水（ready で get は null）
//
// ■ API
//   tiles.ready(tx, tz) → bool                デコード済み（かファイルが無い）。fs は常に true
//   tiles.get(tx, tz) → タイル | null         デコード済みのタイル（NycData.decodeTile の結果）。使った印を付ける（LRU）。fs は無ければその場で作る。
//                                            ファイルが無い・まだ無い・壊れていた → null（区別は ready / state）
//   tiles.peek(tx, tz)                        get と同じだが LRU の順番を変えない・fs でも作らない
//   tiles.state(tx, tz) → 'none'（ファイル無し）| 'idle' | 'fetching' | 'queued'（届いてデコード待ち）| 'ready' | 'error'
//   tiles.request(cx, cz, priority?) → bool   チャンク（128 m）を作るのに要るタイルを頼む。全部 ready なら true（頼んだ時点で無ければ stats.waits++）
//   tiles.requestTile(tx, tz, priority?)      1 枚だけ頼む。priority は大きいほど先（既定 0）
//   tiles.tilesForChunk(cx, cz) → [[tx, tz]]  チャンクの矩形（+ opts.chunkMargin m）にかかるファイルのあるタイル
//   tiles.whenReady(rect) → Promise           rect = [x0, z0, x1, z1]（m）。中のタイルが全部 ready になったら解決（壊れたタイルがあれば reject。
//                                            失敗して retryMs の間のタイルがあればすぐ reject = 決して待ちっぱなしにならない。retryMs の後なら取り直す）
//   tiles.pump(budgetMs) → 0 | 1              デコードを 1 つだけ進める（budgetMs ≤ 0 なら何もしない）。毎フレーム呼ぶ
//   tiles.prefetchAround(x, z, radiusTiles, leadVx, leadVz) → 新しく頼んだ数
//                                            (x, z) の周り radiusTiles 枚と、(x + leadVx, z + leadVz)（先読みの位置。m。速度 × 秒を呼ぶ側で掛ける）の周り。近いほど先
//   tiles.pin(tx, tz) / unpin(tx, tz)         使っている間は LRU から捨てない（回数を数える）。pinChunk / unpinChunk はチャンクのタイル全部
//   tiles.stats                               { decoded, fetched, waits, decodeMsMax, evicted, errors, live, queued, inflight }
//   tiles.dispose()                           デコード済みを全部捨てる・待っている whenReady は reject
//   opts: { cache（デコード済みを持つ枚数。既定 32）, concurrency（同時に取りに行く数。既定 2）, chunkSize（128）, chunkMargin（0 m）,
//           dir（'levels/nyc/'。fromAssets のパスの頭）, retryMs（失敗した後に頼み直せるまで。既定 2000）, now（時計。テスト用）}
(function (root) {
  const MR = root.MR || (root.MR = {});
  let NycData = MR.NycData;
  if (!NycData && typeof require === 'function') { try { NycData = require('./nycdata.js'); } catch (e) { NycData = null; } }

  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  function tileName(meta, tx, tz) {
    const f = meta.tileFile || 't_{tx}_{tz}.bin';
    return f.replace('{tx}', tx).replace('{tz}', tz);
  }

  class NycTiles {
    // backend: { sync: true, read(path) → ArrayBuffer|Uint8Array }  か  { sync: false, fetch(path, priority) → Promise<ArrayBuffer> }
    constructor(meta, backend, opts) {
      opts = opts || {};
      if (!meta || !meta.bounds) throw new Error('NycTiles: meta (nyc.json) expected');
      this.meta = meta;
      this.backend = backend;
      this.sync = !!backend.sync;
      this.dir = opts.dir != null ? opts.dir : 'levels/nyc/';
      this.cacheSize = Math.max(1, opts.cache || 32);
      this.concurrency = Math.max(1, opts.concurrency || 2);
      this.chunkSize = opts.chunkSize || 128;
      this.chunkMargin = opts.chunkMargin || 0;
      this.retryMs = opts.retryMs != null ? opts.retryMs : 2000;
      this.now = opts.now || nowMs;
      this.size = meta.tile || 512;
      this.minX = meta.bounds.minX; this.minZ = meta.bounds.minZ;
      this.nx = meta.tilesX || Math.ceil((meta.bounds.maxX - this.minX) / this.size);
      this.nz = meta.tilesZ || Math.ceil((meta.bounds.maxZ - this.minZ) / this.size);
      this.recs = new Map();     // key → { key, tx, tz, state, tile, buf, pins, use, pri, err, retryAt }
      this._fetchQ = [];         // 取りに行く待ち（rec）
      this._decodeQ = [];        // 届いてデコード待ち（rec）
      this._inflight = 0;
      this._live = 0;            // デコード済みの枚数
      this._clock = 0;           // LRU の順番
      this._waiters = [];        // whenReady の { keys, resolve, reject }
      this._disposed = false;
      this._hold = false;
      this.stats = { decoded: 0, fetched: 0, waits: 0, decodeMsMax: 0, decodeMs: 0, evicted: 0, errors: 0, live: 0, queued: 0, inflight: 0 };
    }

    static fromFs(dir, meta, opts) {
      // Node 専用。バンドラー（wrangler / esbuild）が fs / path を解決しようとしないよう module.require で読む
      const req = typeof module !== 'undefined' && module.require ? module.require.bind(module) : require;
      const fs = req('fs'), path = req('path');
      if (!meta) meta = JSON.parse(fs.readFileSync(path.join(dir, 'nyc.json'), 'utf8'));
      const backend = {
        sync: true,
        read(p) {
          const b = fs.readFileSync(path.join(dir, p.slice(p.lastIndexOf('/') + 1)));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        }
      };
      return new NycTiles(meta, backend, opts);
    }

    static fromAssets(assets, meta, opts) {
      // meta を省けば assets の内蔵データ / 読み込み済みの nyc.json（lazy でないので assets.data にある）
      if (!meta && assets) {
        const mp = (opts && opts.metaPath) || 'levels/nyc/nyc.json';
        meta = (assets.data && assets.data[mp]) || (typeof assets.get === 'function' ? assets.get(mp) : null) || null;
      }
      const fetchOne = (p, priority) => {
        // NycTiles の priority は大きいほど先、assets.fetchLazy は小さいほど先（既定 1 = ほかの後から読む物、例: ランドマークの GLB）。
        //   lazyPriority: whenReady（1e6）→ −1000（何よりも先）、prefetchAround（−距離 m）→ 距離 km（1 km より近いタイルは GLB より先）
        if (typeof assets.fetchLazy === 'function') return assets.fetchLazy(p, { priority: NycTiles.lazyPriority(priority) });
        const net = () => {
          if (!assets.server && typeof fetch !== 'function') return Promise.reject(new Error('NycTiles: no way to fetch ' + p));
          const url = (assets.server ? assets.server + '/' : '') + p;
          if (typeof assets._fetchBuffer === 'function') return assets._fetchBuffer(url);
          return fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.arrayBuffer(); });
        };
        if (typeof assets.getBuffer === 'function') return Promise.resolve(assets.getBuffer(p)).then((b) => b || net());
        return net();
      };
      return new NycTiles(meta, { sync: false, fetch: fetchOne }, opts);
    }

    // ---------- 位置 ----------
    key(tx, tz) { return tx + '_' + tz; }
    hasFile(tx, tz) { return !!this.meta.tiles[tx + '_' + tz]; }
    path(tx, tz) { return this.dir + tileName(this.meta, tx, tz); }
    tileOf(x, z) { return [Math.floor((x - this.minX) / this.size), Math.floor((z - this.minZ) / this.size)]; }
    tilesInRect(x0, z0, x1, z1) {
      const a = this.tileOf(x0, z0), b = this.tileOf(x1, z1), out = [];
      for (let tz = Math.max(0, a[1]); tz <= Math.min(this.nz - 1, b[1]); tz++) {
        for (let tx = Math.max(0, a[0]); tx <= Math.min(this.nx - 1, b[0]); tx++) if (this.hasFile(tx, tz)) out.push([tx, tz]);
      }
      return out;
    }
    tilesForChunk(cx, cz) {
      const cs = this.chunkSize, m = this.chunkMargin, x0 = this.minX + cx * cs, z0 = this.minZ + cz * cs;
      // 端はちょうどタイルの境なので 1 cm 内側（隣のタイルを数えない）
      return this.tilesInRect(x0 - m, z0 - m, x0 + cs + m - 0.01, z0 + cs + m - 0.01);
    }

    _rec(tx, tz, make) {
      const k = tx + '_' + tz;
      let r = this.recs.get(k);
      if (!r && make) {
        r = { key: k, tx, tz, state: 'idle', tile: null, buf: null, pins: 0, use: 0, pri: -Infinity, err: null, retryAt: 0 };
        this.recs.set(k, r);
      }
      return r;
    }

    state(tx, tz) {
      if (!this.hasFile(tx, tz)) return 'none';
      const r = this._rec(tx, tz, false);
      return r ? r.state : 'idle';
    }
    ready(tx, tz) {
      if (this.sync || !this.hasFile(tx, tz)) return true;
      const r = this._rec(tx, tz, false);
      return !!r && r.state === 'ready';
    }
    peek(tx, tz) {
      const r = this._rec(tx, tz, false);
      return r && r.state === 'ready' ? r.tile : null;
    }
    get(tx, tz) {
      if (!this.hasFile(tx, tz)) return null;
      let r = this._rec(tx, tz, false);
      if (this.sync && (!r || r.state !== 'ready')) {
        r = this._rec(tx, tz, true);
        try { r.buf = this.backend.read(this.path(tx, tz)); this.stats.fetched++; } catch (e) { this._fail(r, e); return null; }
        this._decode(r);
      }
      if (!r || r.state !== 'ready') return null;
      r.use = ++this._clock;
      return r.tile;
    }

    // ---------- 頼む ----------
    requestTile(tx, tz, priority) {
      if (this._disposed || !this.hasFile(tx, tz)) return false;
      const pri = priority || 0;
      if (this.sync) { this.get(tx, tz); return false; }
      const r = this._rec(tx, tz, true);
      if (r.state === 'ready') { r.use = ++this._clock; return false; }
      if (pri > r.pri) r.pri = pri;
      if (r.state === 'error') {
        if (this.now() < r.retryAt) return false;
        r.state = 'idle';
      }
      if (r.state !== 'idle') return false;
      r.state = 'fetching';
      this._fetchQ.push(r);
      if (!this._hold) this._kick();
      return true;
    }
    request(cx, cz, priority) {
      const list = this.tilesForChunk(cx, cz);
      let ok = true;
      for (const t of list) {
        if (this.sync) { this.get(t[0], t[1]); continue; }
        if (!this.ready(t[0], t[1])) { ok = false; this.requestTile(t[0], t[1], priority); }
        else this._rec(t[0], t[1], false).use = ++this._clock;
      }
      if (!ok) this.stats.waits++;
      return ok;
    }
    whenReady(rect, priority) {
      const list = this.tilesInRect(rect[0], rect[1], rect[2], rect[3]);
      const keys = [];
      for (const t of list) {
        if (this.sync) { if (!this.get(t[0], t[1])) return Promise.reject(new Error('NycTiles: tile ' + this.key(t[0], t[1]) + ' failed')); continue; }
        if (this.ready(t[0], t[1])) continue;
        this.requestTile(t[0], t[1], priority != null ? priority : 1e6);
        const r = this._rec(t[0], t[1], false);
        // 失敗したばかり（retryAt の前）のタイルは取りに行かない = 待っても何も来ないので、すぐ reject（呼ぶ側が後でやり直す）
        if (r && r.state === 'error') return Promise.reject(r.err instanceof Error ? r.err : new Error('NycTiles: tile ' + r.key + ' failed'));
        keys.push(this.key(t[0], t[1]));
      }
      if (!keys.length) return Promise.resolve();
      this.stats.waits++;
      return new Promise((resolve, reject) => { this._waiters.push({ keys, resolve, reject }); });
    }
    prefetchAround(x, z, radiusTiles, leadVx, leadVz) {
      if (this.sync || this._disposed) return 0;
      const R = Math.max(0, radiusTiles | 0);
      let n = 0;
      const around = (px, pz, base) => {
        const c = this.tileOf(px, pz);
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
          const tx = c[0] + dx, tz = c[1] + dz;
          if (tx < 0 || tz < 0 || tx >= this.nx || tz >= this.nz) continue;
          // 近いほど先: タイルの中心までの距離（m）を引く
          const cxm = this.minX + (tx + 0.5) * this.size, czm = this.minZ + (tz + 0.5) * this.size;
          if (this.requestTile(tx, tz, base - Math.hypot(cxm - x, czm - z))) n++;
        }
      };
      this._hold = true; // 全部並べてから優先度の順に取りに行く
      around(x, z, 0);
      if (leadVx || leadVz) around(x + (leadVx || 0), z + (leadVz || 0), -this.size);
      this._hold = false;
      this._kick();
      return n;
    }

    // ---------- 持っておく ----------
    pin(tx, tz) { if (!this.hasFile(tx, tz)) return; this._rec(tx, tz, true).pins++; }
    unpin(tx, tz) {
      const r = this._rec(tx, tz, false);
      if (r && r.pins > 0) r.pins--;
      if (r && !r.pins) this._evict();
    }
    pinChunk(cx, cz) { for (const t of this.tilesForChunk(cx, cz)) this.pin(t[0], t[1]); }
    unpinChunk(cx, cz) { for (const t of this.tilesForChunk(cx, cz)) this.unpin(t[0], t[1]); }

    // ---------- 進める ----------
    _kick() {
      if (this._disposed) return;
      // 優先度の高い順に（同じなら頼んだ順）
      while (this._inflight < this.concurrency && this._fetchQ.length) {
        let bi = 0;
        for (let i = 1; i < this._fetchQ.length; i++) if (this._fetchQ[i].pri > this._fetchQ[bi].pri) bi = i;
        const r = this._fetchQ.splice(bi, 1)[0];
        if (r.state !== 'fetching') continue;
        this._inflight++;
        let p;
        try { p = Promise.resolve(this.backend.fetch(this.path(r.tx, r.tz), r.pri)); } catch (e) { p = Promise.reject(e); }
        p.then((buf) => {
          this._inflight--;
          if (this._disposed || r.state !== 'fetching') return;
          if (!buf || !(buf.byteLength > 0)) { this._fail(r, new Error('NycTiles: empty ' + r.key)); this._kick(); return; }
          this.stats.fetched++;
          r.buf = buf;
          r.state = 'queued';
          this._decodeQ.push(r);
          this._kick();
        }, (e) => {
          this._inflight--;
          if (this._disposed || r.state !== 'fetching') return;
          this._fail(r, e);
          this._kick();
        });
      }
      this.stats.inflight = this._inflight;
      this.stats.queued = this._fetchQ.length + this._decodeQ.length;
    }
    pump(budgetMs) {
      if (this._disposed || !this._decodeQ.length) return 0;
      if (budgetMs != null && budgetMs <= 0) return 0;
      let bi = 0;
      for (let i = 1; i < this._decodeQ.length; i++) {
        const a = this._decodeQ[i], b = this._decodeQ[bi];
        if (a.pins > b.pins || (a.pins === b.pins && a.pri > b.pri)) bi = i;
      }
      const r = this._decodeQ.splice(bi, 1)[0];
      this.stats.queued = this._fetchQ.length + this._decodeQ.length;
      if (r.state !== 'queued') return 0;
      this._decode(r);
      return 1;
    }
    _decode(r) {
      const t0 = this.now();
      try {
        r.tile = NycData.decodeTile(r.buf);
      } catch (e) {
        this._fail(r, e);
        return;
      }
      const ms = this.now() - t0;
      r.buf = null;
      r.state = 'ready';
      r.err = null;
      r.use = ++this._clock;
      this._live++;
      this.stats.decoded++;
      this.stats.decodeMs += ms;
      if (ms > this.stats.decodeMsMax) this.stats.decodeMsMax = ms;
      this._evict(r);
      this.stats.live = this._live;
      this._notify();
    }
    _fail(r, e) {
      r.state = 'error';
      r.buf = null;
      r.tile = null;
      r.err = e;
      r.retryAt = this.now() + this.retryMs;
      this.stats.errors++;
      for (let i = this._waiters.length - 1; i >= 0; i--) {
        const w = this._waiters[i];
        if (w.keys.indexOf(r.key) >= 0) { this._waiters.splice(i, 1); w.reject(e instanceof Error ? e : new Error(String(e))); }
      }
    }
    _notify() {
      for (let i = this._waiters.length - 1; i >= 0; i--) {
        const w = this._waiters[i];
        let ok = true;
        for (const k of w.keys) { const r = this.recs.get(k); if (!r || r.state !== 'ready') { ok = false; break; } }
        if (ok) { this._waiters.splice(i, 1); w.resolve(); }
      }
    }
    // LRU: デコード済みが cache 枚を超えたら、pin されていない一番古いものから捨てる（keep = 今デコードしたもの）
    _evict(keep) {
      while (this._live > this.cacheSize) {
        let v = null;
        for (const r of this.recs.values()) {
          if (r.state !== 'ready' || r.pins > 0 || r === keep) continue;
          if (this._waitedFor(r.key)) continue;
          if (!v || r.use < v.use) v = r;
        }
        if (!v) break;
        v.tile = null;
        v.state = 'idle';
        v.pri = -Infinity;
        this._live--;
        this.stats.evicted++;
      }
      this.stats.live = this._live;
    }
    _waitedFor(k) {
      for (const w of this._waiters) if (w.keys.indexOf(k) >= 0) return true;
      return false;
    }
    dispose() {
      this._disposed = true;
      for (const w of this._waiters) w.reject(new Error('NycTiles: disposed'));
      this._waiters.length = 0;
      this._fetchQ.length = 0;
      this._decodeQ.length = 0;
      this.recs.clear();
      this._live = 0;
      this.stats.live = 0;
    }
  }
  // v2 の街の開始地点（game.js の _citySpawn と同じ決め方）: spawnPoints('solo', seed) の 1 つ目、無ければ最初のホットゾーンの真ん中
  NycTiles.soloSpawn = (city, seed) => {
    const sp = city.spawnPoints('solo', seed)[0];
    if (sp) return sp;
    const h = (city.hotZones || [])[0];
    return h ? { x: h.x, y: 0, z: h.z, zone: h.id } : { x: (city.minX + city.maxX) / 2, y: 0, z: (city.minZ + city.maxZ) / 2, zone: '' };
  };

  // v2 の街（level.generator 'nyc'）を始める前の用意（main.js の prepareLevelData と tools/smoke-nyc.js）:
  //   core.bin（assets.fetchLazy、何よりも先）→ NycData.decodeCore → NycTiles.fromAssets → 開始地点（soloSpawn、seed）の周り 3 × 3 タイルが
  //   届いてデコードされるまで待つ（デコードは pumpMs ごとに pump。ゲームのループがまだ無いので自分で回す）。
  //   opts: { cache, concurrency（NycTiles）, seed（無ければ乱数）, timeoutMs（既定 60 s。超えたら reject）, onStatus(n, N)（タイルの数）}
  //   → { core, tiles, meta, spawn, seed, ms }。失敗（データが無い・オフライン・時間切れ）は reject（呼ぶ側が midtown に戻す）
  // 前もって作った el の表（levels/nyc/elcache.json = tools/nyc/elcache.js、lazy・約 125 KB gz）を meta.elCache に置く（CityGenNyc は opts.meta か
  //   tiles.meta の elCache を読む = その場の _initEl（PC 約 0.1〜0.3 秒）を省く。答えは同じ）。無い・読めない・鍵が違う → その場で作る（reject しない）
  NycTiles.loadElCache = function (assets, level, meta) {
    const p = (level && level.elCache) || 'levels/nyc/elcache.json';
    if (!meta || meta.elCache || !assets || typeof assets.has !== 'function' || !assets.has(p)) return Promise.resolve(meta ? meta.elCache || null : null);
    const get = typeof assets.fetchLazy === 'function' ? assets.fetchLazy(p, { priority: -1999 }) : assets.getBuffer(p);
    return Promise.resolve(get).then((buf) => {
      if (!buf) return null;
      const o = JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf));
      if (o && o.v === 1 && !meta.elCache) meta.elCache = o;
      return meta.elCache || null;
    }).catch(() => null);
  };

  NycTiles.prepareLevel = function (assets, level, opts) {
    opts = opts || {};
    const ND = MR.NycData, now = nowMs, t0 = now();
    let timer = 0, pumpT = 0, tiles = null;
    const stop = () => { clearTimeout(timer); clearInterval(pumpT); };
    const work = (async () => {
      const meta = assets.get(level.data || 'levels/nyc/nyc.json');
      if (!meta || !meta.bounds) throw new Error('nyc.json がありません');
      const corePath = level.core || 'levels/nyc/core.bin';
      const ecP = NycTiles.loadElCache(assets, level, meta);
      const buf = typeof assets.fetchLazy === 'function' ? await assets.fetchLazy(corePath, { priority: -2000 }) : await assets.getBuffer(corePath);
      if (!buf) throw new Error('core.bin がありません');
      const core = ND.decodeCore(buf);
      await ecP;
      tiles = NycTiles.fromAssets(assets, meta, { cache: opts.cache, concurrency: opts.concurrency });
      const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e6);
      const probe = MR.CityGen.create(level, { core, meta, gameOnly: true });
      const spawn = NycTiles.soloSpawn(probe, seed);
      const c = tiles.tileOf(spawn.x, spawn.z), list = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const tx = c[0] + dx, tz = c[1] + dz;
        if (tx >= 0 && tz >= 0 && tx < tiles.nx && tz < tiles.nz && tiles.hasFile(tx, tz)) list.push([tx, tz]);
      }
      let n = 0;
      if (opts.onStatus) opts.onStatus(0, list.length);
      pumpT = setInterval(() => { const s = now(); while (now() - s < 12 && tiles.pump(Infinity)) { /* 1 つずつ */ } }, 16);
      // タイルを待つ間に乗り物（駐車の車 8〜25 ms）を作っておく（同じ core のゲームの街が使う。最初の chunkFull で作らない）
      try { probe.vehicleSpawns(); } catch (e) { /* ゲームが作る */ }
      await Promise.all(list.map((t) => {
        const x0 = tiles.minX + t[0] * tiles.size, z0 = tiles.minZ + t[1] * tiles.size;
        return tiles.whenReady([x0 + 1, z0 + 1, x0 + tiles.size - 1, z0 + tiles.size - 1]).then(() => { n++; if (opts.onStatus) opts.onStatus(n, list.length); });
      }));
      return { core, tiles, meta, spawn, seed, ms: now() - t0 };
    })();
    const limit = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('街のデータの読み込みが時間切れ')), (opts.timeoutMs > 0 ? opts.timeoutMs : 60000));
    });
    return Promise.race([work, limit]).then((r) => { stop(); return r; }, (e) => { stop(); if (tiles) tiles.dispose(); throw e; });
  };

  NycTiles.tileName = tileName;
  // NycTiles の priority（大きいほど先）→ assets.fetchLazy の priority（小さいほど先）
  NycTiles.lazyPriority = (pri) => (pri ? -pri / 1000 : 0);

  MR.NycTiles = NycTiles;
  if (typeof module !== 'undefined' && module.exports) module.exports = NycTiles;
})(typeof window !== 'undefined' ? window : globalThis);
