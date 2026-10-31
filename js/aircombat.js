// 空の戦い（MR.AirCombat。game.js が 1 つ持つ。THREE は使うが DOM は使わない）。戦闘機の操縦席のロック・ミサイル・フレア・警告
//   （今まで game._updateJetWeapons の中にあったもの。game._updateJetWeapons(dt, v) はこれを呼ぶだけ = テストがそのまま呼べる）。
//   ロックの状態は game に置く（g._jetLock = { target, t, locked, dist, ang, seen, losT }・g._lockScanT。jeteasy-touch が読み書きする）。
//   ロック: 速度の向きから missile.lockCone° 以内・lockMin〜lockRange m の一番よい目標（空の目標が先）に lockTime 秒 → ロック、lockKeep° 以内なら保つ
//     （型に関係なく機体のセンサーの数値 = D2）。ロックしている間は lock_tone（うなり）、ロックしたら lock_solid（どちらも 2D のループ、sfx）。
//   撃つ: 型は撃つときに選ぶ（D2。MR.MissileCore.pickType: 空の目標が aim9x.maxRange 以内で首振りの中なら AIM-9X、ほか・地上・狙う点は AIM-120 →
//     AIM-9X）。ロックが無ければ照準の先（速度の向きのレイが当たる所）を狙う点にする（当たらなければまっすぐ）。
//   フレア: ボタン・自動フレア（来るミサイルが flares.autoRange m か autoTime 秒以内）。来るミサイルは v.incoming（HUD）と rwr_warning。
//   MR.AirCombat.score(...) … 目標の狙いやすさ（weapons2 の AALock も使う。閉包を作らない）。オンライン（D10）では何もしない（E4.3 で送る）
//   RWR（E2.2）: rwrFor(v) = 来るミサイル（missiles.incomingFor）・weapons2 のロケット（ordnance.incoming、あれば）・spike（地上の見張り・
//     対空ミサイルのロック）をまとめた 1 つ { st 1 探知 / 2 ロック / 3 発射, bearing（機首から右が正の度）, elevation, clock（1..12 時）, dist, tti, kind }。
//     音: 探知 = lock_tone・ロック = lock_solid を小さく（vehicles.types.*.rwr の searchTone / lockTone = 音量。2D のループ 1 つ = this._rwrLoop）、
//     発射 = rwr_warning（flares.rwrEvery 秒ごと）。印は最後の信号から rwr.markerSec 秒残す。乗っている人だけ（g.vehicle === v）。
//   spike(v, src, st) … 見張り・対空ミサイルが v を 'search' | 'lock' | 'launch' している（E2.3 / weapons2 M5 が呼ぶ。src は位置を持つ物）。
//   updateHeli(dt, v) … ヘリ（守るだけ: ロック・撃つは無し）。操縦席・空中でフレア（ボタン / X / 自動）と RWR
//   updateVtol(dt, v, wantM) … VTOL（V3）: 向きは game._vtolAimDir → _lockTick → ロックの音 → 爆弾の落ちる所（扉が開いているときだけ = bombReady）→ 撃つ
//     （_fire の dirIn = 見ている向き）。フレアと RWR はこの後の updateHeli。無人の VTOL はどの機体からもロックしない。inAir(v) = VTOL・ヘリは heliAir、戦闘機は mode 'air'
window.MR = window.MR || {};

