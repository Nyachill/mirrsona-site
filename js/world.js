// レベルの見た目を組み立てる。障害物リスト（nav.js の buildBoxes）から種類ごとにメッシュを作り、
// 同じマテリアルのものは 1 つのジオメトリに結合してドローコールを減らす。
//
// マテリアルは materials.js（MR.Materials）から名前で取る。テクスチャがファイルで届くときも world はそれを待たない
// （Canvas 版で即表示 → 届いたら materials.js がその場で差し替える）。
//
// 小物（crate / barrel / sandbag / barrier / lamp、コンテナの扉）は assets に models/props.glb があれば
// その形に置き換える。GLB は非同期なので 2 段階で組む:
//   1. 今までどおりのプリミティブで即座に全部作る（置き換え予定の種類だけ別メッシュにしておく）
//   2. GLB が届いたら、その種類のプリミティブのメッシュを外し、プロップのジオメトリを同じ配置で結合して足す
//      （プロップのマテリアル × 色 ごとに 1 メッシュ）。GLB が無い／失敗したら 1 のまま。
window.MR = window.MR || {};

MR.World = class World {
  // scene, level, renderCfg（config.render、タッチ端末の上書き込み）
  // opts: { materials: MR.Materials, assets: MR.AssetManager, renderer }（materials が無ければここで作る）
  constructor(scene, level, renderCfg, opts) {
    opts = opts || {};
    this.scene = scene;
    this.level = level;
    this.cfg = renderCfg || {};
    this.assets = opts.assets || (opts.materials && opts.materials.assets) || null;
    this.nav = new MR.Nav(level);
    this.meshes = [];
    this.groups = {};           // 結合キー -> ジオメトリ配列（結合用）
    this.categoryMeshes = {};   // 置き換え予定の種類 -> その種類だけで作ったメッシュ
    this.props = null;          // props.glb から取り出した部品 { name: { parts: [{ geo, matKey }], bbox } }
    this.propsSource = 'procedural'; // 'files' | 'procedural' | 'loading'
    this.disposed = false;
    this._category = null;
    this._propMatKeys = {};

    this.materials = opts.materials || World.createMaterials(this.assets, opts.renderer || null, this.cfg, level);

    // プロップの GLB が使えるか（同期で分かる）。使えるなら置き換え対象の種類を別メッシュにして組む
    this._propsKey = this._resolvePropsKey();
    this._build();
    this._flush();

    this.propsReady = this._propsKey ? this._loadProps(this._propsKey) : Promise.resolve(false);
  }

  static get PROPS_FILE() { return 'models/props.glb'; }
  static get PROP_NODES() { return ['crate', 'barrel', 'sandbag', 'barrier', 'lamp', 'container_door']; }
  // プロップの想定の高さ（SPEC §2.5）。実物がこれから 15% 以上ずれていたら合わせて拡縮する
  static get PROP_HEIGHT() { return { crate: 1.2, barrel: 0.95, sandbag: 0.3, barrier: 1.1, lamp: 5.2, container_door: 2.6 }; }
  // GLB で置き換える障害物の種類（nav の type）
  static get REPLACEABLE() { return { crate: 'crate', barrel: 'barrel', sandbag: 'sandbag', barrier: 'barrier', lamp: 'lamp' }; }

  // MR.Materials を作る。materials.js が読まれていない場合は今までのマテリアルを直接作る（互換）
  static createMaterials(assets, renderer, cfg, level) {
    cfg = cfg || {};
    if (MR.Materials) {
      return new MR.Materials(assets, renderer, {
        tier: assets && assets.tier,
        anisotropy: cfg.anisotropy,
        useFiles: cfg.textures !== false,
        seed: (level && level.seed) || 1
      });
    }
    return World.legacyMaterials(level || {});
  }

  // materials.js 無しのフォールバック（今までの _buildMaterials と同じ見た目・同じ API の最小版）
  static legacyMaterials(level) {
    const T = MR.Textures;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const M = {};
    const ground = T.ground(), road = T.road(), concrete = T.concrete();
    M.ground = std({ map: ground.map, normalMap: ground.normal, roughness: 0.95, metalness: 0.0 }); M.ground.normalScale.set(0.6, 0.6);
    M.road = std({ map: road.map, normalMap: road.normal, roughness: 0.9, metalness: 0.0 }); M.road.normalScale.set(0.5, 0.5);
    M.concrete = std({ map: concrete.map, normalMap: concrete.normal, roughness: 0.92, metalness: 0.0 });
    M.concreteDark = std({ map: concrete.map, normalMap: concrete.normal, color: MR.srgb('#6d6a66'), roughness: 0.95 });
    M.roof = std({ map: concrete.map, color: MR.srgb('#5a5753'), roughness: 1.0 });
    const facade = T.facade((level.seed || 1) + 500);
    M.facade = std({ map: facade.map, emissiveMap: facade.emissive, emissive: MR.srgb('#ffb15c'), emissiveIntensity: 1.1, roughness: 0.85, metalness: 0.05 });
    ['#b8442c', '#2e6fb3', '#3a8f4f', '#d9a52a', '#8f8f95'].forEach((c, i) => { const t = T.metal(c, 60 + i); M['container' + i] = std({ map: t.map, normalMap: t.normal, roughness: 0.6, metalness: 0.55 }); });
    const wood = T.metal('#8a6a3c', 70);
    M.crate = std({ map: wood.map, normalMap: wood.normal, roughness: 0.9, metalness: 0.0 });
    M.crateFrame = std({ color: MR.srgb('#4a3a26'), roughness: 0.9 });
    ['#3f5f3e', '#8a2f2a', '#4a4f58'].forEach((c, i) => { const t = T.metal(c, 80 + i); M['barrel' + i] = std({ map: t.map, normalMap: t.normal, roughness: 0.5, metalness: 0.7 }); });
    M.hazard = std({ map: T.hazard(), roughness: 0.6, metalness: 0.3 });
    M.sandbag = std({ color: MR.srgb('#8c7f5c'), roughness: 1.0, metalness: 0.0 });
    M.metalDark = std({ color: MR.srgb('#2a2d33'), roughness: 0.55, metalness: 0.8 });
    M.lampGlow = new THREE.MeshBasicMaterial({ color: MR.srgb('#dff6ff') });
    M.skyline = std({ color: MR.srgb('#2a3140'), roughness: 1.0, metalness: 0.0 });
    M.skylineWindow = new THREE.MeshBasicMaterial({ color: MR.srgb('#ffd28a') });
    const tiles = { ground: [6, 6], road: [8, 0], concrete: [3, 3], concreteDark: [3, 3], roof: [3, 3], facade: [12, 9], container: [3, 3], crate: [1.2, 1.2], metalDark: [1, 1] };
    return {
      source: 'procedural', assets: null, materials: M, ready: Promise.resolve(),
      get(name) { const m = /^(.*)#(\d+)$/.exec(name); return (m ? (M[m[1] + m[2]] || M[m[1]]) : M[name]) || null; },
      has(name) { return !!M[name]; },
      register(name, mat) { M[name] = mat; return mat; },
      usesFile() { return false; },
      tile(name) { const b = name.replace(/\d+$/, ''); const t = tiles[b] || [0, 0]; return { u: t[0], v: t[1] }; }
    };
  }

  // ---------- 組み立て ----------

  _build() {
    const level = this.level;
    const size = level.size, half = size / 2;
    const roadW = level.roadWidth || 7;

    // 地面（UV を実寸でスケール。テクスチャ側の repeat は 1 のまま）
    const groundSize = size + 90;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    groundGeo.rotateX(-Math.PI / 2);
    const gt = this._tile('ground');
    World.scaleUV2(groundGeo, gt.u ? groundSize / gt.u : 1, gt.v ? groundSize / gt.v : 1);
    World.ensureUv2(groundGeo);
    const ground = new THREE.Mesh(groundGeo, this._material('ground'));
    ground.receiveShadow = true;
    ground.name = 'ground';
    this._addMesh(ground);

    // 道路（十字）: 画像の横（U）が進行方向、縦（V）が道幅
    const rt = this._tile('road');
    for (let i = 0; i < 2; i++) {
      const g = new THREE.PlaneGeometry(size, roadW);
      g.rotateX(-Math.PI / 2);
      World.scaleUV2(g, rt.u ? size / rt.u : 1, rt.v ? roadW / rt.v : 1);
      if (i === 1) g.rotateY(Math.PI / 2);
      World.ensureUv2(g);
      const road = new THREE.Mesh(g, this._material('road'));
      road.position.y = 0.02;
      road.receiveShadow = true;
      road.name = 'road';
      this._addMesh(road);
    }

    // 障害物
    const replaceable = this._propsKey ? World.REPLACEABLE : {};
    const ct = this._tile('concrete');
    for (const b of this.nav.boxes) {
      this._category = replaceable[b.type] || null;
      switch (b.type) {
        case 'building': this._building(b); break;
        case 'container': this._container(b); break;
        case 'barrier': this._barrier(b); break;
        case 'sandbag': this._sandbag(b); break;
        case 'crate': this._crate(b); break;
        case 'barrel': this._barrel(b); break;
        case 'lamp': this._lamp(b); break;
        default: this._push('concrete', World.boxGeo(b.w, b.h, b.d, ct.u, ct.v), b.x, b.h / 2, b.z);
      }
    }
    this._category = null;

    // 外周の壁と見張り塔
    const dt = this._tile('concreteDark'), mt = this._tile('metalDark');
    for (const w of this.nav.walls) {
      this._push('concrete', World.boxGeo(w.w, w.h, w.d, ct.u, ct.v), w.x, w.h / 2, w.z);
      this._push('concreteDark', World.boxGeo(w.w + 0.3, 0.3, w.d + 0.3, dt.u, dt.v), w.x, w.h + 0.15, w.z);
      const alongX = w.w > w.d;
      const len = Math.max(w.w, w.d);
      for (let p = -len / 2 + 6; p < len / 2; p += 12) {
        const px = alongX ? w.x + p : w.x, pz = alongX ? w.z : w.z + p;
        this._push('concreteDark', World.boxGeo(1.4, w.h + 0.6, 1.4, dt.u, dt.v), px, (w.h + 0.6) / 2, pz);
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tx = sx * (half + 3.5), tz = sz * (half + 3.5);
        this._push('concreteDark', World.boxGeo(4, 9, 4, dt.u, dt.v), tx, 4.5, tz);
        this._push('metalDark', World.boxGeo(5, 2.4, 5, mt.u, mt.v), tx, 10.2, tz);
        this._push('lampGlow', new THREE.BoxGeometry(4.6, 0.6, 0.1), tx, 10.0, tz - sz * 2.5);
        this._push('lampGlow', new THREE.BoxGeometry(0.1, 0.6, 4.6), tx - sx * 2.5, 10.0, tz);
      }
    }

    // 遠景のビル群（シルエット）
    const rnd = MR.seededRandom((level.seed || 1) + 999);
    for (let i = 0; i < 26; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = half + 30 + rnd() * 70;
      const bw = 8 + rnd() * 14, bh = 10 + rnd() * 30, bd = 8 + rnd() * 14;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      this._push('skyline', new THREE.BoxGeometry(bw, bh, bd), x, bh / 2, z, 0, true);
      if (rnd() < 0.7) {
        for (let k = 0; k < 4; k++) {
          const wy = 3 + rnd() * (bh - 6);
          this._push('skylineWindow', new THREE.BoxGeometry(1.2, 0.8, bd + 0.2), x + (rnd() - 0.5) * (bw - 2), wy, z, 0, true);
        }
      }
    }
  }

  // --- 各プロップ（プリミティブ版） ---

  _building(b) {
    // 外壁（上下面は捨てる）: テクスチャ 1 枚 = 窓 4 列 12m × 3 階 9m
    const ft = this._tile('facade');
    const sides = World.boxGeo(b.w, b.h, b.d, ft.u, ft.v);
    const idx = sides.index.array;
    const keep = [];
    for (let i = 0; i < 12; i++) keep.push(idx[i]);
    for (let i = 24; i < 36; i++) keep.push(idx[i]);
    sides.setIndex(keep);
    this._push('facade', sides, b.x, b.h / 2, b.z);
    // 屋上・基礎
    const rt = this._tile('roof'), dt = this._tile('concreteDark'), mt = this._tile('metalDark');
    this._push('roof', World.boxGeo(b.w, 0.3, b.d, rt.u, rt.v), b.x, b.h + 0.15, b.z);
    this._push('concreteDark', World.boxGeo(b.w + 0.4, 0.5, b.d + 0.4, dt.u, dt.v), b.x, b.h + 0.25, b.z);
    this._push('concreteDark', World.boxGeo(b.w + 0.3, 0.6, b.d + 0.3, dt.u, dt.v), b.x, 0.3, b.z);
    // 屋上の設備
    const rnd = MR.seededRandom(b.seed || 1);
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const uw = 1 + rnd() * 2, uh = 0.8 + rnd() * 1.4, ud = 1 + rnd() * 2;
      const ux = b.x + (rnd() - 0.5) * (b.w - uw - 1), uz = b.z + (rnd() - 0.5) * (b.d - ud - 1);
      this._push('metalDark', World.boxGeo(uw, uh, ud, mt.u, mt.v), ux, b.h + 0.5 + uh / 2, uz);
    }
    if (rnd() < 0.5) {
      const ax = b.x + (rnd() - 0.5) * (b.w - 2), az = b.z + (rnd() - 0.5) * (b.d - 2);
      this._push('metalDark', new THREE.CylinderGeometry(0.06, 0.06, 4, 6), ax, b.h + 2.5, az);
      this._push('lampGlow', new THREE.SphereGeometry(0.12, 6, 6), ax, b.h + 4.5, az);
    }
  }

  _container(b) {
    const mat = 'container' + (b.color || 0);
    const L = Math.max(b.w, b.d), W = Math.min(b.w, b.d), H = b.h;
    const rot = b.w >= b.d ? 0 : Math.PI / 2; // 長辺を x に向けて作ってから回す
    const t = this._tile('container');
    this._push(mat, World.boxGeo(L, H, W, t.u, t.v), b.x, H / 2, b.z, rot);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) this._push('metalDark', new THREE.BoxGeometry(0.18, H + 0.04, 0.18), b.x, H / 2, b.z, rot, false, sx * (L / 2 - 0.06), sz * (W / 2 - 0.06));
    }
    const ribs = Math.floor(L / 0.45);
    for (let i = 1; i < ribs; i++) {
      const lx = -L / 2 + i * (L / ribs);
      for (const sz of [-1, 1]) this._push(mat, new THREE.BoxGeometry(0.12, H - 0.5, 0.08), b.x, H / 2, b.z, rot, false, lx, sz * (W / 2 + 0.02));
    }
    this._push('metalDark', new THREE.BoxGeometry(L + 0.1, 0.1, W + 0.1), b.x, H + 0.02, b.z, rot);
  }

  _barrier(b) {
    // ジャージーバリア: 台形断面を押し出す
    const L = Math.max(b.w, b.d);
    const rot = b.w >= b.d ? 0 : Math.PI / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0); shape.lineTo(0.32, 0); shape.lineTo(0.32, 0.2); shape.lineTo(0.12, 0.55);
    shape.lineTo(0.1, b.h); shape.lineTo(-0.1, b.h); shape.lineTo(-0.12, 0.55); shape.lineTo(-0.32, 0.2); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.translate(-L / 2, 0, 0);
    geo.computeVertexNormals();
    World.scaleUV(geo, 0.6);
    this._push('concrete', geo, b.x, 0, b.z, rot);
  }

  _sandbag(b) {
    const L = Math.max(b.w, b.d);
    const rot = b.w >= b.d ? 0 : Math.PI / 2;
    const bagGeo = new THREE.SphereGeometry(0.3, 8, 6);
    bagGeo.scale(1.45, 0.62, 1.0);
    const perRow = Math.floor(L / 0.85);
    for (let layer = 0; layer < 3; layer++) {
      const y = 0.17 + layer * 0.3;
      for (const sz of [-0.22, 0.22]) {
        for (let i = 0; i < perRow; i++) {
          const lx = -L / 2 + 0.45 + i * 0.85 + (layer % 2) * 0.4;
          if (lx > L / 2 - 0.3) continue;
          this._push('sandbag', bagGeo.clone(), b.x, y, b.z, rot, false, lx, sz);
        }
      }
    }
  }

  _crate(b) {
    const n = b.tall ? 2 : 1;
    const s = 1.2, e = 0.1;
    const t = this._tile('crate');
    for (let i = 0; i < n; i++) {
      const y = 0.625 + i * 1.25, rot = i * 0.35;
      this._push('crate', World.boxGeo(s, s, s, t.u, t.v), b.x, y, b.z, rot);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) this._push('crateFrame', new THREE.BoxGeometry(s + 0.04, e, e), b.x, y + sy * s / 2, b.z, rot, false, 0, sx * s / 2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._push('crateFrame', new THREE.BoxGeometry(e, s + 0.04, e), b.x, y, b.z, rot, false, sx * s / 2, sz * s / 2);
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) this._push('crateFrame', new THREE.BoxGeometry(e, e, s + 0.04), b.x, y + sy * s / 2, b.z, rot, false, sz * s / 2, 0);
    }
  }

  _barrel(b) {
    const mat = 'barrel' + (b.color || 0);
    const r = 0.36, h = b.h;
    const body = new THREE.CylinderGeometry(r, r, h, 14);
    // ファイルテクスチャ（1 m タイル）のときは円周・高さを実寸にする。Canvas 版は今までどおり 1 周 = 1 枚
    const t = this._tile('barrel');
    if (t.u) World.scaleUV2(body, 2 * Math.PI * r / t.u, h / (t.v || t.u));
    this._push(mat, body, b.x, h / 2, b.z);
    for (const y of [0.25, 0.7]) this._push('metalDark', new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.05, 14), b.x, y, b.z);
    this._push('hazard', new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.16, 14, 1, true), b.x, h * 0.5, b.z);
  }

  _lamp(b) {
    const h = 5.2, rot = b.rot || 0;
    const post = new THREE.CylinderGeometry(0.07, 0.1, h, 8);
    const t = this._tile('metalDark');
    if (t.v && this.materials.usesFile && this.materials.usesFile('metalDark')) World.scaleUV2(post, 1, h / t.v);
    this._push('metalDark', post, b.x, h / 2, b.z);
    this._push('metalDark', new THREE.BoxGeometry(0.1, 0.1, 1.4), b.x, h - 0.1, b.z, rot, false, 0, 0.6);
    this._push('metalDark', new THREE.BoxGeometry(0.5, 0.14, 0.8), b.x, h - 0.1, b.z, rot, false, 0, 1.3);
    this._push('lampGlow', new THREE.BoxGeometry(0.4, 0.04, 0.6), b.x, h - 0.19, b.z, rot, false, 0, 1.3);
  }

  // ---------- props.glb ----------

  _resolvePropsKey() {
    if (this.cfg.props === false) return null;
    const a = this.assets;
    if (!a || typeof a.resolve !== 'function' || typeof a.loadModel !== 'function') return null;
    if (!THREE.GLTFLoader) return null;
    try { return a.resolve(World.PROPS_FILE) || null; } catch (e) { return null; }
  }

  // GLB を読んで置き換える。失敗してもプリミティブのまま（reject しない）
  _loadProps(key) {
    this.propsSource = 'loading';
    let p;
    try { p = Promise.resolve(this.assets.loadModel(key)); } catch (e) { p = Promise.reject(e); }
    return p.then((gltf) => {
      if (this.disposed) return false;
      const ok = this._applyProps(gltf);
      this.propsSource = ok ? 'files' : 'procedural';
      return ok;
    }, (e) => {
      console.warn('[World] props.glb を読めません。プリミティブのまま続けます:', e && e.message);
      this.propsSource = 'procedural';
      return false;
    });
  }

  // パース済み glTF（{ scene } か Object3D）からプロップを取り出して世界を組み替える。戻り値: 置き換えたか
  _applyProps(gltf) {
    const root = gltf && (gltf.scene || (gltf.isObject3D ? gltf : null));
    if (!root) return false;
    root.updateMatrixWorld(true);
    const props = {};
    for (const name of World.PROP_NODES) {
      const node = World.findNode(root, name);
      if (!node) continue;
      const prop = this._extractProp(node, name);
      if (prop && prop.parts.length) props[name] = prop;
    }
    if (!Object.keys(props).length) {
      console.warn('[World] props.glb にプロップのノードが見つかりません（crate / barrel / sandbag / barrier / lamp / container_door）');
      return false;
    }
    this.props = props;

    // 置き換える種類のプリミティブを外す
    for (const type of Object.keys(World.REPLACEABLE)) if (props[type]) this._removeCategory(type);

    // 同じ配置でプロップを積む
    for (const b of this.nav.boxes) {
      this._category = props[b.type] ? b.type : (b.type === 'container' && props.container_door ? 'container_door' : null);
      switch (b.type) {
        case 'crate': if (props.crate) this._crateProp(b); break;
        case 'barrel': if (props.barrel) this._barrelProp(b); break;
        case 'sandbag': if (props.sandbag) this._sandbagProp(b); break;
        case 'barrier': if (props.barrier) this._barrierProp(b); break;
        case 'lamp': if (props.lamp) this._lampProp(b); break;
        case 'container': if (props.container_door) this._containerDoors(b); break;
        default: break;
      }
    }
    this._category = null;
    this._flush();
    return true;
  }

  // ノード以下のメッシュを「ノード原点基準・y=0 が地面」のジオメトリにまとめる。マテリアルは materials に登録
  // （階層の回転・スケールはそのまま焼き込み、ノードのワールド位置だけを原点に引く = glTF で見える形のまま）
  _extractProp(node, name) {
    const wp = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    const inv = new THREE.Matrix4().makeTranslation(-wp.x, -wp.y, -wp.z);
    const parts = [];
    const bbox = new THREE.Box3();
    const keepAttr = { position: 1, normal: 1, uv: 1, uv2: 1, color: 1, tangent: 1 };
    let matIndex = 0;
    node.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const pieces = World.splitByGroups(o.geometry, mats.length);
      for (const piece of pieces) {
        const geo = piece.geometry;
        geo.applyMatrix4(local);
        for (const a of Object.keys(geo.attributes)) if (!keepAttr[a]) geo.deleteAttribute(a);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.computeBoundingBox();
        bbox.union(geo.boundingBox);
        const mat = mats[Math.min(piece.materialIndex, mats.length - 1)];
        const matKey = this._registerPropMaterial(mat, name, matIndex++);
        parts.push({ geo, matKey });
      }
    });
    if (!parts.length) return null;
    // 高さが想定とずれていたら合わせる。足元を y=0 に
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const expected = World.PROP_HEIGHT[name];
    let s = 1;
    if (expected && size.y > 1e-6) {
      const ratio = expected / size.y;
      if (Math.abs(ratio - 1) > 0.15) s = ratio;
    }
    if (s !== 1 || Math.abs(bbox.min.y) > 1e-3) {
      const m = new THREE.Matrix4().makeScale(s, s, s).premultiply(new THREE.Matrix4().makeTranslation(0, -bbox.min.y * s, 0));
      for (const p of parts) { p.geo.applyMatrix4(m); p.geo.computeBoundingBox(); }
      bbox.makeEmpty();
      for (const p of parts) bbox.union(p.geo.boundingBox);
    }
    return { parts, bbox };
  }

  // プロップのマテリアルを 'prop:<node>'（2 つ目以降は 'prop:<node>:<材質名|番号>'）で登録。発光材 lampGlow は今までの lampGlow に
  _registerPropMaterial(mat, nodeName, index) {
    if (!mat) return 'prop:' + nodeName;
    if (mat.name === 'lampGlow' || /glow/i.test(mat.name || '')) return 'lampGlow';
    if (this._propMatKeys[mat.uuid]) return this._propMatKeys[mat.uuid];
    let key = 'prop:' + nodeName;
    if (index > 0 || (this.materials.has(key) && this.materials.get(key) !== mat)) key += ':' + (mat.name || index);
    while (this.materials.has(key) && this.materials.get(key) !== mat) key += '_';
    this.materials.register(key, mat);
    this._propMatKeys[mat.uuid] = key;
    return key;
  }

  // プロップを置く。tint があれば 'prop:' のマテリアルを '#tint' 付きで取る（色違いの clone）。preRot はプロップ自体の回転
  _pushProp(name, x, y, z, rotY, ox, oz, tint, preRot) {
    const prop = this.props && this.props[name];
    if (!prop) return;
    for (const part of prop.parts) {
      let key = part.matKey;
      if (tint !== undefined && tint !== null && key.indexOf('prop:') === 0) key += '#' + tint;
      const geo = part.geo.clone();
      if (preRot) geo.applyMatrix4(new THREE.Matrix4().makeRotationY(preRot));
      this._push(key, geo, x, y, z, rotY, false, ox, oz);
    }
  }

  _crateProp(b) {
    const n = b.tall ? 2 : 1;
    for (let i = 0; i < n; i++) this._pushProp('crate', b.x, i * 1.25, b.z, i * 0.35);
  }

  _barrelProp(b) {
    this._pushProp('barrel', b.x, 0, b.z, World.hashAngle(b.x, b.z), 0, 0, b.color || 0);
  }

  _sandbagProp(b) {
    const L = Math.max(b.w, b.d);
    const rot = b.w >= b.d ? 0 : Math.PI / 2;
    // 1 袋 1,228 三角形あるので、プロップ版は 1 列（袋の奥行き 0.6 m で箱の 0.9 m をほぼ覆う）× 3 段にする
    const perRow = Math.floor(L / 0.85);
    for (let layer = 0; layer < 3; layer++) {
      const y = layer * 0.3;
      for (let i = 0; i < perRow; i++) {
        const lx = -L / 2 + 0.45 + i * 0.85 + (layer % 2) * 0.4;
        if (lx > L / 2 - 0.3) continue;
        this._pushProp('sandbag', b.x, y, b.z, rot, lx, 0, null, ((i + layer) % 2) ? Math.PI : 0);
      }
    }
  }

  _barrierProp(b) {
    const rot = b.w >= b.d ? 0 : Math.PI / 2;
    this._pushProp('barrier', b.x, 0, b.z, rot);
  }

  _lampProp(b) {
    // プロップのアームはローカル +Z 向きで作られている前提（プリミティブ版と同じ）
    this._pushProp('lamp', b.x, 0, b.z, b.rot || 0);
  }

  // コンテナの両端に扉パネル。パネルはローカル +Z 向き・背面が z=bbox.min.z。両端の面にぴったり付ける
  _containerDoors(b) {
    const door = this.props.container_door;
    const L = Math.max(b.w, b.d);
    const rot = b.w >= b.d ? 0 : Math.PI / 2;
    const zmin = door.bbox.min.z;
    for (const sx of [-1, 1]) {
      this._pushProp('container_door', b.x, 0, b.z, rot, sx * (L / 2 + 0.005 - zmin), 0, b.color || 0, sx * Math.PI / 2);
    }
  }

  _removeCategory(type) {
    const list = this.categoryMeshes[type];
    if (!list) return;
    for (const m of list) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      const i = this.meshes.indexOf(m);
      if (i >= 0) this.meshes.splice(i, 1);
    }
    delete this.categoryMeshes[type];
  }

  // ---------- ジオメトリの結合 ----------

  // geo をワールド位置に移動して結合待ちリストへ。ox/oz は回転前のローカルオフセット
  _push(matName, geo, x, y, z, rotY, noShadow, ox, oz) {
    const m = new THREE.Matrix4();
    if (ox || oz) m.makeTranslation(ox || 0, 0, oz || 0);
    if (rotY) m.premultiply(new THREE.Matrix4().makeRotationY(rotY));
    m.premultiply(new THREE.Matrix4().makeTranslation(x, y, z));
    geo.applyMatrix4(m);
    const key = matName + (noShadow ? '#ns' : '') + (this._category ? '@' + this._category : '');
    (this.groups[key] = this.groups[key] || []).push(geo);
  }

  static parseKey(key) {
    let category = null, noShadow = false;
    let at = key.indexOf('@');
    if (at >= 0) { category = key.slice(at + 1); key = key.slice(0, at); }
    if (key.endsWith('#ns')) { noShadow = true; key = key.slice(0, -3); }
    return { mat: key, noShadow, category };
  }

  _flush() {
    const utils = THREE.BufferGeometryUtils;
    const merge = utils && utils.mergeBufferGeometries ? (list) => utils.mergeBufferGeometries(list, false) : null;
    for (const key of Object.keys(this.groups)) {
      const geos = this.groups[key];
      const info = World.parseKey(key);
      const mat = this._material(info.mat);
      if (!mat) {
        console.warn('[World] マテリアルがありません:', info.mat);
        for (const g of geos) g.dispose();
        continue;
      }
      // 属性を揃えてから結合。全部インデックス付きならそのまま、混在していれば非インデックスに
      // （ExtrudeGeometry は非インデックス）。残す属性は全ジオメトリが持っているものだけ
      const allIndexed = geos.every((g) => !!g.index);
      const list = allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
      const keep = World.commonAttributes(list);
      for (const g of list) {
        for (const name of Object.keys(g.attributes)) if (!keep[name]) g.deleteAttribute(name);
      }
      let geo = null;
      if (merge && list.length > 1) geo = merge(list);
      if (!geo) geo = list[0];
      World.ensureUv2(geo);
      const mesh = new THREE.Mesh(geo, mat);
      // 土のうは低くて数が多いので影を落とさない（シャドウパスの三角形を半減）
      mesh.castShadow = !info.noShadow && info.category !== 'sandbag';
      mesh.receiveShadow = !info.noShadow;
      mesh.name = key;
      this._addMesh(mesh);
      if (info.category) (this.categoryMeshes[info.category] = this.categoryMeshes[info.category] || []).push(mesh);
    }
    this.groups = {};
  }

  // 全ジオメトリに共通する属性（結合に使えるもの）
  static commonAttributes(list) {
    const allowed = ['position', 'normal', 'uv', 'uv2', 'color', 'tangent'];
    const keep = {};
    for (const name of allowed) {
      if (list.every((g) => !!g.attributes[name])) keep[name] = true;
    }
    return keep;
  }

  // マテリアルグループ（マルチマテリアル）ごとにジオメトリを分ける。インデックス付きのみ対応。戻り値 [{ geometry, materialIndex }]
  static splitByGroups(geometry, materialCount) {
    const groups = geometry.groups || [];
    if (materialCount <= 1 || groups.length <= 1 || !geometry.index) {
      const g = geometry.clone();
      g.clearGroups();
      return [{ geometry: g, materialIndex: 0 }];
    }
    const out = [];
    const idx = geometry.index.array;
    for (const grp of groups) {
      const g = geometry.clone();
      g.clearGroups();
      const count = grp.count === Infinity ? idx.length - grp.start : grp.count;
      g.setIndex(Array.prototype.slice.call(idx, grp.start, grp.start + count));
      out.push({ geometry: g, materialIndex: grp.materialIndex || 0 });
    }
    return out;
  }

  _material(name) {
    return this.materials.get(name);
  }

  _tile(name) {
    if (this.materials && typeof this.materials.tile === 'function') return this.materials.tile(name);
    return { u: 1, v: 1 };
  }

  _addMesh(mesh) {
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  // ---------- ヘルパ ----------

  // 面ごとに UV を実寸（m）に合わせた BoxGeometry。tileU/tileV = テクスチャ 1 枚の実寸（0 = 面に 1 枚）
  static boxGeo(w, h, d, tileU, tileV) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // px nx py ny pz nz
    for (let f = 0; f < 6; f++) {
      const du = dims[f][0], dv = dims[f][1];
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, tileU ? uv.getX(k) * du / tileU : uv.getX(k), tileV ? uv.getY(k) * dv / tileV : uv.getY(k));
      }
    }
    return g;
  }

  static scaleUV(geo, s) {
    World.scaleUV2(geo, s, s);
  }

  // aoMap 用の uv2（無ければ uv の属性をそのまま共有する。GPU バッファも 1 つで済む）
  static ensureUv2(geo) {
    if (geo && geo.attributes.uv && !geo.attributes.uv2) geo.setAttribute('uv2', geo.attributes.uv);
    return geo;
  }

  static scaleUV2(geo, su, sv) {
    const uv = geo.attributes.uv;
    if (!uv) return;
    if (su === 1 && sv === 1) return;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
  }

  // 名前でノードを探す（大文字小文字は無視。'Crate' / 'crate.001' も拾う）
  static findNode(root, name) {
    let exact = root.getObjectByName(name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    let loose = null;
    root.traverse((o) => {
      if (exact || !o.name) return;
      const n = o.name.toLowerCase();
      if (n === lower) exact = o;
      else if (!loose && (n.indexOf(lower + '.') === 0 || n.indexOf(lower + '_') === 0 || n === lower + 'mesh')) loose = o;
    });
    return exact || loose;
  }

  // 位置から決まる回転（同じマップなら同じ向き）
  static hashAngle(x, z) {
    const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return (v - Math.floor(v)) * Math.PI * 2;
  }

  dispose() {
    this.disposed = true;
    for (const m of this.meshes) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    this.meshes = [];
    this.categoryMeshes = {};
  }
};

