// 煙の帯（MR.Trails）。ミサイル（missile.js）・ロケット（weapons2）の煙の尾を全部で 1 つの形 = 1 回の描画にする。
//   MR.Puffs（下）= 板の煙・爆発・炎・火の粉（E3.0。weapons2 M1 の §4.1 と同じ形）
//   new MR.Trails(scene, { slots, points }) … slots 本の帯、1 本あたり points 個の点（輪の形の記録。古い点から上書き）。
//   alloc({ every, width, life, alpha }) → 帯の番号（空きが無ければ -1）。emit(i, x, y, z, dt) … 毎フレーム呼ぶ: 先頭の点は今の位置、
//   every 秒ごとに点を足す。release(i) … もう足さない（残った点が life 秒で消えたら空きに戻る）。update(dt, camPos) … 点を古くして、
//   カメラに向けた帯の頂点を書く（新しく物を作らない）。clear() / dispose()。stats { live, slots, created, disposed }
//   メッシュは frustumCulled = false（形の外接球は原点の近くなので、遠くの帯が消える。r128）
window.MR = window.MR || {};

MR.Trails = class Trails {
  constructor(scene, cfg) {
    cfg = cfg || {};
    this.scene = scene;
    this.slots = Math.max(1, cfg.slots | 0 || 16);
    this.points = Math.max(3, cfg.points | 0 || 24);
    const S = this.slots, P = this.points;
    // 点: x, y, z, 年齢（秒）。輪の記録（head = 次に書く所、n = 点の数）
    this._pt = new Float32Array(S * P * 4);
    this._head = new Int32Array(S);
    this._n = new Int32Array(S);
    this._state = new Uint8Array(S); // 0 空き 1 出している 2 消えるのを待つ
    this._t = new Float32Array(S);
    this._style = [];
    for (let i = 0; i < S; i++) this._style.push({ every: 0.04, width: 0.9, life: 2.2, alpha: 0.55 });
    this.stats = { live: 0, slots: S, created: 0, disposed: 0 };
    this.mesh = null;
  }

  _build() {
    if (this.mesh) return;
    const S = this.slots, P = this.points, nv = S * P * 2;
    const g = new THREE.BufferGeometry();
    this._pos = new Float32Array(nv * 3);
    this._alpha = new Float32Array(nv);
    g.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this._alpha, 1));
    const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(S * (P - 1) * 6);
    let o = 0;
    for (let s = 0; s < S; s++) for (let j = 0; j < P - 1; j++) {
      const a = (s * P + j) * 2, b = a + 2;
      idx[o++] = a; idx[o++] = a + 1; idx[o++] = b; idx[o++] = a + 1; idx[o++] = b + 1; idx[o++] = b;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.attributes.position.setUsage && g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    g.attributes.aAlpha.setUsage && g.attributes.aAlpha.setUsage(THREE.DynamicDrawUsage);
    const col = MR.srgb ? MR.srgb('#cfcac2') : new THREE.Color(0.8, 0.78, 0.75);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: col } }]);
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: [
        'attribute float aAlpha;', 'varying float vA;', '#include <fog_pars_vertex>',
        'void main() {', '  vA = aAlpha;', '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);', '  gl_Position = projectionMatrix * mvPosition;', '  #include <fog_vertex>', '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;', 'varying float vA;', '#include <fog_pars_fragment>',
        'void main() {', '  if (vA <= 0.003) discard;', '  gl_FragColor = vec4(uColor, vA);', '  #include <fog_fragment>', '}'
      ].join('\n')
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.name = 'trails';
    this.scene.add(this.mesh);
    this.stats.created++;
  }

  alloc(style) {
    for (let i = 0; i < this.slots; i++) {
      if (this._state[i]) continue;
      this._state[i] = 1; this._head[i] = 0; this._n[i] = 0; this._t[i] = 0;
      const st = this._style[i];
      st.every = style && style.every > 0 ? style.every : 0.04;
      st.width = style && style.width > 0 ? style.width : 0.9;
      st.life = style && style.life > 0 ? style.life : 2.2;
      st.alpha = style && style.alpha > 0 ? style.alpha : 0.55;
      this.stats.live++;
      this._build();
      return i;
    }
    return -1;
  }

  _add(i, x, y, z) {
    const P = this.points, b = (i * P + this._head[i]) * 4, pt = this._pt;
    pt[b] = x; pt[b + 1] = y; pt[b + 2] = z; pt[b + 3] = 0;
    this._head[i] = (this._head[i] + 1) % P;
    if (this._n[i] < P) this._n[i]++;
  }

  emit(i, x, y, z, dt) {
    if (i < 0 || i >= this.slots || this._state[i] !== 1) return;
    const st = this._style[i];
    this._t[i] -= dt || 0;
    if (this._n[i] === 0 || this._t[i] <= 0) {
      // 新しい点（先頭は次の点ができるまで今の位置へ動かす）
      if (this._n[i] === 0) this._add(i, x, y, z);
      this._add(i, x, y, z);
      this._t[i] = st.every;
    } else {
      const P = this.points, last = (i * P + (this._head[i] + P - 1) % P) * 4;
      this._pt[last] = x; this._pt[last + 1] = y; this._pt[last + 2] = z;
    }
  }

  // weapons2 の書き方（trails.push(slot, p)。p = { x, y, z }）
  push(i, p, dt) { this.emit(i, p.x, p.y, p.z, dt); }

  release(i) {
    if (i < 0 || i >= this.slots || this._state[i] !== 1) return;
    this._state[i] = 2;
  }

  update(dt, cam) {
    if (!this.mesh) return;
    const S = this.slots, P = this.points, pt = this._pt, pos = this._pos, al = this._alpha;
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0;
    let any = false;
    for (let i = 0; i < S; i++) {
      const vb = i * P * 2;
      const st = this._state[i], n = this._n[i];
      if (!st || !n) {
        // 空き: 頂点を潰す（前のフレームに書いたものを消す）
        if (al[vb] !== 0 || al[vb + 2 * P - 1] !== 0) for (let j = 0; j < 2 * P; j++) al[vb + j] = 0;
        if (st === 2 && !n) { this._state[i] = 0; this.stats.live--; }
        continue;
      }
      const style = this._style[i], life = style.life;
      // 年齢を進める・古すぎる点を落とす
      let alive = 0;
      const start = (this._head[i] + P - n) % P;
      for (let j = 0; j < n; j++) {
        const b = (i * P + (start + j) % P) * 4;
        pt[b + 3] += dt;
        if (pt[b + 3] < life) alive++;
      }
      // 古い順に（年齢が life を超えたものは先頭から抜ける）
      const drop = n - alive;
      const n2 = alive;
      this._n[i] = n2;
      if (st === 2 && n2 === 0) { this._state[i] = 0; this.stats.live--; for (let j = 0; j < 2 * P; j++) al[vb + j] = 0; continue; }
      if (n2 < 2) { for (let j = 0; j < 2 * P; j++) al[vb + j] = 0; continue; }
      any = true;
      const s0 = (start + drop) % P;
      for (let j = 0; j < P; j++) {
        const v = vb + j * 2;
        if (j >= n2) {
          // 使っていない点: 最後の点に重ねて透明
          const lb = (i * P + (s0 + n2 - 1) % P) * 4;
          pos[v * 3] = pos[v * 3 + 3] = pt[lb]; pos[v * 3 + 1] = pos[v * 3 + 4] = pt[lb + 1]; pos[v * 3 + 2] = pos[v * 3 + 5] = pt[lb + 2];
          al[v] = 0; al[v + 1] = 0;
          continue;
        }
        const b = (i * P + (s0 + j) % P) * 4;
        // 帯の向き: 点の並びの向き × カメラへの向き
        const jb = j > 0 ? (i * P + (s0 + j - 1) % P) * 4 : b;
        const jn = j < n2 - 1 ? (i * P + (s0 + j + 1) % P) * 4 : b;
        let tx = pt[jn] - pt[jb], ty = pt[jn + 1] - pt[jb + 1], tz = pt[jn + 2] - pt[jb + 2];
        const ex = cx - pt[b], ey = cy - pt[b + 1], ez = cz - pt[b + 2];
        let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex;
        const sl = Math.hypot(sx, sy, sz);
        const age = pt[b + 3], k = age / life;
        const w = style.width * (0.35 + 1.6 * k) * 0.5;
        if (sl > 1e-6) { sx *= w / sl; sy *= w / sl; sz *= w / sl; } else { sx = w; sy = 0; sz = 0; }
        pos[v * 3] = pt[b] - sx; pos[v * 3 + 1] = pt[b + 1] - sy; pos[v * 3 + 2] = pt[b + 2] - sz;
        pos[v * 3 + 3] = pt[b] + sx; pos[v * 3 + 4] = pt[b + 1] + sy; pos[v * 3 + 5] = pt[b + 2] + sz;
        // 先頭（ミサイルの尾）は薄く始める
        const a = style.alpha * (1 - k) * (j === n2 - 1 ? 0.25 : 1);
        al[v] = a; al[v + 1] = a;
      }
    }
    this.mesh.visible = any;
    if (any) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }

  clear() {
    for (let i = 0; i < this.slots; i++) { this._state[i] = 0; this._n[i] = 0; }
    this.stats.live = 0;
    if (this._alpha) this._alpha.fill(0);
    if (this.mesh) this.mesh.visible = false;
  }

  dispose() {
    this.clear();
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose(); this.mesh.material.dispose();
      this.mesh = null;
      this.stats.disposed++;
    }
  }
};

