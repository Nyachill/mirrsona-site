// 銃。弾の判定は onShoot コールバック（Game 側）に任せ、ここでは弾数・連射・見た目・音・ADS（照準）を扱う。
//
// ビューモデル: まずコードのモデル（MR.Models.rifle / shotgun）を同期的に組み、assets に GLB
// （def.model.file、ティア別）があれば MR.Models.load() の Promise が解決した時点でその場で差し替える。
// 差し替え時に銃口（マズルフラッシュ・煙）・排莢口・照準・腕の位置を新しい userData に合わせ直す。
//
// ADS: setAds(true/false) で 0..1 のブレンド（def.ads.time 秒）を進め、restPos → adsPos へ位置を補間する。
// adsPos は def.model.adsPos を基準に、モデルに sight があればその点がカメラ軸（x=0, y=0）に乗るよう x/y を合わせる
// （def.model.adsAlign: false で無効）。狙っている間はスウェイ・揺れが小さくなり、散布が def.ads.spreadScale 倍になる。
// カメラの FOV と視点感度は Game 側が blendFov() / lookScale() を読んで反映する。
//
// 予備の弾（reserve）: 既定は武器ごと（def.reserveAmmo）。街（cityplay.js）では pool（持ち物 MR.Loot.Inventory）と calibre（口径）を
// 入れると、予備の弾は口径ごとの持ち物から出し入れする（同じ口径の武器で共有。リロードで減る）。
// onNoAmmo: 弾倉も予備も空で撃とうとした・装填しようとしたときに呼ぶ（街で「弾がない」を出す）。
window.MR = window.MR || {};

