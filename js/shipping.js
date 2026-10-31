// 船の交通（THREE / DOM 非依存。Node・サーバーもそのまま require できる）。
//   MR.Waves      決まった波の場: height(x, z, t) / sample(x, z, t, out) → { h, sx, sz }（傾き）。game.json の waves
//                 { amp, comps: [[波長 m, 向き 度, 割合], …], max }。成分ごとに深い水の速さ c = √(gL/2π)。|h| ≤ max
//   MR.ShipRoutes 航路: build(route, type) → 折れ線の角を turnRadius の円弧で丸めた閉じた道（closed）か、行き（右へ lanes/2）と
//                 帰り（反対側）の 2 本を結んだ道（pingpong）。停まる所（stops [{ x, z, dwell }]）は道のいちばん近い点。
//                 停まる所の間は台形の速さ（accel → cruise → decel）。周期 T = Σ(区間の時間 + dwell)
//   MR.Shipping   船団（level の shipping.fleets を順に。押す船 convoy の艀は次の番号）。update(t) で全部の pose を
//                 時間の純粋な関数で決める（同じ t ならどの端末・サーバーでも同じ）。MR.Platforms のリストの供給元（id 's:<番号>'）
//                 entry = { id, typeId, pose { x, y, z, yaw, pitch, roll }, prevPose, vel { x, y, z }, wy（ヨーの速さ rad/s）, speed,
//                           flags { solid: true, strikes: true }, bbox（ローカル）, heel（見た目の傾き rad）, dwelling }
//                 events: update のたびに出発（'depart'）を events に入れる（汽笛）
// 向き: 前 = (sin yaw, cos yaw)（vehicle.js と同じ）。船のローカルは船首 +Z・左舷 +X（ships.json）
(function (root) {
  const MR = root.MR || (root.MR = {});
  const G = 9.81;
  const D2R = Math.PI / 180;
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

  // ---------- 波 ----------
  class Waves {
    constructor(cfg) {
      cfg = cfg || {};
      this.amp = num(cfg.amp, 0.12);
      this.max = num(cfg.max, 0.45);
      this.scale = 1; // 天気の風（M4）
      const comps = Array.isArray(cfg.comps) && cfg.comps.length ? cfg.comps : [[22, 35, 1], [13, 70, 0.6], [7.5, 10, 0.35], [4.2, 120, 0.2]];
      this.comps = comps.map((c, i) => {
        const L = Math.max(1, num(c[0], 10)), a = num(c[1], 0) * D2R, k = 2 * Math.PI / L;
        return { L, k, kx: Math.sin(a) * k, kz: Math.cos(a) * k, w: Math.sqrt(G * k), rel: num(c[2], 1), ph: i * 1.7, c: Math.sqrt(G * L / (2 * Math.PI)), dir: a };
      });
      let s = 0;
      for (const c of this.comps) s += Math.abs(c.rel);
      this._norm = s > 0 ? 1 / s : 1;
    }
    height(x, z, t) {
      const A = this.amp * this.scale * this._norm;
      let h = 0;
      for (let i = 0; i < this.comps.length; i++) { const c = this.comps[i]; h += c.rel * Math.sin(c.kx * x + c.kz * z - c.w * t + c.ph); }
      h *= A;
      return h > this.max ? this.max : h < -this.max ? -this.max : h;
    }
    // 高さと傾き（∂h/∂x, ∂h/∂z）
    sample(x, z, t, out) {
      out = out || {};
      const A = this.amp * this.scale * this._norm;
      let h = 0, sx = 0, sz = 0;
      for (let i = 0; i < this.comps.length; i++) {
        const c = this.comps[i], p = c.kx * x + c.kz * z - c.w * t + c.ph;
        h += c.rel * Math.sin(p);
        const co = c.rel * Math.cos(p);
        sx += co * c.kx; sz += co * c.kz;
      }
      h *= A;
      out.h = h > this.max ? this.max : h < -this.max ? -this.max : h;
      out.sx = sx * A; out.sz = sz * A;
      return out;
    }
    // water.js の法線の流れ（いちばん大きい 2 成分の向きと速さ）
    flow() {
      const s = this.comps.slice().sort((a, b) => b.rel - a.rel).slice(0, 2);
      return s.map((c) => ({ dx: Math.sin(c.dir), dz: Math.cos(c.dir), c: c.c, L: c.L }));
    }
  }

  // ---------- 航路 ----------
  // 道の部品: 直線 { L: 1, x0, z0, ux, uz, len } / 円弧 { L: 0, cx, cz, r, a0, sw（符号つきの角度）, len }
  function filletLoop(pts, R) {
    const n = pts.length, segs = [];
    const corners = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      let ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      ax /= la; az /= la; bx /= lb; bz /= lb;
      const dot = Math.max(-1, Math.min(1, ax * bx + az * bz)), th = Math.acos(dot);
      if (th < 1e-4) { corners.push({ A: p1, B: p1, arc: null }); continue; }
      let t = R * Math.tan(th / 2);
      const tmax = Math.min(la, lb) * 0.5;
      if (t > tmax) t = tmax;
      const r = t / Math.tan(th / 2);
      const A = [p1[0] - ax * t, p1[1] - az * t], B = [p1[0] + bx * t, p1[1] + bz * t];
      const cr = ax * bz - az * bx; // > 0: 左へ曲がる（x-z 平面で反時計回り）
      // 中心: A から曲がる側の法線へ r
      const nx = cr > 0 ? -az : az, nz = cr > 0 ? ax : -ax;
      const cx = A[0] + nx * r, cz = A[1] + nz * r;
      const a0 = Math.atan2(A[1] - cz, A[0] - cx), a1 = Math.atan2(B[1] - cz, B[0] - cx);
      let sw = a1 - a0;
      if (cr > 0) { while (sw < 0) sw += 2 * Math.PI; } else { while (sw > 0) sw -= 2 * Math.PI; }
      corners.push({ A, B, arc: { L: 0, cx, cz, r, a0, sw, len: Math.abs(sw) * r } });
    }
    for (let i = 0; i < n; i++) {
      const c = corners[i], nx = corners[(i + 1) % n];
      if (c.arc) segs.push(c.arc);
      const x0 = c.B[0], z0 = c.B[1], x1 = nx.A[0], z1 = nx.A[1], len = Math.hypot(x1 - x0, z1 - z0);
      if (len > 1e-6) segs.push({ L: 1, x0, z0, ux: (x1 - x0) / len, uz: (z1 - z0) / len, len });
    }
    let s = 0;
    for (const g of segs) { g.s0 = s; s += g.len; }
    return { segs, length: s };
  }

  // 折れ線を右（前 (ux, uz) に対して (uz, -ux)）へ d ずらす（角は延長線の交点）
  function offsetLine(pts, d) {
    const n = pts.length, out = [];
    const nrm = (a, b) => { const x = b[0] - a[0], z = b[1] - a[1], l = Math.hypot(x, z); return [z / l, -x / l]; };
    for (let i = 0; i < n; i++) {
      if (i === 0) { const m = nrm(pts[0], pts[1]); out.push([pts[0][0] + m[0] * d, pts[0][1] + m[1] * d]); continue; }
      if (i === n - 1) { const m = nrm(pts[n - 2], pts[n - 1]); out.push([pts[i][0] + m[0] * d, pts[i][1] + m[1] * d]); continue; }
      const m1 = nrm(pts[i - 1], pts[i]), m2 = nrm(pts[i], pts[i + 1]);
      let mx = m1[0] + m2[0], mz = m1[1] + m2[1];
      const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      const k = d / Math.max(0.3, mx * m1[0] + mz * m1[1]);
      out.push([pts[i][0] + mx * k, pts[i][1] + mz * k]);
    }
    return out;
  }

  class Route {
    constructor(def, type) {
      this.id = def.id;
      type = type || {};
      const R = num(type.turnRadius, 60);
      let loop;
      if (def.loop === 'pingpong') {
        const half = Math.max(num(def.lanes, 0), 2 * R) / 2;
        const out = offsetLine(def.pts, half), back = offsetLine(def.pts.slice().reverse(), half);
        loop = out.concat(back);
      } else loop = def.pts.slice();
      // 同じ点が続く所を除く
      loop = loop.filter((p, i) => { const q = loop[(i - 1 + loop.length) % loop.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01; });
      const f = filletLoop(loop, R);
      this.segs = f.segs; this.length = f.length; this.poly = loop;
      this.cruise = Math.max(0.1, num(type.cruise, 6)); this.accel = Math.max(0.01, num(type.accel, 0.3)); this.decel = Math.max(0.01, num(type.decel, 0.3));
      // 停まる所（道のいちばん近い点の s）
      const stops = (def.stops || []).map((st) => {
        let x = st.x, z = st.z;
        if (typeof st.at === 'number' && def.pts[st.at]) { x = def.pts[st.at][0]; z = def.pts[st.at][1]; }
        return { s: this.nearestS(x, z), dwell: Math.max(0, num(st.dwell, 20)), x, z };
      }).sort((a, b) => a.s - b.s);
      this.stops = stops;
      // 区間（停まる所から次の停まる所まで。無ければ一周を一定の速さで）
      this.legs = [];
      let t = 0;
      if (!stops.length) {
        this.legs.push({ s0: 0, d: this.length, t0: t, dwell: 0, T: this.length / this.cruise, flat: true });
        t += this.length / this.cruise;
      } else {
        for (let i = 0; i < stops.length; i++) {
          const a = stops[i], b = stops[(i + 1) % stops.length];
          let d = b.s - a.s; if (d <= 0) d += this.length;
          const prof = this._profile(d);
          this.legs.push(Object.assign({ s0: a.s, d, t0: t, dwell: a.dwell }, prof));
          t += a.dwell + prof.T;
        }
      }
      this.period = Math.max(1e-3, t);
    }
    _profile(d) {
      const v = this.cruise, a = this.accel, b = this.decel;
      const da = v * v / (2 * a), db = v * v / (2 * b);
      if (d >= da + db) return { T: v / a + v / b + (d - da - db) / v, vp: v, ta: v / a, tc: (d - da - db) / v, tb: v / b };
      const vp = Math.sqrt(2 * d * a * b / (a + b));
      return { T: vp / a + vp / b, vp, ta: vp / a, tc: 0, tb: vp / b };
    }
    nearestS(x, z) {
      let best = Infinity, bs = 0;
      for (const g of this.segs) {
        let s, px, pz;
        if (g.L) { s = Math.max(0, Math.min(g.len, (x - g.x0) * g.ux + (z - g.z0) * g.uz)); px = g.x0 + g.ux * s; pz = g.z0 + g.uz * s; }
        else {
          // 円弧: 角度を円弧の範囲に収める
          let a = Math.atan2(z - g.cz, x - g.cx) - g.a0;
          const sg = g.sw > 0 ? 1 : -1;
          a *= sg; while (a < 0) a += 2 * Math.PI; while (a > 2 * Math.PI) a -= 2 * Math.PI;
          const W = Math.abs(g.sw);
          if (a > W) a = (a - W < 2 * Math.PI - a) ? W : 0;
          s = a * g.r; const an = g.a0 + sg * a; px = g.cx + Math.cos(an) * g.r; pz = g.cz + Math.sin(an) * g.r;
        }
        const d = Math.hypot(px - x, pz - z);
        if (d < best) { best = d; bs = g.s0 + s; }
      }
      return bs;
    }
    // 道の s の点と向き・曲がり（1/R、左が正）を out へ
    at(s, out) {
      const L = this.length;
      s = ((s % L) + L) % L;
      const segs = this.segs;
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].s0 <= s) lo = m; else hi = m - 1; }
      const g = segs[lo], u = s - g.s0;
      if (g.L) { out.x = g.x0 + g.ux * u; out.z = g.z0 + g.uz * u; out.tx = g.ux; out.tz = g.uz; out.k = 0; }
      else {
        const sg = g.sw > 0 ? 1 : -1, a = g.a0 + sg * u / g.r;
        out.x = g.cx + Math.cos(a) * g.r; out.z = g.cz + Math.sin(a) * g.r;
        out.tx = -Math.sin(a) * sg; out.tz = Math.cos(a) * sg;
        out.k = sg / g.r; // x-z で反時計回り = ヨーが減る向き（下で符号を合わせる）
      }
      return out;
    }
    // 周期の中の時刻 τ → { s, speed, dwelling, leg }
    state(tau, out) {
      const P = this.period;
      tau = ((tau % P) + P) % P;
      const legs = this.legs;
      let i = legs.length - 1;
      for (let k = 0; k < legs.length; k++) if (tau < legs[k].t0 + legs[k].dwell + legs[k].T) { i = k; break; }
      const g = legs[i];
      let u = tau - g.t0;
      out.leg = i;
      if (g.flat) { out.s = g.s0 + this.cruise * u; out.speed = this.cruise; out.dwelling = false; return out; }
      if (u < g.dwell) { out.s = g.s0; out.speed = 0; out.dwelling = true; return out; }
      u -= g.dwell;
      out.dwelling = false;
      const a = this.accel, b = this.decel;
      if (u < g.ta) { out.s = g.s0 + 0.5 * a * u * u; out.speed = a * u; }
      else if (u < g.ta + g.tc) { const w = u - g.ta; out.s = g.s0 + 0.5 * a * g.ta * g.ta + g.vp * w; out.speed = g.vp; }
      else {
        const w = Math.min(g.tb, u - g.ta - g.tc);
        out.s = g.s0 + 0.5 * a * g.ta * g.ta + g.vp * g.tc + g.vp * w - 0.5 * b * w * w;
        out.speed = Math.max(0, g.vp - b * w);
      }
      return out;
    }
    // 出発の時刻（周期の中、各停まる所の dwell の終わり）
    departTimes() { return this.legs.filter((g) => !g.flat).map((g) => g.t0 + g.dwell); }
  }

  const ShipRoutes = { build: (def, type) => new Route(def, type), Route, filletLoop, offsetLine };

  // ---------- 船団 ----------
  class Shipping {
    // plan: level の shipping、cfg: game.json の ships、data: ships.json、opts: { waterY, waves, offset }
    constructor(plan, cfg, data, opts) {
      opts = opts || {};
      this.plan = plan || {};
      this.cfg = cfg || {};
      this.data = data || { types: {} };
      this.waterY = num(opts.waterY, -2);
      this.waves = opts.waves || null;
      this.offset = num(opts.offset, 0);   // 時計のずれ（ソロは起動ごとに乱数）
      this.prefix = 's';
      this.types = {};
      this.list = [];
      this.events = [];
      this.t = null;
      const types = this.cfg.types || {};
      const routes = {};
      for (const r of this.plan.routes || []) routes[r.id] = r;
      this.routes = {};
      for (const fl of this.plan.fleets || []) {
        const r = routes[fl.route], type = types[fl.type] || {}, td = this.data.types[fl.type];
        if (!r || !td) continue;
        const key = fl.route + '|' + fl.type;
        const route = this.routes[key] || (this.routes[key] = new Route(r, type));
        const count = Math.max(1, num(fl.count, 1)), spacing = num(fl.spacing, 1 / count);
        for (let k = 0; k < count; k++) {
          const e = this._entry(fl.type, td);
          e.route = route; e.phase = spacing * k * route.period + num(fl.phase, 0) * route.period;
          e.heel = num(type.heel, 0) * D2R;
          this.list.push(e);
          if (type.convoy && this.data.types[type.convoy]) {
            const cd = this.data.types[type.convoy];
            const c = this._entry(type.convoy, cd);
            // 押す船の前（push_face）と艀の後ろ（push_b）を合わせる
            const pf = (td.empties && td.empties.push_face) || [0, 0, td.length / 2];
            const pb = (cd.empties && cd.empties.push_b) || [0, 0, -cd.length / 2];
            c.convoyOf = e; c.offsetZ = pf[2] - pb[2];
            e.convoy = c;
            this.list.push(c);
          }
        }
      }
      for (const e of this.list) if (!this.types[e.typeId]) this.types[e.typeId] = this.data.types[e.typeId];
      this._st = { s: 0, speed: 0, dwelling: false, leg: 0 };
      this._at = { x: 0, z: 0, tx: 0, tz: 1, k: 0 };
    }
    _entry(typeId, td) {
      const e = {
        id: this.prefix + ':' + this.list.length, idx: this.list.length, typeId, data: td,
        pose: { x: 0, y: this.waterY, z: 0, yaw: 0, pitch: 0, roll: 0 },
        prevPose: { x: 0, y: this.waterY, z: 0, yaw: 0, pitch: 0, roll: 0 },
        vel: { x: 0, y: 0, z: 0 }, wy: 0, speed: 0, dwelling: false,
        flags: { solid: true, strikes: true, doorsClosed: 0 },
        bbox: td.bbox, radius: 0, heel: 0, route: null, phase: 0, convoyOf: null, offsetZ: 0
      };
      const b = td.bbox;
      e.radius = Math.hypot(Math.max(-b[0][0], b[1][0]), Math.max(-b[0][2], b[1][2]));
      return e;
    }
    // 時刻 t（秒。Platforms.Clock）の pose を out へ（e が艀なら押す船から）
    poseAt(e, t, out) {
      out = out || { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, wy: 0, vx: 0, vz: 0, dwelling: false };
      const lead = e.convoyOf || e;
      const st = lead.route.state(t + this.offset + lead.phase, this._st);
      const a = lead.route.at(st.s, this._at);
      out.x = a.x; out.z = a.z;
      out.yaw = Math.atan2(a.tx, a.tz);
      out.speed = st.speed; out.dwelling = st.dwelling;
      // 前 (sin yaw, cos yaw)。x-z で反時計回り（k > 0）はヨーが減る
      out.wy = -a.k * st.speed;
      out.vx = a.tx * st.speed; out.vz = a.tz * st.speed;
      out.pitch = 0; out.roll = 0;
      if (e.convoyOf) {
        const s = Math.sin(out.yaw), c = Math.cos(out.yaw), oz = e.offsetZ;
        out.x += s * oz; out.z += c * oz;
        // 剛体: 速さ = v + ω × r
        out.vx += out.wy * (c * oz); out.vz += -out.wy * (s * oz);
      }
      out.y = this.waterY + (this.waves ? this.waves.height(out.x, out.z, t) * Math.min(1, 10 / Math.max(10, e.data.length)) * 0.5 : 0);
      return out;
    }
    update(t) {
      const prevT = this.t;
      this.t = t;
      this.events.length = 0;
      const o = this._po || (this._po = {});
      for (const e of this.list) {
        const p = e.pose, q = e.prevPose;
        q.x = p.x; q.y = p.y; q.z = p.z; q.yaw = p.yaw;
        this.poseAt(e, t, o);
        p.x = o.x; p.y = o.y; p.z = o.z; p.yaw = o.yaw; p.pitch = 0; p.roll = 0;
        e.vel.x = o.vx; e.vel.z = o.vz; e.vel.y = 0; e.wy = o.wy; e.speed = o.speed;
        if (prevT !== null && !e.convoyOf && o.dwelling === false && e.dwelling === true) this.events.push({ t: 'depart', e });
        e.dwelling = o.dwelling;
        if (prevT === null) { q.x = p.x; q.y = p.y; q.z = p.z; q.yaw = p.yaw; }
      }
      return this.events;
    }
    // MR.Platforms の供給元: 中心から r の中にかかる船
    near(x, y, z, r, out) {
      let n = 0;
      for (const e of this.list) {
        const R = e.radius + r;
        const dx = e.pose.x - x, dz = e.pose.z - z;
        if (dx * dx + dz * dz <= R * R) out[n++] = e;
      }
      return n;
    }
    byId(id) { for (const e of this.list) if (e.id === id) return e; return null; }
  }

  MR.Waves = Waves;
  MR.ShipRoutes = ShipRoutes;
  MR.Shipping = Shipping;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Waves, ShipRoutes, Shipping };
})(typeof window !== 'undefined' ? window : globalThis);
