// 一人称の腕（MR.ViewArms）。銃（weapon.js）の group の子に入れる。
//
// code(handR, handL, opts): コードの腕（arms.glb が無いときの形）。袖は回転体（手首の折り返し・肘へ太くなる・しわ）、
//   手袋は握りに巻いた指（4 本の溝）・丸めた手の甲・親指・手首。左右の腕を 1 つの BufferGeometry にまとめ、頂点色で
//   袖と手袋を塗り分ける（1 回の描画。b13 までは袖と手の箱を別々に 4 回）。座標は銃の group のローカル（銃口 -Z・上 +Y、m）。
//   handR = 右手で握る点（グリップの中）、handL = 左手の点（ハンドガード / ピストルは右手の前を包む）。
//   opts（weapons[].model.hands）: grip（右手の握りの軸の中心）・gripR（半径）・gripTilt（握りの前傾、度）・
//   left（'guard' = ハンドガードの下から / 'pistol' = 右手を包む / 'vgrip' = 縦の前の握り）・fore（左手の握りの軸の中心）・
//   foreR（半径）・elbowR / elbowL（手首から肘へ、m）。無ければ handR / handL から。寸法は tools/viewmodel-view.js --measure で測る。
// kitOn(renderCfg): hq3d の見た目を使うか（render.kit !== false かつ URL に ?kit=0 が無い）。?kit=0 は変更前の見た目の組（screenshot.js --kit）。
window.MR = window.MR || {};

