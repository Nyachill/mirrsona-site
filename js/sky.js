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
// 天気（weather_view.js が天気のあるゲームだけ毎フレーム呼ぶ）: applyWeather(p) が太陽・半球光（強さと色）・霧の色・背景の明るさを変える（元の値は weatherBase）。
//   半球光の天気の色は hemiBaseSky / hemiBaseGround（THREE.Color。天気の無いゲームでは作ったときの色のまま）: 半球光の色を変えるほかの見た目
//   （室内の色を混ぜる等）は applyWeather の後に、この 2 つから混ぜて hemi.color / groundColor に書く。強さ・露出・環境マップの強さは天気が持つ
// 時間帯（tod.js。game.js が level.sky にプリセットを重ねた opts を渡す）: hemiSky / hemiGround / fogColor（hex。無ければ空の色から）、
//   disc: false（太陽の円盤なし）・moon / stars（画像が無いときシェーダーの空に星）。違う画像の組の空を作ると前の組を外す（_settleResident）
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
      sunDir: { value: sunDir.clone() },
      // 時間帯（tod.js）: 太陽の円盤（disc: false = 夜明け前・夜は描かない）と、画像が無いときの星（stars / moon）。夕方は 1 / 0 = 今までと同じ色
      uDisc: { value: this.opts.disc === false ? 0 : 1 },
      uStars: { value: this.opts.stars != null ? +this.opts.stars : (this.opts.moon ? 1 : 0) }
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
        'uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform vec3 sunDir; uniform float uDisc; uniform float uStars;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float h = d.y;',
        '  vec3 sky = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));',
        '  vec3 below = mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));',
        '  vec3 col = h >= 0.0 ? sky : below;',
        '  float s = max(dot(d, sunDir), 0.0);',
        '  col += sunColor * (pow(s, 900.0) * 1.4 * uDisc + (pow(s, 14.0) * 0.28 + pow(s, 3.0) * 0.08) * (0.3 + 0.7 * uDisc));',
        // 星（画像の無い夜だけ。uStars 0 なら足すのは 0）: 方向を格子に切ってハッシュ
        '  if (uStars > 0.0 && h > 0.0) {',
        '    vec3 q = floor(d * 380.0);',
        '    float hs = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
        '    col += vec3(0.75, 0.8, 1.0) * step(0.9975, hs) * (hs - 0.9975) * 400.0 * clamp(h * 5.0, 0.0, 1.0) * uStars;',
        '  }',
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
    //   時間帯（tod.js）の hemiSky / hemiGround（hex）があればその色（無ければ今まで通り空の色から）
    this.hemi = new THREE.HemisphereLight(this.opts.hemiSky ? MR.srgb(this.opts.hemiSky) : MR.srgb(this.opts.zenith).lerp(new THREE.Color(1, 1, 1), 0.35),
      this.opts.hemiGround ? MR.srgb(this.opts.hemiGround) : MR.srgb(this.opts.ground).lerp(MR.srgb(this.opts.horizon), 0.3), this.opts.hemiIntensity || 0.75);
    scene.add(this.hemi);
    // 外の半球光の色（空・地面の照り返し）。天気のあるゲームでは applyWeather が毎フレーム天気の色にして hemi.color / groundColor にも書く。
    //   ほかの見た目（室内の色など）が半球光の色を変えるときは、applyWeather の後にここから混ぜる（hemi.color を元にしない = 天気を上書きしない）
    this.hemiBaseSky = this.hemi.color.clone();
    this.hemiBaseGround = this.hemi.groundColor.clone();

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
    scene.fog = new THREE.Fog(this.opts.fogColor ? MR.srgb(this.opts.fogColor) : MR.srgb(this.opts.horizon).lerp(MR.srgb(this.opts.zenith), 0.25), this.opts.fogNear || 45, this.opts.fogFar || 140);

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
    // 時間帯を変えた「もう一度」: 前のゲームの空の画像の組（背景・環境マップの元）を GPU とキャッシュから外す（使う組だけを持つ。同じ組なら何もしない）
    if (canFiles) Sky._settleResident(assets, bgKey, envKey);
    this.source = bgKey ? 'files' : 'procedural';   // 背景の出所（読み込み失敗で procedural に戻る）
    this.backgroundLoaded = false;
    const jobs = [];
    if (bgKey) jobs.push(this._loadBackground(assets, bgKey));
    const wantEnv = !!(envKey && !this.noEnv && renderer);
    if (wantEnv) jobs.push(this._loadEnvironment(assets, envKey));
    else this._resolveEnv(this.envTexture);
    this.ready = Promise.all(jobs).then(() => this);
  }

  // 今の空の画像の組（ページに 1 つ）。違う組の空を作るとき、前の組のテクスチャを dispose してキャッシュから外す（画像も GC へ）。
  //   PMREM のレンダーターゲットは前のゲームの Sky.dispose が捨てる
  static _settleResident(assets, bgKey, envKey) {
    const prev = Sky._resident;
    Sky._resident = { assets, bg: bgKey, env: envKey };
    if (!prev || prev.assets !== assets) return 0;
    let n = 0;
    for (const k of [prev.bg, prev.env]) {
      if (!k || k === bgKey || k === envKey) continue;
      n += Sky.releaseTexture(assets, k);
    }
    Sky.released = (Sky.released || 0) + n;
    return n;
  }
  // 空の画像 1 つ（loadTexture(path, { srgb: true }) のキャッシュ）を GPU とキャッシュから外す。外したら 1
  static releaseTexture(assets, path) {
    if (!assets || typeof assets.textureKey !== 'function' || !assets.textureCache) return 0;
    const key = assets.textureKey(path, { srgb: true });
    const t = assets._texLoaded ? assets._texLoaded[key] : null;
    if (!t && !assets.textureCache[key]) return 0;
    if (t && typeof t.dispose === 'function') t.dispose();
    if (t && typeof assets.forgetTexture === 'function') assets.forgetTexture(t);
    delete assets.textureCache[key];
    if (assets._texLoaded) delete assets._texLoaded[key];
    return 1;
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

  // ---------- 天気（weather_view.js。天気の無いゲームでは呼ばれない = 今までと同じ）----------
  // 今の光・霧・背景の色を元の値として覚える（applyWeather の倍率の元。最初の 1 回だけ）。opts（weather_view.js）: 一面の曇りの半球光の色
  //   { hemiSky, hemiGround: リニアの [r, g, b], hemiOver: p.over に掛ける割合 }（無ければ色は変えない）
  weatherBase(opts) {
    if (!this._wx) {
      const u = this.uniforms;
      this._wx = {
        sunI: this.sun.intensity, sunC: this.sun.color.clone(), hemiI: this.hemi.intensity,
        hemiSky: this.hemi.color.clone(), hemiGround: this.hemi.groundColor.clone(), hemiSkyT: null, hemiGroundT: null, hemiOver: 0,
        fog: this.scene.fog ? this.scene.fog.color.clone() : null,
        zenith: u.zenith.value.clone(), horizon: u.horizon.value.clone(), ground: u.ground.value.clone(), sunColor: u.sunColor.value.clone(),
        tmp: new THREE.Color(), flash: new Float64Array([1, 1])
      };
    }
    if (opts && opts.hemiSky && opts.hemiGround) {
      const b = this._wx;
      b.hemiSkyT = new THREE.Color(opts.hemiSky[0], opts.hemiSky[1], opts.hemiSky[2]);
      b.hemiGroundT = new THREE.Color(opts.hemiGround[0], opts.hemiGround[1], opts.hemiGround[2]);
      b.hemiOver = typeof opts.hemiOver === 'number' && isFinite(opts.hemiOver) ? opts.hemiOver : 1;
    }
    return this._wx;
  }

  // p = MR.Weather の出力（毎フレーム。割り当て無し・シェーダーもテクスチャも変えない）。flash = 雷の光の倍率（1 = 無し）。省略すると
  //   weatherBase().flash（Float64Array: 0 半球光・1 太陽の倍率。weather_view.js が毎フレーム書く = 小数を引数で渡さない）。
  //   太陽: 強さ × sunMul、色 = mix(元の色, p.sunCol, p.hasSun)。半球光 × hemiMul、色 = mix(元の色, 曇りの色, p.over × hemiOver)
  //   （hemiBaseSky / hemiBaseGround に書いてから hemi に写す）。霧の色 = mix(元の色, p.fog, p.hasFog)。
  //   背景の球（画像）は色 × bgMul（MeshBasicMaterial の color）、画像が届く前のシェーダーの空も同じ倍率
  //   cols（任意。weather_view.js が時間帯の weather の色で直した物）: { sun, fog: リニアの [r, g, b] } = p.sunCol / p.fog の代わり（無ければ p のまま = 今まで通り）
  applyWeather(p, flash, cols) {
    // 色は成分ごとに書く（メソッドに小数を渡すと V8 が箱を作る = 毎フレームの割り当て。重みが 0 なら元の値そのまま）
    const b = this.weatherBase(), f = flash || b.flash[0], fs = flash || b.flash[1];
    this.sun.intensity = b.sunI * p.sunMul * fs;
    const sc = this.sun.color, bs = b.sunC, ps = cols ? cols.sun : p.sunCol, hs = p.hasSun;
    sc.r = bs.r + (ps[0] - bs.r) * hs; sc.g = bs.g + (ps[1] - bs.g) * hs; sc.b = bs.b + (ps[2] - bs.b) * hs;
    this.hemi.intensity = b.hemiI * p.hemiMul * f;
    {
      let w = b.hemiSkyT ? p.over * b.hemiOver : 0;
      w = w < 0 ? 0 : (w > 1 ? 1 : w);
      const oS = this.hemiBaseSky, oG = this.hemiBaseGround, s0 = b.hemiSky, g0 = b.hemiGround;
      if (w > 0) {
        const st = b.hemiSkyT, gt = b.hemiGroundT;
        oS.r = s0.r + (st.r - s0.r) * w; oS.g = s0.g + (st.g - s0.g) * w; oS.b = s0.b + (st.b - s0.b) * w;
        oG.r = g0.r + (gt.r - g0.r) * w; oG.g = g0.g + (gt.g - g0.g) * w; oG.b = g0.b + (gt.b - g0.b) * w;
      } else { oS.copy(s0); oG.copy(g0); }
      this.hemi.color.copy(oS); this.hemi.groundColor.copy(oG);
    }
    if (this.scene.fog && b.fog) {
      const fc = this.scene.fog.color, bf = b.fog, pf = cols ? cols.fog : p.fog, hf = p.hasFog;
      fc.r = bf.r + (pf[0] - bf.r) * hf; fc.g = bf.g + (pf[1] - bf.g) * hf; fc.b = bf.b + (pf[2] - bf.b) * hf;
    }
    const m = p.bgMul;
    if (this.background && this.background.material) { const c = this.background.material.color; c.r = m; c.g = m; c.b = m; }
    const u = this.uniforms;
    let c = u.zenith.value, o = b.zenith; c.r = o.r * m; c.g = o.g * m; c.b = o.b * m;
    c = u.horizon.value; o = b.horizon; c.r = o.r * m; c.g = o.g * m; c.b = o.b * m;
    c = u.ground.value; o = b.ground; c.r = o.r * m; c.g = o.g * m; c.b = o.b * m;
    const ms = m * (p.sunMul < 1 ? p.sunMul : 1);
    c = u.sunColor.value; o = b.sunColor; c.r = o.r * ms; c.g = o.g * ms; c.b = o.b * ms;
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
