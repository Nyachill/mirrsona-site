// 敵。見つけたら A* でプレイヤーを追い、射程内で見えていれば立ち止まって撃つ。
// 街（cityMode。MR.EnemyDirector が出す）: 3D の歩行グラフ（nav.findPath3d）で階段・梯子を使い、屋上に上がって見張る。
//   役割 hunter（プレイヤーを追う）/ climber（近くの建物の屋上へ上がる → overwatch）/ overwatch（屋上で見張って撃つ）。
//   経路探索は director がフレームの予算の中でまとめて行う（requestPath）。見えるかは 3D のレイ（nav.lineOfSight）
window.MR = window.MR || {};

MR.Enemy = class Enemy {
  constructor(scene, cfg, x, z) {
    this.scene = scene;
    this.cfg = cfg;
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.health = cfg.health;
    this.dead = false;
    this.deathTime = 0;
    this.removed = false;
    this.path = [];
    this.pathIndex = 0;
    this.repathTimer = Math.random() * 0.3;
    this.nextFire = 1 + Math.random();
    this.radius = 0.45;
    this.moving = false;
    this.aiming = false;
    this._spheres = [];
    this.character = Enemy.createCharacter(cfg);
    this.group = this.character.root;
    scene.add(this.group);
    this._apply();
  }

  // 見た目: glTF の兵士（MR.CharacterGLB.preload 済みなら）、無ければコードで組んだ MR.Character
  static createCharacter(cfg) {
    const mcfg = (cfg && cfg.model) || {};
    if (MR.CharacterGLB && MR.CharacterGLB.available()) {
      try {
        const scale = (typeof mcfg.scale === 'number' && isFinite(mcfg.scale)) ? mcfg.scale : 1.0;
        return new MR.CharacterGLB({ scale, config: mcfg });
      } catch (e) {
        if (!Enemy._warnedGLB) {
          Enemy._warnedGLB = true;
          console.warn('[Enemy] glTF キャラクターを作れません。コードモデルで続行します:', e && e.message);
        }
      }
    }
    return new MR.Character({ scale: 1.0 });
  }

  // ctx: { world, player, enemies, dt, time, fx, audio, onEnemyShot(enemy, damage) }
  update(ctx) {
    if (this.cityMode) { this._updateCity(ctx); return; }
    const dt = ctx.dt;
    if (this.dead) {
      this.deathTime += dt;
      this.character.update(dt, {});
      if (this.deathTime > 4.0) this.removed = true;
      this._apply();
      return;
    }

    const cfg = this.cfg;
    const player = ctx.player;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this.moving = false;
    this.aiming = false;

    if (!player.dead && dist <= cfg.detectRange) {
      const eyeY = this.pos.y + 1.55;
      const canSee = ctx.world.nav.lineOfSight(this.pos.x, eyeY, this.pos.z, player.pos.x, player.pos.y + 1.4, player.pos.z);

      if (dist <= cfg.attackRange && canSee) {
        this.aiming = true;
        this._faceToward(dx, dz, dt, 10);
        this.nextFire -= dt;
        if (this.nextFire <= 0) {
          this.nextFire = cfg.fireInterval * (0.8 + Math.random() * 0.4);
          this._shoot(ctx, dist);
        }
        this.path = [];
      } else {
        this.repathTimer -= dt;
        if (this.repathTimer <= 0 || this.path.length === 0) {
          this.repathTimer = cfg.repathInterval;
          this.path = ctx.world.nav.findPath(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
          this.pathIndex = 0;
        }
        if (this.path.length) {
          const wp = this.path[this.pathIndex];
          const wx = wp.x - this.pos.x, wz = wp.z - this.pos.z;
          const wd = Math.sqrt(wx * wx + wz * wz);
          if (wd < 0.6) {
            if (this.pathIndex < this.path.length - 1) this.pathIndex++;
            else this.path = [];
          } else {
            const step = Math.min(wd, cfg.speed * dt);
            let nx = this.pos.x + wx / wd * step;
            let nz = this.pos.z + wz / wd * step;
            for (const o of ctx.enemies) {
              if (o === this || o.dead) continue;
              const ox = nx - o.pos.x, oz = nz - o.pos.z;
              const od = Math.sqrt(ox * ox + oz * oz);
              const minD = this.radius + o.radius;
              if (od > 1e-4 && od < minD) { nx += ox / od * (minD - od) * 0.5; nz += oz / od * (minD - od) * 0.5; }
            }
            const solved = ctx.world.nav.resolveCircle(nx, nz, this.radius);
            this.pos.x = solved.x; this.pos.z = solved.z;
            if (ctx.vehicles) for (const v of ctx.vehicles) v.pushOut(this.pos, this.radius);
            this._faceToward(wx, wz, dt, 8);
            this.moving = true;
          }
        } else {
          this._faceToward(dx, dz, dt, 6);
        }
      }
    }

    this.character.update(dt, { moving: this.moving, speed: 1, aiming: this.aiming });
    this._apply();
  }

  _faceToward(dx, dz, dt, speed) {
    const target = Math.atan2(dx, dz);
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * speed);
  }

  _shoot(ctx, dist) {
    const cfg = this.cfg;
    this.group.updateMatrixWorld(true);
    const from = this.character.muzzleWorldPosition();
    const to = ctx.player.chestPosition();
    const chance = cfg.hitChance * Math.max(0.35, 1 - dist / (cfg.attackRange * 1.6));
    const hit = Math.random() < chance;
    let h = null;
    if (!hit) {
      to.x += (Math.random() - 0.5) * 2.2;
      to.y += (Math.random() - 0.5) * 1.4;
      to.z += (Math.random() - 0.5) * 2.2;
      const dir = to.clone().sub(from).normalize();
      h = ctx.world.nav.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, 80);
      if (h) { to.set(h.x, h.y, h.z); ctx.fx.impact(to, new THREE.Vector3(h.nx, h.ny, h.nz)); }
    }
    ctx.fx.tracer(from, to, true);
    ctx.fx.muzzleSmoke(from, to.clone().sub(from).normalize());
    ctx.audio.enemyShoot(dist, from); // 3D 銃声（from = 銃口の世界座標）
    if (!hit) {
      // 弾道がカメラの近く（既定 1.5 m）を通ったら風切り音、着弾したら着弾音
      const eye = ctx.player.eyePosition ? ctx.player.eyePosition(new THREE.Vector3()) : ctx.player.chestPosition();
      const seg = to.clone().sub(from);
      const len2 = seg.lengthSq();
      const u = len2 > 0 ? THREE.MathUtils.clamp(eye.clone().sub(from).dot(seg) / len2, 0, 1) : 0;
      const closest = from.clone().addScaledVector(seg, u);
      const whizzDist = (ctx.audioCfg && ctx.audioCfg.whizzDistance) || 1.5;
      if (closest.distanceTo(eye) < whizzDist && typeof ctx.audio.whizz === 'function') ctx.audio.whizz(closest);
      if (h && typeof ctx.audio.impact === 'function' && MR.Audio.impactSurfaceAt) ctx.audio.impact(MR.Audio.impactSurfaceAt(ctx.world.nav, to), to);
    }
    if (hit) ctx.onEnemyShot(this, cfg.damage);
  }

  // 弾（レイ）との当たり判定。キャラクターが返す球（胴体…頭。glTF ならボーン位置）で近似。
  // 戻り値 { t, point, head } か null。同じ距離なら先に並ぶ胴体が勝つ
  intersectRay(origin, dir, maxDist) {
    const spheres = this.character.hitSpheres(this._spheres);
    let best = null;
    for (const s of spheres) {
      const t = Enemy.raySphere(origin, dir, s.center, s.radius);
      if (t !== null && t <= maxDist && (best === null || t < best.t)) best = { t, head: !!s.head };
    }
    if (!best) return null;
    best.point = origin.clone().addScaledVector(dir, best.t);
    return best;
  }

  static raySphere(o, d, c, r) {
    const oc = o.clone().sub(c);
    const b = oc.dot(d);
    const cc = oc.dot(oc) - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : null;
  }

  // 戻り値: このダメージで死んだら true
  takeDamage(amount, fromDir) {
    if (this.dead) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      this.deathTime = 0;
      this.character.die(fromDir);
      return true;
    }
    this.character.flinch();
    return false;
  }

  _apply() {
    this.group.position.x = this.pos.x;
    this.group.position.z = this.pos.z;
    // y はキャラクターのアニメーション（上下動・沈み込み）が持つ
    this.group.rotation.y = this.yaw;
  }

  dispose() {
    this.scene.remove(this.group);
    this.character.dispose();
  }
};

