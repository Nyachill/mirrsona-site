// 遠景の窓の色と屋上の色（MR.FarLook。cinematic-interiors V2 X1）。world.js の farMaterial（CityWorld.makeFarMaterial）の後ろに
// つなぐ onBeforeCompile（前の onBeforeCompile を先に呼ぶ）。makeFarMaterial は書き換えない（天気の M2 がそこを変えるため。V6 でそちらへ移す）。
//   - 窓: 目印 'uWinColor * bright' の文（totalEmissiveRadiance += uWinColor * bright * win * on * uWinGlow;）の on と色を 1 枚ずつに:
//     色は render.city.look.windows.colors / weights（2700 K 〜 6500 K・まれに青緑、マゼンタは 1 階だけ = groundOnly）、
//     灯りの割合はオフィス（スタイル 3〜6）が litOffice（建物ごと）で blockFloors 階ずつのまとまりで点く、住まい（1・2 = れんが）は litHome でばらばら。
//     遠く（fade）は平均の色（+ 4 × 3 の窓のまとまりの色を farVar だけ）と建物の割合の平均。
//   - 壁: 建物（aInfo.w）ごとの明るさ ±tint.value・色相 ±tint.hue 度・彩度 × tint.sat。
//   - 屋上: 上を向いた面で屋上の色（#4c4844 か その 0.85 倍）のものを roofs.colors（と roofs.green を roofs.greenShare）の 1 つに。
// 目印が無い（形が変わった）ときは何も変えずに false。プログラムのキーは前のもの（無ければ材質の名前）+ '|look'。
// patch(frag) は THREE なしの文字列の変換（Node のテストも使う）。
(function (root) {
  const MR = root.MR || (root.MR = {});
  const MARK = 'uWinColor * bright';
  // 置き換える文の中で使う、前の onBeforeCompile の変数（どれかが無ければ形が変わったので何もしない）
  const NEED = ['vec2 id = floor(cell);', 'vec2 rid', 'float h = cityHash(', 'float coarse', 'float fade', 'cityHash(vec2 p)', '#include <emissivemap_fragment>'];
  const N = 6;

  const DEF = {
    windows: {
      colors: ['#ffb46b', '#ffd29a', '#fff1d8', '#e6f0ff', '#6fe3d8', '#ff6fb0'],
      weights: [42, 27, 18, 10, 1.5, 1.5], groundOnly: [5],
      litOffice: [0.55, 0.8], litHome: [0.25, 0.45], blockFloors: 3, blockBays: 8, farVar: 0.3
    },
    roofs: { colors: ['#5b5650', '#3f4a52', '#6a5f4f', '#4c4844'], green: '#7f8a7a', greenShare: 0.05, key: '#4c4844' },
    tint: { value: 0.08, hue: 6, sat: 1.15 }
  };
  function pick(o, k, d) { return o && o[k] != null ? o[k] : d; }

  // weights → 累積（全部 / 1 階より上 = groundOnly を 0 にして足し直す）。長さ N
  function cumulative(weights, groundOnly) {
    const w = [], wu = [];
    for (let i = 0; i < N; i++) {
      const v = Math.max(0, +weights[i] || 0);
      w.push(v); wu.push(groundOnly.indexOf(i) >= 0 ? 0 : v);
    }
    const acc = (a) => { const s = a.reduce((x, y) => x + y, 0) || 1; let c = 0; return a.map((v) => (c += v / s)); };
    const g = acc(w), u = acc(wu);
    g[N - 1] = u[N - 1] = 1.0001; // 丸めで最後まで届かないことがないように
    return { ground: g, upper: u };
  }

  const GLSL_FN = [
    'uniform vec3 uLkCol[' + N + ']; uniform float uLkCumG[' + N + ']; uniform float uLkCumU[' + N + '];',
    'uniform vec3 uLkAvg; uniform float uLkFarVar;',
    'uniform vec2 uLkOffice; uniform vec2 uLkHome; uniform vec2 uLkBlock; uniform vec3 uLkTint;',
    'uniform vec3 uLkRoof[4]; uniform vec3 uLkGreen; uniform float uLkGreenShare; uniform vec3 uLkRoofKey;',
    'vec3 mrWinPick(float u, float g) {',
    '  vec3 c = uLkCol[0]; float done = 0.0;',
    '  for (int i = 0; i < ' + N + '; i++) { float cu = mix(uLkCumU[i], uLkCumG[i], g); if (done < 0.5 && u < cu) { c = uLkCol[i]; done = 1.0; } }',
    '  return c;',
    '}',
    'vec3 mrHue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }'
  ].join('\n');

  // 建物ごとの色味（壁）と屋上の色。前の窓のブロックより先（emissivemap_fragment の前 = diffuseColor に頂点色が掛かった後）
  const GLSL_TINT = [
    '{',
    '  float lst = floor(vInfo.z + 0.5); vec3 lnW = normalize(vWN);',
    '  if (lst > 0.5 && lst < 6.5 && abs(lnW.y) < 0.5) {',
    '    float t1 = cityHash(vec2(vInfo.w * 0.53, 1.7)); float t2 = cityHash(vec2(vInfo.w * 0.91, 4.1));',
    '    vec3 tc = mrHue(diffuseColor.rgb, uLkTint.y * (t2 * 2.0 - 1.0));',
    '    float tl = dot(tc, vec3(0.2126, 0.7152, 0.0722));',
    '    diffuseColor.rgb = max(mix(vec3(tl), tc, uLkTint.z) * (1.0 + uLkTint.x * (t1 * 2.0 - 1.0)), 0.0);',
    '  } else if (lst < 0.5 && lnW.y > 0.5 && vWP.y > 3.0) {',
    '    vec3 dk = abs(diffuseColor.rgb - uLkRoofKey); vec3 dk2 = abs(diffuseColor.rgb - uLkRoofKey * 0.85);',
    '    if (max(max(dk.r, dk.g), dk.b) < 0.006 || max(max(dk2.r, dk2.g), dk2.b) < 0.006) {',
    '      float rh = cityHash(vec2(vInfo.w * 1.37, 9.1)); float rj = cityHash(vec2(vInfo.w * 0.47, 2.9));',
    '      vec3 rc = uLkRoof[0];',
    '      if (rj > 0.25) rc = uLkRoof[1];',
    '      if (rj > 0.5) rc = uLkRoof[2];',
    '      if (rj > 0.75) rc = uLkRoof[3];',
    '      if (rh < uLkGreenShare) rc = uLkGreen;',
    '      diffuseColor.rgb = rc * (diffuseColor.rgb.g / max(uLkRoofKey.g, 1e-4));',
    '    }',
    '  }',
    '}'
  ].join('\n');

  // 窓の文の直前に入れる: mrOn（灯り）と mrCol（色）
  const GLSL_WIN = [
    '    float lkHome = step(st, 2.5);',
    '    float lkB = cityHash(vec2(vInfo.w * 0.71, st * 3.1) + 11.0);',
    '    float lkLit = mix(mix(uLkOffice.x, uLkOffice.y, lkB), mix(uLkHome.x, uLkHome.y, lkB), lkHome) * uWinLit;',
    '    float lkHb = cityHash(vec2(floor(id.y / uLkBlock.x) * 1.13 + floor(id.x / uLkBlock.y) * 7.7, vInfo.w * 0.29 + st));',
    '    float lkP = mix(mix(0.1, 0.9, step(lkHb, clamp((lkLit - 0.1) / 0.8, 0.0, 1.0))), lkLit, lkHome);',
    '    float mrOn = mix(step(1.0 - lkP, h), lkLit * (0.5 + coarse), fade);',
    '    float lkG = step(id.y, 0.5);',
    '    vec3 mrCol = mix(mrWinPick(cityHash(id * 0.73 + vec2(vInfo.w * 0.11, 5.3)), lkG),',
    '                     mix(uLkAvg, mrWinPick(cityHash(floor(cell / vec2(4.0, 3.0)) + vec2(vInfo.w * 0.19, 8.1)), 0.0), uLkFarVar), fade);'
  ].join('\n');

  // 断片シェーダーの文字列を変える（THREE なし）。変えられなければ null
  function patch(frag) {
    if (typeof frag !== 'string') return null;
    const at = frag.indexOf(MARK);
    if (at < 0) return null;
    for (const k of NEED) if (frag.indexOf(k) < 0) return null;
    const ls = frag.lastIndexOf('\n', at) + 1;             // 窓の文の行の頭
    const end = frag.indexOf(';', at);
    if (end < 0) return null;
    const stmt = frag.slice(ls, end + 1);
    if (!/\bon\b/.test(stmt)) return null;
    const newStmt = stmt.replace(MARK, 'mrCol * bright').replace(/\bon\b/g, 'mrOn');
    let rest = frag.slice(end + 1);
    // 灯りの付いていない窓の空の映り込み（1.0 - on）も同じ灯りで（次の 1 文だけ）
    const nl = rest.indexOf(';');
    if (nl >= 0 && /\(1\.0 - on\)/.test(rest.slice(0, nl))) rest = rest.slice(0, nl).replace(/\(1\.0 - on\)/g, '(1.0 - mrOn)') + rest.slice(nl);
    let out = frag.slice(0, ls) + GLSL_WIN + '\n' + newStmt + rest;
    out = out.replace('#include <emissivemap_fragment>', GLSL_TINT + '\n#include <emissivemap_fragment>');
    // 関数は cityHash の後（varying と uniform が宣言された後）
    const fh = out.indexOf('float cityHash(vec2 p)');
    const fe = out.indexOf('\n', fh);
    out = out.slice(0, fe + 1) + GLSL_FN + '\n' + out.slice(fe + 1);
    return out;
  }

  function uniforms(cfg) {
    const THREE = root.THREE;
    const C = (h) => (MR.srgb ? MR.srgb(h) : new THREE.Color(h));
    const W = Object.assign({}, DEF.windows, cfg.windows || {}), R = Object.assign({}, DEF.roofs, cfg.roofs || {}), T = Object.assign({}, DEF.tint, cfg.tint || {});
    const cols = [];
    for (let i = 0; i < N; i++) cols.push(C(W.colors[i] || W.colors[W.colors.length - 1] || '#ffb46b'));
    const cum = cumulative(W.weights || DEF.windows.weights, W.groundOnly || []);
    // 遠く（窓が 1 画素より小さい）は 1 階より上の重みの平均の色に farVar だけ 4 × 3 のまとまりの色を混ぜる（色の継ぎはぎに見えない）
    const avg = new THREE.Color(0, 0, 0);
    for (let i = 0; i < N; i++) avg.add(cols[i].clone().multiplyScalar(cum.upper[i] - (i ? cum.upper[i - 1] : 0)));
    const roofs = [];
    for (let i = 0; i < 4; i++) roofs.push(C(R.colors[i] || R.colors[0]));
    const lo = W.litOffice || DEF.windows.litOffice, lh = W.litHome || DEF.windows.litHome;
    return {
      uLkCol: { value: cols }, uLkAvg: { value: avg }, uLkFarVar: { value: W.farVar == null ? 0.3 : W.farVar }, uLkCumG: { value: cum.ground }, uLkCumU: { value: cum.upper },
      uLkOffice: { value: new THREE.Vector2(lo[0], lo[1]) }, uLkHome: { value: new THREE.Vector2(lh[0], lh[1]) },
      uLkBlock: { value: new THREE.Vector2(Math.max(1, W.blockFloors || 3), Math.max(1, W.blockBays || 8)) },
      uLkTint: { value: new THREE.Vector3(T.value, T.hue * Math.PI / 180, T.sat) },
      uLkRoof: { value: roofs }, uLkGreen: { value: C(R.green) }, uLkGreenShare: { value: R.greenShare }, uLkRoofKey: { value: C(R.key) }
    };
  }

  // mat = world.farMaterial、cfg = render.city.look（enabled: false で使わない）。つないだら true
  function extend(mat, cfg) {
    cfg = cfg || {};
    if (!mat || cfg.enabled === false || mat.userData.farLook) return false;
    const prev = mat.onBeforeCompile;
    if (typeof prev !== 'function' || String(prev).indexOf(MARK) < 0) return false; // 目印が無い = 形が変わった
    const U = uniforms(cfg);
    const hasKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey');
    const prevKey = hasKey ? mat.customProgramCacheKey : null;
    const st = { patched: null };
    mat.onBeforeCompile = function (shader, renderer) {
      prev.call(this, shader, renderer);
      const f = patch(shader.fragmentShader);
      st.patched = !!f;
      if (!f) return;
      shader.fragmentShader = f;
      Object.assign(shader.uniforms, U);
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : (this.name || 'cityFar')) + '|look'; };
    mat.userData.farLook = { uniforms: U, state: st };
    mat.needsUpdate = true;
    return true;
  }

  MR.FarLook = { extend, patch, cumulative, MARK, DEF };
  if (typeof module !== 'undefined' && module.exports) module.exports = MR.FarLook;
})(typeof window !== 'undefined' ? window : globalThis);
