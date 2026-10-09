// エフェクト: 弾道（光るトレーサー）、着弾の火花と土煙、血しぶき、マズルの煙、薬莢。
// 戦闘機（フェーズ E1）: streak（飛んでいく機関砲のトレーサー。同時に STREAK_MAX 本まで、全部で 1 つのメッシュ = 1 回の描画。カメラに向けた帯で、
//   遠いほど太く（3 人称の後ろからでも見える））・steam（カタパルトの蒸気）
// スプライトはプールして使い回す（毎フレーム生成しない）。
window.MR = window.MR || {};

MR.FX = class FX {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.pool = [];
    this.tracers = [];
    this.tracerPool = [];
    this.casings = [];

    const glow = (hex) => FX.makeGlowTexture(hex);
    this.mats = {
      spark: new THREE.SpriteMaterial({ map: glow('#ffd27a'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      flash: new THREE.SpriteMaterial({ map: glow('#ffc14d'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      dust: new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#b9ab93'), transparent: true, depthWrite: false, opacity: 0.6 }),
      smoke: new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#8a8a8a'), transparent: true, depthWrite: false, opacity: 0.35 }),
      blood: new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#a0141c'), transparent: true, depthWrite: false, opacity: 0.9 })
    };
    this.tracerGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true);
    this.tracerGeo.translate(0, 0.5, 0); // 根元を原点に
    this.tracerMats = {
      player: new THREE.MeshBasicMaterial({ color: MR.srgb('#ffe9a8'), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      enemy: new THREE.MeshBasicMaterial({ color: MR.srgb('#ff7a5c'), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    };
    this.casingGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.026, 6);
    this.casingMat = new THREE.MeshStandardMaterial({ color: MR.srgb('#d8a84a'), roughness: 0.3, metalness: 0.9 });
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this.streaks = [];
    this.streakPool = [];
    this.maxParticles = 0; // 0 = 上限なし（game.js が render.fxMaxParticles を入れる）
    this.stats = { stolen: 0 };
  }

  // ---------- 粒子 ----------

  _spawn(mat, pos, opts) {
    let p = null;
    // 同時に maxParticles 個まで（スプライトは 1 つで 1 回描く。モバイルは render.mobile.fxMaxParticles で少なく）: 超えたら一番古いものを使い回す
    if (this.maxParticles > 0 && this.particles.length >= this.maxParticles) {
      p = this.particles.shift();
      this.scene.remove(p.sprite);
      this.stats.stolen++;
    } else p = this.pool.pop();
    if (!p) {
      p = { sprite: new THREE.Sprite(mat.clone()), vel: new THREE.Vector3() };
      p.sprite.material.map = mat.map;
    }
    const s = p.sprite;
    s.material.map = mat.map;
    s.material.blending = mat.blending;
    s.material.color.copy(mat.color);
    s.material.opacity = mat.opacity;
    s.position.copy(pos);
    s.material.rotation = Math.random() * Math.PI * 2;
    p.vel.set(0, 0, 0);
    if (opts.vel) p.vel.copy(opts.vel);
    if (opts.spread) p.vel.add(new THREE.Vector3((Math.random() - 0.5) * opts.spread, (Math.random() - 0.5) * opts.spread, (Math.random() - 0.5) * opts.spread));
    p.life = opts.life; p.maxLife = opts.life;
    p.size0 = opts.size; p.size1 = opts.sizeEnd == null ? opts.size : opts.sizeEnd;
    p.gravity = opts.gravity || 0;
    p.opacity = mat.opacity;
    s.scale.set(p.size0, p.size0, 1);
    s.visible = true;
    this.scene.add(s);
    this.particles.push(p);
  }

  // 壁・地面への着弾
  impact(point, normal) {
    const n = normal || this._up;
    const base = point.clone().addScaledVector(n, 0.03);
    this._spawn(this.mats.spark, base, { life: 0.1, size: 0.3, sizeEnd: 0.05 });
    for (let i = 0; i < 3; i++) {
      this._spawn(this.mats.spark, base, { life: 0.25 + Math.random() * 0.15, size: 0.06, sizeEnd: 0.0, vel: n.clone().multiplyScalar(2 + Math.random() * 3), spread: 3, gravity: -9 });
    }
    for (let i = 0; i < 2; i++) {
      this._spawn(this.mats.dust, base, { life: 0.55 + Math.random() * 0.3, size: 0.25, sizeEnd: 0.9, vel: n.clone().multiplyScalar(0.8), spread: 0.8, gravity: 0.3 });
    }
  }

  // 敵への命中
  hitFlesh(point, dir) {
    for (let i = 0; i < 4; i++) {
      this._spawn(this.mats.blood, point, { life: 0.3 + Math.random() * 0.2, size: 0.12, sizeEnd: 0.3, vel: dir.clone().multiplyScalar(1.5), spread: 2.5, gravity: -6 });
    }
  }

  // 爆発（乗り物など）。size はおおよその火球の半径（m）、count は粒の数の倍率（既定 1 = 58 粒）
  explosion(point, size, count) {
    const r = size || 3, k = count == null ? 1 : Math.max(0, count);
    this._spawn(this.mats.flash, point, { life: 0.22, size: r * 1.6, sizeEnd: r * 2.6 });
    this._spawn(this.mats.spark, point, { life: 0.4, size: r * 1.1, sizeEnd: 0.2 });
    const up = new THREE.Vector3(0, 6, 0);
    for (let i = 0, n = Math.round(26 * k); i < n; i++) {
      this._spawn(this.mats.spark, point, { life: 0.5 + Math.random() * 0.7, size: 0.2, sizeEnd: 0.02, vel: up, spread: 16, gravity: -12 });
    }
    const rise = new THREE.Vector3(0, 2.5, 0);
    for (let i = 0, n = Math.round(18 * k); i < n; i++) {
      this._spawn(this.mats.smoke, point, { life: 1.6 + Math.random() * 1.4, size: r * 0.35, sizeEnd: r * 1.4 + Math.random() * r, vel: rise, spread: 4, gravity: 0.6 });
    }
    const low = new THREE.Vector3(0, 1.2, 0);
    for (let i = 0, n = Math.round(12 * k); i < n; i++) {
      this._spawn(this.mats.dust, point, { life: 1.0 + Math.random() * 0.7, size: r * 0.3, sizeEnd: r * 1.1, vel: low, spread: 7, gravity: 0.2 });
    }
  }

  // 水しぶき（泳ぐ・飛び込む・車が沈む）。point は水面の点、size はおおよその大きさ（1 = 人の飛び込み）。
  // 白い粒が上へ飛んで落ち、水面に泡が広がる。マテリアルは最初に呼ばれたときに作る（arena01 では作らない）
  splash(point, size) {
    const k = size || 1;
    if (!this.mats.spray) {
      this.mats.spray = new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#e8f1f4'), transparent: true, depthWrite: false, opacity: 0.85 });
      this.mats.foam = new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#cfdde2'), transparent: true, depthWrite: false, opacity: 0.55 });
    }
    const up = this._tmp.set(0, 2.2 + k * 1.6, 0).clone();
    const n = Math.round(5 + k * 7);
    for (let i = 0; i < n; i++) {
      this._spawn(this.mats.spray, point, { life: 0.45 + Math.random() * 0.4, size: 0.12 * k + 0.05, sizeEnd: 0.28 * k + 0.1, vel: up, spread: 2.2 + k * 1.8, gravity: -9 });
    }
    for (let i = 0; i < Math.round(2 + k * 3); i++) {
      this._spawn(this.mats.foam, point, { life: 0.9 + Math.random() * 0.6, size: 0.3 * k + 0.15, sizeEnd: 1.1 * k + 0.4, vel: this._up.clone().multiplyScalar(0.15), spread: 0.9 * k, gravity: 0 });
    }
  }

  // ヘリの吹き下ろし: 機体の下の地面（水面）の輪から外へ流れる砂ぼこり / 水しぶき。center は地面の点、radius は輪の半径、
  // k は強さ 0..1（低いほど強い）。呼ぶ側が 0.08 s ごとに呼ぶ（1〜2 粒。スプライトは 1 粒 1 描画なので少なめ）。マテリアルは最初に呼ばれたときに作る
  rotorWash(center, radius, water, k) {
    if (!this.mats.wash) {
      this.mats.wash = new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#bdb29e'), transparent: true, depthWrite: false, opacity: 0.38 });
      this.mats.washWater = new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#e4eef2'), transparent: true, depthWrite: false, opacity: 0.5 });
    }
    const mat = water ? this.mats.washWater : this.mats.wash;
    const v = this._washVel || (this._washVel = new THREE.Vector3());
    const p = this._washPos || (this._washPos = new THREE.Vector3());
    const n = 1 + Math.round(Math.max(0, Math.min(1, k)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const r = radius * (0.5 + Math.random() * 0.6);
      p.set(center.x + c * r, center.y, center.z + s * r);
      const sp = 3 + 7 * k;
      v.set(c * sp, 0.5 + Math.random() * (water ? 1.6 : 0.8), s * sp);
      this._spawn(mat, p, { life: 0.7 + Math.random() * 0.6, size: 0.5 + k * 0.7, sizeEnd: 2.0 + k * 1.8, vel: v, gravity: water ? -3 : 0.15 });
    }
  }

  // 立ち上る煙（燃える残骸）。呼ぶ側が 0.1 s ごとに 1 つ出す
  smoke(point, size) {
    const s = size || 0.5;
    this._spawn(this.mats.smoke, point, { life: 1.4 + Math.random(), size: s, sizeEnd: s * 3.2, vel: new THREE.Vector3(0, 1.4, 0), spread: 0.8, gravity: 0.8 });
  }

  // 燃える残骸の炎（大きめ、上へ揺らぎながら消える）と黒い煙（ヘリの残骸）。マテリアルは最初に呼ばれたときに作る
  fire(point, size) {
    const s = size || 1;
    if (!this.mats.fire) {
      this.mats.fire = new THREE.SpriteMaterial({ map: FX.makeGlowTexture('#ff8a2a'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.mats.blackSmoke = new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#2e2b28'), transparent: true, depthWrite: false, opacity: 0.55 });
    }
    const v = this._fireVel || (this._fireVel = new THREE.Vector3());
    v.set((Math.random() - 0.5) * 0.6, 1.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6);
    this._spawn(this.mats.fire, point, { life: 0.35 + Math.random() * 0.3, size: (0.9 + Math.random() * 0.7) * s, sizeEnd: 0.25 * s, vel: v, gravity: 1.5 });
  }
  blackSmoke(point, size) {
    const s = size || 1;
    if (!this.mats.blackSmoke) this.fire(point, 0.01);
    const v = this._smokeVel || (this._smokeVel = new THREE.Vector3());
    v.set((Math.random() - 0.5) * 0.8, 2.0 + Math.random(), (Math.random() - 0.5) * 0.8);
    this._spawn(this.mats.blackSmoke, point, { life: 2.2 + Math.random() * 1.2, size: s, sizeEnd: s * 4, vel: v, gravity: 0.6 });
  }

  // 炎のゆらぎ（小さな加算スプライト）
  flame(point) {
    this._spawn(this.mats.flash, point, { life: 0.25 + Math.random() * 0.15, size: 0.5 + Math.random() * 0.4, sizeEnd: 0.15, vel: new THREE.Vector3(0, 1.2, 0), spread: 0.6, gravity: 2 });
  }

  // 銃口の煙
  muzzleSmoke(point, dir) {
    this._spawn(this.mats.smoke, point, { life: 0.5, size: 0.12, sizeEnd: 0.5, vel: dir.clone().multiplyScalar(1.5), spread: 0.4, gravity: 0.6 });
  }

  // ---------- トレーサー ----------

  tracer(from, to, isEnemy) {
    let mesh = this.tracerPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.tracerGeo, this.tracerMats.player);
      mesh.frustumCulled = false;
    }
    mesh.material = isEnemy ? this.tracerMats.enemy : this.tracerMats.player;
    const dir = this._tmp.copy(to).sub(from);
    const len = dir.length();
    if (len < 0.05) { this.tracerPool.push(mesh); return; }
    dir.divideScalar(len);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this._up, dir);
    mesh.scale.set(1, len, 1);
    mesh.visible = true;
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: isEnemy ? 0.09 : 0.06 });
  }

  // 飛んでいくトレーサー（機関砲）: from から to へ speed m/s で、長さ最大 22 m の光の筋が進む。
  //   全部の筋を 1 つのメッシュ（カメラに向けた四角 × STREAK_MAX、毎フレーム頂点を書く）で描く。最初に呼ばれたときに作る
  streak(from, to, speed) {
    if (!this.streakMesh) {
      const N = FX.STREAK_MAX, g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(N * 12), 3), col = new THREE.BufferAttribute(new Float32Array(N * 12), 3);
      pos.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pos); g.setAttribute('color', col);
      const idx = [];
      for (let k = 0; k < N; k++) idx.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3);
      g.setIndex(idx);
      g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
      m.frustumCulled = false;
      m.renderOrder = 4;
      m.name = 'fx:streaks';
      m.visible = false;
      this.scene.add(m);
      this.streakMesh = m;
      this.streakColor = MR.srgb('#ffcf6a');
    }
    if (this.streaks.length >= FX.STREAK_MAX) this.streakPool.push(this.streaks.shift());
    let s = this.streakPool.pop();
    if (!s) s = { from: new THREE.Vector3(), dir: new THREE.Vector3() };
    s.dir.copy(to).sub(from);
    s.len = s.dir.length();
    if (s.len < 1) { this.streakPool.push(s); return; }
    s.dir.divideScalar(s.len);
    s.from.copy(from);
    s.t = 0; s.speed = speed || 1000;
    this.streaks.push(s);
  }

  // 筋の四角をカメラ（cam: 世界の位置）に向けて書く。幅は近くで 0.16 m、遠いほど太く（画面で 3 px ほど）
  _writeStreaks(cam) {
    const m = this.streakMesh;
    if (!m) return;
    const n = this.streaks.length;
    m.visible = n > 0;
    if (!n) return;
    const P = m.geometry.attributes.position, C = m.geometry.attributes.color, pa = P.array, ca = C.array, c = this.streakColor;
    for (let k = 0; k < n; k++) {
      const s = this.streaks[k];
      const head = Math.min(s.len, s.t * s.speed), tail = Math.max(0, head - 22);
      const ax = s.from.x + s.dir.x * tail, ay = s.from.y + s.dir.y * tail, az = s.from.z + s.dir.z * tail;
      const bx = s.from.x + s.dir.x * head, by = s.from.y + s.dir.y * head, bz = s.from.z + s.dir.z * head;
      // 横の向き = 筋の向き × カメラへの向き
      let tx = 0, ty = 1, tz = 0, dist = 50;
      if (cam) { tx = cam.x - (ax + bx) / 2; ty = cam.y - (ay + by) / 2; tz = cam.z - (az + bz) / 2; dist = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; }
      let sx = s.dir.y * tz - s.dir.z * ty, sy = s.dir.z * tx - s.dir.x * tz, sz = s.dir.x * ty - s.dir.y * tx;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const w = Math.max(0.08, dist * 0.003);
      if (sl > 1e-6) { sx *= w / sl; sy *= w / sl; sz *= w / sl; } else { sx = w; sy = 0; sz = 0; }
      const o = k * 12;
      pa[o] = ax - sx; pa[o + 1] = ay - sy; pa[o + 2] = az - sz;
      pa[o + 3] = ax + sx; pa[o + 4] = ay + sy; pa[o + 5] = az + sz;
      pa[o + 6] = bx + sx; pa[o + 7] = by + sy; pa[o + 8] = bz + sz;
      pa[o + 9] = bx - sx; pa[o + 10] = by - sy; pa[o + 11] = bz - sz;
      // 尾は暗く、先は明るい（加算なので色 = 明るさ）
      for (let v = 0; v < 4; v++) { const f = v < 2 ? 0.2 : 1; ca[o + v * 3] = c.r * f; ca[o + v * 3 + 1] = c.g * f; ca[o + v * 3 + 2] = c.b * f; }
    }
    m.geometry.setDrawRange(0, n * 6);
    P.needsUpdate = true; C.needsUpdate = true;
  }

  // カタパルトの蒸気（白い煙。地面の点から少し上がって消える）
  steam(point, size) {
    const s = size || 1;
    if (!this.mats.steam) this.mats.steam = new THREE.SpriteMaterial({ map: FX.makeSoftTexture('#eef3f5'), transparent: true, depthWrite: false, opacity: 0.55 });
    const v = this._steamVel || (this._steamVel = new THREE.Vector3());
    v.set((Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2);
    this._spawn(this.mats.steam, point, { life: 0.9 + Math.random() * 0.6, size: 0.6 * s, sizeEnd: 2.6 * s, vel: v, gravity: 0.4 });
  }

  // ---------- 薬莢 ----------

  casing(pos, rightDir) {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(pos);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const vel = rightDir.clone().multiplyScalar(2.6 + Math.random()).add(new THREE.Vector3(0, 1.4 + Math.random(), 0));
    this.scene.add(m);
    this.casings.push({ mesh: m, vel, life: 1.3, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10) });
  }

  // ---------- 更新 ----------

  // cam: カメラ（筋の帯をカメラに向ける。無ければ上向き）
  update(dt, cam) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        this.particles.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      p.vel.y += p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const size = p.size0 + (p.size1 - p.size0) * t;
      p.sprite.scale.set(size, size, 1);
      p.sprite.material.opacity = p.opacity * (1 - t * t);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.scene.remove(tr.mesh);
        this.tracers.splice(i, 1);
        this.tracerPool.push(tr.mesh);
      }
    }
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.t += dt;
      const head = Math.min(s.len, s.t * s.speed), tail = Math.max(0, head - 22);
      if (tail >= s.len - 0.01 || s.t > 3) {
        this.streaks.splice(i, 1);
        this.streakPool.push(s);
      }
    }
    if (this.streakMesh) {
      const cp = cam ? (cam.isObject3D ? cam.getWorldPosition(this._camW || (this._camW = new THREE.Vector3())) : cam) : null;
      this._writeStreaks(cp);
    }
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < 0.01) { c.mesh.position.y = 0.01; c.vel.set(0, 0, 0); c.spin.set(0, 0, 0); }
      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.casings.splice(i, 1);
      }
    }
  }

  static get STREAK_MAX() { return 40; }

  // 放射状グラデーション（光るもの用）
  static makeGlowTexture(colorHex) {
    const s = 64;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, colorHex);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // ふんわりした円（煙・土・血用）
  static makeSoftTexture(colorHex) {
    const s = 64;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const c = new THREE.Color(colorHex);
    const rgb = Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(' + rgb + ',1)');
    g.addColorStop(0.5, 'rgba(' + rgb + ',0.5)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
};
