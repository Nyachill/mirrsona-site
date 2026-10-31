// VTOL の貨物室に車を積む（MR.VtolCargo。V2c。dev-notes/plans/vtol-ramp-cargo-spec.md §3〜§5 + 「Orchestrator decisions」）。
//   vtol.js の MR.Vtol（host）が毎フレーム呼ぶ（step = 積む / 降ろすの動き・follow = 積んだ車を機体に付けて置く）。THREE を使う（ゲームの中だけ）。
//   数値: 形は assets/levels/vtol.json の cabin.cargo（slots[0]・zone・alignZ・exitClear・autoExit・lane）と cabin.profile、
//         遊びの数は game.json の vehicles.types.vtol.cargo（captureEvery・zoneAngle・zoneSpeed・速さ・unloadStick …）。コードに数を書かない。
// ■ 積む（ソロの街。載るのはジープだけ: Vtol.cargoFits = 幅 maxW・高さ maxH・長さ maxLen・後ろの軸が蝶番の axleBehindHingeMax m より前）:
//   運転している車が傾斜板の後ろの枠（機体の座標で先の軸 = 進む側の軸の真ん中が |x| ≤ zone.halfW・z zone.z0〜z1）に、機首の向き（前から）か
//   逆向き（allowReverse = 後ろから）の zoneAngle° 以内・zoneSpeed m/s 以下で入る（captureEvery 秒ごとに見る）→ 機体が着陸して水平・止まっている・
//   動く船の上でない・傾斜板が開いている（閉じていれば開ける）・車の足元と通り道が平ら（footTol）・空き → 決まった道（3 次の曲線で中心線へ → まっすぐ
//   傾斜板を上がって貨物室の置き場所）を時刻の関数で走る（積み込み中: 運転はできない・降りられない。20 / 30 / 60 fps で同じ）。止まったら 'stowed':
//   運転手は左舷の通路（autoExit）に立つ（autoExitDriver）→ 歩いて操縦席へ。
// ■ 運ぶ: 'stowed' の車は物理を回さず（Vehicle.update が carrier を見て返す）、機体の位置・向き（傾き込み）× 置き場所の姿勢（傾斜板の今の角度で
//   後ろの車輪の高さが変わる）に置く。ほかの車・敵・プレイヤーの押し出し・歩行グラフの動く箱・チャンクの出し入れ・ミニマップから外す。
//   見えるのは傾斜板が開いているか、カメラが機体の箱の中にあるときだけ（4.3）。
// ■ 降ろす: 着陸して水平・止まっている所で、機内から積んだ車に乗って（いつもの「乗る」）スティックを外へ（前から積んだ車は下・後ろから積んだ車は上）
//   unloadStick より倒して unloadHold 秒 → 傾斜板が開いていなければ開ける → 足元・通り道（lane: |x| ≤ lane.halfW、傾斜板の先から
//   z0(L) = footZ − 長さ − exitClear − lane.pad まで）が平らで空いていれば、中心線をまっすぐ下りて傾斜板の先から exitClear m 先で手を放す
//   （速さ exitSpeed m/s で外へ。そこからはふつうに運転）。だめなら「ランプの後ろがふさがっています」/「ここでは車を降ろせません」。
// ■ 端: 積んだ車が壊れた → 残骸は付いたまま、機体に blastHostDamage、残骸の時間が来たら外して家へ。機体が壊れた（onHostDestroyed 'wreck'）→ 車は外れて
//   機体の速さで落ちる残骸に（2 回目の爆発なし）。機体の respawn → 先に外して車も家へ。続きから・チャンクの出し入れは機体と一緒（game.js / session.js）。
// ■ 決まり: 1 つの置き場所（maxCars）。2 台目は「貨物室はいっぱいです」。積み込み・降ろす途中は傾斜板を閉じない・浮かない（canLiftOff）。
//   歩く人・敵は動く車の箱から押し出す。止まっている乗り物が道にあれば holdMax 秒待ってから押す。どの動きも Tmax（表の終わり + holdMax）で終わる。
if (typeof window !== 'undefined' && window.THREE && window.MR) (function () {
  const MR = window.MR;
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const HANDLES = [0.25, 0.4, 0.55, 0.7]; // 積み込みの曲線の手の長さの候補（曲線の長さの割合）
  const TABLE_DT = 1 / 120; // 速さの表の刻み（積み込みの時刻 → 道の長さ。フレームの長さによらない）
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  const isCar = (v) => !!v && !v.kind && !v.disposed;
  // 載せられるか（データだけ）: null = 載る、{ why, msg }
  function fits(def, slot) {
    if (!def || !slot) return { why: 'none', msg: 'ここでは積めません' };
    if (def.cargo === false) return { why: 'type', msg: 'この車は積めません' };
    const L = def.length, W = def.width, H = def.height, wb = def.wheelbase || L * 0.6;
    if (W > slot.maxW) return { why: 'width', msg: 'この車は大きすぎて積めません（幅 ' + W.toFixed(2) + ' m / 最大 ' + slot.maxW.toFixed(2) + ' m）' };
    if (L > slot.maxLen) return { why: 'length', msg: 'この車は大きすぎて積めません（長さ ' + L.toFixed(1) + ' m / 最大 ' + slot.maxLen.toFixed(1) + ' m）' };
    if (H > slot.maxH) return { why: 'height', msg: 'この車は大きすぎて積めません（高さ ' + H.toFixed(2) + ' m / 最大 ' + slot.maxH.toFixed(2) + ' m）' };
    const rearAxle = slot.zFront - L / 2 - wb / 2, hinge = -6.6;
    if (rearAxle < hinge - slot.axleBehindHingeMax) return { why: 'axle', msg: 'この車は長すぎて積めません（長さ ' + L.toFixed(1) + ' m）' };
    return null;
  }

  // 形（vtol.json）と数（game.json）
  function data(host) { const C = host.cabin; return C && C.cargo && C.cargo.slots && C.cargo.slots.length ? C.cargo : null; }
  // 傾斜板の今の角度（rad、正）: openDeg × 板の開き具合（_rampPose の k[1]）
  //   （rampPos から _rampPose と同じ式で。見た目の姿勢を作っていない止めてある機体でも同じ）
  function plateAngle(host) {
    const C = host.cabin, R = host.def.ramp;
    const od = Math.abs(C.ramp && typeof C.ramp.openDeg === 'number' ? C.ramp.openDeg : host.def.rampDeg);
    const t = clamp((host.rampPos - R.plateFrom) / ((R.plateTo - R.plateFrom) || 1e-6), 0, 1);
    return od * D2R * t * t * (3 - 2 * t);
  }
  // 機体の座標の z での車の通る面の高さ（機体の座標の y）: 床（edgeZ より前）・傾斜板（今の角度）・地面 0（先より後ろ）
  function surfY(host, z, ang) {
    const P = host.cabin.profile;
    if (z >= P.edgeZ) return P.floorY;
    return Math.max(0, P.floorY - (P.edgeZ - z) * Math.tan(ang));
  }
  // 置き場所の中心の z（前から積んでも後ろから積んでも同じ所）
  function slotZ(slot, L) { return slot.zFront - L / 2; }

  // ---------- 道（機体の座標の xz。中心が通る）----------
  //   pts: [x, z, s]（s = そこまでの長さ）。3 次の曲線（P0 → A、両端の向き = 今の進む向き / +Z か −Z）+ まっすぐ（A → B）
  //   k0 / k1: 曲線の両端の手の長さ（L1 の割合。省略 1/3）
  function buildPath(p0x, p0z, d0x, d0z, ax, az, bx, bz, n1, k0, k1) {
    const pts = [];
    const L1 = Math.hypot(ax - p0x, az - p0z), ka = L1 * (k0 == null ? 1 / 3 : k0), kb = L1 * (k1 == null ? 1 / 3 : k1);
    const tz = bz >= az ? 1 : -1; // まっすぐの向き
    const c1x = p0x + d0x * ka, c1z = p0z + d0z * ka, c2x = ax, c2z = az - tz * kb;
    let s = 0, px = p0x, pz = p0z;
    pts.push(p0x, p0z, 0);
    const n = L1 > 0.05 ? n1 : 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * p0x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ax;
      const z = u * u * u * p0z + 3 * u * u * t * c1z + 3 * u * t * t * c2z + t * t * t * az;
      s += Math.hypot(x - px, z - pz); pts.push(x, z, s); px = x; pz = z;
    }
    const sA = s;
    const L2 = Math.hypot(bx - px, bz - pz), n2 = Math.max(1, Math.ceil(L2 / 0.25));
    for (let i = 1; i <= n2; i++) { const t = i / n2, x = px + (bx - px) * t, z = pz + (bz - pz) * t; pts.push(x, z, s + L2 * t); }
    return { pts, len: s + L2, sA };
  }
  // 道の点・進む向き（s の所）
  function pathAt(path, s, out) {
    const P = path.pts, n = P.length / 3;
    s = clamp(s, 0, path.len);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m * 3 + 2] <= s) lo = m; else hi = m; }
    const s0 = P[lo * 3 + 2], s1 = P[hi * 3 + 2], t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    out.x = P[lo * 3] + (P[hi * 3] - P[lo * 3]) * t; out.z = P[lo * 3 + 1] + (P[hi * 3 + 1] - P[lo * 3 + 1]) * t;
    // 向き: 前後の区間の向きを混ぜる（曲がり目で急に変わらない）
    const dir = (i) => { const a = clamp(i, 0, n - 2); const dx = P[(a + 1) * 3] - P[a * 3], dz = P[(a + 1) * 3 + 1] - P[a * 3 + 1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const d0 = dir(lo - (t < 0.5 ? 1 : 0)), d1 = dir(lo + (t < 0.5 ? 0 : 1)), w = t < 0.5 ? t + 0.5 : t - 0.5;
    const tx = d0[0] + (d1[0] - d0[0]) * w, tz = d0[1] + (d1[1] - d0[1]) * w, tl = Math.hypot(tx, tz) || 1;
    out.tx = tx / tl; out.tz = tz / tl;
    return out;
  }
  // 曲がり方の一番きつい所（1/m）: 3 次の曲線の部分の点の向きの変わり方
  function maxCurv(path) {
    const P = path.pts, n = P.length / 3;
    let m = 0;
    for (let i = 1; i < n - 1; i++) {
      if (P[i * 3 + 2] > path.sA + 0.01) break;
      const ax = P[i * 3] - P[(i - 1) * 3], az = P[i * 3 + 1] - P[(i - 1) * 3 + 1], bx = P[(i + 1) * 3] - P[i * 3], bz = P[(i + 1) * 3 + 1] - P[i * 3 + 1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-4 || lb < 1e-4) continue;
      const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      m = Math.max(m, ang / ((la + lb) / 2));
    }
    return m;
  }
  // 速さの表（時刻 → 長さ）: 始めの速さ v0、地面は groundSpeed・傾斜板（sRamp より先）は rampSpeed、accel / decel、終わりの速さ vEnd
  function speedTable(len, v0, sRamp, C, vEnd, rampFirst) {
    const S = [0], V = [v0];
    let s = 0, v = v0, guard = 0;
    while (s < len - 1e-4 && guard++ < 20000) {
      const onRamp = rampFirst ? s < sRamp : s >= sRamp;
      let vt = onRamp ? C.rampSpeed : C.groundSpeed;
      // 先の傾斜板の手前で落とす（前から上がる）・終わりで vEnd へ
      if (!rampFirst && s < sRamp) vt = Math.min(vt, Math.sqrt(C.rampSpeed * C.rampSpeed + 2 * C.decel * (sRamp - s)));
      vt = Math.min(vt, Math.sqrt(vEnd * vEnd + 2 * C.decel * Math.max(0, len - s)));
      if (v < vt) v = Math.min(vt, v + C.accel * TABLE_DT); else v = Math.max(vt, v - C.decel * TABLE_DT);
      v = Math.max(v, vEnd > 0 ? 0.3 : 0.15); // 止まりきらない（終わりへ必ず着く）
      s = Math.min(len, s + v * TABLE_DT);
      S.push(s); V.push(v);
    }
    return { S, V, T: (S.length - 1) * TABLE_DT };
  }
  function tableAt(tb, t, out) {
    const f = clamp(t / TABLE_DT, 0, tb.S.length - 1), i = Math.floor(f), j = Math.min(tb.S.length - 1, i + 1), w = f - i;
    out.s = tb.S[i] + (tb.S[j] - tb.S[i]) * w; out.v = tb.V[i] + (tb.V[j] - tb.V[i]) * w;
    return out;
  }

  // ---------- 足元と通り道 ----------
  // 車の足元（傾斜板の先）と通り道（z0(L) まで）が平ら（|地面 − 脚の高さ| ≤ footTol）か: null = よい、'water' | 'ground'
  function footCheck(host, ctx, L) {
    const cd = data(host), C = host.def.cargo, P = host.cabin.profile;
    if (!cd || !ctx) return 'ground';
    const z0 = P.footZ - L - cd.exitClear - cd.lane.pad, hw = cd.lane.halfW;
    for (let z = P.footZ; z >= z0 - 1e-6; z -= 1.5) for (const x of [-hw, 0, hw]) {
      const w = host.toWorld(_v.set(x, 0, z), _v2);
      const S = host._support(ctx, w.x, w.z, host.pos.y + 1.2);
      if (S.y === null) return S.water !== null ? 'water' : 'ground';
      if (Math.abs(S.y - host.pos.y) > C.footTol) return 'ground';
    }
    return null;
  }
  // 降ろす通り道が空いているか（ほかの乗り物の円・歩く人・当たり判定の箱）: null = 空いている、'blocked'
  function laneClear(host, ctx, car) {
    const cd = data(host), C = host.def.cargo, P = host.cabin.profile, L = car.def.length;
    const z0 = P.footZ - L - cd.exitClear - cd.lane.pad, hw = cd.lane.halfW, r = car.hull.r;
    const inLane = (x, z, rr) => { const l = host.toLocal(x, z); return Math.abs(l.x) <= hw + rr && l.z <= P.footZ + rr && l.z >= z0 - rr; };
    for (const o of (ctx && ctx.vehicles) || []) {
      if (!o || o === car || o === host || o.disposed || o.carrier || o.sunk) continue;
      if (Math.abs(o.pos.y - host.pos.y) > 3) continue;
      if (o.hull && o.hull.z) {
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
        for (const zo of o.hull.z) if (inLane(o.pos.x + zo * s, o.pos.z + zo * c, o.hull.r)) return 'blocked';
      } else if (inLane(o.pos.x, o.pos.z, 2)) return 'blocked';
    }
    const w = ctx && ctx.walker;
    if (w && !w.dead && Math.abs(w.pos.y - host.pos.y) < 2 && inLane(w.pos.x, w.pos.z, w.radius || 0.4)) return 'blocked';
    const nav = ctx && ctx.nav;
    if (nav && typeof nav.resolveCircle === 'function') {
      for (let z = P.footZ - 0.5; z >= z0 + L / 2 - 1e-6; z -= 1) for (const x of [-(hw - r) * 0.5, 0, (hw - r) * 0.5]) {
        const p = host.toWorld(_v.set(x, 0, z), _v2), px = p.x, pz = p.z;
        const q = nav.resolveCircle(px, pz, r, host.pos.y, car.def.climb == null ? 0.45 : car.def.climb, car.def.height);
        if (Math.hypot(q.x - px, q.z - pz) > C.clearMargin) return 'blocked';
      }
    }
    return null;
  }

  // ---------- 姿勢 ----------
  // 車の中心の機体の座標 (x, z)・進む向き (tx, tz)・向きの符号 fs（車の前 = fs × 進む向き）→ out { x, y, z, yaw, pitch }（機体の座標）
  function carPose(host, car, x, z, tx, tz, fs, yOff, ang, out) {
    const wb = car.def.wheelbase || car.def.length * 0.6;
    const fx = tx * fs, fz = tz * fs; // 車の前
    const zf = z + fz * wb / 2, zr = z - fz * wb / 2;
    const yf = surfY(host, zf, ang), yr = surfY(host, zr, ang);
    out.x = x; out.z = z; out.y = (yf + yr) / 2 + yOff;
    out.yaw = Math.atan2(fx, fz);
    out.pitch = -Math.atan2(yf - yr, wb);
    return out;
  }
  // 置き場所の姿勢（stowed。傾斜板の今の角度で）
  function stowPose(host, car, dir, out) {
    const cd = data(host), sl = cd.slots[0];
    return carPose(host, car, sl.x, slotZ(sl, car.def.length), 0, 1, dir, 0, plateAngle(host), out);
  }
  // 機体の座標の姿勢 → 世界（位置・向き。機体の傾き込み）を車へ
  function applyPose(host, car, l) {
    host.toWorld(_v.set(l.x, l.y, l.z), car.pos);
    _e.set(l.pitch, l.yaw, 0, 'YXZ');
    _q.copy(host.quat).multiply(_q2.setFromEuler(_e));
    _e.setFromQuaternion(_q, 'YXZ');
    car.yaw = _e.y; car.pitch = _e.x; car.roll = _e.z;
    car._lastY = car.pos.y; car.vy = 0; car.airborne = false;
    car._apply();
  }

  // ---------- 積む・降ろす（host = MR.Vtol）----------
  function msg(host, t, why, text) {
    const C = host.def.cargo, now = host.time;
    const k = t + '|' + (why || '');
    const last = host._cargoMsgT || (host._cargoMsgT = {});
    if (last[k] != null && now - last[k] < C.toastEvery) return;
    last[k] = now;
    const m = host.cargoMsg || (host.cargoMsg = { t: null, why: null, text: null, n: 0 });
    m.t = t; m.why = why || null; m.text = text || null; m.n++;
    host.events.push({ t, why: why || null });
  }
  // 機体が車を受け付けられるか（null = よい、理由）
  function hostReady(host) {
    if (!host.cabin || !data(host) || host.wrecked || host.sinking || host.sunk) return 'none';
    if (!host.grounded || host.speed > host.def.ramp.landedSpeed) return 'air';
    if (!host.levelled) return 'tilt';
    if (host.platform || host._ride) return 'ship';
    return null;
  }

  // 積む動きを作る（チェックは済んでいる）。p0 = 車の中心（機体の座標）、d0 = 進む向き、dir = +1 前から / −1 後ろから
  function makeLoad(host, car, dir, v0) {
    const cd = data(host), C = host.def.cargo, P = host.cabin.profile, sl = cd.slots[0];
    const wb = car.def.wheelbase || car.def.length * 0.6;
    const l = host.toLocal(car.pos.x, car.pos.z);
    const cy = Math.cos(car.yaw - host.yaw), sy = Math.sin(car.yaw - host.yaw);
    let dx = sy * dir, dz = cy * dir; // 進む向き（機体の座標。前から = 車の前、後ろから = 車の後ろ）
    if (dz < 0.2) { dz = 0.2; const n = Math.hypot(dx, dz); dx /= n; dz /= n; }
    const az = Math.max(P.footZ - C.alignPad - wb / 2, l.z + 0.5);
    const bz = slotZ(sl, car.def.length);
    // 曲線の手の長さは曲がり方が一番ゆるいもの（車の回れる半径に収まりやすい）
    let path = null, pc = Infinity;
    for (const k0 of HANDLES) for (const k1 of HANDLES) {
      const q = buildPath(l.x, l.z, dx, dz, sl.x, az, sl.x, bz, 40, k0, k1), c = maxCurv(q);
      if (c < pc - 1e-9) { pc = c; path = q; }
    }
    // 傾斜板にかかる所（先の軸が足元 − 0.3 m）
    let sRamp = path.len;
    const tmp = {};
    for (let s = 0; s <= path.len; s += 0.1) { pathAt(path, s, tmp); if (tmp.z + tmp.tz * wb / 2 >= P.footZ - 0.3) { sRamp = s; break; } }
    const tb = speedTable(path.len, clamp(Math.abs(v0), 0, C.groundSpeed), sRamp, C, 0, false);
    const y0 = (car.pos.y - host.pos.y) - carPose(host, car, l.x, l.z, dx, dz, dir, 0, plateAngle(host), {}).y;
    return { kind: 'load', path, tb, t: 0, hold: 0, dir, fs: dir, y0, sFade: Math.max(1, path.sA), curv: pc, turnR: wb / Math.sin((car.def.maxSteer || 34) * D2R) };
  }
  function makeUnload(host, car, dir) {
    const cd = data(host), C = host.def.cargo, P = host.cabin.profile, sl = cd.slots[0];
    const L = car.def.length, wb = car.def.wheelbase || L * 0.6;
    const z1 = slotZ(sl, L), z2 = P.footZ - L / 2 - cd.exitClear;
    const path = buildPath(sl.x, z1, 0, -1, sl.x, z1, 0, z2, 0);
    let sRamp = 0;
    const tmp = {};
    for (let s = 0; s <= path.len; s += 0.1) { pathAt(path, s, tmp); if (tmp.z + wb / 2 < P.footZ - 0.3) { sRamp = s; break; } }
    const tb = speedTable(path.len, 0, sRamp, C, C.exitSpeed, true);
    return { kind: 'unload', path, tb, t: 0, hold: 0, dir, fs: -dir, y0: 0, sFade: 0 };
  }
  // 動きの今の姿勢（機体の座標）
  const _pa = {}, _ta = {};
  function movePose(host, car, mv, out) {
    tableAt(mv.tb, mv.t, _ta);
    pathAt(mv.path, _ta.s, _pa);
    const yOff = mv.y0 && mv.sFade > 0 ? mv.y0 * Math.max(0, 1 - _ta.s / mv.sFade) : 0;
    carPose(host, car, _pa.x, _pa.z, _pa.tx, _pa.tz, mv.fs, yOff, plateAngle(host), out);
    out.s = _ta.s; out.v = _ta.v;
    return out;
  }

  // 積めるか見て、よければ積み込みを始める（captureEvery 秒ごと）。戻り値: 始めたか
  function tryCapture(host, car, ctx) {
    const cd = data(host), C = host.def.cargo, P = host.cabin.profile;
    if (!cd || C.enabled === false || !isCar(car) || car.carrier || car.wrecked || car.sinking || car.sunk || !car.driver) return false;
    if (Math.abs(car.pos.y - host.pos.y) > 1.2) return false;
    const wb = car.def.wheelbase || car.def.length * 0.6;
    const l = host.toLocal(car.pos.x, car.pos.z);
    const rel = wrap(car.yaw - host.yaw);
    const fwd = Math.abs(rel) <= C.zoneAngle * D2R, rev = C.allowReverse && Math.abs(wrap(rel - Math.PI)) <= C.zoneAngle * D2R;
    // 先の軸（前から = 前の軸、後ろから = 後ろの軸）。どちらとも言えない向きは近い方で枠を見る
    const dir = fwd ? 1 : rev ? -1 : (Math.abs(rel) < Math.PI / 2 ? 1 : -1);
    const tx = l.x + Math.sin(rel) * dir * wb / 2, tz = l.z + Math.cos(rel) * dir * wb / 2;
    const Z = cd.zone;
    if (Math.abs(tx) > Z.halfW || tz < Z.z0 || tz > Z.z1) return false;
    // ここから先は枠の中: 断る理由を知らせる
    if (!fwd && !rev) { msg(host, 'cargo_refused', 'align', '少し下がって まっすぐ入ってください'); return false; }
    const f = fits(car.def, cd.slots[0]);
    if (f) { msg(host, 'cargo_refused', 'size', f.msg); return false; }
    if (host._cargo) { msg(host, 'cargo_refused', 'full', '貨物室はいっぱいです'); return false; }
    const hr = hostReady(host);
    if (hr) { msg(host, 'cargo_refused', 'here', 'ここでは積めません'); return false; }
    if (footCheck(host, ctx, car.def.length)) { msg(host, 'cargo_refused', 'here', 'ここでは積めません'); return false; }
    // 速さ: ゆっくり、傾斜板へ向かっている（または止まっていてアクセルが傾斜板の方）
    const vz = Math.cos(rel) * car.speed; // 機体の +Z への速さ
    if (Math.abs(car.speed) > C.zoneSpeed) { msg(host, 'cargo_refused', 'fast', 'ゆっくり入ってください'); return false; }
    //   運転手がアクセルを逆へ踏んでいないとき（跳ね返って転がってきた車・下がろうとしている車は捕まえない）
    const toward = (vz > 0.3 && car.throttle * dir > -0.05) || (Math.abs(car.speed) < 0.5 && car.throttle * dir > 0.1);
    if (!toward) return false;
    // 傾斜板: 閉じていれば開ける（開くまで待つ）
    if (host.rampPos < 1 || !host.rampWant) {
      if (!host.rampWant && !host.openRamp(true)) { msg(host, 'cargo_refused', 'here', 'ここでは積めません'); return false; }
      msg(host, 'cargo_wait', 'ramp', 'ランプを下ろしています');
      return false;
    }
    // 道: 中心線の手前（alignZ より前）は真っすぐ・真ん中だけ。ほかは曲がり方が車の回れる半径まで
    if (tz > cd.alignZ && (Math.abs(tx) > 0.3 || Math.abs(dir > 0 ? rel : wrap(rel - Math.PI)) > 5 * D2R)) { msg(host, 'cargo_refused', 'align', '少し下がって まっすぐ入ってください'); return false; }
    const mv = makeLoad(host, car, dir, car.speed);
    if (mv.curv > 1 / mv.turnR) { msg(host, 'cargo_refused', 'align', '少し下がって まっすぐ入ってください'); return false; }
    // 始める
    host._cargo = { car, dir, state: 'loading', mv, l: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } };
    car.carrier = { host, slot: 0 };
    car.cargoState = 'loading';
    car.throttle = 0; car.steerInput = 0; car.steer = 0; car.yawRate = 0;
    host.cityTouched = true; car.cityTouched = true;
    host.stats.cargoLoads = (host.stats.cargoLoads || 0) + 1;
    host.events.push({ t: 'cargo_capture', id: car.cityId || car.id, dir });
    msg(host, 'cargo_loading', null, '積み込み中…');
    return true;
  }

  // 降ろす（積んだ車に運転手がいて、スティックを外へ）: 始めたか。だめなら理由を知らせる
  function tryUnload(host, ctx) {
    const c = host._cargo;
    if (!c || c.state !== 'stowed' || c.car.wrecked) return false;
    const car = c.car;
    const hr = hostReady(host);
    if (hr) { msg(host, 'cargo_refused', 'unload_here', 'ここでは車を降ろせません'); return false; }
    if (footCheck(host, ctx, car.def.length)) { msg(host, 'cargo_refused', 'unload_here', 'ここでは車を降ろせません'); return false; }
    if (laneClear(host, ctx, car)) { msg(host, 'cargo_refused', 'lane', 'ランプの後ろがふさがっています'); return false; }
    if (host.rampPos < 1 || !host.rampWant) {
      if (!host.rampWant && !host.openRamp(true)) { msg(host, 'cargo_refused', 'unload_here', 'ここでは車を降ろせません'); return false; }
      msg(host, 'cargo_wait', 'ramp', 'ランプを下ろしています');
      c.pending = true; // 開ききったら降ろし始める（step）
      return 'wait';
    }
    c.pending = false;
    c.mv = makeUnload(host, car, c.dir);
    c.state = 'unloading'; car.cargoState = 'unloading';
    host.events.push({ t: 'cargo_unload', id: car.cityId || car.id });
    msg(host, 'cargo_unloading', null, '降ろしています…');
    return true;
  }
  // 降ろす（物語の API: 運転手がいなくてよい）
  function unloadVehicle(host, ctx) { return tryUnload(host, ctx || host._lastCtx); }

  // 外す（why: 'unloaded' | 'destroyed' | 'wreck' | 'respawn' | 'sink' | 'drop'）
  function release(host, car, why) {
    const c = host._cargo;
    if (!c || (car && c.car !== car)) return null;
    car = c.car;
    host._cargo = null;
    car.carrier = null; car.cargoState = null;
    car.root.visible = !car.sunk;
    host.events.push({ t: 'cargo_release', id: car.cityId || car.id, why });
    (host._released || (host._released = [])).push({ car, why });
    if (why === 'destroyed') {
      // 機体の速さで落ちる残骸（2 回目の爆発はしない）
      const hv = host.vel || _v.set(0, 0, 0);
      car.wrecked = true; car.health = 0; car.speed = 0; car.throttle = 0; car.steerInput = 0;
      car.respawnTimer = car.def.respawn;
      car._cargoFall = { vx: hv.x, vy: hv.y, vz: hv.z };
      if (typeof car._setWreckLook === 'function') car._setWreckLook(true);
      car._stopEngine();
    }
    return car;
  }
  // 積んだ状態で付ける（続きから・チャンクの出し入れの作り直し・物語の loadVehicle）。dir: +1 前から / −1 後ろから
  function attach(host, car, dir) {
    const cd = data(host);
    if (!cd || host._cargo || !car || car.carrier) return false;
    host._cargo = { car, dir: dir < 0 ? -1 : 1, state: 'stowed', mv: null, l: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } };
    car.carrier = { host, slot: 0 };
    car.cargoState = 'stowed';
    car.speed = 0; car.throttle = 0; car.steerInput = 0; car.steer = 0; car.sinking = null;
    host.cityTouched = true; car.cityTouched = true;
    follow(host, null);
    return true;
  }

  // 毎フレーム（機体の update の頭。止めてある機体も）: 積む・降ろす動き、捕まえる、降ろす入力
  function step(host, dt, ctx) {
    const cd = data(host);
    if (!cd) return;
    const C = host.def.cargo;
    host._lastCtx = ctx || host._lastCtx;
    const c = host._cargo;
    if (c && (c.car.disposed)) { host._cargo = null; return; }
    if (c && (c.state === 'loading' || c.state === 'unloading')) {
      const car = c.car, mv = c.mv;
      // 道にほかの乗り物: holdMax 秒待つ → 押す
      const p = movePose(host, car, mv, c.l);
      let held = false;
      if (ctx && ctx.vehicles) {
        const ahead = movePose(host, car, { kind: mv.kind, path: mv.path, tb: mv.tb, t: mv.t + 0.4, fs: mv.fs, y0: mv.y0, sFade: mv.sFade }, {});
        const w = host.toWorld(_v.set(ahead.x, 0, ahead.z), _v2), wx = w.x, wz = w.z;
        for (const o of ctx.vehicles) {
          if (!o || o === car || o === host || o.disposed || o.carrier || o.sunk || o.kind === 'vtol' || o.kind === 'jet') continue;
          if (Math.abs(o.pos.y - (host.pos.y + ahead.y)) > 2.5) continue;
          const r = (o.hull ? o.hull.r : 1.5) + car.def.width / 2;
          if (Math.hypot(o.pos.x - wx, o.pos.z - wz) > r + car.def.length / 2) continue;
          if (o.distanceTo(wx, wz) > car.def.width / 2) continue;
          if (mv.hold < C.holdMax) { held = true; break; }
          const q = { x: o.pos.x, z: o.pos.z };
          if (car.pushOut(q, (o.hull ? o.hull.r : 1.5))) { o.pos.x = q.x; o.pos.z = q.z; if (o._apply) o._apply(); }
        }
      }
      if (held) mv.hold += dt;
      else mv.t += dt;
      movePose(host, car, mv, c.l);
      car.speed = (held ? 0 : p.v) * mv.fs;
      // 動く車の箱から歩く人・敵を押し出す
      applyPose(host, car, c.l);
      const wk = ctx && ctx.walker;
      if (wk && !wk.dead && Math.abs(wk.pos.y - car.pos.y) < 2 && car.pushOut(wk.pos, wk.radius || 0.4)) { if (wk._apply) wk._apply(); }
      if (ctx && ctx.enemies) for (const e of ctx.enemies) { if (!e || e.dead || e.removed || Math.abs((e.pos.y || 0) - car.pos.y) > 2) continue; car.pushOut(e.pos, e.radius || 0.45); }
      if (mv.t >= mv.tb.T) {
        if (mv.kind === 'load') {
          c.state = 'stowed'; car.cargoState = 'stowed'; c.mv = null; car.speed = 0;
          host.stats.cargoStowed = (host.stats.cargoStowed || 0) + 1;
          host.events.push({ t: 'cargo_stowed', id: car.cityId || car.id, dir: c.dir, sec: +(mv.t + mv.hold).toFixed(3) });
          msg(host, 'cargo_stowed', null, '積みました');
          host._cargoStowedT = host.time;
        } else {
          // 手を放す: 地面の高さ・速さ exitSpeed で外へ
          release(host, car, 'unloaded');
          const nav = ctx && ctx.nav;
          const gy = nav && typeof nav.groundHeight === 'function' ? nav.groundHeight(car.pos.x, car.pos.z, car.pos.y + 0.5, 0.3) : null;
          if (gy !== null && gy !== undefined) car.pos.y = gy;
          car.pitch = 0; car.roll = 0; car.vy = 0; car._lastY = car.pos.y; car.airborne = false;
          car.speed = C.exitSpeed * mv.fs;
          car._apply();
          host.stats.cargoUnloads = (host.stats.cargoUnloads || 0) + 1;
          msg(host, 'cargo_unloaded', null, '降ろしました');
        }
      }
      return;
    }
    if (c && c.state === 'stowed') {
      // 降ろす入力: 積んだ車の運転手がスティックを外へ（前から積んだ車は下 = 後ろへ、後ろから積んだ車は上）
      const car = c.car;
      if (c.pending && host.rampPos >= 1 && host.rampWant) tryUnload(host, ctx);
      else if (c.pending && (!host.rampWant || host.wrecked)) c.pending = false; // 閉じられた: やめる
      if (c.state !== 'stowed') return;
      if (car.driver && !car.wrecked) {
        const out = c.dir > 0 ? -car.throttle : car.throttle;
        c.unT = out > C.unloadStick ? (c.unT || 0) + dt : 0;
        if (c.unT >= C.unloadHold) { c.unT = -1e9; tryUnload(host, ctx); }
        if (out <= C.unloadStick) c.unT = 0;
      } else c.unT = 0;
      // 積んであっても枠に来た車には「貨物室はいっぱいです」（下の捕まえるへ）
    }
    // 捕まえる（captureEvery 秒ごと）
    host._capT = (host._capT || 0) - dt;
    if (host._capT > 0 || !ctx || !ctx.vehicles) return;
    host._capT = C.captureEvery;
    for (const v of ctx.vehicles) {
      if (!isCar(v) || !v.driver || v.carrier || (c && c.car === v)) continue;
      if (Math.hypot(v.pos.x - host.pos.x, v.pos.z - host.pos.z) > 40) continue;
      if (tryCapture(host, v, ctx)) break;
    }
  }
  // 積んだ車を機体の上に置く（機体の update の終わり・止めてある機体も）。見えるのは傾斜板が開いているかカメラが胴体の中
  function follow(host, ctx) {
    const c = host._cargo;
    if (!c) return;
    const car = c.car;
    if (car.disposed) { host._cargo = null; return; }
    if (c.state === 'stowed') { stowPose(host, car, c.dir, c.l); applyPose(host, car, c.l); }
    else if (c.mv) applyPose(host, car, movePose(host, car, c.mv, c.l));
    let vis = host.rampPos > 0 || c.state !== 'stowed' || !!car.driver;
    const cam = ctx && ctx.camera;
    if (!vis && cam && cam.getWorldPosition) {
      const p = cam.getWorldPosition(_v2), F = host.boxDef[0];
      const q = host._qi.copy(host.quat).invert();
      const lp = _v.set(p.x - host.pos.x, p.y - host.pos.y - MR.Vtol.PIVOT_Y, p.z - host.pos.z).applyQuaternion(q);
      lp.y += MR.Vtol.PIVOT_Y;
      vis = lp.x > F.x0 && lp.x < F.x1 && lp.y > F.y0 && lp.y < F.y1 && lp.z > F.z0 && lp.z < F.z1;
    }
    car.root.visible = vis && !car.sunk;
  }
  // 浮いてよいか（積み込み・降ろす途中ではない）
  function busy(host) { const c = host._cargo; return !!(c && (c.state === 'loading' || c.state === 'unloading')); }
  // 積んだ車の歩く人の足場の箱（機体の座標。cabinTypes の ':car' 型が使う）
  function slotBox(cab) {
    const cd = cab && cab.cargo && cab.cargo.slots && cab.cargo.slots[0];
    if (!cd) return null;
    const fl = cd.floorY == null ? 2.05 : cd.floorY;
    return [cd.x - cd.maxW / 2, fl, cd.zFront - cd.maxLen, cd.x + cd.maxW / 2, fl + cd.maxH, cd.zFront, 0, 'cargo_car'];
  }
  // 運転手が降りる所（左舷の通路。機体の座標の autoExit → 世界）
  function exitPoint(host, out) {
    const cd = data(host);
    if (!cd) return null;
    const a = cd.autoExit;
    return host.toWorld(_v.set(a[0], a[1], a[2]), out || new THREE.Vector3());
  }
  // 続きから・チャンクの出し入れ: 積んだ車の機体の座標の姿勢 [hostId, lx, ly, lz, lyaw]
  function link(host) {
    const c = host._cargo;
    if (!c || c.state === 'loading' || c.state === 'unloading') return null;
    const l = c.l, r = (v) => Math.round(v * 1000) / 1000;
    return [host.cityId || null, r(l.x), r(l.y), r(l.z), r(l.yaw)];
  }

  MR.VtolCargo = { fits, footCheck, laneClear, tryCapture, tryUnload, unloadVehicle, release, attach, step, follow, busy, slotBox, exitPoint, link, stowPose, surfY, plateAngle, buildPath, speedTable, data };
})();
