// 一人称プレイヤー。カメラの階層: yaw(左右) → pitch(上下) → camera
//
// 移動は 2 通り:
//   update()   … arena01（MR.Nav）。平らな地面 y = 0 と resolveCircle（今まで通り。オンラインのサーバーの判定もこの動きが前提）
//   mode3d = true（game.js が街で設定）… MR.Nav3D の resolveCapsule でカプセル（半径 radius・高さ height）を動かす:
//     段差 stepUp まで乗り越え、接地していれば下りも stepUp まで吸い付く（階段を降りても浮かない）。重力・ジャンプ（天井で止まる）・
//     コヨーテタイム（縁から落ちて coyoteTime 秒はまだ跳べる）・段差と着地でカメラの高さをなめらかに（eyeOffset）。
//     梯子: ladderAt に触れて壁の方へ押すと掴まる（屋上の梯子の上端からは外へ押すと降りる向きで掴まる）。スティックの上下で
//       ladderSpeed m/s、視線の向きは関係ない（壁と反対を向いて前へ押すと離れる）。ジャンプで壁から少し離れて手を放す。
//       上端に着いたら自動で屋上（パラペットの切れ目・給水タンクの上）へ上がる。
//     落下: 一番高かった所から着地点までの高さで events に { t: 'land', drop, vy }（ダメージは game.js が fallDamage で決める）。
//     水: 足元に地面が無く水面がある所で足が浮く高さ（目が水面の swimEyeAbove 上）まで沈むと泳ぐ（swimSpeed、跳べない・撃てない）。
//       岸・桟橋・船べりの上面が水面から climbOutHeight 以内なら、そちらへ押すと climbOutTime 秒でよじ登る。
//     陸の地面（citygen の groundAt）は足より stepUp 以上高ければ壁（泳いでいて護岸に入らない）。地図の端は resolveCapsule が止める。
//   events: このフレームに起きたこと（game.js が毎フレーム読んで空にする）。land / jump / splash / stroke / ladder_step / ladder / climb_out /
//     chute（パラシュートが開いた）
//   降下（バトルロイヤル。startFall）: state 'fall' = 自由落下（下を向くほど速く落ちる。スティックで向いている方へ）→ 足元の面（読み込み前は
//     supportFn = citygen の supportHeightAt）から chuteHeight m で自動、またはジャンプでパラシュート（state 'chute'）。
//     パラシュートは前へ chuteSpeed m/s・下へ chuteDown m/s（スティックの前後で速さと降下の速さが変わる）、向きは視点。降りている間は peakY を
//     今の高さにし続けるので、着地で落下ダメージは無い。水に降りたら泳ぐ。agl = 足元の面からの高さ（ミニマップの縮尺）
//   speedScale: 歩く速さの倍率（回復中に cityplay.js が下げる）
window.MR = window.MR || {};

