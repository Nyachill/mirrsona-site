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
//   直す: 持ち主のチャンクが近景に repairAfter 秒無ければ記録を消す（次に読むときは元の形）。
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
        // 角ばった塊（12 三角形、頂点の位置で決まるゆがみ）
        const g = new THREE.BoxBufferGeometry(1, 0.7, 0.85);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, f = h - Math.floor(h);
          pos.setXYZ(i, x * (0.7 + f * 0.6), y * (0.8 + f * 0.4) + x * z * 0.3, z * (1.15 - f * 0.4));
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
        const c = this._rgb(K.color || '#8d877d'), j = 0.85 + Math.random() * 0.3;
        this.cr[i] = c[0] * j; this.cg[i] = c[1] * j; this.cb[i] = c[2] * j;
        if (K.flat > 0) this.sy[i] = this.sx[i] * K.flat;
        return i;
      }
      _kill(i) {
        const j = this.n - 1;
        if (i !== j) { this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j]; }
        super._kill(i);
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
    constructor(scene, cap) {
      this.scene = scene; this.cap = Math.max(4, cap | 0 || 64);
      this.mesh = null; this.n = 0; this.next = 0;
      this.stats = { added: 0 };
    }
    _tex() {
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
    _build() {
      if (this.mesh) return;
      const g = new THREE.PlaneBufferGeometry(1, 1);
      const mat = new THREE.MeshLambertMaterial({ map: this._tex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const mesh = new THREE.InstancedMesh(g, mat, this.cap);
      if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = 2;
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.name = 'dxDecals';
      this.scene.add(mesh);
      this.mesh = mesh;
      this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
      this._z = new THREE.Vector3(0, 0, 1); this._n = new THREE.Vector3(); this._r = new THREE.Quaternion();
    }
    // 点 p に、法線 n を向いた大きさ s の板（いっぱいなら一番古い物を上書き）
    add(p, n, s) {
      if (typeof THREE === 'undefined') return;
      this._build();
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      if (this.n < this.cap) this.n++;
      this._n.set(n.x, n.y, n.z).normalize();
      this._q.setFromUnitVectors(this._z, this._n);
      this._r.setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
      this._q.multiply(this._r);
      this._p.set(p.x + this._n.x * 0.03, p.y + this._n.y * 0.03, p.z + this._n.z * 0.03);
      this._s.set(s, s, 1);
      this._m.compose(this._p, this._q, this._s);
      this._m.toArray(this.mesh.instanceMatrix.array, i * 16);
      this.mesh.count = this.n;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.stats.added++;
    }
    clear() { this.n = 0; this.next = 0; if (this.mesh) this.mesh.count = 0; }
    drawCalls() { return this.mesh && this.n > 0 ? 1 : 0; }
    dispose() {
      if (!this.mesh) return;
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose(); if (this.mesh.material.map) this.mesh.material.map.dispose(); this.mesh.material.dispose();
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
      const caps = Object.assign({ records: 3000, debris: 400, decals: 96 }, cfg.caps || {}, M.caps || {});
      this.caps = caps;
      this.online = !!game.online;
      this.solid = !this.online || cfg.online === true; // 当たり判定を変えるか（オンラインは変えない: DS14b）
      this.reg = new (D().Registry)({ cap: caps.records, repairAfter: cfg.repairAfter });
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
      if (this.world.props) this.world.props.hide = (p) => this._propHidden(p);
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
    _propHidden(p) { return this.reg.props.size > 0 && this.reg.props.has(this._pkey(p)); }

    // 読み込んであるチャンクのデータ（無ければ null。作らない）
    _chunk(cx, cz) {
      const c = this.world.cache;
      const d = c && c.map && c.map.get(cx + '_' + cz);
      return d && d.full ? d.full : null;
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
      const t0 = now(), C = this.cfg;
      this.stats.hits++;
      this._batch = new Map(); // 持ち主 → 変わった記録（当たりの最後に 1 回ずつ _sync）
      try { return this._hit(info, t0, C); } finally {
        const B = this._batch;
        this._batch = null;
        if (B) for (const [owner, recs] of B) this._sync(owner, recs);
        const ms = now() - t0;
        this.stats.hitMs = ms; if (ms > this.stats.hitMsMax) this.stats.hitMsMax = ms;
      }
    }
    _hit(info, t0, C) {
      const R = info.radius > 0 ? info.radius : 1, Dm = info.damage || 0, edge = info.edge == null ? 0.6 : info.edge;
      const at = (d) => Dm * Math.max(0, 1 - d / R * edge);
      let n = 0;
      // 小物（T1）と給水塔（T3a）
      const PR = C.props || {};
      const brk = [];
      this._around(info.x, info.z, R, (d) => {
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
      for (const [d, p, rule, dmg] of brk) if (this._damageProp(d, p, rule, dmg, info)) n++;
      // 壁（T2）とえぐれ
      if (info.kind === 'missile' || info.kind === 'vehicle' || info.kind === 'gun' || info.kind === 'blast') n += this._wall(info, R, at);
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
      this._changed(d.key, rec);
      if (this.world.props) this.world.props.markDirty();
      return true;
    }

    burst(kit, x, y, z, n, vx, vy, vz) { this._burst(kit, x, y, z, n, vx, vy, vz); }
    _burst(kit, x, y, z, n, vx, vy, vz) {
      if (!this.debris) return;
      const K = this.debris._kit(kit);
      if (Array.isArray(n)) n = n[0] + Math.floor(Math.random() * (n[1] - n[0] + 1));
      this.debris.burst(K, x, y, z, n == null ? null : n, vx, vy, vz);
    }
    // 音は今ある物（impact_concrete / impact_metal / debris_metal。plan: 新しい音は work/knife の A0 の decode group 'destruct' が入ってから）
    _sound(name, p, rate) {
      const a = this.game.audio;
      if (a && typeof a.play === 'function') a.play(name, { pos: p, refDistance: 6, maxDistance: 120, priority: 1, rate: (rate || 1) * (0.9 + Math.random() * 0.2) });
    }

    // 穴の計画 rec（R = 穴の箱）が今出ている自動ドアの開口（同じ壁の面・横と高さが重なる）にかかるか
    _onDoor(rec) {
      const D = this.world.doors, list = D && D.list;
      if (!list || !list.length) return false;
      const R = rec.R, m = 0.3;
      for (const d of list) {
        const hw = (d.w || 2) / 2, ux = Math.abs(d.ux || 0), uz = Math.abs(d.uz || 0);
        const x0 = d.x - ux * hw - m, x1 = d.x + ux * hw + m, z0 = d.z - uz * hw - m, z1 = d.z + uz * hw + m;
        if (x1 < R.x0 - m || x0 > R.x1 + m || z1 < R.z0 - m || z0 > R.z1 + m) continue;
        if (d.y + (d.h || 2.5) < R.y0 || d.y > R.y1) continue;
        return true;
      }
      return false;
    }

    // 壁: 入れる建物の外壁 → 穴（T2）、入れない建物・地面・高架 → えぐれ（見た目だけ）
    _wall(info, R, at) {
      const C = this.cfg, BC = C.breach || {};
      const reach = Math.min(BC.reach > 0 ? BC.reach : 2.5, R * 0.5);
      const hit = this._tmp; hit.x = info.x; hit.y = info.y; hit.z = info.z;
      let best = null, bd = Infinity;
      // 一番近い入れる建物の外壁（持ち主のチャンク）
      if (info.kind !== 'gun') {
        this._around(info.x, info.z, reach, (d) => {
          const ix = this._idx(d);
          if (!ix.shell.length || !Destruction._near(ix.sbb, info.x, info.z, reach + 0.5)) return;
          const near = this._shellNear(ix, hit.x, hit.y, hit.z, reach + 0.1);
          if (!near.length) return;
          const rec = D().planBreach(near, hit, { width: BC.width, height: BC.height, reach, wall: BC.wall, rubbleH: BC.rubbleH, minFace: BC.minFace });
          if (!rec) return;
          const dd = Math.hypot(rec.ax === 'x' ? rec.x - hit.x : 0, rec.ax === 'z' ? rec.z - hit.z : 0);
          if (dd < bd) { bd = dd; best = [d, rec]; }
        });
      }
      // 自動ドア（doors.js）の開口にかかる穴は開けない（扉の板が穴の中に浮いて残る）: えぐれにする
      if (best && this._onDoor(best[1])) { best = null; this.stats.doorSkips = (this.stats.doorSkips || 0) + 1; }
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
        if (!this.solid) { this.stats.cosmetic++; return 1; }
        if (!this.reg.add(rec, d.key, this.game.time || 0, (v) => this._repairRec(v))) return 0;
        this.stats.breaches++;
        this._changed(d.key, rec);
        this._repT = 0; // 次の update で穴の箱を遠景・家具の材質へ（_farCuts）
        return 1;
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
        const s = (info.kind === 'gun' ? (CC.gunSize || 0.9) : (CC.size || 3.4)) * (0.8 + Math.random() * 0.4);
        // 上を向いた面（地面・屋上）の焦げは jets の E3 の焦げ（MR.Crashes の InstancedMesh。fire.scorch.sec で消える）へ。壁のえぐれはこちらの decals
        const cr = this.game.crashes;
        //   乗り物の爆発・墜落（kind 'vehicle'）は crashfx の plan がもう焦げを置いているので二重にしない
        if (n.y > 0.7 && cr && typeof cr.addScorch === 'function') {
          if (info.kind !== 'vehicle') { cr.addScorch(info.x, gy, info.z, s * 0.5); this.stats.scorchE3 = (this.stats.scorchE3 || 0) + 1; }
        } else this.decals.add(info, n, s);
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
      else this._sync(owner, [rec]);
    }
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
          // 変わった所: 変わった記録の矩形（壁の穴の R・小物の周り）
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (const r of changed || []) {
            const R = r.type === 'breach' ? r.R : { x0: r.x - (r.r || 1) - 0.3, z0: r.z - (r.r || 1) - 0.3, x1: r.x + (r.r || 1) + 0.3, z1: r.z + (r.r || 1) + 0.3 };
            if (R.x0 < x0) x0 = R.x0; if (R.z0 < z0) z0 = R.z0; if (R.x1 > x1) x1 = R.x1; if (R.z1 > z1) z1 = R.z1;
          }
          const region = x1 >= x0 ? { x0, z0, x1, z1 } : null;
          const r = (rm.size || ad.length || lrm.size || lad.length) ? nav.dxApply(owner, rm, ad, region, lrm, lad) : null;
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
          if (want === Destruction.EMPTY) this.applied.delete(owner); else this.applied.set(owner, want);
          if (r) {
            const inf = (nav.inflate || 0.45) + 1;
            this.jobs.push(nav.dxRegraph(r.x0 - inf, r.z0 - inf, r.x1 + inf, r.z1 + inf));
          }
        }
      }
      const ms = now() - t0;
      this.stats.navMs = ms; if (ms > this.stats.navMsMax) this.stats.navMsMax = ms;
      const S = this.world.streamer, fr = S && S.full.get(owner);
      if (fr && fr.out && !this.meshQueue.includes(owner)) this.meshQueue.push(owner);
    }

    // 直す（上限・時間）: 記録はもう消えている。読み込んであれば当たり判定と形を今の記録に合わせる
    _repairRec(rec) {
      this.stats.repaired++;
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
        if (miss.length > 1) {
          if (restart) out.dxState = null;
          this._triIndex(miss[0].geometry);
          if (!this.meshQueue.includes(key)) this.meshQueue.unshift(key);
          return;
        }
      }
      if (rm.length) this.stats.tris += this._collapse(out, rm);
      for (const l of want.ladders) if (!bL.has(lk(l))) this.stats.tris += this._collapseLadder(out, l);
      if (want.add !== out.dxAddFor) { this._dxGroup(out, want.add); out.dxAddFor = want.add; } // 'dx' の形は作った元を覚えて比べる（dxState とは別）
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
        const shell = (b.f & 16) !== 0;
        if ((mat === 'limestone' || mat === 'concrete') && !shell && ((b.cat === 'exterior') || (b.cat === 'landmark' && b.h >= 12 && Math.min(b.w, b.d) >= 6))) mat = mat === 'limestone' ? 'limestone_win' : 'concrete_win';
        if (W.materials && W.materials.has && !W.materials.has(mat)) mat = 'concrete';
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
    _triIndex(geo) {
      if (geo.userData.dxIdx) return geo.userData.dxIdx;
      const ia = geo.index.array, pa = geo.attributes.position.array, na = geo.attributes.normal ? geo.attributes.normal.array : null;
      const segs = geo.userData.segs, end = segs && segs.length ? segs[0][3] : ia.length;
      const m = new Map();
      for (let t = 0; t + 2 < end; t += 3) {
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
      geo.userData.dxIdx = m;
      return m;
    }
    _unpatch(out) {
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
      if (!add.length) return;
      const bufs = new Map();
      const B = (mat, grp) => {
        const k = mat + '|' + grp;
        let g = bufs.get(k);
        if (!g) { g = new MR.CityGeo({ vcap: 256, q: true }); g.mat = mat; g.grp = grp; bufs.set(k, g); }
        return g;
      };
      for (const b of add) {
        W._fullBox(b, B);
      }
      const grp = new THREE.Group();
      grp.name = 'dx'; grp.matrixAutoUpdate = false; grp.userData.dx = true;
      for (const g of bufs.values()) {
        if (g.empty) continue;
        const mat = W.mat(g.mat);
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

    // ---------- 毎フレーム ----------
    update(dt) {
      const g = this.game;
      const cam = g.mainCamera ? g.mainCamera.position : g.camera.position;
      if (this._warmLeft > 0) {
        if (this._warmLeft === 3) {
          if (this.debris) this.debris.spawn(this.debris._kit('concrete'), { x: cam.x, y: cam.y - 60, z: cam.z }, { x: 0, y: 0, z: 0 }, 0, 0.3);
          if (!this.decals.n) { this.decals.add({ x: cam.x, y: cam.y - 60, z: cam.z }, { x: 0, y: 1, z: 0 }, 0.01); this._warmDecal = true; }
        }
        if (--this._warmLeft === 0 && this._warmDecal && this.decals.n === 1) { this.decals.clear(); this.decals.stats.added = 0; }
      }
      if (this.debris) this.debris.update(dt, cam);
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
      // 近景の形（1 フレームに 1 チャンク）
      if (this.meshQueue.length) this._patchMesh(this.meshQueue.shift());
      // 乗り物でぶつかる（はねる）
      if (this.cfg.ram !== false) this._rams();
      // 見ている持ち主・直す（1 秒ごと）
      this._repT -= dt;
      if (this._repT <= 0) {
        this._repT = 1;
        const S = this.world.streamer, t = g.time || 0;
        if (S) for (const r of S.full.values()) if (r.state === 'built') this.reg.touch(r.key, t);
        this.reg.repair(t, (rec) => this._repairRec(rec));
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
      list.sort((a, b) => a[0] - b[0]);
      const c0 = U.uCut0.value, c1 = U.uCut1.value;
      if (U.uCutN) U.uCutN.value = Math.min(c0.length, list.length);
      for (let i = 0; i < c0.length; i++) {
        const r = list[i] && list[i][1];
        if (!r) { c0[i].set(1, 1, 1); c1[i].set(0, 0, 0); continue; }
        const R = r.R, e = 0.25;
        c0[i].set(R.x0 - e, R.y0, R.z0 - e); c1[i].set(R.x1 + e, R.y1, R.z1 + e);
      }
      // 家具と壁の内張り（interiors_view.js の uDxC0 / uDxC1）: 同じ近い穴の箱（外へ 0.25 m = 部屋の側 2 cm の内張りが入る）
      const IV = this.world.furnView, IU = IV && IV.U;
      if (IU && IU.uDxC0) {
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
        if (v.wrecked || v.sunk || v.kind === 'jet' || v.kind === 'heli' || v.kind === 'boat' || !v.def) continue;
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
    drawCalls() { return (this.debris ? this.debris.drawCalls() : 0) + this.decals.drawCalls() + this.dxMeshes(); }

    // DEBUG の左上の行: 記録（小物 / 穴 / 給水塔）・破片・板・描画・1 回の当たり / 歩行グラフの ms の最大
    debugText() {
      const st = this.stats, d = this.debris;
      return '  dx ' + this.reg.size + ' (p' + st.props + ' b' + st.breaches + ' t' + st.tanks + ')' + (this.solid ? '' : ' cosmetic') + ' deb ' + (d ? d.n + '/' + d.cap : '-') +
        ' dec ' + this.decals.n + ' calls ' + this.drawCalls() + ' hit ' + st.hitMsMax.toFixed(1) + ' graph ' + st.graphMsMax.toFixed(1);
    }

    // 続きから（session の dz）: 近い n 個の記録と直るまでの秒
    capture(x, z) { return this.reg.snapshot(x, z, this.game.time || 0, this.cfg.sessionKeys > 0 ? this.cfg.sessionKeys : 600); }
    restore(list) {
      if (!this.solid || !Array.isArray(list)) return 0;
      const n = this.reg.restore(list, this.game.time || 0);
      // 読み込んであるチャンクは今すぐ（当たり判定）+ 形の待ち行列。小物の寸法は今の設定から
      const PR = this.cfg.props || {};
      for (const r of this.reg.recs.values()) if ((r.type === 'prop' || r.type === 'tank') && PR[r.ptype]) r.dims = PR[r.ptype].dims || null;
      for (const owner of Array.from(this.reg.owners.keys())) this._sync(owner, this.reg.list(owner).slice());
      if (this.world.props) this.world.props.markDirty();
      return n;
    }

    dispose() {
      if (this.nav && this.nav.dxFilter) this.nav.dxFilter = null;
      if (this.world.streamer && this.world.streamer.onFullBuilt) this.world.streamer.onFullBuilt = null;
      if (this.world.props && this.world.props.hide) this.world.props.hide = null;
      if (this.debris) this.debris.dispose();
      this.decals.dispose();
      this.reg.clear();
      this.jobs.length = 0; this.meshQueue.length = 0; this.applied.clear(); this.cosm.clear();
      for (const A of this.anims) if (A.grp.parent) A.grp.parent.remove(A.grp); // 形・材質は CityProps の物（捨てない）
      this.anims.length = 0;
      this.disposed = true;
    }
  };
})();