MR.Weapon = class Weapon {
  // viewRoot: ビューモデル専用シーンのルート（毎フレーム camera のワールド行列をコピーする）
  // muzzleLight: メインシーン側（カメラの子）の点光源。発砲時に周囲を照らす
  // assets: MR.AssetManager（省略可。無ければコードのモデルのまま）
  constructor(def, camera, viewRoot, audio, fx, muzzleLight, assets) {
    this.def = def;
    this.camera = camera;
    this.audio = audio;
    this.fx = fx;
    this.light = muzzleLight;
    this.ammo = def.magazineSize;
    this.pool = null;       // 街: 口径ごとの持ち物（ammoOf(cal) / setAmmo(cal, n)）
    this.calibre = null;
    this.onNoAmmo = null;
    this.reserve = def.reserveAmmo;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextFire = 0;
    this.kickBack = 0;
    this.onChange = null;   // (ammo, reserve, reloading) => void
    this.visible = true;
    this.flashUntil = 0;
    this.lightTimer = 0;
    this.swayX = 0; this.swayY = 0;
    this.bobTime = 0;
    this.raiseT = 0;
    this.lowered = false;   // 梯子・水中・よじ登り中（game.js の setLowered）: 銃を画面の下へ下げて隠し、撃てない
    this.lowerT = 0;
    this.disposed = false;

    // 設定（無いキーは既定値）
    const ads = def.ads || {};
    this.adsCfg = {
      fov: Weapon.num(ads.fov, null),              // null = 基準 FOV × 0.8（blendFov が決める）
      time: Math.max(0.01, Weapon.num(ads.time, 0.16)),
      sensitivity: Weapon.num(ads.sensitivity, 0.7),
      spreadScale: Weapon.num(ads.spreadScale, 0.5),
      scope: !!ads.scope                           // true = 完全に覗いたらスコープ表示（HUD）にしてモデルを隠す
    };
    this.boltAt = 0;          // ボルトアクション: 次にボルト音を鳴らす時刻
    this.boltT = 0;           // ボルト操作のビューモデル動作（1 → 0）
    this.sounds = def.sounds || {};               // { fire, tail, reload } … audio.js がファイル音を探すときの名前
    this._ads = false;        // 要求（ボタン／右クリック）
    this._adsBlend = 0;       // 0 = 腰だめ, 1 = 照準
    this.adsPos = new THREE.Vector3(0, -0.085, -0.22);
    this.sightLocal = null;

    this.group = new THREE.Group();
    this.group.scale.setScalar(0.45);   // コードモデルは少し小さく、近くに置く（従来どおり）
    this.flashScale = 1;
    this.restPos = new THREE.Vector3(0.165, -0.165, -0.26);
    this.restRot = new THREE.Euler(0, -0.06, 0);
    this.group.position.copy(this.restPos);
    viewRoot.add(this.group);
    this._buildModel();
    this.modelSource = 'procedural';   // 'procedural' | 'glb'（tools/screenshot.js が読む）
    this.modelReady = this._loadModel(assets); // Promise<'procedural'|'glb'>
  }

  // 予備の弾（街は持ち物の口径ごとの弾）
  get reserve() { return this.pool ? this.pool.ammoOf(this.calibre) : this._reserve; }
  set reserve(v) { if (this.pool) this.pool.setAmmo(this.calibre, v); else this._reserve = v; }

  static num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  static arr3(v, d) { return (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number' && isFinite(x))) ? v : d; }

  // ---------- ビューモデル ----------

  _buildModel() {
    this.model = MR.Models.fallback(this.def);
    this.group.add(this.model);
    this._readNodes(this.model);

    // 腕（袖と手袋）
    this.armMats = {
      sleeve: new THREE.MeshStandardMaterial({ color: MR.srgb('#4a5245'), roughness: 1.0 }),
      glove: new THREE.MeshStandardMaterial({ color: MR.srgb('#1c1e22'), roughness: 0.8, metalness: 0.1 })
    };
    this.armGeo = new THREE.CylinderGeometry(0.038, 0.05, 0.34, 10);
    this.armGeo.translate(0, -0.17, 0); // 手首が原点、肘側へ伸びる
    this.handGeo = new THREE.BoxGeometry(0.075, 0.1, 0.085);
    this._buildArms(this.model.userData.handR, this.model.userData.handL);

    // マズルフラッシュ（スプライト）
    const tex = MR.FX.makeGlowTexture('#ffc14d');
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.flash.scale.set(0.38, 0.38, 1);
    this.flash.position.copy(this.muzzleLocal);
    this.flash.visible = false;
    this.flash.renderOrder = 11;
    this.group.add(this.flash);

    this._computeAds();
    this._noShadows();
  }

  // モデルの userData（group ローカル座標）から各点を取り込む
  _readNodes(model) {
    const ud = model.userData || {};
    this.muzzleLocal = ud.muzzle ? ud.muzzle.clone() : new THREE.Vector3(0, 0.05, -0.5);
    this.ejectLocal = ud.eject ? ud.eject.clone() : new THREE.Vector3(0.04, 0.05, 0);
    this.sightLocal = ud.sight ? ud.sight.clone() : null;
    this.gripLocal = ud.grip ? ud.grip.clone() : new THREE.Vector3();
  }

  // 手の位置（group ローカル）から腕を 2 本作る。肘の向きは従来と同じ相対方向
  _buildArms(handR, handL) {
    this._disposeArms();
    const makeArm = (handPos, towards) => {
      const arm = new THREE.Group();
      arm.position.copy(handPos);
      const dir = towards.clone().sub(handPos).normalize();
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const forearm = new THREE.Mesh(this.armGeo, this.armMats.sleeve);
      forearm.castShadow = false;
      arm.add(forearm);
      const hand = new THREE.Mesh(this.handGeo, this.armMats.glove);
      hand.position.y = 0.0;
      arm.add(hand);
      return arm;
    };
    const r = handR || new THREE.Vector3(0.01, -0.1, 0.05);
    const l = handL || new THREE.Vector3(-0.02, 0.0, -0.3);
    this.armR = makeArm(r, r.clone().add(new THREE.Vector3(0.11, -0.65, 0.15)));
    this.armL = makeArm(l, l.clone().add(new THREE.Vector3(-0.26, -0.5, 0.3)));
    this.group.add(this.armR, this.armL);
  }

  _disposeArms() {
    if (this.armR) this.group.remove(this.armR);
    if (this.armL) this.group.remove(this.armL);
    this.armR = this.armL = null;
  }

  _noShadows() {
    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
    });
  }

  // ADS の位置: def.model.adsPos を基準に、sight があればそれがカメラ軸に乗るよう x/y を合わせる
  _computeAds() {
    const m = this.def.model || {};
    const a = Weapon.arr3(m.adsPos, [0, -0.085, -0.22]);
    this.adsPos.set(a[0], a[1], a[2]);
    if (this.sightLocal && m.adsAlign !== false) {
      const s = this.group.scale.x;
      this.adsPos.x = -this.sightLocal.x * s;
      this.adsPos.y = -this.sightLocal.y * s;
    }
  }

  // GLB があれば読み込んで差し替える（無ければ何もしない）。戻り値 Promise<'procedural'|'glb'>
  _loadModel(assets) {
    if (!assets || !MR.Models.load || !MR.Models.resolveFile(this.def, assets)) return Promise.resolve('procedural');
    return MR.Models.load(this.def, assets).then((g) => {
      if (this.disposed) return 'procedural';
      if (!g || !g.userData || g.userData.source !== 'glb') return 'procedural';
      this._swapModel(g);
      return 'glb';
    }).catch((e) => {
      console.warn('[Weapon] モデルの差し替えに失敗。コードモデルで続行します:', e && e.message);
      return 'procedural';
    });
  }

  // コードのモデルを捨てて GLB の Group に差し替える。位置・向き・腕・フラッシュを合わせ直す
  _swapModel(g) {
    const m = this.def.model || {};
    // 古いコードモデル（ジオメトリ・マテリアルはこの武器専用なので捨ててよい）
    this.group.remove(this.model);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
    this.model = g;
    this.group.add(g);
    this._readNodes(g);

    // ビューモデルの大きさと置き場所（GLB は実寸なので、コードモデルより大きめの縮尺で置く）
    const viewScale = Math.max(0.05, Weapon.num(m.viewScale, 0.68));
    this.group.scale.setScalar(viewScale);
    this.flashScale = 0.45 / viewScale;
    const vp = Weapon.arr3(m.viewPos, [0.15, -0.15, -0.28]);
    const vr = Weapon.arr3(m.viewRot, [0, -0.06, 0]);
    this.restPos.set(vp[0], vp[1], vp[2]);
    this.restRot.set(vr[0], vr[1], vr[2]);
    this._computeAds();

    this.flash.position.copy(this.muzzleLocal);
    this._buildArms(g.userData.handR, g.userData.handL);
    this._noShadows();
    this.modelSource = 'glb';
  }

  // ---------- 表示・ADS ----------

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    if (v) { this.raiseT = 1; }
    else { this._ads = false; this._adsBlend = 0; }
  }

  // 銃を下げる（梯子・泳ぎ）。戻すときは持ち替えと同じように持ち上げる
  setLowered(on) {
    on = !!on;
    if (on === this.lowered) return;
    this.lowered = on;
    if (on) this._ads = false;
  }

  // 照準（ADS）の要求。毎フレーム呼んでよい
  setAds(on) {
    on = !!on;
    if (on === this._ads) return;
    this._ads = on;
    if (this.audio && typeof this.audio.play === 'function') {
      try { this.audio.play(on ? 'ads_in' : 'ads_out', { volume: 0.5 }); } catch (e) { /* 音は任意 */ }
    }
  }

  // 武器切替で前の武器の照準状態（要求とブレンド）を引き継ぐ。音は鳴らさない
  inheritAds(other) {
    if (!other) return;
    this._ads = !!other._ads;
    this._adsBlend = Math.max(0, Math.min(1, Number(other._adsBlend) || 0));
  }

  get ads() { return this._ads; }
  // スコープを覗いている（モデルを隠し、HUD にスコープを出す状態）
  get scoped() { return this.adsCfg.scope && this.visible && !this.reloading && this._adsBlend > 0.92; }
  get adsBlend() { return this._adsBlend; }
  // 実際に狙えている（要求あり・リロード中でない・ブレンドが半分を超えた）
  get adsActive() { return this._ads && !this.reloading && this._adsBlend > 0.5; }

  // カメラ FOV: 基準 FOV と def.ads.fov（無ければ基準 × 0.8）をブレンド
  blendFov(baseFov) {
    const target = this.adsCfg.fov !== null ? this.adsCfg.fov : baseFov * 0.8;
    return THREE.MathUtils.lerp(baseFov, target, this._adsBlend);
  }

  // 視点感度の倍率: 1 → def.ads.sensitivity
  lookScale() {
    return THREE.MathUtils.lerp(1, this.adsCfg.sensitivity, this._adsBlend);
  }

  // 現在の散布（度）。狙っていると def.ads.spreadScale 倍まで絞る
  currentSpread() {
    const k = this._adsBlend;
    return (this.def.spread || 0) * (1 - k * (1 - this.adsCfg.spreadScale));
  }

  // ---------- 射撃 ----------

  // 発射を試みる。撃てたら true。onShoot(dirs, def) で弾を処理する
  tryFire(now, onShoot) {
    const d = this.def;
    if (this.reloading || now < this.nextFire || this.raiseT > 0.4 || this.lowerT > 0.3) return false;
    if (this.ammo <= 0) {
      this.nextFire = now + 0.25;
      if (this.reserve > 0) this.startReload(now);
      else { this.audio.empty(d.id, this.sounds); if (this.onNoAmmo) this.onNoAmmo(this); }
      return false;
    }
    this.nextFire = now + 1 / d.fireRate;
    this.ammo--;
    this._notify();
    this.audio.shoot(d.id, this.sounds);
    this.kickBack = (d.recoil || 0.05) * (1 - this._adsBlend * 0.35);
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar((0.3 + Math.random() * 0.2) * this.flashScale);
    this.flashUntil = now + 0.045;
    if (this.light) { this.light.intensity = Weapon.num(d.flashLight, d.id === 'shotgun' ? 9 : 6); this.lightTimer = 0.06; }
    if (d.boltAction) { this.boltAt = now + 0.22; this.boltT = 1; }

    // 弾道（ADS 中は散布を絞る）
    const dirs = [];
    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const pellets = d.pellets || 1;
    const spread = this.currentSpread();
    for (let i = 0; i < pellets; i++) {
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(sy), THREE.MathUtils.degToRad(sx), 0, 'YXZ'));
      dirs.push(new THREE.Vector3(0, 0, -1).applyQuaternion(camQ.clone().multiply(q)));
    }
    onShoot(dirs, d);

    // 煙と薬莢
    if (this.fx) {
      const muzzle = this.muzzleWorldPosition();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ);
      this.fx.muzzleSmoke(muzzle, fwd);
      const eject = this.ejectLocal.clone().applyMatrix4(this.group.matrixWorld);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ);
      this.fx.casing(eject, right);
      if (this.audio && typeof this.audio.casing === 'function') this.audio.casing(eject);
    }
    return true;
  }

  startReload(now) {
    if (this.reloading || this.ammo >= this.def.magazineSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadEnd = now + this.def.reloadTime;
    // 音のハンドルを持っておく（持ち替え・死亡でリロードをやめたら止める。LMG のリロード音は 5 秒ある）
    this._reloadSound = this.audio.reload(this.def.id, this.sounds) || null;
    this._notify();
    return true;
  }

  cancelReload() {
    const h = this._reloadSound;
    this._reloadSound = null;
    if (this.reloading && h && typeof h.stop === 'function') { try { h.stop(0.05); } catch (e) { /* 鳴り終わっている */ } }
    this.reloading = false;
    this._notify();
  }

  // ---------- 更新 ----------

  // look: このフレームの視点移動量（px）、moving: 歩いているか
  update(now, dt, look, moving, grounded) {
    if (this.reloading && now >= this.reloadEnd) {
      const need = this.def.magazineSize - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
      this._reloadSound = null;
      this._notify();
    }
    if (this.flash.visible && now >= this.flashUntil) this.flash.visible = false;
    if (this.light && this.lightTimer > 0) {
      this.lightTimer -= dt;
      if (this.lightTimer <= 0) this.light.intensity = 0;
      else this.light.intensity *= 0.8;
    }

    // ADS ブレンド（リロード中は一旦解く）。位置は滑らかに（smoothstep）
    const want = (this._ads && !this.reloading) ? 1 : 0;
    const stepA = dt / this.adsCfg.time;
    this._adsBlend = want > this._adsBlend ? Math.min(want, this._adsBlend + stepA) : Math.max(want, this._adsBlend - stepA);
    const k = this._adsBlend * this._adsBlend * (3 - 2 * this._adsBlend);
    const calm = 1 - k * 0.75; // 狙っている間はスウェイ・揺れを小さく

    // 視点移動の遅れ（スウェイ）
    const lk = look || { x: 0, y: 0 };
    this.swayX = THREE.MathUtils.lerp(this.swayX, THREE.MathUtils.clamp(-lk.x * 0.0015, -0.04, 0.04) * calm, Math.min(1, dt * 10));
    this.swayY = THREE.MathUtils.lerp(this.swayY, THREE.MathUtils.clamp(-lk.y * 0.0015, -0.04, 0.04) * calm, Math.min(1, dt * 10));

    // 歩行の揺れ
    if (moving && grounded) this.bobTime += dt * 9; else this.bobTime = THREE.MathUtils.lerp(this.bobTime, Math.round(this.bobTime / Math.PI) * Math.PI, Math.min(1, dt * 6));
    const bobX = Math.sin(this.bobTime) * 0.012 * (moving ? 1 : 0.3) * calm;
    const bobY = Math.abs(Math.cos(this.bobTime)) * 0.01 * (moving ? 1 : 0.3) * calm;

    // 反動の戻り & リロード中は銃を下げる & 持ち替えで持ち上げる
    this.kickBack = THREE.MathUtils.lerp(this.kickBack, 0, Math.min(1, dt * 14));
    if (this.raiseT > 0) this.raiseT = Math.max(0, this.raiseT - dt * 3.2);
    if (this.lowered) this.lowerT = Math.min(1, this.lowerT + dt * 4);
    else if (this.lowerT > 0) this.lowerT = Math.max(0, this.lowerT - dt * 3.2);
    const target = this.restPos.clone().lerp(this.adsPos, k);
    target.x += this.swayX + bobX;
    const lw = this.lowerT * this.lowerT * (3 - 2 * this.lowerT);
    target.y += this.swayY * 0.7 + bobY - this.raiseT * 0.35 - lw * 0.45;
    target.z += this.kickBack;
    let rotX = -this.swayY * 1.5 + this.kickBack * 1.2 - this.raiseT * 0.6 - lw * 0.9;
    let rotZ = this.swayX * 0.6;
    if (this.reloading) {
      const t = 1 - Math.min(1, Math.abs((this.reloadEnd - now) / this.def.reloadTime - 0.5) * 2);
      target.y -= t * 0.2;
      target.x += t * 0.04;
      rotX -= t * 0.5;
      rotZ += t * 0.25;
    }
    // 照準中は銃を真っ直ぐ（restRot → 0）にして sight がカメラ軸に乗るようにする
    const baseX = this.restRot.x * (1 - k), baseY = this.restRot.y * (1 - k), baseZ = this.restRot.z * (1 - k);
    // ボルトアクション: 発砲のあと銃を少し下げて傾ける（ボルトを引く動作）+ 音
    if (this.boltAt && now >= this.boltAt) {
      this.boltAt = 0;
      if (this.audio && typeof this.audio.play === 'function') {
        try { this.audio.play(this.sounds.bolt || 'bolt_cycle', { volume: 0.8 }); } catch (e) { /* 任意 */ }
      }
    }
    if (this.boltT > 0) {
      this.boltT = Math.max(0, this.boltT - dt * 1.4);
      const b = Math.sin(this.boltT * Math.PI);
      target.y -= b * 0.03;
      target.x += b * 0.015;
      rotX -= b * 0.1;
      rotZ += b * 0.18;
    }
    // スコープを覗いている間はモデルを隠す（HUD のスコープが見える）
    this.group.visible = this.visible && !this.scoped && this.lowerT < 0.98;
    this.group.position.lerp(target, Math.min(1, dt * 18));
    this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, baseX + rotX, Math.min(1, dt * 12));
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, baseY + this.swayX * 0.8, Math.min(1, dt * 12));
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, baseZ + rotZ, Math.min(1, dt * 12));
  }

  addAmmo(n) {
    this.reserve += n;
    this._notify();
  }

  muzzleWorldPosition(target) {
    this.group.updateWorldMatrix(true, false);
    return (target || new THREE.Vector3()).copy(this.muzzleLocal).applyMatrix4(this.group.matrixWorld);
  }

  // 照準点（sight）のワールド座標。無ければ銃口
  sightWorldPosition(target) {
    this.group.updateWorldMatrix(true, false);
    return (target || new THREE.Vector3()).copy(this.sightLocal || this.muzzleLocal).applyMatrix4(this.group.matrixWorld);
  }

  _notify() {
    if (this.onChange) this.onChange(this.ammo, this.reserve, this.reloading);
  }

  dispose() {
    this.disposed = true;
    if (this.group.parent) this.group.parent.remove(this.group);
    // GLB のジオメトリ・マテリアルは AssetManager のキャッシュと共有なので捨てない。腕・コードモデルだけ捨てる
    if (this.modelSource === 'procedural' && this.model) {
      this.model.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    if (this.armGeo) this.armGeo.dispose();
    if (this.handGeo) this.handGeo.dispose();
  }
};