// =====================================================================================================================
// 街（level に chunkSize があるレベル = levels/midtown.json）。
//   形のデータは citygen.js（MR.CityGen）、当たり判定は nav3d.js（MR.Nav3D）、どのチャンクをいつ作る・捨てるかは streamer.js
//   （MR.Streamer）。ここは「チャンクのデータ → メッシュ」と、全体に 1 つずつのもの（地面・水・小物のインスタンス・ランドマークの GLB）。
//
//   近景（full）: chunkFull の箱・スロープ（階段は段）・梯子・デカール（車線・横断歩道・マンホール・補修跡・線路・ヘリパッド・看板）を
//     材質ごとに 1 メッシュへ直接書く（BoxGeometry は作らない）。室内（間仕切り・室内の階段）は近いときだけ表示（interiorDist）。
//     影は chunkLod の外形の箱（影だけを落とす透明なメッシュ）が落とす（細かい形で影を描くと影のパスが重いので）。
//   遠景（LOD / スカイライン）: 512 m 四方（superChunk）ごとに 1 メッシュ。共有の頂点カラーのマテリアル（farMaterial）が UV なしで
//     窓の格子（灯りの付いた窓は発光）を描く。近景が出来上がったチャンクの分は頂点シェーダーで消す（uHide）。
//   地面: 陸（湖の穴付き、アスファルト）・護岸・湖（水面 + 岸の壁）・セントラルパークの芝・公園・小道・広場は全体で 1 回作る。
//   小物（city_props.glb / props.glb の crate）: 近景のチャンクの小物を種類ごとの InstancedMesh で（propDist 以内）。木はその外側を
//     低ポリの塊で。GLB が無ければコードで作った簡単な形。
//   ランドマーク（landmarks.glb / landmarks2.glb）: landmarkPlacements() の位置に clone。読めたノードの代わりの箱（citygen の lm 付き）は消す。
window.MR = window.MR || {};

