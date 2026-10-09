// 川・湖の水面（MR.Water）。r128 の ShaderMaterial。
//   - 1 枚の大きな板（y = waterY = −2）がカメラについて動く（40 m 刻み。模様は世界座標なので泳がない）。陸（y = 0）の下に隠れるので
//     陸の上では見えない（深度）。湖は同じマテリアルを湖の形のメッシュ（world.js が作る、湖の水面の高さ）に貼る。
//   - 法線: assets/textures/water/normal_small.png（8 m）と normal_large.png（40 m、30° 回して別の向きに流す）を whiteout で合成。
//     無ければシェーダーの中の波（サインの和）。
//   - 反射: 空の背景の画像（sky.js の背景球の map、正距円筒図）を反射ベクトルで引く。無ければ空のグラデーション。フレネル（Schlick）、
//     太陽のきらめき。
//   - 泡: 岸・桟橋・船からの距離（起動時に city から 512² の距離の場を作る）が近い所で foam.png（無ければ一定）をしきい値で出す。
//     8 m の繰り返しが見えないよう、しきい値を大きい方の法線の値（世界座標のノイズ）で揺らす。
//   - 霧（fog）・トーンマッピング・出力のエンコードは three の chunk。
window.MR = window.MR || {};

MR.Water = class Water {
  // opts: { city（MR.CityGen）, assets, useFiles, sky（level.sky: sunDir / sunColor / horizon / zenith）, y, size, normalScale }
  constructor(scene, opts) {
    opts = opts || {};
    this.scene = scene;
    this.city = opts.city || null;
    this.assets = opts.assets || null;
    this.disposed = false;
    const sky = Object.assign({ sunDir: [-0.55, 0.3, -0.45], sunColor: '#ffd9a8', horizon: '#e9985a', zenith: '#1d3358' }, opts.sky || {});
    this.y = opts.y != null ? opts.y : (this.city ? this.city.waterY : -2);
    this.size = opts.size || 16000;
    this.source = 'procedural';
    const sunDir = new THREE.Vector3().fromArray(sky.sunDir).normalize();
    const blank = Water.blankTexture();
    const b = this.city ? [this.city.minX, this.city.minZ, this.city.maxX - this.city.minX, this.city.maxZ - this.city.minZ] : [-3000, -3000, 6000, 6000];
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      tNormS: { value: blank }, tNormL: { value: blank }, tFoam: { value: blank }, tShore: { value: blank }, tSky: { value: blank },
      uHasNorm: { value: 0 }, uHasFoam: { value: 0 }, uHasShore: { value: 0 }, uHasSky: { value: 0 },
      uTime: { value: 0 }, uNormalScale: { value: opts.normalScale || 1.0 },
      uSunDir: { value: sunDir }, uSunColor: { value: MR.srgb(sky.sunColor) },
      uHorizon: { value: MR.srgb(sky.horizon) }, uZenith: { value: MR.srgb(sky.zenith) },
      uDeep: { value: MR.srgb('#0f2430') }, uShallow: { value: MR.srgb('#25444c') },
      uBounds: { value: new THREE.Vector4(b[0], b[1], b[2], b[3]) }
    }]);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: Water.VERT, fragmentShader: Water.FRAG, fog: true, lights: false
    });
    this.material.name = 'water';
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.position.y = this.y;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    scene.add(this.mesh);
    this._lakes = null;
    this._skyTex = null;
    if (this.city) this._buildShore();
    this.ready = (opts.useFiles !== false) ? this._load() : Promise.resolve(false);
  }

  static blankTexture() {
    if (Water._blank) return Water._blank;
    const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return (Water._blank = t);
  }

  _load() {
    const a = this.assets;
    if (!a || typeof a.resolve !== 'function' || typeof a.loadTexture !== 'function') return Promise.resolve(false);
    const get = (name) => {
      const key = a.resolve('textures/water/' + name);
      if (!key) return Promise.resolve(null);
      return Promise.resolve(a.loadTexture(key, { srgb: false, anisotropy: 4 })).catch((e) => { console.warn('[Water] 読めません:', name, e && e.message); return null; });
    };
    return Promise.all([get('normal_small.png'), get('normal_large.png'), get('foam.png')]).then((t) => {
      if (this.disposed) return false;
      if (t[0] && t[1]) {
        this.uniforms.tNormS.value = t[0]; this.uniforms.tNormL.value = t[1]; this.uniforms.uHasNorm.value = 1;
        this.source = 'files';
      }
      if (t[2]) { this.uniforms.tFoam.value = t[2]; this.uniforms.uHasFoam.value = 1; }
      return !!(t[0] && t[1]);
    });
  }

  // 岸・桟橋・船からの距離の場（水の上の画素だけ。0.25 m 単位で 64 m まで）。陸の画素は 0
  _buildShore() {
    const city = this.city, N = 512;
    const w = city.maxX - city.minX, h = city.maxZ - city.minZ, cw = w / N, ch = h / N;
    const land = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) {
      const z = city.minZ + (j + 0.5) * ch;
      for (let i = 0; i < N; i++) {
        const x = city.minX + (i + 0.5) * cw;
        land[j * N + i] = city.isLand(x, z) ? 1 : 0;
      }
    }
    const mark = (x0, z0, x1, z1) => {
      const i0 = Math.max(0, Math.floor((x0 - city.minX) / cw)), i1 = Math.min(N - 1, Math.floor((x1 - city.minX) / cw));
      const j0 = Math.max(0, Math.floor((z0 - city.minZ) / ch)), j1 = Math.min(N - 1, Math.floor((z1 - city.minZ) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) land[j * N + i] = 1;
    };
    for (const p of city.piers || []) mark(p.rect[0], p.rect[1], p.rect[2], p.rect[3]);
    // 船（空母・フェリー・タグ）の喫水線のおおよその矩形
    const hull = { carrier: [16, 130], ferry_boat: [5, 15], tugboat: [5, 14] };
    for (const p of city.landmarkPlacements ? city.landmarkPlacements() : []) {
      const hh = hull[p.node];
      if (!hh) continue;
      const c = Math.abs(Math.cos(p.yaw || 0)), s = Math.abs(Math.sin(p.yaw || 0));
      const hx = hh[0] * c + hh[1] * s, hz = hh[0] * s + hh[1] * c;
      mark(p.x - hx, p.z - hz, p.x + hx, p.z + hz);
    }
    // 湖（陸の中の水）
    for (const l of city.lakes || []) {
      const i0 = Math.max(0, Math.floor((l.bb[0] - city.minX) / cw)), i1 = Math.min(N - 1, Math.floor((l.bb[2] - city.minX) / cw));
      const j0 = Math.max(0, Math.floor((l.bb[1] - city.minZ) / ch)), j1 = Math.min(N - 1, Math.floor((l.bb[3] - city.minZ) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = city.minX + (i + 0.5) * cw, z = city.minZ + (j + 0.5) * ch;
        if (Water.pointInPoly(x, z, l.poly)) land[j * N + i] = 0;
      }
    }
    // 2 回のなぞり（chamfer 3-4）で最寄りの陸までの距離
    const INF = 1e9, d = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) d[k] = land[k] ? 0 : INF;
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) { v = Math.min(v, d[k - N] + a); if (i > 0) v = Math.min(v, d[k - N - 1] + b); if (i < N - 1) v = Math.min(v, d[k - N + 1] + b); }
      d[k] = v;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i;
      let v = d[k];
      if (i < N - 1) v = Math.min(v, d[k + 1] + a);
      if (j < N - 1) { v = Math.min(v, d[k + N] + a); if (i < N - 1) v = Math.min(v, d[k + N + 1] + b); if (i > 0) v = Math.min(v, d[k + N - 1] + b); }
      d[k] = v;
    }
    const px = new Uint8Array(N * N * 4), cell = (cw + ch) / 2;
    for (let k = 0; k < N * N; k++) {
      const m = Math.max(0, d[k] * cell - cell * 0.5); // 画素の中心 → 陸の縁までのおおよその m
      const v = Math.min(255, Math.round(m * 4));
      px[k * 4] = v; px[k * 4 + 1] = v; px[k * 4 + 2] = v; px[k * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.shoreTexture = tex;
    this.uniforms.tShore.value = tex;
    this.uniforms.uHasShore.value = 1;
  }

  static pointInPoly(x, z, poly) {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  }

  // 空の背景（sky.js が読んだ正距円筒図）を反射に使う
  setSkyTexture(tex) {
    if (!tex || tex === this._skyTex) return;
    this._skyTex = tex;
    this.uniforms.tSky.value = tex;
    this.uniforms.uHasSky.value = 1;
  }

  // 毎フレーム: 板をカメラの真下へ（40 m 刻み）、時間、湖のメッシュにマテリアルを貼る
  update(dt, cam, time, lakes) {
    this.uniforms.uTime.value = time;
    const s = 40;
    const x = Math.round(cam.x / s) * s, z = Math.round(cam.z / s) * s;
    if (x !== this.mesh.position.x || z !== this.mesh.position.z) {
      this.mesh.position.set(x, this.y, z);
      this.mesh.updateMatrix();
    }
    if (lakes && lakes !== this._lakes) {
      this._lakes = lakes;
      for (const m of lakes) { m.material = this.material; if (!m.parent) this.scene.add(m); }
    }
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.shoreTexture) this.shoreTexture.dispose();
    if (this._lakes) for (const m of this._lakes) if (m.parent) m.parent.remove(m);
  }
};

