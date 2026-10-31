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
    // 外壁の材質（MR.Facade.boxParams）: 区画の見た目と、元の箱の下端・上端（窓の段と屋上の帯がずれない。b17 の検証 S6）
    if (src.lot != null) o.lot = src.lot;
    o.base = src.base != null ? src.base : (src.y || 0);
    o.top0 = src.top0 != null ? src.top0 : (src.y || 0) + src.h;
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
  //   cfg.rect = { s0, s1, y0, y1 }（銃の穴 = destruct-2 R3: 面の横の位置 s と高さ。面の中に収め、下端が床から snapFloor m 以内なら床まで）
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
    const RC = cfg.rect || null;
    let half, sc;
    if (RC) {
      const a = Math.max(RC.s0, f0 + minFace), c = Math.min(RC.s1, f1 - minFace);
      if (c - a < 0.4) return null;
      half = r2((c - a) / 2); sc = r2((a + c) / 2);
    } else {
      if (f1 - f0 < W * 0.6 + 2 * minFace) return null; // 狭すぎる面（柱だけ）は穴にしない
      half = Math.min(W / 2, (f1 - f0) / 2 - minFace);
      sc = r2(Math.max(f0 + minFace + half, Math.min(f1 - minFace - half, hs))); // 0.01 m に丸める（続きからの形と同じ鍵）
    }
    // 床: 同じ面の高い外壁の箱の下端
    let y0 = -Infinity;
    for (const b of same) {
      const a = sOf(b) - lenOf(b) / 2, c = sOf(b) + lenOf(b) / 2;
      if (c < sc - half - 0.5 || a > sc + half + 0.5) continue;
      if (b.h >= 1.8 && b.y <= hit.y + 0.4 && b.y > y0) y0 = b.y;
    }
    if (!isFinite(y0)) return null;
    let y1 = y0 + H;
    if (RC) { // 銃の穴: 床から snapFloor m 以内なら床まで、高さは H まで
      const sf = cfg.snapFloor >= 0 ? cfg.snapFloor : 0.6;
      const b0 = RC.y0 >= y0 - 0.05 && RC.y0 - y0 <= sf ? y0 : r2(RC.y0); // 床より下から始まる矩形は床へ上げない
      y1 = r2(Math.min(RC.y1, b0 + H)); y0 = b0;
      if (y1 - y0 < 0.4) return null;
    }
    const ht = wt / 2 + 0.2;
    const R = ax === 'x'
      ? { x0: plane - ht, x1: plane + ht, y0: y0 + 0.02, y1, z0: sc - half, z1: sc + half }
      : { x0: sc - half, x1: sc + half, y0: y0 + 0.02, y1, z0: plane - ht, z1: plane + ht };
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
    // 銃の穴は上へだけ育つと同じ鍵のまま大きくなるので、穴の矩形も入れる（b16.1: 入れないと同じ鍵・同じ rm の前の穴の効き目を返した）
    for (const r of recs) if (r.type !== 'crater') sig += recSig(r) + (r.rm >= 0 ? ':' + r.rm : '') + (r.type === 'collapse' ? '#' + r.stage + '@' + r.C.y0 : '') + ';';
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
    // がれき（R2）: 記録ごとの山（rm で決めた物だけ）
    for (const r of recs) {
      if (!(r.rm >= 0)) continue;
      for (const b of rubbleBoxes(r, Destruct.rubbleCfg)) { add.push(b); rects.push({ x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2 }); }
    }
    // 倒壊（destruct-3 M3）: ほかの記録の後に。元の箱も、穴などで足した箱も、区画の外す範囲 C にかかれば外して残りだけ
    let ramps = null;
    for (const r of recs) {
      if (r.type !== 'collapse') continue;
      const C = r.C, cut = { x0: C.x0, x1: C.x1, z0: C.z0, z1: C.z1, y0: C.y0, y1: 1e5 };
      const keep = [];
      for (const b of add) {
        if (b.coll === r.k) { keep.push(b); continue; }
        // 前の穴・小物のがれき（dx 5）と山: 上の階の物は外す範囲の中なら全部外す（切ると宙に浮く。b17 の検証 B2 (b)）
        if ((b.dx === 5 || b.cat === 'rubble') && inC(b, C, 0.6)) continue;
        if (b.coll || !ofLot(b, r, 0.6) || !overC(b, C)) { keep.push(b); continue; }
        const B = box(b);
        if (B.x0 >= C.x0 - 0.02 && B.x1 <= C.x1 + 0.02 && B.z0 >= C.z0 - 0.02 && B.z1 <= C.z1 + 0.02 && B.y0 >= C.y0 - 0.02) continue;
        const pieces = []; subtract(b, cut, pieces); for (const q of pieces) keep.push(Object.assign(q, { dx: b.dx }));
      }
      add.length = 0; for (const b of keep) add.push(b);
      const eff = collapseEffect(data, r);
      // 元の箱の引き算の残り（穴などで先に外した箱の残りは、その穴の残りを上で切ったので足さない）
      for (const b of eff.add) if (!(b.src0 && remove.has(b.src0))) add.push(b);
      for (const b of eff.remove) remove.add(b);
      for (const l of eff.ladders) ladders.add(l);
      if (eff.ramps.size) { ramps = ramps || new Set(); for (const q of eff.ramps) ramps.add(q); }
      rects.push({ x0: C.x0 - 0.5, z0: C.z0 - 0.5, x1: C.x1 + 0.5, z1: C.z1 + 0.5 });
    }
    res = { remove, add, ladders, rects, ramps };
    m.set(sig, res);
    return res;
  }

  // 覚える鍵: 記録の鍵 + 穴の矩形（銃の穴は上へだけ育つと同じ鍵のまま大きくなる。b16.1）。記録に覚える（b17: deriveAll が毎回
  //   文字列を作っていた）。穴が育つときは新しい記録（R を作り直す）なので、同じ記録の R は変わらない（_sigR で確かめる）
  function recSig(r) {
    if (r._sig !== undefined && r._sigR === r.R) return r._sig;
    r._sigR = r.R;
    return (r._sig = r.R ? r.k + '@' + r.R.x0 + ',' + r.R.x1 + ',' + r.R.y0 + ',' + r.R.y1 + ',' + r.R.z0 + ',' + r.R.z1 : r.k);
  }
  const DER_MAX = 256; // boxes ごとに覚える効き目の数（b17: 育つ銃の穴は矩形ごとに増えていた。超えたら古い物から捨てる）

  // 記録 1 つの効き目（同じ boxes の配列ごとに覚える）。穴の残り（dx 1）はこの穴だけで引いた形（まとめた形は deriveAll）
  const derCache = new WeakMap();
  function derive(boxes, rec) {
    let m = derCache.get(boxes);
    if (!m) { m = new Map(); derCache.set(boxes, m); }
    const mk = recSig(rec); // 鍵 + 穴の矩形（b16.1: 上へ育った銃の穴は同じ鍵のまま大きい = 鍵だけだと前の穴の縁が残った）
    let r = m.get(mk);
    if (r) return r;
    if (m.size >= DER_MAX) m.delete(m.keys().next().value);
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
        // destruct-3 M2: 上の縁の床スラブの割れた縁（壁の外と中へ少し出る）と、垂れ下がる・横から突き出る鉄筋（見た目だけ = NOCOL、dx 6）
        if (rec.detail !== false && y1 - y0 > 1.2) {
          const ext = 0.14, slabH = 0.22, n = rec.n || 1;
          const lip = (a0, a1, c0, c1, b0, b1, mat) => add.push(ax === 'x'
            ? { x: r2((c0 + c1) / 2), y: r2(b0), z: r2((a0 + a1) / 2), w: r2(c1 - c0), h: r2(b1 - b0), d: r2(a1 - a0), mat, cat: 'exterior', f: F.NOCOL, dx: 6 }
            : { x: r2((a0 + a1) / 2), y: r2(b0), z: r2((c0 + c1) / 2), w: r2(a1 - a0), h: r2(b1 - b0), d: r2(c1 - c0), mat, cat: 'exterior', f: F.NOCOL, dx: 6 });
          // スラブの縁: 穴の幅いっぱい（ところどころ欠ける）、壁の厚さ + 外へ ext・中へ ext
          for (let u = s0 + 0.05; u < s1 - 0.1;) {
            const ww = Math.min(s1 - 0.05, u + 0.4 + rnd() * 0.7);
            if (rnd() < 0.82) { const dy = (rnd() - 0.5) * 0.06; lip(u, ww, pc - wt / 2 - ext * (0.4 + rnd() * 0.6), pc + wt / 2 + ext * (0.4 + rnd() * 0.6), y1 - slabH + dy, y1 + 0.02 + dy, 'concrete'); }
            u = ww + 0.02;
          }
          // 垂れ下がる鉄筋（上の縁から）
          const rebarN = 3 + Math.floor(rnd() * 4), rt = 0.035, face = pc + n * (wt / 2 + 0.02);
          for (let i = 0; i < rebarN; i++) {
            const u = s0 + 0.2 + rnd() * Math.max(0.1, s1 - s0 - 0.4), L = 0.25 + rnd() * 0.7, c = face - n * rnd() * wt;
            lip(u, u + rt, c - rt / 2, c + rt / 2, y1 - slabH - L, y1 - slabH + 0.05, 'metalDark');
          }
          // 横の縁から突き出る鉄筋（穴の中へ）
          for (let i = 0, m = 2 + Math.floor(rnd() * 3); i < m; i++) {
            const side = rnd() < 0.5, y = y0 + 0.3 + rnd() * Math.max(0.1, y1 - y0 - 0.8), L = 0.2 + rnd() * 0.45, c = pc + (rnd() - 0.5) * wt * 0.6;
            if (side) lip(s0, s0 + L, c - rt / 2, c + rt / 2, y, y + rt, 'metalDark'); else lip(s1 - L, s1, c - rt / 2, c + rt / 2, y, y + rt, 'metalDark');
          }
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
    m.set(mk, r);
    return r;
  }

  // ---------- がれき（destruct-2 R2）----------
  //   山の候補は記録の鍵から決まる（乱数は鍵のハッシュ）。どれを使うかは記録の rm（山ごとに 6 bit: 下の 2 bit = 0 なし・1 そのまま・
  //   2 小さく・3 見た目だけ、上の 4 bit = 足元の高さ（記録の y + 0.1 − dy × 0.05 m。外の通りは穴の床より低いことがある））
  //   = 置くときに当たり判定・扉・階段・梯子・家具で確かめて決め、続きからに持って行く（同じ山が戻る）。
  //   当たり判定の箱は cat 'rubble'・WALK（低い山は NOLOS = 弾が通る、cfg.blockH より高い山は弾を止める）・dx 5（近景の 'dx' の形には描かない）
  //   cfg = game.json の destruct.rubble
  const RUB = { NONE: 0, FULL: 1, SMALL: 2, LOOK: 3 };
  function seeded(k, salt) {
    let h0 = 2166136261 ^ (salt | 0);
    for (let i = 0; i < k.length; i++) h0 = Math.imul(h0 ^ k.charCodeAt(i), 16777619);
    return () => { h0 = (h0 + 0x6D2B79F5) | 0; let t = Math.imul(h0 ^ (h0 >>> 15), h0 | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const lerp = (a, r) => a[0] + (a[1] - a[0]) * r;
  // 候補 [{ kind: 'low' | 'mound', inside, v: [そのまま, 小さく] }]（v は { x0, x1, y0, y1, z0, z1 }）
  function planRubble(rec, cfg) {
    cfg = cfg || {};
    let P = rec._plan; // 記録に覚える（モジュールに持たない = 「もう一度」の後に残らない）
    if (P) return P;
    const rnd = seeded(rec.k, 0x52554242);
    const low = cfg.low || [0.18, 0.35], mound = cfg.mound || [0.6, 1.0];
    const out = [];
    const bx = (cx, cz, sx, sz, y, h) => ({ x0: r2(cx - sx / 2), x1: r2(cx + sx / 2), y0: r2(y), y1: r2(y + h), z0: r2(cz - sz / 2), z1: r2(cz + sz / 2) });
    if (rec.type === 'breach' && (rec.R.y1 - rec.R.y0 < (cfg.minHoleH || 1.9) || (rec.ax === 'x' ? rec.R.z1 - rec.R.z0 : rec.R.x1 - rec.R.x0) < (cfg.minHoleW || 1.8))) {
      // 小さな銃の穴（R3）: 山なし（止まった破片の欠片だけ）
    } else if (rec.type === 'breach') {
      const R = rec.R, ax = rec.ax, n = rec.n;
      const W = ax === 'x' ? R.z1 - R.z0 : R.x1 - R.x0, tc = ax === 'x' ? (R.z0 + R.z1) / 2 : (R.x0 + R.x1) / 2;
      const fOut = ax === 'x' ? (n > 0 ? R.x1 : R.x0) : (n > 0 ? R.z1 : R.z0), fIn = ax === 'x' ? (n > 0 ? R.x0 : R.x1) : (n > 0 ? R.z0 : R.z1);
      // (法線の位置 a, 横の位置 t, 法線の長さ sa, 横の長さ st)
      const put = (a, t, sa, st, h) => ax === 'x' ? bx(a, t, sa, st, rec.y, h) : bx(t, a, st, sa, rec.y, h);
      for (const side of [1, -1]) { // 1 外・-1 中
        const face = side > 0 ? fOut : fIn, sg = n * side;
        const dep = lerp([0.8, 1.1], rnd()), wid = W * lerp([0.7, 0.95], rnd()), h = lerp(low, rnd()) * (side > 0 ? 1 : 0.85);
        out.push({ kind: 'low', inside: side < 0, v: [put(face + sg * (0.05 + dep / 2), tc, dep, wid, h), put(face + sg * (0.05 + dep * 0.25), tc, dep * 0.5, wid * 0.7, h * 0.6)] });
      }
      for (const side of [1, -1]) {
        const face = side > 0 ? fOut : fIn, sg = n * side, lr = rnd() < 0.5 ? -1 : 1;
        const sz = lerp([0.8, 1.3], rnd()), h = lerp(mound, rnd()) * (side > 0 ? 1 : 0.9);
        const t = tc + lr * (W / 2 + 0.3 + sz / 2), a = face + sg * (0.15 + sz / 2);
        const t2 = tc + lr * (W / 2 + 0.3 + sz * 0.3), a2 = face + sg * (0.15 + sz * 0.3);
        out.push({ kind: 'mound', inside: side < 0, v: [put(a, t, sz, sz, h), put(a2, t2, sz * 0.6, sz * 0.6, h * 0.55)] });
      }
    } else if (rec.type === 'tank') {
      const base = (rec.wreckR || 1.5) + 0.4;
      for (let i = 0; i < 3; i++) {
        const ang = rnd() * 6.283, d = base + rnd() * 0.8, s = lerp([0.6, 1.1], rnd()), h = lerp(low, rnd()) * 0.8;
        const cx = rec.x + Math.cos(ang) * d, cz = rec.z + Math.sin(ang) * d;
        out.push({ kind: 'low', inside: false, v: [bx(cx, cz, s, s * 0.8, rec.y, h), bx(cx, cz, s * 0.55, s * 0.45, rec.y, h * 0.6)] });
      }
      const ang = rnd() * 6.283, d = base + 0.2, s = lerp([0.8, 1.2], rnd()), h = lerp([0.45, 0.7], rnd());
      const cx = rec.x + Math.cos(ang) * d, cz = rec.z + Math.sin(ang) * d;
      out.push({ kind: 'mound', inside: false, v: [bx(cx, cz, s, s, rec.y, h), bx(cx, cz, s * 0.6, s * 0.6, rec.y, h * 0.55)] });
    } else if (rec.type === 'prop') {
      const s = 2 * (rec.r || 0.4) + 0.3, h = lerp([0.12, 0.22], rnd());
      out.push({ kind: 'low', inside: false, v: [bx(rec.x, rec.z, s, s, rec.y, h), bx(rec.x, rec.z, s * 0.6, s * 0.6, rec.y, h * 0.6)] });
    }
    P = out;
    Object.defineProperty(rec, '_plan', { value: P, writable: true, configurable: true, enumerable: false });
    return P;
  }
  const slotMode = (rm, i) => (rm >>> (i * 6)) & 3;
  const slotY = (rec, i) => rec.y + 0.1 - ((rec.rm >>> (i * 6 + 2)) & 15) * 0.05;
  const slotBits = (mode, dy) => (mode & 3) | ((dy & 15) << 2);
  // 記録 rec のがれきの当たり判定の箱（rm が無ければ []）。rec に覚える（rm が変わったら作り直す）
  function rubbleBoxes(rec, cfg) {
    if (!(rec.rm >= 0)) return [];
    if (rec._rb && rec._rbm === rec.rm) return rec._rb;
    const P = planRubble(rec, cfg), out = [], blockH = cfg && cfg.blockH > 0 ? cfg.blockH : 0.5;
    for (let i = 0; i < P.length; i++) {
      const m = slotMode(rec.rm, i);
      if (m !== RUB.FULL && m !== RUB.SMALL) continue;
      const B = P[i].v[m - 1], h = B.y1 - B.y0;
      out.push({ x: r2((B.x0 + B.x1) / 2), y: r2(slotY(rec, i)), z: r2((B.z0 + B.z1) / 2), w: r2(B.x1 - B.x0), h: r2(h), d: r2(B.z1 - B.z0), mat: 'rubble', cat: 'rubble', f: F.WALK | (h > blockH ? 0 : F.NOLOS), dx: 5 });
    }
    rec._rb = out; rec._rbm = rec.rm;
    return out;
  }

  // チャンクのデータの写し（boxes と ladders だけ入れ替える。ほかは同じ物を指す）
  function filterNav(data, recs) {
    if (!recs || !recs.length) return data;
    const d = deriveAll(data, recs);
    if (!d.remove.size && !d.add.length && !d.ladders.size && !(d.ramps && d.ramps.size)) return data;
    const out = Object.assign({}, data);
    const boxes = data.boxes || [], nb = [];
    for (let i = 0; i < boxes.length; i++) if (!d.remove.has(boxes[i])) nb.push(boxes[i]);
    for (const b of d.add) nb.push(b);
    out.boxes = nb;
    if (d.ladders.size) out.ladders = (data.ladders || []).filter((l) => !d.ladders.has(l));
    if (d.ramps && d.ramps.size) out.ramps = (data.ramps || []).filter((q) => !d.ramps.has(q));
    out.dxFiltered = true;
    return out;
  }

  // 続きからの rm（がれきの選び方）: 新しい形（長さ len）の i 番目。古い形・-1・壊れた値は undefined（置くときに決め直す）
  function rmOf(a, len, i) { const v = a.length === len ? a[i] : undefined; return typeof v === 'number' && v >= 0 && v < 16777216 && (v | 0) === v ? v : undefined; }

  // ---------- 記録 ----------
  // cfg = { cap（全部の記録の上限）, repairAfter（秒。持ち主のチャンクが近景に無い間がこれを超えると直す。0 / 無し = 直さない）,
  //         farCap（上限で外した穴の遠景の箱 far の上限）, hardCap（守る記録も外し始める数。既定 cap × 1.5）}
  //   上限を超えたら focus（{ x, z }。プレイヤー）から一番遠い記録を外す（小物が先、穴・給水塔は後）。focus から keepNear m 以内の記録と
  //   protect(owner) が true の持ち主の記録は外さない（近景にある = 見えている穴は閉じない）。守る物しか無ければ hardCap まで越えてよい。外した穴は far に箱だけ残す（遠景の暗い穴）
  class Registry {
    constructor(cfg) {
      cfg = cfg || {};
      this.cap = cfg.cap > 0 ? cfg.cap | 0 : 3000;
      this.hardCap = cfg.hardCap > 0 ? cfg.hardCap | 0 : Math.round(this.cap * 1.5);
      this.farCap = cfg.farCap >= 0 ? cfg.farCap | 0 : 512;
      this.repairAfter = cfg.repairAfter > 0 ? cfg.repairAfter : 0;
      this.focus = null;         // { x, z }（呼ぶ側が置く）
      this.keepNear = cfg.keepNear > 0 ? cfg.keepNear : 0; // focus からこの m 以内の記録は外さない
      this.protect = null;       // (owner) → true なら外さない（近景にある持ち主）
      this.far = [];             // 外した穴の箱 [x0, y0, z0, x1, y1, z1]
      this.recs = new Map();     // 鍵 → 記録
      this.owners = new Map();   // 持ち主 → { recs: [記録], seen（最後に近景にあった時刻）}
      this.props = new Set();    // 壊れた小物の場所の鍵（Registry.pos。CityProps が隠す）
      this.ver = 0;              // 変わるたびに増える
      this.stats = { added: 0, repaired: 0, evicted: 0, overCap: 0 };
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
        const victim = this._victim(rec, this.recs.size <= this.hardCap);
        if (!victim) { this.stats.overCap++; break; }
        this.remove(victim.k);
        this.stats.evicted++;
        if (victim.type === 'breach' && victim.R) this._farAdd(victim.R);
        if (onRepair) onRepair(victim);
      }
      return true;
    }
    // 外す記録: 小物 → 穴・給水塔の順に、focus から一番遠いもの。guard なら protect の持ち主は外さない（無ければ null）
    _victim(skip, guard) {
      const F = this.focus, P = guard ? this.protect : null, KN = guard && F ? this.keepNear : 0;
      let best = null, bs = -1;
      const pd = new Map();
      for (const r of this.recs.values()) {
        if (r === skip || r.type === 'collapse') continue; // 倒れた建物は外さない（直らない・遠景の箱も無い）
        const d = F ? Math.hypot(r.x - F.x, r.z - F.z) : 0;
        if (d < KN) continue;
        if (P) {
          let pr = pd.get(r.owner);
          if (pr === undefined) { pr = !!P(r.owner); pd.set(r.owner, pr); }
          if (pr) continue;
        }
        const s = d + (r.type === 'prop' ? 1e7 : 0) + (F ? 0 : -r.t); // 遠い小物 → 遠い穴（focus が無ければ古い順）
        if (s > bs) { bs = s; best = r; }
      }
      return best;
    }
    _farAdd(R) {
      if (!(this.farCap > 0)) return;
      this.far.push([r2(R.x0), r2(R.y0), r2(R.z0), r2(R.x1), r2(R.y1), r2(R.z1)]);
      if (this.far.length > this.farCap) {
        const F = this.focus;
        let k = 0;
        if (F) { let bd = -1; for (let i = 0; i < this.far.length; i++) { const f = this.far[i], d = Math.hypot((f[0] + f[3]) / 2 - F.x, (f[2] + f[5]) / 2 - F.z); if (d > bd) { bd = d; k = i; } } }
        this.far.splice(k, 1);
      }
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
      if (!(this.repairAfter > 0)) return 0; // 直さない（destruct-2 R1。テストは repairAfter を入れて呼ぶ）
      for (const [owner, o] of this.owners) {
        if (now - o.seen < this.repairAfter) continue;
        for (const r of o.recs.slice()) { this.remove(r.k); n++; if (onRepair) onRepair(r); }
        this.owners.delete(owner);
      }
      this.stats.repaired += n;
      return n;
    }
    // 続きから（session の dz）: (x, z) に近い n 個の [...pack(記録), 残りの秒（直るまで。直さないなら 0）] + 遠景の穴 ['f', x0, y0, z0, x1, y1, z1]
    snapshot(x, z, now, n) {
      const all = [];
      for (const r of this.recs.values()) {
        const o = this.owners.get(r.owner);
        const left = this.repairAfter > 0 ? Math.max(1, Math.round(this.repairAfter - (now - (o ? o.seen : now)))) : 0;
        all.push([Math.hypot(r.x - x, r.z - z), r, left]);
      }
      all.sort((a, b) => a[0] - b[0]);
      const out = [];
      for (let i = 0; i < all.length && out.length < n; i++) { const pk = Registry.pack(all[i][1]); if (pk) { pk.push(all[i][2]); out.push(pk); } }
      let nf = 0; // 遠景の穴は farCap 個まで（入らなかった近くの穴が先）
      for (let i = n; i < all.length && nf < this.farCap; i++) if (all[i][1].type === 'breach') { out.push(['f'].concat(Registry._box6(all[i][1].R))); nf++; }
      for (let i = 0; i < this.far.length && nf < this.farCap; i++, nf++) out.push(['f'].concat(this.far[i]));
      return out;
    }
    static _box6(R) { return [r2(R.x0), r2(R.y0), r2(R.z0), r2(R.x1), r2(R.y1), r2(R.z1)]; }
    _restoreFar(it) {
      const v = it.slice(1, 7).map(Number);
      if (v.length !== 6 || !v.every(isFinite) || !(v[3] > v[0] && v[4] > v[1] && v[5] > v[2]) || v[3] - v[0] > 10 || v[5] - v[2] > 10) return;
      if (this.far.length < this.farCap) this.far.push(v);
    }
    // 戻す（記録の形のまま。seen = now − (repairAfter − left)）
    restore(list, now) {
      let n = 0;
      for (const it of list || []) {
        if (Array.isArray(it) && it[0] === 'f') { this._restoreFar(it); continue; }
        if (!Array.isArray(it) || it.length < 8) continue;
        const left = +it[it.length - 1];
        const rec = Registry.unpack(it.slice(0, -1));
        if (!rec || this.recs.has(rec.k)) continue;
        this.add(rec, rec.owner, now);
        const o = this.owners.get(rec.owner);
        if (!(this.repairAfter > 0)) { n++; continue; } // 直さない: 古い版の残りの秒は見ない
        const seen = now - (this.repairAfter - Math.min(this.repairAfter, Math.max(1, isFinite(left) ? left : this.repairAfter)));
        if (o && seen < o.seen) o.seen = seen;
        n++;
      }
      return n;
    }
    clear() { this.recs.clear(); this.owners.clear(); this.props.clear(); this.far.length = 0; this.ver++; }
    // 小物の場所の鍵（CityProps が隠すのに使う。型に関係なく）
    static pos(p) { return Math.round(p.x * 10) + '|' + Math.round(p.y * 10) + '|' + Math.round(p.z * 10); }
    // 続きからの形（配列。600 個で 約 30 KB）。穴の R は中心・軸・幅の半分と cfg（breach.height / wall）から作り直す
    static pack(r) {
      const o = r.owner, X = r2(r.x), Y = r2(r.y), Z = r2(r.z);
      if (r.type === 'breach') {
        const half = r2(r.ax === 'x' ? (r.R.z1 - r.R.z0) / 2 : (r.R.x1 - r.R.x0) / 2);
        return ['b', X, Y, Z, r.ax === 'x' ? 0 : 1, r.n, half, r2(r.R.y1 - r.y), r2(r.ax === 'x' ? (r.R.x1 - r.R.x0) / 2 : (r.R.z1 - r.R.z0) / 2), r.mat || 'concrete', r.rubbleH, r.rm >= 0 ? r.rm : -1, o];
      }
      if (r.type === 'collapse') {
        const R = r.R, C = r.C;
        return ['c', X, Y, Z, r.lid, r.lot, r.stage, r2(R.x0), r2(R.z0), r2(R.x1), r2(R.z1), r2(C.x0), r2(C.z0), r2(C.x1), r2(C.z1), r2(C.y0), r2(r.top), r2(r.fh), r.tall ? 1 : 0, r2(r.mound), r.kind || '', o];
      }
      if (r.type === 'tank') return ['t', X, Y, Z, r.ptype, r.r, r.wreckH, r.wreckR, r.rm >= 0 ? r.rm : -1, o];
      if (r.type === 'prop') return ['p', X, Y, Z, r.ptype, r.r, r.rm >= 0 ? r.rm : -1, o];
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
        return { type: 'breach', k: key('b', x, y, z), x, y, z, ax, n: a[5] < 0 ? -1 : 1, R, rubbleH, mat: a[9], owner, rm: rmOf(a, 13, 11) };
      }
      if (a[0] === 'c' && a.length >= 22 && typeof a[4] === 'string') {
        const v = a.slice(5, 20).map(n);
        if (!v.every(isFinite) || (v[1] !== 1 && v[1] !== 2) || !(v[4] > v[2] && v[5] > v[3] && v[9] > v[7] && v[8] > v[6])) return null;
        const R = { x0: v[2], z0: v[3], x1: v[4], z1: v[5] }, C = { x0: v[6], z0: v[7], x1: v[8], z1: v[9], y0: v[10] };
        if (R.x1 - R.x0 > 400 || R.z1 - R.z0 > 400) return null;
        return { type: 'collapse', k: 'c|' + a[4], lot: v[0] | 0, lid: a[4], stage: v[1], x, y, z, R, C, top: v[11], H: v[11] - y, fh: v[12], tall: v[13] === 1, mound: v[14], kind: typeof a[20] === 'string' ? a[20] : '', owner };
      }
      if ((a[0] === 'p' || a[0] === 't') && typeof a[4] === 'string') {
        const r = n(a[5]);
        if (!(r > 0 && r < 5)) return null;
        if (a[0] === 'p') return { type: 'prop', k: key('p', x, y, z), x, y, z, ptype: a[4], r, owner, rm: rmOf(a, 8, 6) };
        const wh = n(a[6]), wr = n(a[7]);
        if (!(wh > 0 && wh <= 1 && wr > 0 && wr < 5)) return null;
        return { type: 'tank', k: key('t', x, y, z), x, y, z, ptype: a[4], r, wreckH: wh, wreckR: wr, owner, rm: rmOf(a, 10, 8) };
      }
      return null;
    }
  }

  // ---------- 倒壊（destruct-3 M3。v1 の街の区画 L = city.lots[i]）----------
  // 区画の構造: 段 L.tiers [[x0, z0, x1, z1, y0, y1] …]・地面 base（一番下の段の y0）・高さ H（一番上の段の y1 − base）・階 L.fh。
  //   planCollapse(L, stage, hint, cfg) → 記録 { type: 'collapse', k: 'c|<L.id>', lot: L.i, lid, stage（1 = 一部・2 = 全部）, x, y（地面）, z, R（区画の矩形）,
  //   C（外す範囲 { x0, z0, x1, z1, y0 } = この高さより上）, top（がれきの山の上面）, tall（高い塔: 上だけ）, fh, H }
  //   効き目（collapseEffect）: 区画の矩形 ± 0.2 m に中心がある箱（道・歩道・がれき・小物の外）のうち C の中は外し、C にかかる箱は引き算の残り。
  //   スロープ・梯子は C にかかれば外す。山の箱（dx 5、cat rubble、WALK）を足す。決定的（区画と段階だけで決まる。乱数は鍵の hash）
  const COLL = { partialAt: 0.55, tallFrom: 120, lowFrom: 40, tallKeep: 0.45, partialK: 0.55, moundK: 0.12, moundMin: 1.4, moundMax: 7, edge: 0.2 };
  function lotBase(L) { let y = Infinity; for (const t of L.tiers) if (t[4] < y) y = t[4]; return isFinite(y) ? y : 0; }
  function lotTop(L) { let y = -Infinity; for (const t of L.tiers) if (t[5] > y) y = t[5]; return isFinite(y) ? y : 0; }
  function lotHP(L, cfg) {
    cfg = cfg || {};
    const per = (cfg.hpPerM2 || {})[L.kind] || (cfg.hpPerM2 || {}).default || 3;
    const area = (L.x1 - L.x0) * (L.z1 - L.z0), H = lotTop(L) - lotBase(L);
    return per * area * Math.max(0.6, Math.min(3, H / 30));
  }
  function hashStr(k) { let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619); return h >>> 0; }
  function planCollapse(L, stage, hint, cfg) {
    const c = Object.assign({}, COLL, cfg || {});
    const base = lotBase(L), top = lotTop(L), H = top - base, fh = L.fh > 0 ? L.fh : 3.6;
    const R = { x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z1 };
    const hx = hint && isFinite(hint.x) ? hint.x : (L.x0 + L.x1) / 2, hz = hint && isFinite(hint.z) ? hint.z : (L.z0 + L.z1) / 2, hy = hint && isFinite(hint.y) ? hint.y : base;
    const tall = H > c.tallFrom;
    let C, mound = 0;
    if (stage >= 2) {
      if (tall) C = { x0: R.x0, z0: R.z0, x1: R.x1, z1: R.z1, y0: r2(base + H * c.tallKeep) };
      else { C = { x0: R.x0, z0: R.z0, x1: R.x1, z1: R.z1, y0: r2(base + 0.3) }; mound = Math.max(c.moundMin, Math.min(c.moundMax, H * c.moundK + 1)); }
    } else if (H < c.lowFrom) {
      // 低い建物: ダメージの寄った隅の 4 分の 1（1 階は残る）
      const mx = (L.x0 + L.x1) / 2, mz = (L.z0 + L.z1) / 2;
      C = { x0: hx < mx ? R.x0 : mx, x1: hx < mx ? mx : R.x1, z0: hz < mz ? R.z0 : mz, z1: hz < mz ? mz : R.z1, y0: r2(base + fh) };
      mound = Math.min(1.6, Math.max(0.8, H * 0.06));
    } else {
      const y0 = Math.min(top - fh, Math.max(base + H * c.partialK, hy + 2 * fh));
      C = { x0: R.x0, z0: R.z0, x1: R.x1, z1: R.z1, y0: r2(y0) };
    }
    return { type: 'collapse', k: 'c|' + L.id, lot: L.i, lid: L.id, stage: stage >= 2 ? 2 : 1, x: r2((L.x0 + L.x1) / 2), y: r2(base), z: r2((L.z0 + L.z1) / 2),
      R, C, top: r2(top), H: r2(H), fh, tall, mound: r2(mound), kind: L.kind };
  }
  // 箱 b がこの区画の物か（中心が区画の矩形 ± edge、道・歩道・がれき・小物でない）
  function ofLot(b, rec, edge) {
    if (!b || b.cat === 'road' || b.cat === 'sidewalk' || b.cat === 'rubble' || b.cat === 'prop' || b.dx === 5) return false;
    const R = rec.R, e = edge == null ? COLL.edge : edge;
    return b.x > R.x0 - e && b.x < R.x1 + e && b.z > R.z0 - e && b.z < R.z1 + e;
  }
  // 箱 b の中心が外す範囲 C の矩形 ± e の中で、下端が C.y0 より上（倒れた後に宙に浮く物）
  function inC(b, C, e) {
    return b.x > C.x0 - e && b.x < C.x1 + e && b.z > C.z0 - e && b.z < C.z1 + e && (b.y || 0) >= C.y0 - 0.3 - 1e-3; // 1e-3: 0.15 >= 0.15000000000000002 が false（b17 の検証 R3）
  }
  // 箱 b と外す範囲 C（上は無限）の重なり
  function overC(b, C) {
    const B = box(b);
    return Math.min(B.x1, C.x1) - Math.max(B.x0, C.x0) > 0.02 && Math.min(B.z1, C.z1) - Math.max(B.z0, C.z0) > 0.02 && B.y1 > C.y0 + 0.02;
  }
  // がれきの山（全部倒れた・低い建物の一部）: 段になった箱 3 つ（真ん中ほど高い）。上面は top
  function moundBoxes(rec) {
    const out = [];
    if (!(rec.mound > 0)) return out;
    const C = rec.C, y = rec.stage >= 2 ? rec.y : C.y0, h = rec.mound;
    const w = C.x1 - C.x0, d = C.z1 - C.z0, cx = (C.x0 + C.x1) / 2, cz = (C.z0 + C.z1) / 2;
    const steps = [[0.92, 0.4], [0.68, 0.72], [0.42, 1]];
    for (const [k, f] of steps) {
      const hh = r2(h * f);
      out.push({ x: r2(cx), y: r2(y), z: r2(cz), w: r2(Math.max(1, w * k)), h: hh, d: r2(Math.max(1, d * k)), mat: 'concreteDark', cat: 'rubble', f: F.WALK | (hh > 0.5 ? 0 : F.NOLOS), dx: 5, coll: rec.k });
    }
    return out;
  }
  // 区画の倒壊の効き目（data = chunkFull の形、rec = planCollapse の記録）: { remove: Set<box>, add: [box], ramps: Set, ladders: Set }
  const collCache = new WeakMap();
  function collapseEffect(data, rec) {
    const boxes = data.boxes || [];
    let m = collCache.get(boxes);
    if (!m) { m = new Map(); collCache.set(boxes, m); }
    const sig = rec.k + '#' + rec.stage + '@' + rec.C.y0;
    let r = m.get(sig);
    if (r) return r;
    const remove = new Set(), add = [], ramps = new Set(), ladders = new Set(), C = rec.C;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      // 屋上・上の階の小物（空調・給水タンク・木箱 …）: 外す範囲の中なら外す（ofLot は小物を数えない = 宙に浮いて弾・視線・ヘリを止めた。b17 の検証 B2 (a)）
      if (b && b.cat === 'prop' && inC(b, C, 0.3)) { remove.add(b); continue; }
      if (!ofLot(b, rec) || !overC(b, C)) continue;
      remove.add(b);
      const B = box(b);
      if (B.x0 >= C.x0 - 0.02 && B.x1 <= C.x1 + 0.02 && B.z0 >= C.z0 - 0.02 && B.z1 <= C.z1 + 0.02 && B.y0 >= C.y0 - 0.02) continue; // 全部外す
      const n0 = add.length;
      subtract(b, { x0: C.x0, x1: C.x1, z0: C.z0, z1: C.z1, y0: C.y0, y1: 1e5 }, add);
      for (let j = n0; j < add.length; j++) add[j].src0 = b; // 元の箱（deriveAll: 穴で先に外した箱の残りは足さない）
    }
    for (const rp of data.ramps || []) {
      const x = rp.x != null ? rp.x : (rp.x0 + rp.x1) / 2, z = rp.z != null ? rp.z : (rp.z0 + rp.z1) / 2;
      const yt = Math.max(rp.y0 != null ? rp.y0 : 0, rp.y1 != null ? rp.y1 : 0);
      if (x > C.x0 - 0.2 && x < C.x1 + 0.2 && z > C.z0 - 0.2 && z < C.z1 + 0.2 && yt > C.y0) ramps.add(rp);
    }
    for (const l of data.ladders || []) if (l.x > C.x0 - 0.6 && l.x < C.x1 + 0.6 && l.z > C.z0 - 0.6 && l.z < C.z1 + 0.6 && l.y1 > C.y0) ladders.add(l);
    // 切った上の縁のぎざぎざ（見た目だけ = NOCOL、dx 4）: 切った面の上に壁の厚さの塊
    let h0 = hashStr(rec.k + rec.stage);
    const rnd = () => { h0 = (h0 + 0x6D2B79F5) | 0; let t = Math.imul(h0 ^ (h0 >>> 15), h0 | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    if (!(rec.stage >= 2 && !rec.tall)) {
      const cut = add.filter((b) => Math.abs(b.y + b.h - C.y0) < 0.05 && b.h > 0.5 && !(b.f & F.NOCOL));
      let n = 0;
      for (const b of cut) {
        if (n > 160) break;
        const along = b.w >= b.d, L = along ? b.w : b.d;
        for (let u = -L / 2 + 0.2; u < L / 2 - 0.3 && n <= 160; u += 0.6 + rnd() * 1.4) {
          const ww = 0.3 + rnd() * 0.9, hh = 0.2 + rnd() * (rec.tall ? 2.2 : 1.2), th = (along ? b.d : b.w) * (0.6 + rnd() * 0.4);
          add.push({ x: r2(along ? b.x + u + ww / 2 : b.x), y: r2(C.y0), z: r2(along ? b.z : b.z + u + ww / 2), w: r2(along ? ww : th), h: r2(hh), d: r2(along ? th : ww), mat: b.mat, cat: 'exterior', f: F.NOCOL, dx: 4 });
          n++;
        }
      }
    }
    for (const b of moundBoxes(rec)) add.push(b);
    r = { remove, add, ramps, ladders };
    m.set(sig, r);
    return r;
  }

  const Destruct = { F, key, box, subsets, subtract, planBreach, propBoxes, planProp, planTank, tankLadders, derive, deriveAll, filterNav, Registry, isShell,
    RUB, planRubble, rubbleBoxes, slotMode, slotY, slotBits, seeded, rubbleCfg: null,
    COLL, lotBase, lotTop, lotHP, planCollapse, collapseEffect, moundBoxes, ofLot };
  Destruct.moduleSource = () => destructModule.toString();
  MR.Destruct = Destruct;
  if (typeof module !== 'undefined' && module.exports) module.exports = Destruct;
})(typeof window !== 'undefined' ? window : globalThis);
