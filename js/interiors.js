// 入れる建物の中の家具（MR.Interiors）。THREE にも DOM にも依存しない（Node のテストでも動く）。サーバーは読まない。
//
// ■ 何をするか
//   chunkFull(cx, cz) の出力（buildings の記録・外壁 SHELL・床スラブ・間仕切り・階段・木箱・戦利品）から建物の間取りを組み立て直し
//   （citygen.js は変えない）、階ごとに 1 m の格子の上へ家具を置く。置いた後に、扉・間仕切りの隙間・階段口・戦利品・ロビーのスポーンが
//   家具の箱を入れた格子でつながっていることを確かめ（BFS）、つながらなければその階は空のまま。
//   格子の「ふさがっている」は Nav3D の歩行グラフと同じ式（nav3d.js の _graphGen: top > y + stepUp && bot < y + headroom、
//   agentRadius で膨らませた矩形にセルの中心が入る（境界を含む））をワールド座標でそのまま使う。
//
// ■ 出力（job / run）: { key, cx, cz, boxes, pieces, deco, panels, groups, stats }
//   boxes   当たり判定の箱 { x, y, z, w, h, d, mat, cat: 'furn', f, piece }（nav.addChunk(cx_cz#f, { cx, cz, boxes })）
//   pieces  Float32Array PSTRIDE（10）個ずつ（x0, y0, z0, x1, y1, z1, 種類, 向き, 色のずらし, 旗 1 = WALK・2 = 自由に立つ）: 家具 1 つ = 当たり判定の箱 1 つ。
//           遠くは箱 1 つ（bodyColor）、近くは expand() が部品（箱の中に収まる）と椅子・モニター（飾り）を出す
//   deco    Float32Array 7 個ずつ（x, y, z, w, h, d, 色。y は下端）: 当たり判定の無い飾りのうち家具に付かない物（植木）
//   panels  Float32Array 4 個ずつ（x, y, z, 向き 0 = 長い辺が x / 1 = z）: 天井の照明（1.2 × 0.6、下向き）
//   shell   Float32Array SSTRIDE（8）個ずつ（x0, y0, z0, x1, y1, z1, 色, 光り方）: 見た目だけの殻（天井の板）。emitShell
//   groups  建物の階ごと { id, k, y, top, x0, z0, x1, z1, ix0, iz0, ix1, iz1, cx, cz, p0, p1, d0, d1, q0, q1, b0, b1, use, variant }
//           （ix* = 外壁の内側。p = 家具の範囲、d = 飾り、q = 照明、s = 殻）
//   色は MR.Interiors.colors（"#rrggbb" の配列。interiors.json の palettes から作る）の番号
//
// ■ 高さのきまり（当たり判定がはねない）: 置いた後、階の天井までの高さ clear で
//   立てる家具（上面 + 背の高さ ≤ clear）は WALK、ほかは R + reachMargin（R = その階で届く一番高い足の高さ）より上へ上げる（入らなければ外す）。
//   R = max(S + stepUp, min(clear − height, S + apex))、S = その階の WALK の家具・木箱の一番高い上面、apex = jumpSpeed² / (2|gravity|)
(function (root) {
  const MR = root.MR || (root.MR = {});

  const NOCOL = 1, WALK = 4, SHELL = 16;
  // セルのビット
  const BLK = 1, WAL = 2, OTH = 4, FORB = 8, RES = 16, FURN = 32, DECO = 64;
  const VERSION = 1;

  function fnv(str, h) {
    h = (h == null ? 0x811c9dc5 : h) >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mix(a, b) {
    let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  function rng(seed) {
    let s = seed >>> 0;
    const f = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    return f;
  }
  function weighted(r, table) {
    let sum = 0;
    for (const k of Object.keys(table)) sum += table[k];
    let x = r * sum;
    for (const k of Object.keys(table)) { x -= table[k]; if (x < 0) return k; }
    return Object.keys(table)[0];
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;

  // ---------- 近くの部品（家具の箱の中の割合: a = 幅 0..1、b = 奥行き 0（背 / 壁の側）..1（前）、y = 高さの割合）----------
  // [a0, b0, a1, b1, y0, y1, 色の役]
  function shelfParts(levels, role) {
    const p = [[0, 0, 1, 0.06, 0, 1, 'metal'], [0, 0, 0.03, 1, 0, 1, 'metal'], [0.97, 0, 1, 1, 0, 1, 'metal']];
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i];
      p.push([0.03, 0.06, 0.97, 1, y, y + 0.012, 'metal']);
      if (i < levels.length - 1) {
        const top = levels[i + 1] - 0.03, h = Math.max(0.03, (top - y - 0.012) * 0.8);
        p.push([0.06, 0.12, 0.44, 0.9, y + 0.012, y + 0.012 + h, role + (i % 3 === 0 ? '' : '2')]);
        p.push([0.52, 0.2, 0.92, 0.85, y + 0.012, y + 0.012 + h * 0.75, role + (i % 2 ? '' : '3')]);
      }
    }
    return p;
  }
  // 自由に立つ棚（両側から見える: 背板の代わりに真ん中の薄い仕切り、物は両側）
  function shelfFreeParts(levels, role) {
    const p = [[0, 0.48, 1, 0.52, 0, 1, 'metal'], [0, 0, 0.03, 1, 0, 1, 'metal'], [0.97, 0, 1, 1, 0, 1, 'metal']];
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i];
      p.push([0.03, 0, 0.97, 1, y, y + 0.012, 'metal']);
      if (i < levels.length - 1) {
        const top = levels[i + 1] - 0.03, h = Math.max(0.03, (top - y - 0.012) * 0.8);
        p.push([0.06, 0.05, 0.44, 0.45, y + 0.012, y + 0.012 + h, role + (i % 3 === 0 ? '' : '2')]);
        p.push([0.52, 0.08, 0.92, 0.44, y + 0.012, y + 0.012 + h * 0.7, role + (i % 2 ? '' : '3')]);
        p.push([0.08, 0.55, 0.5, 0.93, y + 0.012, y + 0.012 + h * 0.85, role + (i % 2 ? '3' : '')]);
        p.push([0.56, 0.57, 0.94, 0.95, y + 0.012, y + 0.012 + h * 0.6, role + '2']);
      }
    }
    return p;
  }
  const PARTS = {
    desk_pod: [[0, 0, 1, 1, 0.94, 1, 'laminate'], [0, 0, 0.025, 1, 0, 0.94, 'leg'], [0.975, 0, 1, 1, 0, 0.94, 'leg'],
      [0.025, 0.485, 0.975, 0.515, 0.12, 0.94, 'leg'], [0.08, 0.06, 0.28, 0.42, 0, 0.94, 'metal'], [0.72, 0.58, 0.92, 0.94, 0, 0.94, 'metal']],
    pod_screen: [[0, 0, 1, 1, 0, 1, 'fabric']],
    // ブース 2 つ（4 × 2 マス）: 布の板 + 上の 2 割はすりガラス、角と真ん中の柱・上の枠（金属）、ふた（中は見えない = 当たり判定の箱を埋める）
    cubicle: (function () {
      const p = [];
      const fab = 0.78, top = 0.985;
      // 外の 4 面: 下の布 + 上のすりガラス
      p.push([0, 0, 1, 0.025, 0, fab, 'fabric'], [0, 0.975, 1, 1, 0, fab, 'fabric'], [0, 0.025, 0.012, 0.975, 0, fab, 'fabric'], [0.988, 0.025, 1, 0.975, 0, fab, 'fabric']);
      p.push([0, 0.004, 1, 0.02, fab, top, 'glass'], [0, 0.98, 1, 0.996, fab, top, 'glass'], [0.002, 0.025, 0.01, 0.975, fab, top, 'glass'], [0.99, 0.025, 0.998, 0.975, fab, top, 'glass']);
      // 真ん中の仕切り
      p.push([0.494, 0.025, 0.506, 0.975, 0, top, 'fabric2']);
      // 柱（角・真ん中）と上の枠・腰の帯
      for (const a of [0, 0.4925, 0.985]) for (const b of [0, 0.97]) p.push([a, b, a + 0.015, b + 0.03, 0, 1, 'metal_dark']);
      p.push([0, 0, 1, 0.03, top, 1, 'metal_dark'], [0, 0.97, 1, 1, top, 1, 'metal_dark'], [0, 0, 0.015, 1, top, 1, 'metal_dark'], [0.985, 0, 1, 1, top, 1, 'metal_dark']);
      p.push([0, 0, 1, 0.03, fab - 0.01, fab + 0.01, 'metal_dark'], [0, 0.97, 1, 1, fab - 0.01, fab + 0.01, 'metal_dark']);
      // ふた（明るい天板。中は見えない）
      p.push([0.015, 0.03, 0.985, 0.97, 0.975, 0.99, 'cap']);
      return p;
    })(),
    meeting_table: [[0, 0, 1, 1, 0.94, 1, 'wood'], [0.18, 0.3, 0.3, 0.7, 0, 0.94, 'leg'], [0.7, 0.3, 0.82, 0.7, 0, 0.94, 'leg'], [0.3, 0.46, 0.7, 0.54, 0.1, 0.2, 'leg']],
    filing: [[0, 0, 1, 1, 0, 1, 'metal'], [0.06, 0.985, 0.94, 1, 0.33, 0.345, 'metal_dark'], [0.06, 0.985, 0.94, 1, 0.66, 0.675, 'metal_dark'], [0, 0, 1, 1, 0.985, 1, 'metal_dark']],
    credenza: [[0, 0, 1, 1, 0, 0.95, 'wood'], [0, 0, 1, 1, 0.95, 1, 'laminate'], [0.49, 0.985, 0.51, 1, 0.08, 0.9, 'leg']],
    copier: [[0.05, 0.05, 0.95, 0.95, 0, 0.82, 'metal'], [0, 0, 1, 1, 0.82, 0.9, 'paper'], [0.08, 0.08, 0.92, 0.92, 0.9, 1, 'metal_dark']],
    shelf: shelfParts([0.02, 0.27, 0.52, 0.77, 0.985], 'paper'),
    shelf_1: shelfParts([0.02, 0.27, 0.52, 0.77, 0.985], 'paper'),
    shelf_free: shelfFreeParts([0.02, 0.27, 0.52, 0.77, 0.985], 'paper'),
    pallet: [[0, 0, 1, 1, 0, 0.3, 'pallet'], [0, 0, 1, 0.12, 0.3, 1, 'pallet'], [0, 0.44, 1, 0.56, 0.3, 1, 'pallet'], [0, 0.88, 1, 1, 0.3, 1, 'pallet']],
    pallet_low: [[0, 0, 1, 1, 0, 0.17, 'pallet'], [0.03, 0.03, 0.97, 0.97, 0.17, 1, 'box']],
    pallet_high: [[0, 0, 1, 1, 0, 0.08, 'pallet'], [0.03, 0.03, 0.97, 0.97, 0.08, 0.54, 'box'], [0.03, 0.03, 0.97, 0.97, 0.54, 0.98, 'box2'], [0.02, 0.02, 0.98, 0.98, 0.98, 1, 'wrap']],
    rack: (function () {
      const p = [[0, 0, 1, 0.03, 0, 1, 'deck']];
      for (const a of [0, 0.485, 0.97]) { p.push([a, 0.03, a + 0.03, 0.09, 0, 1, 'upright']); p.push([a, 0.91, a + 0.03, 0.97, 0, 1, 'upright']); }
      const lv = [0.02, 0.36, 0.69];
      for (let i = 0; i < lv.length; i++) {
        const y = lv[i];
        p.push([0, 0.03, 1, 0.09, y, y + 0.03, 'beam'], [0, 0.91, 1, 0.97, y, y + 0.03, 'beam'], [0.03, 0.09, 0.97, 0.91, y + 0.012, y + 0.02, 'deck']);
        p.push([0.05, 0.12, 0.46, 0.88, y + 0.03, y + 0.03 + 0.2, 'box' + (i === 1 ? '2' : '')]);
        p.push([0.53, 0.15, 0.94, 0.85, y + 0.03, y + 0.03 + (i === 2 ? 0.27 : 0.16), 'box' + (i === 0 ? '3' : '')]);
      }
      p.push([0, 0.03, 1, 0.97, 0.985, 1, 'beam']);
      return p;
    })(),
    workbench: [[0, 0, 1, 1, 0.93, 1, 'bench'], [0.02, 0.05, 0.06, 0.95, 0, 0.93, 'leg'], [0.94, 0.05, 0.98, 0.95, 0, 0.93, 'leg'], [0.06, 0.08, 0.94, 0.92, 0.15, 0.2, 'bench'],
      [0.1, 0.15, 0.3, 0.6, 0.2, 0.42, 'box']]
  };
  // ---- M2: 住まい・お店・ロビー ----
  const legs4 = (y1, role) => [[0.02, 0.02, 0.07, 0.07, 0, y1, role], [0.93, 0.02, 0.98, 0.07, 0, y1, role], [0.02, 0.93, 0.07, 0.98, 0, y1, role], [0.93, 0.93, 0.98, 0.98, 0, y1, role]];
  const sofaParts = [[0, 0, 1, 1, 0, 0.5, 'sofa'], [0, 0, 1, 0.3, 0.5, 1, 'sofa'], [0, 0.3, 0.1, 1, 0.5, 0.75, 'sofa2'], [0.9, 0.3, 1, 1, 0.5, 0.75, 'sofa2'],
    [0.1, 0.3, 0.9, 0.97, 0.5, 0.62, 'cushion']];
  Object.assign(PARTS, {
    sofa: sofaParts,
    armchair: sofaParts,
    coffee_table: [[0, 0, 1, 1, 0.85, 1, 'wood']].concat(legs4(0.85, 'leg')),
    bench: [[0, 0.1, 1, 0.9, 0.82, 1, 'wood'], [0.04, 0.15, 0.1, 0.85, 0, 0.82, 'leg'], [0.9, 0.15, 0.96, 0.85, 0, 0.82, 'leg']],
    tv_stand: [[0, 0, 1, 1, 0, 0.95, 'wood2'], [0, 0, 1, 1, 0.95, 1, 'wood'], [0.49, 0.97, 0.51, 1, 0.1, 0.85, 'leg']],
    bed: [[0, 0, 1, 1, 0, 0.45, 'wood'], [0, 0, 1, 0.07, 0.45, 1, 'wood2'], [0.03, 0.07, 0.97, 1, 0.45, 0.8, 'sheet'],
      [0.03, 0.4, 0.97, 1, 0.8, 0.92, 'blanket'], [0.08, 0.1, 0.46, 0.3, 0.8, 1, 'pillow'], [0.54, 0.1, 0.92, 0.3, 0.8, 1, 'pillow']],
    wardrobe: [[0, 0, 1, 1, 0, 0.97, 'wood2'], [0, 0, 1, 1, 0.97, 1, 'wood'], [0.495, 0.975, 0.505, 1, 0.03, 0.95, 'leg'], [0.42, 0.98, 0.46, 1, 0.45, 0.6, 'metal'], [0.54, 0.98, 0.58, 1, 0.45, 0.6, 'metal']],
    fridge: [[0, 0, 1, 1, 0, 1, 'appliance'], [0.02, 0.98, 0.98, 1, 0.6, 0.615, 'leg'], [0.85, 0.98, 0.9, 1, 0.65, 0.85, 'metal'], [0.85, 0.98, 0.9, 1, 0.35, 0.55, 'metal']],
    dresser: [[0, 0, 1, 1, 0, 0.95, 'wood2'], [0, 0, 1, 1, 0.95, 1, 'wood'], [0.04, 0.98, 0.96, 1, 0.32, 0.34, 'leg'], [0.04, 0.98, 0.96, 1, 0.64, 0.66, 'leg']],
    counter: [[0, 0.03, 1, 1, 0, 0.92, 'cabinet'], [0, 0, 1, 1, 0.92, 1, 'counter'], [0, 0.97, 1, 1, 0, 0.08, 'leg'],
      [0.33, 0.98, 0.335, 1, 0.1, 0.9, 'leg'], [0.665, 0.98, 0.67, 1, 0.1, 0.9, 'leg'], [0.1, 0.25, 0.3, 0.75, 0.97, 1, 'metal']],
    dining: [[0, 0, 1, 1, 0.94, 1, 'wood']].concat(legs4(0.94, 'wood2')),
    gondola: (function () {
      const p = [[0, 0, 1, 1, 0, 0.07, 'metal'], [0, 0.47, 1, 0.53, 0, 1, 'shelfback'], [0, 0, 0.02, 1, 0, 1, 'metal'], [0.98, 0, 1, 1, 0, 1, 'metal']];
      const lv = [0.07, 0.34, 0.6, 0.86];
      for (let i = 0; i < lv.length; i++) {
        const y = lv[i];
        p.push([0.02, 0.02, 0.98, 0.47, y, y + 0.015, 'metal'], [0.02, 0.53, 0.98, 0.98, y, y + 0.015, 'metal']);
        if (i < lv.length - 1) {
          const h = (lv[i + 1] - y) * 0.7;
          for (let q = 0; q < 4; q++) {
            const a0 = 0.04 + q * 0.24, a1 = a0 + 0.2, role = 'product' + (q === 0 ? '' : String(q + i));
            p.push([a0, 0.06, a1, 0.44, y + 0.015, y + 0.015 + h * (0.6 + 0.4 * ((q + i) % 2)), role]);
            p.push([a0, 0.56, a1, 0.94, y + 0.015, y + 0.015 + h * (0.6 + 0.4 * ((q + i + 1) % 2)), role]);
          }
        }
      }
      return p;
    })(),
    shop_counter: [[0, 0, 1, 1, 0, 0.94, 'counter_body'], [0, 0, 1, 1, 0.94, 1, 'counter'], [0.02, 0.97, 0.98, 1, 0.1, 0.85, 'accent']],
    display: [[0, 0, 1, 1, 0.7, 0.78, 'wood'], [0.05, 0.05, 0.95, 0.95, 0, 0.7, 'wood2'],
      [0.08, 0.1, 0.3, 0.45, 0.78, 1, 'product'], [0.4, 0.15, 0.62, 0.5, 0.78, 0.92, 'product2'], [0.7, 0.55, 0.92, 0.9, 0.78, 0.97, 'product3'], [0.12, 0.6, 0.45, 0.88, 0.78, 0.88, 'product4']],
    drinks_fridge: [[0, 0, 1, 1, 0, 1, 'appliance'], [0.03, 0.96, 0.97, 0.99, 0.04, 0.96, 'fridge_glow'],
      [0.03, 0.2, 0.97, 0.95, 0.25, 0.27, 'metal'], [0.03, 0.2, 0.97, 0.95, 0.5, 0.52, 'metal'], [0.03, 0.2, 0.97, 0.95, 0.75, 0.77, 'metal'],
      [0.05, 0.4, 0.95, 0.9, 0.27, 0.4, 'product'], [0.05, 0.4, 0.95, 0.9, 0.52, 0.65, 'product2'], [0.05, 0.4, 0.95, 0.9, 0.77, 0.9, 'product3'], [0.495, 0.985, 0.505, 1, 0.04, 0.96, 'metal']],
    reception: [[0, 0.05, 1, 1, 0, 0.9, 'reception'], [0, 0, 1, 1, 0.9, 1, 'marble'], [0, 0, 1, 0.05, 0, 0.9, 'accent']],
    planter: [[0.08, 0.08, 0.92, 0.92, 0, 0.5, 'pot'], [0.05, 0.05, 0.95, 0.95, 0.5, 0.85, 'plant'], [0.2, 0.2, 0.8, 0.8, 0.85, 1, 'plant2']]
  });
  // M2 の追加は PARTS の後ろ（種類の番号 KINDS は Object.keys(PARTS) の順。M1 の番号は変えない）

  // 遠くの 1 箱の色の役
  const BODY = { desk_pod: 'laminate', pod_screen: 'fabric', cubicle: 'fabric', meeting_table: 'wood', filing: 'metal', credenza: 'wood', copier: 'metal',
    shelf: 'metal', shelf_1: 'metal', pallet: 'pallet', pallet_low: 'box', pallet_high: 'box', rack: 'upright', workbench: 'bench',
    sofa: 'sofa', armchair: 'sofa', coffee_table: 'wood', bench: 'wood', tv_stand: 'wood2', bed: 'sheet', wardrobe: 'wood2', fridge: 'appliance', dresser: 'wood2',
    counter: 'cabinet', dining: 'wood', gondola: 'shelfback', shop_counter: 'counter_body', display: 'wood2', drinks_fridge: 'fridge_glow', reception: 'reception', planter: 'plant' };
  PARTS.meeting_table_l = PARTS.meeting_table; BODY.meeting_table_l = 'wood';
  // look の部品（見た目だけ。lookOn のときだけ PARTS の代わり。当たり判定・種類の番号は同じ）: お店の棚は段ごとに商品の正面の板 1 枚（大きな色の箱でなく）
  const LOOK_PARTS = {
    gondola: (function () {
      const p = [[0, 0, 1, 1, 0, 0.07, 'metal'], [0, 0.47, 1, 0.53, 0, 1, 'shelfback'], [0, 0, 0.02, 1, 0, 1, 'metal'], [0.98, 0, 1, 1, 0, 1, 'metal']];
      const lv = [0.07, 0.34, 0.6, 0.86];
      for (let i = 0; i < lv.length; i++) {
        const y = lv[i];
        p.push([0.02, 0.02, 0.98, 0.47, y, y + 0.015, 'metal'], [0.02, 0.53, 0.98, 0.98, y, y + 0.015, 'metal']);
        if (i < lv.length - 1) {
          const h = (lv[i + 1] - y) * 0.82;
          p.push([0.03, 0.08, 0.97, 0.45, y + 0.015, y + 0.015 + h, 'product_row'], [0.03, 0.55, 0.97, 0.92, y + 0.015, y + 0.015 + h, 'product_row']);
        }
      }
      return p;
    })()
  };
  const partsOf = (kind, flags) => (kind === 'shelf' && (flags & 2) ? PARTS.shelf_free : (Interiors.lookOn && LOOK_PARTS[kind]) || PARTS[kind]);

  // ---------- 設定 ----------
  // 色の表 map から use:role の variant 番目（役の名前の末尾の数字はずらし）。無ければ −1
  function pick(map, use, role, variant) {
    if (!map) return -1;
    let list = map.get(use + ':' + role);
    if (!list) { const base = role.replace(/[0-9]+$/, ''); list = map.get(use + ':' + base); if (list && role !== base) variant = (variant | 0) + (+role.slice(base.length) || 0); }
    if (!list || !list.length) return -1;
    return list[((variant | 0) % list.length + list.length) % list.length];
  }
  const Interiors = {
    VERSION,
    BITS: { BLK, WAL, OTH, FORB, RES, FURN, DECO },
    cfg: null,
    colors: [],
    _colorIdx: null,
    KEY: '',

    // interiors.json を入れる（何度呼んでも同じなら同じ KEY）
    configure(json) {
      const c = json || {};
      if (this.cfg === c) return this;
      this.cfg = c;
      // KEY は見た目（look）を除いた設定から（色・照明・天井を変えても家具の置き方の版は変わらない = 続きからで置き直さない）
      const rest = {};
      for (const k of Object.keys(c)) if (k !== 'look') rest[k] = c[k];
      this.KEY = (fnv(String(VERSION) + '|' + JSON.stringify(rest)) >>> 0).toString(36);
      this.colors = [];
      this._colorIdx = new Map();
      this._lookIdx = new Map();
      const add = (pal, map) => {
        for (const use of Object.keys(pal || {})) for (const role of Object.keys(pal[use] || {})) {
          const list = pal[use][role] || [];
          const idx = [];
          for (const hex of list) {
            let i = this.colors.indexOf(hex);
            if (i < 0) { i = this.colors.length; this.colors.push(hex); }
            idx.push(i);
          }
          map.set(use + ':' + role, idx);
        }
      };
      add(c.palettes, this._colorIdx);
      add(c.look && c.look.palettes, this._lookIdx); // 映画のような配色（look.js が lookOn を立てたときだけ使う）
      // テナント（事務所の階ごとの会社。use 'office@<テナント>'）と飾りの色（use 'dress'）
      const TT = (c.look && c.look.tenants) || {};
      this.tenants = Object.keys(TT);
      const tp = {};
      for (const t of this.tenants) tp['office@' + t] = TT[t].palette || {};
      add(tp, this._lookIdx);
      if (c.look && c.look.dressColors) add({ dress: c.look.dressColors }, this._lookIdx);
      if (!this.colors.length) this.colors.push('#888888');
      // 模様のセル（look.cells.names の番号。255 = なし）と、色の番号 → セル（look.cellOf の役から。同じ色を使う役が複数なら最初の役）
      const L = c.look || {};
      this._cellIdx = new Map();
      ((L.cells && L.cells.names) || []).forEach((nm, i) => this._cellIdx.set(nm, i));
      this._cellIdx.set('screen', 16); // 画面（view の画面のアトラス。16 + 画面の種類、32 + 看板）
      this._cellIdx.set('glass', 253); // ガラス（view の透明なメッシュ）
      this._cellIdx.set('products', 42); // 棚の商品の正面（画面のアトラスの 42〜47。色の板として横に繰り返す）
      this.cellOfColor = new Uint8Array(this.colors.length).fill(255);
      const co = L.cellOf || {};
      const allPal = Object.assign({}, L.palettes || {}, tp);
      for (const use of Object.keys(allPal)) for (const role of Object.keys(allPal[use] || {})) {
        const nm = co[use + ':' + role] || co[role] || co[role.replace(/[0-9]+$/, '')];
        const ci = this.cellIndex(nm);
        if (ci === 255) continue;
        for (const i of this._lookIdx.get(use + ':' + role) || []) if (this.cellOfColor[i] === 255) this.cellOfColor[i] = ci;
      }
      // 色の番号 → 光り方 × 100（look.glowOf の役: 冷蔵庫の中・ネオン）
      this.glowOfColor = new Uint8Array(this.colors.length);
      const gof = L.glowOf || {};
      for (const use of Object.keys(allPal)) for (const role of Object.keys(allPal[use] || {})) {
        const gv = gof[role];
        if (!(gv > 0)) continue;
        for (const i of this._lookIdx.get(use + ':' + role) || []) this.glowOfColor[i] = Math.min(255, Math.round(gv * 100));
      }
      return this;
    },
    // セルの名前 → 番号（無ければ 255）
    cellIndex(name) {
      if (!name || !this._cellIdx) return 255;
      const i = this._cellIdx.get(name);
      return i == null ? 255 : i;
    },
    // 見た目の配色を使うか（MR.Look が world を作る前に決める。家具の置き方・当たり判定は変わらない）
    lookOn: false,
    // 色の番号（use の palette の role から、variant 番目。無ければ近い役 / 0）。lookOn なら look.palettes を先に
    //   use は 'office@law' のようにテナントつきでもよい（テナントの色 → 使い方の look の色 → 元の色）
    color(use, role, variant) {
      const at = use.indexOf('@'), base = at < 0 ? use : use.slice(0, at);
      if (this.lookOn) {
        let v = pick(this._lookIdx, use, role, variant);
        if (v < 0 && at >= 0) v = pick(this._lookIdx, base, role, variant);
        if (v >= 0) return v;
      }
      const v = pick(this._colorIdx, base, role, variant);
      return v < 0 ? 0 : v;
    },
    // 事務所の階のテナント（look.tenants の重み。数か { default, <地区のきまり> }）。家具の置き方の乱数とは別の流れ（KEY・当たり判定は変わらない）
    tenantOf(seed, k, rule) {
      const TT = this.cfg && this.cfg.look && this.cfg.look.tenants;
      if (!TT || !this.tenants || !this.tenants.length) return null;
      const w = {};
      let sum = 0;
      for (const t of this.tenants) {
        const tw = TT[t].weight;
        const v = typeof tw === 'number' ? tw : tw ? (rule && tw[rule] != null ? tw[rule] : (tw.default || 0)) : 1;
        w[t] = v; sum += v;
      }
      if (!(sum > 0)) return null;
      return weighted(rng(mix(seed >>> 0, 0x7E1 + (k | 0)))(), w);
    },
    // その建物の階の使い方（M1: 倉庫は warehouse、ほかは office。nyc-cinematic の偽の部屋もこれを使う）
    useOf(ctx) {
      const c = this.cfg || {};
      if (ctx.kind === 'warehouse') return 'warehouse';
      if (ctx.kind === 'lobby') return 'lobby';
      const tbl = (c.use && (c.use[ctx.rule] || c.use.default)) || { ground: { office: 1 }, upper: { office: 1 } };
      const t = ctx.k === 0 ? (tbl.ground || tbl.upper) : (tbl.upper || tbl.ground);
      return weighted(rng(mix(ctx.seed >>> 0, 0x51 + (ctx.k | 0)))(), t || { office: 1 });
    },
    // 1 階の使い方（扉の種類を決める。doors.js）。furnishFloor の k = 0 と同じ
    groundUse(b, ctx) {
      if (!this.cfg) this.configure({});
      return this.useOf({ kind: b.kind, k: 0, seed: mix(fnv(b.id), (this.cfg && this.cfg.salt) >>> 0), rule: ruleAt(ctx, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) });
    },
    // この建物に家具を入れるか（landmark の _ent / _lobby の id は除く）
    wants(b, levelId) {
      const c = this.cfg || {};
      const kinds = c.kinds || ['walkup', 'lowrise', 'warehouse'];
      if (kinds.indexOf(b.kind) < 0) return false;
      const lv = c.levels && c.levels[levelId];
      if (lv && lv.idPattern) {
        if (!lv._re || lv._src !== lv.idPattern) { Object.defineProperty(lv, '_re', { value: new RegExp(lv.idPattern), writable: true, configurable: true }); Object.defineProperty(lv, '_src', { value: lv.idPattern, writable: true, configurable: true }); }
        if (!lv._re.test(b.id)) return false;
      }
      return true;
    },

    // 1 チャンク分を作る（ジェネレーター。建物の 1 階ごとに yield）。ctx: { engine, player, levelId, city? }
    //   prio { x, y, z }（置き直し・建物に入った所）: その点の建物を先に、その中では点の階から近い順に作る（作りかけを Manager が
    //   out.finish(true) で先に足せる。中身は同じで並びだけ違う）。out: 呼ぶ側が持つ入れ物（Interiors.Out。無ければ作る）
    *job(full, ctx, prio, out) {
      if (!this.cfg) this.configure({});
      out = out || new Out(full);
      if (!full || !full.buildings) return out.finish();
      let list = full.buildings.filter((b) => this.wants(b, ctx.levelId));
      if (prio && list.length > 1) {
        const d = (b) => Math.hypot(Math.max(b.x0 - prio.x, 0, prio.x - b.x1), Math.max(b.z0 - prio.z, 0, prio.z - b.z1));
        list = list.map((b, i) => [d(b), i, b]).sort((a, c) => a[0] - c[0] || a[1] - c[1]).map((a) => a[2]);
      }
      const bk = list.length ? bucket(full) : null;
      if (list.length) yield -1; // チャンクの箱をバケツに入れるのが 1 歩
      for (const b of list) {
        const B = reconstruct(full, b, ctx, bk);
        if (!B) { out.stats.skipped++; continue; }
        out.stats.buildings++;
        const ks = [];
        for (let k = 0; k < B.n; k++) ks.push(k);
        if (prio && b === list[0] && prio.y != null) {
          const k0 = Math.max(0, Math.min(B.n - 1, Math.floor((prio.y + 0.3 - B.by) / B.H)));
          ks.sort((a, c) => Math.abs(a - k0) - Math.abs(c - k0) || a - c);
        }
        for (const k of ks) {
          // 1 階を部屋ごとの歩に分ける（大きな階の 1 歩を短く）
          yield* furnishFloor(B, k, ctx, out);
          yield k;
        }
      }
      return out.finish();
    },
    run(full, ctx) {
      const it = this.job(full, ctx);
      let r = it.next();
      while (!r.done) r = it.next();
      return r.value;
    },
    // テスト用
    _reconstruct(full, b, ctx) { return reconstruct(full, b, ctx); },
    _rasterFloor(B, k, ctx) { return rasterFloor(B, k, ctx); }
  };

  // ---------- 出力の入れ物 ----------
  class Out {
    constructor(full) {
      this.full = full;
      this.boxes = []; this.pieces = []; this.deco = []; this.panels = []; this.shell = []; this.open = []; this.bake = []; this.dress = []; this.lights = []; this.groups = [];
      this.stats = { buildings: 0, skipped: 0, floors: 0, emptyFloors: 0, brokenFloors: 0, pieces: 0, dropped: 0, ms: 0 };
    }
    // partial: 作りかけ（ここまでの階だけ。後で続きを足すので配列は写す）
    finish(partial) {
      return { key: this.full ? this.full.key : '', cx: this.full ? this.full.cx : 0, cz: this.full ? this.full.cz : 0, ver: Interiors.KEY,
        boxes: partial ? this.boxes.slice() : this.boxes, pieces: new Float32Array(this.pieces), deco: new Float32Array(this.deco), panels: new Float32Array(this.panels), shell: new Float32Array(this.shell), open: new Float32Array(this.open), bake: new Float32Array(this.bake), dress: new Float32Array(this.dress), lights: new Float32Array(this.lights),
        groups: partial ? this.groups.slice() : this.groups, stats: this.stats, debug: this.debug || null, partial: !!partial };
    }
  }

  // ---------- 間取りを組み立て直す ----------
  // b: buildings の記録。戻り値 B（建物ごとに 1 回）か null
  // チャンクの箱・斜路を 16 m のバケツに（建物ごとに全部の箱をなめない）
  const BK = 16;
  function bucket(full) {
    const map = new Map();
    const add = (q, list) => {
      const i0 = Math.floor((q.x - q.w / 2) / BK), i1 = Math.floor((q.x + q.w / 2) / BK), j0 = Math.floor((q.z - q.d / 2) / BK), j1 = Math.floor((q.z + q.d / 2) / BK);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) { (map.big || (map.big = [[], []]))[list].push(q); return; }
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i * 100003 + j;
        let a = map.get(k);
        if (!a) { a = [[], []]; map.set(k, a); }
        a[list].push(q);
      }
    };
    for (const q of full.boxes) if (!(q.f & NOCOL)) add(q, 0);
    for (const r of full.ramps || []) if (!(r.f & NOCOL)) add(r, 1);
    return map;
  }
  function gatherRect(bk, x0, z0, x1, z1, list) {
    const out = [], seen = new Set();
    const push = (q) => { if (!seen.has(q)) { seen.add(q); out.push(q); } };
    for (let i = Math.floor(x0 / BK); i <= Math.floor(x1 / BK); i++) for (let j = Math.floor(z0 / BK); j <= Math.floor(z1 / BK); j++) {
      const a = bk.get(i * 100003 + j);
      if (a) for (const q of a[list]) push(q);
    }
    if (bk.big) for (const q of bk.big[list]) push(q);
    // 元の順番（決定性: full の中の順）
    return out;
  }
  function reconstruct(full, b, ctx, bk) {
    const W = Math.round(b.x1 - b.x0), D0 = Math.round(b.z1 - b.z0);
    const dx = b.door[0], dz = b.door[2];
    let front;
    if (dz > b.z1) front = 's'; else if (dz < b.z0) front = 'n'; else if (dx < b.x0) front = 'w'; else if (dx > b.x1) front = 'e'; else return null;
    const fr = new Frame(b.x0, b.z0, b.x1, b.z1, front);
    // 建物の箱（矩形 + 0.5 m）
    const m = 0.5;
    const boxes = [], ramps = [];
    const srcB = bk ? gatherRect(bk, b.x0 - m, b.z0 - m, b.x1 + m, b.z1 + m, 0) : full.boxes;
    const srcR = bk ? gatherRect(bk, b.x0 - m, b.z0 - m, b.x1 + m, b.z1 + m, 1) : (full.ramps || []);
    for (const q of srcB) {
      if (q.f & NOCOL) continue;
      const x0 = q.x - q.w / 2, x1 = q.x + q.w / 2, z0 = q.z - q.d / 2, z1 = q.z + q.d / 2;
      if (x1 < b.x0 - m || x0 > b.x1 + m || z1 < b.z0 - m || z0 > b.z1 + m) continue;
      boxes.push(q);
    }
    for (const r of srcR) {
      if (r.f & NOCOL) continue;
      const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
      if (x1 < b.x0 - m || x0 > b.x1 + m || z1 < b.z0 - m || z0 > b.z1 + m) continue;
      ramps.push(r);
    }
    const inside = (q) => q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1;
    // 1 階の床 = 一番下の SHELL の下端（門の点の y は外の地面）
    let by = Infinity;
    for (const q of boxes) if ((q.f & SHELL) && inside(q) && q.y < by) by = q.y;
    if (!isFinite(by) || !(b.floors > 0)) return null;
    if (!b.roof) return b.kind === 'lobby' ? reconstructLobby(full, b, ctx, fr, boxes, ramps, by) : null;
    const n = b.floors, top = b.roof[1];
    const H = (top - by) / n;
    if (!(H > 2.5)) return null;
    // 屋根のスラブの厚さ
    let slab = 0.25;
    for (const q of boxes) if (q.cat === 'roof' && Math.abs(q.y + q.h - top) < 0.02 && inside(q)) { slab = q.h; break; }
    const wt = 0.3;
    const W_ = fr.W, D = fr.D;
    const rl = fr.local(b.roof[0], b.roof[2]);
    const a = Math.round(rl[0] - 1.5), cv0 = Math.round(rl[1] + 1.5);
    const left = a === 1;
    const core = [left ? wt : a - 0.2, cv0, left ? a + 3.2 : W_ - wt, D - wt];
    // 間仕切りの線（0.2 m の室内の壁で、階段室の矩形の外）
    const cross = new Set(), longs = new Set();
    for (const q of boxes) {
      if (q.cat !== 'interior' || !inside(q)) continue;
      const lr = fr.lrect(q);
      const cu = (lr[0] + lr[2]) / 2, cv = (lr[1] + lr[3]) / 2;
      if (cu >= core[0] - 0.01 && cu <= core[2] + 0.01 && cv >= core[1] - 0.01 && cv <= core[3] + 0.01) continue;
      const tu = lr[2] - lr[0], tv = lr[3] - lr[1];
      if (Math.abs(tv - 0.2) < 0.02 && tu > 0.25) cross.add(Math.round(cv));
      else if (Math.abs(tu - 0.2) < 0.02 && tv > 0.25) longs.add(Math.round(cu));
    }
    const seed = mix(fnv(b.id), (Interiors.cfg && Interiors.cfg.salt) >>> 0);
    // 戦利品（建物の中、ローカル）と地区のきまり
    const loot = [];
    for (const t of full.loot || []) {
      if (!(t.x > b.x0 && t.x < b.x1 && t.z > b.z0 && t.z < b.z1)) continue;
      const l = fr.local(t.x, t.z);
      loot.push({ u: l[0], v: l[1], y: t.y, id: t.id });
    }
    const rule = ruleAt(ctx, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    return { b, id: b.id, loot, rule, kind: b.kind, fr, W: W_, D, by, H, n, top, slab, a, cv0, left, core, wt, seed, boxes, ramps,
      cross: Array.from(cross).sort((p, q) => p - q), longs: Array.from(longs).sort((p, q) => p - q), D0 };
  }

  // 塔の 1 階ロビー（genLobby: ガラスの正面 + 柱。天井は上の段の箱の下面。階段・間仕切り無し）
  function reconstructLobby(full, b, ctx, fr, boxes, ramps, by) {
    const inside = (q) => q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1;
    let top = -Infinity;
    for (const q of boxes) if ((q.f & SHELL) && inside(q)) top = Math.max(top, q.y + q.h);
    const H = top - by;
    if (!(H > 3)) return null;
    const loot = [];
    for (const t of full.loot || []) {
      if (!(t.x > b.x0 && t.x < b.x1 && t.z > b.z0 && t.z < b.z1)) continue;
      const l = fr.local(t.x, t.z);
      loot.push({ u: l[0], v: l[1], y: t.y, id: t.id });
    }
    const seed = mix(fnv(b.id), (Interiors.cfg && Interiors.cfg.salt) >>> 0);
    // 階段室なし: a / cv0 は格子の外（階段口の anchor・禁止の矩形は空になる）
    return { b, id: b.id, kind: 'lobby', lobby: true, loot, rule: ruleAt(ctx, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), fr, W: fr.W, D: fr.D, by, H, n: 1, top: by + H, slab: 0,
      a: -100, cv0: -100, left: false, core: [-200, -200, -199, -199], wt: 0.3, seed, boxes, ramps, cross: [], longs: [], D0: fr.D };
  }

  // 区画のローカル座標（citygen の Frame と同じ約束: u = 間口、v = 奥行き、v = 0 が正面）
  class Frame {
    constructor(x0, z0, x1, z1, front) {
      this.front = front;
      if (front === 'n') { this.ox = x0; this.oz = z0; this.ux = 1; this.uz = 0; this.vx = 0; this.vz = 1; this.W = x1 - x0; this.D = z1 - z0; }
      else if (front === 's') { this.ox = x1; this.oz = z1; this.ux = -1; this.uz = 0; this.vx = 0; this.vz = -1; this.W = x1 - x0; this.D = z1 - z0; }
      else if (front === 'w') { this.ox = x0; this.oz = z1; this.ux = 0; this.uz = -1; this.vx = 1; this.vz = 0; this.W = z1 - z0; this.D = x1 - x0; }
      else { this.ox = x1; this.oz = z0; this.ux = 0; this.uz = 1; this.vx = -1; this.vz = 0; this.W = z1 - z0; this.D = x1 - x0; }
      this.W = Math.round(this.W); this.D = Math.round(this.D);
    }
    x(u, v) { return this.ox + u * this.ux + v * this.vx; }
    z(u, v) { return this.oz + u * this.uz + v * this.vz; }
    local(x, z) { const px = x - this.ox, pz = z - this.oz; return [px * this.ux + pz * this.uz, px * this.vx + pz * this.vz]; }
    rect(u0, v0, u1, v1) {
      const xa = this.x(u0, v0), xb = this.x(u1, v1), za = this.z(u0, v0), zb = this.z(u1, v1);
      return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
    }
    // ワールドの箱 → ローカルの [u0, v0, u1, v1]
    lrect(q) {
      const p = this.local(q.x - q.w / 2, q.z - q.d / 2), r = this.local(q.x + q.w / 2, q.z + q.d / 2);
      return [Math.min(p[0], r[0]), Math.min(p[1], r[1]), Math.max(p[0], r[0]), Math.max(p[1], r[1])];
    }
  }

  // ---------- 格子（Nav3D の歩行グラフと同じ式。nav3d.js _graphGen の「節点をふさぐ」）----------
  function rampTop(r, px, pz) { // nav3d.js rampS と同じ
    const lo = Math.min(r.y0, r.y1), hi = Math.max(r.y0, r.y1);
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
    const cx = px < x0 ? x0 : px > x1 ? x1 : px, cz = pz < z0 ? z0 : pz > z1 ? z1 : pz;
    const len = r.axis === 'x' ? r.w : r.d;
    let u = r.axis === 'x' ? (cx - x0) / len : (cz - z0) / len;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    if (r.dir < 0) u = 1 - u;
    return lo + (hi - lo) * u;
  }
  // 箱 1 つをセルに: 膨らませた矩形に中心が入る（境界を含む）セルに bit を立てる
  function stampBox(G, B, x0, x1, z0, z1, bit, test) {
    const fr = B.fr, inf = B.inf;
    // ワールドのセルの中心 px = 整数 + 0.5（minX が整数）。候補の範囲を少し広く取り、式そのもので確かめる
    const i0 = Math.floor(x0 - inf - 1), i1 = Math.ceil(x1 + inf + 1), j0 = Math.floor(z0 - inf - 1), j1 = Math.ceil(z1 + inf + 1);
    for (let wx = i0; wx <= i1; wx++) {
      const px = wx + 0.5;
      if (!(px >= x0 - inf && px <= x1 + inf)) continue;
      for (let wz = j0; wz <= j1; wz++) {
        const pz = wz + 0.5;
        if (!(pz >= z0 - inf && pz <= z1 + inf)) continue;
        if (test && !test(px, pz)) continue;
        const l = fr.local(px, pz), i = Math.round(l[0] - 0.5), j = Math.round(l[1] - 0.5);
        if (i < 0 || j < 0 || i >= B.W || j >= B.D) continue;
        G[j * B.W + i] |= bit;
      }
    }
  }
  function rasterFloor(B, k, ctx) {
    const e = ctx.engine || {};
    const su = e.stepUp == null ? 0.45 : e.stepUp, hr = e.headroom == null ? 1.8 : e.headroom;
    B.inf = e.agentRadius == null ? 0.45 : e.agentRadius;
    const y = B.by + k * B.H;
    const G = new Uint8Array(B.W * B.D);
    for (const q of B.boxes) {
      const bot = q.y || 0, top = bot + q.h;
      if (!(top > y + su && bot < y + hr)) continue;
      const wall = q.cat === 'exterior' || q.cat === 'interior';
      stampBox(G, B, q.x - q.w / 2, q.x + q.w / 2, q.z - q.d / 2, q.z + q.d / 2, BLK | (wall ? WAL : OTH));
    }
    // 上の階: 床（その高さの WALK の上面）が無いセル（階段の穴）は節点が無い
    if (k > 0) {
      const F2 = new Uint8Array(B.W * B.D);
      const fr = B.fr;
      for (const q of B.boxes) {
        if (!(q.f & WALK) || Math.abs((q.y || 0) + q.h - y) > 0.03) continue;
        const x0 = q.x - q.w / 2, x1 = q.x + q.w / 2, z0 = q.z - q.d / 2, z1 = q.z + q.d / 2;
        for (let wx = Math.floor(x0 - 1); wx <= Math.ceil(x1); wx++) {
          const px = wx + 0.5;
          if (px < x0 || px > x1) continue;
          for (let wz = Math.floor(z0 - 1); wz <= Math.ceil(z1); wz++) {
            const pz = wz + 0.5;
            if (pz < z0 || pz > z1) continue;
            const l = fr.local(px, pz), i = Math.round(l[0] - 0.5), j = Math.round(l[1] - 0.5);
            if (i >= 0 && j >= 0 && i < B.W && j < B.D) F2[j * B.W + i] = 1;
          }
        }
      }
      for (const r of B.ramps) { // 斜路の面がこの高さの近くのセル（階段の下り口）
        const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
        for (let wx = Math.floor(x0 - 1); wx <= Math.ceil(x1); wx++) for (let wz = Math.floor(z0 - 1); wz <= Math.ceil(z1); wz++) {
          const px = wx + 0.5, pz = wz + 0.5;
          if (px < x0 || px > x1 || pz < z0 || pz > z1 || Math.abs(rampTop(r, px, pz) - y) > 0.3) continue;
          const l = fr.local(px, pz), i = Math.round(l[0] - 0.5), j = Math.round(l[1] - 0.5);
          if (i >= 0 && j >= 0 && i < B.W && j < B.D) F2[j * B.W + i] = 1;
        }
      }
      for (let c = 0; c < F2.length; c++) if (!F2[c]) G[c] |= BLK | OTH;
    }
    for (const r of B.ramps) {
      const t = r.t || 0.3;
      stampBox(G, B, r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2, BLK | OTH, (px, pz) => {
        const top = rampTop(r, px, pz), bot = top - t;
        return top > y + su && bot < y + hr;
      });
    }
    return { G, y, su, hr };
  }

  // ---------- 1 階に家具を置く ----------
  function* furnishFloor(B, k, ctx, out) {
    const cfg = Interiors.cfg || {}, R = cfg.rules || {};
    const kit = cfg.kit || {};
    const t0 = now();
    const W = B.W, D = B.D, fr = B.fr;
    const ras = rasterFloor(B, k, ctx);
    const G = ras.G, y = ras.y, su = ras.su;
    const N = W * D;
    const own = new Int32Array(N); // 家具のまとまりの番号（0 = なし）
    const idx = (i, j) => j * W + i;
    const inGrid = (i, j) => i >= 0 && j >= 0 && i < W && j < D;
    const free = (c) => !(G[c] & BLK);
    out.stats.floors++;
    const rnd = rng(mix(B.seed, 0x100 + k));
    const use = Interiors.useOf({ kind: B.kind, k, seed: B.seed, rule: B.rule });
    const variant = rnd.int(0, 7);
    // テナント（見た目だけ。別の乱数の流れ）と、色を引く名前 lu（'office@law' など）
    const tenant = use === 'office' ? Interiors.tenantOf(B.seed, k, B.rule) : null;
    const lu = tenant ? use + '@' + tenant : use;

    // --- 禁止: 階段室の矩形（中心が入るセル）・階段口の前・木箱など（壁以外でふさがったセル）---
    const core = B.core;
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const u = i + 0.5, v = j + 0.5, c = idx(i, j);
      if (u >= core[0] && u <= core[2] && v >= core[1] && v <= core[3]) G[c] |= FORB;
      if (u >= B.a - 1 && u < B.a + 4 && v >= B.cv0 - 3 && v < B.cv0) G[c] |= FORB;
      if (G[c] & OTH) G[c] |= FORB;
    }
    const reserve = (i0, j0, i1, j1) => { for (let j = Math.max(0, j0); j < Math.min(D, j1); j++) for (let i = Math.max(0, i0); i < Math.min(W, i1); i++) G[idx(i, j)] |= RES; };

    // --- つながっていてほしい点（anchor）---
    const anchors = [], main = [];
    const anchor = (i, j, isMain) => { if (!inGrid(i, j)) return; const c = idx(i, j); if (!free(c)) return; anchors.push(c); if (isMain) main.push(c); };
    // 階段口（屋上の点 = 各階の階段口の前）
    for (let i = B.a; i < B.a + 3; i++) { anchor(i, B.cv0 - 2, true); anchor(i, B.cv0 - 1, true); }
    // 扉（外周のふさがっていないセル）と前のスペース
    const fa = R.frontApron == null ? 6 : R.frontApron, da = R.doorApron == null ? 2 : R.doorApron;
    for (let i = 0; i < W; i++) {
      if (free(idx(i, 0))) { anchor(i, 0, true); reserve(i - 1, 0, i + 2, fa); }
      if (free(idx(i, D - 1))) { anchor(i, D - 1, true); reserve(i - 1, D - da, i + 2, D); }
    }
    for (let j = 1; j < D - 1; j++) {
      if (free(idx(0, j))) { anchor(0, j, true); reserve(0, j - 1, da, j + 2); }
      if (free(idx(W - 1, j))) { anchor(W - 1, j, true); reserve(W - da, j - 1, W, j + 2); }
    }
    // 間仕切りの隙間（線の両側のセルが空いている所）
    const ga = R.gapApron == null ? 2 : R.gapApron;
    for (const v of B.cross) for (let i = 0; i < W; i++) {
      if (!inGrid(i, v) || !inGrid(i, v - 1)) continue;
      if (free(idx(i, v)) && free(idx(i, v - 1))) { anchor(i, v, true); anchor(i, v - 1, true); reserve(i - 1, v - ga, i + 2, v + ga); }
    }
    for (const u of B.longs) for (let j = 0; j < D; j++) {
      if (!inGrid(u, j) || !inGrid(u - 1, j)) continue;
      if (free(idx(u, j)) && free(idx(u - 1, j))) { anchor(u, j, true); anchor(u - 1, j, true); reserve(u - ga, j - 1, u + ga, j + 2); }
    }
    // 戦利品（3 × 3）
    const ls = R.lootSquare == null ? 3 : R.lootSquare, lh = Math.floor(ls / 2);
    for (const t of B.loot) {
      if (Math.abs(t.y - y) > 0.3) continue;
      const i = Math.floor(t.u), j = Math.floor(t.v);
      anchor(i, j, false); reserve(i - lh, j - lh, i - lh + ls, j - lh + ls);
    }
    // ロビーのスポーン（enemy.js の _candidates: 扉の点から区画の中心へ 4.5 m）と周り 8 マス
    if (k === 0) {
      const b = B.b, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const ix = cx - b.door[0], iz = cz - b.door[2], il = Math.hypot(ix, iz) || 1, sd = R.lobbySpawnDist == null ? 4.5 : R.lobbySpawnDist;
      const l = fr.local(b.door[0] + ix / il * sd, b.door[2] + iz / il * sd);
      const i = Math.floor(l[0]), j = Math.floor(l[1]);
      anchor(i, j, true); reserve(i - 1, j - 1, i + 2, j + 2);
    }
    // 空の階で 1 つ目の anchor からつながっている anchor（もともとつながっていない所は問わない）
    const before = bfs(G, W, D, anchors.length ? anchors[0] : -1, BLK);
    const need = anchors.filter((c) => before && before[c]);

    // --- 部屋（間仕切りの線で切った矩形）と背骨（anchor → 部屋の中心の L 字。扉・階段・隙間は 2 マス）---
    const U = [0].concat(B.longs.filter((u) => u > 0 && u < W), [W]), V = [0].concat(B.cross.filter((v) => v > 0 && v < D), [D]);
    const rooms = [];
    for (let s = 0; s < V.length - 1; s++) for (let r = 0; r < U.length - 1; r++) rooms.push({ i0: U[r], i1: U[r + 1], j0: V[s], j1: V[s + 1], r, s });
    const roomAt = (i, j) => { for (const rm of rooms) if (i >= rm.i0 && i < rm.i1 && j >= rm.j0 && j < rm.j1) return rm; return null; };
    const hubOf = (rm) => {
      if (rm.hub !== undefined) return rm.hub;
      const ci = Math.floor((rm.i0 + rm.i1) / 2), cj = Math.floor((rm.j0 + rm.j1) / 2);
      let best = -1, bd = 1e9;
      for (let j = rm.j0; j < rm.j1; j++) for (let i = rm.i0; i < rm.i1; i++) {
        const c = idx(i, j);
        if (!free(c) || (G[c] & FORB)) continue;
        if (!before || !before[c]) continue;
        const d = Math.abs(i - ci) + Math.abs(j - cj);
        if (d < bd) { bd = d; best = c; }
      }
      rm.hub = best;
      return best;
    };
    const markFree = (i, j) => { if (inGrid(i, j) && free(idx(i, j))) G[idx(i, j)] |= RES; };
    for (const c of need) {
      const i = c % W, j = (c / W) | 0, rm = roomAt(i, j);
      if (!rm) continue;
      const h = hubOf(rm);
      if (h < 0) continue;
      const hi = h % W, hj = (h / W) | 0, wide = main.indexOf(c) >= 0;
      // 縦（j）→ 横（i）の L
      const sj = hj > j ? 1 : -1, si = hi > i ? 1 : -1;
      for (let jj = j; jj !== hj + sj; jj += sj) { markFree(i, jj); if (wide) markFree(i + (i + 1 < rm.i1 ? 1 : -1), jj); if (jj === hj) break; }
      for (let ii = i; ii !== hi + si; ii += si) { markFree(ii, hj); if (wide) markFree(ii, hj + (hj + 1 < rm.j1 ? 1 : -1)); if (ii === hi) break; }
    }

    // --- 置く ---
    const pieces = [];
    let cluster = 0;
    const opening = openingTester(B, k);
    const sill = sillOf(B, k);
    // 置けるか: kind, i0, j0, cw, cd, mode 'free' | 'wall', side（壁の向き。wall のとき）, cl（同じまとまりは堀を問わない）
    const fits = (kind, i0, j0, cw, cd, mode, wallSide, cl) => {
      const kt = kit[kind]; if (!kt) return false;
      for (let j = j0; j < j0 + cd; j++) for (let i = i0; i < i0 + cw; i++) {
        if (!inGrid(i, j)) return false;
        const c = idx(i, j), g = G[c];
        if (g & (FORB | RES | FURN | DECO)) return false;
        // deep: 壁の側の 1 列（背）は壁でふさがったセル、残りは空いたセル（ベッドなど奥行きのある壁の家具）
        const back = mode === 'deep' && (wallSide === 'n' ? j === j0 : wallSide === 's' ? j === j0 + cd - 1 : wallSide === 'w' ? i === i0 : i === i0 + cw - 1);
        if (mode === 'free' || (mode === 'deep' && !back)) { if (g & BLK) return false; }
        else if (!(g & WAL) || (g & OTH)) return false;
      }
      if (mode === 'deep') {
        for (let j = j0 - 1; j <= j0 + cd; j++) for (let i = i0 - 1; i <= i0 + cw; i++) {
          if (!inGrid(i, j) || (i >= i0 && i < i0 + cw && j >= j0 && j < j0 + cd)) continue;
          if ((G[idx(i, j)] & FURN) && own[idx(i, j)] !== cl) return false;
        }
      }
      if (mode === 'free') {
        for (let j = j0 - 1; j <= j0 + cd; j++) for (let i = i0 - 1; i <= i0 + cw; i++) {
          if (!inGrid(i, j) || (i >= i0 && i < i0 + cw && j >= j0 && j < j0 + cd)) continue;
          const c = idx(i, j);
          if ((G[c] & FURN) && own[c] !== cl) return false;
          if (G[c] & OTH) return false;
        }
      }
      if (mode !== 'free') {
        // 外壁に付く家具: 窓・扉の開口との約束（sill より高い家具は開口の無い所だけ、開口の下は sill − stepUp − margin 以下だけ）
        //   家具がかかる外周のセルはどれも（壁の面に沿う辺だけでなく、端が外壁の環に入る所も）
        const h = kt.h;
        if (h > sill - su - (R.sillMargin == null ? 0.05 : R.sillMargin)) {
          for (let j = j0; j < j0 + cd; j++) for (let i = i0; i < i0 + cw; i++) {
            if ((j === 0 && opening('n', i, 0, 1, 1)) || (j === D - 1 && opening('s', i, 0, 1, 1)) ||
              (i === 0 && opening('w', 0, j, 1, 1)) || (i === W - 1 && opening('e', 0, j, 1, 1))) return false;
          }
        }
      }
      return true;
    };
    const place = (kind, i0, j0, cw, cd, mode, dir, cl, extra) => {
      for (let j = j0; j < j0 + cd; j++) for (let i = i0; i < i0 + cw; i++) { const c = idx(i, j); G[c] |= FURN; own[c] = cl; }
      const p = { kind, i0, j0, cw, cd, mode, dir, cl, extra: extra || null };
      pieces.push(p);
      return p;
    };
    const tryFree = (kind, i0, j0, rot, cl) => {
      const kt = kit[kind], cw = rot ? kt.cells[1] : kt.cells[0], cd = rot ? kt.cells[0] : kt.cells[1];
      if (!fits(kind, i0, j0, cw, cd, 'free', null, cl)) return null;
      return place(kind, i0, j0, cw, cd, 'free', rot ? 2 : 0, cl);
    };
    const roomInner = (rm) => ({ i0: rm.i0 + 1, j0: rm.j0 + 1, i1: rm.i1 - 1, j1: rm.j1 - 1 });
    // 格子のパターン（行の向き 2 通り × ずらし）で一番多く置けるものを置く
    const pattern = (rm, kind, gapA, gapB, margin, clusterEach, maxN) => {
      const kt = kit[kind]; if (!kt) return 0;
      const I = roomInner(rm);
      let best = null;
      for (const rot of [0, 1]) for (let off = 0; off <= 1; off++) {
        const cw = rot ? kt.cells[1] : kt.cells[0], cd = rot ? kt.cells[0] : kt.cells[1];
        const list = [];
        for (let j = I.j0 + margin + off; j + cd <= I.j1 - margin; j += cd + gapB) for (let i = I.i0 + margin; i + cw <= I.i1 - margin; i += cw + gapA) {
          if (fits(kind, i, j, cw, cd, 'free', null, -1)) list.push([i, j, rot]);
        }
        if (!best || list.length > best.length) best = list;
      }
      let nPl = 0;
      for (const p of best || []) { if (maxN && nPl >= maxN) break; const pc = tryFree(kind, p[0], p[1], p[2], ++cluster); if (pc) nPl++; }
      return nPl;
    };
    // 壁際（部屋の縁の行の、壁でふさがったセル）に 1 奥行きの家具を並べる
    const wallRun = (rm, choices, chance) => {
      const edges = [
        { side: 'n', cells: (t) => [rm.i0 + t, rm.j0], len: rm.i1 - rm.i0, horiz: true, dir: 0 },
        { side: 's', cells: (t) => [rm.i0 + t, rm.j1 - 1], len: rm.i1 - rm.i0, horiz: true, dir: 1 },
        { side: 'w', cells: (t) => [rm.i0, rm.j0 + t], len: rm.j1 - rm.j0, horiz: false, dir: 2 },
        { side: 'e', cells: (t) => [rm.i1 - 1, rm.j0 + t], len: rm.j1 - rm.j0, horiz: false, dir: 3 }
      ];
      let n = 0;
      const max = Math.max(1, Math.round(2 * ((rm.i1 - rm.i0) + (rm.j1 - rm.j0)) / (R.wallPerCells || 7)));
      let once = false;
      for (const e of edges) {
        let t = 1;
        while (t < e.len - 1 && n < max) {
          if (rnd() > chance) { t += 2; continue; }
          let kind = choices[rnd.int(0, choices.length - 1)];
          if (kind === 'copier') { if (once) kind = choices[0]; once = true; }
          const kt = kit[kind];
          if (!kt) { t++; continue; }
          const L = kt.cells[0];
          const s = e.cells(t), cw = e.horiz ? L : 1, cd = e.horiz ? 1 : L;
          // 部屋の縁が外壁の環か（ring）、間仕切り・階段室の壁か
          const ringSide = e.side === 'n' && s[1] === 0 ? 'n' : e.side === 's' && s[1] === D - 1 ? 's' : e.side === 'w' && s[0] === 0 ? 'w' : e.side === 'e' && s[0] === W - 1 ? 'e' : null;
          if (fits(kind, s[0], s[1], cw, cd, 'wall', ringSide, -1)) {
            place(kind, s[0], s[1], cw, cd, 'wall', e.dir, ++cluster);
            n++;
            t += L + (R.wallPieceGap == null ? 1 : R.wallPieceGap);
          } else t += 1;
        }
      }
      return n;
    };
    const decoAt = [];
    const cornerPlant = (rm) => {
      for (const c of [[rm.i0, rm.j0], [rm.i1 - 1, rm.j0], [rm.i0, rm.j1 - 1], [rm.i1 - 1, rm.j1 - 1]]) {
        if (!inGrid(c[0], c[1])) continue;
        const q = idx(c[0], c[1]);
        if ((G[q] & (FURN | DECO | FORB | RES)) || !(G[q] & WAL) || (G[q] & OTH)) continue;
        G[q] |= DECO; decoAt.push({ t: 'plant', i: c[0], j: c[1] });
        return true;
      }
      return false;
    };

    // 1 つだけ壁際に: 部屋の 4 辺（edges の順）で、端から 1 マス空けて最初に置ける所。deep = 奥行きのある家具（ベッド）
    const EDGE = { n: 0, s: 1, w: 2, e: 3 };
    const wallPlace = (rm, kind, opt) => {
      opt = opt || {};
      const kt = kit[kind]; if (!kt) return null;
      const L = kt.cells[0], Dp = opt.deep ? kt.cells[1] : 1;
      const sides = opt.sides || ['n', 's', 'w', 'e'];
      const start = opt.rr ? opt.rr.int(0, 3) : 0;
      for (let q = 0; q < sides.length; q++) {
        const side = sides[(q + start) % sides.length], horiz = side === 'n' || side === 's';
        const len = horiz ? rm.i1 - rm.i0 : rm.j1 - rm.j0;
        for (let t = 1; t + L <= len - 1; t++) {
          const tt = opt.center ? Math.floor((len - L) / 2) + ((t & 1) ? (t >> 1) : -(t >> 1)) : t;
          if (tt < 1 || tt + L > len - 1) continue;
          let i0, j0;
          if (side === 'n') { i0 = rm.i0 + tt; j0 = rm.j0; } else if (side === 's') { i0 = rm.i0 + tt; j0 = rm.j1 - Dp; }
          else if (side === 'w') { i0 = rm.i0; j0 = rm.j0 + tt; } else { i0 = rm.i1 - Dp; j0 = rm.j0 + tt; }
          const cw = horiz ? L : Dp, cd = horiz ? Dp : L;
          const cl = ++cluster;
          if (fits(kind, i0, j0, cw, cd, opt.deep ? 'deep' : 'wall', side, cl)) return place(kind, i0, j0, cw, cd, opt.deep ? 'deep' : 'wall', EDGE[side], cl, { side });
        }
      }
      return null;
    };
    // 1 つだけ自由に: (ti, tj) の近く（渦巻き）
    const freeNear = (rm, kind, ti, tj, rot, maxR) => {
      for (let r = 0; r <= (maxR || 4); r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ti + di, j = tj + dj;
        if (rm && (i < rm.i0 + 1 || j < rm.j0 + 1)) continue;
        const pc = tryFree(kind, i, j, rot, ++cluster);
        if (pc) return pc;
      }
      return null;
    };
    // 置いた壁の家具の前（部屋の中へ gap マス）の点
    const inFront = (p, gap) => {
      const s = p.extra && p.extra.side, ci = p.i0 + Math.floor(p.cw / 2), cj = p.j0 + Math.floor(p.cd / 2);
      if (s === 'n') return [ci, p.j0 + p.cd + gap]; if (s === 's') return [ci, p.j0 - 1 - gap];
      if (s === 'w') return [p.i0 + p.cw + gap, cj]; return [p.i0 - 1 - gap, cj];
    };
    const living = (rm, rr) => {
      const sofa = wallPlace(rm, 'sofa', { rr, center: true });
      if (sofa) {
        const f = inFront(sofa, 1);
        freeNear(rm, 'coffee_table', f[0], f[1], 0, 1);
        const opp = { n: 's', s: 'n', w: 'e', e: 'w' }[sofa.extra.side];
        wallPlace(rm, 'tv_stand', { sides: [opp], center: true });
      }
      wallPlace(rm, 'armchair', { rr });
      wallPlace(rm, 'shelf_1', { rr });
      cornerPlant(rm);
    };
    const bedroom = (rm, rr) => {
      wallPlace(rm, 'bed', { rr, deep: true, center: true });
      wallPlace(rm, 'wardrobe', { rr });
      wallPlace(rm, 'wardrobe', { rr });
      wallPlace(rm, 'dresser', { rr });
    };
    const kitchen = (rm, rr, I) => {
      const run = wallPlace(rm, 'counter', { rr });
      if (run) wallPlace(rm, 'fridge', { sides: [run.extra.side] });
      const big = (I.i1 - I.i0) >= (I.j1 - I.j0);
      freeNear(rm, 'dining', Math.floor((I.i0 + I.i1) / 2) - 1, Math.floor((I.j0 + I.j1) / 2), big ? 0 : 1, 3);
    };
    const salesFloor = (rm, rr, I) => {
      // カウンターは正面の扉の前のスペースのすぐ奥、ゴンドラは正面と平行の列（通路 2 マス）、展示台は窓の 1 マス内側、飲み物の冷蔵庫は奥の壁
      freeNear(rm, 'shop_counter', I.i0 + 1, Math.max(I.j0, fa), 0, 3);
      patternRot(rm, 'gondola', 1, 2, 1, [0]);
      freeNear(rm, 'display', I.i0 + 1, I.j0 + 1, 0, 2);
      freeNear(rm, 'display', I.i1 - 3, I.j0 + 1, 0, 2);
      wallPlace(rm, 'drinks_fridge', { sides: ['s', 'e', 'w'], rr });
      wallPlace(rm, 'drinks_fridge', { sides: ['s', 'e', 'w'], rr });
    };
    const stockRoom = (rm, rr) => {
      wallRun(rm, ['shelf', 'shelf', 'shelf_1'], 0.9);
      pattern(rm, 'pallet_low', 2, 2, 1, true, 4);
    };
    const lobbyRoom = (rm, rr, I) => {
      // 正面の扉から奥まで 2 マスの背骨（受付は v ≥ 6 か前のスペースの横）
      const d = B.b.door, dl = fr.local(d[0], d[2]), mi = Math.floor(dl[0]);
      reserve(mi - 1, 0, mi + 1, D);
      if (!freeNear(rm, 'reception', mi + 2, Math.max(fa, I.j0), 0, 4) && !freeNear(rm, 'reception', mi - 5, Math.max(fa, I.j0), 0, 4)) {
        for (let j = Math.max(fa, I.j0); j < I.j1 - 1; j++) { if (freeNear(rm, 'reception', mi + 2, j, 0, 6)) break; }
      }
      wallRun(rm, ['bench', 'bench', 'planter'], 0.7);
      for (let q = 0; q < 3; q++) freeNear(rm, 'planter', rr.int(I.i0 + 1, Math.max(I.i0 + 1, I.i1 - 2)), rr.int(I.j0 + 1, Math.max(I.j0 + 1, I.j1 - 2)), 0, 2);
      pattern(rm, 'bench', 3, 4, 2, true);
    };
    const workshop = (rm, rr) => {
      wallRun(rm, ['workbench', 'workbench', 'shelf', 'shelf_1'], 0.8);
      pattern(rm, 'pallet_low', 2, 2, 1, true, 4);
      pattern(rm, 'workbench', 2, 3, 2, true, 2);
    };
    const patternRot = (rm, kind, gapA, gapB, margin, rots) => {
      const kt = kit[kind]; if (!kt) return 0;
      const I = roomInner(rm);
      let best = null;
      for (const rot of rots) for (let off = 0; off <= 1; off++) {
        const cw = rot ? kt.cells[1] : kt.cells[0], cd = rot ? kt.cells[0] : kt.cells[1];
        const list = [];
        for (let j = I.j0 + margin + off; j + cd <= I.j1 - margin; j += cd + gapB) for (let i = I.i0 + margin; i + cw <= I.i1 - margin; i += cw + gapA) if (fits(kind, i, j, cw, cd, 'free', null, -1)) list.push([i, j, rot]);
        if (!best || list.length > best.length) best = list;
      }
      let n = 0;
      for (const q of best || []) if (tryFree(kind, q[0], q[1], q[2], ++cluster)) n++;
      return n;
    };
    const minRoom = R.minRoom == null ? 3 : R.minRoom;
    // 使える部屋（住まいで 1 部屋だけならワンルーム）
    const usable = rooms.filter((rm) => { const I = roomInner(rm); return I.i1 - I.i0 >= minRoom && I.j1 - I.j0 >= minRoom; });
    let roomN = 0;
    yield 'plan';
    for (const rm of rooms) {
      if (roomN++ > 0) yield 'room';
      const I = roomInner(rm);
      const iw = I.i1 - I.i0, id = I.j1 - I.j0;
      if (iw < minRoom || id < minRoom) continue;
      let area = 0;
      for (let j = I.j0; j < I.j1; j++) for (let i = I.i0; i < I.i1; i++) { const c = idx(i, j); if (free(c) && !(G[c] & FORB)) area++; }
      if (area < minRoom * minRoom) continue;
      const rr = rng(mix(B.seed, (0x200 + k) * 64 + rooms.indexOf(rm)));
      if (use === 'apartment' || use === 'shop' || use === 'lobby' || use === 'workshop') {
        let sub;
        if (use === 'apartment') sub = usable.length <= 1 ? 'studio' : weighted(rr(), (cfg.sub && cfg.sub.apartment) || { living: 0.45, bedroom: 0.35, kitchen: 0.2 });
        else if (use === 'shop') sub = rm.j0 === 0 ? 'sales' : 'stock';
        else sub = use;
        rm.sub = sub;
        if (sub === 'living') living(rm, rr);
        else if (sub === 'bedroom') bedroom(rm, rr);
        else if (sub === 'kitchen') kitchen(rm, rr, I);
        else if (sub === 'studio') { bedroom(rm, rr); living(rm, rr); kitchen(rm, rr, I); }
        else if (sub === 'sales') salesFloor(rm, rr, I);
        else if (sub === 'stock') stockRoom(rm, rr);
        else if (sub === 'lobby') lobbyRoom(rm, rr, I);
        else workshop(rm, rr);
        continue;
      }
      if (use === 'warehouse') {
        const sub = weighted(rr(), (cfg.sub && cfg.sub.warehouse) || { racks: 1 });
        rm.sub = sub;
        if (sub === 'racks') {
          pattern(rm, 'rack', 1, 2, 1, true);
          // パレットの山（2 × 2 のまとまり）
          const I2 = roomInner(rm);
          let made = 0;
          for (let j = I2.j0 + 1; j + 2 <= I2.j1 - 1 && made < 4; j += 3) for (let i = I2.i0 + 1; i + 2 <= I2.i1 - 1 && made < 4; i += 3) {
            const cl = ++cluster, kinds = ['pallet_high', 'pallet_low', 'pallet_low', 'pallet'];
            let ok = true;
            for (let q = 0; q < 4 && ok; q++) if (!fits(kinds[q], i + (q & 1), j + (q >> 1), 1, 1, 'free', null, cl)) ok = false;
            if (!ok) continue;
            for (let q = 0; q < 4; q++) place(kinds[(q + rr.int(0, 3)) % 4], i + (q & 1), j + (q >> 1), 1, 1, 'free', 0, cl);
            made++;
          }
          wallRun(rm, ['workbench', 'rack'], 0.5);
        } else {
          wallRun(rm, ['workbench', 'workbench', 'shelf', 'rack'], 0.8);
          pattern(rm, 'pallet_low', 2, 2, 1, true, 6);
        }
      } else {
        let sub = weighted(rr(), (cfg.sub && cfg.sub.office) || { open: 1 });
        if (sub === 'meeting' && area < (R.meetingMinArea == null ? 30 : R.meetingMinArea)) sub = 'open';
        rm.sub = sub;
        if (sub === 'open') {
          pattern(rm, 'desk_pod', 1, 2, 1, true);
          wallRun(rm, ['credenza', 'filing', 'filing', 'shelf', 'copier'], R.wallPieceChance == null ? 0.8 : R.wallPieceChance);
        } else if (sub === 'cubicles') {
          pattern(rm, 'cubicle', 1, 2, 1, true);
          wallRun(rm, ['filing', 'filing', 'shelf'], 0.6);
        } else if (sub === 'meeting') {
          const big = (I.i1 - I.i0) >= 8 || (I.j1 - I.j0) >= 8;
          const kind = big ? 'meeting_table_l' : 'meeting_table', kt = kit[kind];
          const rot = (I.j1 - I.j0) > (I.i1 - I.i0) ? 1 : 0, cw = rot ? kt.cells[1] : kt.cells[0], cd = rot ? kt.cells[0] : kt.cells[1];
          const ci = Math.floor((I.i0 + I.i1 - cw) / 2), cj = Math.floor((I.j0 + I.j1 - cd) / 2);
          let done = false;
          for (let rr2 = 0; rr2 <= 3 && !done; rr2++) for (let dj = -rr2; dj <= rr2 && !done; dj++) for (let di = -rr2; di <= rr2 && !done; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== rr2) continue;
            if (tryFree(kind, ci + di, cj + dj, rot, ++cluster)) done = true;
          }
          if (!done) pattern(rm, 'desk_pod', 1, 2, 1, true);
          wallRun(rm, ['credenza', 'shelf'], 0.5);
        } else {
          pattern(rm, 'shelf', 1, 1, 1, true);
          wallRun(rm, ['shelf', 'shelf', 'filing'], 0.9);
        }
        cornerPlant(rm);
      }
    }

    yield 'rooms';
    // --- 高さ（届く高さのきまり）---
    const P = ctx.player || {};
    const height = P.height || 1.8, jumpV = P.jumpSpeed || 6.5, grav = Math.abs(P.gravity || -20);
    const pStep = P.stepUp == null ? su : P.stepUp;
    const apex = jumpV * jumpV / (2 * grav);
    const clear = B.H - B.slab;
    const margin = R.reachMargin == null ? 0.1 : R.reachMargin, cm = R.ceilingMargin == null ? 0.1 : R.ceilingMargin;
    let S = 0;
    for (const q of B.boxes) if ((q.f & WALK) && q.cat === 'prop' && Math.abs(q.y - y) < 0.05 && inRect(B, q)) S = Math.max(S, q.h);
    for (const p of pieces) { const h = kit[p.kind].h; p.h = h; p.walk = h + height <= clear + 1e-6; if (p.walk) S = Math.max(S, h); }
    if (pieces.some((p) => p.kind === 'desk_pod')) { const hs = kit.pod_screen ? kit.pod_screen.h : 1.25; if (hs + height <= clear + 1e-6) S = Math.max(S, hs); }
    const Rch = Math.max(S + pStep, Math.min(clear - height, S + apex));
    const kept = [];
    for (const p of pieces) {
      if (!p.walk) {
        p.h = Math.max(p.h, Rch + margin);
        if (p.h > clear - cm) { out.stats.dropped++; continue; }
      }
      kept.push(p);
    }

    // --- 箱（ローカル）と壁に合わせて削る ---
    const ins = R.inset == null ? 0.05 : R.inset, clip = R.clip == null ? 0.02 : R.clip;
    const walls = [];
    for (const q of B.boxes) {
      if (q.cat !== 'exterior' && q.cat !== 'interior') continue;
      const bot = q.y || 0, top = bot + q.h;
      if (top <= y + 0.02 || bot >= y + clear) continue;
      walls.push(fr.lrect(q));
    }
    const items = []; // { p, r:[u0,v0,u1,v1], h, mat, walk, kind }
    for (const p of kept) {
      const r = [p.i0 + ins, p.j0 + ins, p.i0 + p.cw - ins, p.j0 + p.cd - ins];
      if (p.mode !== 'free') clipToWalls(r, walls, clip);
      if (r[2] - r[0] < 0.2 || r[3] - r[1] < 0.2) { out.stats.dropped++; continue; }
      items.push({ p, r, h: p.h, walk: p.walk, kind: p.kind, mat: kit[p.kind].mat || 'furn_wood' });
      // 机の島の仕切り（薄い板。机の箱の中、長い辺に沿って真ん中）
      if (p.kind === 'desk_pod' && kit.pod_screen) {
        const ks = kit.pod_screen, t = ks.t || 0.06, hs = ks.h;
        const along = p.dir === 2 ? 'v' : 'u';
        const rr = along === 'u' ? [r[0] + 0.02, (r[1] + r[3]) / 2 - t / 2, r[2] - 0.02, (r[1] + r[3]) / 2 + t / 2] : [(r[0] + r[2]) / 2 - t / 2, r[1] + 0.02, (r[0] + r[2]) / 2 + t / 2, r[3] - 0.02];
        const sw = hs + height <= clear + 1e-6;
        let h2 = hs;
        if (!sw) h2 = Math.max(hs, Rch + margin);
        if (h2 <= clear - cm) items.push({ p, r: rr, h: h2, walk: sw, kind: 'pod_screen', mat: ks.mat || 'furn_fabric', screen: true });
      }
    }

    // --- 確かめる: 置いた箱を同じ式で格子に入れ、anchor が全部つながるか ---
    const G2 = new Uint8Array(N);
    for (let c = 0; c < N; c++) G2[c] = G[c] & BLK;
    for (const it of items) {
      if (!(it.h > su)) continue; // 段（≤ stepUp）は節点をふさがない
      const w = fr.rect(it.r[0], it.r[1], it.r[2], it.r[3]);
      stampBox(G2, B, w[0], w[2], w[1], w[3], BLK);
    }
    const after = need.length ? bfs(G2, W, D, need[0], BLK) : null;
    let ok = true;
    for (const c of need) if (!after || !after[c]) { ok = false; break; }

    // --- 出力 ---
    const g = { id: B.id, k, y, top: y + clear, use, tenant, lu, sub: null, x0: B.b.x0, z0: B.b.z0, x1: B.b.x1, z1: B.b.z1, ix0: 0, iz0: 0, ix1: 0, iz1: 0,
      cx: (B.b.x0 + B.b.x1) / 2, cz: (B.b.z0 + B.b.z1) / 2, p0: out.pieces.length / PSTRIDE, p1: 0, variant, d0: out.deco.length / 7, d1: 0, q0: out.panels.length / 4, q1: 0, b0: out.boxes.length, b1: 0 };
    const inner = fr.rect(B.wt, B.wt, W - B.wt, D - B.wt);
    g.ix0 = inner[0]; g.iz0 = inner[1]; g.ix1 = inner[2]; g.iz1 = inner[3];
    if (ctx.debug) (out.debug || (out.debug = [])).push({ id: B.id, k, y, clear, R: Rch, S, sill, W, D, G: G.slice(), B, ok, b0: out.boxes.length, n: ok ? items.length : 0 });
    if (!ok) { out.stats.emptyFloors++; }
    else {
      for (const it of items) emitPiece(B, it, y, out);
      for (const d of decoAt) emitDecoCell(B, d, y, lu, variant, out);
      out.stats.pieces += items.length;
    }
    // 天井の照明（家具が無くても）
    const every = (R.panelEvery && R.panelEvery[use]) || 3;
    const py = y + clear - 0.02;
    for (const rm of rooms) {
      const I = roomInner(rm);
      if (I.i1 - I.i0 < 2 || I.j1 - I.j0 < 2) continue;
      // 住まいは部屋に 1 つ（真ん中）、ほかは every マスごと
      const one = use === 'apartment';
      const oi = one ? Math.floor((I.i0 + I.i1 - 1) / 2) : I.i0 + Math.floor(((I.i1 - I.i0 - 1) % every) / 2), oj = one ? Math.floor((I.j0 + I.j1 - 1) / 2) : I.j0 + Math.floor(((I.j1 - I.j0 - 1) % every) / 2);
      for (let j = oj; j < I.j1; j += one ? 1e9 : every) for (let i = oi; i < I.i1; i += one ? 1e9 : every) {
        const c = idx(i, j);
        if (G[c] & FORB) continue;
        const wx = fr.x(i + 0.5, j + 0.5), wz = fr.z(i + 0.5, j + 0.5);
        out.panels.push(r3(wx), r3(py), r3(wz), fr.ux !== 0 ? 0 : 1);
      }
    }
    // 見た目の殻（天井の板・内張り・床の板。当たり判定・nav には入らない）。殻と飾りはそれぞれ別の歩（1 歩を短く）
    //   look を切っている（Interiors.lookOn = false）ときは作らない（?look=0 は今まで通りの仕事の量）。
    //   家具・飾り・照明・箱の範囲はここで閉じる（焼いた光と飾りがこの階の家具を読む。以前は後で閉じていて、焼いた光と机の上の飾りが空だった）
    g.p1 = out.pieces.length / PSTRIDE; g.d1 = out.deco.length / 7; g.q1 = out.panels.length / 4; g.b1 = out.boxes.length;
    const lookOn = Interiors.lookOn;
    if (lookOn) yield 'shell';
    g.s0 = out.shell.length / SSTRIDE;
    g.o0 = out.open.length / OSTRIDE;
    B._spots = [];
    if (lookOn) emitShell(B, y, clear, lu, variant, out, k);
    g.o1 = out.open.length / OSTRIDE;
    g.s1 = out.shell.length / SSTRIDE;
    if (lookOn) emitBake(g, use, out);
    // 飾り（見た目だけ。家具の上・壁の面・床に平ら）
    if (ok && lookOn) yield 'dress';
    g.r0 = out.dress.length / RSTRIDE; g.l0 = out.lights.length / LSTRIDE;
    if (ok && lookOn) emitDress(B, g, y, clear, lu, variant, out, k);
    g.r1 = out.dress.length / RSTRIDE; g.l1 = out.lights.length / LSTRIDE;
    B._spots = null;
    g.sub = rooms.map((rm) => rm.sub).filter(Boolean).join(',');
    out.groups.push(g);
    out.stats.ms += now() - t0;
    return ok;
  }

  // 箱 r（ローカル）を壁の面の clip m 手前まで削る（重なりが小さくなる側を選ぶ）
  function clipToWalls(r, walls, clip) {
    for (let pass = 0; pass < 2; pass++) for (const w of walls) {
      if (!(w[2] > r[0] && w[0] < r[2] && w[3] > r[1] && w[1] < r[3])) continue;
      const opts = [
        [w[2] + clip, r[1], r[2], r[3]], [r[0], r[1], w[0] - clip, r[3]],
        [r[0], w[3] + clip, r[2], r[3]], [r[0], r[1], r[2], w[1] - clip]
      ];
      let best = null, ba = -1;
      for (const o of opts) { const a = (o[2] - o[0]) * (o[3] - o[1]); if (o[2] > o[0] && o[3] > o[1] && a > ba) { ba = a; best = o; } }
      if (!best) { r[2] = r[0]; return; }
      r[0] = best[0]; r[1] = best[1]; r[2] = best[2]; r[3] = best[3];
    }
  }

  function inRect(B, q) { return q.x > B.b.x0 && q.x < B.b.x1 && q.z > B.b.z0 && q.z < B.b.z1; }

  // 外壁の開口（窓・扉）が家具の範囲にかかるか: SHELL の箱が無い所を、sill の少し上と腰の高さで調べる
  function openingTester(B, k) {
    const y = B.by + k * B.H, fr = B.fr;
    const shell = [];
    for (const q of B.boxes) if ((q.f & SHELL) && inRect(B, q) && q.y < y + B.H - 0.01 && q.y + q.h > y + 0.01) shell.push({ r: fr.lrect(q), y0: q.y - y, y1: q.y + q.h - y });
    const sill = sillOf(B, k);
    // 面ごとにセル 1 つずつ「開口がかかるか」を前もって調べる（0.1 m ごと × 3 つの高さ）
    const hs = [0.2, sill + 0.05, Math.min(B.H - 0.8, 2.0)];
    const cache = {};
    const faceOpen = (side) => {
      if (cache[side]) return cache[side];
      const horiz = side === 'n' || side === 's', len = horiz ? B.W : B.D;
      const a = new Uint8Array(len);
      const fixed = side === 'n' ? 0.15 : side === 's' ? B.D - 0.15 : side === 'w' ? 0.15 : B.W - 0.15;
      const mine = shell.filter((s) => (horiz ? fixed >= s.r[1] && fixed <= s.r[3] : fixed >= s.r[0] && fixed <= s.r[2]));
      // 高さごとに覆われた区間をつなぎ、すき間（開口）にかかるセルに印
      for (const hy of hs) {
        const iv = [];
        for (const s of mine) if (hy >= s.y0 && hy <= s.y1) iv.push(horiz ? [s.r[0], s.r[2]] : [s.r[1], s.r[3]]);
        iv.sort((p, q) => p[0] - q[0]);
        let cur = 0;
        const gap = (g0, g1) => { // (g0, g1) が開いている: [c + 0.05, c + 0.95] と重なるセル
          for (let c = Math.max(0, Math.floor(g0 - 0.95)); c < len && c + 0.05 < g1; c++) if (c + 0.95 > g0) a[c] = 1;
        };
        for (const q of iv) { if (q[0] > cur + 0.01) gap(cur, q[0]); if (q[1] > cur) cur = q[1]; }
        if (cur < len - 0.01) gap(cur, len);
      }
      return (cache[side] = a);
    };
    return (side, i0, j0, cw, cd) => {
      const a = faceOpen(side), horiz = side === 'n' || side === 's';
      const s0 = horiz ? i0 : j0, s1 = horiz ? i0 + cw : j0 + cd;
      for (let c = s0; c < s1; c++) if (a[c]) return true;
      return false;
    };
  }
  // その建物の窓の腰の高さ（正面の窓の下の SHELL の箱の上端。見つからなければ 1.0）
  function sillOf(B, k) {
    if (B._sill != null) return B._sill;
    let s = null;
    const y = B.by + k * B.H;
    for (const q of B.boxes) {
      if (!(q.f & SHELL) || !inRect(B, q)) continue; // 隣の建物の外壁（矩形 + 0.5 m で拾った）は見ない
      const lo = q.y - y, hi = lo + q.h;
      if (Math.abs(lo) < 0.02 && hi > 0.5 && hi < B.H - 1 && q.h < 3) { if (s === null || hi < s) s = hi; }
    }
    B._sill = s === null ? 1.0 : s;
    return B._sill;
  }

  // 4 近傍の BFS（blockBits のセルは通らない）
  let _q = new Int32Array(1024);
  function bfs(G, W, D, start, blockBits) {
    if (start < 0) return null;
    if (_q.length < W * D) _q = new Int32Array(W * D * 2);
    const seen = new Uint8Array(W * D), q = _q;
    let h = 0, t = 0;
    q[t++] = start; seen[start] = 1;
    while (h < t) {
      const c = q[h++], i = c % W, j = (c / W) | 0;
      if (i > 0) { const n = c - 1; if (!seen[n] && !(G[n] & blockBits)) { seen[n] = 1; q[t++] = n; } }
      if (i < W - 1) { const n = c + 1; if (!seen[n] && !(G[n] & blockBits)) { seen[n] = 1; q[t++] = n; } }
      if (j > 0) { const n = c - W; if (!seen[n] && !(G[n] & blockBits)) { seen[n] = 1; q[t++] = n; } }
      if (j < D - 1) { const n = c + W; if (!seen[n] && !(G[n] & blockBits)) { seen[n] = 1; q[t++] = n; } }
    }
    return seen;
  }

  // ---------- 出力の形 ----------
  // ローカルの箱（u0, v0, u1, v1、y0..y1）→ ワールドの [x, y, z, w, h, d]
  function worldBox(fr, u0, v0, u1, v1, y0, y1) {
    const w = fr.rect(u0, v0, u1, v1);
    return [r3((w[0] + w[2]) / 2), r3(y0), r3((w[1] + w[3]) / 2), r3(w[2] - w[0]), r3(y1 - y0), r3(w[3] - w[1])];
  }
  // 箱の中の割合 (a, b) → 箱の座標。r = [x0, z0, x1, z1]（ワールド）、dir: 前の向き 0 = +z / 1 = −z / 2 = +x / 3 = −x（背 = 反対側）
  function partRect(r, dir, a0, b0, a1, b1) {
    const du = r[2] - r[0], dv = r[3] - r[1];
    if (dir === 0) return [r[0] + a0 * du, r[1] + b0 * dv, r[0] + a1 * du, r[1] + b1 * dv];
    if (dir === 1) return [r[2] - a1 * du, r[3] - b1 * dv, r[2] - a0 * du, r[3] - b0 * dv];
    if (dir === 2) return [r[0] + b0 * du, r[3] - a1 * dv, r[0] + b1 * du, r[3] - a0 * dv];
    return [r[2] - b1 * du, r[1] + a0 * dv, r[2] - b0 * du, r[1] + a1 * dv];
  }
  // ローカルの前の向き（0 = +v / 1 = −v / 2 = +u / 3 = −u）→ ワールドの dir
  function worldDir(fr, ldir) {
    const nu = ldir === 2 ? 1 : ldir === 3 ? -1 : 0, nv = ldir === 0 ? 1 : ldir === 1 ? -1 : 0;
    const wx = nu * fr.ux + nv * fr.vx, wz = nu * fr.uz + nv * fr.vz;
    return wz > 0.5 ? 0 : wz < -0.5 ? 1 : wx > 0.5 ? 2 : 3;
  }
  const KINDS = Object.keys(PARTS);
  const KIND_ID = {};
  KINDS.forEach((k, i) => { KIND_ID[k] = i; });
  // 家具 1 つ: pieces に 10 個（x0, y0, z0, x1, y1, z1, 種類, 向き, 色の番号のずらし, 1 = WALK）
  const PSTRIDE = 10;

  function emitPiece(B, it, y, out) {
    const fr = B.fr, p = it.p, r = it.r, h = it.h;
    const pi = out.pieces.length / PSTRIDE;
    const w = fr.rect(r[0], r[1], r[2], r[3]);
    const wb = worldBox(fr, r[0], r[1], r[2], r[3], y, y + h);
    // 向き: 壁の物は壁から部屋の中へ、自由に置いた物は長い辺の向き（p.dir 0 = u / 2 = v）
    let ldir = p.mode === 'wall' || p.mode === 'deep' ? p.dir : (p.dir === 2 ? 2 : 0);
    if (it.kind === 'pod_screen') ldir = 0;
    // 旗: 1 = WALK、2 = 自由に立つ（壁に付かない）
    out.pieces.push(r3(w[0]), r3(y), r3(w[1]), r3(w[2]), r3(y + h), r3(w[3]), KIND_ID[it.kind], worldDir(fr, ldir), (p.i0 * 7 + p.j0 * 13) & 3, (it.walk ? 1 : 0) | (p.mode === 'free' ? 2 : 0));
    out.boxes.push({ x: wb[0], y: wb[1], z: wb[2], w: wb[3], h: wb[4], d: wb[5], mat: it.mat, cat: 'furn', f: it.walk ? WALK : 0, piece: pi, kind: it.kind });
  }

  // 見た目の殻: shell に SSTRIDE（10）個ずつ（x0, y0, z0, x1, y1, z1, 色, 光り方, 模様のセル（255 = なし）, 旗 SH_*）。家具ではない
  //   （当たり判定・nav・サーバーに入らない）。見た目の約束: 開口（窓・扉・間仕切りの隙間）をふさがない、床から 2 cm より厚く部屋へ出ない。
  //   天井の板: 上の階のスラブ（floor / roof の箱。階段の踊り場 stair_stone は除く）の下面のすぐ下に、スラブごとに 1 枚（階段の穴は空いたまま）。
  //     スラブが無い階（塔のロビー = 天井は上の段の箱の下面）は外壁の内側に 1 枚。スラブの下面に外壁の材質が貼られて茶色の縞に見えていたのを隠す
  //   壁の内張り（look.shell.liner[use]）: 外壁（SHELL）の箱ごとに、部屋の側の面の 2 cm 手前に、その階の床〜天井の高さだけ（窓・扉の隙間は
  //     箱が無いので空いたまま）。窓の上の帯（外壁の箱が天井の上まで続く所）も隠れる。間仕切り（interior）は両面を 1 cm ずつ包む 1 つの箱。
  //     床に着く所は巾木（skirting m）、窓の下の腰壁の上は窓台（2 cm）。向き 1 つの壁は accentChance で差し色（accent_wall）
  //   開口: open に OSTRIDE（9）個ずつ（x0, z0, x1, z1 = 外壁の内側の面の線、nx, nz = 外向き、y = 床、窓台の高さ、上端）。窓の光（view の光の札）が使う
  const SSTRIDE = 10, OSTRIDE = 9;
  const SH_NOCONTACT = 1, SH_NOEDGE = 2, SH_CEIL = 4, SH_LINER = 8, SH_FLOOR = 16;
  //   床の板（look.shell.floor[use]）: その階の床のスラブ（floor の箱の上面 = y）の上に 4 mm（色・模様はテナント / 使い方の floor）
  //   use はテナントつき（'office@law'）でもよい。B._spots に壁の飾りを掛けられる所（床から 0.9〜2.1 m がずっと壁の面）を残す
  function emitShell(B, y, clear, lu, variant, out, k) {
    const LK = (Interiors.cfg && Interiors.cfg.look) || {};
    const lk = LK.shell || {};
    const at = lu.indexOf('@'), use = at < 0 ? lu : lu.slice(0, at), tn = at < 0 ? null : (LK.tenants || {})[lu.slice(at + 1)] || null;
    const top = y + clear, t = lk.ceilingThick == null ? 0.01 : lk.ceilingThick, gap = lk.ceilingGap == null ? 0.004 : lk.ceilingGap;
    const c = Interiors.color(lu, 'ceiling', variant);
    const glow = tn && tn.ceilingGlow != null ? tn.ceilingGlow : ((lk.glow || {})[use] != null ? lk.glow[use] : (lk.glow || {}).default) || 0;
    const ccell = Interiors.cellIndex(tn && tn.ceilingCell !== undefined ? tn.ceilingCell : (lk.ceilingCell || {})[use]);
    const b = B.b;
    // 床の板
    if (lk.floor && lk.floor[use]) {
      const fc = Interiors.color(lu, 'floor', variant), fcell = Interiors.cellIndex(tn && tn.floorCell !== undefined ? tn.floorCell : (lk.floorCell || {})[use]);
      const ft = lk.floorThick == null ? 0.004 : lk.floorThick;
      let nf = 0;
      for (const q of B.boxes) {
        if (q.cat !== 'floor' || q.mat === 'stair_stone' || Math.abs((q.y || 0) + q.h - y) > 0.03) continue;
        if (!(q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1)) continue;
        const x0 = Math.max(q.x - q.w / 2, b.x0 + B.wt), x1 = Math.min(q.x + q.w / 2, b.x1 - B.wt), z0 = Math.max(q.z - q.d / 2, b.z0 + B.wt), z1 = Math.min(q.z + q.d / 2, b.z1 - B.wt);
        if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
        out.shell.push(r3(x0), r3(y + 0.001), r3(z0), r3(x1), r3(y + 0.001 + ft), r3(z1), fc, 0, fcell, SH_NOCONTACT | SH_NOEDGE | SH_FLOOR);
        nf++;
      }
      if (!nf && k === 0) {
        const w = B.fr.rect(B.wt, B.wt, B.W - B.wt, B.D - B.wt);
        out.shell.push(r3(w[0]), r3(y + 0.001), r3(w[1]), r3(w[2]), r3(y + 0.001 + ft), r3(w[3]), fc, 0, fcell, SH_NOCONTACT | SH_NOEDGE | SH_FLOOR);
      }
    }
    const push = (x0, y0, z0, x1, y1, z1, col, gl, cell, fl) => out.shell.push(r3(x0), r3(y0), r3(z0), r3(x1), r3(y1), r3(z1), col, gl, cell, fl);
    let n = 0;
    for (const q of B.boxes) {
      if (q.cat !== 'floor' && q.cat !== 'roof') continue;
      if (q.mat === 'stair_stone' || Math.abs((q.y || 0) - top) > 0.06) continue;
      if (!(q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1)) continue;
      // スラブどうしの継ぎ目に隙間を作らない（隙間からスラブの下面が線に見えた）
      const x0 = Math.max(q.x - q.w / 2, b.x0), x1 = Math.min(q.x + q.w / 2, b.x1), z0 = Math.max(q.z - q.d / 2, b.z0), z1 = Math.min(q.z + q.d / 2, b.z1);
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
      const yy = (q.y || 0) - gap;
      push(x0, yy - t, z0, x1, yy, z1, c, glow, ccell, SH_NOCONTACT | SH_NOEDGE | SH_CEIL);
      n++;
    }
    if (!n) {
      const w = B.fr.rect(B.wt, B.wt, B.W - B.wt, B.D - B.wt);
      push(w[0], top - gap - t, w[1], w[2], top - gap, w[3], c, glow, ccell, SH_NOCONTACT | SH_NOEDGE | SH_CEIL);
    }
    // --- 外壁の箱を向き（n / s / w / e）に分ける。開口は窓の高さの帯で箱の無い所 ---
    const sides = { n: [], s: [], w: [], e: [] };
    const near = 0.45;
    for (const q of B.boxes) {
      if (!(q.f & SHELL) || q.cat !== 'exterior' || /glass|window/.test(q.mat || '')) continue;
      const bx0 = q.x - q.w / 2, bx1 = q.x + q.w / 2, bz0 = q.z - q.d / 2, bz1 = q.z + q.d / 2, by0 = q.y || 0, by1 = by0 + q.h;
      if (by1 <= y + 0.01 || by0 >= top - 0.01) continue;
      if (bx1 < b.x0 - 0.05 || bx0 > b.x1 + 0.05 || bz1 < b.z0 - 0.05 || bz0 > b.z1 + 0.05) continue;
      let sd = null;
      if (q.d <= near + 0.05 && bz0 <= b.z0 + 0.05 && bz1 <= b.z0 + near) sd = 'n';
      else if (q.d <= near + 0.05 && bz1 >= b.z1 - 0.05 && bz0 >= b.z1 - near) sd = 's';
      else if (q.w <= near + 0.05 && bx0 <= b.x0 + 0.05 && bx1 <= b.x0 + near) sd = 'w';
      else if (q.w <= near + 0.05 && bx1 >= b.x1 - 0.05 && bx0 >= b.x1 - near) sd = 'e';
      if (sd) sides[sd].push({ bx0, bx1, bz0, bz1, by0, by1 });
    }
    const lin = lk.liner && lk.liner[use];
    const wallC = Interiors.color(lu, 'wall', variant), skC = Interiors.color(lu, 'skirting', variant);
    const accC = Interiors.color(lu, 'accent_wall', variant);
    const accGlow = Math.max(0, ((lk.accentGlow || {})[use]) || 0);
    const accR = rng(mix(B.seed >>> 0, 0xACC + (k | 0)));
    const ach = lk.accentChance == null ? 0.5 : typeof lk.accentChance === 'number' ? lk.accentChance : (lk.accentChance[use] != null ? lk.accentChance[use] : lk.accentChance.default);
    const accSide = accR() < ach ? 'nswe'[Math.floor(accR() * 4)] : '';
    const wcell = Interiors.cellIndex((lk.wallCell || {})[use]);
    const sk = lk.skirting == null ? 0.1 : lk.skirting, lt = lk.inset == null ? 0.02 : lk.inset;
    const yb = y, yt = top - gap - t; // 内張りは天井の板の下まで
    const band = y + (lk.windowBand == null ? 1.3 : lk.windowBand);
    for (const sd of 'nswe') {
      const L = sides[sd];
      if (!L.length) continue;
      const along = sd === 'n' || sd === 's'; // 壁の線が x に沿う
      const nx = sd === 'w' ? -1 : sd === 'e' ? 1 : 0, nz = sd === 'n' ? -1 : sd === 's' ? 1 : 0;
      // 部屋の側の面（内側の面の座標）
      const face = sd === 'n' ? Math.max(...L.map((q) => q.bz1)) : sd === 's' ? Math.min(...L.map((q) => q.bz0)) : sd === 'w' ? Math.max(...L.map((q) => q.bx1)) : Math.min(...L.map((q) => q.bx0));
      const a0 = along ? b.x0 + B.wt : b.z0 + B.wt, a1 = along ? b.x1 - B.wt : b.z1 - B.wt;
      if (lin) {
        // 壁を高さの帯（箱の上下の端で切る）に分け、帯ごとに箱のある所をつないで 1 枚ずつ（窓の間の柱は 1 枚ずつ、腰壁・窓の上の帯は 1 枚）
        const col = sd === accSide ? accC : wallC, lg = sd === accSide ? accGlow : 0;
        const box = (s0, s1, h0, h1, depth, cc, cell, fl, gl) => {
          const d0 = Math.min(face, face - (nx + nz) * depth), d1 = Math.max(face, face - (nx + nz) * depth);
          if (along) push(s0, h0, d0, s1, h1, d1, cc, gl || 0, cell, fl); else push(d0, h0, s0, d1, h1, s1, cc, gl || 0, cell, fl);
        };
        let span = null; // 床から 0.9〜2.1 m がずっと壁の所（壁の飾り）
        const ys = [yb, yt];
        for (const q of L) { if (q.by0 > yb && q.by0 < yt) ys.push(q.by0); if (q.by1 > yb && q.by1 < yt) ys.push(q.by1); }
        ys.sort((p, q) => p - q);
        let prevRuns = null;
        for (let bi = 0; bi + 1 < ys.length; bi++) {
          const v0 = ys[bi], v1 = ys[bi + 1];
          if (v1 - v0 < 0.03) continue;
          const vm = (v0 + v1) / 2, iv = [];
          for (const q of L) if (q.by0 <= vm && q.by1 >= vm) iv.push([Math.max(along ? q.bx0 : q.bz0, a0), Math.min(along ? q.bx1 : q.bz1, a1)]);
          iv.sort((p, q) => p[0] - q[0]);
          const runs = [];
          for (const r of iv) { if (r[1] - r[0] < 0.02) continue; const last = runs[runs.length - 1]; if (last && r[0] <= last[1] + 0.02) last[1] = Math.max(last[1], r[1]); else runs.push([r[0], r[1]]); }
          for (const r of runs) box(r[0], r[1], v0, v1, lt, col, wcell, SH_LINER | SH_NOEDGE, lg);
          if (v1 > y + 0.9 && v0 < y + 2.1) span = span ? span.map((a) => runs.map((r) => [Math.max(a[0], r[0]), Math.min(a[1], r[1])]).filter((r) => r[1] - r[0] > 0.3)).reduce((x, z) => x.concat(z), []) : runs.map((r) => r.slice());
          // 床に着く帯: 巾木（つないだ所ごと）
          if (v0 <= yb + 0.02 && sk > 0) for (const r of runs) box(r[0], r[1], yb, Math.min(yb + sk, v1), lt + 0.012, skC, 255, SH_LINER | SH_NOCONTACT);
          // 床からの腰壁の上に開口がある帯の境目: 窓台を壁の端から端まで 1 本（柱の所は 2 cm 出る腰の見切り）
          if (prevRuns && v0 > yb + 0.3 && v0 < yt - 0.4 && ys[0] === yb) {
            const covPrev = prevRuns.reduce((a, r) => a + r[1] - r[0], 0), covNow = runs.reduce((a, r) => a + r[1] - r[0], 0);
            if (covNow < covPrev - 0.3 && bi === 1) for (const r of prevRuns) box(r[0], r[1], v0 - 0.02, v0 + 0.02, lt + 0.02, skC, 255, SH_LINER | SH_NOCONTACT);
          }
          prevRuns = runs;
        }
        if (span) for (const r of span) if (r[1] - r[0] >= 0.5) B._spots.push({ along, s0: r[0], s1: r[1], face: face - (nx + nz) * lt, nx, nz, accent: sd === accSide });
      }
      // 開口（窓の高さの帯で箱の無い所）
      const cov = [];
      for (const q of L) if (q.by0 <= band && q.by1 >= band) cov.push([along ? q.bx0 : q.bz0, along ? q.bx1 : q.bz1]);
      cov.sort((p, q) => p[0] - q[0]);
      let pos = a0;
      const gaps = [];
      for (const [c0, c1] of cov) { if (c0 - pos >= 0.4) gaps.push([pos, Math.min(c0, a1)]); pos = Math.max(pos, c1); }
      if (a1 - pos >= 0.4) gaps.push([pos, a1]);
      for (const [g0, g1] of gaps) {
        if (g1 - g0 < 0.4) continue;
        let sill = y, head = top;
        for (const q of L) {
          const s0 = along ? q.bx0 : q.bz0, s1 = along ? q.bx1 : q.bz1;
          if (s1 <= g0 + 0.05 || s0 >= g1 - 0.05) continue;
          if (q.by1 <= band && q.by1 > sill) sill = q.by1;
          if (q.by0 >= band && q.by0 < head) head = q.by0;
        }
        if (along) out.open.push(r3(g0), r3(face), r3(g1), r3(face), nx, nz, r3(y), r3(sill), r3(Math.min(head, top)));
        else out.open.push(r3(face), r3(g0), r3(face), r3(g1), nx, nz, r3(y), r3(sill), r3(Math.min(head, top)));
      }
    }
    // 間仕切り（両面を 1 cm ずつ包む箱 1 つ + 巾木）
    if (lin) for (const q of B.boxes) {
      if (q.cat !== 'interior' || !(q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1)) continue;
      const by0 = q.y || 0, by1 = by0 + q.h;
      const v0 = Math.max(by0, yb), v1 = Math.min(by1, yt);
      if (v1 - v0 < 0.03) continue;
      const thinX = q.w < q.d, e = 0.01;
      const x0 = q.x - q.w / 2 - (thinX ? e : 0), x1 = q.x + q.w / 2 + (thinX ? e : 0), z0 = q.z - q.d / 2 - (thinX ? 0 : e), z1 = q.z + q.d / 2 + (thinX ? 0 : e);
      push(x0, v0, z0, x1, v1, z1, wallC, 0, wcell, SH_LINER | SH_NOEDGE);
      // 両面に壁の飾りを掛けられる（間仕切りが床から 2.1 m 以上）
      if (v0 <= y + 0.9 && v1 >= y + 2.1) {
        const L2 = thinX ? q.d : q.w;
        if (L2 >= 0.5) for (const sg of [-1, 1]) {
          if (thinX) B._spots.push({ along: false, s0: q.z - q.d / 2, s1: q.z + q.d / 2, face: q.x + sg * (q.w / 2 + e), nx: -sg, nz: 0, part: true });
          else B._spots.push({ along: true, s0: q.x - q.w / 2, s1: q.x + q.w / 2, face: q.z + sg * (q.d / 2 + e), nx: 0, nz: -sg, part: true });
        }
      }
      if (v0 <= yb + 0.02 && sk > 0) {
        const e2 = 0.025;
        push(q.x - q.w / 2 - (thinX ? e2 : 0), yb, q.z - q.d / 2 - (thinX ? 0 : e2), q.x + q.w / 2 + (thinX ? e2 : 0), Math.min(yb + sk, v1), q.z + q.d / 2 + (thinX ? 0 : e2), skC, 0, 255, SH_LINER | SH_NOCONTACT);
      }
    }
  }

  // 飾り（L9。見た目だけ: 当たり判定・nav・サーバーに入らない）: dress に RSTRIDE（9）個ずつ（x, y（下端）, z, w, h, d, 色, セル, 光り方 × 100）。
  //   置き方のきまり: 当たり判定の家具の上（高さ 0.15 m 以下・天板の 3 割以下）、壁の面（奥行き 0.05 m 以下・床から 0.9〜2.1 m がずっと壁 =
  //   B._spots。窓・扉・隙間には掛けない。前 0.6 m に背の高い家具がある所も掛けない）、床に平ら（0.012 m 以下）。
  //   何を置くかは look.dress[テナント | 使い方] = [[種類, 割合], …]。乱数は別の流れ（rng(mix(seed, 0xD7E5 + k))）
  const RSTRIDE = 9;
  // 灯り（lights）: LSTRIDE（8）個ずつ（x, 床の y, z, 半径, r, g, b（sRGB 0..1）, 強さ）。view が床の光のたまり（光の札）にする（スタンド・壁の灯り）
  const LSTRIDE = 8;
  const SIGNS = { labs: 0, law: 1, trading: 2, agency: 3, records: 4, exit: 5, queue: 6, open: 7, deli: 8, lobby: 9 };
  function emitDress(B, g, y, clear, lu, variant, out, k) {
    const LK = (Interiors.cfg && Interiors.cfg.look) || {};
    const at = lu.indexOf('@'), use = at < 0 ? lu : lu.slice(0, at), tenant = at < 0 ? null : lu.slice(at + 1);
    const list = (LK.dress || {})[tenant || use];
    if (!list || !list.length) return;
    const rnd = rng(mix(B.seed >>> 0, 0xD7E5 + (k | 0)));
    const D = out.dress, P = out.pieces;
    const dc = (kind, v) => Interiors.color('dress', kind, v == null ? Math.floor(rnd() * 8) : v);
    const put = (x, y0, z, w, h, d, c, cell, glow) => D.push(r3(x), r3(y0), r3(z), r3(w), r3(h), r3(d), c, cell == null ? 255 : cell, Math.round((glow || 0) * 100));
    const want = {};
    for (const [kind, p] of list) want[kind] = p;
    const SC = Interiors.cellIndex('screen');
    // 家具の上（机の島の席ごと: キーボード・マグ・書類）
    const deskId = KIND_ID.desk_pod;
    if (want.keyboard || want.mug || want.papers) for (let i = g.p0; i < g.p1; i++) {
      const o = i * PSTRIDE;
      if (P[o + 6] !== deskId) continue;
      const r = [P[o], P[o + 2], P[o + 3], P[o + 5]], yt = P[o + 4], dir = P[o + 7];
      const opp = [1, 0, 3, 2];
      for (const d of [dir, opp[dir]]) for (const a of [0.25, 0.75]) {
        if (want.keyboard && rnd() < want.keyboard) { const q = partRect(r, d, a - 0.09, 0.66, a + 0.09, 0.74); put((q[0] + q[2]) / 2, yt, (q[1] + q[3]) / 2, q[2] - q[0], 0.02, q[3] - q[1], dc('keyboard', 0), Interiors.cellIndex('laminate')); }
        if (want.mug && rnd() < want.mug) { const q = partRect(r, d, a + 0.13, 0.62, a + 0.17, 0.66); put((q[0] + q[2]) / 2, yt, (q[1] + q[3]) / 2, q[2] - q[0], 0.1, q[3] - q[1], dc('mug')); }
        if (want.papers && rnd() < want.papers) { const q = partRect(r, d, a - 0.22, 0.62, a - 0.13, 0.78); put((q[0] + q[2]) / 2, yt, (q[1] + q[3]) / 2, q[2] - q[0], 0.02 + rnd() * 0.04, q[3] - q[1], dc('papers', 0), Interiors.cellIndex('paper')); }
      }
    }
    // 建物の固い箱（間仕切り・階段の踊り場・シャフト・外壁）と斜路に壁の飾りが入らない（T 字の間仕切り・階段室の中の壁）
    const solid = (x0, y0, z0, x1, y1, z1) => {
      for (const q of B.boxes) {
        if (q.f & NOCOL) continue;
        const qy = q.y || 0;
        if (q.x + q.w / 2 <= x0 || q.x - q.w / 2 >= x1 || q.z + q.d / 2 <= z0 || q.z - q.d / 2 >= z1 || qy + q.h <= y0 || qy >= y1) continue;
        return true;
      }
      for (const r of B.ramps) {
        if (r.f & NOCOL) continue;
        const rx0 = r.x - r.w / 2, rx1 = r.x + r.w / 2, rz0 = r.z - r.d / 2, rz1 = r.z + r.d / 2;
        if (rx1 <= x0 || rx0 >= x1 || rz1 <= z0 || rz0 >= z1) continue;
        const px = Math.max(rx0, Math.min(rx1, (x0 + x1) / 2)), pz = Math.max(rz0, Math.min(rz1, (z0 + z1) / 2));
        let lo = Infinity, hi = -Infinity;
        for (const [ax, az] of [[x0, z0], [x1, z1], [x0, z1], [x1, z0], [px, pz]]) {
          const t = rampTop(r, Math.max(rx0, Math.min(rx1, ax)), Math.max(rz0, Math.min(rz1, az)));
          if (t < lo) lo = t; if (t > hi) hi = t;
        }
        if (hi > y0 && lo - (r.t || 0.3) < y1) return true;
      }
      return false;
    };
    // 壁の面 sp の前（面から部屋の側へ dep + 2 cm）の a0〜a1・y0〜y1 が固い箱にかかるか
    const hitsSolid = (sp, a0, a1, y0, y1, dep) => {
      const inw = -(sp.nx + sp.nz), f0 = sp.face + inw * 0.001, f1 = sp.face + inw * (dep + 0.022), n0 = Math.min(f0, f1), n1 = Math.max(f0, f1);
      return sp.along ? solid(a0, y0, n0, a1, y1, n1) : solid(n0, y0, a0, n1, y1, a1);
    };
    // 床に平ら: 敷物（低いテーブル・ソファの下）・倉庫の床の線（ラックの長い辺から通路へ 0.25 m）
    const kid = (n) => KIND_ID[n];
    for (let i = g.p0; i < g.p1; i++) {
      const o = i * PSTRIDE, kd = P[o + 6];
      const x0 = P[o], z0 = P[o + 2], x1 = P[o + 3], z1 = P[o + 5];
      if (want.rug && (kd === kid('coffee_table') || kd === kid('dining')) && rnd() < want.rug) {
        const m = 0.7;
        put((x0 + x1) / 2, y + 0.005, (z0 + z1) / 2, x1 - x0 + 2 * m, 0.006, z1 - z0 + 2 * m, dc('rug', 0), Interiors.cellIndex('rug'));
      }
      if (want.floorline && kd === kid('rack') && rnd() < want.floorline) {
        const lx = x1 - x0 > z1 - z0;
        for (const sg of [-1, 1]) {
          // 壁の側（ラックが壁に付いている）の線は描かない
          if (lx) { const lz = sg < 0 ? z0 - 0.3 : z1 + 0.3; if (!solid(x0, y + 0.002, lz - 0.05, x1, y + 0.012, lz + 0.05)) put((x0 + x1) / 2, y + 0.005, lz, x1 - x0, 0.004, 0.08, dc('floorline', 0)); }
          else { const lx2 = sg < 0 ? x0 - 0.3 : x1 + 0.3; if (!solid(lx2 - 0.05, y + 0.002, z0, lx2 + 0.05, y + 0.012, z1)) put(lx2, y + 0.005, (z0 + z1) / 2, 0.08, 0.004, z1 - z0, dc('floorline', 0)); }
        }
      }
    }
    // スタンド（家具の上 ≤ 0.15 m: テレビ台・タンス・サイドボード・低いテーブル）と床の暖かい光のたまり
    const hexRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const lampLight = (x, z, rad, hex, gain) => { const c = hexRgb(hex); out.lights.push(r3(x), r3(y), r3(z), rad, c[0], c[1], c[2], gain); };
    const LL = LK.lights || {};
    if (want.lamp) for (let i = g.p0; i < g.p1; i++) {
      const o = i * PSTRIDE, kd = P[o + 6];
      if (kd !== kid('tv_stand') && kd !== kid('dresser') && kd !== kid('credenza')) continue;
      if (rnd() > want.lamp) continue;
      const x0 = P[o], z0 = P[o + 2], x1 = P[o + 3], z1 = P[o + 5], yt = P[o + 4];
      const lx = x0 + (x1 - x0) * (0.18 + rnd() * 0.15), lz = (z0 + z1) / 2;
      put(lx, yt, lz, 0.16, 0.14, 0.16, dc('lamp', 0), 255, 1.3);
      lampLight(lx, lz, LL.lampRadius || 2.2, LL.lampColor || '#ffd29a', LL.lampGain || 2.6);
    }
    // ロビー: 床の真鍮の線（4 m ごとの格子。床に平ら）
    if (want.inlay && rnd() < want.inlay) {
      const w = B.fr.rect(B.wt + 0.6, B.wt + 0.6, B.W - B.wt - 0.6, B.D - B.wt - 0.6), step = 4, lw = 0.05;
      // 線は 0.5 m ずつ見て、間仕切り・柱・階段にかからない続きだけ描く
      const line = (alongX, c, a0, a1) => {
        let r0 = null;
        for (let t = a0; t < a1 + 1e-6; t += 0.5) {
          const t1 = Math.min(a1, t + 0.5), hit = t1 - t < 1e-3 ? true : (alongX ? solid(t, y + 0.002, c - lw, t1, y + 0.012, c + lw) : solid(c - lw, y + 0.002, t, c + lw, y + 0.012, t1));
          if (!hit && r0 == null) r0 = t;
          if ((hit || t1 >= a1 - 1e-6) && r0 != null) {
            const e = hit ? t : t1;
            if (e - r0 >= 0.5) { if (alongX) put((r0 + e) / 2, y + 0.006, c, e - r0, 0.003, lw, dc('inlay', 0), 255, 0.15); else put(c, y + 0.006, (r0 + e) / 2, lw, 0.003, e - r0, dc('inlay', 0), 255, 0.15); }
            r0 = null;
          }
          if (t1 >= a1 - 1e-6) break;
        }
      };
      for (let xx = w[0] + step; xx < w[2] - 0.5; xx += step) line(false, xx, w[1], w[3]);
      for (let zz = w[1] + step; zz < w[3] - 0.5; zz += step) line(true, zz, w[0], w[2]);
    }
    // ロビーのベンチの下の敷物
    if (want.benchrug) for (let i = g.p0; i < g.p1; i++) {
      const o = i * PSTRIDE;
      if (P[o + 6] !== kid('bench') || rnd() > want.benchrug) continue;
      // 部屋の内側（外壁の内張りの内）に切り、間仕切り・柱にかかるなら敷かない
      const w = B.fr.rect(B.wt + 0.05, B.wt + 0.05, B.W - B.wt - 0.05, B.D - B.wt - 0.05);
      const x0 = Math.max(P[o] - 0.5, Math.min(w[0], w[2])), x1 = Math.min(P[o + 3] + 0.5, Math.max(w[0], w[2]));
      const z0 = Math.max(P[o + 2] - 0.5, Math.min(w[1], w[3])), z1 = Math.min(P[o + 5] + 0.5, Math.max(w[1], w[3]));
      if (x1 - x0 < 0.5 || z1 - z0 < 0.5 || solid(x0, y + 0.002, z0, x1, y + 0.012, z1)) continue;
      put((x0 + x1) / 2, y + 0.005, (z0 + z1) / 2, x1 - x0, 0.006, z1 - z0, dc('rug', 1), Interiors.cellIndex('rug'));
    }
    // 壁の面: 場所（B._spots）の前に背の高い家具が無いこと
    const spots = B._spots || [];
    const blocked = (sp, c0, c1, y0, y1) => {
      for (let i = g.b0; i < g.b1; i++) {
        const q = out.boxes[i];
        if (q.y > y1 || q.y + q.h < y0 - 0.9) continue;
        const a0 = sp.along ? q.x - q.w / 2 : q.z - q.d / 2, a1 = sp.along ? q.x + q.w / 2 : q.z + q.d / 2;
        if (a1 < c0 - 0.05 || a0 > c1 + 0.05) continue;
        const n0 = sp.along ? q.z - q.d / 2 : q.x - q.w / 2, n1 = sp.along ? q.z + q.d / 2 : q.x + q.w / 2;
        const inw = -(sp.nx + sp.nz); // 部屋の側の向き（+1 / −1）
        const f = sp.face, far = f + inw * 0.6;
        if (Math.max(n0, Math.min(f, far)) < Math.min(n1, Math.max(f, far)) && q.y + q.h > y0 - 0.3) return true;
      }
      return false;
    };
    // 1 階あたりの数の上限（look.dressMax。場所 = 壁の面ごとに割合で振るので、無いと間仕切りの多い階に何十も並ぶ）
    const capOf = LK.dressMax || {}, count = {};
    const capped = (kind) => capOf[kind] != null && (count[kind] || 0) >= capOf[kind];
    const wall = (sp, w, h, y0, c, cell, glow) => {
      const len = sp.s1 - sp.s0;
      if (len < w + 0.2) return false;
      const ca = sp.s0 + 0.1 + w / 2 + rnd() * (len - w - 0.2);
      const used = sp.used || (sp.used = []);
      for (const u of used) if (ca - w / 2 < u[1] + 0.15 && ca + w / 2 > u[0] - 0.15 && y0 < u[3] && y0 + h > u[2]) return false; // ほかの飾りと重ねない
      if (blocked(sp, ca - w / 2, ca + w / 2, y0, y0 + h)) return false;
      const inw = -(sp.nx + sp.nz), dep = 0.03, fc = sp.face + inw * (dep / 2 + 0.002);
      if (hitsSolid(sp, ca - w / 2 - 0.02, ca + w / 2 + 0.02, y0, y0 + h, dep)) return false;
      used.push([ca - w / 2, ca + w / 2, y0, y0 + h]);
      if (sp.along) put(ca, y0, fc, w, h, dep, c, cell, glow); else put(fc, y0, ca, dep, h, w, c, cell, glow);
      return true;
    };
    // 1 階に 1 つだけの物（看板・番号札・非常口）は一番長い壁に、ほかは割合で
    const order = spots.map((sp, i) => [sp, i]).sort((a, b2) => (b2[0].s1 - b2[0].s0) - (a[0].s1 - a[0].s0) || a[1] - b2[1]).map((a) => a[0]);
    const once = { sign: SIGNS[tenant || use], queue: SIGNS.queue, exit: SIGNS.exit, open: SIGNS.open, ticker: null };
    const done = {};
    for (const sp of order) {
      for (const [kind, p] of list) {
        if (kind in once) {
          if (done[kind] || rnd() > p) continue;
          let okw = false;
          if (kind === 'sign') okw = once.sign != null && wall(sp, 0.9, 0.9, y + 1.25, dc('sign', 0), SC + 16 + once.sign, 1.2);
          else if (kind === 'queue') okw = wall(sp, 0.7, 0.7, y + 1.4, dc('sign', 0), SC + 16 + SIGNS.queue, 1.0);
          else if (kind === 'exit') okw = wall(sp, 0.4, 0.4, y + Math.min(2.1, clear - 0.5), dc('exit', 0), SC + 16 + SIGNS.exit, 1.2);
          else if (kind === 'open') okw = wall(sp, 0.6, 0.6, y + 1.5, dc('sign', 0), SC + 16 + SIGNS.open, 1.4);
          else if (kind === 'ticker') okw = wall(sp, Math.min(3.2, sp.s1 - sp.s0 - 0.3), 0.18, y + Math.min(2.25, clear - 0.35), dc('sign', 0), SC + Math.floor(rnd() * 4), 1.0);
          if (okw) done[kind] = true;
          continue;
        }
        if (rnd() > p || capped(kind)) continue;
        const before = (sp.used || []).length;
        if (kind === 'whiteboard') wall(sp, 1.6, 1.0, y + 1.0, dc('whiteboard', 0), Interiors.cellIndex('paper'));
        else if (kind === 'diploma') { for (let q = 0; q < 3; q++) wall(sp, 0.35, 0.28, y + 1.4 + (q % 2) * 0.35, dc('frame')); }
        else if (kind === 'poster') wall(sp, 0.7, 1.0, y + 1.05, dc('poster'));
        else if (kind === 'moodboard') wall(sp, 1.2, 0.9, y + 1.1, dc('moodboard', 0), Interiors.cellIndex('cork'));
        else if (kind === 'clock') wall(sp, 0.35, 0.35, y + 1.75, dc('clock', 0), SC + Math.floor(rnd() * 4), 0.6);
        else if (kind === 'tv') wall(sp, 1.2, 0.7, y + 1.05, dc('tv', 0), SC + 12 + Math.floor(rnd() * 4), 0.7);
        else if (kind === 'sconce') wall(sp, 0.18, 0.3, y + 1.6, dc('sconce', 0), 255, 1.0);
        else if (kind === 'neon') wall(sp, 1.6, 0.08, y + 2.0, dc('neon'), 255, 1.6);
        else if (kind === 'firecab') wall(sp, 0.4, 0.6, y + 0.9, dc('firecab', 0), Interiors.cellIndex('steel'));
        else if (kind === 'sconce2') { if (wall(sp, 0.18, 0.3, y + 1.6, dc('sconce', 0), 255, 1.2)) { const u = sp.used[sp.used.length - 1], ca = (u[0] + u[1]) / 2, inw = -(sp.nx + sp.nz); lampLight(sp.along ? ca : sp.face + inw * 0.8, sp.along ? sp.face + inw * 0.8 : ca, LL.sconceRadius || 1.6, LL.lampColor || '#ffd29a', LL.sconceGain || 1.8); } }
        if ((sp.used || []).length > before) count[kind] = (count[kind] || 0) + 1;
      }
    }
    // カーテン: 窓（床から 0.3 m より上に窓台がある開口）の左右の壁の面に 1 枚ずつ（開口には掛けない。壁がある所だけ）
    if (want.curtain) {
      const O = out.open;
      for (let q = g.o0; q < g.o1; q++) {
        const b = q * OSTRIDE, ax = O[b], az = O[b + 1], bx = O[b + 2], bz = O[b + 3], sill = O[b + 7], head = O[b + 8];
        if (sill < y + 0.3 || rnd() > want.curtain) continue;
        const along = Math.abs(az - bz) < 1e-3, a0 = along ? Math.min(ax, bx) : Math.min(az, bz), a1 = along ? Math.max(ax, bx) : Math.max(az, bz);
        const cw = 0.35, top = Math.min(head + 0.12, y + clear - 0.05), bot = y + 0.12;
        for (const [c0, c1] of [[a0 - cw - 0.02, a0 - 0.02], [a1 + 0.02, a1 + cw + 0.02]]) {
          // 同じ面の壁の場所がこの幅を床から天井まで持っている（窓の横の柱）
          const sp = spots.find((t) => t.along === along && Math.abs(t.face - (along ? az : ax)) < 0.4 && t.s0 <= c0 + 1e-3 && t.s1 >= c1 - 1e-3);
          if (!sp) continue;
          if (hitsSolid(sp, c0, c1, bot, top, 0.04)) continue;
          const used = sp.used || (sp.used = []);
          if (used.some((u) => c0 < u[1] + 0.05 && c1 > u[0] - 0.05 && bot < u[3] && top > u[2])) continue; // ほかの壁の飾りと重ねない
          used.push([c0, c1, bot, top]);
          const inw = -(sp.nx + sp.nz), dep = 0.04, fc = sp.face + inw * (dep / 2 + 0.004);
          const col = dc('curtain', 0);
          if (along) put((c0 + c1) / 2, bot, fc, c1 - c0, top - bot, dep, col, Interiors.cellIndex('fabric'));
          else put(fc, bot, (c0 + c1) / 2, dep, top - bot, c1 - c0, col, Interiors.cellIndex('fabric'));
        }
      }
    }
  }

  // 焼いた光: bake に家具ごとに 2 個（照明からの近さの和、一番近い開口までの距離 m）。描画（InteriorsView）が look.lightBake で明るさ・青さにする
  //   （階ごとの平均との差）。pieces と同じ番号（bake[i * 2]）。照明の光の半径 r は look.shell.bakeRadius[use]（無ければ 1.8）
  function emitBake(g, use, out) {
    const lk = (Interiors.cfg && Interiors.cfg.look && Interiors.cfg.look.shell) || {};
    const rr = lk.bakeRadius || {}, r = rr[use] || rr.default || 1.8, k2 = 1 / (2 * r * r);
    const P = out.pieces, Q = out.panels, O = out.open;
    for (let i = g.p0; i < g.p1; i++) {
      const o = i * PSTRIDE, x = (P[o] + P[o + 3]) / 2, z = (P[o + 2] + P[o + 5]) / 2;
      let s = 0;
      for (let q = g.q0; q < g.q1; q++) { const dx = Q[q * 4] - x, dz = Q[q * 4 + 2] - z; s += Math.exp(-(dx * dx + dz * dz) * k2); }
      let dmin = 99;
      for (let q = g.o0; q < g.o1; q++) {
        const b = q * OSTRIDE, ax = O[b], az = O[b + 1], vx = O[b + 2] - ax, vz = O[b + 3] - az, L2 = vx * vx + vz * vz;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)) : 0;
        const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
        if (d < dmin) dmin = d;
      }
      out.bake.push(r3(s), r3(dmin));
    }
  }

  // 家具 i の部品を出す（描画が近くの家具だけ呼ぶ）。push(x, y, z, w, h, d, 色) は y = 下端。deco = true なら飾り（椅子・モニター）も
  //   use: その階の使い方、variant: その階の色のずらし、mode: 1 = 部品だけ / 2 = 飾りだけ / 3（true）= 両方
  function expand(pieces, i, use, variant, push, mode) {
    if (mode === true || mode == null) mode = 3;
    const o = i * PSTRIDE;
    const r = [pieces[o], pieces[o + 2], pieces[o + 3], pieces[o + 5]], y = pieces[o + 1], h = pieces[o + 4] - y;
    const kind = KINDS[pieces[o + 6]], dir = pieces[o + 7], pv = variant + pieces[o + 8];
    const parts = partsOf(kind, pieces[o + 9]);
    if (mode & 1) for (const q of parts) {
      const pr = kind === 'pod_screen' ? r : partRect(r, dir, q[0], q[1], q[2], q[3]);
      const y0 = y + q[4] * h, y1 = y + q[5] * h;
      // 箱・布（机の島の仕切り・ブース）は家具ごとにずらす（同じ階の仕切りが全部同じ色にならない）
      push((pr[0] + pr[2]) / 2, y0, (pr[1] + pr[3]) / 2, pr[2] - pr[0], y1 - y0, pr[3] - pr[1], Interiors.color(use, q[6], (Interiors.lookOn ? /box|fabric/ : /box/).test(q[6]) ? pv : variant));
    }
    if (!(mode & 2)) return;
    const box = (lr, y0, y1, c) => push((lr[0] + lr[2]) / 2, y0, (lr[1] + lr[3]) / 2, lr[2] - lr[0], y1 - y0, lr[3] - lr[1], c);
    const chair = (d, a) => {
      // 席ごとに色をずらす（look の chair の表は暗い色が多く、差し色は 4 つに 1 つ = 差し色が画面を埋めない）
      const c = Interiors.color(use, 'chair', Interiors.lookOn ? variant + d * 2 + Math.round(a * 4) + pieces[o + 8] : variant), leg = Interiors.color(use, 'leg', 0);
      box(partRect(r, d, a - 0.12, 0.66, a + 0.12, 0.92), y + 0.42, y + 0.48, c);
      box(partRect(r, d, a - 0.12, 0.94, a + 0.12, 0.98), y + 0.48, y + 0.95, c);
      box(partRect(r, d, a - 0.02, 0.77, a + 0.02, 0.81), y + 0.06, y + 0.42, leg);
      box(partRect(r, d, a - 0.1, 0.69, a + 0.1, 0.89), y, y + 0.06, leg);
    };
    const opp = [1, 0, 3, 2];
    if (kind === 'desk_pod') {
      for (const d of [dir, opp[dir]]) for (const a of [0.25, 0.75]) {
        chair(d, a);
        box(partRect(r, d, a - 0.14, 0.53, a + 0.14, 0.57), y + h, y + h + 0.32, Interiors.color(use, 'screen', 0));
        box(partRect(r, d, a - 0.025, 0.56, a + 0.025, 0.61), y + h, y + h + 0.1, Interiors.color(use, 'leg', 1));
      }
    } else if (kind === 'meeting_table' || kind === 'meeting_table_l') {
      const nA = kind === 'meeting_table_l' ? 4 : 3;
      for (let q = 0; q < nA; q++) { const a = (q + 0.5) / nA; chair(dir, a); chair(opp[dir], a); }
    } else if (kind === 'workbench') {
      box(partRect(r, dir, 0.55, 0.2, 0.85, 0.6), y + h, y + h + 0.18, Interiors.color(use, 'metal', 0));
    }
  }
  // 飾りのセル（植木）: deco に 7 個ずつ（x, y, z, w, h, d, 色）
  function emitDecoCell(B, d, y, use, variant, out) {
    const fr = B.fr, i = d.i, j = d.j;
    const cu = Math.min(Math.max(i + 0.5, B.wt + 0.35), B.W - B.wt - 0.35), cv = Math.min(Math.max(j + 0.5, B.wt + 0.35), B.D - B.wt - 0.35);
    const box = (u0, v0, u1, v1, y0, y1, c) => { const b = worldBox(fr, u0, v0, u1, v1, y0, y1); out.deco.push(b[0], b[1], b[2], b[3], b[4], b[5], c); };
    if (d.t === 'plant') {
      box(cu - 0.2, cv - 0.2, cu + 0.2, cv + 0.2, y, y + 0.45, Interiors.color(use, 'pot', variant));
      box(cu - 0.3, cv - 0.3, cu + 0.3, cv + 0.3, y + 0.45, y + 1.25, Interiors.color(use, 'plant', variant));
      box(cu - 0.18, cv - 0.18, cu + 0.18, cv + 0.18, y + 1.25, y + 1.55, Interiors.color(use, 'plant', variant + 1));
    }
  }
  // 遠くの 1 箱の色
  function bodyColor(pieces, i, use, variant) {
    const o = i * PSTRIDE, kind = KINDS[pieces[o + 6]];
    return Interiors.color(use, BODY[kind] || 'laminate', /pallet_/.test(kind) ? variant + pieces[o + 8] : variant);
  }
  // 遠くの形（箱 1〜3 つ。高さの帯ごとの色で棚・ラック・ブースの見分けがつく）。無い種類は箱 1 つ（bodyColor）
  const FAR = {
    shelf: [[0, 0.02, 'metal'], [0.02, 0.97, 'paper'], [0.97, 1, 'metal']],
    shelf_1: [[0, 0.02, 'metal'], [0.02, 0.97, 'paper'], [0.97, 1, 'metal']],
    gondola: [[0, 0.08, 'metal'], [0.08, 0.86, 'product'], [0.86, 1, 'shelfback']],
    rack: [[0, 0.36, 'box'], [0.36, 0.69, 'beam'], [0.69, 1, 'box2']],
    cubicle: [[0, 0.78, 'fabric'], [0.78, 1, 'glass']],
    drinks_fridge: [[0, 0.04, 'appliance'], [0.04, 1, 'fridge_glow']],
    pallet_high: [[0, 0.08, 'pallet'], [0.08, 1, 'box']]
  };
  // 家具 i の遠くの箱の数 / 近くの部品の数（描画の上限の見積もり）
  function farCount(pieces, i) { const f = FAR[KINDS[pieces[i * PSTRIDE + 6]]]; return f ? f.length : 1; }
  function nearCount(pieces, i) { const o = i * PSTRIDE, kind = KINDS[pieces[o + 6]]; return partsOf(kind, pieces[o + 9]).length; }
  Interiors.farCount = farCount;
  Interiors.nearCount = nearCount;
  // 家具 i の遠くの箱を push する（数を返す）。single = 箱 1 つ（描画の上限に近いとき）
  function far(pieces, i, use, variant, push, single) {
    const o = i * PSTRIDE, kind = KINDS[pieces[o + 6]], f = single ? null : FAR[kind];
    const x = (pieces[o] + pieces[o + 3]) / 2, z = (pieces[o + 2] + pieces[o + 5]) / 2, w = pieces[o + 3] - pieces[o], d = pieces[o + 5] - pieces[o + 2], y = pieces[o + 1], h = pieces[o + 4] - y;
    if (!f) { push(x, y, z, w, h, d, bodyColor(pieces, i, use, variant)); return 1; }
    const pv = variant + pieces[o + 8];
    for (const q of f) push(x, y + q[0] * h, z, w, (q[1] - q[0]) * h, d, Interiors.color(use, q[2], /box|product|paper/.test(q[2]) ? pv : variant));
    return f.length;
  }
  Interiors.far = far;
  Interiors.PSTRIDE = PSTRIDE;
  Interiors.SSTRIDE = SSTRIDE;
  Interiors.OSTRIDE = OSTRIDE;
  Interiors.RSTRIDE = RSTRIDE;
  Interiors.LSTRIDE = LSTRIDE;
  Interiors.SH = { NOCONTACT: SH_NOCONTACT, NOEDGE: SH_NOEDGE, CEIL: SH_CEIL, LINER: SH_LINER, FLOOR: SH_FLOOR };
  Interiors.KINDS = KINDS;
  Interiors.Out = Out;
  Interiors.expand = expand;
  Interiors.bodyColor = bodyColor;

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  function ruleAt(ctx, x, z) {
    const plan = ctx && ctx.city && ctx.city.plan;
    if (!plan || !plan.districts) return null;
    for (const d of plan.districts) { if (!d.rule) continue; const r = d.rect; if (x >= r[0] && x < r[2] && z >= r[1] && z < r[3]) return d.rule; }
    return null;
  }

  // ---------- 当たり判定への出し入れ（CityWorld が持つ）----------
  // 家具はチャンク cx_cz ごとに別のキー cx_cz#f で nav に入れる（nav.addChunk(key + '#f', { cx, cz, boxes })、記録に ch.furn = true）。
  //   入れるのは active（game.js: 生きていて歩き・地上の乗り物。ヘリ・戦闘機・輸送ヘリ・降下・パラシュートでは false）の間だけ、
  //   プレイヤーの周り 3 × 3 の、土台のチャンクが nav にあるものだけ。active が false になったら全部すぐ外す（描画も一緒）。
  //   作るのは 1 フレームに updateNav の残りの仕事の数（1 階 = 1 つ、足す = 1 つ）と ms の上限の中。ただし建物（矩形 × 1 階の床〜屋上）の中に
  //   プレイヤー（今の位置と 0.25 秒先）が入ったら、そのチャンクはその場で全部作って足す（家具の無い建物の中に立たない）。
  //   状態: なし → gen（job。1 階ずつ）→ ready（結果を持つ）→ added。途中で要らなくなった・土台が外れた・active が false・置き直しは捨てる。
  //   ver（world.furnVer）は足す・外すたびに 1 増える（描画が詰め直す。navVer は変えない = 乗り物の出し入れの時を変えない）
  const EMPTY = { boxes: [], pieces: new Float32Array(0), deco: new Float32Array(0), panels: new Float32Array(0), shell: new Float32Array(0), open: new Float32Array(0), bake: new Float32Array(0), dress: new Float32Array(0), lights: new Float32Array(0), groups: [], stats: {}, empty: true };
  class Manager {
    constructor(world, json, opts) {
      opts = opts || {};
      Interiors.configure(json);
      this.world = world;
      this.ctx = { engine: world.city.plan.engine, player: opts.player || {}, levelId: opts.levelId || 'midtown', city: world.city };
      this.active = true;
      this.added = new Map(); // 土台のキー → 結果
      this.cacheMax = opts.cache == null ? 6 : opts.cache; // 外した結果を少しだけ覚えておく（行ったり来たりで作り直さない・ごみを減らす）
      this.cache = new Map();
      this.jobs = new Map();  // 作りかけ: 土台のキー → { key, it, res }（近い建物のチャンクを先に進め、ほかは止めておく）
      this.vols = new Map();  // 土台のキー → 建物の体積 [{ x0, z0, x1, z1, y0, y1 }]
      this.ver = 0;
      this.onAdded = null;    // (key, res) → game.js（家具の中に入った敵・プレイヤーを出す）
      this.stats = { jobs: 0, aborted: 0, added: 0, removed: 0, sync: 0, steps: 0, stepMsMax: 0, syncMsMax: 0, frames: 0, insideMissing: 0 };
    }
    _bump() { this.ver++; this.world.furnVer = this.ver; }
    _volumes(key) {
      let v = this.vols.get(key);
      if (v) return v;
      const p = key.split('_'), full = this.world.cache.full(+p[0], +p[1]);
      v = [];
      if (full) for (const b of full.buildings || []) {
        if (!Interiors.wants(b, this.ctx.levelId)) continue;
        // ロビー（屋上の点なし）は 1 階だけ: 扉の高さ + lobbyVolume m。屋上（roof の高さ）は中に数えない: 最上階の足は roof − 階の高さ
        //   くらい（以前は roof + 0.5 で、屋上に降りる・ヘリから降りるたびにそのチャンクを 1 フレームで全部作っていた）
        const y1 = b.roof ? b.roof[1] - ((Interiors.cfg.rules || {}).roofVolumeGap || 1) : b.door[1] + ((Interiors.cfg.rules || {}).lobbyVolume || 8);
        v.push({ id: b.id, x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y0: b.door[1] - 1, y1 });
      }
      this.vols.set(key, v);
      return v;
    }
    _inVol(key, x, y, z) { return !!this._volAt(key, x, y, z); }
    _volAt(key, x, y, z) {
      for (const b of this._volumes(key)) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1) return b;
      return null;
    }
    // 階のまとまり（groups）に点の階があるか（作りかけの結果は出来た階だけ）
    static _hasFloor(groups, id, y) {
      for (const g of groups) if (g.id === id && y >= g.y - 0.5 && y <= g.top + 0.5) return true;
      return false;
    }
    // その点（建物の中）の階の家具が当たり判定にあるか。建物の外なら true
    _covered(key, x, y, z) {
      const r = this.added.get(key);
      if (r && !r.partial) return true;
      const v = this._volAt(key, x, y, z);
      if (!v) return true;
      return !!r && Manager._hasFloor(r.groups, v.id, y);
    }
    _wanted(cx, cz) {
      const nav = this.world.nav, city = this.world.city, out = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= city.ncx || z >= city.ncz) continue;
        const k = x + '_' + z;
        if (nav.hasChunk(k)) out.push(k);
      }
      return out;
    }
    get job() { for (const j of this.jobs.values()) return j; return null; }
    _abort(key) {
      if (key != null) { if (this.jobs.delete(key)) this.stats.aborted++; return; }
      this.stats.aborted += this.jobs.size;
      this.jobs.clear();
    }
    _remove(key) {
      const r = this.added.get(key);
      if (!r) return;
      this.added.delete(key);
      if (r === EMPTY) return;
      this.world.nav.removeChunk(key + '#f');
      if (this.cacheMax > 0 && !r.partial) { this.cache.delete(key); this.cache.set(key, r); while (this.cache.size > this.cacheMax) this.cache.delete(this.cache.keys().next().value); }
      this.stats.removed++;
      this._bump();
    }
    clear() {
      this._abort();
      for (const k of Array.from(this.added.keys())) this._remove(k);
    }
    _add(key, res) {
      const prev = this.added.get(key);
      if (prev && prev !== EMPTY) this.world.nav.removeChunk(key + '#f'); // 作りかけを先に足していた: 全部に差し替える
      if (!res.boxes.length && !res.groups.length && !res.partial) { this.added.set(key, EMPTY); if (prev && prev !== EMPTY) this._bump(); return; }
      const p = key.split('_');
      const ch = this.world.nav.addChunk(key + '#f', { cx: +p[0], cz: +p[1], boxes: res.boxes });
      ch.furn = true;
      this.added.set(key, res);
      this.stats.added++;
      this._bump();
      if (this.onAdded) this.onAdded(key, res);
    }
    // 1 歩（1 階 / 足す）。done なら true
    _step(key) {
      let j = this.jobs.get(key);
      if (!j && this.cache.has(key)) { const r = this.cache.get(key); this.cache.delete(key); this._add(key, r); this.stats.cacheHits = (this.stats.cacheHits || 0) + 1; return true; }
      if (!j) {
        j = this._newJob(key, null);
        if (!j) return true;
      }
      if (j.res) { this.jobs.delete(key); this._add(key, j.res); return true; }
      const t0 = now();
      const r = j.it.next();
      const ms = now() - t0;
      this.stats.steps++;
      if (ms > this.stats.stepMsMax) this.stats.stepMsMax = ms;
      if (r.done) j.res = r.value;
      this._lastYield = r.value;
      return false;
    }
    _newJob(key, prio) {
      const p = key.split('_'), full = this.world.cache.full(+p[0], +p[1]);
      if (!full) return null;
      const out = new Out(full);
      const j = { key, it: Interiors.job(full, this.ctx, prio, out), out, res: null, prio: prio ? prio.id : null };
      this.jobs.set(key, j);
      this.stats.jobs++;
      return j;
    }
    _drain(key) {
      const t0 = now();
      let n = 0;
      while (!this._step(key) && n++ < 10000) {}
      this.stats.sync++;
      const ms = now() - t0;
      if (ms > this.stats.syncMsMax) this.stats.syncMsMax = ms;
    }
    // 建物の中の点（置き直し・入った所）: その階だけ今すぐ作って作りかけのまま足す（チャンクの残りは予算で後から）。
    //   以前はチャンクを全部（いちばん混んだチャンクで 20〜40 ms、2 つで 50〜100 ms）その場で作っていた
    _drainAt(key, x, y, z) {
      const v = this._volAt(key, x, y, z);
      if (!v) return;
      const t0 = now();
      let j = this.jobs.get(key);
      if (!j && this.cache.has(key)) { const r = this.cache.get(key); this.cache.delete(key); this._add(key, r); this.stats.cacheHits = (this.stats.cacheHits || 0) + 1; }
      else {
        // 別の順で作りかけの仕事: その階がまだなら点の建物・階から作り直す（出来ていれば済み）
        if (j && !j.res && j.prio !== v.id && !Manager._hasFloor(j.out.groups, v.id, y)) { this._abort(key); j = null; }
        if (!j) j = this._newJob(key, { x, y, z, id: v.id });
        let n = 0;
        // 点の建物を先に作るので、ほかの建物の階が出来始めたら（点がどの階にも入らない高さ・組み立て直せない建物）そこで止める
        const past = () => { const g = j.out.groups; return g.length > 0 && g[g.length - 1].id !== v.id; };
        while (j && !j.res && !Manager._hasFloor(j.out.groups, v.id, y) && !past() && n++ < 10000) this._step(key);
        if (j) {
          if (j.res) { this.jobs.delete(key); this._add(key, j.res); }
          else this._add(key, j.out.finish(true));
        }
      }
      this.stats.sync++;
      this.stats.syncFloor = (this.stats.syncFloor || 0) + 1;
      const ms = now() - t0;
      if (ms > this.stats.syncMsMax) this.stats.syncMsMax = ms;
    }
    // 毎フレーム（world.update が updateNav の後に）。p: 足元 {x, y, z}、vel: {x, z}（無ければ 0）
    update(p, vel, ops, msCap) {
      this.stats.frames++;
      if (!this.active || !p) { if (this.added.size || this.jobs.size) this.clear(); return; }
      const city = this.world.city, c = city.chunkOf(p.x, p.z);
      const want = this._wanted(c.cx, c.cz);
      // 要らなくなった物・土台が外れた物を外す
      for (const k of Array.from(this.added.keys())) if (want.indexOf(k) < 0) this._remove(k);
      for (const k of Array.from(this.jobs.keys())) if (want.indexOf(k) < 0) this._abort(k);
      for (const k of Array.from(this.vols.keys())) if (!this.world.nav.hasChunk(k)) this.vols.delete(k);
      // 建物の中（今と 0.25 秒先）: 家具の無いチャンクはその場で全部
      const vx = vel ? vel.x || 0 : 0, vz = vel ? vel.z || 0 : 0;
      const pts = [[p.x, p.z], [p.x + vx * 0.25, p.z + vz * 0.25]];
      for (const pt of pts) {
        const cc = city.chunkOf(pt[0], pt[1]);
        // 建物は持ち主のチャンクの外へはみ出すので、周りの wanted も見る
        for (const k of want) {
          const kp = k.split('_');
          if (Math.abs(+kp[0] - cc.cx) > 1 || Math.abs(+kp[1] - cc.cz) > 1) continue;
          if (!this._covered(k, pt[0], p.y, pt[1])) this._drainAt(k, pt[0], p.y, pt[1]);
        }
      }
      // 残り: 予算の中で近い順に
      let left = ops == null ? 2 : ops;
      const cap = msCap > 0 ? msCap : Infinity, t0 = now();
      if (cap < 0.05) left = 0; // updateNav が ms の上限まで使った: このフレームは家具の仕事を始めない（建物の中の分は上でもう済ませた）
      let done = 0;
      while (left > 0) {
        if (done > 0 && now() - t0 >= cap) break;
        let key = null;
        {
          // 近い建物のチャンクから（建物の矩形までの距離。作りかけでも、もっと近い建物のチャンクがあればそちらを先に。
          //   家具を入れる建物の無いチャンクは空のまま済ませる）
          let bd = Infinity;
          for (const k of want) {
            const a = this.added.get(k);
            if (a && !a.partial) continue;
            const vs = this._volumes(k);
            if (!vs.length) { this.added.set(k, EMPTY); continue; }
            let d = Infinity;
            for (const b of vs) d = Math.min(d, Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.z0 - p.z, 0, p.z - b.z1)));
            if (d < bd) { bd = d; key = k; }
          }
        }
        if (!key) break;
        // 1 つの仕事 = 1 階（部屋ごとの歩を、階が終わる・足す・ms の上限まで続ける）
        let fin;
        do { fin = this._step(key); done++; } while (!fin && typeof this._lastYield !== 'number' && now() - t0 < cap);
        left--;
      }
      // 確かめ（テスト用）: 家具の無い建物の中に立っている
      for (const k of want) if (!this._covered(k, p.x, p.y, p.z)) { this.stats.insideMissing++; break; }
    }
    // 置き直し（loadNavNow の後）: 作りかけを捨て、その点を含む建物のチャンクだけ今すぐ（ほかは予算で後から）
    placeNow(x, z, y) {
      this._abort();
      if (!this.active) return;
      const c = this.world.city.chunkOf(x, z);
      for (const k of this._wanted(c.cx, c.cz)) {
        const a = this.added.get(k);
        if (a && !a.partial) continue;
        // 建物の矩形 + placeMargin（扉の点は正面の 1.5 m 外。扉の前に置かれたらすぐ入る建物の家具も今すぐ）。
        //   高さが分かればその階だけ（_drainAt。矩形の外の点は矩形の中の一番近い点の、同じ高さの階）、分からなければチャンクを全部
        const m = Interiors.cfg && Interiors.cfg.rules && Interiors.cfg.rules.placeMargin != null ? Interiors.cfg.rules.placeMargin : 2.5;
        for (const b of this._volumes(k)) {
          if (!(x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m && (y == null || (y >= b.y0 && y <= b.y1)))) continue;
          if (y == null) { this._drain(k); break; }
          const qx = Math.max(b.x0, Math.min(b.x1, x)), qz = Math.max(b.z0, Math.min(b.z1, z));
          if (!this._covered(k, qx, y, qz)) this._drainAt(k, qx, y, qz);
        }
      }
    }
    // 家具の中ではない点（足元）。家具の箱の中なら、同じ建物・同じ階の内側で近い空いた所、無ければ扉の点
    safeSpot(x, y, z, r) {
      r = r == null ? 0.4 : r;
      const rr = Math.max(0, r - 0.05); // カプセルが箱にちょうど触れている所は中ではない
      let hitG = null, hitRes = null;
      for (const res of this.added.values()) {
        for (const g of res.groups) {
          if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1 || y < g.y - 0.3 || y > g.top) continue;
          for (let b = g.b0; b < g.b1; b++) {
            const q = res.boxes[b];
            if (x > q.x - q.w / 2 - rr && x < q.x + q.w / 2 + rr && z > q.z - q.d / 2 - rr && z < q.z + q.d / 2 + rr && y < q.y + q.h - 0.05 && y + 1.7 > q.y) { hitG = g; hitRes = res; break; }
          }
          if (hitG) break;
        }
        if (hitG) break;
      }
      if (!hitG) return null;
      return this._nearIn(hitG, hitRes, x, z, r, true);
    }
    // 同じ建物・同じ階（足元 y が床〜天井の階）の床の近い空いた所（家具の上に立っているプレイヤーを追う敵の目標）。無ければ null
    floorNear(x, y, z, r) {
      for (const res of this.added.values()) for (const g of res.groups) {
        if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1 || y < g.y - 0.05 || y > g.top - 1) continue;
        return this._nearIn(g, res, x, z, r == null ? 0.4 : r, false);
      }
      return null;
    }
    _nearIn(g, hitRes, x, z, r, door) {
      const nav = this.world.nav, fy = g.y;
      const ok = (px, pz) => {
        if (px < g.ix0 + r || px > g.ix1 - r || pz < g.iz0 + r || pz > g.iz1 - r) return false;
        const gi = nav.groundInfo(px, pz, fy + 0.3, 0.2);
        if (gi.y === null || Math.abs(gi.y - fy) > 0.3) return false;
        const q = nav.resolveCapsule({ x: px, y: gi.y, z: pz }, r, 1.8, 0.45, { snapDown: 0.05 });
        if (Math.hypot(q.x - px, q.z - pz) > 0.05 || Math.abs(q.y - gi.y) > 0.05) return false;
        return nav.ceilingHeight(px, pz, gi.y + 0.2, r) >= gi.y + 1.8;
      };
      const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5;
      for (let rad = 0; rad <= 6; rad++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
        const px = cx + dx, pz = cz + dz;
        if (ok(px, pz)) return { x: px, y: fy, z: pz, moved: true };
      }
      if (!door) return null;
      // 扉の点
      const full = this.world.cache.full(hitRes.cx, hitRes.cz);
      const b = full && full.buildings.find((q) => q.id === g.id);
      if (b) return { x: b.door[0], y: b.door[1], z: b.door[2], moved: true, door: true };
      return null;
    }
    // nav に入っている家具のチャンクの数（空のチャンクは nav に入れない）
    navCount() { let n = 0; for (const r of this.added.values()) if (r !== EMPTY) n++; return n; }
    info() {
      let pieces = 0;
      for (const r of this.added.values()) pieces += r.boxes.length;
      return Object.assign({ chunks: this.added.size, pieces, job: this.job ? this.job.key : null, jobsPaused: this.jobs.size, ver: this.ver, active: this.active }, this.stats);
    }
  }
  Interiors.Manager = Manager;

  Interiors.Frame = Frame;
  MR.Interiors = Interiors;
  if (typeof module !== 'undefined' && module.exports) module.exports = Interiors;
})(typeof window !== 'undefined' ? window : globalThis);
