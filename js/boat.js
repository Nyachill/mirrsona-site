// 運転できる船（MR.Boat。MR.Vehicle を継承、kind === 'boat'。boats 計画 §5.1）。数値は game.json の vehicles.types.<id>（speedboat /
// patrol_boat / water_taxi）、形のデータは assets/levels/ships.json（MR.Boat.setData。船首 +Z・左舷 +X・原点は喫水線の中心）。
// ■ 浮く: 決まった波の場（MR.Waves。ctx.waves / ctx.waveTime）を船首・船尾・左舷・右舷・中心の 5 点で引き、高さ（ばね buoyK / buoyDamp）・
//   前後（pitch。滑走の始まり humpPitch、滑走 planePitch で船首が上がる。中心は pitchPivotZ）・左右（roll。波 + 旋回で内側へ傾く leanGain）。
//   船尾の舷縁は波 + sternFreeboardMin より下にしない（水面の板が船の中に描かれない。描くときは lid のステンシルも使う）。
// ■ 走る: 推力 thrust × スロットル − 抵抗（速さの 2 乗。滑走前 dragDisp → 滑走 dragPlane の割合。最高速 maxSpeed で釣り合う）、後進 reverseThrust、
//   旋回 turnRate（速さ turnRefSpeed までで効き始め、速いと highSpeedTurn 倍）+ プロペラの押し propSteer（止まっていても回れる）、
//   横の速さは lateralGrip（滑走中は lateralGripPlane）で消える（滑る）。船外機は舵の向きに回り、プロペラは回る。
// ■ ぶつかる: 船体を hullCircles 個の円（半径 = 船体の半幅、船首は 0.8 倍）で表し、1 フレームに 1 回 nav.itemsIn で集めた箱（桟橋・浮き桟橋・
//   空母・停まっている船）から押し出す（帯 = 竜骨〜船の上の 0.8）。陸（city.isLand）は円の周り 8 点で押し返す（護岸 = 壁）。
//   動く船（ctx.platforms）・ほかの乗り物とも押し合う。速さ impactSpeed を超えて正面から当たるとダメージ・跳ね返り（bounce）。
//   敵（水の中の敵だけ）は車と同じにはね、泳いでいる人は cityboats.js がはねる。
// ■ 壊れる: HP 0 で爆発 → すぐ沈む（_startSink。update は sinking を wrecked より先に見る）→ 沈みきったら respawn 秒後にマリーナで復活。
// ■ 座席: def.seats（運転席が先頭）。降りる所（findExit）は 1 回目: 甲板・浮き桟橋・桟橋（足の高さから boardRise まで上・exitDrop まで下）を
//   船の周りどこでも、2 回目: 水（泳ぐ）。switchSeat（ソロ: 止まっているとき）。
// ■ 弾: intersectRay は船の傾きを含めて ships.json の箱（船体・操縦台・キャビン）で当てる。
// ■ 見た目: boats.glb の def.node（例 'speedboat'）を複製（名前の '<船名>_' を外す）か、コードで組んだ船体（同じ空ノード名）。
//   lid: 舷縁の外形の透明な板（色も深度も書かずステンシルのビットだけ）。water.js の水面はそのビットの所を描かない（MR.Water.setStencilMask）。
// ■ 音: audio.boat()（エンジンの回転と滑走の水音）、汽笛 boat_horn（ジャンプ）、波を越えた着水 wake_splash。
window.MR = window.MR || {};

