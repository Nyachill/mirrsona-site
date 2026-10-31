// 建物の外壁（MR.Facade。plan dev-notes/plans/buildings-hq.md の B1。オーナー「建物雑すぎるからちゃんとして」）:
//   窓を描いたテクスチャ（6 種、同じ材質の建物は全部同じ壁）の代わりに、窓をシェーダーで建物ごとのデータから描く 1 つの材質。
//   近景の柱（v2 の街 = manhattan の chunkFull().prisms）の窓のある外壁を全部この材質の 1 つのメッシュに（チャンクごと。描画が減る）。
//
// ■ 前半（THREE / DOM を使わない。Node でも動く）
//   LAYOUTS: 窓割りの種類（0 窓なし・1 ブラウンストーン・2 戦前のれんが・3 鋳鉄・4 アールデコ・5 ガラスのカーテンウォール・6 戦後の横長の窓・
//     7 工場・8 公共の石・9 小さい家・10 戦前の石の事務所）ごとの数。シェーダーの uniform（uFacStyle）も JS の facadeAt もこの表から = 同じ計算
//   table(city): gid → 建物の数（1 階の床 base・一番上 maxY・階数）。core の片（P.gid …）を 1 回なめて作る（決定的。どのチャンクから見ても同じ）
//   params(p, city, cfg) → fp（片 1 つの外壁の数: layout・seed・bay・storey・groundH・base・top・色・plain）。gid ごとに覚える（building(gid)）
//   walls(p, fp, cb): 柱の外壁の辺ごとに cb(ax, az, bx, bz, ya0, ya1, yb0, yb1, nx, nz, uA, uB, bay, sign, plain)。u は辺の始点から m（窓の列が
//     辺に整数個 = 角で窓が切れない）、チャンクの切り口に接する辺だけ切り口の点の座標（world.js prismWalls と同じ = 隣のチャンクと列がつながる）
//   setAttrs(g, fp, bay, sign, plain): CityGeo の追加の頂点属性（ATTRS）の今の値。world.js の _fullPrism（と B3 の _fullBox）が辺 / 面ごとに呼ぶ
//   facadeAt(x, y, z, n, p): 壁の点の窓のセル（destruct の弾の跡・ガラス・コーニスの破片用）。p = 柱（chunkFull().prisms の 1 つ）
// ■ 後半（THREE）
//   material(materials, opts): MeshStandardMaterial + onBeforeCompile（r128。GLSL ES 1.0 / 3.0 のどちらでも）。Materials ごとに 1 つ
//   （register('cityFacade')。天気の環境マップの倍率・ストーリーの灯りの dim もほかの材質と同じに効く）。configure(cfg) でゲームごとの
//   窓の発光（render.city.windowEmissive・時間帯の windows.glow）と灯りの割合（farWindowLit）。
//   シェーダー: 壁はデータの色 × 窓のない壁の模様（assets/textures/facade/wall_detail.jpg: R れんが・G 切石・B コンクリート。無ければ式の目地）、
//   窓は奥まったガラス（視差: 接線空間の視線で奥行き depth の面を引く → 枠・桟・ブラインド、外れたら抱き = 横・上・下の面の向きに法線を曲げる）、
//   窓台・まぐさ・柱・スパンドレル・帯・コーニス・屋上のパラペット、ガラスの粗さ / 金属っぽさは画素ごと、灯りはセルの hash（遠景と同じ考え）。
//   遠くて 1 セルが数画素より小さいと平均の色・灯りに（チラつかない）。壁は濡らさない（今まで通り）。
if (typeof window !== "undefined") window.MR = window.MR || {};

