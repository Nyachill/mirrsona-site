// 見た目の色調（MR.Look）。オーナーの「オフィスやビルの部分、映画のように色彩鮮やかに細かくしてください」（計画 notes/dev:
//   dev-notes/plans/cinematic-interiors.md の L1 / L2）。見た目だけ: 箱・nav・戦利品・スポーン・サーバーには触らない。
//
// ■ 色調のパス（gradeShader）: ガンマ補正（リニア → sRGB）を同じパスでしてから、明るさ（室内だけ gain）・S 字のコントラスト（pivot）・
//   彩度・vibrance（色の薄い所ほど上げる）・影と明るい所の色かぶり・黒の持ち上げ・ビネット。game.js の _setupComposer が
//   GammaCorrection + gradePass の代わりに入れる（全画面のパスが 1 つ減る）。
// ■ 室内の度合い k（0〜1）: InteriorsView.insideNow（カメラのいる建物の階。高架の下・コンコースは 0）を tau 秒でなめらかに。
//   k が書くのは 半球光の色（本体のシーンと銃のシーン game._vHemi。外の色は天気の sky.hemiBaseSky / hemiBaseGround があればそれ）・家具の材質の envMapIntensity・家具の持ち上げ（liftTarget）・
//   色調の uIndoor だけ。hemi.intensity・toneMappingExposure・ほかの材質の envMapIntensity には触らない（天気が持つ）。
// ■ 設定: game.json の render.look（タッチ端末は render.mobile.look を重ねる、レベルごとに render.look.levels.<レベル>）。
//   切る: render.look.enabled: false（ダウンロードするデータ）・URL ?look=0・MR.CONFIG.LOOK === false（?look=1 / true でいつも入れる）
window.MR = window.MR || {};

