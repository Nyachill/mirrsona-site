// 街のオンライン（フェーズ D2）: city_dm（試合範囲のある個人戦）と city_royale（バトルロイヤル）を game.js につなぐ。
// game.js がオンラインで街（midtown）のときだけ new MR.CityOnline(game) を作る（arena のオンラインは今まで通り）。
// プロトコルは netproto.js の冒頭（VERSION 2）。サーバーは server/cityroom.js。
//
//   乗り物: サーバーの番号 i = city.vehicleSpawns() の順番。番号ごとの記録（位置・向き・傾き・HP・壊れた・席 occ・回転数）を持ち、
//     近い物（260 m）と動いている物（行が来ている物。ヘリは 1500 m）だけ MR.Vehicle / MR.Helicopter を作る（最大 MAX_OBJ 台）。
//     自分が運転・操縦している物だけ物理を回し、ほかはサーバーの行（net.sampleVehicle の補間。同乗している物は predictVehicle =
//     最新の行を今の時刻まで延ばした位置）か、止まっている物は最後の位置のまま（netIdle）。使えるのは vset の中の物だけ（city_dm は
//     試合範囲 + 60 m、バトロワは全部。ロビー・結果の間は乗れない）。
//   落ちている物・持ち物: welcome の lseed で Loot.World を作り（cityplay.js resetLoot）、loot.st（取られた・減った）と drops を当てる。
//     picked / loot（add・gone・back・reset）/ inv / heal はそのまま CityPlay へ
//   city_dm: 試合範囲（area）を壁（オレンジの円筒）・ミニマップ（mapInfo）・HUD（範囲の名前・移動までの時間・外なら範囲まで何 m）に。
//     next（予告）が来たら「30 秒後に ○○ へ移ります」、移ったら全員が新しい範囲に spawn し直される（持ち物はそのまま）
//   city_royale: round の ph ごと
//     lobby / countdown … ロビー（グランド・セントラル）で待つ画面（参加者・あと何人・開始までの秒）。撃てない・拾えない・乗れない
//     drop … 輸送ヘリ（flight: t0 に (x0, z0) を出て speed m/s）。「降下」で jump { p } → 自由落下 → パラシュート（ソロと同じ動き）。
//             航路の終わりで降りていなければ jumped（forced）の位置から落ちる
//     play … 安全地帯 = MR.Royale.zoneAt(round.zone, (サーバー時刻 − z0) / 1000)（サーバーと同じ円）。外のダメージはサーバーが送る
//     end … result（順位・撃破）を結果画面に。next の時刻に新しいロビー（全員がロビーに spawn し直す。落ちている物と乗り物は最初から）
//     やられた・途中から来た（spec）人は観戦: 生きている人の後ろ上のカメラ（「観戦中：○○」。切替ボタン・Q で次の人）。いなければ安全地帯の上
//   mapInfo() はミニマップ・全体の地図が読む（royale.js の RoyaleMode と同じ形）: cur（青 = 安全地帯 / 試合範囲）、next（白の点線）、flight
window.MR = window.MR || {};

