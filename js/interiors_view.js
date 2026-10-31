// 建物の中の家具の見た目（MR.InteriorsView）。CityWorld が作り、world.update が毎フレーム呼ぶ。
//   メッシュは箱（12 三角形の単位の箱 × インスタンスの色）と天井の照明（光る四角、ブルームで光って見える。本物のライトは足さない）、
//   look.js があれば光の札（cards: 床の光のたまり・接地の影・窓の光。掛け算の合成）の 3 つ。
//   描くもの = 当たり判定に入っている家具（world.furn.added）のうち、カメラから interiorDist 以内の階（箱で測る）の全部
//   （当たるのに見えない家具を作らない）。建物の中にいるときはその建物は上下 1 階まで + ほかの建物の近くの階。
//   近い家具（detailDist 以内）は部品（MR.Interiors.expand）、遠い家具は箱 1 つ。飾り（椅子・モニター・植木）は nDist 以内だけ。
//   上限 maxBoxes / maxPanels を超えたら飾りから落とす（当たり判定の家具は先に全部入れる）。
//   見た目の殻（shell: 天井の板・壁の内張り。look.js が cfg.shell を立てたときだけ）は別の上限 maxShell で、interiorDist 以内の階の
//   天井の板を全部先に、次に内張りを近い階から（nDist / detailDist で落とさない）。
//   look.js の見た目（cfg.atlas > 0）: インスタンスごとに aCell（模様のセル・旗・光り方）。模様は Canvas のアトラス（MR.Textures.job の
//   furnitureAtlas / screenAtlas。update が 1 フレーム atlasMs ずつ作り、出来るまでは色だけ）をメートルの大きさで貼る。縁の明るい線・
//   床から 0.35 m の接地の暗さ。家具の色は階の照明からの距離で明るさを変え（lightBake）、窓の近くは少し青く（焼いた光）。
//   詰め直しはカメラが refillMove m 動いた・いる階が変わった・world.furnVer が変わったときだけ（行列と色を書くだけ）

// 階 g の家具ごとに、一番近い天井の照明からの明るさの割合（1 − 距離² / reach²。机の上の明るさの札）
function deskFalloff(P, Q, g, S, reach) {
  const F = new Float32Array(Math.max(0, g.p1 - g.p0)), r2 = reach * reach;
  for (let i = g.p0; i < g.p1; i++) {
    const o = i * S, cx = (P[o] + P[o + 3]) / 2, cz = (P[o + 2] + P[o + 5]) / 2;
    let best = Infinity;
    for (let q = g.q0; q < g.q1; q++) { const ex = Q[q * 4] - cx, ez = Q[q * 4 + 2] - cz, e2 = ex * ex + ez * ez; if (e2 < best) best = e2; }
    F[i - g.p0] = 1 - best / r2;
  }
  return F;
}