MR.Look = {
  // 1 段の深さまで重ねる（{ a: { b } } の b は丸ごと置き換えずに中を重ねる）
  _merge(a, b) {
    const o = Object.assign({}, a || {});
    for (const k of Object.keys(b || {})) {
      const v = b[k];
      o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? MR.Look._merge(o[k], v) : v;
    }
    return o;
  },

  // 使う設定（null = 切ってある）。render: config.render、touch: タッチ端末か、levelId: 今のレベル
  config(render, touch, levelId) {
    const r = render || {};
    let c = r.look;
    const q = (typeof location !== 'undefined' && location.search) || '';
    const force = /[?&]look=1/.test(q) || (MR.CONFIG && MR.CONFIG.LOOK === true);
    if (/[?&]look=0/.test(q) || (MR.CONFIG && MR.CONFIG.LOOK === false)) return null;
    if (!c) return null;
    if (touch && r.mobile && r.mobile.look) c = MR.Look._merge(c, r.mobile.look);
    if (c.levels && levelId && c.levels[levelId]) c = MR.Look._merge(c, c.levels[levelId]);
    if (c.enabled === false && !force) return null;
    return c;
  },

  // 色調のシェーダー（ShaderPass 用）。入力はブルームの後のリニア（ACES 済み）、出力は sRGB
  gradeShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        uIndoor: { value: 0 },
        gain: { value: 1 },
        contrast: { value: 1.12 },
        pivot: { value: 0.42 },
        saturation: { value: 1.04 },
        vibrance: { value: 0.22 },
        lift: { value: 0.015 },
        liftColor: { value: new THREE.Vector3(0.05, 0.1, 0.15) },
        shadowTint: { value: new THREE.Vector3(0.16, 0.29, 0.4) },
        shadowAmt: { value: 0.08 },
        highTint: { value: new THREE.Vector3(1, 0.69, 0.4) },
        highAmt: { value: 0.06 },
        vignette: { value: 0.3 },
        // レンズの水滴（MR.WaterFX の lens。game.js の gradeShader と同じ式。uLens が 0 なら uniform の分岐だけ）
        uLens: { value: 0 }, uLensT: { value: 0 }, uAspect: { value: 1.6 }, uLensCells: { value: 7 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform float uIndoor; uniform float gain; uniform float contrast; uniform float pivot;',
        'uniform float saturation; uniform float vibrance; uniform float lift; uniform vec3 liftColor;',
        'uniform vec3 shadowTint; uniform float shadowAmt; uniform vec3 highTint; uniform float highAmt; uniform float vignette;',
        'uniform float uLens; uniform float uLensT; uniform float uAspect; uniform float uLensCells;',
        'varying vec2 vUv;',
        'float lHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }',
        'vec3 mrToSRGB(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }',
        // S 字: pivot より下は pivot·(x/pivot)^c、上は 1 − (1 − pivot)·((1 − x)/(1 − pivot))^c（0・pivot・1 は動かない）
        'float mrCurve(float x) {',
        '  x = clamp(x, 0.0, 1.0);',
        '  return x < pivot ? pivot * pow(x / pivot, contrast) : 1.0 - (1.0 - pivot) * pow((1.0 - x) / (1.0 - pivot), contrast);',
        '}',
        'void main() {',
        '  vec2 uv = vUv;',
        '  float lm = 0.0, lrim = 0.0, lspec = 0.0;',
        '  if (uLens > 0.001) {',
        '    vec2 p = vec2(vUv.x * uAspect, vUv.y) * uLensCells;',
        '    vec2 cell = floor(p), f = fract(p);',
        '    float h = lHash(cell), h2 = lHash(cell + 17.3), h3 = lHash(cell + 41.7);',
        '    float per = 2.2 + 2.6 * h2;',
        '    float ph = fract(uLensT / per + h);',
        '    float on = smoothstep(h3 - 0.08, h3, uLens * 0.85);',
        '    vec2 ctr = vec2(0.25 + 0.5 * h, 0.75 - 0.5 * h2 * 0.5 - ph * 0.35 * h3);',
        '    float r = 0.07 + 0.15 * fract(h * 7.31);',
        '    vec2 d = f - ctr; d.y *= 1.0 + ph * 0.6;',
        '    float q = length(d) / r;',
        '    lm = on * (1.0 - smoothstep(0.75, 1.0, q)) * (1.0 - smoothstep(0.6, 1.0, ph)) * smoothstep(0.0, 0.05, ph);',
        '    lrim = lm * smoothstep(0.7, 0.98, q);',
        '    uv = vUv + d / uLensCells * vec2(1.0 / uAspect, 1.0) * lm * 2.2;',
        '    vec2 hl = d / r - vec2(-0.35, 0.4);',
        '    lspec = lm * (1.0 - smoothstep(0.0, 0.22, length(hl)));',
        '    uv = 1.0 - abs(1.0 - abs(uv));',
        '  }',
        '  vec4 t = texture2D(tDiffuse, uv);',
        '  vec3 c = mrToSRGB(max(t.rgb * gain, vec3(0.0)));',
        '  if (lm > 0.0) c = c * (1.0 - 0.35 * lrim) * (1.0 + 0.08 * lm) + vec3(0.55) * lspec;',
        '  c = vec3(mrCurve(c.r), mrCurve(c.g), mrCurve(c.b));',
        '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
        '  float ch = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));',
        '  c = mix(vec3(l), c, saturation * (1.0 + vibrance * (1.0 - clamp(ch * 2.0, 0.0, 1.0))));',
        '  float ws = (1.0 - l) * (1.0 - l), wh = l * l;',
        '  c = mix(c, shadowTint, shadowAmt * ws);',
        '  c = mix(c, highTint, highAmt * wh);',
        '  c = c + (vec3(1.0) - c) * liftColor * lift;',
        '  vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);',
        '  c *= 1.0 - smoothstep(0.35, 1.05, length(d) * 1.4142) * vignette;',
        '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);',
        '}'
      ].join('\n')
    };
  },

  // ゲームごとの状態（game.js が作る）。cfg = config() の結果
  create(game, cfg) { return new MR.Look.State(game, cfg); }
};

