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
//   ランドマーク（landmarks.glb / landmarks2.glb / skyhigh.glb / boats.glb の停泊中の船）: landmarkPlacements() の位置に clone。読めたノードの代わりの箱（citygen の lm 付き）は消す:
//     近景・LOD・スカイラインは代わりの箱をいつもメッシュの後ろの部分（lm セグメント、名前の順）に書き、読めたものは cutSegments で描かない
//     （インデックスの並べ替えだけ。作り直さない）。近景・LOD・スカイラインの頂点は格子に丸める（CityGeo の q）ので、同じデータからは
//     いつも同じ配列（prebaked-city: 前もって作った形を読めばバイトまで同じ）。
window.MR = window.MR || {};

// 1 つのマテリアル分の頂点を貯める（必要に応じて倍に広げる）。toGeometry() でちょうどの長さの BufferGeometry にする。
//   opts: { uv: true（テクスチャ用）, col: false（頂点カラー Uint8）, info: false（遠景の aInfo Uint8 × 4）,
//           q: false（格子に丸める: 位置は 1/256 m、uv は 1/1024。街の近景・LOD・スカイライン（buildFull / buildLod / buildSkyline）だけ）}
//   q: 丸めた値は f32 でちょうど表せる（|x| < 2^24 / 256 = 65 km）。同じデータからは端末・エンジンによらず同じバイト列になり、
//   前もって作った形（prebaked-city の far.bin / パック）を格子の整数で持てば、読んだ形と実行時に作った形がバイトまで同じになる。
//   見た目の差は 2 mm 以下（−0 は +0 になる）。地面（_buildStatic）・小物（CityProps）は丸めない
MR.CityGeo = class CityGeo {
  constructor(opts) {
    opts = opts || {};
    this.q = !!opts.q;
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
    // 組み立てが付ける情報（ここで全部作っておく: 後から付けると形（V8 の hidden class）が何種類にも分かれ、v() / face() のプロパティの
    //   読み書きが遅くなった = スカイラインの組み立てが 1.5 倍）。sides: ランドマークの部品の横の CityGeo（lm → CityGeo）
    this.mat = null; this.grp = null; this.opts = null; this.sides = null; this.sx = 0; this.sz = 0;
    // 追加の頂点属性（plan nyc-cinematic §5.3 / §13: aFac / aFac2 / aTop / aAo。Uint8 / Uint16 だけ、float32 にしない）:
    //   opts.attrs = { 名前: { size, type: Uint8Array | Uint16Array, normalized } }。今の値は setAttr(名前, [..]) で、v() がその値を書く
    this.extra = null;
    if (opts.attrs) {
      this.extra = [];
      for (const name of Object.keys(opts.attrs)) {
        const a = opts.attrs[name], T = a.type || Uint8Array, size = a.size || 1;
        this.extra.push({ name, size, T, normalized: !!a.normalized, cur: new T(size), arr: new T(this.vcap * size) });
      }
    }
    // 片（建物の部品）ごとの範囲（index の start, count, gid, piece）。opts.ranges のときだけ。toGeometry で geometry.userData.pieces（Uint32Array）
    this.ranges = opts.ranges ? [] : null;
  }
  setAttr(name, vals) {
    if (!this.extra) return;
    for (const e of this.extra) if (e.name === name) { for (let i = 0; i < e.size; i++) e.cur[i] = vals[i] || 0; return; }
  }
  // 片 1 つ分の範囲を覚える（start = 書き始めの ni）
  range(start, gid, piece) {
    if (!this.ranges || this.ni <= start) return;
    this.ranges.push(start, this.ni - start, gid >>> 0, piece >>> 0);
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
      if (this.extra) for (const e of this.extra) e.arr = grow(e.arr, e.size);
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
  // 頂点 1 つ（法線は -1..1）。q なら格子に丸める: (x·256 + 2^52·1.5) − 2^52·1.5 は IEEE の倍精度の決まりで x·256 を一番近い整数に
  //   丸める（偶数丸め。JS の数はどのエンジンでも IEEE の倍精度なので端末と Node で同じ。−0 にならない。Math.round の半分くらいの時間）。
  //   × 1/256（2 のべき）はちょうど。|x·1024| < 2^51 の範囲で正しい
  v(x, y, z, nx, ny, nz, u, w) {
    if (this.q) {
      x = ((x * 256 + 6755399441055744) - 6755399441055744) * 0.00390625;
      y = ((y * 256 + 6755399441055744) - 6755399441055744) * 0.00390625;
      z = ((z * 256 + 6755399441055744) - 6755399441055744) * 0.00390625;
      if (this.hasUv) { u = ((u * 1024 + 6755399441055744) - 6755399441055744) * 0.0009765625; w = ((w * 1024 + 6755399441055744) - 6755399441055744) * 0.0009765625; }
    }
    return this._w(x, y, z, Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127), u, w);
  }
  // 頂点 1 つをそのまま書く（位置・uv は丸め済み、法線は −127..127 の整数）
  _w(x, y, z, n0, n1, n2, u, w) {
    const k = this.nv++;
    const p = k * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.nrm[p] = n0; this.nrm[p + 1] = n1; this.nrm[p + 2] = n2;
    if (this.hasUv) { this.uv[k * 2] = u; this.uv[k * 2 + 1] = w; }
    if (this.hasCol) { this.col[p] = this.r; this.col[p + 1] = this.g; this.col[p + 2] = this.b; }
    if (this.hasInfo) { const q = k * 4; this.inf[q] = this.i0; this.inf[q + 1] = this.i1; this.inf[q + 2] = this.i2; this.inf[q + 3] = this.i3; }
    if (this.extra) for (const e of this.extra) { const q = k * e.size; for (let i = 0; i < e.size; i++) e.arr[q + i] = e.cur[i]; }
    return k;
  }
  // 最後の n 個の頂点の法線を半分の長さに（向きは同じ。天気の濡れる材質はこの面を濡らさない = 屋根の下の床。materials.js の vWetOn）
  markDry(n) { for (let k = this.nv - n; k < this.nv; k++) { const p = k * 3; this.nrm[p] = this.nrm[p] >> 1; this.nrm[p + 1] = this.nrm[p + 1] >> 1; this.nrm[p + 2] = this.nrm[p + 2] >> 1; } }
  quad(a, b, c, d) { const i = this.ni; this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; this.idx[i + 3] = a; this.idx[i + 4] = c; this.idx[i + 5] = d; this.ni += 6; }
  tri(a, b, c) { const i = this.ni; this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; this.ni += 3; }
  get empty() { return this.ni === 0; }

  // 軸平行の箱の面 f（0 +X, 1 −X, 2 +Z, 3 −Z, 4 +Y, 5 −Y）。側面の U は面の右向きの世界座標 / tu、V = (y − vb) / tv。
  // 上面 U = x / tu, V = −z / tv、下面 U = x, V = z
  //   面の 4 頂点は 6 つの座標と 2 つずつの u・v から出来るので、丸めはそれぞれ 1 回（v() を 4 回呼ぶ場合の半分。法線も整数で書く）。
  //   値は v() で 1 頂点ずつ書いたものと同じ（uv は丸める前の座標から）
  face(f, x0, y0, z0, x1, y1, z1, tu, tv, vb) {
    this.reserve(4, 6);
    const iu = tu ? 1 / tu : 1, iv = tv ? 1 / tv : 1;
    let ua, ub, wa, wb; // この面の 2 つの U と 2 つの V
    switch (f) {
      case 0: ua = -z1 * iu; ub = -z0 * iu; wa = (y0 - vb) * iv; wb = (y1 - vb) * iv; break;
      case 1: ua = z0 * iu; ub = z1 * iu; wa = (y0 - vb) * iv; wb = (y1 - vb) * iv; break;
      case 2: ua = x0 * iu; ub = x1 * iu; wa = (y0 - vb) * iv; wb = (y1 - vb) * iv; break;
      case 3: ua = -x1 * iu; ub = -x0 * iu; wa = (y0 - vb) * iv; wb = (y1 - vb) * iv; break;
      case 4: ua = x0 * iu; ub = x1 * iu; wa = -z1 * iv; wb = -z0 * iv; break;
      default: ua = x0 * iu; ub = x1 * iu; wa = z0 * iv; wb = z1 * iv; break;
    }
    if (this.q) { // v() と同じ丸め
      const M = 6755399441055744, P = 0.00390625;
      x0 = ((x0 * 256 + M) - M) * P; y0 = ((y0 * 256 + M) - M) * P; z0 = ((z0 * 256 + M) - M) * P;
      x1 = ((x1 * 256 + M) - M) * P; y1 = ((y1 * 256 + M) - M) * P; z1 = ((z1 * 256 + M) - M) * P;
      if (this.hasUv) {
        const U = 0.0009765625;
        ua = ((ua * 1024 + M) - M) * U; ub = ((ub * 1024 + M) - M) * U; wa = ((wa * 1024 + M) - M) * U; wb = ((wb * 1024 + M) - M) * U;
      }
    }
    let a, b, c, d;
    switch (f) {
      case 0: a = this._w(x1, y0, z1, 127, 0, 0, ua, wa); b = this._w(x1, y0, z0, 127, 0, 0, ub, wa); c = this._w(x1, y1, z0, 127, 0, 0, ub, wb); d = this._w(x1, y1, z1, 127, 0, 0, ua, wb); break;
      case 1: a = this._w(x0, y0, z0, -127, 0, 0, ua, wa); b = this._w(x0, y0, z1, -127, 0, 0, ub, wa); c = this._w(x0, y1, z1, -127, 0, 0, ub, wb); d = this._w(x0, y1, z0, -127, 0, 0, ua, wb); break;
      case 2: a = this._w(x0, y0, z1, 0, 0, 127, ua, wa); b = this._w(x1, y0, z1, 0, 0, 127, ub, wa); c = this._w(x1, y1, z1, 0, 0, 127, ub, wb); d = this._w(x0, y1, z1, 0, 0, 127, ua, wb); break;
      case 3: a = this._w(x1, y0, z0, 0, 0, -127, ua, wa); b = this._w(x0, y0, z0, 0, 0, -127, ub, wa); c = this._w(x0, y1, z0, 0, 0, -127, ub, wb); d = this._w(x1, y1, z0, 0, 0, -127, ua, wb); break;
      case 4: a = this._w(x0, y1, z1, 0, 127, 0, ua, wa); b = this._w(x1, y1, z1, 0, 127, 0, ub, wa); c = this._w(x1, y1, z0, 0, 127, 0, ub, wb); d = this._w(x0, y1, z0, 0, 127, 0, ua, wb); break;
      default: a = this._w(x0, y0, z0, 0, -127, 0, ua, wa); b = this._w(x1, y0, z0, 0, -127, 0, ub, wa); c = this._w(x1, y0, z1, 0, -127, 0, ub, wb); d = this._w(x0, y0, z1, 0, -127, 0, ua, wb); break;
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
  // ちょうどの長さの BufferGeometry（uv2 = uv の共有）。
  //   sides: [[ランドマーク名, CityGeo], …]（名前の順）があれば、この形の後ろに順に足して geometry.userData.segs = [[名前, v0, nv, i0, ni], …]
  //   （頂点・インデックスの範囲。CityWorld.cutSegments が GLB の読めたランドマークの部分を描かないようにする）
  toGeometry(sides) {
    let nv = this.nv, ni = this.ni;
    if (sides) for (const sd of sides) { nv += sd[1].nv; ni += sd[1].ni; }
    const cat = (key, k) => { // この形の配列 + 横の形の配列を 1 本に
      const a = this[key];
      if (!sides || !sides.length) return a.slice(0, this.nv * k);
      const b = new a.constructor(nv * k);
      b.set(a.subarray(0, this.nv * k));
      let o = this.nv * k;
      for (const sd of sides) { const g = sd[1]; b.set(g[key].subarray(0, g.nv * k), o); o += g.nv * k; }
      return b;
    };
    const attrs = [{ name: 'position', itemSize: 3, array: cat('pos', 3) }, { name: 'normal', itemSize: 3, normalized: true, array: cat('nrm', 3) }];
    if (this.hasUv) attrs.push({ name: 'uv', itemSize: 2, array: cat('uv', 2) });
    if (this.hasCol) attrs.push({ name: 'color', itemSize: 3, normalized: true, array: cat('col', 3) });
    if (this.hasInfo) attrs.push({ name: 'aInfo', itemSize: 4, normalized: false, array: cat('inf', 4) });
    // 追加の頂点属性（opts.attrs。v2 の街）: 横の形に同じ名前の属性が無ければ 0
    if (this.extra) for (let j = 0; j < this.extra.length; j++) {
      const e = this.extra[j], k = e.size;
      let arr;
      if (!sides || !sides.length) arr = e.arr.slice(0, this.nv * k);
      else {
        arr = new e.T(nv * k); arr.set(e.arr.subarray(0, this.nv * k));
        let o = this.nv * k;
        for (const sd of sides) { const g = sd[1], ge = g.extra && g.extra[j] && g.extra[j].name === e.name ? g.extra[j] : null; if (ge) arr.set(ge.arr.subarray(0, g.nv * k), o); o += g.nv * k; }
      }
      attrs.push({ name: e.name, itemSize: k, normalized: e.normalized, array: arr });
    }
    const idx = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
    for (let i = 0; i < this.ni; i++) idx[i] = this.idx[i];
    let segs = null, segBox = null, bounds = null;
    if (sides && sides.length) {
      segs = [];
      let vo = this.nv, io = this.ni;
      for (const sd of sides) {
        const g = sd[1];
        for (let i = 0; i < g.ni; i++) idx[io + i] = g.idx[i] + vo;
        segs.push([sd[0], vo, g.nv, io, g.ni]);
        vo += g.nv; io += g.ni;
      }
      // 部分ごとの箱（ほかの部分、segs の順）。cutSegments は切った後の境界をこれから作る（頂点をなめない）。全体の箱 = これの和
      segBox = CityGeo.partBoxes(attrs[0].array, segs);
      bounds = { box: CityGeo.unionBox(segBox, null) };
    }
    const geo = CityGeo.geometry({ attrs, idx, nv, ni, bounds });
    if (segs) { geo.userData.segs = segs; geo.userData.segBox = segBox; }
    // 片ごとの範囲（opts.ranges。v2 の街）: 横の形の分は index の位置をずらして後ろに
    if (this.ranges) {
      let r = this.ranges;
      if (sides && sides.length) {
        r = r.slice();
        let io = this.ni;
        for (const sd of sides) { const g = sd[1]; if (g.ranges) for (let i = 0; i < g.ranges.length; i += 4) r.push(g.ranges[i] + io, g.ranges[i + 1], g.ranges[i + 2], g.ranges[i + 3]); io += g.ni; }
      }
      if (r.length) geo.userData.pieces = Uint32Array.from(r);
    }
    return geo;
  }
  // 位置の配列 pos（x, y, z の並び）の、ほかの部分 [0, segs[0].v0) と各 seg の頂点の範囲ごとの箱と半径を 1 本の配列に（部分ごとに
  //   x0, y0, z0, x1, y1, z1, r。r = 箱の中心から一番遠い頂点までの距離。頂点の無い部分は +∞ / −∞ と 0）。Box3.setFromBufferAttribute /
  //   computeBoundingSphere と同じ計算なので、箱の和は全体の箱とちょうど同じ、部分が 1 つなら球もちょうど同じ
  static partBoxes(pos, segs) {
    const n = segs.length + 1, out = new Array(n * 7);
    for (let k = 0; k < n; k++) {
      const a = k === 0 ? 0 : segs[k - 1][1], b = k === 0 ? segs[0][1] : segs[k - 1][1] + segs[k - 1][2];
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = a; i < b; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
        if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
      let r2 = 0;
      const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5, cz = (z0 + z1) * 0.5;
      for (let i = a; i < b; i++) { const dx = cx - pos[i * 3], dy = cy - pos[i * 3 + 1], dz = cz - pos[i * 3 + 2]; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
      const o = k * 7;
      out[o] = x0; out[o + 1] = y0; out[o + 2] = z0; out[o + 3] = x1; out[o + 4] = y1; out[o + 5] = z1; out[o + 6] = Math.sqrt(r2);
    }
    return out;
  }
  // partBoxes の和（mask: segs ごとに '1' = 除く。null = 全部）→ [x0, y0, z0, x1, y1, z1]（何も無ければ x0 > x1）
  static unionBox(pb, mask) {
    const u = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k * 7 < pb.length; k++) {
      if (k > 0 && mask && mask[k - 1] === '1') continue;
      for (let j = 0; j < 3; j++) { if (pb[k * 7 + j] < u[j]) u[j] = pb[k * 7 + j]; if (pb[k * 7 + 3 + j] > u[3 + j]) u[3 + j] = pb[k * 7 + 3 + j]; }
    }
    return u;
  }
  // 箱の和 u の中心からの球の半径（mask の部分を除く）: 部分ごとの「その中心までの距離 + その半径」の最大と、箱の対角線の半分の小さい方。
  //   描く頂点をみな含む（大きめでよい）。描く部分が 1 つで箱の和がその部分の箱なら computeBoundingSphere とちょうど同じ
  static unionRadius(pb, mask, u) {
    const cx = (u[0] + u[3]) * 0.5, cy = (u[1] + u[4]) * 0.5, cz = (u[2] + u[5]) * 0.5;
    let r = 0;
    for (let k = 0; k * 7 < pb.length; k++) {
      if (k > 0 && mask && mask[k - 1] === '1') continue;
      const o = k * 7;
      if (!(pb[o] <= pb[o + 3])) continue; // 頂点の無い部分
      const dx = cx - (pb[o] + pb[o + 3]) * 0.5, dy = cy - (pb[o + 1] + pb[o + 4]) * 0.5, dz = cz - (pb[o + 2] + pb[o + 5]) * 0.5;
      r = Math.max(r, (dx || dy || dz ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0) + pb[o + 6]);
    }
    const hx = u[3] - u[0], hy = u[4] - u[1], hz = u[5] - u[2];
    return Math.min(r, Math.sqrt(hx * hx + hy * hy + hz * hz) * 0.5);
  }
  // 配列から BufferGeometry を作る（toGeometry と、前もって作った形を読んだもの（prebaked-city）が同じ作り方になるように 1 つに）。
  //   o: { attrs: [{ name, itemSize, normalized, array }]（array はちょうど nv × itemSize の長さ。'uv' は 'uv2' にも共有）,
  //        idx（ni 個。型が nv で決まる型（65536 未満は Uint16）でなければ写す）, nv, ni,
  //        bounds?: { box?: [x0, y0, z0, x1, y1, z1], sphere?: [x, y, z, r] }（あるものは計算しない）}
  static geometry(o) {
    const g = new THREE.BufferGeometry(), nv = o.nv, ni = o.ni;
    for (const a of o.attrs) {
      const arr = a.array.length === nv * a.itemSize ? a.array : a.array.slice(0, nv * a.itemSize);
      const at = new THREE.BufferAttribute(arr, a.itemSize, !!a.normalized);
      g.setAttribute(a.name, at);
      if (a.name === 'uv') g.setAttribute('uv2', at); // aoMap 用（同じ属性を共有）
    }
    const Ix = nv < 65536 ? Uint16Array : Uint32Array;
    let idx = o.idx;
    if (!(idx instanceof Ix) || idx.length !== ni) { const b = new Ix(ni); for (let i = 0; i < ni; i++) b[i] = idx[i]; idx = b; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const b = o.bounds && o.bounds.box, sp = o.bounds && o.bounds.sphere;
    if (sp) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(sp[0], sp[1], sp[2]), sp[3]);
    else g.computeBoundingSphere();
    if (b) g.boundingBox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
    else g.computeBoundingBox();
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
      landmarkFar: 600,                // 遠景のノード（<名前>_far。skyhigh.glb）のあるランドマークは、カメラからこの m より遠いとそちらを描く
      // landmarkNight: 夜の光の強さと航空障害灯（landmark_night.js の DEFAULTS。game.json に points がある）
      // 高さ（カメラの y）ごとの霧と描画距離。間は補間
      altitude: [
        { y: 0, near: 0.15, far: 2200, fogNear: 250, fogFar: 1300 },
        { y: 60, near: 0.3, far: 2800, fogNear: 350, fogFar: 1900 },
        { y: 160, near: 0.6, far: 4000, fogNear: 500, fogFar: 3000 },
        { y: 600, near: 2.0, far: 7500, fogNear: 1000, fogFar: 7000 }
      ],
      shadowRadius: 60, shadowDistance: 500, shadowFar: 1100, shadowNormalBias: 0.12, // 影の外形（光の側の面）と同じ高さの外壁・屋上に影が乗らないように
      hemiIntensity: 1.0, landSpecular: 0.2,
      wetLandCell: 256,                // 天気のあるゲームの陸を切る格子（m）。陸は大きな三角形 44 個で、深度の精度が 5〜20 cm しかなく、4.5 cm 上の静的な
                                       // 地面（ハドソンヤードの砂利）の上に濡れた陸が透けていた。0 で切らない
      textureMax: null,                // テクスチャの最大辺 { albedo, normal, orm, emissive, interior, glb, glbDetail }（GPU メモリを抑える。
                                       // PC は法線・ORM・発光だけ、タッチ端末はアルベドも）
      bake: null                       // 前もって作った遠景（far.bin）の設定 render.city.bake（+ タッチ端末は render.city.mobile.bake）。
                                       // 既定値は MR.CityBake.DEFAULTS（citybake.js）。config() が組み立てる
    };
  }

  // ?prism=exact|degraded（URL）か opts.prismMode。どちらも無ければ null（= plan の engine.prismMode）
  static prismMode(opts) {
    let m = null;
    try { const q = /[?&]prism=(exact|degraded)\b/.exec((typeof location !== 'undefined' && location.search) || ''); if (q) m = q[1]; } catch (e) { m = null; }
    return m || (opts && opts.prismMode) || null;
  }
  static config(rs) {
    const base = Object.assign({}, CityWorld.DEFAULTS, (rs && rs.city) || {});
    const touch = !!(MR.isTouchDevice && MR.isTouchDevice());
    if (touch && rs && rs.city && rs.city.mobile) Object.assign(base, rs.city.mobile);
    base.bake = MR.CityBake ? MR.CityBake.config(rs) : null; // mobile.bake は丸ごとではなく bake の上に重ねる
    if (rs && rs.kit === false) base.kit = false; // hq3d の見た目（render.kit。?kit=0 は MR.ViewArms.kitOn が見る）
    // 街の細かい物（hq3d Q3。render.city.cityKit）: 端末のクラス（MR.Cine）が classes に入るときだけ（iPhone は ASTC の後）
    const ck = base.cityKit;
    base.cityKitOn = false;
    if (ck && ck.enabled !== false && base.kit !== false && MR.CityKit && (!MR.ViewArms || MR.ViewArms.kitOn(base))) {
      let cls = 'desktop';
      try { if (MR.Cine && typeof navigator !== 'undefined' && typeof screen !== 'undefined') cls = MR.Cine.classify(MR.Cine.envInfo(navigator, screen, window), { render: rs }).cls; } catch (e) { cls = touch ? 'phone' : 'desktop'; }
      // ?citykit=1 = iPad のクラスとして出す、?citykit=0 = 街の細かい物だけ消す（Q3 の見比べ。木の板などは残す）
      try { const m = /[?&]citykit=(\w+)/.exec((window.location && window.location.search) || ''); if (m) cls = m[1] === '1' ? 'tablet' : m[1] === '0' ? 'off' : m[1]; } catch (e) { /* Node */ }
      base.cityKitClass = cls;
      if ((cls === 'phone' || cls === 'phonePlus' || cls === 'low') && ck.phone) base.cityKit = Object.assign({}, ck, ck.phone);
      base.cityKitOn = (ck.classes || ['tablet', 'tabletPro', 'desktop']).indexOf(cls) >= 0;
    }
    return base;
  }

  // scene, level（midtown.json / manhattan.json）, rs（render 設定。rs.city を読む）
  // opts: { materials, assets, renderer, city（無ければ MR.CityGen.create で作る）, cache（MR.CityChunkCache。無ければ作る）,
  //         core（manhattan: core.bin を NycData.decodeCore したもの）, tiles（manhattan: MR.NycTiles.fromAssets。main.js が用意する）,
  //         bake（MR.CityBake。このレベルの前もって作った遠景（midtown だけ）。main.js が作り、ゲームをまたいで残る。ワールドは数だけ渡す）}
  //   v2 の街（city.version === 2、plan nyc-r1-r3）: 地面は core の LAND − WATR と PARK を 512 m のタイルごとに（_buildStaticV2）。
  //   近景の柱（chunkFull().prisms）は _fullPrism、遠景の柱（skyline().groups[].prisms・chunkLod().prisms）は _farPrism、影は chunkLod の柱
  //         weather（天気のあるゲーム: 水を WEATHER で作る・外の地面（ext のグループの WET_GROUND の材質と陸・静的な地面）は
  //         materials.getWet の濡れる材質・遠景は uWet（上向きの面を暗く）。無ければ今までと同じ材質・プログラム）
  constructor(scene, level, rs, opts) {
    opts = opts || {};
    this.scene = scene;
    this.weather = !!opts.weather;
    this.level = level;
    this.rs = rs || {};
    this.cfg = CityWorld.config(this.rs);
    this.assets = opts.assets || null;
    this.renderer = opts.renderer || null;
    this.disposed = false;
    const t0 = CityWorld.now();
    // rail（v2 の街だけ。R4 のフック 1 = MR.Underground（NC5: テストの空洞）。無ければ今までと同じ）
    this.city = opts.city || (MR.CityGen.create ? MR.CityGen.create(level, Object.assign({ core: opts.core || null, tiles: opts.tiles || null }, opts.rail ? { rail: opts.rail } : null)) : new MR.CityGen(level));
    this.timings = { cityGen: CityWorld.now() - t0 };
    // 前もって作った遠景（far.bin）: 使える設定で、このレベルのものだけ。skyline() のデータを CityGen に入れる（起動時の約 100 ms を省く）
    const bk = opts.bake, bc = this.cfg.bake;
    this.bake = bk && bk.usable && (!bc || bc.enabled !== false) && this.city.version !== 2 ? bk : null; // v2 の街（manhattan）には far.bin が無い
    this.timings.skySeeded = this.bake ? this.bake.seedCity(this.city) : false;
    if (this.bake) this.bake.acquire(); // 街のワールドがある間に far.bin が開いても、このワールドが作ったスカイラインと 2 つ持たない（数だけ）
    this._camPrev = null;
    this.cache = opts.cache || new MR.CityChunkCache(this.city, { cap: this.cfg.cacheChunks });
    this.materials = opts.materials || MR.World.createMaterials(this.assets, this.renderer, this.rs, level);
    if (this.materials && typeof this.cfg.windowEmissive === 'number') this.materials.windowEmissive = this.cfg.windowEmissive;
    // 当たり判定の柱の作り方（plan nyc-r1-r3 §3.2）: ?prism=degraded（非常用: 柱の代わりにサーバーの内側の箱 degradedBoxes）> opts > plan の engine.prismMode
    const prism = CityWorld.prismMode(opts);
    this.nav = MR.Nav3D.fromCity(this.city, null, null, 0, prism ? { prismMode: prism } : undefined);
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
    const wu = this.weather && this.materials && this.materials.wetUniforms ? this.materials.wetUniforms : null;
    this.farMaterial = CityWorld.makeFarMaterial(this.cfg, wu ? wu.uWet : null, wu ? wu.uWetFar : null);
    // 外壁の材質（MR.Facade。v2 の柱と v1（midtown）の箱。?facade=0 / render.city.facade.enabled: false で今まで通りのテクスチャの壁）
    this.facade = null; this.facadeMat = null;
    if (MR.Facade && MR.Facade.enabled(this.cfg, this.city)) {
      const tf = CityWorld.now();
      this.facade = MR.Facade.material(this.materials, this.rs.textures !== false ? this.assets : null);
      MR.Facade.configure(this.facade, this.cfg);
      this.facadeMat = this.facade.material;
      if (this.city.version === 2) MR.Facade.table(this.city); // gid → 建物の数（core の片を 1 回なめる。最初のチャンクの組み立ての 1 歩に入れない）
      this.timings.facade = CityWorld.now() - tf;
    }
    this.casterMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.casterMaterial.name = 'cityShadowCaster';
    this.casterMaterial.shadowSide = THREE.FrontSide; // 影は光に向いた面で（箱の中が日なたにならない。buildFull の caster を参照）
    const t1 = CityWorld.now();
    this._buildStatic();
    this.timings.static = CityWorld.now() - t1;
    if (this.cfg.warmMaterials !== false) this.timings.materials = this.warmMaterials();
    this.water = (this.cfg.water !== false && MR.Water) ? new MR.Water(scene, { city: this.city, assets: this.assets, useFiles: this.rs.textures !== false, shoreRes: this.cfg.shoreRes, weather: this.weather }) : null;
    this.props = new MR.CityProps(this);
    this.landmarks = new MR.CityLandmarks(this);
    this.streamer = new MR.Streamer(this, this.cfg);
    // 建物の中の家具（interiors.js / interiors_view.js）。opts.interiors = { json, player, levelId } のときだけ
    this.furnVer = 0;
    const io = opts.interiors;
    this.furn = io && io.json && MR.Interiors && MR.Interiors.Manager ? new MR.Interiors.Manager(this, io.json, io) : null;
    this.furnCalm = false; // 復活のフレーム（game.js）: 予算の家具の仕事をしない
    this.shipInside = null; // 家具が無いときの船の部屋（update。look.js が読む）
    this.shipRoomTest = null; // 動く船の部屋（cityboats: (cam) → 印 | null）
    this.furnView = this.furn && MR.InteriorsView ? new MR.InteriorsView(this, Object.assign({}, this.cfg.interiors || {}, io.view || {})) : null;
    // 入口の自動ドア（doors.js。見た目だけ）。opts.doors = city.doors（+ levelId・view）のときだけ。doorAgents は game.js が毎フレーム入れる
    const dop = opts.doors;
    this.doors = dop && MR.Doors && MR.Interiors ? new MR.Doors.Manager(this, dop) : null;
    this.doorsView = this.doors && MR.DoorsView ? new MR.DoorsView(this, dop.view || {}) : null;
    this.doorAgents = null;
    this.propsReady = Promise.all([this.props.ready, this.landmarks.ready]).then(() => true, () => false);
  }

  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // 外壁の材質のプログラムを街の始めに作る（最初に外壁が見えたフレームで止まらない）。シーンの見えている光 + 外壁の小さな代わりの形だけで
  //   renderer.compile（光の数・霧・環境マップはプログラムのキーに入るので同じシーンで。weather_view.js の precompile と同じ形）。rt: 描く先（composer の readBuffer）
  precompileFacade(renderer, camera, rt) {
    if (!this.facadeMat || !renderer || typeof renderer.compile !== 'function' || this._facadeCompiled) return false;
    this._facadeCompiled = true;
    const g = new MR.CityGeo({ vcap: 4, attrs: MR.Facade.ATTRS });
    MR.Facade.setAttrs(g, { layout: 2, seed: 1, groundH: 4, storey: 3.2, base: 0, top: 10, rgb: [128, 80, 60], dirt: 0 }, 2.3, 1, false);
    g.face(2, 0, 0, 0, 1, 1, 1, 1, 1, 0);
    const geo = g.toGeometry(), mesh = new THREE.Mesh(geo, this.facadeMat);
    mesh.frustumCulled = false;
    const sc = this.scene, kids = sc.children, lights = [];
    sc.traverseVisible((o) => { if (o.isLight) lights.push(o); });
    const prevRT = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const t0 = CityWorld.now();
    try {
      if (rt && typeof renderer.setRenderTarget === 'function') renderer.setRenderTarget(rt);
      sc.children = lights.concat([mesh]);
      renderer.compile(sc, camera);
    } catch (e) { console.warn('[Facade] precompile', e && e.message); }
    sc.children = kids;
    if (rt && typeof renderer.setRenderTarget === 'function') renderer.setRenderTarget(prevRT);
    geo.dispose();
    this.timings.facadeCompile = CityWorld.now() - t0;
    return true;
  }

  // ---------- 形の数の記録（メモリが増え続けないかの確認用）----------
  _track(geo) { if (!geo || this._liveGeos.has(geo)) return geo; this._liveGeos.add(geo); this.stats.geoCreated++; this.stats.live = this._liveGeos.size; return geo; }
  _release(geo) { if (!geo) return; geo.dispose(); if (this._liveGeos.delete(geo)) { this.stats.geoDisposed++; this.stats.live = this._liveGeos.size; } }

  mat(name) { return this.materials.get(name); }
  // 天気: 濡れる外の地面の材質（ext のグループだけ。室内（int）・壁は濡らさない。stair_stone（階段室の踊り場）と concrete（空母の格納庫の床・
  //   建物の殻）は室内にも使うので入れない。新しい外の地面の材質は室内で使わないときだけ足す）
  static get WET_GROUND() {
    return { asphalt_city: 1, asphalt_patch: 1, sidewalk: 1, curb: 1, manhole: 1, road: 1, ground: 1, gravel_roof: 1, carrier_deck: 1, roadPaint: 1 };
  }
  // 外の地面の材質（天気のあるゲームでは濡れる版）
  groundMat(name) {
    const m = this.materials.get(name);
    return this.weather && CityWorld.WET_GROUND[name] && typeof this.materials.getWet === 'function' ? this.materials.getWet(name) : m;
  }

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
    const rail = !!(this.city && this.city.rail); // 地下の駅の材質（DEFS の under）は駅のある街だけ（ほかの街はテクスチャを読まない = NC6）
    // 外壁の材質のあるときは窓のテクスチャの材質（brick_* / glass_tower / office_stone / *_win）を作らない（近景は使わない = 画像も GPU も持たない。
    //   ほかで要れば get したときに読む）
    const skip = this.facade && MR.Facade.WINDOWED ? MR.Facade.WINDOWED : null;
    for (const n of Object.keys(D).filter((k) => D[k].city && (!D[k].under || rail) && !(skip && skip[k])).concat(CityWorld.WARM_EXTRA)) {
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
    if (this.city.version === 2) { this._buildStaticV2(); return; }
    const city = this.city, mini = city.minimap();
    const bnd = mini.bounds;
    const geos = {};
    const G = (name) => geos[name] || (geos[name] = new MR.CityGeo({ vcap: 4096 }));
    const shapeOf = (poly, holes) => {
      const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1])));
      for (const h of holes || []) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], -p[1]))));
      return s;
    };
    // 形（ShapeGeometry、xy 平面）を y の高さの水平な面として書く。cell > 0 なら三角形を cell m の格子で切る（深度の精度。wetLandCell）
    const writeShape = (g, shape, y, tu, tv, cell) => {
      const sg = new THREE.ShapeGeometry(shape, 1);
      const pos = sg.attributes.position, idx = sg.index;
      if (cell > 0) {
        const n = idx ? idx.count : pos.count, at = (k) => (idx ? idx.getX(k) : k);
        for (let k = 0; k < n; k += 3) CityWorld._clipTri(g, [pos.getX(at(k)), -pos.getY(at(k)), pos.getX(at(k + 1)), -pos.getY(at(k + 1)), pos.getX(at(k + 2)), -pos.getY(at(k + 2))], y, tu, tv, cell);
        sg.dispose();
        return;
      }
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
      // 天気のあるゲームでは陸を格子で切る（濡れた陸が上の静的な地面に透けない。天気の無いゲームは今まで通りの 44 個の三角形）
      writeShape(G('land'), shapeOf(poly, holes), 0, at.u, at.v, this.weather ? this.cfg.wetLandCell : 0);
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
    // 静的な地面（公園の芝・歩道・小道・操車場の砂利）。セントラルパークの芝の上に重なるので少し上。
    //   天気: 濡れる材質の矩形は、静的な屋根の下（staticItems.shelters = ハドソンヤードの人工地盤の下の操車場）を濡らさない（_wetSplit）
    const shel = this.weather && city.staticItems.shelters && city.staticItems.shelters.length ? city.staticItems.shelters : null;
    for (const g of city.staticItems.ground) {
      const t = this.tile(g.mat), y = g.mat === 'grass' ? 0.03 : 0.045;
      if (shel && CityWorld.WET_GROUND[g.mat]) CityWorld._wetSplit(G(g.mat), g.x0, y, g.z0, g.x1, y, g.z1, t.u, t.v, shel, true);
      else G(g.mat).flat([[g.x0, g.z0], [g.x1, g.z0], [g.x1, g.z1], [g.x0, g.z1]], y, t.u, t.v);
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
      else mat = this.groundMat(name);
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

  // ---------- v2 の街（manhattan）の地面: core の LAND − WATR（陸。内陸の水は穴）・護岸・PARK（芝・広場）・内陸の水面 ----------
  //   多角形はタイル（nyc.json の tile = 512 m）の矩形で切ってから三角形にし（R4 のフック 6: タイルごとに穴を開ける）、メッシュは
  //   render.city.groundGroup m の区画 × 材質ごとにまとめる（既定 0 = 地図全体で材質ごとに 1 つ。下の GS）。
  //   内陸の水（WATR のうち全部の頂点が LAND の中のもの: 湖・貯水池・池）は陸と公園の穴、水面は water.js の材質（_lakeMeshes）、岸は rock の壁。
  //   歩道・広場の板（CBLK）・路面（CDEC）はタイルの近景（buildFull）が上に重ねる
  _buildStaticV2() {
    const city = this.city, core = city.core, ND = MR.NycData;
    this._lakeMeshes = [];
    if (!core || !core.land || !ND) return;
    const t0 = CityWorld.now();
    const meta = city.meta || {};
    const T = meta.tile || core.tile || 512;
    // メッシュの区画（render.city.groundGroup m。0 = 地図全体で材質ごとに 1 つ）。地面は全部で 6 万三角形ほどなので、区画に分けて視錐台で
    //   外すより、まとめて描く方がドローコールが少ない（1024 m の区画だと 78 区画 × 5 材質 = 330 メッシュ、通りから 30〜60 回）
    const GS = this.cfg.groundGroup > 0 ? Math.max(T, this.cfg.groundGroup) : Math.max(city.maxX - city.minX, city.maxZ - city.minZ) + T;
    const X0 = city.minX, Z0 = city.minZ;
    const geos = new Map();
    const G = (x, z, mat) => {
      const gx = Math.floor((x - X0) / GS), gz = Math.floor((z - Z0) / GS), k = gx + '_' + gz + '|' + mat;
      let g = geos.get(k);
      if (!g) { g = new MR.CityGeo({ vcap: 4096 }); g.mat = mat; g.key = gx + '_' + gz; geos.set(k, g); }
      return g;
    };
    const ringOf = (b, k) => b.xz.subarray(b.vertStart[k] * 2, b.vertStart[k + 1] * 2);
    const bbOf = (r) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) { const x = r[i], z = r[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      return [x0, z0, x1, z1];
    };
    // Sutherland–Hodgman で矩形 R = [x0, z0, x1, z1] に切る（平たい配列 [x, z, …] → 同じ形。3 点未満なら null）
    const clip = (r, R) => {
      let cur = Array.from(r);
      for (let e = 0; e < 4 && cur.length >= 6; e++) {
        const out = [], n = cur.length / 2;
        const inside = (x, z) => (e === 0 ? x >= R[0] : e === 1 ? x <= R[2] : e === 2 ? z >= R[1] : z <= R[3]);
        for (let i = 0; i < n; i++) {
          const ax = cur[i * 2], az = cur[i * 2 + 1], j = (i + 1) % n, bx = cur[j * 2], bz = cur[j * 2 + 1];
          const ai = inside(ax, az), bi = inside(bx, bz);
          if (ai) out.push(ax, az);
          if (ai !== bi) {
            const t = e < 2 ? ((e === 0 ? R[0] : R[2]) - ax) / (bx - ax) : ((e === 2 ? R[1] : R[3]) - az) / (bz - az);
            out.push(ax + (bx - ax) * t, az + (bz - az) * t);
          }
        }
        cur = out;
      }
      return cur.length >= 6 ? cur : null;
    };
    const area = (r) => { let a = 0; const n = r.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; } return a / 2; };
    // 水平な多角形（外周 + 穴、平たい配列）を y の高さで書く（上から見て表。UV = 世界 xz / tile。v1 の writeShape と同じ向き）
    const V2 = THREE.Vector2, SU = THREE.ShapeUtils;
    const writePoly = (g, outer, holes, y, tu, tv) => {
      const c = [];
      for (let i = 0; i < outer.length; i += 2) c.push(new V2(outer[i], -outer[i + 1]));
      if (SU.isClockWise(c)) c.reverse();
      const hs = [];
      for (const h of holes) {
        const v = [];
        for (let i = 0; i < h.length; i += 2) v.push(new V2(h[i], -h[i + 1]));
        if (!SU.isClockWise(v)) v.reverse();
        hs.push(v);
      }
      const faces = SU.triangulateShape(c, hs);
      if (!faces.length) return;
      const all = c.concat(...hs);
      g.reserve(all.length, faces.length * 3);
      const base = g.nv;
      for (const p of all) g.v(p.x, y, -p.y, 0, 1, 0, p.x / tu, p.y / tv);
      for (const f of faces) g.tri(base + f[0], base + f[1], base + f[2]);
    };
    // 多角形ブロックの i 番（外周 + 自分の穴 + extra の穴）をタイルの矩形ごとに切って書く
    const emit = (b, i, extra, y, mat) => {
      const k0 = b.ringStart[i], k1 = b.ringStart[i + 1];
      const outer = ringOf(b, k0), bb = bbOf(outer);
      const holes = [];
      for (let k = k0 + 1; k < k1; k++) holes.push(ringOf(b, k));
      for (const h of extra || []) holes.push(h);
      const t = this.tile(mat === 'land' ? 'asphalt_city' : mat);
      const tx0 = Math.floor((bb[0] - X0) / T), tx1 = Math.floor((bb[2] - X0 - 1e-6) / T);
      const tz0 = Math.floor((bb[1] - Z0) / T), tz1 = Math.floor((bb[3] - Z0 - 1e-6) / T);
      const whole = tx0 === tx1 && tz0 === tz1;
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
        const R = [X0 + tx * T, Z0 + tz * T, X0 + (tx + 1) * T, Z0 + (tz + 1) * T];
        const o = whole ? Array.from(outer) : clip(outer, R);
        if (!o || Math.abs(area(o)) < 0.5) continue;
        const hs = [];
        for (const h of holes) {
          const hb = bbOf(h);
          if (hb[2] < R[0] || hb[0] > R[2] || hb[3] < R[1] || hb[1] > R[3]) continue;
          const c = whole ? Array.from(h) : clip(h, R);
          if (c && Math.abs(area(c)) >= 0.5) hs.push(c);
        }
        writePoly(G((R[0] + R[2]) / 2, (R[1] + R[3]) / 2, mat), o, hs, y, t.u, t.v);
      }
    };
    // 内陸の水（外周の頂点が全部 LAND の中）。陸・公園の穴と、水面・岸の壁
    const W = core.water, lakes = [];
    if (W) {
      for (let j = 0; j < W.count; j++) {
        const r = ringOf(W, W.ringStart[j]);
        let inl = r.length >= 6;
        for (let v = 0; inl && v < r.length; v += 2) if (!core.isLand(r[v], r[v + 1])) inl = false;
        if (inl) lakes.push({ i: j, ring: r, bb: bbOf(r), y: W.y[j], bed: W.bed[j] });
      }
    }
    const lakesIn = (b, i) => {
      const out = [], bb = bbOf(ringOf(b, b.ringStart[i]));
      for (const l of lakes) {
        const x = l.ring[0], z = l.ring[1];
        if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
        if (ND.pointIn(b, i, x, z)) out.push(l.ring);
      }
      return out;
    };
    const tLand = CityWorld.now();
    // 陸（アスファルト）と護岸（陸の縁から川底まで、外向き）
    const L = core.land, bedY = city.bedY == null ? -8 : city.bedY;
    const ct = this.tile('concrete');
    const onBound = (ax, az, bx, bz) => (Math.abs(ax - bx) < 0.01 && (Math.abs(ax - city.minX) < 0.01 || Math.abs(ax - city.maxX) < 0.01)) ||
      (Math.abs(az - bz) < 0.01 && (Math.abs(az - city.minZ) < 0.01 || Math.abs(az - city.maxZ) < 0.01));
    // トンネルの口の掘割（v2: city.groundHoles。nyc-complete NC3）は陸の穴（掘割の床と壁は近景が描く）
    const cuts = typeof city.groundHoles === 'function' ? city.groundHoles() : [];
    const cutsIn = (i) => cuts.filter((r) => ND.pointIn(L, i, r[0], r[1]));
    for (let i = 0; i < L.count; i++) {
      emit(L, i, cuts.length ? lakesIn(L, i).concat(cutsIn(i)) : lakesIn(L, i), 0, 'land');
      for (let k = L.ringStart[i]; k < L.ringStart[i + 1]; k++) {
        const r = ringOf(L, k), n = r.length / 2;
        for (let v = 0; v < n; v++) {
          const w = (v + 1) % n, ax = r[v * 2], az = r[v * 2 + 1], bx = r[w * 2], bz = r[w * 2 + 1];
          const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
          if (len < 0.5 || onBound(ax, az, bx, bz)) continue;
          let nx = dz / len, nz = -dx / len;
          if (core.isLand((ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }
          CityWorld.wall(G((ax + bx) / 2, (az + bz) / 2, 'seawall'), [ax, az], [bx, bz], 0, bedY, nx, nz, ct.u, ct.v);
        }
      }
    }
    const tPark = CityWorld.now();
    // 公園（芝）と広場（歩道の舗装）。種類は nyc.json の enums.areaKind の名前
    const P = core.parks;
    if (P && P.count) {
      const names = (meta.enums && meta.enums.areaKind) || [];
      const GREEN = { park: 1, grass: 1, garden: 1, pitch: 1, cemetery: 1, wood: 1, wetland: 1, golf: 1, dog_park: 1, scrub: 1, zoo: 1, flowerbed: 1 };
      const PAVED = { plaza: 1, pedestrian: 1 };
      for (let i = 0; i < P.count; i++) {
        const nm = names[P.kind[i]] || '';
        const mat = GREEN[nm] ? 'grass' : (PAVED[nm] ? 'sidewalk' : null);
        if (!mat) continue;
        const r = ringOf(P, P.ringStart[i]), bb = bbOf(r);
        if (!core.isLand((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2) && !core.isLand(r[0], r[1])) continue; // 水の上（桟橋の外）は描かない
        emit(P, i, mat === 'grass' ? lakesIn(P, i) : null, mat === 'grass' ? 0.03 : 0.012, mat);
      }
    }
    const tLake = CityWorld.now();
    // 内陸の水面（区画ごとに 1 つ。頂点の y = 水面）と岸の壁
    const rt = this.tile('rock'), lakeGeo = new Map();
    for (const l of lakes) {
      const key = Math.floor(((l.bb[0] + l.bb[2]) / 2 - X0) / GS) + '_' + Math.floor(((l.bb[1] + l.bb[3]) / 2 - Z0) / GS);
      let g = lakeGeo.get(key);
      if (!g) { g = new MR.CityGeo({ vcap: 256 }); lakeGeo.set(key, g); }
      writePoly(g, Array.from(l.ring), [], l.y, 8, 8);
      const r = l.ring, n = r.length / 2;
      for (let v = 0; v < n; v++) {
        const w = (v + 1) % n, ax = r[v * 2], az = r[v * 2 + 1], bx = r[w * 2], bz = r[w * 2 + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        let nx = dz / len, nz = -dx / len;
        if (!ND.pointIn(W, l.i, (ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; } // 水の側を向く
        CityWorld.wall(G((ax + bx) / 2, (az + bz) / 2, 'lakewall'), [ax, az], [bx, bz], 0, l.bed, nx, nz, rt.u || 2, rt.v || 2);
      }
    }
    const tMesh = CityWorld.now();
    for (const g of geos.values()) {
      if (g.empty) continue;
      let mat;
      if (g.mat === 'land') mat = this._landMaterial();
      else if (g.mat === 'seawall') mat = this.mat('concrete');
      else if (g.mat === 'lakewall') mat = this.mat('rock');
      else mat = this.mat(g.mat);
      const mesh = new THREE.Mesh(this._track(g.toGeometry()), mat);
      mesh.name = 'city:' + g.mat + ':' + g.key;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    if (MR.Water) {
      for (const [key, g] of lakeGeo) {
        if (g.empty) continue;
        const mesh = new THREE.Mesh(this._track(g.toGeometry()), null);
        mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        mesh.name = 'city:lake:' + key;
        this._lakeMeshes.push(mesh);
      }
    }
    const t1 = CityWorld.now(), r1 = (v) => Math.round(v * 10) / 10;
    this.timings.staticV2 = { ms: t1 - t0, lakesFind: r1(tLand - t0), land: r1(tPark - tLand), parks: r1(tLake - tPark), lakes: r1(tMesh - tLake), meshes: r1(t1 - tMesh), count: this.meshes.length, lakeCount: lakes.length, group: GS };
  }

  // 陸のアスファルト: 上に重なる面（車線・芝・歩道）より奥に描く（polygonOffset で押し下げる）。
  // 低い太陽に向かって遠くを見ると、粗い面でも直接光の鏡面反射（グレア）で道が白く光るので、鏡面反射を弱める（landSpecular）
  _landMaterial() {
    if (this._landMat) return this._landMat;
    // 天気のあるゲームは別の材質（extra の wet で別のキャッシュ）に濡れた見た目（'wet|land'）。天気の無いゲームの材質・プログラムは今までのまま
    const wet = this.weather && typeof MR.Materials.addWet === 'function';
    const m = this.materials.get('asphalt_city', wet ? { roughness: 1, wet: 'land' } : { roughness: 1 });
    // 傾きに比例する分（factor）は使わない: 高い所から斜めに見ると 2 m 下の水面より奥へ押してしまい、道路に水が透ける
    m.polygonOffset = true; m.polygonOffsetFactor = 0; m.polygonOffsetUnits = 4;
    const k = this.cfg.landSpecular == null ? 0.2 : this.cfg.landSpecular;
    const spec = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= ' + k.toFixed(3) + ';\n#include <aomap_fragment>');
    };
    if (wet) { if (!m.userData.mrWet) MR.Materials.addWet(m, this.materials.wetUniforms, 'land', spec); }
    else m.onBeforeCompile = spec;
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
    // 'mat|grp' → CityGeo（最初に触った順 = メッシュの順）。ランドマークの部品（lm 付きの箱・スロープ）は、その材質の CityGeo の横の
    //   CityGeo（g.sides: lm → CityGeo）へ。メッシュにするときに名前の順に後ろへ足して segs を付ける（toGeometry）。lm の部品だけの材質でも
    //   順番はここで決まる。GLB が読めているか（lmLoaded）は書くときには見ない（いつも全部書いて、最後に cutSegments で描かない）
    const bufs = new Map();
    const B = (mat, grp, opts, lm) => {
      const k = mat + '|' + grp;
      let g = bufs.get(k);
      if (!g) { const o = opts || { vcap: 2048, ranges: true }; g = new MR.CityGeo(Object.assign({ q: true }, o)); g.mat = mat; g.grp = grp; g.opts = o; bufs.set(k, g); }
      if (!lm) return g;
      const sides = g.sides || (g.sides = new Map());
      let sg = sides.get(lm);
      if (!sg) { sg = new MR.CityGeo(Object.assign({}, g.opts || {}, { vcap: 256, q: true })); sides.set(lm, sg); }
      return sg;
    };
    // 天気: 屋根の下の地面は濡らさない。入れる建物・ロビー・GCT の 1 階の床（building の矩形。街区の歩道の箱の上面がそのまま床）と、
    //   building の外の屋根の下（shelter。y = 屋根の下面より低い面だけ: 駐車場のキャノピー・歩道の仮囲い・屋上の階段室の中・給水タンクの下・
    //   ハドソンヤードの人工地盤の下の線路の砂利）。
    //   隣のチャンクが持つ区画もこのチャンクの歩道にかかるので、周りの 3 × 3 を集める（roofedNear: かかる区画だけ生成 = 平均 0.1 ms・p99 0.5 ms）
    //   チャンクの箱はチャンクの外へはみ出す（長い屋根のスラブ・歩道）ので、周りの分は箱の外接矩形にかかるものを集める
    let dry = null;
    if (this.weather && this.city && typeof this.city.roofedNear === 'function') {
      const cr = this.city.chunkRect(cx, cz), area = [cr[0], cr[1], cr[2], cr[3]];
      for (const b of data.boxes) {
        const hw = b.w / 2, hd = b.d / 2;
        if (b.x - hw < area[0]) area[0] = b.x - hw; if (b.x + hw > area[2]) area[2] = b.x + hw;
        if (b.z - hd < area[1]) area[1] = b.z - hd; if (b.z + hd > area[3]) area[3] = b.z + hd;
      }
      dry = (data.buildings || []).concat(data.shelters || [], this.city.roofedNear(cx, cz, false, area));
      if (now() - ts > slice) { yield 'dry'; ts = now(); }
    }
    const boxes = data.boxes;
    for (let i = 0; i < boxes.length; i++) {
      this._fullBox(boxes[i], B, dry);
      if ((i + 1) % nBox === 0 || ((i + 1) % nCheck === 0 && now() - ts > slice)) { yield 'boxes'; ts = now(); }
    }
    // v2 の街: 柱（片・台・橋の床）。重さは辺の数（箱 1 つ ≈ 6 面）: 辺 nBox × 6 本ごとに yield、nCheck 本ごとに時間を見る
    const prisms = data.prisms;
    if (prisms && prisms.length) {
      let work = 0, chk = 0;
      for (let i = 0; i < prisms.length; i++) {
        const p = prisms[i];
        this._fullPrism(p, B);
        const e = (p.ring.length >> 1) + 2;
        work += e; chk += e;
        if (work >= nBox * 6 || (chk >= nCheck * 6 && now() - ts > slice)) { yield 'prisms'; ts = now(); work = 0; chk = 0; }
        else if (chk >= nCheck * 6) chk = 0;
      }
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
      this._decal(data.decals[i], B, dry);
      if ((i + 1) % nItem === 0 || now() - ts > slice) { yield 'decals'; ts = now(); }
    }
    // 影を落とす外形（chunkLod の箱。透明で、影のパスにだけ効く）。ここでは書くだけ（BufferGeometry は下で、別の歩）
    let casterBuf = null;
    if (this.cfg.shadowCasters !== false) {
      if (now() - ts > slice) { yield 'decals'; ts = now(); }
      const lod = this.cache.lod(cx, cz);
      if (lod && (lod.boxes.length || (lod.prisms && lod.prisms.length))) {
        const g0 = new MR.CityGeo({ uv: false, vcap: lod.boxes.length * 24 + 64, q: true });
        // v2: chunkLod の柱（E 外形をチャンクで切ったもの）の壁 + 上面 + 下面（歩道・広場の台と地面の薄い板は除く）。柱に lm は無い
        for (const p of lod.prisms || []) {
          if (p.cat === 'sidewalk' || p.cat === 'plaza' || (p.lm && this.lmLoaded[p.lm])) continue;
          if (!p.top && p.y1 - p.y0 < 0.6 && p.y0 < 1) continue;
          const fan = CityWorld.convexFan(p);
          CityWorld.prismWalls(g0, p, 1, 1, 0);
          CityWorld.prismCap(g0, p, true, 1, 1, fan);
          CityWorld.prismCap(g0, p, false, 1, 1, fan);
        }
        for (const b of lod.boxes) {
          if (b.cat === 'sidewalk' || (b.h < 0.6 && b.y < 1)) continue; // 縁石・地面の薄い板は影に効かない（屋根のスラブは残す）
          let g = g0;
          if (b.lm) { // ランドマークの部品は横の CityGeo へ（近景のメッシュと同じ）
            const sides = g0.sides || (g0.sides = new Map());
            g = sides.get(b.lm);
            if (!g) { g = new MR.CityGeo({ uv: false, vcap: 48, q: true }); sides.set(b.lm, g); }
          }
          // 光の側の面で影を落とす（casterMaterial.shadowSide = FrontSide）。建物の中（階段室・コンコース）は外形の内側なので影になる
          // （three の既定の裏の面だと、閉じた箱の中の点は「裏の面より手前」= 日なたになっていた）。同じ高さの見た目の外壁・屋上に
          // 影が乗らないよう、街では太陽の shadow.normalBias を大きくしている（game.js、render.city.shadowNormalBias）
          const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
          for (let f = 0; f < 6; f++) g.face(f, x0, y0, z0, x1, y1, z1, 1, 1, 0);
        }
        // 船の中の部屋（city.shipRooms: 空母の艦橋など）: 部屋の箱を壁の中まで広げて影を落とす（GLB の殻は裏の面で影を落とすので、閉じた殻の中が日なたになる）
        const rooms = this.city.shipRooms;
        if (rooms) for (const r of rooms) {
          const c = this.city.chunkOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
          if (c.cx !== cx || c.cz !== cz) continue;
          // 上の面は天井のスラブの中（外に出た屋根の面と同じ深さにしない = 屋根に影の縞が出ない）
          for (let f = 0; f < 6; f++) g0.face(f, r.x0 - 0.15, r.y0 - 0.15, r.z0 - 0.15, r.x1 + 0.15, r.y1 - 0.15, r.z1 + 0.15, 1, 1, 0);
        }
        if (!g0.empty || g0.sides) casterBuf = g0;
      }
      yield 'caster';
      ts = now();
    }
    // メッシュにする（作った形は ctx.geos に入れておく）。1 つ作る前に、この歩がもう目安を超えていれば次の歩へ
    const root = new THREE.Group();
    root.name = 'chunk:' + data.key;
    root.matrixAutoUpdate = false;
    const ext = new THREE.Group(), int = new THREE.Group(), under = new THREE.Group();
    ext.matrixAutoUpdate = false; int.matrixAutoUpdate = false; under.matrixAutoUpdate = false;
    under.name = 'under';
    root.add(ext, int, under);
    for (const g of bufs.values()) {
      const sides = CityWorld.sortedSides(g);
      if (g.empty && !sides) continue;
      if (now() - ts > slice) { yield 'mesh'; ts = now(); }
      // マテリアルはふつう前もって作ってある（warmMaterials / warmStep）。まだで Canvas のテクスチャが要るものは、ここで少しずつ作る
      if (this._warmQueue && this._warmQueue.length) { yield* this._prepareMat(g.mat, slice); ts = now(); }
      const t1 = now(), mat = g.mat === 'cityFacade' ? this.facadeMat : this.weather && g.grp === 'ext' ? this.groundMat(g.mat) : this.mat(g.mat);
      if (now() - t1 > slice) { yield 'mat'; ts = now(); }
      if (!mat) continue;
      const geo = this._track(g.toGeometry(sides));
      ctx.geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = g.mat + '@' + g.grp;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      (g.grp === 'int' ? int : g.grp === 'under' ? under : ext).add(mesh);
    }
    let casterGeo = null;
    if (casterBuf) {
      if (now() - ts > slice) { yield 'mesh'; ts = now(); }
      casterGeo = this._track(casterBuf.toGeometry(CityWorld.sortedSides(casterBuf)));
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
    // GLB で見えているランドマークの部品を描かない（作り始めた後に読めたものも。ここは最後の歩なので、この後に読めたものは
    //   streamer.invalidateLandmarks が切る）
    this._cutObject(root);
    root.updateMatrixWorld(true);
    return { key: data.key, cx, cz, root, ext, int, under, caster, geos: ctx.geos, props: data.props, rect: this.city.chunkRect(cx, cz) };
  }

  // 箱 1 つ。材質の選び方:
  //   入れない建物の外壁（exterior で SHELL でない）と大きなランドマークの石・コンクリート → 窓のある *_win（office_stone の色違い）
  //   上面: mt があればその材質（屋上の砂利）、下面: 床・屋根のスラブは天井（plaster_interior）
  //   歩道（街区の縁石の箱）: 上面 sidewalk、側面 curb
  //   小物の当たりの箱（cat prop）は小物（CityProps）が見た目を受け持つので描かない（mt 付きの植え込みと、GLB が無いランドマークの部品は描く）
  //   lm（GLB のランドマークの代わりの部品）は B の横の CityGeo へ（buildFull を参照。lmLoaded は見ない）
  // dry: 天気のあるゲームで濡らさない矩形（building { x0, z0, x1, z1 } は歩道の上面だけ、shelter { …, y } は y より低い濡れる上面。_wetSplit）
  _fullBox(b, B, dry) {
    const SHELL = 16;
    if (b.cat === 'prop' && !b.mt && !b.lm) return;
    const lm = b.lm || null;
    let mat = b.mat;
    const shell = (b.f & SHELL) !== 0;
    if ((mat === 'limestone' || mat === 'concrete') && !shell && ((b.cat === 'exterior') || (b.cat === 'landmark' && b.h >= 12 && Math.min(b.w, b.d) >= 6))) mat = mat === 'limestone' ? 'limestone_win' : 'concrete_win';
    if (!this.materials.has(mat)) mat = 'concrete';
    const grp = (b.cat === 'interior') ? 'int' : (b.cat === 'under' ? 'under' : 'ext'); // under: R4 のフック 11（地下の構造。3 つ目のグループ）
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
    if (b.cat === 'sidewalk') {
      const st = this.tile('sidewalk'), cu = this.tile('curb');
      const g = B('sidewalk', 'ext', null, lm);
      if (dry && dry.length) CityWorld._wetSplit(g, x0, y0, z0, x1, y1, z1, st.u, st.v, dry, true);
      else g.face(4, x0, y0, z0, x1, y1, z1, st.u, st.v, 0);
      const c = B('curb', 'ext', null, lm);
      for (let f = 0; f < 4; f++) c.face(f, x0, y0, z0, x1, y1, z1, cu.u, cu.v, y0);
      return;
    }
    // 外壁の材質（MR.Facade。buildings-hq B3）: 窓のテクスチャの外壁（段・パラペット・ランドマークの石）は全部の面をこの材質の 1 つの CityGeo へ
    //   （三角形は同じ face()。UV は tile 1 = 世界座標の m、頂点属性に区画の窓割り・色。上面・下面は窓なし）。mt の上面・床の下面の天井は今まで通り
    if (this.facade && grp === 'ext' && MR.Facade.boxRouted(b, mat)) {
      const fp = MR.Facade.boxParams(b, mat, this.city, this.cfg.facade);
      const g = B('cityFacade', grp, CityWorld.FACADE_OPTS, lm), s0 = g.ni;
      for (let f = 0; f < 4; f++) { MR.Facade.setAttrs(g, fp, fp.bay, -1, fp.plain); g.face(f, x0, y0, z0, x1, y1, z1, 1, 1, 0); }
      if (b.gid != null) g.range(s0, b.gid, b.piece || 0);
      MR.Facade.setAttrs(g, fp, fp.bay, -1, true);
      if (b.mt) {
        const tg = B(b.mt, grp, null, lm), tt = this.tile(b.mt);
        if (dry && dry.length && CityWorld.WET_GROUND[b.mt]) CityWorld._wetSplit(tg, x0, y0, z0, x1, y1, z1, tt.u, tt.v, dry, false);
        else tg.face(4, x0, y0, z0, x1, y1, z1, tt.u, tt.v, 0);
      } else g.face(4, x0, y0, z0, x1, y1, z1, 1, 1, 0);
      if (y0 > 0.2) { // 下面: パラペット（cat roof）は今まで通り天井の材質、ほかは窓なしの壁
        if (b.cat === 'roof') { const pt = this.tile('plaster_interior'); B('plaster_interior', 'ext', null, lm).face(5, x0, y0, z0, x1, y1, z1, pt.u, pt.v, 0); }
        else g.face(5, x0, y0, z0, x1, y1, z1, 1, 1, 0);
      } else if (b.cat === 'landmark' && y0 < 0) g.face(5, x0, y0, z0, x1, y1, z1, 1, 1, 0);
      return;
    }
    const t = this.tile(mat);
    const g = B(mat, grp, null, lm), s0 = g.ni;
    for (let f = 0; f < 4; f++) g.face(f, x0, y0, z0, x1, y1, z1, t.u, t.v, b.base != null ? b.base : y0);
    if (b.gid != null) g.range(s0, b.gid, b.piece || 0);
    // 上面。天気: 外の濡れる上面（屋上の砂利など）は shelter の屋根の下を濡らさない
    const top = b.mt || mat, tg = b.mt ? B(b.mt, grp, null, lm) : g, tt = b.mt ? this.tile(b.mt) : t;
    if (dry && dry.length && grp === 'ext' && CityWorld.WET_GROUND[top]) CityWorld._wetSplit(tg, x0, y0, z0, x1, y1, z1, tt.u, tt.v, dry, false);
    else tg.face(4, x0, y0, z0, x1, y1, z1, tt.u, tt.v, 0);
    if (y0 > 0.2 && (b.cat !== 'interior' || (b.f & 1))) { // 室内の壁の下面は床に接している（見た目だけの天井画は下面が表）
      if (b.cat === 'floor' || b.cat === 'roof') { const pt = this.tile('plaster_interior'); B('plaster_interior', 'ext', null, lm).face(5, x0, y0, z0, x1, y1, z1, pt.u, pt.v, 0); }
      else g.face(5, x0, y0, z0, x1, y1, z1, t.u, t.v, 0);
    } else if (b.cat === 'pier' || b.cat === 'road' || (b.cat === 'landmark' && y0 < 0)) g.face(5, x0, y0, z0, x1, y1, z1, t.u, t.v, 0);
  }

  // ---------- v2 の街（manhattan）の柱（citygen_nyc.js の prisms[i]: 片・歩道の台・橋の床・縁の壁・柵）----------
  //   { ring（外周 [x, z, …]）, holes, clip（辺のビット: チャンクで切った切り口 = 壁を描かない）, tri（屋根の三角形。外周 → 穴の頂点の番号。
  //     タイルが持っている三角形 = 実行中に分割しない。持っていない片だけ citygen が読んだときに耳切り）, y0, y1 | top [a, bx, cz]（上面 y = a + bx·x + cz·z）と厚さ t }
  //   壁は切り口でない辺ごと（外向きの法線は輪の回り方から。外周と穴で逆）。UV: u = 周に沿った長さ（一番長い辺の角から、切り口のある輪は
  //   切り口の後の辺から）÷ tile.u。切り口に接する辺だけは切り口の点の切り口の線に沿った座標から（隣のチャンクの同じ辺と窓の列がつながる）、v = (y − base) ÷ tile.v
  //   （1 階の床 base で窓の段がそろう。規則 12: テクスチャの repeat ではなく UV をスケール）。g.hasUv が false（遠景・影）なら UV は書かない
  //   p.bp（任意。[a, bx, cz]）: 下面の平面（上面の平面と平行でない柱。地下の駅の殻 = nyc-complete NC6 の MR.Stations）。無ければ今まで通り
  static prismWalls(g, p, iu, iv, vb) {
    const ring = p.ring, holes = p.holes, clip = p.clip, T = p.top, th = p.t || 0, y0 = p.y0, y1 = p.y1, BP = p.bp;
    const nr = holes && holes.length ? holes.length + 1 : 1;
    const isClip = (e) => (clip ? (clip[e >> 3] >> (e & 7)) & 1 : 0);
    let eBase = 0;
    for (let r = 0; r < nr; r++) {
      const q = r === 0 ? ring : holes[r - 1], m = q.length >> 1;
      if (m < 3) { eBase += m; continue; }
      let area = 0;
      for (let i = 0; i < m; i++) { const j = i + 1 < m ? i + 1 : 0; area += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1]; }
      const sg = ((area > 0) === (r === 0)) ? 1 : -1; // 外向きの法線 = sg × (dz, −dx)
      let s = 0, anyClip = false, best = -1;
      for (let i = 0; i < m; i++) if (isClip(eBase + i)) { anyClip = true; break; }
      if (anyClip) { for (let i = 0; i < m; i++) if (isClip(eBase + (i + m - 1) % m) && !isClip(eBase + i)) { s = i; break; } }
      else {
        for (let i = 0; i < m; i++) {
          const j = i + 1 < m ? i + 1 : 0, dx = q[j * 2] - q[i * 2], dz = q[j * 2 + 1] - q[i * 2 + 1], L2 = dx * dx + dz * dz;
          if (L2 > best) { best = L2; s = i; }
        }
      }
      let uRun = 0;
      for (let k = 0; k < m; k++) {
        const i = (s + k) % m;
        if (isClip(eBase + i)) continue;
        const j = i + 1 < m ? i + 1 : 0;
        const ax = q[i * 2], az = q[i * 2 + 1], bx = q[j * 2], bz = q[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.005) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        // 切り口に接する辺: u をその切り口の点で決める（隣のチャンクの同じ壁の残りも同じ点から同じ値 = 窓の列がつながる）。
        //   値は切り口の線に沿った座標（x の境目なら点の z、z の境目なら x）。以前は始点の世界座標を辺の向きへ射影していて、
        //   切った 2 つの片の向きが 1〜9 mrad 違うだけで原点から 1 km の所では u が何 m もずれた
        const ip = (i + m - 1) % m, pc = anyClip && isClip(eBase + ip), nc = anyClip && isClip(eBase + j);
        const along = (k, px, pz) => { const k1 = k + 1 < m ? k + 1 : 0; return Math.abs(q[k1 * 2] - q[k * 2]) <= Math.abs(q[k1 * 2 + 1] - q[k * 2 + 1]) ? pz : px; };
        const uA = pc ? along(ip, ax, az) * iu : nc ? (along(j, bx, bz) - L) * iu : uRun, uB = uA + L * iu;
        uRun = uB;
        const nx = sg * dz, nz = -sg * dx;
        const ya1 = T ? T[0] + T[1] * ax + T[2] * az : y1, yb1 = T ? T[0] + T[1] * bx + T[2] * bz : y1;
        const ya0 = BP ? BP[0] + BP[1] * ax + BP[2] * az : (T ? ya1 - th : y0), yb0 = BP ? BP[0] + BP[1] * bx + BP[2] * bz : (T ? yb1 - th : y0);
        g.reserve(4, 6);
        const i0 = g.v(ax, ya0, az, nx, 0, nz, uA, (ya0 - vb) * iv), i1 = g.v(bx, yb0, bz, nx, 0, nz, uB, (yb0 - vb) * iv);
        const i2 = g.v(bx, yb1, bz, nx, 0, nz, uB, (yb1 - vb) * iv), i3 = g.v(ax, ya1, az, nx, 0, nz, uA, (ya1 - vb) * iv);
        // CityWorld.wall と同じ回り方（外から見て表）
        if (dx * nz - dz * nx >= 0) g.quad(i0, i1, i2, i3); else g.quad(i1, i0, i3, i2);
      }
      eBase += m;
    }
  }
  // 柱の上面（up）か下面（!up）。三角形は p.tri（外周 → 穴の頂点の番号）。向きは三角形ごとに確かめて上（下）から見て表に
  static prismCap(g, p, up, iu, iv, triOverride) {
    const tri = triOverride || p.tri;
    if (!tri || tri.length < 3) return;
    const ring = p.ring, holes = p.holes, th = p.t || 0, BP = !up && p.bp ? p.bp : null;
    const T = BP ? BP : p.top;
    const n0 = ring.length >> 1;
    let nv = n0;
    if (holes) for (const h of holes) nv += h.length >> 1;
    const X = (k) => { if (k < n0) return ring[k * 2]; k -= n0; for (const h of holes) { const m = h.length >> 1; if (k < m) return h[k * 2]; k -= m; } return 0; };
    const Z = (k) => { if (k < n0) return ring[k * 2 + 1]; k -= n0; for (const h of holes) { const m = h.length >> 1; if (k < m) return h[k * 2 + 1]; k -= m; } return 0; };
    let nx = 0, ny = 1, nz = 0;
    if (T) { const l = Math.hypot(T[1], 1, T[2]); nx = -T[1] / l; ny = 1 / l; nz = -T[2] / l; }
    if (!up) { nx = -nx; ny = -ny; nz = -nz; }
    g.reserve(nv, tri.length);
    const base = g.nv;
    const xs = nv === n0 ? null : new Float64Array(nv * 2);
    for (let k = 0; k < nv; k++) {
      const x = xs ? X(k) : ring[k * 2], z = xs ? Z(k) : ring[k * 2 + 1];
      if (xs) { xs[k * 2] = x; xs[k * 2 + 1] = z; }
      let y = T ? T[0] + T[1] * x + T[2] * z : p.y1;
      if (!up && !BP) y = T ? y - th : p.y0;
      g.v(x, y, z, nx, ny, nz, x * iu, (up ? -z : z) * iv);
    }
    const P = xs || ring;
    for (let t = 0; t + 2 < tri.length; t += 3) {
      const a = tri[t], b = tri[t + 1], c = tri[t + 2];
      if (a >= nv || b >= nv || c >= nv) continue;
      const cy = (P[b * 2 + 1] - P[a * 2 + 1]) * (P[c * 2] - P[a * 2]) - (P[b * 2] - P[a * 2]) * (P[c * 2 + 1] - P[a * 2 + 1]);
      if ((cy > 0) === up) g.tri(base + a, base + b, base + c); else g.tri(base + a, base + c, base + b);
    }
  }
  // 凸な輪（穴なし）なら扇の三角形（遠景: 耳切りを省く。屋根の三角形を持っていない E 外形の柱がほとんど）。凸でなければ null
  static convexFan(p) {
    if (p.holes && p.holes.length) return null;
    const r = p.ring, n = r.length >> 1;
    if (n < 3 || n > 256) return null;
    let sgn = 0;
    for (let i = 0; i < n; i++) {
      const a = i, b = (i + 1) % n, c = (i + 2) % n;
      const cr = (r[b * 2] - r[a * 2]) * (r[c * 2 + 1] - r[b * 2 + 1]) - (r[b * 2 + 1] - r[a * 2 + 1]) * (r[c * 2] - r[b * 2]);
      if (Math.abs(cr) < 1e-6) continue;
      const s = cr > 0 ? 1 : -1;
      if (!sgn) sgn = s; else if (s !== sgn) return null;
    }
    const F = CityWorld._fans || (CityWorld._fans = []);
    let f = F[n];
    if (!f) { f = new Uint16Array((n - 2) * 3); for (let i = 0; i < n - 2; i++) { f[i * 3] = 0; f[i * 3 + 1] = i + 1; f[i * 3 + 2] = i + 2; } F[n] = f; }
    return f;
  }
  // 近景の柱 1 つ: 外壁の材質（p.mat = 今ある v1 の名前。citygen_nyc の _facadeMat）、屋上 p.mt、歩道・広場の台は上面 p.mat・縁 curb、
  //   橋の床は上面 p.mat・横と下は concrete。cat 'under'（R4 のフック 11: 地下の構造）は 3 つ目のグループ under へ（材質は同じ）
  _fullPrism(p, B) {
    if (p.lm && this.lmLoaded[p.lm]) return;
    if (p.hide) return; // 当たりだけの柱（v2: トンネルの口の上の道を支える屋根。nyc-complete NC3）
    if (!p.ring || p.ring.length < 6) return;
    const cat = p.cat, grp = cat === 'under' ? 'under' : (cat === 'interior' ? 'int' : 'ext');
    const has = (m) => !!m && this.materials.has(m);
    // 透ける柵（mat 'railing'）: 壁だけ。u は長さ ÷ tile.u（棒の間隔）、v は下端から上端までで 0..1（手すりがいつも上）。上面・下面は描かない
    if (cat === 'fence' && p.mat === 'railing' && has('railing')) {
      const tr = this.tile('railing'), gr = B('railing', grp), s0 = gr.ni;
      CityWorld.prismWalls(gr, p, 1 / (tr.u || 0.6), 1 / Math.max(0.1, p.y1 - p.y0), p.y0);
      gr.range(s0, p.gid || 0, p.piece || 0);
      return;
    }
    // 暗いトンネル（mat 'tunnelDark'。nyc-complete NC3 のトンネルの口の奥: 壁・天井・奥の壁・床）: 頂点カラーの roadPaint に黒に近い色で
    //   （街のチャンクにいつもある材質 = 描画を増やさない。下からの半球光で天井が光らない）。天気のあるゲームでは濡らさない（markDry）
    if (p.mat === 'tunnelDark') {
      const g = B('roadPaint', grp === 'under' ? 'under' : 'ext', { uv: false, col: true, vcap: 512 }), n0 = g.nv; // 地下の駅（cat 'under'）の暗い奥の壁は under へ
      g.color(CityWorld.lin('#161618'));
      CityWorld.prismWalls(g, p, 1, 1, 0);
      CityWorld.prismCap(g, p, true, 1, 1);
      if (p.bp || p.y0 > -50) CityWorld.prismCap(g, p, false, 1, 1);
      g.color([1, 1, 1]);
      if (this.weather) g.markDry(g.nv - n0);
      return;
    }
    let wall, top, bot = null, vb;
    if (cat === 'sidewalk' || cat === 'plaza') { top = has(p.mat) ? p.mat : 'sidewalk'; wall = 'curb'; vb = p.y0; }
    else if (p.top && p.el) { top = has(p.mat) ? p.mat : 'curb'; wall = top; bot = top; vb = 0; } // NC3 の el・ホーム・口の床: 横と下も同じ材質（チャンクの材質を増やさない）
    else if (p.top) { top = has(p.mat) ? p.mat : 'concrete'; wall = has(p.mw) ? p.mw : (cat === 'road' ? 'concrete' : top); bot = has(p.mb) ? p.mb : (cat === 'road' ? 'concrete' : null); vb = p.base != null ? p.base : 0; }
    else {
      wall = has(p.mat) ? p.mat : 'concrete';
      if ((wall === 'limestone' || wall === 'concrete') && cat === 'exterior') wall += '_win';
      top = has(p.mt) ? p.mt : wall;
      bot = has(p.mb) ? p.mb : (p.y0 > 0.2 ? wall : null); // mb: 下面の材質（地下の駅の天井の板。NC6）
      vb = p.base != null ? p.base : p.y0;
    }
    const gid = p.gid || 0, piece = p.piece || 0;
    // 外壁の材質（MR.Facade。buildings-hq B1）: 入れない建物の片の外壁は窓をシェーダーで描く 1 つの材質へ（チャンクに 1 つのメッシュ）
    if (this.facade && cat === 'exterior' && grp === 'ext' && !p.top && !p.lm) {
      const gf = B('cityFacade', grp, CityWorld.FACADE_OPTS), sf = gf.ni;
      CityWorld.facadeWalls(gf, p, MR.Facade.params(p, this.city, this.cfg.facade), this.cfg.facade);
      gf.range(sf, gid, piece);
    } else {
      const tw = this.tile(wall), gw = B(wall, grp), sw = gw.ni;
      CityWorld.prismWalls(gw, p, 1 / (tw.u || 1), 1 / (tw.v || 1), vb);
      gw.range(sw, gid, piece);
    }
    const tt = this.tile(top), gt = B(top, grp), st = gt.ni;
    CityWorld.prismCap(gt, p, true, 1 / (tt.u || 1), 1 / (tt.v || 1));
    gt.range(st, gid, piece);
    if (bot) {
      const tb = this.tile(bot), gb = B(bot, grp), sb = gb.ni;
      CityWorld.prismCap(gb, p, false, 1 / (tb.u || 1), 1 / (tb.v || 1));
      gb.range(sb, gid, piece);
    }
  }

  // 外壁の材質の CityGeo の作り方（buildFull の B の opts。_fullPrism / _fullBox / destruct_view の 'dx' が同じもの）
  static get FACADE_OPTS() { return CityWorld._facOpts || (CityWorld._facOpts = { vcap: 2048, ranges: true, attrs: MR.Facade.ATTRS }); }
  // 箱 b の壁が描かれるメッシュの材質の名前（_fullBox の選び方。destruct_view の _meshesFor も）
  boxWallMat(b) {
    let mat = b.mat;
    const shell = (b.f & 16) !== 0;
    if ((mat === 'limestone' || mat === 'concrete') && !shell && ((b.cat === 'exterior') || (b.cat === 'landmark' && b.h >= 12 && Math.min(b.w, b.d) >= 6))) mat = mat === 'limestone' ? 'limestone_win' : 'concrete_win';
    if (!this.materials.has(mat)) mat = 'concrete';
    const grp = (b.cat === 'interior') ? 'int' : (b.cat === 'under' ? 'under' : 'ext');
    if (this.facade && grp === 'ext' && MR.Facade.boxRouted(b, mat)) return 'cityFacade';
    return mat;
  }
  // 外壁の材質の壁（MR.Facade.walls が辺を選ぶ = prismWalls と同じ辺・向き）: 辺ごとに頂点属性（窓割り・柱間・階高・色 …）を入れて 4 頂点。
  //   UV = (u m, y m)（窓はシェーダーが m で描く）。fp = MR.Facade.params(p, …)。B3 の _fullBox も同じ setAttrs を使う
  static facadeWalls(g, p, fp, fcfg) {
    MR.Facade.walls(p, fp, (ax, az, bx, bz, ya0, ya1, yb0, yb1, nx, nz, uA, uB, bay, sign, plain) => {
      MR.Facade.setAttrs(g, fp, bay, sign, plain);
      g.reserve(4, 6);
      const i0 = g.v(ax, ya0, az, nx, 0, nz, uA, ya0), i1 = g.v(bx, yb0, bz, nx, 0, nz, uB, yb0);
      const i2 = g.v(bx, yb1, bz, nx, 0, nz, uB, yb1), i3 = g.v(ax, ya1, az, nx, 0, nz, uA, ya1);
      if ((bx - ax) * nz - (bz - az) * nx >= 0) g.quad(i0, i1, i2, i3); else g.quad(i1, i0, i3, i2); // prismWalls と同じ回り方
    }, fcfg && fcfg.minEdge);
  }

  // 水平な三角形 t = [x0, z0, x1, z1, x2, z2]（上から見て反時計回り）を cell m の格子の升ごとに切って書く（向きはそのまま、UV = 世界 xz / tile）。
  //   大きな三角形の深度の精度（数 km の三角形は 5〜20 cm ずれる）を升の大きさまで良くする
  static _clipTri(g, t, y, tu, tv, cell) {
    const minx = Math.min(t[0], t[2], t[4]), maxx = Math.max(t[0], t[2], t[4]), minz = Math.min(t[1], t[3], t[5]), maxz = Math.max(t[1], t[3], t[5]);
    const clip = (poly, axis, v, keepLess) => {
      const out = [];
      for (let k = 0; k < poly.length; k += 2) {
        const ax = poly[k], az = poly[k + 1], j = (k + 2) % poly.length, bx = poly[j], bz = poly[j + 1];
        const a = axis ? az : ax, b = axis ? bz : bx, ia = keepLess ? a <= v : a >= v, ib = keepLess ? b <= v : b >= v;
        if (ia) out.push(ax, az);
        if (ia !== ib) { const f = (v - a) / (b - a); out.push(axis ? ax + f * (bx - ax) : v, axis ? v : az + f * (bz - az)); }
      }
      return out;
    };
    for (let gx = Math.floor(minx / cell); gx * cell < maxx; gx++) for (let gz = Math.floor(minz / cell); gz * cell < maxz; gz++) {
      let p = clip(t, 0, gx * cell, false);
      if (p.length >= 6) p = clip(p, 0, (gx + 1) * cell, true);
      if (p.length >= 6) p = clip(p, 1, gz * cell, false);
      if (p.length >= 6) p = clip(p, 1, (gz + 1) * cell, true);
      if (p.length < 6) continue;
      const m = p.length / 2;
      g.reserve(m, (m - 2) * 3);
      const base = g.nv;
      for (let k = 0; k < p.length; k += 2) g.v(p[k], y, p[k + 1], 0, 1, 0, p[k] / tu, -p[k + 1] / tv);
      for (let k = 1; k + 1 < m; k++) g.tri(base, base + k, base + k + 1);
    }
  }

  // 天気: 歩道の箱の上面（と静的な地面・線路の砂利）を、屋根の下（dry の矩形 = 建物の 1 階・shelter）とその外に分けて書く。屋根の下の面は法線の長さを半分に（markDry。向きは同じ =
  //   光の計算は同じ）→ 濡れる材質（materials.js の vWetOn）が濡らさない。分け方は行ごとの格子（citygen の rectMinus と同じ形）。UV は世界の座標
  //   なので継ぎ目は見えない。かからなければ今まで通り 1 枚。
  //   使う矩形: shelter（y あり）は上面 y1 より 0.3 m 以上高い屋根だけ（屋根の上・同じ高さの面は濡れる）、building（y なし）は ground（地面の高さの
  //   面 = 歩道の上面・静的な地面・線路の砂利）のときだけ（入れる建物の屋上は building の矩形の中でも雨が当たる）
  static _wetSplit(g, x0, y0, z0, x1, y1, z1, tu, tv, dry, ground) {
    let hs = null;
    for (let i = 0; i < dry.length; i++) {
      const r = dry[i];
      if (r.y == null ? !ground : !(r.y > y1 + 0.3)) continue;
      if (r.x0 < x1 && r.x1 > x0 && r.z0 < z1 && r.z1 > z0) (hs || (hs = [])).push([Math.max(x0, r.x0), Math.max(z0, r.z0), Math.min(x1, r.x1), Math.min(z1, r.z1)]);
    }
    if (!hs) { g.face(4, x0, y0, z0, x1, y1, z1, tu, tv, 0); return; }
    const xs = [x0, x1], zs = [z0, z1];
    for (const h of hs) { xs.push(h[0], h[2]); zs.push(h[1], h[3]); }
    const ux = Array.from(new Set(xs)).sort((a, b) => a - b), uz = Array.from(new Set(zs)).sort((a, b) => a - b);
    const emit = (ax, az, bx, bz, d) => {
      if (bx - ax < 1e-4 || bz - az < 1e-4) return;
      g.face(4, ax, y0, az, bx, y1, bz, tu, tv, 0);
      if (d) g.markDry(4);
    };
    for (let j = 0; j < uz.length - 1; j++) {
      const cz = (uz[j] + uz[j + 1]) / 2;
      let run = -1, runD = false;
      for (let i = 0; i < ux.length - 1; i++) {
        const cx = (ux[i] + ux[i + 1]) / 2;
        let d = false;
        for (const h of hs) if (cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3]) { d = true; break; }
        if (run < 0) { run = i; runD = d; }
        else if (d !== runD) { emit(ux[run], uz[j], ux[i], uz[j + 1], runD); run = i; runD = d; }
      }
      if (run >= 0) emit(ux[run], uz[j], ux[ux.length - 1], uz[j + 1], runD);
    }
  }

  // スロープ。階段（cat stair）は段（蹴上げ 0.15〜0.2 m）、他は傾いた板（横の面付き）。幅 2.2 m 未満の階段は室内の階段（室内のグループ）
  _fullRamp(r, B) {
    const mat = this.materials.has(r.mat) ? r.mat : 'concrete';
    const t = this.tile(mat);
    const stair = r.cat === 'stair';
    const grp = stair && Math.min(r.w, r.d) < 2.2 ? 'int' : 'ext';
    const g = B(mat, grp, null, r.lm || null);
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
  // dry: 天気のあるゲームで濡らさない矩形（buildFull と同じ。線路の砂利だけが使う）
  _decal(d, B, dry) {
    const Y = 0.012;
    switch (d.type) {
      case 'lanes': this._lanes(d, B('roadPaint', 'ext', { uv: false, col: true, vcap: 512 }), Y); break;
      case 'line': { // v2（CDEC）: kind 0 中央線（黄 2 本）、1 車線の破線（3 m 引いて 6 m 空ける、世界座標でそろえる）
        const g = B('roadPaint', 'ext', { uv: false, col: true, vcap: 512 });
        const sg = d.seg;
        if (!sg) break;
        const L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
        if (L < 0.05) break;
        const ux = (sg[2] - sg[0]) / L, uz = (sg[3] - sg[1]) / L, px = -uz, pz = ux;
        const band = (a0, a1, off, w) => {
          const ax = sg[0] + ux * a0 + px * off, az = sg[1] + uz * a0 + pz * off, bx = sg[0] + ux * a1 + px * off, bz = sg[1] + uz * a1 + pz * off, hx = px * w / 2, hz = pz * w / 2;
          g.flat([[ax - hx, az - hz], [bx - hx, bz - hz], [bx + hx, bz + hz], [ax + hx, az + hz]], Y, 1, 1);
        };
        if (d.kind === 0) { g.color(CityWorld.lin('#d9a72e')); band(0, L, -0.12, 0.11); band(0, L, 0.12, 0.11); }
        else {
          g.color(CityWorld.lin('#e8e6df'));
          const PER = 9, DASH = 3, w = d.d || 0.12;
          const s0 = sg[0] * ux + sg[1] * uz; // 世界座標の位相
          let a = -(((s0 % PER) + PER) % PER);
          for (; a < L; a += PER) { const a0 = Math.max(0, a), a1 = Math.min(L, a + DASH); if (a1 - a0 > 0.2) band(a0, a1, 0, w); }
        }
        break;
      }
      case 'crosswalk': {
        const g = B('roadPaint', 'ext', { uv: false, col: true, vcap: 512 });
        g.color(CityWorld.lin('#e8e6df'));
        if (d.seg) { // v2: 線分 = 渡る向き。帯の幅 d.d、縞は渡る向きに 1.2 m ごと（車道の向きの 0.6 m の棒）
          const sg = d.seg, L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
          if (L < 0.5) break;
          const ux = (sg[2] - sg[0]) / L, uz = (sg[3] - sg[1]) / L, hx = -uz * d.d / 2, hz = ux * d.d / 2;
          for (let a = 0.3; a + 0.6 <= L; a += 1.2) {
            const ax = sg[0] + ux * a, az = sg[1] + uz * a, bx = ax + ux * 0.6, bz = az + uz * 0.6;
            g.flat([[ax - hx, az - hz], [bx - hx, bz - hz], [bx + hx, bz + hz], [ax + hx, az + hz]], Y, 1, 1);
          }
          break;
        }
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
      case 'track': this._track3(d, B, dry); break;
      case 'gravel': { // v2: 操車場の砂利（台の上の railway の所。矩形 [x0, z0, x1, z1, …] を台の上面 d.y の少し上に）
        const g = B('gravel_roof', 'ext'), t = this.tile('gravel_roof'), R = d.rects, y = (d.y || 0) + Y;
        for (let k = 0; k + 3 < R.length; k += 4) g.flat([[R[k], R[k + 1]], [R[k + 2], R[k + 1]], [R[k + 2], R[k + 3]], [R[k], R[k + 3]]], y, t.u, t.v);
        const Q = d.quads; // 台形（斜めの縁）[x0, x1 @ z0, z0, x0, x1 @ z1, z1]
        if (Q) for (let k = 0; k + 5 < Q.length; k += 6) g.flat([[Q[k], Q[k + 2]], [Q[k + 1], Q[k + 2]], [Q[k + 4], Q[k + 5]], [Q[k + 3], Q[k + 5]]], y, t.u, t.v);
        break;
      }
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
  // 車線のデカール d が線を引かない区間（南北の車線が東西の通りと交わる所。[z0, z1] の配列。ほかは空）。_lanes が使う
  //   （前もって作った形の検証（prebaked-city の dataHash）も同じ関数で city.streets を見る）
  static laneGaps(city, d) {
    const gaps = [];
    if (d.pts || d.axis !== 'z' || !city.streets) return gaps;
    const a0 = d.z - d.d / 2, a1 = d.z + d.d / 2;
    for (const s of city.streets) if (s.z + s.w / 2 + 2 > a0 && s.z - s.w / 2 - 2 < a1) gaps.push([s.z - s.w / 2 - 2, s.z + s.w / 2 + 2]);
    return gaps;
  }
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
    const gaps = CityWorld.laneGaps(city, d); // 交差点（通りの帯）を避ける区間
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

  // 線路（バラスト + 枕木 + 2 本のレール）。v2（manhattan、nyc-complete NC2）は折れ線 d.pts = [x, y, z, …]（y = 砂利の下の面。
  //   橋の床では傾く）: 砂利の帯（CityWorld.ballast）+ 0.65 m ごとの枕木（上面と前後の面）+ 2 本のレール（上面と両側。点ごとに角を合わせる）。
  //   材質は砂利 gravel_roof と metalDark（枕木もレールも。同じチャンクの物とまとまる = 足すメッシュは 2 つまで、v1 の crate は使わない）
  _track3(d, B, dry) {
    if (d.pts) {
      const p = d.pts, n = p.length / 3;
      if (n < 2) return;
      //   高架・トンネルの線路（flags 32 / 2）はチャンクにいつもある材質だけ: 道床は el の床と同じ curb（トンネル 2 は暗い roadPaint）、
      //   枕木とレールは頂点カラーの roadPaint（暗い色）= 描画を増やさない（NC3）
      const elT = (d.flags & (32 | 2)) !== 0, tun = !!d.stub; // stub: トンネルの口の奥（屋根の下）の線路
      const paint = elT ? B('roadPaint', d.under ? 'under' : 'ext', { uv: false, col: true, vcap: 512 }) : null; // under: 地下の駅の線路（NC6）
      if (tun) { paint.color(CityWorld.lin('#1c1b1a')); CityWorld.ballast(paint, p, 1.5, 0.03, 1, 1); }
      else { const bm = elT ? 'curb' : 'gravel_roof', gt = this.tile(bm); CityWorld.ballast(B(bm, 'ext'), p, 1.5, 0.03, 1 / (gt.u || 1), 1 / (gt.v || 1)); }
      const rails = elT ? paint : B('metalDark', 'ext'), ties = rails; // 枕木もレールと同じ metalDark（黒ずんだ木の枕木。線路の足すメッシュは砂利と合わせて 2 つまで）
      if (elT) paint.color(CityWorld.lin('#2b2622'));
      // 枕木: 線に沿って 0.65 m ごと（始まりから 0.3 m）。長さ 2.6 m（横）、幅 0.22 m、高さ 0.03〜0.15 m
      let s0 = 0.3;
      for (let k = 0; k + 1 < n; k++) {
        const ax = p[k * 3], ay = p[k * 3 + 1], az = p[k * 3 + 2], bx = p[k * 3 + 3], by = p[k * 3 + 4], bz = p[k * 3 + 5];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1e-4) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
        for (; s0 < L; s0 += 0.65) {
          const u = s0 / L, cx = ax + (bx - ax) * u, cz = az + (bz - az) * u, y = ay + (by - ay) * u, y1 = y + 0.15;
          const hx = nx * 1.3, hz = nz * 1.3, wx = tx * 0.11, wz = tz * 0.11;
          // 上面だけ（Li Lj Rj Ri = 上向き。前後の 0.12 m の面は描かない: 三角形が 1/3 = 高架の線路を足しても予算の中。nyc-complete NC3）
          ties.reserve(4, 6);
          const a = ties.v(cx + hx - wx, y1, cz + hz - wz, 0, 1, 0, 0, 0), b = ties.v(cx + hx + wx, y1, cz + hz + wz, 0, 1, 0, 0, 0.22);
          const c = ties.v(cx - hx + wx, y1, cz - hz + wz, 0, 1, 0, 2.6, 0.22), e = ties.v(cx - hx - wx, y1, cz - hz - wz, 0, 1, 0, 2.6, 0);
          ties.quad(a, b, c, e);
        }
        s0 -= L;
      }
      if (elT) paint.color(CityWorld.lin('#34373c'));
      // レール: 中心線から ±0.72 m、幅 0.07 m、0.15〜0.30 m。点ごとの角の向き（隣の辺の法線の平均 / cos）
      const mx = new Float64Array(n), mz = new Float64Array(n), sU = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        let sx = 0, sz = 0;
        for (const j of [k - 1, k]) {
          if (j < 0 || j + 1 >= n) continue;
          const dx = p[j * 3 + 3] - p[j * 3], dz = p[j * 3 + 5] - p[j * 3 + 2], L = Math.hypot(dx, dz);
          if (L > 1e-4) { sx += -dz / L; sz += dx / L; }
        }
        const l = Math.hypot(sx, sz) || 1;
        let ux = sx / l, uz = sz / l;
        // 角の長さ 1 / cos（半分の角）。2 倍まで
        let dot = 1;
        if (k > 0 && k + 1 < n) { const dx = p[k * 3 + 3] - p[k * 3], dz = p[k * 3 + 5] - p[k * 3 + 2], L = Math.hypot(dx, dz) || 1; dot = Math.max(0.5, ux * (-dz / L) + uz * (dx / L)); }
        mx[k] = ux / dot; mz[k] = uz / dot;
        if (k > 0) sU[k] = sU[k - 1] + Math.hypot(p[k * 3] - p[k * 3 - 3], p[k * 3 + 2] - p[k * 3 - 1]);
      }
      for (const o of [-0.72, 0.72]) {
        for (let k = 0; k + 1 < n; k++) {
          const j = k + 1;
          const dx = p[j * 3] - p[k * 3], dz = p[j * 3 + 2] - p[k * 3 + 2], L = Math.hypot(dx, dz);
          if (L < 1e-4) continue;
          const nx = -dz / L, nz = dx / L;
          const P = (i, off, y) => [p[i * 3] + mx[i] * off, p[i * 3 + 1] + y, p[i * 3 + 2] + mz[i] * off];
          const Li = P(k, o + 0.035, 0.3), Lj = P(j, o + 0.035, 0.3), Rj = P(j, o - 0.035, 0.3), Ri = P(k, o - 0.035, 0.3);
          rails.reserve(12, 18);
          const ua = sU[k], ub = sU[j];
          const t0 = rails.v(Li[0], Li[1], Li[2], 0, 1, 0, ua, 0.07), t1 = rails.v(Lj[0], Lj[1], Lj[2], 0, 1, 0, ub, 0.07);
          const t2 = rails.v(Rj[0], Rj[1], Rj[2], 0, 1, 0, ub, 0), t3 = rails.v(Ri[0], Ri[1], Ri[2], 0, 1, 0, ua, 0);
          rails.quad(t0, t1, t2, t3);
          // 左の面（+n）: Li_b Lj_b Lj_t Li_t、右の面（−n）: Rj_b Ri_b Ri_t Rj_t
          const l0 = rails.v(Li[0], Li[1] - 0.15, Li[2], nx, 0, nz, ua, 0), l1 = rails.v(Lj[0], Lj[1] - 0.15, Lj[2], nx, 0, nz, ub, 0);
          const l2 = rails.v(Lj[0], Lj[1], Lj[2], nx, 0, nz, ub, 0.15), l3 = rails.v(Li[0], Li[1], Li[2], nx, 0, nz, ua, 0.15);
          rails.quad(l0, l1, l2, l3);
          const r0 = rails.v(Rj[0], Rj[1] - 0.15, Rj[2], -nx, 0, -nz, ub, 0), r1 = rails.v(Ri[0], Ri[1] - 0.15, Ri[2], -nx, 0, -nz, ua, 0);
          const r2 = rails.v(Ri[0], Ri[1], Ri[2], -nx, 0, -nz, ua, 0.15), r3 = rails.v(Rj[0], Rj[1], Rj[2], -nx, 0, -nz, ub, 0.15);
          rails.quad(r0, r1, r2, r3);
        }
      }
      if (elT) paint.color([1, 1, 1]);
      return;
    }
    const alongZ = d.d >= d.w, len = alongZ ? d.d : d.w;
    const gt = this.tile('gravel_roof');
    const bw = alongZ ? 3 : len, bd = alongZ ? len : 3;
    // 天気: 屋根の下（ハドソンヤードの人工地盤の下の操車場）の砂利は濡らさない（同じ UV の上向きの面 = 天気の無いときと同じ見た目）
    if (dry) CityWorld._wetSplit(B('gravel_roof', 'ext'), d.x - bw / 2, 0.03, d.z - bd / 2, d.x + bw / 2, 0.03, d.z + bd / 2, gt.u, gt.v, dry.concat(this.city.staticItems.shelters || []), true);
    else B('gravel_roof', 'ext').rectRot(d.x, d.z, bw, bd, 0, 0.03, gt.u, gt.v);
    const ties = B('crate', 'ext'), rails = B('metalDark', 'ext');
    const box = (g, cx, cz, hx, hz, y0, y1, faces) => { for (const f of faces) g.face(f, cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, 1, 1, y0); };
    for (let s = -len / 2 + 0.3; s < len / 2; s += 0.65) {
      if (alongZ) box(ties, d.x, d.z + s, 1.3, 0.11, 0.03, 0.15, [2, 3, 4]); else box(ties, d.x + s, d.z, 0.11, 1.3, 0.03, 0.15, [0, 1, 4]);
    }
    for (const o of [-0.72, 0.72]) {
      if (alongZ) box(rails, d.x + o, d.z, 0.035, len / 2, 0.15, 0.3, [0, 1, 4]); else box(rails, d.x, d.z + o, len / 2, 0.035, 0.15, 0.3, [2, 3, 4]);
    }
  }

  // 砂利の帯（線路の折れ線 p = [x, y, z, …] の左右 hw m、y + dy。点ごとに角を合わせる、上向き）。UV = 世界 xz × iu / iv（g に UV が無ければ無視）。
  //   近景（_track3）と遠景（buildLod の chunkLod().tracks）が使う
  static ballast(g, p, hw, dy, iu, iv) {
    const n = p.length / 3;
    if (n < 2) return;
    g.reserve(n * 2, (n - 1) * 6);
    let prevL = -1, prevR = -1;
    for (let k = 0; k < n; k++) {
      let sx = 0, sz = 0;
      for (const j of [k - 1, k]) {
        if (j < 0 || j + 1 >= n) continue;
        const dx = p[j * 3 + 3] - p[j * 3], dz = p[j * 3 + 5] - p[j * 3 + 2], L = Math.hypot(dx, dz);
        if (L > 1e-4) { sx += -dz / L; sz += dx / L; }
      }
      const l = Math.hypot(sx, sz) || 1, ux = sx / l, uz = sz / l;
      let dot = 1;
      if (k > 0 && k + 1 < n) { const dx = p[k * 3 + 3] - p[k * 3], dz = p[k * 3 + 5] - p[k * 3 + 2], L = Math.hypot(dx, dz) || 1; dot = Math.max(0.5, ux * (-dz / L) + uz * (dx / L)); }
      const ox = ux * hw / dot, oz = uz * hw / dot, x = p[k * 3], y = p[k * 3 + 1] + dy, z = p[k * 3 + 2];
      const iL = g.v(x + ox, y, z + oz, 0, 1, 0, (x + ox) * iu, -(z + oz) * iv), iR = g.v(x - ox, y, z - oz, 0, 1, 0, (x - ox) * iu, -(z - oz) * iv);
      if (prevL >= 0) g.quad(prevL, iL, iR, prevR); // Li Lj Rj Ri = 上向き
      prevL = iL; prevR = iR;
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

  // ---------- ランドマークの部品（lm セグメント）----------
  // GLB のランドマークの代わりの箱（citygen の lm 付きの箱・スロープ）は、どの組み立て（buildFull / buildLod / buildSkyline）でも
  //   その形の CityGeo の「横」の CityGeo（g.sides: lm → CityGeo）に書き、メッシュにするときに名前の順に後ろへ足す（toGeometry の segs）。
  //   GLB が読めたか（lmLoaded）は書くときには見ないので、同じデータからいつも同じ配列になる。読めた部品は cutSegments で描かないだけ
  //   （以前はその場で飛ばしていて、読めたら近景・LOD・スカイラインを全部作り直していた: 124〜252 ms + 作り直しの波）
  static side(g, lm, far) {
    const sides = g.sides || (g.sides = new Map());
    let sg = sides.get(lm);
    if (!sg) { sg = new MR.CityGeo(far ? { uv: false, col: true, info: true, vcap: 256, q: true } : { vcap: 256, q: true }); sides.set(lm, sg); }
    return sg;
  }
  // g.sides を名前の順の [[名前, CityGeo], …] に（空のものは除く）。無ければ null
  static sortedSides(g) {
    if (!g.sides) return null;
    const out = [];
    for (const name of Array.from(g.sides.keys()).sort()) { const sg = g.sides.get(name); if (!sg.empty) out.push([name, sg]); }
    return out.length ? out : null;
  }
  // GLB が見た目を受け持つ部品（geo.userData.segs）を描かない / また描く。loaded: 名前 → true（world.lmLoaded）か Set。
  //   頂点はそのまま（作り直すまで使われないだけ）。インデックスを [ほかの部分 | 描く segs（名前の順）| 描かない segs（名前の順）] に
  //   並べ替えて drawRange で前だけを描く（GL のバッファを作り直さない。並べ替えなので戻せる）。境界（boundingBox / boundingSphere）は
  //   部分ごとの箱と半径（userData.segBox。toGeometry が作る）から: 箱は部品を飛ばして作った形とちょうど同じ、球は中心が同じで半径は
  //   同じか少し大きい（部品を全部切ったときは同じ。unionRadius）。頂点はなめない（届いたフレームで数万頂点をなめると JIT 前の初回は
  //   10〜20 ms かかった）。
  //   同じ集合なら何もしない。O(切る segs のインデックス数)。戻り値: 描くインデックスの数（0 ならメッシュを隠す = cutMesh）
  static cutSegments(geo, loaded) {
    const ia = geo && geo.index, segs = geo && geo.userData.segs;
    if (!ia) return 0;
    if (!segs || !segs.length) return ia.count;
    const has = loaded instanceof Set ? (n) => loaded.has(n) : (n) => !!(loaded && loaded[n]);
    let mask = '';
    for (const sg of segs) mask += has(sg[0]) ? '1' : '0';
    const ud = geo.userData, cur = ud.segCut || '0'.repeat(segs.length), base = segs[0][3];
    let keep = base;
    for (let i = 0; i < segs.length; i++) if (mask[i] === '0') keep += segs[i][4];
    if (mask === cur) return keep;
    const where = (m) => { // 並び m での各 seg のインデックスの位置
      const at = new Array(segs.length);
      let o = base;
      for (const want of ['0', '1']) for (let i = 0; i < segs.length; i++) if (m[i] === want) { at[i] = o; o += segs[i][4]; }
      return at;
    };
    const from = where(cur), to = where(mask), a = ia.array, tmp = a.slice(base);
    for (let i = 0; i < segs.length; i++) a.set(tmp.subarray(from[i] - base, from[i] - base + segs[i][4]), to[i]);
    ia.needsUpdate = true;
    // 片ごとの範囲（userData.pieces。v2 の街）: 横の形の片は seg の中にあるので、seg と同じだけずらす（ほかの部分 [0, base) は動かない）
    const pr = ud.pieces;
    if (pr) for (let k = 0; k < pr.length; k += 4) {
      const s0 = pr[k];
      if (s0 < base) continue;
      for (let i = 0; i < segs.length; i++) if (s0 >= from[i] && s0 < from[i] + segs[i][4]) { pr[k] = to[i] + (s0 - from[i]); break; }
    }
    ud.segCut = mask;
    geo.setDrawRange(0, keep === ia.count ? Infinity : keep);
    // 境界: 何も切らないときは作ったときの境界（three の計算）に戻す。切ったときは、描く部分の箱の和（ちょうど。頂点をなめない）と、
    //   その箱の中心の球（three の球と中心は同じ、半径は同じか少し大きい = 視錐台の判定が甘くなるだけ。部品を全部切ったときは同じ）
    if (!ud.bounds0) { const b = geo.boundingBox, sp = geo.boundingSphere; ud.bounds0 = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, sp.center.x, sp.center.y, sp.center.z, sp.radius]; }
    const b0 = ud.bounds0;
    if (keep === ia.count) {
      geo.boundingBox.min.set(b0[0], b0[1], b0[2]); geo.boundingBox.max.set(b0[3], b0[4], b0[5]);
      geo.boundingSphere.center.set(b0[6], b0[7], b0[8]); geo.boundingSphere.radius = b0[9];
      return keep;
    }
    if (!ud.segBox) ud.segBox = MR.CityGeo.partBoxes(geo.attributes.position.array, segs); // 作ったときに無ければ（1 回だけ頂点をなめる）
    const u = MR.CityGeo.unionBox(ud.segBox, mask);
    if (u[0] <= u[3]) {
      geo.boundingBox.min.set(u[0], u[1], u[2]); geo.boundingBox.max.set(u[3], u[4], u[5]);
      geo.boundingSphere.center.set((u[0] + u[3]) * 0.5, (u[1] + u[4]) * 0.5, (u[2] + u[5]) * 0.5);
      geo.boundingSphere.radius = MR.CityGeo.unionRadius(ud.segBox, mask, u);
    }
    return keep;
  }
  // メッシュ 1 つ: cutSegments の後、描くものが無ければ隠す（子（LOD の看板）があれば隠さない）。userData.cutEmpty（スカイラインの
  //   表示は streamer が毎フレーム決めるので、そちらが見る）
  static cutMesh(mesh, loaded) {
    const n = CityWorld.cutSegments(mesh.geometry, loaded);
    mesh.userData.cutEmpty = n === 0;
    mesh.visible = n > 0 || mesh.children.length > 0;
    return n;
  }
  // obj の下の segs のあるメッシュを今の lmLoaded で（組み立ての最後・invalidateLandmarks）。切ったメッシュの数
  _cutObject(obj) {
    const L = this.lmLoaded;
    let n = 0;
    obj.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.userData.segs) { CityWorld.cutMesh(o, L); n++; } });
    return n;
  }

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

  // 遠景の柱 1 つ（v2: chunkLod の E 外形・skyline の 40 m 以上の片と街区の塊 MASS）。aInfo のチャンク（cx, cz）= 柱の持ち主のチャンク
  //   （uHide で近景が出来たチャンクの分だけちょうど消える）。様式は v1 の farStyles を材質から（*_win は元の名前）、街区の塊（mass）は
  //   位置のハッシュでレンガ・コンクリート・石。歩道・広場の台は上面 sidewalk・縁 curb、橋の床は上面 asphalt・横 concrete
  _farPrism(g, p, cx, cz) {
    const S = this._farStyles;
    g.i0 = cx; g.i1 = cz;
    const r = p.ring;
    const hx = (r[0] * 4) | 0, hz = (r[1] * 4) | 0;
    const h = ((Math.imul(hx, 73856093) ^ Math.imul(hz, 19349663) ^ Math.imul(p.gid | 0, 83492791)) >>> 0) / 4294967296;
    g.i3 = Math.floor(h * 255);
    if (p.cat === 'sidewalk' || p.cat === 'plaza') {
      g.i2 = 0;
      g.color(S.curb.c); CityWorld.prismWalls(g, p, 1, 1, 0);
      g.color(p.yard ? S.gravel_roof.c : S.sidewalk.c); CityWorld.prismCap(g, p, true, 1, 1, CityWorld.convexFan(p)); // 操車場の台は砂利
      return;
    }
    if (p.top) {
      g.i2 = 0;
      g.color(S.concrete.c); CityWorld.prismWalls(g, p, 1, 1, 0);
      g.color((S[p.mat] || S.asphalt_city).c); CityWorld.prismCap(g, p, true, 1, 1, CityWorld.convexFan(p));
      return;
    }
    let st;
    if (p.mass) { const M = CityWorld.MASS_STYLES; st = S[M[Math.floor(h * M.length) % M.length]]; }
    else { const m = p.mat || ''; st = S[m] || S[m.replace('_win', '')] || (m === 'terrazzo' ? S.sidewalk : S._); }
    const k = 0.84 + 0.3 * h, w = (h - 0.5) * 0.08;
    g.color([st.c.r * k * (1 + w), st.c.g * k, st.c.b * k * (1 - w)]);
    g.i2 = (st.s > 0 && p.y1 - p.y0 >= 6) ? st.s : 0;
    CityWorld.prismWalls(g, p, 1, 1, 0);
    g.i2 = 0;
    g.color(p.mt && S[p.mt] && !p.mass ? S[p.mt].c : st.roof);
    CityWorld.prismCap(g, p, true, 1, 1, CityWorld.convexFan(p));
  }
  static get MASS_STYLES() { return ['brick_brown', 'brick_red', 'concrete', 'office_stone', 'brick_brown', 'limestone']; }

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
    const g = new MR.CityGeo({ uv: false, col: true, info: true, vcap: 8192, q: true });
    let bb = null; // 看板（発光のアトラス。別のメッシュ）
    const foliage = this._farStyles.grass.c;
    for (let cz = sz * S; cz < Math.min(this.city.ncz, (sz + 1) * S); cz++) {
      for (let cx = sx * S; cx < Math.min(this.city.ncx, (sx + 1) * S); cx++) {
        const lod = this.cache.lod(cx, cz);
        if (lod) for (const b of lod.boxes) this._farBox(b.lm ? CityWorld.side(g, b.lm, true) : g, b, cx, cz); // ランドマークの部品は横へ
        if (lod && lod.prisms && lod.prisms.length) { // v2: E 外形の柱（耳切りは citygen が読んだときに 1 回 = この歩の中。柱に lm は無い）
          for (let i = 0; i < lod.prisms.length; i++) {
            const p = lod.prisms[i];
            if (p.lm && this.lmLoaded[p.lm]) continue;
            this._farPrism(g, p, cx, cz);
            if ((i & 15) === 15 && now() - ts > slice) { yield 'chunk'; ts = now(); }
          }
        }
        if (lod && lod.tracks) { // v2: 線路は砂利の帯だけ（枕木・レールは近景だけ）
          g.i0 = cx; g.i1 = cz; g.i2 = 0; g.i3 = 0;
          g.color(this._farStyles.gravel_roof.c);
          for (const t of lod.tracks) CityWorld.ballast(g, t.pts, 1.5, 0.03, 1, 1);
        }
        if (!this.cache.hasDecor(cx, cz)) {
          if (now() - ts > decorAt) { yield 'chunk'; ts = now(); }
          this.cache.decor(cx, cz);
          yield 'decor';
          ts = now();
        }
        const dec = this.cache.decor(cx, cz);
        if (!dec && this.city.chunkReady) (ctx.pending || (ctx.pending = [])).push(cx, cz); // v2: タイルがまだ（木なし。届いたら streamer が作り直す）
        if (dec) {
          if (dec.billboards && dec.billboards.length && this.cfg.billboards !== false) {
            bb = bb || new MR.CityGeo({ vcap: 64, q: true });
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
    const sides = CityWorld.sortedSides(g);
    if (g.empty && !sides) return null;
    const geo = this._track(g.toGeometry(sides));
    ctx.geos.push(geo);
    let bgeo = null;
    if (bb && !bb.empty) {
      if (now() - ts > slice) { yield 'geo'; ts = now(); }
      if (this._warmQueue && this._warmQueue.length) { yield* this._prepareMat('billboard', slice); ts = now(); }
      bgeo = this._track(bb.toGeometry());
      ctx.geos.push(bgeo);
    }
    const out = this._lodOut(sx, sz, geo, bgeo);
    if (out && ctx.pending) out.pending = ctx.pending; // v2: 木のタイルがまだだったチャンク（streamer が届いたら作り直す）
    return out;
  }
  // LOD の区画のメッシュ（遠景の形 geo + 看板 bgeo）。作った形も前もって作った形（lodJob）も同じここで
  _lodOut(sx, sz, geo, bgeo) {
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
    this._cutObject(mesh);
    this.root.add(mesh);
    return { mesh, geos: bgeo ? [geo, bgeo] : [geo] };
  }

  // streamer が LOD の区画に使うジョブ: far.bin にあればそれ（ワーカーの復元を待つ間は 'wait' = streamer はその区画を置いて次の仕事へ。
  //   waitFrames と waitMs を過ぎたら作る。ワーカーが無ければメインスレッドで少しずつ復元）、無ければ buildLod（その場で作る）。形はバイトまで同じ
  *lodJob(sx, sz, ctx) {
    ctx = ctx || { geos: [] };
    const bk = this.bake;
    if (bk && bk.has('lod', sx, sz)) {
      let r = bk.request('lod', sx, sz, { sync: !!(this.streamer && this.streamer._priming) }); // 起動時の prime はメインスレッドで
      // 待つのは waitFrames フレームと waitMs の両方が過ぎるまで（フレームが速いとき = テストのベンチ・120 Hz の端末でも時間で待つ）
      const bc = this.cfg.bake || {}, wf = bc.waitFrames >= 0 ? bc.waitFrames : 6, wms = bc.waitMs >= 0 ? bc.waitMs : 100, tw = CityWorld.now();
      for (let w = 0; r === 'pending' && (w < wf || CityWorld.now() - tw < wms); w++) { yield 'wait'; r = bk.request('lod', sx, sz); }
      if (r === 'main') r = yield* bk.decodeJob('lod', sx, sz); // ワーカーが無い・待つ間に止まった: メインスレッドで少しずつ
      if (r === 'pending') { bk.missWait(); bk.forget('lod', sx, sz); }
      else if (r && r !== 'main') {
        const out = yield* this._lodBaked(sx, sz, r, ctx);
        if (out !== undefined) { bk.hit(); return out; }
        bk.missMat();
      }
    }
    return yield* this.buildLod(sx, sz, ctx);
  }
  // 復元した LOD の区画（[far, billboards?]）→ _lodOut。知らない名前があれば undefined（作る）
  *_lodBaked(sx, sz, meshes, ctx) {
    let far = null, bill = null;
    for (const m of meshes) { if (m.name === 'far') far = m; else if (m.name === 'billboards') bill = m; else return undefined; }
    if (!far) return null; // 何も無い区画（作っても null）
    if (bill && this.cfg.billboards === false) bill = null;
    if (bill && this._warmQueue && this._warmQueue.length) yield* this._prepareMat('billboard', this.cfg.buildStepMs > 0 ? this.cfg.buildStepMs : 2);
    const geo = this._track(CityWorld.bakedGeometry(far, false));
    ctx.geos.push(geo);
    let bgeo = null;
    if (bill) { bgeo = this._track(CityWorld.bakedGeometry(bill, false)); ctx.geos.push(bgeo); }
    return this._lodOut(sx, sz, geo, bgeo);
  }
  // 復元したメッシュ 1 つ → BufferGeometry（CityGeo.geometry。境界は復元のときに計算済み）。copyIndex: インデックスを写す（共有の
  //   スカイラインの配列。cutSegments はインデックスを並べ替えるので、lm セグメントのある形は写す）
  static bakedGeometry(m, copyIndex) {
    const idx = copyIndex && m.segs ? m.idx.slice() : m.idx;
    const geo = MR.CityGeo.geometry({ attrs: m.attrs, idx, nv: m.nv, ni: m.ni, bounds: m.bounds });
    if (m.segs) { geo.userData.segs = m.segs; geo.userData.segBox = m.segBox; }
    geo.userData.baked = true; // 前もって作った形（streamer.stats.bake の数え方）
    return geo;
  }

  // スカイライン（全体。起動時に 1 回）: skyline() の箱を持ち主のチャンクの 512 m 区画ごとに + 街区の上面 + ブロードウェイ
  buildSkyline(S) {
    const city = this.city, ncx = city.ncx;
    S = S || this.streamer.S;
    const groups = new Map();
    const G = (sx, sz) => { const k = sx + '_' + sz; let g = groups.get(k); if (!g) { g = new MR.CityGeo({ uv: false, col: true, info: true, vcap: 4096, q: true }); g.sx = sx; g.sz = sz; groups.set(k, g); } return g; };
    const tS0 = CityWorld.now();
    const skyGroups = city.skyline().groups;
    const tS1 = CityWorld.now();
    for (const grp of skyGroups) {
      const v2 = city.version === 2; // v2: どの遠景の形も持ち主のチャンク o の印（uHide で近景のチャンクの分だけ消える）
      for (const b of grp.boxes || []) {
        const o = b.o >= 0 ? b.o : city._ci(b.x, b.z);
        if (o < 0) continue;
        const cx = o % ncx, cz = Math.floor(o / ncx), g = G(Math.floor(cx / S), Math.floor(cz / S));
        this._farBox(b.lm ? CityWorld.side(g, b.lm, true) : g, b, v2 ? cx : 255, v2 ? cz : 255); // ランドマークの部品は横へ（buildFull と同じ）
      }
      // v2: grp.prisms（40 m 以上の部品の E 外形。柱に lm は無い）
      for (const p of grp.prisms || []) {
        if (p.lm && this.lmLoaded[p.lm]) continue;
        const o = p.o;
        if (!(o >= 0)) continue;
        const cx = o % ncx, cz = Math.floor(o / ncx);
        this._farPrism(G(Math.floor(cx / S), Math.floor(cz / S)), p, cx, cz);
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
    const tS2 = CityWorld.now();
    for (const [k, g] of groups) {
      const sides = CityWorld.sortedSides(g);
      if (g.empty && !sides) continue;
      out.set(k, this._skyMesh(k, this._track(g.toGeometry(sides)), g.sx, g.sz));
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    this.timings.sky = { data: r1(tS1 - tS0), write: r1(tS2 - tS1), geo: r1(CityWorld.now() - tS2), groups: out.size };
    return out;
  }
  _skyMesh(k, geo, sx, sz) {
    const mesh = new THREE.Mesh(geo, this.farMaterial);
    mesh.name = 'sky:' + k;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this._cutObject(mesh); // 空になったら userData.cutEmpty（表示は streamer が毎フレーム決める）
    this.root.add(mesh);
    return { mesh, geos: [geo], sx, sz };
  }
  // streamer が起動時に使うスカイライン: far.bin から起動前に復元してあればそれ（BufferGeometry を作るだけ。頂点の配列は CityBake と共有）、
  //   無ければ buildSkyline（その場で作る）。stats: this.skySource = 'bake' | 'gen'
  skylineMeshes(S) {
    const bk = this.bake, groups = bk ? bk.request('sky') : null;
    if (groups) {
      const out = new Map();
      for (const [k, list] of groups) {
        const m = list[0];
        if (!m || list.length !== 1 || m.name !== 'far') { out.clear(); break; }
        const [sx, sz] = k.split('_').map(Number);
        out.set(k, this._skyMesh(k, this._track(CityWorld.bakedGeometry(m, true)), sx, sz));
      }
      if (out.size) { this.skySource = 'bake'; return out; }
    }
    this.skySource = 'gen';
    return this.buildSkyline(S);
  }

  // 遠景のマテリアル（MeshStandardMaterial + onBeforeCompile。近景と同じ光の計算 = 実機の環境マップの明るさも同じに効く）。
  // 頂点カラーが壁の色、aInfo = (cx, cz, スタイル, 乱数)。直接光の鏡面反射は弱める（低い太陽で面が白く光らないように）。
  //   頂点: 近景が出来上がったチャンク（uHide）の頂点は画面の外へ（三角形ごと消える）
  //   フラグメント: 側面に窓の格子（世界座標: 横 = 面に沿う座標 / 柱間、縦 = (y − 0.15) / 階高）。灯りの付いた窓は発光（夕暮れ）。
  //     遠くて窓が 1 画素より小さくなる所は平均の色にする（fwidth。無い端末は距離で）
  //   wetU（天気のあるゲーム: Materials.wetUniforms.uWet）: 濡れた上向きの面（屋上・道）を ×（1 − farDarken × uWet）暗く（CITY_WET。
  //   プログラムのキー 'cityFar|wet'）。wetFar = Materials.wetUniforms.uWetFar（game.json の weather.wet.farDarken。無ければ 0.28）
  static makeFarMaterial(cfg, wetU, wetFar) {
    cfg = cfg || {};
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    m.name = 'cityFar';
    m.extensions = { derivatives: true };
    const hide = [];
    for (let i = 0; i < CityWorld.HIDE_SLOTS; i++) hide.push(new THREE.Vector2(-100, -100));
    // 壊れた外壁の穴（destruct_view.js が近い CUT_SLOTS 個を入れる）: 遠景・LOD でその箱の中は暗い穴の色（形・far.bin は変えない）
    const cut0 = [], cut1 = [];
    for (let i = 0; i < CityWorld.CUT_SLOTS; i++) { cut0.push(new THREE.Vector3(1, 1, 1)); cut1.push(new THREE.Vector3(0, 0, 0)); }
    const U = {
      uHide: { value: hide },
      uCut0: { value: cut0 }, uCut1: { value: cut1 }, uCutN: { value: 0 },
      uWinGlow: { value: cfg.farWindowGlow == null ? 1.25 : cfg.farWindowGlow },
      uWinLit: { value: cfg.farWindowLit == null ? 1 : cfg.farWindowLit },
      uWinColor: { value: MR.srgb('#ffc77a') },
      uGlassA: { value: MR.srgb('#1d242c') },
      uGlassB: { value: MR.srgb('#46525e') },
      uSky: { value: MR.srgb('#e9985a') },
      // ストーリーの地区の灯（citylights.js）: vec4(x, z, 地区の半径 R, 灯の輪の半径 r)。R の中で r の外は窓の灯を uZoneDim 倍。既定は R 0 = どこも 1（今までと同じ）
      uZones: { value: Array.from({ length: CityWorld.ZONE_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uZoneDim: { value: 1 }
    };
    if (wetU) { U.uWet = wetU; U.uWetFar = wetFar || { value: 0.28 }; m.defines = Object.assign({}, m.defines, { CITY_WET: 1 }); m.customProgramCacheKey = () => 'cityFar|wet'; }
    m.userData.uniforms = U;
    const N = CityWorld.HIDE_SLOTS;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nvarying vec4 vInfo;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vDist;\nvarying float vZoneK;\nuniform vec2 uHide[' + N + '];\nuniform vec4 uZones[' + CityWorld.ZONE_SLOTS + '];\nuniform float uZoneDim;')
        .replace('#include <project_vertex>', [
          '#include <project_vertex>',
          'vInfo = aInfo;',
          'vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          'vWN = normalize(mat3(modelMatrix) * objectNormal);',
          'vDist = -mvPosition.z;',
          'vZoneK = 1.0;',
          'if (uZoneDim < 1.0) {', // ストーリーで地区が暗いときだけ（ほかのモードは頂点ごとの 12 回を回さない）
          '  for (int i = 0; i < ' + CityWorld.ZONE_SLOTS + '; i++) {',
          '    float zd = length(vWP.xz - uZones[i].xy);',
          '    if (zd < uZones[i].z && zd >= uZones[i].w) vZoneK = uZoneDim;',
          '  }',
          '}',
          'for (int i = 0; i < ' + N + '; i++) {',
          '  vec2 dd = abs(aInfo.xy - uHide[i]);',
          '  if (dd.x < 0.5 && dd.y < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);',
          '}'
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'varying vec4 vInfo;', 'varying vec3 vWP;', 'varying vec3 vWN;', 'varying float vDist;', 'varying float vZoneK;',
          'uniform float uWinGlow; uniform float uWinLit; uniform vec3 uWinColor; uniform vec3 uGlassA; uniform vec3 uGlassB; uniform vec3 uSky;',
          'uniform vec3 uCut0[' + CityWorld.CUT_SLOTS + ']; uniform vec3 uCut1[' + CityWorld.CUT_SLOTS + ']; uniform int uCutN;',
          '#ifdef CITY_WET', 'uniform float uWet;', 'uniform float uWetFar;', '#endif',
          'float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }'
        ].join('\n'))
        .replace('#include <emissivemap_fragment>', [
          '#include <emissivemap_fragment>',
          '{',
          '  float st = floor(vInfo.z + 0.5);',
          // 乱数（aInfo.w）も整数に丸める: 補間した値は頂点で同じでも 1 ulp ずれることがあり、sin の大きな引数の hash がそれで変わって
          // 窓の行に横の縞が出ていた（縞の場所は頂点の位置の細かい違い = 格子に丸めるかどうかでも動いた）
          '  float wr = floor(vInfo.w + 0.5);',
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
          '    float h = cityHash(rid + vec2(wr * 0.37, st * 1.7));',
          '    float on = step(1.0 - lit * uWinLit, h);',
          '    win = mix(win, wu * (v1 - v0), fade);',
          // 遠くでは窓 4 × 3 個のまとまりごとに灯りの多い・少ないを変える（平均の色だけだと粘土のように見える）
          '    float coarse = cityHash(floor(cell / vec2(4.0, 3.0)) + vec2(wr * 0.53, st * 2.3));',
          '    on = mix(on, lit * uWinLit * (0.5 + coarse), fade);',
          '    vec3 glass = mix(uGlassA, uGlassB, mix(cityHash(id + 7.3), 0.5, fade));',
          '    diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.9);',
          '    float bright = mix(0.6 + 0.8 * cityHash(id * 1.31 + 2.0), 0.7, fade);',
          '    totalEmissiveRadiance += uWinColor * bright * win * on * uWinGlow * vZoneK;',
          '    totalEmissiveRadiance += uSky * 0.05 * win * (1.0 - on);',
          '  }',
          '  if (st > 7.5 && st < 8.5) diffuseColor.rgb *= 0.75 + 0.5 * cityHash(floor(vWP.xz * 0.7));',
          '  for (int i = 0; i < ' + CityWorld.CUT_SLOTS + '; i++) {',
          '    if (i >= uCutN) break;',
          '    if (all(greaterThan(vWP, uCut0[i])) && all(lessThan(vWP, uCut1[i]))) { diffuseColor.rgb = vec3(0.035, 0.03, 0.028); totalEmissiveRadiance = vec3(0.0); }',
          '  }',
          '#ifdef CITY_WET',
          '  if (uWet > 0.001) diffuseColor.rgb *= 1.0 - uWetFar * uWet * smoothstep(0.85, 0.95, nW.y);',
          '#endif',
          '}'
        ].join('\n'))
        .replace('#include <aomap_fragment>', 'reflectedLight.directSpecular *= 0.3;\n#include <aomap_fragment>');
    };
    return m;
  }
  static get HIDE_SLOTS() { return 16; }
  static get CUT_SLOTS() { return 8; }
  static get ZONE_SLOTS() { return 12; }

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
    // furnCalm（game.js が復活のフレームに入れる）: そのフレームは予算の家具の仕事をしない（立っている建物の階は placeNow・update の中の点の分で済む）
    if (this.furn && player) this.furn.update(player, this.furnVel, this.furnCalm ? 0 : this._navLeft, this._navCapLeft);
    this.furnCalm = false;
    if (this.bake) { // 前もって作った遠景: 速さと 1 フレームの長さ（ゲーム中のダウンロードの保存を落ち着いたときに）
      const p = this._camPrev || (this._camPrev = { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z });
      const sp = dt > 0 ? Math.hypot(cameraPos.x - p.x, cameraPos.y - p.y, cameraPos.z - p.z) / dt : 0;
      p.x = cameraPos.x; p.y = cameraPos.y; p.z = cameraPos.z;
      this.bake.update(null, sp, dt * 1000);
    }
    this.streamer.update(cameraPos, forward);
    this.props.update(cameraPos);
    if (this.furnView) this.furnView.update(cameraPos);
    else if (((this.city.shipRooms && this.city.shipRooms.length) || this.shipRoomTest) && MR.InteriorsView) this.shipInside = MR.InteriorsView.prototype._insideOf.call({ world: this }, cameraPos); // 家具なし（?furn=0）でも船の部屋は室内
    if (this.doors && player) this.doors.update(dt, player, this.doorAgents || [player]);
    if (this.doorsView) this.doorsView.update();
    this.landmarks.update(cameraPos, time);
    if (this.water) this.water.update(dt, cameraPos, time || 0, this._lakeMeshes);
    // 地下（R4 §4.3 の最初の分。nyc-complete NC5）: カメラが地面の下の空洞の中なら水面（川の板・湖）を描かない（visible だけ = プログラムは変わらない）。
    //   空洞の無い街では何もしない。空と地上の物は空洞の殻（cat 'under'）が隠す
    if (this.nav && this.nav._nVoid) {
      const u = this.nav.underground(cameraPos.x, cameraPos.y, cameraPos.z);
      if (u !== !!this.underground) {
        this.underground = u;
        if (this.water && this.water.mesh) this.water.mesh.visible = !u;
        for (const m of this._lakeMeshes || []) m.visible = !u;
      }
    } else if (this.underground) {
      this.underground = false;
      if (this.water && this.water.mesh) this.water.mesh.visible = true;
      for (const m of this._lakeMeshes || []) m.visible = true;
    }
    this._surfaceHide(cameraPos);
  }

  // 地下の間は地上を描かない（nyc-complete NC6 = rail-r4 §4.3。visible だけ = プログラムは変わらない）。駅の口（rail.pits）から
  //   render.city.underground.openingRange m の中では近景のチャンク（ext / int）と地面は残し（階段の上に通りが見える）、遠景・スカイライン・小物・
  //   ランドマークだけ隠す。外では地上を全部隠す（under のグループだけ）。持ち主が毎フレーム書く物（int・スカイライン）は持ち主の後にここで隠す
  _surfaceHide(cam) {
    let lv = 0;
    const R = this.city && this.city.rail;
    if (this.underground && R && R.pits) {
      const rg = (this.cfg.underground && this.cfg.underground.openingRange) || 14, dep = (this.cfg.underground && this.cfg.underground.openingDepth) || 4;
      lv = 2;
      // 口の近く = 横に openingRange m・穴の底から openingDepth m より上（下のホーム・7 の階は口が見えないので地上を描かない）
      for (const p of R.pits) if (Math.abs(p.x - cam.x) < rg && Math.abs(p.z - cam.z) < rg && cam.y > p.y - dep) { lv = 1; break; }
    }
    const H = this._hid || (this._hid = new Map());
    // 地上（地下でない）: 駅の口から openingRange m の中のチャンクの under だけ描く（通りから見えるのは口の中だけ = 地上の描画は +8 回まで）
    let near = null;
    if (!lv && R && R.pits && R.pits.length) {
      const rg = (this.cfg.underground && this.cfg.underground.openingRange) || 14;
      near = new Set();
      for (const p of R.pits) if (Math.abs(p.x - cam.x) < rg && Math.abs(p.z - cam.z) < rg) { const c = this.city.chunkOf(p.x, p.z); near.add('chunk:' + this.city.chunkKey(c.cx, c.cz)); }
    }
    if (!lv && !near && !H.size) return;
    this.surfaceLevel = lv;
    const want = new Set();
    if (near) for (const ch of this.root.children) if (ch.name && ch.name.indexOf('chunk:') === 0 && !near.has(ch.name)) for (const g of ch.children) if (g.name === 'under' && g.children.length) want.add(g);
    if (lv) {
      const statics = new Set(this.meshes || []);
      for (const ch of this.root.children) {
        if (ch.name && ch.name.indexOf('chunk:') === 0) {
          if (lv < 2) continue;
          for (const g of ch.children) if (g.name !== 'under') want.add(g);
        } else if (lv >= 2 || !statics.has(ch)) want.add(ch);
      }
    }
    for (const [o, v] of H) if (!want.has(o) || !o.parent) { o.visible = v; H.delete(o); }
    for (const o of want) {
      if (!H.has(o) || o.visible) H.set(o, o.visible);
      o.visible = false;
    }
  }

  // 口の視錐台（nyc-complete NC6 の直し。surfaceLevel 1 = 地下で口の近く）: カメラから駅の口（歩道の上面の穴の長方形を portalPad m 広げた物）を
  //   通して見える所だけ。地上の物はこの外なら見えない（地面・岩・殻が隠す）。返り値: 視錐台の数（0 = 口の近くでない、−1 = カメラが口の高さに
  //   近い = 切らない）。毎フレーム使い回す（THREE の物は最初の数個だけ作る）
  portalSetup(cam) {
    const R = this.city && this.city.rail;
    if (this.surfaceLevel !== 1 || !R || !R.pits) return 0;
    const U = this.cfg.underground || {}, rg = U.openingRange || 14, dep = U.openingDepth || 4, pad = U.portalPad != null ? U.portalPad : 0.5;
    const F = this._pf || (this._pf = []), v = this._pv || (this._pv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    let n = 0;
    for (const p of R.pits) {
      if (!(Math.abs(p.x - cam.x) < rg && Math.abs(p.z - cam.z) < rg && cam.y > p.y - dep)) continue;
      const top = p.top != null ? p.top : 0.15;
      if (cam.y > top - (U.portalLip || 0.3)) return -1; // 口の高さの近く（視錐台がつぶれる）: 切らない
      const f = F[n] || (F[n] = new THREE.Frustum());
      const vx = -p.uz, vz = p.ux, hl = p.hl + pad, hw = p.hw + pad;
      const C = v[4].copy(cam), M = v[5].set(p.x, top, p.z);
      const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 4; i++) {
        const a = k[i], b = k[(i + 1) & 3];
        v[0].set(p.x + p.ux * hl * a[0] + vx * hw * a[1], top, p.z + p.uz * hl * a[0] + vz * hw * a[1]).sub(C);
        v[1].set(p.x + p.ux * hl * b[0] + vx * hw * b[1], top, p.z + p.uz * hl * b[0] + vz * hw * b[1]).sub(C);
        v[2].crossVectors(v[0], v[1]).normalize();
        const pl = f.planes[i].setFromNormalAndCoplanarPoint(v[2], C);
        v[3].copy(M).sub(C).multiplyScalar(2).add(C); // 口の向こう（口の真ん中の 2 倍の所）が内側
        if (pl.distanceToPoint(v[3]) < 0) pl.negate();
      }
      f.planes[4].set(v[2].set(0, 1, 0), -(top - 0.3)); // 口の面より上
      f.planes[5].set(v[2].set(0, 1, 0), 1e7);          // （使わない）
      n++;
    }
    this._pfN = n;
    return n;
  }
  // 通りから口を通して下を見る視錐台（NC8 の直し: ほかのプレイヤーの駅の中の体と名前の札）。地上（surfaceLevel 0）のカメラから openingRange m の中の
  //   口ごとに、穴の長方形（portalPad m 広げた物）の 4 辺とカメラを通る面 + 口の面より下。返り値: 視錐台の数（0 = 近くに口が無い = 地下の物は
  //   みな地面と岩に隠れる、−1 = カメラが口の高さに近い = 切らない）。portalSees* で使う（_pf を portalSetup と共有。同じフレームにどちらか一方）
  portalSetupStreet(cam) {
    const R = this.city && this.city.rail;
    this._pfN = 0;
    if (this.surfaceLevel || !R || !R.pits) return 0;
    const U = this.cfg.underground || {}, rg = U.openingRange || 14, pad = U.portalPad != null ? U.portalPad : 0.5;
    const F = this._pf || (this._pf = []), v = this._pv || (this._pv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    let n = 0;
    for (const p of R.pits) {
      if (!(Math.abs(p.x - cam.x) < rg && Math.abs(p.z - cam.z) < rg)) continue;
      const top = p.top != null ? p.top : 0.15;
      if (cam.y < top + (U.portalLip || 0.3)) return -1;
      const f = F[n] || (F[n] = new THREE.Frustum());
      const vx = -p.uz, vz = p.ux, hl = p.hl + pad, hw = p.hw + pad;
      const C = v[4].copy(cam), M = v[5].set(p.x, top, p.z);
      const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 4; i++) {
        const a = k[i], b = k[(i + 1) & 3];
        v[0].set(p.x + p.ux * hl * a[0] + vx * hw * a[1], top, p.z + p.uz * hl * a[0] + vz * hw * a[1]).sub(C);
        v[1].set(p.x + p.ux * hl * b[0] + vx * hw * b[1], top, p.z + p.uz * hl * b[0] + vz * hw * b[1]).sub(C);
        v[2].crossVectors(v[0], v[1]).normalize();
        const pl = f.planes[i].setFromNormalAndCoplanarPoint(v[2], C);
        v[3].copy(M).sub(C).multiplyScalar(2).add(C);
        if (pl.distanceToPoint(v[3]) < 0) pl.negate();
      }
      f.planes[4].set(v[2].set(0, -1, 0), top + 0.3); // 口の面より下
      f.planes[5].set(v[2].set(0, 1, 0), 1e7);
      n++;
    }
    this._pfN = n;
    return n;
  }
  // 箱 / 球が口の視錐台のどれかに入るか（portalSetup の後）
  portalSeesBox(box) { for (let i = 0; i < this._pfN; i++) if (this._pf[i].intersectsBox(box)) return true; return false; }
  portalSeesSphere(s) { for (let i = 0; i < this._pfN; i++) if (this._pf[i].intersectsSphere(s)) return true; return false; }
  // 地上の近景のチャンク（ext / int / dx。under は地下なので残す）のメッシュのうち、口の視錐台の外の物を隠して out に入れる（描いた後に
  //   game.js が戻す = 持ち主の visible を上書きしない）。返り値は portalSetup と同じ
  portalHide(cam, out) {
    const n = this.portalSetup(cam);
    if (n <= 0) return n;
    for (const ch of this.root.children) {
      if (!ch.visible || !ch.name || ch.name.indexOf('chunk:') !== 0) continue;
      for (const g of ch.children) {
        if (!g.visible || g.name === 'under') continue;
        if (g.isMesh) { if (g.name === 'shadowCaster' || !this._portalMesh(g)) { g.visible = false; out.push(g); } continue; } // 影の外形: 地下では影を描かない
        for (const m of g.children) if (m.visible && m.isMesh && !this._portalMesh(m)) { m.visible = false; out.push(m); }
      }
    }
    return n;
  }
  _portalMesh(m) {
    let b = m.userData.pbox;
    if (!b) {
      const geo = m.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      m.updateMatrixWorld();
      b = m.userData.pbox = geo.boundingBox.clone().applyMatrix4(m.matrixWorld);
    }
    return this.portalSeesBox(b);
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
    this._navLeft = this.navBudget != null ? Math.max(1, this.navBudget) : null; this._navCapLeft = this.navMsCap; // 家具（furn.update）が使う残り
    if (this._navSig === sig && !this._navPending && !this._navRemoveLeft) return;
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
      // v2: タイルがまだ（chunkFull が null。city.request で頼んである）→ 次のフレームでまた見る（数えない・止めない）
      if (!d) { if (this.city.request) { this.city.request(+p[0], +p[1], mine ? 1e6 : 0); pending = true; } continue; }
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
    this._navLeft = budgeted ? Math.max(0, ops) : null;
    if (budgeted) {
      const ms = now() - t0, st = this.navStats || (this.navStats = { calls: 0, msMax: 0, msSum: 0, pendingFrames: 0, cappedFrames: 0, opsMax: 0 });
      st.calls++; st.msSum += ms; if (ms > st.msMax) st.msMax = ms; if (pending) st.pendingFrames++; if (capped) st.cappedFrames++; if (done > st.opsMax) st.opsMax = done;
      this.navMs = ms;
      this._navCapLeft = cap < Infinity ? Math.max(0.01, cap - ms) : null;
    }
    // 遠くなったチャンクを外すのは 1 回に navRemovePerFrame 個まで（残りは次のフレーム。遠いので当たり判定には要らない）: 遠くへの復活・置き直しで
    //   前の場所の 13 個を同じフレームで外すと iPad の形で 4〜5 ms（復活のフレームが 40 ms を超えていた。tools/respawn-touch.js の revive）
    const far = (ch, cc) => Math.max(Math.abs(ch.cx - cc.cx), Math.abs(ch.cz - cc.cz)) > R + 1;
    const remMax = this.cfg.navRemovePerFrame > 0 ? this.cfg.navRemovePerFrame : Infinity;
    let removed = 0;
    this._navRemoveLeft = false;
    for (const ch of Array.from(this.nav.chunks.values())) {
      if (ch.furn) continue; // 家具（cx_cz#f）は this.furn が出し入れする
      if (far(ch, c) && (!lead || far(ch, lead)) && keep.indexOf(ch.key) < 0) {
        if (removed >= remMax) { this._navRemoveLeft = true; break; }
        this.nav.removeChunk(ch.key); this.cache.unpin(ch.key, 'nav'); this.navVer = (this.navVer || 0) + 1; removed++;
      }
    }
  }

  // 置き直し（開始・復活・自由カメラから戻る・乗り物から降りる・テストの瞬間移動）: その場の当たり判定を今すぐ全部読む。
  //   先読みの位置と予算を消してから（前のフレームの車の先の位置を読まない・予算で残さない）。次のフレームの game._updateCity がまた入れる
  loadNavNow(x, z, y) {
    this.navLead = null; this.navBudget = null; this.navMsCap = null;
    this.updateNav(x, z);
    // 家具: その点を含む建物のチャンクだけ今すぐ（ほかは予算で後から）。y（上限の目安）があれば、その下の立てる面の階だけ
    if (y != null) { const g = this.nav.groundHeight(x, z, y, 0.2); if (g != null) y = g; }
    if (this.furn) this.furn.placeNow(x, z, y);
  }

  // 家具の箱の中の足元 (x, y, z) → 同じ建物・同じ階の近い空いた所（無ければ扉の点）。家具の中でなければ null
  furnSafeSpot(x, y, z, r) { return this.furn ? this.furn.safeSpot(x, y, z, r) : null; }

  // 遠くても当たり判定に残すチャンク（敵のいるチャンク）。同じなら何もしない
  setNavKeep(keys) {
    const a = (keys || []).slice().sort();
    const s = a.join(',');
    if (s === this._keepSig) return;
    this._keepSig = s;
    this.navKeep = a;
    this._keepVer = (this._keepVer || 0) + 1;
  }

  // GLB のランドマークが読めた（lmLoaded に入れた後）: 出来上がっている近景・遠景から代わりの箱の部分を切る（streamer.invalidateLandmarks）
  onLandmarksLoaded(nodes) {
    if (this.streamer) this.streamer.invalidateLandmarks(nodes);
  }

  // 自動テスト用: 出来上がっている形ごとの指紋（属性の配列・インデックス・drawRange・境界）。前もって作った形とその場で作った形が同じか
  //   （tools/city-bake-e2e.js・screenshot.js・smoke の 16）。{ 'full:cx_cz' | 'lod:sx_sz' | 'sky:sx_sz': 16 進 }
  debugMeshHash(kinds) {
    const out = {}, want = kinds || ['full', 'lod', 'sky'];
    const fnv = (h, b) => { for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } return h; };
    const hashObj = (obj) => {
      let h = 0x811c9dc5 | 0;
      obj.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry, s = o.name + '|' + o.visible + '|' + g.drawRange.start + '|' + g.drawRange.count + '|' + (g.index ? g.index.array.constructor.name : '') +
          '|' + (g.boundingBox ? [g.boundingBox.min.x, g.boundingBox.min.y, g.boundingBox.min.z, g.boundingBox.max.x, g.boundingBox.max.y, g.boundingBox.max.z].join(',') : '') +
          '|' + (g.boundingSphere ? [g.boundingSphere.center.x, g.boundingSphere.center.y, g.boundingSphere.center.z, g.boundingSphere.radius].join(',') : '') +
          '|' + JSON.stringify(g.userData.segs || null);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        for (const k of Object.keys(g.attributes)) {
          const a = g.attributes[k];
          for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
          h = fnv(h, new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
        }
        if (g.index) h = fnv(h, new Uint8Array(g.index.array.buffer, g.index.array.byteOffset, g.index.array.byteLength));
      });
      return (h >>> 0).toString(16).padStart(8, '0');
    };
    const S = this.streamer;
    if (!S) return out;
    if (want.indexOf('full') >= 0) for (const r of S.full.values()) if (r.state === 'built' && r.out) out['full:' + r.key] = hashObj(r.out.root);
    if (want.indexOf('lod') >= 0) for (const r of S.lod.values()) if (r.state === 'built' && !r.job) out['lod:' + r.key] = r.out ? hashObj(r.out.mesh) : 'null';
    if (want.indexOf('sky') >= 0) for (const [k, s] of S.sky) out['sky:' + k] = hashObj(s.mesh);
    return out;
  }

  // 自動テスト・デバッグ用の数字
  info() {
    const s = this.streamer ? this.streamer.stats : {};
    return Object.assign({}, s, { geoLive: this.stats.live, geoCreated: this.stats.geoCreated, geoDisposed: this.stats.geoDisposed,
      cache: this.cache.size, cacheGenerated: this.cache.stats.generated, navChunks: this.nav.chunks.size - (this.furn ? this.furn.navCount() : 0), furn: this.furn ? this.furn.info() : null,
      furnView: this.furnView ? this.furnView.info() : null, props: this.props.count, propsVisible: this.props.visible, propsSource: this.propsSource, landmarks: this.landmarkSource });
  }

  dispose() {
    if (this.bake && !this.disposed) this.bake.release();
    this.disposed = true;
    if (this.streamer) this.streamer.dispose();
    if (this.props) this.props.dispose();
    if (this.landmarks) this.landmarks.dispose();
    if (this.water) this.water.dispose();
    if (this.furnView) this.furnView.dispose();
    if (this.furn) this.furn.clear();
    if (this.doorsView) this.doorsView.dispose();
    if (this.doors) this.doors.clear();
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

  // 影を落とさない小さな種類（高さ 約 1.3 m 未満。render.city.propNoShadow で上書き）。木（tree / 遠い塊）はいつも落とさない
  static get NO_SHADOW() { return ['hydrant', 'trash_can', 'bench', 'planter', 'mailbox', 'jersey_barrier', 'crate']; }

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
    // 視錐台で 1 つずつ間引く（L0。render.city.propCull）: view = 描くカメラ（game.js が入れる。無ければ今まで通り近くを全部）
    this.view = null;
    this.visible = 0;      // 最後に並べた（視錐台 + 影の届く所）インスタンスの数
    this._cand = {};       // type → 近くの候補（4 m ごとに作り直す。配列は使い回す）
    this._vis = [];        // 間引いた結果（使い回す）
    this._last = new Float64Array(14).fill(NaN); // 最後に間引いたときのカメラ（位置・前・上・fov・aspect）と太陽の向き
    this.stats = { culls: 0, writes: 0, skips: 0 }; // 間引いた回数・種類ごとに書いた回数・前と同じで書かなかった回数
    this._types = [];      // Object.keys(this.kinds) の控え（_setKind で更新。毎回の配列を作らない）
    // 太陽の向き: sun = 生きている向き（game.js が sky.sunDir を入れる。空の設定が変われば次の間引きで追う）。無ければレベルの値
    this.sun = null;
    const sd = (world.level && world.level.sky && world.level.sky.sunDir) || [-0.55, 0.32, -0.45];
    this._sun0 = { x: sd[0], y: sd[1], z: sd[2] };
    this._setSun(this._sun0);
    const ns = Array.isArray(this.cfg.propNoShadow) ? this.cfg.propNoShadow : CityProps.NO_SHADOW;
    this._noShadow = new Set(ns.concat(['tree', '_blob']));
    this._buildProcedural();
    // 遠い木の塊
    const bg = new MR.CityGeo({ uv: false, vcap: 8 });
    MR.CityWorld.treeBlob(bg, 0, 0, 0, 0, 1);
    this._blobGeo = bg.toGeometry();
    this._own.push(this._blobGeo);
    this._setKind('_blob', [{ geo: this._blobGeo, mat: world.mat('foliage') }]);
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
      this._setKind(type, [{ geo, mat }]);
    }
  }

  // 影の向き（太陽の反対、水平）と高さ 1 m あたりの影の長さ（cot 仰角）
  _setSun(sd) {
    const sl = Math.hypot(sd.x, sd.y, sd.z) || 1, sh = Math.hypot(sd.x, sd.z);
    this._shX = sh > 1e-6 ? -sd.x / sh : 0; this._shZ = sh > 1e-6 ? -sd.z / sh : 0;
    this._shK = sd.y / sl > 0.05 ? sh / sd.y : 0;
  }

  // 種類の形を差し替える（今の InstancedMesh は捨てて作り直す）。影を落とすかは propNoShadow。
  //   cy / r: 足元の原点を Y 軸で回しても形が入る球（中心 (0, cy, 0)）、h: 高さ（影の長さ）
  _setKind(type, parts) {
    const old = this.kinds[type];
    if (old) for (const m of old.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
    let x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0;
    for (const p of parts) {
      if (!p.geo.boundingBox) p.geo.computeBoundingBox();
      const b = p.geo.boundingBox;
      x0 = Math.min(x0, b.min.x); y0 = Math.min(y0, b.min.y); z0 = Math.min(z0, b.min.z);
      x1 = Math.max(x1, b.max.x); y1 = Math.max(y1, b.max.y); z1 = Math.max(z1, b.max.z);
    }
    const cy = (y0 + y1) / 2, rh = Math.max(Math.hypot(x0, z0), Math.hypot(x0, z1), Math.hypot(x1, z0), Math.hypot(x1, z1));
    this.kinds[type] = { parts, meshes: [], cap: 0, n: 0, castShadow: !this._noShadow.has(type), cy, r: Math.hypot(rh, (y1 - y0) / 2), h: y1 };
    if (!this._cand[type]) this._cand[type] = [];
    this._types = Object.keys(this.kinds);
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
    // 遠い木の板（hq3d Q5。tools/gen/build_tree_cards.py。render.city.treeCards: false / ?kit=0 で今まで通りの塊）
    const cardKey = (this.cfg.treeCards !== false && (!MR.ViewArms || MR.ViewArms.kitOn(this.cfg))) ? assets.resolve('models/tree_cards.glb') : null;
    if (cardKey) jobs.push(Promise.resolve(assets.loadModel(cardKey)).then((gltf) => (this._applyCards(gltf) ? 0 : 0)));
    // 街の細かい物（hq3d Q3。citykit.js が置く・ここで描く）
    // v2 の街（manhattan）は区画（city.lots）が無いので出さない（b14: CityKit.job は v1 の chunkFull と lots から置く）
    const kitKey = this.cfg.cityKitOn && this.world.city.version !== 2 ? assets.resolve('models/city_kit.glb') : null;
    if (kitKey) jobs.push(Promise.resolve(assets.loadModel(kitKey)).then((gltf) => (this._applyKit(gltf) ? 0 : 0)));
    return Promise.all(jobs.map((p) => p.catch((e) => { console.warn('[City] 小物の GLB を読めません。コードの形のまま:', e && e.message); return 0; })))
      .then((n) => { const ok = n.some((k) => k > 0); if (ok) world.propsSource = 'files'; return ok; });
  }

  // 遠い木（_blob の種類）を板に替える: カメラの方を向き（木の Y の周り）、木から見たカメラの向きで 8 方向の絵のどれかを選ぶ。
  // 形は 8 方向の輪郭を囲む多角形（アルファテストで捨てる画素を減らす）。影は落とさない（今の塊と同じ）
  _applyCards(gltf) {
    if (this.world.disposed) return false;
    const root = gltf && (gltf.scene || gltf);
    const node = root && MR.World.findNode(root, 'tree_card');
    let mesh = null;
    if (node) node.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh || !mesh.material || !mesh.material.map) return false;
    const ex = (node.userData && node.userData.cols) ? node.userData : (mesh.userData || {});
    const cols = ex.cols || 4, rows = ex.rows || 2, cells = ex.cells || 8;
    const mat = new THREE.MeshStandardMaterial({ map: mesh.material.map, color: new THREE.Color(1, 1, 1).multiplyScalar(this.cfg.treeCardTint > 0 ? this.cfg.treeCardTint : 1), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    mat.name = 'treeCard';
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', [
        'vec3 tcC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
        'vec3 tcTo = cameraPosition - tcC; tcTo.y = 0.0;',
        'float tcL = length(tcTo);',
        'vec3 tcF = tcL > 1e-4 ? tcTo / tcL : vec3(0.0, 0.0, 1.0);',
        'vec3 tcR = vec3(tcF.z, 0.0, -tcF.x);',
        'vec4 mvPosition = viewMatrix * vec4(tcC + tcR * transformed.x + vec3(0.0, transformed.y, 0.0), 1.0);',
        'gl_Position = projectionMatrix * mvPosition;',
        'vec3 tc0 = (modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz, tc2 = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;',
        'float tcA = atan(dot(tc0.xz, tcTo.xz), dot(tc2.xz, tcTo.xz));',
        'float tcK = mod(floor(tcA / ' + (2 * Math.PI / cells).toFixed(6) + ' + 0.5) + ' + cells.toFixed(1) + ', ' + cells.toFixed(1) + ');',
        'vec2 tcCell = vec2(mod(tcK, ' + cols.toFixed(1) + '), floor(tcK / ' + cols.toFixed(1) + '));',
        '#ifdef USE_UV',
        'vUv = (uv + tcCell) / vec2(' + cols.toFixed(1) + ', ' + rows.toFixed(1) + ');',
        '#endif',
        'vNormal = normalize((viewMatrix * vec4(normalize(tcF * 0.55 + vec3(0.0, 0.8, 0.0)), 0.0)).xyz);'
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'treeCard' + cells;
    this._own.push(mat);
    this._setKind('_blob', [{ geo: mesh.geometry, mat }]);
    this.treeCards = true;
    return true;
  }

  // 街の細かい物の形（city_kit.glb）。1 つの材質（頂点色 × 部品ごとの色。色は uv.x の割合だけ = 日よけの縞・看板の面・旗）、影なし
  _applyKit(gltf) {
    if (this.world.disposed || !MR.CityKit) return false;
    const root = gltf && (gltf.scene || gltf);
    if (!root) return false;
    const kc = this.cfg.cityKit || {};
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
    mat.name = 'cityKit';
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', [
        '#ifdef USE_COLOR',
        'vColor = color.xyz;',
        '#ifdef USE_INSTANCING_COLOR',
        'vColor *= mix(vec3(1.0), instanceColor.xyz, uv.x);',
        '#endif',
        '#endif'
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'cityKit';
    this._own.push(mat);
    const pal = (kc.palette || ['#8e2b26', '#2f5a3a', '#25425f', '#7a5a2a', '#5a2f4f', '#3f3f3f']).map((h) => MR.srgb(h));
    this._kitPal = pal;
    let n = 0;
    this._kitTris = {};
    for (const type of MR.CityKit.TYPES) {
      const node = MR.World.findNode(root, type);
      let mesh = null;
      if (node) node.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) continue;
      this._noShadow.add(type);
      this._setKind(type, [{ geo: mesh.geometry, mat }]);
      this.kinds[type].tint = true;
      this._kitTris[type] = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
      n++;
    }
    if (!n) return false;
    this.kit = { jobs: new Map(), placed: 0, chunks: 0, ms: 0, msMax: 0, trisDrawn: 0, frames: [] };
    this._dirty = true;
    return true;
  }

  // 置き方の仕事を進める（近景のチャンクのうち、データがキャッシュにあって置き方がまだのもの）。1 フレーム cityKit.ms ms まで
  _kitStep(streamer) {
    const K = this.kit, kc = this.cfg.cityKit || {};
    const budget = kc.ms > 0 ? kc.ms : 1.5, t0 = MR.CityWorld.now();
    let done = false;
    for (const rec of streamer.full.values()) {
      if (rec.state !== 'built' || !rec.out || rec.kitOut) continue;
      let j = K.jobs.get(rec);
      if (!j) {
        if (!this.world.cache.has(rec.cx, rec.cz)) continue;
        j = MR.CityKit.job(this.world.cache.full(rec.cx, rec.cz), kc, null, this.world.city);
        K.jobs.set(rec, j);
      }
      let r = j.next();
      while (!r.done && MR.CityWorld.now() - t0 < budget) r = j.next();
      if (r.done) { rec.kitOut = r.value; K.jobs.delete(rec); K.chunks++; K.placed += r.value.length; done = true; }
      if (MR.CityWorld.now() - t0 >= budget) break;
    }
    // 外れたチャンクの仕事は捨てる（_dropFull は state を変えずに full から消すので、今の full の記録か・out があるかで見る）
    for (const rec of K.jobs.keys()) if (streamer.full.get(rec.key) !== rec || !rec.out || rec.state !== 'built') K.jobs.delete(rec);
    const ms = MR.CityWorld.now() - t0;
    K.ms += ms; if (ms > K.msMax) K.msMax = ms;
    if (ms > 0.05 && K.frames.length < 2000) K.frames.push(ms); // 仕事をしたフレームの ms（p95 は smoke-kit / bench が見る）
    if (done) this._dirty = true;
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
      this._setKind(type, parts);
      if (type === 'crate') {
        // 2 段の木箱（2 段目は少し回す）
        const top = new THREE.Matrix4().makeRotationY(0.35).premultiply(new THREE.Matrix4().makeTranslation(0, 1.25, 0));
        const tall = parts.map((p) => ({ geo: p.geo, mat: p.mat })).concat(parts.map((p) => { const g = p.geo.clone(); g.applyMatrix4(top); this._own.push(g); return { geo: g, mat: p.mat }; }));
        this._setKind('crate_tall', tall);
      }
      n++;
    }
    return n;
  }

  // 発光（街灯・信号・売店）を夕暮れ用に強める。textureMax.glb より大きいアトラスは縮める（タッチ端末）
  _tuneMaterial(m) {
    if (!m) return;
    // 発光は毎ゲーム（GLB の材質はキャッシュの物を使い回すので、時間帯 tod.js の lamps で変えた強さが次のゲームに残らない）。同じ値なら書かない
    if (m.emissiveMap && typeof this.cfg.propEmissive === 'number' && m.userData.mrPropEmissive !== this.cfg.propEmissive) {
      m.emissiveIntensity = this.cfg.propEmissive; m.userData.mrPropEmissive = this.cfg.propEmissive;
    }
    if (m.userData.mrCityTuned) return;
    m.userData.mrCityTuned = true;
    const tm = this.cfg.textureMax;
    if (tm) MR.CityWorld.limitTextures(m, tm.glb, tm.glbDetail || tm.glb, this._scaled || (this._scaled = new Map()));
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

  // 近景のチャンクの小物から、カメラの近くのもの（候補）を集める（4 m 動くか、チャンクが増減したとき）。
  //   L0: そのうえで、カメラが propCullMove m 動いた・propCullTurn 度回った・fov が変わったときだけ、候補のうち視錐台（左右上下を
  //   propCullWiden 度広げる）に入るものだけを InstancedMesh に書く（count = 見える数、境界の球も見えるものだけ → three の視錐台の間引きも効く）。
  //   影を落とす種類は球を太陽の反対へ影の長さ（高さ × cot 仰角、propShadowMax m まで）の半分ずらして広げて見る（画面の外の街灯の影も入る）。
  //   InstancedMesh の容量は候補の数で決める（回るたびに作り直さない）。view（カメラ）が無い・propCull: false なら今まで通り候補を全部
  update(cam) {
    const streamer = this.world.streamer;
    if (!streamer) return;
    if (this.kit) this._kitStep(streamer);
    let gathered = false;
    if (this._dirty || this._pos.distanceToSquared(cam) >= 16) {
      this._dirty = false;
      this._pos.copy(cam);
      this._gather(cam, streamer);
      gathered = true;
    }
    const v = this.view;
    if (!v || !v.matrixWorld || this.cfg.propCull === false) {
      if (!gathered) return;
      let n = 0;
      for (const type of this._types) { const c = this._cand[type]; this._fill(type, c, c.length); n += c.length; }
      this.visible = n;
      return;
    }
    if (!gathered && !this._moved(v)) return;
    this._cull(v);
  }

  _gather(cam, streamer) {
    const P = this.cfg.propDist, T = this.cfg.treeDist, P2 = P * P, T2 = T * T;
    const lists = this._cand;
    for (const k of this._types) lists[k].length = 0;
    let total = 0;
    for (const rec of streamer.full.values()) {
      if (rec.state !== 'built' || !rec.out) continue;
      for (const p of rec.out.props) {
        if (this.hide && this.hide(p)) continue; // 壊れた小物（destruct_view.js）
        const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
        if (p.type === 'tree') { (d2 < T2 ? lists.tree : lists._blob).push(p); total++; continue; }
        if (d2 > P2 || !lists[p.type] || !this.kinds[p.type]) continue;
        lists[p.type].push(p);
        total++;
      }
    }
    if (this.kit) total += this._gatherKit(cam, streamer);
    this.count = total;
  }

  // 街の細かい物: cityKit.dist m 以内を近い順に、三角形の合計が cityKit.maxTris を超えるまで
  _gatherKit(cam, streamer) {
    const kc = this.cfg.cityKit || {}, D = kc.dist > 0 ? kc.dist : 70, D2 = D * D, maxT = kc.maxTris > 0 ? kc.maxTris : 70000;
    const all = this._kitAll || (this._kitAll = []);
    all.length = 0;
    for (const rec of streamer.full.values()) {
      if (rec.state !== 'built' || !rec.kitOut) continue;
      for (const p of rec.kitOut) {
        const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > D2 || !this.kinds[p.type]) continue;
        if (this.hide && this.hide(p, 1.2)) continue; // 倒れた建物の壁の物（destruct_view.js。壁から出ている分 1.2 m。b17 の検証 B2 (d)）
        p._d2 = d2;
        all.push(p);
      }
    }
    all.sort((a, b) => a._d2 - b._d2);
    let tris = 0, n = 0;
    for (const p of all) {
      const t = this._kitTris[p.type] || 0;
      if (tris + t > maxT) break;
      tris += t;
      this._cand[p.type].push(p);
      n++;
    }
    this.kit.trisDrawn = tris;
    return n;
  }

  // 最後に間引いたときからカメラが動いた・回った・fov / aspect が変わったか
  _moved(v) {
    const e = v.matrixWorld.elements, L = this._last, cfg = this.cfg;
    const mv = cfg.propCullMove > 0 ? cfg.propCullMove : 0.5;
    const ct = Math.cos((cfg.propCullTurn > 0 ? cfg.propCullTurn : 3) * Math.PI / 180);
    const dx = e[12] - L[0], dy = e[13] - L[1], dz = e[14] - L[2];
    if (!(dx * dx + dy * dy + dz * dz < mv * mv)) return true; // NaN（初回）も
    const zl = Math.hypot(e[8], e[9], e[10]) || 1, yl = Math.hypot(e[4], e[5], e[6]) || 1;
    if (-(e[8] * L[3] + e[9] * L[4] + e[10] * L[5]) / zl < ct) return true;
    if ((e[4] * L[6] + e[5] * L[7] + e[6] * L[8]) / yl < ct) return true;
    // fov は propCullFov 度より変わったときだけ（車の速さ・撃った反動・照準で毎フレーム少しずつ変わる。_cull がその分広げて見る）
    if (!(Math.abs(v.fov - L[9]) <= this._fovTol()) || v.aspect !== L[10]) return true;
    const s = this.sun || this._sun0;
    return s.x !== L[11] || s.y !== L[12] || s.z !== L[13];
  }

  _fovTol() { return this.cfg.propCullFov >= 0 ? this.cfg.propCullFov : 0.5; }

  _cull(v) {
    const e = v.matrixWorld.elements, L = this._last, cfg = this.cfg;
    const xl = Math.hypot(e[0], e[1], e[2]) || 1, yl = Math.hypot(e[4], e[5], e[6]) || 1, zl = Math.hypot(e[8], e[9], e[10]) || 1;
    const Xx = e[0] / xl, Xy = e[1] / xl, Xz = e[2] / xl, Yx = e[4] / yl, Yy = e[5] / yl, Yz = e[6] / yl;
    const Fx = -e[8] / zl, Fy = -e[9] / zl, Fz = -e[10] / zl, px = e[12], py = e[13], pz = e[14];
    L[0] = px; L[1] = py; L[2] = pz; L[3] = Fx; L[4] = Fy; L[5] = Fz; L[6] = Yx; L[7] = Yy; L[8] = Yz; L[9] = v.fov; L[10] = v.aspect;
    this.stats.culls++;
    const sun = this.sun || this._sun0;
    if (sun.x !== L[11] || sun.y !== L[12] || sun.z !== L[13]) { this._setSun(sun); L[11] = sun.x; L[12] = sun.y; L[13] = sun.z; }
    const w = (cfg.propCullWiden >= 0 ? cfg.propCullWiden : 6) * Math.PI / 180;
    // 次に間引くまでに動く分（propCullMove m）は球の半径に、fov が変わる分（propCullFov 度）は角に足す（その間に入ってくる物を落とさない）
    const mv = cfg.propCullMove > 0 ? cfg.propCullMove : 0.5;
    const tv = Math.tan(Math.min(179, (v.fov || 60) + this._fovTol()) * Math.PI / 360);
    const hy = Math.min(1.55, Math.atan(tv) + w), hx = Math.min(1.55, Math.atan(tv * (v.aspect || 1)) + w);
    const ch = Math.cos(hx), sh = Math.sin(hx), cv = Math.cos(hy), sv = Math.sin(hy);
    const smax = cfg.propShadowMax >= 0 ? cfg.propShadowMax : 40;
    const vis = this._vis;
    let total = 0;
    const shX = this._shX, shZ = this._shZ, shK = this._shK;
    for (const type of this._types) {
      const k = this.kinds[type], cand = this._cand[type];
      vis.length = 0;
      const cast = k.castShadow && shK > 0;
      let r = k.r + mv, ox = 0, oy = 0, oz = 0;
      for (let i = 0; i < cand.length; i++) {
        const p = cand[i];
        if (cast) {
          // 影の線: 形の上から太陽の反対へ、影が落ちる面（通り = y 0。屋上・高架の上の物は下の通りまで）まで。横に propShadowMax m まで。
          //   球はその線の真ん中へずらし、線の半分の長さだけ広げる
          const hl = Math.min(smax, (k.h + (p.y > 0 ? p.y : 0)) * shK) / 2, hd = hl / shK;
          r = k.r + mv + Math.hypot(hl, hd); ox = shX * hl; oy = k.h - k.cy - hd; oz = shZ * hl;
        }
        const dx = p.x + ox - px, dy = p.y + k.cy + oy - py, dz = p.z + oz - pz;
        const f = dx * Fx + dy * Fy + dz * Fz, x = dx * Xx + dy * Xy + dz * Xz, y = dx * Yx + dy * Yy + dz * Yz;
        if (x * ch - f * sh > r || -x * ch - f * sh > r || y * cv - f * sv > r || -y * cv - f * sv > r) continue;
        vis.push(p);
      }
      this._fill(type, vis, cand.length);
      total += vis.length;
    }
    vis.length = 0;
    this.visible = total;
  }

  // list を InstancedMesh に書く。容量は capN（候補の数）で決める: 足りない・1/4 未満なら作り直す
  _fill(type, list, capN) {
    const k = this.kinds[type];
    const n = list.length;
    if (capN > k.cap || (k.cap > 64 && capN < k.cap / 4)) {
      // 古いインスタンスと「形の見かけ」（属性は共有。dispose で GPU のバッファが消えても次に使うときに作り直される）
      for (const m of k.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
      k.meshes = [];
      k.cap = Math.max(16, Math.ceil(capN * 1.5));
      k.lastOk = false;
      for (const part of k.parts) {
        const view = new THREE.BufferGeometry(); // 形の属性は共有（境界の球だけ自分の）
        for (const a of Object.keys(part.geo.attributes)) view.setAttribute(a, part.geo.attributes[a]);
        view.setIndex(part.geo.index);
        view.boundingSphere = new THREE.Sphere();
        const m = new THREE.InstancedMesh(view, part.mat, k.cap);
        if (k.tint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(k.cap * 3).fill(1), 3); // 街の細かい物の色（作るときから = シェーダーを作り直さない）
        m.name = 'prop:' + type;
        m.castShadow = k.castShadow;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.frustumCulled = true; // 境界の球は書いたインスタンスだけを囲む（下）
        m.count = 0;
        this.group.add(m);
        k.meshes.push(m);
      }
    }
    k.n = n;
    if (!k.meshes.length) return;
    // 書く物が前と同じなら書き直さない（インスタンスの行列の送り直しをしない）
    const last = k.last || (k.last = []);
    if (k.lastOk && last.length === n) {
      let same = true;
      for (let i = 0; i < n; i++) if (last[i] !== list[i]) { same = false; break; }
      if (same) { this.stats.skips++; return; }
    }
    this.stats.writes++;
    last.length = n;
    for (let i = 0; i < n; i++) last[i] = list[i];
    k.lastOk = true;
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
      if (k.tint && this._kitPal) { const c = this._kitPal[(p.tint | 0) % this._kitPal.length]; for (const m of k.meshes) m.setColorAt(i, c); }
    }
    for (let j = 0; j < k.meshes.length; j++) {
      const m = k.meshes[j];
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
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

// ランドマークの GLB（置き場所 landmarkPlacements() の glb = landmarks.glb / landmarks2.glb / skyhigh.glb / boats.glb … のノードを clone。置く物の無い GLB は読まない）。全部で 20 個あまりなので常に置き、
// 視錐台の外は three が描かない。読めたノードは world.lmLoaded に入れ、代わりの箱（lm 付き）を描かない（onLandmarksLoaded → cutSegments）
MR.CityLandmarks = class CityLandmarks {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'cityLandmarks';
    world.root.add(this.group);
    this.placed = [];
    // 夜の光（landmark_night.js。GLB の extras night の材質の強さ・航空障害灯）。render.city.landmarkNight
    this.night = MR.LandmarkNight ? new MR.LandmarkNight(world.cfg.landmarkNight) : null;
    if (this.night) this.group.add(this.night.group);
    this.ready = world.cfg.landmarks === false ? Promise.resolve(false) : this._load();
  }
  static get NO_SHADOW() { return { gct_chandelier: true, gct_info_booth: true, ferry_boat: true, tugboat: true }; }
  // 小さいもの・室内のものは近いときだけ出す（m）。テクスチャを GPU に上げるのも近づいてから
  static get NEAR_ONLY() { return { gct_chandelier: 150, gct_info_booth: 200, ferry_boat: 900, tugboat: 900, heliport_pad: 900 }; }
  // GLB の extras（userData）: 材質の toneMapped false → 光る材質（ブルームに乗る）。材質か自分・親のノードの noShadow → 影を落とさない（true を返す）
  static _extrasMaterial(o) {
    let ns = false;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const u = m && m.userData;
      if (!u) continue;
      if (u.toneMapped === false && m.toneMapped !== false) { m.toneMapped = false; m.needsUpdate = true; }
      if (u.noShadow) ns = true;
    }
    for (let q = o; q && !ns; q = q.parent) if (q.userData && q.userData.noShadow) ns = true;
    return ns;
  }
  update(cam, time) {
    if (this.night) this.night.update(time);
    for (const o of this.placed) {
      const f = o.userData.farOf;
      if (f) { // 遠景のノード: 近いノードと入れ替え
        const dx = f.position.x - cam.x, dy = f.position.y - cam.y, dz = f.position.z - cam.z, d = f.userData.farD;
        const near = dx * dx + dy * dy + dz * dz < d * d;
        f.visible = near; o.visible = !near;
        continue;
      }
      if (o.userData.farD) continue;
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
    const farD = typeof world.cfg.landmarkFar === 'number' ? world.cfg.landmarkFar : 600;
    // 読むファイルは置き場所の glb から（landmarks / landmarks2 / skyhigh / boats = 停泊中の船。boats 計画 §5.3.9。manhattan.json: landmarks〜landmarks4）。
    //   レベルの landmarkGlbs があればその順を先に（置く物の無い GLB は読まない）
    const plan = world.city.plan || {};
    const files = [];
    for (const p of placements) if (p.glb && files.indexOf(p.glb) < 0) files.push(p.glb);
    if (Array.isArray(plan.landmarkGlbs)) files.sort((a, b) => { const ia = plan.landmarkGlbs.indexOf(a), ib = plan.landmarkGlbs.indexOf(b); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib); });
    const jobs = files.map((file) => {
      const key = assets.resolve('models/' + file + '.glb');
      if (!key) return Promise.resolve([]);
      return Promise.resolve(assets.loadModel(key)).then((gltf) => {
        if (world.disposed) return [];
        const root = gltf && (gltf.scene || gltf);
        const loaded = [];
        // S7d: 門（landmarkWarm）があれば足す前に隠す（ファイルが別のフレームに届くと、先のファイルが門の前に描かれてテクスチャが上がっていた）
        if (typeof world.landmarkWarm === 'function') this.group.visible = false;
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
            o.castShadow = !CityLandmarks.NO_SHADOW[p.node] && !CityLandmarks._extrasMaterial(o);
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
          if (this.night) this.night.add(obj, p.node, false);
          // 遠景のノード（<名前>_far）があれば、landmarkFar m より遠いときはそちら（近いノードは隠す）。影は落とさない
          const farNode = root.getObjectByName(p.node + '_far');
          if (farNode) {
            const far = farNode.clone();
            far.position.copy(obj.position); far.rotation.copy(obj.rotation);
            far.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = false; o.receiveShadow = false;
              CityLandmarks._extrasMaterial(o);
              if (tm) for (const m of Array.isArray(o.material) ? o.material : [o.material]) MR.CityWorld.limitTextures(m, tm.glb, tm.glbDetail || tm.glb, this._scaled || (this._scaled = new Map()));
            });
            far.updateMatrixWorld(true);
            far.matrixAutoUpdate = false;
            far.visible = false;
            far.userData.farOf = obj;
            obj.userData.farD = farD;
            this.group.add(far);
            this.placed.push(far);
            if (this.night) this.night.add(far, p.node, true);
          }
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
      const go = () => {
        if (world.disposed) return false;
        this.group.visible = true;
        for (const n of names) world.lmLoaded[n] = true;
        world.landmarkSource = 'files';
        world.onLandmarksLoaded(names);
        return true;
      };
      // S7d: game.js が渡す landmarkWarm があれば、テクスチャを 1 フレーム warmMBPerFrame MB ずつ GPU に上げてから見せる（それまでは
      //   隠して代わりの箱のまま）。以前は初めて見えたフレームに全部（バトロワの輸送ヘリから 46〜58 MB を 1 フレーム）上がった
      const gate = world.landmarkWarm;
      if (typeof gate !== 'function') return go();
      this.group.visible = false;
      return new Promise((res) => { gate(this, () => res(go())); });
    });
  }
  dispose() {
    if (this.night) { this.night.dispose(); this.night = null; }
    if (this.group.parent) this.group.parent.remove(this.group);
    this.placed = [];
  }
};
