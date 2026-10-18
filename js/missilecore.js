// ミサイルの飛び方（MR.MissileCore）。THREE も DOM も使わない（Node のサーバーも require する。CLAUDE.md の約束 14）。
//   数と配列だけで、同じ seed・同じ入力なら同じ道すじ（乱数は mulberry32。Math.random は使わない）。
//   1 回の step は内側で maxStep 秒（1/60）以下に刻む: サーバーの 1/15 秒の tick と 20 fps の端末で同じ飛び方になる。
//   create(cfg, o, out) … out（使い回しの物）を発射の状態にする。cfg = 型の数値（missile.js が vehicles.types.jet.missile の上に
//     game.json の missiles.types.<型> を重ねたもの）。o = { k, seed, x,y,z, vx,vy,vz（発射台の速さ）, dx,dy,dz（向き）, tgt（目標。不透明）,
//     ground（目標が地上 = 上から突っ込む）, aim:[x,y,z]（狙う点。目標が無いとき）, owner }
//   step(m, dt, env) → EV_NONE / EV_FUSE（目標・巻き込み・フレアの近く）/ EV_IMPACT（建物・地面・水）/ EV_EXPIRE（寿命で空中で爆発）。
//     出来事は m.ev { code, x,y,z, ref, water, src, air }。
//     env: targetPos(ref, outP, outV) → 生きていれば true（outP / outV = 今の位置と速さ [3]）、ray(ox,oy,oz, dx,dy,dz, len, hit) → 当たれば true
//     （hit に t, x,y,z, water, src）、collateral(m, ax,ay,az, bx,by,bz, hit) → 線分の近くの巻き込み（乗り物・敵）か null、
//     isFlare(ref) → bool（フレアは fuse × 0.6 で爆発するだけ、当たりに数えない）
//   誘導: 空の目標 = 比例航法（ZEM / tgo²、N = navN）、地上の目標・狙う点・フレア以外の地上 = 今までの先読みの追尾 + 上から（loft）+
//     建物の陰なら見えるまで狙いを上げる（LOS-lift。13f の飛び方のまま）。どちらも横の加速度は turnG G まで。
//     シーカーの首振り（gimbal°）: 空の目標が速度の向きから外れたら見失ってまっすぐ。
//   decoyRoll(m) … フレアにだまされるか（decoyChance。1 発あたり decoyRolls 回まで）。incoming(list, ref, px,py,pz, hx,hz, out, tv) …
//     ref を追うミサイルの一番近いもの（dist, tti, bearing = 機首から右が正の度、elevation 度）。pickType(cfg, counts, target, dist, offBore) …
//     撃つ型（D2: 空の目標は aim9x.maxRange 以内で首振りの中なら aim9x、ほかは aim120 → aim9x。無ければ null）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) { root.MR = root.MR || {}; root.MR.MissileCore = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';
  const G = 9.81, D2R = Math.PI / 180;
  const EV_NONE = 0, EV_FUSE = 1, EV_IMPACT = 2, EV_EXPIRE = 3;

  // 型の既定値（game.json の missiles.types が上書き）。ロックの数値は持たない（センサーは機体の missile.lock*）
  const TYPES = {
    aim9x: { seeker: 'ir', proto: 'proj_aim9x', glb: 'fa18', length: 3.06, maxRange: 1800, speed: 430, accel: 260, motorTime: 2.6, coastDrag: 45,
      turnG: 60, navN: 4, gimbal: 75, fuse: 8, damage: 600, blastRadius: 14, life: 8, decoyChance: 0.8, decoyRange: 2500, decoyRolls: 2 },
    aim120: { seeker: 'radar', proto: 'proj_aim120', glb: 'fa18', length: 3.66, maxRange: 4000, speed: 600, accel: 210, motorTime: 4.5, coastDrag: 30,
      turnG: 35, navN: 3, gimbal: 60, fuse: 10, damage: 700, blastRadius: 16, life: 14, decoyChance: 0.25, decoyRange: 2500, decoyRolls: 1 },
    manpads: { seeker: 'ir', proto: 'proj_aa', glb: 'projectiles', fins: 'fins_aa', length: 1.42, speed: 520, accel: 300, motorTime: 3.0, coastDrag: 50,
      turnG: 30, navN: 3, gimbal: 60, fuse: 6, damage: 420, blastRadius: 8, life: 9, decoyChance: 0.75, decoyRange: 1500, decoyRolls: 2 }
  };
  // 型に無い数値（発射・地上の目標の飛び方。vehicles.types.jet.missile と同じ名前）
  const BASE = {
    speed: 480, accel: 220, ejectSpeed: 15, motorTime: 3.5, coastDrag: 40, dropTime: 0.25, armTime: 0.35, life: 9, turnG: 55, fuse: 9,
    loftFrom: 400, loftK: 0.5, loftMax: 300, losEvery: 0.1, losClear: 4, liftRate: 120, decoyRange: 2500, decoyChance: 0.8, decoyRolls: 2,
    navN: 3, gimbal: 90, minSpeed: 80, maxStep: 1 / 60, leadMax: 4,
    // 誘導の細かい数値: 追尾へ回る下限（正面から pursuitCos より外れて、近づいていないか首振りの pursuitGate 倍より外のとき・強さ pursuitGain）、
    // 残り時間の見積もりの下限の速さ（tgoClose / tgoSpeed m/s）。フレア: fuse × flareFuseK で爆発、重力 × flareGravity・抗力 flareDrag /s
    pursuitCos: 0.94, pursuitGate: 0.5, pursuitGain: 2, tgoClose: 50, tgoSpeed: 100, flareFuseK: 0.6, flareGravity: 0.35, flareDrag: 0.8,
    // おとりは機体に届くまで decoyMinTime 秒以上あるミサイルだけ（missile.js popFlares。距離 / max(近づく速さ, tgoSpeed)）
    decoyMinTime: 1
  };

  // mulberry32: 状態（u32）→ [0, 1)。状態は m.r に持つ
  function rngNext(m) {
    let t = (m.r = (m.r + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rng(seed) { const s = { r: (seed >>> 0) || 1 }; return () => rngNext(s); }

  function newState() {
    return {
      id: 0, k: '', seed: 0, r: 1, c: null, p: [0, 0, 0], v: [0, 0, 0], dir: [0, 0, 1], t: 0, ph: 0, tgt: null, ground: false,
      aim: [0, 0, 0], hasAim: false, lift: 0, losT: 0, blocked: false, owner: null, dead: false, rolls: 0, decoyed: false, lost: false,
      ev: { code: 0, x: 0, y: 0, z: 0, ref: null, water: false, src: null, air: false }
    };
  }

  function create(cfg, o, out) {
    const m = out || newState();
    m.c = cfg; m.k = o.k || ''; m.seed = (o.seed >>> 0) || 1; m.r = m.seed;
    m.id = o.id || 0;
    let dx = o.dx || 0, dy = o.dy || 0, dz = o.dz || 0;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    m.p[0] = o.x; m.p[1] = o.y; m.p[2] = o.z;
    const ej = cfg.ejectSpeed != null ? cfg.ejectSpeed : BASE.ejectSpeed;
    m.v[0] = (o.vx || 0) + dx * ej; m.v[1] = (o.vy || 0) + dy * ej - 2; m.v[2] = (o.vz || 0) + dz * ej; // レールを離れて少し落ちる
    m.dir[0] = dx; m.dir[1] = dy; m.dir[2] = dz;
    m.t = 0; m.ph = 0; m.tgt = o.tgt || null; m.ground = !!o.ground;
    if (o.aim) { m.aim[0] = o.aim[0]; m.aim[1] = o.aim[1]; m.aim[2] = o.aim[2]; m.hasAim = true; } else m.hasAim = false;
    m.lift = 0; m.losT = 0; m.blocked = false; m.owner = o.owner || null; m.dead = false; m.rolls = 0; m.decoyed = false; m.lost = false;
    const e = m.ev; e.code = 0; e.ref = null; e.water = false; e.src = null; e.air = false;
    return m;
  }

  // 線分 a → b と点 q の一番近い点が r より近いか（近ければ out [k, x, y, z] を書いて true）
  function closest(ax, ay, az, bx, by, bz, qx, qy, qz, r, out) {
    const sx = bx - ax, sy = by - ay, sz = bz - az, L2 = sx * sx + sy * sy + sz * sz;
    let k = L2 > 1e-12 ? ((qx - ax) * sx + (qy - ay) * sy + (qz - az) * sz) / L2 : 0;
    k = k < 0 ? 0 : (k > 1 ? 1 : k);
    const cx = ax + sx * k, cy = ay + sy * k, cz = az + sz * k;
    const d2 = (qx - cx) * (qx - cx) + (qy - cy) * (qy - cy) + (qz - cz) * (qz - cz);
    if (d2 >= r * r) return false;
    if (out) { out[0] = k; out[1] = cx; out[2] = cy; out[3] = cz; }
    return true;
  }

  // 使い回しの作業領域（1 本ずつ順に計算するので共有でよい）
  const TP = [0, 0, 0], TV = [0, 0, 0], CL = [0, 0, 0, 0], HIT = { t: 0, x: 0, y: 0, z: 0, water: false, src: null };

  function step(m, dt, env) {
    if (m.dead) return EV_NONE;
    const c = m.c, maxStep = c.maxStep || BASE.maxStep;
    const n = Math.max(1, Math.ceil(dt / maxStep - 1e-9));
    const h = dt / n;
    let alive = false, tx = 0, ty = 0, tz = 0, tvx = 0, tvy = 0, tvz = 0, flare = false;
    // 目標の位置は step の終わり（今）のもの。刻みの途中は速さで戻した所（粗い tick でも同じ近さの判定）
    if (m.tgt) {
      alive = !!env.targetPos(m.tgt, TP, TV);
      if (!alive) { m.tgt = null; m.lost = true; }
      else { tx = TP[0]; ty = TP[1]; tz = TP[2]; tvx = TV[0]; tvy = TV[1]; tvz = TV[2]; flare = !!(env.isFlare && env.isFlare(m.tgt)); }
    }
    for (let i = 0; i < n; i++) {
      const back = (n - 1 - i) * h; // この刻みの終わりから今までの秒
      const ox = m.p[0], oy = m.p[1], oz = m.p[2];
      m.t += h;
      let V = Math.hypot(m.v[0], m.v[1], m.v[2]);
      if (m.t < c.dropTime) {
        m.ph = 0;
        m.v[1] -= G * h;
      } else {
        const motor = m.t < c.dropTime + c.motorTime;
        m.ph = motor ? 1 : 2;
        const ux = V > 1e-6 ? m.v[0] / V : m.dir[0], uy = V > 1e-6 ? m.v[1] / V : m.dir[1], uz = V > 1e-6 ? m.v[2] / V : m.dir[2];
        let wx = m.dir[0], wy = m.dir[1], wz = m.dir[2]; // 行きたい向き（追尾）
        let ax = 0, ay = 0, az = 0, usePN = false, pnClose = 0;
        if (m.tgt) {
          const px = tx - tvx * back, py = ty - tvy * back, pz = tz - tvz * back;
          let rx = px - m.p[0], ry = py - m.p[1], rz = pz - m.p[2];
          const d = Math.hypot(rx, ry, rz) || 1e-6;
          if (!m.ground && !flare) {
            // シーカーの首振り: 速度の向きから gimbal° を超えたら見失う（まっすぐ）
            const cosA = (rx * ux + ry * uy + rz * uz) / d;
            if (cosA < Math.cos((c.gimbal != null ? c.gimbal : BASE.gimbal) * D2R)) { m.tgt = null; m.lost = true; m.dir[0] = ux; m.dir[1] = uy; m.dir[2] = uz; wx = ux; wy = uy; wz = uz; }
            else {
              // 比例航法（ZEM / tgo²）: 近づく速さで届くまでの秒、そのときの外れ（視線に垂直な分）を N / tgo² で消す
              const vrx = tvx - m.v[0], vry = tvy - m.v[1], vrz = tvz - m.v[2];
              const close = -(rx * vrx + ry * vry + rz * vrz) / d;
              pnClose = close;
              const tgo = d / Math.max(c.tgoClose != null ? c.tgoClose : BASE.tgoClose, close);
              let zx = rx + vrx * tgo, zy = ry + vry * tgo, zz = rz + vrz * tgo;
              const zl = (zx * rx + zy * ry + zz * rz) / d;
              zx -= zl * rx / d; zy -= zl * ry / d; zz -= zl * rz / d;
              const N = c.navN != null ? c.navN : BASE.navN, k = N / (tgo * tgo);
              ax = zx * k; ay = zy * k; az = zz * k;
              // 遠くて外れが大きいときも目標の方へは向く（追尾を少し混ぜる: 正面から外れて撃ったとき）
              usePN = true;
              wx = rx / d; wy = ry / d; wz = rz / d;
            }
          } else {
            // 地上の目標・フレア: 先読み（届くまでの秒 × 相手の速さ）の点へ
            const tgo = d / Math.max(c.tgoSpeed != null ? c.tgoSpeed : BASE.tgoSpeed, V);
            const lead = Math.min(tgo, c.leadMax != null ? c.leadMax : BASE.leadMax);
            let qx = px + tvx * lead, qy = py + tvy * lead, qz = pz + tvz * lead;
            if (m.ground) {
              // 建物の陰（losEvery 秒ごとのレイ）なら狙いを liftRate m/s で上げる。上から突っ込む（loftFrom m より遠い間は上を狙う）
              if (env.ray) {
                m.losT -= h;
                if (m.losT <= 0) {
                  m.losT = c.losEvery;
                  const lx = qx - m.p[0], ly = qy - m.p[1], lz = qz - m.p[2], dl = Math.hypot(lx, ly, lz);
                  if (dl > 1) m.blocked = !!(env.ray(m.p[0], m.p[1], m.p[2], lx / dl, ly / dl, lz / dl, dl, HIT) && HIT.t < dl - c.losClear);
                }
                m.lift = m.blocked ? Math.min(c.loftMax, m.lift + c.liftRate * h) : 0;
              }
              const hd = Math.hypot(qx - m.p[0], qz - m.p[2]);
              qy += Math.max(m.lift, Math.min(c.loftMax, Math.max(0, (hd - c.loftFrom) * c.loftK)));
            }
            rx = qx - m.p[0]; ry = qy - m.p[1]; rz = qz - m.p[2];
            const ql = Math.hypot(rx, ry, rz) || 1e-6;
            wx = rx / ql; wy = ry / ql; wz = rz / ql;
          }
        } else if (m.hasAim) {
          // 狙う点（ロック無し: 照準の先）。地上の目標と同じく上から・陰なら上げる
          let qx = m.aim[0], qy = m.aim[1], qz = m.aim[2];
          if (env.ray) {
            m.losT -= h;
            if (m.losT <= 0) {
              m.losT = c.losEvery;
              const lx = qx - m.p[0], ly = qy - m.p[1], lz = qz - m.p[2], dl = Math.hypot(lx, ly, lz);
              if (dl > 1) m.blocked = !!(env.ray(m.p[0], m.p[1], m.p[2], lx / dl, ly / dl, lz / dl, dl, HIT) && HIT.t < dl - c.losClear);
            }
            m.lift = m.blocked ? Math.min(c.loftMax, m.lift + c.liftRate * h) : 0;
          }
          const hd = Math.hypot(qx - m.p[0], qz - m.p[2]);
          qy += Math.max(m.lift, Math.min(c.loftMax, Math.max(0, (hd - c.loftFrom) * c.loftK)));
          const rx = qx - m.p[0], ry = qy - m.p[1], rz = qz - m.p[2], ql = Math.hypot(rx, ry, rz) || 1e-6;
          wx = rx / ql; wy = ry / ql; wz = rz / ql;
        }
        const Vt = Math.max(V, 50);
        const amax = c.turnG * G;
        let nx = ux, ny = uy, nz = uz;
        if (usePN) {
          // 横の加速度（速度に垂直な分）を turnG G までにして向きを回す
          const al = ax * ux + ay * uy + az * uz;
          let px2 = ax - al * ux, py2 = ay - al * uy, pz2 = az - al * uz;
          const pl = Math.hypot(px2, py2, pz2);
          // 目標が正面から大きく外れている（首振りの中だが PN だけでは遅い）: 追尾の向きへ回る分を下限に。
          // ただし近づいていて（衝突の三角形に乗っている）視線が首振りの半分より内側なら PN のまま（250 m/s で横切る目標には
          // 約 35° 先を狙う必要があり、下限が追尾へ引き戻して速さを失い、後ろから追いかけて寿命が尽きていた）
          const cosW = ux * wx + uy * wy + uz * wz;
          const gim = c.gimbal != null ? c.gimbal : BASE.gimbal;
          const pC = c.pursuitCos != null ? c.pursuitCos : BASE.pursuitCos, pG = c.pursuitGate != null ? c.pursuitGate : BASE.pursuitGate;
          if (cosW < pC && (pnClose <= 0 || cosW < Math.cos(gim * pG * D2R))) {
            const angW = Math.acos(Math.max(-1, Math.min(1, cosW)));
            let qx2 = wx - cosW * ux, qy2 = wy - cosW * uy, qz2 = wz - cosW * uz;
            const ql2 = Math.hypot(qx2, qy2, qz2) || 1e-6;
            const want = Math.min(amax, angW * Vt * (c.pursuitGain != null ? c.pursuitGain : BASE.pursuitGain));
            if (want > pl) { px2 = qx2 / ql2 * want; py2 = qy2 / ql2 * want; pz2 = qz2 / ql2 * want; }
          }
          const pl2 = Math.hypot(px2, py2, pz2);
          if (pl2 > amax) { const s = amax / pl2; px2 *= s; py2 *= s; pz2 *= s; }
          // 角速度 = a / V
          const ang = Math.hypot(px2, py2, pz2) / Vt * h;
          if (ang > 1e-9) {
            const pl3 = Math.hypot(px2, py2, pz2);
            const ex = px2 / pl3, ey = py2 / pl3, ez = pz2 / pl3, cs = Math.cos(ang), sn = Math.sin(ang);
            nx = ux * cs + ex * sn; ny = uy * cs + ey * sn; nz = uz * cs + ez * sn;
          }
        } else {
          // 追尾: 行きたい向きへ turnG G で曲がれる分だけ（今までの missile.js と同じ）
          const cosW = Math.max(-1, Math.min(1, ux * wx + uy * wy + uz * wz));
          const ang = Math.acos(cosW);
          const maxA = amax / Vt * h;
          if (ang > 1e-5) {
            const k = Math.min(1, maxA / ang);
            nx = ux + (wx - ux) * k; ny = uy + (wy - uy) * k; nz = uz + (wz - uz) * k;
          }
        }
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (motor) V = Math.min(c.speed, V + c.accel * h);
        else V = Math.max(c.minSpeed != null ? c.minSpeed : BASE.minSpeed, V - c.coastDrag * h);
        m.v[0] = nx * V; m.v[1] = ny * V; m.v[2] = nz * V;
        if (!m.tgt && !m.hasAim) { m.dir[0] = nx; m.dir[1] = ny; m.dir[2] = nz; }
      }
      m.p[0] += m.v[0] * h; m.p[1] += m.v[1] * h; m.p[2] += m.v[2] * h;
      if (m.t < c.armTime) { if (m.t > c.life) { m.dead = true; return EV_NONE; } continue; }
      // 当たり: 線分 o → p と目標（fuse m）・フレア（fuse × 0.6）・巻き込み・建物 / 地面 / 水
      const ev = m.ev;
      ev.ref = null; ev.water = false; ev.src = null; ev.air = false;
      let code = EV_NONE;
      if (m.tgt) {
        const px = tx - tvx * back, py = ty - tvy * back, pz = tz - tvz * back;
        if (closest(ox, oy, oz, m.p[0], m.p[1], m.p[2], px, py, pz, flare ? c.fuse * (c.flareFuseK != null ? c.flareFuseK : BASE.flareFuseK) : c.fuse, CL)) { code = EV_FUSE; ev.ref = flare ? null : m.tgt; ev.x = CL[1]; ev.y = CL[2]; ev.z = CL[3]; }
      }
      if (!code && env.collateral) {
        const r = env.collateral(m, ox, oy, oz, m.p[0], m.p[1], m.p[2], CL);
        if (r) { code = EV_FUSE; ev.ref = r; ev.x = CL[1]; ev.y = CL[2]; ev.z = CL[3]; }
      }
      if (!code && env.ray) {
        const sx = m.p[0] - ox, sy = m.p[1] - oy, sz = m.p[2] - oz, sl = Math.hypot(sx, sy, sz);
        if (sl > 1e-3 && env.ray(ox, oy, oz, sx / sl, sy / sl, sz / sl, sl, HIT)) { code = EV_IMPACT; ev.x = HIT.x; ev.y = HIT.y; ev.z = HIT.z; ev.water = !!HIT.water; ev.src = HIT.src || null; }
      }
      if (code) { ev.code = code; m.p[0] = ev.x; m.p[1] = ev.y; m.p[2] = ev.z; m.dead = true; return code; }
      if (m.t > c.life) { ev.code = EV_EXPIRE; ev.x = m.p[0]; ev.y = m.p[1]; ev.z = m.p[2]; ev.air = true; m.dead = true; return EV_EXPIRE; }
    }
    return EV_NONE;
  }

  // フレア: { p:[3], v:[3], life }。落ちながら遅くなる
  function flareStep(f, dt, c) {
    f.life -= dt;
    f.v[1] -= G * (c && c.flareGravity != null ? c.flareGravity : BASE.flareGravity) * dt;
    const k = Math.max(0, 1 - dt * (c && c.flareDrag != null ? c.flareDrag : BASE.flareDrag));
    f.v[0] *= k; f.v[1] *= k; f.v[2] *= k;
    f.p[0] += f.v[0] * dt; f.p[1] += f.v[1] * dt; f.p[2] += f.v[2] * dt;
    return f.life > 0;
  }

  // フレアにだまされるか（1 発あたり decoyRolls 回まで。乱数はミサイルの seed から）
  function decoyRoll(m) {
    const c = m.c;
    const rolls = c.decoyRolls != null ? c.decoyRolls : BASE.decoyRolls;
    if (m.rolls >= rolls) return false;
    m.rolls++;
    return rngNext(m) < (c.decoyChance != null ? c.decoyChance : BASE.decoyChance);
  }
  // 0..n-1 の整数（どのフレアを追うか。ミサイルの乱数）
  function pick(m, n) { return Math.min(n - 1, Math.floor(rngNext(m) * n)); }

  // ref を追っている一番近いミサイル。out = { dist, tti, bearing, elevation, missile }（使い回し）か null
  function incoming(list, ref, px, py, pz, hx, hz, out, tv) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const m = list[i].core || list[i];
      if (m.dead || m.tgt !== ref) continue;
      const d = Math.hypot(m.p[0] - px, m.p[1] - py, m.p[2] - pz);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const it = list[best], m = it.core || it;
    const dx = m.p[0] - px, dy = m.p[1] - py, dz = m.p[2] - pz, d = bd || 1e-6;
    const rvx = m.v[0] - (tv ? tv[0] : 0), rvy = m.v[1] - (tv ? tv[1] : 0), rvz = m.v[2] - (tv ? tv[2] : 0);
    const close = Math.max(1, -(rvx * dx + rvy * dy + rvz * dz) / d);
    const hl = Math.hypot(hx, hz) || 1, fx = hx / hl, fz = hz / hl;
    // 機首から右が正（右 = (-fz, fx)）
    const fwd = dx * fx + dz * fz, right = dx * -fz + dz * fx;
    out.dist = d; out.tti = d / close;
    out.bearing = Math.atan2(right, fwd) / D2R;
    out.elevation = Math.atan2(dy, Math.hypot(dx, dz)) / D2R;
    out.missile = it;
    return out;
  }

  // 撃つ型（D2）。cfg = { types }、counts = { aim9x, aim120 }、target = 'air' | 'ground' | null、dist m、offBore = 速度の向きからの度
  function pickType(cfg, counts, target, dist, offBore) {
    const T = (cfg && cfg.types) || TYPES;
    const n9 = (counts && counts.aim9x) | 0, n120 = (counts && counts.aim120) | 0;
    if (target === 'air') {
      const a9 = T.aim9x || TYPES.aim9x;
      const maxR = a9.maxRange != null ? a9.maxRange : TYPES.aim9x.maxRange, gim = a9.gimbal != null ? a9.gimbal : TYPES.aim9x.gimbal;
      if (n9 > 0 && dist <= maxR && (offBore == null || offBore <= gim)) return 'aim9x';
      if (n120 > 0) return 'aim120';
      if (n9 > 0) return 'aim9x';
      return null;
    }
    if (n120 > 0) return 'aim120';
    if (n9 > 0) return 'aim9x';
    return null;
  }

  return { TYPES, BASE, EV_NONE, EV_FUSE, EV_IMPACT, EV_EXPIRE, newState, create, step, flareStep, decoyRoll, pick, closest, incoming, pickType, rng, rngNext };
});
