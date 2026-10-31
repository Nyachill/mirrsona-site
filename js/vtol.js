// MIRRSONA VTOL（MR.Vtol。MR.Vehicle を継承し、game.js からは乗り物として扱える: kind === 'vtol'）と、コードの機体 MR.VtolModel。
//   dev-notes/plans/mirrsona-vtol.md の V1（飛ぶ）。ソロの街：フリーだけ（バトルロイヤルは royale.vtol、オンラインは無し）。
//
// ■ 1 つの機体・2 つの飛び方を、ナセルの角度 θ（0° 巡航 … 90° ホバー）で混ぜる（w = sin θ）。数値は game.json の vehicles.types.vtol（無いキーは DEFAULTS）。
//   θ は速さで決まる（ボタンではない）: 前への速さ convFrom m/s 以下で 90°、convTo m/s 以上で 0°、間は直線。podRate °/s まで。
//   stallSpeed より遅いのに θ が minHoverTilt より小さい（失速して地面へ）ときはナセルを podRate × 2 で戻す。
//   状態は点の質量: 足元の原点 pos・速度 vel・向き yaw（見た目の pitch / roll は加速度と経路角から）。1/60 秒以下に刻む（_step）。
//   ・ホバー（ヘリと同じ考え）: 水平の目標の速度へ hoverAccel / hoverBrake m/s² まで。向きは目標の向き（カメラ）を yawFollow で追う。
//   ・巡航（戦闘機のエネルギーの模型の簡単な形）: 前の推力 thrustCruise × G × cos θ − 抗力 cd0 × V²（cd0 = thrustCruise × G / maxSpeed² = 水平で maxSpeed）、
//     翼の揚力 G × (V / stallSpeed)² を gLimit（と maneuver.maxG）G まで（stallBand でなめらかに抜ける）、旋回はその残りの横の力（バンク）。
//   ・上下: 翼の揚力 + ナセルの推力 thrustHover × G × sin θ × 回転数 で、目標の上昇率へ vAccel / vBrake。足りなければ落ちる。
//   ・水平の加速は w でホバーの制御と巡航の制御を混ぜる。向きはホバーは目標の向き、巡航は速度の向き（協調旋回）。
// ■ 操作（setVtolControls。game.js が毎フレーム）: scheme 'easy'（タッチの既定）/ 'aim'（PC の既定。巡航は見た方へ）。
//   ホバー: 左スティック = 前後左右へ動く（maxSpeedHover / maxStrafeHover）、離すとその場に止まる（posHold）、上昇 / 下降 = climb（離すと高さを保つ）、
//     向きはカメラ。スティックを前へ倒したまま maxSpeedHover × transSpeedK を transHold 秒 → 巡航へ（spdHold = cruiseSpeed）。
//   巡航: 左スティックの横 = 今の向きから turnLead° 先へ曲がる・縦 = 上り climbAngle° / 下り diveAngle°、離すと向きと高さを保つ（altLead 秒の先読み）。
//     加速 / 減速（上昇 / 下降のボタンが巡航では加速 / 減速）= spdHold を spdRate m/s² で上下。spdHold が convFrom より下 → ホバーへ（ナセルが速さで戻る）。
//   地面・建物（easy の巡航）: 速度の向きの前 avoid.lookTime 秒の HeliCollider の一番高い箱 + avoid.clear m より下へは目標を置かない。
// ■ 自動着陸（startAutoland。「着陸」ボタン / L）: 一番近い降りられる所（pads = game.json の vtol.pads（大きさ w × d が span + 余白 = padMinSize 以上）、
//   道路 = 戦闘機の autoland.roads の上の、機体の箱の広さに何も無い所）。近いヘリポートが狭すぎる（2r < padMinSize）ときは
//   「狭すぎます」とイベント（game.js がトースト）。巡航で approachAgl m 上を近づき → convDist m で減速（ナセルが上がる）→ 真上で止まる →
//   まっすぐ降りる（descendRate、slowAgl m から slowRate）→ 脚 → 接地。空母は V1 では目標にしない（駐機の場所の取り決めが要る）。
// ■ 当たり判定: 機体の球（vtol.json の hull、無ければ def.hull）を前の位置から今の位置へ掃引（HeliCollider + nav の箱、半径で広げた箱とレイ。戦闘機の _sweep と同じ形）。
//   接地は 3 つの脚（contacts、脚を上げていれば胴体）の下の面（nav.groundInfo / HeliCollider.supportAt）。傾き landingSlope・縁で降りない（cantLand）、
//   沈む速さ landingSpeed / 横 landingMaxSpeed を超えたらダメージ、crashSink / crashSpeed を超えたら墜落。水も墜落。
// ■ 墜落: HP 0 / 墜落 → Vehicle._explode → _explodeFx(c, ctx)（E3 の MR.Burn / MR.Crashes。kind 'vtol' = fire.*.vtol）、外れる部品 DEBRIS_NODES、
//   空中なら残骸が落ちて落ちた所で _impactFx(c, ctx, vy)、respawn 秒で spawnPos（家）に戻る。
// ■ 見た目: assets/<tier>/models/vtol.glb（ルート Vtol。近く（vtol.loadDist m）に来たときだけ game.js が機体を作る = そのとき読む）か MR.VtolModel.build()（同じノード名）。
//   pod_l / pod_r（X 軸の回転。0 = 巡航、hoverDeg（−90）= ホバー）・gear_* / gdoor_*（脚の出し入れ）・ramp（rampDeg。V2 が使う）・reactor / holo_globe（回る）。
//   動く部品が止まった姿勢（ナセル 0° / 90°・脚が上 / 下）では材質ごとにまとめた形（GLB と姿勢ごとに共有）で描く。setCockpit(true) で一人称の重ね描き（レイヤー 1）。
// ■ 音: audio.jet()（エンジンのループを回転数で。ホバーは高い回転数）。新しい音は無い。
// ■ 物語の入口: MR.Vtol.home（街の物語の機体。game.json の spawns[].home の行 = 空母の 'v_carrier'。その機体がまだ出ていなければ最初に出た機体）。
//   homeId は v.cityId（置き場所の id。物語の 七号機 は 'no7'）
// ■ 武装（V3。dev-notes/plans/vtol-v3-impl.md。数値は vehicles.types.vtol の gun / missile / bombs / arm / rearm）:
//   armPos（0 しまっている … 1 出ている）が armWant へ 1/arm.armTime の速さで動く。arm() で出す（撃つ・ミサイル・爆弾の前に game.js が呼ぶ）、
//   最後の arm() から arm.armIdle 秒（地上では arm.groundIdle 秒）でしまう。armed = 出しきった、bayOpen = 兵器の扉が開ききった（= bombReady()）。
//   出ている間は抗力 × arm.drag。翼の銃 gun_l / gun_r はしまうと内側へ arm.gunDeg° 回って翼の前縁に沿い、出ると gunAim { yaw, pitch }（機体の座標の rad。
//   game.js の _vtolGunPoint が書く）へ向く。扉 bay_door_* は arm.doorDeg°、腕 bay_link_* は arm.linkDeg° 下へ、ラック bay_rack_* は arm.rackDrop m 下がる。
//   吊り物: missile.loadout（AIM-9X × 4。置き場所は arm.slots = [親のノード, x, y, z]）と bombs.loadout（GBU-16 × 2 = gbu_l / gbu_r）。
//   見えるのは出ている間だけ（しまっている間は描かない = まとめた形の姿勢のまま）。形は setStoreGeo(MR.Missiles._baked)（無ければ筒の代わり）。
//   takeMissile(type) は jet.js と同じ形。扉が閉じていれば爆弾は null。ammo = 機関砲の残り（gun.ammo）。
//   補給: rearm.pads（p_skyhigh / p_carrier）の上に止まって rearm.rearmTime 秒 → 満タン + events { t: 'rearm' }。空中はミサイルが missile.reloadTime 秒に 1 発。respawn で満タン。
//   まとめた形（止めてある姿勢）は armPos === 0 のときだけ。
// ■ 物語の API（work/story が 七号機 = id 'no7' に使う。変えない約束）:
//   v.hoverAt(p, yaw, opts?)     … p（{ x, y, z }。y は脚の高さ = pos.y）の真上で止まって yaw（rad。前 = (sin, cos)）を向く。着いたら保つ。
//                                  opts.holdYaw（= approachYaw）: 最後の autopilot.holdYawDist m は機首を yaw に保ったまま寄る（横・後ろ向きにも動く。
//                                  ドッキング・傾斜板を甲板へ向けて下がる。無ければ機首は進む向きで、3 m 手前で yaw へ回る = Sky High の切り欠きの横で 160° 回って翼が柱に入った）
//   v.followPath(points, speed)  … points（[{ x, y, z }, …]）を順に speed m/s で（convFrom より速ければ巡航）。最後の点で hoverAt と同じく止まる。
//                                  途中の点は水平に wpRadius m（速ければ vh × wpTime）に入ったら次へ。ただし水平に wpRadius m 以内（ほぼ真上・真下）の点は
//                                  高さも ±autopilot.wpAlt m に入ってから次へ（その間はその点の上で止まって上下する = まっすぐ上がってから横へ）。
//   v.orbit(c, r, h, speed?)     … 中心 c（{ x, z }）・半径 r m・高さ h m（pos.y）を決まった向き（+X の点では +Z へ）に speed m/s（無ければ autopilot.orbitSpeed）で回る。
//   v.clearAutopilot()           … やめる（操縦士がいればその入力に戻る。無人で空中なら unmannedHold 秒止まってから降りる）。
//   v.script                     … 今の自動操縦 { mode: 'hover' | 'path' | 'orbit', done, i（path の次の点）}か null。
//     自動操縦は操縦士の入力と同じ目標（_control の出力 = 水平の目標の速度・上下・向き）を作るだけ（物理は同じ）。操縦士がいてもいなくても動き、
//     1/60 秒以下の刻みごとに決めるので 20 / 30 fps でも同じ。自動着陸（autoland）が先。数値は vehicles.types.vtol.autopilot。
//   v.fireGunsAt(p, sec)         … 翼の銃で p（世界の点）を sec 秒撃つ（操縦士がいなくてもよい。arm() して出しきってから sec 秒。gun の数値・弾の数・首振りの範囲）。
//   v.fireMissileAt(target)      … 吊り物のミサイル（無ければ爆弾）を target（乗り物・敵・{ x, y, z } の点）へ。扉が開くまで待って撃つ。受けたか。
//     この 2 つはゲームが要るので、ゲーム（game.js）が毎フレーム v.gunTask / v.missileTask を見て撃つ（g.vtolFireGuns(v, p, sec) / g.vtolFireMissile(v, target) も同じ）。
//   v.storyPinned = true         … チャンクの出し入れ・遠くで消す（unloadDist）・甲板 / 置き場所の片付けで消さない・動かさない。
//   v.canLiftOff()               … 地上・始動済み（spool ≥ liftSpool）・頭の上 autopilot.liftClear m に何も無い・傾斜板が閉じきった・機内を歩いている人がいない（V2）・
//                                  車の積み込み・降ろす途中でない（V2c）。
//     傾斜板が開いていても hoverAt / followPath / orbit・上昇の入力は先に閉じる（ramp.time 秒）→ 閉じてから浮く。
//   MR.Vtol.home / v.cityId（homeId）… 上の「物語の入口」。
//   v.openRamp(open)             … 傾斜板を開ける（true）/ 閉じる（false）。開けられない（空中・動いている・傾いて降りた・動く船の上・水・地面が合わない）
//                                  ときは false（理由は v.rampRefuse = 'air' | 'moving' | 'tilt' | 'ship' | 'water' | 'ground' | 'wrecked'。v.rampRefusal(ctx) で先に見られる）。
//   v.rampState                  … 'closed' | 'opening' | 'open' | 'closing'（rampPos 0..1 を ramp.time 秒で。尾の扉 → 板 → トウの順）。
//                                  止めてある無人の機体は開いている（ramp.autoOpenParked）。閉じるときに傾斜板・尾の扉の下の人は closeWait 秒待ってから外へ。
//   v.rampTip(out?)              … 傾斜板の先（トウの先。開いていれば地面の上 = 機体の座標 (0, 0, −10.09)）の世界の位置（THREE.Vector3）。
//   v.onPlatform(player)         … その人がこの機体の機内・傾斜板の上を歩いているか（cityboats の動く足場 'v'。player.platform === v.platformId）。
//   v.onBoarded = fn(player)     … 歩いて機内（床の縁 z −6.6 より前）に入ったとき（席から立ったときは出さない）。v.events にも { t: 'boarded' }、数は v.boarded。
//   v.standPoint(i, out?)        … 席 i（0 操縦席・1 副操縦席）の前に立つ所（世界）。v.walkable() = 機内を歩ける（着陸して水平・止まっている）。
// ■ 機内を歩く（V2。dev-notes/plans/vtol-ramp-cargo-spec.md §1）: 外の「乗る」は無い（vehicles.types.vtol.board.exterior false）。後ろの傾斜板を歩いて上がり、
//   操縦席・副操縦席の前（board.seatReach m・席の方を board.facing° 以内）で「操縦する」/「副操縦席」。降りると席の前に立つ（操縦席なら傾斜板が開く）。
//   機内は動く足場（platforms.js の Platforms に cityboats.js が 'v' の provider = Vtol.cabinProvider を足す。vtol.json の cabin: 床 walk・壁 walls・家具・
//   外の殻 hull・傾斜板 rampProxy（30.4° の線））。歩けるのは着陸して水平（levelled: 接地の傾き ≤ ramp.levelTiltMax）・止まっている間だけ（空中の機内は V2b）。
//   飛ぶときは傾斜板を先に閉じる（_liftOk）。地上の操縦席の「着陸」ボタン（L）は傾斜板の開け閉め（「ランプ開 / ランプ閉」）。
// ■ 車を積む（V2c。www/js/vtolcargo.js の MR.VtolCargo。決まりはそちらの冒頭。形は vtol.json の cabin.cargo、数は vehicles.types.vtol.cargo）:
//   ジープ（Vtol は大きさで決める: MR.VtolCargo.fits）を傾斜板の後ろの枠へゆっくり運転すると、決まった道で貨物室へ上がって止まる。運転手は左舷の通路に立つ。
//   積んだ車は物理を回さず機体について行く（car.carrier = { host }・car.cargoState）。降ろすのは着陸して水平な所で積んだ車に乗ってスティックを外へ。
//   積み込み・降ろす途中は傾斜板を閉じない・浮かない（canLiftOff）。機内の足場は積んでいる間 ':car' の型（置き場所の箱が歩く人を止める）。
// ■ 車の API（物語。変えない約束）:
//   v.cargo                      … 積んでいる車（積み込み・降ろす途中も）か null。v.cargoState … 'loading' | 'stowed' | 'unloading' | null。v.cargoBusy … 途中か
//   v.loadVehicle(car, opts?)    … car を積む。opts.drive: 今の場所から積み込みの道を走る（枠・向き・速さ・大きさ・空きの決まりそのまま。運転手が要る）、
//                                  無ければその場で積んだ状態にする（載る車なら。opts.reverse で後ろ向き）。受けたか
//   v.unloadVehicle()            … 積んだ車を傾斜板から降ろし始める（運転手は要らない。着陸して水平・傾斜板を開けられる・足元と通り道が平らで空いている）。
//                                  始めたか（だめなら v.cargoMsg.text に理由）。降ろし終わると events { t: 'cargo_release', why: 'unloaded' }
//   v.attachCargo(car, dir) / v.releaseCargo(car, why) … 続きから・チャンクの出し入れ用（dir +1 前から / −1 後ろから）
//   機内の見た目は vtol_interior.glb（カメラが ramp.interiorDist m の中に来たら読む。操縦席の重ね描きにも入れる = 計器盤が見える）。
if (typeof window !== 'undefined' && window.THREE && window.MR && window.MR.Vehicle) (function () {
  const MR = window.MR;
  const G = 9.81, D2R = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const smooth = (a, b, x) => { const t = clamp((x - a) / ((b - a) || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
  const srgb = (hex) => (MR.srgb ? MR.srgb(hex) : new THREE.Color(hex));

  // 当たり判定の既定（tools/gen/vtol_build.py が書く assets/levels/vtol.json と同じ値。vtol.json があればそちら）
  const HULL = [
    { x: 0, y: 3.0, z: -10.6, r: 1.63 }, { x: 0, y: 3.2, z: -3.87, r: 2.35 }, { x: 0, y: 3.31, z: 2.87, r: 2.4 }, { x: 0, y: 2.87, z: 9.6, r: 1.6 },
    { x: 5, y: 2.86, z: 1.53, r: 1.52 }, { x: 8.16, y: 2.67, z: -0.19, r: 1.22 }, { x: 11.32, y: 2.65, z: -2.28, r: 0.86 }, { x: 14.48, y: 2.65, z: -2.93, r: 0.73 },
    { x: 17.64, y: 2.66, z: -3.66, r: 0.6 }, { x: 20.8, y: 2.65, z: -3.67, r: 0.6 },
    { x: -5, y: 2.86, z: 1.53, r: 1.52 }, { x: -8.16, y: 2.67, z: -0.19, r: 1.22 }, { x: -11.32, y: 2.65, z: -2.28, r: 0.86 }, { x: -14.48, y: 2.65, z: -2.79, r: 0.73 },
    { x: -17.64, y: 2.66, z: -3.66, r: 0.6 }, { x: -20.8, y: 2.65, z: -3.67, r: 0.6 }
  ];
  const BOXES = [
    { x0: -3.6, y0: 1.02, z0: -13.2, x1: 3.6, y1: 5.52, z1: 11.6, tag: 'fuselage' },
    { x0: 3.6, y0: 1.5, z0: -12.33, x1: 22, y1: 4.29, z1: 9.28, tag: 'wing_l' },
    { x0: -22, y0: 1.5, z0: -12.33, x1: -3.6, y1: 4.29, z1: 9.28, tag: 'wing_r' },
    { x0: 6.24, y0: 1.71, z0: -4.03, x1: 10.16, y1: 3.62, z1: 0.03, tag: 'pod_l' },
    { x0: -10.16, y0: 1.71, z0: -4.03, x1: -6.24, y1: 3.62, z1: 0.03, tag: 'pod_r' },
    { x0: -1.37, y0: 1.27, z0: -9, x1: 1.37, y1: 2.05, z1: -6.6, tag: 'ramp' }, // V2-0: 閉じた板の上面 = 床（vtol.json の boxes と同じ）
    { x0: -1.45, y0: 1.51, z0: -13.2, x1: 1.45, y1: 3.87, z1: -9, tag: 'cargo_door' }
  ];
  const CONTACTS = [{ gear: 'n', x: 0, y: 0, z: 4.4 }, { gear: 'l', x: 4.1, y: 0, z: -4 }, { gear: 'r', x: -4.1, y: 0, z: -4 }, { gear: 'belly', x: 0, y: 1.02, z: 0.919 }];
  const PIVOT_Y = 2.8; // 傾きの中心（重心のあたり）の高さ

  const DEFAULTS = {
    name: 'MIRRSONA', kind: 'vtol', model: 'models/vtol.glb', fallback: 'vtol', scale: 1,
    length: 24.8, width: 44, height: 5.52, wheelRadius: 0.55, health: 2400, armor: 0.5, driverExposure: 0,
    maxSpeed: 190, maxSpeedHover: 25, maxStrafeHover: 14, maxBackHover: 10, hoverAccel: 5, hoverBrake: 7, posHoldK: 0.6, posHoldMax: 4,
    climbRate: 8, descendRate: 6, vAccel: 5, vBrake: 8, altHoldK: 1.0,
    thrustHover: 1.45, thrustCruise: 0.55, gLimit: 3.5, maneuver: { maxG: 4 }, stallSpeed: 55, stallBand: 8,
    convFrom: 25, convTo: 60, podRate: 35, minHoverTilt: 10, hoverDeg: -90,
    cruiseSpeed: 110, spdRate: 18, cruiseVAccel: 12, transHold: 0.6, transSpeedK: 0.85, turnLead: 40, turnK: 1.2, climbAngle: 18, diveAngle: 14, altLead: 1, speedK: 0.8, cruiseVyK: 0.5,
    yawFollow: 1.4, maxYawRate: 28, yawAccel: 50, latK: 1.5,
    spinUpTime: 4, spinDownTime: 8, liftSpool: 0.85,
    groundEffect: 10, touchdownSpeed: 1.0, landingSpeed: 3.5, landingMaxSpeed: 4, landingSlope: 0.08, landingDamage: 60, landingEdge: 1.5,
    crashSink: 9, crashSpeed: 16, impactSpeed: 3, impactDamage: 30, bounce: 0.25,
    gearAgl: 50, gearUpAgl: 80, gearSpeed: 70, gearTime: 3, gearRot: 95, rampDeg: -30.43,
    maxAltitude: 900, boundsMargin: 250,
    avoid: { lookTime: 6, clear: 45, step: 40, every: 0.25, radius: 26, hoverClearK: 0.5, climb: 10, vMin: 6 },
    tiltGain: 0.5, pitchMax: 14, rollMax: 35, tiltRate: 3,
    respawn: 60, explodeRadius: 22, explodeDamage: 300, wreckGravity: 14, wreckSmokeEvery: 0.5,
    chaseDistance: 44, chaseHeight: 10, chaseSpeedDist: 12, cameraRoll: 0.2,
    washHeight: 22, loadDist: 400, unloadDist: 650, padMinSize: 48,
    airKillAgl: 12, respawnClear: 30, unmannedHold: 3, unmannedDescend: 3, hoverGain: 1.5, cantLandGap: 0.02, cantLandTime: 1,
    wreck: { keepVel: 0.5, maxUp: 4, spin: 0.5, drag: 0.3, maxFall: 60 },
    camRecenter: { delay: 1.5, rate: 1.5, pitch: -0.12 }, chaseClamp: { min: 0.15, wallPad: 1.2, ease: 2.5 }, chasePivot: [0, 4.5, -1],
    // 守り（VX。ヘリと同じ: 空中の操縦席でフレア（ボタン / X / 自動）と RWR。AirCombat.updateHeli が使う）
    flares: { count: 30, burst: 2, cooldown: 1.5, reloadTime: 12, autoRange: 1500, autoTime: 3.5, rwrEvery: 1, ejectDrop: 12, ejectSide: 10 },
    rwr: { searchTone: 0.08, lockTone: 0.14, markerSec: 2.5, spikeHold: 1 },
    // 武装（V3）
    gun: { rate: 40, ammo: 800, damage: 26, range: 1400, convergence: 400, spread: 0.35, tracerEvery: 3, burst: 0.6, tracerSpeed: 1000, gunYaw: 30, gunPitchUp: 15, gunPitchDown: 60, muzzle: [12.4, 2.57, 4.5], hoverAimSpeed: 30 },
    missile: { loadout: [['aim9x_l0', 'aim9x'], ['aim9x_r0', 'aim9x'], ['aim9x_l1', 'aim9x'], ['aim9x_r1', 'aim9x']], reloadTime: 45, lockCone: 22, lockRange: 3000, lockMin: 150, lockTime: 0.8,
      lockKeep: 30, lockClear: 6, lockHide: 0.6, lockScan: 0.25, cooldown: 0.8 },
    bombs: { loadout: [['gbu_l', 'gbu16'], ['gbu_r', 'gbu16']], reloadTime: 0 },
    arm: { armTime: 1.2, armIdle: 12, groundIdle: 2, pending: 0.3, gunDeg: 90, doorDeg: 100, linkDeg: 35, rackDrop: 0.45, drag: 1.08, mergedCache: 2,
      slots: { aim9x_l0: ['bay_rack_l', 0.55, -0.3, 0], aim9x_l1: ['bay_rack_l', -0.55, -0.3, 0], aim9x_r0: ['bay_rack_r', -0.55, -0.3, 0], aim9x_r1: ['bay_rack_r', 0.55, -0.3, 0] } },
    rearm: { rearmTime: 4, maxSpeed: 0.5, pads: ['p_skyhigh', 'p_carrier'] },
    cams: { near: { distance: 44, height: 10, speedDist: 12 }, far: { distance: 90, height: 28, speedDist: 20 }, hullMargin: 0.6, raiseMax: 12, raiseStep: 0.25 },
    // 物語の自動操縦（hoverAt / followPath / orbit）
    autopilot: { posK: 0.6, brake: 2.5, arrive: 3, wpRadius: 25, wpTime: 1.2, wpAlt: 2, holdYawDist: 60, holdYawLead: 2.5, altK: 0.8, cruiseFrom: 40, orbitSpeed: 20, orbitK: 0.5, liftClear: 8 },
    autoland: { range: 6000, padRange: 1500, approachAgl: 80, approachSpeed: 110, convDist: 900, decel: 3, hoverAgl: 30, finalSpeed: 2.5,
      descendRate: 5, slowAgl: 12, slowRate: 1.5, capture: 2.5, cancelStick: 0.5, roadStep: 40, roadTries: 12, clearMargin: 3, clearHeight: 7, checkDist: 450, alignAngle: 6, holdTime: 1.0, holdSpeed: 1.5 },
    // 機内を歩く（V2。dev-notes/plans/vtol-ramp-cargo-spec.md §1）: 外の「乗る」は無い（board.exterior false）。後ろの傾斜板を歩いて上がり、操縦席の前で「操縦する」
    board: { exterior: false, seatReach: 1.0, facing: 70, hintDist: 14 },
    ramp: { time: 3.0, landedSpeed: 0.3, levelTiltMax: 2.5, autoOpenParked: true, autoOpenDist: 6, openOnStandUp: true, footTolWalk: 0.45, footTolHigh: 0.15,
      closeWait: 1.0, sweepPad: 0.3, pushOut: 1.2, interiorDist: 45, doorEnd: 0.4, plateFrom: 0.2, plateTo: 0.8, toeFrom: 0.6 },
    // 車を積む（V2c。vtolcargo.js。形は vtol.json の cabin.cargo、数はここ = game.json の vehicles.types.vtol.cargo）
    cargo: { enabled: true, captureEvery: 0.25, zoneAngle: 30, zoneSpeed: 8, allowReverse: true, alignPad: 0.3, accel: 3, decel: 3, groundSpeed: 4.5, rampSpeed: 3.0, holdMax: 2,
      unloadStick: 0.5, unloadHold: 0.3, exitSpeed: 3, footTol: 0.15, clearMargin: 0.05, maxCars: 1, autoExitDriver: true, blastHostDamage: 150, toastEvery: 4, hintDist: 14, enterDy: 2.6, barrierPad: 0.45 },
    hull: null, boxes: null, contacts: null,
    seats: [
      { node: 'seat_pilot', exitNode: 'exit_l', seat: [0, 3.7, 5.8], exit: [5, 0, 11.5] },
      { node: 'seat_copilot', exitNode: 'exit_r', seat: [-0.9, 3.6, 6.85], exit: [-5, 0, 11.5] }
    ],
    seat: [0, 3.7, 5.8], exit: [5, 0, 11.5],
    color: '#c9ced6'
  };

  // ---------- コードの機体（V0 の GLB と同じノード名）----------
  // ルート Vtol。+Z 機首・+Y 上・+X 左舷（port）、原点は脚を出したときの車輪の下（y 0）。全長 24.8・翼幅 44・高さ 5.52、箱 (−22, 0, −13.2)–(22, 5.52, 11.6)
  const NODES = ['body', 'canopy', 'pod_l', 'pod_r', 'nozzle_l0', 'nozzle_l1', 'nozzle_r0', 'nozzle_r1', 'cruise_noz_0', 'cruise_noz_1', 'cruise_noz_2', 'cruise_noz_3',
    'ramp', 'gear_n', 'gear_l', 'gear_r', 'wheel_n', 'wheel_l', 'wheel_r', 'gdoor_na', 'gdoor_nb', 'gdoor_la', 'gdoor_lb', 'gdoor_ra', 'gdoor_rb',
    'bay_door_l_in', 'bay_door_l_out', 'bay_door_r_in', 'bay_door_r_out', 'bay_rack_l', 'bay_rack_r', 'gbu_l', 'gbu_r',
    'gun_l', 'gun_r', 'muzzle_l', 'muzzle_r', 'seat_pilot', 'seat_copilot', 'seat_0', 'seat_1', 'seat_2', 'seat_3',
    'exit_ramp', 'exit_l', 'exit_r', 'floor', 'walk_cabin', 'walk_cargo', 'holo_globe', 'reactor'];
  // 材質は機体ごと（GLB に差し替えるときに Vehicle._disposeProcedural が形と一緒に捨てる）
  function mats() {
    const std = (hex, r, m, o) => new THREE.MeshStandardMaterial(Object.assign({ color: srgb(hex), roughness: r, metalness: m }, o || {}));
    const MATS = {
      hull: std('#c9ced6', 0.45, 0.35), dark: std('#3a4048', 0.6, 0.4), glass: std('#1c2a36', 0.1, 0.8, { transparent: true, opacity: 0.55 }),
      metal: std('#7d848c', 0.4, 0.8), trim: std('#1e2a33', 0.4, 0.3, { emissive: srgb('#38d0ff'), emissiveIntensity: 1.4 }),
      hot: std('#2a2018', 0.5, 0.6, { emissive: srgb('#ff8a3a'), emissiveIntensity: 0.9 }), gear: std('#2b2e33', 0.7, 0.3)
    };
    return MATS;
  }
  // 平らなくさびの翼（平面の台形を厚さ t で押し出す）。points = [[x, z] …]（左回り）
  function wingGeo(points, t, y) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], -points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], -points[i][1]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); // (x, y=−z) → (x, z)
    g.translate(0, y - t / 2, 0);
    return g;
  }
  function buildModel(def) {
    const M = mats();
    const root = new THREE.Group();
    root.name = 'Vtol';
    const body = new THREE.Group(); body.name = 'body'; root.add(body);
    const geos = new Map(); // 材質 → 動かない形（まとめて 1 つのメッシュ）
    const put = (mat, g) => { let a = geos.get(mat); if (!a) geos.set(mat, a = []); a.push(g); };
    const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
    // 胴体（下 1.02〜上 5.52、−13.2〜11.6）: 中の箱 + 機首のくさび + 背中。後ろ（z < −6.6）は貨物室の口を空ける（V2-0: ランプと後ろの扉）
    put(M.hull, box(6.4, 3.2, 13.5, 0, 2.7, 0.15));
    for (const s of [1, -1]) put(M.hull, box(1.75, 3.2, 3.5, s * 2.325, 2.7, -8.35)); // 貨物室の横の壁（|x| 1.45〜3.2）
    put(M.hull, box(2.9, 0.3, 3.5, 0, 4.15, -8.35)); // 貨物室の天井
    const nose = new THREE.CylinderGeometry(0.6, 3.1, 6.6, 4, 1); nose.rotateX(Math.PI / 2); nose.rotateZ(Math.PI / 4); nose.scale(1, 0.62, 1); nose.translate(0, 2.7, 8.3);
    put(M.hull, nose);
    put(M.hull, box(4.8, 1.0, 12, 0, 4.85, -1.5));
    put(M.dark, box(5.2, 0.5, 15.9, 0, 1.25, 1.35));
    for (const s of [1, -1]) { put(M.dark, box(1.15, 0.5, 5.1, s * 2.025, 1.25, -9.15)); put(M.hull, box(1.55, 2.4, 2.4, s * 2.225, 3.3, -12.0)); } // 尾部（横）
    // 翼（左舷 +X / 右舷 −X）
    for (const s of [1, -1]) {
      const p = [[3.4 * s, 8.8], [22 * s, -2.2], [22 * s, -5.2], [3.4 * s, -12.3]];
      if (s < 0) p.reverse();
      put(M.hull, wingGeo(p, 0.55, 2.7));
      put(M.trim, box(0.25, 0.3, 3.2, 21.9 * s, 2.7, -3.7)); // 翼端の灯
      // 尾翼（垂直）
      const fin = box(0.35, 2.4, 3.6, 2.4 * s, 4.4, -11.2); put(M.hull, fin);
    }
    put(M.trim, box(0.2, 0.15, 14, 3.25, 3.6, -0.5)); put(M.trim, box(0.2, 0.15, 14, -3.25, 3.6, -0.5));
    // 巡航のノズル（翼の後ろの縁）
    const nozPos = [[7.2073, 2.67, -10.7836], [9.2073, 2.67, -10.2577], [-7.2073, 2.67, -10.7836], [-9.2073, 2.67, -10.2577]];
    for (let i = 0; i < 4; i++) {
      const q = nozPos[i];
      const g = new THREE.CylinderGeometry(0.6, 0.5, 1.0, 10, 1, true); g.rotateX(Math.PI / 2); g.translate(q[0], q[1], q[2]); put(M.hot, g);
      const e = new THREE.Object3D(); e.name = 'cruise_noz_' + i; e.position.set(q[0], q[1], q[2]); root.add(e);
    }
    for (const [mat, list] of geos) {
      const utils = THREE.BufferGeometryUtils;
      const norm = list.map((g) => { const h = g.index ? g.toNonIndexed() : g; if (h !== g) g.dispose(); for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') h.deleteAttribute(k); h.clearGroups(); return h; });
      const merged = utils && typeof utils.mergeBufferGeometries === 'function' && norm.length > 1 ? utils.mergeBufferGeometries(norm, false) : null;
      if (merged) { for (const g of norm) g.dispose(); body.add(new THREE.Mesh(merged, mat)); }
      else for (const g of norm) body.add(new THREE.Mesh(g, mat));
    }
    // キャノピー（ガラス。一人称の重ね描きでは本体のパスだけ）
    const cg = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); cg.scale(2.4, 1.1, 3.4);
    const canopy = new THREE.Mesh(cg, M.glass); canopy.name = 'canopy'; canopy.position.set(0, 4.3, 6.4); canopy.userData.vtolGlass = true; root.add(canopy);
    // ナセル（ポッド）: 回転の中心は (±8.2, 2.65, −2.0)、X 軸、0 = 巡航（ノズルは −Z）
    for (const [side, s] of [['l', 1], ['r', -1]]) {
      const pod = new THREE.Group(); pod.name = 'pod_' + side; pod.position.set(8.2 * s, 2.65, -2.0); root.add(pod);
      const pg = new THREE.CylinderGeometry(0.95, 1.05, 4.2, 14); pg.rotateX(Math.PI / 2); pg.translate(0, 0, 0.2);
      pod.add(new THREE.Mesh(pg, M.metal));
      const ring = new THREE.TorusGeometry(1.0, 0.12, 6, 16); ring.translate(0, 0, 2.2); pod.add(new THREE.Mesh(ring, M.trim));
      for (let k = 0; k < 2; k++) {
        const dx = (k === 0 ? -0.88 : 0.88);
        const ng = new THREE.CylinderGeometry(0.47, 0.42, 0.7, 10, 1, true); ng.rotateX(Math.PI / 2); ng.translate(dx, 0.02, -1.68);
        pod.add(new THREE.Mesh(ng, M.hot));
        const e = new THREE.Object3D(); e.name = 'nozzle_' + side + k; e.position.set(dx, 0.02, -1.68); pod.add(e);
      }
    }
    // 後ろの傾斜板（ramp。V2-0: 蝶番は床の縁の上面 (0, 2.05, −6.6)、閉じると上面が床と同じ高さ、X 軸の周りに開く = vtol.json の cabin.ramp）・
    // 中から滑り出るトウ（ramp_toe。傾斜板の子、−Z へ cabin.toe.slide）・尾の下の扉（cargo_door。蝶番 cabin.cargoDoor.hinge、+ で上・後ろへ）
    const ramp = new THREE.Group(); ramp.name = 'ramp'; ramp.position.set(0, 2.05, -6.6); root.add(ramp);
    ramp.add(new THREE.Mesh(box(2.6, 0.06, 2.4, 0, -0.03, -1.2), M.dark)); // 甲板（上面 = 床）
    ramp.add(new THREE.Mesh(box(2.6, 0.54, 1.95, 0, -0.33, -1.425), M.dark)); // 下は蝶番から 0.45 m 後ろから（開く間に前へ出ない = 面取り）
    const toe = new THREE.Group(); toe.name = 'ramp_toe'; ramp.add(toe);
    toe.add(new THREE.Mesh(box(2.12, 0.06, 1.72, 0, -0.045, -1.51), M.dark));
    const door = new THREE.Group(); door.name = 'cargo_door'; door.position.set(0, 3.88, -10.35); root.add(door);
    door.add(new THREE.Mesh(box(2.9, 0.4, 1.35, 0, -2.58, 0.675), M.hull)); // 腹（z −10.35〜−9.0）
    door.add(new THREE.Mesh(box(2.9, 2.78, 2.85, 0, -1.39, -1.425), M.hull)); // 尾の先（z −13.2〜−10.35）
    // 脚（gear_* は付け根。車輪 wheel_* は子）と扉（gdoor_*）
    const legs = { n: [0, 4.4, 0.373], l: [4.1, -4, 0.548], r: [-4.1, -4, 0.548] };
    for (const k of Object.keys(legs)) {
      const [x, z, wr] = legs[k], top = 1.15;
      const gear = new THREE.Group(); gear.name = 'gear_' + k; gear.position.set(x, top, z); root.add(gear);
      const lg = new THREE.CylinderGeometry(0.13, 0.13, top - wr, 8); lg.translate(0, -(top - wr) / 2, 0); gear.add(new THREE.Mesh(lg, M.metal));
      const wheel = new THREE.Group(); wheel.name = 'wheel_' + k; wheel.position.set(0, wr - top, 0); gear.add(wheel);
      const wg = new THREE.CylinderGeometry(wr, wr, 0.32, 14); wg.rotateZ(Math.PI / 2); wheel.add(new THREE.Mesh(wg, M.gear));
      for (const [ab, sx] of [['a', 1], ['b', -1]]) {
        const d = new THREE.Group(); d.name = 'gdoor_' + k + ab; d.position.set(x + sx * 0.5, top - 0.1, z); root.add(d);
        d.add(new THREE.Mesh(box(0.06, 0.05, 1.6, 0, 0, 0), M.hull));
      }
    }
    // 兵器の扉・ラック（V3）・翼の銃（V3。gun_* は付け根、muzzle_* は銃口 (±12.4, 2.57, 3.7)）
    for (const [side, s] of [['l', 1], ['r', -1]]) {
      // 兵器の扉は翼の下（V0 の GLB と同じ所: 扉 x ±11.9 / ±13.5、ラック ±12.7、z −2.95）
      for (const io of ['in', 'out']) {
        const d = new THREE.Group(); d.name = 'bay_door_' + side + '_' + io; d.position.set(s * (io === 'in' ? 11.9 : 13.5), 2.15, -2.95); root.add(d);
        d.add(new THREE.Mesh(box(1.5, 0.05, 3.6, 0, 0, 0), M.hull));
      }
      const rack = new THREE.Group(); rack.name = 'bay_rack_' + side; rack.position.set(s * 12.7, 2.72, -2.95); root.add(rack);
      const store = new THREE.Object3D(); store.name = 'gbu_' + side; store.position.set(0, -0.25, 0); rack.add(store);
      const gun = new THREE.Group(); gun.name = 'gun_' + side; gun.position.set(s * 12.4, 2.57, 3.7); root.add(gun);
      const bg = new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0); gun.add(new THREE.Mesh(bg, M.dark));
      const mz = new THREE.Object3D(); mz.name = 'muzzle_' + side; mz.position.set(0, 0, 0.8); gun.add(mz);
    }
    const empty = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); root.add(o); return o; };
    empty('seat_pilot', 0, 3.7, 5.8); empty('seat_copilot', -0.9, 3.6, 6.85);
    empty('seat_0', 2.65, 3.35, 2.7); empty('seat_1', 2.65, 3.35, 3.6); empty('seat_2', 2.65, 3.35, 4.5); empty('seat_3', 0.5, 3.5, -4.6);
    empty('exit_ramp', 0, 0, -11.29); empty('exit_l', 3.2, 0, -7.972); empty('exit_r', -3.2, 0, -7.972);
    empty('floor', 0, 2.05, 0); empty('walk_cabin', 0, 2.05, 3.2); empty('walk_cargo', 0, 2.05, -4.5);
    // 機内の地球儀と炉（V2 の機内。今は回るだけ）
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), M.trim); globe.name = 'holo_globe'; globe.position.set(0, 3.0, 1.3); root.add(globe);
    const reactor = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 18), M.hot); reactor.name = 'reactor'; reactor.position.set(0, 3.2, -1.5); root.add(reactor);
    root.userData.source = 'procedural';
    return root;
  }
  MR.VtolModel = { build: buildModel, NODES };

  // 吊り物の代わりの形（焼いた試作弾 MR.Missiles._baked がまだ無い型）: 型ごとに 1 つ作って共有（捨てない。機体を捨てても残す）
  const STORE_FB = {};
  //   L = 型の長さ（game.json の missiles.types[型].length。setStoreGeo の lengths）
  function storeFallback(type, bomb, L) {
    let f = STORE_FB[type];
    if (f) return f;
    const Ms = MR.Missiles;
    L = L || 3;
    const geo = Ms && typeof Ms.fallbackGeometry === 'function' ? Ms.fallbackGeometry(L, bomb ? 0.18 : 0.09, bomb) : new THREE.CylinderGeometry(bomb ? 0.18 : 0.09, bomb ? 0.18 : 0.09, L, 8).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: srgb(bomb ? '#59603a' : '#d9dcdf'), roughness: bomb ? 0.6 : 0.5, metalness: bomb ? 0.2 : 0.3 });
    f = STORE_FB[type] = { geo, mat };
    return f;
  }

  // 止めてある機体のまとめた形（GLB ごとに 1 回作って共有。jet.js の PARKED と同じ考え）
  const PARKED = new Map();
  const ARMED = new Map(); let ARMED_T = 0; // 武装を出しきった姿勢のまとめた形（キー → { b, users, t }。arm.mergedCache 個まで）
  const GLB_KEYS = new Set(); // 読んだ GLB（assets の loadModel のキー。releaseAssets が捨てる）
  //   skip（任意）: まとめない部分の根のノードの Set（武装を出したまとめた形は銃 gun_l / gun_r を外す = 銃は元のノードで動く）
  function buildParked(model, skip) {
    const utils = THREE.BufferGeometryUtils;
    if (!utils || typeof utils.mergeBufferGeometries !== 'function') return null;
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const groups = new Map(), m4 = new THREE.Matrix4();
    let bad = false;
    const visit = (o) => {
      if (bad || !o.visible || (skip && skip.has(o))) return;
      if (o.isMesh) {
        const g0 = o.geometry;
        if (Array.isArray(o.material) || o.isSkinnedMesh || o.isInstancedMesh || !g0 || !g0.attributes || !g0.attributes.position) { bad = true; return; }
        const sig = Object.keys(g0.attributes).sort().join(',') + (g0.index ? '|i' : '|n');
        const key = o.material.uuid + '|' + sig + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
        let gp = groups.get(key);
        if (!gp) groups.set(key, gp = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, list: [] });
        const g = g0.clone();
        m4.multiplyMatrices(inv, o.matrixWorld);
        g.applyMatrix4(m4);
        if (m4.determinant() < 0 && g.index) { const a = g.index.array; for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
        g.morphAttributes = {}; g.clearGroups();
        gp.list.push(g);
      }
      for (const c of o.children) visit(c);
    };
    visit(model);
    if (bad) return null;
    const parts = [];
    for (const gp of groups.values()) {
      const merged = gp.list.length === 1 ? gp.list[0] : utils.mergeBufferGeometries(gp.list, false);
      if (gp.list.length > 1) for (const h of gp.list) h.dispose();
      if (!merged) { for (const pt of parts) pt.geo.dispose(); return null; }
      merged.computeBoundingSphere();
      parts.push({ geo: merged, mat: gp.mat, cast: gp.cast, recv: gp.recv });
    }
    return { parts };
  }

  // ---------- 機内（V2）: vtol.json の cabin → 動く足場の形（ships.json と同じ形: boxes / decks / ramps / edges / bbox。platforms.js の buildLocalNav）----------
  //   'vtol:open'  … 傾斜板を下ろしきった（rampProxy = 床の縁 (2.05, z −6.6) から地面 (0, z −10.09) への 30.4° の線。tag stairs）
  //   'vtol:closed'… 閉じている（閉じた板と、床の縁 z −6.6 の後ろの壁。尾の扉 cargo_door の箱も）、'vtol:moving' … 開け閉めの途中（床の縁の壁だけ）
  //   箱の f: 0 = 当たる（立てない）、4 = WALK（床の高さの家具）。機体の外の歩く人は hull の箱（胴体の殻）で止まる（翼の下はくぐれる = V1 と同じ）
  let CABIN_N = 0;
  const CABIN_TYPES = new Map(); // cabin（vtol.json の同じ物）→ { 'vtol:open', 'vtol:closed' }
  function cabinTypes(cab) {
    let t = CABIN_TYPES.get(cab);
    if (t) return t;
    const WALKF = 4, fl = cab.floorY == null ? 2.05 : cab.floorY, ceil = cab.ceilingY == null ? 5.13 : cab.ceilingY;
    const B = (b, f, tag) => [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, f, tag || b.tag || ''];
    // 外の殻（hull）で下の端が頭の高さより低い箱は地面（−2 m）まで: 地面の歩く人の頭の上の「天井」にすると、カプセルが下へ押されて床を抜けた
    //   （空母の甲板で尾の横から傾斜板へ歩いて 18 m 落ちた）。胴体の下・尾の下は歩けない（V1 の押し出しと同じ）
    const H = (b) => { const q = B(b, 0); if (q[1] < 1.9) q[1] = -2; return q; };
    const base = [];
    for (const b of cab.hull || []) if (!b.closedOnly) base.push(H(b));
    for (const b of cab.walls || []) base.push(B(b, 0));
    for (const b of cab.furniture || []) base.push(B(b, b.y0 <= fl + 0.05 ? WALKF : 0));
    const decks = cab.walk.map((w) => [w.x0, w.z0, w.x1, w.z1, w.y == null ? fl : w.y]);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const b of cab.hull || []) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); z0 = Math.min(z0, b.z0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); z1 = Math.max(z1, b.z1); }
    const P = cab.profile, rh = (cab.ramp && cab.ramp.width && cab.ramp.width[0] ? cab.ramp.width[0] / 2 : 1.37);
    const bbox = [[x0, Math.min(0, y0), Math.min(z0, P.footZ - 0.5)], [x1, y1, z1]];
    const closed = base.slice();
    for (const b of cab.hull || []) if (b.closedOnly) closed.push(H(b));
    closed.push([-rh, -2, P.edgeZ - 2.4, rh, fl, P.edgeZ, 0, 'ramp_closed']); // 閉じた板（上面 = 床。下は地面まで = 外の歩く人の天井にしない）
    closed.push([-1.5, fl, P.edgeZ - 0.15, 1.5, ceil, P.edgeZ, 0, 'ramp_wall']);     // 床の縁の後ろの壁（閉じた貨物室の奥）
    const moving = base.concat([[-1.5, fl, P.edgeZ - 0.15, 1.5, ceil, P.edgeZ, 0, 'ramp_wall']]);
    t = {
      'vtol:open': { boxes: base, decks, ramps: (cab.rampProxy || []).map((r) => r.slice()), edges: [], bbox },
      'vtol:moving': { boxes: moving, decks, ramps: [], edges: [], bbox }, // 開け閉めの途中: 板の上には入れない（板の上・下の人は _rampStep が外へ）
      'vtol:closed': { boxes: closed, decks, ramps: [], edges: [], bbox }
    };
    // V2c: 車を積んでいる（置き場所の箱 = 歩く人はジープの中を通れない。左舷の通路 1.7 m は空いている）。':car' の型
    const cb = MR.VtolCargo && MR.VtolCargo.slotBox ? MR.VtolCargo.slotBox(cab) : null;
    if (cb) for (const k of ['vtol:open', 'vtol:moving', 'vtol:closed']) { const q = t[k]; t[k + ':car'] = { boxes: q.boxes.concat([cb]), decks, ramps: q.ramps, edges: [], bbox }; }
    CABIN_TYPES.set(cab, t);
    return t;
  }

  class Vtol extends MR.Vehicle {
    constructor(scene, def, opts) {
      const merged = Object.assign({}, DEFAULTS, def || {});
      super(scene, merged, opts);
      const d = this.def = Object.assign({}, MR.Vehicle.DEFAULTS, merged);
      for (const k of ['avoid', 'autoland', 'maneuver', 'wreck', 'camRecenter', 'chaseClamp', 'flares', 'rwr', 'gun', 'missile', 'bombs', 'arm', 'rearm', 'cams', 'autopilot', 'board', 'ramp', 'cargo']) d[k] = Object.assign({}, DEFAULTS[k], (def && def[k]) || {});
      d.missile.count = (d.missile.loadout || []).length; d.bombs.count = (d.bombs.loadout || []).length;
      const data = (opts && opts.data) || null; // assets/levels/vtol.json（無ければ def.hull / boxes / contacts、無ければ既定）
      this.hullDef = (data && Array.isArray(data.hull) && data.hull.length ? data.hull : null) || (Array.isArray(d.hull) && d.hull.length ? d.hull : HULL);
      this.boxDef = (data && Array.isArray(data.boxes) && data.boxes.length ? data.boxes : null) || (Array.isArray(d.boxes) && d.boxes.length ? d.boxes : BOXES);
      const ct = (data && Array.isArray(data.contacts) && data.contacts.length ? data.contacts : null) || (Array.isArray(d.contacts) && d.contacts.length ? d.contacts : CONTACTS);
      this.gearPts = ct.filter((c) => c.gear !== 'belly').map((c) => new THREE.Vector3(c.x, c.y || 0, c.z));
      // 脚の間の長さ（傾きの比 = 脚の面の高さの差 ÷ これ）: 脚の点の前後と左右の広がりの大きい方（vtol.json の contacts で 8.4 m）
      { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const q of this.gearPts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
        this.gearSpan = Math.max(1, x1 - x0, z1 - z0) || 8.4; }
      const belly = ct.find((c) => c.gear === 'belly');
      this.bellyPts = [new THREE.Vector3(0, belly ? belly.y : 1.02, belly ? belly.z : 0.9), new THREE.Vector3(0, 1.05, 9), new THREE.Vector3(0, 1.05, -10)];
      // 機内（V2）: vtol.json の cabin（歩ける床・壁・家具・傾斜板の当たり）と seats（stand = 席の前に立つ所）。無ければ歩けない（V1 の外の「乗る」）
      this.cabin = data && data.cabin && Array.isArray(data.cabin.walk) && data.cabin.profile ? data.cabin : null;
      this.seatStand = [];
      if (this.cabin) {
        const SI = (data && data.seats) || {};
        for (const s of d.seats || []) { const q = SI[s.node]; this.seatStand.push(q && q.stand ? { x: q.stand[0], y: q.stand[1], z: q.stand[2], eye: q.eye ? { x: q.eye[0], y: q.eye[1], z: q.eye[2] } : null } : null); }
        this._entry = { id: 'v:' + (++CABIN_N), typeId: 'vtol:closed', pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, prevPose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
          vel: { x: 0, y: 0, z: 0 }, wy: 0, speed: 0, flags: { noShot: true, feetProbe: true }, data: null, radius: 14, vtol: this };
        const ct = cabinTypes(this.cabin);
        this._entry.data = ct['vtol:closed'];
      }
      this._s0 = this.hullDef.map(() => new THREE.Vector3()); this._s1 = this.hullDef.map(() => new THREE.Vector3());
      this.hullR = this.hullDef.reduce((m, h) => Math.max(m, Math.hypot(h.x, h.y - PIVOT_Y, h.z) + h.r), 0);
      this.health = num(opts && opts.health, d.health);
      this.collider = (opts && opts.collider) || null;
      this.city = (opts && opts.city) || null;
      this.cd0 = d.thrustCruise * G / (d.maxSpeed * d.maxSpeed);
      this.flareCount = d.flares.count; this._flareT = 0; this.incoming = null;
      this.ammo = d.gun.ammo; this.missileCount = d.missile.count; this.bombCount = d.bombs.count; this._missileT = 0; this._bombT = 0;
      this._storesShow();
      if (opts && opts.airborne) { this.grounded = false; this.airborne = true; this.spool = 1; this.engineOn = true; this.gearPos = 1; }
      this._updateQuat();
      this._apply();
    }

    _preInit(opts) {
      this.kind = 'vtol';
      this.vel = new THREE.Vector3();
      this.pitch = 0; this.roll = 0; this.yawRate = 0;
      this.quat = new THREE.Quaternion();
      this.theta = 90;              // ナセルの角度（度。90 ホバー / 0 巡航）
      this.spool = 0; this.engineOn = false; this.thrustUse = 0;
      this.grounded = true; this.airborne = false; this.agl = 0; this.groundY = 0; this.onWater = false;
      this.flight = 'hover';        // 'hover' | 'cruise'（目標の飛び方。実際の混ぜ具合は θ）
      this.spdHold = 0; this.hdgHold = null; this.altHold = null; this.posHold = null; this._transT = 0; this._turning = false; this._latch = false;
      this.ctl = { stickX: 0, stickY: 0, climb: 0, boost: false, slow: false, yaw: null, pitch: 0, scheme: 'easy' };
      this.gearDown = true; this.gearPos = 1; this.rampPos = 0; this.rampOpen = false;
      // 傾斜板（V2）: rampPos 0 閉じている … 1 開いている、rampWant（開けたい）。levelled = 水平に降りている（傾き ≤ ramp.levelTiltMax）
      this.rampWant = false; this.levelled = true; this.rampRefuse = null; this._rampInit = false; this._sweepT = 0; this._rampHoldMsg = 0;
      this._cabinOn = false; this._walkerAboard = false; this._walkerIn = false; this.boarded = 0; this.onBoarded = null;
      this.interior = null; this._intState = 0; this.toeNode = null; this.doorNode = null;
      this.gload = 1; this.stall = 0; this.cantLand = 0;
      this.autoland = null; this.landed = null; // 最後の着陸 { kind, name, x, z, sink, h }
      this.autoT = 0;
      this.crash = null; this.wreckFall = null;
      this.cockpit = false; this.localInside = false; this.listenerPos = null;
      this.events = [];
      this.landings = []; this.impacts = 0; this.lastImpactSpeed = 0;
      this.stats = { maxSpeed: 0, maxG: 0, maxAlt: 0, collisions: 0, crashes: 0, sweeps: 0, boxes: 0, refused: 0 };
      this.pods = []; this.gearNodes = []; this.doorNodes = []; this.rampNode = null; this.spinNodes = [];
      this._parked = null; this._parkedOn = false;
      this._cands = []; this._acc = new THREE.Vector3(); this._aSm = new THREE.Vector3();
      this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
      this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._qi = new THREE.Quaternion();
      this._piv = new THREE.Vector3(0, PIVOT_Y, 0);
      this._floorT = 0; this._floor = -Infinity; this._vCapC = Infinity; this._vCapH = Infinity; this._spdCap = Infinity;
      this._washT = 0;
      this.flybyT = 0; this.n = 0;
      // 武装（V3）
      this.armPos = 0; this.armWant = false; this._armT = 0;
      this.gunAim = { yaw: 0, pitch: 0 };
      this.gunNodes = []; this.bayDoors = []; this.bayLinks = []; this.bayRacks = []; this._muzzles = [null, null];
      this._slots = []; this._storeMeshes = []; this._storeGeo = null;
      this.ammo = 0; this.rearmT = 0; this.firing = false; this.shots = 0;
      this.gunTask = null; this.missileTask = null;
      // 物語（hoverAt / followPath / orbit・storyPinned）
      this.script = null; this.storyPinned = false;
      this._ea = new THREE.Euler(0, 0, 0, 'YXZ');
    }

    static buildFallback(def) { return buildModel(def); }
    static fromScene(scene, def) {
      const clone = scene.clone(true);
      const s = num(def.scale, 1);
      if (s !== 1) clone.scale.multiplyScalar(s);
      clone.position.set(0, 0, 0);
      clone.userData.source = 'glb';
      return clone;
    }

    // GLB（近くに来たときだけ = 機体を作ったとき）。読もうとした回数は Vtol.stats.glbRequests（V10）
    _loadModel() {
      const a = this.assets, file = this.def.model;
      if (!a || !file || typeof a.loadModel !== 'function') return;
      Vtol.stats.glbRequests++;
      super._loadModel();
    }

    _setModel(group, source) {
      if (this._parked) this._dropParked();
      this._dropStoreMeshes(); // 吊り物の形は共有（焼いた試作弾）: 古い機体のコードの形と一緒に捨てない
      super._setModel(group, source);
      if (source === 'glb' && group.userData.file) GLB_KEYS.add(group.userData.file);
      const g = this.model, find = (n) => g.getObjectByName(n);
      const hv = this.def.hoverDeg;
      this.pods = ['pod_l', 'pod_r'].map(find).filter(Boolean).map((n) => ({ node: n, q0: n.quaternion.clone() }));
      this.gearNodes = ['gear_n', 'gear_l', 'gear_r'].map(find).filter(Boolean).map((n) => ({ node: n, q0: n.quaternion.clone() }));
      this.doorNodes = ['gdoor_na', 'gdoor_nb', 'gdoor_la', 'gdoor_lb', 'gdoor_ra', 'gdoor_rb'].map(find).filter(Boolean).map((n, i) => ({ node: n, q0: n.quaternion.clone(), s: i % 2 ? -1 : 1 }));
      const rn = find('ramp');
      this.rampNode = rn ? { node: rn, q0: rn.quaternion.clone() } : null;
      const tn = find('ramp_toe'), dn = find('cargo_door');
      this.toeNode = tn ? { node: tn, p0: tn.position.clone() } : null;
      this.doorNode = dn ? { node: dn, q0: dn.quaternion.clone() } : null;
      this.spinNodes = ['holo_globe', 'reactor'].map(find).filter(Boolean);
      this.glassNodes = [];
      g.traverse((o) => { if (o.isMesh && (o.name === 'canopy' || o.userData.vtolGlass || (o.parent && o.parent.name === 'canopy'))) this.glassNodes.push(o); });
      this._hoverSign = hv < 0 ? -1 : 1;
      // 武装の部品（V3）: 銃（付け根・銃口）・兵器の扉・腕・ラック（下がる前の高さ）・吊り物の置き場所
      this.gunNodes = [['gun_l', 1], ['gun_r', -1]].map(([n, s]) => { const o = find(n); return o ? { node: o, q0: o.quaternion.clone(), s } : null; }).filter(Boolean);
      this._muzzles = [find('muzzle_l') || null, find('muzzle_r') || null];
      this.bayDoors = [];
      for (const [side, s] of [['l', 1], ['r', -1]]) for (const io of ['in', 'out']) { const o = find('bay_door_' + side + '_' + io); if (o) this.bayDoors.push({ node: o, q0: o.quaternion.clone(), e: io === 'in' ? s : -s }); }
      this.bayLinks = ['bay_link_l_f', 'bay_link_l_a', 'bay_link_r_f', 'bay_link_r_a'].map(find).filter(Boolean).map((n) => ({ node: n, q0: n.quaternion.clone() }));
      this.bayRacks = ['bay_rack_l', 'bay_rack_r'].map(find).filter(Boolean).map((n) => ({ node: n, y0: n.position.y }));
      this._slots = null; this._stores = null;
      this._storesShow();
      this._animate(0, true);
      if (this.cockpit) this.setCockpit(true, true);
    }

    // 一人称: メッシュをレイヤー 1 にも（ガラスは本体のパスだけ）
    setCockpit(on, force) {
      on = !!on;
      if (on === this.cockpit && !force) return;
      this.cockpit = on;
      if (!this.model) return;
      const glass = new Set(this.glassNodes || []);
      this.model.traverse((o) => { if (o.isMesh && !glass.has(o)) { if (on) o.layers.enable(1); else o.layers.disable(1); } });
      if (this.interior) this.interior.traverse((o) => { if (o.isMesh) { if (on) o.layers.enable(1); else o.layers.disable(1); } });
      if (this._parkedOn) this._showParked(true); // まとめた形のキーに操縦席の印（':C'）があるので作り直す
    }
    // まとめない部分の根: 武装を出しきっていれば銃、操縦席なら回る部品（holo_globe / reactor）とガラス（ガラスは本体のパスだけ = レイヤー 1 に入れない）
    _mergeKeep() {
      const k = [];
      if (this.armPos >= 1) for (const gn of this.gunNodes) k.push(gn.node);
      if (this.cockpit) { for (const n of this.spinNodes || []) k.push(n); for (const n of this.glassNodes || []) k.push(n); }
      return k;
    }

    // 止めてある機体: まとめた形と元のノードを入れ替える（GLB だけ。コードの機体は最初から材質ごとにまとめてある）
    //   武装を出しきった（armPos 1）姿勢も（V3）: 銃 gun_l / gun_r の外を、出ている吊り物ごと（キー = 姿勢 + 吊り物の印）まとめ、銃だけ元のノードで描く
    //   （元のノードのままだと sd で 8 → 約 73 メッシュ、影を入れて描く回数 +110〜125。arm.mergedCache 個まで覚える）
    //   操縦席（一人称）でも（V3）: まとめた形をレイヤー 1 にも入れ、回る部品とガラスは元のノード（操縦席の重ね描きで元のノードのままだと 312 回 > 300）
    _showParked(on) {
      if (on) {
        if (!this.model || this.modelSource !== 'glb' || this.wrecked) return;
        const armed = this.armPos >= 1;
        const key = this._parkKey();
        let pk;
        if (armed) {
          let e = ARMED.get(key);
          if (!e) {
            const skip = new Set(this._mergeKeep());
            this._armedHide(false); this.model.visible = true; // 隠したノードも入れて作る（見せ方は下で戻す）
            let b = null; try { b = buildParked(this.model, skip); } catch (er) { b = null; }
            e = { b, users: 0, t: 0 }; ARMED.set(key, e); Vtol.stats.parkedBuilt++; Vtol.stats.armedBuilt++;
            // 古い（使っていない）ものから捨てる
            const max = Math.max(1, (this.def.arm && this.def.arm.mergedCache) || 2);
            while (ARMED.size > max) {
              let old = null, ok = null;
              for (const [k2, e2] of ARMED) if (e2 !== e && e2.users <= 0 && (!old || e2.t < old.t)) { old = e2; ok = k2; }
              if (!old) break;
              if (old.b) for (const pt of old.b.parts) pt.geo.dispose();
              ARMED.delete(ok);
            }
          }
          e.t = ++ARMED_T;
          pk = e.b;
        } else {
          if (!PARKED.has(key)) { const kp = this._mergeKeep(); this._armedHide(false); this.model.visible = true; let b = null; try { b = buildParked(this.model, kp.length ? new Set(kp) : null); } catch (er) { b = null; } PARKED.set(key, b); Vtol.stats.parkedBuilt++; }
          pk = PARKED.get(key);
        }
        if (!pk) return;
        if (!this._parked || this._parked.key !== key) {
          this._dropParked();
          const grp = new THREE.Group(); grp.name = 'vtol_parked';
          for (const pt of pk.parts) { const m = new THREE.Mesh(pt.geo, pt.mat); m.castShadow = pt.cast; m.receiveShadow = pt.recv; m.matrixAutoUpdate = false; if (this.cockpit) m.layers.enable(1); grp.add(m); }
          grp.position.copy(this.model.position); grp.quaternion.copy(this.model.quaternion); grp.scale.copy(this.model.scale);
          this.root.add(grp);
          this._parked = { key, group: grp, armed };
          if (armed) ARMED.get(key).users++;
        }
        this._parked.group.visible = true; this._parkedOn = true;
        if (armed || this.cockpit) this._armedHide(true); else { this._armedHide(false); this.model.visible = false; }
        return;
      }
      if (this._parked) this._parked.group.visible = false;
      this._armedHide(false);
      if (this.model) this.model.visible = true;
      this._parkedOn = false;
    }
    _poseKey() { return 'glb:' + ((this.model && this.model.userData.file) || this.def.model) + ':' + Math.round(this.theta) + ':' + Math.round(this.gearPos) + ':' + Math.round(this.rampPos * 10); }
    // まとめた形のキー: 姿勢（+ 武装を出しきっていれば 'A' と吊り物の印: 0 空 / 1 筒の代わり / 2 焼いた試作弾）
    _parkKey() {
      if (this.armPos < 1) return this._poseKey() + (this.cockpit ? ':C' : '');
      let m = '';
      const p = this._pylons(), bp = this._bombPylons(), B = this._storeGeo || {};
      for (const sl of this._slotList()) m += (sl.bomb ? bp[sl.i] : p[sl.i]) && sl.mesh ? (B[sl.type] ? '2' : '1') : '0';
      return this._poseKey() + ':A' + m + (this.cockpit ? ':C' : '');
    }
    // 武装・操縦席のまとめた形を見せている間: 元のノードは _mergeKeep の根（銃・回る部品・ガラス）とその親だけ見せる。off で戻す
    _armedHide(on) {
      if (!on) {
        if (this._armHid) { for (const h of this._armHid) h.node.visible = h.v; this._armHid = null; }
        return;
      }
      if (this._armHid || !this.model) return;
      this.model.visible = true;
      const roots = this._mergeKeep(), keep = new Set(), guns = new Set(roots);
      for (const r of roots) for (let o = r.parent; o && o !== this.model; o = o.parent) keep.add(o);
      const hid = this._armHid = [];
      const walk = (o) => { for (const c of o.children) { if (guns.has(c)) continue; if (keep.has(c)) { walk(c); continue; } hid.push({ node: c, v: c.visible }); c.visible = false; } };
      walk(this.model);
    }
    _dropParked() {
      this._armedHide(false);
      if (this._parked) {
        if (this._parked.armed) { const e = ARMED.get(this._parked.key); if (e) e.users = Math.max(0, e.users - 1); }
        if (this._parked.group.parent) this._parked.group.parent.remove(this._parked.group); this._parked = null;
      }
      if (this.model) this.model.visible = true;
      this._parkedOn = false;
    }

    // ---------- 座標 ----------
    _updateQuat() { this._e.set(this.pitch, this.yaw, this.roll, 'YXZ'); this.quat.setFromEuler(this._e); }
    // ローカル（モデルの座標）→ 世界。ヨー・機首の上下・左右の傾き（重心のあたり PIVOT_Y の周り）
    toWorld(local, target) {
      const t = (target || new THREE.Vector3()).set(local.x, local.y - PIVOT_Y, local.z).applyQuaternion(this.quat);
      return t.set(t.x + this.pos.x, t.y + this.pos.y + PIVOT_Y, t.z + this.pos.z);
    }
    center(target) { return (target || new THREE.Vector3()).set(this.pos.x, this.pos.y + PIVOT_Y, this.pos.z); }
    get speedKmh() { return this.vel.length() * 3.6; }
    get speedRatio() { return clamp(this.vel.length() / this.def.maxSpeed, 0, 1); }
    // 歩く人・乗れる距離は胴体の長方形（翼の下はくぐれる）
    distanceTo(x, z) {
      const l = this.toLocal(x, z), F = this.boxDef[0] || BOXES[0];
      const dx = Math.max(0, l.x - F.x1, F.x0 - l.x), dz = Math.max(0, l.z - F.z1, F.z0 - l.z);
      return Math.sqrt(dx * dx + dz * dz);
    }
    pushOut(p, radius) {
      const F = this.boxDef[0] || BOXES[0], l = this.toLocal(p.x, p.z);
      if (l.x <= F.x0 - radius || l.x >= F.x1 + radius || l.z <= F.z0 - radius || l.z >= F.z1 + radius) return false;
      const pen = [l.x - (F.x0 - radius), F.x1 + radius - l.x, l.z - (F.z0 - radius), F.z1 + radius - l.z];
      let k = 0; for (let i = 1; i < 4; i++) if (pen[i] < pen[k]) k = i;
      let lx = l.x, lz = l.z;
      if (k === 0) lx = F.x0 - radius; else if (k === 1) lx = F.x1 + radius; else if (k === 2) lz = F.z0 - radius; else lz = F.z1 + radius;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      p.x = this.pos.x + lx * c + lz * s; p.z = this.pos.z - lx * s + lz * c;
      return true;
    }
    _pushCircle(x, z, r) {
      // 他の乗り物: 胴体の長方形から押し出す。cargo.barrierPad m 広く（V2c: 車の円は角を覆わないので、斜めに当たった車の角が胴体（傾斜板の先の柵）に入らない）
      const p = { x, z };
      this.pushOut(p, r + ((this.def.cargo && this.def.cargo.barrierPad) || 0));
      return p;
    }
    // 降りる所: 座席の出口 → 機首の横・後ろ（胴体の外）→ 機体の周り（Vehicle.findExit）
    findExit(i, nav, r) {
      const cands = [this.exitLocals && this.exitLocals[i || 0], new THREE.Vector3(5, 0, 11.5), new THREE.Vector3(-5, 0, 11.5), new THREE.Vector3(0, 0, 14.2), new THREE.Vector3(0, 0, -14.6)];
      for (const L of cands) {
        if (!L) continue;
        const w = this.toWorld(this._v3.set(L.x, 0, L.z), this._v2);
        if (this.distanceTo(w.x, w.z) < (r || 0.4) + 0.05) continue;
        if (typeof nav.resolveCapsule !== 'function') continue;
        const g = nav.groundHeight(w.x, w.z, this.pos.y + 1.2, (r || 0.4) * 0.5);
        if (g === null || Math.abs(g - this.pos.y) > 2.5) continue;
        const q = nav.resolveCapsule({ x: w.x, y: g, z: w.z }, r || 0.4, 1.8, 0.45, { snapDown: 0.1 });
        if (Math.hypot(q.x - w.x, q.z - w.z) > 0.15) continue;
        return { x: q.x, y: q.y, z: q.z };
      }
      return super.findExit(i, nav, r);
    }
    // 歩行グラフの動く箱（nav.setDynamicBoxes）: 胴体の長方形だけ（歩く人の押し出し pushOut と同じ。翼の下は歩ける。翼幅ぜんぶにすると Sky High の屋上の
    //   階段室の出口まで動く箱に入り、スカイフロアから屋上へ歩く経路が無くなった = smoke 21s）
    aabb() {
      const F = this.boxDef[0] || BOXES[0], c = Math.cos(this.yaw), s = Math.sin(this.yaw), ac = Math.abs(c), as = Math.abs(s);
      const hw = (F.x1 - F.x0) / 2, hl = (F.z1 - F.z0) / 2, mx = (F.x0 + F.x1) / 2, mz = (F.z0 + F.z1) / 2;
      return { x: this.pos.x + mx * c + mz * s, z: this.pos.z - mx * s + mz * c, w: 2 * (hw * ac + hl * as), d: 2 * (hw * as + hl * ac), y: this.pos.y, h: this.def.height };
    }
    // 翼幅ぜんぶの囲み（ほかの VTOL の自動着陸の目標を空いているか見る _spotClear）
    spanAabb() {
      const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw));
      const hw = this.def.width / 2, hl = this.def.length / 2;
      return { x: this.pos.x, z: this.pos.z, w: 2 * (hw * c + hl * s), d: 2 * (hw * s + hl * c), y: this.pos.y, h: this.def.height };
    }
    // 弾: 胴体・翼・ナセル・傾斜板の箱（機体の座標）
    intersectRay(origin, dir, maxT) {
      if (!MR.Nav || typeof MR.Nav.rayBox !== 'function' || this.sunk) return null;
      const q = this._qi.copy(this.quat).invert();
      const o = this._v1.set(origin.x - this.pos.x, origin.y - this.pos.y - PIVOT_Y, origin.z - this.pos.z).applyQuaternion(q);
      o.y += PIVOT_Y;
      const dd = this._v2.copy(dir).applyQuaternion(q);
      let best = null, bb = null;
      for (const b of this.boxDef) {
        const t = MR.Nav.rayBox(o.x, o.y, o.z, dd.x, dd.y, dd.z, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
        if (t === null || t < 0 || t > maxT) continue;
        if (best === null || t < best) { best = t; bb = b; }
      }
      if (best === null) return null;
      const lx = o.x + dd.x * best, ly = o.y + dd.y * best, lz = o.z + dd.z * best;
      const faces = [[Math.abs(lx - bb.x0), -1, 0, 0], [Math.abs(lx - bb.x1), 1, 0, 0], [Math.abs(ly - bb.y0), 0, -1, 0], [Math.abs(ly - bb.y1), 0, 1, 0], [Math.abs(lz - bb.z0), 0, 0, -1], [Math.abs(lz - bb.z1), 0, 0, 1]];
      let f = faces[0];
      for (const gg of faces) if (gg[0] < f[0]) f = gg;
      const normal = new THREE.Vector3(f[1], f[2], f[3]).applyQuaternion(this.quat);
      return { t: best, point: origin.clone().addScaledVector(dir, best), normal, part: bb.tag };
    }
    // 点が機体の外形（箱 + margin）の中か（3 人称のカメラを機体の中に置かない）
    ownHullHas(x, y, z, margin) {
      const m = margin || 0, q = this._qi.copy(this.quat).invert();
      const p = this._v1.set(x - this.pos.x, y - this.pos.y - PIVOT_Y, z - this.pos.z).applyQuaternion(q);
      p.y += PIVOT_Y;
      for (const b of this.boxDef) if (p.x > b.x0 - m && p.x < b.x1 + m && p.y > b.y0 - m && p.y < b.y1 + m && p.z > b.z0 - m && p.z < b.z1 + m) return true;
      // 機体の球（hull）も（箱の外に出ている翼端・機首の丸み）
      for (const s of this.hullDef) { const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z, r = s.r + m; if (dx * dx + dy * dy + dz * dz < r * r) return true; }
      return false;
    }

    // ---------- 機内と傾斜板（V2）----------
    // 傾斜板の状態: 'closed' | 'opening' | 'open' | 'closing'
    get rampState() {
      if (this.rampWant) return this.rampPos >= 1 ? 'open' : 'opening';
      return this.rampPos <= 0 ? 'closed' : 'closing';
    }
    // 開けられない理由（null = 開けられる）: 'none'（機内のデータが無い）| 'wrecked' | 'air' | 'moving' | 'tilt' | 'ship' | 'water' | 'ground'
    rampRefusal(ctx) {
      if (!this.cabin) return 'none';
      if (this.wrecked || this.sinking || this.sunk) return 'wrecked';
      if (!this.grounded) return 'air';
      if (this.speed > this.def.ramp.landedSpeed || this.spool > 0.02 && this.driver && this.ctl.climb > 0) return 'moving';
      if (!this.levelled) return 'tilt';
      if (this.platform || this._ride) return 'ship';
      return this._footCheck(ctx || this._lastCtx);
    }
    // 開ける / 閉じる（物語の API）。開けられなければ false（理由は rampRefuse・events の ramp_refused）
    openRamp(open) {
      if (!this.cabin) return false;
      if (!open && this.cargoBusy) { this.rampRefuse = 'cargo'; this._rampMsg('ramp_car'); return false; } // V2c: 車が傾斜板の上を動いている
      if (!open) { this.rampWant = false; this.rampRefuse = null; return true; }
      const r = this.rampRefusal();
      if (r) { this.rampRefuse = r; this._rampMsg('ramp_refused', r); return false; }
      this.rampRefuse = null;
      this.rampWant = true;
      return true;
    }
    // 傾斜板の先（トウの先）の世界の位置（物語の API）。閉じていれば尾の下の板の後ろの端
    rampTip(out) {
      out = out || new THREE.Vector3();
      const C = this.cabin;
      if (!C) return this.toWorld(this._v3.set(0, 0, -11.29), out);
      const R = C.ramp || {}, P = C.profile, k = this._rampK || [0, 0, 0];
      const a = num(R.openDeg, this.def.rampDeg) * D2R * k[1], L = num(R.length, 2.4) + num(C.toe && C.toe.exposed, 1.62) * k[2];
      return this.toWorld(this._v3.set(0, P.floorY + Math.sin(a) * L, P.edgeZ - Math.cos(a) * L), out);
    }
    // 歩いている人がこの機体の床・傾斜板の上にいるか（物語の API。cityBoats の ride = p.platform で見る）
    onPlatform(player) { return !!(player && this._entry && player.platform === this._entry.id); }
    get platformId() { return this._entry ? this._entry.id : null; }
    // 動く足場の入口（cityboats.js の Platforms の 'v' の provider）。歩けるとき（着陸して水平・止まっている・壊れていない）だけ
    platformEntry() { return this._cabinOn ? this._entry : null; }
    walkable() { return this._cabinOn; }
    // 足元の確かめ（傾斜板の先 footZ の 3 点の地面の高さ − 脚の高さ が −footTolWalk〜+footTolHigh）。null = よい
    _footCheck(ctx) {
      if (!ctx) return null;
      const P = this.cabin.profile, R = this.def.ramp;
      for (const lx of [0, -1, 1]) {
        const w = this.toWorld(this._v3.set(lx, 0, P.footZ), this._v2);
        const S = this._support(ctx, w.x, w.z, this.pos.y + 1.2);
        if (S.y === null) return S.water !== null ? 'water' : 'ground';
        const gap = S.y - this.pos.y;
        if (gap < -R.footTolWalk || gap > R.footTolHigh) return 'ground';
      }
      return null;
    }
    // 毎フレーム（update の頭。止めてある機体も）: 開け閉め・歩ける足場・開け閉めの間の人
    _rampStep(dt, ctx) {
      if (!this.cabin) return;
      const R = this.def.ramp, C = this.cabin;
      this._lastCtx = ctx || this._lastCtx;
      const walker = ctx && ctx.walker && !ctx.walker.dead ? ctx.walker : null;
      if (!this.grounded || this.wrecked || this.sinking) this.rampWant = false;
      // 飛ぶつもり（上昇の入力・自動着陸・物語の自動操縦）: 先に閉じる（閉じるまで浮かない = _liftOk）
      if (this.grounded && (this.rampWant || this.rampPos > 0) && ((this.driver && this.ctl.climb > 0) || this.autoland || (this.script && !this.script.done))) {
        // V2c: 車の積み込み・降ろす途中は閉じない（終わってから。浮くのも _liftOk が待つ）
        const busy = this.cargoBusy;
        if (!busy) this.rampWant = false;
        if (this.time - this._rampHoldMsg > 2) { this._rampHoldMsg = this.time; this._rampMsg(busy ? 'ramp_car' : 'ramp_lift'); }
      }
      // 止めてある無人の機体: 最初は開けておく・閉じていれば歩いて近づくと開く
      if (!this._rampInit && ctx) {
        this._rampInit = true;
        if (R.autoOpenParked && !this.driver && this.grounded && !this.engineOn && !this.rampRefusal(ctx)) { this.rampWant = true; this.rampPos = 1; this._rampPose(); } // 姿勢も（コードの機体は止めてある間 _animate しない = rampTip が閉じた所のままだった）
      }
      if (R.autoOpenParked && !this.rampWant && !this.driver && this.grounded && !this.script && !this.autoland && walker && this.spool <= 0.02) {
        const l = this.toLocal(walker.pos.x, walker.pos.z);
        if (Math.hypot(l.x, l.z - C.profile.footZ) < R.autoOpenDist && Math.abs(walker.pos.y - this.pos.y) < 2.5 && !this.rampRefusal(ctx)) this.rampWant = true;
      }
      // 開け閉めの間の人: 閉じるときは傾斜板の上・下の人を closeWait 秒待ってから先の外へ。開くときは下の人をすぐ外へ
      let hold = false;
      if (walker && this.rampPos > 0 && !this.rampWant) {
        if (this._inSweep(walker)) {
          this._sweepT += dt;
          if (this._sweepT < R.closeWait) { hold = true; if (this._sweepT <= dt + 1e-6) this._rampMsg('ramp_wait'); }
          else { this._pushWalker(walker, ctx); this._sweepT = 0; }
        } else this._sweepT = 0;
      } else if (walker && this.rampWant && this.rampPos < 1 && this._inSweep(walker, true)) this._pushWalker(walker, ctx);
      else this._sweepT = 0;
      if (!hold) {
        const k = dt / Math.max(0.1, R.time);
        this.rampPos = clamp(this.rampPos + (this.rampWant ? k : -k), 0, 1);
      }
      this.rampOpen = this.rampPos >= 1;
      // 歩ける足場（cityboats の 'v'）: 着陸して水平・止まっている
      const on = !this.wrecked && !this.sinking && !this.sunk && this.grounded && this.levelled && this.speed <= R.landedSpeed && !this.platform && !this._ride;
      this._cabinOn = on;
      const e = this._entry, ps = e.pose;
      e.prevPose.x = ps.x; e.prevPose.y = ps.y; e.prevPose.z = ps.z; e.prevPose.yaw = ps.yaw;
      ps.x = this.pos.x; ps.y = this.pos.y; ps.z = this.pos.z; ps.yaw = this.yaw;
      const typeId = (this.rampPos >= 1 ? 'vtol:open' : this.rampPos > 0 ? 'vtol:moving' : 'vtol:closed') + (this._cargo && this._cargo.state === 'stowed' && cabinTypes(C)['vtol:open:car'] ? ':car' : '');
      if (typeId !== e.typeId) { e.typeId = typeId; e.data = cabinTypes(C)[typeId]; }
      this._walkerAboard = !!(on && walker && this.onPlatform(walker));
    }
    // 傾斜板・尾の扉の上・下（機体の座標の |x| ≤ 板の幅 + pad、z は胴体の後ろの端 − pad 〜 床の縁、y は地面の少し下 〜 床 + 2 m）。under: 地面に立っている人だけ（開くとき）
    _inSweep(w, under) {
      const C = this.cabin, P = C.profile, pad = this.def.ramp.sweepPad;
      const l = this.toLocal(w.pos.x, w.pos.z), ly = w.pos.y - this.pos.y;
      const F = this.boxDef[0] || BOXES[0]; // 尾の扉（cargo_door）は胴体の後ろの端まで振れる
      if (Math.abs(l.x) > 1.45 + pad || l.z < Math.min(P.footZ, F.z0) - pad || l.z > P.edgeZ - 0.05 || ly < -0.6 || ly > P.floorY + 0.3) return false;
      if (under) return ly < 0.9;
      return true;
    }
    // 先の外（傾斜板の先から pushOut m 後ろ）へ置く
    _pushWalker(w, ctx) {
      const C = this.cabin, l = this.toLocal(w.pos.x, w.pos.z);
      // 尾（閉じている・開きかけの扉）の下に入らないよう、胴体の後ろの端 + 0.6 m まで
      const F = this.boxDef[0] || BOXES[0], z = Math.min(C.profile.footZ - this.def.ramp.pushOut, F.z0 - 0.6);
      const p = this.toWorld(this._v3.set(clamp(l.x, -1, 1), 0, z), this._v2);
      const S = this._support(ctx, p.x, p.z, this.pos.y + 1);
      w.pos.set(p.x, S.y !== null ? S.y : this.pos.y, p.z);
      w.vy = 0; if (w.vel) { w.vel.x = 0; w.vel.z = 0; }
      w.grounded = true; w.peakY = w.pos.y;
      if (typeof w._apply === 'function') w._apply();
      this.stats.rampPushes = (this.stats.rampPushes || 0) + 1;
      this.events.push({ t: 'ramp_push' });
    }
    // 傾斜板の出来事（events と、game.js がメッセージにする rampMsg { t, why, n }）
    _rampMsg(t, why) {
      this.events.push({ t, why: why || null });
      const m = this.rampMsg || (this.rampMsg = { t: null, why: null, n: 0 });
      m.t = t; m.why = why || null; m.n++;
    }
    // 浮いてよいか（傾斜板が閉じきった・機内を歩いている人がいない）
    _liftOk() { return !this.cabin || (this.rampPos <= 0 && !this.rampWant && !this._walkerAboard && !this.cargoBusy); }
    // game.js が毎フレーム（徒歩のプレイヤー）: 足場の上か・機内に入ったか（'boarded'）
    noteWalker(p) {
      if (!this._entry) return;
      const on = this._cabinOn && this.onPlatform(p);
      let inCab = false;
      if (on) {
        const l = this.toLocal(p.pos.x, p.pos.z), C = this.cabin;
        inCab = l.z > C.profile.edgeZ + 0.3 && p.pos.y - this.pos.y > C.profile.floorY - 0.2;
      }
      if (inCab && !this._walkerIn) {
        this.boarded++;
        this.events.push({ t: 'boarded' });
        if (typeof this.onBoarded === 'function') { try { this.onBoarded(p); } catch (e) { /* 物語の側 */ } }
      }
      this._walkerIn = inCab;
    }
    // 席から立った（game.js）: 機内にいるので 'boarded' を出さない
    noteStandUp() { this._walkerIn = true; }
    // 席 i の前に立つ所（世界）。無ければ null
    standPoint(i, out) {
      const s = this.seatStand && this.seatStand[i];
      if (!s) return null;
      return this.toWorld(this._v3.set(s.x, s.y, s.z), out || new THREE.Vector3());
    }
    // 歩いている人の前の席（席の stand から seatReach m・席の方を facing° 以内を向いている）: 席の番号か −1
    seatNear(p) {
      if (!this._cabinOn || !this.onPlatform(p)) return -1;
      const B = this.def.board, l = this.toLocal(p.pos.x, p.pos.z), ly = p.pos.y - this.pos.y;
      // 見ている向き（カメラは −Z）を機体の座標へ
      const fx = -Math.sin(p.yawAngle), fz = -Math.cos(p.yawAngle), c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const lfx = fx * c - fz * s, lfz = fx * s + fz * c;
      let best = -1, bd = Infinity;
      for (let i = 0; i < this.seatStand.length; i++) {
        const st = this.seatStand[i];
        if (!st || this.occupants[i]) continue;
        const d = Math.hypot(l.x - st.x, l.z - st.z);
        if (d > B.seatReach || Math.abs(ly - st.y) > 0.6) continue;
        const ex = st.eye ? st.eye.x - l.x : 0, ez = st.eye ? st.eye.z - l.z : 1, el = Math.hypot(ex, ez) || 1;
        if ((lfx * ex + lfz * ez) / el < Math.cos(B.facing * D2R)) continue;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    // 傾斜板・トウ・尾の扉の姿勢（rampPos を 3 つの段に分ける: 扉 0〜doorEnd・板 plateFrom〜plateTo・トウ toeFrom〜1）
    _rampPose() {
      const R = this.def.ramp, p = this.rampPos, C = this.cabin;
      const kD = smooth(0, R.doorEnd, p), kR = smooth(R.plateFrom, R.plateTo, p), kT = smooth(R.toeFrom, 1, p);
      const k = this._rampK || (this._rampK = [0, 0, 0]);
      k[0] = kD; k[1] = kR; k[2] = kT;
      this._rampPosed = p;
      const q = this._qi, ax = this._v3;
      const openDeg = C && C.ramp && typeof C.ramp.openDeg === 'number' ? C.ramp.openDeg : this.def.rampDeg;
      if (this.rampNode) { q.setFromAxisAngle(ax.set(1, 0, 0), openDeg * D2R * kR); this.rampNode.node.quaternion.copy(this.rampNode.q0).multiply(q); }
      if (this.toeNode) { const sl = C && C.toe ? num(C.toe.slide, 1.65) : 1.65; this.toeNode.node.position.copy(this.toeNode.p0); this.toeNode.node.position.z -= sl * kT; }
      if (this.doorNode) { const dd = C && C.cargoDoor ? num(C.cargoDoor.openDeg, 90) : 90; q.setFromAxisAngle(ax.set(1, 0, 0), dd * D2R * kD); this.doorNode.node.quaternion.copy(this.doorNode.q0).multiply(q); }
    }
    // 機内の GLB（vtol_interior.glb。家具・操縦席の計器・壁の内張り）: カメラが interiorDist m の中に来たら読んで root に付ける。遠くでは隠す
    _interiorStep(ctx) {
      if (!this.cabin || this.modelSource !== 'glb' || !this.assets || !ctx || !ctx.camera) { if (this.interior) this.interior.visible = false; return; }
      const cam = ctx.camera.getWorldPosition ? ctx.camera.getWorldPosition(this._v1) : null;
      if (!cam) return;
      const near = Math.hypot(cam.x - this.pos.x, cam.y - this.pos.y, cam.z - this.pos.z) < this.def.ramp.interiorDist && !this.wrecked;
      if (near && this._intState === 0) {
        const a = this.assets, file = this.def.interiorModel || 'models/vtol_interior.glb';
        const key = typeof a.resolve === 'function' ? a.resolve(file) : null;
        if (!key || typeof a.loadModel !== 'function') { this._intState = 3; return; }
        this._intState = 1;
        Promise.resolve().then(() => a.loadModel(key)).then((res) => {
          const sc = res && res.scene && res.scene.isObject3D ? res.scene : (res && res.isObject3D ? res : null);
          if (!sc || this.disposed) { this._intState = 3; return; }
          GLB_KEYS.add(key);
          const g = sc.clone(true);
          g.name = 'vtol_interior';
          g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; if (this.cockpit) o.layers.enable(1); } });
          g.visible = false;
          this.interior = g; this.root.add(g); this._intState = 2;
          Vtol.stats.interiorLoads = (Vtol.stats.interiorLoads || 0) + 1;
        }).catch(() => { this._intState = 3; });
      }
      if (this.interior) this.interior.visible = near;
    }

    // ---------- 乗り降り ----------
    enter(player, seatIndex) {
      if (this.wrecked || this.sinking) return false;
      const ok = super.enter(player, seatIndex);
      if (!ok) return false;
      if (this.seatOf(player) === 0) {
        this._showParked(false);
        this.autoT = 0; this.posHold = null; this.altHold = null; this.hdgHold = null;
        if (this.audio && typeof this.audio.prepareJet === 'function') this.audio.prepareJet();
      }
      return true;
    }
    exit(who) {
      const i = who ? this.seatOf(who) : 0;
      super.exit(who);
      if (i === 0) { this.ctl.stickX = 0; this.ctl.stickY = 0; this.ctl.climb = 0; this.ctl.boost = false; this.ctl.slow = false; this.autoT = 0; this.cancelAutoland('exit'); }
    }
    clearDriver() { super.clearDriver(); this.ctl.stickX = 0; this.ctl.stickY = 0; this.ctl.climb = 0; }

    // 操縦の入力（game.js が毎フレーム）: { stickX, stickY（−1..1）, climb（上昇 1 / 下降 −1）, boost, slow, yaw（目標の向き rad = カメラ）, pitch（カメラの上下 rad）, scheme }
    setVtolControls(o) {
      const c = this.ctl;
      c.stickX = clamp(num(o.stickX, 0), -1, 1); c.stickY = clamp(num(o.stickY, 0), -1, 1);
      c.climb = clamp(num(o.climb, 0), -1, 1); c.boost = !!o.boost; c.slow = !!o.slow;
      c.yaw = typeof o.yaw === 'number' && isFinite(o.yaw) ? o.yaw : null;
      c.pitch = num(o.pitch, 0);
      c.scheme = o.scheme === 'aim' ? 'aim' : 'easy';
      if (this.autoland && Math.hypot(c.stickX, c.stickY) > this.def.autoland.cancelStick) this.cancelAutoland('stick');
    }

    // ---------- 自動着陸 ----------
    // 降りられる所の一覧（pads: game.json の vtol.pads のうちこのレベル、heliports: citygen のヘリポート（狭いものは「狭すぎ」の判定だけ）、roads: 戦闘機の道路）
    setSpots(spots) { this.spots = spots || null; }
    // 一番近い降りられる所 { kind: 'pad' | 'road', name, x, y, z, yaw, dist, small?（もっと近いのに狭すぎたヘリポート）}、無ければ { none: true, small? }
    autolandTarget() {
      const S = this.spots, A = this.def.autoland, d = this.def;
      if (!S || this.wrecked) return null;
      const px = this.pos.x, pz = this.pos.z;
      let best = null, small = null;
      for (const p of S.pads || []) {
        const dist = Math.hypot(p.x - px, p.z - pz);
        if (dist > A.range) continue;
        const fits = Math.min(p.w, p.d) >= Math.min(d.padMinSize, d.length + A.clearMargin * 2) && Math.max(p.w, p.d) >= d.padMinSize;
        if (!fits) { if (dist < A.padRange && (!small || dist < small.dist)) small = { name: p.name, dist }; continue; }
        if (!best || dist < best.dist) best = { kind: 'pad', name: p.name, x: p.x, y: p.y, z: p.z, yaw: (p.w >= p.d ? 0 : 90) * D2R + (p.yaw || 0) * D2R, dist, id: p.id };
      }
      for (const r of S.roads || []) {
        const a = (r.yaw || 0) * D2R, fx = Math.sin(a), fz = Math.cos(a);
        const L = (r.length || 1000) / 2;
        const s = clamp((px - r.x) * fx + (pz - r.z) * fz, -L + 40, L - 40);
        const x = r.x + fx * s, z = r.z + fz * s, dist = Math.hypot(x - px, z - pz);
        if (dist > A.range) continue;
        // 胴体を道路に直角（翼を道路に沿わせる）。道の両側の街灯・木に翼が当たらない
        if (!best || dist < best.dist) best = { kind: 'road', name: r.name || '道路', x, y: null, z, yaw: a + Math.PI / 2, dist, road: r, s };
      }
      if (small && best && small.dist >= best.dist) small = null;
      if (!best) return { none: true, small };
      if (small) best.small = small;
      return best;
    }
    startAutoland(ctx) {
      const t = this.autolandTarget();
      if (!t || t.none) { this.stats.refused++; this.events.push({ t: 'autoland_none', small: t && t.small ? t.small.name : null }); return false; }
      if (t.small) { this.stats.refused++; this.events.push({ t: 'autoland_small', name: t.small.name, to: t.name }); }
      this.autoland = { kind: t.kind, name: t.name, x: t.x, y: t.y, z: t.z, yaw: t.yaw, road: t.road || null, s: t.s || 0, phase: 'approach', tries: 0, checked: false, holdT: 0 };
      if (this.autoland.y == null) this.autoland.y = this._groundAt(ctx, t.x, t.z, 600);
      this.events.push({ t: 'autoland', kind: t.kind, name: t.name });
      return true;
    }
    cancelAutoland(why) {
      if (!this.autoland) return;
      const k = this.autoland.kind;
      this.autoland = null;
      this.posHold = null; this.altHold = null; this.hdgHold = null;
      this.events.push({ t: 'autoland_off', why: why || 'cancel', kind: k });
    }
    _groundAt(ctx, x, z, yRef) {
      const S = this._support(ctx, x, z, yRef);
      return S.y !== null ? S.y : (S.water !== null ? S.water : 0);
    }
    // 機体の箱の広さ（翼幅 + 余白 × 全長 + 余白）に、立てる面の clearHeight m 上まで何も無いか
    _spotClear(ctx, x, y, z, yaw) {
      const A = this.def.autoland, hw = this.def.width / 2 + A.clearMargin, hl = this.def.length / 2 + A.clearMargin;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const ex = Math.abs(hw * c) + Math.abs(hl * s), ez = Math.abs(hw * s) + Math.abs(hl * c);
      const out = this._cands; out.length = 0;
      const nav = ctx && ctx.nav;
      if (nav && typeof nav.itemsIn === 'function') nav.itemsIn(x - ex, z - ez, x + ex, z + ez, out);
      if (this.collider) this.collider.query(x - ex, z - ez, x + ex, z + ez, out);
      for (const b of out) {
        if (b.f & 1) continue;
        const top = b.k === 1 ? Math.max(b.y0, b.y1, b.ry0 || 0, b.ry1 || 0) : b.y1;
        if (top < y + 0.6 || b.y0 > y + A.clearHeight) continue;
        // 回した長方形と箱（箱の角を機体の座標へ）
        const cx = (b.x0 + b.x1) / 2 - x, cz = (b.z0 + b.z1) / 2 - z, bx = (b.x1 - b.x0) / 2, bz = (b.z1 - b.z0) / 2;
        const lx = cx * c - cz * s, lz = cx * s + cz * c;
        const ex2 = Math.abs(bx * c) + Math.abs(bz * s), ez2 = Math.abs(bx * s) + Math.abs(bz * c);
        if (Math.abs(lx) < hw + ex2 && Math.abs(lz) < hl + ez2) return false;
      }
      // 止めてある乗り物（ヘリ・車・ほかの VTOL・opt-in の戦闘機）: 足元の囲み（aabb）が機体の箱の広さに入り、高さが重なれば降りない
      const others = (ctx && ctx.vehicles) || [];
      for (let k = 0; k < others.length; k++) {
        const o = others[k];
        if (o === this || o.disposed || o.sunk || o.carrier || typeof o.aabb !== 'function') continue;
        const bb = typeof o.spanAabb === 'function' ? o.spanAabb() : o.aabb();
        if (!bb) continue;
        const by = bb.y != null ? bb.y : o.pos.y;
        if (by + (bb.h || 2) < y + 0.3 || by > y + A.clearHeight) continue;
        const cx = bb.x - x, cz = bb.z - z, bx = bb.w / 2, bz = bb.d / 2;
        const lx = cx * c - cz * s, lz = cx * s + cz * c;
        const ex2 = Math.abs(bx * c) + Math.abs(bz * s), ez2 = Math.abs(bx * s) + Math.abs(bz * c);
        if (Math.abs(lx) < hw + ex2 && Math.abs(lz) < hl + ez2) { this.stats.spotVehicle = (this.stats.spotVehicle || 0) + 1; return false; }
      }
      return true;
    }

    // ---------- ダメージ・墜落 ----------
    _explode(ctx) {
      if (this._cargo) MR.VtolCargo.release(this, null, 'destroyed'); // V2c: 積んだ車は外れて機体の速さで落ちる残骸（2 回目の爆発なし。onHostDestroyed 'wreck'）
      this._airKill = !this.grounded && this.agl > this.def.airKillAgl && !this._crashing;
      if (this._parkedOn) this._showParked(false);
      const vx = this.vel.x, vy = this.vel.y, vz = this.vel.z, air = !this.grounded;
      super._explode(ctx);
      this.detachDebris(Vtol.DEBRIS_NODES, ctx);
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.engineOn = false; this.spool = 0; this.autoland = null;
      const W = this.def.wreck;
      this.wreckFall = air ? { vx: vx * W.keepVel, vy: Math.min(vy, W.maxUp), vz: vz * W.keepVel, spin: (Math.random() < 0.5 ? -1 : 1) * W.spin } : null;
      this.vel.set(0, 0, 0);
      this._apply();
    }
    _explodeFxFallback(c) { if (this.fx && typeof this.fx.explosion === 'function') this.fx.explosion(c, 12, 2); }
    _impactFxFallback(c) { if (this.fx && typeof this.fx.explosion === 'function') this.fx.explosion(c, 8, 1.2); }
    _crash(kind, speed, ctx, box) {
      if (this.wrecked) return;
      this.crash = { kind, speed: +speed.toFixed(1), t: +this.time.toFixed(2), x: +this.pos.x.toFixed(1), y: +this.pos.y.toFixed(1), z: +this.pos.z.toFixed(1) };
      if (box) this.crash.box = [box.x0, box.y0, box.z0, box.x1, box.y1, box.z1].map((v) => +v.toFixed(1));
      this.stats.crashes++;
      this.events.push({ t: 'crash', kind, speed });
      this.health = 0;
      this._crashing = true;
      try { this._explode(ctx); } finally { this._crashing = false; }
      if (kind === 'water' && this.audio && this.audio.splash) this.audio.splash(this.center(this._v1), true);
    }
    _updateWreck(dt, ctx) {
      const wf = this.wreckFall;
      if (wf) {
        const W = this.def.wreck;
        wf.vy = Math.max(-W.maxFall, wf.vy - this.def.wreckGravity * dt);
        const k = Math.max(0, 1 - dt * W.drag);
        wf.vx *= k; wf.vz *= k;
        this.roll += wf.spin * dt;
        const y0 = this.pos.y;
        // 横は建物の箱に入らない（中心だけ）
        const coll = this.collider;
        if (coll && (wf.vx || wf.vz) && coll.inside(this.pos.x + wf.vx * dt, this.pos.y + PIVOT_Y, this.pos.z + wf.vz * dt)) { wf.vx *= -0.2; wf.vz *= -0.2; }
        this.pos.x += wf.vx * dt; this.pos.y += wf.vy * dt; this.pos.z += wf.vz * dt;
        const S = this._support(ctx, this.pos.x, this.pos.z, y0 + 0.5);
        if (S.y !== null && this.pos.y <= S.y) {
          const vy = -wf.vy;
          this.pos.y = S.y; this.roll = clamp(this.roll, -0.25, 0.25); this.pitch = 0.04;
          this._updateQuat();
          this.grounded = true; this.airborne = false;
          const c = this.center(this._v1);
          this._impactFx(c, ctx, vy);
          this.wreckFall = null;
          this._sound('vehicle_impact', 1, c, { refDistance: 15, maxDistance: 400 });
        } else if (S.y === null && S.water !== null && this.pos.y <= S.water) {
          const vy = -wf.vy;
          if (this.audio && this.audio.splash) this.audio.splash(this.center(this._v1), true);
          if (ctx && ctx.crashFx) this._impactFx(this._v1.set(this.pos.x, S.water + 0.3, this.pos.z), ctx, vy);
          else if (this.fx && this.fx.splash) this.fx.splash(this._v1.set(this.pos.x, S.water + 0.05, this.pos.z), 6, 'crash');
          this.wreckFall = null; this.sunk = true; this.root.visible = false;
        }
        if (this.pos.y < -60) { this.wreckFall = null; this.sunk = true; this.root.visible = false; }
        this._updateQuat();
        this._apply();
      }
      this.respawnTimer -= dt;
      this.smokeTimer -= dt;
      if (this.fx && !this.sunk && !this._fireRec && this.smokeTimer <= 0 && this.respawnTimer > this.def.respawn * 0.2) {
        this.smokeTimer = this.def.wreckSmokeEvery * (0.8 + Math.random() * 0.4);
        const p = this.toWorld(this._v3.set((Math.random() - 0.5) * 10, 3, (Math.random() - 0.5) * 12), this._v2);
        if (typeof this.fx.blackSmoke === 'function') this.fx.blackSmoke(p, 3 + Math.random()); else if (this.fx.smoke) this.fx.smoke(p, 2);
      }
      this._updateDetached(dt);
      if (this.respawnTimer <= 0 && !this.netControlled) {
        const pl = ctx && ctx.player;
        const far = !pl || Math.hypot(pl.pos.x - this.spawnPos.x, pl.pos.z - this.spawnPos.z) > this.def.respawnClear;
        if (far || this.respawnTimer < -this.def.respawn) this.respawn();
      }
    }

    respawn() {
      // V2c: 家へ移す前に積んだ車を外す（車も家へ新品で）
      if (this._cargo) { const car = MR.VtolCargo.release(this, null, 'respawn'); if (car && !car.disposed) car.respawn(); }
      super.respawn();
      this.vel.set(0, 0, 0); this.pitch = 0; this.roll = 0; this.yawRate = 0;
      this.theta = 90; this.spool = 0; this.engineOn = false; this.thrustUse = 0;
      this.grounded = true; this.airborne = false; this.flight = 'hover';
      this.spdHold = 0; this.hdgHold = null; this.altHold = null; this.posHold = null; this._transT = 0;
      this.gearDown = true; this.gearPos = 1; this.rampPos = 0; this.rampWant = false; this._rampInit = false; this.levelled = true; this._sweepT = 0;
      this._cabinOn = false; this._walkerAboard = false; this._walkerIn = false;
      this.autoland = null; this.crash = null; this.wreckFall = null; this.autoT = 0; this.cantLand = 0;
      this.flareCount = this.def.flares.count; this._flareT = 0; this.incoming = null;
      this.armPos = 0; this.armWant = false; this._armT = 0; this.gunAim.yaw = 0; this.gunAim.pitch = 0; this.gunTask = null; this.missileTask = null; this.firing = false;
      this.script = null;
      this._refill();
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this._updateQuat();
      this._animate(0, true);
      this._apply();
      this.events.push({ t: 'respawn' });
    }

    // ---------- 更新 ----------
    update(dt, ctx) {
      this.time += dt;
      if (this.disposed) return;
      if (this.events.length > 64) this.events.splice(0, this.events.length - 32); // 誰も読まない機体（無人・物語の機体）の出来事を溜めない
      if (this.wrecked) { this._cabinOn = false; this._walkerAboard = false; this.rampWant = false; if (this.interior) this.interior.visible = false; this._updateWreck(dt, ctx); return; }
      const d = this.def;
      const pilot = !!this.driver;
      // 止めてある（無人・地上・エンジン停止）: 何もしない（まとめた形）
      this._armStep(dt);
      this._rampStep(dt, ctx);
      if (this._cargoOn()) MR.VtolCargo.step(this, dt, ctx); // V2c: 車を積む・降ろす
      this._interiorStep(ctx);
      if (!pilot && this.grounded && !this.engineOn && this.spool <= 0 && !this.autoland && !this.script && this.armPos <= 0) {
        // 傾斜板が動いている間は元のノード（止まったら開いた / 閉じた姿勢のまとめた形）
        if (this.rampPos > 0 && this.rampPos < 1) { if (this._parkedOn) this._showParked(false); this._animate(0, true); this._apply(); }
        else if (this._rampPosed !== this.rampPos && this.modelSource !== 'glb') { this._animate(0, true); this._apply(); } // コードの機体: 開いた / 閉じた姿勢に（止めてある機体は最初から開いている = rampPos 1 に飛ぶ）
        else if (this.modelSource === 'glb' && (!this._parkedOn || this._parked.key !== this._parkKey())) { this._animate(0, true); this._showParked(true); }
        this._stopEngine();
        this._rearmStep(dt);
        if (this._cargo) MR.VtolCargo.follow(this, ctx);
        return;
      }
      // エンジン: 操縦士がいるか空中なら回す（物語の自動操縦も）
      const run = pilot || !this.grounded || !!this.autoland || !!this.script;
      if (run) { this.engineOn = true; this.spool = Math.min(1, this.spool + dt / d.spinUpTime); }
      else { this.spool = Math.max(0, this.spool - dt / d.spinDownTime); if (this.spool <= 0) this.engineOn = false; }
      if (!pilot && !this.grounded && !this.script) this.autoT += dt; else if (pilot || this.script) this.autoT = 0;
      // 地面・建物の先読み（easy の巡航・自動着陸。0.25 秒ごと）
      this._floorT -= dt;
      if (this._floorT <= 0) { this._floorT = d.avoid.every; this._floor = this._floorAhead(); }
      if (this.autoland) this._autolandFrame(ctx, dt);
      // 1/60 秒以下に刻む
      const n = Math.max(1, Math.ceil(dt * 60 - 1e-6)), h = dt / n;
      for (let i = 0; i < n && !this.wrecked; i++) this._step(h, ctx, pilot);
      if (this.wrecked) return;
      this.speed = this.vel.length();
      if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;
      if (this.pos.y > this.stats.maxAlt) this.stats.maxAlt = this.pos.y;
      if (this.cantLand > 0) this.cantLand = Math.max(0, this.cantLand - dt);
      // フレアは空中でも reloadTime 秒に 1 つ戻る（ヘリと同じ）
      if (this.flareCount < d.flares.count) { this._flareT += dt; if (this._flareT >= d.flares.reloadTime) { this._flareT = 0; this.flareCount++; } } else this._flareT = 0;
      this._rearmStep(dt);
      this._wash(dt);
      this._animate(dt, false);
      // 動く部品が止まった姿勢（ナセル 0° / 90°・脚が上 / 下）ではまとめた形（姿勢ごとに共有。GLB の 67 → 8 メッシュ）、動いている間は元のノード
      //   武装は しまっている（armPos 0）か出しきった（armPos 1 = 銃の外をまとめた形）とき。扉・ラックが動いている間は元のノード
      const steady = (this.theta === 0 || this.theta === 90) && (this.gearPos === 0 || this.gearPos === 1) && (this.armPos === 0 || this.armPos === 1) && (this.rampPos === 0 || this.rampPos === 1);
      if (steady && this.modelSource === 'glb') { if (!this._parkedOn || this._parked.key !== this._parkKey()) this._showParked(true); }
      else if (this._parkedOn) this._showParked(false);
      this._apply();
      if (this._cargo) MR.VtolCargo.follow(this, ctx); // 積んだ車を機体に付けて置く（機体が動いた後）
      this._engineAudio(dt);
    }

    // 速度の向きの前（lookTime 秒）の一番高い箱の上面（HeliCollider。無ければ −∞）
    _floorAhead() {
      const A = this.def.avoid, coll = this.collider;
      if (!coll || this.grounded) return -Infinity;
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const L = Math.max(A.step, vh * A.lookTime), n = Math.ceil(L / A.step);
      const ux = vh > 1 ? this.vel.x / vh : Math.sin(this.yaw), uz = vh > 1 ? this.vel.z / vh : Math.cos(this.yaw);
      let m = -Infinity;
      // 越えられる速さの上限: 先の箱の上 + clear（ホバーは × hoverClearK）まで climb m/s で上がれる速さ（_vCapC / _vCapH。かんたんが速さを絞る）
      this._vCapC = Infinity; this._vCapH = Infinity;
      const y = this.pos.y;
      for (let i = 0; i <= n; i++) {
        const x = this.pos.x + ux * A.step * i, z = this.pos.z + uz * A.step * i;
        let t = coll.maxTop(x, z, A.radius);
        if (this.city) { const g = this.city.groundAt(x, z); t = Math.max(t, g.water !== null ? g.water : g.y); }
        m = Math.max(m, t);
        const dist = Math.max(0, A.step * i - A.radius);
        const dhC = t + A.clear - y, dhH = t + A.clear * A.hoverClearK - y;
        if (dhC > 0) this._vCapC = Math.min(this._vCapC, Math.max(A.vMin, dist * A.climb / dhC));
        if (dhH > 0) this._vCapH = Math.min(this._vCapH, Math.max(A.vMin, dist * A.climb / dhH));
      }
      return m;
    }

    // 自動着陸（1 フレームに 1 回）: 目標の飛び方・速度・高さを決める（_control が使う）
    _autolandFrame(ctx, dt) {
      const A = this.def.autoland, ap = this.autoland, d = this.def;
      const dx = ap.x - this.pos.x, dz = ap.z - this.pos.z, dist = Math.hypot(dx, dz);
      // 道路: 近づいたら機体の箱の広さが空いているかを確かめる（読み込んだ当たり判定で）。ふさがっていれば道に沿ってずらす
      if (!ap.checked && ap.kind === 'road' && dist < A.checkDist) {
        ap.checked = true;
        let ok = false;
        const r = ap.road, a = (r.yaw || 0) * D2R, fx = Math.sin(a), fz = Math.cos(a), L = (r.length || 1000) / 2;
        for (let k = 0; k <= A.roadTries && !ok; k++) {
          const s = clamp(ap.s + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * A.roadStep, -L + 30, L - 30);
          const x = r.x + fx * s, z = r.z + fz * s, y = this._groundAt(ctx, x, z, 600);
          for (const yaw of [ap.yaw, ap.yaw + Math.PI / 2]) if (!ok && this._spotClear(ctx, x, y, z, yaw)) { ok = true; ap.x = x; ap.z = z; ap.y = y; ap.yaw = yaw; ap.s = s; }
        }
        if (!ok) { this.events.push({ t: 'autoland_blocked', name: ap.name }); this.cancelAutoland('blocked'); return; }
      }
      if (!ap.checked && ap.kind === 'pad' && dist < A.checkDist) {
        ap.checked = true;
        if (!this._spotClear(ctx, ap.x, ap.y, ap.z, ap.yaw)) { this.events.push({ t: 'autoland_blocked', name: ap.name }); this.cancelAutoland('blocked'); return; }
      }
      ap.dist = dist;
      if (ap.phase === 'approach') {
        // 止まれる距離（decel で減速）より近い・ convDist より近い → 減速して真上へ
        const vh = Math.hypot(this.vel.x, this.vel.z);
        if (dist < Math.max(A.convDist * 0.25, vh * vh / (2 * A.decel) + 60) || (this.flight === 'hover' && dist < 200)) ap.phase = 'convert';
      }
      if (ap.phase === 'convert' && dist < A.capture && Math.hypot(this.vel.x, this.vel.z) < A.holdSpeed) { ap.phase = 'hold'; ap.holdT = 0; }
      if (ap.phase === 'hold') { ap.holdT += dt > 0 ? dt : 1 / 60; if (Math.abs(wrap(ap.yaw - this.yaw)) < A.alignAngle * D2R && ap.holdT > A.holdTime) ap.phase = 'descend'; }
    }

    // 目標（1/60 秒以下の 1 歩ごと）: { tvx, tvz（水平の目標の速度）, vyT, yawT（ホバーの向き）, mode }
    _control(h, ctx, pilot) {
      const d = this.def, c = this.ctl, out = this._cmd || (this._cmd = { tvx: 0, tvz: 0, vyT: 0, yawT: null, spd: 0, hdg: 0 });
      const fwx = Math.sin(this.yaw), fwz = Math.cos(this.yaw);
      const vh = Math.hypot(this.vel.x, this.vel.z), vf = this.vel.x * fwx + this.vel.z * fwz;
      const velHdg = vh > 3 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
      const y = this.pos.y;
      const ap = this.autoland;
      out.yawT = null;
      if (ap) {
        const A = d.autoland;
        const dx = ap.x - this.pos.x, dz = ap.z - this.pos.z, dist = Math.hypot(dx, dz);
        const safe = Math.max(ap.y + A.approachAgl, this._floor + d.avoid.clear);
        if (ap.phase === 'approach') {
          this.flight = 'cruise';
          this.spdHold = Math.max(this.spdHold, A.approachSpeed);
          if (this.spdHold > A.approachSpeed) this.spdHold = Math.max(A.approachSpeed, this.spdHold - d.spdRate * h);
          out.spd = this.spdHold; out.hdg = Math.atan2(dx, dz);
          out.vyT = clamp((safe - y) * d.cruiseVyK, -Math.max(4, vh * Math.sin(d.diveAngle * D2R)), Math.max(4, vh * Math.sin(d.climbAngle * D2R)));
          out.tvx = Math.sin(out.hdg) * out.spd; out.tvz = Math.cos(out.hdg) * out.spd;
        } else {
          // 減速して真上へ（止まれる速さ √(2 a d)）
          const vT = Math.min(A.approachSpeed, Math.sqrt(2 * A.decel * Math.max(0, dist - A.capture * 0.5)) + 0.2);
          if (vT < d.convFrom) this.flight = 'hover';
          else this.flight = 'cruise';
          this.spdHold = vT;
          const k = dist > 1e-3 ? vT / dist : 0;
          out.tvx = dx * k; out.tvz = dz * k; out.spd = vT; out.hdg = Math.atan2(dx, dz);
          if (ap.phase === 'hold' || ap.phase === 'descend' || dist < 30) {
            const pk = 0.5;
            out.tvx = clamp(dx * pk, -A.finalSpeed * 2, A.finalSpeed * 2); out.tvz = clamp(dz * pk, -A.finalSpeed * 2, A.finalSpeed * 2);
            out.yawT = ap.yaw;
          } else if (this.flight === 'hover') out.yawT = Math.atan2(dx, dz);
          if (ap.phase === 'descend') {
            const agl = y - ap.y;
            out.vyT = agl > A.slowAgl ? -A.descendRate : -A.slowRate;
          } else out.vyT = clamp((Math.max(ap.y + A.hoverAgl, Math.min(safe, y)) - y) * 0.8, -A.descendRate, d.climbRate);
          if (ap.phase !== 'descend') out.vyT = Math.max(out.vyT, (this._floor + d.avoid.clear * 0.5 - y) * 0.8);
        }
        return out;
      }
      // 物語の自動操縦（hoverAt / followPath / orbit）: 操縦士がいてもいなくても、その入力の代わり
      if (this.script) return this._scriptCmd(h, out);
      if (!pilot) {
        // 無人で浮いている: その場でホバリング（autoHoverTime 秒）→ まっすぐ降りる
        this.flight = 'hover';
        if (!this.posHold) this.posHold = { x: this.pos.x, z: this.pos.z };
        out.tvx = clamp((this.posHold.x - this.pos.x) * d.posHoldK, -d.posHoldMax, d.posHoldMax);
        out.tvz = clamp((this.posHold.z - this.pos.z) * d.posHoldK, -d.posHoldMax, d.posHoldMax);
        out.vyT = this.autoT > d.unmannedHold ? -Math.min(d.unmannedDescend, d.descendRate) : 0;
        return out;
      }
      const easy = c.scheme !== 'aim';
      if (this.flight === 'hover') {
        const sx = c.stickX, sy = c.stickY;
        if (Math.abs(sx) > 0.05 || Math.abs(sy) > 0.05) {
          this.posHold = null;
          const f = sy >= 0 ? sy * d.maxSpeedHover : sy * d.maxBackHover, r = sx * d.maxStrafeHover;
          // 右 = −X（左舷が +X）
          out.tvx = fwx * f - Math.cos(this.yaw) * r; out.tvz = fwz * f + Math.sin(this.yaw) * r;
          // 前へ倒し続けて速くなった → 巡航へ
          // 巡航に入ったら、スティックを一度戻すまで縦（上り）は使わない（_latch。前へ倒したまま上り続けない）
          if (sy > 0.85 && vf > d.maxSpeedHover * d.transSpeedK) { this._transT += h; if (this._transT >= d.transHold) { this.flight = 'cruise'; this.spdHold = d.cruiseSpeed; this.hdgHold = this.yaw; this.altHold = y; this._transT = 0; this._latch = true; } }
          else this._transT = 0;
        } else {
          this._transT = 0;
          if (!this.posHold && vh < 1.5) this.posHold = { x: this.pos.x, z: this.pos.z };
          if (this.posHold) {
            out.tvx = clamp((this.posHold.x - this.pos.x) * d.posHoldK, -d.posHoldMax, d.posHoldMax);
            out.tvz = clamp((this.posHold.z - this.pos.z) * d.posHoldK, -d.posHoldMax, d.posHoldMax);
          } else { out.tvx = 0; out.tvz = 0; }
        }
        if (Math.abs(c.climb) > 0.05) { this.altHold = null; out.vyT = c.climb > 0 ? c.climb * d.climbRate : c.climb * d.descendRate; }
        else {
          if (this.altHold === null && Math.abs(this.vel.y) < 0.6) this.altHold = y;
          out.vyT = this.altHold === null ? 0 : clamp((this.altHold - y) * d.altHoldK, -2, 2);
        }
        out.yawT = c.yaw;
        out.spd = Math.hypot(out.tvx, out.tvz); out.hdg = out.spd > 0.5 ? Math.atan2(out.tvx, out.tvz) : this.yaw;
        // かんたん: 動いている間は前の建物の上（avoid.clear × hoverClearK m）より下へ行かない（巡航と同じ先読み）
        if (easy && vh > 3) {
          const fl = this._floor + d.avoid.clear * d.avoid.hoverClearK;
          if (y < fl + 10) out.vyT = Math.max(out.vyT, (fl - y) * 0.6 + 1.5);
          const cap = this._vCapH;
          if (out.spd > cap) { const k = cap / out.spd; out.tvx *= k; out.tvz *= k; out.spd = cap; }
        }
      } else {
        // 巡航: 速さ（加速 / 減速）・向き・上下
        if (c.boost) this.spdHold = Math.min(d.maxSpeed, this.spdHold + d.spdRate * h);
        if (c.slow) this.spdHold = Math.max(0, this.spdHold - d.spdRate * h);
        if (!easy && Math.abs(c.stickY) > 0.1) this.spdHold = clamp(this.spdHold + c.stickY * d.spdRate * h, 0, d.maxSpeed);
        if (this.spdHold < d.convFrom) { this.flight = 'hover'; this.posHold = null; this.altHold = null; }
        let hdg, vyT;
        if (this._latch && Math.abs(c.stickY) < 0.08) this._latch = false;
        if (easy) {
          // 右へ倒す = 右へ（向きの角は左回りに増える: 前 (sin, cos)）
          if (Math.abs(c.stickX) > 0.08) { this._turning = true; this.hdgHold = velHdg - c.stickX * d.turnLead * D2R; }
          else if (this._turning || this.hdgHold === null) { this._turning = false; this.hdgHold = velHdg; }
          hdg = this.hdgHold;
          if (Math.abs(c.stickY) > 0.08 && !(this._latch && c.stickY > 0)) { this.altHold = null; vyT = Math.max(vh, 20) * Math.sin((c.stickY > 0 ? c.stickY * d.climbAngle : c.stickY * d.diveAngle) * D2R); }
          else {
            if (this.altHold === null) this.altHold = y + this.vel.y * d.altLead;
            vyT = clamp((this.altHold - y) * d.cruiseVyK, -10, 10);
          }
          // 地面・建物の先読み（avoid.clear m 上より下へは行かない）
          const fl = this._floor + d.avoid.clear;
          if (y < fl + 20) { vyT = Math.max(vyT, (fl - y) * 0.6 + 2); if (this.altHold !== null && this.altHold < fl) this.altHold = fl; }
          this._spdCap = this._vCapC; // 先の建物を越えられる速さまで（spdHold は変えない = 越えたら戻る）
        } else {
          hdg = c.yaw !== null ? c.yaw : this.yaw;
          vyT = Math.max(vh, 20) * Math.sin(clamp(c.pitch, -d.diveAngle * D2R, d.climbAngle * D2R));
          if (Math.abs(c.climb) > 0.05) vyT = c.climb > 0 ? c.climb * d.climbRate : c.climb * d.descendRate;
        }
        const spd = easy && this._spdCap < this.spdHold ? Math.max(this._spdCap, 0) : this.spdHold;
        this._spdCap = Infinity;
        out.spd = spd; out.hdg = hdg; out.vyT = vyT;
        out.tvx = Math.sin(hdg) * spd; out.tvz = Math.cos(hdg) * spd;
        out.yawT = hdg;
      }
      // 上限の高さ・地図の端
      if (y > d.maxAltitude - 50) out.vyT = Math.min(out.vyT, (d.maxAltitude - y) * 0.3);
      const city = this.city;
      if (city) {
        const m = d.boundsMargin, cx = (city.minX + city.maxX) / 2, cz = (city.minZ + city.maxZ) / 2;
        const out0 = this.pos.x < city.minX + m || this.pos.x > city.maxX - m || this.pos.z < city.minZ + m || this.pos.z > city.maxZ - m;
        if (out0) {
          const toC = Math.atan2(cx - this.pos.x, cz - this.pos.z);
          if (this.flight === 'cruise') { const dd = wrap(out.hdg - toC); if (Math.abs(dd) > Math.PI / 2) { out.hdg = toC; this.hdgHold = toC; out.tvx = Math.sin(toC) * out.spd; out.tvz = Math.cos(toC) * out.spd; out.yawT = toC; } }
          else {
            const ox = this.pos.x < city.minX + m ? 1 : this.pos.x > city.maxX - m ? -1 : 0, oz = this.pos.z < city.minZ + m ? 1 : this.pos.z > city.maxZ - m ? -1 : 0;
            if (ox && out.tvx * ox < 0) out.tvx = 0;
            if (oz && out.tvz * oz < 0) out.tvz = 0;
          }
        }
      }
      return out;
    }

    // 物理の 1 歩（h ≤ 1/60 秒）
    _step(h, ctx, pilot) {
      const d = this.def;
      // 掃引の始まり = この歩の前の姿勢と位置（向き・傾きもこの歩で変わるので、変える前に取る。以前は新しい向きで前の位置から掃引し、
      //   回った翼端の球が箱に入ってもそのまま = 入った球は rayBox が外から入る点を返さないので抜けられた。V9 の 30 fps で塔の角）
      this._hullWorld(this._s0);
      const cmd = this._control(h, ctx, pilot);
      // ナセル: 前への速さで（失速しそうなら速く戻す）
      const fwx = Math.sin(this.yaw), fwz = Math.cos(this.yaw);
      const vf = this.vel.x * fwx + this.vel.z * fwz;
      let thT = 90 * clamp((d.convTo - vf) / (d.convTo - d.convFrom), 0, 1);
      if (this.grounded) thT = 90;
      let rate = d.podRate;
      if (vf < d.stallSpeed && this.theta < d.minHoverTilt + 5 && thT > this.theta) rate *= 2;
      this.theta += clamp(thT - this.theta, -rate * h, rate * h);
      const th = this.theta * D2R, w = Math.sin(th), cw = Math.cos(th);
      const spool = this.spool;
      const lift = spool >= d.liftSpool ? 1 : spool / d.liftSpool * 0.6;
      // 翼の揚力（前の速さ）と上限
      const V = this.vel.length();
      const Lcap = Math.min(d.gLimit, d.maneuver.maxG || d.gLimit) * G;
      const sf = smooth(d.stallSpeed - d.stallBand, d.stallSpeed, Math.max(0, vf));
      const Lw = Math.min(Lcap, G * (Math.max(0, vf) / d.stallSpeed) * (Math.max(0, vf) / d.stallSpeed)) * (0.35 + 0.65 * sf);
      this.stall = !this.grounded && w < 0.3 && sf < 0.98 && vf < d.stallSpeed ? 1 : 0;
      const Tv = d.thrustHover * G * w * lift; // ナセルの上向きの推力（上限）
      // 上下
      let vyT = cmd.vyT;
      const agl = this.agl;
      if (vyT < 0 && agl < d.groundEffect && !this.autoland) vyT = Math.max(vyT, -Math.max(d.touchdownSpeed, d.descendRate * agl / d.groundEffect));
      if (this.autoland && this.autoland.phase === 'descend' && vyT < 0 && agl < 2.5) vyT = Math.max(vyT, -d.touchdownSpeed);
      // 上下の加速の上限: ホバー vAccel / vBrake、巡航（翼）cruiseVAccel（w で混ぜる）
      const ka = (Math.abs(vyT) < Math.abs(this.vel.y) && vyT * this.vel.y >= 0 ? d.vBrake : d.vAccel) * w + d.cruiseVAccel * (1 - w);
      const aUpReq = G + clamp((vyT - this.vel.y) * 2, -ka, ka);
      const aUp = this.grounded && !(vyT > 0.1 && Lw + Tv > G * 1.02) ? G : clamp(aUpReq, 0, Lw + Tv);
      const wingUse = Math.min(aUp, Lw);
      this.thrustUse = Tv > 0 ? clamp((aUp - wingUse) / (d.thrustHover * G), 0, 1) : 0;
      // 水平: ホバーの制御（目標の速度へ）と巡航の制御（速さ・向き）を w で混ぜる
      let ax = 0, az = 0, aLat = 0, aF = 0;
      if (!this.grounded) {
        const tvx = cmd.tvx, tvz = cmd.tvz;
        // ホバー
        let hx = (tvx - this.vel.x) * d.hoverGain, hz = (tvz - this.vel.z) * d.hoverGain;
        const opp = this.vel.x * hx + this.vel.z * hz < 0;
        const hcap = (opp ? d.hoverBrake : d.hoverAccel) * lift;
        const hl = Math.hypot(hx, hz);
        if (hl > hcap) { hx *= hcap / hl; hz *= hcap / hl; }
        // 巡航（速度の向き = 経路。遅いときは機首の向き）
        const vh = Math.hypot(this.vel.x, this.vel.z);
        const ux = vh > 3 ? this.vel.x / vh : fwx, uz = vh > 3 ? this.vel.z / vh : fwz;
        const drag = this.cd0 * vh * vh * (1 + (this.def.arm.drag - 1) * this.armPos); // 武装を出している間は抗力 × arm.drag
        const tf = d.thrustCruise * G * cw * spool;
        aF = clamp((cmd.spd - vh) * d.speedK, -(drag + 2.5), tf - drag);
        const hErr = wrap(cmd.hdg - Math.atan2(ux, uz));
        const latCap = Math.sqrt(Math.max(0, Lcap * Lcap - wingUse * wingUse)) * (0.35 + 0.65 * sf);
        aLat = clamp(hErr * d.turnK * Math.max(vh, 10), -latCap, latCap);
        // 右へ曲がる（hErr > 0 = 時計回り）: 横の向き (uz, −ux)
        const cx = ux * aF + uz * aLat, cz = uz * aF - ux * aLat;
        ax = w * hx + (1 - w) * cx; az = w * hz + (1 - w) * cz;
        // 巡航の部分には抗力が入っている。ホバーの部分にも少しの抗力（速さを保たない）
        ax -= w * this.cd0 * vh * this.vel.x * 0.5; az -= w * this.cd0 * vh * this.vel.z * 0.5;
      }
      this._acc.set(ax, aUp - G, az);
      const gl = Math.hypot(wingUse, (1 - w) * aLat) / G + (aUp - wingUse) / G * 0;
      this.gload += (Math.max(gl, aUp / G) - this.gload) * Math.min(1, h * 8);
      if (this.gload > this.stats.maxG) this.stats.maxG = this.gload;
      // 向き: ホバーは目標の向き、巡航は速度の向き
      {
        const vh = Math.hypot(this.vel.x, this.vel.z);
        const velHdg = vh > 3 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
        let rH = 0;
        if (cmd.yawT !== null && cmd.yawT !== undefined && !this.grounded) rH = clamp(wrap(cmd.yawT - this.yaw) * d.yawFollow, -d.maxYawRate * D2R, d.maxYawRate * D2R);
        const rC = vh > 3 ? clamp(wrap(velHdg - this.yaw) * 2 + (aLat / Math.max(vh, 10)), -0.8, 0.8) : rH;
        const rT = this.grounded ? 0 : w * rH + (1 - w) * rC;
        const ya = d.yawAccel * D2R * h * (w < 0.5 ? 4 : 1);
        this.yawRate += clamp(rT - this.yawRate, -ya, ya);
        if (this.grounded) this.yawRate = 0;
        this.yaw = wrap(this.yaw + this.yawRate * h);
      }
      // 速度・位置（地上なら止めておく。離陸は上向きが重さを超えたとき）
      if (this.grounded) {
        this.vel.set(0, 0, 0);
        if (aUp > G + 0.05 && spool >= d.liftSpool && this._liftOk()) { this.grounded = false; this.airborne = true; this.vel.y = (aUp - G) * h; this.events.push({ t: 'takeoff' }); this.posHold = null; this.altHold = null; }
      } else {
        this.vel.x += ax * h; this.vel.y += (aUp - G) * h; this.vel.z += az * h;
      }
      // 見た目の傾き（ホバーは加速度、巡航はバンクと経路角）
      const kk = Math.min(1, h * 6);
      this._aSm.x += (ax - this._aSm.x) * kk; this._aSm.z += (az - this._aSm.z) * kk;
      let pT = 0, rTt = 0;
      if (!this.grounded) {
        const aFw = this._aSm.x * fwx + this._aSm.z * fwz, aLw = this._aSm.x * Math.cos(this.yaw) - this._aSm.z * fwx;
        const hp = Math.atan2(aFw, G) * d.tiltGain, hr = -Math.atan2(aLw, G) * d.tiltGain; // 左（+X）へ加速 = 左へ傾く（roll 負）
        const vh = Math.hypot(this.vel.x, this.vel.z);
        const gam = Math.atan2(this.vel.y, Math.max(vh, 1));
        const cp = -gam - (1 - smooth(d.stallSpeed, d.stallSpeed + 40, vh)) * 4 * D2R, cr = -Math.atan2(aLat, Math.max(G, wingUse));
        pT = clamp(w * hp + (1 - w) * cp, -d.pitchMax * D2R, d.pitchMax * D2R);
        rTt = clamp(w * hr + (1 - w) * cr, -d.rollMax * D2R, d.rollMax * D2R);
      }
      const tk = Math.min(1, h * d.tiltRate);
      this.pitch += (pT - this.pitch) * tk; this.roll += (rTt - this.roll) * tk;
      this._updateQuat();
      if (!this.grounded) {
        // 掃引（機体の球）。当たれば戻して跳ね返す / 墜落
        this.pos.x += this.vel.x * h; this.pos.y += this.vel.y * h; this.pos.z += this.vel.z * h;
        this._hullWorld(this._s1);
        const hit = this._sweep(ctx);
        if (hit) {
          const t = Math.max(0, hit.t - 0.02);
          this.pos.x -= this.vel.x * h * (1 - t); this.pos.y -= this.vel.y * h * (1 - t); this.pos.z -= this.vel.z * h * (1 - t);
          this._onHit(hit, ctx);
          if (this.wrecked) return;
          this._hullWorld(this._s1);
        }
        // 押し出し（安全の網）: 球が箱に重なっていれば（掃引の当たりの後ろへの戻しが足りない・回った翼端）一番近い面の外へ。中心は箱に入らない
        if (this._depenetrate(ctx)) { this._hullWorld(this._s1); if (this.wrecked) return; }
        if (this.city) {
          this.pos.x = clamp(this.pos.x, this.city.minX + 20, this.city.maxX - 20);
          this.pos.z = clamp(this.pos.z, this.city.minZ + 20, this.city.maxZ - 20);
        }
        this._checkGround(ctx, pilot);
      }
      this._gearStep(h);
    }

    // ミサイルの近接信管（missile.js の _collateral）: 線分 a → b が機体の球（hull）のどれかの r + margin m の中を通るか。out = [k, x, y, z]（MissileCore.closest と同じ）。
    //   翼幅 44 m の機体を中心の 1 つの球（幅 / 2 + 1 = 23 m）で見ると、機体の外（下へ ejectDrop・横へ ejectSide）に撒いたフレアそのものが球の中にあり、
    //   だまされてフレアへ向かうミサイルが機体の 19 m 下を通っただけで「直撃」になった（smoke 17 の M18）
    proxSegment(ax, ay, az, bx, by, bz, margin, out) {
      const MC = MR.MissileCore, H = this.hullDef, q = this.quat;
      // 先に外接球（一番遠い球 + margin）で外れを捨てる
      const c = this.center(this._v1), Rb = this._hullR || (this._hullR = H.reduce((m, s) => Math.max(m, Math.hypot(s.x, s.y - PIVOT_Y, s.z) + s.r), 0));
      if (!MC.closest(ax, ay, az, bx, by, bz, c.x, c.y, c.z, Rb + margin, null)) return false;
      const w = this._v2;
      let best = -1, bk = 2;
      const tmp = this._proxOut || (this._proxOut = [0, 0, 0, 0]);
      for (let i = 0; i < H.length; i++) {
        const s = H[i];
        w.set(s.x, s.y - PIVOT_Y, s.z).applyQuaternion(q);
        if (MC.closest(ax, ay, az, bx, by, bz, w.x + this.pos.x, w.y + this.pos.y + PIVOT_Y, w.z + this.pos.z, s.r + margin, tmp) && tmp[0] < bk) {
          bk = tmp[0]; best = i;
          if (out) { out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2]; out[3] = tmp[3]; }
        }
      }
      return best >= 0;
    }

    _hullWorld(out) {
      const q = this.quat, H = this.hullDef;
      for (let i = 0; i < H.length; i++) { const s = H[i]; out[i].set(s.x, s.y - PIVOT_Y, s.z).applyQuaternion(q); out[i].x += this.pos.x; out[i].y += this.pos.y + PIVOT_Y; out[i].z += this.pos.z; }
    }

    // 掃引: 前の位置 _s0 → 今の位置 _s1。一番早く当たった { t, i, box, nx, ny, nz, point } か null（戦闘機の _sweep と同じ形）
    _sweep(ctx) {
      const s0 = this._s0, s1 = this._s1, H = this.hullDef;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
      for (let i = 0; i < s0.length; i++) {
        const a = s0[i], b = s1[i];
        x0 = Math.min(x0, a.x, b.x); x1 = Math.max(x1, a.x, b.x); z0 = Math.min(z0, a.z, b.z); z1 = Math.max(z1, a.z, b.z); y0 = Math.min(y0, a.y, b.y);
      }
      const R = 2.5;
      x0 -= R; x1 += R; z0 -= R; z1 += R;
      const cands = this._cands;
      cands.length = 0;
      const nav = ctx && ctx.nav;
      if (nav && typeof nav.itemsIn === 'function' && y0 < 150) nav.itemsIn(x0, z0, x1, z1, cands);
      if (this.collider) this.collider.query(x0, z0, x1, z1, cands);
      this.stats.sweeps++;
      this.stats.boxes += cands.length;
      let best = null;
      for (let n = 0; n < cands.length; n++) {
        const b = cands[n];
        if (b.f & 1) continue;
        let top = b.y1;
        if (b.k === 1) top = Math.max(MR.Nav3D.itemTop(b, b.x0, b.z0), MR.Nav3D.itemTop(b, b.x1, b.z1));
        if (top <= y0 - 2.5) continue;
        for (let i = 0; i < s0.length; i++) {
          const r = H[i].r, a = s0[i], c = s1[i];
          let t = MR.Nav3D.rayBox(a.x, a.y, a.z, c.x - a.x, c.y - a.y, c.z - a.z, b.x0 - r, b.y0 - r, b.z0 - r, b.x1 + r, top + r, b.z1 + r);
          if (t === null || t > 1) continue;
          const dist = (k) => { const px = a.x + (c.x - a.x) * k, py = a.y + (c.y - a.y) * k, pz = a.z + (c.z - a.z) * k;
            const ex = px - clamp(px, b.x0, b.x1), ey = py - clamp(py, b.y0, top), ez = pz - clamp(pz, b.z0, b.z1); return ex * ex + ey * ey + ez * ez; };
          if (dist(t) > (r + 0.02) * (r + 0.02)) {
            let hitT = null;
            for (let q = 1; q <= 8; q++) { const k = t + (1 - t) * q / 8; if (dist(k) <= r * r) { hitT = k; break; } }
            if (hitT === null) continue;
            t = hitT;
          }
          if (!best || t < best.t) best = { t, i, box: b, top };
        }
      }
      // 他の乗り物（止まっている車・ヘリ・戦闘機）: 機体の球と相手の円
      const others = (ctx && ctx.vehicles) || [];
      for (let k = 0; k < others.length && !best; k++) {
        const o = others[k];
        if (o === this || o.disposed || o.sunk || o.carrier || (o.wrecked && o.wreckFall)) continue; // 積んだ車（V2c）は機体の中
        if (Math.abs(o.pos.x - this.pos.x) > 50 || Math.abs(o.pos.z - this.pos.z) > 50) continue;
        const oh = (o.def && o.def.height) || 2;
        if (y0 > o.pos.y + oh + 3) continue;
        for (let i = 0; i < s1.length; i++) {
          const c = s1[i], r = H[i].r;
          if (c.y - r > o.pos.y + oh || c.y + r < o.pos.y) continue;
          const q = o._pushCircle(c.x, c.z, r);
          if (Math.hypot(q.x - c.x, q.z - c.z) > 0.02) { best = { t: 1, i, vehicle: o, nx: (c.x - o.pos.x), ny: 0, nz: (c.z - o.pos.z) }; const L = Math.hypot(best.nx, best.nz) || 1; best.nx /= L; best.nz /= L; break; }
        }
      }
      if (best && !best.vehicle) {
        const i = best.i, r = H[i].r, a = s0[i], c = s1[i], b = best.box, t = best.t;
        const hx = a.x + (c.x - a.x) * t, hy = a.y + (c.y - a.y) * t, hz = a.z + (c.z - a.z) * t;
        const faces = [[Math.abs(hx - (b.x0 - r)), -1, 0, 0], [Math.abs(hx - (b.x1 + r)), 1, 0, 0], [Math.abs(hy - (b.y0 - r)), 0, -1, 0], [Math.abs(hy - (best.top + r)), 0, 1, 0], [Math.abs(hz - (b.z0 - r)), 0, 0, -1], [Math.abs(hz - (b.z1 + r)), 0, 0, 1]];
        let f = faces[0];
        for (const gg of faces) if (gg[0] < f[0]) f = gg;
        best.nx = f[1]; best.ny = f[2]; best.nz = f[3];
        best.point = new THREE.Vector3(hx - f[1] * r, hy - f[2] * r, hz - f[3] * r);
      }
      return best;
    }

    // 今の位置（_s1）の機体の球と箱（HeliCollider + nav の小物。斜路は除く）の重なりを、一番深いものから外へ押し出す（3 回まで）。
    //   押した向きへの速さは消す。押したか
    _depenetrate(ctx) {
      const s1 = this._s1, H = this.hullDef, cands = this._dcands || (this._dcands = []);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
      for (let i = 0; i < s1.length; i++) { const c = s1[i], r = H[i].r; x0 = Math.min(x0, c.x - r); x1 = Math.max(x1, c.x + r); z0 = Math.min(z0, c.z - r); z1 = Math.max(z1, c.z + r); y0 = Math.min(y0, c.y - r); }
      cands.length = 0;
      const nav = ctx && ctx.nav;
      if (nav && typeof nav.itemsIn === 'function' && y0 < 150) nav.itemsIn(x0, z0, x1, z1, cands);
      if (this.collider) this.collider.query(x0, z0, x1, z1, cands);
      let moved = false;
      for (let it = 0; it < 3; it++) {
        let best = 0, bx = 0, by = 0, bz = 0;
        for (let n = 0; n < cands.length; n++) {
          const b = cands[n];
          if ((b.f & 1) || b.k === 1) continue;
          const top = b.y1;
          for (let i = 0; i < s1.length; i++) {
            const c = s1[i], r = H[i].r;
            if (c.x < b.x0 - r || c.x > b.x1 + r || c.z < b.z0 - r || c.z > b.z1 + r || c.y < b.y0 - r || c.y > top + r) continue;
            const qx = clamp(c.x, b.x0, b.x1), qy = clamp(c.y, b.y0, top), qz = clamp(c.z, b.z0, b.z1);
            const ex = c.x - qx, ey = c.y - qy, ez = c.z - qz, dd = ex * ex + ey * ey + ez * ez;
            let px = 0, py = 0, pz = 0, pen = 0;
            if (dd > 1e-10) {
              const dl = Math.sqrt(dd);
              if (dl >= r) continue;
              pen = r - dl + 0.01; px = ex / dl; py = ey / dl; pz = ez / dl;
            } else {
              // 中心が箱の中: 一番近い面の外へ
              const f = [[c.x - b.x0, -1, 0, 0], [b.x1 - c.x, 1, 0, 0], [c.y - b.y0, 0, -1, 0], [top - c.y, 0, 1, 0], [c.z - b.z0, 0, 0, -1], [b.z1 - c.z, 0, 0, 1]];
              let k = f[0]; for (const q of f) if (q[0] < k[0]) k = q;
              pen = k[0] + r + 0.01; px = k[1]; py = k[2]; pz = k[3];
            }
            if (pen > best) { best = pen; bx = px; by = py; bz = pz; }
          }
        }
        if (best <= 0) break;
        this.pos.x += bx * best; this.pos.y += by * best; this.pos.z += bz * best;
        const vn = this.vel.x * bx + this.vel.y * by + this.vel.z * bz;
        if (vn < 0) { this.vel.x -= bx * vn; this.vel.y -= by * vn; this.vel.z -= bz * vn; }
        for (let i = 0; i < s1.length; i++) { s1[i].x += bx * best; s1[i].y += by * best; s1[i].z += bz * best; }
        this.stats.depen = (this.stats.depen || 0) + 1;
        moved = true;
      }
      return moved;
    }

    // ぶつかった: 面へ向かう速さが crashSpeed を超えれば墜落、遅ければ跳ね返してダメージ
    _onHit(hit, ctx) {
      const d = this.def;
      const vn = this.vel.x * hit.nx + this.vel.y * hit.ny + this.vel.z * hit.nz;
      const speed = Math.max(0, -vn);
      this.lastImpactSpeed = speed;
      this.stats.collisions++;
      this.impacts++;
      if (speed > d.crashSpeed) {
        this._crash(hit.vehicle ? 'vehicle' : (hit.box && hit.box.y1 > 30 ? 'building' : 'ground'), this.vel.length(), ctx, hit.box);
        return;
      }
      if (vn < 0) { this.vel.x -= hit.nx * vn * (1 + d.bounce); this.vel.y -= hit.ny * vn * (1 + d.bounce); this.vel.z -= hit.nz * vn * (1 + d.bounce); }
      if (this.time - this.lastImpact > 0.3 && speed > 0.5) {
        this.lastImpact = this.time;
        const pt = hit.point || this.center(this._v1);
        this._sound('vehicle_impact', clamp(speed / 12, 0.3, 1), pt, { refDistance: 10, maxDistance: 250 });
        if (this.fx && this.fx.impact) this.fx.impact(pt, this._v2.set(hit.nx || 0, 0.3, hit.nz || 0).normalize());
        if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, speed);
        if (speed > d.impactSpeed) this.damage((speed - d.impactSpeed) * d.impactDamage, ctx);
      }
    }

    // 支える面（nav（読み込み済みのチャンク）か HeliCollider）。{ y | null, water }（戦闘機の _support と同じ）
    _support(ctx, x, z, yRef) {
      const nav = ctx && ctx.nav, city = this.city;
      let g = null;
      if (nav && city) {
        const cc = city.chunkOf(x, z);
        if (nav.hasChunk(cc.cx + '_' + cc.cz)) g = nav.groundInfo(x, z, yRef + 0.3, 0.3);
      } else if (nav && !city && typeof nav.groundInfo === 'function') g = nav.groundInfo(x, z, yRef + 0.3, 0.3);
      if (!g) g = this.collider ? this.collider.supportAt(x, z, yRef + 0.3, 0.45) : { y: 0, water: null };
      const r = this._supR || (this._supR = { y: 0, water: null });
      r.y = g.y; r.water = g.water == null ? null : g.water;
      return r;
    }

    // 接地（空中の 1 歩の後）: 脚（上げていれば胴体）の下の面
    _checkGround(ctx, pilot) {
      const d = this.def;
      const S0 = this._support(ctx, this.pos.x, this.pos.z, this.pos.y + 1);
      const gy0 = S0.y !== null ? S0.y : (S0.water !== null ? S0.water : 0);
      this.groundY = gy0; this.onWater = S0.y === null && S0.water !== null;
      this.agl = Math.max(0, this.pos.y - gy0);
      if (this.agl > 30) return;
      const pts = this.gearPos > 0.9 ? this.gearPts : this.bellyPts;
      let touch = false, water = false, lo = Infinity, hi = -Infinity, nSup = 0, maxY = -Infinity, minGap = Infinity;
      const ys = this._ys || (this._ys = []);
      for (let i = 0; i < pts.length; i++) {
        const w = this.toWorld(pts[i], this._v2);
        const S = this._support(ctx, w.x, w.z, w.y + 1.5);
        const gy = S.y !== null ? S.y : (S.water !== null ? S.water : -50);
        ys[i] = S.y;
        if (S.y !== null) { nSup++; if (S.y < lo) lo = S.y; if (S.y > hi) hi = S.y; }
        if (w.y - gy < minGap) minGap = w.y - gy;
        if (w.y <= gy + 0.02) { touch = true; if (gy > maxY) maxY = gy; if (S.y === null) water = true; }
      }
      if (!touch) return;
      if (this.vel.y > 0) { this.pos.y += Math.max(0, -minGap); return; } // 上がっている（離陸の直後）: 面の上に戻すだけ
      const sink = -this.vel.y, hs = Math.hypot(this.vel.x, this.vel.z);
      const gear = this.gearPos > 0.9;
      // 縁・傾き（3 つの脚の面の高さの差 ÷ 脚の間の長さ）
      const ratio = nSup < pts.length ? 9 : (hi - lo) / this.gearSpan;
      const rec = { t: +this.time.toFixed(2), sink: +sink.toFixed(2), h: +hs.toFixed(2), gear, water, ratio: +Math.min(ratio, 9).toFixed(3), ok: false, x: +this.pos.x.toFixed(1), z: +this.pos.z.toFixed(1), y: +maxY.toFixed(2) };
      this.landings.push(rec); if (this.landings.length > 20) this.landings.shift();
      if (water || sink > d.crashSink || hs > d.crashSpeed) { this._crash(water ? 'water' : 'ground', Math.max(sink, hs), ctx); return; }
      if (ratio > d.landingSlope && (pilot || this.autoland)) {
        // 傾き・縁: 降りない（一番高い面の上で浮いたまま。HUD が「ここには降りられません」）
        this.pos.y += Math.max(0, -minGap) + d.cantLandGap;
        if (this.vel.y < 0) this.vel.y = 0;
        this.cantLand = d.cantLandTime;
        return;
      }
      rec.ok = true;
      this.levelled = ratio <= Math.tan(this.def.ramp.levelTiltMax * D2R); // 水平に降りた（傾斜板・機内を歩ける）
      this.pos.y += -minGap;
      let dmg = 0;
      if (sink > d.landingSpeed) dmg += (sink - d.landingSpeed) * d.landingDamage;
      if (hs > d.landingMaxSpeed) dmg += (hs - d.landingMaxSpeed) * d.landingDamage * 0.5;
      if (!gear) dmg += d.landingDamage * 2;
      rec.dmg = +dmg.toFixed(1);
      this.grounded = true; this.airborne = false;
      this.vel.set(0, 0, 0); this.yawRate = 0;
      this.pitch = 0; this.roll = 0; this._updateQuat();
      this.posHold = null; this.altHold = null; this.flight = 'hover'; this.spdHold = 0;
      const ap = this.autoland;
      this.landed = { kind: ap ? ap.kind : 'free', name: ap ? ap.name : null, x: this.pos.x, y: this.pos.y, z: this.pos.z, sink, h: hs, dmg };
      if (ap) { this.autoland = null; this.events.push({ t: 'autoland_done', kind: ap.kind, name: ap.name }); }
      this.events.push({ t: 'touchdown', sink, speed: hs });
      if (sink > 2 || dmg > 0) this._sound('vehicle_impact', clamp(sink / 8, 0.25, 1), null, { refDistance: 10 });
      if (dmg > 0) this.damage(dmg, ctx);
    }

    // 脚: 低く遅い・ホバー・自動着陸では下ろす、高く速いときは上げる
    _gearStep(h) {
      const d = this.def;
      let want = this.gearDown;
      if (this.grounded || this.autoland) want = true;
      else if (this.agl < d.gearAgl && this.speed < d.gearSpeed) want = true;
      else if (this.agl > d.gearUpAgl || this.speed > d.gearSpeed + 10) want = false;
      // 脚の出し入れの音（gear_motor。空中で向きが変わったときだけ）
      if (want !== this.gearDown && !this.grounded) this._sound('gear_motor', 0.8, this.center(this._v1), { refDistance: 12, maxDistance: 250 });
      this.gearDown = want;
      this.gearPos = clamp(this.gearPos + (want ? 1 : -1) * h / d.gearTime, 0, 1);
    }

    // ナセル・脚・扉・傾斜板・回るもの
    _animate(dt, force) {
      const d = this.def, sg = this._hoverSign || -1;
      const q = this._qi;
      const ax = this._v3;
      for (const p of this.pods) { q.setFromAxisAngle(ax.set(1, 0, 0), sg * Math.abs(d.hoverDeg) * D2R * (this.theta / 90)); p.node.quaternion.copy(p.q0).multiply(q); }
      const gr = (1 - this.gearPos) * d.gearRot * D2R;
      for (const g of this.gearNodes) { q.setFromAxisAngle(ax.set(1, 0, 0), -gr); g.node.quaternion.copy(g.q0).multiply(q); }
      const dp = this.gearPos < 1 && this.gearPos > 0 ? 1 : 0;
      for (const g of this.doorNodes) { q.setFromAxisAngle(ax.set(0, 0, 1), g.s * dp * 1.2); g.node.quaternion.copy(g.q0).multiply(q); }
      this._rampPose();
      if (dt > 0) for (const n of this.spinNodes) n.rotation.y += dt * (n.name === 'reactor' ? 2.5 : 0.6) * (0.3 + this.spool);
      this._armPose();
    }
    // 武装の部品（V3）: 銃（しまうと内側へ gunDeg°、出すと gunAim へ）・扉・腕・ラック・吊り物
    _armPose() {
      const A = this.def.arm || DEFAULTS.arm, a = this.armPos, q = this._qi, ax = this._v3, e = this._ea;
      for (const gn of this.gunNodes) {
        e.set(-this.gunAim.pitch * a, -gn.s * A.gunDeg * D2R * (1 - a) + this.gunAim.yaw * a, 0, 'YXZ');
        gn.node.quaternion.copy(gn.q0).multiply(q.setFromEuler(e));
      }
      for (const dn of this.bayDoors) { q.setFromAxisAngle(ax.set(0, 0, 1), -dn.e * A.doorDeg * D2R * a); dn.node.quaternion.copy(dn.q0).multiply(q); }
      for (const ln of this.bayLinks) { q.setFromAxisAngle(ax.set(1, 0, 0), -A.linkDeg * D2R * a); ln.node.quaternion.copy(ln.q0).multiply(q); }
      for (const rk of this.bayRacks) rk.node.position.y = rk.y0 - A.rackDrop * a;
      if ((a > 0) !== !!this._storesOut) { this._storesOut = a > 0; this._storesShow(); }
    }

    // 吹き下ろし（ホバーで地面・水の近く）
    _wash(dt) {
      const d = this.def;
      if (!this.fx || typeof this.fx.rotorWash !== 'function' || this.grounded || this.spool < 0.5) return;
      const k = Math.sin(this.theta * D2R);
      if (k < 0.5 || this.agl > d.washHeight) return;
      this._washT -= dt;
      if (this._washT > 0) return;
      this._washT = 0.1;
      const s = this.thrustUse * k * (1 - this.agl / d.washHeight);
      for (const side of [1, -1]) {
        const p = this.toWorld(this._v1.set(8.2 * side, 0, -2), this._v2);
        p.y = this.groundY + 0.15;
        this.fx.rotorWash(p, 3 + 5 * (this.agl / d.washHeight), this.onWater, s);
      }
    }

    _apply() {
      if (!this.root || !this.quat) return;
      const o = this._v3 ? this._v3.set(0, -PIVOT_Y, 0).applyQuaternion(this.quat) : null;
      if (!o) return;
      this.root.position.set(this.pos.x + o.x, this.pos.y + PIVOT_Y + o.y, this.pos.z + o.z);
      this.root.quaternion.copy(this.quat);
    }

    _engineAudio(dt) {
      const a = this.audio;
      if (!a) return;
      if (!this.engineOn || this.spool <= 0.01 || this.wrecked) { this._stopEngine(); return; }
      if (!this.engine && typeof a.jet === 'function') { try { this.engine = a.jet(this.center(this._v1)); } catch (e) { this.engine = null; } }
      if (!this.engine) return;
      const inside = !!(this.localInside && this.listenerPos);
      const k = Math.sin(this.theta * D2R);
      // ホバー = 高い回転数（推力）、巡航 = 速さ
      const nT = clamp(0.35 + 0.55 * (k * this.thrustUse + (1 - k) * this.speedRatio), 0, 1);
      this.n += (nT - this.n) * Math.min(1, dt * 2);
      const wind = inside && !this.grounded ? clamp(this.speed / this.def.maxSpeed, 0, 1) : 0;
      this.engine.set(this.n, 0, wind, this.spool, inside && this.cockpit);
      this.engine.setPosition(inside ? this.listenerPos : this.center(this._v1));
    }
    _stopEngine() {
      if (this.engine) { try { this.engine.stop(); } catch (e) { /* ignore */ } }
      this.engine = null;
      this.rpm = 0;
    }

    // フレア（AirCombat.updateHeli: 空中の操縦席のボタン / X / 自動）。n 個まで出して出した数
    takeFlares(n) { const k = Math.max(0, Math.min(n | 0, this.flareCount)); this.flareCount -= k; return k; }
    // ---------- 武装（V3）----------
    // 出す（撃つ・ミサイル・爆弾の前に。もう出ていれば しまうまでの時間を数え直す）
    arm() { if (this.wrecked) return; this.armWant = true; this._armT = 0; }
    stow() { this.armWant = false; }
    get armed() { return this.armPos >= 1; }
    get bayOpen() { return this.armPos >= 1; }
    bombReady() { return this.bayOpen; }
    // 1 フレーム: armIdle 秒（地上 groundIdle 秒）で しまう、armPos を armWant へ
    _armStep(dt) {
      const A = this.def.arm;
      if (this.armWant) {
        this._armT += dt;
        if (this._armT > (this.grounded ? A.groundIdle : A.armIdle) && !this.gunTask && !this.missileTask) this.armWant = false;
      }
      const t = this.armWant ? 1 : 0;
      if (this.armPos !== t) { this.armPos = clamp(this.armPos + (t > this.armPos ? 1 : -1) * dt / Math.max(0.05, A.armTime), 0, 1); this._armPose(); }
    }
    // 銃口（i = 0 左舷 / 1 右舷）の世界の位置
    muzzleWorld(i, out) {
      out = out || new THREE.Vector3();
      const n = this._muzzles[i ? 1 : 0];
      if (n && n.parent && this.model && n.parent !== this.scene) { n.updateWorldMatrix(true, false); return n.getWorldPosition(out); }
      const m = this.def.gun.muzzle || [12.4, 2.57, 4.5];
      return this.toWorld(this._v3.set(i ? -m[0] : m[0], m[1], m[2]), out);
    }

    // 吊り物（jet.js と同じ形: _loadout / _pylons / missileCount / bombCount / missileCounts / takeMissile）
    _loadout() { const L = this.def && this.def.missile && this.def.missile.loadout; return Array.isArray(L) ? L : DEFAULTS.missile.loadout; }
    _pylons() { const L = this._loadout(); if (!this._pyl || this._pyl.length !== L.length) this._pyl = L.map(() => false); return this._pyl; }
    get missileCount() { const p = this._pyl; if (!p) return 0; let n = 0; for (let i = 0; i < p.length; i++) if (p[i]) n++; return n; }
    set missileCount(n) {
      const p = this._pylons();
      n = Math.max(0, Math.min(p.length, n | 0));
      let cur = 0;
      for (let i = 0; i < p.length; i++) if (p[i]) cur++;
      for (let i = 0; i < p.length && cur < n; i++) if (!p[i]) { p[i] = true; cur++; }
      for (let i = p.length - 1; i >= 0 && cur > n; i--) if (p[i]) { p[i] = false; cur--; }
    }
    _bombLoadout() { const L = this.def && this.def.bombs && this.def.bombs.loadout; return Array.isArray(L) ? L : DEFAULTS.bombs.loadout; }
    _bombPylons() { const L = this._bombLoadout(); if (!this._bpyl || this._bpyl.length !== L.length) this._bpyl = L.map(() => false); return this._bpyl; }
    get bombCount() { const p = this._bpyl; if (!p) return 0; let n = 0; for (let i = 0; i < p.length; i++) if (p[i]) n++; return n; }
    set bombCount(n) {
      const p = this._bombPylons();
      n = Math.max(0, Math.min(p.length, n | 0));
      let cur = 0;
      for (let i = 0; i < p.length; i++) if (p[i]) cur++;
      for (let i = 0; i < p.length && cur < n; i++) if (!p[i]) { p[i] = true; cur++; }
      for (let i = p.length - 1; i >= 0 && cur > n; i--) if (p[i]) { p[i] = false; cur--; }
    }
    isBombType(type) { const L = this._bombLoadout(); for (let i = 0; i < L.length; i++) if (L[i][1] === type) return true; return false; }
    missileCounts(out) {
      out = out || this._mcOut || (this._mcOut = {});
      const L = this._loadout(), p = this._pylons(), B = this._bombLoadout(), bp = this._bombPylons();
      for (let i = 0; i < L.length; i++) out[L[i][1]] = 0;
      for (let i = 0; i < B.length; i++) out[B[i][1]] = 0;
      for (let i = 0; i < L.length; i++) if (p[i]) out[L[i][1]]++;
      for (let i = 0; i < B.length; i++) if (bp[i]) out[B[i][1]]++;
      return out;
    }
    setMissileCounts(c) {
      if (!c || typeof c !== 'object') return;
      const L = this._loadout(), p = this._pylons(), left = {};
      for (let i = 0; i < L.length; i++) { const t = L[i][1]; if (!(t in left)) left[t] = Math.max(0, c[t] | 0); p[i] = left[t] > 0; if (p[i]) left[t]--; }
      const B = this._bombLoadout(), bp = this._bombPylons();
      for (let i = 0; i < B.length; i++) { const t = B[i][1]; if (!(t in c)) continue; if (!(t in left)) left[t] = Math.max(0, c[t] | 0); bp[i] = left[t] > 0; if (bp[i]) left[t]--; }
      this._storesShow();
    }
    // 置き場所のノード（missile.loadout の名前 → GLB / コードの機体に無ければ arm.slots の親の下に作る。bombs.loadout は gbu_l / gbu_r）。[{ node, type, bomb, i }]
    _slotList() {
      if (this._slots) return this._slots;
      const out = [];
      if (!this.model) return out;
      const S = (this.def.arm && this.def.arm.slots) || DEFAULTS.arm.slots;
      const add = (L, bomb) => {
        for (let i = 0; i < L.length; i++) {
          let n = this.model.getObjectByName(L[i][0]);
          const sl = S[L[i][0]];
          if (!n && sl) { const par = this.model.getObjectByName(sl[0]); if (par) { n = new THREE.Object3D(); n.name = L[i][0]; n.position.set(sl[1], sl[2], sl[3]); n.userData.vtolSlot = true; par.add(n); } }
          out.push({ node: n || null, type: L[i][1], bomb, i, mesh: null });
        }
      };
      add(this._loadout(), false); add(this._bombLoadout(), true);
      this._slots = out;
      return out;
    }
    // 吊り物の形: baked = MR.Missiles._baked（型 → { geometry, material }。無い型は筒の代わり = 共有）。何度呼んでもよい（焼けた型だけ差し替える）
    //   lengths（任意）: 型 → 長さ m（筒の代わりの大きさ。game.json の missiles.types[型].length）
    setStoreGeo(baked, lengths) {
      if (baked) this._storeGeo = baked;
      if (lengths) this._storeLen = lengths;
      const B = this._storeGeo || {}, LN = this._storeLen || {};
      for (const s of this._slotList()) {
        if (!s.node) continue;
        const bk = B[s.type], fb = bk ? null : storeFallback(s.type, s.bomb, LN[s.type]);
        const geo = bk ? bk.geometry : fb.geo, mat = bk ? bk.material : fb.mat;
        if (!s.mesh) {
          const m = new THREE.Mesh(geo, mat); m.name = 'store_' + s.type; m.castShadow = false; m.userData.vtolStore = true;
          if (this.cockpit) m.layers.enable(1);
          s.node.add(m); s.mesh = m; this._storeMeshes.push(m);
        } else if (s.mesh.geometry !== geo) { s.mesh.geometry = geo; s.mesh.material = mat; }
      }
      this._storesShow();
    }
    _dropStoreMeshes() {
      for (const m of this._storeMeshes) if (m.parent) m.parent.remove(m);
      this._storeMeshes.length = 0;
      if (this._slots) for (const s of this._slots) { s.mesh = null; if (s.node && s.node.userData.vtolSlot && s.node.parent) s.node.parent.remove(s.node); }
      this._slots = null;
    }
    // 見せる: 積んでいて、扉が開いている（armPos > 0）間だけ
    _storesShow() {
      if (!this.model) return;
      const sl = this._slotList(), p = this._pylons(), bp = this._bombPylons(), show = this.armPos > 0;
      for (const s of sl) if (s.node) s.node.visible = show && !!(s.bomb ? bp[s.i] : p[s.i]);
    }
    // ミサイル / 爆弾を 1 つ使う（jet.js と同じ形）。扉が閉じていれば爆弾は null。発射位置（世界）か null
    takeMissile(type, out) {
      if (type && typeof type === 'object') { out = type; type = null; }
      out = out || this._takeOut || (this._takeOut = new THREE.Vector3());
      if (this.wrecked) return null;
      const sl = this._slotList();
      const pos = (bomb, i) => {
        const s = sl.find((q) => q.bomb === bomb && q.i === i);
        if (s && s.node) { s.node.updateWorldMatrix(true, false); return s.node.getWorldPosition(out); }
        return this.toWorld(this._v1.set(i % 2 ? -12.7 : 12.7, 2.2, -2.95), out);
      };
      if (type && this.isBombType(type)) {
        if (!this.bombReady()) return null;
        const B = this._bombLoadout(), bp = this._bombPylons();
        let k = -1;
        for (let j = B.length - 1; j >= 0; j--) if (bp[j] && B[j][1] === type) { k = j; break; }
        if (k < 0) return null;
        pos(true, k);
        bp[k] = false;
        this.lastMissileType = B[k][1];
        this._storesShow(); this._bombT = 0;
        return out;
      }
      if (this.missileCount <= 0) return null;
      const L = this._loadout(), p = this._pylons();
      if (!type) type = MR.MissileCore ? MR.MissileCore.pickType(null, this.missileCounts(), null, 0, 0) : null;
      let i = -1;
      for (let j = L.length - 1; j >= 0; j--) if (p[j] && (!type || L[j][1] === type)) { i = j; break; }
      if (i < 0) return null;
      pos(false, i);
      p[i] = false;
      this.lastMissileType = L[i][1];
      this._storesShow(); this._missileT = 0;
      return out;
    }
    _refill() {
      const d = this.def;
      this.ammo = d.gun.ammo; this.missileCount = d.missile.count; this.bombCount = d.bombs.count; this.flareCount = d.flares.count;
      this._missileT = 0; this._bombT = 0; this.rearmT = 0;
      this._storesShow();
    }
    // 補給（パッドに止まって rearmTime 秒）と空中のミサイルの 1 発ずつ
    _rearmStep(dt) {
      const d = this.def, R = d.rearm;
      const need = this.ammo < d.gun.ammo || this.missileCount < d.missile.count || this.bombCount < d.bombs.count || this.flareCount < d.flares.count;
      const pad = need && this.grounded && this.speed <= R.maxSpeed ? this._onRearmPad() : null;
      if (pad) {
        this.rearmT += dt;
        if (this.rearmT >= R.rearmTime) { this._refill(); this.events.push({ t: 'rearm', pad: pad.id }); }
      } else this.rearmT = 0;
      if (!this.grounded) {
        if (this.missileCount < d.missile.count && d.missile.reloadTime > 0) { this._missileT += dt; if (this._missileT >= d.missile.reloadTime) { this._missileT = 0; this.missileCount++; this._storesShow(); } } else this._missileT = 0;
        if (this.bombCount < d.bombs.count && d.bombs.reloadTime > 0) { this._bombT += dt; if (this._bombT >= d.bombs.reloadTime) { this._bombT = 0; this.bombCount++; this._storesShow(); } } else this._bombT = 0;
      }
    }
    _onRearmPad() {
      const ids = this.def.rearm.pads || [], pads = (this.spots && this.spots.pads) || [];
      for (const p of pads) {
        if (ids.indexOf(p.id) < 0 || Math.abs(this.pos.y - p.y) > 1.5) continue;
        if (Math.abs(this.pos.x - p.x) <= Math.max(p.w, p.d) / 2 && Math.abs(this.pos.z - p.z) <= Math.max(p.w, p.d) / 2) return p;
      }
      return null;
    }

    // ---------- 車を積む（V2c。vtolcargo.js。頭の説明）----------
    _cargoOn() { return !!(this.cabin && MR.VtolCargo && this.cabin.cargo && this.def.cargo && this.def.cargo.enabled !== false); }
    // 積んでいる車（積み込み・降ろす途中も）か null
    get cargo() { return this._cargo ? this._cargo.car : null; }
    // 'loading' | 'stowed' | 'unloading' | null
    get cargoState() { return this._cargo ? this._cargo.state : null; }
    // 積み込み・降ろす途中（傾斜板を閉じない・浮かない）
    get cargoBusy() { return !!(MR.VtolCargo && MR.VtolCargo.busy(this)); }
    // 物語の API: v を貨物室に積む。opts.drive: 今の場所から積み込みの道を走る（枠の決まり tryCapture をそのまま。運転手が要る）、
    //   無ければその場で積んだ状態にする（載る車なら。opts.reverse で後ろ向き）。戻り値: 受けたか
    loadVehicle(v, opts) {
      if (!this._cargoOn() || !v || v.kind || v.carrier || v.wrecked) return false;
      if (opts && opts.drive) return MR.VtolCargo.tryCapture(this, v, this._lastCtx);
      if (MR.VtolCargo.fits(v.def, this.cabin.cargo.slots[0])) return false;
      return MR.VtolCargo.attach(this, v, opts && opts.reverse ? -1 : 1);
    }
    // 物語の API: 積んだ車を傾斜板から降ろす（運転手はいなくてよい。着陸して水平・通り道が空いているとき）。戻り値: 始めたか（理由は cargoMsg）
    unloadVehicle() { return !!(this._cargoOn() && MR.VtolCargo.unloadVehicle(this, this._lastCtx)); }
    attachCargo(v, dir) { return !!(this._cargoOn() && MR.VtolCargo.attach(this, v, dir)); }
    releaseCargo(v, why) { return MR.VtolCargo ? MR.VtolCargo.release(this, v || null, why || 'drop') : null; }

    // ---------- 物語の自動操縦（hoverAt / followPath / orbit。頭の説明）----------
    hoverAt(p, yaw, opts) {
      if (!p) return false;
      const y0 = typeof yaw === 'number' && isFinite(yaw) ? yaw : null;
      this.script = { mode: 'hover', p: { x: p.x, y: p.y, z: p.z }, yaw: y0, done: false, holdYaw: !!(opts && (opts.holdYaw || opts.approachYaw)) && y0 !== null };
      this._scriptStart();
      return true;
    }
    followPath(points, speed) {
      if (!Array.isArray(points) || !points.length) return false;
      this.script = { mode: 'path', pts: points.map((q) => ({ x: q.x, y: q.y, z: q.z })), speed: Math.max(1, num(speed, this.def.maxSpeedHover)), i: 0, done: false, yaw: null };
      this._scriptStart();
      return true;
    }
    orbit(c, r, h, speed) {
      if (!c || !(r > 0)) return false;
      this.script = { mode: 'orbit', c: { x: c.x, z: c.z }, r, h: num(h, this.pos.y), speed: Math.max(1, num(speed, this.def.autopilot.orbitSpeed)), done: false };
      this._scriptStart();
      return true;
    }
    // 物語の窓口（§7 の autopilot({ to, heading, height, hover, orbit })）: orbit { c, r, h, speed } / to（+ heading・height）
    autopilot(o) {
      if (!o) { this.clearAutopilot(); return false; }
      if (o.orbit) return this.orbit(o.orbit.c || o.orbit, o.orbit.r, o.orbit.h != null ? o.orbit.h : o.height, o.orbit.speed);
      if (o.to) return this.hoverAt({ x: o.to.x, y: o.height != null ? o.height : o.to.y, z: o.to.z }, o.heading);
      return false;
    }
    // 物語の射撃（頭の説明）: ゲーム（game.js _updateVtolTasks）が毎フレーム gunTask / missileTask を見て撃つ
    fireGunsAt(p, sec) {
      if (!p || this.wrecked || this.ammo <= 0) return false;
      const t = this.gunTask || (this.gunTask = { p: new THREE.Vector3(), sec: 0, t0: 0, end: null, acc: 0, sndT: 0, mz: 0 });
      t.p.set(p.x, p.y, p.z); t.sec = Math.max(0, num(sec, 1)); t.t0 = this.time; t.end = null; // sec 秒は出しきってから数える
      this.arm();
      return true;
    }
    fireMissileAt(target) {
      if (!target || this.wrecked || this.missileCount + this.bombCount <= 0) return false;
      this.missileTask = { target, t0: this.time };
      this.arm();
      return true;
    }
    clearAutopilot() { this.script = null; this.posHold = null; this.altHold = null; this.hdgHold = null; this.autoT = 0; }
    _scriptStart() { if (this.autoland) this.cancelAutoland('script'); this.posHold = null; this.altHold = null; this.hdgHold = null; this.autoT = 0; }
    // 地上・始動済み・頭の上が空いている
    canLiftOff(ctx) {
      if (!this.grounded || this.wrecked || this.sinking || this.spool < this.def.liftSpool) return false;
      if (!this._liftOk()) return false; // V2: 傾斜板が閉じきっていない・機内を歩いている人がいる
      const AP = this.def.autopilot;
      const coll = this.collider, nav = ctx && ctx.nav;
      for (const s of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
        const w = this.toWorld(this._v2.set(s[0], this.def.height, s[1]), this._v2);
        if (nav && typeof nav.raycast === 'function') { const h = nav.raycast(w.x, w.y, w.z, 0, 1, 0, AP.liftClear); if (h) return false; }
        if (coll) { const t = coll.raycast(w.x, w.y, w.z, 0, 1, 0, AP.liftClear); if (t !== null) return false; }
      }
      return true;
    }
    // 目標（_control から。1/60 秒以下の 1 歩ごと）: 水平の目標の速度 v（{ x, z }）・高さ y・向き yaw（null = 進む向き）
    _scriptCmd(h, out) {
      const d = this.def, AP = d.autopilot, S = this.script, y = this.pos.y;
      let tx, tz, ty, yawT = null, spd = 0, vx = 0, vz = 0;
      if (S.mode === 'orbit') {
        const rx = this.pos.x - S.c.x, rz = this.pos.z - S.c.z, rr = Math.hypot(rx, rz) || 1e-3;
        const ux = rx / rr, uz = rz / rr;
        // 回る向きは決まり: 接線 (−uz, ux)（+X の点では +Z へ進む）。半径のずれは orbitK で戻す
        const t = S.speed, k = AP.orbitK;
        const radial = clamp((S.r - rr) * k, -t, t);
        vx = -uz * t + ux * radial; vz = ux * t + uz * radial;
        ty = S.h; spd = Math.hypot(vx, vz);
        yawT = Math.atan2(vx, vz);
        S.done = Math.abs(rr - S.r) < S.r * 0.1;
      } else {
        let p = S.p, last = true;
        if (S.mode === 'path') {
          // 途中の点: 水平に wpRadius m（速ければ vh × wpTime）に入ったら次へ。ただし水平にほぼ真上・真下の点（wpRadius m 以内）は高さも ±wpAlt m に
          //   入ってから（「ここでまっすぐ上がる」= 先に上がってから横へ。水平の距離だけで次へ行くと斜めに建物へ入った）
          while (S.i < S.pts.length - 1) {
            const q = S.pts[S.i], dq = Math.hypot(q.x - this.pos.x, q.z - this.pos.z);
            const vh = Math.hypot(this.vel.x, this.vel.z);
            if (dq < AP.wpRadius && q.y != null && Math.abs(q.y - y) > AP.wpAlt) break;
            if (dq < Math.max(AP.wpRadius, vh * AP.wpTime)) S.i++; else break;
          }
          p = S.pts[S.i]; last = S.i === S.pts.length - 1;
          // 高さの違う途中の点の上: 最後の点と同じく止まって上下する（全速で通り過ぎない）
          if (!last && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < AP.wpRadius && Math.abs(p.y - y) > AP.wpAlt) { last = true; S.vert = (S.vert || 0) + 1; }
        }
        tx = p.x; tz = p.z; ty = p.y;
        const dx = tx - this.pos.x, dz = tz - this.pos.z, dist = Math.hypot(dx, dz);
        const cap = S.mode === 'path' ? S.speed : d.maxSpeedHover;
        // 止まれる速さ √(2 a d)（最後の点）。途中の点は速さのまま
        let v = last ? Math.min(cap, Math.sqrt(2 * AP.brake * Math.max(0, dist - AP.arrive * 0.5)) + dist * AP.posK * 0.5) : cap;
        if (last && dist < AP.arrive * 2) v = Math.min(v, dist * AP.posK);
        if (dist > 1e-3) { vx = dx / dist * v; vz = dz / dist * v; }
        spd = v;
        if (last && dist < AP.arrive) { yawT = S.yaw != null ? S.yaw : null; }
        else if (S.holdYaw && (S.holdOn || dist < AP.holdYawDist + Math.hypot(this.vel.x, this.vel.z) * (Math.abs(wrap(S.yaw - this.yaw)) / (d.maxYawRate * D2R) + AP.holdYawLead))) {
          // hoverAt(p, yaw, { holdYaw }): 最後の holdYawDist m は向きを保ったまま寄る（横・後ろへも）。回り終わってから holdYawDist m に入るよう、
          //   回るのにかかる距離（速さ ×（角度 ÷ maxYawRate + holdYawLead 秒 = 向きの追い方の遅れ））だけ先に回り始める（一度始めたら保つ）
          S.holdOn = true; yawT = S.yaw;
        }
        else yawT = dist > 1 ? Math.atan2(dx, dz) : null;
        if (yawT === null) yawT = S.yaw != null ? S.yaw : this.yaw;
        S.done = last && S.i === (S.pts ? S.pts.length - 1 : S.i) && dist < AP.arrive && Math.abs(ty - y) < AP.arrive && Math.hypot(this.vel.x, this.vel.z) < 1;
      }
      const vyT = clamp((ty - y) * AP.altK, -d.descendRate, d.climbRate);
      const cruise = spd > AP.cruiseFrom;
      this.flight = cruise ? 'cruise' : 'hover';
      if (cruise) this.spdHold = spd;
      out.tvx = vx; out.tvz = vz; out.vyT = vyT; out.spd = spd; out.hdg = spd > 0.5 ? Math.atan2(vx, vz) : this.yaw; out.yawT = cruise ? out.hdg : yawT;
      return out;
    }

    // HUD の数（game.js）
    hudInfo() {
      return { theta: Math.round(this.theta), alt: this.agl, speed: this.speed, gear: this.gearPos > 0.5, flight: this.flight, autoland: this.autoland ? this.autoland.phase : null, g: this.gload, stall: this.stall,
        arm: this.armPos, armed: this.armed, ammo: this.ammo };
    }
    // オンライン（未来の E4）で同期する状態
    netState() {
      const r = (v) => Math.round(v * 100) / 100;
      return { p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], yaw: r(this.yaw), pitch: r(this.pitch), roll: r(this.roll), v: [r(this.vel.x), r(this.vel.y), r(this.vel.z)], th: r(this.theta), gear: r(this.gearPos), ramp: r(this.rampPos), hp: Math.round(this.health) };
    }
    dispose() {
      if (this._cargo) MR.VtolCargo.release(this, null, 'drop');
      this._stopEngine();
      this._cabinOn = false;
      if (this.interior && this.interior.parent) this.interior.parent.remove(this.interior);
      this.interior = null;
      this._dropParked();
      this._dropStoreMeshes();
      super.dispose();
    }
  }
  Vtol.DEFAULTS = DEFAULTS;
  Vtol.HULL = HULL;
  Vtol.BOXES = BOXES;
  Vtol.CONTACTS = CONTACTS;
  Vtol.PIVOT_Y = PIVOT_Y;
  Vtol.DEBRIS_NODES = ['pod_l', 'pod_r', 'ramp', 'gun_l', 'gun_r']; // 壊れたときに外れる部品（detachDebris。respawn で戻る）
  Vtol.stats = { glbRequests: 0, parkedBuilt: 0, released: 0, armedBuilt: 0 };
  Vtol.home = null; // 物語の入口: 街の最初の機体（game.js が入れる）
  Vtol._parkedCache = PARKED;
  // まとめた形を捨てる（game.stop。次のゲームで要れば作り直す）
  Vtol.releaseParked = function () {
    for (const b of PARKED.values()) if (b && b.parts) for (const pt of b.parts) if (pt.geo) pt.geo.dispose();
    PARKED.clear();
    for (const e of ARMED.values()) if (e.b && e.b.parts) for (const pt of e.b.parts) if (pt.geo) pt.geo.dispose();
    ARMED.clear();
  };
  Vtol._armedCache = ARMED;
  // 動く足場の provider（cityboats.js の Platforms に addProvider。prefix 'v'）: getList() = 乗り物の一覧（game.vehicles）、cabin = vtol.json の cabin。
  //   near は歩ける（walkable）機体の囲み（bbox）から r m 以内のものだけ
  Vtol.cabinProvider = function (getList, cabin) {
    const types = cabin && cabin.walk && cabin.profile ? cabinTypes(cabin) : {};
    const l = { x: 0, z: 0 };
    return {
      prefix: 'v', types,
      near(x, y, z, r, out) {
        let n = 0;
        for (const v of getList() || []) {
          if (!v || v.kind !== 'vtol' || !v._cabinOn || n >= out.length) continue;
          const e = v._entry, b = e.data.bbox, ps = e.pose, c = Math.cos(ps.yaw), s = Math.sin(ps.yaw), dx = x - ps.x, dz = z - ps.z;
          l.x = dx * c - dz * s; l.z = dx * s + dz * c;
          const ox = Math.max(0, b[0][0] - l.x, l.x - b[1][0]), oz = Math.max(0, b[0][2] - l.z, l.z - b[1][2]);
          if (ox * ox + oz * oz > r * r || y < ps.y + b[0][1] - 3 || y > ps.y + b[1][1] + 3) continue;
          out[n++] = e;
        }
        return n;
      },
      byId(id) { for (const v of getList() || []) if (v && v._entry && v._entry.id === id) return v._entry; return null; }
    };
  };
  // VTOL が 1 機もいなくなった（遠くへ離れて消した・game.stop）: まとめた形と、読んだ GLB（assets のモデルのキャッシュの形・材質・テクスチャ）を捨てる。
  //   生きている機体があれば何もしない（clone は形・材質を共有する）。次に近づけば読み直す。戻り値は捨てた GLB の数
  Vtol.releaseAssets = function (assets, vehicles) {
    if (vehicles && vehicles.some((v) => v && v.kind === 'vtol' && !v.disposed)) return 0;
    Vtol.releaseParked();
    let n = 0;
    if (assets && typeof assets.releaseModel === 'function') for (const k of Array.from(GLB_KEYS)) if (assets.releaseModel(k)) { GLB_KEYS.delete(k); n++; }
    Vtol.stats.released += n;
    return n;
  };
  MR.Vtol = Vtol;
})();
