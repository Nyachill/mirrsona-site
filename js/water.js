// 川・湖の水面（MR.Water）。r128 の ShaderMaterial。
//   - 1 枚の大きな板（y = waterY = −2）がカメラについて動く（40 m 刻み。模様は世界座標なので泳がない。天気のあるゲームは真ん中を細かく
//     割った板 = gradedPlane: 雨の波紋の細かさには 16 km の三角形 2 枚から補間した位置では精度が足りない）。陸（y = 0）の下に隠れるので
//     陸の上では見えない（深度）。湖は同じマテリアルを湖の形のメッシュ（world.js が作る、湖の水面の高さ）に貼る。
//   - 法線: assets/textures/water/normal_small.png（8 m）と normal_large.png（40 m、30° 回して別の向きに流す）を whiteout で合成。
//     無ければシェーダーの中の波（サインの和）。
//   - 反射: 空の背景の画像（sky.js の背景球の map、正距円筒図）を反射ベクトルで引く。無ければ空のグラデーション。フレネル（Schlick）、
//     太陽のきらめき。
//   - 泡: 岸・桟橋・船からの距離（起動時に city から 512² の距離の場を作る）が近い所で foam.png（無ければ一定）をしきい値で出す。
//     8 m の繰り返しが見えないよう、しきい値を大きい方の法線の値（世界座標のノイズ）で揺らす。
//   - 霧（fog）・トーンマッピング・出力のエンコードは three の chunk。
//   - 天気（opts.weather。天気のあるゲームだけ）: #define WEATHER で uOvercast（曇りの色を映す割合）・uOvCol・uSkyMul（空の映り込み）・
//     uGlint（きらめき）・uRain（雨の強さ 0..1）で雨の波紋: 大・中・小 3 つの格子（uRipple.xyz m。小 C はカメラから uRippleD.zw m の近くだけ）の
//     升ごとに 1 つ、ずらした時刻で広がって消える輪（升の 0.3 倍まで、内側にもう 1 つ薄い輪）と、落ちた瞬間の明るい点（明るさ uRippleN.z、半径 = 升 × uRippleN.w）。升に輪がある
//     割合は 雨 / uRippleK.xyz（大きい升は雨で早くいっぱいに）、強さは雨の降り始めの uRippleN.y まで上がる（雨が弱くても輪ははっきり、数が少ない）。
//     法線は輪の斜面（内と外で逆向き = 明るい帯と暗い帯、uRippleN.x）。輪の幅は 升 × uRipple.w、ただし 1 画素（uRippleK.w = 1 m 先の 1 画素の m、
//     見下ろす角で奥行きに伸ばす）より細くしない（細いと浅い角で消えた）。太らせた分は √ で薄く。カメラから uRippleD.xy m（3D の距離 = 高い所からは
//     無し）で消す。uRippleLight（輪の山が曇り空 uOvCol を映す明るさ）。以前は 1.2 m の格子に 1 つの細い輪だけで、ふつうの雨（0.55）では泳いでいても
//     桟橋の上からもほとんど見えなかった。uTime はゲームの時間。
//     値は weather_view.js が毎フレーム書く。天気の無いゲームは今までと同じプログラム
window.MR = window.MR || {};

