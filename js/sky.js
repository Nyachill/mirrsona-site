// 空と光。夕暮れのグラデーション空＋太陽、方向光（影つき）、半球光、PBR 用の環境マップ、霧。
//
// 空の絵:
//   - assets に sky/dusk_bg.jpg（<tier>/sky/dusk_bg.jpg）があれば、それを貼った大きな球（内側から見る）を背景にする。
//     読み込みは非同期なので、届くまでは今までのシェーダードーム（グラデーション＋太陽）を表示し、届いたら切り替える。
//   - 環境マップ（PBR の反射・環境光）: sky/dusk_env.jpg があれば PMREMGenerator.fromEquirectangular、
//     無ければ今までどおりシェーダードームを fromScene で焼く。ファイル版が届いたら差し替える。
//     game.js はビューシーン（銃と腕）の environment も更新する必要があるので onEnvironment(cb) か
//     environmentReady（Promise）を使う。
//   - URL の ?noenv=1 か opts.noEnv で環境マップを作らない（SwiftShader の確認用）。
//
// 読む設定（level.sky から opts で渡される）: background ('sky/dusk_bg.jpg'), env ('sky/dusk_env.jpg')。
// game.js から: assets, useFiles (render.textures), anisotropy, shadows, shadowMapSize, fogNear, fogFar
// 街（render.city）: shadowRadius（影の範囲の半分 m）、shadowDistance（太陽の位置 = 注視点から太陽の向きへ何 m）、shadowFar、
//   followY（影の注視点をカメラの高さに合わせる。屋上やヘリでも足元に影が出る）、hemiIntensity（半球光。既定 0.75。
//   ビルの谷間はほとんど日陰なので街では少し明るく）。霧と描画距離は game.js が高さで変える
window.MR = window.MR || {};