// 1 つのマテリアル分の頂点を貯める（必要に応じて倍に広げる）。toGeometry() でちょうどの長さの BufferGeometry にする。
//   opts: { uv: true（テクスチャ用）, col: false（頂点カラー Uint8）, info: false（遠景の aInfo Uint8 × 4）}
MR.CityGeo = class CityGeo {
  constructor(opts) {
    opts = opts || {};
    this.hasUv = opts.uv !== false;
    this.hasCol = !!opts.col;
    this.hasInfo = !!opts.info;
    this.vcap = opts.vcap || 512;
    this.icap = this.vcap * 2;
    this.pos = new Float32Array(this.vcap * 3);
    this.nrm = new Int8Array(this.vcap * 3);
    if (this.hasUv) this.uv = new Float32Array(this.vcap * 2);
    if (this.hasCol) this.col = new Uint8Array(this.vcap * 3);
    if (this.hasInfo) this.inf = new Uint8Array(this.vcap * 4);
    this.idx = new Uint32Array(this.icap);
    this.nv = 0; this.ni = 0;
    this.r = 255; this.g = 255; this.b = 255;           // 今の頂点カラー
    this.i0 = 255; this.i1 = 255; this.i2 = 0; this.i3 = 0; // 今の aInfo（チャンク cx, cz、スタイル、乱数）
  }
  reserve(nv, ni) {
    if (this.nv + nv > this.vcap) {
      let c = this.vcap * 2;
      while (this.nv + nv > c) c *= 2;
      const grow = (a, k) => { const b = new a.constructor(c * k); b.set(a.subarray(0, this.nv * k)); return b; };
      this.pos = grow(this.pos, 3); this.nrm = grow(this.nrm, 3);
      if (this.hasUv) this.uv = grow(this.uv, 2);
      if (this.hasCol) this.col = grow(this.col, 3);
      if (this.hasInfo) this.inf = grow(this.inf, 4);
      this.vcap = c;
    }
    if (this.ni + ni > this.icap) {
      let c = this.icap * 2;
      while (this.ni + ni > c) c *= 2;
      const b = new Uint32Array(c); b.set(this.idx.subarray(0, this.ni)); this.idx = b; this.icap = c;
    }
  }
  color(hexOrLinear) { // THREE.Color（リニア）か [r, g, b] 0..1
    const c = hexOrLinear;
    if (Array.isArray(c)) { this.r = Math.round(c[0] * 255); this.g = Math.round(c[1] * 255); this.b = Math.round(c[2] * 255); }
    else { this.r = Math.round(Math.min(1, c.r) * 255); this.g = Math.round(Math.min(1, c.g) * 255); this.b = Math.round(Math.min(1, c.b) * 255); }
  }
  // 頂点 1 つ（法線は -1..1）
  v(x, y, z, nx, ny, nz, u, w) {
    const k = this.nv++;
    const p = k * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.nrm[p] = Math.round(nx * 127); this.nrm[p + 1] = Math.round(ny * 127); this.nrm[p + 2] = Math.round(nz * 127);
    if (this.hasUv) { this.uv[k * 2] = u; this.uv[k * 2 + 1] = w; }
    if (this.hasCol) { this.col[p] = this.r; this.col[p + 1] = this.g; this.col[p + 2] = this.b; }
    if (this.hasInfo) { const q = k * 4; this.inf[q] = this.i0; this.inf[q + 1] = this.i1; this.inf[q + 2] = this.i2; this.inf[q + 3] = this.i3; }
    return k;
  }
  quad(a, b, c, d) { const i = this.ni; this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; this.idx[i + 3] = a; this.idx[i + 4] = c; this.idx[i + 5] = d; this.ni += 6; }
  tri(a, b, c) { const i = this.ni; this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; this.ni += 3; }
  get empty() { return this.ni === 0; }

  // 軸平行の箱の面 f（0 +X, 1 −X, 2 +Z, 3 −Z, 4 +Y, 5 −Y）。側面の U は面の右向きの世界座標 / tu、V = (y − vb) / tv。
  // 上面 U = x / tu, V = −z / tv、下面 U = x, V = z
  face(f, x0, y0, z0, x1, y1, z1, tu, tv, vb) {
    this.reserve(4, 6);
    const iu = tu ? 1 / tu : 1, iv = tv ? 1 / tv : 1;
    let a, b, c, d;
    switch (f) {
      case 0: a = this.v(x1, y0, z1, 1, 0, 0, -z1 * iu, (y0 - vb) * iv); b = this.v(x1, y0, z0, 1, 0, 0, -z0 * iu, (y0 - vb) * iv); c = this.v(x1, y1, z0, 1, 0, 0, -z0 * iu, (y1 - vb) * iv); d = this.v(x1, y1, z1, 1, 0, 0, -z1 * iu, (y1 - vb) * iv); break;
      case 1: a = this.v(x0, y0, z0, -1, 0, 0, z0 * iu, (y0 - vb) * iv); b = this.v(x0, y0, z1, -1, 0, 0, z1 * iu, (y0 - vb) * iv); c = this.v(x0, y1, z1, -1, 0, 0, z1 * iu, (y1 - vb) * iv); d = this.v(x0, y1, z0, -1, 0, 0, z0 * iu, (y1 - vb) * iv); break;
      case 2: a = this.v(x0, y0, z1, 0, 0, 1, x0 * iu, (y0 - vb) * iv); b = this.v(x1, y0, z1, 0, 0, 1, x1 * iu, (y0 - vb) * iv); c = this.v(x1, y1, z1, 0, 0, 1, x1 * iu, (y1 - vb) * iv); d = this.v(x0, y1, z1, 0, 0, 1, x0 * iu, (y1 - vb) * iv); break;
      case 3: a = this.v(x1, y0, z0, 0, 0, -1, -x1 * iu, (y0 - vb) * iv); b = this.v(x0, y0, z0, 0, 0, -1, -x0 * iu, (y0 - vb) * iv); c = this.v(x0, y1, z0, 0, 0, -1, -x0 * iu, (y1 - vb) * iv); d = this.v(x1, y1, z0, 0, 0, -1, -x1 * iu, (y1 - vb) * iv); break;
      case 4: a = this.v(x0, y1, z1, 0, 1, 0, x0 * iu, -z1 * iv); b = this.v(x1, y1, z1, 0, 1, 0, x1 * iu, -z1 * iv); c = this.v(x1, y1, z0, 0, 1, 0, x1 * iu, -z0 * iv); d = this.v(x0, y1, z0, 0, 1, 0, x0 * iu, -z0 * iv); break;
      default: a = this.v(x0, y0, z0, 0, -1, 0, x0 * iu, z0 * iv); b = this.v(x1, y0, z0, 0, -1, 0, x1 * iu, z0 * iv); c = this.v(x1, y0, z1, 0, -1, 0, x1 * iu, z1 * iv); d = this.v(x0, y0, z1, 0, -1, 0, x0 * iu, z1 * iv); break;
    }
    this.quad(a, b, c, d);
  }
  // 水平な四角形（上向き）。pts = 4 点 [x, z]（どの回り順でもよい）、UV = 世界 xz / tu
  flat(pts, y, tu, tv) {
    this.reserve(4, 6);
    const iu = tu ? 1 / tu : 1, iv = tv ? 1 / tv : 1;
    const k = [];
    for (const p of pts) k.push(this.v(p[0], y, p[1], 0, 1, 0, p[0] * iu, -p[1] * iv));
    // 上から見て反時計回りになるように（xz の符号付き面積。three の上向きは x 右・z 手前なので面積 < 0 が反時計回り）
    let area = 0;
    for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) this.quad(k[0], k[1], k[2], k[3]); else this.quad(k[0], k[3], k[2], k[1]);
  }
  // 中心 (x, z)・幅 w（ローカル x）・奥行き d（ローカル z）・回転 rot（rotation.y と同じ）の平らな四角形
  rectRot(x, z, w, d, rot, y, tu, tv) {
    const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
    const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    this.flat([P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)], y, tu, tv);
  }
  // ちょうどの長さの BufferGeometry（uv2 = uv の共有）
  toGeometry() {
    const g = new THREE.BufferGeometry();
    const n = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3, true));
    if (this.hasUv) { const uv = new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2); g.setAttribute('uv', uv); g.setAttribute('uv2', uv); }
    if (this.hasCol) g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3, true));
    if (this.hasInfo) g.setAttribute('aInfo', new THREE.BufferAttribute(this.inf.slice(0, n * 4), 4, false));
    const idx = n < 65536 ? new Uint16Array(this.ni) : new Uint32Array(this.ni);
    for (let i = 0; i < this.ni; i++) idx[i] = this.idx[i];
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
};

