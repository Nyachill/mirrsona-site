// 破片（MR.Debris。E3.2）。墜落・誘爆で飛ぶ金属の破片を全部で 1 つの InstancedMesh = 1 回の描画にする。壊れた機体から外れた部品
//   （戦闘機の水平尾翼・垂直尾翼・キャノピー、ヘリのテールローター = 元のモデルのノード）も同じ跳ね方で落とす（描画は増えない）。
//   ほかの流れ（建物・小物の破壊）もここへ足す: 種類（kit）を game.json の fire.debrisFx.kits に足して spawn / burst を呼ぶだけ。
//
//   new MR.Debris(scene, cfg, opts)
//     cfg  = game.json の fire.debrisFx（gravity / restitution / friction / maxBounces / life / fade / glowSec / glow / color / sound* / kits / node）
//     opts = { cap（同時に出せる破片 = fire.caps.debris、タッチ端末は fire.mobile.caps.debris）, support(x, z, yRef) → y | null（yRef より下の立てる面）,
//              water(x, z) → 水面 | null, audio（play）, mobile }
//   kits: { <名前>: { size: [最小, 最大] m, speed: [m/s], up: [m/s], inherit（壊れた物の速さを足す割合）, spin（rad/s）, n: [個]（burst の既定）, life: [秒] } }
//   spawn(kit, p, v, spin, life) → 番号 | -1 … 破片を 1 つ。p = { x, y, z }、v = { x, y, z }（m/s）、spin = rad/s（null で kit.spin）、
//     life = 秒（null で kit.life か cfg.life）。いっぱいなら残りの一番短いものを外す（stats.evicted）
//   burst(kit, x, y, z, n, vx, vy, vz) → 出した数 … n 個（n が null なら kit.n）を周りへ（横 speed・上 up + 壊れた物の速さ × inherit）
//   node(obj, v, spin, owner) … THREE.Object3D（もうシーンに直接付けたもの = scene.attach）を同じ跳ね方で落とす。消さない（持ち主が
//     元へ戻すまで止まって残る）。releaseNode(obj) で手を離す（Vehicle._restoreDebris が呼ぶ）
//   跳ね方: 当たり判定の問い合わせ（opts.support / water）は「次に跳ねる所の予測」のときだけ（出したとき・跳ねたとき。1 回に 1〜2 回）。
//     放物線で予測した面の高さで跳ね（restitution・friction）、maxBounces 回か遅くなったら止まる。水面なら沈んで消える。壁は見ない
//   光る: instanceColor を発光にする（出したときは glow の色、glowSec 秒で暗くなる）。地の色は cfg.color（暗い金属）。影は落とさない
//   音: 最初に跳ねたときに debris_metal（3D。listener から soundRange m 以内・soundSpeed m/s 以上・soundEvery 秒に 1 回まで。audio の limits でも 3 つまで）
//   update(dt, cam) … 毎フレーム（game._update が crashes.update の後に）。新しく物を作らない（配列・行列は使い回し）
//   stats { spawned, live, liveMax, evicted, bounces, rests, sunk, queries, sounds, nodes, nodesMax, updMs, updMsMax, created, disposed }
//   drawCalls() / meshes(out) / clear()（破片を全部消す。ノードは手を離すだけ）/ dispose()（game.stop）。dispose の後の spawn / burst / node は何もしない
//   メッシュは frustumCulled = false（r128 の InstancedMesh は形の外接球 = 原点の近くで消す）。最初の spawn で作る（使わない場面は描画 0）
window.MR = window.MR || {};

