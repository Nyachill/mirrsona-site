// マテリアル置き場。world.js が使う名前（ground / road / concrete / container2 ...）ごとに MeshStandardMaterial を 1 つ作って共有する。
//
//   - assets に本物のテクスチャ（<tier>/textures/<mat>/albedo.jpg, normal.png, orm.jpg, facade だけ emissive.jpg）が
//     あればそれを使い、無ければ textures.js の Canvas テクスチャ（今までの見た目）にフォールバックする。
//   - ファイルの読み込みは非同期なので、マテリアルは Canvas 版で即座に作って返し、画像が届いたら
//     map / normalMap / aoMap / roughnessMap / metalnessMap / emissiveMap をその場で差し替える（needsUpdate = true）。
//     世界の組み立てはテクスチャを待たない。全部届いたかは `ready`（Promise）で分かる。
//   - テクスチャ 1 枚が覆う実寸（m）は tile(name) で返す。world.js はジオメトリの UV を実寸でスケールするので、
//     テクスチャ側の repeat は常に (1,1)（同じ画像を複数マテリアルで共有できる）。
//   - aoMap は uv2 を使う。world.js が結合後のジオメトリに uv2 = uv を付ける（GLTFLoader のモデルは自動）。
//   - props.glb の各ノードのマテリアルは register('prop:<node>', material) で登録し、get('prop:barrel#1') の
//     ように「#色番号」を付けて呼ぶと色違いの clone を返す（コンテナ・バレルの塗装色）。
//
// 読む設定（game.js から opts で渡す。無ければ既定値）: render.textures (true) → opts.useFiles、
// render.anisotropy (8, タッチ端末 4) → opts.anisotropy、render.city.windowEmissive → opts.windowEmissive（街の窓の発光の強さ）
//
// 街（levels/midtown.json）の材質は citygen.js の箱の mat の名前そのまま（limestone / brick_brown / glass_tower …）。
// city: true の定義は arena01 の先読み（preload()）に入れない（preload({ city: true }) で街の分も読む）。
// ファイルが無いときの Canvas 版は textures.js の MR.Textures.city(name)。色だけの新しい材質（red_glass / glass_rail（半透明）/
// hull_grey / carrier_deck / ice / rock）もここ。'limestone_win' / 'concrete_win' は窓の無い石・コンクリートの外壁（入れない建物）用に
// office_stone のテクスチャを色を変えて使う。'roadPaint' は車線・横断歩道（頂点カラー）。
window.MR = window.MR || {};

