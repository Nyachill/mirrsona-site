// 壊れる物（MR.Destruct。DM0〜DM4a）。THREE にも DOM にも依存しない（Node のスモーク・後でサーバーも require できる。CLAUDE.md の 14）。
//   ブラウザ: <script> で読む → MR.Destruct      Node: require('../www/js/destruct.js') → Destruct（globalThis.MR.Destruct にも入る）
//
// ■ 壊れる物の段（tier）
//   T1 小物（prop）: citygen の props のうち game.json の destruct.props にある種類（ゴミ箱・郵便箱・新聞スタンド・電話ボックス・ベンチ・植え込み・
//      消火栓・木箱・屋上の空調）。当たりの箱（cat prop）を外し、見た目（CityProps）を隠し、破片を飛ばす。
//   T2 壁の穴（breach）: 入れる建物の外壁（SHELL の exterior）だけ。穴の直方体 R にかかる外壁の箱を外し、R の外の残り（最大 6 個の直方体）と
//      足元のがれき（WALK、高さ ≤ stepUp）を足す = つながりが増えるだけ（ふさがる所は無い）。床・屋根・階段・芯・ランドマーク・橋・桟橋・空母は
//      壊れない（SHELL の外壁しか外さない）。入れない建物はえぐれと焦げ（crater: 見た目だけ。当たり判定は変えない）。
//   T3a 屋上の給水塔（tank）: 脚と胴の箱を外し、自分の足元に 1 m 以下のつぶれた残骸（WALK）を置く。
// ■ 持ち主と鍵: 記録はそれを出したチャンク（chunkFull のキー = 持ち主）の下に置く（はみ出しは maxOverhang 64 m まで = 調べるときは ± 64 m）。
//   鍵は形から作る `型|x·10|y·10|z·10`（整数に丸める）= 生成の鍵（genKey）は変わらない。同じ鍵 = 同じ物（チャンクを作り直しても）。
// ■ 状態は鍵と時刻だけ（決定的）。破片の物理は見た目だけ（destruct_view.js / debris.js）。
//
// API
//   Destruct.key(type, x, y, z)                         鍵
//   Destruct.box(b) → { x0, x1, y0, y1, z0, z1 }        citygen の箱 { x, y, z, w, h, d } の範囲
//   Destruct.subtract(b, R, out, minW)                  箱 b から直方体 R を引いた残り（最大 6 個。厚さ minW 未満は捨てる）を out に（citygen の箱の形）
//   Destruct.planBreach(boxes, hit, cfg) → rec | null   外壁の穴の計画（hit = { x, y, z }。近くに入れる建物の外壁が無ければ null）
//   Destruct.planProp(boxes, prop, rule) → rec          小物の記録（当たりの箱は derive が探す）
//   Destruct.planTank(boxes, prop, rule) → rec          給水塔
//   Destruct.derive(boxes, rec) → { remove: Set<box>, add: [box] }   記録 1 つの効き目（同じ boxes の配列ごとに覚える）
//   Destruct.deriveAll(data, recs) → { remove, add, ladders, rects }   持ち主の記録を全部まとめた効き目（同じ壁の穴どうしは「箱 − 全部の穴」）
//   Destruct.filterNav(data, recs) → data               チャンクのデータ（chunkFull の形）から外す箱を抜き、足す箱を足した写し（元は変えない）
//   new Destruct.Registry(cfg)                          記録（持ち主ごと）・上限・直し（repairAfter 秒見えないと消える）・続きから（dz）
(function destructModule(root) {
  const MR = root.MR || (root.MR = {});
  const F = { NOCOL: 1, NOLOS: 2, WALK: 4, LADDER: 8, SHELL: 16 };
  const r10 = (v) => Math.round(v * 10);
  const r2 = (v) => Math.round(v * 100) / 100;

  function key(type, x, y, z) { return type + '|' + r10(x) + '|' + r10(y) + '|' + r10(z); }
  function box(b) { const hw = b.w / 2, hd = b.d / 2, y = b.y || 0; return { x0: b.x - hw, x1: b.x + hw, y0: y, y1: y + b.h, z0: b.z - hd, z1: b.z + hd }; }
  function mk(src, x0, x1, y0, y1, z0, z1) {
    const o = { x: r2((x0 + x1) / 2), y: r2(y0), z: r2((z0 + z1) / 2), w: r2(x1 - x0), h: r2(y1 - y0), d: r2(z1 - z0), mat: src.mat, cat: src.cat, f: src.f };
    if (src.mt) o.mt = src.mt;
    o.dx = 1; // 壊れた後に足した箱（destruct_view が描く。citygen の箱ではない）
    return o;
  }
  // b − R（軸平行）。x → y → z の順に切る（重なりが eps 未満なら引かない = b をそのまま返す）
  function subtract(b, R, out, minW) {
    const B = box(b), e = 0.05, mw = minW > 0 ? minW : 0.04;
    out = out || [];
    const ox = Math.min(B.x1, R.x1) - Math.max(B.x0, R.x0), oy = Math.min(B.y1, R.y1) - Math.max(B.y0, R.y0), oz = Math.min(B.z1, R.z1) - Math.max(B.z0, R.z0);
    if (ox <= e || oy <= e || oz <= e) { out.push(b); return out; }
    let x0 = B.x0, x1 = B.x1, y0 = B.y0, y1 = B.y1, z0 = B.z0, z1 = B.z1;
    const push = (a0, a1, b0, b1, c0, c1) => { if (a1 - a0 >= mw && b1 - b0 >= mw && c1 - c0 >= mw) out.push(mk(b, a0, a1, b0, b1, c0, c1)); };
    if (R.x0 > x0) { push(x0, R.x0, y0, y1, z0, z1); x0 = R.x0; }
    if (R.x1 < x1) { push(R.x1, x1, y0, y1, z0, z1); x1 = R.x1; }
    if (R.y0 > y0) { push(x0, x1, y0, R.y0, z0, z1); y0 = R.y0; }
    if (R.y1 < y1) { push(x0, x1, R.y1, y1, z0, z1); y1 = R.y1; }
    if (R.z0 > z0) { push(x0, x1, y0, y1, z0, R.z0); z0 = R.z0; }
    if (R.z1 < z1) { push(x0, x1, y0, y1, R.z1, z1); }
    return out;
  }
  const isShell = (b) => (b.f & F.SHELL) !== 0 && b.cat === 'exterior' && !b.lm && !b.dx;
  // チャンクの箱のうち入れる建物の外壁・小物の当たりの箱（同じ配列ごとに 1 回。全部の箱をなめない）
  const subCache = new WeakMap();
  function subsets(boxes) {
    let o = subCache.get(boxes);
    if (o) return o;
    const shell = [], prop = [];
    for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (isShell(b)) shell.push(b); else if (b.cat === 'prop' && !b.dx) prop.push(b); }
    o = { shell, prop };
    subCache.set(boxes, o);
    return o;
  }
  const dist2Box = (B, x, y, z) => {
    const dx = x < B.x0 ? B.x0 - x : x > B.x1 ? x - B.x1 : 0;
    const dy = y < B.y0 ? B.y0 - y : y > B.y1 ? y - B.y1 : 0;
    const dz = z < B.z0 ? B.z0 - z : z > B.z1 ? z - B.z1 : 0;
    return dx * dx + dy * dy + dz * dz;
  };

  // 入れる建物の外壁の穴。cfg = destruct.breach { width, height, reach, wall, rubbleH, minFace }
  //   一番近い外壁の箱（reach m 以内）の薄い軸 = 壁の法線。面の範囲（同じ面の外壁の箱の和）の中に幅を収め、下端はその階の床（外壁の高い箱
  //   （h ≥ 1.8 = 窓と窓の間の柱・扉の横）の下端のうち hit の高さ + 0.4 以下で一番上）
  function planBreach(boxes, hit, cfg) {
    cfg = cfg || {};
    const W = cfg.width > 0 ? cfg.width : 3, H = cfg.height > 0 ? cfg.height : 2.5, reach = cfg.reach > 0 ? cfg.reach : 1.6;
    const wt = cfg.wall > 0 ? cfg.wall : 0.3;
    let best = null, bd = reach * reach;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!isShell(b)) continue;
      const d = dist2Box(box(b), hit.x, hit.y, hit.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return null;
    // 壁の向き: 厚さ wt の軸（両方なら hit の側）
    const tx = Math.abs(best.w - wt) < 0.03, tz = Math.abs(best.d - wt) < 0.03;
    let ax;
    if (tx && !tz) ax = 'x'; else if (tz && !tx) ax = 'z';
    else if (tx && tz) ax = Math.abs(hit.x - best.x) > Math.abs(hit.z - best.z) ? 'x' : 'z';
    else return null;
    const plane = ax === 'x' ? best.x : best.z;
    const sOf = (b) => (ax === 'x' ? b.z : b.x), lenOf = (b) => (ax === 'x' ? b.d : b.w), thick = (b) => (ax === 'x' ? b.w : b.d), pc = (b) => (ax === 'x' ? b.x : b.z);
    const hs = ax === 'x' ? hit.z : hit.x;
    // 同じ面（同じ平面・同じ厚さの外壁）。hit を含むつながった区間（隙間 0.5 m 以下）だけを面の範囲にする（隣の建物の面は別）
    const same = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (isShell(b) && Math.abs(pc(b) - plane) <= 0.02 && Math.abs(thick(b) - thick(best)) <= 0.02) same.push(b);
    }
    same.sort((p, q) => (sOf(p) - lenOf(p) / 2) - (sOf(q) - lenOf(q) / 2));
    let c0 = null, c1 = 0, f0 = null, f1 = 0;
    for (const b of same) {
      const a = sOf(b) - lenOf(b) / 2, c = sOf(b) + lenOf(b) / 2;
      if (c0 === null || a > c1 + 0.5) {
        if (c0 !== null && hs >= c0 - 0.5 && hs <= c1 + 0.5) { f0 = c0; f1 = c1; break; }
        c0 = a; c1 = c;
      } else if (c > c1) c1 = c;
    }
    if (f0 === null && c0 !== null && hs >= c0 - 0.5 && hs <= c1 + 0.5) { f0 = c0; f1 = c1; }
    if (f0 === null) return null;
    const minFace = cfg.minFace > 0 ? cfg.minFace : 0.3;
    if (f1 - f0 < W * 0.6 + 2 * minFace) return null; // 狭すぎる面（柱だけ）は穴にしない
    const half = Math.min(W / 2, (f1 - f0) / 2 - minFace);
    const sc = r2(Math.max(f0 + minFace + half, Math.min(f1 - minFace - half, hs))); // 0.01 m に丸める（続きからの形と同じ鍵）
    // 床: 同じ面の高い外壁の箱の下端
    let y0 = -Infinity;
    for (const b of same) {
      const a = sOf(b) - lenOf(b) / 2, c = sOf(b) + lenOf(b) / 2;
      if (c < sc - half - 0.5 || a > sc + half + 0.5) continue;
      if (b.h >= 1.8 && b.y <= hit.y + 0.4 && b.y > y0) y0 = b.y;
    }
    if (!isFinite(y0)) return null;
    const ht = wt / 2 + 0.2;
    const R = ax === 'x'
      ? { x0: plane - ht, x1: plane + ht, y0: y0 + 0.02, y1: y0 + H, z0: sc - half, z1: sc + half }
      : { x0: sc - half, x1: sc + half, y0: y0 + 0.02, y1: y0 + H, z0: plane - ht, z1: plane + ht };
    const cx = ax === 'x' ? plane : sc, cz = ax === 'x' ? sc : plane;
    return { type: 'breach', k: key('b', cx, y0, cz), x: cx, y: y0, z: cz, ax, n: (ax === 'x' ? hit.x - plane : hit.z - plane) >= 0 ? 1 : -1, R,
      rubbleH: cfg.rubbleH > 0 ? cfg.rubbleH : 0.25, mat: best.mat };
  }

  // 小物の当たりの箱（cat prop）: 箱の真ん中が足元から r 以内・下端が足元。dims（[[w, h, d, 下端の高さ]…]。w と d は入れ替わってよい）が
  //   あれば寸法の合う箱だけ（隣の小物・壊れない小物の箱を外さない: 給水塔の下の空調・ベンチの横の街灯・足場）
  const near = (a, b) => Math.abs(a - b) < 0.04;
  function dimOk(b, dm, p) {
    if (!near(b.h, dm[1])) return false;
    if (!((near(b.w, dm[0]) && near(b.d, dm[2])) || (near(b.w, dm[2]) && near(b.d, dm[0])))) return false;
    return Math.abs((b.y || 0) - (p.y + (dm[3] || 0))) < 0.06;
  }
  function propBoxes(boxes, p, r, out, dims) {
    out = out || [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.cat !== 'prop' || b.dx) continue;
      const y = b.y || 0;
      if (y < p.y - 0.2 || y > p.y + 3.2) continue;
      if (dims && dims.length) { let ok = false; for (const dm of dims) if (dimOk(b, dm, p)) { ok = true; break; } if (!ok) continue; }
      if (Math.hypot(b.x - p.x, b.z - p.z) > r + 0.05) continue;
      out.push(b);
    }
    return out;
  }
  function planProp(p, rule) {
    return { type: 'prop', k: key('p', p.x, p.y, p.z), x: p.x, y: p.y, z: p.z, ptype: p.type, r: (rule && rule.r) || 0.6, dims: (rule && rule.dims) || null };
  }
  // 給水塔: 脚 4 本と胴の箱・胴の梯子を外し、足元に高さ wreckH（≤ 1 m）のつぶれた残骸（WALK）
  function planTank(p, rule) {
    rule = rule || {};
    return { type: 'tank', k: key('t', p.x, p.y, p.z), x: p.x, y: p.y, z: p.z, ptype: p.type, r: rule.r || 2.3, dims: rule.dims || null,
      wreckH: Math.min(1, rule.wreckH > 0 ? rule.wreckH : 0.9), wreckR: rule.wreckR > 0 ? rule.wreckR : 1.7 };
  }
  // 給水塔の梯子（胴の外、足元から上へ）
  function tankLadders(ladders, rec, out) {
    out = out || [];
    for (const l of ladders || []) if (Math.abs(l.y0 - rec.y) < 0.3 && Math.hypot(l.x - rec.x, l.z - rec.z) < rec.r + 0.3) out.push(l);
    return out;
  }

  // 持ち主のチャンクの記録の効き目を全部まとめて（同じ boxes と同じ記録の並びごとに覚える）:
  //   入れる建物の外壁は、どれかの穴にかかる箱ごとに「箱 − 全部の穴」（同じ壁の 2 つ目の穴が 1 つ目の穴を埋めない・1 つ直しても
  //   ほかの穴が残る）。がれき・縁は穴ごと。小物・給水塔は自分の箱と梯子
  //   → { remove: Set<元の箱>, add: [箱], ladders: Set<元の梯子>, rects: [{ x0, z0, x1, z1 }]（変わる所）}
  const allCache = new WeakMap();
  function deriveAll(data, recs) {
    const boxes = data.boxes || [];
    let m = allCache.get(boxes);
    if (!m) { m = new Map(); allCache.set(boxes, m); }
    let sig = '';
    for (const r of recs) if (r.type !== 'crater') sig += r.k + ';';
    let res = m.get(sig);
    if (res) return res;
    m.clear(); // 覚えるのは最後の 1 つだけ（記録が増えるたびに新しい組み合わせ = 前の物は要らない。全部覚えると 300 個の穴で 70 MB）
    const remove = new Set(), add = [], ladders = new Set(), rects = [];
    const Rs = [];
    for (const r of recs) if (r.type === 'breach') { Rs.push(r.R); rects.push({ x0: r.R.x0, z0: r.R.z0, x1: r.R.x1, z1: r.R.z1 }); }
    if (Rs.length) {
      const shell = subsets(boxes).shell;
      for (let i = 0; i < shell.length; i++) {
        const b = shell[i];
        const B = box(b);
        let hit = false;
        for (const R of Rs) if (Math.min(B.x1, R.x1) - Math.max(B.x0, R.x0) > 0.05 && Math.min(B.y1, R.y1) - Math.max(B.y0, R.y0) > 0.05 && Math.min(B.z1, R.z1) - Math.max(B.z0, R.z0) > 0.05) { hit = true; break; }
        if (!hit) continue;
        remove.add(b);
        let pieces = [b];
        for (const R of Rs) { const nx = []; for (const q of pieces) subtract(q, R, nx); pieces = nx; }
        for (const q of pieces) add.push(q);
      }
      for (const r of recs) if (r.type === 'breach') for (const q of derive(boxes, r).add) if (q.dx !== 1) add.push(q); // がれき・縁
    }
    for (const r of recs) {
      if (r.type !== 'prop' && r.type !== 'tank') continue;
      const d = derive(boxes, r);
      for (const b of d.remove) remove.add(b);
      for (const b of d.add) add.push(b);
      if (r.type === 'tank') for (const l of tankLadders(data.ladders, r)) ladders.add(l);
      const rr = r.r + 0.3;
      rects.push({ x0: r.x - rr, z0: r.z - rr, x1: r.x + rr, z1: r.z + rr });
    }
    res = { remove, add, ladders, rects };
    m.set(sig, res);
    return res;
  }

  // 記録 1 つの効き目（同じ boxes の配列ごとに覚える）。穴の残り（dx 1）はこの穴だけで引いた形（まとめた形は deriveAll）
  const derCache = new WeakMap();
  function derive(boxes, rec) {
    let m = derCache.get(boxes);
    if (!m) { m = new Map(); derCache.set(boxes, m); }
    let r = m.get(rec.k);
    if (r) return r;
    const remove = new Set(), add = [];
    if (rec.type === 'breach') {
      const R = rec.R, shell = subsets(boxes).shell;
      for (let i = 0; i < shell.length; i++) {
        const b = shell[i];
        const B = box(b);
        if (Math.min(B.x1, R.x1) - Math.max(B.x0, R.x0) <= 0.05 || Math.min(B.y1, R.y1) - Math.max(B.y0, R.y0) <= 0.05 || Math.min(B.z1, R.z1) - Math.max(B.z0, R.z0) <= 0.05) continue;
        remove.add(b);
        subtract(b, R, add);
      }
      if (remove.size) {
        const s = remove.values().next().value, h = rec.rubbleH;
        const wt = rec.ax === 'x' ? s.w : s.d, pc = rec.ax === 'x' ? s.x : s.z;
        const rb = rec.ax === 'x'
          ? { x: r2(pc), y: r2(rec.y), z: r2(rec.z), w: r2(wt), h, d: r2(R.z1 - R.z0 - 0.3), mat: rec.mat || s.mat, cat: 'exterior', f: F.WALK | F.SHELL, dx: 2 }
          : { x: r2(rec.x), y: r2(rec.y), z: r2(pc), w: r2(R.x1 - R.x0 - 0.3), h, d: r2(wt), mat: rec.mat || s.mat, cat: 'exterior', f: F.WALK | F.SHELL, dx: 2 };
        add.push(rb);
        // ぎざぎざの縁（見た目だけ = NOCOL）: 穴の左右の縁と上の縁に、壁の厚さの小さな塊（鍵から決まる乱数）
        let h0 = 2166136261;
        for (let i = 0; i < rec.k.length; i++) h0 = Math.imul(h0 ^ rec.k.charCodeAt(i), 16777619);
        const rnd = () => { h0 = (h0 + 0x6D2B79F5) | 0; let t = Math.imul(h0 ^ (h0 >>> 15), h0 | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const ax = rec.ax, s0 = ax === 'x' ? R.z0 : R.x0, s1 = ax === 'x' ? R.z1 : R.x1, y0 = rec.y + h, y1 = R.y1;
        const stub = (a0, a1, b0, b1) => {
          const t = wt * (0.55 + rnd() * 0.45), o = (rnd() - 0.5) * (wt - t);
          const c0 = pc + o - t / 2, c1 = pc + o + t / 2;
          add.push(ax === 'x' ? { x: r2((c0 + c1) / 2), y: r2(b0), z: r2((a0 + a1) / 2), w: r2(c1 - c0), h: r2(b1 - b0), d: r2(a1 - a0), mat: rec.mat || s.mat, cat: 'exterior', f: F.NOCOL | F.SHELL, dx: 4 }
            : { x: r2((a0 + a1) / 2), y: r2(b0), z: r2((c0 + c1) / 2), w: r2(a1 - a0), h: r2(b1 - b0), d: r2(c1 - c0), mat: rec.mat || s.mat, cat: 'exterior', f: F.NOCOL | F.SHELL, dx: 4 });
        };
        for (let y = y0 + 0.15; y < y1 - 0.25; y += 0.35 + rnd() * 0.3) {
          const hh = 0.25 + rnd() * 0.35;
          stub(s0, s0 + 0.12 + rnd() * 0.38, y, Math.min(y1, y + hh));
          stub(s1 - 0.12 - rnd() * 0.38, s1, y, Math.min(y1, y + hh));
        }
        for (let u = s0 + 0.1; u < s1 - 0.2; u += 0.3 + rnd() * 0.35) {
          const ww = 0.2 + rnd() * 0.4;
          stub(u, Math.min(s1, u + ww), y1 - 0.1 - rnd() * 0.35, y1);
        }
      }
    } else if (rec.type === 'prop' || rec.type === 'tank') {
      const L = propBoxes(subsets(boxes).prop, rec, rec.r, null, rec.dims);
      for (const b of L) remove.add(b);
      if (rec.type === 'tank' && remove.size) {
        const w = rec.wreckR * 2;
        add.push({ x: r2(rec.x), y: r2(rec.y), z: r2(rec.z), w: r2(w), h: rec.wreckH, d: r2(w * 0.8), mat: 'crate', cat: 'exterior', f: F.WALK, dx: 3 }); // 近景が描く（cat prop は描かない）
        // 散らばった板と、ずれて落ちた屋根（見た目だけ = NOCOL。鍵から決まる乱数）
        let h0 = 2166136261;
        for (let i = 0; i < rec.k.length; i++) h0 = Math.imul(h0 ^ rec.k.charCodeAt(i), 16777619);
        const rnd = () => { h0 = (h0 + 0x6D2B79F5) | 0; let t = Math.imul(h0 ^ (h0 >>> 15), h0 | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        // 板は屋上の上だけ（足元の高さの立てる箱が板の両端の下にある。無ければ置かない = 宙に浮かない・パラペットに入らない）
        const onRoof = (x, z) => { for (const b of boxes) { if (!(b.f & F.WALK) || Math.abs((b.y || 0) + b.h - rec.y) > 0.06) continue; if (Math.abs(x - b.x) <= b.w / 2 - 0.3 && Math.abs(z - b.z) <= b.d / 2 - 0.3) return true; } return false; };
        for (let i = 0; i < 7; i++) {
          const a = rnd() * 6.283, d = rec.wreckR + 0.3 + rnd() * 1.4, L = 1.2 + rnd() * 1.8, along = rnd() < 0.5;
          const px = rec.x + Math.cos(a) * d, pz = rec.z + Math.sin(a) * d;
          if (!onRoof(px - (along ? L / 2 : 0), pz - (along ? 0 : L / 2)) || !onRoof(px + (along ? L / 2 : 0), pz + (along ? 0 : L / 2))) continue;
          add.push({ x: r2(px), y: r2(rec.y), z: r2(pz), w: r2(along ? L : 0.28), h: 0.08 + Math.floor(rnd() * 2) * 0.08, d: r2(along ? 0.28 : L), mat: 'crate', cat: 'exterior', f: F.NOCOL, dx: 3 });
        }
        const lw = 2.4;
        add.push({ x: r2(rec.x + (rnd() - 0.5) * 0.8), y: r2(rec.y + rec.wreckH), z: r2(rec.z + (rnd() - 0.5) * 0.8), w: lw, h: 0.25, d: lw, mat: 'metalDark', cat: 'exterior', f: F.NOCOL, dx: 3 });
      }
    }
    r = { remove, add };
    m.set(rec.k, r);
    return r;
  }

  // チャンクのデータの写し（boxes と ladders だけ入れ替える。ほかは同じ物を指す）
  function filterNav(data, recs) {
    if (!recs || !recs.length) return data;
    const d = deriveAll(data, recs);
    if (!d.remove.size && !d.add.length && !d.ladders.size) return data;
    const out = Object.assign({}, data);
    const boxes = data.boxes || [], nb = [];
    for (let i = 0; i < boxes.length; i++) if (!d.remove.has(boxes[i])) nb.push(boxes[i]);
    for (const b of d.add) nb.push(b);
    out.boxes = nb;
    if (d.ladders.size) out.ladders = (data.ladders || []).filter((l) => !d.ladders.has(l));
    out.dxFiltered = true;
    return out;
  }

  // ---------- 記録 ----------
  // cfg = { cap（全部の記録の上限）, repairAfter（秒。持ち主のチャンクが近景に無い間がこれを超えると直す）}
  class Registry {
    constructor(cfg) {
      cfg = cfg || {};
      this.cap = cfg.cap > 0 ? cfg.cap | 0 : 3000;
      this.repairAfter = cfg.repairAfter > 0 ? cfg.repairAfter : 600;
      this.recs = new Map();     // 鍵 → 記録
      this.owners = new Map();   // 持ち主 → { recs: [記録], seen（最後に近景にあった時刻）}
      this.props = new Set();    // 壊れた小物の場所の鍵（Registry.pos。CityProps が隠す）
      this.ver = 0;              // 変わるたびに増える
      this.stats = { added: 0, repaired: 0, evicted: 0 };
    }
    get size() { return this.recs.size; }
    has(k) { return this.recs.has(k); }
    get(k) { return this.recs.get(k) || null; }
    list(owner) { const o = this.owners.get(owner); return o ? o.recs : null; }
    // 加える（同じ鍵は加えない = false）。上限を超えたら古い物から直す（onRepair(rec)）
    add(rec, owner, now, onRepair) {
      if (this.recs.has(rec.k)) return false;
      rec.owner = owner; rec.t = now || 0;
      this.recs.set(rec.k, rec);
      let o = this.owners.get(owner);
      if (!o) { o = { recs: [], seen: now || 0 }; this.owners.set(owner, o); }
      o.recs.push(rec);
      if (rec.type === 'prop' || rec.type === 'tank') this.props.add(Registry.pos(rec));
      this.ver++;
      this.stats.added++;
      while (this.recs.size > this.cap) {
        // 古い順（Map は加えた順）: 見た目だけのえぐれを先に
        let victim = null;
        for (const r of this.recs.values()) { if (r.type === 'crater') { victim = r; break; } }
        if (!victim) victim = this.recs.values().next().value;
        if (victim === rec) break;
        this.remove(victim.k);
        this.stats.evicted++;
        if (onRepair) onRepair(victim);
      }
      return true;
    }
    remove(k) {
      const r = this.recs.get(k);
      if (!r) return null;
      this.recs.delete(k);
      if (r.type === 'prop' || r.type === 'tank') this.props.delete(Registry.pos(r));
      const o = this.owners.get(r.owner);
      if (o) { const i = o.recs.indexOf(r); if (i >= 0) o.recs.splice(i, 1); if (!o.recs.length) this.owners.delete(r.owner); }
      this.ver++;
      return r;
    }
    // 近景にある持ち主を見た（seen = now）
    touch(owner, now) { const o = this.owners.get(owner); if (o) o.seen = now; }
    // 直す: repairAfter 秒見ていない持ち主の記録を全部消す（onRepair(rec) を呼ぶ）。直した数
    repair(now, onRepair) {
      let n = 0;
      for (const [owner, o] of this.owners) {
        if (now - o.seen < this.repairAfter) continue;
        for (const r of o.recs.slice()) { this.remove(r.k); n++; if (onRepair) onRepair(r); }
        this.owners.delete(owner);
      }
      this.stats.repaired += n;
      return n;
    }
    // 続きから（session の dz）: (x, z) に近い n 個の [...pack(記録), 残りの秒（直るまで）]
    snapshot(x, z, now, n) {
      const all = [];
      for (const r of this.recs.values()) {
        const o = this.owners.get(r.owner);
        const left = Math.max(1, Math.round(this.repairAfter - (now - (o ? o.seen : now))));
        all.push([Math.hypot(r.x - x, r.z - z), r, left]);
      }
      all.sort((a, b) => a[0] - b[0]);
      const out = [];
      for (let i = 0; i < all.length && out.length < n; i++) { const pk = Registry.pack(all[i][1]); if (pk) { pk.push(all[i][2]); out.push(pk); } }
      return out;
    }
    // 戻す（記録の形のまま。seen = now − (repairAfter − left)）
    restore(list, now) {
      let n = 0;
      for (const it of list || []) {
        if (!Array.isArray(it) || it.length < 8) continue;
        const left = +it[it.length - 1];
        const rec = Registry.unpack(it.slice(0, -1));
        if (!rec || this.recs.has(rec.k)) continue;
        this.add(rec, rec.owner, now);
        const o = this.owners.get(rec.owner);
        const seen = now - (this.repairAfter - Math.min(this.repairAfter, Math.max(1, isFinite(left) ? left : this.repairAfter)));
        if (o && seen < o.seen) o.seen = seen;
        n++;
      }
      return n;
    }
    clear() { this.recs.clear(); this.owners.clear(); this.props.clear(); this.ver++; }
    // 小物の場所の鍵（CityProps が隠すのに使う。型に関係なく）
    static pos(p) { return Math.round(p.x * 10) + '|' + Math.round(p.y * 10) + '|' + Math.round(p.z * 10); }
    // 続きからの形（配列。600 個で 約 30 KB）。穴の R は中心・軸・幅の半分と cfg（breach.height / wall）から作り直す
    static pack(r) {
      const o = r.owner, X = r2(r.x), Y = r2(r.y), Z = r2(r.z);
      if (r.type === 'breach') {
        const half = r2(r.ax === 'x' ? (r.R.z1 - r.R.z0) / 2 : (r.R.x1 - r.R.x0) / 2);
        return ['b', X, Y, Z, r.ax === 'x' ? 0 : 1, r.n, half, r2(r.R.y1 - r.y), r2(r.ax === 'x' ? (r.R.x1 - r.R.x0) / 2 : (r.R.z1 - r.R.z0) / 2), r.mat || 'concrete', r.rubbleH, o];
      }
      if (r.type === 'tank') return ['t', X, Y, Z, r.ptype, r.r, r.wreckH, r.wreckR, o];
      if (r.type === 'prop') return ['p', X, Y, Z, r.ptype, r.r, o];
      return null;
    }
    static unpack(a) {
      if (!Array.isArray(a) || a.length < 7) return null;
      const n = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN);
      const x = n(a[1]), y = n(a[2]), z = n(a[3]), owner = a[a.length - 1];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || typeof owner !== 'string' || !/^-?\d+_-?\d+$/.test(owner)) return null;
      if (a[0] === 'b' && a.length >= 12) {
        const ax = a[4] === 0 ? 'x' : 'z', half = n(a[6]), H = n(a[7]), ht = n(a[8]), rubbleH = n(a[10]);
        if (!(half > 0 && half < 5 && H > 0 && H < 6 && ht > 0 && ht < 2 && rubbleH > 0 && rubbleH < 1) || typeof a[9] !== 'string') return null;
        const R = ax === 'x' ? { x0: x - ht, x1: x + ht, y0: y + 0.02, y1: y + H, z0: z - half, z1: z + half } : { x0: x - half, x1: x + half, y0: y + 0.02, y1: y + H, z0: z - ht, z1: z + ht };
        return { type: 'breach', k: key('b', x, y, z), x, y, z, ax, n: a[5] < 0 ? -1 : 1, R, rubbleH, mat: a[9], owner };
      }
      if ((a[0] === 'p' || a[0] === 't') && typeof a[4] === 'string') {
        const r = n(a[5]);
        if (!(r > 0 && r < 5)) return null;
        if (a[0] === 'p') return { type: 'prop', k: key('p', x, y, z), x, y, z, ptype: a[4], r, owner };
        const wh = n(a[6]), wr = n(a[7]);
        if (!(wh > 0 && wh <= 1 && wr > 0 && wr < 5)) return null;
        return { type: 'tank', k: key('t', x, y, z), x, y, z, ptype: a[4], r, wreckH: wh, wreckR: wr, owner };
      }
      return null;
    }
  }

  const Destruct = { F, key, box, subsets, subtract, planBreach, propBoxes, planProp, planTank, tankLadders, derive, deriveAll, filterNav, Registry, isShell };
  Destruct.moduleSource = () => destructModule.toString();
  MR.Destruct = Destruct;
  if (typeof module !== 'undefined' && module.exports) module.exports = Destruct;
})(typeof window !== 'undefined' ? window : globalThis);