MR.CityWorld = class CityWorld {
  // render.city の既定値（game.json に無いキーはこれ）。距離は m。
  static get DEFAULTS() {
    return {
      fullIn: 100, fullOut: 124,       // 近景（chunkFull）にするチャンク: カメラからチャンクの箱（0..その中身の高さ）までの距離
      lodIn: 640, lodOut: 760,         // 遠景を chunkLod（+ 木）で作る 512 m 区画。外はスカイライン（skyline()、起動時に 1 回）
      interiorDist: 45,                // 室内（間仕切り・室内の階段）を出すチャンクまでの距離
      propDist: 80, treeDist: 70,      // 小物を出す距離 / 木を GLB で出す距離（その外の近景のチャンクの木は低ポリの塊）
      propEmissive: 2.0,               // 小物（街灯・信号・売店）の発光の強さ
      windowEmissive: 1.4,             // 外壁テクスチャの窓の発光
      farWindowGlow: 1.25, farWindowLit: 1.0, // 遠景のシェーダーの窓の発光・灯りの割合（1 = 既定の割合）
      buildMsPerFrame: 4,              // 1 フレームで組み立てに使う時間（実測で調整する）
      buildFill: true,                 // 予算の中は歩を続ける（次の歩の長さの予測で止めるのは chunkFull の生成だけ。false = 以前の予測）
      detailBoost: 1.5, lodBoost: 1.5, boostNear: 40, boostNearLod: 100, // 見えている所に出来ていない近景のチャンク / LOD の区画があるフレームだけ、予算をこの倍に（streamer._run）
      buildStepMs: 2,                  // 組み立ての 1 歩（yield の間）の目安 ms（buildFull / buildLod）
      stepBoxes: 64, stepBoxCheck: 8,  // buildFull: 箱は stepBoxes 個ごとに yield、stepBoxCheck 個ごとに時間を見る（buildStepMs を超えていれば yield）
      stepRamps: 16, stepItems: 8,     //   斜路は stepRamps 個、梯子・デカールは stepItems 個ごと（どれも時間を見る）
      decorYield: 0.5,                 // buildLod: 木・岩・看板のデータの生成の前に、この歩がもう buildStepMs × decorYield を使っていれば先に yield
      lodShare: 0,                     // 組み立て時間のうち先に LOD（512 m 区画）に使える割合（0 = 近景の後だけ。フレームをまたいだ貯金で、
      lodShareAfter: 2,                //   1 フレームに 1 歩しか入らない遅い端末でも平均でこの割合）。lodShareAfter フレームより長く待っている区画があるときだけ
      lodShareCap: 2,                  //   貯金の上限（budget × lodShare の何フレーム分）
      lodShareAbove: null,             //   m。あればカメラがこの高さより上のときだけ（null = いつも）
      maxFullPerFrame: 2,              // 1 フレームに進める近景のチャンクの数（1 つ目が途中で出来たら 2 つ目へ）
      cacheChunks: 40,                 // 生成済みのチャンクデータを覚えておく数
      navRadius: 1,                    // 当たり判定に読むチャンク（プレイヤーの周り）
      navOpsWalk: 2,                   // 歩き・車: 1/60 秒あたりの当たり判定の仕事（チャンクの生成 1 つ / 追加 1 つ）の数。0 = 全部すぐ（以前）
      navMsWalk: 4,                    // 歩き・車: 1 フレームの当たり判定の読み込みの上限 ms（少なくとも 1 つ。立っているチャンクはいつも全部）
      prefetchRadius: 2,               // 先にデータだけ作っておく範囲
      warmMaterials: true,             // 近景のマテリアルを起動時に作っておく（組み立ての途中で Canvas のテクスチャを作らない）
      shadowCasters: true,             // 近景のチャンクの外形で影を落とす
      landmarks: true, props: true, water: true, billboards: true,
      // 高さ（カメラの y）ごとの霧と描画距離。間は補間
      altitude: [
        { y: 0, near: 0.15, far: 2200, fogNear: 250, fogFar: 1300 },
        { y: 60, near: 0.3, far: 2800, fogNear: 350, fogFar: 1900 },
        { y: 160, near: 0.6, far: 4000, fogNear: 500, fogFar: 3000 },
        { y: 600, near: 2.0, far: 7500, fogNear: 1000, fogFar: 7000 }
      ],
      shadowRadius: 60, shadowDistance: 500, shadowFar: 1100, shadowNormalBias: 0.12, // 影の外形（光の側の面）と同じ高さの外壁・屋上に影が乗らないように
      hemiIntensity: 1.0, landSpecular: 0.2,
      textureMax: null                 // テクスチャの最大辺 { albedo, normal, orm, emissive, interior, glb, glbDetail }（GPU メモリを抑える。
                                       // PC は法線・ORM・発光だけ、タッチ端末はアルベドも）
    };
  }

  static config(rs) {
    const base = Object.assign({}, CityWorld.DEFAULTS, (rs && rs.city) || {});
    const touch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || (typeof window !== 'undefined' && 'ontouchstart' in window);
    if (touch && rs && rs.city && rs.city.mobile) Object.assign(base, rs.city.mobile);
    return base;
  }

  // scene, level（midtown.json）, rs（render 設定。rs.city を読む）
  // opts: { materials, assets, renderer, city（無ければ作る）, cache（MR.CityChunkCache。無ければ作る）}
  constructor(scene, level, rs, opts) {
    opts = opts || {};
    this.scene = scene;
    this.level = level;
    this.rs = rs || {};
    this.cfg = CityWorld.config(this.rs);
    this.assets = opts.assets || null;
    this.renderer = opts.renderer || null;
    this.disposed = false;
    const t0 = CityWorld.now();
    this.city = opts.city || new MR.CityGen(level);
    this.timings = { cityGen: CityWorld.now() - t0 };
    this.cache = opts.cache || new MR.CityChunkCache(this.city, { cap: this.cfg.cacheChunks });
    this.materials = opts.materials || MR.World.createMaterials(this.assets, this.renderer, this.rs, level);
    if (this.materials && typeof this.cfg.windowEmissive === 'number') this.materials.windowEmissive = this.cfg.windowEmissive;
    this.nav = MR.Nav3D.fromCity(this.city);
    this.root = new THREE.Group();
    this.root.name = 'city';
    scene.add(this.root);
    this.meshes = [];          // 全体に 1 つの静的なメッシュ（地面・護岸・湖）
    this.propsSource = 'procedural';
    this.landmarkSource = 'procedural';
    this.lmLoaded = {};        // GLB で表示しているランドマークのノード名 → true（代わりの箱を消す）
    this.stats = { geoCreated: 0, geoDisposed: 0, live: 0 };
    this._liveGeos = new Set();
    this._farStyles = CityWorld.farStyles();
    this.farMaterial = CityWorld.makeFarMaterial(this.cfg);
    this.casterMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.casterMaterial.name = 'cityShadowCaster';
    this.casterMaterial.shadowSide = THREE.FrontSide; // 影は光に向いた面で（箱の中が日なたにならない。buildFull の caster を参照）
    const t1 = CityWorld.now();
    this._buildStatic();
    this.timings.static = CityWorld.now() - t1;
    if (this.cfg.warmMaterials !== false) this.timings.materials = this.warmMaterials();
    this.water = (this.cfg.water !== false && MR.Water) ? new MR.Water(scene, { city: this.city, assets: this.assets, useFiles: this.rs.textures !== false }) : null;
    this.props = new MR.CityProps(this);
    this.landmarks = new MR.CityLandmarks(this);
    this.streamer = new MR.Streamer(this, this.cfg);
    this.propsReady = Promise.all([this.props.ready, this.landmarks.ready]).then(() => true, () => false);
  }

  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // ---------- 形の数の記録（メモリが増え続けないかの確認用）----------
  _track(geo) { if (!geo || this._liveGeos.has(geo)) return geo; this._liveGeos.add(geo); this.stats.geoCreated++; this.stats.live = this._liveGeos.size; return geo; }
  _release(geo) { if (!geo) return; geo.dispose(); if (this._liveGeos.delete(geo)) { this.stats.geoDisposed++; this.stats.live = this._liveGeos.size; } }

  mat(name) { return this.materials.get(name); }

  // 近景・遠景が使うマテリアルを前もって作る。Canvas のテクスチャ（ファイルが無いとき・ファイルの無い色だけの街の材質）は 1 つ
  //   10〜100 ms（遅い端末はその数倍）かかり、組み立ての途中で初めて使うとその 1 歩がそのまま長くなっていた（full:finish 100〜250 ms）。
  //   起動時に作るのは軽いもの（画像のあるもの・単色。戻り値 ms）だけ。Canvas のものは _warmQueue に入れ、手の空いたフレームに streamer が
  //   warmStep で少しずつ作る（MR.Materials.prepare）。それより先に組み立てが要れば buildFull / buildLod がその場で少しずつ作る（'mat' の歩）。
  //   以前は全部を起動時に作っていて、画像の無い起動（preview.html・ダウンロードの失敗・render.textures: false）が 0.7〜0.85 s 長かった
  warmMaterials() {
    const M = this.materials, D = MR.Materials && MR.Materials.DEFS;
    this._warmQueue = [];
    if (!M || typeof M.get !== 'function' || !D) return 0;
    const t0 = CityWorld.now();
    for (const n of Object.keys(D).filter((k) => D[k].city).concat(CityWorld.WARM_EXTRA)) {
      if (typeof M.needsCanvas === 'function' && M.needsCanvas(n)) this._warmQueue.push(n);
      else this.mat(n);
    }
    this.timings.warmQueued = this._warmQueue.length;
    return CityWorld.now() - t0;
  }
  // 手の空いたフレーム（streamer の予算の残り）: _warmQueue の Canvas のテクスチャを deadline（CityWorld.now() の値）まで少しずつ作る。
  //   1 回の next() は 0.2〜1 ms 前後。残りがあれば true
  warmStep(deadline) {
    const q = this._warmQueue, M = this.materials, now = CityWorld.now;
    while (q && q.length) {
      if (now() >= deadline) return true;
      const it = typeof M.prepare === 'function' ? M.prepare(q[0]) : null;
      if (it) {
        let done = false;
        while (!(done = it.next().done) && now() < deadline) { /* 少しずつ */ }
        if (!done) return true;
      }
      this.mat(q.shift()); // テクスチャはもう出来ている（軽い）
    }
    return false;
  }
  // 組み立ての途中で要るマテリアルの Canvas のテクスチャを slice ms ごとに yield しながら作る（buildFull / buildLod が yield* する）
  *_prepareMat(name, slice) {
    const M = this.materials;
    const it = M && typeof M.prepare === 'function' ? M.prepare(name) : null;
    if (!it) return;
    const now = CityWorld.now;
    let ts = now();
    for (;;) {
      if (now() - ts > slice) { yield 'mat'; ts = now(); }
      if (it.next().done) return;
    }
  }
  // citygen の箱が使う街以外の定義（arena と共通の材質）
  static get WARM_EXTRA() { return ['concrete', 'container', 'container2', 'crate', 'barrel', 'metalDark']; }
  tile(name) { return this.materials.tile(name); }

  // ---------- 全体に 1 つの地面（陸・護岸・湖・公園の芝・小道・広場）----------
  _buildStatic() {
    const city = this.city, mini = city.minimap();
    const bnd = mini.bounds;
    const geos = {};
    const G = (name) => geos[name] || (geos[name] = new MR.CityGeo({ vcap: 4096 }));
    const shapeOf = (poly, holes) => {
      const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1])));
      for (const h of holes || []) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], -p[1]))));
      return s;
    };
    // 形（ShapeGeometry、xy 平面）を y の高さの水平な面として書く
    const writeShape = (g, shape, y, tu, tv) => {
      const sg = new THREE.ShapeGeometry(shape, 1);
      const pos = sg.attributes.position, idx = sg.index;
      g.reserve(pos.count, idx ? idx.count : pos.count);
      const base = g.nv;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = -pos.getY(i); g.v(x, y, z, 0, 1, 0, x / tu, -z / tv); }
      // ShapeGeometry は +Z から見て反時計回り。(X, Y) → (x, −z) なので上から見ても反時計回り（表）のまま
      if (idx) for (let i = 0; i < idx.count; i += 3) g.tri(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
      else for (let i = 0; i < pos.count; i += 3) g.tri(base + i, base + i + 1, base + i + 2);
      sg.dispose();
    };
    // 境界にぴったりの頂点は少し外へ（境界に接する湖の穴を三角形分割で扱えるように）
    const pushOut = (poly) => poly.map((p) => [p[0] <= bnd.minX + 0.01 ? bnd.minX - 2 : p[0] >= bnd.maxX - 0.01 ? bnd.maxX + 2 : p[0], p[1] <= bnd.minZ + 0.01 ? bnd.minZ - 2 : p[1] >= bnd.maxZ - 0.01 ? bnd.maxZ + 2 : p[1]]);
    const pointIn = (x, z, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
    const lakes = city.lakes || [];
    const at = this.tile('asphalt_city'), ct = this.tile('concrete');
    // 陸（アスファルト。湖は穴）と護岸（陸の縁から −8 m まで、外向き）
    for (const land of mini.land) {
      const poly = pushOut(land.poly);
      const holes = lakes.filter((l) => pointIn((l.bb[0] + l.bb[2]) / 2, (l.bb[1] + l.bb[3]) / 2, land.poly)).map((l) => l.poly);
      writeShape(G('land'), shapeOf(poly, holes), 0, at.u, at.v);
      const P = land.poly, n = P.length;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
        if (L < 0.5) continue;
        // 縁が地図の端（境界）なら壁は要らない
        if ((Math.abs(a[0] - b[0]) < 0.01 && (Math.abs(a[0] - bnd.minX) < 0.01 || Math.abs(a[0] - bnd.maxX) < 0.01)) || (Math.abs(a[1] - b[1]) < 0.01 && (Math.abs(a[1] - bnd.minZ) < 0.01 || Math.abs(a[1] - bnd.maxZ) < 0.01))) continue;
        let nx = dz / L, nz = -dx / L;
        if (pointIn((a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + nz * 0.5, P)) { nx = -nx; nz = -nz; }
        CityWorld.wall(G('seawall'), a, b, 0, -8, nx, nz, ct.u, ct.v);
      }
    }
    // 湖: 水面（water.js のマテリアル）と岸の壁
    const rt = this.tile('rock');
    for (const l of lakes) {
      const P = l.poly, n = P.length;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
        if (L < 0.5) continue;
        let nx = dz / L, nz = -dx / L;
        if (!pointIn((a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + nz * 0.5, P)) { nx = -nx; nz = -nz; } // 湖の内側を向く
        CityWorld.wall(G('lakewall'), a, b, 0, (l.bed || -3), nx, nz, rt.u || 2, rt.v || 2);
      }
    }
    // セントラルパークの芝（湖は穴）。小道・園内の車道・広場は上に重ねる
    const gt = this.tile('grass');
    for (const p of city.plan.parks || []) {
      if (p.kind !== 'central') continue;
      const sw = city.sidewalk, r = p.rect;
      const z0 = r[1] <= bnd.minZ + 1 ? bnd.minZ - 1 : r[1] + sw;
      const outer = [[r[0] + sw, z0], [r[2] - sw, z0], [r[2] - sw, r[3] - sw], [r[0] + sw, r[3] - sw]];
      const holes = lakes.filter((l) => l.bb[0] > r[0] && l.bb[2] < r[2]).map((l) => l.poly);
      writeShape(G('grass'), shapeOf(outer, holes), 0.02, gt.u, gt.v);
    }
    // 静的な地面（公園の芝・歩道・小道・操車場の砂利）。セントラルパークの芝の上に重なるので少し上
    for (const g of city.staticItems.ground) {
      const t = this.tile(g.mat);
      G(g.mat).flat([[g.x0, g.z0], [g.x1, g.z0], [g.x1, g.z1], [g.x0, g.z1]], g.mat === 'grass' ? 0.03 : 0.045, t.u, t.v);
    }
    // 園内の車道（静的な道路）と歩行者天国（ブロードウェイの広場の四角形）
    for (const rd of city.staticItems.roads) {
      if (rd.kind !== 'park_drive') continue;
      G('asphalt_city').flat(rd.pts, 0.04, at.u, at.v);
    }
    const st = this.tile('sidewalk');
    for (const rd of city.roads || []) if (rd.kind === 'plaza' && rd.pts) G('sidewalk').flat(rd.pts, 0.012, st.u, st.v);
    // メッシュ
    for (const name of Object.keys(geos)) {
      const g = geos[name];
      if (g.empty) continue;
      let mat;
      if (name === 'land') mat = this._landMaterial();
      else if (name === 'seawall') mat = this.mat('concrete');
      else if (name === 'lakewall') mat = this.mat('rock');
      else mat = this.mat(name);
      const mesh = new THREE.Mesh(this._track(g.toGeometry()), mat);
      mesh.name = 'city:' + name;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    this._lakeMeshes = [];
    if (MR.Water) {
      for (const l of lakes) {
        const g = new MR.CityGeo({ vcap: 64 });
        writeShape(g, shapeOf(l.poly), 0, 8, 8);
        const mesh = new THREE.Mesh(this._track(g.toGeometry()), null);
        mesh.position.y = l.y;
        mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        mesh.name = 'city:lake:' + l.id;
        this._lakeMeshes.push(mesh);
      }
    }
  }

  // 陸のアスファルト: 上に重なる面（車線・芝・歩道）より奥に描く（polygonOffset で押し下げる）。
  // 低い太陽に向かって遠くを見ると、粗い面でも直接光の鏡面反射（グレア）で道が白く光るので、鏡面反射を弱める（landSpecular）
  _landMaterial() {
    if (this._landMat) return this._landMat;
    const m = this.materials.get('asphalt_city', { roughness: 1 });
    // 傾きに比例する分（factor）は使わない: 高い所から斜めに見ると 2 m 下の水面より奥へ押してしまい、道路に水が透ける
    m.polygonOffset = true; m.polygonOffsetFactor = 0; m.polygonOffsetUnits = 4;
    const k = this.cfg.landSpecular == null ? 0.2 : this.cfg.landSpecular;
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= ' + k.toFixed(3) + ';\n#include <aomap_fragment>');
    };
    this._landMat = m;
    return m;
  }

  // 縦の壁（a → b、y0..y1、外向き法線 nx, nz）
  static wall(g, a, b, y0, y1, nx, nz, tu, tv) {
    g.reserve(4, 6);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const i0 = g.v(a[0], lo, a[1], nx, 0, nz, 0, lo / tv), i1 = g.v(b[0], lo, b[1], nx, 0, nz, L / tu, lo / tv);
    const i2 = g.v(b[0], hi, b[1], nx, 0, nz, L / tu, hi / tv), i3 = g.v(a[0], hi, a[1], nx, 0, nz, 0, hi / tv);
    // 外（法線の向き）から見て反時計回りに: 右向き = (nz, −nx)?（法線 × 上）
    const rx = nz, rz = -nx, d = (b[0] - a[0]) * rx + (b[1] - a[1]) * rz;
    if (d >= 0) g.quad(i0, i1, i2, i3); else g.quad(i1, i0, i3, i2);
  }

  // ---------- 近景のチャンク（chunkFull → 材質ごとのメッシュ）----------
  // streamer.js が時間を区切って進めるジェネレーター。yield のたびに中断できる。完成したら { root, ext, int, caster, props, geos } を返す。
  // ctx.geos: 作った BufferGeometry（途中で捨てられたときに streamer が解放する）
  // 1 歩（yield の間）を短く（render.city.buildStepMs、既定 2 ms の目安）: 箱は stepBoxes（64）個ごと（重い箱は stepBoxCheck（8）個ごとに
  //   時間を見る）、斜路 stepRamps（16）・梯子とデカール stepItems（8）個ごと、影の外形は書くだけで 1 歩、BufferGeometry は 1 つ作るたびに
  //   目安を超えていれば次の歩へ。
  //   以前は箱 256 個・頂点 4 万ごとで、1 歩が 30〜240 ms になることがあった（端末ではそのままカクつき）。
  //   チャンクのデータの生成（cache.full = citygen.chunkFull）は最初の 1 歩（'gen'）で、分けられない
  *buildFull(cx, cz, ctx) {
    ctx = ctx || { geos: [] };
    const data = this.cache.full(cx, cz);
    yield 'gen';
    if (!data) return null;
    const cfg = this.cfg, now = CityWorld.now, slice = cfg.buildStepMs > 0 ? cfg.buildStepMs : 2;
    // 何個ごとに yield するか / 時間を見るか（render.city.stepBoxes / stepBoxCheck / stepRamps / stepItems）
    const nBox = cfg.stepBoxes > 0 ? cfg.stepBoxes : 64, nCheck = cfg.stepBoxCheck > 0 ? cfg.stepBoxCheck : 8;
    const nRamp = cfg.stepRamps > 0 ? cfg.stepRamps : 16, nItem = cfg.stepItems > 0 ? cfg.stepItems : 8;
    let ts = now();
    const bufs = new Map(); // 'mat|grp' → CityGeo
    const B = (mat, grp, opts) => {
      const k = mat + '|' + grp;
      let g = bufs.get(k);
      if (!g) { g = new MR.CityGeo(opts || { vcap: 2048 }); g.mat = mat; g.grp = grp; bufs.set(k, g); }
      return g;
    };
    const boxes = data.boxes;
    for (let i = 0; i < boxes.length; i++) {
      this._fullBox(boxes[i], B);
      if ((i + 1) % nBox === 0 || ((i + 1) % nCheck === 0 && now() - ts > slice)) { yield 'boxes'; ts = now(); }
    }
    for (let i = 0; i < data.ramps.length; i++) {
      this._fullRamp(data.ramps[i], B);
      if ((i + 1) % nRamp === 0 || now() - ts > slice) { yield 'ramps'; ts = now(); }
    }
    for (let i = 0; i < data.ladders.length; i++) {
      this._ladder(data.ladders[i], B('metalDark', 'ext'));
      if ((i + 1) % nItem === 0 || now() - ts > slice) { yield 'ladders'; ts = now(); }
    }
    for (let i = 0; i < data.decals.length; i++) {
      this._decal(data.decals[i], B);
      if ((i + 1) % nItem === 0 || now() - ts > slice) { yield 'decals'; ts = now(); }
    }
    // 影を落とす外形（chunkLod の箱。透明で、影のパスにだけ効く）。ここでは書くだけ（BufferGeometry は下で、別の歩）
    let casterBuf = null;
    if (this.cfg.shadowCasters !== false) {
      if (now() - ts > slice) { yield 'decals'; ts = now(); }
      const lod = this.cache.lod(cx, cz);
      if (lod && lod.boxes.length) {
        const g = new MR.CityGeo({ uv: false, vcap: lod.boxes.length * 24 });
        for (const b of lod.boxes) {
          if (b.lm && this.lmLoaded[b.lm]) continue;
          if (b.cat === 'sidewalk' || (b.h < 0.6 && b.y < 1)) continue; // 縁石・地面の薄い板は影に効かない（屋根のスラブは残す）
          // 光の側の面で影を落とす（casterMaterial.shadowSide = FrontSide）。建物の中（階段室・コンコース）は外形の内側なので影になる
          // （three の既定の裏の面だと、閉じた箱の中の点は「裏の面より手前」= 日なたになっていた）。同じ高さの見た目の外壁・屋上に
          // 影が乗らないよう、街では太陽の shadow.normalBias を大きくしている（game.js、render.city.shadowNormalBias）
          const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
          for (let f = 0; f < 6; f++) g.face(f, x0, y0, z0, x1, y1, z1, 1, 1, 0);
        }
        if (!g.empty) casterBuf = g;
      }
      yield 'caster';
      ts = now();
    }
    // メッシュにする（作った形は ctx.geos に入れておく）。1 つ作る前に、この歩がもう目安を超えていれば次の歩へ
    const root = new THREE.Group();
    root.name = 'chunk:' + data.key;
    root.matrixAutoUpdate = false;
    const ext = new THREE.Group(), int = new THREE.Group();
    ext.matrixAutoUpdate = false; int.matrixAutoUpdate = false;
    root.add(ext, int);
    for (const g of bufs.values()) {
      if (g.empty) continue;
      if (now() - ts > slice) { yield 'mesh'; ts = now(); }
      // マテリアルはふつう前もって作ってある（warmMaterials / warmStep）。まだで Canvas のテクスチャが要るものは、ここで少しずつ作る
      if (this._warmQueue && this._warmQueue.length) { yield* this._prepareMat(g.mat, slice); ts = now(); }
      const t1 = now(), mat = this.mat(g.mat);
      if (now() - t1 > slice) { yield 'mat'; ts = now(); }
      if (!mat) continue;
      const geo = this._track(g.toGeometry());
      ctx.geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = g.mat + '@' + g.grp;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      (g.grp === 'int' ? int : ext).add(mesh);
    }
    let casterGeo = null;
    if (casterBuf) {
      if (now() - ts > slice) { yield 'mesh'; ts = now(); }
      casterGeo = this._track(casterBuf.toGeometry());
      ctx.geos.push(casterGeo);
    }
    let caster = null;
    if (casterGeo) {
      caster = new THREE.Mesh(casterGeo, this.casterMaterial);
      caster.name = 'shadowCaster';
      caster.castShadow = true;
      caster.receiveShadow = false;
      caster.matrixAutoUpdate = false;
      root.add(caster);
    }
    root.updateMatrixWorld(true);
    return { key: data.key, cx, cz, root, ext, int, caster, geos: ctx.geos, props: data.props, rect: this.city.chunkRect(cx, cz) };
  }

  // 箱 1 つ。材質の選び方:
  //   入れない建物の外壁（exterior で SHELL でない）と大きなランドマークの石・コンクリート → 窓のある *_win（office_stone の色違い）
  //   上面: mt があればその材質（屋上の砂利）、下面: 床・屋根のスラブは天井（plaster_interior）
  //   歩道（街区の縁石の箱）: 上面 sidewalk、側面 curb
  //   小物の当たりの箱（cat prop）は小物（CityProps）が見た目を受け持つので描かない（mt 付きの植え込みと、GLB が無いランドマークの部品は描く）
  _fullBox(b, B) {
    const SHELL = 16;
    if (b.lm && this.lmLoaded[b.lm]) return;
    if (b.cat === 'prop' && !b.mt && !b.lm) return;
    let mat = b.mat;
    const shell = (b.f & SHELL) !== 0;
    if ((mat === 'limestone' || mat === 'concrete') && !shell && ((b.cat === 'exterior') || (b.cat === 'landmark' && b.h >= 12 && Math.min(b.w, b.d) >= 6))) mat = mat === 'limestone' ? 'limestone_win' : 'concrete_win';
    if (!this.materials.has(mat)) mat = 'concrete';
    const grp = (b.cat === 'interior') ? 'int' : 'ext';
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
    if (b.cat === 'sidewalk') {
      const st = this.tile('sidewalk'), cu = this.tile('curb');
      const g = B('sidewalk', 'ext');
      g.face(4, x0, y0, z0, x1, y1, z1, st.u, st.v, 0);
      const c = B('curb', 'ext');
      for (let f = 0; f < 4; f++) c.face(f, x0, y0, z0, x1, y1, z1, cu.u, cu.v, y0);
      return;
    }
    const t = this.tile(mat);
    const g = B(mat, grp);
    for (let f = 0; f < 4; f++) g.face(f, x0, y0, z0, x1, y1, z1, t.u, t.v, y0);
    if (b.mt) { const tt = this.tile(b.mt); B(b.mt, grp).face(4, x0, y0, z0, x1, y1, z1, tt.u, tt.v, 0); }
    else g.face(4, x0, y0, z0, x1, y1, z1, t.u, t.v, 0);
    if (y0 > 0.2 && (b.cat !== 'interior' || (b.f & 1))) { // 室内の壁の下面は床に接している（見た目だけの天井画は下面が表）
      if (b.cat === 'floor' || b.cat === 'roof') { const pt = this.tile('plaster_interior'); B('plaster_interior', 'ext').face(5, x0, y0, z0, x1, y1, z1, pt.u, pt.v, 0); }
      else g.face(5, x0, y0, z0, x1, y1, z1, t.u, t.v, 0);
    } else if (b.cat === 'pier' || b.cat === 'road' || (b.cat === 'landmark' && y0 < 0)) g.face(5, x0, y0, z0, x1, y1, z1, t.u, t.v, 0);
  }

  // スロープ。階段（cat stair）は段（蹴上げ 0.15〜0.2 m）、他は傾いた板（横の面付き）。幅 2.2 m 未満の階段は室内の階段（室内のグループ）
  _fullRamp(r, B) {
    if (r.lm && this.lmLoaded[r.lm]) return;
    const mat = this.materials.has(r.mat) ? r.mat : 'concrete';
    const t = this.tile(mat);
    const stair = r.cat === 'stair';
    const grp = stair && Math.min(r.w, r.d) < 2.2 ? 'int' : 'ext';
    const g = B(mat, grp);
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
    const H = r.y1 - r.y0, T = r.t || 0.3;
    const alongX = r.axis === 'x';
    const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1, L = a1 - a0;
    if (stair && H > 0.05) {
      const n = Math.max(1, Math.round(H / 0.18)), rise = H / n, tread = L / n;
      for (let k = 0; k < n; k++) {
        // 低い方から k 段目の範囲（dir > 0 なら +軸へ上がる）
        const s0 = r.dir > 0 ? a0 + k * tread : a1 - (k + 1) * tread, s1 = s0 + tread;
        const top = r.y0 + (k + 0.5) * rise, bot = r.y0 + k * rise - T;
        const bx0 = alongX ? s0 : x0, bx1 = alongX ? s1 : x1, bz0 = alongX ? z0 : s0, bz1 = alongX ? z1 : s1;
        g.face(4, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, 0);
        // 蹴上げ（下り側の面）と左右の面
        if (alongX) { g.face(r.dir > 0 ? 1 : 0, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, bot); g.face(2, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, bot); g.face(3, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, bot); }
        else { g.face(r.dir > 0 ? 3 : 2, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, bot); g.face(0, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, bot); g.face(1, bx0, bot, bz0, bx1, top, bz1, t.u, t.v, bot); }
      }
      this._rampUnderside(g, r, x0, z0, x1, z1, T, t);
      return;
    }
    // 傾いた板: 上面・下面・4 つの横の面（上の辺が傾く）
    const surf = (x, z) => { let u = alongX ? (x - x0) / r.w : (z - z0) / r.d; if (r.dir < 0) u = 1 - u; return r.y0 + H * u; };
    const k = H / L * (r.dir > 0 ? 1 : -1); // 軸方向の勾配
    const nl = Math.hypot(k, 1), nx = alongX ? -k / nl : 0, nz = alongX ? 0 : -k / nl, ny = 1 / nl;
    g.reserve(24, 36);
    const iu = 1 / (t.u || 1), iv = 1 / (t.v || 1);
    const top = (x, z) => g.v(x, surf(x, z), z, nx, ny, nz, x * iu, -z * iv);
    let a = top(x0, z1), b = top(x1, z1), c = top(x1, z0), d = top(x0, z0);
    g.quad(a, b, c, d);
    const bot = (x, z) => g.v(x, surf(x, z) - T, z, -nx, -ny, -nz, x * iu, z * iv);
    a = bot(x0, z0); b = bot(x1, z0); c = bot(x1, z1); d = bot(x0, z1);
    g.quad(a, b, c, d);
    const side = (p, q, nxx, nzz) => { // p → q が外から見て右向き
      const i0 = g.v(p[0], surf(p[0], p[1]) - T, p[1], nxx, 0, nzz, 0, 0), i1 = g.v(q[0], surf(q[0], q[1]) - T, q[1], nxx, 0, nzz, 1, 0);
      const i2 = g.v(q[0], surf(q[0], q[1]), q[1], nxx, 0, nzz, 1, 1), i3 = g.v(p[0], surf(p[0], p[1]), p[1], nxx, 0, nzz, 0, 1);
      g.quad(i0, i1, i2, i3);
    };
    side([x1, z1], [x1, z0], 1, 0); side([x0, z0], [x0, z1], -1, 0); side([x0, z1], [x1, z1], 0, 1); side([x1, z0], [x0, z0], 0, -1);
  }
  _rampUnderside(g, r, x0, z0, x1, z1, T, t) {
    const alongX = r.axis === 'x', H = r.y1 - r.y0;
    const surf = (x, z) => { let u = alongX ? (x - x0) / r.w : (z - z0) / r.d; if (r.dir < 0) u = 1 - u; return r.y0 + H * u - T; };
    g.reserve(4, 6);
    const a = g.v(x0, surf(x0, z0), z0, 0, -1, 0, x0 / t.u, z0 / t.v), b = g.v(x1, surf(x1, z0), z0, 0, -1, 0, x1 / t.u, z0 / t.v);
    const c = g.v(x1, surf(x1, z1), z1, 0, -1, 0, x1 / t.u, z1 / t.v), d = g.v(x0, surf(x0, z1), z1, 0, -1, 0, x0 / t.u, z1 / t.v);
    g.quad(a, b, c, d);
  }

  // 梯子（壁の外 0.15 m に 2 本の支柱 + 0.35 m ごとの段）
  _ladder(l, g) {
    const tx = -l.nz, tz = l.nx; // 壁に沿う向き
    const ox = l.x + l.nx * 0.15, oz = l.z + l.nz * 0.15;
    const box = (cx, cz, hw, hd, y0, y1, faces) => {
      const x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd;
      for (const f of faces) g.face(f, x0, y0, z0, x1, y1, z1, 1, 1, 0);
    };
    const side = [0, 1, 2, 3];
    for (const s of [-0.25, 0.25]) box(ox + tx * s, oz + tz * s, 0.03, 0.03, l.y0, l.y1, side);
    const along = Math.abs(tx) > 0.5; // 段は壁に沿う向きに長い
    for (let y = l.y0 + 0.3; y < l.y1 - 0.05; y += 0.35) {
      if (along) box(ox, oz, 0.25, 0.02, y, y + 0.04, [2, 3, 4]);
      else box(ox, oz, 0.02, 0.25, y, y + 0.04, [0, 1, 4]);
    }
  }

  // ---------- デカール ----------
  _decal(d, B) {
    const Y = 0.012;
    switch (d.type) {
      case 'lanes': this._lanes(d, B('roadPaint', 'ext', { uv: false, col: true, vcap: 512 }), Y); break;
      case 'crosswalk': {
        const g = B('roadPaint', 'ext', { uv: false, col: true, vcap: 512 });
        g.color(CityWorld.lin('#e8e6df'));
        const alongX = d.w >= d.d, len = alongX ? d.w : d.d, dep = alongX ? d.d : d.w;
        for (let s = -len / 2 + 0.6; s <= len / 2 - 0.6; s += 1.2) {
          if (alongX) g.flat([[d.x + s - 0.3, d.z - dep / 2], [d.x + s + 0.3, d.z - dep / 2], [d.x + s + 0.3, d.z + dep / 2], [d.x + s - 0.3, d.z + dep / 2]], Y, 1, 1);
          else g.flat([[d.x - dep / 2, d.z + s - 0.3], [d.x + dep / 2, d.z + s - 0.3], [d.x + dep / 2, d.z + s + 0.3], [d.x - dep / 2, d.z + s + 0.3]], Y, 1, 1);
        }
        break;
      }
      case 'manhole': {
        const g = B('manhole', 'ext', { vcap: 256 });
        const n = 14, base = g.nv;
        g.reserve(n + 1, n * 3);
        g.v(d.x, Y + 0.002, d.z, 0, 1, 0, 0.5, 0.5);
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          const ua = a + (d.rot || 0);
          g.v(d.x + c * 0.45, Y + 0.002, d.z - s * 0.45, 0, 1, 0, 0.5 + 0.5 * Math.cos(ua), 0.5 + 0.5 * Math.sin(ua));
        }
        for (let i = 0; i < n; i++) g.tri(base, base + 1 + i, base + 1 + ((i + 1) % n));
        break;
      }
      case 'patch': { const t = this.tile('asphalt_patch'); B('asphalt_patch', 'ext').rectRot(d.x, d.z, d.w, d.d, d.rot || 0, Y, t.u, t.v); break; }
      case 'track': this._track3(d, B); break;
      case 'helipad': {
        const g = B('roadPaint', 'ext', { uv: false, col: true, vcap: 512 });
        const y = (d.y || 0) + 0.02, r = Math.min(d.w, d.d) / 2;
        g.color(CityWorld.lin('#e2b13c'));
        const n = 28, r0 = r * 0.78, r1 = r * 0.86;
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
          g.flat([[d.x + Math.cos(a0) * r0, d.z + Math.sin(a0) * r0], [d.x + Math.cos(a1) * r0, d.z + Math.sin(a1) * r0], [d.x + Math.cos(a1) * r1, d.z + Math.sin(a1) * r1], [d.x + Math.cos(a0) * r1, d.z + Math.sin(a0) * r1]], y, 1, 1);
        }
        g.color(CityWorld.lin('#f2f2ee'));
        const h = r * 0.45, w = r * 0.32, s = r * 0.08;
        g.flat([[d.x - w - s, d.z - h], [d.x - w + s, d.z - h], [d.x - w + s, d.z + h], [d.x - w - s, d.z + h]], y, 1, 1);
        g.flat([[d.x + w - s, d.z - h], [d.x + w + s, d.z - h], [d.x + w + s, d.z + h], [d.x + w - s, d.z + h]], y, 1, 1);
        g.flat([[d.x - w, d.z - s], [d.x + w, d.z - s], [d.x + w, d.z + s], [d.x - w, d.z + s]], y, 1, 1);
        break;
      }
      case 'billboard': break; // 看板は遠景（LOD）の区画が描く（近景になる前から見えるように）
      default: break;
    }
  }

  // 車線: 中央の二重黄線（4 車線以上の通り）と白の破線（3 m 引いて 6 m 空ける、世界座標で揃える）。交差点の中は引かない
  _lanes(d, g, Y) {
    const W = 0.13, DASH = 3, PER = 9;
    const city = this.city;
    const line = (ax, az, bx, bz, w) => { // 線分 a → b（幅 w）
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.05) return;
      const nx = -dz / L * w / 2, nz = dx / L * w / 2;
      g.flat([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], Y, 1, 1);
    };
    const white = CityWorld.lin('#e6e4dc'), yellow = CityWorld.lin('#d8a62a');
    if (d.pts) {
      // 斜めの四角形（ブロードウェイ・FDR）: 長い辺に平行に
      const p = d.pts, l01 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), l12 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
      const A = l01 >= l12 ? [p[0], p[1], p[2], p[3]] : [p[1], p[2], p[3], p[0]]; // A0→A1 が長い辺、A3→A2 が向かいの辺
      const n = Math.max(2, d.lanes || 2), L = Math.max(l01, l12);
      g.color(white);
      for (let k = 1; k < n; k++) {
        const f = k / n;
        const sx = A[0][0] + (A[3][0] - A[0][0]) * f, sz = A[0][1] + (A[3][1] - A[0][1]) * f;
        const ex = A[1][0] + (A[2][0] - A[1][0]) * f, ez = A[1][1] + (A[2][1] - A[1][1]) * f;
        for (let s = 0; s < L; s += PER) {
          const a = s / L, b = Math.min(1, (s + DASH) / L);
          line(sx + (ex - sx) * a, sz + (ez - sz) * a, sx + (ex - sx) * b, sz + (ez - sz) * b, W);
        }
      }
      return;
    }
    const alongZ = d.axis === 'z';
    const x0 = d.x - d.w / 2, x1 = d.x + d.w / 2, z0 = d.z - d.d / 2, z1 = d.z + d.d / 2;
    const across = alongZ ? d.w : d.d, a0 = alongZ ? z0 : x0, a1 = alongZ ? z1 : x1, c0 = alongZ ? x0 : z0;
    const n = Math.max(2, d.lanes || 2), med = d.median || 0;
    // 交差点（通りの帯）を避ける区間
    const gaps = [];
    if (alongZ && city.streets) for (const s of city.streets) if (s.z + s.w / 2 + 2 > a0 && s.z - s.w / 2 - 2 < a1) gaps.push([s.z - s.w / 2 - 2, s.z + s.w / 2 + 2]);
    const seg = (c, w, dashed, col) => {
      g.color(col);
      const put = (s, e) => {
        for (const q of gaps) if (s < q[1] && e > q[0]) { if (s < q[0]) put(s, q[0]); if (e > q[1]) put(q[1], e); return; }
        if (e - s < 0.05) return;
        if (alongZ) line(c, s, c, e, w); else line(s, c, e, c, w);
      };
      if (!dashed) { put(a0 + 1, a1 - 1); return; }
      for (let s = Math.ceil(a0 / PER) * PER; s < a1; s += PER) put(Math.max(a0, s), Math.min(a1, s + DASH));
    };
    if (med > 0) {
      // 中央分離帯の両側に黄線、その外側の車線を白の破線で
      const half = (across - med) / 2, per = Math.max(1, Math.floor(n / 2));
      for (const side of [-1, 1]) {
        const inner = c0 + across / 2 + side * (med / 2 + 0.3);
        seg(inner, W, false, yellow);
        for (let k = 1; k < per; k++) seg(c0 + across / 2 + side * (med / 2 + half * k / per), W, true, white);
      }
      return;
    }
    if (n >= 4 && !alongZ) {
      const c = c0 + across / 2;
      seg(c - 0.12, W * 0.8, false, yellow); seg(c + 0.12, W * 0.8, false, yellow);
      for (let k = 1; k < n; k++) if (k !== n / 2) seg(c0 + across * k / n, W, true, white);
      return;
    }
    for (let k = 1; k < n; k++) seg(c0 + across * k / n, W, true, white);
  }

  // 線路（バラスト + 枕木 + 2 本のレール）
  _track3(d, B) {
    const alongZ = d.d >= d.w, len = alongZ ? d.d : d.w;
    const gt = this.tile('gravel_roof');
    B('gravel_roof', 'ext').rectRot(d.x, d.z, alongZ ? 3 : len, alongZ ? len : 3, 0, 0.03, gt.u, gt.v);
    const ties = B('crate', 'ext'), rails = B('metalDark', 'ext');
    const box = (g, cx, cz, hx, hz, y0, y1, faces) => { for (const f of faces) g.face(f, cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, 1, 1, y0); };
    for (let s = -len / 2 + 0.3; s < len / 2; s += 0.65) {
      if (alongZ) box(ties, d.x, d.z + s, 1.3, 0.11, 0.03, 0.15, [2, 3, 4]); else box(ties, d.x + s, d.z, 0.11, 1.3, 0.03, 0.15, [0, 1, 4]);
    }
    for (const o of [-0.72, 0.72]) {
      if (alongZ) box(rails, d.x + o, d.z, 0.035, len / 2, 0.15, 0.3, [0, 1, 4]); else box(rails, d.x, d.z + o, len / 2, 0.035, 0.15, 0.3, [2, 3, 4]);
    }
  }

  // 看板: 壁から少し出た発光の四角形。アトラス 4 × 4 の idx 番を、縦横比に合わせて中央を切り出す
  _billboard(d, g) {
    const nx = d.nx, nz = d.nz, rx = nz, rz = -nx; // 右向き
    const w = d.w, h = d.h, hw = w / 2, hh = h / 2;
    const x = d.x + nx * 0.05, z = d.z + nz * 0.05, y = d.y;
    const col = d.idx % 4, row = Math.floor(d.idx / 4), inset = 0.00293;
    let u0 = col / 4 + inset, u1 = (col + 1) / 4 - inset, v0 = 1 - (row + 1) / 4 + inset, v1 = 1 - row / 4 - inset;
    const pw = u1 - u0;
    if (w > h) { const c = (v0 + v1) / 2, hv = pw * h / w / 2; v0 = c - hv; v1 = c + hv; }
    else { const c = (u0 + u1) / 2, hu = pw * w / h / 2; u0 = c - hu; u1 = c + hu; }
    g.reserve(4, 6);
    const a = g.v(x - rx * hw, y - hh, z - rz * hw, nx, 0, nz, u0, v0), b = g.v(x + rx * hw, y - hh, z + rz * hw, nx, 0, nz, u1, v0);
    const c = g.v(x + rx * hw, y + hh, z + rz * hw, nx, 0, nz, u1, v1), e = g.v(x - rx * hw, y + hh, z - rz * hw, nx, 0, nz, u0, v1);
    g.quad(a, b, c, e);
  }

  static lin(hex) { return MR.srgb(hex); }

  // マテリアルのテクスチャを縮める: アルベド（map）は max、それ以外（法線・ORM・発光）は detail 以下（同じテクスチャは同じ縮小版に:
  // done = Map 元 → 縮小版）
  //   done を先に見る: glTF の ORM は 1 つの Texture を aoMap / roughnessMap / metalnessMap で共有する。aoMap を縮めると元の ImageBitmap は
  //   閉じる（幅 0）ので、大きさを先に見ると残りの 2 つが「縮めなくてよい」と判断されて閉じた画像のまま残っていた（テカテカの外壁・
  //   INVALID_VALUE: texImage2D: The source data has been detached）
  static limitTextures(m, max, detail, done) {
    if (!m || !(max || detail) || !MR.AssetManager || !MR.AssetManager.downscale) return;
    for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
      const t = m[k], lim = k === 'map' ? max : detail;
      if (!lim || !t) continue;
      let r = done.get(t);
      if (r) { m[k] = r; continue; }
      if (!t.image || !(t.image.width > lim || t.image.height > lim)) continue;
      const fy = t.flipY; r = MR.AssetManager.downscale(t, lim); r.flipY = fy; r.needsUpdate = true; done.set(t, r);
      m[k] = r;
    }
    m.needsUpdate = true;
  }

  // ---------- 遠景（512 m 区画ごとに 1 メッシュ、共有の farMaterial）----------
  // 材質 → { c: 壁の色, roof: 上面の色, s: シェーダーのスタイル（1 茶レンガ 2 赤レンガ 3 ガラス 4 石のオフィス 5 石灰岩 6 コンクリート、
  //   0 = 窓なし）}。色はリニア
  static farStyles() {
    const L = (h) => MR.srgb(h);
    const roof = L('#4c4844');
    const S = {
      brick_brown: { c: L('#5e4434'), s: 1 }, brick_red: { c: L('#7c3c2e'), s: 2 }, glass_tower: { c: L('#36424e'), s: 3 },
      office_stone: { c: L('#948d82'), s: 4 }, limestone: { c: L('#b3ab99'), s: 5 }, concrete: { c: L('#8e8b85'), s: 6 },
      metalDark: { c: L('#3a3d43'), s: 0 }, sidewalk: { c: L('#77756f'), s: 0 }, curb: { c: L('#66645f'), s: 0 }, asphalt_city: { c: L('#3a3a3d'), s: 0 },
      hull_grey: { c: L('#6b7178'), s: 0 }, carrier_deck: { c: L('#3d3f42'), s: 0 }, stair_stone: { c: L('#aaa397'), s: 0 }, red_glass: { c: L('#a3161c'), s: 0 },
      gravel_roof: { c: roof, s: 0 }, grass: { c: L('#4a6630'), s: 0 }, container: { c: L('#b8442c'), s: 0 }, container2: { c: L('#2e6fb3'), s: 0 },
      rock: { c: L('#7a7468'), s: 0 }, marble_floor: { c: L('#ccab95'), s: 0 }, crate: { c: L('#7a5c3a'), s: 0 }, glass_rail: { c: L('#8aa0ad'), s: 0 },
      _: { c: L('#8a8680'), s: 0 }
    };
    for (const k of Object.keys(S)) { S[k].roof = k === 'gravel_roof' || S[k].s === 0 ? S[k].c.clone().multiplyScalar(0.85) : roof; }
    return S;
  }

  // 遠景の箱 1 つ（下面は描かない。側面は窓のスタイル、上面は屋上の色）
  _farBox(g, b, cx, cz) {
    const st = this._farStyles[b.mat] || this._farStyles._;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
    g.i0 = cx; g.i1 = cz; g.i3 = ((Math.round(b.x * 7.3) ^ Math.round(b.z * 3.1)) & 255);
    if (b.cat === 'sidewalk') {
      g.i2 = 0;
      g.color(this._farStyles.sidewalk.c); g.face(4, x0, y0, z0, x1, y1, z1, 1, 1, 0);
      g.color(this._farStyles.curb.c); for (let f = 0; f < 4; f++) g.face(f, x0, y0, z0, x1, y1, z1, 1, 1, 0);
      return;
    }
    // 建物ごとに少し明るさと色味を変える（同じ材質が並んでも単調にならないように）
    const h = ((Math.imul(Math.round(b.x * 4) | 0, 73856093) ^ Math.imul(Math.round(b.z * 4) | 0, 19349663)) >>> 0) / 4294967296;
    const k = 0.84 + 0.3 * h, w = (h - 0.5) * 0.08;
    g.color([st.c.r * k * (1 + w), st.c.g * k, st.c.b * k * (1 - w)]);
    g.i2 = (st.s > 0 && b.h >= 6) ? st.s : 0;
    for (let f = 0; f < 4; f++) g.face(f, x0, y0, z0, x1, y1, z1, 1, 1, 0);
    g.i2 = 0;
    g.color(b.mt ? (this._farStyles[b.mt] || st).c : st.roof);
    g.face(4, x0, y0, z0, x1, y1, z1, 1, 1, 0);
  }

  // 木の塊（低ポリの八面体。高さ 2.4〜7.4 m、幅 5 m）。遠景（スタイル 8）と、近景の遠い木（インスタンス）に使う
  static treeBlob(g, x, y, z, rot, s) {
    s = s || 1;
    const r = 2.6 * s, top = y + 7.4 * s, mid = y + 4.6 * s, bot = y + 2.4 * s;
    g.reserve(6, 24);
    const k = [];
    k.push(g.v(x, top, z, 0, 1, 0, 0, 1));
    for (let i = 0; i < 4; i++) {
      const a = rot + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      k.push(g.v(x + c * r, mid, z - sn * r, c * 0.9, 0.3, -sn * 0.9, 0, 0.5));
    }
    k.push(g.v(x, bot, z, 0, -1, 0, 0, 0));
    for (let i = 0; i < 4; i++) {
      const a = k[1 + i], b = k[1 + ((i + 1) % 4)];
      g.tri(k[0], a, b);   // 上: 上から見て反時計回り
      g.tri(k[5], b, a);
    }
  }

  // LOD 区画（chunkLod の外形 + 街路樹・公園の木の塊 + 公園の岩）。中断できる: チャンクごと（軽ければまとめて、buildStepMs の目安まで）、
  //   木・岩・看板のデータの生成（chunkDecor。公園は数 ms）はそれだけで 1 歩、BufferGeometry（区画の形・看板）もそれぞれ 1 歩。
  //   ctx.geos: 作った BufferGeometry（途中で捨てられたときに streamer が解放する）
  *buildLod(sx, sz, ctx) {
    ctx = ctx || { geos: [] };
    const S = this.streamer ? this.streamer.S : 4;
    const now = CityWorld.now, slice = this.cfg.buildStepMs > 0 ? this.cfg.buildStepMs : 2;
    // 木・岩・看板のデータの生成の前に、この歩がもう decorYield × buildStepMs を使っていれば先に yield（生成は分けられない）
    const decorAt = slice * (this.cfg.decorYield >= 0 ? this.cfg.decorYield : 0.5);
    let ts = now();
    const g = new MR.CityGeo({ uv: false, col: true, info: true, vcap: 8192 });
    let bb = null; // 看板（発光のアトラス。別のメッシュ）
    const foliage = this._farStyles.grass.c;
    for (let cz = sz * S; cz < Math.min(this.city.ncz, (sz + 1) * S); cz++) {
      for (let cx = sx * S; cx < Math.min(this.city.ncx, (sx + 1) * S); cx++) {
        const lod = this.cache.lod(cx, cz);
        if (lod) for (const b of lod.boxes) { if (b.lm && this.lmLoaded[b.lm]) continue; this._farBox(g, b, cx, cz); }
        if (!this.cache.hasDecor(cx, cz)) {
          if (now() - ts > decorAt) { yield 'chunk'; ts = now(); }
          this.cache.decor(cx, cz);
          yield 'decor';
          ts = now();
        }
        const dec = this.cache.decor(cx, cz);
        if (dec) {
          if (dec.billboards && dec.billboards.length && this.cfg.billboards !== false) {
            bb = bb || new MR.CityGeo({ vcap: 64 });
            for (const d of dec.billboards) this._billboard(d, bb);
          }
          for (const b of dec.rocks) this._farBox(g, b, cx, cz);
          g.i0 = cx; g.i1 = cz; g.i2 = 8;
          for (const t of dec.trees) {
            const h = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
            g.i3 = Math.floor(h * 255);
            g.color([foliage.r * (0.7 + 0.5 * h), foliage.g * (0.8 + 0.4 * h), foliage.b * (0.7 + 0.3 * h)]);
            CityWorld.treeBlob(g, t.x, t.y, t.z, t.rot, 0.9 + 0.25 * h);
          }
        }
        yield 'chunk';
        ts = now();
      }
    }
    if (g.empty) return null;
    const geo = this._track(g.toGeometry());
    ctx.geos.push(geo);
    const geos = [geo];
    let bgeo = null;
    if (bb && !bb.empty) {
      if (now() - ts > slice) { yield 'geo'; ts = now(); }
      if (this._warmQueue && this._warmQueue.length) { yield* this._prepareMat('billboard', slice); ts = now(); }
      bgeo = this._track(bb.toGeometry());
      ctx.geos.push(bgeo);
      geos.push(bgeo);
    }
    const mesh = new THREE.Mesh(geo, this.farMaterial);
    mesh.name = 'lod:' + sx + '_' + sz;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    if (bgeo) {
      const bm = new THREE.Mesh(bgeo, this.mat('billboard'));
      bm.name = 'billboards'; bm.matrixAutoUpdate = false;
      mesh.add(bm);
    }
    this.root.add(mesh);
    return { mesh, geos };
  }

  // スカイライン（全体。起動時に 1 回）: skyline() の箱を持ち主のチャンクの 512 m 区画ごとに + 街区の上面 + ブロードウェイ
  buildSkyline(S) {
    const city = this.city, ncx = city.ncx;
    S = S || this.streamer.S;
    const groups = new Map();
    const G = (sx, sz) => { const k = sx + '_' + sz; let g = groups.get(k); if (!g) { g = new MR.CityGeo({ uv: false, col: true, info: true, vcap: 4096 }); g.sx = sx; g.sz = sz; groups.set(k, g); } return g; };
    for (const grp of city.skyline().groups) {
      for (const b of grp.boxes) {
        if (b.lm && this.lmLoaded[b.lm]) continue;
        const o = b.o >= 0 ? b.o : city._ci(b.x, b.z);
        if (o < 0) continue;
        const cx = o % ncx, cz = Math.floor(o / ncx);
        this._farBox(G(Math.floor(cx / S), Math.floor(cz / S)), b, 255, 255);
      }
    }
    // 街区の上面（縁石の高さ。公園などの穴は抜く）
    const side = S * city.cs;
    const sc = this._farStyles.sidewalk.c;
    for (const c of city.cells || []) {
      const pieces = MR.CityGen.rectMinus(c.rect, c.holes || []);
      for (const q of pieces) {
        const sx0 = Math.floor((q[0] - city.minX) / side), sx1 = Math.floor((q[2] - city.minX - 0.01) / side);
        const sz0 = Math.floor((q[1] - city.minZ) / side), sz1 = Math.floor((q[3] - city.minZ - 0.01) / side);
        for (let sz = sz0; sz <= sz1; sz++) for (let sx = sx0; sx <= sx1; sx++) {
          const r = [Math.max(q[0], city.minX + sx * side), Math.max(q[1], city.minZ + sz * side), Math.min(q[2], city.minX + (sx + 1) * side), Math.min(q[3], city.minZ + (sz + 1) * side)];
          if (r[2] - r[0] < 0.5 || r[3] - r[1] < 0.5) continue;
          const g = G(sx, sz);
          g.i0 = 255; g.i1 = 255; g.i2 = 0; g.color(sc);
          g.flat([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], city.curbH, 1, 1);
        }
      }
    }
    const ac = this._farStyles.asphalt_city.c;
    for (const rd of city.roads || []) {
      if (rd.kind !== 'broadway' || !rd.pts) continue;
      const mx = (rd.pts[0][0] + rd.pts[2][0]) / 2, mz = (rd.pts[0][1] + rd.pts[2][1]) / 2;
      const g = G(Math.floor((mx - city.minX) / side), Math.floor((mz - city.minZ) / side));
      g.i0 = 255; g.i1 = 255; g.i2 = 0; g.color(ac);
      g.flat(rd.pts, city.curbH + 0.02, 1, 1);
    }
    const out = new Map();
    for (const [k, g] of groups) {
      if (g.empty) continue;
      const geo = this._track(g.toGeometry());
      const mesh = new THREE.Mesh(geo, this.farMaterial);
      mesh.name = 'sky:' + k;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      out.set(k, { mesh, geos: [geo], sx: g.sx, sz: g.sz });
    }
    return out;
  }

  // 遠景のマテリアル（MeshStandardMaterial + onBeforeCompile。近景と同じ光の計算 = 実機の環境マップの明るさも同じに効く）。
  // 頂点カラーが壁の色、aInfo = (cx, cz, スタイル, 乱数)。直接光の鏡面反射は弱める（低い太陽で面が白く光らないように）。
  //   頂点: 近景が出来上がったチャンク（uHide）の頂点は画面の外へ（三角形ごと消える）
  //   フラグメント: 側面に窓の格子（世界座標: 横 = 面に沿う座標 / 柱間、縦 = (y − 0.15) / 階高）。灯りの付いた窓は発光（夕暮れ）。
  //     遠くて窓が 1 画素より小さくなる所は平均の色にする（fwidth。無い端末は距離で）
  static makeFarMaterial(cfg) {
    cfg = cfg || {};
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    m.name = 'cityFar';
    m.extensions = { derivatives: true };
    const hide = [];
    for (let i = 0; i < CityWorld.HIDE_SLOTS; i++) hide.push(new THREE.Vector2(-100, -100));
    const U = {
      uHide: { value: hide },
      uWinGlow: { value: cfg.farWindowGlow == null ? 1.25 : cfg.farWindowGlow },
      uWinLit: { value: cfg.farWindowLit == null ? 1 : cfg.farWindowLit },
      uWinColor: { value: MR.srgb('#ffc77a') },
      uGlassA: { value: MR.srgb('#1d242c') },
      uGlassB: { value: MR.srgb('#46525e') },
      uSky: { value: MR.srgb('#e9985a') }
    };
    m.userData.uniforms = U;
    const N = CityWorld.HIDE_SLOTS;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nvarying vec4 vInfo;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vDist;\nuniform vec2 uHide[' + N + '];')
        .replace('#include <project_vertex>', [
          '#include <project_vertex>',
          'vInfo = aInfo;',
          'vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          'vWN = normalize(mat3(modelMatrix) * objectNormal);',
          'vDist = -mvPosition.z;',
          'for (int i = 0; i < ' + N + '; i++) {',
          '  vec2 dd = abs(aInfo.xy - uHide[i]);',
          '  if (dd.x < 0.5 && dd.y < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);',
          '}'
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'varying vec4 vInfo;', 'varying vec3 vWP;', 'varying vec3 vWN;', 'varying float vDist;',
          'uniform float uWinGlow; uniform float uWinLit; uniform vec3 uWinColor; uniform vec3 uGlassA; uniform vec3 uGlassB; uniform vec3 uSky;',
          'float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }'
        ].join('\n'))
        .replace('#include <emissivemap_fragment>', [
          '#include <emissivemap_fragment>',
          '{',
          '  float st = floor(vInfo.z + 0.5);',
          '  vec3 nW = normalize(vWN);',
          '  if (st > 0.5 && st < 6.5 && abs(nW.y) < 0.5) {',
          '    float bay = 3.0; float storey = 4.0; float wu = 0.57; float v0 = 0.225; float v1 = 0.8; float lit = 0.45;',
          '    if (st < 2.5) { storey = 3.6; wu = 0.37; v0 = 0.25; v1 = 0.76; lit = 0.33; }',
          '    else if (st < 3.5) { bay = 1.5; wu = 0.9; v0 = 0.25; v1 = 0.97; lit = 0.42; }',
          '    else if (st > 5.5) { storey = 3.6; lit = 0.4; }',
          '    vec2 cell = vec2(dot(vWP.xz, vec2(-nW.z, nW.x)) / bay, (vWP.y - 0.15) / storey);',
          '    vec2 f = fract(cell);',
          '#if defined(GL_OES_standard_derivatives) || (__VERSION__ >= 300)',
          '    vec2 fw = max(fwidth(cell), vec2(0.0005));',
          '#else',
          '    vec2 fw = vec2(vDist * 0.0017 / bay, vDist * 0.0017 / storey);',
          '#endif',
          '    float hu = wu * 0.5;',
          '    float mu = clamp(smoothstep(0.5 - hu - fw.x, 0.5 - hu + fw.x, f.x) - smoothstep(0.5 + hu - fw.x, 0.5 + hu + fw.x, f.x), 0.0, 1.0);',
          '    float mv = clamp(smoothstep(v0 - fw.y, v0 + fw.y, f.y) - smoothstep(v1 - fw.y, v1 + fw.y, f.y), 0.0, 1.0);',
          '    float win = mu * mv;',
          '    float fade = smoothstep(0.25, 0.65, max(fw.x, fw.y));',
          '    vec2 id = floor(cell);',
          '    vec2 rid = (st > 2.5 && st < 3.5) ? vec2(floor(id.x / 4.0), id.y) : id;',
          '    float h = cityHash(rid + vec2(vInfo.w * 0.37, st * 1.7));',
          '    float on = step(1.0 - lit * uWinLit, h);',
          '    win = mix(win, wu * (v1 - v0), fade);',
          // 遠くでは窓 4 × 3 個のまとまりごとに灯りの多い・少ないを変える（平均の色だけだと粘土のように見える）
          '    float coarse = cityHash(floor(cell / vec2(4.0, 3.0)) + vec2(vInfo.w * 0.53, st * 2.3));',
          '    on = mix(on, lit * uWinLit * (0.5 + coarse), fade);',
          '    vec3 glass = mix(uGlassA, uGlassB, mix(cityHash(id + 7.3), 0.5, fade));',
          '    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.9);',
          '    float bright = mix(0.6 + 0.8 * cityHash(id * 1.31 + 2.0), 0.7, fade);',
          '    totalEmissiveRadiance += uWinColor * bright * win * on * uWinGlow;',
          '    totalEmissiveRadiance += uSky * 0.05 * win * (1.0 - on);',
          '  }',
          '  if (st > 7.5 && st < 8.5) diffuseColor.rgb *= 0.75 + 0.5 * cityHash(floor(vWP.xz * 0.7));',
          '}'
        ].join('\n'))
        .replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= 0.3;\n#include <aomap_fragment>');
    };
    return m;
  }
  static get HIDE_SLOTS() { return 16; }

  // 近景が出来上がったチャンクの一覧を遠景のシェーダーへ（その分の遠景の頂点を消す）
  setHidden(list) {
    const v = this.farMaterial.userData.uniforms.uHide.value;
    for (let i = 0; i < v.length; i++) {
      const c = list[i];
      if (c) v[i].set(c.cx, c.cz); else v[i].set(-100, -100);
    }
  }

  // ---------- 毎フレーム ----------
  // camera: 描画に使うカメラ（ワールド座標を読む）、player: 足元の位置 { x, z }（当たり判定のチャンクを読む）
  update(dt, cameraPos, player, time, forward) {
    if (player) this.updateNav(player.x, player.z);
    this.streamer.update(cameraPos, forward);
    this.props.update(cameraPos);
    this.landmarks.update(cameraPos);
    if (this.water) this.water.update(dt, cameraPos, time || 0, this._lakeMeshes);
  }

  // プレイヤーの周り navRadius チャンクを当たり判定に読む（データは streamer と共有のキャッシュ）。navRadius + 1 より遠いものは外す。
  //   navLead（{ x, z }。運転中・飛行中に game.js が先の位置を入れる）があればその周りも読む（速く走っても前の当たり判定がある）。
  //   navKeep（チャンクのキーの配列。setNavKeep。生きている敵のいるチャンク）は遠くても外さない
  //   navBudget（数。game.js が毎フレーム入れる: 歩き・車は render.city.navOpsWalk、ヘリ・戦闘機は navOpsPerFrame）: 1 回に進める仕事
  //   （チャンクの生成 1 つ / 当たり判定への追加 1 つ）の数。navMsCap（ms。歩き・車は navMsWalk）を超えたら次の仕事を始めない（少なくとも 1 つ）。
  //   足りない分は次のフレームへ（立っているチャンク → 周り → 先の順）。null なら全部すぐ読む（置き直しは loadNavNow）。
  //   立っているチャンク（want[0]）は予算に関係なく、いつも生成と追加を同じ呼び出しで（当たり判定の無いチャンクの上に立たない）
  updateNav(x, z) {
    const c = this.city.chunkOf(x, z), R = this.cfg.navRadius == null ? 1 : this.cfg.navRadius;
    const lead = this.navLead ? this.city.chunkOf(this.navLead.x, this.navLead.z) : null;
    const sig = c.cx + '_' + c.cz + (lead ? '|' + lead.cx + '_' + lead.cz : '') + '|' + (this._keepVer || 0);
    if (this._navSig === sig && !this._navPending) return;
    const budgeted = this.navBudget != null;
    const now = CityWorld.now, t0 = budgeted ? now() : 0;
    this._navSig = sig;
    this._navC = c;
    const own = c.cx + '_' + c.cz;
    const want = [];
    const addRing = (cc) => {
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const cx = cc.cx + dx, cz = cc.cz + dz;
        if (cx < 0 || cz < 0 || cx >= this.city.ncx || cz >= this.city.ncz) continue;
        want.push(cx + '_' + cz);
      }
    };
    addRing(c);
    if (lead && (lead.cx !== c.cx || lead.cz !== c.cz)) addRing(lead);
    const keep = this.navKeep || [];
    for (const k of keep) want.push(k);
    let ops = budgeted ? Math.max(1, this.navBudget) : Infinity, pending = false, done = 0, capped = false;
    const cap = budgeted && this.navMsCap > 0 ? this.navMsCap : Infinity;
    if (budgeted) {
      // 近い順（立っているチャンクが先）
      const d2 = (k) => { const p = k.split('_'); return Math.max(Math.abs(+p[0] - c.cx), Math.abs(+p[1] - c.cz)); };
      want.sort((a, b) => d2(a) - d2(b));
    }
    // 生成だけ済んで足していないチャンクの pin は、もう要らなければ外す（予算なしの置き直し = loadNavNow でも。以前は予算つきの時だけで、
    //   置き直しの前に歩きの予算で生成だけしたチャンクが、次にチャンクをまたぐまで pin されたまま当たり判定にも入らずに残っていた）
    if (this._navGen) for (const k of Array.from(this._navGen)) if (want.indexOf(k) < 0 && !this.nav.hasChunk(k)) { this.cache.unpin(k, 'navgen'); this._navGen.delete(k); }
    // 次の仕事を始めてよいか（立っているチャンクはいつも。ほかは数と時間の予算の中、少なくとも 1 つ）
    const may = (mine) => {
      if (mine || !budgeted) return true;
      if (ops <= 0) return false;
      if (done > 0 && now() - t0 >= cap) { capped = true; return false; }
      return true;
    };
    for (const key of want) {
      if (this.nav.hasChunk(key)) continue;
      const mine = key === own;
      if (!may(mine)) { pending = true; continue; }
      const p = key.split('_');
      const cached = this.cache.has(+p[0], +p[1]);
      const d = this.cache.full(+p[0], +p[1]);
      if (!d) continue;
      if (budgeted && !cached) {
        // 生成した: 当たり判定に足すのは次の仕事（それまで捨てられないよう pin）。立っているチャンクは続けてすぐ足す
        ops--; done++;
        if (!mine && !may(false)) {
          this.cache.pin(key, 'navgen');
          (this._navGen || (this._navGen = new Set())).add(key);
          pending = true;
          continue;
        }
      }
      this.nav.addChunk(key, d);
      this.navVer = (this.navVer || 0) + 1;
      this.cache.pin(key, 'nav');
      if (this._navGen && this._navGen.delete(key)) this.cache.unpin(key, 'navgen');
      ops--; done++;
    }
    this._navPending = pending;
    if (budgeted) {
      const ms = now() - t0, st = this.navStats || (this.navStats = { calls: 0, msMax: 0, msSum: 0, pendingFrames: 0, cappedFrames: 0, opsMax: 0 });
      st.calls++; st.msSum += ms; if (ms > st.msMax) st.msMax = ms; if (pending) st.pendingFrames++; if (capped) st.cappedFrames++; if (done > st.opsMax) st.opsMax = done;
      this.navMs = ms;
    }
    const far = (ch, cc) => Math.max(Math.abs(ch.cx - cc.cx), Math.abs(ch.cz - cc.cz)) > R + 1;
    for (const ch of Array.from(this.nav.chunks.values())) {
      if (far(ch, c) && (!lead || far(ch, lead)) && keep.indexOf(ch.key) < 0) { this.nav.removeChunk(ch.key); this.cache.unpin(ch.key, 'nav'); this.navVer = (this.navVer || 0) + 1; }
    }
  }

  // 置き直し（開始・復活・自由カメラから戻る・乗り物から降りる・テストの瞬間移動）: その場の当たり判定を今すぐ全部読む。
  //   先読みの位置と予算を消してから（前のフレームの車の先の位置を読まない・予算で残さない）。次のフレームの game._updateCity がまた入れる
  loadNavNow(x, z) {
    this.navLead = null; this.navBudget = null; this.navMsCap = null;
    this.updateNav(x, z);
  }

  // 遠くても当たり判定に残すチャンク（敵のいるチャンク）。同じなら何もしない
  setNavKeep(keys) {
    const a = (keys || []).slice().sort();
    const s = a.join(',');
    if (s === this._keepSig) return;
    this._keepSig = s;
    this.navKeep = a;
    this._keepVer = (this._keepVer || 0) + 1;
  }

  // GLB のランドマークが読めた: 代わりの箱を含む近景・遠景を作り直す
  onLandmarksLoaded(nodes) {
    if (this.streamer) this.streamer.invalidateLandmarks(nodes);
  }

  // 自動テスト・デバッグ用の数字
  info() {
    const s = this.streamer ? this.streamer.stats : {};
    return Object.assign({}, s, { geoLive: this.stats.live, geoCreated: this.stats.geoCreated, geoDisposed: this.stats.geoDisposed,
      cache: this.cache.size, cacheGenerated: this.cache.stats.generated, navChunks: this.nav.chunks.size, props: this.props.count, propsSource: this.propsSource, landmarks: this.landmarkSource });
  }

  dispose() {
    this.disposed = true;
    if (this.streamer) this.streamer.dispose();
    if (this.props) this.props.dispose();
    if (this.landmarks) this.landmarks.dispose();
    if (this.water) this.water.dispose();
    for (const m of this.meshes) { this.root.remove(m); this._release(m.geometry); }
    for (const m of this._lakeMeshes || []) { if (m.parent) m.parent.remove(m); this._release(m.geometry); }
    this.meshes = [];
    this.scene.remove(this.root);
    this.farMaterial.dispose();
    this.casterMaterial.dispose();
  }
};