MR.Sky = class Sky {
  constructor(scene, renderer, opts) {
    this.scene = scene;
    this.renderer = renderer || null;
    this.opts = Object.assign({
      zenith: '#1d3358',
      horizon: '#e9985a',
      ground: '#3a2e2a',
      sunColor: '#ffd9a8',
      sunDir: [-0.55, 0.32, -0.45],
      sunIntensity: 2.2,
      shadowMapSize: 2048,
      shadowRadius: 60,
      shadowDistance: 120,
      shadowFar: 260,
      followY: false,
      background: 'sky/dusk_bg.jpg',
      env: 'sky/dusk_env.jpg',
      assets: null,
      useFiles: true,
      noEnv: false,
      anisotropy: 4
    }, opts || {});
    this.noEnv = !!this.opts.noEnv || Sky.urlFlag('noenv');
    this.disposed = false;

    const sunDir = new THREE.Vector3().fromArray(this.opts.sunDir).normalize();
    this.sunDir = sunDir;

    // --- 空のドーム（シェーダー。ファイルの空が届くまで／無いときの表示）---
    this.uniforms = {
      zenith: { value: MR.srgb(this.opts.zenith) },
      horizon: { value: MR.srgb(this.opts.horizon) },
      ground: { value: MR.srgb(this.opts.ground) },
      sunColor: { value: MR.srgb(this.opts.sunColor) },
      sunDir: { value: sunDir.clone() }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = normalize(position);',
        '  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = p.xyww;',  // 常に最奥
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform vec3 sunDir;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float h = d.y;',
        '  vec3 sky = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));',
        '  vec3 below = mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));',
        '  vec3 col = h >= 0.0 ? sky : below;',
        '  float s = max(dot(d, sunDir), 0.0);',
        '  col += sunColor * (pow(s, 900.0) * 1.4 + pow(s, 14.0) * 0.28 + pow(s, 3.0) * 0.08);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    this.domeMaterial = mat;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.dome.name = 'skyDome';
    scene.add(this.dome);
    this.background = null; // ファイルの空（球メッシュ）

    // --- 光 ---
    this.hemi = new THREE.HemisphereLight(MR.srgb(this.opts.zenith).lerp(new THREE.Color(1, 1, 1), 0.35), MR.srgb(this.opts.ground).lerp(MR.srgb(this.opts.horizon), 0.3), this.opts.hemiIntensity || 0.75);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(MR.srgb(this.opts.sunColor), this.opts.sunIntensity);
    this.sun.position.copy(sunDir).multiplyScalar(this.opts.shadowDistance);
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);
    if (this.opts.shadows !== false) {
      this.sun.castShadow = true;
      const r = this.opts.shadowRadius;
      this.sun.shadow.mapSize.set(this.opts.shadowMapSize, this.opts.shadowMapSize);
      this.sun.shadow.camera.left = -r; this.sun.shadow.camera.right = r;
      this.sun.shadow.camera.top = r; this.sun.shadow.camera.bottom = -r;
      this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = this.opts.shadowFar;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
    }

    // --- 環境マップ（PBR の反射用）---
    this.envTexture = null;
    this.envSource = 'none';           // 'files' | 'procedural' | 'none'
    this._envCallbacks = [];
    this._resolveEnv = null;
    this.environmentReady = new Promise((resolve) => { this._resolveEnv = resolve; });
    if (!this.noEnv && renderer && THREE.PMREMGenerator) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new THREE.Scene();
        envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 12), mat.clone()));
        const target = pmrem.fromScene(envScene, 0.04);
        pmrem.dispose();
        if (target && target.texture) this._setEnvironment(target.texture, 'procedural', target);
      } catch (e) {
        console.warn('[Sky] environment map skipped:', e.message);
      }
    }

    scene.background = null;
    scene.fog = new THREE.Fog(MR.srgb(this.opts.horizon).lerp(MR.srgb(this.opts.zenith), 0.25), this.opts.fogNear || 45, this.opts.fogFar || 140);

    // --- ファイルの空（非同期）---
    const assets = this.opts.assets;
    const canFiles = this.opts.useFiles !== false && assets && typeof assets.resolve === 'function' && typeof assets.loadTexture === 'function';
    let bgKey = null, envKey = null;
    if (canFiles) {
      try {
        bgKey = this.opts.background ? assets.resolve(this.opts.background) : null;
        envKey = this.opts.env ? assets.resolve(this.opts.env) : null;
      } catch (e) { bgKey = envKey = null; }
    }
    this.source = bgKey ? 'files' : 'procedural';   // 背景の出所（読み込み失敗で procedural に戻る）
    this.backgroundLoaded = false;
    const jobs = [];
    if (bgKey) jobs.push(this._loadBackground(assets, bgKey));
    const wantEnv = !!(envKey && !this.noEnv && renderer);
    if (wantEnv) jobs.push(this._loadEnvironment(assets, envKey));
    else this._resolveEnv(this.envTexture);
    this.ready = Promise.all(jobs).then(() => this);
  }

  static urlFlag(name) {
    try {
      const s = (typeof location !== 'undefined' && location.search) || '';
      return new RegExp('[?&]' + name + '=1\\b').test(s);
    } catch (e) { return false; }
  }

  // 環境マップが使えるとき／変わったときに cb(texture) を呼ぶ（すでにあれば即座に 1 回）
  onEnvironment(cb) {
    if (typeof cb !== 'function') return;
    this._envCallbacks.push(cb);
    if (this.envTexture) cb(this.envTexture);
  }

  _setEnvironment(tex, source, target) {
    const old = this.envTexture;
    const oldTarget = this._envTarget || null;
    this.envTexture = tex;
    this._envTarget = target || null;
    this.envSource = source;
    this.scene.environment = tex;
    for (const cb of this._envCallbacks) {
      try { cb(tex); } catch (e) { console.warn('[Sky] onEnvironment callback failed:', e.message); }
    }
    // PMREM のレンダーターゲット（FBO）ごと解放する。テクスチャだけ dispose すると FBO が残る
    if (oldTarget && oldTarget !== target && typeof oldTarget.dispose === 'function') oldTarget.dispose();
    else if (old && old !== tex && typeof old.dispose === 'function') old.dispose();
  }

  // 背景の球: 正距円筒図を内側から見る。SphereGeometry を z 反転すると three の環境マップと同じ向き
  // （equirect u = atan2(dir.z, dir.x)/2π + 0.5）になり、面も内向きになるので FrontSide のまま描ける
  _loadBackground(assets, key) {
    let p;
    try { p = Promise.resolve(assets.loadTexture(key, { srgb: true, anisotropy: this.opts.anisotropy || 4 })); } catch (e) { p = Promise.reject(e); }
    return p.then((tex) => {
      if (this.disposed || !tex) return;
      tex.encoding = THREE.sRGBEncoding;
      const geo = new THREE.SphereGeometry(600, 48, 24);
      geo.scale(1, 1, -1);
      const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      mesh.name = 'skyBackground';
      mesh.position.copy(this.dome.position);
      this.scene.add(mesh);
      this.background = mesh;
      this.dome.visible = false;
      this.backgroundLoaded = true;
      this.source = 'files';
    }, (e) => {
      console.warn('[Sky] 空の画像を読めません。シェーダーの空のまま続けます:', key, e && e.message);
      this.source = 'procedural';
    });
  }

  _loadEnvironment(assets, key) {
    let p;
    try { p = Promise.resolve(assets.loadTexture(key, { srgb: true, anisotropy: 1 })); } catch (e) { p = Promise.reject(e); }
    return p.then((tex) => {
      if (this.disposed || !tex) return;
      if (!this.renderer || !THREE.PMREMGenerator || typeof THREE.PMREMGenerator.prototype.fromEquirectangular !== 'function') return;
      tex.encoding = THREE.sRGBEncoding;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      try {
        const target = pmrem.fromEquirectangular(tex);
        if (target && target.texture) this._setEnvironment(target.texture, 'files', target);
      } catch (e) {
        console.warn('[Sky] fromEquirectangular failed:', e.message);
      } finally {
        pmrem.dispose();
      }
    }, (e) => {
      console.warn('[Sky] 環境マップの画像を読めません。シェーダーの空から作った環境マップのまま続けます:', key, e && e.message);
    }).then(() => { if (this._resolveEnv) this._resolveEnv(this.envTexture); });
  }

  // カメラに追従させてドームの中心を常にプレイヤーに
  update(cameraPos) {
    this.dome.position.copy(cameraPos);
    if (this.background) this.background.position.copy(cameraPos);
    // 影のカメラもプレイヤー周辺に（followY: 足元の高さ。それ以外は地面）
    this.sun.target.position.set(cameraPos.x, this.opts.followY ? Math.max(0, cameraPos.y - 3) : 0, cameraPos.z);
    this.sun.position.copy(this.sunDir).multiplyScalar(this.opts.shadowDistance).add(this.sun.target.position);
  }

  dispose() {
    this.disposed = true;
    for (const m of [this.dome, this.background]) {
      if (!m) continue;
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    }
    this.background = null;
    this.scene.remove(this.hemi);
    this.scene.remove(this.sun);
    this.scene.remove(this.sun.target);
    if (this.sun.shadow && this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    if (this._envTarget) { this._envTarget.dispose(); this._envTarget = null; this.envTexture = null; }
    if (this.envTexture) { this.envTexture.dispose(); this.envTexture = null; }
    this.scene.environment = null;
  }
};
