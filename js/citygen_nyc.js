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
  // 32 bit の混ぜ合わせ（木の向きだけ）
  function mix(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  const u01 = (h) => (h >>> 0) / 4294967296;

  // core PRT の flags / タイル CPRS の行の flags（nycdata.js の冒頭）
  const P_ENTB = 8, P_RECT = 16, P_DEVSAT = 32;
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
      const fromData = (v, d) => (v === '@data' || v == null ? (d || []) : v);
      this.hotZones = fromData(plan.hotZones, meta.hotZones).map((h) => Object.assign({}, h));
      // 選択肢の短い名前（plan.hotZoneChips { id: 名前 }。地図・説明の文は label のまま）
      if (plan.hotZoneChips) for (const h of this.hotZones) if (plan.hotZoneChips[h.id]) h.chip = String(plan.hotZoneChips[h.id]);
      // 地名: nyc.json は { ja, en, x, z }、v1（minimap）は { text, x, z }
      this.labels = fromData(plan.labels, meta.labels).map((l) => ({ text: l.text || l.ja || l.en || '', en: l.en || '', x: l.x, z: l.z }));
      // ヘリポート: nyc.json は { id, label, x, z, rect }。v1 の形 { id, label, x, y, z, r, access }（屋上のパッドは core HPAD → _pads）
      const hd = plan.heliportDefaults || {};
      this.helipads = fromData(plan.heliports, meta.heliports).map((h) => Object.assign({ y: hd.y || 0, r: hd.r, access: hd.access }, h));
      this.keepouts = this.helipads.map((h) => [h.x, h.z, (h.r || 0) + 3]);
      // 消す建物（gid）: plan.suppressGids + landmarks[].suppress
      this.suppressGids = new Set();
      for (const g of plan.suppressGids || []) this.suppressGids.add(g >>> 0);
      for (const l of plan.landmarks || []) for (const g of l.suppress || []) this.suppressGids.add(g >>> 0);
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
      // 後から作る索引も全部ここで null にしておく（どの街も同じ形のオブジェクト = 速い関数がどの街でも単形のまま）
      this._anySup = false; this._sup = null; this._supList = null; this._supTop = null; this._supEnt = null; this._supStart = null;
      this._entOf = null; this._entOnC = null; this._entChunk = null; this._deckBB = null; this._deckChunk = null; this._deckCell = null;
      this._spawnChunk = null; this._spawnLists = null; this._pads = []; this._gapLo = null; this._gapHi = null;
      this._wbb = null; this._wgrid = null; this._tops = null; this._sky = null; this._mini = null;
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
      this.keepouts = this.helipads.map((h) => [h.x, h.z, (h.r || 0) + 3]);
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
      const D = this._decks = this._linkDecks(C.decks);
      this._deckBB = new Float32Array((D ? D.count : 0) * 4);
      if (D) for (let i = 0; i < D.count; i++) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let v = D.vertStart[i]; v < D.vertStart[i + 1]; v++) { const x = D.xz[v * 2], z = D.xz[v * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        this._deckBB[i * 4] = x0; this._deckBB[i * 4 + 1] = z0; this._deckBB[i * 4 + 2] = x1; this._deckBB[i * 4 + 3] = z1;
      }
      this._deckChunk = this._csr(D ? D.count : 0, (i, put) => {
        const bb = this._deckBB;
        const c0 = Math.max(0, Math.floor((bb[i * 4] - this.minX) / this.cs)), c1 = Math.min(this.ncx - 1, Math.floor((bb[i * 4 + 2] - this.minX) / this.cs));
        const d0 = Math.max(0, Math.floor((bb[i * 4 + 1] - this.minZ) / this.cs)), d1 = Math.min(this.ncz - 1, Math.floor((bb[i * 4 + 3] - this.minZ) / this.cs));
        for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) put(cz * this.ncx + cx);
      });
      const SC = (C.supi && C.supi.cell) || 32, SW = Math.ceil((this.maxX - this.minX) / SC), SH = Math.ceil((this.maxZ - this.minZ) / SC);
      this._deckCell = { cell: SC, W: SW, H: SH };
      const pad = this.S.pad;
      this._deckCell.csr = this._csr(D ? D.count : 0, (i, put) => {
        const bb = this._deckBB;
        const i0 = Math.max(0, Math.floor((bb[i * 4] - pad - this.minX) / SC)), i1 = Math.min(SW - 1, Math.floor((bb[i * 4 + 2] + pad - this.minX) / SC));
        const j0 = Math.max(0, Math.floor((bb[i * 4 + 1] - pad - this.minZ) / SC)), j1 = Math.min(SH - 1, Math.floor((bb[i * 4 + 3] + pad - this.minZ) / SC));
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) put(j * SW + k);
      }, SW * SH);
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
      for (let i = 0; i < n; i++) each(i, (b) => { cnt[b + 1]++; });
      for (let k = 0; k < N; k++) cnt[k + 1] += cnt[k];
      const start = cnt.slice(), items = new Uint32Array(cnt[N]);
      for (let i = 0; i < n; i++) each(i, (b) => { items[cnt[b]++] = i; });
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
    _initStatic() {
      const SE = new LIB.Emitter(true);
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
        const W = (r) => [r[0] + dx, r[1] + dz, r[2] + dx, r[3] + dz];
        for (const r of lm.footprint || []) this._foot.push({ id: lm.id, r: W(r) });
        for (const r of lm.plinthCut || []) this._plinthCut.push(W(r)); // v1 と同じ: 台を抜くのは沈んだ広場など（v1 の noPlinth）だけ。ランドマークの床は台の上（curbH）
        if (lm.cutDecks) for (const r of lm.footprint || []) this._deckCut.push(W(r));
        if (lm.kind === 'rockefeller' && lm.params.pit) { const q = lm.params.pit; const pr = [q[0] + dx, q[1] + dz, q[2] + dx, q[3] + dz]; this.pits.push({ rect: pr, y: q[4] }); const B = this._pitBB; B[0] = Math.min(B[0], pr[0]); B[1] = Math.min(B[1], pr[1]); B[2] = Math.max(B[2], pr[2]); B[3] = Math.max(B[3], pr[3]); }
      }
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
      lm.params = Object.assign({}, p, { stair: ms });
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
      const clear = (x, z) => this.isLand(x, z) && this.groundY(x, z) === 0 && !this._topOver(x, z, this.curbH + 0.01) &&
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
      if (x >= this._pitBB[0] && x <= this._pitBB[2] && z >= this._pitBB[1] && z <= this._pitBB[3]) { const y = this._pitY(x, z); if (y !== null) return { y, water: null }; } // 沈んだ広場（v1 と同じ）
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
    waterLevelAt(x, z) {
      if (!this.core || !this.core.lgrd || (this.rail && this.rail.pitAt)) return this.groundAt(x, z).water;
      if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return this.waterY;
      if (this.core.isLand(x, z)) return null;
      const w = this._coreWater(x, z);
      return w >= 0 ? this.core.water.y[w] : this.waterY;
    }
    isLand(x, z) { return this.waterLevelAt(x, z) === null; }
    isWater(x, z) { return this.waterLevelAt(x, z) !== null; }
    // 沈んだ広場の底（穴の中でなければ null）
    _pitY(x, z) {
      for (let i = 0; i < this.pits.length; i++) { const p = this.pits[i]; if (x >= p.rect[0] && x <= p.rect[2] && z >= p.rect[1] && z <= p.rect[3]) return p.y; }
      return null;
    }
    // 0 = 陸と桟橋、水の上は水面（穴の中は穴の底）
    groundY(x, z) {
      if (this.core && this.core.lgrd && !(this.rail && this.rail.pitAt)) { // 速い道（物を作らない。supportHeightAt が毎回呼ぶ）
        if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return this.waterY;
        if (x >= this._pitBB[0] && x <= this._pitBB[2] && z >= this._pitBB[1] && z <= this._pitBB[3]) { const y = this._pitY(x, z); if (y !== null) return y; }
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
      const bJoin = dk.barrierJoin != null ? dk.barrierJoin : 0.8, bProbe = dk.barrierProbe != null ? dk.barrierProbe : 0.6;
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
        const t = D.thickness || 1.2;
        const cut = cutRing(D.xz, a, e, A, Bp, Cc);
        if (cut) {
          const cy0 = cut.inside ? y0 : cut.pmin, cy1 = cut.inside ? y1 : cut.pmax;
          const dp = lazyTri({ ring: cut.ring, holes: [], clip: cut.clip, top: [Cc, A, Bp], t, y0: cy0 - t, y1: cy1, f: F.WALK, mat: dk.mat || 'asphalt_city', cat: 'road', deck: D.chain[i], seq: D.seq[i], cls: D.cls[i], kindDeck: D.kind[i] });
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
                g.prisms.push(lazyTri({ ring: new Float32Array(q), holes: [], clip: clipBitsFor([q], cr), top: [Cc + barH, A, Bp], t: barH, y0: pmin, y1: pmax + barH, f: 0, mat: dk.barrierMat || 'concrete', cat: 'barrier', deck: D.chain[i], cutEnd: 1 }));
              }
            }
          }
        }
        const ring = D.xz.subarray(a * 2, e * 2);
        // 縁の壁: 4 角の片の左右の辺（0→3 の左、1→2 の右）、割った三角は外側の辺
        if (barH > 0 && D.kind[i] !== 2 && y0 > (dk.barrierMinY != null ? dk.barrierMinY : 2)) {
          const n = e - a, edges = [];
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
            // 縁の外か壁の所がほかの鎖の床（隣の車道・合流する斜路・遊歩道。データの幅は歩道込みなので並んだ車道の床は重なる）で
            //   高さが barrierJoin m 以内なら壁を立てない（隣の車道の上に壁が立ち、ブルックリン橋の取り付けで車がぶつかった）。
            //   辺の 1/4・1/2・3/4 の点（外 barrierProbe m・壁の真ん中）のうち 2 つ以上
            if (bJoin > 0) {
              let cov = 0;
              for (const u of [0.25, 0.5, 0.75]) {
                const ex = ax + (bx - ax) * u, ez = az + (bz - az) * u;
                const px = ex - nx * bProbe, pz = ez - nz * bProbe, wx = ex + nx * barT / 2, wz = ez + nz * barT / 2;
                if (this._deckCovers(px, pz, Cc + A * px + Bp * pz, bJoin, D.chain[i]) || this._deckCovers(wx, wz, Cc + A * wx + Bp * wz, bJoin, D.chain[i])) cov++;
              }
              if (cov >= 2) continue;
            }
            const br = new Float32Array([ax, az, bx, bz, bx + nx * barT, bz + nz * barT, ax + nx * barT, az + nz * barT]);
            const bc = cutRing(br, 0, 4, A, Bp, Cc);
            if (!bc) continue;
            const bp = lazyTri({ ring: bc.ring, holes: [], clip: bc.clip, top: [Cc + barH, A, Bp], t: barH, y0: bc.inside ? y0 : bc.pmin, y1: (bc.inside ? y1 : bc.pmax) + barH, f: 0, mat: dk.barrierMat || 'concrete', cat: 'barrier', deck: D.chain[i] });
            for (const q of this._cutRects(bp, this._deckCut, cr)) g.prisms.push(q);
          }
        }
      }
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
        const zone = SP.zone[i], hot = zone !== 255;
        const h = hash(this.seed, 92, i, 0);
        if (u01(h) >= (hot ? hotPer : per)) continue;
        const a = (h & 1023) / 1024 * Math.PI * 2;
        E.lootAt(SP.xz[i * 2] + Math.cos(a) * off, this.curbH, SP.xz[i * 2 + 1] + Math.sin(a) * off, hot ? 'hot' : 'street');
      }
      g.loot = E.loot.map((l, n) => ({ id: key + '_' + n, x: l.x, y: l.y, z: l.z, table: l.table }));
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
    // 割った 4 角の 1 つ目の三角形か（次の片が同じ 4 角の 2 つ目: 同じ鎖・kind 1・頂点 0 と 2 を共有）
    _deckFirstTri(i) {
      const D = this._decks;
      if (i + 1 >= D.count || D.kind[i + 1] !== 1 || D.chain[i + 1] !== D.chain[i]) return false;
      const a = D.vertStart[i], b = D.vertStart[i + 1];
      return D.xz[a * 2] === D.xz[b * 2] && D.xz[a * 2 + 1] === D.xz[b * 2 + 1] && D.xz[(a + 2) * 2] === D.xz[(b + 1) * 2] && D.xz[(a + 2) * 2 + 1] === D.xz[(b + 1) * 2 + 1];
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
      for (let i = rows[0]; i < rows[1]; i++) for (const q of this._cutRects(this._plinth(L, i, cx, cz, pm), this._plinthCut, cr)) out.prisms.push(q);
      // CDEC → 路面の印（v1 の decals の形 + 線分）
      const D = tile.decals, dw = NycData.DECAL_WIDTH;
      rows = NycData.chunkRows(D, tile, cx, cz);
      for (let i = rows[0]; i < rows[1]; i++) {
        const x0 = D.seg[i * 4], z0 = D.seg[i * 4 + 1], x1 = D.seg[i * 4 + 2], z1 = D.seg[i * 4 + 3], k = D.kind[i];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.05) continue;
        if (this._foot.length && this._inFoot((x0 + x1) / 2, (z0 + z1) / 2)) continue; // ランドマークの床の上に路面の印を描かない
        out.decals.push({ type: k === 2 ? 'crosswalk' : 'line', kind: k, x: r2((x0 + x1) / 2), z: r2((z0 + z1) / 2), w: r2(len), d: dw[k] || 0.12,
          rot: Math.round(Math.atan2(z1 - z0, x1 - x0) * 1e4) / 1e4, seg: [x0, z0, x1, z1], color: k === 0 ? 'yellow' : 'white' });
      }
      // CPRP → 小物と当たりの箱、柵
      this._props(out, tile, cx, cz);
      void g;
    }
    _plinth(L, i, cx, cz, pm) {
      const r0 = L.ringStart[i], r1 = L.ringStart[i + 1];
      const va = L.vertStart[r0], vb = L.vertStart[r0 + 1], ve = L.vertStart[r1];
      const ring = L.xz.subarray(va * 2, vb * 2), holes = [];
      for (let k = r0 + 1; k < r1; k++) holes.push(L.xz.subarray(L.vertStart[k] * 2, L.vertStart[k + 1] * 2));
      let clip = null;
      for (let v = va; v < ve; v++) if ((L.clip[v >> 3] >> (v & 7)) & 1) { (clip || (clip = new Uint8Array((ve - va + 7) >> 3)))[(v - va) >> 3] |= 1 << ((v - va) & 7); }
      const y1 = L.y[i], kind = L.kind[i];
      const p = { ring, holes, clip, y0: Math.min(0, y1 - this.curbH), y1, f: F.WALK, cat: kind === 1 ? 'plaza' : 'sidewalk', mat: pm[kind] || 'sidewalk', kind, flags: L.flags[i] };
      if (L.triStart && L.triStart[i + 1] > L.triStart[i]) p.tri = L.tri.subarray(L.triStart[i], L.triStart[i + 1]); else lazyTri(p);
      if (this.rail && this.rail.cutPlinth) this.rail.cutPlinth(p, cx, cz); // R4 のフック 5（台に穴）
      return p;
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
      return this._game(cx, cz).loot.slice();
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
    // 橋の床のサーバーの段の箱（下限）: 片ごとに長い方の向きへ min(4, 0.285 / 勾配) m の段、横は段の長さくらいの正方形に分け、
    //   それぞれの中に収まる軸平行の正方形。上端 = その区画の路面の一番低い所、厚さ = 床の厚さ
    _deckSteps(cx, cz, minStep) {
      const out = [], C = this.core;
      if (!C || !this._decks) return out;
      const D = this._decks, dc = this._deckChunk, ci = cz * this.ncx + cx, t = D.thickness || 1.2, cr = this.chunkRect(cx, cz);
      const rise = (this.plan.decks && this.plan.decks.stepRise) || 0.285;
      for (let k = dc.start[ci]; k < dc.start[ci + 1]; k++) {
        const i = dc.items[k], a = D.vertStart[i], n = D.vertStart[i + 1] - a;
        if (n < 3) continue;
        const A = D.plane[i * 3], Bp = D.plane[i * 3 + 1], Cc = D.plane[i * 3 + 2];
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
        for (let i = rows[0]; i < rows[1]; i++) for (const q of this._cutRects(this._plinth(L, i, cx, cz, pm), this._plinthCut, r)) out.prisms.push(q);
      }
      const g = this._game(cx, cz);
      for (const p of g.prisms) if ((p.deck != null && p.cat === 'road') || p.remnant) out.prisms.push(p);
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
        helipads: pads, hotZones: this.hotZones, rails: [], stations: []
      };
      if (this.rail && this.rail.minimap) this.rail.minimap(this._mini); // R4 のフック 10
      return this._mini;
    }

    // ===== 問い合わせ =====
    // (x, z) で一番高い立てる面の上限: core の支え（E を dev + pad 外へ、上端 ceil(y1) + roofExtra、ENTB は v1 の屋上の規則）・橋の床 + deckExtra・
    //   R4 フック 9。O(セルの片)（32 m のセル → core.supi）
    supportHeightAt(x, z) {
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
    _deckCovers(x, z, y, tol, skipChain) {
      const D = this._decks, dk = this._deckCell, bb = this._deckBB, m = 0.35;
      if (!D || !dk) return false;
      const i = Math.floor((x - this.minX) / dk.cell), j = Math.floor((z - this.minZ) / dk.cell);
      if (i < 0 || j < 0 || i >= dk.W || j >= dk.H) return false;
      const k = j * dk.W + i;
      for (let n = dk.csr.start[k]; n < dk.csr.start[k + 1]; n++) {
        const q = dk.csr.items[n];
        if (D.chain[q] === skipChain || x < bb[q * 4] - m || x > bb[q * 4 + 2] + m || z < bb[q * 4 + 1] - m || z > bb[q * 4 + 3] + m) continue;
        if (Math.abs(D.plane[q * 3] * x + D.plane[q * 3 + 1] * z + D.plane[q * 3 + 2] - y) > tol) continue;
        if (this._nearDeck(q, x, z, 0.35)) return true; // 0.35 m: 縁どうしが接する隣の床（隙間は描かない程度）
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
          if (!(SP.mask[i] & want)) continue;
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
  CityGenNyc.GEN_VERSION = 1;
  CityGenNyc.CityGen = CityGen;
  CityGenNyc.F = CityGen.F;
  CityGenNyc.triangulate = triangulate;
  CityGenNyc.clipRing = clipRing;

  MR.CityGenNyc = CityGenNyc;
  if (typeof module !== 'undefined' && module.exports) module.exports = CityGenNyc;
})(typeof window !== 'undefined' ? window : globalThis);