MR.InteriorsView = class InteriorsView {
  static get DX_CUTS() { return 8; } // 壊れた外壁の穴の数（destruct_view.js と同じ = CityWorld.CUT_SLOTS まで）
  static get DEFAULTS() {
    return { detailDist: 15, nDist: 12, refillMove: 2, maxBoxes: 6000, maxPanels: 600, indoorLift: 0.18, panelColor: '#fff3dc', panelIntensity: 1.6,
      shell: false, maxShell: 900, atlas: 0, atlasMs: 2, screenGlow: 0.8, contact: 0.72, edge: 0.12,
      lightBake: 0, coolNear: 3, coolMix: 0.08, coolColor: '#cfe0ff', poolRadius: { default: 1.8, warehouse: 4, workshop: 4 },
      cards: false, cardMax: 700, cardDist: 35, poolGain: 1.2, blobGain: -0.32, blobMargin: 0.3,
      windowFill: '#a8c8ff', windowFillGain: 0.45, windowFillDepth: 1.6, sunColor: '#ffb070', sunGain: 0.9, sunMax: 6, sunFacing: 0.2,
      dressDist: 0, glass: false, maxGlass: 400, glassColor: '#9fd0d8', glassOpacity: 0.28, bevel: 0.15, edgeWidth: 0.015,
      foliage: false, maxFoliage: 300, deskPoolGain: 0.8 };
  }

  constructor(world, cfg) {
    this.world = world;
    this.cfg = Object.assign({}, InteriorsView.DEFAULTS, cfg || {});
    this.cfg.poolRadius = Object.assign({}, InteriorsView.DEFAULTS.poolRadius, (cfg && cfg.poolRadius) || {});
    this.idist = world.cfg.interiorDist || 45;
    const I = MR.Interiors;
    this.colors = I.colors.map((h) => MR.srgb(h));
    this.cool = MR.srgb(this.cfg.coolColor);
    // 単位の箱（原点は底の真ん中 = インスタンスの y は下端）。底の面は残す（天井の板・机の天板を下から見る）
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    box.clearGroups();
    box.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.boxGeo = box;
    this.shellOn = !!this.cfg.shell;
    const cap = Math.max(1, this.cfg.maxBoxes) + (this.shellOn ? Math.max(0, this.cfg.maxShell | 0) : 0);
    // インスタンスごとの aCell = (セル 0..15 家具のアトラス / 16..31 画面 / 255 なし, 旗 1 = 床に着く（接地の暗さ）・2 = 縁の線なし, 光り方 × 100, 予備)
    this.cell = new THREE.InstancedBufferAttribute(new Uint8Array(cap * 4), 4);
    this.cell.setUsage(THREE.DynamicDrawUsage);
    box.setAttribute('aCell', this.cell);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    mat.name = 'furniture';
    this.lift = { value: 0 };
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    white.needsUpdate = true;
    this._white = white;
    const L = (I.cfg && I.cfg.look) || {};
    const cells = L.cells || {};
    const tile = [], own = [];
    for (let i = 0; i < 16; i++) { tile.push((cells.tile && cells.tile[i]) || 0.5); own.push((cells.own && cells.own[i]) || 0); }
    this.U = {
      uLift: this.lift, uAtlas: { value: white }, uScreen: { value: white }, uAtlasOn: { value: 0 }, uContact: { value: this.cfg.contact },
      uEdge: { value: this.cfg.edge }, uTile: { value: tile }, uOwn: { value: own }, uAtlasPx: { value: 1024 }, uBevel: { value: this.cfg.bevel }, uEdgeW: { value: this.cfg.edgeWidth },
      // 壊れた外壁の穴（destruct_view.js _farCuts が近い穴を DX_CUTS 個まで書く）: その箱の中の家具・壁の内張り（殻）は描かない（穴の内側に内張りが残って
      //   壁のように見えた）。床は壊れないので家具は浮かない（穴の箱にかかる面だけ切れる）
      uDxC0: { value: Array.from({ length: InteriorsView.DX_CUTS }, () => new THREE.Vector3(1, 1, 1)) },
      uDxC1: { value: Array.from({ length: InteriorsView.DX_CUTS }, () => new THREE.Vector3(0, 0, 0)) }, uDxN: { value: 0 }
    };
    const U = this.U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = [
        'attribute vec4 aCell;', 'uniform float uTile[16];', 'uniform float uOwn[16];',
        'varying vec4 vCell; varying vec2 vMUv; varying vec2 vFPos; varying vec2 vFSize; varying float vHgt; varying float vTile; varying float vOwn; varying float vFlip; varying vec3 vMrW;'
      ].join('\n') + '\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '  vCell = aCell;',
        '  #ifdef USE_INSTANCING',
        '  vec3 mrS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));',
        '  vec3 mrW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;',
        '  #else',
        '  vec3 mrS = vec3(1.0); vec3 mrW = (modelMatrix * vec4(position, 1.0)).xyz;',
        '  #endif',
        '  vMrW = mrW;',
        '  vec3 mrL = position + vec3(0.5, 0.0, 0.5);',
        '  vec3 mrN = abs(normal);',
        '  if (mrN.y > 0.5) { vMUv = mrW.xz; vFPos = mrL.xz * mrS.xz; vFSize = mrS.xz; }',
        '  else if (mrN.x > 0.5) { vMUv = mrW.zy; vFPos = vec2(mrL.z * mrS.z, mrL.y * mrS.y); vFSize = mrS.zy; }',
        '  else { vMUv = mrW.xy; vFPos = vec2(mrL.x * mrS.x, mrL.y * mrS.y); vFSize = mrS.xy; }',
        '  vHgt = mrL.y * mrS.y;',
        '  vFlip = (normal.z < -0.5 || normal.x > 0.5) ? 1.0 : 0.0;', // 外から見て左右が逆になる面（画面・看板の字）
        '  int mrCi = int(clamp(floor(aCell.x + 0.5), 0.0, 15.0));',
        '  vTile = uTile[mrCi]; vOwn = uOwn[mrCi];'
      ].join('\n'));
      sh.fragmentShader = [
        'uniform float uLift; uniform sampler2D uAtlas; uniform sampler2D uScreen; uniform float uAtlasOn; uniform float uContact; uniform float uEdge; uniform float uAtlasPx; uniform float uBevel; uniform float uEdgeW;',
        'varying vec4 vCell; varying vec2 vMUv; varying vec2 vFPos; varying vec2 vFSize; varying float vHgt; varying float vTile; varying float vOwn; varying float vFlip; varying vec3 vMrW;',
        'uniform vec3 uDxC0[' + InteriorsView.DX_CUTS + ']; uniform vec3 uDxC1[' + InteriorsView.DX_CUTS + ']; uniform int uDxN;'
      ].join('\n') + '\n' + sh.fragmentShader.replace('#include <map_fragment>', [
        '#include <map_fragment>',
        '  for (int i = 0; i < ' + InteriorsView.DX_CUTS + '; i++) { if (i >= uDxN) break; if (all(greaterThan(vMrW, uDxC0[i])) && all(lessThan(vMrW, uDxC1[i]))) discard; }',
        '  float mrCell = floor(vCell.x + 0.5), mrFl = floor(vCell.y + 0.5);',
        '  vec3 mrEm = vec3(0.0);',
        '  if (uAtlasOn > 0.5 && mrCell < 15.5) {',
        '    vec2 mrT = vMUv / vTile;',
        '    vec2 mrC = vec2(mod(mrCell, 4.0), 3.0 - floor(mrCell / 4.0));', // Canvas の上の行が uv の上（flipY）
        '    float mrCs = uAtlasPx / 4.0;', // セルの大きさ（px）。縁 4 px は余白
        '    vec2 mrUv = (mrC * mrCs + 4.0 + fract(mrT) * (mrCs - 8.0)) / uAtlasPx;',
        '    #if __VERSION__ >= 300',
        '    vec2 mrG = mrT * ((mrCs - 8.0) / uAtlasPx);',
        '    vec3 mrX = textureGrad(uAtlas, mrUv, dFdx(mrG), dFdy(mrG)).rgb;',
        '    #else',
        '    vec3 mrX = texture2D(uAtlas, mrUv).rgb;',
        '    #endif',
        '    mrX = pow(mrX, vec3(2.2));',
        '    diffuseColor.rgb = vOwn > 0.5 ? mix(diffuseColor.rgb, mrX, 0.85) : diffuseColor.rgb * mrX * 2.0;',
        '  } else if (uAtlasOn > 0.5 && mrCell > 41.5 && mrCell < 47.5) {',
        // 42〜47: 棚の商品の正面（色の板。横に 0.5 m ごとに繰り返す）
        '    float mrS = mrCell - 16.0;',
        '    vec2 mrF = vec2(fract(vFPos.x / 0.5), clamp(vFPos.y / max(vFSize.y, 1e-3), 0.02, 0.98));',
        '    if (vFlip > 0.5) mrF.x = 1.0 - mrF.x;',
        '    mrF.x = 0.02 + mrF.x * 0.96;',
        '    diffuseColor.rgb = pow(texture2D(uScreen, (vec2(mod(mrS, 4.0), 7.0 - floor(mrS / 4.0)) + mrF) / vec2(4.0, 8.0)).rgb, vec3(2.2));',
        '  } else if (uAtlasOn > 0.5 && mrCell > 15.5 && mrCell < 41.5) {',
        '    float mrS = mrCell - 16.0;',
        '    vec2 mrF = clamp(vFPos / max(vFSize, vec2(1e-3)), 0.03, 0.97);',
        '    if (vFlip > 0.5) mrF.x = 1.0 - mrF.x;',
        '    vec3 mrX = texture2D(uScreen, (vec2(mod(mrS, 4.0), 7.0 - floor(mrS / 4.0)) + mrF) / vec2(4.0, 8.0)).rgb;', // 4 × 8（上の 4 行が画面、下の 4 行が看板）
        '    mrEm = pow(mrX, vec3(2.2)) * (vCell.z / 100.0);',
        '  }',
        '  if (uAtlasOn > 0.5) {',
        // 縁の明るい線（2 = なし）・床から 0.35 m の接地の暗さ（1 = 床に着く物）
        '    if (mod(mrFl, 4.0) < 1.5) {',
        '      vec2 mrE2 = min(vFPos, vFSize - vFPos);',
        '      float mrE = min(mrE2.x, mrE2.y);',
        '      if (min(vFSize.x, vFSize.y) > 0.06) {',
        '        diffuseColor.rgb += (1.0 - smoothstep(uEdgeW * 0.25, uEdgeW, mrE)) * uEdge * (vec3(1.0) - diffuseColor.rgb);', // 縁の明るい線
        '        diffuseColor.rgb *= 1.0 - uBevel * (smoothstep(uEdgeW, uEdgeW * 1.3, mrE) - smoothstep(uEdgeW * 1.5, uEdgeW * 2.2, mrE));', // その内側の細い影（面取り）
        '      }',
        '    }',
        '    if (mod(mrFl, 2.0) > 0.5) diffuseColor.rgb *= mix(uContact, 1.0, smoothstep(0.0, 0.35, vHgt));',
        '  }'
      ].join('\n')).replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * (uLift + (mrCell > 15.5 && mrCell < 41.5 ? 0.0 : vCell.z / 100.0)) + mrEm;');
    };
    mat.customProgramCacheKey = () => 'furnLook';
    this.boxMat = mat;
    this.boxes = new THREE.InstancedMesh(box, mat, cap);
    this.boxes.name = 'furniture';
    this.boxes.castShadow = false;
    this.boxes.receiveShadow = true;
    this.boxes.matrixAutoUpdate = false;
    this.boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 色つきのインスタンスを 1 つ（instanceColor のあるシェーダーで最初から作る。見えない大きさ 0）
    this.boxes.setColorAt(0, this.colors[0] || new THREE.Color(0.5, 0.5, 0.5));
    this.boxes.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._zero(this.boxes.instanceMatrix.array, 0);
    this.boxes.count = 1;
    // 天井の照明（下向きの 1.2 × 0.6）
    const pg = new THREE.PlaneGeometry(1.2, 0.6);
    pg.rotateX(Math.PI / 2);
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.panelGeo = pg;
    this.panelColor = MR.srgb(this.cfg.panelColor);
    const pc = this.panelColor.clone().multiplyScalar(this.cfg.panelIntensity);
    this.panelMat = new THREE.MeshBasicMaterial({ color: pc, toneMapped: false });
    this.panelMat.name = 'furniturePanel';
    const np = Math.max(1, this.cfg.maxPanels | 0);
    this.panels = new THREE.InstancedMesh(pg, this.panelMat, np);
    this.panels.name = 'furniturePanels';
    this.panels.matrixAutoUpdate = false;
    this.panels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._zero(this.panels.instanceMatrix.array, 0);
    this.panels.count = this.cfg.maxPanels > 0 ? 1 : 0;
    this.panels.visible = this.cfg.maxPanels > 0;
    // 照明の色（look: テナント / 使い方の panel の色。look なしは白 = 今まで通り panelColor）
    this._panelWhite = new THREE.Color(1, 1, 1); // look なし: 色は panelMat の色だけ（今まで通り）
    this.panels.setColorAt(0, this._panelWhite);
    this.panels.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (this.shellOn) this.panelMat.color.setScalar(this.cfg.panelIntensity);
    world.root.add(this.boxes);
    world.root.add(this.panels);
    // ガラス（L10: ブースの上のすりガラスなど 'glass' の役の部品を半透明に。当たり判定の箱はそのまま。+1 描画）
    this.glass = null;
    if (this.cfg.glass && this.cfg.maxGlass > 0) {
      const gm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: this.cfg.glassOpacity, depthWrite: false });
      gm.name = 'furnitureGlass';
      this.glassMat = gm;
      this.glass = new THREE.InstancedMesh(box, gm, this.cfg.maxGlass | 0);
      this.glass.name = 'furnitureGlass';
      this.glass.matrixAutoUpdate = false;
      this.glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.glass.setColorAt(0, MR.srgb(this.cfg.glassColor));
      this.glass.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this._zero(this.glass.instanceMatrix.array, 0);
      this.glass.count = 1;
      this.glass.renderOrder = 2;
      this._glassSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      world.root.add(this.glass);
    }
    // 植物（look: 'leaves' のセルの部品を十字の葉の板 3 枚に。alphaTest で切る。+1 描画。葉のテクスチャができるまでは箱のまま）
    this.foliage = null; this._folReady = false;
    if (this.cfg.foliage && this.cfg.maxFoliage > 0 && this.cfg.atlas > 0 && MR.Textures && MR.Textures.job && MR.Textures.job.foliage) {
      const parts = [];
      for (let k = 0; k < 3; k++) {
        const pl = new THREE.PlaneGeometry(1, 1);
        pl.translate(0, 0.5, 0);
        pl.rotateY(k * Math.PI / 3);
        parts.push(pl);
      }
      const fg = THREE.BufferGeometryUtils.mergeBufferGeometries(parts);
      for (const pl of parts) pl.dispose();
      fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      this.folGeo = fg;
      const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide });
      fm.name = 'furnitureFoliage';
      this.folMat = fm;
      this.foliage = new THREE.InstancedMesh(fg, fm, this.cfg.maxFoliage | 0);
      this.foliage.name = 'furnitureFoliage';
      this.foliage.matrixAutoUpdate = false;
      this.foliage.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.foliage.setColorAt(0, new THREE.Color(1, 1, 1));
      this.foliage.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this._zero(this.foliage.instanceMatrix.array, 0);
      this.foliage.count = 1;
      this.foliage.visible = false;
      world.root.add(this.foliage);
    }
    // 光の札（床の上 1 cm の四角。2 × 札 × 下の色 = 0.5 で変わらない、明るく / 暗く）
    this.cards = null;
    if (this.cfg.cards && this.cfg.cardMax > 0) this._makeCards();
    // アトラス（Canvas。少しずつ作る）
    this._atlasJobs = [];
    if (this.cfg.atlas > 0 && MR.Textures && MR.Textures.job && MR.Textures.job.furnitureAtlas) {
      this._atlasJobs.push({ it: MR.Textures.job.furnitureAtlas(this.cfg.atlas), set: (t) => { U.uAtlas.value = t; U.uAtlasPx.value = this.cfg.atlas; } });
      this._atlasJobs.push({ it: MR.Textures.job.screenAtlas(Math.max(256, this.cfg.atlas / 2)), set: (t) => { U.uScreen.value = t; U.uAtlasOn.value = 1; this._ver = -1; } });
      if (this.foliage) this._atlasJobs.push({ it: MR.Textures.job.foliage(), set: (t) => { this.folMat.map = t; this.folMat.needsUpdate = true; this._folReady = true; this.foliage.visible = true; this._ver = -1; } });
    }
    this.sunScale = 1;      // 窓の日なたの強さの倍率（時間帯: 太陽の強さ ÷ レベルの夕方の強さ。夜はほぼ 0）
    this.sunDir = null;      // look.js が sky.sunDir を渡す（窓の日なた）
    this._pos = new THREE.Vector3(1e9, 0, 0);
    this._ver = -1;
    this._floor = '';
    this.insideNow = null;   // カメラのいる建物の階（update で決める。look.js の室内の度合い k が読む）
    this.liftTarget = null;  // look.js が決める室内の持ち上げ（null = 今まで通り indoorLift）
    this.stats = { refills: 0, refillMs: 0, refillMsMax: 0, instances: 0, collidables: 0, near: 0, deco: 0, panels: 0, groups: 0, capHit: 0, capHitDeco: 0, inside: null,
      shell: 0, shellCeil: 0, shellDropped: 0, cards: 0, cardDropped: 0, atlasMsMax: 0, atlasSteps: 0, atlasReady: false };
  }

  _makeCards() {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const n = this.cfg.cardMax | 0;
    this.cardKind = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.cardKind.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCard', this.cardKind);
    this.cardGeo = g;
    const tex = MR.Textures && MR.Textures.lightCards ? MR.Textures.lightCards() : this._white;
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: [
        'attribute float aCard; varying vec2 vUv; varying vec3 vTint;',
        '#include <common>',
        'void main() {',
        '  vUv = vec2(uv.x, (uv.y + aCard) / 4.0);', // 128 × 512 の 4 段
        '  #ifdef USE_INSTANCING_COLOR', '  vTint = instanceColor;', '  #else', '  vTint = vec3(1.0);', '  #endif',
        '  vec3 transformed = position;',
        '  #include <project_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D map; varying vec2 vUv; varying vec3 vTint;',
        // 合成は 2 × 札 × 下の色: 札 0.5 で変わらない、0.5 + 0.5 × a で (1 + a) 倍
        'void main() { gl_FragColor = vec4(clamp(vec3(0.5) + 0.5 * vTint * texture2D(map, vUv).r, 0.0, 4.0), 1.0); }'
      ].join('\n'),
      transparent: true, depthWrite: false, fog: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    m.name = 'furnitureCards';
    this.cardMat = m;
    this.cards = new THREE.InstancedMesh(g, m, n);
    this.cards.name = 'furnitureCards';
    this.cards.matrixAutoUpdate = false;
    this.cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cards.setColorAt(0, new THREE.Color(0, 0, 0));
    this.cards.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._zero(this.cards.instanceMatrix.array, 0);
    this.cards.count = 1;
    this.cards.renderOrder = 1;
    this.world.root.add(this.cards);
  }

  _zero(a, i) { const o = i * 16; for (let k = 0; k < 16; k++) a[o + k] = 0; a[o + 15] = 1; }

  // カメラがいる建物の階（{ id, k } か null）
  _insideOf(cam) {
    const furn = this.world.furn;
    if (furn) for (const res of furn.added.values()) for (const g of res.groups) {
      if (cam.x >= g.x0 && cam.x <= g.x1 && cam.z >= g.z0 && cam.z <= g.z1 && cam.y >= g.y - 0.2 && cam.y <= g.top + 0.4) return g;
    }
    // 動く船の中の部屋（フェリーの客室。cityboats が world.shipRoomTest を置く）
    if (this.world.shipRoomTest) { const g = this.world.shipRoomTest(cam); if (g) return g; }
    // 船の中の部屋（citygen の shipRooms: 空母の艦橋など。家具は無い = 室内の度合いだけ）
    const rooms = this.world.city && this.world.city.shipRooms;
    if (rooms) for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if (cam.x >= r.x0 && cam.x <= r.x1 && cam.z >= r.z0 && cam.z <= r.z1 && cam.y >= r.y0 - 0.2 && cam.y <= r.y1 + 0.4) {
        if (!r.g) r.g = { id: 'ship', k: i, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y: r.y0, top: r.y1 };
        return r.g;
      }
    }
    return null;
  }

  // アトラスを 1 フレーム atlasMs ずつ（1 歩 2〜3 ms）
  _stepAtlas() {
    const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
    const t0 = now();
    while (this._atlasJobs.length && now() - t0 < this.cfg.atlasMs) {
      const j = this._atlasJobs[0], s0 = now();
      const r = j.it.next();
      const ms = now() - s0;
      this.stats.atlasSteps++;
      if (ms > this.stats.atlasMsMax) this.stats.atlasMsMax = ms;
      if (r.done) { j.set(r.value); this._atlasJobs.shift(); if (!this._atlasJobs.length) this.stats.atlasReady = true; }
    }
  }

  update(cam) {
    const furn = this.world.furn;
    const ins = this._insideOf(cam);
    this.insideNow = ins; // 家具が無くても船の部屋は数える（look の室内の度合い）
    if (!furn) return;
    if (this._atlasJobs.length) this._stepAtlas();
    // 室内の明るさ（建物の中にいるときだけ家具を少し持ち上げる。外からは夕方の暗い室内）。look.js があればその目標
    const tgt = this.liftTarget != null ? this.liftTarget : (ins ? this.cfg.indoorLift : 0);
    this.lift.value += (tgt - this.lift.value) * 0.08;
    if (Math.abs(this.lift.value - tgt) < 1e-3) this.lift.value = tgt;
    const fk = ins ? ins.id + ':' + ins.k : '';
    if (this._ver === furn.ver && fk === this._floor && this._pos.distanceToSquared(cam) < this.cfg.refillMove * this.cfg.refillMove) return;
    this._ver = furn.ver; this._floor = fk;
    this._pos.copy(cam);
    this.refill(cam, ins);
  }

  // 箱 g（x0..x1 × y..top × z0..z1）までの距離
  static _dist(cam, g) {
    const dx = Math.max(g.x0 - cam.x, 0, cam.x - g.x1), dz = Math.max(g.z0 - cam.z, 0, cam.z - g.z1), dy = Math.max(g.y - cam.y, 0, cam.y - g.top);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // 焼いた光（lightBake）: 家具ごとに [明るさの倍率, 窓の青さ]（階ごとに 1 回。元の値は interiors.js の emitBake = 家具の仕事の中で作る）。
  //   明るさ = clamp(1 + lightBake × (照明からの近さの和 − 階の平均), 0.8, 1.25)、窓（開口）から coolNear m 以内は coolMix まで青く
  _bake(res, g) {
    if (g._bk) return g._bk;
    const R = res.bake, cfg = this.cfg, n = g.p1 - g.p0, out = new Float32Array(n * 2);
    if (!R || R.length < g.p1 * 2) { for (let i = 0; i < n; i++) out[i * 2] = 1; g._bk = out; return out; }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += R[(g.p0 + i) * 2];
    const mean = n ? sum / n : 0;
    for (let i = 0; i < n; i++) {
      out[i * 2] = Math.max(0.8, Math.min(1.25, 1 + cfg.lightBake * (R[(g.p0 + i) * 2] - mean)));
      const d = R[(g.p0 + i) * 2 + 1];
      out[i * 2 + 1] = d < cfg.coolNear ? cfg.coolMix * (1 - d / cfg.coolNear) : 0;
    }
    g._bk = out;
    return out;
  }

  // interiorDist（と建物の中では上下 1 階）の外の家具は描かない（建物の間仕切りと同じ）。当たり判定には残るので、窓越し 35 m 先の棚は
  //   見えずに弾を止める（建物の中の壁と同じ割り切り）。maxBoxes の約束は「この範囲の当たる家具は必ず描く」
  refill(cam, ins) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const I = MR.Interiors, S = I.PSTRIDE, furn = this.world.furn, cfg = this.cfg;
    const idist = this.idist;
    const list = [];
    for (const res of furn.added.values()) for (const g of res.groups) {
      if (g.p1 === g.p0 && g.q1 === g.q0 && g.d1 === g.d0 && !(this.shellOn && g.s1 > g.s0)) continue;
      if (ins && g.id === ins.id && Math.abs(g.k - ins.k) > 1) continue;
      const d = InteriorsView._dist(cam, g);
      if (d > idist) continue;
      list.push({ g, res, d });
    }
    list.sort((a, b) => a.d - b.d);
    const mat = this.boxes.instanceMatrix.array, col = this.boxes.instanceColor.array, cols = this.colors, cel = this.cell.array;
    const cof = I.cellOfColor, look = cfg.atlas > 0 || cfg.lightBake > 0;
    let max = this.boxes.instanceMatrix.count;
    let n = 0, capHit = false, nearN = 0, coll = 0;
    // push の状態（今の家具の焼いた光・床の高さ、殻の模様・旗・光り方）
    let bk = 1, cw = 0, floorY = -1e9, sCell = -1, sFlags = 0, sGlow = 0;
    const cool = this.cool, screenGlow = Math.round(cfg.screenGlow * 100);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    // ガラス（'glass' の役 = セル 253）は透明なメッシュへ
    const G = this.glass, gmat = G ? G.instanceMatrix.array : null, gcol = G ? G.instanceColor.array : null, gmax = G ? G.instanceMatrix.count : 0;
    let gn = 0;
    const gtint = this.glass ? (this._gtint || (this._gtint = MR.srgb(cfg.glassColor))) : null; // 色は 1 回だけ読む（refill は毎回の詰め直し）
    const F = this._folReady ? this.foliage : null, fmat = F ? F.instanceMatrix.array : null, fcol = F ? F.instanceColor.array : null, fmax = F ? F.instanceMatrix.count : 0;
    let fn = 0;
    const leaves = I.cellIndex ? I.cellIndex('leaves') : -1, glowOf = I.glowOfColor;
    const push = (x, y, z, w, h, d, c) => {
      if (F && sCell < 0 && look && cof && cof[c] === leaves && fn < fmax) {
        // 葉: 箱より少し大きい十字の板（鉢の上に茂る）
        const o = fn * 16, sw = Math.max(w, d) * 1.35, sh = h * 1.2, a = (x * 3.7 + z * 5.3) % 6.283;
        const cs = Math.cos(a), sn = Math.sin(a);
        fmat[o] = cs * sw; fmat[o + 1] = 0; fmat[o + 2] = -sn * sw; fmat[o + 3] = 0; fmat[o + 4] = 0; fmat[o + 5] = sh; fmat[o + 6] = 0; fmat[o + 7] = 0;
        fmat[o + 8] = sn * sw; fmat[o + 9] = 0; fmat[o + 10] = cs * sw; fmat[o + 11] = 0; fmat[o + 12] = x; fmat[o + 13] = y - h * 0.1; fmat[o + 14] = z; fmat[o + 15] = 1;
        const cc = cols[c] || cols[0];
        fcol[fn * 3] = cc.r * bk; fcol[fn * 3 + 1] = cc.g * bk; fcol[fn * 3 + 2] = cc.b * bk;
        fn++;
        if (x - sw < minX) minX = x - sw; if (x + sw > maxX) maxX = x + sw; if (y < minY) minY = y; if (y + sh > maxY) maxY = y + sh;
        if (z - sw < minZ) minZ = z - sw; if (z + sw > maxZ) maxZ = z + sw;
        return true;
      }
      if (G && sCell < 0 && look && cof && cof[c] === 253) {
        if (gn >= gmax) return true;
        const o = gn * 16;
        gmat[o] = w; gmat[o + 1] = 0; gmat[o + 2] = 0; gmat[o + 3] = 0; gmat[o + 4] = 0; gmat[o + 5] = h; gmat[o + 6] = 0; gmat[o + 7] = 0;
        gmat[o + 8] = 0; gmat[o + 9] = 0; gmat[o + 10] = d; gmat[o + 11] = 0; gmat[o + 12] = x; gmat[o + 13] = y; gmat[o + 14] = z; gmat[o + 15] = 1;
        gcol[gn * 3] = gtint.r; gcol[gn * 3 + 1] = gtint.g; gcol[gn * 3 + 2] = gtint.b;
        gn++;
        if (x - w / 2 < minX) minX = x - w / 2; if (x + w / 2 > maxX) maxX = x + w / 2; if (y < minY) minY = y; if (y + h > maxY) maxY = y + h; // 範囲（ガラスと葉も同じ球を使う）
        if (z - d / 2 < minZ) minZ = z - d / 2; if (z + d / 2 > maxZ) maxZ = z + d / 2;
        return true;
      }
      if (n >= max) return false;
      const o = n * 16;
      mat[o] = w; mat[o + 1] = 0; mat[o + 2] = 0; mat[o + 3] = 0;
      mat[o + 4] = 0; mat[o + 5] = h; mat[o + 6] = 0; mat[o + 7] = 0;
      mat[o + 8] = 0; mat[o + 9] = 0; mat[o + 10] = d; mat[o + 11] = 0;
      mat[o + 12] = x; mat[o + 13] = y; mat[o + 14] = z; mat[o + 15] = 1;
      const cc = cols[c] || cols[0], q = n * 3;
      let r = cc.r * bk, gg = cc.g * bk, b = cc.b * bk;
      if (cw > 0) { r += (cool.r * bk - r) * cw; gg += (cool.g * bk - gg) * cw; b += (cool.b * bk - b) * cw; }
      col[q] = r; col[q + 1] = gg; col[q + 2] = b;
      const a = n * 4;
      if (sCell >= 0) { cel[a] = sCell; cel[a + 1] = sFlags; cel[a + 2] = sGlow; }
      else {
        let ci = look && cof ? cof[c] : 255, gl = 0;
        if (ci === 16) { ci = 16 + ((Math.floor(x * 7.31 + z * 3.17) % 16) + 16) % 16; gl = screenGlow; }
        else if (ci === 42) ci = 42 + ((Math.floor(x * 5.13 + y * 11.7 + z * 2.91) % 6) + 6) % 6; // 棚の商品の正面（6 種）
        else if (glowOf && glowOf[c]) gl = glowOf[c]; // 冷蔵庫の中など光る色
        cel[a] = ci; cel[a + 1] = y <= floorY + 0.03 ? 1 : 0; cel[a + 2] = gl;
      }
      cel[a + 3] = 0;
      if (x - w / 2 < minX) minX = x - w / 2; if (x + w / 2 > maxX) maxX = x + w / 2;
      if (y < minY) minY = y; if (y + h > maxY) maxY = y + h;
      if (z - d / 2 < minZ) minZ = z - d / 2; if (z + d / 2 > maxZ) maxZ = z + d / 2;
      n++;
      return true;
    };
    const dd = cfg.detailDist * cfg.detailDist, nd = cfg.nDist * cfg.nDist;
    // 0: 殻。自分の上限 maxShell の中で、天井の板を全部（近い階から）→ 内張りを近い階から（家具の上限 maxBoxes には数えない）
    let shellN = 0, shellCeil = 0, shellDropped = 0;
    if (this.shellOn) {
      const SS = I.SSTRIDE, CEIL = I.SH.CEIL, NOC = I.SH.NOCONTACT, NOE = I.SH.NOEDGE, smax = Math.min(max, cfg.maxShell | 0);
      for (let pass = 0; pass < 2; pass++) for (const it of list) {
        const Q = it.res.shell, g = it.g;
        if (!Q) continue;
        for (let i = g.s0; i < g.s1; i++) {
          const o = i * SS, fl = Q[o + 9];
          if (((fl & CEIL) ? 0 : 1) !== pass) continue;
          if (n >= smax) { shellDropped++; continue; }
          sCell = look ? Q[o + 8] : 255;
          sFlags = ((fl & NOC) || Q[o + 1] > g.y + 0.03 ? 0 : 1) | (fl & NOE ? 2 : 0);
          sGlow = Math.round(Q[o + 7] * 100);
          push((Q[o] + Q[o + 3]) / 2, Q[o + 1], (Q[o + 2] + Q[o + 5]) / 2, Q[o + 3] - Q[o], Q[o + 4] - Q[o + 1], Q[o + 5] - Q[o + 2], Q[o + 6]);
          shellN++;
          if (pass === 0) shellCeil++;
        }
      }
      sCell = -1;
      max = n + Math.max(1, cfg.maxBoxes);
    }
    // 1: 当たり判定の家具（近くは部品、遠くは箱 1〜3 つ）。上限の中に当たり判定の家具が必ず全部入るよう、残りの家具の数（1 つ 1 箱）を
    //   取っておき、足りないときは部品・帯をやめて箱 1 つにする
    const nearList = [];
    let total = 0;
    for (const it of list) total += it.g.p1 - it.g.p0;
    for (const it of list) {
      const P = it.res.pieces, g = it.g;
      const B = cfg.lightBake > 0 && g.p1 > g.p0 ? this._bake(it.res, g) : null;
      floorY = g.y;
      for (let i = g.p0; i < g.p1; i++) {
        const o = i * S;
        const cx = (P[o] + P[o + 3]) / 2, cy = (P[o + 1] + P[o + 4]) / 2, cz = (P[o + 2] + P[o + 5]) / 2;
        const dx = cx - cam.x, dy = cy - cam.y, dz = cz - cam.z, d2 = dx * dx + dy * dy + dz * dz;
        if (n >= max) { capHit = true; break; }
        const rest = total - coll - 1; // この後の家具（1 つ 1 箱は取っておく）
        coll++;
        if (B) { bk = B[(i - g.p0) * 2]; cw = B[(i - g.p0) * 2 + 1]; }
        if (this.track) this.track.add(it.res.boxes[i]); // テスト（I8）: 描いた家具の当たり判定の箱
        if (d2 < dd && n + I.nearCount(P, i) + rest <= max) {
          I.expand(P, i, g.lu || g.use, g.variant, push, 1);
          nearN++;
          if (d2 < nd) nearList.push(it, i);
        } else I.far(P, i, g.lu || g.use, g.variant, push, n + I.farCount(P, i) + rest > max);
      }
      bk = 1; cw = 0;
      if (capHit) break;
    }
    // 2: 飾り（近くの家具の椅子・モニター、植木）
    let deco = 0, capDeco = false;
    if (!capHit && cfg.nDist > 0) {
      for (let q = 0; q < nearList.length; q += 2) {
        const it = nearList[q], i = nearList[q + 1];
        const n0 = n;
        const B = cfg.lightBake > 0 ? this._bake(it.res, it.g) : null;
        if (B) { bk = B[(i - it.g.p0) * 2]; cw = B[(i - it.g.p0) * 2 + 1]; }
        floorY = it.g.y;
        I.expand(it.res.pieces, i, it.g.lu || it.g.use, it.g.variant, push, 2);
        if (n >= max) { capDeco = true; break; }
        deco += n - n0;
      }
      bk = 1; cw = 0;
      if (!capDeco) for (const it of list) {
        const D = it.res.deco, g = it.g;
        floorY = g.y;
        for (let i = g.d0; i < g.d1; i++) {
          const o = i * 7, dx = D[o] - cam.x, dy = D[o + 1] - cam.y, dz = D[o + 2] - cam.z;
          if (dx * dx + dy * dy + dz * dz > nd) continue;
          if (!push(D[o], D[o + 1], D[o + 2], D[o + 3], D[o + 4], D[o + 5], D[o + 6])) { capDeco = true; break; }
          deco++;
        }
        if (capDeco) break;
      }
    }
    // 3: 飾り（L9: 机の上・壁・床。dressDist 以内、上限では一番先に落とす）
    let dressN = 0, dressDropped = 0;
    if (!capHit && cfg.dressDist > 0) {
      const RS = I.RSTRIDE, dd2 = cfg.dressDist * cfg.dressDist;
      for (const it of list) {
        const R = it.res.dress, g = it.g;
        if (!R || it.d > cfg.dressDist) continue;
        for (let i = g.r0 || 0; i < (g.r1 || 0); i++) {
          const o = i * RS, dx = R[o] - cam.x, dy = R[o + 1] - cam.y, dz = R[o + 2] - cam.z;
          if (dx * dx + dy * dy + dz * dz > dd2) continue;
          sCell = look ? R[o + 7] : 255; sFlags = 2; sGlow = R[o + 8];
          if (!push(R[o], R[o + 1], R[o + 2], R[o + 3], R[o + 4], R[o + 5], R[o + 6])) { dressDropped++; continue; }
          dressN++;
        }
      }
      sCell = -1;
    }
    if (F) {
      if (!fn) { this._zero(fmat, 0); fn = 1; fcol[0] = fcol[1] = fcol[2] = 0; }
      F.count = fn;
      F.instanceMatrix.needsUpdate = true;
      F.instanceColor.needsUpdate = true;
    }
    if (G) {
      if (!gn) { this._zero(gmat, 0); gn = 1; }
      G.count = gn;
      G.instanceMatrix.needsUpdate = true;
      G.instanceColor.needsUpdate = true;
      G.geometry.boundingSphere = this.boxGeo.boundingSphere; // 同じ形（家具の箱）の範囲
    }
    if (n === 0) { this._zero(mat, 0); n = 1; if (minX === Infinity) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; } }
    this.boxes.count = n;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.boxes.instanceColor.needsUpdate = true;
    this.cell.needsUpdate = true;
    const bs = this.boxGeo.boundingSphere;
    bs.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    bs.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 0.5;
    if (F) F.geometry.boundingSphere.copy(bs);
    // 照明
    let np = 0;
    const pmax = this.panels.instanceMatrix.count, pm = this.panels.instanceMatrix.array;
    let px0 = Infinity, pz0 = Infinity, py0 = Infinity, px1 = -Infinity, pz1 = -Infinity, py1 = -Infinity;
    if (cfg.maxPanels > 0) {
      const PC = this.panels.instanceColor.array;
      for (const it of list) {
        const Q = it.res.panels, g = it.g;
        if (g.q1 <= g.q0) continue;
        // 照明の色は階（g）ごとに 1 回（以前は照明 1 つごとに I.color の文字列の処理）
        const pcl = this.shellOn ? cols[I.color(g.lu || g.use, 'panel', 0)] || this.panelColor : this._panelWhite;
        for (let i = g.q0; i < g.q1 && np < pmax; i++) {
          const o = i * 4, x = Q[o], y = Q[o + 1], z = Q[o + 2], ax = Q[o + 3], b = np * 16;
          // 向き 1 = 長い辺が z（y 軸で 90° 回す）
          if (ax) { pm[b] = 0; pm[b + 1] = 0; pm[b + 2] = -1; pm[b + 8] = 1; pm[b + 9] = 0; pm[b + 10] = 0; }
          else { pm[b] = 1; pm[b + 1] = 0; pm[b + 2] = 0; pm[b + 8] = 0; pm[b + 9] = 0; pm[b + 10] = 1; }
          pm[b + 3] = 0; pm[b + 4] = 0; pm[b + 5] = 1; pm[b + 6] = 0; pm[b + 7] = 0; pm[b + 11] = 0;
          pm[b + 12] = x; pm[b + 13] = y; pm[b + 14] = z; pm[b + 15] = 1;
          const pc3 = np * 3;
          PC[pc3] = pcl.r; PC[pc3 + 1] = pcl.g; PC[pc3 + 2] = pcl.b;
          if (x < px0) px0 = x; if (x > px1) px1 = x; if (y < py0) py0 = y; if (y > py1) py1 = y; if (z < pz0) pz0 = z; if (z > pz1) pz1 = z;
          np++;
        }
        if (np >= pmax) break;
      }
      this.panels.count = Math.max(1, np);
      if (!np) { this._zero(pm, 0); px0 = py0 = pz0 = px1 = py1 = pz1 = 0; }
      this.panels.instanceMatrix.needsUpdate = true;
      this.panels.instanceColor.needsUpdate = true;
      const ps = this.panelGeo.boundingSphere;
      ps.center.set((px0 + px1) / 2, (py0 + py1) / 2, (pz0 + pz1) / 2);
      ps.radius = Math.hypot(px1 - px0, py1 - py0, pz1 - pz0) / 2 + 1;
    }
    if (this.cards) this._fillCards(cam, list);
    const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    const st = this.stats;
    st.refills++; st.refillMs = ms; if (ms > st.refillMsMax) st.refillMsMax = ms;
    st.instances = n; st.foliage = F ? fn : 0; st.dress = dressN; st.dressDropped = dressDropped; st.glass = G ? G.count : 0; st.shell = shellN; st.shellCeil = shellCeil; st.shellDropped = shellDropped; st.collidables = coll; st.near = nearN; st.deco = deco; st.panels = np; st.groups = list.length;
    if (capHit) st.capHit++;
    if (capDeco) st.capHitDeco++;
    st.inside = ins ? ins.id + ':' + ins.k : null;
    this.lastCapHit = capHit;
  }

  // 光の札: cardDist 以内の階の、照明の下の光のたまり（poolRadius）・床に着く家具の下の影・窓（開口）の内側の青い光と、太陽に向いた
  //   窓の日なた（長さは太陽の高さから、sunMax m まで）。近い階から cardMax まで
  _fillCards(cam, list) {
    const I = MR.Interiors, cfg = this.cfg, S = I.PSTRIDE, OS = I.OSTRIDE;
    const M = this.cards.instanceMatrix.array, C = this.cards.instanceColor.array, K = this.cardKind.array, max = this.cards.instanceMatrix.count;
    let n = 0, dropped = 0;
    let minX = Infinity, minZ = Infinity, minY = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = -Infinity;
    const put = (x, y, z, sx, sz, cs, sn, kind, r, g, b) => {
      if (n >= max) { dropped++; return; }
      const o = n * 16;
      M[o] = cs * sx; M[o + 1] = 0; M[o + 2] = -sn * sx; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = 1; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = sn * sz; M[o + 9] = 0; M[o + 10] = cs * sz; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
      K[n] = kind; C[n * 3] = r; C[n * 3 + 1] = g; C[n * 3 + 2] = b;
      const e = Math.max(sx, sz) / 2;
      if (x - e < minX) minX = x - e; if (x + e > maxX) maxX = x + e; if (z - e < minZ) minZ = z - e; if (z + e > maxZ) maxZ = z + e;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      n++;
    };
    const pc = this.panelColor, fill = this._fillC || (this._fillC = MR.srgb(cfg.windowFill)), sun = this._sunC || (this._sunC = MR.srgb(cfg.sunColor)), sd = this.sunDir;
    const elev = sd ? Math.max(0.12, Math.asin(Math.max(-1, Math.min(1, sd.y / (sd.length() || 1))))) : 0.5;
    // 2 回: 先に光のたまりと窓（近い階から）、次に家具の下の影（detailDist 以内の家具）。上限で落ちるのは遠い影から
    const dd = cfg.detailDist * cfg.detailDist;
    for (let pass = 0; pass < 2; pass++) for (const it of list) {
      if (it.d > cfg.cardDist) continue;
      const g = it.g, res = it.res, y = g.y + 0.012;
      if (pass === 1) {
        // 床に着く家具の下の影（高さ 0.3 m 以上）と、照明の下の机の上の明るさ（天板の高さ 0.6〜1.1 m・0.4 m² 以上、一番近い照明から）
        const P = res.pieces, m2 = cfg.blobMargin * 2, Q = res.panels;
        const pr = cfg.poolRadius[g.use] || cfg.poolRadius.default || 1.8, reach = pr * 1.6;
        const dg = (cfg.deskPoolGain || 0) * (typeof cfg.poolGain === 'number' ? cfg.poolGain : (cfg.poolGain[g.use] != null ? cfg.poolGain[g.use] : cfg.poolGain.default));
        for (let i = g.p0; i < g.p1; i++) {
          const o = i * S;
          if (dg > 0 && g.q1 > g.q0) {
            const top = P[o + 4] - g.y, ax = P[o + 3] - P[o], az = P[o + 5] - P[o + 2];
            if (top > 0.6 && top < 1.1 && ax * az > 0.4) {
              const cx = (P[o] + P[o + 3]) / 2, cz = (P[o + 2] + P[o + 5]) / 2, dx = cx - cam.x, dy = P[o + 4] - cam.y, dz = cz - cam.z;
              if (dx * dx + dy * dy + dz * dz <= dd) {
                // 一番近い照明からの割合は階ごとに 1 回だけ（照明 × 机を詰め直しのたびに数えていた = I10 の詰め直しが 8 ms を超えた）
                const F = g._deskF || (g._deskF = deskFalloff(P, Q, g, S, reach));
                const f = F[i - g.p0];
                if (f > 0.05) put(cx, P[o + 4] + 0.004, cz, ax, az, 1, 0, 3, pc.r * dg * f, pc.g * dg * f, pc.b * dg * f);
              }
            }
          }
          if (P[o + 1] > g.y + 0.05 || P[o + 4] - P[o + 1] < 0.3) continue;
          const cx = (P[o] + P[o + 3]) / 2, cz = (P[o + 2] + P[o + 5]) / 2, dx = cx - cam.x, dy = g.y - cam.y, dz = cz - cam.z;
          if (dx * dx + dy * dy + dz * dz > dd) continue;
          put(cx, y, cz, P[o + 3] - P[o] + m2, P[o + 5] - P[o + 2] + m2, 1, 0, 1, cfg.blobGain, cfg.blobGain, cfg.blobGain);
        }
        continue;
      }
      const pr = cfg.poolRadius[g.use] || cfg.poolRadius.default || 1.8;
      // 光のたまりと窓は階ごとに全部か無し（上限で半分だけになると、2 m 動くたびに階が明るくなったり暗くなったりする）
      const nl = (g.l1 || 0) - (g.l0 || 0);
      if (n + (g.q1 - g.q0) + nl + 2 * ((g.o1 || 0) - (g.o0 || 0)) > max) { dropped += (g.q1 - g.q0) + nl + ((g.o1 || 0) - (g.o0 || 0)); continue; }
      const byUse = (v) => (typeof v === 'number' ? v : (v[g.use] != null ? v[g.use] : v.default)); // 数か { default, <使い方> }（明るい床は弱く = 白く飛ばない）
      const pg = byUse(cfg.poolGain), wg = byUse(cfg.windowFillGain), sgn = byUse(cfg.sunGain) * this.sunScale;
      // 照明の下の光のたまり
      const Q = res.panels;
      for (let q = g.q0; q < g.q1; q++) put(Q[q * 4], y, Q[q * 4 + 2], pr * 2, pr * 2, 1, 0, 0, pc.r * pg, pc.g * pg, pc.b * pg);
      // スタンド・壁の灯りの暖かい光のたまり（res.lights。色は sRGB 0..1 → リニア）
      const L = res.lights, LS = I.LSTRIDE;
      if (L) for (let q = g.l0 || 0; q < (g.l1 || 0); q++) {
        const b = q * LS, r = L[b + 3], k = L[b + 7];
        put(L[b], L[b + 1] + 0.013, L[b + 2], r * 2, r * 2, 1, 0, 0, Math.pow(L[b + 4], 2.2) * k, Math.pow(L[b + 5], 2.2) * k, Math.pow(L[b + 6], 2.2) * k);
      }
      // 窓の光
      const O = res.open;
      if (O) for (let q = g.o0 || 0; q < (g.o1 || 0); q++) {
        const b = q * OS, ax = O[b], az = O[b + 1], bx = O[b + 2], bz = O[b + 3], nx = O[b + 4], nz = O[b + 5], sill = O[b + 7], head = O[b + 8];
        const w = Math.hypot(bx - ax, bz - az);
        if (w < 0.4 || head - sill < 0.5) continue;
        const cs = -nz, sn = -nx; // 札の −z（v = 1 = 壁）を外向き n へ
        const dep = cfg.windowFillDepth, mx = (ax + bx) / 2, mz = (az + bz) / 2;
        put(mx - nx * dep / 2, y + 0.001, mz - nz * dep / 2, w, dep, cs, sn, 2, fill.r * wg, fill.g * wg, fill.b * wg);
        if (sd) {
          const facing = (nx * sd.x + nz * sd.z) / (sd.length() || 1);
          if (facing > cfg.sunFacing && sgn > 0) {
            const L = Math.min(cfg.sunMax, (head - g.y) / Math.tan(elev));
            put(mx - nx * L / 2, y + 0.002, mz - nz * L / 2, w, L, cs, sn, 2, sun.r * sgn, sun.g * sgn, sun.b * sgn);
          }
        }
      }
    }
    if (!n) { this._zero(M, 0); n = 1; C[0] = C[1] = C[2] = 0; minX = minY = minZ = maxX = maxY = maxZ = 0; }
    this.cards.count = n;
    this.cards.instanceMatrix.needsUpdate = true;
    this.cards.instanceColor.needsUpdate = true;
    this.cardKind.needsUpdate = true;
    const bs = this.cardGeo.boundingSphere;
    bs.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    bs.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 1;
    this.stats.cards = n; this.stats.cardDropped = dropped;
  }

  info() {
    return Object.assign({ draws: 2 + (this.cards ? 1 : 0) + (this.glass ? 1 : 0) + (this.foliage && this.foliage.visible ? 1 : 0), tris: this.boxes.count * 12 + this.panels.count * 2 + (this.cards ? this.cards.count * 2 : 0), lift: +this.lift.value.toFixed(3) }, this.stats);
  }

  dispose() {
    this.world.root.remove(this.boxes);
    this.world.root.remove(this.panels);
    this.boxes.dispose(); this.panels.dispose();
    this.boxGeo.dispose(); this.panelGeo.dispose();
    this.boxMat.dispose(); this.panelMat.dispose();
    this._white.dispose();
    if (this.cards) { this.world.root.remove(this.cards); this.cards.dispose(); this.cardGeo.dispose(); this.cardMat.dispose(); }
    if (this.glass) { this.world.root.remove(this.glass); this.glass.dispose(); this.glassMat.dispose(); }
    if (this.foliage) { this.world.root.remove(this.foliage); this.foliage.dispose(); this.folGeo.dispose(); this.folMat.dispose(); }
    // アトラス・光の札のテクスチャは MR.Textures のキャッシュが持つ（次のゲームで使い回す）
    this._atlasJobs.length = 0;
  }
};