(function (root) {
  const MR = root.MR || (root.MR = {});

  // ---------- 窓割りの表（1 つの源: シェーダーの uFacStyle と facadeAt）----------
  //   bay: 柱間 m の目安、storey: 階高の既定 m、gf: 1 階の高さ = 階高 × gf、
  //   s0 = [窓の幅（柱間の割合）, 窓台の高さ（階高の割合）, 窓の上端（階高の割合）, 1 階が店（1）か上と同じ（0）]
  //   s1 = [縦の桟の数, 横の桟の数, 窓の奥行き m, 枠の幅 m]
  //   s2 = [まぐさの高さ m, 柱の幅 m（0 = なし）, スパンドレルを奥に（1）, アーチ（1）]
  //   s3 = [横に続く窓（1）, 灯りの割合, ガラスの明るさ 0..1, 壁の模様 0 れんが 1 石 2 コンクリート 3 ガラス]
  const LAYOUTS = [
    { name: 'plain', bay: 3, storey: 4, gf: 1, s0: [0, 0, 0, 0], s1: [0, 0, 0, 0], s2: [0, 0, 0, 0], s3: [0, 0, 0, 1] },
    { name: 'brownstone', bay: 1.9, storey: 3.4, gf: 1.1, s0: [0.48, 0.2, 0.86, 0], s1: [0, 1, 0.2, 0.06], s2: [0.24, 0, 0, 0], s3: [0, 0.3, 0.2, 1] },
    { name: 'prewar_brick', bay: 2.3, storey: 3.2, gf: 1.25, s0: [0.5, 0.25, 0.85, 1], s1: [0, 1, 0.18, 0.055], s2: [0.17, 0, 0, 0], s3: [0, 0.3, 0.2, 0] },
    { name: 'cast_iron', bay: 3.6, storey: 4.4, gf: 1.05, s0: [0.72, 0.13, 0.9, 1], s1: [1, 1, 0.16, 0.06], s2: [0, 0.5, 0, 1], s3: [0, 0.32, 0.3, 2] },
    { name: 'artdeco', bay: 2.2, storey: 3.8, gf: 1.3, s0: [0.56, 0.12, 0.9, 1], s1: [0, 1, 0.14, 0.045], s2: [0, 0.62, 1, 0], s3: [0, 0.35, 0.3, 1] },
    { name: 'glass', bay: 1.6, storey: 3.9, gf: 1.3, s0: [1, 0.3, 1, 1], s1: [0, 0, 0.05, 0.04], s2: [0, 0, 0, 0], s3: [1, 0.4, 0.8, 3] },
    { name: 'postwar', bay: 1.5, storey: 3.0, gf: 1.25, s0: [1, 0.36, 0.84, 1], s1: [1, 0, 0.1, 0.04], s2: [0, 0, 0, 0], s3: [1, 0.32, 0.4, 2] },
    { name: 'industrial', bay: 3.4, storey: 4.4, gf: 1.0, s0: [0.8, 0.18, 0.86, 0], s1: [3, 2, 0.12, 0.06], s2: [0.12, 0, 0, 0], s3: [0, 0.15, 0.2, 0] },
    { name: 'civic', bay: 3.4, storey: 5.0, gf: 1.3, s0: [0.42, 0.18, 0.8, 0], s1: [1, 2, 0.3, 0.06], s2: [0.32, 0.34, 0, 0], s3: [0, 0.2, 0.2, 1] },
    { name: 'house', bay: 2.4, storey: 3.0, gf: 1.0, s0: [0.44, 0.3, 0.8, 0], s1: [0, 1, 0.14, 0.05], s2: [0.12, 0, 0, 0], s3: [0, 0.28, 0.2, 0] },
    { name: 'prewar_stone', bay: 2.4, storey: 3.4, gf: 1.3, s0: [0.52, 0.24, 0.86, 1], s1: [1, 1, 0.2, 0.05], s2: [0.12, 0, 0, 0], s3: [0, 0.32, 0.25, 1] }
  ];
  const L = {}; LAYOUTS.forEach((l, i) => { L[l.name] = i; });
  // 色の既定（データに色が無い建物。sRGB）: 模様ごと
  const PALETTE = {
    brick: ['#7a4232', '#8e4a36', '#6b3a2e', '#9a5a40', '#5e3a30', '#a8735a', '#86503c', '#73402f'],
    brownstone: ['#6d4a3a', '#7b5442', '#5f4034', '#806050'],
    stone: ['#c9bda5', '#b8ad98', '#d4cbb6', '#a89f8f', '#bfb3a0', '#cdbf9f'],
    concrete: ['#a3a09a', '#8f8d88', '#b5b0a6', '#9c978c', '#c2bdb2'],
    glass: ['#3f5566', '#4a5f6a', '#34475a', '#5a6a72', '#3c5a5a', '#607080'],
    metal: ['#5f6266', '#4d5257', '#6e6a62'],
    plain: ['#a8a296', '#8f8a80']
  };
  const DEFAULTS = {
    enabled: true, detail: true, lit: 1, plainGids: [24], plainCls: ['roof', 'shed'], minEdge: 1.2, parapet: 0.9,
    // 窓なしにする細い片（記念碑・塔の細い部分）: 面積 monumentArea m² 未満で、高さが √面積 × monumentSlender より高い片だけ（B3: 以前は
    //   面積 30 m² 未満で 6 m より高い片を全部窓なしにしていて、小さな建物が窓なしだった）
    monumentArea: 30, monumentSlender: 2.5,
    // 灯りの割合（時間帯の farWindowLit → 外壁の灯りの倍率。B3: 夕方は 25〜35 %、夜に向けて増える）と窓の発光の倍率（夜 1 = 今まで通り）
    litCurve: [[0, 0], [0.15, 0.06], [0.6, 0.35], [1, 0.75], [1.15, 1], [1.3, 1.3], [2, 2]],
    glowCurve: [[0, 0.6], [1, 0.75], [1.3, 1], [2, 1]],
    // 灯りのまとまり（同じ階の何間かの事務所・階ぜんぶ）: run = 1 つの事務所の間の数 [最小, 最大]、floor = 階ぜんぶの割合、single = 1 つだけの窓の割合
    litRun: [2, 7], litFloor: 0.05, litSingle: 0.04,
    // B3.1: litGap = 点いた事務所の中の消えた窓・litEdge = 事務所の端の窓が消える割合・litWhole = 9 間 1 つの事務所の升・litBoost = 消えた窓の分の事務所の点く割合の倍率
    litGap: 0.14, litEdge: 0.45, litWhole: 0.25, litBoost: 1.4
  };
  // midtown（v1 の箱。B3）の既定（render.city.facade.midtown で上書き）。bay: 窓割りごとの柱間 m（default は れんが = citykit のエアコンの格子 3 m と
  //   同じでなければならない）、deco*: アールデコにする塔の高さと地区、brownstone*: ブラウンストーンにする低い れんがの建物の地区と割合、
  //   palettes: 箱の材質（citygen の mat）ごとの色（sRGB）、plainKinds: 窓なしの区画の種類（駐車場のキャノピー）、dirt: 汚れの幅
  const MIDTOWN = {
    bay: { default: 3, glass: 1.5, postwar: 1.5, artdeco: 1.5 },
    decoHeight: 80, decoRules: ['midtown_core'], decoShare: 0.6,
    brownstoneRules: ['residential_east', 'residential_west'], brownstoneShare: 0.4,
    plainKinds: ['canopy'], dirt: [0.05, 0.85],
    palettes: {
      brick_brown: ['#6a4a36', '#5e3f2f', '#74503a', '#6d4636', '#583c2e', '#7d5843'],
      brick_red: ['#8e3d2c', '#7d3a2b', '#9a4a34', '#84402f', '#a0563c', '#733428'],
      office_stone: ['#a39a8c', '#b2a894', '#958e82', '#aca394', '#9b9384'],
      limestone: ['#c9bfa8', '#d2c8b0', '#bfb59e', '#cbbfa2', '#c4bba9'],
      concrete: ['#9b968d', '#a5a198', '#8e8b85', '#aaa49a', '#93908a'],
      glass_tower: ['#4c5d6c', '#3f5566', '#465a62', '#52626e', '#3c4f5e']
    }
  };

  // 整数の hash（決定的。シェーダーの hash とは別 = JS だけで使う）
  function ih(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return h >>> 0; }
  function hexRgb(s) { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  // ---------- gid → 建物の数（core の片を 1 回なめる）----------
  function table(city) {
    if (!city || !city.core || !city.core.pieces) return null;
    if (city._facadeTab) return city._facadeTab;
    const P = city.core.pieces, n = P.gid.length, T = new Map();
    for (let i = 0; i < n; i++) {
      const g = P.gid[i], b = P.y0[i] > 1 ? P.y0[i] : 0;
      let r = T.get(g);
      if (!r) { r = { base: b, maxY: P.y1f[i], floors: P.floors[i] }; T.set(g, r); continue; }
      if (b < r.base) r.base = b;
      if (P.y1f[i] > r.maxY) r.maxY = P.y1f[i];
      if (P.floors[i] > r.floors) r.floors = P.floors[i];
    }
    city._facadeTab = T;
    return T;
  }

  // 窓割りの種類: 様式（core の style の名前）と外壁の材質（citygen_nyc の _facadeMat。高い片はガラスの塔になることがある）から
  function layoutOf(styleName, mat) {
    if (mat === 'glass_tower') return L.glass;
    switch (styleName) {
      case 'brownstone': return L.brownstone;
      case 'prewar_brick': return mat === 'office_stone' || mat === 'limestone_win' ? L.prewar_stone : L.prewar_brick;
      case 'cast_iron': return L.cast_iron;
      case 'artdeco_limestone': return L.artdeco;
      case 'postwar': return L.postwar;
      case 'industrial': return L.industrial;
      case 'civic_stone': case 'terminal': return L.civic;
      case 'house': return L.house;
      case 'modern_glass': return mat === 'glass_tower' ? L.glass : (mat === 'concrete_win' ? L.postwar : L.prewar_stone);
      case 'small': return /^brick/.test(mat) ? L.house : L.postwar;
      default: return /^brick/.test(mat) ? L.prewar_brick : mat === 'concrete_win' ? L.postwar : L.prewar_stone;
    }
  }

  const cache = new Map(); // gid → 建物の外壁の数（building(gid)。destruct の崩れる建物が自分の見た目を使う）
  // 柱 p の外壁の数（片ごと。gid ごとの部分は cache）。city: CityGen（v2）、cfg: render.city.facade
  function params(p, city, cfg) {
    cfg = cfg || DEFAULTS;
    const gid = p.gid || 0;
    const meta = city && city.meta && city.meta.enums ? city.meta.enums : null;
    const styleName = meta && meta.style ? meta.style[p.style] || 'generic' : 'generic';
    const clsName = meta && meta.buildingClass ? meta.buildingClass[p.cls] || '' : '';
    let lay = layoutOf(styleName, p.mat);
    // 人の入る建物でないもの（像・砦・橋の塔・桟橋の上の構造・壁）: 窓なし。gid の表・クラス・水の上・細い / 小さい片
    let plain = false;
    if ((cfg.plainGids || DEFAULTS.plainGids).indexOf(gid) >= 0) plain = true;
    if ((cfg.plainCls || DEFAULTS.plainCls).indexOf(clsName) >= 0) plain = true;
    const ring = p.ring;
    let cx = 0, cz = 0, area = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (ring && ring.length >= 6) {
      const m = ring.length >> 1;
      for (let i = 0; i < m; i++) {
        const x = ring[i * 2], z = ring[i * 2 + 1], j = i + 1 < m ? i + 1 : 0;
        cx += x; cz += z; area += x * ring[j * 2 + 1] - ring[j * 2] * z;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      cx /= m; cz /= m; area = Math.abs(area) / 2;
    }
    if (!p.clip && ring && Math.min(maxX - minX, maxZ - minZ) < 2.5) plain = true; // 壁・柱（切っていない片だけ: 切った片の細い端は建物の一部）
    const mA = cfg.monumentArea != null ? cfg.monumentArea : DEFAULTS.monumentArea, mS = cfg.monumentSlender != null ? cfg.monumentSlender : DEFAULTS.monumentSlender;
    if (!p.clip && area > 0 && area < mA && (p.y1 - p.y0) > Math.max(6, Math.sqrt(area) * mS)) plain = true; // 記念碑・塔の細い部分（小さな建物は窓あり）
    if (city && city.core && typeof city.core.isLand === 'function' && ring && !city.core.isLand(cx, cz)) plain = true; // 水の上（橋の塔・桟橋の杭の上の構造）
    if (plain) lay = L.plain;
    const T = table(city), rec = T ? T.get(gid) : null;
    const lo = LAYOUTS[lay];
    let b = cache.get(gid);
    if (!b || b.layout !== lay) {
      const base = rec ? rec.base : (p.base || 0);
      const maxY = rec ? rec.maxY : p.y1;
      const floors = rec ? rec.floors : (p.floors || 0);
      let storey = floors > 0 ? (maxY - base) / floors : 0;
      if (!(storey >= 2.6 && storey <= 6)) storey = p.storey >= 2.6 && p.storey <= 6 ? p.storey : lo.storey;
      if (lay === L.glass && storey < 3.4) storey = 3.4 + (ih(gid, 3) % 5) * 0.1;
      const h = ih(gid, 7);
      let rgb;
      if (p.color && (p.color & 0x1000000)) rgb = [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255];
      else {
        const pal = lay === L.plain ? PALETTE.plain : lo.s3[3] === 0 ? PALETTE.brick : lay === L.brownstone ? PALETTE.brownstone : lo.s3[3] === 1 ? PALETTE.stone : lo.s3[3] === 3 ? PALETTE.glass : lay === L.cast_iron && (h & 1) ? PALETTE.metal : PALETTE.concrete;
        rgb = hexRgb(pal[h % pal.length]);
      }
      // データの色が鮮やかすぎる・暗すぎる（OSM の building:colour は大まか）ものは少し寄せる
      const gG = (rgb[0] + rgb[1] + rgb[2]) / 3;
      rgb = rgb.map((c) => Math.max(18, Math.min(235, Math.round(c * 0.85 + gG * 0.15))));
      const gf = Math.max(3, Math.min(6, storey * lo.gf));
      b = { gid, layout: lay, style: styleName, cls: clsName, seed: h & 255, bay: lo.bay * (0.92 + ((h >>> 8) % 17) / 100), storey, groundH: gf, base, top: maxY, rgb, dirt: ((h >>> 16) & 255) / 255 };
      cache.set(gid, b);
      if (cache.size > 8192) cache.delete(cache.keys().next().value);
    }
    // 低い片（B3: 6 m 未満の建物が窓なしだった）: 1 階の窓の上端が屋上の手前の帯（parapet）に入らないよう 1 階の高さを縮める
    //   （店 = 窓の上端が 1 階の高さ − 0.7、ほか = 1 階の高さ × 窓の上端の割合）。縮めても 2.2 m 未満なら窓なしのまま（シェーダーの winOk）
    let gH = b.groundH;
    const room = p.y1 - b.base - ((cfg && cfg.parapet) || DEFAULTS.parapet);
    if (lay !== L.plain && room > 0) {
      const lim = lo.s0[3] > 0.5 ? room + 0.7 - 0.02 : room / Math.max(0.5, lo.s0[2]) - 0.02;
      if (lim < gH) gH = Math.max(2.2, lim);
    }
    return { gid, layout: lay, seed: b.seed, bay: b.bay, storey: b.storey, groundH: gH, base: b.base, top: p.y1, rgb: b.rgb, dirt: b.dirt, plain: lay === L.plain, noStore: false };
  }
  function building(gid) { return cache.get(gid) || null; }

  // ---------- midtown（v1 の箱。buildings-hq B3）----------
  //   窓のテクスチャを使っていた外壁（world.js _fullBox: 入れない建物の段 = cat exterior で SHELL でない brick_* / glass_tower / office_stone /
  //   limestone / concrete、パラペット（cat roof）、大きなランドマークの石・コンクリート）を同じ材質に。窓の格子は今までのテクスチャと同じ考え:
  //   列は世界座標（u = CityGeo.face の U、tile 1）、段は箱の下端から = citykit のエアコン（れんが: 柱間 3 m・最初の窓の中心 1.5 m・階 3.6 m・
  //   窓台 0.9 m）が窓に載る。1 階（地面からの箱）は店、上の段・ロビーの上の箱は店にしない（noStore）
  const WINDOWED = { brick_brown: 1, brick_red: 1, glass_tower: 1, office_stone: 1, limestone_win: 1, concrete_win: 1 };
  // _fullBox の材質（*_win に直した後）がこの材質へ行くか（cat exterior / roof / landmark の ext の箱だけ。SHELL・室内は今まで通り）
  function boxRouted(b, mat) {
    if (!WINDOWED[mat] || (b.f & 16)) return false;
    return b.cat === 'exterior' || b.cat === 'roof' || b.cat === 'landmark';
  }
  function mcfgOf(cfg) {
    const m = cfg && cfg.midtown;
    if (!m) return MIDTOWN;
    if (m._merged) return m._merged;
    const o = Object.assign({}, MIDTOWN, m);
    o.bay = Object.assign({}, MIDTOWN.bay, m.bay || {});
    o.palettes = Object.assign({}, MIDTOWN.palettes, m.palettes || {});
    Object.defineProperty(m, '_merged', { value: o, enumerable: false });
    return o;
  }
  function baseMat(mat) { return mat === 'limestone_win' ? 'limestone' : mat === 'concrete_win' ? 'concrete' : mat; }
  // 区画（city.lots[i]）の窓割り・柱間・階高・色・汚れ（区画ごとに覚える = 同じ建物の段とパラペットは同じ見た目）
  function lotLook(city, li, mat, cfg) {
    const C = mcfgOf(cfg);
    const tab = city._facLots || (city._facLots = new Map());
    const key = li;
    let r = tab.get(key);
    if (r) return r;
    const Lt = city.lots && city.lots[li];
    const bm = baseMat(mat), h = ih(Lt ? (Lt.seed | 0) : li, 11);
    const rule = Lt && city.cells && city.cells[Lt.cell] ? city.cells[Lt.cell].rule : null;
    const kind = Lt ? Lt.kind : '';
    const height = Lt && Lt.tiers && Lt.tiers.length ? Lt.tiers[Lt.tiers.length - 1][5] - Lt.tiers[0][4] : 0;
    let lay;
    if (C.plainKinds.indexOf(kind) >= 0) lay = L.plain;
    else if (bm === 'glass_tower') lay = L.glass;
    else if (kind === 'warehouse') lay = L.industrial;
    else if (/^brick/.test(bm)) lay = (kind === 'walkup' || kind === 'lowrise') && C.brownstoneRules.indexOf(rule) >= 0 && ((h >>> 3) % 1000) / 1000 < C.brownstoneShare ? L.brownstone : L.prewar_brick;
    else if (bm === 'concrete') lay = L.postwar;
    else if (kind === 'tower' && height >= C.decoHeight && C.decoRules.indexOf(rule) >= 0 && ((h >>> 5) % 1000) / 1000 < C.decoShare) lay = L.artdeco;
    else lay = L.prewar_stone;
    const lo = LAYOUTS[lay];
    // 階高: れんがは今までのテクスチャ・citykit の格子（3.6 m）、ほかは区画の階高（倉庫 6 m・石 4 m・ガラス 4 m）
    let storey = /^brick/.test(bm) ? 3.6 : (Lt && Lt.fh >= 2.6 && Lt.fh <= 7 ? Lt.fh : lo.storey);
    const bay = C.bay[lo.name] || C.bay.default || 3;
    const pal = C.palettes[bm] || C.palettes.concrete || PALETTE.concrete;
    let rgb = hexRgb(pal[h % pal.length]);
    const j = ((h >>> 12) % 21 - 10) / 100; // 明るさの小さなばらつき ±10 %
    rgb = rgb.map((c) => Math.max(14, Math.min(240, Math.round(c * (1 + j)))));
    const d0 = C.dirt[0], d1 = C.dirt[1];
    r = { gid: li + 1, layout: lay, seed: (h >>> 16) & 255, bay, storey, rgb, dirt: d0 + (d1 - d0) * (((h >>> 20) & 255) / 255) };
    tab.set(key, r);
    if (tab.size > 16384) tab.delete(tab.keys().next().value);
    return r;
  }
  // ランドマーク・区画の無い箱（図書館の台・ランドマークの石の箱・ガラスの塔の部品）: 材質の最初の色（部品ごとに色が変わらない）
  const _lmLook = {};
  function matLook(mat, cfg) {
    const C = mcfgOf(cfg), k = mat;
    if (_lmLook[k] && _lmLook[k].C === C) return _lmLook[k];
    const bm = baseMat(mat);
    const lay = bm === 'glass_tower' ? L.glass : /^brick/.test(bm) ? L.prewar_brick : bm === 'concrete' ? L.postwar : L.prewar_stone;
    const lo = LAYOUTS[lay];
    const pal = C.palettes[bm] || PALETTE.concrete;
    return (_lmLook[k] = { C, gid: 0, layout: lay, seed: 17, bay: C.bay[lo.name] || C.bay.default || 3, storey: /^brick/.test(bm) ? 3.6 : (bm === 'concrete' ? 3.6 : 4), rgb: hexRgb(pal[0]), dirt: 0.4 });
  }
  // 箱 b（_fullBox の材質 mat）の外壁の数。区画のある箱（b.lot）は区画の見た目、ほかは材質の見た目。out に書いて返す（毎回作らない）
  const _bp = { gid: 0, layout: 0, seed: 0, bay: 3, storey: 3.6, groundH: 3.6, base: 0, top: 0, rgb: [0, 0, 0], dirt: 0, plain: false, noStore: false };
  function boxParams(b, mat, city, cfg, out) {
    const o = out || _bp;
    const lk = b.lot != null && b.lot >= 0 && city && city.lots ? lotLook(city, b.lot, mat, cfg) : matLook(mat, cfg);
    const par = (cfg && cfg.parapet) || DEFAULTS.parapet;
    // base / top0: 壊れた後に切った箱（destruct.js mk）は元の箱の下端・上端（窓の段・屋上の帯が元の壁と同じ所）
    const by = b.base != null ? b.base : b.y, bt = b.top0 != null ? b.top0 : b.y + b.h;
    const ground = by <= 0.3;
    o.gid = lk.gid; o.layout = lk.layout; o.seed = lk.seed; o.bay = lk.bay; o.storey = lk.storey; o.rgb = lk.rgb; o.dirt = lk.dirt;
    o.base = by; o.groundH = lk.storey; o.noStore = !ground; o.plain = lk.layout === L.plain;
    // 屋上の手前の帯（parapet）は箱の上: 段の箱は上端まで窓、パラペットの箱（cat roof）はぜんぶ帯（壁の色）
    o.top = (b.cat === 'roof' ? by : bt) + par;
    return o;
  }
  // 箱の面 f（CityGeo.face の 0 +X, 1 −X, 2 +Z, 3 −Z）の u（face の U、tile 1）。face の U は面の右向き = どの面も setAttrs の sign −1
  function boxU(f, x, z) { return f === 0 ? -z : f === 1 ? z : f === 2 ? x : -x; }
  // destruct 用: 箱 b の壁の点の窓のセル（facadeAt と同じ形）。n: 法線（無ければ一番近い面）
  function boxFacadeAt(x, y, z, n, b, mat, city, cfg) {
    if (!b) return null;
    const fp = boxParams(b, mat || b.mat, city, cfg, {});
    let f;
    const nx = n ? (n.x != null ? n.x : n[0]) : 0, nz = n ? (n.z != null ? n.z : n[2]) : 0;
    if (n && Math.abs(nx) + Math.abs(nz) > 0.5) f = Math.abs(nx) >= Math.abs(nz) ? (nx > 0 ? 0 : 1) : (nz > 0 ? 2 : 3);
    else {
      const d = [b.x + b.w / 2 - x, x - (b.x - b.w / 2), b.z + b.d / 2 - z, z - (b.z - b.d / 2)];
      f = 0; for (let i = 1; i < 4; i++) if (Math.abs(d[i]) < Math.abs(d[f])) f = i;
    }
    return cellAt(fp, boxU(f, x, z), fp.bay, fp.plain, y, cfg);
  }

  // ---------- 外壁の辺（world.js prismWalls と同じ辺の選び方・向き）----------
  //   cb(ax, az, bx, bz, ya0, ya1, yb0, yb1, nx, nz, uA, uB, bay, sign, plain)。sign: 辺の向き d = sign × (−nz, nx)
  function walls(p, fp, cb, minEdge) {
    const ring = p.ring, holes = p.holes, clip = p.clip, T = p.top, th = p.t || 0, y0 = p.y0, y1 = p.y1;
    const nr = holes && holes.length ? holes.length + 1 : 1;
    const isClip = (e) => (clip ? (clip[e >> 3] >> (e & 7)) & 1 : 0);
    const me = minEdge == null ? DEFAULTS.minEdge : minEdge;
    let eBase = 0;
    for (let r = 0; r < nr; r++) {
      const q = r === 0 ? ring : holes[r - 1], m = q.length >> 1;
      if (m < 3) { eBase += m; continue; }
      let area = 0;
      for (let i = 0; i < m; i++) { const j = i + 1 < m ? i + 1 : 0; area += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1]; }
      const sg = ((area > 0) === (r === 0)) ? 1 : -1;
      let anyClip = false;
      for (let i = 0; i < m; i++) if (isClip(eBase + i)) { anyClip = true; break; }
      for (let i = 0; i < m; i++) {
        if (isClip(eBase + i)) continue;
        const j = i + 1 < m ? i + 1 : 0;
        const ax = q[i * 2], az = q[i * 2 + 1], bx = q[j * 2], bz = q[j * 2 + 1];
        const Ln = Math.hypot(bx - ax, bz - az);
        if (Ln < 0.005) continue;
        const dx = (bx - ax) / Ln, dz = (bz - az) / Ln;
        const nx = sg * dz, nz = -sg * dx;
        const sign = (dx * -nz + dz * nx) >= 0 ? 1 : -1;
        const ip = (i + m - 1) % m, pc = anyClip && isClip(eBase + ip), nc = anyClip && isClip(eBase + j);
        let uA, bay = fp.bay, plain = fp.plain;
        if (pc || nc) { // 切り口に接する辺: 切り口の点の座標（隣のチャンクの同じ壁と窓の列がつながる。柱間はそのまま）
          const along = (k, px, pz) => { const k1 = k + 1 < m ? k + 1 : 0; return Math.abs(q[k1 * 2] - q[k * 2]) <= Math.abs(q[k1 * 2 + 1] - q[k * 2 + 1]) ? pz : px; };
          uA = pc ? along(ip, ax, az) : along(j, bx, bz) - Ln;
        } else { // 辺に柱間を整数個（角で窓が切れない）。短い辺は窓なし
          uA = 0;
          const nb = Math.round(Ln / fp.bay);
          if (nb < 1) { if (Ln >= Math.max(me, fp.bay * 0.55)) bay = Ln; else plain = true; } else bay = Ln / nb;
        }
        const ya1 = T ? T[0] + T[1] * ax + T[2] * az : y1, yb1 = T ? T[0] + T[1] * bx + T[2] * bz : y1;
        const ya0 = T ? ya1 - th : y0, yb0 = T ? yb1 - th : y0;
        cb(ax, az, bx, bz, ya0, ya1, yb0, yb1, nx, nz, uA, uA + Ln, bay, sign, plain);
      }
      eBase += m;
    }
  }

  // ---------- 頂点属性 ----------
  //   aFac  Uint8 × 4: 窓割り, seed, flags（1 辺の向きが逆 2 窓なし）, 1 階の高さ dm
  //   aFac2 Uint16 × 4: 柱間 cm, 階高 cm, 1 階の床の y（dm + 2000）, 片の上端の y（dm + 2000）
  //   aFcol Uint8 × 4（0..1）: 壁の色（sRGB）, 汚れ
  const ATTRS = { aFac: { size: 4, type: Uint8Array }, aFac2: { size: 4, type: Uint16Array }, aFcol: { size: 4, type: Uint8Array, normalized: true } };
  const _a = [0, 0, 0, 0], _b = [0, 0, 0, 0], _c = [0, 0, 0, 0];
  const dm = (y) => Math.max(0, Math.min(65535, Math.round(y * 10) + 2000));
  //   flags: 1 辺の向きが逆、2 窓なし（窓割りの番号は残す = 建物の壁の模様と色のまま）、4 1 階を店にしない（上の段・ロビーの上の箱）
  function setAttrs(g, fp, bay, sign, plain) {
    _a[0] = fp.layout; _a[1] = fp.seed; _a[2] = (sign < 0 ? 1 : 0) | (plain ? 2 : 0) | (fp.noStore ? 4 : 0); _a[3] = Math.max(0, Math.min(255, Math.round(fp.groundH * 10)));
    _b[0] = Math.max(1, Math.min(65535, Math.round(bay * 100))); _b[1] = Math.max(1, Math.min(65535, Math.round(fp.storey * 100))); _b[2] = dm(fp.base); _b[3] = dm(fp.top);
    _c[0] = fp.rgb[0]; _c[1] = fp.rgb[1]; _c[2] = fp.rgb[2]; _c[3] = Math.round(fp.dirt * 255);
    g.setAttr('aFac', _a); g.setAttr('aFac2', _b); g.setAttr('aFcol', _c);
  }

  // ---------- 壁の点の窓のセル（シェーダーと同じ数。視差・模様は見ない）----------
  //   → { mat: 'glass' | 'frame' | 'wall' | 'trim' | 'parapet', winW, winH, col0, row0（セルの左下の u, y）, glass, cornice: [y0, y1], u, layout } | null
  //   n: 壁の法線 [x, y, z] か { x, y, z }（無ければ一番近い辺）
  function facadeAt(x, y, z, n, p, city, cfg) {
    if (!p || !p.ring) return null;
    const fp = p._fp || params(p, city || null, cfg);
    const nx = n ? (n.x != null ? n.x : n[0]) : null, nz = n ? (n.z != null ? n.z : n[2]) : null;
    let best = null, bd = Infinity;
    walls(p, fp, (ax, az, bx, bz, ya0, ya1, yb0, yb1, ex, ez, uA, uB, bay, sign, plain) => {
      if (nx != null && ex * nx + ez * nz < 0.7) return;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < bd) { bd = d; best = { u: uA + t * Math.sqrt(L2), bay, plain }; }
    }, cfg && cfg.minEdge);
    if (!best) return null;
    return cellAt(fp, best.u, best.bay, best.plain, y, cfg);
  }
  // 窓のセル（facadeAt / boxFacadeAt が使う。シェーダーと同じ数）: fp = params / boxParams、u = 壁の u（m）
  function cellAt(fp, u, bay, plain, y, cfg) {
    const lo = LAYOUTS[fp.layout];
    const par = lo.s3[3] === 3 ? 0.5 : (cfg && cfg.parapet) || DEFAULTS.parapet;
    const top = Math.round(fp.top * 10) / 10, cornice = [top - par - 0.35, top - par];
    const out = { mat: 'wall', winW: 0, winH: 0, col0: 0, row0: 0, glass: false, cornice, u, layout: lo.name };
    if (plain || fp.layout === 0) return out;
    if (y > top - par) { out.mat = 'parapet'; return out; }
    // 頂点属性と同じ丸め（柱間・階高 cm、1 階の高さ・床の y dm）= シェーダーと同じセル
    const B = Math.round(bay * 100) / 100, S = Math.round(fp.storey * 100) / 100, G = Math.round(fp.groundH * 10) / 10, yy = y - Math.round(fp.base * 10) / 10;
    const col = Math.floor(u / B), xL = u - col * B;
    let Sh = S, yL, row, store = false;
    if (yy < G) { row = -1; yL = yy; Sh = G; store = lo.s0[3] > 0.5 && !fp.noStore; } else { row = Math.floor((yy - G) / S); yL = yy - G - row * S; }
    let ox0 = B * 0.5 * (1 - lo.s0[0]), ox1 = B - ox0, oy0 = Sh * lo.s0[1], oy1 = Sh * lo.s0[2];
    if (lo.s3[0] > 0.5) { ox0 = 0; ox1 = B; }
    if (store) { ox0 = B * 0.05; ox1 = B * 0.95; oy0 = 0.35; oy1 = G - 0.7; }
    const base = Math.round(fp.base * 10) / 10;
    oy1 = Math.min(oy1, top - par - 0.12 - (base + (row < 0 ? 0 : G + row * S))); // 屋上の手前の帯にかかる窓は上を縮める（シェーダーと同じ）
    out.col0 = col * B + ox0; out.row0 = base + (row < 0 ? 0 : G + row * S) + oy0; out.winW = ox1 - ox0; out.winH = oy1 - oy0;
    if (!(oy1 > oy0 + 0.5)) return out; // 短すぎる窓は描かない
    if (xL >= ox0 && xL <= ox1 && yL >= oy0 && yL <= oy1) {
      const fr = lo.s1[3];
      out.glass = true; out.mat = 'glass';
      if (xL - ox0 < fr || ox1 - xL < fr || yL - oy0 < fr || oy1 - yL < fr) { out.mat = 'frame'; out.glass = false; }
    } else if (yL < oy0 && yL > oy0 - 0.07 && xL > ox0 - 0.07 && xL < ox1 + 0.07) out.mat = 'trim';
    else if (lo.s2[0] > 0 && yL > oy1 && yL < oy1 + lo.s2[0]) out.mat = 'trim';
    return out;
  }

  // ---------- 後半: THREE ----------
  // シェーダー（頂点: 表の 4 つの vec4 を窓割りの番号で引いて varying へ。ES 1.0 の頂点シェーダーは uniform の配列を変数で引ける）
  const VS_PARS = [
    'attribute vec4 aFac;', 'attribute vec4 aFac2;', 'attribute vec4 aFcol;',
    'uniform vec4 uFacStyle[' + (LAYOUTS.length * 4) + '];',
    'varying vec4 vFA;', 'varying vec4 vFB;', 'varying vec4 vFC;',
    'varying vec4 vS0;', 'varying vec4 vS1;', 'varying vec4 vS2;', 'varying vec4 vS3;'
  ].join('\n');
  const VS_MAIN = [
    'int fl4 = int(aFac.x + 0.5) * 4;',
    'vS0 = uFacStyle[fl4]; vS1 = uFacStyle[fl4 + 1]; vS2 = uFacStyle[fl4 + 2]; vS3 = uFacStyle[fl4 + 3];',
    'vFA = vec4(uv.x, aFac2.x * 0.01, aFac2.y * 0.01, aFac.w * 0.1);',
    'vFB = vec4((aFac2.z - 2000.0) * 0.1, (aFac2.w - 2000.0) * 0.1, aFac.x, aFac.y);',
    // sRGB → リニア（MR.srgb と同じ区分の式）
    'vec3 fcs = aFcol.rgb;',
    'vec3 fcl = mix(fcs / 12.92, pow((fcs + 0.055) / 1.055, vec3(2.4)), step(0.04045, fcs));',
    'vFC = vec4(fcl, aFac.z + aFcol.a * 0.5);' // flags（整数）+ 汚れ × 0.5（小数）
  ].join('\n');

  const FS_PARS = [
    'varying vec4 vFA;', 'varying vec4 vFB;', 'varying vec4 vFC;',
    'varying vec4 vS0;', 'varying vec4 vS1;', 'varying vec4 vS2;', 'varying vec4 vS3;',
    'uniform sampler2D tFacDetail;', 'uniform float uFacTex;', 'uniform float uFacLit;', 'uniform float uFacPar;',
    'uniform vec3 uFacWarm;', 'uniform vec3 uFacCool;', 'uniform vec3 uFacTrimBrick;', 'uniform vec4 uFacRun;', 'uniform vec4 uFacRun2;',
    'float fh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    // sin の無い hash（Dave Hoskins の hash12）: 引数が数百の整数でも偏らない（灯りのまとまり。sin の hash は SwiftShader で大きな引数のとき偏った）
    'float fh2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'float fBox(vec2 p, vec4 r, float aa) { vec2 a = smoothstep(r.xy - aa, r.xy + aa, p) * (1.0 - smoothstep(r.zw - aa, r.zw + aa, p)); return a.x * a.y; }',
    'float fIn(vec2 p, vec4 r, float arch) {',
    '  if (p.x < r.x || p.x > r.z || p.y < r.y || p.y > r.w) return 0.0;',
    '  if (arch > 0.5) { float rr = 0.5 * (r.z - r.x); float cy = r.w - rr; if (p.y > cy && length(vec2(p.x - 0.5 * (r.x + r.z), p.y - cy)) > rr) return 0.0; }',
    '  return 1.0;',
    '}',
    // 式の目地（wall_detail.jpg が無いとき）: 0 れんが 1 石 2 コンクリート
    'float fProc(float sf, vec2 p) {',
    '  if (sf < 0.5) { float ro = floor(p.y / 0.0769); vec2 q = vec2(p.x / 0.2222 + mod(ro, 2.0) * 0.5, p.y / 0.0769); vec2 f = fract(q); float j = step(f.x, 0.045) + step(f.y, 0.13); return j > 0.5 ? 0.7 : 0.4 + 0.2 * fh1(floor(q)); }',
    '  if (sf < 1.5) { float ro = floor(p.y / 0.667); vec2 q = vec2(p.x / 1.1 + ro * 0.37, p.y / 0.667); vec2 f = fract(q); float j = step(f.x, 0.008) + step(f.y, 0.012); return j > 0.5 ? 0.36 : 0.47 + 0.08 * fh1(floor(q)); }',
    '  return 0.48 + 0.06 * fh1(floor(p * 0.5));',
    '}'
  ].join('\n');

  // map_fragment の代わり: 色・粗さ・金属・発光・法線の曲げを決める（fR / fM / fE / fBend は後の段で使う）
  const FS_MAIN = [
    'float fR = 0.9; float fM = 0.0; vec3 fE = vec3(0.0); vec3 fBend = vec3(0.0);',
    '{',
    '  vec3 fWN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);',
    '  vec3 fWP = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;',
    '  float flg = floor(vFC.w + 0.001); float dirt = (vFC.w - flg) * 2.0;',
    '  float sgn = mod(flg, 2.0) > 0.5 ? -1.0 : 1.0; float plain = mod(floor(flg * 0.5), 2.0); float nost = mod(floor(flg * 0.25), 2.0);',
    '  vec3 fT = sgn * normalize(vec3(-fWN.z, 0.0, fWN.x) + vec3(1e-5, 0.0, 0.0));',
    '  float u = vFA.x; float y = fWP.y; float B = max(vFA.y, 0.3); float S = max(vFA.z, 2.0); float G = vFA.w;',
    '  float base = vFB.x; float top = vFB.y; float seed = floor(vFB.w + 0.5); float sf = floor(vS3.w + 0.5);',
    '  vec3 V = normalize(fWP - cameraPosition);',
    '  vec3 vt = vec3(dot(V, fT), V.y, dot(V, fWN));',
    '#if defined(GL_OES_standard_derivatives) || (__VERSION__ >= 300)',
    '  vec2 fw2 = fwidth(vec2(u, y)); float pxm = max(max(fw2.x, fw2.y), 1e-4);',
    '#else',
    '  float pxm = length(vViewPosition) * 0.0017;',
    '#endif',
    '  float aa = pxm * 0.75;',
    // 壁の模様（4 m の 1 枚）× データの色、下ほど煤け・建物ごとの大きな染み
    '  vec2 dUv = abs(fWN.y) > 0.5 ? fWP.xz : vec2(u, y);', // 上面・下面（パラペットの笠木・軒の裏。窓なし）は水平の座標で
    '  vec3 det = texture2D(tFacDetail, dUv * 0.25).rgb;',
    '  float d = sf < 0.5 ? det.r : (sf < 1.5 ? det.g : det.b);',
    '  if (uFacTex < 0.5) d = mix(fProc(sf, dUv), 0.5, smoothstep(0.02, 0.08, pxm));', // 式の目地は遠くでならす（テクスチャはミップマップ）
    '  float stain = fh1(mod(floor(vec2(u, y) / vec2(6.0, 9.0)), 61.0) + seed * 0.13);',
    '  float grime = 1.0 - (0.10 + 0.12 * dirt) * exp(-max(y - base, 0.0) * 0.35);',
    '  vec3 wc = vFC.rgb;',
    '  if (sf > 2.5) wc = max(wc, vec3(0.07, 0.085, 0.1));', // ガラス: データの色が黒に近くても映り込みの色が残るように
    '  float dk = sf < 0.5 ? 1.35 : 1.0;',
    '  vec3 wall = wc * (1.0 + (d - 0.5) * dk) * grime * (0.94 + 0.1 * stain - 0.08 * dirt);',
    '  vec3 trim = sf < 0.5 ? uFacTrimBrick : wc * 1.12 + 0.02;',
    '  vec3 col = wall;',
    '  float isGlass = step(2.5, sf);',
    '  if (isGlass > 0.5) { col = wc * 0.72 + 0.02; fR = 0.3; fM = 0.15; }', // カーテンウォールの壁 = スパンドレルのガラス
    '  else if (sf > 1.5) fR = 0.82;',
    '  float par = isGlass > 0.5 ? 0.5 : uFacPar;',
    '  if (plain < 0.5 && vFB.z > 0.5) {',
    '    float yy = y - base;',
    '    float row; float yL; float Sh = S; float store = 0.0;',
    '    if (yy < G) { row = -1.0; yL = yy; Sh = G; store = vS0.w * (1.0 - nost); } else { row = floor((yy - G) / S); yL = yy - G - row * S; }',
    '    float colI = floor(u / B); float xL = u - colI * B;',
    '    float ox0 = B * 0.5 * (1.0 - vS0.x); float ox1 = B - ox0; float oy0 = Sh * vS0.y; float oy1 = Sh * vS0.z;',
    '    if (vS3.x > 0.5) { ox0 = 0.0; ox1 = B; }',
    '    float depth = vS1.z; float frw = vS1.w; float nV = vS1.x; float nH = vS1.y; float arch = vS2.w;',
    '    if (store > 0.5) { ox0 = B * 0.05; ox1 = B * 0.95; oy0 = 0.35; oy1 = G - 0.7; nV = 1.0; nH = 0.0; depth = 0.12; arch = 0.0; }',
    // 屋上の手前の帯にかかる窓は上を縮める（B3: 以前は描かなかった = 低い建物・半端な高さの最上階が窓なし）。短すぎれば描かない
    '    oy1 = min(oy1, top - par - 0.12 - (base + (row < 0.0 ? 0.0 : G + row * S)));',
    '    bool winOk = oy1 > oy0 + 0.5;',
    '    vec4 R = vec4(ox0, oy0, ox1, oy1);',
    '    vec2 pl = vec2(xL, yL);',
    // 帯（1 階の上の帯・屋上の手前のコーニス・パラペット）
    '    if (isGlass < 0.5) {',
    '      if (yy > G - 0.05 && yy < G + 0.28 && G > 0.5 && nost < 0.5) { col = trim * 0.95; fBend = vec3(0.0, 0.35, 0.0); }',
    '      float cTop = top - par;',
    '      if (y > cTop - 0.35 && y < cTop) { col = trim; fBend = vec3(0.0, -0.5, 0.0) + fWN * 0.2; }',
    '      else if (y > cTop - 0.75 && y <= cTop - 0.35) col *= 0.82;',
    '      if (y >= cTop) col = wall * 0.96;',
    '    } else if (y > top - par) { col = wc * 0.42; fR = 0.4; fM = 0.6; }',
    // 柱（鋳鉄・アールデコ・公共の石）: セルの端の帯、丸く見えるように法線を横へ
    '    float pw = vS2.y;',
    '    if (pw > 0.0 && winOk) {',
    '      float ex = min(xL, B - xL);',
    '      if (ex < pw * 0.5 && yy > 0.0 && y < top - par) { float k = 1.0 - ex / (pw * 0.5); col = (vS2.z > 0.5 ? trim * 1.05 : trim); fBend = fT * sign(xL - B * 0.5) * -0.6 * k; }',
    '    }',
    // スパンドレル（アールデコ: 窓の列の上下を奥に暗く）
    '    if (vS2.z > 0.5 && winOk && row >= 0.0 && xL > ox0 && xL < ox1 && (yL > oy1 || yL < oy0)) { col = wall * 0.5; fR = 0.7; }',
    // カーテンウォールの縦の方立（セルの端）
    '    if (isGlass > 0.5 && y < top - par) { float ex = min(xL, B - xL); if (ex < 0.045) { col = wc * 0.35 + 0.05; fR = 0.35; fM = 0.8; fBend = fT * sign(B * 0.5 - xL) * 0.4; } }',
    // 窓台・まぐさ（と窓台の下の影）
    '    if (winOk && vS3.x < 0.5 && store < 0.5) {',
    '      if (yL < oy0 && yL > oy0 - 0.07 && xL > ox0 - 0.07 && xL < ox1 + 0.07) { col = trim; fBend = vec3(0.0, 0.6, 0.0); }',
    '      else if (yL < oy0 - 0.07 && yL > oy0 - 0.3 && xL > ox0 - 0.07 && xL < ox1 + 0.07) col *= mix(0.78, 1.0, (oy0 - 0.07 - yL) / 0.23);',
    '      if (vS2.x > 0.0 && yL > oy1 && yL < oy1 + vS2.x && xL > ox0 - 0.05 && xL < ox1 + 0.05) col = trim * 0.97;',
    '    }',
    // 店の看板の帯
    '    if (store > 0.5 && yL > G - 0.65 && yL < G - 0.1) { col = mix(wc * 0.3, vec3(0.05), 0.5); fR = 0.5; }',
    // 窓（奥まったガラス: 視差）
    '    float m = winOk ? fBox(pl, R, aa) : 0.0;',
    '    if (arch > 0.5 && m > 0.0) m *= fIn(pl, R, arch);',
    '    if (m > 0.001) {',
    '      vec2 pp = pl + vt.xy * (depth / max(-vt.z, 0.12));',
    '      vec3 oc; float oR; float oM; vec3 oB = vec3(0.0); vec3 oE = vec3(0.0);',
    '      if (fIn(pp, R, arch) > 0.5) {',
    '        float lit = vS3.y * (0.6 + 0.8 * fh1(vec2(seed, 3.1))) * uFacLit * (store > 0.5 ? 1.25 : 1.0);',
    '        vec2 cid = vec2(mod(colI, 97.0), row) + vec2(seed * 0.37, seed * 0.11);',
    // 灯りのまとまり（B3.1）: 階を 9 間の升に切り（階ごとにずらす）、升は 1 つの事務所（9 間）か 2 つ（間の数 litRun）。事務所ごとに点く。
    // 点いた事務所の中にも消えた窓（uFacRun2.x）、事務所の端の窓は時々消える（uFacRun2.y = 隣の事務所とつながって帯に見えない）。
    // 階ぜんぶは litFloor × 灯り（夕方は少ない）。hash は sin なし（fh2）
    '        float rr = mod(row + 8.0, 211.0);',
    '        float rh = fh2(vec2(rr, seed + 5.0));',
    '        float cx = colI + floor(fh2(vec2(rr + 3.0, seed + 23.0)) * 9.0);',
    '        float cc = floor(cx / 9.0); float inC = cx - cc * 9.0;',
    '        vec2 ck = vec2(mod(cc, 97.0) + seed * 0.61, rr * 1.37 + seed);',
    '        float sp = fh2(ck + 19.0) < uFacRun2.z ? 9.0 : floor(uFacRun.x + (uFacRun.y - uFacRun.x + 1.0) * fh2(ck + 11.0));',
    '        float sd = step(sp, inC);',
    '        float ow = mix(sp, 9.0 - sp, sd); float oi = inC - sd * sp;',
    '        vec2 oid = ck + vec2(sd * 0.53 + 0.17, sd * 0.29);',
    '        vec2 wid = vec2(mod(colI, 97.0) + seed * 0.37, rr + seed * 0.11);',
    '        float flr = step(rh, uFacRun.z * min(lit * 1.6, 1.5));',
    '        float pB = min(lit * uFacRun2.w, 0.95);',
    '        float onB = max(flr * step(0.25, fh2(vec2(rr + 61.0, seed))), step(1.0 - pB, fh2(oid)));',
    '        float edge = (oi < 0.5 || oi > ow - 1.5) && ow > 2.5 ? step(fh2(oid + vec2(29.0, oi)), uFacRun2.y) : 0.0;',
    '        float gap = step(fh2(wid + 7.7), uFacRun2.x);',
    '        float on = max(onB * (1.0 - max(edge, gap)), step(1.0 - lit * uFacRun.w, fh2(wid + 3.3)));',
    '        vec2 bid = oid;',
    '        if (store > 0.5) on = step(1.0 - lit, fh1(cid));',
    '        float tone = fh1(cid * 1.37 + 4.0);',
    '        vec3 gl = mix(vec3(0.035, 0.045, 0.055), vec3(0.09, 0.11, 0.13), tone);',
    '        if (isGlass > 0.5) gl = wc * (0.45 + 0.2 * tone) + 0.03;',
    '        oc = gl; oR = 0.05 + 0.08 * (1.0 - vS3.z); oM = 0.1 + 0.25 * vS3.z;',
    // ブラインド（上から下ろしている）
    '        float bl = fh1(cid * 2.11 + 9.0); float blf = 0.0;',
    '        if (bl > 0.6 && isGlass < 0.5 && store < 0.5) { float by = oy1 - (oy1 - oy0) * (0.15 + 0.5 * fract(bl * 7.0)); if (pp.y > by) { oc = mix(vec3(0.55, 0.5, 0.42), vec3(0.75, 0.72, 0.66), tone) * 0.5; oR = 0.9; oM = 0.0; blf = 1.0; } }',
    // 事務所ごとの色（暖色〜白、少しだけ）と明るさ（窓ごとの揺れは小さく = 紙吹雪に見えない）
    '        float bt = fh2(bid + 2.7);',
    '        float wv = fh2(wid + 5.1);',
    '        vec3 lc = mix(uFacWarm, uFacCool, clamp(step(0.78, bt) * (isGlass > 0.5 ? 0.8 : 0.35) + (wv - 0.5) * 0.3, 0.0, 1.0)) * (0.88 + 0.2 * fh2(bid + 7.3));',
    '        oE = lc * on * (0.3 + 0.36 * fh2(bid + 13.1)) * (0.85 + 0.5 * fh2(wid + 13.7)) * (1.0 - 0.55 * blf);',
    '        if (store > 0.5) { lc = uFacWarm; oE = lc * on * (0.16 + 0.22 * smoothstep(oy0, oy1, pp.y)) * (0.7 + 0.6 * fh1(cid * 5.1)); if (pp.y < oy0 + 0.9 && fract(pp.x * 0.9 + tone) < 0.55) oE *= 0.35; }',
    '        if (on > 0.5) oc = mix(oc, lc * 0.25, 0.5);',
    // 枠・桟
    '        float fx = min(pp.x - ox0, ox1 - pp.x); float fy = min(pp.y - oy0, oy1 - pp.y);',
    '        float fr = step(min(fx, fy), frw);',
    '        float cw = (ox1 - ox0) / (nV + 1.0); float ch = (oy1 - oy0) / (nH + 1.0);',
    '        float mv = nV > 0.5 ? step(abs(fract((pp.x - ox0) / cw + 0.5) - 0.5) * cw, 0.022) : 0.0;',
    '        float mh = nH > 0.5 ? step(abs(fract((pp.y - oy0) / ch + 0.5) - 0.5) * ch, 0.025) : 0.0;',
    '        float bar = max(fr, max(mv, mh));',
    '        vec3 fc = isGlass > 0.5 ? wc * 0.3 + 0.04 : (fh1(vec2(seed, 9.0)) > 0.55 ? vec3(0.62, 0.6, 0.55) : vec3(0.05, 0.06, 0.055));',
    '        oc = mix(oc, fc, bar); oR = mix(oR, 0.5, bar); oM = mix(oM, 0.2, bar); oE *= 1.0 - bar;',
    '      } else {',
    // 抱き（窓の横・上・下の面）: その面の向きに法線を曲げて暗く
    '        oc = (isGlass > 0.5 ? wc * 0.4 : wall) * 0.82; oR = 0.9; oM = isGlass > 0.5 ? 0.5 : 0.0;',
    '        if (pp.y < oy0) { oB = vec3(0.0, 1.2, 0.0); oc = (isGlass > 0.5 ? oc : trim * 0.9); }',
    '        else if (pp.y > oy1) { oB = vec3(0.0, -1.2, 0.0); oc *= 0.55; }',
    '        else if (pp.x < ox0) oB = fT * 1.2;',
    '        else oB = -fT * 1.2;',
    '      }',
    '      col = mix(col, oc, m); fR = mix(fR, oR, m); fM = mix(fM, oM, m); fE = mix(fE, oE, m); fBend = mix(fBend, oB, m);',
    '    }',
    // 遠く（1 セルが数画素）: 窓の平均の色・灯り
    '    float cellPx = min(B, Sh) / pxm;',
    '    float fade = 1.0 - smoothstep(1.2, 3.0, cellPx);',
    '    if (fade > 0.0) {',
    '      float af = winOk ? clamp((ox1 - ox0) * (oy1 - oy0) / (B * Sh), 0.0, 1.0) : 0.0;',
    '      float lit = vS3.y * (0.6 + 0.8 * fh1(vec2(seed, 3.1))) * uFacLit;',
    '      vec2 cg = floor(vec2(mod(colI, 96.0) / 4.0, row / 3.0)) + seed * 0.21;',
    '      float on = lit * (0.5 + fh1(cg));',
    '      vec3 avg = mix(isGlass > 0.5 ? wc * 0.5 : wall, vec3(0.07, 0.08, 0.09), af * 0.85);',
    '      col = mix(col, avg, fade); fR = mix(fR, mix(0.85, 0.12, af * isGlass + af * 0.4), fade); fM = mix(fM, 0.3 * af, fade);',
    '      fE = mix(fE, mix(uFacWarm, uFacCool, 0.25) * on * af * 0.5, fade); fBend *= 1.0 - fade;',
    '    }',
    '  }',
    '  diffuseColor.rgb = col;',
    '}'
  ].join('\n');

  function styleUniform() {
    const out = [];
    for (const l of LAYOUTS) for (const k of ['s0', 's1', 's2', 's3']) out.push(new THREE.Vector4(l[k][0], l[k][1], l[k][2], l[k][3]));
    return out;
  }

  // Materials ごとに 1 つ（register('cityFacade')）。assets があれば wall_detail.jpg を読む（無い・失敗 = 式の目地）
  function material(materials, assets) {
    if (materials && materials._facade) return materials._facade;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1.4 });
    m.name = 'cityFacade';
    m.extensions = { derivatives: true };
    const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
    blank.needsUpdate = true;
    const U = {
      uFacStyle: { value: styleUniform() },
      tFacDetail: { value: blank }, uFacTex: { value: 0 }, uFacLit: { value: 1 }, uFacPar: { value: DEFAULTS.parapet },
      uFacRun: { value: new THREE.Vector4(DEFAULTS.litRun[0], DEFAULTS.litRun[1], DEFAULTS.litFloor, DEFAULTS.litSingle) },
      uFacRun2: { value: new THREE.Vector4(DEFAULTS.litGap, DEFAULTS.litEdge, DEFAULTS.litWhole, DEFAULTS.litBoost) },
      uFacWarm: { value: MR.srgb ? MR.srgb('#ffb460') : new THREE.Color(1, 0.55, 0.2) },
      uFacCool: { value: MR.srgb ? MR.srgb('#dfe8f2') : new THREE.Color(0.75, 0.8, 0.88) },
      uFacTrimBrick: { value: MR.srgb ? MR.srgb('#c4b69c') : new THREE.Color(0.55, 0.47, 0.34) }
    };
    m.userData.uniforms = U;
    m.userData.mrDef = { windows: true, facade: true }; // citylights の窓の dim（emissiveIntensity）が効く
    m.customProgramCacheKey = () => 'cityFacade';
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VS_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VS_MAIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FS_PARS)
        .replace('#include <map_fragment>', FS_MAIN)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fR;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fM;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (dot(fBend, fBend) > 1e-6) normal = normalize(normal + (viewMatrix * vec4(fBend, 0.0)).xyz);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= fE;')
        .replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= mix(0.3, 1.0, step(0.3, metalnessFactor));\n#include <aomap_fragment>');
    };
    const api = { material: m, uniforms: U, texture: null, ready: Promise.resolve(false) };
    if (assets && typeof assets.resolve === 'function' && typeof assets.loadTexture === 'function') {
      const key = assets.resolve('textures/facade/wall_detail.jpg');
      if (key) {
        api.ready = Promise.resolve(assets.loadTexture(key, { srgb: false, anisotropy: 4 })).then((t) => {
          if (!t) return false;
          t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
          U.tFacDetail.value = t; U.uFacTex.value = 1; api.texture = t;
          return true;
        }, (e) => { console.warn('[Facade] wall_detail.jpg を読めません:', e && e.message); return false; });
      }
    }
    if (materials) {
      materials._facade = api;
      if (typeof materials.register === 'function') materials.register('cityFacade', m);
    }
    return api;
  }
  // ゲームごとの数（render.city の windowEmissive・farWindowLit = 時間帯で掛けた値、facade.lit / parapet）
  // 折れ線 [[x, y], …] の x の値（範囲の外は端の値）
  function curve(pts, x) {
    if (!pts || !pts.length) return x;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / Math.max(1e-6, b[0] - a[0]); }
    return pts[pts.length - 1][1];
  }
  // ゲームごとの数: farWindowLit（時間帯の windows.lit を掛けた値。夕方 1・夜 1.3）→ litCurve で灯りの倍率、glowCurve で窓の発光
  //   （windowEmissive × glowCurve。夜は今まで通り、夕方は少し暗く）。facade.lit は全体の倍率
  function configure(api, cityCfg) {
    if (!api) return;
    const c = cityCfg || {}, f = c.facade || {};
    const tl = typeof c.farWindowLit === 'number' ? c.farWindowLit : 1;
    api.material.emissiveIntensity = (typeof c.windowEmissive === 'number' ? c.windowEmissive : 1.4) * curve(f.glowCurve || DEFAULTS.glowCurve, tl);
    if (api.material.userData.storyEmi != null) api.material.userData.storyEmi = api.material.emissiveIntensity;
    api.uniforms.uFacLit.value = curve(f.litCurve || DEFAULTS.litCurve, tl) * (typeof f.lit === 'number' ? f.lit : 1);
    api.uniforms.uFacPar.value = typeof f.parapet === 'number' ? f.parapet : DEFAULTS.parapet;
    const run = f.litRun || DEFAULTS.litRun;
    api.uniforms.uFacRun.value.set(run[0], run[1], typeof f.litFloor === 'number' ? f.litFloor : DEFAULTS.litFloor, typeof f.litSingle === 'number' ? f.litSingle : DEFAULTS.litSingle);
    const nm = (k) => (typeof f[k] === 'number' ? f[k] : DEFAULTS[k]);
    api.uniforms.uFacRun2.value.set(nm('litGap'), nm('litEdge'), nm('litWhole'), nm('litBoost'));
  }
  // 使うか: ?facade=0|1 > MR.CONFIG.FACADE > render.city.facade.enabled（v2 の街 = manhattan の柱、B3 から v1 の街 = midtown の箱も）
  function enabled(cityCfg, city) {
    if (!city || (city.version === 2 && !city.core)) return false;
    return enabledFor(cityCfg);
  }
  // 街を作る前（main.js の材質の先読み: 窓のテクスチャを読まない）
  function enabledFor(cityCfg) {
    try {
      const q = typeof location !== 'undefined' && location.search ? /[?&]facade=([01])/.exec(location.search) : null;
      if (q) return q[1] === '1';
    } catch (e) { /* なし */ }
    if (MR.CONFIG && typeof MR.CONFIG.FACADE === 'boolean') return MR.CONFIG.FACADE;
    const f = cityCfg && cityCfg.facade;
    return !(f && f.enabled === false);
  }

  MR.Facade = { LAYOUTS, L, ATTRS, DEFAULTS, MIDTOWN, WINDOWED, table, layoutOf, params, building, walls, setAttrs, facadeAt, cellAt, boxRouted, boxParams, boxU, boxFacadeAt, lotLook, curve, material, configure, enabled, enabledFor, _cache: cache };
  if (typeof module !== 'undefined' && module.exports) module.exports = MR.Facade;
})(typeof window !== 'undefined' ? window : globalThis);
