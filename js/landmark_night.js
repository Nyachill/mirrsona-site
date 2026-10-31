// ランドマークの夜（MR.LandmarkNight。今は Mirrsona Sky High だけ）。world.js の CityLandmarks が作って、置いたノードを add() で渡す。
//   - 光る材質: GLB の材質の extras（three の material.userData）に night: true があるものを集め、夜の度合い f（0 = 昼・1 = 夜）で
//     emissiveIntensity を変える。種類は 3 つ: 窓（emissiveMap のある toneMapped の材質 = sh_glass の夜の窓）・光（toneMapped false =
//     sh_glow の光のスロット・MIRRSONA の文字・ランタン）・遠景（<名前>_far の far_glow / far_warm）。強さは [昼, 夜] を f で補間した倍率 ×
//     GLB の値（材質は clone で共有されるので 1 回だけ数える）。
//   - 航空障害灯: 赤い点（THREE.Points 1 つ = 1 回の描画、加算、霧なし）を landmarkNight.beacons.points[<ノード名>] のノード座標に置き、
//     period 秒ごとに on の割合だけ点ける（全部同時に。f が from より小さい間は消す）。画面上の大きさは size m、近くでも maxPx・遠くでも minPx。
//   - 夜の度合い: 今のエンジンの空は夕暮れだけなので、既定は landmarkNight.night（夕暮れの値）。時刻を持つ仕組み（後の nightlights.js）は
//     setNight(f) を呼べばよい。ライトは足さない（SpotLight / PointLight の数は変えない）。
// 数値は game.json の render.city.landmarkNight（無いキーは下の既定値）。
window.MR = window.MR || {};