// =====================================================================================================================
// 街の敵（cityMode）
(function () {
  const E = MR.Enemy.prototype;
  const G = -20;

  // 街の敵として初期化する。opts: { y, role: 'hunter'|'climber'|'overwatch', legs: [{x,y,z}…]（climber の道順）, director }
  E.initCity = function (opts) {
    opts = opts || {};
    this.cityMode = true;
    this.pos.y = opts.y || 0;
    this.role = opts.role || 'hunter';
    this.legs = opts.legs || null;
    this.director = opts.director || null;
    this.path = null; this.pathSt = { i: 0 }; this.pathPending = false; this.goal = null; this.repathAt = 0;
    this.vy = 0; this.grounded = true;
    this.climb = null;
    this.canSee = false; this.losTimer = Math.random() * 0.2; this.lastSeenAt = -100; this.lastSeen = null;
    this.stuckTimer = 0; this.stuckPos = { x: this.pos.x, z: this.pos.z }; this.stuckCount = 0;
    this.blindTime = 0;
    this._yOff = 0;
    this.radius = 0.4;
    this.character.baseY = this.pos.y;
    this._apply();
    this.group.position.y = this.pos.y; this._yOff = this.pos.y;
    return this;
  };

  // 経路（1 m 格子の節点）を carrot（ahead m 先の点）でたどる。点に lad（梯子の登り口）があればそこで止まる
  MR.Enemy.carrot = function (path, st, pos, ahead) {
    while (st.i < path.length - 1) {
      const a = path[st.i];
      if (a.lad) break;
      if (Math.hypot(a.x - pos.x, a.z - pos.z) < 0.6 && Math.abs(a.y - pos.y) < 1.0) st.i++; else break;
    }
    let px = pos.x, pz = pos.z, left = ahead;
    for (let k = st.i; k < path.length; k++) {
      const q = path[k];
      if (q.lad || Math.abs(q.y - pos.y) > 1.2) return q;
      const d = Math.hypot(q.x - px, q.z - pz);
      if (d >= left) { const u = left / d; return { x: px + (q.x - px) * u, y: q.y, z: pz + (q.z - pz) * u }; }
      left -= d; px = q.x; pz = q.z;
    }
    return path[path.length - 1];
  };

  E._updateCity = function (ctx) {
    const dt = ctx.dt;
    // 生きている間 root.position.y を触らない glTF 兵士のため、前フレームに足した高さを戻してから更新する（remote_player.js と同じ）
    this.group.position.y -= this._yOff;
    this._yOff = 0;
    if (this.dead) {
      this.deathTime += dt;
      this.character.update(dt, {});
      if (this.deathTime > 4.0) this.removed = true;
    } else {
      this._thinkCity(ctx, dt);
      this.character.baseY = this.pos.y;
      this.character.update(dt, { moving: this.moving, speed: 1, aiming: this.aiming });
    }
    this._yOff = this.pos.y;
    this.group.position.y += this._yOff;
    this._apply();
  };

  E._thinkCity = function (ctx, dt) {
    const cfg = this.cfg, nav = ctx.world.nav, player = ctx.player;
    this.moving = false; this.aiming = false;
    // --- 見えるか（0.2 s ごと）---
    const eyeY = this.pos.y + 1.55;
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    const dx = px - this.pos.x, dz = pz - this.pos.z, dyc = (py + 1.2) - eyeY;
    const dist = Math.sqrt(dx * dx + dz * dz + dyc * dyc);
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.18 + Math.random() * 0.1;
      this.canSee = !player.dead && dist <= cfg.detectRange && nav.lineOfSight(this.pos.x, eyeY, this.pos.z, px, py + 1.3, pz);
      // ヘリで飛んでいるプレイヤーは真下の地面を覚える（追うのは地面の上）
      if (this.canSee) { this.lastSeenAt = ctx.time; this.lastSeen = { x: px, y: ctx.playerAir ? ctx.airGroundY : py, z: pz }; }
      if (ctx.director) ctx.director.stats.los++;
    }
    let range = this.role === 'overwatch' ? (cfg.roofAttackRange || cfg.attackRange * 1.5) : cfg.attackRange;
    if (ctx.playerAir && (ctx.airRange || cfg.heliAttackRange)) range = Math.max(range, ctx.airRange || cfg.heliAttackRange); // 飛んでいるヘリ（戦闘機は airRange）は遠くからでも撃つ
    // --- 撃つ（梯子の上では撃たない）---
    if (this.canSee && dist <= range && !this.climb && !player.dead) {
      this.aiming = true;
      this._faceToward(dx, dz, dt, 10);
      this.nextFire -= dt;
      if (this.nextFire <= 0) {
        this.nextFire = cfg.fireInterval * (0.8 + Math.random() * 0.4);
        this._shoot(ctx, dist);
      }
      this.blindTime = 0;
      this._settle(ctx, dt);
      return;
    }
    // --- 役割 ---
    const D = ctx.director;
    let goal = null;
    if (this.role === 'overwatch') {
      // 屋上で見張る: まずプレイヤーの側のパラペットの内側（見下ろせる所）へ。そこで待つ。長く見えなければ反対側を試し、それでも駄目なら降りて追う
      if (this.watch === undefined) this.watch = (D && this.building && this.building.roof) ? (D.edgeSpot(this.building, player.pos) || null) : null;
      if (this.watch && (Math.hypot(this.watch.x - this.pos.x, this.watch.z - this.pos.z) > 0.8 || Math.abs(this.watch.y - this.pos.y) > 0.6)) goal = this.watch;
      else {
        this.blindTime += dt;
        const pat = cfg.overwatchPatience || 12;
        if (this.blindTime > pat && this.watch && !this.rewatched && D) { this.rewatched = true; this.blindTime = pat * 0.5; this.watch = D.edgeSpot(this.building, player.pos) || null; this.path = null; }
        else if (this.blindTime > pat) { this.role = 'hunter'; this.path = null; this.legs = null; this.blindTime = 0; }
        else { this._faceToward(dx, dz, dt, 3); this._settle(ctx, dt); return; }
      }
    }
    if (this.role === 'climber') {
      // 建物の階段口を 1 階ずつ（扉 → 各階の階段の前 → 屋上）。着いたら見張り
      if (!this.legs || !this.legs.length) { this.role = 'hunter'; this.legs = null; }
      else {
        goal = this.legs[0];
        if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < 1.0 && Math.abs(goal.y - this.pos.y) < 0.7) {
          this.legs.shift(); this.path = null; this.repathAt = 0;
          if (!this.legs.length) {
            this.role = 'overwatch'; this.blindTime = 0; this.watch = undefined; this.rewatched = false;
            if (D) D.stats.roofs++;
            this._settle(ctx, dt);
            return;
          }
          goal = this.legs[0];
        }
      }
    }
    if (this.role === 'hunter' && !player.dead) {
      const tgt = this.lastSeen && ctx.time - this.lastSeenAt < 6 ? this.lastSeen : { x: px, y: ctx.playerAir ? ctx.airGroundY : py, z: pz };
      const tdx = tgt.x - this.pos.x, tdz = tgt.z - this.pos.z, td = Math.hypot(tdx, tdz);
      if (!this.legs && D && tgt.y > this.pos.y + 2.5 && td < 60) {
        // プレイヤーが上（屋上・上の階）: その建物の階段を 1 階ずつ
        const b = D.buildingAt(tgt.x, tgt.z);
        if (b) { this.legs = D.legsFor(b, tgt.y); this.legsFor = 'up:' + b.id; this.path = null; this.repathAt = 0; }
      } else if (!this.legs && D && this.pos.y > tgt.y + 2.5) {
        // 自分が上（屋上で見張っていた・上の階）: いる建物の階段で 1 階ずつ降りて扉から出る
        const b = D.buildingAt(this.pos.x, this.pos.z);
        if (b) { this.legs = D.legsDown(b, this.pos.y); this.legsFor = 'down:' + b.id; this.path = null; this.repathAt = 0; }
      }
      if (this.legs && !this.legs.length) { this.legs = null; this.legsFor = null; }
      if (this.legs && this.legs.length) {
        goal = this.legs[0];
        if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < 1.0 && Math.abs(goal.y - this.pos.y) < 0.7) {
          this.legs.shift(); this.path = null; this.repathAt = 0;
          if (!this.legs.length) { this.legs = null; this.legsFor = null; goal = tgt; } else goal = this.legs[0];
        }
      } else if (td > (cfg.hopDistance || 45) && D && Math.abs(tgt.y - this.pos.y) < 2.5) {
        // 遠い: 15〜35 m 先（プレイヤーの方）の歩ける所まで刻んで進む（経路探索を短く保つ）
        if (this.goal && this.goal.hop && Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) > 3 && (this.path || this.pathPending)) goal = this.goal; // 今のホップを続ける
        else goal = D.hopToward(this, tgt) || tgt;
      } else goal = tgt;
    }
    if (!goal) { this._settle(ctx, dt); return; }
    // 経路を頼む（間隔をあける。目標が大きく動いたら引き直す）
    const gMoved = this.goal ? Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) + Math.abs(goal.y - this.goal.y) : Infinity;
    if (!this.pathPending && !this.climb && D && ctx.time >= this.repathAt && (!this.path || gMoved > 3)) {
      this.goal = { x: goal.x, y: goal.y, z: goal.z, hop: !!goal.hop };
      this.repathAt = ctx.time + (cfg.repathCity || 2.5) + Math.random();
      D.requestPath(this, this.goal);
    if (D && this.goal.hop === false) this.badHops = null;
    }
    if (this.climb) { this._climbStep(ctx, dt); return; }
    if (!this.path || !this.path.length) { this._faceToward(dx, dz, dt, 4); this._settle(ctx, dt); return; }
    this._follow(ctx, dt);
  };

  // 経路の点へ歩く（3D: カプセルで箱から押し出し、足元は nav の地面）
  E._follow = function (ctx, dt) {
    const nav = ctx.world.nav, cfg = this.cfg;
    const path = this.path;
    const t = MR.Enemy.carrot(path, this.pathSt, this.pos, 1.0);
    if (t.lad && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 0.8) {
      const k = path.indexOf(t);
      const next = path[k + 1];
      if (next && this._startClimb(nav, t, next)) { this.pathSt.i = k + 1; return; }
      t.lad = false; // 梯子が見つからない: ふつうの点として扱う
    }
    const end = path[path.length - 1];
    if (t === end && Math.hypot(end.x - this.pos.x, end.z - this.pos.z) < 0.5 && Math.abs(end.y - this.pos.y) < 1) { this.path = null; this._settle(ctx, dt); return; }
    const wx = t.x - this.pos.x, wz = t.z - this.pos.z, wd = Math.hypot(wx, wz);
    if (wd > 1e-3) {
      const step = Math.min(wd, cfg.speed * dt);
      this._moveTo(ctx, this.pos.x + wx / wd * step, this.pos.z + wz / wd * step, dt);
      this._faceToward(wx, wz, dt, 8);
      this.moving = true;
    } else this._settle(ctx, dt);
    // 進んでいなければ経路を引き直す（3 回続いたら諦めてプレイヤーを直接狙う）
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.5) {
      const prog = Math.hypot(this.pos.x - this.stuckPos.x, this.pos.z - this.stuckPos.z);
      this.stuckTimer = 0; this.stuckPos.x = this.pos.x; this.stuckPos.z = this.pos.z;
      if (prog < 0.4 && this.moving) {
        this.stuckCount++;
        this.path = null; this.repathAt = 0;
        if (this.stuckCount >= 3 && this.role === 'climber') { this.role = 'hunter'; this.legs = null; this.stuckCount = 0; }
        if (ctx.director) ctx.director.stats.stuck++;
      } else this.stuckCount = 0;
    }
  };

  // 水平に (nx, nz) へ。足元は resolveCapsule の地面（段は stepUp まで）、無ければ落ちる
  E._moveTo = function (ctx, nx, nz, dt) {
    const nav = ctx.world.nav;
    // 他の敵と重ならない（高さが近いものだけ）
    for (const o of ctx.enemies) {
      if (o === this || o.dead || Math.abs((o.pos.y || 0) - this.pos.y) > 1.5) continue;
      const ox = nx - o.pos.x, oz = nz - o.pos.z, od = Math.sqrt(ox * ox + oz * oz), minD = this.radius + o.radius;
      if (od > 1e-4 && od < minD) { nx += ox / od * (minD - od) * 0.5; nz += oz / od * (minD - od) * 0.5; }
    }
    const res = nav.resolveCapsule({ x: nx, y: this.pos.y, z: nz }, 0.35, 1.8, 0.45, { snapDown: this.grounded ? 0.6 : 0.05 });
    this.pos.x = res.x; this.pos.z = res.z;
    if (res.grounded) { this.pos.y = res.y; this.vy = 0; this.grounded = true; }
    else this._fall(nav, dt);
    if (ctx.vehicles) for (const v of ctx.vehicles) if (Math.abs((v.pos.y || 0) - this.pos.y) < 1.6) v.pushOut(this.pos, this.radius);
  };

  E._fall = function (nav, dt) {
    const yOld = this.pos.y;
    this.vy = Math.max(-40, this.vy + G * dt);
    let y = yOld + this.vy * dt;
    const g = nav.groundHeight(this.pos.x, this.pos.z, yOld, 0.2);
    if (g !== null && y <= g) { y = g; this.vy = 0; this.grounded = true; }
    else this.grounded = false;
    const w = nav.waterLevelAt ? nav.waterLevelAt(this.pos.x, this.pos.z) : null;
    if (w !== null && y < w - 1.2) { y = w - 1.2; this.vy = 0; this.takeDamage(9999, null); } // 水に落ちた敵は溺れる（泳がない）
    this.pos.y = y;
  };

  // 止まっているときも足元を確かめる（足場が無くなれば落ちる）
  E._settle = function (ctx, dt) {
    if (this.climb) return;
    const nav = ctx.world.nav;
    if (this.grounded) {
      const g = nav.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.05, 0.2);
      if (g === null || g < this.pos.y - 0.6) this.grounded = false;
      else this.pos.y = g;
    }
    if (!this.grounded) this._fall(nav, dt);
  };

  // 梯子: 登り口 a（下か上）→ 次の点 b。nav の梯子を探して、足元 → 登る / 降りる → b へ
  E._startClimb = function (nav, a, b) {
    if (typeof nav.laddersNear !== 'function') return false;
    const up = b.y > a.y;
    let best = null, bd = Infinity;
    for (const l of nav.laddersNear((a.x + b.x) / 2, (a.z + b.z) / 2, 4)) {
      const ok = up ? Math.abs(l.y0 - a.y) < 1.2 && Math.abs(l.y1 - b.y) < 2.6 : Math.abs(l.y1 - a.y) < 2.6 && Math.abs(l.y0 - b.y) < 1.2;
      if (!ok) continue;
      const d = Math.hypot(l.x - a.x, l.z - a.z);
      if (d < bd) { bd = d; best = l; }
    }
    if (!best) return false;
    this.climb = { l: best, up, phase: 0, b: { x: b.x, y: b.y, z: b.z } };
    return true;
  };

  E._climbStep = function (ctx, dt) {
    const c = this.climb, l = c.l, cfg = this.cfg;
    const fx = l.x + l.nx * 0.55, fz = l.z + l.nz * 0.55;
    const sp = cfg.ladderSpeed || 2.4;
    this.moving = true;
    this.yaw = Math.atan2(-l.nx, -l.nz); // 壁の方を向く
    if (c.phase === 0) {
      // 足元（上からなら壁の内側から足元の真上）へ
      const d = Math.hypot(fx - this.pos.x, fz - this.pos.z);
      const st = Math.min(d, cfg.speed * dt);
      if (d > 0.05) { this.pos.x += (fx - this.pos.x) / d * st; this.pos.z += (fz - this.pos.z) / d * st; }
      if (d <= 0.06) c.phase = 1;
      return;
    }
    if (c.phase === 1) {
      const target = c.up ? l.y1 + 0.05 : Math.max(l.y0, c.b.y);
      const dy = target - this.pos.y, st = Math.min(Math.abs(dy), sp * dt);
      this.pos.y += Math.sign(dy) * st;
      this.pos.x = fx; this.pos.z = fz;
      if (Math.abs(target - this.pos.y) < 0.02) c.phase = 2;
      return;
    }
    // 上: 壁の内側の次の点へ（屋上の高さ）。下: そのまま次の点へ
    const d = Math.hypot(c.b.x - this.pos.x, c.b.z - this.pos.z);
    const st = Math.min(d, cfg.speed * dt);
    if (d > 0.05) { this.pos.x += (c.b.x - this.pos.x) / d * st; this.pos.z += (c.b.z - this.pos.z) / d * st; }
    if (c.up) this.pos.y = Math.max(this.pos.y, c.b.y);
    if (d <= 0.06) {
      this.pos.y = c.b.y; this.climb = null; this.grounded = true; this.vy = 0;
      if (ctx.director) ctx.director.stats.ladders++;
    }
  };
})();