MR.ViewArms = (function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function kitOn(renderCfg) {
    if (renderCfg && renderCfg.kit === false) return false;
    try { if (/[?&]kit=0\b/.test((window.location && window.location.search) || '')) return false; } catch (e) { /* Node */ }
    return true;
  }

  // 格子の面: f(u, v, out) が位置を書く。u は 0..nu、v は 0..nv（closedV なら v の端をつなぐ）。色は一色。
  // 面の向きは外向きにそろえる（u の真ん中の行の三角形の法線と、形の重心からの向きで決める）。
  // shade(u, v) があれば色にその倍率を掛ける（指の溝・袖口の陰 = 焼いた AO）
  function grid(nu, nv, closedV, f, rgb, P, C, I, shade) {
    const base = P.length / 3, cols = closedV ? nv : nv + 1;
    const p = new THREE.Vector3();
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j < cols; j++) {
        f(i / nu, j / nv, p);
        P.push(p.x, p.y, p.z);
        const k = shade ? shade(i / nu, j / nv) : 1;
        C.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
        cx += p.x; cy += p.y; cz += p.z; n++;
      }
    }
    cx /= n; cy /= n; cz /= n;
    const at = (k, out) => out.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3();
    let score = 0;
    const mid = Math.floor(nu / 2);
    for (let j = 0; j < nv; j++) {
      const j1 = closedV ? (j + 1) % nv : j + 1;
      at(base + mid * cols + j, A); at(base + (mid + 1) * cols + j, B); at(base + mid * cols + j1, D);
      const nrm = B.clone().sub(A).cross(D.clone().sub(A));
      score += nrm.x * (A.x - cx) + nrm.y * (A.y - cy) + nrm.z * (A.z - cz);
    }
    const flip = score < 0;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const j1 = closedV ? (j + 1) % nv : j + 1;
        const a = base + i * cols + j, b = base + (i + 1) * cols + j, c = base + (i + 1) * cols + j1, d = base + i * cols + j1;
        if (flip) I.push(a, d, b, b, d, c); else I.push(a, b, d, b, c, d);
      }
    }
  }

  // 正規直交の基底（a に直交する 2 本）
  function basis(a) {
    const t = Math.abs(a.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
    const b1 = new THREE.Vector3().crossVectors(a, t).normalize();
    const b2 = new THREE.Vector3().crossVectors(a, b1).normalize();
    return [b1, b2];
  }

  // 袖（手首 w → 肘 e）。折り返しの縁・前腕のふくらみ・しわ
  function sleeve(w, e, rgb, P, C, I) {
    const ax = e.clone().sub(w), L = ax.length();
    ax.normalize();
    const [b1, b2] = basis(ax);
    const prof = [[0, 0.0], [0.012, 0.042], [0.025, 0.048], [0.08, 0.052], [0.11, 0.047], [0.35, 0.056], [0.7, 0.058], [1, 0.054]];
    const rAt = (t) => {
      for (let k = 1; k < prof.length; k++) if (t <= prof[k][0]) { const a = prof[k - 1], b = prof[k], s = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * s; }
      return prof[prof.length - 1][1];
    };
    const ts = [0, 0.012, 0.025, 0.08, 0.11, 0.22, 0.35, 0.5, 0.7, 1];
    grid(ts.length - 1, 14, true, (u, v, out) => {
      const t = ts[Math.round(u * (ts.length - 1))], th = v * Math.PI * 2;
      const wr = t > 0.1 ? 1 + 0.06 * Math.sin(3 * th + t * 9) * Math.sin(t * Math.PI) : 1; // しわ
      const r = rAt(t) * wr;
      out.copy(w).addScaledVector(ax, t * L).addScaledVector(b1, Math.cos(th) * r).addScaledVector(b2, Math.sin(th) * r);
    }, rgb, P, C, I, (u, v) => {
      const t = ts[Math.round(u * (ts.length - 1))];
      return t < 0.02 ? 0.35 : t > 0.09 && t < 0.13 ? 0.72 : t > 0.1 ? 1 - 0.12 * Math.max(0, Math.sin(3 * v * Math.PI * 2 + t * 9)) : 1;
    });
  }

  // 手袋の手。o = 握る軸の中心、ay = 握る軸（指が巻く軸）、px = 手のひら側（手の甲が外を向く方）、wrap = 指の巻く向き（+1 / −1）。
  // 握りを包んだ丸いこぶし（超楕円体。指の側に 4 本の溝、手の甲の側に指の付け根の盛り上がり）+ 親指 + 手首
  function hand(o, ay, px, wrap, R, rgb, rgbDark, P, C, I, thumbOut) {
    const az = new THREE.Vector3().crossVectors(px, ay).normalize().multiplyScalar(wrap); // 指先が向かう側
    const hx = 0.6 * R + 0.017, hz = R + 0.014, hy = 0.043;
    const c = o.clone().addScaledVector(px, 0.5 * R);
    const e = 0.6, spow = (x) => Math.sign(x) * Math.pow(Math.abs(x), e);
    // 超楕円体の上の点の「指の溝・付け根」の量（形と色で同じ式）
    const feat = (u, v) => {
      const la = (u - 0.5) * Math.PI * 0.999, lo = v * Math.PI * 2;
      const cl = spow(Math.cos(la)), sx = cl * spow(Math.cos(lo)), sz = cl * spow(Math.sin(lo)), sy = spow(Math.sin(la));
      const k = (sy * 0.5 + 0.5) * 4.2 - 0.1;
      const fing = Math.max(0, sz) * Math.max(0, 1 - Math.max(0, sx) * 1.6);
      const gv = Math.pow(1 - Math.abs(Math.sin(Math.PI * k)), 3);
      const kn = Math.max(0, sx) * Math.max(0, sz + 0.3) * Math.max(0, sy + 0.2);
      return { sx, sz, sy, fing, gv, kn };
    };
    grid(10, 14, true, (u, v, out) => {
      const q = feat(u, v);
      const f = (1 - 0.12 * q.fing * q.gv) * (1 + 0.08 * q.kn);
      out.copy(c).addScaledVector(px, hx * q.sx * f).addScaledVector(az, hz * q.sz * f).addScaledVector(ay, hy * q.sy);
    }, rgb, P, C, I, (u, v) => {
      const q = feat(u, v);
      return (1 - 0.55 * q.fing * q.gv) * (1 + 0.25 * Math.min(1, q.kn * 2)) * (q.sy < -0.6 ? 0.8 : 1);
    });
    // 親指: こぶしの上、指先と反対の側（−px）を前（az）へ
    // thumbOut: 親指を手のひら側（外）に沿わせる（ピストルの左手: フレームの左を前へ）
    const ts = thumbOut ? 1 : -1;
    const tb = c.clone().addScaledVector(ay, hy * (thumbOut ? 0.85 : 0.7)).addScaledVector(px, ts * hx * (thumbOut ? 0.55 : 1.05)).addScaledVector(az, -hz * 0.35);
    const tdir = az.clone().multiplyScalar(0.92).addScaledVector(ay, thumbOut ? 0.05 : -0.12).addScaledVector(px, ts * 0.1).normalize();
    const [t1, t2] = basis(tdir);
    const TL = 0.052, TR = 0.0105;
    grid(6, 8, true, (u, v, out) => {
      const la = (u - 0.5) * Math.PI * 0.999, lo = v * Math.PI * 2;
      const r = TR * Math.cos(la) * (1 - 0.18 * u);
      out.copy(tb).addScaledVector(tdir, TL * (0.5 + 0.5 * Math.sin(la))).addScaledVector(t1, Math.cos(lo) * r).addScaledVector(t2, Math.sin(lo) * r);
    }, rgb, P, C, I);
    // 手首（こぶしの下から袖の中へ）
    const wb = c.clone().addScaledVector(ay, -hy * 0.55);
    grid(2, 8, true, (u, v, out) => {
      const lo = v * Math.PI * 2, r = 0.024 + 0.006 * u;
      out.copy(wb).addScaledVector(ay, -0.045 * u).addScaledVector(px, Math.cos(lo) * r * 1.1).addScaledVector(az, Math.sin(lo) * r);
    }, rgbDark, P, C, I);
    return c;
  }

  // 頂点色: 袖（布）と手袋（黒い革）
  const COL = { sleeve: '#343a2d', glove: '#3d3830', gloveDark: '#2c2823' };
  function rgbOf(hex) { const c = MR.srgb(hex); return [c.r, c.g, c.b]; }

  function code(handR, handL, opts) {
    const o = opts || {};
    const P = [], C = [], I = [];
    const gl = rgbOf(o.glove || COL.glove), gd = rgbOf(o.gloveDark || COL.gloveDark), sl = rgbOf(o.sleeve || COL.sleeve);
    const v3 = (a, d) => (Array.isArray(a) && a.length >= 3 ? V(a[0], a[1], a[2]) : d);
    const R = typeof o.gripR === 'number' ? o.gripR : 0.019;
    const tilt = THREE.MathUtils.degToRad(typeof o.gripTilt === 'number' ? o.gripTilt : 18);
    // 右手: グリップ（軸は上へ、上が少し前）。手のひら側は右 +X、指は前を回って左へ。o.grip = 握りの軸の中心
    const r = v3(o.grip, (handR || V(0.01, -0.1, 0.05)).clone().add(V(0, -0.015, 0.02)));
    const ayR = V(0, Math.cos(tilt), -Math.sin(tilt));
    hand(r, ayR, V(1, 0, 0), -1, R, gl, gd, P, C, I);
    const eR = v3(o.elbowR, V(0.1, -0.42, 0.3));
    const wR = r.clone().addScaledVector(ayR, -0.05).add(V(0.018, 0, 0.02));
    sleeve(wR, wR.clone().add(eR), sl, P, C, I);
    // 左手。o.fore = ハンドガード（前の握り）の軸の中心、foreR = 半径
    const FR = typeof o.foreR === 'number' ? o.foreR : 0.026;
    const l = v3(o.fore, (handL || V(-0.02, 0.0, -0.3)).clone().add(V(0, FR, 0)));
    const eL = v3(o.elbowL, V(-0.2, -0.4, 0.34));
    let wL;
    if (o.left === 'pistol') {
      // 右手の指の上から包む（手のひらは左 −X、指は前を回って右へ）
      const cL = r.clone().add(V(-0.006, -0.014, -0.006));
      hand(cL, ayR, V(-1, 0, 0), 1, R + 0.011, gl, gd, P, C, I, true);
      wL = cL.clone().addScaledVector(ayR, -0.05).add(V(-0.032, 0, 0.02));
    } else if (o.left === 'vgrip') {
      // 縦の前の握り（P90 の前の穴）: 手のひらは左、指は前を回って右へ
      hand(l, ayR, V(-1, 0, 0), 1, FR, gl, gd, P, C, I);
      wL = l.clone().addScaledVector(ayR, -0.05).add(V(-0.018, 0, 0.02));
    } else {
      // ハンドガードの下から（手のひらは下、指は右側へ巻く、親指は左）
      hand(l, V(0, 0, -1), V(0, -1, 0), 1, FR, gl, gd, P, C, I);
      wL = l.clone().add(V(-0.02, -FR - 0.028, 0.045));
    }
    sleeve(wL, wL.clone().add(eL), sl, P, C, I);

    const geo = new THREE.BufferGeometry();
    // 作った握りの軸（smoke-kit.js の QT1 が見る）
    geo.userData.fit = { grip: r.toArray(), gripAxis: ayR.toArray(), gripR: R, left: o.left || 'guard', fore: o.left === 'pistol' ? null : l.toArray(),
      foreAxis: o.left === 'vgrip' ? ayR.toArray() : [0, 0, -1], foreR: FR };
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(I);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  // 腕の材質（頂点色。袖の布と手袋の差は頂点色と粗さの間）
  function material(o) {
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: (o && o.roughness) || 0.82, metalness: 0.0 });
  }

  // ---------- arms.glb（tools/gen/build_arms.py。架空の手袋と袖、UE5 の骨の名前、クリップ） ----------
  // file: render.view.arms（'models/arms.glb'。ティアは assets.resolve）。パースは assets のキャッシュ（1 回）、銃ごとに SkeletonUtils.clone。
  // 銃の座標のクリップ: grip_<武器 id>（1 つの姿勢）・reload_<武器 id>（1 秒。weapon.js が reloadTime に合わせる）。
  // 視点の座標のクリップ（ナイフの流れ用。原点 = カメラ、−Z 前、m。ナイフの grip は weapon_r に）: knife_idle / knife_slash / knife_stab / throw / bandage
  function glbFile(assets, file) {
    if (!assets || !file || typeof assets.loadModel !== 'function') return null;
    if (typeof assets.resolve === 'function') return assets.resolve(file) || null;
    if (typeof assets.has === 'function') return assets.has(file) ? file : null;
    return null;
  }
  // Promise<{ scene, animations } | null>（無い・読めないときは null = コードの腕のまま）
  function loadGlb(assets, file) {
    const key = glbFile(assets, file);
    if (!key || !THREE.SkeletonUtils) return Promise.resolve(null);
    return Promise.resolve().then(() => assets.loadModel(key)).then((g) => (g && g.scene && (g.animations || []).length ? g : null)).catch((e) => {
      console.warn('[ViewArms] ' + key + ' を読めません。コードの腕で続けます:', e && e.message);
      return null;
    });
  }
  // 複製を作る: { root, mesh, mixer, clips, play(name, opts), pose(name), update(dt), dispose() }
  function rig(gltf) {
    const root = THREE.SkeletonUtils.clone(gltf.scene);
    let mesh = null;
    root.traverse((o) => {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; if (o.isSkinnedMesh && !mesh) mesh = o; }
    });
    const mixer = new THREE.AnimationMixer(root);
    const clips = {};
    for (const c of gltf.animations) clips[c.name] = c;
    let cur = null;
    const R = {
      root, mesh, mixer, clips, busy: false,
      has: (name) => !!clips[name],
      // 1 つの姿勢（grip_*）: 置いて 1 回だけ評価する（毎フレーム mixer を回さない）
      pose(name) {
        const c = clips[name];
        if (!c) return false;
        mixer.stopAllAction();
        cur = mixer.clipAction(c); cur.reset(); cur.play();
        mixer.update(0);
        R.busy = false;
        return true;
      },
      // 動くクリップ。duration 秒で 1 回（loop: true で繰り返し）。終わったら back の姿勢へ
      play(name, opts) {
        const c = clips[name], o = opts || {};
        if (!c) return false;
        mixer.stopAllAction();
        cur = mixer.clipAction(c);
        cur.reset();
        cur.setLoop(o.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        cur.clampWhenFinished = true;
        cur.timeScale = o.duration ? c.duration / o.duration : 1;
        cur.play();
        R.busy = true; R._back = o.back || null; R._loop = !!o.loop;
        mixer.update(0);
        return true;
      },
      update(dt) {
        if (!R.busy) return;
        mixer.update(dt);
        if (!R._loop && cur && !cur.isRunning()) { R.busy = false; if (R._back) R.pose(R._back); }
      },
      stop(back) { R.busy = false; if (back) R.pose(back); },
      dispose() { mixer.stopAllAction(); if (root.parent) root.parent.remove(root); } // 形・材質は gltf と共有（捨てない）
    };
    return R;
  }

  return { kitOn, code, material, grid, COL, loadGlb, rig };
})();
