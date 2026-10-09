// 他のプレイヤー（オンライン）。見た目は敵と同じ兵士（MR.Enemy.createCharacter: glTF か コードの兵士）。
//   - 位置・向き・歩き/走り・照準は net.js の補間した状態（applyState）で動かす。AI もダメージ計算も持たない
//     （HP・撃破はサーバーが決める。game.js が damage / kill / spawn を受けて flinch / die / spawn を呼ぶ）
//   - 頭の上に名前（Sprite + Canvas テクスチャ、sRGB。霧・トーンマップを受けない）
//   - 弾との当たり判定は Enemy と同じ（character.hitSpheres() の球）。intersectRay(origin, dir, maxDist) → { t, point, head }
//   - 他の人が撃った（fire）: 銃口から弾道（トレーサー）、壁に着弾、3D の銃声。自分の近くを通れば風切り音
//   - 乗り物を運転中（veh ≥ 0）は体と名前を隠す（車は game.js が動かす）
// 向き: state.yaw は撃った人のカメラのヨー（player.yawAngle。前 = (−sin, −cos)）。兵士は正面 +Z なので + π して使う
// 街（3D）: 高さ（屋上・階段）、動き m（netproto の MOVE）で姿勢を変える: 梯子（登っている間は歩きのアニメ）、泳ぐ（水面から頭と肩、
//   少し前かがみで上下に揺れる）、自由落下（うつ伏せの水平）、パラシュート（コードのキャノピー MR.Parachute を頭の上に）。
//   当たりの球（コードの兵士の baseY・glTF の骨）も高さに付いていく。snap の行が来ない（interest の外）間は setAway(true) で隠す（退出ではない）
window.MR = window.MR || {};

