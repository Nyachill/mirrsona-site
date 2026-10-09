// 落ちている物の見た目（街）。MR.Loot.World の「まだある物」のうちカメラから drawDist m 以内を、種類ごとの InstancedMesh で並べる
// （種類は最大 15 + 光る輪 1 = 描画 16 回まで。チャンクの中身がどれだけ多くても増えない）。
//   形: models/loot.glb のノード（ammo_57 / ammo_556 / ammo_12g / ammo_338 / ammo_9mm / medkit / bandage / armor_vest / helmet / loot_ring）と
//       sd の武器 GLB（sd/models/<id>.glb）を横に寝かせたもの。読めるまで・無ければ色の付いた箱（フォールバック）。
//   輪: loot_ring（無ければコードで作った輪）を物の下に。色は種類で（武器 = 金、弾 = 口径の色、回復 = 緑、防具 = 青）。
//       テクスチャを回して（uv をずらす）ゆっくり回り、明るさが脈打つ。加算合成・トーンマップ無し（ブルームで光る）。
//   作り直し: カメラが 1 m 動いたか、World の version が変わったとき（物は動かないので毎フレームは作らない）。
window.MR = window.MR || {};

MR.LootView = class LootView {
  // scene: 置き場所、opts: { assets, cfg（Loot.config）, weaponDefs: { id: def }, drawDist, mobile }
  constructor(scene, opts) {
    opts = opts || {};
    this.scene = scene;
    this.assets = opts.assets || null;
    this.cfg = opts.cfg || MR.Loot.config();
    this.weaponDefs = opts.weaponDefs || {};
    this.drawDist = opts.drawDist || this.cfg.drawDist || 40;
    this.itemScale = this.cfg.itemScale || 1.35;
    this.weaponScale = this.cfg.weaponScale || 1.15;
    this.group = new THREE.Group();
    this.group.name = 'loot';
    scene.add(this.group);
    this.kinds = {};          // type → { parts: [{ geo, mat }], meshes, cap, n }
    this._own = [];           // 自分で作った形・マテリアル（dispose 用）
    this._pos = new THREE.Vector3(1e9, 0, 0);
    this._ver = -1;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._list = [];
    this.stats = { items: 0, meshes: 0, refills: 0, source: 'procedural', weapons: 'procedural' };
    this._buildProcedural();
    this._buildRing(null);
    this.ready = this._load();
  }

  // 種類 → 輪の色
  ringColor(type) {
    const it = MR.Loot.ITEMS[type] || {};
    const pal = this.cfg.ringColors || {};
    if (it.kind === 'weapon') return pal.weapon || '#ffcf4a';
    if (it.kind === 'ammo') return ((this.cfg.calibres || {})[it.cal] || {}).color || pal.ammo || '#e9c22a';
    if (it.kind === 'med') return pal.med || '#5ee08a';
    if (it.kind === 'armor') return pal.armor || '#5aaeff';
    return '#ffffff';
  }

  // 輪の色（MR.srgb で変換したものを種類ごとに覚えておく）
  _ringCol(type) {
    const c = this._cols || (this._cols = {});
    return c[type] || (c[type] = MR.srgb(this.ringColor(type)));
  }

  // ---------- 形 ----------

  // フォールバック: 種類ごとの色の箱（1 つの形・1 つのマテリアル）
  _buildProcedural() {
    const box = (w, h, d, extra) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, h / 2, 0);
      if (extra) {
        const g2 = new THREE.BoxGeometry(extra[0], extra[1], extra[2]);
        g2.translate(extra[3], extra[4] + extra[1] / 2, extra[5]);
        const merged = THREE.BufferGeometryUtils ? THREE.BufferGeometryUtils.mergeBufferGeometries([g, g2]) : g;
        if (merged !== g) { g.dispose(); g2.dispose(); }
        return merged;
      }
      return g;
    };
    const mat = (hex, emissive) => {
      const m = new THREE.MeshStandardMaterial({ color: MR.srgb(hex), roughness: 0.6, metalness: 0.15 });
      if (emissive) { m.emissive = MR.srgb(emissive); m.emissiveIntensity = 0.25; }
      this._own.push(m);
      return m;
    };
    const S = this.itemScale, WS = this.weaponScale;
    for (const type of Object.keys(MR.Loot.ITEMS)) {
      const it = MR.Loot.ITEMS[type];
      let geo, m;
      if (it.kind === 'weapon') {
        const len = type === 'pistol' ? 0.24 : type === 'p90' ? 0.5 : type === 'sniper' ? 1.15 : type === 'lmg' ? 1.0 : 0.85;
        geo = box(len * WS, 0.06 * WS, 0.16 * WS, [0.06 * WS, 0.06 * WS, 0.14 * WS, -len * 0.15 * WS, 0, 0.14 * WS]);
        m = mat('#2d3136', this.ringColor(type));
      } else if (it.kind === 'ammo') {
        geo = box(0.28 * S, 0.14 * S, 0.18 * S);
        m = mat(this.ringColor(type), null);
      } else if (type === 'medkit') { geo = box(0.38 * S, 0.13 * S, 0.28 * S); m = mat('#2f7a46', '#ffffff'); }
      else if (type === 'bandage') { geo = box(0.24 * S, 0.09 * S, 0.2 * S); m = mat('#d8c9a4', null); }
      else if (type === 'armor_vest') { geo = box(0.62 * S, 0.14 * S, 0.54 * S); m = mat('#4b5a3a', null); }
      else { geo = box(0.32 * S, 0.2 * S, 0.36 * S); m = mat('#4b5a3a', null); }
      geo.computeBoundingSphere();
      this._own.push(geo);
      this._setKind(type, [{ geo, mat: m }]);
    }
  }

  // 輪（loot.glb の loot_ring か、コードの輪）。tex = 輪のテクスチャ（GLB の）か null（コードで描く）
  _buildRing(part) {
    let geo, tex;
    if (part) { geo = part.geo; tex = part.mat && (part.mat.map || part.mat.emissiveMap); }
    if (!geo) geo = LootView.ringGeometry(0.55, 0.8, 48, 8);
    if (!tex) tex = LootView.ringTexture();
    if (tex) { tex.wrapS = THREE.RepeatWrapping; tex.needsUpdate = true; }
    const m = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide, fog: false });
    m.color.setScalar(this.cfg.ringGlow || 1.7);
    this._own.push(m);
    if (!part) this._own.push(geo);
    this.ringTex = tex;
    this.ringMat = m;
    const old = this.ring;
    if (old && old.mesh) { this.group.remove(old.mesh); old.mesh.dispose(); old.mesh.geometry.dispose(); }
    this.ring = { geo, mat: m, mesh: null, cap: 0, n: 0 };
    this._ver = -1;
  }

  // 輪の形: u = 角度（turns 回くり返す）、v = 内 → 外
  static ringGeometry(r0, r1, seg, turns) {
    const pos = [], uv = [], idx = [], nrm = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r0, 0.012, s * r0, c * r1, 0.012, s * r1);
      nrm.push(0, 1, 0, 0, 1, 0);
      uv.push(i / seg * turns, 0, i / seg * turns, 1);
      if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  // 輪のテクスチャ（白。縦 = 内→外のやわらかい帯、横 = 1 回の脈）
  static ringTexture() {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 16;
    const g = c.getContext && c.getContext('2d');
    if (!g || !g.createImageData) return null;
    const img = g.createImageData(64, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) {
      const v = (y + 0.5) / 16, band = Math.exp(-Math.pow((v - 0.55) / 0.22, 2));
      const pulse = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos((x / 64) * Math.PI * 2), 2);
      const a = Math.max(0, Math.min(1, band * pulse + 0.15 * Math.exp(-Math.pow((v - 0.9) / 0.06, 2))));
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
    }
    if (g.putImageData) g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  _setKind(type, parts) {
    const old = this.kinds[type];
    if (old) for (const m of old.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
    this.kinds[type] = { parts, meshes: [], cap: 0, n: 0 };
    this._ver = -1;
  }

  // GLB: loot.glb（共通）と sd の武器
  _load() {
    const a = this.assets;
    if (!a || typeof a.resolve !== 'function' || typeof a.loadModel !== 'function' || !THREE.GLTFLoader || this.cfg.models === false) return Promise.resolve(false);
    const jobs = [];
    const lootKey = a.resolve('models/loot.glb');
    if (lootKey) {
      jobs.push(Promise.resolve(a.loadModel(lootKey)).then((gltf) => {
        if (this.disposed) return 0;
        const root = gltf && (gltf.scene || gltf);
        if (!root || !root.traverse) return 0;
        root.updateMatrixWorld(true);
        let n = 0;
        for (const type of Object.keys(MR.Loot.ITEMS)) {
          if (MR.Loot.ITEMS[type].kind === 'weapon') continue;
          const node = MR.World.findNode(root, type);
          if (!node) continue;
          const parts = MR.CityProps.extract(node, 0);
          if (!parts.length) continue;
          for (const p of parts) { p.geo.scale(this.itemScale, this.itemScale, this.itemScale); p.geo.computeBoundingSphere(); this._own.push(p.geo); }
          this._setKind(type, parts);
          n++;
        }
        const rn = MR.World.findNode(root, 'loot_ring');
        if (rn) { const rp = MR.CityProps.extract(rn, 0); if (rp.length) { this._own.push(rp[0].geo); this._buildRing(rp[0]); } }
        if (n) this.stats.source = 'files';
        return n;
      }));
    }
    for (const type of Object.keys(MR.Loot.ITEMS)) {
      if (MR.Loot.ITEMS[type].kind !== 'weapon') continue;
      const def = this.weaponDefs[type];
      const file = (def && def.model && def.model.file) || ('models/' + type + '.glb');
      const key = a.resolve('sd/' + file.replace(/^(hd|sd)\//, ''));
      if (!key) continue;
      jobs.push(Promise.resolve(a.loadModel(key)).then((gltf) => {
        if (this.disposed) return 0;
        const root = gltf && (gltf.scene || gltf);
        if (!root || !root.traverse) return 0;
        const parts = LootView.flatWeapon(root, this.weaponScale);
        if (!parts.length) return 0;
        for (const p of parts) this._own.push(p.geo);
        this._setKind(type, parts);
        this.stats.weapons = 'files';
        return 1;
      }));
    }
    return Promise.all(jobs.map((p) => p.catch((e) => { console.warn('[Loot] モデルを読めません。箱のまま:', e && e.message); return 0; })))
      .then((n) => n.some((k) => k > 0));
  }

  // 武器を横に寝かせた形（左側面が上）: 銃口 -Z のまま Z 軸まわりに 90°、真ん中を原点に、底を y = 0 に。scale 倍
  static flatWeapon(root, scale) {
    const holder = new THREE.Group();
    const clone = root.clone();
    holder.add(clone);
    clone.rotation.z = Math.PI / 2;
    holder.updateMatrixWorld(true);
    const parts = MR.CityProps.extract(holder, 0);
    if (!parts.length) return parts;
    const bb = new THREE.Box3();
    for (const p of parts) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const m = new THREE.Matrix4().makeTranslation(-cx, -bb.min.y, -cz).premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    for (const p of parts) { p.geo.applyMatrix4(m); p.geo.computeBoundingSphere(); }
    return parts;
  }

  // ---------- 毎フレーム ----------

  // cam: カメラのワールド座標、world: MR.Loot.World、time: 秒
  update(dt, cam, world, time) {
    // 輪: テクスチャを回し、明るさを脈打たせる（作り直しは無し）
    if (this.ringTex) this.ringTex.offset.x = (time * (this.cfg.ringSpin || 0.06)) % 1;
    if (this.ringMat) this.ringMat.opacity = 0.72 + 0.28 * Math.sin(time * 2.6);
    if (!world) return;
    if (this._ver === world.version && this._pos.distanceToSquared(cam) < 1) return;
    this._ver = world.version;
    this._pos.copy(cam);
    this.stats.refills++;
    const D = this.drawDist;
    this._list.length = 0;
    const list = world.query(cam.x, cam.z, D, this._list);
    const by = {};
    let n = 0;
    for (const it of list) {
      const dy = it.y - cam.y;
      if (dy * dy > D * D) continue;
      (by[it.type] || (by[it.type] = [])).push(it);
      n++;
    }
    this.stats.items = n;
    let meshes = 0;
    for (const type of Object.keys(this.kinds)) meshes += this._fill(type, by[type] || []);
    meshes += this._fillRing(list, D, cam);
    this.stats.meshes = meshes;
  }

  _fill(type, list) {
    const k = this.kinds[type];
    const n = list.length;
    if (n > k.cap || (k.cap > 32 && n < k.cap / 4)) {
      for (const m of k.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
      k.meshes = [];
      k.cap = Math.max(8, Math.ceil(n * 1.5));
      for (const part of k.parts) {
        const view = new THREE.BufferGeometry();
        for (const a of Object.keys(part.geo.attributes)) view.setAttribute(a, part.geo.attributes[a]);
        view.setIndex(part.geo.index);
        view.boundingSphere = new THREE.Sphere();
        const m = new THREE.InstancedMesh(view, part.mat, k.cap);
        m.name = 'loot:' + type;
        m.castShadow = false;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.count = 0;
        this.group.add(m);
        k.meshes.push(m);
      }
    }
    k.n = n;
    if (!k.meshes.length) return 0;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const it = list[i];
      x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z);
      this._q.setFromAxisAngle(this._up, it.yaw || 0);
      this._p.set(it.x, it.y + 0.035, it.z);
      this._s.set(1, 1, 1);
      this._m.compose(this._p, this._q, this._s);
      for (const m of k.meshes) m.setMatrixAt(i, this._m);
    }
    for (let j = 0; j < k.meshes.length; j++) {
      const m = k.meshes[j];
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.visible = n > 0;
      if (n > 0) {
        const bs = k.parts[j].geo.boundingSphere;
        const r0 = bs ? bs.radius + bs.center.length() : 1;
        const c = m.geometry.boundingSphere.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        m.geometry.boundingSphere.radius = Math.hypot(x1 - c.x, y1 - c.y, z1 - c.z) + r0;
      }
    }
    return n > 0 ? k.meshes.length : 0;
  }

  _fillRing(list, D, cam) {
    const R = this.ring;
    // 輪は drawDist の内側（少し手前で消す。遠くの輪で画面がうるさくならないように）
    const RD = Math.min(D, this.cfg.ringDist || D), RD2 = RD * RD;
    let n = 0;
    for (const it of list) { const dx = it.x - cam.x, dy = it.y - cam.y, dz = it.z - cam.z; if (dx * dx + dy * dy + dz * dz <= RD2) n++; }
    if (!R.mesh && n === 0) return 0;
    if (!R.mesh || n > R.cap || (R.cap > 32 && n < R.cap / 4)) {
      if (R.mesh) { this.group.remove(R.mesh); R.mesh.dispose(); R.mesh.geometry.dispose(); }
      R.cap = Math.max(16, Math.ceil(n * 1.5));
      const view = new THREE.BufferGeometry();
      for (const a of Object.keys(R.geo.attributes)) view.setAttribute(a, R.geo.attributes[a]);
      view.setIndex(R.geo.index);
      view.boundingSphere = new THREE.Sphere();
      const m = new THREE.InstancedMesh(view, R.mat, R.cap);
      m.name = 'loot:ring';
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(R.cap * 3), 3);
      m.matrixAutoUpdate = false;
      m.renderOrder = 2;
      m.count = 0;
      this.group.add(m);
      R.mesh = m;
    }
    const m = R.mesh;
    let i = 0, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const it of list) {
      const dx = it.x - cam.x, dy = it.y - cam.y, dz = it.z - cam.z;
      if (dx * dx + dy * dy + dz * dz > RD2) continue;
      const kind = (MR.Loot.ITEMS[it.type] || {}).kind;
      const s = kind === 'weapon' ? (this.cfg.ringWeapon || 1.0) : (this.cfg.ringItem || 0.62);
      this._q.setFromAxisAngle(this._up, (it.yaw || 0) * 3);
      this._p.set(it.x, it.y + 0.02, it.z); // 床（歩道の上面・スラブ）から 3 cm ほど浮かせる（遠景の面と重なってちらつかない）
      this._s.set(s, 1, s);
      this._m.compose(this._p, this._q, this._s);
      m.setMatrixAt(i, this._m);
      m.setColorAt(i, this._ringCol(it.type));
      x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); y0 = Math.min(y0, it.y); y1 = Math.max(y1, it.y); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z);
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.visible = i > 0;
    if (i > 0) {
      const c = m.geometry.boundingSphere.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.geometry.boundingSphere.radius = Math.hypot(x1 - c.x, y1 - c.y, z1 - c.z) + 1;
    }
    return i > 0 ? 1 : 0;
  }

  dispose() {
    this.disposed = true;
    for (const k of Object.values(this.kinds)) for (const m of k.meshes) { this.group.remove(m); m.dispose(); m.geometry.dispose(); }
    if (this.ring && this.ring.mesh) { this.group.remove(this.ring.mesh); this.ring.mesh.dispose(); this.ring.mesh.geometry.dispose(); }
    for (const o of this._own) if (o && o.dispose) o.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
};
