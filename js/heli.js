// ヘリコプター（MR.Helicopter。MR.Vehicle を継承し、game.js からは乗り物として扱える: kind === 'heli'）と、
// 街のどこでも使える建物の当たり判定（MR.HeliCollider）。
//
// ■ 操縦（アーケード。質量は無い。数値はすべて game.json の vehicles.types.heli、無いキーは DEFAULTS）
//   setFlight(fwd, strafe, climb, yaw): 左スティックの前後（ヘリの向きに対して）・左右（横移動）、上昇 +1 / 下降 -1、
//   向かせたい向き（カメラの向き。yawFollow の速さで追い、maxYawRate で頭打ち。浮いているときだけ）。
//   入力が無ければ水平は brake で止まってホバリング、高さは保つ（上下の速さを 0 へ）。地面に近いほど降下が遅くなる（groundEffect）。
//   回転数（rotor 0..1）は操縦士が乗ると spinUpTime 秒で上がり（heli_start）、liftRpm 未満では浮かない。誰も乗っていなければ
//   地上では spinDownTime 秒で止まり、空中では autoHoverTime 秒ホバリングしてから autoDescend m/s でまっすぐ降りて着陸する。
//   上限の高さ: maxAltitude（ただし半径 ceilingRadius m の建物の一番上 + ceilingMargin までは上がれる。塔のヘリポート用）。地図の端は柔らかい壁。
//   機体の傾き（見た目）: 加速度の向きに tiltGain、前進の速さで cruisePitch。pitch > 0 = 機首下げ、roll > 0 = 右へ傾く。
// ■ 当たり判定: 機体を円（キャビン 3・テールブーム 6・メインローター 1。高さの帯つき）で表し、0.3 m 以下の小刻みで動かして
//   nav（読み込み済みのチャンクの細かい箱・スロープ）と HeliCollider（区画の建物の段 + ランドマーク・橋・空母の大きな箱。いつでも引ける）
//   から押し出す。キャビンの帯は stepUp までの箱を床として扱う（屋上に降りる）。ぶつかった速さが impactSpeed を超えたら
//   impactDamage × 超えた分のダメージ（ローターは rotorStrike 倍）と跳ね返り（bounce）。
//   着地: スキッドの 4 隅 + 中心の下の立てる面（nav.groundInfo、未読込なら HeliCollider.supportAt）。着地の縦の速さが landingSpeed を
//   超えたら landingDamage × 超えた分。水の上は浮いて floatTime 秒後に沈む（Vehicle の _startSink → ctx.onSinkEject / onSunk）。
// ■ 爆発（HP 0）: 火の玉 → 黒焦げの残骸が重力で落ち、下の面で止まって燃える（水なら沈む）→ respawn 秒後にヘリポートで復活。
// ■ 見た目: assets/<tier>/models/helicopter.glb（ルート Helicopter、body / body_glass / rotor_main / rotor_main_blur / rotor_tail、
//   空ノード seat_driver / seat_p1..3 / exit_driver / exit_p1..3 / light_nav_l / light_nav_r / light_anticol / skid_contact。前 +Z、
//   原点はスキッドの真ん中の地面、左 = +X）。無ければコードで組んだヘリ（同じノード名）。ローターは回転数で回り、速くなると
//   ブレードが消えてぼかしの円盤が出る。航法灯・衝突防止灯（点滅）は加算のスプライト（エンジンが掛かっているときだけ）。
//   setCockpit(true): 自分が乗っている一人称のとき、メッシュをレイヤー 1 にも入れる（game.js が深度を消して near の小さいカメラで重ね描く）。
// ■ 音: audio.rotor()（heli_rotor のループ: 回転数と負荷で 0.7〜1.4 倍、heli_wind: 乗っている人だけ速さで）・heli_start（始動）。
//   乗っている人には耳元（listenerPos）、他の人にはローターの位置の 3D。
// ■ オンライン（フェーズ D）で同期する状態: netState() → { p:[x,y,z], yaw, pitch, roll, v:[vx,vy,vz], rpm, col（上下の入力）, hp, seats }
// ---------- 建物の当たり判定（THREE 不要。サーバー（server/cityworld.js）も require する）----------
(function (root) {
  const MR = root.MR || (root.MR = {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- 建物の当たり判定（街全体。チャンクの中身を作らずに引ける）----------
  // 区画の建物の段（tiers）と、静的な大きな箱（ランドマーク・橋・空母・高架。上端が 1 m より上）を 16 m の格子に入れる。
  // チャンクごとに必要になったときに入れる（その周り maxOverhang のチャンクも。中身は持ち主のチャンクから最大 64 m はみ出す）。
  // 屋根・パラペットの細かい形・梯子・小物は nav（読み込み済みのチャンク）が受け持つ。地図全体を入れても数 MB
  class HeliCollider {
    constructor(city, opts) {
      opts = opts || {};
      this.city = city;
      this.cell = opts.cell || 16;
      this.grid = new Map();
      this.done = new Uint8Array(city.ncx * city.ncz);
      this.count = 0;
      this.chunks = 0;
      this.over = Math.ceil((city.plan.maxOverhang || 64) / city.cs);
      this._stamp = 1;
      this._q = [];
    }
    _key(i, j) { return (i + 2048) * 4096 + (j + 2048); }
    _buf() { this._q.length = 0; return this._q; }
    _add(b) {
      const S = this.cell, mx = this.city.minX, mz = this.city.minZ;
      const i0 = Math.floor((b.x0 - mx) / S), i1 = Math.floor((b.x1 - mx) / S), j0 = Math.floor((b.z0 - mz) / S), j1 = Math.floor((b.z1 - mz) / S);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = this._key(i, j);
        let a = this.grid.get(k);
        if (!a) { a = []; this.grid.set(k, a); }
        a.push(b);
      }
      this.count++;
    }
    // チャンク ci の持ち物を格子に入れる（1 回だけ）
    _ingest(cx, cz) {
      const c = this.city;
      if (cx < 0 || cz < 0 || cx >= c.ncx || cz >= c.ncz) return;
      const ci = cz * c.ncx + cx;
      if (this.done[ci]) return;
      this.done[ci] = 1;
      this.chunks++;
      for (const li of c.ixLots[ci]) {
        const L = c.lots[li];
        // ent: 入れる建物（中は空洞。サーバーの視線・壁の判定では使わない）、lob: 1 段目の下のロビーの天井の高さ（ロビーは中に入れる）
        for (let ti = 0; ti < L.tiers.length; ti++) {
          const t = L.tiers[ti];
          this._add({ k: 0, x0: t[0], z0: t[1], x1: t[2], z1: t[3], y0: t[4], y1: t[5], f: 4, lot: L.i, ent: L.ent ? 1 : 0, lob: ti === 0 && L.lobby ? t[4] + L.lobbyH : 0 });
        }
      }
      const st = c.sb[ci];
      if (st) for (const b of st.boxes) {
        if ((b.f & 1) || b.y + b.h <= 1.0 || b.h < 0.2) continue;
        this._add({ k: 0, x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y, y1: b.y + b.h, z0: b.z - b.d / 2, z1: b.z + b.d / 2, f: (b.f & 6) | 0, src: b }); // 4 WALK・2 NOLOS
      }
    }
    // 矩形にかかるチャンク（+ はみ出しの分）を入れておく
    _ensure(x0, z0, x1, z1) {
      const c = this.city, cs = c.cs, o = this.over;
      const a0 = Math.floor((x0 - c.minX) / cs) - o, a1 = Math.floor((x1 - c.minX) / cs) + o;
      const b0 = Math.floor((z0 - c.minZ) / cs) - o, b1 = Math.floor((z1 - c.minZ) / cs) + o;
      for (let cz = b0; cz <= b1; cz++) for (let cx = a0; cx <= a1; cx++) {
        if (cx < 0 || cz < 0 || cx >= c.ncx || cz >= c.ncz) continue;
        if (!this.done[cz * c.ncx + cx]) this._ingest(cx, cz);
      }
    }
    // 矩形と重なる箱（重複なし）を out に足す
    query(x0, z0, x1, z1, out) {
      out = out || [];
      this._ensure(x0, z0, x1, z1);
      const S = this.cell, mx = this.city.minX, mz = this.city.minZ, st = ++this._stamp;
      const i0 = Math.floor((x0 - mx) / S), i1 = Math.floor((x1 - mx) / S), j0 = Math.floor((z0 - mz) / S), j1 = Math.floor((z1 - mz) / S);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const a = this.grid.get(this._key(i, j));
        if (!a) continue;
        for (let n = 0; n < a.length; n++) {
          const b = a[n];
          if (b._s === st) continue;
          b._s = st;
          if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
          out.push(b);
        }
      }
      return out;
    }
    // (x, z) の立てる面（上面 ≤ yFeet + step の一番高い所）。無ければ陸 0 / 水（y: null, water）
    supportAt(x, z, yFeet, step) {
      const lim = yFeet + (step == null ? 0.45 : step);
      const a = this.query(x, z, x, z, this._buf());
      let best = -Infinity;
      for (const b of a) if ((b.f & 4) && b.y1 <= lim && b.y1 > best && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) best = b.y1;
      const g = this.city.groundAt(x, z);
      if (g.water === null && g.y <= lim && g.y > best) best = g.y;
      if (best === -Infinity) return { y: null, water: g.water };
      return { y: best, water: g.water };
    }
    // 半径 r の中で一番高い箱の上端（上限の高さに使う）
    maxTop(x, z, r) {
      const a = this.query(x - r, z - r, x + r, z + r, this._buf());
      let m = 0;
      for (const b of a) if (b.y1 > m) m = b.y1;
      return m;
    }
    // 頭の上（yHead より上）で一番低い箱の下面（半径 r の円にかかるもの）
    ceilingAt(x, z, yHead, r) {
      const a = this.query(x - r, z - r, x + r, z + r, this._buf());
      let best = Infinity;
      for (const b of a) {
        const dx = x - clamp(x, b.x0, b.x1), dz = z - clamp(z, b.z0, b.z1);
        if (dx * dx + dz * dz > r * r) continue;
        if (b.y0 >= yHead && b.y0 < best) best = b.y0;
      }
      return best;
    }
    // レイ（チェイスカメラの壁よけ）。一番近い当たりの t（無ければ null）
    raycast(ox, oy, oz, dx, dy, dz, maxT) {
      const ex = ox + dx * maxT, ez = oz + dz * maxT;
      const a = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this._buf());
      let best = null;
      for (const b of a) {
        const t = MR.Nav3D.rayBox(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
        if (t !== null && t <= maxT && (best === null || t < best)) best = t;
      }
      return best;
    }
    // 点が箱の中か（テスト用）
    inside(x, y, z) {
      const a = this.query(x, z, x, z, this._buf());
      for (const b of a) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return b;
      return null;
    }
    stats() { return { chunks: this.chunks, boxes: this.count, cells: this.grid.size }; }
  }

  MR.HeliCollider = HeliCollider;
  if (typeof module !== 'undefined' && module.exports) module.exports = HeliCollider;
})(typeof window !== 'undefined' ? window : globalThis);