// 街の小物（近景のチャンクの props を種類ごとの InstancedMesh で）。models/city_props.glb（+ props.glb の crate）が読めればその形、
// 読めるまで・無ければコードで作った簡単な形。木は treeDist まで GLB、その外（近景のチャンクの中）は低ポリの塊（遠景と同じ形）
MR.CityProps = class CityProps {
  static get TYPES() {
    return ['streetlight', 'traffic_signal', 'hydrant', 'newsstand', 'subway_entrance', 'trash_can', 'bench', 'planter', 'mailbox', 'phone_kiosk',
      'sidewalk_shed', 'water_tank', 'hvac_unit', 'taxi', 'sedan', 'jersey_barrier', 'tree', 'park_lamp', 'crate', 'crate_tall'];
  }

  constructor(world) {
    this.world = world;
    this.cfg = world.cfg;
    this.group = new THREE.Group();
    this.group.name = 'cityProps';
    world.root.add(this.group);
    this.kinds = {};       // type → { parts: [{ geo, mat }], meshes: [InstancedMesh], cap, n, castShadow }
    this.count = 0;
    this._pos = new THREE.Vector3(1e9, 0, 0);
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._own = [];        // コードで作った形・マテリアル（dispose 用）
    this._buildProcedural();
    // 遠い木の塊
    const bg = new MR.CityGeo({ uv: false, vcap: 8 });
    MR.CityWorld.treeBlob(bg, 0, 0, 0, 0, 1);
    this._blobGeo = bg.toGeometry();
    this._own.push(this._blobGeo);
    this._setKind('_blob', [{ geo: this._blobGeo, mat: world.mat('foliage') }], false);
    this.ready = (this.cfg.props === false) ? Promise.resolve(false) : this._load();
  }

  // GLB が無いときの形（箱の組み合わせ、頂点カラー）
  _buildProcedural() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.2 });
    mat.name = 'cityPropsProcedural';
    this._own.push(mat);
    const L = (h) => MR.srgb(h);
    const pole = L('#3b4046'), green = L('#2f5a3a'), red = L('#a52a20'), wood = L('#7a5a36'), conc = L('#9a968e'), lamp = L('#fff2c8');
    const B = { // [w, h, d, x, y, z, color]
      streetlight: [[0.18, 8.4, 0.18, 0, 0, 0, pole], [0.12, 0.12, 2.9, 0, 8.15, 1.45, pole], [0.45, 0.2, 0.8, 0, 8.05, 2.85, lamp]],
      traffic_signal: [[0.26, 7.05, 0.26, 0, 0, 0, pole], [0.14, 0.18, 6.8, 0, 6.15, 3.4, pole], [0.35, 1.0, 0.35, 0.17, 5.1, 3.7, L('#d8b030')], [0.35, 1.0, 0.35, 0.17, 5.2, 6.3, L('#d8b030')]],
      hydrant: [[0.4, 0.77, 0.4, 0, 0, 0, red]],
      newsstand: [[3.0, 2.45, 1.6, 0, 0, 0, green]],
      subway_entrance: [[3.2, 1.2, 0.08, 0, 0, -3, green], [0.08, 1.2, 6, -1.6, 0, 0, green], [0.08, 1.2, 6, 1.6, 0, 0, green]],
      trash_can: [[0.6, 0.89, 0.6, 0, 0, 0, green]],
      bench: [[1.84, 0.48, 0.55, 0, 0, 0, wood]],
      planter: [[1.28, 0.72, 1.28, 0, 0, 0, conc], [1.0, 0.7, 1.0, 0, 0.72, 0, L('#3f6a2c')]],
      mailbox: [[0.54, 1.16, 0.5, 0, 0, 0, L('#2a4f9a')]],
      phone_kiosk: [[0.96, 2.85, 0.4, 0, 0, 0, L('#4a4f55')]],
      sidewalk_shed: [[6, 0.2, 2.6, 0, 2.86, -1.15, L('#2f5a3a')], [0.1, 2.86, 0.1, -1.5, 0, 0, pole], [0.1, 2.86, 0.1, 1.5, 0, 0, pole], [0.1, 2.86, 0.1, -1.5, 0, -2.3, pole], [0.1, 2.86, 0.1, 1.5, 0, -2.3, pole]],
      water_tank: [[0.25, 2.84, 0.25, -1.55, 0, -1.55, pole], [0.25, 2.84, 0.25, 1.55, 0, -1.55, pole], [0.25, 2.84, 0.25, -1.55, 0, 1.55, pole], [0.25, 2.84, 0.25, 1.55, 0, 1.55, pole], [3.8, 3.76, 3.8, 0, 2.84, 0, wood], [2.6, 0.9, 2.6, 0, 6.6, 0, L('#3a3a3a')]],
      hvac_unit: [[2.2, 1.33, 1.4, 0, 0, 0, L('#8d9196')]],
      taxi: [[1.83, 0.85, 4.85, 0, 0.25, 0, L('#e8b923')], [1.6, 0.6, 2.4, 0, 1.1, -0.2, L('#c99c18')]],
      sedan: [[1.83, 0.85, 4.85, 0, 0.25, 0, L('#34465c')], [1.6, 0.55, 2.4, 0, 1.1, -0.2, L('#2a3848')]],
      jersey_barrier: [[3.0, 0.81, 0.6, 0, 0, 0, conc]],
      tree: [[0.32, 3.2, 0.32, 0, 0, 0, wood], [4.2, 3.6, 4.2, 0, 3.0, 0, L('#3a5a2a')]],
      park_lamp: [[0.16, 4.0, 0.16, 0, 0, 0, pole], [0.45, 0.45, 0.45, 0, 3.4, 0, lamp]],
      crate: [[1.2, 1.2, 1.2, 0, 0, 0, wood]],
      crate_tall: [[1.2, 1.2, 1.2, 0, 0, 0, wood], [1.2, 1.2, 1.2, 0, 1.25, 0, wood]]
    };
    for (const type of Object.keys(B)) {
      const g = new MR.CityGeo({ uv: false, col: true, vcap: 64 });
      for (const b of B[type]) {
        g.color(b[6]);
        const x0 = b[3] - b[0] / 2, x1 = b[3] + b[0] / 2, z0 = b[5] - b[2] / 2, z1 = b[5] + b[2] / 2;
        for (let f = 0; f < 5; f++) g.face(f, x0, b[4], z0, x1, b[4] + b[1], z1, 1, 1, 0);
      }
      const geo = g.toGeometry();
      this._own.push(geo);
      this._setKind(type, [{ geo, mat }], type !== 'tree');
    }
  }

  // 種類の形を差し替える（今の InstancedMesh は捨てて作り直す）
  _setKind(type, parts, castShadow) {
    const old = this.kinds[type];
    if (old) for (const m of old.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
    this.kinds[type] = { parts, meshes: [], cap: 0, n: 0, castShadow: castShadow !== false };
    this._dirty = true;
  }

  _load() {
    const world = this.world, assets = world.assets;
    if (!assets || typeof assets.resolve !== 'function' || typeof assets.loadModel !== 'function' || !THREE.GLTFLoader) return Promise.resolve(false);
    const jobs = [];
    const cityKey = assets.resolve('models/city_props.glb');
    if (cityKey) jobs.push(Promise.resolve(assets.loadModel(cityKey)).then((gltf) => this._applyGlb(gltf, CityProps.TYPES.filter((t) => t !== 'crate' && t !== 'crate_tall'))));
    // props.glb（デコード 約 66 MB）は箱（crate）のためだけなので、タッチ端末では読まない（render.city.mobile.propsGlbCrate: false。コードの箱）
    const propKey = this.cfg.propsGlbCrate === false ? null : assets.resolve(MR.World.PROPS_FILE);
    if (propKey) jobs.push(Promise.resolve(assets.loadModel(propKey)).then((gltf) => this._applyGlb(gltf, ['crate'])));
    return Promise.all(jobs.map((p) => p.catch((e) => { console.warn('[City] 小物の GLB を読めません。コードの形のまま:', e && e.message); return 0; })))
      .then((n) => { const ok = n.some((k) => k > 0); if (ok) world.propsSource = 'files'; return ok; });
  }

  _applyGlb(gltf, types) {
    if (this.world.disposed) return 0;
    const root = gltf && (gltf.scene || gltf);
    if (!root || !root.traverse) return 0;
    root.updateMatrixWorld(true);
    let n = 0;
    for (const type of types) {
      const node = MR.World.findNode(root, type);
      if (!node) continue;
      const parts = CityProps.extract(node, type === 'crate' ? 1.2 : 0);
      if (!parts.length) continue;
      for (const p of parts) this._tuneMaterial(p.mat);
      this._setKind(type, parts, type !== 'tree');
      if (type === 'crate') {
        // 2 段の木箱（2 段目は少し回す）
        const top = new THREE.Matrix4().makeRotationY(0.35).premultiply(new THREE.Matrix4().makeTranslation(0, 1.25, 0));
        const tall = parts.map((p) => ({ geo: p.geo, mat: p.mat })).concat(parts.map((p) => { const g = p.geo.clone(); g.applyMatrix4(top); this._own.push(g); return { geo: g, mat: p.mat }; }));
        this._setKind('crate_tall', tall, true);
      }
      n++;
    }
    return n;
  }

  // 発光（街灯・信号・売店）を夕暮れ用に強める。textureMax.glb より大きいアトラスは縮める（タッチ端末）
  _tuneMaterial(m) {
    if (!m || m.userData.mrCityTuned) return;
    m.userData.mrCityTuned = true;
    const tm = this.cfg.textureMax;
    if (tm) MR.CityWorld.limitTextures(m, tm.glb, tm.glbDetail || tm.glb, this._scaled || (this._scaled = new Map()));
    if (m.emissiveMap && typeof this.cfg.propEmissive === 'number') m.emissiveIntensity = this.cfg.propEmissive;
    if (this.world.materials && this.world.materials._applyAnisotropy) this.world.materials._applyAnisotropy(m);
  }

  // ノードの下のメッシュを「ノード原点・足元 y = 0」の形にまとめる。height > 0 なら高さを合わせる（props.glb の crate）
  static extract(node, height) {
    const wp = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    const inv = new THREE.Matrix4().makeTranslation(-wp.x, -wp.y, -wp.z);
    const parts = [];
    const bbox = new THREE.Box3();
    node.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const piece of MR.World.splitByGroups(o.geometry, mats.length)) {
        const geo = piece.geometry;
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        if (!geo.attributes.normal) geo.computeVertexNormals();
        MR.World.ensureUv2(geo);
        geo.computeBoundingBox();
        bbox.union(geo.boundingBox);
        parts.push({ geo, mat: mats[Math.min(piece.materialIndex, mats.length - 1)] });
      }
    });
    if (height > 0 && parts.length) {
      const size = bbox.getSize(new THREE.Vector3());
      const s = size.y > 1e-6 && Math.abs(height / size.y - 1) > 0.15 ? height / size.y : 1;
      const m = new THREE.Matrix4().makeScale(s, s, s).premultiply(new THREE.Matrix4().makeTranslation(0, -bbox.min.y * s, 0));
      for (const p of parts) p.geo.applyMatrix4(m);
    }
    for (const p of parts) p.geo.computeBoundingSphere();
    return parts;
  }

  markDirty() { this._dirty = true; }

  // 近景のチャンクの小物から、カメラの近くのものだけを並べる（4 m 動くか、チャンクが増減したとき）
  update(cam) {
    const streamer = this.world.streamer;
    if (!streamer) return;
    if (!this._dirty && this._pos.distanceToSquared(cam) < 16) return;
    this._dirty = false;
    this._pos.copy(cam);
    const P = this.cfg.propDist, T = this.cfg.treeDist, P2 = P * P, T2 = T * T;
    const lists = {};
    for (const k of Object.keys(this.kinds)) lists[k] = [];
    let total = 0;
    for (const rec of streamer.full.values()) {
      if (rec.state !== 'built' || !rec.out) continue;
      for (const p of rec.out.props) {
        const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
        if (p.type === 'tree') { (d2 < T2 ? lists.tree : lists._blob).push(p); total++; continue; }
        if (d2 > P2 || !lists[p.type]) continue;
        lists[p.type].push(p);
        total++;
      }
    }
    this.count = total;
    for (const type of Object.keys(this.kinds)) this._fill(type, lists[type] || []);
  }

  _fill(type, list) {
    const k = this.kinds[type];
    const n = list.length;
    if (n > k.cap || (k.cap > 64 && n < k.cap / 4)) {
      // 古いインスタンスと「形の見かけ」（属性は共有。dispose で GPU のバッファが消えても次に使うときに作り直される）
      for (const m of k.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
      k.meshes = [];
      k.cap = Math.max(16, Math.ceil(n * 1.5));
      for (const part of k.parts) {
        const view = new THREE.BufferGeometry(); // 形の属性は共有（境界の球だけ自分の）
        for (const a of Object.keys(part.geo.attributes)) view.setAttribute(a, part.geo.attributes[a]);
        view.setIndex(part.geo.index);
        view.boundingSphere = new THREE.Sphere();
        const m = new THREE.InstancedMesh(view, part.mat, k.cap);
        m.name = 'prop:' + type;
        m.castShadow = k.castShadow;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.count = 0;
        this.group.add(m);
        k.meshes.push(m);
      }
    }
    k.n = n;
    if (!k.meshes.length) return;
    // 境界の球: 置いた位置の範囲 + 形の大きさ
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const mtx = this._m;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      this._q.setFromAxisAngle(this._up, p.rot || 0);
      this._p.set(p.x, p.y, p.z);
      mtx.compose(this._p, this._q, this._s);
      for (const m of k.meshes) m.setMatrixAt(i, mtx);
    }
    for (let j = 0; j < k.meshes.length; j++) {
      const m = k.meshes[j];
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.visible = n > 0;
      if (n > 0) {
        const r0 = k.parts[j].geo.boundingSphere ? k.parts[j].geo.boundingSphere.radius + k.parts[j].geo.boundingSphere.center.length() : 10;
        const c = m.geometry.boundingSphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        m.geometry.boundingSphere.radius = Math.hypot(maxX - c.x, maxY - c.y, maxZ - c.z) + r0;
      }
    }
  }

  dispose() {
    for (const k of Object.values(this.kinds)) for (const m of k.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
    for (const o of this._own) if (o && o.dispose) o.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
};

// ランドマークの GLB（landmarks.glb / landmarks2.glb のノードを landmarkPlacements() の位置に clone）。全部で 19 個なので常に置き、
// 視錐台の外は three が描かない。読めたノードは world.lmLoaded に入れ、代わりの箱（lm 付き）を作り直しで消す
MR.CityLandmarks = class CityLandmarks {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'cityLandmarks';
    world.root.add(this.group);
    this.placed = [];
    this.ready = world.cfg.landmarks === false ? Promise.resolve(false) : this._load();
  }
  static get NO_SHADOW() { return { gct_chandelier: true, gct_info_booth: true, ferry_boat: true, tugboat: true }; }
  // 小さいもの・室内のものは近いときだけ出す（m）。テクスチャを GPU に上げるのも近づいてから
  static get NEAR_ONLY() { return { gct_chandelier: 150, gct_info_booth: 200, ferry_boat: 900, tugboat: 900, heliport_pad: 900 }; }
  update(cam) {
    for (const o of this.placed) {
      const n = o.userData.near;
      if (!n) continue;
      const dx = o.position.x - cam.x, dy = o.position.y - cam.y, dz = o.position.z - cam.z;
      o.visible = dx * dx + dy * dy + dz * dz < n * n;
    }
  }
  _load() {
    const world = this.world, assets = world.assets;
    if (!assets || typeof assets.resolve !== 'function' || typeof assets.loadModel !== 'function' || !THREE.GLTFLoader) return Promise.resolve(false);
    const placements = world.city.landmarkPlacements();
    const jobs = ['landmarks', 'landmarks2'].map((file) => {
      const key = assets.resolve('models/' + file + '.glb');
      if (!key) return Promise.resolve([]);
      return Promise.resolve(assets.loadModel(key)).then((gltf) => {
        if (world.disposed) return [];
        const root = gltf && (gltf.scene || gltf);
        const loaded = [];
        for (const p of placements) {
          if (p.glb !== file) continue;
          const node = root && root.getObjectByName(p.node);
          if (!node) continue;
          const obj = node.clone();
          obj.position.set(p.x, p.y, p.z);
          obj.rotation.set(0, p.yaw || 0, 0);
          const tm = world.cfg.textureMax;
          obj.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = !CityLandmarks.NO_SHADOW[p.node];
            o.receiveShadow = true;
            if (o.geometry) MR.World.ensureUv2(o.geometry);
            if (tm) for (const m of Array.isArray(o.material) ? o.material : [o.material]) MR.CityWorld.limitTextures(m, tm.glb, tm.glbDetail || tm.glb, this._scaled || (this._scaled = new Map()));
          });
          obj.userData.near = CityLandmarks.NEAR_ONLY[p.node] || 0;
          obj.updateMatrixWorld(true);
          obj.matrixAutoUpdate = false;
          this.group.add(obj);
          this.placed.push(obj);
          loaded.push(p.node);
        }
        return loaded;
      }).catch((e) => { console.warn('[City] ' + file + '.glb を読めません。箱のまま:', e && e.message); return []; });
    });
    return Promise.all(jobs).then((lists) => {
      const nodes = {};
      for (const l of lists) for (const n of l) nodes[n] = true;
      if (nodes.bridge_truss && nodes.bridge_tower) nodes.bridge = true;
      const names = Object.keys(nodes);
      if (!names.length) return false;
      for (const n of names) world.lmLoaded[n] = true;
      world.landmarkSource = 'files';
      world.onLandmarksLoaded(names);
      return true;
    });
  }
  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.placed = [];
  }
};
