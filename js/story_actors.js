// ストーリーの役者（MR.StoryActor）と七号機（MR.StoryVtol）。storymode.js が作る。
//   StoryActor: 敵と同じ兵士（Enemy.createCharacter = 兵士の GLB を共有、材質は 1 人ずつの複製）。game.enemies には入れない
//     = プレイヤーの弾は当たらない・敵は狙わない（敵はプレイヤーだけを狙う）。kind 'ally'（レン）/ 'civ'（民間人: 銃とリュックを隠す）/ 'puppet'。
//     動き（mode）: idle / follow（プレイヤーの 3〜6 m 後ろ）/ lead（場所へ。プレイヤーが leadWait m より遅れたら待つ）/ hold / moveTo /
//     hide（物陰の列を、次の区間に敵がいないときだけ走る）/ board（ランプへ歩いて消える）。経路は director の経路探索（同じ予算）。
//     遅れて見えない（stuckDist m・stuckSec 秒）→ プレイヤーの後ろの見えない所へ移す。
//     味方の射撃（fire 'tagged'）: fireMin〜fireMax 秒ごとに range m 以内の見える敵へ（曳光弾と銃声）。倒すのは killShare の割合まで。
//   StoryActor.tint(character, look): 材質の色を掛ける（テクスチャは共有のまま = GPU 0）。'veil' は鏡のバイザー・'crew' は青緑の帯（共有の形と材質）。
//   StoryVtol: 本物の MR.Vtol（七号機）。V1 のうちは場面の間だけ姿勢を台本で動かす（v.update を差し替え、終わったら戻す）:
//     hoverAt / followPath / ramp(open) / rampTip() / fireAt / leave。V2 / V3 の公開の口が入ったらそちらへ（plan rev 2 §2）。
window.MR = window.MR || {};

