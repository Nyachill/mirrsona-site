// 街の船（MR.CityBoats。game.js が街のソロ（フリー・バトルロイヤル）で作る。boats 計画 §3.1 / §4.1 / §5.4）。
//   - ボート（MR.Boat）: マリーナの置き場所（citygen の vehicleSpawns の b_*）を game._updateCityVehicles が出すときの組み立て（makeBoat）、
//     乗る（桟橋・浮き桟橋・水の中から: boats.enterDistance 以内・足の高さと甲板の差 enterRise 以内）、降りる（Boat.findExit: 甲板・浮き桟橋・桟橋 →
//     水）、泳いでいる人を押す・はねる（runover）、ステンシルの板（lid: 運転している船と lidDist 以内）、タッチ端末では止まっている船の影を出さない、
//     視点（V / #btn-camera: 座席 ⇔ 後ろから。mirrsona.boatCam）、#hud.boat（席・視点のボタン）。
//   - 波（MR.Waves）・時計（MR.Platforms.Clock: ソロは起動ごとの乱数 + ゲームの時間）・航跡（MR.Wakes）・しぶき（MR.Spray）。
//   - 船の交通（M2: MR.Shipping + MR.Platforms + MR.ShipsView）は ships が true のとき。
//   - 敵へ: playerWater（ボート・泳ぐ）・waterTarget（一番近い岸・桟橋・浮き桟橋の点。2 Hz）・boatSpeed。
// 毎フレームの順（game.js）: preUpdate(dt)（時計・船）→ 乗り物 → player.update → postPlayer() → 敵（enemyCtx(ctx)）→ update(dt, cam)（見た目）
window.MR = window.MR || {};