MR.LandmarkNight = class LandmarkNight {
  static get DEFAULTS() {
    return {
      night: 0.55,             // 今の見た目（夕暮れ）の夜の度合い
      windows: [0.15, 1.6],    // 窓（夜の窓の emissiveMap）の強さの倍率 [昼, 夜]
      glow: [0.6, 1.4],        // 光のスロット・文字・ランタン（toneMapped false）
      far: [0.5, 1.4],         // 遠景のノードの光る材質
      matMul: {},              // 材質の名前 → 強さの倍率（GLB を作り直さずに 1 つの材質だけ弱める）
      beacons: { color: '#ff2a1a', size: 3.2, minPx: 2.5, maxPx: 40, period: 1.5, on: 0.4, from: 0.2, intensity: 2.2, points: {} },
    };
  }
  constructor(cfg) {
    const D = LandmarkNight.DEFAULTS, c = cfg || {};
    this.cfg = Object.assign({}, D, c, { beacons: Object.assign({}, D.beacons, c.beacons || {}) });
    this.group = new THREE.Group();
    this.group.name = 'landmarkNight';
    this.mats = [];               // { m, base, kind }
    this._seen = new Set();
    this.beaconPts = [];          // 世界座標（x, y, z の並び）
    this.points = null;
    this.timeOverride = null;     // テスト・撮影用: 点滅の時刻を固定（秒）
    this.factor = typeof this.cfg.night === 'number' ? this.cfg.night : 0.55;
    this._t = 0;
  }
  // 置いたノード（near / far）を渡す。far = 遠景のノード
  add(obj, node, far) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || this._seen.has(m) || !m.userData || !m.userData.night || !m.emissive) continue;
        this._seen.add(m);
        const kind = far ? 'far' : (m.toneMapped === false ? 'glow' : (m.emissiveMap ? 'windows' : 'glow'));
        // GLB の材質はキャッシュの clone と共有（「もう一度」で前のゲームと重なっても元の値から数える）
        if (m.userData.nightBase == null) m.userData.nightBase = m.emissiveIntensity;
        m.userData.nightOwner = this;   // 後から add した方のゲームが持ち主（前のゲームの dispose が戻さない）
        // 材質ごとの倍率（landmarkNight.matMul.<材質の名前>。b16: Sky High の 256 m のスカイフロアの sh_glow の壁が着いたとき白く飛んでいた）
        const mm = this.cfg.matMul && typeof this.cfg.matMul[m.name] === 'number' ? this.cfg.matMul[m.name] : 1;
        this.mats.push({ m, base: m.userData.nightBase * mm, kind });
      }
    });
    const pts = !far && this.cfg.beacons.points && this.cfg.beacons.points[node];
    if (Array.isArray(pts) && pts.length) {
      obj.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      for (const p of pts) { v.set(p[0], p[1], p[2]).applyMatrix4(obj.matrixWorld); this.beaconPts.push(v.x, v.y, v.z); }
      this._buildPoints();
    }
    this._apply();
  }
  setNight(f) {
    this.factor = Math.max(0, Math.min(1, +f || 0));
    this._apply();
  }
  _apply() {
    const f = this.factor;
    for (const e of this.mats) {
      const r = this.cfg[e.kind] || [1, 1];
      e.m.emissiveIntensity = e.base * (r[0] + (r[1] - r[0]) * f);
    }
  }
  _buildPoints() {
    if (this.points) { this.group.remove(this.points); this.points.geometry.dispose(); }
    const g = new THREE.BufferGeometry(), b = this.cfg.beacons;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.beaconPts, 3));
    g.computeBoundingSphere();
    if (!this._mat) {
      const col = MR.srgb ? MR.srgb(b.color) : new THREE.Color(b.color);
      this._mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: col }, uI: { value: 0 }, uSize: { value: b.size }, uProj: { value: 500 }, uMinPx: { value: b.minPx }, uMaxPx: { value: b.maxPx }, uFog: { value: new THREE.Vector2(1e6, 2e6) } },
        vertexShader: LandmarkNight.VERT, fragmentShader: LandmarkNight.FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      });
    }
    const P = new THREE.Points(g, this._mat);
    P.name = 'landmarkBeacons';
    P.frustumCulled = true;
    P.renderOrder = 2;
    const mat = this._mat, sz = new THREE.Vector2();
    // 画面の縦の画素 / (2 tan(fov / 2)) = 1 m が距離 1 m で何画素か
    P.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(sz);
      // 描いている先（ポストのターゲットは CSS × s。R0）の縦の画素。minPx / maxPx は CSS の画素（DPR 3 の iPhone でも同じ見た目の大きさ）
      const rt = renderer.getRenderTarget ? renderer.getRenderTarget() : null, rpr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      const hy = rt && rt.height ? rt.height : sz.y, pr = hy / Math.max(1, sz.y / rpr);
      mat.uniforms.uProj.value = camera.projectionMatrix.elements[5] * hy * 0.5;
      mat.uniforms.uMinPx.value = b.minPx * pr; mat.uniforms.uMaxPx.value = b.maxPx * pr;
      // 霧の外では塔と一緒に消える（材質は fog: false なので霧の距離で自分で薄める）
      const fg = scene.fog;
      if (fg && fg.isFog) mat.uniforms.uFog.value.set(fg.near, fg.far); else mat.uniforms.uFog.value.set(1e6, 2e6);
    };
    this.points = P;
    this.group.add(P);
  }
  update(time) {
    if (!this.points) return;
    const b = this.cfg.beacons, t = this.timeOverride != null ? this.timeOverride : (time || 0);
    const ph = (t / Math.max(0.1, b.period)) % 1;
    const lit = this.factor >= b.from && ph < b.on;
    // 点く・消えるのは 0.08 秒の傾斜（パッと点く航空障害灯の感じのまま、ちらつかない）
    const ramp = Math.min(1, ph / 0.08 * b.period, (b.on - ph) / 0.08 * b.period);
    this.points.visible = lit;
    if (lit) this._mat.uniforms.uI.value = b.intensity * Math.max(0, ramp) * Math.min(1, this.factor / Math.max(0.01, b.from + 0.3));
  }
  info() { return { factor: this.factor, mats: this.mats.length, beacons: this.beaconPts.length / 3, beaconsOn: !!(this.points && this.points.visible) }; }
  dispose() {
    if (this.points) { this.points.geometry.dispose(); this.group.remove(this.points); this.points = null; }
    if (this._mat) { this._mat.dispose(); this._mat = null; }
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const e of this.mats) if (e.m.userData.nightOwner === this) { e.m.emissiveIntensity = e.m.userData.nightBase; e.m.userData.nightOwner = null; } // 材質は GLB のキャッシュと共有（次のゲームが同じ値から始める）
    this.mats = []; this._seen.clear(); this.beaconPts = [];
  }
};

MR.LandmarkNight.VERT = [
  'uniform float uSize; uniform float uProj; uniform float uMinPx; uniform float uMaxPx; uniform vec2 uFog;',
  'varying float vFade;',
  'void main() {',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  vFade = 1.0 - smoothstep(uFog.x, uFog.y, -mv.z);',
  '  gl_PointSize = clamp(uSize * uProj / max(1.0, -mv.z), uMinPx, uMaxPx);',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');
MR.LandmarkNight.FRAG = [
  'uniform vec3 uColor; uniform float uI; varying float vFade;',
  'void main() {',
  '  float d = length(gl_PointCoord - 0.5) * 2.0;',
  '  float a = clamp(1.0 - d, 0.0, 1.0);',
  '  a = a * a + 0.6 * smoothstep(0.45, 0.0, d);',
  '  gl_FragColor = vec4(uColor * uI * vFade, min(1.0, a));',
  '}',
].join('\n');
