// 船の見た目（boats 計画 §5.2.6〜9）。
//   MR.Wakes   航跡: 1 つの BufferGeometry（輪のバッファ: wakePoints 個の帯。1 回の描画）。emit(x, z, px, pz, w0, spread, strength, life) で
//              船尾の点と横向き (px, pz) を足すと、シェーダーが年齢で横へ広げ（V の腕）、薄くして消す。水面の少し上（renderOrder 1・depthWrite なし）。
//              カメラから emitDist m より遠い所は足さない。frustumCulled = false（世界の座標で km にわたる）
//   MR.Spray   しぶき: 1 つの THREE.Points（sprayMax 粒、CPU で放物線。1 回の描画）。emit(x, y, z, vx, vy, vz)
//   MR.ShipsView 船の交通の見た目（M2: 近い船は GLB の複製・遠い船は種類ごとに InstancedMesh、窓の明かり、船の音）
window.MR = window.MR || {};

(function () {
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

  // ---------- 航跡 ----------
  const WAKE_VERT = `
    attribute vec4 aOP;      // 原点 xz・横向き xz
    attribute vec4 aParam;   // 生まれた時刻・最初の幅・広がり（m/s）・強さ
    attribute vec4 aCorner;  // 横（-1..1）・前後（-1..1）・寿命・前後の半分の長さ（m）
    uniform float uTime;
    uniform float uY;
    varying vec2 vUv;
    varying float vFade;
    varying vec2 vWorld;
    #include <fog_pars_vertex>
    void main() {
      float age = uTime - aParam.x;
      float life = aCorner.z;
      float u = clamp(age / max(0.01, life), 0.0, 1.0);
      float w = aParam.y + aParam.z * age * 2.2;
      vec2 perp = aOP.zw;
      vec2 dir = vec2(-perp.y, perp.x);
      float len = aCorner.w + age * 0.15;
      vec2 p = aOP.xy + perp * aCorner.x * w + dir * aCorner.y * len;
      vec4 mvPosition = modelViewMatrix * vec4(p.x, uY, p.y, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      vUv = aCorner.xy;
      vWorld = p;
      vFade = (age < 0.0 || age > life) ? 0.0 : aParam.w * pow(1.0 - u, 1.6) * smoothstep(0.0, 0.25, age);
      #include <fog_vertex>
    }`;
  const WAKE_FRAG = `
    varying vec2 vUv;
    varying float vFade;
    varying vec2 vWorld;
    uniform vec3 uColor;
    #include <fog_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      if (vFade <= 0.001) discard;
      float s = abs(vUv.x);
      float arm = smoothstep(0.5, 0.88, s) * (1.0 - smoothstep(0.9, 1.0, s));
      float mid = (1.0 - smoothstep(0.0, 0.45, s)) * 0.75;
      float along = 1.0 - smoothstep(0.75, 1.0, abs(vUv.y));
      float n = noise(vWorld * 0.45) * 0.6 + noise(vWorld * 1.7) * 0.4;
      float a = (arm * 1.0 + mid) * along * vFade * (0.55 + 0.6 * n);
      a = min(a, 0.85);
      // 霧は色ではなく濃さで（重ねる白い泡が遠くで霧の色の暗い斑にならない）
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          a *= exp(-fogDensity * fogDensity * fogDepth * fogDepth);
        #else
          a *= 1.0 - smoothstep(fogNear, fogFar, fogDepth);
        #endif
      #endif
      if (a < 0.01) discard;
      gl_FragColor = vec4(uColor, a);
    }`;

  class Wakes {
    constructor(scene, opts) {
      opts = opts || {};
      this.scene = scene;
      this.n = Math.max(64, Math.round(num(opts.points, 1536)));
      this.y = num(opts.y, -2) + 0.1; // 水面の板は 16 km の 1 枚なので深度の精度が粗い（3 cm では水面に負ける）
      this.emitDist = num(opts.emitDist, 600);
      this.time = 0;
      this.head = 0;
      this.count = 0;
      const N = this.n, V = N * 4;
      const op = new Float32Array(V * 4), par = new Float32Array(V * 4), cor = new Float32Array(V * 4);
      const idx = new (V > 65535 ? Uint32Array : Uint16Array)(N * 6);
      for (let i = 0; i < N; i++) {
        const b = i * 4;
        const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let k = 0; k < 4; k++) { cor[(b + k) * 4] = C[k][0]; cor[(b + k) * 4 + 1] = C[k][1]; cor[(b + k) * 4 + 2] = 1; cor[(b + k) * 4 + 3] = 1; par[(b + k) * 4] = -1e6; }
        idx[i * 6] = b; idx[i * 6 + 1] = b + 2; idx[i * 6 + 2] = b + 1; idx[i * 6 + 3] = b; idx[i * 6 + 4] = b + 3; idx[i * 6 + 5] = b + 2;
      }
      const geo = new THREE.BufferGeometry();
      this.aOP = new THREE.BufferAttribute(op, 4); this.aOP.setUsage(THREE.DynamicDrawUsage);
      this.aParam = new THREE.BufferAttribute(par, 4); this.aParam.setUsage(THREE.DynamicDrawUsage);
      this.aCorner = new THREE.BufferAttribute(cor, 4); this.aCorner.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
      geo.setAttribute('aOP', this.aOP); geo.setAttribute('aParam', this.aParam); geo.setAttribute('aCorner', this.aCorner);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      this.geo = geo;
      this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uY: { value: this.y }, uColor: { value: MR.srgb ? MR.srgb('#e6eff2') : new THREE.Color(0.9, 0.93, 0.95) } }]);
      this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      this.material.name = 'wakes';
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.name = 'wakes';
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 1;
      this.mesh.matrixAutoUpdate = false;
      scene.add(this.mesh);
      this._lo = Infinity; this._hi = -1;
      this.cam = null;
      this.stats = { emitted: 0, culled: 0 };
    }
    setCamera(p) { this.cam = p; }
    emit(x, z, px, pz, w0, spread, strength, life, len) {
      if (this.cam) {
        const dx = x - this.cam.x, dz = z - this.cam.z;
        if (dx * dx + dz * dz > this.emitDist * this.emitDist) { this.stats.culled++; return; }
      }
      const i = this.head;
      this.head = (this.head + 1) % this.n;
      if (this.count < this.n) this.count++;
      const b = i * 4, op = this.aOP.array, par = this.aParam.array, cor = this.aCorner.array;
      const L = Math.hypot(px, pz) || 1;
      for (let k = 0; k < 4; k++) {
        const o = (b + k) * 4;
        op[o] = x; op[o + 1] = z; op[o + 2] = px / L; op[o + 3] = pz / L;
        par[o] = this.time; par[o + 1] = w0; par[o + 2] = spread; par[o + 3] = strength;
        cor[(b + k) * 4 + 2] = life; cor[(b + k) * 4 + 3] = len || 1.1;
      }
      if (i < this._lo) this._lo = i;
      if (i > this._hi) this._hi = i;
      this.stats.emitted++;
    }
    update(dt) {
      this.time += dt;
      this.uniforms.uTime.value = this.time;
      if (this._hi >= 0) {
        const lo = this._lo, hi = this._hi;
        for (const a of [this.aOP, this.aParam]) { a.updateRange.offset = lo * 16; a.updateRange.count = (hi - lo + 1) * 16; a.needsUpdate = true; }
        this.aCorner.updateRange.offset = lo * 16; this.aCorner.updateRange.count = (hi - lo + 1) * 16; this.aCorner.needsUpdate = true;
        this._lo = Infinity; this._hi = -1;
      }
    }
    // 生きている帯の数
    live() {
      let n = 0;
      const par = this.aParam.array, cor = this.aCorner.array;
      for (let i = 0; i < this.n; i++) if (this.time - par[i * 16] < cor[i * 16 + 2]) n++;
      return n;
    }
    dispose() {
      this.scene.remove(this.mesh);
      this.geo.dispose(); this.material.dispose();
    }
  }

  // ---------- しぶき ----------
  class Spray {
    constructor(scene, opts) {
      opts = opts || {};
      this.scene = scene;
      this.max = Math.max(8, Math.round(num(opts.max, 128)));
      this.life = num(opts.life, 1.1);
      this.y = num(opts.y, -2);
      const N = this.max;
      this.pos = new Float32Array(N * 3);
      this.vel = new Float32Array(N * 3);
      this.age = new Float32Array(N).fill(1e9);
      for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -1e4;
      const geo = new THREE.BufferGeometry();
      this.attr = new THREE.BufferAttribute(this.pos, 3); this.attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', this.attr);
      this.geo = geo;
      let map = null;
      try { if (MR.FX && MR.FX.makeSoftTexture && typeof document !== 'undefined') map = MR.FX.makeSoftTexture('#eef5f7'); } catch (e) { map = null; }
      this.material = new THREE.PointsMaterial({ size: num(opts.size, 0.22), sizeAttenuation: true, map, transparent: true, depthWrite: false, opacity: 0.8, color: 0xffffff });
      this.material.name = 'spray';
      this.points = new THREE.Points(geo, this.material);
      this.points.name = 'spray';
      this.points.frustumCulled = false;
      this.points.renderOrder = 2;
      this.points.matrixAutoUpdate = false;
      scene.add(this.points);
      this.head = 0;
      this.alive = 0;
    }
    emit(x, y, z, vx, vy, vz) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.age[i] = 0;
    }
    update(dt) {
      let alive = 0;
      const P = this.pos, V = this.vel, A = this.age, g = 9.8 * dt;
      for (let i = 0; i < this.max; i++) {
        if (A[i] > this.life) continue;
        A[i] += dt;
        const k = i * 3;
        V[k + 1] -= g;
        P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
        if (A[i] > this.life || P[k + 1] < this.y - 0.2) { A[i] = 1e9; P[k + 1] = -1e4; continue; }
        alive++;
      }
      this.alive = alive;
      if (alive || this._was) this.attr.needsUpdate = true;
      this._was = alive > 0;
    }
    dispose() { this.scene.remove(this.points); this.geo.dispose(); if (this.material.map) this.material.map.dispose(); this.material.dispose(); }
  }

  // ---------- 船の交通の見た目 ----------
  // 種類ごと: detail（boats.glb の船の複製。近い maxDetailShips 隻まで、detailDist m の中）と far（全部のメッシュを 1 つにまとめた形 +
  // 頂点色。InstancedMesh 1 つ = 1 回の描画）。GLB が無ければ ships.json の箱を色で塗った形（どちらにも使う）。
  // LOD は lodHz 回/秒に ±10 % の幅で入れ替え。帆船は見た目だけ傾ける（heel）。窓の発光は windowEmissive。
  class ShipsView {
    // opts: { assets, shipping, render（render.boats）, data（ships.json） }
    constructor(scene, opts) {
      this.scene = scene;
      this.shipping = opts.shipping;
      this.cfg = Object.assign({ detailDist: 450, maxDetailShips: 4, lodHz: 4, windowEmissive: 1.4, shipShadows: false, farDist: 2600 }, opts.render || {});
      this.data = opts.data || { types: {} };
      this.assets = opts.assets || null;
      this.types = {};      // typeId → { detail: [pool], far: InstancedMesh, glb }
      this.source = 'procedural';
      this.group = new THREE.Group();
      this.group.name = 'ships';
      scene.add(this.group);
      this._lodT = 0;
      this._detail = new Map(); // entry → object
      this._tmpM = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
      this.stats = { detail: 0, far: 0, swaps: 0 };
      this._disposables = [];
      for (const e of this.shipping.list) if (!this.types[e.typeId]) this._initType(e.typeId, null);
      this._loadGlb();
    }
    _initType(typeId, scene) {
      const old = this.types[typeId];
      if (old) this._disposeType(old);
      const td = this.data.types[typeId];
      const count = this.shipping.list.filter((e) => e.typeId === typeId).length;
      let far, makeDetail;
      if (scene) {
        const node = scene.getObjectByName(typeId);
        if (node) {
          far = ShipsView.mergeNode(node, typeId);
          makeDetail = () => { const c = node.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.traverse((o) => { if (o.isMesh) { o.castShadow = !!this.cfg.shipShadows; o.receiveShadow = true; } }); return c; };
        }
      }
      if (!far) {
        far = ShipsView.boxGeometry(td);
        makeDetail = null;
      }
      const farMat = scene ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
      farMat.name = 'boat_far';
      const im = new THREE.InstancedMesh(far, farMat, Math.max(1, count));
      im.name = 'ships_far:' + typeId;
      im.count = 0; im.visible = false;
      im.frustumCulled = false; // 世界じゅうの船を 1 つで描くので、形の囲みでは切れない（数が少ないので切らない）
      im.castShadow = !!this.cfg.shipShadows; im.receiveShadow = true;
      this.group.add(im);
      this._disposables.push(far, farMat);
      this.types[typeId] = { far: im, farGeo: far, farMat, makeDetail, pool: [], td };
    }
    _disposeType(T) {
      this.group.remove(T.far);
      for (const o of T.pool) this.group.remove(o);
      T.pool.length = 0;
    }
    _loadGlb() {
      const a = this.assets;
      if (!a || typeof a.loadModel !== 'function' || typeof a.resolve !== 'function') return;
      const key = a.resolve('models/boats.glb');
      if (!key) return;
      this.ready = Promise.resolve().then(() => a.loadModel(key)).then((res) => {
        const scene = res && res.scene;
        if (!scene || this.disposed) return;
        const emi = this.cfg.windowEmissive;
        scene.traverse((o) => { if (o.isMesh && o.material && /boat_windows|ship_cabins/.test(o.material.name || '')) o.material.emissiveIntensity = emi; });
        for (const typeId in this.types) this._initType(typeId, scene);
        this._detail.clear();
        this.source = 'glb';
        this._lodT = 0;
      }).catch((e) => { console.warn('[ShipsView] boats.glb を読めません。箱の船で続けます:', e && e.message); });
    }

    // 船（ルート）の全部のメッシュを 1 つの形に（位置・法線・頂点色。ガラスは除く）。頂点色は COLOR_0 × 材質の色
    static mergeNode(node, typeId) {
      node.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      const geos = [];
      node.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (mat && (mat.transparent || /glass/.test(mat.name || '') || /glass/.test(o.name))) return;
        const g = o.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        const base = mat && mat.color ? mat.color : new THREE.Color(0.7, 0.7, 0.7);
        const emi = mat && mat.emissive && (mat.emissiveIntensity || 0) > 0 ? mat.emissive : null;
        const src = g.attributes.color;
        // r128 の getX は正規化した整数（glTF の COLOR_0 の UNSIGNED_BYTE / SHORT）を割らない
        const ks = src && src.normalized ? (src.array instanceof Uint8Array ? 1 / 255 : src.array instanceof Uint16Array ? 1 / 65535 : 1) : 1;
        for (let i = 0; i < n; i++) {
          let r = base.r, gg = base.g, b = base.b;
          if (src) { r *= src.getX(i) * ks; gg *= src.getY(i) * ks; b *= src.getZ(i) * ks; }
          if (emi) { r = Math.max(r, emi.r * 0.6); gg = Math.max(gg, emi.g * 0.6); b = Math.max(b, emi.b * 0.6); }
          col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        g.applyMatrix4(m);
        geos.push(g.index ? g.toNonIndexed() : g);
      });
      if (!geos.length) return null;
      const utils = THREE.BufferGeometryUtils;
      const merged = utils && utils.mergeBufferGeometries ? utils.mergeBufferGeometries(geos, false) : geos[0];
      for (const g of geos) if (g !== merged) g.dispose();
      merged.computeBoundingSphere();
      return merged;
    }
    // GLB が無いときの形: ships.json の箱を色で塗ってまとめる
    static boxGeometry(td) {
      const geos = [];
      const colOf = (tag) => (/rail|edge|windbreak/.test(tag) ? [0.75, 0.78, 0.8] : /cabin|wheelhouse|house|pilot/.test(tag) ? [0.86, 0.86, 0.82] : /deck|hull/.test(tag) ? [0.3, 0.33, 0.36] : /stack|funnel/.test(tag) ? [0.7, 0.25, 0.18] : [0.55, 0.57, 0.6]);
      const add = (x0, y0, z0, x1, y1, z1, c) => {
        const g = new THREE.BoxGeometry(Math.max(0.05, x1 - x0), Math.max(0.05, y1 - y0), Math.max(0.05, z1 - z0));
        g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.deleteAttribute('uv');
        geos.push(g.toNonIndexed());
        g.dispose();
      };
      const b = td.bbox;
      // 船体（喫水線の下から甲板まで）: 船首を細くした 2 つの箱
      const L = b[1][2] - b[0][2], dy = td.deckY || 1;
      add(b[0][0], b[0][1], b[0][2], b[1][0], dy, b[0][2] + L * 0.75, [0.82, 0.84, 0.86]);
      add(b[0][0] * 0.55, b[0][1], b[0][2] + L * 0.75, b[1][0] * 0.55, dy, b[1][2], [0.82, 0.84, 0.86]);
      for (const x of td.boxes || []) { if (x[4] - x[1] > 0.05 && !/deck_main|^deck$/.test(x[7] || '')) add(x[0], x[1], x[2], x[3], x[4], x[5], colOf(x[7] || '')); }
      const utils = THREE.BufferGeometryUtils;
      const merged = utils && utils.mergeBufferGeometries ? utils.mergeBufferGeometries(geos, false) : geos[0];
      for (const g of geos) if (g !== merged) g.dispose();
      merged.computeBoundingSphere();
      return merged;
    }

    // 毎フレーム（描く前）: 位置。LOD は lodHz 回/秒
    update(dt, cam) {
      const list = this.shipping.list;
      this._lodT -= dt;
      if (this._lodT <= 0) { this._lodT = 1 / this.cfg.lodHz; this._lod(cam); }
      const counts = this._counts || (this._counts = {});
      for (const k in this.types) counts[k] = 0;
      const farD2 = this.cfg.farDist * this.cfg.farDist;
      for (const e of list) {
        const T = this.types[e.typeId];
        if (!T) continue;
        const p = e.pose;
        this._e.set(0, p.yaw, e.heel || 0, 'YXZ');
        const det = this._detail.get(e);
        if (det) { det.position.set(p.x, p.y, p.z); det.quaternion.setFromEuler(this._e); det.visible = true; continue; }
        if (cam) { const dx = p.x - cam.x, dz = p.z - cam.z; if (dx * dx + dz * dz > farD2) continue; }
        this._q.setFromEuler(this._e);
        this._p.set(p.x, p.y, p.z);
        this._tmpM.compose(this._p, this._q, this._s);
        T.far.setMatrixAt(counts[e.typeId]++, this._tmpM);
      }
      let far = 0;
      for (const k in this.types) {
        const T = this.types[k], n = counts[k];
        T.far.count = n; T.far.visible = n > 0;
        if (n) T.far.instanceMatrix.needsUpdate = true;
        far += n;
      }
      this.stats.far = far;
    }
    _lod(cam) {
      if (!cam) return;
      const list = this.shipping.list, C = this.cfg;
      const cand = this._cand || (this._cand = []);
      cand.length = 0;
      for (const e of list) {
        const T = this.types[e.typeId];
        if (!T || !T.makeDetail) continue;
        const d = Math.hypot(e.pose.x - cam.x, e.pose.z - cam.z) - e.radius;
        const has = this._detail.has(e);
        if (d < C.detailDist * (has ? 1.1 : 0.9)) cand.push({ e, d });
      }
      cand.sort((a, b) => a.d - b.d);
      const want = new Set();
      for (let i = 0; i < cand.length && i < C.maxDetailShips; i++) want.add(cand[i].e);
      for (const [e, obj] of this._detail) if (!want.has(e)) { obj.visible = false; this.types[e.typeId].pool.push(obj); this._detail.delete(e); this.stats.swaps++; }
      for (const e of want) {
        if (this._detail.has(e)) continue;
        const T = this.types[e.typeId];
        let obj = T.pool.pop();
        if (!obj) { obj = T.makeDetail(); obj.name = 'ship:' + e.typeId; this.group.add(obj); }
        obj.visible = true;
        this._detail.set(e, obj);
        this.stats.swaps++;
      }
      this.stats.detail = this._detail.size;
    }
    info() { return { source: this.source, detail: this._detail.size, far: this.stats.far, swaps: this.stats.swaps }; }
    dispose() {
      this.disposed = true;
      this.scene.remove(this.group);
      for (const d of this._disposables) if (d && d.dispose) d.dispose();
      this._disposables.length = 0;
    }
  }

  MR.Wakes = Wakes;
  MR.Spray = Spray;
  MR.ShipsView = ShipsView;
})();