MR.RemotePlayer = class RemotePlayer {
  // info: PlayerInfo { id, name, hp, kills, deaths, alive, w }、opts: { enemyCfg, weapons: { id: def }, fx, audio, nav, listener(), city（街: 高さ・姿勢）}
  constructor(scene, info, opts) {
    this.scene = scene;
    this.opts = opts || {};
    this.id = info.id;
    this.name = info.name || ('#' + info.id);
    this.w = info.w || '';
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;              // 兵士の向き（正面 +Z の回転）
    this.pitch = 0;
    this.radius = 0.45;
    this.veh = -1;
    this.moving = false;
    this.mv = 0;
    this.ads = false;
    this.aimTimer = 0;         // 撃った直後はしばらく構える
    this.dead = !info.alive;
    this.deathTime = 0;
    this.hasState = false;     // スナップショットを 1 度でも受けたか（受けるまで隠す）
    this.away = false;         // 街: 行が来ていない（遠い・輸送ヘリの中）
    this.m = 0;                // 街: 動き（0 歩く / 1 梯子 / 2 泳ぐ / 3 乗り越え / 4 自由落下 / 5 パラシュート）
    this.seat = -1;
    this.camYaw = 0;           // 見ている向き（カメラのヨー。観戦のカメラ）
    this.parachute = null;
    this._tilt = 0;
    this._vy = 0;
    this._lastY = null;
    this._yOff = 0;
    this._spheres = [];
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._makeCharacter();
    this.tag = RemotePlayer.makeNameTag(this.name);
    scene.add(this.tag);
    this._updateVisibility();
  }

  _makeCharacter() {
    if (this.character) { this.scene.remove(this.group); this.character.dispose(); }
    this.character = MR.Enemy.createCharacter(this.opts.enemyCfg || {});
    this.group = this.character.root;
    this.group.name = 'remote:' + this.id;
    this.scene.add(this.group);
    this._yOff = 0;
    if (this._tilt === undefined) this._tilt = 0;
    this._apply();
  }

  // 名前の札（Canvas → Sprite）。大きさは m 単位
  static makeNameTag(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const g = canvas.getContext('2d');
    if (g) {
      g.clearRect(0, 0, 256, 64);
      g.font = '600 34px "Avenir Next", "Hiragino Sans", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // 暗い角丸の下地（明るい壁・空の前でも読めるように。遠くで縮むと縁取りだけでは灰色に溶ける）
      const tw = Math.min(248, (g.measureText ? g.measureText(String(name)).width : 160) + 28);
      const x0 = 128 - tw / 2, y0 = 8, h = 50, rr = 25;
      g.fillStyle = 'rgba(8, 12, 18, 0.62)';
      g.beginPath();
      g.moveTo(x0 + rr, y0);
      g.arcTo(x0 + tw, y0, x0 + tw, y0 + h, rr);
      g.arcTo(x0 + tw, y0 + h, x0, y0 + h, rr);
      g.arcTo(x0, y0 + h, x0, y0, rr);
      g.arcTo(x0, y0, x0 + tw, y0, rr);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffd9a8';
      g.fillText(String(name), 128, 34);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }); // 霧で薄くならないように
    const s = new THREE.Sprite(mat);
    s.scale.set(RemotePlayer.TAG_W, RemotePlayer.TAG_H, 1);
    s.renderOrder = 5;
    s.name = 'nametag';
    return s;
  }

  // 名前の札の大きさ（m）。TAG_NEAR m より遠いと画面上の大きさを保つ（最大 TAG_MAX_SCALE 倍）
  static get TAG_W() { return 1.6; }
  static get TAG_H() { return 0.4; }
  static get TAG_NEAR() { return 7; }
  static get TAG_MAX_SCALE() { return 4; }

  // 補間した状態を当てる（net.sample の戻り値）
  applyState(s) {
    if (!s) return;
    this.hasState = true;
    this.away = false;
    this.pos.set(s.x, s.y, s.z);
    this.yaw = s.yaw + Math.PI;
    this.camYaw = s.yaw;
    this.pitch = s.pitch || 0;
    this.mv = s.mv | 0;
    this.moving = this.mv > 0;
    this.ads = !!s.ads;
    this.w = s.w || this.w;
    this.veh = typeof s.veh === 'number' ? s.veh : -1;
    this.m = s.m | 0;
    this.seat = typeof s.seat === 'number' ? s.seat : -1;
  }

  // 行が来ない（interest の外・輸送ヘリの中）: 体と札を隠し、撃てなくする（戻ってきたら applyState で出る）
  setAway(on) {
    if (this.away === !!on) return;
    this.away = !!on;
    this._updateVisibility();
  }

  // 姿勢（街の動き m）
  get pose() {
    if (this.dead) return 'dead';
    switch (this.m) { case 1: return 'ladder'; case 2: return 'swim'; case 4: return 'fall'; case 5: return 'chute'; default: return 'stand'; }
  }

  // camPos: カメラの位置（あれば名前の札を遠くでも読める大きさに保つ。TAG_NEAR m より遠いと距離に比例して大きくする）
  update(dt, camPos) {
    if (this.aimTimer > 0) this.aimTimer -= dt;
    if (camPos && this.tag) {
      const d = Math.hypot(this.pos.x - camPos.x, this.pos.z - camPos.z);
      const k = Math.min(RemotePlayer.TAG_MAX_SCALE, Math.max(1, d / RemotePlayer.TAG_NEAR));
      this.tag.scale.set(RemotePlayer.TAG_W * k, RemotePlayer.TAG_H * k, 1);
    }
    // 上下の速さ（梯子のアニメ）
    if (dt > 0 && this._lastY !== null) this._vy += ((this.pos.y - this._lastY) / dt - this._vy) * Math.min(1, dt * 8);
    this._lastY = this.pos.y;
    // 兵士は root.position.y を足元 0 として動かす（死亡で沈むなど）ので、前フレームに足した高さを戻してから更新し、今の高さを足す
    this.group.position.y -= this._yOff;
    this._yOff = 0;
    const pose = this.pose;
    if (this.dead) {
      this.deathTime += dt;
      this.character.update(dt, {});
    } else if (pose === 'ladder') {
      this.character.update(dt, { moving: Math.abs(this._vy) > 0.25, speed: 0.4, aiming: false });
    } else if (pose === 'swim') {
      this.character.update(dt, { moving: this.moving, speed: 0.35, aiming: false });
    } else if (pose === 'fall' || pose === 'chute') {
      this.character.update(dt, { moving: false, speed: 0, aiming: false });
    } else {
      this.character.update(dt, { moving: this.moving, speed: this.mv >= 2 ? 1 : 0.55, aiming: this.ads || this.aimTimer > 0 });
    }
    // 姿勢の傾き（うつ伏せ・前かがみ）。足元を支点に回すので、体の真ん中が位置に来るように少しずらす
    const tiltT = pose === 'fall' ? 1.3 : (pose === 'swim' ? 0.35 : (pose === 'chute' ? 0.06 : 0));
    if (!this.dead) {
      this._tilt += (tiltT - this._tilt) * Math.min(1, dt * 5);
      if (Math.abs(this._tilt) < 1e-3 && tiltT === 0) this._tilt = 0;
    }
    let lift = 0;
    if (pose === 'fall') lift = 1.0;
    else if (pose === 'swim') lift = Math.sin((this._swimT = (this._swimT || 0) + dt) * 2.1) * 0.05;
    // arena（今まで通り）: 倒れた兵士は地面（0）に
    this._yOff = (this.dead && !this.opts.city) ? 0 : this.pos.y + lift;
    this.group.position.y += this._yOff;
    if (this.opts.city) this.character.baseY = this.pos.y; // コードの兵士の当たりの球の高さ（glTF は骨から）
    // パラシュート（キャノピーは頭の上。開いて 0.62 秒で大きくなる）
    if (pose === 'chute') {
      if (!this.parachute && MR.Parachute) {
        this.parachute = new MR.Parachute(this.group);
        this.parachute.root.position.set(0, 1.8, 0.6);
      }
      if (this.parachute && !this.parachute.root.visible) this.parachute.open(0.62);
    } else if (this.parachute && this.parachute.root.visible) this.parachute.close();
    if (this.parachute) this.parachute.update(dt);
    this._apply();
    this._updateVisibility();
  }

  _apply() {
    let x = this.pos.x, z = this.pos.z;
    if (this._tilt) {
      // 前（+Z を yaw で回した向き）へ倒すので、足元を後ろへずらして体の真ん中を位置に合わせる
      if (this.group.rotation.order !== 'YXZ') this.group.rotation.order = 'YXZ';
      const back = Math.sin(this._tilt) * 0.85;
      x -= Math.sin(this.yaw) * back; z -= Math.cos(this.yaw) * back;
    }
    this.group.position.x = x;
    this.group.position.z = z;
    this.group.rotation.y = this.yaw;
    if (!this.dead && (this._tilt || this.group.rotation.order === 'YXZ')) this.group.rotation.x = this._tilt;
    const pose = this.pose;
    const ty = pose === 'chute' ? 4.5 : (pose === 'fall' ? 2.0 : (pose === 'swim' ? 1.1 : 2.2));
    if (this.tag) this.tag.position.set(this.pos.x, this.pos.y + ty, this.pos.z);
  }

  _updateVisibility() {
    // 死亡: 倒れるアニメーションを 3 秒見せてから隠す。運転中・まだ位置が来ていない・行が来ていない（遠い）ときも隠す
    const body = this.hasState && this.veh < 0 && !this.away && (!this.dead || this.deathTime < 3);
    this.group.visible = body;
    if (this.tag) this.tag.visible = body && !this.dead;
  }

  // 撃たれて当たったときの見た目（HP はサーバー）
  flinch() { if (!this.dead) this.character.flinch(); }

  die(fromDir) {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.aimTimer = 0;
    this.character.die(fromDir || null);
  }

  // 復活（サーバーの spawn）。倒れた兵士は作り直す。y: 街の高さ（arena は 0）
  spawn(x, z, camYaw, y) {
    if (this.dead) { this._disposeChute(); this._makeCharacter(); }
    this.dead = false;
    this.deathTime = 0;
    this.veh = -1;
    this.m = 0;
    this._tilt = 0;
    this.group.rotation.x = 0;
    this.pos.set(x, typeof y === 'number' && isFinite(y) ? y : 0, z);
    this._lastY = null;
    if (typeof camYaw === 'number' && isFinite(camYaw)) { this.yaw = camYaw + Math.PI; this.camYaw = camYaw; }
    this.hasState = true;
    this.away = false;
    this._apply();
    this._updateVisibility();
  }

  get targetable() { return !this.dead && this.hasState && this.veh < 0 && !this.away; }

  _disposeChute() { if (this.parachute) { this.parachute.dispose(); this.parachute = null; } }

  // 弾（レイ）との当たり。Enemy.intersectRay と同じ
  intersectRay(origin, dir, maxDist) {
    if (!this.targetable) return null;
    this.group.updateMatrixWorld(true);
    const spheres = this.character.hitSpheres(this._spheres);
    let best = null;
    for (const sp of spheres) {
      const t = MR.Enemy.raySphere(origin, dir, sp.center, sp.radius);
      if (t !== null && t <= maxDist && (best === null || t < best.t)) best = { t, head: !!sp.head };
    }
    if (!best) return null;
    best.point = origin.clone().addScaledVector(dir, best.t);
    return best;
  }

  // 他の人の発砲（S→C fire）: { w, o: [x,y,z], d: [[dx,dy,dz], ...] }
  onFire(m, eye) {
    const P = MR.NetProto;
    if (!P.isVec(m.o, 3) || !Array.isArray(m.d)) return;
    this.aimTimer = 0.8;
    const fx = this.opts.fx, audio = this.opts.audio, nav = this.opts.nav;
    const def = (this.opts.weapons && this.opts.weapons[m.w]) || {};
    const range = def.range || 100;
    const o = this._tmp.set(m.o[0], m.o[1], m.o[2]);
    // 銃口: 兵士が見えていればその銃口、見えなければ（運転中など）撃った位置
    let from = o.clone();
    if (this.group.visible && !this.dead) {
      try { this.group.updateMatrixWorld(true); from = this.character.muzzleWorldPosition(new THREE.Vector3()); } catch (e) { from = o.clone(); }
    }
    let whizzed = false;
    const n = Math.min(m.d.length, 12);
    for (let k = 0; k < n; k++) {
      const d = m.d[k];
      if (!P.isVec(d, 3)) continue;
      const dir = this._tmp2.set(d[0], d[1], d[2]);
      if (dir.lengthSq() < 1e-6) continue;
      dir.normalize();
      const hit = nav ? nav.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, range) : null;
      const end = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : o.clone().addScaledVector(dir, range);
      if (fx) {
        fx.tracer(from, end, true);
        if (hit) fx.impact(end, new THREE.Vector3(hit.nx, hit.ny, hit.nz));
      }
      // 自分の近く（1.5 m）を通ったら風切り音
      if (!whizzed && eye && audio && typeof audio.whizz === 'function') {
        const seg = end.clone().sub(o);
        const len2 = seg.lengthSq();
        const u = len2 > 0 ? THREE.MathUtils.clamp(eye.clone().sub(o).dot(seg) / len2, 0, 1) : 0;
        const closest = o.clone().addScaledVector(seg, u);
        const dist = closest.distanceTo(eye);
        if (dist < 1.5 && dist > 0.3) { audio.whizz(closest); whizzed = true; }
      }
    }
    if (fx && typeof fx.muzzleSmoke === 'function' && m.d[0] && P.isVec(m.d[0], 3)) fx.muzzleSmoke(from, new THREE.Vector3(m.d[0][0], m.d[0][1], m.d[0][2]));
    // 3D の銃声（武器ごとの音。無ければ敵の銃声）
    if (audio && typeof audio.play === 'function') {
      const sounds = def.sounds || {};
      let name = sounds.fire || (MR.Audio && MR.Audio.weaponKey ? MR.Audio.weaponKey(m.w) + '_fire' : 'enemy_fire');
      // 武器の音のファイルが無い（内蔵データ）ときは合成音のある敵の銃声
      if (typeof audio._pickName === 'function' && !audio._pickName(name)) name = 'enemy_fire';
      try { audio.play(name, { pos: from, volume: 1, refDistance: 6 }); } catch (e) { /* ignore */ }
    }
  }

  setName(name) {
    if (!name || name === this.name) return;
    this.name = name;
    if (this.tag) {
      this.scene.remove(this.tag);
      if (this.tag.material.map) this.tag.material.map.dispose();
      this.tag.material.dispose();
    }
    this.tag = RemotePlayer.makeNameTag(name);
    this.scene.add(this.tag);
    this._apply();
  }

  dispose() {
    this._disposeChute();
    this.scene.remove(this.group);
    this.character.dispose();
    if (this.tag) {
      this.scene.remove(this.tag);
      if (this.tag.material.map) this.tag.material.map.dispose();
      this.tag.material.dispose();
      this.tag = null;
    }
  }
};
