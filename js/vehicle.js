// 乗り物（ジープ・ピックアップ・装甲車）。
//   - 挙動はアーケード寄りの「自転車モデル」: 前後の加速とブレーキ、舵角 → ヨー、速度に比例した空気抵抗。
//     速いほど切れ角を抑える（highSpeedSteer）。
//   - 当たり判定は nav.js の箱に対して「車体を前後に並べた数個の円」で押し出す。他の乗り物とも円どうしで押し合う。
//     正面からぶつかると止まってダメージ、こすると減速してスキッド音。
//   - 敵は速度 runOverSpeed 以上ならはね飛ばし（即死）、遅ければ押し出す。徒歩のプレイヤーも pushOut() で押す。
//   - HP があり、0 で爆発（game.js が周囲にダメージを配る）→ 黒焦げの残骸（煙）→ respawn 秒後に元の場所へ復活。
//   - 見た目: assets/<tier>/models/<id>.glb（ルート 'Jeep' 等、mesh 'body'、車輪 wheel_fl/fr/rl/rr(+ml/mr)、
//     空ノード seat_driver / exit / headlight_l/r / taillight_l/r / exhaust。前 +Z、原点は足元中央、単位 m）。
//     無ければコードで組んだ箱の車（同じノード名で作るので以降の処理は共通）。
//   - 数値は assets/config/game.json の vehicles.types.<id>（無いキーは DEFAULTS）。共通設定は vehicles 直下。
//     seat / exit は GLB の空ノードがあればそちらを使う（seatFromConfig: true で設定の seat を優先）。
// 使い方（game.js）:
//   const v = new MR.Vehicle(scene, def, { x, z, yaw, assets, audio, fx, common });
//   毎フレーム v.update(dt, ctx)（ctx: { nav, enemies, player, vehicles, fx, audio, time, onKill(enemy, v), onImpact(v, speed), onExplode(v) }）
//   乗る: v.enter(player) → 毎フレーム v.setControls(throttle, steer)、v.seatWorld(target) で目の位置 → v.exit() / v.exitWorld(target)
//   弾: v.intersectRay(origin, dir, maxT) → { t, point, normal } / v.hit(damage, point, ctx)
// 座席（vehicles.types.<id>.seats = [{ node, exitNode, seat:[x,y,z], exit:[x,y,z] }]、運転席が先頭）: GLB の空ノードがあればその位置、
//   無ければ seat / exit の値。seats が無ければ運転席 1 つ（seat_driver / exit）。enter(who, seatIndex) / seatWorld(i) / exitWorld(i) /
//   findExit(i, nav, r)（降りる所が空いていなければ他の座席の出口 → 近くの空き）。driver は座席 0 の人（今まで通り）。
// 地形（街。game.js が terrain = true にする）: 車輪 4 つの下の nav.groundHeight で車体の高さ・前後（pitch）・左右（roll）を決める
//   （高架・橋の取り付け道路を登る）。当たるのは車高の帯の箱だけ（climb m までの段は乗り越える）。支える車輪が 2 つ未満なら落ちる
//   （着地の速さで landingSpeed を超えた分のダメージ）。水面より沈んだら sinkTime 秒で沈んで壊れる（ctx.onSunk で game.js が運転手を水へ）。
// オンライン（game.js が netControlled = true にする）: HP・爆発・復活はサーバーが決める。
//   damage() は何もしない（衝突ダメージも無し）、残骸の自動復活もしない。代わりに
//   setHealth(hp) / netExplode(ctx) / netRespawn(x, z, yaw, hp)、他の人が運転中の車は netPose(x, z, yaw, speed, steer, dt)、
//   音を鳴らさずに運転手を外すのは clearDriver()。エンジン音は運転手がいないと（どの経路でも）止まる
window.MR = window.MR || {};

