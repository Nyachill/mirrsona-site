// 爆発の当たり（MR.Explosive）。THREE / DOM を使わない（Node・サーバーも require できる。netproto.js と同じ UMD）。
//   weapons2 の計画（§4.1 / §5.2）と同じ名前・引数の順。weapons2 は後でこのファイルに Ballistic（弾道）・arc（投げる線の予告）・
//   throwVelocity・segSmoke（煙の球の弦の長さ）を足す（ここには無い）。
//
//   Explosive.blast(spec, x, y, z, nx, ny, nz, env, out, opts) → 当たった数 n（out[0..n-1] に書く。out.n も n）
//     spec: explosives.blasts.<名前> = { radius, core, damage, coreDamage, falloff, vehicle, player, soldier, prop, vs: { <typeId|kind|defId|default> }, shakeRange, fx }
//     (x, y, z) 爆発の点、(nx, ny, nz) 当たった面の法線（空中の爆発は飛んできた向きの逆）。視線の元は点 + 0.3 m × 法線。
//     env（呼ぶ側が 1 回だけ作る）:
//       each(visit)  … 目標ごとに visit(t)。t は呼ぶ側が使い回す記述:
//                      { obj, cls: 'soldier' | 'player' | 'vehicle' | 'prop', x, y, z（兵士・プレイヤーは足元、乗り物・小物は中心）,
//                        h（兵士の背の高さ / 乗り物の高さ）, r（乗り物・小物の半径。距離は中心から r を引く）, typeId, kind, defId, driverExposure }
//       los(ax, ay, az, bx, by, bz) → 通れば true（無ければ全部見える）
//       seatedIn(obj) → 乗っている乗り物の obj | null（D9: 乗っている人は爆風を直接受けない。乗り物の結果 × その driverExposure）
//     out: 使い回す配列。要素 { target, cls, dmg, dist, exposure, via }（via = 乗っている人なら乗り物の obj）
//     opts（任意）: { hitObj（直撃した物 = 距離 0・見える割合 1）, skip（数えない物 1 つ）, cone: { dx, dy, dz, cosHalf, len }（後方噴射の円錐。
//                   円錐の中だけ damage × (1 − d / len)）}
//                   struct: { radius, damage }（任意。建物などの構造物へのダメージ = 後で使う。今は効き目なし）}
//     spec.struct（任意、同じ形）も受ける。out.struct = opts.struct || spec.struct || null をそのまま書く（報告だけ。建物は今は壊れない）
//   ダメージ（§5.2）: d ≤ core → coreDamage、ほかは damage × (1 − (d − core) / (R − core))^falloff、× 見える割合 × kindMul。
//     乗り物は vehicle × kindMul × 減り方 × 見える割合（v.damage にそのまま渡す = 弾の armor を二重に掛けない）。
//   kindMul(spec, t): 乗り物は vs[typeId] → vs[kind] → vs[defId] → vs.default → 1、プレイヤーは spec.player、兵士は spec.soldier、小物は spec.prop（無ければ 1）
//   falloff(spec, d) → 0..1（core の中は 1）。乱数は使わない。
//   直線の形（E3.4。ミサイル・乗り物の爆発 = 前の _missileBlast / _vehicleExploded と同じ数）: spec.edge があれば core / coreDamage / falloff を使わず
//     減り方 = 1 − d / R × edge（d ≤ R。R ちょうどで 1 − edge）。プレイヤーは spec.playerEdge（無ければ edge）。
//     spec.chest（m）があれば兵士・プレイヤーの距離は足元 + chest の 1 点まで（無ければ足元〜頭の線分）。spec.centerDist なら乗り物は中心まで（r を引かない）。
//     env.flat なら距離は水平だけ（アリーナの車の爆発）。
//   D9 乗っている人（env.seatedIn）: spec.seat
//     'vehicle'（既定）: 乗り物の爆風（vehicle × 乗り物の距離の減り方 × 見える割合。円錐は damage × 円錐の減り方）× その乗り物の driverExposure。
//                        spec.player も kindMul も掛けない（前の _missileBlast の数）
//     'occupant'（乗り物の爆発）: 乗っている人の位置で歩いている人と同じ計算（人の距離・playerEdge・見える割合 × spec.player）→ 乗っている乗り物は
//                        それ × kindMul（= armor。乗り物自身の距離の結果の代わり）、乗っている人は × driverExposure（前の _vehicleExploded の数）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.MR = root.MR || {}; root.MR.Explosive = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const LOS_OFFSET = 0.3;
  const DEFAULT = { radius: 6, core: 1.5, damage: 120, coreDamage: 200, falloff: 1.2, vehicle: 300, player: 1, prop: 1, vs: { default: 1 } };

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function kindMul(spec, t) {
    const cls = t && t.cls;
    if (cls === 'vehicle') {
      const vs = spec && spec.vs;
      if (!vs) return 1;
      if (t.typeId != null && typeof vs[t.typeId] === 'number') return vs[t.typeId];
      if (t.kind != null && typeof vs[t.kind] === 'number') return vs[t.kind];
      if (t.defId != null && typeof vs[t.defId] === 'number') return vs[t.defId];
      return num(vs.default, 1);
    }
    if (cls === 'player') return num(spec && spec.player, 1);
    if (cls === 'prop') return num(spec && spec.prop, 1);
    return num(spec && spec.soldier, 1);
  }

  // 距離 d での減り方（0..1）。core の中は 1。直線の形（spec.edge）は 1 − d / R × edge（edgeOver があればその edge）
  function falloff(spec, d, edgeOver) {
    const R = num(spec.radius, DEFAULT.radius);
    if (typeof spec.edge === 'number') {
      if (d > R) return 0;
      return Math.max(0, 1 - Math.max(0, d) / R * num(edgeOver, spec.edge));
    }
    const core = Math.min(num(spec.core, 0), R * 0.999);
    if (d <= core) return 1;
    if (d >= R) return 0;
    return Math.pow(1 - (d - core) / (R - core), num(spec.falloff, 1));
  }

  // 人（兵士・プレイヤー）のダメージ（kindMul と見える割合の前）。cls 'player' は直線の形で playerEdge
  function infantry(spec, d, cls) {
    if (typeof spec.edge === 'number') return num(spec.damage, 0) * falloff(spec, d, cls === 'player' ? spec.playerEdge : undefined);
    const core = num(spec.core, 0);
    if (d <= core) return num(spec.coreDamage, num(spec.damage, 0));
    return num(spec.damage, 0) * falloff(spec, d);
  }

  // 使い回しの作業領域（blast は入れ子で呼ばれない前提: 爆発が別の爆発を起こすのは呼ぶ側が結果を適用した後）
  //   seatX/Y/Z/H: 乗っている人の足元と背（seat 'occupant'）、vObj / vMul / vDex: 見た乗り物の kindMul と driverExposure（範囲の外も。seat 'occupant'）
  const S = { seatObj: [], seatVeh: [], seatX: [], seatY: [], seatZ: [], seatH: [], nSeat: 0, vObj: [], vMul: [], vDex: [], nV: 0,
    spec: null, x: 0, y: 0, z: 0, py: 0, ox: 0, oy: 0, oz: 0, env: null, out: null, n: 0, opts: null, flat: false };
  const SEAT_T = { obj: null, cls: 'seat', x: 0, y: 0, z: 0, h: 1.8, r: 0 };

  function entry(out, i) {
    let e = out[i];
    if (!e) { e = { target: null, cls: '', dmg: 0, dist: 0, exposure: 0, via: null }; out[i] = e; }
    return e;
  }

  // 見える割合（サンプル ≤ 3）
  function exposure(env, t, px, py, pz) {
    if (!env || typeof env.los !== 'function') return 1;
    const ox = S.ox, oy = S.oy, oz = S.oz;
    let seen = 0, n = 0;
    if (t.cls === 'vehicle' || t.cls === 'prop') {
      // 中心 + 爆発から見て横の 2 点（半径 r）
      const r = num(t.r, 0.5), h = num(t.h, 1);
      let sx = -(pz - S.z), sz = px - S.x; const L = Math.hypot(sx, sz);
      if (L > 1e-6) { sx /= L; sz /= L; } else { sx = 1; sz = 0; }
      n = 3;
      if (env.los(ox, oy, oz, px, py, pz)) seen++;
      if (env.los(ox, oy, oz, px + sx * r, py + h * 0.25, pz + sz * r)) seen++;
      if (env.los(ox, oy, oz, px - sx * r, py + h * 0.25, pz - sz * r)) seen++;
    } else if (t.cls === 'seat') {
      // 乗っている人（seat 'occupant'）: 胸・頭（足元は乗り物の床の下 = いつも隠れる）
      const h = num(t.h, 1.8);
      n = 2;
      if (env.los(ox, oy, oz, t.x, t.y + h * 0.6, t.z)) seen++;
      if (env.los(ox, oy, oz, t.x, t.y + h * 0.95, t.z)) seen++;
    } else {
      // 足元・胸・頭
      const h = num(t.h, 1.8);
      n = 3;
      if (env.los(ox, oy, oz, t.x, t.y + 0.3, t.z)) seen++;
      if (env.los(ox, oy, oz, t.x, t.y + h * 0.6, t.z)) seen++;
      if (env.los(ox, oy, oz, t.x, t.y + h * 0.95, t.z)) seen++;
    }
    return n ? seen / n : 1;
  }

  // 爆発の点から目標まで（人は S.py に測った点の高さを置く）
  function distTo(spec, t) {
    const flat = S.flat;
    if (t.cls === 'vehicle' || t.cls === 'prop') {
      const dy = flat ? 0 : t.y - S.y;
      const dc = Math.hypot(t.x - S.x, dy, t.z - S.z);
      return spec.centerDist ? dc : Math.max(0, dc - num(t.r, 0));
    }
    const h = num(t.h, 1.8);
    const cy = typeof spec.chest === 'number' ? t.y + spec.chest : Math.min(t.y + h, Math.max(t.y, S.y));
    S.py = cy;
    return Math.hypot(t.x - S.x, flat ? 0 : cy - S.y, t.z - S.z);
  }

  function visit(t) {
    const spec = S.spec, opts = S.opts, env = S.env;
    if (!t || !t.obj) return;
    if (opts && opts.skip && t.obj === opts.skip) return;
    // D9: 乗っている人は乗り物の結果を待つ
    if (t.cls !== 'vehicle' && t.cls !== 'prop' && env.seatedIn) {
      const v = env.seatedIn(t.obj);
      if (v) {
        const k = S.nSeat++;
        S.seatObj[k] = t.obj; S.seatVeh[k] = v; S.seatX[k] = t.x; S.seatY[k] = t.y; S.seatZ[k] = t.z; S.seatH[k] = num(t.h, 1.8);
        return;
      }
    }
    if (t.cls === 'vehicle' && spec.seat === 'occupant') { // 乗っている人の計算のために kindMul を覚える（範囲の外も）
      const k = S.nV++;
      S.vObj[k] = t.obj; S.vMul[k] = kindMul(spec, t); S.vDex[k] = num(t.driverExposure, 0);
    }
    const R = num(spec.radius, DEFAULT.radius);
    const direct = !!(opts && opts.hitObj && opts.hitObj === t.obj);
    let px = t.x, py = t.y, pz = t.z;
    let d = distTo(spec, t);
    if (t.cls !== 'vehicle' && t.cls !== 'prop') py = S.py;
    if (direct) d = 0;
    const cone = opts && opts.cone;
    if (cone) {
      const len = num(cone.len, R);
      const dx = px - S.ox, dy = py - S.oy, dz = pz - S.oz, L = Math.hypot(dx, dy, dz);
      if (L > len) return;
      if (L > 1e-6 && (dx * cone.dx + dy * cone.dy + dz * cone.dz) / L < cone.cosHalf) return;
      d = L;
    } else if (d > R || (d >= R && t.cls === 'player' && typeof spec.edge === 'number')) return; // 直線の形のプレイヤーは R ちょうどで 0（前の計算と同じ）
    const ex = direct ? 1 : exposure(env, t, px, py, pz);
    if (ex <= 0 && !cone) {
      // 見えない: 0 として残す（呼ぶ側は揺れ・音だけ）。乗り物は乗っている人の計算に要る
      if (t.cls !== 'vehicle') return;
    }
    const mul = kindMul(spec, t);
    let dmg;
    if (cone) dmg = num(spec.damage, 0) * Math.max(0, 1 - d / num(cone.len, R)) * ex * mul;
    else if (t.cls === 'vehicle') dmg = num(spec.vehicle, 0) * mul * falloff(spec, d) * ex;
    else if (t.cls === 'prop') dmg = num(spec.damage, 0) * mul * falloff(spec, d) * ex;
    else dmg = infantry(spec, d, t.cls) * ex * mul;
    const e = entry(S.out, S.n++);
    e.target = t.obj; e.cls = t.cls; e.dmg = dmg; e.dist = d; e.exposure = ex; e.via = null;
    if (t.cls === 'vehicle') e.driverExposure = num(t.driverExposure, 0); else e.driverExposure = 0;
  }

  function blast(spec, x, y, z, nx, ny, nz, env, out, opts) {
    spec = spec || DEFAULT;
    out = out || [];
    const nl = Math.hypot(nx || 0, ny || 0, nz || 0);
    S.spec = spec; S.env = env || {}; S.out = out; S.opts = opts || null; S.n = 0; S.nSeat = 0;
    S.x = x; S.y = y; S.z = z; S.nV = 0; S.flat = !!(S.env && S.env.flat);
    out.struct = (opts && opts.struct) || spec.struct || null; // 構造物のダメージ（受けて報告するだけ。効き目は後で）
    if (nl > 1e-6) { S.ox = x + nx / nl * LOS_OFFSET; S.oy = y + ny / nl * LOS_OFFSET; S.oz = z + nz / nl * LOS_OFFSET; }
    else { S.ox = x; S.oy = y; S.oz = z; }
    if (S.env.each) S.env.each(visit);
    // D9: 乗っている人（乗れるのはプレイヤーだけ。敵は乗らない。オンラインの他の人もプレイヤーとして数える）
    //   seat 'vehicle'（既定）: 乗り物の爆風 × driverExposure（乗り物が範囲の外なら何も書かない）
    //   seat 'occupant': 乗っている人の位置で歩いている人と同じ計算 → 乗り物はそれ × kindMul、人は × driverExposure
    const nV = S.n;
    const occ = spec.seat === 'occupant';
    for (let s = 0; s < S.nSeat; s++) {
      const v = S.seatVeh[s], pt = S.seatObj[s];
      S.seatObj[s] = null; S.seatVeh[s] = null;
      let ve = null;
      for (let i = 0; i < nV; i++) if (out[i].target === v && out[i].cls === 'vehicle') { ve = out[i]; break; }
      if (occ) {
        let vm = -1;
        for (let i = 0; i < S.nV; i++) if (S.vObj[i] === v) { vm = i; break; }
        if (vm < 0) continue; // 乗っている乗り物が数えられていない（壊れた・skip）
        const T = SEAT_T;
        T.obj = pt; T.x = S.seatX[s]; T.y = S.seatY[s]; T.z = S.seatZ[s]; T.h = S.seatH[s];
        const d = distTo(spec, T);
        if (d >= num(spec.radius, DEFAULT.radius)) continue;
        const ex = exposure(env, T, T.x, S.py, T.z);
        const base = infantry(spec, d, 'player') * ex * num(spec.player, 1);
        if (!ve) {
          ve = entry(out, S.n++);
          ve.target = v; ve.cls = 'vehicle'; ve.via = null;
        }
        ve.dist = d; ve.exposure = ex; ve.driverExposure = S.vDex[vm];
        ve.dmg = base * S.vMul[vm];
        const e = entry(out, S.n++);
        e.target = pt; e.cls = 'player'; e.dist = d; e.exposure = ex; e.via = v; e.driverExposure = 0;
        e.dmg = base * S.vDex[vm];
        continue;
      }
      if (!ve) continue;
      const base = (opts && opts.cone) ? num(spec.damage, 0) * Math.max(0, 1 - ve.dist / num(opts.cone.len, num(spec.radius, 6)))
        : num(spec.vehicle, 0) * falloff(spec, ve.dist);
      const e = entry(out, S.n++);
      e.target = pt; e.cls = 'player'; e.dist = ve.dist; e.exposure = ve.exposure; e.via = v; e.driverExposure = 0;
      e.dmg = base * ve.exposure * ve.driverExposure;
    }
    for (let i = 0; i < S.nV; i++) S.vObj[i] = null;
    S.nV = 0;
    const n = S.n;
    out.n = n;
    S.env = null; S.out = null; S.opts = null; S.spec = null;
    return n;
  }

  return { blast, kindMul, falloff, infantry, DEFAULT, LOS_OFFSET };
});