MR.Materials = (function () {
  const CONTAINER_COLORS = ['#b8442c', '#2e6fb3', '#3a8f4f', '#d9a52a', '#8f8f95'];
  const BARREL_COLORS = ['#3f5f3e', '#8a2f2a', '#4a4f58'];

  // world.js が使う名前 → 定義
  //   file      … assets/<tier>/textures/<file>/ のテクスチャセット名（SPEC §1 の表）。無いものは単色
  //   tile      … ファイルテクスチャ 1 枚が覆う実寸 m（[u, v] か 1 つの数）
  //   procTile  … Canvas 版の実寸（今までの world.js と同じ値。0 = 引き伸ばし = repeat 1）
  //   proc      … Canvas テクスチャを返す関数 (T, seed, tint) → { map, normal?, emissive? }
  //   procColor … Canvas 版のときの material.color（ファイル版では白。tints があれば色番号の色）
  //   tints     … 色違い（container0..4 / barrel0..2）。ファイル版ではアルベドがほぼ白なので color で着色する
  const DEFS = {
    ground: { file: 'ground', tile: 4, procTile: 6, roughness: 0.95, metalness: 0.0, normalScale: 0.6, proc: (T) => T.ground() },
    road: { file: 'asphalt', tile: [6, 7], procTile: [8, 0], roughness: 0.9, metalness: 0.0, normalScale: 0.5, proc: (T) => T.road() },
    concrete: { file: 'concrete', tile: 3, procTile: 3, roughness: 0.92, metalness: 0.0, proc: (T) => T.concrete() },
    concreteDark: { file: 'plaster', tile: 3, procTile: 3, roughness: 0.95, metalness: 0.0, procColor: '#6d6a66', proc: (T) => T.concrete() },
    roof: { file: 'roof', tile: 3, procTile: 3, roughness: 1.0, metalness: 0.0, procColor: '#5a5753', proc: (T) => ({ map: T.concrete().map }) },
    facade: {
      file: 'facade', tile: [12, 9], procTile: [12, 9], roughness: 0.85, metalness: 0.05,
      proc: (T, seed) => T.facade(seed + 500), procEmissive: '#ffb15c', fileEmissive: '#ffffff', emissiveIntensity: 1.1, fileEmissiveIntensity: 1.6
    },
    container: { file: 'container', tile: 3, procTile: 3, roughness: 0.6, metalness: 0.55, tints: CONTAINER_COLORS, proc: (T, seed, i) => T.metal(CONTAINER_COLORS[i], 60 + i) },
    crate: { file: 'wood', tile: 1.2, procTile: 1.2, roughness: 0.9, metalness: 0.0, proc: (T) => T.metal('#8a6a3c', 70) },
    crateFrame: { color: '#4a3a26', roughness: 0.9, metalness: 0.0 },
    barrel: { file: 'rust', tile: 1, procTile: 0, roughness: 0.5, metalness: 0.7, tints: BARREL_COLORS, proc: (T, seed, i) => T.metal(BARREL_COLORS[i], 80 + i) },
    hazard: { file: 'hazard', tile: 1, procTile: 0, roughness: 0.6, metalness: 0.3, proc: (T) => ({ map: T.hazard() }) },
    sandbag: { file: 'sandbag', tile: 1, procTile: 0, roughness: 1.0, metalness: 0.0, procColor: '#8c7f5c' },
    metalDark: { file: 'metal', tile: 1, procTile: 1, roughness: 0.55, metalness: 0.8, procColor: '#2a2d33' },
    lampGlow: { basic: true, color: '#dff6ff', toneMapped: false },
    skyline: { color: '#2a3140', roughness: 1.0, metalness: 0.0 },
    skylineWindow: { basic: true, color: '#ffd28a' },

    // ---------- 街（midtown）。tile = city-textures.md の 1 枚の実寸 ----------
    limestone: C({ file: 'limestone', tile: 4, roughness: 0.9, placeholder: '#c9bfa8' }),
    brick_brown: C({ file: 'brick_brown', tile: [9, 7.2], roughness: 0.9, windows: true, placeholder: '#6a4a36' }),
    brick_red: C({ file: 'brick_red', tile: [9, 7.2], roughness: 0.9, windows: true, placeholder: '#8e3d2c' }),
    glass_tower: C({ file: 'glass_tower', tile: [12, 8], roughness: 0.1, metalness: 0.8, windows: true, placeholder: '#4c5d6c' }),
    office_stone: C({ file: 'office_stone', tile: [12, 8], roughness: 0.8, windows: true, placeholder: '#a39a8c' }),
    limestone_win: C({ file: 'office_stone', tile: [12, 8], roughness: 0.8, windows: true, placeholder: '#c9bfa8', fileColor: [1.12, 1.1, 1.04], procName: 'office_stone', procColor2: '#cfc4ad' }),
    concrete_win: C({ file: 'office_stone', tile: [12, 8], roughness: 0.8, windows: true, placeholder: '#9b968d', fileColor: [0.92, 0.95, 1.0], procName: 'office_stone', procColor2: '#9d9a93' }),
    sidewalk: C({ file: 'sidewalk', tile: 8, roughness: 0.9, placeholder: '#9b988f' }),
    curb: C({ file: 'curb', tile: 2, roughness: 0.75, placeholder: '#8f8d8b' }),
    asphalt_city: C({ file: 'asphalt_city', tile: 10, roughness: 0.92, placeholder: '#45454a', fileColor: [2.0, 2.0, 2.08] }), // アルベドがとても暗い（夕方の影で真っ黒になる）ので持ち上げる
    manhole: C({ file: 'manhole', tile: 0.9, roughness: 0.45, metalness: 0.8, placeholder: '#3a3836', decal: true }),
    asphalt_patch: C({ file: 'asphalt_patch', tile: 4, roughness: 0.85, placeholder: '#38383c', decal: true, fileColor: [2.0, 2.0, 2.08] }),
    marble_floor: C({ file: 'marble_floor', tile: 4, roughness: 0.2, placeholder: '#ccab95' }),
    terrazzo: C({ file: 'terrazzo', tile: 2, roughness: 0.4, placeholder: '#b9b2a5' }),
    wood_floor: C({ file: 'wood_floor', tile: 2, roughness: 0.6, placeholder: '#a8794e' }),
    carpet_office: C({ file: 'carpet_office', tile: 2, roughness: 1.0, placeholder: '#4a525c' }),
    plaster_interior: C({ file: 'plaster_interior', tile: [3, 3.6], roughness: 0.95, placeholder: '#d9d3c6', glow: '#ffdcae', glowIntensity: 0.07 }),
    concourse_ceiling: C({ file: 'concourse_ceiling', tile: 20, roughness: 0.5, emissiveFile: true, fileEmissiveIntensity: 1.0, placeholder: '#4d8b8e' }),
    grass: C({ file: 'grass', tile: 4, roughness: 1.0, placeholder: '#4f6b2f' }),
    gravel_roof: C({ file: 'gravel_roof', tile: 3, roughness: 1.0, placeholder: '#5f5a54' }),
    stair_stone: C({ file: 'stair_stone', tile: 2, roughness: 0.7, placeholder: '#aaa397' }),
    billboard: C({ file: 'billboards', tile: 1, roughness: 0.35, metalness: 0.0, emissiveFile: true, fileEmissiveIntensity: 1.2, placeholder: '#202024' }),
    red_glass: C({ color: '#a3161c', roughness: 0.18, metalness: 0.1, emissiveColor: '#6a070b', emissiveIntensity: 0.55 }),
    glass_rail: C({ color: '#a9c2cf', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.32 }),
    hull_grey: C({ color: '#6b7178', roughness: 0.6, metalness: 0.3, proc: (T) => T.city('hull_grey') }),
    carrier_deck: C({ color: '#3d3f42', roughness: 0.85, metalness: 0.1, proc: (T) => T.city('carrier_deck') }),
    ice: C({ color: '#dbe8ee', roughness: 0.12, metalness: 0.0 }),
    rock: C({ color: '#7a7468', roughness: 0.95, metalness: 0.0, proc: (T) => T.city('rock') }),
    roadPaint: C({ vertexColors: true, color: '#ffffff', roughness: 0.6, metalness: 0.0, decal: true }),
    foliage: C({ color: '#33502a', roughness: 1.0, metalness: 0.0 })
  };
  // 街の定義の既定値（Canvas 版は MR.Textures.city(名前)。ファイルと同じ実寸で描いてあるので procTile = tile）
  function C(d) {
    d.city = true;
    if (d.roughness === undefined) d.roughness = 0.9;
    if (d.metalness === undefined) d.metalness = 0.0;
    if (d.file && !d.proc) { const n = d.procName || d.file; d.proc = (T, seed) => T.city(n, seed, d.procColor2); }
    if (d.windows) { d.emissiveFile = true; if (d.fileEmissiveIntensity === undefined) d.fileEmissiveIntensity = 1.4; }
    if (d.procTile === undefined) d.procTile = d.tile;
    return d;
  }
  // emissive.jpg を読むテクスチャセット
  const EMISSIVE_FILES = { facade: true };
  for (const k of Object.keys(DEFS)) if (DEFS[k].emissiveFile && DEFS[k].file) EMISSIVE_FILES[DEFS[k].file] = true;
  // SPEC §1 のテクスチャ名でも呼べるように
  const ALIASES = { asphalt: 'road', plaster: 'concreteDark', wood: 'crate', rust: 'barrel', metal: 'metalDark' };

  function isTouch() {
    try {
      return (typeof window !== 'undefined' && 'ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    } catch (e) { return false; }
  }

  function stableJson(obj) {
    if (!obj || typeof obj !== 'object') return String(obj);
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
  }

  class Materials {
    // assets: MR.AssetManager（null 可 = 常に Canvas 版）、renderer: 異方性フィルタの上限を調べるのに使う（null 可）
    // opts: { tier, anisotropy, useFiles, seed }
    constructor(assets, renderer, opts) {
      opts = opts || {};
      this.assets = assets || null;
      // 街の窓（brick / glass_tower / office_stone の emissive.jpg）の発光の強さ（render.city.windowEmissive）。null = 定義の値
      this.windowEmissive = typeof opts.windowEmissive === 'number' ? opts.windowEmissive : null;
      // 街のテクスチャの大きさの上限（render.city.textureMax: { albedo, normal, orm, emissive, interior }。タッチ端末で GPU メモリを抑える）。
      // interior は室内の材質（床・壁・天井・階段）の全部の画像の上限
      this.textureMax = opts.textureMax || null;
      this.renderer = renderer || null;
      this.tier = opts.tier || (assets && assets.tier) || null;
      this.seed = typeof opts.seed === 'number' ? opts.seed : 1;
      this.useFiles = opts.useFiles !== false && !!(assets && typeof assets.resolve === 'function' && typeof assets.loadTexture === 'function');

      let maxAniso = 16;
      try {
        if (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') maxAniso = renderer.capabilities.getMaxAnisotropy() || 1;
      } catch (e) { maxAniso = 1; }
      const wanted = typeof opts.anisotropy === 'number' && opts.anisotropy > 0 ? opts.anisotropy : (isTouch() ? 4 : 8);
      this.anisotropy = Math.max(1, Math.min(wanted, maxAniso));

      this.materials = {};   // キー -> material（キャッシュ）
      this._keys = new Set(); // assets.loadTexture に頼んだテクスチャのキャッシュのキー（textureKeys()）
      this.sets = {};        // テクスチャセット名 -> { textures, users, loaded, failed, promise } | null（無い）
      this.loaded = 0;       // 届いたテクスチャセット数
      this.failed = 0;       // 失敗したセット数
      this._pending = [];
      this.source = 'procedural';   // 'files' | 'procedural'（ファイルが 1 つでも使えるなら files）
      if (this.useFiles) {
        for (const name of Object.keys(DEFS)) {
          const f = DEFS[name].file;
          if (f && this.assets.resolve('textures/' + f + '/albedo.jpg')) { this.source = 'files'; break; }
        }
      }
    }

    static get DEFS() { return DEFS; }
    // 室内だけで見る材質のテクスチャセット（textureMax.interior の対象）
    static get INTERIOR_FILES() { return { marble_floor: true, terrazzo: true, wood_floor: true, carpet_office: true, plaster_interior: true, stair_stone: true, concourse_ceiling: true }; }

    static get CONTAINER_COLORS() { return CONTAINER_COLORS; }
    static get BARREL_COLORS() { return BARREL_COLORS; }

    // 名前を分解: 'container2' → { base: 'container', tint: 2 }、'prop:barrel#1' → { base: 'prop:barrel', tint: 1 }
    static parseName(name) {
      name = String(name || '');
      let m = /^(.*)#(\d+)$/.exec(name);
      if (m) return { base: m[1], tint: Number(m[2]) };
      m = /^(container|barrel)(\d+)$/.exec(name);
      if (m) return { base: m[1], tint: Number(m[2]) };
      return { base: ALIASES[name] || name, tint: null };
    }

    // 色番号 → 色。prop:xxx は名前から判断（barrel を含めばバレルの色、他はコンテナの色）。extra.palette で指定も可
    static tintColor(base, tint, palette) {
      let list = null;
      if (palette === 'barrel') list = BARREL_COLORS;
      else if (palette === 'container') list = CONTAINER_COLORS;
      else if (DEFS[base] && DEFS[base].tints) list = DEFS[base].tints;
      else list = /barrel|rust/i.test(base) ? BARREL_COLORS : CONTAINER_COLORS;
      return MR.srgb(list[((tint || 0) % list.length + list.length) % list.length]);
    }

    // ---------- 公開 API ----------

    // name のマテリアル（キャッシュ）。extra = { color, roughness, metalness, repeat, tint, palette } で派生版を作る
    //   color: hex 文字列（MR.srgb で変換）か THREE.Color。roughness / metalness: ファイル版では ORM に掛かる係数
    //   repeat: テクスチャを clone して repeat を変える（GPU メモリが増えるので world.js は使わず UV を実寸にする）
    get(name, extra) {
      const parsed = Materials.parseName(name);
      let tint = parsed.tint;
      if (extra && typeof extra.tint === 'number') tint = extra.tint;
      const hasExtra = extra && Object.keys(extra).some((k) => k !== 'tint');
      const key = parsed.base + (tint !== null && tint !== undefined ? '#' + tint : '') + (hasExtra ? '|' + stableJson(extra) : '');
      if (this.materials[key]) return this.materials[key];
      let mat = null;
      if (parsed.base.indexOf('prop:') === 0) mat = this._propVariant(parsed.base, tint, hasExtra ? extra : null);
      else mat = this._create(parsed.base, tint, hasExtra ? extra : null);
      if (!mat) return null;
      this.materials[key] = mat;
      return mat;
    }

    // get(name) がこれから Canvas のテクスチャを作るか（画像の無い端末・届かなかったセット・色だけの街の材質 hull_grey / carrier_deck / rock）。
    //   作るなら 1 つ 10〜100 ms かかる（prepare で少しずつ先に作れる）。もう作ってある・画像を使う・単色なら false
    needsCanvas(name) {
      const parsed = Materials.parseName(name);
      const def = DEFS[parsed.base];
      if (!def || def.basic || !def.proc || this.materials[parsed.base + (parsed.tint !== null ? '#' + parsed.tint : '')]) return false;
      if (def.city && !def.file) return true;
      const set = def.file ? this._fileSet(def.file) : null;
      return !(set && !set.failedAll);
    }

    // get(name) の重い所（Canvas のテクスチャ）を少しずつ先に作るジェネレーター（MR.Textures.job。結果は同じキャッシュに入り、
    //   その後の get は軽い）。作る物が無ければ null。同じ名前の作りかけは 1 つを共有する（街の組み立てと、手の空いたフレームの
    //   先読み（world.warmStep）の両方から next() してよい。終わったものの next() は done を返す）
    prepare(name) {
      if (!this.needsCanvas(name)) return null;
      const parsed = Materials.parseName(name);
      const key = parsed.base + (parsed.tint !== null ? '#' + parsed.tint : '');
      const prep = this._prep || (this._prep = {});
      if (prep[key]) return prep[key];
      const def = DEFS[parsed.base], seed = this.seed, tint = parsed.tint || 0;
      const T = MR.Textures;
      const JT = T && T.job ? Object.assign(Object.create(T), T.job) : T;
      const it = (function* () {
        const r = JT ? def.proc(JT, seed, tint) : null;
        if (r && typeof r.next === 'function') yield* r;
        delete prep[key];
      })();
      prep[key] = it;
      return it;
    }

    has(name) {
      const parsed = Materials.parseName(name);
      return !!(this.materials[parsed.base] || DEFS[parsed.base]);
    }

    // 外部のマテリアル（props.glb のもの）を名前で登録する。テクスチャに異方性フィルタを付ける
    register(name, material) {
      if (!material) return null;
      this.materials[name] = material;
      this._applyAnisotropy(material);
      return material;
    }

    // テクスチャ 1 枚の実寸 { u, v }（m）。0 = 引き伸ばし（repeat 1）。world.js が UV のスケールに使う
    tile(name) {
      const parsed = Materials.parseName(name);
      const def = DEFS[parsed.base];
      if (!def) return { u: 1, v: 1 };
      const t = this.usesFile(parsed.base) ? def.tile : (def.procTile !== undefined ? def.procTile : def.tile);
      if (Array.isArray(t)) return { u: t[0], v: t[1] };
      return { u: t || 0, v: t || 0 };
    }

    // そのマテリアルにファイルテクスチャが使われる（届く予定か届いている）か
    usesFile(name) {
      const parsed = Materials.parseName(name);
      const def = DEFS[parsed.base];
      if (!def || !def.file) return false;
      const set = this._fileSet(def.file);
      return !!(set && !set.failedAll);
    }

    // 全テクスチャセットの読み込みを今すぐ始める（ロード画面の間に先読みしたいとき）。
    // 街の材質（city: true）は opts.city のときだけ（arena01 では今までどおり読まない）
    preload(opts) {
      if (!this.useFiles) return this.ready;
      const city = !!(opts && opts.city);
      for (const name of Object.keys(DEFS)) if (DEFS[name].file && (city || !DEFS[name].city)) this._fileSet(DEFS[name].file);
      return this.ready;
    }

    // これまでに始まった読み込みが全部終わったら解決する（失敗しても reject しない）
    get ready() {
      return Promise.all(this._pending.slice()).then(() => this);
    }

    names() { return Object.keys(this.materials); }

    dispose() {
      for (const key of Object.keys(this.materials)) {
        const m = this.materials[key];
        if (m && m.userData && m.userData.mrOwned && typeof m.dispose === 'function') m.dispose();
      }
      this.materials = {};
    }

    // 頼んだ（届いていない物も含む）ファイルテクスチャのキャッシュのキー（assets.textureKey）
    textureKeys() {
      const out = new Set(this._keys);
      for (const name of Object.keys(this.sets)) {
        const set = this.sets[name];
        if (!set) continue;
        for (const slot in set.textures) { const t = set.textures[slot]; if (t && t.mrCacheKey) out.add(t.mrCacheKey); }
      }
      return out;
    }

    // ほかのレベルへ移るとき（main.js）: keep（次のレベルの textureKeys()）に無いファイルテクスチャを GPU から捨て、assets のキャッシュからも外す
    //   （ImageBitmap は閉じる）。色違い・repeat の clone も GPU から捨てる（画像は元と共有なので閉じない）。
    //   この Materials はこのあと使わない（main.js が matsByLevel から消す）。props.glb など外から register した材質には触らない
    disposeTextures(keep) {
      const assets = this.assets;
      let n = 0;
      const dropped = new Set();
      for (const name of Object.keys(this.sets)) {
        const set = this.sets[name];
        if (!set) continue;
        for (const slot of Object.keys(set.textures)) {
          const t = set.textures[slot];
          if (!t || dropped.has(t) || (t.mrCacheKey && keep && keep.has(t.mrCacheKey))) continue;
          dropped.add(t);
          t.dispose();
          if (assets && typeof assets.forgetTexture === 'function') assets.forgetTexture(t);
          const img = t.image;
          if (img && typeof img.close === 'function') { try { img.close(); } catch (e) { /* 無視 */ } }
          n++;
        }
      }
      for (const key of Object.keys(this.materials)) {
        const m = this.materials[key];
        if (!m || !m.userData || !m.userData.mrOwned) continue;
        for (const slot of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          const t = m[slot];
          if (t && t.mrClone && !dropped.has(t)) { dropped.add(t); t.dispose(); n++; }
        }
      }
      return n;
    }

    // ---------- 内部 ----------

    _create(base, tint, extra) {
      const def = DEFS[base];
      if (!def) return null;
      let mat;
      if (def.basic) {
        mat = new THREE.MeshBasicMaterial({ color: MR.srgb(def.color), toneMapped: def.toneMapped !== false });
      } else {
        mat = new THREE.MeshStandardMaterial({ roughness: def.roughness, metalness: def.metalness });
        if (def.vertexColors) mat.vertexColors = true;
        if (def.transparent) { mat.transparent = true; mat.opacity = def.opacity; mat.depthWrite = false; }
        // 道路のデカール（車線・マンホール・補修跡）: 地面より手前に描く
        if (def.decal) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2; }
        if (def.emissiveColor) { mat.emissive = MR.srgb(def.emissiveColor); mat.emissiveIntensity = def.emissiveIntensity || 1; }
        if (def.glow) { mat.emissive = MR.srgb(def.glow); mat.emissiveIntensity = def.glowIntensity || 0.05; }
        if (def.color) mat.color = MR.srgb(def.color);
        if (def.procColor) mat.color = MR.srgb(def.procColor);
        // ファイルテクスチャが来る予定なら Canvas 版は作らない（512² のテクスチャを 30 枚近く無駄に作らないため）。
        // 届くまでは平均色の無地。ファイルが全部失敗したときは _applyProc で後から Canvas 版を作る
        const set = def.file ? this._fileSet(def.file) : null;
        if (set && !set.failedAll) {
          if (!def.procColor && !def.color) mat.color = MR.srgb(def.placeholder || '#7a7570');
        } else {
          this._applyProc(mat, def, tint);
        }
        if (def.city && def.proc && !def.file) this._applyProc(mat, def, tint); // 色だけの街の材質にも Canvas の質感
        if (def.normalScale) mat.normalScale.set(def.normalScale, def.normalScale);
      }
      mat.name = base + (tint !== null && tint !== undefined ? tint : '');
      mat.userData.mrDef = base;
      mat.userData.mrTint = tint;
      mat.userData.mrSource = 'procedural';
      mat.userData.mrOwned = true;
      if (extra) mat.userData.mrExtra = extra;

      if (!def.basic && def.file) {
        const set = this._fileSet(def.file);
        if (set) {
          set.users.push(mat);
          if (set.loaded) this._applyFiles(mat, set);
        }
      }
      if (extra) this._applyExtra(mat, extra);
      return mat;
    }

    // Canvas テクスチャ（今までの見た目）を付ける。ファイルが無い／失敗したときの表示
    _applyProc(mat, def, tint) {
      const T = MR.Textures;
      if (!def.proc || !T) return;
      const tex = def.proc(T, this.seed, tint || 0) || {};
      if (tex.map) mat.map = tex.map;
      if (tex.normal) mat.normalMap = tex.normal;
      if (tex.emissive) {
        mat.emissiveMap = tex.emissive;
        mat.emissive = MR.srgb(def.procEmissive || '#ffffff');
        mat.emissiveIntensity = def.windows ? this._windowIntensity(def) : (def.emissiveIntensity || def.fileEmissiveIntensity || 1);
      }
      if (def.procColor) mat.color = MR.srgb(def.procColor);
      else if (!def.color) mat.color.setRGB(1, 1, 1);
      mat.needsUpdate = true;
    }

    // props.glb のマテリアルの色違い（clone）。extra だけのときも clone
    _propVariant(base, tint, extra) {
      const src = this.materials[base];
      if (!src) return null;
      if ((tint === null || tint === undefined) && !extra) return src;
      const m = src.clone();
      m.name = src.name + (tint !== null && tint !== undefined ? '#' + tint : '');
      m.userData = Object.assign({}, src.userData, { mrOwned: true, mrTint: tint });
      if (tint !== null && tint !== undefined) m.color.copy(Materials.tintColor(base, tint, extra && extra.palette));
      if (extra) this._applyExtra(m, extra);
      return m;
    }

    _applyExtra(mat, extra) {
      if (extra.color !== undefined && mat.color) {
        if (extra.color && extra.color.isColor) mat.color.copy(extra.color);
        else mat.color.copy(MR.srgb(extra.color));
      }
      if (typeof extra.roughness === 'number' && 'roughness' in mat) mat.roughness = extra.roughness;
      if (typeof extra.metalness === 'number' && 'metalness' in mat) mat.metalness = extra.metalness;
      if (extra.repeat !== undefined) {
        const r = typeof extra.repeat === 'number' ? [extra.repeat, extra.repeat] : extra.repeat;
        for (const slot of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          const t = mat[slot];
          if (!t) continue;
          const c = t.clone();
          c.mrClone = true;
          c.repeat.set(r[0], r[1]);
          c.needsUpdate = true;
          mat[slot] = c;
        }
        // orm は 3 スロット同じテクスチャなので揃える
        if (mat.aoMap && mat.roughnessMap && mat.aoMap.image === mat.roughnessMap.image) { mat.roughnessMap = mat.aoMap; mat.metalnessMap = mat.aoMap; }
      }
      mat.needsUpdate = true;
    }

    // テクスチャセット（albedo / normal / orm [/ emissive]）の読み込みを始める（1 セット 1 回）。無ければ null
    _fileSet(fileName) {
      if (this.sets[fileName] !== undefined) return this.sets[fileName];
      if (!this.useFiles) return (this.sets[fileName] = null);
      const assets = this.assets;
      const dir = 'textures/' + fileName + '/';
      const albedo = assets.resolve(dir + 'albedo.jpg');
      if (!albedo) return (this.sets[fileName] = null);

      const set = { name: fileName, textures: {}, users: [], loaded: false, failed: false, failedAll: false, promise: null };
      const want = [
        ['map', albedo, { srgb: true }],
        ['normalMap', assets.resolve(dir + 'normal.png') || assets.resolve(dir + 'normal.jpg'), {}],
        ['orm', assets.resolve(dir + 'orm.jpg') || assets.resolve(dir + 'orm.png'), {}]
      ];
      if (EMISSIVE_FILES[fileName]) want.push(['emissiveMap', assets.resolve(dir + 'emissive.jpg') || assets.resolve(dir + 'emissive.png'), { srgb: true }]);
      const loads = [];
      const lim = this.textureMax, inner = !!(lim && Materials.INTERIOR_FILES[fileName]);
      const SLOT_KEY = { map: 'albedo', normalMap: 'normal', orm: 'orm', emissiveMap: 'emissive' };
      for (const w of want) {
        if (!w[1]) continue;
        const slot = w[0], key = w[1];
        const opts = Object.assign({ anisotropy: this.anisotropy }, w[2]);
        if (lim) {
          let m = lim[SLOT_KEY[slot]] || 0;
          if (inner && lim.interior) m = m ? Math.min(m, lim.interior) : lim.interior;
          if (m) opts.maxSize = m;
        }
        if (typeof assets.textureKey === 'function') this._keys.add(assets.textureKey(key, opts));
        let p;
        try { p = Promise.resolve(assets.loadTexture(key, opts)); } catch (e) { p = Promise.reject(e); }
        loads.push(p.then((tex) => { if (tex) set.textures[slot] = tex; }, (e) => {
          set.failed = true;
          console.warn('[Materials] テクスチャ読み込み失敗:', key, e && e.message);
        }));
      }
      set.promise = Promise.all(loads).then(() => {
        if (set.textures.map) {
          set.loaded = true;
          this.loaded++;
          for (const m of set.users) this._applyFiles(m, set);
        } else {
          set.failedAll = true;
          this.failed++;
          // 全部失敗: Canvas 版を作って付ける（実寸のタイルは world 側がファイル用に焼いているので、repeat で補正）
          for (const m of set.users) {
            const def = DEFS[m.userData.mrDef] || {};
            this._applyProc(m, def, m.userData.mrTint);
            const ft = Array.isArray(def.tile) ? def.tile : [def.tile || 1, def.tile || 1];
            const pt = def.procTile === undefined ? ft : (Array.isArray(def.procTile) ? def.procTile : [def.procTile, def.procTile]);
            const ru = (pt[0] && ft[0]) ? ft[0] / pt[0] : 1, rv = (pt[1] && ft[1]) ? ft[1] / pt[1] : 1;
            if (ru !== 1 || rv !== 1) {
              for (const slot of ['map', 'normalMap', 'emissiveMap']) {
                if (!m[slot]) continue;
                const c = m[slot].clone(); c.mrClone = true; c.repeat.set(ru, rv); c.needsUpdate = true; m[slot] = c;
              }
            }
          }
        }
        this._updateSource();
        return set;
      });
      this._pending.push(set.promise);
      this.sets[fileName] = set;
      return set;
    }

    // 届いたファイルテクスチャをマテリアルに差し込む
    _applyFiles(mat, set) {
      const def = DEFS[mat.userData.mrDef] || {};
      const tex = set.textures;
      if (tex.map) mat.map = tex.map;
      if (tex.normalMap) {
        mat.normalMap = tex.normalMap;
        mat.normalScale.set(def.fileNormalScale || 1, def.fileNormalScale || 1);
      } else {
        mat.normalMap = null; // Canvas 版の法線はアルベドと合わないので外す
      }
      if (tex.orm) {
        mat.aoMap = tex.orm;
        mat.aoMapIntensity = 1.0;
        mat.roughnessMap = tex.orm;
        mat.metalnessMap = tex.orm;
        mat.roughness = 1.0;   // ORM の値をそのまま使う（extra.roughness があれば係数になる）
        mat.metalness = 1.0;
      }
      if (tex.emissiveMap) {
        mat.emissiveMap = tex.emissiveMap;
        mat.emissive = MR.srgb(def.fileEmissive || '#ffffff');
        mat.emissiveIntensity = def.windows ? this._windowIntensity(def) : (def.fileEmissiveIntensity || def.emissiveIntensity || 1);
      }
      // 色: 色違いは色番号の色、それ以外は白（アルベドに色が入っている）。fileColor はアルベドに掛ける係数（同じテクスチャの色違い）
      const tint = mat.userData.mrTint;
      if (def.tints) mat.color.copy(Materials.tintColor(mat.userData.mrDef, tint || 0));
      else if (def.fileColor) mat.color.setRGB(def.fileColor[0], def.fileColor[1], def.fileColor[2]);
      else mat.color.setRGB(1, 1, 1);
      if (mat.userData.mrExtra) this._applyExtra(mat, mat.userData.mrExtra);
      mat.userData.mrSource = 'files';
      mat.needsUpdate = true;
    }

    _windowIntensity(def) {
      return this.windowEmissive !== null ? this.windowEmissive : (def.fileEmissiveIntensity || 1);
    }

    _applyAnisotropy(material) {
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) {
        if (!m) continue;
        for (const slot of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          const t = m[slot];
          if (t && t.isTexture && t.anisotropy < this.anisotropy) { t.anisotropy = this.anisotropy; t.needsUpdate = true; }
        }
      }
    }

    _updateSource() {
      if (!this.useFiles) { this.source = 'procedural'; return; }
      // 1 つでも届いていれば files。全部失敗したら procedural に戻す
      if (this.loaded > 0) this.source = 'files';
      else if (this.failed > 0 && this._pending.length === this.failed) this.source = 'procedural';
    }
  }

  return Materials;
})();