(function () {
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const D2R = Math.PI / 180;
  const srgb = (hex) => (MR.srgb ? MR.srgb(hex) : new THREE.Color(hex));
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  const DEFAULTS = {
    kind: 'boat', node: 'speedboat', fallback: 'speedboat', length: 7.9, width: 2.64, height: 2.2, wheelRadius: 0.5,
    health: 420, armor: 0.9, driverExposure: 0.5,
    maxSpeed: 24, maxReverse: 4, thrust: 7.5, reverseThrust: 3, dragDisp: 0.045, dragPlane: 0.018,
    planeSpeed: 9, humpSpeed: 5.5, humpPitch: 6, planePitch: 2.5, planeLift: 0.18, pitchPivotZ: -1.2, sternFreeboardMin: 0.08,
    turnRate: 55, turnRefSpeed: 6, highSpeedTurn: 0.55, propSteer: 0.35, steerSpeed: 4,
    lateralGrip: 2.2, lateralGripPlane: 1.1, leanGain: 0.018, leanMax: 14,
    buoyK: 28, buoyDamp: 7, waveFollow: 1, airGravity: 14, hullCircles: 3, subStep: 0.5,
    impactSpeed: 4, impactDamage: 9, bounce: 0.25, collisionSpin: 0.4, scrape: 1.2, beachDecel: 6,
    explodeRadius: 6, explodeDamage: 130, sinkTime: 6, respawn: 40, seatSwitchSpeed: 2,
    wake: { width: 1.2, spread: 1.4, life: 9, every: 0.12 }, spray: { rate: 40, minSpeed: 7 },
    audio: { rateMin: 0.7, rateMax: 1.8, planeFrom: 7, planeFull: 16 },
    color: '#d8dde2'
  };
  const COMMON = { enterRise: 2.6, boardReach: 3.5, boardRise: 4.6, exitDrop: 1.0, sleepTime: 2, parkedBob: 0.6 };

  // ships.json（MR.Boat.setData）。無ければ def の寸法から作った形
  let DATA = null;
  function shipData(def) {
    const t = DATA && DATA.types && DATA.types[def.node || def.id];
    if (t) return t;
    const L = num(def.length, 8), W = num(def.width, 2.6);
    return {
      kind: 'boat', length: L, beam: W, draft: 0.5, freeboard: 0.85, deckY: 0.35, top: num(def.height, 2.2),
      bbox: [[-W / 2, -0.6, -L / 2], [W / 2, num(def.height, 2.2), L / 2]], boxes: [], decks: [], ramps: [],
      hull: { halfWidth: W / 2, zBow: L / 2, zStern: -L / 2, keelY: -0.5 }, draftMax: 0.6, seats: [], empties: {},
      lid: { y: 0.8, poly: [[W / 2 * 0.97, -L / 2], [W / 2 * 0.97, L * 0.1], [W / 4, L * 0.42], [0, L / 2 - 0.1], [-W / 4, L * 0.42], [-W / 2 * 0.97, L * 0.1], [-W / 2 * 0.97, -L / 2]] },
      outboards: [], props: [], rudders: [], glass: []
    };
  }

  let LID_MATS = {};
  function lidMaterial(bit) {
    if (LID_MATS[bit]) return LID_MATS[bit];
    const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: true, side: THREE.DoubleSide });
    m.stencilWrite = true; m.stencilRef = bit; m.stencilWriteMask = bit; m.stencilFuncMask = 0xff;
    m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilZPass = THREE.ReplaceStencilOp; m.stencilFail = THREE.KeepStencilOp; m.stencilZFail = THREE.KeepStencilOp;
    m.name = 'boat_lid';
    return (LID_MATS[bit] = m);
  }

  const WAVE_PTS = 5;

  class Boat extends MR.Vehicle {
    constructor(scene, def, opts) {
      super(scene, Object.assign({}, DEFAULTS, def || {}), opts);
      this.def = Object.assign({}, MR.Vehicle.DEFAULTS, DEFAULTS, def || {});
      this.def.seat = Array.isArray(this.def.seat) ? this.def.seat : MR.Vehicle.DEFAULTS.seat;
      this.def.exit = Array.isArray(this.def.exit) ? this.def.exit : MR.Vehicle.DEFAULTS.exit;
      this.boatCommon = Object.assign({}, COMMON, (opts && opts.boats) || {});
      this.city = (opts && opts.city) || null;
      this.waterY = num(opts && opts.waterY, this.city ? this.city.waterY : -2);
      if (!(opts && typeof opts.y === 'number')) this.pos.y = this.waterY;
      this.spawnPos.y = this.waterY;
      this.health = num(opts && opts.health, this.def.health);
      this.hull = Boat.hullCircles(this.def);
      this._apply();
    }

    _preInit(opts) {
      this.kind = 'boat';
      this.td = shipData(this.def);
      this.vel = new THREE.Vector3();   // 世界の水平の速さ
      this.vy = 0;
      this.pitch = 0; this.roll = 0; this.yawRate = 0;
      this.planing = 0;                // 0..1
      this.lean = 0;
      this.rudder = 0;                 // 見た目の舵角（rad）
      this.propAngle = 0;
      this.asleep = false; this.sleepT = 0;
      this.lastPush = -10;
      this.lastWave = -10;
      this.wakeT = 0; this.sprayT = 0;
      this.contact = null;             // 最後に押された { nx, nz, what }
      this.waveH = new Float32Array(WAVE_PTS);
      this._ws = { h: 0, sx: 0, sz: 0 };
      this._cands = [];
      this._pc = [0, 0, false];
      this._pp = [0, 0, false, null];
      this._land = new Float32Array(16);
      this.lid = null; this.lidOn = false;
      this.outboardNodes = []; this.propNodes = []; this.rudderNodes = [];
      this._ownMats = [];
      this.localInside = false;
      this.stats = { maxImpact: 0, collisionDamage: 0, impacts: 0, landHits: 0, sternClamp: 0 };
      this.wrecked = false;
    }

    static setData(json) { DATA = json || null; }
    static data() { return DATA; }
    static shipData(def) { return shipData(def); }

    // 船体の円（船尾から船首まで。半径 = 半幅、船首の円は 0.8 倍）
    static hullCircles(def) {
      const td = shipData(def), h = td.hull;
      const n = Math.max(2, Math.round(num(def.hullCircles, 3)));
      const r = h.halfWidth * 0.97;
      const z0 = h.zStern + r, z1 = h.zBow - r * 0.8;
      const z = [], rs = [];
      for (let i = 0; i < n; i++) { z.push(z0 + (z1 - z0) * i / (n - 1)); rs.push(i === n - 1 ? r * 0.8 : r); }
      return { r, z, rs };
    }

    // GLB が無いときのコードの船（ノード名は GLB と同じ。船体は舷縁の外形を竜骨から押し出した形）
    static buildFallback(def) {
      const td = shipData(def);
      const g = new THREE.Group();
      g.name = String(def.node || 'boat');
      const hullMat = new THREE.MeshStandardMaterial({ color: srgb(def.color || '#d8dde2'), roughness: 0.5, metalness: 0.1 });
      const deckMat = new THREE.MeshStandardMaterial({ color: srgb('#6b6f72'), roughness: 0.85 });
      const darkMat = new THREE.MeshStandardMaterial({ color: srgb('#1c2024'), roughness: 0.6, metalness: 0.3 });
      const glassMat = new THREE.MeshStandardMaterial({ color: srgb('#1a2630'), roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.4 });
      const poly = td.lid.poly, y1 = td.lid.y, y0 = td.hull.keelY, yd = td.deckY;
      // 船体（側面 + 甲板）: 外形を竜骨（少し内側へ）から舷縁へ
      const pos = [];
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const ia = [a[0] * 0.55, a[1] * 0.92], ib = [b[0] * 0.55, b[1] * 0.92];
        pos.push(ia[0], y0, ia[1], b[0], y1, b[1], a[0], y1, a[1]);
        pos.push(ia[0], y0, ia[1], ib[0], y0, ib[1], b[0], y1, b[1]);
      }
      const hullGeo = new THREE.BufferGeometry();
      hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      hullGeo.computeVertexNormals();
      const body = new THREE.Mesh(hullGeo, hullMat);
      body.name = 'body';
      const sh = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0] * 0.92, -p[1] * 0.96)));
      const deckGeo = new THREE.ShapeGeometry(sh);
      deckGeo.rotateX(-Math.PI / 2);
      const deck = new THREE.Mesh(deckGeo, deckMat);
      deck.position.y = yd;
      body.add(deck);
      for (const b of td.boxes || []) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]), /glass|wind/.test(b[7]) ? glassMat : darkMat);
        m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
        body.add(m);
      }
      g.add(body);
      for (const name in td.empties || {}) {
        const o = new THREE.Object3D(); o.name = name; o.position.fromArray(td.empties[name]); g.add(o);
      }
      // 船外機（運転できる船）
      for (const name of td.outboards || []) {
        const o = g.getObjectByName(name) || new THREE.Group();
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.5), darkMat);
        m.position.set(0, -0.2, -0.15);
        o.add(m);
        o.name = name;
        o.position.set(0, 0.55, td.hull.zStern + 0.6);
        g.add(o);
      }
      g.userData.source = 'procedural';
      return g;
    }

    // boats.glb から def.node の船を複製（名前の '<船名>_' を外す）
    static fromScene(scene, def) {
      const src = scene.getObjectByName(def.node);
      if (!src) throw new Error('boats.glb に ' + def.node + ' がありません');
      const clone = src.clone(true);
      clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0); clone.scale.set(1, 1, 1);
      const pre = def.node + '_';
      clone.traverse((o) => { if (o.name && o.name.indexOf(pre) === 0) o.name = o.name.slice(pre.length); });
      clone.userData.source = 'glb';
      return clone;
    }

    _setModel(group, source) {
      if (this.lid && this.lid.parent) this.lid.parent.remove(this.lid);
      super._setModel(group, source);
      this.bodyNode = this.model;          // 船全体（ガラス・船外機も一緒に傾き・焦げる）
      this._bodyRot = this.model.rotation.clone();
      const td = this.td;
      const find = (names) => (names || []).map((n) => group.getObjectByName(n)).filter(Boolean).map((node) => ({ node, q0: node.quaternion.clone() }));
      this.outboardNodes = find(td.outboards);
      this.propNodes = find(td.props);
      this.rudderNodes = find(td.rudders);
      if (this.propNodes.length === 0 && td.rudders && td.rudders.length === 0) this.propNodes = find(['prop']);
      for (const n of td.glass || []) { const o = group.getObjectByName(n); if (o) o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } }); }
      // 舷縁の外形の板（ステンシル）
      if (!this.lid) {
        const sh = new THREE.Shape(td.lid.poly.map((p) => new THREE.Vector2(p[0], -p[1])));
        const geo = new THREE.ShapeGeometry(sh);
        geo.rotateX(-Math.PI / 2);
        this.lid = new THREE.Mesh(geo, lidMaterial(Boat.stencilBit));
        this.lid.name = 'boat_lid';
        this.lid.renderOrder = -2;
        this.lid.position.y = td.lid.y;
        this.lid.castShadow = false; this.lid.receiveShadow = false;
        this.lid.visible = false;
        this.lid.frustumCulled = true;
      }
      this.model.add(this.lid);
      this.setLid(this.lidOn);
      if (this._shadowsOn === false) { this._shadowsOn = null; this.setShadows(false); } // GLB に差し替えたら（Vehicle._setModel が影を付け直す）もう一度
      if (this.pitch !== undefined) this._apply();
    }

    // ステンシルの板を出す・消す（cityboats.js が近い船だけ）
    setLid(on) {
      this.lidOn = !!on;
      if (this.lid) this.lid.visible = this.lidOn && !this.sinking && !this.sunk && !this.wrecked && Boat.lidEnabled;
    }

    // 影（タッチ端末では運転している船だけ）
    setShadows(on) {
      if (this._shadowsOn === on) return;
      this._shadowsOn = on;
      const glass = new Set(this.td.glass || []);
      this.model.traverse((o) => { if (o.isMesh && o !== this.lid && !glass.has(o.name) && !(o.parent && glass.has(o.parent.name))) o.castShadow = !!on; });
    }

    // ---------- 座標（傾きを含める）----------
    toWorld(local, target) {
      const e = this._euler2 || (this._euler2 = new THREE.Euler(0, 0, 0, 'YXZ'));
      e.set(this.pitch, this.yaw, this.roll, 'YXZ');
      const v = (target || new THREE.Vector3()).set(local.x, local.y + (this.model ? this.model.position.y : 0), local.z).applyEuler(e);
      return v.add(this.pos);
    }
    aabb() {
      const b = super.aabb();
      b.y = this.pos.y + this.td.hull.keelY; b.h = this.td.top - this.td.hull.keelY;
      return b;
    }
    // 他の乗り物の円を自分の円の外へ（半径は船首で小さい）
    _pushCircle(x, z, r) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const H = this.hull;
      for (let i = 0; i < H.z.length; i++) {
        const cx = this.pos.x + H.z[i] * s, cz = this.pos.z + H.z[i] * c;
        const minD = r + H.rs[i];
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = Math.sqrt(d2), push = (minD - d) * 0.5;
        x += dx / d * push; z += dz / d * push;
      }
      return { x, z };
    }
    // 点 (x, z) を船体の円の外へ（泳いでいる人。押したら距離（めり込み）を返す。0 = 当たっていない）
    pushOutCircle(p, radius) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const H = this.hull;
      let pen = 0;
      for (let i = 0; i < H.z.length; i++) {
        const cx = this.pos.x + H.z[i] * s, cz = this.pos.z + H.z[i] * c;
        const minD = radius + H.rs[i];
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) { p.x += c * minD; p.z -= s * minD; pen = Math.max(pen, minD); continue; }
        pen = Math.max(pen, minD - d);
        p.x = cx + dx / d * minD; p.z = cz + dz / d * minD;
      }
      return pen;
    }

    // ---------- 弾 ----------
    intersectRay(origin, dir, maxT) {
      if (!MR.Nav3D || typeof MR.Nav3D.rayBox !== 'function') return super.intersectRay(origin, dir, maxT);
      const q = this._qi || (this._qi = new THREE.Quaternion());
      const e = this._euler3 || (this._euler3 = new THREE.Euler(0, 0, 0, 'YXZ'));
      e.set(this.pitch, this.yaw, this.roll, 'YXZ');
      q.setFromEuler(e).invert();
      const o = this._ro || (this._ro = new THREE.Vector3()), d = this._rd || (this._rd = new THREE.Vector3());
      o.copy(origin).sub(this.pos); o.y -= this.model ? this.model.position.y : 0; o.applyQuaternion(q);
      d.copy(dir).applyQuaternion(q);
      const td = this.td, h = td.hull;
      let best = null, bt = maxT, bb = null;
      const test = (x0, y0, z0, x1, y1, z1) => {
        const t = MR.Nav3D.rayBox(o.x, o.y, o.z, d.x, d.y, d.z, x0, y0, z0, x1, y1, z1);
        if (t !== null && t >= 0 && t < bt) { bt = t; best = t; bb = [x0, y0, z0, x1, y1, z1]; }
      };
      test(-h.halfWidth, h.keelY, h.zStern, h.halfWidth, td.lid.y, h.zBow);
      for (const b of td.boxes) if (!/rail|edge/.test(b[7] || '')) test(b[0], b[1], b[2], b[3], b[4], b[5]);
      if (best === null) return null;
      const lx = o.x + d.x * bt, ly = o.y + d.y * bt, lz = o.z + d.z * bt;
      const faces = [[Math.abs(lx - bb[0]), -1, 0, 0], [Math.abs(lx - bb[3]), 1, 0, 0], [Math.abs(ly - bb[1]), 0, -1, 0], [Math.abs(ly - bb[4]), 0, 1, 0], [Math.abs(lz - bb[2]), 0, 0, -1], [Math.abs(lz - bb[5]), 0, 0, 1]];
      let f = faces[0];
      for (const g of faces) if (g[0] < f[0]) f = g;
      const normal = new THREE.Vector3(f[1], f[2], f[3]).applyQuaternion(q.invert());
      return { t: bt, point: origin.clone().addScaledVector(dir, bt), normal };
    }

    // ---------- 乗り降り ----------
    enter(player, seatIndex) {
      const ok = super.enter(player, seatIndex);
      if (ok) {
        this.asleep = false; this.sleepT = 0;
        if (this.audio && typeof this.audio.prepareBoat === 'function') this.audio.prepareBoat();
      }
      return ok;
    }
    switchSeat(who, toIndex) {
      const from = this.seatOf(who);
      if (from < 0) return -1;
      let to = toIndex;
      if (typeof to !== 'number') { to = -1; for (let k = 1; k <= this.seatCount; k++) { const j = (from + k) % this.seatCount; if (!this.occupants[j]) { to = j; break; } } }
      if (to < 0 || to === from || this.occupants[to]) return -1;
      this.occupants[from] = null;
      this.occupants[to] = who;
      if (from === 0) this.clearDriver();
      return to;
    }
    horn() {
      if (this.time - this.lastHorn < this.common.hornCooldown) return;
      this.lastHorn = this.time;
      this._sound('boat_horn', 0.9, null, { refDistance: 10, maxDistance: 250 });
    }
    attachHeadlight(light) { super.attachHeadlight(light); }

    // 降りる所。1 回目: 立てる面（動く船の甲板 ctx.platforms → 浮き桟橋・桟橋）を船の周りどこでも。2 回目: 水（{ y: null } → 泳ぐ）。
    //   甲板の高さ yDeck = 船の位置 + deckY から boardRise m 上まで探し、−exitDrop〜boardRise の面だけ。カプセルが 0.15 m 以内に収まること。
    //   戻り値 { x, y, z, entry? }
    findExit(i, nav, r, platforms) {
      r = r || 0.4;
      const C = this.boatCommon, td = this.td;
      const yDeck = this.pos.y + td.deckY;
      const tmp = this._tmpE || (this._tmpE = new THREE.Vector3());
      const cands = this._exitCands || (this._exitCands = []);
      cands.length = 0;
      const order = [i || 0];
      for (let k = 0; k < this.seatCount; k++) if (order.indexOf(k) < 0) order.push(k);
      for (const k of order) { const e = this.exitWorld(k, tmp); cands.push([e.x, e.z]); }
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const hw = td.hull.halfWidth, zs = td.hull.zStern, zb = td.hull.zBow;
      for (let d = 0.6; d <= C.boardReach + 0.01; d += 0.7) {
        for (let lz = zs + 0.6; lz <= zb - 0.6; lz += 1.2) for (const sx of [1, -1]) {
          const lx = sx * (hw + d);
          cands.push([this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c]);
        }
        const lz = zs - d;
        cands.push([this.pos.x + lz * s, this.pos.z + lz * c]);
        const lzb = zb + d;
        cands.push([this.pos.x + lzb * s, this.pos.z + lzb * c]);
      }
      const solid = (x, z) => {
        if (this.distanceTo(x, z) < r + 0.05) return null;
        // 動く船の甲板
        if (platforms) {
          const sup = platforms.supportAt(x, z, yDeck + C.boardRise - 0.45, 0.45, this._sup || (this._sup = {}), r * 0.5);
          if (sup && sup.y - yDeck <= C.boardRise && sup.y - yDeck >= -C.exitDrop) {
            // 甲板の上でカプセルが入るか（船室の壁・柵の中でない）
            const ln = platforms.localNav(sup.entry.typeId), l = platforms.toLocal(sup.entry, x, sup.y, z, this._lq || (this._lq = {}));
            const q = ln ? ln.resolveCapsule({ x: l.x, y: l.y, z: l.z }, r, 1.8, 0.45, { snapDown: 0.1 }) : null;
            if (q && Math.hypot(q.x - l.x, q.z - l.z) < 0.15 && q.grounded) return { x, y: sup.y, z, entry: sup.entry };
          }
        }
        if (typeof nav.groundHeight !== 'function') return null;
        const g = nav.groundHeight(x, z, yDeck + C.boardRise, r * 0.5);
        if (g === null || g - yDeck > C.boardRise || g - yDeck < -C.exitDrop) return null;
        const q = nav.resolveCapsule({ x, y: g, z }, r, 1.8, 0.45, { snapDown: 0.1 });
        if (Math.hypot(q.x - x, q.z - z) > 0.15 || !q.grounded) return null;
        return { x: q.x, y: q.y, z: q.z };
      };
      for (const p of cands) { const res = solid(p[0], p[1]); if (res) return res; }
      // 水（泳ぐ）: 座席の出口の側から
      for (const p of cands) {
        if (this.distanceTo(p[0], p[1]) < r + 0.05) continue;
        const w = nav.waterLevelAt ? nav.waterLevelAt(p[0], p[1]) : null;
        if (w === null) continue;
        const g = nav.groundHeight ? nav.groundHeight(p[0], p[1], w + 0.5, r * 0.5) : null;
        if (g !== null) continue;
        const q = nav.resolveCapsule ? nav.resolveCapsule({ x: p[0], y: w - 1, z: p[1] }, r, 1.8, 0.1, { snapDown: 0 }) : { x: p[0], z: p[1] };
        if (Math.hypot(q.x - p[0], q.z - p[1]) > 0.3) continue;
        return { x: p[0], y: null, z: p[1] };
      }
      const e = this.exitWorld(i || 0, tmp);
      return { x: e.x, y: null, z: e.z };
    }

    // ---------- ダメージ ----------
    _explode(ctx) {
      super._explode(ctx);            // wrecked・音・火の玉・ctx.onExplode（game.js が乗っている人を降ろす）
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.vel.multiplyScalar(0.3);
      this.wrecked = false;           // 沈む間は sinking（_updateSink の最後で wrecked = sunk）
      this._startSink(ctx, this.waterY);
      this.wrecked = true;
      this.setLid(false);
    }
    _setWreckLook(on) {
      super._setWreckLook(on);
      if (this.model) this.model.position.y = 0;
      if (this.bodyNode && this._bodyRot) this.bodyNode.rotation.copy(this._bodyRot);
    }
    _startSink(ctx, water) {
      super._startSink(ctx, water == null ? this.waterY : water);
      this.setLid(false);
      if (this._bootWake) this._bootWake = null;
    }
    respawn() {
      super.respawn();
      this.pos.y = this.waterY;
      this.vel.set(0, 0, 0); this.vy = 0;
      this.pitch = 0; this.roll = 0; this.yawRate = 0; this.planing = 0; this.lean = 0; this.rudder = 0;
      this.asleep = false; this.sleepT = 0;
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.setLid(this.lidOn);
      this._apply();
    }

    // ---------- 更新 ----------
    update(dt, ctx) {
      this.time += dt;
      if (this.disposed) return;
      // 沈むのを残骸より先に（爆発 → 沈む → 沈みきったら wrecked + sunk → 復活）
      if (this.sinking) { this._updateSink(dt, ctx); this._engine(dt, false, 0); return; }
      if (this.wrecked) { this._updateWreck(dt, ctx); return; }
      if (dt <= 0) return;
      const d = this.def, td = this.td;
      const driving = !!this.driver;
      // 寝ている（誰も乗っていない・止まっている・押されていない）: 波で揺れるだけ
      const still = !driving && this.vel.lengthSq() < 0.0025 && this.time - this.lastPush > this.boatCommon.sleepTime;
      if (still) this.sleepT += dt; else this.sleepT = 0;
      this.asleep = still && this.sleepT > 0.2;
      const waves = ctx && ctx.waves, wt = ctx && typeof ctx.waveTime === 'number' ? ctx.waveTime : this.time;
      if (this.asleep) { this._bob(dt, waves, wt, 0.6); this._apply(); this._engine(dt, false, 0); return; }

      const th = driving ? this.throttle : 0, si = driving ? this.steerInput : 0;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const rx = -fz, rz = fx; // 右（-X 側が右: 前 (sin, cos) に対して (−cos, sin)）
      let vf = this.vel.x * fx + this.vel.z * fz;
      let vl = this.vel.x * rx + this.vel.z * rz;
      const aspd = Math.abs(vf);
      // 滑走
      const plTarget = d.planeSpeed > d.humpSpeed ? smooth((aspd - d.humpSpeed) / (d.planeSpeed - d.humpSpeed)) : 0;
      this.planing += (plTarget - this.planing) * Math.min(1, dt * 2.5);
      // 推力と抵抗（最高速で釣り合う 2 乗の抵抗。滑走の前は dragDisp / dragPlane 倍）
      const kPlane = Math.max(1e-4, d.thrust - 0.12 * d.maxSpeed) / (d.maxSpeed * d.maxSpeed);
      const k = kPlane * (1 + (d.dragDisp / Math.max(1e-6, d.dragPlane) - 1) * (1 - this.planing) * smooth(aspd / Math.max(0.1, d.humpSpeed)));
      let F = th > 0 ? d.thrust * th : d.reverseThrust * th;
      if (th < -0.02 && vf > 0.5) F = d.thrust * th * 0.8; // 前進中に引く = 逆転で止める
      vf += (F - k * vf * Math.abs(vf) - 0.12 * vf) * dt;
      if (vf < -d.maxReverse) vf += (-d.maxReverse - vf) * Math.min(1, dt * 3);
      // 横は消える（滑走中は滑る）
      const grip = d.lateralGrip + (d.lateralGripPlane - d.lateralGrip) * this.planing;
      vl *= Math.exp(-grip * dt);
      // 旋回（右が正の舵 → ヨーが減る）。速さで効き、プロペラの押しで止まっていても回る
      this.rudder += (si * 0.6 - this.rudder) * Math.min(1, dt * d.steerSpeed);
      const sp = clamp(aspd / d.turnRefSpeed, 0, 1) * (1 + (d.highSpeedTurn - 1) * clamp(aspd / d.maxSpeed, 0, 1));
      const prop = d.propSteer * Math.abs(th) * (1 - clamp(aspd / d.turnRefSpeed, 0, 1) * 0.5);
      const dirSign = vf < -0.3 ? -1 : 1;
      const yrT = -si * d.turnRate * D2R * Math.max(sp, prop) * (th < -0.02 && vf < 0.5 ? -1 : dirSign);
      this.yawRate += (yrT - this.yawRate) * Math.min(1, dt * d.steerSpeed);
      this.yaw += this.yawRate * dt;
      // 速さを新しい向きで世界へ（向きが変わっても速さの向きは残る = 滑る）
      const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw), nrx = -nfz, nrz = nfx;
      // 旋回で前の速さの一部は横へ移る（向きは変わるが速度ベクトルは惰性）
      this.vel.x = fx * vf + rx * vl; this.vel.z = fz * vf + rz * vl;
      vf = this.vel.x * nfx + this.vel.z * nfz; vl = this.vel.x * nrx + this.vel.z * nrz;
      this.vel.x = nfx * vf + nrx * vl; this.vel.z = nfz * vf + nrz * vl;
      this.speed = vf;
      // 傾き（旋回の内側へ）
      const leanT = clamp(-this.yawRate * aspd * d.leanGain * 12, -d.leanMax * D2R, d.leanMax * D2R);
      this.lean += (leanT - this.lean) * Math.min(1, dt * 3);

      // 動かす（小刻み）+ 当たり
      this._move(dt, ctx);
      // 波と浮力
      this._bob(dt, waves, wt, 1);
      // 敵（水の中の敵だけ）
      if (ctx && ctx.enemies) this._enemies(ctx, nfx, nfz);
      // 航跡・しぶき
      this._wake(dt, ctx);
      // 船外機・舵・プロペラ
      this.propAngle = (this.propAngle + (driving ? (0.25 + Math.abs(th)) * 60 : 0) * dt) % (Math.PI * 2);
      this._apply();
      this._engine(dt, driving, th);
    }

    // 波: 5 点の高さで heave / pitch / roll。amt 1 = 走っている、0.6 = 寝ている（揺れを少し小さく）
    _bob(dt, waves, t, amt) {
      const d = this.def, td = this.td, h = td.hull;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const zb = h.zBow * 0.8, zs = h.zStern * 0.85, hw = h.halfWidth * 0.9;
      const P = Boat._PTS || (Boat._PTS = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]);
      const H = this.waveH;
      for (let i = 0; i < WAVE_PTS; i++) {
        const lx = P[i][0] * hw, lz = P[i][1] > 0 ? zb : P[i][1] < 0 ? zs : 0;
        H[i] = waves ? waves.height(this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c, t) * d.waveFollow * amt : 0;
      }
      const mean = (H[0] * 2 + H[1] + H[2] + H[3] + H[4]) / 6;
      // 滑走の始まりの持ち上がり（humpSpeed の前後）
      const aspd = Math.abs(this.speed);
      const hump = d.humpSpeed < 50 ? Math.max(0, 1 - Math.abs(aspd - d.humpSpeed) / Math.max(0.5, d.humpSpeed * 0.6)) * (1 - this.planing) : 0;
      const pitchT = -Math.atan2(H[1] - H[2], zb - zs) - (d.humpPitch * hump + d.planePitch * this.planing) * D2R * Math.min(1, aspd / Math.max(0.5, d.humpSpeed * 0.5));
      const rollT = Math.atan2(H[3] - H[4], 2 * hw) + this.lean;
      const kp = Math.min(1, dt * 4);
      this.pitch += (pitchT - this.pitch) * kp;
      this.roll += (rollT - this.roll) * kp;
      // 高さ（ばね）。pitchPivotZ のまわりに回すぶん原点を上げる（船首が大きく上がる）
      let yT = this.waterY + mean + d.planeLift * this.planing + d.pitchPivotZ * Math.sin(this.pitch);
      // 船尾の舷縁が波より下にならない（水面の板が船の中に見えない）
      const ys = td.lid.y * Math.cos(this.pitch) - h.zStern * Math.sin(this.pitch);
      const floor = this.waterY + H[2] + d.sternFreeboardMin - ys;
      if (yT < floor) { yT = floor; this.stats.sternClamp++; }
      this.vy += ((yT - this.pos.y) * d.buoyK - this.vy * d.buoyDamp) * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < floor) { this.pos.y = floor; if (this.vy < 0) this.vy = 0; }
    }

    // 1 フレームの移動を subStep 以下に刻み、円ごとに箱・陸・動く船・乗り物から押し出す
    _move(dt, ctx) {
      const d = this.def, td = this.td, H = this.hull;
      const nav = ctx && ctx.nav, city = (ctx && ctx.city) || this.city, P = ctx && ctx.platforms;
      const dx = this.vel.x * dt, dz = this.vel.z * dt;
      const dist = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(dist / d.subStep));
      const lo = this.pos.y + td.hull.keelY - 0.15, hi = this.pos.y + td.top * 0.8;
      const reach = Math.max(Math.abs(td.hull.zBow), Math.abs(td.hull.zStern)) + H.r + 1;
      // 集める（1 フレームに 1 回）
      const cands = this._cands;
      cands.length = 0;
      if (nav && typeof nav.itemsIn === 'function') nav.itemsIn(Math.min(this.pos.x, this.pos.x + dx) - reach, Math.min(this.pos.z, this.pos.z + dz) - reach, Math.max(this.pos.x, this.pos.x + dx) + reach, Math.max(this.pos.z, this.pos.z + dz) + reach, cands);
      const push = MR.Helicopter && MR.Helicopter.pushCircle ? MR.Helicopter.pushCircle : (MR.Platforms ? MR.Platforms.pushCircleItems : null);
      let hitN = 0, hx = 0, hz = 0, what = null, spin = 0, shipVel = null;
      for (let step = 0; step < n; step++) {
        this.pos.x += dx / n; this.pos.z += dz / n;
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        for (let it = 0; it < 2; it++) {
          let moved = false;
          for (let i = 0; i < H.z.length; i++) {
            const r = H.rs[i];
            const cx = this.pos.x + H.z[i] * s, cz = this.pos.z + H.z[i] * c;
            let sx = cx, sz = cz;
            if (push && cands.length) { const o = push(cands, sx, sz, r, lo, hi, dx, dz, this._pc); if (o[2]) { sx = o[0]; sz = o[1]; what = 'box'; } }
            if (city) { const q = this._shore(city, sx, sz, r); if (q) { sx = q[0]; sz = q[1]; what = 'land'; this.stats.landHits++; } }
            if (P) {
              const o = P.pushCircle(sx, sz, r, lo, hi, this._pp, 'vehicle');
              if (o[2]) { sx = o[0]; sz = o[1]; what = 'ship'; shipVel = o[3]; }
            }
            if (ctx && ctx.vehicles) {
              for (const v of ctx.vehicles) {
                if (v === this || v.disposed || v.sunk || (v.kind === 'jet' && v.mode === 'air')) continue;
                if (Math.abs(v.pos.y - this.pos.y) > 3 || Math.hypot(v.pos.x - sx, v.pos.z - sz) > 30) continue;
                const pp = v._pushCircle(sx, sz, r);
                if (Math.abs(pp.x - sx) + Math.abs(pp.z - sz) > 1e-6) { sx = pp.x; sz = pp.z; what = 'vehicle'; }
              }
            }
            const ox = sx - cx, oz = sz - cz;
            if (ox * ox + oz * oz < 1e-10) continue;
            // 円の押しを船全体へ（回る）
            this.pos.x += ox; this.pos.z += oz;
            const lat = ox * c - oz * s;
            spin += lat * H.z[i] * d.collisionSpin * 0.02;
            hx += ox; hz += oz; hitN++;
            moved = true;
          }
          if (!moved) break;
        }
      }
      if (!hitN) { this.contact = null; return; }
      this.lastPush = this.time;
      const L = Math.hypot(hx, hz) || 1, nx = hx / L, nz = hz / L;
      this.contact = { nx, nz, what };
      // 法線の向きの速さを消す（跳ね返り）。動く船は船の速さに合わせる
      let rvx = this.vel.x, rvz = this.vel.z;
      if (shipVel && P) { const pv = P.pointVel(shipVel, this.pos.x, this.pos.z, this._pv || (this._pv = {})); rvx -= pv.x; rvz -= pv.z; }
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const impact = -vn;
        const fwd = Math.abs(nx * Math.sin(this.yaw) + nz * Math.cos(this.yaw));
        const b = fwd > 0.45 ? d.bounce : 0.05;
        this.vel.x -= (1 + b) * vn * nx; this.vel.z -= (1 + b) * vn * nz;
        if (fwd <= 0.45) { const k = Math.max(0, 1 - d.scrape * dt); this.vel.x *= k; this.vel.z *= k; }
        if (impact > this.stats.maxImpact) this.stats.maxImpact = impact;
        if (impact >= d.impactSpeed && this.time - this.lastImpact > 0.35 && fwd > 0.3) {
          this.lastImpact = this.time;
          this.stats.impacts++;
          const pt = this._tmp2.set(this.pos.x - nx * this.hull.r, this.pos.y + 0.5, this.pos.z - nz * this.hull.r);
          this._sound('vehicle_impact', clamp(impact / d.maxSpeed, 0.35, 1), pt, { refDistance: 6 });
          if (this.fx) { if (this.fx.splash) this.fx.splash(this._tmp3.set(pt.x, this.waterY + 0.05, pt.z), 1.2, 'vehicle'); if (this.fx.impact) this.fx.impact(pt, this._tmp3.set(nx, 0.3, nz).normalize()); }
          if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, impact);
          const dmg = Math.max(0, impact - d.impactSpeed * 0.5) * d.impactDamage;
          this.stats.collisionDamage += dmg;
          this.damage(dmg, ctx);
        }
      }
      if (shipVel && P) { const pv = P.pointVel(shipVel, this.pos.x, this.pos.z, this._pv); const vn2 = (this.vel.x - pv.x) * nx + (this.vel.z - pv.z) * nz; if (vn2 < 0) { this.vel.x -= vn2 * nx; this.vel.z -= vn2 * nz; } }
      this.yaw += clamp(spin, -0.05, 0.05);
      this.speed = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    }

    // 円が陸にかかっていれば陸と反対へ押し出した中心 [x, z]（かかっていなければ null）。8 方向の点で陸の向きを見て、その向きに二分探索
    _shore(city, x, z, r) {
      if (typeof city.isLand !== 'function') return null;
      if (Boat.shoreGrid && !Boat.shoreGrid.near(city, x, z)) return null;
      let lx = 0, lz = 0, n = 0;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, cx = Math.sin(a), cz = Math.cos(a);
        if (city.isLand(x + cx * r, z + cz * r)) { lx += cx; lz += cz; n++; }
      }
      const inside = city.isLand(x, z);
      if (!n && !inside) return null;
      let L = Math.hypot(lx, lz);
      if (L < 1e-6) { // 全部陸（または中心だけ）: 来た向きへ戻す
        const v = Math.hypot(this.vel.x, this.vel.z) || 1;
        lx = this.vel.x / v; lz = this.vel.z / v; L = 1;
      }
      lx /= L; lz /= L;
      // 陸との境目までの距離 b（中心から陸の向き）
      let a = inside ? -r * 2 : 0, b = r;
      if (inside) { // 中心が陸: 反対へ探す
        for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (city.isLand(x + lx * m, z + lz * m)) b = m; else a = m; }
      } else {
        for (let i = 0; i < 10; i++) { const m = (a + b) / 2; if (city.isLand(x + lx * m, z + lz * m)) b = m; else a = m; }
      }
      const pen = r - a + 0.02;
      if (pen <= 0) return null;
      return [x - lx * pen, z - lz * pen];
    }

    // 敵: 水の中の敵だけ（桟橋の上の敵は舷縁より上なのではねない）
    _enemies(ctx, fx, fz) {
      const list = ctx.enemies;
      if (!list || !list.length) return;
      const keep = this._enemyBuf || (this._enemyBuf = []);
      keep.length = 0;
      for (const e of list) if (e && !e.dead && !e.removed && (e.pos.y || 0) < this.pos.y + this.td.deckY + 0.3 && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < this.def.length) keep.push(e);
      if (!keep.length) return;
      const saved = ctx.enemies;
      ctx.enemies = keep;
      try { super._enemies(ctx, fx, fz); } finally { ctx.enemies = saved; }
    }

    // 航跡（ctx.wakes: MR.Wakes）としぶき（ctx.spray）
    _wake(dt, ctx) {
      const d = this.def;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (!ctx) return;
      if (ctx.wakes && sp > 1.2) {
        this.wakeT -= dt;
        if (this.wakeT <= 0) {
          this.wakeT = d.wake.every;
          const o = this.td.empties.wake_origin || [0, 0, this.td.hull.zStern];
          const p = this.toWorld(this._tmp3.set(o[0], 0, o[2]), this._tmp3);
          const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
          ctx.wakes.emit(p.x, p.z, fz, -fx, d.wake.width * (0.6 + 0.4 * this.planing), d.wake.spread, Math.min(1, sp / d.maxSpeed) * 0.85 + 0.15, d.wake.life, sp * d.wake.every * 0.65 + 0.6);
        }
      }
      if (ctx.spray && sp > d.spray.minSpeed) {
        this.sprayT += dt * d.spray.rate * Math.min(1, (sp - d.spray.minSpeed) / 6);
        const b = this.td.empties.bow_spray || [0, 0, this.td.hull.zBow * 0.6];
        while (this.sprayT >= 1) {
          this.sprayT -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          const p = this.toWorld(this._tmp3.set(b[0] + side * this.td.hull.halfWidth * 0.8, 0, b[2]), this._tmp3);
          const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
          // 横（左舷 +X = (cos, −sin)）へ + 上へ + 船の速さの一部
          const out = 1.5 + Math.random() * 2;
          ctx.spray.emit(p.x, this.waterY + 0.1, p.z, side * c * out + this.vel.x * 0.25, 1.5 + Math.random() * 2.5, -side * s * out + this.vel.z * 0.25);
        }
      }
    }

    _apply() {
      this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
      for (const o of this.outboardNodes) { o.node.quaternion.copy(o.q0); o.node.rotateY(-this.rudder * 0.7); }
      for (const o of this.rudderNodes) { o.node.quaternion.copy(o.q0); o.node.rotateY(-this.rudder * 0.7); }
      for (const o of this.propNodes) { o.node.quaternion.copy(o.q0); o.node.rotateZ(this.propAngle); }
      if (this.headlight) this.headlight.intensity = (this.driver && !this.wrecked) ? this.common.headlightIntensity : 0;
    }

    // ---------- 音 ----------
    _engine(dt, driving, th) {
      if (!driving) { if (this.engine) this._stopEngine(); return; }
      if (!this.engine && this.audio) {
        try { this.engine = typeof this.audio.boat === 'function' ? this.audio.boat(this.pos) : (typeof this.audio.engine === 'function' ? this.audio.engine(this.pos) : null); } catch (e) { this.engine = null; }
      }
      if (!this.engine) return;
      const A = this.def.audio, sp = Math.round(Math.abs(this.speed) * 2) / 2; // 0.5 m/s 刻み（一定の速さに近づく間に音のパラメータを書き続けない）
      const target = clamp(0.15 + 0.6 * Math.abs(th) + 0.4 * clamp(sp / this.def.maxSpeed, 0, 1), 0, 1);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 2.5);
      const pos = (this.localInside && this.listenerPos) ? this.listenerPos : this.pos;
      if (typeof this.audio.boat === 'function') {
        const plane = clamp((sp - A.planeFrom) / Math.max(0.1, A.planeFull - A.planeFrom), 0, 1);
        this.engine.set(A.rateMin + (A.rateMax - A.rateMin) * this.rpm, this.common.engineVolume * (this.localInside ? 0.8 : 1), plane);
      } else this.engine.set(this.rpm, this.common.engineVolume);
      this.engine.setPosition(pos);
    }

    // ---------- オンライン（M5）----------
    netState() { return { p: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, pitch: this.pitch, roll: this.roll, sp: this.speed, st: this.rudder, vy: this.vy }; }

    dispose() {
      if (this.lid && this.lid.geometry) this.lid.geometry.dispose();
      super.dispose();
    }

    // マリーナの置き場所 (x, z) が浮き桟橋・桟橋・陸に掛かっていれば向きに沿って前後・左右にずらす
    static findSpawnWater(nav, city, def, x, z, yaw) {
      const H = Boat.hullCircles(def);
      const td = shipData(def);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const lo = (city ? city.waterY : -2) + td.hull.keelY, hi = (city ? city.waterY : -2) + td.top;
      const items = [];
      const free = (px, pz) => {
        for (let i = 0; i < H.z.length; i++) {
          const cx = px + fx * H.z[i], cz = pz + fz * H.z[i], r = H.rs[i];
          if (city && city.isLand(cx, cz)) return false;
          if (nav && nav.itemsIn) {
            items.length = 0;
            nav.itemsIn(cx - r, cz - r, cx + r, cz + r, items);
            for (const b of items) {
              if (b.y1 <= lo || b.y0 >= hi) continue;
              const qx = clamp(cx, b.x0, b.x1), qz = clamp(cz, b.z0, b.z1);
              if ((qx - cx) * (qx - cx) + (qz - cz) * (qz - cz) < r * r) return false;
            }
          }
        }
        return true;
      };
      if (free(x, z)) return { x, z };
      for (let st = 1; st <= 12; st++) for (const sg of [1, -1]) {
        const px = x + fx * st * sg, pz = z + fz * st * sg;
        if (free(px, pz)) return { x: px, z: pz };
        for (const side of [1, -1, 2, -2]) { const qx = px + fz * side, qz = pz - fx * side; if (free(qx, qz)) return { x: qx, z: qz }; }
      }
      return { x, z };
    }
  }

  // 陸の近くの格子（16 m。陸が船の長さ + 10 m 以内にあるマスだけ岸の判定をする）
  class ShoreGrid {
    constructor(cell, reach) { this.cell = cell || 16; this.reach = reach || 30; this.map = new Map(); }
    near(city, x, z) {
      const c = this.cell, ix = Math.floor(x / c), iz = Math.floor(z / c), k = ix * 100003 + iz;
      let v = this.map.get(k);
      if (v === undefined) {
        v = false;
        const R = this.reach, cx = (ix + 0.5) * c, cz = (iz + 0.5) * c, S = R + c * 0.71;
        for (let a = 0; a < 16 && !v; a++) for (const rr of [0, S * 0.5, S]) {
          const an = a * Math.PI / 8;
          if (city.isLand(cx + Math.sin(an) * rr, cz + Math.cos(an) * rr)) { v = true; break; }
        }
        if (this.map.size > 40000) this.map.clear();
        this.map.set(k, v);
      }
      return v;
    }
  }

  Boat.DEFAULTS = DEFAULTS;
  Boat.COMMON = COMMON;
  Boat.ShoreGrid = ShoreGrid;
  Boat.shoreGrid = new ShoreGrid(16, 30);
  Boat.stencilBit = 2;
  Boat.lidEnabled = true;
  MR.Boat = Boat;
})();
