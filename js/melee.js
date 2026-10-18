// ナイフ（格闘。MR.Melee）。銃（MR.Weapon）とは別: game.weapons に入らない（session.js・持ち物・落ちている物・サーバーの武器の一覧は変わらない）。
//   「格闘」ボタン（#btn-knife）を押した瞬間（pointerdown）に今の銃からすぐ切りつける（quick。melee.quick.time 秒、そのあと cooldown 秒）。
//   押したまま drawHold 秒 → 持ち替え（drawn: ナイフを構えたまま。銃はしまったまま）:
//     撃つ = 切る（slash。comboWindow 秒の中でもう一度 → 逆から slash2）、「格闘」のタップ（離したとき）= 突く（stab）、
//     「格闘」の長押し（inspectHold 秒）= 調べる（inspect。刃を返して見る）、切替 / 1〜3 / 装填 = しまって銃（holster）。
//   PC は V（乗り物の視点の切替と同じキー。徒歩のときだけナイフ）とマウスの中ボタン。
//   当たりは目から: 振っている間（hitFrom〜hitTo）の毎フレーム、目からカメラの前へ reach m の線分と敵の当たりの球（Enemy の hitSpheres）の
//   いちばん近い所（segSphere。線分の始まりが球の中でも当たる）。間に壁（nav.raycast / 乗り物 / 動く船）があれば火花で止まる。
//   補助（assist）: 振り始めに range m・angle 度の中の見えている敵へ、向きを最大 maxTurn 度回し、maxLunge m まで踏み込む
//   （街は resolveCapsule、アリーナは resolveCircle。縁・水では踏み込まない）。背後（敵の向きの後ろ ±backstab.angle 度）からは一撃。
//   被弾の種類 'melee'（ベストが効く・ヘルメットは効かない: loot.js の Inventory.absorb）。
//   リロード中に振ったらリロードをやめ、銃に戻ったら最初からやり直す（弾は変わらない）。回復はやめる。
//   振れない: 乗り物の席・梯子 / 泳ぎ / 落下・自由視点・輸送ヘリ / ロビー・死亡中・オンライン（melee.online が true のときだけ。今は出さない）。
//   見た目: assets/<tier>/models/knife.glb（手は無い。空ノード blade_tip / blade_base / grip）があればそれ、無ければコードのナイフ。
//   腕は hq3d の arms.glb（MR.ViewArms。knife_* のクリップ、握りは骨 weapon_r）、無ければコードの手袋と前腕。読み込みはゲームの開始で始め、届いたら画面の外で 1 回本当に描く（WebKit は最初の描画で
//   パイプラインを作る）。軌跡（trail）は切っている間だけ 1 回の描画。
//   数値はすべて game.json の melee（無いキーは Melee.DEFAULTS）。音はファイルが無ければ合成（このファイルの SYNTH）。
//   アイドル（しまっている）の間は何もしない（update の最初で戻る）。
window.MR = window.MR || {};