MR.CityOnline = class CityOnline {
  constructor(game) {
    this.game = game;
    this.net = game.net;
    this.P = MR.NetProto;
    this.city = game.city;
    this.mode = this.net.mode;
    this.isRoyale = this.mode === 'city_royale';
    const on = game.config.online || {};
    this.cc = Object.assign({ areaRadius: 450, rotateWarning: 30, outsideDps: 8 }, on.city || {});
    this.rc = Object.assign({ minPlayers: 2, countdown: 20, resultTime: 15, lobbyZone: 'gct' }, on.royale || {});
    this.fallCfg = Object.assign({}, MR.Royale ? MR.Royale.DEFAULTS.fall : {}, (game.config.royale || {}).fall || {});
    this.MAX_OBJ = 28;
    this.recs = [];
    this.objs = new Map();      // i → MR.Vehicle（作ってある物）
    this._markers = new Map();  // id → { remote: true, id }（他の人の席の印）
    this.vset = { all: 1 };
    this.area = null; this.nextArea = null;
    this.round = null; this.zonePlan = null; this.z0 = 0; this.flight = null; this.zone = null;
    this.result = null;
    this.st = this.isRoyale ? 'lobby' : 'alive';
    this.alive = 0; this.total = 0; this.rank = 0;
    this.riding = false; this.ridePos = null; this.rideYaw = 0;
    this.spec = null;          // 観戦 { id, t, overview }
    this.deadAt = -1;
    this.wall = null; this._wallTex = null;
    this._vehTimer = 0;
    this._hudTimer = 0;
    this._lastArenaZone = null;
    this.stats = { vehiclesBuilt: 0, vehiclesDisposed: 0, jumps: 0, landed: 0, spectate: 0, results: 0, rounds: 0, areaRotations: 0 };
    this._initVehicles();
    this._buildWall();
    if (game.hud.setLobby) game.hud.setLobby(null);
    if (game.hud.setSpectate) game.hud.setSpectate(null);
  }

  get fighting() { return !this.isRoyale || !!(this.round && (this.round.ph === 'drop' || this.round.ph === 'play')); }
  // 撃てるか（バトロワのロビー・結果の間・輸送ヘリの中は撃てない。サーバーも hit を数えない）
  get canShoot() { return !this.riding && (!this.isRoyale || (this.fighting && (this.st === 'alive' || this.st === 'air'))); }
  serverNow() { return this.net.serverNow(); }
  zoneName(id) { const h = (this.city.hotZones || []).find((z) => z.id === id); return h ? (h.label || h.id) : (id || ''); }

  // ---------- welcome ----------
  applyWelcome(m) {
    const P = this.P;
    this.vset = m.vset || { all: 1 };
    this._resetVehicleRecs();
    for (const vi of (Array.isArray(m.vehicles) ? m.vehicles : [])) {
      const rec = this.recs[vi.i];
      if (!rec) continue;
      if (P.isVec(vi.p, 3)) { rec.x = vi.p[0]; rec.y = vi.p[1]; rec.z = vi.p[2]; }
      if (P.isNum(vi.yaw)) rec.yaw = vi.yaw;
      rec.pitch = P.isNum(vi.pitch) ? vi.pitch : 0; rec.roll = P.isNum(vi.roll) ? vi.roll : 0;
      if (P.isNum(vi.hp)) rec.hp = vi.hp;
      rec.wrecked = !!vi.wrecked;
      if (Array.isArray(vi.occ)) rec.occ = vi.occ.slice();
      rec.rpm = P.isNum(vi.rpm) ? vi.rpm : 0;
      rec.touched = true;
    }
    this._disposeAllObjs();
    // 落ちている物・持ち物
    const play = this.game.play;
    if (play) {
      play.resetLoot(m.lseed);
      const L = m.loot || {};
      for (const row of (Array.isArray(L.st) ? L.st : [])) if (Array.isArray(row)) play.loot.setRemoteState(row[0], !!row[1], P.isNum(row[2]) ? row[2] : null);
      for (const d of (Array.isArray(L.drops) ? L.drops : [])) play.loot.putDrop(d);
      if (m.inv) play.applyServerInv(m.inv, 0);
    }
    // 自分の状態（バトロワ）
    const me = (Array.isArray(m.players) ? m.players : []).find((q) => q && q.id === m.id);
    if (this.isRoyale) this.st = (me && me.st) || 'lobby';
    if (m.area) this._setArea(m.area, true);
    if (m.round) this._setRound(m.round, true);
    this._refreshVehicles(true);
  }

  // spawn を待つ間に立っている所（試合範囲の中心 / ロビーのホットゾーン）
  waitPos() {
    const a = this.net.welcome && this.net.welcome.area;
    if (a) return { x: a.x, z: a.z };
    const hz = (this.city.hotZones || []).find((h) => h.id === this.rc.lobbyZone) || (this.city.hotZones || [])[0] || { x: 0, z: 0 };
    return { x: hz.x, z: hz.z };
  }

  // ---------- 乗り物 ----------
  _initVehicles() {
    const types = ((this.game.config.vehicles || {}).types) || {};
    this.recs = this.city.vehicleSpawns().map((s, i) => {
      const def = types[s.type] || null;
      const nSeats = def && Array.isArray(def.seats) && def.seats.length ? def.seats.length : 1;
      const yaw = (s.yaw || 0) * Math.PI / 180;
      return { i, id: s.id, type: s.type, def, kind: def && (def.kind === 'heli' || def.kind === 'jet') ? def.kind : 'car', spawn: { x: s.x, y: s.y || 0, z: s.z, yaw },
        x: s.x, y: s.y || 0, z: s.z, yaw, pitch: 0, roll: 0, hp: def ? (def.health || 320) : 320, wrecked: false, sunk: false,
        occ: new Array(nSeats).fill(-1), rpm: 0, touched: false, rowT: 0 };
    });
  }
  _resetVehicleRecs() {
    for (const r of this.recs) {
      r.x = r.spawn.x; r.y = r.spawn.y; r.z = r.spawn.z; r.yaw = r.spawn.yaw; r.pitch = 0; r.roll = 0;
      r.hp = r.def ? (r.def.health || 320) : 320; r.wrecked = false; r.sunk = false; r.occ.fill(-1); r.rpm = 0; r.touched = false; r.rowT = 0;
    }
  }
  vehicle(i) { return this.objs.get(i) || null; }
  recById(id) {
    if (!this._recIds) { this._recIds = new Map(); for (const r of this.recs) this._recIds.set(r.id, r); }
    return this._recIds.get(id) || null;
  }
  rec(i) { return (this.P.isNum(i) && this.recs[i]) || null; }
  // 使える乗り物か（vset の中。バトロワは降下〜戦いの間だけ）
  inVset(rec) {
    const s = this.vset || { all: 1 };
    if (s.all) return true;
    return Math.hypot(rec.spawn.x - s.x, rec.spawn.z - s.z) <= s.r;
  }
  usable(rec) { return !!rec && this.inVset(rec) && this.fighting; }

  _marker(id) {
    let m = this._markers.get(id);
    if (!m) { m = { remote: true, id }; this._markers.set(id, m); }
    return m;
  }
  // 記録の席 occ を乗り物の occupants に（自分は game.player）
  _applyOcc(v, rec) {
    const me = this.net.id, g = this.game;
    for (let k = 0; k < v.seatCount; k++) {
      const id = rec.occ[k];
      const want = id == null || id < 0 ? null : (id === me ? (g.vehicle === v ? g.player : null) : this._marker(id));
      if (v.occupants[k] !== want) {
        if (k === 0 && !want && v.occupants[0]) v.clearDriver(); // 運転手がいなくなった（エンジン音も止まる）
        else v.occupants[k] = want;
      }
    }
  }

  // 作る・消す（0.5 秒ごと。force ですぐ）
  _refreshVehicles(force) {
    const g = this.game;
    if (!MR.Vehicle || g.rs.vehicles === false || g.cityCfg.vehicles === false) return;
    const fp = this.focus();
    const now = this.serverNow();
    const mineI = g.vehicle ? g.vehicle.netIndex : -1;
    const want = [];
    for (const rec of this.recs) {
      if (!rec.def || rec.sunk) continue;
      if (rec.kind === 'heli' && (!MR.Helicopter || g.cityCfg.helis === false)) continue;
      if (rec.kind === 'jet') continue; // 戦闘機のオンラインはフェーズ E4（サーバーも乗せない）
      if (!this.inVset(rec) && rec.i !== mineI) continue;
      const d = Math.hypot(rec.x - fp.x, rec.z - fp.z);
      const fresh = rec.rowT && now - rec.rowT < 2500;
      if (rec.i === mineI) want.push({ rec, d: -1 });
      else if (d < 260 || (fresh && d < (rec.kind === 'heli' ? 1500 : 700))) want.push({ rec, d });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set();
    for (let k = 0; k < want.length && keep.size < this.MAX_OBJ; k++) keep.add(want[k].rec.i);
    for (const [i, v] of Array.from(this.objs)) if (!keep.has(i)) this._disposeObj(i, v);
    for (const i of keep) if (!this.objs.has(i)) this._makeObj(this.recs[i]);
  }

  _makeObj(rec) {
    const g = this.game, vcfg = g.config.vehicles || {};
    const def = Object.assign({ id: rec.type }, rec.def);
    let v;
    if (rec.kind === 'heli') {
      const gy = this._groundAt(rec.x, rec.y + 0.5, rec.z);
      v = new MR.Helicopter(g.scene, def, { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, assets: g.assets, audio: g.audio, fx: g.fx, common: vcfg,
        collider: g._heliColl(), city: this.city, airborne: rec.y - gy > 0.5 && !rec.wrecked });
      if (rec.rpm > 0) { v.rotor = rec.rpm; v.spin = rec.rpm; v.engineOn = rec.rpm > 0.02; }
    } else {
      v = new MR.Vehicle(g.scene, def, { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, assets: g.assets, audio: g.audio, fx: g.fx, common: vcfg, terrain: true });
    }
    v.spawnPos.set(rec.spawn.x, rec.spawn.y, rec.spawn.z);
    v.spawnYaw = rec.spawn.yaw;
    v.pitch = rec.pitch || 0; v.roll = rec.roll || 0;
    v.netIndex = rec.i;
    v.netControlled = true;
    v.cityId = rec.id;
    v.citySpec = { id: rec.id, type: rec.type, x: rec.spawn.x, y: rec.spawn.y, z: rec.spawn.z };
    v.setHealth(rec.hp);
    if (rec.wrecked) v.netWreck();
    this._applyOcc(v, rec);
    v._apply();
    g.vehicles.push(v);
    this.objs.set(rec.i, v);
    (g._cityVehById || (g._cityVehById = new Map())).set(rec.id, v);
    this.stats.vehiclesBuilt++;
    return v;
  }
  _disposeObj(i, v) {
    const g = this.game;
    if (v === g.vehicle) return; // 乗っている物は消さない
    if (v.headlight) v.detachHeadlight();
    v.dispose();
    const k = g.vehicles.indexOf(v);
    if (k >= 0) g.vehicles.splice(k, 1);
    this.objs.delete(i);
    if (g._cityVehById) g._cityVehById.delete(v.cityId);
    this.stats.vehiclesDisposed++;
  }
  _disposeAllObjs() {
    const g = this.game;
    if (g.vehicle) g._exitVehicle(true);
    for (const [i, v] of Array.from(this.objs)) this._disposeObj(i, v);
  }
  _groundAt(x, y, z) {
    const nav = this.game.world && this.game.world.nav;
    const g = nav ? nav.groundHeight(x, z, y, 0.3) : null;
    if (g !== null && g !== undefined) return g;
    const s = this.city.supportHeightAt ? this.city.supportHeightAt(x, z) : 0;
    return s <= y ? s : 0;
  }

  // 毎フレーム（game._updateVehicles から）: 自分が運転・操縦している物は物理、同乗は延ばした位置、ほかは補間した行か止まったまま
  updateVehicles(dt) {
    const g = this.game, net = this.net, ctx = g._vehicleCtx();
    const now = net.serverNow();
    // 行（net.vehicles）から記録を新しく
    for (const nv of net.vehicles) {
      if (!nv || !nv.rowT) continue;
      const rec = this.recs[nv.i];
      if (!rec || nv.rowT <= rec.rowT) continue;
      rec.rowT = nv.rowT;
      if (Array.isArray(nv.p) && nv.p.length >= 3) { rec.x = nv.p[0]; rec.y = nv.p[1]; rec.z = nv.p[2]; }
      if (this.P.isNum(nv.yaw)) rec.yaw = nv.yaw;
      rec.pitch = nv.pitch || 0; rec.roll = nv.roll || 0; rec.rpm = nv.rpm || 0;
      rec.touched = true;
    }
    this._vehTimer -= dt;
    if (this._vehTimer <= 0) { this._vehTimer = 0.5; this._refreshVehicles(); }
    const S = this._vs || (this._vs = {});
    for (const v of g.vehicles) {
      const rec = this.recs[v.netIndex];
      if (!rec) { v.update(dt, ctx); continue; }
      v.netInactive = !this.usable(rec);
      if (v === g.vehicle && !(g.vehicleSeat > 0)) {
        v.update(dt, ctx);
        rec.x = v.pos.x; rec.y = v.pos.y; rec.z = v.pos.z; rec.yaw = v.yaw; rec.pitch = v.pitch || 0; rec.roll = v.roll || 0; rec.touched = true;
        if (v.kind === 'heli') rec.rpm = v.rotor;
        continue;
      }
      if (v.wrecked) { v.update(dt, ctx); continue; }
      if (v === g.vehicle) {
        const s = net.predictVehicle(v.netIndex, now, S, 400);
        if (s && s.has3d && !s.stale) { this._pose(v, s, dt); continue; }
      } else {
        const s = net.sampleVehicle(v.netIndex, S);
        if (s && s.has3d && !s.stale) { this._pose(v, s, dt); continue; }
      }
      v.netIdle(dt);
    }
  }
  _pose(v, s, dt) {
    v.netPose(s.x, s.z, s.yaw, s.sp, s.st, dt, s.y, s.pitch, s.roll, s.rpm);
  }

  // ---------- 乗り物のメッセージ ----------
  onVehicleMsg(m) {
    const P = this.P, g = this.game, me = this.net.id;
    const rec = this.rec(m.i);
    if (!rec) return;
    const v = this.objs.get(m.i) || null;
    switch (m.t) {
      case 'vseat': {
        if (!Array.isArray(m.occ)) break;
        rec.occ = m.occ.slice(0, rec.occ.length);
        while (rec.occ.length < m.occ.length && rec.occ.length < 8) rec.occ.push(m.occ[rec.occ.length]);
        rec.touched = true;
        const seat = rec.occ.indexOf(me);
        if (g._pendingEnter === m.i) {
          g._pendingEnter = -1;
          if (seat >= 0 && !g.vehicle && !g.player.dead) {
            const obj = v || this._makeObj(rec);
            g._enterVehicle(obj, true, seat);
          } else if (seat < 0) g.hud.showMessage('乗れません', 900);
        } else if (g.vehicle && g.vehicle.netIndex === m.i) {
          if (seat < 0) g._exitVehicle(true); // サーバーが降ろした
          else if (seat !== g.vehicleSeat) g._changeSeat(seat);
        } else if (seat >= 0 && !g.vehicle) {
          // 頼んでいないのに座っている（古い enter の返事など）: 降りると伝える。
          // ただし自分の exit がまだサーバーで処理されていない（この vseat は exit より前のもの）なら送らない（二重の exit になる）
          const ss = this.net.selfServer;
          const exitPending = g.time - (g._exitResentAt == null ? -10 : g._exitResentAt) < 2 || (ss && P.isNum(ss.ack) && ss.ack < (g._exitSeq || 0));
          if (!exitPending) {
            const p = g.player.pos;
            g.net.send({ t: 'exit', i: m.i, p: P.qv([p.x, p.y, p.z]), yaw: P.qa(g.player.yawAngle) });
            g._exitResentAt = g.time;
            g._exitSeq = (this.net._seq || 0) + 1;
          }
        }
        if (v) this._applyOcc(v, rec);
        break;
      }
      case 'vowner': break; // vseat が席を全部持っている
      case 'vdamage': {
        if (P.isNum(m.hp)) rec.hp = m.hp;
        if (v) {
          const before = v.health;
          v.setHealth(m.hp);
          if (v === g.vehicle && v.health < before) { g.hud.damage(); g.shake = Math.min(1.5, g.shake + 0.15); }
        }
        break;
      }
      case 'vexplode': {
        rec.wrecked = true; rec.hp = 0; rec.occ.fill(-1); rec.rpm = 0;
        if (P.isVec(m.p, 3)) { rec.x = m.p[0]; rec.z = m.p[2]; }
        const sunk = m.how === 'sunk';
        rec.sunk = sunk;
        if (v) {
          if (g.vehicle === v) g._exitVehicle(true);
          if (sunk) v.netSunk(); else {
            if (P.isVec(m.p, 3) && v.kind !== 'heli') { v.pos.x = m.p[0]; v.pos.z = m.p[2]; }
            v.netExplode(g._vehicleCtx());
          }
          this._applyOcc(v, rec);
        }
        if (g._pendingEnter === m.i) g._pendingEnter = -1;
        break;
      }
      case 'vrespawn': {
        rec.wrecked = false; rec.sunk = false; rec.occ.fill(-1); rec.rpm = 0; rec.pitch = 0; rec.roll = 0; rec.rowT = 0;
        if (P.isVec(m.p, 3)) { rec.x = m.p[0]; rec.y = m.p[1]; rec.z = m.p[2]; }
        if (P.isNum(m.yaw)) rec.yaw = m.yaw;
        rec.hp = P.isNum(m.hp) ? m.hp : rec.hp;
        if (v) {
          if (g.vehicle === v) g._exitVehicle(true);
          this._disposeObj(m.i, v); // 作り直す（沈んで見えなくなった物・残骸の見た目を戻す）
        }
        this._refreshVehicles(true);
        break;
      }
      default: break;
    }
  }

  // ---------- 試合範囲（city_dm）----------
  _setArea(m, quiet) {
    const g = this.game;
    const prev = this.area;
    this.area = { x: m.x, z: m.z, r: m.r, dps: m.dps, zone: m.zone, at: m.at, until: m.until };
    if (m.vset) this.vset = m.vset;
    if (m.next) {
      this.nextArea = { x: m.next.x, z: m.next.z, r: m.next.r, zone: m.next.zone, at: m.next.at };
      if (!quiet) g.hud.showMessage('まもなく試合範囲が「' + this.zoneName(m.next.zone) + '」へ移ります', 3200);
    } else {
      if (prev && prev.zone !== m.zone && !quiet) { g.hud.showMessage('試合範囲が「' + this.zoneName(m.zone) + '」に移りました', 3000); this.stats.areaRotations++; }
      this.nextArea = null;
    }
    if (!quiet) this._refreshVehicles(true);
  }

  // ---------- ラウンド（city_royale）----------
  _setRound(m, fromWelcome) {
    const g = this.game, prev = this.round;
    this.round = { ph: m.ph, n: m.n, seed: m.seed, lseed: m.lseed, t0: m.t0, t1: m.t1 || 0, alive: m.alive | 0, total: m.total | 0, min: m.min | 0 };
    if (m.zone) { this.zonePlan = { phases: m.zone.phases, circles: m.zone.circles }; this.z0 = m.zone.z0; } else if (m.ph === 'lobby' || m.ph === 'countdown') { this.zonePlan = null; }
    if (m.flight) this.flight = Object.assign({}, m.flight); else if (m.ph === 'lobby') this.flight = null;
    if (m.ph === 'drop' || m.ph === 'play' || m.ph === 'end') { this.alive = m.alive | 0; this.total = m.total | 0; }
    const newRound = !prev || prev.n !== m.n;
    if (m.ph === 'lobby') {
      if (!fromWelcome && prev && prev.ph !== 'lobby' && prev.ph !== 'countdown') {
        // 新しいラウンド: 乗り物は最初から（落ちている物は loot reset、全員の spawn が続く）
        this._resetVehicleRecs();
        this._disposeAllObjs();
        this._refreshVehicles(true);
        this.stats.rounds++;
      }
      this.result = null;
      g.hud.showResult(null);
      this._stopSpectate();
      if (!fromWelcome) g.hud.showMessage('ロビーに戻りました。次のラウンドを待っています', 2400);
    } else if (m.ph === 'countdown') {
      if (!fromWelcome) g.hud.showMessage('まもなく開始', 1500);
    } else if (m.ph === 'drop') {
      if (!fromWelcome && prev && prev.ph !== 'drop') {
        this._resetVehicleRecs();
        this._disposeAllObjs();
        this._refreshVehicles(true);
      }
      if (this.st === 'lobby' && !fromWelcome) {
        this.st = 'plane';
        if (g.vehicle) g._exitVehicle(true);
        if (g.play) { g.play.cancelHeal('drop'); g.play.onRespawn(); }
        this._board();
      } else if (fromWelcome && this.st === 'plane') this._board();
    } else if (m.ph === 'play') {
      if (!fromWelcome && prev && prev.ph === 'drop') g.hud.showMessage('安全地帯に入って最後の 1 人になれ', 2400);
    }
    if (newRound && fromWelcome && (m.ph === 'drop' || m.ph === 'play' || m.ph === 'end') && (this.st === 'spec' || this.st === 'dead')) this._startSpectate(null, true);
  }

  // ---------- 輸送ヘリ ----------
  flightPos(t, out) {
    const f = this.flight;
    if (!f) return null;
    const s = Math.max(0, Math.min(f.len, (t - f.t0) / 1000 * f.speed));
    const o = out || {};
    o.x = f.x0 + f.dx * s; o.y = f.y; o.z = f.z0 + f.dz * s; o.s = s;
    return o;
  }
  _board() {
    const g = this.game, f = this.flight;
    if (!f) return;
    this.riding = true;
    this.ridePos = new THREE.Vector3(f.x0, f.y, f.z0);
    this.rideYaw = Math.atan2(-f.dx, -f.dz);
    const P = g.player;
    P.dead = false;
    P.health = g.config.player.maxHealth;
    P.yawAngle = this.rideYaw; P.pitchAngle = -0.35;
    P.state = 'walk'; P.grounded = true;
    g._waitingSpawn = false;
    g.hud.showDeath(false);
    g.hud.setHealth(P.health, g.config.player.maxHealth);
    if (!this.transport && MR.RoyaleTransport) this.transport = new MR.RoyaleTransport(g.scene, g.assets, g.config.vehicles && g.config.vehicles.types && g.config.vehicles.types.heli);
    if (this.transport) this.transport.root.visible = true;
    if (g.viewRoot) g.viewRoot.visible = false;
    g.hud.setDrop(true, '降下');
    g.hud.showMessage('「降下」で飛び降りる', 2200);
    if (g.audio && g.audio.loop && !this._rideSound) this._rideSound = g.audio.loop('heli_rotor', { volume: 0.55, fadeIn: 0.8 });
  }
  // 乗っている間（player.update の代わり）
  updateRide(dt) {
    const g = this.game, f = this.flight, P = g.player, input = g.input;
    if (!f) { this.riding = false; return; }
    P._updateLook(dt, input);
    input.consumeJump();
    const q = this.flightPos(this.serverNow(), this._fq || (this._fq = {}));
    this.ridePos.set(q.x, q.y, q.z);
    f.px = q.x; f.pz = q.z;
    if (this.transport) this.transport.update(dt, this.ridePos, Math.atan2(f.dx, f.dz));
    P.pos.set(q.x, q.y - P.eyeHeight + 3.5, q.z);
    P._apply();
    g.camera.position.set(0, 2.5, 24);
    const want = input.consumeDrop() || !!(input.keys && input.keys.Space) || g.input._jump;
    if (want || q.s >= f.len - 1) this.jump(null);
  }
  // 飛び降りる（forced: サーバーが降ろした位置 [x, y, z]。自分で降りたときはサーバーに jump を送る）
  jump(forced) {
    const g = this.game, P = g.player, f = this.flight, Pr = this.P;
    if (!this.riding) return;
    this.riding = false;
    g.input._jump = false;
    g.camera.position.set(0, 0, 0);
    g.hud.setDrop(false);
    if (this._rideSound) { this._rideSound.stop(1.2); this._rideSound = null; }
    let p;
    if (forced) p = forced.slice();
    else {
      const q = this.flightPos(this.serverNow());
      p = [q.x, q.y, q.z];
      g.net.send({ t: 'jump', p: Pr.qv(p) });
    }
    P.pos.set(p[0], p[1], p[2]);
    P.startFall(f.dx * f.speed * 0.25, f.dz * f.speed * 0.25, this.fallCfg, (x, z) => this.city.supportHeightAt(x, z));
    P.pitchAngle = -0.7;
    P._apply();
    if (g.viewRoot) g.viewRoot.visible = false;
    this.st = 'air';
    g._netResetMove();
    g._netGuardBonus = (g._netGuardBonus || 0) + f.speed * 0.25 / 2.5 + 4;
    this.stats.jumps++;
    g.hud.showMessage(forced ? '航路の終わりで降ろされた（パラシュートは自動で開く）' : 'パラシュートは自動で開く（ジャンプで早く開く）', 2200);
  }

  // ---------- 観戦 ----------
  _specTargets() {
    const out = [];
    for (const r of this.game.remotes.values()) if (!r.dead && r.hasState && !r.away) out.push(r);
    out.sort((a, b) => a.id - b.id);
    return out;
  }
  _startSpectate(prefId, quiet) {
    const list = this._specTargets();
    let t = prefId != null ? list.find((r) => r.id === prefId) : null;
    if (!t) t = list[0] || null;
    this.spec = { id: t ? t.id : -1, t: 0 };
    this.stats.spectate++;
    const g = this.game;
    g.hud.showDeath(false);
    if (g.viewRoot) g.viewRoot.visible = false;
    if (!quiet) g.hud.showMessage('観戦します（切替で次の人）', 1600);
  }
  _stopSpectate() {
    if (!this.spec) return;
    this.spec = null;
    const g = this.game;
    if (g.hud.setSpectate) g.hud.setSpectate(null);
    if (g.viewRoot) g.viewRoot.visible = true;
    g.camera.position.set(0, 0, 0);
  }
  nextSpectate() {
    if (!this.spec) return;
    const list = this._specTargets();
    if (!list.length) { this.spec.id = -1; return; }
    const k = list.findIndex((r) => r.id === this.spec.id);
    this.spec.id = list[(k + 1) % list.length].id;
  }
  // 死んでいる間・観戦中（game._updateOnlineDeath から）
  updateDead(dt) {
    const g = this.game;
    if (!this.isRoyale) return false;
    if (!this.spec && (this.st === 'spec' || (this.st === 'dead' && g.time - this.deadAt > 2.5))) this._startSpectate(this._killer);
    if (!this.spec) return true;
    if (g.input.consumeSwap() || (g.input.consumeSpectate && g.input.consumeSpectate())) this.nextSpectate();
    const P = g.player;
    let r = this.spec.id >= 0 ? g.remotes.get(this.spec.id) : null;
    if (!r || r.dead || r.away || !r.hasState) { const list = this._specTargets(); r = list[0] || null; this.spec.id = r ? r.id : -1; }
    let cx, cy, cz, tx, ty, tz;
    if (r) {
      const yaw = r.camYaw != null ? r.camYaw : r.yaw - Math.PI; // 見ている向き（カメラのヨー）
      const back = r.veh >= 0 ? 12 : 4.2, up = r.veh >= 0 ? 4 : 1.9;
      tx = r.pos.x; ty = r.pos.y + 1.5; tz = r.pos.z;
      cx = tx + Math.sin(yaw) * back; cz = tz + Math.cos(yaw) * back; cy = ty + up;
      // 壁の中に入らないように寄せる
      const nav = g.world.nav;
      const dx = cx - tx, dy = cy - ty, dz = cz - tz, len = Math.hypot(dx, dy, dz) || 1;
      const h = nav.raycast(tx, ty, tz, dx / len, dy / len, dz / len, len, { water: true });
      if (h && h.t < len) { const k = Math.max(0.3, h.t - 0.4) / len; cx = tx + dx * k; cy = ty + dy * k; cz = tz + dz * k; }
    } else {
      // 誰も見えない: 安全地帯の中心の上から
      const z = this.zone && this.zone.cur ? this.zone.cur : this.waitPos();
      tx = z.x; tz = z.z; ty = 0;
      cx = tx; cz = tz + 160; cy = 180;
    }
    const s = this.spec;
    const k = s.cam ? Math.min(1, dt * 6) : 1;
    s.cam = s.cam || { x: cx, y: cy, z: cz };
    s.cam.x += (cx - s.cam.x) * k; s.cam.y += (cy - s.cam.y) * k; s.cam.z += (cz - s.cam.z) * k;
    P.pos.set(s.cam.x, s.cam.y - P.eyeHeight, s.cam.z);
    P.yawAngle = Math.atan2(-(tx - s.cam.x), -(tz - s.cam.z));
    P.pitchAngle = Math.atan2(ty - s.cam.y, Math.hypot(tx - s.cam.x, tz - s.cam.z));
    P.recoilPitch = 0; P.bobTime = 0; P.eyeOffset = 0;
    P._apply();
    if (g.hud.setSpectate) g.hud.setSpectate(r ? '観戦中：' + r.name : '観戦中');
    return true;
  }

  // ---------- 自分・他の人の出来事（game._onNet から）----------
  onSpawnSelf(m) {
    const g = this.game;
    this._stopSpectate();
    if (this.riding) { this.riding = false; g.hud.setDrop(false); if (this._rideSound) { this._rideSound.stop(0.5); this._rideSound = null; } g.camera.position.set(0, 0, 0); }
    if (this.transport) this.transport.root.visible = false;
    if (this.isRoyale) {
      // ロビーの spawn（round の lobby が先に届く）。ラウンドの途中の spawn は再接続（welcome の st のまま）か置き直し
      const ph = this.round && this.round.ph;
      if (!ph || ph === 'lobby' || ph === 'countdown') this.st = 'lobby';
      else if (this.st !== 'air' && this.st !== 'plane') this.st = 'alive';
    } else this.st = 'alive';
    if (g.parachute && g.parachute.root.visible) g.parachute.close();
    if (g.viewRoot) g.viewRoot.visible = true;
    if (g.play && m.inv) g.play.applyServerInv(m.inv, 0, true);
  }
  onKill(m) {
    const me = this.net.id;
    if (this.P.isNum(m.rank) && this.isRoyale) this.alive = Math.max(0, m.rank - 1);
    if (m.target === me) {
      this.st = this.isRoyale ? 'dead' : 'alive';
      this.rank = m.rank || 0;
      this.deadAt = this.game.time;
      this._killer = m.attacker >= 0 && m.attacker !== me ? m.attacker : null;
      if (this.riding) { this.riding = false; this.game.hud.setDrop(false); if (this._rideSound) { this._rideSound.stop(0.3); this._rideSound = null; } this.game.camera.position.set(0, 0, 0); }
      if (this.game.parachute && this.game.parachute.root.visible) this.game.parachute.close();
    }
  }
  onDamageSelf(m) {
    const g = this.game;
    if (Array.isArray(m.ar) && g.play) g.play.setArmor(m.ar[0], m.ar[1]);
    if (m.kind === 'zone') {
      if (g.audio && g.audio.play) g.audio.play('zone_damage', { priority: 2 });
      return 'quiet';
    }
    if (m.kind === 'fall') return 'quiet'; // 着地の音と揺れは自分の着地で出している
    return null;
  }
  onJumped(m) {
    if (m.id !== this.net.id) return;
    if (this.riding && Array.isArray(m.p)) this.jump(m.p);
  }
  onResult(m) {
    const g = this.game, net = this.net, me = net.id;
    this.stats.results++;
    const list = (Array.isArray(m.ranks) ? m.ranks : []).map((r) => ({ id: r[0], rank: r[1], kills: r[2], name: net.playerName(r[0]), self: r[0] === me }));
    list.sort((a, b) => a.rank - b.rank);
    const mine = list.find((x) => x.self);
    const win = m.winner === me;
    const total = Math.max(list.length, this.total || 0);
    this.result = { win, rank: mine ? mine.rank : 0, total, kills: mine ? mine.kills : 0, list, next: m.next, winner: m.winner };
    if (win && g.audio.kill) g.audio.kill();
    g.hud.showDeath(false);
    const title = win ? '優勝！' : (mine ? 'ラウンド終了' : 'ラウンド終了（観戦）');
    const by = m.winner >= 0 ? (win ? 'あなたが最後の 1 人' : '勝者：' + net.playerName(m.winner)) : '勝者なし';
    g.hud.showResult({ title, win, rank: mine ? mine.rank : '-', total, kills: mine ? mine.kills : 0, time: 0, by, list, online: true, nextText: this._nextText() }, null, () => g.leaveToTitle());
  }
  _nextText() {
    if (!this.result || !this.result.next) return '';
    const s = Math.max(0, Math.ceil((this.result.next - this.serverNow()) / 1000));
    return '次のラウンドまで ' + s + ' 秒';
  }

  // ---------- 毎フレーム（game._updateCity から）----------
  update(dt) {
    const g = this.game, P = g.player, now = this.serverNow();
    // 安全地帯（バトロワ）/ 試合範囲（city_dm）
    let cur = null, next = null, label = '', timer = '', dps = 0;
    if (this.isRoyale) {
      if (this.zonePlan && this.round && (this.round.ph === 'drop' || this.round.ph === 'play' || this.round.ph === 'end')) {
        const z = MR.Royale.zoneAt(this.zonePlan, (now - this.z0) / 1000);
        this.zone = z;
        cur = z.cur; next = z.stage === 'end' ? null : z.next; dps = z.dps;
        const fmt = CityOnline.fmt;
        timer = z.stage === 'wait' ? '縮小まで ' + fmt(z.left) : (z.stage === 'shrink' ? '縮小中 ' + fmt(z.left) : '最終');
        if (this._zoneStage !== z.phase + z.stage) {
          if (this._zoneStage != null && z.stage === 'shrink') g.hud.showMessage('安全地帯が縮小しています', 1800);
          this._zoneStage = z.phase + z.stage;
        }
      } else { this.zone = null; this._zoneStage = null; }
    } else if (this.area) {
      cur = { x: this.area.x, z: this.area.z, r: this.area.r };
      next = this.nextArea ? { x: this.nextArea.x, z: this.nextArea.z, r: this.nextArea.r } : null;
      dps = this.area.dps;
      const left = Math.max(0, (this.area.until - now) / 1000);
      label = this.zoneName(this.area.zone);
      timer = this.nextArea ? '移動まで ' + CityOnline.fmt(left) : label;
    }
    this._cur = cur; this._next = next;
    this._updateWall(cur);
    // 外にいるか（画面の縁の色・HUD）
    const active = !P.dead && !this.riding && this.st !== 'spec' && this.st !== 'dead' && (!this.isRoyale || this.st === 'alive' || this.st === 'air');
    const out = cur && active ? Math.hypot(P.pos.x - cur.x, P.pos.z - cur.z) - cur.r : -1;
    const isOut = !!cur && active && (out > 0 || (this.isRoyale && cur.r <= 0.5));
    g.hud.setZoneTint(isOut ? 0.55 + 0.25 * Math.sin(g.time * 4) : 0);
    // HUD（残り・時間・範囲まで）
    this._hudTimer -= dt;
    if (this._hudTimer <= 0) {
      this._hudTimer = 0.2;
      if (this.isRoyale) {
        const ph = this.round ? this.round.ph : 'lobby';
        if (ph === 'drop' || ph === 'play' || ph === 'end') g.hud.setRoyale({ alive: this.alive, label: '残り', zone: timer, dist: isOut ? Math.round(out) : null, warn: isOut, distLabel: '安全地帯まで ' });
        else g.hud.setRoyale(null);
        this._updateLobby(now);
        if (this.result && g.hud.setResultNext) g.hud.setResultNext(this._nextText());
      } else {
        g.hud.setRoyale({ alive: this.net.players.size, label: '人数', zone: this.nextArea ? '移動 ' + CityOnline.fmt(Math.max(0, (this.area.until - now) / 1000)) + ' → ' + this.zoneName(this.nextArea.zone) : label, dist: isOut ? Math.round(out) : null, warn: isOut, distLabel: '範囲まで ' });
      }
    }
    // 着地（バトロワ）: 自由落下・パラシュートから立った / 泳いだ
    if (this.isRoyale && this.st === 'air' && !P.dead && (P.state === 'walk' && P.grounded || P.state === 'swim')) {
      this.st = 'alive'; this.stats.landed++;
      if (g.viewRoot) g.viewRoot.visible = true;
    }
    // 輸送ヘリ・降下中の HUD（royale.js と同じクラス）
    const rc = g.hud.root && g.hud.root.classList;
    if (rc) { rc.toggle('riding', this.riding); rc.toggle('falling', P.state === 'fall' && !P.dead); rc.toggle('chute', P.state === 'chute' && !P.dead); rc.toggle('spectating', !!this.spec); }
    if (this.transport && !this.riding) {
      // 輸送ヘリは降下の段階の間、航路の上を飛び続ける（他の人も見える）
      const ph = this.round && this.round.ph;
      if (ph === 'drop' && this.flight) {
        const q = this.flightPos(now, this._fq2 || (this._fq2 = {}));
        this.transport.root.visible = q.s < this.flight.len - 0.5;
        this.transport.update(dt, this._tp || (this._tp = new THREE.Vector3()).set(q.x, q.y, q.z), Math.atan2(this.flight.dx, this.flight.dz));
      } else this.transport.root.visible = false;
    }
  }

  // ロビーの画面（参加者・あと何人・開始までの秒）
  _updateLobby(now) {
    const g = this.game;
    if (!g.hud.setLobby) return;
    const r = this.round;
    if (!r || (r.ph !== 'lobby' && r.ph !== 'countdown') || this.st === 'spec' && !(r.ph === 'lobby' || r.ph === 'countdown')) { g.hud.setLobby(null); return; }
    const names = [];
    for (const p of this.net.players.values()) names.push({ name: p.name, self: p.id === this.net.id });
    const n = names.length, min = r.min || this.rc.minPlayers;
    let text;
    if (r.ph === 'countdown') text = '開始まで ' + Math.max(0, Math.ceil((r.t1 - now) / 1000)) + ' 秒';
    else text = n >= min ? 'まもなく開始' : 'あと ' + (min - n) + ' 人で開始（' + n + ' / ' + min + ' 人）';
    g.hud.setLobby({ title: 'ロビー：' + this.zoneName(this.rc.lobbyZone), text, names, countdown: r.ph === 'countdown' });
  }

  static fmt(s) { s = Math.ceil(s); return Math.floor(s / 60) + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60); }

  // 自分の位置（乗り物を作る中心）: 観戦中はカメラ
  focus() {
    const g = this.game;
    if (this.riding && this.ridePos) return { x: this.ridePos.x, z: this.ridePos.z };
    return { x: g.player.pos.x, z: g.player.pos.z };
  }

  // ミニマップ・全体の地図（RoyaleMode.mapInfo と同じ形）
  mapInfo() {
    const f = this.flight;
    return { cur: this._cur || null, next: this._next || null, flight: (this.riding || (this.round && this.round.ph === 'drop')) && f ? f : null };
  }

  // ---------- 壁（試合範囲 / 安全地帯）----------
  _buildWall() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    geo.translate(0, 0.5, 0);
    const tex = MR.RoyaleMode && MR.RoyaleMode.wallTexture ? MR.RoyaleMode.wallTexture() : null;
    const color = this.isRoyale ? '#4f9bff' : '#ff9a4f';
    const mat = new THREE.MeshBasicMaterial({ color: MR.srgb(color), map: tex, transparent: true, opacity: this.isRoyale ? 0.45 : 0.32, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.name = this.isRoyale ? 'zone_wall' : 'area_wall';
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 3;
    this.wall.visible = false;
    this.game.scene.add(this.wall);
    this._wallTex = tex;
  }
  _updateWall(cur) {
    const w = this.wall;
    if (!w) return;
    if (!cur || cur.r <= 1) { w.visible = false; return; }
    w.visible = true;
    w.position.set(cur.x, -30, cur.z);
    w.scale.set(cur.r, this.isRoyale ? 700 : 260, cur.r);
    if (this._wallTex) { this._wallTex.repeat.x = Math.max(1, Math.round(2 * Math.PI * cur.r / 40)); this._wallTex.offset.x = (this.game.time * 0.02) % 1; }
  }

  dispose() {
    const g = this.game, h = g.hud;
    if (h.setRoyale) { h.setRoyale(null); h.setZoneTint(0); h.setDrop(false); h.showResult(null); }
    if (h.setLobby) h.setLobby(null);
    if (h.setSpectate) h.setSpectate(null);
    const rc = h.root && h.root.classList;
    if (rc) for (const c of ['riding', 'falling', 'chute', 'spectating']) rc.remove(c);
    if (this.wall) { g.scene.remove(this.wall); this.wall.geometry.dispose(); this.wall.material.dispose(); if (this._wallTex) this._wallTex.dispose(); this.wall = null; }
    if (this.transport) { this.transport.dispose(); this.transport = null; }
    if (this._rideSound) { this._rideSound.stop(0.2); this._rideSound = null; }
  }
};