MR.Player = class Player {
  constructor(camera, cfg) {
    this.cfg = cfg;
    this.camera = camera;
    this.yaw = new THREE.Object3D();
    this.pitch = new THREE.Object3D();
    this.yaw.add(this.pitch);
    this.pitch.add(camera);
    camera.position.set(0, 0, 0);

    this.pos = new THREE.Vector3(0, 0, 0); // 足元
    this.vy = 0;
    this.grounded = true;
    this.yawAngle = 0;
    this.pitchAngle = 0;
    this.bobTime = 0;
    this.health = cfg.maxHealth;
    this.dead = false;
    this.radius = cfg.radius || 0.4;
    this.eyeHeight = cfg.eyeHeight || 1.6;
    this.recoilPitch = 0;
    this.shakeOffset = new THREE.Vector3();
    // 3D（街）
    this.mode3d = false;
    this.state = 'walk';        // walk | ladder | swim | vault
    this.vel = { x: 0, z: 0 };  // 水平の速度（空中・水中の慣性）
    this.eyeOffset = 0;         // 段差・着地でカメラを一時的にずらす量（なめらかに 0 へ戻る）
    this.peakY = 0;
    this.airTime = 0;
    this.ladder = null;
    this.events = [];
    this.indoors = false;
    this.speedScale = 1;
    this.agl = 0;
    this.fallCfg = null;
    this.supportFn = null;
  }

  get object() { return this.yaw; }

  // 3D の設定（config.player。無いキーは既定値）
  static get DEFAULTS3D() {
    return {
      height: 1.8, stepUp: 0.45, coyoteTime: 0.1, airControl: 2.5, maxFallSpeed: 50,
      ladderSpeed: 2.5, ladderStep: 0.55, swimSpeed: 2.2, swimAccel: 4, swimEyeAbove: 0.25, swimStroke: 1.0,
      climbOutHeight: 2.6, climbOutTime: 0.6, ladderMountTime: 0.45, vaultHeight: 1.35, vaultTime: 0.45,
      eyeSmooth: 12, landDip: 0.035, landDipMax: 0.3
    };
  }

  spawn(x, z, yawDeg, y) {
    this.pos.set(x, y || 0, z);
    this.vy = 0;
    this.grounded = true;
    this.bobTime = 0;
    this.recoilPitch = 0;
    this.yawAngle = THREE.MathUtils.degToRad(yawDeg || 0);
    this.pitchAngle = 0;
    this.health = this.cfg.maxHealth;
    this.dead = false;
    this._reset3d();
    this._apply();
  }

  _reset3d() {
    this.state = 'walk';
    this.vel.x = 0; this.vel.z = 0;
    this.eyeOffset = 0;
    this.peakY = this.pos.y;
    this.airTime = 0;
    this.ladder = null;
    this._vault = null;
    this._jumped = false;
    this._ladderCooldown = 0;
    this._ladderInvert = false;
    this._ladderTravel = 0;
    this._strokeTimer = 0;
    this.swimRoll = 0;
    if (this.camera.rotation.z) this.camera.rotation.z = 0;
    this.events.length = 0;
  }

  // 撃てる・照準できる状態か（梯子・水中・よじ登り中は銃を下げる）
  get canShoot() { return !this.mode3d || this.state === 'walk'; }
  // 降下中（自由落下・パラシュート）
  get falling() { return this.state === 'fall' || this.state === 'chute'; }

  // 反動で視点を跳ね上げる（度）
  kick(degrees) {
    this.recoilPitch += THREE.MathUtils.degToRad(degrees);
  }

  update(dt, input, world) {
    if (this.mode3d) { this._update3d(dt, input, world); return; }
    const cfg = this.cfg;
    this._updateLook(dt, input);

    // --- 移動 ---
    const mv = input.getMove();
    const sin = Math.sin(this.yawAngle), cos = Math.cos(this.yawAngle);
    // 前方向 = (−sin, −cos)（three.js はカメラが −Z を向く）
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;
    const speed = cfg.moveSpeed;
    let nx = this.pos.x + (fx * mv.y + rx * mv.x) * speed * dt;
    let nz = this.pos.z + (fz * mv.y + rz * mv.x) * speed * dt;
    const solved = world.nav.resolveCircle(nx, nz, this.radius);
    this.pos.x = solved.x;
    this.pos.z = solved.z;

    // --- ジャンプ・重力 ---
    if (input.consumeJump() && this.grounded) {
      this.vy = cfg.jumpSpeed;
      this.grounded = false;
    }
    this.vy += cfg.gravity * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.grounded = true; }

    // --- 歩行の揺れ ---
    const moving = (mv.x !== 0 || mv.y !== 0) && this.grounded;
    if (moving) this.bobTime += dt * 9;
    else this.bobTime = 0;
    this._apply();
  }

  // 乗り物に座っているとき: 視点だけ動かし、位置は座席（目の位置 eyeWorld）に合わせる。移動・重力・歩行の揺れは無し
  updateSeated(dt, input, eyeWorld) {
    this._updateLook(dt, input);
    this.setSeated(eyeWorld);
  }

  setSeated(eyeWorld) {
    this.pos.set(eyeWorld.x, eyeWorld.y - this.eyeHeight, eyeWorld.z);
    this.vy = 0;
    this.grounded = true;
    this.bobTime = 0;
    this._apply();
  }

  // 視点（タッチのスワイプ / マウス）と反動の戻り
  _updateLook(dt, input) {
    const cfg = this.cfg;
    const look = input.consumeLook();
    const pxPerInch = 160; // CSS px。だいたいのスマホで 1 インチ ≒ 160px
    let yawDelta, pitchDelta;
    if (input.pointerLocked) {
      yawDelta = look.x * cfg.mouseSensitivity;
      pitchDelta = look.y * cfg.mouseSensitivity;
    } else {
      yawDelta = look.x / pxPerInch * cfg.degreesPerInch;
      pitchDelta = look.y / pxPerInch * cfg.degreesPerInch;
    }
    this.yawAngle -= THREE.MathUtils.degToRad(yawDelta);
    this.pitchAngle -= THREE.MathUtils.degToRad(pitchDelta);
    // 反動の戻り
    if (this.recoilPitch > 0) {
      const back = Math.min(this.recoilPitch, dt * 1.2);
      this.recoilPitch -= back;
    }
    const maxPitch = THREE.MathUtils.degToRad(85);
    this.pitchAngle = Math.max(-maxPitch, Math.min(maxPitch, this.pitchAngle));
  }

  // ---------- 3D（街）----------

  _c3() {
    if (!this._cfg3 || this._cfg3src !== this.cfg) { this._cfg3src = this.cfg; this._cfg3 = Object.assign({}, Player.DEFAULTS3D, this.cfg || {}); }
    return this._cfg3;
  }

  _update3d(dt, input, world) {
    const nav = world.nav;
    const c = this._c3();
    this._updateLook(dt, input);
    const mv = input.getMove();
    const jump = input.consumeJump();
    if (this._ladderCooldown > 0) this._ladderCooldown -= dt;
    const y0 = this.pos.y;
    const wasWalking = this.state === 'walk' && this.grounded;
    if (this.state === 'fall' || this.state === 'chute') { this._updateFall(dt, mv, jump, nav, c); this._apply(); return; }
    if (this.state === 'ladder') this._updateLadder(dt, mv, jump, nav, c);
    else if (this.state === 'swim') this._updateSwim(dt, mv, nav, c);
    else if (this.state === 'vault') this._updateVault(dt, nav, c);
    else this._updateWalk(dt, mv, jump, nav, c);
    // 段差（上り下り）のカメラの高さはなめらかに。急に戻らないよう上限つき
    // 泳いでいるときだけカメラを少し傾ける（arena01 では触らない）
    const roll = this.state === 'swim' ? (this.swimRoll || 0) : 0;
    if (roll !== this.camera.rotation.z) this.camera.rotation.z += (roll - this.camera.rotation.z) * Math.min(1, dt * 6);
    if (Math.abs(this.camera.rotation.z) < 1e-4 && roll === 0) this.camera.rotation.z = 0;
    if (wasWalking && this.state === 'walk' && this.grounded) {
      const dy = this.pos.y - y0;
      if (Math.abs(dy) > 1e-4 && Math.abs(dy) <= c.stepUp + 0.05) this.eyeOffset -= dy;
    }
    this.eyeOffset = THREE.MathUtils.clamp(this.eyeOffset, -0.6, 0.6);
    this.eyeOffset *= Math.max(0, 1 - dt * c.eyeSmooth);
    if (Math.abs(this.eyeOffset) < 1e-4) this.eyeOffset = 0;
    // 歩行の揺れ（地面を歩いているときだけ）
    const moving = this.state === 'walk' && this.grounded && (mv.x !== 0 || mv.y !== 0);
    if (moving) this.bobTime += dt * 9;
    else this.bobTime = 0;
    this._apply();
  }

  // スティックの入力 → 世界の向き（単位ベクトルでない。長さ = 入力の大きさ）
  _wish(mv) {
    const sin = Math.sin(this.yawAngle), cos = Math.cos(this.yawAngle);
    return { x: -sin * mv.y + cos * mv.x, z: -cos * mv.y - sin * mv.x };
  }

  // 陸の地面（暗黙の y）が足より stepUp 以上高い所は入れない（護岸の中へ泳いで入らない）
  _terrainBlocked(nav, x, z, y, su) {
    if (typeof nav.groundAt !== 'function') return false;
    const r = this.radius * 0.9;
    const pts = [0, 0, r, 0, -r, 0, 0, r, 0, -r];
    for (let i = 0; i < pts.length; i += 2) {
      const g = nav.groundAt(x + pts[i], z + pts[i + 1]);
      if (g && g.water === null && g.y > y + su + 1e-3) return true;
    }
    return false;
  }

  // 水平に (dx, dz) 動かす（0.3 m 刻み。カプセルを箱から押し出し、陸の壁で止める）。grounded なら段を乗り降りする。戻り値 { hitWall, blocked }
  // 空中（glue でない）は air: 立てない箱（パラペット・柵）は段の高さでも壁（かすめて落ちるときに箱へめり込まない）
  _moveH(nav, dx, dz, c, glue) {
    const p = this.pos, r = this.radius, h = c.height, su = c.stepUp;
    const dist = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(dist / 0.3));
    let hitWall = false, blocked = false;
    for (let i = 0; i < n; i++) {
      let tx = p.x + dx / n, tz = p.z + dz / n;
      if (this._terrainBlocked(nav, tx, tz, p.y, su)) {
        // 軸ごとに滑らせる
        blocked = true;
        if (!this._terrainBlocked(nav, tx, p.z, p.y, su)) tz = p.z;
        else if (!this._terrainBlocked(nav, p.x, tz, p.y, su)) tx = p.x;
        else break;
      }
      let res = nav.resolveCapsule({ x: tx, y: p.y, z: tz }, r, h, su, { snapDown: glue ? su : 0.02, air: !glue });
      // 角に正面から当たって止まる（扉の枠の角を狙って歩いた）: 少し左右に振った向きで進めるならそちらへ（引っかからない）
      const sx = dx / n, sz = dz / n, want = Math.hypot(sx, sz);
      if (want > 0.005 && res.hitWall) {
        const ux = sx / want, uz = sz / want;
        let got = (res.x - p.x) * ux + (res.z - p.z) * uz;
        if (got < want * 0.4) {
          for (const a of [0.35, -0.35, 0.7, -0.7]) {
            const ca = Math.cos(a), sa = Math.sin(a);
            const q = nav.resolveCapsule({ x: p.x + sx * ca - sz * sa, y: p.y, z: p.z + sx * sa + sz * ca }, r, h, su, { snapDown: glue ? su : 0.02, air: !glue });
            const g2 = (q.x - p.x) * ux + (q.z - p.z) * uz;
            if (g2 > got + want * 0.25 && (!glue || q.grounded) && !this._terrainBlocked(nav, q.x, q.z, p.y, su)) { res = q; got = g2; }
          }
        }
      }
      if (this._terrainBlocked(nav, res.x, res.z, p.y, su)) { blocked = true; break; }
      if (res.hitWall) hitWall = true;
      p.x = res.x; p.z = res.z;
      if (glue) {
        if (res.grounded) { p.y = res.y; this.grounded = true; }
        else { this.grounded = false; glue = false; } // 縁から出た → 落ち始める（コヨーテタイム）
      } else if (res.grounded && this.vy <= 0) {
        this._land(res.y, c); // 段に足が掛かった（空中で段の縁に当たった）
        p.y = res.y; glue = true;
      } else if (res.hitCeiling && res.y < p.y) {
        p.y = res.y; if (this.vy > 0) this.vy = 0;
      } else if (res.y > p.y && res.y - p.y <= su) {
        p.y = res.y; // 上りながら段に乗った
      }
    }
    return { hitWall, blocked };
  }

  _updateWalk(dt, mv, jump, nav, c) {
    const p = this.pos;
    const wish = this._wish(mv);
    const speed = this.cfg.moveSpeed * (this.speedScale == null ? 1 : this.speedScale);
    const wasGrounded = this.grounded;
    if (this.grounded) { this.vel.x = wish.x * speed; this.vel.z = wish.z * speed; }
    else {
      const k = Math.min(1, dt * c.airControl);
      this.vel.x += (wish.x * speed - this.vel.x) * k;
      this.vel.z += (wish.z * speed - this.vel.z) * k;
    }
    // ジャンプ: 前へ押していて胸の高さまでの壁（パラペット・桟橋の柵・木箱）があれば乗り越える / 上に乗る
    if (jump && this.grounded && (mv.x !== 0 || mv.y !== 0) && this._tryVault(nav, wish, c)) return;
    // ジャンプ（接地中か、縁から出てコヨーテタイムの間）
    if (jump && !this._jumped && (this.grounded || this.airTime < c.coyoteTime)) {
      this.vy = this.cfg.jumpSpeed;
      this.grounded = false;
      this._jumped = true;
      this.events.push({ t: 'jump' });
    }
    // 梯子（壁の方へ押している / 屋上から梯子の上端の外へ押している）
    if (this._ladderCooldown <= 0 && (mv.x !== 0 || mv.y !== 0) && this._tryLadder(nav, wish, c)) return;

    const mh = this._moveH(nav, this.vel.x * dt, this.vel.z * dt, c, this.grounded && this.vy <= 0);
    this._lastHitWall = mh.hitWall || mh.blocked;

    if (!this.grounded) {
      this.vy = Math.max(-c.maxFallSpeed, this.vy + this.cfg.gravity * dt);
      const yOld = p.y;
      let yNew = yOld + this.vy * dt;
      const G = nav.groundHeight(p.x, p.z, yOld, this.radius * 0.5);
      const water = nav.waterLevelAt ? nav.waterLevelAt(p.x, p.z) : null;
      const floatY = water !== null ? water + c.swimEyeAbove - this.eyeHeight : null;
      if (this.vy <= 0) {
        if (G !== null && yNew <= G && (floatY === null || G >= floatY)) {
          this._land(G, c);
          yNew = G;
        } else if (floatY !== null && yNew <= floatY && (G === null || G < floatY)) {
          // 水に落ちた
          this.events.push({ t: 'splash', vy: this.vy, drop: Math.max(this.peakY, yOld) - floatY });
          yNew = floatY; this.vy = 0;
          this.state = 'swim';
          this._strokeTimer = 0.4;
          this.vel.x *= 0.3; this.vel.z *= 0.3;
          this.eyeOffset -= 0.25;
        }
      } else {
        const C = nav.ceilingHeight(p.x, p.z, yOld + c.height - 0.05, this.radius * 0.9);
        if (yNew + c.height > C) { yNew = Math.max(yOld, C - c.height); this.vy = 0; }
      }
      p.y = yNew;
      if (p.y < -80) p.y = -80; // 念のため（地面の無い所に落ち続けない）
    } else {
      this.vy = 0;
    }
    if (this.grounded) {
      this.airTime = 0; this._jumped = false; this.peakY = p.y;
      // 足元が水面より下（水の中の段）なら泳ぐ
      const water = nav.waterLevelAt ? nav.waterLevelAt(p.x, p.z) : null;
      if (water !== null && p.y < water + c.swimEyeAbove - this.eyeHeight - 0.05 && nav.groundHeight(p.x, p.z, p.y, this.radius * 0.5) === null) {
        this.state = 'swim';
        this.grounded = false;
      }
    } else {
      if (wasGrounded) this.peakY = p.y;
      this.airTime += dt;
      if (p.y > this.peakY) this.peakY = p.y;
    }
  }

  // 着地: 一番高かった所からの落差と速さを events へ（落下ダメージは game.js）、カメラを少し沈める
  _land(y, c) {
    const drop = Math.max(this.peakY, this.pos.y) - y;
    const vy = this.vy;
    this.events.push({ t: 'land', drop, vy });
    this.eyeOffset -= Math.min(c.landDipMax, Math.max(0, -vy) * c.landDip);
    this.vy = 0;
    this.grounded = true;
    this.peakY = y;
  }

  // ---------- 梯子 ----------

  _tryLadder(nav, wish, c) {
    if (typeof nav.ladderAt !== 'function') return false;
    const p = this.pos, r = this.radius;
    const wl = Math.hypot(wish.x, wish.z);
    if (wl < 0.3) return false;
    const wx = wish.x / wl, wz = wish.z / wl;
    // 前から: 梯子に触れていて、壁（-n）の方へ押している
    const l = nav.ladderAt(p.x, p.y, p.z, r);
    if (l && -(wx * l.nx + wz * l.nz) > 0.35 && (this.grounded || this.vy < 2.5)) {
      this._grabLadder(l, false);
      return true;
    }
    // 上から: 屋上で梯子の上端の内側に立ち、外（n）へ押している（パラペットの切れ目）
    if (this.grounded && typeof nav.laddersNear === 'function') {
      const list = nav.laddersNear(p.x, p.z, 2.0, this._ladBuf || (this._ladBuf = []));
      for (const L of list) {
        if (Math.abs(p.y - L.y1) > 0.7 || L.y1 - L.y0 < 2) continue;
        const ox = p.x - L.x, oz = p.z - L.z;
        const along = ox * L.nx + oz * L.nz;          // 壁の外向きの距離（内側は負）
        const lat = Math.abs(ox * -L.nz + oz * L.nx); // 壁に沿った横のずれ
        if (along > 0.2 || along < -1.6 || lat > 0.6) continue;
        if (wx * L.nx + wz * L.nz < 0.5) continue;
        this._grabLadder(L, true);
        return true;
      }
    }
    return false;
  }

  _grabLadder(l, fromTop) {
    const p = this.pos;
    this.state = 'ladder';
    this.ladder = l;
    this.grounded = false;
    this.vy = 0; this.vel.x = 0; this.vel.z = 0;
    this._ladderInvert = fromTop;
    this._ladderTravel = 0;
    if (fromTop) {
      // 上端から: 壁の外に出て、頭が屋上の縁より少し下になる高さで掴む。壁の方を向く
      const ny = l.y1 - 1.0;
      this.eyeOffset += p.y - ny;
      p.y = ny;
      p.x = l.x + l.nx * (this.radius + 0.2); p.z = l.z + l.nz * (this.radius + 0.2);
      this._turnTo = Math.atan2(l.nx, l.nz); // カメラの前（-Z）が壁（-n）を向く yaw
    } else this._turnTo = null;
    this.peakY = p.y;
    this.events.push({ t: 'ladder', on: true });
  }

  _releaseLadder(pushOff, c) {
    const l = this.ladder;
    this.state = 'walk';
    this.ladder = null;
    this.grounded = false;
    this.airTime = c.coyoteTime; // 梯子から跳んだら空中でもう一度は跳べない
    this._jumped = true;
    this._ladderCooldown = 0.45;
    if (l && pushOff) { this.vel.x = l.nx * pushOff; this.vel.z = l.nz * pushOff; }
    this.peakY = this.pos.y;
    this.events.push({ t: 'ladder', on: false });
  }

  _updateLadder(dt, mv, jump, nav, c) {
    const l = this.ladder, p = this.pos, r = this.radius;
    if (!l) { this.state = 'walk'; return; }
    // 上端から掴んだときは壁の方へ向き直る
    if (this._turnTo != null) {
      let d = this._turnTo - this.yawAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = Math.min(1, dt * 10);
      this.yawAngle += d * k;
      if (Math.abs(d) < 0.02) this._turnTo = null;
    }
    if (jump) {
      this.vy = 3.2;
      this._releaseLadder(3, c);
      this.events.push({ t: 'jump' });
      return;
    }
    // 上端から掴んだ直後はスティックを前に倒したまま = 降りる（一度離したら上 = 登る）
    if (this._ladderInvert && Math.abs(mv.y) < 0.2 && Math.abs(mv.x) < 0.2) this._ladderInvert = false;
    let up = this._ladderInvert ? -Math.abs(mv.y) : mv.y;
    // 壁と反対を向いて前へ押す → 離れる
    const fwdX = -Math.sin(this.yawAngle), fwdZ = -Math.cos(this.yawAngle);
    const facing = -(fwdX * l.nx + fwdZ * l.nz);
    if (!this._ladderInvert && facing < -0.35 && mv.y > 0.5) {
      this._releaseLadder(2.2, c);
      return;
    }
    if (Math.abs(up) < 0.15) up = 0;
    const dy = up * c.ladderSpeed * dt;
    p.y += dy;
    this._ladderTravel += Math.abs(dy);
    if (this._ladderTravel >= c.ladderStep) { this._ladderTravel = 0; this.events.push({ t: 'ladder_step' }); }
    // 梯子の線に寄せる（顔が段から 0.45 m ほど。近すぎると段が画面を覆う）
    const tx = l.x + l.nx * (r + 0.2), tz = l.z + l.nz * (r + 0.2);
    const k = Math.min(1, dt * 12);
    p.x += (tx - p.x) * k; p.z += (tz - p.z) * k;
    // 下端: 地面に着いたら降りる
    if (up < 0) {
      const G = nav.groundHeight(p.x, p.z, p.y, r * 0.5);
      if (G !== null && p.y <= G + 0.02) { p.y = G; this.state = 'walk'; this.ladder = null; this.grounded = true; this.peakY = G; this.events.push({ t: 'ladder', on: false }); return; }
      if (p.y < l.y0 - 0.3) { this._releaseLadder(0.5, c); return; }
    }
    // 上端: 屋上（壁の内側）へ上がる
    if (p.y >= l.y1 - 0.35) {
      const top = this._ladderTop(nav, l, c);
      if (top) {
        this._vault = { x0: p.x, y0: p.y, z0: p.z, x1: top.x, y1: top.y, z1: top.z, t: 0, T: c.ladderMountTime, kind: 'ladder' };
        this.state = 'vault';
        this.ladder = null;
        this.events.push({ t: 'ladder', on: false });
        return;
      }
      p.y = Math.min(p.y, l.y1 - 0.35);
    }
    // 上り下りの途中で壁から押し出されないよう、念のため箱から押し出す（梯子は壁の外面なので普通は動かない）
    const res = nav.resolveCapsule({ x: p.x, y: p.y, z: p.z }, r * 0.8, c.height, 0.1, { snapDown: 0 });
    p.x = res.x; p.z = res.z;
    this.peakY = p.y;
  }

  // 梯子の上端の先で立てる所（屋上・タンクの上）。無ければ null
  _ladderTop(nav, l, c) {
    for (const d of [0.9, 1.3, 1.7, 2.2]) {
      const x = l.x - l.nx * d, z = l.z - l.nz * d;
      const G = nav.groundHeight(x, z, l.y1 + 1.2, this.radius * 0.6);
      if (G === null || G < l.y1 - 2.5 || G > l.y1 + 1.65) continue;
      const res = nav.resolveCapsule({ x, y: G, z }, this.radius, c.height, c.stepUp, { snapDown: 0.05 });
      if (Math.hypot(res.x - x, res.z - z) > 0.2 || Math.abs(res.y - G) > 0.05) continue;
      if (nav.ceilingHeight(x, z, G + 0.2, this.radius) < G + c.height) continue;
      return { x: res.x, y: G, z: res.z };
    }
    return null;
  }

  // ---------- 乗り越え（ジャンプ + 前）----------
  // 前に足より stepUp〜vaultHeight 高い箱があり、その上に体が通る空きがあれば: 奥行きがあって立てるなら上に乗る（mantle）、
  // 薄ければ（パラペット・柵）向こう側へ越えて落ちる（落下ダメージは越えた高さから）
  _tryVault(nav, wish, c) {
    if (typeof nav.raycast !== 'function') return false;
    const p = this.pos, r = this.radius;
    const wl = Math.hypot(wish.x, wish.z);
    if (wl < 0.3) return false;
    const dx = wish.x / wl, dz = wish.z / wl;
    let hit = null;
    for (const hh of [0.5, 0.75, 1.0, 1.25]) {
      const h = nav.raycast(p.x, p.y + hh, p.z, dx, 0, dz, r + 0.75, { all: true });
      const b = h && h.box;
      if (!b || b.w == null || b.h == null || Math.abs(h.ny) > 0.5) continue; // 箱だけ（スロープ・地形は越えない）
      const top = b.y + b.h;
      if (!hit || top > hit.top) hit = { top, b, t: h.t };
    }
    if (!hit) return false;
    const rise = hit.top - p.y;
    if (rise <= c.stepUp || rise > c.vaultHeight) return false;
    const b = hit.b, x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    // 箱から出る距離（レイの向きで）
    const tx = dx > 1e-6 ? (x1 - p.x) / dx : dx < -1e-6 ? (x0 - p.x) / dx : Infinity;
    const tz = dz > 1e-6 ? (z1 - p.z) / dz : dz < -1e-6 ? (z0 - p.z) / dz : Infinity;
    const tExit = Math.min(tx, tz);
    const y1 = hit.top + 0.04;
    // 上を通る所に頭がつかえないか（箱の上・向こう側の上）
    const clear = (x, z) => nav.ceilingHeight(x, z, y1 + 0.1, r * 0.8) >= y1 + c.height;
    const fits = (x, z, y) => { const q = nav.resolveCapsule({ x, y, z }, r, c.height, 0.05, { snapDown: 0 }); return Math.hypot(q.x - x, q.z - z) < 0.12 ? q : null; };
    const midT = (hit.t + tExit) / 2;
    if (!clear(p.x + dx * midT, p.z + dz * midT)) return false;
    let kind = 'over', tgt = null, ty = y1;
    if ((b.f & 4) && tExit - hit.t >= 0.75) {
      // 奥行きのある台（木箱・室外機・段）: 上に立つ
      const d = Math.min(tExit - 0.05, hit.t + r + 0.1);
      const q = fits(p.x + dx * d, p.z + dz * d, hit.top);
      if (q && clear(q.x, q.z)) { tgt = q; ty = hit.top; kind = 'mantle'; }
    }
    if (!tgt) {
      const d = tExit + r + 0.12;
      const q = fits(p.x + dx * d, p.z + dz * d, y1);
      if (!q || !clear(q.x, q.z)) return false;
      tgt = q;
    }
    this._vault = { x0: p.x, y0: p.y, z0: p.z, x1: tgt.x, y1: ty, z1: tgt.z, t: 0, T: c.vaultTime * (0.7 + 0.3 * Math.min(1, rise / c.vaultHeight)), kind, dx, dz };
    this.state = 'vault';
    this.grounded = false;
    this.vy = 0; this.vel.x = 0; this.vel.z = 0;
    this.events.push({ t: 'vault' });
    return true;
  }

  // ---------- よじ登り（梯子の上端・水から岸へ）----------

  _updateVault(dt, nav, c) {
    const v = this._vault, p = this.pos;
    if (!v) { this.state = 'walk'; return; }
    v.t += dt;
    const u = Math.min(1, v.t / v.T);
    // 前半で上がり、後半で前へ
    const up = Math.min(1, u / 0.6), fw = u < 0.35 ? 0 : (u - 0.35) / 0.65;
    const e = (s) => s * s * (3 - 2 * s);
    const yTop = Math.max(v.y1, v.y0) + 0.08;
    p.y = v.y0 + (yTop - v.y0) * e(up);
    if (u >= 1) p.y = v.y1;
    p.x = v.x0 + (v.x1 - v.x0) * e(fw);
    p.z = v.z0 + (v.z1 - v.z0) * e(fw);
    if (u >= 1) {
      this._vault = null;
      this.state = 'walk';
      this.vy = 0; this.vel.x = 0; this.vel.z = 0;
      this.peakY = p.y;
      this._jumped = true;
      if (v.kind === 'over') {
        // 越えた: 向こう側へ少し進みながら落ちる（下に何があるかは重力で）
        this.grounded = false;
        this.airTime = c.coyoteTime;
        this.vel.x = v.dx * 2.2; this.vel.z = v.dz * 2.2;
      } else {
        this.grounded = true;
        this.airTime = 0; this._jumped = false;
      }
      if (v.kind === 'water') this.events.push({ t: 'climb_out' });
    }
  }

  // ---------- 泳ぐ ----------

  _updateSwim(dt, mv, nav, c) {
    const p = this.pos, r = this.radius;
    const water = nav.waterLevelAt ? nav.waterLevelAt(p.x, p.z) : null;
    if (water === null) { this.state = 'walk'; this.grounded = false; this.vy = 0; this.peakY = p.y; return; }
    const floatY = water + c.swimEyeAbove - this.eyeHeight;
    // 水面に浮く（少し上下に揺れる）。かいている間はひとかきごとに頭が少し上がって沈み、左右に少し傾く（泳いでいると分かるように）
    this._swimT = (this._swimT || 0) + dt;
    const wish = this._wish(mv);
    const stroking = Math.hypot(wish.x, wish.z) > 0.2;
    this._strokePh = stroking ? (this._strokePh || 0) + dt * Math.PI * 2 / c.swimStroke : (this._strokePh || 0) * Math.max(0, 1 - dt * 2);
    const target = floatY + Math.sin(this._swimT * 2.1) * 0.04 + (stroking ? Math.sin(this._strokePh) * 0.07 : 0);
    p.y += (target - p.y) * Math.min(1, dt * 5);
    this.swimRoll = Math.sin(this._swimT * 1.3) * 0.02 + (stroking ? Math.sin(this._strokePh * 0.5) * 0.035 : 0);
    const k = Math.min(1, dt * c.swimAccel);
    this.vel.x += (wish.x * c.swimSpeed - this.vel.x) * k;
    this.vel.z += (wish.z * c.swimSpeed - this.vel.z) * k;
    const mh = this._moveH(nav, this.vel.x * dt, this.vel.z * dt, c, false);
    if (mh.blocked) { this.vel.x *= 0.5; this.vel.z *= 0.5; }
    this.grounded = false; this.vy = 0; this.peakY = p.y;
    // 水をかく音（動いているときだけ）
    const moving = Math.hypot(wish.x, wish.z) > 0.2;
    if (moving) {
      this._strokeTimer -= dt;
      if (this._strokeTimer <= 0) { this._strokeTimer = c.swimStroke; this.events.push({ t: 'stroke' }); }
    } else this._strokeTimer = Math.min(this._strokeTimer, 0.3);
    // 足の下に浅い段（水中の階段・斜面）があれば歩いて上がる
    const G = nav.groundHeight(p.x, p.z, p.y, r * 0.5);
    if (G !== null && G >= p.y - 0.05) { p.y = G; this.state = 'walk'; this.grounded = true; this.peakY = G; return; }
    // 岸へよじ登る: 押している向きの少し先に、水面から climbOutHeight 以内の立てる面
    if (moving) {
      const wl = Math.hypot(wish.x, wish.z), dx = wish.x / wl, dz = wish.z / wl;
      // 頭の上に何か（桟橋の下など）があれば登れない
      const headC = nav.ceilingHeight(p.x, p.z, p.y + c.height - 0.3, r * 0.8);
      for (const d of [0.55, 0.85, 1.2]) {
        const px = p.x + dx * (r + d), pz = p.z + dz * (r + d);
        const top = nav.groundHeight(px, pz, water + c.climbOutHeight - c.stepUp, r * 0.6);
        if (top === null || top <= water + 0.1 || top - water > c.climbOutHeight) continue;
        if (headC < top + 0.6) break;
        if (d > 0.6 && !(mh.hitWall || mh.blocked)) break; // まだ岸に寄っていない
        const res = nav.resolveCapsule({ x: px, y: top, z: pz }, r, c.height, c.stepUp, { snapDown: 0.05 });
        if (Math.hypot(res.x - px, res.z - pz) > 0.25 || Math.abs(res.y - top) > 0.06) continue;
        if (nav.ceilingHeight(res.x, res.z, top + 0.2, r) < top + c.height) continue;
        this._vault = { x0: p.x, y0: p.y, z0: p.z, x1: res.x, y1: top, z1: res.z, t: 0, T: c.climbOutTime, kind: 'water' };
        this.state = 'vault';
        this.vel.x = 0; this.vel.z = 0;
        return;
      }
    }
  }

  // ---------- 降下（バトルロイヤル）----------

  // 自由落下を始める。vx, vz: 最初の水平の速さ、fc: royale.fall の設定、supportFn(x, z): 足元の面の高さ（読み込み前の目安）
  startFall(vx, vz, fc, supportFn) {
    this.fallCfg = fc || {};
    this.supportFn = supportFn || null;
    this.state = 'fall';
    this.grounded = false;
    this.ladder = null; this._vault = null;
    this.vel.x = vx || 0; this.vel.z = vz || 0;
    this.vy = -6;
    this.peakY = this.pos.y;
    this.airTime = 1; this._jumped = true;
    this.eyeOffset = 0;
    this.fallT = 0;
  }

  // 足元の面（当たり判定が読めていればそれ、無ければ supportFn。水なら水面）
  _fallGround(nav) {
    const p = this.pos;
    let G = nav.groundHeight(p.x, p.z, p.y, this.radius * 0.5);
    const w = nav.waterLevelAt ? nav.waterLevelAt(p.x, p.z) : null;
    // 読み込み前の目安（citygen の supportHeightAt）は水の上では水面を返すので、そこは立てる面にしない（泳ぐ）
    if (G === null && this.supportFn) { const s = this.supportFn(p.x, p.z); if (typeof s === 'number' && s <= p.y && !(w !== null && s <= w + 0.05)) G = s; }
    return { G, w };
  }

  _updateFall(dt, mv, jump, nav, c) {
    const fc = Object.assign({ speed: 55, minSpeed: 40, horiz: 24, accel: 2.5, chuteHeight: 90, chuteSpeed: 8, chuteFwdMax: 12, chuteBack: 4, chuteDown: 4.2, chuteDownMin: 2.8, chuteDownMax: 6.5, chuteStrafe: 3 }, this.fallCfg || {});
    const p = this.pos;
    this.fallT = (this.fallT || 0) + dt;
    const sin = Math.sin(this.yawAngle), cos = Math.cos(this.yawAngle);
    const fx = -sin, fz = -cos, rx = cos, rz = -sin;
    const k = Math.min(1, dt * fc.accel);
    let wantVy, wx, wz;
    if (this.state === 'fall') {
      // 下を向くほど速く（向いている向きに少し進む）。スティックで水平に
      const dive = Math.max(0, Math.min(1, -Math.sin(this.pitchAngle)));
      wantVy = -(fc.minSpeed + (fc.speed - fc.minSpeed) * dive);
      const hs = fc.horiz * (1 - 0.45 * dive);
      wx = (fx * mv.y + rx * mv.x) * hs; wz = (fz * mv.y + rz * mv.x) * hs;
      if (jump && this.fallT > 0.6) this._openChute(fc);
    } else {
      const fwd = mv.y >= 0 ? fc.chuteSpeed + (fc.chuteFwdMax - fc.chuteSpeed) * mv.y : fc.chuteSpeed + (fc.chuteSpeed - fc.chuteBack) * mv.y;
      wantVy = -(mv.y >= 0 ? fc.chuteDown + (fc.chuteDownMax - fc.chuteDown) * mv.y : fc.chuteDown + (fc.chuteDown - fc.chuteDownMin) * mv.y);
      wx = fx * fwd + rx * mv.x * fc.chuteStrafe; wz = fz * fwd + rz * mv.x * fc.chuteStrafe;
    }
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    this.vy += (wantVy - this.vy) * Math.min(1, dt * (this.state === 'fall' ? 1.2 : 2.5));
    // 水平（建物に当たれば止まる。読み込んだチャンクだけ）。段に足が掛かって立ったら着地
    this._moveH(nav, this.vel.x * dt, this.vel.z * dt, c, false);
    if (this.grounded) { this.state = 'walk'; this.vel.x *= 0.3; this.vel.z *= 0.3; this.events.push({ t: 'chute_land' }); return; }
    const gw = this._fallGround(nav);
    const G = gw.G, w = gw.w;
    const floor = G !== null ? G : (w !== null ? w : 0);
    this.agl = Math.max(0, p.y - floor);
    if (this.state === 'fall' && this.agl <= fc.chuteHeight) this._openChute(fc);
    let yNew = p.y + this.vy * dt;
    if (this.state === 'chute') this.peakY = yNew; // パラシュート: 着地で落下ダメージ無し
    else if (p.y > this.peakY) this.peakY = p.y;
    const floatY = w !== null ? w + c.swimEyeAbove - this.eyeHeight : null;
    if (G !== null && yNew <= G && (floatY === null || G >= floatY)) {
      // 着地
      p.y = G;
      this.state = 'walk';
      this._land(G, c);
      this.vel.x *= 0.3; this.vel.z *= 0.3;
      this.events.push({ t: 'chute_land' });
      return;
    }
    if (floatY !== null && yNew <= floatY && (G === null || G < floatY)) {
      this.events.push({ t: 'splash', vy: this.vy, drop: 0 });
      p.y = floatY; this.vy = 0;
      this.state = 'swim';
      this._strokeTimer = 0.4;
      this.vel.x *= 0.3; this.vel.z *= 0.3;
      this.events.push({ t: 'chute_land' });
      return;
    }
    p.y = yNew;
  }

  _openChute(fc) {
    if (this.state === 'chute') return;
    this.state = 'chute';
    this.peakY = this.pos.y;
    this.events.push({ t: 'chute', openTime: fc.openTime || 0.62 });
  }

  _apply() {
    const bobY = Math.sin(this.bobTime) * 0.025;
    const bobX = Math.cos(this.bobTime * 0.5) * 0.015;
    this.yaw.position.set(this.pos.x, this.pos.y + this.eyeHeight + bobY + this.eyeOffset, this.pos.z);
    this.yaw.rotation.y = this.yawAngle;
    this.pitch.rotation.x = this.pitchAngle + this.recoilPitch;
    this.camera.position.set(bobX + this.shakeOffset.x, this.shakeOffset.y, 0);
  }

  // 目の位置（ワールド座標）
  eyePosition(target) {
    return (target || new THREE.Vector3()).set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  // 胸の位置（敵の狙い用）
  chestPosition(target) {
    return (target || new THREE.Vector3()).set(this.pos.x, this.pos.y + 1.2, this.pos.z);
  }

  aimDirection(target) {
    const dir = target || new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dir;
  }

  takeDamage(amount) {
    if (this.dead) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) { this.dead = true; return true; }
    return false;
  }
};