(function () {
  // 種類ごとの既定値（game.json の vehicles.types.<id> が上書きする）
  const DEFAULTS = {
    name: '車', model: null, fallback: 'jeep', scale: 1, seatFromConfig: false,
    length: 4.2, width: 1.95, height: 1.85, wheelRadius: 0.42, wheelbase: 2.6, track: 1.6,
    health: 320, armor: 1.0, driverExposure: 0.3,
    maxSpeed: 22, maxReverse: 7, accel: 7, brake: 15, reverseAccel: 0.7, drag: 0.08, rolling: 1.5,
    maxSteer: 32, highSpeedSteer: 0.3, steerSpeed: 5,
    bounce: 0.12, scrape: 2.0, collisionSpin: 0.4, pitchGain: 0.004, rollGain: 0.004,
    impactSpeed: 4, impactDamage: 7, runOverSpeed: 3, runOverDamage: 9999, runOverSlow: 0.85,
    explodeRadius: 7, explodeDamage: 160, respawn: 25,
    seat: [0.42, 1.25, 0.25], exit: [1.7, 0, 0.25], seats: null,
    climb: 0.45, landingSpeed: 8, landingDamage: 14, sinkTime: 3,
    color: '#4a5137'
  };
  // 共通設定（game.json の vehicles 直下）
  const COMMON_DEFAULTS = { enterDistance: 3, fovBoost: 6, headlights: true, headlightIntensity: 2.5, engineVolume: 0.8, hornCooldown: 0.8 };
  const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_ml', 'wheel_mr', 'wheel_rl', 'wheel_rr'];
  const EMPTY_NAMES = ['seat_driver', 'exit', 'headlight_l', 'headlight_r', 'taillight_l', 'taillight_r', 'exhaust'];

  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const arr3 = (a, d) => (Array.isArray(a) && a.length >= 3 && a.every((x) => typeof x === 'number' && isFinite(x))) ? a : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const srgb = (hex) => (MR.srgb ? MR.srgb(hex) : new THREE.Color(hex));
  const cap = (s) => String(s || 'vehicle').replace(/^./, (c) => c.toUpperCase());

  class Vehicle {
    constructor(scene, def, opts) {
      opts = opts || {};
      this.scene = scene;
      this.def = Object.assign({}, DEFAULTS, def || {});
      this.def.seat = arr3(this.def.seat, DEFAULTS.seat);
      this.def.exit = arr3(this.def.exit, DEFAULTS.exit);
      this.common = Object.assign({}, COMMON_DEFAULTS, opts.common || {});
      this.id = this.def.id || opts.type || 'jeep';
      this.name = this.def.name || this.id;
      this.assets = opts.assets || null;
      this.audio = opts.audio || null;
      this.fx = opts.fx || null;

      this.pos = new THREE.Vector3(num(opts.x, 0), num(opts.y, 0), num(opts.z, 0));
      this.yaw = num(opts.yaw, 0);
      this.spawnPos = this.pos.clone();
      this.spawnYaw = this.yaw;
      this.speed = 0;          // m/s（前が正）
      this.steer = 0;          // 現在の舵角（rad、右が正）
      this.throttle = 0;       // 入力 -1..1
      this.steerInput = 0;     // 入力 -1..1（右が正）
      this.yawRate = 0;
      this.accelSmooth = 0;
      this.latSmooth = 0;
      this.rpm = 0;
      this.health = this.def.health;
      this.wrecked = false;
      this.respawnTimer = 0;
      this.occupants = [];     // 座席ごとに乗っている人（0 = 運転席）
      this.driver = null;      // 乗っているプレイヤー（MR.Player）か null（= occupants[0]）
      this.terrain = !!opts.terrain; // 街: 地面の高さ・傾き・落下・水没
      this.vy = 0; this.pitch = 0; this.roll = 0; this.airborne = false;
      this.sinking = null;     // 水没中 { t }
      this.sunk = false;
      this.engine = null;      // audio.engine() のハンドル
      this.headlight = null;   // game.js が attachHeadlight() で貸すスポットライト
      this.lastImpact = -10;
      this.lastHorn = -10;
      this.lastSkid = -10;
      this.smokeTimer = 0;
      this.time = 0;
      this.disposed = false;
      this.netControlled = false; // オンライン: HP・爆発・復活はサーバー（上の説明）
      this.modelSource = 'procedural';
      this.hull = Vehicle.hullCircles(this.def);
      this.nodes = {};         // seat_driver / exit / headlight_* …（ルートのローカル座標、スケール適用後）
      this.wheels = [];        // { node, q0, spin, front }
      this.bodyNode = null;
      this._bodyRot = null;
      this._wreckMats = null;
      this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3(); this._tmp3 = new THREE.Vector3();
      this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
      this._q = new THREE.Quaternion();
      // 派生クラス（heli.js の MR.Helicopter）が自分の状態を用意する（モデルを作る前）
      if (typeof this._preInit === 'function') this._preInit(opts);

      this.root = new THREE.Group();
      this.root.name = 'vehicle:' + this.id;
      if (this.terrain || this.kind === 'heli') this.root.rotation.order = 'YXZ';
      this.model = null;
      // コードで組むモデル・GLB の複製は派生クラスの static で差し替えられる（this.constructor）
      this._setModel(this.constructor.buildFallback(this.def), 'procedural');
      scene.add(this.root);
      this._apply();
      this._loadModel();
    }

    get driver() { return this.occupants[0] || null; }
    set driver(v) { this.occupants[0] = v || null; }

    // ---------- 見た目 ----------

    // 車体を前後に並べた円（ローカル Z のオフセットと半径）
    static hullCircles(def) {
      const L = def.length, W = def.width;
      const r = W / 2 * 0.95;
      const span = Math.max(0, L / 2 - r);
      const n = Math.max(2, Math.ceil(2 * span / Math.max(0.3, r)) + 1);
      const z = [];
      for (let i = 0; i < n; i++) z.push(-span + (2 * span) * i / (n - 1));
      return { r, z };
    }

    // GLB が無いときの箱の車。ノード名は GLB と同じ規約で作る
    static buildFallback(def) {
      const L = def.length, W = def.width, H = def.height, r = def.wheelRadius;
      const kind = def.fallback || def.id || 'jeep';
      const bodyMat = new THREE.MeshStandardMaterial({ color: srgb(def.color || '#4a5137'), roughness: 0.55, metalness: 0.3 });
      const darkMat = new THREE.MeshStandardMaterial({ color: srgb('#1b1d21'), roughness: 0.85, metalness: 0.1 });
      const glassMat = new THREE.MeshStandardMaterial({ color: srgb('#1a2630'), roughness: 0.12, metalness: 0.7, transparent: true, opacity: 0.35 });
      const lampMat = new THREE.MeshStandardMaterial({ color: srgb('#fff2d0'), emissive: srgb('#ffe2a8'), emissiveIntensity: 1.6, roughness: 0.3 });
      const tailMat = new THREE.MeshStandardMaterial({ color: srgb('#5a1010'), emissive: srgb('#ff2a2a'), emissiveIntensity: 1.2, roughness: 0.3 });
      const hubMat = new THREE.MeshStandardMaterial({ color: srgb('#6a6e72'), roughness: 0.5, metalness: 0.8 });
      const group = new THREE.Group();
      group.name = cap(kind);
      const body = new THREE.Group();
      body.name = 'body';
      group.add(body);
      const box = (mat, w, h, d, x, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        body.add(m);
        return m;
      };
      const bottom = r * 0.75;
      let lampY;
      if (kind === 'apc') {
        const hullH = H * 0.55;
        box(bodyMat, W * 0.96, hullH, L * 0.98, 0, bottom + hullH / 2, 0);
        const glacis = box(bodyMat, W * 0.9, hullH * 0.9, 0.5, 0, bottom + hullH * 0.9, L * 0.49 - 0.25);
        glacis.rotation.x = -0.6;
        const top = H - bottom - hullH;
        box(bodyMat, W * 0.8, top * 0.7, L * 0.6, 0, bottom + hullH + top * 0.35, -L * 0.05);
        box(darkMat, 0.7, 0.35, 0.8, 0.3, H - 0.17, 0.4);          // 小さな砲塔
        box(darkMat, 0.08, 0.08, 1.0, 0.3, H - 0.12, 1.2);         // 砲身
        for (const sx of [-1, 1]) box(darkMat, 0.08, hullH * 0.6, L * 0.7, sx * (W / 2 - 0.02), bottom + hullH * 0.5, 0); // スラットアーマー
        lampY = bottom + hullH * 0.55;
      } else {
        const bodyH = H * 0.42;
        box(bodyMat, W, bodyH, L, 0, bottom + bodyH / 2, 0);
        const cabH = H - bottom - bodyH;
        if (kind === 'pickup') {
          box(bodyMat, W * 0.92, cabH, L * 0.42, 0, bottom + bodyH + cabH / 2, L * 0.12);
          box(glassMat, W * 0.94, cabH * 0.5, L * 0.44, 0, bottom + bodyH + cabH * 0.62, L * 0.12);
          for (const sx of [-1, 1]) box(bodyMat, 0.08, 0.4, L * 0.4, sx * (W / 2 - 0.04), bottom + bodyH + 0.2, -L * 0.28); // 荷台の柵
          box(bodyMat, W, 0.4, 0.08, 0, bottom + bodyH + 0.2, -L / 2 + 0.04);  // テールゲート
        } else {
          // ジープ: 低い開放キャビン + ロールバー + フロントガラス + 座席 + ハンドル + スペアタイヤ
          box(bodyMat, W * 0.9, cabH * 0.35, L * 0.5, 0, bottom + bodyH + cabH * 0.17, -L * 0.05);
          for (const sx of [-1, 1]) box(darkMat, 0.06, cabH, 0.06, sx * W * 0.42, bottom + bodyH + cabH / 2, -L * 0.05);
          box(darkMat, W * 0.9, 0.06, 0.06, 0, bottom + bodyH + cabH - 0.03, -L * 0.05);
          box(glassMat, W * 0.8, cabH * 0.5, 0.04, 0, bottom + bodyH + cabH * 0.5, L * 0.2);
          const sx0 = def.seat[0];
          for (const sx of [sx0, -sx0]) box(darkMat, 0.5, 0.45, 0.5, sx, bottom + bodyH + 0.22, def.seat[2] - 0.1);
          const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 20), darkMat);
          sw.position.set(sx0, bottom + bodyH + 0.55, def.seat[2] + 0.45);
          sw.rotation.x = -0.9;
          body.add(sw);
          const spare = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.25, 16), darkMat);
          spare.rotation.x = Math.PI / 2;
          spare.position.set(0, bottom + bodyH + r * 0.3, -L / 2 - 0.12);
          body.add(spare);
        }
        lampY = bottom + bodyH * 0.6;
      }
      // ヘッドライト（前 +Z）・テールライト（後ろ）。l = -X 側、r = +X 側
      const empty = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); group.add(o); return o; };
      for (const [side, sx] of [['l', -1], ['r', 1]]) {
        const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12), lampMat);
        hl.rotation.x = Math.PI / 2;
        hl.position.set(sx * W * 0.34, lampY, L / 2 + 0.01);
        body.add(hl);
        empty('headlight_' + side, hl.position.x, hl.position.y, hl.position.z);
        const tl = box(tailMat, 0.2, 0.08, 0.04, sx * W * 0.36, lampY, -L / 2 - 0.01);
        empty('taillight_' + side, tl.position.x, tl.position.y, tl.position.z);
      }
      // 車輪（軸はローカル X。ハブが原点）
      const wheelGeo = new THREE.CylinderGeometry(r, r, 0.28, 18);
      wheelGeo.rotateZ(Math.PI / 2);
      const hubGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.3, 12);
      hubGeo.rotateZ(Math.PI / 2);
      const wb = def.wheelbase, track = def.track || (W - 0.3);
      const rows = kind === 'apc' ? [['f', wb / 2], ['m', 0], ['r', -wb / 2]] : [['f', wb / 2], ['r', -wb / 2]];
      for (const [rowName, z] of rows) {
        for (const [side, sx] of [['l', -1], ['r', 1]]) {
          const w = new THREE.Group();
          w.name = 'wheel_' + rowName + side;
          w.position.set(sx * track / 2, r, z);
          w.add(new THREE.Mesh(wheelGeo, darkMat), new THREE.Mesh(hubGeo, hubMat));
          group.add(w);
        }
      }
      empty('seat_driver', def.seat[0], def.seat[1], def.seat[2]);
      empty('exit', def.exit[0], def.exit[1], def.exit[2]);
      empty('exhaust', -W * 0.3, 0.35, -L / 2);
      group.userData.source = 'procedural';
      return group;
    }

    // パース済み glTF の scene から複製（ジオメトリ・マテリアルは共有）。スケールは def.scale
    static fromScene(scene, def) {
      const clone = scene.clone(true);
      const s = num(def.scale, 1);
      if (s !== 1) clone.scale.multiplyScalar(s);
      clone.position.set(0, 0, 0);
      clone.userData.source = 'glb';
      return clone;
    }

    _loadModel() {
      const a = this.assets, file = this.def.model;
      if (!a || !file || typeof a.loadModel !== 'function') return;
      const key = typeof a.resolve === 'function' ? a.resolve(file) : ((typeof a.has === 'function' && a.has(file)) ? file : null);
      if (!key) return;
      this.modelReady = Promise.resolve().then(() => a.loadModel(key)).then((res) => {
        const scene = res && res.scene && res.scene.isObject3D ? res.scene : (res && res.isObject3D ? res : null);
        if (!scene) throw new Error('scene が空です: ' + key);
        let meshes = 0;
        scene.traverse((o) => { if (o.isMesh) meshes++; });
        if (!meshes) throw new Error('メッシュが無い: ' + key);
        if (this.disposed) return;
        const g = this.constructor.fromScene(scene, this.def);
        g.userData.file = key;
        this._setModel(g, 'glb');
      }).catch((e) => {
        console.warn('[Vehicle] ' + key + ' を読めません。コードモデルで続行します:', e && e.message);
      });
    }

    // モデルを差し替え、名前付きノード（車輪・座席・ライト）を拾う
    _setModel(group, source) {
      const wasWrecked = this.wrecked;
      if (this.model) {
        if (wasWrecked) this._setWreckLook(false);
        this.root.remove(this.model);
        if (this.modelSource === 'procedural') Vehicle._disposeProcedural(this.model);
      }
      this.model = group;
      this.modelSource = source;
      group.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      group.updateMatrixWorld(true); // 親無し → matrixWorld がグループのローカル座標
      const d = this.def;
      const L = d.length, W = d.width, H = d.height;
      const fallback = {
        seat_driver: new THREE.Vector3(d.seat[0], d.seat[1], d.seat[2]),
        exit: new THREE.Vector3(d.exit[0], d.exit[1], d.exit[2]),
        headlight_l: new THREE.Vector3(-W * 0.34, H * 0.45, L / 2),
        headlight_r: new THREE.Vector3(W * 0.34, H * 0.45, L / 2),
        taillight_l: new THREE.Vector3(-W * 0.36, H * 0.4, -L / 2),
        taillight_r: new THREE.Vector3(W * 0.36, H * 0.4, -L / 2),
        exhaust: new THREE.Vector3(-W * 0.3, 0.35, -L / 2)
      };
      this.nodes = {};
      for (const name of EMPTY_NAMES) {
        const node = group.getObjectByName(name);
        this.nodes[name] = node ? new THREE.Vector3().setFromMatrixPosition(node.matrixWorld) : fallback[name];
      }
      // seatFromConfig: GLB の seat_driver を使わず設定の seat を目の位置にする（装甲車はハッチから頭を出して運転する）
      if (d.seatFromConfig) this.nodes.seat_driver = fallback.seat_driver;
      // 座席: [{ node, exitNode, seat, exit }]。ノードが GLB にあればその位置、無ければ seat / exit
      const seats = Array.isArray(d.seats) && d.seats.length ? d.seats : [{ node: 'seat_driver', exitNode: 'exit' }];
      this.seatLocals = []; this.exitLocals = [];
      for (let i = 0; i < seats.length; i++) {
        const st = seats[i] || {};
        const nodePos = (name) => { if (!name) return null; if (i === 0 && name === 'seat_driver') return this.nodes.seat_driver; if (i === 0 && name === 'exit') return this.nodes.exit;
          const n = group.getObjectByName(name); return n ? new THREE.Vector3().setFromMatrixPosition(n.matrixWorld) : null; };
        const a = arr3(st.seat, null), e = arr3(st.exit, null);
        let sp = (i === 0 && d.seatFromConfig) ? this.nodes.seat_driver : nodePos(st.node);
        if (!sp) sp = a ? new THREE.Vector3(a[0], a[1], a[2]) : this.nodes.seat_driver.clone();
        let ep = nodePos(st.exitNode);
        if (!ep) ep = e ? new THREE.Vector3(e[0], e[1], e[2]) : new THREE.Vector3(sp.x >= 0 ? W / 2 + 1 : -W / 2 - 1, 0, sp.z);
        this.seatLocals.push(sp); this.exitLocals.push(ep);
      }
      this.wheels = [];
      for (const name of WHEEL_NAMES) {
        const node = group.getObjectByName(name);
        if (node) this.wheels.push({ node, q0: node.quaternion.clone(), spin: 0, front: /^wheel_f/.test(name) });
      }
      this.bodyNode = group.getObjectByName('body') || group;
      this._bodyRot = this.bodyNode.rotation.clone();
      this.root.add(group);
      if (wasWrecked) this._setWreckLook(true);
      if (this.headlight) this._placeHeadlight(this.headlight);
    }

    static _disposeProcedural(group) {
      const geos = new Set(), mats = new Set();
      group.traverse((o) => { if (o.isMesh) { if (o.geometry) geos.add(o.geometry); if (o.material) mats.add(o.material); } });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    }

    // ---------- 座標 ----------

    // ローカル → 世界（root の位置とヨーだけ。車体の傾きは含めない。地形モードでは傾き（pitch / roll）も含める）
    toWorld(local, target) {
      if (this.terrain && (this.pitch || this.roll)) {
        const e = this._euler2 || (this._euler2 = new THREE.Euler(0, 0, 0, 'YXZ'));
        e.set(this.pitch, this.yaw, this.roll, 'YXZ');
        const v = (target || new THREE.Vector3()).set(local.x, local.y + this.model.position.y, local.z).applyEuler(e);
        return v.add(this.pos);
      }
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      return (target || new THREE.Vector3()).set(
        this.pos.x + local.x * c + local.z * s,
        this.pos.y + local.y + this.model.position.y,
        this.pos.z - local.x * s + local.z * c
      );
    }

    // 世界の点 (x, z) → ローカル (lx, lz)
    toLocal(x, z) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const dx = x - this.pos.x, dz = z - this.pos.z;
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    }

    forward(target) { return (target || new THREE.Vector3()).set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

    // 車体（回転した長方形）を囲む世界座標の AABB { x, z, w, d }（nav の経路探索用）
    aabb() {
      const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw));
      const hw = this.def.width / 2, hl = this.def.length / 2;
      const b = { x: this.pos.x, z: this.pos.z, w: 2 * (hw * c + hl * s), d: 2 * (hw * s + hl * c) };
      if (this.terrain) { b.y = this.pos.y; b.h = this.def.height; }
      return b;
    }
    // 座席 i（省略で運転席）の目の位置 / 降りる位置。seatWorld(target) の古い呼び方も通す
    seatWorld(i, target) {
      if (typeof i !== 'number') { target = i; i = 0; }
      const L = (this.seatLocals && this.seatLocals[i]) || this.nodes.seat_driver;
      return this.toWorld(L, target);
    }
    exitWorld(i, target) {
      if (typeof i !== 'number') { target = i; i = 0; }
      const L = (this.exitLocals && this.exitLocals[i]) || this.nodes.exit;
      return this.toWorld(L, target);
    }
    get seatCount() { return this.seatLocals ? this.seatLocals.length : 1; }
    seatOf(who) { for (let i = 0; i < this.occupants.length; i++) if (who && this.occupants[i] === who) return i; return -1; }
    // 空いている座席（運転席から）。無ければ -1
    freeSeat() { for (let i = 0; i < this.seatCount; i++) if (!this.occupants[i]) return i; return -1; }

    // 降りる所（足元）: 座席 i の出口 → 他の座席の出口 → 車の周り → nav.nearestFree。nav は Nav3D（街）か MR.Nav。
    // 戻り値 { x, y, z }（y は立てる面。無ければ水面より下の値ではなく null → 呼ぶ側が水に浮かべる）
    findExit(i, nav, r) {
      r = r || 0.4;
      const order = [i || 0];
      for (let k = 0; k < this.seatCount; k++) if (order.indexOf(k) < 0) order.push(k);
      const tmp = new THREE.Vector3();
      const tryAt = (x, z, yRef) => {
        if (this.distanceTo(x, z) < r + 0.05) return null;
        if (typeof nav.resolveCapsule === 'function') {
          const g = nav.groundHeight(x, z, yRef + 1.2, r * 0.5);
          if (g === null) return (nav.waterLevelAt && nav.waterLevelAt(x, z) !== null) ? { x, y: null, z } : null;
          if (Math.abs(g - yRef) > 2.5) return null;
          const q = nav.resolveCapsule({ x, y: g, z }, r, 1.8, 0.45, { snapDown: 0.1 });
          if (Math.hypot(q.x - x, q.z - z) > 0.15) return null;
          return { x: q.x, y: q.y, z: q.z };
        }
        const q = nav.resolveCircle(x, z, r);
        return Math.hypot(q.x - x, q.z - z) > 0.15 ? null : { x: q.x, y: 0, z: q.z };
      };
      for (const k of order) {
        const e = this.exitWorld(k, tmp);
        const res = tryAt(e.x, e.z, this.pos.y);
        if (res) return res;
      }
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const W = this.def.width / 2 + r + 0.3, L = this.def.length / 2 + r + 0.3;
      for (const [lx, lz] of [[W, 0], [-W, 0], [0, L], [0, -L], [W, L], [-W, L], [W, -L], [-W, -L]]) {
        const x = this.pos.x + lx * c + lz * s, z = this.pos.z - lx * s + lz * c;
        const res = tryAt(x, z, this.pos.y);
        if (res) return res;
      }
      const f = nav.nearestFree(this.pos.x, this.pos.z, 8, this.pos.y);
      return { x: f.x, y: typeof nav.groundHeight === 'function' ? nav.groundHeight(f.x, f.z, this.pos.y + 1.2, r * 0.5) : 0, z: f.z };
    }
    center(target) { return (target || new THREE.Vector3()).set(this.pos.x, this.pos.y + this.def.height * 0.5, this.pos.z); }
    get speedKmh() { return Math.abs(this.speed) * 3.6; }
    get speedRatio() { return clamp(Math.abs(this.speed) / this.def.maxSpeed, 0, 1); }

    // 点 (x, z) から車体（長方形）までの距離（中なら 0）
    distanceTo(x, z) {
      const l = this.toLocal(x, z);
      const dx = Math.max(0, Math.abs(l.x) - this.def.width / 2);
      const dz = Math.max(0, Math.abs(l.z) - this.def.length / 2);
      return Math.sqrt(dx * dx + dz * dz);
    }

    // 半径 radius の円（p.x / p.z を書き換える）を車体の外へ押し出す。押したら true
    pushOut(p, radius) {
      const hw = this.def.width / 2 + radius, hl = this.def.length / 2 + radius;
      const l = this.toLocal(p.x, p.z);
      if (Math.abs(l.x) >= hw || Math.abs(l.z) >= hl) return false;
      const penX = hw - Math.abs(l.x), penZ = hl - Math.abs(l.z);
      let lx = l.x, lz = l.z;
      if (penX < penZ) lx += (lx >= 0 ? 1 : -1) * penX;
      else lz += (lz >= 0 ? 1 : -1) * penZ;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      p.x = this.pos.x + lx * c + lz * s;
      p.z = this.pos.z - lx * s + lz * c;
      return true;
    }

    // 他の乗り物の円（x, z, r）を自分の円の外へ押し出す（相手の update から呼ばれる）
    _pushCircle(x, z, r) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const minD = r + this.hull.r;
      for (const zOff of this.hull.z) {
        const cx = this.pos.x + zOff * s, cz = this.pos.z + zOff * c;
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        x += dx / d * push; z += dz / d * push;
      }
      return { x, z };
    }

    // 弾（レイ）との当たり。車体の箱（ローカル）で判定。戻り値 { t, point, normal } か null
    intersectRay(origin, dir, maxT) {
      if (!MR.Nav || typeof MR.Nav.rayBox !== 'function') return null;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const dx = origin.x - this.pos.x, dz = origin.z - this.pos.z;
      const ox = dx * c - dz * s, oz = dx * s + dz * c, oy = origin.y - this.pos.y - this.model.position.y;
      const ddx = dir.x * c - dir.z * s, ddz = dir.x * s + dir.z * c;
      const hw = this.def.width / 2, hl = this.def.length / 2;
      const minY = this.def.wheelRadius * 0.4, maxY = this.def.height;
      const t = MR.Nav.rayBox(ox, oy, oz, ddx, dir.y, ddz, -hw, minY, -hl, hw, maxY, hl);
      if (t === null || t < 0 || t > maxT) return null;
      const lx = ox + ddx * t, ly = oy + dir.y * t, lz = oz + ddz * t;
      // 一番近い面の法線
      const faces = [
        [Math.abs(lx + hw), -1, 0, 0], [Math.abs(lx - hw), 1, 0, 0],
        [Math.abs(ly - minY), 0, -1, 0], [Math.abs(ly - maxY), 0, 1, 0],
        [Math.abs(lz + hl), 0, 0, -1], [Math.abs(lz - hl), 0, 0, 1]
      ];
      let f = faces[0];
      for (const g of faces) if (g[0] < f[0]) f = g;
      const normal = new THREE.Vector3(f[1] * c + f[3] * s, f[2], -f[1] * s + f[3] * c);
      return { t, point: origin.clone().addScaledVector(dir, t), normal };
    }

    // ---------- 乗り降り ----------

    // 乗る。seatIndex: 省略 = 運転席（今まで通り、いても入れ替わる）、-1 = 最初の空いた座席、数 = その座席（埋まっていれば false）。
    // 運転席ならエンジンが掛かる
    enter(player, seatIndex) {
      if (this.wrecked || this.sinking) return false;
      const i = seatIndex === -1 ? this.freeSeat() : (typeof seatIndex === 'number' ? seatIndex : 0);
      if (i < 0 || i >= this.seatCount) return false;
      if (typeof seatIndex === 'number' && this.occupants[i] && this.occupants[i] !== player) return false;
      this.occupants[i] = player;
      this._sound('vehicle_door', 0.8);
      if (i === 0) {
        this.throttle = 0; this.steerInput = 0;
        this.rpm = 0;
        this._sound('engine_start', 0.7);
        if (this.audio && typeof this.audio.prepareEngine === 'function') this.audio.prepareEngine();
      }
      return true;
    }

    // 降りる。who を省略すると運転手
    exit(who) {
      const i = who ? this.seatOf(who) : 0;
      if (i > 0) this.occupants[i] = null;
      else this.clearDriver();
      this._sound('vehicle_door', 0.8);
    }

    // 運転手を外す（音は鳴らさない。オンラインの再接続で、いつの間にか降りていた他の人の運転手を消すとき）。エンジン音も止める
    clearDriver() {
      this.driver = null;
      this.throttle = 0; this.steerInput = 0;
      this._stopEngine();
    }

    // 運転入力（毎フレーム）。throttle: 前が正、steer: 右が正
    setControls(throttle, steer) {
      this.throttle = clamp(num(throttle, 0), -1, 1);
      this.steerInput = clamp(num(steer, 0), -1, 1);
    }

    horn() {
      if (this.time - this.lastHorn < this.common.hornCooldown) return;
      this.lastHorn = this.time;
      this._sound('horn', 0.9, null, { refDistance: 8, maxDistance: 150 });
    }

    // ヘッドライト（game.js が 1 灯を貸す。ライト数を変えないためシーンに常にある）
    attachHeadlight(light) {
      if (!light) return;
      this.headlight = light;
      this._placeHeadlight(light);
    }

    _placeHeadlight(light) {
      const l = this.nodes.headlight_l, r = this.nodes.headlight_r;
      this.root.add(light);
      this.root.add(light.target);
      light.position.set((l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2 + 0.05);
      light.target.position.set(light.position.x, 0.2, light.position.z + 18);
    }

    detachHeadlight() {
      const l = this.headlight;
      if (!l) return null;
      this.headlight = null;
      l.intensity = 0;
      this.root.remove(l);
      this.root.remove(l.target);
      return l;
    }

    // ---------- ダメージ ----------

    // 弾などのダメージ（armor を掛ける）。爆発したら true
    hit(amount, point, ctx) {
      return this.damage(num(amount, 0) * this.def.armor, ctx);
    }

    damage(amount, ctx) {
      if (this.wrecked || amount <= 0 || this.netControlled) return false;
      this.health = Math.max(0, this.health - amount);
      if (this.health <= 0) { this._explode(ctx); return true; }
      return false;
    }

    _explode(ctx) {
      this.wrecked = true;
      this.health = 0;
      this.speed = 0; this.yawRate = 0; this.throttle = 0; this.steerInput = 0;
      this.respawnTimer = this.def.respawn;
      const c = this.center(this._tmp);
      this._sound('vehicle_explode', 1, c, { refDistance: 12, maxDistance: 220 });
      this._explodeFx(c);
      this._setWreckLook(true);
      this._stopEngine();
      if (ctx && typeof ctx.onExplode === 'function') ctx.onExplode(this); // game.js: 運転手を降ろし、周囲にダメージ
      this.driver = null;
      this._apply();
    }

    // 爆発の見た目（戦闘機は jet.js で上書き: 大きさと粒の数）
    _explodeFx(c) { if (this.fx && typeof this.fx.explosion === 'function') this.fx.explosion(c, this.def.width * 1.4); }

    _setWreckLook(on) {
      if (on) {
        if (this._wreckMats) return;
        this._wreckMats = [];
        this.model.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const orig = o.material;
          const mats = Array.isArray(orig) ? orig : [orig];
          const dark = mats.map((m) => {
            const k = m.clone();
            if (k.color) k.color.multiplyScalar(0.22);
            if (k.emissive) { k.emissive.setRGB(0, 0, 0); k.emissiveIntensity = 0; }
            if ('roughness' in k) k.roughness = 0.95;
            if ('metalness' in k) k.metalness = 0.2;
            return k;
          });
          this._wreckMats.push({ mesh: o, orig });
          o.material = Array.isArray(orig) ? dark : dark[0];
        });
        this.model.position.y = -0.1;
        this.bodyNode.rotation.z = this._bodyRot.z + 0.05;
      } else {
        if (this._wreckMats) {
          for (const w of this._wreckMats) {
            const cur = w.mesh.material;
            w.mesh.material = w.orig;
            (Array.isArray(cur) ? cur : [cur]).forEach((m) => { if (m && m !== w.orig) m.dispose(); });
          }
        }
        this._wreckMats = null;
        this.model.position.y = 0;
        this.bodyNode.rotation.copy(this._bodyRot);
      }
    }

    respawn() {
      this.wrecked = false;
      this.health = this.def.health;
      this.pos.copy(this.spawnPos);
      this.yaw = this.spawnYaw;
      this.speed = 0; this.steer = 0; this.yawRate = 0; this.accelSmooth = 0; this.latSmooth = 0;
      if (this.terrain) { this.vy = 0; this.pitch = 0; this.roll = 0; this.airborne = false; this._lastY = null; }
      this.sinking = null;
      if (this.sunk) { this.sunk = false; this.root.visible = true; }
      for (const w of this.wheels) w.spin = 0;
      this._setWreckLook(false);
      this._apply();
    }

    // ---------- オンライン ----------

    // サーバーの HP（vdamage / welcome）
    setHealth(hp) {
      if (typeof hp === 'number' && isFinite(hp)) this.health = clamp(hp, 0, this.def.health);
    }

    // サーバーが爆発を決めた（vexplode）。見た目・音と ctx.onExplode（game.js が運転手を降ろす）
    netExplode(ctx) {
      if (this.wrecked) return false;
      this._explode(ctx);
      return true;
    }

    // 途中参加で最初から残骸だった（welcome）: 音・爆発の演出なしで残骸にする
    netWreck() {
      if (this.wrecked) return;
      this.wrecked = true;
      this.health = 0;
      this.speed = 0; this.yawRate = 0; this.throttle = 0; this.steerInput = 0;
      this.respawnTimer = this.def.respawn;
      this.driver = null;
      this._setWreckLook(true);
      this._stopEngine();
      this._apply();
    }

    // サーバーの復活（vrespawn）: 位置・向き・HP はサーバーのもの
    netRespawn(x, z, yaw, hp) {
      this.respawn();
      if (typeof x === 'number' && isFinite(x) && typeof z === 'number' && isFinite(z)) this.pos.set(x, this.pos.y, z);
      if (typeof yaw === 'number' && isFinite(yaw)) this.yaw = yaw;
      this.setHealth(typeof hp === 'number' ? hp : this.def.health);
      this._apply();
    }

    // 他の人が運転している車: 物理は回さず、補間した位置・向きに置く。車輪は速度で回り、舵角で切れる。エンジン音も鳴らす
    // 街（3D の行）: y / pitch / roll も（地形モードの車体の傾き）
    netPose(x, z, yaw, speed, steer, dt, y, pitch, roll) {
      this.time += dt;
      if (this.disposed || this.wrecked) return;
      const prevV = this.speed;
      const prevYaw = this.yaw;
      this.pos.x = num(x, this.pos.x); this.pos.z = num(z, this.pos.z);
      if (typeof y === 'number' && isFinite(y)) this.pos.y = y;
      if (typeof pitch === 'number' && isFinite(pitch)) this.pitch = pitch;
      if (typeof roll === 'number' && isFinite(roll)) this.roll = roll;
      this.yaw = num(yaw, this.yaw);
      this.speed = num(speed, 0);
      this.steer = num(steer, 0);
      let dy = this.yaw - prevYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yawRate = dt > 0 ? dy / dt : 0;
      if (dt > 0) {
        this.accelSmooth += ((this.speed - prevV) / dt - this.accelSmooth) * Math.min(1, dt * 6);
        this.latSmooth += (this.speed * this.yawRate - this.latSmooth) * Math.min(1, dt * 6);
      }
      for (const w of this.wheels) w.spin = (w.spin + this.speed / this.def.wheelRadius * dt) % (Math.PI * 2);
      this._apply();
      this._engine(dt, !!this.driver, Math.abs(this.speed) > 0.5 ? 0.5 : 0);
    }

    // オンラインの街: 行が来ない（止まっている・遠い）乗り物は最後の位置のまま（物理は回さない。運転手がいればエンジン音だけ）
    netIdle(dt) {
      this.time += dt;
      if (this.disposed) return;
      this.speed = 0;
      this._engine(dt, !!this.driver && !this.wrecked, 0);
    }

    // サーバーが「沈んだ」と決めた（vexplode how: 'sunk'）: 爆発はしない。見えなくして復活を待つ
    netSunk() {
      this.sinking = null;
      this.sunk = true;
      this.wrecked = true;
      this.health = 0;
      this.speed = 0;
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.root.visible = false;
      this._stopEngine();
    }

    // ---------- 更新 ----------

    update(dt, ctx) {
      this.time += dt;
      if (this.disposed) return;
      if (this.wrecked) { this._updateWreck(dt, ctx); return; }
      if (this.sinking) { this._updateSink(dt, ctx); return; }
      const d = this.def;
      const driving = !!this.driver;
      const th = (driving && !this.airborne) ? this.throttle : 0; // 空中ではアクセルもハンドルも効かない
      const si = (driving && !this.airborne) ? this.steerInput : 0;
      let v = this.speed;
      const prevV = v;

      // 加減速
      if (this.airborne) {
        // 惰性のまま
      } else if (th > 0.02) {
        v += (v >= 0 ? d.accel : d.brake) * th * dt;
      } else if (th < -0.02) {
        v += (v > 0 ? d.brake : d.accel * d.reverseAccel) * th * dt;
      } else {
        const dec = d.rolling * dt;
        v = Math.abs(v) <= dec ? 0 : v - Math.sign(v) * dec;
      }
      v -= v * d.drag * dt;
      v = clamp(v, -d.maxReverse, d.maxSpeed);

      // ハンドル（速いほど切れ角を抑える）。右が正の舵角 → ヨーは減る（+Z 向きのとき右は -X）
      const steerMax = THREE.MathUtils.degToRad(d.maxSteer) * THREE.MathUtils.lerp(1, d.highSpeedSteer, this.speedRatio);
      this.steer += (si * steerMax - this.steer) * Math.min(1, dt * d.steerSpeed);
      this.yawRate = Math.abs(v) > 0.01 ? -(v / d.wheelbase) * Math.tan(this.steer) : 0;
      this.yaw += this.yawRate * dt;

      // 移動 + 当たり
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const col = this._collide(this.pos.x + fx * v * dt, this.pos.z + fz * v * dt, fx, fz, ctx);
      if (col.hit) {
        if (col.frontal > 0.45) {
          const impact = Math.abs(v);
          v = -v * d.bounce;
          if (impact >= d.impactSpeed && this.time - this.lastImpact > 0.35) this._impact(impact, col, ctx);
        } else {
          v -= v * d.scrape * dt;
          if (Math.abs(v) > 5 && this.time - this.lastSkid > 0.7) { this.lastSkid = this.time; this._sound('tire_skid', 0.5); }
        }
        this.yaw += col.spin;
      }
      this.pos.x = col.x; this.pos.z = col.z;
      this.speed = v;
      // 街: 地面の高さ・傾き・落下・水没
      if (this.terrain) { this._terrainStep(dt, ctx); if (this.sinking) { this._apply(); this._engine(dt, false, 0); return; } }

      // 敵をはねる / 押す
      if (ctx && ctx.enemies) this._enemies(ctx, fx, fz);

      // 車体の揺れ（加減速で前後、旋回で左右）
      const accel = (v - prevV) / Math.max(1e-3, dt);
      this.accelSmooth += (accel - this.accelSmooth) * Math.min(1, dt * 6);
      this.latSmooth += (v * this.yawRate - this.latSmooth) * Math.min(1, dt * 6);

      // 車輪: 転がり（軸 X）と前輪の舵角（Y）
      for (const w of this.wheels) w.spin = (w.spin + v / d.wheelRadius * dt) % (Math.PI * 2);

      this._apply();
      this._engine(dt, driving, th);
    }

    // 車体の円を箱・他の乗り物から押し出す。戻り値 { x, z, hit, frontal(0..1), spin(rad), px, pz, nx, nz }
    _collide(nx, nz, fx, fz, ctx) {
      const nav = ctx && ctx.nav;
      const vehicles = ctx && ctx.vehicles;
      const r = this.hull.r;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      let pushX = 0, pushZ = 0, spin = 0, hits = 0, frontal = 0, best = 0;
      let px = nx, pz = nz, bnx = 0, bnz = 0;
      for (const zOff of this.hull.z) {
        const cx = nx + fx * zOff, cz = nz + fz * zOff;
        let sx = cx, sz = cz;
        if (nav) {
          // 街: 車高の帯（climb 〜 height）にかかる箱だけ（縁石は乗り越え、高架の下はくぐる）。帯はその円の下の地面から測る
          // （斜路の継ぎ目で、車体の中心より高い前の円が次の斜路の端を壁と思わないように）
          let sol;
          if (this.terrain) {
            const gy = typeof nav.groundHeight === 'function' ? nav.groundHeight(cx, cz, this.pos.y + 0.3, r * 0.5) : null;
            sol = nav.resolveCircle(cx, cz, r, gy === null ? this.pos.y : Math.max(this.pos.y - 0.5, gy), this.def.climb, this.def.height);
          } else sol = nav.resolveCircle(cx, cz, r);
          sx = sol.x; sz = sol.z;
        }
        if (vehicles) {
          for (const o of vehicles) {
            if (o === this || o.disposed) continue;
            if (this.terrain && Math.abs(o.pos.y - this.pos.y) > 2) continue; // 高架の上と下
            const p = o._pushCircle(sx, sz, r);
            sx = p.x; sz = p.z;
          }
        }
        const dx = sx - cx, dz = sz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1e-8) continue;
        const len = Math.sqrt(d2);
        pushX += dx; pushZ += dz; hits++;
        frontal = Math.max(frontal, Math.abs((dx * fx + dz * fz) / len));
        const lat = dx * c - dz * s;                  // ローカル +X 方向への押し（m）
        spin += lat * zOff * this.def.collisionSpin;   // 前を +X に押されたら +X 側へ回る（ヨー増）
        if (len > best) { best = len; px = cx - dx / len * r; pz = cz - dz / len * r; bnx = dx / len; bnz = dz / len; }
      }
      if (!hits) return { x: nx, z: nz, hit: false, frontal: 0, spin: 0 };
      return { x: nx + pushX / hits, z: nz + pushZ / hits, hit: true, frontal, spin: clamp(spin, -0.08, 0.08), px, pz, nx: bnx, nz: bnz };
    }

    _impact(impact, col, ctx) {
      const d = this.def;
      this.lastImpact = this.time;
      const point = this._tmp2.set(col.px, this.pos.y + 0.6, col.pz);
      const strength = clamp(impact / d.maxSpeed, 0.35, 1);
      this._sound('vehicle_impact', strength, point, { refDistance: 6 });
      if (this.fx) {
        const n = this._tmp3.set(col.nx, 0.2, col.nz).normalize();
        this.fx.impact(point, n);
        if (typeof this.fx.smoke === 'function') this.fx.smoke(point, 0.6);
      }
      if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, impact);
      this.damage(Math.max(0, impact - d.impactSpeed * 0.5) * d.impactDamage, ctx);
    }

    _enemies(ctx, fx, fz) {
      const d = this.def;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const hw = d.width / 2, hl = d.length / 2;
      const fast = Math.abs(this.speed) >= d.runOverSpeed;
      for (const e of ctx.enemies) {
        if (!e || e.dead || e.removed) continue;
        if (this.terrain && Math.abs((e.pos.y || 0) - this.pos.y) > 1.6) continue; // 高さの違う敵（屋上・高架の下）
        const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const er = e.radius || 0.45;
        if (Math.abs(lx) >= hw + er || Math.abs(lz) >= hl + er) continue;
        if (fast && typeof e.takeDamage === 'function') {
          const sgn = this.speed >= 0 ? 1 : -1;
          const dir = this._tmp2.set(fx * sgn, 0.35, fz * sgn).normalize();
          const p = this._tmp3.set(e.pos.x, (e.pos.y || 0) + 0.9, e.pos.z);
          const killed = e.takeDamage(d.runOverDamage, dir);
          if (this.fx) this.fx.hitFlesh(p, dir);
          if (this.audio && typeof this.audio.impact === 'function') this.audio.impact('flesh', p);
          if (killed && typeof ctx.onKill === 'function') ctx.onKill(e, this);
          this.speed *= d.runOverSlow;
          if (killed) continue; // 倒れた敵はその場に（車の下に）残す
        }
        this.pushOut(e.pos, er);
      }
    }

    // ---------- 地形（街）----------

    // 4 つの車輪の下の立てる面（nav.groundHeight）。2 輪以上が支えていれば高さ・前後・左右の傾きをそれに合わせ、
    // そうでなければ落ちる（着地の速さで landingSpeed を超えた分のダメージ）。水面より沈んだら水没を始める
    _terrainStep(dt, ctx) {
      const nav = ctx && ctx.nav;
      if (!nav || typeof nav.groundHeight !== 'function') return;
      const d = this.def, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const hw = (d.track || d.width - 0.3) / 2, hl = d.wheelbase / 2;
      const S = this._samp || (this._samp = [0, 0, 0, 0]);
      const P = Vehicle._WHEEL_PTS;
      const lim = this.pos.y + 0.1;
      let nSup = 0, maxS = -Infinity;
      for (let i = 0; i < 4; i++) {
        const lx = P[i][0] * hw, lz = P[i][1] * hl;
        const g = nav.groundHeight(this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c, lim, 0.2);
        S[i] = g === null ? -Infinity : g;
        if (g !== null && g >= this.pos.y - 0.4) nSup++;
        if (S[i] > maxS) maxS = S[i];
      }
      const prevY = this._lastY == null ? this.pos.y : this._lastY;
      if (!this.airborne && nSup >= 2) {
        const h = (k) => Math.max(S[k], this.pos.y - 0.4); // 浮いた車輪は 0.4 m 下がった所（サスペンションが伸びきり）
        const front = (h(0) + h(1)) / 2, rear = (h(2) + h(3)) / 2, left = (h(0) + h(2)) / 2, right = (h(1) + h(3)) / 2;
        const ty = (front + rear) / 2;
        this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 18);
        const tp = clamp(-Math.atan2(front - rear, 2 * hl), -0.6, 0.6), tr = clamp(Math.atan2(right - left, 2 * hw), -0.5, 0.5);
        const k = Math.min(1, dt * 10);
        this.pitch += (tp - this.pitch) * k; this.roll += (tr - this.roll) * k;
        this.vy = dt > 0 ? (this.pos.y - prevY) / dt : 0;
      } else {
        if (!this.airborne) { this.airborne = true; this.vy = Math.max(-5, Math.min(8, this.vy)); }
        this.vy = Math.max(-50, this.vy - 20 * dt);
        const yNew = this.pos.y + this.vy * dt;
        this.pitch += (clamp(-this.vy * 0.02, -0.35, 0.35) - this.pitch) * Math.min(1, dt * 1.5);
        if (maxS > -Infinity && yNew <= maxS && this.vy <= 0) {
          // 着地
          const impact = -this.vy;
          this.pos.y = maxS;
          this.airborne = false;
          this.vy = 0;
          if (impact > 3) this._sound('vehicle_impact', clamp(impact / 15, 0.3, 1), null, { refDistance: 6 });
          if (ctx && typeof ctx.onImpact === 'function' && impact > 4) ctx.onImpact(this, impact);
          if (impact > d.landingSpeed) this.damage((impact - d.landingSpeed) * d.landingDamage, ctx);
          this.speed *= impact > d.landingSpeed ? 0.6 : 0.9;
        } else this.pos.y = yNew;
      }
      this._lastY = this.pos.y;
      // 水: 車体の 35 % が水面より下 → 沈み始める
      const water = typeof nav.waterLevelAt === 'function' ? nav.waterLevelAt(this.pos.x, this.pos.z) : null;
      if (water !== null && this.pos.y + d.height * 0.35 < water && !this.sinking && !this.wrecked) this._startSink(ctx, water);
    }

    _startSink(ctx, water) {
      this.sinking = { t: 0, y0: this.pos.y, water, ejected: false };
      this.speed *= 0.35;
      this.vy = 0;
      if (this.audio && typeof this.audio.splash === 'function') this.audio.splash(this.center(this._tmp), true);
      if (this.fx && typeof this.fx.splash === 'function') this.fx.splash(this._tmp.set(this.pos.x, water + 0.05, this.pos.z), 2.6);
      this._stopEngine();
      if (ctx && typeof ctx.onSink === 'function') ctx.onSink(this);
    }

    // 沈む: sinkTime 秒で車体が水面の下へ。目（運転席）が水面に着いたら ctx.onSinkEject（game.js が運転手を水へ出す）、
    // 沈みきったら壊れる（爆発はしない。見えなくして復活を待つ）
    _updateSink(dt, ctx) {
      const sk = this.sinking, d = this.def;
      sk.t += dt;
      const u = Math.min(1, sk.t / d.sinkTime);
      this.speed *= Math.max(0, 1 - dt * 1.5);
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      this.pos.y = sk.y0 + ((sk.water - d.height - 1.5) - sk.y0) * (u * u * (3 - 2 * u));
      this.pitch += (0.3 - this.pitch) * Math.min(1, dt);
      // 泡（沈んでいく間、水面に小さなしぶき）
      sk.bub = (sk.bub || 0) - dt;
      if (sk.bub <= 0 && this.fx && typeof this.fx.splash === 'function') { sk.bub = 0.35; this.fx.splash(this._tmp.set(this.pos.x + (Math.random() - 0.5) * this.def.width, sk.water + 0.03, this.pos.z + (Math.random() - 0.5) * this.def.length * 0.6), 0.5 + (1 - u) * 0.6); }
      if (!sk.ejected && (this.driver || this.occupants.some((o) => o))) {
        const eye = this.seatWorld(0, this._tmp2);
        if (eye.y < sk.water + 0.35 || u > 0.5) {
          sk.ejected = true;
          if (ctx && typeof ctx.onSinkEject === 'function') ctx.onSinkEject(this);
        }
      }
      if (u >= 1) {
        this.sinking = null;
        this.sunk = true;
        this.wrecked = true;
        this.health = 0;
        this.speed = 0;
        this.respawnTimer = d.respawn;
        this.root.visible = false;
        for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
        this._stopEngine();
        if (ctx && typeof ctx.onSunk === 'function') ctx.onSunk(this);
      }
      this._apply();
    }

    _updateWreck(dt, ctx) {
      this.respawnTimer -= dt;
      this.smokeTimer -= dt;
      if (this.fx && !this.sunk && this.smokeTimer <= 0 && this.respawnTimer > this.def.respawn * 0.25) {
        this.smokeTimer = 0.09 + Math.random() * 0.06;
        const c = this.center(this._tmp);
        c.x += (Math.random() - 0.5) * this.def.width * 0.6;
        c.z += (Math.random() - 0.5) * this.def.length * 0.5;
        if (typeof this.fx.smoke === 'function') this.fx.smoke(c, 0.5 + Math.random() * 0.4);
        if (typeof this.fx.flame === 'function' && Math.random() < 0.5) this.fx.flame(c);
      }
      if (this.respawnTimer <= 0 && !this.netControlled) {
        const p = ctx && ctx.player;
        const far = !p || Math.hypot(p.pos.x - this.spawnPos.x, p.pos.z - this.spawnPos.z) > 14;
        if (far || this.respawnTimer < -this.def.respawn) this.respawn();
      }
    }

    _apply() {
      this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.root.rotation.y = this.yaw;
      if (this.terrain) { this.root.rotation.x = this.pitch; this.root.rotation.z = this.roll; }
      if (!this.wrecked && this.bodyNode && this._bodyRot) {
        const d = this.def;
        this.bodyNode.rotation.x = this._bodyRot.x + clamp(-this.accelSmooth * d.pitchGain, -0.06, 0.06);
        this.bodyNode.rotation.z = this._bodyRot.z + clamp(this.latSmooth * d.rollGain, -0.07, 0.07);
      }
      for (const w of this.wheels) {
        this._euler.set(w.spin, w.front ? -this.steer : 0, 0, 'YXZ');
        w.node.quaternion.copy(w.q0).multiply(this._q.setFromEuler(this._euler));
      }
      if (this.headlight) this.headlight.intensity = (this.driver && !this.wrecked) ? this.common.headlightIntensity : 0;
    }

    // ---------- 音 ----------

    _sound(name, volume, pos, extra) {
      if (!this.audio || typeof this.audio.play !== 'function') return null;
      try {
        return this.audio.play(name, Object.assign({ volume: volume == null ? 1 : volume, pos: pos || this.pos }, extra || {}));
      } catch (e) { return null; }
    }

    _engine(dt, driving, th) {
      // 誰も運転していないのにエンジン音が残っていたら止める（どの経路で運転手が外れても鳴りっぱなしにしない）
      if (!driving) { if (this.engine) this._stopEngine(); return; }
      if (!this.engine && this.audio && typeof this.audio.engine === 'function') {
        try { this.engine = this.audio.engine(this.pos); } catch (e) { this.engine = null; }
      }
      if (!this.engine) return;
      const target = clamp(0.1 + 0.9 * this.speedRatio + (Math.abs(th) > 0.05 ? 0.1 : 0), 0, 1);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 3);
      this.engine.set(this.rpm, this.common.engineVolume);
      this.engine.setPosition(this.pos);
    }

    _stopEngine() {
      if (this.engine) { try { this.engine.stop(); } catch (e) { /* ignore */ } }
      this.engine = null;
      this.rpm = 0;
    }

    dispose() {
      this.disposed = true;
      this._stopEngine();
      this.detachHeadlight();
      this.scene.remove(this.root);
      if (this._wreckMats) this._setWreckLook(false);
      if (this.model && this.modelSource === 'procedural') Vehicle._disposeProcedural(this.model);
    }

    // 配置: (x, z) の車体が箱に埋まっていれば、向きに沿って前後（±12 m）・左右（±1 m）にずらして空きを探す
    static findSpawn(nav, def, x, z, yaw) {
      const hull = Vehicle.hullCircles(def);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const free = (px, pz) => {
        for (const zOff of hull.z) {
          const cx = px + fx * zOff, cz = pz + fz * zOff;
          const s = nav.resolveCircle(cx, cz, hull.r);
          if (Math.hypot(s.x - cx, s.z - cz) > 0.15) return false;
        }
        return true;
      };
      if (!nav || free(x, z)) return { x, z };
      for (let step = 1; step <= 12; step++) {
        for (const sgn of [1, -1]) {
          const px = x + fx * step * sgn, pz = z + fz * step * sgn;
          if (free(px, pz)) return { x: px, z: pz };
          for (const side of [1, -1]) {
            const qx = px + fz * side, qz = pz - fx * side;
            if (free(qx, qz)) return { x: qx, z: qz };
          }
        }
      }
      return { x, z };
    }
  }

  Vehicle._WHEEL_PTS = [[-1, 1], [1, 1], [-1, -1], [1, -1]]; // 左前・右前・左後ろ・右後ろ（左 = -X、前 = +Z）
  Vehicle.DEFAULTS = DEFAULTS;
  Vehicle.COMMON_DEFAULTS = COMMON_DEFAULTS;
  MR.Vehicle = Vehicle;
})();
