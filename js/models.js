// 銃のモデル。銃口は -Z 方向、グリップがだいたい原点。
//   rifle() / shotgun() … コードでパーツから組み立てる（同じマテリアルのパーツは 1 メッシュに結合）。
//   load(def, assets)   … assets/<tier>/models/*.glb があればそれを複製して返す Promise<Group>。
//                         無い・読めないときは def.model.fallback（'rifle' | 'shotgun'）のコードモデルに倒す。
// どちらも group.userData に次の点（group ローカル座標、メートル）を持つ:
//   muzzle（銃口）, eject（排莢口）, sight（照準の光軸。ADS でカメラ軸に合わせる）, grip（握り）,
//   foregrip（前方の握り）, handR / handL（腕を置く位置）, source（'procedural' | 'glb'）
window.MR = window.MR || {};

MR.Models = (function () {
  function mats() {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    return {
      body: std({ color: MR.srgb('#2e333c'), roughness: 0.4, metalness: 0.7 }),
      dark: std({ color: MR.srgb('#1a1d22'), roughness: 0.45, metalness: 0.7 }),
      grip: std({ color: MR.srgb('#2b2a2a'), roughness: 0.9, metalness: 0.1 }),
      wood: std({ color: MR.srgb('#5a3a22'), roughness: 0.7, metalness: 0.05 }),
      steel: std({ color: MR.srgb('#8a9099'), roughness: 0.35, metalness: 0.9 }),
      glow: new THREE.MeshBasicMaterial({ color: MR.srgb('#ff3a3a') })
    };
  }

  // parts: [{ mat, geo, x, y, z, rx, ry, rz }]
  function build(parts, M) {
    const groups = {};
    for (const p of parts) {
      const m = new THREE.Matrix4().makeTranslation(p.x || 0, p.y || 0, p.z || 0);
      if (p.rx || p.ry || p.rz) m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0)));
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      g.applyMatrix4(m);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      (groups[p.mat] = groups[p.mat] || []).push(g);
    }
    const group = new THREE.Group();
    const utils = THREE.BufferGeometryUtils;
    const merge = utils && utils.mergeBufferGeometries ? (list) => utils.mergeBufferGeometries(list, false) : null;
    for (const key of Object.keys(groups)) {
      const list = groups[key];
      const geo = (merge && list.length > 1) ? merge(list) : list[0];
      const mesh = new THREE.Mesh(geo, M[key]);
      mesh.castShadow = true;
      group.add(mesh);
    }
    return group;
  }

  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (r1, r2, h, s) => new THREE.CylinderGeometry(r1, r2, h, s || 10);
  const numOr = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const arr3 = (v, d) => (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number' && isFinite(x))) ? v : d;

  let sharedMats = null;

  return {
    materials: mats,
    // 敵の銃など、たくさん作るものはマテリアルを共有する
    shared() { return sharedMats || (sharedMats = mats()); },

    // アサルトライフル。全長 ≒ 0.78m
    rifle(M) {
      M = M || mats();
      const parts = [
        { mat: 'body', geo: B(0.07, 0.11, 0.3), y: 0.05, z: -0.02 },                 // レシーバー
        { mat: 'dark', geo: B(0.05, 0.05, 0.06), y: 0.13, z: 0.05 },                  // チャージングハンドル周り
        { mat: 'body', geo: B(0.065, 0.075, 0.26), y: 0.045, z: -0.3 },              // ハンドガード
        { mat: 'dark', geo: C(0.016, 0.016, 0.28, 8), y: 0.07, z: -0.55, rx: Math.PI / 2 },  // バレル
        { mat: 'dark', geo: C(0.024, 0.024, 0.07, 8), y: 0.07, z: -0.68, rx: Math.PI / 2 },  // マズルブレーキ
        { mat: 'dark', geo: B(0.03, 0.025, 0.24), y: 0.1, z: -0.3 },                 // 上部レール
        { mat: 'grip', geo: B(0.045, 0.13, 0.055), y: -0.08, z: 0.04, rx: 0.25 },    // グリップ
        { mat: 'dark', geo: B(0.04, 0.17, 0.065), y: -0.1, z: -0.1, rx: -0.15 },     // マガジン
        { mat: 'body', geo: B(0.055, 0.075, 0.24), y: 0.03, z: 0.25 },               // ストック
        { mat: 'grip', geo: B(0.06, 0.09, 0.03), y: 0.02, z: 0.38 },                 // バットプレート
        { mat: 'dark', geo: B(0.02, 0.05, 0.03), y: 0.14, z: -0.42 },                // フロントサイト
        { mat: 'dark', geo: B(0.035, 0.045, 0.05), y: 0.145, z: 0.0 },               // ドットサイト本体
        { mat: 'glow', geo: B(0.012, 0.012, 0.005), y: 0.155, z: -0.027 },           // ドット
        { mat: 'dark', geo: B(0.02, 0.03, 0.08), y: 0.0, z: -0.42 }                  // トリガーガード風
      ];
      // ハンドガードの放熱スリット
      for (let i = 0; i < 5; i++) parts.push({ mat: 'dark', geo: B(0.075, 0.012, 0.012), y: 0.045, z: -0.2 - i * 0.045 });
      const g = build(parts, M);
      g.userData.muzzle = new THREE.Vector3(0, 0.07, -0.72);
      g.userData.eject = new THREE.Vector3(0.05, 0.08, -0.02);
      g.userData.sight = new THREE.Vector3(0, 0.155, -0.027);       // ドットサイトの光点
      g.userData.grip = new THREE.Vector3(0, -0.08, 0.04);
      g.userData.foregrip = new THREE.Vector3(0, 0.0, -0.3);
      g.userData.handR = new THREE.Vector3(0.01, -0.1, 0.05);        // 従来どおりの腕の位置
      g.userData.handL = new THREE.Vector3(-0.02, 0.0, -0.3);
      g.userData.source = 'procedural';
      return g;
    },

    // ポンプ式ショットガン。全長 ≒ 0.9m
    shotgun(M) {
      M = M || mats();
      const parts = [
        { mat: 'steel', geo: B(0.06, 0.09, 0.22), y: 0.05, z: 0.0 },                  // レシーバー
        { mat: 'dark', geo: C(0.017, 0.017, 0.5, 8), y: 0.075, z: -0.38, rx: Math.PI / 2 }, // バレル
        { mat: 'dark', geo: C(0.016, 0.016, 0.42, 8), y: 0.035, z: -0.33, rx: Math.PI / 2 }, // チューブマガジン
        { mat: 'wood', geo: B(0.06, 0.06, 0.16), y: 0.035, z: -0.26 },               // フォアエンド（ポンプ）
        { mat: 'wood', geo: B(0.05, 0.08, 0.28), y: 0.02, z: 0.26, rx: 0.08 },       // ストック
        { mat: 'grip', geo: B(0.06, 0.1, 0.03), y: 0.0, z: 0.41 },                   // バットプレート
        { mat: 'dark', geo: B(0.02, 0.05, 0.03), y: 0.12, z: -0.6 },                 // フロントビーズ
        { mat: 'dark', geo: B(0.03, 0.03, 0.06), y: -0.01, z: 0.03, rx: 0.4 }        // トリガー周り
      ];
      const g = build(parts, M);
      g.userData.muzzle = new THREE.Vector3(0, 0.075, -0.64);
      g.userData.eject = new THREE.Vector3(0.04, 0.06, 0.0);
      g.userData.sight = new THREE.Vector3(0, 0.14, -0.1);            // フロントビーズ越しの照準線
      g.userData.grip = new THREE.Vector3(0, -0.03, 0.06);
      g.userData.foregrip = new THREE.Vector3(0, 0.0, -0.27);
      g.userData.handR = new THREE.Vector3(0.01, -0.1, 0.05);
      g.userData.handL = new THREE.Vector3(-0.02, 0.0, -0.27);
      g.userData.source = 'procedural';
      return g;
    },

    // ---------- glTF ----------

    // def.model.fallback（無ければ id）から、コードモデルを作る
    fallback(def, M) {
      const m = (def && def.model) || {};
      const name = m.fallback || ((def && def.id === 'shotgun') ? 'shotgun' : 'rifle');
      const g = name === 'shotgun' ? this.shotgun(M) : this.rifle(M);
      g.userData.source = 'procedural';
      return g;
    },

    // def.model.file（'models/p90.glb' など）が assets にあれば実際のキー（'hd/models/p90.glb' 等）、無ければ null。
    // ティアは assets.resolve が見る（自分のティア → もう一方 → ティア無し）
    resolveFile(def, assets) {
      const m = (def && def.model) || {};
      if (!assets || !m.file || typeof assets.loadModel !== 'function') return null;
      if (typeof assets.resolve === 'function') return assets.resolve(m.file) || null;
      if (typeof assets.has === 'function') return assets.has(m.file) ? m.file : null;
      return null;
    },

    // パース済み glTF の scene から銃の Group を作る（scene は複製するので何度でも呼べる。ジオメトリ・マテリアルは共有）。
    //   modelCfg: def.model（scale / foregrip / handOffset を見る）。
    //   空ノード muzzle / eject / sight / grip の位置を group のローカル座標（scale 適用後）に変換して userData に入れる。
    //   無い空ノードはバウンディングボックスから推定する。GLB のルート（'P90' / 'Shotgun'）は回転しない（銃口 -Z の規約）
    fromScene(scene, modelCfg, def) {
      const m = modelCfg || {};
      const group = new THREE.Group();
      const clone = scene.clone(true);
      const scale = numOr(m.scale, 1);
      if (scale !== 1) clone.scale.multiplyScalar(scale);
      clone.position.set(0, 0, 0);
      group.add(clone);
      group.updateMatrixWorld(true); // group は親無し → matrixWorld = 単位行列。子の matrixWorld が group ローカル座標になる

      const box = new THREE.Box3();
      clone.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        box.union(b);
      });
      if (box.isEmpty()) box.set(new THREE.Vector3(-0.03, -0.1, -0.3), new THREE.Vector3(0.03, 0.1, 0.3));
      const c = box.getCenter(new THREE.Vector3());
      const guess = {
        muzzle: new THREE.Vector3(c.x, c.y, box.min.z),
        eject: new THREE.Vector3(box.max.x, c.y, c.z),
        sight: new THREE.Vector3(c.x, box.max.y, c.z),
        grip: new THREE.Vector3(0, 0, 0)
      };
      const ud = group.userData;
      ud.nodes = {};
      for (const name of ['muzzle', 'eject', 'sight', 'grip']) {
        const node = clone.getObjectByName(name);
        if (node) {
          ud[name] = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
          ud.nodes[name] = node;
        } else {
          ud[name] = guess[name];
        }
      }
      ud.hasSight = !!ud.nodes.sight;
      ud.size = box.getSize(new THREE.Vector3());
      // 前方の握り: grip + オフセット（メートル。設定 model.foregrip で上書き可）。P90 は 0.17m 前・少し上、ショットガンはポンプ
      const FOREGRIP = { shotgun: [0, 0, -0.26], rifle: [0, 0, -0.22], sniper: [0, -0.01, -0.3], pistol: [0, -0.01, -0.03], lmg: [0, 0, -0.25], p90: [0, 0.02, -0.17] };
      const id = (def && def.id) || m.fallback || 'p90';
      const fg = arr3(m.foregrip, FOREGRIP[id] || (m.fallback === 'shotgun' ? FOREGRIP.shotgun : FOREGRIP.p90));
      ud.foregrip = ud.grip.clone().add(new THREE.Vector3(fg[0], fg[1], fg[2]));
      // 右手は grip の少し下（握りの中央）。左手は foregrip
      const ho = arr3(m.handOffset, [0, -0.025, 0]);
      ud.handR = ud.grip.clone().add(new THREE.Vector3(ho[0], ho[1], ho[2]));
      ud.handL = ud.foregrip.clone();
      ud.source = 'glb';
      return group;
    },

    // Promise<THREE.Group>: GLB があれば fromScene() の結果、無ければ・失敗したら fallback(def)
    load(def, assets) {
      const key = this.resolveFile(def, assets);
      if (!key) return Promise.resolve(this.fallback(def));
      return Promise.resolve().then(() => assets.loadModel(key)).then((res) => {
        const scene = res && res.scene && res.scene.isObject3D ? res.scene : (res && res.isObject3D ? res : null);
        if (!scene) throw new Error('scene が空です: ' + key);
        const g = this.fromScene(scene, (def && def.model) || {}, def);
        g.userData.file = key;
        return g;
      }).catch((e) => {
        console.warn('[Models] ' + key + ' を読めません。コードモデルで続行します:', e && e.message);
        return this.fallback(def);
      });
    }
  };
})();
