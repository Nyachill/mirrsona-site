// 墜落・爆発の見た目と火の記録（MR.Crashes。E3.1）。ゲームの事実（爆風・火の続く秒・地面の火・壁の火・誘爆・焦げ）は burn.js（MR.Burn）の plan、
//   ここは見た目と音だけ（板は MR.Puffs の 4 つのアトラス = 描画 4 回 + 衝撃波の輪 1 + 焦げ 1。破片は E3.2 で 1 つ足す = 全部で 7 回まで）。
//   new MR.Crashes(scene, fireCfg, opts)
//     fireCfg = game.json の top-level fire（caps / mobile / lod / column / flashLight / shake / farFrom / scorch.sec / steamSec …）
//     opts: { fx（MR.FX: しぶき）, audio, assets, mobile, puffs（MR.Puffs か、それを返す関数 = 最初の板で作る）, blasts（explosives.blasts）,
//             onShake(k)（揺れを足す）, listener（{ x, y, z } = カメラの位置。update の cam で書き換わる）,
//             fireTargets(visit) / onFireHit(out, n)（地面の火のダメージ。E3.2）, waterAt(x, z)（水面 | null）,
//             debris（MR.Debris か、それを返す関数。E3.2）, onSecondary(x, y, z, r, dmg, kind)（誘爆の小さな爆風 = game.explode の 'secondary'。ソロだけ）}
//   explode(spec, plan, o) → 記録 | null … 爆発の見た目（火の玉の板 大 1 + 小 3・火の粉・衝撃波の輪・光（PC だけ。始めに 1 つ作った PointLight を
//     明るくするだけ）・距離で揺れ・音（farFrom m 以内は 3D の explosion_large、遠いと 2D の explosion_far を音の速さで遅らせて ≤ 1.5 秒）・
//     火が残るなら fire_ignite）。水（plan.steam）は fx.splash + 湯気の板 + steam_hiss（火は無し）。plan.fireSec > 0 なら火の記録、plan.scorch なら焦げ。
//     o: { silent（音なし）, noShake, size（見た目の大きさ）}
//   attach(vehicle, rec) … 残骸が残っている間は記録がその位置について行く（落ちる残骸の燃える尾）。残骸が消された（disposed・root が外れた）・
//     復活した・沈んだら最後の位置に残って燃え続ける（1 km 先からも煙の柱が見える = D5）
//   land(vehicle, plan) → 記録 | null … 空中で撃墜された残骸が落ちた（D5 の land）: 空中の記録は燃え尽きに回し、落ちた所に新しい記録（爆風なし）
//   blast(x, y, z, s, o) … 見た目だけの爆発（game.explode・ミサイル）。o: { water, air, silent, shake（false で揺らさない）, ring, flash, splash（水しぶきの種類） }
//   impact(x, y, z, s) … 地上で燃えている残骸が落ち着いた小さな火の玉
//   update(dt, cam) … 記録ごとにカメラからの距離で fire.lod（near / mid / far）: near は炎・火の粉・煙・柱、mid は炎と煙を少なく + 柱、far は柱だけ。
//     near は近い 3 つまで。柱の板は fogScale で霧を薄く、far では column.farScale 倍まで大きく。fire_loop は近い caps.loops 個（4 回/秒選び直す。offset はランダム・rate 0.9〜1.1）、
//     steam_hiss は 1 つ。焦げは scorch.sec 秒で消える。新しく物を作らない（記録・板の詰め物は使い回し）
//   地面の火（E3.2）: this.field = MR.Burn.Field（caps.patches はタッチ端末なら mobile）。explode / land(v, plan, o) が plan.patches を入れる（o.by・o.gen = 連鎖の段）。
//     update が毎フレーム field.tick（fire.tick 秒ごとに opts.fireTargets(visit) の目標 → opts.onFireHit(out, n) = game.js がダメージ。オンラインは目標なし）、
//     板は輪の中の炎（育つ・燃える・縮む = Field.radius）、近いと火の粉と低い煙。LOD: lod.near まで near、lod.mid まで mid（炎だけ・少なく大きく）、遠くは無し
//     （記録の柱が見える）。炎の板の合計は fire の caps × patchFx.share に収める。壁の火（plan.facade）は記録の near / mid で面の上に flames 個の炎と煙（facadeFx）。
//   誘爆（E3.2）: explode / land が plan.secondaries（[t, x,y,z, r, dmg]、t = 今からの秒）を待ち行列（SEC_CAP 個まで、超えた分は捨てる = stats.secDropped）へ。
//     時刻が来たら小さな火の玉（fire.secondaryFx.size か explosives.blasts.secondary.fx）・火の粉・破片（kit 'secondary'）・secondary_pop（3D）と
//     opts.onSecondary（ダメージ。オンラインの game は何もしない = D10）。燃えていた記録が水で消えた（quench）ら、その記録の誘爆は取り消す
//   破片（E3.2）: explode は plan.debris 個（空中の撃墜は plan に無いので fire.debris[kind] の debrisFx.airShare 倍）、land は debrisFx.landShare 倍を
//     opts.debris.burst(kind, …)（MR.Debris = 1 回の描画・跳ねる・debris_metal）
//   addPatch(x, y, z, r0, r1, t0, t1, by, kind, gen) … 地面の火 1 つ（E3.3: 滑る戦闘機の跡）。sparks(x, y, z, vx, vz, n, sp0, sp1) … 地面をこする火花（ember）と土ぼこり
//   quench(rec, x, y, z) … 燃えている記録を水面の湯気にする（地面・屋上で燃えていた残骸が水に落ちた・沈んだ = opts.waterAt の水面）。splash(x, y, z, s) … しぶきと湯気だけ
//   数値は fire の tail / loopRange / steamRange / lod.nearMax / column.life / patchFx / facadeFx（無ければ Crashes の既定）
//   stats / records（生きている記録）/ log（最後の 32 件の { stage, kind, surface, x, y, z, bx, by, bz, patches, scorch, facade, fireSec, steam, t }）
//   clear() / dispose()（game.stop）。drawCalls() = 輪と焦げのメッシュ（板は puffs.drawCalls()）
//   メッシュは frustumCulled = false（r128 の InstancedMesh は形の外接球 = 原点の近くで消す）
window.MR = window.MR || {};

