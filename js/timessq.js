// タイムズスクエア（MR.TimesSquare。buildings-hq の TS。manhattan = v2 の街だけ。game.js が作る）: 見た目だけ（当たり判定・サーバー・far.bin は変えない）
//   - 広場の外壁の看板・LED の壁・ネオンの縦の看板・下のティッカー: 広場の軸（One Times Square → TKTS のアンカー）から axisDist m 以内で、
//     外向きの法線が軸の方を向く入れない建物の片の辺（chunkFull().prisms。切り口の辺は除く）に、下 bottom m から上へ（決定的: 辺のハッシュ）
//   - One Times Square（gid oneTsGids）: 塔の全部の面に積み重ねた画面
//   - 広場の小さな建物（高さ ≤ kioskMaxH・面積 ≤ kioskMaxArea・軸から kioskAxisDist m 以内）: 窓の茶色い箱を外から少し大きい箱で覆う。
//     recruitGids は軍の募集所（ネオンの星条旗）、ほかはガラスの売店。TKTS（アンカーの rect の中の片）は赤く光る階段と下のブース
//     （当たり判定も同じ段 = citygen_nyc.js _initStairs の city.stairs.tkts。元の片は manhattan.json の stairs で消える。登って上に立てる）
//   全部で 1 つのメッシュ・1 つの ShaderMaterial（= 1 回の描画）。画面の絵は textures/billboards/emissive.jpg のアトラス（4 × 4。無ければ式の LED）。
//   数値は game.json の render.city.timesSquare（無いキーは DEF）。?ts=0 / enabled: false で出さない。
//   作り方: カメラが activate m 以内に来たら広場のチャンクを 1 フレーム 1 つ world.cache から読み（タイルがまだなら次のフレーム）、全部そろったら 1 回で組み立てる。
window.MR = window.MR || {};

