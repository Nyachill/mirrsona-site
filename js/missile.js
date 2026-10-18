// 戦闘機のミサイルとフレア（MR.Missiles。game.js が 1 つ持つ。THREE は使うが DOM は使わない）。飛び方は MR.MissileCore（missilecore.js、
//   THREE なし・決まった乱数）。ここは世界とのつなぎ（目標の位置・レイ・巻き込み・爆発）と見た目・音。
//   fire({ from, vel, dir, target, owner, type, aim, seed }) … 翼の下（from）から撃つ。type は missiles.types の型（'aim9x' / 'aim120' / 'manpads'。
//     無ければ missiles.defaultType）。target があれば追う（空の目標は比例航法、地上の目標は先読みの追尾 + 上から + 建物の陰なら狙いを上げる。
//     missilecore.js の冒頭）、aim（狙う点）があればそこへ、どちらも無ければ dir へまっすぐ。爆発は ctx.onDetonate（visualOnly なら見た目と音だけ）。
//   popFlares(owner, n) … 機体の後ろにフレアを n 発。owner を追っているミサイルは decoyRange m 以内なら decoyChance でフレアを追う（1 発 decoyRolls 回まで）。
//   incomingFor(v) … v を追っているミサイルのうち一番近いもの { dist, tti, bearing（機首から右が正の度 −180..180）, elevation, missile }（使い回しの 1 つ）か null。
//   list / flares … 今飛んでいるミサイル・フレア（詰めた配列。プールの物を出し入れする）。stats / last … テストが読む（smoke 13f・17）。
//   見た目: 型ごとの InstancedMesh（fa18.glb の proj_aim9x / proj_aim120、projectiles.glb の proj_aa を「機首 +Z・原点は胴の真ん中」に焼いた形。
//     無ければ筒 + 円錐）、炎とフレアは加算の板の InstancedMesh（カメラに向ける）、煙の尾は MR.Trails（1 回の描画）。どのメッシュも frustumCulled = false。
//     数の上限は missiles.caps（タッチの端末は mobile*）。音: missile_launch・missile_explode と、近い caps.audioLoops 本だけの missile_loop（4 回/秒選び直す）
window.MR = window.MR || {};