(function () {
  const SHOTS = { shots: true };
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  class CityBoats {
    constructor(game, opts) {
      this.game = game;
      // opts.boats false: ボート・船・航跡は出さない（VTOL の機内の足場だけ = opts.vtol）
      this.boatsOn = !(opts && opts.boats === false);
      const C = game.config;
      this.cfg = Object.assign({ enterRise: 2.6, enterDistance: 3.5, boardReach: 3.5, boardRise: 4.6, exitDrop: 1, runoverSpeed: 3, runoverDamage: 8, runoverMax: 80, lidDist: 60, parkedShadowsMobile: false }, C.boats || {});
      this.shipsCfg = C.ships || {};
      const rb = (C.render && C.render.boats) || {};
      const mb = (C.render && C.render.mobile && C.render.mobile.boats) || {};
      this.render = Object.assign({ detailDist: 450, maxDetailShips: 4, shipShadows: false, wakes: true, wakePoints: 1536, spray: true, sprayMax: 128, lid: true, stencilBit: 2 },
        rb, game.input && game.input.isTouchDevice ? mb : {});
      this.mobile = !!(game.input && game.input.isTouchDevice);
      this.city = game.city;
      this.waterY = this.city ? this.city.waterY : -2;
      const data = game.assets && game.assets.get ? game.assets.get('levels/ships.json') : null;
      if (data && MR.Boat) MR.Boat.setData(data);
      this.data = data;
      this.waves = MR.Waves ? new MR.Waves(C.waves || {}) : null;
      const span = num(this.shipsCfg.clockOffsetSpan, 100000);
      this.clock = MR.Platforms ? new MR.Platforms.Clock(Math.floor(Math.random() * span)) : { t: 0, now(dt) { this.t += dt; return this.t; } };
      this.t = this.clock.t;
      if (MR.Boat) { MR.Boat.stencilBit = this.render.stencilBit || 2; MR.Boat.lidEnabled = this.render.lid !== false; }
      const water = game.world && game.world.water;
      if (water && typeof water.setStencilMask === 'function' && this.render.lid !== false) water.setStencilMask(this.render.stencilBit || 2);
      this.wakes = this.boatsOn && this.render.wakes !== false && MR.Wakes ? new MR.Wakes(game.scene, { points: this.render.wakePoints, y: this.waterY, emitDist: num(this.shipsCfg.wakeEmitDist, 600) }) : null;
      this.spray = this.boatsOn && this.render.spray !== false && MR.Spray ? new MR.Spray(game.scene, { max: this.render.sprayMax, y: this.waterY }) : null;
      // 船の交通（M2）: 船団・動く足場・見た目（city.ships と level の shipping）
      this.shipping = null; this.platforms = null; this.shipsView = null;
      const lvl = game.level || {};
      const shipsOn = this.boatsOn && game.cityCfg.ships !== false && this.shipsCfg.enabled !== false && lvl.shipping && data && MR.Shipping && MR.Platforms;
      // 動く足場: 船（ships）と VTOL の機内（opts.vtol = vtol.json の cabin。V2 の 'v' の provider は game.js が足す）
      let icfg = null;
      if (MR.Platforms && (shipsOn || (opts && opts.vtol))) {
        const deckMats = {};
        for (const k in this.shipsCfg.types || {}) if (this.shipsCfg.types[k] && this.shipsCfg.types[k].deckMat) deckMats[k] = this.shipsCfg.types[k].deckMat;
        deckMats['vtol:open'] = deckMats['vtol:moving'] = deckMats['vtol:closed'] = 'metal';
        // 船の中（S2: フェリーの客室。ships.interiors。?shipin=0 で無し。船の交通があるときだけ）
        const qs = (typeof location !== 'undefined' && location.search) || '';
        icfg = shipsOn && this.shipsCfg.interiors && this.shipsCfg.interiors.enabled !== false && !/[?&]shipin=0/.test(qs) && !(MR.CONFIG && MR.CONFIG.SHIP_INTERIORS === false) ? this.shipsCfg.interiors : null;
        this.platforms = new MR.Platforms({ nearRange: num(this.shipsCfg.nearRange, 6), deckMats, interiors: icfg });
      }
      if (shipsOn) {
        this.shipping = new MR.Shipping(lvl.shipping, this.shipsCfg, data, { waterY: this.waterY, waves: this.waves });
        this.platforms.addProvider(this.shipping);
        if (MR.ShipsView) this.shipsView = new MR.ShipsView(game.scene, { assets: game.assets, shipping: this.shipping, render: this.render, data, interiors: icfg, materials: game.world && game.world.materials });
        if (icfg && game.world) { const pl = this.platforms; game.world.shipRoomTest = (c) => pl.roomAt(c.x, c.y, c.z); }
        this.shipping.update(this.t);
      }
      // 動く甲板（M3）: player.update に渡す nav（近くの船を最大 2 つ重ねる）と、乗っている船（ride）
      this.pnav = this.platforms && MR.PlatformNav ? new MR.PlatformNav(game.world.nav, this.platforms) : null;
      this._pw = { nav: this.pnav };
      this._nearBuf = new Array(8);
      this.ride = null; // { e, ref: { x, y, z, yaw }（最後に合わせた船の姿勢）, wx, wy, wz（その時のプレイヤーの位置）, off（離れている秒）}
      this._pnavOn = false;
      this._shipAudio = new Map(); // entry → audio.boat ハンドル
      this._shipAudioT = 0;
      this._shipWakeT = 0;
      this._lastCrush = -10;
      this.chase = Game_loadPref('boatCam') === 'chase';
      this.boats = [];
      this.stats = { made: 0, runovers: 0, runoverDamage: 0, pushes: 0, enters: 0, exits: 0, exitDeck: 0, exitWater: 0, lids: 0, shipPushes: 0, crushes: 0, crushDamage: 0, horns: 0, shotsStopped: 0 };
      this._waterT = 0;
      this.waterTarget = null;
      this._tv = new THREE.Vector3();
      this._lastRun = -10;
    }

    // ---------- ボートを作る（game._makeCityVehicle の boat の枝）----------
    makeBoat(spec, state, def) {
      const g = this.game, vcfg = g.config.vehicles || {};
      const nav = g.world.nav;
      const yaw0 = THREE.MathUtils.degToRad(spec.yaw || 0);
      const spot = MR.Boat.findSpawnWater(nav, this.city, def, spec.x, spec.z, yaw0);
      const st = state || null;
      const v = new MR.Boat(g.scene, def, {
        x: st ? st.x : spot.x, y: this.waterY, z: st ? st.z : spot.z, yaw: st ? st.yaw : yaw0,
        assets: g.assets, audio: g.audio, fx: g.fx, common: vcfg, boats: this.cfg, city: this.city, waterY: this.waterY, health: st ? st.health : undefined
      });
      v.spawnPos.set(spot.x, this.waterY, spot.z);
      v.spawnYaw = yaw0;
      if (st) v.cityTouched = true;
      v.cityId = spec.id;
      v.citySpec = spec;
      v.netIndex = -1;
      if (this.mobile && !this.cfg.parkedShadowsMobile) v.setShadows(false);
      g.vehicles.push(v);
      (g._cityVehById || (g._cityVehById = new Map())).set(spec.id, v);
      this.stats.made++;
      return v;
    }

    // ---------- 毎フレーム ----------
    // 乗り物を動かす前: 時計・船の位置・ctx に波を入れる
    preUpdate(dt) {
      this.t = this.clock.now(dt);
      this._weatherWaves(dt);
      const ctx = this.game._vehicleCtx();
      ctx.waves = this.waves; ctx.waveTime = this.t; ctx.wakes = this.wakes; ctx.spray = this.spray; ctx.city = this.city;
      ctx.platforms = this.platforms;
      if (this.shipping) {
        const ev = this.shipping.update(this.t);
        for (const e of ev) if (e.t === 'depart') this._horn(e.e);
        this._carry();
        this._carryVehicles();
        // 船が動いて人に入った分はここで押し出す（player.update の nav は船の箱も見るので、後では重なりが残らない）
        const g = this.game, p = g.player;
        if (!this.ride && p && !p.dead && !g.vehicle) this._shipPush(dt);
      }
      if (this.wakes && this.game.camera) this.wakes.setCamera(this.game.camera.getWorldPosition(this._tv));
    }

    // ---------- 動く甲板に乗る（M3。計画 §3.5.4）----------
    // 乗っている間は船の座標の位置が本当（ref = 前に合わせた船の姿勢 → 今の姿勢で動かす）。速度は船に対する速さ。
    // 空中でも船の囲みの上にいる間は運ぶ（空中の操作 airControl が世界の速さを戻してしまうので、跳んでも同じ所に降りる）。
    // 離れたら（囲みの外・世界の床・水）その点の船の速さを足す。
    _map(R, x, y, z, out) {
      const r = R.ref, c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = x - r.x, dz = z - r.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return this.platforms.toWorld(R.e, lx, y - r.y, lz, out);
    }
    _carry() {
      const R = this.ride;
      if (!R) return;
      const g = this.game, p = g.player;
      // 外から置き直された（placePlayer・復活・テスト）・乗り物・死んだ: 速さを足さずに外す
      if (g.vehicle || p.dead || Math.abs(p.pos.x - R.wx) > 0.5 || Math.abs(p.pos.z - R.wz) > 0.5 || Math.abs(p.pos.y - R.wy) > 0.5) { this.clearRide(); return; }
      const e = R.e, w = this._map(R, p.pos.x, p.pos.y, p.pos.z, this._cw || (this._cw = {}));
      const dy = w.y - p.pos.y;
      p.pos.x = w.x; p.pos.y = w.y; p.pos.z = w.z;
      p.peakY += dy;
      let da = e.pose.yaw - R.ref.yaw;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const lim = num(this.shipsCfg.carryMaxDyaw, 0.2);
      p.yawAngle += clamp(da, -lim, lim);
      const v = p._vault;
      if (v) {
        const a = this._map(R, v.x0, v.y0, v.z0, this._cw2 || (this._cw2 = {}));
        v.x0 = a.x; v.y0 = a.y; v.z0 = a.z;
        const b = this._map(R, v.x1, v.y1, v.z1, a);
        v.x1 = b.x; v.y1 = b.y; v.z1 = b.z;
      }
      this._setRef(R);
      p._apply();
      this.stats.carried = (this.stats.carried || 0) + 1;
    }
    // 船の甲板に降りているヘリを運ぶ（計画 §5.3.8）。遠い（carriedHideDist）ものは隠す
    _carryVehicles() {
      const g = this.game, cam = g.player && g.player.pos;
      for (const v of g.vehicles) {
        const R = v._ride;
        if (!R) continue;
        const ps = R.e.pose, r = R.ref, c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = v.pos.x - r.x, dz = v.pos.z - r.z;
        const w = this.platforms.toWorld(R.e, dx * c - dz * s, v.pos.y - r.y, dx * s + dz * c, this._cv || (this._cv = {}));
        v.pos.x = w.x; v.pos.y = w.y; v.pos.z = w.z;
        let da = ps.yaw - r.yaw;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        v.yaw += da;
        r.x = ps.x; r.y = ps.y; r.z = ps.z; r.yaw = ps.yaw;
        if (v.root && cam) {
          const far = Math.hypot(v.pos.x - cam.x, v.pos.z - cam.z) > num(this.shipsCfg.carriedHideDist, 900) && v !== g.vehicle;
          v.root.visible = !far;
        }
        if (typeof v._apply === 'function') v._apply();
      }
    }
    // 乗り物の更新の後: 船の甲板に降りた / 離れたヘリ
    _vehicleRides() {
      const g = this.game, P = this.platforms;
      let n = 0;
      for (const v of g.vehicles) {
        if (v.kind !== 'heli') continue;
        const R = v._ride;
        // 甲板の上で壊れた残骸も運ぶ（落ちずに甲板に残る。respawn で landedOn が消える）
        const on = v.grounded && !v.sinking && !v.disposed && v.landedOn && v.landedOn.pose && (!v.wrecked || R);
        if (on) {
          if (!R || R.e !== v.landedOn) {
            v._ride = { e: v.landedOn, ref: { x: 0, y: 0, z: 0, yaw: 0 } };
            v.platform = v.landedOn.id;
            this.stats.vehAttaches = (this.stats.vehAttaches || 0) + 1;
          }
          const r = v._ride.ref, ps = v._ride.e.pose;
          r.x = ps.x; r.y = ps.y; r.z = ps.z; r.yaw = ps.yaw;
          n++;
        } else if (R) {
          if (!v.grounded && !v.wrecked) { const pv = P.pointVel(R.e, v.pos.x, v.pos.z, this._pv3 || (this._pv3 = {})); v.vel.x += pv.x; v.vel.z += pv.z; }
          v._ride = null; v.platform = null; v.landedOn = null;
          if (v.root) v.root.visible = true;
          this.stats.vehDetaches = (this.stats.vehDetaches || 0) + 1;
        }
      }
      // 上限（ships.maxCarriedVehicles）を超えたら古いものを元の場所へ
      const max = num(this.shipsCfg.maxCarriedVehicles, 3);
      if (n > max) {
        for (const v of g.vehicles) {
          if (n <= max) break;
          if (!v._ride || v === g.vehicle || v.driver) continue;
          v._ride = null; v.platform = null; v.landedOn = null;
          if (v.root) v.root.visible = true;
          if (typeof v.respawn === 'function') v.respawn();
          n--;
        }
      }
    }
    _setRef(R) {
      const r = R.ref, ps = R.e.pose, p = this.game.player.pos;
      r.x = ps.x; r.y = ps.y; r.z = ps.z; r.yaw = ps.yaw;
      R.wx = p.x; R.wy = p.y; R.wz = p.z;
    }
    // 船の囲みの上（ローカルの x / z が bbox + m の中、足が船底より上）
    _overShip(e, pos, m) {
      const l = this.platforms.toLocal(e, pos.x, pos.y, pos.z, this._ol || (this._ol = {})), b = e.data.bbox;
      return l.x > b[0][0] - m && l.x < b[1][0] + m && l.z > b[0][2] - m && l.z < b[1][2] + m && l.y > 0.3 && l.y < b[1][1] + 8;
    }
    // player.update の前: 渡す nav（近くに船が無ければ世界の nav のまま）
    playerWorld() {
      const g = this.game;
      this._pnavOn = false;
      if (!this.pnav || !this.platforms || g.vehicle) return g.world;
      const p = g.player, buf = this._nearBuf;
      let n = this.platforms.near(p.pos.x, p.pos.y, p.pos.z, num(this.shipsCfg.nearRange, 6), buf);
      if (this.ride) {
        // 乗っている船を先に
        const i = buf.indexOf(this.ride.e);
        if (i < 0 || i >= n) { for (let k = Math.min(n, buf.length - 1); k > 0; k--) buf[k] = buf[k - 1]; buf[0] = this.ride.e; n = Math.min(n + 1, buf.length); }
        else if (i > 0) { const t = buf[0]; buf[0] = buf[i]; buf[i] = t; }
      }
      if (!n) return g.world;
      if (n > 1 && !this.ride) {
        // 近い順に 2 つ
        const px = p.pos.x, pz = p.pos.z, d = (e) => (e.pose.x - px) * (e.pose.x - px) + (e.pose.z - pz) * (e.pose.z - pz) - e.radius * e.radius;
        for (let a = 1; a < n; a++) { const t = buf[a]; let b = a - 1; while (b >= 0 && d(buf[b]) > d(t)) { buf[b + 1] = buf[b]; b--; } buf[b + 1] = t; }
      }
      this.pnav.world = g.world.nav;
      this.pnav.setActive(buf, Math.min(n, num(this.shipsCfg.maxNear, 2)));
      this._pnavOn = true;
      return this._pw;
    }
    // 足音・材質を見る nav
    surfaceNav() { return this._pnavOn && this.platforms ? this.pnav : this.game.world.nav; }
    // player.update の後: 乗る・降りる（速さの換算）
    _rideUpdate(dt) {
      const g = this.game, p = g.player, P = this.platforms;
      if (!P || !this.pnav) return;
      if (g.vehicle || p.dead) { this.clearRide(); return; }
      let e = null;
      if (this._pnavOn) {
        if (p.state === 'walk' && p.grounded) {
          const gi = this.pnav.groundInfo(p.pos.x, p.pos.z, p.pos.y + 0.05, p.radius * 0.5);
          if (gi.entry && Math.abs(gi.y - p.pos.y) < 0.12) e = gi.entry;
        } else if (p.state === 'vault' && p._vault) {
          // 行き先は始めたときに 1 回だけ決める（船の甲板 → 運ぶ、桟橋・陸 → 外す: 行き先の点を船と一緒に動かさない）
          const v = p._vault;
          if (v._pf === undefined) {
            const gi = this.pnav.groundInfo(v.x1, v.z1, v.y1 + 0.05, p.radius * 0.5);
            v._pf = gi.entry && Math.abs(gi.y - v.y1) < 0.15 ? gi.entry : (v.kind === 'over' && this.ride ? this.ride.e : null);
          }
          e = v._pf;
        }
        if (!e && this.ride && p.state !== 'swim' && !(p.state === 'walk' && p.grounded) && this._overShip(this.ride.e, p.pos, num(this.shipsCfg.attachMargin, 0.6))) e = this.ride.e;
      }
      const R = this.ride;
      if (R && R.e !== e) {
        if (e === null && p.state === 'walk' && p.grounded && R.off + dt < num(this.shipsCfg.detachDelay, 0.2) && this._pnavOn) {
          // 継ぎ目で一瞬だけ船の面でない（甲板の端・段）: detachDelay まで待つ
          const gi = this.pnav.groundInfo(p.pos.x, p.pos.z, p.pos.y + 0.05, p.radius * 0.5);
          if (gi.entry === R.e && this._overShip(R.e, p.pos, 0)) { R.off += dt; this._setRef(R); return; }
        }
        // 離れる: その点の船の速さを足す（世界の速さに戻す）
        const pv = P.pointVel(R.e, p.pos.x, p.pos.z, this._pv2 || (this._pv2 = {}));
        p.vel.x += pv.x; p.vel.z += pv.z;
        this.stats.detaches = (this.stats.detaches || 0) + 1;
        this.lastDetach = { id: R.e.id, vx: pv.x, vz: pv.z, pvx: p.vel.x, pvz: p.vel.z, state: p.state, t: g.time };
        this.ride = null; p.platform = null;
      }
      if (e && !this.ride) {
        // 乗る: 空中から降りた・よじ登り → 速さを船に対する速さへ
        if (!(p.state === 'walk' && p.grounded)) {
          const pv = P.pointVel(e, p.pos.x, p.pos.z, this._pv2 || (this._pv2 = {}));
          p.vel.x -= pv.x; p.vel.z -= pv.z;
        }
        this.ride = { e, ref: { x: 0, y: 0, z: 0, yaw: 0 }, wx: 0, wy: 0, wz: 0, off: 0 };
        p.platform = e.id;
        this.stats.attaches = (this.stats.attaches || 0) + 1;
      }
      if (this.ride) { this.ride.off = 0; this._setRef(this.ride); }
    }
    // 外す（置き直し・乗り物・死亡）: 速さは足さない
    clearRide() {
      if (this.ride) this.stats.clears = (this.stats.clears || 0) + 1;
      this.ride = null;
      if (this.game.player) this.game.player.platform = null;
    }
    // ローカルの位置（テスト・オンラインの lp）
    rideLocal(out) {
      const R = this.ride;
      if (!R) return null;
      const p = this.game.player.pos;
      return this.platforms.toLocal(R.e, p.x, p.y, p.z, out || {});
    }

    // 天気の風で波の大きさ（M4。game.weather = MR.Weather があるときだけ。p.wind m/s → waves.weather の minScale〜maxScale、rate /s で寄せる）
    _weatherWaves(dt) {
      const W = this.waves, wp = this.game.weather && this.game.weather.p;
      if (!W || !wp || !isFinite(wp.wind)) return;
      const c = (this.game.config.waves || {}).weather || {};
      const lo = num(c.minScale, 0.45), hi = num(c.maxScale, 1), ref = num(c.windRef, 12);
      const goal = lo + (hi - lo) * clamp(wp.wind / ref, 0, 1);
      W.scale += (goal - W.scale) * Math.min(1, dt * num(c.rate, 0.2));
    }
    // 爆発（乗り物の爆発・これからの爆発物）: R m の中のボートに D（中心で全部、端で 1 − edge 倍）。sinking / 壊れたものは除く
    blast(p, R, D, except) {
      const g = this.game, ctx = g._vehicleCtx(), edge = num(this.cfg.blastEdge, 0.6);
      let n = 0;
      for (const v of g.vehicles) {
        if (v.kind !== 'boat' || v === except || v.wrecked || v.sinking || v.sunk) continue;
        const c = v.center ? v.center(this._tv) : v.pos;
        const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
        if (d > R) continue;
        v.damage(D * num(this.cfg.blastScale, 1) * (1 - d / R * edge), ctx);
        n++;
      }
      this.stats.blasts = (this.stats.blasts || 0) + n;
      return n;
    }

    // 乗れる船か（徒歩・泳いでいる）: 距離と甲板の高さ
    canEnter(v, player) {
      if (v.kind !== 'boat') return false;
      if (v.wrecked || v.sinking) return false;
      if (player.state !== 'walk' && player.state !== 'swim') return false;
      const deck = v.pos.y + v.td.deckY;
      return Math.abs(player.pos.y - deck) < this.cfg.enterRise;
    }
    enterDistance() { return this.cfg.enterDistance; }

    // 乗った（game._enterVehicle の後）
    onEnter(v) {
      this.stats.enters++;
      v.localInside = true;
      v.asleep = false;
      v.setShadows(true);
      if (this.game.audio && typeof this.game.audio.prepareBoat === 'function') this.game.audio.prepareBoat();
      const p = this.game.player;
      p.state = 'walk'; p._vault = null; p.ladder = null; // 水の中から乗った: 座席では撃てる
      this.game.player.yawAngle = v.yaw + Math.PI;
      this.game.player.pitchAngle = -0.05;
    }

    // 降りる（game._exitVehicle の boat の枝）
    exitBoat(v) {
      const g = this.game, player = g.player;
      const seat = Math.max(0, v.seatOf(player));
      const e = v.findExit(seat, g.world.nav, player.radius, this.platforms || null);
      const yaw = player.yawAngle;
      g.vehicle = null; g.vehicleSeat = 0;
      v.localInside = false;
      v.listenerPos = null;
      if (this.mobile && !this.cfg.parkedShadowsMobile) v.setShadows(false);
      if (g.camera) g.camera.rotation.z = 0;
      if (e.entry) {
        // 動く船の甲板（乗り移る）: 世界の nav には床が無いので直接置く。次の postPlayer で乗る
        this.standOnDeck(e, yaw);
        this.stats.exitShip = (this.stats.exitShip || 0) + 1;
      } else g.placePlayer(e.x, e.z, e.y == null ? this.waterY + 0.2 : e.y + 0.3, THREE.MathUtils.radToDeg(yaw));
      if (e.y == null) this.stats.exitWater++; // 水: placePlayer が泳ぐ形にする
      else this.stats.exitDeck++;
      v.exit(player);
      if (g.headlight && v.detachHeadlight()) { g.scene.add(g.headlight); g.scene.add(g.headlight.target); }
      if (g.hud.setVehicle) g.hud.setVehicle(null);
      this.stats.exits++;
      return e;
    }

    // 船の甲板に降りているヘリから降りる（game._exitHeli の低い枝）: 世界の nav には甲板が無いので、座席の出口・機体の周りで甲板の上の
    // カプセルが入る所に直接置く。見つからなければ null（今まで通り world の出口）
    heliDeckExit(v, seat) {
      const P = this.platforms, g = this.game, p = g.player;
      if (!P || !v.platform || !v._ride) return null;
      const e = v._ride.e, tmp = this._hx || (this._hx = new THREE.Vector3());
      const cands = [];
      for (let k = 0; k < v.seatCount; k++) { const q = v.exitWorld((seat + k) % v.seatCount, tmp); cands.push([q.x, q.z]); }
      for (const r of [3, 4.5, 6]) for (let k = 0; k < 12; k++) { const a = v.yaw + k * Math.PI / 6; cands.push([v.pos.x + Math.sin(a) * r, v.pos.z + Math.cos(a) * r]); }
      const ln = P.localNav(e.typeId), l = this._hl || (this._hl = {}), sup = this._hs || (this._hs = {});
      for (const c of cands) {
        const s = P.supportAt(c[0], c[1], v.pos.y + 1.2, 0.45, sup, p.radius * 0.5);
        if (!s || s.entry !== e || Math.abs(s.y - v.pos.y) > 1.5) continue;
        P.toLocal(e, c[0], s.y, c[1], l);
        const q = ln.resolveCapsule({ x: l.x, y: l.y, z: l.z }, p.radius, 1.8, 0.45, { snapDown: 0.1 });
        if (Math.hypot(q.x - l.x, q.z - l.z) > 0.15 || !q.grounded) continue;
        // ヘリの機体の円の外
        if (Math.hypot(c[0] - v.pos.x, c[1] - v.pos.z) < 2.2) continue;
        return { x: c[0], y: s.y, z: c[1], entry: e };
      }
      return null;
    }
    // 甲板の点に立たせる（次の postPlayer で乗る）
    standOnDeck(d, yawRad) {
      const g = this.game, player = g.player;
      g.placePlayer(d.x, d.z, d.y + 0.3, THREE.MathUtils.radToDeg(yawRad == null ? player.yawAngle : yawRad));
      player.pos.set(d.x, d.y, d.z); player.state = 'walk'; player.grounded = true; player.vy = 0; player.peakY = d.y;
      player.vel.x = 0; player.vel.z = 0;
      player._apply();
    }

    // 降りるボタンの文字: 降りる先が動く船の甲板なら「乗り移る」（4 回/秒、近くに船があるときだけ）
    exitLabel(v) {
      if (!this.platforms) return null;
      const g = this.game;
      if (g.time - (this._xlT || -1) < 0.25 && this._xlV === v) return this._xl;
      this._xlT = g.time; this._xlV = v; this._xl = null;
      if (!this.platforms.near(v.pos.x, v.pos.y, v.pos.z, 12, this._nearBuf)) return null;
      const e = v.findExit(Math.max(0, v.seatOf(g.player)), g.world.nav, g.player.radius, this.platforms);
      if (e && e.entry) this._xl = '乗り移る';
      return this._xl;
    }

    // 運転中の視点（game._updateDriving の後）: 座席（船の傾きを少し）⇔ 後ろから
    updateView(dt, v) {
      const g = this.game, P = g.player, cam = g.camera, d = v.def;
      v.localInside = true;
      if (this.chase) {
        cam.rotation.z = 0;
        // 見回し（右側のスワイプ = 座席の向きのずれが変わった）をやめて chaseRecenterDelay 秒たったら後ろへ寄せる
        const C = this.cfg, rel = P.yawAngle - v.yaw;
        const lk = g.input && g.input.peekLook ? g.input.peekLook() : null, thr = num(C.chaseLookEps, 0.0005);
        if (this._relPrev == null || Math.abs(wrapA(rel - this._relPrev)) > thr || Math.abs(P.pitchAngle - (this._pitPrev || 0)) > thr ||
          (lk && (lk.x || lk.y)) || (g.input && g.input.fireHeld)) this._swipeT = g.time; // 見回し・撃っている間は戻さない
        if (g.time - (this._swipeT || 0) > num(C.chaseRecenterDelay, 1.5) && Math.abs(v.speed) > num(C.chaseRecenterSpeed, 1.5)) {
          const k = Math.min(1, dt * num(C.chaseRecenterRate, 1.5));
          P.yawAngle -= wrapA(P.yawAngle - (v.yaw + Math.PI)) * k;
          P.pitchAngle += (num(C.chasePitch, -0.12) - P.pitchAngle) * k;
          P.yaw.rotation.y = P.yawAngle; P.pitch.rotation.x = P.pitchAngle + P.recoilPitch;
        }
        this._relPrev = P.yawAngle - v.yaw; this._pitPrev = P.pitchAngle;
        const pivot = v.toWorld(this._pivL || (this._pivL = new THREE.Vector3(0, 1.6, 0)), this._tv);
        const D = num(d.chaseDistance, 9) + v.speedRatio * 3, H = num(d.chaseHeight, 3.2);
        P.yaw.position.copy(pivot);
        cam.position.set(0, H, D);
        P.yaw.updateMatrixWorld(true);
        const cw = cam.getWorldPosition(this._cw || (this._cw = new THREE.Vector3()));
        const dx = cw.x - pivot.x, dy = cw.y - pivot.y, dz = cw.z - pivot.z, len = Math.hypot(dx, dy, dz) || 1;
        let t = len;
        const h = g.world.nav.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len, { water: true });
        if (h && h.t < t) t = h.t;
        if (this.platforms) { const h2 = this.platforms.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, t, this._crc || (this._crc = {})); if (h2 && h2.t < t) t = h2.t; }
        // 水面より下へ行かない
        if (dy < 0) { const tw = (this.waterY + 0.6 - pivot.y) / (dy / len); if (tw > 0 && tw < t) t = tw; }
        const want = Math.max(0.2, Math.min(1, (t - 0.5) / len));
        if (this._chaseK == null || want < this._chaseK) this._chaseK = want;
        else this._chaseK += (want - this._chaseK) * Math.min(1, dt * 2.5);
        cam.position.set(P.shakeOffset.x, H * this._chaseK + P.shakeOffset.y, D * this._chaseK);
      } else {
        const rel = P.yawAngle - (v.yaw + Math.PI);
        const k = num(d.cameraRoll, 0.35);
        cam.rotation.z = -(v.roll * Math.cos(rel) + v.pitch * Math.sin(rel)) * k;
      }
      v.listenerPos = cam.getWorldPosition(this._ear || (this._ear = new THREE.Vector3()));
    }
    toggleCamera() {
      this.chase = !this.chase;
      this._chaseK = null;
      Game_savePref('boatCam', this.chase ? 'chase' : 'seat');
    }

    // 出発の汽笛（hornRange m の中だけ）
    _horn(e) {
      const g = this.game, T = (this.shipsCfg.types || {})[e.typeId] || {};
      if (!T.horn || !g.audio || typeof g.audio.play !== 'function') return;
      const cam = g.camera ? g.camera.getWorldPosition(this._tv) : null;
      if (cam && Math.hypot(cam.x - e.pose.x, cam.z - e.pose.z) > num(this.shipsCfg.hornRange, 900)) return;
      const hp = e.data.empties && e.data.empties.horn;
      const w = this.platforms.toWorld(e, hp ? hp[0] : 0, hp ? hp[1] : 6, hp ? hp[2] : 0, this._hw || (this._hw = {}));
      g.audio.play(T.horn, { volume: 1, pos: new THREE.Vector3(w.x, w.y, w.z), refDistance: 30, maxDistance: num(this.shipsCfg.hornRange, 900) });
      this.stats.horns++;
    }

    // 戦闘機の機銃・ミサイルのレイ（game._jetRay）: 船体・船室に当たる t（無ければ null）
    shipRayT(o, d, maxT) {
      if (!this.platforms) return null;
      const h = this.platforms.raycast(o.x, o.y, o.z, d.x, d.y, d.z, maxT, this._jr || (this._jr = {}), SHOTS);
      return h ? h : null;
    }
    // 弾が船体・船室で止まる（game._resolveShots）: nav の当たり wall より近ければ船の当たりを wall の形で返す
    clipRay(origin, dir, wall, range) {
      if (!this.platforms) return wall;
      const h = this.platforms.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, wall ? wall.t : range, this._shot || (this._shot = {}), SHOTS);
      if (!h) return wall;
      this.stats.shotsStopped++;
      return { t: h.t, dist: h.t, x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, box: h.box || { mat: 'metal' } };
    }

    // player.update の後: 船の箱から押し出す（泳ぐ・歩く・梯子・よじ登り。M2）。速ければ crush のダメージ
    _shipPush(dt) {
      const g = this.game, p = g.player, P = this.platforms;
      if (!P || g.vehicle || p.dead) return;
      const r = P.pushCapsule(p.pos, p.radius, 1.8, this._pcap || (this._pcap = {}));
      if (!r.pushed) return;
      this.stats.shipPushes++;
      const bx = p.pos.x, bz = p.pos.z;
      p.pos.x = r.x; p.pos.z = r.z;
      // 船首に押されて泳いでいる人は横へ滑って船の脇へ抜ける（前の面だけで押すと船首の前を運ばれ続ける）
      const e = r.entry, sp = e ? Math.hypot(e.vel.x, e.vel.z) : 0;
      if (p.state === 'swim' && sp > 1) {
        const nx0 = r.x - bx, nz0 = r.z - bz, L0 = Math.hypot(nx0, nz0);
        if (L0 > 1e-6 && (nx0 * e.vel.x + nz0 * e.vel.z) / (L0 * sp) > num(this.shipsCfg.swimSlideDot, 0.6)) {
          const l = P.toLocal(e, p.pos.x, p.pos.y, p.pos.z, this._sl || (this._sl = {}));
          const side = l.x >= 0 ? 1 : -1, d = P.dirToWorld(e, side, 0, this._sd || (this._sd = {}));
          const k = num(this.shipsCfg.swimSlide, 3) * (dt || 1 / 60);
          p.pos.x += d.x * k; p.pos.z += d.z * k;
          this.stats.swimSlides = (this.stats.swimSlides || 0) + 1;
        }
      }
      const q = g.world.nav.resolveCapsule(p.pos, p.radius, 1.8, 0.1, { snapDown: 0 });
      p.pos.x = q.x; p.pos.z = q.z;
      if (p.state === 'vault' || p.state === 'ladder') { p.state = p.state === 'vault' && p._vault && p._vault.kind === 'water' ? 'swim' : 'walk'; p._vault = null; p.ladder = null; }
      p._apply();
      const pv = P.pointVel(r.entry, p.pos.x, p.pos.z, this._pv || (this._pv = {}));
      const nx = r.x - bx, nz = r.z - bz, L = Math.hypot(nx, nz) || 1;
      const rel = (pv.x * nx + pv.z * nz) / L - ((p.vel ? p.vel.x * nx + p.vel.z * nz : 0) / L);
      if (rel > num(this.shipsCfg.pushDamageSpeed, 4) && g.time - this._lastCrush > 0.5) {
        this._lastCrush = g.time;
        const dmg = num(this.shipsCfg.pushDamage, 6) * (rel - num(this.shipsCfg.pushDamageSpeed, 4) + 1);
        this.stats.crushes++; this.stats.crushDamage += dmg;
        g._playerHit(dmg, { kind: 'crush' });
      }
    }

    // player.update の後: 泳いでいる人（とよじ登りの途中）を船体から押し出し、速ければはねる
    postPlayer(dt) {
      const g = this.game, p = g.player;
      if (p.dead || g.vehicle) { this.clearRide(); return; }
      this._rideUpdate(dt || 1 / 60);
      if (!this.ride) this._shipPush(dt);
      const water = p.state === 'swim' || (p.state === 'vault' && p._vault && p._vault.kind === 'water');
      if (!water) return;
      for (const v of g.vehicles) {
        if (v.kind !== 'boat' || v.sunk || v.wrecked) continue;
        if (Math.abs(v.pos.x - p.pos.x) > 20 || Math.abs(v.pos.z - p.pos.z) > 20) continue;
        if (p.pos.y > v.pos.y + v.td.lid.y + 0.3) continue;
        const bx = p.pos.x, bz = p.pos.z;
        const pen = v.pushOutCircle(p.pos, p.radius);
        if (pen <= 0) continue;
        this.stats.pushes++;
        // 相手の速さ（船の速さの押した向きの成分）
        const nx = p.pos.x - bx, nz = p.pos.z - bz, L = Math.hypot(nx, nz) || 1;
        const rel = Math.abs((v.vel.x * nx + v.vel.z * nz) / L);
        const sp = Math.max(rel, Math.hypot(v.vel.x, v.vel.z) * 0.8);
        if (p.state === 'vault') { p.state = 'swim'; p._vault = null; }
        const r = g.world.nav.resolveCapsule(p.pos, p.radius, 1.8, 0.1, { snapDown: 0 });
        p.pos.x = r.x; p.pos.z = r.z;
        p._apply();
        if (sp > this.cfg.runoverSpeed && g.time - this._lastRun > 0.6) {
          this._lastRun = g.time;
          const dmg = Math.min(this.cfg.runoverMax, this.cfg.runoverDamage * (sp - this.cfg.runoverSpeed));
          this.stats.runovers++; this.stats.runoverDamage += dmg;
          if (g.audio && typeof g.audio.play === 'function') g.audio.play('wake_splash', { volume: 0.8, pos: p.pos });
          if (g.fx && g.fx.splash) g.fx.splash(this._tv.set(p.pos.x, this.waterY + 0.05, p.pos.z), 1.6, 'wake');
          g._playerHit(dmg, { kind: 'runover' });
        }
      }
    }

    // 敵の ctx: 水の上のプレイヤー（ボート・泳ぐ）なら一番近い岸の点を追う
    enemyCtx(ctx, dt) {
      const g = this.game, p = g.player, v = g.vehicle;
      const onBoat = !!(v && v.kind === 'boat');
      const water = onBoat || p.state === 'swim' || !!this.ride; // 動く船の甲板も（陸の敵は岸の点を追う）
      ctx.playerWater = water;
      ctx.boatSpeed = onBoat ? Math.abs(v.speed) : 0;
      ctx.platforms = this.platforms || null;
      if (!water) { this.waterTarget = null; ctx.waterTarget = null; return; }
      this._waterT -= dt;
      if (this._waterT <= 0 || !this.waterTarget) { this._waterT = 0.5; this.waterTarget = this._nearestShore(p.pos.x, p.pos.z); }
      ctx.waterTarget = this.waterTarget;
    }
    // 一番近い歩ける点（読み込んだ当たり判定の岸・桟橋・浮き桟橋）。16 方向 × 距離
    _nearestShore(x, z) {
      const nav = this.game.world.nav, city = this.city;
      let best = null, bd = Infinity;
      for (let r = 6; r <= 150; r += r < 30 ? 6 : 15) {
        for (let k = 0; k < 16; k++) {
          const a = k * Math.PI / 8, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
          const gy = nav.groundHeight(px, pz, 2, 0.3);
          if (gy === null || gy < this.waterY + 0.3) continue;
          const d = r;
          if (d < bd) { bd = d; best = { x: px, y: gy, z: pz }; }
        }
        if (best) break;
      }
      return best;
    }

    // 描画の前（見た目）: 航跡・しぶき・ステンシルの板・#hud.boat
    update(dt) {
      const g = this.game;
      if (this.shipsView) this.shipsView.update(dt, g.camera ? g.camera.getWorldPosition(this._camW || (this._camW = new THREE.Vector3())) : null);
      if (this.shipping) { this._shipsFx(dt); this._vehicleRides(); }
      if (this.wakes) this.wakes.update(dt);
      if (this.spray) this.spray.update(dt);
      const cam = g.camera ? g.camera.getWorldPosition(this._tv) : null;
      const L = this.cfg.lidDist;
      let lids = 0;
      for (const v of g.vehicles) {
        if (v.kind !== 'boat') continue;
        const on = v === g.vehicle || (cam && Math.abs(v.pos.x - cam.x) < L && Math.abs(v.pos.z - cam.z) < L && lids < 3);
        if (on) lids++;
        if (on !== v.lidOn) v.setLid(on);
      }
      this.stats.lids = lids;
      const bv = g.vehicle && g.vehicle.kind === 'boat' ? g.vehicle : null;
      if (g.hud && g.hud.root && g.hud.root.classList) {
        const key = bv ? 'b' + (this.chase ? 'c' : '') + (this.canSwitch(bv) ? 's' : '') : '';
        if (key !== this._hudKey) {
          this._hudKey = key;
          const rc = g.hud.root.classList;
          rc.toggle('boat', !!bv);
          rc.toggle('chase', !!(bv && this.chase));
          if (g.hud.seatBtn) g.hud.seatBtn.classList.toggle('hidden', !(bv && this.canSwitch(bv)));
        }
      }
    }
    // 船の航跡（wakeEmitDist m の中・近い順に wakeMaxEmitters 隻）とエンジン音（audioRange m の中の近い audioMax 隻。4 Hz で選び直す）
    _shipsFx(dt) {
      const g = this.game, S = this.shipping, cfg = this.shipsCfg, types = cfg.types || {};
      const cam = g.camera ? g.camera.getWorldPosition(this._tv2 || (this._tv2 = new THREE.Vector3())) : null;
      if (!cam) return;
      this._shipWakeT -= dt;
      if (this.wakes && this._shipWakeT <= 0) {
        this._shipWakeT = 0.25;
        const R = num(cfg.wakeEmitDist, 600);
        let n = 0;
        const list = this._wl || (this._wl = []);
        list.length = 0;
        for (const e of S.list) { const d = Math.hypot(e.pose.x - cam.x, e.pose.z - cam.z); if (d < R && e.speed > 0.6 && num((types[e.typeId] || {}).wake, 0) > 0) list.push([d, e]); }
        list.sort((a, b) => a[0] - b[0]);
        for (const [, e] of list) {
          if (n++ >= num(cfg.wakeMaxEmitters, 6)) break;
          const b = e.data.bbox, T = types[e.typeId] || {};
          const w = this.platforms.toWorld(e, 0, 0, b[0][2] + 1, this._ww || (this._ww = {}));
          const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
          this.wakes.emit(w.x, w.z, c, -s, num(T.wake, 3), 0.9, Math.min(1, e.speed / 8) * 0.8 + 0.2, 14, e.speed * 0.25 * 0.65 + 1);
        }
      }
      this._shipAudioT -= dt;
      if (g.audio && typeof g.audio.boat === 'function' && this._shipAudioT <= 0) {
        this._shipAudioT = 0.25;
        const R = num(cfg.audioRange, 250), want = new Set();
        const list = S.list.filter((e) => num((types[e.typeId] || {}).engine, 0) > 0 && Math.hypot(e.pose.x - cam.x, e.pose.z - cam.z) < R).sort((a, b) => Math.hypot(a.pose.x - cam.x, a.pose.z - cam.z) - Math.hypot(b.pose.x - cam.x, b.pose.z - cam.z));
        for (let i = 0; i < list.length && i < num(cfg.audioMax, 2); i++) want.add(list[i]);
        for (const [e, h] of this._shipAudio) if (!want.has(e)) { try { h.stop(0.8); } catch (x) { /* ignore */ } this._shipAudio.delete(e); }
        for (const e of want) if (!this._shipAudio.has(e)) { try { const h = g.audio.boat(e.pose, { ship: true }); if (h) this._shipAudio.set(e, h); } catch (x) { /* ignore */ } }
      }
      for (const [e, h] of this._shipAudio) {
        const T = types[e.typeId] || {};
        h.set(0.5 + 0.06 * e.speed, num(T.engine, 0.5), 0);
        h.setPosition(e.pose);
      }
    }

    canSwitch(v) { return !this.game.online && v.seatCount > 1 && Math.abs(v.speed) < num(v.def.seatSwitchSpeed, 2); }

    // 撃てない（後ろからの視点）
    get noFire() { const v = this.game.vehicle; return !!(v && v.kind === 'boat' && this.chase); }

    info() {
      const live = this.game.vehicles.filter((v) => v.kind === 'boat');
      return { boats: live.length, wakes: this.wakes ? this.wakes.live() : 0, spray: this.spray ? this.spray.alive : 0, t: this.t, ships: this.shipping ? this.shipping.list.length : 0, view: this.shipsView ? this.shipsView.info() : null, shipAudio: this._shipAudio.size, stats: this.stats };
    }

    dispose() {
      const g = this.game;
      if (g.hud && g.hud.root && g.hud.root.classList) { g.hud.root.classList.remove('boat'); }
      if (this.wakes) this.wakes.dispose();
      if (this.spray) this.spray.dispose();
      if (this.shipsView) this.shipsView.dispose();
      if (g.world && g.world.shipRoomTest) g.world.shipRoomTest = null;
      for (const h of this._shipAudio.values()) { try { h.stop(0.2); } catch (x) { /* ignore */ } }
      this._shipAudio.clear();
      this.shipsView = null;
      this.wakes = null; this.spray = null;
    }
  }

  function Game_loadPref(k) { try { return window.localStorage ? window.localStorage.getItem('mirrsona.' + k) : null; } catch (e) { return null; } }
  function Game_savePref(k, v) { try { if (window.localStorage) window.localStorage.setItem('mirrsona.' + k, v); } catch (e) { /* ignore */ } }

  MR.CityBoats = CityBoats;
})();
