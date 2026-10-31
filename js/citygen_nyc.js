// 「本物のニューヨーク」の街（MR.CityGenNyc、ワールドプラン v2 = assets/levels/manhattan.json の "generator": "nyc"）と、
// どちらの街でも作れる入口 MR.CityGen.create(plan, opts)。THREE にも DOM にも依存しない（サーバーも require する）。
//   ブラウザ: citygen.js・nycdata.js・nyctiles.js の後に <script> で読む → MR.CityGenNyc / MR.CityGen.create
//   Node / Worker: require('../www/js/citygen_nyc.js') → CityGenNyc（CityGenNyc.create = CityGen.create。中で ./citygen.js・./nycdata.js
//   を require する。nyctiles.js は require しない = Worker のバンドルに fs / path を入れない。Node のツールは tools/lib/levelcity.js が読む）。入口（create）はこのファイルにだけある（citygen.js はこのファイルを知らない = 読み込みの輪にならない）。
//
// ■ 入口
//   CityGen.create(plan, opts)  plan.generator === 'nyc' なら new CityGenNyc(plan, opts)、ほかは new CityGen(plan, opts)
//   opts = { core, tiles, meta, rail, boats, gameOnly }
//     core      core.bin を NycData.decodeCore したもの。無ければ core を使う機能は空（groundAt はタイルの AREA）
//     tiles     MR.NycTiles（fromAssets = ブラウザ、fromFs = Node）。無ければ描画の層は空
//     meta      nyc.json（無ければ tiles.meta）。bounds・ホットゾーン・地名・ヘリポート・橋の元
//     rail      R4（鉄道）のフックの口（rail-r4 §3.6。無ければ何もしない。下の「R4 のフック」）
//     boats     船（フェーズ B）のフックの口。gameOnly: サーバー用（chunkFull は core だけの層 = タイルを待たない・使わない）
//
// ■ 層
//   ゲームの層（core だけ = サーバーとクライアントで同じ）: 入れる建物（core ENTB → CityGen.lib.genEnterable。enterable.chance で gid ごとに決める。
//     入れない ENTB / genEnterable が null → 片の E 外形を 1 つの柱）、橋・高架の床（core DECK: 平らな上面の柱 + 外側の縁の低い壁。
//     片はどのチャンクも自分の分をチャンクの矩形で切る = 切り口は clip。長い片（クイーンズボロ橋は 547 m）が持ち主のチャンクの外へはみ出さない）、
//     ヘリパッドの印（core HPAD・nyc.json heliports）、落ちている物（入れる建物の中 + 歩道の出現地点 SPWN から。id "cx_cz_n"）。
//   描画の層（タイル v2。ブラウザではタイルが無ければ chunkFull は null）: CPRS → prisms（R 外形、チャンクで切った切り口 clip）/ rect は k 0 の箱、
//     CBLK → 歩道・広場の台（上面 y、厚さ curbH、WALK）、CDEC → 路面の印（decals）、CPRP → 小物（props + 当たりの箱）と柵（薄い箱 / 4 角の柱）。
//   橋・高架の床は core の DECK + 途切れをつないだ片（plan.decks.link。_linkDecks: ブルックリン橋の遊歩道の塔・錨の上など。this._decks）。
//   入れない ENTB の片は core の E をチャンクで切った柱（どのチャンクも自分の分）。外壁の材質は core だけで決める（_facadeMat）。
//   切り口のある片は隣のチャンクにも同じ片の行がある（片の属性はどの行にも同じものが付く: piece・gid・style・floors・材質・色・roofShape …）。
//
// ■ 柱（prisms[i]。nav3d.js の k 2 と world.js の描画が読む）
//   { ring: Float32Array [x, z, …]（外周）, holes: [Float32Array …], clip: Uint8Array（辺のビット。外周 → 穴の順、辺 v = 点 v → v + 1）| null,
//     tri（屋根の三角形。行の頂点（外周、穴の順）の番号。タイルの三角形の view、無ければ読んだときに耳切りで作る = 遅延）,
//     y0, y1（または top: [a, bx, cz]（y = a + bx·x + cz·z）と厚さ t: 橋の床）, f（WALK …）, mat（外壁の材質 = 今ある v1 の名前）, mt（屋上）, cat,
//     gid, piece, style, cls, floors, storey（1 階の高さ m）, base（1 階の床の y）, color / roofColor（0x1RRGGBB、0 = 不明）, roofShape, roofMat,
//     roofHeight, facadeMat（enum material）, flags（CPRS の行の flags）, kind（台: 0 歩道 1 広場 2 中央分離帯 3 交通島）}
//   描画の追加の頂点属性（aFac / aFac2 / aTop / aAo。plan nyc-cinematic §13）は world.js が柱の属性から作る（ここでは属性を落とさないだけ）。
//
// ■ 消す建物（suppress）: plan.suppressGids と plan.landmarks[].suppress の gid の片はどの出力にも出さない（chunkFull / chunkCoarse / chunkLod /
//   skyline / chunkTops / supportHeightAt / maxTopNear / colliderBoxes / minimap）。オリジナルのランドマーク（MetLife gid 29429 …）と入れ替える用。
//   landmarks[].suppressUnder（m）: params の姿勢（x, z, yaw）と局所の矩形（params.footprintLocal [x0, z0, x1, z1]、無ければ空母の deckOutline / deck /
//   hull の外接矩形）を margin m 広げた中に重心がある片の gid も消す（空母: 向きを変えても消す建物を書き直さない。this.landmarkSuppress[lm.id]）
//
// ■ R4 のフック（rail-r4 §3.6。opts.rail が無ければどれも何もしない）
//   1 this.rail  2 rail.emit(out, cx, cz, geom)（chunkFull、gameOnly も。chunkCoarse は geom = false の別の出力から cat 'under' と voids だけ）
//   3 chunk の voids（Nav3D.addChunk へそのまま）  4 rail.pitAt(x, z) → { y } | null（groundAt）  5 rail.cutPlinth(prism, cx, cz)（台の柱に穴を足す）
//   7 chunkCoarse: rail の箱で cat 'under'（w / d ≥ 2）と voids を残す  8 rail.lod(out, cx, cz)（chunkLod）/ rail.skyline(groups)（skyline）
//   9 rail.supportAt(x, z) → y | null（supportHeightAt・maxTopNear）  10 rail.minimap(mini)（minimap の rails / stations）
//   NC5（MR.Underground = www/js/underground.js が今の実装）: 5 / 6 rail.cuts() → 口の囲いの形の矩形（_cuts に足す: 台の穴・地面のメッシュの穴・
//   路面の印 / 小物を抜く）、9 の地下 rail.floorAt(x, z, y)（supportHeightAt(x, z, y) の 3 つ目の引数）、waterLevelAt / isWater(x, z, y)（地面より下は水なし）。
//   rail.attach(city) で街の格子に合わせる
(function (root) {
  const MR = root.MR || (root.MR = {});
  const canRequire = typeof require === 'function' && typeof module !== 'undefined' && module.exports;
  const CityGen = MR.CityGen || (canRequire ? require('./citygen.js') : null);
  const NycData = MR.NycData || (canRequire ? require('./nycdata.js') : null);
  // nyctiles.js は require しない（Node 専用の fs を使う。サーバーの Worker のバンドルに入れない。タイルは opts.tiles で受け取る）
  if (!CityGen) throw new Error('citygen_nyc.js: citygen.js must be loaded first');
  const LIB = CityGen.lib || {};
  const F = CityGen.F;
  const hash = CityGen.hash;

  const r2 = (v) => Math.round(v * 100) / 100;
  // 走査線の区間（操車場の台の判定・砂利の帯）: block B（rowPolys の形）のリング k0..k1 と線 z の交点 x を xs に、ivOf で偶奇の区間 [a, b, …]
  function scanX(B, k0, k1, z, xs) {
    for (let k = k0; k < k1; k++) {
      const a = B.vertStart[k], b = B.vertStart[k + 1];
      for (let v = a, w = b - 1; v < b; w = v++) {
        const z1 = B.xz[v * 2 + 1], z2 = B.xz[w * 2 + 1];
        if ((z1 > z) !== (z2 > z)) xs.push(B.xz[v * 2] + (z - z1) / (z2 - z1) * (B.xz[w * 2] - B.xz[v * 2]));
      }
    }
    return xs;
  }
  function ivOf(xs) { xs.sort((a, b) => a - b); const o = []; for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) o.push(xs[k], xs[k + 1]); return o; }
  function ivAnd(a, b) { const o = []; let i = 0, j = 0; while (i < a.length && j < b.length) { const lo = Math.max(a[i], b[j]), hi = Math.min(a[i + 1], b[j + 1]); if (hi > lo) o.push(lo, hi); if (a[i + 1] < b[j + 1]) i += 2; else j += 2; } return o; }
  function ivOr(lists) { const all = []; for (const l of lists) for (let k = 0; k < l.length; k += 2) all.push([l[k], l[k + 1]]); all.sort((a, b) => a[0] - b[0]); const o = []; for (const [a, b] of all) { if (o.length && a <= o[o.length - 1]) o[o.length - 1] = Math.max(o[o.length - 1], b); else o.push(a, b); } return o; }
  function ivLen(a) { let s = 0; for (let k = 0; k < a.length; k += 2) s += a[k + 1] - a[k]; return s; }
  // 32 bit の混ぜ合わせ（木の向きだけ）
  function mix(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  const u01 = (h) => (h >>> 0) / 4294967296;

  // core PRT の flags / タイル CPRS の行の flags（nycdata.js の冒頭）
  const P_ENTB = 8, P_RECT = 16, P_DEVSAT = 32, P_THIN = 128;
  const R_RECT = 1, R_CLIPPED = 4, R_ENTREM = 32, R_NOTRI = 64;
  const FRONT = ['n', 'e', 's', 'w'];
  const WHOLE = [-1e9, -1e9, 1e9, 1e9]; // 切らない（_clipPiece の inside）

  // ---------- 小さな幾何 ----------
  function segDist2(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz;
    let u = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + u * dx - px, qz = az + u * dz - pz;
    return qx * qx + qz * qz;
  }
  function elPtDist(c, x, z) { // 点 → 道を渡る所の線 c.pts（_elUnder・_yAdj）
    const P = c.pts;
    let d = Infinity;
    for (let k = 0; k + 3 < P.length; k += 2) d = Math.min(d, segDist2(x, z, P[k], P[k + 1], P[k + 2], P[k + 3]));
    if (P.length === 2) d = (x - P[0]) * (x - P[0]) + (z - P[1]) * (z - P[1]);
    return Math.sqrt(d);
  }
  function segX(ax, az, bx, bz, cx, cz, dx, dz) {
    const o = (px, pz, qx, qz, rx, rz) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
    return o(ax, az, bx, bz, cx, cz) !== o(ax, az, bx, bz, dx, dz) && o(cx, cz, dx, dz, ax, az) !== o(cx, cz, dx, dz, bx, bz);
  }
  // 軸平行の矩形と線分の距離（触れていれば 0）。tools/nyc/checkv2.js の rectSegDist と同じ
  function rectSegDist(x0, z0, x1, z1, ax, az, bx, bz) {
    if ((ax >= x0 && ax <= x1 && az >= z0 && az <= z1) || (bx >= x0 && bx <= x1 && bz >= z0 && bz <= z1)) return 0;
    if (segX(ax, az, bx, bz, x0, z0, x1, z0) || segX(ax, az, bx, bz, x1, z0, x1, z1) || segX(ax, az, bx, bz, x1, z1, x0, z1) || segX(ax, az, bx, bz, x0, z1, x0, z0)) return 0;
    let d = Math.min(segDist2(ax, az, x0, z0, x1, z0), segDist2(ax, az, x1, z0, x1, z1), segDist2(ax, az, x1, z1, x0, z1), segDist2(ax, az, x0, z1, x0, z0),
      segDist2(bx, bz, x0, z0, x1, z0), segDist2(bx, bz, x1, z0, x1, z1), segDist2(bx, bz, x1, z1, x0, z1), segDist2(bx, bz, x0, z1, x0, z0));
    d = Math.min(d, segDist2(x0, z0, ax, az, bx, bz), segDist2(x1, z0, ax, az, bx, bz), segDist2(x1, z1, ax, az, bx, bz), segDist2(x0, z1, ax, az, bx, bz));
    return Math.sqrt(d);
  }
  // 多角形ブロックの i 番の辺（全部のリング）→ [ax, az, bx, bz, …]
  function blockEdges(blk, i) {
    const out = [];
    for (let k = blk.ringStart[i]; k < blk.ringStart[i + 1]; k++) {
      const a = blk.vertStart[k], b = blk.vertStart[k + 1];
      for (let v = a; v < b; v++) { const w = v + 1 < b ? v + 1 : a; out.push(blk.xz[v * 2], blk.xz[v * 2 + 1], blk.xz[w * 2], blk.xz[w * 2 + 1]); }
    }
    return out;
  }
  function edgesDist2(E, x, z) {
    let d = Infinity;
    for (let i = 0; i < E.length; i += 4) { const q = segDist2(x, z, E[i], E[i + 1], E[i + 2], E[i + 3]); if (q < d) d = q; }
    return d;
  }
  function areaOf(xz, n) { // 平らな配列 [x, z, …] の n 点の符号付き面積
    let s = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) s += xz[j * 2] * xz[i * 2 + 1] - xz[i * 2] * xz[j * 2 + 1];
    return s / 2;
  }
  // リング（xz の a..b 頂点）を矩形で切る（Sutherland–Hodgman。凹でも外周の形は保つ。境目の上に退化した辺ができうる = 描かない辺）
  function clipRing(xz, a, b, r) {
    let pts = [];
    for (let v = a; v < b; v++) pts.push(xz[v * 2], xz[v * 2 + 1]);
    const sides = [[0, r[0], 1], [0, r[2], -1], [1, r[1], 1], [1, r[3], -1]]; // [軸, 値, 内側の向き]
    for (const s of sides) {
      const ax = s[0], val = s[1], sg = s[2], out = [], n = pts.length >> 1;
      if (!n) return pts;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const pi = pts[i * 2 + ax], pj = pts[j * 2 + ax];
        const ini = (pi - val) * sg >= 0, inj = (pj - val) * sg >= 0;
        if (ini) out.push(pts[i * 2], pts[i * 2 + 1]);
        if (ini !== inj) {
          const t = (val - pi) / (pj - pi);
          const x = pts[i * 2] + (pts[j * 2] - pts[i * 2]) * t, z = pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * t;
          if (ax === 0) out.push(val, z); else out.push(x, val);
        }
      }
      pts = out;
    }
    return pts;
  }
  // 切ったリング: 辺がどれも矩形の同じ線の上にあれば clip（Uint8Array のビット）
  function clipBitsFor(rings, r) {
    let n = 0;
    for (const q of rings) n += q.length >> 1;
    const bits = new Uint8Array((n + 7) >> 3);
    let e = 0, any = false;
    const on = (x, z, k) => (k === 0 ? Math.abs(x - r[0]) < 1e-3 : k === 1 ? Math.abs(x - r[2]) < 1e-3 : k === 2 ? Math.abs(z - r[1]) < 1e-3 : Math.abs(z - r[3]) < 1e-3);
    for (const q of rings) {
      const m = q.length >> 1;
      for (let i = 0; i < m; i++, e++) {
        const j = (i + 1) % m;
        for (let k = 0; k < 4; k++) if (on(q[i * 2], q[i * 2 + 1], k) && on(q[j * 2], q[j * 2 + 1], k)) { bits[e >> 3] |= 1 << (e & 7); any = true; break; }
      }
    }
    return any ? bits : null;
  }

  // 平らな配列のリング [x, z, …] の中か（偶奇）
  function inRing(q, x, z) {
    let c = false;
    for (let i = 0, n = q.length >> 1, j = n - 1; i < n; j = i++) {
      const xi = q[i * 2], zi = q[i * 2 + 1], xj = q[j * 2], zj = q[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  // 多角形（平らな配列）から軸平行の矩形を抜いた残り = 矩形の左・右・上・下の帯で切った多角形（0〜4 個）
  const BIG = 1e7;
  function ringMinusRect(q, R) {
    const out = [];
    for (const band of [[-BIG, -BIG, R[0], BIG], [R[2], -BIG, BIG, BIG], [R[0], -BIG, R[2], R[1]], [R[0], R[3], R[2], BIG]]) {
      const p = clipRing(q, 0, q.length >> 1, band);
      if ((p.length >> 1) >= 3 && Math.abs(areaOf(p, p.length >> 1)) > 1e-3) out.push(p);
    }
    return out;
  }
  // 柱の外周と穴から矩形 R を抜いた残り（R の左・右・上・下の帯で切る）→ [{ ring, holes }]（平らな配列）。帯の線の上の辺は抜いた所
  function ringsMinusRect(ring, holes, R) {
    const out = [];
    for (const band of [[-BIG, -BIG, R[0], BIG], [R[2], -BIG, BIG, BIG], [R[0], -BIG, R[2], R[1]], [R[0], R[3], R[2], BIG]]) {
      const q = clipRing(ring, 0, ring.length >> 1, band);
      if ((q.length >> 1) < 3 || Math.abs(areaOf(q, q.length >> 1)) < 0.02) continue;
      const hs = [];
      for (const h of holes || []) { const c = clipRing(h, 0, h.length >> 1, band); if ((c.length >> 1) >= 3 && Math.abs(areaOf(c, c.length >> 1)) > 0.02) hs.push(c); }
      out.push({ ring: q, holes: hs });
    }
    return out;
  }
  // リングを step m のセルに: inset > 0 は 4 隅を inset m 内側へ寄せた点が全部中（下限 = サーバー）、0 は中心が中。行ごとに x でつなぎ、
  //   同じ x の範囲の行は z でつなぐ。cr（矩形）の中だけ。→ [x0, z0, x1, z1, …]
  function ringCells(q, cr, step, inset) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
    x0 = Math.max(x0, cr[0]); z0 = Math.max(z0, cr[1]); x1 = Math.min(x1, cr[2]); z1 = Math.min(z1, cr[3]);
    const out = [];
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return out;
    const nx = Math.max(1, Math.ceil((x1 - x0) / step)), nz = Math.max(1, Math.ceil((z1 - z0) / step));
    const sx = (x1 - x0) / nx, sz = (z1 - z0) / nz;
    let prev = []; // 前の行の [x0, x1, 出力の番号]
    for (let j = 0; j < nz; j++) {
      const a = z0 + j * sz, b = a + sz, row = [];
      let run = -1;
      for (let i = 0; i <= nx; i++) {
        let ok = false;
        if (i < nx) {
          const c0 = x0 + i * sx, c1 = c0 + sx;
          ok = inset > 0
            ? inRing(q, c0 + inset, a + inset) && inRing(q, c1 - inset, a + inset) && inRing(q, c1 - inset, b - inset) && inRing(q, c0 + inset, b - inset) && inRing(q, (c0 + c1) / 2, (a + b) / 2)
            : inRing(q, (c0 + c1) / 2, (a + b) / 2);
        }
        if (ok && run < 0) run = i;
        if (!ok && run >= 0) { row.push([x0 + run * sx, x0 + i * sx]); run = -1; }
      }
      const cur = [];
      for (const s of row) {
        const p = prev.find((r) => Math.abs(r[0] - s[0]) < 1e-6 && Math.abs(r[1] - s[1]) < 1e-6);
        if (p) { out[p[2] + 3] = b; cur.push(p); } else { cur.push([s[0], s[1], out.length]); out.push(s[0], a, s[1], b); }
      }
      prev = cur;
    }
    return out;
  }

  // ---------- 耳切り（mapbox/earcut の考え方。z 順の索引は持たない: 台・屋根の数百頂点まで）----------
  function earcut(data, holeIndices) {
    const hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices[0] * 2 : data.length;
    let outer = linkedList(data, 0, outerLen, true);
    const tris = [];
    if (!outer || outer.next === outer.prev) return tris;
    if (hasHoles) outer = eliminateHoles(data, holeIndices, outer);
    earcutLinked(outer, tris, 0);
    return tris;
  }
  function Node(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = null; this.next = null; this.steiner = false; }
  function insertNode(i, x, y, last) {
    const p = new Node(i, x, y);
    if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function signedAreaFlat(data, s, e) { let sum = 0; for (let i = s, j = e - 2; i < e; i += 2) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; } return sum; }
  function linkedList(data, start, end, clockwise) {
    let last = null;
    if (clockwise === (signedAreaFlat(data, start, end) > 0)) for (let i = start; i < end; i += 2) last = insertNode(i / 2, data[i], data[i + 1], last);
    else for (let i = end - 2; i >= start; i -= 2) last = insertNode(i / 2, data[i], data[i + 1], last);
    if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
    return last;
  }
  function equals(p, q) { return p.x === q.x && p.y === q.y; }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    let p = start, again;
    do {
      again = false;
      if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
        removeNode(p); p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function isEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    let p = ear.next.next;
    while (p !== ear.prev) {
      if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function intersects(p1, q1, p2, q2) {
    const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const onSeg = (p, q, r) => q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
    const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSeg(p1, p2, q1)) return true;
    if (o2 === 0 && onSeg(p1, q2, q1)) return true;
    if (o3 === 0 && onSeg(p2, p1, q2)) return true;
    if (o4 === 0 && onSeg(p2, q1, q2)) return true;
    return false;
  }
  function locallyInside(a, b) { return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0; }
  function cureLocalIntersections(start, tris) {
    let p = start;
    do {
      const a = p.prev, b = p.next.next;
      if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        tris.push(a.i, p.i, b.i);
        removeNode(p); removeNode(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }
  function intersectsPolygon(a, b) {
    let p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function middleInside(a, b) {
    let p = a, inside = false;
    const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
      ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
        (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
  }
  function splitPolygon(a, b) {
    const a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp;
    return b2;
  }
  function splitEarcut(start, tris) {
    let a = start;
    do {
      let b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && isValidDiagonal(a, b)) {
          let c = splitPolygon(a, b);
          a = filterPoints(a, a.next); c = filterPoints(c, c.next);
          earcutLinked(a, tris, 0); earcutLinked(c, tris, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function earcutLinked(ear, tris, pass) {
    if (!ear) return;
    let stop = ear, guard = 0;
    while (ear.prev !== ear.next) {
      if (++guard > 200000) return; // 壊れた多角形で回り続けない
      const prev = ear.prev, next = ear.next;
      if (isEar(ear)) {
        tris.push(prev.i, ear.i, next.i);
        removeNode(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) earcutLinked(filterPoints(ear), tris, 1);
        else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), tris); earcutLinked(ear, tris, 2); }
        else if (pass === 2) splitEarcut(ear, tris);
        break;
      }
    }
  }
  function getLeftmost(start) { let p = start, l = start; do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p; p = p.next; } while (p !== start); return l; }
  function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
  function findHoleBridge(hole, outerNode) {
    let p = outerNode, qx = -Infinity, m = null;
    const hx = hole.x, hy = hole.y;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y;
    let tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) { m = p; tanMin = tan; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function eliminateHoles(data, holeIndices, outerNode) {
    const queue = [];
    for (let i = 0; i < holeIndices.length; i++) {
      const start = holeIndices[i] * 2, end = i < holeIndices.length - 1 ? holeIndices[i + 1] * 2 : data.length;
      const list = linkedList(data, start, end, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort((a, b) => a.x - b.x);
    for (const h of queue) {
      const bridge = findHoleBridge(h, outerNode);
      if (!bridge) continue;
      const b2 = splitPolygon(bridge, h);
      filterPoints(b2, b2.next);
      outerNode = filterPoints(bridge, bridge.next);
    }
    return outerNode;
  }
  // 柱の屋根の三角形（外周 + 穴）。向きは反時計回り（x 右・z 下の図で、タイルの三角形と同じ）
  function triangulate(ring, holes) {
    const n0 = ring.length >> 1;
    let total = n0;
    if (holes) for (const h of holes) total += h.length >> 1;
    const data = new Float64Array(total * 2);
    data.set(ring, 0);
    const hi = [];
    let o = n0;
    if (holes) for (const h of holes) { hi.push(o); data.set(h, o * 2); o += h.length >> 1; }
    const t = earcut(data, hi);
    // 三角形の向き: 外周の向きにそろえる（earcut は外周を時計回りにして返す）
    const out = total > 65535 ? new Uint32Array(t.length) : new Uint16Array(t.length);
    const flip = areaOf(ring, n0) > 0;
    for (let i = 0; i < t.length; i += 3) { out[i] = t[i]; out[i + 1] = flip ? t[i + 2] : t[i + 1]; out[i + 2] = flip ? t[i + 1] : t[i + 2]; }
    return out;
  }
  // tri を初めて読んだときに作る（台・三角形の無い行・遠景の切った E）。列挙されないので JSON・ハッシュの順番は変わらない
  function lazyTri(p) {
    let v = null;
    Object.defineProperty(p, 'tri', {
      configurable: true, enumerable: false,
      get() { if (!v) v = triangulate(p.ring, p.holes); return v; },
      set(x) { v = x; }
    });
    return p;
  }

  // core（decodeCore の結果）→ { key, list }: 駐車の車などの乗り物（_initVehicles）。core を捨てれば一緒に消える
  const VEH_CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;

  class CityGenNyc {
    constructor(plan, opts) {
      opts = opts || {};
      this.opts = opts;
      this.plan = plan;
      this.version = 2;
      this.core = opts.core || null;
      this.tiles = opts.tiles || null;
      this.meta = opts.meta || (this.tiles && this.tiles.meta) || null;
      this.rail = opts.rail || null;     // R4 のフック 1（無ければ全部の口が何もしない）
      this.boats = opts.boats || null;
      this.gameOnly = !!opts.gameOnly;
      this.seed = plan.seed | 0;
      const b = plan.bounds || (this.meta && this.meta.bounds);
      if (!b) throw new Error('CityGenNyc: bounds (plan.bounds or nyc.json) required');
      this.minX = b.minX; this.maxX = b.maxX; this.minZ = b.minZ; this.maxZ = b.maxZ;
      this.cs = plan.chunkSize || 128;
      this.ncx = Math.ceil((this.maxX - this.minX) / this.cs);
      this.ncz = Math.ceil((this.maxZ - this.minZ) / this.cs);
      this.waterY = plan.waterY; this.bedY = plan.bedY;
      this.curbH = plan.curbH != null ? plan.curbH : 0.15; this.sidewalk = plan.sidewalk;
      this.maxOverhang = plan.maxOverhang || 64;
      this.colliderOverhang = 0;         // v2 は当たり判定の箱をチャンクで切ってある（heli.js の HeliCollider が隣を見なくてよい）
      this.engine = plan.engine || {};
      this.B = plan.building; this.M = plan.materials || {};
      this.S = Object.assign({ pad: 0.5, roofExtra: 1.2, deckExtra: 0.3 }, plan.support || {});
      const meta = this.meta || {};
      // '@data' / null = データ（nyc.json）の一覧。配列の中の '@data' はそこにデータの一覧を入れ、その後の { id, … } はデータの同じ id の行に
      //   重ねる（r / loot などの上書き）か、無ければ足す（manhattan.json の heliports: ["@data", Fort Wood, ガバナーズ島]）
      //   b16: manhattan.json は '@data' の文字のまま、足す行は <名前>Add（hotZonesAdd / heliportsAdd）に書く（ビルド 14 のアプリは配列の
      //   heliports / hotZones を読めず、ダウンロードしたデータで「街：ニューヨーク」を開くと落ちた = test:compat）。add は配列の '@data' の後と同じ
      const fromData = (v, d, add) => {
        if (Array.isArray(add) && add.length) return fromData(['@data'].concat(add), fromData(v, d));
        if (v === '@data' || v == null) return d || [];
        if (!Array.isArray(v) || v.indexOf('@data') < 0) return v;
        const out = [];
        for (const e of v) {
          if (e === '@data') { for (const x of d || []) out.push(Object.assign({}, x)); continue; }
          let i = -1;
          if (e && e.id != null) for (let k = 0; k < out.length; k++) if (out[k].id === e.id) { i = k; break; }
          if (i >= 0) Object.assign(out[i], e); else out.push(Object.assign({}, e));
        }
        return out;
      };
      this.hotZones = fromData(plan.hotZones, meta.hotZones, plan.hotZonesAdd).map((h) => Object.assign({}, h));
      // 選択肢の短い名前（plan.hotZoneChips { id: 名前 }。地図・説明の文は label のまま）
      if (plan.hotZoneChips) for (const h of this.hotZones) if (plan.hotZoneChips[h.id]) h.chip = String(plan.hotZoneChips[h.id]);
      // 地名: nyc.json は { ja, en, x, z }、v1（minimap）は { text, x, z }
      this.labels = fromData(plan.labels, meta.labels).map((l) => ({ text: l.text || l.ja || l.en || '', en: l.en || '', x: l.x, z: l.z }));
      // ヘリポート: nyc.json は { id, label, x, z, rect }。v1 の形 { id, label, x, y, z, r, access }（屋上のパッドは core HPAD → _pads）
      const hd = plan.heliportDefaults || {};
      this.helipads = fromData(plan.heliports, meta.heliports, plan.heliportsAdd).map((h) => Object.assign({ y: hd.y || 0, r: hd.r, access: hd.access }, h));
      this.keepouts = this.helipads.map((h) => [h.x, h.z, (h.r || 0) + 3]);
      // 消す建物（gid）: plan.suppressGids + landmarks[].suppress
      this.suppressGids = new Set();
      for (const g of plan.suppressGids || []) this.suppressGids.add(g >>> 0);
      for (const l of plan.landmarks || []) for (const g of l.suppress || []) this.suppressGids.add(g >>> 0);
      if (plan.stairs) for (const st of plan.stairs) if (st && st.gid) this.suppressGids.add(st.gid >>> 0); // 段に置き換える片（_initStairs）
      this.landmarkSuppress = {};        // lm.id → 消す gid（suppress + suppressUnder。_initCore の _resolveSuppressUnder）
      // v1 の内部の欄で外から読まれるもの（計画 §3.3.4）
      this.lakes = [];
      this.piers = [];
      this.roads = [];
      this.streets = [];
      this.cells = [];
      this.staticItems = { boxes: [], ramps: [], ladders: [], props: [], decals: [], roads: [], ground: [], water: [], landmarks: [], loot: [], buildings: [] };
      this._vehicles = null;             // ヘリポートのヘリ（h_<パッド>）→ 駐車の車（v_<道>_<番>_<側>）→ 空母の戦闘機（plan.vehicles.jets のときだけ）。
                                         //   初めて要るとき（vehicleSpawns / chunkFull / vehicles）に作る（_initVehicles。駐車の車を決めるのに 8〜25 ms）
      this.carrierOps = null;            // Pier 86 の空母（v1 の _carrierOps と同じ形。manhattan では戦闘機は出さない）
      this._areaCodes = null;
      this._areaIdx = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
      this._solidCache = new Map();      // 'mode:piece' → Float32Array [x0, z0, x1, z1, …]（LRU）
      this._solidCap = plan.engine && plan.engine.solidCache ? plan.engine.solidCache : 4096;
      this._gameCache = new Map();       // チャンク → ゲームの層（LRU 16）
      this._decks = null;                // core の DECK + 途切れをつないだ片（_linkDecks）
      // 線路（nyc-complete NC2。描画の層だけ）: チャンク → 線路の走り（_railRuns。LRU 64）、タイル → 台の行ごとの操車場の印（_yardOf）
      this._railCache = new Map();
      this._yardIdx = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
      this._railTile = typeof WeakMap !== 'undefined' ? new WeakMap() : null; // タイル → 線路の片の索引（_railInfo）
      this.railCfg = Object.assign({ air: 1, below: -0.3, deckTol: 1, step: 2, maxRise: 0.35, flat: 0.02, yardFrac: 0.3, yardMat: 'gravel_roof', skipFlags: 2 | 16, shift: 3, shiftSlope: 0.1, trackGap: 3.3, barrierClear: 1.7, ballastClear: 1.55, edgeIn: 0.05, edgeIters: 8, solidAbove: 0.1, solidBelow: 0.3, railCheck: 0.75, minRun: 1, isolatedMin: 10, isolatedJoin: 1, yardStrip: 2, yardStripMin: 0.5, deckSlope: 0.3, elBallastClear: 0.7, crack: 0.5, crossMin: 0.08, crossMax: 2, passCap: 8, crossGrade: 0.15, wedgeW: 3.2 }, plan.rails || {});
      // 後から作る索引も全部ここで null にしておく（どの街も同じ形のオブジェクト = 速い関数がどの街でも単形のまま）
      this._anySup = false; this._sup = null; this._supList = null; this._supTop = null; this._supEnt = null; this._supStart = null;
      this._entOf = null; this._entOnC = null; this._entChunk = null; this._deckBB = null; this._deckChunk = null; this._deckCell = null; this._deckDrop = null;
      this._spawnChunk = null; this._spawnLists = null; this._pads = []; this._gapLo = null; this._gapHi = null;
      this._el = null; this._elAdj = null; this._elCross = null; this.underCfg = null; this._elCols = null; this._pitGrid = null; this._elColW = 0; this._elNear = null; this.elCfg = null; this.portalCfg = null; this._elMats = null; this._portals = []; this._portalSites = []; this._portalSkips = []; this._cuts = []; this._elCutN = -1; this._railHide = []; this._cwIdx = null; this._spawnBad = null; this.elStats = null; this._rdBB = null; // NC3（_initEl）
      // 地下鉄の駅（nyc-complete NC4。core STAT → _initStations）: 駅・ホーム・道の入口。入口の印（手すりと暗い口）は描画の層だけ（サーバーは知らない）
      this.stations = []; this._statChunk = null;
      this.stationCfg = Object.assign({ enabled: true, marks: true, railH: 1.1, railT: 0.06, railMat: 'railing', holeMat: 'tunnelDark', holeT: 0.01, liftH: 2.7, liftMat: 'curb' }, plan.stations || {});
      this._wbb = null; this._wgrid = null; this._gFlags = null; this._tops = null; this._sky = null; this._mini = null;
      // M2: 移したランドマーク・空母・ヘリポートのヘリ・駐車の車（_initStatic / _initHelipads / _initVehicles）
      this.pits = [];                    // 沈んだ広場 [{ rect, y }]（groundAt が穴の底を返す。ロックフェラーのリンク）
      this._pitBB = [Infinity, Infinity, -Infinity, -Infinity]; // 穴の全部の外接矩形（groundAt の速い道: ほとんどの点はこれで外れる）
      this._foot = [];                   // ランドマークの矩形（世界）: 消した建物の残り（remnants）とデータの小物の除外
      this._remnants = [];               // 消した建物の footprint の外の部分 [{ ring, y0, y1, piece, bb }]
      this._sb = new Map();              // チャンク → 静的な物（部品の中心で振り分け。v1 の sb と同じ）
      this._stColl = new Map();          // チャンク → 当たりの箱（静的な箱をチャンクで切る = colliderOverhang 0 の約束）
      this._stSup = null; this._stSupW = 0; this._stSupH = 0; this._stSupC = 32; // 静的な支えの 32 m のセル
      this._remChunk = new Map();        // チャンク → 残りの柱の番号
      this._vehChunk = null;             // チャンク → 乗り物の出す所（_initVehicles）
      this._stSil = [];                  // 静的な外形（遠景）
      this._plinthCut = [];              // 台（歩道・広場）から抜く矩形（世界。landmarks[].plinthCut。v1 の noPlinth と同じ使い方）
      this._deckCut = [];                // 橋・高架の床から抜く矩形（landmarks[].cutDecks なら footprint）
      if (this.core) this._initCore();
      this._initStatic();
      this._initHelipads();
      // 高架・トンネルの口・高架の駅のホーム（nyc-complete NC3。core RLEL → 床の片を _decks の後ろに足して索引を作り直す・柱・口の囲い。
      //   ランドマークの矩形（_initStatic）とヘリポートの後 = 柱をそこに立てない。それまでに作った床の索引に頼る物は作り直す）
      if (this.core && this.core.rlel && this._decks && (this.plan.rails || {}).el !== false) {
        const EC = (this.opts && this.opts.elCache) || (this.meta && this.meta.elCache);
        if (EC && EC.v === 1 && !CityGenNyc._elNoCache && EC.key === this._elKey()) this._elLoad(EC); // 前もって作った表（elcache.json = opts.elCache: tools/nyc/elcache.js。答えは _initEl と同じ）
        else this._initEl();
        this._indexDecks();
        this._supEnt = null; this._supStart = null; this._gameCache.clear(); this._railCache.clear(); this._tops = null; this._sky = null; this._mini = null;
        this._elSpawns();
      }
      if (this.core && this.core.stat && this.stationCfg.enabled !== false) this._initStations();
      this.keepouts = this.helipads.map((h) => [h.x, h.z, (h.r || 0) + 3]);
      // R4 のフック 5 / 6（NC5）: 地下の口の穴（rail.cuts()）は口の囲いの矩形と同じ形 = 台の穴（_cutPits）・地面のメッシュの穴（groundHoles）・
      //   路面の印 / 小物を抜く所（_inCut）。rail が無ければ _cuts は NC3 の口だけ（今までと同じ）
      this._elCutN = this._cuts.length; // NC3 の口の囲いの数（_elSave は rail の穴を表に入れない = 表を読んだ後にまた足しても重ならない）
      if (this.rail) {
        if (this.rail.attach) this.rail.attach(this);
        if (this.rail.cuts) { const rc = this.rail.cuts(); if (rc && rc.length) this._cuts = this._cuts.concat(rc); }
      }
      this._initGFlags();
    }
    // groundAt / groundY / waterLevelAt の速い道の 64 m のセルの印（19 KB = キャッシュに乗る）: 1 沈んだ広場の矩形・2 トンネルの口（_pitGrid）・
    //   4 内陸の水の多角形（_coreWater の格子が空でない）。印の無いセルはそれぞれの確かめを飛ばす（答えは同じ）。core の LGRD が無ければ作らない
    _initGFlags() {
      if (!this.core || !this.core.lgrd) return;
      const C = 64, W = Math.ceil((this.maxX - this.minX) / C), H = Math.ceil((this.maxZ - this.minZ) / C), g = new Uint8Array(W * H);
      for (const p of this.pits) {
        for (let j = Math.max(0, Math.floor((p.rect[1] - this.minZ) / C)); j <= Math.min(H - 1, Math.floor((p.rect[3] - this.minZ) / C)); j++)
          for (let i = Math.max(0, Math.floor((p.rect[0] - this.minX) / C)); i <= Math.min(W - 1, Math.floor((p.rect[2] - this.minX) / C)); i++) g[j * W + i] |= 1;
      }
      const P = this._pitGrid;
      if (P) for (let k = 0; k < P.g.length; k++) if (P.g[k]) { const i = k % P.W, j = (k / P.W) | 0; if (i < W && j < H) g[j * W + i] |= 2; }
      if (this.core.water && this.core.water.count) {
        this._coreWater(this.minX, this.minZ); // 水の格子を作る
        const G = this._wgrid;
        for (let j = 0; j < G.H && j < H; j++) for (let i = 0; i < G.W && i < W; i++) { const k = j * G.W + i; if (G.csr.start[k + 1] > G.csr.start[k]) g[j * W + i] |= 4; }
      }
      // 8 = セルにかかる LGRD のセルが全部陸・16 = 全部水（格子の外を含む）は初めて引いたときに 1 つずつ（_gBlock。32 = 見た）
      const L = this.core.lgrd, k = C / L.cell;
      const al = L.x0 === this.minX && L.z0 === this.minZ && k === (k | 0) && k % 4 === 0 && L.W % 4 === 0 && L.grid.byteOffset % 4 === 0;
      this._gFlags = { cell: C, W, H, g, k, U: al ? new Uint32Array(L.grid.buffer, L.grid.byteOffset, (L.W * L.H) >> 2) : null };
    }
    // 64 m のセル n = j·W + i の 8 / 16 を決める
    _gBlock(n) {
      const F = this._gFlags, L = this.core.lgrd, i = n % F.W, j = (n / F.W) | 0, k = F.k;
      let land = true, water = true;
      if (F.U) {
        // 揃っている（今の core）: セル i は LGRD の列 k·i .. k·i + k − 1（2 の冪の割り算は丸めないので floor が揃う）。4 バイトずつ読む
        const WW = L.W >> 2, a0 = (i * k) >> 2, a1 = Math.min(WW, a0 + (k >> 2)), b0 = j * k, b1 = Math.min(L.H, b0 + k);
        if (i * k + k > L.W || j * k + k > L.H) land = false; // 格子の外（水）を含む
        for (let b = b0; b < b1 && (land || water); b++) for (let q = b * WW + a0, q1 = b * WW + a1; q < q1; q++) {
          const v = F.U[q];
          if (v !== 0x01010101) land = false;
          if (v !== 0) water = false;
        }
      } else {
        // 揃っていない: セルにかかる LGRD のセルを 1 つ広く見る（浮動小数の丸め）
        const C = F.cell;
        const a0 = Math.floor((this.minX + i * C - L.x0) / L.cell) - 1, a1 = Math.floor((this.minX + (i + 1) * C - L.x0) / L.cell) + 1;
        const b0 = Math.floor((this.minZ + j * C - L.z0) / L.cell) - 1, b1 = Math.floor((this.minZ + (j + 1) * C - L.z0) / L.cell) + 1;
        for (let b = b0; b <= b1 && (land || water); b++) for (let a = a0; a <= a1; a++) {
          const v = a < 0 || b < 0 || a >= L.W || b >= L.H ? 0 : L.grid[b * L.W + a];
          if (v !== 1) land = false;
          if (v !== 0) water = false;
        }
      }
      return (F.g[n] |= 32 | (land ? 8 : water ? 16 : 0));
    }
    // 速い道: 点 (x, z)（地図の中）のセルの印。セルが格子の外（maxX / maxZ のちょうど上）なら −1 = いつもの道
    _gFlagAt(x, z) {
      const F = this._gFlags, i = Math.floor((x - this.minX) / F.cell), j = Math.floor((z - this.minZ) / F.cell);
      if (i >= F.W || j >= F.H) return -1;
      const n = j * F.W + i, f = F.g[n];
      return f & 32 ? f : this._gBlock(n);
    }
    // core の LGRD の純粋なセルは格子だけ（core.isLand と同じ答え）、混ざりのセルは core.isLand
    _landFast(x, z, f) {
      if (f & 8) return true;
      if (f & 16) return false;
      const g = this.core.lgrd, ix = Math.floor((x - g.x0) / g.cell), iz = Math.floor((z - g.z0) / g.cell);
      if (ix < 0 || iz < 0 || ix >= g.W || iz >= g.H) return false;
      const v = g.grid[iz * g.W + ix];
      return v === 2 ? this.core.isLand(x, z) : v === 1;
    }

    // ===== core の索引（起動時に 1 回。型付き配列だけ）=====
    _initCore() {
      const C = this.core, P = C.pieces, B = this.B || {};
      const n = P ? P.count : 0;
      // 消す片
      this._sup = new Uint8Array(n);
      this._anySup = false;
      this._supList = [];
      this._resolveSuppressUnder();
      if (this.suppressGids.size) for (let i = 0; i < n; i++) if (this.suppressGids.has(P.gid[i])) { this._sup[i] = 1; this._anySup = true; this._supList.push(i); }
      // 片 → ENTB の行
      const EN = C.entb;
      this._entOf = new Int32Array(n).fill(-1);
      if (EN) for (let r = 0; r < EN.count; r++) this._entOf[EN.piece[r]] = r;
      // 支えの上端（上限）: ceil(y1) + roofExtra、ENTB は v1 の規則（屋根 + 階段室 + 給水塔）も
      this._supTop = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let t = Math.ceil(P.y1c[i] - 1e-6) + this.S.roofExtra;
        const r = this._entOf[i];
        if (r >= 0) t = Math.max(t, this.curbH + EN.floors[r] * EN.fh[r] + (B.bulkhead || 3) + 0.3 + 7.8);
        this._supTop[i] = t;
      }
      // ENTB の行をチャンク（長方形の中心）ごとに
      this._entChunk = this._csr(EN ? EN.count : 0, (r, put) => {
        const x = (EN.rect[r * 4] + EN.rect[r * 4 + 2]) / 2, z = (EN.rect[r * 4 + 1] + EN.rect[r * 4 + 3]) / 2;
        const ci = this._ci(x, z); if (ci >= 0) put(ci);
      });
      // DECK: 外接矩形が重なるチャンク（どのチャンクも自分の分をチャンクの矩形で切って出す = 長い片が持ち主のチャンクの外へ何百 m も
      //   はみ出さない。クイーンズボロ橋の片は 547 m あった）と、支えの 32 m のセル（外接矩形 + pad）
      this._decks = this._linkDecks(C.decks);
      this._deckDrop = this._stairDecks();
      this._indexDecks();
      // SPWN をチャンクごとに
      const SP = C.spawns;
      this._spawnChunk = this._csr(SP ? SP.count : 0, (i, put) => { const ci = this._ci(SP.xz[i * 2], SP.xz[i * 2 + 1]); if (ci >= 0) put(ci); });
      // 屋上のヘリパッド（HPAD）
      this._pads = [];
      const H = C.helipads;
      if (H) for (let i = 0; i < H.count; i++) this._pads.push({ x: H.xz[i * 2], z: H.xz[i * 2 + 1], y: H.y[i], r: H.r[i], roof: H.roof[i], heliport: H.heliport[i] });
      // 内陸の水（v1 の lakes: world.js / water.js が読む）
      const W = C.water;
      if (W) for (let i = 0; i < W.count; i++) {
        const k = W.ringStart[i], a = W.vertStart[k], e = W.vertStart[k + 1], poly = [];
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = a; v < e; v++) {
          const x = W.xz[v * 2], z = W.xz[v * 2 + 1];
          poly.push([r2(x), r2(z)]);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        this.lakes.push({ id: 'w' + i, y: W.y[i], bed: W.bed[i], sub: W.sub[i], poly, bb: [x0, z0, x1, z1] });
      }
    }
    // 橋・高架の床の索引（_decks の外接矩形・チャンク・支えの 32 m のセル）。_initEl が片を足したら作り直す
    // 段に置き換える片（plan.stairs）の外形の中の 'steps' の床（OSM の highway=steps の道 = TKTS の赤い階段の上の 9 m の床と縁の壁）:
    //   段の箱の上に浮いて残るので索引に入れない（= どの出力にも出ない。クライアントもサーバーも同じ）。片の番号の集まり（_linkDecks がつないだ片も同じ鎖なら）
    _stairDecks() {
      const D = this._decks, P = this.core && this.core.pieces, out = new Set();
      if (!D || !P || !this.plan.stairs) return out;
      const sc = CityGenNyc.ROAD_CLASS.indexOf('steps'), chains = new Set();
      for (const st of this.plan.stairs) {
        if (!st || !st.gid) continue;
        const gid = st.gid >>> 0;
        let p = -1;
        for (let i = 0; i < P.count; i++) if (P.gid[i] === gid) { p = i; break; }
        if (p < 0) continue;
        const k = P.ringStart[p], a0 = P.vertStart[k], n = P.vertStart[k + 1] - a0, X = P.xz;
        const inside = (x, z) => {
          let c = false;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = X[(a0 + i) * 2], zi = X[(a0 + i) * 2 + 1], xj = X[(a0 + j) * 2], zj = X[(a0 + j) * 2 + 1];
            if ((zi > z) !== (zj > z) && x < xj + (xi - xj) * (z - zj) / (zi - zj)) c = !c;
          }
          return c;
        };
        for (let i = 0; i < D.count; i++) {
          if (D.cls[i] !== sc) continue;
          let x = 0, z = 0;
          const a = D.vertStart[i], e = D.vertStart[i + 1];
          for (let v = a; v < e; v++) { x += D.xz[v * 2]; z += D.xz[v * 2 + 1]; }
          if (e > a && inside(x / (e - a), z / (e - a))) { out.add(i); chains.add(D.chain[i]); }
        }
      }
      if (chains.size) for (let i = 0; i < D.count; i++) if (D.link && D.link[i] && chains.has(D.chain[i])) out.add(i);
      return out;
    }
    _indexDecks() {
      const C = this.core, D = this._decks, drop = this._deckDrop;
      this._deckBB = new Float32Array((D ? D.count : 0) * 4);
      if (D) for (let i = 0; i < D.count; i++) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = D.vertStart[i]; v < D.vertStart[i + 1]; v++) { const x = D.xz[v * 2], z = D.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        this._deckBB[i * 4] = x0; this._deckBB[i * 4 + 1] = z0; this._deckBB[i * 4 + 2] = x1; this._deckBB[i * 4 + 3] = z1;
      }
      this._deckChunk = this._csr(D ? D.count : 0, (i, put) => {
        if (drop && drop.has(i)) return;
        const bb = this._deckBB;
        const c0 = Math.max(0, Math.floor((bb[i * 4] - this.minX) / this.cs)), c1 = Math.min(this.ncx - 1, Math.floor((bb[i * 4 + 2] - this.minX) / this.cs));
        const d0 = Math.max(0, Math.floor((bb[i * 4 + 1] - this.minZ) / this.cs)), d1 = Math.min(this.ncz - 1, Math.floor((bb[i * 4 + 3] - this.minZ) / this.cs));
        for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) put(cz * this.ncx + cx);
      });
      const SC = (C.supi && C.supi.cell) || 32, SW = Math.ceil((this.maxX - this.minX) / SC), SH = Math.ceil((this.maxZ - this.minZ) / SC);
      this._deckCell = { cell: SC, W: SW, H: SH };
      const pad = this.S.pad;
      this._deckCell.csr = this._csr(D ? D.count : 0, (i, put) => {
        if (drop && drop.has(i)) return;
        const bb = this._deckBB;
        const i0 = Math.max(0, Math.floor((bb[i * 4] - pad - this.minX) / SC)), i1 = Math.min(SW - 1, Math.floor((bb[i * 4 + 2] + pad - this.minX) / SC));
        const j0 = Math.max(0, Math.floor((bb[i * 4 + 1] - pad - this.minZ) / SC)), j1 = Math.min(SH - 1, Math.floor((bb[i * 4 + 3] + pad - this.minZ) / SC));
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) put(j * SW + k);
      }, SW * SH);
    }
    // 橋・高架の床の途切れをつなぐ（plan.decks.link。データの穴: ブルックリン橋の遊歩道は塔のアーチと錨の上で OSM の道が橋でなく、
    //   床が 30〜40 m 途切れて 13〜23 m 下へ落ちた）。鎖の端（始まりの辺 / 終わりの辺）で、ほかの鎖の端が続いていないもの同士を、
    //   同じ組（歩く道 / 車の道）・maxGap m 以内・勾配 ≤ maxGrade・どちらの端もその鎖の外向きに cos ≥ minCos・高さ ≥ minY・辺の長さの比 ≤ 2 で、
    //   お互いに一番近いものだけ 4 角の片（平らでなければ 2 つの三角）でつなぐ。core の DECK はそのまま（足した片は後ろに並べる。link = 1）
    _linkDecks(D0) {
      const L = (this.plan.decks && this.plan.decks.link) || null;
      if (!D0 || !L || L.enabled === false) return D0;
      const maxGap = L.maxGap || 45, maxGrade = L.maxGrade || 0.15, minCos = L.minCos || 0.94, minY = L.minY != null ? L.minY : 2, join = L.join || 0.5;
      const en = (this.meta && this.meta.enums && this.meta.enums.roadClass) || [];
      const ped = new Set(L.pedestrian || ['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'corridor', 'bridleway']);
      const firstTri = (i) => i + 1 < D0.count && D0.kind[i + 1] === 1 && D0.chain[i + 1] === D0.chain[i];
      // 鎖ごとの最初と最後の片
      const lo = new Map(), hi = new Map();
      for (let i = 0; i < D0.count; i++) {
        if (D0.kind[i] === 2) continue;
        const c = D0.chain[i], a = lo.get(c), b = hi.get(c);
        if (a == null || D0.seq[i] < D0.seq[a] || (D0.seq[i] === D0.seq[a] && D0.kind[i] === 1 && firstTri(i))) lo.set(c, i);
        if (b == null || D0.seq[i] > D0.seq[b] || (D0.seq[i] === D0.seq[b] && D0.kind[i] === 1 && !firstTri(i))) hi.set(c, i);
      }
      const P = (v) => [D0.xz[v * 2], D0.xz[v * 2 + 1], D0.y[v]];
      const ends = [];
      const addEnd = (i, va, vb, c) => {
        const A = P(va), B = P(vb), a = D0.vertStart[i], e = D0.vertStart[i + 1];
        let cx = 0, cz = 0;
        for (let v = a; v < e; v++) { cx += D0.xz[v * 2] / (e - a); cz += D0.xz[v * 2 + 1] / (e - a); }
        const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
        let ox = mx - cx, oz = mz - cz;
        const ol = Math.hypot(ox, oz) || 1;
        ox /= ol; oz /= ol;
        ends.push({ i, c, A, B, mx, mz, y: (A[2] + B[2]) / 2, ox, oz, w: Math.hypot(B[0] - A[0], B[1] - A[1]), ped: ped.has(en[D0.cls[i]]), link: -1, d: Infinity });
      };
      for (const [c, i] of lo) {
        const a = D0.vertStart[i];
        if (D0.vertStart[i + 1] - a >= 3) addEnd(i, a, a + 1, c); // 始まりの辺 (0, 1)
      }
      for (const [c, i] of hi) {
        const a = D0.vertStart[i], n = D0.vertStart[i + 1] - a;
        if (D0.kind[i] === 0 && n === 4) addEnd(i, a + 3, a + 2, c); // 終わりの辺 (3, 2)
        else if (D0.kind[i] === 1 && n === 3) addEnd(i, a + 2, a + 1, c); // 割った 2 つ目 (0, 2, 3) → (3, 2)
      }
      // ほかの床の頂点がそばにある端は続いている（格子で引く。数の鍵）
      const cell = 8, gk = (x, z) => (Math.floor((x - this.minX) / cell) + 1) * 4096 + Math.floor((z - this.minZ) / cell) + 1;
      const high = ends.filter((E) => E.y >= minY);
      const want = new Set();
      for (const E of high) { const k = gk(E.mx, E.mz); for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) want.add(k + gx * 4096 + gz); }
      const grid = new Map();
      for (let i = 0; i < D0.count; i++) for (let v = D0.vertStart[i]; v < D0.vertStart[i + 1]; v++) {
        const k = gk(D0.xz[v * 2], D0.xz[v * 2 + 1]);
        if (!want.has(k)) continue;
        let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(v, D0.chain[i]);
      }
      const join2 = join * join;
      const open = high.filter((E) => {
        const k0 = gk(E.mx, E.mz);
        for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
          const a = grid.get(k0 + gx * 4096 + gz);
          if (a) for (let n = 0; n < a.length; n += 2) {
            const v = a[n];
            if (a[n + 1] === E.c || Math.abs(D0.y[v] - E.y) >= 1) continue;
            const x = D0.xz[v * 2], z = D0.xz[v * 2 + 1], ax = x - E.A[0], az = z - E.A[1], bx = x - E.B[0], bz = z - E.B[1];
            if (Math.min(ax * ax + az * az, bx * bx + bz * bz) < join2) return false; // Math.hypot は遅い（起動の 3〜5 ms がここだった）
          }
        }
        return true;
      });
      // 候補: お互いに一番近いもの（maxGap の格子で近くだけ）
      const og = new Map(), ok = (x, z) => Math.floor((x - this.minX) / maxGap) * 4096 + Math.floor((z - this.minZ) / maxGap);
      open.forEach((E, i) => { const k = ok(E.mx, E.mz); let a = og.get(k); if (!a) og.set(k, (a = [])); a.push(i); });
      for (let p = 0; p < open.length; p++) {
        const a = open[p], k0 = ok(a.mx, a.mz);
        for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const q of og.get(k0 + gx * 4096 + gz) || []) {
          if (q <= p) continue;
          const b = open[q];
          if (a.c === b.c || a.ped !== b.ped) continue;
          const dx = b.mx - a.mx, dz = b.mz - a.mz, d = Math.hypot(dx, dz);
          if (d < join || d > maxGap || Math.abs(b.y - a.y) > d * maxGrade) continue;
          if ((a.ox * dx + a.oz * dz) / d < minCos || -(b.ox * dx + b.oz * dz) / d < minCos) continue;
          if (Math.max(a.w, b.w) > 2 * Math.min(a.w, b.w)) continue;
          if (d < a.d) { a.d = d; a.best = q; }
          if (d < b.d) { b.d = d; b.best = p; }
        }
      }
      const add = [];
      for (let p = 0; p < open.length; p++) {
        const a = open[p];
        if (a.best == null || open[a.best].best !== p || a.best < p) continue;
        const b = open[a.best];
        // 4 角: a の辺 (A, B) → b の辺を B に近い方から
        const q0 = a.A, q1 = a.B;
        const bNear = Math.hypot(b.A[0] - q1[0], b.A[1] - q1[1]) < Math.hypot(b.B[0] - q1[0], b.B[1] - q1[1]);
        let q2 = bNear ? b.A : b.B, q3 = bNear ? b.B : b.A;
        // 蝶ネクタイ（辺 1-2 と 3-0 が交わる）なら b の辺を逆に（以前は 2 つの小さな三角形になり、遊歩道のつなぎが面積 0 だった）
        if (segX(q1[0], q1[1], q2[0], q2[1], q3[0], q3[1], q0[0], q0[1])) { const t = q2; q2 = q3; q3 = t; }
        add.push({ from: a.i, quad: [q0, q1, q2, q3] });
      }
      if (!add.length) return D0;
      // 足した床（平らなら 4 角 kind 0、でなければ (0, 1, 2) と (0, 2, 3) の kind 1）
      const plane3 = (p, q, r) => {
        const ux = q[0] - p[0], uy = q[2] - p[2], uz = q[1] - p[1], vx = r[0] - p[0], vy = r[2] - p[2], vz = r[1] - p[1];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(ny) < 1e-9) return null;
        const A = -nx / ny, B = -nz / ny;
        return [A, B, p[2] - A * p[0] - B * p[1]];
      };
      const pieces = [];
      let chain = 0;
      for (let i = 0; i < D0.count; i++) if (D0.chain[i] >= chain) chain = D0.chain[i] + 1;
      for (const L1 of add) {
        const [q0, q1, q2, q3] = L1.quad, pl = plane3(q0, q1, q2);
        if (!pl) continue;
        const res = Math.abs(pl[0] * q3[0] + pl[1] * q3[1] + pl[2] - q3[2]);
        if (res <= 0.002) pieces.push({ v: [q0, q1, q2, q3], pl, kind: 0, from: L1.from, chain });
        else {
          const pl2 = plane3(q0, q2, q3);
          if (!pl2) continue;
          pieces.push({ v: [q0, q1, q2], pl, kind: 1, from: L1.from, chain }, { v: [q0, q2, q3], pl: pl2, kind: 1, from: L1.from, chain });
        }
        chain++;
      }
      const n0 = D0.count, n = n0 + pieces.length;
      let nv = D0.y.length;
      for (const q of pieces) nv += q.v.length;
      const D = {
        count: n, vertStart: new Uint32Array(n + 1), xz: new Float64Array(nv * 2), y: new Float64Array(nv), plane: new Float64Array(n * 3),
        chain: new Uint32Array(n), seq: new Uint16Array(n), kind: new Uint8Array(n), cls: new Uint8Array(n), rds: new Uint32Array(n), link: new Uint8Array(n),
        thickness: D0.thickness
      };
      D.vertStart.set(D0.vertStart); D.xz.set(D0.xz); D.y.set(D0.y); D.plane.set(D0.plane);
      D.chain.set(D0.chain); D.seq.set(D0.seq); D.kind.set(D0.kind); D.cls.set(D0.cls); D.rds.set(D0.rds);
      let v = D0.y.length;
      pieces.forEach((q, k) => {
        const i = n0 + k;
        for (const p of q.v) { D.xz[v * 2] = p[0]; D.xz[v * 2 + 1] = p[1]; D.y[v] = p[2]; v++; }
        D.vertStart[i + 1] = v;
        D.plane[i * 3] = q.pl[0]; D.plane[i * 3 + 1] = q.pl[1]; D.plane[i * 3 + 2] = q.pl[2];
        D.chain[i] = q.chain; D.seq[i] = 0; D.kind[i] = q.kind; D.cls[i] = D0.cls[q.from]; D.rds[i] = D0.rds[q.from]; D.link[i] = 1;
      });
      D.links = pieces.length;
      return D;
    }
    // 橋・高架の床が通り抜ける片（橋の塔・高架の下の建物）: 片の高さの範囲から床の下面 − 厚さ 〜 上面 + decks.pierceClear を抜く
    //   （_spans）。床（高さ 2 m 以上）の頂点か重心が片の E の中か、片の E の頂点が床の中なら通り抜けとみなす。片ごとに初めて要るときに
    //   支えの 32 m のセルの床だけを見る（起動では作らない）。支え・遠景は抜かない（上限・見た目）
    _gapOf(p) {
      if (!this._gapLo) { const n = this.core.pieces.count; this._gapLo = new Float32Array(n).fill(NaN); this._gapHi = new Float32Array(n); }
      const v0 = this._gapLo[p];
      if (v0 === v0) return v0 !== Infinity;
      const C = this.core, P = C.pieces, D = this._decks, dk = this._deckCell, bb = this._deckBB;
      let lo = Infinity, hi = -Infinity;
      if (D) {
        const clear = (this.plan.decks && this.plan.decks.pierceClear) || 6, t = D.thickness || 1.2;
        const px0 = P.bbox[p * 4], pz0 = P.bbox[p * 4 + 1], px1 = P.bbox[p * 4 + 2], pz1 = P.bbox[p * 4 + 3];
        const i0 = Math.max(0, Math.floor((px0 - this.minX) / dk.cell)), i1 = Math.min(dk.W - 1, Math.floor((px1 - this.minX) / dk.cell));
        const j0 = Math.max(0, Math.floor((pz0 - this.minZ) / dk.cell)), j1 = Math.min(dk.H - 1, Math.floor((pz1 - this.minZ) / dk.cell));
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
          const c = j * dk.W + k;
          for (let n = dk.csr.start[c]; n < dk.csr.start[c + 1]; n++) {
            const i = dk.csr.items[n];
            if (bb[i * 4] > px1 || bb[i * 4 + 2] < px0 || bb[i * 4 + 1] > pz1 || bb[i * 4 + 3] < pz0) continue;
            if (D.eflag && D.eflag[i]) continue; // NC3 の el の床は建物を通り抜けない（建物の中の所は _initEl が床を置かない）
            const a = D.vertStart[i], e = D.vertStart[i + 1];
            let ymin = Infinity, ymax = -Infinity, mx = 0, mz = 0;
            for (let v = a; v < e; v++) { ymin = Math.min(ymin, D.y[v]); ymax = Math.max(ymax, D.y[v]); mx += D.xz[v * 2] / (e - a); mz += D.xz[v * 2 + 1] / (e - a); }
            if (ymin < 2 || P.y0[p] >= ymax + clear || P.y1c[p] <= ymin - t) continue;
            let hit = NycData.pointIn(P, p, mx, mz);
            for (let v = a; v < e && !hit; v++) if (NycData.pointIn(P, p, D.xz[v * 2], D.xz[v * 2 + 1])) hit = true;
            for (let v = P.vertStart[P.ringStart[p]]; v < P.vertStart[P.ringStart[p] + 1] && !hit; v++) if (this._nearDeck(i, P.xz[v * 2], P.xz[v * 2 + 1], 0)) hit = true;
            if (hit) { lo = Math.min(lo, ymin - t); hi = Math.max(hi, ymax + clear); }
          }
        }
      }
      this._gapLo[p] = lo; this._gapHi[p] = hi;
      return lo !== Infinity;
    }
    // 片の高さの範囲 [y0, y1] から通り抜ける床の分を抜いた区間（0〜2 個）
    _spans(p, y0, y1) {
      if (!this._gapOf(p)) return [[y0, y1]];
      const a = this._gapLo[p], b = this._gapHi[p], out = [];
      if (a - y0 >= 0.2) out.push([y0, Math.min(a, y1)]);
      if (y1 - b >= 0.2) out.push([Math.max(b, y0), y1]);
      return out;
    }
    // CSR 索引: n 個の物を put(バケツ) で振り分ける → { start, items }
    _csr(n, each, buckets) {
      const N = buckets || this.ncx * this.ncz;
      const cnt = new Uint32Array(N + 1);
      const count = (b) => { cnt[b + 1]++; }; // 物ごとに関数を作らない（起動の速さ）
      for (let i = 0; i < n; i++) each(i, count);
      for (let k = 0; k < N; k++) cnt[k + 1] += cnt[k];
      const start = cnt.slice(), items = new Uint32Array(cnt[N]);
      let cur = 0;
      const place = (b) => { items[cnt[b]++] = cur; };
      for (cur = 0; cur < n; cur++) each(cur, place);
      return { start, items };
    }
    // water.js 用の陸の格子（LGRD の view。0 水、1 陸、2 混ざり）
    get landMask() {
      const g = this.core && this.core.lgrd;
      return g ? { cell: g.cell, W: g.W, H: g.H, x0: g.x0, z0: g.z0, grid: g.grid } : null;
    }
    isSuppressed(piece) { return !!(this._sup && this._sup[piece]); }
    // ランドマークの姿勢の局所 → 世界（citygen.js の _local と同じ式: wx = x + lx·cos + lz·sin、wz = z − lx·sin + lz·cos）
    static lmToWorld(p, lx, lz) {
      const th = (p.yaw || 0) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
    }
    // 局所の外接矩形 [x0, z0, x1, z1]（params.footprintLocal、無ければ空母の deckOutline / deck / hull）
    static lmLocalRect(p) {
      if (Array.isArray(p.footprintLocal)) return p.footprintLocal.slice(0, 4);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of p.deckOutline || []) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
      for (const d of p.deck || []) { x0 = Math.min(x0, d[0]); x1 = Math.max(x1, d[2]); z0 = Math.min(z0, d[1]); z1 = Math.max(z1, d[3]); }
      for (const h of p.hull || []) { x0 = Math.min(x0, -h[2] / 2); x1 = Math.max(x1, h[2] / 2); z0 = Math.min(z0, h[0]); z1 = Math.max(z1, h[1]); }
      return x0 <= x1 ? [x0, z0, x1, z1] : null;
    }
    // landmarks[].suppress（gid の一覧）+ suppressUnder（姿勢の下の片の gid）→ this.landmarkSuppress[lm.id] と suppressGids
    _resolveSuppressUnder() {
      const P = this.core && this.core.pieces, out = this.landmarkSuppress = {};
      for (const lm of this.plan.landmarks || []) {
        if (!lm || !lm.id) continue;
        const set = new Set((lm.suppress || []).map((g) => g >>> 0));
        const p = lm.params, R = lm.suppressUnder != null && p && p.x != null && p.z != null ? CityGenNyc.lmLocalRect(p) : null;
        if (R && P) {
          const m = +lm.suppressUnder || 0, th = (p.yaw || 0) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
          // 世界の外接矩形（重心は片の外接矩形の中なので、重ならない片は重心を測らない = 5.6 万片の頂点を全部なめない）
          let wx0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wz1 = -Infinity;
          for (const [lx, lz] of [[R[0] - m, R[1] - m], [R[2] + m, R[1] - m], [R[0] - m, R[3] + m], [R[2] + m, R[3] + m]]) {
            const wx = p.x + lx * c + lz * s, wz = p.z - lx * s + lz * c;
            wx0 = Math.min(wx0, wx); wx1 = Math.max(wx1, wx); wz0 = Math.min(wz0, wz); wz1 = Math.max(wz1, wz);
          }
          const BB = P.bbox;
          for (let i = 0; i < P.count; i++) {
            if (BB[i * 4] > wx1 + 0.01 || BB[i * 4 + 2] < wx0 - 0.01 || BB[i * 4 + 1] > wz1 + 0.01 || BB[i * 4 + 3] < wz0 - 0.01) continue;
            const k = P.ringStart[i], a = P.vertStart[k], b = P.vertStart[k + 1];
            let mx = 0, mz = 0;
            for (let v = a; v < b; v++) { mx += P.xz[v * 2]; mz += P.xz[v * 2 + 1]; }
            const dx = mx / Math.max(1, b - a) - p.x, dz = mz / Math.max(1, b - a) - p.z;
            const lx = dx * c - dz * s, lz = dx * s + dz * c;
            if (lx >= R[0] - m && lx <= R[2] + m && lz >= R[1] - m && lz <= R[3] + m) set.add(P.gid[i] >>> 0);
          }
        }
        out[lm.id] = Array.from(set).sort((x, y) => x - y);
        for (const g of set) this.suppressGids.add(g);
      }
    }
    // core MASS の i 番の塊が消す建物の上か（重心が消す片の E の中。MASS は前もって混ぜた塊なので、その塊ごと出さない）
    _massSuppressed(i) {
      if (!this._anySup) return false;
      const M = this.core.mass, k = M.ringStart[i], a = M.vertStart[k], b = M.vertStart[k + 1];
      let mx = 0, mz = 0;
      for (let v = a; v < b; v++) { mx += M.xz[v * 2]; mz += M.xz[v * 2 + 1]; }
      mx /= Math.max(1, b - a); mz /= Math.max(1, b - a);
      const P = this.core.pieces;
      for (const p of this._supList) {
        if (mx < P.bbox[p * 4] || mx > P.bbox[p * 4 + 2] || mz < P.bbox[p * 4 + 1] || mz > P.bbox[p * 4 + 3]) continue;
        if (NycData.pointIn(P, p, mx, mz)) return true;
      }
      return false;
    }

    // ===== 移したランドマーク（plan.landmarks。core だけ = サーバーとクライアントで同じ）=====
    //   CityGen.lib.landmarks[kind](gen, E, params) を builder の座標（midtown の座標）で作り、keep / drop / dropDecals で絞り、add の箱を足し、
    //   offset [dx, dz] だけ平行移動して静的な物（staticItems）へ。gen は v1 の CityGen のメソッドを持つ代わりの物（_lmGen。citygen.js の
    //   CityGen.lib の監査の欄: seed M plan curbH B claims hotZones waterY keepouts）。
    //   静的な物は部品の中心のチャンクに振り分ける（chunkFull / chunkCoarse / lootSpawns。v1 の sb と同じ。箱は maxLen 120 m なので
    //   はみ出しは maxOverhang 64 m の中）。当たりの箱（colliderBoxes）は重なるチャンクごとにそのチャンクで切る。
    //   消した建物（suppress の gid）の片のうち landmarks[].footprint の外の部分は remnants: true なら柱で出す（_remnants）
    // 段に置き換える片（plan.stairs: [{ id, gid, steps, dir: [dx, dz]（上がる向き = ±x か ±z）, mat }]。TKTS の赤い階段 gid 30106）:
    //   core の片の外形（suppressGids で消える）を上がる向きに steps 段に切った箱（F.WALK、下は片の y0、上は y0 + 高さ × (i + 1) / steps =
    //   1 段 ≤ engine.stepUp）。各段の横の幅は段の両端の外形の幅の重なり（外形の外へ出ない = 前は固い箱だった所だけ）。
    //   クライアント（chunkFull）・サーバー（chunkCoarse・colliderBoxes・支え）が同じ静的な箱を読む。this.stairs[id] = 段の一覧
    //   { x0, z0, x1, z1, y0, y1 }（下から順。timessq.js の見た目も同じ数）
    _initStairs(SE) {
      this.stairs = {};
      const P = this.core && this.core.pieces;
      if (!P || !this.plan.stairs) return;
      for (const st of this.plan.stairs) {
        if (!st || !st.gid) continue;
        const gid = st.gid >>> 0, N = Math.max(1, st.steps | 0 || 16), d = st.dir || [0, -1];
        let p = -1;
        for (let i = 0; i < P.count; i++) if (P.gid[i] === gid) { p = i; break; }
        if (p < 0) continue;
        const k = P.ringStart[p], q = Array.from(P.xz.subarray(P.vertStart[k] * 2, P.vertStart[k + 1] * 2)), n = q.length >> 1;
        const alongX = Math.abs(d[0]) > Math.abs(d[1]), sg = (alongX ? d[0] : d[1]) < 0 ? -1 : 1;
        const A = (i) => (alongX ? q[i * 2] : q[i * 2 + 1]), B = (i) => (alongX ? q[i * 2 + 1] : q[i * 2]);
        let a0 = Infinity, a1 = -Infinity;
        for (let i = 0; i < n; i++) { a0 = Math.min(a0, A(i)); a1 = Math.max(a1, A(i)); }
        // a の位置での外形の横の範囲 [b0, b1]
        const slice = (a) => {
          let b0 = Infinity, b1 = -Infinity;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const ai = A(i), aj = A(j);
            if ((ai > a) === (aj > a)) continue;
            const b = B(j) + (B(i) - B(j)) * (a - aj) / (ai - aj);
            b0 = Math.min(b0, b); b1 = Math.max(b1, b);
          }
          return [b0, b1];
        };
        const y0 = P.y0[p], H = P.y1f[p] - y0, L = (a1 - a0) / N, out = [];
        for (let i = 0; i < N; i++) {
          const s0 = sg > 0 ? a0 + i * L : a1 - (i + 1) * L, s1 = s0 + L;
          const e = Math.min(0.05, L / 4), m = Math.min(0.3, L / 3), cl = (x) => Math.min(a1 - m, Math.max(a0 + m, x)), u = slice(cl(s0 + e)), v = slice(cl(s1 - e)); // 端の段は外形の端の斜めの辺を避けて少し内側で測る
          const b0 = Math.max(u[0], v[0]), b1 = Math.min(u[1], v[1]);
          if (!(b1 - b0 > 0.5)) continue;
          const top = y0 + H * (i + 1) / N;
          const r = alongX ? { x0: s0, z0: b0, x1: s1, z1: b1 } : { x0: b0, z0: s0, x1: b1, z1: s1 };
          r.y0 = y0; r.y1 = top;
          out.push(r);
          SE.box(r.x0, y0, r.z0, r.x1, top, r.z1, st.mat || 'concrete', 'landmark', F.WALK);
        }
        this.stairs[st.id || String(gid)] = out;
      }
    }
    _initStatic() {
      const SE = new LIB.Emitter(true);
      this.shipRooms = [];
      const lms = (this.plan.landmarks || []).filter((l) => l && l.params && LIB.landmarks && LIB.landmarks[l.kind]);
      for (const lm of lms) {
        const off = lm.offset || [0, 0], dx = off[0], dz = off[1];
        const E = new LIB.Emitter(true);
        const gen = this._lmGen(lm, dx, dz);
        if (lm.kind === 'carrier') this._carrierStairSide(lm);
        LIB.landmarks[lm.kind](gen, E, lm.params);
        if (lm.kind === 'carrier') {
          this._carrierStair(E, lm.params);
          this.carrierOps = CityGen.prototype._carrierOps.call(gen);
        }
        for (const a of lm.add || []) E.box(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8] | 0);
        this._lmMerge(SE, E, lm, dx, dz);
        for (const r of E.rooms) this.shipRooms.push({ x0: r.x0 + dx, z0: r.z0 + dz, x1: r.x1 + dx, z1: r.z1 + dz, y0: r.y0, y1: r.y1 });
        const W = (r) => [r[0] + dx, r[1] + dz, r[2] + dx, r[3] + dz];
        for (const r of lm.footprint || []) this._foot.push({ id: lm.id, r: W(r) });
        for (const r of lm.plinthCut || []) this._plinthCut.push(W(r)); // v1 と同じ: 台を抜くのは沈んだ広場など（v1 の noPlinth）だけ。ランドマークの床は台の上（curbH）
        if (lm.cutDecks) for (const r of lm.footprint || []) this._deckCut.push(W(r));
        if (lm.kind === 'rockefeller' && lm.params.pit) { const q = lm.params.pit; const pr = [q[0] + dx, q[1] + dz, q[2] + dx, q[3] + dz]; this.pits.push({ rect: pr, y: q[4] }); const B = this._pitBB; B[0] = Math.min(B[0], pr[0]); B[1] = Math.min(B[1], pr[1]); B[2] = Math.max(B[2], pr[2]); B[3] = Math.max(B[3], pr[3]); }
      }
      this._initStairs(SE);
      this.staticItems = SE;
      this._lmDoors(SE);
      // 消した建物の残り
      if (this.core) for (const lm of lms) {
        const lsup = (this.landmarkSuppress && this.landmarkSuppress[lm.id]) || lm.suppress;
        if (!lm.remnants || !lsup || !lsup.length) continue;
        const gids = new Set(lsup.map((g) => g >>> 0)), feet = this._foot.filter((f) => f.id === lm.id).map((f) => f.r);
        const P = this.core.pieces, minA = (this.plan.remnant && this.plan.remnant.minArea) || 12, minD = (this.plan.remnant && this.plan.remnant.minDim) || 1.5;
        for (const p of this._supList || []) {
          if (!gids.has(P.gid[p])) continue;
          const k = P.ringStart[p];
          let parts = [Array.from(P.xz.subarray(P.vertStart[k] * 2, P.vertStart[k + 1] * 2))];
          for (const R of feet) { const nx = []; for (const q of parts) for (const s of ringMinusRect(q, R)) nx.push(s); parts = nx; }
          for (const q of parts) {
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let i = 0; i < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
            if (Math.abs(areaOf(q, q.length >> 1)) < minA || x1 - x0 < minD || z1 - z0 < minD) continue;
            this._remnants.push({ ring: new Float32Array(q), y0: P.y0[p], y1: P.y1f[p], piece: p, bb: [x0, z0, x1, z1], lm: lm.id });
          }
        }
      }
      // 梯子の登る側（法線の 0.6 m 先）の足元がデータの建物・消した建物の残りの中なら使えない（グランド・セントラルの北の壁の外の梯子 =
      //   MetLife の閉じた足元から登る・国連の総会の棟とボートハウスの西の梯子 = 残りの中）
      if (this.core) SE.ladders = SE.ladders.filter((l) => !(l.nx || l.nz) || !this._solidAt(l.x + (l.nx || 0) * 0.6, l.z + (l.nz || 0) * 0.6, l.y0));
      this._remnants.forEach((rm, i) => {
        const c0 = Math.max(0, Math.floor((rm.bb[0] - this.minX) / this.cs)), c1 = Math.min(this.ncx - 1, Math.floor((rm.bb[2] - this.minX) / this.cs));
        const d0 = Math.max(0, Math.floor((rm.bb[1] - this.minZ) / this.cs)), d1 = Math.min(this.ncz - 1, Math.floor((rm.bb[3] - this.minZ) / this.cs));
        for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) { const ci = cz * this.ncx + cx; let a = this._remChunk.get(ci); if (!a) this._remChunk.set(ci, a = []); a.push(i); }
      });
      // チャンクへ（部品の中心）
      const bucket = (ci) => {
        let b = this._sb.get(ci);
        if (!b) this._sb.set(ci, b = { boxes: [], ramps: [], ladders: [], props: [], loot: [], decals: [], landmarks: [], buildings: [], ground: [], water: [], roads: [] });
        return b;
      };
      const put = (type, it, x, z) => { const ci = this._ci(x, z); if (ci >= 0) bucket(ci)[type].push(it); };
      for (const k of ['boxes', 'ramps', 'ladders', 'props', 'loot', 'decals', 'landmarks']) for (const it of SE[k]) put(k, it, it.x, it.z);
      for (const k of ['buildings', 'ground', 'water']) for (const it of SE[k]) put(k, it, (it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2);
      for (const it of SE.roads) { let x = 0, z = 0; for (const p of it.pts) { x += p[0] / it.pts.length; z += p[1] / it.pts.length; } put('roads', it, x, z); }
      // 当たりの箱（重なるチャンクごと。v1 の colliderBoxes の静的な箱と同じ選び方: NOCOL でない・上端 1 m より上・高さ 0.2 m 以上、f は WALK / NOLOS）
      for (const b of SE.boxes) {
        if ((b.f & F.NOCOL) || b.y + b.h <= 1.0 || b.h < 0.2) continue;
        const q = { x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2, y0: b.y, y1: b.y + b.h, f: (b.f & 6) | 0 };
        const c0 = Math.max(0, Math.floor((q.x0 - this.minX) / this.cs)), c1 = Math.min(this.ncx - 1, Math.floor((q.x1 - 1e-6 - this.minX) / this.cs));
        const d0 = Math.max(0, Math.floor((q.z0 - this.minZ) / this.cs)), d1 = Math.min(this.ncz - 1, Math.floor((q.z1 - 1e-6 - this.minZ) / this.cs));
        for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) { const ci = cz * this.ncx + cx; let a = this._stColl.get(ci); if (!a) this._stColl.set(ci, a = []); a.push(q); }
      }
      // 遠景の外形（v1 の staticSil と同じ選び方）
      this._stSil = SE.boxes.filter((b) => !(b.f & F.NOCOL) && (b.cat === 'landmark' || b.cat === 'exterior' || b.cat === 'roof' || b.cat === 'road' || b.cat === 'pier') && Math.max(b.w, b.d) >= 12 && b.h >= 2);
      // 支え（32 m のセル）: 立てる箱（WALK・NOCOL でない・上端 1 m 以上）とスロープ（v1 の _initSupport と同じ）、残りの柱（外接矩形、上端 + roofExtra）
      const C = this._stSupC, W = this._stSupW = Math.ceil((this.maxX - this.minX) / C), H = this._stSupH = Math.ceil((this.maxZ - this.minZ) / C);
      const sup = this._stSup = new Array(W * H).fill(null);
      const addSup = (r, e) => {
        const i0 = Math.max(0, Math.floor((r[0] - this.minX) / C)), i1 = Math.min(W - 1, Math.floor((r[2] - this.minX) / C));
        const j0 = Math.max(0, Math.floor((r[1] - this.minZ) / C)), j1 = Math.min(H - 1, Math.floor((r[3] - this.minZ) / C));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; (sup[k] || (sup[k] = [])).push(e); }
      };
      for (const b of SE.boxes) {
        if (!(b.f & F.WALK) || (b.f & F.NOCOL) || b.y + b.h < 1) continue;
        const r = [b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2];
        addSup(r, { r, y: b.y + b.h, ramp: null });
      }
      for (const p of SE.ramps) { const r = [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2]; addSup(r, { r, y: Math.max(p.y0, p.y1), ramp: p }); }
      for (const rm of this._remnants) addSup(rm.bb, { r: rm.bb, y: Math.ceil(rm.y1) + this.S.roofExtra, ramp: null });
    }
    // 移したランドマークの建物の扉の点（buildings[].door。敵の出る所・復活の候補・テストが使う）が組み立ての固い箱の中なら、扉の面から
    //   外へ 0.25 m ずつ（10 m まで）動かして、立てる面（WALK の箱の上面、無ければ扉の高さ）の上 0.1〜1.7 m とその左右 0.4 m が空いた
    //   最初の点にする（図書館: v1 の扉の点はテラスの前の壁の中 = midtown も同じ。ここでは manhattan だけ直す）
    _lmDoors(SE) {
      for (const b of SE.buildings) {
        const d = b.door;
        if (!d) continue;
        const near = SE.boxes.filter((q) => !(q.f & F.NOCOL) && Math.abs(q.x - d[0]) < q.w / 2 + 12 && Math.abs(q.z - d[2]) < q.d / 2 + 12);
        const inB = (q, x, z) => Math.abs(x - q.x) <= q.w / 2 && Math.abs(z - q.z) <= q.d / 2;
        const blocked = (x, z, y) => near.some((q) => inB(q, x, z) && q.y < y + 1.7 && q.y + q.h > y + 0.1);
        const nx = d[0] < b.x0 ? -1 : d[0] > b.x1 ? 1 : 0, nz = nx ? 0 : (d[2] < b.z0 ? -1 : d[2] > b.z1 ? 1 : 0);
        if (!(nx || nz) || !blocked(d[0], d[2], d[1])) continue;
        for (let t = 0.25; t <= 10; t += 0.25) {
          const x = d[0] + nx * t, z = d[2] + nz * t;
          let y = d[1];
          for (const q of near) if ((q.f & F.WALK) && inB(q, x, z) && q.y + q.h <= d[1] + 3.5 && q.y + q.h > y) y = q.y + q.h;
          if (blocked(x, z, y) || blocked(x - nz * 0.4, z + nx * 0.4, y) || blocked(x + nz * 0.4, z - nx * 0.4, y)) continue;
          b.door = [r2(x), r2(y), r2(z)];
          break;
        }
      }
    }
    // v1 のランドマークの組み立てに渡す代わりの gen（CityGen.prototype のメソッド + 読む欄。座標は builder の座標 = 世界 − offset）
    _lmGen(lm, dx, dz) {
      const gen = Object.create(CityGen.prototype);
      gen.seed = this.seed; gen.M = this.M; gen.plan = this.plan; gen.curbH = this.curbH; gen.B = this.B; gen.waterY = this.waterY;
      gen.hotZones = this.hotZones.map((h) => Object.assign({}, h, { x: h.x - dx, z: h.z - dz }));
      gen.keepouts = this.helipads.map((h) => [h.x - dx, h.z - dz, (h.r || 0) + 3]);
      gen.claims = lm.claim ? [{ kind: lm.kind, rect: lm.claim.slice() }] : [];
      const fix = lm.entFix;
      if (fix) {
        // 入れる建物の扉の位置（extraDoors の s = 面の上の距離）を sShift ずらし、面の外の扉は捨てる（builder の矩形を本物の大きさに縮めたとき）。
        //   mainDoor（正面の扉の s）: 正面の真ん中が本物の隣の建物・消した建物の残りに面しているとき、開いた所へ（グランド・セントラルの
        //   東の棟はグレイバー・ビル、国連の総会の棟は総会の建物の残りに扉が入っていた）
        gen._ent = function (E, o) {
          const f = fix[o.id];
          if (f && o.extraDoors) {
            const len = (fc) => ((o.front === 'w' || o.front === 'e') === (fc < 2) ? o.z1 - o.z0 : o.x1 - o.x0);
            o = Object.assign({}, o, { extraDoors: o.extraDoors.map((d) => Object.assign({}, d, { s: d.s + (f.sShift || 0) })).filter((d) => d.s >= 1 && d.s + (d.w || 2) <= len(d.face) - 1) });
          }
          if (f && f.mainDoor != null) o = Object.assign({}, o, { mainDoor: f.mainDoor });
          return CityGen.prototype._ent.call(this, E, o);
        };
      }
      return gen;
    }
    // 組み立てた物を絞って平行移動して SE へ（keep: 中心がどれかの矩形の中、drop: 中心が矩形（と y の範囲）の中なら捨てる）
    _lmMerge(SE, E, lm, dx, dz) {
      const keep = lm.keep || null, drop = lm.drop || null, dDec = lm.dropDecals || null;
      const ok = (x, z, y) => {
        if (keep && !keep.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3])) return false;
        if (drop && drop.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3] && (r.length < 6 || (y >= r[4] && y <= r[5])))) return false;
        return true;
      };
      const mv = (it) => Object.assign({}, it, { x: r2(it.x + dx), z: r2(it.z + dz) });
      const mvR = (it) => Object.assign({}, it, { x0: r2(it.x0 + dx), z0: r2(it.z0 + dz), x1: r2(it.x1 + dx), z1: r2(it.z1 + dz) });
      const pt = (a) => (Array.isArray(a) && a.length >= 3 ? [r2(a[0] + dx), a[1], r2(a[2] + dz)] : a);
      // 埋まった床: 立てる箱の上面が固い箱（立てない）の中で、その箱が床の xz の 9 割以上を覆う（グランド・セントラルの北のホームの屋根が
      //   keep で切れて北の壁の中に残った 3 m の帯。梯子は _initStatic が消した建物の残りを作った後で見る）
      //   固い箱は中心の 8 m のセルで引く（9 割を覆う箱は床の中心を含む）
      const SC = 8, sg = new Map(), sk = (i, j) => i * 65536 + j;
      for (const q of E.boxes) {
        if ((q.f & (F.WALK | F.NOCOL)) || q.h <= 1) continue;
        for (let i = Math.floor((q.x - q.w / 2) / SC); i <= Math.floor((q.x + q.w / 2) / SC); i++) for (let j = Math.floor((q.z - q.d / 2) / SC); j <= Math.floor((q.z + q.d / 2) / SC); j++) {
          const k = sk(i, j); let a = sg.get(k); if (!a) sg.set(k, a = []); a.push(q);
        }
      }
      const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
      const buried = (b) => {
        if (!(b.f & F.WALK)) return false;
        const top = b.y + b.h;
        for (const q of sg.get(sk(Math.floor(b.x / SC), Math.floor(b.z / SC))) || []) {
          if (top > q.y + 0.05 && top < q.y + q.h - 0.05 &&
            ov(b.x - b.w / 2, b.x + b.w / 2, q.x - q.w / 2, q.x + q.w / 2) * ov(b.z - b.d / 2, b.z + b.d / 2, q.z - q.d / 2, q.z + q.d / 2) >= 0.9 * b.w * b.d) return true;
        }
        return false;
      };
      for (const b of E.boxes) if (ok(b.x, b.z, b.y) && !buried(b)) SE.boxes.push(mv(b));
      for (const p of E.ramps) if (ok(p.x, p.z, Math.min(p.y0, p.y1))) SE.ramps.push(mv(p));
      for (const l of E.ladders) if (ok(l.x, l.z, l.y0)) SE.ladders.push(mv(l));
      for (const p of E.props) if (ok(p.x, p.z, p.y)) SE.props.push(mv(p));
      for (const l of E.loot) if (ok(l.x, l.z, l.y)) SE.loot.push(mv(l));
      for (const d of E.decals) if ((!dDec || dDec.indexOf(d.type) < 0) && ok(d.x, d.z, d.y || 0)) SE.decals.push(mv(d));
      for (const p of E.landmarks) if (ok(p.x, p.z, p.y)) SE.landmarks.push(mv(p));
      for (const b of E.buildings) if (ok((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0)) SE.buildings.push(Object.assign(mvR(b), { door: pt(b.door), roof: pt(b.roof), lm: lm.id }));
      for (const g of E.ground) if (ok((g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2, 0)) SE.ground.push(mvR(g));
      for (const w of E.water) SE.water.push(w.x0 != null ? mvR(w) : w);
      for (const r of E.roads) SE.roads.push(Object.assign({}, r, { pts: r.pts.map((p) => [r2(p[0] + dx), r2(p[1] + dz)]) }));
    }
    // 空母の階段塔の舷は姿勢に付いてくる: params.stair の足元（lanes の内側 2 本の真ん中・stair.z[0] − 6）が陸（桟橋）でなく、反対の舷の
    //   足元が陸なら、lanes / bridge を x で鏡に写した階段（右舷 ⇔ 左舷。midtown の左舷の階段と同じ形）にする。yaw を 90 ⇔ −90 に変えても
    //   桟橋から甲板へ歩ける（tools/city-test-nyc.js が yaw −90 / 90 の両方で確かめる）。lm.params を写し替える（同じ plan で何度作っても同じ）
    _carrierStairSide(lm) {
      const p = lm.params, st = p && p.stair;
      if (!st || !Array.isArray(st.lanes) || st.lanes.length < 3) return;
      const foot = (ln) => CityGenNyc.lmToWorld(p, (ln[0] + ln[1]) / 2, st.z[0] - 6);
      const a = foot(st.lanes), mln = [-st.lanes[2], -st.lanes[1], -st.lanes[0]], b = foot(mln);
      if (this.isLand(a[0], a[1]) || !this.isLand(b[0], b[1])) return;
      const ms = Object.assign({}, st, { lanes: mln });
      if (Array.isArray(st.bridge)) ms.bridge = [-st.bridge[1], -st.bridge[0], st.bridge[2], st.bridge[3]];
      // 塔の上の戦利品（lanes の幅・landNear〜landFar の中）も一緒に写す（写さないと水の上 17 m に浮く）
      const lx0 = Math.min(st.lanes[0], st.lanes[2]), lx1 = Math.max(st.lanes[0], st.lanes[2]);
      const zl0 = st.landNear ? st.landNear[0] : st.z[0], zl1 = st.landFar ? st.landFar[1] : st.z[1];
      const loot = Array.isArray(p.loot) ? p.loot.map((l) => (l[0] >= lx0 - 0.01 && l[0] <= lx1 + 0.01 && l[2] >= zl0 - 0.01 && l[2] <= zl1 + 0.01 ? [-l[0]].concat(l.slice(1)) : l)) : p.loot;
      lm.params = Object.assign({}, p, { stair: ms, loot });
    }
    // 空母の階段塔を右舷（params.stair.lanes が負 = 桟橋の側）にしたとき: v1 は外側の手すりを lanes[2]（左舷の外）に置くので、
    //   右舷では艦との間（甲板への渡り板の前）になる → 外側（lanes[0] − 0.15）へ移す
    _carrierStair(E, p) {
      const st = p.stair, ln = st && st.lanes;
      if (!ln || !(ln[0] < 0)) return;
      const th = p.yaw * Math.PI / 180, c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
      const wx = (x, z) => p.x + x * c + z * sn, wz = (x, z) => p.z - x * sn + z * c;
      const rect = (x0, z0, x1, z1) => { const a = [wx(x0, z0), wx(x1, z1)], b = [wz(x0, z0), wz(x1, z1)]; return [Math.min(a[0], a[1]), Math.min(b[0], b[1]), Math.max(a[0], a[1]), Math.max(b[0], b[1])]; };
      const bad = rect(ln[2], st.landNear[0], ln[2] + 0.15, st.landFar[1]);
      const i = E.boxes.findIndex((b) => b.f === F.NOLOS && Math.abs(b.x - (bad[0] + bad[2]) / 2) < 0.02 && Math.abs(b.z - (bad[1] + bad[3]) / 2) < 0.02);
      if (i < 0) return;
      const b = E.boxes[i];
      E.boxes.splice(i, 1);
      const r = rect(ln[0] - 0.15, st.landNear[0], ln[0], st.landFar[1]);
      E.tag = 'carrier';
      E.box(r[0], b.y, r[1], r[2], b.y + b.h, r[3], b.mat, b.cat, b.f);
      E.tag = null;
    }

    // ===== ヘリポート（plan.heliports = nyc.json の本物のヘリポート + ランドマークのパッド + 屋上の HPAD）=====
    //   本物のヘリポートは core HPAD の地上のパッド（その矩形の中・陸）を perHeliport 個（中心に近い順）。パッドが無ければヘリを出さない（heli: false）。
    //   屋上の HPAD はホットゾーンの縁から roofNear m 以内（入れる建物なら access 'climb'、ほかは 'heli' = ヘリでしか行けない）
    _initHelipads() {
      const hd = this.plan.heliportDefaults || {}, per = hd.perHeliport || 1, chk = hd.padCheck || 3.5, clr = hd.padClear || 6;
      const out = [];
      const flatAt = (x, z, y) => {
        if (!this.isLand(x, z) || this._topOver(x, z, y + 0.4)) return false;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          if (!this.isLand(x + Math.cos(a) * chk, z + Math.sin(a) * chk)) return false;
          if (this._topOver(x + Math.cos(a) * clr, z + Math.sin(a) * clr, y + 0.4)) return false;
        }
        return true;
      };
      for (const h of this.helipads) {
        if (!h.rect || !this._pads.length) { out.push(h); continue; }
        const r = h.rect;
        const c = this._pads.filter((p) => !p.roof && p.r > 0 && p.x >= r[0] && p.x <= r[2] && p.z >= r[1] && p.z <= r[3] && flatAt(p.x, p.z, p.y))
          .sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z) || a.x - b.x);
        if (!c.length) { out.push(Object.assign({}, h, { heli: false })); continue; }
        c.slice(0, per).forEach((p, k) => out.push(Object.assign({}, h, { id: k ? h.id + '_' + k : h.id, label: k ? '' : h.label, x: r2(p.x), y: p.y, z: r2(p.z), r: r2(Math.max(p.r, 6)), hpad: true })));
      }
      // 地上の HPAD で本物のヘリポートの矩形の外のもの（エクスチェンジ・プレイスの桟橋の先のパッド）: ホットゾーンの縁から groundNear m 以内で
      //   平ら（flatAt）なら歩いて行けるパッド（パッドに 30 m より近いデータのパッドがあれば足さない）。0 / 無し = 足さない
      const gNear = hd.groundNear || 0;
      if (gNear > 0) for (const p of this._pads) {
        if (p.roof || p.r <= 0) continue;
        if (this.helipads.some((h) => (h.rect && p.x >= h.rect[0] && p.x <= h.rect[2] && p.z >= h.rect[1] && p.z <= h.rect[3]) || (!h.rect && Math.hypot(p.x - h.x, p.z - h.z) < 30))) continue;
        let d = Infinity;
        for (const z of this.hotZones) d = Math.min(d, Math.hypot(p.x - z.x, p.z - z.z) - z.r);
        if (d > gNear || !flatAt(p.x, p.z, p.y)) continue;
        out.push({ id: 'hpad_' + Math.round(p.x) + '_' + Math.round(p.z), label: '', x: r2(p.x), y: p.y, z: r2(p.z), r: r2(Math.max(p.r, 6)), access: 'walk', hpad: true });
      }
      // ランドマークのパッド（builder の座標 → 世界）
      for (const lm of this.plan.landmarks || []) {
        const off = lm.offset || [0, 0];
        for (const h of lm.helipads || []) {
          // local [lx, lz]: パッドは params の姿勢（x, z, yaw）の局所の座標（空母の甲板の印。向きを変えても書き直さない）
          const w = Array.isArray(h.local) && lm.params ? CityGenNyc.lmToWorld(lm.params, h.local[0], h.local[1]) : [h.x + off[0], h.z + off[1]];
          out.push(Object.assign({}, h, { x: r2(w[0]), z: r2(w[1]), spawn: h.spawn ? h.spawn.slice() : undefined, lm: lm.id }));
        }
      }
      // 屋上の HPAD
      const near = hd.roofNear != null ? hd.roofNear : 500;
      for (const p of this._pads) {
        if (!p.roof || p.r <= 0) continue;
        let d = Infinity;
        for (const z of this.hotZones) d = Math.min(d, Math.hypot(p.x - z.x, p.z - z.z) - z.r);
        if (d > near) continue;
        out.push({ id: 'roof_' + Math.round(p.x) + '_' + Math.round(p.z), label: '', x: r2(p.x), y: p.y, z: r2(p.z), r: r2(p.r), access: this._roofEnterable(p.x, p.z) ? 'climb' : 'heli', hpad: true });
      }
      this.helipads = out;
    }
    // (x, z) が入れる建物（ENTB で _entOn）の屋上か
    _roofEnterable(x, z) {
      const EN = this.core && this.core.entb;
      if (!EN) return false;
      for (let r = 0; r < EN.count; r++) {
        if (x < EN.rect[r * 4] || x > EN.rect[r * 4 + 2] || z < EN.rect[r * 4 + 1] || z > EN.rect[r * 4 + 3]) continue;
        if (!this._sup[EN.piece[r]] && this._entOn(r)) return true;
      }
      return false;
    }

    // ===== 乗り物（v1 の _initVehicles と同じ順: ヘリ → 車 → 空母の戦闘機）=====
    //   core だけで決まるので、同じ core・同じプランの乗り物は 1 回だけ作って覚えておく（VEH_CACHE）。ブラウザは読み込み中
    //   （NycTiles.prepareLevel / main.js waitSpawnTiles の probe）に作るので、ゲームの最初の chunkFull が 8〜25 ms 待たない
    _initVehicles() {
      const key = (this.plan.id || '') + '|' + this.seed + '|' + JSON.stringify(this.plan.vehicles || null);
      const hit = this.core && VEH_CACHE ? VEH_CACHE.get(this.core) : null;
      if (hit && hit.key === key) { this._indexVehicles(hit.list.map((v) => Object.assign({}, v))); this.vehFromCache = true; return; }
      this._initVehiclesNow();
      if (this.core && VEH_CACHE) VEH_CACHE.set(this.core, { key, list: this._vehicles.map((v) => Object.assign({}, v)) });
    }
    _initVehiclesNow() {
      const V = this.plan.vehicles || {};
      const out = [];
      if (V.heli) for (const h of this.helipads) {
        if (h.heli === false) continue;
        const sp = Array.isArray(h.spawn) ? h.spawn : null;
        out.push({ id: 'h_' + h.id, type: 'heli', x: sp ? sp[0] : h.x, y: sp && sp.length > 3 ? sp[3] : (h.y || 0), z: sp ? sp[1] : h.z, yaw: sp && sp.length > 2 ? sp[2] : (hash(this.seed, 21, LIB.strHash(h.id), 0) % 8) * 45 });
      }
      if (V.parking && this.core && this.core.roads) this._initParking(V, out);
      if (V.jets && this.carrierOps) this.carrierOps.jetSpots.forEach((s, k) => out.push({ id: 'j_' + (k + 1), type: 'jet', x: s.x, y: s.y, z: s.z, yaw: s.yaw }));
      this._indexVehicles(out);
    }
    _indexVehicles(out) {
      this._vehicles = out;
      this._vehChunk = new Map();
      for (const v of out) { const ci = this._ci(v.x, v.z); if (ci < 0) continue; let a = this._vehChunk.get(ci); if (!a) this._vehChunk.set(ci, a = []); a.push(v); }
    }
    // 駐車（plan.vehicles.parking）: core RDS の車道の縁石の内側。core だけで決まる（サーバーも同じ）。確かめるのは陸・地面 0・支え（建物・
    //   橋の床・ランドマーク）が無い・ヘリポートの周りでない・ランドマークの矩形の外・ほかの車から spacing m（タイルの小物・台はブラウザの
    //   MR.Vehicle.findSpawn と city-test-nyc の 'vehicle spawns' が見る）
    _initParking(V, out) {
      const K = V.parking, R = this.core.roads, en = (this.meta && this.meta.enums && this.meta.enums.roadClass) || [];
      const cls = new Set(K.classes || ['primary', 'secondary', 'tertiary', 'residential']);
      const step = K.step || 40, minW = K.minWidth || 8, minSide = K.minSide || 3.5, inset = K.curbInset || 1.4, gap = K.curbGap != null ? K.curbGap : 0.25;
      const spacing = K.spacing || 14, hotR = K.hotRange || 500, cross = K.crossClear != null ? K.crossClear : 2, endClear = K.endClear != null ? K.endClear : 1;
      const sizes = K.sizes || {}, defSize = [K.halfWidth ? K.halfWidth * 2 : 2.4, K.length || 5.2];
      const mix = V.mix || [['jeep', 1]], pMax = Math.max(K.nearHot || 0, K.elsewhere || 0);
      const NOT = 1 | 2 | 16 | 32 | 128; // 橋・トンネル・広場・高架・車なし（roadFlags）
      const cell = new Map(), ck = (x, z) => Math.floor(x / spacing) + ':' + Math.floor(z / spacing);
      const near = (x, z) => {
        const i = Math.floor(x / spacing), j = Math.floor(z / spacing);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of cell.get((i + a) + ':' + (j + b)) || []) if (Math.hypot(q[0] - x, q[1] - z) < spacing) return true;
        return false;
      };
      const ecc = (this.elCfg && this.elCfg.carClear) || 1;
      const clear = (x, z) => this.isLand(x, z) && this.groundY(x, z) === 0 && !this._topOver(x, z, this.curbH + 0.01) && !(this._elCols && this._elColNear(x, z, ecc)) &&
        !this._foot.some((f) => x > f.r[0] - 2 && x < f.r[2] + 2 && z > f.r[1] - 2 && z < f.r[3] + 2);
      // ほかの道の車道（交差点・合流）: 道の区間を 64 m のセルに入れ、中心線から縁石 + crossClear m の中なら置かない（初めて要るときに作る）
      let segGrid = null;
      const SG = 64;
      const onOther = (x, z, self) => {
        if (!segGrid) {
          segGrid = new Map();
          for (let i = 0; i < R.count; i++) {
            if (R.flags[i] & (2 | 32)) continue; // トンネル・高架の下は見ない
            const w = Math.max(R.curbL[i], R.curbR[i]) + cross;
            for (let v = R.vertStart[i]; v + 1 < R.vertStart[i + 1]; v++) {
              const x0 = Math.min(R.xz[v * 2], R.xz[v * 2 + 2]) - w, x1 = Math.max(R.xz[v * 2], R.xz[v * 2 + 2]) + w;
              const z0 = Math.min(R.xz[v * 2 + 1], R.xz[v * 2 + 3]) - w, z1 = Math.max(R.xz[v * 2 + 1], R.xz[v * 2 + 3]) + w;
              for (let gz = Math.floor(z0 / SG); gz <= Math.floor(z1 / SG); gz++) for (let gx = Math.floor(x0 / SG); gx <= Math.floor(x1 / SG); gx++) {
                const k2 = (gx + 512) * 1024 + gz + 512; let c = segGrid.get(k2); if (!c) segGrid.set(k2, c = []); c.push(i, v);
              }
            }
          }
        }
        const c = segGrid.get((Math.floor(x / SG) + 512) * 1024 + Math.floor(z / SG) + 512);
        if (c) for (let n = 0; n < c.length; n += 2) {
          const i = c[n], v = c[n + 1];
          if (i === self) continue;
          const lim = Math.max(R.curbL[i], R.curbR[i]) + cross;
          if (segDist2(x, z, R.xz[v * 2], R.xz[v * 2 + 1], R.xz[v * 2 + 2], R.xz[v * 2 + 3]) < lim * lim) return true;
        }
        return false;
      };
      for (let i = 0; i < R.count; i++) {
        if (!cls.has(en[R.cls[i]]) || (R.flags[i] & NOT)) continue;
        if (R.curbL[i] + R.curbR[i] < minW) continue;
        const a = R.vertStart[i], e = R.vertStart[i + 1];
        let s0 = 0, k = 0;
        for (let v = a; v + 1 < e; v++) {
          const ax = R.xz[v * 2], az = R.xz[v * 2 + 1], bx = R.xz[v * 2 + 2], bz = R.xz[v * 2 + 3], L = Math.hypot(bx - ax, bz - az);
          if (L < 1e-3) continue;
          const fx = (bx - ax) / L, fz = (bz - az) / L, nx = -fz, nz = fx; // 左の法線（tools/nyc/nycv2geo.py と同じ）
          // 区間の中の候補の位置 s（道の始めからの距離 = 決まった間隔）
          for (let s = Math.ceil((s0 - step / 2) / step) * step + step / 2; s < s0 + L; s += step) {
            const t = s - s0;
            for (let side = 0; side < 2; side++) {
              const curb = side === 0 ? R.curbL[i] : R.curbR[i];
              if (curb < minSide) continue;
              const h = hash(this.seed, 23, i, k * 2 + side);
              if (u01(h) >= pMax) continue; // どちらの確率でも出ない（ほとんどの候補。ゾーンまでの距離を測らない）
              const type = LIB.weighted(LIB.rng(h ^ 0x5bd1e995), mix);
              const sz = sizes[type] || defSize, hw = sz[0] / 2 + 0.1, hl = sz[1] / 2 + 0.1; // 車の大きさ（game.json の vehicles.types と同じ値）+ 10 cm
              if (t < hl + endClear || t > L - hl - endClear) continue; // 曲がり角（歩道の角の丸み）に車をかけない
              const cx = ax + fx * t, cz = az + fz * t;
              let dh = Infinity;
              for (const z of this.hotZones) dh = Math.min(dh, Math.hypot(cx - z.x, cz - z.z) - z.r);
              if (u01(h) >= (dh < hotR ? K.nearHot : K.elsewhere)) continue;
              const off = curb - Math.max(inset, hw + gap); // 縁石から curbInset m（大きい車は車幅の半分 + curbGap）内側
              if (off < hw) continue; // 細い道: 車が中心線を越える
              const o = off * (side === 0 ? 1 : -1);
              const x = cx + nx * o, z = cz + nz * o;
              if (x < this.minX + 20 || x > this.maxX - 20 || z < this.minZ + 20 || z > this.maxZ - 20) continue;
              if (this.isKeepout(x, z, 8) || near(x, z)) continue;
              let ok = clear(x, z) && !onOther(x, z, i);
              for (let q = 0; q < 4 && ok; q++) {
                const u = q & 1 ? hl : -hl, w = q & 2 ? hw : -hw, px = x + fx * u + nx * w, pz = z + fz * u + nz * w;
                ok = clear(px, pz) && !onOther(px, pz, i);
              }
              if (!ok) continue;
              // 向き: 右の縁は道の向き、左の縁は逆（右側通行）。一方通行は両側とも道の向き
              const one = !!(R.flags[i] & 8), back = side === 0 && !one;
              const yaw = Math.round(Math.atan2(back ? -fx : fx, back ? -fz : fz) * 180 / Math.PI * 10) / 10;
              out.push({ id: 'v_' + i + '_' + k + (side ? 'r' : 'l'), type, x: r2(x), y: 0, z: r2(z), yaw });
              const key = ck(x, z);
              let c = cell.get(key); if (!c) cell.set(key, c = []); c.push([x, z]);
            }
            k++;
          }
          s0 += L;
        }
      }
    }

    // ===== 範囲とチャンク（v1 と同じ）=====
    chunkOf(x, z) { return { cx: Math.floor((x - this.minX) / this.cs), cz: Math.floor((z - this.minZ) / this.cs) }; }
    chunkKey(cx, cz) { return cx + '_' + cz; }
    chunkRect(cx, cz) { const x0 = this.minX + cx * this.cs, z0 = this.minZ + cz * this.cs; return [x0, z0, x0 + this.cs, z0 + this.cs]; }
    _ci(x, z) {
      const cx = Math.floor((x - this.minX) / this.cs), cz = Math.floor((z - this.minZ) / this.cs);
      if (cx < 0 || cz < 0 || cx >= this.ncx || cz >= this.ncz) return -1;
      return cz * this.ncx + cx;
    }
    _inRange(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.ncx && cz < this.ncz; }
    // ヘリポートの周り（keepouts）の中か。v1 の _kept と同じ（respawn.js は isKeepout を使う）
    isKeepout(x, z, m) { for (const k of this.keepouts) if (Math.hypot(x - k[0], z - k[1]) < k[2] + (m || 0)) return true; return false; }
    _kept(x, z, m) { return this.isKeepout(x, z, m); }
    _hotAt(x, z) {
      for (let i = 0; i < this.hotZones.length; i++) { const h = this.hotZones[i]; if (Math.hypot(x - h.x, z - h.z) <= h.r) return i; }
      return -1;
    }

    // ===== タイル =====
    // チャンクに要るタイルを頼む。全部そろっていれば true（タイルを使わない作り（tiles 無し）は常に true）
    request(cx, cz, priority) { return this.tiles ? this.tiles.request(cx, cz, priority) : true; }
    // チャンクのタイルが読めているか（頼まない = 取りに行かない。遠景の木の作り直しの確かめ）
    chunkReady(cx, cz) {
      if (!this.tiles) return true;
      for (const t of this.tiles.tilesForChunk(cx, cz)) if (!this.tiles.ready(t[0], t[1])) return false;
      return true;
    }
    // rect [x0, z0, x1, z1] のタイルが全部そろったら解決する Promise
    whenReady(rect, priority) { return this.tiles ? this.tiles.whenReady(rect, priority) : Promise.resolve(); }
    // チャンクのタイル（タイル = 4 × 4 チャンク、原点が同じ。ファイルが無い = 全部水 → null）
    _chunkTile(cx, cz, peekOnly) {
      if (!this.tiles) return null;
      const tx = Math.floor(cx * this.cs / (this.tiles.size || 512)), tz = Math.floor(cz * this.cs / (this.tiles.size || 512));
      if (!this.tiles.hasFile(tx, tz)) return null;
      return peekOnly && !this.tiles.sync ? this.tiles.peek(tx, tz) : this.tiles.get(tx, tz);
    }
    _tile(x, z) {
      if (!this.tiles) return { tile: null, known: false };
      const t = this.tiles.tileOf(x, z);
      if (!this.tiles.hasFile(t[0], t[1])) return { tile: null, known: true }; // ファイルが無い = 全部水
      const tile = this.tiles.get(t[0], t[1]);
      return { tile, known: !!tile };
    }
    _codes() {
      if (!this._areaCodes) {
        const m = this.meta || { enums: {} };
        const code = (n) => (NycData ? NycData.enumCode(m, 'areaKind', n) : -1);
        this._areaCodes = { land: code('land'), water: code('water'), pier: code('pier') };
      }
      return this._areaCodes;
    }
    // タイルの AREA を種類ごとに外接矩形つきで（タイルごとに 1 回。core の無い作り = M0a の名残）
    _areas(tile) {
      let ix = this._areaIdx && this._areaIdx.get(tile);
      if (ix) return ix;
      const A = tile.areas, c = this._codes();
      ix = { land: [], water: [], pier: [], bb: new Float32Array(A.count * 4) };
      for (let i = 0; i < A.count; i++) {
        const k = A.kind[i];
        const v0 = A.vertStart[A.ringStart[i]], v1 = A.vertStart[A.ringStart[i] + 1];
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = v0; v < v1; v++) {
          const x = A.xz[v * 2], z = A.xz[v * 2 + 1];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        ix.bb[i * 4] = x0; ix.bb[i * 4 + 1] = z0; ix.bb[i * 4 + 2] = x1; ix.bb[i * 4 + 3] = z1;
        if (k === c.land) ix.land.push(i); else if (k === c.water) ix.water.push(i); else if (k === c.pier) ix.pier.push(i);
      }
      if (this._areaIdx) this._areaIdx.set(tile, ix);
      return ix;
    }
    _inAreas(tile, list, ix, x, z) {
      for (const i of list) {
        if (x < ix.bb[i * 4] || z < ix.bb[i * 4 + 1] || x > ix.bb[i * 4 + 2] || z > ix.bb[i * 4 + 3]) continue;
        if (NycData.pointIn(tile.areas, i, x, z)) return i;
      }
      return -1;
    }

    // ===== 地形 =====
    // { y: 地面（川底・湖底・穴の底）, water: 水面 or null }。
    //   core があれば core の LGRD（4 m の陸の格子。純粋なセルは O(1)）+ LAND（陸 ∪ 桟橋）と WATR（内陸の水の y / bed）。
    //   core が無いときは読み込んだタイルの AREA land の多角形。タイルがまだ無い所は陸として答える（溺れさせない）。
    groundAt(x, z) {
      if (this.rail && this.rail.pitAt) { const p = this.rail.pitAt(x, z); if (p) return { y: p.y, water: null }; } // R4 のフック 4
      if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return { y: this.bedY, water: this.waterY };
      if (this._gFlags) { // 速い道（下と同じ答え）
        const f = this._gFlagAt(x, z);
        if (f >= 0) {
          if (f & 1) { const y = this._pitY(x, z); if (y !== null) return { y, water: null }; }
          if (f & 2) { const y = this._portalPitY(x, z); if (y !== null) return { y, water: null }; }
          if (this._landFast(x, z, f)) return { y: 0, water: null };
          const w = f & 4 ? this._coreWater(x, z) : -1;
          if (w >= 0) { const W = this.core.water; return { y: W.bed[w], water: W.y[w] }; }
          return { y: this.bedY, water: this.waterY };
        }
      }
      if (x >= this._pitBB[0] && x <= this._pitBB[2] && z >= this._pitBB[1] && z <= this._pitBB[3]) { const y = this._pitY(x, z); if (y !== null) return { y, water: null }; } // 沈んだ広場（v1 と同じ）
      if (this._pitGrid) { const y = this._portalPitY(x, z); if (y !== null) return { y, water: null }; } // トンネルの口（NC3）
      if (this.core && this.core.lgrd) {
        if (this.core.isLand(x, z)) return { y: 0, water: null };
        const w = this._coreWater(x, z);
        if (w >= 0) { const W = this.core.water; return { y: W.bed[w], water: W.y[w] }; }
        return { y: this.bedY, water: this.waterY };
      }
      const t = this._tile(x, z);
      if (!t.tile) return t.known ? { y: this.bedY, water: this.waterY } : { y: 0, water: null };
      const ix = this._areas(t.tile);
      if (this._inAreas(t.tile, ix.land, ix, x, z) >= 0) return { y: 0, water: null };
      const w = this._inAreas(t.tile, ix.water, ix, x, z);
      if (w >= 0 && t.tile.areas.y[w]) { const y = t.tile.areas.y[w]; return { y: y - ((this.plan.water && this.plan.water.inlandDepth) || 0), water: y }; }
      return { y: this.bedY, water: this.waterY };
    }
    // core WATR の i 番（外接矩形で絞って偶奇）。無ければ −1
    _coreWater(x, z) {
      const W = this.core.water;
      if (!W || !W.count) return -1;
      if (!this._wbb) {
        const bb = new Float32Array(W.count * 4);
        for (let i = 0; i < W.count; i++) {
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = W.vertStart[W.ringStart[i]]; v < W.vertStart[W.ringStart[i] + 1]; v++) {
            const px = W.xz[v * 2], pz = W.xz[v * 2 + 1];
            if (px < x0) x0 = px; if (px > x1) x1 = px; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
          }
          bb[i * 4] = x0; bb[i * 4 + 1] = z0; bb[i * 4 + 2] = x1; bb[i * 4 + 3] = z1;
        }
        this._wbb = bb;
        // 64 m のセル → 外接矩形が触れる水の多角形
        const cell = 64, GW = Math.ceil((this.maxX - this.minX) / cell), GH = Math.ceil((this.maxZ - this.minZ) / cell);
        const csr = this._csr(W.count, (i, put) => {
          const i0 = Math.max(0, Math.floor((bb[i * 4] - this.minX) / cell)), i1 = Math.min(GW - 1, Math.floor((bb[i * 4 + 2] - this.minX) / cell));
          const j0 = Math.max(0, Math.floor((bb[i * 4 + 1] - this.minZ) / cell)), j1 = Math.min(GH - 1, Math.floor((bb[i * 4 + 3] - this.minZ) / cell));
          for (let j = j0; j <= j1; j++) for (let q = i0; q <= i1; q++) put(j * GW + q);
        }, GW * GH);
        this._wgrid = { cell, W: GW, H: GH, csr };
      }
      const bb = this._wbb, G = this._wgrid;
      const gi = Math.floor((x - this.minX) / G.cell), gj = Math.floor((z - this.minZ) / G.cell);
      if (gi < 0 || gj < 0 || gi >= G.W || gj >= G.H) return -1;
      const k = gj * G.W + gi;
      for (let n = G.csr.start[k]; n < G.csr.start[k + 1]; n++) {
        const i = G.csr.items[n];
        if (x < bb[i * 4] || z < bb[i * 4 + 1] || x > bb[i * 4 + 2] || z > bb[i * 4 + 3]) continue;
        if (NycData.pointIn(W, i, x, z)) return i;
      }
      return -1;
    }
    // 物を作らない速い道（core の LGRD があり R4 の穴が無いとき）。同じ答え = groundAt(x, z).water
    //   y（体の足の高さ。R4 §3.4.4）: rail があり、y が地面（川底）より下（地下の空洞・岩の中）なら水は無い（null）。rail が無ければ y は見ない
    waterLevelAt(x, z, y) {
      if (this.rail && y != null && y < this.groundAt(x, z).y - 0.05) return null;
      if (this.rail && this.rail.pitAt && this.rail.pitAt(x, z)) return null; // 穴の中は陸（groundAt と同じ答え）
      if (!this.core || !this.core.lgrd) return this.groundAt(x, z).water;
      if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return this.waterY;
      if (this.core.isLand(x, z)) return null;
      const w = this._coreWater(x, z);
      return w >= 0 ? this.core.water.y[w] : this.waterY;
    }
    isLand(x, z) { return this.waterLevelAt(x, z) === null; }
    isWater(x, z, y) { return this.waterLevelAt(x, z, y) !== null; }
    // 沈んだ広場の底（穴の中でなければ null）
    _pitY(x, z) {
      for (let i = 0; i < this.pits.length; i++) { const p = this.pits[i]; if (x >= p.rect[0] && x <= p.rect[2] && z >= p.rect[1] && z <= p.rect[3]) return p.y; }
      return null;
    }
    // トンネルの口の囲いの中なら地面の穴の底（_initEl の _pitGrid）。無ければ null
    _portalPitY(x, z) {
      const G = this._pitGrid, i = Math.floor((x - this.minX) / G.cell), j = Math.floor((z - this.minZ) / G.cell);
      if (i < 0 || j < 0 || i >= G.W || j >= G.H) return null;
      const v = G.g[j * G.W + i];
      if (!v) return null;
      if (v !== 255) { const o = this._portals[v - 1]; return this._inObb(o, x, z, 0) ? o.pitY : null; }
      for (const o of this._portals) if (this._inObb(o, x, z, 0)) return o.pitY;
      return null;
    }
    // 0 = 陸と桟橋、水の上は水面（穴の中は穴の底）
    groundY(x, z) {
      if (this.rail && this.rail.pitAt) { const p = this.rail.pitAt(x, z); if (p) return p.y; } // R4 のフック 4（穴の底。下の速い道と同じ答え）
      if (this.core && this.core.lgrd) { // 速い道（物を作らない。supportHeightAt が毎回呼ぶ）
        if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return this.waterY;
        if (this._gFlags) {
          const f = this._gFlagAt(x, z);
          if (f >= 0) {
            if (f & 1) { const y = this._pitY(x, z); if (y !== null) return y; }
            if (f & 2) { const y = this._portalPitY(x, z); if (y !== null) return y; }
            if (this._landFast(x, z, f)) return 0;
            const w = f & 4 ? this._coreWater(x, z) : -1;
            return w >= 0 ? this.core.water.y[w] : this.waterY;
          }
        }
        if (x >= this._pitBB[0] && x <= this._pitBB[2] && z >= this._pitBB[1] && z <= this._pitBB[3]) { const y = this._pitY(x, z); if (y !== null) return y; }
        if (this._pitGrid) { const y = this._portalPitY(x, z); if (y !== null) return y; }
        if (this.core.isLand(x, z)) return 0;
        const w = this._coreWater(x, z);
        return w >= 0 ? this.core.water.y[w] : this.waterY;
      }
      const g = this.groundAt(x, z);
      if (g.water === null) return g.y;
      if (this.core && this.core.lgrd) return g.water; // core の LAND は桟橋を含む
      const t = this._tile(x, z);
      if (t.tile) { const ix = this._areas(t.tile); if (this._inAreas(t.tile, ix.pier, ix, x, z) >= 0) return 0; }
      return g.water;
    }

    // ===== 片（core PRT）の属性 =====
    // 外壁の材質（今ある v1 の名前。plan.facades の M1 の表）: 様式（core PRT）→ 候補、tallMinH m 以上の片は tall、gid のハッシュで選ぶ。
    //   core だけで決める（タイルの CPAT の色・cls は使わない）= 近景・LOD・遠景で同じ材質（色は柱の color に残す。R2 のファサードが使う）
    _facadeMat(piece) {
      const P = this.core.pieces, T = this.plan.facades || {};
      const styleName = (this.meta && this.meta.enums && this.meta.enums.style && this.meta.enums.style[P.style[piece]]) || 'generic';
      let list = (T.byStyle && T.byStyle[styleName]) || T.default || ['concrete_win'];
      if (T.tallMinH && P.y1f[piece] >= T.tallMinH && T.tall && !(T.keepStyle || []).includes(styleName)) list = T.tall;
      const h = hash(this.seed, 31, P.gid[piece], 0);
      let mat = list[h % list.length];
      // 低い片（glassMinH m 未満か glassMaxFloors 階以下）はガラスの塔の外壁にしない（12 × 8 m の窓割りの黒い鏡の箱になる:
      //   タイムズスクエアの軍の募集所 5.5 m）→ small の候補
      if (mat === 'glass_tower' && T.small && T.small.length && ((T.glassMinH && P.y1f[piece] < T.glassMinH) || (T.glassMaxFloors && P.floors[piece] > 0 && P.floors[piece] <= T.glassMaxFloors))) mat = T.small[h % T.small.length];
      return mat;
    }
    _storey(piece, mat) {
      const P = this.core.pieces, base = P.y0[piece] > 1 ? P.y0[piece] : 0;
      const f = P.floors[piece];
      const st = this.M.storey || {};
      if (f > 0) { const s = (P.y1f[piece] - base) / f; if (s >= 2.6 && s <= 6) return Math.round(s * 100) / 100; }
      return st[mat] || st[mat.replace('_win', '')] || 3.6;
    }
    // 片の共通の属性（タイルの CPAT があれば足す）
    _pieceProps(piece, tile) {
      const P = this.core.pieces;
      const ai = tile ? NycData.pieceAttr(tile, piece) : -1;
      const A = ai >= 0 ? tile.pieceAttrs : null;
      const color = A ? A.facadeColor[ai] : 0;
      const mat = this._facadeMat(piece);
      const o = {
        mat, mt: this.M.roof || 'gravel_roof', cat: 'exterior', f: F.WALK, gid: P.gid[piece], piece, style: P.style[piece], floors: P.floors[piece],
        storey: this._storey(piece, mat), base: P.y0[piece] > 1 ? P.y0[piece] : 0, color, roofColor: A ? A.roofColor[ai] : 0,
        cls: A ? A.cls[ai] : 0, roofShape: A ? A.roofShape[ai] : 0, facadeMat: A ? A.facadeMat[ai] : 0, roofMat: A ? A.roofMat[ai] : 0,
        roofHeight: A ? A.roofHeight[ai] : 0, pflags: P.flags[piece]
      };
      return o;
    }
    // 片 piece の E 外形をそのまま 1 つの柱に（入れない ENTB・genEnterable の null の代わり。切らない = 持ち主のチャンクだけが出す）
    _piecePrism(piece, tile) {
      const P = this.core.pieces;
      const r0 = P.ringStart[piece], r1 = P.ringStart[piece + 1];
      const ring = P.xz.slice(P.vertStart[r0] * 2, P.vertStart[r0 + 1] * 2);
      const holes = [];
      for (let k = r0 + 1; k < r1; k++) holes.push(P.xz.slice(P.vertStart[k] * 2, P.vertStart[k + 1] * 2));
      const p = Object.assign({ ring, holes, clip: null, y0: P.y0[piece], y1: P.y1f[piece], flags: 0, envelope: true }, this._pieceProps(piece, tile));
      return lazyTri(p);
    }
    // 入れる建物にするか（gid ごとに決まる。ホットゾーンの中は chance.hot、noEnter のゾーンは入れない）
    _entOn(r) {
      if (!this._entOnC) this._entOnC = new Int8Array(this.core.entb.count).fill(-1);
      let v = this._entOnC[r];
      if (v >= 0) return v === 1;
      const EN = this.core.entb, P = this.core.pieces, piece = EN.piece[r];
      const x = (EN.rect[r * 4] + EN.rect[r * 4 + 2]) / 2, z = (EN.rect[r * 4 + 1] + EN.rect[r * 4 + 3]) / 2;
      const hz = this._hotAt(x, z), en = this.plan.enterable || {}, ch = en.chance || {};
      let p = hz >= 0 ? (ch.hot != null ? ch.hot : 0.6) : (ch.default != null ? ch.default : 0.35);
      if (hz >= 0 && this.hotZones[hz].noEnter) p = 0;
      if (this._sup[piece]) p = 0;
      v = u01(hash(this.seed, 41, P.gid[piece], piece)) < p ? 1 : 0;
      if (v && this._entDoor(r) === false) v = 0; // どの面にも開いた扉の場所が無い（中庭の奥・隣の建物に囲まれた）→ 入れない
      this._entOnC[r] = v;
      return v === 1;
    }

    // ===== ゲームの層（core だけ。chunkFull / chunkCoarse / lootSpawns が使う。LRU 16 チャンク）=====
    //   { boxes, ramps, ladders, props, decals, loot, buildings, prisms, entDone: Set(ENTB の行で genEnterable が作ったもの) }
    _game(cx, cz) {
      const ci = cz * this.ncx + cx;
      let g = this._gameCache.get(ci);
      if (g) { this._gameCache.delete(ci); this._gameCache.set(ci, g); return g; }
      g = this._buildGame(cx, cz);
      this._gameCache.set(ci, g);
      if (this._gameCache.size > 16) this._gameCache.delete(this._gameCache.keys().next().value);
      return g;
    }
    _buildGame(cx, cz) {
      const ci = cz * this.ncx + cx, key = this.chunkKey(cx, cz), cr = this.chunkRect(cx, cz);
      const E = new LIB.Emitter(true);
      const g = { prisms: [], entOn: [], E, loot: [] };
      const C = this.core;
      if (!C) return g;
      const B = this.B, M = this.M, lc = this.plan.loot || {}, EN = C.entb, P = C.pieces;
      // 静的な物（移したランドマーク・空母。部品の中心がこのチャンクの物。v1 の _assemble と同じく先に = 落ちている物の番号も先）
      const st = this._sb.get(ci);
      if (st) for (const k of ['boxes', 'ramps', 'ladders', 'props', 'decals', 'landmarks', 'buildings', 'loot']) for (const it of st[k]) E[k].push(it);
      g.st = st || null;
      // 消した建物の残り（ランドマークの矩形の外の部分。E 外形をこのチャンクで切った柱）
      for (const i of this._remChunk.get(ci) || []) {
        const pr = this._remPrism(this._remnants[i], cr, ci);
        if (pr) g.prisms.push(pr);
      }
      // 入れる建物（ENTB → genEnterable）
      const es = this._entChunk;
      for (let k = es.start[ci]; k < es.start[ci + 1]; k++) {
        const r = es.items[k], piece = EN.piece[r];
        if (this._sup[piece]) continue;
        let done = null;
        const nLad = E.ladders.length;
        if (this._entOn(r)) {
          const x0 = EN.rect[r * 4], z0 = EN.rect[r * 4 + 1], x1 = EN.rect[r * 4 + 2], z1 = EN.rect[r * 4 + 3];
          const hot = this._hotAt((x0 + x1) / 2, (z0 + z1) / 2) >= 0;
          const sd = hash(this.seed, 13, P.gid[piece], piece);
          const mat = this._facadeMat(piece);
          const shellKey = mat.replace('_win', '').replace('concrete', 'concrete');
          const floors = M.floors || ['concrete'];
          const dfix = this._entDoor(r); // 扉の前がふさがっていれば開いた面・位置へ（null = データの front のまま）
          done = LIB.genEnterable(E, {
            id: 'E' + P.gid[piece] + '_' + piece, kind: 'walkup', x0, z0, x1, z1, front: dfix ? dfix.front : FRONT[EN.front[r]], exp: EN.exp[r],
            mainDoor: dfix ? dfix.mainDoor : null,
            by: this.curbH, ground: this.curbH, floors: EN.floors[r], fh: EN.fh[r], seed: sd,
            shell: (M.shell && M.shell[shellKey]) || 'concrete', floorMat: floors[sd % floors.length], intMat: M.interior, roofMat: M.roof, stairMat: M.stair,
            lootTable: hot ? 'hot' : 'interior', lootCount: hot ? lc.hotPerFloor : lc.perFloor, roofTable: 'roof', roofChance: lc.roofChance,
            tank: u01(hash(this.seed, 14, P.gid[piece], 0)) < ((this.plan.enterable && this.plan.enterable.tank) || 0.3), doorW: 2, doorH: 2.4
          }, B);
        }
        // 非常階段の梯子は登る側（法線の 0.9 m 先）がデータの片・残りの中なら外す（扉と同じ。隣の建物に面した梯子は登れない）
        if (done) for (let k = E.ladders.length - 1; k >= nLad; k--) { const l = E.ladders[k]; if (this._solidAt(l.x + l.nx * 0.9, l.z + l.nz * 0.9, l.y0)) E.ladders.splice(k, 1); }
        if (done) g.entOn.push(r);
        else if (this._entOn(r)) { // genEnterable が null（起きないはず）: 片の E 外形をまるごと（持ち主のチャンクだけ）
          const pr = this._piecePrism(piece, null);
          for (const sp of this._spans(piece, pr.y0, pr.y1)) { const q = lazyTri(Object.assign({}, pr, { y0: sp[0], y1: sp[1] })); g.prisms.push(q); }
        }
      }
      // 入れない ENTB の片: E 外形をこのチャンクで切った柱（どのチャンクも自分の分だけ = 隣のチャンクを読まなくても壁がある。
      //   タイルの CPRS に ENTB の片は無く、長方形の外の残り（flags 32）は _detail が飛ばす）
      for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) {
        const p = P.chunkPieces[k], r = this._entOf[p];
        if (r < 0 || this._sup[p] || this._entOn(r)) continue;
        const pr = this._clipPiece(p, cr, ci, true);
        if (!pr) continue;
        for (const sp of this._spans(p, pr.y0, pr.y1)) g.prisms.push(lazyTri(Object.assign({}, pr, { y0: sp[0], y1: sp[1] })));
      }
      // 橋・高架の床（DECK: 平らな上面の柱。縁の低い壁）
      const D = this._decks, dc = this._deckChunk, dk = this.plan.decks || {};
      const barH = dk.barrierH != null ? dk.barrierH : 1.1, barT = dk.barrierT != null ? dk.barrierT : 0.3;
      // 片はこのチャンクの矩形で切る（切り口の辺は clip = 壁を描かない・押し出さない）。上面の平面と厚さはそのまま
      const cutRing = (xz, a, e, A, Bp, Cc) => {
        let inside = true;
        for (let v = a; v < e && inside; v++) { const x = xz[v * 2], z = xz[v * 2 + 1]; if (x < cr[0] || x > cr[2] || z < cr[1] || z > cr[3]) inside = false; }
        const q = inside ? Array.from(xz.subarray(a * 2, e * 2)) : clipRing(xz, a, e, cr);
        const n = q.length >> 1;
        if (n < 3 || Math.abs(areaOf(q, n)) < 0.02) return null;
        let pmin = Infinity, pmax = -Infinity;
        for (let v = 0; v < n; v++) { const y = Cc + A * q[v * 2] + Bp * q[v * 2 + 1]; if (y < pmin) pmin = y; if (y > pmax) pmax = y; }
        return { ring: new Float32Array(q), clip: inside ? null : clipBitsFor([q], cr), inside, pmin, pmax };
      };
      for (let k = dc.start[ci]; k < dc.start[ci + 1]; k++) {
        const i = dc.items[k], a = D.vertStart[i], e = D.vertStart[i + 1];
        let y0 = Infinity, y1 = -Infinity;
        for (let v = a; v < e; v++) { y0 = Math.min(y0, D.y[v]); y1 = Math.max(y1, D.y[v]); }
        const A = D.plane[i * 3], Bp = D.plane[i * 3 + 1], Cc = D.plane[i * 3 + 2];
        const ef = D.eflag ? D.eflag[i] : 0; // NC3 の el・ホーム・口の床（_initEl）: 厚さ・材質は片ごと、2 = 描かない（口の上の道を支える屋根）
        const t = ef && D.tk[i] === D.tk[i] ? D.tk[i] : (D.thickness || 1.2);
        const cut = cutRing(D.xz, a, e, A, Bp, Cc);
        if (cut) {
          const cy0 = cut.inside ? y0 : cut.pmin, cy1 = cut.inside ? y1 : cut.pmax;
          const dp = lazyTri({ ring: cut.ring, holes: [], clip: cut.clip, top: [Cc, A, Bp], t, y0: cy0 - t, y1: cy1, f: F.WALK, mat: ef ? this._elMats[D.emat[i]] : (dk.mat || 'asphalt_city'), cat: 'road', deck: D.chain[i], seq: D.seq[i], cls: D.cls[i], kindDeck: D.kind[i] });
          if (ef) { dp.el = ef; if (ef & 2) dp.hide = 1; }
          for (const q of this._cutRects(dp, this._deckCut, cr)) g.prisms.push(q);
          // 抜いた矩形（cutDecks）で終わる床の端に壁（縁の壁と同じ高さ・厚さ。矩形の外側 barrierT m の帯 × 床の片）: パーク街高架橋の車が
          //   グランド・セントラルの外壁にそのまま突っ込まない（plan.decks.cutEndBarrier: false で外す）
          if (barH > 0 && dk.cutEndBarrier !== false && D.kind[i] !== 2 && y0 > (dk.barrierMinY != null ? dk.barrierMinY : 2)) {
            let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
            for (let v = a; v < e; v++) { const x = D.xz[v * 2], z = D.xz[v * 2 + 1]; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
            for (const R of this._deckCut) {
              if (!(R[0] < bx1 && R[2] > bx0 && R[1] < bz1 && R[3] > bz0)) continue;
              const inR = clipRing(D.xz, a, e, R);
              if ((inR.length >> 1) < 3 || Math.abs(areaOf(inR, inR.length >> 1)) < 1) continue; // 矩形に入っていない（縁に沿うだけ）
              for (const S of [[R[0] - barT, R[1], R[0], R[3]], [R[2], R[1], R[2] + barT, R[3]], [R[0], R[1] - barT, R[2], R[1]], [R[0], R[3], R[2], R[3] + barT]]) {
                const sr = [Math.max(S[0], cr[0]), Math.max(S[1], cr[1]), Math.min(S[2], cr[2]), Math.min(S[3], cr[3])];
                if (sr[0] >= sr[2] || sr[1] >= sr[3]) continue;
                const q = clipRing(D.xz, a, e, sr), n = q.length >> 1;
                if (n < 3 || Math.abs(areaOf(q, n)) < 0.05) continue;
                let pmin = Infinity, pmax = -Infinity;
                for (let v = 0; v < n; v++) { const y = Cc + A * q[v * 2] + Bp * q[v * 2 + 1]; pmin = Math.min(pmin, y); pmax = Math.max(pmax, y); }
                g.prisms.push(lazyTri({ ring: new Float32Array(q), holes: [], clip: clipBitsFor([q], cr), top: [Cc + barH, A, Bp], t: barH, y0: pmin, y1: pmax + barH, f: 0, mat: ef && this.elCfg ? this.elCfg.mat : (dk.barrierMat || 'concrete'), cat: 'barrier', deck: D.chain[i], cutEnd: 1 }));
              }
            }
          }
        }
        // 縁の壁（_deckBarriers: 4 角の片の左右の辺・割った三角の外側の辺のうち、隣の床に接していない辺）
        if (barH > 0 && D.kind[i] !== 2 && y0 > (dk.barrierMinY != null ? dk.barrierMinY : 2)) {
          for (const [ax, az, bx, bz, nx, nz] of this._deckBarriers(i)) {
            const br = new Float32Array([ax, az, bx, bz, bx + nx * barT, bz + nz * barT, ax + nx * barT, az + nz * barT]);
            const bc = cutRing(br, 0, 4, A, Bp, Cc);
            if (!bc) continue;
            const bp = lazyTri({ ring: bc.ring, holes: [], clip: bc.clip, top: [Cc + barH, A, Bp], t: barH, y0: bc.inside ? y0 : bc.pmin, y1: (bc.inside ? y1 : bc.pmax) + barH, f: 0, mat: ef && this.elCfg ? this.elCfg.mat : (dk.barrierMat || 'concrete'), cat: 'barrier', deck: D.chain[i] });
            for (const q of this._cutRects(bp, this._deckCut, cr)) g.prisms.push(q);
          }
        }
      }
      if (this._elCols || this._portals.length) this._elEmit(g, E, ci, cr); // NC3: el の柱・梁、口の壁・天井
      // ヘリパッドの印（地上の nyc.json heliports と屋上の HPAD）
      //   パッドの外の置き場所（spawn [x, z, 向き, y]: 空母のヘリは 86 番桟橋）には H の印だけ、パッドには描かない（v1 と同じ）。屋上の HPAD は下の行
      for (const h of this.helipads) {
        if (h.hpad) continue; // core HPAD のパッド（地上・屋上）は下の行が描く
        if (Array.isArray(h.spawn) && h.spawn.length > 3) { if (this._ci(h.spawn[0], h.spawn[1]) === ci) E.decal({ type: 'helipad', x: h.spawn[0], z: h.spawn[1], w: 14, d: 14, rot: 0, y: h.spawn[3] }); continue; }
        if (this._ci(h.x, h.z) === ci) E.decal({ type: 'helipad', x: r2(h.x), z: r2(h.z), w: (h.r || 9) * 2, d: (h.r || 9) * 2, rot: 0, y: h.y || 0 });
      }
      for (const h of this._pads) if (this._ci(h.x, h.z) === ci) E.decal({ type: 'helipad', x: r2(h.x), z: r2(h.z), w: r2(h.r * 2), d: r2(h.r * 2), rot: 0, y: h.y, roof: h.roof });
      // 歩道の落ちている物（SPWN の点から gid に依らないハッシュで。ゾーンの中は hotPerSpawn）
      const SP = C.spawns, sc = this._spawnChunk;
      const per = lc.streetPerSpawn != null ? lc.streetPerSpawn : 0.02, hotPer = lc.hotPerSpawn != null ? lc.hotPerSpawn : 0.08, off = lc.spawnOffset != null ? lc.spawnOffset : 1;
      for (let k = sc.start[ci]; k < sc.start[ci + 1]; k++) {
        const i = sc.items[k];
        if (this._spawnBad && this._spawnBad[i]) continue; // NC3: 柱・口・低い el の床の下
        const zone = SP.zone[i], hot = zone !== 255;
        const h = hash(this.seed, 92, i, 0);
        if (u01(h) >= (hot ? hotPer : per)) continue;
        const a = (h & 1023) / 1024 * Math.PI * 2;
        E.lootAt(SP.xz[i * 2] + Math.cos(a) * off, this.curbH, SP.xz[i * 2 + 1] + Math.sin(a) * off, hot ? 'hot' : 'street');
      }
      // 物が片の中（入れる建物の屋上の上に塔の片が重なる所。GEN 5 から）なら置かない
      g.loot = E.loot.filter((l) => !this._pieceIn(l.x, l.z, l.y + 0.3, l.y + 0.35, true)).map((l, n) => ({ id: key + '_' + n, x: l.x, y: l.y, z: l.z, table: l.table }));
      return g;
    }

    // 入れる建物（ENTB の行 r）の正面の扉の前がふさがっているか見て、ふさがっていれば
    //   開いた面と位置 { front, mainDoor }（genEnterable の P.front / P.mainDoor）を返す（行ごとに覚える）。null = データの front のまま（扉は genEnterable の
    //   乱数の位置 = 真ん中 ± 2 m。その範囲が全部開いていれば何も変えない = ほとんどの建物）。見るのは扉の外 0.9〜2.1 m（扉の点は 1.5 m）・
    //   扉の幅 + 左右 0.2 m（E 外形は本当の形より少し大きいので壁のすぐ外は見ない）。ふさぐのは片の E 外形（自分の片の長方形の外の
    //   残り = 扉の前の柱になる・隣の片。y0 が扉の高さ + 1.7 m より上の張り出しは除く）・消した建物の残り・水。順番: データの front → exp の
    //   開いた面（n e s w）→ ほかの面、面の中は真ん中に近い順。どの面もふさがっていれば false（_entOn がその建物を入れないことにする。
    //   core だけで決まる = サーバーも同じ）。
    //   以前は 470 棟のうち 35 棟の扉が自分の残りか隣の建物の中で、扉から入れなかった（tools/city-test-nyc.js 'enterable doors'）
    _entDoor(r) {
      const C = this._entDoorC || (this._entDoorC = new Map());
      let v = C.get(r);
      if (v === undefined) { v = this._entDoorFind(r); C.set(r, v); }
      return v;
    }
    _entDoorFind(r) {
      const EN = this.core.entb, B = this.B || {}, dw = 2, y = this.curbH;
      const x0 = EN.rect[r * 4], z0 = EN.rect[r * 4 + 1], x1 = EN.rect[r * 4 + 2], z1 = EN.rect[r * 4 + 3];
      const clearAt = (fr, s0, s1) => {
        for (let u = s0 - 0.2; u <= s1 + 0.2 + 1e-6; u += 0.6) for (let v = -0.9; v >= -2.11; v -= 0.6) if (this._solidAt(fr.x(u, v), fr.z(u, v), y)) return false;
        return this.isLand(fr.x((s0 + s1) / 2, -1.5), fr.z((s0 + s1) / 2, -1.5));
      };
      const f0 = FRONT[EN.front[r]], fr0 = new LIB.Frame(x0, z0, x1, z1, f0), mc = Math.floor(fr0.W / 2) - Math.floor(dw / 2);
      if (clearAt(fr0, mc - 2, mc + 2 + dw)) return null;
      const exp = EN.exp[r], bit = LIB.SIDE_BIT || { n: 1, s: 2, w: 4, e: 8 }, order = [f0];
      for (const f of ['n', 'e', 's', 'w']) if (f !== f0 && (exp & bit[f])) order.push(f);
      for (const f of ['n', 'e', 's', 'w']) if (order.indexOf(f) < 0) order.push(f);
      for (const f of order) {
        const fr = f === f0 ? fr0 : new LIB.Frame(x0, z0, x1, z1, f);
        if (!LIB.canEnter(fr.W, fr.D, EN.fh[r], B)) continue;
        const c = Math.floor(fr.W / 2) - Math.floor(dw / 2);
        for (let d = 0; d <= fr.W / 2; d++) for (const m of d ? [c - d, c + d] : [c]) {
          if (m < 1 || m > fr.W - 1 - dw) continue;
          if (clearAt(fr, m, m + dw)) return { front: f, mainDoor: m };
        }
      }
      return false;
    }
    // 点 (x, z) の高さ y〜y + 1.7 m に固い物があるか（core の片の E 外形・消した建物の残り。消した片は見ない。入れる建物の片の外形の
    //   長方形の外は残りの柱なので見る）
    _solidAt(x, z, y) {
      const P = this.core && this.core.pieces;
      if (P) {
        const ci = this._ci(x, z);
        if (ci >= 0) for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) {
          const p = P.chunkPieces[k];
          if (this._sup[p] || x < P.bbox[p * 4] || x > P.bbox[p * 4 + 2] || z < P.bbox[p * 4 + 1] || z > P.bbox[p * 4 + 3]) continue;
          if (P.y0[p] > y + 1.7 || P.y1f[p] < y + 0.3) continue;
          if (NycData.pointIn(P, p, x, z)) return true;
        }
      }
      for (const rm of this._remnants) {
        if (x < rm.bb[0] || x > rm.bb[2] || z < rm.bb[1] || z > rm.bb[3] || rm.y0 > y + 1.7 || rm.y1 < y + 0.3) continue;
        if (inRing(rm.ring, x, z)) return true;
      }
      return false;
    }
    // 床の片 i の縁の壁を立てる辺 [[ax, az, bx, bz, nx, nz（内向き）], …]（ゲームの層 _buildGame と線路の横のずらし _railShift が同じ物を使う）。
    //   4 角の片の左右の辺（0→3 の左、1→2 の右）、割った三角は外側の辺。縁の外か壁の所がほかの鎖の床（隣の車道・合流する斜路・遊歩道。データの幅は
    //   歩道込みなので並んだ車道の床は重なる）で高さが barrierJoin m 以内なら壁を立てない（隣の車道の上に壁が立ち、ブルックリン橋の取り付けで車が
    //   ぶつかった）。辺の 1/4・1/2・3/4 の点（外 barrierProbe m・壁の真ん中）のうち 2 つ以上。壁を立てる床か（kind・高さ）は呼ぶ側が見る
    _deckBarriers(i) {
      const C = this._deckBarC || (this._deckBarC = new Map());
      let r = C.get(i);
      if (!r) { r = this._deckBarriers0(i); C.set(i, r); }
      return r;
    }
    _deckBarriers0(i) {
      const D = this._decks, dk = this.plan.decks || {};
      const barT = dk.barrierT != null ? dk.barrierT : 0.3, barH = dk.barrierH != null ? dk.barrierH : 1.1, bJoin = dk.barrierJoin != null ? dk.barrierJoin : 0.8, bProbe = dk.barrierProbe != null ? dk.barrierProbe : 0.6;
      const a = D.vertStart[i], e = D.vertStart[i + 1], A = D.plane[i * 3], Bp = D.plane[i * 3 + 1], Cc = D.plane[i * 3 + 2];
      const ring = D.xz.subarray(a * 2, e * 2), n = e - a, edges = [], out = [];
      const el = !!(D.eflag && (D.eflag[i] & 1)), elJoin = dk.elBarrierJoin != null ? dk.elBarrierJoin : 3;
      if (D.kind[i] === 0 && n === 4) edges.push([1, 2], [3, 0]); // 4 角 = [左の始まり, 右の始まり, 右の終わり, 左の終わり]
      else if (D.kind[i] === 1 && n === 3) edges.push(this._deckFirstTri(i) ? [1, 2] : [2, 0]); // 割った三角 (0, 1, 2) は右、(0, 2, 3) は左
      let mx = 0, mz = 0;
      for (let v = 0; v < n; v++) { mx += ring[v * 2] / n; mz += ring[v * 2 + 1] / n; }
      for (const [p, q] of edges) {
        const ax = ring[p * 2], az = ring[p * 2 + 1], bx = ring[q * 2], bz = ring[q * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.2) continue;
        let nx = -(bz - az) / L, nz = (bx - ax) / L;
        if ((mx - ax) * nx + (mz - az) * nz < 0) { nx = -nx; nz = -nz; } // 内向き
        if (bJoin > 0) {
          let cov = 0;
          for (const u of [0.25, 0.5, 0.75]) {
            const ex = ax + (bx - ax) * u, ez = az + (bz - az) * u;
            const px = ex - nx * bProbe, pz = ez - nz * bProbe, wx = ex + nx * barT / 2, wz = ez + nz * barT / 2;
            if (this._deckCovers(px, pz, Cc + A * px + Bp * pz, bJoin, D.chain[i]) || this._deckCovers(wx, wz, Cc + A * wx + Bp * wz, bJoin, D.chain[i])) cov++;
            else if (el && this._platCovers(wx, wz, Cc + A * wx + Bp * wz)) cov++; // el の床の縁が駅のホームの下（ホームの縁に壁を立てない = 線路の横に壁が来ない）
            else if (el && this._pieceInSpan(px, pz, Cc + A * px + Bp * pz + 0.2, Cc + A * px + Bp * pz + 1.5)) cov += 2; // 建物の壁に沿って細くした el の床（辺の 1 点でも）: 壁が縁の壁の代わり（縁の壁が線路の砂利の帯にかかって線路が消えた。カルバー線）
            else if (el && (this._deckCovers(px, pz, Cc + A * px + Bp * pz, elJoin, D.chain[i], 1) || this._deckCovers(wx, wz, Cc + A * wx + Bp * wz, elJoin, D.chain[i], 1))) cov++; // 並んで上り下りする el の床どうし（高さの差 elJoin m まで）: 間に壁を立てない（隣の線路の砂利の帯にかかって線路が消えた）
          }
          if (cov >= 2) continue;
        }
        if (!el && this._railNear((ax + bx) / 2 + nx * barT / 2, (az + bz) / 2 + nz * barT / 2, Cc + A * (ax + bx) / 2 + Bp * (az + bz) / 2, L / 2 + 1.9)) { // データの床の縁を el の線路が通る（橋の車道の横の地下鉄: マンハッタン橋）: 線路の側に壁を立てない
          let near = 0;
          for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) { const ex = ax + (bx - ax) * u + nx * barT / 2, ez = az + (bz - az) * u + nz * barT / 2; if (this._railNear(ex, ez, Cc + A * ex + Bp * ez, 1.9)) near++; }
          if (near >= 1) continue;
        }
        if (!el && this._elCols && this._railNear((ax + bx) / 2, (az + bz) / 2, Cc + A * (ax + bx) / 2 + Bp * (az + bz) / 2, L / 2 + 6, Math.abs(A * (bx - ax) + Bp * (bz - az)) / 2 + 4)) {
          // データの床の縁の壁が el の床を通る所（壁の下端から上 barH + el の厚さまでに el の床の上面がある）は切る（クイーンズボロ・プラザの下の段の
          //   歩道の坂の壁が el の線路を横切って線路を切っていた。NC3 の直し 6）
          const ec = this.elCfg || {}, hi = barH + (ec.thick || 1.4), st = Math.max(1, Math.ceil(L / 0.5)), cut = new Uint8Array(st + 1);
          let any = false;
          for (let k = 0; k <= st; k++) {
            const u = k / st, ex = ax + (bx - ax) * u + nx * barT / 2, ez = az + (bz - az) * u + nz * barT / 2, ey = Cc + A * ex + Bp * ez;
            if (this._deckCovers(ex, ez, ey + (hi - 0.3) / 2, (hi + 0.3) / 2, -1, 1)) { cut[k] = 1; any = true; }
          }
          if (any) {
            for (let k = 0; k <= st;) {
              if (cut[k]) { k++; continue; }
              let k1 = k;
              while (k1 < st && !cut[k1 + 1]) k1++;
              const u0 = k ? (k - 0.5) / st : 0, u1 = k1 < st ? (k1 + 0.5) / st : 1;
              if ((u1 - u0) * L >= 0.2) out.push([ax + (bx - ax) * u0, az + (bz - az) * u0, ax + (bx - ax) * u1, az + (bz - az) * u1, nx, nz]);
              k = k1 + 1;
            }
            this._barCut = (this._barCut || 0) + 1;
            continue;
          }
        }
        out.push([ax, az, bx, bz, nx, nz]);
      }
      return out;
    }
    // core RLEL の線（レールの高さ y ± 1.5 m）が (x, z) から r m 以内を通るか（16 m の升の索引は初めて要るときに）
    _railNear(x, z, y, r, dy) {
      const RL = this.core.rlel, Ls = RL && RL.lines;
      if (!Ls || !Ls.count) return false;
      let G = this._rlG;
      if (!G) {
        const C = 16, W = Math.ceil((this.maxX - this.minX) / C) + 1, map = new Map();
        for (let i = 0; i < Ls.count; i++) for (let v = Ls.vertStart[i]; v + 1 < Ls.vertStart[i + 1]; v++) {
          const ax = Ls.xz[v * 2], az = Ls.xz[v * 2 + 1], bx = Ls.xz[v * 2 + 2], bz = Ls.xz[v * 2 + 3];
          for (let j = Math.floor((Math.min(az, bz) - 2 - this.minZ) / C); j <= Math.floor((Math.max(az, bz) + 2 - this.minZ) / C); j++)
            for (let k = Math.floor((Math.min(ax, bx) - 2 - this.minX) / C); k <= Math.floor((Math.max(ax, bx) + 2 - this.minX) / C); k++) { const key = k + j * W; let a = map.get(key); if (!a) map.set(key, a = []); a.push(v); }
        }
        G = this._rlG = { C, W, map };
      }
      const r2 = r * r;
      for (let j = Math.floor((z - r - this.minZ) / G.C); j <= Math.floor((z + r - this.minZ) / G.C); j++)
        for (let k = Math.floor((x - r - this.minX) / G.C); k <= Math.floor((x + r - this.minX) / G.C); k++) {
          const a = G.map.get(k + j * G.W);
          if (a) for (const v of a) {
            const ax = Ls.xz[v * 2], az = Ls.xz[v * 2 + 1], dx = Ls.xz[v * 2 + 2] - ax, dz = Ls.xz[v * 2 + 3] - az, L2 = dx * dx + dz * dz;
            let u = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const qx = ax + dx * u - x, qz = az + dz * u - z;
            if (qx * qx + qz * qz > r2) continue;
            if (Math.abs(Ls.y[v] + (Ls.y[v + 1] - Ls.y[v]) * u - y) <= (dy || 1.5)) return true;
          }
        }
      return false;
    }
    // 割った 4 角の 1 つ目の三角形か（次の片が同じ 4 角の 2 つ目: 同じ鎖・kind 1・頂点 0 と 2 を共有）
    _deckFirstTri(i) {
      const D = this._decks;
      if (i + 1 >= D.count || D.kind[i + 1] !== 1 || D.chain[i + 1] !== D.chain[i]) return false;
      const a = D.vertStart[i], b = D.vertStart[i + 1];
      return D.xz[a * 2] === D.xz[b * 2] && D.xz[a * 2 + 1] === D.xz[b * 2 + 1] && D.xz[(a + 2) * 2] === D.xz[(b + 1) * 2] && D.xz[(a + 2) * 2 + 1] === D.xz[(b + 1) * 2 + 1];
    }

    // ===== 高架（el）・トンネルの口・高架の駅のホーム（nyc-complete NC3。core RLEL だけ = サーバーとクライアントで同じ。数値は plan.rails.el / .portal）=====
    //   el: RLEL の線（地上の線路とトンネルの坂の、レールの上面 ≥ minY m の所）ごとに幅 width m・厚さ thick m の床の片（4 角 kind 0 = 縁の壁あり。
    //   折れの両側は kind 2 の三角 = 壁なし）を _decks の後ろに足す（片の当たり・サーバーの段の箱・支え・HeliCollider・遠景・線路の描画は今までの
    //   床と同じ道を通る。D.eflag 1）。足さない所: データの床（橋・高架の車道）がレールの高さ ± deckTol m にある（大きな橋の線路はその床の上）・
    //   建物の片の中（片の下端がレール + solidClear m より下で、上端が床の下面より上）。床の下面が地面から colMinH m より低い片は地面の下まで（下に線路・道が通れない低さだけ。それより高ければ柱）
    //   埋める（坂の盛り土。柱なし）。
    //   柱: 線に沿って colStep m ごとに colW m 角の箱（地面から床の下面まで）。真下から横へ colLat m ずつ colReach m まで、地上の車道（RDS の
    //   縁石 + colRoad m）・建物（E ⊕ dev + colBld m）・入れる建物（+ colEnt m）・データの床・自分より低いほかの線（colTrack m）・ランドマーク・
    //   ヘリポート・トンネルの口・水を避けた最初の所。真下でなければ梁（柱の上から線の真下まで、厚さ beamH m）。colMerge m 以内に同じ高さの柱が
    //   あればそれを使う。見つからなければ柱なし（床は次の柱まで渡る）。
    //   口（RPRT）: 口から中へ ramp m の掘割（床が地面から −depth m へ下がる。両側の壁は地面 + rail m の手すりの高さ）と stub m の暗いトンネル
    //   （床 −depth、天井、奥の壁）。groundAt の穴（pits の obb）で地面の壁を開け、トンネルの上の道は隠れた屋根の片（上面 0、hide）が支える。
    //   掘割の上の台・路面の印・小物・地面のメッシュは抜く（_cuts）。同じ向きで並ぶ口はまとめる。口のまわりが水・ランドマーク・ヘリポート・
    //   入れる建物・ほかの口、掘割の所が地上の建物にかかる口は作らない（elStats.portalsSkipped）
    _initEl() {
      const C = this.core, RL = C.rlel, P = C.pieces, EN = C.entb, Rd = C.roads;
      const { ec, pc } = this._elCfgs();
      const D0 = this._decks, n0 = D0.count;
      const st = this.elStats = { lines: RL.lines.count, km: 0, deckKm: 0, roadDeckKm: 0, solidKm: 0, lowKm: 0, pieces: 0, columns: 0, beams: 0, stations: 0,
        noColumn: 0, shifted: 0, bents: 0, roofCols: 0, narrowed: 0, embankKm: 0, edgeWalls: 0, maxSpan: 0, maxSpanAt: null, spans: [], platforms: 0, portals: RL.portals.count, portalsBuilt: 0, portalsMerged: 0, portalsSkipped: {} };
      const add = []; // { v: [[x, z, y] …], pl: [A, B, C], kind, chain, seq, cls, flag, tk, mat }
      const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
      const tm = st.ms = {}, t0 = now();
      let chain = 0;
      for (let i = 0; i < n0; i++) if (D0.chain[i] >= chain) chain = D0.chain[i] + 1;
      this._elChain0 = chain; // これ以降の鎖の番号は el の床・口の床
      const planeOf = (p, q, r) => {
        const ux = q[0] - p[0], uy = q[2] - p[2], uz = q[1] - p[1], vx = r[0] - p[0], vy = r[2] - p[2], vz = r[1] - p[1];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(ny) < 1e-9) return null;
        const A = -nx / ny, B = -nz / ny;
        return [A, B, p[2] - A * p[0] - B * p[1]];
      };
      const addPiece = (v, o) => { const pl = planeOf(v[0], v[1], v[2]); if (pl) add.push(Object.assign({ v, pl, seq: 0, cls: 0, chain: chain }, o)); return !!pl; };
      const mats = this._elMats = [];
      const matId = (m) => { let k = mats.indexOf(m); if (k < 0) { k = mats.length; mats.push(m); } return k; };

      // ---- トンネルの口（先に: 柱を口の所に立てない）
      const PR = RL.portals, clusters = [];
      if (pc.enabled !== false) for (let i = 0; i < PR.count; i++) {
        const x = PR.xz[i * 2], z = PR.xz[i * 2 + 1], yaw = PR.yaw[i], w = Math.max(PR.width[i], pc.minWidth);
        let c = null;
        for (const q of clusters) {
          let da = Math.abs(yaw - q.yaw) % (Math.PI * 2);
          if (da > Math.PI) da = Math.PI * 2 - da;
          if (da > pc.mergeDeg * Math.PI / 180) continue;
          const s = (x - q.x) * q.ux + (z - q.z) * q.uz, l = (x - q.x) * q.vx + (z - q.z) * q.vz;
          if (Math.abs(s) > pc.mergeAlong || l - w / 2 > q.l1 + pc.mergeGap || l + w / 2 < q.l0 - pc.mergeGap) continue;
          c = q;
          q.l0 = Math.min(q.l0, l - w / 2); q.l1 = Math.max(q.l1, l + w / 2); q.s0 = Math.min(q.s0, s); q.n++;
          st.portalsMerged++;
          break;
        }
        const ux = Math.sin(yaw), uz = Math.cos(yaw);
        if (!c) clusters.push({ i, x, z, yaw, ux, uz, vx: uz, vz: -ux, l0: -w / 2, l1: w / 2, s0: 0, n: 1 });
      }
      const wl = pc.wall, dep = pc.depth, ramps = Array.isArray(pc.ramps) && pc.ramps.length ? pc.ramps : [pc.ramp];
      // 1 段目: 口の場所（_portalSites。道の覆い方に関係なく同じ = 出現地点の一覧は変わらない）
      const ents = [];
      for (const q of clusters) {
        const ox = q.x + q.ux * q.s0, oz = q.z + q.uz * q.s0;
        const W = (s, l) => [ox + q.ux * s + q.vx * l, oz + q.uz * s + q.vz * l];
        // 掘割の長さ: 長い順に、掘割が地上の建物にかからない最初のもの（短いほど坂が急）
        let why = null, Lr = ramps[0], o = null;
        for (const rl of ramps) {
          Lr = rl;
          o = { ox, oz, ux: q.ux, uz: q.uz, vx: q.vx, vz: q.vz, s0: 0, s1: rl + pc.stub + wl, l0: q.l0 - wl, l1: q.l1 + wl, il0: q.l0, il1: q.l1, n: q.n, ramp: rl, stub: pc.stub };
          why = null;
          for (let s = 0; s <= o.s1 + 1e-6 && !why; s += pc.sample) for (let l = o.l0; l <= o.l1 + 1e-6 && !why; l += pc.sample) {
            const p = W(Math.min(s, o.s1), Math.min(l, o.l1)), x = p[0], z = p[1];
            if (!this.isLand(x, z)) why = 'water';
            else if (this.isKeepout(x, z, 2) || this._inFoot(x, z, 2)) why = 'landmark';
            else if (this._entRectAt(x, z, 1)) why = 'enterable';
            else if (s <= rl + wl && this._groundPieceAt(x, z)) why = 'building';
            else if (l > q.l0 + 0.5 && l < q.l1 - 0.5 && this._deckTopNear(x, z, (0.5 + pc.deckClear) / 2, (pc.deckClear - 0.5) / 2, this._ci(x, z)) != null) why = 'deck'; // 低い橋・高架の床（道の坂）が線路の上を通る
            else for (const a of this._portalSites) if (this._inObb(a, x, z, 1)) { why = 'portal'; break; } // 作った口と全部覆った口（重なる口は作らない）
          }
          if (why !== 'building') break;
        }
        if (why) {
          st.portalsSkipped[why] = (st.portalsSkipped[why] || 0) + q.n; (st.portalsSkippedAt || (st.portalsSkippedAt = [])).push([Math.round(q.x), Math.round(q.z), why]);
          if (why !== 'portal') this._portalSkips.push({ ox, oz, ux: q.ux, uz: q.uz, vx: q.vx, vz: q.vz, l0: q.l0, l1: q.l1, why }); // 作れなかった口: そこで終わる地上の線路は止め + 暗い格子か建物の口（_trackStops の dead）
          continue;
        }
        // 口の場所の記録（全部覆った口も。city-test の道を渡る所・smoke N11b・出現地点）
        const site = { ox, oz, ux: q.ux, uz: q.uz, vx: q.vx, vz: q.vz, s0: 0, s1: o.s1, l0: o.l0, l1: o.l1, ramp: Lr, covered: true, a: 0, b: 0, kind: 'covered' };
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const s of [0, o.s1]) for (const l of [o.l0, o.l1]) { const p = W(s, l); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
        site.bb = [x0, z0, x1, z1];
        this._portalSites.push(site);
        ents.push({ q, o, Lr, ox, oz, W, site });
      }
      // 2 段目: 地図の道は口でふさがない（NC3 の直し 3 / 4、cut-and-cover。_portalCover）: 掘割に重なる車道（種類 1..12 の縁石の内側 + cwMargin m）・
      //   掘割を横切る道（縁石 + 歩道 + coverMargin m の帯。歩く道・歩道も）の所は地面の高さの屋根で覆い、その下は暗いトンネル。掘割に沿う歩道・歩く道は
      //   かまわない（掘割の縁の手すりの壁が歩道の上に立つ）。沿う車道は掘割の幅を shrinkMax m まで縮めてよける（中央分離帯の口: 両側）。
      //   掘割が開くのは道の無い区間 [a, b] だけ。口から奥 [0, ramp] に開けられなければ、口の前（地上の線路の所、s < 0）に短い掘割（termLen m）を作って道の手前で
      //   覆いの下へ入る（'termA'）。それも無理なら全部覆う（'covered'）: 口の所で終わる地上の線路は車道の縁石の termGap m 手前で止めて低い壁と暗い格子（_trackStops）
      const SP = this.core.spawns;
      const exts = []; // 口の前の掘割の囲い（s < 0。ほかの口の口の前の掘割と重ねない）
      for (const e of ents) {
        const { q, o, Lr, ox, oz, W, site } = e;
        const Ltot = Lr + pc.stub;
        const blockAt = (s) => { // 口の前の帯の s の所が掘割にできないか（建物・水・ランドマーク・入れる建物・床・ほかの口）
          for (let l = o.l0; l <= o.l1 + 1e-6; l += pc.sample) {
            const p = W(s, Math.min(l, o.l1)), x = p[0], z = p[1];
            if (!this.isLand(x, z) || this.isKeepout(x, z, 2) || this._inFoot(x, z, 2) || this._entRectAt(x, z, 1) || this._groundPieceAt(x, z)) return true;
            if (l > q.l0 + 0.5 && l < q.l1 - 0.5 && this._deckTopNear(x, z, (0.5 + pc.deckClear) / 2, (pc.deckClear - 0.5) / 2, this._ci(x, z)) != null) return true;
            for (const a of this._portalSites) if (a !== site && this._inObb(a, x, z, 1)) return true;
            for (const a of exts) if (this._inObb(a, x, z, 1)) return true;
          }
          return false;
        };
        let spNear = null; // 口の前の帯のまわりの出現地点 [s, l]（初めて要るときに 1 回）
        const spawnIn = (sa, sb) => { // 出現地点（SPWN）が口の前の囲い [sa, sb] から 1.5 m 以内（掘割に出現地点を入れない = 一覧は変えない）
          if (!SP) return false;
          if (!spNear) {
            spNear = [];
            const R = pc.backMax + Math.max(o.l1, -o.l0) + 4;
            for (let i = 0; i < SP.count; i++) {
              const dx = SP.xz[i * 2] - ox, dz = SP.xz[i * 2 + 1] - oz;
              if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
              spNear.push([dx * o.ux + dz * o.uz, dx * o.vx + dz * o.vz]);
            }
          }
          for (const [s, l] of spNear) if (s >= sa - 1.5 && s <= sb + 1.5 && l >= o.l0 - 1.5 && l <= o.l1 + 1.5) return true;
          return false;
        };
        const cv = this._portalCover(o, q, Ltot, Rd, pc, blockAt, spawnIn);
        site.kind = cv.kind; site.sh0 = cv.sh0 || 0; site.sh1 = cv.sh1 || 0;
        const quad = (sA, sB, lA, lB) => { const a = W(sA, lA), b = W(sB, lA), c = W(sB, lB), d = W(sA, lB); return [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]; };
        if (cv.kind === 'covered') { st.portalsCovered = (st.portalsCovered || 0) + q.n; (st.portalsCoveredAt || (st.portalsCoveredAt = [])).push([Math.round(ox), Math.round(oz), Lr]); continue; }
        const a = cv.a, b = cv.b, gr = cv.g, sF = Math.min(Ltot, a + dep / gr);
        // 沿う車道をよけて縮めた幅（sh0: l0 の側、sh1: l1 の側）
        const ql0 = q.l0 + (cv.sh0 || 0), ql1 = q.l1 - (cv.sh1 || 0);
        o.l0 = ql0 - wl; o.l1 = ql1 + wl; o.il0 = ql0; o.il1 = ql1;
        o.s0 = a; o.a = a; o.b = b; o.g = gr; o.kind = cv.kind;
        site.covered = false; site.a = a; site.b = b; site.xs0 = Math.min(0, a);
        if (b < Lr - 1e-6 || a > 1e-6 || a < -1e-6 || cv.sh0 || cv.sh1) { st.portalsCut = (st.portalsCut || 0) + 1; (st.portalsCutAt || (st.portalsCutAt = [])).push([Math.round(ox), Math.round(oz), Math.round(a * 10) / 10, Math.round(b * 10) / 10, Math.round((Lr - b) * 10) / 10, cv.kind, Math.round((cv.sh0 || 0) * 10) / 10, Math.round((cv.sh1 || 0) * 10) / 10]); }
        // 外接矩形（世界）
        let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
        for (const s of [o.s0, o.s1]) for (const l of [o.l0, o.l1]) { const p = W(s, l); bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
        o.bb = [bx0, bz0, bx1, bz1];
        if (a < 0) { // 口の前の掘割 [a, 0): ほかの口と重ねない。地上の線路は囲い [a, s1] の中では描かない（_portalTracks が掘割・トンネルの床に描く。覆いの上に切れ端を残さない）
          exts.push({ ox, oz, ux: q.ux, uz: q.uz, vx: q.vx, vz: q.vz, s0: a, s1: 0, l0: o.l0, l1: o.l1 });
          // 隠すのは掘割と口の 2 m 先まで（覆いの上の口の線の切れ端）。その先の覆いの上の地上の線路（操車場）は描く（NC3 の直し 5: サニーサイドの 67 m）
          const hs1 = Math.min(o.s1, Math.max(b, 0) + 2);
          let hx0 = Infinity, hz0 = Infinity, hx1 = -Infinity, hz1 = -Infinity;
          for (const sv of [a, hs1]) for (const lv of [o.l0, o.l1]) { const p = W(sv, lv); hx0 = Math.min(hx0, p[0]); hx1 = Math.max(hx1, p[0]); hz0 = Math.min(hz0, p[1]); hz1 = Math.max(hz1, p[1]); }
          this._railHide.push({ ox, oz, ux: q.ux, uz: q.uz, vx: q.vx, vz: q.vz, s0: a, s1: hs1, l0: o.l0, l1: o.l1, bb: [hx0, hz0, hx1, hz1] });
        }
        // 床（坂 → トンネル。開いた所 [a, b] は砂利、覆いの下は暗い）と隠れた屋根（覆いとトンネルの上の道を支える。描かない）
        const P3 = (s, l, y) => { const p = W(s, l); return [p[0], p[1], y]; };
        const fy = (s) => -Math.min(dep, gr * Math.max(0, s - a));
        const brk = [...new Set([a, sF, b, Ltot].map((v) => Math.round(v * 1000) / 1000))].filter((v) => v >= a - 2e-3 && v <= Ltot + 2e-3).sort((u, v) => u - v); // 丸めた a・b（1 mm）も残す
        const pmOpen = matId(pc.floorMat), pmDark = matId(pc.stubFloorMat || pc.floorMat);
        for (let k = 0; k + 1 < brk.length; k++) {
          const sa = brk[k], sb = brk[k + 1];
          if (sb - sa < 0.05) continue;
          addPiece([P3(sa, ql0, fy(sa)), P3(sa, ql1, fy(sa)), P3(sb, ql1, fy(sb)), P3(sb, ql0, fy(sb))], { kind: 2, flag: 8, tk: pc.floorT, mat: sb <= b + 1e-6 ? pmOpen : pmDark }); chain++;
        }
        addPiece([P3(b, o.l0, 0), P3(b, o.l1, 0), P3(o.s1, o.l1, 0), P3(o.s1, o.l0, 0)], { kind: 2, flag: 8 | 2, tk: pc.roof, mat: matId(pc.mat) }); chain++;
        // 壁・天井（ゲームの層の柱。チャンクで切って出す: _elEmit）。手すりの高さの壁は開いた所の両側だけ（覆いの上の道には何も立てない）
        const pr = o.prisms = [];
        pr.push({ ring: quad(a, b, o.l0, ql0), y0: -dep - 0.2, y1: pc.rail, mat: pc.mat, cat: 'portal' });
        pr.push({ ring: quad(a, b, ql1, o.l1), y0: -dep - 0.2, y1: pc.rail, mat: pc.mat, cat: 'portal' });
        pr.push({ ring: quad(b, Ltot, o.l0, ql0), y0: -dep - 0.2, y1: -pc.roof, mat: pc.stubMat, cat: 'under' });
        pr.push({ ring: quad(b, Ltot, ql1, o.l1), y0: -dep - 0.2, y1: -pc.roof, mat: pc.stubMat, cat: 'under' });
        pr.push({ ring: quad(Ltot, o.s1, o.l0, o.l1), y0: -dep - 0.2, y1: -pc.roof, mat: pc.stubMat, cat: 'under' });
        // トンネルの口の上の壁（覆いの始まり b: 天井の下面から手すりの高さ = 覆いの上の道から掘割へ落ちない。下から見た上の道を隠す）
        pr.push({ ring: quad(b - wl, b, o.l0, o.l1), y0: -pc.roof - pc.ceil, y1: pc.rail, mat: pc.mat, cat: 'portal' });
        pr.push({ ring: quad(b, Ltot, ql0, ql1), top: [-pc.roof, 0, 0], t: pc.ceil, y0: -pc.roof - pc.ceil, y1: -pc.roof, mat: pc.stubMat, cat: 'road' }); // 天井（下の面を描く。暗い tunnelDark = 下からの半球光で光らない）
        this._portals.push(o);
        // 地面の穴（groundAt / groundY: 地面の壁を開ける）と掘割の上を抜く所（開いた所 [a, b] だけ）
        o.pitY = -dep - 1; // 地面の穴（_portalPitY。地図に散らばるので沈んだ広場の pits / _pitBB とは別の 32 m の格子）
        const cut = { ox, oz, ux: q.ux, uz: q.uz, vx: q.vx, vz: q.vz, s0: a, s1: b, l0: o.l0, l1: o.l1 };
        let cx0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cz1 = -Infinity;
        cut.ring = quad(a, b, o.l0, o.l1);
        for (let k = 0; k < 8; k += 2) { cx0 = Math.min(cx0, cut.ring[k]); cx1 = Math.max(cx1, cut.ring[k]); cz0 = Math.min(cz0, cut.ring[k + 1]); cz1 = Math.max(cz1, cut.ring[k + 1]); }
        cut.bb = [cx0, cz0, cx1, cz1];
        this._cuts.push(cut);
        st.portalsBuilt += q.n;
      }

      this._elPitGrid();
      tm.portals = Math.round(now() - t0);
      // ---- 柱を立てない所の索引（32 m のセル）: 地上の車道の区間・el の線の区間
      const { GC, GW, GH, gk, putSeg, elG, near } = this._elGrids(ec);
      const Ls = RL.lines;
      const roadG = new Map(), maxCurb = 20;
      // 粗い印（8 × 8 セル = 256 m）: 道の外接矩形が el のまわりのセルに一つもかからなければその道は飛ばす（入れる物は同じ。起動の速さ）
      const NC = 8, CW8 = Math.ceil(GW / NC), CH8 = Math.ceil(GH / NC), nearC = new Uint8Array(CW8 * CH8);
      for (let jj = 0; jj < GH; jj++) for (let ii = 0; ii < GW; ii++) if (near[ii + jj * GW]) nearC[Math.floor(ii / NC) + Math.floor(jj / NC) * CW8] = 1;
      if (Rd) for (let i = 0; i < Rd.count; i++) {
        const a0 = Rd.vertStart[i], a1 = Rd.vertStart[i + 1];
        const cw = Math.min(Math.max(Rd.curbL[i], Rd.curbR[i]), maxCurb) + 2;
        {
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = a0; v < a1; v++) { const x = Rd.xz[v * 2], z = Rd.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          const i0 = Math.max(0, Math.floor((Math.floor((x0 - cw - this.minX) / GC)) / NC)), i1 = Math.min(CW8 - 1, Math.floor((Math.floor((x1 + cw - this.minX) / GC)) / NC));
          const j0 = Math.max(0, Math.floor((Math.floor((z0 - cw - this.minZ) / GC)) / NC)), j1 = Math.min(CH8 - 1, Math.floor((Math.floor((z1 + cw - this.minZ) / GC)) / NC));
          let any = false;
          for (let jj = j0; jj <= j1 && !any; jj++) for (let ii = i0; ii <= i1; ii++) if (nearC[ii + jj * CW8]) { any = true; break; }
          if (!any) continue;
        }
        for (let v = a0; v + 1 < a1; v++) {
          if (Math.abs(Rd.y[v]) > 1 || Math.abs(Rd.y[v + 1]) > 1) continue; // 地上の車道だけ（橋・高架の車道は床の片が見る）
          const ax = Rd.xz[v * 2], az = Rd.xz[v * 2 + 1], bx = Rd.xz[v * 2 + 2], bz = Rd.xz[v * 2 + 3];
          const i0 = Math.floor((Math.min(ax, bx) - cw - this.minX) / GC), i1 = Math.floor((Math.max(ax, bx) + cw - this.minX) / GC);
          const j0 = Math.floor((Math.min(az, bz) - cw - this.minZ) / GC), j1 = Math.floor((Math.max(az, bz) + cw - this.minZ) / GC);
          for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++) for (let k = Math.max(0, i0); k <= Math.min(GW - 1, i1); k++) {
            const key = k + j * GW;
            if (!near[key]) continue;
            let a = roadG.get(key); if (!a) roadG.set(key, a = []); a.push(i * 65536 + v);
          }
        }
      }
      const colG = new Map(), cols = [], beams = [];
      const hc = ec.colW / 2;
      const onRoad = (x, z) => {
        const a = roadG.get(gk(x, z));
        if (a) for (let n = 0; n < a.length; n++) {
          const i = Math.floor(a[n] / 65536), v = a[n] % 65536;
          const lim = Math.max(Rd.curbL[i], Rd.curbR[i]) + hc + ec.colRoad;
          if (segDist2(x, z, Rd.xz[v * 2], Rd.xz[v * 2 + 1], Rd.xz[v * 2 + 2], Rd.xz[v * 2 + 3]) < lim * lim) return true;
        }
        return false;
      };
      const underLower = (x, z, self, yb, tx, tz) => { // ほかの低い線（y < yb − 0.5）の真下か。(tx, tz): 自分の向き = それとほぼ平行な線（同じ線路の重なった片）は数えない
        const a = elG.get(gk(x, z));
        if (a) for (let n = 0; n < a.length; n++) {
          const i = Math.floor(a[n] / 65536), v = a[n] % 65536;
          if (i === self) continue;
          const ax = Ls.xz[v * 2], az = Ls.xz[v * 2 + 1], bx = Ls.xz[v * 2 + 2], bz = Ls.xz[v * 2 + 3];
          const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
          if (tx != null && L2 > 0 && Math.abs(dx * tx + dz * tz) > 0.87 * Math.sqrt(L2)) continue;
          let u = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = ax + dx * u - x, qz = az + dz * u - z;
          if (qx * qx + qz * qz > ec.colTrack * ec.colTrack) continue;
          if (Ls.y[v] + (Ls.y[v + 1] - Ls.y[v]) * u < yb - 0.5) return true;
        }
        return false;
      };
      const roadDeckUnder = (x, z, yb) => { // データの床（橋・高架の車道・歩道）が柱の所の地面と床の下面の間にある
        const ci = this._ci(x, z);
        if (ci < 0) return false;
        const dc = this._deckChunk, bb = this._deckBB;
        for (let k = dc.start[ci]; k < dc.start[ci + 1]; k++) {
          const i = dc.items[k];
          if (i >= n0 || x < bb[i * 4] - hc - 0.3 || x > bb[i * 4 + 2] + hc + 0.3 || z < bb[i * 4 + 1] - hc - 0.3 || z > bb[i * 4 + 3] + hc + 0.3) continue;
          const yd = D0.plane[i * 3] * x + D0.plane[i * 3 + 1] * z + D0.plane[i * 3 + 2];
          if (yd < yb + 0.5 && this._nearDeck(i, x, z, hc + 0.3)) return true;
        }
        return false;
      };
      const colWhy = (x, z, self, yb) => { // '' = 柱を立ててよい
        if (onRoad(x, z)) return 'road'; // 一番多い（安い順）
        if (!this.isLand(x, z)) return 'water';
        if (this.isKeepout(x, z, 1) || this._inFoot(x, z, 1)) return 'landmark';
        for (const a of this._portals) if (this._inObb(a, x, z, hc + 0.5)) return 'portal';
        if (this._entRectAt(x, z, ec.colEnt + hc)) return 'enterable';
        if (this._pieceNear(x, z, hc + ec.colBld, yb)) return 'building';
        if (underLower(x, z, self, yb)) return 'lowerTrack';
        if (roadDeckUnder(x, z, yb)) return 'roadDeck';
        return '';
      };
      // 柱の足もと: 地面なら 0、低い建物の屋上（柱の 4 隅とも同じ高さの屋上の上、屋上が床の下面より roofGap m 以上低い）ならその高さ、立てられなければ null
      const SI = this.core.supi;
      const topAt = (x, z) => { // (x, z) を含む建物の片の一番上（無ければ -1）
        const ii = Math.floor((x - this.minX) / SI.cell), jj = Math.floor((z - this.minZ) / SI.cell);
        if (ii < 0 || jj < 0 || ii >= SI.W || jj >= SI.H) return -1;
        let t = -1;
        const c = jj * SI.W + ii;
        for (let k = SI.start[c]; k < SI.start[c + 1]; k++) {
          const q = SI.piece[k];
          if (this._sup[q] || P.y1f[q] <= t || x < P.bbox[q * 4] || x > P.bbox[q * 4 + 2] || z < P.bbox[q * 4 + 1] || z > P.bbox[q * 4 + 3]) continue;
          if (NycData.pointIn(P, q, x, z)) t = this._gapOf(q) && this._gapHi[q] >= P.y1f[q] - 0.2 ? Math.max(t, this._gapLo[q]) : P.y1f[q]; // 上が抜けた片（el が通る駅の建物）は抜けの下まで
        }
        return t;
      };
      const RB_DX = [0, 1, 1, -1, -1], RB_DZ = [0, 1, -1, 1, -1];
      const roofBase = (x, z, yb) => {
        const m = hc + ec.roofEdge;
        let lo = Infinity, hi = -Infinity;
        for (let q = 0; q < 5; q++) { const t = topAt(x + RB_DX[q] * m, z + RB_DZ[q] * m); lo = Math.min(lo, t); hi = Math.max(hi, t); } // 真ん中・4 隅（配列を作らない）
        if (lo < 1 || hi - lo > 0.3 || hi > yb - ec.roofGap) return null;
        return Math.ceil(hi * 10) / 10;
      };
      const colBase = (x, z, self, yb) => {
        const w = colWhy(x, z, self, yb);
        if (!w) return 0;
        if ((w !== 'building' && w !== 'road') || ec.roofCols === false) return null; // 'road': 道の縁石の帯にかかる建物（クイーンズボロ・プラザの駅）の屋上も
        const rb = roofBase(x, z, yb);
        if (rb == null || underLower(x, z, self, yb) || roadDeckUnder(x, z, yb) || !this.isLand(x, z) || this.isKeepout(x, z, 1) || this._inFoot(x, z, 1) || this._entRectAt(x, z, ec.colEnt + hc)) return null;
        for (const a of this._portals) if (this._inObb(a, x, z, hc + 0.5)) return null;
        return rb;
      };
      st.noColumnWhy = {};
      const CW = this._elColW = Math.ceil((this.maxX - this.minX) / 8) + 4;
      const NONE = [];
      const colNear = (x, z, yb) => {
        const i0 = Math.floor((x - this.minX) / 8), j0 = Math.floor((z - this.minZ) / 8);
        let best = null, bd = ec.colMerge;
        for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) for (const c of colG.get(i + j * CW) || NONE) {
          if (!(Math.abs(c.h - yb) < 1.5)) continue; // 高さの違う柱は距離を測らない
          const d = Math.hypot(c.x - x, c.z - z);
          if (d < bd) { bd = d; best = c; }
        }
        return best;
      };

      // 梁の通り道（(ax0, az0) → (bx0, bz0)）の下のほかの el の線のレールの一番高い所（梁の下面 yb より 0.5 m 上まで。無ければ −∞）。梁の下面は
      //   それより beamRailClear m 上（クイーンズボロ・プラザの西: 上の線の梁が下の線の 0.2 m 上を横切り、下の線路が消えた）
      const brc = ec.beamRailClear != null ? ec.beamRailClear : 0.45;
      const segLow = (ax0, az0, bx0, bz0, yb, self) => {
        const ox = bx0 - ax0, oz = bz0 - az0, od = Math.hypot(ox, oz) || 1e-9;
        let top = -Infinity;
        for (let t = 0; t <= od + 1e-9; t += 1) {
          const x = ax0 + ox * Math.min(t, od) / od, z = az0 + oz * Math.min(t, od) / od, a = elG.get(gk(x, z));
          if (a) for (let n = 0; n < a.length; n++) {
            const i = Math.floor(a[n] / 65536), v = a[n] % 65536;
            if (i === self) continue;
            const ax = Ls.xz[v * 2], az = Ls.xz[v * 2 + 1], dx = Ls.xz[v * 2 + 2] - ax, dz = Ls.xz[v * 2 + 3] - az, L2 = dx * dx + dz * dz;
            let u = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const qx = ax + dx * u - x, qz = az + dz * u - z;
            if (qx * qx + qz * qz > ec.colTrack * ec.colTrack) continue;
            const yl = Ls.y[v] + (Ls.y[v + 1] - Ls.y[v]) * u;
            if (yl < yb + 0.5 && yl > top) top = yl;
          }
        }
        return top;
      };
      // 柱 (cx, cz) から p の真下への梁の厚さ（下の線路をよけて薄く。bentMin m より薄くなるなら null = その柱は使わない）。梁が要らなければ 0
      const beamFor = (cx, cz, p, yb, self) => {
        const ox = p[0] - cx, oz = p[1] - cz, od = Math.hypot(ox, oz);
        if (od <= ec.width / 2 - hc) return 0;
        let bh = Math.max(ec.bentMin, Math.min(ec.beamH, yb - ec.bentClear));
        const lo = segLow(cx, cz, p[0], p[1], yb, self);
        if (lo > -Infinity) bh = Math.min(bh, yb - lo - brc);
        return bh >= ec.bentMin - 1e-9 ? bh : null;
      };
      // 柱 1 本（真下から横へ colLat m ずつ colReach m まで。真下でなければ梁）。立てたら true
      const placeCol = (p, self) => {
        const yb = p[2] - ec.thick, hw = ec.width / 2;
        const k2 = p[3], LsX = (v) => Ls.xz[v * 2], a0 = Ls.vertStart[self];
        const dx = LsX(a0 + k2 + 1) - LsX(a0 + k2), dz = Ls.xz[(a0 + k2 + 1) * 2 + 1] - Ls.xz[(a0 + k2) * 2 + 1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
        let spot = null;
        for (let m = 0; m * ec.colLat <= ec.colReach + 1e-9 && !spot; m++) {
          for (const o of m ? [m * ec.colLat, -m * ec.colLat] : [0]) {
            const x = p[0] + nx * o, z = p[1] + nz * o;
            const old = colNear(x, z, yb);
            if (old) { const bh = beamFor(old.x, old.z, p, yb, self); if (bh == null) continue; spot = [old.x, old.z, o, old, 0, bh]; break; }
            const b0 = colBase(x, z, self, yb);
            if (b0 != null) { const bh = beamFor(x, z, p, yb, self); if (bh == null) continue; spot = [x, z, o, null, b0, bh]; break; }
          }
        }
        if (!spot) return false;
        if (!spot[3]) addCol(spot[0], spot[1], yb, spot[4]);
        // 梁: 柱が床の外（横へ hw − 柱の半分より先）なら柱の上から線の真下まで
        const ox = p[0] - spot[0], oz = p[1] - spot[1], od = Math.hypot(ox, oz);
        if (od > hw - hc) {
          const ux = ox / od, uz = oz / od, bw = ec.beamW / 2, ex = spot[0] - ux * hc, ez = spot[1] - uz * hc;
          const bh = spot[5]; // 下の道から bentClear m（低い床では梁を薄く）・下の el の線路から beamRailClear m（beamFor）
          beams.push({ ring: [ex - uz * bw, ez + ux * bw, p[0] - uz * bw, p[1] + ux * bw, p[0] + uz * bw, p[1] - ux * bw, ex + uz * bw, ez - ux * bw], y0: yb - bh, y1: yb });
        }
        return true;
      };
      // 門形（道をまたぐ所）: 線の両側にそれぞれ一番近い立てられる所（bentReach m まで）+ 2 本の柱の上をつなぐ横の梁（下面は道から bentClear m 以上、
      //   厚さ bentMin〜beamH m。梁が建物の片を通るなら作らない）
      const placeBent = (p, self) => {
        const yb = p[2] - ec.thick;
        let bh = Math.min(ec.beamH, yb - ec.bentClear);
        if (bh < ec.bentMin) return false;
        const a0 = Ls.vertStart[self], k2 = p[3];
        const dx = Ls.xz[(a0 + k2 + 1) * 2] - Ls.xz[(a0 + k2) * 2], dz = Ls.xz[(a0 + k2 + 1) * 2 + 1] - Ls.xz[(a0 + k2) * 2 + 1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
        const side = (sg) => {
          for (let m = 1; m * ec.colLat <= ec.bentReach + 1e-9; m++) {
            const o = m * ec.colLat * sg, x = p[0] + nx * o, z = p[1] + nz * o;
            const old = colNear(x, z, yb);
            if (old) return [old.x, old.z, old];
            const b0 = colBase(x, z, self, yb);
            if (b0 != null) return [x, z, null, b0];
          }
          return null;
        };
        const A = side(1);
        if (!A) return false;
        const B = side(-1);
        if (!B) return false;
        const bx = B[0] - A[0], bz = B[1] - A[1], bl = Math.hypot(bx, bz) || 1, ux = bx / bl, uz = bz / bl;
        const lo = segLow(A[0], A[1], B[0], B[1], yb, self); // 横の梁がほかの el の線路の上を通るなら、その beamRailClear m 上まで薄く
        if (lo > -Infinity) { bh = Math.min(bh, yb - lo - brc); if (bh < ec.bentMin) return false; }
        for (let t = 0; t <= bl; t += 1) if (this._pieceIn(A[0] + ux * t, A[1] + uz * t, yb - bh, yb)) return false;
        if (!A[2]) addCol(A[0], A[1], yb, A[3]);
        if (!B[2]) addCol(B[0], B[1], yb, B[3]);
        const bw = ec.beamW / 2, ex = A[0] - ux * hc, ez = A[1] - uz * hc, fx = B[0] + ux * hc, fz = B[1] + uz * hc;
        beams.push({ ring: [ex - uz * bw, ez + ux * bw, fx - uz * bw, fz + ux * bw, fx + uz * bw, fz - ux * bw, ex + uz * bw, ez - ux * bw], y0: yb - bh, y1: yb, bent: 1 });
        return true;
      };
      const addCol = (x, z, yb, base) => { // h = 上端、y0 = 足もと（屋上の柱。地面は 0）
        const c = { x: r2(x), z: r2(z), h: Math.round(yb * 100) / 100, w: ec.colW, y0: base || 0 };
        if (base) st.roofCols++;
        cols.push(c);
        const key = Math.floor((c.x - this.minX) / 8) + Math.floor((c.z - this.minZ) / 8) * CW;
        let g = colG.get(key); if (!g) colG.set(key, g = []); g.push(c);
      };
      tm.grids = Math.round(now() - t0);
      // ---- el の床と柱
      const elMat = matId(ec.mat);
      // データの床（core の DECK + つないだ片 = n0 まで）の上面がレールの高さ ± deckTol m の所か（支えの 32 m のセル。_deckTopNear と同じ判定）
      const dkc = this._deckCell, dbb = this._deckBB;
      const roadDeckAt = (x, z, y, tx, tz) => { // tx, tz: 線の向き（あれば。細い床は横切るときだけ el の床を残す）
        const gi = Math.floor((x - this.minX) / dkc.cell), gj = Math.floor((z - this.minZ) / dkc.cell);
        if (gi < 0 || gj < 0 || gi >= dkc.W || gj >= dkc.H) return false;
        const k = gj * dkc.W + gi;
        for (let m = dkc.csr.start[k]; m < dkc.csr.start[k + 1]; m++) {
          const q = dkc.csr.items[m];
          if (q >= n0 || x < dbb[q * 4] || x > dbb[q * 4 + 2] || z < dbb[q * 4 + 1] || z > dbb[q * 4 + 3]) continue;
          if (Math.abs(D0.plane[q * 3] * x + D0.plane[q * 3 + 1] * z + D0.plane[q * 3 + 2] - y) > ec.deckTol) continue;
          if (this._deckCut.length && this._deckCut.some((R) => x > R[0] && x < R[2] && z > R[1] && z < R[3])) continue;
          if (tx !== undefined && this._deckWeak(q) && this._deckCrosses(q, tx, tz)) continue; // 横切る細い歩道・階段の床（駅の通路）は el の床を消さない（クイーンズボロ・プラザの下の段の 6 m の穴。直し 6）。
          //   沿う細い床（ハイラインの遊歩道）は今まで通り（el の床をその所で切る = 柱の間 40 m を守る）
          if (this._nearDeck(q, x, z, 0)) return true;
        }
        return false;
      };
      const { LN, atL, lineAdj, yAdj, underOf } = this._elUnder(ec, Ls, Rd, roadG, gk, elG, roadDeckAt, st);
      const uc = this.underCfg;
      tm.under = Math.round(now() - t0);
      for (let i = 0; i < Ls.count; i++) {
        const a = Ls.vertStart[i], e = Ls.vertStart[i + 1], n = e - a;
        if (n < 2) continue;
        const { X, Z, Y, S } = LN[i], adj = lineAdj[i], und = underOf[i];
        const tot = S[n - 1];
        let ymx = -Infinity;
        for (let k = 0; k < n; k++) ymx = Math.max(ymx, Y[k]);
        if (ymx < ec.minY) continue; // 地上の線路（柱をよける所だけ）
        st.km += tot / 1000;
        if (tot < ec.minRun) continue;
        let seg = 0;
        const at = (s) => { // → [x, z, y, 区間]
          let lo = 0, hi = n - 2;
          while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m] <= s) lo = m; else hi = m - 1; }
          const k = lo;
          const L = S[k + 1] - S[k], u = L > 1e-9 ? Math.min(1, Math.max(0, (s - S[k]) / L)) : 0;
          const x = X[k] + (X[k + 1] - X[k]) * u, z = Z[k] + (Z[k + 1] - Z[k]) * u, y = Y[k] + (Y[k + 1] - Y[k]) * u;
          return [x, z, adj ? yAdj(adj, x, z, y) : y, k];
        };
        void seg;
        // 高さを変えた所（_elAdj）は uc.fine m ごとに切る（床の片は平ら）、板の区間の端でも切る
        const xcuts = [];
        if (adj) { // 変えた所の 1 m ごとの高さを、片の中でまっすぐから fineTol m 以内になる所で切る（貪欲）
          const ob = adj.bb, ss = [], ys = [];
          let on = false;
          for (let s = 0; s <= tot + 1e-6; s += 1) {
            const q = atL(LN[i], Math.min(s, tot));
            const ya = q[0] < ob[0] || q[0] > ob[2] || q[1] < ob[1] || q[1] > ob[3] ? q[2] : yAdj(adj, q[0], q[1], q[2]);
            const d = Math.abs(ya - q[2]) > 0.005;
            if (d || on) { ss.push(s); ys.push(ya); } else if (ss.length && ss[ss.length - 1] !== -1) { ss.push(-1); ys.push(0); }
            on = d;
          }
          let a = -1;
          for (let k = 0; k < ss.length; k++) {
            if (ss[k] < 0) { a = -1; continue; }
            if (a < 0) { xcuts.push(ss[k]); a = k; continue; }
            if (k + 1 >= ss.length || ss[k + 1] < 0) { xcuts.push(ss[k]); a = -1; continue; }
            // a → k + 1 のまっすぐから外れる点があれば k で切る
            const s0 = ss[a], y0 = ys[a], s1 = ss[k + 1], y1 = ys[k + 1];
            let bad = false;
            for (let j = a + 1; j <= k && !bad; j++) bad = Math.abs(ys[j] - (y0 + (y1 - y0) * (ss[j] - s0) / (s1 - s0))) > uc.fineTol;
            if (bad) { xcuts.push(ss[k]); a = k; }
          }
        }
        if (und) for (const c of und) xcuts.push(c.u0 - uc.pad, c.u1 + uc.pad);
        const undAt = (s0, s1) => { if (und) for (const c of und) if (s0 < c.u1 + uc.pad - 1e-6 && s1 > c.u0 - uc.pad + 1e-6) return c; return null; };
        // 置く所（sample m ごと）と床の左右の幅（縁が建物の片に入る側は 0.5 m ずつ縮める = 床が建物に刺さらない。edgeMin m より狭ければ置かない）
        const N = Math.max(1, Math.ceil(tot / ec.sample)), keep = new Uint8Array(N + 1), wl = new Float32Array(N + 1), wr = new Float32Array(N + 1);
        const hw = ec.width / 2, ch = chain++, ds = tot / N;
        let seq = 0;
        const freeW = (x, z, nx, nz, sg, y0, y1) => {
          if (!this._pieceInSpan(x + nx * hw * sg, z + nz * hw * sg, y0, y1)) return hw;
          for (let o = 0.5; o <= hw + 1e-6; o += 0.5) if (this._pieceInSpan(x + nx * o * sg, z + nz * o * sg, y0, y1)) return o - 0.5;
          return hw;
        };
        const tdir0 = (p) => { const k2 = p[3], dx = X[k2 + 1] - X[k2], dz = Z[k2 + 1] - Z[k2], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
        for (let k = 0; k <= N; k++) {
          const p = at(tot * k / N);
          if (p[2] < ec.minY) { st.lowKm += (k ? ds : 0) / 1000; continue; }
          const td = tdir0(p);
          if (roadDeckAt(p[0], p[1], p[2], td[0], td[1])) { st.roadDeckKm += (k ? ds : 0) / 1000; continue; }
          if (this._pieceInSpan(p[0], p[1], p[2] - ec.thick, p[2] + ec.solidClear)) { st.solidKm += (k ? ds : 0) / 1000; continue; }
          const k2 = p[3], dx = X[k2 + 1] - X[k2], dz = Z[k2 + 1] - Z[k2], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
          const l = freeW(p[0], p[1], nx, nz, 1, p[2] - ec.thick, p[2] + 1), r = freeW(p[0], p[1], nx, nz, -1, p[2] - ec.thick, p[2] + 1);
          if (Math.min(l, r) < ec.edgeMin) { st.solidKm += (k ? ds : 0) / 1000; continue; }
          if (l < hw || r < hw) st.narrowed++;
          wl[k] = l; wr[k] = r; keep[k] = 1;
        }
        // 盛り土（床の下面が embankH m より低い = 道・人が下を通れない高さ）: 地面まで埋めて柱を立てない。ほかの低い線をまたぐ所は埋めない
        const tdir = (p) => { const k2 = p[3], dx = X[k2 + 1] - X[k2], dz = Z[k2 + 1] - Z[k2], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
        const embAt = (p) => { if (p[2] - ec.thick >= ec.embankH) return false; const t = tdir(p); return !underLower(p[0], p[1], i, p[2] - ec.thick - 0.6, t[0], t[1]); };
        for (let k = 0; k <= N;) {
          if (!keep[k]) { k++; continue; }
          let k1 = k;
          while (k1 < N && keep[k1 + 1]) k1++;
          const kA = k, kB = k1, sA = tot * k / N, sB = tot * k1 / N;
          k = k1 + 1;
          if (sB - sA < ec.minRun) continue;
          st.deckKm += (sB - sA) / 1000;
          const sup = [sA, sB]; // 支え（柱・門形の柱・盛り土・床の端）の線の上の位置
          const widths = (s0, s1) => { // 片の左右の幅（片にかかるサンプルの一番狭い所）
            let a = hw, b = hw;
            for (let q = Math.max(kA, Math.floor(s0 / ds - 1e-6)); q <= Math.min(kB, Math.ceil(s1 / ds + 1e-6)); q++) { a = Math.min(a, wl[q]); b = Math.min(b, wr[q]); }
            return [a, b];
          };
          // 区切り: 始まり・終わり・元の頂点・pieceMax m ごと
          const cuts = [sA];
          for (let v = 1; v < n - 1; v++) if (S[v] > sA + 0.05 && S[v] < sB - 0.05) cuts.push(S[v]);
          for (const c of xcuts) if (c > sA + 0.05 && c < sB - 0.05) cuts.push(c);
          if (und) for (const c of und) for (const q of [c.u0 - uc.pad, c.u1 + uc.pad]) if (q > sA + 0.05 && q < sB - 0.05) cuts.push(q);
          cuts.sort((p, q) => p - q);
          for (let c = cuts.length - 1; c > 0; c--) if (cuts[c] - cuts[c - 1] < 0.05) cuts.splice(c, 1);
          cuts.push(sB);
          const fine = [cuts[0]];
          for (let c = 1; c < cuts.length; c++) { const L = cuts[c] - cuts[c - 1], m = Math.max(1, Math.ceil(L / ec.pieceMax)); for (let q = 1; q <= m; q++) fine.push(cuts[c - 1] + L * q / m); }
          let prevN = null;
          for (let c = 0; c + 1 < fine.length; c++) {
            const s0 = fine[c], s1 = fine[c + 1];
            if (s1 - s0 < 0.05) continue;
            const p0 = at(s0), p1 = at(Math.min(s1, tot)), sm = at((s0 + s1) / 2), k2 = sm[3];
            const dx = X[k2 + 1] - X[k2], dz = Z[k2 + 1] - Z[k2], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
            const [hl, hr] = widths(s0, s1);
            // 折れ（前の片と向きが違う）: 両側に三角（壁なし）
            if (prevN && (Math.abs(prevN[0] - nx) > 0.017 || Math.abs(prevN[1] - nz) > 0.017)) {
              for (const sg of [1, -1]) { const w = sg > 0 ? hl : hr; addPiece([[p0[0], p0[1], p0[2]], [p0[0] + prevN[0] * w * sg, p0[1] + prevN[1] * w * sg, p0[2]], [p0[0] + nx * w * sg, p0[1] + nz * w * sg, p0[2]]], { kind: 2, chain: ch, seq: seq++, cls: Ls.cls[i], flag: 1, tk: ec.thick, mat: elMat }); }
            }
            prevN = [nx, nz];
            const ymin = Math.min(p0[2], p1[2]), ymax = Math.max(p0[2], p1[2]);
            const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
            const uq = undAt(s0, s1); // 道を渡る板（両側の盛り土の端が橋台）
            const emb = !uq && ymin - ec.thick < ec.embankH && !underLower(mx, mz, i, ymin - ec.thick - 0.6, -nz, nx);
            if (emb) { sup.push(s0, s1); st.embankKm += (s1 - s0) / 1000; }
            if (addPiece([[p0[0] + nx * hl, p0[1] + nz * hl, p0[2]], [p0[0] - nx * hr, p0[1] - nz * hr, p0[2]], [p1[0] - nx * hr, p1[1] - nz * hr, p1[2]], [p1[0] + nx * hl, p1[1] + nz * hl, p1[2]]],
              { kind: 0, chain: ch, seq: seq++, cls: Ls.cls[i], flag: 1, tk: emb ? ymax + 0.3 : uq ? Math.min(ec.thick, uq.slab) : ec.thick, mat: elMat })) st.pieces++;
          }
          // 地図の端で終わる床: 端の壁（地面から床の上 edgeWall m。宙で切れて見えない）
          for (const se of [sA, sB]) {
            const p = at(Math.min(se, tot));
            if (p[2] < 3 || Math.min(p[0] - this.minX, this.maxX - p[0], p[1] - this.minZ, this.maxZ - p[1]) > ec.edgeDist) continue;
            const k2 = p[3], dx = X[k2 + 1] - X[k2], dz = Z[k2 + 1] - Z[k2], L = Math.hypot(dx, dz) || 1, tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
            const [hl, hr] = widths(se - 1, se + 1), back = se === sA ? 1 : -1; // 床の内側へ 0.8 m
            const a = [p[0] - nx * (hr + 0.1), p[1] - nz * (hr + 0.1)], b = [p[0] + nx * (hl + 0.1), p[1] + nz * (hl + 0.1)];
            const ring = back > 0 ? [a[0], a[1], b[0], b[1], b[0] + tx * 0.8, b[1] + tz * 0.8, a[0] + tx * 0.8, a[1] + tz * 0.8] : [b[0], b[1], a[0], a[1], a[0] - tx * 0.8, a[1] - tz * 0.8, b[0] - tx * 0.8, b[1] - tz * 0.8];
            beams.push({ ring, y0: 0, y1: p[2] + ec.edgeWall, edge: 1 });
            st.edgeWalls++;
          }
          // 柱（colStep m ごと。線の始まりから測る = どの区間でも同じ所）。真下から横へ colReach m に無ければ線に沿って shifts m ずらして探し、
          //   それでも無ければ門形（両側の bentReach m 以内に 1 本ずつ + 上に横の梁。道の両側の縁石の外に立つ）
          for (let s = Math.ceil((sA + 1 - ec.colStep / 2) / ec.colStep) * ec.colStep + ec.colStep / 2; s <= sB - 1; s += ec.colStep) {
            const pc0 = at(s);
            if (pc0[2] - ec.thick < ec.colMinH || embAt(pc0)) continue;
            st.stations++;
            let ok = false;
            for (const d of ec.colShift) { const s2 = s + d; if (s2 < sA + 0.5 || s2 > sB - 0.5) continue; const p = at(s2); if (embAt(p)) { ok = true; break; } if (placeCol(p, i)) { sup.push(s2); ok = true; if (d) st.shifted++; break; } }
            if (!ok) for (const d of ec.colShift) { const s2 = s + d; if (s2 < sA + 0.5 || s2 > sB - 0.5) continue; if (placeBent(at(s2), i)) { sup.push(s2); ok = true; st.bents++; break; } }
            if (!ok && this._pieceIn(pc0[0], pc0[1], pc0[2] - ec.thick - 0.5, pc0[2]) && !this._pieceInSpan(pc0[0], pc0[1], pc0[2] - ec.thick, pc0[2])) { sup.push(s); ok = true; st.inGap = (st.inGap || 0) + 1; } // 建物の抜けの中（橋のアンカー・駅の建物）: 建物が支え
            if (!ok) { st.noColumn++; const yb = pc0[2] - ec.thick, w = colWhy(pc0[0], pc0[1], i, yb); st.noColumnWhy[w] = (st.noColumnWhy[w] || 0) + 1; (st.noColumnAt || (st.noColumnAt = [])).push([Math.round(pc0[0]), Math.round(pc0[1]), w, i]); }
          }
          // 道を渡る板が続く所（隣り合う車道）: 車線の間（車線の端から 0.2 m 以上あけて柱 1 本の幅）に柱（中央分離帯の橋脚）
          if (und && und.length > 1) {
            const us = und.slice().sort((p, q) => p.u0 - q.u0);
            for (let q = 1; q < us.length; q++) {
              const A = us[q - 1], B = us[q];
              if (B.u0 - uc.pad > A.u1 + uc.pad || B.ca - A.cb < ec.colW + 0.4) continue;
              const yb = Math.min(at(A.cb)[2], at(B.ca)[2]) - Math.min(ec.thick, Math.min(A.slab, B.slab));
              let done = false;
              for (let k = 0; k <= 20 && !done; k++) { // 真ん中から外へ 0.25 m ずつ（車線の縁石から柱の半分 + pierRoad m）
                const sm = (A.cb + B.ca) / 2 + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
                if (sm < Math.max(sA + 0.5, A.cb) || sm > Math.min(sB - 0.5, B.ca)) continue;
                const p = at(sm);
                const w = colWhy(p[0], p[1], i, yb);
                if (w && w !== 'road') continue;
                if (w === 'road') {
                  let bad = false;
                  const a = roadG.get(gk(p[0], p[1]));
                  if (a) for (let m = 0; m < a.length && !bad; m++) { const r = Math.floor(a[m] / 65536), v = a[m] % 65536, lim = Math.max(Rd.curbL[r], Rd.curbR[r]) + hc + uc.pierRoad; bad = segDist2(p[0], p[1], Rd.xz[v * 2], Rd.xz[v * 2 + 1], Rd.xz[v * 2 + 2], Rd.xz[v * 2 + 3]) < lim * lim; }
                  if (bad) continue;
                }
                addCol(p[0], p[1], yb, 0); sup.push(sm); st.under.piers = (st.under.piers || 0) + 1; done = true;
              }
              if (!done) st.under.pierMiss = (st.under.pierMiss || 0) + 1;
            }
          }
          // 支えの無い長さ（elStats.maxSpan・spans: spanReport m より長いもの。下の水の割合つき）
          sup.sort((a, b) => a - b);
          for (let q = 1; q < sup.length; q++) {
            const g0 = sup[q - 1], g1 = sup[q], len = g1 - g0;
            if (len > ec.spanReport) {
              let wet = 0, ns = 0;
              for (let u = g0; u <= g1; u += 5) { const p = at(u); ns++; if (!this.isLand(p[0], p[1])) wet++; }
              const pm = at((g0 + g1) / 2);
              st.spans.push([Math.round(len), Math.round(pm[0]), Math.round(pm[1]), i, Math.round(wet / Math.max(1, ns) * 100) / 100]);
            }
          }
          for (let q = 1; q < sup.length; q++) { const len = sup[q] - sup[q - 1]; if (len > st.maxSpan) { const p = at((sup[q] + sup[q - 1]) / 2); let wet = 0, ns = 0; for (let u = sup[q - 1]; u <= sup[q]; u += 5) { const pp = at(u); ns++; if (!this.isLand(pp[0], pp[1])) wet++; } if (wet / Math.max(1, ns) < 0.5) { st.maxSpan = len; st.maxSpanAt = [Math.round(p[0]), Math.round(p[1]), i]; } } }
        }
      }
      tm.lines = Math.round(now() - t0);
      // ホームの 4 角 v（上面 py）の中を el の線（レールが py − 2.5〜py + 0.3 m）の中心線が通るか（縁から 0.3 m より内側）
      const platCrosses = (v, py) => {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const q of v) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
        const ins = (x, z) => {
          let c = false;
          for (let a = 0, b = v.length - 1; a < v.length; b = a++) if ((v[a][1] > z) !== (v[b][1] > z) && x < (v[b][0] - v[a][0]) * (z - v[a][1]) / (v[b][1] - v[a][1]) + v[a][0]) c = !c;
          if (!c) return false;
          for (let a = 0, b = v.length - 1; a < v.length; b = a++) if (segDist2(x, z, v[a][0], v[a][1], v[b][0], v[b][1]) < 0.09) return false;
          return true;
        };
        for (let i = 0; i < Ls.count; i++) for (let k = Ls.vertStart[i]; k + 1 < Ls.vertStart[i + 1]; k++) {
          const ax = Ls.xz[k * 2], az = Ls.xz[k * 2 + 1], bx = Ls.xz[k * 2 + 2], bz = Ls.xz[k * 2 + 3];
          if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
          const L = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(L));
          for (let j = 0; j <= m; j++) {
            const u = j / m, y = Ls.y[k] + (Ls.y[k + 1] - Ls.y[k]) * u;
            if (y < py - 2.5 || y > py + 0.3) continue;
            if (ins(ax + (bx - ax) * u, az + (bz - az) * u)) return true;
          }
        }
        return false;
      };
      // ---- 高架の駅のホーム（RLEL の 4 角。上面 y、壁なし）
      const PF = RL.plats, plMat = matId(ec.platMat);
      for (let i = 0; i < PF.count; i++) {
        const a = PF.vertStart[i], e = PF.vertStart[i + 1];
        if (e - a !== 4) continue;
        const v = [];
        for (let k = a; k < e; k++) v.push([PF.xz[k * 2], PF.xz[k * 2 + 1], PF.y[i]]);
        if (platCrosses(v, PF.y[i])) { st.platformsDropped = (st.platformsDropped || 0) + 1; continue; } // el の線路の上を横切るホーム（データの誤り: 33 丁目の 190 m の帯）は作らない
        if (addPiece(v, { kind: 2, chain: chain++, cls: 0, flag: 4, tk: ec.platThick, mat: plMat })) st.platforms++;
      }
      st.columns = cols.length; st.beams = beams.length;
      st.maxSpan = Math.round(st.maxSpan * 10) / 10;
      for (const k of ['km', 'deckKm', 'roadDeckKm', 'solidKm', 'lowKm', 'embankKm']) st[k] = Math.round(st[k] * 100) / 100;
      // ---- _decks に足す（core の片の後ろ。eflag: 1 el、2 描かない、4 ホーム、8 口。tk = 厚さ、NaN = 既定。emat = _elMats の番号）
      this._decks = this._elDecks(D0, add);
      this._elColIndex(cols, beams, colG);
      tm.all = Math.round(now() - t0);
    }
    // el・口の数値（plan.rails.el / .portal に既定値を足す。_initEl と前もって作った表の読み込み _elLoad が同じ物を使う）
    _elCfgs() {
      const ec = this.elCfg = Object.assign({ width: 4.6, thick: 1.4, minY: 0.3, deckTol: 1, sample: 3, pieceMax: 20, solidClear: 3.5, minRun: 2,
        colStep: 15, colW: 1.2, colReach: 14, colLat: 1, colMerge: 3, colMinH: 0.5, colRoad: 0.4, colBld: 0.6, colTrack: 2.2, colEnt: 1,
        beamH: 0.9, beamW: 0.9, mat: 'curb', colMat: 'curb', platThick: 1, platMat: 'sidewalk', spawnClear: 1.6, lowDeck: 2.2, carClear: 1,
        embankH: 4.5, roofEdge: 0.6, roofGap: 2, edgeMin: 1.2, edgeWall: 1, edgeDist: 6, colShift: [0, 4, -4, 7, -7], bentReach: 30, bentClear: 4.5, bentMin: 0.4, spanReport: 40 },
      (this.plan.rails && this.plan.rails.el) || {});
      const pc = this.portalCfg = Object.assign({ enabled: true, ramp: 60, ramps: [60, 45, 30], stub: 40, depth: 6, wall: 0.5, rail: 1.1, roof: 1, ceil: 0.15, minWidth: 6,
        mergeDeg: 15, mergeAlong: 15, mergeGap: 2, sample: 3, deckClear: 5, mat: 'curb', stubMat: 'tunnelDark', floorMat: 'gravel_roof', stubFloorMat: 'tunnelDark', floorT: 1, coverMargin: 1, coverHead: 2.2, coverGrade: 0.35, openMin: 8, coverFlat: 5,
        cwMargin: 0.3, alongCos: 0.8, shrinkMax: 2, minInner: 4.4, backMax: 30, termLen: 15, termMin: 8, termGap: 1.5, termT: 0.6, termH: 1, grateH: 0.03, mouthClear: 0.5, mouthBack: 100, stopNear: 3, skipNear: 15, stopW: 3.2, mouthW: 4.2, mouthH: 4.6, mouthFrame: 0.6 },
      (this.plan.rails && this.plan.rails.portal) || {});
      return { ec, pc };
    }
    _ucCfg(ec) {
      return this.underCfg = Object.assign({ enabled: true, clrMin: 3, clrTarget: 4, slabMin: 0.5, margin: 1, step: 1, gap: 2.5, grade: 0.05, gradeMax: 0.25, coreIn: 0.5, edge: 0.25, pierRoad: 0.05, nearRoad: 8, spanMax: 38,
        levelY: 0.6, levelTop: 0.25, levelGrade: 0.25, levelReach: 60, join: 1.5, joinDy: 0.6, classMax: 12, pad: 0.5, fineTol: 0.05 }, ec.under || {});
    }
    // 道を渡る所の高さの変え方（_elUnder の成分 o）: y' = min(max(y, max_U (T − g·d)), min_L (levelTop + gw·d、d ≤ levelReach))
    _yAdj(o, x, z, y) {
      if (!o || x < o.bb[0] || x > o.bb[2] || z < o.bb[1] || z > o.bb[3]) return y;
      const uc = this.underCfg;
      let v = y;
      for (const u of o.U) { if (u.T - o.g * Math.max(0, Math.max(u.bb[0] - x, x - u.bb[2], u.bb[1] - z, z - u.bb[3])) <= v) continue; v = Math.max(v, u.T - o.g * elPtDist(u, x, z)); }
      for (const l of o.Lv) {
        const db = Math.max(0, l.bb[0] - x, x - l.bb[2], l.bb[1] - z, z - l.bb[3]);
        if (db > uc.levelReach || l.T + o.gw * db >= v) continue;
        const d = elPtDist(l, x, z); if (d <= uc.levelReach) v = Math.min(v, l.T + o.gw * d);
      }
      return v;
    }
    _elPitGrid() {
      if (this._portals.length) { // 口の地面の穴の格子（64 m のセル → 口の番号 + 1。重なれば 255 = 全部見る）
        const PC = 64, PW = Math.ceil((this.maxX - this.minX) / PC), PH = Math.ceil((this.maxZ - this.minZ) / PC), g = new Uint8Array(PW * PH); // 19 KB = キャッシュに乗る（groundAt の速さ）
        this._portals.forEach((o, k) => {
          for (let j = Math.max(0, Math.floor((o.bb[1] - this.minZ) / PC)); j <= Math.min(PH - 1, Math.floor((o.bb[3] - this.minZ) / PC)); j++)
            for (let i = Math.max(0, Math.floor((o.bb[0] - this.minX) / PC)); i <= Math.min(PW - 1, Math.floor((o.bb[2] - this.minX) / PC)); i++) g[j * PW + i] = g[j * PW + i] || k >= 254 ? 255 : k + 1;
        });
        this._pitGrid = { cell: PC, W: PW, H: PH, g };
      }
    }
    // el の線の区間の索引（32 m のセル、colTrack + 1 m）と el のまわりのセルの印（_elNear）
    _elGrids(ec) {
      const GC = 32, GW = Math.ceil((this.maxX - this.minX) / GC) + 1;
      const gk = (x, z) => Math.floor((x - this.minX) / GC) + Math.floor((z - this.minZ) / GC) * GW;
      const putSeg = (map, ax, az, bx, bz, m, item) => {
        const i0 = Math.floor((Math.min(ax, bx) - m - this.minX) / GC), i1 = Math.floor((Math.max(ax, bx) + m - this.minX) / GC);
        const j0 = Math.floor((Math.min(az, bz) - m - this.minZ) / GC), j1 = Math.floor((Math.max(az, bz) + m - this.minZ) / GC);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = i + j * GW;
          if (map instanceof Set) { map.add(k); continue; }
          let a = map.get(k); if (!a) map.set(k, a = []); a.push(item);
        }
      };
      const Ls = this.core.rlel.lines, elG = new Map();
      for (let i = 0; i < Ls.count; i++) for (let v = Ls.vertStart[i]; v + 1 < Ls.vertStart[i + 1]; v++) putSeg(elG, Ls.xz[v * 2], Ls.xz[v * 2 + 1], Ls.xz[v * 2 + 2], Ls.xz[v * 2 + 3], ec.colTrack + 1, i * 65536 + v);
      // 地上の車道の区間（el の線のまわりのセルだけ。値 = 道の番号 · 65536 + 頂点）
      // el の線（床の作られうる線 = y ≥ minY の頂点がある線）のまわりのセル（32 m）の印。道の区間はこのセルにかかる物だけ入れる
      const GH = Math.ceil((this.maxZ - this.minZ) / GC) + 1, near = new Uint8Array(GW * GH);
      const nr = ec.colReach + ec.width + 2;
      for (let i = 0; i < Ls.count; i++) {
        let up = false;
        for (let v = Ls.vertStart[i]; v < Ls.vertStart[i + 1] && !up; v++) up = Ls.y[v] >= ec.minY;
        if (!up) continue;
        for (let v = Ls.vertStart[i]; v + 1 < Ls.vertStart[i + 1]; v++) {
          const ax = Ls.xz[v * 2], az = Ls.xz[v * 2 + 1], bx = Ls.xz[v * 2 + 2], bz = Ls.xz[v * 2 + 3];
          const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - nr - this.minX) / GC)), i1 = Math.min(GW - 1, Math.floor((Math.max(ax, bx) + nr - this.minX) / GC));
          const j0 = Math.max(0, Math.floor((Math.min(az, bz) - nr - this.minZ) / GC)), j1 = Math.min(GH - 1, Math.floor((Math.max(az, bz) + nr - this.minZ) / GC));
          for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) near[ii + jj * GW] = 1;
        }
      }
      this._elNear = { cell: GC, W: GW, H: GH, g: near }; // _elSpawns も使う
      return { GC, GW, GH, gk, putSeg, elG, near };
    }
    // core の床 D0 の後ろに el の片 add（{ v: [[x, z, y] …], pl, kind, chain, seq, cls, flag, tk, mat }）を足した床
    _elDecks(D0, add) {
      const n0 = D0.count;
      const n = n0 + add.length;
      let nv = D0.y.length;
      for (const q of add) nv += q.v.length;
      const D = {
        count: n, vertStart: new Uint32Array(n + 1), xz: new Float64Array(nv * 2), y: new Float64Array(nv), plane: new Float64Array(n * 3),
        chain: new Uint32Array(n), seq: new Uint16Array(n), kind: new Uint8Array(n), cls: new Uint8Array(n), rds: new Uint32Array(n), link: new Uint8Array(n),
        eflag: new Uint8Array(n), tk: new Float32Array(n).fill(NaN), emat: new Uint8Array(n), thickness: D0.thickness, links: D0.links || 0, elStart: n0
      };
      D.vertStart.set(D0.vertStart); D.xz.set(D0.xz); D.y.set(D0.y); D.plane.set(D0.plane);
      D.chain.set(D0.chain); D.seq.set(D0.seq); D.kind.set(D0.kind); D.cls.set(D0.cls); D.rds.set(D0.rds);
      if (D0.link) D.link.set(D0.link);
      let vv = D0.y.length;
      add.forEach((q, k) => {
        const i = n0 + k;
        for (const p of q.v) { D.xz[vv * 2] = p[0]; D.xz[vv * 2 + 1] = p[1]; D.y[vv] = p[2]; vv++; }
        D.vertStart[i + 1] = vv;
        D.plane[i * 3] = q.pl[0]; D.plane[i * 3 + 1] = q.pl[1]; D.plane[i * 3 + 2] = q.pl[2];
        D.chain[i] = q.chain; D.seq[i] = Math.min(65535, q.seq); D.kind[i] = q.kind; D.cls[i] = q.cls; D.rds[i] = 0xFFFFFFFF;
        D.eflag[i] = q.flag; D.tk[i] = q.tk; D.emat[i] = q.mat;
      });
      return D;
    }
    // 柱と梁の索引（_elCols）。colG（8 m のセル → 柱）が無ければ作る（_elLoad）
    _elColIndex(cols, beams, colG) {
      const CW = this._elColW = Math.ceil((this.maxX - this.minX) / 8) + 4;
      if (!colG) {
        colG = new Map();
        for (const c of cols) { const key = Math.floor((c.x - this.minX) / 8) + Math.floor((c.z - this.minZ) / 8) * CW; let g = colG.get(key); if (!g) colG.set(key, g = []); g.push(c); }
      }
      // 柱と梁をチャンクごとに（柱は中心、梁は真ん中のチャンク）
      const byChunk = new Map();
      const slot = (x, z) => { const ci = this._ci(x, z); if (ci < 0) return null; let s = byChunk.get(ci); if (!s) byChunk.set(ci, s = { cols: [], beams: [] }); return s; };
      for (const c of cols) { const s = slot(c.x, c.z); if (s) s.cols.push(c); }
      for (const b of beams) { const r = b.ring, s = slot((r[0] + r[4]) / 2, (r[1] + r[5]) / 2); if (s) s.beams.push(b); }
      const cb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const c of cols) { cb[0] = Math.min(cb[0], c.x); cb[1] = Math.min(cb[1], c.z); cb[2] = Math.max(cb[2], c.x); cb[3] = Math.max(cb[3], c.z); }
      this._elCols = { cols, beams, byChunk, grid: colG, bb: cb };
    }
    // ===== 前もって作った el の表（assets/levels/nyc/elcache.json = opts.elCache。tools/nyc/elcache.js が _elSave で作る、--check が _initEl と同じか見る）=====
    //   Node のサーバー・道具・アプリ（lazy）・Worker（束ねる）の起動の _initEl（Node 40〜50 ms、Worker 約 0.1〜0.2 秒）を省く。鍵 = GEN_VERSION +
    //   EL_CACHE_VERSION + core の sha + プラン（manhattan.json）（_elKey）。鍵が合わなければその場で作る（同じ答え）。クラスのソースは鍵に入れない
    //   （esbuild が書き直したソースでは鍵が合わず、Worker が表を使えなかった。NC3 の直し 6）: _initEl とその下（_elUnder・_portal*・_elCfgs …）の
    //   答えを変えたら EL_CACHE_VERSION を上げて node tools/nyc/elcache.js で作り直す。忘れると elcache.js --check（npm run test:city・
    //   deploy-server.yml）が「stale」で落ちる（その場で作り直した表とファイルを比べる）。表: { v: 1, key, stats, mats, chain0, sites, skips, hide, cuts, portals, cross, comps, lineAdj,
    //   adjBB, add: [[頂点 x,z,y…, A, B, C, chain, seq, kind, cls, flag, tk, mat] …], cols, beams }
    _elKey() {
      const fnv = (str, h) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
      let h = fnv(String(CityGenNyc.GEN_VERSION) + '|' + String(CityGenNyc.EL_CACHE_VERSION) + '|' + String(this.meta && this.meta.core && this.meta.core.sha) + '|', 0x811c9dc5 >>> 0);
      h = fnv(JSON.stringify(this.plan), h);
      return ('0000000' + h.toString(16)).slice(-8);
    }
    _elSave() {
      const D = this._decks, n0 = D.elStart, add = [], cross = this._elCross || [];
      for (let i = n0; i < D.count; i++) {
        const v = [];
        for (let k = D.vertStart[i]; k < D.vertStart[i + 1]; k++) v.push(D.xz[k * 2], D.xz[k * 2 + 1], D.y[k]);
        add.push([v, D.plane[i * 3], D.plane[i * 3 + 1], D.plane[i * 3 + 2], D.chain[i], D.seq[i], D.kind[i], D.cls[i], D.eflag[i], D.tk[i], D.emat[i]]);
      }
      const comps = this._elCompList || [], A = this._elAdj;
      const stats = Object.assign({}, this.elStats); delete stats.ms; delete stats.spawnsDropped;
      return {
        v: 1, key: this._elKey(), stats, mats: this._elMats, chain0: this._elChain0, sites: this._portalSites, skips: this._portalSkips, hide: this._railHide, cuts: this._elCutN >= 0 ? this._cuts.slice(0, this._elCutN) : this._cuts,
        portals: this._portals, cross, comps: comps.map((o) => ({ id: o.id, g: o.g, gw: o.gw, bb: o.bb, U: o.U.map((c) => cross.indexOf(c)), Lv: o.Lv.map((c) => cross.indexOf(c)) })),
        lineAdj: A ? A.lineAdj.map((o) => (o ? comps.indexOf(o) : -1)) : null, adjBB: A ? A.bb : null, add, cols: this._elCols.cols, beams: this._elCols.beams
      };
    }
    _elLoad(C) {
      const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const { ec } = this._elCfgs();
      this._ucCfg(ec);
      const st = this.elStats = Object.assign({}, C.stats);
      this._elMats = C.mats.slice(); this._elChain0 = C.chain0;
      for (const o of C.sites) this._portalSites.push(o);
      for (const o of C.skips) this._portalSkips.push(o);
      for (const o of C.hide) this._railHide.push(o);
      for (const o of C.cuts) this._cuts.push(o);
      for (const o of C.portals) this._portals.push(o);
      this._elPitGrid();
      const { gk, elG } = this._elGrids(ec);
      const cross = this._elCross = C.cross;
      const comps = C.comps.map((o) => ({ id: o.id, g: o.g, gw: o.gw, bb: o.bb, U: o.U.map((k) => cross[k]), Lv: o.Lv.map((k) => cross[k]) }));
      this._elCompList = comps;
      this._elAdj = C.lineAdj && comps.length ? { lineAdj: C.lineAdj.map((k) => (k < 0 ? null : comps[k])), yAdj: (o, x, z, y) => this._yAdj(o, x, z, y), elG, gk, bb: C.adjBB } : null;
      const add = new Array(C.add.length);
      for (let k = 0; k < C.add.length; k++) {
        const a = C.add[k], f = a[0], v = new Array(f.length / 3);
        for (let j = 0; j < v.length; j++) v[j] = [f[j * 3], f[j * 3 + 1], f[j * 3 + 2]];
        add[k] = { v, pl: [a[1], a[2], a[3]], chain: a[4], seq: a[5], kind: a[6], cls: a[7], flag: a[8], tk: a[9], mat: a[10] };
      }
      this._decks = this._elDecks(this._decks, add);
      this._elColIndex(C.cols, C.beams, null);
      st.ms = { cache: Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0) };
    }
    // 道を渡る所（_initEl の under）で上げ下げした el の線路の高さ: (x, z) から 1.5 m 以内・高さ 0.8 m 以内の el の線（core RLEL）があれば
    //   その成分の高さの変え方（床の片と同じ式）、無ければ y のまま。タイルの線路（_railRuns）が使う
    _elAdjAt(x, z, y) {
      const A = this._elAdj;
      if (!A || x < A.bb[0] || x > A.bb[2] || z < A.bb[1] || z > A.bb[3]) return y;
      const a = A.elG.get(A.gk(x, z));
      if (!a) return y;
      const Ls = this.core.rlel.lines;
      let best = null, bd = 2.25;
      for (let n = 0; n < a.length; n++) {
        const i = Math.floor(a[n] / 65536), v = a[n] % 65536;
        if (!A.lineAdj[i]) continue;
        const ax = Ls.xz[v * 2], az = Ls.xz[v * 2 + 1], dx = Ls.xz[v * 2 + 2] - ax, dz = Ls.xz[v * 2 + 3] - az, L2 = dx * dx + dz * dz;
        let u = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = ax + dx * u - x, qz = az + dz * u - z, d2 = qx * qx + qz * qz;
        if (d2 >= bd || Math.abs(Ls.y[v] + (Ls.y[v + 1] - Ls.y[v]) * u - y) > 0.8) continue;
        bd = d2; best = A.lineAdj[i];
      }
      return best ? A.yAdj(best, x, z, y) : y;
    }
    // ---- 道をふさがない（_initEl の一部。関数を分けた = _initEl が大きくなると V8 の最適化が外れて柱・道の格子の組み立てが 10 ms 遅くなった）
    _elUnder(ec, Ls, Rd, roadG, gk, elG, roadDeckAt, st) {
      // 道をふさがない（NC3 の直し 2。決めたこと: 地図の道はどれもふさがない）: el の床の下面が embankH m より低い所（盛り土）の幅が地上の
      //   車道（道の種類 1..classMax、|y| ≤ 1）の車線（縁石 + margin m）にかかる所は、そこを床の板（厚さ slabMin〜thick）だけで渡す（両側の盛り土の端 = 橋台）。
      //   板の下が clrMin m に届かなければ線路をそこだけ上げる（raise: 上面 clrMin + slabMin、斜面は grade、成分（つながった線）の固定端（ほかの el の線に
      //   つながらない端）・踏切に間に合わなければ gradeMax までの一番緩い勾配）。上げられない所（データの高さが levelY m 未満 = 線が地面へ下りきる所、
      //   gradeMax でも間に合わない）は踏切（level: 車線の所で線路を地面（levelTop）まで下げ、levelGrade の勾配で元の高さへ）。
      //   高さの変え方は (x, z) と元の高さ y だけの関数（_elAdjAt。タイルの線路の描き方も同じ）= 線のつなぎ目で切れない。elStats.crossings / under
      const uc = this._ucCfg(ec);
      const LN = []; // 線ごと { X, Z, Y, S, tot }
      for (let i = 0; i < Ls.count; i++) {
        const a = Ls.vertStart[i], n = Ls.vertStart[i + 1] - a;
        const X = new Float64Array(n), Z = new Float64Array(n), Y = new Float64Array(n), S = new Float64Array(n);
        for (let k = 0; k < n; k++) { X[k] = Ls.xz[(a + k) * 2]; Z[k] = Ls.xz[(a + k) * 2 + 1]; Y[k] = Ls.y[a + k]; if (k) S[k] = S[k - 1] + Math.hypot(X[k] - X[k - 1], Z[k] - Z[k - 1]); }
        LN.push({ X, Z, Y, S, n, tot: n ? S[n - 1] : 0 });
      }
      const atL = (L, s) => { // → [x, z, y, 区間]
        let lo = 0, hi = L.n - 2;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L.S[m] <= s) lo = m; else hi = m - 1; }
        const k = lo, d = L.S[k + 1] - L.S[k], u = d > 1e-9 ? Math.min(1, Math.max(0, (s - L.S[k]) / d)) : 0;
        return [L.X[k] + (L.X[k + 1] - L.X[k]) * u, L.Z[k] + (L.Z[k + 1] - L.Z[k]) * u, L.Y[k] + (L.Y[k + 1] - L.Y[k]) * u, k];
      };
      // 成分（端どうしが join m・高さ joinDy m 以内でつながった線）と固定端（ほかの線につながらない端）
      const compOf = new Int32Array(Ls.count);
      for (let i = 0; i < Ls.count; i++) compOf[i] = i;
      const find = (i) => { while (compOf[i] !== i) { compOf[i] = compOf[compOf[i]]; i = compOf[i]; } return i; };
      const endG = new Map(), EG = 8;
      const endKey = (x, z) => Math.floor(x / EG) + ',' + Math.floor(z / EG);
      const endList = [];
      for (let i = 0; i < Ls.count; i++) {
        const L = LN[i];
        if (L.n < 2) continue;
        for (const k of [0, L.n - 1]) { const e = { i, x: L.X[k], z: L.Z[k], y: L.Y[k], joined: false }; endList.push(e); const key = endKey(e.x, e.z); let a = endG.get(key); if (!a) endG.set(key, a = []); a.push(e); }
      }
      for (const e of endList) {
        const gx = Math.floor(e.x / EG), gz = Math.floor(e.z / EG);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const f of endG.get((gx + dx) + ',' + (gz + dz)) || []) {
          if (f === e || f.i === e.i || Math.hypot(f.x - e.x, f.z - e.z) > uc.join || Math.abs(f.y - e.y) > uc.joinDy) continue;
          e.joined = true;
          const ra = find(e.i), rb = find(f.i);
          if (ra !== rb) compOf[Math.max(ra, rb)] = Math.min(ra, rb);
        }
      }
      for (let i = 0; i < Ls.count; i++) compOf[i] = find(i);
      // 渡る所を探す（step m ごと。床の作られうる所 = minY 以上・データの床の上でない・建物の中でない・下面が embankH より低い）:
      //   道の中心線が床の幅（+ coreIn m）の中を通る点（core）の区間 ± (縁石までの幅 + margin) / sin（斜めに渡るほど長く）。並んだ線路（同じ道の
      //   core から nearRoad m 以内で床が車線（縁石 + edge）にかかる点）も同じように渡す
      const crossings = [], hw0 = ec.width / 2, touch = [];
      if (uc.enabled !== false && Rd) for (let i = 0; i < Ls.count; i++) {
        const L = LN[i];
        if (L.n < 2 || L.tot < ec.minRun) continue;
        let up = false;
        for (let k = 0; k < L.n && !up; k++) up = L.Y[k] >= ec.minY;
        if (!up) continue;
        const open = new Map(); // 道 → { i, r, ss: [s], xs: [x, z], core: [s], sin }
        let k2 = 0;
        for (let s = 0; s <= L.tot + 1e-6; s += uc.step) {
          const sc = Math.min(s, L.tot);
          while (k2 < L.n - 2 && L.S[k2 + 1] < sc) k2++;
          // 区間の両端とも床の高さの外（minY より下・下面が embankH 以上）なら見ない（高さは区間の中でまっすぐ）
          const ya = L.Y[k2], yb = L.Y[k2 + 1];
          if ((ya < ec.minY && yb < ec.minY) || (Math.min(ya, yb) - ec.thick >= ec.embankH)) {
            if (open.size) for (const [r, o] of open) if (s - o.ss[o.ss.length - 1] > uc.gap) { open.delete(r); touch.push(o); }
            continue;
          }
          const sd = L.S[k2 + 1] - L.S[k2], uu = sd > 1e-9 ? Math.min(1, Math.max(0, (sc - L.S[k2]) / sd)) : 0;
          const p = [L.X[k2] + (L.X[k2 + 1] - L.X[k2]) * uu, L.Z[k2] + (L.Z[k2 + 1] - L.Z[k2]) * uu, ya + (yb - ya) * uu, k2];
          const dx = L.X[k2 + 1] - L.X[k2], dz = L.Z[k2 + 1] - L.Z[k2], Ld = Math.hypot(dx, dz) || 1, nx = -dz / Ld, nz = dx / Ld;
          let hits = null;
          if (p[2] >= ec.minY && p[2] - ec.thick < ec.embankH) {
            for (const o of [0, hw0, -hw0]) {
              const fx = p[0] + nx * o, fz = p[1] + nz * o, a = roadG.get(gk(fx, fz));
              if (a) for (let m = 0; m < a.length; m++) {
                const r = Math.floor(a[m] / 65536), v = a[m] % 65536;
                if (!(Rd.cls[r] >= 1 && Rd.cls[r] <= uc.classMax)) continue;
                const ax = Rd.xz[v * 2], az = Rd.xz[v * 2 + 1], bx = Rd.xz[v * 2 + 2], bz = Rd.xz[v * 2 + 3], d2 = segDist2(fx, fz, ax, az, bx, bz);
                const lim = Math.max(Rd.curbL[r], Rd.curbR[r]) + uc.edge;
                let h = hits && hits.get(r);
                if (d2 < lim * lim && !h) { if (!hits) hits = new Map(); hits.set(r, h = { core: false, sin: 1 }); }
                if (!o && d2 < (hw0 + uc.coreIn) * (hw0 + uc.coreIn)) { // 道の中心線が床の中
                  if (!h) { if (!hits) hits = new Map(); hits.set(r, h = { core: false, sin: 1 }); }
                  h.core = true; h.sin = Math.min(h.sin, Math.abs(nx * (bx - ax) + nz * (bz - az)) / (Math.hypot(bx - ax, bz - az) || 1));
                }
              }
            }
            if (hits && (roadDeckAt(p[0], p[1], p[2]) || this._pieceIn(p[0], p[1], p[2] - ec.thick, p[2] + ec.solidClear))) hits = null;
          }
          for (const [r, o] of open) if ((!hits || !hits.has(r)) && s - o.ss[o.ss.length - 1] > uc.gap) { open.delete(r); touch.push(o); }
          if (hits) for (const [r, h] of hits) {
            let o = open.get(r);
            if (!o) open.set(r, o = { i, r, ss: [], xs: [], core: [], sin: 1 });
            o.ss.push(s); o.xs.push(p[0], p[1]);
            if (h.core) { o.core.push(s); o.sin = Math.min(o.sin, h.sin); }
          }
        }
        for (const [, o] of open) touch.push(o);
      }
      const mk = (o, a, b, sin) => { // 区間 [a, b]（core の点）→ 渡る所
        const L = LN[o.i], m = (Math.max(Rd.curbL[o.r], Rd.curbR[o.r]) + uc.margin) / Math.max(0.5, sin);
        const u0 = Math.max(0, a - m), u1 = Math.min(L.tot, b + m), pts = [];
        let ymin = Infinity;
        for (let s = u0, k = 0; s <= u1 + 1e-6; s += uc.step, k++) { const p = atL(L, Math.min(s, u1)); if (k % 4 === 0) pts.push(p[0], p[1]); ymin = Math.min(ymin, p[2]); }
        const q = atL(L, u1); pts.push(q[0], q[1]); ymin = Math.min(ymin, q[2]);
        const cw = Math.max(Rd.curbL[o.r], Rd.curbR[o.r]) / Math.max(0.5, sin);
        return { i: o.i, r: o.r, cls: Rd.cls[o.r], u0, u1, ca: a - cw, cb: b + cw, ymin, pts, comp: compOf[o.i], sin };
      };
      const cores = [];
      for (const o of touch) if (o.core.length) {
        // core の点の塊ごと（gap m より離れていれば別の渡る所）
        let a = o.core[0], b = a;
        for (let k = 1; k <= o.core.length; k++) {
          if (k < o.core.length && o.core[k] - b <= uc.gap) { b = o.core[k]; continue; }
          cores.push(mk(o, a, b, o.sin));
          if (k < o.core.length) a = b = o.core[k];
        }
      }
      for (const c of cores) crossings.push(c);
      for (const o of touch) { // 並んだ線路: 同じ道の core の渡る所から nearRoad m 以内の点
        if (o.core.length) continue;
        let a = Infinity, b = -Infinity, sin = 1;
        for (const c of cores) {
          if (c.r !== o.r || c.i === o.i) continue;
          for (let k = 0; k < o.ss.length; k++) {
            const x = o.xs[k * 2], z = o.xs[k * 2 + 1];
            let near = false;
            for (let q = 0; q < c.pts.length && !near; q += 2) near = (c.pts[q] - x) * (c.pts[q] - x) + (c.pts[q + 1] - z) * (c.pts[q + 1] - z) < uc.nearRoad * uc.nearRoad;
            if (near) { a = Math.min(a, o.ss[k]); b = Math.max(b, o.ss[k]); sin = Math.min(sin, c.sin); }
          }
        }
        if (a <= b) crossings.push(mk(o, a, b, sin));
      }
      const slabFor = (y) => Math.min(ec.thick, Math.max(uc.slabMin, y - uc.clrTarget));
      for (const c of crossings) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = 0; k < c.pts.length; k += 2) { x0 = Math.min(x0, c.pts[k]); x1 = Math.max(x1, c.pts[k]); z0 = Math.min(z0, c.pts[k + 1]); z1 = Math.max(z1, c.pts[k + 1]); }
        c.bb = [x0, z0, x1, z1];
        c.kind = c.u1 - c.u0 + 2 * uc.pad > uc.spanMax ? 'level' : c.ymin - slabFor(c.ymin) >= uc.clrMin - 1e-6 ? 'under' : c.ymin < uc.levelY ? 'level' : 'raise';
        if (c.kind === 'level' && c.u1 - c.u0 + 2 * uc.pad > uc.spanMax) c.why = 'long ' + Math.round(c.u1 - c.u0) + ' m';
        c.T = c.kind === 'raise' ? uc.clrMin + uc.slabMin : c.kind === 'level' ? uc.levelTop : 0;
      }
      const ptDist = elPtDist; // 点 → 渡る所の線
      const cDist = (c, e) => { let d = Infinity; for (let k = 0; k < e.pts.length; k += 2) d = Math.min(d, ptDist(c, e.pts[k], e.pts[k + 1])); return d; };
      // 成分ごとに勾配を決める（raise の上面から固定端・踏切まで）。gradeMax でも間に合わない raise は踏切にする
      const comps = new Map();
      for (const c of crossings) if (c.kind !== 'under') { let o = comps.get(c.comp); if (!o) comps.set(c.comp, o = { id: c.comp, U: [], Lv: [], g: uc.grade, gw: uc.levelGrade, ends: [] }); }
      for (const e of endList) if (!e.joined && comps.has(compOf[e.i])) comps.get(compOf[e.i]).ends.push(e);
      for (const [, o] of comps) {
        const mine = crossings.filter((c) => c.comp === o.id && c.kind !== 'under');
        for (let it = 0; it < 64; it++) {
          const U = mine.filter((c) => c.kind === 'raise'), Lv = mine.filter((c) => c.kind === 'level');
          let need = uc.grade, worst = null, wv = 0;
          for (const u of U) {
            let req = 0;
            for (const e of o.ends) req = Math.max(req, (u.T - e.y) / Math.max(0.01, ptDist(u, e.x, e.z)));
            for (const l of Lv) req = Math.max(req, (u.T - l.T) / Math.max(0.01, cDist(u, l)));
            if (req > need) need = req;
            if (req > uc.gradeMax && req > wv) { wv = req; worst = u; }
          }
          if (!worst) { o.g = need; break; }
          worst.kind = 'level'; worst.T = uc.levelTop; worst.why = 'grade ' + Math.round(wv * 100) + '%';
        }
        o.U = mine.filter((c) => c.kind === 'raise'); o.Lv = mine.filter((c) => c.kind === 'level');
        o.gw = Math.max(o.g, uc.levelGrade);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const c of mine) { x0 = Math.min(x0, c.bb[0]); z0 = Math.min(z0, c.bb[1]); x1 = Math.max(x1, c.bb[2]); z1 = Math.max(z1, c.bb[3]); }
        const r = Math.max(uc.levelReach, (uc.clrMin + uc.slabMin) / o.g);
        o.bb = [x0 - r, z0 - r, x1 + r, z1 + r];
      }
      // 高さの変え方: y' = min(max(y, max_U (T − g·d)), min_L (levelTop + gw·d、d ≤ levelReach))
      const yAdj = (o, x, z, y) => this._yAdj(o, x, z, y);
      const lineAdj = new Array(Ls.count).fill(null);
      for (let i = 0; i < Ls.count; i++) lineAdj[i] = comps.get(compOf[i]) || null;
      this._elAdj = comps.size ? { lineAdj, yAdj, elG, gk, bb: [...comps.values()].reduce((b, o) => [Math.min(b[0], o.bb[0]), Math.min(b[1], o.bb[1]), Math.max(b[2], o.bb[2]), Math.max(b[3], o.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]) } : null;
      // 線ごとの板の区間（under / raise の [u0 − pad, u1 + pad]）
      const underOf = new Array(Ls.count).fill(null);
      for (const c of crossings) if (c.kind !== 'level') (underOf[c.i] || (underOf[c.i] = [])).push(c);
      st.under = { crossings: crossings.length, under: 0, raise: 0, level: 0, grades: [] };
      st.crossings = crossings;
      for (const [, o] of comps) if (o.U.length) st.under.grades.push(Math.round(o.g * 1000) / 10);
      for (const c of crossings) {
        const L = LN[c.i];
        let ya0 = Infinity, rz = 0;
        for (let s = c.u0; s <= c.u1 + 1e-6; s += 0.5) { const p = atL(L, s), ya = yAdj(lineAdj[c.i], p[0], p[1], p[2]); ya0 = Math.min(ya0, ya); rz = Math.max(rz, ya - p[2]); }
        c.y1 = ya0; c.slab = slabFor(ya0); c.raise = rz;
        c.clr0 = c.ymin - ec.thick; c.clr = c.kind === 'level' ? null : ya0 - c.slab;
        st.under[c.kind]++;
      }
      this._elCross = crossings;
      st.crossings = crossings.map((c) => { const m = c.pts.length >> 2 << 1; return [Math.round(c.pts[m]), Math.round(c.pts[m + 1]), c.i, c.r, c.cls, c.kind, Math.round(c.ymin * 100) / 100, Math.round(c.clr0 * 100) / 100, c.clr == null ? null : Math.round(c.clr * 100) / 100, Math.round(c.raise * 100) / 100, Math.round((comps.get(c.comp) || { g: 0 }).g * 1000) / 10]; });
      this._elCompList = [...comps.values()]; // 前もって作る表（_elSave）
      return { LN, atL, lineAdj, yAdj, underOf };
    }
    // 口 o の掘割を開ける所（NC3 の直し 3 / 4）。q = 口のまとまり（線路の幅 q.l0..q.l1）。地図の地上の道（RDS、上下 ±1 m）を口の座標 (s, l) の多角形にして:
    //   車道（種類 1..12）が掘割に沿う（|cos| ≥ alongCos）所は縁石の内側 + cwMargin m、横切る道（車道・歩く道・歩道）は縁石 + 歩道 + coverMargin m の帯。
    //   掘割に沿う歩道・歩く道は見ない。沿う車道の帯が掘割の端から shrinkMax m 以内なら、その側の幅を縮める（線路の幅は minInner m 以上）。
    //   残りの帯の s の区間は覆う。開ける区間 [a, b]: 口から奥 [0, ramp] の道の無い区間（openMin m 以上、床の勾配 coverGrade まで）の一番長いもの。
    //   無ければ口の前（s < 0、backMax m まで。blockAt で建物・水・ほかの口を、spawnIn で出現地点を避ける）の道の無い区間の、
    //   一番奥（道の手前）の termLen m（'termA': 線路は口の前の掘割から覆いの下へ）。それも無ければ全部覆う（'covered'。そこで終わる地上の線路は
    //   描画の層で道の手前に止め: _trackStops）
    _portalCover(o, q, Ltot, Rd, pc, blockAt, spawnIn) {
      const Lr = o.ramp, dep = pc.depth, mg = pc.coverMargin, hh = pc.roof + pc.ceil + pc.coverHead, gMax = pc.coverGrade, back = pc.backMax, cwm = pc.cwMargin, aC = pc.alongCos;
      const sLo = -back, polys = [];
      let qx0 = Infinity, qz0 = Infinity, qx1 = -Infinity, qz1 = -Infinity; // 口の囲い（口の前も）の外接矩形
      for (const sv of [sLo, Ltot]) for (const lv of [o.l0, o.l1]) { const x = o.ox + o.ux * sv + o.vx * lv, z = o.oz + o.uz * sv + o.vz * lv; if (x < qx0) qx0 = x; if (x > qx1) qx1 = x; if (z < qz0) qz0 = z; if (z > qz1) qz1 = z; }
      let RB = this._rdBB; // 道ごとの外接矩形（縁石 + 歩道を広げた。最初の口で 1 回）
      if (Rd && !RB) {
        RB = this._rdBB = new Float32Array(Rd.count * 4);
        for (let r = 0; r < Rd.count; r++) {
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = Rd.vertStart[r]; v < Rd.vertStart[r + 1]; v++) { const x = Rd.xz[v * 2], z = Rd.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          const w = Math.max(Rd.curbL[r] + Rd.swL[r], Rd.curbR[r] + Rd.swR[r], 1) + 4;
          RB[r * 4] = x0 - w; RB[r * 4 + 1] = z0 - w; RB[r * 4 + 2] = x1 + w; RB[r * 4 + 3] = z1 + w;
        }
      }
      const clip = (poly, k, lim, sg) => {
        const nx = [];
        for (let i = 0; i < poly.length; i++) {
          const P = poly[i], Q = poly[(i + 1) % poly.length], dp = (P[k] - lim) * sg, dq = (Q[k] - lim) * sg;
          if (dp >= 0) nx.push(P);
          if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); nx.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
        }
        return nx;
      };
      if (Rd) for (let r = 0; r < Rd.count; r++) {
        if ((Rd.flags[r] & 35) || RB[r * 4] > qx1 || RB[r * 4 + 2] < qx0 || RB[r * 4 + 1] > qz1 || RB[r * 4 + 3] < qz0) continue; // 床の上・トンネル・橋・高架の道（roadscan と同じ）
        const car = Rd.cls[r] >= 1 && Rd.cls[r] <= 12;
        const wide = Math.max(Rd.curbL[r] + Rd.swL[r], Rd.curbR[r] + Rd.swR[r], 1) + mg;
        for (let v = Rd.vertStart[r]; v + 1 < Rd.vertStart[r + 1]; v++) {
          if (Math.abs(Rd.y[v]) > 1 && Math.abs(Rd.y[v + 1]) > 1) continue;
          let ax = Rd.xz[v * 2], az = Rd.xz[v * 2 + 1], bx = Rd.xz[v * 2 + 2], bz = Rd.xz[v * 2 + 3];
          if (Math.max(ax, bx) < qx0 - wide - 2 || Math.min(ax, bx) > qx1 + wide + 2 || Math.max(az, bz) < qz0 - wide - 2 || Math.min(az, bz) > qz1 + wide + 2) continue;
          const L = Math.hypot(bx - ax, bz - az);
          if (L < 1e-6) continue;
          const tx = (bx - ax) / L, tz = (bz - az) / L, along = Math.abs(tx * o.ux + tz * o.uz) >= aC;
          if (along && !car) continue; // 掘割に沿う歩く道
          let pl, pr; // 左（法線 (−tz, tx)）・右へ
          if (along) { pl = Rd.curbL[r] + cwm; pr = Rd.curbR[r] + cwm; } else { pl = Rd.curbL[r] + Rd.swL[r] + mg; pr = Rd.curbR[r] + Rd.swR[r] + mg; }
          if (pl + pr < 0.5) { pl = Math.max(pl, 0.5); pr = Math.max(pr, 0.5); }
          const ex = along ? cwm : Math.min(Math.max(pl, pr), 2);
          ax -= tx * ex; az -= tz * ex; bx += tx * ex; bz += tz * ex;
          let poly = [[ax - tz * pl, az + tx * pl], [bx - tz * pl, bz + tx * pl], [bx + tz * pr, bz - tx * pr], [ax + tz * pr, az - tx * pr]].map((p) => { const dx = p[0] - o.ox, dz = p[1] - o.oz; return [dx * o.ux + dz * o.uz, dx * o.vx + dz * o.vz]; });
          for (const [k, lim, sg] of [[1, o.l0, 1], [1, o.l1, -1], [0, sLo, 1], [0, Lr, -1]]) { poly = clip(poly, k, lim, sg); if (poly.length < 3) break; }
          if (poly.length < 3) continue;
          let lmin = Infinity, lmax = -Infinity;
          for (const p of poly) { if (p[1] < lmin) lmin = p[1]; if (p[1] > lmax) lmax = p[1]; }
          polys.push({ poly, along, lmin, lmax });
        }
      }
      // 地上の線路（core RLEL の線で両端が −0.3〜0.5 m の区間）が掘割の口から奥（s > 1）にかかる所も覆う（操車場の線路の下をトンネルが通る:
      //   サニーサイドの掘割が操車場の線路を切っていた。NC3 の直し 5）。幅は中心から ±railStrip m
      const RLs = this.core.rlel && this.core.rlel.lines, rs = pc.railStrip != null ? pc.railStrip : 1.8;
      if (RLs) for (let i = 0; i < RLs.count; i++) for (let v = RLs.vertStart[i]; v + 1 < RLs.vertStart[i + 1]; v++) {
        if (RLs.y[v] < -0.3 || RLs.y[v] > 0.5 || RLs.y[v + 1] < -0.3 || RLs.y[v + 1] > 0.5) continue;
        let ax = RLs.xz[v * 2], az = RLs.xz[v * 2 + 1], bx = RLs.xz[v * 2 + 2], bz = RLs.xz[v * 2 + 3];
        if (Math.max(ax, bx) < qx0 - rs - 2 || Math.min(ax, bx) > qx1 + rs + 2 || Math.max(az, bz) < qz0 - rs - 2 || Math.min(az, bz) > qz1 + rs + 2) continue;
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-6) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        ax -= tx * rs; az -= tz * rs; bx += tx * rs; bz += tz * rs;
        let poly = [[ax - tz * rs, az + tx * rs], [bx - tz * rs, bz + tx * rs], [bx + tz * rs, bz - tx * rs], [ax + tz * rs, az - tx * rs]].map((p) => { const dx = p[0] - o.ox, dz = p[1] - o.oz; return [dx * o.ux + dz * o.uz, dx * o.vx + dz * o.vz]; });
        for (const [k, lim, sg] of [[1, o.l0, 1], [1, o.l1, -1], [0, 1, 1], [0, Lr, -1]]) { poly = clip(poly, k, lim, sg); if (poly.length < 3) break; }
        if (poly.length < 3) continue;
        let lmin = Infinity, lmax = -Infinity;
        for (const p of poly) { if (p[1] < lmin) lmin = p[1]; if (p[1] > lmax) lmax = p[1]; }
        polys.push({ poly, along: false, lmin, lmax, rail: 1 });
      }
      // 沿う車道で幅を縮める（浅い順。その側の縮め shrinkMax m まで、線路の幅 minInner m 以上）
      let sh0 = 0, sh1 = 0;
      const cand = polys.filter((p) => p.along).map((p) => { const d1 = o.l1 - p.lmin, d0 = p.lmax - o.l0; return d1 <= d0 ? { p, side: 1, d: d1 } : { p, side: 0, d: d0 }; }).filter((c) => c.d <= pc.shrinkMax + 1e-9).sort((u, w) => u.d - w.d);
      for (const c of cand) {
        const n0 = c.side === 0 ? Math.max(sh0, c.d) : sh0, n1 = c.side === 1 ? Math.max(sh1, c.d) : sh1;
        if ((q.l1 - n1) - (q.l0 + n0) < pc.minInner - 1e-9) continue;
        sh0 = n0; sh1 = n1;
      }
      const B0 = o.l0 + sh0, B1 = o.l1 - sh1, iv = [];
      for (const p of polys) {
        let poly = clip(p.poly, 1, B0 + 1e-6, 1);
        if (poly.length >= 3) poly = clip(poly, 1, B1 - 1e-6, -1);
        if (poly.length < 3) continue;
        let s0 = Infinity, s1 = -Infinity;
        for (const pt of poly) { if (pt[0] < s0) s0 = pt[0]; if (pt[0] > s1) s1 = pt[0]; }
        iv.push([s0, s1, 0]);
      }
      const gapsOf = (L) => { // [s0, s1]: 区間の列 L（並べた）の間の空き（sLo..Lr）
        const out = [];
        let cur = sLo;
        for (const [s0, s1] of L) { if (s0 > cur) out.push([cur, Math.min(s0, Lr)]); cur = Math.max(cur, s1); if (cur >= Lr) break; }
        if (cur < Lr) out.push([cur, Lr]);
        return out;
      };
      iv.sort((u, w) => u[0] - w[0]);
      const gOf = (a, b) => Math.max(dep / Lr, dep / Math.max(1e-6, Ltot - pc.coverFlat - a), hh / Math.max(1e-6, b - a)); // 床は奥の壁の coverFlat m 手前までに −depth
      const kindOf = (a, b) => sh0 > 1e-6 && sh1 > 1e-6 ? 'median' : sh0 > 1e-6 || sh1 > 1e-6 ? 'side' : a > 1e-6 || b < Lr - 1e-6 ? 'shifted' : 'open';
      let best = null;
      for (const [ga, gb] of gapsOf(iv)) { // 口から奥（口の前の建物などは関係ない = 道の区間だけで決まる）
        const a = Math.max(0, ga), b = gb;
        if (b - a < pc.openMin) continue;
        const g = gOf(a, b);
        if (g > gMax + 1e-9) continue;
        if (!best || b - a > best.b - best.a) best = { kind: kindOf(a, b), a, b, g, sh0, sh1 };
      }
      if (best && best.a > 1e-6) { // 口の前 [0, a) の地面の線路（踏切）が車道の上を通るなら、口の前の掘割があればそちら（線路を車道の上に描かない）
        const T0 = q.l0 + sh0 + pc.mouthClear, T1 = q.l1 - sh1 - pc.mouthClear;
        const onRoad = polys.some((p) => {
          let poly = clip(p.poly, 0, 0, 1);
          if (poly.length >= 3) poly = clip(poly, 0, best.a, -1);
          if (poly.length >= 3) poly = clip(poly, 1, T0, 1);
          if (poly.length >= 3) poly = clip(poly, 1, T1, -1);
          return poly.length >= 3;
        });
        if (!onRoad) return best;
      } else if (best) return best;
      // 口の前の掘割（termA）: 口の前（s < 0）で掘割にできない所（1 m ごと）も除いた空きの、道の手前の termLen m。空きの終わり b と口の間に
      //   建物などが無いこと（覆いの下が地面の高さの道・地面だけ）
      const blk = [];
      for (let s = sLo; s < 0; s += 1) if (blockAt(s + 0.5)) blk.push([s, s + 1]);
      const all = iv.concat(blk).sort((u, w) => u[0] - w[0]), gaps = gapsOf(all);
      for (let k = gaps.length - 1; k >= 0; k--) {
        const [ga, gb] = gaps[k];
        if (ga >= 0 || blk.some((r) => r[1] > gb + 1e-6)) continue;
        const b = gb, Lmin = Math.max(pc.termMin, hh / gMax);
        let a = Math.max(ga, b - pc.termLen);
        while (b - a >= Lmin && spawnIn(a, Math.min(b, 0))) a += 1;
        if (b - a < Lmin - 1e-9) continue;
        const g = gOf(a, b);
        if (g > gMax + 1e-9) continue;
        return { kind: 'termA', a, b, g, sh0, sh1 };
      }
      if (best) return best;
      return { kind: 'covered' }; // 全部覆う（口を作らない。口の所で終わる線路は描画の層の止め: _trackStops）
    }
    // 点がトンネルの口の囲い o（_portals / _cuts の要素: 口の座標 s × l の矩形）から m m 以内か
    _inObb(o, x, z, m) {
      m = m || 0;
      const dx = x - o.ox, dz = z - o.oz, s = dx * o.ux + dz * o.uz, l = dx * o.vx + dz * o.vz;
      return s >= o.s0 - m && s <= o.s1 + m && l >= o.l0 - m && l <= o.l1 + m;
    }
    // 口の前の地面の所（トンネルの線を地面の線路として描く所）か: 1 = 口 o の s ∈ [0, a)・線路の幅 [il0, il1]（a > 0 = 道を覆って掘割を奥へずらした口）、
    //   2 = 口の囲いの前 s ∈ [−mouthBack, min(0, s0))（トンネルの線が口より前から始まる・地面の高さ・少し上の坂: レールの高さ y が [−0.05, air) の所。NC3 の直し 4）。
    //   ほかの口の囲い・線路を隠す所の中は 0
    _inMouth(x, z, y, air) {
      let r = 0;
      const back = this.portalCfg ? this.portalCfg.mouthBack : 100;
      for (const o of this._portals) {
        const dx = x - o.ox, dz = z - o.oz, s = dx * o.ux + dz * o.uz, l = dx * o.vx + dz * o.vz;
        if (l < o.il0 || l > o.il1) continue;
        if (o.a > 0 && s >= -0.5 && s < o.a) return 1;
        if (!r && s >= -back && s < Math.min(0, o.s0) && y != null && y >= -0.05 && y < air) r = 2;
      }
      if (r === 2) for (const o of this._portals) if (this._inObb(o, x, z, 0)) return 0;
      if (r === 2 && this._inHide(x, z)) return 0;
      return r;
    }
    // 地上の線路を描かない所（_railHide: 口の前の掘割のある口の囲い [a, s1]。そこの線路は _portalTracks が掘割・トンネルの床に描く）
    _inHide(x, z) {
      for (const h of this._railHide) if (x >= h.bb[0] - 1 && x <= h.bb[2] + 1 && z >= h.bb[1] - 1 && z <= h.bb[3] + 1 && this._inObb(h, x, z, 0)) return true;
      return false;
    }
    // 掘割（口の屋根の無い所）の中か（台・路面の印・小物・地面のメッシュを抜く）
    _inCut(x, z, m) {
      m = m || 0;
      for (const c of this._cuts) if (x >= c.bb[0] - m && x <= c.bb[2] + m && z >= c.bb[1] - m && z <= c.bb[3] + m && this._inObb(c, x, z, m)) return true;
      return false;
    }
    // 掘割の地面の穴（world.js の地面のメッシュの穴）: [Float32Array [x, z, …] 4 角, …]
    groundHoles() { return this._cuts.map((c) => new Float32Array(c.ring)); }
    // 点 (x, z) から m m 以内に el の柱があるか（駐車の車・小物・出現地点）
    _elColNear(x, z, m) {
      const E = this._elCols;
      if (!E) return false;
      const i0 = Math.floor((x - this.minX) / 8), j0 = Math.floor((z - this.minZ) / 8), r = Math.ceil((m + 1) / 8);
      if (x < E.bb[0] - m || x > E.bb[2] + m || z < E.bb[1] - m || z > E.bb[3] + m) return false;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        const a = E.grid.get(i + j * this._elColW);
        if (a) for (const c of a) {
          const dx = Math.max(0, Math.abs(x - c.x) - c.w / 2), dz = Math.max(0, Math.abs(z - c.z) - c.w / 2);
          if (dx * dx + dz * dz < m * m) return true;
        }
      }
      return false;
    }
    // 入れる建物（ENTB）の長方形から m m 以内か（_entChunk のまわり 3 × 3）
    _entRectAt(x, z, m) {
      const EN = this.core.entb, es = this._entChunk;
      if (!EN || !es) return false;
      const ci = this._ci(x, z);
      if (ci < 0) return false;
      const cx = ci % this.ncx, cz = (ci - cx) / this.ncx;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        if (!this._inRange(cx + a, cz + b)) continue;
        const k0 = (cz + b) * this.ncx + cx + a;
        for (let k = es.start[k0]; k < es.start[k0 + 1]; k++) {
          const r = es.items[k];
          if (x > EN.rect[r * 4] - m && x < EN.rect[r * 4 + 2] + m && z > EN.rect[r * 4 + 1] - m && z < EN.rect[r * 4 + 3] + m) return true;
        }
      }
      return false;
    }
    // 地上に立つ建物の片（下端 < 1 m、上端 > 0.5 m、消していない）の E の中か
    _groundPieceAt(x, z) { return this._pieceIn(x, z, 0.5, 1); }
    // 高さ y0〜y1 にかかる建物の片の E の中か（el の床を建物の中に置かない）
    _pieceIn(x, z, y0, y1, skipEnt) {
      const P = this.core.pieces, S = this.core.supi;
      const i = Math.floor((x - this.minX) / S.cell), j = Math.floor((z - this.minZ) / S.cell);
      if (i < 0 || j < 0 || i >= S.W || j >= S.H) return false;
      const c = j * S.W + i;
      for (let k = S.start[c]; k < S.start[c + 1]; k++) {
        const p = S.piece[k];
        if (this._sup[p] || P.y0[p] >= y1 || P.y1f[p] <= y0 || x < P.bbox[p * 4] || x > P.bbox[p * 4 + 2] || z < P.bbox[p * 4 + 1] || z > P.bbox[p * 4 + 3]) continue;
        if (skipEnt && this._entOf[p] >= 0 && this._entOn(this._entOf[p])) continue;
        if (NycData.pointIn(P, p, x, z)) return true;
      }
      return false;
    }
    // _pieceIn と同じだが、通り抜ける床の分（_spans: データの床が建物を通り抜ける所 = クイーンズボロ・プラザの駅の建物の el の高さ）は抜く（NC3 の直し 5:
    //   el の床が駅の建物の抜けの中で細くならない・消えない）
    _pieceInSpan(x, z, y0, y1) {
      const P = this.core.pieces, S = this.core.supi;
      const i = Math.floor((x - this.minX) / S.cell), j = Math.floor((z - this.minZ) / S.cell);
      if (i < 0 || j < 0 || i >= S.W || j >= S.H) return false;
      const c = j * S.W + i;
      for (let k = S.start[c]; k < S.start[c + 1]; k++) {
        const p = S.piece[k];
        if (this._sup[p] || P.y0[p] >= y1 || P.y1f[p] <= y0 || x < P.bbox[p * 4] || x > P.bbox[p * 4 + 2] || z < P.bbox[p * 4 + 1] || z > P.bbox[p * 4 + 3]) continue;
        if (this._gapOf(p)) { let hit = false; for (const sp of this._spans(p, P.y0[p], P.y1f[p])) if (sp[0] < y1 && sp[1] > y0) hit = true; if (!hit) continue; }
        if (NycData.pointIn(P, p, x, z)) return true;
      }
      return false;
    }
    // 下端が ytop より下の建物の片の E ⊕ (dev + m) の中か（柱を建物に立てない）
    _pieceNear(x, z, m, ytop) { // supi のセル（E ⊕ (dev + supPad) が触れる片）: m ≤ supPad + セルの余り … 隣のセルも見る
      const P = this.core.pieces, S = this.core.supi;
      const i0 = Math.floor((x - m - this.minX) / S.cell), i1 = Math.floor((x + m - this.minX) / S.cell);
      const j0 = Math.floor((z - m - this.minZ) / S.cell), j1 = Math.floor((z + m - this.minZ) / S.cell);
      for (let j = Math.max(0, j0); j <= Math.min(S.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(S.W - 1, i1); i++) {
        const c = j * S.W + i;
        for (let k = S.start[c]; k < S.start[c + 1]; k++) {
          const p = S.piece[k], d = P.dev[p] + m;
          if (this._sup[p] || P.y0[p] >= ytop || x < P.bbox[p * 4] - d || x > P.bbox[p * 4 + 2] + d || z < P.bbox[p * 4 + 1] - d || z > P.bbox[p * 4 + 3] + d) continue;
          if (this._nearPiece(p, x, z, d)) return true;
        }
      }
      return false;
    }
    // 出現地点（SPWN）のうち柱・口の囲い・低い el の床の下にあるもの（spawnPoints と歩道の落ちている物が飛ばす）
    _elSpawns() {
      const SP = this.core.spawns, ec = this.elCfg, D = this._decks;
      if (!SP || !SP.count) return;
      const bad = this._spawnBad = new Uint8Array(SP.count);
      const dk = this._deckCell, bb = this._deckBB;
      const eb = [Infinity, Infinity, -Infinity, -Infinity]; // el の床・柱・口の全部の外接矩形（ほとんどの点はこれで外れる）
      for (let q = D.elStart; q < D.count; q++) { eb[0] = Math.min(eb[0], bb[q * 4]); eb[1] = Math.min(eb[1], bb[q * 4 + 1]); eb[2] = Math.max(eb[2], bb[q * 4 + 2]); eb[3] = Math.max(eb[3], bb[q * 4 + 3]); }
      const E = this._elCols, mg = ec.colReach + ec.spawnClear + 2;
      if (E && E.cols.length) { eb[0] = Math.min(eb[0], E.bb[0] - mg); eb[1] = Math.min(eb[1], E.bb[1] - mg); eb[2] = Math.max(eb[2], E.bb[2] + mg); eb[3] = Math.max(eb[3], E.bb[3] + mg); }
      let n = 0;
      for (let i = 0; i < SP.count; i++) {
        const x = SP.xz[i * 2], z = SP.xz[i * 2 + 1];
        if (x < eb[0] - 2 || x > eb[2] + 2 || z < eb[1] - 2 || z > eb[3] + 2) continue;
        const NB = this._elNear, ni = Math.floor((x - this.minX) / NB.cell), nj = Math.floor((z - this.minZ) / NB.cell);
        if (!(ni >= 0 && nj >= 0 && ni < NB.W && nj < NB.H && NB.g[ni + nj * NB.W]) && !this._portalSites.some((o) => x > o.bb[0] - 2 && x < o.bb[2] + 2 && z > o.bb[1] - 2 && z < o.bb[3] + 2)) continue; // el の線から遠く口の中でもない（口の場所は全部覆った口も = 出現地点の一覧は口の覆い方で変わらない）
        let b = this._elColNear(x, z, ec.spawnClear);
        if (!b) for (const o of this._portalSites) if (this._inObb(o, x, z, 1.5)) { b = true; break; }
        if (!b) {
          const gi = Math.floor((x - this.minX) / dk.cell), gj = Math.floor((z - this.minZ) / dk.cell);
          if (gi >= 0 && gj >= 0 && gi < dk.W && gj < dk.H) {
            const k = gj * dk.W + gi;
            for (let m = dk.csr.start[k]; m < dk.csr.start[k + 1] && !b; m++) {
              const q = dk.csr.items[m];
              if (!(D.eflag[q] & 1) || x < bb[q * 4] - 0.6 || x > bb[q * 4 + 2] + 0.6 || z < bb[q * 4 + 1] - 0.6 || z > bb[q * 4 + 3] + 0.6) continue;
              const yb = D.plane[q * 3] * x + D.plane[q * 3 + 1] * z + D.plane[q * 3 + 2] - (D.tk[q] === D.tk[q] ? D.tk[q] : ec.thick);
              if (yb < this.curbH + ec.lowDeck && this._nearDeck(q, x, z, 0.6)) b = true;
            }
          }
        }
        if (!b && this._elCross) { // 道を渡る所（板の下・踏切の線路の上: NC3 の直し 2）にも出さない
          const r = ec.width / 2 + 0.5;
          for (const c of this._elCross) {
            if (x < c.bb[0] - r || x > c.bb[2] + r || z < c.bb[1] - r || z > c.bb[3] + r) continue;
            const P = c.pts;
            for (let k = 0; k + 3 < P.length && !b; k += 2) if (segDist2(x, z, P[k], P[k + 1], P[k + 2], P[k + 3]) < r * r) b = true;
            if (b) break;
          }
        }
        if (b) { bad[i] = 1; n++; }
      }
      this.elStats.spawnsDropped = n;
    }
    // ゲームの層の el の柱・梁・口の壁と天井（チャンク ci の分。口の柱はチャンクの矩形で切る）
    _elEmit(g, E, ci, cr) {
      const ec = this.elCfg, EC = this._elCols;
      const s = EC && EC.byChunk.get(ci);
      if (s) {
        for (const c of s.cols) E.boxes.push({ x: c.x, y: c.y0 || 0, z: c.z, w: c.w, h: c.h - (c.y0 || 0), d: c.w, mat: ec.colMat, cat: 'el', f: 0, el: 1 });
        for (const b of s.beams) g.prisms.push(lazyTri({ ring: new Float32Array(b.ring), holes: [], clip: null, y0: b.y0, y1: b.y1, f: 0, mat: ec.colMat, cat: 'el', el: 1 }));
      }
      for (const o of this._portals) {
        if (o.bb[0] > cr[2] || o.bb[2] < cr[0] || o.bb[1] > cr[3] || o.bb[3] < cr[1]) continue;
        for (const p of o.prisms) {
          const q = clipRing(p.ring, 0, 4, cr), m = q.length >> 1;
          if (m < 3 || Math.abs(areaOf(q, m)) < 0.02) continue;
          const pr = { ring: new Float32Array(q), holes: [], clip: clipBitsFor([q], cr), y0: p.y0, y1: p.y1, f: 0, mat: p.mat, cat: p.cat, portal: 1 };
          if (p.top) { pr.top = p.top; pr.t = p.t; }
          g.prisms.push(lazyTri(pr));
        }
      }
    }
    // 柱 p（台）から掘割（_cuts）を抜いた柱の列（口の座標で矩形を抜く）
    _cutPits(p, cr) {
      if (!this._cuts.length) return [p];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let v = 0; v < p.ring.length; v += 2) { const x = p.ring[v], z = p.ring[v + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const hit = this._cuts.filter((c) => c.bb[0] < x1 && c.bb[2] > x0 && c.bb[1] < z1 && c.bb[3] > z0);
      if (!hit.length) return [p];
      let parts = [{ ring: Array.from(p.ring), holes: (p.holes || []).map((h) => Array.from(h)) }];
      for (const c of hit) {
        const toF = (r) => { const o = []; for (let v = 0; v < r.length; v += 2) { const dx = r[v] - c.ox, dz = r[v + 1] - c.oz; o.push(dx * c.ux + dz * c.uz, dx * c.vx + dz * c.vz); } return o; };
        const toW = (r) => { const o = []; for (let v = 0; v < r.length; v += 2) o.push(c.ox + c.ux * r[v] + c.vx * r[v + 1], c.oz + c.uz * r[v] + c.vz * r[v + 1]); return o; };
        const nx = [];
        for (const q of parts) for (const s2 of ringsMinusRect(toF(q.ring), q.holes.map(toF), [c.s0, c.l0, c.s1, c.l1])) nx.push({ ring: toW(s2.ring), holes: s2.holes.map(toW) });
        parts = nx;
      }
      return parts.map((q) => lazyTri(Object.assign({}, p, { ring: new Float32Array(q.ring), holes: q.holes.map((h) => new Float32Array(h)), clip: clipBitsFor([q.ring].concat(q.holes), cr), cut: 1 })));
    }
    // 口の中の線路（タイルのトンネルの線を口の囲いで切って、掘割の床・トンネルの床の高さに。描画の層だけ）
    _portalTracks(cx, cz, tile) {
      const out = [], R = tile && tile.rails;
      if (!R || !this._portals.length) return out;
      const cr = this.chunkRect(cx, cz), pc = this.portalCfg;
      for (const o of this._portals) {
        if (o.bb[0] > cr[2] || o.bb[2] < cr[0] || o.bb[1] > cr[3] || o.bb[3] < cr[1]) continue;
        const sEnd = o.ramp + o.stub - 0.5, floorY = (s) => -Math.min(pc.depth, o.g * Math.max(0, s - o.a)); // 口の前 [0, a) は _railRuns が地面の線路として描く（覆った道の上の踏切）
        for (let i = 0; i < R.count; i++) {
          const tun = !!(R.flags[i] & 2);
          if ((R.flags[i] & 16) || (!tun && !(o.a < 0))) continue; // 地上の線は口の前の掘割のある口（a < 0）だけ（NC3 の直し 4、_railHide の所）
          let cur = [];
          const flush = () => {
            if (cur.length >= 2) {
              const pts = [];
              let sx = 0, sz = 0;
              for (const q of cur) { pts.push(r2(q[0]), r2(q[2]), r2(q[1])); sx += q[0]; sz += q[1]; }
              out.push({ pts, x: r2(sx / cur.length), z: r2(sz / cur.length), cls: R.cls[i], flags: R.flags[i] | 2, stub: cur.zone ? 1 : 0 }); // 地上の線（口の前の掘割）もトンネルの線と同じ描き方（flags 2: world.js _track3 の暗い道床）
            }
            cur = [];
          };
          for (let v = R.vertStart[i]; v + 1 < R.vertStart[i + 1]; v++) {
            const ax = R.xz[v * 2], az = R.xz[v * 2 + 1], bx = R.xz[v * 2 + 2], bz = R.xz[v * 2 + 3], L = Math.hypot(bx - ax, bz - az);
            const m = Math.max(1, Math.ceil(L)); // 1 m ごと（床の勾配の折れ sF で線路が床から 0.1 m 以上浮かない: 勾配 coverGrade 0.35 でも 0.09 m）
            for (let k = 0; k <= m; k++) {
              if (k === 0 && v > R.vertStart[i]) continue;
              const x = ax + (bx - ax) * k / m, z = az + (bz - az) * k / m, dx = x - o.ox, dz = z - o.oz;
              const s = dx * o.ux + dz * o.uz, l = dx * o.vx + dz * o.vz;
              const inside = s >= o.a - (tun ? 0.5 : 0) && s <= sEnd && l >= o.il0 + 0.2 && l <= o.il1 - 0.2 && x >= cr[0] && x <= cr[2] && z >= cr[1] && z <= cr[3];
              if (!inside) { flush(); continue; }
              const q = [x, z, floorY(Math.max(s, o.a))], zone = s >= o.b ? 1 : 0; // 掘割と覆い・トンネルの奥は別の線（奥は暗い線路: world.js _track3）
              if (cur.length && cur.zone !== zone) { cur.push(q); const keep = cur; flush(); cur = [keep[keep.length - 2]]; }
              cur.zone = zone;
              cur.push(q);
            }
          }
          flush();
        }
      }
      return out;
    }

    // 消した建物の残り rm をチャンクの矩形 r で切った柱（o = ci。属性は元の片のもの）。無ければ null
    _remPrism(rm, r, ci) {
      const bb = rm.bb;
      if (bb[2] <= r[0] || bb[0] >= r[2] || bb[3] <= r[1] || bb[1] >= r[3]) return null;
      const inside = bb[0] >= r[0] && bb[2] <= r[2] && bb[1] >= r[1] && bb[3] <= r[3];
      const q = inside ? Array.from(rm.ring) : clipRing(rm.ring, 0, rm.ring.length >> 1, r);
      if ((q.length >> 1) < 3 || Math.abs(areaOf(q, q.length >> 1)) < 0.05) return null;
      const p = Object.assign({ ring: new Float32Array(q), holes: [], clip: inside ? null : clipBitsFor([q], r), y0: rm.y0, y1: rm.y1, o: ci, flags: 0, remnant: rm.lm }, this._pieceProps(rm.piece, null));
      return lazyTri(p);
    }
    // ランドマークの矩形（landmarks[].footprint）の中か（データの小物・路面の印を出さない）。m だけ広げて見る
    _inFoot(x, z, m) {
      m = m || 0;
      for (const f of this._foot) if (x > f.r[0] - m && x < f.r[2] + m && z > f.r[1] - m && z < f.r[3] + m) return true;
      return false;
    }

    // 柱 p から矩形の列 rects（世界）を抜いた柱の列（重ならなければ [p]）。抜いた所の辺とチャンクの切り口は clip（描かない・押し出さない）。
    //   台（ランドマークの床・ロックフェラーのリンクの穴）と橋・高架の床（グランド・セントラルの中を通るパーク街高架橋）に使う
    _cutRects(p, rects, cr) {
      if (!rects || !rects.length) return [p];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let v = 0; v < p.ring.length; v += 2) { const x = p.ring[v], z = p.ring[v + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const hit = rects.filter((R) => R[0] < x1 && R[2] > x0 && R[1] < z1 && R[3] > z0);
      if (!hit.length) return [p];
      let parts = [{ ring: Array.from(p.ring), holes: (p.holes || []).map((h) => Array.from(h)) }];
      for (const R of hit) { const nx = []; for (const q of parts) for (const s2 of ringsMinusRect(q.ring, q.holes, R)) nx.push(s2); parts = nx; }
      return parts.map((q) => {
        const rings = [q.ring].concat(q.holes);
        let bits = clipBitsFor(rings, cr);
        for (const R of hit) { const b2 = clipBitsFor(rings, R); if (b2) { if (!bits) bits = b2; else for (let i = 0; i < bits.length; i++) bits[i] |= b2[i]; } }
        const o = Object.assign({}, p, { ring: new Float32Array(q.ring), holes: q.holes.map((h) => new Float32Array(h)), clip: bits, cut: 1 });
        return lazyTri(o);
      });
    }

    // ===== チャンクの出力 =====
    _emptyFull(cx, cz) {
      const out = {
        cx, cz, key: this.chunkKey(cx, cz),
        boxes: [], ramps: [], ladders: [], props: [], loot: [], vehicles: [], decals: [], roads: [], ground: [], water: [],
        landmarks: [], buildings: [], prisms: [], voids: []
      };
      // engine.prismMode 'degraded'（?prism=degraded。非常用）で Nav3D が prisms の代わりに読む箱 = サーバーの固い箱（読んだときに作る）
      let deg = null;
      Object.defineProperty(out, 'degradedBoxes', {
        configurable: true, enumerable: false,
        get: () => { if (!deg) deg = this._solidBoxList(cx, cz).concat(out.boxes.filter((b) => b.cat !== 'exterior')); return deg; },
        set: (v) => { deg = v; }
      });
      return out;
    }
    // 近景のチャンク。ブラウザでタイルがまだ無ければ頼んで null（作る側は LOD のまま次のフレームでまた呼ぶ）。fs のタイルでは null にならない。
    //   gameOnly（サーバー）はゲームの層だけ（タイルを待たない）
    chunkFull(cx, cz) {
      if (!this._inRange(cx, cz)) return null;
      if (!this.gameOnly && !this.request(cx, cz)) return null;
      const out = this._emptyFull(cx, cz);
      const g = this._game(cx, cz);
      const E = g.E;
      for (const k of ['boxes', 'ramps', 'ladders', 'props', 'decals', 'buildings']) for (const it of E[k]) out[k].push(it);
      for (const p of g.prisms) out.prisms.push(p);
      for (const l of g.loot) out.loot.push(l);
      if (g.st) for (const k of ['ground', 'water', 'roads']) for (const it of g.st[k]) out[k].push(it);
      for (const v of this._vehMap().get(cz * this.ncx + cx) || []) out.vehicles.push(v);
      if (!this.gameOnly) this._detail(out, cx, cz, g);
      if (this.rail && this.rail.emit) this.rail.emit(out, cx, cz, !this.gameOnly); // R4 のフック 2（gameOnly でも呼ぶ。geom = 描画の層も作るか）
      if (this.rail && this.rail.loot) this.rail.loot(out.loot, cx, cz); // 駅の落ちている物は今の物の後ろ（NC6。今までの id は変わらない）
      return out;
    }
    // 描画の層（タイル v2 のチャンクの行）
    _detail(out, cx, cz, g) {
      const tile = this._chunkTile(cx, cz, false);
      if (!tile || tile.version < 2 || !this.core) return;
      const P = tile.prisms, CP = this.core.pieces;
      const entOff = (piece) => { const r = this._entOf[piece]; return r >= 0 && !this._entOn(r); };
      // CPRS → 柱 / 箱
      let rows = NycData.chunkRows(P, tile, cx, cz);
      for (let i = rows[0]; i < rows[1]; i++) {
        const piece = P.piece[i];
        if (this._sup[piece]) continue;
        const fl = P.flags[i];
        if ((fl & R_ENTREM) && entOff(piece)) continue; // 入れない ENTB はゲームの層が E 外形で出している
        const r0 = P.ringStart[i], r1 = P.ringStart[i + 1];
        const va = P.vertStart[r0], vb = P.vertStart[r0 + 1], ve = P.vertStart[r1];
        const pp = this._pieceProps(piece, tile);
        const y0 = CP.y0[piece], y1 = CP.y1f[piece];
        if ((fl & R_RECT) && vb - va === 4 && r1 - r0 === 1) {
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = va; v < vb; v++) { const x = P.xz[v * 2], z = P.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          if (x1 - x0 < 0.01 || z1 - z0 < 0.01 || y1 - y0 < 0.01) continue;
          for (const sp of this._spans(piece, y0, y1)) out.boxes.push(Object.assign({ x: (x0 + x1) / 2, y: sp[0], z: (z0 + z1) / 2, w: x1 - x0, h: sp[1] - sp[0], d: z1 - z0, rect: 1, flags: fl }, pp));
          continue;
        }
        const ring = P.xz.subarray(va * 2, vb * 2);
        const holes = [];
        for (let k = r0 + 1; k < r1; k++) holes.push(P.xz.subarray(P.vertStart[k] * 2, P.vertStart[k + 1] * 2));
        let clip = null;
        if (fl & R_CLIPPED) {
          clip = new Uint8Array((ve - va + 7) >> 3);
          for (let v = va; v < ve; v++) if ((P.clip[v >> 3] >> (v & 7)) & 1) clip[(v - va) >> 3] |= 1 << ((v - va) & 7);
        }
        for (const sp of this._spans(piece, y0, y1)) {
          const p = Object.assign({ ring, holes, clip, y0: sp[0], y1: sp[1], flags: fl }, pp);
          if ((fl & R_NOTRI) || P.triStart[i + 1] === P.triStart[i]) lazyTri(p);
          else p.tri = P.tri.subarray(P.triStart[i], P.triStart[i + 1]);
          out.prisms.push(p);
        }
      }
      // CBLK → 歩道・広場の台
      const L = tile.plinths, pm = this.plan.plinthMats || ['sidewalk', 'sidewalk', 'sidewalk', 'sidewalk'];
      rows = NycData.chunkRows(L, tile, cx, cz);
      const cr = this.chunkRect(cx, cz);
      for (let i = rows[0]; i < rows[1]; i++) for (const q of this._cutRects(this._plinth(L, i, cx, cz, pm, tile), this._plinthCut, cr)) for (const q2 of this._cutPits(q, cr)) out.prisms.push(q2);
      // RAIL → 線路（地上・床の上。type 'track' の pts = 砂利 + 枕木 + 2 本のレール。当たりは無い）+ トンネルの口の中の線路（NC3）
      for (const t of this._railRuns(cx, cz, tile)) {
        out.decals.push({ type: 'track', x: t.x, z: t.z, pts: t.pts, cls: t.cls, flags: t.flags, stub: t.stub });
        if (t.stops) for (const q of t.stops) for (const pr of this._stopPrisms(q, cr)) out.prisms.push(pr); // 線路の止め（低い壁と暗い格子。当たりなし = 描画の層だけ）
      }
      const rr = this._railRuns(cx, cz, tile);
      if (rr.wedges) for (const w of rr.wedges) { const q = this._wedgePrism(w, cr); if (q) out.prisms.push(q); } // 踏切の坂の下の砂利（当たりなし）
      for (const t of this._portalTracks(cx, cz, tile)) out.decals.push({ type: 'track', x: t.x, z: t.z, pts: t.pts, cls: t.cls, flags: t.flags, stub: t.stub });
      for (const f of this._yardFill(tile, cx, cz)) out.decals.push({ type: 'gravel', x: (cr[0] + cr[2]) / 2, z: (cr[1] + cr[3]) / 2, y: f.y, rects: f.rects, quads: f.quads }); // 台の上の操車場の所
      // CDEC → 路面の印（v1 の decals の形 + 線分）
      const D = tile.decals, dw = NycData.DECAL_WIDTH;
      rows = NycData.chunkRows(D, tile, cx, cz);
      for (let i = rows[0]; i < rows[1]; i++) {
        const x0 = D.seg[i * 4], z0 = D.seg[i * 4 + 1], x1 = D.seg[i * 4 + 2], z1 = D.seg[i * 4 + 3], k = D.kind[i];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.05) continue;
        if (this._foot.length && this._inFoot((x0 + x1) / 2, (z0 + z1) / 2)) continue; // ランドマークの床の上に路面の印を描かない
        if (this._cuts.length && (this._inCut(x0, z0, 0.3) || this._inCut(x1, z1, 0.3) || this._inCut((x0 + x1) / 2, (z0 + z1) / 2, 0.3))) continue; // 掘割の上（NC3）
        out.decals.push({ type: k === 2 ? 'crosswalk' : 'line', kind: k, x: r2((x0 + x1) / 2), z: r2((z0 + z1) / 2), w: r2(len), d: dw[k] || 0.12,
          rot: Math.round(Math.atan2(z1 - z0, x1 - x0) * 1e4) / 1e4, seg: [x0, z0, x1, z1], color: k === 0 ? 'yellow' : 'white' });
      }
      // CPRP → 小物と当たりの箱、柵
      this._props(out, tile, cx, cz);
      if (this.stationCfg.marks !== false && this._statChunk) this._stationMarks(out, cx, cz); // 地下鉄の入口の印（NC4）
      void g;
    }
    // ===== 地下鉄の駅（nyc-complete NC4。core STAT。tools/nyc/nycstation.py）: this.stations = [{ i, x, z, depth, flags, mezz, ents, plats }]、
    //   ents = [{ i, x, z, ux, uz（下りる向き）, w, l, kind（0 階段 1 階段 + エスカレーター 2 エスカレーター 3 エレベーター 4 坂）, gen }]、
    //   plats = [{ x, z, ux, uz（軸）, hl, hw, y, flags }]。入口はチャンク（中心）ごとの索引 _statChunk。地上の穴・階段・改札は NC6
    _initStations() {
      const S = this.core.stat, E = S.ents, P = S.plats, list = [], byChunk = new Map();
      for (let i = 0; i < S.count; i++) {
        const st = { i, x: S.xz[i * 2], z: S.xz[i * 2 + 1], depth: S.depth[i], flags: S.flags[i], mezz: S.mezz[i], ents: [], plats: [] };
        for (let k = S.entStart[i]; k < S.entStart[i + 1]; k++) {
          const a = E.yaw[k];
          const e = { i: k, st: i, x: E.xz[k * 2], z: E.xz[k * 2 + 1], ux: Math.sin(a), uz: Math.cos(a), w: E.w[k], l: E.l[k], kind: E.kind[k] & 15, gen: (E.kind[k] & 16) !== 0 };
          st.ents.push(e);
          const ci = this._ci(e.x, e.z);
          if (ci < 0) continue;
          let L = byChunk.get(ci);
          if (!L) byChunk.set(ci, (L = []));
          L.push(e);
        }
        for (let k = S.platStart[i]; k < S.platStart[i + 1]; k++) {
          const a = P.yaw[k];
          st.plats.push({ i: k, x: P.xz[k * 2], z: P.xz[k * 2 + 1], ux: Math.sin(a), uz: Math.cos(a), hl: P.hl[k], hw: P.hw[k], y: P.y[k], flags: P.flags[k] });
        }
        list.push(st);
      }
      this.stations = list;
      this._statChunk = byChunk;
    }
    // 入口の印（描画の層だけ。チャンクは入口の中心で決まる）: 階段・エスカレーター・坂 = 両側と下の端の手すり（透ける柵 railing、当たりは柵と同じ）+
    //   暗い口（tunnelDark の 1 cm の板、見た目だけ NOCOL = 歩道の上を歩く）。エレベーター = 小屋（curb の柱）。掘割・el の柱の所には置かない（ビルダーが口を避けている）
    _stationMarks(out, cx, cz) {
      const L = this._statChunk.get(cz * this.ncx + cx);
      if (!L) return;
      const c = this.stationCfg, ch = this.curbH;
      const rect = (x, z, ux, uz, hl, hw) => {
        const vx = uz, vz = -ux;
        return new Float32Array([x + ux * hl + vx * hw, z + uz * hl + vz * hw, x - ux * hl + vx * hw, z - uz * hl + vz * hw,
          x - ux * hl - vx * hw, z - uz * hl - vz * hw, x + ux * hl - vx * hw, z + uz * hl - vz * hw]);
      };
      for (const e of L) {
        const hl = e.l / 2, hw = e.w / 2;
        if ((this._cuts.length && this._inCut(e.x, e.z, hl)) || (this._elCols && this._elColNear(e.x, e.z, hl))) continue;
        if (e.kind === 3) {
          out.prisms.push(lazyTri({ ring: rect(e.x, e.z, e.ux, e.uz, hl, hw), holes: [], clip: null, y0: 0, y1: ch + c.liftH, f: 0, mat: c.liftMat, cat: 'station', station: e.st, ent: e.i }));
          continue;
        }
        const t = c.railT / 2, vx = e.uz, vz = -e.ux;
        for (const s of [1, -1]) { // 両側の手すり
          const o = s * (hw - t);
          out.prisms.push(lazyTri({ ring: rect(e.x + vx * o, e.z + vz * o, e.ux, e.uz, hl, t), holes: [], clip: null, y0: 0, y1: ch + c.railH, f: F.NOLOS, mat: c.railMat, cat: 'fence', kind: 'station', station: e.st, ent: e.i }));
        }
        out.prisms.push(lazyTri({ ring: rect(e.x + e.ux * (hl - t), e.z + e.uz * (hl - t), e.ux, e.uz, t, hw - 2 * t), holes: [], clip: null, y0: 0, y1: ch + c.railH, f: F.NOLOS, mat: c.railMat, cat: 'fence', kind: 'station', station: e.st, ent: e.i }));
        out.prisms.push(lazyTri({ ring: rect(e.x, e.z, e.ux, e.uz, hl - 2 * t, hw - 2 * t), holes: [], clip: null, y0: ch, y1: ch + c.holeT, f: F.NOCOL, mat: c.holeMat, cat: 'station', station: e.st, ent: e.i }));
      }
    }
    _plinth(L, i, cx, cz, pm, tile) {
      const r0 = L.ringStart[i], r1 = L.ringStart[i + 1];
      const va = L.vertStart[r0], vb = L.vertStart[r0 + 1], ve = L.vertStart[r1];
      const ring = L.xz.subarray(va * 2, vb * 2), holes = [];
      for (let k = r0 + 1; k < r1; k++) holes.push(L.xz.subarray(L.vertStart[k] * 2, L.vertStart[k + 1] * 2));
      let clip = null;
      for (let v = va; v < ve; v++) if ((L.clip[v >> 3] >> (v & 7)) & 1) { (clip || (clip = new Uint8Array((ve - va + 7) >> 3)))[(v - va) >> 3] |= 1 << ((v - va) & 7); }
      const y1 = L.y[i], kind = L.kind[i];
      const p = { ring, holes, clip, y0: Math.min(0, y1 - this.curbH), y1, f: F.WALK, cat: kind === 1 ? 'plaza' : 'sidewalk', mat: pm[kind] || 'sidewalk', kind, flags: L.flags[i] };
      if (L.triStart && L.triStart[i + 1] > L.triStart[i]) p.tri = L.tri.subarray(L.triStart[i], L.triStart[i + 1]); else lazyTri(p);
      // 操車場（AREA railway が台の大半）: 台（歩道・広場・分離帯・島のどれも）の材質を砂利に（高さはそのまま = ゲームの層の台と同じ。チャンクの境に段ができない）
      if (tile && this._yardOf(tile, L, i)) { p.mat = this.railCfg.yardMat; p.yard = 1; }
      if (this.rail && this.rail.cutPlinth) this.rail.cutPlinth(p, cx, cz); // R4 のフック 5（台に穴。MR.Underground は cuts() = _cutPits の矩形で抜く）
      return p;
    }

    // ===== 線路（nyc-complete NC2。地上と橋・高架の床の上の線路の見た目。描画の層だけ: chunkFull の decals（type 'track' の pts）と
    //   chunkLod の tracks（砂利の帯だけ）。当たりの箱は足さない = 線路の上を歩ける。サーバー（gameOnly・chunkCoarse・colliderBoxes）は見ない）
    // 台の行 i が操車場か（タイルの AREA railway の中の点が台の yardFrac 以上。台の外接矩形の格子で数え、面積で重みを付ける）。
    //   台の種類（歩道・広場・分離帯・島）によらない。台の行はチャンクの矩形で切ってあるので、チャンクの切り口（clip の辺）で接する同じ種類の台の行をつないで 1 つの台として決める
    //   （行ごとに決めるとチャンクの境で材質が砂利 ↔ 歩道に変わっていた）。タイルの境の先はつながない（隣のタイルを読まずに決まる = 決定的）。
    //   結果はタイルごとに覚える
    _yardOf(tile, L, i) {
      let m = this._yardIdx && this._yardIdx.get(tile);
      if (!m) {
        m = this._yardTile(tile, L);
        if (this._yardIdx) this._yardIdx.set(tile, m);
      }
      return m.yard[i] === 1;
    }
    // タイルの AREA railway の [行, x0, z0, x1, z1]（_yardOf と同じ表）
    _yardAreas(tile) {
      const L = tile.plinths;
      if (!L) return [];
      this._yardOf(tile, L, 0);
      const m = this._yardIdx && this._yardIdx.get(tile);
      return m ? m.rw : [];
    }
    _yardTile(tile, L) {
      const out = new Uint8Array(L.count), res = { yard: out, rw: null };
      const A = tile.areas, en = this.meta && this.meta.enums, rw = en ? en.areaKind.indexOf('railway') : -1, list = [];
      if (A && rw >= 0) for (let k = 0; k < A.count; k++) {
        if (A.kind[k] !== rw) continue;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = A.vertStart[A.ringStart[k]]; v < A.vertStart[A.ringStart[k] + 1]; v++) { const x = A.xz[v * 2], z = A.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        list.push([k, x0, z0, x1, z1]);
      }
      res.rw = list;
      if (!list.length) return res;
      const n = L.count, wIn = new Float64Array(n), wY = new Float64Array(n), par = new Int32Array(n);
      for (let i = 0; i < n; i++) par[i] = i;
      const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
      const lines = new Map(), Q = 32; // 切り口の辺（軸にそろった線）→ [lo, hi, 行]（1/32 m の格子で比べる = タイルの座標の単位）
      for (let i = 0; i < n; i++) {
        const va = L.vertStart[L.ringStart[i]], vb = L.vertStart[L.ringStart[i] + 1];
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = va; v < vb; v++) {
          const x = L.xz[v * 2], z = L.xz[v * 2 + 1];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
          if (!((L.clip[v >> 3] >> (v & 7)) & 1)) continue;
          const w = v + 1 < vb ? v + 1 : va, ax = Math.round(x * Q), az = Math.round(z * Q), bx = Math.round(L.xz[w * 2] * Q), bz = Math.round(L.xz[w * 2 + 1] * Q);
          let key, lo, hi;
          if (ax === bx && az !== bz) { key = 'x' + ax; lo = Math.min(az, bz); hi = Math.max(az, bz); } else if (az === bz && ax !== bx) { key = 'z' + az; lo = Math.min(ax, bx); hi = Math.max(ax, bx); } else continue;
          let e = lines.get(key);
          if (!e) lines.set(key, (e = []));
          e.push(lo, hi, i);
        }
        const hits = list.filter((a) => a[1] < x1 && a[3] > x0 && a[2] < z1 && a[4] > z0);
        if (!hits.length) { // railway にかからない行は面積だけ（格子で数えない = タイルの最初の 1 回が数 ms 短い）
          let ar = 0;
          for (let k = L.ringStart[i]; k < L.ringStart[i + 1]; k++) {
            const a = L.vertStart[k], b = L.vertStart[k + 1];
            let sa = 0;
            for (let v = a, w = b - 1; v < b; w = v++) sa += L.xz[w * 2] * L.xz[v * 2 + 1] - L.xz[v * 2] * L.xz[w * 2 + 1];
            ar += (k === L.ringStart[i] ? 1 : -1) * Math.abs(sa) / 2;
          }
          wIn[i] = Math.max(0, ar);
          continue;
        }
        // 走査線（z を st m ごと）で台の区間と railway の区間の重なりの長さ（面積の近似）
        const st = Math.max(1, (z1 - z0) / 48);
        let sIn = 0, sYv = 0;
        for (let z = z0 + st / 2; z < z1; z += st) {
          const q = ivOf(scanX(L, L.ringStart[i], L.ringStart[i + 1], z, []));
          if (!q.length) continue;
          sIn += ivLen(q);
          const al = [];
          for (const a of hits) if (z > a[2] && z < a[4]) al.push(ivOf(scanX(A, A.ringStart[a[0]], A.ringStart[a[0] + 1], z, [])));
          if (al.length) sYv += ivLen(ivAnd(q, ivOr(al)));
        }
        wIn[i] = sIn * st; wY[i] = sYv * st;
      }
      for (const e of lines.values()) for (let p = 0; p < e.length; p += 3) for (let q = p + 3; q < e.length; q += 3) {
        if (e[p + 2] === e[q + 2] || L.kind[e[p + 2]] !== L.kind[e[q + 2]] || Math.min(e[p + 1], e[q + 1]) - Math.max(e[p], e[q]) < 2) continue;
        const ra = find(e[p + 2]), rb = find(e[q + 2]);
        if (ra !== rb) par[ra] = rb;
      }
      const sIn = new Float64Array(n), sY = new Float64Array(n);
      for (let i = 0; i < n; i++) { const r = find(i); sIn[r] += wIn[i]; sY[r] += wY[i]; }
      const fr = this.railCfg.yardFrac;
      for (let i = 0; i < n; i++) { const r = find(i); out[i] = sIn[r] > 0 && sY[r] > 0 && sY[r] >= sIn[r] * fr ? 1 : 0; }
      return res;
    }
    // 操車場にならない（railway が台の yardFrac より少ない）台の上の railway の所を砂利で塗る帯（描画だけ。台の高さ・当たりは変えない）:
    //   世界の yardStrip m の帯（z）ごとに、帯の上・真ん中・下の線で台の行と AREA railway の区間（偶奇）を出し、3 本とも中の x の区間の矩形。
    //   入れる建物（ENTB）の床の所は除く（床が台の上面の高さ = 砂利が床から出る）。帯は世界にそろえてあり、台の行はチャンクで切った形なので、
    //   チャンクの境の両側で同じ所に続く。[{ y, rects: [x0, z0, x1, z1, …] }]（台の上面の高さごと）
    _yardFill(tile, cx, cz) {
      const rw = this._yardAreas(tile), L = tile.plinths, rc = this.railCfg, H = rc.yardStrip;
      if (!rw.length || !L || !(H > 0)) return [];
      const cr = this.chunkRect(cx, cz), A = tile.areas, rows = NycData.chunkRows(L, tile, cx, cz), byY = new Map();
      const EN = this.core && this.core.entb, ent = [];
      if (EN) for (let r = 0; r < EN.count; r++) { const e = [EN.rect[r * 4], EN.rect[r * 4 + 1], EN.rect[r * 4 + 2], EN.rect[r * 4 + 3]]; if (e[0] < cr[2] && e[2] > cr[0] && e[1] < cr[3] && e[3] > cr[1]) ent.push(e); }
      for (let i = rows[0]; i < rows[1]; i++) {
        if (this._yardOf(tile, L, i)) continue;
        const va = L.vertStart[L.ringStart[i]], vb = L.vertStart[L.ringStart[i] + 1];
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = va; v < vb; v++) { const x = L.xz[v * 2], z = L.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        const hits = rw.filter((a) => a[1] < x1 && a[3] > x0 && a[2] < z1 && a[4] > z0);
        if (!hits.length) continue;
        const out = [], quads = []; // quads: 台形 [x0, x1（帯の上の z0 で）, z0, x0, x1（下の z1 で）, z1]
        const j0 = Math.floor((Math.max(z0, cr[1]) - this.minZ) / H), j1 = Math.ceil((Math.min(z1, cr[3]) - this.minZ) / H);
        for (let j = j0; j < j1; j++) {
          const za = this.minZ + j * H, zb = za + H;
          if (za < cr[1] - 1e-6 || zb > cr[3] + 1e-6) continue; // 帯はチャンクの中だけ（128 は H の倍数）
          let iv = null;
          const ivs = [];
          for (const z of [za + 0.01, za + H / 2, zb - 0.01]) {
            let q = ivOf(scanX(L, L.ringStart[i], L.ringStart[i + 1], z, []));
            const al = [];
            for (const a of hits) if (z > a[2] && z < a[4]) al.push(ivOf(scanX(A, A.ringStart[a[0]], A.ringStart[a[0] + 1], z, [])));
            q = ivAnd(q, ivOr(al));
            ivs.push(q);
            iv = iv ? ivAnd(iv, q) : q;
          }
          if (!iv || !iv.length) continue;
          const ex = [];
          for (const e of ent) if (e[1] < zb && e[3] > za) ex.push(e[0], e[2]);
          // 斜めの縁（台・railway の辺）は台形で（上・真ん中・下の区間の数が同じで、真ん中が上と下の平均から 0.3 m 以内 = 帯の中で辺がまっすぐ）。
          //   以前は 3 本の区間の共通部分の矩形だけで、斜めの道の縁に 2 m の歯が並んだ（サニーサイド操車場）
          const [ia, im, ib] = ivs;
          if (!ex.length && ia.length && ia.length === im.length && ia.length === ib.length) {
            let okT = true;
            for (let k = 0; k < ia.length && okT; k++) okT = Math.abs(im[k] - (ia[k] + ib[k]) / 2) < 0.3;
            for (let k = 0; k < ia.length && okT; k += 2) okT = ia[k] < ib[k + 1] && ib[k] < ia[k + 1];
            if (okT) {
              for (let k = 0; k < ia.length; k += 2) {
                const a0 = Math.max(cr[0], ia[k]), a1 = Math.min(cr[2], ia[k + 1]), b0 = Math.max(cr[0], ib[k]), b1 = Math.min(cr[2], ib[k + 1]);
                if (Math.max(a1 - a0, b1 - b0) >= rc.yardStripMin && a1 >= a0 && b1 >= b0) quads.push(a0, a1, za, b0, b1, zb);
              }
              continue;
            }
          }
          if (ex.length) { // 区間 − 入れる建物の x の区間
            const cut = ivOr([ex]), keep = [];
            for (let k = 0; k < iv.length; k += 2) {
              let a = iv[k];
              const b = iv[k + 1];
              for (let c = 0; c < cut.length && a < b; c += 2) { if (cut[c + 1] <= a || cut[c] >= b) continue; if (cut[c] > a) keep.push(a, cut[c]); a = Math.max(a, cut[c + 1]); }
              if (a < b) keep.push(a, b);
            }
            iv = keep;
          }
          for (let k = 0; k < iv.length; k += 2) if (iv[k + 1] - iv[k] >= rc.yardStripMin) out.push(Math.max(cr[0], iv[k]), za, Math.min(cr[2], iv[k + 1]), zb);
        }
        if (out.length || quads.length) { const y = L.y[i]; let e = byY.get(y); if (!e) byY.set(y, (e = { r: [], q: [] })); for (const v of out) e.r.push(v); for (const v of quads) e.q.push(v); }
      }
      const res = [];
      for (const [y, e] of byY) res.push({ y, rects: e.r.map(r2), quads: e.q.map(r2) });
      return res;
    }
    // 床（DECK）の上面の高さで y から tol m 以内のもの（一番近い）。無ければ null。ci = 点のチャンク
    //   （片を引くのは 32 m の升の索引 _deckCell: 点を含む片はその升の行に必ずある・番号の順 = チャンクの行で引いたときと同じ答え）
    //   onlyEl: NC3 の el の床だけ
    _deckTopNear(x, z, y, tol, ci, onlyEl, nd, skip) {
      const D = this._decks, dkc = this._deckCell, bb = this._deckBB;
      if (!D || ci < 0 || !dkc) return null;
      const gi = Math.floor((x - this.minX) / dkc.cell), gj = Math.floor((z - this.minZ) / dkc.cell);
      if (gi < 0 || gj < 0 || gi >= dkc.W || gj >= dkc.H) return null;
      const gk = gj * dkc.W + gi, dc = dkc.csr;
      let best = null;
      for (let k = dc.start[gk]; k < dc.start[gk + 1]; k++) {
        const i = dc.items[k];
        const em = nd || 0;
        if (x < bb[i * 4] - em || x > bb[i * 4 + 2] + em || z < bb[i * 4 + 1] - em || z > bb[i * 4 + 3] + em) continue;
        if (D.eflag && (onlyEl ? !(D.eflag[i] & 1) : (D.eflag[i] & 2))) continue; // onlyEl: NC3 の el の床だけ。隠れた屋根の上には描かない
        if (skip && skip.has(D.chain[i])) continue;
        if (this._deckCut.length && this._deckCut.some((R) => x > R[0] && x < R[2] && z > R[1] && z < R[3])) continue;
        const yd = D.plane[i * 3] * x + D.plane[i * 3 + 1] * z + D.plane[i * 3 + 2];
        if (Math.abs(yd - y) > tol || (best != null && Math.abs(yd - y) >= Math.abs(best - y))) continue;
        if (this._nearDeck(i, x, z, nd || 0)) best = yd;
      }
      return best;
    }
    // タイルの線路の索引（タイルごとに 1 回）: 片の外接矩形 bb と、片ごとの線 { xz, y, n }（大きな橋の線は _railShift で横へずらした物。作ったら覚える）
    _railInfo(tile) {
      let m = this._railTile && this._railTile.get(tile);
      if (m) return m;
      const R = tile.rails, bb = new Float32Array(R.count * 4);
      for (let i = 0; i < R.count; i++) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = R.vertStart[i]; v < R.vertStart[i + 1]; v++) { const x = R.xz[v * 2], z = R.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        bb[i * 4] = x0; bb[i * 4 + 1] = z0; bb[i * 4 + 2] = x1; bb[i * 4 + 3] = z1;
      }
      m = { bb, xz: new Array(R.count).fill(null) };
      if (this._railTile) this._railTile.set(tile, m);
      return m;
    }
    // 大きな橋の線（corridor）の片 i の線 { xz, y, n }。データの車道の床の幅は歩道込みで線路の所まで重なり、床の縁の壁（_deckBarriers = ゲームの層・
    //   サーバーと同じ壁）が線路の片方のレールの下に立つ（ウィリアムズバーグ橋）。床の上の点（step m ごと）ごとに、砂利の帯の中心から同じ高さの壁の
    //   真ん中まで barrierClear m 以上で、ずらした所にも床がある一番小さな横のずらし（0.25 m 刻み、shift m まで。無ければ一番ましな物）を決め、
    //   ずらしの変わり方を 1 m あたり shiftSlope m までにならして（大きい方を残す）線を横へずらす（点を足し、まっすぐな所は 2 次元の
    //   Douglas–Peucker で減らす）。片の点だけで決まる = 片のどのチャンクでも同じ。壁は動かさない（当たり・サーバーはそのまま）
    // 片の印（頂点の数と両端。railshift.js の表のキーの中身と比べる）
    _railSig(tile, i) {
      const R = tile.rails, a = R.vertStart[i], b = R.vertStart[i + 1] - 1;
      return (b - a + 1) + '|' + R.xz[a * 2] + '|' + R.xz[a * 2 + 1] + '|' + R.xz[b * 2] + '|' + R.xz[b * 2 + 1];
    }
    // 前もって作ったずらし: 無ければ null、ずらさない片は 0、ずらした片は { xz, y, n }
    _railShiftPre(tile, i) {
      const T = this.meta && this.meta.railShift;
      if (!T || T.v !== 1 || !T.lines || this._railShiftNoPre) return null;
      const e = T.lines[tile.tx + '_' + tile.tz + ':' + i];
      if (!e || e.sig !== this._railSig(tile, i)) return null;
      if (!e.xz) return 0;
      return { xz: new Float32Array(e.xz), y: new Float32Array(e.y), n: e.y.length };
    }
    _railShift(tile, info, i) {
      if (info.xz[i]) return info.xz[i];
      const R = tile.rails, rc = this.railCfg, a0 = R.vertStart[i], a1 = R.vertStart[i + 1];
      const plain = { xz: R.xz.subarray(a0 * 2, a1 * 2), y: R.y.subarray(a0, a1), n: a1 - a0 };
      info.xz[i] = plain;
      const D = this._decks, dkc = this._deckCell, DB = this._deckBB, dk = this.plan.decks || {};
      const barH = dk.barrierH != null ? dk.barrierH : 1.1, barT = dk.barrierT != null ? dk.barrierT : 0.3, minY = dk.barrierMinY != null ? dk.barrierMinY : 2;
      if (!(rc.shift > 0) || !D || !dkc || barH <= 0 || !(R.flags[i] & 128) || (R.flags[i] & 32)) return plain;
      // 前もって作った答え（nyc.json の railShift。tools/nyc/railshift.js がこの関数で作る）: 片の頂点の数と両端が同じなら使う（無い・古いデータは下で作る。
      //   その場で作ると橋のタイルの最初の 1 回に 20〜35 ms かかった = 1 フレームの組み立ての 1 歩に入る）
      const pre = this._railShiftPre(tile, i);
      if (pre === 0) return plain;
      if (pre) { info.xz[i] = pre; return pre; }
      const bb = info.bb, mg = rc.shift + rc.barrierClear + 1;
      const x0 = bb[i * 4] - mg, z0 = bb[i * 4 + 1] - mg, x1 = bb[i * 4 + 2] + mg, z1 = bb[i * 4 + 3] + mg;
      // 線を step m ごとの点に（元の頂点も残す）: [x, z, y, nx, nz, s（線に沿った距離）, 元の頂点か]
      const S = [];
      let sAcc = 0;
      for (let v = a0; v + 1 < a1; v++) {
        const ax = R.xz[v * 2], az = R.xz[v * 2 + 1], bx = R.xz[v * 2 + 2], bz = R.xz[v * 2 + 3], L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-4) continue;
        const nx = -(bz - az) / L, nz = (bx - ax) / L, n = Math.max(1, Math.ceil(L / rc.step));
        for (let s = 0; s < n; s++) { const u = s / n; S.push([ax + (bx - ax) * u, az + (bz - az) * u, R.y[v] + (R.y[v + 1] - R.y[v]) * u, nx, nz, sAcc + L * u, s === 0]); }
        sAcc += L;
      }
      {
        const v = a1 - 1, l = S[S.length - 1];
        if (!l) return plain;
        S.push([R.xz[v * 2], R.xz[v * 2 + 1], R.y[v], l[3], l[4], sAcc, true]);
      }
      // 壁を集めるのは線の点のまわり（mg m）の床の升だけ（片の外接矩形の升を全部見ると、斜めの長い片で何千もの床を見ていた。点から reach より
      //   遠い壁は下の near に入らないので答えは同じ）
      const bars = [], seen = new Set(), seenC = new Set(), SC = dkc.cell;
      for (const q0 of S) {
        if (q0[2] < rc.air) continue;
        const ci0 = Math.max(0, Math.floor((q0[0] - mg - this.minX) / SC)), ci1 = Math.min(dkc.W - 1, Math.floor((q0[0] + mg - this.minX) / SC));
        const cj0 = Math.max(0, Math.floor((q0[1] - mg - this.minZ) / SC)), cj1 = Math.min(dkc.H - 1, Math.floor((q0[1] + mg - this.minZ) / SC));
        for (let cj = cj0; cj <= cj1; cj++) for (let cii = ci0; cii <= ci1; cii++) {
          const k = cj * dkc.W + cii;
          if (seenC.has(k)) continue;
          seenC.add(k);
          for (let n = dkc.csr.start[k]; n < dkc.csr.start[k + 1]; n++) {
            const q = dkc.csr.items[n];
            if (seen.has(q)) continue;
            seen.add(q);
            if (D.kind[q] === 2 || DB[q * 4] > x1 || DB[q * 4 + 2] < x0 || DB[q * 4 + 1] > z1 || DB[q * 4 + 3] < z0) continue;
            let y0 = Infinity;
            for (let v = D.vertStart[q]; v < D.vertStart[q + 1]; v++) y0 = Math.min(y0, D.y[v]);
            if (!(y0 > minY)) continue;
            for (const [ax, az, bx, bz, nx, nz] of this._deckBarriers(q)) bars.push([ax + nx * barT / 2, az + nz * barT / 2, bx + nx * barT / 2, bz + nz * barT / 2, q]);
          }
        }
      }
      if (!bars.length) return plain;
      // 線分の 8 m の升の索引（壁・ほかの線）。query(x, z, r) は外接矩形が点の r m にかかる線分の番号（重ならない・順は問わない = 最小を取るだけ）
      const GC = 8;
      const segGrid = (list) => {
        const g = new Map();
        for (let n = 0; n < list.length; n++) {
          const b = list[n], i0 = Math.floor(Math.min(b[0], b[2]) / GC), i1 = Math.floor(Math.max(b[0], b[2]) / GC), j0 = Math.floor(Math.min(b[1], b[3]) / GC), j1 = Math.floor(Math.max(b[1], b[3]) / GC);
          for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const key = j * 65536 + k; let c = g.get(key); if (!c) g.set(key, (c = [])); c.push(n); }
        }
        const stamp = new Uint32Array(list.length);
        let st = 0;
        return (x, z, r, out) => {
          out.length = 0; st++;
          const i0 = Math.floor((x - r) / GC), i1 = Math.floor((x + r) / GC), j0 = Math.floor((z - r) / GC), j1 = Math.floor((z + r) / GC);
          for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
            const c = g.get(j * 65536 + k);
            if (c) for (const n of c) if (stamp[n] !== st) { stamp[n] = st; out.push(list[n]); }
          }
          return out;
        };
      };
      const barQ = segGrid(bars);
      // 同じタイルのほかの大きな橋の線（ずらす前）: ずらしてほかの線の trackGap m より近づけない（元から近ければ元より近づけない）。
      //   ウィリアムズバーグ橋のマンハッタン側の取り付けで、2 本の線が両側の壁からよけて同じ所へ寄り、重なっていた
      const oth = [];
      for (let j = 0; j < R.count; j++) {
        if (j === i || !(R.flags[j] & 128) || (R.flags[j] & 32) || (R.flags[j] & rc.skipFlags)) continue;
        if (bb[j * 4] > x1 || bb[j * 4 + 2] < x0 || bb[j * 4 + 1] > z1 || bb[j * 4 + 3] < z0) continue;
        for (let v = R.vertStart[j]; v + 1 < R.vertStart[j + 1]; v++) oth.push([R.xz[v * 2], R.xz[v * 2 + 1], R.xz[v * 2 + 2], R.xz[v * 2 + 3], R.y[v], R.y[v + 1]]);
      }
      // 答えは trackGap² との小さい方にしか使わない（gap2 と、それより近いか）ので、trackGap m より遠い線は見ない
      const othQ = segGrid(oth), oTmp = [], gapR = rc.trackGap + 1e-3, gapR2 = gapR * gapR;
      const othD2 = (px, pz, y) => {
        let d2 = Infinity;
        for (const o of othQ(px, pz, gapR, oTmp)) if (Math.min(Math.abs(o[4] - y), Math.abs(o[5] - y)) < rc.deckTol + barH) d2 = Math.min(d2, segDist2(px, pz, o[0], o[1], o[2], o[3]));
        return d2 < gapR2 ? d2 : Infinity;
      };
      // 点ごとのずらし（床の上の点だけ）
      const reachR = rc.shift + rc.barrierClear, reach = reachR * reachR, need2 = rc.barrierClear * rc.barrierClear;
      const O = new Float64Array(S.length), bTmp = [], nCand = 1 + 2 * Math.floor(rc.shift / 0.25 + 1e-9);
      const cO = new Float64Array(nCand), cD = new Float64Array(nCand), cI = new Int32Array(nCand);
      let any = false;
      for (let k = 0; k < S.length; k++) {
        const [x, z, y, nx, nz] = S[k];
        if (y < rc.air) continue;
        const near = barQ(x, z, reachR, bTmp).filter((b) => segDist2(x, z, b[0], b[1], b[2], b[3]) < reach && Math.abs(D.plane[b[4] * 3] * x + D.plane[b[4] * 3 + 1] * z + D.plane[b[4] * 3 + 2] - y) < rc.deckTol + barH);
        if (!near.length) continue; // 壁が近くに無い（床が無ければ描かないまま）
        // 候補（0, ±0.25, ±0.5 … ±shift の順）のうち、壁から need2 以上の最初の使える物、無ければ一番遠い使える物（同じなら先の物）
        //   = 順に「より遠ければ使える物か見る」と同じ答え。使えるか（ほかの線・床）は高いので、遠さを先に全部出して見る順を決める
        const gap2 = Math.min(rc.trackGap * rc.trackGap, othD2(x, z, y));
        let nc = 0;
        for (let m = 0; m * 0.25 <= rc.shift + 1e-9; m++) for (let sg = 0; sg < (m ? 2 : 1); sg++) {
          const o = sg ? -m * 0.25 : m * 0.25, px = x + nx * o, pz = z + nz * o;
          let d2 = Infinity;
          for (const b of near) d2 = Math.min(d2, segDist2(px, pz, b[0], b[1], b[2], b[3]));
          cO[nc] = o; cD[nc] = d2; cI[nc] = nc; nc++;
        }
        const ok = (c) => { const o = cO[c], px = x + nx * o, pz = z + nz * o; return !(o && othD2(px, pz, y) < gap2 - 1e-6) && this._deckTopNear(px, pz, y, rc.deckTol, this._ci(px, pz)) != null; };
        let best = 0, pick = -1;
        for (let c = 0; c < nc && pick < 0; c++) if (cD[c] >= need2 && ok(c)) pick = c;
        if (pick < 0) {
          const ord = Array.prototype.slice.call(cI, 0, nc).sort((a, b) => cD[b] - cD[a] || a - b);
          for (const c of ord) { if (cD[c] >= need2) continue; if (ok(c)) { pick = c; break; } }
        }
        if (pick >= 0) best = cO[pick];
        O[k] = best;
        if (best) any = true;
      }
      if (!any) return plain;
      // ならす（大きい方を残す: 前へ・後ろへ、1 m あたり shiftSlope m まで小さくなる）
      for (const dir of [1, -1]) {
        for (let k = dir > 0 ? 1 : S.length - 2; k >= 0 && k < S.length; k += dir) {
          const p = O[k - dir], ds = Math.abs(S[k][5] - S[k - dir][5]), lim = Math.abs(p) - rc.shiftSlope * ds;
          if (lim > Math.abs(O[k]) && (O[k] === 0 || Math.sign(O[k]) === Math.sign(p))) O[k] = Math.sign(p) * lim;
        }
      }
      // ずらした点（頂点の角は隣の辺の法線の平均）→ ずらしが変わらない所は 2 次元の Douglas–Peucker（rc.flat m）で減らす
      const P = [];
      for (let k = 0; k < S.length; k++) {
        let nx = S[k][3], nz = S[k][4];
        if (S[k][6] && k > 0) { const a = S[k - 1]; nx += a[3]; nz += a[4]; const l = Math.hypot(nx, nz) || 1; const dot = Math.max(0.5, (nx / l) * S[k][3] + (nz / l) * S[k][4]); nx = nx / l / dot; nz = nz / l / dot; }
        P.push([S[k][0] + nx * O[k], S[k][1] + nz * O[k], S[k][2]]);
      }
      // タイルの縁で切れた片の端は、ずらした後も同じ縁の線の上に（端の辺に沿って延ばす / 縮める）。法線へずらすと端が縁から離れ、隣のタイルの片との
      //   間に 0.1〜0.2 m の隙間が開いていた（ウィリアムズバーグ橋 x 2220 / 2732）
      const TS = this.meta && this.meta.tile;
      if (TS && tile.cx != null && P.length > 1) {
        const ex = [tile.cx - TS / 2, tile.cx + TS / 2], ez = [tile.cz - TS / 2, tile.cz + TS / 2];
        for (const [k, j] of [[0, 1], [P.length - 1, P.length - 2]]) {
          if (!O[k]) continue;
          const q = P[k], r = P[j], dx = q[0] - r[0], dz = q[1] - r[1], dy = q[2] - r[2];
          let t = null;
          if (Math.abs(dx) > 1e-4) for (const X of ex) if (Math.abs(S[k][0] - X) < 1e-3) t = (X - q[0]) / dx;
          if (t === null && Math.abs(dz) > 1e-4) for (const Z of ez) if (Math.abs(S[k][1] - Z) < 1e-3) t = (Z - q[1]) / dz;
          if (t !== null && Math.abs(t * Math.hypot(dx, dz)) < rc.shift + 1) { q[0] += dx * t; q[1] += dz * t; q[2] += dy * t; }
        }
      }
      const keep = new Uint8Array(P.length);
      keep[0] = keep[P.length - 1] = 1;
      const dp = (a, b) => {
        const A = P[a], B = P[b], dx = B[0] - A[0], dz = B[1] - A[1], LL = Math.hypot(dx, dz) || 1;
        let w = -1, wd = rc.flat;
        for (let j = a + 1; j < b; j++) {
          const u = ((P[j][0] - A[0]) * dx + (P[j][1] - A[1]) * dz) / (LL * LL);
          const e = Math.max(Math.abs((P[j][0] - A[0]) * dz - (P[j][1] - A[1]) * dx) / LL, Math.abs(P[j][2] - (A[2] + (B[2] - A[2]) * u)));
          if (e > wd) { wd = e; w = j; }
        }
        if (w >= 0) { keep[w] = 1; dp(a, w); dp(w, b); }
      };
      dp(0, P.length - 1);
      const xz = [], ys = [];
      for (let k = 0; k < P.length; k++) if (keep[k]) { xz.push(P[k][0], P[k][1]); ys.push(P[k][2]); }
      const sh = { xz: new Float32Array(xz), y: new Float32Array(ys), n: ys.length };
      info.xz[i] = sh;
      return sh;
    }
    // チャンクの線路の走り [{ pts: [x, y, z, …]（y = 砂利の下の面 = 地面・台の上面・床の上面）, cls, flags, x, z }]。タイルの RAIL を
    //   チャンクの矩形で切り、step m ごとに足元を決める: トンネル・廃線（abandoned = レールが無い）は描かない。y < below は地面の下（NC3 の口）。
    //   y < air は地上: 足元の本当の面（台の上面・陸の地面・水の上なら y から deckTol m 以内の床）に置く（データの y が台から 0.3〜1 m 離れていても
    //   浮かせない）。それより上は大きな橋の線（corridor、elevated でない）で床（DECK）の上面が y から deckTol m 以内にあるときだけ（無い所・
    //   柱・桁の無い高架は NC3 の構造が要る）。足元より solidAbove m 上まで・solidBelow m 下から始まる固い物（建物・道の斜路の柱 = 線路をまたぐ
    //   陸橋の盛り土。NC3 / データで本当の陸橋に）の中は描かない（そこで切って、出た所から続ける）。高さの段（台の縁・切れ目）は 2 分探しで縁の所に
    //   置く（2 m の間で斜めにしない）。隣り合う点の高さの差が maxRise を超える所で切る。元の線の途中の点は高さがまっすぐなら捨てる
    // 点 (x, z) が地上の車道（RDS の種類 1..12、上下 ±1 m。縁石の内側 + m m）の上か。32 m のセルの索引は最初に 1 回（描画の層だけ）
    _onCarriageway(x, z, m) {
      const Rd = this.core && this.core.roads;
      if (!Rd) return false;
      let G = this._cwIdx;
      if (!G) {
        const C = 32, W = Math.ceil((this.maxX - this.minX) / C) + 1, map = new Map();
        for (let r = 0; r < Rd.count; r++) {
          if ((Rd.flags[r] & 35) || !(Rd.cls[r] >= 1 && Rd.cls[r] <= 12)) continue;
          const w = Math.max(Rd.curbL[r], Rd.curbR[r]) + 2;
          for (let v = Rd.vertStart[r]; v + 1 < Rd.vertStart[r + 1]; v++) {
            if (Math.abs(Rd.y[v]) > 1 && Math.abs(Rd.y[v + 1]) > 1) continue;
            const ax = Rd.xz[v * 2], az = Rd.xz[v * 2 + 1], bx = Rd.xz[v * 2 + 2], bz = Rd.xz[v * 2 + 3];
            for (let j = Math.floor((Math.min(az, bz) - w - this.minZ) / C); j <= Math.floor((Math.max(az, bz) + w - this.minZ) / C); j++)
              for (let i = Math.floor((Math.min(ax, bx) - w - this.minX) / C); i <= Math.floor((Math.max(ax, bx) + w - this.minX) / C); i++) {
                const k = i + j * W; let a = map.get(k); if (!a) map.set(k, a = []); a.push(r * 65536 + v);
              }
          }
        }
        G = this._cwIdx = { C, W, map };
      }
      const a = G.map.get(Math.floor((x - this.minX) / G.C) + Math.floor((z - this.minZ) / G.C) * G.W);
      if (a) for (const e of a) {
        const r = Math.floor(e / 65536), v = e % 65536;
        const ax = Rd.xz[v * 2], az = Rd.xz[v * 2 + 1], bx = Rd.xz[v * 2 + 2], bz = Rd.xz[v * 2 + 3], L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-6) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L, t = (x - ax) * tx + (z - az) * tz, d = -(x - ax) * tz + (z - az) * tx;
        if (t >= -m && t <= L + m && d <= Rd.curbL[r] + m && d >= -Rd.curbR[r] - m) return true;
      }
      return false;
    }
    // 口の所（_portalSites の帯、口の前 ±stopNear m）で終わる地上の線路（ほかの走り・口の掘割につながらない端）は、車道の上なら車道に入る所の
    //   termGap m 手前まで縮め、そこに止め（stops: [x, y, z, 向き x, 向き z, 前の車道までの m]）を置く。線路はただ道の上で終わらない（NC3 の直し 4）
    //   dead（NC3 の直し 5）: 口の所に限らず、どこにもつながらない端（行き止まりの操車場の線・el の留置線・建物に入る線）も: 建物の壁の前なら
    //   暗い口（kind 2: 壁の前の暗い面と枠 = 建物の横のトンネルの口・車庫の戸口）、ほかは端に車止め（kind 1、格子なし。縮めない）。
    //   つながっている = チャンクの縁・口の囲い・ほかの走りから 1 m（el の床の先の段: 2 m・高さの差 0.1〜0.8 m）・地図の端から edgeDist m・止めが付いている
    _trackStops(runs, cr, dead) {
      const pc = this.portalCfg, near = pc.stopNear, gap = pc.termGap, cm = pc.cwMargin, eb = 0.1;
      const P3 = (p, k) => [p[k], p[k + 1], p[k + 2]];
      const isJoined = (r, x, z, y) => {
        if (Math.min(x - cr[0], cr[2] - x, z - cr[1], cr[3] - z) < eb) return !(dead && this._skipAt(x, z) && !this._edgeCont(cr, x, z)); // 作れなかった口の所でチャンクの縁に切れた端は、隣のチャンクに続きが無ければ止める
        for (const o of this._portals) if (this._inObb(o, x, z, 1.5)) return true;
        for (const o of runs) {
          if (o === r) continue;
          const q = o.pts;
          for (let k = 3; k < q.length; k += 3) {
            if (segDist2(x, z, q[k - 3], q[k - 1], q[k], q[k + 2]) >= 1) continue;
            if (!dead) return true;
            // dead: 高さも 0.8 m 以内（真上の el の線路につながっているとは数えない）
            const dx = q[k] - q[k - 3], dz = q[k + 2] - q[k - 1], L2 = dx * dx + dz * dz, u = L2 > 0 ? Math.max(0, Math.min(1, ((x - q[k - 3]) * dx + (z - q[k - 1]) * dz) / L2)) : 0;
            if (Math.abs(q[k - 2] + (q[k + 1] - q[k - 2]) * u - y) <= 0.8) return true;
          }
        }
        return false;
      };
      const atSite = (x, z) => {
        if (dead) return true;
        for (const o of this._portalSites) {
          const dx = x - o.ox, dz = z - o.oz, s = dx * o.ux + dz * o.uz, l = dx * o.vx + dz * o.vz;
          if (s >= -near && s <= near && l >= o.l0 - 1 && l <= o.l1 + 1) return true;
        }
        return false;
      };
      const drop = new Set();
      // 端 end（0 = 始め、1 = 終わり）を止める。戻り値: 'stop' | 'all'（全部が車道の上）| null
      const stopEnd = (r, end) => {
        const p = r.pts, n = p.length / 3;
        if (n < 2) return null;
        const pts = []; // 端からの点の列（[x, y, z]）
        for (let k = 0; k < n; k++) pts.push(P3(p, end ? (n - 1 - k) * 3 : k * 3));
        const onCw = this._onCarriageway(pts[0][0], pts[0][2], cm);
        let cut = 0;
        if (onCw) { // 端から戻って、車道の上の続き（0.5 m ごと）を抜けた所
          let dist = 0;
          cut = null;
          for (let k = 1; k < pts.length && cut == null; k++) {
            const A = pts[k - 1], B = pts[k], L = Math.hypot(B[0] - A[0], B[2] - A[2]), m = Math.max(1, Math.ceil(L / 0.5));
            for (let j = 1; j <= m; j++) {
              const u = j / m;
              if (!this._onCarriageway(A[0] + (B[0] - A[0]) * u, A[2] + (B[2] - A[2]) * u, cm)) { cut = dist + L * u; break; }
            }
            dist += L;
          }
          if (cut == null) return 'all';
        }
        // 止めの所 = 車道を抜けた所から gap m 戻った所（端が車道の上でなければ端そのもの）
        const want = onCw ? cut + gap : 0;
        let acc = 0, k = 1, at = null, dir = null;
        for (; k < pts.length; k++) {
          const A = pts[k - 1], B = pts[k], L = Math.hypot(B[0] - A[0], B[2] - A[2]);
          if (L > 1e-6 && (!dir || acc <= want)) dir = [(A[0] - B[0]) / L, (A[2] - B[2]) / L];
          if (acc + L >= want) { const u = L > 1e-6 ? (want - acc) / L : 0; at = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u]; break; }
          acc += L;
        }
        if (!at || !dir) return null; // 走りが短すぎる
        const keep = [at].concat(pts.slice(k));
        if (keep.length < 2 || Math.hypot(keep[1][0] - at[0], keep[1][2] - at[2]) < 1e-3 && keep.length < 3) return null;
        const flat = [];
        for (const q of (end ? keep.slice().reverse() : keep)) flat.push(r2(q[0]), r2(q[1]), r2(q[2]));
        r.pts = flat;
        // 止めの前の格子の長さ（車道の縁から 0.2 m 手前まで、gap m まで）
        let room = 0;
        for (let d = 0.25; d <= gap + 1e-6; d += 0.25) { if (this._onCarriageway(at[0] + dir[0] * d, at[2] + dir[1] * d, 0.2)) break; room = d; }
        (r.stops || (r.stops = [])).push([at[0], at[1], at[2], dir[0], dir[1], room]);
        return 'stop';
      };
      const ec = this.elCfg || {}, edgeD = ec.edgeDist != null ? ec.edgeDist : 6, rc = this.railCfg;
      const deadJoined = (r, end, E) => { // dead のときだけ: el の床の先の段・地図の端・止めの付いた端
        if (Math.min(E[0] - this.minX, this.maxX - E[0], E[2] - this.minZ, this.maxZ - E[2]) < edgeD) return true;
        if (r.stops) for (const q of r.stops) if (Math.hypot(q[0] - E[0], q[2] - E[2]) < 1.5) return true;
        for (const o of runs) {
          if (o === r) continue;
          const q = o.pts, m = q.length / 3;
          for (const k of [0, (m - 1) * 3]) { const dy = Math.abs(q[k + 1] - E[1]); if (Math.hypot(q[k] - E[0], q[k + 2] - E[2]) <= 2 && dy >= 0.1 && dy <= 0.8) return true; }
        }
        return false;
      };
      // 端 E（向き d = 走りの外へ）の先 0〜1.5 m に建物の片の壁（レールの高さ）があるか
      const wallAhead = (E, d) => { // → 口の高さ（建物 mouthH m、床の下面までの低い床（盛り土・低い道の橋）はその高さ）か 0
        for (let t = 0; t <= 1.5; t += 0.25) {
          const x = E[0] + d[0] * t, z = E[2] + d[1] * t;
          if (this._pieceInSpan(x, z, E[1] + 0.2, E[1] + 1.5)) return pc.mouthH;
          const h = this._deckWallAt(x, z, E[1]);
          if (h > 0) return h;
        }
        return 0;
      };
      for (const r of runs) {
        for (const end of [0, 1]) {
          if (drop.has(r)) break;
          const p = r.pts, n = p.length / 3, E = P3(p, end ? (n - 1) * 3 : 0);
          if (n < 2 || !atSite(E[0], E[2]) || isJoined(r, E[0], E[2], E[1])) continue;
          if (dead) {
            if (deadJoined(r, end, E)) continue;
            const F = P3(p, end ? (n - 2) * 3 : 3), L = Math.hypot(E[0] - F[0], E[2] - F[2]);
            if (L < 1e-6) continue;
            const d = [(E[0] - F[0]) / L, (E[2] - F[2]) / L];
            const wh = wallAhead(E, d);
            if (wh > 0) { (r.stops || (r.stops = [])).push([E[0], E[1], E[2], d[0], d[1], wh, 2]); continue; } // 建物の壁・盛り土の口（向きは止めと同じ = 端から外へ。q[5] = 口の高さ）
            const sk = this._skipAt(E[0], E[2]); // 作れなかった口の所: 止めの先に暗い格子（トンネルへ下りる）
            (r.stops || (r.stops = [])).push([E[0], E[1], E[2], d[0], d[1], sk ? pc.termGap : 0, sk ? 0 : 1]); continue; // 車止め（車道の上でも縮めない = 隣のチャンクの続きと食い違わない）
          }
          if (stopEnd(r, end) !== 'all') continue;
          // 全部が車道の上の走り（地面の高さの変わり目で切れた端の部分）: 捨てて、つながっていた走りの端を止める
          const O = P3(p, end ? 0 : (n - 1) * 3);
          drop.add(r);
          for (const o of runs) {
            if (o === r || drop.has(o)) continue;
            const q = o.pts, m = q.length / 3;
            for (const e2 of [0, 1]) {
              const Q = P3(q, e2 ? (m - 1) * 3 : 0);
              if (Math.hypot(Q[0] - O[0], Q[2] - O[2]) < 1 && stopEnd(o, e2) === 'all') drop.add(o);
            }
          }
        }
      }
      if (drop.size) for (let k = runs.length - 1; k >= 0; k--) if (drop.has(runs[k])) runs.splice(k, 1);
    }
    // (x, z) の床（el の盛り土・データの床）がレールの高さ y の上 0.3 m より上・下面が y + 1.5 m より下 = 線路の前の壁: その下面（から y まで）の高さ、無ければ 0
    _deckWallAt(x, z, y) {
      const D = this._decks, dkc = this._deckCell, bb = this._deckBB;
      if (!D || !dkc) return 0;
      const gi = Math.floor((x - this.minX) / dkc.cell), gj = Math.floor((z - this.minZ) / dkc.cell);
      if (gi < 0 || gj < 0 || gi >= dkc.W || gj >= dkc.H) return 0;
      const gk = gj * dkc.W + gi, dc = dkc.csr;
      let best = 0;
      for (let k = dc.start[gk]; k < dc.start[gk + 1]; k++) {
        const i = dc.items[k];
        if (x < bb[i * 4] || x > bb[i * 4 + 2] || z < bb[i * 4 + 1] || z > bb[i * 4 + 3]) continue;
        if (D.eflag && (D.eflag[i] & (2 | 4 | 8))) continue; // 隠れた屋根・ホーム・口の床
        const top = D.plane[i * 3] * x + D.plane[i * 3 + 1] * z + D.plane[i * 3 + 2], tk = D.tk && D.tk[i] === D.tk[i] ? D.tk[i] : D.thickness || 1.2, bot = top - tk;
        if (top <= y + 0.3 || bot >= y + 1.5 || !this._nearDeck(i, x, z, 0)) continue;
        best = Math.max(best, Math.max(0.6, top - 0.1 - y));
      }
      return best;
    }
    // 作れなかった口（_portalSkips）の所か: 口から前後 skipNear m・幅 + 2 m
    _skipAt(x, z) {
      const nr = this.portalCfg.skipNear;
      for (const o of this._portalSkips) {
        const dx = x - o.ox, dz = z - o.oz, s = dx * o.ux + dz * o.uz, l = dx * o.vx + dz * o.vz;
        if (s >= -nr && s <= nr && l >= o.l0 - 2 && l <= o.l1 + 2) return o;
      }
      return null;
    }
    // 踏切の坂の砂利の盛り 1 つ（a → b のレールの下、幅 wedgeW m、上面は線路の高さ − 0.03 m の斜面、下面は地面 g の下）
    _wedgePrism(w, cr) {
      const [ax, az, ay, bx, bz, by, g] = w, L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) return null;
      const tx = (bx - ax) / L, tz = (bz - az) / L, hw = this.railCfg.wedgeW / 2, nx = -tz * hw, nz = tx * hw;
      const ring = [ax + nx, az + nz, ax - nx, az - nz, bx - nx, bz - nz, bx + nx, bz + nz];
      const q = clipRing(ring, 0, 4, cr), m = q.length >> 1;
      if (m < 3 || Math.abs(areaOf(q, m)) < 0.02) return null;
      const sl = (by - ay) / L, A = sl * tx, B = sl * tz, C = ay - 0.03 - A * ax - B * az, top = Math.max(ay, by) - 0.03;
      return lazyTri({ ring: new Float32Array(q), holes: [], clip: clipBitsFor([q], cr), top: [C, A, B], t: top - g + 0.3, y0: Math.min(ay, by) - 0.03 - (top - g + 0.3), y1: top, f: F.NOCOL, mat: this.railCfg.yardMat, cat: 'portal' });
    }
    // 線路の止めの柱（低い壁 termH m・厚さ termT m・幅 stopW m と、その前の暗い格子 grateH m。当たりなし）
    _stopPrisms(q, cr) {
      const pc = this.portalCfg, [x, y, z, fx, fz, room] = q, nx = -fz, nz = fx, hw = pc.stopW / 2, out = [];
      const rect = (s0, s1, w) => [x + fx * s0 - nx * w, z + fz * s0 - nz * w, x + fx * s1 - nx * w, z + fz * s1 - nz * w, x + fx * s1 + nx * w, z + fz * s1 + nz * w, x + fx * s0 + nx * w, z + fz * s0 + nz * w];
      const add = (ring, y0, y1, mat) => {
        const q2 = clipRing(ring, 0, 4, cr), m = q2.length >> 1;
        if (m < 3 || Math.abs(areaOf(q2, m)) < 0.02) return;
        out.push(lazyTri({ ring: new Float32Array(q2), holes: [], clip: clipBitsFor([q2], cr), y0, y1, f: F.NOCOL, mat, cat: 'portal', stop: 1 }));
      };
      if (q[6] === 2) { // 建物の壁の口: 壁の前の暗い面（幅 mouthW m・高さ mouthH m）と枠（柱 2 本と上の梁、mouthFrame m 角）。q の向き (fx, fz) は走りの中へ = 壁は −f の側
        const mw = pc.mouthW / 2, mh = room > 0 ? Math.min(room, pc.mouthH) : pc.mouthH, fr = pc.mouthFrame;
        add(rect(-0.3, 0.12, mw), y - 0.05, y + mh, pc.stubMat);
        if (mh < pc.mouthH - 1e-6) return out; // 低い床の下（盛り土・道の橋）: 暗い面だけ（枠は床の上に出る）
        const side = (l0, l1) => [x + fx * -0.3 + nx * l0, z + fz * -0.3 + nz * l0, x + fx * 0.25 + nx * l0, z + fz * 0.25 + nz * l0, x + fx * 0.25 + nx * l1, z + fz * 0.25 + nz * l1, x + fx * -0.3 + nx * l1, z + fz * -0.3 + nz * l1];
        add(side(mw, mw + fr), y - 0.1, y + mh + fr, pc.mat);
        add(side(-mw - fr, -mw), y - 0.1, y + mh + fr, pc.mat);
        add(rect(-0.3, 0.25, mw), y + mh, y + mh + fr, pc.mat);
        return out;
      }
      add(rect(-pc.termT, 0, hw), y - 0.1, y + pc.termH, pc.mat);
      if (room > 0.3) add(rect(0, room, hw - 0.2), y - 0.05, y + pc.grateH, pc.stubMat);
      return out;
    }
    // タイルの線 i（W = ずらした線）が低い道の床（データの床、上面がレールより crossMin〜passCap m 上）の下を通る所: 床の鎖ごとに線の下での
    //   一番高い上面 → 鎖の上面が crossMax m 以下なら踏切（cross: 線路は道の面へ crossGrade の坂で上がる）、高ければくぐる（under: 線路は地面のまま、
    //   その床は線路の固い物にしない）。線ごとに 1 回 = チャンクによらない。無ければ null（NC3 の直し 5: サニーサイドの操車場の低い道の橋）
    _xingOf(tile, i, W) {
      if (W.xing !== undefined) return W.xing;
      const rc = this.railCfg, D = this._decks, dkc = this._deckCell, bb = this._deckBB, n0 = D && D.elStart != null ? D.elStart : D ? D.count : 0;
      let mx = null;
      if (D && dkc) for (let v = 0; v + 1 < W.n; v++) {
        const ax = W.xz[v * 2], az = W.xz[v * 2 + 1], bx = W.xz[v * 2 + 2], bz = W.xz[v * 2 + 3], L = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(L));
        for (let k = 0; k <= m; k++) {
          const u = k / m, y = W.y[v] + (W.y[v + 1] - W.y[v]) * u;
          if (y >= rc.air) continue;
          const x = ax + (bx - ax) * u, z = az + (bz - az) * u, g = Math.max(0, y) + 0.15;
          const gi = Math.floor((x - this.minX) / dkc.cell), gj = Math.floor((z - this.minZ) / dkc.cell);
          if (gi < 0 || gj < 0 || gi >= dkc.W || gj >= dkc.H) continue;
          const gk = gj * dkc.W + gi, dc = dkc.csr;
          for (let q = dc.start[gk]; q < dc.start[gk + 1]; q++) {
            const d = dc.items[q];
            if (x < bb[d * 4] || x > bb[d * 4 + 2] || z < bb[d * 4 + 1] || z > bb[d * 4 + 3]) continue;
            const h = D.plane[d * 3] * x + D.plane[d * 3 + 1] * z + D.plane[d * 3 + 2] - g;
            if (h <= rc.crossMin || h > rc.passCap || !this._nearDeck(d, x, z, 0)) continue;
            let c = D.chain[d];
            if (d >= n0 && !this._elCrossing(d, bx - ax, bz - az)) { if (h > rc.deckTol) { if (!mx) mx = new Map(); mx.set(c, Infinity); } continue; } // 並ぶ el の床（坂・盛り土）: 低い所は _deckTopNear の el の床の上、高ければくぐる
            if (d >= n0) { if (h > rc.crossMax) { if (!mx) mx = new Map(); mx.set(c, Infinity); continue; } c = -1 - d; } // 横切る el の床は片ごと（鎖は el の線全部）
            if (!mx) mx = new Map();
            if (!(mx.get(c) >= h)) mx.set(c, h);
          }
        }
      }
      let out = null;
      if (mx) { out = { cross: new Set(), under: new Set() }; for (const [c, h] of mx) (h <= rc.crossMax ? out.cross : out.under).add(c); }
      W.xing = out;
      return out;
    }
    // (x, z) から nd m 以内に、上面がレールの高さ y ± tol m の床が 2 つ以上の鎖にある（床どうしの隙間 = 床の先の宙ではない）: 一番近い上面
    _crackTop(x, z, y, tol, nd) {
      const D = this._decks, dkc = this._deckCell, bb = this._deckBB;
      if (!D || !dkc) return null;
      const gi = Math.floor((x - this.minX) / dkc.cell), gj = Math.floor((z - this.minZ) / dkc.cell);
      if (gi < 0 || gj < 0 || gi >= dkc.W || gj >= dkc.H) return null;
      const gk = gj * dkc.W + gi, dc = dkc.csr;
      let best = null, c0 = -1, two = false;
      for (let k = dc.start[gk]; k < dc.start[gk + 1]; k++) {
        const i = dc.items[k];
        if (x < bb[i * 4] - nd || x > bb[i * 4 + 2] + nd || z < bb[i * 4 + 1] - nd || z > bb[i * 4 + 3] + nd) continue;
        if (D.eflag && (D.eflag[i] & 2)) continue;
        const yd = D.plane[i * 3] * x + D.plane[i * 3 + 1] * z + D.plane[i * 3 + 2];
        if (Math.abs(yd - y) > tol || !this._nearDeck(i, x, z, nd)) continue;
        if (c0 < 0) c0 = D.chain[i]; else if (D.chain[i] !== c0) two = true;
        if (best == null || Math.abs(yd - y) < Math.abs(best - y)) best = yd;
      }
      return two ? best : null;
    }
    // el の床の片 d（4 角 kind 0: [左の始まり, 右の始まり, 右の終わり, 左の終わり]）を向き (dx, dz) の線が横切るか（30° より大きい角）
    _elCrossing(d, dx, dz) {
      const D = this._decks;
      if (!(D.eflag[d] & 1) || D.kind[d] !== 0 || D.vertStart[d + 1] - D.vertStart[d] !== 4) return false;
      const a = D.vertStart[d], ux = D.xz[(a + 3) * 2] - D.xz[a * 2], uz = D.xz[(a + 3) * 2 + 1] - D.xz[a * 2 + 1], L = Math.hypot(ux, uz) * Math.hypot(dx, dz);
      return L > 1e-9 && Math.abs(ux * dx + uz * dz) / L < 0.87;
    }
    // 踏切の線路の高さ: 低い道の床（cross の鎖、またはどの線もくぐらない床で (x, z) の所の上面が crossMax m 以下）の上面か、床の外 m m までは
    //   縁までの距離 × crossGrade だけ下げた高さ（坂）。どれも y 以下なら null
    _lowRoad(x, z, y, m, X) {
      const D = this._decks, dkc = this._deckCell, bb = this._deckBB, rc = this.railCfg, n0 = D && D.elStart != null ? D.elStart : D ? D.count : 0;
      if (!D || !dkc) return null;
      const i0 = Math.max(0, Math.floor((x - m - this.minX) / dkc.cell)), i1 = Math.min(dkc.W - 1, Math.floor((x + m - this.minX) / dkc.cell));
      const j0 = Math.max(0, Math.floor((z - m - this.minZ) / dkc.cell)), j1 = Math.min(dkc.H - 1, Math.floor((z + m - this.minZ) / dkc.cell));
      let best = null;
      for (let gj = j0; gj <= j1; gj++) for (let gi = i0; gi <= i1; gi++) {
        const gk = gj * dkc.W + gi, dc = dkc.csr;
        for (let k = dc.start[gk]; k < dc.start[gk + 1]; k++) {
          const i = dc.items[k];
          if (x < bb[i * 4] - m || x > bb[i * 4 + 2] + m || z < bb[i * 4 + 1] - m || z > bb[i * 4 + 3] + m) continue;
          const c = i >= n0 ? -1 - i : D.chain[i];
          if ((i >= n0 && !(X && X.cross.has(c) && (D.eflag[i] & 1))) || (i < n0 && X && X.under.has(c))) continue;
          const yd = D.plane[i * 3] * x + D.plane[i * 3 + 1] * z + D.plane[i * 3 + 2], h = yd - y;
          if (h <= rc.crossMin || h > (X && X.cross.has(c) && i < n0 ? rc.passCap : rc.crossMax)) continue; // el の床（鎖 = 線全部）は踏切の高さまで
          const a = D.vertStart[i], e = D.vertStart[i + 1];
          let inside = false, d2 = Infinity;
          for (let u = a, w = e - 1; u < e; w = u++) {
            const xu = D.xz[u * 2], zu = D.xz[u * 2 + 1], xw = D.xz[w * 2], zw = D.xz[w * 2 + 1];
            if ((zu > z) !== (zw > z) && x < (xw - xu) * (z - zu) / (zw - zu) + xu) inside = !inside;
            d2 = Math.min(d2, segDist2(x, z, xw, zw, xu, zu));
          }
          if (!inside && d2 > m * m) continue;
          const r = inside ? yd : yd - rc.crossGrade * Math.sqrt(d2);
          if (r > y && (best == null || r > best)) best = r;
        }
      }
      return best;
    }
    // チャンクの縁 (x, z) で隣のチャンクの線路（止めの前の形 = _railRuns の noDead）の端が 1 m 以内にあるか
    _edgeCont(cr, x, z) {
      const c = this.chunkOf(x + (x - cr[0] < 0.5 ? -1 : cr[2] - x < 0.5 ? 1 : 0), z + (z - cr[1] < 0.5 ? -1 : cr[3] - z < 0.5 ? 1 : 0));
      if (!this._inRange(c.cx, c.cz)) return false;
      const t = this._chunkTile(c.cx, c.cz, false);
      if (!t) return false;
      for (const o of this._railRuns(c.cx, c.cz, t, true)) {
        const q = o.pts, m = q.length / 3;
        for (const k of [0, (m - 1) * 3]) if (Math.hypot(q[k] - x, q[k + 2] - z) < 1) return true;
      }
      return false;
    }
    _railRuns(cx, cz, tile, noDead) {
      const ci = cz * this.ncx + cx;
      const hit = noDead ? null : this._railCache.get(ci);
      if (hit && hit.tile === tile) { this._railCache.delete(ci); this._railCache.set(ci, hit); return hit.runs; }
      const runs = [], R = tile && tile.rails, rc = this.railCfg;
      const cr = this.chunkRect(cx, cz);
      const list = [];
      if (R && R.count) {
        const info = this._railInfo(tile), bb = info.bb, mg = rc.shift + 1;
        for (let i = 0; i < R.count; i++) {
          if (R.flags[i] & rc.skipFlags & ~2) continue; // トンネル（2）は地面より上の坂（el の床の上）だけ描く（baseAt）
          if (bb[i * 4 + 2] < cr[0] - mg || bb[i * 4] > cr[2] + mg || bb[i * 4 + 3] < cr[1] - mg || bb[i * 4 + 1] > cr[3] + mg) continue;
          list.push([i, this._railShift(tile, info, i)]);
        }
      }
      if (list.length) {
        // 台（歩道・広場。操車場も同じ高さ）の上面。チャンクの縁の点はチャンクの中へ少し寄せて見る（台の行はチャンクの矩形で切ってあり、縁の上の点は
        //   どちらの台にも入らなかった = 縁の 1〜3 m で砂利が台の下へ沈んでいた）
        const L = tile.plinths, pl = [];
        if (L) {
          const rows = NycData.chunkRows(L, tile, cx, cz);
          for (let i = rows[0]; i < rows[1]; i++) {
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let v = L.vertStart[L.ringStart[i]]; v < L.vertStart[L.ringStart[i] + 1]; v++) { const x = L.xz[v * 2], z = L.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
            pl.push([i, x0, z0, x1, z1, L.y[i]]);
          }
        }
        const ex = rc.edgeIn;
        const plinthTop = (x, z) => {
          x = Math.min(cr[2] - ex, Math.max(cr[0] + ex, x)); z = Math.min(cr[3] - ex, Math.max(cr[1] + ex, z));
          for (const q of pl) if (x >= q[1] && x <= q[3] && z >= q[2] && z <= q[4] && NycData.pointIn(L, q[0], x, z)) return q[5];
          return null;
        };
        // 固い物の索引（16 m の升）: ゲームの層の柱（床・入れる建物・残り。縁の壁は除く）と箱、タイルの CPRS の柱（_detail と同じ: 消した建物・
        //   入れない ENTB の残りを除き、通り抜けの床は _spans で抜く）
        const SG = 16, SW = Math.ceil(128 / SG), cells = [];
        for (let k = 0; k < SW * SW; k++) cells.push([]);
        const solids = [];
        const addSolid = (x0, z0, x1, z1, it) => {
          const i0 = Math.max(0, Math.floor((x0 - cr[0]) / SG)), i1 = Math.min(SW - 1, Math.floor((x1 - cr[0]) / SG));
          const j0 = Math.max(0, Math.floor((z0 - cr[1]) / SG)), j1 = Math.min(SW - 1, Math.floor((z1 - cr[1]) / SG));
          if (i0 > i1 || j0 > j1) return;
          const n = solids.length;
          solids.push(it);
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * SW + i].push(n);
        };
        const g = this._game(cx, cz);
        const bw = rc.ballastClear;
        for (const p of g.prisms) {
          if (p.cat === 'fence' || p.cat === 'prop' || (p.f & F.NOCOL)) continue;
          const r = p.ring;
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = 0; v < r.length; v += 2) { if (r[v] < x0) x0 = r[v]; if (r[v] > x1) x1 = r[v]; if (r[v + 1] < z0) z0 = r[v + 1]; if (r[v + 1] > z1) z1 = r[v + 1]; }
          // 床の縁の壁は砂利の帯（中心から ballastClear m）にかかれば描かない（_railShift がよけきれなかった所）
          if (p.cat === 'barrier') addSolid(x0 - bw, z0 - bw, x1 + bw, z1 + bw, { k: 3, p, x0: x0 - bw, z0: z0 - bw, x1: x1 + bw, z1: z1 + bw });
          else addSolid(x0, z0, x1, z1, { k: 0, p, x0, z0, x1, z1 });
        }
        for (const b of g.E.boxes) {
          if (b.cat === 'fence' || b.cat === 'prop' || b.cat === 'barrier' || (b.f & F.NOCOL)) continue;
          addSolid(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, { k: 1, x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2, y0: b.y, y1: b.y + b.h });
        }
        const P = tile.prisms, CP = this.core && this.core.pieces;
        if (P && CP) {
          const rows = NycData.chunkRows(P, tile, cx, cz);
          for (let i = rows[0]; i < rows[1]; i++) {
            const piece = P.piece[i];
            if (this._sup[piece]) continue;
            if ((P.flags[i] & R_ENTREM) && this._entOf[piece] >= 0 && !this._entOn(this._entOf[piece])) continue;
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let v = P.vertStart[P.ringStart[i]]; v < P.vertStart[P.ringStart[i] + 1]; v++) { const x = P.xz[v * 2], z = P.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
            for (const sp of this._spans(piece, CP.y0[piece], CP.y1f[piece])) addSolid(x0, z0, x1, z1, { k: 2, row: i, x0, z0, x1, z1, y0: sp[0], y1: sp[1] });
          }
        }
        const solidAt = (x, z, y, rail) => { // rail: レールの所の点（縁の壁の砂利の帯は中心だけで見る）
          const rx = x, rz = z; // 縁の壁の砂利の帯は寄せない点で（ずらした線は壁から ballastClear m ちょうどの所もある = 5 cm 寄せると切れ、
          //   チャンクの縁を浅い角で横切る所に 0.36 m の隙間が開いた。41_50 / 41_51）
          x = Math.min(cr[2] - ex, Math.max(cr[0] + ex, x)); z = Math.min(cr[3] - ex, Math.max(cr[1] + ex, z)); // 縁の点は中へ（plinthTop と同じ）
          const i = Math.min(SW - 1, Math.max(0, Math.floor((x - cr[0]) / SG))), j = Math.min(SW - 1, Math.max(0, Math.floor((z - cr[1]) / SG)));
          for (const n of cells[j * SW + i]) {
            const s = solids[n];
            let top, bot;
            if (s.k === 3) {
              if (rail || rx < s.x0 || rx > s.x1 || rz < s.z0 || rz > s.z1) continue;
              const p = s.p;
              bot = (p.top ? p.top[0] + p.top[1] * rx + p.top[2] * rz : p.y1) - (p.t != null ? p.t : p.y1 - p.y0);
              if (Math.abs(bot - y) > rc.deckTol) continue;
              const r = p.ring, bq = p.deck >= this._elChain0 ? rc.elBallastClear : bw; // el の床の縁の壁は近くまで（データの線と el の線のずれ: マンハッタン橋の地下鉄）
              if (inRing(r, rx, rz)) return true;
              for (let v = 0, n = r.length >> 1; v < n; v++) { const w = (v + 1) % n; if (segDist2(rx, rz, r[v * 2], r[v * 2 + 1], r[w * 2], r[w * 2 + 1]) < bq * bq) return true; }
              continue;
            }
            if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
            if (s.k === 0) {
              const p = s.p;
              top = p.top ? p.top[0] + p.top[1] * x + p.top[2] * z : p.y1;
              bot = p.t != null ? top - p.t : p.y0;
              if (top <= y + rc.solidAbove || bot >= y + rc.solidBelow) continue;
              if (!inRing(p.ring, x, z) || (p.holes && p.holes.some((h) => inRing(h, x, z)))) continue;
              return true;
            }
            top = s.y1; bot = s.y0;
            if (top <= y + rc.solidAbove || bot >= y + rc.solidBelow) continue;
            if (s.k === 2 && !NycData.pointIn(P, s.row, x, z)) continue;
            return true;
          }
          return false;
        };
        let onTun = false; // 今の線がトンネルの線か（地面より上の坂だけ el の床の上に描く）
        let xing = null; // 今の線が低い道の床を渡る・くぐるか（踏切: _xingOf）
        const elMin = this.elCfg ? this.elCfg.minY : Infinity;
        // 足元 → [高さ, 地上か]。NaN = 描かない
        // nx, nz: 線の法線（あれば左右のレールの所 ± railCheck m も固い物の中なら描かない = 道の斜路・建物の壁にレールが刺さらない）
        const baseAt = (x, z, y, nx, nz) => {
          if (this._railHide.length && this._inHide(x, z)) return NaN; // 口の前の掘割と覆い（NC3 の直し 4）
          const mouth = onTun ? this._inMouth(x, z, y, rc.air) : 0; // 道を覆って奥へずらした口の前 [0, a)（NC3 の直し 3）: トンネルの線を地面の線路として（踏切）。2 = 口の前の地面の少し上のトンネルの線
          if (mouth === 1) y = 0;
          if (y < rc.below) return NaN;
          let b = null, fromDeck = true;
          // 床（橋・高架の車道、NC3 の el の床）がレールの高さにあればその上（el の坂の低い所 elMin〜air m も）
          if (y >= rc.air || y >= elMin) b = this._deckTopNear(x, z, y, rc.deckTol, this._ci(x, z));
          // 地上の線路が低い el の床（坂）に覆われる所（並んで上がっていく線の横）は el の床の上
          if (b == null && !onTun && y < rc.air && this._elCols) b = this._deckTopNear(x, z, y, rc.deckTol, this._ci(x, z), true, 0, xing && xing.under); // くぐる el の床（浅い角で横切る盛り土）には乗らない
          if (b == null && y >= rc.air) b = this._crackTop(x, z, y, rc.deckTol, rc.crack); // 2 つの床の間の細い隙間（el の床とデータの床の継ぎ目: マンハッタン橋）
          if (b == null) {
            if (y >= rc.air || (onTun && !mouth)) return NaN; // 床の無い高架・トンネル（口の中は _portalTracks）
            if (this._cuts.length && this._inCut(x, z, 0)) return NaN; // 掘割の上（NC3）
            fromDeck = false;
            b = plinthTop(x, z);
            if (b == null) {
              const gr = this.groundAt(x, z);
              b = gr.water === null ? gr.y : this._deckTopNear(x, z, y, rc.deckTol, this._ci(x, z));
              if (b == null) return NaN;
            }
            if (xing && xing.cross.size) { const r = this._lowRoad(x, z, b, rc.crossMax / rc.crossGrade, xing); if (r != null && r > b) b = r; } // 踏切: 道の面へ crossGrade の坂で上がる
          }
          if (solidAt(x, z, b)) { // 少し上（deckTol m まで）に重なるほかの床（上げ方の違う el の床どうし）があればその上（床の上の線路だけ）
            if (!fromDeck) return NaN;
            const b2 = this._deckTopNear(x, z, b + rc.deckTol / 2 + 0.01, rc.deckTol / 2, this._ci(x, z));
            if (b2 == null || b2 <= b + 0.01 || solidAt(x, z, b2)) return NaN;
            b = b2;
          }
          const o = rc.railCheck;
          if (nx !== undefined && o > 0 && (solidAt(x + nx * o, z + nz * o, b, true) || solidAt(x - nx * o, z - nz * o, b, true))) return NaN;
          return b;
        };
        const emit = (V) => { // V: [x, z, y] の列（切った線の 1 本）→ 走り
          const S = []; // 細かく分けた点 [x, z, base, 元の点か, 元の y]
          let nx = 0, nz = 0; // 今の辺の法線
          const nrm = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 1e-6) { nx = -(b[1] - a[1]) / L; nz = (b[0] - a[0]) / L; } };
          const at = (x, z, y, o) => { y = this._elAdjAt(x, z, y); S.push([x, z, baseAt(x, z, y, nx, nz), o, y, nx, nz]); }; // NC3: 道を渡る所で上げ下げした el の高さ
          if (V.length > 1) nrm(V[0], V[1]);
          for (let k = 0; k < V.length; k++) {
            if (k > 0) {
              const a = V[k - 1], b = V[k], L2 = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L2 / rc.step));
              nrm(a, b);
              for (let s = 1; s < n; s++) { const u = s / n; at(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, 0); }
            }
            at(V[k][0], V[k][1], V[k][2], 1);
          }
          // 段（地上の高さの違い・描かない所の始まりと終わり）は縁の所まで 2 分探しで詰めて、縁の両側に点を置く
          const T = [];
          for (let k = 0; k < S.length; k++) {
            if (k > 0) {
              const p = S[k - 1], q = S[k], fp = p[2] === p[2], fq = q[2] === q[2];
              if ((fp !== fq) || (fp && fq && p[4] < rc.air && q[4] < rc.air && Math.abs(p[2] - q[2]) > rc.flat)) {
                let lo = 0, hi = 1, vlo = p[2], vhi = q[2];
                const side = (v) => (v === v) !== fp ? 1 : (!fq || !fp) ? 0 : Math.abs(v - p[2]) <= Math.abs(v - q[2]) ? 0 : 1;
                for (let it = 0; it < rc.edgeIters; it++) {
                  const u = (lo + hi) / 2, v = baseAt(p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[4] + (q[4] - p[4]) * u, q[5], q[6]);
                  if (side(v)) { hi = u; vhi = v; } else { lo = u; vlo = v; }
                }
                const P0 = (u, v) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, v, 1, p[4] + (q[4] - p[4]) * u, q[5], q[6]];
                if (lo > 0) T.push(P0(lo, vlo));
                if (hi < 1) T.push(P0(hi, vhi));
              }
            }
            T.push(S[k]);
          }
          let cur = null;
          const flush = () => {
            if (cur && cur.length >= 2) {
              // 元の線の途中の点（0）は高さが flat m より曲がっていなければ捨てる（同じ元の辺の上 = xz は一直線。高さだけの Douglas–Peucker）
              const keep = [cur[0]];
              const dp = (a, b) => {
                const A = cur[a], B = cur[b], LL = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
                let w = -1, wd = rc.flat;
                for (let j = a + 1; j < b; j++) { const u = Math.hypot(cur[j][0] - A[0], cur[j][1] - A[1]) / LL, e = Math.abs(cur[j][2] - (A[2] + (B[2] - A[2]) * u)); if (e > wd) { wd = e; w = j; } }
                if (w >= 0) { dp(a, w); dp(w, b); } else keep.push(B);
              };
              let a = 0;
              for (let k = 1; k < cur.length; k++) {
                if (!cur[k][3] && k < cur.length - 1) continue;
                dp(a, k); a = k;
              }
              let len = 0;
              for (let k = 1; k < keep.length; k++) len += Math.hypot(keep[k][0] - keep[k - 1][0], keep[k][1] - keep[k - 1][1]);
              if (len >= rc.minRun) {
                const pts = [];
                let sx = 0, sz = 0;
                for (const q of keep) { pts.push(r2(q[0]), r2(q[2]), r2(q[1])); sx += q[0]; sz += q[1]; }
                runs.push({ pts, x: r2(sx / keep.length), z: r2(sz / keep.length) });
              }
            }
            cur = null;
          };
          for (let k = 0; k < T.length; k++) {
            const q = T[k];
            if (q[2] !== q[2]) { flush(); continue; }
            if (cur) {
              const l = cur[cur.length - 1], dy = Math.abs(q[2] - l[2]), hd = Math.hypot(q[0] - l[0], q[1] - l[1]);
              // 段（台の縁・el の床の端）: maxRise より高いか、ほとんど同じ所で 0.1 m より高い段は切る（縦の線にしない）。
              //   el の高さの線が床に乗ったまま上る坂（道を渡る所の raise: 21 %）は deckSlope の勾配まで切らない（NC3 の直し 5。アストリア線の 11 m の切れ目）
              const onEl = (o) => o[4] >= elMin && Math.abs(o[2] - o[4]) <= rc.deckTol;
              if ((dy > rc.maxRise && !(hd > 0.05 && dy <= hd * rc.deckSlope && onEl(q) && onEl(l))) || (dy > 0.1 && hd < 0.05)) flush();
            }
            if (!cur) cur = [];
            else { const l = cur[cur.length - 1]; if (Math.abs(q[0] - l[0]) < 0.02 && Math.abs(q[1] - l[1]) < 0.02 && Math.abs(q[2] - l[2]) < 0.01) continue; } // 同じ点（段の 2 分探しの両側が同じ高さ）は 1 つ
            cur.push(q);
          }
          flush();
        };
        for (const [i, W] of list) {
          onTun = (R.flags[i] & 2) !== 0;
          xing = onTun ? null : this._xingOf(tile, i, W);
          const XZ = W.xz, YY = W.y;
          // 線を矩形で切る（Liang–Barsky。y は線に沿って補う）
          let V = [];
          const n0 = runs.length;
          for (let v = 0; v + 1 < W.n; v++) {
            const ax = XZ[v * 2], az = XZ[v * 2 + 1], bx = XZ[v * 2 + 2], bz = XZ[v * 2 + 3], ay = YY[v], by = YY[v + 1];
            const dx = bx - ax, dz = bz - az;
            let t0 = 0, t1 = 1, ok = true;
            const Pq = [-dx, dx, -dz, dz], Q = [ax - cr[0], cr[2] - ax, az - cr[1], cr[3] - az];
            for (let e = 0; e < 4 && ok; e++) {
              const p = Pq[e], q = Q[e];
              if (p === 0) { if (q < 0) ok = false; continue; }
              const t = q / p;
              if (p < 0) { if (t > t1) ok = false; else if (t > t0) t0 = t; } else if (t < t0) ok = false; else if (t < t1) t1 = t;
            }
            if (!ok || t1 - t0 < 1e-9) { if (V.length) { emit(V); V = []; } continue; }
            const P0 = [ax + dx * t0, az + dz * t0, ay + (by - ay) * t0], P1 = [ax + dx * t1, az + dz * t1, ay + (by - ay) * t1];
            if (V.length && (Math.abs(V[V.length - 1][0] - P0[0]) > 1e-6 || Math.abs(V[V.length - 1][1] - P0[1]) > 1e-6)) { emit(V); V = []; }
            if (!V.length) V.push(P0);
            V.push(P1);
            if (t1 < 1) { emit(V); V = []; }
          }
          if (V.length) emit(V);
          for (let k = n0; k < runs.length; k++) { runs[k].cls = R.cls[i]; runs[k].flags = R.flags[i]; }
        }
        // 離れた短い切れ端（isolatedMin m より短く、どちらの端もチャンクの縁（= 隣のチャンクへ続く）でも、ほかの走りから isolatedJoin m 以内でもない）は
        //   描かない（固い物・段の間に残った 2〜8 m の線。デランシー通りの 32_52 など）。チャンクの中で閉じた走りだけなので、隣のチャンクと食い違わない
        if (this._portalSites.length && runs.length) this._trackStops(runs, cr); // 口の所で道の上に終わる線路の止め（NC3 の直し 4）
        if (rc.isolatedMin > 0 && runs.length) {
          const jn2 = rc.isolatedJoin * rc.isolatedJoin, eb = 0.1;
          const lenOf = (p) => { let L = 0; for (let k = 3; k < p.length; k += 3) L += Math.hypot(p[k] - p[k - 3], p[k + 2] - p[k - 1]); return L; };
          const joined = (r, x, z) => {
            if (Math.min(x - cr[0], cr[2] - x, z - cr[1], cr[3] - z) < eb) return true;
            for (const o of this._portals) if (this._inObb(o, x, z, 1.5)) return true; // 口の掘割へ続く（線路は _portalTracks）
            if (r.stops) return true; // 線路の止め（_trackStops）
            for (const o of runs) {
              if (o === r) continue;
              const q = o.pts;
              for (let k = 3; k < q.length; k += 3) if (segDist2(x, z, q[k - 3], q[k - 1], q[k], q[k + 2]) < jn2) return true;
            }
            return false;
          };
          const drop = runs.filter((r) => { const p = r.pts; return lenOf(p) < rc.isolatedMin && !joined(r, p[0], p[2]) && !joined(r, p[p.length - 3], p[p.length - 1]); });
          if (drop.length) for (let k = runs.length - 1; k >= 0; k--) if (drop.includes(runs[k])) runs.splice(k, 1);
        }
        if (rc.deadEnds !== false && runs.length && !noDead) this._trackStops(runs, cr, true); // どこにもつながらない端の止め・建物の口（NC3 の直し 5）
        // 踏切の坂（_lowRoad で地面より上げた線路）の下の砂利の盛り（描画の層だけ・当たりなし: runs.wedges = [[ax, az, ay, bx, bz, by, g], …]）
        for (const r of runs) {
          const p = r.pts;
          if (r.flags & 2) continue;
          let prev = null;
          for (let k = 3; k < p.length; k += 3) {
            const ax = p[k - 3], ay = p[k - 2], az = p[k - 1], bx = p[k], by = p[k + 1], bz = p[k + 2], L = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(L));
            if (Math.max(ay, by) > rc.crossMax + 0.6) { prev = null; continue; }
            for (let j = 0; j <= m; j++) {
              const u = j / m, x = ax + (bx - ax) * u, z = az + (bz - az) * u, y = ay + (by - ay) * u;
              let g = plinthTop(x, z);
              if (g == null) { const gr = this.groundAt(x, z); g = gr.water === null ? gr.y : null; }
              const up = g != null && y - g > 0.06 && this._deckTopNear(x, z, y, 0.04, this._ci(x, z)) == null;
              const cur = up ? [x, z, y, g] : null;
              if (cur && prev) (runs.wedges || (runs.wedges = [])).push([prev[0], prev[1], prev[2], x, z, y, Math.min(prev[3], g)]);
              prev = cur;
            }
          }
        }
      }
      if (noDead) return runs;
      this._railCache.set(ci, { tile, runs });
      if (this._railCache.size > 64) this._railCache.delete(this._railCache.keys().next().value);
      return runs;
    }
    _props(out, tile, cx, cz) {
      const T = this.plan.props || {}, types = T.types || {}, fences = T.fences || {};
      const en = this.meta && this.meta.enums;
      const P = tile.props, ch = this.curbH;
      // 駐車の車（ゲームの層 = サーバーと同じ）の上にはデータの小物・柵を置かない（車が勝つ。描画の層だけの物なので消してもサーバーと食い違わない）
      const vs = [], K = (this.plan.vehicles && this.plan.vehicles.parking) || {}, sizes = K.sizes || {};
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!this._inRange(cx + dx, cz + dz)) continue;
        for (const v of this._vehMap().get((cz + dz) * this.ncx + cx + dx) || []) {
          if (v.type === 'heli' || v.type === 'jet') continue;
          const sz = sizes[v.type] || [2.4, 5.2], a = v.yaw * Math.PI / 180;
          vs.push([v.x, v.z, Math.sin(a), Math.cos(a), sz[1] / 2 + 0.3, sz[0] / 2 + 0.3]);
        }
      }
      const onCar = (x, z, pad) => {
        for (const q of vs) { const ux = x - q[0], uz = z - q[1], u = ux * q[2] + uz * q[3], w = ux * q[3] - uz * q[2]; if (Math.abs(u) < q[4] + pad && Math.abs(w) < q[5] + pad) return true; }
        return false;
      };
      let rows = NycData.chunkRows(P, tile, cx, cz);
      for (let i = rows[0]; i < rows[1]; i++) {
        const name = en ? en.pointKind[P.kind[i]] : '';
        const t = types[name];
        if (!t) continue;
        const x = P.xz[i * 2], z = P.xz[i * 2 + 1];
        if (this._foot.length && this._inFoot(x, z, 1)) continue; // ランドマークの中のデータの小物（v1 の組み立てが自分の小物を置く）
        if ((this._cuts.length && this._inCut(x, z, 0.8)) || (this._elCols && this._elColNear(x, z, 0.8))) continue; // 掘割の中・el の柱（NC3）
        if (vs.length && onCar(x, z, t.box ? Math.max(t.box[0], t.box[2] != null ? t.box[2] : t.box[0]) : 0.3)) continue;
        let rot;
        if (P.yaw[i]) { const a = P.yaw[i] / 256 * Math.PI * 2; rot = Math.atan2(Math.cos(a), Math.sin(a)) + (t.flip ? Math.PI : 0); } // +Z が車道の方
        else rot = (mix(Math.round(x * 10), Math.round(z * 10)) % 6283) / 1000;
        out.props.push({ type: t.type, x: r2(x), y: ch, z: r2(z), rot: Math.round(rot * 1000) / 1000, kind: name });
        if (t.box) {
          const hw = t.box[0], h = t.box[1], hd = t.box[2] != null ? t.box[2] : hw;
          out.boxes.push({ x: r2(x), y: ch, z: r2(z), w: hw * 2, h, d: hd * 2, mat: t.mat || 'metalDark', cat: 'prop', f: t.walk ? F.WALK : 0 });
        }
      }
      const Fz = tile.fences;
      rows = NycData.chunkRows(Fz, tile, cx, cz);
      for (let i = rows[0]; i < rows[1]; i++) {
        const name = en ? en.lineKind[Fz.kind[i]] : '';
        const fc = fences[name] || fences.default || {};
        const x0 = Fz.seg[i * 4], z0 = Fz.seg[i * 4 + 1], x1 = Fz.seg[i * 4 + 2], z1 = Fz.seg[i * 4 + 3];
        let h = Fz.h[i];
        // データに高さが無い（ビルダーの既定の高さ dataH のまま）なら設定の h（公園の柵は 1.8 m の黒い壁に見えた）
        if (fc.h != null && fc.dataH != null && Math.abs(h - fc.dataH) < 0.01) h = fc.h;
        const th = Math.max(0.05, Fz.t[i]), L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.05 || h < 0.1) continue;
        if (this._foot.length && (this._inFoot(x0, z0, 0.5) || this._inFoot(x1, z1, 0.5) || this._inFoot((x0 + x1) / 2, (z0 + z1) / 2, 0.5))) continue;
        if (this._cuts.length || this._elCols) { // 掘割の上・el の柱（NC3）
          let hit = false;
          const ns = Math.max(1, Math.ceil(L));
          for (let k = 0; k <= ns && !hit; k++) { const x = x0 + (x1 - x0) * k / ns, z = z0 + (z1 - z0) * k / ns; hit = this._inCut(x, z, 0.3) || (!!this._elCols && this._elColNear(x, z, th / 2 + 0.05)); }
          if (hit) continue;
        }
        if (vs.length) { let hitCar = false; const ns = Math.max(1, Math.ceil(L)); for (let k = 0; k <= ns && !hitCar; k++) hitCar = onCar(x0 + (x1 - x0) * k / ns, z0 + (z1 - z0) * k / ns, th); if (hitCar) continue; }
        const f = fc.nolos ? F.NOLOS : 0, mat = fc.mat || 'concrete';
        if (!fc.see && (Math.abs(x1 - x0) < 0.02 || Math.abs(z1 - z0) < 0.02)) {
          const ax = Math.abs(x1 - x0) < 0.02;
          out.boxes.push({ x: r2((x0 + x1) / 2), y: 0, z: r2((z0 + z1) / 2), w: ax ? th : L, h, d: ax ? L : th, mat, cat: 'fence', f, kind: name });
        } else {
          const nx = -(z1 - z0) / L * th / 2, nz = (x1 - x0) / L * th / 2;
          out.prisms.push(lazyTri({ ring: new Float32Array([x0 - nx, z0 - nz, x1 - nx, z1 - nz, x1 + nx, z1 + nz, x0 + nx, z0 + nz]), holes: [], clip: null, y0: 0, y1: h, f, mat, cat: 'fence', kind: name }));
        }
      }
    }
    // chunkFull().loot と同じもの（形を作らない。タイル無しで決まる）
    lootSpawns(cx, cz) {
      if (!this._inRange(cx, cz)) return [];
      const L = this._game(cx, cz).loot.slice();
      if (this.rail && this.rail.loot) this.rail.loot(L, cx, cz); // 駅の物（NC6。chunkFull と同じ）
      return L;
    }
    // サーバー用の固体（v1 と同じ形 + voids。core だけ）: 入れる建物の床と屋根（genEnterable から v1 と同じ選び方）・片の固い箱（E を dev + coarseInset
    //   内側に縮めたセル、チャンクで切る）・橋の床の段の箱・入れない ENTB も片の固い箱・R4 の cat 'under' と voids
    chunkCoarse(cx, cz) {
      if (!this._inRange(cx, cz)) return null;
      const out = { cx, cz, key: this.chunkKey(cx, cz), boxes: [], ramps: [], ladders: [], loot: [], voids: [] };
      if (!this.core) return out;
      const g = this._game(cx, cz), E = g.E;
      const keep = { exterior: 1, roof: 1, floor: 1, landmark: 1, pier: 1, road: 1 };
      for (const b of E.boxes) if (keep[b.cat] && !(b.f & (F.NOCOL | F.SHELL)) && Math.max(b.w, b.d) >= 2 && Math.min(b.w, b.d) >= 0.25 && !(b.h <= 1.3 && Math.min(b.w, b.d) <= 0.45)) out.boxes.push(b);
      for (const r of E.ramps) if (r.cat === 'road' || Math.min(r.w, r.d) >= 4) out.ramps.push(r);
      for (const b of this._solidBoxList(cx, cz)) out.boxes.push(b);
      for (const b of this._remBoxes(cx, cz, 'inset')) out.boxes.push({ x: (b[0] + b[2]) / 2, y: b[4], z: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[5] - b[4], d: b[3] - b[1], mat: 'concrete', cat: 'exterior', f: F.WALK, remnant: 1 });
      for (const b of this._deckSteps(cx, cz)) out.boxes.push(b);
      for (const b of E.boxes) if (b.el) out.boxes.push(b); // NC3: el の柱（細いので上の選び方では落ちる）
      if (this.rail && this.rail.emit) { // R4 のフック 7
        const tmp = this._emptyFull(cx, cz);
        this.rail.emit(tmp, cx, cz, false);
        for (const b of tmp.boxes) if (b.cat === 'under' && b.w >= 2 && b.d >= 2) out.boxes.push(b);
        for (const v of tmp.voids) out.voids.push(v);
      }
      return out;
    }
    // 消した建物の残りの箱（チャンクで切る）[[x0, z0, x1, z1, y0, y1], …]。'inset' = E を dev + coarseInset 内側に縮めた中のセル（サーバー・下限）、
    //   ほか = 中心が中のセル（飛行）
    _remBoxes(cx, cz, mode) {
      const out = [], list = this._remChunk.get(cz * this.ncx + cx);
      if (!list) return out;
      const r = this.chunkRect(cx, cz), e = this.engine, P = this.core && this.core.pieces;
      for (const i of list) {
        const rm = this._remnants[i], q = rm.ring;
        const A = Math.abs(areaOf(q, q.length >> 1));
        const step = Math.min(4, Math.max(mode === 'inset' ? (e.solidStepMin || 0.5) : 1.5, Math.sqrt(A) / 6));
        const inset = mode === 'inset' ? (P ? P.dev[rm.piece] : 0) + (e.coarseInset != null ? e.coarseInset : 0.25) : 0;
        const c = ringCells(q, r, step, inset);
        for (let k = 0; k < c.length; k += 4) out.push([c[k], c[k + 1], c[k + 2], c[k + 3], rm.y0, rm.y1]);
      }
      return out;
    }
    // チャンクの片の固い箱（'inset'）を v1 の箱の形で
    _solidBoxList(cx, cz) {
      const out = [], C = this.core;
      if (!C) return out;
      const P = C.pieces, ci = cz * this.ncx + cx, r = this.chunkRect(cx, cz);
      for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) {
        const p = P.chunkPieces[k];
        if (this._sup[p]) continue;
        const e = this._entOf[p];
        if (e >= 0 && this._entOn(e)) continue; // 入れる建物は genEnterable の床・屋根
        const bx = this._solid(p, 'inset');
        for (const sp of this._spans(p, P.y0[p], P.y1f[p])) {
          const y0 = sp[0], y1 = sp[1];
          if (y1 - y0 < 0.05) continue;
          for (let i = 0; i < bx.length; i += 4) {
            const x0 = Math.max(bx[i], r[0]), z0 = Math.max(bx[i + 1], r[1]), x1 = Math.min(bx[i + 2], r[2]), z1 = Math.min(bx[i + 3], r[3]);
            if (x1 - x0 < 0.01 || z1 - z0 < 0.01) continue;
            out.push({ x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, mat: 'concrete', cat: 'exterior', f: F.WALK, gid: P.gid[p], piece: p });
          }
        }
      }
      return out;
    }
    // 片の箱（世界の座標、チャンクで切らない）。mode: 'inset'（サーバー: E を dev + coarseInset 内側に縮めた中に収まるセル）|
    //   'center'（飛行: 中心が E の中のセル）| 'outset'（E ⊕ dev に触れるセル）。セルは E の外接矩形の格子、行ごとに x でつなぎ、
    //   同じ x の範囲の行は z でつなぐ（tools/nyc/checkv2.js の solidBoxes と同じセル = check.js の包絡の確かめがそのまま当てはまる）
    _solid(p, mode) {
      const key = (mode === 'inset' ? 0 : mode === 'center' ? 1 : mode === 'outset' ? 2 : 3) * 1e7 + p;
      let v = this._solidCache.get(key);
      if (v) { this._solidCache.delete(key); this._solidCache.set(key, v); return v; }
      v = this._solidCompute(p, mode);
      this._solidCache.set(key, v);
      if (this._solidCache.size > this._solidCap) this._solidCache.delete(this._solidCache.keys().next().value);
      return v;
    }
    _solidCompute(p, mode) {
      const P = this.core.pieces, e = this.engine;
      const coll = mode === 'insetC';           // 当たりの箱（サーバーの HeliCollider）: 同じ内側の形を粗いセルで（下限のまま。箱の数を減らす）
      if (coll) mode = 'inset';
      if (mode === 'inset' && (P.flags[p] & P_DEVSAT)) return new Float32Array(0);
      const bb = [P.bbox[p * 4], P.bbox[p * 4 + 1], P.bbox[p * 4 + 2], P.bbox[p * 4 + 3]];
      let A = 0;
      for (let k = P.ringStart[p]; k < P.ringStart[p + 1]; k++) A += NycData.signedArea(P.xz, P.vertStart[k], P.vertStart[k + 1]);
      const cstep = e.colliderStep || [1.5, 4];
      const smin = coll ? (e.colliderInsetStepMin || 1) : (e.solidStepMin || 0.5);
      const div = coll ? (e.colliderInsetDiv || 6) : 6, smax = coll ? (e.colliderInsetStepMax || 4) : 4;
      const s = mode === 'inset' ? Math.min(smax, Math.max(smin, Math.sqrt(Math.max(A, 0)) / div)) : Math.min(cstep[1], Math.max(cstep[0], Math.sqrt(Math.max(A, 0)) / 6));
      const dev = P.dev[p];
      const inset = mode === 'inset' ? dev + (e.coarseInset != null ? e.coarseInset : 0.25) : 0;
      const x0 = bb[0] + inset, z0 = bb[1] + inset, w = bb[2] - inset - x0, d = bb[3] - inset - z0;
      if (w <= 0.05 || d <= 0.05) return new Float32Array(0);
      const nx = Math.ceil(w / s - 1e-9), nz = Math.ceil(d / s - 1e-9), sx = w / nx, sz = d / nz;
      const E = blockEdges(P, p), xs = [];
      const runs = [];
      let open = new Map(); // "xa,xb" → 前の行から続いている箱
      for (let kz = 0; kz < nz; kz++) {
        const za = z0 + kz * sz, zb = kz === nz - 1 ? z0 + d : za + sz, zc = (za + zb) / 2;
        // この行の中心の高さで辺と交わる x（NycData.pointIn と同じ式・同じ向き = 同じ偶奇）。セルの中心より右の交点が奇数なら中
        xs.length = 0;
        for (let q = 0; q < E.length; q += 4) {
          const ax = E[q], az = E[q + 1], bx = E[q + 2], bz = E[q + 3];
          if ((bz > zc) !== (az > zc)) xs.push((ax - bx) * (zc - bz) / (az - bz) + bx);
        }
        xs.sort((u, v) => u - v);
        let xi = 0;
        const next = new Map();
        let run = null;
        const flush = () => {
          const k = run[0] + ',' + run[2], prev = open.get(k);
          if (prev && Math.abs(prev[3] - run[1]) < 1e-6) { prev[3] = run[3]; next.set(k, prev); } else { runs.push(run); next.set(k, run); }
          run = null;
        };
        for (let kx = 0; kx < nx; kx++) {
          const xa = x0 + kx * sx, xb = kx === nx - 1 ? x0 + w : xa + sx;
          const xc = (xa + xb) / 2;
          while (xi < xs.length && xs[xi] <= xc) xi++;
          let ok = ((xs.length - xi) & 1) === 1;
          if (mode === 'inset') {
            if (ok) for (let q = 0; q < E.length && ok; q += 4) {
              // 外接矩形で先に落とす（ほとんどの辺は遠い）
              if (Math.min(E[q], E[q + 2]) > xb + inset || Math.max(E[q], E[q + 2]) < xa - inset || Math.min(E[q + 1], E[q + 3]) > zb + inset || Math.max(E[q + 1], E[q + 3]) < za - inset) continue;
              if (rectSegDist(xa, za, xb, zb, E[q], E[q + 1], E[q + 2], E[q + 3]) < inset - 1e-9) ok = false;
            }
          } else if (mode === 'outset' && !ok) {
            for (let q = 0; q < E.length && !ok; q += 4) {
              if (Math.min(E[q], E[q + 2]) > xb + dev || Math.max(E[q], E[q + 2]) < xa - dev || Math.min(E[q + 1], E[q + 3]) > zb + dev || Math.max(E[q + 1], E[q + 3]) < za - dev) continue;
              if (rectSegDist(xa, za, xb, zb, E[q], E[q + 1], E[q + 2], E[q + 3]) <= dev) ok = true;
            }
          }
          if (ok) { if (run) run[2] = xb; else run = [xa, za, xb, zb]; } else if (run) flush();
        }
        if (run) flush();
        open = next;
      }
      const out = new Float32Array(runs.length * 4);
      for (let i = 0; i < runs.length; i++) { out[i * 4] = runs[i][0]; out[i * 4 + 1] = runs[i][1]; out[i * 4 + 2] = runs[i][2]; out[i * 4 + 3] = runs[i][3]; }
      return out;
    }
    // サーバーの当たり（colliderBoxes 'inset'）の入れない建物: チャンクの中の片をまとめた形の 1 m の格子。片ごとに縮める
    //   _solid(p, 'inset') だと、セットバックの輪（塔の芯の周りの幅 2 m の U 字）・細い片・隣の建物と接する片は 0 個になり、
    //   FiDi・Village で建物の中の点の約 3 割がサーバーでは開いていた（壁を歩いて抜ける・建物越しに当たる）。
    //   ここでは外の辺（外の側が同じ高さで別の片に覆われていない部分）だけを dev + coarseInset 縮める: 片の辺を 0.25 m ごとに切り、
    //   外へ dev + 0.2 m の 3 点が、どの高さで（入れない・消していない・dev が飽和していない）ほかの片の中か → 外の辺の高さの区間。
    //   セルの中心を含む片の高さの和から、近い（< その辺の dev + coarseInset）外の辺の高さを引いた区間が箱 [x0, z0, x1, z1, y0, y1]。
    //   下限のまま: セルは片の E の和の中で、外の辺から dev + coarseInset 以上内側（隣と接する辺の dev ぶんの隙間は人が入れない幅）
    _unionSolid(cx, cz) {
      const C = this.core, P = C.pieces, e = this.engine, r = this.chunkRect(cx, cz), rnd = !!e.colliderRoundInset;
      const coarse = e.coarseInset != null ? e.coarseInset : 0.25, step = e.colliderUnionStep || 2, seg = 0.5, pad = 4, BK = 8;
      const X0 = r[0] - pad, Z0 = r[1] - pad, X1 = r[2] + pad, Z1 = r[3] + pad;
      const S = [], seen = new Set(), spans = [], EE = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const kx = cx + dx, kz = cz + dz;
        if (kx < 0 || kz < 0 || kx >= this.ncx || kz >= this.ncz) continue;
        const ci = kz * this.ncx + kx;
        for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) {
          const p = P.chunkPieces[k];
          if (seen.has(p)) continue;
          seen.add(p);
          if (P.bbox[p * 4] > X1 || P.bbox[p * 4 + 2] < X0 || P.bbox[p * 4 + 1] > Z1 || P.bbox[p * 4 + 3] < Z0) continue;
          if (this._sup[p] || (P.flags[p] & P_DEVSAT)) continue;
          const en = this._entOf[p];
          if (en >= 0 && this._entOn(en)) continue;
          const y0 = P.y0[p], y1 = P.y1f[p];
          if (y1 <= 1.0 || y1 - y0 < 0.2) continue;
          const sp = this._spans(p, y0, y1).filter((q) => q[1] - q[0] >= 0.05);
          if (!sp.length) continue;
          spans[S.length] = sp;
          EE[S.length] = blockEdges(P, p);
          S.push(p);
        }
      }
      if (!S.length) return [];
      const BW = Math.ceil((X1 - X0) / BK), BH = Math.ceil((Z1 - Z0) / BK);
      const bi = (x) => Math.max(0, Math.min(BW - 1, Math.floor((x - X0) / BK))), bj = (z) => Math.max(0, Math.min(BH - 1, Math.floor((z - Z0) / BK)));
      const pB = new Array(BW * BH);
      for (let s = 0; s < S.length; s++) {
        const p = S[s];
        for (let j = bj(P.bbox[p * 4 + 1]); j <= bj(P.bbox[p * 4 + 3]); j++) for (let i = bi(P.bbox[p * 4]); i <= bi(P.bbox[p * 4 + 2]); i++) (pB[j * BW + i] || (pB[j * BW + i] = [])).push(s);
      }
      const merge = (L) => { // 区間の和（並べて重ならない形）
        if (L.length < 2) return L.length ? [L[0]] : [];
        const a = L.slice().sort((u, v) => u[0] - v[0]), out = [a[0].slice()];
        for (let i = 1; i < a.length; i++) { const t = out[out.length - 1]; if (a[i][0] <= t[1] + 1e-6) { if (a[i][1] > t[1]) t[1] = a[i][1]; } else out.push(a[i].slice()); }
        return out;
      };
      const minus = (A, B) => { // 区間の差
        let cur = A;
        for (const b of B) {
          const nx = [];
          for (const a of cur) {
            if (b[1] <= a[0] || b[0] >= a[1]) { nx.push(a); continue; }
            if (b[0] > a[0]) nx.push([a[0], b[0]]);
            if (b[1] < a[1]) nx.push([b[1], a[1]]);
          }
          cur = nx;
          if (!cur.length) break;
        }
        return cur;
      };
      // (x, z) の外の高さ: own から (x, z) を含むほかの片の高さを引いた区間
      const extAt = (x, z, skip, own) => {
        if (x < X0 || x > X1 || z < Z0 || z > Z1) return own;
        const a = pB[bj(z) * BW + bi(x)];
        if (!a) return own;
        let L = null;
        for (const s of a) {
          const q = S[s];
          if (q === skip || P.bbox[q * 4] > x || P.bbox[q * 4 + 2] < x || P.bbox[q * 4 + 1] > z || P.bbox[q * 4 + 3] < z) continue;
          if (NycData.pointIn(P, q, x, z)) { if (!L) L = []; for (const iv of spans[s]) L.push(iv); }
        }
        return L ? minus(own, merge(L)) : own;
      };
      const same = (A, B) => { if (A === B) return true; if (A.length !== B.length) return false; for (let i = 0; i < A.length; i++) if (A[i][0] !== B[i][0] || A[i][1] !== B[i][1]) return false; return true; };
      const nxC = Math.round((r[2] - r[0]) / step), nzC = Math.round((r[3] - r[1]) / step);
      const forb = new Array(nxC * nzC);
      const mark = (sx0, sz0, sx1, sz1, ins, ext) => { // 外の辺の一部から ins より近いセルに、引く高さを付ける
        const ex0 = Math.min(sx0, sx1) - ins, ex1 = Math.max(sx0, sx1) + ins, ez0 = Math.min(sz0, sz1) - ins, ez1 = Math.max(sz0, sz1) + ins;
        if (ex1 < r[0] || ex0 > r[2] || ez1 < r[1] || ez0 > r[3]) return;
        const i0 = Math.max(0, Math.floor((ex0 - r[0]) / step)), i1 = Math.min(nxC - 1, Math.floor((ex1 - r[0]) / step));
        const j0 = Math.max(0, Math.floor((ez0 - r[1]) / step)), j1 = Math.min(nzC - 1, Math.floor((ez1 - r[1]) / step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const xa = r[0] + i * step, za = r[1] + j * step;
          if (rectSegDist(xa, za, xa + step, za + step, sx0, sz0, sx1, sz1) >= ins - 1e-9) continue;
          const c = j * nxC + i;
          if (!forb[c]) forb[c] = [ext]; else if (forb[c][forb[c].length - 1] !== ext) forb[c].push(ext);
        }
      };
      // 外の辺: 辺ごとに外へ dev + 0.2 m の 5 点。全部同じなら辺全体、違えば 0.5 m ごとに 2 点
      const FS = [0.05, 0.27, 0.5, 0.73, 0.95];
      for (let si = 0; si < S.length; si++) {
        const p = S[si], E = EE[si], ins = P.dev[p] + coarse, dlt = P.dev[p] + 0.2, own = spans[si];
        for (let q = 0; q < E.length; q += 4) {
          const ax = E[q], az = E[q + 1], bx = E[q + 2], bz = E[q + 3], L = Math.hypot(bx - ax, bz - az);
          if (L < 1e-6) continue;
          if (Math.max(ax, bx) < r[0] - ins || Math.min(ax, bx) > r[2] + ins || Math.max(az, bz) < r[1] - ins || Math.min(az, bz) > r[3] + ins) continue;
          const ux = (bx - ax) / L, uz = (bz - az) / L;
          let nx = -uz, nz = ux; // 外向き: 中点の少し外が片の外になる側
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const inA = NycData.pointIn(P, p, mx + nx * 0.05, mz + nz * 0.05), inB = NycData.pointIn(P, p, mx - nx * 0.05, mz - nz * 0.05);
          if (inA && !inB) { nx = -nx; nz = -nz; } else if (inA === inB) { mark(ax, az, bx, bz, ins, own); continue; } // 向きが分からない（退化）: 外の辺のまま
          const at = (f) => extAt(ax + (bx - ax) * f + nx * dlt, az + (bz - az) * f + nz * dlt, p, own);
          const e0 = at(FS[0]);
          let uni = true;
          for (let k = 1; k < FS.length && uni; k++) if (!same(at(FS[k]), e0)) uni = false;
          if (uni) { if (e0.length) mark(ax, az, bx, bz, ins, e0); continue; }
          const n = Math.max(1, Math.ceil(L / seg));
          for (let k = 0; k < n; k++) {
            const t0 = k / n, t1 = (k + 1) / n, a1 = at(t0 + (t1 - t0) * 0.2), a2 = at(t0 + (t1 - t0) * 0.8);
            const ext = same(a1, a2) ? a1 : merge(a1.concat(a2));
            if (ext.length) mark(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, ins, ext);
          }
        }
      }
      // セル（世界の step の格子。チャンクの境目でそろう）: 行ごとに片の辺との交点で中の x の区間 → セルの中心を含む片の高さの和
      //   − 近い外の辺の高さ（整数 m に内側へ丸める = put の丸めと同じ）。欲張りの長方形（x へ伸ばし、その x の範囲の次の行が全部同じ区間なら z へ）
      const keys = new Array(nxC * nzC), Hs = new Map(), cov = new Array(nxC), xs = [];
      for (let kz = 0; kz < nzC; kz++) {
        const zc = r[1] + (kz + 0.5) * step;
        cov.fill(null);
        const a = pB[bj(zc) * BW + bi(r[0])]; void a;
        for (let si = 0; si < S.length; si++) {
          const p = S[si];
          if (P.bbox[p * 4 + 1] > zc || P.bbox[p * 4 + 3] < zc || P.bbox[p * 4] > r[2] || P.bbox[p * 4 + 2] < r[0]) continue;
          const E = EE[si];
          xs.length = 0;
          for (let q = 0; q < E.length; q += 4) {
            const ax = E[q], az = E[q + 1], bx = E[q + 2], bz = E[q + 3];
            if ((bz > zc) !== (az > zc)) xs.push((ax - bx) * (zc - bz) / (az - bz) + bx);
          }
          if (xs.length < 2) continue;
          xs.sort((u, v) => u - v);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const i0 = Math.max(0, Math.ceil((xs[k] - r[0]) / step - 0.5)), i1 = Math.min(nxC - 1, Math.floor((xs[k + 1] - r[0]) / step - 0.5));
            for (let i = i0; i <= i1; i++) { if (!cov[i]) cov[i] = []; for (const iv of spans[si]) cov[i].push(iv); }
          }
        }
        for (let kx = 0; kx < nxC; kx++) {
          if (!cov[kx]) continue;
          let H = merge(cov[kx]);
          const fl = forb[kz * nxC + kx];
          if (fl) for (const ex of fl) { H = minus(H, ex); if (!H.length) break; }
          let key = '';
          const Q = [];
          for (const iv of H) {
            const lo = rnd ? Math.ceil(iv[0] - 1e-6) : iv[0], hi = rnd ? Math.floor(iv[1] + 1e-6) : iv[1];
            if (hi - lo < (rnd ? 1 : 0.2)) continue;
            Q.push([lo, hi]); key += lo + ':' + hi + ';';
          }
          if (!key) continue;
          keys[kz * nxC + kx] = key;
          if (!Hs.has(key)) Hs.set(key, Q);
        }
      }
      const out = [];
      for (let kz = 0; kz < nzC; kz++) for (let kx = 0; kx < nxC; kx++) {
        const key = keys[kz * nxC + kx];
        if (!key) continue;
        let i1 = kx;
        while (i1 + 1 < nxC && keys[kz * nxC + i1 + 1] === key) i1++;
        let j1 = kz;
        grow: while (j1 + 1 < nzC) {
          for (let i = kx; i <= i1; i++) if (keys[(j1 + 1) * nxC + i] !== key) break grow;
          j1++;
        }
        for (let j = kz; j <= j1; j++) for (let i = kx; i <= i1; i++) keys[j * nxC + i] = undefined;
        for (const iv of Hs.get(key)) out.push([r[0] + kx * step, r[1] + kz * step, r[0] + (i1 + 1) * step, r[1] + (j1 + 1) * step, iv[0], iv[1]]);
      }
      return out;
    }
    // 細い片の中心線の壁（colliderBoxes 'inset'。チャンクの矩形 r で切る）
    _thinWall(p, r, out) {
      const P = this.core.pieces, y0 = P.y0[p], y1 = P.y1f[p], H = 0.02;
      if (y1 <= 1.0 || y1 - y0 < 0.2) return;
      const bx0 = P.bbox[p * 4], bz0 = P.bbox[p * 4 + 1], bx1 = P.bbox[p * 4 + 2], bz1 = P.bbox[p * 4 + 3];
      let x0, z0, x1, z1;
      if (bx1 - bx0 >= bz1 - bz0) { const zc = (bz0 + bz1) / 2; x0 = bx0; x1 = bx1; z0 = zc - H; z1 = zc + H; } else { const xc = (bx0 + bx1) / 2; z0 = bz0; z1 = bz1; x0 = xc - H; x1 = xc + H; }
      x0 = Math.max(x0, r[0]); z0 = Math.max(z0, r[1]); x1 = Math.min(x1, r[2]); z1 = Math.min(z1, r[3]);
      if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
      for (const sp of this._spans(p, y0, y1)) if (sp[1] - sp[0] >= 0.05) out.push({ x0, z0, x1, z1, y0: sp[0], y1: sp[1], f: 2, thin: 1, piece: p });
    }
    // 橋の床のサーバーの段の箱（下限）: 片ごとに長い方の向きへ min(4, 0.285 / 勾配) m の段、横は段の長さくらいの正方形に分け、
    //   それぞれの中に収まる軸平行の正方形。上端 = その区画の路面の一番低い所、厚さ = 床の厚さ
    _deckSteps(cx, cz, minStep) {
      const out = [], C = this.core;
      if (!C || !this._decks) return out;
      const D = this._decks, dc = this._deckChunk, ci = cz * this.ncx + cx, t0 = D.thickness || 1.2, cr = this.chunkRect(cx, cz);
      const rise = (this.plan.decks && this.plan.decks.stepRise) || 0.285;
      for (let k = dc.start[ci]; k < dc.start[ci + 1]; k++) {
        const i = dc.items[k], a = D.vertStart[i], n = D.vertStart[i + 1] - a;
        if (n < 3) continue;
        const A = D.plane[i * 3], Bp = D.plane[i * 3 + 1], Cc = D.plane[i * 3 + 2];
        const t = D.eflag && D.eflag[i] && D.tk[i] === D.tk[i] ? D.tk[i] : t0;
        const V = [];
        for (let v = 0; v < n; v++) V.push([D.xz[(a + v) * 2], D.xz[(a + v) * 2 + 1]]);
        // 4 角は双一次の格子（0-1 = 始まりの辺、3-2 = 終わりの辺）、三角形は (0, 1, 2) を 2 と 2 が重なった 4 角として
        const Q = n >= 4 ? V : [V[0], V[1], V[2], V[2]];
        const lerp = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
        const at = (u, w) => lerp(lerp(Q[0], Q[3], u), lerp(Q[1], Q[2], u), w); // u: 長さ方向、w: 横
        const len = Math.max(Math.hypot(Q[3][0] - Q[0][0], Q[3][1] - Q[0][1]), Math.hypot(Q[2][0] - Q[1][0], Q[2][1] - Q[1][1]));
        const wid = Math.max(Math.hypot(Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]), Math.hypot(Q[2][0] - Q[3][0], Q[2][1] - Q[3][1]));
        const grade = Math.hypot(A, Bp);
        const step = minStep || Math.max(0.5, Math.min(4, grade > 1e-6 ? rise / grade : 4)); // minStep（当たりの箱）: 長い段（上端は段の一番低い所なのでやはり下限）
        const nu = Math.max(1, Math.ceil(len / step)), nw = Math.max(1, Math.ceil(wid / step));
        for (let iu = 0; iu < nu; iu++) for (let iw = 0; iw < nw; iw++) {
          const c = [at((iu + 0.5) / nu, 0), at((iu + 0.5) / nu, 1)];
          void c;
          const p00 = at(iu / nu, iw / nw), p10 = at((iu + 1) / nu, iw / nw), p11 = at((iu + 1) / nu, (iw + 1) / nw), p01 = at(iu / nu, (iw + 1) / nw);
          const mx = (p00[0] + p10[0] + p11[0] + p01[0]) / 4, mz = (p00[1] + p10[1] + p11[1] + p01[1]) / 4;
          // 中心から各辺までの距離の最小 → 収まる正方形の半分 h（辺の向きの和で割る）
          let hh = Infinity;
          const quad = [p00, p10, p11, p01];
          for (let q = 0; q < 4; q++) {
            const e0 = quad[q], e1 = quad[(q + 1) % 4], ex = e1[0] - e0[0], ez = e1[1] - e0[1], L = Math.hypot(ex, ez);
            if (L < 1e-6) continue;
            const nx = -ez / L, nz = ex / L;
            const dist = Math.abs((mx - e0[0]) * nx + (mz - e0[1]) * nz);
            hh = Math.min(hh, dist / (Math.abs(nx) + Math.abs(nz)));
          }
          if (!(hh > 0.25)) continue;
          if (mx < cr[0] || mx >= cr[2] || mz < cr[1] || mz >= cr[3]) continue; // 片は外接矩形の重なるどのチャンクにも入る: 段の中心がこのチャンクの物だけ
          const bx0 = mx - hh, bx1 = mx + hh, bz0 = mz - hh, bz1 = mz + hh;
          if (this._deckCut.length && this._deckCut.some((R) => bx0 < R[2] && bx1 > R[0] && bz0 < R[3] && bz1 > R[1])) continue; // ランドマークの中で抜いた床（下限のまま）
          const top = Math.min(A * bx0 + Bp * bz0, A * bx1 + Bp * bz0, A * bx0 + Bp * bz1, A * bx1 + Bp * bz1) + Cc;
          out.push({ x: mx, y: top - t, z: mz, w: hh * 2, h: t, d: hh * 2, mat: 'asphalt_city', cat: 'road', f: F.WALK, deck: D.chain[i] });
        }
      }
      return out;
    }
    // 遠景用: core PRT の E 外形をこのチャンクで切った柱（o = このチャンク）+ 歩道の台（タイルがあれば）+ 橋の床 + R4 フック 8
    chunkLod(cx, cz) {
      if (!this._inRange(cx, cz)) return null;
      const out = { cx, cz, key: this.chunkKey(cx, cz), boxes: [], ramps: [], prisms: [] };
      if (!this.core) return out;
      const P = this.core.pieces, ci = cz * this.ncx + cx, r = this.chunkRect(cx, cz);
      for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) {
        const p = P.chunkPieces[k];
        if (this._sup[p]) continue;
        // 入れる建物の片: 近景（genEnterable）を出すのは区画の中心のチャンクだけなので、遠景もそのチャンクが切らずに全部出す
        //   （隣のチャンクの切り口の分を出すと、隣が近景・持ち主が遠景のとき uHide で穴、逆のとき二重になった）
        const eo = this._entOwner(p);
        if (eo >= 0 && eo !== ci) continue;
        const pr = this._clipPiece(p, eo >= 0 ? WHOLE : r, ci);
        if (pr) out.prisms.push(pr);
      }
      const tile = this._chunkTile(cx, cz, true);
      if (tile && tile.version >= 2) {
        const L = tile.plinths, pm = this.plan.plinthMats || ['sidewalk'], rows = NycData.chunkRows(L, tile, cx, cz);
        for (let i = rows[0]; i < rows[1]; i++) for (const q of this._cutRects(this._plinth(L, i, cx, cz, pm, tile), this._plinthCut, r)) for (const q2 of this._cutPits(q, r)) out.prisms.push(q2);
        const tr = this._railRuns(cx, cz, tile); // 線路は砂利の帯だけ（world.js buildLod）
        if (tr.length) out.tracks = tr.map((t) => ({ pts: t.pts }));
      }
      const g = this._game(cx, cz);
      for (const p of g.prisms) if ((p.deck != null && p.cat === 'road' && !p.hide) || p.remnant || (p.el && !p.hide)) out.prisms.push(p);
      for (const b of g.E.boxes) if (b.el) out.boxes.push(b); // NC3: el の柱
      if (g.st) { // 静的な物（v1 の chunkLod と同じ選び方。lm 付きの箱は GLB が読めたら world.js が消す）
        for (const b of g.st.boxes) if ((b.cat === 'landmark' || b.cat === 'exterior' || b.cat === 'roof' || b.cat === 'pier' || b.cat === 'road' || b.cat === 'sidewalk') && !(b.f & F.NOCOL) && Math.max(b.w, b.d, b.h) >= 3) out.boxes.push(b);
        for (const p of g.st.ramps) if (p.cat === 'road') out.ramps.push(p);
      }
      if (this.rail && this.rail.lod) this.rail.lod(out, cx, cz); // R4 のフック 8（高架の桁。under は出さない）
      return out;
    }
    // 入れる建物（ENTB で _entOn）の片なら、近景を出すチャンク（区画の長方形の中心のチャンク）の番号。ほかは −1
    _entOwner(p) {
      const r = this._entOf[p];
      if (r < 0 || !this._entOn(r)) return -1;
      const EN = this.core.entb;
      return this._ci((EN.rect[r * 4] + EN.rect[r * 4 + 2]) / 2, (EN.rect[r * 4 + 1] + EN.rect[r * 4 + 3]) / 2);
    }
    // 片 p の E をチャンクの矩形 r で切った柱（無ければ null）
    _clipPiece(p, r, ci, full) {
      const P = this.core.pieces;
      const bx0 = P.bbox[p * 4], bz0 = P.bbox[p * 4 + 1], bx1 = P.bbox[p * 4 + 2], bz1 = P.bbox[p * 4 + 3];
      if (bx1 <= r[0] || bx0 >= r[2] || bz1 <= r[1] || bz0 >= r[3]) return null;
      const inside = bx0 >= r[0] && bx1 <= r[2] && bz0 >= r[1] && bz1 <= r[3];
      const rings = [];
      for (let k = P.ringStart[p]; k < P.ringStart[p + 1]; k++) {
        const a = P.vertStart[k], b = P.vertStart[k + 1];
        const q = inside ? Array.from(P.xz.subarray(a * 2, b * 2)) : clipRing(P.xz, a, b, r);
        if ((q.length >> 1) < 3 || Math.abs(areaOf(q, q.length >> 1)) < 0.05) { if (k === P.ringStart[p]) return null; continue; }
        rings.push(q);
      }
      const ring = new Float32Array(rings[0]), holes = rings.slice(1).map((h) => new Float32Array(h));
      const o = { ring, holes, clip: inside ? null : clipBitsFor(rings, r), y0: P.y0[p], y1: P.y1f[p], o: ci, f: F.WALK, cat: 'exterior',
        mat: this._facadeMat(p), mt: this.M.roof || 'gravel_roof', gid: P.gid[p], piece: p, style: P.style[p], floors: P.floors[p], c: 0 };
      o.storey = this._storey(p, o.mat); o.base = P.y0[p] > 1 ? P.y0[p] : 0;
      if (full) { const q = this._pieceProps(p, null); for (const k in q) if (!(k in o)) o[k] = q[k]; o.envelope = true; }
      return lazyTri(o);
    }
    // 遠景用の地面と木（v1 の形）。木はタイルの CPRP の tree（タイルが無ければ無し）
    // タイルがまだ読めていなければ null（頼まない: 遠景の区画のためにタイルを取りに行かない。キャッシュも覚えない = 届いた後に作り直せる）
    chunkDecor(cx, cz) {
      if (!this._inRange(cx, cz)) return null;
      if (this.tiles && !this.gameOnly && !this.chunkReady(cx, cz)) return null;
      const r = this.chunkRect(cx, cz), trees = [];
      if (this.tiles && this.meta && NycData) {
        const treeCode = NycData.enumCode(this.meta, 'pointKind', 'tree');
        const add = (x, z) => {
          if (x < r[0] || x >= r[2] || z < r[1] || z >= r[3]) return;
          trees.push({ type: 'tree', x: r2(x), y: 0, z: r2(z), rot: r2((mix(Math.round(x * 10), Math.round(z * 10)) % 6283) / 1000) });
        };
        for (const t of this.tiles.tilesInRect(r[0], r[1], r[2] - 0.01, r[3] - 0.01)) {
          const tile = this.tiles.get(t[0], t[1]);
          if (!tile) continue;
          if (tile.version >= 2) {
            const P = tile.props, rows = NycData.chunkRows(P, tile, cx, cz);
            for (let i = rows[0]; i < rows[1]; i++) if (P.kind[i] === treeCode) add(P.xz[i * 2], P.xz[i * 2 + 1]);
            continue;
          }
          const P = tile.points; // 版 1: PNTS
          for (let i = 0; i < P.count; i++) if (P.kind[i] === treeCode) add(P.xz[i * 2], P.xz[i * 2 + 1]);
        }
      }
      return { cx, cz, key: this.chunkKey(cx, cz), ground: [], trees, rocks: [], billboards: [] };
    }
    // チャンクの中身の一番高い所（ncx × ncz）: core PRT の片（E ⊕ dev が重なるチャンク）の上端の上限（_supTop: ceil(y1) + roofExtra、入れる建物は給水塔込み）と橋の床
    chunkTops() {
      if (this._tops) return this._tops;
      const t = new Float32Array(this.ncx * this.ncz);
      const C = this.core;
      if (C && C.pieces) {
        const P = C.pieces;
        for (let ci = 0; ci < t.length; ci++) for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) { const p = P.chunkPieces[k]; if (!this._sup[p] && this._supTop[p] > t[ci]) t[ci] = this._supTop[p]; }
        const D = this._decks, dc = this._deckChunk;
        for (let ci = 0; ci < t.length; ci++) for (let k = dc.start[ci]; k < dc.start[ci + 1]; k++) {
          const i = dc.items[k];
          for (let v = D.vertStart[i]; v < D.vertStart[i + 1]; v++) if (D.y[v] + 1.1 > t[ci]) t[ci] = D.y[v] + 1.1;
        }
      }
      // 静的な物（箱・スロープの上端、GLB のランドマークは v1 と同じく置いた高さ + 60 m）と消した建物の残り
      for (const [ci, st] of this._sb) {
        for (const b of st.boxes) if (b.y + b.h > t[ci]) t[ci] = b.y + b.h;
        for (const p of st.ramps) if (Math.max(p.y0, p.y1) > t[ci]) t[ci] = Math.max(p.y0, p.y1);
        for (const l of st.landmarks) t[ci] = Math.max(t[ci], l.y + 60);
      }
      for (const [ci, list] of this._remChunk) for (const i of list) t[ci] = Math.max(t[ci], this._remnants[i].y1 + this.S.roofExtra);
      this._tops = t;
      return t;
    }
    // 全体の遠景（計画 §3.3.5 の v2 の形）: skylineMinH（40 m）以上の片は E をチャンクで切った柱（o = そのチャンク。rect の片は箱）、
    //   低い所は core MASS（チャンクごとの街区の塊）。グループは superChunk（512 m）ごと（v1 と同じ）
    skyline() {
      if (this._sky) return this._sky;
      const size = this.plan.superChunk || 512; // v1 と同じ 512 m の入れ物（world.js は持ち主のチャンク o で区画に分け直す。描画のまとめ方は plan.skylineGroup）
      const minH = this.plan.skylineMinH != null ? this.plan.skylineMinH : (this.engine.skylineMinH != null ? this.engine.skylineMinH : 40);
      const groups = new Map();
      const grp = (ci) => {
        const cx = ci % this.ncx, cz = (ci - cx) / this.ncx;
        const sx = Math.floor(cx * this.cs / size), sz = Math.floor(cz * this.cs / size), k = sx + '_' + sz;
        let g = groups.get(k);
        if (!g) { g = { key: k, sx, sz, boxes: [], prisms: [] }; groups.set(k, g); }
        return g;
      };
      const C = this.core;
      if (C && C.pieces) {
        const P = C.pieces;
        for (let p = 0; p < P.count; p++) {
          if (this._sup[p] || P.y1f[p] < minH) continue;
          const bx0 = P.bbox[p * 4], bz0 = P.bbox[p * 4 + 1], bx1 = P.bbox[p * 4 + 2], bz1 = P.bbox[p * 4 + 3];
          const c0 = Math.max(0, Math.floor((bx0 - this.minX) / this.cs)), c1 = Math.min(this.ncx - 1, Math.floor((bx1 - this.minX) / this.cs));
          const d0 = Math.max(0, Math.floor((bz0 - this.minZ) / this.cs)), d1 = Math.min(this.ncz - 1, Math.floor((bz1 - this.minZ) / this.cs));
          const eo = this._entOwner(p); // 入れる建物の片は近景を出すチャンクだけが切らずに（chunkLod と同じ）
          for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
            const ci = cz * this.ncx + cx;
            if (eo >= 0 && eo !== ci) continue;
            const r = eo >= 0 ? WHOLE : this.chunkRect(cx, cz);
            if ((P.flags[p] & P_RECT) && P.ringStart[p + 1] - P.ringStart[p] === 1) {
              const x0 = Math.max(bx0, r[0]), z0 = Math.max(bz0, r[1]), x1 = Math.min(bx1, r[2]), z1 = Math.min(bz1, r[3]);
              if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
              grp(ci).boxes.push({ x: r2((x0 + x1) / 2), y: r2(P.y0[p]), z: r2((z0 + z1) / 2), w: r2(x1 - x0), h: r2(P.y1f[p] - P.y0[p]), d: r2(z1 - z0), o: ci, style: P.style[p], c: 0, gid: P.gid[p], piece: p, mat: this._facadeMat(p) });
              continue;
            }
            const pr = this._clipPiece(p, r, ci);
            if (!pr) continue;
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let v = 0; v < pr.ring.length; v += 2) { const x = pr.ring[v], z = pr.ring[v + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
            grp(ci).prisms.push(lazyTri({ ring: pr.ring, holes: pr.holes, clip: pr.clip, bb: [x0, z0, x1, z1], y0: pr.y0, y1: pr.y1, o: ci, style: pr.style, c: 0, gid: pr.gid, piece: p, mat: pr.mat }));
          }
        }
        // 消した建物の残り（skylineMinH 以上。チャンクで切った柱）
        for (const [ci, list] of this._remChunk) for (const i of list) {
          const rm = this._remnants[i];
          if (rm.y1 < minH) continue;
          const pr = this._remPrism(rm, this.chunkRect(ci % this.ncx, (ci - ci % this.ncx) / this.ncx), ci);
          if (!pr) continue;
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = 0; v < pr.ring.length; v += 2) { const x = pr.ring[v], z = pr.ring[v + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          grp(ci).prisms.push(lazyTri({ ring: pr.ring, holes: [], clip: pr.clip, bb: [x0, z0, x1, z1], y0: pr.y0, y1: pr.y1, o: ci, style: pr.style, c: 0, gid: pr.gid, piece: rm.piece, mat: pr.mat }));
        }
        const MS = C.mass;
        if (MS && MS.chunkStart) {
          const nCh = Math.min(MS.chunkStart.length - 1, this.ncx * this.ncz);
          for (let ci = 0; ci < nCh; ci++) for (let i = MS.chunkStart[ci]; i < MS.chunkStart[ci + 1]; i++) {
            const k = MS.ringStart[i], a = MS.vertStart[k], b = MS.vertStart[k + 1];
            if (b - a < 3 || MS.h[i] <= 0 || this._massSuppressed(i)) continue;
            const ring = MS.xz.slice(a * 2, b * 2), holes = [];
            for (let q = k + 1; q < MS.ringStart[i + 1]; q++) holes.push(MS.xz.slice(MS.vertStart[q] * 2, MS.vertStart[q + 1] * 2));
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (let v = 0; v < ring.length; v += 2) { const x = ring[v], z = ring[v + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
            grp(ci).prisms.push(lazyTri({ ring, holes, clip: null, bb: [x0, z0, x1, z1], y0: 0, y1: MS.h[i], o: ci, style: 0, c: 0, gid: 0, mass: 1, cover: MS.cover[i] }));
          }
        }
      }
      // 静的な物の外形（v1 の staticSil と同じ。lm 付きは GLB が読めたら消える）
      for (const b of this._stSil) {
        const ci = this._ci(b.x, b.z);
        if (ci < 0) continue;
        const o = { x: b.x, y: b.y, z: b.z, w: b.w, h: b.h, d: b.d, mat: b.mat, o: ci, style: 0, c: 0 };
        if (b.lm) o.lm = b.lm;
        grp(ci).boxes.push(o);
      }
      this._sky = { v: 2, size, groups: Array.from(groups.values()).sort((a, b) => a.sz - b.sz || a.sx - b.sx) };
      if (this.rail && this.rail.skyline) this.rail.skyline(this._sky.groups); // R4 のフック 8
      return this._sky;
    }
    // 地図のベクタ（v2 の形）: land（LAND の外周と穴）・water / lakes（WATR）・parks（PARK）・blockPolys（MASS）・roads（RDS の中心線と幅）・
    //   bridges（nyc.json の橋の両端）・labels・helipads・hotZones。blocks / piers は空（piers は LAND に含まれる）
    minimap() {
      if (this._mini) return this._mini;
      const C = this.core, en = (this.meta && this.meta.enums) || {};
      const polys = (blk, i) => {
        const out = [];
        for (let k = blk.ringStart[i]; k < blk.ringStart[i + 1]; k++) {
          const q = [];
          for (let v = blk.vertStart[k]; v < blk.vertStart[k + 1]; v++) q.push([r2(blk.xz[v * 2]), r2(blk.xz[v * 2 + 1])]);
          out.push(q);
        }
        return out;
      };
      const land = [], water = [], parks = [], blockPolys = [], roads = [];
      if (C) {
        if (C.land) for (let i = 0; i < C.land.count; i++) { const r = polys(C.land, i); land.push({ poly: r[0], holes: r.slice(1) }); }
        for (const l of this.lakes) water.push({ id: l.id, poly: l.poly, y: l.y });
        if (C.parks) for (let i = 0; i < C.parks.count; i++) { const r = polys(C.parks, i); parks.push({ poly: r[0], holes: r.slice(1), kind: (en.areaKind || [])[C.parks.kind[i]] || '' }); }
        if (C.mass) for (let i = 0; i < C.mass.count; i++) { if (this._massSuppressed(i)) continue; const r = polys(C.mass, i); blockPolys.push({ poly: r[0], holes: r.slice(1), h: C.mass.h[i] }); }
        const R = C.roads;
        if (R) for (let i = 0; i < R.count; i++) {
          const pts = [];
          for (let v = R.vertStart[i]; v < R.vertStart[i + 1]; v++) pts.push([r2(R.xz[v * 2]), r2(R.xz[v * 2 + 1])]);
          roads.push({ pts, w: r2(R.curbL[i] + R.curbR[i]), kind: (en.roadClass || [])[R.cls[i]] || '' });
        }
      }
      const bridges = ((this.meta && this.meta.bridges) || []).map((b) => ({ id: b.id, label: b.ja || b.name || '', pts: b.ends, w: b.width || 20 }));
      const had = new Set(this.helipads.map((h) => Math.round(h.x) + ',' + Math.round(h.z)));
      const pads = this.helipads.concat(this._pads ? this._pads.filter((h) => h.roof && !had.has(Math.round(h.x) + ',' + Math.round(h.z))).map((h, i) => ({ id: 'hpad' + i, x: h.x, y: h.y, z: h.z, r: h.r, access: 'heli' })) : []);
      this._mini = {
        v: 2, bounds: { minX: this.minX, maxX: this.maxX, minZ: this.minZ, maxZ: this.maxZ },
        land, water, lakes: water, parks, blocks: [], blockPolys, roads, piers: [], bridges,
        labels: this.hotZones.map((h) => ({ text: h.label, x: h.x, z: h.z, kind: 'hot' })).concat(this.labels.map((l) => ({ text: l.text, x: l.x, z: l.z, kind: 'area' }))),
        helipads: pads, hotZones: this.hotZones, rails: [], stations: this.stations.map((q) => ({ x: r2(q.x), z: r2(q.z), depth: q.depth, flags: q.flags, ents: q.ents.length }))
      };
      if (this.rail && this.rail.minimap) this.rail.minimap(this._mini); // R4 のフック 10
      return this._mini;
    }

    // ===== 問い合わせ =====
    // (x, z) で一番高い立てる面の上限: core の支え（E を dev + pad 外へ、上端 ceil(y1) + roofExtra、ENTB は v1 の屋上の規則）・橋の床 + deckExtra・
    //   R4 フック 9。O(セルの片)（32 m のセル → core.supi）
    //   y（任意。R4 のフック 9 の地下 = NC5）: rail があり y が地面より 1 m 以上下なら、地下の床（rail.floorAt: 空洞の床・中の立てる箱）を返す
    supportHeightAt(x, z, y0) {
      if (y0 != null && this.rail && this.rail.floorAt && y0 < this.groundY(x, z) - 1) { const f = this.rail.floorAt(x, z, y0); if (f != null) return f; }
      let y = this.groundY(x, z);
      const C = this.core;
      if (this.rail && this.rail.supportAt) { const q = this.rail.supportAt(x, z); if (q != null && q > y) y = q; }
      if (y === 0 && this.curbH > 0) y = this.curbH; // 陸: 歩道・広場の台（curbH）まで
      if (this._stSup) y = this._staticSup(x, z, y); // 移したランドマーク・空母・消した建物の残り
      if (!C || !C.supi) return y;
      const S = C.supi, i = Math.floor((x - this.minX) / S.cell), j = Math.floor((z - this.minZ) / S.cell);
      if (i < 0 || j < 0 || i >= S.W || j >= S.H) return y;
      if (!this._supEnt) this._sortSupi();
      // セルの行: [上端, x0, z0, x1, z1（外接矩形 ⊕ (dev + pad)）, 番号, dev + pad] の 7 つずつ、上端の高い順（消す片は無い）。
      //   番号 ≥ 0 は片（上端はそのまま）、< 0 は橋の床 −(q + 1)（上端は床の一番高い頂点 + deckExtra = 並べるための上限。当たれば平面の高さ）。
      //   1 つの配列に並べてあるので、ばらばらの点でもキャッシュの行をあまりまたがない
      const k = j * S.W + i, en = this._supEnt, st = this._supStart;
      for (let n = st[k] * 7, e = st[k + 1] * 7; n < e; n += 7) {
        if (en[n] <= y) break;
        if (x < en[n + 1] || x > en[n + 3] || z < en[n + 2] || z > en[n + 4]) continue;
        const id = en[n + 5];
        if (id >= 0) { if (this._nearPiece(id, x, z, en[n + 6])) { y = en[n]; break; } continue; }
        const q = -id - 1, D = this._decks;
        const yy = D.plane[q * 3] * x + D.plane[q * 3 + 1] * z + D.plane[q * 3 + 2] + this.S.deckExtra;
        if (yy > y && this._nearDeck(q, x, z, en[n + 6])) y = yy;
      }
      return y;
    }
    // 静的な物（移したランドマーク・空母・消した建物の残り）の支え: 32 m のセルの立てる箱・スロープ・残りの外接矩形（v1 の _initSupport と同じ）
    _staticSup(x, z, y) {
      const C = this._stSupC, i = Math.floor((x - this.minX) / C), j = Math.floor((z - this.minZ) / C);
      if (i < 0 || j < 0 || i >= this._stSupW || j >= this._stSupH) return y;
      const list = this._stSup[j * this._stSupW + i];
      if (!list) return y;
      for (const e of list) {
        if (x < e.r[0] || x > e.r[2] || z < e.r[1] || z > e.r[3]) continue;
        if (e.ramp) { const q = CityGen.rampSurface(e.ramp, x, z); if (q > y) y = q; } else if (e.y > y) y = e.y;
      }
      return y;
    }
    // (x, z) に y より高い支えがあるか（supportHeightAt(x, z) > y と同じ答え。並べ替えた索引を作らない = 起動の確かめ用）
    _topOver(x, z, y) {
      if (this.groundY(x, z) > y) return true;
      if (this._stSup && this._staticSup(x, z, -Infinity) > y) return true;
      const C = this.core;
      if (!C || !C.supi) return false;
      const S = C.supi, P = C.pieces, i = Math.floor((x - this.minX) / S.cell), j = Math.floor((z - this.minZ) / S.cell);
      if (i < 0 || j < 0 || i >= S.W || j >= S.H) return false;
      const k = j * S.W + i, pad = this.S.pad;
      for (let n = S.start[k]; n < S.start[k + 1]; n++) {
        const p = S.piece[n];
        if (this._sup[p] || this._supTop[p] <= y) continue;
        const d = P.dev[p] + pad;
        if (x < P.bbox[p * 4] - d || x > P.bbox[p * 4 + 2] + d || z < P.bbox[p * 4 + 1] - d || z > P.bbox[p * 4 + 3] + d) continue;
        if (this._nearPiece(p, x, z, d)) return true;
      }
      const D = this._decks, dk = this._deckCell;
      if (D) for (let n = dk.csr.start[k]; n < dk.csr.start[k + 1]; n++) {
        const q = dk.csr.items[n], bb = this._deckBB;
        if (x < bb[q * 4] - pad || x > bb[q * 4 + 2] + pad || z < bb[q * 4 + 1] - pad || z > bb[q * 4 + 3] + pad) continue;
        const yy = D.plane[q * 3] * x + D.plane[q * 3 + 1] * z + D.plane[q * 3 + 2] + this.S.deckExtra;
        if (yy > y && this._nearDeck(q, x, z, pad)) return true;
      }
      return false;
    }
    // 支えの索引（core.supi）の各セルの片を上端の高い順に並べた写し（初めて使ったとき 1 回）
    _sortSupi() {
      const C = this.core, S = C.supi, P = C.pieces, D = this._decks, top = this._supTop, sup = this._sup, pad = this.S.pad;
      const dk = this._deckCell, dbb = this._deckBB, dx = this.S.deckExtra;
      const N = S.start.length - 1, st = new Uint32Array(N + 1);
      const sameGrid = dk.cell === S.cell && dk.W === S.W;
      if (!sameGrid) throw new Error('CityGenNyc: deck cells must match core.supi');
      const dTop = new Float32Array(D ? D.count : 0);
      for (let q = 0; q < dTop.length; q++) { let m = -Infinity; for (let v = D.vertStart[q]; v < D.vertStart[q + 1]; v++) if (D.y[v] > m) m = D.y[v]; dTop[q] = m + dx + 1e-3; }
      let m = 0;
      for (let k = 0; k < N; k++) {
        for (let n = S.start[k]; n < S.start[k + 1]; n++) if (!sup[S.piece[n]]) m++;
        if (D) m += dk.csr.start[k + 1] - dk.csr.start[k];
        st[k + 1] = m;
      }
      const en = new Float32Array(m * 7);
      let o = 0;
      for (let k = 0; k < N; k++) {
        const sub = [];
        for (let n = S.start[k]; n < S.start[k + 1]; n++) if (!sup[S.piece[n]]) sub.push(S.piece[n]);
        if (D) for (let n = dk.csr.start[k]; n < dk.csr.start[k + 1]; n++) sub.push(-dk.csr.items[n] - 1);
        const t = (id) => (id >= 0 ? top[id] : dTop[-id - 1]);
        sub.sort((p, q) => t(q) - t(p) || p - q);
        for (const id of sub) {
          if (id >= 0) {
            const d = P.dev[id] + pad;
            en[o + 1] = P.bbox[id * 4] - d; en[o + 2] = P.bbox[id * 4 + 1] - d; en[o + 3] = P.bbox[id * 4 + 2] + d; en[o + 4] = P.bbox[id * 4 + 3] + d; en[o + 6] = d;
          } else {
            const q = -id - 1;
            en[o + 1] = dbb[q * 4] - pad; en[o + 2] = dbb[q * 4 + 1] - pad; en[o + 3] = dbb[q * 4 + 2] + pad; en[o + 4] = dbb[q * 4 + 3] + pad; en[o + 6] = pad;
          }
          en[o] = t(id); en[o + 5] = id; o += 7;
        }
      }
      this._supStart = st; this._supEnt = en;
    }
    // 点が片 p の E から d 以内（中か、辺まで d 以内）
    //   1 回の辺のなめで: 辺まで d 以内ならすぐ true、そうでなければ偶奇（外周の中で穴の外）。穴の中の点 = 偶奇が偶数
    _nearPiece(p, x, z, d) {
      const P = this.core.pieces, X = P.xz, d2 = d * d;
      let par = false;
      for (let k = P.ringStart[p]; k < P.ringStart[p + 1]; k++) {
        const a = P.vertStart[k], b = P.vertStart[k + 1];
        for (let v = a, w = b - 1; v < b; w = v++) {
          const ax = X[w * 2], az = X[w * 2 + 1], bx = X[v * 2], bz = X[v * 2 + 1];
          if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) par = !par;
          const ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez;
          let u = L > 0 ? ((x - ax) * ex + (z - az) * ez) / L : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = ax + u * ex - x, qz = az + u * ez - z;
          if (qx * qx + qz * qz <= d2) return true;
        }
      }
      return par;
    }
    // (x, z) から 0.35 m 以内にほかの鎖（skipChain でない）の床があり、上面が y から tol m 以内か（橋・高架の縁の壁を隣の床の上に立てない）
    _deckCovers(x, z, y, tol, skipChain, elOnly) {
      const D = this._decks, dk = this._deckCell, bb = this._deckBB, m = 0.35;
      if (!D || !dk) return false;
      const i = Math.floor((x - this.minX) / dk.cell), j = Math.floor((z - this.minZ) / dk.cell);
      if (i < 0 || j < 0 || i >= dk.W || j >= dk.H) return false;
      const k = j * dk.W + i;
      for (let n = dk.csr.start[k]; n < dk.csr.start[k + 1]; n++) {
        const q = dk.csr.items[n];
        if (D.chain[q] === skipChain || x < bb[q * 4] - m || x > bb[q * 4 + 2] + m || z < bb[q * 4 + 1] - m || z > bb[q * 4 + 3] + m) continue;
        if (elOnly && !(D.eflag && (D.eflag[q] & 1))) continue;
        if (Math.abs(D.plane[q * 3] * x + D.plane[q * 3 + 1] * z + D.plane[q * 3 + 2] - y) > tol) continue;
        if (this._nearDeck(q, x, z, 0.35)) return true; // 0.35 m: 縁どうしが接する隣の床（隙間は描かない程度）
      }
      return false;
    }
    // 線路を載せられないデータの床か（NC3 の直し 6）: 歩道・階段・自転車道の種類（plan.rails.el.weakClasses）で幅（4 角は始まりの辺、ほかは
    //   いちばん狭い向きの幅）が el の床の幅（elCfg.width）より狭い。el の床を消さない（_initEl の roadDeckAt）・el の床を通る縁の壁を立てない（_deckBarriers0）
    _deckWeak(q) {
      const D = this._decks;
      if (D.eflag && D.eflag[q]) return false;
      let W = this._deckWeakC;
      if (!W) {
        const en = (this.meta && this.meta.enums && this.meta.enums.roadClass) || CityGenNyc.ROAD_CLASS, ec = this.elCfg || {}; // meta の無いサーバー（テストの gameOnly）も同じ答え
        const names = new Set(ec.weakClasses || ['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'corridor', 'bridleway', 'sidewalk', 'crosswalk']);
        W = this._deckWeakC = { cls: en.map((n) => names.has(n)), w: ec.width || 4.6, c: new Map() };
      }
      if (!W.cls[D.cls[q]]) return false;
      let r = W.c.get(q);
      if (r === undefined) {
        const a = D.vertStart[q], e = D.vertStart[q + 1], n = e - a;
        let w;
        if (D.kind[q] === 0 && n === 4) w = Math.hypot(D.xz[a * 2 + 2] - D.xz[a * 2], D.xz[a * 2 + 3] - D.xz[a * 2 + 1]);
        else { // 凸の多角形のいちばん狭い向きの幅
          w = Infinity;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, ax = D.xz[(a + i) * 2], az = D.xz[(a + i) * 2 + 1], dx = D.xz[(a + j) * 2] - ax, dz = D.xz[(a + j) * 2 + 1] - az, L = Math.hypot(dx, dz);
            if (L < 1e-6) continue;
            let m = 0;
            for (let k = 0; k < n; k++) m = Math.max(m, Math.abs(dx * (D.xz[(a + k) * 2 + 1] - az) - dz * (D.xz[(a + k) * 2] - ax)) / L);
            w = Math.min(w, m);
          }
        }
        r = w < W.w;
        W.c.set(q, r);
      }
      return r;
    }
    // 床の片の長い向き（4 角は始まりの辺の中点 → 終わりの辺の中点、ほかはいちばん長い辺）が (tx, tz) と 30° より大きく交わるか
    _deckCrosses(q, tx, tz) {
      const D = this._decks, a = D.vertStart[q], e = D.vertStart[q + 1], n = e - a, P = (k) => [D.xz[(a + k) * 2], D.xz[(a + k) * 2 + 1]];
      let dx, dz;
      if (D.kind[q] === 0 && n === 4) { const A = P(0), B = P(1), C = P(2), E = P(3); dx = (C[0] + E[0] - A[0] - B[0]) / 2; dz = (C[1] + E[1] - A[1] - B[1]) / 2; }
      else { let best = -1; for (let k = 0; k < n; k++) { const A = P(k), B = P((k + 1) % n), L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L > best) { best = L; dx = B[0] - A[0]; dz = B[1] - A[1]; } } }
      const L = Math.hypot(dx, dz);
      return L < 1e-6 || Math.abs((dx * tx + dz * tz) / L) < Math.cos(Math.PI / 6);
    }
    // el の駅のホーム（eflag 4）が (x, z) の上 −0.3〜1.6 m にあるか（el の床の縁の壁を立てない所）
    _platCovers(x, z, y) {
      const D = this._decks, dk = this._deckCell, bb = this._deckBB, m = 0.35;
      if (!D || !dk || !D.eflag) return false;
      const i = Math.floor((x - this.minX) / dk.cell), j = Math.floor((z - this.minZ) / dk.cell);
      if (i < 0 || j < 0 || i >= dk.W || j >= dk.H) return false;
      const k = j * dk.W + i;
      for (let n = dk.csr.start[k]; n < dk.csr.start[k + 1]; n++) {
        const q = dk.csr.items[n];
        if (!(D.eflag[q] & 4) || x < bb[q * 4] - m || x > bb[q * 4 + 2] + m || z < bb[q * 4 + 1] - m || z > bb[q * 4 + 3] + m) continue;
        const dy = D.plane[q * 3] * x + D.plane[q * 3 + 1] * z + D.plane[q * 3 + 2] - y;
        if (dy < -0.3 || dy > 1.6) continue;
        if (this._nearDeck(q, x, z, m)) return true;
      }
      return false;
    }
    _nearDeck(q, x, z, d) {
      const D = this._decks, a = D.vertStart[q], b = D.vertStart[q + 1];
      let inside = false;
      for (let i = a, j = b - 1; i < b; j = i++) {
        const xi = D.xz[i * 2], zi = D.xz[i * 2 + 1], xj = D.xz[j * 2], zj = D.xz[j * 2 + 1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
      const d2 = d * d;
      for (let i = a, j = b - 1; i < b; j = i++) if (segDist2(x, z, D.xz[j * 2], D.xz[j * 2 + 1], D.xz[i * 2], D.xz[i * 2 + 1]) <= d2) return true;
      return false;
    }
    // 半径 r の中の一番高い上端の上限（サーバーの heliCeiling）
    maxTopNear(x, z, r) {
      let y = this.supportHeightAt(x, z);
      const C = this.core;
      if (!C || !C.supi) return y;
      const S = C.supi, P = C.pieces;
      const i0 = Math.max(0, Math.floor((x - r - this.minX) / S.cell)), i1 = Math.min(S.W - 1, Math.floor((x + r - this.minX) / S.cell));
      const j0 = Math.max(0, Math.floor((z - r - this.minZ) / S.cell)), j1 = Math.min(S.H - 1, Math.floor((z + r - this.minZ) / S.cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * S.W + i;
        for (let n = S.start[k]; n < S.start[k + 1]; n++) {
          const p = S.piece[n];
          if (this._supTop[p] <= y || this._sup[p]) continue;
          const d = P.dev[p] + this.S.pad + r;
          if (x < P.bbox[p * 4] - d || x > P.bbox[p * 4 + 2] + d || z < P.bbox[p * 4 + 1] - d || z > P.bbox[p * 4 + 3] + d) continue;
          y = this._supTop[p];
        }
      }
      const D = this._decks;
      if (D) {
        const dk = this._deckCell, bb = this._deckBB;
        const a0 = Math.max(0, Math.floor((x - r - this.minX) / dk.cell)), a1 = Math.min(dk.W - 1, Math.floor((x + r - this.minX) / dk.cell));
        const b0 = Math.max(0, Math.floor((z - r - this.minZ) / dk.cell)), b1 = Math.min(dk.H - 1, Math.floor((z + r - this.minZ) / dk.cell));
        for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
          const kk = j * dk.W + i;
          for (let n = dk.csr.start[kk]; n < dk.csr.start[kk + 1]; n++) {
            const q = dk.csr.items[n];
            if (x < bb[q * 4] - r || x > bb[q * 4 + 2] + r || z < bb[q * 4 + 1] - r || z > bb[q * 4 + 3] + r) continue;
            for (let v = D.vertStart[q]; v < D.vertStart[q + 1]; v++) if (D.y[v] + this.S.deckExtra > y) y = D.y[v] + this.S.deckExtra;
          }
        }
      }
      if (this._stSup) { // 静的な物（32 m のセル）
        const SC = this._stSupC;
        const a0 = Math.max(0, Math.floor((x - r - this.minX) / SC)), a1 = Math.min(this._stSupW - 1, Math.floor((x + r - this.minX) / SC));
        const b0 = Math.max(0, Math.floor((z - r - this.minZ) / SC)), b1 = Math.min(this._stSupH - 1, Math.floor((z + r - this.minZ) / SC));
        for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) for (const e of this._stSup[j * this._stSupW + i] || []) {
          if (x < e.r[0] - r || x > e.r[2] + r || z < e.r[1] - r || z > e.r[3] + r) continue;
          const t = e.ramp ? Math.max(e.ramp.y0, e.ramp.y1) : e.y;
          if (t > y) y = t;
        }
      }
      if (this.rail && this.rail.supportAt) { const q = this.rail.supportAt(x, z); if (q != null && q > y) y = q; } // R4 フック 9
      return y;
    }
    // HeliCollider の箱（チャンクで切った箱を out に足して out を返す。core だけ = いつでも引ける）。
    //   mode: 'inset'（サーバー。入れない建物は _unionSolid = チャンクの片をまとめて外の辺だけ縮めた 2 m の格子）| 'center'（ヘリ・戦闘機）| 'outset'。
    //   片の箱、入れる建物は ENTB の長方形を 1 つ（ent 1。サーバーは
    //   入れる建物を coarse の床・屋根で見る）+ 長方形の外の片のセル、橋の床の段の箱（plan.decks.colliderStep m ごと）。
    //   地図全体で 20 万個近くあるので箱は { x0, z0, x1, z1, y0, y1, f 4 }（+ ent）だけ（k は無い = 箱。HeliCollider は k === 1 だけ見る）。
    //   面積が engine.colliderMinArea m² 未満の箱は入れない。'inset' は engine.colliderRoundInset なら整数 m に内側へ丸める（下限のまま。
    //   整数だけの形は V8 の Smi のまま持てるので箱 1 つのメモリが半分以下。サーバーのメモリ: plan §3.5）
    colliderBoxes(cx, cz, out, mode) {
      out = out || [];
      if (!this._inRange(cx, cz) || !this.core) return out;
      const C = this.core, P = C.pieces, EN = C.entb, ci = cz * this.ncx + cx, r = this.chunkRect(cx, cz);
      mode = mode || 'center';
      const minA = this.engine.colliderMinArea != null ? this.engine.colliderMinArea : 1;
      const rnd = mode === 'inset' && !!this.engine.colliderRoundInset;
      // 箱を足す（丸めるときは別の形 = 整数のまま）
      const put = (x0, z0, x1, z1, y0, y1, ent) => {
        x0 = Math.max(x0, r[0]); z0 = Math.max(z0, r[1]); x1 = Math.min(x1, r[2]); z1 = Math.min(z1, r[3]);
        if (rnd) {
          x0 = Math.ceil(x0 - 1e-6); z0 = Math.ceil(z0 - 1e-6); x1 = Math.floor(x1 + 1e-6); z1 = Math.floor(z1 + 1e-6);
          y0 = Math.ceil(y0 - 1e-6); y1 = Math.floor(y1 + 1e-6);
          if (x1 <= x0 || z1 <= z0 || y1 <= y0 || (x1 - x0) * (z1 - z0) < minA) return;
          if (ent) out.push({ x0: x0 | 0, x1: x1 | 0, z0: z0 | 0, z1: z1 | 0, y0: y0 | 0, y1: y1 | 0, f: 4, ent: 1 });
          else out.push({ x0: x0 | 0, x1: x1 | 0, z0: z0 | 0, z1: z1 | 0, y0: y0 | 0, y1: y1 | 0, f: 4 });
          return;
        }
        if (x1 - x0 < 0.01 || z1 - z0 < 0.01 || (x1 - x0) * (z1 - z0) < minA) return;
        if (ent) out.push({ x0, z0, x1, z1, y0, y1, f: 4, ent: 1 });
        else out.push({ x0, z0, x1, z1, y0, y1, f: 4 });
      };
      for (let k = P.chunkStart[ci]; k < P.chunkStart[ci + 1]; k++) {
        const p = P.chunkPieces[k];
        if (this._sup[p]) continue;
        const e = this._entOf[p], on = e >= 0 && this._entOn(e);
        // 細い片（P_DEVSAT + P_THIN: E は外接矩形、その長い向きの中心線が本当の形 R から 0.08 m 以内 = tools/nyc/nycv2core.py）: 中心線に
        //   厚さ 0.04 m の壁（thin: 人の壁として見る・NOLOS: 視線は通す）。下限: 箱の点は R から 0.1 m 以内、正直な人の中心は R から 0.4 m 以上、
        //   サーバーは箱から wallMargin 0.2 m より近いと拒否。屋上の 17 m の柵（gid 30276）など、以前はサーバーでは開いていた
        if (mode === 'inset' && !on && (P.flags[p] & P_DEVSAT) && (P.flags[p] & P_THIN)) { this._thinWall(p, r, out); continue; }
        if (mode === 'inset' && !on) continue; // 入れない建物は下の _unionSolid（片をまとめた形）
        const y0 = P.y0[p], y1 = mode === 'inset' ? P.y1f[p] : P.y1c[p];
        if (y1 <= 1.0 || y1 - y0 < 0.2) continue;
        const bx = this._solid(p, mode === 'inset' ? 'insetC' : mode);
        let ex0 = 0, ez0 = 0, ex1 = 0, ez1 = 0;
        if (on) {
          ex0 = EN.rect[e * 4]; ez0 = EN.rect[e * 4 + 1]; ex1 = EN.rect[e * 4 + 2]; ez1 = EN.rect[e * 4 + 3];
          put(ex0, ez0, ex1, ez1, this.curbH, this.curbH + EN.floors[e] * EN.fh[e], 1);
        }
        const spans = this._spans(p, y0, y1);
        for (let i = 0; i < bx.length; i += 4) {
          if (on) { const mx = (bx[i] + bx[i + 2]) / 2, mz = (bx[i + 1] + bx[i + 3]) / 2; if (mx > ex0 && mx < ex1 && mz > ez0 && mz < ez1) continue; }
          for (const sp of spans) put(bx[i], bx[i + 1], bx[i + 2], bx[i + 3], sp[0], sp[1], 0);
        }
      }
      if (mode === 'inset') for (const b of this._unionSolid(cx, cz)) if (b[5] > 1.0) put(b[0], b[1], b[2], b[3], b[4], b[5], 0);
      // 静的な物（v1 と同じ選び方の箱をこのチャンクで切る）と消した建物の残り
      for (const q of this._stColl.get(ci) || []) {
        if (q.f === 4) put(q.x0, q.z0, q.x1, q.z1, q.y0, q.y1, 0);
        else { // NOLOS（手すり・ガラス）は f をそのまま（v1 と同じ: 4 WALK・2 NOLOS）
          const x0 = Math.max(q.x0, r[0]), z0 = Math.max(q.z0, r[1]), x1 = Math.min(q.x1, r[2]), z1 = Math.min(q.z1, r[3]);
          if (x1 - x0 >= 0.01 && z1 - z0 >= 0.01 && !rnd) out.push({ x0, z0, x1, z1, y0: q.y0, y1: q.y1, f: q.f });
        }
      }
      for (const b of this._remBoxes(cx, cz, mode)) if (b[5] > 1.0) put(b[0], b[1], b[2], b[3], b[4], b[5], 0);
      const EC = this._elCols && this._elCols.byChunk.get(ci); // NC3: el の柱（床は下の段の箱）
      if (EC) for (const c of EC.cols) {
        if (rnd) { // 整数に丸める inset は 1.2 m の柱を消すので、一番近い整数の 1 m 以上の箱（柱から 0.4 m までずれる）
          const x0 = Math.round(c.x - c.w / 2), z0 = Math.round(c.z - c.w / 2), x1 = Math.max(x0 + 1, Math.round(c.x + c.w / 2)), z1 = Math.max(z0 + 1, Math.round(c.z + c.w / 2));
          if (x0 >= r[0] && z0 >= r[1] && x1 <= r[2] && z1 <= r[3]) { out.push({ x0: x0 | 0, x1: x1 | 0, z0: z0 | 0, z1: z1 | 0, y0: Math.ceil(c.y0 || 0) | 0, y1: Math.floor(c.h) | 0, f: 4 }); continue; }
        }
        put(c.x - c.w / 2, c.z - c.w / 2, c.x + c.w / 2, c.z + c.w / 2, c.y0 || 0, c.h, 0);
      }
      const dstep = (this.plan.decks && this.plan.decks.colliderStep) || 8;
      for (const b of this._deckSteps(cx, cz, dstep)) {
        if (b.y + b.h <= 1.0) continue;
        put(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.y, b.y + b.h, 0);
      }
      return out;
    }
    // スポーン地点（v1 と同じ形 [{ x, y, z, zone }]）: core SPWN（mask 1 solo, 2 online, 4 royale の地上。zone = ホットゾーンの番号）。
    //   'online' = ゾーンの中の mask 2 の点、'royale' = mask 4 の全部、'solo' = ゾーンの中の mask 1 の点から seed で 1 つ
    spawnPoints(mode, seed) {
      const C = this.core;
      if (!C || !C.spawns) return [];
      if (!this._spawnLists) this._spawnLists = {};
      const want = mode === 'royale' ? 4 : mode === 'online' ? 2 : 1;
      let list = this._spawnLists[want];
      if (!list) {
        const SP = C.spawns;
        list = [];
        for (let i = 0; i < SP.count; i++) {
          if (!(SP.mask[i] & want) || (this._spawnBad && this._spawnBad[i])) continue;
          const zi = SP.zone[i];
          if (want !== 4 && zi === 255) continue;
          const h = this.hotZones[zi];
          list.push({ x: r2(SP.xz[i * 2]), y: this.curbH, z: r2(SP.xz[i * 2 + 1]), zone: h ? h.id : '' });
        }
        this._spawnLists[want] = list;
      }
      if (mode === 'solo') return list.length ? [list[hash(this.seed, 72, seed | 0, 0) % list.length]] : [];
      return list;
    }
    vehicleSpawns() { return this.vehicles; }
    get vehicles() { if (!this._vehicles) this._initVehicles(); return this._vehicles; }
    set vehicles(v) { this._indexVehicles(v || []); }
    _vehMap() { if (!this._vehChunk) this._initVehicles(); return this._vehChunk; }
    landmarkPlacements() { return this.staticItems.landmarks; }
  }

  // どちらの街でも: v2（generator 'nyc'）は CityGenNyc、ほかは v1 の CityGen
  function create(plan, opts) {
    return plan && plan.generator === 'nyc' ? new CityGenNyc(plan, opts) : new CityGen(plan, opts);
  }
  CityGen.create = create;
  CityGenNyc.create = create;
  // 作り方の版: core.bin から作るゲームの層（ENTB・ランドマーク・梯子・戦利品・乗り物・スポーン地点の扱い）を変えたら 1 上げる。
  //   server/citycache.js の nycHash(plan, coreSha) = levelHash(plan, { core: sha256, gen: GEN_VERSION })（同じプラン・同じ core でも
  //   作り方が変われば指紋が変わる。net-city が確かめる）
  // 前もって作った el の表（elcache.json）の版: _initEl の答えを変えたら上げる（鍵 _elKey。elcache.js --check が忘れを見つける）
  CityGenNyc.EL_CACHE_VERSION = 1;
  // nyc.json の enums.roadClass（meta が無いときの _deckWeak。tools/nyc/build_nyc.py の並び、city-test-nyc が同じか見る）
  CityGenNyc.ROAD_CLASS = ['', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'alley', 'driveway', 'parking_aisle', 'pedestrian', 'footway', 'sidewalk', 'crosswalk', 'steps', 'cycleway', 'path', 'track', 'bridleway', 'unknown', 'rail', 'subway', 'light_rail', 'tram', 'monorail', 'funicular', 'narrow_gauge'];
  CityGenNyc.GEN_VERSION = 13; // 2: 細い片の中心線の壁（P_THIN、サーバーの colliderBoxes inset）。3: データのパッド（Fort Wood・ガバナーズ島）と地上の HPAD（groundNear）。4: 空母の姿勢 yaw 0（86 番桟橋の西・左舷の階段塔）と階段塔の戦利品を舷と一緒に写す。5: 高架・トンネルの口・高架のホーム（core RLEL → _initEl: 床の片・柱・口の床と隠れた屋根・地面の穴、柱と口の所の出現地点と駐車の車を外す）。6: el の門形の柱・屋上の柱・盛り土（床の下面が embankH m より低い所）・建物をよける床の幅・地図の端の壁（NC3 の直し）。7: 盛り土が地上の車道を渡る所は板（橋台の間）・低ければ線路を上げる・上げられなければ踏切（_initEl の under、_elAdjAt）。8: トンネルの口は地図の道をふさがない（cut-and-cover: 道の上は地面の高さの覆い、掘割は道の無い区間だけ・全部覆う口は作らない、_portalCover）。9: 口をふさぐのは車道と掘割を横切る道だけ（沿う歩道はよい・沿う車道は幅を縮める = 中央分離帯の口、口の前の掘割 termA、_portalCover の直し 4）。10: クイーンズボロ・プラザの駅の建物の抜けの中で el の床を細くしない・消さない（_pieceInSpan）・ホームの縁と並ぶ el の床どうし・建物の壁の横に縁の壁を立てない・梁を下の el の線路の上 beamRailClear m に（薄く）・el の線路を横切るホームを作らない・データの床の縁を el の線路が通る所に壁を立てない・操車場の線路が掘割を通る口は覆う（直し 5）、デランシー通りの浮いた片（gid 16920）を消す。11: 細い歩道・階段の床（駅の通路）は el の床を消さない（_deckWeak）・データの床の縁の壁は el の床を通る所で切る（クイーンズボロ・プラザの下の段の穴と線路の切れ目、直し 6）、el の表の鍵に EL_CACHE_VERSION（クラスのソースを入れない = Worker も表を使う）。12: 駅がオンラインに入る（NC8: サーバーの gameOnly の街にも opts.rail = MR.Stations の駅 = 空洞・穴・地下の床・駅の戦利品。online.city.stations false ならクライアントもサーバーも駅なし）。13: 段に置き換える片（plan.stairs = TKTS の赤い階段 gid 30106: 片を消して 16 段の WALK の箱。_initStairs）
  //   NC4（core STAT の駅・ホーム・入口）では上げない: サーバーも this.stations を読むが gameOnly の出力（chunkFull / chunkCoarse / colliderBoxes /
  //   出現地点 / 戦利品）は変わらない（入口の印は描画の層 _detail だけ）。サーバーの指紋は core の sha で変わる。駅をゲームの層に入れる NC5 / NC8 で上げる
  //   NC5 / NC6（地下の空洞・タイムズスクエアの駅 = opts.rail の MR.Underground / MR.Stations）でも 11 のまま: rail を渡すのはソロのゲームだけで、サーバー・
  //   道具の街（rail なし）の chunkCoarse / chunkFull（gameOnly）/ lootSpawns / spawnPoints は NC3 の 11（2be8e51）と同じ（NC3 + NC4〜6 を合わせたときに確かめた）
  //   NC8 で 12: サーバー（server/cityworld.js）も駅を持つ。rail の無い街の答えは 11 と同じ（spawnPoints('online')・vehicleSpawns も rail あり / なしで同じ。
  //   lootSpawns は rail ありで駅の物が後ろに付くだけ）
  CityGenNyc.CityGen = CityGen;
  CityGenNyc.F = CityGen.F;
  CityGenNyc.triangulate = triangulate;
  CityGenNyc.clipRing = clipRing;

  MR.CityGenNyc = CityGenNyc;
  if (typeof module !== 'undefined' && module.exports) module.exports = CityGenNyc;
})(typeof window !== 'undefined' ? window : globalThis);