MR.Look.State = class LookState {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    const g = cfg.grade || {};
    this.out = Object.assign({}, MR.Look.GRADE, g.outdoor || {});
    this.ind = Object.assign({}, this.out, g.indoor || {});
    const ind = cfg.indoor || {};
    this.tau = ind.tau == null ? 0.5 : ind.tau;
    this.k = 0;
    this.kTarget = 0;
    this.pass = null;
    this._tmp = new THREE.Color();
    this.hemiSky = MR.srgb(ind.hemiSky || '#fff0dc');
    this.hemiGround = MR.srgb(ind.hemiGround || '#3a3530');
    this.liftOut = ind.liftOut == null ? 0 : ind.liftOut;
    this.liftIn = ind.lift == null ? 0.05 : ind.lift;
    this.furnEnv = ind.furnEnv == null ? 0.35 : ind.furnEnv;
    this.base = null;     // 開始時の半球光の色（本体・銃のシーン）
    // 色調の色は 1 回だけ読む（毎フレーム作らない）
    const V = LookState._v3;
    this.col = {
      liftA: V(this.out.liftColor, '#0d1a26'), liftB: V(this.ind.liftColor, '#0d1a26'), shA: V(this.out.shadowTint, '#2a4a66'), shB: V(this.ind.shadowTint, '#1f3550'),
      hiA: V(this.out.highTint, '#ffb066'), hiB: V(this.ind.highTint, '#ffcf99')
    };
    this.stats = { updates: 0, kMax: 0 };
  }

  // 色の文字列 / 配列 → Vector3（sRGB の 0〜1。色調のパスは sRGB の後で混ぜる）
  static _v3(v, def) {
    if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
    const h = typeof v === 'string' ? v : def;
    const n = parseInt(h.replace('#', ''), 16);
    return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // composer に入れる色調のパス（ガンマ補正込み）
  makePass() {
    const p = new THREE.ShaderPass(MR.Look.gradeShader());
    this.pass = p;
    this._apply(0);
    return p;
  }

  // 半球光の元の色を覚える（world・sky を作った後に 1 回）
  captureBase() {
    const G = this.game, list = [];
    if (G.sky && G.sky.hemi) list.push(G.sky.hemi);
    if (G._vHemi) list.push(G._vHemi);
    this.base = list.map((h) => ({ h, sky: h.color.clone(), ground: h.groundColor.clone() }));
    const fv = G.world && G.world.furnView;
    if (fv && G.sky && G.sky.sunDir) fv.sunDir = G.sky.sunDir; // 窓の日なたの向き
  }

  _apply(k) {
    const U = this.pass && this.pass.uniforms;
    if (U) {
      const a = this.out, b = this.ind, L = (x, y) => x + (y - x) * k;
      U.uIndoor.value = k;
      U.gain.value = L(a.gain, b.gain);
      U.contrast.value = L(a.contrast, b.contrast);
      U.pivot.value = L(a.pivot, b.pivot);
      U.saturation.value = L(a.saturation, b.saturation);
      U.vibrance.value = L(a.vibrance, b.vibrance);
      U.lift.value = L(a.lift, b.lift);
      // 黒の持ち上げの色は一番明るい成分を 1 に（lift がそのまま黒の明るさ）
      const C = this.col;
      const lc = U.liftColor.value.lerpVectors(C.liftA, C.liftB, k);
      lc.multiplyScalar(1 / Math.max(1e-3, lc.x, lc.y, lc.z));
      U.shadowTint.value.lerpVectors(C.shA, C.shB, k);
      U.shadowAmt.value = L(a.shadowAmt, b.shadowAmt);
      U.highTint.value.lerpVectors(C.hiA, C.hiB, k);
      U.highAmt.value = L(a.highAmt, b.highAmt);
      U.vignette.value = L(a.vignette, b.vignette);
    }
    // 外の色: 天気があれば天気が決めた今の色（sky.hemiBaseSky / hemiBaseGround。雨・霧で灰色に）、無ければ開始時の色。k = 0 で外の色そのまま
    const sky = this.game.sky, bS = sky && sky.hemiBaseSky, bG = sky && sky.hemiBaseGround;
    if (this.base) for (const e of this.base) {
      e.h.color.copy(bS || e.sky).lerp(this.hemiSky, k);
      e.h.groundColor.copy(bG || e.ground).lerp(this.hemiGround, k);
    }
    const fv = this.game.world && this.game.world.furnView;
    if (fv) {
      fv.liftTarget = this.liftOut + (this.liftIn - this.liftOut) * k;
      if (fv.boxMat) fv.boxMat.envMapIntensity = 1 + (this.furnEnv - 1) * k;
    }
  }

  // 毎フレーム（game._update から）
  update(dt) {
    const w = this.game.world, fv = w && w.furnView, lv = this.game.lift && this.game.lift.view;
    // 家具のある建物の階・Sky High のロビー（lift_view.js。b15）・船の中（S2）
    this.kTarget = (fv && fv.insideNow) || (lv && lv.inside) || (w && w.shipInside) ? 1 : 0;
    const a = this.tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / this.tau) : 1;
    let k = this.k + (this.kTarget - this.k) * a;
    if (Math.abs(k - this.kTarget) < 0.002) k = this.kTarget;
    this.k = k;
    if (!this.base) this.captureBase();
    this._apply(k);
    this.stats.updates++;
    if (k > this.stats.kMax) this.stats.kMax = k;
  }

  // 天気（weather_view.js）が半球光の色を天気の色（sky.hemiBaseSky / hemiBaseGround）に書き直した後に、同じ k でもう一度混ぜる
  //   （game._update: weatherView.update の後。天気が無いゲームでは呼ばれない）
  reapply() { if (this.base) this._apply(this.k); }

  info() { return { k: +this.k.toFixed(3), target: this.kTarget, pass: !!this.pass, updates: this.stats.updates }; }

  // 止める（もう一度の前）: 半球光の色を戻す
  dispose() {
    if (this.base) for (const e of this.base) { e.h.color.copy(e.sky); e.h.groundColor.copy(e.ground); }
    this.base = null;
  }
};

// 色調の既定値（render.look.grade.outdoor / indoor が無いキー）
MR.Look.GRADE = { gain: 1, contrast: 1.12, pivot: 0.42, saturation: 1.04, vibrance: 0.22, lift: 0.015, liftColor: '#0d1a26',
  shadowTint: '#2a4a66', shadowAmt: 0.08, highTint: '#ffb066', highAmt: 0.06, vignette: 0.3 };