// ---------- ヘリ本体（THREE と MR.Vehicle が要る。Node のサーバーでは読まない）----------
if (typeof window !== 'undefined' && window.THREE && window.MR && window.MR.Vehicle) (function () {
  const DEFAULTS = {
    name: 'ヘリ', kind: 'heli', model: 'models/helicopter.glb', fallback: 'heli', scale: 1,
    length: 10.6, width: 2.32, height: 3.45,
    health: 1000, armor: 0.6, driverExposure: 0.25,
    maxSpeed: 45, maxBackward: 14, maxStrafe: 18, accel: 8, brake: 11, easeSpeed: 4,
    climbRate: 9, descendRate: 8, vAccel: 12, vBrake: 18,
    maxAltitude: 220, ceilingMargin: 35, ceilingRadius: 70, boundsMargin: 80,
    yawFollow: 2.4, maxYawRate: 80, yawAccel: 260,
    tiltGain: 0.55, cruisePitch: 7, pitchMax: 18, rollMax: 24, tiltRate: 3.5,
    spinUpTime: 3.0, liftRpm: 0.9, spinDownTime: 9, rotorRev: 6.5, tailRatio: 5,
    groundEffect: 7, touchdownSpeed: 1.3, stepUp: 0.45,
    landingSpeed: 5, landingDamage: 45, landingSlope: 0.25, landingMaxSpeed: 8, skidFriction: 6,
    impactSpeed: 4, impactDamage: 14, rotorStrike: 1.3, bounce: 0.35, collisionSpin: 0.5,
    explodeRadius: 10, explodeDamage: 220, respawn: 45,
    floatTime: 4, sinkTime: 4, autoHoverTime: 2.5, autoDescend: 3,
    washHeight: 15, hoverBob: 0.035, wreckGravity: 14,
    seat: [-0.42, 1.92, 1.0], exit: [-1.85, 0, 1.0],
    seats: [
      { node: 'seat_driver', exitNode: 'exit_driver', seat: [-0.42, 1.92, 1.0], exit: [-1.85, 0, 1.0] },
      { node: 'seat_p1', exitNode: 'exit_p1', seat: [0.42, 1.92, 1.0], exit: [1.85, 0, 1.0] },
      { node: 'seat_p2', exitNode: 'exit_p2', seat: [0.40, 1.89, -0.95], exit: [1.85, 0, -0.95] },
      { node: 'seat_p3', exitNode: 'exit_p3', seat: [-0.40, 1.89, -0.95], exit: [-1.85, 0, -0.95] }
    ],
    color: '#1f2f4d'
  };
  const PIVOT = 1.4;            // 傾きの中心の高さ（スキッドの下端から。重心のあたり）
  const SUB = 0.3;              // 1 回に動かす最大の距離（m。小刻みにして壁を抜けない）
  const HUB = { y: 3.3, r: 5.35 };
  // 機体の円（ローカル z / 半径 / 帯の下端・上端（スキッドの下端から）/ step: 帯の下 stepUp までの箱は床）
  const HULL = [
    { part: 'cabin', x: 0, z: 1.75, r: 1.0, lo: 0, hi: 2.6, step: true },
    { part: 'cabin', x: 0, z: 0.55, r: 1.2, lo: 0, hi: 2.9, step: true },
    { part: 'cabin', x: 0, z: -0.75, r: 1.2, lo: 0, hi: 2.9, step: true },
    { part: 'boom', x: 0, z: -2.1, r: 0.55, lo: 1.3, hi: 2.6 },
    { part: 'boom', x: 0, z: -3.1, r: 0.45, lo: 1.5, hi: 2.4 },
    { part: 'boom', x: 0, z: -4.1, r: 0.45, lo: 1.5, hi: 2.4 },
    { part: 'boom', x: 0, z: -5.1, r: 0.45, lo: 1.5, hi: 2.4 },
    { part: 'boom', x: 0, z: -6.25, r: 1.1, lo: 1.75, hi: 2.15 },
    { part: 'boom', x: 0.1, z: -7.35, r: 0.8, lo: 1.4, hi: 3.15 },
    { part: 'rotor', x: 0, z: 0, r: HUB.r, lo: 3.15, hi: 3.5 }
  ];
  // 弾・押し出し用の箱（ローカル）
  const BOXES = [
    { x0: -1.0, x1: 1.0, y0: 0.35, y1: 2.6, z0: -1.5, z1: 2.67 },   // キャビン
    { x0: -0.35, x1: 0.35, y0: 1.45, y1: 3.1, z0: -7.95, z1: -1.5 } // テールブーム・垂直尾翼
  ];
  const FOOT = [[-1.1, -1.5], [1.1, -1.5], [-1.1, 1.5], [1.1, 1.5], [0, 0]]; // 地面を見る点（スキッドの 4 隅 + 中心）

  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const D2R = Math.PI / 180;
  const srgb = (hex) => (MR.srgb ? MR.srgb(hex) : new THREE.Color(hex));

  // 円（x, z, 半径 r、高さの帯 lo..hi）を箱（nav の要素 / HeliCollider の箱。x0..x1, y0..y1, z0..z1, k = 1 はスロープ）から押し出す。
  // 上面 ≤ lo の箱は通る（床）。中心が箱に入ったら動いてきた向きの反対の面から出す（薄い壁を抜けない）。戻り値は out = [x, z, 押した?]
  function pushCircle(cands, x, z, r, lo, hi, mx, mz, out) {
    let pushed = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let n = 0; n < cands.length; n++) {
        const b = cands[n];
        if (b.f & 1) continue;
        const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
        let top = b.y1, bot = b.y0;
        if (b.k === 1) { top = MR.Nav3D.itemTop(b, cx, cz); bot = top - (b.t || 0.3); }
        if (top <= lo || bot >= hi) continue;
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), p = r - d;
          x += dx / d * p; z += dz / d * p;
        } else {
          // 中心が箱の中: 来た向きの反対側の面へ（動きが無ければ一番近い面）
          const e0 = x - b.x0, e1 = b.x1 - x, e2 = z - b.z0, e3 = b.z1 - z;
          let best = Infinity, face = -1;
          const cand = (d, f, ok) => { if (ok && d < best) { best = d; face = f; } };
          const any = Math.abs(mx) + Math.abs(mz) < 1e-6;
          cand(e0, 0, any || mx > 0); cand(e1, 1, any || mx < 0); cand(e2, 2, any || mz > 0); cand(e3, 3, any || mz < 0);
          if (face < 0) { cand(e0, 0, true); cand(e1, 1, true); cand(e2, 2, true); cand(e3, 3, true); }
          if (face === 0) x = b.x0 - r; else if (face === 1) x = b.x1 + r; else if (face === 2) z = b.z0 - r; else z = b.z1 + r;
        }
        moved = true; pushed = true;
      }
      if (!moved) break;
    }
    out[0] = x; out[1] = z; out[2] = pushed;
    return out;
  }

  const HeliCollider = MR.HeliCollider;

  // スプライトの材質（航法灯）。最初に使うときに作る
  let LIGHT_MATS = null;
  function lightMats() {
    if (LIGHT_MATS) return LIGHT_MATS;
    const glow = (hex) => {
      if (MR.FX && MR.FX.makeGlowTexture && typeof document !== 'undefined') {
        try { return MR.FX.makeGlowTexture(hex); } catch (e) { /* Node のスタブ */ }
      }
      return null;
    };
    const mk = (hex) => new THREE.SpriteMaterial({ map: glow(hex), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    LIGHT_MATS = { red: mk('#ff3030'), green: mk('#40ff70'), beacon: mk('#ff2020') };
    return LIGHT_MATS;
  }

  class Helicopter extends MR.Vehicle {
    constructor(scene, def, opts) {
      super(scene, Object.assign({}, DEFAULTS, def || {}), opts);
      this.def = Object.assign({}, MR.Vehicle.DEFAULTS, DEFAULTS, def || {});
      this.def.seat = Array.isArray(this.def.seat) ? this.def.seat : DEFAULTS.seat;
      this.def.exit = Array.isArray(this.def.exit) ? this.def.exit : DEFAULTS.exit;
      this.health = num(opts && opts.health, this.def.health);
      this.collider = (opts && opts.collider) || null;
      this.city = (opts && opts.city) || null;
      if (opts && opts.airborne) { this.grounded = false; this.airborne = true; this.spin = 1; this.rotor = 1; this.engineOn = true; }
      this._apply();
    }

    _preInit(opts) {
      this.kind = 'heli';
      this.vel = new THREE.Vector3();
      this.pitch = 0; this.roll = 0; this.yawRate = 0;
      this.spin = 0;           // 始動の進み 0..1（回転数は smoothstep）
      this.rotor = 0;          // ローターの回転数 0..1
      this.rotorAngle = 0; this.tailAngle = 0;
      this.ctl = { fwd: 0, strafe: 0, climb: 0, yaw: null };
      this.grounded = true; this.airborne = false;
      this.agl = 0; this.groundY = 0; this.onWater = false;
      this.engineOn = false;
      this.autoT = 0;
      this.floatT = -1;
      this.wreckFall = null;
      this.cockpit = false;
      this.cantLand = 0;          // 降りようとしたが傾き・縁で降りられなかった（秒。HUD の表示）
      this.localInside = false;   // 自分（このゲームのプレイヤー）が乗っている
      this.listenerPos = null;    // 乗っているときの耳の位置（音を 2D 寄りにする）
      this.bob = 0;
      this.load = 0;              // 音の負荷（上昇・速さ）
      this._acc = new THREE.Vector3();
      this._lastVx = 0; this._lastVz = 0;
      this._prevVel = new THREE.Vector3();
      this._cands = [];
      this._pc = [0, 0, false];
      this._washT = 0;
      this._ceilT = 0; this._ceil = DEFAULTS.maxAltitude;
      this.lastImpactSpeed = 0;
      this.impacts = 0;
      this.landings = [];         // { t, vy, h, dmg }（テスト・デバッグ用）
      this.stats = { maxImpact: 0, collisionDamage: 0, landingDamage: 0 };
      this._lights = null;
      this._ownMats = [];
      this.pivotNode = null;
    }

    // ---------- 見た目 ----------

    // GLB が無いときのコードのヘリ（ノード名は GLB と同じ）
    static buildFallback(def) {
      const g = new THREE.Group();
      g.name = 'Helicopter';
      const body = new THREE.Group();
      body.name = 'body';
      g.add(body);
      const mat = (hex, o) => new THREE.MeshStandardMaterial(Object.assign({ color: srgb(hex), roughness: 0.5, metalness: 0.25 }, o || {}));
      const navy = mat(def.color || '#1f2f4d'), white = mat('#e8ecef'), dark = mat('#22262b', { roughness: 0.7 }), trim = mat('#4b5157', { roughness: 0.8 });
      const glass = new THREE.MeshStandardMaterial({ color: srgb('#1d2a31'), roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false });
      const box = (m, w, h, d, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); (parent || body).add(o); return o; };
      const cyl = (m, r0, r1, len, x, y, z, ax, parent) => {
        const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 12), m);
        if (ax === 'z') o.rotation.x = Math.PI / 2; else if (ax === 'x') o.rotation.z = Math.PI / 2;
        o.position.set(x, y, z); (parent || body).add(o); return o;
      };
      // 胴体（下は紺、上は白）・床・計器盤・座席・窓枠（中から外が見えるよう、箱の面は外向きだけ）
      box(navy, 1.7, 0.85, 3.7, 0, 1.0, 0.55);
      box(white, 1.5, 0.12, 2.3, 0, 2.38, 0.25);
      box(white, 1.1, 0.55, 2.0, 0, 2.6, -0.7);
      box(trim, 1.55, 0.05, 3.3, 0, 1.44, 0.55);
      box(dark, 1.4, 0.3, 0.25, 0, 1.6, 2.0);
      for (const sx of [-0.42, 0.42]) { box(trim, 0.5, 0.12, 0.5, sx, 1.5, 1.0); box(trim, 0.5, 0.65, 0.1, sx, 1.85, 0.72); }
      box(trim, 1.4, 0.12, 0.5, 0, 1.47, -0.95); box(trim, 1.4, 0.6, 0.1, 0, 1.8, -1.25);
      for (const sx of [-1, 1]) { box(white, 0.06, 0.95, 0.08, sx * 0.8, 1.92, 1.85); box(white, 0.06, 0.95, 0.08, sx * 0.8, 1.92, -0.2); }
      const gl = box(glass, 1.62, 0.95, 2.45, 0, 1.92, 0.75, g);
      gl.name = 'body_glass';
      // テールブーム・尾翼・水平安定板
      cyl(navy, 0.16, 0.32, 6.2, 0, 1.95, -4.45, 'z');
      box(navy, 0.1, 1.3, 0.8, 0, 2.45, -7.5);
      box(white, 2.2, 0.05, 0.5, 0, 1.95, -6.3);
      // スキッド
      for (const sx of [-1.1, 1.1]) {
        cyl(dark, 0.045, 0.045, 3.6, sx, 0.045, 0.2, 'z');
        for (const zz of [0.95, -0.85]) cyl(dark, 0.04, 0.04, 0.62, sx * 0.93, 0.33, zz, null);
      }
      for (const zz of [0.95, -0.85]) cyl(dark, 0.04, 0.04, 2.0, 0, 0.62, zz, 'x');
      // メインローター（ハブ (0, 3.3, 0)。ブレード 4 枚、45° から）
      const rm = new THREE.Group();
      rm.name = 'rotor_main';
      rm.position.set(0, HUB.y, 0);
      body.add(rm);
      cyl(dark, 0.18, 0.22, 0.3, 0, 0, 0, null, rm);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2;
        const bl = new THREE.Mesh(new THREE.BoxGeometry(5.05, 0.04, 0.27), dark);
        bl.position.set(Math.cos(a) * 2.83, 0.05, -Math.sin(a) * 2.83);
        bl.rotation.y = a;
        rm.add(bl);
      }
      const blurMat = new THREE.MeshBasicMaterial({ color: srgb('#3a3e44'), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
      const ringGeo = new THREE.RingGeometry(0.75, 5.42, 48, 1);
      ringGeo.rotateX(-Math.PI / 2);
      const blur = new THREE.Mesh(ringGeo, blurMat);
      blur.name = 'rotor_main_blur';
      blur.position.set(0, HUB.y + 0.03, 0);
      body.add(blur);
      // テールローター（ハブ (0.24, 2.25, -7.45)、X 軸まわり）
      const rt = new THREE.Group();
      rt.name = 'rotor_tail';
      rt.position.set(0.24, 2.25, -7.45);
      body.add(rt);
      for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.8, 0.12), white); b.position.set(0, s * 0.42, 0); rt.add(b); }
      // 空ノード（GLB と同じ位置）
      const empty = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); body.add(o); return o; };
      empty('seat_driver', -0.42, 1.92, 1.0); empty('seat_p1', 0.42, 1.92, 1.0); empty('seat_p2', 0.40, 1.89, -0.95); empty('seat_p3', -0.40, 1.89, -0.95);
      empty('exit_driver', -1.85, 0, 1.0); empty('exit_p1', 1.85, 0, 1.0); empty('exit_p2', 1.85, 0, -0.95); empty('exit_p3', -1.85, 0, -0.95);
      empty('light_nav_l', 1.095, 1.95, -6.3); empty('light_nav_r', -1.095, 1.95, -6.3); empty('light_anticol', 0, 3.08, -7.66); empty('skid_contact', 0, 0, 0);
      g.userData.source = 'procedural';
      return g;
    }

    _setModel(group, source) {
      // 前のモデルの自分用の材質・灯りを片付ける
      for (const m of this._ownMats || []) m.dispose();
      this._ownMats = [];
      if (this._lights) for (const s of this._lights) if (s.parent) s.parent.remove(s);
      this._lights = null;
      // 前のモデルは pivotNode の下にある（Vehicle._setModel は root から外すので、root に戻してから渡す）
      if (this.model && this.pivotNode && this.model.parent === this.pivotNode) { this.pivotNode.remove(this.model); this.root.add(this.model); }
      super._setModel(group, source);
      // 傾きの中心（重心）で回すため、モデルを pivotNode（root の子、PIVOT 下げる）に入れ直す
      if (!this.pivotNode) { this.pivotNode = new THREE.Group(); this.pivotNode.name = 'heli_pivot'; this.root.add(this.pivotNode); }
      this.pivotNode.position.set(0, -PIVOT, 0);
      this.root.remove(group);
      this.pivotNode.add(group);
      // スキッドの接地線（skid_contact の userData: halfTrack・z0・z1）。無ければ既定（x ±1.1、z ±1.5）
      const sk = group.getObjectByName('skid_contact'), ud = sk && sk.userData;
      if (ud && typeof ud.halfTrack === 'number' && typeof ud.z0 === 'number' && typeof ud.z1 === 'number') {
        const ht = ud.halfTrack, z0 = ud.z0, z1 = ud.z1;
        this.foot = [[-ht, z0], [ht, z0], [-ht, z1], [ht, z1], [0, (z0 + z1) / 2]];
      } else this.foot = FOOT;
      this.rotorMain = group.getObjectByName('rotor_main');
      this.rotorTail = group.getObjectByName('rotor_tail');
      this.rotorBlur = group.getObjectByName('rotor_main_blur');
      this.glass = group.getObjectByName('body_glass');
      const own = (mesh) => {
        if (!mesh) return null;
        const list = [];
        mesh.traverse((o) => { if (o.isMesh && o.material) { const m = o.material.clone(); o.material = m; list.push(m); this._ownMats.push(m); } });
        return list;
      };
      this.bladeMats = own(this.rotorMain) || [];
      this.blurMats = own(this.rotorBlur) || [];
      this.blurBase = this.blurMats.map((m) => m.opacity == null ? 1 : m.opacity);
      if (this.rotorBlur) this.rotorBlur.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      if (this.glass) this.glass.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      // 航法灯（左 赤・右 緑・尾翼の上の衝突防止灯 赤の点滅）
      const L = lightMats();
      const mk = (name, mat, size) => {
        const n = group.getObjectByName(name);
        if (!n) return null;
        const s = new THREE.Sprite(mat);
        s.scale.set(size, size, 1);
        s.visible = false;
        s.renderOrder = 2;
        n.add(s);
        return s;
      };
      this._lights = [mk('light_nav_l', L.red, 0.55), mk('light_nav_r', L.green, 0.55), mk('light_anticol', L.beacon, 1.1)].filter(Boolean);
      if (this.cockpit) this.setCockpit(true, true);
      if (this.pitch !== undefined) this._apply();
    }

    // 自分が乗っている一人称: メッシュをレイヤー 1 にも入れる（game.js が近いカメラで重ねて描く）
    setCockpit(on, force) {
      on = !!on;
      if (on === this.cockpit && !force) return;
      this.cockpit = on;
      if (!this.model) return;
      // メインローター・ぼかし・ガラスは本体のパスだけ（操縦席から離れていて切れない。半透明を 2 回重ねない）
      const skip = new Set();
      for (const n of [this.rotorMain, this.rotorBlur, this.glass]) if (n) n.traverse((o) => skip.add(o));
      this.model.traverse((o) => { if (o.isMesh && !skip.has(o)) { if (on) o.layers.enable(1); else o.layers.disable(1); } });
    }

    // ---------- 座標 ----------

    // ローカル（モデルの座標）→ 世界。ヨー・機首の上下・左右の傾き（重心まわり）と見た目の上下の揺れを含める
    toWorld(local, target) {
      const e = this._euler2 || (this._euler2 = new THREE.Euler(0, 0, 0, 'YXZ'));
      e.set(this.pitch, this.yaw, this.roll, 'YXZ');
      const my = this.model ? this.model.position.y : 0;
      const v = (target || new THREE.Vector3()).set(local.x, local.y + my - PIVOT, local.z).applyEuler(e);
      v.x += this.pos.x; v.y += this.pos.y + PIVOT + this.bob; v.z += this.pos.z;
      return v;
    }
    toLocal(x, z) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const dx = x - this.pos.x, dz = z - this.pos.z;
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    }
    center(target) { return this.toWorld(this._ctr || (this._ctr = new THREE.Vector3(0, 1.4, 0.2)), target); }
    get speedKmh() { return this.speed * 3.6; }
    get speedRatio() { return clamp(this.speed / this.def.maxSpeed, 0, 1); }
    get liftReady() { return this.rotor >= this.def.liftRpm; }

    // 経路探索の箱（地上にいるときだけ。飛んでいるヘリは下の道を塞がない）
    aabb() {
      if (!this.grounded || this.wrecked && this.wreckFall) return null;
      const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw));
      const hw = 1.2, hl = 5.3;
      const cx = this.pos.x + Math.sin(this.yaw) * -2.6, cz = this.pos.z + Math.cos(this.yaw) * -2.6;
      return { x: cx, z: cz, w: 2 * (hw * c + hl * s), d: 2 * (hw * s + hl * c), y: this.pos.y, h: 3.2 };
    }

    // 点 (x, z) からキャビン・テールブームの長方形までの距離（乗れる距離・降りる所）
    distanceTo(x, z) {
      const l = this.toLocal(x, z);
      let best = Infinity;
      for (const b of BOXES) {
        const dx = Math.max(0, b.x0 - l.x, l.x - b.x1), dz = Math.max(0, b.z0 - l.z, l.z - b.z1);
        best = Math.min(best, Math.sqrt(dx * dx + dz * dz));
      }
      return best;
    }

    // 半径 radius の円（p.x / p.z）をキャビン・テールブームの外へ押し出す
    pushOut(p, radius) {
      let pushed = false;
      for (const b of BOXES) {
        const l = this.toLocal(p.x, p.z);
        const x0 = b.x0 - radius, x1 = b.x1 + radius, z0 = b.z0 - radius, z1 = b.z1 + radius;
        if (l.x <= x0 || l.x >= x1 || l.z <= z0 || l.z >= z1) continue;
        const e = [l.x - x0, x1 - l.x, l.z - z0, z1 - l.z];
        let m = 0;
        for (let k = 1; k < 4; k++) if (e[k] < e[m]) m = k;
        let lx = l.x, lz = l.z;
        if (m === 0) lx = x0; else if (m === 1) lx = x1; else if (m === 2) lz = z0; else lz = z1;
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        p.x = this.pos.x + lx * c + lz * s;
        p.z = this.pos.z - lx * s + lz * c;
        pushed = true;
      }
      return pushed;
    }

    // 他の乗り物の円（x, z, r）をキャビンの円の外へ（相手の当たり判定から呼ばれる）
    _pushCircle(x, z, r) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      for (let k = 0; k < 3; k++) {
        const h = HULL[k];
        const cx = this.pos.x + h.x * c + h.z * s, cz = this.pos.z - h.x * s + h.z * c;
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz, minD = r + h.r;
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = Math.sqrt(d2), push = (minD - d) * 0.5;
        x += dx / d * push; z += dz / d * push;
      }
      return { x, z };
    }

    // 弾（レイ）: キャビンとテールブームの箱（傾きも含めて機体の座標に直して判定）
    intersectRay(origin, dir, maxT) {
      if (!MR.Nav || typeof MR.Nav.rayBox !== 'function' || (this.sunk)) return null;
      const q = this._qInv || (this._qInv = new THREE.Quaternion());
      const e = this._euler3 || (this._euler3 = new THREE.Euler(0, 0, 0, 'YXZ'));
      e.set(this.pitch, this.yaw, this.roll, 'YXZ');
      q.setFromEuler(e).invert();
      const my = this.model ? this.model.position.y : 0;
      const o = this._ro || (this._ro = new THREE.Vector3());
      const d = this._rd || (this._rd = new THREE.Vector3());
      o.set(origin.x - this.pos.x, origin.y - (this.pos.y + PIVOT + this.bob), origin.z - this.pos.z).applyQuaternion(q);
      o.y += PIVOT - my;
      d.copy(dir).applyQuaternion(q);
      let best = null, bb = null;
      for (const b of BOXES) {
        const t = MR.Nav.rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
        if (t === null || t < 0 || t > maxT) continue;
        if (best === null || t < best) { best = t; bb = b; }
      }
      if (best === null) return null;
      const lx = o.x + d.x * best, ly = o.y + d.y * best, lz = o.z + d.z * best;
      const faces = [[Math.abs(lx - bb.x0), -1, 0, 0], [Math.abs(lx - bb.x1), 1, 0, 0], [Math.abs(ly - bb.y0), 0, -1, 0], [Math.abs(ly - bb.y1), 0, 1, 0], [Math.abs(lz - bb.z0), 0, 0, -1], [Math.abs(lz - bb.z1), 0, 0, 1]];
      let f = faces[0];
      for (const g of faces) if (g[0] < f[0]) f = g;
      const normal = new THREE.Vector3(f[1], f[2], f[3]).applyEuler(e);
      return { t: best, point: origin.clone().addScaledVector(dir, best), normal };
    }

    // ---------- 乗り降り ----------

    // 乗る（Vehicle と同じ座席の規則）。操縦席ならエンジンを掛ける（回っていなければ heli_start）
    enter(player, seatIndex) {
      if (this.wrecked || this.sinking) return false;
      const i = seatIndex === -1 ? this.freeSeat() : (typeof seatIndex === 'number' ? seatIndex : 0);
      if (i < 0 || i >= this.seatCount) return false;
      if (typeof seatIndex === 'number' && this.occupants[i] && this.occupants[i] !== player) return false;
      this.occupants[i] = player;
      this._sound('vehicle_door', 0.7);
      if (i === 0) { this.ctl.fwd = 0; this.ctl.strafe = 0; this.ctl.climb = 0; this.ctl.yaw = null; this.autoT = 0; }
      return true;
    }

    exit(who) {
      const i = who ? this.seatOf(who) : 0;
      if (i > 0) this.occupants[i] = null;
      else this.clearDriver();
      this._sound('vehicle_door', 0.7);
    }

    // 操縦士を外す。エンジンは止めない（空中なら自動で降りる、地上ならゆっくり止まる）
    clearDriver() {
      this.driver = null;
      this.ctl.fwd = 0; this.ctl.strafe = 0; this.ctl.climb = 0; this.ctl.yaw = null;
      this.autoT = 0;
    }

    // 座席を移る（ソロは地上で止まっているときだけ）。移れたら新しい座席の番号、だめなら -1
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

    setControls(throttle, steer) { this.setFlight(throttle, steer, 0, null); }

    // 操縦（毎フレーム）: fwd 前が正、strafe 右が正、climb 上昇 +1 / 下降 -1、yaw 向かせたい向き（rad。null で今のまま）
    setFlight(fwd, strafe, climb, yaw) {
      const c = this.ctl;
      c.fwd = clamp(num(fwd, 0), -1, 1);
      c.strafe = clamp(num(strafe, 0), -1, 1);
      c.climb = clamp(num(climb, 0), -1, 1);
      c.yaw = (typeof yaw === 'number' && isFinite(yaw)) ? yaw : null;
    }

    horn() { /* ヘリにクラクションは無い */ }
    attachHeadlight() { /* ヘッドライトは借りない */ }

    // ---------- ダメージ・爆発 ----------

    _explode(ctx) {
      const vx = this.vel.x, vy = this.vel.y, vz = this.vel.z, air = !this.grounded;
      this.floatT = -1;
      super._explode(ctx);
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.rotor = 0; this.spin = 0; this.engineOn = false;
      if (this._startH) { try { this._startH.stop(0.2); } catch (e) { /* ignore */ } this._startH = null; }
      // 残骸: 空中なら落ちる（下の面で止まる）。地上ならその場で燃える
      this.wreckFall = air ? { vx: vx * 0.6, vy: Math.max(-3, vy) + 2, vz: vz * 0.6, spin: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random()) } : null;
      this.grounded = !air; this.airborne = air;
      this.vel.set(0, 0, 0);
      if (this.rotorBlur) this.rotorBlur.visible = false;
      this._apply();
    }

    _setWreckLook(on) {
      super._setWreckLook(on);
      if (this.bodyNode && this._bodyRot) this.bodyNode.rotation.copy(this._bodyRot);
      if (this.rotorBlur) this.rotorBlur.visible = !on && this.rotorBlur.visible;
    }

    // 残骸: 落ちる → 止まる（水なら沈んで消える）→ 煙と炎 → 復活（Vehicle._updateWreck）
    _updateWreck(dt, ctx) {
      const wf = this.wreckFall;
      if (wf) {
        const d = this.def;
        wf.vy = Math.max(-45, wf.vy - d.wreckGravity * dt);
        const k = Math.max(0, 1 - dt * 0.4);
        wf.vx *= k; wf.vz *= k;
        this.yaw += wf.spin * dt;
        this.pitch += (0.35 - this.pitch) * Math.min(1, dt * 0.8);
        if (this.rotorMain) this.rotorMain.rotation.y += wf.spin * 0.5 * dt; // 止まりかけのローター
        this.roll += (0.5 * Math.sign(wf.spin) - this.roll) * Math.min(1, dt * 0.6);
        const y0 = this.pos.y;
        const hit = this._moveCollide(wf.vx * dt, wf.vy * dt, wf.vz * dt, ctx, true);
        if (hit) { wf.vx *= 0.3; wf.vz *= 0.3; }
        const S = this._support(ctx, Math.max(y0, this.pos.y));
        if (S.y !== null && this.pos.y <= S.y && wf.vy <= 0) {
          this.pos.y = S.y;
          this.wreckFall = null;
          this.grounded = true; this.airborne = false;
          // 片方のスキッドが折れて傾いたまま止まる
          this.pitch = 0.1; this.roll = 0.32 * (wf.spin >= 0 ? 1 : -1);
          const c = this.center(this._tmp);
          if (this.fx) { if (this.fx.explosion) this.fx.explosion(c, 3); }
          this._sound('vehicle_impact', 1, c, { refDistance: 10, maxDistance: 200 });
          if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, -wf.vy);
        } else if (S.y === null && S.water !== null && this.pos.y <= S.water) {
          // 水に落ちた: しぶきを上げて沈んで消える
          this.wreckFall = null;
          if (this.audio && this.audio.splash) this.audio.splash(this.center(this._tmp), true);
          if (this.fx && this.fx.splash) this.fx.splash(this._tmp.set(this.pos.x, S.water + 0.05, this.pos.z), 3.2);
          this.sunk = true;
          this.root.visible = false;
        }
        if (this.pos.y < -60) { this.wreckFall = null; this.sunk = true; this.root.visible = false; }
        this._apply();
      }
      // 燃える: エンジンの辺りと胴体から炎と黒い煙（落ちている間も）。respawn 秒後にヘリポートで復活（プレイヤーがパッドにいなければ）
      this.respawnTimer -= dt;
      this.smokeTimer -= dt;
      if (this.fx && !this.sunk && this.smokeTimer <= 0 && this.respawnTimer > this.def.respawn * 0.2) {
        this.smokeTimer = 0.06 + Math.random() * 0.05;
        const L = this._fireL || (this._fireL = new THREE.Vector3());
        const p = this.toWorld(L.set((Math.random() - 0.5) * 1.1, 2.3 + Math.random() * 0.5, -0.7 + (Math.random() - 0.5) * 2.2), this._tmp);
        const burning = this.respawnTimer > this.def.respawn * 0.45; // 前半は炎、後半は煙だけ
        if (typeof this.fx.blackSmoke === 'function') this.fx.blackSmoke(p, 1.1 + Math.random() * 0.8); else if (this.fx.smoke) this.fx.smoke(p, 1.2);
        if (burning && typeof this.fx.fire === 'function') {
          this.fx.fire(p, 1.1);
          if (Math.random() < 0.8) this.fx.fire(this.toWorld(L.set((Math.random() - 0.5) * 1.4, 0.9 + Math.random() * 1.3, 0.2 + (Math.random() - 0.5) * 2.6), this._tmp2), 0.9);
        }
      }
      if (this.respawnTimer <= 0 && !this.netControlled) {
        const pl = ctx && ctx.player;
        const far = !pl || Math.hypot(pl.pos.x - this.spawnPos.x, pl.pos.z - this.spawnPos.z) > 14;
        if (far || this.respawnTimer < -this.def.respawn) this.respawn();
      }
    }

    respawn() {
      super.respawn();
      this.vel.set(0, 0, 0);
      this.pitch = 0; this.roll = 0; this.yawRate = 0; this.bob = 0;
      this.spin = 0; this.rotor = 0; this.engineOn = false;
      this.grounded = true; this.airborne = false; this.wreckFall = null; this.floatT = -1; this.autoT = 0;
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this._apply();
    }

    // ---------- 更新 ----------

    update(dt, ctx) {
      this.time += dt;
      if (this.disposed) return;
      if (this.wrecked) { this._updateWreck(dt, ctx); return; }
      if (this.sinking) {
        this.rotor = Math.max(0, this.rotor - dt / 2);
        this.rotorAngle += this.rotor * this.def.rotorRev * Math.PI * 2 * dt;
        this._updateSink(dt, ctx);
        return;
      }
      const d = this.def, c = this.ctl;
      const pilot = !!this.driver;
      // 止めてあるヘリ（地上・エンジン停止・無人・動いていない）は何もしない（街に何機あっても安い）
      if (!pilot && this.grounded && !this.engineOn && this.spin <= 0 && this.floatT < 0 && this.vel.x * this.vel.x + this.vel.z * this.vel.z < 1e-6) { this.speed = 0; return; }
      this._engineStep(dt, pilot);
      const lift = this.rotor >= d.liftRpm;

      // 入力（無人で浮いている: しばらくホバリングしてからまっすぐ降りる）
      let fwd = 0, strafe = 0, climb = 0, yawT = null;
      if (pilot) { fwd = c.fwd; strafe = c.strafe; climb = c.climb; yawT = c.yaw; this.autoT = 0; }
      else if (!this.grounded) { this.autoT += dt; climb = this.autoT > d.autoHoverTime ? -Math.min(1, d.autoDescend / d.descendRate) : 0; }

      // 上限の高さ（周りの一番高い建物 + 余裕。0.5 s ごと）
      this._ceilT -= dt;
      if (this._ceilT <= 0) {
        this._ceilT = 0.5;
        const top = this.collider ? this.collider.maxTop(this.pos.x, this.pos.z, d.ceilingRadius) : 0;
        this._ceil = Math.max(d.maxAltitude, top + d.ceilingMargin);
        // 2 秒先の建物を当たり判定に入れておく（入ってからの最初の問い合わせで止まらない）
        if (this.collider && this.speed > 5) { const lx = this.pos.x + this.vel.x * 2, lz = this.pos.z + this.vel.z * 2; this.collider._ensure(lx - 20, lz - 20, lx + 20, lz + 20); }
      }

      // --- 上下 ---
      const yNow = this.pos.y, agl0 = this.agl;
      let vyT;
      if (!lift) vyT = this.grounded ? 0 : -6;
      else {
        vyT = climb > 0 ? climb * d.climbRate : climb < 0 ? climb * d.descendRate : 0;
        if (vyT > 0) vyT *= clamp((this._ceil - yNow) / 20, 0, 1);
        if (yNow > this._ceil) vyT = Math.min(vyT, -(yNow - this._ceil) * 0.8);
        // 地面効果: 地面に近いほど降下を遅く（そっと着地する）
        if (vyT < 0 && agl0 < d.groundEffect) vyT = Math.max(vyT, -Math.max(d.touchdownSpeed, d.descendRate * agl0 / d.groundEffect));
      }
      if (this.grounded && !(lift && vyT > 0.05)) {
        this.vel.y = 0;
      } else {
        if (this.grounded) { this.grounded = false; this.airborne = true; this.floatT = -1; }
        // 上下の入力をやめたら（目標の速さが 0 に近づく向き）vBrake で早めに止める（行き過ぎない）
        const a = Math.abs(vyT) < Math.abs(this.vel.y) && vyT * this.vel.y >= 0 ? d.vBrake : d.vAccel;
        this.vel.y += clamp(vyT - this.vel.y, -a * dt, a * dt);
      }

      // --- 水平 ---
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      if (this.grounded) {
        const k = Math.max(0, 1 - dt * d.skidFriction);
        this.vel.x *= k; this.vel.z *= k;
      } else {
        const fz = fwd >= 0 ? fwd * d.maxSpeed : fwd * d.maxBackward;
        const fx = -strafe * d.maxStrafe; // ローカル +X は左
        let tx = fx * cy + fz * sy, tz = -fx * sy + fz * cy;
        // 地図の端は柔らかい壁（外向きの速さを端までの距離で絞る）
        const city = this.city;
        if (city) {
          const lim = (dist) => Math.max(0, dist - 5) * d.maxSpeed / d.boundsMargin;
          if (tx > 0) tx = Math.min(tx, lim(city.maxX - this.pos.x)); else tx = Math.max(tx, -lim(this.pos.x - city.minX));
          if (tz > 0) tz = Math.min(tz, lim(city.maxZ - this.pos.z)); else tz = Math.max(tz, -lim(this.pos.z - city.minZ));
        }
        const dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
        if (dl > 1e-6) {
          const input = Math.abs(fwd) > 0.05 || Math.abs(strafe) > 0.05;
          // 今の向きと逆へ入れたらブレーキの強さ
          const opp = (this.vel.x * dx + this.vel.z * dz) < 0;
          const a = (input && !opp) ? d.accel : d.brake;
          const step = a * dt * clamp(dl / d.easeSpeed, 0.3, 1);
          const f = Math.min(1, step / dl);
          this.vel.x += dx * f; this.vel.z += dz * f;
        }
      }

      // --- 向き（カメラの向きをなめらかに追う。浮いているときだけ）---
      let rateT = 0;
      if (!this.grounded && lift && yawT !== null) {
        const diff = wrap(yawT - this.yaw);
        rateT = clamp(diff * d.yawFollow, -d.maxYawRate * D2R, d.maxYawRate * D2R);
      }
      const ya = d.yawAccel * D2R * dt;
      this.yawRate += clamp(rateT - this.yawRate, -ya, ya);
      if (this.grounded) this.yawRate *= Math.max(0, 1 - dt * 8);
      this.yaw = wrap(this.yaw + this.yawRate * dt);

      // --- 動かす（小刻みに押し出し）---
      const vBefore = this._prevVel.copy(this.vel);
      const hit = this._moveCollide(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt, ctx, false);
      if (hit) this._onHit(hit, vBefore, ctx);
      this.speed = Math.hypot(this.vel.x, this.vel.z);

      // --- 天井（上昇中に高架・橋の下面）---
      if (this.vel.y > 0) {
        const top = this.pos.y + 3.5;
        let ceil = Infinity;
        if (ctx && ctx.nav) ceil = Math.min(ceil, ctx.nav.ceilingHeight(this.pos.x, this.pos.z, top - 0.6, 3.5));
        if (this.collider) ceil = Math.min(ceil, this.collider.ceilingAt(this.pos.x, this.pos.z, top - 0.6, 3.5));
        if (top > ceil) {
          const impact = this.vel.y;
          this.pos.y = ceil - 3.5;
          this.vel.y = -impact * d.bounce;
          if (impact > d.impactSpeed * 0.5) this._onHit({ nx: 0, nz: 0, ny: -1, part: 'rotor', speed: impact }, null, ctx);
        }
      }

      // --- 地面・着地 ---
      const S = this._support(ctx, Math.max(yNow, this.pos.y));
      this.onWater = S.y === null && S.water !== null;
      const gy = S.y !== null ? S.y : (S.water !== null ? S.water - 0.35 : -50);
      this.groundY = gy;
      if (!this.grounded) {
        if (gy > yNow + 0.02 && this.speed > 2 && S.y !== null) {
          // 横に動いて段（屋上の縁など、スキッドの高さの帯の中）に乗り上げた: 着地にせず持ち上げる（速ければ擦ったダメージ）
          this.pos.y = gy + 0.02;
          if (this.vel.y < 0) this.vel.y = 0;
          if (this.speed > d.landingMaxSpeed) this._onHit({ nx: 0, nz: 0, ny: 1, part: 'cabin', speed: (this.speed - d.landingMaxSpeed) * 0.5 + d.impactSpeed }, null, ctx);
        } else if (this.pos.y <= gy && this.vel.y <= 0.01) {
          if (pilot && S.y !== null && S.ratio > d.landingSlope) {
            // 傾きすぎ・スキッドが縁にかかっている: 降りない（一番高い所の上で浮いたまま。HUD が「ここには降りられません」）
            this.pos.y = gy;
            if (this.vel.y < 0) this.vel.y = 0;
            this.cantLand = 1;
          } else this._touchdown(S, gy, ctx);
        }
      } else {
        if (gy < this.pos.y - 0.08) { this.grounded = false; this.airborne = true; } // 下が無くなった（縁から出た）
        else this.pos.y = gy;
      }
      if (this.grounded) this.vel.y = 0;
      this.airborne = !this.grounded;
      if (this.cantLand > 0) this.cantLand = Math.max(0, this.cantLand - dt);
      this.agl = Math.max(0, this.pos.y - gy);

      // 水の上に浮いている → floatTime 秒で沈む（C1 の水没）
      if (this.grounded && this.onWater) {
        if (this.floatT < 0) this.floatT = 0;
        this.floatT += dt;
        this.bob = Math.sin(this.time * 1.7) * 0.06;
        if (this.floatT >= d.floatTime) { this.speed = 0; this._startSink(ctx, S.water); this._apply(); return; }
      } else this.floatT = -1;

      // --- 見た目の傾き（加速度の向きへ。前進の速さで機首下げ）---
      const ax = (this.vel.x - this._lastVx) / Math.max(1e-3, dt), az = (this.vel.z - this._lastVz) / Math.max(1e-3, dt);
      this._lastVx = this.vel.x; this._lastVz = this.vel.z;
      if (isFinite(ax) && isFinite(az)) {
        const kk = Math.min(1, dt * 6);
        this._acc.x += (ax - this._acc.x) * kk; this._acc.z += (az - this._acc.z) * kk;
      }
      let pT = 0, rT = 0;
      if (!this.grounded) {
        const aF = this._acc.x * sy + this._acc.z * cy, aL = this._acc.x * cy - this._acc.z * sy;
        const vF = this.vel.x * sy + this.vel.z * cy;
        pT = Math.atan2(aF, 9.8) * d.tiltGain + (vF / d.maxSpeed) * d.cruisePitch * D2R;
        rT = Math.atan2(-aL, 9.8) * d.tiltGain;
        pT = clamp(pT, -d.pitchMax * D2R, d.pitchMax * D2R);
        rT = clamp(rT, -d.rollMax * D2R, d.rollMax * D2R);
      } else if (S.slope) { pT = S.pitch || 0; rT = S.roll || 0; }
      const tk = Math.min(1, dt * (this.grounded ? 8 : d.tiltRate));
      this.pitch += (pT - this.pitch) * tk;
      this.roll += (rT - this.roll) * tk;
      // ホバリングの小さな上下（見た目だけ）
      if (!this.onWater) {
        const bobT = this.grounded ? 0 : d.hoverBob * (1 - this.speedRatio * 0.7) * Math.sin(this.time * 2.2);
        this.bob += (bobT - this.bob) * Math.min(1, dt * 4);
      }

      // 負荷（音: 上昇・速さで回転が上がって聞こえる）
      const loadT = clamp((this.vel.y > 0 ? this.vel.y / d.climbRate : this.vel.y / d.descendRate * 0.6) + this.speedRatio * 0.5, -1, 1);
      this.load += (loadT - this.load) * Math.min(1, dt * 2);

      this._wash(dt, gy, S);
      this._apply();
      this._engineAudio(dt);
    }

    // 1 フレームの移動を SUB m 以下に刻み、毎回機体の円を箱から押し出す。一番強くぶつかったもの（法線・部位）を返す
    _moveCollide(dx, dy, dz, ctx, wreck) {
      const len = Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dy));
      const n = Math.max(1, Math.ceil(len / SUB));
      const nav = ctx && ctx.nav;
      // 当たりそうな箱を 1 回だけ集める（動く範囲 + ローターの半径）
      const R = HUB.r + 1;
      const x0 = Math.min(this.pos.x, this.pos.x + dx) - R - 6, x1 = Math.max(this.pos.x, this.pos.x + dx) + R + 6;
      const z0 = Math.min(this.pos.z, this.pos.z + dz) - R - 6, z1 = Math.max(this.pos.z, this.pos.z + dz) + R + 6;
      const cands = this._cands;
      cands.length = 0;
      if (nav && typeof nav.itemsIn === 'function') nav.itemsIn(x0, z0, x1, z1, cands);
      if (this.collider) this.collider.query(x0, z0, x1, z1, cands);
      const others = (ctx && ctx.vehicles) || [];
      let best = null;
      const mx = dx / n, my = dy / n, mz = dz / n;
      for (let i = 0; i < n; i++) {
        this.pos.x += mx; this.pos.y += my; this.pos.z += mz;
        for (let it = 0; it < 3; it++) {
          const h = this._worstPush(cands, others, mx, mz, wreck);
          if (!h) break;
          this.pos.x += h.px; this.pos.z += h.pz;
          if (!best || h.depth > best.depth) best = h;
        }
      }
      // 地図の端（念のため）
      if (this.city) {
        this.pos.x = clamp(this.pos.x, this.city.minX + 6, this.city.maxX - 6);
        this.pos.z = clamp(this.pos.z, this.city.minZ + 6, this.city.maxZ - 6);
      }
      return best;
    }

    // 機体の円のうち一番深く入っている所の押し出し { px, pz, depth, part, nx, nz }
    _worstPush(cands, others, mx, mz, wreck) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw), su = this.def.stepUp, out = this._pc;
      let best = null;
      for (let k = 0; k < HULL.length; k++) {
        const h = HULL[k];
        if (wreck && h.part === 'rotor') continue; // 残骸のローターは折れている
        const wx = this.pos.x + h.x * c + h.z * s, wz = this.pos.z - h.x * s + h.z * c;
        const lo = this.pos.y + h.lo + (h.step ? su : 0), hi = this.pos.y + h.hi;
        pushCircle(cands, wx, wz, h.r, lo, hi, mx, mz, out);
        let qx = out[0], qz = out[1];
        if (h.part !== 'rotor') {
          for (const o of others) {
            if (o === this || o.disposed || o.sunk) continue;
            const oy = o.pos.y, oh = (o.def && o.def.height) || 2;
            if (oy > hi || oy + oh < lo) continue;
            if (Math.abs(o.pos.x - wx) > 14 || Math.abs(o.pos.z - wz) > 14) continue;
            const p = o._pushCircle(qx, qz, h.r);
            qx = p.x; qz = p.z;
          }
        }
        const ddx = qx - wx, ddz = qz - wz, dd = Math.sqrt(ddx * ddx + ddz * ddz);
        if (dd > 1e-5 && (!best || dd > best.depth)) best = { px: ddx, pz: ddz, depth: dd, part: h.part, nx: ddx / dd, nz: ddz / dd, lx: h.x, lz: h.z };
      }
      return best;
    }

    // ぶつかった: 壁に向かう速さを跳ね返し、超えた速さでダメージ。少し回る
    _onHit(h, vBefore, ctx) {
      const d = this.def;
      let speed;
      if (h.ny) speed = h.speed;
      else {
        const v = vBefore || this.vel;
        speed = -(v.x * h.nx + v.z * h.nz);
        if (speed > 0) {
          this.vel.x += h.nx * speed * (1 + d.bounce);
          this.vel.z += h.nz * speed * (1 + d.bounce);
        }
        // 前を押されたら回る（ヨー）
        const lat = h.nx * Math.cos(this.yaw) - h.nz * Math.sin(this.yaw);
        this.yawRate += clamp(lat * h.lz * d.collisionSpin * Math.max(0, speed) * 0.05, -1.5, 1.5);
      }
      if (!(speed > 0)) return;
      this.lastImpactSpeed = speed;
      if (speed > this.stats.maxImpact) this.stats.maxImpact = speed;
      if (speed < d.impactSpeed * 0.5 || this.time - this.lastImpact < 0.25) return;
      this.lastImpact = this.time;
      this.impacts++;
      const strength = clamp(speed / 25, 0.3, 1);
      const c = this.center(this._tmp2);
      const pt = this._tmp3.set(c.x - (h.nx || 0) * 2, c.y + (h.part === 'rotor' ? 2 : 0), c.z - (h.nz || 0) * 2);
      this._sound('vehicle_impact', strength, pt, { refDistance: 8, maxDistance: 180 });
      if (this.fx) {
        const n = new THREE.Vector3(h.nx || 0, 0.3, h.nz || 0).normalize();
        this.fx.impact(pt, n);
        if (typeof this.fx.smoke === 'function') this.fx.smoke(pt, 0.8);
      }
      if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, speed);
      const dmg = Math.max(0, speed - d.impactSpeed) * d.impactDamage * (h.part === 'rotor' ? d.rotorStrike : 1);
      if (dmg > 0) { this.stats.collisionDamage += dmg; this.damage(dmg, ctx); }
    }

    // 接地: 縦の速さが landingSpeed、横の速さが landingMaxSpeed を超えたらダメージ
    _touchdown(S, gy, ctx) {
      const d = this.def;
      const vy = -this.vel.y, h = Math.hypot(this.vel.x, this.vel.z);
      this.pos.y = gy;
      this.grounded = true; this.airborne = false;
      let dmg = 0;
      if (vy > d.landingSpeed) dmg += (vy - d.landingSpeed) * d.landingDamage;
      if (h > d.landingMaxSpeed) dmg += (h - d.landingMaxSpeed) * d.landingDamage * 0.5;
      this.landings.push({ t: +this.time.toFixed(2), vy: +vy.toFixed(2), h: +h.toFixed(2), slope: +(S.slope || 0).toFixed(3), water: S.y === null, dmg: +dmg.toFixed(1) });
      if (this.landings.length > 20) this.landings.shift();
      if (S.y === null && S.water !== null) {
        // 着水
        if (this.audio && this.audio.splash) this.audio.splash(this.center(this._tmp), true);
        if (this.fx && this.fx.splash) this.fx.splash(this._tmp.set(this.pos.x, S.water + 0.05, this.pos.z), 2.4);
        this.vel.x *= 0.4; this.vel.z *= 0.4;
      } else if (vy > 2.5 || dmg > 0) {
        this._sound('vehicle_impact', clamp(vy / 10, 0.25, 1), null, { refDistance: 8 });
        if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, vy);
      }
      this.vel.y = 0;
      if (h > d.landingMaxSpeed) { this.vel.x *= 0.5; this.vel.z *= 0.5; }
      if (dmg > 0) { this.stats.landingDamage += dmg; this.damage(dmg, ctx); }
    }

    // スキッドの下の立てる面: { y（一番高い面。無ければ null = 水だけ）, water, slope（4 隅の高さの差）, pitch, roll }
    _support(ctx, yFeet) {
      const nav = ctx && ctx.nav, city = this.city;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const H = this._sup || (this._sup = [0, 0, 0, 0, 0]);
      const F = this.foot || FOOT;
      let best = null, water = null, lo = Infinity, hi = -Infinity, nCorner = 0;
      for (let i = 0; i < F.length; i++) {
        const lx = F[i][0], lz = F[i][1];
        const x = this.pos.x + lx * c + lz * s, z = this.pos.z - lx * s + lz * c;
        let g;
        if (nav && city) {
          const cc = city.chunkOf(x, z);
          if (nav.hasChunk(cc.cx + '_' + cc.cz)) g = nav.groundInfo(x, z, yFeet + 0.05, i === 4 ? 0.6 : 0.05);
        } else if (nav && !city) g = nav.groundInfo ? nav.groundInfo(x, z, yFeet + 0.05, 0.05) : { y: 0, water: null };
        if (!g) g = this.collider ? this.collider.supportAt(x, z, yFeet + 0.05, this.def.stepUp) : { y: 0, water: null };
        H[i] = g.y;
        if (g.water !== null) water = g.water;
        if (g.y !== null) {
          if (best === null || g.y > best) best = g.y;
          if (i < 4) { nCorner++; if (g.y < lo) lo = g.y; if (g.y > hi) hi = g.y; }
        }
      }
      const r = this._supR || (this._supR = { y: 0, water: null, slope: 0, ratio: 0, pitch: 0, roll: 0 });
      r.y = best; r.water = water;
      r.slope = nCorner === 4 ? hi - lo : (best !== null ? 9 : 0);
      r.ratio = best !== null && nCorner < 4 ? 9 : 0;
      if (nCorner === 4) {
        const front = (H[2] + H[3]) / 2, rear = (H[0] + H[1]) / 2, left = (H[1] + H[3]) / 2, right = (H[0] + H[2]) / 2;
        const len = Math.abs(F[2][1] - F[0][1]) || 3, trk = Math.abs(F[1][0] - F[0][0]) || 2.2;
        r.ratio = Math.max(Math.abs(front - rear) / len, Math.abs(left - right) / trk, (hi - lo) / Math.hypot(len, trk));
        r.pitch = clamp(-Math.atan2(front - rear, len), -0.3, 0.3);
        r.roll = clamp(Math.atan2(left - right, trk), -0.3, 0.3);
      } else { r.pitch = 0; r.roll = 0; }
      return r;
    }

    // 地面が近いと吹き下ろしの砂ぼこり / 水しぶき
    _wash(dt, gy, S) {
      const d = this.def;
      if (!this.fx || typeof this.fx.rotorWash !== 'function' || this.rotor < 0.4) return;
      const agl = this.pos.y - gy;
      if (agl > d.washHeight) return;
      this._washT -= dt;
      if (this._washT > 0) return;
      this._washT = 0.08;
      const k = this.rotor * (1 - Math.max(0, agl) / d.washHeight);
      const p = this._tmp.set(this.pos.x, gy + 0.15, this.pos.z);
      this.fx.rotorWash(p, 2.5 + 4.5 * clamp(agl / d.washHeight, 0, 1), this.onWater || (S.y === null && S.water !== null), k);
    }

    // エンジン: 操縦士がいるか空中なら回す（始動の音）。地上で無人なら止める
    _engineStep(dt, pilot) {
      const d = this.def;
      const run = pilot || !this.grounded;
      if (run) {
        if (!this.engineOn) {
          this.engineOn = true;
          if (this.rotor < 0.5 && this.audio && typeof this.audio.play === 'function') {
            this._startH = this._sound('heli_start', 1, this._hub(this._tmp3), { refDistance: 7, maxDistance: 300, priority: 2 });
          }
        }
        this.spin = Math.min(1, this.spin + dt / d.spinUpTime);
      } else {
        this.spin = Math.max(0, this.spin - dt / d.spinDownTime);
        if (this.spin <= 0) this.engineOn = false;
        if (this._startH && this.spin < 0.6) { try { this._startH.stop(0.4); } catch (e) { /* ignore */ } this._startH = null; }
      }
      const u = this.spin;
      this.rotor = u * u * (3 - 2 * u);
      if (this._startH && this.rotor >= 0.999) { try { this._startH.stop(1.0); } catch (e) { /* ignore */ } this._startH = null; }
      const w = this.rotor * d.rotorRev * Math.PI * 2;
      this.rotorAngle = (this.rotorAngle + w * dt) % (Math.PI * 2);
      this.tailAngle = (this.tailAngle + w * d.tailRatio * dt) % (Math.PI * 2);
    }

    _hub(target) { return this.toWorld(this._hubL || (this._hubL = new THREE.Vector3(0, HUB.y, 0)), target); }

    _engineAudio(dt) {
      const a = this.audio;
      if (!a) return;
      if (this.rotor < 0.02 || this.wrecked || this.sinking) { this._stopEngine(); return; }
      if (!this.engine && typeof a.rotor === 'function') {
        try { this.engine = a.rotor(this._hub(this._tmp3)); } catch (e) { this.engine = null; }
      }
      if (!this.engine) return;
      const inside = !!(this.localInside && this.listenerPos);
      // 始動の音が鳴っている間はループを後から重ねる（heli_start の終わりがループと同じ音になる）
      const fade = this._startH ? clamp((this.rotor - 0.6) / 0.4, 0, 1) : 1;
      const wind = inside ? clamp(this.speed / this.def.maxSpeed, 0, 1) : 0;
      this.engine.set(this.rotor, this.load, wind, fade);
      this.engine.setPosition(inside ? this.listenerPos : this._hub(this._tmp3));
    }

    _stopEngine() {
      if (this.engine) { try { this.engine.stop(); } catch (e) { /* ignore */ } }
      this.engine = null;
      this.rpm = 0;
    }

    // ---------- 描く ----------

    _apply() {
      if (!this.root) return;
      this.root.position.set(this.pos.x, this.pos.y + PIVOT + (this.bob || 0), this.pos.z);
      this.root.rotation.set(this.pitch || 0, this.yaw, this.roll || 0, 'YXZ');
      // ローター（回転数で回る。速くなるとブレードが消えてぼかしの円盤）
      const rev = (this.rotor || 0) * this.def.rotorRev;
      const f = this.wrecked ? 0 : clamp((rev - 2.5) / 1.6, 0, 1);
      if (this.rotorMain) {
        this.rotorMain.rotation.y = this.wrecked ? 0.4 : this.rotorAngle;
        this.rotorMain.visible = f < 0.995;
        for (const m of this.bladeMats || []) {
          const tr = f > 0.005;
          if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
          m.opacity = 1 - f;
        }
      }
      if (this.rotorTail) this.rotorTail.rotation.x = this.tailAngle;
      if (this.rotorBlur) {
        this.rotorBlur.visible = f > 0.005;
        this.rotorBlur.rotation.y = this.rotorAngle * 0.03;
        for (let i = 0; i < (this.blurMats || []).length; i++) this.blurMats[i].opacity = this.blurBase[i] * f;
      }
      // 航法灯（エンジンが掛かっているとき）。衝突防止灯は 1.2 秒に 1 回光る
      if (this._lights) {
        const on = this.engineOn && !this.wrecked && !this.sinking;
        const flash = (this.time % 1.2) < 0.12;
        for (let i = 0; i < this._lights.length; i++) this._lights[i].visible = on && (i < 2 || flash);
      }
    }

    // ---------- オンライン（フェーズ D）----------
    // 他の人が操縦している・サーバーが動かしている（無人で降りていく）ヘリ: 物理は回さず、行の位置・向き・傾き・回転数に置く。
    // ローターは回転数で回り、航法灯・音（ローターの位置の 3D。乗っていれば耳元）・吹き下ろしも出る
    netPose(x, z, yaw, speed, steer, dt, y, pitch, roll, rpm) {
      this.time += dt;
      if (this.disposed || this.wrecked) return;
      const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
      this.pos.x = num(x, this.pos.x); this.pos.z = num(z, this.pos.z);
      if (typeof y === 'number' && isFinite(y)) this.pos.y = y;
      this.yaw = num(yaw, this.yaw);
      this.pitch = num(pitch, this.pitch); this.roll = num(roll, this.roll);
      if (dt > 0) {
        const k = Math.min(1, dt * 8);
        this.vel.x += ((this.pos.x - px) / dt - this.vel.x) * k;
        this.vel.y += ((this.pos.y - py) / dt - this.vel.y) * k;
        this.vel.z += ((this.pos.z - pz) / dt - this.vel.z) * k;
      }
      this.speed = Math.hypot(this.vel.x, this.vel.z);
      this._netRotor(dt, typeof rpm === 'number' && isFinite(rpm) ? clamp(rpm, 0, 1) : this.rotor);
      this._netGround(dt);
      this.bob = 0;
      this._apply();
      this._engineAudio(dt);
    }
    // 行が来ない（止まっている）ヘリ: その場で、無人ならローターはゆっくり止まる
    netIdle(dt) {
      this.time += dt;
      if (this.disposed) return;
      this.vel.set(0, 0, 0); this.speed = 0;
      const r = this.driver ? this.rotor : Math.max(0, this.rotor - dt / Math.max(0.5, this.def.spinDownTime || 9));
      this._netRotor(dt, r);
      this._netGround(dt);
      this._apply();
      this._engineAudio(dt);
    }
    _netRotor(dt, rpm) {
      this.rotor = rpm;
      this.spin = rpm;
      this.engineOn = rpm > 0.02;
      const w = this.rotor * this.def.rotorRev * Math.PI * 2;
      this.rotorAngle = (this.rotorAngle + w * dt) % (Math.PI * 2);
      this.tailAngle = (this.tailAngle + w * this.def.tailRatio * dt) % (Math.PI * 2);
    }
    // 地面からの高さ（降りるボタンの「飛び降り」・吹き下ろし）。4 回 / 秒
    _netGround(dt) {
      this._ngT = (this._ngT || 0) - dt;
      if (this._ngT <= 0 || this._ngY == null) {
        this._ngT = 0.25;
        const s = this.collider ? this.collider.supportAt(this.pos.x, this.pos.z, this.pos.y + 0.3, this.def.stepUp) : { y: 0, water: null };
        this._ngY = s.y !== null && s.y !== undefined ? s.y : (s.water !== null && s.water !== undefined ? s.water : 0);
        this._ngW = s.y === null && s.water !== null && s.water !== undefined;
      }
      this.groundY = this._ngY;
      this.agl = Math.max(0, this.pos.y - this._ngY);
      this.grounded = this.agl < 0.2;
      this.airborne = !this.grounded;
      if (this.fx && this.rotor > 0.4 && this.agl < this.def.washHeight) this._wash(dt, this._ngY, { y: this._ngW ? null : this._ngY, water: this._ngW ? this._ngY : null });
    }

    // 同期する状態（操縦士が送る想定）。座席は occupants の id（remote の { id } か自分は -1）
    netState() {
      const r = (v) => Math.round(v * 100) / 100;
      return {
        p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], yaw: r(this.yaw), pitch: r(this.pitch), roll: r(this.roll),
        v: [r(this.vel.x), r(this.vel.y), r(this.vel.z)], rpm: r(this.rotor), col: r(this.ctl.climb), hp: Math.round(this.health),
        seats: this.occupants.slice(0, this.seatCount).map((o) => (o ? (o.remote ? o.id : -1) : null))
      };
    }

    dispose() {
      super.dispose();
      for (const m of this._ownMats || []) m.dispose();
      this._ownMats = [];
      if (this._startH) { try { this._startH.stop(0.1); } catch (e) { /* ignore */ } this._startH = null; }
    }
  }

  Helicopter.DEFAULTS = DEFAULTS;
  Helicopter.HULL = HULL;
  Helicopter.PIVOT = PIVOT;
  Helicopter.pushCircle = pushCircle;
  MR.Helicopter = Helicopter;
})();
