// 壊れる物の見た目とゲームのつなぎ（DM1a〜DM4a。街だけ。数値は game.json の destruct）。形と記録は destruct.js、当たり判定は nav3d_patch.js。
//
// ■ MR.DestructDebris（MR.Debris = debris.js を継承。debris.js は変えない）: 破片の地の色を種類（kit.color）ごとに instanceColor で塗る
//   （E3 の金属の破片は発光で赤く光るが、壁・小物の破片は光らない）。形は角ばった塊、kit.flat で薄い板（ガラス・木）。描画 1 回。
// ■ MR.DestructDecals: えぐれ・焦げ・ひびの板（1 つの InstancedMesh = 描画 1 回。テクスチャは DataTexture = Canvas なし）。
//   jets の E3 のこげ跡の InstancedMesh が入ったらそちらへ載せ替える（plan §5.3。add(p, n, s, kind) の形を合わせてある）。
// ■ MR.Destruction（game.destruct）: game.structHit(info) の中身。
//   hit(info): info = { x, y, z, radius, damage, kind: 'missile' | 'vehicle' | 'bullet' | 'gun' | 'ram', nx?, ny?, nz?, box?, edge?, v? }
//     → 範囲の小物を壊す（T1）、入れる建物の外壁なら穴（T2）、入れない建物・地面はえぐれ（見た目だけ）、屋上の給水塔（T3a）。戻り値は壊した数。
//     オンライン（game.online）は見た目だけ（破片・えぐれ。当たり判定と記録は変えない = DS14b）。
//   壊したら: 記録（持ち主のチャンク）→ 当たり判定（nav.dxApply + 歩行グラフの柱の作り直し dxRegraph を graphBudgetMs の中で）→ 近景の形
//     （壊した箱の面の三角形を縮める = インデックスを (a, a, a) に。1 フレームに 1 チャンクまで）+ 残りの箱とがれきの形（チャンクの root に 'dx'）
//     → 小物（CityProps.hide）→ 破片・えぐれ・音。
//   読み直し: これから読むチャンクの当たり判定は nav.dxFilter、近景の組み立ては streamer.onFullBuilt（組み立ての後に同じことをする）。
//   直さない（destruct-2 R1）: 記録は上限まで残り、超えたらプレイヤーから一番遠い物（小物が先）を外す。近景・keepNear m の中は外さない。
//   外した穴は遠景の暗い穴（reg.far）だけ残す。repairAfter を入れたときだけ、近景に無い間がその秒を超えた持ち主を直す（テスト用）。
(function () {
  const D = () => MR.Destruct;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ---------- 破片（色つき） ----------
  if (MR.Debris) {
    MR.DestructDebris = class DestructDebris extends MR.Debris {
      constructor(scene, cfg, opts) {
        super(scene, cfg, opts);
        this.cr = new Float32Array(this.cap); this.cg = new Float32Array(this.cap); this.cb = new Float32Array(this.cap);
        this._colCache = {};
      }
      _rgb(hex) {
        let c = this._colCache[hex];
        if (!c) {
          const v = MR.srgb ? MR.srgb(hex) : null;
          c = this._colCache[hex] = v && v.isColor ? [v.r, v.g, v.b] : (typeof THREE !== 'undefined' ? (() => { const t = new THREE.Color(hex); return [t.r, t.g, t.b]; })() : [0.5, 0.5, 0.5]);
        }
        return c;
      }
      _build() {
        if (this.mesh || typeof THREE === 'undefined') return;
        // ごつごつした塊（20 面の多面体の頂点を位置で決まる量だけずらす = 箱に見えない。面ごとの法線 = 割れたコンクリートの面）
        //   destruct-3 M1c: 以前は箱を少しゆがめただけで、大きな破片が茶色の段ボール箱に見えた
        const g0 = new THREE.IcosahedronBufferGeometry(0.62, 0), g = g0.index ? g0.toNonIndexed() : g0;
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, f = h - Math.floor(h);
          const h2 = Math.sin(x * 39.346 + y * 11.135 + z * 83.155) * 24634.6345, f2 = h2 - Math.floor(h2);
          pos.setXYZ(i, x * (0.75 + f * 0.5), y * (0.55 + f2 * 0.5), z * (0.8 + (1 - f) * 0.45));
        }
        g.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05 });
        mat.customProgramCacheKey = () => 'mr_dxdebris';
        const mesh = new THREE.InstancedMesh(g, mat, this.cap);
        if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
        if (mesh.instanceColor.setUsage) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
        mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'dxDebris';
        this.scene.add(mesh);
        this.mesh = mesh;
        this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
        this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
        this.stats.created += 2;
      }
      spawn(kit, p, v, spin, life) {
        const K = this._kit(kit);
        const i = super.spawn(K, p, v, spin, life);
        if (i < 0) return i;
        const c = this._rgb(this.colorHex || K.color || '#8d877d'), j = 0.6 + Math.random() * 0.5;
        this.cr[i] = c[0] * j; this.cg[i] = c[1] * j; this.cb[i] = c[2] * j;
        // 大きさはばらつかせる（小さい物が多く、ときどき大きい物）・カメラ（listener）のすぐ前（8 m）では小さく = 画面の前に大きな塊を出さない
        const R = Math.random(), L = this.listener;
        let k = 0.4 + 0.8 * R * R;
        if (L) { const d = Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z); if (d < 8) k *= Math.max(0.3, d / 8); }
        this.sx[i] *= k; this.sy[i] *= k; this.sz[i] *= k;
        if (K.flat > 0) this.sy[i] = this.sx[i] * K.flat;
        return i;
      }
      _kill(i) {
        const j = this.n - 1;
        if (i !== j) { this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j]; }
        super._kill(i);
      }
      // 止まった破片（state 2）は onRest に渡して消す（がれきの山の欠片になる = destruct-2 R2）
      update(dt, cam) {
        super.update(dt, cam);
        if (!this.onRest) return;
        let k = 0;
        for (let i = this.n - 1; i >= 0; i--) if (this.state[i] === 2 && this.onRest(this, i)) { this._kill(i); k++; } // がれきにならなかった物は寿命まで残す
        if (k) { this.stats.settled = (this.stats.settled || 0) + k; this._write(); }
      }
      _write() {
        const M = this.mesh;
        if (!M) return;
        const n = this.n;
        M.count = n; M.visible = n > 0;
        if (!n) return;
        const arr = M.instanceMatrix.array, col = M.instanceColor.array, fade = this.fade;
        const e = this._e, q = this._q, m = this._m, P = this._p, S = this._s;
        for (let i = 0; i < n; i++) {
          const left = this.lifeT[i] - this.t[i];
          const k = left < fade ? Math.max(0.001, left / fade) : 1;
          e.set(this.rx[i], this.ry[i], this.rz[i]); q.setFromEuler(e);
          P.set(this.px[i], this.py[i] + this.sy[i] * 0.3, this.pz[i]);
          S.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k);
          m.compose(P, q, S); m.toArray(arr, i * 16);
          col[i * 3] = this.cr[i]; col[i * 3 + 1] = this.cg[i]; col[i * 3 + 2] = this.cb[i];
        }
        M.instanceMatrix.needsUpdate = true; M.instanceColor.needsUpdate = true;
      }
      // 壁などから出る石の粉は音が金属でない（debris_metal を鳴らさない。最初に跳ねたときの音は音の名前 kit.sound）
      _sound(x, y, z, speed) {
        if (!this.soundName) return;
        if (!this.audio || typeof this.audio.play !== 'function' || this._sndT > 0 || speed < this.soundSpeed) return;
        const dx = x - this.listener.x, dy = y - this.listener.y, dz = z - this.listener.z;
        if (dx * dx + dy * dy + dz * dz > this.soundRange * this.soundRange) return;
        const P = this._sp; P.x = x; P.y = y; P.z = z;
        this._sndT = this.soundEvery; this.stats.sounds++;
        this.audio.play(this.soundName, { pos: P, refDistance: 6, maxDistance: this.soundRange, volume: Math.min(1, 0.3 + speed / 22), rate: 0.85 + Math.random() * 0.3, priority: 1 });
      }
    };
  }

  // ---------- えぐれ・焦げの板 ----------
  MR.DestructDecals = class DestructDecals {
    constructor(scene, cap, kind) {
      this.scene = scene; this.cap = Math.max(4, cap | 0 || 64);
      this.kind = kind || 'scorch'; // 'scorch' = えぐれ・焦げ・ひび、'exposed' = むき出しのれんが・鉄筋（destruct-3 M1）
      this.mesh = null; this.n = 0; this.next = 0;
      this.stats = { added: 0 };
    }
    _tex() {
      if (this.kind === 'exposed') return this._texExposed();
      if (this.kind === 'window') return this._texWindow();
      // 64 × 64: 真ん中が暗く、外へ向けて薄く、放射状のひび（アルファに焼く。色は材質の色 = 黒に近い茶）
      const S = 64, a = new Uint8Array(S * S * 4);
      let seed = 1234567;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const rays = []; for (let i = 0; i < 11; i++) rays.push([rnd() * Math.PI * 2, 0.5 + rnd() * 0.5]);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v), an = Math.atan2(v, u);
        let al = Math.max(0, 1 - r * 1.08); al = Math.pow(al, 0.9) * (0.8 + 0.2 * Math.sin(an * 7 + r * 9)) * 0.92;
        for (const ry of rays) { let d = Math.abs(((an - ry[0] + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (d < 0.05 * (1.2 - r) && r < ry[1]) al = Math.max(al, 0.7 * (1 - r / ry[1])); }
        const k = (y * S + x) * 4, c = r < 0.35 ? 18 : 34;
        a[k] = c; a[k + 1] = c - 4; a[k + 2] = c - 8; a[k + 3] = Math.min(255, Math.round(al * 255));
      }
      const t = new THREE.DataTexture(a, S, S, THREE.RGBAFormat);
      t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.encoding = THREE.sRGBEncoding; // 色のテクスチャ（CLAUDE.md の 9）
      return t;
    }
    // 64 × 64: 割れた漆喰の下のれんがの目地と、灰色のコンクリートの塊・鉄筋の筋。縁はぎざぎざ（アルファ）
    _texExposed() {
      const S = 64, a = new Uint8Array(S * S * 4);
      let seed = 7654321;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const edge = []; for (let i = 0; i < 24; i++) edge.push(0.72 + rnd() * 0.22);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v), an = Math.atan2(v, u);
        const ei = ((an / (Math.PI * 2) + 1) % 1) * edge.length, e0 = edge[ei | 0], e1 = edge[((ei | 0) + 1) % edge.length], f = ei - (ei | 0);
        const lim = e0 + (e1 - e0) * f;
        const k = (y * S + x) * 4;
        if (r > lim) { a[k + 3] = 0; continue; }
        // れんが（8 × 4 画素、段ごとに半分ずらす）
        const row = y >> 2, bx = (x + (row & 1) * 4) & 7, by = y & 3;
        const mortar = bx === 0 || by === 0;
        const conc = r > lim - 0.12; // 縁は割れたコンクリート / 漆喰
        let R, G, B;
        if (conc) { const c = 120 + (rnd() * 30 | 0); R = c; G = c - 4; B = c - 10; }
        else if (mortar) { R = 150; G = 142; B = 128; }
        else { const j = rnd() * 26 | 0; R = 128 + j; G = 62 + (j >> 1); B = 48 + (j >> 2); }
        if (!conc && (x % 21 === 5 || y % 19 === 9) && rnd() < 0.7) { R = 70; G = 46; B = 34; } // 鉄筋の筋（錆）
        a[k] = R; a[k + 1] = G; a[k + 2] = B; a[k + 3] = r > lim - 0.04 ? 150 : 245;
      }
      const t = new THREE.DataTexture(a, S, S, THREE.RGBAFormat);
      t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.encoding = THREE.sRGBEncoding;
      return t;
    }
    // 64 × 64: 割れた窓（destruct-3 M2）。中は暗い部屋（不透明）、縁に残ったガラスのぎざぎざの破片（明るい青、半透明）と窓枠の影
    _texWindow() {
      const S = 64, a = new Uint8Array(S * S * 4);
      let seed = 2468013;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const shards = [];
      for (let i = 0; i < 9; i++) shards.push([rnd() * Math.PI * 2, 0.35 + rnd() * 0.45]); // 縁から中への三角の破片（向き・長さ）
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, k = (y * S + x) * 4;
        const e = 1 - Math.max(Math.abs(u), Math.abs(v)); // 縁までの距離（0 = 縁）
        const an = Math.atan2(v, u), r = Math.max(Math.abs(u), Math.abs(v));
        let glass = e < 0.08;
        for (const sh of shards) { let d = Math.abs(((an - sh[0] + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (d < 0.35 * (r - (1 - sh[1])) && r > 1 - sh[1]) glass = true; }
        if (e < 0.03) { a[k] = 20; a[k + 1] = 20; a[k + 2] = 22; a[k + 3] = 255; continue; } // 窓枠の影
        if (glass) { const j = rnd() * 40 | 0; a[k] = 150 + j; a[k + 1] = 185 + j; a[k + 2] = 200 + (j >> 1); a[k + 3] = 170; }
        else { const j = rnd() * 6 | 0; a[k] = 10 + j; a[k + 1] = 12 + j; a[k + 2] = 16 + j; a[k + 3] = 250; }
      }
      const t = new THREE.DataTexture(a, S, S, THREE.RGBAFormat);
      t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.encoding = THREE.sRGBEncoding;
      return t;
    }
    _build() {
      if (this.mesh) return;
      const g = new THREE.PlaneBufferGeometry(1, 1);
      const mat = new THREE.MeshLambertMaterial({ map: this._tex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const mesh = new THREE.InstancedMesh(g, mat, this.cap);
      if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 2;
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = this.kind === 'exposed' ? 'dxExposed' : (this.kind === 'window' ? 'dxWindows' : 'dxDecals');
      this.scene.add(mesh);
      this.mesh = mesh;
      this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
      this._z = new THREE.Vector3(0, 0, 1); this._n = new THREE.Vector3(); this._r = new THREE.Quaternion();
    }
    // 点 p に、法線 n を向いた大きさ s の板（いっぱいなら一番古い物を上書き）
    add(p, n, s, sy, upright) { // sy = 縦の大きさ（無ければ s）、upright = 回さない（窓: 板の縦 = 世界の上）
      if (this.gate && this.gate(p)) return; // 倒れた建物の外す範囲の上（後から出る爆発の層が置くと宙に浮く。b17 の検証 B2 (c)）
      if (typeof THREE === 'undefined') return;
      this._build();
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      if (this.n < this.cap) this.n++;
      this._n.set(n.x, n.y, n.z).normalize();
      this._q.setFromUnitVectors(this._z, this._n);
      if (!upright) { this._r.setFromAxisAngle(this._z, Math.random() * Math.PI * 2); this._q.multiply(this._r); }
      this._p.set(p.x + this._n.x * 0.03, p.y + this._n.y * 0.03, p.z + this._n.z * 0.03);
      this._s.set(s, sy > 0 ? sy : s, 1);
      this._m.compose(this._p, this._q, this._s);
      this._m.toArray(this.mesh.instanceMatrix.array, i * 16);
      this.mesh.count = this.n;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.stats.added++;
    }
    clear() { this.n = 0; this.next = 0; if (this.mesh) this.mesh.count = 0; }
    // 箱 R（+ e m）の中の板を消す（大きさ 0。穴が開いて宙に浮く板）
    clearIn(R, e) {
      if (!this.mesh || !this.n) return 0;
      const A = this.mesh.instanceMatrix.array;
      let k = 0;
      for (let i = 0; i < this.n; i++) {
        const o = i * 16, x = A[o + 12], y = A[o + 13], z = A[o + 14];
        if (x < R.x0 - e || x > R.x1 + e || y < R.y0 - e || y > R.y1 + e || z < R.z0 - e || z > R.z1 + e) continue;
        for (let j = 0; j < 12; j++) A[o + j] = 0;
        k++;
      }
      if (k) this.mesh.instanceMatrix.needsUpdate = true;
      return k;
    }
    drawCalls() { return this.mesh && this.n > 0 ? 1 : 0; }
    dispose() {
      if (!this.mesh) return;
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose(); if (this.mesh.material.map) this.mesh.material.map.dispose(); this.mesh.material.dispose();
      if (this.mesh.dispose) this.mesh.dispose();
      this.mesh = null;
    }
  };

  // ---------- がれきの山（destruct-2 R2）----------
  // ■ MR.DestructRubble: 近くの記録のがれきの山（記録の鍵 + rm から決まる石・鉄筋・ガラスの欠片）と、止まった破片（settle）を全部で
  //   1 つの InstancedMesh（描画 1 回。最初のがれきで作る = ゲームの開始では何も作らない）。破片と同じ形・材質の作り（同じシェーダー）。
  //   cfg = destruct.rubble（drawDist / drawDistMobile・colors・pieces …）、caps = { rubble（インスタンスの上限）, settled（止まった破片の上限）}
  MR.DestructRubble = class DestructRubble {
    constructor(scene, cfg, caps, mobile) {
      this.scene = scene; this.cfg = cfg || {}; this.mobile = !!mobile;
      this.cap = Math.max(16, (caps.rubble | 0) || 1200);
      this.settledCap = Math.max(0, (caps.settled | 0) || 0);
      this.drawDist = (mobile ? this.cfg.drawDistMobile : this.cfg.drawDist) || (mobile ? 60 : 100);
      this.mesh = null; this.n = 0;
      this.st = new Float32Array(this.settledCap * 12); this.sn = 0; // 止まった破片: x y z sx sy sz rx ry rz r g b
      this.dirty = true; this._t = 0; this._cx = 1e9; this._cz = 1e9; this._ver = -1;
      this.stats = { rebuilds: 0, instances: 0, settled: 0, settledDropped: 0, piles: 0, created: 0, ms: 0, msMax: 0 };
      this._col = {};
    }
    _rgb(hex) {
      let c = this._col[hex];
      if (!c) { const C = MR.srgb ? MR.srgb(hex) : new THREE.Color(hex); c = this._col[hex] = [C.r, C.g, C.b]; }
      return c;
    }
    _build() {
      if (this.mesh || typeof THREE === 'undefined') return;
      // ごつごつした塊（破片と同じ 20 面の多面体のゆがみ。箱に見えない = destruct-3 M1c）。足元 = 0、高さ 0.7（_put が sy / 0.7）
      const g0 = new THREE.IcosahedronBufferGeometry(0.5, 0), g = g0.index ? g0.toNonIndexed() : g0;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, f = h - Math.floor(h);
        const h2 = Math.sin(x * 39.346 + y * 11.135 + z * 83.155) * 24634.6345, f2 = h2 - Math.floor(h2);
        pos.setXYZ(i, x * (0.85 + f * 0.4), (y * (0.55 + f2 * 0.35) + 0.5) * 0.7, z * (0.8 + (1 - f) * 0.35));
      }
      g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05 });
      mat.customProgramCacheKey = () => 'mr_dxdebris'; // 破片と同じシェーダー（先作りの描画で出来ている）
      const mesh = new THREE.InstancedMesh(g, mat, this.cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'dxRubble';
      this.scene.add(mesh);
      this.mesh = mesh;
      this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
      this.stats.created += 2;
    }
    // 止まった破片をがれきに（上限ならプレイヤーから一番遠いものと入れ替え）
    settle(x, y, z, sx, sy, sz, rx, ry, rz, r, g, b, fx, fz) {
      if (!this.settledCap) return;
      if (this._gated(x, y, z)) { this.stats.gated = (this.stats.gated || 0) + 1; return; } // 倒れた建物の上（宙）
      let i = this.sn;
      if (i >= this.settledCap) {
        // いっぱい: 16 個を選んで一番遠い物と入れ替え（全部なめると 1 つ止まるたびに settledCap 回 = 端末で 1 フレーム 20 ms）
        let bd = -1;
        for (let s2 = 0; s2 < 16; s2++) { const k = (Math.random() * this.sn) | 0, o = k * 12, d = (this.st[o] - fx) ** 2 + (this.st[o + 2] - fz) ** 2; if (d > bd) { bd = d; i = k; } }
        const o = i * 12, nd = (x - fx) ** 2 + (z - fz) ** 2;
        if (nd >= bd) { this.stats.settledDropped++; return; }
        this.stats.settledReplaced = (this.stats.settledReplaced || 0) + 1;
      } else this.sn++;
      const o = i * 12, A = this.st;
      A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = sx; A[o + 4] = sy; A[o + 5] = sz; A[o + 6] = rx; A[o + 7] = ry; A[o + 8] = rz; A[o + 9] = r; A[o + 10] = g; A[o + 11] = b;
      this.stats.settled++;
      this.dirty = true;
      // すぐ見えるように今のメッシュの後ろに足す（次の詰め直しで並べ直す。破片のメッシュから消えたフレームに出る）
      this._build();
      if (this.mesh && this.n < this.cap) {
        const M = this.mesh;
        this._put(A, o, M.instanceMatrix.array, M.instanceColor.array, this.n++);
        M.count = this.n; M.visible = true; M.instanceMatrix.needsUpdate = true; M.instanceColor.needsUpdate = true;
      }
    }
    // 記録 1 つの欠片（rec._pcs: Float32Array 12 個ずつ。rm が変わったら作り直す）
    pieces(rec, plan) {
      if (rec._pcs && rec._pcm === rec.rm) return rec._pcs;
      const C = this.cfg, X = D(), rnd = X.seeded(rec.k, 0x50494543);
      const brick = /brick/.test(rec.mat || '');
      const stone = (brick ? C.brickColors : C.colors) || ['#8a857c', '#9b968c', '#6f6a63'];
      const out = [];
      const add = (x, y, z, sx, sy, sz, rx, ry, rz, hex, k) => { const c = this._rgb(hex); out.push(x, y, z, sx, sy, sz, rx, ry, rz, c[0] * k, c[1] * k, c[2] * k); };
      for (let i = 0; i < plan.length; i++) {
        const m = X.slotMode(rec.rm, i);
        if (m === X.RUB.NONE) continue;
        const B = plan[i].v[m === X.RUB.SMALL ? 1 : 0], y0 = X.slotY(rec, i);
        const w = B.x1 - B.x0, d = B.z1 - B.z0, h = m === X.RUB.LOOK ? 0.05 : B.y1 - B.y0;
        const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
        if (m !== X.RUB.LOOK) { // 芯: 当たり判定の箱の形の大きな塊（山の形）
          add(cx, y0, cz, w * 0.85, h * 0.9, d * 0.85, 0, rnd() * 0.4 - 0.2, 0, stone[0], 0.85 + rnd() * 0.15);
        }
        const n = m === X.RUB.LOOK ? 3 + Math.floor(rnd() * 3) : Math.min(16, Math.max(5, Math.round(w * d * Math.max(h, 0.2) * 22) + 4));
        for (let j = 0; j < n; j++) {
          const sz = (0.12 + rnd() * 0.33) * (m === X.RUB.LOOK ? 0.6 : 1);
          const px = B.x0 + sz / 2 + rnd() * Math.max(0, w - sz), pz = B.z0 + sz / 2 + rnd() * Math.max(0, d - sz);
          const sy = m === X.RUB.LOOK ? Math.min(0.05, sz * 0.3) : Math.min(h, sz * (0.5 + rnd() * 0.6));
          const py = y0 + (m === X.RUB.LOOK ? 0 : rnd() * Math.max(0, h - sy));
          add(px, py, pz, sz, sy, sz * (0.7 + rnd() * 0.6), rnd() * 0.6 - 0.3, rnd() * 6.283, rnd() * 0.6 - 0.3, stone[Math.floor(rnd() * stone.length)], 0.8 + rnd() * 0.3);
        }
        if (rec.type === 'breach' && m !== X.RUB.LOOK) {
          // 鉄筋 1〜2 本・ガラスの欠片 2〜3 枚（低い山）
          const nr = 1 + Math.floor(rnd() * 2);
          for (let j = 0; j < nr; j++) add(B.x0 + rnd() * w, y0 + h * (0.4 + rnd() * 0.5), B.z0 + rnd() * d, 0.04, 0.04, 0.6 + rnd() * 0.6, rnd() * 0.5, rnd() * 6.283, rnd() * 0.5, C.rebarColor || '#5a3a28', 0.9 + rnd() * 0.2);
          if (plan[i].kind === 'low') for (let j = 0, ng = 2 + Math.floor(rnd() * 2); j < ng; j++) add(B.x0 + rnd() * w, y0 + h * (0.5 + rnd() * 0.5), B.z0 + rnd() * d, 0.14 + rnd() * 0.12, 0.012, 0.1 + rnd() * 0.1, rnd() * 0.4, rnd() * 6.283, rnd() * 0.4, C.glassColor || '#a9c4cf', 1);
        }
      }
      rec._pcs = new Float32Array(out); rec._pcm = rec.rm;
      return rec._pcs;
    }
    // 周りに散らばる欠片（destruct-3 M1c、オーナー「もっと瓦礫増やして」）: 見た目だけ（当たり判定なし = 扉・階段・梯子・湧く場所を
    //   ふさがない）。穴は外側の半円に rubble.scatter.breach 個（rubble.scatterR.breach m まで）、小物・給水塔は周りに、倒れた区画は区画の
    //   外の通り・歩道へ scatterR.collapse m あふれる（区画の縁ほど大きい）。地面の高さは groundAt（読み込んでいなければ作り直さずに後で）
    scatter(rec) {
      if (rec._sc) return rec._sc;
      const C = this.cfg, S = (this.mobile ? C.scatterMobile : C.scatter) || {}, SR = C.scatterR || {}, X = D(), rnd = X.seeded(rec.k, 0x53434154);
      const brick = /brick/.test(rec.mat || ''), stone = (brick ? C.brickColors : C.colors) || ['#8a857c', '#9b968c', '#6f6a63'];
      const out = [], G = this.groundAt;
      if (!G) return null;
      const add = (x, y, z, sz, flat, hex, k) => { const c = this._rgb(hex); out.push(x, y, z, sz, sz * flat, sz * (0.6 + rnd() * 0.7), rnd() * 0.5 - 0.25, rnd() * 6.283, rnd() * 0.5 - 0.25, c[0] * k, c[1] * k, c[2] * k); };
      const piece = (x, z, y0, big) => {
        const gy = G(x, z, y0);
        if (gy == null) return false; // 読み込んでいない（後で作り直す）
        if (Math.abs(gy - y0) > 3.5) return true; // 段の上・下（高架・屋上の縁）には置かない
        const u = rnd();
        if (u < (C.rebarShare || 0.08)) { const c = this._rgb(C.rebarColor || '#5a3a28'); out.push(x, gy + 0.03, z, 0.04, 0.04, 0.5 + rnd() * 0.9, rnd() * 0.3, rnd() * 6.283, rnd() * 0.3, c[0], c[1], c[2]); return true; }
        if (u < (C.rebarShare || 0.08) + (C.glassShare || 0.07)) { add(x, gy, z, 0.1 + rnd() * 0.18, 0.08, C.glassColor || '#a9c4cf', 1); return true; }
        const sz = (0.07 + 0.5 * Math.pow(rnd(), 2.2)) * big; // 小さい物が多い
        add(x, gy, z, sz, 0.35 + rnd() * 0.5, stone[Math.floor(rnd() * stone.length)], 0.6 + rnd() * 0.5);
        return true;
      };
      let miss = 0;
      if (rec.type === 'breach') {
        const n = S.breach || 40, R = SR.breach || 6, nx = rec.ax === 'x' ? rec.n : 0, nz = rec.ax === 'z' ? rec.n : 0;
        for (let i = 0; i < n; i++) {
          const a = (rnd() - 0.5) * Math.PI * 1.1, r = R * Math.sqrt(rnd()), tx = -nz, tz = nx; // 外側の半円
          const x = rec.x + nx * (0.4 + Math.cos(a) * r) + tx * Math.sin(a) * r, z = rec.z + nz * (0.4 + Math.cos(a) * r) + tz * Math.sin(a) * r;
          if (!piece(x, z, rec.y, 1.1)) miss++;
        }
      } else if (rec.type === 'collapse') {
        const L = rec.R || rec.C, n = S.collapse || 120, sp = SR.collapse || 8;
        const w = L.x1 - L.x0, d = L.z1 - L.z0;
        for (let i = 0; i < n; i++) {
          // 区画の外の帯（縁から sp m。縁の近くほど多く大きい）
          const side = Math.floor(rnd() * 4), t = rnd(), o = sp * Math.pow(rnd(), 1.6), big = 1.6 * (1 - o / sp) + 0.5;
          const x = side < 2 ? (side ? L.x1 + o : L.x0 - o) : L.x0 + t * w, z = side < 2 ? L.z0 + t * d : (side === 3 ? L.z1 + o : L.z0 - o);
          if (!piece(x, z, rec.y, big)) miss++;
        }
        // 山の上（山の箱の上面の高さ = 低い段）
        for (let i = 0, m = Math.round(n * 0.4); i < m; i++) { const x = L.x0 + rnd() * w, z = L.z0 + rnd() * d; add(x, rec.y + (rec.mound || 1) * (0.2 + rnd() * 0.8), z, 0.25 + rnd() * 0.9, 0.4 + rnd() * 0.4, stone[Math.floor(rnd() * stone.length)], 0.55 + rnd() * 0.5); }
      } else {
        const n = S.prop || 12, R = SR.prop || 3;
        for (let i = 0; i < n; i++) { const a = rnd() * 6.283, r = R * Math.sqrt(rnd()); if (!piece(rec.x + Math.cos(a) * r, rec.z + Math.sin(a) * r, rec.y, 0.7)) miss++; }
      }
      const arr = new Float32Array(out);
      if (!miss) rec._sc = arr;
      return arr;
    }
    // 近くの山と止まった破片を詰め直す（記録が変わった・止まった破片が増えた・カメラが 10 m 動いた。0.4 秒に 1 回まで）
    update(dt, reg, cam, cfgR) {
      this._t -= dt;
      const moved = Math.hypot(cam.x - this._cx, cam.z - this._cz) > 10;
      if (!(this.dirty || moved || reg.ver !== this._ver) || this._t > 0) return;
      this._t = 0.4;
      const t0 = now();
      const DD = this.drawDist, list = [];
      let total = 0;
      for (const r of reg.recs.values()) {
        const dd = Math.hypot(r.x - cam.x, r.z - cam.z);
        if (dd > DD + (r.type === 'collapse' ? 40 : 0)) continue;
        if (r.rm >= 0) { const pc = this.pieces(r, D().planRubble(r, cfgR)); if (pc.length) { list.push([dd, pc]); total += pc.length / 12; } }
        if (this.cfg.scatter !== false) { const sc = this.scatter(r); if (sc && sc.length) { list.push([dd + 0.01, sc]); total += sc.length / 12; } }
      }
      let sn = 0;
      for (let k = 0; k < this.sn; k++) { const o = k * 12; if (Math.hypot(this.st[o] - cam.x, this.st[o + 2] - cam.z) <= DD) sn++; }
      if (!list.length && !sn) { if (this.mesh) { this.mesh.count = 0; this.mesh.visible = false; } this.n = 0; this._fin(cam, reg, t0, 0); return; }
      this._build();
      if (total + sn > this.cap) list.sort((a, b) => a[0] - b[0]);
      const M = this.mesh, arr = M.instanceMatrix.array, col = M.instanceColor.array;
      let n = 0;
      const gate = !!this.gate && this.gate.active && this.gate.active();
      for (let k = 0; k < this.sn && n < this.cap; k++) { const o = k * 12; if (Math.hypot(this.st[o] - cam.x, this.st[o + 2] - cam.z) <= DD && !(gate && this._gated(this.st[o], this.st[o + 1], this.st[o + 2]))) this._put(this.st, o, arr, col, n++); }
      for (const [, pc] of list) { // 山は全部入るときだけ（半分だけ描かない）
        if (n + pc.length / 12 > this.cap) continue;
        for (let o = 0; o < pc.length; o += 12) if (!(gate && this._gated(pc[o], pc[o + 1], pc[o + 2]))) this._put(pc, o, arr, col, n++);
      }
      M.count = n; M.visible = n > 0;
      M.instanceMatrix.needsUpdate = true; M.instanceColor.needsUpdate = true;
      this.n = n;
      this._fin(cam, reg, t0, list.length);
    }
    // gate（Destruction._floatAt）: 倒れた区画の外す範囲の上 = 描かない（前の穴の山・止まった破片が元の床の高さに浮く。b17 の検証 R1）
    _gated(x, y, z) { if (!this.gate) return false; const p = this._gp || (this._gp = { x: 0, y: 0, z: 0 }); p.x = x; p.y = y; p.z = z; return this.gate(p); }
    _put(A, o, arr, col, n) {
      this._e.set(A[o + 6], A[o + 7], A[o + 8]); this._q.setFromEuler(this._e);
      this._p.set(A[o], A[o + 1], A[o + 2]); this._s.set(A[o + 3], A[o + 4] / 0.7, A[o + 5]);
      this._m.compose(this._p, this._q, this._s); this._m.toArray(arr, n * 16);
      col[n * 3] = A[o + 9]; col[n * 3 + 1] = A[o + 10]; col[n * 3 + 2] = A[o + 11];
    }
    _fin(cam, reg, t0, piles) {
      this.dirty = false; this._cx = cam.x; this._cz = cam.z; this._ver = reg.ver;
      this.stats.rebuilds++; this.stats.instances = this.n; this.stats.piles = piles;
      const ms = now() - t0; this.stats.ms = ms; if (ms > this.stats.msMax) this.stats.msMax = ms;
    }
    drawCalls() { return this.mesh && this.mesh.visible && this.n > 0 ? 1 : 0; }
    clearSettled() { this.sn = 0; this.dirty = true; }
    dispose() {
      if (!this.mesh) return;
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose(); this.mesh.material.dispose();
      if (this.mesh.dispose) this.mesh.dispose();
      this.mesh = null;
    }
  };

  // ---------- ゲームのつなぎ ----------
  MR.Destruction = class Destruction {
    constructor(game, cfg) {
      this.game = game;
      this.cfg = cfg = cfg || {};
      const mobile = !!(game.input && game.input.isTouchDevice);
      this.mobile = mobile;
      const M = (mobile && cfg.mobile) || {};
      // タッチ端末の上書き（destruct-3 M4 の C: 隣の穴の数・ガラスの半径・倒壊の代わりの形。壊す倍率 × 2 / × 6 は同じ）。game.json の共有の物は変えない（写しへ）
      if (mobile && (M.breach || M.glass || M.collapse)) {
        this.cfg = cfg = Object.assign({}, cfg, {
          breach: Object.assign({}, cfg.breach || {}, M.breach || {}),
          glass: Object.assign({}, cfg.glass || {}, M.glass || {}),
          collapse: Object.assign({}, cfg.collapse || {}, M.collapse || {})
        });
      }
      const caps = Object.assign({ records: 3000, debris: 400, decals: 96 }, cfg.caps || {}, M.caps || {});
      this.caps = caps;
      this.online = !!game.online;
      this.solid = !this.online || cfg.online === true; // 当たり判定を変えるか（オンラインは変えない: DS14b）
      this.reg = new (D().Registry)({ cap: caps.records, farCap: caps.farCuts, repairAfter: cfg.repairAfter, keepNear: cfg.keepNear > 0 ? cfg.keepNear : 200 });
      // 上限: プレイヤーから一番遠い記録から外す。近景にある・keepNear m 以内の持ち主の記録は外さない（見えている穴は閉じない）
      this._focus = { x: 0, z: 0 };
      this.reg.focus = this._focus;
      this.reg.protect = (owner) => !!(this.world.streamer && this.world.streamer.full.has(owner));
      this.world = game.world;
      this.nav = game.world.nav;
      this.city = game.city;
      this.overhang = (this.city && this.city.plan && this.city.plan.maxOverhang) || 64;
      this.debris = MR.DestructDebris ? new MR.DestructDebris(game.scene, Object.assign({}, cfg.debris || {}), {
        cap: caps.debris, mobile, audio: game.audio,
        support: (x, z, yRef) => this._support(x, z, yRef),
        water: (x, z) => (this.city ? this.city.groundAt(x, z).water : null)
      }) : null;
      if (this.debris) this.debris.soundName = (cfg.debris && cfg.debris.sound) || 'impact_concrete';
      this.decals = new MR.DestructDecals(game.scene, caps.decals);
      this.exposed = new MR.DestructDecals(game.scene, caps.exposed || 32, 'exposed'); // むき出しのれんが（destruct-3 M1。メッシュは最初の板で作る）
      this.windows = new MR.DestructDecals(game.scene, caps.windows || 128, 'window'); // 割れた窓（destruct-3 M2。最初の窓で作る）
      this._gate = (p) => this._floatAt(p);
      this.decals.gate = this.exposed.gate = this.windows.gate = this._gate;
      this._gate.active = () => !!(this.colls && this.colls.length);
      this.glcfg = Object.assign({}, cfg.glass || {});
      this.broken = new Set(); // 割れた窓の鍵（同じ窓を 2 回割らない。上限 caps.windows を超えたら忘れる = 板も一番古い物から上書き）
      // がれき（R2）: 記録の山（rm）と止まった破片。メッシュは最初のがれきで作る
      this.rcfg = Object.assign({}, cfg.rubble || {});
      D().rubbleCfg = this.rcfg;
      this.rubbleOn = this.rcfg.enabled !== false;
      this.rubble = this.rubbleOn && MR.DestructRubble ? new MR.DestructRubble(game.scene, this.rcfg, { rubble: caps.rubble, settled: caps.settled }, mobile) : null;
      if (this.rubble) this.rubble.gate = this._gate;
      if (this.rubble) this.rubble.groundAt = (x, z, y0) => { const nav = this.nav; if (!nav || typeof nav.groundHeight !== 'function') return null; const c = this.city.chunkOf(x, z); if (nav.hasChunk && !nav.hasChunk(c.cx + '_' + c.cz)) return null; return nav.groundHeight(x, z, y0 + 1.5, 0.2); };
      this.pending = new Set(); // がれきをまだ決めていない記録（家具のチャンクがまだ読めていない）
      // 銃（R3）: 外壁の 1 m の升ごとの体力（鍵 → { hp, st, x, y, z }）・壊れた升（面 → Set('cu|cv')）・穴の決め直しの待ち（面 → { hint, t }）
      this.gcfg = Object.assign({}, cfg.gun || {});
      this.cells = new Map(); this.dead = new Map(); this.gunQ = new Map(); this.gunLast = new Map();
      this._chips = 0;
      if (this.debris && this.rubble && this.rcfg.settle !== false) {
        this.debris.onRest = (deb, i) => this._settle(deb, i);
        this.debris.settleOn = false; // 先作りの破片が終わるまで
      }
      this.jobs = [];          // 歩行グラフの作り直し（dxRegraph）
      this.anims = [];         // 給水塔が落ちる見た目（形は CityProps のものを借りる = 捨てない）
      this.meshQueue = [];     // 近景の形を直すチャンク（1 フレームに 1 つ）
      this.hp = new Map();     // まだ壊れていない小物の残りの体力（鍵 → hp）
      this.applied = new Map(); // 持ち主 → 当たり判定に今入っているまとめた効き目（Destruct.deriveAll の結果）
      this.cosm = new Map();   // オンライン: 見た目だけ壊した小物（鍵 → 時刻。cosmeticSec 秒は同じ物を壊さない = はねるたびに破片を出さない）
      this.stats = { hits: 0, props: 0, breaches: 0, tanks: 0, craters: 0, cosmetic: 0, navMs: 0, navMsMax: 0, meshMs: 0, meshMsMax: 0, hitMs: 0, hitMsMax: 0,
        uploads: 0, tris: 0, dxMeshes: 0, repaired: 0, graphMs: 0, graphMsMax: 0 };
      this._tmp = { x: 0, y: 0, z: 0 };
      this._repT = 0;
      // 当たり判定（これから読むチャンク）・近景の組み立て・小物の見た目のつなぎ
      if (this.solid && this.nav) this.nav.dxFilter = (key, data) => this._filter(key, data);
      if (this.world.streamer) this.world.streamer.onFullBuilt = (rec, out) => this._onFullBuilt(rec, out);
      if (this.world.props) this.world.props.hide = (p, m) => this._propHidden(p, m);
      if (this.solid) Destruction.warm();
      // 描画の先作り（plan: real warm-up draws）: メッシュとテクスチャを今作り、最初の数フレームは地面の下 60 m に小さな破片と板を 1 つずつ
      //   描く（シェーダーを最初の爆発の前にコンパイルさせる。InstancedMesh は frustumCulled = false なので描かれる）
      if (typeof THREE !== 'undefined') { if (this.debris) this.debris._build(); this.decals._build(); }
      this._warmLeft = 3;
    }
    // 最初の当たりの前に、穴の計画・まとめた効き目・箱の引き算を小さな作り物の壁で数回（JIT。最初のミサイルで 10 ms 以上かかっていた）
    static warm() {
      if (Destruction._warmed) return;
      Destruction._warmed = true;
      const X = D(), S = 16, E = 'exterior';
      for (let k = 0; k < 4; k++) {
        const boxes = [];
        for (let i = 0; i < 6; i++) boxes.push({ x: i * 3 + 0.9, y: 0.15, z: 0.15, w: 1.8, h: 2.4, d: 0.3, mat: 'brick_red', cat: E, f: S }, { x: i * 3 + 2.4, y: 0.15, z: 0.15, w: 1.2, h: 1, d: 0.3, mat: 'brick_red', cat: E, f: S });
        boxes.push({ x: 9, y: 2.55, z: 0.15, w: 18, h: 1.1, d: 0.3, mat: 'brick_red', cat: E, f: S }, { x: 2, y: 0.15, z: 3, w: 0.6, h: 0.9, d: 0.6, mat: 'metalDark', cat: 'prop', f: 0 });
        const data = { key: 'warm', boxes, ladders: [], props: [] };
        const r = X.planBreach(X.subsets(boxes).shell, { x: 7.5 + k * 0.1, y: 1.3, z: 0.35 }, {});
        const p = X.planProp({ x: 2, y: 0.15, z: 3, type: 'trash_can' }, { r: 0.35, dims: [[0.6, 0.9, 0.6]] });
        if (r) X.filterNav(data, [r, p]);
        // 当たり判定の口（nav3d_patch）も小さな nav で
        if (r && MR.Nav3D && MR.Nav3D.prototype.dxApply) {
          try {
            const nav = new MR.Nav3D({ minX: -64, minZ: -64, maxX: 64, maxZ: 64, chunkSize: 128, graphCell: 1 });
            nav.addChunk('0_0', { cx: 0, cz: 0, boxes, ramps: [], ladders: [] });
            nav._graph(0, 0);
            const dv = X.deriveAll(data, [r]);
            const res = nav.dxApply('0_0', dv.remove, dv.add, r.R);
            if (res) { const job = nav.dxRegraph(res.x0 - 1, res.z0 - 1, res.x1 + 1, res.z1 + 1); for (let i = 0; i < 20 && !job.step(5); i++); }
          } catch (e) { /* 先作りだけ */ }
        }
      }
    }

    _support(x, z, yRef) {
      const nav = this.nav;
      if (nav && nav.groundHeight) { const y = nav.groundHeight(x, z, yRef, 0); if (y != null) return y; }
      return null;
    }

    // これから読むチャンク（nav.addChunk の前）: まとめた効き目で写しを作り、当たり判定に入れた状態として覚える（_sync の差の元）
    _filter(key, data) {
      const L = this.reg.list(key);
      if (!L || !L.length) { this.applied.delete(key); return data; }
      this.applied.set(key, D().deriveAll(data, L));
      return D().filterNav(data, L);
    }
    _pkey(p) { return D().Registry.pos(p); }
    _propHidden(p, m) {
      if (m == null && this.reg.props.size > 0 && this.reg.props.has(this._pkey(p))) return true; // m: 街の細かい物（CityKit）は壊れる小物ではない
      if (this.colls && this.colls.length) { const r = this.collapsedAt(p.x, p.z, m == null ? 0.3 : m); if (r && p.y >= r.C.y0 - 1) return true; } // 倒れた建物の上・中の小物
      return false;
    }

    // 読み込んであるチャンクのデータ（無ければ null。作らない）
    _chunk(cx, cz) {
      const c = this.world.cache;
      const d = c && c.map && c.map.get(cx + '_' + cz);
      return d && d.full ? d.full : null;
    }
    // 索引の先作り: カメラの周り 5 × 5 の読み込み済みチャンクのうち、まだ索引の無い物を 1 フレームに 1 つ（大きな爆発の最初の当たりで
    //   周りのチャンクの索引をまとめて作ると 5 ms 前後かかった。チャンクは作らない = キャッシュにある物だけ）
    _idxWarm(cam) {
      if (!cam || !this.city) return;
      if (((this._fN | 0) % 6) !== 0) return; // 6 フレームに 1 回（壊れていない間も毎フレーム回っていた = 街を歩くだけの重さ）
      if (this._iwT > 0) { this._iwT--; return; }
      const c = this.city.chunkOf(cam.x, cam.z), W = Destruction._IDX;
      let i = this._iwI = ((this._iwI | 0) + 1) % 25;
      for (let k = 0; k < 25; k++, i = (i + 1) % 25) {
        const d = this._chunk(c.cx + (i % 5) - 2, c.cz + ((i / 5) | 0) - 2);
        if (d && !W.has(d)) { const t0 = now(); this._idx(d); this._iwI = i; if (now() - t0 > 1.5) this._iwT = 4; return; } // 重いチャンク（ニューヨーク）の後は少し休む
      }
    }
    // 持ち主のデータ（キャッシュから外れていれば作り直す = 同じ物が決定的に出来る）
    _owner(key) { const p = key.split('_'); return this.world.cache.full(+p[0], +p[1]); }
    // (x, z) の周り ± overhang のチャンクを visit(data)
    _around(x, z, r, visit) {
      const city = this.city, oh = this.overhang + r;
      const a = city.chunkOf(x - oh, z - oh), b = city.chunkOf(x + oh, z + oh);
      for (let cz = a.cz; cz <= b.cz; cz++) for (let cx = a.cx; cx <= b.cx; cx++) {
        const d = this._chunk(cx, cz);
        if (d && visit(d) === true) return;
      }
    }
    // チャンクの索引（最初に使うとき 1 回）: 入れる建物の外壁の箱・壊れる小物と、それぞれの外接矩形（当たりはここだけ見る）
    _idx(d) {
      const W = Destruction._IDX;
      let ix = W.get(d);
      if (ix) return ix;
      const shell = D().subsets(d.boxes).shell, props = [], PR = this.cfg.props || {};
      let s0 = Infinity, s1 = Infinity, s2 = -Infinity, s3 = -Infinity, p0 = Infinity, p1 = Infinity, p2 = -Infinity, p3 = -Infinity;
      for (const b of shell) {
        const hw = b.w / 2, hd = b.d / 2;
        if (b.x - hw < s0) s0 = b.x - hw; if (b.z - hd < s1) s1 = b.z - hd; if (b.x + hw > s2) s2 = b.x + hw; if (b.z + hd > s3) s3 = b.z + hd;
      }
      for (const p of d.props) {
        if (!PR[p.type]) continue;
        props.push(p);
        if (p.x < p0) p0 = p.x; if (p.z < p1) p1 = p.z; if (p.x > p2) p2 = p.x; if (p.z > p3) p3 = p.z;
      }
      // 外壁の 8 m の格子と、同じ面（薄い軸と面の座標）の一覧: 穴の計画には近くの箱と、一番近い箱の面の箱だけを渡す（結果は全部渡したのと同じ）
      const grid = new Map(), planes = new Map();
      for (const b of shell) {
        const hw = b.w / 2, hd = b.d / 2;
        for (let i = Math.floor((b.x - hw) / 8); i <= Math.floor((b.x + hw) / 8); i++) for (let j = Math.floor((b.z - hd) / 8); j <= Math.floor((b.z + hd) / 8); j++) {
          const k = i * 65536 + j; let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(b);
        }
        for (const pk of Destruction._planeKeys(b)) { let a = planes.get(pk); if (!a) { a = []; planes.set(pk, a); } a.push(b); }
      }
      ix = { shell, sbb: [s0, s1, s2, s3], props, pbb: [p0, p1, p2, p3], grid, planes };
      W.set(d, ix);
      return ix;
    }
    // 箱の面の鍵（壁の厚さ wall の軸。両方なら両方）
    static _planeKeys(b) {
      const out = [], wt = 0.3;
      if (Math.abs(b.w - wt) < 0.03) out.push('x' + Math.round(b.x * 100));
      if (Math.abs(b.d - wt) < 0.03) out.push('z' + Math.round(b.z * 100));
      return out;
    }
    // (x, z) の周り r の外壁の箱 + その中で一番近い箱の面の箱（重複なし）
    _shellNear(ix, x, y, z, r) {
      const out = [], seen = new Set();
      let best = null, bd = Infinity;
      for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
        const a = ix.grid.get(i * 65536 + j);
        if (!a) continue;
        for (const b of a) {
          if (seen.has(b)) continue;
          seen.add(b); out.push(b);
          const B = D().box(b);
          const dx = x < B.x0 ? B.x0 - x : x > B.x1 ? x - B.x1 : 0, dy = y < B.y0 ? B.y0 - y : y > B.y1 ? y - B.y1 : 0, dz = z < B.z0 ? B.z0 - z : z > B.z1 ? z - B.z1 : 0;
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd < bd) { bd = dd; best = b; }
        }
      }
      if (best) for (const pk of Destruction._planeKeys(best)) for (const b of ix.planes.get(pk) || []) if (!seen.has(b)) { seen.add(b); out.push(b); }
      return out;
    }
    static _near(bb, x, z, r) { return x >= bb[0] - r && x <= bb[2] + r && z >= bb[1] - r && z <= bb[3] + r; }

    // ---------- 当たった ----------
    hit(info) {
      if (!info || !this.city) return 0;
      this._setFocus();
      const t0 = now(), C = this.cfg;
      this.stats.hits++;
      this._batch = new Map(); // 持ち主 → 変わった記録（当たりの最後に 1 回ずつ _sync）
      info = this._scaled(info, C);
      try { return this._hit(info, t0, C); } finally {
        const B = this._batch;
        this._batch = null;
        if (B) for (const [owner, recs] of B) this._flush(owner, recs);
        const ms = now() - t0;
        this.stats.hitMs = ms; if (ms > this.stats.hitMsMax) this.stats.hitMsMax = ms;
      }
    }
    // 壊す倍率（destruct-3 M1c。オーナー「2倍ぶっ壊れるように」「ミサイルは6倍」）: 爆発（missile / blast / vehicle）と機関砲は
    //   ダメージ × mul・半径 × √mul（壊れる面積 ≒ mul 倍。半径を mul 倍にすると面積 mul² 倍で街区ごと消える）。mul = info.structMul
    //   （game.explode が explosives.blasts.<id>.structMul を渡す）> destruct.scale.struct。銃の弾（bullet）は destruct.gun.mul（データで 2 倍）、ram はそのまま
    _scaled(info, C) {
      const k = info.kind;
      if (this.noScale || (k !== 'missile' && k !== 'blast' && k !== 'vehicle' && k !== 'gun')) return info; // noScale = テストの前の場面（倍率の前の数で確かめる）
      const SC = C.scale || {}, mul = info.structMul > 0 ? info.structMul : (SC.struct > 0 ? SC.struct : 1);
      const o = this._si || (this._si = {});
      for (const key in o) o[key] = undefined;
      Object.assign(o, info);
      o.mul = mul;
      if (mul !== 1) { o.damage = (info.damage || 0) * mul; o.radius = (info.radius > 0 ? info.radius : 1) * Math.sqrt(mul); }
      return o;
    }
    _hit(info, t0, C) {
      const R = info.radius > 0 ? info.radius : 1, Dm = info.damage || 0, edge = info.edge == null ? 0.6 : info.edge;
      const at = (d) => Dm * Math.max(0, 1 - d / R * edge);
      let n = 0;
      // 小物（T1）と給水塔（T3a）。弾が小物でない箱に当たったなら見ない
      const PR = C.props || {};
      const brk = [];
      if (!(info.kind === 'bullet' && info.box && info.box.cat !== 'prop')) this._around(info.x, info.z, R, (d) => {
        const ix = this._idx(d);
        if (!ix.props.length || !Destruction._near(ix.pbb, info.x, info.z, R + 3)) return;
        for (const p of ix.props) {
          const rule = PR[p.type];
          const dx = p.x - info.x, dz = p.z - info.z;
          if (Math.abs(dx) > R + 3 || Math.abs(dz) > R + 3) continue;
          const cy = p.y + (rule.cy || 0.6);
          const dist = Math.max(0, Math.hypot(dx, cy - info.y, dz) - (rule.r || 0.5));
          if (dist > R) continue;
          // 弾は当たった箱の小物だけ
          if ((info.kind === 'bullet' || info.kind === 'gun') && !(info.box && info.box.cat === 'prop' && this._boxNear(info.box, p, rule))) continue;
          brk.push([d, p, rule, at(dist)]);
        }
      });
      // 小物は近い順に props.perHit 個まで今、残りは次のフレームから（_propPump。ミサイルの × 6 で 34 m の中の小物を 1 フレームで壊していた）
      const per = (C.props && C.props.perHit) || 4;
      if (brk.length > per && info.kind !== 'bullet' && info.kind !== 'gun' && info.kind !== 'ram') {
        brk.sort((a, b) => Math.hypot(a[1].x - info.x, a[1].z - info.z) - Math.hypot(b[1].x - info.x, b[1].z - info.z));
        const PQ = this._pq || (this._pq = []), I = { x: info.x, y: info.y, z: info.z, kind: info.kind, vx: info.vx, vz: info.vz };
        for (let k = per; k < brk.length && PQ.length < 64; k++) PQ.push([brk[k][1], brk[k][2], brk[k][3], I]);
        brk.length = per;
      }
      for (const [d, p, rule, dmg] of brk) if (this._damageProp(d, p, rule, dmg, info)) n++;
      // 窓（destruct-3 M2）: 爆発は半径の中の窓、弾は当たった窓 1 枚（見た目だけ = オンラインも）
      // 窓を探すのは次のフレーム（_glassPump。半径 44 m の外壁をなめるのに 2〜9 ms = 当たりのフレームを短く）
      if (info.kind === 'missile' || info.kind === 'vehicle' || info.kind === 'blast') { const GQ = this._gbQ || (this._gbQ = []); if (GQ.length >= 6) GQ.shift(); GQ.push({ x: info.x, y: info.y, z: info.z, kind: info.kind, nx: info.nx, nz: info.nz, R, Dm: info.damage || 0, edge: info.edge == null ? 0.6 : info.edge }); }
      else if (info.kind === 'bullet' && info.box && info.box.cat === 'exterior') this._glassShot(info);
      // 壁（T2）とえぐれ
      if (info.kind === 'missile' || info.kind === 'vehicle' || info.kind === 'gun' || info.kind === 'blast') n += this._wall(info, R, at);
      // 銃の弾が壁に（R3）: 入れる建物の外壁は升の体力 → 穴、ほかはひびの板（見た目だけ）
      else if (info.kind === 'bullet' && info.box && info.box.cat !== 'prop') n += this._gunHit(info);
      // 倒壊（destruct-3 M3）: 区画の構造の体力（ソロだけ）
      if (this.solid && info.kind !== 'ram' && (info.kind !== 'bullet' || (info.box && info.box.cat !== 'prop'))) this._collapseHit(info, R, at);
      return n;
    }
    _boxNear(b, p, rule) {
      const B = D().box(b), r = (rule.r || 0.6) + 0.2;
      return p.x > B.x0 - r && p.x < B.x1 + r && p.z > B.z0 - r && p.z < B.z1 + r;
    }

    _damageProp(d, p, rule, dmg, info) {
      if (dmg <= 0) return false;
      const isTank = rule.tier === 'tank';
      const k = (isTank ? 't|' : 'p|') + this._pkey(p);
      if (this.reg.has(k)) return false;
      if (!this.solid) { const t = this.cosm.get(k); if (t != null && (this.game.time || 0) - t < (this.cfg.cosmeticSec > 0 ? this.cfg.cosmeticSec : 20)) return false; }
      const hp0 = rule.hp > 0 ? rule.hp : 100;
      const left = (this.hp.has(k) ? this.hp.get(k) : hp0) - dmg;
      if (left > 0) { this.hp.set(k, left); return false; }
      this.hp.delete(k);
      // 破片（見た目。オンラインも）
      const dx = p.x - info.x, dz = p.z - info.z, dl = Math.hypot(dx, dz) || 1;
      const push = Math.min(14, 3 + dmg / 40);
      const vx = info.kind === 'ram' && info.vx != null ? info.vx * 0.6 : dx / dl * push, vz = info.kind === 'ram' && info.vz != null ? info.vz * 0.6 : dz / dl * push;
      this._burst(rule.kit || 'metal', p.x, p.y + (rule.cy || 0.6), p.z, rule.n, vx, info.kind === 'ram' ? 2 : 3, vz);
      if (rule.kit2) this._burst(rule.kit2, p.x, p.y + (rule.cy || 0.6), p.z, rule.n2, vx, 3, vz);
      this._sound(rule.sound || 'impact_metal', p, rule.rate);
      if (!this.solid) { this.stats.cosmetic++; this.cosm.set(k, this.game.time || 0); return true; }
      const rec = isTank ? D().planTank(p, rule) : D().planProp(p, rule);
      rec.k = k;
      if (!this.reg.add(rec, d.key, this.game.time || 0, (v) => this._repairRec(v))) return false;
      if (isTank) { this.stats.tanks++; this._tankFall(p, rule); } else this.stats.props++;
      this._queueRubble(rec);
      this._changed(d.key, rec);
      if (this.world.props) this.world.props.markDirty();
      return true;
    }

    burst(kit, x, y, z, n, vx, vy, vz, color) { this._burst(kit, x, y, z, n, vx, vy, vz, color); }
    _burst(kit, x, y, z, n, vx, vy, vz, color) { // color = 地の色を替える（'#rrggbb'。外壁の色の塊 = destruct-3 M1）
      if (!this.debris) return;
      const K = this.debris._kit(kit);
      if (Array.isArray(n)) n = n[0] + Math.floor(Math.random() * (n[1] - n[0] + 1));
      this.debris.colorHex = color || null;
      this.debris.burst(K, x, y, z, n == null ? null : n, vx, vy, vz);
      this.debris.colorHex = null;
    }
    // 音は今ある物（impact_concrete / impact_metal / debris_metal。plan: 新しい音は work/knife の A0 の decode group 'destruct' が入ってから）
    _sound(name, p, rate) {
      const a = this.game.audio;
      if (a && typeof a.play === 'function') a.play(name, { pos: p, refDistance: 6, maxDistance: 120, priority: 1, rate: (rate || 1) * (0.9 + Math.random() * 0.2) });
    }

    // 穴の計画 rec（R = 穴の箱）が今出ている自動ドアの開口（同じ壁の面・横と高さが重なる）にかかるか
    _onDoor(rec) {
      const DM = this.world.doors;
      if (!DM) return false;
      const R = rec.R, m = 0.3;
      // 出している扉（立っている所の 3 × 3）と、穴の周りの 3 × 3 のチャンクの扉（doors.js の findChunk。遠くの穴も = 銃・ミサイル）
      const list = (DM.list || []).slice();
      if (MR.Doors && MR.Doors.findChunk && DM.ctx) {
        // 穴のチャンクの扉がまだ出ていなければ（立っている所から遠い穴）そのチャンクだけ探す（1 チャンク 数 ms。覚えておく）
        const c = this.city.chunkOf((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2), k = c.cx + '_' + c.cz, DC = this._doorCache || (this._doorCache = new Map());
        if (!(DM.active && DM.active.has(k))) {
          let ds = DC.get(k);
          if (!ds) { const full = this.world.cache.full(c.cx, c.cz); ds = full ? MR.Doors.findChunk(full, DM.ctx, DM.cfg) : []; DC.set(k, ds); if (DC.size > 16) DC.delete(DC.keys().next().value); }
          for (const d of ds) list.push(d);
        }
      }
      if (!list.length) return false;
      for (const d of list) {
        const hw = (d.w || 2) / 2, ux = Math.abs(d.ux || 0), uz = Math.abs(d.uz || 0);
        const x0 = d.x - ux * hw - m, x1 = d.x + ux * hw + m, z0 = d.z - uz * hw - m, z1 = d.z + uz * hw + m;
        if (x1 < R.x0 - m || x0 > R.x1 + m || z1 < R.z0 - m || z0 > R.z1 + m) continue;
        if (d.y + (d.h || 2.5) < R.y0 || d.y > R.y1) continue;
        return true;
      }
      return false;
    }

    // ---------- ガラスと外壁（destruct-3 M2）----------
    // 外壁の窓の格子: 材質ごとの CityKit の格子（bay・storey・sill・x0。列は世界座標、段は箱の下端から = world.js _fullBox の V）。
    //   ガラスの塔は階ごとの大きな板。窓の大きさは glass.winW / winH（格子の割合）
    _winGrid(mat) {
      const C = this._wgC || (this._wgC = new Map());
      if (C.has(mat)) return C.get(mat);
      const r = this._winGrid0(mat);
      C.set(mat, r);
      return r;
    }
    _winGrid0(mat) {
      const G = this.glcfg, K = MR.CityKit && MR.CityKit.DEF && MR.CityKit.DEF.mats;
      const extra = G.mats || {};
      const m = extra[mat] || (K && K[mat]);
      if (!m) return null;
      const tower = mat === 'glass_tower';
      return { bay: m.bay || 3, storey: m.storey || 3.6, sill: tower ? 0.15 : (m.sill || 0.9), x0: m.x0 || 1.5,
        w: (m.bay || 3) * (tower ? 0.94 : (G.winW || 0.48)), h: (m.storey || 3.6) * (tower ? 0.92 : (G.winH || 0.44)) };
    }
    // 外壁の面（箱 b の 4 つの縦の面）ごとに、点 p から rr m 以内の窓を visit(cx, cy, cz, nx, nz, W, d)
    _eachWindow(b, p, rr, visit) {
      const W = this._winGrid(b.mat);
      if (!W) return;
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, y0 = b.y, y1 = b.y + b.h;
      const faces = [[x0, -1, 0], [x1, 1, 0], [z0, 0, -1], [z1, 0, 1]];
      for (const [pl, nx, nz] of faces) {
        const off = nx ? (p.x - pl) * nx : (p.z - pl) * nz; // 面の前の距離
        if (off < -0.4 || off > rr) continue;
        const u0 = nx ? z0 : x0, u1 = nx ? z1 : x1, pu = nx ? p.z : p.x;
        if (u1 - u0 < W.bay) continue;
        const ka = Math.ceil((Math.max(u0 + W.w / 2 + 0.2, pu - rr) - W.x0) / W.bay), kb = Math.floor((Math.min(u1 - W.w / 2 - 0.2, pu + rr) - W.x0) / W.bay);
        const ra = Math.max(0, Math.ceil((p.y - rr - y0 - W.sill - W.h / 2) / W.storey)), rb = Math.floor((Math.min(y1 - 0.4 - W.h, p.y + rr) - y0 - W.sill) / W.storey);
        for (let k = ka; k <= kb; k++) for (let r = ra; r <= rb; r++) {
          const u = W.x0 + k * W.bay, y = y0 + W.sill + r * W.storey + W.h / 2;
          if (y + W.h / 2 > y1 - 0.3) continue;
          const cx = nx ? pl : u, cz = nx ? u : pl;
          const d = Math.hypot(cx - p.x, y - p.y, cz - p.z);
          if (d <= rr) visit(cx, y, cz, nx, nz, W, d);
        }
      }
    }
    _breakWindow(cx, cy, cz, nx, nz, W, push, sound) {
      const k = Math.round(cx * 10) + '|' + Math.round(cy * 10) + '|' + Math.round(cz * 10);
      if (this.broken.has(k)) return false;
      const cap = this.windows ? this.windows.cap : 128;
      if (this.broken.size >= cap) this.broken.delete(this.broken.values().next().value); // 板は一番古い物から上書きされる
      this.broken.add(k);
      if (this.windows) this.windows.add({ x: cx, y: cy, z: cz }, { x: nx, y: 0, z: nz }, W.w * 0.98, W.h * 0.98, true);
      // 破片: 外へ飛ぶガラス（光る）+ 落ちる。数は窓の大きさで
      const G = this.glcfg, n = Math.max(2, Math.round((G.shards || 5) * W.w * W.h / 2.4));
      this._burst('glass', cx + nx * 0.15, cy, cz + nz * 0.15, n, nx * push, 1.5, nz * push);
      // きらめき（ember の小さな白い板が落ちる）
      const P = this.game._puffsObj ? this.game._puffsObj() : null;
      if (P && G.glints !== 0 && MR.BlastFX) {
        const o = this._glo || (this._glo = {});
        for (let i = 0, m = Math.min(4, G.glints || 3); i < m; i++) {
          MR.BlastFX._opt(o, nx * push * (0.4 + Math.random() * 0.6), 1 + Math.random() * 2, nz * push * (0.4 + Math.random() * 0.6), 0, -9, 0.4, 1, 1.3, 1.45, 1.6, 0);
          o.fadeIn = 0.01;
          P.spawn('ember', cx + (Math.random() - 0.5) * W.w, cy + (Math.random() - 0.5) * W.h, cz + (Math.random() - 0.5) * W.w, 0.08 + Math.random() * 0.1, 0.7 + Math.random() * 1.2, o);
        }
      }
      this.stats.windows = (this.stats.windows || 0) + 1;
      if (sound) this._sound('glass_break_' + (1 + Math.floor(Math.random() * 3)), this._v3(cx, cy, cz), 1);
      return true;
    }
    // 爆発: 半径（glass.radiusK × R、glass.maxRadius まで）の中の窓を近い順に、1 回 glass.maxPerBlast 枚まで。遠いほど割れにくい。
    //   ついでに一番近い外壁の上の縁（コーニス）が爆発の半径の中なら塊が落ちる（1 回 1 か所）
    _glassBlast(info, R, at) {
      const G = this.glcfg;
      if (G.enabled === false || !this.windows) return 0;
      const rr = Math.min(G.maxRadius || 44, R * (G.radiusK || 1.55)), nav = this.nav;
      if (!nav || typeof nav.itemsIn !== 'function') return 0;
      const items = nav.itemsIn(info.x - rr, info.z - rr, info.x + rr, info.z + rr, this._glItems || (this._glItems = []));
      const cand = [];
      let corn = null, cd = Infinity;
      for (const it of items) {
        const b = it.src || it.b;
        if (!b || b.cat !== 'exterior' || (b.f & 1) || b.dx) continue;
        if (b.y + b.h < info.y - rr || b.y > info.y + rr) continue;
        const ex = Math.max(0, Math.abs(info.x - b.x) - b.w / 2), ez = Math.max(0, Math.abs(info.z - b.z) - b.d / 2);
        if (ex * ex + ez * ez > rr * rr) continue;
        this._eachWindow(b, info, rr, (cx, cy, cz, nx, nz, W, d) => cand.push([d, cx, cy, cz, nx, nz, W]));
        // コーニス: 箱の上の縁が近い（外壁の面の前）
        const top = b.y + b.h;
        if (b.h > 6 && Math.abs(top - info.y) < R * 0.8) {
          const qx = Math.max(b.x - b.w / 2, Math.min(info.x, b.x + b.w / 2)), qz = Math.max(b.z - b.d / 2, Math.min(info.z, b.z + b.d / 2));
          const dd = Math.hypot(qx - info.x, top - info.y, qz - info.z);
          if (dd < cd && dd < R * 0.7) { cd = dd; corn = [qx, top, qz, b]; }
        }
      }
      items.length = 0;
      cand.sort((p, q) => p[0] - q[0]);
      // 近い glass.immediate 枚はこのフレーム、残りは衝撃の前が届く時刻（距離 / glass.waveSpeed 秒）に _glassPump が
      //   1 フレーム glass.perFrame 枚まで割る（爆発のフレームに 24 枚の破片・板・きらめきを全部出していた = 当たり 1 回 1.2 ms）
      let n = 0, snd = 0;
      const max = G.maxPerBlast || 48, dmg0 = at(0) || 1, now0 = this._glT || 0, imm = G.immediate == null ? 2 : G.immediate;
      const Q = this._glQ || (this._glQ = []), qMax = G.queueMax || 96;
      for (const c of cand) {
        if (n >= max) break;
        const k = 1 - c[0] / rr; // 近いほど必ず割れる
        if (Math.random() > Math.min(1, 0.25 + k * 1.5) * Math.min(1, dmg0 / (G.minDamage || 80))) continue;
        const push = (G.push || 6) * (0.5 + k);
        if (n < imm) { if (this._breakWindow(c[1], c[2], c[3], c[4], c[5], c[6], push, snd < 2)) { n++; snd++; } continue; }
        if (Q.length >= qMax) break;
        Q.push({ t: now0 + c[0] / (G.waveSpeed || 120), x: c[1], y: c[2], z: c[3], nx: c[4], nz: c[5], W: c[6], push, snd: snd++ < 2 });
        n++;
      }
      if (Q.length > 1) Q.sort((p, q) => p.t - q.t);
      if (corn && at(cd) >= (G.corniceDamage || 200)) this._cornice(corn[0], corn[1], corn[2], corn[3], info);
      return n;
    }
    // 待っている窓を割る（update から。dt 秒進める）。返り値 = 割った枚数
    _glassPump(dt) {
      this._glT = (this._glT || 0) + dt;
      this._gbDid = false;
      if (this._gbQ && this._gbQ.length) { // 待っている爆発の窓探し（1 フレームに 1 つ。そのフレームは隣の穴を開けない = _breachPump）
        this._gbDid = true;
        const J = this._gbQ.shift(), at = (d) => J.Dm * Math.max(0, 1 - d / J.R * J.edge);
        this._glassBlast(J, J.R, at);
      }
      const Q = this._glQ;
      if (!Q || !Q.length) return 0;
      let i = 0, n = 0;
      const per = this.glcfg.perFrame || 6;
      while (i < Q.length && Q[i].t <= this._glT && n < per) {
        const w = Q[i++];
        if (this._breakWindow(w.x, w.y, w.z, w.nx, w.nz, w.W, w.push, w.snd)) n++;
      }
      if (i) Q.splice(0, i);
      return n;
    }
    // 弾: 当たった点が窓の中なら 1 枚
    _glassShot(info) {
      const G = this.glcfg;
      if (G.enabled === false || G.bullets === false || !this.windows) return 0;
      const b = info.box;
      let hit = null;
      this._eachWindow(b, { x: info.x - (info.nx || 0) * 0.3, y: info.y, z: info.z - (info.nz || 0) * 0.3 }, 2.5, (cx, cy, cz, nx, nz, W) => {
        if (hit || Math.abs(cy - info.y) > W.h / 2 || Math.hypot(cx - info.x, cz - info.z) > W.w / 2 + 0.05) return;
        hit = [cx, cy, cz, nx, nz, W];
      });
      if (!hit) return 0;
      return this._breakWindow(hit[0], hit[1], hit[2], hit[3], hit[4], hit[5], 2, true) ? 1 : 0;
    }
    // コーニス・外壁の板が落ちる: 上の縁から塊と板が落ち、縁の下にむき出しのれんが
    _cornice(x, y, z, b, info) {
      const nx = Math.abs(x - (b.x - b.w / 2)) < 0.05 ? -1 : (Math.abs(x - (b.x + b.w / 2)) < 0.05 ? 1 : 0);
      const nz = nx ? 0 : (Math.abs(z - (b.z - b.d / 2)) < 0.05 ? -1 : (Math.abs(z - (b.z + b.d / 2)) < 0.05 ? 1 : 0));
      if (!nx && !nz) return;
      const G = this.glcfg;
      this._burst('dxSlab', x + nx * 0.3, y - 0.4, z + nz * 0.3, G.corniceSlabs || [2, 4], nx * 3, 0.5, nz * 3);
      this._burst('dxChunk', x + nx * 0.3, y - 0.4, z + nz * 0.3, G.corniceChunks || [4, 7], nx * 4, 1, nz * 4);
      if (this.exposed) this.exposed.add(this._v3(x, y - 0.7, z), { x: nx, y: 0, z: nz }, 1.6 * (0.8 + Math.random() * 0.4));
      this.stats.cornices = (this.stats.cornices || 0) + 1;
      if (this.game.blastFx) this.game.blastFx.wall(x + nx * 0.3, y - 0.6, z + nz * 0.3, nx, nz, 1.6, 'cornice');
    }

    // 点 (hx, hy, hz) の近くの入れる建物の外壁に穴（T2）。null = 穴にできる壁が無い（えぐれへ）、{ n } = 穴の数（0 = 扉・ダメージ不足・上限）
    _breachAt(info, hx, hy, hz, reach, at, main) {
      const C = this.cfg, BC = C.breach || {};
      const hit = this._tmp; hit.x = hx; hit.y = hy; hit.z = hz;
      let best = null, bd = Infinity;
      this._lastBreach = null;
      this._around(hx, hz, reach, (d) => {
        const ix = this._idx(d);
        if (!ix.shell.length || !Destruction._near(ix.sbb, hx, hz, reach + 0.5)) return;
        const near = this._shellNear(ix, hit.x, hit.y, hit.z, reach + 0.1);
        if (!near.length) return;
        const rec = D().planBreach(near, hit, { width: BC.width, height: BC.height, reach, wall: BC.wall, rubbleH: BC.rubbleH, minFace: BC.minFace });
        if (!rec) return;
        const dd = main ? Math.hypot(rec.ax === 'x' ? rec.x - hit.x : 0, rec.ax === 'z' ? rec.z - hit.z : 0) : Math.hypot(rec.x - info.x, rec.y + 1.2 - info.y, rec.z - info.z);
        if (dd < bd) { bd = dd; best = [d, rec]; }
      });
      // 自動ドア（doors.js）の開口にかかる穴は開けない（扉の板が穴の中に浮いて残る）: えぐれにする
      if (best && this._onDoor(best[1])) { best = null; this.stats.doorSkips = (this.stats.doorSkips || 0) + 1; if (!main) return { n: 0 }; }
      if (best && !main && this.reg.has(best[1].k)) return { n: 0 };
      if (best && at(bd) >= (BC.minDamage > 0 ? BC.minDamage : 120)) {
        const [d, rec] = best;
        // 見た目（破片・粉・えぐれ・音）はオンラインも
        const nx = rec.ax === 'x' ? rec.n : 0, nz = rec.ax === 'z' ? rec.n : 0;
        const cx = rec.ax === 'x' ? rec.x : rec.x, cz = rec.z, cy = rec.y + 1.2;
        this._burst('concrete', cx, cy, cz, BC.debris || [10, 16], nx * 7, 2, nz * 7);
        this._burst('concrete', cx, cy, cz, BC.debrisIn || [4, 7], -nx * 5, 1, -nz * 5);
        if (this.game.fx && typeof this.game.fx.smoke === 'function') this.game.fx.smoke(this._v3(cx + nx * 0.5, cy, cz + nz * 0.5), 2.5);
        // 焦げは穴の周りの残った外壁に（穴の真ん中に置くと宙に浮く）: 左・右・上
        //   左右は腰壁の高さ（窓の下 = いつも壁）に小さく、上は窓の上の壁（spandrel）に
        const ax = rec.ax, hw = ((ax === 'x' ? rec.R.z1 - rec.R.z0 : rec.R.x1 - rec.R.x0) / 2) + 0.35, sc = BC.scorch || 1.8;
        const tx = ax === 'x' ? 0 : 1, tz = ax === 'x' ? 1 : 0, wx = rec.x + nx * 0.16, wz = rec.z + nz * 0.16;
        for (const o of [[-hw, 0.5, 0.65], [hw, 0.5, 0.65], [0, rec.R.y1 - rec.y + 0.45, 1]]) this.decals.add(this._v3(wx + tx * o[0], rec.y + o[1], wz + tz * o[0]), { x: nx, y: 0, z: nz }, sc * o[2] * (0.85 + Math.random() * 0.3));
        this._sound('impact_concrete', this._v3(cx, cy, cz), 0.7);
        // destruct-3 M1: 粉の噴き出し・塊・崩れる音（BlastFX）と、穴の縁のむき出しのれんが（焦げと同じ左・右・上）
        const BF = this.game.blastFx;
        if (BF) BF.wall(cx + nx * 0.2, cy, cz + nz * 0.2, nx, nz, 2.2, 'breach', rec.mat);
        if (this.exposed) for (const o of [[-hw - 0.15, 1.2, 0.9], [hw + 0.15, 1.0, 0.8], [0.4, rec.R.y1 - rec.y + 0.25, 0.75]]) this.exposed.add(this._v3(wx + tx * o[0], rec.y + o[1], wz + tz * o[0]), { x: nx, y: 0, z: nz }, (BC.exposed || 1.3) * o[2] * (0.85 + Math.random() * 0.3));
        if (!this.solid) { this.stats.cosmetic++; this._lastBreach = rec; return { n: 1 }; }
        if (!this.reg.add(rec, d.key, this.game.time || 0, (v) => this._repairRec(v))) return { n: 0 };
        this.stats.breaches++;
        if (this.windows) this.windows.clearIn(rec.R, 0.1);
        // 部屋の中の火（destruct-3 M2）: ミサイル・爆弾の穴は奥の床が燃える（crashfx の地面の火 = ダメージあり・上限 caps.patches）
        const RF = this.glcfg.roomFire || {};
        if (RF.enabled !== false && (info.kind === 'missile' || info.kind === 'blast') && at(bd) >= (RF.minDamage || 300) && this.game.crashes && typeof this.game.crashes.addPatch === 'function') {
          const depth = RF.depth || 2.2, fx = rec.x - nx * depth, fz = rec.z - nz * depth;
          this.game.crashes.addPatch(fx, rec.y + rec.rubbleH, fz, RF.r0 || 0.7, RF.r1 || 1.6, 0.4, (RF.sec || 25) * (0.8 + Math.random() * 0.4), null, 'car', 0);
          this.stats.roomFires = (this.stats.roomFires || 0) + 1;
        }
        this._queueRubble(rec);
        this._changed(d.key, rec);
        this._repT = 0; // 次の update で穴の箱を遠景・家具の材質へ（_farCuts）
        this._lastBreach = rec;
        return { n: 1 };
      }
      return main ? null : { n: 0 };
    }
    // 隣の穴の待ち（爆発の中心・半径・ダメージだけ持つ。at は同じ式で作り直す）
    _queueExtra(info, R, rec, ex) {
      const Q = this._brQ || (this._brQ = []);
      if (Q.length >= 8) Q.shift();
      Q.push({ info: { x: info.x, y: info.y, z: info.z, kind: info.kind, mul: info.mul, damage: info.damage, radius: R, edge: info.edge }, R, rec, ex, wait: 1 });
    }
    // 1 フレームに隣の穴を breach.extraPerFrame 個まで（update から）。返り値 = 開けた穴の数
    _breachPump() {
      const Q = this._brQ;
      if (!Q || !Q.length) return 0;
      const J = Q[0];
      if (J.wait-- > 0) return 0;
      Q.shift();
      const I = J.info, Dm = I.damage || 0, edge = I.edge == null ? 0.6 : I.edge, R = J.R;
      const at = (d) => Dm * Math.max(0, 1 - d / R * edge);
      this._batch = new Map();
      let n = 0;
      try { n = this._extraBreaches(I, R, at, J.rec, J.ex); } finally {
        const B = this._batch; this._batch = null;
        if (B) for (const [owner, recs] of B) this._flush(owner, recs);
      }
      return n;
    }
    // 隣の穴: 最初の穴の面の上で、左右（穴の幅 + breach.extraGap）と上下の階（breach.storey）の点。近い順
    _extraBreaches(info, R, at, rec, ex) {
      const BC = this.cfg.breach || {}, W = (BC.width || 3) + (BC.extraGap || 0.6), H = BC.storey || 3.6;
      const tx = rec.ax === 'x' ? 0 : 1, tz = rec.ax === 'x' ? 1 : 0, nx = rec.ax === 'x' ? rec.n : 0, nz = rec.ax === 'z' ? rec.n : 0;
      const cands = [];
      for (const [a, b] of [[-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1], [0, 2], [-2, 1], [2, 1]]) {
        const x = rec.x + tx * a * W + nx * 0.25, z = rec.z + tz * a * W + nz * 0.25, y = rec.y + 1.2 + b * H;
        if (y < rec.y - 0.5 && b < 0 && y < 0.5) continue;
        const d = Math.hypot(x - info.x, y - info.y, z - info.z);
        if (d > R) continue;
        cands.push([d, x, y, z]);
      }
      cands.sort((p, q) => p[0] - q[0]);
      let n = 0, tried = 0, more = false;
      const first = rec, per = (this.cfg.breach && this.cfg.breach.extraPerFrame) || 2, done = this._brDone || (this._brDone = new Set());
      for (const c of cands) {
        if (n >= ex) break;
        const ck = Math.round(c[1] * 4) + '|' + Math.round(c[2] * 4) + '|' + Math.round(c[3] * 4);
        if (done.has(ck)) continue;
        if (n >= per || tried >= per * 3) { more = true; break; }
        tried++; done.add(ck);
        const r = this._breachAt(info, c[1], c[2], c[3], 1.2, at, false);
        if (r && r.n) n += r.n;
      }
      if (done.size > 512) done.clear();
      if (more && n < ex) (this._brQ || (this._brQ = [])).unshift({ info, R, rec: first, ex: ex - n, wait: 0 }); // 残りは次のフレーム
      this._lastBreach = first;
      this.stats.extraBreaches = (this.stats.extraBreaches || 0) + n;
      return n;
    }
    // 壁: 入れる建物の外壁 → 穴（T2）、入れない建物・地面・高架 → えぐれ（見た目だけ）
    _wall(info, R, at) {
      const C = this.cfg, BC = C.breach || {};
      const reach = Math.min(BC.reach > 0 ? BC.reach : 2.5, R * 0.5);
      if (info.kind !== 'gun') {
        const r = this._breachAt(info, info.x, info.y, info.z, reach, at, true);
        if (r) {
          // 大きな爆発（info.mul = 壊す倍率 destruct.scale.struct / blasts.<id>.structMul）: 隣の穴を足す（同じ階の左右・上下の階。
          //   1 つの大きな箱にしない = 階の床は残る）。数は round(mul) − 1、breach.maxExtra まで、爆発の半径の中でダメージが minDamage 以上の所だけ
          //   隣の穴は次のフレームから 1 フレーム breach.extraPerFrame 個（_breachPump。当たりのフレームに 6 つの穴の当たり判定・近景を全部作ると 12〜15 ms）
          const ex = Math.min(BC.maxExtra >= 0 ? BC.maxExtra : 6, Math.round(info.mul || 1) - 1);
          if (ex > 0 && this._lastBreach) this._queueExtra(info, R, this._lastBreach, ex);
          return r.n;
        }
      }
      // えぐれ（地面か壁の近くで、ダメージが crater.minDamage 以上）
      const CC = C.crater || {};
      if (at(0) >= (CC.minDamage > 0 ? CC.minDamage : 60)) {
        let n = info.nx != null ? { x: info.nx, y: info.ny, z: info.nz } : null, gy = info.y;
        if (!n) { // 一番近い面（下・横 4 方向）をレイで
          const nav = this.nav;
          let bt = 3, bn = { x: 0, y: 1, z: 0 }, by = info.y;
          for (const dd of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
            const h = nav.raycast(info.x, info.y + 0.05, info.z, dd[0], dd[1], dd[2], bt);
            if (h && h.t < bt) { bt = h.t; bn = { x: h.nx, y: h.ny, z: h.nz }; by = h.y; }
          }
          if (bt >= 3 && info.y > 1.5) return 0; // 空中
          n = bn; gy = by;
        }
        const s = (info.kind === 'gun' ? (CC.gunSize || 0.9) : (CC.size || 3.4) * Math.min(CC.maxScale || 2.5, Math.sqrt(info.mul || 1))) * (0.8 + Math.random() * 0.4);
        // 上を向いた面（地面・屋上）の焦げは jets の E3 の焦げ（MR.Crashes の InstancedMesh。fire.scorch.sec で消える）へ。壁のえぐれはこちらの decals
        const cr = this.game.crashes;
        //   乗り物の爆発・墜落（kind 'vehicle'）は crashfx の plan がもう焦げを置いているので二重にしない
        if (n.y > 0.7 && cr && typeof cr.addScorch === 'function') {
          if (info.kind !== 'vehicle') { cr.addScorch(info.x, gy, info.z, s * 0.5); this.stats.scorchE3 = (this.stats.scorchE3 || 0) + 1; }
        } else { this.decals.add(info, n, s); if (this.game.blastFx && info.kind !== 'gun' && Math.abs(n.y) < 0.5) this.game.blastFx.wall(info.x, info.y, info.z, n.x, n.z, s * 0.6, info.kind); } // 壁のえぐれ: 粉・塊・むき出しのれんが（destruct-3 M1）
        this.stats.craters++;
        if (info.kind !== 'gun') this._burst(CC.kit || 'rubble', info.x, info.y + 0.2, info.z, CC.debris || [3, 6], n.x * 4, 3, n.z * 4);
        return 0;
      }
      return 0;
    }
    _v3(x, y, z) { const v = this._vv || (this._vv = new THREE.Vector3()); return v.set(x, y, z); }

    _tankFall(p, rule) {
      // 胴が足元へ落ちる見た目（給水塔の形を借りて、脚の高さぶん落ちながらつぶれて傾く。tankFall 秒で消え、つぶれた残骸は _applyRec の
      //   形 = 'dx' の箱）+ 板の破片と粉
      const K = this.world.props && this.world.props.kinds && this.world.props.kinds.water_tank;
      if (K && K.parts && typeof THREE !== 'undefined' && this.anims.length < 4) {
        const grp = new THREE.Group();
        grp.name = 'dxTankFall';
        for (const part of K.parts) { const m = new THREE.Mesh(part.geo, part.mat); m.castShadow = false; m.receiveShadow = false; grp.add(m); }
        grp.position.set(p.x, p.y, p.z); grp.rotation.y = p.rot || 0;
        this.game.scene.add(grp);
        const s = Math.random() < 0.5 ? -1 : 1;
        this.anims.push({ grp, t: 0, dur: rule.fallSec > 0 ? rule.fallSec : 1.1, y0: p.y, drop: rule.drop > 0 ? rule.drop : 2.84, tilt: s * (0.18 + Math.random() * 0.16), crush: rule.wreckH > 0 ? rule.wreckH : 0.9 });
      }
      this._burst('wood', p.x, p.y + 4.5, p.z, rule.n || [10, 14], 0, 1, 0);
      if (this.game.fx && typeof this.game.fx.smoke === 'function') this.game.fx.smoke(this._v3(p.x, p.y + 1.5, p.z), 3);
      this._sound('impact_concrete', this._v3(p.x, p.y + 2, p.z), 0.6);
    }

    // 記録が変わった: 当たりの途中なら最後にまとめて（持ち主ごとに 1 回）、ほかはすぐ
    _changed(owner, rec) {
      if (this._batch) { const L = this._batch.get(owner); if (L) L.push(rec); else this._batch.set(owner, [rec]); }
      else this._flush(owner, [rec]);
    }
    // 当たり判定と近景を直す（_sync）のは次の update から 1 フレームに 1 つの持ち主（destruct-3 M4: 爆発のフレームに穴・倒壊の当たり判定まで
    //   作ると端末で 1 フレームが 50 ms を超えた。穴が見えるのは 1 フレーム後 = 火の玉の後ろ）。deferSync: false（テストの前の場面）は今すぐ
    _flush(owner, recs) {
      if (this.deferSync === false) { this._sync(owner, recs); return; }
      const Q = this._sq || (this._sq = new Map());
      const L = Q.get(owner);
      if (L) { for (const r of recs) if (L.indexOf(r) < 0) L.push(r); } else Q.set(owner, recs.slice());
    }
    // 待っている _sync を全部（テスト・続きから）
    flushSync() { const Q = this._sq; if (!Q) return; this._sq = null; for (const [o, L] of Q) this._sync(o, L); }
    // 持ち主のチャンクの当たり判定を今の記録に合わせる（読み込んであるときだけ。ほかは読むときに _filter）: 入っている効き目（applied）と
    //   今の記録をまとめた効き目（deriveAll）の差だけ外す・足す（同じ壁の 2 つの穴・1 つだけ直す も正しい）。歩行グラフは変わった記録
    //   （changed）の所だけ作り直す。近景の形は待ち行列へ
    _sync(owner, changed) {
      const nav = this.nav, t0 = now();
      if (nav && nav.dxApply && nav.hasChunk(owner) && this.solid) {
        const d = this._owner(owner);
        const L = this.reg.list(owner) || [];
        const want = L.length ? D().deriveAll(d, L) : Destruction.EMPTY;
        const cur = this.applied.get(owner) || Destruction.EMPTY;
        if (want !== cur) {
          const gk = (b) => b.x + ',' + (b.y || 0) + ',' + b.z + ',' + b.w + ',' + b.h + ',' + b.d;
          const curAdd = new Map(), wantAdd = new Map();
          for (const b of cur.add) curAdd.set(gk(b), b);
          for (const b of want.add) wantAdd.set(gk(b), b);
          const rm = new Set(), ad = [], lrm = new Set(), lad = [];
          // 形で比べる（キャッシュから外れて作り直したデータは別の物）
          const curRm = new Set(), wantRm = new Set(), lk = (l) => l.x + ',' + l.z + ',' + l.y0 + ',' + l.y1, curL = new Set(), wantL = new Set();
          for (const b of cur.remove) curRm.add(gk(b));
          for (const b of want.remove) wantRm.add(gk(b));
          for (const l of cur.ladders) curL.add(lk(l));
          for (const l of want.ladders) wantL.add(lk(l));
          for (const b of want.remove) if (!curRm.has(gk(b))) rm.add(b);
          for (const [k, b] of curAdd) if (!wantAdd.has(k)) rm.add(b);
          for (const [k, b] of wantAdd) if (!curAdd.has(k)) ad.push(b);
          for (const b of cur.remove) if (!wantRm.has(gk(b))) ad.push(b);
          for (const l of want.ladders) if (!curL.has(lk(l))) lrm.add(l);
          for (const l of cur.ladders) if (!wantL.has(lk(l))) lad.push(l);
          // スロープ（倒壊）: 外すだけ。前に外したのに今は要らない（rollback）ならチャンクを読み直す（filter が今の記録で外す）
          const rpk = (q) => q.x + ',' + q.z + ',' + q.y0 + ',' + q.y1 + ',' + q.w + ',' + q.d, curRp = new Set(), wantRp = new Set();
          if (cur.ramps) for (const q of cur.ramps) curRp.add(rpk(q));
          if (want.ramps) for (const q of want.ramps) wantRp.add(rpk(q));
          let rprm = null, rpBack = false;
          if (want.ramps) for (const q of want.ramps) if (!curRp.has(rpk(q))) (rprm || (rprm = new Set())).add(q);
          for (const k of curRp) if (!wantRp.has(k)) rpBack = true;
          if (rpBack && typeof nav.removeChunk === 'function') { nav.removeChunk(owner); this.applied.delete(owner); if (this.world) this.world._navSig = null; this.stats.navReloads = (this.stats.navReloads || 0) + 1; }
          // 変わった所: 変わった記録の矩形（壁の穴の R・小物の周り）
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (const r of changed || []) {
            const R = r.type === 'breach' ? r.R : (r.type === 'collapse' ? { x0: r.R.x0 - 0.6, z0: r.R.z0 - 0.6, x1: r.R.x1 + 0.6, z1: r.R.z1 + 0.6 } : { x0: r.x - (r.r || 1) - 0.3, z0: r.z - (r.r || 1) - 0.3, x1: r.x + (r.r || 1) + 0.3, z1: r.z + (r.r || 1) + 0.3 });
            if (R.x0 < x0) x0 = R.x0; if (R.z0 < z0) z0 = R.z0; if (R.x1 > x1) x1 = R.x1; if (R.z1 > z1) z1 = R.z1;
            // がれきの山（穴の前後・給水塔の周り）も
            for (const b of D().rubbleBoxes(r, this.rcfg)) { const hw = b.w / 2, hd = b.d / 2; if (b.x - hw < x0) x0 = b.x - hw; if (b.z - hd < z0) z0 = b.z - hd; if (b.x + hw > x1) x1 = b.x + hw; if (b.z + hd > z1) z1 = b.z + hd; }
          }
          const region = x1 >= x0 ? { x0, z0, x1, z1 } : null;
          const r = rpBack ? null : ((rm.size || ad.length || lrm.size || lad.length || rprm) ? nav.dxApply(owner, rm, ad, region, lrm, lad, rprm) : null);
          // 外した梯子に掴まっているプレイヤーは手を放す（落ちる。nav の記録はもう無い）
          const P = this.game.player;
          if (lrm.size && P && P.ladder && typeof P._releaseLadder === 'function') {
            const l = P.ladder.src || P.ladder;
            for (const q of lrm) if (lk(q) === lk(l)) { P._releaseLadder(0, P._c3 ? P._c3() : { coyoteTime: 0.1 }); break; }
          }
          // 登っている途中の敵も手を放す（落ちて、経路を引き直す）
          if (lrm.size) for (const e of this.game.enemies) {
            if (e.dead || !e.climb || !e.climb.l) continue;
            const l = e.climb.l.src || e.climb.l;
            for (const q of lrm) if (lk(q) === lk(l)) { Destruction.releaseClimb(e); this.stats.enemyLadders = (this.stats.enemyLadders || 0) + 1; break; }
          }
          if (rpBack) { /* 読み直し: applied は次に addChunk（dxFilter）してから */ } else if (want === Destruction.EMPTY) this.applied.delete(owner); else this.applied.set(owner, want);
          if (r) {
            const inf = (nav.inflate || 0.45) + 1;
            this.jobs.push(nav.dxRegraph(r.x0 - inf, r.z0 - inf, r.x1 + inf, r.z1 + inf));
          }
        }
      }
      const ms = now() - t0;
      this.stats.navMs = ms; if (ms > this.stats.navMsMax) this.stats.navMsMax = ms;
      this._syncF = this._fN | 0; // このフレームは近景の形を直さない（update の _patchMesh を次のフレームへ = 重いものを 1 フレームに重ねない）
      const S = this.world.streamer, fr = S && S.full.get(owner);
      if (fr && fr.out && !this.meshQueue.includes(owner)) this.meshQueue.push(owner);
    }

    // 直す（上限・時間）: 記録はもう消えている。読み込んであれば当たり判定と形を今の記録に合わせる
    _repairRec(rec) {
      this.stats.repaired++;
      if (rec.type === 'collapse') this._uncollapse(rec);
      if (rec.gun) this.dead.delete(rec.ax + '|' + Math.round((rec.ax === 'x' ? rec.x : rec.z) * 100)); // 上限で外した銃の穴: 壊れた升も忘れる
      if ((rec.type === 'prop' || rec.type === 'tank') && this.world.props) this.world.props.markDirty();
      this._changed(rec.owner, rec); // 当たりの途中（上限で追い出した）なら最後にまとめて（新しい記録の歩行グラフの範囲も入る）
    }

    // 近景のチャンクが出来た（作り直しも）: 記録があればすぐ形を直す（まだ描いていない = 上げる回数は増えない。1 フレーム出来たままの
    //   壁が見えない）
    _onFullBuilt(rec, out) {
      const L = this.reg.list(rec.key);
      if (L && L.length) this._patchMesh(rec.key, true);
    }

    // チャンク 1 つの形を今の記録に合わせる: まとめた効き目の外した箱の面の三角形を縮め（インデックスを (a, a, a)）、給水塔の梯子の
    //   形も縮め、残りの箱・がれき・縁を 'dx' の形に。直した記録があれば（縮めた箱が外す物でなくなった）縮めたのを全部戻してからやり直す
    _patchMesh(key, now0) {
      const S = this.world.streamer, fr = S && S.full.get(key);
      if (!fr || !fr.out) return;
      const out = fr.out, d = this._owner(key);
      if (!d) return;
      // 前のフレームで後回しにした 'dx' の形（残りの壁・がれき・縁）だけ作る
      if (out.dxPend && !now0) { const t1 = now(); this._dxGroup(out, out.dxPend); out.dxAddFor = out.dxPend; out.dxPend = null; this.stats.meshMs = now() - t1; return; }
      const t0 = now();
      const L = this.reg.list(key) || [];
      const want = L.length ? D().deriveAll(d, L) : Destruction.EMPTY;
      if (out.dxState === want) return;
      const prev = out.dxState || Destruction.EMPTY;
      const gk = (b) => b.x + ',' + (b.y || 0) + ',' + b.z + ',' + b.w + ',' + b.h + ',' + b.d, lk = (l) => l.x + ',' + l.z + ',' + l.y0 + ',' + l.y1;
      const wR = new Set(), wL = new Set();
      for (const b of want.remove) wR.add(gk(b));
      for (const l of want.ladders) wL.add(lk(l));
      let restart = false;
      for (const b of prev.remove) if (!wR.has(gk(b))) { restart = true; break; }
      if (!restart) for (const l of prev.ladders) if (!wL.has(lk(l))) { restart = true; break; }
      if (restart) this._unpatch(out);
      const base = restart ? Destruction.EMPTY : prev, bR = new Set(), bL = new Set();
      for (const b of base.remove) bR.add(gk(b));
      for (const l of base.ladders) bL.add(lk(l));
      const rm = [];
      for (const b of want.remove) if (!bR.has(gk(b))) rm.push(b);
      // 三角形の索引はメッシュごとに最初の 1 回だけ作る（数万の三角形をなめる）: 作っていないメッシュが 2 つ以上あれば、このフレームは 1 つだけ作って
      //   次のフレームへ（待ち行列の先頭に戻す）。作り直した近景（onFullBuilt）は描く前なので全部ここで
      if (rm.length && !now0) {
        const miss = this._meshesFor(out, rm).filter((m) => !m.geometry.userData.dxIdx);
        if (miss.length) { // 索引の無いメッシュがあれば、このフレームは triIndexMs ms だけ作って次へ（全部できたら縮める）
          if (restart) out.dxState = null;
          this._triIndex(miss[0].geometry, this.cfg.triIndexMs || 3);
          if (!this.meshQueue.includes(key)) this.meshQueue.unshift(key);
          return;
        }
      }
      // 倒れた区画（destruct-3 M3）: 外す範囲 C の中の箱は 1 回なめて縮める（_collapseRegion）。C の縁にかかる箱は今まで通り箱ごと
      const CR = L.filter((r) => r.type === 'collapse');
      let rmB = rm;
      if (CR.length && rm.length) {
        const inC = (b) => { const B = D().box(b); for (const r of CR) { const C = r.C; if (B.x0 >= C.x0 - 0.25 && B.x1 <= C.x1 + 0.25 && B.z0 >= C.z0 - 0.25 && B.z1 <= C.z1 + 0.25 && B.y1 > C.y0) return true; } return false; };
        rmB = rm.filter((b) => !inC(b));
        const newC = CR.filter((r) => !(out.dxColl && out.dxColl.has(r.k + '#' + r.stage)));
        if (newC.length) { this.stats.tris += this._collapseRegion(out, newC); out.dxColl = out.dxColl || new Set(); for (const r of newC) out.dxColl.add(r.k + '#' + r.stage); }
      }
      if (rmB.length) this.stats.tris += this._collapse(out, rmB);
      for (const l of want.ladders) if (!bL.has(lk(l))) this.stats.tris += this._collapseLadder(out, l);
      // スロープは倒れた区画の 1 回のなめ（_collapseRegion）が縮める
      // 'dx' の形は作った元を覚えて比べる（dxState とは別）。三角形を縮めるのに patchSplitMs ms 以上かかったら次のフレームへ（1 フレームに重ねない）
      if (want.add !== out.dxAddFor) {
        if (!now0 && now() - t0 > (this.cfg.patchSplitMs || 3)) { out.dxPend = want.add; if (!this.meshQueue.includes(key)) this.meshQueue.unshift(key); }
        else { this._dxGroup(out, want.add); out.dxAddFor = want.add; out.dxPend = null; }
      }
      out.dxState = want;
      const ms = now() - t0;
      this.stats.meshMs = ms; if (ms > this.stats.meshMsMax) this.stats.meshMsMax = ms;
    }

    // 外した箱 list の面の三角形（3 つの頂点がその箱の同じ面の上・法線が外向き）を縮める。縮めた数。見るのは箱が描かれるメッシュだけ
    //   （_fullBox の材質の選び方: 外壁・上面の mt・下面の天井）
    // 外した箱 list が描かれるメッシュ（_fullBox の材質の選び方: 外壁・上面の mt・下面の天井）で、箱にかかるもの
    _meshesFor(out, list) {
      const eps = 0.004, W = this.world, names = new Set();
      for (const b of list) {
        if (b.cat === 'prop' && !b.mt && !b.lm) continue; // 近景が描かない小物の箱（CityProps の見た目）
        let mat = b.mat;
        if (typeof W.boxWallMat === 'function') mat = W.boxWallMat(b); // 外壁の材質（MR.Facade）へ行く箱は 'cityFacade'
        else {
          const shell = (b.f & 16) !== 0;
          if ((mat === 'limestone' || mat === 'concrete') && !shell && ((b.cat === 'exterior') || (b.cat === 'landmark' && b.h >= 12 && Math.min(b.w, b.d) >= 6))) mat = mat === 'limestone' ? 'limestone_win' : 'concrete_win';
          if (W.materials && W.materials.has && !W.materials.has(mat)) mat = 'concrete';
        }
        const grp = b.cat === 'interior' ? 'int' : 'ext';
        names.add(mat + '@' + grp);
        if (b.mt) names.add(b.mt + '@' + grp);
        names.add('plaster_interior@ext');
      }
      const meshes = [], boxes = list.map((b) => D().box(b));
      out.root.traverse((o) => {
        if (!o.isMesh || !names.has(o.name) || !o.geometry || !o.geometry.index || (o.userData && o.userData.dx)) return;
        const bb = o.geometry.boundingBox;
        if (bb) for (const B of boxes) if (B.x1 >= bb.min.x - eps && B.x0 <= bb.max.x + eps && B.z1 >= bb.min.z - eps && B.z0 <= bb.max.z + eps && B.y1 >= bb.min.y - eps && B.y0 <= bb.max.y + eps) { meshes.push(o); return; }
      });
      return meshes;
    }
    _collapse(out, list) {
      let n = 0;
      const eps = 0.004;
      const meshes = this._meshesFor(out, list), boxes = list.map((b) => D().box(b));
      for (const m of meshes) {
        const geo = m.geometry;
        const idx = this._triIndex(geo);
        const ia = geo.index.array, pa = geo.attributes.position.array;
        const undo = geo.userData.dxUndo || (geo.userData.dxUndo = []);
        let hit = false;
        for (const B of boxes) {
          for (let ax = 0; ax < 3; ax++) for (let sg = 0; sg < 2; sg++) {
            const pv = Destruction.q(ax === 0 ? (sg ? B.x1 : B.x0) : ax === 1 ? (sg ? B.y1 : B.y0) : (sg ? B.z1 : B.z0));
            const list2 = idx.get((ax * 2 + sg) * 16777216 + Math.round(pv * 64) + 8388608);
            if (!list2) continue;
            for (let q = 0; q < list2.length; q++) {
              const t = list2[q];
              const a = ia[t], b = ia[t + 1], c = ia[t + 2];
              if (a === b && b === c) continue;
              let ok = true;
              for (let vv = 0; vv < 3; vv++) {
                const v = vv === 0 ? a : vv === 1 ? b : c;
                const x = pa[v * 3], y = pa[v * 3 + 1], z = pa[v * 3 + 2];
                if (x < B.x0 - eps || x > B.x1 + eps || y < B.y0 - eps || y > B.y1 + eps || z < B.z0 - eps || z > B.z1 + eps) { ok = false; break; }
                const c0 = ax === 0 ? x : ax === 1 ? y : z;
                if (Math.abs(c0 - pv) > eps) { ok = false; break; }
              }
              if (!ok) continue;
              undo.push(t, a, b, c);
              ia[t + 1] = a; ia[t + 2] = a;
              n++; hit = true;
            }
          }
        }
        if (hit) { geo.index.needsUpdate = true; this.stats.uploads++; }
      }
      return n;
    }
    // 梯子（world._ladder の形 = metalDark@ext の、壁から 0.15 m の所の ± 0.3 m の柱）の三角形を全部縮める。縮めた数
    _collapseLadder(out, l) {
      let n = 0;
      const ox = l.x + l.nx * 0.15, oz = l.z + l.nz * 0.15, e = 0.32, x0 = ox - e, x1 = ox + e, z0 = oz - e, z1 = oz + e, y0 = l.y0 - 0.02, y1 = l.y1 + 0.02;
      out.root.traverse((o) => {
        if (!o.isMesh || o.name !== 'metalDark@ext' || !o.geometry.index) return;
        const geo = o.geometry, ia = geo.index.array, pa = geo.attributes.position.array, segs = geo.userData.segs, end = segs && segs.length ? segs[0][3] : ia.length;
        const undo = geo.userData.dxUndo || (geo.userData.dxUndo = []);
        let hit = false;
        for (let t = 0; t + 2 < end; t += 3) {
          const a = ia[t], b = ia[t + 1], c = ia[t + 2];
          if (a === b && b === c) continue;
          let ok = true;
          for (let vv = 0; vv < 3 && ok; vv++) {
            const v = vv === 0 ? a : vv === 1 ? b : c, x = pa[v * 3], y = pa[v * 3 + 1], z = pa[v * 3 + 2];
            if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) ok = false;
          }
          if (!ok) continue;
          undo.push(t, a, b, c); ia[t + 1] = a; ia[t + 2] = a; n++; hit = true;
        }
        if (hit) { geo.index.needsUpdate = true; this.stats.uploads++; }
      });
      return n;
    }
    // 三角形の索引（向きの軸と符号・面の座標 1/64 m）→ 三角形の先頭の位置。ランドマークの部品（segs）の前だけ = cutSegments が並べ替えない所
    // 三角形の索引。budget（ms）を渡すと途中まで作って null（geo.userData.dxIdxJob に続き = 端末で 1 回 20 ms 超を何フレームかに分ける）
    _triIndex(geo, budget) {
      if (geo.userData.dxIdx) return geo.userData.dxIdx;
      const ia = geo.index.array, pa = geo.attributes.position.array, na = geo.attributes.normal ? geo.attributes.normal.array : null;
      const segs = geo.userData.segs, end = segs && segs.length ? segs[0][3] : ia.length;
      const J = geo.userData.dxIdxJob || (geo.userData.dxIdxJob = { m: new Map(), t: 0 });
      const m = J.m, tEnd = budget > 0 ? now() + budget : Infinity;
      let t = J.t;
      for (; t + 2 < end; t += 3) {
        if ((t & 4095) === 0 && t > J.t && now() > tEnd) { J.t = t; return null; }
        const a = ia[t];
        let ax, sg;
        if (na) {
          const x = na[a * 3], y = na[a * 3 + 1], z = na[a * 3 + 2], X = Math.abs(x), Y = Math.abs(y), Z = Math.abs(z);
          if (X >= Y && X >= Z) { ax = 0; sg = x > 0 ? 1 : 0; } else if (Y >= Z) { ax = 1; sg = y > 0 ? 1 : 0; } else { ax = 2; sg = z > 0 ? 1 : 0; }
        } else continue;
        const pv = pa[a * 3 + ax];
        const k = (ax * 2 + sg) * 16777216 + Math.round(pv * 64) + 8388608; // 数の鍵（文字列を作らない）
        let l = m.get(k);
        if (!l) { l = []; m.set(k, l); }
        l.push(t);
      }
      geo.userData.dxIdx = m; geo.userData.dxIdxJob = null;
      return m;
    }
    _unpatch(out) {
      out.dxColl = null;
      out.root.traverse((o) => {
        const g = o.isMesh && o.geometry;
        const u = g && g.userData.dxUndo;
        if (!u || !u.length) return;
        const ia = g.index.array;
        for (let i = u.length - 4; i >= 0; i -= 4) { ia[u[i]] = u[i + 1]; ia[u[i] + 1] = u[i + 2]; ia[u[i] + 2] = u[i + 3]; }
        u.length = 0;
        g.index.needsUpdate = true;
      });
      out.dxState = null;
    }
    // 残りの箱とがれきの形（world._fullBox で近景と同じ材質・UV）。チャンクの root の子 'dx'。前の物は捨てる
    _dxGroup(out, add) {
      const W = this.world;
      if (out.dxGroup) {
        if (out.dxGroup.parent) out.dxGroup.parent.remove(out.dxGroup);
        for (const m of out.dxGroup.children) { const i = out.geos.indexOf(m.geometry); if (i >= 0) out.geos.splice(i, 1); W._release(m.geometry); }
        out.dxGroup = null;
      }
      if (!add.length || add.every((b) => b.dx === 5 && !b.coll)) return;
      const bufs = new Map();
      const B = (mat, grp, opts) => { // opts: 外壁の材質の頂点属性（world.js CityWorld.FACADE_OPTS）
        const k = mat + '|' + grp;
        let g = bufs.get(k);
        if (!g) { g = new MR.CityGeo(Object.assign({ vcap: 256 }, opts && opts.attrs ? { attrs: opts.attrs } : null, { q: true })); g.mat = mat; g.grp = grp; bufs.set(k, g); }
        return g;
      };
      for (const b of add) {
        if (b.dx === 5 && !b.coll) continue; // がれきの山は MR.DestructRubble が描く（倒れた建物の山 = coll は箱で描く）
        W._fullBox(b, B);
      }
      const grp = new THREE.Group();
      grp.name = 'dx'; grp.matrixAutoUpdate = false; grp.userData.dx = true;
      for (const g of bufs.values()) {
        if (g.empty) continue;
        const mat = g.mat === 'cityFacade' ? W.facadeMat : W.mat(g.mat);
        if (!mat) continue;
        const geo = W._track(g.toGeometry());
        out.geos.push(geo);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'dx:' + g.mat + '@' + g.grp; mesh.matrixAutoUpdate = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.dx = true;
        grp.add(mesh);
      }
      out.root.add(grp);
      grp.updateMatrixWorld(true);
      out.dxGroup = grp;
    }

    // ---------- 銃で壁が壊れる（R3）----------
    //   ダメージ = 弾のダメージ × gun.mul[武器]（無ければ mulDefault。散弾は粒ごと）。外壁の面の 1 m（gun.cell）の升ごとに cellHp。
    //   体力が減るたびにひびの板が大きくなる（crack: 段ごとの大きさ）。0 で升が壊れ、面の壊れた升のつながりの外接矩形（幅 breach.width・
    //   高さ breach.height まで）の穴にする（床から snapFloor m 以内なら床まで）。同じ面の決め直しは replanSec 秒に 1 回（それまで待つ）。
    //   中に入った小さな穴は大きな穴に置き換える。升は直らない（上限 gun.cells、プレイヤーから遠い物から忘れる）。オンラインはひびの板だけ
    _gunMul(id) {
      const G = this.gcfg, M = G.mul || {};
      const m = id != null && M[id] != null ? M[id] : (G.mulDefault != null ? G.mulDefault : 0);
      return m > 0 ? m : 0;
    }
    _gunHit(info) {
      const G = this.gcfg, BC = this.cfg.breach || {};
      if (G.enabled === false) return 0;
      const m = this._gunMul(info.weapon);
      if (!(m > 0)) return 0;
      const b = info.box, wt = BC.wall > 0 ? BC.wall : 0.3;
      const nrm = { x: info.nx || 0, y: info.ny || 0, z: info.nz || 0 };
      const F = D().F, shell = !!(b.f & F.SHELL) && b.cat === 'exterior' && !b.lm && (!b.dx || b.dx === 1); // 穴の横の残りの壁（dx 1）も
      let ax = null;
      if (shell) {
        const tx = Math.abs(b.w - wt) < 0.03, tz = Math.abs(b.d - wt) < 0.03;
        ax = tx && !tz ? 'x' : tz && !tx ? 'z' : tx && tz ? (Math.abs(nrm.x) > Math.abs(nrm.z) ? 'x' : 'z') : null;
      }
      if (!ax || !this.solid) { // ひびの板だけ（入れない建物・床・オンライン）: 3 発に 1 枚
        if ((this._chips++ % 3) === 0 && Math.abs(nrm.y) < 0.9) this._chipRing().add(info, nrm, (G.chipSize || 0.35) * (0.8 + Math.random() * 0.4));
        return 0;
      }
      const cs = G.cell > 0 ? G.cell : 1, hp0 = G.cellHp > 0 ? G.cellHp : 300;
      const plane = ax === 'x' ? b.x : b.z, u = ax === 'x' ? info.z : info.x;
      const cu = Math.floor(u / cs), cv = Math.floor(info.y / cs);
      const pk = ax + '|' + Math.round(plane * 100), ck = pk + '|' + cu + '|' + cv;
      let c = this.cells.get(ck);
      if (!c) {
        const side = (ax === 'x' ? nrm.x : nrm.z) >= 0 ? 1 : -1, off = (ax === 'x' ? b.w : b.d) / 2 + 0.01;
        const uc = (cu + 0.5) * cs, yc = (cv + 0.5) * cs;
        c = { hp: hp0, st: 0, x: ax === 'x' ? plane + side * off : uc, y: yc, z: ax === 'x' ? uc : plane + side * off, nx: ax === 'x' ? side : 0, nz: ax === 'z' ? side : 0 };
        this.cells.set(ck, c);
        if (this.cells.size > (G.cells > 0 ? G.cells : 2048)) this._forgetCell();
      }
      c.hp -= (info.damage || 0) * m;
      // ひび: 体力の 1/4 ごとに 1 段大きく（升の真ん中・撃った側の面）
      const st = Math.min(3, Math.floor((1 - Math.max(0, c.hp) / hp0) * 4));
      if (st > c.st) {
        const CR = G.crack || [0.35, 0.6, 0.85];
        c.st = st;
        this._chipRing().add(this._v3(c.x, c.y, c.z), { x: c.nx, y: 0, z: c.nz }, CR[Math.min(CR.length - 1, st - 1)] * cs);
        this.stats.cracks = (this.stats.cracks || 0) + 1;
      }
      if (Math.random() < (G.chipDebris != null ? G.chipDebris : 0.35)) this._burst(BC.kit || 'concrete', info.x, info.y, info.z, 1, (info.nx || 0) * 3, 1.5, (info.nz || 0) * 3);
      if (c.hp > 0) return 0;
      // 升が壊れた
      this.cells.delete(ck);
      let S = this.dead.get(pk);
      if (!S) { S = new Set(); this.dead.set(pk, S); }
      S.add(cu + '|' + cv);
      if (S.size > 256) S.delete(S.values().next().value);
      if (this.dead.size > 1024) this.dead.delete(this.dead.keys().next().value);
      this.stats.cells = (this.stats.cells || 0) + 1;
      this._burst(BC.kit || 'concrete', c.x, c.y, c.z, [3, 5], c.nx * 4, 1.5, c.nz * 4);
      this._sound('impact_concrete', this._v3(c.x, c.y, c.z), 1.1);
      let Q = this.gunQ.get(pk); // 面ごとの壊れた升（別々のつながりも全部）
      if (!Q) { Q = []; this.gunQ.set(pk, Q); }
      Q.push({ ax, plane, cu, cv, x: info.x, y: info.y, z: info.z });
      return this._gunFlush(this.game.time || 0, pk);
    }
    // 銃のひび・欠けの板（爆発の焦げを上書きしない別の輪。最初の 1 枚で作る = 描画 +1）
    _chipRing() {
      if (!this.chips) { this.chips = new MR.DestructDecals(this.game.scene, this.caps.chips || 64); this.chips.gate = this._gate; }
      return this.chips;
    }
    // 一番遠い升を忘れる
    _forgetCell() {
      const P = this._focus;
      let bk = null, bd = -1;
      for (const [k, c] of this.cells) { const d = (c.x - P.x) ** 2 + (c.z - P.z) ** 2; if (d > bd) { bd = d; bk = k; } }
      if (bk) this.cells.delete(bk);
    }
    // 待っている面の穴を決める（replanSec 秒に 1 回まで。only = その面だけ）。作った穴の数
    _gunFlush(t, only) {
      const G = this.gcfg, gap = G.replanSec > 0 ? G.replanSec : 0.25;
      let n = 0;
      for (const [pk, Q] of this.gunQ) {
        if (only && pk !== only) continue;
        if (t - (this.gunLast.get(pk) || -1e9) < gap) continue;
        this.gunQ.delete(pk);
        this.gunLast.set(pk, t);
        const done = new Set();
        for (const q of Q) { if (done.has(q.cu + '|' + q.cv)) continue; n += this._gunHole(pk, q, done); }
      }
      if (this.gunLast.size > 512) for (const k of Array.from(this.gunLast.keys()).slice(0, 256)) this.gunLast.delete(k);
      return n;
    }
    // 面 pk の壊れた升のつながり（q の升を含む）の外接矩形の穴
    _gunHole(pk, q, done) {
      const S = this.dead.get(pk), G = this.gcfg, BC = this.cfg.breach || {};
      if (!S) return 0;
      const cs = G.cell > 0 ? G.cell : 1;
      const maxU = Math.max(1, Math.round((BC.width > 0 ? BC.width : 3) / cs)), maxV = Math.max(1, Math.ceil((BC.height > 0 ? BC.height : 2.5) / cs));
      // つながり（4 方向）
      const seen = new Set([q.cu + '|' + q.cv]), st = [[q.cu, q.cv]];
      let u0 = q.cu, u1 = q.cu, v0 = q.cv, v1 = q.cv;
      while (st.length) {
        const [a, c] = st.pop();
        if (done) done.add(a + '|' + c);
        if (a < u0) u0 = a; if (a > u1) u1 = a; if (c < v0) v0 = c; if (c > v1) v1 = c;
        for (const [da, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (a + da) + '|' + (c + dc); if (S.has(k) && !seen.has(k)) { seen.add(k); st.push([a + da, c + dc]); } }
      }
      // 大きすぎるつながりは撃った升のまわりの maxU × maxV
      if (u1 - u0 + 1 > maxU) { u0 = Math.max(u0, Math.min(q.cu - Math.floor((maxU - 1) / 2), u1 - maxU + 1)); u1 = u0 + maxU - 1; }
      if (v1 - v0 + 1 > maxV) { v0 = Math.max(v0, Math.min(q.cv - Math.floor((maxV - 1) / 2), v1 - maxV + 1)); v1 = v0 + maxV - 1; }
      const rect = { s0: u0 * cs, s1: (u1 + 1) * cs, y0: v0 * cs, y1: (v1 + 1) * cs };
      // 床は矩形の一番下の升の高さで探す（撃った弾の高さで探すと、階の境をまたぐ矩形で上の階の床になる）
      const hit = { x: q.x, y: rect.y0 + 0.5 * cs, z: q.z };
      let best = null;
      this._around(q.x, q.z, 2, (d) => {
        if (best) return;
        const ix = this._idx(d);
        if (!ix.shell.length || !Destruction._near(ix.sbb, q.x, q.z, 2.5)) return;
        const near = this._shellNear(ix, q.x, q.y, q.z, 1.6);
        if (!near.length) return;
        const rec = D().planBreach(near, hit, { width: BC.width, height: BC.height, reach: 1.6, wall: BC.wall, rubbleH: BC.rubbleH, minFace: BC.minFace, rect, snapFloor: G.snapFloor });
        if (rec && rec.ax === q.ax && Math.abs((rec.ax === 'x' ? rec.x : rec.z) - q.plane) < 0.03) best = [d, rec];
      });
      if (!best) return 0;
      const [d, rec] = best;
      if (this._onDoor(rec)) { this.stats.doorSkips = (this.stats.doorSkips || 0) + 1; return 0; }
      // 同じ面で新しい穴の中に入る穴（前の小さな穴）を外す
      const old = [];
      for (const r of this.reg.recs.values()) {
        if (r.type !== 'breach' || !r.gun || r.ax !== rec.ax || Math.abs((r.ax === 'x' ? r.x : r.z) - (rec.ax === 'x' ? rec.x : rec.z)) > 0.03) continue;
        const A = r.R, B = rec.R;
        if (A.x0 >= B.x0 - 0.02 && A.x1 <= B.x1 + 0.02 && A.y0 >= B.y0 - 0.02 && A.y1 <= B.y1 + 0.02 && A.z0 >= B.z0 - 0.02 && A.z1 <= B.z1 + 0.02) old.push(r);
      }
      rec.gun = 1;
      // 中に入る前の穴を先に外す（上へだけ育った穴は中心と下端が同じ = 同じ鍵）
      for (const r of old) { this.reg.remove(r.k); this.pending.delete(r); this._changed(r.owner, r); }
      if (this.reg.has(rec.k)) return 0;
      if (!this.reg.add(rec, d.key, this.game.time || 0, (v) => this._repairRec(v))) return 0;
      this.stats.gunHoles = (this.stats.gunHoles || 0) + 1;
      if (this.game.blastFx) { const nx = rec.ax === 'x' ? rec.n : 0, nz = rec.ax === 'z' ? rec.n : 0; this.game.blastFx.wall(rec.x + nx * 0.2, (rec.R.y0 + rec.R.y1) / 2, rec.z + nz * 0.2, nx, nz, 1.6, 'gun'); } // 升が抜けた: 粉・塊（destruct-3 M1）
      if (this.chips) this.chips.clearIn(rec.R, 0.1); if (this.exposed) this.exposed.clearIn(rec.R, 0.1); if (this.windows) this.windows.clearIn(rec.R, 0.1); // 穴の中のひび・欠けの板（宙に浮く）を消す
      this.decals.clearIn(rec.R, 0.1);
      this._queueRubble(rec);
      this._changed(d.key, rec);
      this._repT = 0; // 遠景・家具の穴の箱
      return 1;
    }

    // ---------- がれき（R2）----------
    // 当たりの中では決めない（当たり判定・扉を引くので重い）: 次のフレームから 1 フレーム 2 つずつ
    _queueRubble(rec) {
      if (!this.rubbleOn || !this.solid) return;
      (this.soon || (this.soon = [])).push(rec);
    }
    // 記録 rec のがれきの山を決める（rec.rm）。家具のチャンクがまだ読めていない中の山があれば待つ（pending。1 秒ごとに見直す）。決めたら true
    _planRubble(rec) {
      if (!this.rubbleOn || !this.solid || rec.rm >= 0) { this.pending.delete(rec); return false; }
      const X = D(), plan = X.planRubble(rec, this.rcfg);
      if (!plan.length) { rec.rm = 0; this.pending.delete(rec); return true; }
      const nav = this.nav;
      if (!nav || !nav.hasChunk(rec.owner)) { this.pending.add(rec); return false; }
      const FU = this.world.furn, DO = this.world.doors;
      // 待つ: 家具（建物の持ち主のチャンク = rec.owner の結果が出来上がるまで。空中で家具を出していない間も数えずに待つ）と、
      //   山のチャンクの自動ドア（doors.js は立っている所の 3 × 3 だけ出す）。waitSec 秒（家具を出している間の秒）待っても来なければ中の山は置かない
      const furnReady = !FU || (() => { const r = FU.added.get(rec.owner); return !!(r && !r.partial); })();
      const hasInside = plan.some((P) => P.inside);
      let giveUp = false;
      if (hasInside && !furnReady) {
        const PL = this.game.player && this.game.player.pos;
        if (FU.active && PL && Math.hypot(PL.x - rec.x, PL.z - rec.z) < 150) rec._rbWait = (rec._rbWait || 0) + 1; // 近くで家具を出しているのに来ないときだけ数える
        if ((rec._rbWait || 0) <= (this.rcfg.waitSec || 20)) { this.pending.add(rec); return false; }
        giveUp = true;
      }
      if (DO && DO.active) {
        for (const P of plan) { const B = P.v[0]; for (const [px, pz] of [[B.x0, B.z0], [B.x1, B.z1]]) { const c = this.city.chunkOf(px, pz); if (!DO.active.has(c.cx + '_' + c.cz)) { this.pending.add(rec); return false; } } }
      }
      let rm = 0;
      for (let i = 0; i < plan.length; i++) {
        const P = plan[i];
        if (P.inside && giveUp) continue; // 家具が来ない: 中の山は置かない
        let mode = X.RUB.NONE, dy = 0, block = false;
        for (let v = 0; v < 2 && mode === X.RUB.NONE; v++) {
          const r = this._rubbleCheck(rec, P.v[v], P);
          if (r.ok) { mode = v === 0 ? X.RUB.FULL : X.RUB.SMALL; dy = r.dy; }
          else if (r.why === 'block' || r.why === 'busy' || (r.why === 'tight' && v === 1)) { block = true; dy = r.dy; }
        }
        if (mode === X.RUB.NONE && block) mode = X.RUB.LOOK; // 扉・階段・梯子の前: 当たり判定なしの平らな欠片だけ
        rm |= X.slotBits(mode, dy) << (i * 6);
        this.stats.rubble = this.stats.rubble || [0, 0, 0, 0];
        this.stats.rubble[mode]++;
      }
      rec.rm = rm;
      this.pending.delete(rec);
      if (this.rubble) this.rubble.dirty = true; // 後から決まった山も描く
      return true;
    }
    // 山の候補 B を置けるか: { ok, dy } | { why: 'support' | 'solid' | 'block', dy }
    //   support = 足元が平らな立てる面でない（宙・水・段差）、solid = 壁・家具・ほかの箱と重なる、block = 扉・階段・梯子・エレベーターの前
    _rubbleCheck(rec, B, P) {
      const nav = this.nav, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, h = B.y1 - B.y0;
      const g = nav.groundHeight(cx, cz, rec.y + 0.15, 0);
      if (g == null || g > rec.y + 0.12 || g < rec.y + 0.1 - 15 * 0.05) return { why: 'support' };
      const dy = Math.max(0, Math.min(15, Math.round((rec.y + 0.1 - g) / 0.05)));
      const gy = rec.y + 0.1 - dy * 0.05;
      const e = 0.05;
      for (const [px, pz] of [[B.x0 + e, B.z0 + e], [B.x1 - e, B.z0 + e], [B.x0 + e, B.z1 - e], [B.x1 - e, B.z1 - e]]) {
        const gg = nav.groundHeight(px, pz, rec.y + 0.15, 0);
        if (gg == null || Math.abs(gg - g) > 0.15) return { why: 'support' };
      }
      // 重なる箱（自分の壊した小物・給水塔の箱と、ほかのがれき・穴のがれきの敷居は見ない）
      const items = nav.itemsIn(B.x0, B.z0, B.x1, B.z1, this._rbItems || (this._rbItems = []), { prisms: true });
      let why = null;
      for (let k = 0; k < items.length && !why; k++) {
        const it = items[k];
        if (it.k === 2) { if (MR.Nav3D.pointIn(it, cx, cz) && it.y1 > gy + 0.05) why = 'solid'; continue; }
        if (Math.min(it.x1, B.x1) - Math.max(it.x0, B.x0) <= 0.02 || Math.min(it.z1, B.z1) - Math.max(it.z0, B.z0) <= 0.02) continue;
        const top = it.k === 1 ? Math.max(it.y0, it.y1) : it.y1;
        if (top <= gy + 0.05 || it.y0 >= gy + h) continue;
        const src = it.src || it.b || null;
        if (src && (src.dx === 5 || src.dx === 2 || src.dx === 6 || src.cat === 'rubble')) continue; // dx 6 = 穴の縁のスラブ・鉄筋（見た目だけ）
        if (src && (rec.type === 'prop' || rec.type === 'tank') && src.cat === 'prop' && Math.hypot(src.x - rec.x, src.z - rec.z) < (rec.r || 0.5) + 0.6) continue;
        why = it.k === 1 ? 'block' : 'solid'; // スロープ = 階段
      }
      items.length = 0;
      if (why) return { why, dy };
      // 人・敵・乗り物の上には置かない（小さく → 見た目だけ）
      const occ = (x, z, r) => x > B.x0 - r && x < B.x1 + r && z > B.z0 - r && z < B.z1 + r;
      const PL = this.game.player;
      if (PL && !PL.dead && Math.abs(PL.pos.y - gy) < 2 && occ(PL.pos.x, PL.pos.z, 0.6)) return { why: 'busy', dy };
      for (const e of this.game.enemies || []) if (!e.dead && e.pos && Math.abs(e.pos.y - gy) < 2 && occ(e.pos.x, e.pos.z, 0.6)) return { why: 'busy', dy };
      for (const v of this.game.vehicles || []) if (!v.wrecked && v.pos && Math.abs(v.pos.y - gy) < 3 && occ(v.pos.x, v.pos.z, (v.def && v.def.width ? v.def.width / 2 : 1.2) + 0.6)) return { why: 'busy', dy };
      // 高い山の横に 1 m の通り道（敵の歩行グラフは乗り越えない）: 山の周り 1 m に固い箱（この壁の外壁・床より下は除く）があれば狭い
      if (P && P.kind === 'mound') {
        const m = 1.0, its2 = nav.itemsIn(B.x0 - m, B.z0 - m, B.x1 + m, B.z1 + m, this._rbItems2 || (this._rbItems2 = []));
        let tight = false;
        for (const it of its2) {
          if (it.k !== 0) continue;
          const src = it.src;
          if (!src || src.dx === 5 || src.dx === 2 || src.cat === 'rubble' || ((src.f & D().F.SHELL) && src.cat === 'exterior') || it.y1 <= gy + 0.5 || it.y0 >= gy + 1.8) continue;
          if (rec.type !== 'breach' && src.cat === 'prop' && Math.hypot(src.x - rec.x, src.z - rec.z) < (rec.r || 0.5) + 0.6) continue;
          tight = true; break;
        }
        its2.length = 0;
        if (tight) return { why: 'tight', dy };
      }
      // 梯子（壁の線 + 外向き）: 足元から 1.5 m の間にかかる梯子の 0.9 m 以内は置かない
      for (const l of nav.laddersNear(cx, cz, 3, this._rbLad || (this._rbLad = []))) {
        if (l.y1 < gy || l.y0 > gy + 1.5) continue;
        const dx = Math.max(B.x0 - l.x, 0, l.x - B.x1), dz = Math.max(B.z0 - l.z, 0, l.z - B.z1);
        if (Math.hypot(dx, dz) < 0.9) { this._rbLad.length = 0; return { why: 'block', dy }; }
      }
      this._rbLad.length = 0;
      // 扉（自動ドア・建物の入口の点）とエレベーターの乗り場
      const near = (x, z, r) => Math.hypot(Math.max(B.x0 - x, 0, x - B.x1), Math.max(B.z0 - z, 0, z - B.z1)) < r;
      const DL = this.world.doors && this.world.doors.list;
      if (DL) for (const d of DL) if (Math.abs((d.y || 0) - gy) < 2.5 && near(d.x, d.z, (d.w || 2) / 2 + 0.8)) return { why: 'block', dy };
      const L = this.city && this.city.lifts;
      if (L) for (const lf of L) for (const st of lf.stations || []) if (Math.abs(st.y - gy) < 2 && near(st.x, st.z, 2)) return { why: 'block', dy };
      const c = this.city.chunkOf(cx, cz);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { // 隣のチャンクの建物（区画がはみ出す）の入口も
        const dat = this._chunk(c.cx + i, c.cz + j);
        if (dat && dat.buildings) for (const b of dat.buildings) if (b.door && Math.abs(b.door[1] - gy) < 1.5 && near(b.door[0], b.door[2], 1.6)) return { why: 'block', dy };
      }
      return { ok: true, dy };
    }
    // 止まった破片 → がれき（見た目だけ。当たり判定なし）
    _settle(deb, i) {
      if (!this.rubble || deb.settleOn === false) return false;
      const P = this.game.player && this.game.player.pos;
      this.rubble.settle(deb.px[i], deb.py[i], deb.pz[i], deb.sx[i], deb.sy[i] * 0.7, deb.sz[i], deb.rx[i], deb.ry[i], deb.rz[i], deb.cr[i], deb.cg[i], deb.cb[i], P ? P.x : 0, P ? P.z : 0);
      return true;
    }

    // 遠景の箱（上限で外した穴）のうち、持ち主のチャンクが近景にある・近くに穴の記録があるものを捨てる
    _pruneFar() {
      const F = this.reg.far, S = this.world.streamer;
      if (!F.length) return;
      // 穴の記録の場所（1 m の格子）。記録は上限 3000 個なので 1 秒に 1 回の Set でよい
      const near = new Set();
      for (const r of this.reg.recs.values()) if (r.type === 'breach') near.add(Math.round(r.x) + '|' + Math.round(r.z));
      for (let i = F.length - 1; i >= 0; i--) {
        const f = F[i], cx = (f[0] + f[3]) / 2, cz = (f[2] + f[5]) / 2;
        const c = this.city.chunkOf(cx, cz);
        let drop = !!(S && S.full.has(c.cx + '_' + c.cz));
        if (!drop && near.size) { const ix = Math.round(cx), iz = Math.round(cz); for (let a = -1; a <= 1 && !drop; a++) for (let b = -1; b <= 1; b++) if (near.has((ix + a) + '|' + (iz + b))) { drop = true; break; } }
        if (drop) F.splice(i, 1);
      }
    }

    // 上限で外す記録の基準（プレイヤーの足元。乗り物に乗っていても player.pos は座席）
    _setFocus() { const P = this.game.player && this.game.player.pos; if (P) { this._focus.x = P.x; this._focus.z = P.z; } }

    // ---------- 毎フレーム ----------
    update(dt) {
      const g = this.game;
      this._fN = (this._fN | 0) + 1;
      // カメラの世界の位置（mainCamera は行列だけ写していて position は動かない = 以前はいつも原点だった）
      const cam = g.camera.getWorldPosition ? g.camera.getWorldPosition(this._camV || (this._camV = new THREE.Vector3())) : g.camera.position;
      this._setFocus();
      if (this._warmLeft > 0) {
        if (this._warmLeft === 3) {
          if (this.debris) this.debris.spawn(this.debris._kit('concrete'), { x: cam.x, y: cam.y - 60, z: cam.z }, { x: 0, y: 0, z: 0 }, 0, 0.3);
          if (!this.decals.n) { this.decals.add({ x: cam.x, y: cam.y - 60, z: cam.z }, { x: 0, y: 1, z: 0 }, 0.01); this._warmDecal = true; }
          // 割れた窓・むき出しの壁の板も（最初の窓で Canvas のテクスチャとメッシュを作ると 1 回 15 ms 前後止まった）
          this._warmOther = [];
          for (const D of [this.windows, this.exposed]) if (D && !D.n) { D.add({ x: cam.x, y: cam.y - 60, z: cam.z }, { x: 0, y: 1, z: 0 }, 0.01); this._warmOther.push(D); }
        }
        if (--this._warmLeft === 0) {
          if (this._warmDecal && this.decals.n === 1) { this.decals.clear(); this.decals.stats.added = 0; }
          for (const D of this._warmOther || []) if (D.n === 1) { D.clear(); D.stats.added = 0; }
          this._warmOther = null;
        }
      }
      if (this.debris) this.debris.update(dt, cam);
      this._glassPump(dt);
      if (this._brQ && this._brQ.length) { if (!this._gbDid) this._breachPump(); }
      else this._idxWarm(cam);
      if (this.collOn) this._collUpdate(dt, cam);
      // 歩行グラフ（graphBudgetMs の中）
      if (this.jobs.length) {
        const t0 = now(), bud = (g.cityCfg && g.cityCfg.graphBudgetMs) || 2.5;
        while (this.jobs.length && now() - t0 < bud) { if (this.jobs[0].step(bud - (now() - t0))) this.jobs.shift(); else break; }
        const ms = now() - t0;
        this.stats.graphMs = ms; if (ms > this.stats.graphMsMax) this.stats.graphMsMax = ms;
      }
      // 給水塔が落ちる（0〜0.45: 脚が折れて落ちる、0.45〜1: つぶれて傾く → 消える）
      for (let i = this.anims.length - 1; i >= 0; i--) {
        const A = this.anims[i];
        A.t += dt;
        const u = Math.min(1, A.t / A.dur), f = Math.min(1, u / 0.45), c = Math.max(0, (u - 0.45) / 0.55);
        A.grp.position.y = A.y0 - A.drop * f * f;
        const H = (this.world.props.kinds.water_tank || {}).h || 7.5, sy = 1 - (1 - (A.crush + 0.6) / H) * c;
        A.grp.scale.set(1 + 0.12 * c, Math.max(0.05, sy), 1 + 0.12 * c);
        A.grp.rotation.z = A.tilt * c;
        if (u >= 1) { if (A.grp.parent) A.grp.parent.remove(A.grp); this.anims.splice(i, 1); }
      }
      // がれき: 今できた記録の山を 1 フレーム 2 つまで（当たりの外で）
      if (this.soon && this.soon.length) {
        this._batch = new Map();
        try { for (let k = 0; k < 2 && this.soon.length; k++) { const r = this.soon.shift(); if (this.reg.has(r.k) && this._planRubble(r)) this._changed(r.owner, r); } }
        finally { const B = this._batch; this._batch = null; for (const [owner, recs] of B) this._flush(owner, recs); }
      }
      // 銃の穴の決め直しの待ち（R3。replanSec 秒に 1 回）
      if (this.gunQ.size) { this._batch = new Map(); try { this._gunFlush(g.time || 0); } finally { const B = this._batch; this._batch = null; for (const [owner, recs] of B) this._flush(owner, recs); } }
      // 待っている小物（1 フレームに props.perFrame 個。持ち主は今のデータで探し直す）
      if (this._pq && this._pq.length) {
        this._batch = new Map();
        try {
          for (let k = 0, m = (this.cfg.props && this.cfg.props.perFrame) || 4; k < m && this._pq.length; k++) {
            const [p, rule, dmg, I] = this._pq.shift();
            let own = null;
            this._around(p.x, p.z, 1, (d) => { if (!own && d.props && d.props.indexOf(p) >= 0) own = d; });
            if (own) this._damageProp(own, p, rule, dmg, I);
          }
        } finally { const B = this._batch; this._batch = null; for (const [owner, recs] of B) this._flush(owner, recs); }
      }
      // 待っている当たり判定（1 フレームに 1 つの持ち主。このフレームにほかの _sync があれば次へ）
      if (this._sq && this._sq.size && this._syncF !== this._fN) { const [o, L] = this._sq.entries().next().value; this._sq.delete(o); this._sync(o, L); }
      // 近景の形（1 フレームに 1 チャンク。当たり判定を直したフレーム（_sync）は次へ）
      if (this.meshQueue.length && this._syncF !== this._fN) this._patchMesh(this.meshQueue.shift());
      // がれきの山の見た目（近くだけ。変わった時・10 m 動いた時）
      if (this.rubble) { if (this.debris) this.debris.settleOn = this._warmLeft <= 0; this.rubble.update(dt, this.reg, cam, this.rcfg); }
      // 乗り物でぶつかる（はねる）
      if (this.cfg.ram !== false) this._rams();
      // 見ている持ち主・直す（1 秒ごと）
      this._repT -= dt;
      if (this._repT <= 0) {
        this._repT = 1;
        const S = this.world.streamer, t = g.time || 0;
        if (S) for (const r of S.full.values()) if (r.state === 'built') this.reg.touch(r.key, t);
        this.reg.repair(t, (rec) => this._repairRec(rec)); // repairAfter が無ければ何もしない（destruct-2: 時間では直らない）
        if (this.pending.size) for (const r of Array.from(this.pending)) { if (!this.reg.has(r.k)) { this.pending.delete(r); continue; } if (this._planRubble(r)) this._changed(r.owner, r); }
        this._farCuts(cam);
      }
    }

    // 乗り物ではねる: 速さ ramSpeed m/s 以上の車の車体の長方形（向きつき）に、小物の足元の円が触れたら壊す
    //   （前後は半径 + 0.35 m・横は半径 × 0.8 + 0.15 m。ダメージ = 速さ × ramDamage）。オンラインは見た目だけで同じ物を cosmeticSec 秒は壊さない（_damageProp）
    // 遠景の材質（world.makeFarMaterial の uCut0 / uCut1）に近い穴を CUT_SLOTS 個（外へ 0.25 m 広げた箱 = 外壁の面が入る）
    _farCuts(cam) {
      const fm = this.world.farMaterial, U = fm && fm.userData && fm.userData.uniforms;
      if (!U || !U.uCut0) return;
      const list = [];
      for (const r of this.reg.recs.values()) if (r.type === 'breach') list.push([Math.hypot(r.x - cam.x, r.z - cam.z), r]);
      // 上限で外した穴（箱だけ）も遠景は暗いまま。持ち主のチャンクが近景に戻った（壁は元に戻った）・同じ所にまた穴の記録が
      //   できた箱は捨てる（近景の壁の向こうの家具を消さない・枠を取らない）
      this._pruneFar();
      for (const f of this.reg.far) list.push([Math.hypot((f[0] + f[3]) / 2 - cam.x, (f[2] + f[5]) / 2 - cam.z), { R: { x0: f[0], y0: f[1], z0: f[2], x1: f[3], y1: f[4], z1: f[5] }, far: true }]);
      list.sort((a, b) => a[0] - b[0]);
      const c0 = U.uCut0.value, c1 = U.uCut1.value;
      if (U.uCutN) U.uCutN.value = Math.min(c0.length, list.length);
      for (let i = 0; i < c0.length; i++) {
        const r = list[i] && list[i][1];
        if (!r) { c0[i].set(1, 1, 1); c1[i].set(0, 0, 0); continue; }
        const R = r.R, e = 0.25;
        c0[i].set(R.x0 - e, R.y0, R.z0 - e); c1[i].set(R.x1 + e, R.y1, R.z1 + e);
      }
      // 家具と壁の内張り（interiors_view.js の uDxC0 / uDxC1）: 同じ近い穴の箱（外へ 0.25 m = 部屋の側 2 cm の内張りが入る）。遠景の箱は入れない
      const IV = this.world.furnView, IU = IV && IV.U;
      if (IU && IU.uDxC0) {
        if (this.reg.far.length) { let w = 0; for (let i = 0; i < list.length; i++) if (!list[i][1].far) list[w++] = list[i]; list.length = w; }
        const d0 = IU.uDxC0.value, d1 = IU.uDxC1.value;
        IU.uDxN.value = Math.min(d0.length, list.length);
        for (let i = 0; i < d0.length; i++) {
          const r = list[i] && list[i][1];
          if (!r) { d0[i].set(1, 1, 1); d1[i].set(0, 0, 0); continue; }
          const R = r.R, e = 0.25;
          d0[i].set(R.x0 - e, R.y0, R.z0 - e); d1[i].set(R.x1 + e, R.y1, R.z1 + e);
        }
      }
    }

    _rams() {
      const g = this.game, RC = this.cfg.ramSpeed > 0 ? this.cfg.ramSpeed : 5, PR = this.cfg.props || {};
      for (const v of g.vehicles) {
        if (v.wrecked || v.sunk || v.kind === 'jet' || v.kind === 'heli' || v.kind === 'vtol' || v.kind === 'boat' || !v.def) continue;
        const sp = Math.abs(v.speed || 0), prev = v._dxSp || 0;
        v._dxSp = sp;
        const s = Math.max(sp, prev);
        if (s < RC) continue;
        const hw = (v.def.width || 2) / 2, hl = (v.def.length || 4.4) / 2, yaw = v.yaw || 0, sn = Math.sin(yaw), cs = Math.cos(yaw);
        const px = v.pos.x, pz = v.pos.z, py = v.pos.y, reach = hl + 3;
        const dir = Math.sign(v.speed || 1);
        this._around(px, pz, reach, (d) => {
          const ix = this._idx(d);
          if (!ix.props.length || !Destruction._near(ix.pbb, px, pz, reach)) return;
          for (const p of ix.props) {
            const dx = p.x - px, dz = p.z - pz;
            if (Math.abs(dx) > reach || Math.abs(dz) > reach || Math.abs(p.y - py) > 1.5) continue;
            const rule = PR[p.type];
            const r0 = rule.r || 0.5, rr = r0 * 0.8; // 前後は車体が箱に当たって止まる所まで（半径 + 0.35 m）、横は狭く
            const f = dx * sn + dz * cs, sd = dx * cs - dz * sn;
            if (Math.abs(sd) > hw + rr + 0.15 || Math.abs(f) > hl + r0 + 0.35) continue;
            this._damageProp(d, p, rule, s * (this.cfg.ramDamage || 30), { x: px, y: py, z: pz, kind: 'ram', vx: sn * s * dir, vz: cs * s * dir });
          }
        });
      }
    }

    static get EMPTY() { return Destruction._E || (Destruction._E = { remove: new Set(), add: [], ladders: new Set(), rects: [] }); }
    static get _IDX() { return Destruction.__idx || (Destruction.__idx = new WeakMap()); }
    // 近景の頂点と同じ格子（CityGeo の q: 1/256 m の偶数丸め）
    static q(v) { const M = 6755399441055744; return ((v * 256 + M) - M) * 0.00390625; }

    // ---------- 倒壊（destruct-3 M3。ソロだけ = solid。v1 の区画 L）----------
    //   _collapseHit: 爆発（kind missile / vehicle / blast）は区画の土台の箱（地面から max(8, H/3) m）までの距離の当たり × kindMul（上の当たりは × upperMul）、
    //   弾（bullet / gun）は土台に当たった弾のダメージ × gunMul を区画ごとに貯める（lotDmg）。体力（Destruct.lotHP）の partialAt で一部・1 で全部。
    //   決まったら warnSec 秒の予告（うなり・窓から粉・上から小さな破片・揺れ・中か落ちる所の近くなら「建物が崩れる！」）→ _commitCollapse:
    //   記録（c|<L.id>。外さない・続きからに入る）→ 当たり判定（_sync: 箱・スロープ・梯子）・近景（_patchMesh）・ヘリの当たり（kill）・支えの高さ・
    //   ミニマップ・家具・扉・小物・落ちている物・中の敵（手柄）/ 乗り物 / プレイヤー → 代わりの形（同じ材質の箱を変形だけで潰す = 新しいシェーダーなし）
    //   → 土ぼこりの波。遠景・LOD・スカイラインは頂点の高さを切る（_farClamp。far.bin・鍵は変えない）
    _collInit() {
      if (this._collReady) return this.collOn;
      this._collReady = true;
      const g = this.game, C = this.ccfg = Object.assign({}, D().COLL, this.cfg.collapse || {});
      const story = g.story && g.story.ch;
      const sysOff = story && (!story.systems || story.systems.collapse !== true); // ストーリーは章が systems.collapse: true のときだけ
      this.collOn = !!(this.solid && C.enabled !== false && this.city && this.city.lots && this.city.ixLots && !sysOff && !(MR.CONFIG && MR.CONFIG.COLLAPSE === false) && !(typeof location !== 'undefined' && /[?&]collapse=0/.test(location.search || '')));
      this.lotDmg = new Map(); this.warns = []; this.falls = []; this.colls = []; this._lotOkC = new Map(); this.farQ = [];
      if (this.collOn && this.world.streamer) this.world.streamer.onLodBuilt = (rec, out) => this._onLodBuilt(rec, out);
      return this.collOn;
    }
    _lotsNear(x, z, r, visit) {
      const c = this.city, cs = c.cs || 128, o = 64;
      const a0 = Math.floor((x - r - o - c.minX) / cs), a1 = Math.floor((x + r + o - c.minX) / cs), b0 = Math.floor((z - r - o - c.minZ) / cs), b1 = Math.floor((z + r + o - c.minZ) / cs);
      for (let cz = b0; cz <= b1; cz++) for (let cx = a0; cx <= a1; cx++) {
        if (cx < 0 || cz < 0 || cx >= c.ncx || cz >= c.ncz) continue;
        for (const li of c.ixLots[cz * c.ncx + cx]) {
          const L = c.lots[li];
          if (!L.tiers || !L.tiers.length) continue;
          if (x < L.x0 - r || x > L.x1 + r || z < L.z0 - r || z > L.z1 + r) continue;
          visit(L);
        }
      }
    }
    // 倒れてよい区画か（覚える）: 種類・設定の protect の矩形・ヘリポート・ストーリーの章の目印（anchors）
    _lotOk(L) {
      let v = this._lotOkC.get(L.i);
      if (v !== undefined) return v;
      const C = this.ccfg, kinds = C.kinds || ['walkup', 'lowrise', 'warehouse', 'midrise', 'tower'];
      v = kinds.indexOf(L.kind) >= 0;
      const inR = (x, z, m) => x > L.x0 - m && x < L.x1 + m && z > L.z0 - m && z < L.z1 + m;
      if (v) for (const r of C.protect || []) if (Math.min(L.x1, r[2]) > Math.max(L.x0, r[0]) && Math.min(L.z1, r[3]) > Math.max(L.z0, r[1])) { v = false; break; }
      if (v) for (const h of this.city.helipads || []) if (inR(h.x, h.z, 2)) { v = false; break; }
      const st = this.game.story && this.game.story.ch;
      if (v && st && st.anchors) for (const k in st.anchors) { const a = st.anchors[k], p = a && a.p; if (p && inR(p[0], p[2], 3)) { v = false; break; } }
      this._lotOkC.set(L.i, v);
      return v;
    }
    _collOf(L) { return this.reg.get('c|' + L.id); }
    // 点 (x, z) の倒れた区画の記録（外す範囲 C の中）
    collapsedAt(x, z, m) {
      if (!this.colls || !this.colls.length) return null;
      m = m || 0;
      for (const r of this.colls) { const C = r.C; if (x > C.x0 - m && x < C.x1 + m && z > C.z0 - m && z < C.z1 + m) return r; }
      return null;
    }
    // 予告中・落ちている途中の建物の落ちる所（復活の場所が避ける）
    fallingAt(x, z, m) {
      m = m || 0;
      for (const w of this.warns || []) { const L = w.L; if (x > L.x0 - m - w.fr && x < L.x1 + m + w.fr && z > L.z0 - m - w.fr && z < L.z1 + m + w.fr) return true; }
      for (const f of this.falls || []) { const R = f.zone; if (x > R.x0 - m && x < R.x1 + m && z > R.z0 - m && z < R.z1 + m) return true; }
      return false;
    }
    _collapseHit(info, R, at) {
      if (!this._collInit()) return 0;
      const C = this.ccfg, gun = info.kind === 'bullet' || info.kind === 'gun';
      const own = info.own != null ? !!info.own : gun;
      const km = gun ? 1 : ((C.kindMul || {})[info.kind] != null ? C.kindMul[info.kind] : 1);
      let n = 0;
      this._lotsNear(info.x, info.z, gun ? 1 : R, (L) => {
        if (!this._lotOk(L)) return;
        const base = D().lotBase(L), top = D().lotTop(L), H = top - base, bt = base + Math.max(8, H / 3);
        const dist = (y1) => Math.hypot(Math.max(L.x0 - info.x, 0, info.x - L.x1), Math.max(base - info.y, 0, info.y - y1), Math.max(L.z0 - info.z, 0, info.z - L.z1));
        let dmg = 0;
        if (gun) { if (dist(bt) <= 0.8) dmg = (info.damage || 0) * (C.gunMul || 0.05); }
        else {
          const db = dist(bt);
          if (db <= R) dmg = at(db) * km;
          else { const dt = dist(top); if (dt <= R) dmg = at(dt) * km * (C.upperMul || 0.35); }
        }
        if (!(dmg > 0)) return;
        const rec = this._collOf(L), stage = rec ? rec.stage : 0;
        if (stage >= 2) return;
        let s = this.lotDmg.get(L.i);
        if (!s) { s = { dmg: 0, hp: D().lotHP(L, C), own: false, hx: 0, hy: 0, hz: 0, w: 0 }; this.lotDmg.set(L.i, s); }
        s.dmg += dmg; if (own) s.own = true;
        s.hx += info.x * dmg; s.hy += info.y * dmg; s.hz += info.z * dmg; s.w += dmg;
        const f = s.dmg / s.hp;
        this.stats.collDmg = (this.stats.collDmg || 0) + 1;
        const want = f >= 1 ? 2 : (f >= (C.partialAt || 0.55) ? 1 : 0);
        if (want > stage) { this._warn(L, want, s); n++; }
      });
      return n;
    }
    _warn(L, stage, s) {
      let w = this.warns.find((q) => q.L === L);
      if (w) { if (stage > w.stage) { w.stage = stage; this._warnPlan(w); } return; }
      const C = this.ccfg, H = D().lotTop(L) - D().lotBase(L);
      w = { L, stage, s, t: 0, T: C.warnSec || 1.75, fx: 0, hud: 0, fr: Math.min(C.fallMax || 25, H * (C.fallK || 0.25) + 4), plan: null, job: null, built: null };
      this.warns.push(w);
      this._warnPlan(w);
      this.stats.warns = (this.stats.warns || 0) + 1;
      const p = { x: (L.x0 + L.x1) / 2, y: D().lotBase(L) + Math.min(H, 20) * 0.5, z: (L.z0 + L.z1) / 2 };
      const a = this.game.audio;
      if (a && typeof a.play === 'function') a.play('blast_rumble', { pos: p, refDistance: 30, maxDistance: 900, volume: 1, rate: 0.55, priority: 3 });
    }
    // 予告の計画（段階が上がったら作り直す）: 記録の形と、代わりの形を作るジェネレーター
    _warnPlan(w) {
      const s = w.s, hint = s.w > 0 ? { x: s.hx / s.w, y: s.hy / s.w, z: s.hz / s.w } : null;
      w.plan = D().planCollapse(w.L, w.stage, hint, this.ccfg);
      w.plan.owner = this._ownerOf(w.plan);
      w.job = this._proxyJob(w.plan); w.built = null; w._pumped = false;
    }
    _inZone(P, L, m) { return P.x > L.x0 - m && P.x < L.x1 + m && P.z > L.z0 - m && P.z < L.z1 + m; }
    _collUpdate(dt, cam) {
      if (!this.collOn || !this.warns) return;
      const g = this.game, P = g.player, C = this.ccfg;
      // 倒れた次のフレーム: 当たり判定（_sync）・家具・扉・落ちている物（倒れるフレームを短く）
      if (this.later && this.later.length) { const q = this.later.shift(); q(); }
      let pb = this.mobile ? (C.proxyMsMobile || 1) : (C.proxyMs || 1.5), committed = false;
      for (let i = this.warns.length - 1; i >= 0; i--) {
        const w = this.warns[i], L = w.L;
        w.t += dt; w.fx -= dt; w.hud -= dt;
        const base = D().lotBase(L), top = D().lotTop(L);
        if (w.fx <= 0) { // 窓から粉・上から小さな破片・揺れ
          w.fx = 0.22;
          const side = Math.floor(Math.random() * 4), u = Math.random();
          const nx = side === 0 ? -1 : side === 1 ? 1 : 0, nz = side === 2 ? -1 : side === 3 ? 1 : 0;
          const x = nx ? (nx < 0 ? L.x0 : L.x1) : L.x0 + u * (L.x1 - L.x0), z = nz ? (nz < 0 ? L.z0 : L.z1) : L.z0 + u * (L.z1 - L.z0);
          const y = base + 3 + Math.random() * Math.max(1, Math.min(top - base - 3, 60));
          if (g.blastFx) g.blastFx.wall(x + nx * 0.3, y, z + nz * 0.3, nx, nz, 1.2, 'warn');
          this._burst('dxChip', x + nx * 0.5, Math.min(top, y + 6), z + nz * 0.5, [3, 5], nx * 1.5, 0, nz * 1.5);
          if (cam) { const d = Math.hypot(cam.x - x, cam.z - z); if (d < 120) g.rumble = Math.min(1.5, (g.rumble || 0) + (1 - d / 120) * 0.25); }
        }
        if (P && !P.dead && w.hud <= 0 && this._inZone(P.pos, L, w.fr)) { w.hud = 1.1; if (g.hud && g.hud.showMessage) g.hud.showMessage(C.warnText || '建物が崩れる！', 1200); this.stats.warnHud = (this.stats.warnHud || 0) + 1; }
        // 代わりの形の予算はフレームに 1 つ（予告が何本あっても合わせて proxyMs）・倒すのもフレームに 1 つ（b17 の検証 S8: GBU で
        //   予告が同時に何本も出ると N 倍の予算と N 本の倒壊が 1 フレームに入った）
        if (!w.built && pb > 0) { const t0 = now(); this._proxyPump(w, pb); pb -= now() - t0; }
        if (w.t >= w.T && !committed) { committed = true; this.warns.splice(i, 1); this._commitCollapse(w); }
      }
      for (let i = this.falls.length - 1; i >= 0; i--) if (this._fallStep(this.falls[i], dt, cam)) this.falls.splice(i, 1);
      // 遠景の頂点の切り（1 フレーム farMs（タッチ farMsMobile）ms まで。続きは次のフレーム）
      if (this.farQ.length) {
        const t0 = now(), B = this.mobile ? (C.farMsMobile || 1.2) : (C.farMs || 2);
        while (this.farQ.length) {
          const q = this.farQ[0], left = B - (now() - t0);
          if (left <= 0.05) break;
          const r = this._clampGeo(q[0], q[1], left, q[2]);
          if (r === true) this.farQ.shift(); else { q[2] = r; break; }
        }
        const ms = now() - t0; this.stats.farMs = Math.max(this.stats.farMs || 0, ms);
      }
    }
    _commitCollapse(w) {
      const L = w.L, s = w.s;
      const t0 = now();
      const rec = w.plan || D().planCollapse(L, w.stage, s.w > 0 ? { x: s.hx / s.w, y: s.hy / s.w, z: s.hz / s.w } : null, this.ccfg);
      rec.own = s.own ? 1 : 0;
      const owner = rec.owner || this._ownerOf(rec);
      const old = this.reg.get(rec.k);
      if (old) { this.reg.remove(rec.k); const j = this.colls.indexOf(old); if (j >= 0) this.colls.splice(j, 1); }
      if (!this.reg.add(rec, owner, this.game.time || 0, (v) => this._repairRec(v))) return;
      this.stats.collapses = (this.stats.collapses || 0) + 1;
      if (!w.built && w.job) { let r; do { r = w.job.next(); } while (!r.done); w.built = r.value || { list: [], boxes: 0 }; w.job = null; } // 作りかけは続きから（R7）
      this._applyColl(rec, true, w.built);
      // 当たり判定は次のフレーム（倒れるフレームを短く。人は _crush が先に片付けた）
      (this.later || (this.later = [])).push(() => this._changed(owner, rec));
      const ms = now() - t0;
      this.stats.collMs = ms; this.stats.collMsMax = Math.max(this.stats.collMsMax || 0, ms);
    }
    // 倒れた区画の世界の更新（続きからの restore でも = live false: 代わりの形・音・人へのダメージなし）
    _applyColl(rec, live, built) {
      const g = this.game, C = rec.C;
      if (this.colls.indexOf(rec) < 0) this.colls.push(rec);
      this._supportOverride();
      const hc = g.heliCollider || (typeof g._heliColl === 'function' ? g._heliColl() : null); // まだ作っていなければ作る（後で作ると倒れた区画を知らない = S7）
      if (hc && typeof hc.kill === 'function') hc.kill(rec.lot, C);
      const flatTop = rec.stage >= 2 && !rec.tall ? rec.y + rec.mound : C.y0;
      const mm = this._mm();
      if (mm && typeof mm.collapse === 'function' && (rec.stage >= 2 || rec.H >= (this.ccfg.lowFrom || 40))) mm.collapse(C.x0, C.z0, C.x1, C.z1, flatTop);
      // 屋上の対空の陣地は倒れた建物と一緒に無くなる（空中から撃ち続けない。b17 の検証 S7）
      if (g.airDefense && typeof g.airDefense.collapse === 'function') g.airDefense.collapse(C, true);
      if (this.rubble) this.rubble.dirty = true; // がれきの見た目を詰め直す（外す範囲の上の山・止まった破片を描かない = R1）
      // 外す範囲の中の板（焦げ・えぐれ・むき出しのれんが・割れた窓・ひび）は宙に浮くので消す（穴と同じ。b17 の検証 B2 (c)）
      const RB = { x0: C.x0, x1: C.x1, z0: C.z0, z1: C.z1, y0: C.y0 - 0.1, y1: (rec.top || C.y0) + 6 };
      if (this.chips) this.chips.clearIn(RB, 0.6); if (this.exposed) this.exposed.clearIn(RB, 0.6); if (this.windows) this.windows.clearIn(RB, 0.6); // 0.6: 壁の板は面の 0.3 m 外
      this.decals.clearIn(RB, 0.6);
      if (g.crashes && typeof g.crashes.clearScorchIn === 'function') g.crashes.clearScorchIn(RB, 0.6);
      const rest = () => {
        { // 家具と扉はどの倒壊でも建物ごと外す（一部の倒壊でも上の階の家具が宙に残って弾を止めた = B2 (e)。範囲だけ切る R4 は
          //   家具の階の箱の番号 b0 / b1 がずれて safeSpot が投げた = ビルド 17 は建物ごと。範囲だけ切るのは次のビルド: RESUME.md）
          const key = rec.owner;
          if (this.world.furn && typeof this.world.furn.dropBuilding === 'function') this.world.furn.dropBuilding(rec.lid, key);
          if (this.world.doors && typeof this.world.doors.dropBuilding === 'function') this.world.doors.dropBuilding(rec.lid);
        }
        if (this.world.props) this.world.props.markDirty();
        this._takeLoot(rec);
        this._farAll(rec);
      };
      if (live) { if (rec.tall) this._tilt(rec); this._crush(rec); this._proxy(rec, built); (this.later || (this.later = [])).push(rest); }
      else rest();
    }
    _supportOverride() {
      const c = this.city;
      if (this._supOrig || typeof c.supportHeightAt !== 'function') return;
      const f0 = this._supOrig = c.supportHeightAt, self = this;
      c.supportHeightAt = function (x, z) {
        const h = f0.call(this, x, z);
        const r = self.collapsedAt(x, z, 0);
        if (!r) return h;
        const top = r.stage >= 2 && !r.tall ? r.y + r.mound : r.C.y0;
        return h == null ? h : Math.min(h, top);
      };
    }
    _takeLoot(rec) {
      const LW = this.game.play && this.game.play.loot;
      if (!LW || typeof LW.query !== 'function') return;
      // 外す範囲と、高い塔の上が倒れる所（_fallZone。地面の物も）
      const C = rec.C, Z = rec.tall && (rec.tiltX || rec.tiltZ) ? this._fallZone(rec) : null;
      const x0 = Math.min(C.x0, Z ? Z.x0 : C.x0), x1 = Math.max(C.x1, Z ? Z.x1 : C.x1), z0 = Math.min(C.z0, Z ? Z.z0 : C.z0), z1 = Math.max(C.z1, Z ? Z.z1 : C.z1);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2 + 1;
      const out = LW.query(cx, cz, r, [], undefined, undefined, true); // 取られた物も（戻らなくする。b17 の検証 L1）
      let n = 0;
      for (const it of out) {
        if (!it) continue;
        const inC = !(it.x < C.x0 - 0.3 || it.x > C.x1 + 0.3 || it.z < C.z0 - 0.3 || it.z > C.z1 + 0.3 || (it.y != null && it.y < C.y0 - 1.5));
        const inZ = Z && it.x > Z.x0 && it.x < Z.x1 && it.z > Z.z0 && it.z < Z.z1 && !(it.x > C.x0 && it.x < C.x1 && it.z > C.z0 && it.z < C.z1);
        if (!inC && !inZ) continue;
        if (LW.isTaken && LW.isTaken(it.id)) { if (LW.pin) LW.pin(it.id); continue; }
        if (LW.take(it.id, 'collapse') > 0) n++;
      }
      this.stats.collLoot = (this.stats.collLoot || 0) + n;
    }
    // 中・落ちる所の人と乗り物（倒れ始め = 予告の後）
    _crush(rec) {
      const g = this.game, C = rec.C, own = !!rec.own;
      const z = this._fallZone(rec);
      const yTop = rec.top + 2, yBot = C.y0 - (rec.stage >= 2 && !rec.tall ? 2 : 3.5);
      const inC = (p, m) => p.x > C.x0 - m && p.x < C.x1 + m && p.z > C.z0 - m && p.z < C.z1 + m && p.y > yBot && p.y < yTop;
      // 倒れる側の外（区画の外の地面・低い屋根）。区画の中は inC（C.y0 より下の残る塔の足元・ロビーは潰さない = b17 の検証 B3）
      const inZ = (p) => p.x > z.x0 && p.x < z.x1 && p.z > z.z0 && p.z < z.z1 && p.y < yTop && !(p.x > C.x0 && p.x < C.x1 && p.z > C.z0 && p.z < C.z1);
      const dir = this._crushDir || (this._crushDir = new THREE.Vector3(0, -1, 0));
      for (const e of g.enemies) {
        if (e.dead || e.removed || !(inC(e.pos, 0.3) || (rec.tall && inZ(e.pos)))) continue;
        e._collapseKill = own ? 'own' : 'other';
        if (e.takeDamage(1e5, dir) && own) { g._onKill(e, 'collapse'); if (g.hud && g.hud.hit) g.hud.hit(true); }
        this.stats.collKills = (this.stats.collKills || 0) + 1;
      }
      const ctx = g._vehicleCtx ? g._vehicleCtx() : null;
      for (const v of g.vehicles || []) {
        if (v.wrecked || v.sunk || !v.pos || v.carrier || !(inC(v.pos, 0.5) || (rec.tall && inZ(v.pos)))) continue; // carrier: VTOL の貨物室の車（機体が守る）
        if (v === g.vehicle && (v.kind === 'heli' || v.kind === 'jet' || v.kind === 'vtol') && !v.grounded) continue;
        if (typeof v.damage === 'function') { v.damage(1e5, ctx); this.stats.collVehicles = (this.stats.collVehicles || 0) + 1; }
      }
      const P = g.player;
      if (P && !P.dead && !(g.vehicle && (g.vehicle.kind === 'heli' || g.vehicle.kind === 'jet' || g.vehicle.kind === 'vtol'))) {
        if (inC(P.pos, 0) || (rec.tall && inZ(P.pos))) { g._playerHit(1e5, { kind: 'collapse' }); this.stats.collPlayer = 'killed'; }
        else if (inC(P.pos, this.ccfg.pushOut || 4)) {
          // 縁の近く: 一番近い外へ押し出す（少し痛い）
          const dx0 = P.pos.x - (C.x0 - 0.8), dx1 = (C.x1 + 0.8) - P.pos.x, dz0 = P.pos.z - (C.z0 - 0.8), dz1 = (C.z1 + 0.8) - P.pos.z;
          const m = Math.min(dx0, dx1, dz0, dz1);
          if (m > 0 && m < (this.ccfg.pushOut || 4) + 1) {
            if (m === dx0) P.pos.x = C.x0 - 0.8 - (this.ccfg.pushOut || 4) * 0 - 0.01; else if (m === dx1) P.pos.x = C.x1 + 0.8; else if (m === dz0) P.pos.z = C.z0 - 0.8; else P.pos.z = C.z1 + 0.8;
          }
          g._playerHit(this.ccfg.pushDamage || 15, { kind: 'collapse' });
          if (g.blastFx) g.blastFx.addDust(0.8);
          this.stats.collPlayer = 'pushed';
        }
      }
    }
    // 落ちる所: 外す範囲 + 高い塔の上が倒れる向きへ
    _fallZone(rec) {
      const C = rec.C, m = rec.tall ? Math.min(this.ccfg.fallMax || 25, (rec.top - C.y0) * 0.3) : 0;
      const tx = rec.tiltX || 0, tz = rec.tiltZ || 0;
      return { x0: C.x0 - (tx < 0 ? m : 0), x1: C.x1 + (tx > 0 ? m : 0), z0: C.z0 - (tz < 0 ? m : 0), z1: C.z1 + (tz > 0 ? m : 0) };
    }

    // 代わりの形: 外す箱を外す範囲 C で切った物（外壁・屋上だけ、大きい順に proxyBoxes 個）を同じ材質で 1 つの Group に。
    //   潰れる（scale.y → 0）・高い塔の上は倒れる向きへ傾く。描画は材質の数（2〜4）、fallSec 秒で捨てる
    // 代わりの形を作るジェネレーター（予告の間に 1 フレーム proxyMs ずつ = 倒れるフレームを短く）。yield ごとに proxyStep 個の箱
    *_proxyJob(rec) {
      yield; // 持ち主のチャンクがキャッシュに無いと _owner が chunkFull をその場で作る（作った予告のフレームでは走らせない = S8）
      const W = this.world, C = rec.C;
      const d = this._owner(rec.owner || this._ownerOf(rec));
      if (!d || typeof THREE === 'undefined' || !MR.CityGeo) return null;
      const eff = D().collapseEffect(d, rec);
      yield;
      // 当たり判定の効き目も先に（_sync の deriveAll が同じ記録の並びで覚えた物を使う）
      const own = rec.owner || this._ownerOf(rec), L0 = (this.reg.list(own) || []).filter((r) => r.k !== rec.k);
      D().deriveAll(d, L0.concat([rec]));
      yield;
      const pieces = [];
      for (const b of eff.remove) {
        if (b.cat !== 'exterior' && b.cat !== 'roof' && !(b.f & 16)) continue;
        const B = D().box(b);
        const x0 = Math.max(B.x0, C.x0), x1 = Math.min(B.x1, C.x1), z0 = Math.max(B.z0, C.z0), z1 = Math.min(B.z1, C.z1), y0 = Math.max(B.y0, C.y0), y1 = B.y1;
        if (x1 - x0 < 0.05 || z1 - z0 < 0.05 || y1 - y0 < 0.05) continue;
        pieces.push(Object.assign({}, b, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: y0, w: x1 - x0, d: z1 - z0, h: y1 - y0, dx: 7,
          base: b.base != null ? b.base : (b.y || 0), top0: b.top0 != null ? b.top0 : (b.y || 0) + b.h })); // 窓の段・1 階の店は元の箱から（b17 の検証 R5）
      }
      const cap = (this.mobile ? this.ccfg.proxyBoxesMobile : this.ccfg.proxyBoxes) || 300;
      if (pieces.length > cap) { pieces.sort((a, b) => b.w * b.h * b.d - a.w * a.h * a.d); pieces.length = cap; }
      const bufs = new Map();
      // opts: 外壁の材質（'cityFacade'）の頂点属性（world.js CityWorld.FACADE_OPTS。無いと aFac が 0 で真っ黒 = b17 の検証 B1）
      const Bf = (mat, grp, opts) => { const k = mat + '|' + grp; let q = bufs.get(k); if (!q) { q = new MR.CityGeo(Object.assign({ vcap: 256, q: false }, opts && opts.attrs ? { attrs: opts.attrs } : null)); q.mat = mat; q.grp = grp; bufs.set(k, q); } return q; };
      const step = this.ccfg.proxyStep || 40;
      for (let i = 0; i < pieces.length; i++) { W._fullBox(pieces[i], Bf); if ((i + 1) % step === 0) yield; }
      const list = [];
      for (const q of bufs.values()) {
        if (q.empty) continue;
        const mat = q.mat === 'cityFacade' ? W.facadeMat : W.mat(q.mat);
        if (!mat) continue;
        list.push([q.toGeometry(), mat]);
        yield;
      }
      // 外壁の主な材質（剥がれる外壁の板の色）
      const vol = new Map();
      for (const pc of pieces) if (pc.cat === 'exterior') vol.set(pc.mat, (vol.get(pc.mat) || 0) + pc.w * pc.d * pc.h);
      let mat = null, mv = 0;
      for (const [m, v] of vol) if (v > mv) { mv = v; mat = m; }
      return { list, boxes: pieces.length, mat };
    }
    // 点 p が倒れた区画の外す範囲の上（宙）か
    _floatAt(p) {
      if (!this.colls || !this.colls.length || !p) return false;
      const r = this.collapsedAt(p.x, p.z, 0.6); // 0.6: 壁の板は面の 0.3 m 外に置く（b17 の検証 R2）
      if (!r) return false;
      return p.y > (r.stage >= 2 && !r.tall ? r.y + r.mound + 0.3 : r.C.y0 + 0.3);
    }
    // ミニマップ（街の遊びが持つ = game.play.minimap。b17 の検証 S1: game.minimap は無かった）
    _mm() { const g = this.game; return (g.play && g.play.minimap) || g.minimap || null; }
    _ownerOf(rec) { const ck = this.city.chunkOf(rec.x, rec.z); return ck.cx + '_' + ck.cz; }
    // 予告の間に作り進める（w.job）。終わったら w.built
    _proxyPump(w, budget) {
      if (w.built || !w.job) return;
      if (!w._pumped) { w._pumped = true; w.job.next(); return; } // 最初の歩は先頭の yield だけ（次のフレームから chunkFull = R6）
      const t0 = now();
      while (now() - t0 < budget) {
        const r = w.job.next();
        if (r.done) { w.built = r.value || { list: [], boxes: 0 }; w.job = null; return; }
      }
    }
    // 倒れる向き: ダメージの寄った側（崩れた土台の側へ倒れる）。_crush の落ちる所（_fallZone）が使うので代わりの形より先に（b17 の検証 B3）
    _tilt(rec) {
      if (rec.tiltX || rec.tiltZ) return;
      const C = rec.C, px = (C.x0 + C.x1) / 2, pz = (C.z0 + C.z1) / 2;
      let tx = 0, tz = 0;
      const s = this.lotDmg.get(rec.lot);
      if (s && s.w > 0) { const hx = s.hx / s.w - px, hz = s.hz / s.w - pz; if (Math.abs(hx) > Math.abs(hz)) tx = Math.sign(hx) || 1; else tz = Math.sign(hz) || 1; }
      else tx = 1;
      rec.tiltX = tx; rec.tiltZ = tz;
    }
    // 倒れ始め: 作ってあった形（無ければ今作る）を Group に入れて落とす
    _proxy(rec, built) {
      const g = this.game, C = rec.C;
      if (!built) { const job = this._proxyJob(rec); let r; do { r = job.next(); } while (!r.done); built = r.value; }
      if (!built || !built.list.length) return;
      const px = (C.x0 + C.x1) / 2, pz = (C.z0 + C.z1) / 2, py = C.y0;
      this._tilt(rec);
      const tx = rec.tiltX, tz = rec.tiltZ;
      const grp = new THREE.Group();
      grp.name = 'dxCollapse';
      const hinge = rec.tall || rec.stage < 2;
      const ax = hinge ? (tx > 0 ? C.x1 : tx < 0 ? C.x0 : px) : px, az = hinge ? (tz > 0 ? C.z1 : tz < 0 ? C.z0 : pz) : pz;
      grp.position.set(ax, py, az);
      const geos = [];
      for (const [geo, mat] of built.list) {
        geos.push(geo);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(-ax, -py, -az);
        mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
        grp.add(mesh);
      }
      g.scene.add(grp);
      const Hc = rec.top - C.y0;
      const T = Math.min(this.ccfg.fallSecMax || 5, (this.ccfg.fallSec || 2.6) + Hc * 0.012);
      const CF = this.ccfg.fall || {};
      // 全部（低い建物）= 揺れてから自分の足元へ沈む（下の階から潰れる）、一部 = 傾いて沈む、高い塔の上 = 倒れる向きへ大きく傾きながら落ちる
      this.falls.push({ rec, grp, geos, t: 0, T: rec.tall ? T * (CF.tallK || 1.25) : T, H: Hc, tx, tz,
        tilt: hinge ? (rec.tall ? (CF.tallTilt || 0.55) : (CF.partialTilt || 0.5)) : 0, fx: 0, dx: 0, zone: this._fallZone(rec), wave: false,
        color: (g.blastFx && g.blastFx._wallColor) ? g.blastFx._wallColor(px, py, pz, built.mat) : null });
      this.stats.proxyBoxes = built.boxes; this.stats.proxyCalls = geos.length;
      const a = g.audio;
      if (a && typeof a.play === 'function') a.play('collapse_roar', { pos: { x: px, y: py + Math.min(Hc, 30) * 0.5, z: pz }, refDistance: 40, maxDistance: 2000, volume: 1, priority: 3 });
    }
    _fallStep(f, dt, cam) {
      const g = this.game, rec = f.rec, C = rec.C, CF = this.ccfg.fall || {};
      f.t += dt; f.fx -= dt; f.dx -= dt;
      const hold = CF.hold || 0.35; // 落ち始める前の揺れ（土台が折れる）
      const u = Math.min(1, f.t / f.T), v = Math.max(0, Math.min(1, (f.t - hold) / Math.max(0.1, f.T - hold))), e = Math.pow(v, CF.ease || 1.7);
      const px = (C.x0 + C.x1) / 2, pz = (C.z0 + C.z1) / 2, full = rec.stage >= 2 && !rec.tall;
      if (full) {
        // 自分の足元へ沈む: 高さ H だけ下がる（地面の下は描かれない）+ 少し潰れる（階が重なる）
        const sq = CF.squash || 0.35;
        f.grp.scale.y = Math.max(0.05, 1 - e * sq);
        f.grp.position.y = C.y0 - e * f.H * (1 - sq * 0.5) * (CF.sink || 1.05);
      } else {
        // 傾いて落ちる（蝶番は倒れる側の縁）: 塔の上は大きく倒れながら H × tallDrop 落ちる
        const a = f.tilt * e;
        f.grp.rotation.set(f.tz ? a * f.tz : 0, 0, f.tx ? -a * f.tx : 0);
        f.grp.scale.y = Math.max(0.3, 1 - e * (rec.tall ? 0.15 : 0.3));
        f.grp.position.y = C.y0 - e * f.H * (rec.tall ? (CF.tallDrop || 1.0) : 0.45);
      }
      if (v <= 0) { const sh = (CF.shake || 0.12); f.grp.position.x += (Math.random() - 0.5) * sh; f.grp.position.z += (Math.random() - 0.5) * sh; }
      f.grp.updateMatrixWorld(true);
      // 今の屋根の高さ（落ちていく上の縁）
      const topY = full ? f.grp.position.y + f.H * f.grp.scale.y : C.y0 + f.H * (1 - e * 0.5);
      const P2 = g._puffsObj ? g._puffsObj() : null, CW2 = this.ccfg.wave || {}, col2 = CW2.color || [0.5, 0.46, 0.4];
      const maxS = this.mobile ? (CW2.maxSizeMobile || 14) : (CW2.maxSize || 22), o2 = this._fo || (this._fo = {});
      if (f.fx <= 0 && v > 0 && u < 0.98) {
        f.fx = this.mobile ? (CF.everyMobile || 0.16) : (CF.every || 0.1);
        // 足元から湧き上がる土ぼこり（区画の縁の周り。上へ育つ = 建物の上は見えたまま、終わりに建物の高さほどに）
        if (P2 && MR.BlastFX) {
          for (let q = 0, nq = this.mobile ? 2 : 3; q < nq; q++) {
            const side = Math.floor(Math.random() * 4), w = Math.random();
            const x = side < 2 ? (side ? C.x1 + 1 : C.x0 - 1) : C.x0 + w * (C.x1 - C.x0), z = side >= 2 ? (side === 3 ? C.z1 + 1 : C.z0 - 1) : C.z0 + w * (C.z1 - C.z0);
            const ox = x - px, oz = z - pz, ol = Math.hypot(ox, oz) || 1, sz = Math.min(maxS, Math.max(8, f.H * (CF.dustK || 0.6))) * (0.7 + Math.random() * 0.5), j = 0.85 + Math.random() * 0.3;
            const up = (CF.dustUp || 3.5) + f.H * 0.05 * Math.random();
            MR.BlastFX._opt(o2, ox / ol * 4, up, oz / ol * 4, sz * (CF.dustGrow || 0.3), 0.25, 0.35, 0.78, col2[0] * j, col2[1] * j, col2[2] * j, Math.random() * 6.28);
            o2.fadeIn = 0.2; o2.wind = 1; o2.fadeOut = 8; o2.fog = 0.7;
            P2.spawn('smoke', x, C.y0 + sz * 0.4 + Math.random() * 2, z, sz, 20 + Math.random() * 10, o2);
          }
        }
        // 上の縁から外へはがれる外壁の板（外壁の色）と塊、がれきの雨
        const side = Math.floor(Math.random() * 4), w = Math.random();
        const nx = side === 0 ? -1 : side === 1 ? 1 : 0, nz = side === 2 ? -1 : side === 3 ? 1 : 0;
        const x = nx ? (nx < 0 ? C.x0 : C.x1) : C.x0 + w * (C.x1 - C.x0), z = nz ? (nz < 0 ? C.z0 : C.z1) : C.z0 + w * (C.z1 - C.z0);
        const yy = Math.max(C.y0 + 1, topY - 1.5);
        this._burst('dxSlab', x + nx * 0.6, yy, z + nz * 0.6, [1, 2], nx * (CF.peel || 5), 1.5, nz * (CF.peel || 5), f.color);
        this._burst('dxChunk', x + nx * 0.6, yy, z + nz * 0.6, [2, 4], nx * 3, 1, nz * 3, f.color);
        if (f.dx <= 0) { f.dx = 0.5; this._burst('dxChip', px + (Math.random() - 0.5) * (C.x1 - C.x0), yy + 3, pz + (Math.random() - 0.5) * (C.z1 - C.z0), [6, 10], 0, 0, 0); }
        if (g.blastFx && Math.random() < 0.35) g.blastFx.wall(x + nx * 0.3, Math.max(C.y0 + 1, yy - 3), z + nz * 0.3, nx, nz, 2.2, 'collapse');
      }
      if (cam) { const d = Math.hypot(cam.x - px, cam.z - pz); if (d < 250) g.rumble = Math.min(1.6, (g.rumble || 0) + (1 - d / 250) * dt * 1.2); }
      if (u >= 1) {
        this._dustWave(rec, f, cam);
        if (f.grp.parent) f.grp.parent.remove(f.grp);
        for (const q of f.geos) q.dispose();
        return true;
      }
      return false;
    }
    // 倒れ終わり: 通りを走る土ぼこりの波（大きな低い煙の輪）・柱・地響き・画面の土ぼこり・がれきの雨の音
    _dustWave(rec, f, cam) {
      const g = this.game, P = g._puffsObj ? g._puffsObj() : null, C = rec.C, CW = this.ccfg.wave || {};
      const px = (C.x0 + C.x1) / 2, pz = (C.z0 + C.z1) / 2, gy = rec.y;
      const R0 = Math.hypot(C.x1 - C.x0, C.z1 - C.z0) * 0.5;
      const k = Math.min(1.6, Math.max(0.6, f.H / 40));
      if (P) {
        const n = Math.round((this.mobile ? CW.nMobile || 20 : CW.n || 36) * Math.min(1, 0.6 + k * 0.4)), o = this._wo || (this._wo = {});
        const col = CW.color || [0.5, 0.46, 0.4], maxS = this.mobile ? (CW.maxSizeMobile || 14) : (CW.maxSize || 22);
        for (let i = 0; i < n; i++) {
          const a = (i + Math.random() * 0.7) / n * 6.283, sp = (CW.speed || 18) * (0.75 + Math.random() * 0.5) * Math.min(1.3, k);
          const j = 0.85 + Math.random() * 0.3;
          const gr = Math.min(1.2, maxS / 20), dr = CW.drag || 0.33, sz = Math.min(maxS, 8 + k * 4); // 地面に刺さらない（下の縁 = 地面）
          MR.BlastFX._opt(o, Math.cos(a) * sp, 0.2, Math.sin(a) * sp, gr, gr * dr * 0.5, dr, CW.alpha || 0.62, col[0] * j, col[1] * j, col[2] * j, Math.random() * 6.28);
          o.fadeIn = 0.25; o.wind = 1; o.fadeOut = 6;
          P.spawn('smoke', px + Math.cos(a) * R0 * 0.7, gy + sz * 0.42, pz + Math.sin(a) * R0 * 0.7, sz, (CW.life || 24) * (0.8 + Math.random() * 0.4), o);
        }
        for (let i = 0; i < (this.mobile ? 4 : 7); i++) {
          const gg = 0.42 + Math.random() * 0.1;
          MR.BlastFX._opt(o, (Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2, 1.2, 0.3, 0.3, 0.65, gg, gg * 0.94, gg * 0.86, Math.random() * 6.28);
          o.fadeIn = 0.3; o.wind = 1; o.fadeOut = 8; o.fog = 0.5;
          P.spawn('smoke', px + (Math.random() - 0.5) * R0, gy + 4 + i * f.H * 0.12, pz + (Math.random() - 0.5) * R0, Math.min(maxS, 10 + k * 4), 26 + Math.random() * 10, o);
        }
        this.stats.waveDust = n;
      }
      this._burst('dxSlab', px, gy + 2, pz, [4, 8], 0, 3, 0);
      this._burst('dxChunk', px, gy + 2, pz, [10, 16], 0, 4, 0);
      if (cam) {
        const d = Math.hypot(cam.x - px, cam.z - pz);
        if (d < 300) { g.shake = Math.min(2, (g.shake || 0) + (1 - d / 300) * 1.4); g.rumble = Math.min(1.6, (g.rumble || 0) + (1 - d / 300) * 1.2); }
        if (g.blastFx && d < (CW.screenDust || 80)) g.blastFx.addDust((1 - d / (CW.screenDust || 80)) * 1.2);
      }
      const a = g.audio;
      if (a && typeof a.play === 'function') a.play('debris_rain_' + (1 + Math.floor(Math.random() * 3)), { pos: { x: px, y: gy + 2, z: pz }, refDistance: 25, maxDistance: 600, volume: 1, priority: 2 });
      this.stats.waves = (this.stats.waves || 0) + 1;
    }

    // 遠景・LOD・スカイラインの頂点の高さを切る（区画の三角形 = 重心が矩形の中、または縁の上で外向きの法線）。近い順に少しずつ（farQ）
    _farAll(rec) {
      const S = this.world.streamer;
      if (!S) return;
      for (const l of S.lod.values()) if (l.out && l.out.mesh && this._farHit(l.out.mesh, rec.C)) this.farQ.push([this._farWatch(l.out.mesh.geometry), rec, null]);
      for (const s of S.sky.values()) if (s.mesh && this._farHit(s.mesh, rec.C)) this.farQ.push([this._farWatch(s.mesh.geometry), rec, null]);
    }
    // 待ち行列に入れる形: 切る前に捨てられたら印（捨てた形を切って覚えない）
    _farWatch(geo) {
      if (!geo.userData.dxWatch) { geo.userData.dxWatch = true; const f = () => { geo.userData.dxDead = true; geo.removeEventListener('dispose', f); }; geo.addEventListener('dispose', f); }
      return geo;
    }
    // メッシュの境界の箱が外す範囲 C の矩形にかかるか
    _farHit(m, C) { const bb = m.geometry && (m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox)); return !!bb && bb.max.x > C.x0 && bb.min.x < C.x1 && bb.max.z > C.z0 && bb.min.z < C.z1; }
    _onLodBuilt(rec, out) {
      if (!this.colls || !this.colls.length || !out || !out.mesh) return;
      for (const r of this.colls) if (this._farHit(out.mesh, r.C)) this.farQ.unshift([this._farWatch(out.mesh.geometry), r, null]); // 次のフレームから少しずつ。かかる区画だけ（b17 の検証 S3）
    }
    // 1 つのメッシュの頂点を切る: 区画の外す範囲の中の頂点に印（Uint8Array）→ 印のある三角形だけ区画の物か見て高さを切る。
    //   budget（ms）を超えたら止めて続きを返す（farQ に残す）。全部終わったら true
    _clampGeo(geo, rec, budget, st) {
      const pos = geo.attributes && geo.attributes.position;
      if (!pos || geo.userData.dxDead) return true;
      const t0 = now();
      let A = pos.array;
      const I = geo.index ? geo.index.array : null, n = I ? I.length : A.length / 3, nv = A.length / 3;
      const R = rec.R, C = rec.C, e = 0.06;
      const lim = rec.stage >= 2 && !rec.tall ? rec.y + rec.mound * 0.6 : C.y0;
      st = st || { v: 0, t: 0, k: 0, mark: null, any: false };
      if (!st.mark) st.mark = new Uint8Array(nv);
      const M = st.mark;
      for (; st.v < nv; st.v++) {
        const v = st.v, x = A[v * 3], z = A[v * 3 + 2];
        if (x >= C.x0 - e && x <= C.x1 + e && z >= C.z0 - e && z <= C.z1 + e && A[v * 3 + 1] > lim) { M[v] = 1; st.any = true; }
        if ((v & 8191) === 8191 && budget && now() - t0 > budget) { st.v++; return st; }
      }
      if (!st.any) return true;
      // 書く前に写す（スカイラインの配列は CityBake と共有。元は戻すとき用）。切る頂点のあるメッシュだけ
      if (!geo.userData.dxOwn) { geo.userData.dxOrig = pos.array; pos.array = A = pos.array.slice(); geo.userData.dxOwn = true;
        // 覚えるのは生きている形だけ（LOD は飛ぶたびに作っては捨てる = 捨てた形と元の配列を持ち続けていた。b17 の検証 S3）
        const set = this._clamped || (this._clamped = new Set());
        set.add(geo);
        const off = () => { set.delete(geo); geo.userData.dxOrig = null; geo.userData.dxDead = true; geo.removeEventListener('dispose', off); };
        geo.addEventListener('dispose', off);
        return st; }
      for (; st.t < n; st.t += 3) {
        const t = st.t;
        if ((t & 16383) === 16383 && budget && now() - t0 > budget) return st;
        const a = I ? I[t] : t, b = I ? I[t + 1] : t + 1, c = I ? I[t + 2] : t + 2;
        if (!(M[a] | M[b] | M[c])) continue;
        const ax = A[a * 3], az = A[a * 3 + 2], bx = A[b * 3], bz = A[b * 3 + 2], cx = A[c * 3], cz = A[c * 3 + 2];
        const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
        if (mx < R.x0 - e || mx > R.x1 + e || mz < R.z0 - e || mz > R.z1 + e) continue;
        let inside = mx > R.x0 + e && mx < R.x1 - e && mz > R.z0 + e && mz < R.z1 - e;
        if (!inside) {
          // 縁の上: 面の法線が区画の外を向いていれば区画の物（隣の区画の壁は中を向く）
          const ay = A[a * 3 + 1], by = A[b * 3 + 1], cy = A[c * 3 + 1];
          const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
          const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
          if (Math.abs(mx - R.x0) <= e) inside = nx < 0; else if (Math.abs(mx - R.x1) <= e) inside = nx > 0;
          else if (Math.abs(mz - R.z0) <= e) inside = nz < 0; else if (Math.abs(mz - R.z1) <= e) inside = nz > 0;
          if (!inside) continue;
        }
        if (M[a] && A[a * 3 + 1] > lim) { A[a * 3 + 1] = lim; st.k++; }
        if (M[b] && A[b * 3 + 1] > lim) { A[b * 3 + 1] = lim; st.k++; }
        if (M[c] && A[c * 3 + 1] > lim) { A[c * 3 + 1] = lim; st.k++; }
      }
      if (st.k) {
        pos.updateRange.offset = 0; pos.updateRange.count = -1; pos.needsUpdate = true; // 全部上げる（同じフレームに 2 回切ると範囲が 1 つしか持てない）
        if (geo.boundingSphere) geo.computeBoundingSphere();
      }
      this.stats.farVerts = (this.stats.farVerts || 0) + st.k;
      return true;
    }

    // 直す（ストーリーのやり直し・テスト）: 世界の更新を戻す
    _uncollapse(rec) {
      const g = this.game;
      const j = this.colls ? this.colls.indexOf(rec) : -1;
      if (j >= 0) this.colls.splice(j, 1);
      if (this.lotDmg) this.lotDmg.delete(rec.lot);
      if (g.heliCollider && typeof g.heliCollider.revive === 'function') g.heliCollider.revive(rec.lot, rec.C);
      if (g.airDefense && typeof g.airDefense.collapse === 'function') g.airDefense.collapse(rec.C, false);
      const mm = this._mm();
      if (mm && mm.flat) { const F = mm.flat, C = rec.C; for (let i = F.length - 1; i >= 0; i--) if (F[i][0] === C.x0 && F[i][1] === C.z0 && F[i][2] === C.x1 && F[i][3] === C.z1) F.splice(i, 1); mm.collapse(C.x0, C.z0, C.x1, C.z1, 1e9); mm.flat.pop(); }
      if (this.world.furn && this.world.furn.ctx && this.world.furn.ctx.skip) { this.world.furn.ctx.skip.delete(rec.lid); this.world.furn.dropBuilding && (this.world.furn.ctx.skip.delete(rec.lid), this.world.furn._remove(rec.owner), this.world.furn.cache.delete(rec.owner)); }
      if (this.world.doors && this.world.doors.skip) { this.world.doors.skip.delete(rec.lid); this.world.doors.byKey.clear(); this.world.doors.active.clear(); }
      // 遠景: 切る前の頂点に戻して、残りの倒れた区画をもう一度
      for (const geo of this._clamped || []) {
        const pos = geo.attributes.position;
        if (!geo.userData.dxOrig) continue;
        pos.array.set(geo.userData.dxOrig); pos.updateRange.count = -1; pos.needsUpdate = true;
        for (const r of this.colls || []) this.farQ.push([geo, r, null]);
      }
      if (this.world.props) this.world.props.markDirty();
    }
    // 近景: 倒れた区画の外す範囲 C の三角形を縮める。頂点 3 つが C の矩形（± 0.25）の中で一番上の頂点が C.y0 より上・縁の面は
    //   法線が外を向くもの（隣の区画の壁は中を向く）。C の上を通る箱の残りは 'dx' の形が描く（Destruct.collapseEffect の引き算）
    _collapseRegion(out, recs) {
      if (!out || !out.root) return 0;
      let n = 0;
      out.root.traverse((m) => {
        if (!m.isMesh || !m.geometry || !m.geometry.index || m.userData.dx || (m.parent && m.parent.userData && m.parent.userData.dx)) return;
        const geo = m.geometry;
        const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
        const A = geo.attributes.position.array, I = geo.index.array, end = geo.userData.segs && geo.userData.segs.length ? geo.userData.segs[0][3] : (geo.drawRange && geo.drawRange.count < I.length ? Math.min(I.length, geo.drawRange.count) : I.length);
        let k = 0;
        for (const r of recs) {
          const C = r.C, e = 0.25;
          if (bb && (bb.max.x < C.x0 - e || bb.min.x > C.x1 + e || bb.max.z < C.z0 - e || bb.min.z > C.z1 + e || bb.max.y < C.y0)) continue;
          const x0 = C.x0 - e, x1 = C.x1 + e, z0 = C.z0 - e, z1 = C.z1 + e, y0 = C.y0 + 0.02;
          for (let t = 0; t < end; t += 3) {
            const a = I[t], ax = A[a * 3];
            if (ax < x0 || ax > x1) continue;
            const az = A[a * 3 + 2];
            if (az < z0 || az > z1) continue;
            const b = I[t + 1], c = I[t + 2];
            if (a === b && b === c) continue;
            const bx = A[b * 3], bz = A[b * 3 + 2], cx = A[c * 3], cz = A[c * 3 + 2];
            if (bx < x0 || bx > x1 || cx < x0 || cx > x1 || bz < z0 || bz > z1 || cz < z0 || cz > z1) continue;
            const ay = A[a * 3 + 1], by = A[b * 3 + 1], cy = A[c * 3 + 1];
            if (ay <= y0 && by <= y0 && cy <= y0) continue;
            // 縁の上の面: 法線が外を向く物だけ（区画の矩形 R の縁）
            const R = r.R, mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3, ee = 0.06;
            if (Math.abs(mx - R.x0) <= ee || Math.abs(mx - R.x1) <= ee || Math.abs(mz - R.z0) <= ee || Math.abs(mz - R.z1) <= ee) {
              const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
              const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
              let own = true;
              if (Math.abs(mx - R.x0) <= ee) own = nx < 0; else if (Math.abs(mx - R.x1) <= ee) own = nx > 0;
              else if (Math.abs(mz - R.z0) <= ee) own = nz < 0; else own = nz > 0;
              if (!own) continue;
            }
            I[t + 1] = a; I[t + 2] = a; k++;
          }
        }
        if (k) { geo.index.needsUpdate = true; n += k; }
      });
      return n;
    }
    // 近景: 倒れた区画のスロープ（階段）の三角形を縮める（頂点 3 つがスロープの箱の中。1 回なめる）
    _collapseRamps(out, ramps) {
      if (!ramps || !ramps.size || !out || !out.root) return 0;
      const R = [];
      for (const q of ramps) { const lo = Math.min(q.y0, q.y1) - (q.t || 0.3) - 0.05, hi = Math.max(q.y0, q.y1) + 0.05; R.push([q.x - q.w / 2 - 0.05, q.z - q.d / 2 - 0.05, q.x + q.w / 2 + 0.05, q.z + q.d / 2 + 0.05, lo, hi]); }
      let n = 0;
      out.root.traverse((m) => {
        if (!m.isMesh || !m.geometry || !m.geometry.index || m.userData.dx || (m.parent && m.parent.userData && m.parent.userData.dx)) return;
        const geo = m.geometry, A = geo.attributes.position.array, I = geo.index.array, end = geo.userData.segs && geo.userData.segs.length ? geo.userData.segs[0][3] : I.length;
        let k = 0;
        for (let t = 0; t < end; t += 3) {
          const a = I[t], b = I[t + 1], c = I[t + 2];
          if (a === b && b === c) continue;
          for (const r of R) {
            let ok = true;
            for (const v of [a, b, c]) { const x = A[v * 3], y = A[v * 3 + 1], z = A[v * 3 + 2]; if (x < r[0] || x > r[2] || z < r[1] || z > r[3] || y < r[4] || y > r[5]) { ok = false; break; } }
            if (ok) { I[t + 1] = a; I[t + 2] = a; k++; break; }
          }
        }
        if (k) { geo.index.needsUpdate = true; n += k; }
      });
      return n;
    }
    // 描画の数（破片・板・出来上がっている近景の 'dx' の形の材質の数）
    dxMeshes() {
      let n = 0;
      const S = this.world.streamer;
      if (S) for (const r of S.full.values()) if (r.out && r.out.dxGroup) n += r.out.dxGroup.children.length;
      return n;
    }
    // 梯子が無くなった敵: 登るのをやめて落ちる（_settle → _fall）、経路は次のフレームで引き直す
    static releaseClimb(e) {
      e.climb = null; e.grounded = false; e.vy = 0; e.path = null; e.repathAt = 0;
    }
    drawCalls() { return (this.debris ? this.debris.drawCalls() : 0) + this.decals.drawCalls() + (this.exposed ? this.exposed.drawCalls() : 0) + (this.windows ? this.windows.drawCalls() : 0) + (this.chips ? this.chips.drawCalls() : 0) + this.dxMeshes() + (this.rubble ? this.rubble.drawCalls() : 0); }

    // DEBUG の左上の行: 記録（小物 / 穴 / 給水塔）・破片・板・描画・1 回の当たり / 歩行グラフの ms の最大
    debugText() {
      const st = this.stats, d = this.debris;
      return '  dx ' + this.reg.size + ' (p' + st.props + ' b' + st.breaches + ' t' + st.tanks + ')' + (this.solid ? '' : ' cosmetic') + ' deb ' + (d ? d.n + '/' + d.cap : '-') +
        ' dec ' + this.decals.n + ' calls ' + this.drawCalls() + ' hit ' + st.hitMsMax.toFixed(1) + ' graph ' + st.graphMsMax.toFixed(1);
    }

    // 今の記録の鍵（ストーリーのチェックポイント。b16）
    keys() { return Array.from(this.reg.recs.keys()); }
    // 今の記録（鍵 → 記録）。rollback に渡すと、チェックポイントの後に大きな穴に入れ替わった前の穴も元に戻す（b16.1）
    checkpoint() {
      const m = new Map(this.reg.recs);
      m.dead = new Map(); // 壊れた升（銃の穴の育ち方）も
      for (const [k, S] of this.dead) m.dead.set(k, new Set(S));
      return m;
    }
    // keep（鍵の配列か Set、または checkpoint() の Map）に無い記録を直す = チェックポイントの後に壊した物を戻す（当たり判定・歩行グラフ・近景の形・小物）。
    //   Map なら、その後に外れた記録（銃の穴が育って入れ替わった前の穴）を加え直す。直した数 + 戻した数
    rollback(keep) {
      const M = keep instanceof Map ? keep : null;
      const K = M || (keep instanceof Set ? keep : new Set(keep || []));
      let n = 0;
      for (const k of Array.from(this.reg.recs.keys())) {
        if (K.has(k) && (!M || M.get(k) === this.reg.get(k))) continue; // Map: 同じ鍵の別の記録（上へだけ育った銃の穴）も直す
        const r = this.reg.remove(k);
        if (!r) continue;
        this.pending.delete(r);
        this._repairRec(r);
        n++;
      }
      if (M) for (const [k, r] of M) {
        if (this.reg.has(k)) continue;
        if (!this.reg.add(r, r.owner, r.t, (v) => this._repairRec(v))) continue;
        // 上限で外したときに遠景の箱（reg.far）に残した穴を加え直した: その遠景の箱は外す（二重にしない）
        if (r.type === 'breach' && r.R && this.reg.far) {
          const F = this.reg.far, R = r.R, e = 0.02;
          for (let i = F.length - 1; i >= 0; i--) { const q = F[i]; if (Math.abs(q[0] - R.x0) < e && Math.abs(q[1] - R.y0) < e && Math.abs(q[2] - R.z0) < e && Math.abs(q[3] - R.x1) < e && Math.abs(q[4] - R.y1) < e && Math.abs(q[5] - R.z1) < e) F.splice(i, 1); }
        }
        if (!(r.rm >= 0) && r.type !== 'crater') this.pending.add(r);
        if ((r.type === 'prop' || r.type === 'tank') && this.world.props) this.world.props.markDirty();
        if (r.type === 'collapse' && this._collInit()) this._applyColl(r, false);
        this._changed(r.owner, r);
        n++;
      }
      if (M && M.dead) { this.dead.clear(); for (const [k, S] of M.dead) this.dead.set(k, new Set(S)); }
      this.gunQ.clear(); // 撃って待っている升は戻した後の壁には要らない（n 0 でも。b16.1）
      if (n) { this.cells.clear(); this.stats.rolledBack = (this.stats.rolledBack || 0) + n; } // 途中まで撃った升（ひび）も忘れる。銃の穴の升（dead）は _repairRec が外す
      return n;
    }

    // 続きから（session の dz）: 近い n 個の記録と直るまでの秒
    capture(x, z) { return this.reg.snapshot(x, z, this.game.time || 0, this.cfg.sessionKeys > 0 ? this.cfg.sessionKeys : this.caps.records); }
    restore(list) {
      if (!this.solid || !Array.isArray(list)) return 0;
      const n = this.reg.restore(list, this.game.time || 0);
      // 読み込んであるチャンクは今すぐ（当たり判定）+ 形の待ち行列。小物の寸法は今の設定から
      const PR = this.cfg.props || {};
      for (const r of this.reg.recs.values()) if ((r.type === 'prop' || r.type === 'tank') && PR[r.ptype]) r.dims = PR[r.ptype].dims || null;
      for (const r of this.reg.recs.values()) if (!(r.rm >= 0) && r.type !== 'crater') this.pending.add(r); // 古い snap: がれきは読めたら決める
      for (const r of this.reg.recs.values()) if (r.type === 'collapse' && this._collInit()) this._applyColl(r, false);
      for (const owner of Array.from(this.reg.owners.keys())) this._sync(owner, this.reg.list(owner).slice());
      if (this.world.props) this.world.props.markDirty();
      return n;
    }

    dispose() {
      this._glQ = null; this._gbQ = null;
      this._brQ = null; this._sq = null; this._pq = null;
      if (this._supOrig && this.city) { if (this.city.supportHeightAt !== this._supOrig) delete this.city.supportHeightAt; this._supOrig = null; } // 街は次のゲームと共有
      if (this.falls) { for (const f of this.falls) { if (f.grp.parent) f.grp.parent.remove(f.grp); for (const q of f.geos) q.dispose(); } this.falls.length = 0; }
      if (this.world.streamer && this.world.streamer.onLodBuilt) this.world.streamer.onLodBuilt = null;
      if (this.warns) this.warns.length = 0; if (this.colls) this.colls.length = 0; if (this.farQ) this.farQ.length = 0;
      if (this.nav && this.nav.dxFilter) this.nav.dxFilter = null;
      if (this.world.streamer && this.world.streamer.onFullBuilt) this.world.streamer.onFullBuilt = null;
      if (this.world.props && this.world.props.hide) this.world.props.hide = null;
      if (this.debris) this.debris.dispose();
      if (this.rubble) this.rubble.dispose();
      this.pending.clear(); if (this.soon) this.soon.length = 0; this.cells.clear(); this.dead.clear(); this.gunQ.clear(); this.gunLast.clear();
      this.decals.dispose();
      if (this.chips) { this.chips.dispose(); this.chips = null; }
      if (this.exposed) { this.exposed.dispose(); this.exposed = null; }
      if (this.windows) { this.windows.dispose(); this.windows = null; }
      this.reg.clear();
      this.jobs.length = 0; this.meshQueue.length = 0; this.applied.clear(); this.cosm.clear();
      for (const A of this.anims) if (A.grp.parent) A.grp.parent.remove(A.grp); // 形・材質は CityProps の物（捨てない）
      this.anims.length = 0;
      this.disposed = true;
    }
  };
})();