// 街の敵の出し入れと経路探索の予算（game.js が街で作る）。
//   出す: プレイヤーから spawnMin〜spawnMax m、視野（spawnViewAngle 度）の外の、読み込み済みチャンクの建物の扉の前（street）・
//         ロビーの中（lobby）・屋上（roof）。生きている数を enemyCount に保つ。despawnDist m より遠くなったら消して近くに出し直す。
//         屋上にいる・屋上へ向かう敵（overwatch / climber）は maxOnRoofs まで（残りは追って来る hunter）。
//   経路: requestPath(enemy, goal) を並べ、1 フレーム pathBudgetMs まで nav.pathJob（A* を 100 展開ずつ。作っていない歩行グラフは
//         通れない扱い）。必要なチャンクの歩行グラフは graphBudgetMs まで buildGraphStep で少しずつ作る（出来るまでその経路は待つ）。
//         長い道は短く刻む: 建物の階段は 1 階ずつ（legsFor / legsDown）、遠い目標は 15〜35 m 先のホップ（hopToward）。
//   敵のいるチャンクは world.setNavKeep で当たり判定から外さない。
//   バトルロイヤル（royale.js）: prefer = { x, z } を入れるとその近くの候補から出し、出したら onSpawn(enemy) を呼ぶ
MR.EnemyDirector = class EnemyDirector {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = Object.assign({
      enemyCount: 7, spawnMin: 40, spawnMax: 120, despawnDist: 220, spawnViewAngle: 75, spawnInterval: 0.8,
      pathBudgetMs: 2.5, graphBudgetMs: 2.5, pathMaxExpand: 6000, roles: { street: 0.35, lobby: 0.3, roof: 0.35 }, climberChance: 0.6, maxOnRoofs: 3
    }, cfg || {});
    this.queue = [];
    this.spawnTimer = 0.5;
    this.stats = { spawned: 0, despawned: 0, paths: 0, pathFail: 0, pathMs: 0, pathMsMax: 0, graphMs: 0, graphMsMax: 0, graphs: 0, los: 0, roofs: 0, ladders: 0, stuck: 0, updMs: 0, updMsMax: 0, frames: 0, spawnKinds: { street: 0, lobby: 0, roof: 0 } };
  }

  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  requestPath(enemy, goal) {
    if (enemy.pathPending) return;
    enemy.pathPending = true;
    this.queue.push({ e: enemy, goal: { x: goal.x, y: goal.y, z: goal.z, hop: !!goal.hop } });
  }

  // 毎フレーム（敵の update の前）
  update(dt, ctx) {
    const g = this.game, nav = g.world.nav;
    this._despawn();
    this.spawnTimer -= dt;
    const alive = g.enemies.filter((e) => !e.dead && !e.removed).length;
    // ヘリで高く・速く飛んでいる間は新しく出さない（後ろに置いていく敵を出し続けない）。いる敵は撃ってくる
    const flying = ctx.playerAir && ((ctx.airAgl || 0) > (this.cfg.airSpawnAgl == null ? 40 : this.cfg.airSpawnAgl) || (ctx.airSpeed || 0) > (this.cfg.airSpawnSpeed == null ? 15 : this.cfg.airSpawnSpeed));
    if (this.spawnTimer <= 0 && alive < this.cfg.enemyCount && !g.player.dead && !flying) {
      this.spawnTimer = this.cfg.spawnInterval;
      const s0 = EnemyDirector.now();
      this.trySpawn(ctx);
      const ms = EnemyDirector.now() - s0;
      if (ms > (this.stats.spawnMsMax || 0)) this.stats.spawnMsMax = ms;
    }
    // 敵のいるチャンクを当たり判定に残す
    const keys = [];
    for (const e of g.enemies) { if (e.removed) continue; const c = g.city.chunkOf(e.pos.x, e.pos.z); const k = c.cx + '_' + c.cz; if (keys.indexOf(k) < 0) keys.push(k); }
    g.world.setNavKeep(keys);
    this._paths(nav);
  }

  _despawn() {
    const g = this.game, p = g.player.pos;
    for (const e of g.enemies) {
      if (e.dead || e.removed) continue;
      if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > this.cfg.despawnDist) { e.removed = true; this.stats.despawned++; }
    }
  }

  // 経路の要求を予算の中で処理する。必要なチャンクの歩行グラフが無ければ少しずつ作り（buildGraphStep）、
  // 探索も少しずつ進める（nav.pathJob。100 展開ごとに時間を見る）。1 フレームに使うのは pathBudgetMs まで
  _paths(nav) {
    const t0 = EnemyDirector.now();
    const budget = this.cfg.pathBudgetMs;
    const left = () => budget - (EnemyDirector.now() - t0);
    for (let guard = 0; guard < 30 && left() > 0.05; guard++) {
      if (!this.cur) {
        if (!this.queue.length) break;
        const q = this.queue.shift();
        if (q.e.dead || q.e.removed) { q.e.pathPending = false; continue; }
        this.cur = q;
      }
      const q = this.cur, e = q.e;
      if (e.dead || e.removed) { e.pathPending = false; this.cur = null; continue; }
      if (!q.job) {
        // 始点と終点の間（と周り 1 チャンク。回り道のため。読み込んでいないチャンクは数えない）の歩行グラフ
        const c = this.game.city, a = c.chunkOf(e.pos.x, e.pos.z), b = c.chunkOf(q.goal.x, q.goal.z);
        let ready = true;
        for (let cz = Math.min(a.cz, b.cz) - 1; cz <= Math.max(a.cz, b.cz) + 1 && ready; cz++) {
          for (let cx = Math.min(a.cx, b.cx) - 1; cx <= Math.max(a.cx, b.cx) + 1; cx++) {
            if (nav.graphReady(cx, cz)) continue;
            const g0 = EnemyDirector.now();
            const done = nav.buildGraphStep(cx, cz, Math.min(this.cfg.graphBudgetMs, Math.max(0.3, left())));
            const ms = EnemyDirector.now() - g0;
            this.stats.graphMs += ms; if (ms > this.stats.graphMsMax) this.stats.graphMsMax = ms;
            if (done) this.stats.graphs++;
            if (!done) { ready = false; break; }
          }
        }
        if (!ready) break; // 次のフレームで続き
        q.job = nav.pathJob({ x: e.pos.x, y: e.pos.y, z: e.pos.z }, q.goal, this.cfg.pathMaxExpand, { raw: true, lad: true });
        q.ms = 0;
      }
      const p0 = EnemyDirector.now();
      let res = null;
      try { res = q.job.step(Math.max(0.2, left())); } catch (err) { res = { fail: 'error' }; }
      const ms = EnemyDirector.now() - p0;
      q.ms += ms;
      if (ms > this.stats.pathMsMax) this.stats.pathMsMax = ms; // 1 フレームで使った最大
      if (!res) break; // 予算を使い切った: 次のフレームで続き
      this.cur = null;
      this.stats.paths++; this.stats.pathMs += q.ms;
      this.stats.expMax = Math.max(this.stats.expMax || 0, q.job.expanded);
      e.pathPending = false;
      if (res.path && res.path.length) { e.path = res.path; e.pathSt = { i: 0 }; e.stuckTimer = 0; }
      else {
        this.stats.pathFail++;
        const why = res.fail || 'error';
        this.stats.fails = this.stats.fails || {};
        this.stats.fails[why] = (this.stats.fails[why] || 0) + 1;
        e.repathAt = this.game.time + 1.5 + Math.random(); // 少し待ってからもう一度
        if ((this.stats.failSamples || (this.stats.failSamples = [])).length < 6) this.stats.failSamples.push({ why, role: e.role, kind: e.spawnKind, from: [+e.pos.x.toFixed(1), +e.pos.y.toFixed(2), +e.pos.z.toFixed(1)], to: [+q.goal.x.toFixed(1), +q.goal.y.toFixed(2), +q.goal.z.toFixed(1)], exp: q.job.expanded });
        e.path = null;
        if (q.goal.hop) { const bh = e.badHops || (e.badHops = []); bh.push({ x: q.goal.x, z: q.goal.z }); if (bh.length > 6) bh.shift(); e.goal = null; e.repathAt = 0; }
        if (e.role === 'climber') { e.role = 'hunter'; e.legs = null; }
        else if (!q.fallback && !e.legs) {
          // 届かない（屋上のプレイヤーなど）: 真下の地面の近くへ（歩行グラフはここでは作らない）
          const nb = nav._noBuild;
          nav._noBuild = true;
          let nf;
          try { nf = nav.nearestFree(q.goal.x, q.goal.z, 10, 0); } finally { nav._noBuild = nb; }
          const gy = nav.groundHeight(nf.x, nf.z, 1, 0.2);
          if (gy !== null && Math.abs(gy - q.goal.y) > 1) { e.pathPending = true; this.queue.push({ e, goal: { x: nf.x, y: gy, z: nf.z }, fallback: true }); }
        } else if (e.legs) { e.legs = null; e.legsFor = null; }
      }
    }
  }

  // 出す場所の候補（読み込み済みチャンクの建物）
  _candidates() {
    const g = this.game, W = g.world, out = [];
    for (const ch of W.nav.chunks.values()) {
      const d = W.cache.full(ch.cx, ch.cz);
      if (!d || !d.buildings) continue;
      for (const b of d.buildings) {
        if (!b.door || b.kind === 'landmark' || b.kind === 'gct') continue; // ランドマークの扉の点は飾りの箱の中のことがある
        out.push({ kind: 'street', x: b.door[0], y: b.door[1], z: b.door[2], b });
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        const ix = cx - b.door[0], iz = cz - b.door[2], il = Math.hypot(ix, iz) || 1;
        out.push({ kind: 'lobby', x: b.door[0] + ix / il * 4.5, y: b.door[1] + 0.5, z: b.door[2] + iz / il * 4.5, b });
        if (b.roof) out.push({ kind: 'roof', x: b.roof[0], y: b.roof[1], z: b.roof[2], b });
      }
    }
    return out;
  }

  // 1 体出す（候補を混ぜて、距離・視野・足場の条件に合う最初のもの）。出したら Enemy、無ければ null
  trySpawn(ctx, force) {
    const g = this.game, nav = g.world.nav, cfg = this.cfg, p = g.player.pos;
    const fwd = (ctx && ctx.camFwd) || { x: -Math.sin(g.player.yawAngle), z: -Math.cos(g.player.yawAngle) };
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const cosView = Math.cos(cfg.spawnViewAngle * Math.PI / 180);
    const cands = this._candidates();
    // 種類の重み → 候補を並べ替え
    const roles = cfg.roles, r = Math.random();
    // 屋上へ行く敵（overwatch / climber）は maxOnRoofs まで（多すぎると誰も追って来ず、撃ち合いにならない）
    const high = this.highCount() >= (cfg.maxOnRoofs == null ? 3 : cfg.maxOnRoofs);
    let want = r < roles.roof ? 'roof' : r < roles.roof + roles.lobby ? 'lobby' : 'street';
    if (high && want === 'roof') want = r < roles.roof * 0.5 ? 'lobby' : 'street';
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
    cands.sort((a, b) => (a.kind === want ? 0 : 1) - (b.kind === want ? 0 : 1));
    // prefer（{ x, z }。バトルロイヤルの近くにいる参加者の位置）があれば、そこに近い候補から
    if (this.prefer) { const pp = this.prefer; cands.sort((a, b) => Math.hypot(a.x - pp.x, a.z - pp.z) - Math.hypot(b.x - pp.x, b.z - pp.z)); }
    let built = false; // 歩行グラフを作り進めるのは 1 回の呼び出しで 1 度だけ（予算）
    for (const c of cands) {
      if (high && c.kind === 'roof') continue;
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (!force && (d < cfg.spawnMin || d > cfg.spawnMax)) continue;
      if (!force && (dx * fwd.x + dz * fwd.z) / (d * fl) > cosView) continue; // 視野の中には出さない
      let near = false;
      for (const e of g.enemies) if (!e.dead && Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 12) { near = true; break; }
      if (near) continue;
      const y = nav.groundHeight(c.x, c.z, c.y + 0.3, 0.3);
      if (y === null || Math.abs(y - c.y) > 0.7) continue;
      // 歩行グラフにつながっている所だけ（グラフがまだ無いチャンクは少し作り進めて次の機会に）
      const wk = nav.walkableAt(c.x, c.z, y, 4);
      if (wk === null) { if (!built) { built = true; const cc = g.city.chunkOf(c.x, c.z); nav.buildGraphStep(cc.cx, cc.cz, 1.0); } continue; }
      if (!wk) continue;
      const q = nav.resolveCapsule({ x: c.x, y, z: c.z }, 0.4, 1.8, 0.45, { snapDown: 0.1 });
      if (Math.hypot(q.x - c.x, q.z - c.z) > 0.3) continue;
      if (nav.ceilingHeight(q.x, q.z, y + 0.2, 0.4) < y + 1.9) continue;
      return this.spawnAt(q.x, y, q.z, c.kind, c.b);
    }
    return null;
  }

  // 建物の階段の道順: 1 階の階段口 → 各階の階段口 → …（targetY の階まで。'roof' か屋上の高さなら屋上の点まで）。
  // 屋上の点（citygen の roof）は階段室の入口の前なので、同じ (x, z) の各階の床が階段口の前になる
  legsFor(b, targetY) {
    if (!b || !b.roof || !b.door) return null;
    const n = Math.max(1, b.floors || 1), y0 = b.door[1], H = (b.roof[1] - y0) / n;
    const K = targetY === 'roof' ? n : Math.max(0, Math.min(n, Math.round((targetY - y0) / H)));
    const legs = [];
    for (let k = 0; k <= K; k++) legs.push({ x: b.roof[0], y: k === n ? b.roof[1] : y0 + k * H, z: b.roof[2] });
    return legs;
  }

  // 建物の階段で降りる道順: 今の階の階段口 → 下の階の階段口 → … → 1 階の階段口 → 扉の外
  legsDown(b, fromY) {
    if (!b || !b.roof || !b.door) return null;
    const n = Math.max(1, b.floors || 1), y0 = b.door[1], H = (b.roof[1] - y0) / n;
    const K = Math.max(0, Math.min(n, Math.round((fromY - y0) / H)));
    const legs = [];
    for (let k = K; k >= 0; k--) legs.push({ x: b.roof[0], y: k === n ? b.roof[1] : y0 + k * H, z: b.roof[2] });
    legs.push({ x: b.door[0], y: b.door[1], z: b.door[2] });
    return legs;
  }

  // 遠い目標へのホップ: 自分と同じ高さで、目標の方へ 35 / 25 / 15 m（左右 ±25°・±50° も）の、歩行グラフにつながった点
  //   通りは東西・南北なので、まず軸に沿った向き（遠い方の軸から）を試す。届かなかったホップ（e.badHops）の近くは避ける
  hopToward(e, tgt) {
    const nav = this.game.world.nav;
    const nb = nav._noBuild;
    nav._noBuild = true; // nearestFree が歩行グラフをその場で作らないように（作るのは _paths の予算の中だけ）
    try { return this._hopToward(nav, e, tgt); } finally { nav._noBuild = nb; }
  }
  _hopToward(nav, e, tgt) {
    const dx = tgt.x - e.pos.x, dz = tgt.z - e.pos.z, a0 = Math.atan2(dx, dz);
    const ax = Math.abs(dx) >= Math.abs(dz) ? [Math.atan2(Math.sign(dx), 0), Math.atan2(0, Math.sign(dz) || 1)] : [Math.atan2(0, Math.sign(dz)), Math.atan2(Math.sign(dx) || 1, 0)];
    const dirs = [ax[0], a0, ax[1], a0 + 0.44, a0 - 0.44, a0 + 0.87, a0 - 0.87];
    const bad = e.badHops || [];
    for (const d of [35, 25, 15]) {
      for (const a of dirs) {
        const x = e.pos.x + Math.sin(a) * d, z = e.pos.z + Math.cos(a) * d;
        if (Math.hypot(tgt.x - x, tgt.z - z) > Math.hypot(dx, dz) - 5) continue; // 近づかない向きは使わない
        const nf = nav.nearestFree(x, z, 4, e.pos.y);
        if (bad.some((b) => Math.hypot(b.x - nf.x, b.z - nf.z) < 8)) continue;
        const y = nav.groundHeight(nf.x, nf.z, e.pos.y + 0.5, 0.2);
        if (y === null || Math.abs(y - e.pos.y) > 1.5) continue;
        if (nav.walkableAt(nf.x, nf.z, y, 3) !== true) continue;
        return { x: nf.x, y, z: nf.z, hop: true };
      }
    }
    return null;
  }

  // 屋上の見張りの位置: 建物 b の 4 辺のうち目標の方を向いた辺の、パラペットの内側 0.9 m（目標の真正面に近い所から左右へ）。
  // 立てて（屋上の高さ ± 0.3）歩行グラフにつながった点。無ければ null
  edgeSpot(b, tgt) {
    const nav = this.game.world.nav, y = b.roof[1];
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, dx = tgt.x - cx, dz = tgt.z - cz;
    const sides = [{ nx: 1, nz: 0 }, { nx: -1, nz: 0 }, { nx: 0, nz: 1 }, { nx: 0, nz: -1 }].sort((a, c) => (c.nx * dx + c.nz * dz) - (a.nx * dx + a.nz * dz));
    for (const sd of sides.slice(0, 2)) {
      const along = sd.nx !== 0;
      const lo = (along ? b.z0 : b.x0) + 1.5, hi = (along ? b.z1 : b.x1) - 1.5;
      if (hi <= lo) continue;
      const t0 = Math.max(lo, Math.min(hi, along ? tgt.z : tgt.x));
      const edge = sd.nx > 0 ? b.x1 : sd.nx < 0 ? b.x0 : sd.nz > 0 ? b.z1 : b.z0;
      for (const off of [0, 2, -2, 4, -4, 7, -7, 10, -10]) {
        const t = t0 + off;
        if (t < lo || t > hi) continue;
        const x = along ? edge - sd.nx * 0.9 : t, z = along ? t : edge - sd.nz * 0.9;
        const g = nav.groundHeight(x, z, y + 0.3, 0.3);
        if (g === null || Math.abs(g - y) > 0.3) continue;
        if (nav.walkableAt(x, z, g, 2) !== true) continue;
        return { x, y: g, z };
      }
    }
    return null;
  }

  // (x, z) を含む建物（読み込み済みのチャンクの入れる建物）
  buildingAt(x, z) {
    const W = this.game.world, c = this.game.city.chunkOf(x, z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!W.nav.hasChunk((c.cx + dx) + '_' + (c.cz + dz))) continue;
      const d = W.cache.full(c.cx + dx, c.cz + dz);
      for (const b of (d && d.buildings) || []) if (b.roof && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.kind !== 'landmark' && b.kind !== 'gct') return b;
    }
    return null;
  }

  // 屋上にいる・屋上へ向かっている生きた敵の数
  highCount() {
    let n = 0;
    for (const e of this.game.enemies) if (!e.dead && !e.removed && (e.role === 'overwatch' || e.role === 'climber')) n++;
    return n;
  }

  spawnAt(x, y, z, kind, building) {
    const g = this.game;
    const maxHigh = this.cfg.maxOnRoofs == null ? 3 : this.cfg.maxOnRoofs;
    const climb = building && building.roof && kind !== 'roof' && this.highCount() < maxHigh && Math.random() < this.cfg.climberChance;
    const role = kind === 'roof' ? 'overwatch' : (climb ? 'climber' : 'hunter');
    const e = new MR.Enemy(g.scene, g.cityEnemyCfg, x, z);
    e.initCity({ y, role, legs: climb ? this.legsFor(building, 'roof') : null, director: this });
    e.building = building || null;
    e.spawnKind = kind;
    g.enemies.push(e);
    this.stats.spawned++;
    this.stats.spawnKinds[kind] = (this.stats.spawnKinds[kind] || 0) + 1;
    if (this.onSpawn) this.onSpawn(e); // バトルロイヤル: 近くの参加者をこの敵にする
    return e;
  }
};