(function () {
  const DEF = {
    enabled: true, level: 'manhattan', activate: 1600, axisDist: 60, faceDot: 0.55, minEdge: 5, minTop: 12,
    bottom: 4.6, hMin: 18, hMax: 40, gap: 0.7, segMax: 22, outset: 0.3, adShare: 0.65, tickerShare: 0.45, tickerH: 1.4,
    bladeShare: 0.5, bladeW: 1.5, bladeD: 1.6, bladeHMin: 9, bladeHMax: 16,
    oneTsGids: [30226], oneTsBottom: 9, oneTsTop: 0.93, oneTsBlock: 13,
    kioskMaxH: 11, pylonH: 7, kioskMaxArea: 150, kioskAxisDist: 30, recruitGids: [29844], kioskPad: 0.06,
    tktsSteps: 16, waitFrames: 90, texMax: 512, bright: 1.3, amb: 0.05,
    todBright: { dusk: 1, golden: 0.9, noon: 0.7, haze: 0.85, blue: 1.1, night: 1.15 }
  };
  // 種類（aP.x）: 0 広告（アトラス）1 式の LED 2 ティッカー 3 ネオンの縦の看板 4 ネオンの星条旗 5 黒い金属 6 売店のガラス 7 TKTS の踏み面 8 蹴上げ 9 ブース 10 階段の横
  const K = { AD: 0, LED: 1, TICK: 2, BLADE: 3, FLAG: 4, METAL: 5, GLASS: 6, TREAD: 7, RISER: 8, BOOTH: 9, SIDE: 10 };

  function h32(a, b, c) { let h = 2166136261 ^ (a | 0); h = Math.imul(h ^ (b | 0), 16777619); h = Math.imul(h ^ (c | 0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296; }
  function inRing(r, x, z) {
    let c = false;
    for (let i = 0, n = r.length >> 1, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  const VS = [
    'attribute vec4 aP;',
    'varying vec2 vUv; varying vec4 vP; varying float vDist;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vUv = uv; vP = aP;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  vDist = -mvPosition.z;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');
  const FS = [
    'uniform sampler2D tAtlas; uniform float uHasAtlas, uTime, uBright, uAmb;',
    'varying vec2 vUv; varying vec4 vP; varying float vDist;',
    '#include <fog_pars_fragment>',
    'float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }',
    'float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }',
    'vec3 lin(vec3 c) { return c * c * (c * 0.3 + 0.7); }', // おおよその sRGB → リニア
    'vec3 procLed(vec2 m, float seed, float w, float h) {',
    '  float hb = h11(seed * 7.3) + uTime * 0.015;',
    '  vec3 bg = mix(hue(hb), hue(hb + 0.25), vUv.y) * 0.55;',
    '  bg *= 0.8 + 0.2 * step(0.5, fract((m.x + m.y) * 0.07 - uTime * 0.25));',
    '  float rows = floor(2.0 + h11(seed * 3.1) * 3.0);',
    '  float r = floor(vUv.y * rows), fr = fract(vUv.y * rows);',
    '  float sp = (h11(r + seed * 5.0) - 0.4) * 3.0;',
    '  float cx = floor((m.x - uTime * sp) / (h / rows * 0.55));',
    '  float on = step(0.42, h21(vec2(cx, r + seed * 13.0))) * step(0.22, fr) * step(fr, 0.72) * step(0.35, h11(r * 3.7 + seed));',
    '  vec2 c = vec2((vUv.x - 0.5) * w / h, vUv.y - 0.5);',
    '  float ring = smoothstep(0.03, 0.0, abs(length(c - vec2(sin(seed * 9.0) * 0.4 * w / h, 0.0)) - 0.28 - 0.04 * sin(uTime * 2.0 + seed)));',
    '  return mix(bg, vec3(1.0, 0.97, 0.9), clamp(on * 0.85 + ring, 0.0, 1.0));',
    '}',
    'void main() {',
    // 補間した varying は同じ値でも画素ごとに 1 ulp ずれる → ハッシュ（sin × 43758）で砂嵐になるので種は 1/1024 に丸める
    '  float kind = floor(vP.x + 0.5), seed = floor(vP.y * 1024.0 + 0.5) / 1024.0, w = vP.z, h = vP.w;',
    '  vec2 m = vUv * vec2(w, h);',
    '  vec3 col; bool lit = true;',
    '  if (kind < 0.5 && uHasAtlas > 0.5) {',
    '    float T = 7.0 + 5.0 * h11(seed * 3.1);',
    '    float ph = (uTime + seed * 61.0) / T, k = floor(ph), f = fract(ph);',
    '    float useNext = step(1.0 - vUv.y, smoothstep(0.92, 1.0, f));',
    '    float idx = floor(mod(floor(seed * 16.0) + k + useNext, 16.0));',
    '    float zf = useNext > 0.5 ? 0.0 : f;',
    '    vec2 c = vUv - 0.5; float a = w / h;',
    '    if (a > 1.0) c.y /= a; else c.x *= a;',
    '    c *= 0.94 - 0.06 * zf;',
    '    vec2 cu = clamp(c + 0.5, 0.01, 0.99);',
    '    float colI = mod(idx, 4.0), rowI = floor(idx / 4.0);',
    '    col = lin(texture2D(tAtlas, vec2((colI + cu.x) / 4.0, 1.0 - (rowI + 1.0 - cu.y) / 4.0)).rgb) * 1.1;',
    '  } else if (kind < 1.5) { col = procLed(m, seed, w, h); }',
    '  else if (kind < 2.5) {', // ティッカー
    '    float cw = h * 0.62, x = m.x + uTime * (2.5 + seed * 2.0);',
    '    float ci = floor(x / cw), lx = fract(x / cw) * 6.0, ly = vUv.y * 9.0 - 1.0;',
    '    float d = step(lx, 5.0) * step(0.0, ly) * step(ly, 7.0) * step(0.5, h21(vec2(ci, floor(lx) * 7.0 + floor(ly)))) * step(0.16, h11(ci * 0.37 + seed));',
    '    vec2 g = abs(fract(vec2(lx, ly)) - 0.5); d *= 1.0 - smoothstep(0.25, 0.45, max(g.x, g.y));',
    '    vec3 tc = seed < 0.33 ? vec3(1.0, 0.45, 0.04) : (seed < 0.66 ? vec3(1.0, 0.08, 0.05) : vec3(0.2, 1.0, 0.35));',
    '    col = vec3(0.01) + tc * d * 1.3;',
    '    float edge = step(vUv.y, 0.06) + step(0.94, vUv.y); col = mix(col, vec3(0.04), edge);',
    '  } else if (kind < 3.5) {', // ネオンの縦の看板
    '    vec3 nc = hue(seed + 0.03) * 1.6 + 0.15;',
    '    float d = min(min(vUv.x, 1.0 - vUv.x) * w, min(vUv.y, 1.0 - vUv.y) * h);',
    '    float tube = smoothstep(0.07, 0.0, abs(d - 0.13));',
    '    float cell = w * 1.05, ci = floor((h - m.y) / cell), cy = fract((h - m.y) / cell);',
    '    vec2 q = vec2((vUv.x * w - 0.3) / (w - 0.6) * 3.0, (1.0 - cy) * 6.0 - 0.5);',
    '    vec2 qi = floor(q); vec2 qf = abs(fract(q) - 0.5);',
    '    float on = step(0.0, q.x) * step(q.x, 3.0) * step(0.0, q.y) * step(q.y, 5.0) * step(0.45, h21(qi + ci * 17.0 + seed * 31.0));',
    '    on *= 1.0 - smoothstep(0.28, 0.5, min(qf.x, qf.y));',
    '    float fl = 1.0 - 0.8 * step(0.985, h11(floor(uTime * 9.0) + ci * 7.0 + seed));',
    '    vec3 lc = hue(seed + 0.5) * 1.5 + 0.2;',
    '    col = vec3(0.03) + nc * tube + lc * on * fl;',
    '  } else if (kind < 4.5) {', // ネオンの星条旗
    '    float s = floor(vUv.y * 13.0);',
    '    vec3 c = mod(s, 2.0) < 0.5 ? vec3(1.4, 0.05, 0.04) : vec3(1.25, 1.2, 1.15);',
    '    if (vUv.x < 0.4 && vUv.y > 0.462) {',
    '      vec2 st = vec2(vUv.x / 0.4 * 6.0, (vUv.y - 0.462) / 0.538 * 5.0);',
    '      float star = 1.0 - smoothstep(0.12, 0.22, length(fract(st) - 0.5));',
    '      c = mix(vec3(0.04, 0.12, 0.9), vec3(1.3), star);',
    '    }',
    '    float frame = step(min(min(vUv.x, 1.0 - vUv.x) * w, min(vUv.y, 1.0 - vUv.y) * h), 0.12);',
    '    col = mix(c, vec3(0.03), frame);',
    '  } else if (kind < 5.5) { col = vec3(0.6) * uAmb; lit = false; }',
    '  else if (kind < 6.5) {', // 売店のガラス
    '    float mull = step(fract(m.x / 1.25), 0.06) + step(abs(m.y - 2.4), 0.05);',
    '    float sign = step(h - 0.7, m.y);',
    '    vec3 g = mix(vec3(0.85, 0.62, 0.35), vec3(0.45, 0.4, 0.38), clamp(m.y / 3.0, 0.0, 1.0)) * 0.3;',
    '    col = mix(mix(g, vec3(0.03), clamp(mull, 0.0, 1.0)), hue(seed) * 1.2 + 0.2, sign);',
    '  } else if (kind < 7.5) {', // 踏み面
    '    float j = step(fract(m.x / 1.6), 0.03) + step(vUv.y, 0.12);',
    '    col = mix(vec3(0.3, 0.012, 0.018), vec3(1.6, 0.3, 0.25), clamp(j, 0.0, 1.0));',
    '  } else if (kind < 8.5) { col = mix(vec3(1.7, 0.05, 0.05), vec3(1.9, 0.6, 0.5), step(0.9, vUv.y)); }',
    '  else if (kind < 9.5) {', // ブース（北の面）
    '    float booth = step(m.y, 2.9);',
    '    float mull = step(fract(m.x / 1.5), 0.05);',
    '    vec3 b = mix(vec3(0.9, 0.8, 0.6) * 0.8, vec3(0.03), mull);',
    '    float band = step(2.9, m.y) * step(m.y, 3.6);',
    '    col = mix(vec3(0.7, 0.02, 0.03), b, booth); col = mix(col, vec3(1.4), band);',
    '  } else { col = mix(vec3(0.45, 0.01, 0.02), vec3(1.5, 0.15, 0.1), step(0.93, vUv.y)); }',
    '  if (lit) col *= uBright;',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  class TimesSquare {
    // game の city が v2 で、レベルが cfg.level のときだけ（?ts=0 で消す）
    static enabled(game) {
      const c = TimesSquare.config(game);
      if (!c.enabled || !game.isCity || !game.city || game.city.version !== 2 || game.levelId !== c.level) return false;
      try { if (/[?&]ts=0\b/.test(String((window.location && window.location.search) || ''))) return false; } catch (e) { /* ignore */ }
      const A = TimesSquare.anchors(game);
      return !!(A && A.times_square && A.tkts && A.one_times_square);
    }
    static config(game) {
      const r = (game.config && game.config.render && game.config.render.city) || {};
      const c = Object.assign({}, DEF, r.timesSquare || {});
      c.todBright = Object.assign({}, DEF.todBright, (r.timesSquare || {}).todBright || {});
      return c;
    }
    static anchors(game) {
      const j = game.assets && typeof game.assets.get === 'function' ? game.assets.get('levels/nyc/nyc.json') : null;
      return j && j.anchors ? j.anchors : null;
    }

    constructor(game) {
      this.game = game;
      this.cfg = TimesSquare.config(game);
      const A = TimesSquare.anchors(game);
      this.ts = A.times_square; this.tk = A.tkts; this.ots = A.one_times_square;
      const c = this.cfg, ts = this.ts, city = game.city;
      // 広場の軸: One Times Square → TKTS（両端を少し伸ばす）
      const ax = this.ots.x, az = this.ots.z, bx = this.tk.x, bz = this.tk.z, L = Math.hypot(bx - ax, bz - az) || 1;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      this.axis = [ax - ux * 25, az - uz * 25, bx + ux * 25, bz + uz * 25];
      const r = ts.rect, m = c.axisDist + 10;
      const x0 = Math.min(r[0], this.axis[0], this.axis[2]) - m, x1 = Math.max(r[2], this.axis[0], this.axis[2]) + m;
      const z0 = Math.min(r[1], this.axis[1], this.axis[3]) - m, z1 = Math.max(r[3], this.axis[1], this.axis[3]) + m;
      const a = city.chunkOf(x0, z0), b = city.chunkOf(x1, z1);
      this.todo = [];
      for (let cz = a.cz; cz <= b.cz; cz++) for (let cx = a.cx; cx <= b.cx; cx++) if (cx >= 0 && cz >= 0 && cx < city.ncx && cz < city.ncz) this.todo.push([cx, cz]);
      this.nChunks = this.todo.length;
      this.prisms = []; this._seen = new Set(); this._miss = 0; this._sv = new WeakMap();
      this.mesh = null; this.mat = null; this.tex = null; this.stats = { panels: 0, kiosks: 0, verts: 0, tris: 0, buildMs: 0, chunks: 0, hiddenTris: 0 };
      this.ox = Math.round(ts.x); this.oz = Math.round(ts.z);
      this.U = {
        tAtlas: { value: null }, uHasAtlas: { value: 0 }, uTime: { value: 0 }, uBright: { value: c.bright * (c.todBright[(game.tod && game.tod.id) || 'dusk'] || 1) },
        uAmb: { value: c.amb }
      };
      this._loadAtlas();
    }

    _loadAtlas() {
      const as = this.game.assets;
      if (!as || typeof as.resolve !== 'function' || typeof as.loadTexture !== 'function') return;
      const key = as.resolve('textures/billboards/emissive.jpg');
      if (!key) return;
      let p;
      try { p = Promise.resolve(as.loadTexture(key, { maxSize: this.cfg.texMax })); } catch (e) { return; }
      p.then((t) => {
        if (!t || this._disposed) return;
        this.tex = t;
        this.U.tAtlas.value = t; this.U.uHasAtlas.value = 1;
      }, () => { /* 無ければ式の LED */ });
    }

    // 毎フレーム: 時間と、まだなら広場のチャンクを 1 つ読む（タイルがまだのチャンクは後回し。waitFrames 回読めなければ読めた分で組み立て、
    //   後から届いたら組み立て直す）
    update(dt, camera) {
      this.U.uTime.value = (this.U.uTime.value + dt) % 3600;
      if (this.hide) this._hideTick();
      if (this._disposed || !this.todo.length) return;
      const p = camera ? camera.position : null;
      if (p && Math.hypot(p.x - this.ts.x, p.z - this.ts.z) > this.cfg.activate) return;
      const w = this.game.world, cache = w && w.cache;
      if (!cache) return;
      // streamer がもう作ったチャンク（cache.has）はすぐ読む。無いチャンク（近景のリングの外の広場の端）は genEvery フレームに 1 つだけ作る
      //   （以前は毎フレーム作ってタイルも頼み、予算の外の重い仕事が続いた = 検証）。組み立ては全部そろったときに 1 回
      const T = this.game.city.tiles;
      if (!this._asked && T && typeof T.whenReady === 'function') { // 広場のタイルを先に頼む（ダウンロードとデコードだけ。来なくても困らない）
        this._asked = true;
        const r = this.ts.rect, m = this.cfg.axisDist;
        try { Promise.resolve(T.whenReady([r[0] - m, r[1] - m, r[2] + m, r[3] + m])).catch(() => {}); } catch (e) { /* ignore */ }
      }
      const [cx, cz] = this.todo[0];
      let d = null;
      if (cache.has(cx, cz)) d = cache.full(cx, cz);
      else if ((this._gen = (this._gen || 0) - 1) <= 0) { this._gen = p && Math.hypot(p.x - this.ts.x, p.z - this.ts.z) < (this.cfg.nearGen || 350) ? 1 : (this.cfg.genEvery || 6); d = cache.full(cx, cz); } // 無いチャンクは genEvery フレームに 1 つ（広場から nearGen m の中 = 見えている所では毎フレーム 1 つ）
      if (!d) { // タイルがまだ: 次のフレームにほかのチャンク
        this.todo.push(this.todo.shift());
        if (++this._miss > this.cfg.waitFrames && this.stats.chunks && !this.mesh) this._build();
        return;
      }
      this.todo.shift(); this._miss = 0;
      this._take(d);
      this.stats.chunks++;
      if (!this.todo.length) this._build(); // 組み立ては全部そろったときに 1 回（途中は waitFrames の部分の 1 回だけ）
    }

    _take(d) {
      for (const p of d.prisms || []) {
        if (!p || p.cat !== 'exterior' || p.top || !p.ring || p.ring.length < 6) continue;
        const key = p.gid + ':' + p.piece + ':' + p.ring[0] + ':' + p.ring[1];
        if (this._seen.has(key)) continue;
        this._seen.add(key);
        this.prisms.push({ ring: Array.from(p.ring), clip: p.clip ? Array.from(p.clip) : null, y0: p.y0, y1: p.y1, gid: p.gid >>> 0, piece: p.piece >>> 0 });
      }
    }

    _axisDist(x, z) {
      const A = this.axis, dx = A[2] - A[0], dz = A[3] - A[1], L2 = dx * dx + dz * dz;
      let t = ((x - A[0]) * dx + (z - A[1]) * dz) / L2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const px = A[0] + dx * t, pz = A[1] + dz * t;
      return { d: Math.hypot(x - px, z - pz), px, pz };
    }
    _inside(x, z, y, self) {
      for (const q of this.prisms) {
        if (q === self || y < q.y0 || y > q.y1) continue;
        const b = q.bb;
        if (b && (x < b[0] || x > b[2] || z < b[1] || z > b[3])) continue;
        if (inRing(q.ring, x, z)) return true;
      }
      return false;
    }

    _build() {
      const t0 = MR.CityWorld && MR.CityWorld.now ? MR.CityWorld.now() : Date.now();
      const c = this.cfg, P = [], UV = [], AP = [], IDX = [], ox = this.ox, oz = this.oz;
      const quad = (ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx, dy, dz, kind, seed, w, h) => {
        const v = P.length / 3;
        P.push(ax - ox, ay, az - oz, bx - ox, by, bz - oz, cx2 - ox, cy2, cz2 - oz, dx - ox, dy, dz - oz);
        UV.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let i = 0; i < 4; i++) AP.push(kind, seed, w, h);
        IDX.push(v, v + 1, v + 2, v, v + 2, v + 3);
      };
      // 縦の板: 底辺 (x0, z0) → (x1, z1)、y0..y1、法線は外向き (nx, nz)（左から右へ見て）
      const wall = (x0, z0, x1, z1, y0, y1, kind, seed) => quad(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0, kind, seed, Math.hypot(x1 - x0, z1 - z0), y1 - y0);
      const kiosks = new Map(), tkGids = new Set(), otsGids = new Set(c.oneTsGids), recruit = new Set(c.recruitGids);
      const tr = this.tk.rect;
      for (const p of this.prisms) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        const r = p.ring;
        for (let i = 0; i < r.length; i += 2) { if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i]; if (r[i + 1] < z0) z0 = r[i + 1]; if (r[i + 1] > z1) z1 = r[i + 1]; }
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        p.bb = [x0, z0, x1, z1]; p.kiosk = false;
        if (p.y1 <= c.kioskMaxH && p.y0 <= c.kioskMaxH) {
          const isTk = mx >= tr[0] && mx <= tr[2] && mz >= tr[1] && mz <= tr[3];
          if (isTk || ((x1 - x0) * (z1 - z0) <= c.kioskMaxArea && this._axisDist(mx, mz).d <= c.kioskAxisDist)) {
            if (isTk) tkGids.add(p.gid);
            let k = kiosks.get(p.gid);
            if (!k) kiosks.set(p.gid, (k = { gid: p.gid, pts: [], y0: 1e9, y1: -1e9, tk: isTk }));
            for (let i = 0; i < r.length; i++) k.pts.push(r[i]);
            if (p.y0 < k.y0) k.y0 = p.y0; if (p.y1 > k.y1) k.y1 = p.y1;
            p.kiosk = true;
          }
        }
      }
      // 大きな片もある gid（建物の一部の小さな片）は売店にしない
      const big = new Set();
      for (const p of this.prisms) if (!p.kiosk) big.add(p.gid);
      for (const g of big) if (kiosks.has(g) && !kiosks.get(g).tk) kiosks.delete(g);
      for (const p of this.prisms) if (p.kiosk && !kiosks.has(p.gid)) p.kiosk = false;
      // ---- 外壁の看板 ----
      let panels = 0;
      for (const p of this.prisms) {
        if (p.kiosk || p.y1 < c.minTop || p.y0 > c.bottom) continue;
        const ots = otsGids.has(p.gid);
        const r = p.ring, n = r.length >> 1;
        let area = 0;
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
        const sg = area > 0 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          if (p.clip && (p.clip[i >> 3] >> (i & 7)) & 1) continue;
          const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
          const L = Math.hypot(bx - ax, bz - az);
          if (L < c.minEdge) continue;
          const nx = sg * (bz - az) / L, nz = -sg * (bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const ad = this._axisDist(mx, mz);
          if (!ots) {
            if (ad.d > c.axisDist) continue;
            const tx = ad.px - mx, tz = ad.pz - mz, tl = Math.hypot(tx, tz) || 1;
            if ((nx * tx + nz * tz) / tl < c.faceDot) continue;
          }
          if (this._inside(mx + nx * 1.2, mz + nz * 1.2, c.bottom + 2, p)) continue; // 隣の片に接する辺
          const hs = h32(p.gid, p.piece, i), o = c.outset;
          const fx = (t) => ax + (bx - ax) * t + nx * o, fz = (t) => az + (bz - az) * t + nz * o;
          let yb = ots ? c.oneTsBottom : c.bottom;
          const top = ots ? p.y1 * c.oneTsTop : Math.min(p.y1 - 1.2, c.bottom + c.hMin + (c.hMax - c.hMin) * h32(p.gid, i, 7));
          if (top - yb < 3) continue;
          const m0 = Math.min(0.6, L * 0.05);
          // ティッカー（下の帯）
          if (!ots && h32(p.gid, i, 11) < c.tickerShare) {
            wall(fx(m0 / L), fz(m0 / L), fx(1 - m0 / L), fz(1 - m0 / L), yb, yb + c.tickerH, K.TICK, h32(p.gid, i, 12));
            yb += c.tickerH + c.gap; panels++;
          }
          // 縦の段: OTS は oneTsBlock m ごと、ほかは 1〜3 段
          const H = top - yb;
          const rows = ots ? Math.max(1, Math.round(H / c.oneTsBlock)) : 1 + Math.floor(h32(p.gid, i, 13) * Math.min(3, Math.max(1, H / 9)));
          const cols = Math.max(1, Math.ceil((L - 2 * m0) / c.segMax));
          const rh = (H - c.gap * (rows - 1)) / rows;
          for (let ri = 0; ri < rows; ri++) {
            const y0 = yb + ri * (rh + c.gap), y1 = y0 + rh;
            for (let ci = 0; ci < cols; ci++) {
              const cw = (L - 2 * m0 - c.gap * (cols - 1)) / cols;
              const t0 = (m0 + ci * (cw + c.gap)) / L, t1 = t0 + cw / L;
              const s = h32(p.gid * 31 + ri, i * 7 + ci, 21);
              wall(fx(t0), fz(t0), fx(t1), fz(t1), y0, y1, s < c.adShare ? K.AD : K.LED, h32(p.piece, ri * 13 + ci, i));
              panels++;
            }
          }
          // ネオンの縦の看板（辺の片端から垂直に出す）
          if (!ots && L >= 10 && hs < c.bladeShare) {
            const t = hs < c.bladeShare / 2 ? (m0 + 1.2) / L : 1 - (m0 + 1.2) / L;
            const bx0 = ax + (bx - ax) * t + nx * (o + 0.05), bz0 = az + (bz - az) * t + nz * (o + 0.05);
            const bx1 = bx0 + nx * c.bladeD, bz1 = bz0 + nz * c.bladeD;
            const by0 = c.bottom + c.tickerH + 1.5, by1 = Math.min(p.y1 - 1, by0 + c.bladeHMin + (c.bladeHMax - c.bladeHMin) * h32(p.gid, i, 31));
            if (by1 - by0 > 3) {
              const sd = h32(p.gid, i, 32);
              const ex = (bx - ax) / L * 0.12, ez = (bz - az) / L * 0.12;
              wall(bx0 - ex, bz0 - ez, bx1 - ex, bz1 - ez, by0, by1, K.BLADE, sd);
              wall(bx1 + ex, bz1 + ez, bx0 + ex, bz0 + ez, by0, by1, K.BLADE, sd);
              wall(bx1 - ex, bz1 - ez, bx1 + ex, bz1 + ez, by0, by1, K.METAL, 0);
              panels++;
            }
          }
        }
      }
      // ---- 広場の小さな建物 ----
      let nk = 0;
      for (const k of kiosks.values()) {
        const pts = k.pts;
        // 一番長い辺の向き = 箱の軸
        let best = 0, ux = 1, uz = 0;
        for (let i = 0; i + 3 < pts.length; i += 2) { const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1], l = dx * dx + dz * dz; if (l > best) { best = l; ux = dx; uz = dz; } }
        const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        if (k.tk) { // TKTS: 階段が上がる向き = One Times Square から離れる向きに近い軸
          const dx = this.tk.x - this.ots.x, dz = this.tk.z - this.ots.z;
          if (Math.abs(dx * ux + dz * uz) < Math.abs(-dx * uz + dz * ux)) { const t = ux; ux = -uz; uz = t; }
          if (dx * ux + dz * uz < 0) { ux = -ux; uz = -uz; }
        }
        const vx = -uz, vz = ux;
        let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
        for (let i = 0; i < pts.length; i += 2) { const a = pts[i] * ux + pts[i + 1] * uz, b = pts[i] * vx + pts[i + 1] * vz; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
        const pd = c.kioskPad; a0 -= pd; a1 += pd; b0 -= pd; b1 += pd;
        const yb = Math.max(0, k.y0) - 0.02, yt = k.y1 + pd;
        const X = (a, b) => a * ux + b * vx, Z = (a, b) => a * uz + b * vz;
        const sd = h32(k.gid, 1, 2);
        if (k.tk) { this._tkts(quad, wall, X, Z, a0, a1, b0, b1, yb, yt); nk++; continue; }
        const rec = recruit.has(k.gid);
        const pylon = !rec && yt - yb > c.pylonH; // 背の高い細い箱は四面の画面の柱
        const sideK = rec ? K.FLAG : (pylon ? K.AD : K.GLASS), endK = sideK;
        // 4 つの壁（外向き: 反時計回りに見て）と屋根
        wall(X(a0, b0), Z(a0, b0), X(a1, b0), Z(a1, b0), yb, yt, sideK, sd);
        wall(X(a1, b1), Z(a1, b1), X(a0, b1), Z(a0, b1), yb, yt, sideK, sd);
        wall(X(a1, b0), Z(a1, b0), X(a1, b1), Z(a1, b1), yb, yt, endK, sd);
        wall(X(a0, b1), Z(a0, b1), X(a0, b0), Z(a0, b0), yb, yt, endK, sd);
        quad(X(a0, b0), yt, Z(a0, b0), X(a0, b1), yt, Z(a0, b1), X(a1, b1), yt, Z(a1, b1), X(a1, b0), yt, Z(a1, b0), K.METAL, 0, a1 - a0, b1 - b0);
        nk++;
      }
      // TKTS: 当たり判定と同じ段（citygen_nyc.js _initStairs の city.stairs.tkts。片は suppress で消えている）
      const stp = this.game.city && this.game.city.stairs && this.game.city.stairs.tkts;
      if (stp && stp.length) { this._tktsSteps(quad, wall, stp, c.kioskPad); nk++; }
      // 向き: wall の法線が外向きでなかった面は裏から見えないので両面で描く（材質を DoubleSide に）
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      geo.setAttribute('aP', new THREE.Float32BufferAttribute(AP, 4));
      geo.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(IDX, 1) : new THREE.Uint16BufferAttribute(IDX, 1));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      if (this.mesh) { this.game.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; this.stats.rebuilds = (this.stats.rebuilds || 0) + 1; }
      if (!this.mat) this.mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), this.U), vertexShader: VS, fragmentShader: FS,
        fog: true, side: THREE.DoubleSide, toneMapped: false
      });
      this.mat.name = 'timesSquare';
      this.mesh = new THREE.Mesh(geo, this.mat);
      this.mesh.name = 'timesSquare'; this.mesh.position.set(ox, 0, oz); this.mesh.updateMatrix(); this.mesh.matrixAutoUpdate = false;
      this.mesh.castShadow = false; this.mesh.receiveShadow = false;
      this.game.scene.add(this.mesh);
      const nh = new Set(kiosks.keys());
      if (this.hide) this._unhide(nh); // 組み立て直し: 前の組で縮めたが今の組に無い片の三角形を戻す（戻さないと穴になる）
      this.hide = nh; this._hidden = new WeakSet();
      this.stats.panels = panels; this.stats.kiosks = nk; this.stats.verts = P.length / 3; this.stats.tris = IDX.length / 3;
      this.stats.buildMs = +(((MR.CityWorld && MR.CityWorld.now ? MR.CityWorld.now() : Date.now()) - t0)).toFixed(2);
    }

    // 広場の小さな建物の元の片（窓の茶色い箱）を近景のメッシュで描かない: 出来上がった近景のチャンク（作り直しも）ごとに 1 回、
    //   userData.pieces（片の index の範囲）の gid が hide にある三角形を (a, a, a) に縮める（当たり判定はそのまま）
    _hideTick() {
      const S = this.game.world && this.game.world.streamer;
      if (!S || !S.full) return;
      for (const k of this._keys || (this._keys = this._chunkKeys())) {
        const rec = S.full.get(k);
        if (!rec || rec.state !== 'built' || !rec.out || this._hidden.has(rec.out)) continue;
        this._hidden.add(rec.out);
        rec.out.root.traverse((o) => {
          const g = o.geometry, pc = g && g.userData && g.userData.pieces;
          if (!pc || !g.index) return;
          const ia = g.index.array;
          let hit = false;
          let sv = this._sv.get(g);
          for (let i = 0; i < pc.length; i += 4) {
            if (!this.hide.has(pc[i + 2])) continue;
            if (!sv) this._sv.set(g, (sv = new Map())); // 片の最初の index → [gid, 縮める前の index]（戻す用）
            if (sv.has(pc[i])) continue;
            const t0 = pc[i], e = pc[i] + pc[i + 1];
            sv.set(t0, [pc[i + 2], ia.slice(t0, e)]);
            for (let t = t0; t + 2 < e; t += 3) { ia[t + 1] = ia[t]; ia[t + 2] = ia[t]; this.stats.hiddenTris++; }
            hit = true;
          }
          if (hit) g.index.needsUpdate = true;
        });
      }
    }
    // 今読んである近景のチャンクで、nh に無い gid の縮めた三角形を元に戻す（捨てたチャンクの形は作り直すときに元のまま）
    _unhide(nh) {
      const S = this.game.world && this.game.world.streamer;
      if (!S || !S.full) return;
      for (const k of this._keys || (this._keys = this._chunkKeys())) {
        const rec = S.full.get(k);
        if (!rec || !rec.out || !rec.out.root) continue;
        rec.out.root.traverse((o) => {
          const g = o.geometry, sv = g && this._sv.get(g);
          if (!sv || !g.index) return;
          let hit = false;
          for (const [t0, v] of sv) {
            if (nh.has(v[0])) continue;
            g.index.array.set(v[1], t0); sv.delete(t0); hit = true;
            this.stats.hiddenTris -= v[1].length / 3;
          }
          if (hit) g.index.needsUpdate = true;
        });
      }
    }
    _chunkKeys() {
      const out = [], c = this.game.city, r = this.tk.rect, A = this.axis, m = this.cfg.kioskAxisDist + 10;
      const a = c.chunkOf(Math.min(A[0], A[2], r[0]) - m, Math.min(A[1], A[3], r[1]) - m), b = c.chunkOf(Math.max(A[0], A[2], r[2]) + m, Math.max(A[1], A[3], r[3]) + m);
      for (let cz = a.cz; cz <= b.cz; cz++) for (let cx = a.cx; cx <= b.cx; cx++) out.push(c.chunkKey ? c.chunkKey(cx, cz) : cx + '_' + cz);
      return out;
    }

    // TKTS の赤い階段（当たり判定の段の箱 { x0, z0, x1, z1, y0, y1 } を下から。pd だけ外へ出して箱の面と重ねない）
    _tktsSteps(quad, wall, S, pd) {
      const n = S.length, cxz = (r) => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
      const f = cxz(S[0]), l = cxz(S[n - 1]), alongX = Math.abs(l[0] - f[0]) > Math.abs(l[1] - f[1]), up = (alongX ? l[0] - f[0] : l[1] - f[1]) > 0 ? 1 : -1;
      // 局所: a = 上がる向き、b = 幅（X(a, b), Z(a, b) で世界へ）
      const X = (a, b) => (alongX ? a * up : b), Z = (a, b) => (alongX ? b : a * up);
      const yb = S[0].y0 - 0.02;
      let aTop = 0, bTop0 = 0, bTop1 = 0, yt = 0;
      for (let i = 0; i < n; i++) {
        const r = S[i];
        const lo = alongX ? (up > 0 ? r.x0 : -r.x1) : (up > 0 ? r.z0 : -r.z1), hi = alongX ? (up > 0 ? r.x1 : -r.x0) : (up > 0 ? r.z1 : -r.z0);
        const b0 = (alongX ? r.z0 : r.x0) - pd, b1 = (alongX ? r.z1 : r.x1) + pd, s0 = lo - (i === 0 ? pd : 0), s1 = hi + (i === n - 1 ? pd : 0);
        const y0 = i ? S[i - 1].y1 + pd : yb, y1 = r.y1 + pd, W = b1 - b0, d = s1 - s0;
        const fl = up < 0 !== alongX; // 局所の向きが世界で裏返るとき（a か b の片方だけ符号が変わる）は面の巻きを逆に
        const w = (ax, az, bx, bz, ya, yb2, k) => (fl ? wall(bx, bz, ax, az, ya, yb2, k, 0) : wall(ax, az, bx, bz, ya, yb2, k, 0));
        w(X(s0, b1), Z(s0, b1), X(s0, b0), Z(s0, b0), y0, y1, K.RISER); // 蹴上げ（前向き）
        if (fl) quad(X(s0, b0), y1, Z(s0, b0), X(s1, b0), y1, Z(s1, b0), X(s1, b1), y1, Z(s1, b1), X(s0, b1), y1, Z(s0, b1), K.TREAD, 0, W, d);
        else quad(X(s0, b0), y1, Z(s0, b0), X(s0, b1), y1, Z(s0, b1), X(s1, b1), y1, Z(s1, b1), X(s1, b0), y1, Z(s1, b0), K.TREAD, 0, W, d);
        w(X(s0, b0), Z(s0, b0), X(s1, b0), Z(s1, b0), yb, y1, K.SIDE);
        w(X(s1, b1), Z(s1, b1), X(s0, b1), Z(s0, b1), yb, y1, K.SIDE);
        if (i === n - 1) { aTop = s1; bTop0 = b0; bTop1 = b1; yt = y1; }
      }
      const w = (ax, az, bx, bz, ya, yb2, k) => ((up < 0 !== alongX) ? wall(bx, bz, ax, az, ya, yb2, k, 0) : wall(ax, az, bx, bz, ya, yb2, k, 0));
      w(X(aTop, bTop0), Z(aTop, bTop0), X(aTop, bTop1), Z(aTop, bTop1), yb, yt, K.BOOTH);
    }
    // TKTS の赤い階段（a = 上がる向き、b = 幅）。前（a0）が低く、奥（a1）が高い。奥の面はブース
    _tkts(quad, wall, X, Z, a0, a1, b0, b1, yb, yt) {
      const N = this.cfg.tktsSteps, d = (a1 - a0) / N, H = yt - yb, W = b1 - b0;
      for (let i = 0; i < N; i++) {
        const s0 = a0 + i * d, s1 = s0 + d, y0 = yb + H * i / N, y1 = yb + H * (i + 1) / N;
        wall(X(s0, b1), Z(s0, b1), X(s0, b0), Z(s0, b0), y0, y1, K.RISER, 0); // 蹴上げ（前向き）
        quad(X(s0, b0), y1, Z(s0, b0), X(s0, b1), y1, Z(s0, b1), X(s1, b1), y1, Z(s1, b1), X(s1, b0), y1, Z(s1, b0), K.TREAD, 0, W, d);
        wall(X(s0, b0), Z(s0, b0), X(s1, b0), Z(s1, b0), yb, y1, K.SIDE, 0);
        wall(X(s1, b1), Z(s1, b1), X(s0, b1), Z(s0, b1), yb, y1, K.SIDE, 0);
      }
      wall(X(a1, b0), Z(a1, b0), X(a1, b1), Z(a1, b1), yb, yt, K.BOOTH, 0);
    }

    dispose() {
      this._disposed = true;
      if (this.mesh) { this.game.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
      if (this.mat) { this.mat.dispose(); this.mat = null; }
      this.U.tAtlas.value = null; this.tex = null; // テクスチャは AssetManager のキャッシュの物（捨てない）
      this.prisms = null; this._seen = null; this.todo = [];
    }
  }
  TimesSquare.DEF = DEF;
  MR.TimesSquare = TimesSquare;
})();