// 板の煙・爆発・炎・火の粉（MR.Puffs）。アトラスごとに InstancedMesh 1 つ（= 描画 1 回）、カメラに向けたパラパラ漫画の板。
//   new MR.Puffs(scene, cfg, { assets, mobile }) … cfg = game.json の top-level puffs（caps / mobile.caps / nearFade / sortEvery / textureMax / mobileTextureMax）
//   アトラス: smoke（8 × 8、ふつうの合成）・explosion（8 × 8、ふつう）・fire（8 × 8、加算・繰り返し）・ember（1 枚、加算）。
//     画像は assets/textures/fx/{smoke,explosion,fire}_flipbook.png・ember.png を、そのアトラスの最初の 1 個を出したときに読む（アリーナ・メニューは何も読まない）。
//     ファイルが無い・読めない間は Canvas のふんわりした円（MR.FX.makeSoftTexture。1 枚 = 格子 1）。最大辺は textureMax（タッチ端末 mobileTextureMax）
//   spawn(atlas, x, y, z, size, life, o) → 番号（共有の範囲。いっぱいなら共有の一番古いものを使い回す = stats.stolen）
//     o（任意。呼ぶ側が使い回してよい）: { vx, vy, vz, grow（m/s）, rise（上向きの加速 m/s²）, drag（1/s）, rot, spin（rad/s）, alpha, r, g, b（線形の色。
//       既定 1）, fog（その板だけ霧を薄く = 霧の距離 × fog。既定 1。遠くから見える煙の柱）, wind（setWind の風で流れる割合。既定 0）, frame0, fps（0 = life の間に全部のコマ）, loop, fadeIn（秒）, fadeOut（秒。既定 life × 0.3）}
//   reserve(atlas, n) → { atlas, start, n }（その持ち主だけが put(range, k, x, y, z, size, life, o) で書く範囲。共有の spawn は使わない）。
//     reserveMax[atlas]（割合）を超える予約は null。unreserve(range)。liveIn(range)
//   kill(atlas, i)・clear()・setFogScale(atlas, s)（遠くの煙の柱は霧を薄く）・update(dt, camPos)（年を取らせ、sortEvery 秒ごとに奥から手前へ並べ、
//     インスタンスの値を書く。新しく物を作らない）・dispose()
//   stats { live: { smoke, explosion, fire, ember }, stolen, created, disposed }（created / disposed = 形と材質の数）
//   メッシュは frustumCulled = false（r128 の InstancedMesh は形の外接球で消すので、遠くの板が消える）
MR.Puffs = class Puffs {
  constructor(scene, cfg, opts) {
    cfg = cfg || {};
    opts = opts || {};
    this.scene = scene;
    this.cfg = cfg;
    this.assets = opts.assets || null;
    this.mobile = !!opts.mobile;
    const caps = Object.assign({}, Puffs.CAPS, cfg.caps || {}, (this.mobile && cfg.mobile && cfg.mobile.caps) || {});
    const nf = Object.assign({}, Puffs.NEAR_FADE, cfg.nearFade || {});
    const rmax = cfg.reserveMax || {};
    this.sortEvery = cfg.sortEvery > 0 ? cfg.sortEvery : 0.1;
    this.textureMax = (this.mobile ? cfg.mobileTextureMax : cfg.textureMax) || (this.mobile ? 512 : 1024);
    this.stats = { live: {}, stolen: 0, created: 0, disposed: 0 };
    this.atlases = {};
    this._seq = 1;
    this._sortT = 0;
    this.windX = 0; this.windZ = 0; // 風（m/s）。o.wind（割合）の板だけ流れる（destruct-3 の土ぼこり。setWind）
    for (const name of Puffs.ATLASES) {
      const def = Puffs.DEFS[name];
      const cap = Math.max(1, caps[name] | 0);
      this.stats.live[name] = 0;
      this.atlases[name] = {
        name, def, cap, nearFade: nf[name] || 0, reserveMax: rmax[name] > 0 ? rmax[name] : 0.7,
        // 板ごとの状態
        px: new Float32Array(cap), py: new Float32Array(cap), pz: new Float32Array(cap),
        vx: new Float32Array(cap), vy: new Float32Array(cap), vz: new Float32Array(cap),
        size: new Float32Array(cap), grow: new Float32Array(cap), rise: new Float32Array(cap), drag: new Float32Array(cap),
        rot: new Float32Array(cap), spin: new Float32Array(cap), age: new Float32Array(cap), life: new Float32Array(cap),
        alpha: new Float32Array(cap), cr: new Float32Array(cap), cg: new Float32Array(cap), cb: new Float32Array(cap),
        frame0: new Float32Array(cap), fps: new Float32Array(cap), fadeIn: new Float32Array(cap), fadeOut: new Float32Array(cap),
        fog: new Float32Array(cap), wind: new Float32Array(cap), loop: new Uint8Array(cap), live: new Uint8Array(cap), inOrder: new Uint8Array(cap), reserved: new Uint8Array(cap), born: new Uint32Array(cap),
        // 描く順（生きている番号の並び）と奥行き
        order: new Int32Array(cap), nOrder: 0, depth: new Float32Array(cap),
        mesh: null, tex: null, texOwned: false, loading: false, loaded: false, fogScale: 1, nReserved: 0
      };
    }
  }

  // ---------- 作る ----------
  _ensure(A) {
    if (A.mesh) return;
    const def = A.def, cap = A.cap;
    const g = new THREE.PlaneBufferGeometry(1, 1);
    const fr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const al = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const tn = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const ro = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const fg = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    for (const at of [fr, al, tn, ro, fg]) if (at.setUsage) at.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFrame', fr); g.setAttribute('aAlpha', al); g.setAttribute('aTint', tn); g.setAttribute('aRot', ro); g.setAttribute('aFog', fg);
    A.tex = Puffs._fallback(A.name);
    A.texOwned = true;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null }, uGrid: { value: 1 }, uNearFade: { value: A.nearFade }, uFogScale: { value: A.fogScale }
    }]);
    uniforms.map.value = A.tex;
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false,
      blending: def.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: def.add ? { PUFF_ADD: 1 } : {},
      vertexShader: Puffs.VERT, fragmentShader: Puffs.FRAG
    });
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = def.add ? 4 : 3;
    mesh.visible = false;
    mesh.name = 'puffs_' + A.name;
    this.scene.add(mesh);
    A.mesh = mesh;
    this.stats.created += 2; // 形 + 材質
    this._loadTex(A);
  }

  // 画像（あれば）。最初の 1 個を出したときに 1 回だけ
  _loadTex(A) {
    const a = this.assets;
    if (A.loading || !a || typeof a.resolve !== 'function' || typeof a.loadTexture !== 'function') return;
    const key = a.resolve('textures/fx/' + A.def.file);
    if (!key) return;
    A.loading = true;
    let p;
    try { p = Promise.resolve(a.loadTexture(key, { srgb: false, wrap: THREE.ClampToEdgeWrapping, maxSize: this.textureMax })); } catch (e) { p = Promise.reject(e); }
    p.then((t) => {
      if (!t || !A.mesh || this._disposed) return;
      const u = A.mesh.material.uniforms;
      if (A.texOwned && A.tex) A.tex.dispose();
      A.tex = t; A.texOwned = false; A.loaded = true;
      u.map.value = t;
      u.uGrid.value = A.def.grid;
    }, (e) => { console.warn('[Puffs] 読めません:', A.def.file, e && e.message); });
  }

  static _fallback(name) {
    const col = Puffs.DEFS[name].fallback;
    if (MR.FX && MR.FX.makeSoftTexture && typeof document !== 'undefined') {
      const t = MR.FX.makeSoftTexture(col);
      t.encoding = THREE.LinearEncoding; // シェーダーが sRGB → 線形にする
      return t;
    }
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }

  // ---------- 出す ----------
  _put(A, i, x, y, z, size, life, o) {
    if (!A.live[i]) { A.live[i] = 1; this.stats.live[A.name]++; }
    if (!A.inOrder[i]) { A.inOrder[i] = 1; A.order[A.nOrder++] = i; }
    A.px[i] = x; A.py[i] = y; A.pz[i] = z;
    A.vx[i] = o && o.vx || 0; A.vy[i] = o && o.vy || 0; A.vz[i] = o && o.vz || 0;
    A.size[i] = size > 0 ? size : 1; A.life[i] = life > 0 ? life : 1; A.age[i] = 0;
    A.grow[i] = o && o.grow || 0; A.rise[i] = o && o.rise || 0; A.drag[i] = o && o.drag || 0;
    A.rot[i] = o && o.rot || 0; A.spin[i] = o && o.spin || 0;
    A.alpha[i] = o && o.alpha != null ? o.alpha : 1;
    A.cr[i] = o && o.r != null ? o.r : 1; A.cg[i] = o && o.g != null ? o.g : 1; A.cb[i] = o && o.b != null ? o.b : 1;
    A.fog[i] = o && o.fog > 0 ? o.fog : 1;
    A.wind[i] = o && o.wind > 0 ? o.wind : 0;
    A.frame0[i] = o && o.frame0 || 0; A.fps[i] = o && o.fps || 0; A.loop[i] = o && o.loop ? 1 : 0;
    A.fadeIn[i] = o && o.fadeIn != null ? o.fadeIn : 0.06;
    A.fadeOut[i] = o && o.fadeOut != null ? o.fadeOut : A.life[i] * 0.3;
    A.born[i] = this._seq++;
    return i;
  }

  spawn(atlas, x, y, z, size, life, o) {
    const A = this.atlases[atlas];
    if (!A) return -1;
    this._ensure(A);
    let free = -1, old = -1, oldB = 0xffffffff;
    for (let i = 0; i < A.cap; i++) {
      if (A.reserved[i]) continue;
      if (!A.live[i]) { free = i; break; }
      if (A.born[i] < oldB) { oldB = A.born[i]; old = i; }
    }
    if (free < 0) { if (old < 0) return -1; free = old; this.stats.stolen++; }
    return this._put(A, free, x, y, z, size, life, o);
  }

  reserve(atlas, n) {
    const A = this.atlases[atlas];
    n = n | 0;
    if (!A || n <= 0 || A.nReserved + n > Math.floor(A.cap * A.reserveMax)) return null;
    // 後ろから n 個続けて空いている（予約されていない）所
    let end = A.cap;
    while (end >= n) {
      let ok = true, k = end - 1;
      for (; k >= end - n; k--) if (A.reserved[k]) { ok = false; break; }
      if (ok) break;
      end = k;
    }
    if (end < n) return null;
    const start = end - n;
    for (let i = start; i < end; i++) { if (A.live[i]) this._kill(A, i); A.reserved[i] = 1; }
    A.nReserved += n;
    this._ensure(A);
    return { atlas, start, n };
  }

  unreserve(range) {
    const A = range && this.atlases[range.atlas];
    if (!A || !range.n) return;
    for (let i = range.start; i < range.start + range.n; i++) { if (A.live[i]) this._kill(A, i); A.reserved[i] = 0; }
    A.nReserved -= range.n;
    range.n = 0;
  }

  // 予約した範囲の k 番目に書く
  put(range, k, x, y, z, size, life, o) {
    const A = range && this.atlases[range.atlas];
    if (!A || k < 0 || k >= range.n) return -1;
    this._ensure(A);
    return this._put(A, range.start + k, x, y, z, size, life, o);
  }

  liveIn(range) {
    const A = range && this.atlases[range.atlas];
    if (!A) return 0;
    let n = 0;
    for (let i = range.start; i < range.start + range.n; i++) if (A.live[i]) n++;
    return n;
  }

  _kill(A, i) {
    if (!A.live[i]) return;
    A.live[i] = 0;
    this.stats.live[A.name]--;
    // order からは update で外す
  }
  setWind(x, z) { this.windX = x || 0; this.windZ = z || 0; }
  kill(atlas, i) { const A = this.atlases[atlas]; if (A && i >= 0 && i < A.cap) this._kill(A, i); }

  setFogScale(atlas, s) {
    const A = this.atlases[atlas];
    if (!A) return;
    A.fogScale = s;
    if (A.mesh) A.mesh.material.uniforms.uFogScale.value = s;
  }

  // ---------- 毎フレーム ----------
  update(dt, cam) {
    dt = dt > 0 ? dt : 0;
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 0, cz = cam ? cam.z : 0;
    this._sortT -= dt;
    const sortNow = this._sortT <= 0;
    if (sortNow) this._sortT = this.sortEvery;
    for (const name of Puffs.ATLASES) {
      const A = this.atlases[name];
      if (!A.mesh) continue;
      // 年を取らせる・動かす・消えたものを order から外す
      let n = 0;
      const order = A.order;
      for (let k = 0; k < A.nOrder; k++) {
        const i = order[k];
        if (!A.live[i]) { A.inOrder[i] = 0; continue; }
        const age = A.age[i] + dt;
        if (age >= A.life[i]) { this._kill(A, i); A.inOrder[i] = 0; continue; }
        A.age[i] = age;
        if (A.drag[i] > 0) { const f = Math.exp(-A.drag[i] * dt); A.vx[i] *= f; A.vy[i] *= f; A.vz[i] *= f; }
        A.vy[i] += A.rise[i] * dt;
        A.px[i] += A.vx[i] * dt; A.py[i] += A.vy[i] * dt; A.pz[i] += A.vz[i] * dt;
        if (A.wind[i] > 0) { A.px[i] += this.windX * A.wind[i] * dt; A.pz[i] += this.windZ * A.wind[i] * dt; }
        A.size[i] = Math.max(0.01, A.size[i] + A.grow[i] * dt);
        A.rot[i] += A.spin[i] * dt;
        order[n++] = i;
      }
      A.nOrder = n;
      const mesh = A.mesh;
      if (!n) { if (mesh.visible) { mesh.visible = false; mesh.count = 0; } continue; }
      // 奥から手前へ（ふつうの合成だけ。ほぼ並んでいるので挿入ソート）
      if (sortNow && !A.def.add && n > 1) {
        const dp = A.depth;
        for (let k = 0; k < n; k++) { const i = order[k]; const dx = A.px[i] - cx, dy = A.py[i] - cy, dz = A.pz[i] - cz; dp[i] = dx * dx + dy * dy + dz * dz; }
        for (let k = 1; k < n; k++) {
          const i = order[k], d = dp[i];
          let j = k - 1;
          while (j >= 0 && dp[order[j]] < d) { order[j + 1] = order[j]; j--; }
          order[j + 1] = i;
        }
      }
      const m = mesh.instanceMatrix.array, ga = mesh.geometry.attributes;
      const fr = ga.aFrame.array, al = ga.aAlpha.array, tn = ga.aTint.array, ro = ga.aRot.array, fg = ga.aFog.array;
      const frames = A.def.grid * A.def.grid;
      for (let k = 0; k < n; k++) {
        const i = order[k], b = k * 16, s = A.size[i];
        m[b] = s; m[b + 1] = 0; m[b + 2] = 0; m[b + 3] = 0;
        m[b + 4] = 0; m[b + 5] = s; m[b + 6] = 0; m[b + 7] = 0;
        m[b + 8] = 0; m[b + 9] = 0; m[b + 10] = s; m[b + 11] = 0;
        m[b + 12] = A.px[i]; m[b + 13] = A.py[i]; m[b + 14] = A.pz[i]; m[b + 15] = 1;
        const age = A.age[i], life = A.life[i];
        let f = A.fps[i] > 0 ? A.frame0[i] + age * A.fps[i] : A.frame0[i] + age / life * frames;
        if (A.loop[i]) f = f % frames; else if (f > frames - 1) f = frames - 1;
        fr[k] = A.loaded ? f : 0;
        const fi = A.fadeIn[i] > 0 ? Math.min(1, age / A.fadeIn[i]) : 1;
        const fo = A.fadeOut[i] > 0 ? Math.min(1, (life - age) / A.fadeOut[i]) : 1;
        al[k] = A.alpha[i] * fi * fo;
        tn[k * 3] = A.cr[i]; tn[k * 3 + 1] = A.cg[i]; tn[k * 3 + 2] = A.cb[i];
        ro[k] = A.rot[i];
        fg[k] = A.fog[i];
      }
      mesh.count = n;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      ga.aFrame.needsUpdate = true; ga.aAlpha.needsUpdate = true; ga.aTint.needsUpdate = true; ga.aRot.needsUpdate = true; ga.aFog.needsUpdate = true;
    }
  }

  // 描いている板の数（テスト・デバッグ）
  drawCalls() {
    let n = 0;
    for (const name of Puffs.ATLASES) { const A = this.atlases[name]; if (A.mesh && A.mesh.visible) n++; }
    return n;
  }
  meshes(out) {
    out = out || [];
    for (const name of Puffs.ATLASES) { const A = this.atlases[name]; if (A.mesh) out.push(A.mesh); }
    return out;
  }

  clear() {
    for (const name of Puffs.ATLASES) {
      const A = this.atlases[name];
      for (let i = 0; i < A.cap; i++) if (A.live[i]) this._kill(A, i);
      A.nOrder = 0; A.inOrder.fill(0);
      if (A.mesh) { A.mesh.count = 0; A.mesh.visible = false; }
    }
  }

  dispose() {
    this.clear();
    this._disposed = true;
    for (const name of Puffs.ATLASES) {
      const A = this.atlases[name];
      if (!A.mesh) continue;
      if (A.mesh.parent) A.mesh.parent.remove(A.mesh);
      A.mesh.geometry.dispose(); A.mesh.material.dispose();
      if (A.mesh.dispose) A.mesh.dispose();
      if (A.tex) A.tex.dispose(); // 読み込んだ画像は assets のキャッシュに残る（GPU だけ捨てる。使えば上げ直す）
      A.tex = null; A.mesh = null;
      this.stats.disposed += 2;
    }
  }
};
MR.Puffs.ATLASES = ['smoke', 'explosion', 'fire', 'ember'];
MR.Puffs.DEFS = {
  smoke: { file: 'smoke_flipbook.png', grid: 8, add: false, fallback: '#8f8b86' },
  explosion: { file: 'explosion_flipbook.png', grid: 8, add: false, fallback: '#ff9a3c' },
  fire: { file: 'fire_flipbook.png', grid: 8, add: true, fallback: '#ff8a2a' },
  ember: { file: 'ember.png', grid: 1, add: true, fallback: '#ffc46a' }
};
MR.Puffs.CAPS = { smoke: 160, explosion: 48, fire: 192, ember: 96 };
MR.Puffs.NEAR_FADE = { smoke: 2, explosion: 2, fire: 6, ember: 6 };
MR.Puffs.VERT = [
  'attribute float aFrame;', 'attribute float aAlpha;', 'attribute vec3 aTint;', 'attribute float aRot;', 'attribute float aFog;',
  'uniform float uGrid;', 'uniform float uNearFade;', 'uniform float uFogScale;',
  'varying vec2 vUv;', 'varying float vA;', 'varying vec3 vTint;',
  '#include <fog_pars_vertex>',
  'void main() {',
  '  vec3 c = vec3(instanceMatrix[3]);',
  '  float s = length(vec3(instanceMatrix[0]));',
  '  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);',
  '  float cr = cos(aRot), sr = sin(aRot);',
  '  mvPosition.xy += vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * s;',
  '  float f = floor(aFrame + 0.001);',
  '  float col = mod(f, uGrid), row = floor(f / uGrid);',
  '  vUv = (vec2(col, uGrid - 1.0 - row) + uv) / uGrid;',
  '  float dist = -mvPosition.z;',
  '  vA = aAlpha * (uNearFade > 0.0 ? clamp((dist - s * 0.25) / uNearFade, 0.0, 1.0) : 1.0);',
  '  vTint = aTint;',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '  #ifdef USE_FOG', '  fogDepth *= uFogScale * aFog;', '  #endif',
  '}'
].join('\n');
MR.Puffs.FRAG = [
  'uniform sampler2D map;',
  'varying vec2 vUv;', 'varying float vA;', 'varying vec3 vTint;',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  vec4 t = texture2D(map, vUv);',
  '  float a = t.a * vA;',
  '  if (a <= 0.003) discard;',
  '  gl_FragColor = vec4(pow(t.rgb, vec3(2.2)) * vTint, a);', // 画像は sRGB（線形にしてから。後でガンマ補正のパス）
  '  #ifdef PUFF_ADD',
  '  #ifdef USE_FOG',
  '  #ifdef FOG_EXP2',
  '  float fogFactor = 1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth);',
  '  #else',
  '  float fogFactor = smoothstep(fogNear, fogFar, fogDepth);',
  '  #endif',
  '  gl_FragColor.a *= 1.0 - fogFactor;', // 加算は霧の色を足さずに消える
  '  #endif',
  '  #else',
  '  #include <fog_fragment>',
  '  #endif',
  '}'
].join('\n');
