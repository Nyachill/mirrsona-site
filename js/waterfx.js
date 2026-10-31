// 水のしぶき（MR.WaterFX。街だけ。knife-destruction-spray-hq3d 計画 §3 / §7.1 SPRAY）。オーナー「ヘリで水飛沫上がったりとか」。
//   - 粒（drops）: 1 回の描画。速度の向きに伸ばした四角（InstancedBufferGeometry）。位置は GPU が時間から出す
//     （p0 + v t − g t² / 2）ので CPU は出したときに 1 回書くだけ。粒ごとに自分の水面の高さ（川 −2・湖 −0.8）を持ち、そこより下で消える。
//     輪のバッファ（maxDrops）で、出した所だけ updateRange で上げる。先頭が回った（wrap）フレームは属性ごと全部上げる
//     （r128 の updateRange は 1 つの区間しか書けない）。
//   - 霧（mist）: 1 回の描画。カメラに向けた板（同じ仕組み、抵抗つきで広がる）。カメラから nearFade m より近いと消える。
//     画面を覆う割合（板ごとの画面の面積の割合 × その不透明度の和）が coverageMax（2.5 枚分）を超えたら、大きい物から薄くする
//     （半精度の HDR のターゲットは 1 層 8 B/px なので、輪の中にカメラがあるときに重ねすぎない）。
//   - 水面（0 回の描画）: water.js の WaterFX の段（uniform で開け閉め。#define ではないのでシェーダーを作り直さない）: 吹き下ろしの暗い円・外へ
//     流れるさざ波・輪の白い泡・進むときの後ろのくぼみ。
//   - 時計は自分の秒（uTime）。何も生きていないときだけ 0 に戻す（float の精度）。
//   - 最初の描画で WebKit はパイプラインを作る（renderer.compile の後でも）ので、街の始めとヘリに乗ったときに 1 フレームだけ本当に描く（warm）。
// 数値は game.json の waterFx（タッチ端末は waterFx.mobile、省メモリは上限が半分）。?spray=0 で使わない（今までのスプライト）。
// 出す口: update(dt, camera, vehicles) がヘリ（kind 'heli'）を毎フレーム見る（heli.js は水の上のスプライトを出さない）。
// THREE 以外の依存なし。MR.WaterFX.washParams は THREE なしで呼べる（smoke 28 が使う）。
window.MR = window.MR || {};