MR.Debris = class Debris {
  constructor(scene, cfg, opts) {
    cfg = cfg || {};
    opts = opts || {};
    this.scene = scene;
    this.cfg = cfg;
    this.mobile = !!opts.mobile;
    this.audio = opts.audio || null;
    this.support = typeof opts.support === 'function' ? opts.support : null;
    this.water = typeof opts.water === 'function' ? opts.water : null;
    const cap = Math.max(1, (opts.cap | 0) || Debris.CAP);
    this.cap = cap;
    const pr = (a, d0, d1) => (Array.isArray(a) && a.length >= 2 ? [+a[0], +a[1]] : [d0, d1]);
    this.g = cfg.gravity > 0 ? cfg.gravity : 14;
    this.rest = cfg.restitution >= 0 ? cfg.restitution : 0.35;
    this.fric = cfg.friction >= 0 ? cfg.friction : 0.55;
    this.maxBounces = cfg.maxBounces > 0 ? cfg.maxBounces | 0 : 3;
    this.life = pr(cfg.life, 8, 14);
    this.fade = cfg.fade > 0 ? cfg.fade : 1.5;
    this.glowSec = pr(cfg.glowSec, 2, 4);
    const gl = Array.isArray(cfg.glow) && cfg.glow.length >= 3 ? cfg.glow : [1.6, 0.55, 0.15];
    this.glow = [+gl[0], +gl[1], +gl[2]];
    this.soundRange = cfg.soundRange > 0 ? cfg.soundRange : 120;
    this.soundEvery = cfg.soundEvery > 0 ? cfg.soundEvery : 0.12;
    this.soundSpeed = cfg.soundSpeed > 0 ? cfg.soundSpeed : 4;
    this.kits = cfg.kits || {};
    this.nodeCfg = Object.assign({ speed: [5, 12], up: [4, 9], inherit: 0.6, spin: 5 }, cfg.node || {});
    // 破片の状態（型付き配列。state: 0 空き 1 飛ぶ 2 止まった 3 沈む）
    const F = (n) => new Float32Array(n);
    this.px = F(cap); this.py = F(cap); this.pz = F(cap);
    this.vx = F(cap); this.vy = F(cap); this.vz = F(cap);
    this.rx = F(cap); this.ry = F(cap); this.rz = F(cap);
    this.wx = F(cap); this.wy = F(cap); this.wz = F(cap);
    this.sx = F(cap); this.sy = F(cap); this.sz = F(cap);
    this.t = F(cap); this.lifeT = F(cap); this.glowT = F(cap);
    this.floor = F(cap); this.floorW = new Uint8Array(cap); // floorW = 予測した面が水
    this.state = new Uint8Array(cap); this.bnc = new Uint8Array(cap);
    this.n = 0;
    this.nodes = []; // { obj, owner, v: Vector3, w: Vector3, floor, floorW, state, bnc, t }
    this.listener = { x: 0, y: 0, z: 0 };
    this._sndT = 0;
    this.mesh = null;
    this._e = null; this._q = null; this._m = null; this._p = null; this._s = null;
    this._sp = { x: 0, y: 0, z: 0 };
    this._pr = { floor: 0, water: false };
    this.stats = { spawned: 0, live: 0, liveMax: 0, evicted: 0, bounces: 0, rests: 0, sunk: 0, queries: 0, sounds: 0, nodes: 0, nodesMax: 0,
      updMs: 0, updMsMax: 0, created: 0, disposed: 0 };
  }

  _kit(kit) {
    if (kit && typeof kit === 'object') return kit;
    return this.kits[kit] || this.kits.default || Debris.KIT;
  }

  _build() {
    if (this.mesh || typeof THREE === 'undefined') return;
    // 形: ゆがんだ薄い箱（12 三角形。頂点の位置で決まるずらし = 面がつながったまま）。大きさと向きはインスタンスごと
    const g = new THREE.BoxBufferGeometry(1, 0.22, 0.75);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      const f = h - Math.floor(h);
      pos.setXYZ(i, x * (0.75 + f * 0.5), y + (f - 0.5) * 0.18 + x * z * 0.25, z * (1.2 - f * 0.4));
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: MR.srgb ? MR.srgb(this.cfg.color || '#34322f') : 0x34322f, roughness: 0.75, metalness: 0.35 });
    // instanceColor は地の色ではなく発光（熱い破片が赤く光って冷める）
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive;\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor;\n#endif');
    };
    mat.customProgramCacheKey = () => 'mr_debris';
    const mesh = new THREE.InstancedMesh(g, mat, this.cap);
    if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    if (mesh.instanceColor.setUsage) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'debris';
    this.scene.add(mesh);
    this.mesh = mesh;
    this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.stats.created += 2;
  }

  // ---------- 出す ----------
  spawn(kit, p, v, spin, life) {
    if (!p || this.disposed) return -1; // dispose の後は何もしない（形を作り直さない）
    const K = this._kit(kit);
    this._build();
    let i;
    if (this.n < this.cap) i = this.n++;
    else {
      // いっぱい: 残りが一番短いもの
      let best = Infinity; i = 0;
      for (let k = 0; k < this.cap; k++) { const left = this.lifeT[k] - this.t[k]; if (left < best) { best = left; i = k; } }
      this.stats.evicted++;
    }
    const R = Math.random;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = v ? v.x || 0 : 0; this.vy[i] = v ? v.y || 0 : 0; this.vz[i] = v ? v.z || 0 : 0;
    this.rx[i] = R() * 6.283; this.ry[i] = R() * 6.283; this.rz[i] = R() * 6.283;
    const w = spin != null ? spin : (K.spin != null ? K.spin : 8);
    this.wx[i] = (R() - 0.5) * 2 * w; this.wy[i] = (R() - 0.5) * 2 * w; this.wz[i] = (R() - 0.5) * 2 * w;
    const sz = K.size || Debris.KIT.size, s = sz[0] + R() * (sz[1] - sz[0]);
    this.sx[i] = s; this.sy[i] = s * (0.7 + R() * 0.6); this.sz[i] = s * (0.6 + R() * 0.6);
    const lf = K.life || this.life;
    this.t[i] = 0;
    this.lifeT[i] = life > 0 ? life : lf[0] + R() * (lf[1] - lf[0]);
    this.glowT[i] = this.glowSec[0] + R() * (this.glowSec[1] - this.glowSec[0]);
    this.state[i] = 1; this.bnc[i] = 0;
    this._predict(i);
    this.stats.spawned++;
    return i;
  }

  burst(kit, x, y, z, n, vx, vy, vz) {
    if (this.disposed) return 0;
    const K = this._kit(kit);
    if (n == null) { const nn = K.n || [2, 4]; n = nn[0] + Math.floor(Math.random() * (nn[1] - nn[0] + 1)); }
    n = Math.max(0, Math.min(this.cap, n | 0));
    const R = Math.random, sp = K.speed || Debris.KIT.speed, up = K.up || Debris.KIT.up, inh = K.inherit != null ? K.inherit : 0.4;
    const P = this._sp, V = this._sv || (this._sv = { x: 0, y: 0, z: 0 });
    for (let k = 0; k < n; k++) {
      const a = R() * 6.283, h = sp[0] + R() * (sp[1] - sp[0]);
      V.x = Math.cos(a) * h + (vx || 0) * inh; V.z = Math.sin(a) * h + (vz || 0) * inh;
      V.y = up[0] + R() * (up[1] - up[0]) + Math.max(-10, (vy || 0) * inh);
      P.x = x + (R() - 0.5) * 1.5; P.y = y + 0.4 + R(); P.z = z + (R() - 0.5) * 1.5;
      this.spawn(K, P, V, null, null);
    }
    return n;
  }

  // 外れた部品（もう scene.attach してあるノード）
  node(obj, v, spin, owner) {
    if (!obj || this.disposed) return null;
    const R = Math.random, w = spin != null ? spin : this.nodeCfg.spin;
    const b = { obj, owner: owner || null, v: new THREE.Vector3(v ? v.x : 0, v ? v.y : 0, v ? v.z : 0),
      w: new THREE.Vector3((R() - 0.5) * 2 * w, (R() - 0.5) * 2 * w, (R() - 0.5) * 2 * w), floor: 0, floorW: false, state: 1, bnc: 0, t: 0 };
    this.nodes.push(b);
    this._predictNode(b);
    this.stats.nodes = this.nodes.length;
    if (this.nodes.length > this.stats.nodesMax) this.stats.nodesMax = this.nodes.length;
    return b;
  }
  releaseNode(obj) {
    const L = this.nodes;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].obj === obj) { L[i] = L[L.length - 1]; L.length--; }
    this.stats.nodes = L.length;
  }

  // ---------- 跳ねる所の予測（問い合わせはここだけ）----------
  // (x, y, z) から (vx, vy, vz) で飛んで落ちる面の高さ。1 回目は真下の面、着く所の面が違えば 2 回目（それで決める。壁は見ない = 低い所から
  //   建物の横へ飛んだ破片は建物の中の下の面まで落ちることがある。小さく短い間なので見逃す）。結果は this._pr
  _land(x, y, z, vx, vy, vz) {
    const out = this._pr, g = this.g;
    out.water = false;
    const sup = this.support, wat = this.water;
    let f = sup ? sup(x, z, y + 0.3) : null;
    this.stats.queries++;
    if (f == null || !isFinite(f)) {
      const w = wat ? wat(x, z) : null;
      if (w != null && isFinite(w)) { f = w; out.water = true; } else f = y - 200;
    }
    // 着く時刻（放物線）→ その xz の面
    const dy = Math.max(0, y - f);
    const tl = (vy + Math.sqrt(vy * vy + 2 * g * dy)) / g;
    const lx = x + vx * tl, lz = z + vz * tl;
    if ((Math.abs(lx - x) > 1 || Math.abs(lz - z) > 1) && sup) {
      const f2 = sup(lx, lz, y + 0.3); // 今の高さより下の一番高い面（屋上・甲板）
      this.stats.queries++;
      if (f2 != null && isFinite(f2)) { if (Math.abs(f2 - f) > 0.3) { f = f2; out.water = false; } }
      else {
        const w = wat ? wat(lx, lz) : null;
        if (w != null && isFinite(w)) { f = w; out.water = true; }
      }
    }
    out.floor = f;
    return out;
  }
  _predict(i) {
    const r = this._land(this.px[i], this.py[i], this.pz[i], this.vx[i], this.vy[i], this.vz[i]);
    this.floor[i] = r.floor; this.floorW[i] = r.water ? 1 : 0;
  }
  _predictNode(b) {
    const p = b.obj.position;
    const r = this._land(p.x, p.y, p.z, b.v.x, b.v.y, b.v.z);
    b.floor = r.floor; b.floorW = r.water;
  }

  _sound(x, y, z, speed) {
    if (!this.audio || typeof this.audio.play !== 'function' || this._sndT > 0 || speed < this.soundSpeed) return;
    const dx = x - this.listener.x, dy = y - this.listener.y, dz = z - this.listener.z;
    if (dx * dx + dy * dy + dz * dz > this.soundRange * this.soundRange) return;
    const P = this._sp;
    P.x = x; P.y = y; P.z = z;
    this._sndT = this.soundEvery;
    this.stats.sounds++;
    this.audio.play('debris_metal', { pos: P, refDistance: 8, maxDistance: this.soundRange, volume: Math.min(1, 0.35 + speed / 20), rate: 0.9 + Math.random() * 0.25, priority: 1 });
  }

  // ---------- 毎フレーム ----------
  update(dt, cam) {
    const t0 = Debris.now();
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    if (cam) { this.listener.x = cam.x; this.listener.y = cam.y; this.listener.z = cam.z; }
    if (this._sndT > 0) this._sndT -= dt;
    const g = this.g;
    // 破片
    for (let i = 0; i < this.n; i++) {
      const st = this.state[i];
      if (!st) continue;
      this.t[i] += dt;
      if (this.t[i] >= this.lifeT[i]) { this._kill(i); i--; continue; }
      if (st === 1) {
        this.vy[i] -= g * dt;
        this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
        this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
        if (this.py[i] <= this.floor[i] && this.vy[i] < 0) {
          if (this.floorW[i]) {
            this.state[i] = 3; this.py[i] = this.floor[i]; this.vy[i] = -0.8; this.vx[i] *= 0.2; this.vz[i] *= 0.2;
            this.lifeT[i] = Math.min(this.lifeT[i], this.t[i] + 1.2); this.stats.sunk++;
          } else {
            const sp = -this.vy[i];
            this.py[i] = this.floor[i];
            this.stats.bounces++;
            if (this.bnc[i] === 0) this._sound(this.px[i], this.py[i], this.pz[i], sp + Math.hypot(this.vx[i], this.vz[i]) * 0.3);
            this.bnc[i]++;
            this.vy[i] = sp * this.rest; this.vx[i] *= this.fric; this.vz[i] *= this.fric;
            this.wx[i] *= 0.5; this.wy[i] *= 0.5; this.wz[i] *= 0.5;
            if (this.bnc[i] >= this.maxBounces || this.vy[i] < 1.2) { this.state[i] = 2; this.vy[i] = 0; this.stats.rests++; }
            else this._predict(i);
          }
        }
      } else if (st === 3) {
        this.py[i] += this.vy[i] * dt;
      }
    }
    // 外れた部品
    const L = this.nodes;
    for (let k = 0; k < L.length; k++) {
      const b = L[k];
      if (b.state !== 1 && b.state !== 3) continue;
      const o = b.obj, p = o.position;
      b.t += dt;
      if (b.state === 3) { p.y -= 0.8 * dt; if (b.t > 2) { o.visible = false; b.state = 4; } continue; }
      b.v.y -= g * dt;
      p.x += b.v.x * dt; p.y += b.v.y * dt; p.z += b.v.z * dt;
      o.rotation.x += b.w.x * dt; o.rotation.y += b.w.y * dt; o.rotation.z += b.w.z * dt;
      if (p.y <= b.floor && b.v.y < 0) {
        if (b.floorW) { b.state = 3; b.t = 0; p.y = b.floor; this.stats.sunk++; continue; }
        const sp = -b.v.y;
        p.y = b.floor;
        this.stats.bounces++;
        if (b.bnc === 0) this._sound(p.x, p.y, p.z, sp);
        b.bnc++;
        b.v.y = sp * this.rest; b.v.x *= this.fric; b.v.z *= this.fric; b.w.multiplyScalar(0.5);
        if (b.bnc >= this.maxBounces || b.v.y < 1.2) { b.state = 2; this.stats.rests++; } else this._predictNode(b);
      }
      if (p.y < -60) { o.visible = false; b.state = 4; }
    }
    this._write();
    this.stats.live = this.n;
    if (this.n > this.stats.liveMax) this.stats.liveMax = this.n;
    const ms = Debris.now() - t0;
    this.stats.updMs = ms;
    if (ms > this.stats.updMsMax) this.stats.updMsMax = ms;
  }

  // i を外して最後のものを i へ詰める
  _kill(i) {
    const j = this.n - 1;
    if (i !== j) {
      const A = Debris.FIELDS;
      for (let k = 0; k < A.length; k++) { const a = this[A[k]]; a[i] = a[j]; }
    }
    this.state[j] = 0;
    this.n--;
  }

  _write() {
    const M = this.mesh;
    if (!M) return;
    const n = this.n;
    M.count = n;
    M.visible = n > 0;
    if (!n) return;
    const arr = M.instanceMatrix.array, col = M.instanceColor.array, gl = this.glow, fade = this.fade;
    const e = this._e, q = this._q, m = this._m, P = this._p, S = this._s;
    for (let i = 0; i < n; i++) {
      const left = this.lifeT[i] - this.t[i];
      const k = left < fade ? Math.max(0.001, left / fade) : 1;
      e.set(this.rx[i], this.ry[i], this.rz[i]);
      q.setFromEuler(e);
      P.set(this.px[i], this.py[i] + this.sy[i] * 0.1, this.pz[i]);
      S.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k);
      m.compose(P, q, S);
      m.toArray(arr, i * 16);
      const u = Math.max(0, 1 - this.t[i] / this.glowT[i]), u2 = u * u;
      col[i * 3] = gl[0] * u2; col[i * 3 + 1] = gl[1] * u2 * u; col[i * 3 + 2] = gl[2] * u2 * u2;
    }
    M.instanceMatrix.needsUpdate = true;
    M.instanceColor.needsUpdate = true;
  }

  drawCalls() { return this.mesh && this.mesh.visible ? 1 : 0; }
  meshes(out) { out = out || []; if (this.mesh) out.push(this.mesh); return out; }

  clear() {
    this.state.fill(0);
    this.n = 0;
    this.nodes.length = 0;
    this.stats.live = 0; this.stats.nodes = 0;
    if (this.mesh) { this.mesh.count = 0; this.mesh.visible = false; }
  }

  dispose() {
    this.clear();
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose(); this.mesh.material.dispose();
      if (this.mesh.dispose) this.mesh.dispose();
      this.mesh = null;
      this.stats.disposed += 2;
    }
    this.disposed = true;
  }

  static now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
};
MR.Debris.CAP = 48;
MR.Debris.KIT = { size: [0.4, 1.0], speed: [6, 16], up: [5, 12], inherit: 0.4, spin: 8, n: [2, 4] };
MR.Debris.FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'rx', 'ry', 'rz', 'wx', 'wy', 'wz', 'sx', 'sy', 'sz', 't', 'lifeT', 'glowT', 'floor', 'floorW', 'state', 'bnc'];