MR.Melee = class Melee {
  static get DEFAULTS() {
    return {
      enabled: true,
      online: false,
      name: 'ナイフ',
      quick: { time: 0.55, cooldown: 0.15, hitFrom: 0.12, hitTo: 0.26, damage: 55, reach: 1.7, bladeRadius: 0.1 },
      slash: { time: 0.42, cooldown: 0.05, hitFrom: 0.07, hitTo: 0.2, damage: 50, reach: 1.7, bladeRadius: 0.1 },
      stab: { time: 0.5, cooldown: 0.1, hitFrom: 0.17, hitTo: 0.3, damage: 70, reach: 1.95, bladeRadius: 0.07 },
      draw: { time: 0.3 },
      inspect: { time: 1.6 },
      holster: { time: 0.25 },
      drawHold: 0.35,
      comboWindow: 0.5,
      inspectHold: 0.35,
      assist: { range: 2.8, angle: 35, maxTurn: 12, maxLunge: 1.1, lungeTime: 0.14, stopAt: 1.05, maxDy: 1.4 },
      backstab: { angle: 60, damage: 400 },
      // 敵のナイフ（K3）: share の割合の敵がナイフも持つ。chargeRange m 以内で見えたら走って詰め、range m で突く（time 秒、hitAt 秒で当たり:
      // reach m・正面 angle 度・見える）。撃たれたら（プレイヤーのナイフ）stagger 秒よろめき、knockback m 押し戻される（knockTime 秒）
      enemy: { share: 0.5, chargeRange: 9, range: 1.6, reach: 2.0, maxDy: 1.2, speed: 5.2, time: 0.7, hitAt: 0.36, damage: 22, cooldown: 0.9, angle: 55,
        stagger: 0.45, knockback: 0.6, knockTime: 0.15, losEvery: 0.2, volSwing: 0.8,
        pose: [[0, 0, 10, 0, 0, -5], [-55, 0, 25, 25, 0, -10], [-70, 0, 0, 30, 0, 0], [0, 20, 0, 0, -25, 0]],
        // コードの兵士: [肩 x 溜め, 肩 x 突き, 肘 x 溜め, 肘 x 突き, 胴 y 溜め, 胴 y 突き]（ラジアン）
        poseCode: [-0.9, 0.35, -0.9, 0.55, 0.25, -0.3], curve: [0.4, 0.12, 0.55, 0.6], volHit: 0.9,
        // 突進をやめる: 進めた割合が progressMin 未満が stuckTime 秒続いたら giveUp 秒は銃に戻る。dropMax m より低い所へは走らない
        progressMin: 0.3, stuckTime: 0.3, giveUp: 2, dropMax: 0.6 },
      headMult: 1.2,
      guardMs: 150,
      hotEvery: 0.1,
      // 手ごたえ（度・揺れ・音量）と狙う高さ（敵の足元から m）
      feel: { kickHit: 1.2, kickWall: 0.6, shakeHit: 0.25, shakeMax: 1.5, volSwing: 0.9, volHit: 1, volWall: 0.8, volDraw: 0.7, aimY: 1.2, aimHeadY: 1.25, pitchMax: 85, bob: 0.008 },
      sounds: { swing: 'knife_swing', stab: 'knife_stab', hit: 'knife_hit', wall: 'knife_wall', draw: 'knife_draw' },
      model: { file: 'models/knife.glb', scale: 1 },
      // 軌跡: 刃の根元と切っ先の samples 個の跡（slash / slash2 / quick の当たりの前後 pad 秒）
      trail: { samples: 12, pad: 0.04, fade: 0.12, color: '#d6e8ff', opacity: 0.55 },
      view: { pos: [0.2, -0.24, -0.34], scale: 1, elbow: [0.3, -0.5, 0.05], armLen: 0.36, drawnPeriod: 2.4, rigDrop: 0.35 },
      // 動き: t（0..1。その動きの時間の割合）、p（カメラの座標 m）、r（度。オイラー XYZ。Z = 刃の軸まわり）。位置は Catmull-Rom、向きは
      // クォータニオンの slerp（180° 返すときは 90° ごとにキーを置く）
      anim: {
        quick: [
          { t: 0.0, p: [0.38, -0.5, -0.32], r: [20, 40, -40] },
          { t: 0.14, p: [0.32, -0.08, -0.46], r: [25, 70, -60] },
          { t: 0.27, p: [0.05, -0.08, -0.55], r: [20, 80, -75] },
          { t: 0.4, p: [-0.24, -0.16, -0.48], r: [10, 85, -85] },
          { t: 0.65, p: [-0.22, -0.4, -0.34], r: [-10, 60, -60] },
          { t: 1.0, p: [0.12, -0.62, -0.28], r: [-30, 20, -30] }
        ],
        drawn: [
          { t: 0.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] },
          { t: 0.5, p: [0.2, -0.206, -0.358], r: [14, 24, -36] },
          { t: 1.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] }
        ],
        draw: [
          { t: 0.0, p: [0.12, -0.62, -0.28], r: [-30, 20, -30] },
          { t: 0.6, p: [0.22, -0.17, -0.37], r: [22, 28, -30] },
          { t: 1.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] }
        ],
        slash: [
          { t: 0.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] },
          { t: 0.15, p: [0.34, -0.06, -0.44], r: [25, 70, -60] },
          { t: 0.32, p: [0.04, -0.08, -0.55], r: [20, 80, -75] },
          { t: 0.5, p: [-0.24, -0.16, -0.48], r: [10, 85, -85] },
          { t: 0.75, p: [-0.05, -0.3, -0.4], r: [5, 50, -60] },
          { t: 1.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] }
        ],
        slash2: [
          { t: 0.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] },
          { t: 0.18, p: [-0.2, -0.06, -0.46], r: [25, 40, -110] },
          { t: 0.36, p: [0.05, -0.08, -0.55], r: [20, -10, -95] },
          { t: 0.55, p: [0.3, -0.14, -0.46], r: [10, -50, -80] },
          { t: 0.8, p: [0.25, -0.25, -0.4], r: [10, 0, -50] },
          { t: 1.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] }
        ],
        stab: [
          { t: 0.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] },
          { t: 0.25, p: [0.2, -0.2, -0.26], r: [15, 30, -60] },
          { t: 0.45, p: [0.06, -0.12, -0.62], r: [18, 22, -55] },
          { t: 0.7, p: [0.12, -0.16, -0.45], r: [15, 25, -45] },
          { t: 1.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] }
        ],
        inspect: [
          { t: 0.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] },
          { t: 0.15, p: [0.09, -0.1, -0.37], r: [10, 80, 0] },
          { t: 0.3, p: [0.09, -0.1, -0.37], r: [10, 80, 90] },
          { t: 0.45, p: [0.09, -0.1, -0.37], r: [10, 80, 180] },
          { t: 0.62, p: [0.09, -0.1, -0.37], r: [10, 80, 180] },
          { t: 0.77, p: [0.09, -0.1, -0.37], r: [10, 80, 270] },
          { t: 0.9, p: [0.12, -0.16, -0.35], r: [12, 50, 0] },
          { t: 1.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] }
        ],
        holster: [
          { t: 0.0, p: [0.2, -0.2, -0.36], r: [15, 25, -35] },
          { t: 1.0, p: [0.18, -0.62, -0.26], r: [-45, 10, -30] }
        ]
      }
    };
  }

  static merge(def, cfg) {
    const out = {};
    for (const k of Object.keys(def)) {
      const d = def[k], c = cfg ? cfg[k] : undefined;
      if (d && typeof d === 'object' && !Array.isArray(d) && k !== 'anim') out[k] = Melee.merge(d, c && typeof c === 'object' ? c : {});
      else out[k] = c === undefined ? d : c;
    }
    if (cfg && cfg.anim) out.anim = Object.assign({}, def.anim, cfg.anim);
    for (const k of Object.keys(cfg || {})) if (!(k in out)) out[k] = cfg[k];
    return out;
  }

  // ゲームがナイフを持つか（オンラインは melee.online が true のときだけ）
  static enabledFor(game) {
    const c = (game.config && game.config.melee) || {};
    if (c.enabled === false) return false;
    if (game.online && c.online !== true) return false;
    return true;
  }

  // 攻撃の動き（当たりの窓がある）と、その設定
  static isAttack(s) { return s === 'quick' || s === 'slash' || s === 'slash2' || s === 'stab'; }
  kindCfg(s) { return s === 'slash2' ? this.cfg.slash : this.cfg[s]; }

  constructor(game, cfg) {
    this.game = game;
    this.cfg = Melee.merge(Melee.DEFAULTS, cfg || {});
    this.state = 'idle';     // idle | quick | draw | drawn | slash | slash2 | stab | inspect | holster
    this.out = false;        // 持ち替えている（drawn と、そこからの動き）
    this.t = 0;              // 今の動きの経過（秒）
    this.dur = 0;
    this.cooldownUntil = 0;  // game.time
    this.hitDone = false;    // この振りで当てた（1 振り 1 体）
    this.wallDone = false;
    this.target = null;      // 補助の相手（Enemy）
    this.lunge = null;       // { ux, uz, dist, left, turnYaw, turnPitch, turnLeft }
    this._reloadOf = null;   // 振る前にリロード中だった銃
    this._holdFrom = 0;      // quick を押した時刻（押したままなら持ち替え）
    this._toOut = false;
    this._kPress = null;     // 持ち替えている間に「格闘」を押した時刻（離せば突く、押したままなら調べる）
    this._slashQueued = false;
    this._lastSlash = null;  // { kind, at }（コンボ）
    this._after = null;      // しまった後: { sel, reload }
    this.hot = false;
    this._hotT = 0;
    this.lastKillAt = -1e9;  // game.time（キルフィードの武器の名前）
    this.lastHit = null;
    this.stats = { swings: 0, quick: 0, slashes: 0, combos: 0, stabs: 0, inspects: 0, draws: 0, holsters: 0, hits: 0, kills: 0, backstabs: 0, heads: 0, walls: 0, lunges: 0, lungeMax: 0, turnMax: 0, refused: {}, winMs: 0, winFrames: 0, winMax: 0, idleCalls: 0, warmDraws: 0, enemyWarmDraws: 0, trailFrames: 0 };
    this._keys = this._prepAnim(this.cfg.anim);
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._eye = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._build(game.viewRoot);
    this._buildTrail(game.viewRoot);
    this._warmPending = true;
    this._enemyWarmPending = true; // 敵のナイフ（K3）: コードの刃 → knife.glb が届いたらもう一度
    this._enemyWarm = null;
    this.modelSource = 'procedural';
    this.modelReady = this._loadModel(game.assets);
    // hq3d の腕（MR.ViewArms。arms.glb の knife_idle / knife_slash / knife_stab は視点の座標、ナイフの握りは骨 weapon_r）。
    // 銃と同じ MR.Weapon.kit / armsFile で決める（?kit=0・ファイルが無い・クリップが無いときはコードの手袋と前腕のまま）
    this._rig = null;
    this.armSource = 'code';
    this.armsReady = (MR.Weapon && MR.Weapon.kit && MR.Weapon.armsFile && MR.ViewArms && MR.ViewArms.loadGlb)
      ? Promise.all([this.modelReady, MR.ViewArms.loadGlb(game.assets, MR.Weapon.armsFile)]).then(([, gltf]) => { if (gltf && !this.disposed) this._useGlbArms(gltf); return this.armSource; })
      : Promise.resolve(this.armSource);
  }

  // arms.glb の複製に替える: ナイフ（this.group）を骨 weapon_r の子に（握り = 原点、切っ先 −Z）、コードの手袋と前腕は描かない
  _useGlbArms(gltf) {
    const need = ['knife_idle', 'knife_slash', 'knife_stab'];
    if (!need.every((n) => gltf.animations.some((c) => c.name === n))) return;
    const r = MR.ViewArms.rig(gltf);
    const bone = r.root.getObjectByName('weapon_r');
    if (!r.mesh || !bone) { r.dispose(); return; }
    const on = this.state !== 'idle' || this._warming;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.position.set(0, 0, 0); this.group.quaternion.identity(); this.group.scale.setScalar(1);
    this.glove.visible = false;
    this.arm.visible = false;
    bone.add(this.group);
    this.game.viewRoot.add(r.root);
    this._rig = r;
    this._rigState = null;
    r.root.visible = on; this.group.visible = on;
    r.pose('knife_idle');
    this.armSource = 'glb';
    this._warmPending = true;
    if (this.state !== 'idle') this._pose(Math.min(1, this.t / (this.dur || 1)));
  }

  // 腕の複製のクリップ: 切る・quick = knife_slash、突く = knife_stab（動きの長さに合わせる）、構え = knife_idle の繰り返し。
  // 抜く / しまうは腕ごと画面の下から / 下へ、調べるは手の中でナイフを返す（コードの動きの表の向きの差）
  _rigPose(u) {
    const r = this._rig, s = this.state;
    const clip = s === 'stab' ? 'knife_stab' : (Melee.isAttack(s) ? 'knife_slash' : 'knife_idle');
    if (this._rigState !== s || (u === 0 && s !== 'drawn')) {
      this._rigState = s;
      if (s === 'drawn') r.play('knife_idle', { loop: true });
      else if (clip === 'knife_idle') r.pose('knife_idle');
      else r.play(clip, { duration: this.dur, back: 'knife_idle' });
    }
    const root = r.root, g = this.group;
    root.position.set(0, 0, 0);
    g.quaternion.identity();
    const e = u * u * (3 - 2 * u), drop = this.cfg.view.rigDrop;
    if (s === 'draw') root.position.y = -drop * (1 - e);
    else if (s === 'holster') root.position.y = -drop * e;
    else if (s === 'inspect') {
      const keys = this._keys.inspect;
      if (keys && keys.length > 1) {
        let i = 0;
        while (i < keys.length - 2 && u > keys[i + 1].t) i++;
        const a = keys[i], b = keys[i + 1], sp = Math.max(0, Math.min(1, (u - a.t) / Math.max(1e-6, b.t - a.t)));
        g.quaternion.copy(a.q).slerp(b.q, sp).premultiply(this._q0.copy(keys[0].q).invert());
      }
    }
  }

  // 動きの表を前もってクォータニオンに（毎フレーム作らない）
  _prepAnim(anim) {
    const out = {};
    const D = Math.PI / 180;
    for (const k of Object.keys(anim || {})) {
      const keys = (anim[k] || []).filter((x) => x && Array.isArray(x.p) && Array.isArray(x.r)).slice().sort((a, b) => a.t - b.t);
      out[k] = keys.map((x) => ({ t: x.t, p: new THREE.Vector3(x.p[0], x.p[1], x.p[2]), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(x.r[0] * D, x.r[1] * D, x.r[2] * D, 'XYZ')) }));
    }
    return out;
  }

  // ---------- 見た目 ----------
  // ナイフ（group。原点 = 握り、切っ先 -Z）: コードは刃 / 鍔・柄の 2 つ、knife.glb が届いたらその複製に替える。手袋は group の子（どちらでも）。
  // 前腕（sleeve）は viewRoot の子で、毎フレーム手首から肘の目安（view.elbow。カメラの右下の後ろ）へ向ける
  _build(viewRoot) {
    const g = this.group = new THREE.Group();
    g.visible = false;
    const bladeMat = new THREE.MeshStandardMaterial({ color: MR.srgb('#c9cfd6'), metalness: 0.85, roughness: 0.28 });
    const darkMat = new THREE.MeshStandardMaterial({ color: MR.srgb('#202328'), metalness: 0.15, roughness: 0.8 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: MR.srgb('#1c1e22'), metalness: 0.1, roughness: 0.8 });
    const sleeveMat = new THREE.MeshStandardMaterial({ color: MR.srgb('#4a5245'), roughness: 1.0 });
    this._mats = [bladeMat, darkMat, gloveMat, sleeveMat];
    const geos = this._geos = [];
    // 刃: 平たい箱の先を細くした形（背は真っすぐ、刃 = −Y は切っ先へ上がる）
    const bl = new THREE.BoxGeometry(0.007, 0.036, 0.2, 1, 1, 4);
    const pos = bl.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), u = Math.max(0, (-z - 0.02) / 0.08); // 0 = 根元 … 1 = 切っ先
      if (u > 0 && pos.getY(i) < 0) pos.setY(i, pos.getY(i) * (1 - Math.min(1, u) * 0.85));
      if (u > 0 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) * (1 - Math.min(1, u) * 0.35));
    }
    bl.translate(0, 0.004, -0.135);
    bl.computeVertexNormals();
    geos.push(bl);
    // 鍔・柄（1 つにまとめる）
    const parts = [
      new THREE.BoxGeometry(0.02, 0.06, 0.012).translate(0, 0.004, -0.032),
      new THREE.CylinderGeometry(0.0145, 0.016, 0.11, 8).rotateX(Math.PI / 2).translate(0, 0, 0.026)
    ];
    const grip = THREE.BufferGeometryUtils.mergeBufferGeometries(parts.map((q) => q.toNonIndexed()));
    for (const q of parts) q.dispose();
    geos.push(grip);
    const glove = new THREE.BoxGeometry(0.068, 0.082, 0.1).translate(0.006, -0.012, 0.024);
    geos.push(glove);
    this.blade = new THREE.Mesh(bl, bladeMat);
    this.handle = new THREE.Mesh(grip, darkMat);
    this.glove = new THREE.Mesh(glove, gloveMat);
    g.add(this.blade, this.handle, this.glove);
    // 切っ先と根元（軌跡）: コードのナイフ。knife.glb の空ノードがあればそれに替える
    this._tipL = new THREE.Vector3(0, 0.004, -0.235);
    this._baseL = new THREE.Vector3(0, 0.004, -0.045);
    // 前腕: 原点 = 手首、+Y へ長さ 1（毎フレーム肘までの長さに伸ばす）
    const arm = new THREE.CylinderGeometry(0.042, 0.052, 1, 10);
    arm.translate(0, 0.5, 0);
    geos.push(arm);
    this.arm = new THREE.Mesh(arm, sleeveMat);
    this.arm.visible = false;
    for (const m of [this.blade, this.handle, this.glove, this.arm]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }
    const s = this.cfg.view.scale || 1;
    g.scale.setScalar(s);
    viewRoot.add(g, this.arm);
    this._wrist = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); this._q0 = new THREE.Quaternion();
    const el = this.cfg.view.elbow || [0.3, -0.5, 0.05];
    this._elbow = new THREE.Vector3(el[0], el[1], el[2]);
  }

  // knife.glb（あれば）を読んでコードの刃と柄に替える。ジオメトリ・材質は AssetManager のキャッシュと共有（捨てない）
  _loadModel(assets) {
    const file = this.cfg.model && this.cfg.model.file;
    if (!assets || !file || typeof assets.loadModel !== 'function') return Promise.resolve('procedural');
    let key = null;
    try { key = typeof assets.resolve === 'function' ? assets.resolve(file) : (typeof assets.has === 'function' && assets.has(file) ? file : null); } catch (e) { key = null; }
    if (!key) return Promise.resolve('procedural');
    return Promise.resolve().then(() => assets.loadModel(key)).then((res) => {
      const scene = res && res.scene && res.scene.isObject3D ? res.scene : (res && res.isObject3D ? res : null);
      if (!scene || this.disposed) return 'procedural';
      const holder = new THREE.Group();
      const clone = scene.clone(true);
      const sc = Number(this.cfg.model.scale) || 1;
      if (sc !== 1) clone.scale.multiplyScalar(sc);
      holder.add(clone);
      holder.updateMatrixWorld(true);
      let meshes = 0;
      clone.traverse((o) => { if (o.isMesh) { meshes++; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
      if (!meshes) return 'procedural';
      const tip = clone.getObjectByName('blade_tip'), base = clone.getObjectByName('blade_base');
      if (tip) tip.getWorldPosition(this._tipL);
      if (base) base.getWorldPosition(this._baseL);
      this.group.remove(this.blade, this.handle);
      holder.remove(clone);
      this.group.add(clone);
      this.glb = clone;
      Melee._knifeScene = scene; // 敵のナイフ（K3）も同じ形（材質は敵ごとに複製）
      this.modelSource = 'glb';
      this._warmPending = true;
      this._enemyWarmPending = true;
      return 'glb';
    }).catch((e) => {
      console.warn('[Melee] knife.glb を読めません。コードのナイフで続行します:', e && e.message);
      return 'procedural';
    });
  }

  _show(on) {
    this.group.visible = on;
    if (this._rig) { this._rig.root.visible = on; this.arm.visible = false; return; }
    this.arm.visible = on;
  }

  // 軌跡: 刃の根元と切っ先の跡を帯にする（1 回の描画）。viewRoot（カメラ）の座標
  _buildTrail(viewRoot) {
    const T = this.cfg.trail, n = Math.max(2, T.samples | 0);
    const geo = new THREE.BufferGeometry();
    this._trailPos = new Float32Array(n * 2 * 3);
    this._trailCol = new Float32Array(n * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._trailCol, 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this._geos.push(geo);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: T.opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this._mats.push(mat);
    this.trail = new THREE.Mesh(geo, mat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.renderOrder = 12;
    this._trailN = n;
    this._trailFill = 0;     // 入っている跡の数
    this._trailFade = 0;     // 残り（秒）
    this._trailTint = new THREE.Color(MR.srgb(T.color));
    viewRoot.add(this.trail);
  }

  _trailPush() {
    const n = this._trailN, P = this._trailPos;
    P.copyWithin(0, 6, n * 6); // 古い跡を前へ（後ろに新しいもの）
    const g = this.group;
    let a, b;
    if (this._rig) { // 骨の子: 腕の複製の行列を更新して viewRoot の座標へ（同じ viewRoot の行列で行き来するので古くても合う）
      const vr = this.trail.parent, root = this._rig.root;
      root.updateMatrixWorld(true);
      a = vr.worldToLocal(g.localToWorld(this._a.copy(this._baseL)));
      b = vr.worldToLocal(g.localToWorld(this._b.copy(this._tipL)));
    } else {
      a = this._a.copy(this._baseL).multiplyScalar(g.scale.x).applyQuaternion(g.quaternion).add(g.position);
      b = this._b.copy(this._tipL).multiplyScalar(g.scale.x).applyQuaternion(g.quaternion).add(g.position);
    }
    const k = (n - 1) * 6;
    P[k] = a.x; P[k + 1] = a.y; P[k + 2] = a.z; P[k + 3] = b.x; P[k + 4] = b.y; P[k + 5] = b.z;
    if (this._trailFill < n) {
      // 最初の跡は全部同じ点（帯が原点から伸びない）
      if (this._trailFill === 0) for (let i = 0; i < n - 1; i++) P.copyWithin(i * 6, k, k + 6);
      this._trailFill++;
    }
  }

  _trailUpdate(dt, on) {
    const T = this.cfg.trail;
    if (on) { this._trailPush(); this._trailFade = T.fade; }
    else if (this._trailFade > 0) { this._trailFade -= dt; this._trailPush(); }
    if (!on && this._trailFade <= 0) {
      if (this.trail.visible) { this.trail.visible = false; this._trailFill = 0; }
      return;
    }
    const n = this._trailN, C = this._trailCol, tint = this._trailTint;
    const life = on ? 1 : Math.max(0, this._trailFade / T.fade);
    for (let i = 0; i < n; i++) {
      const w = Math.pow(i / (n - 1), 1.6) * life;
      for (let j = 0; j < 2; j++) { const o = (i * 2 + j) * 3, f = w * (j ? 1 : 0.35); C[o] = tint.r * f; C[o + 1] = tint.g * f; C[o + 2] = tint.b * f; }
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
    this.trail.visible = true;
    this.stats.trailFrames++;
  }

  // ---------- 描画の前後（game._render）: 届いたナイフを画面の外で 1 回本当に描く（最初に振ったフレームで止まらない） ----------
  beforeRender() {
    this._warmEnemyKnife();
    if (!this._warmPending) return;
    if (this.state !== 'idle') { this._warmPending = false; return; } // もう本当に描いている（振っている・構えている）
    this._warming = true;
    if (this._rig) { this._rig.root.position.set(0, 0, 3); this._rig.root.visible = true; this.group.visible = true; } // 腕の複製ごとカメラの後ろ
    else {
      this.group.position.set(0, 0, 3); // カメラの後ろ（frustumCulled は false なので描く。画面には出ない）
      this.arm.position.set(0, 0, 3);
      this.group.visible = true; this.arm.visible = true;
    }
    this.trail.position.set(0, 0, 3);
    this.trail.visible = true;
  }

  afterRender() {
    if (this._enemyWarm) { // 敵のナイフの 1 回目の描画が済んだ: 外す。材質は捨てない（捨てると three がプログラムを放して、温めた意味が無くなる）
      const k = this._enemyWarm;
      if (k.parent) k.parent.remove(k);
      (this._enemyWarmMats || (this._enemyWarmMats = [])).push(...(k.userData.ownMaterials || []));
      this._enemyWarm = null;
      this._enemyWarmPending = false;
      this.stats.enemyWarmDraws++;
    }
    if (!this._warming) return;
    this._warming = false;
    this._warmPending = false;
    this.trail.position.set(0, 0, 0);
    if (this._rig) this._rig.root.position.set(0, 0, 0);
    if (this.state === 'idle') { this.group.visible = false; this.arm.visible = false; this.trail.visible = false; if (this._rig) this._rig.root.visible = false; } // 描いている間に振り始めた（例外で 1 回飛んだ）ら隠さない
    else this.trail.visible = this._trailFade > 0;
    this.stats.warmDraws++;
  }

  // 敵のナイフ（本体シーン・霧あり・材質は複製）も同じ: 届いたら 1 回だけカメラの後ろで本当に描く（最初に突いたときに WebKit がシェーダーを
  // 作って止まらない）。描いた複製はすぐ外すが、材質はゲームの終わり（dispose）まで持つ（three のプログラムの参照を残す）
  _warmEnemyKnife() {
    if (!this._enemyWarmPending || this._enemyWarm || !MR.Melee.enemyCfg) return;
    const g = this.game;
    if (!g.scene || !g.camera) return;
    const k = MR.Melee.makeEnemyKnife({ knifeMount: () => ({ node: g.scene }) });
    if (!k) return;
    k.traverse((o) => { o.frustumCulled = false; });
    const cam = g.camera.getWorldPosition(this._a), fwd = g.camera.getWorldDirection(this._b);
    k.position.copy(cam).addScaledVector(fwd, -3); // カメラの後ろ（画面には出ない）
    k.visible = true;
    this._enemyWarm = k;
  }

  // ---------- 状態 ----------

  get busy() { return this.state !== 'idle'; }
  get active() { return this.state !== 'idle'; }
  get drawn() { return this.out; }

  // 振れないなら理由（文字列）、振れるなら ''。drawn の間の「格闘」（突く・調べる）は busy / cooldown を見ない
  refusal() {
    const g = this.game, p = g.player;
    if (!g.melee) return 'off';
    if (p.dead || g._deathUI) return 'dead';
    if (g.vehicle) return 'seat';
    if (g.freeCam) return 'freecam';
    if (g.lift && (g.lift.riding || g.lift.open)) return 'lift'; // Sky High のエレベーター（乗っている・行き先の板）
    if ((g.royale && g.royale.riding) || (g.cityOnline && (g.cityOnline.riding || !g.cityOnline.canShoot))) return 'lobby';
    if (p.mode3d && p.state !== 'walk') return 'state';
    if (g.settingsOpen) return 'settings';
    if (this.out) return '';
    if (g.time < this.cooldownUntil) return 'cooldown';
    if (this.state !== 'idle') return 'busy';
    return '';
  }

  _refuse(r) { this.stats.refused[r] = (this.stats.refused[r] || 0) + 1; return false; }

  // 「格闘」を押した（ボタン・V・中ボタン）。受け付けたら true
  press() {
    const r = this.refusal();
    if (r) return this._refuse(r);
    const g = this.game;
    if (this.out) { this._kPress = g.time; return true; } // 離せば突く・押したままなら調べる（drawn に戻ったときに見る）
    this._stow();
    this._holdFrom = g.time;
    this._toOut = false;
    this._begin('quick');
    return true;
  }

  // 銃をしまう（リロードはやめて、銃に戻ったらやり直す。回復はやめる）
  _stow() {
    const g = this.game, w = g.weapon;
    this._reloadOf = null;
    if (w) {
      if (w.reloading) { w.cancelReload(); this._reloadOf = w; }
      w.stow(true);
    }
    if (g.play && g.play.heal) g.play.cancelHeal('melee');
    const a = g.audio;
    if (a && typeof a.prepare === 'function') a.prepare('knife'); // 初めての「格闘」でナイフの音をデコードし始める（この 1 回は合成音）
    this._show(true);
    this._setHud(true);
  }

  _begin(kind) {
    const g = this.game, F = this.cfg.feel, a = g.audio;
    this.state = kind;
    this.t = 0;
    this.dur = Math.max(0.05, (this.kindCfg(kind) || {}).time || 0.3);
    this.hitDone = false;
    this.wallDone = false;
    this.lunge = null;
    this.target = null;
    if (g.play && g.play.heal && kind !== 'holster') g.play.cancelHeal('melee');
    if (Melee.isAttack(kind)) {
      this.stats.swings++;
      if (kind === 'quick') this.stats.quick++;
      else if (kind === 'stab') this.stats.stabs++;
      else { this.stats.slashes++; if (kind === 'slash2') this.stats.combos++; }
      // 補助: 相手を選び、向きと踏み込みを決める
      this.target = this._pickTarget();
      if (this.target) this._planLunge(this.target);
      if (a && typeof a.play === 'function') a.play(kind === 'stab' ? this.cfg.sounds.stab : this.cfg.sounds.swing, { volume: F.volSwing, channel: 'self' });
    } else if (kind === 'draw') {
      this.stats.draws++;
      if (a && typeof a.play === 'function') a.play(this.cfg.sounds.draw, { volume: F.volDraw, channel: 'self' });
    } else if (kind === 'inspect') this.stats.inspects++;
    else if (kind === 'holster') this.stats.holsters++;
    this._pose(0);
  }

  // 持ち替えた（drawn）
  _setOut(on) {
    if (on === this.out) return;
    this.out = on;
    this.game.input.meleeNoGuard = on; // 構えている間は撃つ（= 切る）の直後の「格闘」（= 突く）も効く
    const h = this.game.hud;
    if (h && h.root && h.root.classList) h.root.classList.toggle('knife-out', on);
  }

  // 銃に戻った
  _end() {
    const g = this.game;
    this.state = 'idle';
    this._setOut(false);
    this._show(false);
    this._kPress = null;
    this._slashQueued = false;
    this.target = null;
    this.lunge = null;
    this.hot = false;
    if (this.trail.visible) { this.trail.visible = false; this._trailFill = 0; this._trailFade = 0; }
    this.cooldownUntil = g.time + this.cfg.quick.cooldown;
    const w = g.weapon;
    if (w) {
      w.stow(false);
      if (this._reloadOf === w && !g.player.dead) w.startReload(g.time);
    }
    this._reloadOf = null;
    this._setHud(false);
    // しまう前に頼まれた持ち替え・装填
    const af = this._after;
    this._after = null;
    if (af && !g.player.dead) {
      if (af.sel >= 0) {
        if (g.play && typeof g.play.selectSlot === 'function') { if (g.play.inv && g.play.inv.slots[af.sel] && af.sel !== g.play.inv.cur) g.play.selectSlot(af.sel); }
        else if (af.sel < g.weapons.length && af.sel !== g.weaponIndex) g._selectWeapon(af.sel);
      }
      if (af.reload && g.weapon && !g.weapon.reloading && !g.weapon.startReload(g.time) && g.play && g.play._noAmmo && g.weapon.reserve <= 0 && g.weapon.ammo < g.weapon.def.magazineSize) g.play._noAmmo(true);
    }
  }

  // 死んだ・乗った・止めた: すぐしまう（リロード・頼まれた持ち替えはやり直さない）
  cancel() {
    if (this.state === 'idle') return;
    this._reloadOf = null;
    this._after = null;
    this._end();
  }

  _setHud(on) {
    const h = this.game.hud;
    if (h && h.setMelee) h.setMelee(on, on && this.hot);
  }

  // ---------- 補助（assist） ----------

  // 目の前 range m・angle 度の中の、見えている生きている敵（角度の小さい順）
  _pickTarget() {
    const g = this.game, A = this.cfg.assist, p = g.player, F = this.cfg.feel;
    const eye = p.eyePosition(this._eye);
    const fwd = g.camera.getWorldDirection(this._f);
    const cosMax = Math.cos(A.angle * Math.PI / 180);
    let best = null, bestCos = cosMax;
    for (const e of g.enemies) {
      if (e.dead || e.removed) continue;
      const cx = e.pos.x, cy = e.pos.y + F.aimY, cz = e.pos.z;
      const dx = cx - eye.x, dy = cy - eye.y, dz = cz - eye.z;
      const dh = Math.hypot(dx, dz);
      if (dh > A.range || Math.abs(e.pos.y - p.pos.y) > A.maxDy) continue;
      const d = Math.hypot(dh, dy) || 1e-6;
      const c = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
      if (c < bestCos) continue;
      if (!g.world.nav.lineOfSight(eye.x, eye.y, eye.z, cx, cy, cz)) continue;
      if (g.cityBoats && this._boatBlocks(eye, cx, cy, cz)) continue; // 動く船の船体・船室の向こう
      best = e; bestCos = c;
    }
    return best;
  }

  _planLunge(e) {
    const g = this.game, A = this.cfg.assist, p = g.player;
    const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
    const dh = Math.hypot(dx, dz) || 1e-6;
    // 向き: プレイヤーの前は (−sin yaw, −cos yaw)
    const want = Math.atan2(-dx, -dz);
    let dy = want - p.yawAngle;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const mt = A.maxTurn * Math.PI / 180;
    const turnYaw = Math.max(-mt, Math.min(mt, dy));
    const eye = p.pos.y + p.eyeHeight, cy = e.pos.y + this.cfg.feel.aimHeadY;
    const wantP = Math.atan2(cy - eye, dh);
    const turnPitch = Math.max(-mt, Math.min(mt, wantP - p.pitchAngle));
    const dist = Math.max(0, Math.min(A.maxLunge, dh - A.stopAt));
    this.lunge = { ux: dx / dh, uz: dz / dh, dist, left: dist, turnYaw, turnPitch, turnLeft: 1 };
    if (dist > 0.01) this.stats.lunges++;
    this.stats.lungeMax = Math.max(this.stats.lungeMax, dist);
    this.stats.turnMax = Math.max(this.stats.turnMax, Math.abs(turnYaw) * 180 / Math.PI);
  }

  _stepLunge(dt) {
    const L = this.lunge, g = this.game, A = this.cfg.assist, p = g.player;
    if (!L) return;
    const k = Math.min(1, dt / A.lungeTime);
    // 向きを回す（lungeTime の間に等速で）
    if (L.turnLeft > 0) {
      const f = Math.min(L.turnLeft, k);
      p.yawAngle += L.turnYaw * f;
      const pm = this.cfg.feel.pitchMax * Math.PI / 180;
      p.pitchAngle = Math.max(-pm, Math.min(pm, p.pitchAngle + L.turnPitch * f));
      L.turnLeft -= f;
    }
    if (L.left > 1e-3) {
      let step = Math.min(L.left, L.dist * k);
      // 相手に触れたら止まる
      const e = this.target;
      if (e && !e.dead) {
        const rem = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - A.stopAt;
        step = Math.max(0, Math.min(step, rem));
      }
      L.left -= step;
      if (step > 0) this._moveBy(L.ux * step, L.uz * step);
      else L.left = 0;
    }
    p._apply();
  }

  // 踏み込み: 壁は押し出す。縁から落ちる・水に入るなら動かない
  _moveBy(dx, dz) {
    const g = this.game, p = g.player;
    // 近くに船があれば甲板も歩ける nav（player.update と同じ）
    const nav = g.cityBoats ? g.cityBoats.playerWorld().nav : g.world.nav;
    if (p.mode3d) {
      const c3 = p._c3 ? p._c3() : { height: 1.8, stepUp: 0.45 };
      const q = { x: p.pos.x + dx, y: p.pos.y, z: p.pos.z + dz };
      const r = nav.resolveCapsule(q, p.radius, c3.height, c3.stepUp, { snapDown: c3.stepUp });
      if (!r.grounded || r.ground == null || Math.abs(r.y - p.pos.y) > c3.stepUp + 0.01) { if (this.lunge) this.lunge.left = 0; return; }
      p.pos.set(r.x, r.y, r.z);
    } else {
      const r = nav.resolveCircle(p.pos.x + dx, p.pos.z + dz, p.radius);
      p.pos.x = r.x; p.pos.z = r.z;
    }
  }

  // ---------- 更新 ----------

  update(dt) {
    if (this.state === 'idle') { this.stats.idleCalls++; return; }
    const g = this.game, inp = g.input;
    if (this._rig) this._rig.update(dt);
    if (g.player.dead || g.vehicle || g.freeCam || (g.player.mode3d && g.player.state !== 'walk' && g.player.state !== 'vault')) { this.cancel(); return; }
    if (this.state === 'drawn') {
      this._drawnInput();
      if (this.state === 'drawn') {
        this.t += dt;
        const per = this.cfg.view.drawnPeriod || 2.4;
        this._pose((this.t % per) / per);
        // 歩いている間の揺れ
        const mv = inp.getMove ? inp.getMove() : null;
        if (mv && (mv.x || mv.y) && g.player.grounded) {
          const b = this.cfg.feel.bob, ph = g.time * 9, o = this._rig ? this._rig.root : this.group;
          o.position.x += Math.sin(ph) * b; o.position.y += Math.abs(Math.cos(ph)) * b;
        }
        this._trailUpdate(dt, false);
        this._hotTick(dt, true);
        return;
      }
    }
    this.t += dt;
    if (Melee.isAttack(this.state)) this._stepLunge(dt);
    const u = Math.min(1, this.t / this.dur);
    this._pose(u);
    if (this.state === 'quick' && inp.meleeHeld && g.time - this._holdFrom >= this.cfg.drawHold - 1e-6) this._toOut = true; // 1e-6: 20 fps の 0.05 × 7 は 0.35 にわずかに届かない
    // 構えている間（切る・突く・調べる・抜く）に撃つ = 終わったらすぐ切る（コンボ。押した分を落とさない）
    if (this.out && this.state !== 'holster' && inp.consumeFirePress()) this._slashQueued = true;
    let trailOn = false;
    if (Melee.isAttack(this.state)) {
      const k = this.kindCfg(this.state);
      const inWin = this.t >= k.hitFrom && this.t <= k.hitTo + dt * 0.999;
      if (inWin && !this.hitDone) {
        const t0 = Melee.now();
        this._hitTest(k);
        const ms = Melee.now() - t0;
        const S = this.stats;
        S.winMs += ms; S.winFrames++; if (ms > S.winMax) S.winMax = ms;
        if (this._winTimes) this._winTimes.push(ms); // テスト（smoke 26 の KT8）だけ
      }
      const pad = this.cfg.trail.pad;
      trailOn = this.state !== 'stab' && this.t >= k.hitFrom - pad && this.t <= k.hitTo + pad;
    }
    this._trailUpdate(dt, trailOn);
    this._hotTick(dt, false);
    if (this.t >= this.dur) this._finish();
  }

  // 動きが終わった
  _finish() {
    const g = this.game, s = this.state;
    if (Melee.isAttack(s)) this.cooldownUntil = g.time + (this.kindCfg(s).cooldown || 0);
    if (s === 'slash' || s === 'slash2') this._lastSlash = { kind: s, at: g.time };
    if (s === 'quick') {
      if (this._toOut) { this._setOut(true); this._begin('draw'); }
      else this._end();
      return;
    }
    if (s === 'holster') { this._end(); return; }
    // draw / slash / slash2 / stab / inspect → 構えたまま
    this.state = 'drawn';
    this.t = 0;
    this.lunge = null;
  }

  // 構えている間の入力: 撃つ = 切る、「格闘」（離す = 突く・押したまま = 調べる）、切替 / 番号 / 装填 = しまう
  _drawnInput() {
    const g = this.game, inp = g.input;
    const sel = inp.consumeSelect ? inp.consumeSelect() : -1;
    const swap = inp.consumeSwap(), reload = inp.consumeReload();
    if (sel >= 0 && g.play && g.play.inv && !g.play.inv.slots[sel]) { if (g.play._say) g.play._say(sel === 2 ? 'サブの枠は空です' : '枠が空です', 900); }
    else if (swap || sel >= 0 || reload) { this._kPress = null; this._after = { sel, reload }; this._begin('holster'); return; }
    if (this._kPress != null) {
      if (!inp.meleeHeld) { this._kPress = null; this._begin('stab'); return; }
      if (g.time - this._kPress >= this.cfg.inspectHold - 1e-6) { this._kPress = null; this._begin('inspect'); return; }
      return;
    }
    // 撃つ = 切る。冷めている途中・切っている途中に押した分は冷めたらすぐ切る（コンボの 2 回目を落とさない）
    if (inp.consumeFirePress()) this._slashQueued = true;
    if ((this._slashQueued || inp.fireHeld) && g.time >= this.cooldownUntil) { this._slashQueued = false; this._slash(); }
  }

  _slash() {
    const g = this.game, L = this._lastSlash;
    const combo = L && L.kind === 'slash' && g.time - L.at <= this.cfg.comboWindow;
    this._begin(combo ? 'slash2' : 'slash');
  }

  // 補助の相手がいれば照準を赤く（hotEvery 秒ごと）。構えている間は前の敵を探す
  _hotTick(dt, look) {
    if ((this._hotT -= dt) > 0) return;
    this._hotT = this.cfg.hotEvery;
    const hot = look ? !!this._pickTarget() : (!!this.target && !this.target.dead);
    if (hot !== this.hot) { this.hot = hot; this._setHud(true); }
  }

  // 動きの表から今の位置と向き
  _pose(u) {
    if (this._rig) { this._rigPose(u); return; }
    const name = this.state === 'idle' ? 'quick' : this.state;
    const keys = this._keys[name] || this._keys.quick;
    const g = this.group, vp = this.cfg.view.pos;
    if (!keys || keys.length === 0) { g.position.set(vp[0], vp[1], vp[2]); return; }
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1].t) i++;
    const a = keys[i], b = keys[Math.min(keys.length - 1, i + 1)];
    const span = Math.max(1e-6, b.t - a.t);
    const s = Math.max(0, Math.min(1, (u - a.t) / span));
    const p0 = keys[Math.max(0, i - 1)].p, p1 = a.p, p2 = b.p, p3 = keys[Math.min(keys.length - 1, i + 2)].p;
    g.position.set(Melee.cr(p0.x, p1.x, p2.x, p3.x, s), Melee.cr(p0.y, p1.y, p2.y, p3.y, s), Melee.cr(p0.z, p1.z, p2.z, p3.z, s));
    g.quaternion.copy(a.q).slerp(b.q, s);
    // 前腕: 手首（握りの後ろ）から肘の目安へ
    const sc = g.scale.x;
    const w = this._wrist.set(0, -0.012, 0.07 * sc).applyQuaternion(g.quaternion).add(g.position);
    const dir = this._v.copy(this._elbow).sub(w);
    const len = Math.max(0.05, Math.min(this.cfg.view.armLen || 0.36, dir.length()));
    dir.normalize();
    this.arm.position.copy(w);
    this.arm.quaternion.setFromUnitVectors(this._up, dir);
    this.arm.scale.set(1, len, 1);
  }

  // Catmull-Rom（s ∈ [0, 1] で x1 → x2）
  static cr(x0, x1, x2, x3, s) {
    const s2 = s * s, s3 = s2 * s;
    return 0.5 * ((2 * x1) + (-x0 + x2) * s + (2 * x0 - 5 * x1 + 4 * x2 - x3) * s2 + (-x0 + 3 * x1 - 3 * x2 + x3) * s3);
  }

  // ---------- 当たり ----------

  // 線分 o + d·t（t ∈ [0, len]、d は単位）と球（c, r）。いちばん近い所が r 以内なら t、外なら -1（作らない）
  static segSphere(ox, oy, oz, dx, dy, dz, len, cx, cy, cz, r) {
    const wx = cx - ox, wy = cy - oy, wz = cz - oz;
    let t = wx * dx + wy * dy + wz * dz;
    if (t < 0) t = 0; else if (t > len) t = len;
    const ex = ox + dx * t - cx, ey = oy + dy * t - cy, ez = oz + dz * t - cz;
    return (ex * ex + ey * ey + ez * ez <= r * r) ? t : -1;
  }

  _hitTest(k) {
    const g = this.game, p = g.player;
    const eye = p.eyePosition(this._eye);
    const d = g.camera.getWorldDirection(this._f);
    const reach = k.reach, br = k.bladeRadius;
    // 壁（と乗り物）までの距離
    const nav = g.world.nav;
    let wall = nav.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, reach);
    if (g.cityBoats) wall = g.cityBoats.clipRay(eye, d, wall, reach); // 動く船の船体・船室で止まる（銃と同じ）
    let wallT = wall ? wall.t : Infinity, wallMetal = false, wallPt = null, wallN = null;
    for (const v of g.vehicles) {
      if (v === g.vehicle) continue;
      const h = v.intersectRay ? v.intersectRay(eye, d, Math.min(reach, wallT)) : null;
      if (h && h.t < wallT) { wallT = h.t; wallMetal = true; wallPt = h.point; wallN = h.normal; }
    }
    // 刃が体の球に届けば体（頭のすぐ横を通っても頭にしない）、頭の球だけに届いたときだけ頭（上を向いて振った）
    let best = null, bestT = Infinity, bestHead = false;
    for (const e of g.enemies) {
      if (e.dead || e.removed) continue;
      if (Math.abs(e.pos.x - eye.x) > reach + 1.5 || Math.abs(e.pos.z - eye.z) > reach + 1.5) continue;
      const sp = e.character.hitSpheres(e._spheres);
      let bodyT = Infinity, headT = Infinity;
      for (let i = 0; i < sp.length; i++) {
        const s = sp[i], c = s.center;
        const t = Melee.segSphere(eye.x, eye.y, eye.z, d.x, d.y, d.z, reach, c.x, c.y, c.z, s.radius + br);
        if (t < 0) continue;
        if (s.head) { if (t < headT) headT = t; } else if (t < bodyT) bodyT = t;
      }
      const head = bodyT === Infinity && headT < Infinity;
      const t = head ? headT : bodyT;
      if (t < bestT) { best = e; bestT = t; bestHead = head; }
    }
    if (best && bestT < wallT) {
      this._hitEnemy(best, bestHead, eye, d, bestT);
      return;
    }
    if (wallT <= reach && !this.wallDone) {
      this.wallDone = true;
      this.hitDone = true; // 壁に当たったらこの振りは終わり
      const pt = wallPt || this._v.set(eye.x + d.x * wallT, eye.y + d.y * wallT, eye.z + d.z * wallT).clone();
      const n = wallN || (wall ? new THREE.Vector3(wall.nx, wall.ny, wall.nz) : d.clone().negate());
      this._wallHit(pt, n, wallMetal);
    }
  }

  _wallHit(pt, n, metal) {
    const g = this.game;
    this.stats.walls++;
    g.fx.impact(pt, n);
    const a = g.audio;
    const F = this.cfg.feel;
    if (a && typeof a.play === 'function') a.play(this.cfg.sounds.wall, { volume: F.volWall, pos: pt, channel: 'self' });
    g.player.kick(F.kickWall);
  }

  _hitEnemy(e, head, eye, d, t) {
    const g = this.game, C = this.cfg;
    this.hitDone = true;
    // 背後か（敵の前は (sin yaw, cos yaw)。攻める人が敵の後ろ ±angle 度にいる）
    const ax = g.player.pos.x - e.pos.x, az = g.player.pos.z - e.pos.z;
    const al = Math.hypot(ax, az) || 1e-6;
    const back = (ax * Math.sin(e.yaw) + az * Math.cos(e.yaw)) / al <= -Math.cos(C.backstab.angle * Math.PI / 180);
    let dmg = back ? C.backstab.damage : this.kindCfg(this.state).damage;
    if (head) { dmg *= C.headMult; this.stats.heads++; }
    const pt = new THREE.Vector3(eye.x + d.x * t, eye.y + d.y * t, eye.z + d.z * t);
    const killed = e.takeMelee ? e.takeMelee(dmg, d.clone()) : e.takeDamage(dmg, d.clone()); // よろめき・押し戻し（K3）
    this.stats.hits++;
    if (back) this.stats.backstabs++;
    g.fx.hitFlesh(pt, d);
    const a = g.audio;
    const F = C.feel;
    if (a && typeof a.play === 'function') a.play(C.sounds.hit, { volume: F.volHit, pos: pt, channel: 'self' });
    if (killed) { this.stats.kills++; this.lastKillAt = g.time; g._onKill(); }
    g.hud.hit(killed);
    if (a && typeof a.hit === 'function') a.hit();
    g.player.kick(F.kickHit);
    g.shake = Math.min(F.shakeMax, (g.shake || 0) + F.shakeHit);
    this.lastHit = { kind: this.state, back, head, killed, dmg };
  }

  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // 動く船（cityBoats.clipRay）が目から (x, y, z) までの間をふさぐか
  _boatBlocks(eye, x, y, z) {
    const d = this._v.set(x - eye.x, y - eye.y, z - eye.z);
    const len = d.length();
    if (len < 1e-6) return false;
    d.multiplyScalar(1 / len);
    return !!this.game.cityBoats.clipRay(eye, d, null, len);
  }

  dispose() {
    this.cancel(); // 共有の HUD に ×（#crosshair.melee）・knife-out を残さない
    if (this._enemyWarm) { MR.Melee.disposeEnemyKnife({ _knifeMesh: this._enemyWarm }); this._enemyWarm = null; }
    for (const m of this._enemyWarmMats || []) m.dispose();
    this._enemyWarmMats = [];
    this.disposed = true;
    if (this._rig) { this._rig.dispose(); this._rig = null; } // 腕の複製（形・材質は arms.glb のキャッシュと共有。銃の腕と同じ）
    for (const o of [this.arm, this.group, this.trail]) if (o && o.parent) o.parent.remove(o);
    // knife.glb のジオメトリ・材質は AssetManager のキャッシュと共有なので捨てない。コードの形・材質・軌跡だけ
    for (const geo of this._geos || []) geo.dispose();
    for (const m of this._mats || []) m.dispose();
    this._geos = []; this._mats = [];
  }
};

// ---------- 敵のナイフ（K3）----------
// 設定（game が Melee を作ったときに melee.enemy を入れる。オンライン・ナイフ無しのゲームは null = 敵はナイフを持たない）
MR.Melee.enemyCfg = null;
// 骨のポーズ（glTF の兵士）: [clavicle_r, upperarm_r, lowerarm_r, spine_03] ごとに [溜めの x, y, z, 突きの x, y, z]（度。モデルの座標の軸）
MR.Melee.ENEMY_POSE = [[0, 0, 10, 0, 0, -5], [-55, 0, 25, 25, 0, -10], [-70, 0, 0, 30, 0, 0], [0, 20, 0, 0, -25, 0]];

// 突く動きの割合: wind = 引く（0 → 1 → 0）、thrust = 突き出す（0 → 1 → 0）。t は 0..1
//   curve（melee.enemy.curve）: [溜めが終わる, 溜めを戻す長さ, 突ききる, 戻り始める]
MR.Melee._sm = function (x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
MR.Melee.stabCurve = function (t) {
  const out = MR.Melee._sc || (MR.Melee._sc = { wind: 0, thrust: 0 });
  const sm = MR.Melee._sm, c = (MR.Melee.enemyCfg && MR.Melee.enemyCfg.curve) || [0.4, 0.12, 0.55, 0.6];
  out.wind = t < c[0] ? sm(t / c[0]) : 1 - sm((t - c[0]) / c[1]);
  out.thrust = t < c[0] ? 0 : (t < c[2] ? sm((t - c[0]) / (c[2] - c[0])) : 1 - sm((t - c[3]) / (1 - c[3])));
  return out;
};
MR.Melee._knifeScene = null;
MR.Melee.shareOverride = null; // テスト用（smoke-test.js の古い場面は 0 = ナイフの敵を出さない。場面 26 が自分で確かめる）

// 敵の手（gun_socket / コードの兵士の右手）にナイフを付ける・突く間だけ見せる。s: 0..1 = 突いている途中、-1 = しまう（銃を戻す）
MR.Melee.enemyPose = function (e, s) {
  const ch = e.character;
  if (!ch) return;
  if (s < 0) {
    ch.knifeT = -1;
    if (e._knifeMesh) e._knifeMesh.visible = false;
    if (ch.gun) ch.gun.visible = true;
    if (ch.rifle) ch.rifle.visible = true;
    return;
  }
  if (!e._knifeMesh) e._knifeMesh = MR.Melee.makeEnemyKnife(ch);
  if (e._knifeMesh) e._knifeMesh.visible = true;
  if (ch.gun) ch.gun.visible = false;
  if (ch.rifle) ch.rifle.visible = false;
  ch.knifeT = s;
};

// knife.glb があればその複製（材質は複製・テクスチャは共有）、無ければコードの刃。付ける先は character.knifeMount()
MR.Melee.makeEnemyKnife = function (ch) {
  const mount = typeof ch.knifeMount === 'function' ? ch.knifeMount() : null;
  if (!mount) return null;
  let k;
  const own = [];
  if (MR.Melee._knifeScene) {
    k = MR.Melee._knifeScene.clone(true);
    k.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone(); own.push(o.material); // ビューモデルのナイフと材質を共有しない
      o.castShadow = false; o.receiveShadow = false;
    });
  } else {
    const M = MR.Melee._codeKnife || (MR.Melee._codeKnife = {
      geo: new THREE.BoxGeometry(0.008, 0.034, 0.3).translate(0, 0, -0.1),
      mat: new THREE.MeshStandardMaterial({ color: MR.srgb('#b9bec5'), metalness: 0.7, roughness: 0.35 })
    });
    k = new THREE.Mesh(M.geo, M.mat);
  }
  k.userData.ownMaterials = own;
  k.visible = false;
  mount.node.add(k);
  if (mount.pos) k.position.copy(mount.pos);
  if (mount.rot) k.rotation.copy(mount.rot);
  return k;
};

MR.Melee.disposeEnemyKnife = function (e) {
  const k = e._knifeMesh;
  if (!k) return;
  if (k.parent) k.parent.remove(k);
  for (const m of k.userData.ownMaterials || []) m.dispose();
  e._knifeMesh = null;
};

// 合成音（ファイル knife_*.mp3 が無い・まだデコードしていないとき）。this は MR.Audio
if (MR.Audio && MR.Audio.SYNTH) {
  Object.assign(MR.Audio.SYNTH, {
    // 振る: 高い所から下がるノイズの「シュッ」
    knife_swing(dest, vol) {
      const t = this.ctx.currentTime;
      const f = this._noise(dest, t, 'bandpass', 2600, 1.6, 0.35 * vol, 0.2);
      if (f && f.frequency && f.frequency.exponentialRampToValueAtTime) { f.frequency.setValueAtTime(3400, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.18); }
    },
    // 突く: 短く上がる「シュッ」
    knife_stab(dest, vol) {
      const t = this.ctx.currentTime;
      const f = this._noise(dest, t, 'bandpass', 1800, 1.8, 0.3 * vol, 0.15);
      if (f && f.frequency && f.frequency.exponentialRampToValueAtTime) { f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.14); }
    },
    // 当たった: 鈍い「ドッ」+ 短いノイズ
    knife_hit(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sine', 180, 60, 0.7 * vol, 0.14);
      this._noise(dest, t, 'lowpass', 1200, null, 0.4 * vol, 0.08);
    },
    // 壁: 金属の「カキン」
    knife_wall(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(3100, 0.05, 0.18 * vol, dest, t);
      this._click(4700, 0.04, 0.12 * vol, dest, t + 0.008);
      this._noise(dest, t, 'highpass', 3000, null, 0.25 * vol, 0.07);
    },
    // 抜く: 「カチッ」+ 上がる「シャッ」
    knife_draw(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(1800, 0.02, 0.15 * vol, dest, t);
      const f = this._noise(dest, t + 0.05, 'bandpass', 3000, 2.2, 0.2 * vol, 0.25);
      if (f && f.frequency && f.frequency.exponentialRampToValueAtTime) { f.frequency.setValueAtTime(2500, t + 0.05); f.frequency.exponentialRampToValueAtTime(7000, t + 0.3); }
    }
  });
}