(function () {
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  const DEFAULTS = {
    enabled: true, maxDrops: 1024, maxMist: 128, maxPulses: 3, coverageMax: 2.5, nearFade: 4, maxDist: 320,
    rotorRadius: 5.35, maxAgl: 30, ringGrow: 1.2, horseFrom: 12, horseTo: 28, rotorFrom: 0.4, rotorFull: 0.95,
    dropRate: 1100, dropLife: [0.55, 1.1], dropSpeed: [5, 14], dropUp: [1.2, 5.5], dropSize: [0.035, 0.09], dropStretch: 0.035,
    mistRate: 46, mistLife: [1.8, 3.2], mistSpeed: [3, 7.5], mistUp: [0.3, 1.1], mistSize0: [1.0, 1.8], mistSize1: [4.5, 8.5],
    mistDrag: 0.9, mistBuoy: 0.25, mistAlpha: 0.32, mistMinAlpha: 0.02, gravity: 9.8,
    horseCut: 1.6, ringBand: [0.82, 1.14], mistBand: [0.75, 1.15], inherit: [0.25, 0.3], mistLift: [0.3, 1.1],
    surface: true, darkness: 0.5, ripple: 0.38, foam: 0.7,
    sound: 'water_lap', soundVolume: 0.9, soundRef: 9, soundMax: 140,
    bulletMaxPerSec: 20,
    // 着水のしぶき（fx.splash の kind ごと）: drops = 粒の数（size = ref のとき）、up / out = 上・外への m/s、mist = 霧の数、pulse = 水面の輪の大きさ（0 = 無し）
    kinds: {
      bullet: { ref: 0.5, drops: 8, up: [2, 4.5], out: [0.3, 1.2], size: [0.02, 0.05], life: [0.4, 0.8], mist: 0, pulse: 0, lens: 0 },
      swim: { ref: 0.35, drops: 5, up: [0.6, 1.6], out: [0.3, 1.0], size: [0.02, 0.045], life: [0.3, 0.6], mist: 0, pulse: 0, lens: 0 },
      bubble: { ref: 0.8, drops: 3, up: [0.3, 0.9], out: [0.1, 0.4], size: [0.02, 0.04], life: [0.25, 0.5], mist: 0, pulse: 0, lens: 0 },
      wake: { ref: 1.6, drops: 14, up: [1.5, 3.5], out: [1, 3], size: [0.03, 0.07], life: [0.5, 0.9], mist: 0, pulse: 0, lens: 0.15 },
      body: { ref: 1, drops: 28, up: [2, 5], out: [0.8, 2.5], size: [0.03, 0.07], life: [0.5, 1.0], mist: 1, pulse: 0.6, mistUp: [0.5, 1.5], mistSize: [0.4, 1.6], lens: 0.25 },
      vehicle: { ref: 2.5, drops: 50, up: [3, 7], out: [1.5, 4], size: [0.05, 0.12], life: [0.7, 1.3], mist: 3, pulse: 1, mistUp: [1, 3], mistSize: [1, 3.5], lens: 0.45 },
      missile: { ref: 3, drops: 110, up: [8, 16], out: [0.8, 3.5], size: [0.09, 0.2], life: [1.2, 2.2], mist: 6, pulse: 1.6, mistUp: [4, 10], mistSize: [1.4, 5], lens: 0.9 },
      crash: { ref: 3.5, drops: 120, up: [6, 13], out: [2, 6], size: [0.09, 0.22], life: [1.0, 2.0], mist: 8, pulse: 2, mistUp: [3, 8], mistSize: [1.6, 6], lens: 1.0 }
    },
    maxSplashDrops: 120, pulseSpeed: 6, pulseLife: 2.6,
    // 戦闘機の低空の水しぶき（rooster tail）: trailAgl m より低く trailFrom m/s より速いとき
    trailAgl: 22, trailFrom: 70, trailFull: 120, trailRate: 900, trailMistRate: 40, trailBehind: [6, 26], trailUp: [4, 12], trailSide: [1.5, 6], trailSize: [0.12, 0.3], trailMistSize: [2.5, 10], trailLife: [0.6, 1.3], trailMistLife: [1.6, 2.8], trailInherit: [0.12, 0.08], trailJitter: 2,
    lens: true, lensRate: 1.4, lensDecay: 0.3, lensCells: 7, lensRange: 7, lensWashHeight: [4, 14], lensEye: 1.5, lensUnder: 0.1, lensNear: 2, lensSelf: 8,
    splashMaxDist: 700, splashSkMax: 1.6, splashR0: 0.15, splashMistLife: [1.6, 3.0]
  };

  class WaterFX {
    // opts: { cfg（game.json の waterFx）, mobile, saver, city（MR.CityGen）, water（MR.Water）, audio }
    constructor(scene, opts) {
      opts = opts || {};
      const base = Object.assign({}, DEFAULTS, opts.cfg || {});
      // kind ごとの表はキーごとに既定と重ねる（ダウンロードした game.json に新しいキー（lens など）が無くても既定が残る）
      base.kinds = {};
      for (const k of Object.keys(Object.assign({}, DEFAULTS.kinds, (opts.cfg || {}).kinds || {}))) base.kinds[k] = Object.assign({}, DEFAULTS.kinds[k] || {}, ((opts.cfg || {}).kinds || {})[k] || {});
      if (opts.mobile && base.mobile) Object.assign(base, base.mobile);
      if (opts.saver) { base.maxDrops = Math.round(base.maxDrops / 2); base.maxMist = Math.round(base.maxMist / 2); base.lens = false; }
      this.cfg = base;
      this.scene = scene;
      this.city = opts.city || null;
      this.water = opts.water || null;
      this.audio = opts.audio || null;
      this.on = true;
      this.time = 0;
      this.disposed = false;
      const c = this.cfg;
      this.nDrop = Math.max(16, Math.round(c.maxDrops));
      this.nMist = Math.max(4, Math.round(c.maxMist));
      // 出す量は上限に合わせて減らす（いちばん強いときに 上限 ÷（量 × いちばん長い寿命）: 生きている粒を奪わない）
      this.rateK = Math.min(1, this.nDrop / (c.dropRate * c.dropLife[1] * 1.05));
      this.mistK = Math.min(1, this.nMist / (c.mistRate * c.mistLife[1] * 1.05));
      this.drops = this._pool(this.nDrop, WaterFX.DROP_VERT, WaterFX.DROP_FRAG, 'waterfx_drops', [[-1, 0], [1, 0], [1, 1], [-1, 1]]);
      this.mist = this._pool(this.nMist, WaterFX.MIST_VERT, WaterFX.MIST_FRAG, 'waterfx_mist', [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
      const U = this.drops.mat.uniforms;
      U.uColor.value = MR.srgb('#dfe9ee');
      const M = this.mist.mat.uniforms;
      M.uColor.value = MR.srgb('#d6e1e6');
      M.uMap.value = WaterFX.blotch();
      M.uAlpha.value = c.mistAlpha;
      M.uNear.value = c.nearFade;
      M.uMinA.value = c.mistMinAlpha;
      M.uDrag.value = c.mistDrag;
      M.uBuoy.value = c.mistBuoy;
      U.uStretch.value = c.dropStretch;
      U.uGrav.value = c.gravity;
      this._mistDeath = new Float32Array(this.nMist);
      this._mistCov = new Float32Array(this.nMist);
      this._order = [];
      this._acc = { drop: 0, mist: 0, trail: 0, trailMist: 0 };
      this._surf = null; // 水面に描く 1 つ（{ x, z, R, ring, k, dx, dz, horse }）
      this._snd = null; this._sndT = 0; this._sndK = 0;
      this._warm = 0;
      this._bulletT = 0; this._bulletN = 0;
      this.nPulse = Math.max(0, Math.min(3, Math.round(c.maxPulses)));
      this._pulse = 0;
      this.lens = 0; // レンズの水滴の量 0..1（game.js が gradePass の uLens に入れる）
      this.self = null; // 自分の乗り物（game.js が入れる。そのしぶきはレンズに付けない）
      this.stats = { lensMax: 0, splashFar: 0, lastKind: null, splashes: 0, bulletDropped: 0, trail: 0, pulses: 0, drops: 0, mist: 0, emitted: 0, mistEmitted: 0, coverage: 0, coverageRaw: 0, governed: 0, wraps: 0, rebases: 0, uploads: 0, owners: 0, updateMs: 0, updateMsMax: 0, warmDraws: 0, strength: 0 };
      this._tmpV = new THREE.Vector3();
      this._fwd = new THREE.Vector3();
      this.warm();
    }

    // 1 つの InstancedMesh 風の板の束（属性 aA = x, y, z, t0・aB = vx, vy, vz, life・aC = 種類ごと）
    _pool(n, vs, fs, name, corners) {
      const g = new THREE.InstancedBufferGeometry();
      const pos = new Float32Array(12);
      for (let i = 0; i < 4; i++) { pos[i * 3] = corners[i][0]; pos[i * 3 + 1] = corners[i][1]; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) A[i * 4 + 3] = -1e9; // 生まれていない = いつも死んでいる
      const mk = (arr) => { const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
      const aA = mk(A), aB = mk(B), aC = mk(C);
      g.setAttribute('aA', aA); g.setAttribute('aB', aB); g.setAttribute('aC', aC);
      g.instanceCount = 0;
      const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uGrav: { value: 9.8 }, uStretch: { value: 0.03 },
        uAlpha: { value: 1 }, uMinA: { value: 0 }, uNear: { value: 4 }, uDrag: { value: 1 }, uBuoy: { value: 0 }, uMap: { value: null }
      }]);
      const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, fog: true });
      mat.name = name;
      // 同じ形のシェーダーの別のマテリアルと取り違えない（r128 は onBeforeCompile の無い ShaderMaterial を本文で引く）
      mat.customProgramCacheKey = () => name;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.scene.add(mesh);
      const P = { n, geo: g, mat, mesh, A, B, C, aA, aB, aC, head: 0, death: 0, lo: n, hi: -1, wrapped: false, cDirty: false, pLo: n, pHi: -1, pAll: false, pC: false };
      // 描く直前（three はこの描画で needsUpdate の属性を updateRange で上げる）に持っていた区間を消す。r128 の onUpload は
      //   バッファを作ったときしか呼ばれないので使えない
      mesh.onBeforeRender = () => { P.pLo = P.n; P.pHi = -1; P.pAll = false; P.pC = false; };
      return P;
    }

    // 次の 1 フレーム、何も生きていなくても描く（パイプラインを作らせる）
    warm() { this._warm = 2; }

    // 吹き下ろしの強さと輪（純粋。THREE なし）: rotor 0..1・agl（水面からの m）・speed（水平の m/s）
    static washParams(rotor, agl, speed, cfg) {
      const c = cfg || DEFAULTS;
      const R = num(c.rotorRadius, 5.35), maxAgl = num(c.maxAgl, 30);
      const a = clamp((agl || 0) / maxAgl, 0, 1);
      const strength = smooth(num(c.rotorFrom, 0.4), num(c.rotorFull, 0.95), rotor || 0) * (1 - a) * (1 - a);
      const ring = R * (1 + num(c.ringGrow, 1.2) * smooth(0, 0.7, a));
      const horse = smooth(num(c.horseFrom, 12), num(c.horseTo, 28), speed || 0);
      return { R, strength, ring, horse };
    }

    // 毎フレーム（game._updateCity の後）。vehicles: game.vehicles
    update(dt, camera, vehicles) {
      if (this.disposed) return;
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const c = this.cfg, S = this.stats;
      this.time += dt;
      this._bulletN = Math.max(0, this._bulletN - dt * c.bulletMaxPerSec);
      // 何も生きていなければ時計を 0 に戻す（float の t0 の精度）
      if (this.time > 600 && this.time > this.drops.death && this.time > this.mist.death) this._rebase();
      const cam = camera ? camera.getWorldPosition(this._tmpV) : null;
      this._camPos = cam;
      this._camera = camera || null;
      this._expirePulses();
      let best = null, bestScore = 0, owners = 0, sk = 0;
      if (this.on && vehicles && this.city) {
        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];
          if (v && v.kind === 'jet') { if (this._trail(v, cam, dt)) owners++; continue; }
          if (!v || v.kind !== 'heli' || v.destroyed || v.dead || !(v.rotor > 0.05) || !v.pos) continue;
          if (cam && Math.abs(v.pos.x - cam.x) + Math.abs(v.pos.z - cam.z) > c.maxDist * 1.4) continue;
          const g = this.city.groundAt(v.pos.x, v.pos.z);
          if (g.water === null || g.water === undefined) continue;
          // 真下に立てる面（甲板・桟橋・浮き桟橋）があれば水のしぶきは出さない。heli.js の _wash と同じ判定（S.y === null && S.water !== null。
          //   オンラインの他の人のヘリは _netGround が同じ onWater を書く）。沈んでいるヘリは出さない
          if (!v.onWater || v.sinking || v.sunk) continue;
          const agl = v.pos.y - g.water;
          if (agl > c.maxAgl) continue;
          const vel = v.vel || { x: 0, z: 0 };
          const sp = Math.hypot(vel.x || 0, vel.z || 0);
          const W = WaterFX.washParams(v.rotor, agl, sp, c);
          if (W.strength < 0.01) continue;
          owners++;
          this._wash(v, W, g.water, vel, sp, dt);
          const dc = cam ? Math.hypot(v.pos.x - cam.x, v.pos.z - cam.z) : 0;
          const score = W.strength / (1 + dc / 60);
          if (score > bestScore) {
            bestScore = score;
            const dx = sp > 0.5 ? vel.x / sp : 0, dz = sp > 0.5 ? vel.z / sp : 0;
            best = { wy: g.water, x: v.pos.x - dx * W.horse * W.R * 0.5, z: v.pos.z - dz * W.horse * W.R * 0.5, R: W.R, ring: W.ring, k: W.strength, dx, dz, horse: W.horse };
          }
          if (cam) sk = Math.max(sk, W.strength * clamp(1 - dc / c.soundMax, 0, 1));
        }
      }
      S.owners = owners;
      this._lensStep(dt, cam, best);
      S.strength = best ? best.k : 0;
      this._surf = best;
      this._surface(best);
      this._upload(this.drops);
      this._upload(this.mist);
      this._govern(camera);
      this.drops.mat.uniforms.uTime.value = this.time;
      this.mist.mat.uniforms.uTime.value = this.time;
      const dAlive = this.time <= this.drops.death, mAlive = this.time <= this.mist.death;
      const warm = this._warm > 0;
      if (warm) { this._warm--; S.warmDraws++; }
      this.drops.mesh.visible = dAlive || warm; this.drops.geo.instanceCount = dAlive ? this.drops.n : (warm ? 1 : 0);
      this.mist.mesh.visible = mAlive || warm; this.mist.geo.instanceCount = mAlive ? this.mist.n : (warm ? 1 : 0);
      this._count();
      this._sound(dt, best, sk);
      const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
      S.updateMs = ms; if (ms > S.updateMsMax) S.updateMsMax = ms;
    }

    // 着水（fx.splash から）: kind ごとの粒・霧・水面の輪。弾は bulletMaxPerSec 回/秒まで
    splash(x, y, z, kind, size) {
      if (this.disposed || !this.on) return;
      const c = this.cfg, K = (c.kinds && c.kinds[kind]) || c.kinds.body;
      if (kind === 'bullet') { if (this._bulletN >= c.bulletMaxPerSec * 0.25) { this.stats.bulletDropped++; return; } this._bulletN += 1; }
      const cp = this._camPos;
      if (cp && Math.abs(x - cp.x) + Math.abs(z - cp.z) > c.splashMaxDist) { this.stats.splashFar++; return; } // 遠い（輪の枠を近くの物から奪わない）
      this.stats.splashes++; this.stats.lastKind = kind;
      const g = this.city ? this.city.groundAt(x, z) : null;
      const wy = g && g.water !== null && g.water !== undefined ? g.water : y;
      const sk = Math.min(c.splashSkMax, Math.sqrt(Math.max(0.1, size || K.ref) / K.ref));
      const R = Math.random, lerp = (r) => r[0] + (r[1] - r[0]) * R();
      const nd = Math.min(c.maxSplashDrops, Math.round(K.drops * sk * Math.max(0.35, this.rateK)));
      const r0 = c.splashR0 * Math.min(4, size || 1);
      for (let i = 0; i < nd; i++) {
        const a = R() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rr = r0 * Math.sqrt(R());
        const o = lerp(K.out) * sk, u = lerp(K.up) * sk;
        this._emitDrop(x + ca * rr, wy + 0.03, z + sa * rr, ca * o, u, sa * o, lerp(K.life) * Math.sqrt(sk), lerp(K.size), wy);
      }
      const nm = Math.round(K.mist * Math.max(0.4, this.mistK));
      for (let i = 0; i < nm; i++) {
        const a = R() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), o = (1 + 2 * R()) * sk;
        const mu = K.mistUp || [0.6, 2], ms = K.mistSize || [0.8, 3];
        this._emitMist(x + ca * r0, wy + 0.4 + R() * 1.5 * sk, z + sa * r0, ca * o, lerp(mu) * sk, sa * o, lerp(c.splashMistLife), ms[0] * sk, (ms[1] * (0.8 + 0.4 * R())) * sk, wy);
      }
      if (K.pulse > 0) this._addPulse(x, z, K.pulse * sk);
      // レンズの水滴: 近い着水（泳ぎ・泡・弾は無し。目の位置の着水 = 自分の飛び込み・自分の乗り物（self、lensSelf m 以内）も無し。
      //   カメラが水の中なら無し）。カメラはこの時点の位置（プレイヤーの出来事は update より前に来るので、前のフレームの位置では
      //   速く飛び込んだ自分のしぶきが lensEye m より離れて見えた）
      if (c.lens !== false && K.lens > 0 && this._camera) {
        const e = this._camera.getWorldPosition(this._tmpL || (this._tmpL = new THREE.Vector3()));
        const self = this.self, cw = this.city ? this.city.groundAt(e.x, e.z).water : null;
        const own = self && self.pos && Math.hypot(x - self.pos.x, z - self.pos.z) < c.lensSelf;
        if (!own && Math.hypot(x - e.x, z - e.z) > c.lensEye && !(cw !== null && cw !== undefined && e.y < cw + c.lensUnder)) {
          const d = Math.hypot(x - e.x, wy - e.y, z - e.z);
          this.lens = Math.min(1, this.lens + K.lens * sk * (1 - smooth(c.lensNear, Math.max(c.lensNear + 0.5, c.lensRange * sk), d)));
        }
      }
    }

    // 水面の輪（water.js の uPulse。古い物から使い回す）
    _addPulse(x, z, k) {
      const W = this.water;
      if (!this.nPulse || !W || !W.uniforms || !W.uniforms.uPulse || this.cfg.surface === false) return;
      const i = this._pulse; this._pulse = (this._pulse + 1) % this.nPulse;
      if (W.uniforms.uPulseK) W.uniforms.uPulseK.value.set(this.cfg.pulseSpeed, this.cfg.pulseLife);
      W.uniforms.uPulse.value[i].set(x, z, W.uniforms.uTime.value, k);
      this.stats.pulses++;
    }

    // レンズの水滴（S3）: 時間で乾く・カメラが水の中なら 0・吹き下ろしの輪の中で水面に近いほど付く
    _lensStep(dt, cam, b) {
      const c = this.cfg, S = this.stats;
      if (c.lens === false || !cam) { this.lens = 0; return; }
      const cw = this.city ? this.city.groundAt(cam.x, cam.z).water : null;
      if (cw !== null && cw !== undefined && cam.y < cw + c.lensUnder) { this.lens = 0; return; } // 水の中
      let add = 0;
      if (b) {
        const dc = Math.hypot(cam.x - b.x, cam.z - b.z), hc = cam.y - b.wy;
        add = b.k * (1 - smooth(b.ring, b.ring * 2, dc)) * (1 - smooth(c.lensWashHeight[0], c.lensWashHeight[1], hc)) * c.lensRate;
      }
      this.lens = clamp(this.lens + (add - c.lensDecay) * dt, 0, 1);
      if (this.lens > S.lensMax) S.lensMax = this.lens;
    }

    // 消えた輪の w を 0 に（水のシェーダーが pulseFx を呼ばない）
    _expirePulses() {
      const W = this.water;
      if (!W || !W.uniforms || !W.uniforms.uPulse) return;
      const t = W.uniforms.uTime.value, L = this.cfg.pulseLife;
      for (const v of W.uniforms.uPulse.value) if (v.w > 0 && t - v.z > L) v.w = 0;
    }

    // 戦闘機が水面を低く速く飛ぶ: 後ろに水の尾（rooster tail）
    _trail(v, cam, dt) {
      const c = this.cfg;
      if (!v.pos || !v.vel || v.wrecked || v.destroyed || v.sunk) return false;
      if (v.mode !== undefined && v.mode !== 'air') return false; // 甲板・道路の上を走っている
      if (v.onWater === false) return false; // 真下が甲板・桟橋（空母の甲板は水の上）
      const sp = Math.hypot(v.vel.x, v.vel.y, v.vel.z);
      if (sp < c.trailFrom) return false;
      if (cam && Math.abs(v.pos.x - cam.x) + Math.abs(v.pos.z - cam.z) > c.maxDist * 3) return false;
      const g = this.city.groundAt(v.pos.x, v.pos.z);
      if (g.water === null || g.water === undefined) return false;
      const agl = v.pos.y - g.water;
      if (agl > c.trailAgl || agl < -1) return false;
      const a = 1 - Math.max(0, agl) / c.trailAgl;
      const k = a * a * smooth(c.trailFrom, c.trailFull, sp);
      if (k < 0.01) return false;
      this.stats.trail = Math.max(this.stats.trail, k);
      const hs = Math.hypot(v.vel.x, v.vel.z) || 1, dx = v.vel.x / hs, dz = v.vel.z / hs;
      // 上限に合わせた割合は尾の量と寿命から（ヘリの吹き下ろしの割合では携帯の尾が薄くなりすぎた）
      const tk = Math.min(1, this.nDrop / (c.trailRate * c.trailLife[1] * 1.05)), tm = Math.min(1, this.nMist / (c.trailMistRate * c.trailMistLife[1] * 1.05));
      this._acc.trail = (this._acc.trail || 0) + c.trailRate * tk * k * dt;
      this._acc.trailMist = (this._acc.trailMist || 0) + c.trailMistRate * tm * k * dt;
      let nd = Math.min(256, Math.floor(this._acc.trail)); this._acc.trail -= nd;
      let nm = Math.min(16, Math.floor(this._acc.trailMist)); this._acc.trailMist -= nm;
      const R = Math.random, lerp = (r) => r[0] + (r[1] - r[0]) * R();
      for (; nd > 0; nd--) {
        const b = lerp(c.trailBehind), side = (R() < 0.5 ? -1 : 1);
        const x = v.pos.x - dx * b + dz * side * R() * c.trailJitter, z = v.pos.z - dz * b - dx * side * R() * c.trailJitter;
        const s = lerp(c.trailSide) * side;
        this._emitDrop(x, g.water + 0.04, z, dz * s + v.vel.x * c.trailInherit[0], lerp(c.trailUp) * (0.4 + 0.6 * k), -dx * s + v.vel.z * c.trailInherit[0], lerp(c.trailLife), lerp(c.trailSize), g.water);
      }
      for (; nm > 0; nm--) {
        const b = lerp(c.trailBehind);
        this._emitMist(v.pos.x - dx * b, g.water + 0.5 + R(), v.pos.z - dz * b, v.vel.x * c.trailInherit[1] + (R() - 0.5) * 3, 1 + R() * 2, v.vel.z * c.trailInherit[1] + (R() - 0.5) * 3, lerp(c.trailMistLife), c.trailMistSize[0], c.trailMistSize[0] + (c.trailMistSize[1] - c.trailMistSize[0]) * (0.5 + 0.5 * R()) * k, g.water);
      }
      return true;
    }

    // 1 機の吹き下ろし: dt に比例して出す（20 / 30 / 60 fps で同じ量）
    _wash(v, W, wy, vel, sp, dt) {
      const c = this.cfg, k = W.strength;
      const dx = sp > 0.5 ? vel.x / sp : 0, dz = sp > 0.5 ? vel.z / sp : 0;
      const cx = v.pos.x - dx * W.horse * W.R * 0.5, cz = v.pos.z - dz * W.horse * W.R * 0.5;
      this._acc.drop += c.dropRate * this.rateK * k * dt;
      this._acc.mist += c.mistRate * this.mistK * Math.sqrt(k) * dt;
      let nd = Math.min(256, Math.floor(this._acc.drop)); this._acc.drop -= nd;
      let nm = Math.min(32, Math.floor(this._acc.mist)); this._acc.mist -= nm;
      const R = Math.random, lerp = (r) => r[0] + (r[1] - r[0]) * R();
      for (let tries = 0; nd > 0 && tries < 400; tries++) {
        const a = R() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        // 速いと前の側は出ない（蹄鉄の形）
        if (W.horse > 0 && ca * dx + sa * dz > -0.15 && R() < W.horse * c.horseCut) continue;
        const r = W.ring * (c.ringBand[0] + (c.ringBand[1] - c.ringBand[0]) * R());
        const x = cx + ca * r, z = cz + sa * r;
        const g = this.city.groundAt(x, z);
        if (g.water === null || g.water === undefined) { nd--; continue; }
        const s = lerp(c.dropSpeed) * (0.55 + 0.45 * k);
        this._emitDrop(x, g.water + 0.04, z, ca * s + vel.x * c.inherit[0], lerp(c.dropUp) * (0.4 + 0.6 * k), sa * s + vel.z * c.inherit[0], lerp(c.dropLife), lerp(c.dropSize), g.water);
        nd--;
      }
      for (let tries = 0; nm > 0 && tries < 60; tries++) {
        const a = R() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        if (W.horse > 0 && ca * dx + sa * dz > 0 && R() < W.horse * c.horseCut) continue;
        const r = W.ring * (c.mistBand[0] + (c.mistBand[1] - c.mistBand[0]) * R());
        const x = cx + ca * r, z = cz + sa * r;
        const g = this.city.groundAt(x, z);
        if (g.water === null || g.water === undefined) { nm--; continue; }
        const s = lerp(c.mistSpeed) * (0.5 + 0.5 * k);
        const s1 = lerp(c.mistSize1) * (0.6 + 0.4 * k);
        this._emitMist(x, g.water + lerp(c.mistLift), z, ca * s + vel.x * c.inherit[1], lerp(c.mistUp), sa * s + vel.z * c.inherit[1], lerp(c.mistLife), lerp(c.mistSize0), s1, g.water);
        nm--;
      }
    }

    _slot(P) {
      const i = P.head;
      P.head = (P.head + 1) % P.n;
      if (P.head === 0) P.wrapped = true;
      if (i < P.lo) P.lo = i;
      if (i > P.hi) P.hi = i;
      return i;
    }

    _emitDrop(x, y, z, vx, vy, vz, life, size, wy) {
      const P = this.drops, i = this._slot(P), o = i * 4;
      P.A[o] = x; P.A[o + 1] = y; P.A[o + 2] = z; P.A[o + 3] = this.time;
      P.B[o] = vx; P.B[o + 1] = vy; P.B[o + 2] = vz; P.B[o + 3] = life;
      P.C[o] = wy; P.C[o + 1] = size; P.C[o + 2] = 0; P.C[o + 3] = 0;
      const d = this.time + life;
      if (d > P.death) P.death = d;
      this.stats.emitted++;
    }

    _emitMist(x, y, z, vx, vy, vz, life, s0, s1, wy) {
      const P = this.mist, i = this._slot(P), o = i * 4;
      P.A[o] = x; P.A[o + 1] = y; P.A[o + 2] = z; P.A[o + 3] = this.time;
      P.B[o] = vx; P.B[o + 1] = vy; P.B[o + 2] = vz; P.B[o + 3] = life;
      P.C[o] = s0; P.C[o + 1] = s1; P.C[o + 2] = wy; P.C[o + 3] = 1; // z = 水面の高さ（回転は t0 と x から）
      const d = this.time + life;
      if (d > P.death) P.death = d;
      this._mistDeath[i] = d;
      this.stats.mistEmitted++;
    }

    // 書いた所だけ上げる。先頭が回ったフレームは全部（r128 の updateRange は 1 区間）。描く前に update が何回か来ても（撮影・
    //   描かないフレーム）、実際に描く（onBeforeRender）までは前の区間と合わせて持つ（最後のフレームの区間だけ上げて前の粒が抜けない）
    _upload(P) {
      if (P.hi >= 0) {
        if (P.wrapped) P.pAll = true;
        else { if (P.lo < P.pLo) P.pLo = P.lo; if (P.hi > P.pHi) P.pHi = P.hi; }
        if (P.wrapped) this.stats.wraps++;
      }
      if (P.cDirty) P.pC = true;
      P.lo = P.n; P.hi = -1; P.wrapped = false; P.cDirty = false;
      const any = P.pAll || P.pHi >= 0;
      if (!any && !P.pC) return;
      const set = (a, all) => {
        if (all) { a.updateRange.offset = 0; a.updateRange.count = -1; } else { a.updateRange.offset = P.pLo * 4; a.updateRange.count = (P.pHi - P.pLo + 1) * 4; }
        a.needsUpdate = true;
      };
      if (any) { set(P.aA, P.pAll); set(P.aB, P.pAll); }
      if (any || P.pC) set(P.aC, P.pAll || P.pC || !any);
      this.stats.uploads++;
    }

    // 霧が画面を覆う割合（塗る量）を抑える: 描く板（見えている = 不透明度 > mistMinAlpha）ごとの画面の中の面積の割合の和が coverageMax
    //   （2.5 枚分）を超えたら、大きい物から切る（aC.w = 0 → 頂点シェーダーが板を潰すので塗らない。切った板はその寿命の間ずっと切ったまま
    //   = 毎フレーム出たり消えたりしない）。不透明度で割り引かない: 薄い板も同じだけ塗る（半精度のターゲットは 1 層 8 B/px）
    _govern(camera) {
      const P = this.mist, S = this.stats;
      if (!camera || this.time > P.death) { S.coverage = 0; S.coverageRaw = 0; S.governed = 0; return; }
      const c = this.cfg, t = this.time, A = P.A, B = P.B, C = P.C;
      camera.updateMatrixWorld();
      const e = (this._inv || (this._inv = new THREE.Matrix4())).copy(camera.matrixWorld).invert().elements;
      const tanY = Math.tan((camera.fov || 70) * Math.PI / 360), asp = camera.aspect || 1.6;
      const drag = c.mistDrag, buoy = c.mistBuoy, near = c.nearFade, amin = c.mistMinAlpha;
      let sum = 0, raw = 0;
      const order = this._order; order.length = 0;
      const ov = (cc, r) => Math.max(0, Math.min(1, cc + r) - Math.max(-1, cc - r)); // [-1, 1] と重なる長さ
      for (let i = 0; i < P.n; i++) {
        const o = i * 4, age = t - A[o + 3], life = B[o + 3];
        this._mistCov[i] = 0;
        if (age < 0 || age > life) continue;
        const f = (1 - Math.exp(-drag * age)) / drag;
        const x = A[o] + B[o] * f, y = A[o + 1] + B[o + 1] * f + buoy * age, z = A[o + 2] + B[o + 2] * f;
        const d = -(e[2] * x + e[6] * y + e[10] * z + e[14]);
        if (d < 0.05) continue;
        const u = age / life;
        const a = WaterFX.mistFade(u) * smooth(0.5, near, d);
        if (a * C[o + 3] < amin && C[o + 3] > 0) continue; // シェーダーが潰す（塗らない）
        const s = C[o] + (C[o + 1] - C[o]) * Math.sqrt(u);
        const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const hy = d * tanY, hx = hy * asp;
        // 画面（NDC の [-1, 1]²）に入る面積の割合（板は回っているが外接の四角で見る）
        const frac = ov(vx / hx, s / hx) * ov(vy / hy, s / hy) / 4;
        if (frac <= 0) continue;
        if (C[o + 3] === 0) continue; // 切った板（塗らない）
        this._mistCov[i] = frac;
        raw += frac;
        order.push(i);
      }
      S.coverageRaw = raw;
      sum = raw;
      let gov = 0;
      if (raw > c.coverageMax) {
        order.sort((p, q) => this._mistCov[q] - this._mistCov[p]);
        for (let j = 0; j < order.length && sum > c.coverageMax; j++) {
          const i = order[j];
          sum -= this._mistCov[i];
          this._mistCov[i] = 0;
          C[i * 4 + 3] = 0; P.cDirty = true;
          gov++;
        }
      }
      S.coverage = sum;
      S.governed = gov;
      S.cut = (S.cut || 0) + gov;
      if (P.cDirty) this._upload(P);
    }

    // 霧の不透明度（年齢の割合 u）: シェーダーの mistFade と同じ式
    static mistFade(u) { const a = clamp(u / 0.12, 0, 1), b = 1 - u; return a * b * Math.sqrt(Math.max(0, b)); }

    _count() {
      if (this.time > this.drops.death) this.stats.drops = 0;
      else {
        let n = 0; const A = this.drops.A, B = this.drops.B, t = this.time;
        for (let i = 0; i < this.drops.n; i++) { const age = t - A[i * 4 + 3]; if (age >= 0 && age <= B[i * 4 + 3]) n++; }
        this.stats.drops = n;
      }
      if (this.time > this.mist.death) this.stats.mist = 0;
      else { let n = 0; for (let i = 0; i < this.mist.n; i++) if (this._mistDeath[i] >= this.time && this.mist.A[i * 4 + 3] <= this.time) n++; this.stats.mist = n; }
    }

    _rebase() {
      for (const P of [this.drops, this.mist]) {
        for (let i = 0; i < P.n; i++) P.A[i * 4 + 3] = -1e9;
        P.death = -1e9; P.wrapped = true; P.lo = 0; P.hi = P.n - 1;
      }
      this._mistDeath.fill(-1e9);
      this.time = 0;
      this.stats.rebases++;
    }

    // 水面の段（water.js の uWash*。uniform だけ）
    _surface(b) {
      const W = this.water;
      if (!W || !W.uniforms || !W.uniforms.uWash) return;
      const U = W.uniforms;
      if (!b || this.cfg.surface === false) { if (U.uWash.value.w !== 0) U.uWash.value.w = 0; return; }
      U.uWash.value.set(b.x, b.z, b.R, b.k);
      U.uWashRing.value = b.ring;
      U.uWashDir.value.set(b.dx, b.dz, b.horse);
      U.uWashLook.value.set(this.cfg.darkness, this.cfg.ripple, this.cfg.foam);
    }

    // 水の音（S1 は water_lap。rotor_spray は S3）: 一番強い吹き下ろしの真ん中、4 Hz
    _sound(dt, b, k) {
      const a = this.audio;
      if (!a || typeof a.loop !== 'function' || !this.cfg.sound) return;
      this._sndT -= dt;
      if (this._sndT > 0) return;
      this._sndT = 0.25;
      if (b && k > 0.02) {
        const p = { x: b.x, y: b.wy + 0.5, z: b.z };
        if (!this._snd) this._snd = a.loop(this.cfg.sound, { pos: p, volume: 0.0001, refDistance: this.cfg.soundRef, maxDistance: this.cfg.soundMax, fadeIn: 0.6, bus: 'sfx' });
        this._snd.setPosition(p);
        this._snd.setVolume(k * this.cfg.soundVolume);
        this._sndOff = 0;
      } else if (this._snd) {
        this._sndOff = (this._sndOff || 0) + 0.25;
        this._snd.setVolume(0);
        if (this._sndOff > 1.5) { this._snd.stop(0.5); this._snd = null; }
      }
    }

    get draws() { return (this.drops.mesh.visible ? 1 : 0) + (this.mist.mesh.visible ? 1 : 0); }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const P of [this.drops, this.mist]) { this.scene.remove(P.mesh); P.geo.dispose(); P.mat.dispose(); }
      if (this._snd) { this._snd.stop(0.2); this._snd = null; }
      if (this.water && this.water.uniforms && this.water.uniforms.uWash) this.water.uniforms.uWash.value.w = 0;
      if (this.water && this.water.uniforms && this.water.uniforms.uPulse) for (const v of this.water.uniforms.uPulse.value) v.w = 0;
    }

    // 霧のしみ（64²・アルファだけ。乱数は固定 = どの端末でも同じ。Canvas を使わない = Node のスモークでも同じ）
    static blotch() {
      if (WaterFX._blotch) return WaterFX._blotch;
      const N = 64, px = new Uint8Array(N * N * 4);
      let s = 1234567;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const blobs = [];
      for (let i = 0; i < 9; i++) blobs.push([0.5 + (rnd() - 0.5) * 0.45, 0.5 + (rnd() - 0.5) * 0.45, 0.14 + rnd() * 0.16, 0.5 + rnd() * 0.5]);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N, v = (j + 0.5) / N;
        let a = 0;
        for (const b of blobs) { const d = Math.hypot(u - b[0], v - b[1]) / b[2]; a += b[3] * Math.exp(-d * d * 2.2); }
        const r = Math.hypot(u - 0.5, v - 0.5) * 2;
        a = clamp(a * 0.75, 0, 1) * clamp(1 - r * r, 0, 1);
        const o = (j * N + i) * 4;
        px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = Math.round(a * 255);
      }
      const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
      return (WaterFX._blotch = t);
    }
  }
  WaterFX.DEFAULTS = DEFAULTS;

  // ---------- シェーダー（r128 の chunk: fog・トーンマッピング・出力のエンコード）----------
  const HEAD = [
    'uniform float uTime; uniform float uGrav; uniform float uStretch; uniform float uNear; uniform float uDrag; uniform float uBuoy; uniform float uMinA;',
    'attribute vec4 aA; attribute vec4 aB; attribute vec4 aC;',
    'varying float vA; varying vec2 vUv;',
    '#include <fog_pars_vertex>'
  ];
  const DEAD = '{ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vUv = vec2(0.0); return; }';
  WaterFX.DROP_VERT = HEAD.concat([
    'void main() {',
    '  float age = uTime - aA.w;',
    '  if (age < 0.0 || age > aB.w) ' + DEAD,
    '  vec3 p = aA.xyz + aB.xyz * age; p.y -= 0.5 * uGrav * age * age;',
    '  if (p.y < aC.x - 0.05) ' + DEAD,
    '  vec3 v = aB.xyz; v.y -= uGrav * age;',
    '  vec4 mvPosition = viewMatrix * vec4(p, 1.0);',
    '  vec2 vv = (viewMatrix * vec4(v, 0.0)).xy;',
    '  float sp = length(vv);',
    '  vec2 dir = sp > 0.001 ? vv / sp : vec2(0.0, 1.0);',
    '  vec2 side = vec2(-dir.y, dir.x);',
    '  float len = aC.y * 1.5 + sp * uStretch;',
    '  mvPosition.xy += side * position.x * aC.y * 0.5 - dir * position.y * len;',
    '  vA = 1.0 - smoothstep(0.65, 1.0, age / aB.w);',
    '  vUv = position.xy;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ]).join('\n');
  WaterFX.DROP_FRAG = [
    'uniform vec3 uColor;',
    'varying float vA; varying vec2 vUv;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  float a = (1.0 - vUv.x * vUv.x) * (1.0 - vUv.y * 0.6) * vA * 0.9;',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(uColor, a);',
    '  #include <tonemapping_fragment>',
    '  #include <encodings_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');
WaterFX.MIST_VERT = HEAD.concat([
    'float mistFade(float u) { float a = clamp(u / 0.12, 0.0, 1.0); float b = 1.0 - u; return a * b * sqrt(max(b, 0.0)); }',
    'void main() {',
    '  float age = uTime - aA.w;',
    '  if (age < 0.0 || age > aB.w) ' + DEAD,
    '  float f = (1.0 - exp(-uDrag * age)) / uDrag;',
    '  vec3 p = aA.xyz + aB.xyz * f; p.y += uBuoy * age;',
    '  float u = age / aB.w;',
    '  float s = aC.x + (aC.y - aC.x) * sqrt(u);',
    '  float rot = fract(aA.w * 12.9898 + aA.x * 0.731) * 6.2831853;',
    '  float cr = cos(rot), sr = sin(rot);',
    '  vec2 q = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * s;',
    // カメラに向けた板を世界の座標で作り、水面より下の角は水面の上に寝かせる（板が水面で切れて横の線にならない）
    '  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
    '  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);',
    '  vec3 w = p + right * q.x + up * q.y;',
    '  w.y = max(w.y, aC.z + 0.06);',
    '  vec4 mvPosition = viewMatrix * vec4(w, 1.0);',
    '  vec4 mvC = viewMatrix * vec4(p, 1.0);',
    '  vA = mistFade(u) * smoothstep(0.5, uNear, -mvC.z) * aC.w;',
  '  if (vA <= uMinA) ' + DEAD,
    '  vUv = position.xy * 0.5 + 0.5;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ]).join('\n');
    WaterFX.MIST_FRAG = [
    'uniform vec3 uColor; uniform float uAlpha; uniform sampler2D uMap;',
    'varying float vA; varying vec2 vUv;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  float a = texture2D(uMap, vUv).a * vA * uAlpha;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(uColor, a);',
    '  #include <tonemapping_fragment>',
    '  #include <encodings_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  MR.WaterFX = WaterFX;
})();
