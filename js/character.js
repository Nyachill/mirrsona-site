// 人型キャラクター（兵士）をコードで組み立て、歩行・構え・被弾・死亡をコードでアニメーションする。
// 正面は +Z。root の原点が足元。
// glTF のモデルに差し替えるときは、同じインターフェース（update / flinch / die / dispose）を持つクラスを作る。
window.MR = window.MR || {};

MR.Character = class Character {
  constructor(opts) {
    this.opts = Object.assign({
      armor: '#2c3038',
      cloth: '#4a5245',
      accent: '#c0352f',
      visor: '#ff2a2a',
      scale: 1.0
    }, opts || {});

    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mats = {
      armor: std({ color: MR.srgb(this.opts.armor), roughness: 0.55, metalness: 0.35 }),
      cloth: std({ color: MR.srgb(this.opts.cloth), roughness: 1.0, metalness: 0.0 }),
      accent: std({ color: MR.srgb(this.opts.accent), roughness: 0.6, metalness: 0.2 }),
      dark: std({ color: MR.srgb('#15171b'), roughness: 0.7, metalness: 0.3 }),
      visor: std({ color: MR.srgb('#1a0000'), emissive: MR.srgb(this.opts.visor), emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.2 })
    };
    this.flashMats = [this.mats.armor, this.mats.cloth, this.mats.accent];

    this.root = new THREE.Group();
    this.root.scale.setScalar(this.opts.scale);
    this.source = 'procedural'; // tools/screenshot.js が見る（MR.CharacterGLB は 'files'）
    this.weaponId = 'rifle';    // 持っている銃（コードのライフル）。街で倒すと落とす
    this.phase = Math.random() * Math.PI * 2;
    this.flinchTimer = 0;
    this.flashTimer = 0;
    this.dead = false;
    this.deathTime = 0;
    this.sink = 0;
    this.fallDir = 1;
    this.aimBlend = 0;   // 0 = 低い構え, 1 = 狙っている
    this.moveBlend = 0;  // 0 = 立ち止まり, 1 = 歩行
    this._build();
  }

  _build() {
    const M = this.mats;
    const mesh = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = true;
      return m;
    };
    const cyl = (r, len, rt) => new THREE.CylinderGeometry(rt == null ? r : rt, r, len, 8);

    // 腰
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.root.add(this.hips);
    this.hips.add(mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), M.cloth, 0, 0, 0));
    this.hips.add(mesh(new THREE.BoxGeometry(0.36, 0.08, 0.26), M.dark, 0, 0.1, 0)); // ベルト

    // 胴体
    this.torso = new THREE.Group();
    this.torso.position.y = 0.12;
    this.hips.add(this.torso);
    this.torso.add(mesh(new THREE.BoxGeometry(0.42, 0.5, 0.26), M.cloth, 0, 0.27, 0));
    this.torso.add(mesh(new THREE.BoxGeometry(0.46, 0.4, 0.31), M.armor, 0, 0.26, 0));          // プレートキャリア
    this.torso.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), M.accent, 0, 0.3, 0.17));       // 胸のマーク
    for (const s of [-1, 1]) {
      this.torso.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), M.armor, s * 0.25, 0.49, 0));    // 肩パッド
    }

    // 頭
    this.neck = new THREE.Group();
    this.neck.position.y = 0.54;
    this.torso.add(this.neck);
    this.neck.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), M.dark, 0, 0.03, 0));
    const helmet = mesh(new THREE.SphereGeometry(0.17, 12, 10), M.armor, 0, 0.19, 0);
    helmet.scale.set(1, 0.95, 1.05);
    this.neck.add(helmet);
    this.neck.add(mesh(new THREE.BoxGeometry(0.26, 0.1, 0.12), M.dark, 0, 0.14, 0.12));           // フェイスガード
    this.neck.add(mesh(new THREE.BoxGeometry(0.22, 0.05, 0.08), M.visor, 0, 0.17, 0.15));         // バイザー（発光）

    // 腕
    this.shoulderR = this._arm(1, M, mesh, cyl);
    this.shoulderL = this._arm(-1, M, mesh, cyl);

    // 脚
    this.hipR = this._leg(1, M, mesh, cyl);
    this.hipL = this._leg(-1, M, mesh, cyl);

    // 銃（胸の前の「構え」位置に固定し、腕はそれに合わせてポーズする）
    this.rifle = MR.Models.rifle(MR.Models.shared());
    this.rifle.rotation.y = Math.PI; // 銃口を +Z へ
    this.rifle.position.set(0.1, 0.22, 0.28);
    this.torso.add(this.rifle);
    this.muzzleLocal = this.rifle.userData.muzzle.clone(); // ライフルのローカル座標
  }

  _arm(side, M, mesh, cyl) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.46, 0);
    this.torso.add(shoulder);
    shoulder.add(mesh(cyl(0.065, 0.28, 0.07), M.cloth, 0, -0.14, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    elbow.add(mesh(cyl(0.055, 0.26, 0.06), M.armor, 0, -0.13, 0));
    elbow.add(mesh(new THREE.BoxGeometry(0.09, 0.1, 0.09), M.dark, 0, -0.29, 0)); // 手
    shoulder.userData.elbow = elbow;
    return shoulder;
  }

  _leg(side, M, mesh, cyl) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, -0.04, 0);
    this.hips.add(hip);
    hip.add(mesh(cyl(0.07, 0.42, 0.08), M.cloth, 0, -0.21, 0));
    hip.add(mesh(new THREE.BoxGeometry(0.15, 0.14, 0.17), M.armor, 0, -0.4, 0.02)); // 膝当て
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    knee.add(mesh(cyl(0.06, 0.42, 0.065), M.cloth, 0, -0.21, 0));
    knee.add(mesh(new THREE.BoxGeometry(0.14, 0.1, 0.27), M.dark, 0, -0.44, 0.04)); // ブーツ
    hip.userData.knee = knee;
    return hip;
  }

  // state: { moving: bool, speed: 0..1, aiming: bool }
  update(dt, state) {
    if (this.dead) { this._updateDeath(dt); return; }
    const k = Math.min(1, dt * 8);
    this.moveBlend += ((state.moving ? 1 : 0) - this.moveBlend) * k;
    this.aimBlend += ((state.aiming ? 1 : 0) - this.aimBlend) * k;

    // 歩行サイクル
    const stride = (state.speed || 1) * 7.5;
    if (state.moving) this.phase += dt * stride;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const mb = this.moveBlend;

    this.hipR.rotation.x = -s * 0.7 * mb;
    this.hipL.rotation.x = s * 0.7 * mb;
    this.hipR.userData.knee.rotation.x = Math.max(0, c) * 1.0 * mb + 0.05;
    this.hipL.userData.knee.rotation.x = Math.max(0, -c) * 1.0 * mb + 0.05;
    this.root.position.y = Math.abs(s) * 0.035 * mb;
    this.hips.rotation.y = s * 0.08 * mb;
    this.torso.rotation.y = -s * 0.1 * mb;

    // 腕: 低い構え（0）と狙い（1）のブレンド
    const a = this.aimBlend;
    const lerp = (x, y) => x + (y - x) * a;
    this.shoulderR.rotation.x = lerp(-0.85, -1.25);
    this.shoulderR.rotation.y = lerp(0.15, 0.3);
    this.shoulderR.userData.elbow.rotation.x = lerp(-1.1, -0.55);
    this.shoulderL.rotation.x = lerp(-1.1, -1.45);
    this.shoulderL.rotation.y = lerp(-0.45, -0.5);
    this.shoulderL.userData.elbow.rotation.x = lerp(-0.6, -0.25);
    this.rifle.rotation.x = lerp(-0.35, 0.0);
    this.rifle.position.y = lerp(0.14, 0.26);

    // 被弾の仰け反り
    if (this.flinchTimer > 0) {
      this.flinchTimer -= dt;
      const f = Math.max(0, this.flinchTimer / 0.18);
      this.torso.rotation.x = -f * 0.3;
    } else {
      this.torso.rotation.x = 0;
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this._setFlash(0);
    }
  }

  flinch() {
    this.flinchTimer = 0.18;
    this._setFlash(1);
    this.flashTimer = 0.07;
  }

  _setFlash(on) {
    for (const m of this.flashMats) {
      m.emissive.setHex(on ? 0xff5a2a : 0x000000);
      m.emissiveIntensity = on ? 0.9 : 1;
    }
  }

  die(fromDir) {
    this.dead = true;
    this.deathTime = 0;
    this._setFlash(0);
    // 撃たれた方向の反対へ倒れる（fromDir は弾の進行方向、ワールド）
    if (fromDir) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
      this.fallDir = fwd.dot(fromDir) > 0 ? 1 : -1; // 背後から撃たれたら前へ
    } else {
      this.fallDir = Math.random() < 0.5 ? 1 : -1;
    }
    this.fallSide = (Math.random() - 0.5) * 0.6;
  }

  _updateDeath(dt) {
    this.deathTime += dt;
    const t = Math.min(1, this.deathTime / 0.5);
    const e = 1 - (1 - t) * (1 - t); // ease out
    // 足元を支点に倒れる（+Z が正面なので x 軸回転で前後に倒れる）
    this.root.rotation.x = this.fallDir * e * Math.PI / 2 * 0.98;
    this.root.rotation.z = this.fallSide * e;
    // しばらくして沈む（毎フレーム y を上書きするので、沈み量は別に累積する）
    if (this.deathTime > 2.6) this.sink += dt * 0.9;
    this.root.position.y = 0.05 * e - this.sink;
    // 手足を投げ出す
    this.shoulderR.rotation.x = -0.4 - e * 1.2; this.shoulderR.rotation.y = 0.9 * e;
    this.shoulderL.rotation.x = -0.4 - e * 0.6; this.shoulderL.rotation.y = -1.1 * e;
    this.shoulderR.userData.elbow.rotation.x = -0.2;
    this.shoulderL.userData.elbow.rotation.x = -0.3;
    this.hipR.rotation.x = 0.2 * e; this.hipL.rotation.x = -0.35 * e;
    this.hipR.userData.knee.rotation.x = 0.4 * e; this.hipL.userData.knee.rotation.x = 0.7 * e;
    this.neck.rotation.x = 0.4 * e;
    this.rifle.rotation.x = -0.9 * e;
  }

  muzzleWorldPosition(target) {
    return (target || new THREE.Vector3()).copy(this.muzzleLocal).applyMatrix4(this.rifle.matrixWorld);
  }

  // 当たり判定の球（ワールド座標）。[{ center, radius, head }]。胴体の後に頭（同距離なら胴体を優先）
  // 従来の enemy.js intersectRay と同じ値: 胴 y+0.95 r0.55、頭 y+1.66 r0.3（上下動は含めない）
  hitSpheres(out) {
    const list = out || [];
    list.length = 0;
    const s = this.opts.scale || 1;
    if (!this._spheres) {
      this._spheres = [
        { center: new THREE.Vector3(), radius: 0.55 * s, head: false },
        { center: new THREE.Vector3(), radius: 0.3 * s, head: true }
      ];
    }
    const p = this.root.position, by = this.baseY || 0; // baseY: 街で敵が屋上・階段にいるときの足元の高さ（enemy.js）
    this._spheres[0].center.set(p.x, by + 0.95 * s, p.z);
    this._spheres[1].center.set(p.x, by + 1.66 * s, p.z);
    list.push(this._spheres[0], this._spheres[1]);
    return list;
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const k of Object.keys(this.mats)) this.mats[k].dispose(); // 銃のマテリアルは共有なので消さない
  }
};