MR.AirCombat = class AirCombat {
  constructor(game) {
    this.g = game;
    this._fwd = new THREE.Vector3(); this._c = new THREE.Vector3(); this._tp = new THREE.Vector3(); this._ld = new THREE.Vector3();
    this._from = new THREE.Vector3(); this._dir = new THREE.Vector3(); this._aim = new THREE.Vector3();
    this._sc = { ang: 0, dist: 0, s: 0 };   // score の結果（使い回し）
    this._best = { ang: 0, dist: 0, s: 0 };
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, water: false, src: null }; // _jetRay の out
    this._fireOpts = { from: null, vel: null, dir: null, target: null, owner: null, type: null, aim: null };
    this._loop = null; this._loopName = null; // lock_tone / lock_solid（1 つだけ）
    this._rwrLoop = null; this._rwrName = null; // RWR の探知 / ロックの音（1 つだけ）
    this._spk = [];                              // spike の記録（使い回し。最大 AirCombat.MAX_SPIKES）
    this._rwr = { st: 0, bearing: 0, elevation: 0, clock: 12, dist: 0, tti: 0, kind: '', fresh: false, t: 0 }; // rwrFor の結果
    this._rwrLast = { st: 0, bearing: 0, elevation: 0, clock: 12, dist: 0, tti: 0, kind: '', fresh: false, t: -1e9, v: null }; // 印を残す
    this._sp = new THREE.Vector3();
  }

  // 方位（度 −180..180、機首から右が正）を時計の時（1..12）に
  static clock(bearing) { const h = ((Math.round((+bearing || 0) / 30) % 12) + 12) % 12; return h === 0 ? 12 : h; }

  // ---------- RWR ----------
  // 見張り・対空ミサイル（src）が v を探知（'search' / 1）・ロック（'lock' / 2）・発射（'launch' / 3）した。spikeEvery 秒ごとに呼ばれる想定
  spike(v, src, st) {
    if (!v || !src) return;
    const n = st === 'launch' || st === 3 ? 3 : (st === 'lock' || st === 2 ? 2 : (st === 'search' || st === 1 ? 1 : 0));
    let e = null, old = null;
    for (let i = 0; i < this._spk.length; i++) {
      const x = this._spk[i];
      if (x.v === v && x.src === src) { e = x; break; }
      if (!old || x.t < old.t) old = x;
    }
    if (!e) {
      if (this._spk.length < AirCombat.MAX_SPIKES) { e = { v: null, src: null, st: 0, t: 0, x: 0, y: 0, z: 0 }; this._spk.push(e); }
      else e = old;
    }
    const p = AirCombat._srcPos(src, this._sp);
    e.v = v; e.src = src; e.st = n; e.t = this.g.time || 0;
    if (p) { e.x = p.x; e.y = p.y; e.z = p.z; }
    if (n === 3 && this.g.vehicle === v) this.g._rwrT = 0; // 発射: すぐ警告音
  }

  static _srcPos(src, out) {
    if (!src) return null;
    if (src.pos && typeof src.pos.x === 'number') return out.copy(src.pos);
    if (Array.isArray(src.p)) return out.set(src.p[0], src.p[1], src.p[2]);
    if (typeof src.x === 'number') return out.set(src.x, src.y || 0, src.z);
    return null;
  }

  // v の機首から見た (x, y, z) の方位・仰角を o に
  static _bearing(v, c, x, y, z, o) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    let fx = 0, fz = 1;
    if (typeof v.yaw === 'number' && isFinite(v.yaw)) { fx = Math.sin(v.yaw); fz = Math.cos(v.yaw); }
    o.bearing = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180 / Math.PI;
    o.elevation = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
    o.dist = Math.hypot(dx, dy, dz);
    return o;
  }

  // 来るミサイル（missiles + weapons2 の ordnance。tti の短い方）。v.incoming の中身
  incomingFor(v) {
    const g = this.g;
    let inc = g.missiles ? g.missiles.incomingFor(v) : null;
    const ord = g.ordnance && typeof g.ordnance.incoming === 'function' ? g.ordnance.incoming(v) : null; // weapons2 のロケット（あれば）
    if (ord && (!inc || (ord.tti != null ? ord.tti : Infinity) < (inc.tti != null ? inc.tti : Infinity))) inc = ord;
    return inc;
  }

  // v の RWR の 1 つ（使い回し）か null。inc = incomingFor(v)（呼んだ側が持っていれば渡す）
  rwrFor(v, inc) {
    const g = this.g, now = g.time || 0;
    if (!v) return null;
    if (inc === undefined) inc = this.incomingFor(v);
    const RC = (v.def && v.def.rwr) || AirCombat.RWR;
    const mk = RC.markerSec != null ? RC.markerSec : AirCombat.RWR.markerSec, hold = RC.spikeHold != null ? RC.spikeHold : AirCombat.RWR.spikeHold;
    const R = this._rwr;
    R.st = 0; R.fresh = false; R.kind = '';
    if (inc) {
      R.st = 3; R.kind = 'missile'; R.bearing = +inc.bearing || 0; R.elevation = +inc.elevation || 0; R.dist = inc.dist; R.tti = inc.tti;
    }
    // spike（探知・ロック・発射）: 来ているもの（rwr.spikeHold 秒以内）の一番強い・近いもの
    if (R.st < 3 && this._spk.length) {
      let best = null, bd = Infinity;
      for (let i = 0; i < this._spk.length; i++) {
        const e = this._spk[i];
        if (e.v !== v || now - e.t > hold) continue; // 信号が来ている間（spikeHold 秒以内。その後は印だけ markerSec 秒）
        const d = Math.hypot(e.x - v.pos.x, e.y - v.pos.y, e.z - v.pos.z);
        if (!best || e.st > best.st || (e.st === best.st && d < bd)) { best = e; bd = d; }
      }
      if (best && best.st > R.st) {
        const c = typeof v.center === 'function' ? v.center(this._c) : this._c.copy(v.pos);
        AirCombat._bearing(v, c, best.x, best.y, best.z, R);
        R.st = best.st; R.kind = 'spike'; R.tti = 0;
      }
    }
    const Lr = this._rwrLast;
    if (R.st > 0) {
      R.fresh = true; R.t = now;
      Lr.st = R.st; Lr.bearing = R.bearing; Lr.elevation = R.elevation; Lr.dist = R.dist; Lr.tti = R.tti; Lr.kind = R.kind; Lr.t = now; Lr.v = v;
    } else if (Lr.v === v && now - Lr.t <= mk && Lr.st > 0) {
      // 信号が消えた後も markerSec 秒は印を残す（音は鳴らさない）
      R.st = Lr.st; R.bearing = Lr.bearing; R.elevation = Lr.elevation; R.dist = Lr.dist; R.tti = Lr.tti; R.kind = Lr.kind; R.t = Lr.t; R.fresh = false;
    } else return null;
    R.clock = AirCombat.clock(R.bearing);
    return R;
  }

  // RWR の 1 フレーム（乗っている人の機体 v）: g.rwr と音。inc = incomingFor(v)
  rwrTick(dt, v, inc) {
    const g = this.g;
    const on = !!v && g.vehicle === v && !g.player.dead && !v.wrecked;
    const R = on ? this.rwrFor(v, inc) : null;
    g.rwr = R;
    const RC = (v && v.def && v.def.rwr) || AirCombat.RWR;
    let name = null, vol = 0;
    if (R && R.fresh && R.st === 1) { name = 'lock_tone'; vol = RC.searchTone != null ? RC.searchTone : AirCombat.RWR.searchTone; }
    else if (R && R.fresh && R.st === 2) { name = 'lock_solid'; vol = RC.lockTone != null ? RC.lockTone : AirCombat.RWR.lockTone; }
    this._rwrAudio(name, vol);
    // 発射: 警告音（rwrEvery 秒ごと）
    if (R && R.fresh && R.st === 3) {
      const every = (v.def && v.def.flares && v.def.flares.rwrEvery) || 1;
      g._rwrT = (g._rwrT || 0) - dt;
      if (g._rwrT <= 0 && g.audio && typeof g.audio.play === 'function') { g._rwrT = every; g.audio.play('rwr_warning', { priority: 2, channel: 'self', volume: 0.8 }); }
    } else if (g._rwrT < 0) g._rwrT = 0;
    return R;
  }

  // RWR の探知 / ロックの音（2D のループ 1 つ）。tone = 鳴らしたい大きさ（LEVELS をかけた後の値 = searchTone / lockTone）
  _rwrAudio(name, tone) {
    if (name === this._rwrName) return;
    if (this._rwrLoop) { try { this._rwrLoop.stop(0.08); } catch (e) { /* ignore */ } this._rwrLoop = null; }
    this._rwrName = name;
    const A = this.g.audio;
    if (!name || !A) return;
    let lv = 1;
    try { if (typeof A._level === 'function') lv = A._level(name) || 1; } catch (e) { lv = 1; }
    const vol = Math.max(0.01, Math.min(1, tone / lv));
    try {
      if (typeof A.loop === 'function') this._rwrLoop = A.loop(name, { bus: 'sfx', volume: vol });
      else if (typeof A.play === 'function') this._rwrLoop = A.play(name, { loop: true, priority: 2, channel: 'self', volume: vol, synth: false }) || null;
    } catch (e) { this._rwrLoop = null; }
  }
  get rwrSound() { return this._rwrName; }

  // 止まっている間（設定の板）: ロックと RWR の音を止める（印は残す）
  quiet() { this.idle(); if (this._rwrName) this._rwrAudio(null, 0); }

  // 乗り物の外（歩き・死亡）: RWR の音を止め、印を消す
  rwrOff() { if (this._rwrName) this._rwrAudio(null, 0); this.g.rwr = null; this._rwrLast.v = null; }

  // 目標 t の狙いやすさ（小さいほどよい）か null。c = 機体の重心、fwd = 速度の向き（単位）、MC = 機体の missile。needLos: lockKeep° 以内なら見えるか確かめる
  //   out = { ang, dist, s }（使い回し）。ray(o, d, maxT, out) は遠くまで届くレイ（game._jetRay）。self = 撃つ機体
  static score(t, c, fwd, MC, needLos, ray, self, tp, ld, hit, out) {
    const Ms = MR.Missiles;
    if (!Ms.alive(t) || t === self) return null;
    Ms.targetPos(t, tp);
    const dx = tp.x - c.x, dy = tp.y - c.y, dz = tp.z - c.z, dist = Math.hypot(dx, dy, dz);
    if (dist < MC.lockMin || dist > MC.lockRange) return null;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dist))) * 180 / Math.PI;
    if (needLos && ang <= MC.lockKeep && ray) {
      // 見えるか（機体から目標まで建物・地面にさえぎられない。missile.lockClear m の手前まで）
      ld.set(dx / dist, dy / dist, dz / dist);
      const h = ray(c, ld, dist, hit);
      if (h && h.t < dist - MC.lockClear) return null;
    }
    out.ang = ang; out.dist = dist;
    out.s = ang / MC.lockCone + dist / MC.lockRange * 0.5 - (t.kind === 'heli' || (t.kind === 'jet' && t.mode === 'air') || (t.kind === 'vtol' && !t.grounded) ? 0.3 : 0);
    return out;
  }

  _score(t, needLos, v, MC) {
    const g = this.g;
    return AirCombat.score(t, this._c, this._fwd, MC, needLos, g._jetRayFn || (g._jetRayFn = (o, d, m, out) => g._jetRay(o, d, m, out)), v, this._tp, this._ld, this._hit, this._sc);
  }

  // 操縦席の 1 フレーム（game._updateJetWeapons から）
  update(dt, v) {
    const g = this.g, inp = g.input, d = v.def, MC = d.missile, FC = d.flares;
    const pilot = !(g.vehicleSeat > 0) && !g.player.dead && !v.wrecked;
    if (!g.missiles && MR.Missiles) g.missiles = g._makeMissiles();
    const wantM = typeof inp.consumeMissile === 'function' && inp.consumeMissile();
    const wantF = typeof inp.consumeFlare === 'function' && inp.consumeFlare();
    if (g.online) { g._jetLock = null; g.bombCue = null; v.incoming = null; this.idle(); this.rwrOff(); return; } // オンライン（E4.3 まで撃たない。ダメージはサーバー = D10）
    // ロック（空中、操縦席だけ。向きは速度の向き = _fwd）
    if (AirCombat.inAir(v)) this._fwd.copy(v.vel).normalize();
    const L = this._lockTick(dt, v, pilot, MC);
    const stores = v.missileCount + (v.bombCount || 0); // ミサイル + 滑空爆弾（E2.5）
    // ロックの音: うなり（ロック中）→ はっきりした音（ロックした）
    this._lockAudio(L ? (L.locked ? 'lock_solid' : 'lock_tone') : null);
    // 滑空爆弾の照準（E2.5。HUD の「GBU 2」と落ちる所の印 = g.bombCue。落とせる範囲のときだけ ok）
    this._bombTick(dt, v, pilot, L);
    // ミサイル
    g._missileCool = Math.max(0, (g._missileCool || 0) - dt);
    if (wantM && pilot) {
      if (!AirCombat.inAir(v)) g.hud.showMessage('ミサイルは飛んでいるときに撃てます', 1000);
      else if (stores <= 0) g.hud.showMessage('ミサイルがありません（' + AirCombat._rearmWhere(v) + 'で補給）', 1200);
      else if (g._missileCool <= 0 && g.missiles) this._fire(v, L, MC);
    }
    // フレア（ボタン・自動）
    g._flareCool = Math.max(0, (g._flareCool || 0) - dt);
    const inc = this.incomingFor(v);
    v.incoming = inc;
    const autoF = pilot && g.jetAutoFlare && inc && (inc.dist < FC.autoRange || inc.tti < FC.autoTime);
    if ((wantF || autoF) && pilot && g._flareCool <= 0 && AirCombat.inAir(v)) {
      const n = v.takeFlares(FC.burst);
      if (n > 0 && g.missiles) { g.missiles.popFlares(v, n); g._flareCool = FC.cooldown; g.jetFlaresPopped = (g.jetFlaresPopped || 0) + n; if (autoF && !wantF) g.jetAutoFlares = (g.jetAutoFlares || 0) + 1; }
      else if (wantF && n <= 0) g.hud.showMessage('フレアがありません', 900);
    }
    // RWR（方位の印・探知 / ロックの音・発射の警告音 rwrEvery 秒ごと）
    this.rwrTick(dt, v, inc);
  }

  // ロックの 1 フレーム（update / updateVtol から）。this._fwd（向き = 戦闘機は速度・VTOL は _vtolAimDir）を先に置いてから呼ぶ。g._jetLock を返す
  _lockTick(dt, v, pilot, MC) {
    const g = this.g;
    let L = g._jetLock;
    //  自動着艦・着陸の間はロックしない（最終進入でスマホの横の「ロック 240 m」が案内の板と右の列に重なっていた。撃つ場面でもない）
    const stores = v.missileCount + (v.bombCount || 0); // ミサイル + 滑空爆弾（E2.5）
    if (!pilot || !AirCombat.inAir(v) || stores <= 0 || v.autoland) { L = g._jetLock = null; }
    else {
      v.center(this._c);
      // 保つ: lockKeep° 以内（見えなくなっても lockHide 秒は保つ）
      //  対空の陣地は黙った・見えている時間が終わったら外す（探すときの lockables と同じ）
      if (L && L.target && L.target.isAASite && !(g.airDefense && g.airDefense.isRevealed(L.target))) L = g._jetLock = null;
      if (L) {
        const sc = this._score(L.target, false, v, MC);
        if (sc) {
          const ang = sc.ang, dist = sc.dist;
          if (g.time - (L.losT || 0) > 0.25) { L.losT = g.time; L.seen = this._score(L.target, true, v, MC) ? g.time : (L.seen || g.time); }
          if (ang > MC.lockKeep || g.time - (L.seen || g.time) > MC.lockHide) L = g._jetLock = null; else { L.dist = dist; L.ang = ang; }
        } else L = g._jetLock = null;
      }
      // 一番よい目標（lockScan 秒ごとに探す）
      g._lockScanT = (g._lockScanT || 0) - dt;
      if (g._lockScanT <= 0) {
        g._lockScanT = MC.lockScan;
        let best = null;
        const bs = this._best;
        //  止めてある無人の戦闘機（空母の甲板の味方の機体）はロックしない（着艦・低空で甲板の j_2 をロックして、ミサイルが外れて街の建物へ飛んでいた）
        for (let i = 0; i < g.vehicles.length; i++) {
          const o = g.vehicles[i];
          if (o.sunk || o.wrecked || o === v || (o.kind === 'jet' && o.mode !== 'air' && !o.driver) || (o.kind === 'vtol' && !o.driver)) continue; // 無人の VTOL（止めてある・物語の 七号機 が飛んでいる）も味方
          const sc = this._score(o, true, v, MC);
          if (sc && sc.ang <= MC.lockCone && (!best || sc.s < bs.s)) { best = o; bs.ang = sc.ang; bs.dist = sc.dist; bs.s = sc.s; }
        }
        for (let i = 0; i < g.enemies.length; i++) {
          const e = g.enemies[i];
          if (e.dead) continue;
          const sc = this._score(e, true, v, MC);
          if (sc && sc.ang <= MC.lockCone && (!best || sc.s < bs.s)) { best = e; bs.ang = sc.ang; bs.dist = sc.dist; bs.s = sc.s; }
        }
        //  対空の陣地（撃って見えている間だけ = airDefense.lockables。地上の目標）
        const ads = g.airDefense ? g.airDefense.lockables() : null;
        if (ads) for (let i = 0; i < ads.length; i++) {
          const sc = this._score(ads[i], true, v, MC);
          if (sc && sc.ang <= MC.lockCone && (!best || sc.s < bs.s)) { best = ads[i]; bs.ang = sc.ang; bs.dist = sc.dist; bs.s = sc.s; }
        }
        const ls = g._lockScan || (g._lockScan = { best: null, ang: null, n: 0 });
        ls.best = best ? (best.cityId || best.kind || 'enemy') : null; ls.ang = best ? +bs.ang.toFixed(1) : null; ls.n = g.vehicles.length;
        if (best && (!L || (L.target !== best && !L.locked))) L = g._jetLock = { target: best, t: 0, locked: false, dist: bs.dist, ang: bs.ang, seen: g.time, losT: g.time };
      }
      if (L && !L.locked) {
        L.t += dt;
        if (L.t >= MC.lockTime) L.locked = true;
      }
    }
    return L;
  }

  // VTOL（V3）の操縦席の 1 フレーム（game._updateVtolWeapons から。wantM = 撃つ = 扉が開いてから）: 向き（_fwd）は game._vtolAimDir
  //   （ホバー = 見ている向き、巡航 = 速度の向き）→ ロック → ロックの音 → 爆弾の落ちる所 → 撃つ。フレアと RWR はこの後の updateHeli
  updateVtol(dt, v, wantM) {
    const g = this.g, MC = v.def.missile;
    const pilot = !(g.vehicleSeat > 0) && !g.player.dead && !v.wrecked;
    if (!g.missiles && MR.Missiles) g.missiles = g._makeMissiles();
    if (g.online) { g._jetLock = null; g.bombCue = null; this.idle(); return; }
    if (typeof g._vtolAimDir === 'function') g._vtolAimDir(v, this._fwd); else this._fwd.copy(v.vel).normalize();
    const L = this._lockTick(dt, v, pilot, MC);
    this._lockAudio(L ? (L.locked ? 'lock_solid' : 'lock_tone') : null);
    this._bombTick(dt, v, pilot, L);
    g._missileCool = Math.max(0, (g._missileCool || 0) - dt);
    if (wantM && pilot) {
      const stores = v.missileCount + (v.bombCount || 0);
      if (!AirCombat.inAir(v)) g.hud.showMessage('ミサイルは飛んでいるときに撃てます', 1000);
      else if (stores <= 0) g.hud.showMessage('ミサイルがありません（' + AirCombat._rearmWhere(v) + 'で補給）', 1200);
      else if (g._missileCool <= 0 && g.missiles) this._fire(v, L, MC, this._fwd);
    }
  }
  static _rearmWhere(v) { return (v && v.def && v.def.rearmHint) || '空母'; }

  // ヘリ（守るだけ = D4。ロックも撃つも無し）: 操縦席・空中でフレア（ボタン / X / 自動。自動は戦闘機と同じ設定 jetAutoFlare）と RWR。
  //  オンライン（E4.3 まで）はフレアを使わない（押したものは捨てる）
  updateHeli(dt, v) {
    const g = this.g, inp = g.input, FC = v.def.flares || AirCombat.HELI_FLARES;
    const pilot = !(g.vehicleSeat > 0) && !g.player.dead && !v.wrecked;
    const air = AirCombat.heliAir(v);
    const wantF = typeof inp.consumeFlare === 'function' && inp.consumeFlare();
    if (typeof inp.consumeMissile === 'function') inp.consumeMissile(); // F は乗り降りと同じキー（ヘリにミサイルは無い）
    const inc = this.incomingFor(v);
    v.incoming = inc;
    g._flareCool = Math.max(0, (g._flareCool || 0) - dt);
    if (!g.online && pilot && air && typeof v.takeFlares === 'function') {
      const autoF = g.jetAutoFlare && inc && (inc.dist < FC.autoRange || inc.tti < FC.autoTime);
      if ((wantF || autoF) && g._flareCool <= 0) {
        const n = v.takeFlares(FC.burst);
        if (n > 0 && g.missiles) { g.missiles.popFlares(v, n); g._flareCool = FC.cooldown; g.heliFlaresPopped = (g.heliFlaresPopped || 0) + n; if (autoF && !wantF) g.heliAutoFlares = (g.heliAutoFlares || 0) + 1; }
        else if (wantF && n <= 0) g.hud.showMessage('フレアがありません', 900);
      }
    }
    this.rwrTick(dt, v, inc);
  }

  // ヘリが飛んでいる（フレア・#hud.heli-air）: 地上・水の上・壊れた・沈んでいるは除く
  static heliAir(v) { return !!v && !v.grounded && !v.wrecked && !v.sinking && !(v.floatT >= 0); }
  // 空中か（ロック・撃つ・爆弾の落ちる所）: VTOL・ヘリは heliAir、戦闘機は mode === 'air'
  static inAir(v) { return !!v && (v.kind === 'vtol' || v.kind === 'heli' ? AirCombat.heliAir(v) : v.mode === 'air'); }

  // 撃つ: 型を選んで（D2）翼の下から。ロックが無ければ照準の先を狙う点に
  //   dirIn（任意）: 撃つ向き（VTOL のホバー = 見ている向き。無ければ速度の向き）
  _fire(v, L, MC, dirIn) {
    const g = this.g, Ms = g.missiles;
    const tgt = L && L.locked ? L.target : null;
    const dir = dirIn ? this._dir.copy(dirIn).normalize() : this._dir.copy(v.vel).normalize();
    let kind = 'ground', dist = 0, off = 0, aim = null;
    if (tgt) {
      MR.Missiles.targetPos(tgt, this._tp);
      v.center(this._c);
      const dx = this._tp.x - this._c.x, dy = this._tp.y - this._c.y, dz = this._tp.z - this._c.z;
      dist = Math.hypot(dx, dy, dz) || 1;
      off = Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dy * dir.y + dz * dir.z) / dist))) * 180 / Math.PI;
      kind = MR.Missiles.isAir(tgt) ? 'air' : 'ground';
    } else {
      // 照準の先: 速度の向きのレイ（建物・地面・水）。当たらなければまっすぐ
      v.center(this._c);
      const range = Ms.typeCfg('aim120').maxRange || MC.lockRange || 3000;
      const h = g._jetRay(this._c, dir, range, this._hit);
      if (h && !h.water && h.t > (MC.lockMin || 150) * 0.5) { aim = this._aim.set(h.x, h.y, h.z); dist = h.t; }
    }
    // 滑空爆弾（E2.5）: 地上の目標（ロック）か落ちる所（CCIP）が落とせる範囲なら pickType が先に選ぶ（空の目標には渡さない）
    const rel = kind !== 'air' && (v.bombCount || 0) > 0 ? this._bombRel(v, tgt, true) : null;
    const type = MR.MissileCore ? MR.MissileCore.pickType(Ms.cfg, v.missileCounts(), kind, dist, off, rel && rel.has ? rel : null) : null;
    if (!type) { g.hud.showMessage(v.missileCount <= 0 && (v.bombCount || 0) > 0 ? 'ミサイルがありません（GBU は地上へ・高度 ' + AirCombat._relText(Ms.typeCfg(this._bombType(v))) + '）' : 'ミサイルがありません（' + AirCombat._rearmWhere(v) + 'で補給）', 1400); return; }
    const bomb = typeof v.isBombType === 'function' && v.isBombType(type);
    if (bomb && !tgt) aim = this._aim.copy(rel.point); // ロック無し: 落ちる所へ
    const from = v.takeMissile(type, this._from);
    if (!from) return;
    const o = this._fireOpts;
    o.from = from; o.vel = v.vel; o.dir = dir; o.target = tgt; o.owner = v; o.type = type; o.aim = aim;
    Ms.fire(o);
    o.from = null; o.vel = null; o.target = null; o.owner = null; o.aim = null;
    g._missileCool = MC.cooldown;
    g.jetMissilesFired = (g.jetMissilesFired || 0) + 1;
    g.lastMissileType = type;
    if (bomb) g.jetBombsDropped = (g.jetBombsDropped || 0) + 1;
    g.hud.showMessage(bomb ? (tgt ? '爆弾投下（ロック）' : '爆弾投下') : (tgt ? 'ミサイル発射（ロック）' : 'ミサイル発射'), 800);
  }

  // ---------- 滑空爆弾（E2.5）----------
  _bombType(v) { const B = v && v.def && v.def.bombs && v.def.bombs.loadout; return B && B.length ? B[0][1] : 'gbu16'; }
  static _relText(tc) { const R = (tc && tc.release) || {}; return (R.minAgl != null ? R.minAgl : 200) + '〜' + (R.maxAgl != null ? R.maxAgl : 650) + ' m'; }

  // 落とす条件 { has, ok, agl, dive, hd, point, ground }（使い回し）か null。tgt = ロックした地上の目標（無ければ落ちる所 = CCIP）。
  //  fresh: 落ちる所を今計算する（撃つとき）。ほかは ccipEvery 秒ごと（レイを何本も引くので）
  _bombRel(v, tgt, fresh) {
    const g = this.g, Ms = g.missiles;
    if (!Ms || !v || (v.bombCount || 0) <= 0 || !AirCombat.inAir(v) || (v.bombReady && !v.bombReady())) return null; // VTOL: 扉が開いていないと落とせない
    const tc = Ms.typeCfg(this._bombType(v));
    const R = this._rel || (this._rel = { has: false, ok: false, agl: 0, dive: 0, hd: 0, point: new THREE.Vector3(), ground: false, t: -1e9 });
    const sp = v.vel.length() || 1;
    R.agl = Math.max(0, v.agl || 0);
    R.dive = sp > 5 ? -Math.asin(Math.max(-1, Math.min(1, v.vel.y / sp))) * 180 / Math.PI : 0; // ホバー（VTOL）: 止まっていれば水平（ほぼ 0 の速度の向きで ±90° にしない）
    const wasGround = R.ground;
    R.ground = !!tgt;
    if (tgt) { MR.Missiles.targetPos(tgt, R.point); R.has = true; }
    else if (!MR.MissileCore.releaseOk(tc, { agl: R.agl, dive: R.dive, hd: 0 })) { R.has = false; R.t = -1e9; } // 高さ・降下角が範囲の外: レイを引かない
    else {
      const every = tc.ccipEvery != null ? tc.ccipEvery : 0.1;
      if (fresh || wasGround || (g.time || 0) - R.t >= every) { R.t = g.time || 0; R.has = this._ccip(v, tc, R.point); }
    }
    R.hd = R.has ? Math.hypot(R.point.x - v.pos.x, R.point.z - v.pos.z) : 0;
    R.ok = R.has && MR.MissileCore.releaseOk(tc, R);
    return R;
  }

  // 落ちる所（CCIP）: 機体の速さで放した爆弾が重力と抗力（tc.drag）だけで落ちる道すじを ccipStep 秒ずつ進めて、建物・地面に当たる所。
  //  水・当たらない（tc.life 秒まで）は false
  _ccip(v, tc, out) {
    const g = this.g;
    if (typeof g._jetRay !== 'function') return false;
    const G = 9.81, k = tc.drag || 0, dt = tc.ccipStep || 0.5, T = tc.life || 45;
    const p = v.center(this._c), vel = this._ld.copy(v.vel), o = this._tp, d = this._dir2 || (this._dir2 = new THREE.Vector3());
    for (let t = 0; t < T; t += dt) {
      o.copy(p);
      const sp = vel.length();
      vel.y -= G * dt;
      if (sp > 1e-3) vel.multiplyScalar(Math.max(0, 1 - k * sp * dt));
      p.addScaledVector(vel, dt);
      d.subVectors(p, o);
      const len = d.length();
      if (len < 1e-3) continue;
      d.multiplyScalar(1 / len);
      const h = g._jetRay(o, d, len, this._hit);
      if (h) { if (h.water) return false; out.set(h.x, h.y, h.z); return true; }
    }
    return false;
  }

  // 毎フレーム: g.bombCue（HUD の「GBU n」と、落とせる範囲なら落ちる所の印）
  _bombTick(dt, v, pilot, L) {
    const g = this.g;
    const n = v.bombCount || 0;
    if (!pilot || !AirCombat.inAir(v) || n <= 0 || v.autoland) { g.bombCue = n > 0 && AirCombat.inAir(v) ? this._cueOf(n, null) : null; return; }
    const tgt = L && L.locked && L.target && !MR.Missiles.isAir(L.target) ? L.target : null;
    const air = L && L.locked && L.target && MR.Missiles.isAir(L.target);
    const R = air ? null : this._bombRel(v, tgt, false);
    g.bombCue = this._cueOf(n, R && R.ok ? R : null);
  }
  _cueOf(n, R) {
    const c = this._cue || (this._cue = { n: 0, ok: false, point: new THREE.Vector3(), locked: false });
    c.n = n; c.ok = !!R; c.locked = !!(R && R.ground);
    if (R) c.point.copy(R.point);
    return c;
  }

  // ロックの音を name にする（null = 止める）。2D のループ 1 つだけ（上限に数えないので自分で 1 つにする = §5.3）
  _lockAudio(name) {
    if (name === this._loopName) return;
    if (this._loop) { try { this._loop.stop(0.08); } catch (e) { /* ignore */ } this._loop = null; }
    this._loopName = name;
    const A = this.g.audio;
    if (!name || !A) return;
    try {
      if (typeof A.loop === 'function') this._loop = A.loop(name, { bus: 'sfx', volume: 0.8 });
      else if (typeof A.play === 'function') this._loop = A.play(name, { loop: true, priority: 2, channel: 'self', volume: 0.8, synth: false }) || null;
    } catch (e) { this._loop = null; }
  }
  get lockSound() { return this._loopName; }

  // 戦闘機の操縦席でない（降りた・死んだ・ヘリ・歩き）: ロックの音を止める
  idle() { if (this._loopName) this._lockAudio(null); }

  dispose() { this._lockAudio(null); this._rwrAudio(null, 0); this._spk.length = 0; this._rwrLast.v = null; }
};
MR.AirCombat.MAX_SPIKES = 8;
MR.AirCombat.RWR = { searchTone: 0.08, lockTone: 0.14, markerSec: 2.5, spikeHold: 1 }; // spikeHold = spike が来ていると見なす秒（呼ぶ側は 0.5 秒ごと）
MR.AirCombat.HELI_FLARES = { count: 30, burst: 2, cooldown: 1.5, reloadTime: 12, autoRange: 1500, autoTime: 3.5, rwrEvery: 1 };
