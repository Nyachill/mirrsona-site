// 3D の当たり判定・視線・地面の高さ・AI の歩行グラフ（THREE 非依存。Node でもそのまま動く）。
//   ブラウザ: <script> で読む → MR.Nav3D      Node / Worker: require('../www/js/nav3d.js') → Nav3D
//
// 読み込んだチャンクの箱・スロープ・梯子（citygen.js の chunkFull / chunkCoarse の形）を 8 m の空間ハッシュに入れて引く。
//   addChunk(key, data) / removeChunk(key) / hasChunk(key)         data = { cx?, cz?, boxes, ramps, ladders, prisms?, voids?, degradedBoxes? }
//     要素の種類 k: 0 箱 / 1 スロープ / 2 多角形の柱（prisms。形は下の「多角形の柱」）/ 3 は R4 の空洞（voids）の予約（今は ch.voids に置くだけ）
//     opts.prismMode（engine.prismMode）: 'exact'（既定）か 'degraded'（柱の代わりに data.degradedBoxes を箱として読む。非常用）
//   Nav3D.fromCity(city, cx, cz, radius, { coarse })               街の周りを読み込んだ Nav3D（loadAround(x, z, r) で追従）
//   Nav3D.fromLevel(level)                                         arena01 などの旧レベル（MR.Nav と同じ結果になる）
//
// 旧 MR.Nav の上位互換（同じ名前・引数・戻り値。y は省略できる追加の引数）:
//   resolveCircle(x, z, r, y?, stepUp?, height?) → { x, z }   y（足元、既定 0）から stepUp〜headroom（または height）の高さにかかる箱だけで押し出す
//   lineOfSight(ax, ay, az, bx, by, bz) → bool     raycast(ox, oy, oz, dx, dy, dz, maxDist, opts?) → { t, dist, x, y, z, nx, ny, nz, box } | null
//   isBlockedAt(x, z, y?) / nearestFree(x, z, maxRadius?, y?) / findPath(sx, sz, tx, tz, sy?, ty?) → [{ x, z, y }]（届かなければ []）
//   setDynamicBoxes([{ x, z, w, d }]) / toCell(x, z) / cellCenter(c, r)
// 3D:
//   groundHeight(x, z, yFeet, r?) → 立てる面の高さ（WALK の箱の上面・スロープ・陸 0）。yFeet + stepUp より上は除く。水だけなら null
//   groundInfo(x, z, yFeet, r?) → { y, water(水面 or null), box }   ceilingHeight(x, z, yHead, r?) → 頭の上で一番低い下面（無ければ Infinity）
//   resolveCapsule(pos{x,y,z}, r, h, stepUp?, { snapDown, groundR, air }?) → { x, y, z, grounded, hitWall, hitCeiling, ground, water, box }
//       壁（上面 > 足 + stepUp、下面 < 足 + h/2）は横に押し出し、段（上面 ≤ 足 + stepUp）は乗る、天井（下面が体の上半分）は下へ押す。
//       重力は呼ぶ側。地面より snapDown（既定 0.05）以内の上なら接地にする（降り階段では stepUp を渡す）。
//       air: 空中のプレイヤー。立てない箱（WALK でない: パラペット・柵・小物）は段の高さでも壁にする
//       （跳んでパラペットの上をかすめて落ちるとき、段の帯の間だけ箱の中に入ってから外へ弾かれないように）
//   waterLevelAt(x, z) → 水面 or null    ladderAt(x, y, z, r) → 触れている梯子 | null
//   findPath3d(from{x,y,z}, to{x,y,z}, maxExpand?, { noLadders }?) → [{ x, y, z }] | null
//       歩行グラフ: チャンクごとに 1 m（graphCell）の柱の上の「立てる面」を節点にする（必要になったときに作る）。
//       隣の柱とは |Δy| ≤ stepUp（スロープの上なら勾配ぶん足す）でつながる。頭上 headroom の空きと、エージェント半径 agentRadius
//       （正方形で膨らませる）の空きが要る。梯子は下と上の節点を結ぶ。展開数の上限 maxExpand（既定 20000）。
//       opts.noBuild: 作っていないグラフは作らない（通れない扱い）。AI はこれで 1 フレームの時間を守り、グラフは
//   buildGraphStep(cx, cz, budgetMs) → bool（出来たか）で 8 m 四方ずつ前もって作る（graphReady(cx, cz)）
//   laddersNear(x, z, radius, out?) → 近くの梯子（屋上から梯子で降りる所を探す）
//   walkableAt(x, z, y, minN?) → その点の節点が周りの minN マス以上とつながっているか（グラフが無ければ null）
//   pathJob(from, to, maxExpand, opts) → { step(budgetMs) → null | { path } | { fail } }   フレームをまたいで進める経路探索（AI）
//   itemsIn(x0, z0, x1, z1, out, opts?) → 矩形にかかる要素（箱 k 0 / スロープ k 1。x0..x1・y0..y1・z0..z1・f）を out に足す（ヘリが 1 フレームに 1 回集める）。
//       柱 k 2 は opts.prisms のときだけ
//   Nav3D.itemTop(item, x, z) → その点の上面（スロープは斜めの高さ）  Nav3D.topAt(item, x, z) → 足元の中なら上面、外なら null
//   Nav3D.closestXZ(item, x, z, out?) → 一番近い壁の点 { x, z, d, e, nx, nz, inside }   Nav3D.pointIn(item, x, z)
(function (root) {
  const MR = root.MR || (root.MR = {});
  const NOCOL = 1, NOLOS = 2, WALK = 4;
  const SLOT = 262144; // 1 チャンクの節点の上限（2^18）
  const FLAT = { y: 0, water: null };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function rampS(b, x, z) { // スロープの上面の高さ
    let u = b.ax === 0 ? (x - b.x0) / b.len : (z - b.z0) / b.len;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    if (b.dir < 0) u = 1 - u;
    return b.ry0 + (b.ry1 - b.ry0) * u;
  }

  // ---------- 多角形の柱（k 2）----------
  // data.prisms[i] = { ring: Float32Array [x0, z0, x1, z1, …]（外周。向きはどちらでもよい・閉じる点は省略可）,
  //   holes?: [Float32Array …]（中庭）, clip?: Uint8Array（辺ごとのビット。辺の番号は外周 → 穴の順、辺 i は点 i → i+1。
  //   ビット i = clip[i >> 3] の (i & 7) 番目。長さが辺の数と同じ Uint8Array なら 1 辺 1 バイト（0 / 1）でもよい）,
  //   y0, y1 か 斜めの上面 top: { a, bx, cz } | [a, bx, cz]（y = a + bx·x + cz·z）と厚さ t（無ければ下面は y0、それも無ければ 0.3）,
  //   f（箱と同じ: WALK / NOLOS / NOCOL。既定 WALK）, mat / cat / gid … はそのまま src として返る }
  // clip の辺はチャンクの境目（隣のチャンクの柱と接する）: 押し出し・描画では壁ではない。内外の判定（偶奇）には使う。
  // 辺が prismCellEdges（24）より多い柱は 8 m の格子の索引を持つ（区画ごとに 内 / 外 / 境目 と、区画を通る辺の一覧、
  //   行の帯ごとの辺の一覧）。内外・最寄りの辺・レイは問い合わせた区画の辺だけを見る。
  // k 3 は R4 の空洞（voids: 地面に開けた穴）のために取ってある。addChunk は data.voids を ch.voids に置くだけ（今は使わない）。
  const PRISM_CELL_EDGES = 24;
  const CS = { x: 0, z: 0, d: Infinity, e: -1 }; // 最寄りの点の作業用（呼んだ直後に読む）
  let RSTAMP = 1;
  let XT = new Float64Array(256), XE = new Int32Array(256); // レイの交点（t 順）
  const RH = { nx: 0, ny: 0, nz: 0 };

  function clipBit(clip, i, E) {
    if (!clip) return 0;
    if (clip.length === E && E > 1) return clip[i] ? 1 : 0;
    return (clip[i >> 3] >> (i & 7)) & 1;
  }
  function loopLen(L) {
    let m = L ? L.length >> 1 : 0;
    if (m >= 2 && L[0] === L[2 * m - 2] && L[1] === L[2 * m - 1]) m--;
    return m;
  }
  // 柱の形（辺の配列・平面・索引）
  function makePrism(p, cs, gx, gz, cellEdges) {
    const loops = [p.ring].concat(p.holes || []);
    const lens = loops.map(loopLen);
    if (!(lens[0] >= 3)) return null;
    let E = 0;
    for (const m of lens) if (m >= 3) E += m;
    const D = new Float64Array(E * 8); // 辺ごとに [ax, az, bx, bz, 1/長さ², 外向きの法線 nx, nz, 壁なら 1]（1 つの配列 = 作るのが速い）
    let e = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, nSolid = 0;
    for (let li = 0; li < loops.length; li++) {
      const L = loops[li], m = lens[li];
      if (m < 3) continue;
      let A = 0;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m; A += L[2 * i] * L[2 * j + 1] - L[2 * j] * L[2 * i + 1]; }
      const sgn = (A > 0 ? 1 : -1) * (li === 0 ? 1 : -1); // 外周: 内側の外向き / 穴: 穴の中向き
      for (let i = 0; i < m; i++, e++) {
        const j = (i + 1) % m;
        const xa = L[2 * i], za = L[2 * i + 1], xb = L[2 * j], zb = L[2 * j + 1];
        const o = e * 8;
        D[o] = xa; D[o + 1] = za; D[o + 2] = xb; D[o + 3] = zb;
        const ex = xb - xa, ez = zb - za, l2 = ex * ex + ez * ez, l = Math.sqrt(l2);
        D[o + 4] = l2 > 0 ? 1 / l2 : 0;
        D[o + 5] = l > 0 ? sgn * ez / l : 0; D[o + 6] = l > 0 ? -sgn * ex / l : 0;
        D[o + 7] = clipBit(p.clip, e, E) ? 0 : 1;
        if (D[o + 7]) nSolid++;
        if (li === 0) { if (xa < x0) x0 = xa; if (xa > x1) x1 = xa; if (za < z0) z0 = za; if (za > z1) z1 = za; }
      }
    }
    // 平面: 上 y ≤ ta + tbx·x + tcz·z、下 y ≥ ba + bbx·x + bcz·z
    let ta, tbx = 0, tcz = 0, ba, bbx = 0, bcz = 0;
    const top = p.top;
    if (top) {
      ta = top.a != null ? top.a : top[0]; tbx = (top.bx != null ? top.bx : top[1]) || 0; tcz = (top.cz != null ? top.cz : top[2]) || 0;
      if (p.t != null || p.y0 == null) { const t = p.t != null ? p.t : 0.3; ba = ta - t; bbx = tbx; bcz = tcz; }
      else ba = p.y0;
    } else {
      ba = p.y0 || 0;
      ta = p.y1 != null ? p.y1 : ba + (p.h || 0);
    }
    let ymin = Infinity, ymax = -Infinity;
    const R = loops[0];
    for (let i = 0; i < lens[0]; i++) {
      const x = R[2 * i], z = R[2 * i + 1], tv = ta + tbx * x + tcz * z, bv = ba + bbx * x + bcz * z;
      if (tv > ymax) ymax = tv; if (bv < ymin) ymin = bv;
    }
    const pr = { E, nSolid, D, x0, z0, x1, z1, ymin, ymax,
      ta, tbx, tcz, ba, bbx, bcz, tg: Math.hypot(tbx, tcz), bg: Math.hypot(bbx, bcz), planar: tbx !== 0 || tcz !== 0,
      cs, cls: null, gi0: 0, gj0: 0, gnx: 0, gnz: 0, gx, gz, cellStart: null, cellE: null, bandStart: null, bandE: null, stamp: null };
    if (E > cellEdges) buildIndex(pr);
    return pr;
  }
  // 8 m の格子の索引（区画: 0 外 / 1 内 / 2 境目 + 辺の一覧、行の帯: 辺の一覧）
  function buildIndex(pr) {
    const cs = pr.cs, gx = pr.gx, gz = pr.gz, E = pr.E;
    const gi0 = Math.floor((pr.x0 - gx) / cs), gi1 = Math.floor((pr.x1 - gx) / cs), gj0 = Math.floor((pr.z0 - gz) / cs), gj1 = Math.floor((pr.z1 - gz) / cs);
    const nxC = gi1 - gi0 + 1, nzC = gj1 - gj0 + 1, NC = nxC * nzC;
    const cellStart = new Int32Array(NC + 1), bandStart = new Int32Array(nzC + 1);
    let cellE = null, bandE = null, cpos = null, bpos = null;
    for (let pass = 0; pass < 2; pass++) {
      for (let e = 0; e < E; e++) {
        const xa = pr.D[e * 8], za = pr.D[e * 8 + 1], xb = pr.D[e * 8 + 2], zb = pr.D[e * 8 + 3];
        const zmin = za < zb ? za : zb, zmax = za < zb ? zb : za;
        let ja = Math.floor((zmin - gz) / cs) - gj0, jb = Math.floor((zmax - gz) / cs) - gj0;
        if (ja < 0) ja = 0; if (jb > nzC - 1) jb = nzC - 1;
        for (let j = ja; j <= jb; j++) {
          if (pass === 0) bandStart[j + 1]++; else bandE[bpos[j]++] = e;
          const zr0 = gz + (gj0 + j) * cs, zr1 = zr0 + cs;
          let lo, hi;
          if (zb === za) { lo = xa < xb ? xa : xb; hi = xa < xb ? xb : xa; }
          else {
            const zA = zmin > zr0 ? zmin : zr0, zB = zmax < zr1 ? zmax : zr1, k = (xb - xa) / (zb - za);
            const xA = xa + (zA - za) * k, xB = xa + (zB - za) * k;
            lo = xA < xB ? xA : xB; hi = xA < xB ? xB : xA;
          }
          let ia = Math.floor((lo - gx) / cs) - gi0, ib = Math.floor((hi - gx) / cs) - gi0;
          if (ia < 0) ia = 0; if (ib > nxC - 1) ib = nxC - 1;
          for (let i = ia; i <= ib; i++) { const c = j * nxC + i; if (pass === 0) cellStart[c + 1]++; else cellE[cpos[c]++] = e; }
        }
      }
      if (pass === 0) {
        for (let c = 0; c < NC; c++) cellStart[c + 1] += cellStart[c];
        for (let j = 0; j < nzC; j++) bandStart[j + 1] += bandStart[j];
        cellE = new Int32Array(cellStart[NC]); bandE = new Int32Array(bandStart[nzC]);
        cpos = cellStart.slice(0, NC); bpos = bandStart.slice(0, nzC);
      }
    }
    // 辺の通らない区画は真ん中の内外で決まる（行の真ん中の線と辺の交点を数える）
    const cls = new Uint8Array(NC);
    let xs = new Float64Array(64);
    for (let j = 0; j < nzC; j++) {
      const zc = gz + (gj0 + j + 0.5) * cs;
      let n = 0;
      for (let q = bandStart[j]; q < bandStart[j + 1]; q++) {
        const e = bandE[q], za = pr.D[e * 8 + 1], zb = pr.D[e * 8 + 3];
        if ((za > zc) === (zb > zc)) continue;
        if (n >= xs.length) { const t = new Float64Array(xs.length * 2); t.set(xs); xs = t; }
        xs[n++] = pr.D[e * 8] + (zc - za) * (pr.D[e * 8 + 2] - pr.D[e * 8]) / (zb - za);
      }
      const s = xs.subarray(0, n); s.sort();
      let p = 0;
      for (let i = 0; i < nxC; i++) {
        const c = j * nxC + i;
        if (cellStart[c + 1] > cellStart[c]) { cls[c] = 2; continue; }
        const xc = gx + (gi0 + i + 0.5) * cs;
        while (p < n && s[p] <= xc) p++;
        cls[c] = ((n - p) & 1) ? 1 : 0; // 右側の交点が奇数なら内
      }
    }
    // 境目の区画: 基準点（真ん中。辺に近ければ少しずらす）の内外を前もって数えておく（問い合わせは基準点からの線分と区画の辺の交点だけ）
    const refX = new Float64Array(NC), refZ = new Float64Array(NC), refIn = new Uint8Array(NC);
    const OFF = [[0.5, 0.5], [0.37, 0.61], [0.63, 0.29], [0.21, 0.77], [0.79, 0.43], [0.13, 0.17]];
    for (let j = 0; j < nzC; j++) for (let i = 0; i < nxC; i++) {
      const c = j * nxC + i;
      if (cls[c] !== 2) continue;
      let rx = 0, rz = 0;
      for (const o of OFF) {
        rx = gx + (gi0 + i + o[0]) * cs; rz = gz + (gj0 + j + o[1]) * cs;
        let near = false;
        for (let q = cellStart[c]; q < cellStart[c + 1] && !near; q++) {
          const e = cellE[q], ex = pr.D[e * 8 + 2] - pr.D[e * 8], ez = pr.D[e * 8 + 3] - pr.D[e * 8 + 1];
          let u = ((rx - pr.D[e * 8]) * ex + (rz - pr.D[e * 8 + 1]) * ez) * pr.D[e * 8 + 4]; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = rx - pr.D[e * 8] - ex * u, dz = rz - pr.D[e * 8 + 1] - ez * u;
          if (dx * dx + dz * dz < 1e-6) near = true;
          if (Math.abs(pr.D[e * 8 + 1] - rz) < 1e-6 || Math.abs(pr.D[e * 8 + 3] - rz) < 1e-6) near = true; // 横の半直線が頂点を通らない
        }
        if (!near) break;
      }
      let inside = false;
      for (let q = bandStart[j]; q < bandStart[j + 1]; q++) {
        const e = bandE[q], za = pr.D[e * 8 + 1], zb = pr.D[e * 8 + 3];
        if ((za > rz) === (zb > rz)) continue;
        if (rx < pr.D[e * 8] + (rz - za) * (pr.D[e * 8 + 2] - pr.D[e * 8]) / (zb - za)) inside = !inside;
      }
      refX[c] = rx; refZ[c] = rz; refIn[c] = inside ? 1 : 0;
    }
    pr.refX = refX; pr.refZ = refZ; pr.refIn = refIn;
    pr.cls = cls; pr.gi0 = gi0; pr.gj0 = gj0; pr.gnx = nxC; pr.gnz = nzC;
    pr.cellStart = cellStart; pr.cellE = cellE; pr.bandStart = bandStart; pr.bandE = bandE;
    pr.stamp = new Uint32Array(E);
  }
  // 点が柱の足元（穴を除く）の中か（偶奇。+x 向きの半直線と辺の交点）
  function prIn(pr, x, z) {
    if (x < pr.x0 || x > pr.x1 || z < pr.z0 || z > pr.z1) return false;
    if (pr.cls) {
      const i = Math.floor((x - pr.gx) / pr.cs) - pr.gi0, j = Math.floor((z - pr.gz) / pr.cs) - pr.gj0;
      if (i < 0 || j < 0 || i >= pr.gnx || j >= pr.gnz) return false;
      const ci = j * pr.gnx + i, c = pr.cls[ci];
      if (c !== 2) return c === 1;
      // 基準点 → (x, z) の線分と区画の辺の交点の数（線分の直線に対する辺の端の側は「≥ 0」でそろえる = 頂点を 2 度数えない）
      const rx = pr.refX[ci], rz = pr.refZ[ci], sx = x - rx, sz = z - rz, CE = pr.cellE, D = pr.D;
      let par = pr.refIn[ci] === 1;
      for (let q = pr.cellStart[ci], q1 = pr.cellStart[ci + 1]; q < q1; q++) {
        const e = CE[q], ax = D[e * 8], az = D[e * 8 + 1], bx = D[e * 8 + 2], bz = D[e * 8 + 3];
        const sa = sx * (az - rz) - sz * (ax - rx) >= 0, sb = sx * (bz - rz) - sz * (bx - rx) >= 0;
        if (sa === sb) continue;
        const ex = bx - ax, ez = bz - az, o1 = ex * (rz - az) - ez * (rx - ax), o2 = ex * (z - az) - ez * (x - ax);
        if ((o1 > 0) !== (o2 > 0)) par = !par;
      }
      return par;
    }
    const D = pr.D;
    let inside = false;
    for (let e = 0; e < pr.E; e++) {
      const za = D[e * 8 + 1], zb = D[e * 8 + 3];
      if ((za > z) === (zb > z)) continue;
      if (x < D[e * 8] + (z - za) * (D[e * 8 + 2] - D[e * 8]) / (zb - za)) inside = !inside;
    }
    return inside;
  }
  // 一番近い辺の上の点（solidOnly: clip の辺は除く）。maxD より遠ければ Infinity。CS に x, z, d, e
  function prClosest(pr, x, z, maxD, solidOnly, out) {
    let best = maxD === Infinity ? Infinity : maxD * maxD, be = -1, bxp = 0, bzp = 0;
    const D = pr.D;
    if (!pr.cls) {
      for (let e = 0; e < pr.E; e++) {
        if (solidOnly && !D[e * 8 + 7]) continue;
        const ex = D[e * 8 + 2] - D[e * 8], ez = D[e * 8 + 3] - D[e * 8 + 1];
        let u = ((x - D[e * 8]) * ex + (z - D[e * 8 + 1]) * ez) * D[e * 8 + 4];
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const px = D[e * 8] + ex * u, pz = D[e * 8 + 1] + ez * u, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (d2 < best) { best = d2; be = e; bxp = px; bzp = pz; }
      }
    } else {
      const cs = pr.cs, nxC = pr.gnx, nzC = pr.gnz, gx0 = pr.gx + pr.gi0 * cs, gz0 = pr.gz + pr.gj0 * cs;
      const CSt = pr.cellStart, CE = pr.cellE;
      if (maxD !== Infinity) { // 近くだけ: maxD の正方形にかかる区画
        let i0 = Math.floor((x - maxD - gx0) / cs), i1 = Math.floor((x + maxD - gx0) / cs), j0 = Math.floor((z - maxD - gz0) / cs), j1 = Math.floor((z + maxD - gz0) / cs);
        if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (i1 > nxC - 1) i1 = nxC - 1; if (j1 > nzC - 1) j1 = nzC - 1;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const c = j * nxC + i;
          for (let q = CSt[c], q1 = CSt[c + 1]; q < q1; q++) {
            const e = CE[q];
            if (solidOnly && !D[e * 8 + 7]) continue;
            const ex = D[e * 8 + 2] - D[e * 8], ez = D[e * 8 + 3] - D[e * 8 + 1];
            let u = ((x - D[e * 8]) * ex + (z - D[e * 8 + 1]) * ez) * D[e * 8 + 4];
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const px = D[e * 8] + ex * u, pz = D[e * 8 + 1] + ez * u, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
            if (d2 < best || (d2 === best && e < be)) { best = d2; be = e; bxp = px; bzp = pz; }
          }
        }
        out.e = be;
        if (be < 0) { out.d = Infinity; return Infinity; }
        out.x = bxp; out.z = bzp; out.d = Math.sqrt(best);
        return out.d;
      }
      const qi = Math.floor((x - gx0) / cs), qj = Math.floor((z - gz0) / cs);
      let kmin = 0;
      if (-qi > kmin) kmin = -qi; if (qi - (nxC - 1) > kmin) kmin = qi - (nxC - 1);
      if (-qj > kmin) kmin = -qj; if (qj - (nzC - 1) > kmin) kmin = qj - (nzC - 1);
      let kmax = qi; if (nxC - 1 - qi > kmax) kmax = nxC - 1 - qi; if (qj > kmax) kmax = qj; if (nzC - 1 - qj > kmax) kmax = nzC - 1 - qj;
      if (kmax < kmin) kmax = kmin;
      for (let k = kmin; k <= kmax; k++) {
        if (k >= 1) { const lb = (k - 1) * cs; if (lb * lb > best) break; }
        for (let j = qj - k; j <= qj + k; j++) {
          if (j < 0 || j >= nzC) continue;
          const edgeRow = j === qj - k || j === qj + k;
          const dz = z < gz0 + j * cs ? gz0 + j * cs - z : z > gz0 + (j + 1) * cs ? z - gz0 - (j + 1) * cs : 0;
          for (let i = qi - k; i <= qi + k; i += (edgeRow || k === 0) ? 1 : 2 * k) {
            if (i < 0 || i >= nxC) continue;
            const c = j * nxC + i;
            if (CSt[c + 1] === CSt[c]) continue;
            const dx = x < gx0 + i * cs ? gx0 + i * cs - x : x > gx0 + (i + 1) * cs ? x - gx0 - (i + 1) * cs : 0;
            if (dx * dx + dz * dz > best) continue;
            for (let q = CSt[c]; q < CSt[c + 1]; q++) {
              const e = CE[q];
              if (solidOnly && !D[e * 8 + 7]) continue;
              const ex = D[e * 8 + 2] - D[e * 8], ez = D[e * 8 + 3] - D[e * 8 + 1];
              let u = ((x - D[e * 8]) * ex + (z - D[e * 8 + 1]) * ez) * D[e * 8 + 4];
              u = u < 0 ? 0 : u > 1 ? 1 : u;
              const px = D[e * 8] + ex * u, pz = D[e * 8 + 1] + ez * u, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
              if (d2 < best || (d2 === best && e < be)) { best = d2; be = e; bxp = px; bzp = pz; }
            }
          }
        }
      }
    }
    out.e = be;
    if (be < 0) { out.d = Infinity; return Infinity; }
    out.x = bxp; out.z = bzp; out.d = Math.sqrt(best);
    return out.d;
  }
  // 足元の多角形までの距離が rad 以下か（中なら true）
  function prTouch(pr, x, z, rad, strict) {
    if (prIn(pr, x, z)) return true;
    const d = prClosest(pr, x, z, rad, false, CS);
    return strict ? d < rad : d <= rad;
  }
  function prTop(pr, x, z) { const v = pr.ta + pr.tbx * x + pr.tcz * z; return v < pr.ymin ? pr.ymin : v > pr.ymax ? pr.ymax : v; }
  function prBot(pr, x, z) { const v = pr.ba + pr.bbx * x + pr.bcz * z; return v < pr.ymin ? pr.ymin : v > pr.ymax ? pr.ymax : v; }
  // 円の中心 (x, z)・半径 r が柱の壁に触れているか。触れていれば PC に押し出した位置と、そこでの上面・下面
  const PC = { x: 0, z: 0, top: 0, bot: 0 };
  function prContact(pr, x, z, r) {
    if (x < pr.x0 - r || x > pr.x1 + r || z < pr.z0 - r || z > pr.z1 + r) return false;
    if (prIn(pr, x, z)) {
      PC.top = prTop(pr, x, z); PC.bot = prBot(pr, x, z);
      PC.x = NaN; // 押し出しは高さを見てから（prPushIn）
      return true;
    }
    const d = prClosest(pr, x, z, r, true, CS);
    if (!(d < r)) return false;
    PC.top = prTop(pr, CS.x, CS.z); PC.bot = prBot(pr, CS.x, CS.z);
    if (d > 1e-9) { PC.x = CS.x + (x - CS.x) / d * r; PC.z = CS.z + (z - CS.z) / d * r; }
    else { PC.x = CS.x + pr.D[CS.e * 8 + 5] * r; PC.z = CS.z + pr.D[CS.e * 8 + 6] * r; }
    return true;
  }
  // 中にいる円を一番近い壁の外へ（壁が無い = 全部 clip の辺ならそのまま false）
  function prPushIn(pr, x, z, r) {
    const d = prClosest(pr, x, z, Infinity, true, CS);
    if (d === Infinity) return false;
    if (d > 1e-9) { PC.x = CS.x + (CS.x - x) / d * r; PC.z = CS.z + (CS.z - z) / d * r; }
    else { PC.x = CS.x + pr.D[CS.e * 8 + 5] * r; PC.z = CS.z + pr.D[CS.e * 8 + 6] * r; }
    return true;
  }
  // レイと柱: 外から入る最初の t（無ければ -1）。法線は RH
  let RS_in = false, RS_chk = false, RS_lo = 0, RS_hi = 0, RS_plane = false, RT = -1, RE = -1;
  function rsCross(t, e) { // 1: 当たった（RT, RE）/ 0: 続ける / -1: hi を過ぎた
    if (t < RS_lo) { RS_in = !RS_in; return 0; }
    if (!RS_chk) { RS_chk = true; if (RS_in && RS_plane) { RT = RS_lo; RE = -1; return 1; } }
    if (t > RS_hi) return -1;
    RS_in = !RS_in;
    if (RS_in) { RT = t; RE = e; return 1; }
    return 0;
  }
  function crossT(pr, e, ox, oz, dx, dz) { // 辺 e と 2D の直線の交点の t（交わらなければ NaN）
    const ax = pr.D[e * 8], az = pr.D[e * 8 + 1], bx = pr.D[e * 8 + 2], bz = pr.D[e * 8 + 3];
    const sa = dx * (az - oz) - dz * (ax - ox) >= 0, sb = dx * (bz - oz) - dz * (bx - ox) >= 0;
    if (sa === sb) return NaN;
    const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
    if (den === 0) return NaN;
    return ((ax - ox) * ez - (az - oz) * ex) / den;
  }
  function pushX(h, n, t, e) { // t 順に挿入（XT[h..n) はまだ数えていない交点）
    if (n >= XT.length) { const a = new Float64Array(XT.length * 2); a.set(XT); XT = a; const b = new Int32Array(XE.length * 2); b.set(XE); XE = b; }
    let k = n;
    while (k > h && XT[k - 1] > t) { XT[k] = XT[k - 1]; XE[k] = XE[k - 1]; k--; }
    XT[k] = t; XE[k] = e;
    return n + 1;
  }
  function rayPrismHit(pr, kind) {
    if (RE >= 0) { RH.nx = pr.D[RE * 8 + 5]; RH.ny = 0; RH.nz = pr.D[RE * 8 + 6]; }
    else if (kind === 1) { const L = Math.sqrt(pr.tbx * pr.tbx + 1 + pr.tcz * pr.tcz); RH.nx = -pr.tbx / L; RH.ny = 1 / L; RH.nz = -pr.tcz / L; }
    else { const L = Math.sqrt(pr.bbx * pr.bbx + 1 + pr.bcz * pr.bcz); RH.nx = pr.bbx / L; RH.ny = -1 / L; RH.nz = pr.bcz / L; }
    return RT;
  }
  function rayPrism(pr, ox, oy, oz, dx, dy, dz, tmax) {
    // 上下の平面の間にいる t の区間
    let tv0 = -Infinity, tv1 = Infinity, kind = 0;
    let c0 = oy - (pr.ta + pr.tbx * ox + pr.tcz * oz), c1 = dy - (pr.tbx * dx + pr.tcz * dz);
    if (c1 === 0) { if (c0 > 0) return -1; } else { const t = -c0 / c1; if (c1 < 0) { if (t > tv0) { tv0 = t; kind = 1; } } else if (t < tv1) tv1 = t; }
    c0 = pr.ba + pr.bbx * ox + pr.bcz * oz - oy; c1 = pr.bbx * dx + pr.bcz * dz - dy;
    if (c1 === 0) { if (c0 > 0) return -1; } else { const t = -c0 / c1; if (c1 < 0) { if (t > tv0) { tv0 = t; kind = 2; } } else if (t < tv1) tv1 = t; }
    if (tv0 > tv1 || tv1 < 0 || tv0 > tmax) return -1;
    const lo = tv0 > 0 ? tv0 : 0, hi = tv1 < tmax ? tv1 : tmax;
    if (dx * dx + dz * dz < 1e-18) { // 真上 / 真下
      if (kind && tv0 >= 0 && prIn(pr, ox, oz)) { RT = tv0; RE = -1; return rayPrismHit(pr, kind); }
      return -1;
    }
    // 足元の外接矩形を通る区間
    const eps = 1e-6;
    let tb0 = -Infinity, tb1 = Infinity;
    if (Math.abs(dx) < 1e-12) { if (ox < pr.x0 - eps || ox > pr.x1 + eps) return -1; }
    else { let a = (pr.x0 - eps - ox) / dx, b = (pr.x1 + eps - ox) / dx; if (a > b) { const q = a; a = b; b = q; } if (a > tb0) tb0 = a; if (b < tb1) tb1 = b; }
    if (Math.abs(dz) < 1e-12) { if (oz < pr.z0 - eps || oz > pr.z1 + eps) return -1; }
    else { let a = (pr.z0 - eps - oz) / dz, b = (pr.z1 + eps - oz) / dz; if (a > b) { const q = a; a = b; b = q; } if (a > tb0) tb0 = a; if (b < tb1) tb1 = b; }
    if (tb0 > tb1 || tb1 < lo || tb0 > hi) return -1;
    RS_in = false; RS_chk = false; RS_lo = lo; RS_hi = hi; RS_plane = kind !== 0 && tv0 >= 0; RT = -1; RE = -1;
    if (!pr.cls) {
      let n = 0;
      for (let e = 0; e < pr.E; e++) { const t = crossT(pr, e, ox, oz, dx, dz); if (t === t) n = pushX(0, n, t, e); }
      for (let q = 0; q < n; q++) { const s = rsCross(XT[q], XE[q]); if (s === 1) return rayPrismHit(pr, kind); if (s < 0) return -1; }
    } else {
      // 索引の区画を直線に沿って（外接矩形の入口から）。区画を出る t までの交点は全部そろっているので順に数える
      const st = ++RSTAMP, cs = pr.cs, nxC = pr.gnx, nzC = pr.gnz, gx0 = pr.gx + pr.gi0 * cs, gz0 = pr.gz + pr.gj0 * cs;
      const px = ox + dx * tb0, pz = oz + dz * tb0;
      let i = Math.floor((px - gx0) / cs), j = Math.floor((pz - gz0) / cs);
      i = i < 0 ? 0 : i >= nxC ? nxC - 1 : i; j = j < 0 ? 0 : j >= nzC ? nzC - 1 : j;
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      let tmx = Math.abs(dx) > 1e-12 ? (gx0 + (i + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
      let tmz = Math.abs(dz) > 1e-12 ? (gz0 + (j + (dz > 0 ? 1 : 0)) * cs - oz) / dz : Infinity;
      const tdx = Math.abs(dx) > 1e-12 ? cs / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-12 ? cs / Math.abs(dz) : Infinity;
      let n = 0, h = 0;
      const CSt = pr.cellStart, CE = pr.cellE, STP = pr.stamp;
      for (let guard = 0; guard < 100000; guard++) {
        const c = j * nxC + i;
        for (let q = CSt[c]; q < CSt[c + 1]; q++) {
          const e = CE[q];
          if (STP[e] === st) continue;
          STP[e] = st;
          const t = crossT(pr, e, ox, oz, dx, dz);
          if (t === t) n = pushX(h, n, t, e);
        }
        const texit = tmx < tmz ? tmx : tmz;
        while (h < n && XT[h] <= texit) { const s = rsCross(XT[h], XE[h]); h++; if (s === 1) return rayPrismHit(pr, kind); if (s < 0) return -1; }
        if (texit > hi) break;
        if (tmx < tmz) { tmx += tdx; i += sx; } else { tmz += tdz; j += sz; }
        if (i < 0 || j < 0 || i >= nxC || j >= nzC) break;
      }
      while (h < n) { const s = rsCross(XT[h], XE[h]); h++; if (s === 1) return rayPrismHit(pr, kind); if (s < 0) return -1; }
    }
    if (!RS_chk && RS_in && RS_plane && lo <= hi) { RT = lo; RE = -1; return rayPrismHit(pr, kind); }
    return -1;
  }

  // 当たり判定の要素（箱 k = 0 / スロープ k = 1 / 多角形の柱 k = 2（pr に形）。k 3 は R4 の空洞の予約。形をそろえて速く）
  class Item {
    constructor(k, x0, x1, y0, y1, z0, z1, f, src) {
      this.k = k; this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1; this.z0 = z0; this.z1 = z1; this.f = f; this.src = src;
      this.slot = 0; this.seq = 0; this.stamp = 0;
      this.ax = 0; this.dir = 1; this.ry0 = 0; this.ry1 = 0; this.t = 0; this.len = 1; this.slope = 0; this.planes = null; this.pr = null;
    }
  }

  // 旧 Nav と同じ最小ヒープ（キーは比較のときに読む）
  class Heap {
    constructor(key) { this.key = key; this.items = []; }
    get size() { return this.items.length; }
    push(i) {
      const a = this.items, key = this.key; a.push(i);
      let k = a.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (key(a[p]) <= key(a[k])) break;
        const t = a[p]; a[p] = a[k]; a[k] = t; k = p;
      }
    }
    pop() {
      const a = this.items, key = this.key, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < a.length && key(a[l]) < key(a[m])) m = l;
          if (r < a.length && key(a[r]) < key(a[m])) m = r;
          if (m === k) break;
          const t = a[m]; a[m] = a[k]; a[k] = t; k = m;
        }
      }
      return top;
    }
  }

  class Nav3D {
    // opts: { minX, minZ, maxX, maxZ, chunkSize, hashCell, graphCell, stepUp, headroom, agentRadius, maxExpand, groundAt(x,z) → { y, water } }
    constructor(opts) {
      opts = opts || {};
      this.minX = opts.minX; this.minZ = opts.minZ; this.maxX = opts.maxX; this.maxZ = opts.maxZ;
      this.chunkSize = opts.chunkSize || 128;
      this.hcell = opts.hashCell || 8;
      this.gcell = opts.graphCell || 1;
      this.stepUp = opts.stepUp != null ? opts.stepUp : 0.45;
      this.headroom = opts.headroom != null ? opts.headroom : 1.8;
      this.inflate = opts.agentRadius != null ? opts.agentRadius : 0.3;
      this.maxExpand = opts.maxExpand || 20000;
      this.groundAt = opts.groundAt || (() => FLAT);
      // 多角形の柱（k 2）: 'exact'（既定）| 'degraded'（柱を読まず、チャンクの degradedBoxes を箱として読む。非常用）
      this.prismMode = opts.prismMode === 'degraded' ? 'degraded' : 'exact';
      this.prismCellEdges = opts.prismCellEdges != null ? opts.prismCellEdges : PRISM_CELL_EDGES;
      this.items = [];
      this.freeSlots = [];
      this.seq = 0;
      this.hash = new Map();
      this.lhash = new Map();
      this.chunks = new Map();
      this.gslots = [];
      this.gfree = [];
      this.gmap = new Map();
      this._stamp = 1;
      this._search = 0;
      this._ladDirty = true;
      this._ladEdges = new Map();
      this._dyn = null;
      this._bufs = [[], [], [], [], []];
      this.cols = Math.round((this.maxX - this.minX) / this.gcell);
      this.rows = Math.round((this.maxZ - this.minZ) / this.gcell);
      this.cell = this.gcell; // 旧 Nav の cell（格子 1 m）
      this.gn = Math.round(this.chunkSize / this.gcell);
    }

    // ---------- チャンク ----------
    _hk(ix, iz) { return (ix + 4096) * 8192 + (iz + 4096); } // 31 bit に収まる整数（Map のキーが速い）
    _ix(x) { return Math.floor((x - this.minX) / this.hcell); }
    _iz(z) { return Math.floor((z - this.minZ) / this.hcell); }
    hasChunk(key) { return this.chunks.has(key); }
    addChunk(key, data) {
      if (this.chunks.has(key)) this.removeChunk(key);
      let cx = data.cx, cz = data.cz;
      if (cx == null) { const p = String(key).split('_'); cx = +p[0]; cz = +p[1]; }
      const ch = { key, cx, cz, slots: [], cells: [], ladders: [], voids: data.voids || null }; // voids（k 3）は R4 まで使わない
      const hc = this.hcell, mx = this.minX, mz = this.minZ, hash = this.hash;
      const add = (rec) => {
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
          if (a.mark !== ch) { a.mark = ch; ch.cells.push(k); }
        }
      };
      for (const b of data.boxes || []) {
        if (b.f & NOCOL) continue;
        const y = b.y || 0;
        add(new Item(0, b.x - b.w / 2, b.x + b.w / 2, y, y + b.h, b.z - b.d / 2, b.z + b.d / 2, b.f == null ? WALK : b.f, b));
      }
      if (this.prismMode === 'degraded') {
        for (const b of data.degradedBoxes || []) {
          if (b.f & NOCOL) continue;
          const y = b.y || 0;
          add(new Item(0, b.x - b.w / 2, b.x + b.w / 2, y, y + b.h, b.z - b.d / 2, b.z + b.d / 2, b.f == null ? WALK : b.f, b));
        }
      } else {
        for (const p of data.prisms || []) {
          if (p.f & NOCOL) continue;
          const pr = makePrism(p, this.hcell, this.minX, this.minZ, this.prismCellEdges);
          if (!pr) continue;
          const it = new Item(2, pr.x0, pr.x1, pr.ymin, pr.ymax, pr.z0, pr.z1, p.f == null ? WALK : p.f, p);
          it.pr = pr; it.slope = pr.tg;
          add(it);
        }
      }
      for (const r of data.ramps || []) {
        if (r.f & NOCOL) continue;
        const t = r.t || 0.3, lo = Math.min(r.y0, r.y1), hi = Math.max(r.y0, r.y1);
        const it = new Item(1, r.x - r.w / 2, r.x + r.w / 2, lo - t, hi, r.z - r.d / 2, r.z + r.d / 2, r.f | WALK, r);
        it.ax = r.axis === 'x' ? 0 : 1; it.dir = r.dir < 0 ? -1 : 1; it.ry0 = lo; it.ry1 = hi; it.t = t; it.len = r.axis === 'x' ? r.w : r.d; it.slope = (hi - lo) / it.len;
        add(it);
      }
      for (const l of data.ladders || []) {
        const rec = { x: l.x, z: l.z, y0: l.y0, y1: l.y1, nx: l.nx, nz: l.nz, src: l, chunk: key };
        ch.ladders.push(rec);
        const k = this._hk(this._ix(l.x), this._iz(l.z));
        let a = this.lhash.get(k);
        if (!a) { a = []; this.lhash.set(k, a); }
        a.push(rec);
      }
      this.chunks.set(key, ch);
      this._invalidateAround(cx, cz);
      return ch;
    }
    removeChunk(key) {
      const ch = this.chunks.get(key);
      if (!ch) return;
      for (const s of ch.slots) this.items[s] = null;
      for (const k of ch.cells) {
        const a = this.hash.get(k);
        if (!a) continue;
        let w = 0;
        for (let i = 0; i < a.length; i++) if (this.items[a[i]]) a[w++] = a[i];
        a.length = w;
        a.mark = null;
        if (!w) this.hash.delete(k);
      }
      for (const s of ch.slots) this.freeSlots.push(s);
      for (const l of ch.ladders) {
        const k = this._hk(this._ix(l.x), this._iz(l.z)), a = this.lhash.get(k);
        if (a) { const i = a.indexOf(l); if (i >= 0) a.splice(i, 1); if (!a.length) this.lhash.delete(k); }
      }
      if (ch.graph) this._freeGraph(ch);
      this.chunks.delete(key);
      this._invalidateAround(ch.cx, ch.cz);
    }
    _invalidateAround(cx, cz) {
      for (const [k, v] of this.gmap) if (v === null) this.gmap.delete(k);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get((cx + dx) + '_' + (cz + dz));
        if (c) c.inval = (c.inval || 0) + 1; // 作りかけの歩行グラフ（_graphGen）はやり直す
        if (c && c.graph) this._freeGraph(c);
      }
      this._ladDirty = true;
    }
    _freeGraph(ch) { this.gslots[ch.graph.slot] = null; this.gfree.push(ch.graph.slot); this.gmap.delete(ch.cz * 4096 + ch.cx); ch.graph = null; this._ladDirty = true; }

    // 矩形と重なる要素（重複なし）を out に集める
    _gather(x0, z0, x1, z1, out) {
      out.length = 0;
      const st = ++this._stamp;
      const i0 = this._ix(x0), i1 = this._ix(x1), j0 = this._iz(z0), j1 = this._iz(z1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const a = this.hash.get(this._hk(i, j));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const b = this.items[a[k]];
          if (!b || b.stamp === st) continue;
          b.stamp = st;
          if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
          out.push(b);
        }
      }
      return out;
    }

    // 矩形と重なる当たり判定の要素（箱 k 0 / スロープ k 1。x0..x1, y0..y1, z0..z1, f）を out に（ヘリの当たり判定が 1 フレームに 1 回集める）。
    // 要素は読み取り専用。スロープの上面は Nav3D.itemTop(item, x, z)。
    // 多角形の柱（k 2）は opts.prisms が true のときだけ（ヘリ・戦闘機・サーバーは箱の計算のまま。x0..z1 は外接矩形、y0..y1 は上下の範囲）
    itemsIn(x0, z0, x1, z1, out, opts) {
      out = out || [];
      const a = this._gather(x0, z0, x1, z1, this._bufs[4]);
      const all = !!(opts && opts.prisms);
      for (let i = 0; i < a.length; i++) if (a[i].k < 2 || (all && a[i].k === 2)) out.push(a[i]);
      return out;
    }
    static itemTop(b, x, z) { return b.k === 1 ? rampS(b, clamp(x, b.x0, b.x1), clamp(z, b.z0, b.z1)) : b.k === 2 ? prTop(b.pr, x, z) : b.y1; }
    // 要素の (x, z) での上面。足元の外なら null（箱・スロープは外接矩形、柱は多角形。柱は区画の索引で O(1) のことが多い）
    static topAt(b, x, z) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return null;
      if (b.k === 2) return prIn(b.pr, x, z) ? prTop(b.pr, x, z) : null;
      return b.k === 1 ? rampS(b, x, z) : b.y1;
    }
    // 柱の一番近い壁（clip でない辺）の上の点。out = { x, z, d, e（辺の番号）, nx, nz（外向き）, inside }（無ければ d = Infinity）。
    // 箱・スロープは外接矩形の縁。out を渡せば作らない
    static closestXZ(b, x, z, out) {
      out = out || { x: 0, z: 0, d: Infinity, e: -1, nx: 0, nz: 0, inside: false };
      if (b.k === 2) {
        const pr = b.pr;
        out.inside = prIn(pr, x, z);
        prClosest(pr, x, z, Infinity, true, out);
        if (out.e >= 0) { out.nx = pr.D[out.e * 8 + 5]; out.nz = pr.D[out.e * 8 + 6]; } else { out.nx = 0; out.nz = 0; }
        return out;
      }
      out.inside = x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
      if (!out.inside) {
        const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1), d = Math.hypot(x - cx, z - cz);
        out.x = cx; out.z = cz; out.d = d; out.e = -1;
        out.nx = d > 0 ? (x - cx) / d : 0; out.nz = d > 0 ? (z - cz) / d : 0;
        return out;
      }
      const a0 = x - b.x0, a1 = b.x1 - x, c0 = z - b.z0, c1 = b.z1 - z, m = Math.min(a0, a1, c0, c1);
      out.x = x; out.z = z; out.nx = 0; out.nz = 0; out.e = -1; out.d = m;
      if (m === a0) { out.x = b.x0; out.nx = -1; } else if (m === a1) { out.x = b.x1; out.nx = 1; } else if (m === c0) { out.z = b.z0; out.nz = -1; } else { out.z = b.z1; out.nz = 1; }
      return out;
    }
    static pointIn(b, x, z) { return b.k === 2 ? prIn(b.pr, x, z) : x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1; }

    // ---------- 押し出し（旧 API）----------
    resolveCircle(x, z, r, y, stepUp, height) { // stepUp / height: 押し出す高さの帯（既定 this.stepUp〜this.headroom。乗り物は車高）
      y = y || 0;
      const lo = y + (stepUp != null ? stepUp : this.stepUp), hi = y + (height != null ? height : this.headroom), R = r * 4 + 1;
      const cand = this._gather(x - R, z - R, x + R, z + R, this._bufs[0]);
      cand.sort((a, b) => a.seq - b.seq);
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        for (let n = 0; n < cand.length; n++) {
          const b = cand[n];
          if (b.k === 2) {
            if (!prContact(b.pr, x, z, r) || PC.top <= lo || PC.bot >= hi) continue;
            if (PC.x !== PC.x && !prPushIn(b.pr, x, z, r)) continue;
            x = PC.x; z = PC.z; moved = true;
            continue;
          }
          const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
          let top = b.y1, bot = b.y0;
          if (b.k === 1) { top = rampS(b, cx, cz); bot = top - b.t; }
          if (top <= lo || bot >= hi) continue;
          const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2), push = r - d;
            x += dx / d * push; z += dz / d * push;
          } else {
            const a0 = x - b.x0, a1 = b.x1 - x, c0 = z - b.z0, c1 = b.z1 - z, m = Math.min(a0, a1, c0, c1);
            if (m === a0) x = b.x0 - r; else if (m === a1) x = b.x1 + r; else if (m === c0) z = b.z0 - r; else z = b.z1 + r;
          }
          moved = true;
        }
        if (!moved) break;
      }
      x = clamp(x, this.minX + r + 0.05, this.maxX - r - 0.05);
      z = clamp(z, this.minZ + r + 0.05, this.maxZ - r - 0.05);
      return { x, z };
    }

    // ---------- 地面・天井・カプセル ----------
    _rampMax(b, x, z, r) { // 円の中でスロープが一番高い所
      let px = clamp(x, b.x0, b.x1), pz = clamp(z, b.z0, b.z1);
      if (b.ax === 0) px = clamp(px + b.dir * r, b.x0, b.x1); else pz = clamp(pz + b.dir * r, b.z0, b.z1);
      return rampS(b, px, pz);
    }
    _rampMin(b, x, z, r) {
      let px = clamp(x, b.x0, b.x1), pz = clamp(z, b.z0, b.z1);
      if (b.ax === 0) px = clamp(px - b.dir * r, b.x0, b.x1); else pz = clamp(pz - b.dir * r, b.z0, b.z1);
      return rampS(b, px, pz);
    }
    _prismMin(pr, x, z, r) { // 円の中で柱の下面が一番低い所
      const v = pr.ba + pr.bbx * x + pr.bcz * z - pr.bg * r;
      return v < pr.ymin ? pr.ymin : v > pr.ymax ? pr.ymax : v;
    }
    groundInfo(x, z, yFeet, r, buf) {
      r = (r || 0) + 1e-4; // 1 cm に丸めた箱どうしの継ぎ目（1e-14 m の隙間）を落ちないように
      const lim = yFeet + this.stepUp + 1e-6;
      let best = -Infinity, box = null;
      const cand = this._gather(x - r, z - r, x + r, z + r, buf || this._bufs[1]);
      for (let n = 0; n < cand.length; n++) {
        const b = cand[n];
        { const dx = x - clamp(x, b.x0, b.x1), dz = z - clamp(z, b.z0, b.z1); if (dx * dx + dz * dz > r * r) continue; }
        let s;
        if (b.k === 0) { if (!(b.f & WALK)) continue; s = b.y1; }
        else if (b.k === 1) s = this._rampMax(b, x, z, r);
        else {
          const pr = b.pr;
          if (!(b.f & WALK) || !prTouch(pr, x, z, r)) continue;
          s = pr.ta + pr.tbx * x + pr.tcz * z + pr.tg * r; // 円の中で一番高い所
          if (s > pr.ymax) s = pr.ymax; else if (s < pr.ymin) s = pr.ymin;
        }
        if (s <= lim && s > best) { best = s; box = b.src; }
      }
      const g = this.groundAt(x, z);
      if (g.water === null && g.y <= lim && g.y > best) { best = g.y; box = null; }
      return { y: best === -Infinity ? null : best, water: g.water, box };
    }
    groundHeight(x, z, yFeet, r) { return this.groundInfo(x, z, yFeet, r).y; }
    ceilingHeight(x, z, yHead, r) {
      r = r || 0;
      let best = Infinity;
      const cand = this._gather(x - r, z - r, x + r, z + r, this._bufs[1]);
      for (const b of cand) {
        if (r > 0) { const dx = x - clamp(x, b.x0, b.x1), dz = z - clamp(z, b.z0, b.z1); if (dx * dx + dz * dz > r * r) continue; }
        let bot;
        if (b.k === 2) { if (!prTouch(b.pr, x, z, r)) continue; bot = this._prismMin(b.pr, x, z, r); }
        else bot = b.k === 0 ? b.y0 : this._rampMin(b, x, z, r) - b.t;
        if (bot >= yHead - 1e-6 && bot < best) best = bot;
      }
      return best;
    }
    resolveCapsule(pos, r, h, stepUp, opts) {
      opts = opts || {};
      const su = stepUp != null ? stepUp : this.stepUp;
      const air = !!opts.air;
      let x = pos.x, y = pos.y, z = pos.z;
      const R = r + 2;
      const cand = this._gather(x - R, z - R, x + R, z + R, this._bufs[2]);
      let hitWall = false, hitCeiling = false;
      for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (let n = 0; n < cand.length; n++) {
          const b = cand[n];
          if (b.k === 2) { // 多角形の柱: 一番近い壁の法線の向きへ（段・空中の決まりは箱と同じ）
            if (!prContact(b.pr, x, z, r)) continue;
            const top = PC.top, bot = PC.bot;
            if (top <= y + su + 1e-6 && (!air || (b.f & WALK) || top <= y + 0.02)) continue;
            if (bot >= y + h - 1e-6 || bot > y + h * 0.5) continue;
            if (PC.x !== PC.x && !prPushIn(b.pr, x, z, r)) continue;
            x = PC.x; z = PC.z; moved = true; hitWall = true;
            continue;
          }
          const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
          const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let top = b.y1, bot = b.y0;
          if (b.k === 1) { top = rampS(b, cx, cz); bot = top - b.t; }
          if (top <= y + su + 1e-6 && (!air || b.k === 1 || (b.f & WALK) || top <= y + 0.02)) continue;
          if (bot >= y + h - 1e-6 || bot > y + h * 0.5) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2), push = r - d;
            x += dx / d * push; z += dz / d * push;
          } else {
            const a0 = x - b.x0, a1 = b.x1 - x, c0 = z - b.z0, c1 = b.z1 - z, m = Math.min(a0, a1, c0, c1);
            if (m === a0) x = b.x0 - r; else if (m === a1) x = b.x1 + r; else if (m === c0) z = b.z0 - r; else z = b.z1 + r;
          }
          moved = true; hitWall = true;
        }
        if (!moved) break;
      }
      x = clamp(x, this.minX + r + 0.05, this.maxX - r - 0.05);
      z = clamp(z, this.minZ + r + 0.05, this.maxZ - r - 0.05);
      const G = this.groundInfo(x, z, y, opts.groundR != null ? opts.groundR : r * 0.5, this._bufs[3]);
      let grounded = false;
      if (G.y !== null) {
        if (y <= G.y + 1e-6) { y = G.y; grounded = true; }
        else if (y - G.y <= (opts.snapDown != null ? opts.snapDown : 0.05)) { y = G.y; grounded = true; }
      }
      // 天井: 体の上半分にかかる下面
      const cand2 = this._gather(x - r, z - r, x + r, z + r, this._bufs[2]);
      let ceil = Infinity;
      for (const b of cand2) {
        const dx = x - clamp(x, b.x0, b.x1), dz = z - clamp(z, b.z0, b.z1);
        if (dx * dx + dz * dz >= r * r * 0.81) continue;
        let bot;
        if (b.k === 2) { if (!prTouch(b.pr, x, z, r * 0.9, true)) continue; bot = this._prismMin(b.pr, x, z, r); }
        else bot = b.k === 0 ? b.y0 : this._rampMin(b, x, z, r) - b.t;
        if (bot > y + h * 0.5 && bot < ceil) ceil = bot;
      }
      if (y + h > ceil) { y = ceil - h; hitCeiling = true; if (G.y !== null && y < G.y) y = G.y; }
      return { x, y, z, grounded, hitWall, hitCeiling, ground: G.y, water: G.water, box: G.box };
    }
    waterLevelAt(x, z) { return this.groundAt(x, z).water; }
    ladderAt(x, y, z, r) {
      r = r || 0.4;
      const i = this._ix(x), j = this._iz(z);
      let best = null, bd = Infinity;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const a = this.lhash.get(this._hk(i + di, j + dj));
        if (!a) continue;
        for (const l of a) {
          const dx = x - l.x, dz = z - l.z, d = Math.hypot(dx, dz);
          if (d > r + 0.35 || dx * l.nx + dz * l.nz < -0.1) continue;
          if (y < l.y0 - 0.3 || y > l.y1 + 0.2) continue;
          if (d < bd) { bd = d; best = l.src; }
        }
      }
      return best;
    }

    // ---------- レイ ----------
    static rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
      let tmin = -Infinity, tmax = Infinity;
      if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return null; }
      else { let t1 = (minX - ox) / dx, t2 = (maxX - ox) / dx; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
      if (Math.abs(dy) < 1e-9) { if (oy < minY || oy > maxY) return null; }
      else { let t1 = (minY - oy) / dy, t2 = (maxY - oy) / dy; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
      if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return null; }
      else { let t1 = (minZ - oz) / dz, t2 = (maxZ - oz) / dz; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return null; }
      if (tmax < 0) return null;
      return tmin >= 0 ? tmin : null;
    }
    // スロープ（凸多面体: 矩形 × 上面と下面の斜めの平面）とレイ。外から入る t と法線
    _rayRamp(b, ox, oy, oz, dx, dy, dz) {
      let t0 = -Infinity, t1 = Infinity, n0 = null;
      const planes = this._rampPlanes(b);
      for (const p of planes) { // n·x ≤ c
        const nd = p[0] * dx + p[1] * dy + p[2] * dz, no = p[0] * ox + p[1] * oy + p[2] * oz - p[3];
        if (Math.abs(nd) < 1e-12) { if (no > 0) return null; continue; }
        const t = -no / nd;
        if (nd < 0) { if (t > t0) { t0 = t; n0 = p; } } else if (t < t1) t1 = t;
        if (t0 > t1) return null;
      }
      if (t1 < 0 || t0 < 0 || !n0) return null;
      const L = Math.hypot(n0[0], n0[1], n0[2]);
      return { t: t0, nx: n0[0] / L, ny: n0[1] / L, nz: n0[2] / L };
    }
    _rampPlanes(b) {
      if (b.planes) return b.planes;
      // 上面: y ≤ a + k·u（u は軸の座標）
      const k = b.slope * b.dir, base = b.dir > 0 ? b.ry0 : b.ry1, o = b.ax === 0 ? b.x0 : b.z0;
      const top = b.ax === 0 ? [-k, 1, 0, base - k * o] : [0, 1, -k, base - k * o];
      const bot = b.ax === 0 ? [k, -1, 0, -(base - b.t - k * o)] : [0, -1, k, -(base - b.t - k * o)];
      b.planes = [[1, 0, 0, b.x1], [-1, 0, 0, -b.x0], [0, 0, 1, b.z1], [0, 0, -1, -b.z0], top, bot];
      return b.planes;
    }
    // 3D レイ（箱 + スロープ + 地形）。opts: { all: NOLOS も当てる, water: 水面で止める }
    raycast(ox, oy, oz, dx, dy, dz, maxDist, opts) {
      const all = opts && opts.all;
      const cs = this.hcell;
      let ix = this._ix(ox), iz = this._iz(oz);
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const ax = Math.abs(dx) > 1e-12, az = Math.abs(dz) > 1e-12;
      let tmx = ax ? ((this.minX + (ix + (dx > 0 ? 1 : 0)) * cs) - ox) / dx : Infinity;
      let tmz = az ? ((this.minZ + (iz + (dz > 0 ? 1 : 0)) * cs) - oz) / dz : Infinity;
      const tdx = ax ? cs / Math.abs(dx) : Infinity, tdz = az ? cs / Math.abs(dz) : Infinity;
      let bestT = maxDist, best = null, t = 0;
      const st = ++this._stamp;
      const ixMin = this._ix(this.minX) - 2, ixMax = this._ix(this.maxX) + 2, izMin = this._iz(this.minZ) - 2, izMax = this._iz(this.maxZ) + 2;
      for (let guard = 0; guard < 100000; guard++) {
        const a = this.hash.get(this._hk(ix, iz));
        if (a) for (let k = 0; k < a.length; k++) {
          const b = this.items[a[k]];
          if (!b || b.stamp === st) continue;
          b.stamp = st;
          if ((b.f & NOLOS) && !all) continue;
          if (b.k === 0) {
            const th = Nav3D.rayBox(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
            if (th === null || th > bestT || (best && th >= bestT)) continue;
            const hx = ox + dx * th, hy = oy + dy * th, hz = oz + dz * th, e = 1e-3;
            let nx = 0, ny = 0, nz = 0;
            if (Math.abs(hx - b.x0) < e) nx = -1; else if (Math.abs(hx - b.x1) < e) nx = 1;
            else if (Math.abs(hz - b.z0) < e) nz = -1; else if (Math.abs(hz - b.z1) < e) nz = 1;
            else if (Math.abs(hy - b.y1) < e) ny = 1; else ny = -1;
            bestT = th; best = { t: th, dist: th, x: hx, y: hy, z: hz, nx, ny, nz, box: b.src };
          } else if (b.k === 2) {
            const th = rayPrism(b.pr, ox, oy, oz, dx, dy, dz, bestT);
            if (th < 0 || th > bestT || (best && th >= bestT)) continue;
            bestT = th; best = { t: th, dist: th, x: ox + dx * th, y: oy + dy * th, z: oz + dz * th, nx: RH.nx, ny: RH.ny, nz: RH.nz, box: b.src };
          } else {
            const h = this._rayRamp(b, ox, oy, oz, dx, dy, dz);
            if (!h || h.t > bestT || (best && h.t >= bestT)) continue;
            bestT = h.t; best = { t: h.t, dist: h.t, x: ox + dx * h.t, y: oy + dy * h.t, z: oz + dz * h.t, nx: h.nx, ny: h.ny, nz: h.nz, box: b.src };
          }
        }
        if (tmx < tmz) { t = tmx; tmx += tdx; ix += sx; } else { t = tmz; tmz += tdz; iz += sz; }
        if (t > bestT || t === Infinity) break;
        if (ix < ixMin || ix > ixMax || iz < izMin || iz > izMax) break;
      }
      const tg = this._terrain(ox, oy, oz, dx, dy, dz, bestT, opts && opts.water);
      if (tg && (!best || tg.t < best.t)) best = tg;
      return best;
    }
    // 地形（陸 y = 0、穴・湖・川の底、護岸の壁）
    _terrain(ox, oy, oz, dx, dy, dz, tmax, water) {
      if (dy >= 0 && oy >= 0) return null;
      const flat = this.groundAt === Nav3D.prototype._flat;
      if (oy >= 0 && dy < 0) {
        const t0 = -oy / dy;
        if (t0 > tmax) return null;
        const x = ox + dx * t0, z = oz + dz * t0, g = this.groundAt(x, z);
        if (g.water === null && g.y >= -1e-6) return { t: t0, dist: t0, x, y: 0, z, nx: 0, ny: 1, nz: 0, box: null, ground: true };
        if (water && g.water !== null) {
          const tw = (g.water - oy) / dy;
          if (tw <= tmax) return { t: tw, dist: tw, x: ox + dx * tw, y: g.water, z: oz + dz * tw, nx: 0, ny: 1, nz: 0, box: null, water: true };
        }
      }
      if (flat) return null;
      // 水・穴の上: 1 m ごとに地形の下に入ったか調べる
      let t = Math.max(0, oy >= 0 ? -oy / dy : 0), prev = null;
      const step = 1 / Math.max(1e-6, Math.hypot(dx, dy, dz));
      for (let k = 0; k < 4000 && t <= tmax; k++, t += step) {
        const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
        if (y < -40) break;
        const g = this.groundAt(x, z);
        if (y <= g.y) {
          let nx = 0, ny = 1, nz = 0;
          if (prev !== null && g.y > prev + 0.5) { const L = Math.hypot(dx, dz) || 1; nx = -dx / L; nz = -dz / L; ny = 0; }
          return { t, dist: t, x, y, z, nx, ny, nz, box: null, ground: true };
        }
        prev = g.y;
      }
      return null;
    }
    _flat() { return FLAT; }
    lineOfSight(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return true;
      return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len) === null;
    }

    // ---------- 歩行グラフ ----------
    // チャンク (cx, cz) のグラフ（読み込まれていなければ null。必要なら作る）
    _graph(cx, cz) {
      const k = cz * 4096 + cx;
      const g = this.gmap.get(k);
      if (g !== undefined) return g;
      const ch = this.chunks.get(cx + '_' + cz);
      if (!ch) { this.gmap.set(k, null); return null; }
      return this._buildGraph(ch);
    }
    // 全体の柱 (gcol, grow) のグラフを返し、節点の範囲を this._a..this._b に入れる
    _colG(gcol, grow, noBuild) {
      if (gcol < 0 || grow < 0 || gcol >= this.cols || grow >= this.rows) return null;
      const n = this.gn, cx = (gcol / n) | 0, cz = (grow / n) | 0;
      let g = this.gmap.get(cz * 4096 + cx);
      if (g === undefined) { if (noBuild || this._noBuild) return null; g = this._graph(cx, cz); }
      if (!g) return null;
      const i = (grow - cz * n) * n + (gcol - cx * n);
      this._a = g.colStart[i]; this._b = g.colStart[i + 1];
      return g;
    }
    _buildGraph(ch) {
      const job = this._graphGen(ch);
      let r = job.next();
      while (!r.done) r = job.next();
      return r.value;
    }
    // 歩行グラフを少しずつ作る（8 m 四方の区画ごとに yield）。AI が 1 フレームの予算の中で進める（buildGraphStep）
    *_graphGen(ch) {
      const gc = this.gcell, n = this.gn, x0 = this.minX + ch.cx * this.chunkSize, z0 = this.minZ + ch.cz * this.chunkSize;
      const inf = this.inflate, su = this.stepUp, hr = this.headroom;
      const per = Math.max(1, Math.round(this.hcell / gc));
      const L = [], Lrow = [], Lc = [];
      // 柱ごとの節点（最大 64）を一時配列に集め、柱の順に詰める
      const cy = new Float64Array(64), cr = new Int32Array(64), cs = new Float64Array(64);
      // 柱（k 2）の柱ごとの答え（1 m の柱ごとに 1 回）: PS 0 遠い / 1 inf 以内（外）/ 2 中、PT / PB その点の上面・下面
      let PT = new Float64Array(64), PB = new Float64Array(64), PS = new Uint8Array(64);
      const cap0 = n * n * 2;
      let cap = cap0, k = 0;
      let Y = new Float32Array(cap), RA = new Int32Array(cap), SL = new Float32Array(cap), CO = new Int32Array(cap);
      const nodeCol = new Int32Array(n * n).fill(-1), cnt = new Uint8Array(n * n);
      const order = [];
      const nb = Math.ceil(n / per);
      const inval0 = ch.inval || 0;
      for (let hj = 0; hj < nb; hj++) {
        for (let hi = 0; hi < nb; hi++) {
        if (hj > 0 || hi > 0) {
          yield hj * nb + hi; // 8 m 四方の区画ごと（1 区画 0.05〜0.5 ms）
          // 途中でこのチャンクが外された / 自分や隣が変わった（箱が変わる）: やめる / 最初から
          if (this.chunks.get(ch.key) !== ch) return null;
          if (ch.graph) return ch.graph;
          if ((ch.inval || 0) !== inval0) return yield* this._graphGen(ch);
        }
        const bx0 = x0 + hi * per * gc, bz0 = z0 + hj * per * gc;
        this._gather(bx0 - inf - 0.01, bz0 - inf - 0.01, bx0 + per * gc + inf + 0.01, bz0 + per * gc + inf + 0.01, L);
        for (let rj = 0; rj < per; rj++) {
          const r = hj * per + rj;
          if (r >= n) break;
          const pz = z0 + (r + 0.5) * gc;
          Lrow.length = 0;
          for (let q = 0; q < L.length; q++) { const b = L[q]; if (pz >= b.z0 - inf && pz <= b.z1 + inf) Lrow.push(b); }
          for (let ci = 0; ci < per; ci++) {
            const c = hi * per + ci;
            if (c >= n) break;
            const px = x0 + (c + 0.5) * gc;
            Lc.length = 0;
            for (let q = 0; q < Lrow.length; q++) { const b = Lrow[q]; if (px >= b.x0 - inf && px <= b.x1 + inf) Lc.push(b); }
            if (Lc.length > PS.length) { PT = new Float64Array(Lc.length * 2); PB = new Float64Array(Lc.length * 2); PS = new Uint8Array(Lc.length * 2); }
            for (let q = 0; q < Lc.length; q++) {
              const b = Lc[q];
              if (b.k !== 2) continue;
              const pr = b.pr;
              if (prIn(pr, px, pz)) { PS[q] = 2; PT[q] = prTop(pr, px, pz); PB[q] = prBot(pr, px, pz); }
              else if (prClosest(pr, px, pz, inf, false, CS) <= inf) { PS[q] = 1; PT[q] = prTop(pr, CS.x, CS.z); PB[q] = prBot(pr, CS.x, CS.z); }
              else PS[q] = 0;
            }
            let nc = 0;
            const g = this.groundAt(px, pz);
            if (g.water === null) { cy[0] = g.y; cr[0] = -1; cs[0] = 0; nc = 1; }
            for (let q = 0; q < Lc.length && nc < 64; q++) {
              const b = Lc[q];
              if (px < b.x0 || px > b.x1 || pz < b.z0 || pz > b.z1) continue;
              if (b.k === 0) { if (b.f & WALK) { cy[nc] = b.y1; cr[nc] = -1; cs[nc] = 0; nc++; } }
              else if (b.k === 1) { cy[nc] = rampS(b, px, pz); cr[nc] = b.seq; cs[nc] = b.slope; nc++; }
              else if ((b.f & WALK) && PS[q] === 2) { const pr = b.pr; cy[nc] = PT[q]; cr[nc] = pr.planar ? b.seq : -1; cs[nc] = pr.planar ? pr.tg : 0; nc++; }
            }
            const start = k;
            for (let q = 0; q < nc; q++) {
              const y = cy[q], rs = cr[q];
              let ok = true;
              for (let w = 0; w < Lc.length; w++) {
                const b = Lc[w];
                if (b.k === 2) { // 柱: 足元の多角形から inf 以内なら、そこ（中なら柱の真ん中）での上面・下面で見る
                  const st = PS[w];
                  if (!st || (b.pr.planar && b.seq === rs)) continue;
                  const top = PT[w], bot = PB[w];
                  if (top > y + su && bot < y + hr) { ok = false; break; }
                  if (st === 2 && bot < y + 0.05 && top > y + 0.05) { ok = false; break; }
                  continue;
                }
                let top = b.y1, bot = b.y0;
                if (b.k === 1) { if (b.seq === rs) continue; top = rampS(b, clamp(px, b.x0, b.x1), clamp(pz, b.z0, b.z1)); bot = top - b.t; }
                if (top > y + su && bot < y + hr) { ok = false; break; }
                if (bot < y + 0.05 && top > y + 0.05 && px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1) { ok = false; break; }
              }
              if (!ok) continue;
              let dup = false;
              for (let o = start; o < k; o++) if (Math.abs(Y[o] - y) < 0.03) { dup = true; if (rs >= 0) { RA[o] = rs; SL[o] = cs[q]; } }
              if (dup) continue;
              if (k >= cap) {
                cap *= 2;
                const y2 = new Float32Array(cap); y2.set(Y); Y = y2;
                const r2 = new Int32Array(cap); r2.set(RA); RA = r2;
                const s2 = new Float32Array(cap); s2.set(SL); SL = s2;
                const c2 = new Int32Array(cap); c2.set(CO); CO = c2;
              }
              // 高さ順に挿入
              let o = k;
              while (o > start && Y[o - 1] > y) { Y[o] = Y[o - 1]; RA[o] = RA[o - 1]; SL[o] = SL[o - 1]; o--; }
              Y[o] = y; RA[o] = rs; SL[o] = cs[q];
              k++;
            }
            if (k > start) { nodeCol[r * n + c] = start; cnt[r * n + c] = k - start; order.push(r * n + c); }
          }
        }
        }
      }
      // 柱の順（行優先）に並べ直す
      const N = k;
      if (N >= SLOT) throw new Error('Nav3D: too many walk nodes in chunk ' + ch.key);
      const colStart = new Int32Array(n * n + 1);
      const y = new Float32Array(N), ramp = new Int32Array(N), slope = new Float32Array(N), colOf = new Int32Array(N);
      let w = 0;
      for (let i = 0; i < n * n; i++) {
        colStart[i] = w;
        const s0 = nodeCol[i];
        if (s0 < 0) continue;
        for (let q = 0; q < cnt[i]; q++) { y[w] = Y[s0 + q]; ramp[w] = RA[s0 + q]; slope[w] = SL[s0 + q]; colOf[w] = i; w++; }
      }
      colStart[n * n] = w;
      const slot = this.gfree.length ? this.gfree.pop() : this.gslots.length;
      const gr = { slot, key: ch.key, cx: ch.cx, cz: ch.cz, n, x0, z0, colStart, colOf, y, ramp, slope,
        g: new Float32Array(N), f: new Float32Array(N), par: new Int32Array(N), seen: new Uint32Array(N), closed: new Uint32Array(N) };
      this.gslots[slot] = gr;
      this.gmap.set(ch.cz * 4096 + ch.cx, gr);
      ch.graph = gr;
      this._built = (this._built || 0) + 1;
      this._ladDirty = true;
      return gr;
    }
    _edgeOK(ya, ra, sa, yb, rb, sb, dist) {
      const dy = ya > yb ? ya - yb : yb - ya;
      let lim = this.stepUp;
      if (ra >= 0 || rb >= 0) lim += (sa > sb ? sa : sb) * dist * this.gcell * 1.05;
      return dy <= lim + 1e-4;
    }
    // (x, z) の柱で高さ y に一番近い節点 → 全体 id（tol 以内）。無ければ -1
    _nodeAt(x, z, y, tol, noBuild) {
      const gcol = Math.floor((x - this.minX) / this.gcell), grow = Math.floor((z - this.minZ) / this.gcell);
      const g = this._colG(gcol, grow, noBuild);
      if (!g) return -1;
      let best = -1, bd = tol == null ? Infinity : tol;
      for (let i = this._a; i < this._b; i++) { const d = Math.abs(g.y[i] - y); if (d <= bd) { bd = d; best = g.slot * SLOT + i; } }
      return best;
    }
    _nodePos(id) {
      const g = this.gslots[Math.floor(id / SLOT)], i = id % SLOT, col = g.colOf[i];
      const c = col % g.n, r = (col / g.n) | 0;
      return { x: g.x0 + (c + 0.5) * this.gcell, y: g.y[i], z: g.z0 + (r + 0.5) * this.gcell, gc: g.cx * g.n + c, gr: g.cz * g.n + r };
    }
    _dynBlocked(gcol, grow, y) {
      if (!this._dyn) return false;
      const t = this._dyn.get(gcol * 100000 + grow);
      return t !== undefined && y < t;
    }
    // 梯子の辺（下の節点 ↔ 上の節点）。グラフがあるチャンクの分だけ
    _ensureLadders() {
      if (!this._ladDirty) return;
      this._ladDirty = false;
      this._ladEdges = new Map();
      const add = (a, b, c) => { let l = this._ladEdges.get(a); if (!l) { l = []; this._ladEdges.set(a, l); } l.push([b, c]); };
      for (const ch of this.chunks.values()) for (const l of ch.ladders) {
        let lo = -1, hi = -1;
        for (const d of [0.6, 1.1, 1.6]) { lo = this._nodeAt(l.x + l.nx * d, l.z + l.nz * d, l.y0, 1.0, true); if (lo >= 0) break; }
        if (lo < 0) continue;
        for (const d of [0.6, 1.1, 1.6, 2.1]) { hi = this._nodeAt(l.x - l.nx * d, l.z - l.nz * d, l.y1, 1.3, true); if (hi >= 0) break; }
        if (hi < 0 || lo === hi) continue;
        const cost = (Math.abs(l.y1 - l.y0) + 2) / this.gcell + 2;
        add(lo, hi, cost); add(hi, lo, cost);
      }
    }
    setDynamicBoxes(boxes) {
      const inf = 0.6;
      if (!boxes || !boxes.length) { this._dyn = null; return; }
      const m = new Map();
      for (const b of boxes) {
        if (!b) continue;
        const c0 = this.toCell(b.x - b.w / 2 - inf, b.z - b.d / 2 - inf), c1 = this.toCell(b.x + b.w / 2 + inf, b.z + b.d / 2 + inf);
        const top = (b.y || 0) + (b.h || 3);
        for (let r = c0.r; r <= c1.r; r++) for (let c = c0.c; c <= c1.c; c++) { const k = c * 100000 + r; m.set(k, Math.max(m.get(k) || -Infinity, top)); }
      }
      this._dyn = m;
    }
    toCell(x, z) {
      const c = Math.floor((x - this.minX) / this.gcell), r = Math.floor((z - this.minZ) / this.gcell);
      return { c: clamp(c, 0, this.cols - 1), r: clamp(r, 0, this.rows - 1) };
    }
    cellCenter(c, r) { return { x: this.minX + (c + 0.5) * this.gcell, z: this.minZ + (r + 0.5) * this.gcell }; }
    _colHas(c, r, y) { // 高さ y（± stepUp）に節点がある柱か
      const g = this._colG(c, r);
      if (!g) return false;
      for (let i = this._a; i < this._b; i++) if (Math.abs(g.y[i] - y) <= this.stepUp && !this._dynBlocked(c, r, g.y[i])) return true;
      return false;
    }
    isBlockedAt(x, z, y) { const q = this.toCell(x, z); return !this._colHas(q.c, q.r, y || 0); }
    nearestFree(x, z, maxRadius, y) {
      y = y || 0;
      const q = this.toCell(x, z), R = maxRadius || 6;
      if (this._colHas(q.c, q.r, y)) return { x, z, y };
      for (let rad = 1; rad <= R; rad++) {
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const rr = q.r + dr, cc = q.c + dc;
          if (rr < 0 || cc < 0 || rr >= this.rows || cc >= this.cols) continue;
          if (this._colHas(cc, rr, y)) { const p = this.cellCenter(cc, rr); p.y = y; return p; }
        }
      }
      return { x, z, y };
    }
    // 柱 (c, r) で (ya, ra, sa) の節点とつながる節点（高さが一番近いもの）→ 局所 index、無ければ -1
    _pick(g, c, r, ya, ra, sa, dist) {
      let best = -1, bd = Infinity;
      for (let i = this._a; i < this._b; i++) {
        const yb = g.y[i];
        if (!this._edgeOK(ya, ra, sa, yb, g.ramp[i], g.slope[i], dist)) continue;
        if (this._dyn && this._dynBlocked(c, r, yb)) continue;
        const d = yb > ya ? yb - ya : ya - yb;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    // A*（8 方向、角抜け禁止、旧 Nav と同じ順序。weight > 1 は重み付き A*）。start が -2 なら柱 (sc, sr) の高さ sy の仮の節点
    _astar(startId, sc, sr, sy, goalId, maxExpand, noLad, weight) {
      const it = this._astarGen(startId, sc, sr, sy, goalId, maxExpand, noLad, weight, 0);
      let r = it.next();
      while (!r.done) r = it.next();
      return r.value;
    }
    // A* の本体（slice > 0 なら slice 回展開するごとに yield。再開したとき別の探索が割り込んでいたら 'restart' を返す）
    *_astarGen(startId, sc, sr, sy, goalId, maxExpand, noLad, weight, slice) {
      const S = ++this._search, slots = this.gslots, W = weight || 1, gcell = this.gcell;
      let vg = Infinity, vf = Infinity, vclosed = false;
      const fOf = (id) => { if (id === -2) return vf; const g = slots[Math.floor(id / SLOT)], i = id % SLOT; return g.seen[i] === S ? g.f[i] : Infinity; };
      const goal = this._nodePos(goalId);
      const ggc = goal.gc, ggr = goal.gr, gy = goal.y;
      const hOf = (c, r, y) => { const dc = Math.abs(c - ggc), dr = Math.abs(r - ggr); return (Math.max(dc, dr) + 0.4142 * Math.min(dc, dr) + Math.abs(y - gy) / gcell * 0.25) * W; };
      const heap = new Heap(fOf);
      const sp = startId === -2 ? { gc: sc, gr: sr, y: sy } : this._nodePos(startId);
      if (startId === -2) { vg = 0; vf = hOf(sp.gc, sp.gr, sp.y); }
      else { const g = slots[Math.floor(startId / SLOT)], i = startId % SLOT; g.seen[i] = S; g.g[i] = 0; g.f[i] = hOf(sp.gc, sp.gr, sp.y); g.par[i] = -1; }
      heap.push(startId);
      const DC = [1, -1, 0, 0, 1, 1, -1, -1], DR = [0, 0, 1, -1, 1, -1, 1, -1], DK = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];
      let expanded = 0;
      while (heap.size > 0 && expanded < maxExpand) {
        if (slice && expanded > 0 && expanded % slice === 0) {
          this.lastExpanded = expanded;
          yield expanded;
          if (this._search !== S) return 'restart'; // 止まっている間に別の探索が節点の印を書き換えた
        }
        const cur = heap.pop();
        if (cur === goalId) break;
        let cg, ci, ccol, cgc, cgr, ya, ra, sa, gcur;
        if (cur === -2) {
          if (vclosed) continue;
          vclosed = true; cgc = sc; cgr = sr; ya = sy; ra = -1; sa = 0; gcur = vg;
        } else {
          cg = slots[Math.floor(cur / SLOT)]; ci = cur % SLOT;
          if (cg.closed[ci] === S) continue;
          cg.closed[ci] = S;
          ccol = cg.colOf[ci];
          cgc = cg.cx * cg.n + (ccol % cg.n); cgr = cg.cz * cg.n + ((ccol / cg.n) | 0);
          ya = cg.y[ci]; ra = cg.ramp[ci]; sa = cg.slope[ci]; gcur = cg.g[ci];
        }
        expanded++;
        for (let d = 0; d < 8; d++) {
          const nc = cgc + DC[d], nr = cgr + DR[d];
          const g = this._colG(nc, nr);
          if (!g) continue;
          const li = this._pick(g, nc, nr, ya, ra, sa, DK[d]);
          if (li < 0) continue;
          if (g.closed[li] === S) continue;
          if (d >= 4) {
            const g1 = this._colG(nc, cgr);
            if (!g1 || this._pick(g1, nc, cgr, ya, ra, sa, 1) < 0) continue;
            const g2 = this._colG(cgc, nr);
            if (!g2 || this._pick(g2, cgc, nr, ya, ra, sa, 1) < 0) continue;
          }
          const yb = g.y[li];
          const ng = gcur + DK[d] + Math.abs(yb - ya) / gcell * 0.25;
          if (!(g.seen[li] === S && g.g[li] <= ng)) {
            g.seen[li] = S; g.g[li] = ng; g.f[li] = ng + hOf(nc, nr, yb); g.par[li] = cur;
            heap.push(g.slot * SLOT + li);
          }
        }
        if (!noLad && cur !== -2) {
          const le = this._ladEdges.get(cur);
          if (le) for (const e of le) {
            const ni = e[0], g = slots[Math.floor(ni / SLOT)], li = ni % SLOT;
            if (!g || g.closed[li] === S) continue;
            const ng = gcur + e[1];
            if (!(g.seen[li] === S && g.g[li] <= ng)) {
              const np = this._nodePos(ni);
              g.seen[li] = S; g.g[li] = ng; g.f[li] = ng + hOf(np.gc, np.gr, np.y); g.par[li] = cur;
              heap.push(ni);
            }
          }
        }
      }
      this.lastExpanded = expanded;
      if (goalId === startId) return [goalId];
      const gg = slots[Math.floor(goalId / SLOT)], gi = goalId % SLOT;
      if (gg.seen[gi] !== S) return null;
      const ids = [];
      for (let id = goalId; ;) {
        ids.push(id);
        if (id === startId || id === -2) break;
        const g = slots[Math.floor(id / SLOT)];
        id = g.par[id % SLOT];
        if (id === -1) break;
      }
      ids.reverse();
      return ids;
    }
    // 線分 a→b を同じ面の上で歩けるか（0.5 セルごと）
    _walkable3(a, b) {
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.sqrt(dx * dx + dz * dz);
      const steps = Math.ceil(len / (this.gcell * 0.5));
      let py = a.y;
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 0, x = a.x + dx * t, z = a.z + dz * t, y = a.y + (b.y - a.y) * t;
        const q = this.toCell(x, z), g = this._colG(q.c, q.r);
        if (!g) return false;
        let ok = false, ny = 0;
        for (let k = this._a; k < this._b; k++) {
          const yy = g.y[k];
          if (Math.abs(yy - y) <= this.stepUp + (g.ramp[k] >= 0 ? 0.4 : 0) && Math.abs(yy - py) <= this.stepUp + 0.45 && !this._dynBlocked(q.c, q.r, yy)) { ok = true; ny = yy; break; }
        }
        if (!ok) return false;
        py = ny;
      }
      return true;
    }
    _pull(pts) {
      const out = [];
      let anchor = 0;
      while (anchor < pts.length - 1) {
        let next = anchor + 1;
        if (!pts[anchor].lad) {
          let lim = pts.length - 1;
          for (let q = anchor; q < pts.length - 1; q++) if (pts[q].lad) { lim = q; break; }
          for (let j = lim; j > anchor + 1; j--) if (this._walkable3(pts[anchor], pts[j])) { next = j; break; }
        }
        out.push(pts[next]);
        anchor = next;
      }
      return out;
    }
    // 探索中に新しいチャンクのグラフができたら（梯子の辺が増えるので）もう一度
    _run(fn) {
      let res = null;
      for (let k = 0; k < 3; k++) {
        this._ensureLadders();
        const before = this._built || 0;
        res = fn();
        if ((this._built || 0) === before) break;
      }
      return res;
    }
    _ptsOf(ids, sc, sy) {
      const pts = [];
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k];
        if (id === -2) { const c = this.cellCenter(sc.c, sc.r); pts.push({ x: c.x, y: sy, z: c.z, lad: false }); continue; }
        const p = this._nodePos(id), nxt = ids[k + 1];
        let lad = false;
        if (nxt != null && nxt !== -2) { const le = this._ladEdges.get(id); if (le && le.some((e) => e[0] === nxt) && Math.abs(this._nodePos(nxt).y - p.y) > this.stepUp + 0.5) lad = true; }
        pts.push({ x: p.x, y: p.y, z: p.z, lad });
      }
      return pts;
    }
    // 旧 API: 地面（y 既定 0）の経路。届かなければ []
    findPath(sx, sz, tx, tz, sy, ty) {
      sy = sy || 0; ty = ty == null ? sy : ty;
      const s = this.toCell(sx, sz);
      let goalId = this._nodeAt(tx, tz, ty, this.stepUp);
      if (goalId < 0 || this._blockedNode(goalId)) {
        const nf = this.nearestFree(tx, tz, 4, ty);
        goalId = this._nodeAt(nf.x, nf.z, ty, this.stepUp);
        if (goalId < 0) return [];
      }
      let startId = this._nodeAt(sx, sz, sy, this.stepUp);
      if (startId >= 0 && this._blockedNode(startId)) startId = -1;
      if (startId === goalId) return [{ x: tx, z: tz, y: ty }];
      const ids = this._run(() => this._astar(startId >= 0 ? startId : -2, s.c, s.r, sy, goalId, this.maxExpand, false, 1));
      if (!ids) return [];
      const pts = this._ptsOf(ids, s, sy);
      pts[pts.length - 1] = { x: tx, z: tz, y: pts[pts.length - 1].y, lad: false };
      return this._pull(pts).map((p) => ({ x: p.x, z: p.z, y: p.y }));
    }
    _blockedNode(id) { const p = this._nodePos(id); return this._dynBlocked(p.gc, p.gr, p.y); }
    // 3D の経路（重み付き A*、既定 weight 1.6）。届かなければ null
    //   opts: { noLadders, weight, noBuild（まだ作っていないチャンクの歩行グラフは作らず、通れないものとして扱う。AI が 1 フレームの
    //   予算を守るため。グラフは buildGraphStep で前もって少しずつ作る）, lad（true なら点に lad: 梯子を登り始める点 を残す）,
    //   raw（true なら引き伸ばさず 1 m 格子の節点を全部返す。半径の大きい体で角に引っかからずにたどるとき）}
    findPath3d(from, to, maxExpand, opts) {
      opts = opts || {};
      const prevNB = this._noBuild;
      if (opts.noBuild) this._noBuild = true;
      try {
        this.lastFail = null;
        const s = this._nodeAt(from.x, from.z, from.y, 1.0);
        const goal = this._nodeAt(to.x, to.z, to.y, 1.0);
        if (goal < 0) { this.lastFail = 'goal'; return null; }
        const sc = this.toCell(from.x, from.z);
        if (s >= 0 && s === goal) return [{ x: to.x, y: to.y, z: to.z }];
        const cap = maxExpand || this.maxExpand;
        const ids = this._run(() => this._astar(s >= 0 ? s : -2, sc.c, sc.r, from.y, goal, cap, !!opts.noLadders, opts.weight || 1.6));
        if (!ids) { this.lastFail = this.lastExpanded >= cap ? 'cap' : 'none'; return null; } // lastFail: goal（終点が歩けない）/ cap（展開数の上限）/ none（つながっていない）
        const pts = this._ptsOf(ids, sc, from.y);
        pts[0] = { x: from.x, y: pts[0].y, z: from.z, lad: pts[0].lad };
        pts[pts.length - 1] = { x: to.x, y: pts[pts.length - 1].y, z: to.z, lad: false };
        return (opts.raw ? pts : this._pull(pts)).map((p) => (opts.lad ? { x: p.x, y: p.y, z: p.z, lad: !!p.lad } : { x: p.x, y: p.y, z: p.z }));
      } finally { this._noBuild = prevNB; }
    }

    // 少しずつ進める経路探索（AI 用。作っていない歩行グラフは通れない扱い = noBuild）。
    //   const job = nav.pathJob(from, to, maxExpand, { raw, lad, noLadders, weight })
    //   job.step(budgetMs) → null（まだ）| { path }（[{x,y,z(,lad)}]）| { fail: 'goal' | 'cap' | 'none' }
    //   止まっている間に別の探索（findPath3d など）が走ったら最初からやり直す（節点の印を共有しているので）
    pathJob(from, to, maxExpand, opts) {
      opts = opts || {};
      const self = this;
      const cap = maxExpand || this.maxExpand;
      const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
      let it = null, sc = null, s = -1, goal = -1, result = null, restarts = 0;
      const start = () => {
        self._ensureLadders();
        s = self._nodeAt(from.x, from.z, from.y, 1.0, true);
        goal = self._nodeAt(to.x, to.z, to.y, 1.0, true);
        sc = self.toCell(from.x, from.z);
        if (goal < 0) { result = { fail: 'goal' }; return; }
        if (s >= 0 && s === goal) { result = { path: [{ x: to.x, y: to.y, z: to.z }] }; return; }
        it = self._astarGen(s >= 0 ? s : -2, sc.c, sc.r, from.y, goal, cap, !!opts.noLadders, opts.weight || 1.6, opts.slice || 100);
      };
      const finish = (ids) => {
        if (!ids) { result = { fail: self.lastExpanded >= cap ? 'cap' : 'none' }; return; }
        const pts = self._ptsOf(ids, sc, from.y);
        pts[0] = { x: from.x, y: pts[0].y, z: from.z, lad: pts[0].lad };
        pts[pts.length - 1] = { x: to.x, y: pts[pts.length - 1].y, z: to.z, lad: false };
        result = { path: (opts.raw ? pts : self._pull(pts)).map((p) => (opts.lad ? { x: p.x, y: p.y, z: p.z, lad: !!p.lad } : { x: p.x, y: p.y, z: p.z })) };
      };
      return {
        get expanded() { return self.lastExpanded || 0; },
        get restarts() { return restarts; },
        step(budgetMs) {
          if (result) return result;
          const prevNB = self._noBuild;
          self._noBuild = true;
          try {
            if (!it) { start(); if (result) return result; }
            const t0 = now();
            for (;;) {
              const r = it.next();
              if (r.done) {
                if (r.value === 'restart') { restarts++; it = null; if (restarts > 3) { result = { fail: 'none' }; return result; } start(); if (result) return result; continue; }
                finish(r.value);
                return result;
              }
              if (now() - t0 >= (budgetMs || 0)) return null;
            }
          } finally { self._noBuild = prevNB; }
        }
      };
    }

    // チャンク (cx, cz) の歩行グラフを budgetMs まで作り進める（_graphGen を 8 m 四方ずつ）。出来た（またはチャンクが無い）なら true
    buildGraphStep(cx, cz, budgetMs) {
      const k = cz * 4096 + cx;
      if (this.gmap.get(k)) return true;
      const ch = this.chunks.get(cx + '_' + cz);
      if (!ch) return true;
      const jobs = this._jobs || (this._jobs = new Map());
      let job = jobs.get(ch.key);
      if (!job || job.ch !== ch) { job = { ch, it: this._graphGen(ch) }; jobs.set(ch.key, job); }
      const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
      const t0 = now();
      for (;;) {
        const r = job.it.next();
        if (r.done) { jobs.delete(ch.key); return true; }
        if (now() - t0 >= (budgetMs || 0)) return false;
      }
    }
    graphReady(cx, cz) { return !!this.gmap.get(cz * 4096 + cx) || !this.chunks.has(cx + '_' + cz); }

    // (x, z) の高さ y（± 0.6）に歩行グラフの節点があり、周りの 8 マスのうち minN 以上とつながっているか（AI の出現場所の確認）。
    // そのチャンクのグラフがまだ無ければ null（ここでは作らない）
    walkableAt(x, z, y, minN) {
      const q = this.toCell(x, z);
      const g = this._colG(q.c, q.r, true);
      if (!g) return null;
      let id = -1, bd = 0.6;
      for (let i = this._a; i < this._b; i++) { const d = Math.abs(g.y[i] - y); if (d <= bd) { bd = d; id = i; } }
      if (id < 0) return false;
      const ya = g.y[id], ra = g.ramp[id], sa = g.slope[id];
      const DC = [1, -1, 0, 0, 1, 1, -1, -1], DR = [0, 0, 1, -1, 1, -1, 1, -1];
      let n = 0;
      for (let d = 0; d < 8; d++) {
        const gn = this._colG(q.c + DC[d], q.r + DR[d], true);
        if (gn && this._pick(gn, q.c + DC[d], q.r + DR[d], ya, ra, sa, d < 4 ? 1 : 1.4142) >= 0) n++;
      }
      return n >= (minN == null ? 3 : minN);
    }

    // (x, z) から radius 以内の梯子（out に入れて返す）。登り始め・屋上から降りる所を探すのに使う
    laddersNear(x, z, radius, out) {
      out = out || [];
      out.length = 0;
      const R = radius || 2, i0 = this._ix(x - R), i1 = this._ix(x + R), j0 = this._iz(z - R), j1 = this._iz(z + R);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const a = this.lhash.get(this._hk(i, j));
        if (!a) continue;
        for (const l of a) if (Math.hypot(l.x - x, l.z - z) <= R) out.push(l.src);
      }
      return out;
    }

    // ---------- 作り方 ----------
    static fromLevel(level) {
      if (!MR.buildBoxes && typeof require === 'function') { try { require('./nav.js'); } catch (e) { /* ブラウザでは nav.js が先に読まれている */ } }
      const boxes = MR.buildBoxes(level);
      const S = level.size, hf = S / 2, H = level.wallHeight || 4;
      const nav = new Nav3D({ minX: -hf, minZ: -hf, maxX: hf, maxZ: hf, chunkSize: S, hashCell: 8, graphCell: 1, stepUp: 0.45, headroom: 1.8, agentRadius: 0.6 });
      nav.groundAt = Nav3D.prototype._flat;
      const walls = [
        { x: 0, z: hf + 0.5, w: S + 2, h: H, d: 1 }, { x: 0, z: -hf - 0.5, w: S + 2, h: H, d: 1 },
        { x: hf + 0.5, z: 0, w: 1, h: H, d: S + 2 }, { x: -hf - 0.5, z: 0, w: 1, h: H, d: S + 2 }
      ];
      nav.size = S; nav.half = hf; nav.wallHeight = H;
      nav.boxes = boxes; nav.walls = walls; nav.solids = boxes.concat(walls);
      nav.addChunk('0_0', {
        cx: 0, cz: 0,
        boxes: boxes.map((b) => ({ x: b.x, y: 0, z: b.z, w: b.w, h: b.h, d: b.d, f: WALK, src: b })).concat(walls.map((w) => ({ x: w.x, y: 0, z: w.z, w: w.w, h: w.h, d: w.d, f: 0 })))
      });
      return nav;
    }
    static fromCity(city, cx, cz, radius, opts) {
      opts = opts || {};
      const e = city.engine || {};
      const nav = new Nav3D({ minX: city.minX, minZ: city.minZ, maxX: city.maxX, maxZ: city.maxZ, chunkSize: city.cs, hashCell: e.hashCell, graphCell: e.graphCell,
        stepUp: e.stepUp, headroom: e.headroom, agentRadius: e.agentRadius, maxExpand: e.maxExpand, groundAt: (x, z) => city.groundAt(x, z),
        prismMode: opts.prismMode || e.prismMode, prismCellEdges: e.prismCellEdges });
      nav.city = city;
      nav.coarse = !!opts.coarse;
      if (cx != null) nav.loadChunks(cx, cz, radius || 0);
      return nav;
    }
    // 街から (cx, cz) の周り radius チャンクを読む（足りない分だけ）
    loadChunks(cx, cz, radius) {
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, z = cz + dz, k = x + '_' + z;
        if (this.chunks.has(k)) continue;
        const d = this.coarse ? this.city.chunkCoarse(x, z) : this.city.chunkFull(x, z);
        if (d) this.addChunk(k, d);
      }
    }
    // (x, z) の周り radius チャンクを読み、keep（既定 radius + 1）より遠いものを捨てる
    loadAround(x, z, radius, keep) {
      const c = this.city.chunkOf(x, z), K = keep == null ? radius + 1 : keep;
      this.loadChunks(c.cx, c.cz, radius);
      for (const ch of Array.from(this.chunks.values())) if (Math.max(Math.abs(ch.cx - c.cx), Math.abs(ch.cz - c.cz)) > K) this.removeChunk(ch.key);
    }
  }

  MR.Nav3D = Nav3D;
  if (typeof module !== 'undefined' && module.exports) module.exports = Nav3D;
})(typeof window !== 'undefined' ? window : globalThis);