MR.Water.VERT = [
  'varying vec3 vWorld;',
  '#include <fog_pars_vertex>',
  'void main() {',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vWorld = wp.xyz;',
  '  vec4 mvPosition = viewMatrix * wp;',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '}'
].join('\n');

MR.Water.FRAG = [
  '#include <common>',
  'uniform sampler2D tNormS; uniform sampler2D tNormL; uniform sampler2D tFoam; uniform sampler2D tShore; uniform sampler2D tSky;',
  'uniform float uHasNorm; uniform float uHasFoam; uniform float uHasShore; uniform float uHasSky; uniform float uTime; uniform float uNormalScale;',
  'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uDeep; uniform vec3 uShallow;',
  'uniform vec4 uBounds;',
  'varying vec3 vWorld;',
  '#include <fog_pars_fragment>',
  // ファイルが無いときの波（サインの和の勾配）
  'vec3 procNormal(vec2 p, float t) {',
  '  float a1 = p.x * 0.9 + t * 1.1, a2 = p.y * 1.3 - t * 0.9, a3 = (p.x * 0.6 + p.y) * 2.1 + t * 1.7, a4 = (p.x - p.y * 0.4) * 3.3 - t * 2.3;',
  '  vec2 g = vec2(cos(a1) * 0.45 + cos(a3) * 0.3 + cos(a4) * 0.2, -cos(a2) * 0.6 + cos(a3) * 0.5 - cos(a4) * 0.08);',
  '  return normalize(vec3(-g * 0.16, 1.0));',
  '}',
  'void main() {',
  '  vec2 xz = vWorld.xz;',
  '  vec3 n;',
  '  float big = 0.5;',
  '  if (uHasNorm > 0.5) {',
  '    vec3 n1 = texture2D(tNormS, xz / 8.0 + vec2(uTime * 0.03, uTime * 0.011)).xyz * 2.0 - 1.0;',
  '    vec2 r = vec2(0.8660254 * xz.x - 0.5 * xz.y, 0.5 * xz.x + 0.8660254 * xz.y);',
  '    vec4 l = texture2D(tNormL, r / 40.0 + vec2(-uTime * 0.004, uTime * 0.0025));',
  '    vec3 n2 = l.xyz * 2.0 - 1.0;',
  '    n2.xy = vec2(0.8660254 * n2.x + 0.5 * n2.y, -0.5 * n2.x + 0.8660254 * n2.y);',
  '    n = normalize(vec3(n1.xy * 0.8 + n2.xy, n1.z * n2.z));',
  '    big = l.x;',
  '  } else {',
  '    n = procNormal(xz * 0.35, uTime);',
  '    big = 0.5 + 0.5 * sin(xz.x * 0.05 + xz.y * 0.031);',
  '  }',
  // 泳いでいる（カメラが水面の近く）とき、まわり十数 m に細かいさざ波（1.7 m の繰り返し）を足す。高い所から見るときは足さない
  '  float camH = cameraPosition.y - vWorld.y;',
  '  float nearW = (1.0 - smoothstep(2.0, 16.0, length(cameraPosition.xz - xz))) * (1.0 - smoothstep(1.0, 4.0, camH));',
  '  if (nearW > 0.001) {',
  '    vec2 rp = xz / 1.7 + vec2(-uTime * 0.11, uTime * 0.08);',
  '    vec3 n3 = uHasNorm > 0.5 ? texture2D(tNormS, rp).xyz * 2.0 - 1.0 : procNormal(xz * 2.4, uTime * 1.7);',
  '    n.xy += n3.xy * 0.85 * nearW;',
  '  }',
  '  n.xy *= uNormalScale;',
  '  vec3 N = normalize(vec3(n.x, n.z, -n.y));',
  '  vec3 V = normalize(cameraPosition - vWorld);',
  '  float ndv = max(dot(N, V), 0.0);',
  '  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);',
  '  vec3 R = reflect(-V, N);',
  '  R.y = abs(R.y);',
  '  vec3 sky;',
  '  if (uHasSky > 0.5) {',
  '    vec2 suv = vec2(atan(R.z, R.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(R.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);',
  '    sky = pow(texture2D(tSky, suv).rgb, vec3(2.2));',
  '  } else sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.42));',
  '  float sd = max(dot(R, normalize(uSunDir)), 0.0);',
  '  float glint = pow(sd, 260.0) * 5.0 + pow(sd, 24.0) * 0.18;',
  '  vec3 base = mix(uDeep, uShallow, clamp(0.35 + 0.6 * n.x, 0.0, 1.0));',
  '  vec3 col = mix(base, sky, fres * 0.85) + uSunColor * glint;',
  '  if (uHasShore > 0.5) {',
  '    float d = texture2D(tShore, (xz - uBounds.xy) / uBounds.zw).r * 64.0;',
  '    float s = 1.0 - smoothstep(0.0, 5.0 + 6.0 * big, d);',
  '    float fm = uHasFoam > 0.5 ? texture2D(tFoam, xz / 8.0 + vec2(uTime * 0.012, uTime * 0.004)).r : 0.55;',
  '    float foam = smoothstep(1.0 - s, 1.2 - s, fm) * s;',
  '    col = mix(col, vec3(0.62, 0.64, 0.66), clamp(foam, 0.0, 1.0) * 0.75);',
  '  }',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <encodings_fragment>',
  '  #include <fog_fragment>',
  '}'
].join('\n');