(function () {
  const D2R = Math.PI / 180;
  const LOOKS = {
    veil: { tint: '#3a3d44', visor: true },
    crew: { tint: '#c9d6e2', band: true },
    civ: { tint: null, hideGun: true }
  };
  const CIV_COLORS = ['#c46a4a', '#4a7fc4', '#d9b45a', '#6aa86a', '#9a6ac4', '#c4c4c4'];
  let shared = null;
  const sharedMeshes = () => {
    if (shared) return shared;
    const srgb = (h) => (MR.srgb ? MR.srgb(h) : new THREE.Color(h));
    shared = {
      visorGeo: new THREE.BoxGeometry(0.2, 0.07, 0.06),
      visorMat: new THREE.MeshStandardMaterial({ color: srgb('#c8d4e0'), metalness: 1, roughness: 0.15, emissive: srgb('#6a7a8a'), emissiveIntensity: 0.25 }),
      bandGeo: new THREE.BoxGeometry(0.3, 0.05, 0.3),
      bandMat: new THREE.MeshStandardMaterial({ color: srgb('#1ec8b4'), emissive: srgb('#1ec8b4'), emissiveIntensity: 1.2, roughness: 0.5 })
    };
    return shared;
  };

  class StoryActor {
    // def: 章の actors[id]（kind, name, look, weapon, fire）、pos: { x, y, z, yaw }、opts: { cfg（story.ally / story.civ）, rand }
    constructor(game, id, def, pos, opts) {
      this.game = game; this.id = id; this.def = def; this.kind = def.kind || 'ally';
      opts = opts || {};
      this.cfg = Object.assign({ speed: 4.2, dps: 18, killShare: 0.4, fireMin: 0.6, fireMax: 1.2, range: 40, followMin: 3, followMax: 6, leadWait: 15, stuckDist: 25, stuckSec: 3, clearRadius: 25, shadowDist: 30, pathMaxExpand: 80000 }, opts.cfg || {});
      this.rand = opts.rand || Math.random;
      const ecfg = Object.assign({}, game.cityEnemyCfg || game.config.enemies, { speed: this.cfg.speed });
      const b = this.body = new MR.Enemy(game.scene, ecfg, pos.x, pos.z);
      b.knife = false;
      b.initCity({ y: pos.y || 0, role: 'story', director: game.director || null });
      b.yaw = ((pos.yaw || 0) + 180) * D2R; // 場所の yaw = 向く方（プレイヤーと同じ: カメラの yaw）→ 敵の yaw（前 = (sin, cos)）
      b.isStoryActor = true;
      b._apply();
      this.mode = 'idle'; this.target = null; this.route = null; this.routeI = 0; this.wait = 0;
      this.fireT = 1; this.kills = 0; this.shots = 0; this.boarded = false; this.gone = false; this.arrived = false;
      this.stuckT = 0; this.teleports = 0;
      StoryActor.tint(b.character, def.look || (this.kind === 'civ' ? 'civ' : 'crew'), this.kind === 'civ' ? CIV_COLORS[Math.floor(this.rand() * CIV_COLORS.length)] : null);
    }

    get pos() { return this.body.pos; }

    // 材質の色（look）・バイザー・帯・銃を隠す
    static tint(ch, look, color) {
      const L = LOOKS[look] || {};
      const col = color || L.tint;
      if (col && MR.srgb) {
        const c = MR.srgb(col);
        const mats = ch.ownMaterials || (ch.mats ? [ch.mats.armor, ch.mats.cloth] : []);
        for (const m of mats) if (m && m.color) { m.color.multiply(c); if (m.color.r + m.color.g + m.color.b < 0.02) m.color.setRGB(0.02, 0.02, 0.025); }
      }
      if (L.hideGun) {
        if (ch.gun) ch.gun.visible = false;
        const root = ch.model || ch.root;
        if (root) root.traverse((o) => { if (/backpack/i.test(o.name || '')) o.visible = false; });
      }
      const S = (L.visor || L.band) ? sharedMeshes() : null;
      const head = ch.headBone || ch.head || null;
      if (L.visor && head) { const m = new THREE.Mesh(S.visorGeo, S.visorMat); m.position.set(0, ch.headBone ? 0.08 : 0.02, ch.headBone ? 0.1 : 0.13); m.userData.storyShared = true; head.add(m); }
      const chest = ch.chestBone || (ch.model && ch.model.getObjectByName && ch.model.getObjectByName('spine_05')) || ch.torso || null;
      if (L.band && chest) { const m = new THREE.Mesh(S.bandGeo, S.bandMat); m.position.set(0, 0.05, 0); m.userData.storyShared = true; chest.add(m); }
    }

    // ---------- 命令 ----------
    setMode(mode, target, route) {
      this.mode = mode; this.target = target || null; this.arrived = false; this.targetFn = null; this.rampFn = null; this._onRamp = false;
      if (route) { this.route = route; this.routeI = 0; this.wait = 0; } else if (mode !== 'hide') this.route = null;
      const b = this.body; b.path = null; b.goal = null; b.repathAt = 0;
      if (mode === 'board' || mode === 'moveTo' || mode === 'lead' || mode === 'hold') b.goal = null;
    }

    // ---------- 毎フレーム ----------
    update(dt, ctx, story) {
      if (this.gone) return;
      const b = this.body, g = this.game, P = g.player;
      b.group.position.y -= b._yOff; b._yOff = 0;
      b.moving = false; b.aiming = false;
      let goal = null;
      const pp = P.pos;
      const dP = Math.hypot(b.pos.x - pp.x, b.pos.z - pp.z);
      if (this.mode === 'follow') {
        if (dP > this.cfg.followMax) {
          // プレイヤーの後ろ（狙っている向きと反対の側）
          const fx = -Math.sin(P.yawAngle), fz = -Math.cos(P.yawAngle);
          goal = { x: pp.x - fx * this.cfg.followMin, y: pp.y, z: pp.z - fz * this.cfg.followMin };
        }
      } else if (this.mode === 'lead' || this.mode === 'moveTo' || this.mode === 'board' || this.mode === 'hold') {
        // 道順（route）があれば点を順に（長い道を 1 回の経路探索にしない）。最後の点 = target
        // 乗る先（七号機のランプ）は毎フレーム引き直す: 降りてランプが開くまでは待つ
        if (this.targetFn && !this._onRamp) this.target = this.targetFn();
        const viaRoute = this.route && this.mode === 'lead' && this.routeI < this.route.length - 1;
        const t = viaRoute ? this.route[this.routeI] : this.target;
        if (t) {
          const dT = Math.hypot(b.pos.x - t.x, b.pos.z - t.z);
          const waitP = this.mode === 'lead' && dP > this.cfg.leadWait;
          if (dT < (viaRoute ? 2.5 : this.mode === 'board' ? 2.5 : 1.0) && Math.abs(b.pos.y - t.y) < 1.2) {
            if (viaRoute) { this.routeI++; b.path = null; b.goal = null; b.repathAt = 0; }
            else if (this.mode === 'board' && this.rampFn) this._onRamp = true;
            else { this.arrived = true; if (this.mode === 'board') this._board(story); }
          } else if (!waitP) goal = t;
        }
      } else if (this.mode === 'hide') {
        const R = this.route;
        if (R && this.routeI < R.length) {
          const q = R[this.routeI];
          if (Math.hypot(b.pos.x - q.x, b.pos.z - q.z) < 1.2) {
            // 次の区間に敵がいなければ走る
            const nxt = R[this.routeI + 1];
            if (!nxt) this.arrived = true;
            else if (!this._enemyNear(nxt, this.cfg.clearRadius)) { this.routeI++; b.path = null; }
          } else goal = q;
        } else this.arrived = true;
      }
      if (this._onRamp && this.mode === 'board') {
        // 経路の外の最後の数 m: ランプの先までまっすぐ（機体の箱の中は経路が無い）
        const q = this.rampFn && this.rampFn();
        if (!q) this._onRamp = false;
        else {
          const dx = q.x - b.pos.x, dz = q.z - b.pos.z, l = Math.hypot(dx, dz), st = this.cfg.speed * 0.7 * dt;
          if (l <= Math.max(0.8, st)) { this._onRamp = false; this.arrived = true; this._board(story); return; }
          b.pos.x += dx / l * st; b.pos.z += dz / l * st; b.pos.y += (q.y - b.pos.y) * Math.min(1, dt * 4);
          b._faceToward(dx, dz, dt, 6); b.moving = true; b._apply();
          goal = null;
        }
      }
      if (this._onRamp) { /* 上で動かした */ }
      else if (goal) this._go(goal, ctx, dt);
      else if (b.path && b.path.length && !this.arrived && this.mode !== 'follow') b._follow(ctx, dt);
      else { b._settle(ctx, dt); if (this.mode !== 'civ') this._face(pp, dt, 3); }
      // 遅れて見えない → プレイヤーの後ろへ移す（味方だけ）
      if (this.kind === 'ally' && (this.mode === 'follow' || this.mode === 'lead') && dP > this.cfg.stuckDist && !story.sees(b.pos)) {
        this.stuckT += dt;
        if (this.stuckT > this.cfg.stuckSec) { this.stuckT = 0; this._teleportBehind(); }
      } else this.stuckT = 0;
      // 民間人が止まったまま（経路が無い・段差）: stuckSec × 3 秒進まず、プレイヤーに見えていなければ次の点へ移す（台本が詰まらない）
      if (this.kind === 'civ' && (this.mode === 'hide' || this.mode === 'board') && !this.arrived) {
        const q = this.mode === 'hide' ? (this.route && this.route[this.routeI]) : this.target;
        const pr = this._prog || (this._prog = { x: b.pos.x, z: b.pos.z, t: 0 });
        pr.t += dt;
        if (Math.hypot(b.pos.x - pr.x, b.pos.z - pr.z) > 1) { pr.x = b.pos.x; pr.z = b.pos.z; pr.t = 0; }
        if (q && pr.t > this.cfg.stuckSec * 3 && !story.sees(b.pos) && !story.sees(q)) { b.pos.set(q.x, q.y, q.z); b.path = null; b.goal = null; pr.t = 0; this.teleports++; }
      }
      // 射撃
      if (this.kind === 'ally' && this.def.fire !== 'none') this._fire(dt, story);
      b.character.baseY = b.pos.y;
      b.character.update(dt, { moving: b.moving, speed: 1, aiming: b.aiming });
      b._yOff = b.pos.y; b.group.position.y += b._yOff;
      b._apply();
      // 遠い役者は影を落とさない
      const far = dP > this.cfg.shadowDist;
      if (far !== this._far) { this._far = far; b.group.traverse((o) => { if (o.isMesh && !o.userData.storyShared) o.castShadow = !far; }); }
    }

    _go(goal, ctx, dt) {
      const b = this.body, D = this.game.director;
      const gm = b.goal ? Math.hypot(goal.x - b.goal.x, goal.z - b.goal.z) : Infinity;
      if (D && !b.pathPending && this.game.time >= b.repathAt && (!b.path || gm > 2.5)) {
        b.goal = { x: goal.x, y: goal.y, z: goal.z };
        b.repathAt = this.game.time + 1.2;
        D.requestPath(b, b.goal, this.cfg.pathMaxExpand);
      }
      if (b.path && b.path.length) b._follow(ctx, dt);
      else b._settle(ctx, dt);
    }

    _face(p, dt, k) { const b = this.body; b._faceToward(p.x - b.pos.x, p.z - b.pos.z, dt, k); }

    _enemyNear(p, r) {
      for (const e of this.game.enemies) if (!e.dead && !e.removed && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < r) return true;
      return false;
    }

    _teleportBehind() {
      const g = this.game, P = g.player, nav = g.world.nav, b = this.body;
      const fx = -Math.sin(P.yawAngle), fz = -Math.cos(P.yawAngle);
      for (const d of [6, 9, 4, 12]) {
        const x = P.pos.x - fx * d, z = P.pos.z - fz * d;
        const y = nav.groundHeight(x, z, P.pos.y + 1, 0.5);
        if (y === null || Math.abs(y - P.pos.y) > 1.5) continue;
        const q = nav.resolveCapsule({ x, y, z }, 0.35, 1.8, 0.45, { snapDown: 0.3 });
        if (Math.hypot(q.x - x, q.z - z) > 0.4) continue;
        b.pos.set(q.x, q.y, q.z); b.path = null; b.goal = null; b.vy = 0; this.teleports++;
        // 道順の途中なら、移った所から一番近道になる次の点へ（通り過ぎた点へ戻らない）
        const R = this.route;
        if (R && this.mode === 'lead' && this.routeI < R.length - 1) {
          let best = this.routeI, bestC = Infinity, tail = 0;
          const rest = []; for (let i = R.length - 1; i >= this.routeI; i--) { rest[i] = tail; if (i > 0) tail += Math.hypot(R[i].x - R[i - 1].x, R[i].z - R[i - 1].z); }
          for (let i = this.routeI; i < R.length; i++) { const c = Math.hypot(R[i].x - q.x, R[i].z - q.z) + rest[i]; if (c < bestC) { bestC = c; best = i; } }
          this.routeI = Math.min(best, R.length - 1);
        }
        return true;
      }
      return false;
    }

    _fire(dt, story) {
      this.fireT -= dt;
      if (this.fireT > 0) return;
      this.fireT = this.cfg.fireMin + this.rand() * (this.cfg.fireMax - this.cfg.fireMin);
      const g = this.game, b = this.body, nav = g.world.nav;
      let best = null, bd = this.cfg.range;
      const ey = b.pos.y + 1.55;
      for (const e of g.enemies) {
        if (e.dead || e.removed || !e.storyTag) continue;
        const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z, e.pos.y - b.pos.y);
        if (d >= bd) continue;
        if (!nav.lineOfSight(b.pos.x, ey, b.pos.z, e.pos.x, e.pos.y + 1.3, e.pos.z)) continue;
        best = e; bd = d;
      }
      if (!best) return;
      b.aiming = true;
      this._face(best.pos, 1, 1);
      b.group.updateMatrixWorld(true);
      const from = b.character.muzzleWorldPosition(new THREE.Vector3());
      const to = new THREE.Vector3(best.pos.x, best.pos.y + 1.3, best.pos.z);
      if (g.fx) { g.fx.tracer(from, to, false); g.fx.muzzleSmoke(from, to.clone().sub(from).normalize()); }
      if (g.audio && typeof g.audio.enemyShoot === 'function') g.audio.enemyShoot(Math.max(1, b.pos.distanceTo(g.player.pos)), from);
      this.shots++;
      let dmg = this.cfg.dps * (this.cfg.fireMin + this.cfg.fireMax) / 2;
      // 倒すのは killShare の割合まで（プレイヤーが主に戦う）
      const total = story.killsTotal + 1;
      if (best.health - dmg <= 0 && (this.kills + 1) > this.cfg.killShare * total) dmg = Math.max(0, best.health - 1);
      if (dmg <= 0) return;
      const dir = to.clone().sub(from).normalize();
      if (best.takeDamage(dmg, dir)) { this.kills++; story.onKill(best, 'ally'); }
    }

    _board(story) {
      if (this.boarded) return;
      this.boarded = true; this.gone = true;
      this.body.group.visible = false;
      if (story) story.onActorBoarded(this);
    }

    placeAt(p) { const b = this.body; b.pos.set(p.x, p.y, p.z); b.path = null; b.goal = null; if (p.yaw != null) b.yaw = (p.yaw + 180) * D2R; this.gone = false; this.boarded = false; b.group.visible = true; b._apply(); }

    dispose() {
      const b = this.body;
      b.group.traverse((o) => { if (o.userData && o.userData.storyShared && o.parent) o.parent.remove(o); });
      if (b.group.parent) b.group.parent.remove(b.group);
      b.dispose();
      this.gone = true;
    }
  }

  // ---------- 七号機 ----------
  class StoryVtol {
    // spot: { x, y, z, yaw（度）}（地上に止めておく所）、cfg: story.vtol
    constructor(game, spot, cfg) {
      this.game = game;
      this.cfg = Object.assign({ speed: 22, climb: 6, rampSec: 2.5, turnRate: 60, routeClear: 25, routeSide: 24, routeEnd: 30, legReach: 6, descendAbove: 15 }, cfg || {});
      this.v = null; this.spot = spot;
      this.script = null; // { kind: 'hover' | 'path', pts, i, speed, yaw, hold }
      this.rampWant = 0;
      this.fire = null; // { x, y, z, t, sec, n }
      this.stats = { scripted: 0, fired: 0 };
    }

    ensure() {
      if (this.v && !this.v.disposed) return this.v;
      const g = this.game, s = this.spot;
      const def = Object.assign({ id: 'vtol' }, ((g.config.vehicles || {}).types || {}).vtol || {});
      if (!MR.Vtol || !def.kind) return null;
      const v = g._makeCityVtol({ id: 'no7', type: 'vtol', x: s.x, y: s.y, z: s.z, yaw: s.yaw || 0, name: '七号機' }, null, def);
      v.storyPinned = true; v.storyNo7 = true; v.cityTouched = true; v.storyTag = 'no7';
      MR.Vtol.home = v;
      this.v = v;
      return v;
    }

    // 自動操縦は本物の MR.Vtol の物語の API（hoverAt / followPath / fireGunsAt。vtol.js の頭の「物語の API」）。
    // 傾斜板と機内は V2（openRamp / rampState / rampTip・歩いて入る = 'boarded'）
    get scripted() { return !!(this.v && this.v.script); }

    // 場所へ飛んでホバリング（yaw は機首の向き = 度、前 = (sin, cos)）。instant: その場に置いて空中で始める
    hoverAt(p, yawDeg, instant) {
      const v = this.ensure(); if (!v) return;
      const yaw = (yawDeg || 0) * D2R;
      if (instant) {
        v.pos.set(p.x, p.y, p.z); v.yaw = yaw; v.vel.set(0, 0, 0);
        v.grounded = false; v.engineOn = true; v.spool = 1; v.theta = 90;
        if (v._parkedOn && v._showParked) v._showParked(false);
        v._updateQuat(); v._apply();
        v.hoverAt({ x: p.x, y: p.y, z: p.z }, yaw, { holdYaw: true });
        this._pathYaw = null;
      } else this._fly([p], this.cfg.speed, yawDeg);
      this.stats.scripted++;
    }
    followPath(pts, speed, yawDeg) {
      if (!this.ensure() || !pts.length) return;
      this._fly(pts, speed || this.cfg.speed, yawDeg);
      this.stats.scripted++;
    }
    // 本物の自動操縦は建物に当たる（物理は操縦士と同じ）。区間の線の上（左右 routeSide m・行き先の routeEnd m 手前まで）の一番高い箱
    // （HeliCollider.maxTop）が区間の低い方の高さ − routeClear より上なら、上がって越えて降りる点を足す（章の点はそのまま = 最後の寄せは台本の責任）
    _fly(pts, speed, yawDeg) {
      const v = this.v, legs = [];
      const yaw = yawDeg == null ? null : yawDeg * D2R;
      let a = { x: v.pos.x, y: v.pos.y, z: v.pos.z }, re = false;
      for (const q of pts) {
        const b = { x: q.x, y: q.y, z: q.z };
        const top = this._lineTop(a, b), C = this.cfg.routeClear;
        // 越えるときは上がる・渡る・降りるの 3 本（それぞれホバーで止まってから次。path の点は水平の距離で次へ進むので、真上の点を飛ばして斜めに建物へ入っていた）
        if (top > Math.min(a.y, b.y) - C) { const alt = Math.max(top + C, a.y, b.y); legs.push({ x: a.x, y: alt, z: a.z }, { x: b.x, y: alt, z: b.z }); re = true; this.stats.rerouted = (this.stats.rerouted || 0) + 1; }
        legs.push(b); a = b;
      }
      // 最後に降りる区間は真上で止まってから縦に（斜めに降りると手前で地面に着いて止まる = 第4章で 12 m 手前のスケートリンクの段に降りた）
      const z = legs[legs.length - 1], y0 = legs.length > 1 ? legs[legs.length - 2] : { x: v.pos.x, y: v.pos.y, z: v.pos.z };
      if (Math.hypot(z.x - y0.x, z.z - y0.z) > this.cfg.legReach && y0.y - z.y > this.cfg.descendAbove) {
        legs.splice(legs.length - 1, 0, { x: z.x, y: z.y + this.cfg.descendAbove, z: z.z }); re = true;
      }
      // V2 / V3 の本物の口: 途中の点は followPath（真上・真下の点は wpAlt m に入ってから次 = まっすぐ上がって・渡って・降りる）、
      // 最後の点は hoverAt(p, yaw, { holdYaw })（最後の holdYawDist m は機首の向きを保ったまま寄る）
      this._pathYaw = null;
      const last = legs[legs.length - 1];
      if (legs.length === 1) { v.hoverAt(last, yaw, { holdYaw: yaw !== null }); return; }
      v.followPath(legs.slice(0, -1), speed);
      this._pathYaw = { yaw, p: last };
    }
    _lineTop(a, b) {
      const coll = this.game._heliColl ? this.game._heliColl() : null;
      if (!coll) return -Infinity;
      const C = this.cfg, L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 4));
      const ux = L > 0 ? (b.x - a.x) / L : 0, uz = L > 0 ? (b.z - a.z) / L : 0;
      let m = -Infinity;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if ((1 - t) * L < C.routeEnd) break;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        // 一番上の箱（立てない面も = supportAt は WALK の箱だけで、ロックフェラーの塔 260 m を見ずに 185 m で横切って当たっていた）
        const t2 = coll.maxTop(x, z, C.routeSide);
        if (t2 > m) m = t2;
      }
      return m;
    }
    get arrived() { const S = this.v && this.v.script; return !!(S && S.done && !this._pathYaw); }
    // 傾斜板（V2 の openRamp / rampState / rampTip）。開けられない（空中・動いている…）間は tick が開けられるまで頼み直す
    // 開けるのは飛ぶ仕事が無いとき（行き先が決まっていれば降りてから tick が開ける。先に開けると浮けない = canLiftOff）
    ramp(open) { const v = this.ensure(); this.rampWant = open ? 1 : 0; if (v && (!open || this._idle())) v.openRamp(!!open); }
    _idle() { const v = this.v, S = v && v.script; return !!v && (!S || S.done) && !this._pathYaw; }
    get rampOpen() { return !!(this.v && this.v.rampState === 'open'); }
    rampTip(out) { const v = this.v; if (!v) return null; return v.rampTip(out || new THREE.Vector3()); }
    // 翼の銃で点を sec 秒撃つ（ゲームが撃つ = 本物の弾。プレイヤーの手柄にしない）
    fireAt(p, sec) { const v = this.ensure(); if (v && v.fireGunsAt(p, sec || 2)) this.stats.fired++; }

    // 毎フレーム（storymode.update）: 傾斜板・path の最後の向き
    tick(dt) {
      const v = this.v;
      if (!v || v.disposed || v.wrecked) return;
      if (this.rampWant && v.rampState === 'closed' && !v.driver && this._idle()) v.openRamp(true); // 降りて止まったら開ける（空中では断られる）
      const S = v.script;
      if (this._pathYaw && S && S.mode === 'path' && S.done) { const q = this._pathYaw; this._pathYaw = null; v.hoverAt({ x: q.p.x, y: q.p.y, z: q.p.z }, q.yaw, { holdYaw: q.yaw !== null }); }
    }
    release() { const v = this.v; this._pathYaw = null; if (v && v.clearAutopilot) v.clearAutopilot(); }

    // 地上に止める（自動操縦をやめて、その場に置く）
    park(p, yawDeg) {
      const v = this.ensure(); if (!v) return;
      this.release();
      v.pos.set(p.x, p.y, p.z); v.yaw = (yawDeg || 0) * D2R; v.vel.set(0, 0, 0);
      v.grounded = true; v.airborne = false; v.engineOn = false; v.spool = 0; v.gearPos = 1; v.vel.set(0, 0, 0);
      if (this.rampWant) v.openRamp(true);
      v._updateQuat(); v._animate(0, true); v._apply(); // 開けた傾斜板の姿勢も（止めてある機体は rampPos が動かない間は姿勢を作り直さない）
    }

    dispose() { this.release(); this.v = null; }

    // 機体の球と箱（HeliCollider の建物の段・ランドマーク + 読み込んである nav の箱）のすき間の最小（m。負 = 入っている）。story-check と場面 35 が見る
    static clearance(game, v) {
      const pts = v.hullDef.map(() => new THREE.Vector3());
      v._updateQuat();
      v._hullWorld(pts);
      const boxes = [];
      const coll = game._heliColl ? game._heliColl() : null;
      const R = v.hullR + 4;
      if (coll) coll.query(v.pos.x - R, v.pos.z - R, v.pos.x + R, v.pos.z + R, boxes);
      const nav = game.world && game.world.nav;
      if (nav && nav.itemsIn) { try { for (const it of nav.itemsIn(v.pos.x - R, v.pos.z - R, v.pos.x + R, v.pos.z + R) || []) if (it && it.x0 != null && it.y1 != null) boxes.push(it); } catch (e) { /* 無くてよい */ } }
      let best = Infinity, worst = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], r = v.hullDef[i].r;
        for (const b of boxes) {
          const y0 = b.y0 != null ? b.y0 : 0, y1 = b.y1 != null ? b.y1 : (b.h || 0);
          const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dy = Math.max(y0 - p.y, 0, p.y - y1), dz = Math.max(b.z0 - p.z, 0, p.z - b.z1);
          const d = Math.hypot(dx, dy, dz) - r;
          if (d < best) { best = d; worst = { i, box: b }; }
        }
      }
      return { min: best, worst, boxes: boxes.length };
    }
  }

  MR.StoryActor = StoryActor;
  MR.StoryVtol = StoryVtol;
})();