MR.Crashes = class Crashes {
  constructor(scene, cfg, opts) {
    cfg = cfg || {};
    opts = opts || {};
    this.scene = scene;
    this.cfg = cfg;
    this.fx = opts.fx || null;
    this.audio = opts.audio || null;
    this.assets = opts.assets || null;
    this.mobile = !!opts.mobile;
    this._puffs = opts.puffs || null;
    this.blasts = opts.blasts || {};
    this.onShake = typeof opts.onShake === 'function' ? opts.onShake : null;
    const M = (this.mobile && cfg.mobile) || {};
    this.caps = Object.assign({}, Crashes.CAPS, cfg.caps || {}, M.caps || {});
    this.flashOn = this.mobile ? !!(M.flashLight != null ? M.flashLight : false) : cfg.flashLight !== false;
    const L = cfg.lod || {};
    this.lod = { near: L.near || 150, mid: L.mid || 600, far: L.far || 2500 };
    const CO = cfg.column || {};
    this.column = { height: CO.height || 120, every: CO.every || 0.5, s0: (CO.size && CO.size[0]) || 14, s1: (CO.size && CO.size[1]) || 40, fog: CO.fogScale || 0.35, farScale: CO.farScale || 1 };
    // 数値は fire（無ければ下の既定）
    this.tail = cfg.tail > 0 ? cfg.tail : Crashes.TAIL;
    this.colLife = CO.life > 0 ? CO.life : Crashes.COL_LIFE;
    this.loopRange = cfg.loopRange > 0 ? cfg.loopRange : Crashes.LOOP_RANGE;
    this.steamRange = cfg.steamRange > 0 ? cfg.steamRange : Crashes.STEAM_RANGE;
    this.nearMax = L.nearMax >= 0 ? L.nearMax : Crashes.NEAR_MAX;
    this.patchFx = Crashes._patchFx(cfg.patchFx);
    this.facadeFx = Object.assign({ spacing: 3, spread: 3, near: 0.1, mid: 0.25, size: [3, 5], out: 0.9 }, cfg.facadeFx || {});
    // 地面の火（MR.Burn.Field。caps.patches はタッチ端末なら mobile.caps）。ダメージはソロだけ: fireTargets(visit) が目標を渡し、onFireHit(out, n) が当てる
    this.field = (typeof MR !== 'undefined' && MR.Burn && MR.Burn.Field) ? new MR.Burn.Field(Object.assign({}, cfg, { caps: this.caps })) : null;
    this.fireTargets = typeof opts.fireTargets === 'function' ? opts.fireTargets : null;
    this.onFireHit = typeof opts.onFireHit === 'function' ? opts.onFireHit : null;
    this.waterAt = typeof opts.waterAt === 'function' ? opts.waterAt : null;
    this._debris = opts.debris || null;
    this.onSecondary = typeof opts.onSecondary === 'function' ? opts.onSecondary : null;
    // 誘爆の待ち行列（固定の大きさ）
    const QC = Crashes.SEC_CAP;
    this._secQ = { cap: QC, t: new Float32Array(QC), x: new Float32Array(QC), y: new Float32Array(QC), z: new Float32Array(QC), r: new Float32Array(QC),
      dmg: new Float32Array(QC), rec: new Int32Array(QC), live: new Uint8Array(QC), kind: new Array(QC).fill(''), n: 0 };
    this._hits = [];
    this.listener = { x: 0, y: 0, z: 0 };
    // 記録（caps.fires 個を前もって作る）
    this.records = [];
    this._pool = [];
    for (let i = 0; i < this.caps.fires; i++) this._pool.push(Crashes._newRec());
    this._near = new Int32Array(this.caps.fires);
    this.log = [];
    this._seq = 0;
    // 衝撃波の輪・焦げ（最初に使うときにメッシュを作る）
    const RC = Crashes.RINGS;
    this._ring = { cap: RC, x: new Float32Array(RC), y: new Float32Array(RC), z: new Float32Array(RC), r: new Float32Array(RC), t: new Float32Array(RC), dur: new Float32Array(RC), live: new Uint8Array(RC), n: 0, mesh: null };
    const SC = Math.max(1, this.caps.scorch | 0);
    this._scorch = { cap: SC, x: new Float32Array(SC), y: new Float32Array(SC), z: new Float32Array(SC), r: new Float32Array(SC), rot: new Float32Array(SC), t: new Float32Array(SC), live: new Uint8Array(SC), born: new Uint32Array(SC), n: 0, mesh: null, tex: null, texOwned: false };
    // 光（PC だけ。始めに 1 つ作ってシーンに置いたまま = ライトの数を変えない。使っていないときは 0）
    this.light = null;
    this._flashT = 0; this._flashDur = 0.3; this._flashPeak = 0;
    if (this.flashOn && typeof THREE !== 'undefined' && THREE.PointLight) {
      this.light = new THREE.PointLight(MR.srgb ? MR.srgb('#ffb060') : 0xffb060, 0, 80, 2);
      this.light.name = 'crash_flash';
      scene.add(this.light);
    }
    this._o = {};
    this._loopT = 0;
    this._steamLoop = null; this._steamRec = null;
    this._ignT = 0;
    this.stats = {
      explosions: 0, blasts: 0, impacts: 0, lands: 0, records: 0, fires: 0, steam: 0, evicted: 0, recordsMax: 0, attached: 0, detached: 0,
      scorch: 0, scorchAdded: 0, rings: 0, loops: 0, loopsMax: 0, loopStarts: 0, steamLoops: 0, flashes: 0, farSounds: 0, nearSounds: 0, lastFarDelay: 0, lastFarDist: 0,
      lastShake: 0, ignites: 0, splashes: 0, quenched: 0, secScheduled: 0, secPlayed: 0, secCancelled: 0, secDropped: 0, secPending: 0, debrisSpawned: 0, patches: 0, patchesMax: 0, patchesAdded: 0, patchHits: 0, patchLod: { near: 0, mid: 0 },
      emitted: { fire: 0, ember: 0, smoke: 0, column: 0, steam: 0, trail: 0, explosion: 0, patch: 0, facade: 0 },
      lod: { near: 0, mid: 0, far: 0, off: 0 }, created: 0, disposed: 0, updMs: 0, updMsMax: 0
    };
    this._lastE = { fire: 0, ember: 0, smoke: 0, column: 0, steam: 0, trail: 0 };
  }

  static _newRec() {
    return { id: 0, kind: '', stage: '', surface: '', x: 0, y: 0, z: 0, bx: 0, by: 0, bz: 0, t: 0, sec: 0, steam: 0, sizeK: 1, v: null, awaitLand: false,
      fireT: 0, smokeT: 0, colT: 0, emberT: 0, steamT: 0, trailT: 0, facT: 0, facI: 0, st0: 0, loop: null, d: 0, lod: '', out: false, patches: 0, facade: null, scorch: null, seed: 0 };
  }

  _puffsObj() { const p = this._puffs; return typeof p === 'function' ? p() : p; }

  // 型の見た目の大きさ（explosives.blasts[fire.blast[kind]].fx）
  sizeOf(kind) {
    const b = this.cfg.blast && this.cfg.blast[kind];
    const s = typeof b === 'string' ? this.blasts[b] : null;
    if (s && s.fx > 0) return s.fx;
    return Crashes.SIZE[kind] || 4;
  }

  // ---------- 爆発 ----------
  explode(spec, plan, o) {
    if (!plan) return null;
    const s = (o && o.size) || this.sizeOf(plan.kind);
    const water = plan.surface === 'water' || plan.steam > 0;
    this.stats.explosions++;
    this.blast(plan.x, plan.y, plan.z, s, { water, air: plan.stage === 'air', silent: o && o.silent, shake: !(o && o.noShake), ring: true, flash: true, kind: plan.kind });
    const rec = (plan.fireSec > 0 || plan.steam > 0) ? this._addRec(plan, plan.x, plan.y, plan.z) : null;
    this._addPatches(plan, o);
    this._addSecondaries(plan, rec);
    this._debrisFor(plan, spec, plan.stage === 'air' ? -1 : 1);
    if (plan.fireSec > 0 && !(o && o.silent)) this._ignite(plan.x, plan.y, plan.z);
    if (plan.scorch) this.addScorch(plan.scorch[0], plan.scorch[1], plan.scorch[2], plan.scorch[3]);
    this._log(plan, rec);
    return rec;
  }

  _debrisObj() { const d = this._debris; return typeof d === 'function' ? d() : d; }

  // 破片: share > 0 = plan.debris × share、-1 = 空中の撃墜（fire.debris[kind] × airShare）
  _debrisFor(plan, spec, share) {
    if (plan.steam > 0 || plan.surface === 'water') return;
    const D = this._debrisObj();
    if (!D || typeof D.burst !== 'function') return;
    const X = this.cfg.debrisFx || {};
    let n;
    if (share < 0) {
      const dn = this.cfg.debris && this.cfg.debris[plan.kind];
      if (!Array.isArray(dn)) return;
      n = Math.round((dn[0] + Math.random() * (dn[1] - dn[0])) * (X.airShare != null ? X.airShare : 0.6));
    } else n = Math.round((plan.debris || 0) * share);
    if (!(n > 0)) return;
    const vx = spec ? spec.vx || 0 : 0, vy = spec ? spec.vy || 0 : 0, vz = spec ? spec.vz || 0 : 0;
    this.stats.debrisSpawned += D.burst(plan.kind, plan.x, plan.y, plan.z, n, vx, vy, vz);
  }

  // 誘爆を待ち行列へ（plan.secondaries の t は今からの秒）
  _addSecondaries(plan, rec) {
    const L = plan.secondaries;
    if (!L || !L.length) return;
    const Q = this._secQ;
    for (let k = 0; k < L.length; k++) {
      const s = L[k];
      let i = -1;
      for (let j = 0; j < Q.cap; j++) if (!Q.live[j]) { i = j; break; }
      if (i < 0) { this.stats.secDropped++; continue; }
      Q.live[i] = 1; Q.n++;
      Q.t[i] = s[0]; Q.x[i] = s[1]; Q.y[i] = s[2]; Q.z[i] = s[3]; Q.r[i] = s[4]; Q.dmg[i] = s[5];
      Q.rec[i] = rec ? rec.id : 0; Q.kind[i] = plan.kind;
      this.stats.secScheduled++;
    }
    this.stats.secPending = Q.n;
  }

  _cancelSecondaries(id) {
    if (!id) return;
    const Q = this._secQ;
    for (let i = 0; i < Q.cap; i++) if (Q.live[i] && Q.rec[i] === id) { Q.live[i] = 0; Q.n--; this.stats.secCancelled++; }
    this.stats.secPending = Q.n;
  }

  _updateSecondaries(dt) {
    const Q = this._secQ;
    if (!Q.n) return;
    for (let i = 0; i < Q.cap; i++) {
      if (!Q.live[i]) continue;
      Q.t[i] -= dt;
      if (Q.t[i] > 0) continue;
      Q.live[i] = 0; Q.n--;
      this._secondary(Q.x[i], Q.y[i], Q.z[i], Q.r[i], Q.dmg[i], Q.kind[i]);
    }
    this.stats.secPending = Q.n;
  }

  // 誘爆 1 つ: 小さな火の玉・破片・secondary_pop・ダメージ（onSecondary）
  _secondary(x, y, z, r, dmg, kind) {
    const X = this.cfg.secondaryFx || {};
    const bs = this.blasts && this.blasts.secondary;
    const s = X.size > 0 ? X.size : (bs && bs.fx > 0 ? bs.fx : 1.5);
    this.stats.secPlayed++;
    this._fireball(x, y, z, s, false, 1);
    this._flash(x, y, z, s * 0.6);
    const D = this._debrisObj();
    if (D && typeof D.burst === 'function') this.stats.debrisSpawned += D.burst('secondary', x, y, z, null, 0, 0, 0);
    if (this.audio && typeof this.audio.play === 'function') {
      const P = this._sp4 || (this._sp4 = { x: 0, y: 0, z: 0 });
      P.x = x; P.y = y; P.z = z;
      this.audio.play('secondary_pop', { pos: P, refDistance: X.refDistance || 15, maxDistance: X.maxDistance || 600, rate: 0.9 + Math.random() * 0.2, priority: 2 });
    }
    if (this.onSecondary) this.onSecondary(x, y, z, r, dmg, kind);
  }

  attach(v, rec) {
    if (!v || !rec || rec.out) return;
    rec.v = v;
    v._fireRec = rec;
    this.stats.attached++;
  }

  _detach(rec) {
    const v = rec.v;
    if (!v) return;
    if (v._fireRec === rec) v._fireRec = null;
    rec.v = null;
    this.stats.detached++;
  }

  // 撃墜された残骸が落ちた（D5 の land）
  land(v, plan, o) {
    if (!plan) return null;
    this.stats.lands++;
    const old = v && v._fireRec;
    if (old) { this._detach(old); if (old.stage === 'air' && old.t < old.sec) old.t = old.sec; } // 空中の火は燃え尽きへ（煙だけ少し残る）
    const s = this.sizeOf(plan.kind) * 0.6;
    const water = plan.surface === 'water' || plan.steam > 0;
    if (water) this._water(plan.x, plan.y, plan.z, s);
    else this._fireball(plan.x, plan.y, plan.z, s, false, 2);
    const rec = (plan.fireSec > 0 || plan.steam > 0) ? this._addRec(plan, plan.x, plan.y, plan.z) : null;
    this._addPatches(plan, o);
    this._addSecondaries(plan, rec);
    this._debrisFor(plan, null, (this.cfg.debrisFx && this.cfg.debrisFx.landShare != null) ? this.cfg.debrisFx.landShare : 0.5);
    if (plan.fireSec > 0) this._ignite(plan.x, plan.y, plan.z);
    if (plan.scorch) this.addScorch(plan.scorch[0], plan.scorch[1], plan.scorch[2], plan.scorch[3]);
    if (rec && v && !water) this.attach(v, rec);
    this._log(plan, rec);
    return rec;
  }

  // 地面の火を Field へ（o.by = 起こした物、o.gen = 連鎖の段）
  _addPatches(plan, o) {
    if (!this.field || !plan.patches || !plan.patches.length) return;
    this.stats.patchesAdded += this.field.add(plan, o && o.by != null ? o.by : null, (o && o.gen) || 0);
    this.stats.patches = this.field.count;
    if (this.field.count > this.stats.patchesMax) this.stats.patchesMax = this.field.count;
  }

  // 地面の火を 1 つ（E3.3: 滑る戦闘機の跡 = trailEvery m ごと）。by = 起こした物、kind = 育つ秒（patch[kind].grow）、gen = 連鎖の段
  addPatch(x, y, z, r0, r1, t0, t1, by, kind, gen) {
    if (!this.field) return null;
    const pk = (this.cfg.patch || {})[kind || 'jet'];
    const r = this.field.addPatch(x, y, z, r0, r1, t0, t1, by == null ? null : by, pk && pk.grow, gen || 0);
    this.stats.patchesAdded++;
    this.stats.patches = this.field.count;
    if (this.field.count > this.stats.patchesMax) this.stats.patchesMax = this.field.count;
    return r;
  }

  // 地面をこする火花（E3.3: 滑る戦闘機）: n 個の火の粉（ember）が進む向きの後ろ・横へ跳ねて落ちる + 時々 低い土ぼこり（smoke）。戻り値は出した数
  sparks(x, y, z, vx, vz, n, sp0, sp1) {
    const P = this._puffsObj();
    if (!P || !(n > 0)) return 0;
    const R = Math.random, o = this._o, hs = Math.hypot(vx, vz) || 1, ux = vx / hs, uz = vz / hs;
    const a0 = sp0 > 0 ? sp0 : 4, a1 = sp1 > a0 ? sp1 : a0 + 6;
    for (let i = 0; i < n; i++) {
      const sp = a0 + R() * (a1 - a0), side = (R() - 0.5) * 1.6;
      // 機体の速さの半分ほどで前へ流れ、横と上へ散る（地面の上を跳ねる）
      Crashes._opt(o, vx * 0.45 + (-uz * side - ux * 0.3) * sp, sp * (0.25 + R() * 0.5), vz * 0.45 + (ux * side - uz * 0.3) * sp, -0.05, -9, 0.6, 1, 1.5, 1.0, 0.55, 0);
      P.spawn('ember', x + (R() - 0.5) * 2, y + 0.2, z + (R() - 0.5) * 2, 0.2 + R() * 0.25, 0.35 + R() * 0.4, o);
    }
    this.stats.emitted.ember += n;
    if (R() < 0.35) {
      Crashes._opt(o, vx * 0.15 + (R() - 0.5), 0.8 + R(), vz * 0.15 + (R() - 0.5), 1.2, 0.2, 0.6, 0.45, 0.42, 0.4, 0.37, R() * 6.28);
      o.fadeIn = 0.15;
      P.spawn('smoke', x, y + 0.6, z, 2.2 + R(), 1.8 + R(), o);
      this.stats.emitted.smoke++;
    }
    this.stats.sparks = (this.stats.sparks || 0) + n;
    return n;
  }

  // 燃えている記録を水で消す（地面・屋上で燃えていた残骸が水へ落ちた・沈んだ）: 残骸から外し、火と煙の尾をやめて (x, y, z) で steamSec 秒の湯気
  quench(rec, x, y, z) {
    if (!rec || rec.out) return;
    this._detach(rec);
    this._cancelSecondaries(rec.id);
    if (rec.loop) { rec.loop.stop(0.15); rec.loop = null; }
    rec.x = x; rec.y = y; rec.z = z; rec.surface = 'water';
    rec.sec = 0; rec.facade = null; rec.awaitLand = false;
    rec.st0 = rec.t; rec.steam = rec.t + (this.cfg.steamSec || 6);
    this._water(x, y, z, this.sizeOf(rec.kind) * 0.5);
    this.stats.quenched++;
  }

  // 水しぶき + 湯気の板だけ（燃えている記録の無い残骸が水に落ちた）
  splash(x, y, z, s) { this._water(x, y, z, s > 0 ? s : 2.5); }

  // 地上で燃えている残骸が落ち着いた（小さな火の玉）
  impact(x, y, z, s) {
    this.stats.impacts++;
    this._fireball(x, y, z, s || 2.5, false, 1);
  }

  // 見た目だけの爆発
  blast(x, y, z, s, o) {
    s = s > 0 ? s : 3;
    this.stats.blasts++;
    const water = !!(o && o.water), air = !!(o && o.air);
    if (water) this._water(x, y, z, s, o && o.splash);
    else {
      this._fireball(x, y, z, s, air, 3);
      if (!o || o.ring !== false) this._addRing(x, y, z, s);
      if (!o || o.flash !== false) this._flash(x, y, z, s);
    }
    const lx = this.listener.x - x, ly = this.listener.y - y, lz = this.listener.z - z;
    const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (!(o && o.shake === false) && this.onShake) {
      const R = this.cfg.shake || 120;
      const k = d < R ? (1 - d / R) * Math.min(1.2, s / 5) : 0;
      this.stats.lastShake = k;
      if (k > 0) this.onShake(k);
    }
    if (!(o && o.silent) && this.audio && typeof this.audio.play === 'function') {
      const far = this.cfg.farFrom || 300;
      const P = this._sp || (this._sp = { x: 0, y: 0, z: 0 });
      P.x = x; P.y = y; P.z = z;
      if (d <= far) { this.stats.nearSounds++; this.audio.play('explosion_large', { pos: P, refDistance: 25, maxDistance: 1200, priority: 3 }); }
      else {
        const delay = Math.min(1.5, d / 343);
        this.stats.farSounds++; this.stats.lastFarDelay = delay; this.stats.lastFarDist = d;
        this.audio.play('explosion_far', { volume: Math.max(0.15, Math.min(1, far / d)), delay, priority: 2 });
      }
    }
  }

  // 火の玉: 大 1 + 小 n（explosion）・煙（地上だけ）・火の粉（ember）
  _fireball(x, y, z, s, air, nSmall) {
    const P = this._puffsObj();
    if (!P) { if (this.fx && this.fx.explosion) this.fx.explosion({ x, y, z }, s, 0.5); return; }
    const R = Math.random, o = this._o;
    Crashes._opt(o, 0, 0.6, 0, s * 0.25, 0, 0.6, 1, 1, 1, 1, R() * 6.28);
    P.spawn('explosion', x, y + s * 0.15, z, s * 2.4, 1.9 + R() * 0.3, o);
    for (let i = 0; i < nSmall; i++) {
      Crashes._opt(o, (R() - 0.5) * s * 1.6, s * (0.3 + R() * 0.6), (R() - 0.5) * s * 1.6, s * 0.3, 0, 1.4, 1, 1, 1, 1, R() * 6.28);
      o.frame0 = R() * 4;
      P.spawn('explosion', x + (R() - 0.5) * s * 0.9, y + R() * s * 0.4, z + (R() - 0.5) * s * 0.9, s * (0.9 + R() * 0.5), 1.3 + R() * 0.5, o);
    }
    this.stats.emitted.explosion += 1 + nSmall;
    if (!air) {
      for (let i = 0, n = 4 + (R() * 3 | 0); i < n; i++) {
        Crashes._opt(o, (R() - 0.5) * s * 0.8, 1.2 + R() * 1.6, (R() - 0.5) * s * 0.8, s * 0.55, 0.35, 0.5, 0.75, 0.16, 0.15, 0.14, R() * 6.28);
        o.fadeIn = 0.35;
        P.spawn('smoke', x + (R() - 0.5) * s, y + s * 0.3 + R() * s * 0.5, z + (R() - 0.5) * s, s * 1.5, 4.5 + R() * 2, o);
      }
    }
    // 火の粉（重力で落ちる）
    for (let i = 0, n = Math.min(24, 8 + (s * 2.5 | 0)); i < n; i++) {
      const a = R() * 6.283, up = 0.2 + R() * 0.9, sp = s * (2.5 + R() * 4);
      Crashes._opt(o, Math.cos(a) * sp * (1 - up * 0.5), sp * up, Math.sin(a) * sp * (1 - up * 0.5), -0.05, -9, 0.9, 1, 1.4, 0.9, 0.5, 0);
      P.spawn('ember', x, y + 0.5, z, 0.25 + R() * 0.35, 0.8 + R() * 0.9, o);
    }
  }

  // 水: しぶき・湯気
  _water(x, y, z, s, kind) { // kind: fx.splash の種類（MR.WaterFX の見た目。既定は墜落 'crash'、ミサイルの着水は 'missile'）
    if (this.fx && this.fx.splash) { const p = this._sp2 || (this._sp2 = { x: 0, y: 0, z: 0 }); p.x = x; p.y = y; p.z = z; this.fx.splash(p, s, kind || 'crash'); this.stats.splashes++; }
    const P = this._puffsObj();
    if (!P) return;
    const R = Math.random, o = this._o;
    for (let i = 0, n = 4 + (R() * 3 | 0); i < n; i++) {
      Crashes._opt(o, (R() - 0.5) * 2, 2 + R() * 2, (R() - 0.5) * 2, s * 0.5, 0.6, 0.6, 0.6, 0.92, 0.94, 0.96, R() * 6.28);
      P.spawn('smoke', x + (R() - 0.5) * s, y + 0.5, z + (R() - 0.5) * s, s * 1.1, 3.5 + R() * 1.5, o);
      this.stats.emitted.steam++;
    }
  }

  _ignite(x, y, z) {
    this.stats.ignites++;
    if (!this.audio || typeof this.audio.play !== 'function') return;
    const P = this._sp3 || (this._sp3 = { x: 0, y: 0, z: 0 });
    P.x = x; P.y = y; P.z = z;
    this.audio.play('fire_ignite', { pos: P, refDistance: 12, maxDistance: 300, priority: 2 });
  }

  _flash(x, y, z, s) {
    if (!this.light) return;
    this.light.position.set(x, y + 1.5, z);
    this.light.distance = Math.max(30, s * 14);
    this._flashPeak = Math.min(6, 1.2 + s * 0.6);
    this._flashT = this._flashDur;
    this.light.intensity = this._flashPeak;
    this.stats.flashes++;
  }

  // ---------- 記録 ----------
  _addRec(plan, x, y, z) {
    let rec = this._pool.pop();
    if (!rec) {
      // いっぱい: 残りが一番短いものを外す
      let k = 0, best = Infinity;
      for (let i = 0; i < this.records.length; i++) { const r = this.records[i]; const left = Math.max(r.sec, r.steam) + this.tail - r.t; if (left < best) { best = left; k = i; } }
      rec = this.records[k];
      this._release(rec, k);
      this._pool.pop();
      this.stats.evicted++;
    }
    rec.id = ++this._seq;
    rec.kind = plan.kind; rec.stage = plan.stage; rec.surface = plan.surface; rec.seed = plan.seed;
    rec.x = x; rec.y = y; rec.z = z; rec.bx = plan.x; rec.by = plan.y; rec.bz = plan.z;
    rec.t = 0; rec.sec = plan.fireSec || 0; rec.steam = plan.steam || 0;
    rec.sizeK = Crashes.KIND_K[plan.kind] || 0.7;
    rec.v = null; rec.awaitLand = plan.stage === 'air';
    rec.fireT = 0; rec.smokeT = Math.random() * 0.3; rec.colT = Math.random() * 0.3; rec.emberT = 0; rec.steamT = 0; rec.trailT = 0; rec.facT = 0; rec.facI = 0; rec.st0 = 0;
    rec.loop = null; rec.d = 0; rec.lod = ''; rec.out = false;
    rec.patches = plan.patches ? plan.patches.length : 0;
    rec.facade = plan.facade ? plan.facade.slice(0, 6) : null;
    rec.scorch = plan.scorch ? plan.scorch.slice(0, 4) : null;
    this.records.push(rec);
    this.stats.records = this.records.length;
    if (this.records.length > this.stats.recordsMax) this.stats.recordsMax = this.records.length;
    return rec;
  }

  _release(rec, i) {
    if (rec.loop) { rec.loop.stop(0.15); rec.loop = null; }
    if (this._steamRec === rec) { if (this._steamLoop) this._steamLoop.stop(0.3); this._steamLoop = null; this._steamRec = null; }
    this._detach(rec);
    rec.out = true;
    if (i == null) i = this.records.indexOf(rec);
    if (i >= 0) { const L = this.records; L[i] = L[L.length - 1]; L.length--; }
    this._pool.push(rec);
    this.stats.records = this.records.length;
  }

  _log(plan, rec) {
    const e = { stage: plan.stage, kind: plan.kind, surface: plan.surface, x: plan.x, y: plan.y, z: plan.z, patches: plan.patches ? plan.patches.length : 0,
      scorch: !!plan.scorch, facade: plan.facade ? plan.facade.slice(0, 6) : null, fireSec: plan.fireSec, steam: plan.steam, secondaries: plan.secondaries ? plan.secondaries.length : 0,
      blast: plan.blast ? plan.blast.r : 0, id: rec ? rec.id : 0, patchList: plan.patches ? plan.patches.map((q) => q.slice(0, 5)) : [] };
    this.log.push(e);
    if (this.log.length > 32) this.log.shift();
  }

  // ---------- 焦げ ----------
  addScorch(x, y, z, r) {
    const S = this._scorch;
    this._ensureScorch();
    let k = -1, old = -1, oldB = 0xffffffff;
    for (let i = 0; i < S.cap; i++) {
      if (!S.live[i]) { k = i; break; }
      if (S.born[i] < oldB) { oldB = S.born[i]; old = i; }
    }
    if (k < 0) k = old;
    if (!S.live[k]) { S.live[k] = 1; S.n++; }
    S.x[k] = x; S.y[k] = y; S.z[k] = z; S.r[k] = r; S.rot[k] = Math.random() * 6.283; S.t[k] = 0; S.born[k] = ++this._seq;
    this.stats.scorchAdded++;
    this.stats.scorch = S.n;
  }

  _ensureScorch() {
    const S = this._scorch;
    if (S.mesh) return;
    const g = new THREE.PlaneBufferGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const al = new THREE.InstancedBufferAttribute(new Float32Array(S.cap), 1);
    if (al.setUsage) al.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAlpha', al);
    S.tex = Crashes._softTex('scorch');
    S.texOwned = true;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uColor: { value: MR.srgb ? MR.srgb('#1c1712') : new THREE.Color(0.01, 0.008, 0.006) } }]);
    uniforms.map.value = S.tex;
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: Crashes.SCORCH_VERT, fragmentShader: Crashes.SCORCH_FRAG
    });
    const mesh = new THREE.InstancedMesh(g, mat, S.cap);
    if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 1; mesh.visible = false; mesh.name = 'crash_scorch';
    this.scene.add(mesh);
    S.mesh = mesh;
    this.stats.created += 2;
    // 画像（あれば）
    const a = this.assets;
    if (a && typeof a.resolve === 'function' && typeof a.loadTexture === 'function') {
      const key = a.resolve('textures/fx/scorch.png');
      if (key) {
        let p;
        try { p = Promise.resolve(a.loadTexture(key, { srgb: false, wrap: THREE.ClampToEdgeWrapping, maxSize: this.mobile ? 256 : 512 })); } catch (e) { p = Promise.reject(e); }
        p.then((t) => {
          if (!t || !S.mesh || this._disposed) return;
          if (S.texOwned && S.tex) S.tex.dispose();
          S.tex = t; S.texOwned = false; S.mesh.material.uniforms.map.value = t;
        }, () => {});
      }
    }
  }

  // ---------- 衝撃波の輪 ----------
  _addRing(x, y, z, s) {
    const G = this._ring;
    this._ensureRing();
    let k = -1, old = 0, oldT = -1;
    for (let i = 0; i < G.cap; i++) { if (!G.live[i]) { k = i; break; } if (G.t[i] > oldT) { oldT = G.t[i]; old = i; } }
    if (k < 0) k = old;
    if (!G.live[k]) { G.live[k] = 1; G.n++; }
    G.x[k] = x; G.y[k] = y + 0.5; G.z[k] = z; G.r[k] = s * 4; G.t[k] = 0; G.dur[k] = 0.35 + s * 0.04;
  }

  _ensureRing() {
    const G = this._ring;
    if (G.mesh) return;
    const g = new THREE.PlaneBufferGeometry(1, 1);
    const al = new THREE.InstancedBufferAttribute(new Float32Array(G.cap), 1);
    if (al.setUsage) al.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAlpha', al);
    G.tex = Crashes._softTex('ring');
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uColor: { value: MR.srgb ? MR.srgb('#ffd9a8') : new THREE.Color(1, 0.7, 0.4) } }]);
    uniforms.map.value = G.tex;
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: Crashes.RING_VERT, fragmentShader: Crashes.RING_FRAG
    });
    const mesh = new THREE.InstancedMesh(g, mat, G.cap);
    if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 4; mesh.visible = false; mesh.name = 'crash_rings';
    this.scene.add(mesh);
    G.mesh = mesh;
    this.stats.created += 2;
  }

  static _softTex(kind) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext && c.getContext('2d');
      if (x) {
        const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        if (kind === 'ring') {
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0)'); gr.addColorStop(0.82, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        } else {
          gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        }
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c);
        return t;
      }
    }
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }

  // ---------- 毎フレーム ----------
  update(dt, cam) {
    const t0 = Crashes.now();
    dt = dt > 0 ? dt : 0;
    if (cam) { this.listener.x = cam.x; this.listener.y = cam.y; this.listener.z = cam.z; }
    const cx = this.listener.x, cy = this.listener.y, cz = this.listener.z;
    const L = this.records;
    // 時間・残骸について行く・外す
    let nFire = 0, nSteam = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const r = L[i];
      r.t += dt;
      const v = r.v;
      if (v) {
        if (v.sunk && r.sec > 0 && r.t < r.sec && v._fireRec === r) {
          // 燃えていた残骸が沈んだ: 水の上で燃え続けない（湯気にして消す）
          const w = this.waterAt ? this.waterAt(r.x, r.z) : null;
          if (w != null && isFinite(w)) this.quench(r, r.x, w + 0.3, r.z); else this._detach(r);
        } else if (v.disposed || !v.wrecked || v.sunk || v._fireRec !== r || (v.root && !v.root.parent)) this._detach(r);
        else {
          const c = v.center ? v.center(this._vc || (this._vc = new THREE.Vector3())) : v.pos;
          r.x = c.x; r.y = c.y; r.z = c.z;
        }
      }
      if (r.t >= Math.max(r.sec + (r.sec > 0 ? this.tail : 0), r.steam)) { this._release(r, i); continue; }
      if (r.sec > 0 && r.t < r.sec) nFire++;
      if (r.steam > 0 && r.t < r.steam) nSteam++;
      const dx = r.x - cx, dy = r.y - cy, dz = r.z - cz;
      r.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.stats.fires = nFire; this.stats.steam = nSteam;
    // LOD: near は近い 3 つまで
    const n = L.length, idx = this._near;
    for (let i = 0; i < n; i++) {
      let j = i - 1;
      const d = L[i].d;
      while (j >= 0 && L[idx[j]].d > d) { idx[j + 1] = idx[j]; j--; }
      idx[j + 1] = i;
    }
    const lod = this.stats.lod;
    lod.near = 0; lod.mid = 0; lod.far = 0; lod.off = 0;
    const P = n ? this._puffsObj() : null;
    // 柱の板の数を全体で smoke の caps の半分に収める（遠くから見える煙）
    const capS = P && P.atlases && P.atlases.smoke ? P.atlases.smoke.cap : 96;
    const colLife = this.colLife;
    const colEvery = this.column.every * Math.max(1, (n * colLife / this.column.every) / (capS * 0.5));
    for (let k = 0; k < n; k++) {
      const r = L[idx[k]];
      let lv;
      if (r.d < this.lod.near && lod.near < this.nearMax) lv = 'near';
      else if (r.d < this.lod.mid) lv = 'mid';
      else if (r.d < this.lod.far) lv = 'far';
      else lv = 'off';
      r.lod = lv;
      lod[lv]++;
      if (P && lv !== 'off') this._emit(P, r, dt, lv, colEvery);
    }
    // 地面の火: 時間（tick 秒ごとのダメージはソロだけ = fireTargets）と板
    const F = this.field;
    if (F) {
      const nh = F.tick(dt, this.fireTargets, this._hits);
      if (nh > 0) { this.stats.patchHits += nh; if (this.onFireHit) this.onFireHit(this._hits, nh); }
      this.stats.patches = F.count;
      const pl = this.stats.patchLod;
      pl.near = 0; pl.mid = 0;
      if (F.count) { const P2 = this._puffsObj(); if (P2) this._emitPatches(P2, dt, cx, cy, cz); }
    }
    // 誘爆
    this._updateSecondaries(dt);
    // 音（4 回/秒選び直す）
    this._loopT -= dt;
    if (this._loopT <= 0) { this._loopT = 0.25; this._pickLoops(); }
    // 光
    if (this.light && this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - dt);
      const u = this._flashT / this._flashDur;
      this.light.intensity = this._flashPeak * u * u;
    }
    this._updateRings(dt, cx, cy, cz);
    this._updateScorch(dt);
    const ms = Crashes.now() - t0;
    this.stats.updMs = ms;
    if (ms > this.stats.updMsMax) this.stats.updMsMax = ms;
  }

  _emit(P, r, dt, lv, colEvery) {
    const R = Math.random, o = this._o, k = r.sizeK, E = this.stats.emitted;
    const fireK = r.sec > 0 ? (r.t < 0.8 ? r.t / 0.8 : (r.t < r.sec * 0.6 ? 1 : Math.max(0, (r.sec - r.t) / (r.sec * 0.4)))) : 0;
    const smokeK = r.sec > 0 ? (r.t < r.sec ? 1 : Math.max(0, 1 - (r.t - r.sec) / this.tail)) : 0;
    const falling = !!(r.v && r.awaitLand);
    // 湯気（水）
    if (r.steam > 0 && r.t < r.steam && lv !== 'far') {
      r.steamT -= dt;
      if (r.steamT <= 0) {
        r.steamT = lv === 'near' ? 0.15 : 0.35;
        const a = 1 - (r.t - r.st0) / Math.max(0.1, r.steam - r.st0);
        Crashes._opt(o, (R() - 0.5) * 1.5, 2 + R() * 2, (R() - 0.5) * 1.5, 1.2 * k + 0.5, 0.5, 0.5, 0.5 * a + 0.1, 0.92, 0.94, 0.96, R() * 6.28);
        o.fadeIn = 0.3;
        P.spawn('smoke', r.x + (R() - 0.5) * 4 * k, r.y + 0.3, r.z + (R() - 0.5) * 4 * k, (2 + R() * 2) * k, 3 + R(), o);
        E.steam++;
      }
    }
    if (!(r.sec > 0) || smokeK <= 0) return;
    // 落ちている残骸の燃える尾（D5 の air）
    if (falling) {
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = lv === 'far' ? 0.25 : 0.06;
        if (lv !== 'far') {
          Crashes._opt(o, (R() - 0.5), 1 + R(), (R() - 0.5), 1.2 * k, 0.5, 0.4, 0.9, 1, 1, 1, R() * 6.28);
          P.spawn('fire', r.x + (R() - 0.5) * 1.5 * k, r.y + R() * k, r.z + (R() - 0.5) * 1.5 * k, (2 + R() * 1.5) * k, 0.6 + R() * 0.3, o);
        }
        Crashes._opt(o, (R() - 0.5), 1 + R(), (R() - 0.5), 2 * k, 0.3, 0.3, 0.7, 0.1, 0.095, 0.09, R() * 6.28);
        o.fadeIn = 0.15;
        if (lv === 'far') o.fog = this.column.fog;
        P.spawn('smoke', r.x, r.y + 0.5, r.z, (3 + R() * 2) * k, 4 + R() * 2, o);
        E.trail++;
      }
      return;
    }
    if (lv === 'near' || lv === 'mid') {
      const near = lv === 'near';
      // 炎
      if (fireK > 0.02) {
        r.fireT -= dt;
        if (r.fireT <= 0) {
          r.fireT = near ? 0.08 : 0.2;
          const sz = (1.8 + R() * 1.4) * k * (0.5 + 0.5 * fireK) * (near ? 1 : 1.5);
          Crashes._opt(o, (R() - 0.5) * 0.6, 1.5 + R() * 1.5, (R() - 0.5) * 0.6, 0.6 * k, 1.5, 0.3, Math.min(1, 0.4 + fireK), 1, 1, 1, R() * 6.28);
          P.spawn('fire', r.x + (R() - 0.5) * 3 * k, r.y - 0.3 + R() * 0.8, r.z + (R() - 0.5) * 3 * k, sz, 0.9 + R() * 0.4, o);
          E.fire++;
        }
        if (near) {
          r.emberT -= dt;
          if (r.emberT <= 0) {
            r.emberT = 0.15;
            Crashes._opt(o, (R() - 0.5) * 3, 3 + R() * 3, (R() - 0.5) * 3, -0.05, -2, 0.4, fireK, 1.4, 0.9, 0.5, 0);
            P.spawn('ember', r.x + (R() - 0.5) * 2 * k, r.y + 0.5, r.z + (R() - 0.5) * 2 * k, 0.2 + R() * 0.2, 1.5 + R(), o);
            E.ember++;
          }
        }
      }
      // 煙（低い所）
      r.smokeT -= dt;
      if (r.smokeT <= 0) {
        r.smokeT = near ? 0.3 : 0.5;
        Crashes._opt(o, (R() - 0.5) * 0.8, 2.2 + R() * 1.2, (R() - 0.5) * 0.8, 1.2 * k, 0.3, 0.3, 0.6 * smokeK, 0.12, 0.115, 0.11, R() * 6.28);
        o.fadeIn = 0.5;
        P.spawn('smoke', r.x + (R() - 0.5) * 2 * k, r.y + 1.5, r.z + (R() - 0.5) * 2 * k, 3 * k + 1, 6 + R() * 2, o);
        E.smoke++;
      }
      // 壁の火（facade: 当たった面の上に flames 個の炎の場所。順に 1 つずつ出す）
      const fa = r.facade;
      if (fa && r.t < fa[5]) this._emitFacade(P, r, fa, dt, near);
    }
    // 煙の柱（どの LOD でも。霧を薄く）
    r.colT -= dt;
    if (r.colT <= 0) {
      r.colT = colEvery * (0.8 + R() * 0.4);
      const C = this.column, life = this.colLife * (0.85 + R() * 0.3);
      // 遠い（far）ほど板を大きく（mid の距離で 1 倍 → farScale 倍まで）: 1 km 先でも数十 px の柱に見える（同じ大きさだと 10 px 前後で読めなかった）
      const fk = lv === 'far' ? Math.min(C.farScale, Math.max(1, r.d / this.lod.mid)) : 1;
      const s0 = C.s0 * (0.6 + 0.4 * k) * fk;
      Crashes._opt(o, (R() - 0.5) * 1.5 + 1.2, C.height / life, (R() - 0.5) * 1.5 + 0.6, (C.s1 - C.s0) * (0.6 + 0.4 * k) * fk / life, 0, 0, (lv === 'far' ? 0.7 : 0.55) * smokeK, 0.09, 0.085, 0.08, R() * 6.28);
      o.fadeIn = 1.5; o.fadeOut = life * 0.45; o.fog = C.fog;
      P.spawn('smoke', r.x + (R() - 0.5) * 3, r.y + 3 + R() * 3, r.z + (R() - 0.5) * 3, s0, life, o);
      E.column++;
    }
  }

  // 壁の火の板（near / mid）。fa = [x, y, z, nx, nz, t1]
  _emitFacade(P, r, fa, dt, near) {
    const X = this.facadeFx, R = Math.random, o = this._o, E = this.stats.emitted;
    r.facT -= dt;
    if (r.facT > 0) return;
    r.facT = (near ? X.near : X.mid) * (0.8 + R() * 0.4);
    const nf = Math.max(1, ((this.cfg.facade && this.cfg.facade.flames) || 4) | 0);
    const i = r.facI = (r.facI + 1) % nf;
    const nx = fa[3], nz = fa[4], tx = -nz, tz = nx;
    const off = (i - (nf - 1) / 2) * X.spacing + (R() - 0.5) * X.spacing * 0.6;
    const t1 = fa[5], fk = r.t < 1 ? Math.max(0.2, r.t) : (r.t < t1 * 0.7 ? 1 : Math.max(0, (t1 - r.t) / (t1 * 0.3)));
    if (fk <= 0.02) return;
    const px = fa[0] + nx * X.out + tx * off, py = fa[1] + (R() - 0.5) * 2 * X.spread, pz = fa[2] + nz * X.out + tz * off;
    const sz = (X.size[0] + R() * (X.size[1] - X.size[0])) * (0.5 + 0.5 * fk) * (near ? 1 : 1.4);
    Crashes._opt(o, nx * 0.8 + (R() - 0.5) * 0.4, 2.2 + R() * 1.4, nz * 0.8 + (R() - 0.5) * 0.4, 0.5, 1.2, 0.3, Math.min(1, 0.45 + fk), 1, 1, 1, R() * 6.28);
    P.spawn('fire', px, py, pz, sz, 1.0 + R() * 0.4, o);
    E.facade++;
    if (i === 0) { // 黒い煙が壁に沿って上る
      Crashes._opt(o, nx * 1.2, 3 + R() * 1.5, nz * 1.2, 1.4, 0.4, 0.3, 0.6 * fk, 0.1, 0.095, 0.09, R() * 6.28);
      o.fadeIn = 0.5;
      P.spawn('smoke', px + nx * 1.5, py + 2.5, pz + nz * 1.5, sz * 1.1, 6 + R() * 2, o);
      E.smoke++;
    }
  }

  // 地面の火の板: 輪の中に炎（near / mid）、近いと火の粉と低い煙。合計の炎の板は fire の caps × patchFx.share に収める（多いと間隔を延ばす）
  _emitPatches(P, dt, cx, cy, cz) {
    const F = this.field, L = F.list, X = this.patchFx, pl = this.stats.patchLod, E = this.stats.emitted;
    const near = this.lod.near, mid = this.lod.mid;
    let rate = 0;
    for (let i = 0; i < L.length; i++) {
      const r = L[i], rad = F.radius(r);
      if (!(rad > 0)) { r.lv = 0; continue; }
      const dx = r.x - cx, dy = r.y - cy, dz = r.z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      r.lv = d < near ? 1 : (d < mid ? 2 : 0);
      if (r.lv === 1) { pl.near++; rate += X.near.rate + X.near.rateK * rad; } else if (r.lv === 2) { pl.mid++; rate += X.mid.rate + X.mid.rateK * rad; }
    }
    if (rate <= 0) return;
    const capF = P.atlases && P.atlases.fire ? P.atlases.fire.cap : 96;
    const lifeAvg = (X.life[0] + X.life[1]) * 0.5;
    const kr = Math.min(1, capF * X.share / (rate * lifeAvg));
    const R = Math.random, o = this._o;
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      if (!r.lv) continue;
      const rad = F.radius(r), nearL = r.lv === 1, u = Math.min(1, rad / Math.max(0.1, r.r1));
      const rr = (nearL ? X.near.rate + X.near.rateK * rad : X.mid.rate + X.mid.rateK * rad) * kr;
      r.ft -= dt;
      for (let g = 0; g < 3 && r.ft <= 0; g++) {
        r.ft += (0.7 + R() * 0.6) / Math.max(0.05, rr);
        const a = R() * 6.283, q = Math.sqrt(R()) * rad * 0.85;
        const sz = (X.size[0] + R() * (X.size[1] - X.size[0])) * (0.55 + 0.45 * u) * (nearL ? 1 : 1.5);
        Crashes._opt(o, (R() - 0.5) * 0.5, X.rise[0] + R() * (X.rise[1] - X.rise[0]), (R() - 0.5) * 0.5, 0.4, 1.2, 0.3, Math.min(1, 0.4 + 0.6 * u), 1, 1, 1, R() * 6.28);
        P.spawn('fire', r.x + Math.cos(a) * q, r.y + 0.15 + sz * 0.25, r.z + Math.sin(a) * q, sz, X.life[0] + R() * (X.life[1] - X.life[0]), o);
        E.patch++;
      }
      if (r.ft < -1) r.ft = 0;
      if (!nearL) continue;
      if (X.near.ember > 0) {
        r.et -= dt;
        if (r.et <= 0) {
          r.et = (0.7 + R() * 0.6) / X.near.ember;
          Crashes._opt(o, (R() - 0.5) * 2, 2.5 + R() * 2.5, (R() - 0.5) * 2, -0.05, -2, 0.4, u, 1.4, 0.9, 0.5, 0);
          P.spawn('ember', r.x + (R() - 0.5) * rad, r.y + 0.4, r.z + (R() - 0.5) * rad, 0.18 + R() * 0.2, 1.3 + R(), o);
          E.ember++;
        }
      }
      if (X.near.smoke > 0) {
        r.st -= dt;
        if (r.st <= 0) {
          r.st = (0.7 + R() * 0.6) / X.near.smoke;
          Crashes._opt(o, (R() - 0.5) * 0.6, 1.8 + R(), (R() - 0.5) * 0.6, 0.9, 0.3, 0.3, 0.45 * u, 0.12, 0.115, 0.11, R() * 6.28);
          o.fadeIn = 0.5;
          P.spawn('smoke', r.x + (R() - 0.5) * rad, r.y + 1.2, r.z + (R() - 0.5) * rad, 2 + rad * 0.4, 5 + R() * 2, o);
          E.smoke++;
        }
      }
    }
  }

  _pickLoops() {
    const A = this.audio, L = this.records;
    const can = A && typeof A.loop === 'function';
    const cap = Math.max(0, this.caps.loops | 0);
    const sel = this._sel || (this._sel = []);
    sel.length = 0;
    // 火のある記録を近い順に cap 個（250 m まで）
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      if (!(r.sec > 0) || r.t >= r.sec || r.d > this.loopRange) continue;
      let j = sel.length;
      sel.push(r);
      while (j > 0 && sel[j - 1].d > r.d) { sel[j] = sel[j - 1]; j--; }
      sel[j] = r;
      if (sel.length > cap) sel.length = cap;
    }
    let live = 0;
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      const want = sel.indexOf(r) >= 0;
      const fk = r.sec > 0 ? (r.t < 0.8 ? Math.max(0.05, r.t / 0.8) : (r.t < r.sec * 0.6 ? 1 : Math.max(0.05, (r.sec - r.t) / (r.sec * 0.4)))) : 0.05;
      if (r.loop && !want) { r.loop.stop(0.15); r.loop = null; }
      else if (!r.loop && want && can) {
        const p = this._lp || (this._lp = { x: 0, y: 0, z: 0 });
        p.x = r.x; p.y = r.y; p.z = r.z;
        // 始めの音量 = 今の火の大きさ（ループ自体の fadeIn で 0 から上がる。その後の変化は setVolume の _glide）
        r.loop = A.loop('fire_loop', { pos: p, bus: 'sfx', offset: Math.random() * 4, rate: 0.9 + Math.random() * 0.2, refDistance: 10, maxDistance: this.loopRange, volume: fk });
        this.stats.loopStarts++;
      } else if (r.loop && r.loop.setVolume) r.loop.setVolume(fk);
      if (r.loop) {
        live++;
        if (r.v && r.loop.setPosition) { const p = this._lp2 || (this._lp2 = { x: 0, y: 0, z: 0 }); p.x = r.x; p.y = r.y; p.z = r.z; r.loop.setPosition(p); }
      }
    }
    this.stats.loops = live;
    if (live > this.stats.loopsMax) this.stats.loopsMax = live;
    // 湯気の音（1 つ: 一番近い水の記録）
    let sr = null;
    for (let i = 0; i < L.length; i++) { const r = L[i]; if (r.steam > 0 && r.t < r.steam && r.d < this.steamRange && (!sr || r.d < sr.d)) sr = r; }
    if (sr !== this._steamRec) {
      if (this._steamLoop) { this._steamLoop.stop(0.3); this._steamLoop = null; }
      this._steamRec = sr;
      if (sr && can) {
        const p = this._lp3 || (this._lp3 = { x: 0, y: 0, z: 0 });
        p.x = sr.x; p.y = sr.y; p.z = sr.z;
        this._steamLoop = A.loop('steam_hiss', { pos: p, bus: 'sfx', refDistance: 10, maxDistance: this.steamRange, offset: Math.random() * 2 });
        this.stats.steamLoops++;
      }
    }
  }

  _updateRings(dt, cx, cy, cz) {
    const G = this._ring;
    if (!G.mesh) return;
    let n = 0;
    const m = G.mesh.instanceMatrix.array, al = G.mesh.geometry.attributes.aAlpha.array;
    for (let i = 0; i < G.cap; i++) {
      if (!G.live[i]) continue;
      G.t[i] += dt;
      const u = G.t[i] / G.dur[i];
      if (u >= 1) { G.live[i] = 0; G.n--; continue; }
      const s = G.r[i] * (0.15 + 0.85 * Math.sqrt(u)) * 2, b = n * 16;
      m[b] = s; m[b + 1] = 0; m[b + 2] = 0; m[b + 3] = 0;
      m[b + 4] = 0; m[b + 5] = s; m[b + 6] = 0; m[b + 7] = 0;
      m[b + 8] = 0; m[b + 9] = 0; m[b + 10] = s; m[b + 11] = 0;
      m[b + 12] = G.x[i]; m[b + 13] = G.y[i]; m[b + 14] = G.z[i]; m[b + 15] = 1;
      al[n] = 0.9 * (1 - u) * (1 - u);
      n++;
    }
    this.stats.rings = n;
    G.mesh.count = n;
    G.mesh.visible = n > 0;
    if (n) { G.mesh.instanceMatrix.needsUpdate = true; G.mesh.geometry.attributes.aAlpha.needsUpdate = true; }
  }

  _updateScorch(dt) {
    const S = this._scorch;
    if (!S.mesh) return;
    const sec = (this.cfg.scorch && this.cfg.scorch.sec) || 120;
    let n = 0;
    const m = S.mesh.instanceMatrix.array, al = S.mesh.geometry.attributes.aAlpha.array;
    for (let i = 0; i < S.cap; i++) {
      if (!S.live[i]) continue;
      S.t[i] += dt;
      if (S.t[i] >= sec) { S.live[i] = 0; S.n--; continue; }
      const u = S.t[i] / sec, s = S.r[i] * 2, c = Math.cos(S.rot[i]) * s, sn = Math.sin(S.rot[i]) * s, b = n * 16;
      m[b] = c; m[b + 1] = 0; m[b + 2] = -sn; m[b + 3] = 0;
      m[b + 4] = 0; m[b + 5] = 1; m[b + 6] = 0; m[b + 7] = 0;
      m[b + 8] = sn; m[b + 9] = 0; m[b + 10] = c; m[b + 11] = 0;
      m[b + 12] = S.x[i]; m[b + 13] = S.y[i] + 0.04; m[b + 14] = S.z[i]; m[b + 15] = 1;
      al[n] = 0.85 * (u < 0.7 ? 1 : (1 - u) / 0.3);
      n++;
    }
    this.stats.scorch = S.n;
    S.mesh.count = n;
    S.mesh.visible = n > 0;
    if (n) { S.mesh.instanceMatrix.needsUpdate = true; S.mesh.geometry.attributes.aAlpha.needsUpdate = true; }
  }

  // 描いているメッシュ（輪・焦げ。板は MR.Puffs）
  drawCalls() {
    let n = 0;
    if (this._ring.mesh && this._ring.mesh.visible) n++;
    if (this._scorch.mesh && this._scorch.mesh.visible) n++;
    return n;
  }
  meshes(out) {
    out = out || [];
    if (this._ring.mesh) out.push(this._ring.mesh);
    if (this._scorch.mesh) out.push(this._scorch.mesh);
    return out;
  }

  clear() {
    for (let i = this.records.length - 1; i >= 0; i--) this._release(this.records[i], i);
    if (this.field) this.field.clear();
    this.stats.patches = 0;
    const Q = this._secQ;
    Q.live.fill(0); Q.n = 0; this.stats.secPending = 0;
    if (this._steamLoop) { this._steamLoop.stop(0.2); this._steamLoop = null; this._steamRec = null; }
    const G = this._ring, S = this._scorch;
    G.live.fill(0); G.n = 0; S.live.fill(0); S.n = 0;
    if (G.mesh) { G.mesh.count = 0; G.mesh.visible = false; }
    if (S.mesh) { S.mesh.count = 0; S.mesh.visible = false; }
    this._flashT = 0;
    if (this.light) this.light.intensity = 0;
    this.stats.records = 0; this.stats.fires = 0; this.stats.steam = 0; this.stats.loops = 0; this.stats.rings = 0; this.stats.scorch = 0;
  }

  dispose() {
    this.clear();
    this._disposed = true;
    for (const G of [this._ring, this._scorch]) {
      if (!G.mesh) continue;
      if (G.mesh.parent) G.mesh.parent.remove(G.mesh);
      G.mesh.geometry.dispose(); G.mesh.material.dispose();
      if (G.mesh.dispose) G.mesh.dispose();
      if (G.tex && (G.texOwned !== false)) G.tex.dispose();
      G.tex = null; G.mesh = null;
      this.stats.disposed += 2;
    }
    if (this.light) { if (this.light.parent) this.light.parent.remove(this.light); this.light = null; }
  }

  static _opt(o, vx, vy, vz, grow, rise, drag, alpha, r, g, b, rot) {
    o.vx = vx; o.vy = vy; o.vz = vz; o.grow = grow; o.rise = rise; o.drag = drag; o.alpha = alpha;
    o.r = r; o.g = g; o.b = b; o.rot = rot; o.spin = (Math.random() - 0.5) * 0.6;
    o.frame0 = 0; o.fps = 0; o.loop = false; o.fadeIn = 0.06; o.fadeOut = null; o.fog = 1;
    return o;
  }

  static now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
};
MR.Crashes.CAPS = { fires: 8, patches: 24, debris: 48, scorch: 16, loops: 3 };
MR.Crashes.SIZE = { jet: 6, heli: 4.5, car: 3.5, missile: 3.5 };
MR.Crashes.KIND_K = { jet: 1, heli: 0.8, car: 0.55, missile: 0.4 };
MR.Crashes.RINGS = 8;
MR.Crashes.SEC_CAP = 24;   // 誘爆の待ち行列（同時に待てる数）
MR.Crashes.TAIL = 10;      // 火が消えた後に煙だけ残る秒（既定。fire.tail）
MR.Crashes.COL_LIFE = 16;  // 柱の板の寿命（秒。既定。fire.column.life）
MR.Crashes.LOOP_RANGE = 250;   // 既定（fire.loopRange）
MR.Crashes.STEAM_RANGE = 200;  // 既定（fire.steamRange）
MR.Crashes.NEAR_MAX = 3;       // 既定（fire.lod.nearMax）
MR.Crashes._patchFx = function (c) {
  c = c || {};
  const n = c.near || {}, m = c.mid || {};
  const pr = (a, d0, d1) => (Array.isArray(a) && a.length >= 2 ? [+a[0], +a[1]] : [d0, d1]);
  return { near: { rate: n.rate != null ? n.rate : 4, rateK: n.rateK != null ? n.rateK : 1.6, ember: n.ember != null ? n.ember : 1.5, smoke: n.smoke != null ? n.smoke : 0.4 },
    mid: { rate: m.rate != null ? m.rate : 1.2, rateK: m.rateK != null ? m.rateK : 0.5 }, life: pr(c.life, 0.7, 1.1), size: pr(c.size, 1.3, 2.3), rise: pr(c.rise, 1.4, 2.2),
    share: c.share > 0 ? c.share : 0.5 };
};
MR.Crashes.RING_VERT = [
  'attribute float aAlpha;', 'varying vec2 vUv;', 'varying float vA;',
  '#include <fog_pars_vertex>',
  'void main() {',
  '  vec3 c = vec3(instanceMatrix[3]);',
  '  float s = length(vec3(instanceMatrix[0]));',
  '  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);',
  '  mvPosition.xy += position.xy * s;',
  '  vUv = uv; vA = aAlpha;',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '}'
].join('\n');
MR.Crashes.RING_FRAG = [
  'uniform sampler2D map;', 'uniform vec3 uColor;', 'varying vec2 vUv;', 'varying float vA;',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  float a = texture2D(map, vUv).a * vA;',
  '  if (a <= 0.003) discard;',
  '  gl_FragColor = vec4(uColor, a);',
  '  #ifdef USE_FOG',
  '  #ifdef FOG_EXP2',
  '  float fogFactor = 1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth);',
  '  #else',
  '  float fogFactor = smoothstep(fogNear, fogFar, fogDepth);',
  '  #endif',
  '  gl_FragColor.a *= 1.0 - fogFactor;',
  '  #endif',
  '}'
].join('\n');
MR.Crashes.SCORCH_VERT = [
  'attribute float aAlpha;', 'varying vec2 vUv;', 'varying float vA;',
  '#include <fog_pars_vertex>',
  'void main() {',
  '  vUv = uv; vA = aAlpha;',
  '  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '}'
].join('\n');
MR.Crashes.SCORCH_FRAG = [
  'uniform sampler2D map;', 'uniform vec3 uColor;', 'varying vec2 vUv;', 'varying float vA;',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  vec4 t = texture2D(map, vUv);',
  '  float a = t.a * vA;',
  '  if (a <= 0.003) discard;',
  '  gl_FragColor = vec4(uColor * (0.6 + 0.4 * pow(t.rgb, vec3(2.2))), a);',
  '  #include <fog_fragment>',
  '}'
].join('\n');
