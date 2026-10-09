// THREE に依存しない純粋なロジック:
//   - シード付き乱数とマップ生成
//   - 箱（AABB）との当たり判定・押し出し
//   - 視線判定とレイキャスト
//   - グリッド A* 経路探索
// Node でもそのまま動くのでテストしやすい。
(function (root) {
  const MR = root.MR || (root.MR = {});

  // mulberry32: 同じシードなら同じマップになる
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

  // レベル JSON から障害物（箱）のリストを作る。{ type, x, z, w, h, d, ... } の配列（x,z は中心、h は高さ）
  // 当たり判定も見た目もこのリストから作るので、見た目と判定がずれない。
  function buildBoxes(level) {
    if (Array.isArray(level.boxes) && level.boxes.length) {
      return level.boxes.map((b) => Object.assign({ type: 'block' }, b));
    }
    const rnd = seededRandom(level.seed || 1);
    const half = level.size / 2;
    const clear = level.clearRadius || 8;
    const roadHalf = (level.roadWidth || 7) / 2;
    const margin = 4;
    const counts = Object.assign({ buildings: 7, containers: 10, barriers: 16, sandbags: 8, crates: 14, barrels: 10 }, level.props || {});
    const boxes = [];

    function place(type, w, h, d, opts) {
      opts = opts || {};
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = (rnd() * 2 - 1) * (half - margin - w / 2);
        const z = (rnd() * 2 - 1) * (half - margin - d / 2);
        // 中央の広場は空けておく
        if (Math.abs(x) < clear + w / 2 && Math.abs(z) < clear + d / 2) continue;
        // 道路の上に建物は建てない
        const onRoad = (Math.abs(x) - w / 2 < roadHalf + 0.5) || (Math.abs(z) - d / 2 < roadHalf + 0.5);
        if (opts.offRoad && onRoad) continue;
        const gap = opts.gap == null ? 1.8 : opts.gap;
        let overlap = false;
        for (const b of boxes) {
          if (Math.abs(b.x - x) < (b.w + w) / 2 + gap && Math.abs(b.z - z) < (b.d + d) / 2 + gap) { overlap = true; break; }
        }
        if (overlap) continue;
        const box = Object.assign({ type, x, z, w, h, d }, opts.extra || {});
        boxes.push(box);
        return box;
      }
      return null;
    }

    for (let i = 0; i < counts.buildings; i++) {
      place('building', pick(rnd, [6, 9, 12]), pick(rnd, [6, 9, 12, 15]), pick(rnd, [6, 9, 12]), { offRoad: true, gap: 3, extra: { seed: Math.floor(rnd() * 1e6) } });
    }
    for (let i = 0; i < counts.containers; i++) {
      const rot = rnd() < 0.5;
      place('container', rot ? 6.06 : 2.45, 2.6, rot ? 2.45 : 6.06, { offRoad: true, extra: { color: Math.floor(rnd() * 5), rot } });
    }
    for (let i = 0; i < counts.barriers; i++) {
      const rot = rnd() < 0.5;
      place('barrier', rot ? 3.6 : 0.6, 1.1, rot ? 0.6 : 3.6, { gap: 1.4, extra: { rot } });
    }
    for (let i = 0; i < counts.sandbags; i++) {
      const rot = rnd() < 0.5;
      place('sandbag', rot ? 3.2 : 0.9, 0.95, rot ? 0.9 : 3.2, { gap: 1.4, extra: { rot } });
    }
    for (let i = 0; i < counts.crates; i++) {
      const tall = rnd() < 0.3;
      place('crate', 1.25, tall ? 2.5 : 1.25, 1.25, { gap: 1.2, extra: { tall } });
    }
    for (let i = 0; i < counts.barrels; i++) {
      place('barrel', 0.74, 0.95, 0.74, { gap: 1.2, extra: { color: Math.floor(rnd() * 3) } });
    }
    // 街灯: 道路の両脇に等間隔（ぶつかる場所にはスキップ）
    const lampOffset = roadHalf + 1.0;
    const lampAt = (x, z, rot) => {
      for (const b of boxes) {
        if (Math.abs(b.x - x) < b.w / 2 + 0.8 && Math.abs(b.z - z) < b.d / 2 + 0.8) return;
      }
      boxes.push({ type: 'lamp', x, z, w: 0.4, h: 5.2, d: 0.4, rot });
    };
    for (const p of [-half * 0.62, -half * 0.26, half * 0.26, half * 0.62]) {
      lampAt(p, lampOffset, Math.PI);
      lampAt(p, -lampOffset, 0);
      lampAt(lampOffset, p, -Math.PI / 2);
      lampAt(-lampOffset, p, Math.PI / 2);
    }
    return boxes;
  }

  class Nav {
    constructor(level) {
      this.size = level.size;
      this.half = level.size / 2;
      this.wallHeight = level.wallHeight || 4;
      this.boxes = buildBoxes(level);
      // 外周の壁も箱として扱う（厚み 1）
      const H = this.wallHeight, S = this.size, hf = this.half;
      this.walls = [
        { x: 0, z: hf + 0.5, w: S + 2, h: H, d: 1 },
        { x: 0, z: -hf - 0.5, w: S + 2, h: H, d: 1 },
        { x: hf + 0.5, z: 0, w: 1, h: H, d: S + 2 },
        { x: -hf - 0.5, z: 0, w: 1, h: H, d: S + 2 }
      ];
      this.solids = this.boxes.concat(this.walls);
      this._buildGrid();
    }

    // ---------- 当たり判定 ----------

    // 半径 r の円（x,z）を箱から押し出す。戻り値 { x, z }
    resolveCircle(x, z, r) {
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        for (const b of this.solids) {
          const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
          const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
          const cx = Math.max(minX, Math.min(x, maxX));
          const cz = Math.max(minZ, Math.min(z, maxZ));
          let dx = x - cx, dz = z - cz;
          const distSq = dx * dx + dz * dz;
          if (distSq >= r * r) continue;
          if (distSq > 1e-9) {
            const dist = Math.sqrt(distSq);
            const push = r - dist;
            x += dx / dist * push;
            z += dz / dist * push;
          } else {
            // 中心が箱の中にある: 一番近い面から出す
            const toMinX = x - minX, toMaxX = maxX - x, toMinZ = z - minZ, toMaxZ = maxZ - z;
            const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
            if (m === toMinX) x = minX - r; else if (m === toMaxX) x = maxX + r; else if (m === toMinZ) z = minZ - r; else z = maxZ + r;
          }
          moved = true;
        }
        if (!moved) break;
      }
      // 念のためマップ内に収める
      const lim = this.half - r - 0.05;
      x = Math.max(-lim, Math.min(lim, x));
      z = Math.max(-lim, Math.min(lim, z));
      return { x, z };
    }

    // 点 (x, z) が箱（margin m 太らせたもの。負なら細らせたもの）の中にあれば、その箱。無ければ null。
    // y を渡すと、その高さが箱の上面より上の箱は除く（y を省くと高さを見ない＝今のプレイヤーと同じ 2D の判定）
    solidAt(x, z, margin, y) {
      const m = margin || 0;
      for (const b of this.solids) {
        if (y != null && y >= b.h) continue;
        if (Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m) return b;
      }
      return null;
    }

    // 水平の線分 a→b が、margin m 太らせた箱を横切るか（端点が中にあるときも含む）。横切る箱か null。
    // サーバーが「壁の通り抜け」を見るのに使う（1 通ごとの移動が薄い箱をまたいでいないか）
    segmentBlocked(ax, az, bx, bz, margin) {
      const m = margin || 0;
      const dx = bx - ax, dz = bz - az;
      for (const b of this.solids) {
        const minX = b.x - b.w / 2 - m, maxX = b.x + b.w / 2 + m;
        const minZ = b.z - b.d / 2 - m, maxZ = b.z + b.d / 2 + m;
        let t0 = 0, t1 = 1, hit = true;
        for (const [o, d, mn, mx] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
          if (Math.abs(d) < 1e-9) {
            if (o <= mn || o >= mx) { hit = false; break; }
          } else {
            let u = (mn - o) / d, v = (mx - o) / d;
            if (u > v) { const tmp = u; u = v; v = tmp; }
            if (u > t0) t0 = u;
            if (v < t1) t1 = v;
            if (t0 >= t1) { hit = false; break; }
          }
        }
        if (hit) return b;
      }
      return null;
    }

    // 線分 a→b が箱に遮られていないか
    lineOfSight(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return true;
      const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len);
      return hit === null;
    }

    // レイ vs 箱。最も近いヒットを { t, x, y, z, nx, ny, nz } で返す。無ければ null
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = null;
      for (const b of this.solids) {
        const t = Nav.rayBox(ox, oy, oz, dx, dy, dz, b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2);
        if (t !== null && t >= 0 && t <= maxDist && (best === null || t < best.t)) {
          const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
          // 法線: どの面に当たったか
          let nx = 0, ny = 0, nz = 0;
          const eps = 1e-3;
          if (Math.abs(hx - (b.x - b.w / 2)) < eps) nx = -1;
          else if (Math.abs(hx - (b.x + b.w / 2)) < eps) nx = 1;
          else if (Math.abs(hz - (b.z - b.d / 2)) < eps) nz = -1;
          else if (Math.abs(hz - (b.z + b.d / 2)) < eps) nz = 1;
          else if (Math.abs(hy - b.h) < eps) ny = 1;
          else ny = -1;
          best = { t, x: hx, y: hy, z: hz, nx, ny, nz };
        }
      }
      // 地面
      if (dy < 0) {
        const t = -oy / dy;
        if (t >= 0 && t <= maxDist && (best === null || t < best.t)) {
          best = { t, x: ox + dx * t, y: 0, z: oz + dz * t, nx: 0, ny: 1, nz: 0 };
        }
      }
      return best;
    }

    static rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
      let tmin = -Infinity, tmax = Infinity;
      const axes = [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]];
      for (const [o, d, mn, mx] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) return null;
        } else {
          let t1 = (mn - o) / d, t2 = (mx - o) / d;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return null;
        }
      }
      if (tmax < 0) return null;
      return tmin >= 0 ? tmin : null; // 内側から始まるレイは当たらない扱い
    }

    // ---------- 経路探索 ----------

    _buildGrid() {
      this.cell = 1.0;
      this.cols = Math.ceil(this.size / this.cell);
      this.rows = this.cols;
      this.blocked = new Uint8Array(this.cols * this.rows);
      const inflate = 0.6; // エージェント半径ぶん箱を太らせる
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const x = -this.half + (c + 0.5) * this.cell;
          const z = -this.half + (r + 0.5) * this.cell;
          let blocked = 0;
          for (const b of this.boxes) {
            if (Math.abs(x - b.x) <= b.w / 2 + inflate && Math.abs(z - b.z) <= b.d / 2 + inflate) { blocked = 1; break; }
          }
          // 外周 1 セルは通れない
          if (r === 0 || c === 0 || r === this.rows - 1 || c === this.cols - 1) blocked = 1;
          this.blocked[r * this.cols + c] = blocked;
        }
      }
    }

    toCell(x, z) {
      const c = Math.floor((x + this.half) / this.cell);
      const r = Math.floor((z + this.half) / this.cell);
      return { c: Math.max(0, Math.min(this.cols - 1, c)), r: Math.max(0, Math.min(this.rows - 1, r)) };
    }

    cellCenter(c, r) {
      return { x: -this.half + (c + 0.5) * this.cell, z: -this.half + (r + 0.5) * this.cell };
    }

    isBlockedAt(x, z) {
      const { c, r } = this.toCell(x, z);
      return this.blocked[r * this.cols + c] === 1;
    }

    // 動く障害物（乗り物など）の AABB [{ x, z, w, d }] を経路探索の格子に反映する（当たり判定には使わない）。
    // 毎回「今あるもの全部」を渡す（[] で解除）。game.js が 0.4 s ごとに呼ぶ
    setDynamicBoxes(boxes) {
      if (!this._blockedStatic) this._blockedStatic = this.blocked.slice();
      this.blocked.set(this._blockedStatic);
      const inflate = 0.6;
      for (const b of boxes || []) {
        if (!b) continue;
        const c0 = this.toCell(b.x - b.w / 2 - inflate, b.z - b.d / 2 - inflate);
        const c1 = this.toCell(b.x + b.w / 2 + inflate, b.z + b.d / 2 + inflate);
        for (let r = c0.r; r <= c1.r; r++) for (let c = c0.c; c <= c1.c; c++) this.blocked[r * this.cols + c] = 1;
      }
    }

    // 近くの通れるセルを探す（スポーン位置の補正用）
    nearestFree(x, z, maxRadius) {
      const { c, r } = this.toCell(x, z);
      const R = maxRadius || 6;
      if (!this.blocked[r * this.cols + c]) return { x, z };
      for (let rad = 1; rad <= R; rad++) {
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= this.rows || cc >= this.cols) continue;
            if (!this.blocked[rr * this.cols + cc]) return this.cellCenter(cc, rr);
          }
        }
      }
      return { x, z };
    }

    // A*（8方向、角抜け禁止）。戻り値は { x, z } の配列。到達不能なら []
    findPath(sx, sz, tx, tz) {
      const start = this.toCell(sx, sz);
      const goal = this.toCell(tx, tz);
      const cols = this.cols, rows = this.rows, blocked = this.blocked;
      const startI = start.r * cols + start.c;
      let goalI = goal.r * cols + goal.c;
      if (blocked[goalI]) {
        const nf = this.nearestFree(tx, tz, 4);
        const g2 = this.toCell(nf.x, nf.z);
        goalI = g2.r * cols + g2.c;
      }
      if (startI === goalI) return [{ x: tx, z: tz }];

      const n = cols * rows;
      const g = new Float32Array(n).fill(Infinity);
      const f = new Float32Array(n).fill(Infinity);
      const parent = new Int32Array(n).fill(-1);
      const closed = new Uint8Array(n);
      const heap = new Nav.MinHeap(f);

      const gc = goalI % cols, gr = (goalI / cols) | 0;
      const h = (i) => {
        const dc = Math.abs((i % cols) - gc), dr = Math.abs(((i / cols) | 0) - gr);
        return Math.max(dc, dr) + 0.4142 * Math.min(dc, dr);
      };

      g[startI] = 0;
      f[startI] = h(startI);
      heap.push(startI);

      const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
      let expanded = 0;
      while (heap.size > 0 && expanded < 20000) {
        const cur = heap.pop();
        if (cur === goalI) break;
        if (closed[cur]) continue;
        closed[cur] = 1;
        expanded++;
        const cc = cur % cols, cr = (cur / cols) | 0;
        for (const [dc, dr, cost] of dirs) {
          const nc = cc + dc, nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (blocked[ni] || closed[ni]) continue;
          // 斜め移動は両隣が空いているときだけ（角抜け禁止）
          if (dc !== 0 && dr !== 0 && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue;
          const ng = g[cur] + cost;
          if (ng < g[ni]) {
            g[ni] = ng;
            f[ni] = ng + h(ni);
            parent[ni] = cur;
            heap.push(ni);
          }
        }
      }
      if (parent[goalI] === -1 && goalI !== startI) return [];

      const cells = [];
      for (let i = goalI; i !== -1; i = parent[i]) cells.push(i);
      cells.reverse();

      // ストリングプリング: 直線で見える限り途中点を飛ばす
      const pts = cells.map((i) => this.cellCenter(i % cols, (i / cols) | 0));
      pts[pts.length - 1] = { x: tx, z: tz };
      const out = [];
      let anchor = 0;
      while (anchor < pts.length - 1) {
        let next = anchor + 1;
        for (let j = pts.length - 1; j > anchor + 1; j--) {
          if (this._walkable(pts[anchor], pts[j])) { next = j; break; }
        }
        out.push(pts[next]);
        anchor = next;
      }
      return out;
    }

    // 2点間が歩けるか（グリッドをサンプリング）
    _walkable(a, b) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const steps = Math.ceil(len / (this.cell * 0.5));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (this.isBlockedAt(a.x + dx * t, a.z + dz * t)) return false;
      }
      return true;
    }
  }

  // 最小ヒープ（f 値で比較）
  Nav.MinHeap = class MinHeap {
    constructor(keys) { this.keys = keys; this.items = []; }
    get size() { return this.items.length; }
    push(i) {
      const a = this.items; a.push(i);
      let k = a.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (this.keys[a[p]] <= this.keys[a[k]]) break;
        [a[p], a[k]] = [a[k], a[p]]; k = p;
      }
    }
    pop() {
      const a = this.items;
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < a.length && this.keys[a[l]] < this.keys[a[m]]) m = l;
          if (r < a.length && this.keys[a[r]] < this.keys[a[m]]) m = r;
          if (m === k) break;
          [a[m], a[k]] = [a[k], a[m]]; k = m;
        }
      }
      return top;
    }
  };

  MR.Nav = Nav;
  MR.seededRandom = seededRandom;
  MR.buildBoxes = buildBoxes;
})(typeof window !== 'undefined' ? window : globalThis);
