// バトルロイヤル（ソロ。街）。
//   MR.Royale      … THREE にも DOM にも依存しない部分（フェーズ D でサーバーが持つ）: 安全地帯の段階と円、参加者（仮想）の動き・脱落。
//                    同じ seed なら同じ円（中心は前の円の中・陸の上）。参加者の脱落は乱数（Math.random でなく seed の乱数）。
//   MR.RoyaleMode  … game.js とのつなぎ: 輸送ヘリ → 降下（自由落下 → パラシュート）、近くの参加者を本物の敵（MR.EnemyDirector）にする /
//                    遠くなったら仮想に戻す、安全地帯の外のダメージ（画面の縁の色・音）、壁（青い円筒）、HUD（残り・縮小までの時間）、
//                    キルフィード（「兵士 12 ▸ 兵士 7」）、結果（「優勝！」/「#7 / 31」・撃破・生存時間・「もう一度」「タイトルへ」）。
//
// ■ 段階: phases = [{ wait, shrink, r, dps }…]（game.json royale.phases、無ければ midtown.json の rings）。
//   段階 i: wait 秒は今の円のまま（次の円を白で見せる）→ shrink 秒で次の円まで縮む → i + 1。外にいると dps / 秒のダメージ（段階 i の dps）。
//   最初の円 = rings.center・startR。最後（r = 0）まで縮むので、必ず終わる。
// ■ 参加者 contestants 人（「兵士 n」）: 降下（輸送ヘリの航路の近くに着地）→ 次の円の中の陸の点へ歩く（virtual.speed m/s）。
//   円の外では体力が減って脱落する。撃ち合い（仮想）は、残りが「時間に対する目安」（N × (1 − 進み)^pace）より多いぶんだけ起きる
//   （近い 2 人のどちらかが脱落。外にいる・遠くにいる人ほど脱落しやすい）。
//   プレイヤーから realRange m 以内の着地済みの参加者は、MR.EnemyDirector が本物の敵として出す（prefer = その位置の近くに出し、onSpawn で
//   結び付ける）。本物の敵が倒されたら脱落、遠くなって消されたら仮想に戻る（位置は敵の位置）。
(function (root) {
  const MR = root.MR || (root.MR = {});

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DEFAULTS = {
    contestants: 30, namePrefix: '兵士', playerName: 'あなた',
    realRange: 120, maxReal: 5, timeScale: 1,
    phases: null, center: null, startR: null, randomCenter: null,
    virtual: { speed: 4.2, hp: 100, spread: 1100, pace: 1.25, fightRange: 450 },
    transport: { enabled: true, height: 420, speed: 85, margin: 250, offset: 700 },
    fall: { speed: 55, minSpeed: 40, horiz: 24, accel: 2.5, chuteHeight: 90, chuteSpeed: 8, chuteFwdMax: 12, chuteBack: 4, chuteDown: 4.2, chuteDownMin: 2.8, chuteDownMax: 6.5, chuteStrafe: 3, openTime: 0.62 },
    zone: { wallHeight: 700, wallOpacity: 0.45, tick: 1 },
    resultDelay: 1.6
  };

  function merge(base, over) {
    const out = Object.assign({}, base);
    if (!over) return out;
    for (const k of Object.keys(over)) {
      const v = over[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? merge(base[k], v) : v;
    }
    return out;
  }

  // ==================================================================================================================
  class Royale {
    // city: MR.CityGen、cfg: game.json royale（無いキーは DEFAULTS）、seed: 整数
    constructor(city, cfg, seed) {
      this.city = city;
      this.cfg = merge(DEFAULTS, cfg || {});
      this.seed = seed >>> 0;
      this.rnd = rng(this.seed ^ 0x51ed27);
      const rings = (city.plan && city.plan.rings) || {};
      const ts = this.cfg.timeScale || 1;
      this.phases = (this.cfg.phases || rings.phases || [{ wait: 60, shrink: 60, r: 0, dps: 5 }]).map((p) => ({ wait: p.wait * ts, shrink: p.shrink * ts, r: p.r, dps: p.dps }));
      const c0 = this.cfg.center || rings.center || [0, 0];
      this.b = (city.plan && city.plan.bounds) || { minX: -2900, maxX: 3100, minZ: -3000, maxZ: 3000 };
      this.zone = {
        phase: 0, stage: 'wait', t: 0,
        cur: { x: c0[0], z: c0[1], r: this.cfg.startR || rings.startR || 4300 },
        from: null, next: null, dps: this.phases[0].dps
      };
      this.zone.next = this._pickNext(this.zone.cur, this.phases[0].r);
      this.total = 0;
      for (const p of this.phases) this.total += p.wait + p.shrink;
      this.time = 0;
      this.started = false;
      this.contestants = [];
      this.events = [];          // { t: 'kill', killer, victim, how } … RoyaleMode が読んで空にする
      this.flight = null;
      this._tick = 0;
    }

    // 陸か（水でも地図の外でもない）
    isLand(x, z) {
      const b = this.b;
      if (x < b.minX + 40 || x > b.maxX - 40 || z < b.minZ + 40 || z > b.maxZ - 40) return false;
      return !this.city.isWater(x, z);
    }

    // 次の円: 今の円の中（次の円がはみ出さない）で陸の上の中心。地図の外にはみ出しすぎない
    _pickNext(cur, r) {
      const room = Math.max(0, cur.r - r);
      for (let i = 0; i < 60; i++) {
        const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * room * (i < 40 ? 1 : 0.5);
        const x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
        if (r > 0 && !this.isLand(x, z)) continue;
        if (r === 0 && !this.isLand(x, z)) continue;
        const b = this.b, m = Math.min(r * 0.4, 600);
        if (x - r < b.minX - m || x + r > b.maxX + m || z - r < b.minZ - m || z + r > b.maxZ + m) continue;
        return { x: Math.round(x), z: Math.round(z), r };
      }
      return { x: cur.x, z: cur.z, r };
    }

    // 輸送ヘリの航路: 最初の円（次の円）の近くを通る直線。地図の端から端まで（margin 内側）
    makeFlight() {
      const tc = this.cfg.transport, b = this.b;
      const n = this.zone.next;
      const a = this.rnd() * Math.PI * 2;
      const off = (this.rnd() - 0.5) * 2 * (tc.offset || 0);
      const px = n.x + Math.cos(a + Math.PI / 2) * off, pz = n.z + Math.sin(a + Math.PI / 2) * off;
      const dx = Math.cos(a), dz = Math.sin(a);
      // 直線と（margin だけ内側の）地図の矩形の交わり
      const m = tc.margin || 200;
      const x0 = b.minX + m, x1 = b.maxX - m, z0 = b.minZ + m, z1 = b.maxZ - m;
      let t0 = -Infinity, t1 = Infinity;
      const clip = (p, d, lo, hi) => {
        if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 1; t1 = 0; } return; }
        let ta = (lo - p) / d, tb = (hi - p) / d;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      };
      clip(px, dx, x0, x1); clip(pz, dz, z0, z1);
      if (!(t1 > t0)) { t0 = -2000; t1 = 2000; }
      this.flight = { x0: px + dx * t0, z0: pz + dz * t0, x1: px + dx * t1, z1: pz + dz * t1, len: t1 - t0, dx, dz, y: tc.height, speed: tc.speed };
      return this.flight;
    }

    // 参加者を作る: 航路があれば航路の近くに、無ければホットゾーン・陸の点に。landAt = 着地する時刻（秒）
    makeContestants(n) {
      const v = this.cfg.virtual, f = this.flight;
      const spots = (this.city.spawnPoints && this.city.spawnPoints('online')) || [];
      for (let i = 0; i < n; i++) {
        let x = 0, z = 0, landAt = 0, ok = false;
        for (let k = 0; k < 30 && !ok; k++) {
          if (f) {
            const u = 0.08 + this.rnd() * 0.84;
            const lat = (this.rnd() + this.rnd() - 1) * (v.spread || 1000);
            x = f.x0 + (f.x1 - f.x0) * u - f.dz * lat; z = f.z0 + (f.z1 - f.z0) * u + f.dx * lat;
            landAt = u * f.len / f.speed + 18 + this.rnd() * 14;
          } else if (spots.length && this.rnd() < 0.6) {
            const s = spots[Math.floor(this.rnd() * spots.length)];
            x = s.x + (this.rnd() - 0.5) * 60; z = s.z + (this.rnd() - 0.5) * 60; landAt = 0;
          } else {
            x = this.b.minX + this.rnd() * (this.b.maxX - this.b.minX); z = this.b.minZ + this.rnd() * (this.b.maxZ - this.b.minZ); landAt = 0;
          }
          ok = this.isLand(x, z);
        }
        if (!ok && spots.length) { const s = spots[i % spots.length]; x = s.x; z = s.z; }
        this.contestants.push({ id: i + 1, name: this.cfg.namePrefix + ' ' + (i + 1), x, z, tx: x, tz: z, alive: true, hp: v.hp || 100, landAt, landed: landAt <= 0, real: null, kills: 0, outT: 0 });
      }
      return this.contestants;
    }

    start(t) { this.started = true; this.time = t || 0; this.zone.t = 0; }

    // 残りの参加者（プレイヤーは数えない）
    aliveCount() { let n = 0; for (const c of this.contestants) if (c.alive) n++; return n; }

    // (x, z) が今の円の外に何 m か（中なら 0 以下）
    outside(x, z) { const c = this.zone.cur; return Math.hypot(x - c.x, z - c.z) - c.r; }
    // 安全地帯のダメージを受けるか（最後に円が 0 になったら全員）
    isOut(x, z) { return this.outside(x, z) > 0 || this.zone.cur.r <= 0.5; }

    // 今の段階の残り秒と、表示用の言葉
    timer() {
      const z = this.zone, p = this.phases[z.phase];
      if (!p || z.stage === 'end') return { stage: 'end', left: 0 };
      return { stage: z.stage, left: Math.max(0, (z.stage === 'wait' ? p.wait : p.shrink) - z.t) };
    }

    // 進み（0..1）
    progress() {
      let done = 0;
      for (let i = 0; i < this.zone.phase && i < this.phases.length; i++) done += this.phases[i].wait + this.phases[i].shrink;
      const p = this.phases[this.zone.phase];
      if (p) done += this.zone.stage === 'wait' ? Math.min(this.zone.t, p.wait) : p.wait + Math.min(this.zone.t, p.shrink);
      else done = this.total;
      return Math.max(0, Math.min(1, done / Math.max(1, this.total)));
    }

    // 毎フレーム。player: { x, z, alive }
    update(dt, player) {
      if (!this.started) return;
      this.time += dt;
      this._zone(dt);
      this._tick += dt;
      if (this._tick >= 1) { const s = this._tick; this._tick = 0; this._simulate(s, player); }
    }

    _zone(dt) {
      const z = this.zone;
      if (z.stage === 'end') return;
      const p = this.phases[z.phase];
      z.t += dt;
      z.dps = p.dps;
      if (z.stage === 'wait') {
        if (z.t >= p.wait) { z.stage = 'shrink'; z.t = 0; z.from = { x: z.cur.x, z: z.cur.z, r: z.cur.r }; this.events.push({ t: 'shrink', phase: z.phase }); }
      } else if (z.stage === 'shrink') {
        const k = Math.min(1, p.shrink > 0 ? z.t / p.shrink : 1);
        z.cur = { x: z.from.x + (z.next.x - z.from.x) * k, z: z.from.z + (z.next.z - z.from.z) * k, r: z.from.r + (z.next.r - z.from.r) * k };
        if (k >= 1) {
          z.phase++;
          z.t = 0;
          if (z.phase >= this.phases.length) { z.stage = 'end'; z.next = null; z.dps = this.phases[this.phases.length - 1].dps; }
          else { z.stage = 'wait'; z.next = this._pickNext(z.cur, this.phases[z.phase].r); z.dps = this.phases[z.phase].dps; this.events.push({ t: 'phase', phase: z.phase }); }
          for (const c of this.contestants) { c.tx = null; }
        }
      }
    }

    // 1 秒ごと: 仮想の参加者の移動・安全地帯のダメージ・撃ち合い（目安より多いぶん）
    _simulate(dt, player) {
      const v = this.cfg.virtual, z = this.zone;
      const target = z.next || z.cur;
      for (const c of this.contestants) {
        if (!c.alive || c.real) continue;
        if (!c.landed) { if (this.time >= c.landAt) c.landed = true; else continue; }
        // 目的地: 次の円の中の陸の点（円が変わったら選び直す）
        if (c.tx == null || Math.hypot(c.tx - c.x, c.tz - c.z) < 5) {
          let ok = false;
          for (let k = 0; k < 12 && !ok; k++) {
            const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * target.r * 0.8;
            c.tx = target.x + Math.cos(a) * d; c.tz = target.z + Math.sin(a) * d;
            ok = target.r < 1 || this.isLand(c.tx, c.tz);
          }
          if (!ok) { c.tx = target.x; c.tz = target.z; }
          // 円の中にもういて、急ぐ必要が無ければ少しだけ動く
          if (this.outside(c.x, c.z) < -50 && Math.hypot(target.x - c.x, target.z - c.z) < target.r) { c.tx = c.x + (c.tx - c.x) * 0.15; c.tz = c.z + (c.tz - c.z) * 0.15; }
        }
        const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
        const sp = (v.speed || 4) * dt * (this.outside(c.x, c.z) > 0 ? 1.5 : 1); // 外にいるときは急ぐ（車に乗った見込み）
        if (d > 1e-3) { const s = Math.min(1, sp / d); c.x += dx * s; c.z += dz * s; }
        // 安全地帯の外
        if (this.isOut(c.x, c.z)) {
          c.hp -= z.dps * dt;
          if (c.hp <= 0) this._eliminate(c, null, 'zone');
        }
      }
      // 撃ち合い: 残りが目安より多いぶん
      const virt = this.contestants.filter((c) => c.alive && !c.real && c.landed);
      const want = Math.round(this.contestants.length * Math.pow(1 - this.progress(), v.pace || 1.25));
      const alive = this.aliveCount();
      const excess = alive - want;
      if (excess > 0 && virt.length >= 1) {
        const pr = Math.min(0.85, 0.03 + excess * 0.12) * dt;
        if (this.rnd() < pr) {
          // 脱落する人: 外にいる・次の円から遠い人ほど
          let victim = null, best = -Infinity;
          for (const c of virt) {
            const s = Math.hypot(c.x - target.x, c.z - target.z) / Math.max(50, target.r) + this.rnd() * 1.2 + (c.hp < 60 ? 0.5 : 0);
            if (s > best) { best = s; victim = c; }
          }
          // 倒した人: 近い参加者（仮想・本物）。遠ければ撃ち合い無し（安全地帯 / 不明）
          let killer = null, kd = v.fightRange || 450;
          for (const c of this.contestants) {
            if (!c.alive || c === victim || !c.landed) continue;
            const dd = Math.hypot(c.x - victim.x, c.z - victim.z);
            if (dd < kd) { kd = dd; killer = c; }
          }
          if (killer) { killer.kills++; this._eliminate(victim, killer, 'fight'); }
          else if (this.isOut(victim.x, victim.z)) this._eliminate(victim, null, 'zone');
        }
      }
    }

    _eliminate(c, killer, how) {
      if (!c.alive) return;
      c.alive = false;
      c.hp = 0;
      this.events.push({ t: 'kill', killer: killer ? killer.name : null, victim: c.name, how, id: c.id, by: killer ? killer.id : null });
    }

    // 本物の敵が倒された / プレイヤーが倒した
    eliminate(c, killerName, how) {
      if (!c || !c.alive) return;
      c.alive = false;
      this.events.push({ t: 'kill', killer: killerName || null, victim: c.name, how: how || 'player', id: c.id });
    }

    // フェーズ D 用: 同期する状態
    snapshot() {
      const z = this.zone;
      return { seed: this.seed, time: this.time, phase: z.phase, stage: z.stage, t: z.t, cur: z.cur, next: z.next, alive: this.aliveCount(),
        contestants: this.contestants.map((c) => ({ id: c.id, x: Math.round(c.x), z: Math.round(c.z), alive: c.alive ? 1 : 0, real: c.real ? 1 : 0 })) };
    }
  }
  // ---------- オンライン（フェーズ D。サーバーが決めてクライアントに送る。THREE なし）----------
  // Royale.zonePlan(city, cfg, seed) → { phases: [{ wait, shrink, r, dps }], circles: [[x, z, r]…], flight }
  //   円をすべて前もって決める（同じ city・設定・seed なら同じ）。circles[0] = 最初の円、circles[i + 1] = 段階 i の縮んだ後の円
  //   （最後は r 0）。flight = 輸送ヘリの航路（makeFlight と同じ形 { x0, z0, x1, z1, len, dx, dz, y, speed }）。
  //   cfg.center が無ければ最初の円の中心は seed で選んだホットゾーンの近くの陸（cfg.centerJitter m 以内）。
  // Royale.zoneAt(plan, t) → 始まってから t 秒の円 { phase, stage: 'wait' | 'shrink' | 'end', cur: { x, z, r }, next, dps, left, t0 }
  //   段階 i は wait 秒そのまま → shrink 秒で circles[i + 1] へ直線で縮む。end は最後の円（r 0）のまま。t0 = その段階の始まり（秒）
  Royale.zonePlan = function (city, cfg, seed) {
    cfg = Object.assign({}, cfg || {});
    seed = seed >>> 0;
    if (!cfg.center && city && city.hotZones && city.hotZones.length) {
      const r = rng(seed ^ 0x2c1b3c6d);
      const hz = city.hotZones[Math.floor(r() * city.hotZones.length)];
      const J = cfg.centerJitter != null ? cfg.centerJitter : 250;
      let c = [hz.x, hz.z];
      for (let k = 0; k < 20; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * J;
        const x = Math.round(hz.x + Math.cos(a) * d), z = Math.round(hz.z + Math.sin(a) * d);
        if (!city.isWater || !city.isWater(x, z)) { c = [x, z]; break; }
      }
      cfg.center = c;
    }
    const R = new Royale(city, cfg, seed);
    const circles = [[R.zone.cur.x, R.zone.cur.z, R.zone.cur.r], [R.zone.next.x, R.zone.next.z, R.zone.next.r]];
    const flight = R.makeFlight();
    for (let i = 1; i < R.phases.length; i++) {
      const prev = circles[i];
      const n = R._pickNext({ x: prev[0], z: prev[1], r: prev[2] }, R.phases[i].r);
      circles.push([n.x, n.z, n.r]);
    }
    const q = (v) => Math.round(v * 100) / 100;
    return {
      phases: R.phases.map((p) => ({ wait: p.wait, shrink: p.shrink, r: p.r, dps: p.dps })),
      circles,
      flight: { x0: q(flight.x0), z0: q(flight.z0), x1: q(flight.x1), z1: q(flight.z1), len: q(flight.len), dx: flight.dx, dz: flight.dz, y: flight.y, speed: flight.speed },
      total: R.total
    };
  };
  Royale.zoneAt = function (plan, t) {
    const ph = plan.phases, c = plan.circles;
    let t0 = 0;
    const circ = (a) => ({ x: a[0], z: a[1], r: a[2] });
    for (let i = 0; i < ph.length; i++) {
      const p = ph[i], a = c[i], b = c[i + 1];
      if (t < t0 + p.wait) return { phase: i, stage: 'wait', cur: circ(a), next: circ(b), dps: p.dps, left: t0 + p.wait - t, t0 };
      if (t < t0 + p.wait + p.shrink) {
        const k = p.shrink > 0 ? (t - t0 - p.wait) / p.shrink : 1;
        return { phase: i, stage: 'shrink', cur: { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, r: a[2] + (b[2] - a[2]) * k }, next: circ(b),
          dps: p.dps, left: t0 + p.wait + p.shrink - t, t0: t0 + p.wait };
      }
      t0 += p.wait + p.shrink;
    }
    const last = c[c.length - 1];
    return { phase: ph.length, stage: 'end', cur: circ(last), next: null, dps: ph.length ? ph[ph.length - 1].dps : 0, left: 0, t0 };
  };

  Royale.DEFAULTS = DEFAULTS;
  Royale.merge = merge;
  MR.Royale = Royale;
  if (typeof module !== 'undefined' && module.exports) module.exports = Royale;

  if (!root.THREE) return; // Node（サーバー）は上だけ

  // ==================================================================================================================
  // ゲームとのつなぎ
  // ==================================================================================================================
  MR.RoyaleMode = class RoyaleMode {
    constructor(game, opts) {
      opts = opts || {};
      this.game = game;
      const cfg = merge(DEFAULTS, game.config.royale || {});
      this.cfg = cfg;
      let seed = opts.seed;
      if (seed == null) { const m = /[?&]rseed=(\d+)/.exec((typeof location !== 'undefined' && location.search) || ''); seed = m ? Number(m[1]) : Math.floor(Math.random() * 1e9); }
      this.seed = seed;
      this.R = new Royale(game.city, cfg, seed);
      this.useTransport = opts.transport != null ? !!opts.transport : (cfg.transport && cfg.transport.enabled !== false);
      if (this.useTransport) this.R.makeFlight();
      this.R.makeContestants(opts.contestants != null ? opts.contestants : cfg.contestants);
      this.total = this.R.contestants.length + 1;
      this.over = false;
      this.result = null;
      this.riding = false;
      this.ridePos = null;
      this.rideYaw = 0;
      this.kills = 0;
      this.startTime = 0;
      this._zoneAcc = 0;
      this._hurtAt = -10;
      this._feedTimer = 0;
      this.stats = { realSpawned: 0, realBack: 0, realKilled: 0, zoneTicks: 0, zoneDamage: 0, feed: 0 };
      // 敵の出し入れ: 数は近くの参加者の数（update で決める）、出す場所はその参加者の近く
      const d = game.director;
      if (d) {
        d.cfg.enemyCount = 0;
        d.onSpawn = (e) => this._linkEnemy(e);
      }
      this._buildWall();
      if (game.hud.setRoyale) game.hud.setRoyale({ alive: this.total, zone: '', dist: null, warn: false });
    }

    // ---------- 開始 ----------
    // game.start の後（_respawnPlayer の位置から）: 輸送ヘリに乗るか、そのまま地上で始める
    begin() {
      const g = this.game;
      this.startTime = g.time;
      this.R.start(0);
      if (this.useTransport && this.R.flight) this._boardTransport();
      else g.hud.showMessage('安全地帯に入って最後の 1 人になれ', 2200);
    }

    // ---------- 輸送ヘリ ----------
    _boardTransport() {
      const g = this.game, f = this.R.flight;
      this.riding = true;
      this.rideT = 0;
      this.ridePos = new THREE.Vector3(f.x0, f.y, f.z0);
      this.rideYaw = Math.atan2(-f.dx, -f.dz); // カメラの前 = 進む向き
      g.player.yawAngle = this.rideYaw; g.player.pitchAngle = -0.35;
      if (!this.transport) this.transport = new MR.RoyaleTransport(g.scene, g.assets, g.config.vehicles && g.config.vehicles.types && g.config.vehicles.types.heli);
      this.transport.root.visible = true;
      if (g.viewRoot) g.viewRoot.visible = false;
      g.hud.setDrop(true, '降下');
      g.hud.showMessage('「降下」で飛び降りる', 2200);
      if (g.audio && g.audio.loop) this._rideSound = g.audio.loop('heli_rotor', { volume: 0.55, fadeIn: 0.8 });
    }

    // 乗っている間（game._update から。プレイヤーの更新の代わり）
    updateRide(dt) {
      const g = this.game, f = this.R.flight, P = g.player, input = g.input;
      P._updateLook(dt, input);
      input.consumeJump(); // ジャンプは「降下」として下で読む（keys.Space）
      this.rideT += dt;
      const s = Math.min(f.len, this.rideT * f.speed);
      this.ridePos.set(f.x0 + f.dx * s, f.y, f.z0 + f.dz * s);
      f.px = this.ridePos.x; f.pz = this.ridePos.z;
      if (this.transport) this.transport.update(dt, this.ridePos, Math.atan2(f.dx, f.dz));
      // カメラ: 輸送ヘリの後ろ上（見回せる）
      P.pos.set(this.ridePos.x, this.ridePos.y - P.eyeHeight + 3.5, this.ridePos.z);
      P._apply();
      g.camera.position.set(0, 2.5, 24);
      const want = input.consumeDrop() || !!(input.keys && input.keys.Space) || g.input._jump;
      if (want || s >= f.len - 1) this.jump();
    }

    jump() {
      const g = this.game, P = g.player, f = this.R.flight;
      if (!this.riding) return;
      this.riding = false;
      g.input._jump = false;
      g.camera.position.set(0, 0, 0);
      g.hud.setDrop(false);
      if (this._rideSound) { this._rideSound.stop(1.2); this._rideSound = null; }
      const fc = this.cfg.fall;
      P.pos.set(this.ridePos.x - f.dx * 6, this.ridePos.y - 4, this.ridePos.z - f.dz * 6);
      P.startFall(f.dx * f.speed * 0.25, f.dz * f.speed * 0.25, fc, (x, z) => g.city.supportHeightAt(x, z));
      P.pitchAngle = -0.7;
      P._apply();
      if (g.viewRoot) g.viewRoot.visible = false;
      this.jumpedAt = g.time;
      this.stats.jumped = true;
      g.hud.showMessage('パラシュートは自動で開く（ジャンプで早く開く）', 2200);
    }

    // ---------- 敵 ----------
    _linkEnemy(e) {
      const c = this._pendingLink || this._nearestVirtual(e.pos, Infinity);
      this._pendingLink = null;
      if (!c) { e.removed = true; return; }
      c.real = e;
      e.contestant = c;
      this.stats.realSpawned++;
    }

    _nearestVirtual(pos, maxD) {
      let best = null, bd = maxD;
      for (const c of this.R.contestants) {
        if (!c.alive || c.real || !c.landed) continue;
        const d = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }

    // ---------- 毎フレーム ----------
    update(dt) {
      const g = this.game, P = g.player, R = this.R;
      // 決着がついたら止める（結果の順位と「残り」が食い違わないように）
      if (!this.over) R.update(dt, { x: P.pos.x, z: P.pos.z, alive: !P.dead });
      // 本物の敵 ⇔ 参加者（消された敵は game.enemies から外れているので参加者の側から見る）
      for (const c of R.contestants) {
        const e = c.real;
        if (!e) continue;
        if (e.dead) {
          if (c.alive) {
            const byZone = !!e._zoneKill;
            R.eliminate(c, byZone ? null : this.cfg.playerName, byZone ? 'zone' : 'player');
            if (!byZone) { this.kills++; this.stats.realKilled++; }
          }
          c.x = e.pos.x; c.z = e.pos.z;
        } else if (e.removed || g.enemies.indexOf(e) < 0) {
          // 遠くなって消された: 仮想に戻る（その位置から）
          c.real = null; c.x = e.pos.x; c.z = e.pos.z; c.tx = null; this.stats.realBack++;
          e.contestant = null;
        } else { c.x = e.pos.x; c.z = e.pos.z; }
      }
      // 近くの参加者を本物にする（地上にいる間だけ）
      this._realTimer = (this._realTimer || 0) - dt;
      if (this._realTimer <= 0 && g.director) {
        this._realTimer = 0.5;
        const ground = !P.dead && !this.riding && P.state !== 'fall' && P.state !== 'chute';
        let real = 0;
        for (const e of g.enemies) if (!e.dead && !e.removed && e.contestant) real++;
        const near = [];
        if (ground) for (const c of R.contestants) if (c.alive && !c.real && c.landed && Math.hypot(c.x - P.pos.x, c.z - P.pos.z) < this.cfg.realRange) near.push(c);
        near.sort((a, b) => Math.hypot(a.x - P.pos.x, a.z - P.pos.z) - Math.hypot(b.x - P.pos.x, b.z - P.pos.z));
        g.director.cfg.enemyCount = Math.min(this.cfg.maxReal, real + near.length);
        g.director.prefer = near[0] ? { x: near[0].x, z: near[0].z } : null;
        this._pendingLink = near[0] || null;
        // 地上でないときは今いる敵も増やさない
        if (!ground) g.director.cfg.enemyCount = 0;
        // 出す場所の候補（参加者に近い順）のチャンクの歩行グラフを前もって作る。director は 1 回の試行で 1 ms しか
        // 作らない（spawnInterval ごと）ので、作っていないチャンクだと本物になるまで 10 秒以上かかっていた
        this._warm = null;
        if (near[0] && real < this.cfg.maxReal && g.world && g.world.nav) {
          const d = g.director, pp = near[0], nav = g.world.nav, warm = [];
          const cands = d._candidates().filter((k) => { const dd = Math.hypot(k.x - P.pos.x, k.z - P.pos.z); return dd >= d.cfg.spawnMin && dd <= d.cfg.spawnMax; });
          cands.sort((a, b) => Math.hypot(a.x - pp.x, a.z - pp.z) - Math.hypot(b.x - pp.x, b.z - pp.z));
          for (let i = 0; i < cands.length && warm.length < 2; i++) {
            const ch = g.city.chunkOf(cands[i].x, cands[i].z);
            if (!nav.graphReady(ch.cx, ch.cz) && !warm.some((w) => w.cx === ch.cx && w.cz === ch.cz)) warm.push(ch);
          }
          if (warm.length) this._warm = warm;
        }
      }
      if (this._warm && g.world && g.world.nav) {
        const nav = g.world.nav, w = this._warm[0], d = g.director;
        if (nav.graphReady(w.cx, w.cz)) this._warm.shift();
        else {
          const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const done = nav.buildGraphStep(w.cx, w.cz, d.cfg.graphBudgetMs || 2.5);
          const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
          this.stats.warmMs = (this.stats.warmMs || 0) + ms;
          if (done) { this._warm.shift(); this.stats.warmed = (this.stats.warmed || 0) + 1; }
        }
        // 出来たらすぐ試す
        if (!this._warm.length) { this._warm = null; d.spawnTimer = Math.min(d.spawnTimer, 0.2); }
      }
      // 安全地帯のダメージ（tick 秒ごと）: プレイヤーと本物の敵
      this._zoneAcc += dt;
      const tick = this.cfg.zone.tick || 1;
      const out = R.outside(P.pos.x, P.pos.z), isOut = R.isOut(P.pos.x, P.pos.z);
      if (this._zoneAcc >= tick) {
        this._zoneAcc -= tick;
        const dps = R.zone.dps;
        if (!P.dead && isOut && !this.riding && R.started) {
          g._playerHit(dps * tick, { kind: 'zone', quiet: true });
          this.stats.zoneTicks++; this.stats.zoneDamage += dps * tick;
          if (g.audio && g.audio.play) g.audio.play('zone_damage', { priority: 2 });
        }
        for (const e of g.enemies) {
          if (e.dead || !e.contestant) continue;
          if (R.isOut(e.pos.x, e.pos.z) && e.takeDamage(dps * tick, null)) e._zoneKill = true;
        }
      }
      g.hud.setZoneTint(!P.dead && isOut && !this.riding ? 0.55 + 0.25 * Math.sin(g.time * 4) : 0);
      // キルフィード
      for (const ev of R.events) {
        if (ev.t === 'kill') {
          this.stats.feed++;
          if (ev.how === 'zone') g.hud.addKillFeed('', ev.victim, '安全地帯', {});
          else g.hud.addKillFeed(ev.killer || '', ev.victim, ev.how === 'player' && g.weapon ? g.weapon.def.name : '', { self: ev.killer === this.cfg.playerName });
        } else if (ev.t === 'shrink') g.hud.showMessage('安全地帯が縮小しています', 1800);
        else if (ev.t === 'phase') g.hud.showMessage('次の安全地帯が決まりました', 1800);
      }
      R.events.length = 0;
      this._updateWall();
      this._updateHud(out);
      // 輸送ヘリ・降下中の HUD（撃つボタンなどを隠す）
      const rc = g.hud.root && g.hud.root.classList;
      if (rc) { rc.toggle('riding', this.riding); rc.toggle('falling', P.state === 'fall'); rc.toggle('chute', P.state === 'chute'); }
      // 勝ち
      if (!this.over && !P.dead && R.started && R.aliveCount() === 0) this._finish(true);
    }

    // プレイヤーがやられた（game._onPlayerDied から）
    onPlayerDied(killer) {
      if (this.over) return;
      const g = this.game;
      if (killer && killer.contestant) { killer.contestant.kills++; g.hud.addKillFeed(killer.contestant.name, this.cfg.playerName, '', { victim: true }); }
      else g.hud.addKillFeed('', this.cfg.playerName, this.lastHurt === 'zone' ? '安全地帯' : '', { victim: true });
      this._finish(false, killer && killer.contestant ? killer.contestant.name : null);
    }

    _finish(win, by) {
      const g = this.game;
      this.over = true;
      if (MR.Session) MR.Session.clear(); // ラウンドが終わった: 次の起動で続きから始めない（session.js）
      const rank = win ? 1 : this.R.aliveCount() + 1;
      this.result = { win, rank, total: this.total, kills: g.kills, time: g.time - this.startTime, by: by ? by + ' にやられた' : '' };
      if (win && g.audio.kill) g.audio.kill();
      const show = () => {
        if (!this.result) return;
        g.hud.showDeath(false);
        g.hud.showResult(Object.assign({ title: win ? '優勝！' : 'やられた' }, this.result), () => g.leaveToTitle({ again: 'royale' }), () => g.leaveToTitle());
      };
      this._resultAt = g.time + (this.cfg.resultDelay || 1.5);
      this._showResult = show;
    }

    // 結果の表示待ち（game._update から毎フレーム）
    tick() { if (this._showResult && this.game.time >= this._resultAt) { const f = this._showResult; this._showResult = null; f(); } }

    _updateHud(out) {
      const g = this.game, R = this.R, t = R.timer();
      const fmt = (s) => { s = Math.ceil(s); return Math.floor(s / 60) + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60); };
      let zone = '';
      if (t.stage === 'wait') zone = '縮小まで ' + fmt(t.left);
      else if (t.stage === 'shrink') zone = '縮小中 ' + fmt(t.left);
      else zone = '最終';
      const P = g.player;
      const alive = R.aliveCount() + (P.dead ? 0 : 1);
      g.hud.setRoyale({ alive, zone, dist: (!P.dead && out > 0 && !this.riding) ? Math.round(out) : null, warn: !P.dead && out > 0 && !this.riding });
    }

    // 地図に描くもの
    mapInfo() {
      const z = this.R.zone, f = this.R.flight;
      return { cur: z.cur, next: z.stage === 'end' ? null : z.next, flight: (this.riding && f) ? f : null };
    }

    // ---------- 安全地帯の壁（青い円筒。1 回で描く）----------
    _buildWall() {
      const zc = this.cfg.zone;
      const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
      geo.translate(0, 0.5, 0);
      const tex = RoyaleMode.wallTexture();
      const mat = new THREE.MeshBasicMaterial({ color: MR.srgb('#4f9bff'), map: tex, transparent: true, opacity: zc.wallOpacity || 0.32, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
      this.wall = new THREE.Mesh(geo, mat);
      this.wall.name = 'zone_wall';
      this.wall.frustumCulled = false;
      this.wall.renderOrder = 3;
      this.game.scene.add(this.wall);
      this._wallTex = tex;
    }

    static wallTexture() {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 128;
      const g = c.getContext && c.getContext('2d');
      if (!g || !g.createLinearGradient) return null;
      const gr = g.createLinearGradient(0, 128, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0.0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
      // 細かい格子（壁があると分かるように）
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 64, 1);
      for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 1.5, 128);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping;
      return t;
    }

    _updateWall() {
      const z = this.R.zone.cur, w = this.wall;
      if (!w) return;
      const r = Math.max(0.5, z.r);
      w.visible = this.R.started && r > 1;
      w.position.set(z.x, -30, z.z);
      w.scale.set(r, this.cfg.zone.wallHeight || 700, r);
      if (this._wallTex) { this._wallTex.repeat.x = Math.max(1, Math.round(2 * Math.PI * r / 40)); this._wallTex.offset.x = (this.game.time * 0.02) % 1; }
    }

    dispose() {
      const h = this.game.hud;
      if (h.setRoyale) { h.setRoyale(null); h.setZoneTint(0); h.setDrop(false); h.showResult(null); }
      this._showResult = null;
      if (this.wall) { this.game.scene.remove(this.wall); this.wall.geometry.dispose(); this.wall.material.dispose(); if (this._wallTex) this._wallTex.dispose(); }
      if (this.transport) this.transport.dispose();
      if (this._rideSound) { this._rideSound.stop(0.2); this._rideSound = null; }
    }
  };

  // 輸送ヘリ（見た目だけ。helicopter.glb を大きくしたもの / 無ければコードのヘリ）
  MR.RoyaleTransport = class RoyaleTransport {
    constructor(scene, assets, def) {
      this.scene = scene;
      this.root = new THREE.Group();
      this.root.name = 'royale_transport';
      this.root.scale.setScalar(2.2);
      scene.add(this.root);
      this._set(MR.Helicopter ? MR.Helicopter.buildFallback(Object.assign({ color: '#3d4a36' }, def || {})) : new THREE.Group());
      this.source = 'procedural';
      const key = assets && assets.resolve ? assets.resolve((def && def.model) || 'models/helicopter.glb') : null;
      if (key && assets.loadModel) {
        Promise.resolve(assets.loadModel(key)).then((g) => {
          const s = g && (g.scene || g);
          if (!s || !s.clone || this.disposed) return;
          this._set(s.clone());
          this.source = 'glb';
        }).catch(() => {});
      }
    }
    _set(model) {
      if (this.model) this.root.remove(this.model);
      this.model = model;
      this.root.add(model);
      this.rotorMain = model.getObjectByName('rotor_main');
      this.rotorTail = model.getObjectByName('rotor_tail');
      const blur = model.getObjectByName('rotor_main_blur');
      if (blur) blur.visible = true;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    }
    update(dt, pos, yaw) {
      this.root.position.copy(pos);
      this.root.position.y -= 3;
      this.root.rotation.set(0.08, yaw, 0, 'YXZ');
      if (this.rotorMain) this.rotorMain.rotation.y += dt * 40;
      if (this.rotorTail) this.rotorTail.rotation.x += dt * 120;
    }
    dispose() { this.disposed = true; if (this.root.parent) this.root.parent.remove(this.root); }
  };

  // パラシュート（コードで作る。プレイヤーの頭の上。開く 0.62 s で大きくなる）
  MR.Parachute = class Parachute {
    constructor(parent) {
      this.root = new THREE.Group();
      this.root.name = 'parachute';
      this.root.visible = false;
      parent.add(this.root);
      const tex = Parachute.texture();
      const geo = new THREE.SphereGeometry(3.4, 20, 6, 0, Math.PI * 2, 0, 0.95);
      geo.scale(1.35, 0.55, 0.9);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.8, side: THREE.DoubleSide });
      this.canopy = new THREE.Mesh(geo, mat);
      // 一人称で前を向いても画面の上の縁にキャノピーの縁が見える高さ・少し前（本物より低い。縁は目の 1.5 m 上）
      this.canopy.position.set(0, 0.42, -0.6);
      this.root.add(this.canopy);
      // 吊り索（キャノピーの縁から肩へ）
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        pts.push(Math.cos(a) * 3.4 * 1.35 * 0.81, 0.42 + 3.4 * 0.55 * Math.cos(0.95), Math.sin(a) * 3.4 * 0.9 * 0.81 - 0.6, (i % 2 ? 0.25 : -0.25), -0.35, 0.1);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: MR.srgb('#d9d4c8'), transparent: true, opacity: 0.8 }));
      this.root.add(this.lines);
      this.root.position.set(0, 0.2, 0.15);
      this.t = 0;
      this.openTime = 0.62;
    }
    static texture() {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      c.width = 128; c.height = 8;
      const g = c.getContext && c.getContext('2d');
      if (!g) return null;
      for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#ece6d6' : (i % 4 ? '#c8402f' : '#2f6fb8'); g.fillRect(i * 8, 0, 8, 8); }
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      return t;
    }
    open(openTime) { this.root.visible = true; this.t = 0; this.openTime = openTime || 0.62; }
    close() { this.root.visible = false; }
    update(dt) {
      if (!this.root.visible) return;
      this.t += dt;
      const k = Math.min(1, this.t / this.openTime);
      const e = k < 1 ? 0.15 + 0.85 * (k * k * (3 - 2 * k)) : 1 + Math.sin(this.t * 3) * 0.015;
      this.canopy.scale.set(e, 0.3 + 0.7 * e, e);
    }
    dispose() { if (this.root.parent) this.root.parent.remove(this.root); this.canopy.geometry.dispose(); this.canopy.material.dispose(); this.lines.geometry.dispose(); this.lines.material.dispose(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
