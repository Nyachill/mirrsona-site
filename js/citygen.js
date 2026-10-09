// 「ミッドタウン」6 km 四方の街を、ワールドプラン（assets/levels/midtown.json）から決定的に作る。THREE にも DOM にも依存しない。
//   ブラウザ: <script> で読む → MR.CityGen      Node / Worker: require('../www/js/citygen.js') → CityGen（globalThis.MR.CityGen にも入る）
//
// ■ 座標: 単位 m、+Y 上、+X 東、−Z 北。原点 = パーク街 × 42 丁目の交差点の中心。陸の地面 y = 0（暗黙。箱は無い）、
//   川の水面 y = waterY（−2）、川底 bedY（−14）。歩道・街区は高さ curbH（0.15）の箱（街区ごと、チャンクで切る）。
//   範囲 bounds（x −2900..3100, z −3000..3000）。チャンク = chunkSize（128 m）四方、47 × 47 個。
//   cx = floor((x − minX) / 128), cz = floor((z − minZ) / 128)。キーは "cx_cz"。
//
// ■ ワールドプラン（midtown.json）の構造（生成の数値はすべてここ。コードには書かない）
//   seed, bounds, chunkSize, superChunk(512), maxOverhang(64), waterY, bedY, sky（arena01 と同じ）,
//   engine     { stepUp, headroom, agentRadius, hashCell, graphCell, maxExpand, parkCell }   … Nav3D と公園セルの既定値
//   grid       マンハッタンの通り: n 丁目の中心線 z = (streetZ0 − n) × streetSpacing（n = streetMin..streetMax）、
//              幅 streetWidth、wide の丁目は wideWidth。sidewalk = 歩道幅、curbH = 縁石（街区の箱）の高さ
//   avenues    [{ id, x, w, z0?, z1?, median? }]  南北の大通り（x = 中心線、z0..z1 の間だけある）
//   fdr        東岸の道路 { w, offset }（岸から offset 内側に幅 w）
//   roadGaps   [{ id, rect:[x0,z0,x1,z1] }]   この範囲は車道を作らない（GCT・公園・広場が通りを塞ぐ所）。公園の外なら舗装（縁石の高さ）で埋める
//   broadway   { w, pts:[[x,z]…], plazaZ:[[z0,z1]…] }  斜めの大通り。plazaZ の区間は歩行者天国（車道を切らず歩道のまま）
//   shores     { west, east, queens: [[z, x]…] }  岸線（z の折れ線で x を補間）。west より西・east と queens の間が水
//   islands    [{ id, x0, x1, zTip, z1, tipR }]   ルーズベルト島（南端は半径 tipR の丸）。roosevelt: 島の道路
//   queens     クイーンズ側の格子（avenues, 通り z = streetZ0 + k × streetSpacing, wide）
//   piers      hudson（丁目 from..to の桟橋、skip は無し）+ extra（ヘリポート桟橋・島への橋）。甲板の上面 y = 0
//   materials  storey（材質ごとの 1 階の高さ = テクスチャ 1 枚の縦）, shell（入れる建物の外壁）, floors, roof, interior, stair …
//   building   入れる建物の寸法（壁厚・スラブ厚・窓・扉・パラペット・階段の最大勾配 maxSlope（tan）…）
//   districts  [{ id, rule, rect }]  最初に当たったもの。rules[rule] = 区画の分け方・建物の種類の割合・高さ・材質・入れる割合 …
//              { id, rect, cap: { x, z, dx, dz, y, slope, clear, latFree, latSlope } }（rule なし）= 高さの上限だけ（区画・種類・材質はその場所の
//              元の district のまま。階数だけ減らす）: 点 (x, z) から向き (dx, dz) へ d m の所で y + slope × d − clear、中心線から
//              latFree m より横はさらに (横 − latFree) × latSlope 高くてよい（空母の着艦の進入路。1 階も入らなければ駐車場）
//   parks      [{ id, kind: central|square|waterfront, rect, … }]  lakes: [{ id, y(水面), bed, poly }]
//   landmarks  [{ id, kind, claim:[x0,z0,x1,z1]|null, params }]   claim の中には普通の建物を建てない
//   heliports  [{ id, label, x, y, z, r, access: walk|climb|heli, spawn?: [x, z, yaw]（ヘリを置く所がパッドと違うとき）}]   hotZones [{ id, label(日本語), x, z, r, loot }]
//   vehicles   置き方（ホットゾーンの近くは街区あたり nearHot、ほかは elsewhere）  spawns  loot { tables, … }  rings（安全地帯）
//
// ■ 出力（すべて読み取り専用として扱う。数値は 1 cm に丸める）
//   box    { x, y, z, w, h, d, mat, cat, f, mt? }   x/z = 中心、y = 下端、h = 高さ。mt = 上面の材質（屋上）。軸平行のみ。
//          cat: exterior | interior | floor | roof | road | sidewalk | prop | landmark | pier
//          f（ビット）: 1 NOCOL（見た目だけ）2 NOLOS（視線・弾を通す: ガラス柵・トラス）4 WALK（上面に立てる）
//                       8 LADDER（梯子を掛けられる壁）16 SHELL（入れる建物の外壁 = 開口がある。chunkCoarse では省く）
//   ramp   { x, z, w, d, y0, y1, axis:'x'|'z', dir:+1|-1, t, mat, cat, f }  矩形の上面が axis·dir の向きに y0→y1 へ直線で上がる
//          （y0 ≤ y1）。t = 厚み（上面から下へ）。階段（表示は段）・高架・橋の取り付け道路・空母のタラップ。
//   ladder { x, z, y0, y1, nx, nz }  壁の外面の登り線と外向き法線
//   prop   { type, x, y, z, rot }  rot = Y 軸回転（rad。プロップの +Z が (sin rot, cos rot) を向く）。当たり判定は boxes 側（cat prop）
//   loot   { id: "cx_cz_n", x, y, z, table }   vehicle { id, type, x, y, z, yaw(度。levels/*.json と同じ) }
//   decal  { type, x, z, w, d, rot, … }  crosswalk / lanes / manhole / patch / plaza / billboard（y, h, nx, nz, idx 付き）/ track
//   road   { kind, pts:[[x,z]×4], mat }  アスファルトの四角形（y = 0）。ground { x0, z0, x1, z1, mat, holes? }（芝・砂利など y = 0 の面。
//          holes = その矩形から抜く湖の id。湖の多角形は water の { type: 'lake' } にある）
//   water  { type: 'seawall', x0, z0, x1, z1 } / { type: 'lake', id, y, poly }   landmark { node, glb, x, y, z, yaw(rad) }
//   building { id, kind, x0, z0, x1, z1, floors, door:[x,y,z], roof:[x,y,z] }  入れる建物とロビー（AI のスポーン・テスト用）
//
// ■ チャンクの持ち主: 区画（lot、≤ 60 m）は中心があるチャンクがまるごと持つ。ランドマーク・公園の枠・桟橋などの静的なものは
//   部品ごとに部品の中心で振り分ける（長い部品は 120 m 以下に分割）。街区の歩道と車道はチャンクの境で切る。
//   → 中身はチャンクの外へ最大 maxOverhang（64 m）はみ出す。使う側は周りのチャンクも読む（3 × 3 で中央は完全）。
//
// ■ API
//   new CityGen(plan)                    区画計画を作る（Node で約 100 ms）
//   chunkFull(cx, cz)                    { cx, cz, key, boxes, ramps, ladders, props, loot, vehicles, decals, roads, ground, water, landmarks, buildings }
//   lootSpawns(cx, cz)                   chunkFull().loot と同じもの（形状を作らない。速い）
//   chunkCoarse(cx, cz)                  サーバー用: 固体の塊だけ { boxes, ramps }。含む: 入れない建物の段（tier）・入れる建物の床スラブと屋根
//                                        （開口付き）・ランドマーク／橋／桟橋／高架の大きな箱と道路のスロープ。含まない: 入れる建物の壁（SHELL）・
//                                        室内の壁・階段・小物・歩道・パラペット・柵（NOCOL も）。支えの高さは supportHeightAt を使う。
//   chunkLod(cx, cz)                     遠景用: 建物の外形（1〜3 箱）・屋根・歩道・桟橋・ランドマークの大きな箱 { boxes, ramps }
//   skyline()                            { size, groups:[{ key, sx, sz, boxes }] } 全建物（≤ 3 箱）+ ランドマークの外形。512 m ごと
//   minimap()                            ベクタ: land / water / lakes / roads / parks / piers / bridges / labels / helipads / hotZones
//   supportHeightAt(x, z)                その点で一番高い「立てる面」（屋上・橋・甲板）の上限。安い。サーバーのもっともらしさ判定用
//   isWater(x, z) / groundY(x, z) / waterLevelAt(x, z) / groundAt(x, z) / chunkOf(x, z) / chunkKey(cx, cz)
//   hotZones / helipads / spawnPoints(mode, seed) / vehicleSpawns() / landmarkPlacements()
//   carrierOps                           空母の戦闘機の駐機場所・カタパルト・着艦（世界の座標。_carrierOps の説明）。vehicleSpawns の最後に
//                                        戦闘機 j_1..j_4（type 'jet'、plan.vehicles.jets のとき）
(function (root) {
  const MR = root.MR || (root.MR = {});

  // ---------- 小道具 ----------
  const F = { NOCOL: 1, NOLOS: 2, WALK: 4, LADDER: 8, SHELL: 16 };
  const r2 = (v) => Math.round(v * 100) / 100;

  // 32 bit の混ぜ合わせ（murmur3 の fmix）。生成の順番ではなく ID からシードを作るのに使う
  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16; return h >>> 0;
  }
  function hash(a, b, c, d) {
    let h = fmix((a | 0) ^ 0x9e3779b9);
    h = fmix(h ^ (b | 0));
    h = fmix((h + 0x7f4a7c15) ^ (c | 0));
    h = fmix(h ^ Math.imul(d | 0, 0x27d4eb2d));
    return h;
  }
  // mulberry32（nav.js と同じ）。rnd() が [0,1)、rnd.range(lo, hi) / rnd.int(lo, hi)（両端含む）/ rnd.pick(arr)
  function rRange(lo, hi) { return lo + (hi - lo) * this(); }
  function rInt(lo, hi) { return lo + Math.floor(this() * (hi - lo + 1)); }
  function rPick(arr) { return arr[Math.floor(this() * arr.length)]; }
  function rng(seed) {
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = rRange; f.int = rInt; f.pick = rPick;
    f.reset = function (sd) { a = sd >>> 0; return f; };
    return f;
  }
  const mixCache = new WeakMap();
  function weighted(rnd, pairs) { // [[value, weight]…] か { value: weight }
    let list = pairs;
    if (!Array.isArray(pairs)) { list = mixCache.get(pairs); if (!list) { list = Object.keys(pairs).map((k) => [k, pairs[k]]); mixCache.set(pairs, list); } }
    let sum = 0;
    for (const p of list) sum += p[1];
    let t = rnd() * sum;
    for (const p of list) { t -= p[1]; if (t <= 0) return p[0]; }
    return list[list.length - 1][0];
  }
  function strHash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; }

  // 折れ線 [[k, v]…]（k 昇順に並べ替え済み）を k で補間
  function interp(pts, k) {
    if (k <= pts[0][0]) return pts[0][1];
    const n = pts.length;
    if (k >= pts[n - 1][0]) return pts[n - 1][1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= k) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi];
    return a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]);
  }
  // 区間 [k0,k1] での最小・最大（頂点も見る）
  function interpRange(pts, k0, k1) {
    let lo = Math.min(interp(pts, k0), interp(pts, k1)), hi = Math.max(interp(pts, k0), interp(pts, k1));
    for (const p of pts) if (p[0] > k0 && p[0] < k1) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    return [lo, hi];
  }
  function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  function polyBox(poly) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return [x0, z0, x1, z1];
  }
  function distToPoly(x, z, poly) {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
      let t = L > 0 ? ((x - ax) * dx + (z - az) * dz) / L : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  }

  // 矩形 [x0,z0,x1,z1]
  const rOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const rInside = (x, z, r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
  const rInter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  const rValid = (r, m) => r[2] - r[0] > (m || 0.01) && r[3] - r[1] > (m || 0.01);
  // 矩形 r から穴 holes を引いた残りを矩形の列で返す（穴の辺で格子に切り、横に連続するものはつなぐ）
  function rectMinus(r, holes) {
    const hs = [];
    for (const h of holes) { const c = rInter(r, h); if (rValid(c)) hs.push(c); }
    if (!hs.length) return [r.slice()];
    const xs = [r[0], r[2]], zs = [r[1], r[3]];
    for (const h of hs) { xs.push(h[0], h[2]); zs.push(h[1], h[3]); }
    const ux = Array.from(new Set(xs)).sort((a, b) => a - b), uz = Array.from(new Set(zs)).sort((a, b) => a - b);
    const out = [];
    for (let j = 0; j < uz.length - 1; j++) {
      let run = null;
      for (let i = 0; i < ux.length - 1; i++) {
        const cx = (ux[i] + ux[i + 1]) / 2, cz = (uz[j] + uz[j + 1]) / 2;
        let inHole = false;
        for (const h of hs) if (cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3]) { inHole = true; break; }
        if (!inHole) {
          if (run) run[2] = ux[i + 1];
          else run = [ux[i], uz[j], ux[i + 1], uz[j + 1]];
        } else if (run) { out.push(run); run = null; }
      }
      if (run) out.push(run);
    }
    // 縦に同じ幅で続くものをつなぐ
    out.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const merged = [];
    for (const q of out) {
      const last = merged[merged.length - 1];
      if (last && last[0] === q[0] && last[2] === q[2] && Math.abs(last[3] - q[1]) < 1e-9) last[3] = q[3];
      else merged.push(q.slice());
    }
    return merged.filter((q) => rValid(q));
  }

  // ---------- 出力を集める ----------
  // geom = false のときは形状（箱・スロープ・梯子・小物・デカール…）を捨て、loot と buildings だけ集める（lootSpawns 用）
  // clip = [x0,z0,x1,z1] があれば部品の中心がその中（右・下端は含まない）のものだけ集める
  class Emitter {
    constructor(geom, clip) {
      this.geom = geom !== false;
      this.clip = clip || null;
      this.boxes = []; this.ramps = []; this.ladders = []; this.props = []; this.loot = []; this.vehicles = [];
      this.decals = []; this.roads = []; this.ground = []; this.water = []; this.landmarks = []; this.buildings = [];
      this.maxLen = 120; // これより長い箱・スロープは分ける（チャンク外へのはみ出しを抑える）
      this.tag = null;   // 描画用: GLB のランドマークが見た目を受け持つ部品なら、そのノード名（箱・スロープの lm に入る）
    }
    _in(x, z) { const c = this.clip; return !c || (x >= c[0] && x < c[2] && z >= c[1] && z < c[3]); }
    box(x0, y0, z0, x1, y1, z1, mat, cat, f, mt) {
      if (!this.geom) return;
      if (x1 - x0 < 0.005 || y1 - y0 < 0.005 || z1 - z0 < 0.005) return;
      const L = this.maxLen;
      if (x1 - x0 > L) { const n = Math.ceil((x1 - x0) / L); for (let i = 0; i < n; i++) this.box(x0 + (x1 - x0) * i / n, y0, z0, x0 + (x1 - x0) * (i + 1) / n, y1, z1, mat, cat, f, mt); return; }
      if (z1 - z0 > L) { const n = Math.ceil((z1 - z0) / L); for (let i = 0; i < n; i++) this.box(x0, y0, z0 + (z1 - z0) * i / n, x1, y1, z0 + (z1 - z0) * (i + 1) / n, mat, cat, f, mt); return; }
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      if (!this._in(x, z)) return;
      const b = { x: r2(x), y: r2(y0), z: r2(z), w: r2(x1 - x0), h: r2(y1 - y0), d: r2(z1 - z0), mat, cat, f: f | 0 };
      if (mt) b.mt = mt;
      if (this.tag) b.lm = this.tag;
      this.boxes.push(b);
    }
    // 矩形 [x0,z0,x1,z1] の上面が axis 方向 dir の向きに ya → yb（ya ≤ yb）
    ramp(x0, z0, x1, z1, ya, yb, axis, dir, mat, cat, f, t) {
      if (!this.geom) return;
      const L = this.maxLen, len = axis === 'x' ? x1 - x0 : z1 - z0;
      if (len > L) {
        const n = Math.ceil(len / L);
        for (let i = 0; i < n; i++) {
          // dir = +1: 低い方が min 側。区間 i（min 側から）の高さ
          const u0 = i / n, u1 = (i + 1) / n;
          const h0 = dir > 0 ? ya + (yb - ya) * u0 : yb - (yb - ya) * u0;
          const h1 = dir > 0 ? ya + (yb - ya) * u1 : yb - (yb - ya) * u1;
          const lo = Math.min(h0, h1), hi = Math.max(h0, h1);
          if (axis === 'x') this.ramp(x0 + len * u0, z0, x0 + len * u1, z1, lo, hi, axis, dir, mat, cat, f, t);
          else this.ramp(x0, z0 + len * u0, x1, z0 + len * u1, lo, hi, axis, dir, mat, cat, f, t);
        }
        return;
      }
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      if (!this._in(x, z)) return;
      const p = { x: r2(x), z: r2(z), w: r2(x1 - x0), d: r2(z1 - z0), y0: r2(ya), y1: r2(yb), axis, dir: dir > 0 ? 1 : -1, t: r2(t || 0.3), mat, cat: cat || 'stair', f: (f | 0) | F.WALK };
      if (this.tag) p.lm = this.tag;
      this.ramps.push(p);
    }
    ladder(x, z, y0, y1, nx, nz) {
      if (!this.geom || !this._in(x, z)) return;
      this.ladders.push({ x: r2(x), z: r2(z), y0: r2(y0), y1: r2(y1), nx, nz });
    }
    prop(type, x, y, z, rot) {
      if (!this.geom || !this._in(x, z)) return;
      this.props.push({ type, x: r2(x), y: r2(y), z: r2(z), rot: Math.round((rot || 0) * 1000) / 1000 });
    }
    lootAt(x, y, z, table) {
      if (!this._in(x, z)) return;
      this.loot.push({ id: '', x: r2(x), y: r2(y), z: r2(z), table });
    }
    decal(o) { if (this.geom && this._in(o.x, o.z)) this.decals.push(o); }
    road(kind, pts, mat) {
      if (!this.geom) return;
      let cx = 0, cz = 0;
      for (const p of pts) { cx += p[0] / pts.length; cz += p[1] / pts.length; }
      if (!this._in(cx, cz)) return;
      this.roads.push({ kind, pts: pts.map((p) => [r2(p[0]), r2(p[1])]), mat: mat || 'asphalt_city' });
    }
    groundRect(x0, z0, x1, z1, mat) {
      if (!this.geom || !this._in((x0 + x1) / 2, (z0 + z1) / 2)) return;
      this.ground.push({ x0: r2(x0), z0: r2(z0), x1: r2(x1), z1: r2(z1), mat });
    }
    waterItem(o, x, z) { if (this.geom && this._in(x, z)) this.water.push(o); }
    place(node, glb, x, y, z, yaw) {
      if (!this.geom || !this._in(x, z)) return;
      this.landmarks.push({ node, glb, x: r2(x), y: r2(y), z: r2(z), yaw: Math.round(yaw * 1e4) / 1e4 });
    }
    building(o) { if (this._in((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2)) this.buildings.push(o); }
  }

  // 区画のローカル座標（u = 間口方向、v = 奥行き方向。v = 0 が正面）→ ワールド
  //   front: 'n' 正面が北（−z）を向く / 's' 南 / 'w' 西（−x）/ 'e' 東
  class Frame {
    constructor(x0, z0, x1, z1, front) {
      this.front = front;
      if (front === 'n') { this.ox = x0; this.oz = z0; this.ux = 1; this.uz = 0; this.vx = 0; this.vz = 1; this.W = x1 - x0; this.D = z1 - z0; }
      else if (front === 's') { this.ox = x1; this.oz = z1; this.ux = -1; this.uz = 0; this.vx = 0; this.vz = -1; this.W = x1 - x0; this.D = z1 - z0; }
      else if (front === 'w') { this.ox = x0; this.oz = z1; this.ux = 0; this.uz = -1; this.vx = 1; this.vz = 0; this.W = z1 - z0; this.D = x1 - x0; }
      else { this.ox = x1; this.oz = z0; this.ux = 0; this.uz = 1; this.vx = -1; this.vz = 0; this.W = z1 - z0; this.D = x1 - x0; }
    }
    x(u, v) { return this.ox + u * this.ux + v * this.vx; }
    z(u, v) { return this.oz + u * this.uz + v * this.vz; }
    // ローカルの外向き法線 (nu, nv) → ワールド
    nx(nu, nv) { return nu * this.ux + nv * this.vx; }
    nz(nu, nv) { return nu * this.uz + nv * this.vz; }
    // ローカルの矩形 → ワールドの [x0,z0,x1,z1]
    rect(u0, v0, u1, v1) {
      const xa = this.x(u0, v0), xb = this.x(u1, v1), za = this.z(u0, v0), zb = this.z(u1, v1);
      return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
    }
    box(E, u0, v0, u1, v1, y0, y1, mat, cat, f, mt) {
      const r = this.rect(u0, v0, u1, v1);
      E.box(r[0], y0, r[1], r[2], y1, r[3], mat, cat, f, mt);
    }
    // v 方向（dir = +1 なら奥へ上がる）か u 方向のスロープ
    ramp(E, u0, v0, u1, v1, ya, yb, alongV, dir, mat, cat, f, t) {
      const r = this.rect(u0, v0, u1, v1);
      const ax = alongV ? (this.vx !== 0 ? 'x' : 'z') : (this.ux !== 0 ? 'x' : 'z');
      const sgn = alongV ? (this.vx + this.vz) : (this.ux + this.uz);
      E.ramp(r[0], r[1], r[2], r[3], ya, yb, ax, dir * sgn, mat, cat, f, t);
    }
    // ローカルの面: 0 正面(v=0) 1 奥(v=D) 2 左(u=0) 3 右(u=W) → ワールドの向き 'n'|'s'|'w'|'e'
    side(face) {
      const n = face === 0 ? [0, -1] : face === 1 ? [0, 1] : face === 2 ? [-1, 0] : [1, 0];
      const wx = this.nx(n[0], n[1]), wz = this.nz(n[0], n[1]);
      return wz < 0 ? 'n' : wz > 0 ? 's' : wx < 0 ? 'w' : 'e';
    }
  }
  const SIDE_BIT = { n: 1, s: 2, w: 4, e: 8 };

  // ---------- 建物 ----------
  // 入れる建物（殻 + 床 + 折り返し階段 + 間仕切り + 屋上の階段室 + 外の梯子）。
  // 寸法は整数 m の格子にそろえる（AI の歩行グラフ 1 m 格子のセル中心が扉・階段の通路の中を通るように）。
  //   P: { x0,z0,x1,z1（整数）, front, exp（露出している面のビット）, by（1 階の床）, ground（外の地面）, floors, fh,
  //        shell, floorMat, intMat, roofMat, stairMat, seed, id, kind, lootTable, lootCount:[lo,hi], roofTable, roofChance,
  //        tank, hvac, doorW, doorH, sill, winH, open（間仕切り無し）, extraDoors:[{face,floor,s,w,h}], ladder（false で無し）,
  //        ladderFace, podium（ground..by を埋める）, crates, noSideDoors }
  //   戻り値: { door:[x,y,z], roof:[x,y,z] } か null（小さすぎる）
  function stairRun(H, B) { return Math.max(3, Math.ceil(H / 2 / B.maxSlope)); }
  function canEnter(W, D, H, B) { return W >= B.minEnterW && D >= stairRun(H, B) + 4 + 5; }

  function genEnterable(E, P, B) {
    const rnd = rng(P.seed);
    const fr = new Frame(P.x0, P.z0, P.x1, P.z1, P.front);
    const W = fr.W, D = fr.D, n = P.floors, H = P.fh, by = P.by;
    const ground = P.ground == null ? by : P.ground;
    if (!canEnter(W, D, H, B)) return null;
    const wt = B.wall, st = B.slab, pt = B.partition / 2;
    const R = stairRun(H, B), L = R + 4;
    const left = P.core ? P.core === 'left' : rnd() < 0.5;
    const a = left ? 1 : W - 4;                // 階段の通路 u ∈ [a, a+3]
    const cv0 = D - 1 - L, cv1 = D - 1;        // 階段室 v ∈ [cv0, cv1]（手前の踊り場 cv0..cv0+2 が入口）
    const fl0 = cv0 + 2, fl1 = fl0 + R;        // 階段の区間
    const Fy = (k) => by + k * H;
    const top = Fy(n);
    const exposed = (face) => face === 0 || !!(P.exp & SIDE_BIT[fr.side(face)]);
    const dw = P.doorW || B.doorW, dh = Math.min(P.doorH || B.doorH, H - 0.3);
    const sill = P.sill != null ? P.sill : B.sill;
    const winW = B.winW, winTop = Math.min(H - 0.6, sill + Math.max(P.winH || B.winH, H * 0.42));
    const shell = P.shell, intMat = P.intMat, stairMat = P.stairMat, roofMat = P.roofMat;

    // --- 扉 ---
    const doors = [[], [], [], []]; // 面ごと [{ s0, s1, k, h }]
    let m = Math.floor(W / 2) - Math.floor(dw / 2) + rnd.int(-2, 2);
    if (P.mainDoor != null) m = P.mainDoor;
    m = Math.max(1, Math.min(W - 1 - dw, m));
    doors[0].push({ s0: m, s1: m + dw, k: 0, h: dh });
    if (!P.noSideDoors) {
      for (const face of [2, 3]) {
        if (!exposed(face) || rnd() > 0.7) continue;
        const hi = cv0 - dw - 1;
        if (hi >= 2) { const s = rnd.int(2, hi); doors[face].push({ s0: s, s1: s + 2, k: 0, h: Math.min(B.doorH, H - 0.3) }); }
      }
      if (exposed(1) && rnd() < 0.6) {
        const s = left ? rnd.int(a + 5, Math.max(a + 5, W - 4)) : rnd.int(2, Math.max(2, a - 5));
        if (s >= 1 && s + 2 <= W - 1 && (s + 2 < a - 0.5 || s > a + 3.5)) doors[1].push({ s0: s, s1: s + 2, k: 0, h: Math.min(B.doorH, H - 0.3) });
      }
    }
    for (const d of P.extraDoors || []) doors[d.face].push({ s0: d.s, s1: d.s + (d.w || 2), k: d.floor || 0, h: Math.min(d.h || B.doorH, H - 0.3) });

    // --- 梯子（非常階段）: 既定は正面の端の柱の位置 ---
    let lad = null;
    if (P.ladder !== false) {
      const face = P.ladderFace != null ? P.ladderFace : 0;
      const len = face < 2 ? W : D;
      const cands = face < 2 ? [left ? W - 1.5 : 1.5, left ? 1.5 : W - 1.5, Math.floor(W / 2) + 0.5] : [1.5, Math.min(cv0 - 1.5, 4.5)];
      for (const s of cands) {
        if (s < 1 || s > len - 1) continue;
        if (face >= 2 && s > cv0 - 1) continue;
        if (face === 1 && s > a - 1.5 && s < a + 4.5) continue;
        let clash = false;
        for (const d of doors[face]) if (s > d.s0 - 1 && s < d.s1 + 1) clash = true;
        if (!clash) { lad = { face, s }; break; }
      }
    }

    // --- 間仕切り ---
    const cross = [], longs = [];
    if (!P.open) {
      const fd = cv0 - 2;
      const nc = Math.floor(fd / 11);
      for (let i = 0; i < nc; i++) {
        const v = Math.round(fd * (i + 1) / (nc + 1));
        if (v >= 3 && v <= cv0 - 3) cross.push(v);
      }
      const nl = Math.floor((W - 1) / 13);
      for (let j = 0; j < nl; j++) {
        let u = Math.round(W * (j + 1) / (nl + 1));
        if (u > a - 2 && u < a + 5) continue;
        if (u > m - 1.5 && u < m + dw + 1.5) u = u < m + dw / 2 ? Math.floor(m - 2) : Math.ceil(m + dw + 2);
        if (u < 3 || u > W - 3 || (u > a - 2 && u < a + 5)) continue;
        if (lad && lad.face === 0 && Math.abs(u - lad.s) < 1.5) continue;
        longs.push(u);
      }
    }

    // --- 外壁（階ごと・面ごと）---
    const faceLen = (face) => (face < 2 ? W : D);
    const coreOnFace = (face, s) => {
      if (face === 1) return s > a - 0.7 && s < a + 3.7;
      if (face === 2 && left) return s > cv0 - 0.7;
      if (face === 3 && !left) return s > cv0 - 0.7;
      return false;
    };
    const faceBox = (face, s0, s1, y0, y1, f) => {
      if (face === 0) fr.box(E, s0, 0, s1, wt, y0, y1, shell, 'exterior', f);
      else if (face === 1) fr.box(E, s0, D - wt, s1, D, y0, y1, shell, 'exterior', f);
      else if (face === 2) fr.box(E, 0, Math.max(s0, wt), wt, Math.min(s1, D - wt), y0, y1, shell, 'exterior', f);
      else fr.box(E, W - wt, Math.max(s0, wt), W, Math.min(s1, D - wt), y0, y1, shell, 'exterior', f);
    };
    for (let k = 0; k < n && E.geom; k++) {
      const y = Fy(k);
      for (let face = 0; face < 4; face++) {
        const Lf = faceLen(face);
        const sMin = face < 2 ? 0 : wt, sMax = face < 2 ? Lf : Lf - wt;
        const ops = [];
        for (const d of doors[face]) if (d.k === k) ops.push({ s0: d.s0, s1: d.s1, lo: 0, hi: d.h });
        const nb = Math.floor((Lf - 1.2) / B.bay);
        const off = (Lf - nb * B.bay) / 2;
        const junc = face < 2 ? longs : cross;
        for (let i = 0; i < nb; i++) {
          const c = off + B.bay * (i + 0.5), s0 = c - winW / 2, s1 = c + winW / 2;
          if (s0 < sMin + 0.3 || s1 > sMax - 0.3) continue;
          if (coreOnFace(face, c)) continue;
          if (lad && lad.face === face && Math.abs(c - lad.s) < 1.2) continue;
          let bad = false;
          for (const o of ops) if (s1 > o.s0 - 0.4 && s0 < o.s1 + 0.4) bad = true;
          for (const u of junc) if (Math.abs(c - u) < 0.95) bad = true;
          if (!bad) ops.push({ s0, s1, lo: sill, hi: winTop });
        }
        ops.sort((p, q) => p.s0 - q.s0);
        let tmax = 0;
        for (const o of ops) tmax = Math.max(tmax, o.hi);
        if (tmax < H) faceBox(face, sMin, sMax, y + tmax, y + H, F.SHELL);
        let prev = sMin;
        for (const o of ops) {
          if (o.s0 > prev) faceBox(face, prev, o.s0, y, y + tmax, F.SHELL);
          if (o.lo > 0) faceBox(face, o.s0, o.s1, y, y + o.lo, F.SHELL);
          if (o.hi < tmax) faceBox(face, o.s0, o.s1, y + o.hi, y + tmax, F.SHELL);
          prev = Math.max(prev, o.s1);
        }
        if (prev < sMax) faceBox(face, prev, sMax, y, y + tmax, F.SHELL);
      }
    }
    // パラペット（梯子の所だけ切る）
    for (let face = 0; face < 4 && E.geom; face++) {
      const Lf = faceLen(face), sMin = face < 2 ? 0 : wt, sMax = face < 2 ? Lf : Lf - wt;
      if (lad && lad.face === face) {
        faceBox(face, sMin, lad.s - 0.8, top, top + B.parapet, 0);
        faceBox(face, lad.s + 0.8, sMax, top, top + B.parapet, 0);
      } else faceBox(face, sMin, sMax, top, top + B.parapet, 0);
    }
    if (P.podium && by > ground) fr.box(E, 0, 0, W, D, ground, by, shell, 'exterior', F.WALK);

    // --- 床スラブ（k = 1..n。n は屋根）。階段の上は開ける ---
    const hole = [a, fl0, a + 3, cv1];
    const slabRects = E.geom ? rectMinus([wt, wt, W - wt, D - wt], [hole]) : [];
    for (let k = 1; k <= n && E.geom; k++) {
      const y = Fy(k), roof = k === n;
      for (const q of slabRects) fr.box(E, q[0], q[1], q[2], q[3], y - st, y, roof ? roofMat : P.floorMat, roof ? 'roof' : 'floor', F.WALK, roof ? roofMat : null);
    }
    // --- 階段室（壁は 1 階から屋上の階段室の天井まで 1 本の箱）---
    const bulkTop = top + B.bulkhead;
    if (left) {
      fr.box(E, wt, cv0, a, D - wt, by, bulkTop, intMat, 'interior', 0);
      fr.box(E, a + 3, cv0, a + 3 + 0.2, D - wt, by, bulkTop, intMat, 'interior', 0);
    } else {
      fr.box(E, a - 0.2, cv0, a, D - wt, by, bulkTop, intMat, 'interior', 0);
      fr.box(E, a + 3, cv0, W - wt, D - wt, by, bulkTop, intMat, 'interior', 0);
    }
    fr.box(E, a, cv1, a + 3, D - wt, by, bulkTop, intMat, 'interior', 0);
    fr.box(E, a + 1.45, fl0, a + 1.55, fl1, by, top, intMat, 'interior', 0);
    fr.box(E, left ? wt : a - 0.2, cv0, left ? a + 3.2 : W - wt, D - wt, bulkTop, bulkTop + st, roofMat, 'roof', F.WALK, roofMat);
    for (let k = 0; k < n && E.geom; k++) {
      const y = Fy(k), mid = y + H / 2;
      fr.ramp(E, a, fl0, a + 1.45, fl1, y, mid, true, +1, stairMat, 'stair', 0, B.stairT);
      fr.ramp(E, a + 1.55, fl0, a + 3, fl1, mid, y + H, true, -1, stairMat, 'stair', 0, B.stairT);
      fr.box(E, a, fl1, a + 3, cv1, mid - st, mid, stairMat, 'floor', F.WALK);
    }
    // --- 間仕切り（扉の隙間つき。区切られた部屋はすべて隣とつながる）---
    const gapIn = (s0, s1) => { // 区間 [s0,s1] に幅 2 の隙間 → [g, g+2] か null（区間ごと開ける）
      const lo = Math.ceil(s0 + 0.4), hi = Math.floor(s1 - 2.4);
      if (s1 - s0 < 3) return 'open';
      if (hi < lo) return [lo, lo + 2];
      return [rnd.int(lo, hi), 0];
    };
    for (let k = 0; k < n; k++) {
      const y0 = Fy(k), y1 = Fy(k + 1) - st;
      for (const v of cross) {
        const cuts = [wt].concat(longs.map((u) => u - pt), [W - wt]);
        const ends = [wt].concat(longs.map((u) => u + pt), [W - wt]);
        for (let i = 0; i < cuts.length - 1; i++) {
          const s0 = ends[i], s1 = cuts[i + 1];
          const g = gapIn(s0, s1);
          if (g === 'open') continue;
          const g0 = g[0], g1 = g0 + 2;
          fr.box(E, s0, v - pt, g0, v + pt, y0, y1, intMat, 'interior', 0);
          fr.box(E, g1, v - pt, s1, v + pt, y0, y1, intMat, 'interior', 0);
        }
      }
      for (const u of longs) {
        const cuts = [wt].concat(cross.map((v) => v - pt), [D - wt]);
        const ends = [wt].concat(cross.map((v) => v + pt), [D - wt]);
        for (let i = 0; i < cuts.length - 1; i++) {
          const s0 = ends[i], s1 = cuts[i + 1];
          const g = gapIn(s0, s1);
          if (g === 'open') continue;
          const g0 = g[0], g1 = g0 + 2;
          fr.box(E, u - pt, s0, u + pt, g0, y0, y1, intMat, 'interior', 0);
          fr.box(E, u - pt, g1, u + pt, s1, y0, y1, intMat, 'interior', 0);
        }
      }
    }
    // --- 梯子 ---
    let ladTop = null;
    if (lad) {
      const nrm = lad.face === 0 ? [0, -1] : lad.face === 1 ? [0, 1] : lad.face === 2 ? [-1, 0] : [1, 0];
      const lu = lad.face < 2 ? lad.s : (lad.face === 2 ? 0 : W), lv = lad.face < 2 ? (lad.face === 0 ? 0 : D) : lad.s;
      E.ladder(fr.x(lu, lv), fr.z(lu, lv), ground, top, fr.nx(nrm[0], nrm[1]), fr.nz(nrm[0], nrm[1]));
      ladTop = lad.face < 2 ? [lad.s, lad.face === 0 ? 1.5 : D - 1.5] : [lad.face === 2 ? 1.5 : W - 1.5, lad.s];
    }
    // --- 屋上の小物 ---
    const used = [[a - 1.2, cv0 - 1.2, a + 4.2, D]];
    if (ladTop) used.push([ladTop[0] - 1.5, ladTop[1] - 2, ladTop[0] + 1.5, ladTop[1] + 1.5]);
    const free = (u0, v0, u1, v1) => {
      if (u0 < wt + 0.2 || v0 < wt + 0.2 || u1 > W - wt - 0.2 || v1 > D - wt - 0.2) return false;
      for (const q of used) if (u0 < q[2] && q[0] < u1 && v0 < q[3] && q[1] < v1) return false;
      return true;
    };
    if (P.tank && W >= 10) {
      for (let t = 0; t < 6; t++) {
        const u = rnd.range(3, W - 3), v = rnd.range(3, Math.max(3.1, cv0 - 1.5));
        if (!free(u - 2.2, v - 2.2, u + 2.2, v + 2.2)) continue;
        used.push([u - 2.6, v - 2.6, u + 2.6, v + 2.6]);
        genTank(E, fr.x(u, v), top, fr.z(u, v), rnd.int(0, 3) * Math.PI / 2);
        break;
      }
    }
    const nh = P.hvac == null ? rnd.int(0, 2) : P.hvac;
    for (let i = 0; i < nh; i++) {
      for (let t = 0; t < 5; t++) {
        const u = rnd.range(2.5, W - 2.5), v = rnd.range(2.5, D - 2.5);
        if (!free(u - 1.4, v - 1.0, u + 1.4, v + 1.0)) continue;
        used.push([u - 1.8, v - 1.4, u + 1.8, v + 1.4]);
        const rot = (fr.ux !== 0 ? 0 : Math.PI / 2);
        const wx = fr.x(u, v), wz = fr.z(u, v);
        E.prop('hvac_unit', wx, top, wz, rot);
        if (rot === 0) E.box(wx - 1.15, top, wz - 0.7, wx + 1.15, top + 1.33, wz + 0.7, 'metalDark', 'prop', F.WALK);
        else E.box(wx - 0.7, top, wz - 1.15, wx + 0.7, top + 1.33, wz + 1.15, 'metalDark', 'prop', F.WALK);
        break;
      }
    }
    // --- 木箱（倉庫の遮蔽物）---
    const crateSpots = [];
    for (let i = 0; i < (P.crates || 0); i++) {
      const u = rnd.int(3, W - 4) + 0.5, v = rnd.int(3, Math.max(3, cv0 - 3)) + 0.5;
      if (v < 3 && u > m - 1 && u < m + dw + 1) continue;
      crateSpots.push([u, v]);
      const wx = fr.x(u, v), wz = fr.z(u, v), tall = rnd() < 0.3;
      E.prop(tall ? 'crate_tall' : 'crate', wx, by, wz, 0);
      E.box(wx - 0.62, by, wz - 0.62, wx + 0.62, by + (tall ? 2.5 : 1.25), wz + 0.62, 'crate', 'prop', F.WALK);
    }
    // --- 戦利品 ---
    const okSpot = (u, v, k) => {
      if (u > a - 1 && u < a + 4 && v > cv0 - 1.5) return false;
      for (const x of longs) if (Math.abs(u - x) < 1.1) return false;
      for (const x of cross) if (Math.abs(v - x) < 1.1) return false;
      if (k === 0 && v < 3 && u > m - 1 && u < m + dw + 1) return false;
      for (const c of crateSpots) if (k === 0 && Math.abs(c[0] - u) < 1.6 && Math.abs(c[1] - v) < 1.6) return false;
      return true;
    };
    const lc = P.lootCount || [1, 2];
    for (let k = 0; k < n; k++) {
      const cnt = rnd.int(lc[0], lc[1]);
      let placed = 0;
      for (let t = 0; t < 14 && placed < cnt; t++) {
        const u = rnd.int(2, W - 3) + 0.5, v = rnd.int(2, D - 3) + 0.5;
        if (!okSpot(u, v, k)) continue;
        E.lootAt(fr.x(u, v), Fy(k), fr.z(u, v), P.lootTable || 'interior');
        placed++;
      }
    }
    if (rnd() < (P.roofChance == null ? 0.4 : P.roofChance)) {
      for (let t = 0; t < 8; t++) {
        const u = rnd.int(2, W - 3) + 0.5, v = rnd.int(2, D - 3) + 0.5;
        if (!free(u - 0.7, v - 0.7, u + 0.7, v + 0.7)) continue;
        E.lootAt(fr.x(u, v), top, fr.z(u, v), P.roofTable || 'roof');
        break;
      }
    }
    const door = [r2(fr.x(m + dw / 2, -1.5)), r2(ground), r2(fr.z(m + dw / 2, -1.5))];
    const roofPt = [r2(fr.x(a + 1.5, cv0 - 1.5)), r2(top), r2(fr.z(a + 1.5, cv0 - 1.5))];
    E.building({ id: P.id, kind: P.kind || 'walkup', x0: P.x0, z0: P.z0, x1: P.x1, z1: P.z1, floors: n, door, roof: roofPt });
    return { door, roof: roofPt };
  }

  // 屋上の給水タンク（脚 4 本 + 胴 + 胴の梯子）。rot は 90° 刻み
  function genTank(E, x, y, z, rot) {
    E.prop('water_tank', x, y, z, rot);
    for (const sx of [-1.55, 1.55]) for (const sz of [-1.55, 1.55]) E.box(x + sx - 0.12, y, z + sz - 0.12, x + sx + 0.12, y + 2.84, z + sz + 0.12, 'metalDark', 'prop', 0);
    E.box(x - 1.95, y + 2.84, z - 1.95, x + 1.95, y + 6.6, z + 1.95, 'crate', 'prop', F.WALK);
    const nx = Math.round(Math.sin(rot)), nz = Math.round(Math.cos(rot));
    E.ladder(x + nx * 1.95, z + nz * 1.95, y, y + 6.6, nx, nz);
  }

  // 入れない建物（段 tiers を箱で積む。屋上はパラペット + 小物）
  //   L: 区画（tiers:[[x0,z0,x1,z1,y0,y1]…], mat, front, exp, lobby, tank, bb, seed …）
  function genSolid(E, L, B, ctx) {
    const rnd = rng(L.seed ^ 0x5bd1e995);
    const roofMat = ctx.M.roof;
    const tiers = L.tiers;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      let y0 = t[4];
      if (i === 0 && L.lobby) y0 = t[4] + L.lobbyH;
      E.box(t[0], y0, t[1], t[2], t[5], t[3], L.mat, 'exterior', F.WALK, roofMat);
      // パラペット
      const y = t[5], p = 0.3, h = B.parapet;
      E.box(t[0], y, t[1], t[2], y + h, t[1] + p, L.mat, 'roof', 0);
      E.box(t[0], y, t[3] - p, t[2], y + h, t[3], L.mat, 'roof', 0);
      E.box(t[0], y, t[1] + p, t[0] + p, y + h, t[3] - p, L.mat, 'roof', 0);
      E.box(t[2] - p, y, t[1] + p, t[2], y + h, t[3] - p, L.mat, 'roof', 0);
    }
    const tt = tiers[tiers.length - 1];
    const tw = tt[2] - tt[0], td = tt[3] - tt[1];
    if (L.tank && tw >= 9 && td >= 9) genTank(E, tt[0] + tw * rnd.range(0.3, 0.7), tt[5], tt[1] + td * rnd.range(0.3, 0.7), rnd.int(0, 3) * Math.PI / 2);
    const nh = Math.min(4, Math.floor(tw * td / 250));
    for (let i = 0; i < nh; i++) {
      const x = tt[0] + rnd.range(2, tw - 2), z = tt[1] + rnd.range(2, td - 2);
      if (L.tank && Math.abs(x - (tt[0] + tw / 2)) < 4 && Math.abs(z - (tt[1] + td / 2)) < 4) continue;
      E.prop('hvac_unit', x, tt[5], z, 0);
      E.box(x - 1.15, tt[5], z - 0.7, x + 1.15, tt[5] + 1.33, z + 0.7, 'metalDark', 'prop', F.WALK);
    }
    if (L.lobby) genLobby(E, L, B, ctx, rnd);
    if (L.bb) genBillboards(E, L, rnd);
  }

  // 塔の 1 階ロビー（ガラスの正面 + 柱。天井は上の箱の下面）
  function genLobby(E, L, B, ctx, rnd) {
    const t = L.tiers[0];
    const fr = new Frame(t[0], t[1], t[2], t[3], L.front);
    const W = fr.W, D = fr.D, by = t[4], h = L.lobbyH, wt = B.wall;
    const mat = ctx.M.shell[L.mat] || 'limestone';
    const m = Math.max(2, Math.min(W - 4, Math.floor(W / 2) - 1));
    // 正面: 扉 + 大きな窓（腰 0.4）
    const ops = [{ s0: m, s1: m + 2, lo: 0, hi: 2.4 }];
    for (let s = 1.5; s + 2.5 < W - 1; s += 4) if (s + 2.5 < m - 0.5 || s > m + 2.5) ops.push({ s0: s, s1: s + 2.5, lo: 0.4, hi: h - 1 });
    ops.sort((p, q) => p.s0 - q.s0);
    let prev = 0;
    fr.box(E, 0, 0, W, wt, by + h - 1, by + h, mat, 'exterior', F.SHELL);
    for (const o of ops) {
      if (o.s0 > prev) fr.box(E, prev, 0, o.s0, wt, by, by + h - 1, mat, 'exterior', F.SHELL);
      if (o.lo > 0) fr.box(E, o.s0, 0, o.s1, wt, by, by + o.lo, mat, 'exterior', F.SHELL);
      if (o.hi < h - 1) fr.box(E, o.s0, 0, o.s1, wt, by + o.hi, by + h - 1, mat, 'exterior', F.SHELL);
      prev = o.s1;
    }
    fr.box(E, prev, 0, W, wt, by, by + h - 1, mat, 'exterior', F.SHELL);
    fr.box(E, 0, D - wt, W, D, by, by + h, mat, 'exterior', F.SHELL);
    fr.box(E, 0, wt, wt, D - wt, by, by + h, mat, 'exterior', F.SHELL);
    fr.box(E, W - wt, wt, W, D - wt, by, by + h, mat, 'exterior', F.SHELL);
    // 柱
    for (let u = 6; u < W - 4; u += 8) for (let v = 6; v < D - 4; v += 8) {
      if (Math.abs(u - (m + 1)) < 2.5) continue;
      fr.box(E, u - 0.4, v - 0.4, u + 0.4, v + 0.4, by, by + h, 'marble_floor', 'interior', 0);
    }
    const u = Math.min(W - 2.5, m + 4.5), v = Math.min(D - 2.5, 3.5);
    E.lootAt(fr.x(u, v), by, fr.z(u, v), L.hot >= 0 ? 'hot' : 'interior');
    E.building({ id: L.id, kind: 'lobby', x0: t[0], z0: t[1], x1: t[2], z1: t[3], floors: 1, door: [r2(fr.x(m + 1, -1.5)), r2(by), r2(fr.z(m + 1, -1.5))], roof: null });
  }

  // タイムズスクエアの看板（正面と露出した横の面に、発光パネルのデカール）
  function genBillboards(E, L, rnd) {
    const t = L.tiers[0];
    const fr = new Frame(t[0], t[1], t[2], t[3], L.front);
    const H = t[5] - t[4];
    for (let face = 0; face < 4; face++) {
      if (face === 1) continue;
      if (face > 1 && !(L.exp & SIDE_BIT[fr.side(face)])) continue;
      const Lf = face < 2 ? fr.W : fr.D;
      const nrm = face === 0 ? [0, -1] : face === 2 ? [-1, 0] : [1, 0];
      const nx = fr.nx(nrm[0], nrm[1]), nz = fr.nz(nrm[0], nrm[1]);
      let y = t[4] + 7;
      for (let row = 0; row < 3 && y + 6 < t[4] + H; row++) {
        const w = Math.min(Lf - 2, rnd.range(8, 22)), h = rnd.range(6, 14);
        if (y + h > t[4] + H - 1) break;
        const s = rnd.range(1 + w / 2, Lf - 1 - w / 2);
        const lu = face < 2 ? s : (face === 2 ? -0.06 : fr.W + 0.06), lv = face < 2 ? -0.06 : s;
        E.decal({ type: 'billboard', x: r2(fr.x(lu, lv)), y: r2(y + h / 2), z: r2(fr.z(lu, lv)), w: r2(w), h: r2(h), nx, nz, idx: rnd.int(0, 15) });
        y += h + rnd.range(1, 4);
      }
    }
  }

  // ---------- 街 ----------
  class CityGen {
    constructor(plan, opts) {
      this.opts = opts || {};
      this.plan = plan;
      this.seed = plan.seed | 0;
      const b = plan.bounds;
      this.minX = b.minX; this.maxX = b.maxX; this.minZ = b.minZ; this.maxZ = b.maxZ;
      this.cs = plan.chunkSize || 128;
      this.ncx = Math.ceil((this.maxX - this.minX) / this.cs);
      this.ncz = Math.ceil((this.maxZ - this.minZ) / this.cs);
      this.waterY = plan.waterY; this.bedY = plan.bedY;
      this.maxOverhang = plan.maxOverhang || 64;
      this.engine = plan.engine || {};
      this.B = plan.building; this.M = plan.materials;
      this.curbH = plan.grid.curbH; this.sidewalk = plan.grid.sidewalk;
      this.hotZones = (plan.hotZones || []).map((h) => Object.assign({}, h));
      this.helipads = (plan.heliports || []).map((h) => Object.assign({}, h));
      this.keepouts = this.helipads.map((h) => [h.x, h.z, h.r + 3]);
      // パッドの外の置き場所（spawn に高さ y があるもの = 空母のヘリの桟橋）も小物を置かない（回転翼の半径 + 余裕）
      for (const h of this.helipads) if (Array.isArray(h.spawn) && h.spawn.length > 3) this.keepouts.push([h.spawn[0], h.spawn[1], 9]);
      this._initWater();
      this._initRoads();
      this._indexRoads();
      this._initClaims();
      this._initSubways();
      this._initBlocks();
      this._initLots();
      this._initVehicles();
      this._initIndex();
      // ランドマーク・桟橋などの静的な形と支えの格子は、最初に使うときに作る（staticItems / supportHeightAt）
    }

    // ===== 水と地面 =====
    _initWater() {
      const sh = this.plan.shores;
      const sortZ = (pts) => pts.slice().sort((p, q) => p[0] - q[0]);
      this.shoreW = sortZ(sh.west); this.shoreE = sortZ(sh.east); this.shoreQ = sortZ(sh.queens);
      this.islands = this.plan.islands || [];
      this.lakes = (this.plan.lakes || []).map((l) => Object.assign({ bb: polyBox(l.poly) }, l));
      const g = this.plan.grid, P = this.plan.piers || {};
      this.piers = [];
      if (P.hudson) {
        const h = P.hudson;
        for (let n = h.from; n <= h.to; n++) {
          if ((h.skip || []).indexOf(n) >= 0) continue;
          const z = (g.streetZ0 - n) * g.streetSpacing;
          this.piers.push({ id: 'pier' + n, rect: [h.x0, z - h.w / 2, h.x1, z + h.w / 2], mat: 'concrete', land: 'e' });
        }
      }
      for (const e of P.extra || []) this.piers.push({ id: e.id, rect: [e.x0, e.z0, e.x1, e.z1], mat: e.mat || 'concrete', road: !!e.road });
      this.pits = [];
      for (const lm of this.plan.landmarks || []) if (lm.kind === 'rockefeller' && lm.params.pit) {
        const p = lm.params.pit;
        this.pits.push({ rect: [p[0], p[1], p[2], p[3]], y: p[4] });
      }
    }
    _inIsland(is, x, z) {
      if (x < is.x0 || x > is.x1 || z < is.z1 || z > is.zTip) return false;
      const cz = is.zTip - is.tipR, cx = (is.x0 + is.x1) / 2;
      if (z > cz) return (x - cx) * (x - cx) + (z - cz) * (z - cz) <= is.tipR * is.tipR;
      return true;
    }
    eastShoreX(z) { return interp(this.shoreE, z); }
    isLand(x, z) {
      if (x < interp(this.shoreW, z)) return false;
      if (x <= interp(this.shoreE, z)) return true;
      if (x >= interp(this.shoreQ, z)) return true;
      for (const is of this.islands) if (this._inIsland(is, x, z)) return true;
      return false;
    }
    _lakeAt(x, z) {
      for (const l of this.lakes) if (rInside(x, z, l.bb) && pointInPoly(x, z, l.poly)) return l;
      return null;
    }
    // 地形（箱を含まない）: { y: 地面（川底・湖底・穴の底）, water: 水面 or null }
    groundAt(x, z) {
      const l = this._lakeAt(x, z);
      if (l) return { y: l.bed, water: l.y };
      if (!this.isLand(x, z)) return { y: this.bedY, water: this.waterY };
      for (const p of this.pits) if (rInside(x, z, p.rect)) return { y: p.y, water: null };
      return { y: 0, water: null };
    }
    isWater(x, z) { return this.groundAt(x, z).water !== null; }
    waterLevelAt(x, z) { return this.groundAt(x, z).water; }
    // 0 = 陸と桟橋、水の上は waterY（穴の中は穴の底）
    groundY(x, z) {
      const g = this.groundAt(x, z);
      if (g.water === null) return g.y;
      for (const p of this.piers) if (rInside(x, z, p.rect)) return 0;
      return g.water;
    }
    chunkOf(x, z) { return { cx: Math.floor((x - this.minX) / this.cs), cz: Math.floor((z - this.minZ) / this.cs) }; }
    chunkKey(cx, cz) { return cx + '_' + cz; }
    chunkRect(cx, cz) { const x0 = this.minX + cx * this.cs, z0 = this.minZ + cz * this.cs; return [x0, z0, x0 + this.cs, z0 + this.cs]; }

    // ===== 道路 =====
    _initRoads() {
      const plan = this.plan, g = plan.grid;
      this.roads = [];        // { id, kind, rect?, pts?, axis, w, lanes }
      this.gapFill = [];      // 通りを塞いだ所（舗装で埋める）
      this.inters = [];       // 交差点
      const gaps = (plan.roadGaps || []).map((q) => q.rect.slice());
      for (const lm of plan.landmarks || []) if (lm.kind === 'railyard' && lm.claim) gaps.push(lm.claim.slice());
      this.gaps = gaps;
      const parkRects = (plan.parks || []).map((p) => p.rect);
      const addRoad = (kind, rect, axis, w, extra) => {
        const pieces = rectMinus(rect, gaps);
        for (const q of pieces) this.roads.push(Object.assign({ id: this.roads.length, kind, rect: q, axis, w }, extra || {}));
        for (const gp of gaps) {
          const c = rInter(rect, gp);
          if (!rValid(c, 0.5)) continue;
          let inPark = false;
          for (const pr of parkRects) if (c[0] >= pr[0] - 1 && c[2] <= pr[2] + 1 && c[1] >= pr[1] - 1 && c[3] <= pr[3] + 1) inPark = true;
          if (!inPark) this.gapFill.push(c);
        }
      };
      const inGap = (x, z) => { for (const gp of gaps) if (x > gp[0] && x < gp[2] && z > gp[1] && z < gp[3]) return true; return false; };
      this._inGap = inGap;
      // マンハッタン
      this.avenues = plan.avenues.map((a, i) => ({ id: a.id, i, x: a.x, w: a.w, z0: a.z0 == null ? this.minZ : a.z0, z1: a.z1 == null ? this.maxZ : a.z1, median: a.median || 0 })).sort((p, q) => p.x - q.x);
      this.streets = [];
      for (let n = g.streetMin; n <= g.streetMax; n++) {
        const z = (g.streetZ0 - n) * g.streetSpacing;
        this.streets.push({ n, z, w: g.wide.indexOf(n) >= 0 ? g.wideWidth : g.streetWidth });
      }
      this.streets.sort((p, q) => p.z - q.z);
      const fd = plan.fdr;
      this.fdrWest = (z) => this.eastShoreX(z) - fd.offset - fd.w;
      this.fdrEast = (z) => this.eastShoreX(z) - fd.offset;
      this.avesAt = (z) => this.avenues.filter((a) => z >= a.z0 && z <= a.z1);
      for (const a of this.avenues) addRoad('avenue', [a.x - a.w / 2, a.z0, a.x + a.w / 2, a.z1], 'z', a.w, { lanes: Math.max(2, Math.round(a.w / 3.5) - 1), median: a.median });
      for (const s of this.streets) {
        const aves = this.avesAt(s.z);
        const z0 = s.z - s.w / 2, z1 = s.z + s.w / 2;
        for (let i = 0; i < aves.length; i++) {
          const A = aves[i], xa = A.x + A.w / 2;
          const xb = i + 1 < aves.length ? aves[i + 1].x - aves[i + 1].w / 2 : this.fdrWest(s.z);
          if (xb - xa > 1) addRoad('street', [xa, z0, xb, z1], 'x', s.w, { lanes: s.w > 20 ? 4 : 2, n: s.n });
        }
        for (const A of aves) {
          if (inGap(A.x, s.z)) continue;
          this.inters.push({ id: this.inters.length, x: A.x, z: s.z, w: A.w, d: s.w, ave: A.id, n: s.n, q: false });
        }
      }
      // FDR（岸に沿う四角形）
      const zs = [this.minZ].concat(this.streets.map((s) => s.z), [this.maxZ]);
      for (let i = 0; i < zs.length - 1; i++) {
        const za = zs[i], zb = zs[i + 1];
        this.roads.push({ id: this.roads.length, kind: 'fdr', pts: [[this.fdrWest(za), za], [this.fdrEast(za), za], [this.fdrEast(zb), zb], [this.fdrWest(zb), zb]], axis: 'z', w: fd.w, lanes: 4 });
      }
      // ブロードウェイ（≤ 64 m の四角形。plazaZ の区間は歩行者天国）
      const bw = plan.broadway;
      this.bwPts = bw.pts.map((p) => [p[1], p[0]]).sort((p, q) => p[0] - q[0]); // [z, x]
      this.bwHalf = bw.w / 2;
      this.bwPlaza = bw.plazaZ || [];
      for (let i = 0; i < bw.pts.length - 1; i++) {
        const p = bw.pts[i], q = bw.pts[i + 1];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]), nseg = Math.ceil(len / 64);
        const dx = (q[0] - p[0]) / len, dz = (q[1] - p[1]) / len, hx = -dz * this.bwHalf, hz = dx * this.bwHalf;
        for (let k = 0; k < nseg; k++) {
          const ax = p[0] + (q[0] - p[0]) * k / nseg, az = p[1] + (q[1] - p[1]) * k / nseg;
          const bx = p[0] + (q[0] - p[0]) * (k + 1) / nseg, bz = p[1] + (q[1] - p[1]) * (k + 1) / nseg;
          const mz = (az + bz) / 2;
          const plaza = this._bwIsPlaza(mz);
          this.roads.push({ id: this.roads.length, kind: plaza ? 'plaza' : 'broadway', pts: [[ax + hx, az + hz], [bx + hx, bz + hz], [bx - hx, bz - hz], [ax - hx, az - hz]], axis: 'diag', w: bw.w, lanes: 3, mat: plaza ? 'sidewalk' : 'asphalt_city' });
        }
      }
      // クイーンズ
      const Q = plan.queens;
      this.qAvenues = Q.avenues.map((a) => ({ id: a.id, x: a.x, w: a.w }));
      this.qStreets = [];
      for (let z = Q.streetZ0; z > this.minZ + 20; z -= Q.streetSpacing) this.qStreets.push(z);
      for (let z = Q.streetZ0 + Q.streetSpacing; z < this.maxZ - 20; z += Q.streetSpacing) this.qStreets.push(z);
      this.qStreets = this.qStreets.sort((p, q) => p - q).map((z) => ({ z, w: Q.wide.indexOf(z) >= 0 ? Q.wideWidth : Q.streetWidth }));
      for (const a of this.qAvenues) addRoad('avenue', [a.x - a.w / 2, this.minZ, a.x + a.w / 2, this.maxZ], 'z', a.w, { lanes: Math.max(2, Math.round(a.w / 3.5) - 1) });
      for (const s of this.qStreets) {
        const z0 = s.z - s.w / 2, z1 = s.z + s.w / 2;
        for (let i = 0; i < this.qAvenues.length; i++) {
          const A = this.qAvenues[i], xa = A.x + A.w / 2;
          const xb = i + 1 < this.qAvenues.length ? this.qAvenues[i + 1].x - this.qAvenues[i + 1].w / 2 : this.maxX;
          if (xb - xa > 1) addRoad('street', [xa, z0, xb, z1], 'x', s.w, { lanes: s.w > 20 ? 4 : 2 });
        }
        for (const A of this.qAvenues) if (!inGap(A.x, s.z)) this.inters.push({ id: this.inters.length, x: A.x, z: s.z, w: A.w, d: s.w, ave: A.id, n: -1, q: true });
      }
      // ルーズベルト島
      const RI = plan.roosevelt, is = this.islands[0];
      if (RI && is) {
        this.riRoad = [RI.roadX - RI.roadW / 2, is.z1, RI.roadX + RI.roadW / 2, RI.parkZ];
        addRoad('avenue', this.riRoad.slice(), 'z', RI.roadW, { lanes: 2 });
        for (const z of RI.streetZ) {
          addRoad('street', [is.x0 + RI.promenade, z - RI.streetW / 2, this.riRoad[0], z + RI.streetW / 2], 'x', RI.streetW, { lanes: 2 });
          addRoad('street', [this.riRoad[2], z - RI.streetW / 2, is.x1 - RI.promenade, z + RI.streetW / 2], 'x', RI.streetW, { lanes: 2 });
          if (!inGap(RI.roadX, z)) this.inters.push({ id: this.inters.length, x: RI.roadX, z, w: RI.roadW, d: RI.streetW, ave: 'ri', n: -1, q: true });
        }
      }
    }
    _bwIsPlaza(z) { for (const r of this.bwPlaza) if (z >= r[0] && z <= r[1]) return true; return false; }
    // ブロードウェイの中心線 x(z) と、水平方向の半幅（斜めなので幅を補正）
    bwX(z) { return interp(this.bwPts, z); }
    bwHalfX(z) {
      const p = this.bwPts;
      let i = 0;
      while (i < p.length - 2 && p[i + 1][0] < z) i++;
      const s = (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1);
      return this.bwHalf * Math.sqrt(1 + s * s);
    }
    // z 区間 [z0,z1] でブロードウェイ（+ extra）が占める x の範囲
    bwRange(z0, z1, extra) {
      const r = interpRange(this.bwPts, z0, z1);
      const h = Math.max(this.bwHalfX(z0), this.bwHalfX(z1), this.bwHalfX((z0 + z1) / 2)) + (extra || 0);
      return [r[0] - h, r[1] + h];
    }
    onBroadway(x, z, extra) { return Math.abs(x - this.bwX(z)) <= this.bwHalfX(z) + (extra || 0); }

    // ===== 占有（ランドマーク・公園・橋の下）=====
    _initClaims() {
      const plan = this.plan;
      this.claims = [];
      this.noPlinth = [];
      for (const lm of plan.landmarks || []) {
        if (!lm.claim) continue;
        const plinth = lm.kind !== 'railyard' && lm.kind !== 'hudson_yards' && lm.kind !== 'boathouse';
        this.claims.push({ id: lm.id, kind: lm.kind, rect: lm.claim.slice(), plinth });
        if (!plinth) this.noPlinth.push(lm.claim.slice());
      }
      for (const p of plan.parks || []) {
        this.claims.push({ id: p.id, kind: 'park', rect: p.rect.slice(), plinth: false });
        this.noPlinth.push(p.rect.slice());
      }
      for (const p of this.pits) this.noPlinth.push(p.rect.slice());
      const rk = (plan.landmarks || []).find((l) => l.kind === 'rockefeller');
      if (rk) this.claims.push({ id: 'rock_prom', kind: 'plaza', rect: [rk.params.promenade[0], rk.params.promenade[1] - 4, rk.params.promenade[2], rk.params.promenade[3] + 4], plinth: true });
      const br = (plan.landmarks || []).find((l) => l.kind === 'bridge');
      if (br) {
        const p = br.params, hw = p.w / 2 + 6;
        this.claims.push({ id: 'bridge', kind: 'bridge', rect: [p.x0 - 4, p.z - hw, p.x1 + 4, p.z + hw], plinth: true });
      }
      const vi = (plan.landmarks || []).find((l) => l.kind === 'viaduct');
      if (vi) {
        const p = vi.params;
        this.claims.push({ id: 'viaduct_s', kind: 'viaduct', rect: [-p.w / 2 - 2, p.south[0], p.w / 2 + 2, p.south[1]], plinth: true });
      }
    }
    _claimed(r) { for (const c of this.claims) if (rOverlap(r, c.rect)) return c; return null; }

    // ===== 街区（通りに囲まれた矩形）=====
    _initBlocks() {
      const plan = this.plan, sw = this.sidewalk;
      this.cells = [];
      const district = (x, z) => { for (const d of plan.districts) if (d.rule && rInside(x, z, d.rect)) return d.rule; return null; };
      const addCell = (kind, rect, sides, key) => {
        if (rect[2] - rect[0] < 4 || rect[3] - rect[1] < 4) return;
        const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2;
        const c = { id: this.cells.length, key, kind, rect, rule: district(cx, cz), sides };
        // 縁の向こうが車道か（塞がれていれば広場扱い）
        const m = 3;
        c.road = {
          n: sides.n && !this._inGap(cx, rect[1] - m), s: sides.s && !this._inGap(cx, rect[3] + m),
          w: sides.w && !this._inGap(rect[0] - m, cz), e: sides.e && !this._inGap(rect[2] + m, cz)
        };
        this.cells.push(c);
      };
      // マンハッタン
      const st = this.streets;
      const bands = [];
      bands.push([this.minZ, st[0].z - st[0].w / 2, false, true]);
      for (let i = 0; i < st.length - 1; i++) bands.push([st[i].z + st[i].w / 2, st[i + 1].z - st[i + 1].w / 2, true, true]);
      bands.push([st[st.length - 1].z + st[st.length - 1].w / 2, this.maxZ, true, false]);
      bands.forEach((bd, bi) => {
        const za = bd[0], zb = bd[1], zm = (za + zb) / 2;
        const aves = this.avesAt(zm);
        for (let i = 0; i < aves.length; i++) {
          const A = aves[i], x0 = A.x + A.w / 2;
          let x1;
          if (i + 1 < aves.length) x1 = aves[i + 1].x - aves[i + 1].w / 2;
          else x1 = Math.min(this.fdrWest(za), this.fdrWest(zb), this.fdrWest(zm));
          addCell('M', [x0, za, x1, zb], { n: bd[2], s: bd[3], w: true, e: true }, hash(1, bi, A.i, 0));
        }
      });
      // クイーンズ
      const qs = this.qStreets, Q = plan.queens;
      const qb = [[this.minZ, qs[0].z - qs[0].w / 2, false, true]];
      for (let i = 0; i < qs.length - 1; i++) qb.push([qs[i].z + qs[i].w / 2, qs[i + 1].z - qs[i + 1].w / 2, true, true]);
      qb.push([qs[qs.length - 1].z + qs[qs.length - 1].w / 2, this.maxZ, true, false]);
      qb.forEach((bd, bi) => {
        for (let i = 0; i < this.qAvenues.length; i++) {
          const A = this.qAvenues[i], x0 = A.x + A.w / 2;
          const x1 = i + 1 < this.qAvenues.length ? this.qAvenues[i + 1].x - this.qAvenues[i + 1].w / 2 : Q.x1;
          addCell('Q', [x0, bd[0], x1, bd[1]], { n: bd[2], s: bd[3], w: true, e: i + 1 < this.qAvenues.length }, hash(2, bi, i, 0));
        }
      });
      // ルーズベルト島
      const RI = plan.roosevelt, is = this.islands[0];
      if (RI && is) {
        const zs = RI.streetZ.slice().sort((p, q) => p - q);
        const zb = [[is.z1, zs[0] - RI.streetW / 2, false, true]];
        for (let i = 0; i < zs.length - 1; i++) zb.push([zs[i] + RI.streetW / 2, zs[i + 1] - RI.streetW / 2, true, true]);
        zb.push([zs[zs.length - 1] + RI.streetW / 2, RI.parkZ, true, false]);
        zb.forEach((bd, bi) => {
          addCell('R', [is.x0 + RI.promenade, bd[0], this.riRoad[0], bd[1]], { n: bd[2], s: bd[3], w: false, e: true }, hash(3, bi, 0, 0));
          addCell('R', [this.riRoad[2], bd[0], is.x1 - RI.promenade, bd[1]], { n: bd[2], s: bd[3], w: true, e: false }, hash(3, bi, 1, 0));
        });
      }
      // 歩道の箱から抜く所（公園・操車場・穴）
      for (const c of this.cells) {
        const holes = [];
        for (const r of this.noPlinth) if (rOverlap(c.rect, r)) holes.push(r);
        c.holes = holes;
      }
    }

    // ===== 区画（lot）=====
    _hotAt(x, z) {
      const hz = this.hotZones;
      for (let i = 0; i < hz.length; i++) { const h = hz[i], dx = x - h.x, dz = z - h.z; if (dx * dx + dz * dz <= h.r * h.r) return i; }
      return -1;
    }
    _initLots() {
      this.lots = [];
      const tz = (this.plan.landmarks || []).find((l) => l.kind === 'times_square');
      this._times = tz ? tz.params : null;
      for (const c of this.cells) this._cellLots(c);
      // ホットゾーンには入れる建物を最低 3 つ
      this.hotZones.forEach((h, hi) => {
        const near = this.lots.filter((L) => L.hot === hi && L.kind !== 'open' && L.kind !== 'parking');
        let have = near.filter((L) => L.ent).length;
        near.sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - h.x, (p.z0 + p.z1) / 2 - h.z) - Math.hypot((q.x0 + q.x1) / 2 - h.x, (q.z0 + q.z1) / 2 - h.z) || p.i - q.i);
        for (const L of near) {
          if (have >= 3) break;
          if (L.ent) continue;
          const ns = L.front === 'n' || L.front === 's';
          const Wl = ns ? L.x1 - L.x0 : L.z1 - L.z0, Dl = ns ? L.z1 - L.z0 : L.x1 - L.x0;
          if (!canEnter(Wl, Dl, 3.6, this.B)) continue;
          Object.assign(L, { kind: 'walkup', ent: true, floors: 5, fh: 3.6, mat: 'brick_brown', lobby: false, bb: false, tank: false });
          L.tiers = [[L.x0, L.z0, L.x1, L.z1, L.by, L.by + 5 * 3.6]];
          L.top = L.by + 18 + this.B.bulkhead + 0.3;
          have++;
        }
      });
    }
    _cellLots(c) {
      const rule = this.plan.rules[c.rule];
      const sw = this.sidewalk;
      const X0 = Math.ceil(c.rect[0] + sw), Z0 = Math.ceil(c.rect[1] + sw), X1 = Math.floor(c.rect[2] - sw), Z1 = Math.floor(c.rect[3] - sw);
      c.inner = [X0, Z0, X1, Z1];
      c.alley = null;
      if (!rule) return;
      const W = X1 - X0, D = Z1 - Z0;
      if (W < 8 || D < 8) return;
      const rnd = (this._rA || (this._rA = rng(0))).reset(hash(this.seed, 11, c.key, 0));
      const cellClaims = this.claims.filter((q) => rOverlap(c.rect, q.rect));
      // 長い方の軸 A に沿って区画を並べる（マンハッタンは x、ルーズベルト島などは z）
      const T = D > W * 1.3;
      const A0 = T ? Z0 : X0, A1 = T ? Z1 : X1, B0 = T ? X0 : Z0, B1 = T ? X1 : Z1, LB = B1 - B0, LA = A1 - A0;
      const fLo = T ? 'w' : 'n', fHi = T ? 'e' : 's', eLo = T ? 'n' : 'w', eHi = T ? 's' : 'e';
      let rows, alley = null;
      if (LB >= 40) {
        if (rnd() < rule.alley && LB >= 46) { const h = Math.floor((LB - 5) / 2); rows = [[B0, B0 + h, fLo], [B1 - h, B1, fHi]]; alley = [B0 + h, B1 - h]; }
        else { const h = Math.round(LB / 2); rows = [[B0, B0 + h, fLo], [B0 + h, B1, fHi]]; }
      } else rows = [[B0, B1, rnd() < 0.5 ? fLo : fHi]];
      if (alley) c.alley = T ? [alley[0], Z0, alley[1], Z1] : [X0, alley[0], X1, alley[1]];
      const raw = [];
      const put = (a0, b0, a1, b1, f) => raw.push(T ? [b0, a0, b1, a1, f] : [a0, b0, a1, b1, f]);
      let xa = A0, xb = A1;
      if (LA >= 70) {
        const e0 = rnd.int(rule.endLot[0], rule.endLot[1]), e1 = rnd.int(rule.endLot[0], rule.endLot[1]);
        xa = A0 + e0; xb = A1 - e1;
        const endRows = alley ? rows : [[B0, B1]];
        for (const r of endRows) { put(A0, r[0], xa, r[1], eLo); put(xb, r[0], A1, r[1], eHi); }
      }
      for (const r of rows) {
        let x = xa;
        while (xb - x >= 6) {
          let w = rnd.int(rule.lot[0], rule.lot[1]);
          if (xb - (x + w) < rule.lot[0]) w = xb - x;
          put(x, r[0], x + w, r[1], r[2]);
          x += w;
        }
      }
      const open = raw.map(() => rnd() < rule.open);
      const opened = [];
      for (let j = 0; j < raw.length; j++) if (open[j]) opened.push(j);
      const al = c.alley;
      for (let k = 0; k < raw.length; k++) {
        const r = raw[k];
        let x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3], front = r[4];
        let exp = SIDE_BIT[front];
        if (x0 === X0) exp |= SIDE_BIT.w;
        if (x1 === X1) exp |= SIDE_BIT.e;
        if (z0 === Z0) exp |= SIDE_BIT.n;
        if (z1 === Z1) exp |= SIDE_BIT.s;
        if (al) {
          if (T) { if (x1 === al[0]) exp |= SIDE_BIT.e; if (x0 === al[2]) exp |= SIDE_BIT.w; }
          else { if (z1 === al[1]) exp |= SIDE_BIT.s; if (z0 === al[3]) exp |= SIDE_BIT.n; }
        }
        for (const j of opened) {
          if (j === k) continue;
          const q = raw[j];
          if (q[2] === x0 && q[1] < z1 && z0 < q[3]) exp |= SIDE_BIT.w;
          if (q[0] === x1 && q[1] < z1 && z0 < q[3]) exp |= SIDE_BIT.e;
          if (q[3] === z0 && q[0] < x1 && x0 < q[2]) exp |= SIDE_BIT.n;
          if (q[1] === z1 && q[0] < x1 && x0 < q[2]) exp |= SIDE_BIT.s;
        }
        if (cellClaims.length && cellClaims.some((c2) => rOverlap([x0, z0, x1, z1], c2.rect))) continue;
        if (c.kind === 'M') {
          const band = this.bwRange(z0, z1, sw);
          if (band[0] < x1 && x0 < band[1]) {
            if ((x0 + x1) / 2 < (band[0] + band[1]) / 2) { x1 = Math.floor(band[0]); exp |= SIDE_BIT.e; }
            else { x0 = Math.ceil(band[1]); exp |= SIDE_BIT.w; }
            if (x1 - x0 < 8) continue;
            if ((front === 'e' && x1 !== r[2]) || (front === 'w' && x0 !== r[0])) front = front === 'e' ? 'w' : 'e';
          }
        }
        this._makeLot(c, rule, [x0, z0, x1, z1], front, exp, k, open[k]);
      }
    }
    // 高さの上限（districts の cap）: 区画 r の中で一番低い上限（m）。無ければ null
    _capTop(r) {
      const caps = this._caps || (this._caps = (this.plan.districts || []).filter((d) => d.cap && d.rect));
      let best = null;
      for (const d of caps) {
        if (!rOverlap(r, d.rect)) continue;
        const C = d.cap, nx = -C.dz, nz = C.dx; // 横の向き
        let dMin = Infinity, latMin = Infinity, s0 = 0;
        for (const p of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) {
          const dd = (p[0] - C.x) * C.dx + (p[1] - C.z) * C.dz, lt = (p[0] - C.x) * nx + (p[1] - C.z) * nz;
          dMin = Math.min(dMin, dd);
          if (!s0) s0 = Math.sign(lt); else if (Math.sign(lt) !== s0) latMin = 0;
          latMin = Math.min(latMin, Math.abs(lt));
        }
        const top = C.y + C.slope * Math.max(0, dMin) - C.clear + Math.max(0, latMin - (C.latFree || 0)) * (C.latSlope || 0);
        if (best === null || top < best) best = top;
      }
      return best;
    }
    _makeLot(c, rule, r, front, exp, k, open) {
      const B = this.B, M = this.M;
      const rnd = (this._rB || (this._rB = rng(0))).reset(hash(this.seed, 12, c.key, k));
      const x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3], W = x1 - x0, D = z1 - z0;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const by = this.curbH;
      const L = { id: 'L' + c.key.toString(36) + '_' + k, i: this.lots.length, x0, z0, x1, z1, front, exp, cell: c.id, hot: this._hotAt(cx, cz), by,
        seed: hash(this.seed, 13, c.key, k), kind: 'open', floors: 0, fh: 3.6, mat: 'concrete', ent: false, lobby: false, lobbyH: 0, tank: false, shed: false, bb: false, tiers: [], top: by };
      this.lots.push(L);
      if (open) return L;
      const minDim = Math.min(W, D);
      let kind = weighted(rnd, rule.mix);
      if (kind === 'tower' && minDim < B.towerMinW) kind = rule.midrise ? 'midrise' : 'walkup';
      if ((kind === 'parking' || kind === 'canopy') && (W * D < 400 || minDim < 16)) kind = rule.walkup ? 'walkup' : (rule.lowrise ? 'lowrise' : 'warehouse');
      if (kind !== 'parking' && kind !== 'canopy' && !rule[kind]) kind = Object.keys(rule.mix).find((q) => rule[q]);
      L.kind = kind;
      if (kind === 'parking') { L.top = by + 2; return L; }
      if (kind === 'canopy') { L.tiers = [[x0 + 4, z0 + 4, x1 - 4, z1 - 4, by + 5, by + 5.6]]; L.top = by + 5.6; return L; }
      const K = rule[kind];
      L.floors = rnd.int(K.floors[0], K.floors[1]);
      L.mat = rnd.pick(K.mats);
      L.fh = K.floorH || M.storey[L.mat] || 3.6;
      const ns = front === 'n' || front === 's';
      const Wl = ns ? W : D, Dl = ns ? D : W;
      const small = kind === 'walkup' || kind === 'lowrise' || kind === 'warehouse';
      let ent = small && L.floors <= B.maxEnterFloors && canEnter(Wl, Dl, L.fh, B) && rnd() < (L.hot >= 0 ? 0.75 : rule.enterable);
      if (!ent && L.hot >= 0 && !small && rnd() < 0.3 && canEnter(Wl, Dl, 3.6, B)) {
        L.kind = kind = 'walkup'; L.floors = rnd.int(4, 7); L.mat = 'brick_brown'; L.fh = 3.6; ent = true;
      }
      L.ent = ent;
      // 高さの上限（着艦の進入路）: 屋上の物（給水塔 7.8 m・階段室）の分を残して階数を減らす。1 階も入らなければ駐車場
      const capTop = this._capTop(r);
      if (capTop !== null) {
        const room = capTop - by - (ent ? B.bulkhead + 0.3 : 0) - 7.8;
        if (room < L.fh) { L.kind = 'parking'; L.floors = 0; L.ent = false; L.top = by + 2; return L; }
        L.floors = Math.min(L.floors, Math.floor(room / L.fh));
      }
      const fh = L.fh, h = L.floors * fh;
      if (!ent && kind === 'tower') {
        const pf = Math.max(2, Math.min(L.floors - 4, rnd.int(3, 8))), ph = pf * fh;
        const ins = Math.min(rnd.int(3, 6), Math.floor((minDim - 12) / 2));
        if (ins >= 2) {
          L.tiers = [[x0, z0, x1, z1, by, by + ph]];
          if (h > 150 && minDim - 2 * ins >= 24) {
            const f2 = Math.round(L.floors * 0.75) * fh;
            L.tiers.push([x0 + ins, z0 + ins, x1 - ins, z1 - ins, by + ph, by + f2]);
            L.tiers.push([x0 + ins + 3, z0 + ins + 3, x1 - ins - 3, z1 - ins - 3, by + f2, by + h]);
          } else L.tiers.push([x0 + ins, z0 + ins, x1 - ins, z1 - ins, by + ph, by + h]);
        } else L.tiers = [[x0, z0, x1, z1, by, by + h]];
      } else if (!ent && kind === 'midrise' && h > B.setbackMinH && minDim >= 16 && rnd() < 0.5) {
        const f1 = Math.round(L.floors * 0.7) * fh, ins = rnd.int(2, 3);
        L.tiers = [[x0, z0, x1, z1, by, by + f1], [x0 + ins, z0 + ins, x1 - ins, z1 - ins, by + f1, by + h]];
      } else L.tiers = [[x0, z0, x1, z1, by, by + h]];
      if (!ent && (kind === 'tower' || kind === 'midrise') && minDim >= 14 && rnd() < rule.lobby) {
        L.lobbyH = fh * Math.ceil(4.5 / fh);
        if (L.tiers[0][5] - L.tiers[0][4] > L.lobbyH + fh) L.lobby = true; else L.lobbyH = 0;
      }
      L.tank = kind !== 'tower' && L.mat.indexOf('brick') === 0 && rnd() < rule.tank;
      L.shed = rnd() < rule.shed;
      const T = this._times;
      if (T && !ent && Math.hypot(cx - T.center[0], cz - T.center[1]) < T.billboardR &&
          (this.onBroadway(cx, cz, Math.max(W, D) / 2 + 22) || Math.abs(cx - T.center[0]) < W / 2 + 26)) L.bb = true;
      L.top = L.tiers[L.tiers.length - 1][5] + (ent ? B.bulkhead + 0.3 : 0) + (L.tank ? 7.8 : 1.4);
      return L;
    }

    // ===== 乗り物 =====
    _initVehicles() {
      const V = this.plan.vehicles || {};
      this.vehicles = [];
      // ヘリポートのヘリ。spawn [x, z, yaw, y] があればそこに置く（y が無ければパッドの高さ）。空母のヘリは甲板に置かない: パッドは着艦の場所の中、
      //  ほかの甲板は駐機場所・誘導路・艦橋の横の通り道（回転翼 直径 10.7 m は艦橋と着艦の場所の間をふさぐ）なので、隣の桟橋（46 丁目、階段塔から歩いて行ける）に置く
      if (V.heli) for (const h of this.helipads) {
        const sp = Array.isArray(h.spawn) ? h.spawn : null;
        this.vehicles.push({ id: 'h_' + h.id, type: 'heli', x: sp ? sp[0] : h.x, y: sp && sp.length > 3 ? sp[3] : h.y, z: sp ? sp[1] : h.z, yaw: sp && sp.length > 2 ? sp[2] : (hash(this.seed, 21, strHash(h.id), 0) % 8) * 45 });
      }
      for (const c of this.cells) {
        const cx = (c.rect[0] + c.rect[2]) / 2, cz = (c.rect[1] + c.rect[3]) / 2;
        let dh = Infinity;
        for (const h of this.hotZones) dh = Math.min(dh, Math.hypot(cx - h.x, cz - h.z) - h.r);
        const p = dh < V.hotRange ? V.nearHot : V.elsewhere;
        const rnd = rng(hash(this.seed, 22, c.key, 0));
        if (rnd() >= p) continue;
        const sides = [];
        if (c.road.n) sides.push('n');
        if (c.road.s) sides.push('s');
        const len = c.rect[2] - c.rect[0];
        if (!sides.length || len < 30) continue;
        const sd = rnd.pick(sides);
        const x = c.rect[0] + rnd.range(12, len - 12);
        const z = sd === 'n' ? c.rect[1] - 2.4 : c.rect[3] + 2.4;
        if (!this.isLand(x, z) || this._inGap(x, z) || this._claimed([x - 4, z - 4, x + 4, z + 4])) continue;
        const type = weighted(rnd, V.mix);
        this.vehicles.push({ id: 'v' + this.vehicles.length, type, x: r2(x), y: 0, z: r2(z), yaw: rnd() < 0.5 ? 90 : 270 });
      }
      // 空母の戦闘機（j_1..j_4）は最後に足す（車・ヘリの番号を変えない。オンラインのサーバーの番号も同じ順）
      this.carrierOps = this._carrierOps();
      if (V.jets && this.carrierOps) this.carrierOps.jetSpots.forEach((s, k) => this.vehicles.push({ id: 'j_' + (k + 1), type: 'jet', x: s.x, y: s.y, z: s.z, yaw: s.yaw }));
    }
    vehicleSpawns() { return this.vehicles; }

    // 空母の発着の場所（landmarks の carrier の params.flight。ローカル: 艦首 +Z・左舷 +X・甲板 deckTop）→ 世界の座標と向き（度。前 = (sin, cos)）。
    //   jetSpots [{ x, y, z, yaw }]、cats [{ x, y, z, yaw, length, fx, fz, endX, endZ }]（射出の始点 → 艦首の縁）、lanes [{ cat, pts [{ x, z }] }]（誘導路）、
    //   landing { x, y, z, yaw, fx, fz, rx, rz（右舷向き）, length（接地点 → 甲板の端）, wires [{ x, z, d }], wireHalfWidth, rampDist,
    //   halfWidthStbd, halfWidthPort }、jbd [[x0, z0, x1, z1, yTop]]（ジェットブラストデフレクター。戦闘機は乗り越える）、deckY、
    //   box { x0, z0, x1, z1 }（甲板の外形の囲み）。無ければ null
    _carrierOps() {
      const lm = (this.plan.landmarks || []).find((l) => l.kind === 'carrier');
      const p = lm && lm.params, fl = p && p.flight;
      if (!fl) return null;
      const th = p.yaw * Math.PI / 180, c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
      const wx = (x, z) => p.x + x * c + z * sn, wz = (x, z) => p.z - x * sn + z * c;
      const deckY = this.waterY + p.deckTop;
      const head = (h) => r2(((h + p.yaw) % 360 + 540) % 360 - 180);
      const dir = (h) => { const a = (h + p.yaw) * Math.PI / 180; return { fx: r2(Math.sin(a) * 1e4) / 1e4, fz: r2(Math.cos(a) * 1e4) / 1e4 }; };
      const jetSpots = (fl.jetSpots || []).map((s) => ({ x: r2(wx(s[0], s[1])), y: deckY, z: r2(wz(s[0], s[1])), yaw: head(s[2]) }));
      const cats = (fl.cats || []).map((s, k) => {
        const d = dir(s[2]), x = wx(s[0], s[1]), z = wz(s[0], s[1]);
        return { id: k + 1, x: r2(x), y: deckY, z: r2(z), yaw: head(s[2]), length: s[3], fx: d.fx, fz: d.fz, endX: r2(x + d.fx * s[3]), endZ: r2(z + d.fz * s[3]) };
      });
      const L = fl.landing, ld = dir(L.heading), lx = wx(L.x, L.z), lz = wz(L.x, L.z);
      const landing = Object.assign({}, L, { x: r2(lx), y: deckY, z: r2(lz), yaw: head(L.heading), fx: ld.fx, fz: ld.fz, rx: -ld.fz, rz: ld.fx,
        wires: (L.wires || []).map((d) => ({ d, x: r2(lx + ld.fx * d), z: r2(lz + ld.fz * d) })) });
      const jbd = (p.jbd || []).map((j) => { const a = [wx(j[0], j[2]), wx(j[1], j[3])], b = [wz(j[0], j[2]), wz(j[1], j[3])]; return [Math.min(a[0], a[1]), Math.min(b[0], b[1]), Math.max(a[0], a[1]), Math.max(b[0], b[1]), deckY + j[4]]; });
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const d of this._carrierDeck(p)) for (const [xx, zz] of [[d[0], d[1]], [d[2], d[3]]]) { const X = wx(xx, zz), Z = wz(xx, zz); x0 = Math.min(x0, X); x1 = Math.max(x1, X); z0 = Math.min(z0, Z); z1 = Math.max(z1, Z); }
      // 甲板の誘導路（自動の地上滑走・案内の線）: flight.lanes [{ cat, pts: [[x, z], ...] }]（ローカル）→ 世界の点の列（最後がカタパルトの始点）
      const lanes = (fl.lanes || []).map((ln) => ({ cat: ln.cat, pts: ln.pts.map((q) => ({ x: r2(wx(q[0], q[1])), z: r2(wz(q[0], q[1])) })) }));
      return { deckY, jetSpots, cats, landing, jbd, lanes, box: { x0, z0, x1, z1 } };
    }

    // 空母の飛行甲板の床の箱（ローカル [x0, z0, x1, z1]）: params.deckOutline（landmarks2 の CV_OUT と同じ外形。凸）を z の帯に切った箱
    //   （帯の中の縁の x のずれが deckStrip m 以下になる幅で切り、帯の真ん中の x を使う = 見えている甲板との差は deckStrip m まで）+ params.deck
    //   （外形の外の床: 右舷のエレベーター）。外形が無ければ params.deck だけ
    _carrierDeck(p) {
      if (p._deckBoxes) return p._deckBoxes;
      const out = (p.deck || []).slice(), P = p.deckOutline;
      if (P && P.length > 2) {
        const err = p.deckStrip || 0.25;
        // z ごとの [左, 右] の x（凸の外形を水平の線で切る）
        const span = (z) => {
          let a = Infinity, b = -Infinity;
          for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
            const A = P[i], B = P[j];
            if ((A[1] - z) * (B[1] - z) > 0 || A[1] === B[1]) continue;
            const x = A[0] + (B[0] - A[0]) * (z - A[1]) / (B[1] - A[1]);
            a = Math.min(a, x); b = Math.max(b, x);
          }
          return [a, b];
        };
        const zs = Array.from(new Set(P.map((q) => q[1]))).sort((u, v) => u - v);
        for (let k = 0; k + 1 < zs.length; k++) {
          const za = zs[k], zb = zs[k + 1], e = 1e-6, s0 = span(za + e), s1 = span(zb - e);
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(s1[0] - s0[0]), Math.abs(s1[1] - s0[1])) / (2 * err)));
          for (let i = 0; i < n; i++) {
            const z0 = za + (zb - za) * i / n, z1 = za + (zb - za) * (i + 1) / n, m = span((z0 + z1) / 2);
            out.push([r2(m[0]), r2(z0), r2(m[1]), r2(z1)]);
          }
        }
      }
      Object.defineProperty(p, '_deckBoxes', { value: out, enumerable: false });
      return out;
    }

    // ===== チャンクの索引 =====
    _crange(x0, z0, x1, z1) {
      const cs = this.cs;
      return [Math.max(0, Math.floor((x0 - this.minX) / cs)), Math.max(0, Math.floor((z0 - this.minZ) / cs)),
        Math.min(this.ncx - 1, Math.floor((x1 - this.minX) / cs)), Math.min(this.ncz - 1, Math.floor((z1 - this.minZ) / cs))];
    }
    _ci(x, z) {
      const cx = Math.floor((x - this.minX) / this.cs), cz = Math.floor((z - this.minZ) / this.cs);
      if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) return -1;
      return cz * this.ncx + cx;
    }
    // 車道の索引（矩形は重なるチャンクすべて、斜めの四角形は中心のチャンク）
    _indexRoads() {
      const N = this.ncx * this.ncz;
      this.ixRoadsX = new Array(N);
      this.ixRoads = new Array(N);
      for (let i = 0; i < N; i++) this.ixRoads[i] = [];
      for (const rd of this.roads) {
        if (rd.rect) {
          const q = this._crange(rd.rect[0], rd.rect[1], rd.rect[2], rd.rect[3]);
          for (let cz = q[1]; cz <= q[3]; cz++) for (let cx = q[0]; cx <= q[2]; cx++) this.ixRoads[cz * this.ncx + cx].push(rd.id);
        } else {
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (const p of rd.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
          rd.bb = [x0, z0, x1, z1];
          const ci = this._ci((rd.pts[0][0] + rd.pts[2][0]) / 2, (rd.pts[0][1] + rd.pts[2][1]) / 2);
          if (ci >= 0) this.ixRoads[ci].push(rd.id);
          // 当たり判定用には重なるチャンクすべて（描画は中心のチャンクだけ）
          const q = this._crange(x0, z0, x1, z1);
          for (let cz = q[1]; cz <= q[3]; cz++) for (let cx = q[0]; cx <= q[2]; cx++) { const k = cz * this.ncx + cx; if (k !== ci) (this.ixRoadsX[k] || (this.ixRoadsX[k] = [])).push(rd.id); }
        }
      }
    }
    _initIndex() {
      const N = this.ncx * this.ncz;
      const mk = () => { const a = new Array(N); for (let i = 0; i < N; i++) a[i] = []; return a; };
      this.ixLots = mk(); this.ixCells = mk(); this.ixInters = mk(); this.ixVeh = mk(); this.ixParks = mk(); this.ixLakes = mk();
      const span = (list, i, r) => {
        const q = this._crange(r[0], r[1], r[2], r[3]);
        for (let cz = q[1]; cz <= q[3]; cz++) for (let cx = q[0]; cx <= q[2]; cx++) list[cz * this.ncx + cx].push(i);
      };
      for (const L of this.lots) { const ci = this._ci((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2); if (ci >= 0) this.ixLots[ci].push(L.i); }
      for (const c of this.cells) span(this.ixCells, c.id, [c.rect[0] - 4, c.rect[1] - 4, c.rect[2] + 4, c.rect[3] + 4]);
      for (const it of this.inters) { const ci = this._ci(it.x, it.z); if (ci >= 0) this.ixInters[ci].push(it.id); }
      this.vehicles.forEach((v, i) => { const ci = this._ci(v.x, v.z); if (ci >= 0) this.ixVeh[ci].push(i); });
      (this.plan.parks || []).forEach((p, i) => span(this.ixParks, i, p.rect));
      this.lakes.forEach((l, i) => span(this.ixLakes, i, l.bb));
    }

    // ===== 支えの高さ（サーバー用、32 m 格子）=====
    _initSupport() {
      const S = 32, nx = Math.ceil((this.maxX - this.minX) / S), nz = Math.ceil((this.maxZ - this.minZ) / S);
      this._supS = S; this._supNx = nx; this._supNz = nz;
      this._sup = new Array(nx * nz);
      const add = (r, e) => {
        const i0 = Math.max(0, Math.floor((r[0] - this.minX) / S)), i1 = Math.min(nx - 1, Math.floor((r[2] - this.minX) / S));
        const j0 = Math.max(0, Math.floor((r[1] - this.minZ) / S)), j1 = Math.min(nz - 1, Math.floor((r[3] - this.minZ) / S));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; (this._sup[k] || (this._sup[k] = [])).push(e); }
      };
      for (const L of this.lots) {
        const n = L.tiers.length;
        for (let t = 0; t < n; t++) {
          const q = L.tiers[t];
          add(q, { r: [q[0], q[1], q[2], q[3]], y: q[5] + (t === n - 1 ? L.top - q[5] : 1.2) });
        }
        if (L.kind === 'parking') add([L.x0, L.z0, L.x1, L.z1], { r: [L.x0, L.z0, L.x1, L.z1], y: L.top });
      }
      for (const b of this.staticItems.boxes) {
        if (!(b.f & F.WALK) || (b.f & F.NOCOL) || b.y + b.h < 1) continue;
        const r = [b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2];
        add(r, { r, y: b.y + b.h });
      }
      for (const p of this.staticItems.ramps) {
        const r = [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2];
        add(r, { r, ramp: p });
      }
    }
    // (x, z) で一番高い立てる面の上限（屋上・橋・甲板・地面）。入れる建物は屋上 + 階段室 + タンクの余裕を含む
    supportHeightAt(x, z) {
      if (!this._sup) this._initSupport();
      let y = this.groundY(x, z);
      const S = this._supS;
      const i = Math.floor((x - this.minX) / S), j = Math.floor((z - this.minZ) / S);
      if (i < 0 || j < 0 || i >= this._supNx || j >= this._supNz) return y;
      const list = this._sup[j * this._supNx + i];
      if (!list) return y;
      for (const e of list) {
        if (x < e.r[0] || x > e.r[2] || z < e.r[1] || z > e.r[3]) continue;
        if (e.ramp) y = Math.max(y, rampSurface(e.ramp, x, z));
        else if (e.y > y) y = e.y;
      }
      return y;
    }

    // ===== 静的なもの（ランドマーク・桟橋・岸・公園の枠）: 一度だけ作り、部品の中心でチャンクに振り分ける =====
    _initStatic() {
      const E = new Emitter(true);
      this._genPiers(E);
      this._genShore(E);
      this._genMedian(E);
      for (const r of this.gapFill) for (const q of rectMinus(r, this.noPlinth)) if (rValid(q, 0.3)) E.box(q[0], 0, q[1], q[2], this.curbH, q[3], 'sidewalk', 'sidewalk', F.WALK);
      for (const p of this.plan.parks || []) this._genParkFrame(E, p);
      for (const lm of this.plan.landmarks || []) {
        const fn = this['_lm_' + lm.kind];
        if (fn) fn.call(this, E, lm.params, lm);
      }
      for (const h of this.helipads) {
        // パッドの外の置き場所（spawn [x, z, yaw, y]）には H の印だけ（空母のヘリの桟橋。heliport_pad の模型は 35 m 幅で桟橋に入らない）
        if (Array.isArray(h.spawn) && h.spawn.length > 3) E.decal({ type: 'helipad', x: h.spawn[0], z: h.spawn[1], w: 14, d: 14, rot: 0, y: h.spawn[3] });
        if (h.id === 'h_tower' || h.id === 'h_carrier') continue;
        const pier = this.piers.find((q) => rInside(h.x, h.z, q.rect));
        if (pier && Math.abs(h.y) < 0.01) {
          // heliport_pad の入口（ローカル −Z）を岸へ向ける
          const toE = this.isLand(pier.rect[2] + 4, h.z) && !this.isLand(pier.rect[0] - 4, h.z);
          E.place('heliport_pad', 'landmarks2', h.x, h.y, h.z, toE ? -Math.PI / 2 : Math.PI / 2);
        } else E.decal({ type: 'helipad', x: h.x, z: h.z, w: h.r * 2, d: h.r * 2, rot: 0, y: h.y });
      }
      this._validateStaticLoot(E);
      this._staticE = E;
      const N = this.ncx * this.ncz;
      this._sb = new Array(N);
      const put = (type, it, x, z) => {
        const ci = this._ci(x, z);
        if (ci < 0) return;
        const b = this._sb[ci] || (this._sb[ci] = { boxes: [], ramps: [], ladders: [], props: [], loot: [], decals: [], water: [], landmarks: [], buildings: [], ground: [], roads: [] });
        b[type].push(it);
      };
      for (const it of E.boxes) put('boxes', it, it.x, it.z);
      for (const it of E.ramps) put('ramps', it, it.x, it.z);
      for (const it of E.ladders) put('ladders', it, it.x, it.z);
      for (const it of E.props) put('props', it, it.x, it.z);
      for (const it of E.loot) put('loot', it, it.x, it.z);
      for (const it of E.decals) put('decals', it, it.x, it.z);
      for (const it of E.landmarks) put('landmarks', it, it.x, it.z);
      for (const it of E.buildings) put('buildings', it, (it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2);
      for (const it of E.ground) put('ground', it, (it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2);
      for (const it of E.water) put('water', it, (it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2);
      for (const it of E.roads) put('roads', it, (it.pts[0][0] + it.pts[2][0]) / 2, (it.pts[0][1] + it.pts[2][1]) / 2);
      // 静的なものの外形（遠景用）
      this._staticSil = E.boxes.filter((b) => !(b.f & F.NOCOL) && (b.cat === 'landmark' || b.cat === 'exterior' || b.cat === 'roof' || b.cat === 'road' || b.cat === 'pier') &&
        Math.max(b.w, b.d) >= 12 && b.h >= 2);
    }
    // (x, z) が車道（ブロードウェイの歩行者天国・公園の道は除く）の上か。m だけ広げて見る
    _onCarriageway(x, z, m) {
      m = m || 0;
      const ci = this._ci(x, z);
      if (ci < 0) return false;
      const near = (pts) => { // 凸四角形との距離 ≤ m
        if (pointInPoly(x, z, pts)) return true;
        return m > 0 && distToPoly(x, z, pts) <= m;
      };
      const ids = this.ixRoadsX[ci] ? this.ixRoads[ci].concat(this.ixRoadsX[ci]) : this.ixRoads[ci];
      for (const id of ids) {
        const rd = this.roads[id];
        if (rd.kind === 'plaza') continue;
        if (rd.rect) { if (x > rd.rect[0] - m && x < rd.rect[2] + m && z > rd.rect[1] - m && z < rd.rect[3] + m) return true; }
        else if (near(rd.pts)) return true;
      }
      if (this.onBroadway(x, z, m) && !this._bwIsPlaza(z)) return true;
      return false;
    }
    // 静的な戦利品のうち、箱にめり込む・浮く・車道の上のものを捨てる（ランドマークの配置は乱数なので最後に確かめる）
    _validateStaticLoot(E) {
      const S = 16, grid = new Map();
      for (const b of E.boxes) {
        if (b.f & F.NOCOL) continue;
        const i0 = Math.floor((b.x - b.w / 2 - 1) / S), i1 = Math.floor((b.x + b.w / 2 + 1) / S), j0 = Math.floor((b.z - b.d / 2 - 1) / S), j1 = Math.floor((b.z + b.d / 2 + 1) / S);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 100000 + j; let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(b); }
      }
      E.loot = E.loot.filter((l) => {
        const a = grid.get(Math.floor(l.x / S) * 100000 + Math.floor(l.z / S)) || [];
        let support = this.groundY(l.x, l.z);
        for (const b of a) if ((b.f & F.WALK) && Math.abs(l.x - b.x) <= b.w / 2 && Math.abs(l.z - b.z) <= b.d / 2 && b.y + b.h <= l.y + 0.3) support = Math.max(support, b.y + b.h);
        for (const r of E.ramps) if (Math.abs(l.x - r.x) <= r.w / 2 + 0.6 && Math.abs(l.z - r.z) <= r.d / 2 + 0.6) return false;
        if (Math.abs(support - l.y) > 0.02) return false;
        for (const b of a) {
          if (Math.abs(l.x - b.x) > b.w / 2 + 0.6 || Math.abs(l.z - b.z) > b.d / 2 + 0.6) continue;
          if (b.y + b.h > l.y + 0.3 && b.y < l.y + 1.8) return false;
        }
        return l.y > 0.5 || !this._onCarriageway(l.x, l.z, 0.5);
      });
    }
    // 長い矩形を max m 以下に切る
    _split(r, max) {
      const out = [], nx = Math.max(1, Math.ceil((r[2] - r[0]) / max)), nz = Math.max(1, Math.ceil((r[3] - r[1]) / max));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        out.push([r[0] + (r[2] - r[0]) * i / nx, r[1] + (r[3] - r[1]) * j / nz, r[0] + (r[2] - r[0]) * (i + 1) / nx, r[1] + (r[3] - r[1]) * (j + 1) / nz]);
      }
      return out;
    }
    _roadRect(E, kind, r, mat) { for (const q of this._split(r, 64)) E.road(kind, [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]], mat); }
    _groundRect(E, r, mat) { for (const q of this._split(r, 64)) E.groundRect(q[0], q[1], q[2], q[3], mat); }
    _rail(E, x0, z0, x1, z1, y, h, cat) { E.box(x0, y, z0, x1, y + (h || 1.1), z1, 'metalDark', cat || 'pier', F.NOLOS); }
    _kept(x, z, m) { for (const k of this.keepouts) if (Math.hypot(x - k[0], z - k[1]) < k[2] + (m || 0)) return true; return false; }
    _tree(E, x, y, z, rot) {
      E.prop('tree', x, y, z, rot);
      E.box(x - 0.16, y, z - 0.16, x + 0.16, y + 3.2, z + 0.16, 'crate', 'prop', 0);
    }
    _lamp(E, type, x, y, z, rot) {
      E.prop(type, x, y, z, rot);
      const r = type === 'park_lamp' ? 0.14 : 0.18;
      E.box(x - r, y, z - r, x + r, y + (type === 'park_lamp' ? 4 : 8.4), z + r, 'metalDark', 'prop', 0);
    }

    _genPiers(E) {
      for (const p of this.piers) {
        const r = p.rect, cz = (r[1] + r[3]) / 2;
        const landE = this.isLand(r[2] + 3, cz) && !this.isLand(r[0] - 1, cz);
        if (p.road) {
          E.box(r[0], -1, r[1], r[2], 0, r[3], 'asphalt_city', 'road', F.WALK);
          E.box(r[0], 0, r[1], r[2], 1.1, r[1] + 0.3, 'concrete', 'road', 0);
          E.box(r[0], 0, r[3] - 0.3, r[2], 1.1, r[3], 'concrete', 'road', 0);
          this._roadRect(E, 'bridge', [r[0], r[1] + 0.3, r[2], r[3] - 0.3], 'asphalt_city');
          continue;
        }
        E.box(r[0], -1.2, r[1], r[2], 0, r[3], p.mat, 'pier', F.WALK);
        const xa = landE ? r[0] : r[0] + 4, xb = landE ? r[2] - 4 : r[2];
        this._rail(E, xa, r[1], xb, r[1] + 0.15, 0);
        this._rail(E, xa, r[3] - 0.15, xb, r[3], 0);
        if (landE) this._rail(E, r[0], r[1] + 0.15, r[0] + 0.15, r[3] - 0.15, 0);
        else this._rail(E, r[2] - 0.15, r[1] + 0.15, r[2], r[3] - 0.15, 0);
        for (let x = r[0] + 12; x < r[2] - 8; x += 40) {
          if (this._kept(x, r[1] + 1)) continue;
          this._lamp(E, 'park_lamp', x, 0, r[1] + 1.2, 0);
          this._lamp(E, 'park_lamp', x, 0, r[3] - 1.2, Math.PI);
        }
      }
    }
    _pierGapsZ(xLine) { // 岸線 x 付近に陸側の端がある桟橋の z 範囲
      const g = [];
      for (const p of this.piers) if (Math.min(Math.abs(p.rect[0] - xLine), Math.abs(p.rect[2] - xLine)) < 12) g.push([p.rect[1] - 1, p.rect[3] + 1]);
      return g;
    }
    _railAlongZ(E, x0, x1, z0, z1, gaps, y) {
      const cuts = gaps.filter((q) => q[1] > z0 && q[0] < z1).sort((p, q) => p[0] - q[0]);
      let z = z0;
      for (const q of cuts) { if (q[0] > z) this._rail(E, x0, z, x1, q[0], y); z = Math.max(z, q[1]); }
      if (z < z1) this._rail(E, x0, z, x1, z1, y);
    }
    _genShore(E) {
      const ch = this.curbH, step = 20;
      const seawall = (x0, z0, x1, z1) => E.waterItem({ type: 'seawall', x0: r2(x0), z0: r2(z0), x1: r2(x1), z1: r2(z1) }, (x0 + x1) / 2, (z0 + z1) / 2);
      // 西（ハドソン）: 12 番街の西端から岸まで
      const ave12 = this.avenues[0];
      const xw = interp(this.shoreW, 0), xe = ave12.x - ave12.w / 2;
      E.box(xw, 0, this.minZ, xe, ch, this.maxZ, 'sidewalk', 'sidewalk', F.WALK);
      const wg = this._pierGapsZ(xw);
      this._railAlongZ(E, xw, xw + 0.15, this.minZ, this.maxZ, wg, ch);
      for (let z = this.minZ + 8; z < this.maxZ - 8; z += 14) {
        if (wg.some((q) => z > q[0] - 4 && z < q[1] + 4) || this._kept(xw + 12, z)) continue;
        this._tree(E, xw + 12, ch, z, (z * 7) % 6);
      }
      for (let z = this.minZ + 15; z < this.maxZ - 8; z += 28) if (!this._kept(xe - 2, z)) this._lamp(E, 'park_lamp', xe - 2, ch, z, 0);
      for (let z = this.minZ; z < this.maxZ; z += 64) seawall(xw, z, xw, Math.min(this.maxZ, z + 64));
      // 東（イースト川・マンハッタン側）: FDR の東端から岸まで（20 m ごとの段）
      const eg = [];
      for (const p of this.piers) if (p.rect[0] > 600 && p.rect[0] < 800) eg.push([p.rect[1] - 1, p.rect[3] + 1]);
      for (let z = this.minZ; z < this.maxZ; z += step) {
        const zb = Math.min(this.maxZ, z + step);
        const xs = Math.min(this.eastShoreX(z), this.eastShoreX(zb)), xf = Math.max(this.fdrEast(z), this.fdrEast(zb));
        if (xs - xf > 1) E.box(xf, 0, z, xs, ch, zb, 'sidewalk', 'sidewalk', F.WALK);
        this._railAlongZ(E, xs - 0.15, xs, z, zb, eg, ch);
        seawall(this.eastShoreX(z), z, this.eastShoreX(zb), zb);
        if ((z / step) % 2 === 0 && !eg.some((q) => z > q[0] - 4 && z < q[1] + 4) && !this._kept(xs - 3, z + 10)) this._lamp(E, 'park_lamp', xs - 3, ch, z + 10, -Math.PI / 2);
      }
      // クイーンズ側: 岸から Vernon の西端まで（LIC の公園を除く）
      const qa = this.qAvenues[0], qx = interp(this.shoreQ, 0), qe = qa.x - qa.w / 2;
      const lic = (this.plan.parks || []).filter((p) => p.rect[0] >= qx - 1 && p.rect[2] <= qe + 1).map((p) => p.rect);
      for (const q of rectMinus([qx, this.minZ, qe, this.maxZ], lic)) E.box(q[0], 0, q[1], q[2], ch, q[3], 'sidewalk', 'sidewalk', F.WALK);
      const qg = this._pierGapsZ(qx);
      this._railAlongZ(E, qx, qx + 0.15, this.minZ, this.maxZ, qg, ch);
      for (let z = this.minZ + 8; z < this.maxZ - 8; z += 16) {
        if (lic.some((r) => z > r[1] - 2 && z < r[3] + 2) || qg.some((q) => z > q[0] - 4 && z < q[1] + 4)) continue;
        this._tree(E, qx + 14, ch, z, (z * 3) % 6);
      }
      for (let z = this.minZ; z < this.maxZ; z += 64) seawall(qx, z, qx, Math.min(this.maxZ, z + 64));
      // ルーズベルト島の遊歩道（島の縁）
      const is = this.islands[0], RI = this.plan.roosevelt;
      if (is && RI) {
        const zt = is.zTip - is.tipR, pr = RI.promenade;
        E.box(is.x0, 0, is.z1, is.x0 + pr, ch, RI.parkZ, 'sidewalk', 'sidewalk', F.WALK);
        E.box(is.x1 - pr, 0, is.z1, is.x1, ch, RI.parkZ, 'sidewalk', 'sidewalk', F.WALK);
        const rg = this._pierGapsZ(is.x1);
        this._railAlongZ(E, is.x0, is.x0 + 0.15, is.z1, zt, [], ch);
        this._railAlongZ(E, is.x1 - 0.15, is.x1, is.z1, zt, rg, ch);
        for (let z = is.z1; z < zt; z += 64) { seawall(is.x0, z, is.x0, Math.min(zt, z + 64)); seawall(is.x1, z, is.x1, Math.min(zt, z + 64)); }
        const cx = (is.x0 + is.x1) / 2;
        for (let i = 0; i < 12; i++) {
          const a0 = Math.PI * i / 12, a1 = Math.PI * (i + 1) / 12;
          seawall(cx - Math.cos(a0) * is.tipR, zt + Math.sin(a0) * is.tipR, cx - Math.cos(a1) * is.tipR, zt + Math.sin(a1) * is.tipR);
        }
      }
    }
    _genMedian(E) {
      const vi = (this.plan.landmarks || []).find((l) => l.kind === 'viaduct');
      const skip = vi ? [vi.params.north[0] - 12, vi.params.south[1] + 12] : [0, 0];
      const pa = this.avenues.find((a) => a.median > 0);
      if (!pa) return;
      const hw = pa.median / 2;
      for (let i = 0; i < this.streets.length - 1; i++) {
        const za = this.streets[i].z + this.streets[i].w / 2 + 3, zb = this.streets[i + 1].z - this.streets[i + 1].w / 2 - 3;
        if (zb - za < 8 || (zb > skip[0] && za < skip[1]) || this._inGap(pa.x, (za + zb) / 2)) continue;
        E.box(pa.x - hw, 0, za, pa.x + hw, 0.5, zb, 'concrete', 'road', F.WALK, 'grass');
      }
    }
    _genParkFrame(E, p) {
      const r = p.rect, sw = this.sidewalk, ch = this.curbH;
      const land = (x, z) => this.isLand(x, z);
      const strip = (q) => { for (const s of this._split(q, 8)) if (land((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)) E.box(s[0], 0, s[1], s[2], ch, s[3], 'sidewalk', 'sidewalk', F.WALK); };
      const ringBoxes = [[r[0], r[1], r[2], r[1] + sw], [r[0], r[3] - sw, r[2], r[3]], [r[0], r[1] + sw, r[0] + sw, r[3] - sw], [r[2] - sw, r[1] + sw, r[2], r[3] - sw]];
      if (p.kind === 'central') {
        for (const q of ringBoxes) {
          if (q[1] <= this.minZ + 1 && q[3] - q[1] < sw + 1) continue;
          E.box(q[0], 0, q[1], q[2], ch, q[3], 'sidewalk', 'sidewalk', F.WALK);
        }
        // 石垣（80 m ごとに入口）
        const wt = 0.5, wh = p.wall || 0.8, x0 = r[0] + sw, x1 = r[2] - sw, z1 = r[3] - sw;
        const wallX = (x, za, zb) => { for (let z = za; z < zb; z += 80) E.box(x - wt / 2, 0, z + 3, x + wt / 2, wh, Math.min(zb, z + 77), 'limestone', 'landmark', F.WALK); };
        wallX(x0, r[1] + 1, z1);
        wallX(x1, r[1] + 1, z1);
        for (let x = x0; x < x1; x += 80) E.box(x + 3, 0, z1 - wt / 2, Math.min(x1, x + 77), wh, z1 + wt / 2, 'limestone', 'landmark', F.WALK);
        const d = p.drive;
        if (d) {
          const hw = d.w / 2;
          this._roadRect(E, 'park_drive', [d.x[0] - hw, d.z[1], d.x[0] + hw, d.z[0] + hw]);
          this._roadRect(E, 'park_drive', [d.x[1] - hw, d.z[1], d.x[1] + hw, d.z[0] + hw]);
          this._roadRect(E, 'park_drive', [d.x[0] + hw, d.z[0] - hw, d.x[1] - hw, d.z[0] + hw]);
          this._roadRect(E, 'park_drive', [d.x[0] + hw, d.z[1] - hw, d.x[1] - hw, d.z[1] + hw]);
        }
        // 小道。湖を横切る所は橋（ボウブリッジ）にする
        for (const q of p.paths || []) {
          const cuts = [];
          for (const l of this.lakes) {
            const c = rInter(q, l.bb);
            if (!rValid(c)) continue;
            cuts.push(c);
            const alongX = q[2] - q[0] > q[3] - q[1];
            E.box(c[0], -0.6, c[1], c[2], 0.25, c[3], 'stair_stone', 'landmark', F.WALK);
            if (alongX) { E.box(c[0], 0.25, c[1] - 0.25, c[2], 1.25, c[1], 'stair_stone', 'landmark', 0); E.box(c[0], 0.25, c[3], c[2], 1.25, c[3] + 0.25, 'stair_stone', 'landmark', 0); }
            else { E.box(c[0] - 0.25, 0.25, c[1], c[0], 1.25, c[3], 'stair_stone', 'landmark', 0); E.box(c[2], 0.25, c[1], c[2] + 0.25, 1.25, c[3], 'stair_stone', 'landmark', 0); }
          }
          for (const g of rectMinus(q, cuts)) this._groundRect(E, g, 'sidewalk');
        }
        return;
      }
      for (const q of ringBoxes) strip(q);
      const lw = p.lawn;
      if (lw) this._groundRect(E, lw, 'grass');
      const inner = [r[0] + sw, r[1] + sw, r[2] - sw, r[3] - sw];
      for (const q of rectMinus(inner, lw ? [lw] : [])) this._groundRect(E, q, 'sidewalk');
      if (!lw) return;
      const hot = this._hotAt((r[0] + r[2]) / 2, (r[1] + r[3]) / 2) >= 0;
      // 芝生のまわりに並木・街灯・ベンチ
      const ring = (off, every, fn) => {
        const q = [lw[0] - off, lw[1] - off, lw[2] + off, lw[3] + off];
        for (let x = q[0]; x <= q[2] + 0.01; x += every) { fn(x, q[1], 0); fn(x, q[3], Math.PI); }
        for (let z = q[1] + every; z <= q[3] - every + 0.01; z += every) { fn(q[0], z, Math.PI / 2); fn(q[2], z, -Math.PI / 2); }
      };
      const ok = (x, z) => land(x, z) && rInside(x, z, inner) && !this._kept(x, z) && !this.isWater(x, z);
      for (let k = 0; k < (p.treeRows || 0); k++) ring(4 + k * 5, 9, (x, z, rot) => { if (ok(x, z)) this._tree(E, x, 0, z, rot); });
      ring(1.8, 22, (x, z, rot) => { if (ok(x, z)) this._lamp(E, 'park_lamp', x, 0, z, rot); });
      ring(2.6, 17, (x, z, rot) => {
        if (!ok(x, z)) return;
        E.prop('bench', x, 0, z, rot + Math.PI);
        const along = Math.abs(Math.sin(rot)) < 0.5;
        if (along) E.box(x - 0.92, 0, z - 0.3, x + 0.92, 0.5, z + 0.3, 'crate', 'prop', F.WALK);
        else E.box(x - 0.3, 0, z - 0.92, x + 0.3, 0.5, z + 0.92, 'crate', 'prop', F.WALK);
      });
      const rnd = rng(hash(this.seed, 31, strHash(p.id), 0));
      const nl = hot ? 4 : 1;
      for (let i = 0; i < nl; i++) {
        const x = rnd.range(lw[0] + 2, lw[2] - 2), z = rnd.range(lw[1] + 2, lw[3] - 2);
        if (this._kept(x, z) || !land(x, z)) continue;
        E.lootAt(x, 0, z, hot ? 'hot' : 'park');
      }
    }

    //__PART4C__
  }

  Object.defineProperty(CityGen.prototype, 'staticItems', { get() { if (!this._staticE) this._initStatic(); return this._staticE; } });
  Object.defineProperty(CityGen.prototype, 'sb', { get() { if (!this._staticE) this._initStatic(); return this._sb; } });
  Object.defineProperty(CityGen.prototype, 'staticSil', { get() { if (!this._staticE) this._initStatic(); return this._staticSil; } });

  function rampSurface(p, x, z) {
    const len = p.axis === 'x' ? p.w : p.d;
    let u = p.axis === 'x' ? (x - (p.x - p.w / 2)) / len : (z - (p.z - p.d / 2)) / len;
    u = Math.max(0, Math.min(1, u));
    if (p.dir < 0) u = 1 - u;
    return p.y0 + (p.y1 - p.y0) * u;
  }

  // ---------- ランドマーク（CityGen のメソッド。static の Emitter に書く）----------
  Object.assign(CityGen.prototype, {
    _ent(E, o) {
      const M = this.M, lc = this.plan.loot;
      const P = Object.assign({ by: this.curbH, ground: this.curbH, shell: 'limestone', floorMat: 'terrazzo', intMat: M.interior, roofMat: M.roof, stairMat: M.stair,
        lootTable: 'hot', lootCount: lc.hotPerFloor, roofTable: 'roof', roofChance: 0.7, exp: 15, kind: 'landmark' }, o);
      return genEnterable(E, P, this.B);
    },
    // 4 辺のパラペット（gaps: [[辺 'n'|'s'|'w'|'e', s0, s1]…] を空ける）
    _ring(E, r, y, h, mat, f, gaps, t) {
      t = t || 0.3;
      const seg = (side, a, b, fn) => {
        const gs = (gaps || []).filter((g) => g[0] === side).sort((p, q) => p[1] - q[1]);
        let s = a;
        for (const g of gs) { if (g[1] > s) fn(s, g[1]); s = Math.max(s, g[2]); }
        if (s < b) fn(s, b);
      };
      seg('n', r[0], r[2], (a, b) => E.box(a, y, r[1], b, y + h, r[1] + t, mat, 'landmark', f));
      seg('s', r[0], r[2], (a, b) => E.box(a, y, r[3] - t, b, y + h, r[3], mat, 'landmark', f));
      seg('w', r[1] + t, r[3] - t, (a, b) => E.box(r[0], y, a, r[0] + t, y + h, b, mat, 'landmark', f));
      seg('e', r[1] + t, r[3] - t, (a, b) => E.box(r[2] - t, y, a, r[2], y + h, b, mat, 'landmark', f));
    },
    _lobby(E, rect, by, h, front, mat, id) {
      const L = { tiers: [[rect[0], rect[1], rect[2], rect[3], by, by + h + 1]], front, exp: 15, mat, lobbyH: h, hot: this._hotAt((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2), id };
      genLobby(E, L, this.B, { M: this.M }, rng(hash(this.seed, 51, strHash(id), 0)));
    },
    _loots(E, n, r, y, table, salt) { // 矩形 r の中に n 個（決定的）
      const rnd = rng(hash(this.seed, 52, salt, 0));
      for (let i = 0; i < n; i++) E.lootAt(Math.floor(rnd.range(r[0], r[2])) + 0.5, y, Math.floor(rnd.range(r[1], r[3])) + 0.5, table);
    },
    _sideRails(E, ramp, z0, z1, x0, x1, along) { // スロープの両脇の壁（10 m ごとの箱）
      const len = along === 'x' ? x1 - x0 : z1 - z0, n = Math.ceil(len / 10);
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 1) / n;
        const s0 = ramp(a), s1 = ramp(b), lo = Math.max(0, Math.min(s0, s1) - 1.2), hi = Math.max(s0, s1) + 1.1;
        if (along === 'x') {
          E.box(x0 + len * a, lo, z0, x0 + len * b, hi, z0 + 0.3, 'concrete', 'road', 0);
          E.box(x0 + len * a, lo, z1 - 0.3, x0 + len * b, hi, z1, 'concrete', 'road', 0);
        } else {
          E.box(x0, lo, z0 + len * a, x0 + 0.3, hi, z0 + len * b, 'concrete', 'road', 0);
          E.box(x1 - 0.3, lo, z0 + len * a, x1, hi, z0 + len * b, 'concrete', 'road', 0);
        }
      }
    },

    // GLB のノード空間（+Y 上、正面 +Z）→ ワールド。yaw は 90° 刻み（three.js の rotation.y と同じ向き）
    _local(E, ox, oy, oz, yawDeg) {
      const th = yawDeg * Math.PI / 180, c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
      const wx = (x, z) => ox + x * c + z * sn, wz = (x, z) => oz - x * sn + z * c;
      const rect = (x0, z0, x1, z1) => { const a = [wx(x0, z0), wx(x1, z1)], b = [wz(x0, z0), wz(x1, z1)]; return [Math.min(a[0], a[1]), Math.min(b[0], b[1]), Math.max(a[0], a[1]), Math.max(b[0], b[1])]; };
      return {
        x: wx, z: wz, rect,
        box(x0, y0, z0, x1, y1, z1, mat, cat, f, mt) { const r = rect(x0, z0, x1, z1); E.box(r[0], oy + y0, r[1], r[2], oy + y1, r[3], mat, cat, f, mt); },
        // ローカルの axis（'x'|'z'）方向に dir の向きへ ya → yb で上がるスロープ
        ramp(x0, z0, x1, z1, ya, yb, axis, dir, mat, cat, f, t) {
          const r = rect(x0, z0, x1, z1);
          const vx = axis === 'x' ? dir * c : dir * sn, vz = axis === 'x' ? -dir * sn : dir * c;
          E.ramp(r[0], r[1], r[2], r[3], oy + ya, oy + yb, vx !== 0 ? 'x' : 'z', vx !== 0 ? vx : vz, mat, cat, f, t);
        },
        ladder(x, z, y0, y1, nx, nz) { E.ladder(wx(x, z), wz(x, z), oy + y0, oy + y1, nx * c + nz * sn, -nx * sn + nz * c); },
        loot(x, y, z, table) { E.lootAt(Math.floor(wx(x, z) * 2) / 2 + 0.25, oy + y, Math.floor(wz(x, z) * 2) / 2 + 0.25, table); }
      };
    },

    // グランドセントラル: 正面（GLB）+ 待合室 + 大コンコース（バルコニー・大階段・案内所）+ ホーム + 東西の棟（入れる）+ 屋上ヘリポート
    _lm_gct(E, p) {
      const B0 = p.by, r = p.rect, fx = p.facade[0], fz = p.facade[1], wb = p.wallBackZ;
      const c = p.concourse, RY = p.roofY, VR = p.vestibuleRoof, PR = p.platformRoof;
      const L = 'limestone', LM = 'landmark';
      E.place('gct_facade', 'landmarks', fx, B0, fz, 0);
      // 正面の壁（3 つの入口は抜く）
      const doors = [[fx - 22, fx - 16], [fx - 3, fx + 3], [fx + 16, fx + 22]];
      let x = fx - 45;
      E.tag = 'gct_facade';
      for (const d of doors) { E.box(x, B0, wb, d[0], B0 + 5, fz, L, LM, 0); x = d[1]; }
      E.box(x, B0, wb, fx + 45, B0 + 5, fz, L, LM, 0);
      E.box(fx - 45, B0 + 5, wb, fx + 45, B0 + 30.2, fz, L, LM, F.WALK);
      for (const pc of [-28.5, -9.5, 9.5, 28.5]) E.box(fx + pc - 2, B0 + 7.2, fz, fx + pc + 2, B0 + 22, fz + 1.8, L, LM, 0);
      E.box(fx - 45, B0 + 21.95, fz, fx + 45, B0 + 25.8, fz + 1.75, L, LM, F.WALK);
      E.tag = null;
      E.box(r[0], B0, wb - 0.6, fx - 45, B0 + 30.2, fz, L, LM, F.WALK);
      E.box(fx + 45, B0, wb - 0.6, r[2], B0 + 30.2, fz, L, LM, F.WALK);
      // 東西の棟（入れる。コンコース・バルコニーへの扉）
      const wing = p.wing, ww = wing[0], zf = Math.floor(wb - 0.6);
      const by = this._ent(E, { id: 'gct_w', hvac: 0, core: 'left', x0: r[0], z0: r[1], x1: r[0] + ww, z1: zf, front: 'w', floors: wing[2], fh: wing[1], seed: hash(this.seed, 41, 0, 0), shell: L,
        extraDoors: [{ face: 1, floor: 0, s: 10 }, { face: 1, floor: 0, s: 40 }, { face: 1, floor: 0, s: 70 }, { face: 1, floor: 0, s: 110 }, { face: 1, floor: 2, s: 45 }, { face: 1, floor: 2, s: 75 }], noSideDoors: true });
      this._ent(E, { id: 'gct_e', hvac: 0, core: 'right', x0: r[2] - ww, z0: r[1], x1: r[2], z1: zf, front: 'e', floors: wing[2], fh: wing[1], seed: hash(this.seed, 41, 1, 0), shell: L,
        extraDoors: [{ face: 1, floor: 0, s: 125 }, { face: 1, floor: 0, s: 95 }, { face: 1, floor: 0, s: 65 }, { face: 1, floor: 0, s: 25 }, { face: 1, floor: 2, s: 60 }, { face: 1, floor: 2, s: 90 }], noSideDoors: true });
      const wingTop = B0 + wing[1] * wing[2];
      const cx0 = r[0] + ww, cx1 = r[2] - ww; // 内側の x 範囲（-50..40）
      // 待合室（正面の裏）
      E.box(cx0, B0, wb, cx1, B0 + 0.05, c[3], 'marble_floor', 'floor', F.WALK);
      E.box(cx0 - 0.3, VR - 0.6, c[3], cx1 + 0.3, VR, wb, this.M.roof, 'roof', F.WALK, this.M.roof);
      for (const cxx of [-35, -5, 25]) E.place('gct_chandelier', 'landmarks', cxx, VR - 0.6, (c[3] + wb) / 2, 0);
      // 待合室とコンコースの間の壁（3 つの大きな開口）
      const sz0 = c[3] - 3, sz1 = c[3];
      x = cx0;
      for (const o of [[-35, -27], [-9, -1], [17, 25]]) { E.box(x, B0, sz0, o[0], B0 + 10, sz1, L, LM, 0); x = o[1]; }
      E.box(x, B0, sz0, cx1, B0 + 10, sz1, L, LM, 0);
      E.box(cx0, B0 + 10, sz0, cx1, RY, sz1, L, LM, 0);
      // コンコース
      E.box(cx0, B0, c[1], cx1, B0 + 0.05, sz0, 'marble_floor', 'floor', F.WALK);
      E.box(cx0 - 0.3, wingTop, c[1], cx0, RY, sz1, L, LM, 0);
      E.box(cx1, wingTop, c[1], cx1 + 0.3, RY, sz1, L, LM, 0);
      E.box(cx0 - 0.3, RY - 0.6, c[1], cx1 + 0.3, RY, sz1, this.M.roof, 'roof', F.WALK, this.M.roof);
      E.box(cx0, RY - 0.7, c[1] + 3, cx1, RY - 0.6, sz0, 'concourse_ceiling', 'interior', F.NOCOL);
      this._ring(E, [cx0 - 0.3, c[1], cx1 + 0.3, sz1], RY, 1.0, L, 0, [['w', -71.3, -69.7], ['e', -71.3, -69.7]]);
      E.ladder(cx0 - 0.3, -70.5, wingTop, RY, -1, 0);
      E.ladder(cx1 + 0.3, -70.5, wingTop, RY, 1, 0);
      E.ladder(cx0, -40.5, VR, wingTop + 1, 1, 0);
      E.ladder(cx1, -40.5, VR, wingTop + 1, -1, 0);
      // 北の壁（ホームへの改札口）
      const nz0 = c[1], nz1 = c[1] + 3;
      x = cx0;
      for (const gx of [-40, -25, -10, 5, 20, 35]) { E.box(x, B0, nz0, gx - 2, B0 + 4, nz1, L, LM, 0); x = gx + 2; }
      E.box(x, B0, nz0, cx1, B0 + 4, nz1, L, LM, 0);
      E.box(cx0, B0 + 4, nz0, cx1, RY - 0.6, nz1, L, LM, 0);
      // バルコニーと大階段
      const bal = p.balcony, bd = bal.depth;
      for (const side of [-1, 1]) {
        const bx0 = side < 0 ? cx0 : cx1 - bd, bx1 = side < 0 ? cx0 + bd : cx1, edge = side < 0 ? bx1 : bx0;
        E.box(bx0, bal.y - 0.6, bal.z[0], bx1, bal.y, bal.z[1], 'marble_floor', 'floor', F.WALK);
        const ex0 = side < 0 ? edge - 0.3 : edge, ex1 = ex0 + 0.3;
        E.box(ex0, bal.y, bal.z[0], ex1, bal.y + 1.1, -92, L, LM, 0);
        E.box(ex0, bal.y, -84, ex1, bal.y + 1.1, bal.z[1], L, LM, 0);
        E.box(bx0, bal.y, bal.z[0], bx1, bal.y + 1.1, bal.z[0] + 0.3, L, LM, 0);
        E.box(bx0, bal.y, bal.z[1] - 0.3, bx1, bal.y + 1.1, bal.z[1], L, LM, 0);
        const sx0 = side < 0 ? edge : edge - 16, sx1 = sx0 + 16;
        E.ramp(sx0, -92, sx1, -84, B0, bal.y, 'x', side < 0 ? -1 : 1, 'marble_floor', 'stair', 0, bal.y);
        this._loots(E, 3, [bx0 + 1, bal.z[0] + 2, bx1 - 1, bal.z[1] - 2], bal.y, 'gct_balcony', 70 + side);
      }
      // 案内所
      E.place('gct_info_booth', 'landmarks', -5, B0, -88, 0);
      E.tag = 'gct_info_booth';
      E.box(-8.4, B0, -90.4, -1.6, B0 + 3.9, -85.6, 'marble_floor', LM, F.WALK);
      E.box(-7.4, B0, -91.4, -2.6, B0 + 3.9, -84.6, 'marble_floor', LM, F.WALK);
      E.tag = null;
      // ホーム（北側）
      const pz0 = r[1] + 3, pz1 = nz0;
      x = cx0;
      for (const d of [[-30, -26], [20, 24]]) { E.box(x, B0, r[1], d[0], PR, pz0, L, LM, 0); E.box(d[0], B0 + 4, r[1], d[1], PR, pz0, L, LM, 0); x = d[1]; }
      E.box(x, B0, r[1], cx1, PR, pz0, L, LM, 0);
      E.box(cx0 - 0.3, PR - 0.6, r[1], cx1 + 0.3, PR, nz1, this.M.roof, 'roof', F.WALK, this.M.roof);
      this._ring(E, [cx0 - 0.3, r[1], cx1 + 0.3, nz1], PR, 1.0, L, 0, [['n', -11.3, -9.7], ['s', cx0 - 1, cx1 + 1]]);
      E.ladder(-10.5, r[1], B0, PR, 0, -1);
      for (const px of [-42, -26, -10, 6, 22, 36]) {
        E.box(px - 3, B0, pz0 + 3, px + 3, B0 + 1.1, -130, 'concrete', LM, F.WALK);
        E.ramp(px - 3, -130, px + 3, -125, B0, B0 + 1.1, 'z', -1, 'concrete', 'stair', 0, 1.2);
      }
      for (const tx of [-34, -2, 29]) {
        E.box(tx - 1.6, B0, -158, tx + 1.6, B0 + 4.2, -128, 'metalDark', LM, F.WALK);
        E.ladder(tx, -128, B0, B0 + 4.2, 0, 1);
      }
      for (let i = -42; i <= 36; i += 8) E.decal({ type: 'track', x: i + 4, z: (pz0 + nz0) / 2, w: 3, d: nz0 - pz0 - 4, rot: 0 });
      // 戦利品
      this._loots(E, 6, [cx0 + bd + 2, c[1] + 6, cx1 - bd - 2, sz0 - 4], B0 + 0.05, 'hot', 61);
      this._loots(E, 3, [cx0 + 2, c[3] + 2, cx1 - 2, wb - 2], B0 + 0.05, 'hot', 62);
      this._loots(E, 4, [cx0 + 2, pz0 + 3, cx1 - 2, -131], B0 + 1.1, 'hot', 63);
      this._loots(E, 2, [cx0 + 4, c[1] + 4, cx1 - 4, -100], RY, 'roof', 64);
      E.building({ id: 'gct', kind: 'gct', x0: r[0], z0: r[1], x1: r[2], z1: r[3], floors: 1, door: [fx, B0, fz + 6], roof: [-5.5, RY, -100.5] });
      // 東の街区の建物（Lex 側）
      const eb = p.eastBlock;
      if (eb) {
        const segs = [[eb[1], -172], [-150, -92], [-70, eb[3]]];
        segs.forEach((s, i) => this._ent(E, { id: 'gct_eb' + i, x0: eb[0], z0: s[0], x1: eb[2], z1: s[1], front: 'e', floors: eb[4], fh: 3.6, seed: hash(this.seed, 42, i, 0), shell: 'concrete', floorMat: 'wood_floor' }));
      }
      return by;
    },

    // パーク街の高架（GCT を囲む。y = 7、両側にスロープ）
    _lm_viaduct(E, p) {
      const y = p.y, t = p.t, hw = p.w / 2, lp = p.loop, ln = p.lane, fr = p.front;
      const R = 'asphalt_city', C = 'road', W = F.WALK;
      E.ramp(-hw, p.south[0], hw, p.south[1], 0, y, 'z', -1, R, C, 0, t);
      this._sideRails(E, (u) => y * (1 - u), p.south[0], p.south[1], -hw, hw, 'z');
      E.box(-hw, y - t, fr[1], hw, y, p.south[0], R, C, W);
      E.box(lp[0], y - t, fr[0], lp[2], y, fr[1], R, C, W);
      E.box(lp[0], y - t, lp[1] + ln, lp[0] + ln, y, fr[0], R, C, W);
      E.box(lp[2] - ln, y - t, lp[1] + ln, lp[2], y, fr[0], R, C, W);
      E.box(lp[0], y - t, lp[1], lp[2], y, lp[1] + ln, R, C, W);
      E.box(-hw, y - t, p.north[1], hw, y, lp[1], R, C, W);
      E.ramp(-hw, p.north[0], hw, p.north[1], 0, y, 'z', 1, R, C, 0, t);
      this._sideRails(E, (u) => y * u, p.north[0], p.north[1], -hw, hw, 'z');
      // 欄干
      const rl = (x0, z0, x1, z1) => E.box(x0, y, z0, x1, y + 1.0, z1, 'concrete', C, 0);
      rl(lp[0], fr[1] - 0.3, -hw, fr[1]); rl(hw, fr[1] - 0.3, lp[2], fr[1]);
      rl(-hw - 0.3, fr[1], -hw, p.south[0]); rl(hw, fr[1], hw + 0.3, p.south[0]);
      rl(lp[0], lp[1] + ln, lp[0] + 0.3, fr[0]); rl(lp[0] + ln - 0.3, lp[1] + ln, lp[0] + ln, fr[0]);
      rl(lp[2] - 0.3, lp[1] + ln, lp[2], fr[0]); rl(lp[2] - ln, lp[1] + ln, lp[2] - ln + 0.3, fr[0]);
      rl(lp[0], lp[1], -hw, lp[1] + 0.3); rl(hw, lp[1], lp[2], lp[1] + 0.3);
      rl(lp[0] + ln, lp[1] + ln - 0.3, lp[2] - ln, lp[1] + ln);
      rl(-hw - 0.3, p.north[1], -hw, lp[1]); rl(hw, p.north[1], hw + 0.3, lp[1]);
      // 柱
      const col = (cx, cz) => E.box(cx - 0.5, 0, cz - 0.5, cx + 0.5, y - t, cz + 0.5, 'concrete', C, 0);
      for (let z = fr[0] - 12; z > lp[1] + ln; z -= 24) { col(lp[0] + 1, z); col(lp[0] + ln - 1, z); col(lp[2] - 1, z); col(lp[2] - ln + 1, z); }
      for (let xx = lp[0] + 6; xx < lp[2] - 6; xx += 22) {
        if (![[-28, -20], [-9, -1], [10, 18]].some((d) => xx > d[0] - 1 && xx < d[1] + 1)) col(xx, fr[0] + 1.5);
        col(xx, lp[1] + 1); col(xx, lp[1] + ln - 1);
      }
    },

    // GCT の北のスラブ型の塔（高架が足元を抜ける。屋上ヘリポート = ヘリ専用）
    _lm_slab_tower(E, p) {
      const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2, c = p.chamfer, M = 'office_stone', LM = 'landmark';
      E.box(x0, 0, z0, x1, p.podium - 0.8, z1, M, LM, 0);
      E.box(x0, p.podium - 0.8, z0, p.portal[0], p.portal[2], z1, M, LM, 0);
      E.box(p.portal[1], p.podium - 0.8, z0, x1, p.portal[2], z1, M, LM, 0);
      E.box(x0, p.portal[2], z0 + c, x1, p.shaftTop, z1 - c, M, LM, F.WALK, this.M.roof);
      E.box(x0 + c, p.portal[2], z0, x1 - c, p.shaftTop, z1, M, LM, F.WALK, this.M.roof);
      const T = p.shaftTop, cz = p.z;
      E.place('tower_top', 'landmarks', p.x, T, p.z, 0);
      E.tag = 'tower_top';
      this._ring(E, [x0, z0, x1, z1], T, 8.6, 'concrete', 0, null, 0.5);
      E.box(x0 + 0.5, T, z0 + 0.5, x1 - 0.5, T + p.deck, z1 - 0.5, this.M.roof, 'roof', F.WALK, this.M.roof);
      E.box(p.x - 11.5, T + p.deck, cz - 8, p.x + 11.5, T + 12, cz + 8, 'concrete', LM, F.WALK);
      for (const h of [[-26, -6, 5, 3, 2.4], [-26, 6, 5, 3, 2.4], [25, -7, 6, 4, 2.8], [29, 7.5, 3, 3, 1.8]]) E.box(p.x + h[0] - h[2] / 2, T + p.deck, cz + h[1] - h[3] / 2, p.x + h[0] + h[2] / 2, T + p.deck + h[4], cz + h[1] + h[3] / 2, 'metalDark', 'prop', F.WALK);
      const ph = p.padHalf, py = T + p.pad;
      E.box(p.x - ph, py - 0.5, cz - ph, p.x + ph, py, cz + ph, 'concrete', LM, F.WALK);
      for (const lx of [-12, -4, 4, 12]) for (const lz of [-12.2, 12.2]) E.box(p.x + lx - 0.2, T + p.deck, cz + lz - 0.2, p.x + lx + 0.2, py - 0.5, cz + lz + 0.2, 'metalDark', LM, 0);
      E.ramp(p.x, cz + 13.25, p.x + 7.9, cz + 14.75, T + p.deck, py, 'x', -1, 'metalDark', 'stair', F.NOLOS, 0.3);
      E.box(p.x - 1.5, py - 0.5, cz + ph, p.x, py, cz + 14.75, 'metalDark', LM, F.WALK);
      E.tag = null;
    },

    // アールデコの尖塔（低層部 + 細い塔 + 王冠。1 階ロビーに入れる）
    _lm_deco_tower(E, p) {
      const b = p.base, LM = 'landmark', M = 'office_stone', by = this.curbH;
      this._lobby(E, [b[0], b[1], b[2], b[3]], by, p.lobby, 's', M, 'deco_lobby');
      E.box(b[0], by + p.lobby, b[1], b[2], b[4], b[3], M, LM, F.WALK, this.M.roof);
      E.box(p.x - 22.5, b[4], p.z - 20, p.x + 22.5, p.shaftTop, p.z + 20, M, LM, F.WALK);
      const T = p.shaftTop, t = p.tiers;
      E.place('deco_crown', 'landmarks', p.x, T, p.z, 0);
      E.tag = 'deco_crown';
      E.box(p.x - 22.5, T, p.z - 20, p.x + 22.5, T + 3, p.z + 20, M, LM, F.WALK);
      let y0 = 3;
      for (let i = 0; i < t.length / 3; i++) {
        const hw = t[i * 3], hd = t[i * 3 + 1], sp = t[i * 3 + 2];
        E.box(p.x - hw, T + y0, p.z - hd, p.x + hw, T + sp, p.z + hd, 'metalDark', LM, F.WALK);
        y0 = sp;
      }
      const hw6 = t[t.length - 3], hd6 = t[t.length - 2];
      E.box(p.x - hw6, T + y0, p.z - hd6, p.x + hw6, T + p.topBox, p.z + hd6, 'metalDark', LM, 0);
      E.tag = null;
    },

    // エンパイア風の塔（段々 + 尖塔。展望テラス = ヘリ専用。ロビーに入れる）
    _lm_empire_tower(E, p) {
      const M = 'limestone', LM = 'landmark', by = this.curbH;
      p.tiers.forEach((t, i) => {
        if (i === 0) { this._lobby(E, [t[0], t[1], t[2], t[3]], by, p.lobby, 'n', M, 'empire_lobby'); E.box(t[0], by + p.lobby, t[1], t[2], t[5], t[3], M, LM, F.WALK, this.M.roof); }
        else E.box(t[0], t[4], t[1], t[2], t[5], t[3], M, LM, F.WALK, this.M.roof);
        if (i === p.tiers.length - 1) E.tag = 'spire_top'; // 最上段の縁から上は GLB（spire_top）が受け持つ
        this._ring(E, [t[0], t[1], t[2], t[3]], t[5], 1.0, M, 0);
      });
      for (const t of p.spire) E.box(t[0], t[4], t[1], t[2], t[5], t[3], M, LM, F.WALK);
      const tr = p.spire.find((t) => t[5] === p.terraceY);
      if (tr) this._ring(E, [tr[0], tr[1], tr[2], tr[3]], p.terraceY, p.terraceFence || 1.2, 'metalDark', F.NOLOS);
      const m = p.mast;
      E.box(m[0], m[4], m[1], m[2], m[5], m[3], 'metalDark', LM, 0);
      E.tag = null;
      const top = p.tiers[p.tiers.length - 1];
      E.place('spire_top', 'landmarks2', p.x, top[5], p.z, (p.yaw || 0) * Math.PI / 180);
      if (tr) this._loots(E, 2, [tr[0] + 0.5, tr[1] + 0.5, tr[2] - 0.5, tr[1] + 1.5], p.terraceY, 'roof', 81);
    },

    // 図書館（東向きの正面 GLB + テラスと大階段 + 入れる本体）
    _lm_library(E, p) {
      const nx = p.node[0], nz = p.node[1], T = p.terrace, L = 'limestone', LM = 'landmark', by = this.curbH;
      E.place('library_facade', 'landmarks', nx, 0, nz, Math.PI / 2);
      E.tag = 'library_facade';
      E.box(nx, 0, nz - 40.25, nx + 6, T, nz + 40.25, L, LM, F.WALK);
      E.ramp(nx + 6, nz - 12, nx + 12, nz + 12, by, T, 'x', -1, 'stair_stone', 'stair', 0, T);
      E.box(nx + 6, 0, nz - 13, nx + 12, T, nz - 12, L, LM, F.WALK);
      E.box(nx + 6, 0, nz + 12, nx + 12, T, nz + 13, L, LM, F.WALK);
      for (const s of [-1, 1]) {
        E.box(nx + 6.6, 0, nz + s * 13.6 - (s > 0 ? 0 : 2.6), nx + 11.8, 2.35, nz + s * 13.6 + (s > 0 ? 2.6 : 0), L, LM, F.WALK);
        E.box(nx + 7.2, 2.35, nz + s * 14.9 - 0.9, nx + 11.6, 4.55, nz + s * 14.9 + 0.9, L, LM, 0);
        E.box(nx + 5.6, T, s > 0 ? nz + 13 : nz - 40, nx + 5.9, T + 1.0, s > 0 ? nz + 40 : nz - 13, L, LM, 0);
      }
      // 正面の壁（扉 3 つ）
      const wx0 = nx - 2, wx1 = nx;
      E.box(wx0, 0, nz - 40.25, wx1, T, nz + 40.25, L, LM, 0);
      let z = nz - 40.25;
      for (const dz of [-8, 0, 8]) { E.box(wx0, T, z, wx1, 8.4, nz + dz - 1.8, L, LM, 0); z = nz + dz + 1.8; }
      E.box(wx0, T, z, wx1, 8.4, nz + 40.25, L, LM, 0);
      E.box(wx0, 8.4, nz - 40.25, wx1, 19.95, nz + 40.25, L, LM, F.WALK);
      E.box(wx0, 19.95, nz - 14.5, wx1, 23.6, nz + 14.5, L, LM, 0);
      for (const cx of [-13.2, -11.2, -4, 4, 11.2, 13.2]) E.box(nx + 2.3, T, nz - cx - 0.7, nx + 3.7, 17.1, nz - cx + 0.7, L, LM, 0);
      E.box(nx, 17, nz - 14.5, nx + 4.75, 19.95, nz + 14.5, L, LM, F.WALK);
      E.tag = null;
      // 本体（入れる。2 階の大閲覧室、屋上）
      const b = p.body;
      const s0 = p.doors.map((d) => d - b[1]);
      this._ent(E, { id: 'library', x0: b[0], z0: b[1], x1: b[2], z1: b[3], front: 'e', floors: p.floors, fh: p.floorH, by: T, ground: by, podium: true,
        seed: hash(this.seed, 43, 0, 0), shell: L, floorMat: 'wood_floor', mainDoor: s0[1], doorH: 5.5, extraDoors: [{ face: 0, floor: 0, s: s0[0], h: 5.5 }, { face: 0, floor: 0, s: s0[2], h: 5.5 }], ladderFace: 1, noSideDoors: false });
      this._loots(E, 3, [nx + 1, nz - 35, nx + 5, nz + 35], T, 'hot', 91);
    },

    // タイムズスクエア: 赤い階段（座れる大階段の下は箱）、歩行者天国のプランター
    _lm_times_square(E, p) {
      const s = p.steps, top = p.stepsTop, by = this.curbH;
      E.box(s[0], 0, s[1], s[2], top, s[3] - p.run, 'red_glass', 'landmark', F.WALK);
      E.ramp(s[0], s[3] - p.run, s[2], s[3], by, top, 'z', -1, 'red_glass', 'stair', 0, top);
      this._ring(E, [s[0], s[1], s[2], s[3] - p.run + 0.3], top, 1.1, 'glass_rail', F.NOLOS, [['s', s[0], s[2]]]);
      const pz = this.bwPlaza[0] || [p.center[1] - 200, p.center[1] + 200];
      let i = 0;
      for (let z = pz[0] + 14; z < pz[1] - 14; z += 16, i++) {
        if (z > s[1] - 6 && z < s[3] + 6) continue;
        const bx = this.bwX(z), off = (i % 2 ? 1 : -1) * 6;
        E.prop('planter', bx + off, by, z, 0);
        E.box(bx + off - 0.64, by, z - 0.64, bx + off + 0.64, by + 0.72, z + 0.64, 'concrete', 'prop', F.WALK);
        const lx = Math.floor(bx - off) + 0.5, lz = Math.floor(z) + 0.5;
        if (i % 3 === 0 && !this._onCarriageway(lx, lz, 1) && this.onBroadway(lx, lz, 0)) E.lootAt(lx, by, lz, 'hot');
      }
    },

    // プラザ（スラブの塔 + 沈んだ広場 + 遊歩道）
    _lm_rockefeller(E, p) {
      const t = p.tower, M = 'limestone', LM = 'landmark', by = this.curbH;
      this._lobby(E, [t[0], t[1], t[2], t[3]], by, 8, 'e', M, 'rock_lobby');
      E.box(t[0], by + 8, t[1], t[2], p.terraces[0], t[3], M, LM, F.WALK, this.M.roof);
      E.box(t[0] + 3, p.terraces[0], t[1] + 10, t[2] - 3, p.terraces[1], t[3] - 10, M, LM, F.WALK, this.M.roof);
      E.box(t[0] + 6, p.terraces[1], t[1] + 20, t[2] - 6, t[4], t[3] - 20, M, LM, F.WALK, this.M.roof);
      this._ring(E, [t[0], t[1], t[2], t[3]], p.terraces[0], 1.2, 'glass_rail', F.NOLOS);
      this._ring(E, [t[0] + 3, t[1] + 10, t[2] - 3, t[3] - 10], p.terraces[1], 1.2, 'glass_rail', F.NOLOS);
      this._ring(E, [t[0] + 6, t[1] + 20, t[2] - 6, t[3] - 20], t[4], 1.2, 'glass_rail', F.NOLOS);
      // 沈んだ広場（底 y = pit[4]）
      const q = p.pit, py = q[4], sz0 = -604, sz1 = -596;
      E.box(q[0] + 0.5, py, q[1] + 0.5, q[2] - 0.5, py + 0.05, q[3] - 0.5, 'ice', 'floor', F.WALK);
      E.box(q[0], py, q[1], q[2], by, q[1] + 0.5, 'stair_stone', LM, F.WALK);
      E.box(q[0], py, q[3] - 0.5, q[2], by, q[3], 'stair_stone', LM, F.WALK);
      for (const side of [-1, 1]) {
        const wx0 = side < 0 ? q[0] : q[2] - 0.5;
        E.box(wx0, py, q[1] + 0.5, wx0 + 0.5, by, sz0, 'stair_stone', LM, F.WALK);
        E.box(wx0, py, sz1, wx0 + 0.5, by, q[3] - 0.5, 'stair_stone', LM, F.WALK);
        const rx0 = side < 0 ? q[0] : q[2] - 8;
        E.ramp(rx0, sz0, rx0 + 8, sz1, py, by, 'x', side, 'stair_stone', 'stair', 0, by - py);
      }
      this._ring(E, [q[0], q[1], q[2], q[3]], by, 1.1, 'glass_rail', F.NOLOS, [['w', sz0, sz1], ['e', sz0, sz1]], 0.15);
      for (let x = q[0] + 2; x < q[2]; x += 6) for (const z of [q[1] - 1.2, q[3] + 1.2]) E.box(x - 0.08, by, z - 0.08, x + 0.08, by + 10, z + 0.08, 'metalDark', LM, 0);
      this._loots(E, 3, [q[0] + 2, q[1] + 2, q[2] - 10, q[3] - 2], py + 0.05, 'hot', 101);
      // 遊歩道（植え込み）
      const pr = p.promenade;
      for (let x = pr[0] + 8; x < pr[2] - 6; x += 12) {
        E.box(x - 3, by, (pr[1] + pr[3]) / 2 - 0.75, x + 3, by + 0.6, (pr[1] + pr[3]) / 2 + 0.75, 'concrete', 'prop', F.WALK, 'grass');
      }
      this._loots(E, 2, [pr[0] + 2, pr[1] + 1, pr[2] - 2, pr[1] + 4], by, 'hot', 102);
    },

    // 国連風（スラブ + 総会ホール（入れる）+ 旗竿の列）
    _lm_un(E, p) {
      const s = p.slab, LM = 'landmark', by = this.curbH;
      this._lobby(E, [s[0], s[1], s[2], s[3]], by, 8, 'w', 'glass_tower', 'un_lobby');
      E.box(s[0], by + 8, s[1], s[2], s[4], s[3], 'glass_tower', LM, F.WALK, this.M.roof);
      this._ring(E, [s[0], s[1], s[2], s[3]], s[4], 1.0, 'concrete', 0);
      const a = p.assembly;
      this._ent(E, { id: 'un_hall', x0: a[0], z0: a[1], x1: a[2], z1: a[3], front: 'w', floors: a[4], fh: a[5], seed: hash(this.seed, 44, 0, 0), shell: 'concrete', floorMat: 'carpet_office' });
      const pl = p.poles;
      for (let z = pl[1]; z <= pl[2]; z += pl[3]) {
        if (this._kept(pl[0], z)) continue;
        E.box(pl[0] - 0.1, by, z - 0.1, pl[0] + 0.1, by + 10, z + 0.1, 'metalDark', LM, 0);
      }
      const cl = this.claims.find((c) => c.kind === 'un');
      if (cl) {
        const r = cl.rect;
        for (let x = r[0] + 12; x < r[2] - 4; x += 11) for (let z = r[1] + 8; z < r[1] + 38; z += 11) this._tree(E, x, by, z, x);
        this._loots(E, 4, [r[0] + 8, s[3] + 6, r[2] - 6, r[3] - 8], by, 'hot', 111);
      }
    },

    // 空母（landmarks2 の carrier。原点は喫水線 = waterY、艦首 +Z、艦橋は右舷 −X、階段塔は左舷 +X で桟橋の上 y = 2 から）
    //   当たりは city2-landmarks2 の値を写したもの（主な箱だけ。細かい物は GLB の userData.info.collision で置き換えられる）
    _lm_carrier(E, p) {
      const L = this._local(E, p.x, this.waterY, p.z, p.yaw), H = 'hull_grey', LM = 'landmark', D = p.deckTop;
      E.tag = 'carrier';
      for (const h of p.hull) L.box(-h[2] / 2, p.hullBottom, h[0], h[2] / 2, p.hullTop, h[1], H, LM, F.WALK);
      for (const d of this._carrierDeck(p)) L.box(d[0], p.hullTop, d[1], d[2], D, d[3], 'carrier_deck', LM, F.WALK);
      for (const is of p.island) L.box(is[0], D, is[1], is[2], is[4], is[3], H, LM, F.WALK);
      const m = p.mast;
      L.box(m[0], m[4], m[1], m[2], m[5], m[3], 'metalDark', LM, 0);
      // 階段塔（左舷、5 本の折り返し。下は桟橋の高さ）
      const st = p.stair, ln = st.lanes, base = st.base;
      for (let k = 0; k < st.flights; k++) {
        const y0 = base + k * st.rise, y1 = y0 + st.rise, up = k % 2 === 0;
        L.ramp(up ? ln[0] : ln[1], st.z[0], up ? ln[1] : ln[2], st.z[1], y0, y1, 'z', up ? 1 : -1, 'metalDark', 'stair', 0, 0.4);
        const lz = up ? st.landFar : st.landNear;
        L.box(ln[0], y1 - 0.3, lz[0], ln[2], y1, lz[1], 'metalDark', LM, F.WALK);
      }
      L.box(ln[1] - 0.05, base, st.z[0], ln[1] + 0.05, base + st.flights * st.rise, st.z[1], 'metalDark', LM, F.NOLOS);
      L.box(st.bridge[0], D - 0.3, st.bridge[2], st.bridge[1], D, st.bridge[3], 'metalDark', LM, F.WALK);
      L.box(ln[2], base, st.landNear[0], ln[2] + 0.15, D + 1.1, st.landFar[1], 'metalDark', LM, F.NOLOS);
      for (const j of p.jbd) L.box(j[0], D, j[2], j[1], D + j[4], j[3], 'metalDark', 'prop', F.WALK);
      const r = p.tubR;
      for (const t of p.tubs) {
        const out = t[0] > 0 ? 1 : -1;
        L.box(t[0] - r, p.tubFloor - 0.4, t[1] - r, t[0] + r, p.tubFloor, t[1] + r, 'carrier_deck', LM, F.WALK);
        L.box(out > 0 ? t[0] + r - 0.2 : t[0] - r, p.tubFloor, t[1] - r, out > 0 ? t[0] + r : t[0] - r + 0.2, p.tubRim, t[1] + r, H, LM, 0);
        L.box(t[0] - r, p.tubFloor, t[1] - r, t[0] + r, p.tubRim, t[1] - r + 0.2, H, LM, 0);
        L.box(t[0] - r, p.tubFloor, t[1] + r - 0.2, t[0] + r, p.tubRim, t[1] + r, H, LM, 0);
      }
      for (const j of p.jets) {
        L.box(j[0] - 1.2, D, j[1] - j[2] / 2, j[0] + 1.2, D + 3, j[1] + j[2] / 2, 'metalDark', 'prop', F.WALK);
        L.box(j[0] - 5, D + 1.2, j[1] - 2, j[0] + 5, D + 1.6, j[1] + 2, 'metalDark', 'prop', F.WALK);
      }
      // 展示用のヘリ（params.heli [x, z, 長さ]）。landmarks2 から外したので midtown.json には無い（戦闘機の誘導路を空けるため）
      if (p.heli) L.box(p.heli[0] - 1.5, D, p.heli[1] - p.heli[2] / 2, p.heli[0] + 1.5, D + 3.5, p.heli[1] + p.heli[2] / 2, 'metalDark', 'prop', F.WALK);
      // 甲板のトラクター（params.tractors [[x, z, 向き°]]、大きさ tractorSize [幅, 長さ, 高さ]。landmarks2 の CV_TRACTORS と同じ所:
      //  右舷の端で駐機場所より後ろ = 誘導路・着艦の場所の外）。向きは 90° 単位。高さは車体の上まで（座席は除く）: 人・車は当たり、
      //  戦闘機の球（胴の下 約 0.9 m）は越える（後ろへ下がってよける j_1 がトラクターでふさがれて牽引にならない）
      const ts = p.tractorSize;
      if (ts) for (const t of p.tractors || []) {
        const side = Math.abs(Math.sin((t[2] || 0) * Math.PI / 180)) > 0.5, hw = (side ? ts[1] : ts[0]) / 2, hd = (side ? ts[0] : ts[1]) / 2;
        L.box(t[0] - hw, D, t[1] - hd, t[0] + hw, D + ts[2], t[1] + hd, 'metalDark', 'prop', F.WALK);
      }
      E.tag = null;
      E.place('carrier', 'landmarks2', p.x, this.waterY, p.z, p.yaw * Math.PI / 180);
      for (const l of p.loot) L.loot(l[0], l[1], l[2], 'hot');
      if (p.shed) { const q = p.shed; this._ent(E, { id: 'carrier_shed', x0: q[0], z0: q[1], x1: q[2], z1: q[3], front: 'n', floors: q[4], fh: q[5], by: 0, ground: 0, seed: hash(this.seed, 49, 0, 0), shell: 'concrete', floorMat: 'concrete', open: true, crates: 6 }); }
    },

    // 橋（取り付け道路 → 高さ 40 m の床 → 取り付け道路）。断面は landmarks2 の bridge_truss / bridge_tower と同じ:
    //   床 ±deckHalf、車線の外の防護柵、トラスの壁（視線・弾は通す）、外側の歩道と手すり。塔は 60 m の区画 1 つを使う
    _lm_bridge(E, p) {
      const Z = p.z, Y = p.deckY, T = p.deckT, hw = p.deckHalf, R = 'asphalt_city', C = 'road', LM = 'landmark', M = 'metalDark';
      E.ramp(p.x0, Z - hw, p.xa, Z + hw, 0, Y, 'x', 1, R, C, 0, T);
      E.ramp(p.xb, Z - hw, p.x1, Z + hw, 0, Y, 'x', -1, R, C, 0, T);
      this._sideRails(E, (u) => Y * u, Z - hw, Z + hw, p.x0, p.xa, 'x');
      this._sideRails(E, (u) => Y * (1 - u), Z - hw, Z + hw, p.xb, p.x1, 'x');
      E.tag = 'bridge'; // 床から上の鋼材と橋脚は GLB（bridge_truss / bridge_tower）が受け持つ
      E.box(p.xa, Y - T, Z - hw, p.xb, Y, Z + hw, R, C, F.WALK);
      const b = p.barrier, tr = p.truss, wk = p.walkway, rl = p.rail;
      for (const sd of [-1, 1]) {
        const zz = (a0, a1) => (sd > 0 ? [Z + a0, Z + a1] : [Z - a1, Z - a0]);
        let q = zz(b[0], b[1]); E.box(p.xa, Y, q[0], p.xb, Y + b[2], q[1], 'concrete', C, 0);
        q = zz(tr[0], tr[1]); E.box(p.xa, tr[2], q[0], p.xb, tr[3], q[1], M, LM, F.NOLOS);
        q = zz(wk[0], wk[1]); E.box(p.xa, wk[2] - 0.5, q[0], p.xb, wk[2], q[1], 'concrete', C, F.WALK);
        q = zz(rl[0], rl[1]); E.box(p.xa, wk[2], q[0], p.xb, rl[2], q[1], M, C, F.NOLOS);
      }
      E.box(p.xa, tr[3] - 1.6, Z - tr[1], p.xb, tr[3], Z + tr[1], M, LM, F.WALK | F.NOLOS);
      const pr = p.pier, lg = p.legs, po = p.portal, tt = p.towerTruss;
      for (const tx of p.towers) {
        E.box(tx - pr[1], pr[2], Z - pr[0], tx + pr[1], pr[3], Z + pr[0], 'limestone', LM, F.WALK);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) E.box(tx + sx * lg[2] - lg[3], tr[2], Z + sz * lg[0] - lg[1], tx + sx * lg[2] + lg[3], lg[4], Z + sz * lg[0] + lg[1], M, LM, 0);
        for (const sx of [-1, 1]) E.box(tx + sx * po[1] - po[2], po[3], Z - po[0], tx + sx * po[1] + po[2], po[4], Z + po[0], M, LM, 0);
        for (const sd of [-1, 1]) E.box(tx - tt[0], tr[3], sd > 0 ? Z + tr[0] : Z - tr[1], tx + tt[0], tt[1], sd > 0 ? Z + tr[1] : Z - tr[0], M, LM, F.NOLOS);
        E.place('bridge_tower', 'landmarks2', tx, 0, Z, Math.PI / 2);
      }
      E.tag = null;
      for (let x = p.xa + p.segment / 2; x < p.xb; x += p.segment) {
        if (p.towers.some((tx) => Math.abs(tx - x) < 1)) continue;
        E.place('bridge_truss', 'landmarks2', x, 0, Z, Math.PI / 2);
      }
      const sup = (x, s2) => {
        if (s2 < 6) return;
        for (const side of [-1, 1]) for (const dz of [8, 16]) {
          const z = Z + side * dz;
          if (!this.isLand(x, z) || this._onCarriageway(x, z, 1.5)) continue;
          E.box(x - 1, 0, z - 1, x + 1, s2 - T, z + 1, 'concrete', LM, 0);
          break;
        }
      };
      for (let x = p.x0 + p.supportEvery; x < p.xa - 10; x += p.supportEvery) sup(x, Y * (x - p.x0) / (p.xa - p.x0));
      for (let x = p.xb + p.supportEvery; x < p.x1 - 10; x += p.supportEvery) sup(x, Y * (p.x1 - x) / (p.x1 - p.xb));
    },

    // ハドソンヤード（操車場の上の人工地盤 y = 8 + ガラスの塔 + 展望デッキ + 階段の塔）
    _lm_hudson_yards(E, p) {
      const d = p.deck, Y = p.y, LM = 'landmark', cl = this.claims.find((c) => c.kind === 'hudson_yards').rect;
      for (const q of rectMinus(d, [p.stairs, p.ramp])) E.box(q[0], Y - p.t, q[1], q[2], Y, q[3], 'concrete', LM, F.WALK);
      for (const q of rectMinus(cl, [d])) E.box(q[0], 0, q[1], q[2], this.curbH, q[3], 'sidewalk', 'sidewalk', F.WALK);
      this._groundRect(E, d, 'gravel_roof');
      E.ramp(p.stairs[0], p.stairs[1], p.stairs[2], p.stairs[3], 0, Y, 'x', -1, 'stair_stone', 'stair', 0, Y);
      E.ramp(p.ramp[0], p.ramp[1], p.ramp[2], p.ramp[3], 0, Y, 'z', -1, 'asphalt_city', 'road', 0, 0.8);
      this._ring(E, d, Y, 1.1, 'glass_rail', F.NOLOS, [['e', p.stairs[1], p.stairs[3]], ['s', p.ramp[0], p.ramp[2]]]);
      for (const t of p.towers) {
        E.box(t[0], 0, t[1], t[2], t[4], t[3], 'glass_tower', LM, F.WALK, this.M.roof);
        this._ring(E, [t[0], t[1], t[2], t[3]], t[4], 1.2, 'glass_tower', 0);
      }
      const e = p.edge;
      E.box(e[0], e[4] - 0.8, e[1], e[2], e[4], e[3], 'concrete', LM, F.WALK);
      E.box(e[2] - 0.2, e[4], e[1], e[2], e[4] + 1.2, e[3], 'glass_rail', LM, F.NOLOS);
      E.box(e[0], e[4], e[1], e[2], e[4] + 1.2, e[1] + 0.2, 'glass_rail', LM, F.NOLOS);
      E.box(e[0], e[4], e[3] - 0.2, e[2], e[4] + 1.2, e[3], 'glass_rail', LM, F.NOLOS);
      this._loots(E, 1, [e[0] + 2, e[1] + 2, e[2] - 2, e[3] - 2], e[4], 'roof', 131);
      const v = p.vessel;
      this._ent(E, { id: 'hy_vessel', x0: v[0] - 6, z0: v[1] - 8, x1: v[0] + 6, z1: v[1] + 8, front: 's', floors: 4, fh: 3.6, by: Y, ground: Y, seed: hash(this.seed, 45, 0, 0), shell: 'metalDark', open: true, ladder: false, noSideDoors: true });
      // 柱と、下の操車場
      const holes = p.towers.map((t) => [t[0] - 2, t[1] - 2, t[2] + 2, t[3] + 2]).concat([[p.stairs[0] - 3, p.stairs[1] - 3, p.stairs[2] + 3, p.stairs[3] + 3], [p.ramp[0] - 3, p.ramp[1] - 3, p.ramp[2] + 3, p.ramp[3] + 3]]);
      for (let x = d[0] + 6; x < d[2] - 4; x += p.columns) for (let z = d[1] + 6; z < d[3] - 4; z += p.columns) {
        if (holes.some((h) => rInside(x, z, h))) continue;
        E.box(x - 0.6, 0, z - 0.6, x + 0.6, Y - p.t, z + 0.6, 'concrete', LM, 0);
      }
      for (let x = d[0] + 10; x < d[2] - 6; x += 6) E.decal({ type: 'track', x, z: (d[1] + d[3]) / 2, w: 3, d: d[3] - d[1] - 20, rot: 0 });
      const rnd = rng(hash(this.seed, 46, 0, 0));
      for (let i = 0; i < 5; i++) {
        const x = d[0] + 10 + 6 * rnd.int(0, Math.floor((d[2] - d[0] - 20) / 6)), z = rnd.range(d[1] + 20, d[3] - 30);
        if (holes.some((h) => rOverlap([x - 2, z - 2, x + 2, z + 18], h))) continue;
        E.box(x - 1.5, 0, z, x + 1.5, 4.2, z + 16, 'container', LM, F.WALK);
        E.ladder(x, z, 0, 4.2, 0, -1);
      }
      this._loots(E, 5, [d[0] + 4, d[1] + 4, d[2] - 4, d[3] - 4], Y, 'hot', 132);
      this._loots(E, 3, [d[0] + 4, d[1] + 4, d[2] - 4, d[3] - 4], 0, 'hot', 133);
    },

    // 操車場（線路 + 貨車 + 柵）
    _lm_railyard(E, p, lm) {
      const r = lm.claim, alongZ = (r[3] - r[1]) >= (r[2] - r[0]), LM = 'landmark';
      this._groundRect(E, r, 'gravel_roof');
      const len = alongZ ? r[3] - r[1] : r[2] - r[0], wid = alongZ ? r[2] - r[0] : r[3] - r[1];
      const n = Math.min(p.tracks, Math.floor((wid - 12) / 6));
      const tp = (i) => (alongZ ? r[0] : r[1]) + 6 + (wid - 12) * (i + 0.5) / n;
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < len - 8; s += 60) {
          const a = s + 4, b = Math.min(len - 4, s + 64);
          if (alongZ) E.decal({ type: 'track', x: tp(i), z: r[1] + (a + b) / 2, w: 3, d: b - a, rot: 0 });
          else E.decal({ type: 'track', x: r[0] + (a + b) / 2, z: tp(i), w: 3, d: b - a, rot: Math.PI / 2 });
        }
      }
      const rnd = rng(hash(this.seed, 47, strHash(lm.id), 0));
      const placed = [];
      for (let k = 0; k < p.cars * 3 && placed.length < p.cars; k++) {
        const i = rnd.int(0, n - 1), s = rnd.range(10, len - 30), c = tp(i);
        const rect = alongZ ? [c - 1.5, r[1] + s, c + 1.5, r[1] + s + 16] : [r[0] + s, c - 1.5, r[0] + s + 16, c + 1.5];
        if (placed.some((q) => rOverlap([q[0] - 1, q[1] - 3, q[2] + 1, q[3] + 3], rect))) continue;
        placed.push(rect);
        E.box(rect[0], 0, rect[1], rect[2], 4.2, rect[3], 'container', LM, F.WALK);
        if (alongZ) E.ladder(c, rect[1], 0, 4.2, 0, -1); else E.ladder(rect[0], c, 0, 4.2, -1, 0);
      }
      // 柵（60 m ごとに 6 m の門）
      const fence = (x0, z0, x1, z1) => E.box(x0, 0, z0, x1, 2.5, z1, 'metalDark', LM, F.NOLOS);
      for (let x = r[0]; x < r[2]; x += 60) { fence(x + 3, r[1], Math.min(r[2], x + 57), r[1] + 0.1); fence(x + 3, r[3] - 0.1, Math.min(r[2], x + 57), r[3]); }
      for (let z = r[1]; z < r[3]; z += 60) { fence(r[0], z + 3, r[0] + 0.1, Math.min(r[3], z + 57)); fence(r[2] - 0.1, z + 3, r[2], Math.min(r[3], z + 57)); }
      this._loots(E, Math.max(2, Math.floor(placed.length / 2)), [r[0] + 4, r[1] + 4, r[2] - 4, r[3] - 4], 0, 'street', 140 + (strHash(lm.id) & 15));
    },

    // 岸のガントリークレーン跡（脚 4 本 + 上の梁。梯子で登れる）
    _lm_gantry(E, p) {
      for (const it of p.items) {
        const x = it[0], z = it[1], h = p.h, hs = p.span / 2;
        for (const dx of [-hs + 2, hs - 2]) for (const dz of [-4, 4]) E.box(x + dx - 0.75, 0, z + dz - 0.75, x + dx + 0.75, h - 2, z + dz + 0.75, 'metalDark', 'landmark', 0);
        E.box(x - hs, h - 2, z - 4.75, x + hs, h, z + 4.75, 'metalDark', 'landmark', F.WALK);
        E.ladder(x + hs - 2, z + 4.75, 0, h, 0, 1);
        E.lootAt(x + 0.5, h, z + 0.5, 'roof');
      }
    },

    // フラットアイアン風のくさび形（4 m ごとの箱で斜めの辺を作る）
    _lm_flatiron(E, p) {
      const top = this.curbH + p.floors * p.floorH;
      for (let z = p.z0; z < p.z1 - 0.01; z += p.slice) {
        const xe = Math.floor(this.bwRange(z, z + p.slice, this.sidewalk)[0]);
        if (xe - p.x0 < 3) continue;
        E.box(p.x0, 0, z, xe, top, z + p.slice, 'limestone', 'landmark', F.WALK, this.M.roof);
      }
    },

    // 公園のボートハウス（入れる 2 階建て + 湖の桟橋）
    _lm_boathouse(E, p) {
      const r = p.rect;
      this._ent(E, { id: 'boathouse', x0: r[0], z0: r[1], x1: r[2], z1: r[3], front: 's', floors: p.floors, fh: p.floorH, by: 0, ground: 0, seed: hash(this.seed, 48, 0, 0), shell: 'brick_red', floorMat: 'wood_floor' });
      const d = p.dock;
      E.box(d[0], -0.6, d[1], d[2], 0, d[3], 'crate', 'pier', F.WALK);
    },

    // 停泊中の船（見た目は landmarks2、原点は喫水線。当たりは船体 + 船室の箱）
    _lm_boats(E, p) {
      for (const k of ['ferry', 'tug']) {
        const b = p[k];
        if (!b) continue;
        const L = this._local(E, b[0], this.waterY, b[1], b[2]), hl = b[3] / 2, hb = b[4] / 2;
        E.tag = k === 'ferry' ? 'ferry_boat' : 'tugboat';
        L.box(-hb, -1.5, -hl, hb, b[5], hl, 'hull_grey', 'landmark', F.WALK);
        L.box(-hb * 0.8, b[5], -hl * 0.6, hb * 0.8, b[5] + 2.8, hl * 0.4, 'hull_grey', 'landmark', F.WALK);
        E.tag = null;
        E.place(k === 'ferry' ? 'ferry_boat' : 'tugboat', 'landmarks2', b[0], this.waterY, b[1], b[2] * Math.PI / 180);
      }
    }
  });

  // ---------- チャンクの組み立てと公開 API ----------
  const ROT = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 };
  Object.assign(CityGen.prototype, {
    // 地下鉄の入口（交差点の南東の角、大通りの歩道）
    _initSubways() {
      const sb = this.plan.subway || { avenues: [], streets: [] };
      this.subways = [];
      for (const it of this.inters) {
        if (it.q || sb.avenues.indexOf(it.ave) < 0 || sb.streets.indexOf(it.n) < 0) continue;
        const x = it.x + it.w / 2 + 2.2, z = it.z + it.d / 2 + 7;
        const rect = [x - 1.62, z - 3, x + 1.62, z + 3];
        if (this._claimed(rect) || this._inGap(x, z) || !this.isLand(x, z) || this.onBroadway(x, z, 3)) continue;
        this.subways.push({ x, z, rect, it: it.id });
      }
    },
    _subBlocked(x, z, m) {
      for (const s of this.subways) if (x > s.rect[0] - m && x < s.rect[2] + m && z > s.rect[1] - m && z < s.rect[3] + m) return true;
      return false;
    },

    // 街区の歩道（縁石の高さの箱）。チャンクで切り、公園などの穴とブロードウェイの車道を抜く
    _genPlinth(E, c, cr) {
      const r = rInter(c.rect, cr);
      if (!rValid(r, 0.05)) return;
      const ch = this.curbH;
      for (const q of rectMinus(r, c.holes)) {
        let pieces = [q];
        if (c.kind === 'M') {
          const band = this.bwRange(q[1], q[3], 0);
          if (band[0] < q[2] && q[0] < band[1]) {
            pieces = [];
            const z0 = Math.floor(q[1] / 4) * 4;
            let zs = q[1];
            for (let z = z0; z < q[3]; z += 4) {
              const a = Math.max(q[1], z), b = Math.min(q[3], z + 4);
              if (b - a < 0.01) continue;
              const bb = this.bwRange(a, b, 0);
              if (this._bwIsPlaza((a + b) / 2) || !(bb[0] < q[2] && q[0] < bb[1])) continue;
              if (a > zs) pieces.push([q[0], zs, q[2], a]);
              if (bb[0] > q[0]) pieces.push([q[0], a, Math.min(q[2], bb[0]), b]);
              if (bb[1] < q[2]) pieces.push([Math.max(q[0], bb[1]), a, q[2], b]);
              zs = b;
            }
            if (zs < q[3]) pieces.push([q[0], zs, q[2], q[3]]);
          }
        }
        for (const s of pieces) if (rValid(s, 0.05)) E.box(s[0], 0, s[1], s[2], ch, s[3], 'sidewalk', 'sidewalk', F.WALK);
      }
    },

    // 車道（四角形）と車線・マンホール・補修跡のデカール
    _genRoad(E, rd, cr) {
      if (!rd.rect) {
        E.road(rd.kind, rd.pts, rd.mat);
        if (rd.kind !== 'plaza') E.decal({ type: 'lanes', x: r2((rd.pts[0][0] + rd.pts[2][0]) / 2), z: r2((rd.pts[0][1] + rd.pts[2][1]) / 2), pts: rd.pts.map((p) => [r2(p[0]), r2(p[1])]), lanes: rd.lanes, axis: rd.axis });
        return;
      }
      const q = rInter(rd.rect, cr);
      if (!rValid(q, 0.05)) return;
      E.road(rd.kind, [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]], 'asphalt_city');
      E.decal({ type: 'lanes', x: r2((q[0] + q[2]) / 2), z: r2((q[1] + q[3]) / 2), w: r2(q[2] - q[0]), d: r2(q[3] - q[1]), axis: rd.axis, lanes: rd.lanes, median: rd.median || 0 });
      const along = rd.axis === 'z', a0 = along ? q[1] : q[0], a1 = along ? q[3] : q[2];
      const c = along ? (rd.rect[0] + rd.rect[2]) / 2 : (rd.rect[1] + rd.rect[3]) / 2;
      for (let k = Math.floor(a0 / 32); k * 32 < a1; k++) {
        const h = hash(this.seed, 81, rd.id, k), u = (h & 1023) / 1023, v = ((h >>> 10) & 1023) / 1023;
        const s = k * 32 + u * 32;
        if (s < a0 || s >= a1) continue;
        const off = (v - 0.5) * (rd.w - 4);
        const x = along ? c + off : s, z = along ? s : c + off;
        if (this.onBroadway(x, z, 2) && rd.kind !== 'broadway') continue;
        if ((h >>> 20) % 10 < 6) E.decal({ type: 'manhole', x: r2(x), z: r2(z), w: 0.9, d: 0.9, rot: r2(v * 6.28) });
        else if ((h >>> 20) % 10 < 9) E.decal({ type: 'patch', x: r2(x), z: r2(z), w: r2(along ? 1.2 + v * 2.5 : 1.5 + u * 2.5), d: r2(along ? 1.5 + u * 2.5 : 1.2 + v * 2.5), rot: 0 });
      }
    },

    // 交差点: 横断歩道・信号・地下鉄の入口
    _genInter(E, it) {
      const ch = this.curbH, hw = it.w / 2, hd = it.d / 2;
      const roadAt = (x, z) => !this._inGap(x, z) && this.isLand(x, z);
      if (roadAt(it.x, it.z - hd - 6)) E.decal({ type: 'crosswalk', x: it.x, z: r2(it.z - hd - 1.75), w: it.w, d: 3, rot: 0 });
      if (roadAt(it.x, it.z + hd + 6)) E.decal({ type: 'crosswalk', x: it.x, z: r2(it.z + hd + 1.75), w: it.w, d: 3, rot: 0 });
      if (roadAt(it.x - hw - 6, it.z)) E.decal({ type: 'crosswalk', x: r2(it.x - hw - 1.75), z: it.z, w: 3, d: it.d, rot: Math.PI / 2 });
      if (roadAt(it.x + hw + 6, it.z)) E.decal({ type: 'crosswalk', x: r2(it.x + hw + 1.75), z: it.z, w: 3, d: it.d, rot: Math.PI / 2 });
      const sig = (x, z, rot) => {
        if (!this.isLand(x, z) || this._inGap(x, z) || this.onBroadway(x, z, 1) || this._kept(x, z) || this._claimed([x - 1, z - 1, x + 1, z + 1])) return;
        E.prop('traffic_signal', x, ch, z, rot);
        E.box(x - 0.2, ch, z - 0.2, x + 0.2, ch + 7, z + 0.2, 'metalDark', 'prop', 0);
      };
      sig(it.x + hw + 0.8, it.z - hd - 0.8, -Math.PI / 2);
      sig(it.x - hw - 0.8, it.z + hd + 0.8, Math.PI / 2);
      for (const s of this.subways) if (s.it === it.id) {
        E.prop('subway_entrance', s.x, ch, s.z, Math.PI);
        E.box(s.rect[0], ch, s.rect[1], s.rect[2], ch + 1.2, s.rect[3], 'metalDark', 'prop', 0);
      }
    },

    // 街区のまわりの歩道の小物（街灯・街路樹・消火栓・ゴミ箱・ポスト・売店・公衆端末・ベンチ・路上駐車）と路上の戦利品
    _genCellStreet(E, c) {
      const rule = this.plan.rules[c.rule] || { trees: 0.5, newsstand: 0, parked: 0.3 };
      const rnd = rng(hash(this.seed, 91, c.key, 0));
      const r = c.rect, ch = this.curbH, lc = this.plan.loot;
      const hot = this._hotAt((r[0] + r[2]) / 2, (r[1] + r[3]) / 2) >= 0;
      const bad = (x, z, m) => !this.isLand(x, z) || this._kept(x, z, m) || this._subBlocked(x, z, m + 0.6) || (this.onBroadway(x, z, m + 1) && !this._bwIsPlaza(z)) ||
        this.claims.some((q) => (q.kind === 'bridge' || q.kind === 'viaduct' || q.kind === 'park') && rInside(x, z, q.rect)) || c.holes.some((h) => rInside(x, z, h));
      const lootSides = [];
      for (const side of ['n', 's', 'w', 'e']) {
        if (!c.road[side]) continue;
        const ns = side === 'n' || side === 's', Ls = ns ? r[2] - r[0] : r[3] - r[1];
        if (Ls < 10) continue;
        const avenue = !ns;
        const pos = (s, d) => {
          if (side === 'n') return [r[0] + s, r[1] + d];
          if (side === 's') return [r[2] - s, r[3] - d];
          if (side === 'w') return [r[0] + d, r[3] - s];
          return [r[2] - d, r[1] + s];
        };
        lootSides.push([pos, Ls]);
        if (!E.geom) continue;
        const rot = ROT[side];
        const occ = [];
        const free = (s, m) => { for (const o of occ) if (s > o[0] - m && s < o[1] + m) return false; return true; };
        const put = (s, d, m, fn) => {
          if (s < 3 || s > Ls - 3 || !free(s, m)) return false;
          const p = pos(s, d);
          if (bad(p[0], p[1], m)) return false;
          occ.push([s - m, s + m]);
          fn(p[0], p[1]);
          return true;
        };
        for (let s = 6; s < Ls - 4; s += 30) put(s, 0.7, 0.8, (x, z) => this._lamp(E, 'streetlight', x, ch, z, rot));
        if (rnd() < rule.trees) for (let s = 11; s < Ls - 5; s += 9) put(s, 1.3, 1.4, (x, z) => this._tree(E, x, ch, z, rnd() * 6.28));
        if (rnd() < 0.7) put(rnd() < 0.5 ? 8 : Ls - 8, 0.6, 0.6, (x, z) => { E.prop('hydrant', x, ch, z, rot); E.box(x - 0.25, ch, z - 0.25, x + 0.25, ch + 0.77, z + 0.25, 'barrel', 'prop', 0); });
        for (const s of [3.5, Ls - 3.5]) if (rnd() < 0.6) put(s, 1.0, 0.6, (x, z) => { E.prop('trash_can', x, ch, z, rot); E.box(x - 0.32, ch, z - 0.32, x + 0.32, ch + 0.89, z + 0.32, 'metalDark', 'prop', 0); });
        if (rnd() < 0.3) put(rnd.range(10, Ls - 10), 0.8, 0.6, (x, z) => { E.prop('mailbox', x, ch, z, rot); E.box(x - 0.27, ch, z - 0.27, x + 0.27, ch + 1.2, z + 0.27, 'metalDark', 'prop', 0); });
        if (avenue && rnd() < rule.newsstand) put(rnd() < 0.5 ? 14 : Ls - 14, 1.4, 2.0, (x, z) => {
          E.prop('newsstand', x, ch, z, rot);
          if (ns) E.box(x - 1.5, ch, z - 0.8, x + 1.5, ch + 2.45, z + 0.8, 'container2', 'prop', F.WALK);
          else E.box(x - 0.8, ch, z - 1.5, x + 0.8, ch + 2.45, z + 1.5, 'container2', 'prop', F.WALK);
        });
        if (avenue && rnd() < 0.25) put(rnd.range(12, Ls - 12), 0.8, 0.7, (x, z) => { E.prop('phone_kiosk', x, ch, z, rot); E.box(x - 0.48, ch, z - 0.48, x + 0.48, ch + 2.85, z + 0.48, 'metalDark', 'prop', 0); });
        if (rnd() < 0.15) put(rnd.range(10, Ls - 10), 1.6, 1.1, (x, z) => {
          E.prop('bench', x, ch, z, rot + Math.PI);
          if (ns) E.box(x - 0.92, ch, z - 0.3, x + 0.92, ch + 0.5, z + 0.3, 'crate', 'prop', F.WALK);
          else E.box(x - 0.3, ch, z - 0.92, x + 0.3, ch + 0.5, z + 0.92, 'crate', 'prop', F.WALK);
        });
        // 路上駐車（大通りの縁の車線。小物）
        if (avenue && rnd() < rule.parked) {
          const n = rnd.int(1, 3);
          for (let i = 0; i < n; i++) {
            const s = rnd.range(14, Math.max(14.1, Ls - 14));
            const p = pos(s, -1.5);
            if (bad(p[0], p[1], 3) || this._inGap(p[0], p[1])) continue;
            const type = rnd() < 0.5 ? 'taxi' : 'sedan';
            E.prop(type, p[0], 0, p[1], rnd() < 0.5 ? 0 : Math.PI);
            E.box(p[0] - 0.92, 0, p[1] - 2.43, p[0] + 0.92, 1.45, p[1] + 2.43, 'metalDark', 'prop', F.WALK);
          }
        }
      }
      // 路上の戦利品（小物とは別の乱数。歩道の中ほど d = 3.2 m: 小物は縁石から 2.2 m まで、日よけの柱は 2.55 m）
      const lr = rng(hash(this.seed, 92, c.key, 0));
      const nl = hot ? lc.hotStreet : (lr() < lc.streetPerBlock ? 1 : 0);
      for (let i = 0, t = 0; i < nl && t < nl * 4 && lootSides.length; t++) {
        const sd = lootSides[lr.int(0, lootSides.length - 1)], s = lr.range(5, sd[1] - 5);
        const p = sd[0](s, 3.2);
        const x = Math.floor(p[0] * 2) / 2 + 0.25, z = Math.floor(p[1] * 2) / 2 + 0.25;
        if (bad(x, z, 0.8)) continue;
        E.lootAt(x, ch, z, hot ? 'hot' : 'street');
        i++;
      }
    },

    // 1 区画
    _genLot(E, L) {
      const B = this.B, M = this.M, lc = this.plan.loot;
      if (L.kind === 'open') return this._genOpen(E, L);
      if (L.kind === 'parking') return this._genParking(E, L);
      if (L.kind === 'canopy') return this._genCanopy(E, L);
      let door = null;
      if (L.ent) {
        const hot = L.hot >= 0, wh = L.kind === 'warehouse';
        door = genEnterable(E, {
          id: L.id, kind: L.kind, x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z1, front: L.front, exp: L.exp, by: L.by, ground: L.by, floors: L.floors, fh: L.fh, seed: L.seed,
          shell: M.shell[L.mat] || 'concrete', floorMat: wh ? 'concrete' : M.floors[L.seed % M.floors.length], intMat: M.interior, roofMat: M.roof, stairMat: M.stair,
          lootTable: hot ? 'hot' : 'interior', lootCount: hot ? lc.hotPerFloor : lc.perFloor, roofTable: 'roof', roofChance: lc.roofChance,
          tank: L.tank, doorW: wh ? 4 : 2, doorH: wh ? 4.2 : 2.4, sill: wh ? 2.4 : null, winH: wh ? 1.8 : null, open: wh, crates: wh ? 5 : 0
        }, B);
      } else genSolid(E, L, B, { M });
      if (L.shed) this._genShed(E, L, door && door.door, L.kind === 'warehouse' ? 4 : 2);
    },
    // 歩道の仮囲い（足場）。door（入れる建物の扉の前の点）があれば、扉の前の壁際の柱は立てない（入口をふさがない）
    _genShed(E, L, door, doorW) {
      const fr = new Frame(L.x0, L.z0, L.x1, L.z1, L.front), by = L.by;
      const nx = fr.nx(0, -1), nz = fr.nz(0, -1), rot = Math.atan2(nx, nz);
      const tx = -nz, tz = nx; // 正面に沿う向き
      for (let u = 1; u + 6 <= fr.W - 1; u += 6) {
        const cx = fr.x(u + 3, -1.3), cz = fr.z(u + 3, -1.3);
        if (this._subBlocked(cx, cz, 1)) continue;
        E.prop('sidewalk_shed', cx, by, cz, rot);
        fr.box(E, u, -2.6, u + 6, 0, by + 2.86, by + 3.06, 'crate', 'prop', F.WALK);
        for (const pu of [u + 1.5, u + 4.5]) for (const pv of [-0.15, -2.45]) {
          if (door && pv > -1 && Math.abs((fr.x(pu, pv) - door[0]) * tx + (fr.z(pu, pv) - door[2]) * tz) < (doorW || 2) / 2 + 0.6) continue;
          fr.box(E, pu - 0.05, pv - 0.05, pu + 0.05, pv + 0.05, by, by + 2.86, 'metalDark', 'prop', 0);
        }
      }
    },
    _genOpen(E, L) {
      const rnd = rng(L.seed), by = L.by;
      const W = L.x1 - L.x0, D = L.z1 - L.z0;
      const trees = [];
      for (let i = 0; i < Math.min(3, Math.floor(W * D / 120)); i++) {
        const x = L.x0 + rnd.range(2, W - 2), z = L.z0 + rnd.range(2, D - 2);
        if (!this._kept(x, z)) { trees.push([x, z]); this._tree(E, x, by, z, rnd() * 6.28); }
      }
      const crate = rnd() < 0.5;
      const cx = Math.floor(L.x0 + W / 2) + 0.5, cz = Math.floor(L.z0 + D / 2) + 0.5;
      if (crate) {
        E.prop('crate', cx, by, cz, 0);
        E.box(cx - 0.62, by, cz - 0.62, cx + 0.62, by + 1.25, cz + 0.62, 'crate', 'prop', F.WALK);
      }
      if (rnd() < 0.35) {
        const lx = Math.floor(L.x0 + 2) + 0.5, lz = Math.floor(L.z0 + 2) + 0.5;
        if (!trees.some((t) => Math.hypot(t[0] - lx, t[1] - lz) < 0.9) && !(crate && Math.abs(cx - lx) < 1.3 && Math.abs(cz - lz) < 1.3)) E.lootAt(lx, by, lz, L.hot >= 0 ? 'hot' : 'street');
      }
    },
    _genParking(E, L) {
      const rnd = rng(L.seed), by = L.by, W = L.x1 - L.x0, D = L.z1 - L.z0;
      const alongX = W >= D;
      const rows = Math.floor(((alongX ? D : W) - 4) / 6);
      for (let i = 0; i < rows; i++) {
        const n = Math.floor(((alongX ? W : D) - 4) / 2.8);
        for (let j = 0; j < n; j++) {
          if (rnd() > 0.55) continue;
          const a = 2 + 1.4 + j * 2.8, b = 2 + 3 + i * 6;
          const x = alongX ? L.x0 + a : L.x0 + b, z = alongX ? L.z0 + b : L.z0 + a;
          if (this._kept(x, z, 2)) continue;
          E.prop(rnd() < 0.4 ? 'taxi' : 'sedan', x, by, z, alongX ? (i % 2 ? 0 : Math.PI) : (i % 2 ? Math.PI / 2 : -Math.PI / 2));
          if (alongX) E.box(x - 0.92, by, z - 2.43, x + 0.92, by + 1.45, z + 2.43, 'metalDark', 'prop', F.WALK);
          else E.box(x - 2.43, by, z - 0.92, x + 2.43, by + 1.45, z + 0.92, 'metalDark', 'prop', F.WALK);
        }
      }
      const fr = new Frame(L.x0, L.z0, L.x1, L.z1, L.front);
      for (let u = 1; u + 3 <= fr.W - 1; u += 3.2) {
        if (u > fr.W / 2 - 4 && u < fr.W / 2 + 4) continue;
        const cx = fr.x(u + 1.5, 0.4), cz = fr.z(u + 1.5, 0.4);
        E.prop('jersey_barrier', cx, by, cz, Math.atan2(fr.nx(0, -1), fr.nz(0, -1)) + Math.PI / 2);
        fr.box(E, u, 0.1, u + 3, 0.7, by, by + 0.81, 'concrete', 'prop', 0);
      }
      if (rnd() < 0.4) E.lootAt(fr.x(fr.W / 2, 1.5), by, fr.z(fr.W / 2, 1.5), L.hot >= 0 ? 'hot' : 'street');
    },
    _genCanopy(E, L) {
      const t = L.tiers[0], by = L.by;
      E.box(t[0], t[4], t[1], t[2], t[5], t[3], 'concrete', 'exterior', F.WALK);
      for (const x of [t[0] + 1, t[2] - 1]) for (const z of [t[1] + 1, t[3] - 1]) E.box(x - 0.3, by, z - 0.3, x + 0.3, t[4], z + 0.3, 'concrete', 'exterior', 0);
      const cx = (t[0] + t[2]) / 2, cz = (t[1] + t[3]) / 2;
      for (const dx of [-4, 4]) E.box(cx + dx - 0.5, by, cz - 2, cx + dx + 0.5, by + 1.6, cz + 2, 'metalDark', 'prop', F.WALK);
      E.ladder(t[0], cz + 0.5, by, t[5], -1, 0);
      E.lootAt(Math.floor(cx) + 0.5, t[5], Math.floor(cz) + 0.5, 'roof');
    },

    // セントラルパークの 32 m セル（木・岩・街灯・ベンチ・戦利品）
    _genParkCells(E, p, cr) {
      const pc = this.engine.parkCell || 32, sw = this.sidewalk;
      const inner = [p.rect[0] + sw + 1, p.rect[1] + sw + 1, p.rect[2] - sw - 1, p.rect[3] - sw - 1];
      const i0 = Math.floor((Math.max(cr[0], inner[0]) - this.minX) / pc), i1 = Math.floor((Math.min(cr[2], inner[2]) - this.minX - 0.001) / pc);
      const j0 = Math.floor((Math.max(cr[1], inner[1]) - this.minZ) / pc), j1 = Math.floor((Math.min(cr[3], inner[3]) - this.minZ - 0.001) / pc);
      const d = p.drive, dr = d ? [[d.x[0] - d.w, d.z[1] - d.w, d.x[0] + d.w, d.z[0] + d.w], [d.x[1] - d.w, d.z[1] - d.w, d.x[1] + d.w, d.z[0] + d.w],
        [d.x[0], d.z[0] - d.w, d.x[1], d.z[0] + d.w], [d.x[0], d.z[1] - d.w, d.x[1], d.z[1] + d.w]] : [];
      const paths = (p.paths || []).map((q) => [q[0] - 2.5, q[1] - 2.5, q[2] + 2.5, q[3] + 2.5]);
      const claims = this.claims.filter((c) => c.kind !== 'park' && rOverlap(c.rect, p.rect)).map((c) => c.rect);
      const blocked = (x, z, m) => !rInside(x, z, inner) || dr.some((q) => rInside(x, z, q)) || paths.some((q) => rInside(x, z, q)) || claims.some((q) => rInside(x, z, [q[0] - m, q[1] - m, q[2] + m, q[3] + m])) ||
        this._kept(x, z, m) || this.lakes.some((l) => rInside(x, z, [l.bb[0] - 6, l.bb[1] - 6, l.bb[2] + 6, l.bb[3] + 6]) && (pointInPoly(x, z, l.poly) || distToPoly(x, z, l.poly) < 3 + m));
      const inMeadow = (x, z) => (p.meadows || []).some((q) => rInside(x, z, q));
      const woods = (x, z) => { for (const w of p.woods || []) if (rInside(x, z, w)) return w[4]; return 1; };
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x0 = this.minX + i * pc, z0 = this.minZ + j * pc, cx = x0 + pc / 2, cz = z0 + pc / 2;
        if (cx < cr[0] || cx >= cr[2] || cz < cr[1] || cz >= cr[3]) continue;
        const hot = this._hotAt(cx, cz) >= 0, lr = rng(hash(this.seed, 62, i, j));
        if (lr() < (hot ? 0.3 : this.plan.loot.parkPerCell)) {
          const x = Math.floor(x0 + lr.range(3, pc - 3)) + 0.5, z = Math.floor(z0 + lr.range(3, pc - 3)) + 0.5;
          if (!blocked(x, z, 1) && !this._parkLootBlocked(p, i, j, x, z)) E.lootAt(x, 0, z, hot ? 'hot' : 'park');
        }
        if (!E.geom) continue;
        const rnd = rng(hash(this.seed, 61, i, j));
        const dens = inMeadow(cx, cz) ? 0 : p.treeDensity * woods(cx, cz);
        const nt = Math.floor(dens * 3 + rnd());
        for (let k = 0; k < nt; k++) {
          const x = x0 + rnd.range(1, pc - 1), z = z0 + rnd.range(1, pc - 1);
          if (blocked(x, z, 2) || inMeadow(x, z)) continue;
          this._tree(E, x, 0, z, rnd() * 6.28);
        }
        if (rnd() < p.rockChance && !inMeadow(cx, cz)) {
          const x = x0 + rnd.range(6, pc - 6), z = z0 + rnd.range(6, pc - 6);
          if (!blocked(x, z, 5)) {
            const n = rnd.int(1, 3);
            for (let k = 0; k < n; k++) {
              const w = rnd.range(2, 7), dd = rnd.range(2, 6), h = rnd.range(1, 3.5) / (k + 1);
              const ox = rnd.range(-2, 2), oz = rnd.range(-2, 2);
              E.box(x + ox - w / 2, 0, z + oz - dd / 2, x + ox + w / 2, h + k * 0.8, z + oz + dd / 2, 'rock', 'landmark', F.WALK);
            }
          }
        }
        // 小道の街灯とベンチ（道沿いの世界座標の等間隔。セルの中に落ちたものだけ）
        for (const q of p.paths || []) {
          const alongX = q[2] - q[0] > q[3] - q[1];
          const a0 = alongX ? Math.max(q[0], x0) : Math.max(q[1], z0), a1 = alongX ? Math.min(q[2], x0 + pc) : Math.min(q[3], z0 + pc);
          if (a1 <= a0) continue;
          const c0 = alongX ? q[1] : q[0], c1 = alongX ? q[3] : q[2];
          if ((alongX ? c1 : c1) < (alongX ? z0 - 2 : x0 - 2) || c0 > (alongX ? z0 + pc + 2 : x0 + pc + 2)) continue;
          for (let s = Math.ceil(a0 / p.lampEvery) * p.lampEvery; s < a1; s += p.lampEvery) {
            const x = alongX ? s : c1 + 1, z = alongX ? c1 + 1 : s;
            if (x < x0 || x >= x0 + pc || z < z0 || z >= z0 + pc || this._kept(x, z)) continue;
            if (!this.isWater(x, z)) this._lamp(E, 'park_lamp', x, 0, z, 0);
          }
          for (let s = Math.ceil(a0 / p.benchEvery) * p.benchEvery + 7; s < a1; s += p.benchEvery) {
            const x = alongX ? s : c0 - 1.2, z = alongX ? c0 - 1.2 : s;
            if (x < x0 || x >= x0 + pc || z < z0 || z >= z0 + pc || this._kept(x, z) || this.isWater(x, z)) continue;
            E.prop('bench', x, 0, z, alongX ? 0 : Math.PI / 2);
            if (alongX) E.box(x - 0.92, 0, z - 0.3, x + 0.92, 0.5, z + 0.3, 'crate', 'prop', F.WALK);
            else E.box(x - 0.3, 0, z - 0.92, x + 0.3, 0.5, z + 0.92, 'crate', 'prop', F.WALK);
          }
        }
      }
    },
    // 公園セルの戦利品がそのセルの木・岩に重ならないか（木と岩の位置だけ同じ乱数で作り直して見る）
    _parkLootBlocked(p, i, j, lx, lz) {
      const pc = this.engine.parkCell || 32, x0 = this.minX + i * pc, z0 = this.minZ + j * pc, cx = x0 + pc / 2, cz = z0 + pc / 2;
      const rnd = rng(hash(this.seed, 61, i, j));
      const inMeadow = (x, z) => (p.meadows || []).some((q) => rInside(x, z, q));
      let w = 1;
      for (const q of p.woods || []) if (rInside(cx, cz, q)) { w = q[4]; break; }
      const dens = inMeadow(cx, cz) ? 0 : p.treeDensity * w;
      const nt = Math.floor(dens * 3 + rnd());
      for (let k = 0; k < nt; k++) { const x = x0 + rnd.range(1, pc - 1), z = z0 + rnd.range(1, pc - 1); if (Math.hypot(x - lx, z - lz) < 0.9) return true; }
      if (rnd() < p.rockChance && !inMeadow(cx, cz)) { const x = x0 + rnd.range(6, pc - 6), z = z0 + rnd.range(6, pc - 6); if (Math.hypot(x - lx, z - lz) < 9) return true; }
      // 道の街灯とベンチは道の脇（道の矩形 + 2.5 m は blocked で除外済み）
      return false;
    },

    // セントラルパークの芝（小道と園内の車道を抜く。湖は holes の多角形で抜く = 描画側）
    _centralGround(E, p, cr) {
      if (p.kind !== 'central') return;
      const q = rInter([p.rect[0] + this.sidewalk, p.rect[1] + this.sidewalk, p.rect[2] - this.sidewalk, p.rect[3] - this.sidewalk], cr);
      if (!rValid(q)) return;
      const cuts = (p.paths || []).slice();
      const d = p.drive;
      if (d) { const hw = d.w / 2; cuts.push([d.x[0] - hw, d.z[1], d.x[0] + hw, d.z[0] + hw], [d.x[1] - hw, d.z[1], d.x[1] + hw, d.z[0] + hw], [d.x[0] + hw, d.z[0] - hw, d.x[1] - hw, d.z[0] + hw], [d.x[0] + hw, d.z[1] - hw, d.x[1] - hw, d.z[1] + hw]); }
      const holes = this.lakes.filter((l) => rOverlap(l.bb, q)).map((l) => l.id);
      for (const g of rectMinus(q, cuts)) {
        const lh = holes.filter((id) => rOverlap(this.lakes.find((l) => l.id === id).bb, g));
        E.ground.push(lh.length ? { x0: r2(g[0]), z0: r2(g[1]), x1: r2(g[2]), z1: r2(g[3]), mat: 'grass', holes: lh } : { x0: r2(g[0]), z0: r2(g[1]), x1: r2(g[2]), z1: r2(g[3]), mat: 'grass' });
      }
    },

    // ===== 公開 API =====
    _assemble(cx, cz, geom) {
      if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) return null;
      if (!this.subways) this._initSubways();
      const ci = cz * this.ncx + cx, cr = this.chunkRect(cx, cz), key = this.chunkKey(cx, cz);
      const E = new Emitter(geom);
      const st = this.sb[ci];
      if (st) {
        if (geom) for (const k of ['boxes', 'ramps', 'ladders', 'props', 'decals', 'water', 'landmarks', 'ground', 'roads']) for (const it of st[k]) E[k].push(it);
        for (const it of st.loot) E.loot.push(it);
        for (const it of st.buildings) E.buildings.push(it);
      }
      E.clip = cr;
      for (const id of this.ixCells[ci]) {
        const c = this.cells[id];
        if (geom) this._genPlinth(E, c, cr);
        this._genCellStreet(E, c);
      }
      if (geom) {
        for (const id of this.ixRoads[ci]) this._genRoad(E, this.roads[id], cr);
        for (const id of this.ixInters[ci]) this._genInter(E, this.inters[id]);
        for (const pi of this.ixParks[ci]) this._centralGround(E, this.plan.parks[pi], cr);
        for (const li of this.ixLakes[ci]) { const l = this.lakes[li]; E.water.push({ type: 'lake', id: l.id, y: l.y, x0: l.bb[0], z0: l.bb[1], x1: l.bb[2], z1: l.bb[3], poly: l.poly }); }
      }
      E.clip = null;
      for (const li of this.ixLots[ci]) this._genLot(E, this.lots[li]);
      E.clip = cr;
      for (const pi of this.ixParks[ci]) { const p = this.plan.parks[pi]; if (p.kind === 'central') this._genParkCells(E, p, cr); }
      const loot = E.loot.map((l, n) => ({ id: key + '_' + n, x: l.x, y: l.y, z: l.z, table: l.table }));
      const out = { cx, cz, key, loot };
      if (!geom) return out;
      Object.assign(out, {
        boxes: E.boxes, ramps: E.ramps, ladders: E.ladders, props: E.props, decals: E.decals, roads: E.roads, ground: E.ground, water: E.water,
        landmarks: E.landmarks, buildings: E.buildings, vehicles: this.ixVeh[ci].map((i) => this.vehicles[i])
      });
      return out;
    },
    chunkFull(cx, cz) { return this._assemble(cx, cz, true); },
    lootSpawns(cx, cz) { const r = this._assemble(cx, cz, false); return r ? r.loot : []; },
    // サーバー用の固体（ヘッダーの説明を参照）。full: 同じチャンクの chunkFull を作ってあれば渡す（作り直さない。サーバーが梯子も使う）
    chunkCoarse(cx, cz, full) {
      const f = full && full.cx === cx && full.cz === cz ? full : this.chunkFull(cx, cz);
      if (!f) return null;
      const keep = { exterior: 1, roof: 1, floor: 1, landmark: 1, pier: 1, road: 1 };
      const boxes = f.boxes.filter((b) => keep[b.cat] && !(b.f & (F.NOCOL | F.SHELL)) && Math.max(b.w, b.d) >= 2 && Math.min(b.w, b.d) >= 0.25 && !(b.h <= 1.3 && Math.min(b.w, b.d) <= 0.45));
      const ramps = f.ramps.filter((r) => r.cat === 'road' || Math.min(r.w, r.d) >= 4);
      return { cx, cz, key: f.key, boxes, ramps, ladders: [], loot: [] };
    },
    // 遠景用の外形
    chunkLod(cx, cz) {
      if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) return null;
      const ci = cz * this.ncx + cx, cr = this.chunkRect(cx, cz);
      const E = new Emitter(true);
      for (const li of this.ixLots[ci]) {
        const L = this.lots[li];
        for (const t of L.tiers) E.box(t[0], t[4], t[1], t[2], t[5], t[3], L.ent ? (this.M.shell[L.mat] || 'concrete') : L.mat, 'exterior', F.WALK, this.M.roof);
      }
      E.clip = cr;
      for (const id of this.ixCells[ci]) this._genPlinth(E, this.cells[id], cr);
      const st = this.sb[ci];
      const boxes = E.boxes;
      if (st) {
        for (const b of st.boxes) if ((b.cat === 'landmark' || b.cat === 'exterior' || b.cat === 'roof' || b.cat === 'pier' || b.cat === 'road' || b.cat === 'sidewalk') && !(b.f & F.NOCOL) && Math.max(b.w, b.d, b.h) >= 3) boxes.push(b);
      }
      return { cx, cz, key: this.chunkKey(cx, cz), boxes, ramps: st ? st.ramps.filter((r) => r.cat === 'road') : [] };
    },
    // 全体の遠景（建物 ≤ 3 箱 + ランドマークの外形）を 512 m ごとに
    skyline() {
      if (this._sky) return this._sky;
      const S = this.plan.superChunk || 512, groups = new Map();
      const add = (b) => {
        const sx = Math.floor((b.x - this.minX) / S), sz = Math.floor((b.z - this.minZ) / S), k = sx + '_' + sz;
        let g = groups.get(k);
        if (!g) { g = { key: k, sx, sz, boxes: [] }; groups.set(k, g); }
        g.boxes.push(b);
      };
      // o = 持ち主のチャンク番号（cz × ncx + cx。chunkLod / chunkFull と同じ振り分け: 区画は中心、静的な部品は部品の中心）
      for (const L of this.lots) {
        const o = this._ci((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2);
        for (const t of L.tiers) add({ x: r2((t[0] + t[2]) / 2), y: r2(t[4]), z: r2((t[1] + t[3]) / 2), w: r2(t[2] - t[0]), h: r2(t[5] - t[4]), d: r2(t[3] - t[1]), mat: L.ent ? (this.M.shell[L.mat] || 'concrete') : L.mat, o });
      }
      for (const b of this.staticSil) { const s = { x: b.x, y: b.y, z: b.z, w: b.w, h: b.h, d: b.d, mat: b.mat, o: this._ci(b.x, b.z) }; if (b.lm) s.lm = b.lm; add(s); }
      this._sky = { size: S, groups: Array.from(groups.values()).sort((a, b) => a.sz - b.sz || a.sx - b.sx) };
      return this._sky;
    },
    landmarkPlacements() { return this.staticItems.landmarks; },
    // 描画用（遠景）: チャンクの地面（芝・歩道・砂利。chunkFull().ground と同じもの）と街路樹・公園の木（chunkFull().props の tree と同じ位置）。
    // 建物は作らないので chunkFull よりずっと安い。rocks = 公園の岩（chunkFull の箱 mat 'rock' と同じ）
    chunkDecor(cx, cz) {
      if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) return null;
      const ci = cz * this.ncx + cx, cr = this.chunkRect(cx, cz);
      const E = new Emitter(true);
      const st = this.sb[ci];
      if (st) { for (const g of st.ground) E.ground.push(g); for (const p of st.props) if (p.type === 'tree') E.props.push(p); }
      E.clip = cr;
      for (const id of this.ixCells[ci]) this._genCellStreet(E, this.cells[id]);
      for (const pi of this.ixParks[ci]) this._centralGround(E, this.plan.parks[pi], cr);
      for (const pi of this.ixParks[ci]) { const p = this.plan.parks[pi]; if (p.kind === 'central') this._genParkCells(E, p, cr); }
      E.clip = null;
      for (const li of this.ixLots[ci]) { const L = this.lots[li]; if (L.kind === 'open') this._genOpen(E, L); }
      // タイムズスクエアの看板（chunkFull().decals の billboard と同じもの。看板のある区画だけ建物を作り直して取り出す）
      const bb = [];
      for (const li of this.ixLots[ci]) {
        const L = this.lots[li];
        if (!L.bb || L.ent || !L.tiers.length) continue;
        const E2 = new Emitter(true);
        genSolid(E2, L, this.B, { M: this.M });
        for (const d of E2.decals) if (d.type === 'billboard') bb.push(d);
      }
      return { cx, cz, key: this.chunkKey(cx, cz), ground: E.ground, trees: E.props.filter((p) => p.type === 'tree'), rocks: E.boxes.filter((b) => b.mat === 'rock'), billboards: bb };
    },
    // 描画用: チャンクの中身の一番高い所（遠景・区画・静的な部品の外形の上端。無ければ 0）。チャンクとカメラの距離に使う
    chunkTops() {
      if (this._tops) return this._tops;
      const t = new Float32Array(this.ncx * this.ncz);
      for (const g of this.skyline().groups) for (const b of g.boxes) if (b.o >= 0 && b.y + b.h > t[b.o]) t[b.o] = b.y + b.h;
      for (const l of this.landmarkPlacements()) { const ci = this._ci(l.x, l.z); if (ci >= 0) t[ci] = Math.max(t[ci], l.y + 60); }
      this._tops = t;
      return t;
    },
    // 地図のベクタ
    minimap() {
      if (this._mini) return this._mini;
      const z0 = this.minZ, z1 = this.maxZ;
      const man = [[interp(this.shoreW, z0), z0], [interp(this.shoreW, z1), z1]];
      const east = this.shoreE.filter((p) => p[0] > z0 && p[0] < z1).map((p) => [p[1], p[0]]);
      man.push([interp(this.shoreE, z1), z1]);
      for (let i = east.length - 1; i >= 0; i--) man.push(east[i]);
      man.push([interp(this.shoreE, z0), z0]);
      const qx0 = interp(this.shoreQ, z0), qx1 = interp(this.shoreQ, z1);
      const land = [{ id: 'manhattan', poly: man }, { id: 'queens', poly: [[qx0, z0], [this.maxX, z0], [this.maxX, z1], [qx1, z1]] }];
      for (const is of this.islands) {
        const poly = [[is.x0, is.z1], [is.x1, is.z1]];
        const zt = is.zTip - is.tipR, cx = (is.x0 + is.x1) / 2;
        for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; poly.push([r2(cx + Math.cos(a) * is.tipR), r2(zt + Math.sin(a) * is.tipR)]); }
        land.push({ id: is.id, poly });
      }
      const labels = this.hotZones.map((h) => ({ text: h.label, x: h.x, z: h.z, kind: 'hot' })).concat((this.plan.labels || []).map((l) => ({ text: l.text, x: l.x, z: l.z, kind: 'area' })));
      const br = (this.plan.landmarks || []).find((l) => l.kind === 'bridge');
      this._mini = {
        bounds: { minX: this.minX, maxX: this.maxX, minZ: this.minZ, maxZ: this.maxZ },
        land, lakes: this.lakes.map((l) => ({ id: l.id, poly: l.poly })),
        roads: this.roads.map((r) => (r.rect ? { kind: r.kind, rect: r.rect.map(r2) } : { kind: r.kind, pts: r.pts.map((p) => [r2(p[0]), r2(p[1])]) })),
        blocks: this.cells.map((c) => c.rect.map(r2)),
        parks: (this.plan.parks || []).map((p) => ({ id: p.id, rect: p.rect, label: p.label || '' })),
        piers: this.piers.map((p) => p.rect),
        bridges: br ? [{ x0: br.params.x0, z0: br.params.z - br.params.w / 2, x1: br.params.x1, z1: br.params.z + br.params.w / 2, y: br.params.deckY }] : [],
        labels, helipads: this.helipads, hotZones: this.hotZones
      };
      return this._mini;
    },
    // スポーン地点。'online' = ホットゾーンごとの候補（地面の上・水でない・箱と重ならない）、'solo' = seed で 1 つ選ぶ
    spawnPoints(mode, seed) {
      if (!this._spawns) {
        const S = this.plan.spawns || { perZone: 8, minR: 12, maxR: 0.6, clear: 0.6 }, cache = new Map(), out = [];
        const boxesNear = (x, z) => {
          const c = this.chunkOf(x, z), res = [];
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const k = (c.cx + dx) + '_' + (c.cz + dz);
            if (!cache.has(k)) cache.set(k, this.chunkFull(c.cx + dx, c.cz + dz));
            const f = cache.get(k);
            if (f) res.push(f);
          }
          return res;
        };
        this.hotZones.forEach((h, hi) => {
          const rnd = rng(hash(this.seed, 71, hi, 0));
          let n = 0;
          for (let t = 0; t < 80 && n < S.perZone; t++) {
            const a = rnd() * Math.PI * 2, rr = rnd.range(S.minR, Math.max(S.minR + 1, h.r * S.maxR));
            const x = Math.floor(h.x + Math.cos(a) * rr) + 0.5, z = Math.floor(h.z + Math.sin(a) * rr) + 0.5;
            if (this.isWater(x, z) || this._kept(x, z, 2)) continue;
            let g = this.groundY(x, z), ok = true;
            const fs = boxesNear(x, z), m = S.clear;
            for (const f of fs) for (const b of f.boxes) {
              if (b.f & F.NOCOL) continue;
              const inX = Math.abs(x - b.x) <= b.w / 2, inZ = Math.abs(z - b.z) <= b.d / 2;
              if (inX && inZ && (b.f & F.WALK) && b.y + b.h <= 0.5) g = Math.max(g, b.y + b.h);
            }
            for (const f of fs) {
              for (const b of f.boxes) {
                if (b.f & F.NOCOL) continue;
                if (Math.abs(x - b.x) > b.w / 2 + m || Math.abs(z - b.z) > b.d / 2 + m) continue;
                if (b.y + b.h > g + 0.45 && b.y < g + 2.3) { ok = false; break; }
              }
              for (const r of f.ramps) if (Math.abs(x - r.x) <= r.w / 2 + m && Math.abs(z - r.z) <= r.d / 2 + m) ok = false;
              for (const v of f.vehicles) if (Math.hypot(x - v.x, z - v.z) < 4) ok = false;
              if (!ok) break;
            }
            if (!ok) continue;
            out.push({ x, y: r2(g), z, zone: h.id });
            n++;
          }
        });
        this._spawns = out;
      }
      if (mode === 'solo') {
        const list = this._spawns;
        if (!list.length) return [];
        return [list[hash(this.seed, 72, seed | 0, 0) % list.length]];
      }
      return this._spawns;
    }
  });

  CityGen.F = F;
  CityGen.rampSurface = rampSurface;
  CityGen.hash = hash;
  CityGen.rng = rng;
  CityGen.rectMinus = rectMinus;
  MR.CityGen = CityGen;
  if (typeof module !== 'undefined' && module.exports) module.exports = CityGen;
})(typeof window !== 'undefined' ? window : globalThis);