MR.Water = class Water {
  // opts: { city（MR.CityGen）, assets, useFiles, sky（level.sky: sunDir / sunColor / horizon / zenith）, y, size, normalScale,
  //         shoreRes（v2 の街だけ: 岸の距離の場の短い辺の画素。長い辺は地図の縦横比で。既定 512）, weather（天気の uniform つき）}
  constructor(scene, opts) {
    opts = opts || {};
    this.scene = scene;
    this.city = opts.city || null;
    this.assets = opts.assets || null;
    this.disposed = false;
    const sky = Object.assign({ sunDir: [-0.55, 0.3, -0.45], sunColor: '#ffd9a8', horizon: '#e9985a', zenith: '#1d3358' }, opts.sky || {});
    this.y = opts.y != null ? opts.y : (this.city ? this.city.waterY : -2);
    this.size = opts.size || 16000;
    this.shoreRes = opts.shoreRes || 512;
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
      uBounds: { value: new THREE.Vector4(b[0], b[1], b[2], b[3]) },
      // WaterFX の段（waterfx.js が書く。w = 0 で何もしない）: uWash = (x, z, R, 強さ)・uWashRing = 輪の半径・uWashDir = (進む向き x, z, 蹄鉄 0..1)・
      //   uWashLook = (暗さ, さざ波, 泡)
      uWash: { value: new THREE.Vector4(0, 0, 5, 0) }, uWashRing: { value: 6 }, uWashDir: { value: new THREE.Vector3(0, 0, 0) },
      uWashLook: { value: new THREE.Vector3(0.5, 0.38, 0.85) },
      // 着水の輪（3 つ。x, z, 始まりの uTime, 大きさ。w = 0 で無し）
      uPulse: { value: [new THREE.Vector4(0, 0, -1e4, 0), new THREE.Vector4(0, 0, -1e4, 0), new THREE.Vector4(0, 0, -1e4, 0)] }, uPulseK: { value: new THREE.Vector2(6, 2.6) }
    }]);
    // 天気（weather_view.js）: 天気のあるゲームだけ WEATHER で作る（曇りの空を映す・空の映り込みときらめきの倍率）。無いゲームは今までと同じプログラム
    this.weather = !!opts.weather;
    if (this.weather) {
      this.uniforms.uOvercast = { value: 0 };
      this.uniforms.uOvCol = { value: new THREE.Color(0.3, 0.3, 0.33) };
      this.uniforms.uSkyMul = { value: 1 };
      this.uniforms.uGlint = { value: 1 };
      this.uniforms.uRain = { value: 0 };
      this.uniforms.uRippleLight = { value: 1.5 };
      // 波紋の形（weather_view.js が game.json の weather.view から書く）
      this.uniforms.uRipple = { value: new Float32Array([0.8, 0.45, 0.25, 0.025]) };   // 升 A / B / C（m）・輪の幅（× 升）
      this.uniforms.uRippleK = { value: new Float32Array([0.4, 0.6, 0.9, 0.002]) };   // 升 A / B / C がいっぱいになる雨・1 m 先の 1 画素（m）
      this.uniforms.uRippleD = { value: new Float32Array([25, 40, 4, 7]) };   // 消し始め / 終わりの距離・C の消し始め / 終わり（m）
      this.uniforms.uRippleN = { value: new Float32Array([0.9, 0.15, 1.5, 0.06]) };   // 法線の強さ・強さがいっぱいになる雨・落ちた所の点の明るさ・大きさ（× 升）
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: Water.VERT, fragmentShader: Water.FRAG, fog: true, lights: false
    });
    if (this.weather) this.material.defines = { WEATHER: '' };
    this.material.name = 'water';
    // 天気のあるゲームは真ん中（カメラのまわり）を細かく割った板（雨の波紋は数 mm〜cm の細かさなので、16 km の三角形 2 枚から補間した
    //   世界の位置では精度が足りない。SwiftShader では泳いで見下ろす向きによって水面全体が一色になった）。天気の無いゲームは今までの 2 枚
    let geo;
    if (this.weather) geo = Water.gradedPlane(this.size);
    else { geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1); geo.rotateX(-Math.PI / 2); }
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

  // ボートの中に水面を描かない（boats 計画 §5.1.9）: ステンシルの bit が立っている画素は描かない（boat.js の舷縁の板が立てる）。
  // r128 では stencilWrite が試験も有効にする（操作は全部 KEEP = 何も書かない）。書く mask は 0xff のまま: three r128 は描き終わりに
  //   ステンシルの書く mask を戻さず、renderer.clear() もそのまま gl.clear するので、mask 0 で終わったフレームの次はステンシルが消えず、
  //   舷縁の板の bit が前のフレームから積もって、一度でも板が映った所の水面が描かれなくなった（川に灰色の穴。b13 の検証）
  setStencilMask(bit) {
    const m = this.material;
    if (!bit) { m.stencilWrite = false; return; }
    m.stencilWrite = true; m.stencilWriteMask = 0xff; m.stencilRef = bit; m.stencilFuncMask = bit;
    m.stencilFunc = THREE.NotEqualStencilFunc; m.stencilFail = THREE.KeepStencilOp; m.stencilZFail = THREE.KeepStencilOp; m.stencilZPass = THREE.KeepStencilOp;
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
  //   v1（midtown）: 512²、陸は city.isLand + 桟橋の矩形。v2（manhattan、city.version 2）: 地図の縦横比で shoreRes × (shoreRes × 縦横比)
  //   （sd 512 × 1024 / hd 1024 × 2048）、陸は city.landMask（core の LGRD = 4 m の陸の格子。0 水 / 1 陸 / 2 混ざり → isLand）。
  //   LAND は桟橋を含むので桟橋の矩形は見ない
  _buildShore() {
    const city = this.city, v2 = city.version === 2;
    const w = city.maxX - city.minX, h = city.maxZ - city.minZ;
    const NX = v2 ? (w <= h ? this.shoreRes : this.shoreRes * Math.max(1, Math.round(w / h))) : 512;
    const NZ = v2 ? (w <= h ? this.shoreRes * Math.max(1, Math.round(h / w)) : this.shoreRes) : 512;
    const N = NX, cw = w / NX, ch = h / NZ, NN = NX * NZ;
    const land = new Uint8Array(NN);
    const mask = v2 ? (city.landMask || (city.core && city.core.lgrd) || null) : null;
    for (let j = 0; j < NZ; j++) {
      const z = city.minZ + (j + 0.5) * ch;
      for (let i = 0; i < NX; i++) {
        const x = city.minX + (i + 0.5) * cw;
        if (mask && mask.grid) {
          const gx = Math.floor((x - mask.x0) / mask.cell), gz = Math.floor((z - mask.z0) / mask.cell);
          const m = gx < 0 || gz < 0 || gx >= mask.W || gz >= mask.H ? 0 : mask.grid[gz * mask.W + gx];
          land[j * N + i] = m === 2 ? (city.isLand(x, z) ? 1 : 0) : m;
        } else land[j * N + i] = city.isLand(x, z) ? 1 : 0;
      }
    }
    const mark = (x0, z0, x1, z1) => {
      const i0 = Math.max(0, Math.floor((x0 - city.minX) / cw)), i1 = Math.min(NX - 1, Math.floor((x1 - city.minX) / cw));
      const j0 = Math.max(0, Math.floor((z0 - city.minZ) / ch)), j1 = Math.min(NZ - 1, Math.floor((z1 - city.minZ) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) land[j * N + i] = 1;
    };
    if (!mask) for (const p of city.piers || []) mark(p.rect[0], p.rect[1], p.rect[2], p.rect[3]);
    // 船（空母・フェリー・タグ）の喫水線のおおよその矩形
    const hull = { carrier: [16, 130], ferry_boat: [5, 15], tugboat: [5, 14], cruise_ship: [19, 149] };
    for (const p of city.landmarkPlacements ? city.landmarkPlacements() : []) {
      const hh = hull[p.node];
      if (!hh) continue;
      const c = Math.abs(Math.cos(p.yaw || 0)), s = Math.abs(Math.sin(p.yaw || 0));
      const hx = hh[0] * c + hh[1] * s, hz = hh[0] * s + hh[1] * c;
      mark(p.x - hx, p.z - hz, p.x + hx, p.z + hz);
    }
    // 湖（陸の中の水）
    for (const l of city.lakes || []) {
      const i0 = Math.max(0, Math.floor((l.bb[0] - city.minX) / cw)), i1 = Math.min(NX - 1, Math.floor((l.bb[2] - city.minX) / cw));
      const j0 = Math.max(0, Math.floor((l.bb[1] - city.minZ) / ch)), j1 = Math.min(NZ - 1, Math.floor((l.bb[3] - city.minZ) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = city.minX + (i + 0.5) * cw, z = city.minZ + (j + 0.5) * ch;
        if (Water.pointInPoly(x, z, l.poly)) land[j * N + i] = 0;
      }
    }
    // 2 回のなぞり（chamfer 3-4）で最寄りの陸までの距離
    const INF = 1e9, d = new Float32Array(NN);
    for (let k = 0; k < NN; k++) d[k] = land[k] ? 0 : INF;
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * N + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) { v = Math.min(v, d[k - N] + a); if (i > 0) v = Math.min(v, d[k - N - 1] + b); if (i < NX - 1) v = Math.min(v, d[k - N + 1] + b); }
      d[k] = v;
    }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
      const k = j * N + i;
      let v = d[k];
      if (i < NX - 1) v = Math.min(v, d[k + 1] + a);
      if (j < NZ - 1) { v = Math.min(v, d[k + N] + a); if (i < NX - 1) v = Math.min(v, d[k + N + 1] + b); if (i > 0) v = Math.min(v, d[k + N - 1] + b); }
      d[k] = v;
    }
    const px = new Uint8Array(NN * 4), cell = (cw + ch) / 2;
    for (let k = 0; k < NN; k++) {
      const m = Math.max(0, d[k] * cell - cell * 0.5); // 画素の中心 → 陸の縁までのおおよその m
      const v = Math.min(255, Math.round(m * 4));
      px[k * 4] = v; px[k * 4 + 1] = v; px[k * 4 + 2] = v; px[k * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(px, NX, NZ, THREE.RGBAFormat);
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
  // 水平の板（y = 0、上向き）: 真ん中から 32 m までは 4 m ごと、その先は 1.6 倍ずつ広げて size / 2 まで（40 × 40 升 = 3200 三角形）。
  //   板はカメラについて 40 m ごとに動くので、カメラはいつも細かい所（真ん中から 28 m 以内）にいる
  static gradedPlane(size) {
    const h = size / 2, t = [0];
    let v = 0;
    while (v < 32) { v += 4; t.push(v); }
    while (v < h) { v = Math.min(h, v * 1.6); t.push(v); }
    const xs = t.slice(1).reverse().map((q) => -q).concat(t), n = xs.length;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; pos[k] = xs[i]; pos[k + 1] = 0; pos[k + 2] = xs[j]; }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = (j + 1) * n + i, c = j * n + i + 1, d = (j + 1) * n + i + 1;
      idx.push(a, b, c, b, d, c);   // 上から見て反時計回り = 上向きの面
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

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
  '#ifdef WEATHER',
  'uniform float uOvercast; uniform vec3 uOvCol; uniform float uSkyMul; uniform float uGlint; uniform float uRain; uniform float uRippleLight;',
  'uniform vec4 uRipple; uniform vec4 uRippleK; uniform vec4 uRippleD; uniform vec4 uRippleN;',
  // 升の番号の乱数（sin を使わない形。番号は 1024 で回すので float でも崩れない）
  'float wxHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
  // 1 つの格子（升 cell m、ずらし sh）: 輪と落ちた所の点の明るさを返し、輪の斜面の法線を nd に足す。gate = 輪のある升の割合、fw = 1 画素の m
  'float wxRing(vec2 xz, float cell, vec2 sh, float gate, float fw, inout vec2 nd) {',
  '  vec2 rc = xz / cell + sh;',
  '  vec2 ci = mod(floor(rc), 1024.0);',
  '  if (wxHash(ci + 3.7) > gate) return 0.0;',
  '  vec2 rf = (fract(rc) - 0.3 - 0.4 * vec2(wxHash(ci + 1.7), wxHash(ci + 5.3))) * cell;',
  '  float ph = fract(uTime * (0.7 + 0.6 * wxHash(ci + 9.1)) + wxHash(ci));',
  '  float rd = length(rf);',
  '  float rr = ph * 0.3 * cell;',
  '  float w0 = uRipple.w * cell, w = max(w0, fw);',   // 輪の幅は升に比例（小さい輪は細い）
  // 1 画素より太らせた輪は薄く（ただし √ = 遠くでも粒々が残る。そのままの比だと 10 m より先で消えた）
  '  float a = (1.0 - ph) * (1.0 - ph) * min(1.0, sqrt(w0 / w * 1.5));',
  '  float s1 = (rd - rr) / w, s2 = (rd - rr * 0.55) / w;',
  '  float e1 = exp(-s1 * s1), e2 = exp(-s2 * s2) * 0.5;',
  // 山の外側の斜面は外へ、内側は内へ傾く（n.xy の y は世界の −z: N = (n.x, n.z, −n.y)）
  '  nd += vec2(rf.x, -rf.y) / max(rd, 1e-3) * (s1 * e1 + s2 * e2) * a;',
  // 落ちた瞬間（輪の時間の最初の 1/8）の小さな明るい点（はねた水）
  '  float d0 = uRippleN.w * cell, dw = max(d0, fw);',
  '  float dt = max(0.0, 1.0 - ph * 8.0) * exp(-rd * rd / (dw * dw)) * min(1.0, sqrt(d0 / dw));',
  '  return (e1 + e2) * a + dt * uRippleN.z;',
  '}',
  '#endif',
  'uniform vec4 uWash; uniform float uWashRing; uniform vec3 uWashDir; uniform vec3 uWashLook; uniform vec4 uPulse[3]; uniform vec2 uPulseK;',
  'varying vec3 vWorld;',
  '#include <fog_pars_fragment>',
  // ファイルが無いときの波（サインの和の勾配）
  'vec3 procNormal(vec2 p, float t) {',
  '  float a1 = p.x * 0.9 + t * 1.1, a2 = p.y * 1.3 - t * 0.9, a3 = (p.x * 0.6 + p.y) * 2.1 + t * 1.7, a4 = (p.x - p.y * 0.4) * 3.3 - t * 2.3;',
  '  vec2 g = vec2(cos(a1) * 0.45 + cos(a3) * 0.3 + cos(a4) * 0.2, -cos(a2) * 0.6 + cos(a3) * 0.5 - cos(a4) * 0.08);',
  '  return normalize(vec3(-g * 0.16, 1.0));',
  '}',
  // ---- WaterFX の段（天気の雨の段の後に置く。uWash.w が 0 なら何もしない = uniform で開け閉め、シェーダーは同じ）----
  // 吹き下ろしの水面: 戻り値 x = 暗さ、y = 泡、zw = 法線（接空間の xy）に足すさざ波。進むときは後ろへ伸びたくぼみ（蹄鉄）
  'float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'float wNoise(vec2 p) {',
  '  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);',
  '}',
  'vec4 washFx(vec2 xz) {',
  '  vec2 dp = xz - uWash.xy;',
  '  float along = dot(dp, uWashDir.xy), across = dp.x * uWashDir.y - dp.y * uWashDir.x;',
  '  float st = along < 0.0 ? 1.0 / (1.0 + 1.6 * uWashDir.z) : 1.0;',
  '  vec2 q = uWashDir.z > 0.001 ? vec2(across, along * st) : dp;',
  '  float d = length(q), dr = length(dp);',
  '  float ring = uWashRing, k = uWash.w;',
  '  if (dr > ring * 2.2) return vec4(0.0);',
  '  vec2 rd = dp / max(dr, 0.01);',
  // 外へ流れる泡のまだら（値ノイズを外向きに流す。角度の周期を作らない）
  '  vec2 fp = xz * 0.85 - rd * uTime * 5.5;',
  '  float nz = wNoise(fp) * 0.6 + wNoise(fp * 2.3 + 7.1) * 0.4;',
  '  float ph = dr * 3.1 - uTime * 11.0 + nz * 2.5;',
  '  float env = smoothstep(0.0, uWash.z * 0.4, dr) * (1.0 - smoothstep(ring * 0.8, ring * 2.0, dr));',
  '  float rip = sin(ph) * (0.45 + 0.55 * nz) * env * k * uWashLook.y;',
  '  float dark = k * (1.0 - smoothstep(uWash.z * 0.3, ring * 1.2, d)) * uWashLook.x;',
  '  float rim = (d - ring * 1.02) / (0.3 * ring);',
  '  float foam = k * exp(-rim * rim) * smoothstep(0.38, 0.72, nz) * uWashLook.z;',
  '  foam += k * 0.6 * smoothstep(ring * 0.25, ring * 0.9, d) * (1.0 - smoothstep(ring * 0.9, ring * 1.3, d)) * smoothstep(0.62, 0.85, nz) * uWashLook.z;',
  '  return vec4(dark, foam, rd.x * rip, -rd.y * rip);',
  '}',
  // 着水の輪: 外へ広がる白い輪とさざ波（uPulseK = 広がる m/s・消えるまでの秒。waterfx.js が game.json から入れる）。戻り値 x = 泡、yz = 法線に足す分
  'vec3 pulseFx(vec2 xz, vec4 P) {',
  '  float age = uTime - P.z;',
  '  if (P.w <= 0.0 || age < 0.0 || age > uPulseK.y) return vec3(0.0);',
  '  vec2 dp = xz - P.xy; float d = length(dp);',
  '  float r = (0.6 + uPulseK.x * age) * sqrt(P.w), w = 0.5 + 0.6 * age;',
  '  if (d > r + w * 3.0) return vec3(0.0);',
  '  float u = age / uPulseK.y, fade = (1.0 - u) * (1.0 - u) * P.w;',
  '  float e = (d - r) / w;',
  '  float ring = exp(-e * e);',
  '  vec2 rd = dp / max(d, 0.01);',
  '  float rip = sin((d - r) * 3.5) * exp(-e * e * 0.25) * 0.45 * fade;',
  '  float inner = (1.0 - smoothstep(0.0, r, d)) * (1.0 - smoothstep(0.0, 0.5, u)) * 0.8;',
  '  return vec3(clamp((ring * 0.75 + inner) * fade, 0.0, 1.0), rd.x * rip, -rd.y * rip);',
  '}',
  'void main() {',
  '  vec2 xz = vWorld.xz;',
  '  float pfoam = 0.0;',
  '  vec4 wfx = vec4(0.0);',
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
  // 天気: 雨の波紋（大・中・小の格子の升ごとに広がって消える輪。カメラから uRippleD.y m まで）
  '#ifdef WEATHER',
  '  float rlit = 0.0;',
  '  vec3 rv = cameraPosition - vWorld;',
  '  float rd3 = length(rv);',
  '  float rw = smoothstep(0.0, uRippleN.y, uRain) * (1.0 - smoothstep(uRippleD.x, uRippleD.y, rd3));',
  '  if (rw > 0.001) {',
  '    float fw = rd3 * uRippleK.w / max(abs(rv.y) / max(rd3, 1e-3), 0.12);',   // 1 画素（奥行きの向き）の m
  '    vec2 nd = vec2(0.0);',
  '    rlit = wxRing(xz, uRipple.x, vec2(0.0), uRain / uRippleK.x, fw, nd) + wxRing(xz, uRipple.y, vec2(0.37, 0.61), uRain / uRippleK.y, fw, nd);',
  // 細かい升（C）は近くだけ（泳いでいる・岸のすぐ上。遠くでは 1 画素より細い）
  '    float nc = 1.0 - smoothstep(uRippleD.z, uRippleD.w, rd3);',
  '    if (nc > 0.001) rlit += nc * wxRing(xz, uRipple.z, vec2(0.71, 0.13), uRain / uRippleK.z, fw, nd);',
  '    n.xy += nd * uRippleN.x * rw;',
  '    rlit *= rw;',
  '  }',
  '#endif',
  '  if (uWash.w > 0.001) { wfx = washFx(xz); n.xy += wfx.zw; }',
  '  for (int i = 0; i < 3; i++) { if (uPulse[i].w > 0.0) { vec3 pf = pulseFx(xz, uPulse[i]); pfoam += pf.x; n.xy += pf.yz; } }',
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
  // 天気: 曇っているほど夕焼けの代わりに雲の色を映す・きらめきを弱める
  '#ifdef WEATHER',
  '  sky = mix(sky * uSkyMul, uOvCol, uOvercast);',
  '  glint *= uGlint;',
  '#endif',
  '  vec3 base = mix(uDeep, uShallow, clamp(0.35 + 0.6 * n.x, 0.0, 1.0));',
  '  vec3 col = mix(base, sky, fres * 0.85) + uSunColor * glint;',
  // 天気: 波紋の輪の山が曇り空を映す（輪の明るさ）
  '#ifdef WEATHER',
  '  col += uOvCol * rlit * uRippleLight;',
  '#endif',
  '  if (uHasShore > 0.5) {',
  '    float d = texture2D(tShore, (xz - uBounds.xy) / uBounds.zw).r * 64.0;',
  '    float s = 1.0 - smoothstep(0.0, 5.0 + 6.0 * big, d);',
  '    float fm = uHasFoam > 0.5 ? texture2D(tFoam, xz / 8.0 + vec2(uTime * 0.012, uTime * 0.004)).r : 0.55;',
  '    float foam = smoothstep(1.0 - s, 1.2 - s, fm) * s;',
  '    col = mix(col, vec3(0.62, 0.64, 0.66), clamp(foam, 0.0, 1.0) * 0.75);',
  '  }',
  '  if (uWash.w > 0.001) { col = mix(col, col * 0.4 + uDeep * 0.25, clamp(wfx.x, 0.0, 1.0)); col = mix(col, vec3(0.7, 0.74, 0.76), clamp(wfx.y, 0.0, 0.9)); }',
  '  if (pfoam > 0.0) col = mix(col, vec3(0.72, 0.76, 0.78), clamp(pfoam, 0.0, 0.85));',
  '  gl_FragColor = vec4(col, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <encodings_fragment>',
  '  #include <fog_fragment>',
  '}'
].join('\n');