MR.Missiles = class Missiles {
  constructor(scene, fx, audio, cfg, opts) {
    this.scene = scene; this.fx = fx; this.audio = audio;
    opts = opts || {};
    this.opts = opts;
    this.assets = opts.assets || null;
    this.visualOnly = !!opts.visualOnly;
    this.cfg = Object.assign({}, Missiles.DEFAULTS, cfg || {});
    const C = this.cfg, caps = Object.assign({}, Missiles.DEFAULTS.caps, C.caps || {}), mob = !!opts.mobile;
    this.caps = { active: Math.max(1, (mob ? caps.mobileActive : caps.active) | 0), flares: Math.max(1, (mob ? caps.mobileFlares : caps.flares) | 0), audioLoops: Math.max(0, (mob ? caps.mobileAudioLoops : caps.audioLoops) | 0) };
    this.list = [];
    this.flares = [];
    this.stats = { fired: 0, hits: 0, decoyed: 0, tooLate: 0, lateDecoys: 0, flares: 0, detonated: 0, evicted: 0, lost: 0, recycled: 0, byType: {} };
    this.last = null;
    this._pool = []; this._fpool = [];
    this._seed = (opts.seed >>> 0) || 0x9e3779b1;
    this._frng = { r: (this._seed ^ 0x5bd1e995) >>> 0 || 1 }; // フレアの散らばり（決まった乱数: おとりの先がフレアなので）
    this._tcs = {};
    this._baking = {};
    this._bodies = {};
    this._vis = null;
    this._loopT = 0; this._posT = 0;
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._tp = new THREE.Vector3(); this._ro = new THREE.Vector3(); this._rd = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._m4 = new THREE.Matrix4(); this._sc = new THREE.Vector3(1, 1, 1); this._Z = new THREE.Vector3(0, 0, 1);
    this._cam = new THREE.Vector3();
    this._inc = { dist: 0, tti: 0, bearing: 0, elevation: 0, missile: null };
    this._tv = [0, 0, 0];
    this._rayHit = { t: 0, x: 0, y: 0, z: 0, water: false, src: null };
    this._ctx = null; this._cur = null;
    const self = this;
    // MissileCore の env（1 回だけ作る。毎フレームの閉包を作らない）
    this._env = {
      targetPos(ref, P, V) { return self._targetPos(ref, P, V); },
      ray(ox, oy, oz, dx, dy, dz, len, hit) { return self._ray(ox, oy, oz, dx, dy, dz, len, hit); },
      collateral(m, ax, ay, az, bx, by, bz, out) { return self._collateral(m, ax, ay, az, bx, by, bz, out); },
      isFlare(ref) { return !!(ref && ref.isFlare); }
    };
    if (opts.preload) this.preload(opts.preload);
  }

  // 型の数値: MissileCore.BASE < MissileCore.TYPES[k]（コードの既定）< 機体の missile（vehicles.types.jet.missile の数）< game.json の missiles.types[k]。
  //   game.json に missiles.types があれば型の数値が勝つ（飛び方の数値は型ごと。ロックの数値は機体のまま = D2）
  typeCfg(k) {
    const MC = MR.MissileCore, C = this.cfg;
    if (!MC.TYPES[k] && !(C.types && C.types[k])) k = C.defaultType || 'aim9x';
    let t = this._tcs[k];
    if (t) return t;
    t = Object.assign({}, MC.BASE, MC.TYPES[k] || {});
    for (const key of Object.keys(C)) if (key !== 'types' && key !== 'caps' && key !== 'trail' && typeof C[key] !== 'object') t[key] = C[key];
    Object.assign(t, (C.types && C.types[k]) || {});
    if (C.maxStep > 0) t.maxStep = C.maxStep;
    t.key = k;
    this._tcs[k] = t;
    return t;
  }

  // 目標の今の位置（世界）。フレア・乗り物（重心）・敵（胸の高さ）・{ x, y, z }
  static targetPos(t, out) {
    if (!t) return null;
    if (t.isFlare) return out.copy(t.pos);
    if (typeof t.center === 'function') return t.center(out);
    if (t.pos) return out.set(t.pos.x, t.pos.y + 1.1, t.pos.z);
    return out.set(t.x, t.y, t.z);
  }
  static alive(t) {
    if (!t) return false;
    if (t.isFlare) return t.life > 0;
    return !(t.dead || t.wrecked || t.sunk || t.disposed || t.removed);
  }
  // 空の目標か（比例航法。地上の目標は上から突っ込む）
  static isAir(t) { return !!(t && (t.isFlare || t.mode === 'air' || (t.kind === 'heli' && !t.grounded))); }

  _targetPos(ref, P, V) {
    if (!Missiles.alive(ref)) return false;
    if (ref.isFlare && this._cur && this._cur.tgtGen !== ref.gen) return false; // 使い回されたフレア
    const tp = Missiles.targetPos(ref, this._tp);
    P[0] = tp.x; P[1] = tp.y; P[2] = tp.z;
    const v = ref.vel;
    if (v && typeof v.x === 'number') { V[0] = v.x; V[1] = v.y; V[2] = v.z; } else { V[0] = 0; V[1] = 0; V[2] = 0; }
    return true;
  }
  _ray(ox, oy, oz, dx, dy, dz, len, hit) {
    const ctx = this._ctx;
    if (!ctx || !ctx.ray) return false;
    const r = ctx.ray(this._ro.set(ox, oy, oz), this._rd.set(dx, dy, dz), len, this._rayHit);
    if (!r) return false;
    hit.t = r.t; hit.x = r.x; hit.y = r.y; hit.z = r.z; hit.water = !!r.water; hit.src = r.src || null;
    return true;
  }
  // 途中の乗り物（発射した機体の外）・敵を巻き込む（今までの missile.js と同じ近さ）
  _collateral(m, ax, ay, az, bx, by, bz, out) {
    const ctx = this._ctx, MC = MR.MissileCore, c = m.c;
    if (!ctx) return null;
    const vs = ctx.vehicles || [];
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v === m.owner || v.wrecked || v.sunk || v.disposed) continue;
      if (Math.abs(v.pos.x - bx) > 60 || Math.abs(v.pos.z - bz) > 60) continue;
      const tp = Missiles.targetPos(v, this._tp);
      if (MC.closest(ax, ay, az, bx, by, bz, tp.x, tp.y, tp.z, Math.max(c.fuse * 0.5, ((v.def && v.def.width) || 2) * 0.5 + 1), out)) return v;
    }
    const es = ctx.enemies || [];
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dead || e.removed) continue;
      if (Math.abs(e.pos.x - bx) > 40 || Math.abs(e.pos.z - bz) > 40) continue;
      const tp = Missiles.targetPos(e, this._tp);
      if (MC.closest(ax, ay, az, bx, by, bz, tp.x, tp.y, tp.z, 2.5, out)) return e;
    }
    return null;
  }

  // ---------- 撃つ ----------
  fire(o) {
    const C = this.cfg, MC = MR.MissileCore;
    const k = (o.type && (MC.TYPES[o.type] || (C.types && C.types[o.type]))) ? o.type : (C.defaultType || 'aim9x');
    const tc = this.typeCfg(k);
    // 上限: 一番古いものを外す（見た目だけ消える。ダメージなし）
    if (this.list.length >= this.caps.active) {
      let oi = 0;
      for (let i = 1; i < this.list.length; i++) if (this.list[i].core.t > this.list[oi].core.t) oi = i;
      this._remove(oi);
      this.stats.evicted++;
    }
    const e = this._pool.pop() || this._newEntry();
    const seed = o.seed != null ? (o.seed >>> 0) : (this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0);
    const ci = this._ci || (this._ci = { k: '', id: 0, seed: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dx: 0, dy: 0, dz: 1, tgt: null, ground: false, aim: null, owner: null });
    ci.k = k; ci.id = ++Missiles._id; ci.seed = seed;
    ci.x = o.from.x; ci.y = o.from.y; ci.z = o.from.z;
    ci.vx = o.vel ? o.vel.x : 0; ci.vy = o.vel ? o.vel.y : 0; ci.vz = o.vel ? o.vel.z : 0;
    ci.dx = o.dir.x; ci.dy = o.dir.y; ci.dz = o.dir.z;
    ci.tgt = o.target || null; ci.ground = !!(o.target && !Missiles.isAir(o.target));
    if (o.aim) { const a = e.aim; a[0] = o.aim.x; a[1] = o.aim.y; a[2] = o.aim.z; ci.aim = a; } else ci.aim = null;
    ci.owner = o.owner || null;
    MC.create(tc, ci, e.core);
    e.id = ci.id; e.k = k; e.tc = tc; e.owner = ci.owner; e.target = ci.tgt; e.dead = false; e.decoyed = false;
    e.tgtGen = o.target && o.target.isFlare ? o.target.gen : 0;
    e.pos.set(ci.x, ci.y, ci.z); e.vel.set(e.core.v[0], e.core.v[1], e.core.v[2]);
    e.from[0] = +o.from.x.toFixed(1); e.from[1] = +o.from.y.toFixed(1); e.from[2] = +o.from.z.toFixed(1);
    e.flick = (seed & 1023) / 1024; // 炎のゆらぎ（見た目だけ）
    this._body(k); // 体の InstancedMesh を先に（e.mesh が返す）
    // GLB の試作弾を初めて撃つときに焼く（fa18.glb は戦闘機が読んだパース結果のキャッシュ。焼けるまでは筒 + 円錐）
    if (this.opts.lazyBake && this.assets && !Missiles._baked[k] && !this._baking[k]) { this._baking[k] = true; this.preload([k]); }
    // 煙の尾（MR.Trails の帯。空きが無ければ尾なし）
    const tr = this._trails();
    e.trail = tr ? tr.alloc(C.trail) : -1;
    this.list.push(e);
    this.stats.fired++;
    this.stats.byType[k] = (this.stats.byType[k] || 0) + 1;
    this._loopT = 0; // 次のフレームで missile_loop を選び直す
    if (this.audio && typeof this.audio.play === 'function') this.audio.play('missile_launch', { pos: o.from, priority: 3, refDistance: 20, maxDistance: 900 });
    // 発射の煙（発射のときだけ。飛んでいる間の煙は帯）
    if (this.fx && typeof this.fx.smoke === 'function') this.fx.smoke(o.from, 0.9);
    return e;
  }

  // プールの 1 本。e.mesh は今までの形（1 本 1 つの Mesh）の代わり: 飛んでいる間はその型の体の InstancedMesh、外れたら
  //   parent の無い置き物（smoke 20i の「stop() の後にミサイルの物がシーンに残らない」がそのまま読める）
  _newEntry() {
    const self = this;
    const e = { core: MR.MissileCore.newState(), id: 0, k: '', tc: null, owner: null, target: null, dead: false, decoyed: false, tgtGen: 0,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), from: [0, 0, 0], aim: [0, 0, 0], trail: -1, snd: null, flick: 0, _sel: 0 };
    Object.defineProperty(e, 'mesh', { enumerable: false, get() { const b = !e.dead && self._bodies[e.k]; return b ? b.mesh : Missiles.NO_MESH; } });
    return e;
  }

  // ---------- フレア ----------
  popFlares(owner, n) {
    if (!owner || n <= 0) return 0;
    const C = this.cfg, MC = MR.MissileCore;
    const c = typeof owner.center === 'function' ? owner.center(this._v1) : this._v1.copy(owner.pos);
    const ov = owner.vel || this._v3.set(0, 0, 0);
    const first = this._burst || (this._burst = []);
    first.length = 0;
    for (let i = 0; i < n; i++) {
      let f;
      if (this.flares.length >= this.caps.flares) {
        // 一番古いものを使い回す（それを追っていたミサイルは見失う = gen が変わる）
        let oi = 0;
        for (let j = 1; j < this.flares.length; j++) if (this.flares[j].life < this.flares[oi].life) oi = j;
        f = this.flares[oi];
        this.flares[oi] = this.flares[this.flares.length - 1]; this.flares.pop();
        this.stats.recycled++;
      } else f = this._fpool.pop() || { isFlare: true, p: [0, 0, 0], v: [0, 0, 0], pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, life0: 0, owner: null, gen: 0 };
      f.gen++;
      const side = (i % 2 ? 1 : -1) * (6 + MC.rngNext(this._frng) * 6);
      f.p[0] = c.x; f.p[1] = c.y; f.p[2] = c.z;
      f.v[0] = ov.x * 0.6 + side * 0.3; f.v[1] = ov.y * 0.6 - 4 - MC.rngNext(this._frng) * 4; f.v[2] = ov.z * 0.6 + side * 0.3;
      f.pos.set(c.x, c.y, c.z); f.vel.set(f.v[0], f.v[1], f.v[2]);
      f.life = f.life0 = C.flareLife; f.owner = owner;
      this.flares.push(f);
      first.push(f);
    }
    this.stats.flares += n;
    if (this.audio && typeof this.audio.play === 'function') this.audio.play('flare_pop', { pos: c, priority: 2, refDistance: 10, maxDistance: 500 });
    // おとり: owner を追っているミサイル（型ごとの decoyRange / decoyChance / decoyRolls。乱数はミサイルの seed）。
    //  届くまで decoyMinTime 秒より短いミサイルはもう間に合わない（フレアが機体から離れる前に機体のすぐ横で爆発する）: 振らない（回数も使わない）
    const minT = C.decoyMinTime != null ? C.decoyMinTime : MC.BASE.decoyMinTime, vFloor = C.tgoSpeed != null ? C.tgoSpeed : MC.BASE.tgoSpeed;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i], m = e.core;
      if (m.dead || m.tgt !== owner) continue;
      const dx = c.x - m.p[0], dy = c.y - m.p[1], dz = c.z - m.p[2], dist = Math.hypot(dx, dy, dz);
      if (dist > m.c.decoyRange) continue;
      const close = dist > 1e-3 ? ((m.v[0] - ov.x) * dx + (m.v[1] - ov.y) * dy + (m.v[2] - ov.z) * dz) / dist : 0;
      if (minT > 0 && dist < minT * Math.max(vFloor, close)) { this.stats.tooLate++; continue; }
      if (MC.decoyRoll(m)) {
        const f = first[MC.pick(m, first.length)];
        m.tgt = f; m.ground = false; e.target = f; e.tgtGen = f.gen;
        this.stats.decoyed++; e.decoyed = true; m.decoyed = true;
      }
    }
    return n;
  }

  incomingFor(v) {
    if (!v || !this.list.length) return null;
    const c = typeof v.center === 'function' ? v.center(this._v2) : this._v2.copy(v.pos);
    // 方位は機首の向きから（乗り物は前 +Z = (sin yaw, cos yaw)。横へ滑っているヘリも機首から測る）。向きが無ければ速度の向き
    let hx = 0, hz = 1;
    const vv = v.vel;
    if (typeof v.yaw === 'number' && isFinite(v.yaw)) { hx = Math.sin(v.yaw); hz = Math.cos(v.yaw); } else if (vv && Math.hypot(vv.x, vv.z) > 0.5) { hx = vv.x; hz = vv.z; }
    const tv = this._tv;
    if (vv && typeof vv.x === 'number') { tv[0] = vv.x; tv[1] = vv.y; tv[2] = vv.z; } else { tv[0] = 0; tv[1] = 0; tv[2] = 0; }
    return MR.MissileCore.incoming(this.list, v, c.x, c.y, c.z, hx, hz, this._inc, tv);
  }

  // ---------- 毎フレーム ----------
  // ctx: { vehicles, enemies, ray(o, d, maxT, out) → { t, x, y, z, water, src } | null, onDetonate(point, missile, hitObj, water, air), camera（位置）}
  update(dt, ctx) {
    const MC = MR.MissileCore;
    this._ctx = ctx || null;
    // フレア: 落ちながら消える
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      const ok = MC.flareStep(f, dt, this.cfg);
      f.pos.set(f.p[0], f.p[1], f.p[2]); f.vel.set(f.v[0], f.v[1], f.v[2]);
      if (!ok) { f.life = 0; f.gen++; this.flares[i] = this.flares[this.flares.length - 1]; this.flares.pop(); this._fpool.push(f); }
    }
    const tr = this._trailsObj;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i], m = e.core;
      if (e.dead) { this._remove(i); continue; }
      if (m.tgt && !m.tgt.isFlare) m.ground = !Missiles.isAir(m.tgt);
      this._cur = e;
      const hadT = !!m.tgt;
      const code = MC.step(m, dt, this._env);
      this._cur = null;
      if (hadT && !m.tgt) this.stats.lost++;
      e.target = m.tgt;
      e.pos.set(m.p[0], m.p[1], m.p[2]); e.vel.set(m.v[0], m.v[1], m.v[2]);
      // 煙の尾: ロケットが燃えている間だけ（尾の点は炎の位置）
      if (tr && e.trail >= 0) {
        if (m.ph === 1 && !code) {
          const V = Math.hypot(m.v[0], m.v[1], m.v[2]) || 1, mz = this._motorZ(e.k);
          tr.emit(e.trail, m.p[0] + m.v[0] / V * mz, m.p[1] + m.v[1] / V * mz, m.p[2] + m.v[2] / V * mz, dt);
        } else if (m.ph === 2 || code) { tr.release(e.trail); e.trail = -1; }
      }
      if (code) { this._detonate(e, code); this._remove(i); }
      else if (m.dead) this._remove(i);
    }
    this._writeVisuals(dt, ctx);
    this._updateLoops(dt, ctx);
  }

  _detonate(e, code) {
    const MC = MR.MissileCore, m = e.core, ev = m.ev, ctx = this._ctx;
    e.pos.set(ev.x, ev.y, ev.z);
    const t = +m.t.toFixed(2);
    if (code === MC.EV_EXPIRE) {
      // 自爆（空中）
      this.last = { x: +ev.x.toFixed(1), y: +ev.y.toFixed(1), z: +ev.z.toFixed(1), t, obj: null, air: true, type: e.k };
      if (ctx && ctx.onDetonate && !this.visualOnly) ctx.onDetonate(e.pos, e, null, false, true);
      else if (this.visualOnly && this.fx && this.fx.explosion) this.fx.explosion(e.pos, 3, 0.5);
      return;
    }
    const hitObj = ev.ref;
    this.stats.detonated++;
    const tg = m.tgt;
    // だまされたのに、追っていたフレアを撒いた機体の爆風の中で爆発した = 間に合わなかった（だまされたことにしない。ダメージは爆風のまま）
    if (e.decoyed && tg && tg.isFlare && tg.owner && !tg.owner.wrecked) {
      const o = tg.owner, oc = typeof o.center === 'function' ? o.center(this._v1) : o.pos;
      const R = (e.tc && e.tc.blastRadius) || 0;
      if (oc && Math.hypot(oc.x - ev.x, oc.y - ev.y, oc.z - ev.z) < R) { e.decoyed = false; m.decoyed = false; this.stats.lateDecoys++; }
    }
    this.last = { x: +ev.x.toFixed(1), y: +ev.y.toFixed(1), z: +ev.z.toFixed(1), t, obj: hitObj ? (hitObj.cityId || hitObj.kind || 'enemy') : null, water: !!ev.water, src: ev.src || null,
      from: [e.from[0], e.from[1], e.from[2]], target: tg ? (tg.isFlare ? 'flare' : (tg.cityId || tg.kind || 'enemy')) : null, type: e.k };
    if (hitObj) this.stats.hits++;
    if (ctx && ctx.onDetonate && !this.visualOnly) ctx.onDetonate(e.pos, e, hitObj, !!ev.water);
    else if (this.visualOnly && this.fx) { if (ev.water && this.fx.splash) this.fx.splash(e.pos, 3, 'crash'); else if (this.fx.explosion) this.fx.explosion(e.pos, 4.5, 0.5); }
    if (this.audio && typeof this.audio.play === 'function') this.audio.play('missile_explode', { pos: e.pos, priority: 3, refDistance: 25, maxDistance: 1500 });
  }

  _remove(i) {
    const e = this.list[i];
    if (e.snd && typeof e.snd.stop === 'function') { try { e.snd.stop(0.05); } catch (err) { /* ignore */ } }
    e.snd = null;
    if (e.trail >= 0 && this._trailsObj) this._trailsObj.release(e.trail);
    e.trail = -1;
    e.dead = true; e.core.dead = true; e.core.tgt = null; e.target = null; e.owner = null; e.core.owner = null; e.core.ev.ref = null;
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
    this._pool.push(e);
  }

  // ---------- 音: 近い caps.audioLoops 本だけ missile_loop（4 回/秒選び直す、位置は 15 回/秒）----------
  _updateLoops(dt, ctx) {
    const A = this.audio, N = this.caps.audioLoops;
    if (!A || (typeof A.loop !== 'function' && typeof A.play !== 'function')) return;
    const cam = ctx && ctx.camera ? ctx.camera : null;
    this._loopT -= dt;
    if (this._loopT <= 0) {
      this._loopT = 0.25;
      const stamp = (this._lstamp = (this._lstamp || 0) + 1);
      // 近い順に N 本（N は 2〜3 なので選ぶだけ）
      for (let k = 0; k < N; k++) {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < this.list.length; i++) {
          const e = this.list[i];
          if (e._sel === stamp) continue;
          const d = cam ? e.pos.distanceToSquared(cam) : i;
          if (d < bd) { bd = d; bi = i; }
        }
        if (bi < 0) break;
        this.list[bi]._sel = stamp;
      }
      // 外れたものを先に止める（同時に鳴るのは N 本まで）
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        if (e.snd && e._sel !== stamp) { try { e.snd.stop(0.15); } catch (err) { /* ignore */ } e.snd = null; }
      }
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        if (!e.snd && e._sel === stamp) {
          try {
            // audio.loop（ファイルのループ、上限に数えない）。無い音の物（テストの偽物）は今までの play({ loop: true })
            e.snd = typeof A.loop === 'function' ? A.loop('missile_loop', { pos: e.pos, bus: 'sfx', refDistance: 30, maxDistance: 1500 })
              : A.play('missile_loop', { pos: e.pos, loop: true, refDistance: 30, maxDistance: 1500, synth: false });
          } catch (err) { e.snd = null; }
        }
      }
    }
    this._posT -= dt;
    if (this._posT <= 0) {
      this._posT = 1 / 15;
      for (let i = 0; i < this.list.length; i++) { const e = this.list[i]; if (e.snd && typeof e.snd.setPosition === 'function') e.snd.setPosition(e.pos); }
    }
  }
  loopCount() { let n = 0; for (let i = 0; i < this.list.length; i++) if (this.list[i].snd) n++; return n; }

  // ---------- 見た目 ----------
  _trails() {
    if (this._trailsObj !== undefined) return this._trailsObj;
    if (this.opts.trails) { this._trailsObj = this.opts.trails; return this._trailsObj; }
    const P = this.opts.puffs || {}, T = Object.assign({ slots: 24, points: 24 }, P.trails || {}, (this.opts.mobile && P.mobile && P.mobile.trails) || {});
    this._trailsObj = MR.Trails ? new MR.Trails(this.scene, T) : null;
    this._ownTrails = !!this._trailsObj;
    return this._trailsObj;
  }

  _motorZ(k) { const b = this._bodies[k]; return b ? b.motorZ : -this.typeCfg(k).length * 0.5; }

  // 加算の板（カメラに向ける。色は丸いぼかし。テクスチャを使わない）
  static billboardMaterial(hex, strength) {
    const col = MR.srgb ? MR.srgb(hex) : new THREE.Color(hex);
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: col }, uK: { value: strength || 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '#ifdef USE_INSTANCING',
        '  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  float s = length(instanceMatrix[0].xyz);',
        '#else',
        '  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  float s = 1.0;',
        '#endif',
        '  mv.xy += position.xy * s;',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;', 'uniform float uK;', 'varying vec2 vUv;',
        'void main() {',
        '  float d = length(vUv - 0.5) * 2.0;',
        '  float a = pow(max(0.0, 1.0 - d), 1.6) * uK;',
        '  if (a <= 0.002) discard;',
        '  gl_FragColor = vec4(uColor * a + vec3(a * a * 0.6), a);',
        '}'
      ].join('\n')
    });
  }

  _ensureVis() {
    if (this._vis) return this._vis;
    const quad = new THREE.PlaneGeometry(1, 1);
    const flames = new THREE.InstancedMesh(quad, Missiles.billboardMaterial('#ffc070', 1.0), this.caps.active);
    const flares = new THREE.InstancedMesh(quad, Missiles.billboardMaterial('#fff0c0', 1.0), this.caps.flares);
    for (const im of [flames, flares]) {
      im.frustumCulled = false; im.count = 0; im.visible = false; im.castShadow = false; im.receiveShadow = false;
      im.instanceMatrix.setUsage && im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.renderOrder = 3;
      this.scene.add(im);
    }
    flames.name = 'missile_flames'; flares.name = 'missile_flares';
    this._vis = { quad, flames, flares };
    return this._vis;
  }

  _body(k) {
    let b = this._bodies[k];
    if (b) return b;
    const tc = this.typeCfg(k);
    const fb = Missiles.fallbackGeometry(tc.length || 3);
    const mat = Missiles._fallbackMat || (Missiles._fallbackMat = new THREE.MeshStandardMaterial({ color: MR.srgb ? MR.srgb('#d9dcdf') : 0xd9dcdf, roughness: 0.5, metalness: 0.3 }));
    const mesh = new THREE.InstancedMesh(fb, mat, this.caps.active);
    mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage && mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'missiles_' + k;
    this.scene.add(mesh);
    b = this._bodies[k] = { mesh, fallback: fb, motorZ: -(tc.length || 3) * 0.5, src: 'fallback', n: 0 };
    const baked = Missiles._baked[k];
    if (baked) this._applyBake(b, baked);
    return b;
  }
  _applyBake(b, baked) {
    b.mesh.geometry = baked.geometry; b.mesh.material = baked.material; b.motorZ = baked.motorZ; b.src = 'files';
  }

  // 筒 + 円錐（GLB が無いとき）。機首 +Z、原点は胴の真ん中
  static fallbackGeometry(L) {
    const r = 0.09, cone = Math.min(0.5, L * 0.16);
    const body = new THREE.CylinderGeometry(r, r, L - cone, 8, 1);
    body.translate(0, -cone / 2, 0);
    const nose = new THREE.ConeGeometry(r, cone, 8, 1);
    nose.translate(0, (L - cone) / 2, 0);
    // 尾翼 2 枚（軸 = Y を含む板）
    const fins = new THREE.BoxGeometry(0.42, 0.3, 0.02); fins.translate(0, -L / 2 + 0.2, 0);
    const fins2 = new THREE.BoxGeometry(0.02, 0.3, 0.42); fins2.translate(0, -L / 2 + 0.2, 0);
    // どれも index・position / normal / uv を持つ（規約 11: メソッドとして呼ぶ）
    const utils = THREE.BufferGeometryUtils;
    let g = utils && typeof utils.mergeBufferGeometries === 'function' ? utils.mergeBufferGeometries([body, nose, fins, fins2]) : null;
    if (g) { body.dispose(); nose.dispose(); fins.dispose(); fins2.dispose(); } else g = body;
    g.rotateX(Math.PI / 2); // 軸 Y → Z（機首 +Z）
    g.computeBoundingSphere();
    return g;
  }

  // GLB の試作弾を「機首 +Z・原点は胴の真ん中」に焼く（§4.7）。scene = GLB のシーン、tc = 型の数値。{ geometry, material, motorZ, length } か null
  static bakeProto(scene, tc) {
    if (!scene || !tc || !tc.proto) return null;
    const node = scene.getObjectByName(tc.proto);
    if (!node || !node.isMesh || !node.geometry) return null;
    // 親の projectiles（fa18 の 1e-4 の縮尺）とシーンの根は含めない
    const M = new THREE.Matrix4();
    for (let o = node; o && o.parent && o.name !== 'projectiles'; o = o.parent) { o.updateMatrix(); M.premultiply(o.matrix); }
    const parts = [];
    const g0 = node.geometry.clone(); g0.applyMatrix4(M); parts.push(g0);
    if (tc.fins) {
      const f = node.getObjectByName(tc.fins);
      if (f && f.isMesh && f.geometry) {
        f.updateMatrix();
        const fm = new THREE.Matrix4().multiplyMatrices(M, f.matrix);
        const g1 = f.geometry.clone(); g1.applyMatrix4(fm); parts.push(g1);
      }
    }
    let motor = null;
    const mn = node.getObjectByName('motor_' + tc.proto.replace(/^proj_/, '')) || node.getObjectByName('motor');
    if (mn) { mn.updateMatrixWorld(true); const mm = new THREE.Matrix4(); for (let o = mn; o && o !== node; o = o.parent) { o.updateMatrix(); mm.premultiply(o.matrix); } motor = new THREE.Vector3().applyMatrix4(mm).applyMatrix4(M); }
    let g = parts[0];
    if (parts.length > 1) {
      // 共通の属性だけ残す（規約 11: メソッドとして呼ぶ）
      const names = Object.keys(parts[0].attributes).filter((n) => parts.every((p) => p.attributes[n]));
      for (const p of parts) { for (const n of Object.keys(p.attributes)) if (names.indexOf(n) < 0) p.deleteAttribute(n); if (!p.index) p.setIndex([...Array(p.attributes.position.count).keys()]); }
      const utils = THREE.BufferGeometryUtils;
      const mg = utils && typeof utils.mergeBufferGeometries === 'function' ? utils.mergeBufferGeometries(parts) : null;
      if (mg) g = mg;
    }
    // 軸を揃える: projectiles.glb は機首 −Z・原点は機首の先 → Y 軸で 180° 回す
    const fix = new THREE.Matrix4();
    if (tc.glb === 'projectiles') fix.makeRotationY(Math.PI);
    g.applyMatrix4(fix);
    if (motor) motor.applyMatrix4(fix);
    g.computeBoundingBox();
    const bb = g.boundingBox, cz = (bb.min.z + bb.max.z) / 2;
    if (Math.abs(cz) > 1e-4) { g.translate(0, 0, -cz); if (motor) motor.z -= cz; }
    g.computeBoundingBox(); g.computeBoundingSphere();
    const L = g.boundingBox.max.z - g.boundingBox.min.z;
    return { geometry: g, material: node.material, motorZ: motor ? motor.z : -L / 2, length: L, verts: g.attributes.position.count };
  }

  // 型の GLB を読んで焼く（fa18 は MR.Jet と同じパース結果を使う）。keys = 型の名前の配列。Promise
  preload(keys) {
    const a = this.assets;
    if (!a || typeof a.loadModel !== 'function') return Promise.resolve(0);
    const byGlb = {};
    for (const k of keys) { const tc = this.typeCfg(k); if (tc.glb && tc.proto && !Missiles._baked[k]) (byGlb[tc.glb] = byGlb[tc.glb] || []).push(k); }
    const jobs = Object.keys(byGlb).map((glb) => {
      const file = 'models/' + glb + '.glb';
      const key = typeof a.resolve === 'function' ? a.resolve(file) : file;
      if (!key) return Promise.resolve(0);
      return Promise.resolve().then(() => a.loadModel(key)).then((res) => {
        const scene = res && res.scene ? res.scene : null;
        let n = 0;
        for (const k of byGlb[glb]) {
          if (Missiles._baked[k]) continue;
          const bk = Missiles.bakeProto(scene, this.typeCfg(k));
          if (!bk) continue;
          Missiles._baked[k] = bk; n++;
          if (this._bodies[k]) this._applyBake(this._bodies[k], bk);
        }
        return n;
      }).catch(() => 0);
    });
    return Promise.all(jobs).then((r) => r.reduce((s, x) => s + x, 0));
  }

  _writeVisuals(dt, ctx) {
    const nL = this.list.length, nF = this.flares.length;
    if (!this._vis && !nL && !nF) { if (this._trailsObj && this._ownTrails) this._trailsObj.update(dt, ctx && ctx.camera); return; }
    const V = this._ensureVis(), m4 = this._m4, q = this._q, sc = this._sc, pos = this._v1, dirV = this._v2;
    for (const k in this._bodies) this._bodies[k].n = 0;
    let nfl = 0;
    const fa = V.flames.instanceMatrix.array;
    for (let i = 0; i < nL; i++) {
      const e = this.list[i], m = e.core;
      const b = this._body(e.k);
      const Vm = Math.hypot(m.v[0], m.v[1], m.v[2]);
      if (Vm > 1e-6) dirV.set(m.v[0] / Vm, m.v[1] / Vm, m.v[2] / Vm); else dirV.set(m.dir[0], m.dir[1], m.dir[2]);
      q.setFromUnitVectors(this._Z, dirV);
      pos.set(m.p[0], m.p[1], m.p[2]);
      sc.set(1, 1, 1);
      m4.compose(pos, q, sc);
      m4.toArray(b.mesh.instanceMatrix.array, b.n * 16);
      b.n++;
      if (m.ph === 1 && nfl < this.caps.active) {
        e.flick = (e.flick + dt * 23.7) % 1;
        const s = 1.6 * (0.85 + 0.3 * Math.abs(Math.sin(e.flick * Math.PI * 2)));
        pos.addScaledVector(dirV, b.motorZ - 0.35);
        const o = nfl * 16;
        fa[o] = s; fa[o + 1] = 0; fa[o + 2] = 0; fa[o + 3] = 0; fa[o + 4] = 0; fa[o + 5] = s; fa[o + 6] = 0; fa[o + 7] = 0;
        fa[o + 8] = 0; fa[o + 9] = 0; fa[o + 10] = s; fa[o + 11] = 0; fa[o + 12] = pos.x; fa[o + 13] = pos.y; fa[o + 14] = pos.z; fa[o + 15] = 1;
        nfl++;
      }
    }
    for (const k in this._bodies) {
      const b = this._bodies[k];
      b.mesh.count = b.n; b.mesh.visible = b.n > 0;
      if (b.n) b.mesh.instanceMatrix.needsUpdate = true;
    }
    V.flames.count = nfl; V.flames.visible = nfl > 0;
    if (nfl) V.flames.instanceMatrix.needsUpdate = true;
    const ra = V.flares.instanceMatrix.array, life = this.cfg.flareLife || 3.2;
    for (let i = 0; i < nF; i++) {
      const f = this.flares[i], s = 1.2 + 2.4 * Math.max(0, f.life / life), o = i * 16;
      ra[o] = s; ra[o + 1] = 0; ra[o + 2] = 0; ra[o + 3] = 0; ra[o + 4] = 0; ra[o + 5] = s; ra[o + 6] = 0; ra[o + 7] = 0;
      ra[o + 8] = 0; ra[o + 9] = 0; ra[o + 10] = s; ra[o + 11] = 0; ra[o + 12] = f.p[0]; ra[o + 13] = f.p[1]; ra[o + 14] = f.p[2]; ra[o + 15] = 1;
    }
    V.flares.count = nF; V.flares.visible = nF > 0;
    if (nF) V.flares.instanceMatrix.needsUpdate = true;
    if (this._trailsObj && this._ownTrails) this._trailsObj.update(dt, ctx && ctx.camera);
  }

  // 見えている描画の数（体の型ごと 1 + 炎 1 + フレア 1 + 煙の帯 1。smoke 17 の M12）
  drawObjects() {
    let n = 0;
    for (const k in this._bodies) if (this._bodies[k].mesh.visible && this._bodies[k].mesh.count > 0) n++;
    if (this._vis) { if (this._vis.flames.visible && this._vis.flames.count) n++; if (this._vis.flares.visible && this._vis.flares.count) n++; }
    if (this._trailsObj && this._trailsObj.mesh && this._trailsObj.mesh.visible) n++;
    return n;
  }
  meshes() {
    const out = [];
    for (const k in this._bodies) out.push(this._bodies[k].mesh);
    if (this._vis) out.push(this._vis.flames, this._vis.flares);
    if (this._trailsObj && this._trailsObj.mesh) out.push(this._trailsObj.mesh);
    return out;
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i);
    for (const f of this.flares) { f.life = 0; f.gen++; this._fpool.push(f); }
    this.flares.length = 0;
    if (this._trailsObj && this._ownTrails) this._trailsObj.clear();
    for (const k in this._bodies) { this._bodies[k].mesh.count = 0; this._bodies[k].mesh.visible = false; }
    if (this._vis) { this._vis.flames.count = 0; this._vis.flames.visible = false; this._vis.flares.count = 0; this._vis.flares.visible = false; }
  }

  // ゲームを終える（Game.stop）: 飛んでいるミサイルのループ音（missile_loop）を止めて、ミサイルとフレアを外す。自分で作ったメッシュ・形・材質は捨てる
  //   （焼いた試作弾の形と GLB の材質は共有 = Missiles._baked なので捨てない）
  dispose() {
    this.clear();
    for (const k in this._bodies) {
      const b = this._bodies[k];
      if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
      b.fallback.dispose();
      if (b.mesh.dispose) b.mesh.dispose();
    }
    this._bodies = {};
    if (this._vis) {
      for (const im of [this._vis.flames, this._vis.flares]) { if (im.parent) im.parent.remove(im); im.material.dispose(); if (im.dispose) im.dispose(); }
      this._vis.quad.dispose();
      this._vis = null;
    }
    if (this._trailsObj && this._ownTrails) this._trailsObj.dispose();
    this._trailsObj = undefined;
    this._ctx = null;
  }
};
MR.Missiles._id = 0;
MR.Missiles._baked = {};
MR.Missiles.NO_MESH = Object.freeze({ parent: null, visible: false, isPlaceholder: true });
// 飛び方の既定値（game.json の vehicles.types.jet.missile と missiles が上書き。数・ロックは jet.js の missile）
MR.Missiles.DEFAULTS = {
  speed: 480, accel: 220, ejectSpeed: 15, motorTime: 3.5, coastDrag: 40, dropTime: 0.25, armTime: 0.35, life: 9, turnG: 55, fuse: 9, loftFrom: 400, loftK: 0.5, loftMax: 300,
  losEvery: 0.1, losClear: 4, liftRate: 120, blastRadius: 16, damage: 650, trailEvery: 0.05, decoyRange: 2500, decoyChance: 0.8, flareLife: 3.2, maxFlares: 18,
  maxStep: 1 / 60, defaultType: 'aim9x', select: 'auto',
  caps: { active: 24, flares: 48, audioLoops: 3, mobileActive: 12, mobileFlares: 24, mobileAudioLoops: 2, server: 16 },
  trail: { every: 0.04, width: 0.9, life: 2.2 }
};
