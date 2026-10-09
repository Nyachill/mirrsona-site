// 戦闘機 F/A-18F（MR.Jet。MR.Vehicle を継承し、game.js からは乗り物として扱える: kind === 'jet'）。
// 街（midtown）の空母の甲板 carrier_jet_1..4 に置く（citygen の vehicleSpawns の最後の 'jet'。世界の座標は city.carrierOps）。
//
// ■ 飛び方（アーケードのエネルギーの模型。数値はすべて game.json の vehicles.types.jet、無いキーは DEFAULTS）
//   状態: 重心の位置 p・速度 vel・姿勢 quat（機体の座標: +Z 機首・+Y 上・+X 左）。pos は原点（主脚の間の地面）= p − quat·cg。
//   推力（前）: アイドル idleThrust 〜 ミリタリー thrustMil、アフターバーナー thrustAB（m/s²）。回転数は spoolTime で追う。
//   抗力: cd0 × V²（cd0 = thrustAB / maxSpeed²: アフターバーナーで水平に maxSpeed）× 脚 gearDrag・エアブレーキ airbrakeDrag、
//         誘導抗力 inducedDrag × 揚力² / V²（急旋回で速さが落ちる）。
//   揚力: Kl × V² × 迎え角 / stallAoA（Kl = gLimit × g / cornerSpeed²: コーナー速度で G の上限）。stallSpeed（脚・フラップは
//         stallSpeedLanding）より遅いと揚力が抜ける（失速）。上限の高さ ceiling から ceilingSoft で推力と揚力が弱まる（柔らかい天井）。
//   操縦（FCS）: 縦は「G の指令」（迎え角を pitchTrack で追う。G は gMin〜gLimit）、横はロール率（rollRate°/s まで）、
//         ヨーは横滑りを消す（sideslipDamp）+ 方向舵（yawRate°/s）。
//   setJetControls({ stickX, stickY, aim, manual, thrUp, thrDown }):
//     aim（世界の向きの単位ベクトル。カメラの向き）があれば「見た方へ飛ぶ」: 機体を傾けて目標を上に置き、引いて機首を向ける
//     （小さなずれは水平のまま方向舵、下の目標は押す。War Thunder のマウス操縦と同じ考え方）。
//     左スティック: Y = スロットルの速さ（上の端で 100 % の後アフターバーナー、下の端でアイドル。地上でアイドルならブレーキ、空中ならエアブレーキ）、
//     X = ロール（空中。aim より優先）/ 前輪の向き（地上）。manual: スティック = ピッチ・ロール、スロットルは thrUp / thrDown。
// ■ 地上: 前輪の向き（noseSteer、速いほど弱く）・ブレーキ・転がり抵抗。rotateSpeed を超えて機首を上げたい（aim が上）と
//   機首が上がり（rotateAoA まで）、揚力が重さを超えると離陸。支えが無くなる（甲板の端）と空中へ。
//   接地: 脚が下りていて、沈む速さ < touchdownSink・速さ < touchdownSpeed・傾き < touchdownRoll・機首下げ < touchdownPitch → 着地。
//   それ以外（脚上げ・強すぎ・水）は墜落。
// ■ 空母: カタパルト（carrierOps.cats）の近く（catSnapRadius m、catSnapSpeed m/s 以下）で止まると位置を合わせて接続（launch_bar が下りる）。
//   スロットル全開（catThrottle 以上）で catTension 秒の溜めのあと、甲板の端までで catSpeed m/s に加速（catapult_launch。再生速度で合わせる）。
//   着艦: 脚が下りていて空母の着艦の向きに並んで近づく（hookAutoRange m・hookAutoAngle°）とフックが自動で下りる（甲板の外で接地したら上げる）。甲板の上でフックの先がワイヤー（landing.wires、横 wireHalfWidth）
//   を越えたら arrestTime 秒で止まる（arrest_catch）。ワイヤーを外したら（ボルター）そのまま走る: 推力があれば甲板の端から飛び、無ければ海へ。
//   甲板で止まっていると rearmTime 秒で機関砲の弾を補給（ammo = gun.ammo）。
// ■ 当たり判定（250 m/s でも抜けない）: 機体の球（HULL、機体の座標）を前のフレームの位置から今の位置へ掃引し、
//   HeliCollider（区画の建物・ランドマーク・橋・空母）と nav の細かい箱（読み込み済みのチャンク）の「半径ぶん広げた箱」とレイで当てる。
//   空母のジェットブラストデフレクター（carrierOps.jbd）は乗り越える。速さ crashSpeed を超えて当たれば墜落、遅ければ止まる（地上の移動）。
//   地面・水: 脚 / 胴体の下の面（nav.groundInfo、未読込なら HeliCollider.supportAt）。
// ■ 墜落・爆発: HP 0 → Vehicle の爆発（ctx.onExplode: game.js が乗っている人を倒す）→ 残骸が落ちて燃える（水なら沈む）→ respawn 秒後に
//   駐機場所（spawnPos）で復活。射出（eject()）: キャノピーが飛び、座席が上がる（プレイヤーは game.js がパラシュートで降ろす）。
//   無人の機体はそのまま飛び続け、少しずつ機首が下がって墜ちる。
// ■ 見た目: assets/<tier>/models/fa18.glb（ルート FA18、body と動翼・脚・キャノピー・フック・兵装のノード、クリップ gear / canopy、
//   空ノード seat_pilot / seat_wso / exit_l / exit_r / cannon_muzzle / nozzle_l / nozzle_r / light_* / contact_* / cg / hud）。
//   無ければコードで組んだ機体（同じノード名）。動翼は操縦に合わせて動き（ヒンジの軸と角度は userData の axis / min / max）、
//   脚は gear のクリップ（コードの機体は回転）、車輪は回り、アフターバーナーの炎（加算の円錐。材質は共有）と航法灯（スプライト）。
//   setCockpit(true): 自分が一人称で乗っているとき、メッシュをレイヤー 1 にも入れ、ガラスはレイヤー 1 だけ（game.js が近いカメラで重ね描く）。
// ■ 音: audio.jet()（jet_engine のループ: 0.6〜1.5 倍、jet_afterburner を重ねる、heli_wind: 乗っている人だけ速さで）・gear_motor・
//   canopy_motor・catapult_launch・arrest_catch・jet_flyby（自分が乗っていない機体が近くを速く通る）。
// ■ オンライン（フェーズ E4）で同期する状態: netState() → { p:[x,y,z], q:[x,y,z,w], v:[vx,vy,vz], thr, ab, gear, hook, canopy, hp, seats, g, ga, ap, msl, flr }
// ■ 200 G（maxG）: 大きく曲がりたいときだけ G の上限 gAuth を gOnsetRate で上げ、速いほど効く機動の揚力を足す（maneuver の説明）。
//   空力の校正（kl・失速・離陸・着艦）は今まで通り。オンライン（E4）のサーバーのもっともらしさの判定はこの旋回の速さを通すこと。
// ■ かんたん操作（scheme: 'easy'）: _easyAim / _easyThrottle、自動の脚、自動着艦・着陸（startAutoland → _autolandUpdate）
if (typeof window !== 'undefined' && window.THREE && window.MR && window.MR.Vehicle) (function () {
  const MR = window.MR;
  const G = 9.81;
  const D2R = Math.PI / 180;
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const srgb = (hex) => (MR.srgb ? MR.srgb(hex) : new THREE.Color(hex));

  const DEFAULTS = {
    name: 'F/A-18F', kind: 'jet', model: 'models/fa18.glb', fallback: 'jet', scale: 1,
    length: 18.27, width: 13.65, height: 5.15, wheelRadius: 0.387, noseWheelRadius: 0.288, wheelbase: 6.07, track: 3.03,
    cg: [0, 1.95, 0.62],
    health: 900, armor: 0.5, driverExposure: 0,
    // 推力・抗力（m/s²）
    maxSpeed: 250, thrustMil: 6.8, thrustAB: 11.5, idleThrust: 0.3, spoolTime: 1.1, abTime: 0.35, startTime: 2.5, spinDownTime: 5,
    inducedDrag: 45, gearDrag: 1.0, airbrakeDrag: 1.6, overspeedDrag: 6,
    // 揚力・操縦
    stallSpeed: 65, stallSpeedLanding: 55, stallBand: 10, landingLift: 1.15, cornerSpeed: 150, gLimit: 7.5, gMin: -2.5, stallAoA: 18,
    rollRate: 220, rollAccel: 1100, pitchTrack: 7, maxPitchRate: 70, yawRate: 10, sideslipDamp: 2.2, sideForce: 0.025,
    ceiling: 2500, ceilingSoft: 300, boundsMargin: 250,
    throttleRate: 0.7, abStick: 0.85, idleBrake: -0.8, abHold: 0.2,
    // スロットルの速さ（throttleRate の倍）: 上の端（abStick より上）throttleRateFull、下へ倒す throttleRateDown、地上でブレーキまで倒す throttleRateCut。
    //  スティックの縦の不感帯 stickDeadzone（これ以下は「離した」: 甲板では軽くブレーキ deck.releaseBrake）
    throttleRateFull: 1.4, throttleRateDown: 1.4, throttleRateCut: 4, stickDeadzone: 0.12,
    // 地上
    rotateSpeed: 66, rotateAoA: 11, rotateRate: 7, rotatePitch: 2, liftoffPitch: 2, liftoffLift: 1.02, lowerRate: 4, taxiFriction: 0.35, brake: 9, noseSteer: 55, steerFadeSpeed: 25, rudderGround: 10,
    // 接地・衝突
    touchdownSpeed: 85, touchdownSink: 6, touchdownRoll: 15, touchdownPitch: -4, crashSpeed: 14, impactDamage: 18, bounce: 0.15,
    // 空母
    catSpeed: 75, catTension: 0.6, catSnapRadius: 14, catSnapSpeed: 4, catSnapAngle: 50, catAlignTime: 1.4, catThrottle: 0.98, catSoundTime: 2.4,
    arrestTime: 1.85, arrestHold: 1.0, hookAutoRange: 2500, hookAutoAngle: 40, wireHeight: 0.9, bolterHeight: 8, bolterClear: 40, rearmTime: 3,
    // 脚・キャノピー
    gearTime: 1.5, autoGear: true, autoGearAgl: 25, autoGearSpeed: 85, canopyTime: 2.2, hookTime: 1.2,
    // 機関砲（game.js が使う）
    gun: { rate: 50, ammo: 578, damage: 30, range: 1600, convergence: 650, spread: 0.3, tracerEvery: 3, burst: 0.6, tracerSpeed: 1050 },
    // 爆発・残骸
    explodeRadius: 18, explodeDamage: 400, explodeFx: 7, explodeFxCount: 0.6, wreckSmokeEvery: 0.2, respawn: 60, wreckGravity: 12, pilotlessDive: 0.6, pilotlessTime: 45,
    pilotlessCtl: { rollFrac: 0.5, levelGain: 2, turnGain: 3, turnBank: 1.5, maxBank: 69 },
    // カメラ（game.js）
    chaseDistance: 24, chaseHeight: 5, chaseSpeedDist: 10, chaseFovBoost: 12, cockpitFovBoost: 5,
    // 3 人称で後ろがすぐ壁のときに上げる高さ（m）。見ている向きを寄せる（game.js _jetCamAssist）: 目標（つないだ・発艦）へ goalRate、
    //  FCS が置き換えた向きへ followRate（1/s）、スワイプの後 swipePause 秒は寄せない、つないだ・発艦の目標は hookTime / launchTime 秒、
    //  地面・建物を避けた後 levelAfter 秒までは上を向いたままなら levelPitch° へ戻す
    chaseLift: 16, camAssist: { goalRate: 3, followRate: 1.6, swipePause: 0.6, hookTime: 2.5, launchTime: 1.5, levelAfter: 8, levelPitch: 3 },
    // 案内: 初めて乗ったときの説明 tutorialTime 秒、発艦の後の「自動で上昇中」climbHintTime 秒
    hud: { tutorialTime: 10, climbHintTime: 5 },
    // 見た方へ飛ぶ操縦
    aim: { rollGain: 4.0, pitchGain: 2.4, yawGain: 1.4, levelFrom: 1.5, levelTo: 9, pushMax: 18, groundSteer: 2.5, turnDamp: 0.6, bankMargin: 8, invertOff: 30, lowBank: 10, lowAgl: 40, groundWarn: 3,
      stickRoll: 0.5, stickAngle: 1.0, groundStick: 0.3, groundAngle: 1.0, autoRotate: 8, autoRotateThrottle: 0.9, autoRotateMinPitch: -3,
      // 地面・水・建物を避ける（_groundFloor）: 前（速さ × lookTime 秒、lookStep m ごと）の地面・建物の floorAgl m 上を、pullReact 秒後から
      //  引き起こし（揚力の上限 × pullFrac − G の 1/pullSafety）で越えられる経路角より下へは行かない（最大 climbMax°）。引き起こしに要る高さ
      //  より低ければ floorPitch°。着陸の形（脚が下りていて touchdownSpeed + landingMargin m/s より遅いか、フックが下りている）は除く。
      //  ただし離陸・発艦の後に脚を一度も上げていなければ、経路角が −landingSlope° より浅いときだけ（発艦の直後に脚を下ろしたまま遅く
      //  下を向いても避ける）。水の上では空母（フックを下ろした・着艦の向きに並んだ）のときだけ
      floorAgl: 25, floorPitch: 10, nearTau: 1, lookTime: 8, lookStep: 12, lookMax: 60, lookEvery: 0.1, lookSide: 0.5, boxNear: 300, boxTime: 2.5, boxStep: 64, boxSide: 6, arcMax: 2, arcMin: 0.03, escFrom: 15, escSpeedK: 1.6, escGain: 10, escHold: 2, climbMax: 60, pullFrac: 0.6, pullSafety: 2, pullReact: 1, landingMargin: 10,
      landingSlope: 8,
      // 失速の速さ（脚の上げ下げで stallSpeed / stallSpeedLanding）+ speedFloor m/s より遅い → 全開・アフターバーナー（_fcs。その 2 倍の余裕まで）
      speedFloor: 12,
      // 速さの保護の間の上りの上限: 失速の速さで −spdPitchMin°、+ 2 × speedFloor で spdPitchMax°
      spdPitchMin: 3, spdPitchMax: 10,
      // 指令の弧（_omCmd）: 前の回から arcRescan rad/s 変わったらすぐ見直す。避ける間の G の上限: 下限が経路角より avoidGFrom〜avoidGFull° 上で 0〜1。
      //  曲がる先が今の道すじより turnBlockFrom〜turnBlockFull° 高い経路角を要る → 曲がりを弱める（turnBlock）
      arcRescan: 0.25, avoidGFrom: 3, avoidGFull: 20, turnBlockFrom: 5, turnBlockFull: 15,
      // 着陸の形の間（_landingFloor）: 前 landNear m（少なくとも速さ × boxTime 秒）、帯は翼幅の半分 + lookSide + landBoxSide m、
      //  降りる面より landStep m 高い建物の箱の上面 + landClear m より下へ入らない
      landNear: 200, landBoxSide: 2, landClear: 8, landStep: 3 },
    // 甲板（発艦ボタン・スティック上 → 誘導路 carrierOps.lanes を自動で走ってカタパルトへ。手で走るときの上限・止まる・後退・カタパルトへの誘導）:
    //  _deckStep の説明。スティック: cancelStick より下 = 自動をやめる・つないだカタパルトの解除の準備、brakeStick より下 = ブレーキ
    deck: { assistStick: 0.5, cancelStick: -0.3, brakeStick: -0.5, taxiMax: 35, taxiAccel: 8, taxiDecel: 9, routeDecel: 0.65, endSpeed: 1, speedGain: 2.5,
      cornerAccel: 4, cornerMin: 3, cornerLook: 80, offRouteAngle: 29, offRouteSpeed: 5, lookahead: 6, lookaheadSpeed: 0.35, manualMax: 12, hookDist: 2.5,
      startSpin: 0.3, stuckTime: 2, routeEvery: 0.5, routeRefresh: 3, retryEvery: 1.5, msgEvery: 3, joinSlope: 1.3, joinMin: 8, maxTurn: 100,
      kickDist: 5, kickMin: 15, kickMax: 60, kickGain: 1.5, checkStep: 1, checkNear: 4, jetGap: 0.5,
      unhookHold: 2, unhookCool: 4, launchThrottle: 2, alignTime: 0.7, spoolDist: 40, autoThrottle: [0.3, 0.8, 0.9],
      guardMargin: 2.5, guardStep: 0.4, reverseMax: 3, reverseAccel: 2, reverseHold: 0.8, backTol: 0.25, backEndSpeed: 0.2,
      captureDist: 40, captureLat: 6, captureAngle: 35, captureEvery: 0.25, captureSpeed: 1,
      recoverBack: [3, 6, 10, 15, 20, 30, 40, 55, 70], recoverArc: [4, 8, 12, 16], towHold: 3, towBack: [14, 24, 34],
      // 向きをそろえてから下がる（_planRecovery）: カタパルトの向きと recoverAlignMin° 以上ずれていれば前輪 recoverAlignSteer で弧（最長 recoverAlignMax m）
      recoverAlignSteer: 0.5, recoverAlignMin: 3, recoverAlignMax: 20,
      clearTime: 90, clearBehind: 8, clearLat: 6,
      // カタパルトが空くのを待っている操縦士がいる（deckWait。最後に知らせてから waitPing 秒以内）: 乗り捨てた機体は clearWait 秒で片付ける
      clearWait: 3, waitPing: 0.5, reverseStart: 0.3, movingSpeed: 0.05, catThrottleRate: 2, catThrottleMin: 0.5,
      // やめて止まる（stopSpeed / 下がる途中 backStopSpeed m/s で止めて手へ）・止まった経路の続きから（resumeDist m・resumeAngle° 動いていなければ）。
      //  甲板でスティックを離す（|縦| ≤ stickDeadzone）: ブレーキ releaseBrake、holdSpeed m/s より遅ければ全部。
      //  手で後ろへ: reverseStart m/s より遅いときに下へ倒し続けて reverseHold 秒。movingSpeed m/s より速ければ「動いている」（前・後ろ）。
      //  カタパルトにつないで手で回す: throttleRate × catThrottleRate（上へは少なくとも catThrottleMin 倒した速さ）
      stopSpeed: 0.2, backStopSpeed: 0.1, resumeDist: 1.5, resumeAngle: 10, releaseBrake: 0.2, holdSpeed: 0.3,
      // 甲板員の片付け（_clearDeck）: 着艦の場所・誘導路にかかって止まっている無人の機体は landedClearTime 秒で駐機場所へ（カタパルトの軌道は
      //  clearTime 秒）。着艦の場所 = 着艦の帯（landing の rampDist・length・halfWidth*）+ foulPad m、誘導路 = 線から foulLane m（機体の球の外側）、
      //  甲板の高さ ± foulHeight m。戻す場所に歩いているプレイヤーが spotPlayerClear m 以内なら置かない。
      //  進入してくる機体は foulEvery 秒ごとに着艦の場所を見る（deckFoul → 警告、自動着艦は autoland.foulWaveOff m より近くでやり直し）
      landedClearTime: 10, foulLane: 6, foulPad: 1, foulHeight: 3, spotPlayerClear: 9, foulEvery: 0.25,
      // 手で走っている向きのカタパルト（甲板の目印・案内）: headSpeed m/s より速く前へ、headDist m 以内、始点への向きが機首から headAngle° 以内で、
      //  目印のカタパルトより headMargin° 以上まっすぐ
      headSpeed: 1.5, headDist: 160, headAngle: 12, headMargin: 6,
      // 片付け（_clearDeck）: 元の場所から clearMoved m 以上・甲板の高さ ± heightTol m（車輪が甲板の上か: _poseOnDeck も）。
      //  当たり判定: 軌道の空きは busyStep m ごと、初めから触れている所からは離れていく向きだけ・overlapSkip m で離れていなければ当たり（_blockedFrom）、箱の上 topClear m までは越える、
      //  箱を集める広さ = 機体の球の半径 + boxReach m、ほかの乗り物は otherReach m 以内（高さが分からないものは otherHeight m）、
      //  他の乗り物を見るのは snapReach m 以内
      clearMoved: 3, heightTol: 0.6, busyStep: 6, overlapSkip: 3, topClear: 0.35, boxReach: 1, otherReach: 30, otherHeight: 2, snapReach: 500,
      // stillSpeed m/s より遅い = 止まっている（下がる経路を探す）。案内の経路は routeMove m・routeTurn° 動いたら作り直す。スティックを
      //  releaseMag まで戻すと「離した」。自動で加速 stuckAcc m/s² 以上なのに stuckSpeed m/s より遅い = 引っかかっている（作り直しの間に
      //  progressDist m 進んでいなければ下がる経路・牽引）。経路の確かめ（_simRoute）は simStep 秒刻みで最長 simTime 秒。
      //  手で走ってカタパルトにつながったときのスロットル hookThrottle、自動で来たときは catSnapSpeed × hookSpeedMul m/s までつなぐ
      stillSpeed: 0.5, routeMove: 0.3, routeTurn: 1.15, releaseMag: 0.15, stuckAcc: 0.5, stuckSpeed: 0.3, progressDist: 1, simStep: 0.05, simTime: 120, simStopSpeed: 0.05,
      hookThrottle: 0.3, hookSpeedMul: 1.5, joinSlopeAlt: [0.5, 0.8, 2, 3], laneStep: 1, snapBehind: 1,
      // 誘導路をよける（_laneSet。止まっている機体・降りたヘリが誘導路にかかっている）: 誘導路を横へ laneOffsets m（+ = カタパルトの向きの右）
      //  ずらした線も候補にする（ずらさない線で行けないときだけ）。カタパルトの始点の手前 laneMerge m で元の線に戻る（laneRamp m かけて斜めに）
      laneOffsets: [4, 7, -4], laneMerge: 25, laneRamp: 20,
      // 初めから触れている所から動く: 隙間が overlapTol m 狭くなったら当たり（_blockedFrom）。ほかの乗り物に pushEps m 押し出されたら当たり
      overlapTol: 0.02, pushEps: 0.02,
      // 手で走るときに止める隙間（_taxiGuard。機体どうし）: 自動の経路の jetGap より狭くてよい（線を手で追うと少しずれる）
      // 止まるまでの距離の減速は少なくとも guardMinDecel m/s²
      guardGap: 0.3, guardMinDecel: 1,
      // 自動で走っている間に動いた乗り物を見る（_aheadBlocked）: liveEvery 秒ごと、liveMove m・liveTurn° 動いたもの
      liveEvery: 0.1, liveMove: 0.3, liveTurn: 3 },
    // 発艦・離陸の直後（カメラがどこを向いていても）: time 秒以上かつ地面から agl m まで（最長 maxTime 秒）、上へ pitch〜pitchMax°・
    //  離陸の向きから yaw° 以内に飛ぶ。地図の端で戻るときは boundsAgl m より低ければ boundsPitch° で上りながら。その間スロットルは throttle より絞らない
    climb: { time: 4, maxTime: 10, agl: 120, pitch: 12, pitchMax: 25, yaw: 30, boundsPitch: 8, boundsAgl: 200, throttle: 1 },
    boundsHold: 45, boundsExit: 25, boundsLatchMove: 20, boundsTurnG: 12,
    // 地図の端の帯の幅の上限（遅いときは旋回半径 × boundsTurnK まで広げる。boundsMargin より狭くはしない）
    boundsMarginMax: 600, boundsTurnK: 2.2,
    // 戻る間の G: 一番近い端までの距離の boundsUse 倍の中で外向きの動きが止まる旋回の G まで（G の上限の欲しい度合い）
    boundsUse: 0.7, boundsLead: 0.8,
    // 200 G（オーナー「200Gまで耐えられるようにして戦闘機」）: 機体も操縦士も maxG まで壊れない・気を失わない。FCS の指令の上限（minG〜maxG）。
    //  空力の校正（kl = gLimit・cornerSpeed）はそのまま（離陸・失速・カタパルト・着艦は今まで通り）。大きく曲がりたいとき（見る向きのずれ
    //  maneuver.aimFrom〜aimFull°・スティック maneuver.stickFrom〜1）だけ G の上限 gAuth を gLimit から gOnsetRate G/s で maxG へ上げ、
    //  速いほど効く「機動の揚力」（maxG × liftMargin × smooth(fromSpeed, fullSpeed, 速さ)。250 m/s で 200 G = 半径約 30 m）を足す。離すと release 倍の速さで戻る。
    //  ロール・ピッチの速さも上限に合わせる（rollRateMax°/s、ピッチは経路の回る速さ × pitchMargin）。gLimit を超えた揚力の抗力は drag × 超えた分。
    //  大きな G の間は速度を回して積分し（integrateAbove × gLimit を超えたら。オイラーだと速さが増える）、1 歩の回転を maxStepTurn rad まで、
    //  当たり判定の掃引は sweepTurn rad ごとに区切る
    maxG: 200, minG: -20, gOnsetRate: 120,
    maneuver: { fromSpeed: 95, fullSpeed: 240, liftMargin: 1.06, drag: 0.006, aimFrom: 25, aimFull: 100, stickFrom: 0.55, curve: 1.6, release: 2, blendG: 2,
      rollRateMax: 400, rollGainBoost: 1.5, pitchMargin: 1.3, trackBoost: 4, rollingErr: 4, integrateAbove: 1.05, maxStepTurn: 0.03, maxSteps: 16, sweepTurn: 0.15, bankMarginMin: 2, peakDecay: 0.5 },
    // 「かんたん」操作（タッチの既定。game.js が scheme: 'easy' で渡す）: 左スティック = 行きたい方向（上 = 上昇・下 = 降下・横 = 旋回。
    //  傾き・協調は飛行計算機）、離すと水平飛行・高度を保つ。速さは自動（cruiseSpeed、曲がるときは turnSpeed）、加速 = AB、減速 = エアブレーキ。
    //  失速しない（minSpeed を保つ。脚を下ろした着陸の形・自動着艦は landingMinSpeed）。turnLead° = 横いっぱいのときの目標のずれ（stickCurve の累乗）、
    //  climbAngle / diveAngle° = 縦いっぱいの経路角。離したら高度 = 今の高さ + 上昇率 × altLead 秒、向き = 今の向き + 回る速さ × yawLead 秒。
    //  高度を保つ経路角 = atan(高さの差 / (速さ × holdTau))（holdMaxPitch° まで。今の経路角から holdPitchLag° まで）。遅い（minSpeed + climbBand）ほど上昇を弱める。
    //  スロットル = throttleBase + 速さの差 × throttleGain（throttleRate /s で動かす）、目標より abMargin m/s 遅ければ AB、airbrakeOver m/s 速ければエアブレーキ。
    //  G の上限: スティックの大きさ gFrom〜1 を gCurve 乗（半分で約 35 G、いっぱいで maxG）。
    //  脚: 着艦・着陸の向きに並んで gearDist m 以内・地面から gearAgl m 以下で下りていて、減速を押して gearSpeed m/s より遅いか gearSlow m/s
    //  より遅いと下ろす（並んで飛んでいるだけでは下ろさない）。並ばなくなって gearUpSpeed m/s・gearUpAgl m を超えたら上げる
    easy: { deadzone: 0.12, stickCurve: 1.6, gFrom: 0.3, gCurve: 1.2, turnLead: 120, climbAngle: 40, diveAngle: 35, climbBand: 30, altLead: 1.0, yawLead: 0.25, holdTau: 3, holdMaxPitch: 12, holdPitchLag: 8,
      cruiseSpeed: 139, turnSpeed: 125, minSpeed: 95, landingMinSpeed: 62, throttleBase: 0.55, throttleGain: 0.08, throttleI: 0.02, throttleIMax: 0.3, throttleRate: 2, abMargin: 25, airbrakeOver: 35,
      gearDist: 3000, gearAgl: 400, gearSpeed: 120, gearSlow: 100, gearUpSpeed: 125, gearUpAgl: 80, stripLat: 120, stripAngle: 30 },
    // 自動着艦・着陸（着艦 / 着陸ボタン。キー L）: 空母（carrierOps.landing）か道路（roads: 接地点 x, z、向き yaw°（進む向き）、長さ length m）。
    //  carrierRange m 以内なら着艦、遠ければ一番近い道路。進入路の高さ = 3.5°（approach.glideSlope）か、中心線の左右 ±lat m の建物 + clear m
    //  （接地点の近く noClear m は除く）を、下りは descent°・上りは climb° で越える形（step m ごと、outDist m まで）。
    //  out: 入口（中心線の後ろ outD m、地図の端から boundsMargin + boundsPad の中）へ着陸の向きで着く Dubins の道（半径 = 旋回半径 × dubinsK、
    //  dubinsEvery 秒ごとに作り直し、lookTime 秒 / lookMin m 先の点へ。高さは outAlt m、入口で進入路 + gateAbove m へ outSlope° まで）→ 入口で final。
    //  intercept: 中心線へのベクトル場（vfAngle / vfK / vfMin。_apJoin で final に入る所が joinMin m（out の途中は + joinOutPad）より遠いとき）。
    //  interceptAbort m（後ろの距離 × interceptAbortK）より近くでは横 finalLat × lateK までなら final、それより外れていたら out からやり直し →
    //  final: 中心線に乗って（横 finalLat m・
    //  向き finalAngle° 以内）進入路の lead m 先（距離 × leadK、leadMin〜leadMax）を見る。gearDist m で脚、slowDist m より近いと approach.speed、
    //  遠いと cruise m/s。縦は vLeadTime 秒（vLeadMin m 以上）先までの進入路のどこでも下にならない経路角（−maxDive〜maxClimb°）。
    //  外れたら（横 abortLat m・向き abortAngle°・接地点を abortPast m 過ぎた）・高すぎる・短い final で速い / ずれている → ゴーアラウンド（go*）。
    //  maxTries 回で解除。スティックを cancelStick より倒すと取り消し。
    //  空母の着艦の場所に機体がある（deckFoul: 甲板員が片付けるまで）まま接地点の手前 foulWaveOff m まで来たらやり直し（'foul'）
    autoland: { carrierRange: 4000, roadRange: 6000, step: 25, lat: 18, clear: 22, noClear: 350, descent: 11, climb: 8, outDist: 3000, outAlt: 300, outTau: 3, outPitch: 15, abortPast: 100,
      interceptAbort: 1100, interceptAbortK: 0.55, finalLat: 60, finalAngle: 25, abortLat: 160, abortAngle: 70, leadK: 0.45, leadMin: 140, leadMax: 600,
      gearDist: 2500, slowDist: 2300, cruise: 115, belowK: 1, trackDist: 700, trackTau: 1.4, trackTauLow: 1.0, trackI: 0.5, trackIMax: 3, trackIWin: 1.5, bolterClimb: 8, cancelStick: 0.35, boundsPad: 450, rollBrake: 1, vLeadMin: 150, vLeadTime: 2.5, maxDive: 14, maxClimb: 20,
      foulWaveOff: 900, goShort: 300, goCap: 300, goHigh: 25, goSteep: 12, goHighShort: 5, goHighK: 0.03, goLat: 14, goFast: 4, goClimb: 10, goAlt: 120, goMin: 3, goTime: 14,
      flareSink: 5, flareK: 0.3, dubinsK: 1.25, dubinsEvery: 0.5, pathPad: 100, lookTime: 2.5, lookMin: 250, gateAbove: 25, outSlope: 6, joinOutPad: 200, vfAngle: 80, vfK: 1, vfMin: 250, joinMin: 1300, joinOver: 600, lateK: 2.5, maxTries: 4,
      roads: [{ name: 'ウエストサイドハイウェイ', x: -2000, z: 300, yaw: 180, length: 1200 }] },
    // ミサイル（count 発。ロック: 速度の向きから lockCone° 以内・lockRange m 以内の一番よい目標に lockTime 秒向けると「ロック」）。
    //  game.js の MR.Missiles が飛ばす（missile.js）。甲板で補給、空中でも reloadTime 秒に 1 発
    //  飛び方（missile.js）: 落ちる dropTime 秒 → accel で speed m/s まで motorTime 秒 → coastDrag で遅く、life 秒で自爆。turnG G で曲がる、
    //  armTime 秒から fuse m で爆発（blastRadius m に damage、端で × 0.4）。地上の目標は上から（loftFrom / loftK / loftMax: missile.js）、建物の陰なら見えるまで狙いを liftRate m/s で上げる（losEvery 秒ごとのレイ、losClear m）。煙 trailEvery 秒ごと。フレアは decoyRange m 以内のミサイルを
    //  decoyChance でだます（flareLife 秒、同時に maxFlares 個まで）。ロックは lockMin m より遠く、建物・地面にさえぎられずに見える目標
    //  （目標の lockClear m 手前まで。見えなくなって lockHide 秒で外れる。lockScan 秒ごとに探す）。爆発は中心で damage、端で × (1 − blastEdge)、
    //  撃った機体の外にいるプレイヤーは × playerBlast
    missile: { count: 4, reloadTime: 40, lockCone: 22, lockRange: 3000, lockMin: 150, lockTime: 0.8, lockKeep: 30, lockClear: 6, lockHide: 0.6, lockScan: 0.25, cooldown: 0.6,
      speed: 480, accel: 220, ejectSpeed: 15, motorTime: 3.5, coastDrag: 40, dropTime: 0.25, armTime: 0.35, life: 9, turnG: 55, fuse: 9, loftFrom: 400, loftK: 0.5, loftMax: 300, losEvery: 0.1, losClear: 4, liftRate: 120,
      blastRadius: 16, damage: 650, blastEdge: 0.6, playerBlast: 0.3, trailEvery: 0.05, decoyRange: 2500, decoyChance: 0.8, flareLife: 3.2, maxFlares: 18 },
    // フレア（count 発。1 回に burst 発、cooldown 秒ごと）。自動フレア（設定）: 向かってくるミサイルが autoRange m 以内か autoTime 秒以内に当たるとき。
    //  向かってくる間は rwrEvery 秒ごとに警告音
    flares: { count: 30, burst: 3, cooldown: 1.2, autoRange: 1800, autoTime: 3.5, reloadTime: 8, rwrEvery: 1 },
    // 機関砲の照準アシスト（かんたん）: 飛ぶ向きから cone° 以内・range m 以内の目標へ弾を向ける（低いと地面・建物をよける下限で機首を下げきれない）
    gunAssist: { cone: 9, range: 1500 },
    // G の見た目（操縦は変わらない）: from G より上で FOV を最大 fovSqueeze° 狭め、画面の端を暗く（vignette）。HUD の G の色は warnG / hotG で変える。
    //  3 人称のカメラは機体の飛ぶ向きを camRate /s で追う（200 G の急旋回でも画面が振り回されない）
    gEffect: { from: 9, full: 150, fovSqueeze: 7, vignette: 0.5, warnG: 30, hotG: 120, rate: 4 },
    // かんたんの 3 人称カメラ（game.js _jetEasyCam）: 飛ぶ向きを rate /s で追う（maxRate°/s まで）、上下は経路角 × pitchK + pitch°。
    //  右側のスワイプで見回し、やめて lookDelay 秒で lookReturn /s で戻る
    easyCam: { rate: 3, maxRate: 160, pitchK: 0.6, pitch: -4, lookDelay: 1.2, lookReturn: 1.5 },
    // 着艦の進入（game.js の誘導の表示・自動着艦）: 進入路の角度 glideSlope°・速さ speed m/s・誘導を出す距離 range m
    approach: { glideSlope: 3.5, speed: 70, range: 4000 },
    navLeadMax: 300, navLeadAgl: 400,
    ejectSpeed: 20, ejectMaxHorizontal: 40, ejectMaxVy: 10, ejectArmTime: 2, flybyRange: 160, shadowAgl: 25,
    seat: [0, 3.06, 6.42], exit: [2.2, 0, 6.0],
    seats: [
      { node: 'seat_pilot', exitNode: 'exit_l', seat: [0, 3.06, 6.42], exit: [2.2, 0, 6.0] },
      { node: 'seat_wso', exitNode: 'exit_r', seat: [0, 3.18, 4.88], exit: [-2.2, 0, 6.0] }
    ],
    color: '#5f676e'
  };

  // 機体の球（機体の座標: +Z 機首・+X 左・+Y 上。原点は主脚の間の地面）。当たり判定の掃引に使う
  const HULL = [
    { x: 0, y: 2.0, z: 10.0, r: 0.9 }, { x: 0, y: 2.2, z: 6.6, r: 1.2 }, { x: 0, y: 2.2, z: 2.8, r: 1.3 }, { x: 0, y: 2.2, z: -1.2, r: 1.3 }, { x: 0, y: 2.2, z: -4.8, r: 1.1 },
    { x: 1.3, y: 3.9, z: -4.6, r: 1.2 }, { x: -1.3, y: 3.9, z: -4.6, r: 1.2 },
    { x: 3.0, y: 2.15, z: 0.6, r: 1.2 }, { x: -3.0, y: 2.15, z: 0.6, r: 1.2 }, { x: 5.4, y: 2.15, z: 0.2, r: 1.1 }, { x: -5.4, y: 2.15, z: 0.2, r: 1.1 },
    { x: 2.6, y: 2.1, z: -5.2, r: 0.9 }, { x: -2.6, y: 2.1, z: -5.2, r: 0.9 }
  ];
  const LANESETS = new WeakMap(); // carrierOps → 誘導路の候補（_laneSet）
  const DECKWAIT = new WeakMap(); // carrierOps → 空くのを待っている操縦士がいた最後の時刻（ctx.time。_clearDeck が早く片付ける）
  const LANDNEED = new WeakMap(); // carrierOps → 着艦の進入をしている機体がいた最後の時刻（ctx.time。_clearDeck が着艦の場所を早く片付ける）
  const HULL_R = 12;            // 機体の球を全部囲む半径（候補の箱を集める広さ）
  // 弾の当たりの箱（機体の座標）: 胴体・主翼・尾翼
  const BOXES = [
    { x0: -1.0, x1: 1.0, y0: 1.1, y1: 3.3, z0: -5.7, z1: 11.6 },
    { x0: -6.8, x1: 6.8, y0: 1.9, y1: 2.4, z0: -1.8, z1: 3.5 },
    { x0: -1.9, x1: 1.9, y0: 2.4, y1: 5.15, z0: -6.7, z1: -2.7 }
  ];
  const FUSE = { x0: -1.15, x1: 1.15, z0: -6.7, z1: 11.6 }; // 歩いている人を押し出す・乗れる距離の長方形（主翼の下はくぐれる）
  const BELLY_V = [[0, 1.15, 7.0], [0, 1.15, 0.0], [0, 1.2, -4.0]].map((a) => new THREE.Vector3(a[0], a[1], a[2])); // 脚を上げているときの接地点
  // ヒンジ（GLB の userData が無いとき・コードの機体）: 軸（機体の座標）・角度の範囲（度）
  const HINGES = {
    stab_l: { axis: [-1, 0, 0], min: -24, max: 10.5 }, stab_r: { axis: [-1, 0, 0], min: -24, max: 10.5 },
    aileron_l: { axis: [-0.990, 0.005, 0.143], min: -30, max: 45 }, aileron_r: { axis: [-0.990, -0.005, -0.143], min: -30, max: 45 },
    flap_l: { axis: [-0.990, 0.053, 0.129], min: 0, max: 45 }, flap_r: { axis: [-0.990, -0.053, -0.129], min: 0, max: 45 },
    rudder_l: { axis: [-0.305, -0.902, 0.306], min: -30, max: 30 }, rudder_r: { axis: [0.305, -0.902, 0.306], min: -30, max: 30 },
    airbrake: { axis: [1, 0, 0], min: 0, max: 60 }, canopy: { axis: [-1, 0, 0], min: 0, max: 38 },
    hook: { axis: [-1, 0, 0], min: 0, max: 76.8 }, launch_bar: { axis: [1, 0, 0], min: 0, max: 86.7 }
  };
  const GLASS = ['body_glass', 'canopy_glass', 'hud_glass'];

  // ---------- 止めてある機体を材質ごとの形にまとめる（GLB の F/A-18F は約 45 個のメッシュ = 影と合わせて 1 機 約 70〜90 回の描画）----------
  // 置いたままの姿勢（脚・キャノピー・動翼・車輪が既定）の機体は、GLB ごとに 1 回だけ作ってまとめた形（共有）で描く（1 機 数回）。
  // 乗る・動く・壊れると元のノードに戻し、respawn まではまとめた形を使わない。GLB の材質は機体どうしで共有なので一緒に使える
  const PARKED = new Map(); // GLB のキー → { parts: [{ geo, mat, cast, recv, order }] } | null（作れなかった）
  function flipWinding(g) {
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
      g.index.needsUpdate = true;
      return;
    }
    for (const k of Object.keys(g.attributes)) {
      const at = g.attributes[k], n = at.itemSize, a = at.array;
      for (let v = 0; v + 2 < at.count; v += 3) for (let c = 0; c < n; c++) { const i1 = (v + 1) * n + c, i2 = (v + 2) * n + c, t = a[i1]; a[i1] = a[i2]; a[i2] = t; }
      at.needsUpdate = true;
    }
  }
  function buildParked(model) {
    const utils = THREE.BufferGeometryUtils;
    if (!utils || typeof utils.mergeBufferGeometries !== 'function') return null;
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const groups = new Map(), m4 = new THREE.Matrix4();
    let bad = false;
    const visit = (o) => {
      if (bad || !o.visible) return;
      if (o.isMesh) {
        const g0 = o.geometry;
        if (Array.isArray(o.material) || o.isSkinnedMesh || o.isInstancedMesh || !g0 || !g0.attributes || !g0.attributes.position) { bad = true; return; }
        const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + '|' + o.renderOrder;
        let gp = groups.get(key);
        if (!gp) groups.set(key, gp = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder, list: [] });
        const g = g0.clone();
        m4.multiplyMatrices(inv, o.matrixWorld);
        g.applyMatrix4(m4);
        if (m4.determinant() < 0) flipWinding(g); // 鏡映したノード（描画ではレンダラーが表裏を入れ替えていた分）
        gp.list.push(g);
      }
      for (const c of o.children) visit(c);
    };
    visit(model);
    const parts = [];
    for (const gp of groups.values()) {
      if (bad) break;
      let names = null, indexed = true;
      for (const g of gp.list) { const n = Object.keys(g.attributes); names = names ? names.filter((k) => n.indexOf(k) >= 0) : n; if (!g.index) indexed = false; }
      const list = gp.list.map((g) => {
        const h = (!indexed && g.index) ? g.toNonIndexed() : g;
        if (h !== g) g.dispose();
        for (const k of Object.keys(h.attributes)) if (names.indexOf(k) < 0) h.deleteAttribute(k);
        h.morphAttributes = {};
        h.clearGroups();
        return h;
      });
      const merged = list.length === 1 ? list[0] : utils.mergeBufferGeometries(list, false);
      if (list.length > 1) for (const h of list) h.dispose();
      if (!merged) { bad = true; break; }
      merged.computeBoundingSphere();
      parts.push({ geo: merged, mat: gp.mat, cast: gp.cast, recv: gp.recv, order: gp.order });
    }
    if (bad) { for (const pt of parts) pt.geo.dispose(); return null; }
    return { parts };
  }

  // |b + k t| ≤ aMax となる一番大きい k（0..1）: 欲しい加速度を揚力の上限に収める
  function satK(bx, by, bz, tx, ty, tz, aMax) {
    const aa = tx * tx + ty * ty + tz * tz, bb = 2 * (bx * tx + by * ty + bz * tz), cc = bx * bx + by * by + bz * bz - aMax * aMax;
    if (aa < 1e-9 || aa + bb + cc <= 0) return 1;
    if (cc >= 0) return 0;
    return clamp((-bb + Math.sqrt(Math.max(0, bb * bb - 4 * aa * cc))) / (2 * aa), 0, 1);
  }

  // 共有の材質（アフターバーナーの炎・航法灯）。最初に使うときに作る
  let SHARED = null;
  function shared() {
    if (SHARED) return SHARED;
    const glow = (hex) => {
      if (MR.FX && MR.FX.makeGlowTexture && typeof document !== 'undefined') { try { return MR.FX.makeGlowTexture(hex); } catch (e) { /* Node のスタブ */ } }
      return null;
    };
    const sp = (hex) => new THREE.SpriteMaterial({ map: glow(hex), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const cone = (r, len) => { const g = new THREE.ConeGeometry(r, len, 14, 1, true); g.rotateX(-Math.PI / 2); g.translate(0, 0, -len / 2); return g; };
    const pm = (hex, op) => new THREE.MeshBasicMaterial({ color: srgb(hex), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    SHARED = {
      red: sp('#ff3030'), green: sp('#40ff70'), white: sp('#ffffff'), beacon: sp('#ff2020'), core: sp('#ffd9a0'),
      plumeOuterGeo: cone(0.36, 1), plumeInnerGeo: cone(0.2, 1),
      plumeOuter: pm('#ff7a2a', 0.42), plumeInner: pm('#bcd6ff', 0.75)
    };
    return SHARED;
  }

  class Jet extends MR.Vehicle {
    constructor(scene, def, opts) {
      super(scene, Object.assign({}, DEFAULTS, def || {}), opts);
      const d = this.def = Object.assign({}, MR.Vehicle.DEFAULTS, DEFAULTS, def || {});
      d.gun = Object.assign({}, DEFAULTS.gun, (def && def.gun) || {});
      d.aim = Object.assign({}, DEFAULTS.aim, (def && def.aim) || {});
      d.pilotlessCtl = Object.assign({}, DEFAULTS.pilotlessCtl, (def && def.pilotlessCtl) || {});
      d.deck = Object.assign({}, DEFAULTS.deck, (def && def.deck) || {});
      d.climb = Object.assign({}, DEFAULTS.climb, (def && def.climb) || {});
      d.camAssist = Object.assign({}, DEFAULTS.camAssist, (def && def.camAssist) || {});
      d.hud = Object.assign({}, DEFAULTS.hud, (def && def.hud) || {});
      for (const k of ['maneuver', 'easy', 'autoland', 'missile', 'flares', 'gunAssist', 'gEffect', 'easyCam', 'approach']) d[k] = Object.assign({}, DEFAULTS[k], (def && def[k]) || {});
      this.missileCount = d.missile.count; this.flareCount = d.flares.count; this._missileT = 0; this._flareT = 0;
      d.seat = Array.isArray(d.seat) ? d.seat : DEFAULTS.seat;
      d.exit = Array.isArray(d.exit) ? d.exit : DEFAULTS.exit;
      this.health = num(opts && opts.health, d.health);
      this.ammo = d.gun.ammo;
      this.collider = (opts && opts.collider) || null;
      this.city = (opts && opts.city) || null;
      this.ops = (opts && opts.ops) || (this.city && this.city.carrierOps) || null;
      this.cd0 = d.thrustAB / (d.maxSpeed * d.maxSpeed);
      this.kl = d.gLimit * G / (d.cornerSpeed * d.cornerSpeed);
      this._syncFromGround();
      this._apply();
    }

    _preInit(opts) {
      this.kind = 'jet';
      this.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.p = new THREE.Vector3();          // 重心（世界）
      this.vel = new THREE.Vector3();
      this.mode = 'ground';                  // 'ground'（車輪で地面・甲板）| 'air'
      this.grounded = true; this.airborne = false;
      this.u = 0;                            // 地上: 前への速さ
      this.theta = 0;                        // 地上: 機首上げ（rad、主脚が支点）
      this.steer = 0;                        // 地上: 前輪の角度（rad、右が正）
      this.rates = { p: 0, q: 0, r: 0 };     // 右ロール・機首上げ・右ヨー（rad/s）
      this.alpha = 0; this.beta = 0; this.gload = 1; this.aL = 0;
      this.throttle = 0; this.abOn = false; this._abT = 0;
      this.n = 0; this.ab = 0;               // 回転数の進み（0..1 = アイドル..ミリタリー）・アフターバーナー 0..1
      this.engineOn = false; this.spin = 0;  // 始動 0..1
      this.ctl = { stickX: 0, stickY: 0, aim: null, manual: false, easy: false, invert: false, boost: false, slow: false, thrUp: false, thrDown: false, launch: false };
      this.gAuth = 0;                        // 今の G の上限（gLimit〜maxG。大きく曲がりたいときだけ gOnsetRate で上がる）
      this.gDemand = 0;                      // 大きく曲がりたい度合い 0..1（見る向きのずれ・スティック）
      this._easy = null;                     // かんたん: 保つ向き・高度 { yaw, alt, turning, climbing }
      this.autoland = null;                  // 自動着艦・着陸 { kind, strip, phase, prof, … }
      this.missileCount = 0; this.flareCount = 0;
      this._auto = null;                     // 甲板の自動の地上滑走 { route, src, s, rem, stuck }
      this.deckRoute = null; this._routeT = 0; this._assistBlock = false; this._taxiing = false; this.edgeStop = false;
      this._prot = null;                     // 離陸の直後の上昇 { t, yaw }
      this._oob = false; this.outOfBounds = 0;
      this.aimAssist = null;                 // FCS が見ている向きを置き換えたとき（カメラをそちらへ寄せる: game.js）
      this.groundAvoid = false; this._catCool = 0;
      this.cmd = { n: 1, p: 0, rud: 0, pitchUp: false, steer: 0, brake: false, airbrake: false, pitch: 0, roll: 0 };
      this._push = false;
      this.gearDown = true; this.gearPos = 1;
      this.hookDown = false; this.hookPos = 0;
      this.canopyOpen = true; this.canopyPos = 1;
      this.launchBar = 0;
      this.flaps = 1; this.airbrake = 0;
      this.cat = null; this.arrest = null; this.bolter = false;
      this.rearmT = 0;
      this.stall = 0; this.pullUp = false;
      this.pilotless = false; this.pilotlessT = 0;
      this.agl = 0; this.groundY = 0; this.onWater = false;
      this.cockpit = false;
      this.localInside = false; this.listenerPos = null;
      this.events = [];
      this.landings = []; this.impacts = 0; this.lastImpactSpeed = 0;
      this.stats = { maxSpeed: 0, maxG: 0, minG: 1, maxAlt: 0, collisions: 0, crashes: 0, sweeps: 0, boxes: 0 };
      this.crash = null; this.wreckFall = null;
      this._s0 = HULL.map(() => new THREE.Vector3()); this._s1 = HULL.map(() => new THREE.Vector3());
      this._cands = [];
      this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3(); this._v4 = new THREE.Vector3();
      this._fwd = new THREE.Vector3(); this._upv = new THREE.Vector3(); this._left = new THREE.Vector3();
      this._acc = new THREE.Vector3(); this._dq = new THREE.Quaternion(); this._qi = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
      this._ax = new THREE.Vector3();
      this.hinges = {}; this.mixer = null; this.gearAction = null; this._gearT = -1;
      this._lights = null; this._plumes = null; this._ownMats = [];
      this.abLight = null;
      this.flybyT = 0;
      this._jettisoned = null; this._seatMesh = null;
      this._canon = true; this._parked = null; this._parkedOn = false; // 置いたままの姿勢（まとめた形で描ける）
      this._cgL = new THREE.Vector3(0, 1.95, 0.62);
    }

    // ---------- 見た目 ----------

    // GLB が無いときのコードの戦闘機（ノード名は GLB と同じ。前 +Z、原点は主脚の間の地面）
    static buildFallback(def) {
      const g = new THREE.Group();
      g.name = 'FA18';
      const body = new THREE.Group();
      body.name = 'body';
      g.add(body);
      const mat = (hex, o) => new THREE.MeshStandardMaterial(Object.assign({ color: srgb(hex), roughness: 0.55, metalness: 0.3 }, o || {}));
      const grey = mat(def.color || '#5f676e'), light = mat('#8f959a'), dark = mat('#24282c', { roughness: 0.8 }), white = mat('#d8dcdf', { roughness: 0.7 });
      const metal = mat('#6b6460', { metalness: 0.8, roughness: 0.35 });
      const glass = new THREE.MeshStandardMaterial({ color: srgb('#2a363e'), roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
      const box = (m, w, h, dd, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); o.position.set(x, y, z); (parent || body).add(o); return o; };
      const cyl = (m, r0, r1, len, x, y, z, parent, seg) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg || 14), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); (parent || body).add(o); return o; };
      const empty = (name, x, y, z, parent) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); (parent || body).add(o); return o; };
      const hinge = (name, x, y, z, parent) => { const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); o.userData = Object.assign({}, HINGES[name]); (parent || body).add(o); return o; };
      // 胴体（前が細い）・機首・インテーク・ノズル
      cyl(grey, 0.95, 1.05, 10.4, 0, 2.15, 1.3);
      cyl(grey, 0.6, 0.95, 4.0, 0, 2.15, 8.5);
      cyl(light, 0.05, 0.6, 2.9, 0, 2.1, 11.95);
      box(grey, 2.7, 0.9, 7.5, 0, 2.0, -1.4);
      box(dark, 0.7, 0.8, 1.6, 0.95, 1.75, 3.6); box(dark, 0.7, 0.8, 1.6, -0.95, 1.75, 3.6);
      for (const sx of [0.48, -0.48]) cyl(metal, 0.32, 0.28, 1.3, sx, 2.24, -5.0);
      // 主翼（後退角は箱を回して近似）・水平尾翼・垂直尾翼（左右に傾く）
      for (const s of [1, -1]) {
        const w = box(grey, 5.2, 0.16, 3.4, s * 3.9, 2.15, 0.6); w.rotation.y = s * 0.28;
        box(grey, 1.0, 0.1, 6.0, s * 1.6, 2.1, 4.8).rotation.y = s * 0.12; // ストレーキ
        const fin = box(grey, 0.14, 2.6, 2.6, s * 1.35, 3.75, -4.1); fin.rotation.z = -s * 0.35;
      }
      // 動翼（ヒンジのノード。原点がヒンジ）
      const surf = (name, x, y, z, w, dd, m) => { const h = hinge(name, x, y, z); const o = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, dd), m || grey); o.position.set(x > 0 ? w / 2 * 0.0 : 0, 0, -dd / 2); h.add(o); return h; };
      surf('stab_l', 0.9, 2.1, -3.9, 0.1, 0.1); surf('stab_r', -0.9, 2.1, -3.9, 0.1, 0.1);
      for (const [n, sx] of [['stab_l', 1], ['stab_r', -1]]) { const h = body.getObjectByName(n); const o = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 2.2), grey); o.position.set(sx * 1.4, 0, -1.0); h.add(o); }
      surf('aileron_l', 4.5, 2.12, -0.85, 1.9, 0.6); surf('aileron_r', -4.5, 2.12, -0.85, 1.9, 0.6);
      surf('flap_l', 2.4, 2.2, -0.45, 2.0, 0.8); surf('flap_r', -2.4, 2.2, -0.45, 2.0, 0.8);
      for (const [n, sx] of [['rudder_l', 1], ['rudder_r', -1]]) { const h = hinge(n, sx * 1.55, 3.9, -4.9); const o = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.7), grey); o.position.set(0, 0, -0.35); h.add(o); h.rotation.z = 0; }
      const ab = hinge('airbrake', 0, 2.64, -2.38); { const o = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 1.2), grey); o.position.set(0, 0, 0.6); ab.add(o); }
      // キャノピー（後ろがヒンジ）・風防
      const can = hinge('canopy', 0, 2.94, 3.64);
      { const o = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass); o.name = 'canopy_glass'; o.scale.set(1, 0.85, 3.4); o.position.set(0, 0, 2.3); can.add(o); }
      { const o = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass); o.name = 'body_glass'; o.scale.set(1, 0.8, 1.1); o.position.set(0, 2.95, 7.1); body.add(o); }
      box(dark, 0.9, 0.5, 2.6, 0, 2.7, 5.7); // 操縦席の中
      // フック・発艦バー
      const hk = hinge('hook', 0, 1.53, -3.92);
      { const o = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.8), white); o.position.set(0, 0.0, -0.9); hk.add(o); empty('hook_tip', 0, 0, -1.8, hk); }
      // 脚（脚ごとのグループ: 下ろすと 0、上げると回って隠れる）
      const gear = (name, x, z, len, r, wheelName) => {
        const gg = new THREE.Group(); gg.name = name; gg.position.set(x, len + r * 0.2, z); body.add(gg);
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 8), white); strut.position.set(0, -len / 2, 0); gg.add(strut);
        const w = new THREE.Group(); w.name = wheelName; w.position.set(0, -len - r * 0.2 + r, 0); gg.add(w);
        const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.25, 16), dark); tyre.rotation.z = Math.PI / 2; w.add(tyre);
        return gg;
      };
      const gn = gear('gear_nose', 0, 6.069, 1.4, 0.288, 'wheel_nose');
      const lb = hinge('launch_bar', 0, -0.9, 0.2, gn); { const o = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.75), white); o.position.set(0, 0, 0.37); lb.add(o); }
      gear('gear_main_l', 1.517, 0, 1.2, 0.387, 'wheel_main_l');
      gear('gear_main_r', -1.517, 0, 1.2, 0.387, 'wheel_main_r');
      // 空ノード（GLB と同じ位置）
      empty('seat_pilot', 0, 3.06, 6.42); empty('seat_wso', 0, 3.18, 4.88); empty('exit_l', 2.2, 0, 6.0); empty('exit_r', -2.2, 0, 6.0);
      empty('cannon_muzzle', 0, 2.339, 9.362); empty('nozzle_l', 0.48, 2.242, -5.631); empty('nozzle_r', -0.48, 2.242, -5.631);
      empty('light_nav_l', 6.602, 2.042, 0.948); empty('light_nav_r', -6.602, 2.042, 0.948); empty('light_tail', 0, 1.994, -4.996); empty('light_anticol', 0, 3.059, 1.5);
      empty('contact_nose', 0, 0, 6.069); empty('contact_main_l', 1.517, 0, 0); empty('contact_main_r', -1.517, 0, 0);
      empty('cg', 0, 1.95, 0.62); empty('hud', 0, 3.065, 7.29);
      g.userData.source = 'procedural';
      return g;
    }

    // GLB: scene の複製（ジオメトリ・材質は共有）。試作弾（projectiles）は隠す
    static fromScene(scene, def) {
      const g = MR.Vehicle.fromScene(scene, def);
      const pr = g.getObjectByName('projectiles');
      if (pr) pr.visible = false;
      return g;
    }

    // GLB を読む（クリップも使うので Vehicle._loadModel ではなくここで）
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
        this._clips = (res && res.animations) || [];
        this._setModel(g, 'glb');
      }).catch((e) => {
        console.warn('[Jet] ' + key + ' を読めません。コードモデルで続行します:', e && e.message);
      });
    }

    _setModel(group, source) {
      this._stores = null;
      for (const m of this._ownMats || []) m.dispose();
      this._ownMats = [];
      if (this._lights) for (const s of this._lights) if (s.parent) s.parent.remove(s);
      this._lights = null;
      if (this._plumes) for (const pl of this._plumes) if (pl.group.parent) pl.group.parent.remove(pl.group);
      this._plumes = null;
      if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; this.gearAction = null; }
      this._restoreCanopy();
      this._dropParked();
      super._setModel(group, source);
      const cg = group.getObjectByName('cg');
      if (cg) this._cgL.copy(cg.position); else this._cgL.fromArray(this.def.cg || DEFAULTS.cg);
      // ヒンジ（userData の axis / min / max、無ければ既定）
      this.hinges = {};
      for (const name of Object.keys(HINGES)) {
        const n = group.getObjectByName(name);
        if (!n) continue;
        const u = n.userData || {}, dflt = HINGES[name];
        const ax = Array.isArray(u.axis) && u.axis.length === 3 ? u.axis : dflt.axis;
        this.hinges[name] = { node: n, axis: new THREE.Vector3().fromArray(ax).normalize(), min: num(u.min, dflt.min), max: num(u.max, dflt.max), q0: n.quaternion.clone(), last: NaN };
      }
      this.canopyNode = group.getObjectByName('canopy');
      this.hookTip = group.getObjectByName('hook_tip');
      this.wheelNodes = ['wheel_nose', 'wheel_main_l', 'wheel_main_r'].map((n) => { const w = group.getObjectByName(n); return w ? { node: w, q0: w.quaternion.clone(), spin: 0, nose: n === 'wheel_nose' } : null; }).filter(Boolean);
      this.gearNodes = ['gear_nose', 'gear_main_l', 'gear_main_r'].map((n) => group.getObjectByName(n)).filter(Boolean);
      this.muzzleL = this._nodePos(group, 'cannon_muzzle', [0, 2.339, 9.362]);
      this.hudL = this._nodePos(group, 'hud', [0, 3.065, 7.29]);
      this.contacts = [this._nodePos(group, 'contact_nose', [0, 0, 6.069]), this._nodePos(group, 'contact_main_l', [1.517, 0, 0]), this._nodePos(group, 'contact_main_r', [-1.517, 0, 0])];
      // 脚のクリップ（GLB）: LoopOnce で止めておき、時間を直接置く（0 = 下りている、1.5 = 上がっている）
      const clip = (this._clips || []).find((c) => c.name === 'gear');
      if (clip && source === 'glb' && THREE.AnimationMixer) {
        this.mixer = new THREE.AnimationMixer(group);
        const act = this.mixer.clipAction(clip);
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
        act.play();
        act.paused = true;
        this.gearAction = act;
        this.gearClipLen = clip.duration || 1.5;
      }
      this._gearT = -1;
      this._casting = undefined;
      // 脚を上げきったら脚の柱・車輪は胴の中（扉は閉じて見えている）: 描かない（飛んでいる間の描画を減らす）
      this._gearInner = this.gearAction ? ['gear_main_l_strut', 'gear_main_r_strut', 'gear_nose_strut', 'gear_nose_brace'].map((n) => group.getObjectByName(n)).filter(Boolean) : [];
      // ガラスは影を落とさない
      group.traverse((o) => { if (o.isMesh && GLASS.indexOf(o.name) >= 0) { o.castShadow = false; o.receiveShadow = false; } });
      for (const name of GLASS) { const n = group.getObjectByName(name); if (n) n.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.jetGlass = true; } }); }
      // 航法灯（左 赤・右 緑・尾 白・背中の衝突防止灯 赤の点滅）
      const S = shared();
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
      this._lights = [mk('light_nav_l', S.red, 0.7), mk('light_nav_r', S.green, 0.7), mk('light_tail', S.white, 0.6), mk('light_anticol', S.beacon, 1.2)].filter(Boolean);
      // アフターバーナーの炎（ノズルの空ノードの子。-Z へ伸びる）
      this._plumes = [];
      for (const name of ['nozzle_l', 'nozzle_r']) {
        const n = group.getObjectByName(name);
        if (!n) continue;
        const pg = new THREE.Group();
        pg.name = name + '_plume';
        const outer = new THREE.Mesh(S.plumeOuterGeo, S.plumeOuter), inner = new THREE.Mesh(S.plumeInnerGeo, S.plumeInner);
        for (const m of [outer, inner]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.renderOrder = 3; }
        const core = new THREE.Sprite(S.core);
        core.scale.set(0.9, 0.9, 1);
        core.position.set(0, 0, -0.2);
        core.renderOrder = 3;
        pg.add(outer, inner, core);
        pg.visible = false;
        n.add(pg);
        this._plumes.push({ group: pg, outer, inner, core });
      }
      if (this.cockpit) this.setCockpit(true, true);
      this._animate(0, true);
      if (this.quat) this._apply();
    }

    // ノードの位置（機体の座標 = root から見た位置）。GLB は後から届く（端末では機体を置いて描いた後）: そのときこの group はもう世界に置いた
    //  root の子なので matrixWorld は世界の座標。root の行列を外して機体の座標に戻す（外さないと接地点・銃口・HUD が 2 km 先になり、
    //  甲板の自動走行が「ふさがれている」になり、発艦の直後に機首が上がると遠くの接地点が水面の下へ入って「着水」で墜落した）
    _nodePos(group, name, dflt) {
      const n = group.getObjectByName(name);
      if (!n) return new THREE.Vector3().fromArray(dflt);
      group.updateMatrixWorld(true);
      const v = new THREE.Vector3().setFromMatrixPosition(n.matrixWorld);
      if (group.parent) v.applyMatrix4(new THREE.Matrix4().copy(group.parent.matrixWorld).invert());
      return v;
    }

    // 自分が一人称で乗っている: 機体のメッシュをレイヤー 1 にも、ガラスはレイヤー 1 だけ（本体のパスでは描かない。近いカメラのパスで描く）
    setCockpit(on, force) {
      on = !!on;
      if (on === this.cockpit && !force) return;
      this.cockpit = on;
      if (!this.model) return;
      this.model.traverse((o) => {
        if (!o.isMesh && !o.isSprite) return;
        if (o.isSprite && o.parent && /_plume$/.test(o.parent.name)) return;
        if (on) { o.layers.enable(1); if (o.userData.jetGlass) o.layers.disable(0); }
        else { o.layers.disable(1); o.layers.enable(0); }
      });
    }

    // 止めてある機体: まとめた形（GLB ごとに共有）と元のノードを入れ替える
    _showParked(on) {
      if (on) {
        if (!this.model || this.modelSource !== 'glb' || this.cockpit) return;
        const key = 'glb:' + (this.model.userData.file || this.def.model);
        if (!PARKED.has(key)) {
          // 作るときは置いたままの姿勢（脚の時間・動翼）を確かに当ててから
          this._animate(0, true);
          let built = null;
          try { built = buildParked(this.model); } catch (e) { built = null; }
          PARKED.set(key, built);
          Jet.parkedStats.built++;
        }
        const pk = PARKED.get(key);
        if (!pk) return;
        if (!this._parked || this._parked.key !== key) {
          this._dropParked();
          const grp = new THREE.Group();
          grp.name = 'jet_parked';
          for (const pt of pk.parts) {
            const m = new THREE.Mesh(pt.geo, pt.mat);
            m.castShadow = pt.cast; m.receiveShadow = pt.recv; m.renderOrder = pt.order;
            m.matrixAutoUpdate = false;
            grp.add(m);
          }
          grp.position.copy(this.model.position); grp.quaternion.copy(this.model.quaternion); grp.scale.copy(this.model.scale);
          this.root.add(grp);
          this._parked = { key, group: grp };
        }
        this._parked.group.visible = true;
        this.model.visible = false;
        this._parkedOn = true;
        return;
      }
      if (this._parked) this._parked.group.visible = false;
      if (this.model) this.model.visible = true;
      this._parkedOn = false;
    }
    _dropParked() {
      if (this._parked) { if (this._parked.group.parent) this._parked.group.parent.remove(this._parked.group); this._parked = null; } // 形は共有（捨てない）
      if (this.model) this.model.visible = true;
      this._parkedOn = false;
    }

    // ---------- 座標 ----------

    toWorld(local, target) { return (target || new THREE.Vector3()).copy(local).applyQuaternion(this.quat).add(this.pos); }
    center(target) { return this.toWorld(this._cgL, target); }
    get speedKmh() { return this.speed * 3.6; }
    get speedRatio() { return clamp(this.speed / this.def.maxSpeed, 0, 1); }
    forward(target) { return (target || new THREE.Vector3()).set(0, 0, 1).applyQuaternion(this.quat); }
    // 世界の向き（機首・上・左）
    axes() {
      this._fwd.set(0, 0, 1).applyQuaternion(this.quat);
      this._upv.set(0, 1, 0).applyQuaternion(this.quat);
      this._left.set(1, 0, 0).applyQuaternion(this.quat);
      return this;
    }
    // 重心 p と姿勢から原点 pos（と yaw / pitch / roll）を作る
    _syncPos() {
      const c = this._v4.copy(this._cgL).applyQuaternion(this.quat);
      this.pos.copy(this.p).sub(c);
      this._e.setFromQuaternion(this.quat, 'YXZ');
      this.yaw = this._e.y; this.pitch = this._e.x; this.roll = this._e.z;
    }
    // 地上: 原点 pos・ヨー・機首上げ theta から姿勢と重心
    _syncFromGround() {
      this._qi.setFromAxisAngle(this._ax.set(0, 1, 0), this.yaw);
      this._dq.setFromAxisAngle(this._ax.set(1, 0, 0), -this.theta);
      this.quat.copy(this._qi).multiply(this._dq);
      this.p.copy(this._cgL).applyQuaternion(this.quat).add(this.pos);
      this._e.setFromQuaternion(this.quat, 'YXZ');
      this.pitch = this._e.x; this.roll = 0;
    }
    // 機首の上げ下げ（度。上が正）・右への傾き（度）
    get pitchDeg() { this.axes(); return Math.asin(clamp(this._fwd.y, -1, 1)) / D2R; }
    get bankDeg() { this.axes(); return Math.atan2(this._left.y, this._upv.y) / D2R; }
    get headingDeg() { this.axes(); const h = Math.atan2(this._fwd.x, this._fwd.z) / D2R; return (h + 360) % 360; }

    // 経路探索の箱（地上にいるときだけ）
    aabb() {
      if (this.mode !== 'ground' || (this.wrecked && this.wreckFall)) return null;
      const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw));
      const hw = this.def.width / 2, hl = this.def.length / 2;
      const cz = 2.4;
      return { x: this.pos.x + Math.sin(this.yaw) * cz, z: this.pos.z + Math.cos(this.yaw) * cz, w: 2 * (hw * c + hl * s), d: 2 * (hw * s + hl * c), y: this.pos.y, h: 5 };
    }
    // 点 (x, z) から胴体の長方形まで（乗れる距離）
    distanceTo(x, z) {
      const l = this.toLocal(x, z);
      const dx = Math.max(0, FUSE.x0 - l.x, l.x - FUSE.x1), dz = Math.max(0, FUSE.z0 - l.z, l.z - FUSE.z1);
      return Math.sqrt(dx * dx + dz * dz);
    }
    // 歩いている人を胴体の外へ（主翼の下はくぐれる）
    pushOut(p, radius) {
      if (this.mode !== 'ground' || this.sunk) return false;
      const l = this.toLocal(p.x, p.z);
      const x0 = FUSE.x0 - radius, x1 = FUSE.x1 + radius, z0 = FUSE.z0 - radius, z1 = FUSE.z1 + radius;
      if (l.x <= x0 || l.x >= x1 || l.z <= z0 || l.z >= z1) return false;
      const e = [l.x - x0, x1 - l.x, l.z - z0, z1 - l.z];
      let m = 0;
      for (let k = 1; k < 4; k++) if (e[k] < e[m]) m = k;
      let lx = l.x, lz = l.z;
      if (m === 0) lx = x0; else if (m === 1) lx = x1; else if (m === 2) lz = z0; else lz = z1;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      p.x = this.pos.x + lx * c + lz * s;
      p.z = this.pos.z - lx * s + lz * c;
      return true;
    }
    // 他の乗り物の円を胴体の円の外へ（相手の当たり判定から呼ばれる）
    _pushCircle(x, z, r) {
      if (this.mode !== 'ground' && !this.wrecked) return { x, z };
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      for (const lz of [9, 5, 1, -3, -6]) {
        const cx = this.pos.x + lz * s, cz = this.pos.z + lz * c;
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz, minD = r + 1.3;
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = Math.sqrt(d2), push = (minD - d) * 0.5;
        x += dx / d * push; z += dz / d * push;
      }
      return { x, z };
    }

    // 弾（レイ）: 胴体・主翼・尾翼の箱（機体の座標に直して判定）
    intersectRay(origin, dir, maxT) {
      if (!MR.Nav || typeof MR.Nav.rayBox !== 'function' || this.sunk) return null;
      const q = this._qi.copy(this.quat).invert();
      const o = this._v1.copy(origin).sub(this.pos).applyQuaternion(q);
      const dd = this._v2.copy(dir).applyQuaternion(q);
      const my = this.model ? this.model.position.y : 0;
      o.y -= my;
      let best = null, bb = null;
      for (const b of BOXES) {
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
      return { t: best, point: origin.clone().addScaledVector(dir, best), normal };
    }

    // ---------- 乗り降り ----------

    enter(player, seatIndex) {
      if (this.wrecked || this.sinking) return false;
      const i = seatIndex === -1 ? this.freeSeat() : (typeof seatIndex === 'number' ? seatIndex : 0);
      if (i < 0 || i >= this.seatCount) return false;
      if (typeof seatIndex === 'number' && this.occupants[i] && this.occupants[i] !== player) return false;
      this.occupants[i] = player;
      if (i === 0) {
        this.ctl.stickX = 0; this.ctl.stickY = 0; this.ctl.aim = null;
        this.pilotless = false; this.pilotlessT = 0;
        if (this.mode === 'ground') this.throttle = 0;
        this.abOn = false;
        this._resetPilotState();
        this.setCanopy(false);
        if (this.audio && typeof this.audio.prepareJet === 'function') this.audio.prepareJet();
      }
      return true;
    }

    exit(who) {
      const i = who ? this.seatOf(who) : 0;
      if (i > 0) this.occupants[i] = null;
      else {
        // カタパルトにつないで待っている（位置合わせ・全開待ち）ときは降りられる: 外す
        if (this.cat && (this.cat.ph === 'align' || this.cat.ph === 'ready')) { this.cat = null; this.launchBar = Math.min(this.launchBar, 1); this.events.push({ t: 'cat_unhook', why: 'exit' }); }
        this.clearDriver();
      }
      if (this.mode === 'ground' && this.u < 2 && !this._jettisoned) this.setCanopy(true);
    }

    // 乗った・降りた・復活: 操縦の途中の状態を消す（前の人の自動の地上滑走・上昇・地図の端・カタパルトの待ち時間を持ち越さない）
    _resetPilotState() {
      this._auto = null; this.deckRoute = null; this._routeT = 0; this._assistBlock = false; this.edgeStop = false;
      this._prot = null; this._spdProt = false; this._oob = false; this.outOfBounds = 0; this.aimAssist = null; this.groundAvoid = false;
      this._catCool = 0; this._abT = 0; this._push = false; this._turnSide = 0; this.ctl.launch = false;
      this._pendingLaunch = false; this._revT = 0; this._revAcc = null; this._holdBrake = false; this.stopWhy = null; this._wantT = 0; this._retryAt = 0; this._routePose = null;
      this.deckBusy = false; this.deckWait = false; this.deckWaitWhy = null; this.deckFoul = null; this._foulKind = null; this._busyOcc = []; this._abandonT = 0; this._waitedT = 0; this._tA = null; this._held = null;
      this._easy = null; this.autoland = null; this.gDemand = 0; this.gAuth = this.def ? this.def.gLimit : 0; this._gPeak = 0;
    }

    clearDriver() {
      this.driver = null;
      this._auto = null; this._held = null; this._roadGo = false; this.ctl.launch = false; this._revAcc = null; this._revT = 0; this._pendingLaunch = false; this.deckWait = false;
      this.ctl.stickX = 0; this.ctl.stickY = 0; this.ctl.aim = null; this.ctl.boost = false; this.ctl.slow = false;
      this.autoland = null; this._easy = null;
      this.abOn = false;
      if (this.mode === 'ground') this.throttle = 0;
    }

    // 射出: キャノピーが飛び、座席が上がる（プレイヤーは game.js がパラシュートで降ろす）。機体は無人で飛び続ける
    eject(fx) {
      const c = this.canopyNode;
      const scene = this.scene;
      if (c && c.parent && !this._jettisoned) {
        const parent = c.parent;
        this._canopyHome = { parent, pos: c.position.clone(), quat: c.quaternion.clone() };
        scene.attach(c);
        const v = this._v1.set(0, 9, -4).applyQuaternion(this.quat).add(this.vel);
        this._jettisoned = { node: c, vel: v.clone(), spin: new THREE.Vector3(2.5, 0.4, 0.3), t: 0 };
      }
      // 座席（箱）: 上へ飛んで少し後に離れて落ちる
      const seat = new THREE.Mesh(Jet._seatGeo || (Jet._seatGeo = new THREE.BoxGeometry(0.7, 1.1, 0.8)), Jet._seatMat || (Jet._seatMat = new THREE.MeshStandardMaterial({ color: srgb('#3d4130'), roughness: 0.8 })));
      seat.position.copy(this.seatWorld(0, this._v2));
      seat.quaternion.copy(this.quat);
      scene.add(seat);
      if (this._seatMesh && this._seatMesh.mesh.parent) this._seatMesh.mesh.parent.remove(this._seatMesh.mesh);
      this._seatMesh = { mesh: seat, vel: this._v3.set(0, this.def.ejectSpeed, 0).applyQuaternion(this.quat).add(this.vel).clone(), t: 0 };
      if (fx && typeof fx.smoke === 'function') fx.smoke(seat.position, 1.2);
      this._sound('missile_launch', 0.8, this.seatWorld(0, this._v2), { rate: 0.8, refDistance: 15, maxDistance: 600 });
      this.clearDriver();
      this.pilotless = !this.grounded || this.u > 3;
      this.pilotlessT = 0;
      this.events.push({ t: 'eject' });
    }

    _restoreCanopy() {
      const j = this._jettisoned;
      if (!j) return;
      this._jettisoned = null;
      if (j.node.parent) j.node.parent.remove(j.node);
      const h = this._canopyHome;
      if (h && h.parent) { h.parent.add(j.node); j.node.position.copy(h.pos); j.node.quaternion.copy(h.quat); }
      j.node.visible = true; // 飛んでいる間に隠した（_updateDebris）
      const hc = this.hinges && this.hinges.canopy;
      if (hc) hc.last = NaN; // 次の _animate でヒンジの角度を当て直す
    }

    // ---------- 操縦 ----------

    setControls(throttle, steer) { this.setJetControls({ stickY: throttle, stickX: steer }); }
    // 毎フレーム（操縦席から）: { stickX, stickY, aim（世界の単位ベクトル。null で無し）, manual, thrUp, thrDown }
    setJetControls(o) {
      const c = this.ctl;
      c.stickX = clamp(num(o.stickX, 0), -1, 1);
      c.stickY = clamp(num(o.stickY, 0), -1, 1);
      c.manual = !!o.manual || o.scheme === 'manual';
      c.easy = o.scheme === 'easy';
      c.invert = !!o.invert; c.boost = !!o.boost; c.slow = !!o.slow;
      c.thrUp = !!o.thrUp; c.thrDown = !!o.thrDown;
      if (o.launch) c.launch = true; // 発艦ボタン（押した瞬間。_fcs が使って消す）
      if (o.aim && isFinite(o.aim.x)) { if (!c.aim) c.aim = new THREE.Vector3(); c.aim.set(o.aim.x, o.aim.y, o.aim.z).normalize(); }
      else c.aim = null;
    }
    toggleGear() {
      if (this.mode === 'ground' && this.gearDown) { this.events.push({ t: 'gear_locked' }); return false; } // 地上では上げられない
      this.gearDown = !this.gearDown;
      this._sound('gear_motor', 0.9, this.center(this._v1), { refDistance: 10, maxDistance: 200 });
      this.events.push({ t: 'gear', down: this.gearDown });
      return true;
    }
    setCanopy(open) {
      open = !!open;
      if (open === this.canopyOpen) return;
      this.canopyOpen = open;
      this._sound('canopy_motor', 0.8, this.seatWorld(0, this._v1), { refDistance: 6, maxDistance: 80, rate: open ? 1 : 0.95 });
    }
    horn() { }
    attachHeadlight() { }
    attachAbLight(light) { this.abLight = light || null; }

    // ---------- ダメージ・爆発 ----------

    hit(amount, point, ctx) { return this.damage(num(amount, 0) * this.def.armor, ctx); }

    _explode(ctx) {
      const vx = this.vel.x, vy = this.vel.y, vz = this.vel.z, air = this.mode === 'air';
      super._explode(ctx);
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.engineOn = false; this.n = 0; this.ab = 0; this.abOn = false; this.throttle = 0;
      this.cat = null; this.arrest = null;
      const c = this.center(this._v1);
      this._sound('explosion_large', 1, c, { refDistance: 25, maxDistance: 1200, priority: 3 });
      // 残骸: 空中なら勢いのまま落ちる（下の面で止まる・水なら沈む）
      this.wreckFall = air ? { vx: vx * 0.5, vy: Math.min(vy, 5), vz: vz * 0.5, spin: (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random()) } : null;
      this.vel.set(0, 0, 0); this.u = 0;
      if (this._plumes) for (const pl of this._plumes) pl.group.visible = false;
      if (this.abLight) this.abLight.intensity = 0;
      this._apply();
    }

    // 爆発の見た目: 火球 1 つ（explodeFx m、粒の数は explodeFxCount 倍。スプライト 1 つで 1 回描くので多くしない。フェーズ E3 で作り直す）
    _explodeFx(c) { if (this.fx && typeof this.fx.explosion === 'function') this.fx.explosion(c, this.def.explodeFx, this.def.explodeFxCount); }

    // 墜落（地面・建物・水・空母）: 爆発させる
    _crash(kind, speed, ctx, box) {
      if (this.wrecked) return;
      this.crash = { kind, speed: +speed.toFixed(1), t: +this.time.toFixed(2), x: +this.pos.x.toFixed(1), y: +this.pos.y.toFixed(1), z: +this.pos.z.toFixed(1) };
      if (box) this.crash.box = [box.x0, box.y0, box.z0, box.x1, box.y1, box.z1].map((v) => +v.toFixed(1));
      this.stats.crashes++;
      this.events.push({ t: 'crash', kind, speed });
      this.health = 0;
      this.netControlled ? this.netExplode(ctx) : this._explode(ctx);
      if (kind === 'water') {
        if (this.audio && this.audio.splash) this.audio.splash(this.center(this._v1), true);
        if (this.fx && this.fx.splash) this.fx.splash(this._v1.set(this.pos.x, this.groundY + 0.05, this.pos.z), 4);
      }
    }

    _updateWreck(dt, ctx) {
      const wf = this.wreckFall;
      if (wf) {
        wf.vy = Math.max(-60, wf.vy - this.def.wreckGravity * dt);
        const k = Math.max(0, 1 - dt * 0.3);
        wf.vx *= k; wf.vz *= k;
        this._qi.setFromAxisAngle(this._ax.set(0, 0, 1), wf.spin * dt);
        this.quat.multiply(this._qi);
        this.p.x += wf.vx * dt; this.p.y += wf.vy * dt; this.p.z += wf.vz * dt;
        this._syncPos();
        const S = this._support(ctx, this.pos.x, this.pos.z, this.p.y);
        const hitBox = this._wreckHit(ctx);
        if (S.y !== null && this.pos.y <= S.y + 0.5) { this._settleWreck(S.y); }
        else if (S.y === null && S.water !== null && this.p.y <= S.water + 1) {
          this.wreckFall = null; this.sunk = true; this.root.visible = false;
          if (this.audio && this.audio.splash) this.audio.splash(this.center(this._v1), true);
          if (this.fx && this.fx.splash) this.fx.splash(this._v1.set(this.p.x, S.water + 0.05, this.p.z), 4);
        } else if (hitBox) { wf.vx *= -0.2; wf.vz *= -0.2; }
        if (this.p.y < -60) { this.wreckFall = null; this.sunk = true; this.root.visible = false; }
        this._apply();
      }
      this.respawnTimer -= dt;
      this.smokeTimer -= dt;
      if (this.fx && !this.sunk && this.smokeTimer <= 0 && this.respawnTimer > this.def.respawn * 0.2) {
        this.smokeTimer = this.def.wreckSmokeEvery * (0.8 + Math.random() * 0.4);
        const L = this._v3.set((Math.random() - 0.5) * 3, 2.2 + Math.random(), (Math.random() - 0.5) * 8);
        const p = this.toWorld(L, this._v2);
        if (typeof this.fx.blackSmoke === 'function') this.fx.blackSmoke(p, 2 + Math.random()); else if (this.fx.smoke) this.fx.smoke(p, 1.5);
        if (this.respawnTimer > this.def.respawn * 0.5 && typeof this.fx.fire === 'function') this.fx.fire(p, 1.6);
      }
      this._updateDebris(dt);
      if (this.respawnTimer <= 0 && !this.netControlled) {
        const pl = ctx && ctx.player;
        const far = !pl || Math.hypot(pl.pos.x - this.spawnPos.x, pl.pos.z - this.spawnPos.z) > 20;
        if (far || this.respawnTimer < -this.def.respawn) this.respawn();
      }
    }
    _wreckHit(ctx) {
      // 残骸が建物の箱に入ったら横の勢いを止める（中心だけ）
      const coll = this.collider;
      if (!coll) return false;
      return !!coll.inside(this.p.x, this.p.y, this.p.z);
    }
    _settleWreck(y) {
      this.wreckFall = null;
      this._e.setFromQuaternion(this.quat, 'YXZ');
      this.yaw = this._e.y;
      this.theta = 0;
      this.pos.set(this.pos.x, y, this.pos.z);
      this._qi.setFromAxisAngle(this._ax.set(0, 1, 0), this.yaw);
      this._dq.setFromAxisAngle(this._ax.set(0, 0, 1), 0.12);
      this.quat.copy(this._qi).multiply(this._dq);
      this.p.copy(this._cgL).applyQuaternion(this.quat).add(this.pos);
      this.mode = 'ground'; this.grounded = true; this.airborne = false;
      const c = this.center(this._v1);
      if (this.fx && this.fx.explosion) this.fx.explosion(c, this.def.explodeFx * 0.6, this.def.explodeFxCount * 0.6);
      this._sound('vehicle_impact', 1, c, { refDistance: 15, maxDistance: 400 });
    }

    respawn() {
      this._restoreCanopy();
      super.respawn();
      this.vel.set(0, 0, 0); this.u = 0; this.theta = 0; this.steer = 0;
      this.rates.p = 0; this.rates.q = 0; this.rates.r = 0;
      this.mode = 'ground'; this.grounded = true; this.airborne = false;
      this.wreckFall = null; this.crash = null; this.cat = null; this.arrest = null; this.bolter = false;
      this.throttle = 0; this.abOn = false; this.n = 0; this.ab = 0; this.engineOn = false; this.spin = 0;
      this.gearDown = true; this.gearPos = 1; this.hookDown = false; this.hookPos = 0; this.canopyOpen = true; this.canopyPos = 1; this.launchBar = 0;
      this.ammo = this.def.gun.ammo; this.pilotless = false; this.pilotlessT = 0;
      this.missileCount = this.def.missile.count; this.flareCount = this.def.flares.count; this._storesShow();
      this._resetPilotState(); this._taxiing = false;
      for (let i = 0; i < this.occupants.length; i++) this.occupants[i] = null;
      this.flaps = 1; this.airbrake = 0; this.steer = 0; this.cmd.pitchUp = false; this.cmd.steer = 0;
      if (this.wheelNodes) for (const w of this.wheelNodes) w.spin = 0;
      this._syncFromGround();
      this._animate(0, true);
      this._canon = true;
      this._apply();
    }

    // ---------- 更新 ----------

    update(dt, ctx) {
      this.time += dt;
      if (this.disposed) return;
      this._updateDebris(dt);
      if (this.wrecked || this.sinking) { this._canon = false; if (this._parkedOn) this._showParked(false); if (this._casting === false) this._setCast(true); }
      if (this.wrecked) { this._updateWreck(dt, ctx); this._engineAudio(dt); return; }
      if (this.sinking) { this._updateSink(dt, ctx); return; }
      const pilot = !!this.driver;
      if (this._catCool > 0) this._catCool -= dt; // 止めてある間も数える（降りて乗り直したときに残らない）
      if (!pilot && this.ops && this.mode === 'ground' && !this.netControlled && this.spawnPos && !this.occupants.some(Boolean)) this._clearDeck(dt, ctx);
      else this._foulKind = null;
      // 止めてある機体（地上・エンジン停止・無人・止まっている）は何もしない（甲板に何機あっても安い）。置いたままの姿勢ならまとめた形で描く
      if (!pilot && this.mode === 'ground' && !this.engineOn && this.spin <= 0 && Math.abs(this.u) < 1e-3 && !this.cat && !this.arrest && this.theta < 1e-3 && this._settled()) {
        this.speed = 0;
        // 乗って降りた・地上で射出した機体も、止まって脚・キャノピー（開）・フックが元に戻ったら置いたままの姿勢に揃える（まとめた形で描ける）
        if (!this._canon && this.canopyOpen && this.gearDown) {
          this.flaps = 1; this.airbrake = 0; this.steer = 0; this.theta = 0;
          this.cmd.n = 1; this.cmd.p = 0; this.cmd.rud = 0; this.cmd.steer = 0; this.cmd.pitchUp = false;
          if (this.wheelNodes) for (const w of this.wheelNodes) w.spin = 0;
          this._animate(0, true);
          this._canon = true;
        }
        if (this._canon && !this._parkedOn && this.canopyOpen && this.gearDown && this.flaps >= 1 && this.airbrake <= 0 && this.missileCount >= this.def.missile.count) this._showParked(true);
        return;
      }
      this._canon = false;
      if (this._parkedOn) this._showParked(false);
      if (this.pilotless) {
        this.pilotlessT += dt;
        if (this.pilotlessT > this.def.pilotlessTime && this.mode === 'air') this._crash('ground', this.speed, ctx); // 念のため（地図の外に飛んでいった）
        if (this.wrecked) return;
      }
      this._engineStep(dt, pilot);
      this._fcs(dt, ctx);
      // 当たり判定の掃引: 前の機体の球の位置
      this._hullWorld(this._s0);
      let p0x = this.p.x, p0y = this.p.y, p0z = this.p.z;
      // 1 歩は 1/60 秒以下。大きな G で速く回っている間は 1 歩の回転を maneuver.maxStepTurn rad まで（細かく刻む）
      const M = this.def.maneuver;
      let n = Math.max(1, Math.ceil(dt * 60 - 1e-6));
      if (this.mode === 'air' && this.speed > 20) {
        const w = Math.abs(this.gload) * G / this.speed;
        n = Math.min(Math.max(n, M.maxSteps), Math.max(n, Math.ceil(w * dt / M.maxStepTurn - 1e-6)));
      }
      const h = dt / n;
      // 掃引は前の位置から今の位置へのまっすぐな線: 速く回っている間は機体が maneuver.sweepTurn rad 回るごとに区切る（半径 30 m の旋回でも角を切らない）
      const q0 = (this._qSeg || (this._qSeg = new THREE.Quaternion())).copy(this.quat);
      for (let k = 0; k < n; k++) {
        if (this.mode === 'air' && this._attOn) this._fcsAtt(h, this._attAim);
        if (this.mode === 'air') this._flyStep(h, ctx);
        else this._groundStep(h, ctx);
        if (this.wrecked) return;
        const last = k === n - 1;
        if (!last && !(this.mode === 'air' && 2 * Math.acos(Math.min(1, Math.abs(q0.dot(this.quat)))) > M.sweepTurn)) continue;
        this._hullWorld(this._s1);
        const hit = this._sweep(ctx);
        if (hit) {
          // 当たる直前まで戻す
          const t = Math.max(0, hit.t - 0.02);
          this.p.set(p0x + (this.p.x - p0x) * t, p0y + (this.p.y - p0y) * t, p0z + (this.p.z - p0z) * t);
          this._syncPos();
          this._onHit(hit, ctx);
          if (this.wrecked) return;
          break;
        }
        if (!last) {
          for (let i = 0; i < this._s0.length; i++) this._s0[i].copy(this._s1[i]);
          p0x = this.p.x; p0y = this.p.y; p0z = this.p.z; q0.copy(this.quat);
          this.stats.segs = (this.stats.segs || 0) + 1;
        }
      }
      if (this.mode === 'air') this._checkGround(ctx);
      if (this.wrecked) return;
      this.speed = this.mode === 'air' ? this.vel.length() : Math.abs(this.u);
      if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;
      if (this.p.y > this.stats.maxAlt) this.stats.maxAlt = this.p.y;
      this._carrier(dt, ctx);
      this._autoSystems(dt, ctx);
      this._animate(dt);
      this._apply();
      this._engineAudio(dt);
    }

    _settled() { return Math.abs(this.gearPos - (this.gearDown ? 1 : 0)) < 1e-3 && Math.abs(this.canopyPos - (this.canopyOpen ? 1 : 0)) < 1e-3 && this.hookPos <= 1e-3 && this.launchBar <= 1e-3 && !this._jettisoned && !this._seatMesh; }

    // エンジン: 操縦士がいるか空中なら回す（始動 startTime 秒）。回転数は spoolTime、アフターバーナーは abTime で追う
    _engineStep(dt, pilot) {
      const d = this.def;
      const run = pilot || this.mode === 'air' || this.cat;
      if (run) {
        if (!this.engineOn) this.engineOn = true;
        this.spin = Math.min(1, this.spin + dt / d.startTime);
      } else {
        this.spin = Math.max(0, this.spin - dt / d.spinDownTime);
        if (this.spin <= 0) this.engineOn = false;
        this.throttle = 0; this.abOn = false;
      }
      const thrT = this.spin >= 1 ? this.throttle : 0;
      this.n += (thrT - this.n) * Math.min(1, dt / d.spoolTime);
      const abT = this.abOn && this.spin >= 1 && this.n > 0.9 ? 1 : 0;
      this.ab += clamp(abT - this.ab, -dt / (d.abTime * 1.4), dt / d.abTime);
    }
    // 推力（m/s²、機首の向き）。高いと弱まる
    _thrust() {
      const d = this.def;
      if (!this.engineOn) return 0;
      const base = (d.idleThrust + (d.thrustMil - d.idleThrust) * this.n) * this.spin + this.ab * (d.thrustAB - d.thrustMil);
      return base * this._density();
    }
    _density() { const d = this.def; return clamp(1 - (this.p.y - d.ceiling) / d.ceilingSoft, 0.15, 1); }
    // 機動の揚力（m/s²）: maxG × smooth(fromSpeed, fullSpeed, 速さ)。G の上限 gAuth が gLimit を超えている（大きく曲がりたい）ときだけ効く
    _kqMan(V) { const d = this.def, M = d.maneuver; return d.maxG * G * M.liftMargin * smooth(M.fromSpeed, M.fullSpeed, V) * this._density(); }
    // 機動の揚力を混ぜる割合 0..1（gAuth が gLimit から maneuver.blendG G 上がるまでに 1）。0 なら今までの空力のまま
    //  （今の G が gLimit + 1 を超えている間も: G を抜く途中で今までの減衰・揚力に戻ると逆へ回る）
    //  ただし今の G で効かせるのは、少し前まで G の上限を上げていた分（_gPeak: gAuth の最大を maneuver.peakDecay × gOnsetRate G/s で下げたもの）まで。
    //  上限を上げていないのに跳ね返り・ボルターなどで一瞬 gLimit + 1 を超えただけで機動の揚力が入り、G がさらに上がる（正の帰還）のを防ぐ
    _manBlend() {
      const d = this.def, gp = Math.max(this.gAuth || d.gLimit, this._gPeak || d.gLimit);
      return clamp((Math.max(this.gAuth, Math.min(Math.abs(this.gload) - 1, gp)) - d.gLimit) / Math.max(1e-3, d.maneuver.blendG), 0, 1);
    }
    // 大きな G の割合 0..1（ロール・負の G の上限を広げる）: gAuth が gLimit から (maxG − gLimit) / 4 までで 1
    _authFrac() { const d = this.def; return clamp((this.gAuth - d.gLimit) / Math.max(1, (d.maxG - d.gLimit) * 0.25), 0, 1); }
    // 今出せる揚力の上限（機動の揚力を含む。gAuth = gLimit なら _liftMax と同じ）
    _liftEff(V) { const a = this._liftMax(V), b = this._manBlend(); return b > 0 ? a + (Math.max(a, this._kqMan(V)) - a) * b : a; }
    // G の上限を動かす: 欲しい度合い demand（0..1）→ 目標 gLimit + (maxG − gLimit) × demand へ、上がるのは gOnsetRate G/s、下がるのは × maneuver.release
    _gStep(dt, demand) {
      const d = this.def;
      this.gDemand = demand;
      // 目標の上限は今の速さで機動の揚力が出せる G まで（遅いと gLimit のまま = 今までの操縦）
      const cap = clamp(this._kqMan(this.speed) * 0.95 / G, d.gLimit, d.maxG);
      const tgt = d.gLimit + (cap - d.gLimit) * clamp(demand, 0, 1);
      if (this.gAuth < tgt) this.gAuth = Math.min(tgt, this.gAuth + d.gOnsetRate * dt);
      else this.gAuth = Math.max(Math.max(d.gLimit, tgt), this.gAuth - d.gOnsetRate * d.maneuver.release * dt);
      this._gPeak = Math.max(this.gAuth, (this._gPeak || d.gLimit) - d.gOnsetRate * num(d.maneuver.peakDecay, 0.5) * dt);
    }
    // ロールの速さの上限（°/s）: G の上限に合わせて rollRate〜maneuver.rollRateMax
    _rollRate() { const d = this.def; return d.rollRate + (Math.max(d.rollRate, d.maneuver.rollRateMax) - d.rollRate) * this._authFrac(); }
    // 負の G の上限: gMin〜minG
    _gNeg() { const d = this.def; return d.gMin + (d.minG - d.gMin) * this._authFrac(); }
    // 今の速さで出せる揚力の上限（m/s²、失速角で）
    _liftMax(V) {
      const d = this.def, landing = this.gearPos > 0.5, vs = landing ? d.stallSpeedLanding : d.stallSpeed;
      return this.kl * V * V * smooth(vs - d.stallBand, vs + 2, V) * this._density() * (landing ? d.landingLift : 1);
    }

    // 見た方へ飛ぶときの見ている向きの下限（経路角、rad。aim の floorAgl〜landingMargin の説明）。前の地面・建物（_terrainAhead）の
    //   点ごとに（距離 s、高さ H）: 今から pullReact 秒は今のまま進み、そこから引き起こし（揚力の上限 × pullFrac − G の pullSafety 分の 1）で
    //   H + floorAgl を越えるのに要る経路角 tanγ = (H + floorAgl − y) / s' − s' / (2 × 半径)（s' = s − 速さ × pullReact）。一番大きいもの。
    //   下を見続けても高さは floorAgl m の上へなめらかに近づくだけ（下りて引き起こし、また下りる、をくり返さない）。高い所からの急降下・
    //   建物の間の通りへの浅い降下（機銃で撃つ）はできる。すぐ前（s' < 1 m）の点・真下が floorAgl より高いときは atan(高さの不足 / (s + 速さ × nearTau))。
    //   下りていて、引き起こしに要る高さより低い → floorPitch°（念のため）
    _groundFloor(ctx, V) {
      const d = this.def, A = d.aim, m = A.floorAgl;
      const T = this._terrainAhead(ctx, V);
      const Vg = Math.max(V, 1), gam = Math.asin(clamp(this.vel.y / Vg, -1, 1)), sink = -this.vel.y;
      const y = this.pos.y;
      const aP = Math.max(G * 0.5, Math.min(d.gLimit * G, this._liftMax(Vg)) * A.pullFrac - G);
      const R = Vg * Vg / aP, Rs = R * A.pullSafety, react = Vg * A.pullReact;
      let floor = -Math.PI / 2, fC = -Math.PI / 2;
      if (T.h0 + m > y) floor = Math.atan2(T.h0 + m - y, Vg * A.nearTau);
      for (let k = 0; k < T.n; k++) {
        const sk = T.s[k], need = T.h[k] + m - y, box = T.k[k] & 2;
        // 建物の箱（帯で見つけた壁）: 反応の距離は点までの距離の半分まで（近い壁は今すぐ引き起こす。反応の距離の内側へ入ったとたんに
        //  下の「すぐ前の点」のゆるい式になり、下限が 30° → 15° に落ちて屋上の角へ当たっていた）
        const se = box ? Math.max(sk - react, sk * 0.5) : sk - react;
        let g;
        if (se < 1) { if (need <= 0) continue; g = box ? Math.atan(need) : Math.atan2(need, sk + Vg * A.nearTau); }
        else g = Math.atan(need / se - se / (2 * Rs));
        if (T.k[k] & 1) { if (g > fC) fC = g; } else if (g > floor) floor = g;
      }
      if (gam < 0 && y - T.h0 < R * (1 - Math.cos(gam)) + sink * A.pullReact + m) floor = Math.max(floor, A.floorPitch * D2R);
      // 今の道すじ（まっすぐ・今の弧）の下限 _floorPath と、指令の弧（これから曲がる先）の下限 _floorCmd
      this._floorPath = Math.min(floor, A.climbMax * D2R); this._floorCmd = Math.min(fC, A.climbMax * D2R);
      return Math.min(Math.max(floor, fC), A.climbMax * D2R);
    }
    // よける弧の下限（_escape 用）: 曲がる速さ om の弧を _scanPath で見て、_groundFloor と同じ式の一番大きい経路角（rad）
    _arcFloor(ctx, V, vh, om) {
      const d = this.def, A = d.aim, m = A.floorAgl;
      const T = this._tEsc || (this._tEsc = { t: 0, h0: 0, s: [], h: [], k: [], n: 0, odd: false, omc: 0 });
      T.n = 0;
      this._scanPath(ctx, V, vh, om, T, 0);
      const Vg = Math.max(V, 1), y = this.pos.y;
      const aP = Math.max(G * 0.5, Math.min(d.gLimit * G, this._liftMax(Vg)) * A.pullFrac - G);
      const Rs = Vg * Vg / aP * A.pullSafety, react = Vg * A.pullReact;
      let f = -Math.PI / 2;
      for (let k = 0; k < T.n; k++) {
        const sk = T.s[k], need = T.h[k] + m - y, box = T.k[k] & 2;
        const se = box ? Math.max(sk - react, sk * 0.5) : sk - react;
        const g = se < 1 ? (need <= 0 ? -Math.PI / 2 : (box ? Math.atan(need) : Math.atan2(need, sk + Vg * A.nearTau))) : Math.atan(need / se - se / (2 * Rs));
        if (g > f) f = g;
      }
      return f;
    }
    // 前の地面・建物の高さ（aim.lookEvery 秒ごと）: h0（真下）と、速度の水平の向きに lookStep m ごと（速さ × lookTime 秒まで、遠いと
    //   lookMax 点まで）の点の距離 s・高さ h（真ん中と左右の翼の先 ±（width / 2 + lookSide）m の高い方）。回ごとに半分ずらして細い建物も見る
    _terrainAhead(ctx, V) {
      const A = this.def.aim;
      const T = this._tA || (this._tA = { t: -9, h0: 0, s: [], h: [], k: [], n: 0, odd: false, omc: 0 });
      // 指令の曲がる速さ（_omCmd）が前の回から大きく変わった（スティックを倒した・見る向きを大きく変えた）ときはすぐ見直す
      //  （lookEvery 秒待つと、大きな G で曲がり始めた最初の 0.1 秒で建物の横へ入っていた）
      const omc = this._omCmd || 0;
      if (this.time - T.t < A.lookEvery && this.time >= T.t && Math.abs(omc - T.omc) < num(A.arcRescan, 0.25)) return T;
      T.t = this.time; T.odd = !T.odd; T.omc = omc;
      T.h0 = this._topAt(ctx, this.p.x, this.p.z);
      T.n = 0;
      const vh = Math.hypot(this.vel.x, this.vel.z);
      if (vh > 1) {
        // 前の道すじ: まっすぐの線と、旋回中は今の曲がる速さの弧（大きな G で急に曲がると、まっすぐの線の外の建物へ入っていく。
        //  逆に曲がり直すこともあるので両方）。弧の向きの変わりは aim.arcMax rad まで
        const an = this._aNet;
        let om = an ? (this.vel.z * an.x - this.vel.x * an.z) / (vh * vh) : 0;
        if (!isFinite(om)) om = 0;
        this._scanPath(ctx, V, vh, 0, T, 0);
        if (Math.abs(om) > A.arcMin) this._scanPath(ctx, V, vh, om, T, 0);
        //  指令の弧（これから曲がる速さ。_fcs が見る向き・G の上限から見積もる）: 曲がり始めは今の曲がりがまだ小さく、
        //  まっすぐの線と今の弧の外（大きな G の小さな半径の内側）の建物を見ていなかった
        if (Math.abs(omc) > A.arcMin && Math.abs(omc - om) > A.arcMin) this._scanPath(ctx, V, vh, omc, T, 1);
      }
      return T;
    }
    // 道すじ 1 本（曲がる速さ om rad/s。0 ならまっすぐ）の前の地面・建物の高さを T に足す: hs m ごとの点（odd で半分ずらした点）で
    //  真ん中と左右の翼の先の線 ±（翼幅の半分 + lookSide）m の高い方。近く（速さ × aim.boxTime 秒、少なくとも aim.boxNear m）は
    //  建物の箱を帯で調べる（点の間隔（約 18 m）では帯が塔の角を 7 m だけかすめる所を見落とし、翼が当たっていた）:
    //  boxStep m ごとの矩形で HeliCollider に聞き、点と点の間の短い線ごとに 2 次元のスラブ（翼幅の半分 + lookSide + boxSide m だけ広げた箱）で入る距離
    _scanPath(ctx, V, vh, om, T, kind) {
      const A = this.def.aim;
      const far = Math.max(A.lookStep, V * A.lookTime), step = Math.max(A.lookStep, far / A.lookMax), hs = step / 2;
      const P = this._tPts || (this._tPts = []);
      let px = this.p.x, pz = this.p.z, psi = Math.atan2(this.vel.x, this.vel.z), np = 0;
      const psi0 = psi;
      for (let sd = 0; sd <= far + 1e-6; sd += hs) {
        const pt = P[np] || (P[np] = { x: 0, z: 0, dx: 0, dz: 0, s: 0 });
        pt.x = px; pt.z = pz; pt.s = sd; pt.dx = Math.sin(psi); pt.dz = Math.cos(psi); np++;
        const nextPsi = psi0 + clamp(om * (sd + hs) / vh, -A.arcMax, A.arcMax), mid = (psi + nextPsi) / 2;
        px += Math.sin(mid) * hs; pz += Math.cos(mid) * hs; psi = nextPsi;
      }
      const w = this.def.width / 2 + A.lookSide;
      for (let i = T.odd ? 1 : 2; i < np; i += 2) {
        const pt = P[i], lx = pt.dz * w, lz = -pt.dx * w;
        if (T.n < 900) { T.s[T.n] = pt.s; T.k[T.n] = kind; T.h[T.n] = Math.max(this._topAt(ctx, pt.x, pt.z), this._topAt(ctx, pt.x + lx, pt.z + lz), this._topAt(ctx, pt.x - lx, pt.z - lz)); T.n++; }
      }
      const coll = this.collider;
      if (!coll) return;
      const near = Math.min(far, Math.max(A.boxNear, V * A.boxTime)), per = Math.max(1, Math.round(A.boxStep / hs)), list = this._tBoxes || (this._tBoxes = []);
      const wb = w + num(A.boxSide, 6); // 帯は翼の先からさらに boxSide m（低く飛んで小さく左右へ揺れると、線のすぐ横の建物へ翼が入っていた）
      for (let i0 = 0; i0 + 1 < np && P[i0].s < near; i0 += per) {
        const i1 = Math.min(np - 1, i0 + per);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = i0; i <= i1; i++) { x0 = Math.min(x0, P[i].x); x1 = Math.max(x1, P[i].x); z0 = Math.min(z0, P[i].z); z1 = Math.max(z1, P[i].z); }
        list.length = 0;
        coll.query(x0 - wb, z0 - wb, x1 + wb, z1 + wb, list);
        for (const b of list) {
          if (b.y1 + A.floorAgl < this.p.y - 200) continue;
          for (let i = i0; i < i1; i++) {
            const a = P[i], dx = P[i + 1].x - a.x, dz = P[i + 1].z - a.z;
            let t0 = 0, t1 = 1;
            if (Math.abs(dx) < 1e-9) { if (a.x < b.x0 - wb || a.x > b.x1 + wb) continue; }
            else { const u = (b.x0 - wb - a.x) / dx, v = (b.x1 + wb - a.x) / dx; t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v)); }
            if (Math.abs(dz) < 1e-9) { if (a.z < b.z0 - wb || a.z > b.z1 + wb) continue; }
            else { const u = (b.z0 - wb - a.z) / dz, v = (b.z1 + wb - a.z) / dz; t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v)); }
            if (t0 > t1) continue;
            if (T.n < 900) { T.s[T.n] = Math.max(0.5, a.s + t0 * hs); T.k[T.n] = kind | 2; T.h[T.n] = b.y1; T.n++; }
            break;
          }
        }
      }
    }
    // 着陸の形（地面を避けない）の間の安全: まっすぐ前の帯（翼幅の半分 + lookSide + aim.landBoxSide m）に入る建物の箱のうち、降りる面
    //   （並んだ滑走路・自動着艦の場所、無ければ真下）より aim.landStep m 以上高いもの（空母の艦橋・道路の横のビル）について、今の経路角の
    //   ままだと上面 + aim.landClear m より低く入るなら、越えるのに要る経路角（_groundFloor の箱と同じ式）。無ければ −90°。
    //   中心線に並んだ普通の進入では艦橋（中心線から 26 m 以上）は帯に入らない。艦橋の側へずれて並んだ・道路の横のビルへ向かったら上がる（やり直し）
    _landingFloor(ctx, V) {
      const d = this.def, A = d.aim, coll = this.collider;
      if (!coll || V < 1) return -Math.PI / 2;
      const S = (this.autoland && this.autoland.strip) || this._lined;
      let ref;
      if (S) { if (S.y == null) S.y = this._topAt(ctx, S.x, S.z); ref = S.y; } else ref = this._topAt(ctx, this.p.x, this.p.z);
      const vh = Math.hypot(this.vel.x, this.vel.z);
      if (vh < 1) return -Math.PI / 2;
      const ux = this.vel.x / vh, uz = this.vel.z / vh, tg = this.vel.y / vh;
      const near = Math.max(num(A.landNear, 200), V * A.boxTime), wb = d.width / 2 + A.lookSide + num(A.landBoxSide, 2);
      const step = A.boxStep, list = this._lBoxes || (this._lBoxes = []);
      const aP = Math.max(G * 0.5, Math.min(d.gLimit * G, this._liftMax(V)) * A.pullFrac - G), Rs = V * V / aP * A.pullSafety, react = V * A.pullReact;
      const clr = num(A.landClear, 8), lim = ref + num(A.landStep, 3);
      let floor = -Math.PI / 2;
      for (let s0 = 0; s0 < near; s0 += step) {
        const s1 = Math.min(near, s0 + step);
        const ax = this.p.x + ux * s0, az = this.p.z + uz * s0, bx = this.p.x + ux * s1, bz = this.p.z + uz * s1;
        list.length = 0;
        coll.query(Math.min(ax, bx) - wb, Math.min(az, bz) - wb, Math.max(ax, bx) + wb, Math.max(az, bz) + wb, list);
        for (const b of list) {
          if (b.y1 <= lim) continue;
          const dx = bx - ax, dz = bz - az;
          let t0 = 0, t1 = 1;
          if (Math.abs(dx) < 1e-9) { if (ax < b.x0 - wb || ax > b.x1 + wb) continue; }
          else { const u = (b.x0 - wb - ax) / dx, v = (b.x1 + wb - ax) / dx; t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v)); }
          if (Math.abs(dz) < 1e-9) { if (az < b.z0 - wb || az > b.z1 + wb) continue; }
          else { const u = (b.z0 - wb - az) / dz, v = (b.z1 + wb - az) / dz; t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v)); }
          if (t0 > t1) continue;
          const sk = Math.max(0.5, s0 + t0 * (s1 - s0)), yAt = this.p.y + tg * sk;
          if (yAt > b.y1 + clr || yAt < b.y0 - 20) continue; // 今の経路のままで上を越える・下をくぐる
          const need = b.y1 + clr - this.p.y, se = Math.max(sk - react, sk * 0.5);
          const g = se < 1 ? Math.atan(need) : Math.atan(need / se - se / (2 * Rs));
          if (g > floor) floor = g;
        }
      }
      return Math.min(floor, A.climbMax * D2R);
    }
    // 真下が水（建物・地面・甲板が無い）
    _overWater(ctx) {
      const S = this._support(ctx, this.p.x, this.p.z, 5000);
      return S.water !== null && (S.y === null || S.y < S.water);
    }
    // (x, z) の一番上の面（建物の屋上・地面・水面）の高さ
    _topAt(ctx, x, z) {
      const S = this._support(ctx, x, z, 5000);
      return S.y !== null ? S.y : (S.water !== null ? S.water : 0);
    }

    // 操縦の指令（毎フレーム）: スロットル・アフターバーナー・ブレーキ、見た方へ飛ぶ（aim）か手動
    //   地上: スティックを下へ（deck.brakeStick より下）でスロットルを戻してブレーキ（下の端で全部）。空母の甲板では「発艦」ボタンか
    //   スティックを上へ（deck.assistStick）で自動の地上滑走（_deckStep: 誘導路 → カタパルトに接続 → 全開 → 射出）。
    //   甲板の手動の地上滑走は deck.manualMax m/s まで。止まっていてスティックを下へ deck.reverseHold 秒 → 後ろへ（reverseMax m/s。前輪は
    //   スティックの横だけ）。止まるまで走ったときに甲板の端・他の機体・艦橋に当たるなら止める（_taxiGuard → edgeStop / stopWhy）
    _fcs(dt, ctx) {
      const d = this.def, c = this.ctl, cmd = this.cmd, A = d.aim, D = d.deck;
      this._attOn = false;
      const pilot = !!this.driver;
      let up = c.manual ? (c.thrUp ? 1 : 0) - (c.thrDown ? 1 : 0) : c.stickY;
      // 甲板の外の地上（道路に降りた後など）: 「離陸」ボタン（発艦ボタンと同じ #btn-launch / T）か、かんたんの「加速」→ 全開で走って
      //  自動で機首を上げて離陸（_roadGo。スティックを下へ倒すと中止）。以前は道路に止まると案内が無く、「加速」を押しても動かなかった
      const roadGround = pilot && this.mode === 'ground' && !this.onDeck && !this.arrest && !this.bolter && !this.cat && !this.autoland;
      if (roadGround) {
        if (c.launch) { c.launch = false; this._roadGo = true; }
        if (this._roadGo && c.stickY < D.brakeStick) this._roadGo = false;
        if (this._roadGo || (c.easy && c.boost)) up = Math.max(up, 1);
      } else if (this.mode !== 'ground' || this.onDeck) this._roadGo = false;
      // かんたん: 甲板でボルター（ワイヤーに掛からなかった）→ 全開（自動で機首を上げて上がる）
      if (pilot && c.easy && this.bolter && this.mode === 'ground' && !this.autoland) up = Math.max(up, 1);
      const auto = pilot && this._deckStep(dt, ctx, up);
      // --- スロットル ---
      if (pilot && this.autoland) this._autolandUpdate(dt, ctx); // 自動着艦・着陸（スティックで取り消し・終わり・やり直しもここ）
      const apGround = pilot && this.autoland && this.mode === 'ground' && !this.cat;
      if (auto) {
        // 自動の地上滑走: _deckStep がスロットル（音）・前輪・加速を決めた
        this._revT = 0;
      } else if (pilot && !this.cat && this.mode === 'air' && (c.easy || this.autoland)) {
        // かんたん・自動着艦: 速さは自動（_easyThrottle）
        this._revT = 0;
        this._easyThrottle(dt);
      } else if (apGround) {
        // 自動着艦・着陸の地上: ボルターなら全開で上がる、道路なら止まるまでブレーキ
        this._revT = 0;
        //  ボルター（フックの先がワイヤーを全部越えた: _carrier が甲板の上でも浮いて越えたときも立てる）は全開で上がる。以前は浮いて越えて
        //  接地するとボルターにならず、アイドル + ブレーキのまま甲板の端から失速の速さより遅く落ちて船体に当たっていた
        this._apGo = this.bolter;
        if (this._apGo) { this.throttle = Math.min(1, this.throttle + dt * 2); this.abOn = this.throttle >= 1; cmd.brake = 0; }
        else { this.throttle = 0; this.abOn = false; cmd.brake = this.arrest ? 0 : d.autoland.rollBrake; }
        cmd.airbrake = false;
      } else if (pilot && !this.cat) {
        const onDeck = this.mode === 'ground' && this.onDeck;
        // 甲板で止まっていて下へ倒し続ける → 後ろへ（倒している間）
        const down = onDeck && up < D.brakeStick;
        if (down && (Math.abs(this.u) < D.reverseStart || this._revT > D.reverseHold)) this._revT = (this._revT || 0) + dt;
        else if (!down) this._revT = 0;
        if (up > d.abStick) {
          this.throttle = Math.min(1, this.throttle + d.throttleRate * d.throttleRateFull * dt);
          if (this.throttle >= 1) { this._abT += dt; if (this._abT >= d.abHold) this.abOn = true; }
        } else {
          this._abT = 0;
          if (up > d.stickDeadzone) this.throttle = Math.min(1, this.throttle + up * d.throttleRate * dt);
          else if (this.mode === 'ground' && up < D.brakeStick) { this.abOn = false; this.throttle = Math.max(0, this.throttle - d.throttleRate * d.throttleRateCut * dt); }
          else if (up < -d.stickDeadzone) { this.abOn = false; this.throttle = Math.max(0, this.throttle + up * d.throttleRate * d.throttleRateDown * dt); }
          else if (onDeck) { this.abOn = false; this.throttle = Math.max(0, this.throttle - d.throttleRate * dt); } // 甲板で離すとアイドルへ
        }
        // ブレーキ: 地上は下へ倒した分（brakeStick で 0、下の端で全部。スロットルを待たない）。空中は下の端・アイドルでエアブレーキ
        cmd.brake = this.mode === 'ground' ? clamp((-up + D.brakeStick) / Math.max(0.05, -d.idleBrake + D.brakeStick), 0, 1) : 0;
        cmd.airbrake = this.mode === 'air' && up < d.idleBrake && this.throttle <= 0.02;
        // 甲板でスティックを離している（前へ・止まっている。着艦の走り・ボルターは除く）: 軽くブレーキ（deck.releaseBrake）、
        //  deck.holdSpeed m/s より遅ければ全部（アイドルの推力は摩擦とほぼ同じなので、離しても止まらずに何十秒も転がり続けない。
        //  自動をやめて止まった後・回転が残っていても止まったまま）
        if (onDeck && !this.bolter && !this.arrest && Math.abs(up) <= d.stickDeadzone && this.u >= 0) {
          cmd.brake = Math.max(cmd.brake, this.u < D.holdSpeed ? 1 : D.releaseBrake);
        }
        // かんたん: 甲板の外の地上（道路に降りた）でスティックを離している → アイドルにしてブレーキ（止まる）
        if (c.easy && this.mode === 'ground' && !onDeck && !this.bolter && !this.arrest && Math.abs(up) <= d.stickDeadzone && this.u > 0) {
          this.abOn = false; this.throttle = Math.max(0, this.throttle - d.throttleRate * d.throttleRateCut * dt); cmd.brake = 1;
        }
        if (this._revT > D.reverseHold) {
          this.throttle = 0; this.abOn = false; cmd.brake = 0;
          this._revAcc = clamp((-D.reverseMax - this.u) * D.speedGain, -D.reverseAccel, D.reverseAccel);
        } else if (onDeck && this.u < -D.movingSpeed) { cmd.brake = 0; this._revAcc = clamp(-this.u * D.speedGain, 0, D.reverseAccel); } // 離した: 止まる
        if (this._holdBrake) { cmd.brake = 1; this.throttle = 0; this.abOn = false; } // 発艦ボタン: 止まってから下がる
        // 空中の推力の保護（見た方へ飛ぶとき）: 離陸・発艦の直後の上昇（_prot。機首は climb.pitch° 以上に上げたまま）は climb.throttle より
        //  絞らない（スティックを下へ = 「引いて上がる」つもりでアイドル・エアブレーキ → 上を向いたまま失速して海へ、にならない）。
        //  それ以外でも失速の速さ + aim.speedFloor m/s より遅くなったら全開・アフターバーナー（その 2 倍の余裕まで戻るまで）。
        //  フックを下ろしている（着艦）間・脚を下ろして lowAgl m より低い（着陸の引き起こし）ときは始めない
        if (this.mode === 'air' && !c.manual) {
          //  失速の速さ: 脚を下ろした値（stallSpeedLanding）を使うのは着陸のつもりのとき（フック・空母 / 道路に並んだ・離陸の後に一度上げた脚を
          //  また下ろした）だけ。発艦の直後の下りたままの脚は数秒で上がる（上がったとたんに失速の速さが 55 → 65 に上がり、上りの旋回の途中で
          //  失速していた）
          const ldg = this.gearPos > 0.5 && (this.hookDown || !!this._lined || this._gearWasUp);
          const vs = ldg ? d.stallSpeedLanding : d.stallSpeed, m = num(A.speedFloor, 12);
          this._spdVs = vs;
          if (this.hookDown || this.speed > vs + m * 2) this._spdProt = false;
          else if (this.speed < vs + m && !(this.gearDown && this.agl < num(A.lowAgl, 40) && !this._prot)) this._spdProt = true;
          if (this._prot || this._spdProt) {
            this.throttle = Math.max(this.throttle, this._spdProt ? 1 : num(d.climb.throttle, 1));
            if (this._spdProt) this.abOn = true;
            cmd.airbrake = false;
          }
        } else this._spdProt = false;
      } else if (pilot && this.cat) {
        // カタパルト: 上へ・発艦ボタン → 全開（自動で回す）。下へ倒すと止める（_catStep の解除は unhookHold 秒押し続けたとき）
        const C = this.cat;
        this._revT = 0;
        if (up > D.cancelStick) C.armed = true;
        if (c.launch) { c.launch = false; C.auto = true; }
        if (up > D.assistStick) C.auto = true;
        else if (up < D.brakeStick && C.armed) C.auto = false;
        if (C.auto) {
          this.throttle = Math.min(1, this.throttle + d.deck.launchThrottle * dt);
          if (this.throttle >= 1) this.abOn = true;
        } else if (up > d.stickDeadzone) this.throttle = Math.min(1, this.throttle + Math.max(up, D.catThrottleMin) * d.throttleRate * D.catThrottleRate * dt);
        else if (up < -d.stickDeadzone) { this.throttle = Math.max(0, this.throttle + up * d.throttleRate * D.catThrottleRate * dt); this.abOn = false; }
        cmd.brake = 1; cmd.airbrake = false;
      } else {
        cmd.brake = this.mode === 'ground' && !this.pilotless ? 1 : 0; cmd.airbrake = false;
      }
      this.axes();
      const fwd = this._fwd, upv = this._upv, left = this._left;
      const V = this.vel.length();
      let aim = c.aim;
      const wasAvoid = this.groundAvoid;
      this.aimAssist = null; this.groundAvoid = false;
      // 自動着艦・着陸（_autolandUpdate が作った目標）か「かんたん」（スティックから目標を作る）: 見た方へ飛ぶ操縦と同じ計算で飛ぶ
      if (pilot && this.mode === 'air' && this.autoland && this._apAim) aim = this._apAim;
      else if (pilot && this.mode === 'air' && c.easy) aim = this._easyAim(dt, wasAvoid);
      // 地図の端（柔らかい壁）: 外の帯（boundsMargin）に入って中へ向いていなければ、中心へ向くまで（boundsHold° 以内）中心を目標にする（保つ。
      //  外へ向いている間だけにすると、横を向いたとたんにカメラの向き（外）へ戻って出たり入ったりを繰り返す）。低いときは上りながら
      if (this.city && this.mode === 'air') {
        // 帯の幅: boundsMargin m か、今の速さで出せる G で 180° 回る幅（旋回半径 × boundsTurnK、boundsMarginMax m まで）の広い方
        //  （遅いと 4 G しか出ず、250 m の帯では回りきれずに外へ出ていた）。自動着艦・脚を下ろして空母 / 道路に並んでいるときは除く
        //  （空母は地図の西の端から 800 m）
        //  （回る G は boundsTurnG まで: 出せる最大の G（200 G）で測ると速いほど帯が細くなり、帯に入ったとたんに 100 G 超で回っていた）。
        //  端ごとに、その端へ向かう割合 u で外へ膨らむ分（半径 × (1 − √(1 − u²))）だけ広げる（端に沿って飛ぶ = 川の上では広げない）
        let Rt = 0;
        if (!this.autoland && !(this.gearDown && this._lined) && V > 1) {
          //  （大きな G で回っている間（G の上限 gAuth が上がっている）はその G: 端の近くの 200 G の旋回の途中で端の戻しが割り込み、左右に振れていた）
          const aT = Math.min(d.maxG * G, Math.max(this._liftMax(V), Math.min(this._kqMan(V) * 0.95, Math.max(num(d.boundsTurnG, 12), this.gAuth || 0) * G)));
          Rt = V * V / Math.sqrt(Math.max(1, aT * aT - G * G)) * num(d.boundsTurnK, 2.2);
        }
        const vh = Math.hypot(this.vel.x, this.vel.z) || 1, m0 = d.boundsMargin, mMax = num(d.boundsMarginMax, 600);
        const x = this.p.x, z = this.p.z, ci = this.city;
        const out = x < ci.minX + Jet._band(-this.vel.x, vh, m0, mMax, Rt) || x > ci.maxX - Jet._band(this.vel.x, vh, m0, mMax, Rt) || z < ci.minZ + Jet._band(-this.vel.z, vh, m0, mMax, Rt) || z > ci.maxZ - Jet._band(this.vel.z, vh, m0, mMax, Rt);
        const cx = (ci.minX + ci.maxX) / 2 - x, cz = (ci.minZ + ci.maxZ) / 2 - z, l = Math.hypot(cx, cz) || 1;
        //  入るのは中へ boundsHold° より外を向いているとき、やめるのは boundsExit° 以内まで向いたとき（境目で毎フレーム出たり入ったりしない）
        const cosIn = (this.vel.x * cx + this.vel.z * cz) / (vh * l);
        const wasOob = this._oob;
        if (out && cosIn <= Math.cos(num(d.boundsHold, 45) * D2R)) this._oob = true;
        else if (this._oob && cosIn > Math.cos(num(d.boundsExit, 25) * D2R)) this._oob = false;
        // 見た方へ飛ぶ操縦で端から戻し終わった（_oob が切れた）のにカメラはまだ外を向いている: そのずれでは大きな G を出さない（_oobLatch。
        //  カメラを boundsLatchMove° 動かすか、中へ boundsHold° 以内に向けたら終わり）。以前は戻し終わったとたんに外のカメラへ 130 G で
        //  回り、また端で戻す…を 1.5 秒ごとにくり返して屋上の上を ±90° 傾けながら左右に振れていた（ゆるい 7.5 G の旋回は今まで通り）
        if (wasOob && !this._oob && pilot && !c.easy && !c.manual && c.aim) this._oobLatch = (this._oobLatchV || (this._oobLatchV = new THREE.Vector3())).copy(c.aim);
        // 戻るのに要る G（_oob の間の G の上限の欲しい度合い _oobDem）: 端までの距離 dE（傾けて G を上げる boundsLead 秒の分を引く）の boundsUse 倍の中で外向きの動きが止まる
        //  旋回半径 R = dE × boundsUse / (1 − cos(外向きの角)) → 要る G。端まで余裕があればゆるく、外へ出そうなら大きな G で（いつも 70 G で回らない）
        if (this._oobLatch) {
          const la = c.aim, lh = la ? Math.hypot(la.x, la.z) : 0;
          const inward = la && lh > 0.2 && (la.x * cx + la.z * cz) / (lh * l) > Math.cos(num(d.boundsHold, 45) * D2R);
          if (!pilot || c.easy || c.manual || !la || this._oob || inward || la.dot(this._oobLatch) < Math.cos(num(d.boundsLatchMove, 20) * D2R)) this._oobLatch = null;
        }
        this._oobDem = 0;
        if (this._oob) {
          //  4 つの端それぞれ（角では 2 つとも）: 外へ向かう割合 u の端までの距離 dE → 要る半径の小さい方
          let R = Infinity;
          const E4 = [[x - ci.minX, -this.vel.x], [ci.maxX - x, this.vel.x], [z - ci.minZ, -this.vel.z], [ci.maxZ - z, this.vel.z]];
          for (const [dE, vo] of E4) {
            const u = clamp(vo / vh, 0, 1);
            if (u < 0.02) continue;
            const dEf = dE - V * u * num(d.boundsLead, 0.8); // 傾けて G を上げるまで（boundsLead 秒）は外へ進む
            R = Math.min(R, dEf <= 0 ? 0 : dEf * num(d.boundsUse, 0.7) / Math.max(1e-3, 1 - Math.sqrt(1 - u * u)));
          }

          if (R < 1) this._oobDem = 1;
          else if (R < Infinity) {
            const a = V * V / R, gNeed = Math.sqrt(a * a + G * G) / G, cap = clamp(this._kqMan(V) * 0.95 / G, d.gLimit, d.maxG);
            this._oobDem = cap > d.gLimit + 0.5 ? clamp((gNeed - d.gLimit) / (cap - d.gLimit), 0, 1) : 0;
          }
        }
        if (!this._oob) this._oobSide = 0;
        if (this._oob) {
          // かんたん: 高さは保つ（離したときの高度）。ほかの操作は低ければ上りながら
          const Cl = d.climb, E = d.easy, H = this._easy;
          const py = c.easy && pilot && H && !this._prot ? Math.sin(clamp(Math.atan2(H.alt - this.p.y, Math.max(V, 40) * E.holdTau), -E.holdMaxPitch * D2R, E.holdMaxPitch * D2R))
            : (this.agl < Cl.boundsAgl ? Math.sin(Cl.boundsPitch * D2R) : 0.03);
          //  向き: 中心へ。回る側は戻し始めたときに 1 度だけ決める（_oobSide）: 中心への近い回り方がいったん端へまっすぐ向いてから
          //  回り込む（端の手前で 50 G 超を要していた）なら、もう片方。90° より多く回るうちは今の向きからその側へ 90° 先を目標にする
          //  （FCS が近い側へ回り直さない。毎フレーム決め直すと端に沿う所で左右に振れた）
          let tx = cx / l, tz = cz / l;
          if (vh > 1) {
            const h = Math.atan2(this.vel.x, this.vel.z), hc = Math.atan2(tx, tz), dc = wrap(hc - h);
            if (!wasOob || !this._oobSide) {
              //  両側へ boundsTurnG の半径で中心の向きまで回る弧（boundsLead 秒まっすぐ進んでから）を描いて、地図の端からの一番近い距離が
              //  大きい側（角では片方の端へ向かって回り込むと、もう片方の端の 90 m 手前まで行っていた）
              const Rr = V * V / (Math.max(d.gLimit, num(d.boundsTurnG, 12)) * G), lead = V * num(d.boundsLead, 0.8);
              const clear = (sd) => {
                let rem = dc * sd; if (rem < 0) rem += Math.PI * 2;
                const x0 = x + Math.sin(h) * lead, z0 = z + Math.cos(h) * lead, lim = Math.min(rem, Math.PI * 1.2);
                let m = Infinity;
                for (let a = 0; a <= lim + 1e-6; a += 0.17) {
                  const th = h + sd * a, px = x0 + sd * Rr * (Math.cos(h) - Math.cos(th)), pz = z0 + sd * Rr * (Math.sin(th) - Math.sin(h));
                  m = Math.min(m, px - ci.minX, ci.maxX - px, pz - ci.minZ, ci.maxZ - pz);
                }
                return m;
              };
              const s0 = dc >= 0 ? 1 : -1;
              this._oobSide = Math.abs(dc) > Math.PI / 2 && clear(-s0) > clear(s0) + 20 ? -s0 : s0;
            }
            const sd = this._oobSide;
            let rem = dc * sd;
            if (rem < 0) rem += Math.PI * 2;
            if (rem > Math.PI / 2) { const ht = h + sd * Math.PI / 2; tx = Math.sin(ht); tz = Math.cos(ht); }
          }
          aim = (this._bAim || (this._bAim = new THREE.Vector3())).set(tx, py, tz).normalize();
          this.outOfBounds = 1;
        } else this.outOfBounds = 0;
      } else if (this.mode !== 'air') { this._oob = false; this._oobLatch = null; this.outOfBounds = 0; }
      if (this.mode === 'ground') {
        // --- 地上: 前輪・機首上げ ---
        this._gearWasUp = false; // 次の離陸の後に脚を上げたかを数え直す（着陸の形の判定）
        let steer = 0, pitchUp = false;
        const backing = pilot && !auto && (this._revAcc != null || this.u < -D.movingSpeed);
        if (pilot) {
          const sx = c.stickX, side = Math.abs(sx) > A.groundStick && Math.abs(sx) > A.groundAngle * Math.abs(c.stickY);
          if (backing) steer = Math.abs(sx) > A.groundStick ? sx : 0; // 後ろへ: スティックの横だけ（カメラの向きへは回さない）
          else if (apGround && this.autoland.strip) {
            // 自動着陸の走り: 中心線の 60 m 先へ前輪を向ける
            const S = this.autoland.strip, al = (this.pos.x - S.x) * S.fx + (this.pos.z - S.z) * S.fz;
            const tx = S.x + S.fx * (al + 60), tz = S.z + S.fz * (al + 60);
            steer = clamp(-wrap(Math.atan2(tx - this.pos.x, tz - this.pos.z) - this.yaw) * A.groundSteer, -1, 1);
          } else if (c.easy) steer = Math.abs(sx) > A.groundStick * 0.5 ? sx : 0; // かんたん: スティックの横 = 前輪
          else if (c.manual || !aim || side) steer = sx;
          else if (aim) {
            const ah = Math.atan2(aim.x, aim.z);
            steer = clamp(-wrap(ah - this.yaw) * A.groundSteer, -1, 1);
            if (Math.hypot(aim.x, aim.z) < 0.2) steer = 0;
          }
          if (c.manual) { pitchUp = c.stickY > 0.3; cmd.pitchTo = null; }
          else if (c.easy || apGround) {
            // かんたん・自動着艦のボルター: 全開で速くなったら自動で機首を上げる（道路・甲板から離陸。スティックの上 = 推力）
            pitchUp = this.throttle >= A.autoRotateThrottle && !(apGround && !this.bolter); cmd.pitchTo = A.autoRotate * D2R;
          } else if (aim) {
            const ap = Math.asin(clamp(aim.y, -1, 1));
            pitchUp = ap > d.rotatePitch * D2R; cmd.pitchTo = ap;
            // 全開で走っていて見ている向きが下すぎなければ自動で機首を上げる（道路から離陸。上を見なくても飛べる）
            if (!pitchUp && this.throttle >= A.autoRotateThrottle && ap > A.autoRotateMinPitch * D2R) { pitchUp = true; cmd.pitchTo = A.autoRotate * D2R; }
          }
          if (backing) pitchUp = false;
          if (auto) { steer = this._autoSteer; pitchUp = false; }
        }
        cmd.steer = steer; cmd.pitchUp = pitchUp;
        cmd.n = 1; cmd.p = 0; cmd.rud = 0;
        // 甲板を手で走っている: 止まるまでに甲板の端・他の機体・艦橋に当たるなら止める（前へも後ろへも）
        let why = null;
        if (pilot && !auto && this.onDeck && this._taxiing && !this.cat && !this.arrest && !this.bolter && this.ops) {
          const mv = D.movingSpeed;
          const fwdI = this.u > mv || (this._revAcc == null && up > d.stickDeadzone && this.u > -mv && this.engineOn);
          const revI = !fwdI && (this.u < -mv || (this._revAcc != null && this._revAcc < 0));
          if (fwdI) why = this._taxiGuard(ctx, 1);
          else if (revI) why = this._taxiGuard(ctx, -1);
          if (why) {
            cmd.brake = 1;
            if (fwdI) { this.throttle = 0; this.abOn = false; }
            else this._revAcc = clamp(-this.u * D.speedGain * 2, 0, D.reverseAccel * 2);
            if ((!this.edgeStop || this.stopWhy !== why) && (why !== this._guardMsgWhy || this.time - (this._guardMsgT || -1e9) > D.msgEvery)) { // 止まる・動くをくり返しても同じ知らせは msgEvery 秒に 1 回
              this._guardMsgT = this.time; this._guardMsgWhy = why; this.events.push({ t: why === 'edge' ? 'deck_edge' : 'deck_obstacle', back: revI });
            }
          }
        }
        this.edgeStop = !!why; this.stopWhy = why;
        return;
      }
      // --- 空中 ---
      // 離陸・発艦の直後（_prot）: カメラが下・横を向いていても climb.pitch〜pitchMax° 上・離陸の向きから climb.yaw° 以内へ
      //  （地図の端で戻っている間は向きは端の目標のまま、上りだけ）。time 秒以上かつ地面から climb.agl m で終わる（最長 maxTime 秒）
      if (this._prot) {
        const Pr = this._prot, Cl = d.climb;
        Pr.t += dt;
        if (!pilot || c.manual || Pr.t >= Cl.maxTime || (Pr.t >= Cl.time && this.agl >= Cl.agl)) this._prot = null;
        else if (aim) {
          const ap = Math.asin(clamp(aim.y, -1, 1));
          let ah = Math.atan2(aim.x, aim.z);
          const ap2 = clamp(ap, Cl.pitch * D2R, Cl.pitchMax * D2R);
          if (!this._oob) ah = Pr.yaw + clamp(wrap(ah - Pr.yaw), -Cl.yaw * D2R, Cl.yaw * D2R);
          if (Math.abs(ap2 - ap) > 1e-4 || Math.abs(wrap(ah - Math.atan2(aim.x, aim.z))) > 1e-4 || Math.hypot(aim.x, aim.z) < 1e-3) {
            const cp = Math.cos(ap2);
            aim = (this._pAim || (this._pAim = new THREE.Vector3())).set(Math.sin(ah) * cp, Math.sin(ap2), Math.cos(ah) * cp);
          }
        }
      }
      // 地面・水・建物の近く（見た方へ飛ぶ・着陸の形でないとき）: 見ている向きの下限（_groundFloor）より下なら下限へ上げる。
      //  わざと下を見ても海・地面・建物へ突っ込まない（降下して撃つのは floorAgl m の上まで）
      // かんたん: 着陸の形でも、空母・道路に並んでいない・自動着艦の最終進入でないなら避ける（低く遅く飛んでも建物に当たらない）
      // 離陸・発艦の後に脚を一度上げたか（上げていなければ、着陸の形とみなすのは浅い降下 −landingSlope° までだけ）
      if (this.gearPos < 0.1) this._gearWasUp = true;
      const shallow = this._gearWasUp || this.vel.y > -Math.sin(num(A.landingSlope, 8) * D2R) * Math.max(V, 1);
      const landCfg = this.gearPos > 0.9 && (this.speed < d.touchdownSpeed + A.landingMargin || this.hookDown) && shallow;
      // 水の上では空母（フックを下ろした・着艦の向きに並んだ）のときだけ着陸の形（海へ降りる所は無い）
      //  自動着艦・着陸の最終進入は脚・速さに関係なく着陸の形（脚が下りきる前・速いうちに _groundFloor が目標の道路 / 甲板を地面として
      //   15〜60° の下限を出し、_escape の 90° の旋回や引き起こしで進入路の 50 m 上に出て、最後に急降下して道路に落ちていた）
      const landing = this.autoland ? this.autoland.phase === 'final' : (c.easy ? landCfg && (this.hookDown || this._lined)
        : landCfg && (this.hookDown || !!this._lined || !this._overWater(ctx)));
      // 指令の曲がる速さ（rad/s、右が負 = 道すじの向き atan2(vx, vz) の変わり）の見積もり: 見る向きの水平のずれ × pitchGain（大きな G は 2 倍）を
      //  G の上限の目標（_gStep と同じ: 欲しい度合い → gLimit〜今の速さで出せる G）で水平に回れる速さまで。_terrainAhead がこの弧も見る
      this._omCmd = 0;
      if (pilot && aim && (!c.manual || this.autoland || this._oob) && V > 20) {
        const vh0 = Math.hypot(this.vel.x, this.vel.z), ahl = Math.hypot(aim.x, aim.z);
        if (vh0 > 1 && ahl > 0.05) {
          const he = wrap(Math.atan2(aim.x, aim.z) - Math.atan2(this.vel.x, this.vel.z));
          const M0 = d.maneuver, offD = Math.acos(clamp(aim.dot(this._v3.copy(this.vel).multiplyScalar(1 / V)), -1, 1)) / D2R;
          const gentle = !!this.autoland || this.gearDown || !!this._prot;
          let dem = gentle ? 0 : this._aimDem(offD);
          if (this._oob && !this._prot) dem = Math.max(dem, this._oobDem || 0);
          const cap = clamp(this._kqMan(V) * 0.95 / G, d.gLimit, d.maxG), gT = Math.max(this.gAuth || d.gLimit, d.gLimit + (cap - d.gLimit) * dem);
          const aT = Math.min(gT * G, Math.max(this._liftMax(V), dem > 0 ? this._kqMan(V) : 0) * 0.95);
          const wMax = Math.sqrt(Math.max(0, aT * aT - G * G)) / V;
          this._omCmd = Math.sign(he) * Math.min(Math.abs(he) * A.pitchGain * (dem > 0 ? 2 : 1), wMax);
        }
      }
      // 速さの保護の間（_spdProt。見た方へ飛ぶとき）: 上り過ぎない。見ている向きの経路角の上限を 失速の速さ → −aim.spdPitchMin°、
      //  失速の速さ + 2 × speedFloor → spdPitchMax° でなめらかに（全開・AB でも上りの旋回で速さが失速の速さより下がっていた）。地面を避ける下限は後で（そちらが先）
      if (pilot && aim && this._spdProt && !this._prot && !landing && !c.easy) {
        const vs = this._spdVs || d.stallSpeed, mm = num(A.speedFloor, 12);
        const cap = (-num(A.spdPitchMin, 3) + (num(A.spdPitchMax, 10) + num(A.spdPitchMin, 3)) * clamp((this.speed - vs) / (2 * mm), 0, 1)) * D2R;
        if (Math.asin(clamp(aim.y, -1, 1)) > cap) {
          const hl = Math.hypot(aim.x, aim.z), cp = Math.cos(cap);
          const hx = hl > 1e-3 ? aim.x / hl : this.vel.x, hz = hl > 1e-3 ? aim.z / hl : this.vel.z, hn = Math.hypot(hx, hz) || 1;
          aim = (this._sAim || (this._sAim = new THREE.Vector3())).set(hx / hn * cp, Math.sin(cap), hz / hn * cp);
        }
      }
      this.turnBlock = 0; this._floor = null;
      if (pilot && aim && (!c.manual || this.autoland || this._oob) && !this._prot && !landing) {
        let floor = this._groundFloor(ctx, V);
        // 曲がる先（指令の弧）の建物・地面が今の道すじより高すぎる（越えるには経路角を turnBlockFrom〜turnBlockFull° 上げる）: 曲がりを弱める
        //  （その建物へ曲がらない = 「よける」。上がりきれないまま横の塔へ曲がり込んでいた）。弱めた分だけ指令の弧の下限も使わない
        const gNow = Math.asin(clamp(this.vel.y / Math.max(V, 1), -1, 1));
        const kb = this._floorCmd > this._floorPath ? smooth(num(A.turnBlockFrom, 5), num(A.turnBlockFull, 15), (this._floorCmd - Math.max(gNow, this._floorPath)) / D2R) : 0;
        this.turnBlock = kb;
        if (kb > 0) {
          const tY = Math.atan2(this.vel.x, this.vel.z), hl = Math.hypot(aim.x, aim.z);
          if (hl > 0.05) {
            const ny = tY + wrap(Math.atan2(aim.x, aim.z) - tY) * (1 - kb);
            aim = (this._kAim || (this._kAim = new THREE.Vector3())).set(Math.sin(ny) * hl, aim.y, Math.cos(ny) * hl);
          }
          floor = Math.max(this._floorPath, floor - (floor - this._floorPath) * kb);
          if (kb > 0.5) this.groundAvoid = true; // 「危険」
        }
        // 遅くて前の建物を越えられない（今の道すじの下限が経路角より aim.escFrom° 以上上・失速の速さ × escSpeedK より遅い）: 左右へ
        //  今の速さで回れる弧を見て、下限が escGain° 以上低い側へ向きを変える（_esc、escHold 秒。上がるだけでは間に合わず、スティックを
        //  下へ倒したまま（アイドル）74 m/s で 272 m の塔へまっすぐ入っていた）。保つ間はその弧の下限を使う
        //  （自動着艦・着陸の間と、脚を下ろして空母・道路に並んでいる間はしない: 脚が下りる途中の最終進入で 90° の旋回をして、進入路の
        //   50 m 上から急降下して道路・甲板に落ちていた。自動の間は推力も自動で、遅いまま塔へ向かう形にならない。入口へ回る途中に許すと、
        //   塔の横を低く遅く飛び始めた所で横の塔へ曲がり込むことがあった）
        if (this.autoland || (this.gearDown && this._lined)) this._esc = null;
        else floor = this._escape(ctx, V, gNow, floor);
        if (this._esc) {
          const tY = Math.atan2(this.vel.x, this.vel.z) + this._esc.side * Math.PI / 2, hl = Math.max(0.3, Math.hypot(aim.x, aim.z));
          aim = (this._eAim || (this._eAim = new THREE.Vector3())).set(Math.sin(tY) * hl, aim.y, Math.cos(tY) * hl).normalize();
          this.groundAvoid = true;
        }
        this._floor = floor;
        const ap = Math.asin(clamp(aim.y, -1, 1));
        if (ap < floor) {
          const hl = Math.hypot(aim.x, aim.z), cp = Math.cos(floor);
          const hx = hl > 1e-3 ? aim.x / hl : this.vel.x, hz = hl > 1e-3 ? aim.z / hl : this.vel.z, hn = Math.hypot(hx, hz) || 1;
          aim = (this._gAim || (this._gAim = new THREE.Vector3())).set(hx / hn * cp, Math.sin(floor), hz / hn * cp);
          this.groundAvoid = true;
        }
      } else if (pilot && aim && (!c.manual || this.autoland || this._oob) && !this._prot && landing) {
        // 着陸の形: 地面は避けないが、前の高い建物の箱（艦橋・道路の横のビル）には入らない（_landingFloor）
        const floor = this._landingFloor(ctx, V);
        this._floor = floor > -1.5 ? floor : null;
        if (Math.asin(clamp(aim.y, -1, 1)) < floor) {
          const hl = Math.hypot(aim.x, aim.z), cp = Math.cos(floor);
          const hx = hl > 1e-3 ? aim.x / hl : this.vel.x, hz = hl > 1e-3 ? aim.z / hl : this.vel.z, hn = Math.hypot(hx, hz) || 1;
          aim = (this._gAim || (this._gAim = new THREE.Vector3())).set(hx / hn * cp, Math.sin(floor), hz / hn * cp);
          this.groundAvoid = true;
        }
      }
      if (pilot && aim && aim !== c.aim) this.aimAssist = aim;
      // 姿勢の内側のループ（傾き・G・方向舵の指令）は update の 1 歩（1/60 秒以下）ごとに _fcsAtt で（ここで決めた目標 aim へ）。
      //  1 フレームに 1 回だと 20 fps では 3 歩のあいだ同じ指令のままで、傾きの追い方が遅れて旋回が大きくなっていた（フレームの長さで
      //  旋回半径が変わる。SMOKE_FPS=20 の 11m で地図の西の端に出ていた一因）
      this._attAim = aim; this._attOn = true;
    }

    // 空中の姿勢の指令（_fcs の目標 aim へ）: 1 歩 dt（≤ 1/60 秒）ごと
    _fcsAtt(dt, aim) {
      const d = this.def, c = this.ctl, cmd = this.cmd, A = d.aim;
      const pilot = !!this.driver;
      this.axes();
      const fwd = this._fwd, upv = this._upv, left = this._left;
      const V = this.vel.length();
      let nCmd, pCmd, rud = 0;
      const M = d.maneuver;
      if (!this.gAuth) this.gAuth = d.gLimit;
      let rr = this._rollRate();
      const bank = Math.atan2(left.y, upv.y); // 右へ傾くと正
      if (!pilot) {
        // 無人: 翼を水平に、少しずつ機首が下がる（射出の後は墜ちる）。地図の端では中心へ向きを変える
        this._gStep(dt, 0); rr = this._rollRate();
        const PL = d.pilotlessCtl;
        pCmd = clamp(-bank * PL.levelGain, -1, 1) * d.rollRate * D2R * PL.rollFrac;
        nCmd = this.pilotless ? d.pilotlessDive * upv.y : upv.y;
        if (this.outOfBounds && aim) {
          const lat = -aim.dot(left), ahead = aim.dot(fwd);
          const want = clamp(Math.atan2(lat, Math.max(0.1, ahead)) * PL.turnBank, -PL.maxBank * D2R, PL.maxBank * D2R); // 傾けて回る
          pCmd = clamp((want - bank) * PL.turnGain, -1, 1) * d.rollRate * D2R * PL.rollFrac;
          nCmd = (this.pilotless ? d.pilotlessDive : 1) * upv.y + Math.abs(Math.sin(bank)) * 3;
        }
      } else if ((c.manual && !this.autoland && !this._oob) || !aim) {
        // 手動（自動着艦・地図の端で戻っている間は見た方へ飛ぶ操縦と同じ計算で目標へ）: スティックを stickFrom より大きく倒し続けると G の上限が上がる（小さく倒す間は今まで通り gLimit まで）
        const sy = c.manual ? c.stickY : 0;
        this._gStep(dt, Math.pow(smooth(M.stickFrom, 1, Math.abs(sy)), M.curve));
        rr = this._rollRate();
        pCmd = c.stickX * rr * D2R;
        nCmd = sy >= 0 ? upv.y + sy * (this.gAuth - upv.y) : upv.y + sy * (upv.y - this._gNeg());
      } else {
        // 見た方へ: 速度の向き（飛んでいく向き）を目標へ回す。欲しい加速度 = 目標への旋回（off × pitchGain rad/s）+ 重力の打ち消し。
        //   その向きへ揚力を傾け（ロール）、揚力の方向の成分だけ引く（G の指令）。小さなずれは方向舵、下の目標は押す（背面にならない）
        const vh = V > 20 ? this._v3.copy(this.vel).multiplyScalar(1 / V) : this._v3.copy(fwd);
        const ca = clamp(aim.dot(vh), -1, 1);
        const off = Math.acos(ca), offDeg = off / D2R;
        // 大きく曲がりたい度合い（見る向きのずれ aimFrom〜aimFull°、curve 乗）→ G の上限 gAuth を上げる。自動着艦・脚を下ろした形・離陸の直後は上げない
        const gentle = !!this.autoland || this.gearDown || !!this._prot;
        let dem = gentle ? 0 : this._aimDem(offDeg);
        //  地面・建物を避けている（下限が今の経路角より aim.avoidGFrom〜avoidGFull° 上）: G の上限も上げて引き起こす（ゆるい旋回の
        //   スティックのままだと 8〜10 G でしか上がらず、横の塔へ曲がりながら屋上の下へ入っていた）
        if (this.groundAvoid && this._floor != null) dem = Math.max(dem, smooth(num(A.avoidGFrom, 3), num(A.avoidGFull, 20), (this._floor - Math.asin(clamp(vh.y, -1, 1))) / D2R));
        //  地図の端で戻っている（_oob）: 端の外へ出ない旋回に要る G まで上限を上げる（_oobDem。かんたんの離したスティック・脚を下ろした形でも。
        //   7.5 G の半径 850 m では 250 m の帯の中で回りきれず、地図の外へ 700 m 出ていた）
        if (this._oob && !this._prot) dem = Math.max(dem, this._oobDem || 0);
        this._gStep(dt, dem);
        rr = this._rollRate();
        // ずれを飛んでいく向きの「水平の左（hL）」と「上（vU）」に分ける
        const hL = this._hL || (this._hL = new THREE.Vector3()), vU = this._vU || (this._vU = new THREE.Vector3());
        hL.set(vh.z, 0, -vh.x);
        if (hL.lengthSq() < 1e-4) hL.copy(left); else hL.normalize();
        vU.crossVectors(vh, hL);
        let la = aim.dot(hL), va = aim.dot(vU);
        // 上下のずれ: 大きく向きを変えるときは経路角の差（γ目標 − γ）で測る（aim·vU は後ろを見ると sin(γ目標 + γ) になり、
        //  上っている機体へ「もっと上へ」= 宙返りの指令になる）
        if (offDeg > 10) {
          const dg = Math.asin(clamp(aim.y, -1, 1)) - Math.asin(clamp(vh.y, -1, 1));
          va += (Math.sin(dg) - va) * smooth(10, 45, offDeg);
        }
        // 大きく向きを変えるときは水平に回る（後ろ下を見ても宙返り・スプリット S で地面へ突っ込まない）
        //  ただし降りていて地面が近い（地面まで groundWarn 秒より短い）ときは上への指令を減らさない（旋回より引き起こしが先）
        const sink = -this.vel.y, urg = sink > 1 ? 1 - smooth(num(A.groundWarn, 3) * 0.6, num(A.groundWarn, 3) * 1.6, this.agl / sink) : 0;
        //  地面・建物を避けている間（groundAvoid）は上への指令を減らさない（大きく曲がりながら塔へ向かっても引き起こしが先）
        if (offDeg > 30 && !(this.groundAvoid && va > 0)) va *= 1 - smooth(30, 90, offDeg) * (va < 0 ? 0.85 : 0.5 * (1 - urg));
        // ほぼ真後ろ: 横の成分が小さくて向きが決まらない → 回る側を決めて保つ（決めるときは横の成分、無ければ今の傾き）
        if (offDeg > 100) {
          if (!this._turnSide || la * this._turnSide < -0.35) this._turnSide = Math.abs(la) > 0.05 ? Math.sign(la) : (Math.atan2(left.y, upv.y) > 0 ? -1 : 1);
          la = this._turnSide * Math.max(Math.abs(la), 0.6);
        } else if (offDeg < 60) this._turnSide = 0;
        const e = this._v4.copy(hL).multiplyScalar(la).addScaledVector(vU, va);
        const el = e.length();
        const Vt = Math.max(V, 40);
        // 旋回の速さ（rad/s）: 今まで通り off × pitchGain（1.4 まで、下で今の曲がり × turnDamp を引く）。G の上限を上げている間（hi = 0..1）は
        //  off / (1 / pitchGain) を gAuth の G で回れる速さまで（減衰なし: ずれが小さくなれば指令も小さくなる = 逆へ傾かずに G を抜く）
        const hi = this._manBlend();
        const w0 = Math.min(off * A.pitchGain, 1.4);
        const w = hi > 0 ? w0 + (Math.min(off * A.pitchGain * 2, this.gAuth * G / Vt) - w0) * hi : w0;
        // 欲しい加速度（速度に垂直）= 重力の打ち消し gp + 目標への旋回 k × tr。揚力の上限（G・速さ）を超えるなら旋回の分だけ減らす
        //  （重力の打ち消しは残す: 急旋回でも高さを失いにくい。上限 aMax で水平旋回のバンク角が決まる）
        //  旋回の指令から「今の経路の曲がり（加速度の速度に垂直な成分）× turnDamp」を引く（減衰: 小さな修正で左右に揺れ続けない）
        const gpx = -vh.x * G * vh.y, gpy = G - vh.y * G * vh.y, gpz = -vh.z * G * vh.y;
        let tx = 0, ty = 0, tz = 0;
        if (el > 1e-5) { tx = e.x / el * Vt * w; ty = e.y / el * Vt * w; tz = e.z / el * Vt * w; }
        const an = this._aNet, kd = num(A.turnDamp, 0) * (1 - hi);
        if (an && kd > 0) {
          const anv = an.x * vh.x + an.y * vh.y + an.z * vh.z;
          tx -= kd * (an.x - anv * vh.x); ty -= kd * (an.y - anv * vh.y); tz -= kd * (an.z - anv * vh.z);
        }
        const aMax = Math.max(G * 0.3, Math.min(this.gAuth * G, this._liftEff(V) * 0.95));
        let ax, ay, az;
        const tv = tx * vU.x + ty * vU.y + tz * vU.z;
        if (va > 0 && (vh.y < -0.02 || this.groundAvoid) && tv > 0) {
          // 降りていて目標が上: 上への分を先に（旋回の分は残りで）。旋回に揚力を取られて引き起こせないまま地面へ、にならない
          const vx = vU.x * tv, vy = vU.y * tv, vz = vU.z * tv;
          const kv = satK(gpx, gpy, gpz, vx, vy, vz, aMax);
          const bx = gpx + vx * kv, by = gpy + vy * kv, bz = gpz + vz * kv;
          const kl = satK(bx, by, bz, tx - vx, ty - vy, tz - vz, aMax);
          ax = bx + (tx - vx) * kl; ay = by + (ty - vy) * kl; az = bz + (tz - vz) * kl;
        } else {
          const k = satK(gpx, gpy, gpz, tx, ty, tz, aMax);
          ax = gpx + tx * k; ay = gpy + ty * k; az = gpz + tz * k;
        }
        const ar = -(ax * left.x + ay * left.y + az * left.z), au = ax * upv.x + ay * upv.y + az * upv.z;
        // 押す（負の G）かどうかは世界の上下で決める: 欲しい加速度が下向きで横の成分より大きく、ずれが小さいとき。
        //  （機体の軸で決めると、下りながら旋回した後の小さな下へのずれで背面まで回ってしまう）。押す間は機体を起こしてから押す
        const ah = Math.hypot(ax, az);
        if (!this._push && ay < 0 && offDeg < A.pushMax && ah < -ay) this._push = true;
        else if (this._push && (ay > 0.5 * G || offDeg > A.pushMax * 1.3 || ah > -ay * 1.5)) this._push = false;
        let bankErr;
        if (this._push) bankErr = Math.atan2(-ar, -au);
        else {
          // 欲しい傾き（世界の上下に対して）。上限: 揚力の上限で水平に回れる傾き acos(G / aMax) + bankMargin
          //  （下へ加速したい = 降下の旋回・下の目標のときは背面まで回ってよい）。脚を下ろして地面の近く（lowAgl m）では lowBank° まで
          //  （着艦・着陸の直前に翼を水平に。接地の傾きの上限 touchdownRoll より内側）
          // 世界の上から測った欲しい傾き（右が正）: 欲しい加速度の右（水平、飛んでいく向きの右 = −hL）と上の成分
          let want = Math.atan2(-(ax * hL.x + az * hL.z), ay);
          if (Math.abs(vh.y) > 0.9) want = Math.atan2(ar, au) + bank; // ほぼ真上・真下: 機体の軸で
          let lim = Math.PI;
          // 傾きの余裕: 大きな G では小さく（acos(G / aMax) がほぼ 90°。余裕 8° のままだと背面の手前まで回る）
          const bm = aMax > d.gLimit * G ? Math.max(M.bankMarginMin, num(A.bankMargin, 8) * d.gLimit * G / aMax) : num(A.bankMargin, 8);
          //  大きな G の間は、下の目標でも 60° より小さなずれなら背面まで回らない（押す・小さな傾きで下りる）
          //  小さなずれ（aim.invertOff° より小さい）でも背面まで回らない（急旋回の終わりで目標が少し下にあると、横のずれが下のずれより
          //  小さくなったとたんに −84° → −106° と背面の側へ回っていた）
          if (ay >= 0 || !(va < 0 && -va > Math.abs(la)) || (hi > 0.5 && offDeg < 60) || offDeg < num(A.invertOff, 30)) lim = Math.acos(clamp(G / aMax, 0, 1)) + bm * D2R;
          if (this.gearDown && this.agl < num(A.lowAgl, 40) && !this._prot && !this._oob) {
            const lb = num(A.lowBank, 10) * D2R;
            lim = Math.min(lim, lb + (lim - lb) * smooth(num(A.lowAgl, 40) * 0.4, num(A.lowAgl, 40), this.agl));
          }
          want = clamp(want, -lim, lim);
          bankErr = wrap(want - bank);
        }
        pCmd = clamp(bankErr * A.rollGain * (1 + M.rollGainBoost * hi), -rr * D2R, rr * D2R);
        // 左スティックの横はロール（優先）: はっきり横へ倒したときだけ（|x| > stickRoll かつ縦の stickAngle 倍より大きい = 縦から 45° より横。
        //  上へ押している親指のずれではロールしない）。離陸の直後（_prot）・地面を避けている間（groundAvoid）は使わない
        if (!c.easy && !this.autoland && !this._prot && !this.groundAvoid && Math.abs(c.stickX) > A.stickRoll && Math.abs(c.stickX) > A.stickAngle * Math.abs(c.stickY)) pCmd = c.stickX * rr * D2R;
        nCmd = au / G;
        //  大きな G: 揚力は速度に垂直（迎え角 16° で機体の上と cos 16° 違う）。揚力の向きの成分で（200 G に届く）
        if (hi > 0) {
          const vd = this._v1.copy(this.vel).normalize(), ld = this._v2.copy(upv).addScaledVector(vd, -upv.dot(vd));
          const ll = ld.length();
          if (ll > 0.3) nCmd = (ax * ld.x + ay * ld.y + az * ld.z) / (ll * G);
        }
        // 傾ききる前に引きすぎない（傾きの途中で引くと上へ曲がって高さが増える）: 揚力の上向きの成分が欲しい上向き + 0.3 G を超えない
        //  大きな G の間はほぼ 90° の傾きまで（1° のずれでも上下に 1 G 以上ずれる）
        //  大きな G の間は傾けている途中（傾きのずれ maneuver.rollingErr° より大きい）だけ。傾ききった後は 1° のずれで止めない（200 G に届かない）
        const rolling = hi === 0 || Math.abs(bankErr) > M.rollingErr * D2R;
        if (rolling && !this._push && ay >= 0 && upv.y > (hi > 0 ? 0.02 : 0.1)) nCmd = Math.min(nCmd, (ay + (0.3 + 0.5 * hi) * G) / (G * upv.y));
        //  大きな G で下の目標: 傾ききる（揚力が下を向く）までは大きく引かない（引くと上へ曲がって高く上がる）
        else if (rolling && hi > 0 && !this._push && ay < 0 && upv.y > 0.02) nCmd = Math.min(nCmd, Math.max(d.gLimit * 0.5, (0.3 + 0.5 * hi) * G / (G * upv.y)));
        // 機首の細かい合わせ（方向舵。ずれが小さいときだけ）
        const lat = -(aim.x * left.x + aim.y * left.y + aim.z * left.z) + (vh.x * left.x + vh.y * left.y + vh.z * left.z);
        rud = clamp(lat * A.yawGain * 20 * (1 - smooth(A.levelFrom, A.levelTo, offDeg)), -1, 1);
        this.aimOff = offDeg;
      }
      cmd.n = clamp(nCmd, this._gNeg(), this.gAuth);
      cmd.p = pCmd; cmd.rud = rud;
      this._rollScale = rr / d.rollRate;
      cmd.steer = 0; cmd.pitchUp = false;
    }

    // ---------- かんたん操作・自動着艦（オーナー「戦闘機の操作もうちょい簡単にして」）----------

    // かんたん: 左スティック → 見た方へ飛ぶ操縦の目標（世界の単位ベクトル）。横 = 今の向きから turnLead° まで（stickCurve 乗）ずらす = 旋回
    //   （傾き・協調は _fcs）、縦 = 経路角 climbAngle / −diveAngle°。離すと向き・高度を保つ（_easy に覚える）。地図の端・離陸の直後・
    //   地面を避けた後は今の向き・高さを覚え直す（離した後に元の向き・低い高さへ戻って出たり入ったりしない）
    _easyAim(dt, wasAvoid) {
      const d = this.def, E = d.easy, c = this.ctl, V = Math.max(this.speed, 1);
      const dz = E.deadzone, sx = c.stickX, sy = c.stickY * (c.invert ? -1 : 1);
      const turning = Math.abs(sx) > dz, climbing = Math.abs(sy) > dz;
      const trackYaw = Math.atan2(this.vel.x, this.vel.z);
      let H = this._easy;
      if (!H) H = this._easy = { yaw: trackYaw, alt: this.p.y + this.vel.y * E.altLead, turning: false, climbing: false, prevYaw: trackYaw, yawRate: 0, prot: false };
      const yr = wrap(trackYaw - H.prevYaw) / Math.max(dt, 1e-3);
      H.yawRate += (yr - H.yawRate) * Math.min(1, dt * 10);
      H.prevYaw = trackYaw;
      if (turning || this._oob || this._prot) H.yaw = trackYaw;
      else if (H.turning) H.yaw = trackYaw + H.yawRate * E.yawLead;
      if (climbing || this._prot) H.alt = this.p.y;
      else if (H.climbing || H.prot) H.alt = this.p.y + this.vel.y * E.altLead;
      // 地面・建物を避けて上がった: その高さを保つ（また谷へ下りない）。避け終わっても上りの勢いが残る間はその高さまで上げる
      //  （元の高さへ押し戻すと、旋回中は背面まで傾けて下りる）
      if (wasAvoid) { H.alt = Math.max(H.alt, this.p.y); H.rise = true; }
      else if (H.rise) { if (!climbing && this.vel.y > 0.5) H.alt = Math.max(H.alt, this.p.y); else H.rise = false; }
      H.turning = turning; H.climbing = climbing; H.prot = !!this._prot;
      // 大きく曲がりたい度合い（_fcs が G の上限に使う）: スティックの大きさ
      this._easyDemand = Math.pow(smooth(E.gFrom, 1, Math.hypot(sx, sy)), E.gCurve);
      const curve = (x) => Math.pow(clamp((Math.abs(x) - dz) / (1 - dz), 0, 1), E.stickCurve);
      const yaw = turning ? trackYaw - Math.sign(sx) * E.turnLead * D2R * curve(sx) : H.yaw; // 右 = ヨーが減る向き
      let pitch;
      if (climbing) pitch = sy > 0 ? E.climbAngle * D2R * curve(sy) * smooth(E.minSpeed, E.minSpeed + E.climbBand, this.speed) : -E.diveAngle * D2R * curve(sy);
      else pitch = clamp(Math.atan2(H.alt - this.p.y, Math.max(V, 40) * E.holdTau), -E.holdMaxPitch * D2R, E.holdMaxPitch * D2R);
      // 保つ角は今の経路角から holdPitchLag° まで（上り・下りの途中で離しても、一度に水平を目標にして背面まで回って下りない）
      const gam = Math.asin(clamp(this.vel.y / V, -1, 1));
      if (climbing || H.pitch == null || this._prot) H.pitch = gam;
      else {
        if (wasAvoid) H.pitch = Math.max(H.pitch, gam);
        const lag = num(E.holdPitchLag, 8) * D2R;
        H.pitch = clamp(pitch, gam - lag, gam + lag); // 機体が付いてこない（旋回中の上り）: 今の経路角から holdPitchLag° より離さない
        pitch = H.pitch;
      }
      const cp = Math.cos(pitch);
      return (this._eAim || (this._eAim = new THREE.Vector3())).set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    }

    // かんたん・自動着艦の速さ: 目標の速さ（巡航・曲がる・加速 = 最高速・減速 = 下限・自動着艦の速さ）へスロットル（P + 少しの I）、
    //   遅れが大きければ AB、速すぎればエアブレーキ。下限（minSpeed、着陸の形は landingMinSpeed）より遅ければ全開 + AB（失速しない）
    // 大きく曲がりたい度合い（0〜1）: かんたんはスティックの大きさ、見た方へ飛ぶ操縦は見る向きのずれ（maneuver.aimFrom〜aimFull°、curve 乗）。
    //  地図の端から戻し終わってカメラがまだ外を向いている間（_oobLatch）は 0（ゆるい旋回）
    _aimDem(offDeg) {
      const c = this.ctl, M = this.def.maneuver;
      if (c.easy) return this._easyDemand || 0;
      if (this._oobLatch || this._oob) return 0; // 端で戻している間の目標は操縦士の見る向きではない（G は _oobDem だけ）
      return Math.pow(smooth(M.aimFrom, M.aimFull, offDeg), M.curve);
    }
    // 上の「よける」: 必要なら _esc = { side, until, floor } を立てて、使う下限を返す
    _escape(ctx, V, gNow, floor) {
      const d = this.def, A = d.aim, vs = this._spdVs || d.stallSpeed, vh = Math.hypot(this.vel.x, this.vel.z);
      const E = this._esc;
      if (E && (this.time > E.until || vh < 1)) { this._escLast = { side: E.side, t: this.time }; this._esc = null; }
      if (this._esc) {
        if (this.time - this._esc.at >= A.lookEvery) { this._esc.floor = this._arcFloor(ctx, V, vh, this._esc.om); this._esc.at = this.time; }
        return Math.min(floor, Math.max(this._esc.floor, gNow - 5 * D2R));
      }
      if (vh < 1 || V > vs * num(A.escSpeedK, 1.6) || (this._floorPath - gNow) < num(A.escFrom, 15) * D2R) return floor;
      const aT = Math.min((this.gAuth || d.gLimit) * G, this._liftMax(V)) * 0.9, w = Math.sqrt(Math.max(0, aT * aT - G * G)) / Math.max(V, 1);
      if (w < 0.05) return floor;
      const L = this._escLast && this.time - this._escLast.t < 1 ? this._escLast.side : 0; // 終わってすぐなら同じ側だけ
      const fP = L >= 0 ? this._arcFloor(ctx, V, vh, w) : Infinity, fN = L <= 0 ? this._arcFloor(ctx, V, vh, -w) : Infinity;
      const side = fP <= fN ? 1 : -1, fb = Math.min(fP, fN);
      if (fb > this._floorPath - num(A.escGain, 10) * D2R) return floor;
      this._esc = { side, om: side * w, floor: fb, at: this.time, until: this.time + num(A.escHold, 2) };
      this.events.push({ t: 'escape', side, from: Math.round(this._floorPath / D2R), to: Math.round(fb / D2R), v: Math.round(V) });
      return Math.min(floor, Math.max(fb, gNow - 5 * D2R));
    }
    _easyThrottle(dt) {
      const d = this.def, E = d.easy, c = this.ctl, V = this.speed, ap = this.autoland, cmd = this.cmd;
      // 着陸の形 = 自動着艦の最終進入か、脚を下ろして空母・道路に並んでいる（離陸の直後の脚はまだ下りているが着陸ではない）
      const landingCfg = ap ? ap.phase === 'final' : (this.gearDown && this.gearPos > 0.5 && !this._prot && !!this._lined);
      const vMin = landingCfg ? E.landingMinSpeed : E.minSpeed;
      let tgt;
      if (ap) tgt = this._apSpeed || E.cruiseSpeed;
      else if (c.boost) tgt = d.maxSpeed + 50;
      else if (c.slow) tgt = landingCfg ? (d.approach.speed || 70) : vMin;
      else if (landingCfg) tgt = d.approach.speed || 70;
      else tgt = E.cruiseSpeed - (E.cruiseSpeed - E.turnSpeed) * Math.min(1, Math.abs(c.stickX));
      this._thrI = clamp((this._thrI || 0) + (tgt - V) * E.throttleI * dt, -E.throttleIMax, E.throttleIMax);
      let thr = clamp(E.throttleBase + (tgt - V) * E.throttleGain + this._thrI, 0, 1);
      let ab = (c.boost && !ap) || tgt - V > E.abMargin;
      if (V < vMin || this.bolter) { thr = 1; ab = true; } // ボルター: 全開
      this.throttle += clamp(thr - this.throttle, -E.throttleRate * dt, E.throttleRate * dt);
      this.abOn = ab && this.throttle >= 0.98;
      this.easyTarget = tgt;
      cmd.brake = 0;
      cmd.airbrake = !this.bolter && ((c.slow && !ap && V > vMin + 8) || V - tgt > E.airbrakeOver || (!!ap && V - tgt > 6 && this.throttle <= 0.05));
    }

    // 地図の端の帯の幅（端へ向かう速さ vo の割合 u で外へ膨らむ分 = 半径 Rt × (1 − √(1 − u²))、m0〜mMax m。毎フレーム関数を作らない）
    static _band(vo, vh, m0, mMax, Rt) { const u = clamp(vo / vh, 0, 1); return Math.max(m0, Math.min(mMax, Rt * (1 - Math.sqrt(1 - u * u)))); }
    // 着艦・着陸できる場所（空母の着艦の線と game.json の autoland.roads）。{ kind, name, x, z, y, fx, fz, rx, rz, len }
    _strips() {
      if (this._stripList) return this._stripList;
      const out = [], ops = this.ops, AL = this.def.autoland;
      if (ops && ops.landing) { const L = ops.landing; out.push({ kind: 'carrier', name: '空母', x: L.x, z: L.z, y: ops.deckY, fx: L.fx, fz: L.fz, rx: L.rx, rz: L.rz, len: L.length }); }
      for (const r of (AL.roads || [])) {
        const a = (r.yaw || 0) * D2R, fx = Math.sin(a), fz = Math.cos(a);
        out.push({ kind: 'road', name: r.name || '道路', x: r.x, z: r.z, y: null, fx, fz, rx: -fz, rz: fx, len: r.length || 1000 });
      }
      return (this._stripList = out);
    }
    // 着艦・着陸の向きに並んでいる（かんたんの脚・地面を避けない）: 接地点の手前 easy.gearDist m 以内、横 stripLat m（遠いほど広く）、向き stripAngle° 以内
    _lineUp() {
      const E = this.def.easy, vh = Math.hypot(this.vel.x, this.vel.z) || 1;
      this._lined = null;
      for (const S of this._strips()) {
        const a = (this.p.x - S.x) * S.fx + (this.p.z - S.z) * S.fz, l = (this.p.x - S.x) * S.rx + (this.p.z - S.z) * S.rz;
        const cosH = (this.vel.x * S.fx + this.vel.z * S.fz) / vh;
        if (a < 150 && -a < E.gearDist && Math.abs(l) < E.stripLat + Math.max(0, -a) * 0.1 && cosH > Math.cos(E.stripAngle * D2R)) { this._lined = S; break; }
      }
      return this._lined;
    }
    // 自動着艦・着陸に使える所（空中）: 空母の autoland.carrierRange m 以内なら空母、そうでなければ roadRange m 以内の一番近い道路。{ kind, strip, dist } か null
    autolandTarget() {
      if (this.mode !== 'air' || this.wrecked || !this.driver) return null;
      const AL = this.def.autoland;
      let best = null;
      for (const S of this._strips()) {
        const dist = Math.hypot(this.p.x - S.x, this.p.z - S.z);
        const range = S.kind === 'carrier' ? AL.carrierRange : AL.roadRange;
        if (dist > range) continue;
        if (S.kind === 'carrier') return { kind: 'carrier', strip: S, dist };
        if (!best || dist < best.dist) best = { kind: 'road', strip: S, dist };
      }
      return best;
    }
    // 自動着艦・着陸を始める（着艦 / 着陸ボタン）。始められなければ false
    startAutoland(ctx) {
      const t = this.autolandTarget();
      if (!t) { this.events.push({ t: 'autoland_none' }); return false; }
      this.autoland = { kind: t.kind, strip: t.strip, phase: null, prof: null, t: 0, side: 0, gear: false, outD: 0, tries: 0 };
      this._apAim = null;
      if (ctx) this._apPlan(ctx);
      this.events.push({ t: 'autoland', kind: t.kind, name: t.strip.name });
      return true;
    }
    cancelAutoland(why) {
      if (!this.autoland) return;
      const kind = this.autoland.kind;
      this.autoland = null; this._apAim = null; this._easy = null;
      this.events.push({ t: 'autoland_off', why: why || 'cancel', kind });
    }
    // 進入路の高さ（中心線の後ろ d m の目標の高さ。地面の高さからの m ではなく世界の y）を作る: 3.5° の線か、建物 + clear m を
    //   下りは descent°・上りは climb° で越える形の高い方。接地点の近く noClear m は建物を見ない（艦橋・道路の脇の小物）
    _apPlan(ctx) {
      const ap = this.autoland, S = ap.strip, AL = this.def.autoland, ci = this.city;
      if (S.y == null) S.y = this._topAt(ctx, S.x, S.z);
      const GS = Math.tan(((this.def.approach && this.def.approach.glideSlope) || 3.5) * D2R);
      // 後ろへ出る距離: 地図の端（boundsMargin + boundsPad）の内側
      let outD = AL.outDist;
      if (ci) {
        const m = this.def.boundsMargin + AL.boundsPad;
        const inside = (x, z) => x > ci.minX + m && x < ci.maxX - m && z > ci.minZ + m && z < ci.maxZ - m;
        while (outD > 1200 && !inside(S.x - S.fx * outD, S.z - S.fz * outD)) outD -= 100;
        ap.inside = inside;
      }
      ap.outD = outD;
      const n = Math.ceil((outD + 600) / AL.step) + 1, floor = new Float32Array(n), prof = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const dd = i * AL.step;
        let h = S.y + GS * dd;
        if (dd > AL.noClear) {
          for (const l of [-AL.lat, -AL.lat / 2, 0, AL.lat / 2, AL.lat]) {
            const x = S.x - S.fx * dd + S.rx * l, z = S.z - S.fz * dd + S.rz * l;
            h = Math.max(h, this._topAt(ctx, x, z) + AL.clear);
          }
        }
        floor[i] = h;
      }
      const td = Math.tan(AL.descent * D2R) * AL.step, tc = Math.tan(AL.climb * D2R) * AL.step;
      for (let i = n - 1; i >= 0; i--) prof[i] = i < n - 1 ? Math.max(floor[i], prof[i + 1] - td) : floor[i];
      for (let i = 1; i < n; i++) prof[i] = Math.max(prof[i], prof[i - 1] - tc);
      ap.prof = prof; ap.GS = GS;
      // 接地点から進入路がまっすぐ（3.5° の線のまま = 建物を越える形になっていない）な距離
      let st = 0;
      for (let i = 1; i < n && prof[i] <= S.y + GS * i * AL.step + 0.5; i++) st = i * AL.step;
      ap.straight = st;
    }
    _apHeight(dd) {
      const ap = this.autoland, AL = this.def.autoland, P = ap.prof;
      if (dd <= 0) return ap.strip.y + ap.GS * dd * AL.belowK;
      const f = dd / AL.step, i = Math.min(P.length - 2, Math.floor(f)), k = Math.min(1, f - i);
      return P[i] + (P[i + 1] - P[i]) * k;
    }
    // 毎フレーム（操縦士がいて autoland のとき、_fcs の初め）: スティックで取り消し、段階（out → intercept → final → 地上）を進め、
    //   目標の向き _apAim・速さ _apSpeed・脚 autoland.gear を決める
    _autolandUpdate(dt, ctx) {
      const ap = this.autoland, AL = this.def.autoland, c = this.ctl, S = ap.strip;
      ap.t += dt;
      if (Math.hypot(c.stickX, c.stickY) > AL.cancelStick && !this.arrest && !(this.mode === 'ground' && !this.bolter)) { this.cancelAutoland('stick'); return; }
      if (!ap.prof) this._apPlan(ctx);
      if (this.mode === 'ground') {
        this._apAim = null;
        if (this.bolter) { ap.phase = 'bolter'; return; }
        ap.phase = 'rollout';
        if (!this.arrest && Math.abs(this.u) < 0.5) { this.autoland = null; this._apAim = null; this.events.push({ t: 'autoland_done', kind: ap.kind }); }
        return;
      }
      // 空中のボルター（フックの先がワイヤーを全部越えた: 甲板のすぐ上で浮いて越えた・接地して走って越えた）: 全開で甲板の向きに
      //  bolterClimb° で上がる（_carrier が甲板から bolterClear m 上がるか空母から離れたら bolter を消す → やり直し）
      if (this.bolter) {
        ap.phase = 'bolter'; ap.iErr = 0;
        const cp = Math.cos(AL.bolterClimb * D2R);
        this._apAim = (this._apAimV || (this._apAimV = new THREE.Vector3())).set(S.fx * cp, Math.sin(AL.bolterClimb * D2R), S.fz * cp);
        this._apSpeed = AL.cruise;
        return;
      }
      if (ap.phase === 'rollout' || ap.phase === 'bolter') { ap.phase = 'out'; ap.tries++; ap.iErr = 0; } // 跳ねた・ボルター: やり直し
      if (ap.tries > AL.maxTries) { this.cancelAutoland('fail'); return; } // 何度やっても降りられない: やめて操縦を返す（同じやり直しを続けない）
      const a = (this.p.x - S.x) * S.fx + (this.p.z - S.z) * S.fz, l = (this.p.x - S.x) * S.rx + (this.p.z - S.z) * S.rz, dd = -a;
      const vh = Math.hypot(this.vel.x, this.vel.z) || 1, cosH = (this.vel.x * S.fx + this.vel.z * S.fz) / vh;
      const he = Math.acos(clamp(cosH, -1, 1)) / D2R;
      const cy = this.p.y - this.pos.y; // 重心の高さ（目標は脚の高さで作るので足す）
      const y0 = this.p.y - cy;
      // 旋回半径の目安（今の速さ・cruise の速い方で、出せる揚力の 8 割で水平に回る）→ ベクトル場の幅 Lk（vfK 倍、vfMin m 以上）
      const Vt = Math.max(this.speed, AL.cruise), aT = Math.max(G * 1.5, this._liftMax(Vt) * 0.8);
      const Rt = Vt * Vt / Math.sqrt(Math.max(1, aT * aT - G * G)), Lk = Math.max(AL.vfMin, Rt * AL.vfK);
      // 今から intercept（中心線へのベクトル場）で寄ると、接地点の手前 joinMin m（短い進入は outD × 0.8 まで）より遠くで final に入れるか
      //  （_apJoin: 旋回半径 Rt で曲がる点を 25 m ずつ進めて見る。0.25 秒ごと）
      if (!ap.phase || this.time >= (ap.joinT || 0)) { ap.joinT = this.time + 0.25; ap.join = this._apJoin(dd, l, Rt, Lk); }
      const canJoin = ap.join >= Math.min(AL.joinMin, ap.outD * 0.8);
      if (!ap.phase) {
        ap.phase = canJoin && (y0 - this._apHeight(dd) <= AL.goHigh || this._apReach(dd, y0)) ? 'intercept' : 'out';
      }
      // やり直し（_apRetry）: go = まず進入の向きに全開で goClimb° 上がる（低い・最終進入の途中）。横へずれていたらそちら側から回り直す
      const R0 = this._apR || (this._apR = { dd: 0, l: 0, he: 0, h: 0 });
      R0.dd = dd; R0.l = l; R0.he = he; R0.h = y0 - S.y;
      if (ap.phase === 'final' && (Math.abs(l) > AL.abortLat || he > AL.abortAngle || dd < -AL.abortPast)) this._apRetry('final', true);
      //  空母の着艦の場所に機体がある（甲板員が片付けている間）: 接地点の手前 foulWaveOff m まで来てもまだならやり直す（ワイヤーの後の走りで
      //  止まっている機体にぶつからない）
      if (ap.phase === 'final' && ap.kind === 'carrier' && this.deckFoul && dd > 0 && dd < AL.foulWaveOff) this._apRetry('foul', true);
      // 最終進入で高すぎる・速すぎる・横にずれている: 進入路に乗れないまま急降下して道路・甲板に落ちる前にやり直す（ゴーアラウンド）
      if (ap.phase === 'final') {
        const err = y0 - this._apHeight(dd);
        if (dd > AL.goShort) {
          //  goSteep° で下りても接地点の手前 goCap m までに進入路へ届かない（避けて上がった後・高い所から最終進入に入った）
          if (err > AL.goHigh && this.time >= (ap.goCheck || 0)) {
            ap.goCheck = this.time + 0.25;
            if (!this._apReach(dd, y0)) this._apRetry('high', true);
          }
        } else if (dd > 0 && (err > AL.goHighShort + dd * AL.goHighK || Math.abs(l) > AL.goLat || (dd < AL.goShort * 0.5 && this.speed > this.def.touchdownSpeed - AL.goFast))) this._apRetry(err > AL.goHighShort + dd * AL.goHighK ? 'high' : Math.abs(l) > AL.goLat ? 'lat' : 'fast', true);
      }
      //  intercept: 中心線に乗ったら（横 finalLat m・向き finalAngle° 以内）final。interceptAbort m（後ろの距離 × interceptAbortK）より近くでは
      //  寄っている途中（横 finalLat × lateK・向き finalAngle × lateK 以内）でも final にする（ベクトル場は線に漸近するので、残りは final の
      //  先読みで寄せる）。それより外れていたらやり直し
      if (ap.phase === 'intercept') {
        //  寄っている間に高すぎて進入路へ下りられなくなった（地面・建物をよけて上がった）: 一度だけ黙って out（入口までの道で下りる）へ
        if (!ap.rerouted && y0 - this._apHeight(dd) > AL.goHigh && this.time >= (ap.goCheck || 0)) {
          ap.goCheck = this.time + 0.25;
          if (!this._apReach(dd, y0)) { ap.rerouted = true; ap.phase = 'out'; ap.path = null; }
        }
      }
      if (ap.phase === 'intercept') {
        const late = dd < Math.min(AL.interceptAbort, ap.outD * AL.interceptAbortK);
        if ((Math.abs(l) < AL.finalLat && he < AL.finalAngle) || (late && Math.abs(l) < AL.finalLat * AL.lateK && he < AL.finalAngle * AL.lateK)) {
          //  final に入る所で高すぎる（下りても進入路に届かない）なら、まだ out へ回れるうちは回る（final に入ってすぐゴーアラウンドしない）
          if (!ap.rerouted && y0 - this._apHeight(dd) > AL.goHigh && !this._apReach(dd, y0)) { ap.rerouted = true; ap.phase = 'out'; ap.path = null; }
          else ap.phase = 'final';
        }
        else if (late) this._apRetry('intercept', false);
      }
      let tx, ty, tz, speed = AL.cruise;
      ap.gear = false;
      if (ap.phase === 'go') {
        // ゴーアラウンド: 進入の向きへ goClimb° で全開（脚は上げる）。接地点の高さから goAlt m（goMin 秒以上）か goTime 秒で out へ
        ap.goT = (ap.goT || 0) + dt;
        if ((y0 - S.y > AL.goAlt && ap.goT > AL.goMin) || ap.goT > AL.goTime) ap.phase = 'out';
        else {
          const cp = Math.cos(AL.goClimb * D2R);
          this._apAim = (this._apAimV || (this._apAimV = new THREE.Vector3())).set(S.fx * cp, Math.sin(AL.goClimb * D2R), S.fz * cp);
          this._apSpeed = AL.cruise;
          ap.dist = dd; ap.lat = l;
          return;
        }
      }
      if (ap.phase === 'out') {
        // 入口（中心線の後ろ outD m、着陸の向き）までの Dubins の道（_apPath: 半径 = 旋回半径 × dubinsK の円弧・直線・円弧の一番短いもので、
        //  地図の端から boundsMargin + pathPad m の中に収まるもの）を dubinsEvery 秒ごとに今の位置から作り直し、lookTime 秒（lookMin m 以上）
        //  先の道の点へ向かう。入口で中心線に乗って（横 finalLat m・向き finalAngle° 以内）final。中心線へ寄っても間に合う所（canJoin）なら
        //  intercept。以前は中心線の横の点へまっすぐ向かい、横向きのまま intercept に入って 1 km の所で 200〜700 m 横にずれ、同じやり直しを
        //  何度もくり返していた
        //  （どちらも今の高さから進入路へ下りられるとき = _apReach。高すぎてやり直した後に、すぐ同じ所から final に入り直さない）
        const reach = y0 - this._apHeight(dd) <= AL.goHigh || this._apReach(dd, y0);
        if (reach && canJoin && ap.join >= Math.min(AL.joinMin, ap.outD * 0.8) + AL.joinOutPad) { ap.phase = 'intercept'; ap.path = null; }
        else if (reach && Math.abs(l) < AL.finalLat && he < AL.finalAngle && dd > Math.min(AL.joinMin, ap.outD * 0.8) && dd < ap.outD + AL.joinOver) { ap.phase = 'final'; ap.path = null; }
        else {
          if (!ap.path || this.time >= (ap.pathT || 0)) { ap.pathT = this.time + AL.dubinsEvery; ap.path = this._apPath(Rt * AL.dubinsK); }
          const P = ap.path, look = Math.max(AL.lookMin, this.speed * AL.lookTime);
          const q = this._apPathAt(P, Math.min(P.len, look + P.s0), this._apQ || (this._apQ = { x: 0, z: 0, rem: 0 }));
          // 高さ: 入口で進入路 + gateAbove m（outAlt m より低くてよい）、道の残りで outSlope° より急に下りない
          const gateH = this._apHeight(ap.outD) + AL.gateAbove, rem = Math.max(0, P.len - look - P.s0) + look;
          ty = Math.max(gateH, Math.min(Math.max(S.y + AL.outAlt, gateH), gateH + rem * Math.tan(AL.outSlope * D2R))) + cy;
          const hx = q.x - this.p.x, hz = q.z - this.p.z, hd = Math.hypot(hx, hz) || 1;
          const pitch = clamp(Math.atan2(ty - this.p.y, Math.max(this.speed, 40) * AL.outTau), -AL.outPitch * D2R, AL.outPitch * D2R), cp = Math.cos(pitch);
          this._apAim = (this._apAimV || (this._apAimV = new THREE.Vector3())).set(hx / hd * cp, Math.sin(pitch), hz / hd * cp);
          this._apSpeed = speed;
          ap.dist = dd; ap.lat = l;
          return;
        }
      }
      if (ap.phase === 'final') {
        const dc = dd - clamp(dd * AL.leadK, AL.leadMin, AL.leadMax);
        if (dd < AL.gearDist) ap.gear = true;
        if (dd < AL.slowDist) speed = (this.def.approach && this.def.approach.speed) || 70;
        tx = S.x - S.fx * dc; tz = S.z - S.fz * dc;
      } else {
        // intercept: 中心線へ向けるベクトル場（横のずれ l が大きいほど vfAngle° に近い角で横切り、近づくと Lk m の幅でなめらかに乗る）。
        //  以前の「中心線の先の点（最大 800 m 先）」へ向かう形は、横 1 km から 50° でしか寄らず、乗るまでに 1.5 km 進んでいた
        const ch = this._apVf(l, Lk), cc = Math.cos(ch), sc = Math.sin(ch);
        tx = this.p.x + (S.fx * cc - S.rx * sc) * 1000; tz = this.p.z + (S.fz * cc - S.rz * sc) * 1000;
      }
      // 横（final）: 中心線の dc の点へ（長い先読みで揺れない）。縦: 進入路の高さを vLeadTime 秒（少なくとも vLeadMin m）先まで見て、
      //  その間のどの点でも進入路より下にならない一番浅い経路角（遠くの点へまっすぐだと、塔を越えた後に下りる所で角を切って塔に当たる）
      const Lv = Math.max(AL.vLeadMin, this.speed * AL.vLeadTime);
      let tg = (this._apHeight(dd - Lv) - y0) / Lv;
      for (let s1 = AL.step; s1 < Lv; s1 += AL.step) tg = Math.max(tg, (this._apHeight(dd - s1) - y0) / s1);
      // 最終進入の終わり（接地点の手前 trackDist m より近く、進入路がまっすぐな 3.5° の所）: 進入路に乗る。ずれ（脚の高さ − 進入路）を
      //  trackTau 秒（下にいるときは trackTauLow 秒）で消す + 小さな積分（trackI。見た方へ飛ぶ計算の遅れの分）。上の「どこでも下に
      //  ならない一番浅い角」だけだと上にいるずれが 2.5 秒の時定数でしか減らず（接地点の先の進入路は浅い）、2〜3 m 上のまま
      //  ワイヤーを全部越えて浮いていた
      if (ap.phase === 'final' && dd < Math.min(AL.trackDist, ap.straight || 0) && dd > -AL.abortPast) {
        const hT = this._apHeight(dd), err = y0 - hT, slope = (hT - this._apHeight(dd - AL.step)) / AL.step;
        if (Math.abs(err) < AL.trackIWin) ap.iErr = clamp((ap.iErr || 0) + err * dt, -AL.trackIMax, AL.trackIMax); // 近くに来てから（上から降りてくる間に貯めない）
        const tau = err > 0 ? AL.trackTau : AL.trackTauLow;
        const tgT = -slope - (err + ap.iErr * AL.trackI) / (Math.max(this.speed, 40) * tau);
        const k = smooth(Math.min(AL.trackDist, ap.straight), Math.min(AL.trackDist, ap.straight) * 0.75, dd); // 切り替えはなめらかに
        tg = tg + (tgT - tg) * k;
      } else ap.iErr = 0;
      //  最終進入: 接地点の高さに近いほど沈下を小さく（flareSink + 高さ × flareK m/s まで。接地の沈下 touchdownSink を超えて落ちない）
      if (ap.phase === 'final') tg = Math.max(tg, -(AL.flareSink + Math.max(0, y0 - S.y) * AL.flareK) / Math.max(this.speed, 40));
      const pitch = Math.atan(clamp(tg, -Math.tan(AL.maxDive * D2R), Math.tan(AL.maxClimb * D2R))), cpz = Math.cos(pitch);
      const hx = tx - this.p.x, hz = tz - this.p.z, hl = Math.hypot(hx, hz) || 1;
      this._apAim = (this._apAimV || (this._apAimV = new THREE.Vector3())).set(hx / hl * cpz, Math.sin(pitch), hz / hl * cpz);
      this._apSpeed = speed;
      ap.dist = dd; ap.lat = l;
    }

    // 線からの横のずれ e → 線へ向ける角（rad。遠いほど vfAngle° に近い、幅 Lk m でなめらかに 0 へ）
    _apVf(e, Lk) { return this.def.autoland.vfAngle * D2R * (2 / Math.PI) * Math.atan(e / Lk); }
    // 今の位置・向きから入口（中心線の後ろ outD m、着陸の向き）までの Dubins の道（円弧 − 直線 − 円弧: LSL / RSR / LSR / RSL）。半径 R m。
    //  { x0, z0, a0（進む向き = atan2(dz, dx)）, R, segs: [[種類 1 左 / 0 直線 / −1 右, 長さ m] ×3], len, s0 }。地図の端から boundsMargin + pathPad m の
    //  中に収まる一番短いもの（どれも出るなら一番短いもの）
    _apPath(R) {
      const ap = this.autoland, S = ap.strip, AL = this.def.autoland, ci = this.city, TAU = Math.PI * 2;
      const md = (a) => ((a % TAU) + TAU) % TAU;
      const x0 = this.p.x, z0 = this.p.z, a0 = Math.atan2(this.vel.z, this.vel.x);
      const x1 = S.x - S.fx * ap.outD, z1 = S.z - S.fz * ap.outD, a1 = Math.atan2(S.fz, S.fx);
      const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) / R, th = Math.atan2(dz, dx);
      const al = md(a0 - th), be = md(a1 - th), sa = Math.sin(al), sb = Math.sin(be), ca = Math.cos(al), cb = Math.cos(be), cab = Math.cos(al - be);
      const P = this._apP || (this._apP = { x0: 0, z0: 0, a0: 0, R: 0, segs: [[0, 0], [0, 0], [0, 0]], len: 0, s0: 0 });
      const cands = this._apC || (this._apC = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]]);
      let n = 0;
      const put = (k1, t, p, k3, q) => { const c = cands[n++]; c[0] = k1; c[1] = t * R; c[2] = p * R; c[3] = k3; c[4] = q * R; c[5] = (t + p + q) * R; c[6] = 0; };
      let p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb); // LSL
      if (p2 >= 0) { const t1 = Math.atan2(cb - ca, d + sa - sb); put(1, md(-al + t1), Math.sqrt(p2), 1, md(be - t1)); }
      p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa); // RSR
      if (p2 >= 0) { const t1 = Math.atan2(ca - cb, d - sa + sb); put(-1, md(al - t1), Math.sqrt(p2), -1, md(-be + t1)); }
      p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb); // LSR
      if (p2 >= 0) { const pp = Math.sqrt(p2), t2 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, pp); put(1, md(-al + t2), pp, -1, md(-be + t2)); }
      p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb); // RSL
      if (p2 >= 0) { const pp = Math.sqrt(p2), t2 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, pp); put(-1, md(al - t2), pp, 1, md(be - t2)); }
      P.x0 = x0; P.z0 = z0; P.a0 = a0; P.R = R; P.s0 = 0;
      const m = (ci ? this.def.boundsMargin + AL.pathPad : 0), q = this._apQ2 || (this._apQ2 = { x: 0, z: 0, rem: 0 });
      let best = -1, bestIn = -1;
      for (let i = 0; i < n; i++) {
        const c = cands[i];
        if (best < 0 || c[5] < cands[best][5]) best = i;
        if (!ci) continue;
        P.segs[0][0] = c[0]; P.segs[0][1] = c[1]; P.segs[1][0] = 0; P.segs[1][1] = c[2]; P.segs[2][0] = c[3]; P.segs[2][1] = c[4]; P.len = c[5];
        let ok = true;
        for (let s1 = 0; s1 <= c[5] && ok; s1 += 100) { this._apPathAt(P, s1, q); if (q.x < ci.minX + m || q.x > ci.maxX - m || q.z < ci.minZ + m || q.z > ci.maxZ - m) ok = false; }
        if (ok && (bestIn < 0 || c[5] < cands[bestIn][5])) bestIn = i;
      }
      const c = cands[bestIn >= 0 ? bestIn : best];
      P.segs[0][0] = c[0]; P.segs[0][1] = c[1]; P.segs[1][0] = 0; P.segs[1][1] = c[2]; P.segs[2][0] = c[3]; P.segs[2][1] = c[4]; P.len = c[5];
      return P;
    }
    // Dubins の道の始めから s m の点 → out { x, z }
    _apPathAt(P, s, out) {
      let x = P.x0, z = P.z0, a = P.a0;
      for (const sg of P.segs) {
        const L = Math.min(sg[1], Math.max(0, s));
        if (sg[0] === 0) { x += Math.cos(a) * L; z += Math.sin(a) * L; }
        else {
          const k = sg[0], R = P.R, cxp = x - k * R * Math.sin(a), czp = z + k * R * Math.cos(a), a2 = a + k * L / R;
          x = cxp + k * R * Math.sin(a2); z = czp - k * R * Math.cos(a2); a = a2;
        }
        s -= sg[1];
        if (s <= 0) break;
      }
      out.x = x; out.z = z;
      return out;
    }
    // 接地点の手前 dd m・高さ y0（脚）から goSteep° で下りて、接地点の手前 goCap m までに進入路へ届くか
    _apReach(dd, y0) {
      const AL = this.def.autoland, tS = Math.tan(AL.goSteep * D2R);
      for (let s1 = AL.step; s1 <= dd - AL.goCap; s1 += AL.step) if (y0 - tS * s1 <= this._apHeight(dd - s1)) return true;
      return false;
    }
    // intercept のベクトル場で寄ったときに final に入る所（接地点の手前の距離 m。入れなければ −1）: 中心線の座標（dd = 接地点の手前の距離、
    //  l = 横、ψ = 進む向き（0 = 着陸の向き、+ = r の側））で、向きを ψc = −場の角 へ旋回半径 Rt で回しながら 25 m ずつ進める
    _apJoin(dd, l, Rt, Lk) {
      const AL = this.def.autoland, S = this.autoland.strip, ds = 25, dpsi = ds / Math.max(50, Rt);
      let psi = Math.atan2(this.vel.x * S.rx + this.vel.z * S.rz, this.vel.x * S.fx + this.vel.z * S.fz);
      const fL = AL.finalLat, fA = AL.finalAngle * D2R, late = Math.min(AL.interceptAbort, this.autoland.outD * AL.interceptAbortK);
      for (let i = 0; i < 400 && dd > 0; i++) {
        const pa = Math.abs(psi);
        if ((Math.abs(l) < fL && pa < fA) || (dd < late && Math.abs(l) < fL * AL.lateK && pa < fA * AL.lateK)) return dd;
        if (dd < late) return -1;
        let e = -this._apVf(l, Lk) - psi;
        while (e > Math.PI) e -= Math.PI * 2;
        while (e < -Math.PI) e += Math.PI * 2;
        psi += clamp(e, -dpsi, dpsi);
        l += Math.sin(psi) * ds; dd -= Math.cos(psi) * ds;
      }
      return -1;
    }
    // 自動着艦・着陸のやり直し（_autolandUpdate のこのフレームの dd / l / he / 高さは this._apR）
    _apRetry(why, go) {
      const ap = this.autoland, AL = this.def.autoland, R0 = this._apR;
      ap.tries++; ap.iErr = 0; ap.goT = 0;
      ap.phase = go ? 'go' : 'out'; ap.path = null;
      this.events.push({ t: 'autoland_retry', why, dd: Math.round(R0.dd), lat: Math.round(R0.l), he: Math.round(R0.he), y: Math.round(R0.h) });
    }
    // 空中の 1 歩（h 秒）
    _flyStep(h, ctx) {
      const d = this.def, v = this.vel, cmd = this.cmd;
      this.axes();
      const fwd = this._fwd, up = this._upv, left = this._left;
      const V = v.length();
      const vf = v.dot(fwd), vu = v.dot(up), vl = v.dot(left);
      const alpha = V > 3 ? Math.atan2(-vu, vf) : 0;
      const beta = V > 3 ? Math.atan2(-vl, Math.max(1, Math.abs(vf))) : 0;
      this.alpha = alpha; this.beta = beta;
      const dens = this._density();
      const landing = this.gearPos > 0.5;
      const vs = landing ? d.stallSpeedLanding : d.stallSpeed;
      const sf = smooth(vs - d.stallBand, vs + 2, V);
      const kqA = this.kl * V * V * sf * dens * (landing ? d.landingLift : 1);   // 迎え角 stallAoA での揚力（空力の校正のまま）
      const mb = this._manBlend();
      const kq = mb > 0 ? kqA + (Math.max(kqA, this._kqMan(V)) - kqA) * mb : kqA; // 大きく曲がりたいときは機動の揚力
      const aS = d.stallAoA * D2R;
      // 揚力の係数（失速角を超えると減る、90° より先は 0）
      const ab = Math.abs(alpha);
      let cl = ab <= aS ? alpha / aS : (ab < Math.PI / 2 ? Math.sign(alpha) * Math.max(0, 1 - (ab - aS) / aS * 0.6) : 0);
      let aL = kq * cl;
      this.aL = aL;
      // 目標の迎え角（G の指令から。失速角まで）
      const want = cmd.n * G;
      let aT = kq > 0.5 ? clamp(want / kq, -0.6, 1) * aS : aS * Math.sign(want || 1);
      this.stall = (sf < 0.98 && V < vs + 4) || (Math.abs(want) > kq * 0.98 && V < vs + 12) ? 1 : 0;
      // 力: 推力・揚力・抗力・横の力・重力
      const lift = this._v1.copy(up).addScaledVector(v, V > 1e-3 ? -up.dot(v) / (V * V) : 0);
      const ll = lift.length();
      if (ll > 1e-6) lift.multiplyScalar(1 / ll); else lift.set(0, 0, 0);
      const T = this._thrust();
      const k0 = this.cd0 * (1 + d.gearDrag * this.gearPos + d.airbrakeDrag * this.airbrake) * dens;
      // 誘導抗力は gLimit までの揚力（今まで通り）+ それを超えた分は maneuver.drag × 超えた分（200 G の旋回でも一瞬で止まらない）
      const aRef = d.gLimit * G, aLa = Math.min(Math.abs(aL), aRef);
      let D = k0 * V * V + d.inducedDrag * aLa * aLa / Math.max(400, V * V) + d.maneuver.drag * Math.max(0, Math.abs(aL) - aRef);
      if (V > d.maxSpeed * 1.25) D += (V - d.maxSpeed * 1.25) * d.overspeedDrag;
      const a = this._acc.set(0, -G, 0);
      a.addScaledVector(fwd, T);
      a.addScaledVector(lift, aL);
      if (V > 1e-3) a.addScaledVector(v, -D / V);
      // 協調旋回のヨー（下の rT）: 横の力を入れる前の加速度で経路の回る速さ（横の力を入れると横滑りの減衰を打ち消してしまう）
      let rc = 0;
      if (V > 20) { const ix = v.y * a.z - v.z * a.y, iy = v.z * a.x - v.x * a.z, iz = v.x * a.y - v.y * a.x; rc = -(ix * up.x + iy * up.y + iz * up.z) / (V * V); }
      const side = Math.min(4, V * d.sideForce);
      a.addScaledVector(left, -vl * side);
      (this._aNet || (this._aNet = new THREE.Vector3())).copy(a); // 見た方へ飛ぶ操縦の減衰（経路の曲がり）に使う
      // G（荷重倍数: 揚力の向き（速度に垂直）の加速度、重力を除く。迎え角が小さいうちは機体の上向きとほぼ同じ）
      const gl = ll > 1e-6 ? (a.dot(lift) + G * lift.y) / G : (a.dot(up) + G * up.y) / G;
      this.gload += (gl - this.gload) * Math.min(1, h * 10);
      if (this.gload > this.stats.maxG) this.stats.maxG = this.gload;
      if (this.gload < this.stats.minG) this.stats.minG = this.gload;
      // 速度の向きが回る速さ（機体の縦の面）→ 機首は迎え角の目標を追う
      const wfp = V > 5 ? a.dot(lift) / V : 0;
      // 機首を上げる速さの上限: 大きな G の間は経路の回る速さ × pitchMargin まで（機首が経路についていく）
      const qMax = mb > 0 ? Math.max(d.maxPitchRate * D2R, Math.abs(want) / Math.max(V, 20) * d.maneuver.pitchMargin) : d.maxPitchRate * D2R;
      //  大きな G の間は迎え角の追従も速く（maneuver.trackBoost 倍。遅れると 450°/s の旋回で行き過ぎる）
      const tb = 1 + (d.maneuver.trackBoost - 1) * mb;
      const qT = clamp(d.pitchTrack * tb * (aT - alpha) + wfp, -qMax, qMax);
      this.rates.q += (qT - this.rates.q) * Math.min(1, h * 12 * tb);
      const eff = clamp(V / (vs + 20), 0.25, 1);
      const pT = cmd.p * eff;
      const pa = d.rollAccel * D2R * h * (this._rollScale || 1);
      this.rates.p += clamp(pT - this.rates.p, -pa, pa);
      // ヨー: 方向舵 + 横滑りを消す + 協調（経路の回る速さ Ω = v × a / V² の機体の上向きの成分ぶん機首も回す。無いと傾いた旋回で横滑りが残り、
      //  横の力が上下の力になる）
      const rT = (cmd.rud * d.yawRate * D2R) * eff + d.sideslipDamp * beta + rc;
      this.rates.r += (rT - this.rates.r) * Math.min(1, h * 8);
      // 積分。大きな G（速度に垂直な加速度が gLimit × integrateAbove を超える）の間は速度の向きを回す（オイラーだと半径 30 m の旋回で速さが増え続ける）
      const ap = V > 1e-3 ? a.dot(v) / V : 0;
      const prx = a.x - v.x / Math.max(V, 1e-3) * ap, pry = a.y - v.y / Math.max(V, 1e-3) * ap, prz = a.z - v.z / Math.max(V, 1e-3) * ap;
      const pm = Math.sqrt(prx * prx + pry * pry + prz * prz);
      if (mb > 0 && V > 20 && pm > d.gLimit * G * d.maneuver.integrateAbove) {
        const ix = v.y * prz - v.z * pry, iy = v.z * prx - v.x * prz, iz = v.x * pry - v.y * prx, il = Math.sqrt(ix * ix + iy * iy + iz * iz);
        if (il > 1e-9) v.applyAxisAngle(this._ax.set(ix / il, iy / il, iz / il), pm * h / V);
        v.multiplyScalar(Math.max(0, V + ap * h) / V);
      } else v.addScaledVector(a, h);
      this.p.addScaledVector(v, h);
      // ロールは速度の向きの周り（安定軸。FCS の協調旋回）: 機体の軸の周りに回すと迎え角が横滑りに変わり、横の力が旋回を打ち消す
      let wx = -this.rates.q, wy = -this.rates.r, wz = this.rates.p;
      if (V > 20) { const kp = this.rates.p / V; wx += kp * vl; wy += kp * vu; wz = kp * vf; }
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (wl > 1e-9) { this._dq.setFromAxisAngle(this._ax.set(wx / wl, wy / wl, wz / wl), wl * h); this.quat.multiply(this._dq).normalize(); }
      this._syncPos();
      this.speed = v.length();
    }

    // 地上の 1 歩（h 秒）: 前輪の向き・ブレーキ・機首上げ・離陸、カタパルト・着艦ワイヤー
    _groundStep(h, ctx) {
      const d = this.def, cmd = this.cmd;
      // カタパルト
      if (this.cat) { this._catStep(h, ctx); if (this.mode !== 'ground') return; }
      else if (this.arrest) this._arrestStep(h);
      else if (this._auto && this._auto.acc != null) {
        // 自動の地上滑走: _deckStep が決めた加速（m/s²）で速さを直接変える（前へだけ）
        this.u = Math.max(0, this.u + this._auto.acc * h);
        this._steerYaw(h, this.u);
      } else if (this._revAcc != null) {
        // 甲板で後ろへ（手・自動の下がる部分）: 決めた加速で（後ろへだけ。止まると 0）
        this.u = Math.min(0, this.u + this._revAcc * h);
        this._steerYaw(h, this.u);
      } else {
        let u = this.u;
        const T = this._thrust();
        const drag = this.cd0 * (1 + d.gearDrag) * u * u;
        let acc = T - drag * Math.sign(u);
        // 甲板の手動の地上滑走は deck.manualMax m/s まで（推力を切り、少しブレーキ。着艦の走り・ボルターは除く: _taxiing）
        if (this._taxiing && this.onDeck && !this.bolter && u > d.deck.manualMax) acc = Math.min(acc, -2);
        const fric = d.taxiFriction + (+cmd.brake || 0) * d.brake;
        if (Math.abs(u) > 1e-4 || Math.abs(acc) > fric) {
          if (Math.abs(u) < 1e-3) { const a2 = Math.abs(acc) > fric ? acc - Math.sign(acc) * fric : 0; u += a2 * h; }
          else { const nu = u + (acc - Math.sign(u) * fric) * h; u = (Math.sign(nu) !== Math.sign(u) && Math.abs(acc) <= fric) ? 0 : nu; }
        }
        if (u < -1.5) u = -1.5;
        this.u = u;
        this._steerYaw(h, u);
      }
      // 機首上げ（離陸）/ 下げ（着地の後）
      const u = this.u;
      if (!this.cat && !this.arrest) {
        const thT = cmd.pitchUp && u > d.rotateSpeed * 0.92 ? clamp(cmd.pitchTo == null ? d.rotateAoA * D2R : cmd.pitchTo, 0, d.rotateAoA * D2R) : 0;
        if (thT > this.theta) this.theta = Math.min(thT, this.theta + d.rotateRate * D2R * h);
        else this.theta = Math.max(thT, this.theta - (this.theta > 0.5 * D2R ? d.lowerRate : d.rotateRate) * D2R * h);
      }
      // 動く（カタパルトの中は _catStep が置く）
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      if (!this.cat) {
        // 甲板で手で走っている（操縦士がいる・着艦の走り / ボルターでない）: 主脚が甲板の外へ出る 1 歩は進まない（端で止まる。海へ落ちない）
        if (u !== 0 && this.driver && this.onDeck && this._taxiing && !this.bolter && !this.arrest && this.ops) {
          const S = this._support(ctx, this.pos.x + sy * u * h * 4, this.pos.z + cy * u * h * 4, this.pos.y);
          if (S.y === null || S.y < this.pos.y - d.deck.heightTol) { this.u = 0; if (!this.edgeStop) this.events.push({ t: 'deck_edge', back: u < 0 }); this.edgeStop = true; this.stopWhy = 'edge'; }
          else { this.pos.x += sy * u * h; this.pos.z += cy * u * h; }
        } else { this.pos.x += sy * u * h; this.pos.z += cy * u * h; }
      }
      // 支え（主脚の間）。無くなったら空中へ（甲板の端・屋上の端）。カタパルトの上は甲板の高さのまま（艦首の細い所も軌道は続く）
      if (this.cat && this.ops) { this.pos.y = this.ops.deckY; this.groundY = this.pos.y; this.agl = 0; this._syncFromGround(); this.vel.set(sy * u, 0, cy * u); return; }
      const S = this._support(ctx, this.pos.x, this.pos.z, this.pos.y);
      this.onWater = S.y === null && S.water !== null;
      if (S.y !== null && (S.y >= this.pos.y - 0.6 || (this.arrest && S.y >= this.pos.y - 2.6))) {
        this.pos.y += clamp(S.y - this.pos.y, -h * 8, h * 8);
        if (Math.abs(S.y - this.pos.y) < 0.02) this.pos.y = S.y;
        this.groundY = S.y;
      } else {
        // 落ちる: 空中の物理へ（揚力が足りなければ沈む）
        this._toAir(0);
        return;
      }
      this.agl = 0;
      // 揚力が重さを超えたら離陸
      const kq = this.kl * u * u * smooth(d.stallSpeedLanding - d.stallBand, d.stallSpeedLanding + 2, u) * (this.gearPos > 0.5 ? d.landingLift : 1);
      if (this.theta > d.liftoffPitch * D2R && kq * (this.theta / (d.stallAoA * D2R)) > G * d.liftoffLift) { this._toAir(1.0); return; }
      this._syncFromGround();
      this.vel.set(sy * u, 0, cy * u);
    }

    // 前輪の向き（遅いほど大きく、steerFadeSpeed で 0）+ 速いときは方向舵（rudderGround°/s）
    _steerYaw(h, u) {
      const d = this.def, cmd = this.cmd;
      const fade = clamp(1 - Math.abs(u) / d.steerFadeSpeed, 0, 1);
      const st = cmd.steer * d.noseSteer * D2R * fade;
      this.steer += (st - this.steer) * Math.min(1, h * 6);
      let yr = -(u / d.wheelbase) * Math.tan(this.steer);
      yr += -cmd.steer * d.rudderGround * D2R * clamp((Math.abs(u) - 8) / 20, 0, 1);
      this.yaw = wrap(this.yaw + yr * h);
      this.rates.r = -yr;
    }

    // 地上 → 空中（vy: 上向きの初速）。操縦士がいれば離陸の直後の上昇（_prot）を始める
    _toAir(vy) {
      this.mode = 'air'; this.grounded = false; this.airborne = true;
      this._syncFromGround();
      this.axes();
      this.vel.copy(this._fwd).multiplyScalar(this.u);
      this.vel.y += vy;
      this.rates.p = 0; this.rates.q = 0; this.rates.r = 0;
      if (this._aNet) this._aNet.set(0, 0, 0);
      this._turnSide = 0;
      this.arrest = null;
      this._auto = null; this.edgeStop = false; this._taxiing = false;
      this._prot = this.driver ? { t: 0, yaw: this.yaw } : null;
      this.events.push({ t: 'liftoff', speed: this.u, bolter: this.bolter });
      this.bolter = false;
    }

    // 空中: 脚（脚を上げていれば胴体）の下の面に触れたら着地か墜落
    _checkGround(ctx) {
      const d = this.def;
      const pts = this.gearPos > 0.5 ? this.contacts : null;
      const S0 = this._support(ctx, this.pos.x, this.pos.z, this.p.y);
      const gy0 = S0.y !== null ? S0.y : (S0.water !== null ? S0.water : 0);
      this.groundY = gy0;
      this.onWater = S0.y === null && S0.water !== null;
      this.agl = Math.max(0, this.pos.y - gy0);
      // 地面に近い（50 m 以内）ときだけ点ごとに見る
      let lowest = Infinity, touch = false, touchY = 0, water = false;
      const list = pts || BELLY_V;
      for (let i = 0; i < list.length; i++) {
        const w = this.toWorld(list[i], this._v2);
        if (w.y - gy0 > 60) continue;
        const S = this._support(ctx, w.x, w.z, w.y + 0.5);
        const gy = S.y !== null ? S.y : (S.water !== null ? S.water : -50);
        if (w.y - gy < lowest) lowest = w.y - gy;
        if (w.y <= gy + 0.02) { touch = true; touchY = Math.max(touchY, gy); if (S.y === null) water = true; }
      }
      // 胴体の一番下（脚を下ろしていても機首から突っ込んだとき）
      if (!touch && pts) {
        for (const b of BELLY_V) {
          const w = this.toWorld(b, this._v2);
          if (w.y - gy0 > 30) continue;
          const S = this._support(ctx, w.x, w.z, w.y + 0.5);
          const gy = S.y !== null ? S.y : (S.water !== null ? S.water : -50);
          if (w.y <= gy) { this._crash(S.y === null ? 'water' : 'ground', this.speed, ctx); return; }
        }
      }
      this.pullUp = this.vel.y < -8 && this.agl < -this.vel.y * 5 && !(this.gearPos > 0.9 && this.speed < d.touchdownSpeed + d.aim.landingMargin);
      if (!touch) return;
      // 上へ動いている（離陸した直後・跳ねた）: 地面の上に戻すだけ
      if (this.vel.y > -0.3 && pts && !water) {
        this.p.y += Math.max(0, -lowest) + 0.02;
        this._syncPos();
        return;
      }
      const sink = -this.vel.y, V = this.speed;
      const bank = Math.abs(this.bankDeg), pitch = this.pitchDeg;
      const rec = { t: +this.time.toFixed(2), sink: +sink.toFixed(2), speed: +V.toFixed(1), bank: +bank.toFixed(1), pitch: +pitch.toFixed(1), gear: this.gearPos > 0.9, water, hook: this.hookDown, ok: false };
      this.landings.push(rec);
      if (this.landings.length > 20) this.landings.shift();
      if (water || !pts || sink > d.touchdownSink || V > d.touchdownSpeed || bank > d.touchdownRoll || pitch < d.touchdownPitch) {
        this._crash(water ? 'water' : 'ground', Math.max(V, sink), ctx);
        return;
      }
      rec.ok = true;
      // 着地: 地上の物理へ（横の速さは捨てる）
      this.axes();
      const hdg = Math.atan2(this.vel.x, this.vel.z);
      const fwdH = Math.atan2(this._fwd.x, this._fwd.z);
      this.yaw = Math.abs(wrap(hdg - fwdH)) < 0.5 ? fwdH : hdg;
      this.u = Math.hypot(this.vel.x, this.vel.z);
      this.theta = clamp(pitch * D2R, 0, d.rotateAoA * D2R);
      this.pos.y = touchY;
      this.mode = 'ground'; this.grounded = true; this.airborne = false;
      this.rates.p = 0; this.rates.q = 0; this.rates.r = 0;
      this._syncFromGround();
      this.events.push({ t: 'touchdown', sink, speed: V });
      this._sound('vehicle_impact', clamp(sink / 6, 0.3, 0.9), this.center(this._v1), { refDistance: 12, maxDistance: 300, rate: 0.7 });
      if (this.fx && typeof this.fx.smoke === 'function') { for (const c of this.contacts.slice(1)) this.fx.smoke(this.toWorld(c, this._v1), 0.9); }
    }

    // 支える面: nav（読み込み済みのチャンク）か HeliCollider（いつでも）。{ y（無ければ null = 水）, water }
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

    // 機体の球の世界の中心
    _hullWorld(out) {
      for (let i = 0; i < HULL.length; i++) { const h = HULL[i]; out[i].set(h.x, h.y, h.z).applyQuaternion(this.quat).add(this.pos); }
    }

    // 掃引: 前の位置 _s0 → 今の位置 _s1。一番早く当たった { t, i, box, nx, ny, nz } か null
    _sweep(ctx) {
      const s0 = this._s0, s1 = this._s1;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
      for (let i = 0; i < s0.length; i++) {
        const a = s0[i], b = s1[i];
        x0 = Math.min(x0, a.x, b.x); x1 = Math.max(x1, a.x, b.x); z0 = Math.min(z0, a.z, b.z); z1 = Math.max(z1, a.z, b.z); y0 = Math.min(y0, a.y, b.y);
      }
      const R = 1.4;
      x0 -= R; x1 += R; z0 -= R; z1 += R;
      const cands = this._cands;
      cands.length = 0;
      const nav = ctx && ctx.nav;
      if (nav && typeof nav.itemsIn === 'function' && y0 < 120) nav.itemsIn(x0, z0, x1, z1, cands);
      if (this.collider) this.collider.query(x0, z0, x1, z1, cands);
      this.stats.sweeps++;
      this.stats.boxes += cands.length;
      const jbd = this.ops && this.ops.jbd;
      let best = null;
      for (let n = 0; n < cands.length; n++) {
        const b = cands[n];
        if (b.f & 1) continue;
        let top = b.y1;
        if (b.k === 1) top = Math.max(MR.Nav3D.itemTop(b, b.x0, b.z0), MR.Nav3D.itemTop(b, b.x1, b.z1));
        if (top <= y0 - 1.4) continue;
        if (jbd && this.mode === 'ground' && this._isJbd(b, jbd)) continue;
        for (let i = 0; i < s0.length; i++) {
          const r = HULL[i].r, a = s0[i], c = s1[i];
          let t = MR.Nav3D.rayBox(a.x, a.y, a.z, c.x - a.x, c.y - a.y, c.z - a.z, b.x0 - r, b.y0 - r, b.z0 - r, b.x1 + r, top + r, b.z1 + r);
          if (t === null || t > 1) continue;
          // 箱の上面に乗っている（地上で甲板・道路の上）は当たりにしない: 上面より上から来て上面の近くなら床
          if (this.mode === 'ground' && a.y - r >= top - 0.35) continue;
          // 箱を半径ぶん広げた箱で見ているので、角の近くでは球が箱に触れていなくても当たる: 球と箱の本当の距離で確かめ、触れていなければ
          //  その先（1 歩の残り）を 8 つに分けて最初に触れる所（無ければ当たらない）。甲板で艦橋の角の横をすり抜けられる（経路の判定と同じ）
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
      // 他の乗り物（地上の車・ヘリ・戦闘機）: 機体の球と相手の円
      const others = (ctx && ctx.vehicles) || [];
      for (let k = 0; k < others.length && !best; k++) {
        const o = others[k];
        if (o === this || o.disposed || o.sunk || (o.wrecked && o.wreckFall)) continue;
        if (Math.abs(o.pos.x - this.pos.x) > 40 || Math.abs(o.pos.z - this.pos.z) > 40) continue;
        const oh = (o.def && o.def.height) || 2;
        if (y0 > o.pos.y + oh + 2) continue;
        for (let i = 0; i < s1.length; i++) {
          const c = s1[i], r = HULL[i].r;
          if (c.y - r > o.pos.y + oh || c.y + r < o.pos.y) continue;
          const q = o._pushCircle(c.x, c.z, r);
          if (Math.hypot(q.x - c.x, q.z - c.z) > 0.02) { best = { t: 1, i, vehicle: o }; break; }
        }
      }
      if (best && !best.vehicle) {
        // 当たった面の法線
        const i = best.i, r = HULL[i].r, a = s0[i], c = s1[i], b = best.box, t = best.t;
        const hx = a.x + (c.x - a.x) * t, hy = a.y + (c.y - a.y) * t, hz = a.z + (c.z - a.z) * t;
        const faces = [[Math.abs(hx - (b.x0 - r)), -1, 0, 0], [Math.abs(hx - (b.x1 + r)), 1, 0, 0], [Math.abs(hy - (b.y0 - r)), 0, -1, 0], [Math.abs(hy - (best.top + r)), 0, 1, 0], [Math.abs(hz - (b.z0 - r)), 0, 0, -1], [Math.abs(hz - (b.z1 + r)), 0, 0, 1]];
        let f = faces[0];
        for (const gg of faces) if (gg[0] < f[0]) f = gg;
        best.nx = f[1]; best.ny = f[2]; best.nz = f[3];
        best.point = new THREE.Vector3(hx - f[1] * r, hy - f[2] * r, hz - f[3] * r);
      }
      return best;
    }
    _isJbd(b, jbd) {
      for (const j of jbd) if (b.x0 >= j[0] - 0.3 && b.x1 <= j[2] + 0.3 && b.z0 >= j[1] - 0.3 && b.z1 <= j[3] + 0.3 && b.y1 <= j[4] + 0.3) return true;
      return false;
    }

    // ぶつかった: 速ければ墜落、遅ければ止まる（地上の移動）
    _onHit(hit, ctx) {
      const d = this.def;
      let speed;
      if (hit.vehicle) speed = this.speed;
      else speed = Math.max(0, -(this.vel.x * hit.nx + this.vel.y * hit.ny + this.vel.z * hit.nz));
      if (this.mode === 'ground') speed = Math.max(speed, Math.abs(this.u) * (hit.vehicle ? 1 : Math.max(0.3, Math.abs(Math.sin(this.yaw) * (hit.nx || 0) + Math.cos(this.yaw) * (hit.nz || 0)))));
      this.lastImpactSpeed = speed;
      this.stats.collisions++;
      this.impacts++;
      const total = this.speed;
      if (total > d.crashSpeed && speed > d.crashSpeed * 0.5) {
        this._crash(hit.vehicle ? 'vehicle' : (hit.box && hit.box.y1 > 30 ? 'building' : 'ground'), total, ctx, hit.box);
        if (hit.vehicle && hit.vehicle.damage) hit.vehicle.damage(9999, ctx);
        return;
      }
      // 遅い: 止める（地上）/ 跳ね返す（空中）、少しのダメージ
      if (this.mode === 'ground') {
        this.u = -this.u * d.bounce;
        if (this.cat) { this.cat = null; this.launchBar = 0; this.events.push({ t: 'cat_unhook', why: 'bump' }); }
        if (this._auto) this._auto.stuck = Math.max(this._auto.stuck || 0, 0.5); // 自動の地上滑走: すぐに経路を作り直す
      }
      else if (hit.nx !== undefined) {
        const vn = this.vel.x * hit.nx + this.vel.y * hit.ny + this.vel.z * hit.nz;
        if (vn < 0) { this.vel.x -= hit.nx * vn * (1 + d.bounce); this.vel.y -= hit.ny * vn * (1 + d.bounce); this.vel.z -= hit.nz * vn * (1 + d.bounce); }
      }
      if (this.time - this.lastImpact > 0.3) {
        this.lastImpact = this.time;
        const pt = hit.point || this.center(this._v1);
        this._sound('vehicle_impact', clamp(speed / 12, 0.3, 1), pt, { refDistance: 8, maxDistance: 200 });
        if (this.fx) this.fx.impact(pt, this._v2.set(hit.nx || 0, 0.3, hit.nz || 0).normalize());
        if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, speed);
        if (speed > 1.5) this.damage(speed * d.impactDamage, ctx);
      }
    }

    // ---------- 甲板の地上滑走（発艦ボタン・スティック上の自動。手で走るときは止まる・後退）----------

    // 毎フレーム（操縦士がいるとき _fcs から。up = スティックの縦）。自動で走っていれば true（前輪 _autoSteer・加速を決めた）。
    //   始める: 甲板の上（地上・脚が下りている・着艦の走り / ボルターでない・カタパルトにつながっていない）で
    //     ・発艦ボタン（押したことを覚えておき、走っていれば止まってから）
    //     ・スティックを上へ deck.assistStick 以上（縦から aim.groundAngle の割合までの傾き = 45°。親指のずれでは手の操縦にならない）
    //     ・手で走っていて、空いたカタパルトの始点の手前 deck.captureDist m 以内に向きをそろえて来た（_captureCheck: 甲板員が誘導して止める。
    //       12 m/s で始点を通り過ぎて艦首まで行ってしまわない）
    //   目的: 空いたカタパルトのいちばん近いもの（_planRoute: 誘導路 carrierOps.lanes。艦橋・ヘリ・他の機体（翼も）に当たらない経路だけ）。
    //     前へ行けない（艦首・甲板の端・逆向き・隣の機体）ときは、止まってから、まっすぐか曲がりながら後ろへ下がって（_planRecovery）。
    //     それも無ければ発艦ボタン・スティックを上へ deck.towHold 秒で牽引（_tow: 空いたカタパルトの後ろへ移す）。
    //     カタパルトが全部ほかの機体でふさがっていれば deck_busy（乗り捨てた機体は deck.clearTime 秒で元の場所へ戻る: _clearCat）
    //   やめる: スティックを下（deck.cancelStick より下）・横へはっきり倒す → 経路に沿ったまま止まり、止まってから手で走る
    //     （止まる途中で前輪がカメラの向きへ戻り、隣の機体へ翼を入れない）。スティックを離すまで上へ倒してもまた始めない
    _deckStep(dt, ctx, up) {
      const d = this.def, D = d.deck, c = this.ctl, A0 = d.aim;
      if (c.launch && !this.cat) { c.launch = false; this._pendingLaunch = true; this._retryAt = 0; this._waitBusy = -1; }
      const deck = this.mode === 'ground' && this.onDeck && !this.arrest && !this.bolter && this.gearPos > 0.95 && !this.cat;
      this._revAcc = null; this._holdBrake = false;
      if (!deck) {
        if (this._auto) this._auto = null;
        this._held = null;
        if (!this.cat) this.deckRoute = null;
        this.deckBusy = false; this.deckWait = false;
        // 空母の甲板の上で今は使えない（着艦のワイヤー・脚の途中）なら押したことを覚えておく。甲板の外なら「甲板で使えます」
        if (this._pendingLaunch && !(this.mode === 'ground' && this.onDeck && !this.cat)) {
          if (this.mode === 'ground' && !this.cat) this.events.push({ t: 'deck_none' });
          this._pendingLaunch = false;
        }
        return false;
      }
      const sx = c.manual ? 0 : c.stickX;
      const mag = Math.hypot(sx, up);
      const side = Math.abs(sx) > A0.groundStick && Math.abs(sx) > A0.groundAngle * Math.abs(up);
      if (mag < D.releaseMag) this._assistBlock = false;
      if (up < D.cancelStick && !this._auto) this._pendingLaunch = false; // 下へ倒した: 押した発艦ボタンは取り消す
      const launch = this._pendingLaunch;
      const want = launch || (!this._assistBlock && up > D.assistStick && !side);
      // 案内の経路（前へ。deck.routeEvery 秒ごと。止まっている間は deck.routeRefresh 秒ごと: 1 回 10 ms 前後かかる）
      this._routeT -= dt;
      if (this._routeT <= 0 && !this._auto) {
        this._routeT = D.routeEvery;
        const rp = this._routePose, moved = !rp || Math.hypot(this.pos.x - rp.x, this.pos.z - rp.z) > D.routeMove || Math.abs(wrap(this.yaw - rp.yaw)) > D.routeTurn * D2R;
        if (moved || this.time - rp.t > D.routeRefresh) { this.deckRoute = this._markRoute(ctx); this._routePose = { x: this.pos.x, z: this.pos.z, yaw: this.yaw, t: this.time }; }
      }
      let A = this._auto;
      if (A && !A.stopping && (up < D.cancelStick || side)) {
        A.stopping = true; this._assistBlock = true; this._pendingLaunch = false;
        this.events.push({ t: 'auto_cancel' });
      } else if (A && A.stopping && want) {
        A.stopping = false; this._pendingLaunch = false;
        this.events.push({ t: 'auto_start', cat: A.route.cat.id, src: launch ? 'button' : 'stick', resume: true });
      }
      if (!A) {
        this._wantT = want ? (this._wantT || 0) + dt : 0;
        if (!want) this.deckWait = false;
        let r = null, src = launch ? 'button' : 'stick';
        const still = Math.abs(this.u) < D.stillSpeed;
        if (want && this.time >= (this._retryAt || 0)) {
          this._retryAt = this.time + D.retryEvery;
          r = this._resumeHeld(ctx) || this._planRoute(ctx);
          this.deckRoute = r;
          let wait = false;
          const nb = (this._busyOcc || []).length;
          // 前へ行けない: 止まってから後ろへ下がる経路。それも無いとき、ふさいでいるのがカタパルトの上の機体（乗り捨てた機体は甲板員が片付ける:
          //  _clearCat・人が乗っている機体は発艦する）なら空くのを待つ（deckWait。牽引しない）。待てない（誘導路にヘリが止めてあるだけ等）ときだけ
          //  牽引（最後の手段）。走っている間は止まるのを待つ。待っている間は下がる経路を探し直さない（10〜50 ms かかる）: 空いたカタパルトが増えたときだけ
          if (!r && !this.deckBusy) {
            if (!still) { this._holdBrake = true; this._retryAt = 0; }
            else {
              //  誘導路・着艦の場所に甲板員が片付ける機体がある: 下がる経路を探さずに待つ（片付けば経路がある）
              const wk = this._waitable(ctx);
              if (wk === 'deck') wait = wk;
              else {
                if (!(this.deckWait && nb >= this._waitBusy)) r = this._planRecovery(ctx);
                if (!r && wk) wait = wk;
                else if (!r && (launch || this._wantT >= D.towHold)) { r = this._tow(ctx); if (r) src = 'tow'; }
              }
            }
          } else if (!r && this.deckBusy) wait = this._waitable(ctx);
          if (wait) {
            if (!this.deckWait || this.deckWaitWhy !== wait) { this.events.push({ t: 'deck_busy', wait: true, why: wait }); this._blockedMsgT = this.time; }
            this.deckWait = true; this.deckWaitWhy = wait; this._waitBusy = nb;
          } else {
            this.deckWait = false;
            if (!r && (still || this.deckBusy)) {
              if (launch || !this._blockedMsgT || this.time - this._blockedMsgT > D.msgEvery) {
                this._blockedMsgT = this.time;
                this.events.push({ t: this.deckBusy ? 'deck_busy' : 'deck_blocked' });
              }
              this._pendingLaunch = false;
            }
          }
        } else if (!want) {
          r = this._captureCheck(ctx, up, side);
          if (r) src = 'capture';
        }
        if (r) {
          const s0 = r.s0 || 0;
          this._auto = A = { route: r, pre: r.pre || null, fwd: r.fwd || null, src, s: s0, rem: r.len - s0, acc: 0, stuck: 0, stopping: false, seen: this._seenNow(ctx), wait: 0, liveT: 0 };
          this.deckRoute = r; this._pendingLaunch = false; this._wantT = 0; this._held = null; this.deckWait = false;
          this.events.push(s0 > 0 ? { t: 'auto_start', cat: r.cat.id, src, resume: true } : { t: 'auto_start', cat: r.cat.id, src, back: !!r.pre, fwd: !!r.fwd });
        }
      }
      if (this.deckWait) {
        // 待っている: 止まったまま（スティックを上へ押していても這い出さない）。甲板員に知らせる（_clearCat）
        this._holdBrake = true;
        if (ctx && ctx.time != null) DECKWAIT.set(this.ops, ctx.time);
      }
      if (!A) return false;
      const go = this.spin >= D.startSpin;
      this.abOn = false; this.cmd.brake = 0; this.cmd.airbrake = false;
      // --- 先に少し前へ（_planRecovery の 2 段の 1 段目。決めた前輪の向きのまま決めた長さだけ）→ 下がる段（pre）か、無ければ経路を作り直す ---
      const F = A.fwd;
      if (F && !F.done) {
        F.s += Math.abs(this.u) * dt;
        const rem = F.len - F.s;
        const vt = A.stopping || rem <= D.backTol || !go ? 0 : Math.min(D.reverseMax, Math.sqrt(2 * D.reverseAccel * D.routeDecel * Math.max(0, rem)) + D.backEndSpeed);
        this._revAcc = null;
        A.acc = clamp((vt - this.u) * D.speedGain, -D.reverseAccel, D.reverseAccel);
        this._autoSteer = F.steer; this.throttle = A.stopping ? 0 : D.autoThrottle[0];
        A.rem = Math.max(0, rem) + (A.pre ? A.pre.len : 0) + A.route.len;
        this.deckRoute = A.route;
        if (Math.abs(this.u) < D.backStopSpeed && (A.stopping || rem <= D.backTol)) {
          this.u = 0;
          if (A.stopping) { this._auto = null; this.deckRoute = null; this._held = null; return false; }
          F.done = true;
          if (!A.pre) {
            const r = this._planRoute(ctx);
            if (r) { A.route = r; A.s = 0; A.rem = r.len; A.stuck = 0; A.seen = this._seenNow(ctx); this.deckRoute = r; }
            else A.stuck = D.stuckTime + 1;
          }
        }
        if (!(A.stuck > D.stuckTime)) return true;
      }
      // --- 後ろへ下がる（経路の前の部分。決めた前輪の向きのまま決めた長さだけ）---
      const P = A.pre;
      if (P && !P.done && !(F && !F.done)) {
        P.s += Math.abs(this.u) * dt;
        const rem = P.len - P.s;
        const vt = A.stopping || rem <= D.backTol || !go ? 0 : -Math.min(D.reverseMax, Math.sqrt(2 * D.reverseAccel * D.routeDecel * Math.max(0, rem)) + D.backEndSpeed);
        this._revAcc = clamp((vt - this.u) * D.speedGain, -D.reverseAccel, D.reverseAccel);
        A.acc = null; this._autoSteer = P.arc != null && P.s >= P.arc ? 0 : P.steer; this.throttle = A.stopping ? 0 : D.autoThrottle[0];
        A.rem = Math.max(0, rem) + A.route.len;
        this.deckRoute = A.route;
        if (Math.abs(this.u) < D.backStopSpeed && (A.stopping || rem <= D.backTol)) {
          this.u = 0;
          if (A.stopping) { this._auto = null; this.deckRoute = null; this._held = null; return false; }
          // 下がり終わった: 今の位置から前への経路を作り直す（少しずれていても）
          P.done = true;
          const r = this._planRoute(ctx);
          if (r) { A.route = r; A.s = 0; A.rem = r.len; A.stuck = 0; A.seen = this._seenNow(ctx); this.deckRoute = r; }
          else A.stuck = D.stuckTime + 1;
        }
        if (!(A.stuck > D.stuckTime)) return true;
      } else {
        // --- 経路を追う（_autoControl。経路を選ぶときの _simRoute と同じ法則）---
        const st = this._autoSt || (this._autoSt = { x: 0, z: 0, yaw: 0, u: 0, s: 0, rem: 0, steer: 0, acc: 0, err: 0 });
        st.x = this.pos.x; st.z = this.pos.z; st.yaw = this.yaw; st.u = this.u; st.s = A.s;
        this._autoControl(A.route, st, go && !A.stopping);
        A.s = st.s; A.rem = st.rem; A.acc = st.acc;
        this._autoSteer = st.steer;
        const T = D.autoThrottle;
        // やめて止まる間はアイドル（スロットルを残すと、止まった後に回転が残ってまた走り出す）
        this.throttle = A.stopping ? 0 : go ? clamp(T[0] + (T[1] - T[0]) * Math.max(0, A.acc) / D.taxiAccel, T[0], T[1]) : T[0];
        if (A.rem < D.spoolDist && !A.stopping) this.throttle = T[2]; // カタパルトの手前でエンジンを回しておく（つながったらすぐ全開になる）
        if (A.stopping) {
          // やめた: 経路に沿ったまま止まる。止まったら手で走る（スティックを離している間はブレーキを掛けたまま: _fcs の deck.holdSpeed）。
          //  止まった所と経路を覚えておき、発艦ボタン・スティック上でその経路の続きから走る（_resumeHeld。前の経路は検証済み。
          //  止まった所から作り直すと、止まっている隣の機体の尾翼の数 cm 手前を通る別の線になって通れないことがある）
          if (this.u < D.stopSpeed) {
            this.u = 0; this._auto = null; this.deckRoute = null;
            this._held = { route: A.route, s: A.s, x: this.pos.x, z: this.pos.z, yaw: this.yaw };
            return false;
          }
          this.deckRoute = A.route;
          return true;
        }
        // 走り始めてから動いた・来た乗り物が前の経路に入った（_aheadBlocked。deck.liveEvery 秒ごと）: 止まる（「ぶつかるので止まります」）。
        //  止まって deck.stuckTime 秒たってもまだなら経路を作り直す（下の作り直し: 避ける経路・下がる経路・牽引・「通路がふさがっています」）
        A.liveT -= dt;
        if (A.liveT <= 0 || A.wait > 0) { A.liveT = D.liveEvery; A.block = go && this._aheadBlocked(A, ctx); }
        if (A.block) {
          if (!A.wait) this.events.push({ t: 'deck_obstacle', auto: true });
          A.wait += dt; A.acc = -D.taxiDecel; this.throttle = 0;
          if (A.wait > D.stuckTime && this.u < D.stuckSpeed) A.stuck = D.stuckTime + 1;
        } else A.wait = 0;
        // 止まってしまった（何かに当たった）を数える
        if (go && A.acc > D.stuckAcc && this.u < D.stuckSpeed) A.stuck += dt; else if (!A.block) A.stuck = Math.max(0, A.stuck - dt);
      }
      // 止まってしまった・下がった後に前の経路が無い: 作り直す（下がる経路も）。前の作り直しから進んでいない（同じ経路で当たり続ける）なら
      //  下がる経路、それも無ければ牽引。無ければやめる
      if (A.stuck > D.stuckTime) {
        const still = Math.abs(this.u) < D.stillSpeed;
        const noProg = A.stuckAt && Math.hypot(this.pos.x - A.stuckAt.x, this.pos.z - A.stuckAt.z) < D.progressDist;
        A.stuckAt = { x: this.pos.x, z: this.pos.z };
        let r = noProg ? null : this._planRoute(ctx);
        if (noProg) this._busyOcc = this._occupants(ctx);
        const waitable = this._waitable(ctx);
        if (!r && still && !this.deckBusy && waitable !== 'deck') r = this._planRecovery(ctx) || (noProg && !waitable ? this._tow(ctx) : null);
        if (r) { A.route = r; A.pre = r.pre || null; A.fwd = r.fwd || null; A.s = 0; A.rem = r.len; A.stuck = 0; A.wait = 0; A.block = false; A.seen = this._seenNow(ctx); this.deckRoute = r; }
        else {
          this._auto = null; this.deckRoute = null; this.u = Math.max(0, this.u);
          // カタパルトの上の機体が空くのを待てる: 次のフレームから待つ（発艦ボタンで始めたならボタンを押したままの扱い）
          if (waitable) { if (A.src === 'button' || A.src === 'tow') this._pendingLaunch = true; this._retryAt = 0; this._waitBusy = -1; return false; }
          this._assistBlock = true;
          this.events.push({ t: this.deckBusy ? 'deck_busy' : 'deck_blocked' });
          return false;
        }
      }
      this.deckRoute = A.route;
      return true;
    }

    // やめて止まった経路の続き（_held。_deckStep の止まる所で覚える）: 止まった所から deck.resumeDist m・resumeAngle° 以上動いていない、
    //   カタパルトが空いている、今の位置から経路の続き（止まった s から）を _autoControl で走っても当たらない（_simRoute）→ その経路
    //   （r.s0 = 続きの始まり）か null。一度見たら忘れる（だめなら _planRoute で作り直す）
    _resumeHeld(ctx) {
      const Hd = this._held, D = this.def.deck;
      if (!Hd) return null;
      this._held = null;
      if (Math.hypot(this.pos.x - Hd.x, this.pos.z - Hd.z) > D.resumeDist || Math.abs(wrap(this.yaw - Hd.yaw)) > D.resumeAngle * D2R) return null;
      const R = Hd.route, snap = this._obsSnap(ctx);
      if (this._catBusy(R.cat, ctx, snap)) return null;
      const pose = this._poseNow();
      pose.s = Hd.s;
      const ok = this._simRoute(R, ctx, pose, snap);
      pose.s = 0;
      if (!ok) return null;
      R.s0 = Hd.s;
      if (R.pre) R.pre.done = true;
      if (R.fwd) R.fwd.done = true;
      return R;
    }

    // 手で走っていてカタパルトの始点へ向きをそろえて来た（前へ走っている・ブレーキでない・横へ倒していない・始点が前 deck.captureDist m
    //   以内・横に deck.captureLat m 以内・向きが deck.captureAngle° 以内）→ そのカタパルトへの経路（自動で止めてつなぐ）か null
    _captureCheck(ctx, up, side) {
      const d = this.def, D = d.deck, ops = this.ops;
      // やめた後（_assistBlock: スティックを離すまで）は誘導しない
      if (!ops || this.u < D.captureSpeed || up < D.cancelStick || side || this._assistBlock || this.time < (this._capAt || 0)) return null;
      this._capAt = this.time + D.captureEvery;
      // どのカタパルトへ向かっているか: 機首の向きの線がカタパルトの始点の横 何 m を通るか（始点が機首の前に無ければカタパルトの線からの横のずれ）。
      //  許す幅は captureLat m（captureDist m 先では captureFar の割合だけ狭く）。両方に入れば甲板の目印（deckRoute）のカタパルト、
      //  それも同じなら幅に対してずれの小さい方。そのカタパルトへの経路だけを探す（以前は最初に条件に入ったカタパルトで、カタパルト 1 へ斜めに
      //  向かう機体が x 1〜2 m（カタパルト 2 の線から 5〜6 m）を通ると、40 m 手前でカタパルト 2 へ誘導されていた）
      let hit = null, hs = Infinity;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), mk = this.deckRoute ? this.deckRoute.cat : null;
      for (const cat of ops.cats) {
        const dx = cat.x - this.pos.x, dz = cat.z - this.pos.z;
        const al = dx * cat.fx + dz * cat.fz;
        if (!(al > -D.snapBehind && al < D.captureDist) || Math.abs(wrap(this.yaw - cat.yaw * D2R)) >= D.captureAngle * D2R) continue;
        const ahead = dx * fx + dz * fz;
        const miss = ahead > D.captureLat ? Math.abs(dx * fz - dz * fx) : Math.abs(dx * cat.fz - dz * cat.fx);
        const allow = D.captureLat * (1 - num(D.captureFar, 0) * clamp(al / D.captureDist, 0, 1));
        if (miss >= allow) continue;
        const sc = miss / allow - (cat === mk ? 10 : 0);
        if (sc < hs) { hs = sc; hit = cat; }
      }
      this._capWant = hit ? hit.id : 0;
      if (!hit) return null;
      const r = this._planRoute(ctx, null, hit);
      return r && r.cat === hit ? r : null;
    }

    // 自動の地上滑走の法則（st = { x, z, yaw, u, s（経路の上の進み）} → s・rem（残り）・steer（前輪の指令 -1..1）・acc（m/s²））:
    //   経路の上の今の位置（前の s から先）→ 前を見る点（lookahead + lookaheadSpeed × 速さ。終わりの先はカタパルトの向きへ延ばす）へ
    //   追いかけ（pure pursuit）。速さの目標: 直線 taxiMax、角の手前は角の速さ、終わりの手前で止まれる速さ（taxiDecel × routeDecel で減速。
    //   + endSpeed）、向きが offRouteAngle° より大きくずれていれば offRouteSpeed
    _autoControl(R, st, go) {
      const d = this.def, D = d.deck, pts = R.pts, cum = R.cum;
      let bestS = st.s, bestD = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (cum[i + 1] < st.s - 2) continue;
        const a = pts[i], b = pts[i + 1], L = cum[i + 1] - cum[i];
        if (L < 1e-6) continue;
        const t = clamp(((st.x - a.x) * (b.x - a.x) + (st.z - a.z) * (b.z - a.z)) / (L * L), 0, 1);
        const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t, dd = Math.hypot(st.x - px, st.z - pz);
        if (dd < bestD - 1e-6) { bestD = dd; bestS = cum[i] + L * t; }
      }
      st.s = Math.max(st.s, bestS);
      st.rem = Math.max(0, R.len - st.s);
      const Ld = D.lookahead + D.lookaheadSpeed * st.u;
      const cp = this._routeAt(R, Math.min(R.len, st.s + Ld), this._v4);
      if (st.s + Ld > R.len) { const over = st.s + Ld - R.len; cp.x += R.cat.fx * over; cp.z += R.cat.fz * over; }
      const err = wrap(Math.atan2(cp.x - st.x, cp.z - st.z) - st.yaw);
      const dist = Math.max(1, Math.hypot(cp.x - st.x, cp.z - st.z));
      const k = 2 * Math.sin(err) / dist;
      const fade = clamp(1 - Math.abs(st.u) / d.steerFadeSpeed, 0.05, 1);
      st.steer = clamp(-Math.atan(k * d.wheelbase) / (d.noseSteer * D2R * fade), -1, 1);
      st.err = err;
      const dec = D.taxiDecel * D.routeDecel;
      let vt = D.taxiMax;
      vt = Math.min(vt, Math.sqrt(2 * dec * Math.max(0, st.rem - 0.5)) + D.endSpeed);
      for (let i = 1; i + 1 < pts.length; i++) {
        const dv = cum[i] - st.s;
        if (dv < -2 || dv > D.cornerLook) continue;
        const vc = R.corner[i];
        vt = Math.min(vt, Math.sqrt(vc * vc + 2 * dec * Math.max(0, dv)));
      }
      if (Math.abs(err) > D.offRouteAngle * D2R) vt = Math.min(vt, D.offRouteSpeed);
      st.acc = go ? clamp((vt - st.u) * D.speedGain, -D.taxiDecel, D.taxiAccel) : -D.taxiDecel;
      return st;
    }
    // 経路を _autoControl で走ったときの機体の位置（0.05 s 刻み、deck.checkStep m ごと）を機体の球で確かめる（角を内側へ切っても
    //   当たらないか・甲板から出ないか）。pose = 始まりの { x, z, yaw, u, steer }
    _simRoute(R, ctx, pose, snap, dbg) {
      const d = this.def, D = d.deck, h = D.simStep;
      const s0 = pose.s || 0; // 経路の途中から（_resumeHeld）
      const st = { x: pose.x, z: pose.z, yaw: pose.yaw, u: Math.max(0, pose.u), s: s0, rem: R.len - s0, steer: 0, acc: 0, err: 0, ang: pose.steer };
      let lastX = st.x, lastZ = st.z, trav = 0;
      const ov = this._overlapStart(st.x, st.z, st.yaw, ctx, { snap }); // 今の場所が触れている（隣の機体の翼の近くなど）: 離れていく向きだけ（_blockedFrom）
      for (let n = 0, nMax = D.simTime / h; n < nMax; n++) {
        this._autoControl(R, st, true);
        if (st.rem < D.hookDist) return true;
        this._simAdvance(st, h);
        const moved = Math.hypot(st.x - lastX, st.z - lastZ);
        // 動き始め（checkNear m まで: 前輪で回り始めると翼の先が大きく振れる。すぐ横の艦橋・機体）は checkStep × 0.25 ごと
        if (moved >= (trav < D.checkNear ? D.checkStep * 0.25 : D.checkStep)) {
          trav += moved; lastX = st.x; lastZ = st.z;
          if (!this._poseOnDeck(st.x, st.z, st.yaw, ctx) || this._blockedFrom(ov, st.x, st.z, st.yaw, trav, ctx, { snap })) {
            if (dbg) Object.assign(dbg, { x: st.x, z: st.z, yaw: st.yaw / D2R, s: st.s, hit: this._lastBlock });
            return false;
          }
        }
        if (n * h > D.stuckTime && st.u < D.simStopSpeed && st.acc <= 0) return false; // 止まってしまう
      }
      return false;
    }

    // _simRoute・_aheadBlocked の 1 歩（st.acc で速さ、st.steer の指令へ前輪の角度 st.ang を _steerYaw と同じ速さで寄せて向き・位置を進める）
    _simAdvance(st, h) {
      const d = this.def;
      st.u = Math.max(0, st.u + st.acc * h);
      const fade = clamp(1 - st.u / d.steerFadeSpeed, 0, 1);
      st.ang += (st.steer * d.noseSteer * D2R * fade - st.ang) * Math.min(1, h * 6);
      let yr = -(st.u / d.wheelbase) * Math.tan(st.ang);
      yr += -st.steer * d.rudderGround * D2R * clamp((st.u - 8) / 20, 0, 1);
      st.yaw = wrap(st.yaw + yr * h);
      st.x += Math.sin(st.yaw) * st.u * h; st.z += Math.cos(st.yaw) * st.u * h;
    }

    // 自動で走っている間: 走り始めてから動いた・来た乗り物（ヘリが降りてきた・ほかの人の機体が入ってきた。止まっていた物は経路を選ぶときに
    //   確かめてある）が、今の経路を今の速さから止まるまで（taxiDecel）+ deck.guardMargin m の間に当たる（隙間 guardGap）か。
    //   動いたかは A.seen（走り始めの位置。上下も: 降りてくるヘリ）と deck.liveMove m・liveTurn° で比べる
    _aheadBlocked(A, ctx) {
      const d = this.def, D = d.deck, h = D.simStep;
      const seen = A.seen;
      const snap = this._obsSnap(ctx, (o) => {
        const q = seen && seen.get(o);
        return !q || Math.hypot(o.pos.x - q.x, o.pos.y - q.y, o.pos.z - q.z) > D.liveMove || Math.abs(wrap(o.yaw - q.yaw)) > D.liveTurn * D2R || (o.mode !== q.mode);
      });
      if (!snap.n && !snap.others.length) return false;
      const st = this._aSt || (this._aSt = { x: 0, z: 0, yaw: 0, u: 0, s: 0, rem: 0, steer: 0, acc: 0, err: 0, ang: 0 });
      st.x = this.pos.x; st.z = this.pos.z; st.yaw = this.yaw; st.u = Math.max(0, this.u); st.s = A.s; st.ang = this.steer;
      const o = { vehiclesOnly: true, snap, gap: D.guardGap };
      const ov = this._overlapStart(st.x, st.z, st.yaw, ctx, o);
      const dist = st.u * st.u / (2 * D.taxiDecel) + D.guardMargin;
      let trav = 0, lastX = st.x, lastZ = st.z;
      for (let n = 0, nMax = D.simTime / h; n < nMax && trav < dist; n++) {
        this._autoControl(A.route, st, true);
        if (st.rem < D.hookDist) return false;
        this._simAdvance(st, h);
        const moved = Math.hypot(st.x - lastX, st.z - lastZ);
        if (moved >= D.guardStep) {
          trav += moved; lastX = st.x; lastZ = st.z;
          if (this._blockedFrom(ov, st.x, st.z, st.yaw, trav, ctx, o)) return true;
        }
        if (st.u < D.simStopSpeed && n * h > D.stuckTime) return false;
      }
      return false;
    }
    // 乗り物の今の位置（走り始めに覚える: _aheadBlocked）
    _seenNow(ctx) {
      const m = new Map(), vs = (ctx && ctx.vehicles) || [];
      for (const o of vs) if (o !== this) m.set(o, { x: o.pos.x, y: o.pos.y, z: o.pos.z, yaw: o.yaw, mode: o.mode });
      return m;
    }

    // 経路の s m の所
    _routeAt(R, s, out) {
      const pts = R.pts, cum = R.cum;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (s <= cum[i + 1] || i + 2 === pts.length) {
          const L = cum[i + 1] - cum[i], t = L > 1e-6 ? clamp((s - cum[i]) / L, 0, 1) : 1;
          return out.set(pts[i].x + (pts[i + 1].x - pts[i].x) * t, 0, pts[i].z + (pts[i + 1].z - pts[i].z) * t);
        }
      }
      return out.set(pts[pts.length - 1].x, 0, pts[pts.length - 1].z);
    }

    _poseNow() {
      const p = this._pNow || (this._pNow = { x: 0, z: 0, yaw: 0, u: 0, steer: 0, virtual: false });
      p.x = this.pos.x; p.z = this.pos.z; p.yaw = this.yaw; p.u = this.u; p.steer = this.mode === 'ground' ? this.steer : 0; p.s = 0;
      return p;
    }

    // pose（既定は今の位置）から空いたカタパルトへの経路（いちばん短いもの）か null: 誘導路ごとに、前へ deck.joinMin m 以上かつ横のずれ ×
    //   joinSlope 以上先の誘導路の点へ斜めに入り、誘導路の残りでカタパルトの始点へ。機体の球が箱・他の乗り物に当たらず甲板から出ない経路だけ
    //   （_simRoute）。カタパルトのすぐ近く（catSnapRadius m・前）なら始点へまっすぐ。軌道に他の乗り物がいるカタパルトは使わない（今の位置
    //   なら全部ふさがっているとき deckBusy）。{ cat, pts [{x,z}], cum, len, corner（角ごとの速さ）}
    _planRoute(ctx, pose, only) {
      const ops = this.ops, d = this.def, D = d.deck;
      if (!ops || !ops.cats || !ops.cats.length) return null;
      const now = !pose;
      pose = pose || this._poseNow();
      const snap = this._obsSnap(ctx);
      let best = null, busy = 0;
      const free = this._freeCats || (this._freeCats = []);
      free.length = 0;
      if (now) this._busyOcc = [];
      for (const cat of ops.cats) {
        const occ = this._catBusy(cat, ctx, snap);
        if (occ) { busy++; if (now) this._busyOcc.push(occ); continue; }
        if (only && cat !== only) continue; // このカタパルトだけ（_captureCheck）
        if (Math.abs(wrap(pose.yaw - cat.yaw * D2R)) <= D.maxTurn * D2R) free.push(cat);
      }
      // 入り方（誘導路の点を前へ joinMin + 横のずれ × 傾き m 以上先）: いつもの傾き joinSlope、その経路が当たるときだけ joinSlopeAlt を順に
      //  （小さい傾き = 早めに誘導路へ寄る・大きい = 長くまっすぐ。止まった所のすぐ前・横に止まっている機体の尾翼を翼で払わない入り方を探す）。
      //  誘導路は 1 つのカタパルトに何本でもよい（_laneSet）。1 回目はずらさない線だけ、どれでも行けなければ 2 回目に横へずらした線
      //  （誘導路にかかって止まっているヘリ・機体をよける）
      const slopes = this._slopes || (this._slopes = [D.joinSlope].concat(D.joinSlopeAlt || []));
      const lanes = this._laneSet();
      for (let pass = 0; pass < 2 && !best; pass++) {
        for (const cat of free) {
          let snapTried = false;
          for (const ln of lanes) {
            if (ln.cat !== cat.id || (ln.off !== 0) !== (pass === 1)) continue;
            for (let si = 0; si < slopes.length; si++) {
              const path = this._joinPath(cat, pose, slopes[si], ln);
              if (!path) continue;
              if (path.snap) { if (snapTried) break; snapTried = true; }
              const R = this._routeInfo(path, cat);
              if (best && R.len >= best.len) continue;
              if (this._simRoute(R, ctx, pose, snap)) { best = R; break; }
              if (path.snap) break;
            }
          }
        }
      }
      if (now) this.deckBusy = busy === ops.cats.length;
      return best;
    }
    // 甲板の目印・案内の経路（止まっている・自動でないとき）: いちばん近い空いたカタパルト。ただし手で前へ走っていて、ほかの空いたカタパルトの
    //   始点へはっきり機首を向けている（deck.headSpeed m/s より速い・始点が前 headDist m 以内・始点への向きが機首から headAngle° 以内で、
    //   いちばん近いカタパルトより headMargin° 以上まっすぐ。一度そちらに決めたら、向きが headAngle × 1.5° を超えてずれるか近い方が
    //   まっすぐになるまで保つ）ならそちらへの経路（手でカタパルト 1 へ走っている間も目印と案内がカタパルト 2 を指していた）。
    //   そのカタパルトへの経路が無ければいちばん近いもの
    _markRoute(ctx) {
      const r = this._planRoute(ctx), D = this.def.deck, ops = this.ops;
      if (!r || !ops || this.u < D.headSpeed) { this._headCat = null; return r; }
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const err = (c) => {
        const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
        if (Math.hypot(dx, dz) > D.headDist || dx * fx + dz * fz <= 0) return Infinity;
        return Math.abs(wrap(Math.atan2(dx, dz) - this.yaw));
      };
      const e0 = err(r.cat), lim = D.headAngle * D2R, mg = D.headMargin * D2R;
      let best = null, be = Infinity;
      for (const c of ops.cats) { if (c === r.cat) continue; const e = err(c); if (e < be) { be = e; best = c; } }
      const keep = best && best === this._headCat && be < lim * 1.5 && be < e0;
      if (best && (keep || (be < lim && be + mg < e0))) {
        const r2 = this._planRoute(ctx, null, best);
        if (r2 && r2.cat === best) { this._headCat = best; return r2; }
      }
      this._headCat = null;
      return r;
    }
    // 誘導路の候補（全部の機体で同じ。carrierOps ごとに覚える）: ops.lanes（{ cat, pts }。最後がカタパルトの始点）そのまま（off 0）と、横へ
    //   deck.laneOffsets m ずらした線（始点の手前 laneMerge + laneRamp m まではずらし、laneMerge m で元の線に戻る。誘導路がそれより短ければ無し）
    _laneSet() {
      const ops = this.ops, D = this.def.deck;
      const had = LANESETS.get(ops);
      if (had) return had;
      const out = [];
      for (const ln of ops.lanes || []) out.push({ cat: ln.cat, pts: ln.pts, off: 0 });
      for (const ln of ops.lanes || []) {
        const cat = ops.cats.find((c) => c.id === ln.cat), lp = ln.pts;
        if (!cat || lp.length < 2) continue;
        // 終わりからの距離
        const toEnd = new Array(lp.length);
        toEnd[lp.length - 1] = 0;
        for (let i = lp.length - 2; i >= 0; i--) toEnd[i] = toEnd[i + 1] + Math.hypot(lp[i + 1].x - lp[i].x, lp[i + 1].z - lp[i].z);
        const M = D.laneMerge, MR2 = D.laneMerge + D.laneRamp;
        if (toEnd[0] < MR2 + D.laneStep) continue;
        const at = (dist) => { // 終わりから dist m の点
          for (let i = 0; i + 1 < lp.length; i++) {
            if (toEnd[i + 1] <= dist) {
              const L = toEnd[i] - toEnd[i + 1], t = L > 1e-6 ? (toEnd[i] - dist) / L : 0;
              return { x: lp[i].x + (lp[i + 1].x - lp[i].x) * t, z: lp[i].z + (lp[i + 1].z - lp[i].z) * t };
            }
          }
          return { x: lp[lp.length - 1].x, z: lp[lp.length - 1].z };
        };
        const nx = cat.fz, nz = -cat.fx; // カタパルトの向きの右
        for (const o of D.laneOffsets || []) {
          if (!o) continue;
          const pts = [];
          for (let i = 0; i < lp.length && toEnd[i] > MR2; i++) pts.push({ x: lp[i].x + nx * o, z: lp[i].z + nz * o });
          const r = at(MR2);
          pts.push({ x: r.x + nx * o, z: r.z + nz * o }, at(M));
          for (let i = 0; i < lp.length; i++) if (toEnd[i] < M) pts.push({ x: lp[i].x, z: lp[i].z });
          out.push({ cat: ln.cat, pts, off: o });
        }
      }
      LANESETS.set(ops, out);
      return out;
    }
    // pose からカタパルト cat への誘導路 ln（_laneSet の 1 本）を使う経路の点（誘導路へ斜めに入る。傾き slope）か null。
    //   カタパルトのすぐ近く（catSnapRadius m・前）なら始点へまっすぐ（path.snap）。
    //   斜めに入る角度が大きい（kickMin° より）ときは、最初の kickDist m を少し強めに曲げる点を足す（すぐ前・横に止まっている機体の
    //   尾翼を翼で払わない）。曲げる角度はずれ × kickGain（最大 kickMax°）
    _joinPath(cat, pose, slope, ln) {
      const d = this.def, D = d.deck;
      const fx = cat.fx, fz = cat.fz, px = pose.x, pz = pose.z;
      const al = (q) => (q.x - px) * fx + (q.z - pz) * fz, lat = (q) => (q.x - px) * fz - (q.z - pz) * fx;
      let path = null;
      const dc = Math.hypot(cat.x - px, cat.z - pz);
      if (dc < d.catSnapRadius && al(cat) > -D.snapBehind) { path = [{ x: px, z: pz }, { x: cat.x, z: cat.z }]; path.snap = true; return path; }
      const lp = ln.pts;
      for (let i = 0; i + 1 < lp.length && !path; i++) {
        const a = lp[i], b = lp[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
        for (let t = 0; t <= L; t += D.laneStep) {
          const q = { x: a.x + (b.x - a.x) * t / L, z: a.z + (b.z - a.z) * t / L };
          if (al(q) >= D.joinMin + Math.abs(lat(q)) * slope) { path = [{ x: px, z: pz }, q].concat(lp.slice(i + 1).map((r) => ({ x: r.x, z: r.z }))); break; }
        }
      }
      if (!path) return null;
      if (path.length > 2) {
        const a1 = Math.atan2(path[1].x - px, path[1].z - pz), dA = wrap(a1 - pose.yaw);
        if (Math.abs(dA) > D.kickMin * D2R) {
          const ka = pose.yaw + Math.sign(dA) * Math.min(D.kickMax * D2R, Math.abs(dA) * D.kickGain), kd = D.kickDist;
          path.splice(1, 0, { x: px + Math.sin(ka) * kd, z: pz + Math.cos(ka) * kd });
        }
      }
      return path;
    }
    _routeInfo(pts, cat) {
      const D = this.def.deck, cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      // 角の速さ: 曲がる角度 θ、前を見る距離で回る半径 ≈ lookahead / (2 sin(θ/2)) → √(cornerAccel × 半径)（cornerMin 以上）
      const corner = pts.map((p, i) => {
        if (i === 0 || i === pts.length - 1) return D.taxiMax;
        const a1 = Math.atan2(p.x - pts[i - 1].x, p.z - pts[i - 1].z), a2 = Math.atan2(pts[i + 1].x - p.x, pts[i + 1].z - p.z);
        const th = Math.abs(wrap(a2 - a1));
        if (th < 0.02) return D.taxiMax;
        return Math.max(D.cornerMin, Math.min(D.taxiMax, Math.sqrt(D.cornerAccel * D.lookahead / (2 * Math.sin(th / 2)))));
      });
      return { cat, pts, cum, len: cum[cum.length - 1], corner, pre: null };
    }
    // カタパルトの軌道（deck.busyStep m ごと）に他の乗り物がいるか（止まっている機体・乗り捨てた機体）: いればその乗り物（分からなければ true）、いなければ null
    _catBusy(cat, ctx, snap) {
      const D = this.def.deck;
      for (let t = 0; t <= cat.length; t += D.busyStep) {
        if (this._poseBlocked(cat.x + cat.fx * t, cat.z + cat.fz * t, cat.yaw * D2R, ctx, { vehiclesOnly: true, snap })) return (this._lastBlock && this._lastBlock.obj) || true;
      }
      return null;
    }
    // 今カタパルトをふさいでいる乗り物（_planRoute を通らないとき）
    _occupants(ctx) {
      const out = [], ops = this.ops, snap = this._obsSnap(ctx);
      if (ops && ops.cats) for (const cat of ops.cats) { const o = this._catBusy(cat, ctx, snap); if (o) out.push(o); }
      return out;
    }
    // 空くのを待てるか: カタパルトをふさいでいるもの（_busyOcc。_planRoute で覚える）に、甲板員が片付ける乗り捨てた戦闘機（_clearDeck）か
    //   人が乗っている乗り物（発艦する・どく）がある → 'cat'。誘導路・着艦の場所に甲板員が片付ける機体（_foulKind 'lane' / 'landing'）が
    //   ある → 'deck'（着艦して降りた機体が誘導路に残っていると、次の機体は経路が無く牽引していた）。どちらも無ければ null
    _waitable(ctx) {
      const occ = this._busyOcc || [];
      for (const o of occ) if (o && o !== true && (o.kind === 'jet' || o.driver || o.netControlled)) return 'cat';
      for (const o of (ctx && ctx.vehicles) || []) if (o !== this && o.kind === 'jet' && o.ops === this.ops && (o._foulKind === 'lane' || o._foulKind === 'landing') && !o.disposed) return 'deck';
      return null;
    }

    // 前へ行けない（艦首・甲板の端・カタパルトを通り過ぎた・逆向き）: 後ろへ下がってから前へ。下がり方の候補（deck.recoverBack m まっすぐ、
    //   deck.recoverArc m 前輪いっぱいで左右）を短い順に、下がる間の機体（deck.checkStep m ごと）が当たらず甲板から出ず、下がった所から
    //   前への経路（_planRoute）があるもの。経路に pre = { steer, len } を付けて返す。止まっているときだけ
    _planRecovery(ctx, dbg, from) {
      const d = this.def, D = d.deck, ops = this.ops;
      if (!ops || this.deckBusy) return null;
      const snap = this._obsSnap(ctx);
      let list = this._recList;
      if (!list) {
        list = [];
        for (const b of D.recoverBack) list.push({ steer: 0, len: b });
        for (const b of D.recoverArc) list.push({ steer: 1, len: b }, { steer: -1, len: b });
        list.sort((a, b) => a.len - b.len);
        this._recList = list;
      }
      const p0 = from || this._poseNow();
      const ov0 = this._overlapStart(p0.x, p0.z, p0.yaw, ctx, { snap });
      const deck0 = this._poseOnDeck(p0.x, p0.z, p0.yaw, ctx); // 車輪が甲板の外に出ている所からは、3 つとも甲板に乗るまで見ない
      const step = D.checkStep * 0.25;
      // 向きをそろえてから下がる（斜めに止まった所: まっすぐ下がると甲板の端へ出る）: カタパルトの向きとのずれ（recoverAlignMin° より大きい）を
      //  前輪 recoverAlignSteer で消す弧（arc m）の後、まっすぐ recoverBack m
      const al = this._alignList || (this._alignList = []);
      al.length = 0;
      const tnA = Math.tan(D.recoverAlignSteer * d.noseSteer * D2R) / d.wheelbase;
      for (let k = 0; k < (ops.cats || []).length; k++) {
        const cat = ops.cats[k];
        if (ops.cats.slice(0, k).some((c) => c.yaw === cat.yaw)) continue; // 同じ向きのカタパルトは 1 回
        const err = wrap(p0.yaw - cat.yaw * D2R);
        if (Math.abs(err) < D.recoverAlignMin * D2R || tnA <= 0) continue;
        const arc = Math.abs(err) / tnA;
        if (arc > D.recoverAlignMax) continue;
        for (const b of D.recoverBack) al.push({ steer: -Math.sign(err) * D.recoverAlignSteer, arc, len: arc + b });
      }
      const cand = al.length ? list.concat(al).sort((a, b) => a.len - b.len) : list;
      for (const m of cand) {
        let x = p0.x, z = p0.z, yaw = p0.yaw, s = 0, last = 0, ok = true, onYet = deck0;
        const ov = ov0 && { on: true, g0: ov0.g0 };
        const tn = Math.tan(m.steer * d.noseSteer * D2R);
        while (s < m.len - 1e-6) {
          const ds = Math.min(step, m.len - s, m.arc != null && s < m.arc - 1e-6 ? m.arc - s : Infinity);
          // 後ろへ: 機首の回り方は前へ走るときと逆（yr = −u / wheelbase × tan(前輪)、u < 0）。arc の後はまっすぐ
          if (m.arc == null || s < m.arc - 1e-6) yaw = wrap(yaw + ds / d.wheelbase * tn);
          x -= Math.sin(yaw) * ds; z -= Math.cos(yaw) * ds;
          s += ds;
          if (s - last >= (s < D.checkNear ? step : D.checkStep) - 1e-6 || s >= m.len - 1e-6) {
            last = s;
            const od = this._poseOnDeck(x, z, yaw, ctx);
            if ((onYet && !od) || this._blockedFrom(ov, x, z, yaw, s, ctx, { snap })) { ok = false; if (dbg) dbg.push({ m, s, why: onYet && !od ? 'edge' : 'hit', hit: this._lastBlock }); break; }
            if (od) onYet = true;
          }
        }
        if (!ok || !onYet) continue;
        const R = this._planRoute(ctx, { x, z, yaw, u: 0, steer: 0, virtual: true });
        if (dbg && !R) dbg.push({ m, why: 'noroute', x, z, yaw: yaw / D2R });
        if (R) { R.pre = { steer: m.steer, len: m.len, arc: m.arc != null ? m.arc : null, s: 0, done: false }; return R; }
      }
      // 下がるだけでは無い: 先に少し前へ（deck.recoverFwd m・前輪 recoverFwdSteer）出てから、そこからの経路か下がる経路（2 段）。
      //  機首の先をふさがれ後ろが甲板の端（T18 の j_1: 斜めの駐機の前に着艦の場所のヘリ）でも牽引しない。見るのは止まった所ごとに 1 回
      //  （1 回 0.1〜0.6 秒かかる。発艦ボタンを押し続けても同じ所では探し直さない）
      if (from || !D.recoverFwd || !D.recoverFwd.length) return null;
      let sig = 0;
      for (const o of (ctx && ctx.vehicles) || []) {
        if (o === this || o.disposed || Math.abs(o.pos.x - p0.x) > D.snapReach || Math.abs(o.pos.z - p0.z) > D.snapReach) continue;
        sig += Math.round(o.pos.x * 2) * 31 + Math.round(o.pos.z * 2) * 17 + Math.round((o.yaw || 0) * 20) + (o.wrecked ? 7 : 0);
      }
      const FF = this._fwdFail;
      if (FF && Math.hypot(FF.x - p0.x, FF.z - p0.z) < 0.3 && Math.abs(wrap(FF.yaw - p0.yaw)) < 2 * D2R && FF.sig === sig) return null;
      for (const L of D.recoverFwd) for (const st of (D.recoverFwdSteer || [0])) {
        let x = p0.x, z = p0.z, yaw = p0.yaw, s = 0, last = 0, ok = true, onYet = deck0;
        const ov = ov0 && { on: true, g0: ov0.g0 };
        const tn = Math.tan(st * d.noseSteer * D2R);
        while (s < L - 1e-6) {
          const ds = Math.min(step, L - s);
          yaw = wrap(yaw - ds / d.wheelbase * tn); // 前へ: yr = −u / wheelbase × tan(前輪)（_steerYaw）
          x += Math.sin(yaw) * ds; z += Math.cos(yaw) * ds;
          s += ds;
          if (s - last >= step - 1e-6 || s >= L - 1e-6) {
            last = s;
            const od = this._poseOnDeck(x, z, yaw, ctx);
            if ((onYet && !od) || this._blockedFrom(ov, x, z, yaw, s, ctx, { snap })) { ok = false; break; }
            if (od) onYet = true;
          }
        }
        if (!ok || !onYet) continue;
        const pose = { x, z, yaw, u: 0, steer: 0, virtual: true };
        const R = this._planRoute(ctx, pose) || this._planRecovery(ctx, null, pose);
        if (R) { R.fwd = { steer: st, len: L, s: 0, done: false }; this._fwdFail = null; return R; }
      }
      this._fwdFail = { x: p0.x, z: p0.z, yaw: p0.yaw, sig };
      return null;
    }

    // 牽引（最後の手段: 前へも下がっても行けない）: 空いたカタパルトの後ろ deck.towBack m の所（当たらない・甲板の上・そこから経路がある）へ
    //   機体を移す。経路か null
    _tow(ctx) {
      const ops = this.ops, D = this.def.deck;
      if (!ops || this.deckBusy) return null;
      const snap = this._obsSnap(ctx);
      const cats = ops.cats.slice().sort((a, b) => Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z));
      for (const cat of cats) {
        if (this._catBusy(cat, ctx, snap)) continue;
        for (const k of D.towBack) {
          const x = cat.x - cat.fx * k, z = cat.z - cat.fz * k, yaw = cat.yaw * D2R;
          if (!this._poseOnDeck(x, z, yaw, ctx) || this._poseBlocked(x, z, yaw, ctx, { snap })) continue;
          const R = this._planRoute(ctx, { x, z, yaw, u: 0, steer: 0, virtual: true });
          if (!R) continue;
          this.pos.x = x; this.pos.z = z; this.yaw = yaw; this.u = 0; this.steer = 0; this.theta = 0;
          this._syncFromGround();
          this.events.push({ t: 'deck_tow', cat: cat.id });
          return R;
        }
      }
      return null;
    }

    // 甲板員の片付け（無人で止まっている機体。操縦士がいない間 update から毎フレーム）: 駐機場所（自分の場所・ほかの駐機場所から
    //   deck.clearMoved m 以内）以外で
    //   ・着艦の場所（_foulOf 'landing'。着艦して降りた所）か誘導路（'lane'）にかかっている → deck.landedClearTime 秒で
    //   ・カタパルトの軌道の上（後ろ deck.clearBehind m・横 clearLat m）→ deck.clearTime 秒で
    //   駐機場所へ戻す。ほかの機体がそこを要る（誘導路・カタパルトが空くのを待つ操縦士 DECKWAIT、着艦の進入 LANDNEED）なら clearWait 秒で。
    //   戻す先は自分の場所、ふさがっていれば（乗った人がそこまで走ってきた）空いている駐機場所（元の場所に近い順）。ほかの乗り物・歩いている
    //   プレイヤー（deck.spotPlayerClear m）がいる場所へは置かない（どこも空いていなければ待つ）。以前はカタパルトの軌道だけを片付け、
    //   着艦して降りた機体は着艦の場所（誘導路の上）にずっと残り、次の着艦がワイヤーの後の走りでぶつかって両方爆発した（実機の順番の 4 機）
    _clearDeck(dt, ctx) {
      const ops = this.ops, D = this.def.deck;
      let kind = null;
      if (Math.abs(this.u) < D.stopSpeed && Math.abs(this.pos.y - ops.deckY) < D.heightTol && !this._atSpot()) {
        // カタパルトの軌道の上（誘導路の終わりでもある）は 'cat'（乗り捨ててすぐ戻る人のために clearTime 秒。T12 / T17）、着艦の場所は 'landing'
        let onCat = false;
        for (const cat of ops.cats) {
          const dx = this.pos.x - cat.x, dz = this.pos.z - cat.z, al = dx * cat.fx + dz * cat.fz, lat = Math.abs(dx * cat.fz - dz * cat.fx);
          if (al > -D.clearBehind && al < cat.length && lat < D.clearLat) { onCat = true; break; }
        }
        const f = this._foulOf(this, !onCat);
        kind = f === 'landing' ? f : onCat ? 'cat' : f;
      }
      this._foulKind = kind;
      this._abandonT = kind ? (this._abandonT || 0) + dt : 0;
      // ほかの機体がこの場所を要る: カタパルト・誘導路が空くのを待っている操縦士（DECKWAIT: _deckStep が毎フレーム書く）、
      //  着艦の場所は進入してくる機体（LANDNEED: _carrier が書く）
      const now = ctx && ctx.time, recent = (m) => { const w = m.get(ops); return w != null && now != null && now >= w && now - w <= D.waitPing; };
      const wanted = !!kind && (recent(DECKWAIT) || (kind === 'landing' && recent(LANDNEED)));
      this._waitedT = wanted ? (this._waitedT || 0) + dt : 0;
      if (this._abandonT <= (kind === 'cat' ? D.clearTime : D.landedClearTime) && !(this._waitedT > D.clearWait)) return;
      const sp = this.spawnPos, spots = [{ x: sp.x, z: sp.z, yaw: this.spawnYaw, home: true }];
      for (const q of ops.jetSpots || []) if (Math.hypot(q.x - sp.x, q.z - sp.z) > D.clearMoved) spots.push({ x: q.x, z: q.z, yaw: q.yaw * D2R, d: Math.hypot(q.x - sp.x, q.z - sp.z) });
      spots.sort((a, b) => (a.home ? -1 : b.home ? 1 : a.d - b.d));
      const snap = this._obsSnap(ctx), pl = ctx && ctx.player && ctx.player.pos;
      for (const q of spots) {
        if (pl && Math.hypot(pl.x - q.x, pl.z - q.z) < D.spotPlayerClear) continue;
        if (this._poseBlocked(q.x, q.z, q.yaw, ctx, { vehiclesOnly: true, snap })) continue;
        this._abandonT = 0; this._waitedT = 0; this._foulKind = null;
        // 置き直しは respawn()（その場で駐機場所へ。牽引の動きは無い）: 甲板員の整備として HP・機銃・ミサイル・フレアも満タンに戻す。
        //  わざと: 無人で止めてある機体は update で何もしない（_carrier の補給も回らない）ので、残りを持ち越すとミサイルが欠けたまま
        //  まとめた形（PARKED。ミサイルが満タンのときだけ）で描けず、甲板の描画が 1 機 約 70 回に戻る
        this.respawn();
        if (!q.home) { this.pos.x = q.x; this.pos.z = q.z; this.yaw = q.yaw; this._syncFromGround(); this._apply(); }
        this.events.push({ t: 'deck_cleared', home: !!q.home, from: kind });
        return;
      }
    }
    // 駐機場所（自分の場所かほかの駐機場所から deck.clearMoved m 以内）に置いてある
    _atSpot() {
      const ops = this.ops, D = this.def.deck, sp = this.spawnPos;
      if (sp && Math.hypot(this.pos.x - sp.x, this.pos.z - sp.z) <= D.clearMoved) return true;
      for (const q of (ops && ops.jetSpots) || []) if (Math.hypot(this.pos.x - q.x, this.pos.z - q.z) <= D.clearMoved) return true;
      return false;
    }
    // 乗り物 o が甲板の着艦の場所（接地点の後ろ landing.rampDist m 〜 前 length m、横は右舷 halfWidthStbd・左舷 halfWidthPort + deck.foulPad m）か
    //   誘導路（ops.lanes の線から deck.foulLane m）にかかっているか → 'landing' | 'lane' | null。地上の戦闘機は機体の球（翼まで）、
    //   ほかは位置の円（長さ・幅の大きい方の半分）。甲板の高さから deck.foulHeight m より離れていれば数えない（飛んでいる・海の上）。
    //   lanes = false なら着艦の場所だけ
    _foulOf(o, lanes) {
      const ops = this.ops, D = this.def.deck, L = ops && ops.landing;
      if (!L || Math.abs(o.pos.y - ops.deckY) > D.foulHeight) return null;
      const C = this._foulC || (this._foulC = []);
      let n = 0;
      if (o.kind === 'jet' && typeof o._hullWorld === 'function') {
        const hw = o._hw || (o._hw = HULL.map(() => new THREE.Vector3()));
        o._hullWorld(hw);
        for (let i = 0; i < hw.length; i++) { C[n++] = hw[i].x; C[n++] = hw[i].z; C[n++] = HULL[i].r; }
      } else {
        const od = o.def || {};
        C[n++] = o.pos.x; C[n++] = o.pos.z; C[n++] = Math.max(num(od.length, 0), num(od.width, 0)) / 2 || 3;
      }
      let lane = false;
      for (let i = 0; i < n; i += 3) {
        const x = C[i], z = C[i + 1], r = C[i + 2] + D.foulPad;
        const dx = x - L.x, dz = z - L.z, al = dx * L.fx + dz * L.fz, lt = dx * L.rx + dz * L.rz;
        if (al > -L.rampDist - r && al < L.length + r && lt < L.halfWidthStbd + r && lt > -L.halfWidthPort - r) return 'landing';
        if (lanes === false || lane) continue;
        for (const ln of ops.lanes || []) {
          const P = ln.pts;
          for (let k = 0; k + 1 < P.length && !lane; k++) {
            const ax = P[k].x, az = P[k].z, bx = P[k + 1].x - ax, bz = P[k + 1].z - az, LL = bx * bx + bz * bz;
            const t = LL > 1e-9 ? clamp(((x - ax) * bx + (z - az) * bz) / LL, 0, 1) : 0;
            if (Math.hypot(x - ax - bx * t, z - az - bz * t) < D.foulLane + C[i + 2]) lane = true;
          }
          if (lane) break;
        }
      }
      return lane ? 'lane' : null;
    }
    // 着艦の場所にかかっている乗り物（ほかの機体・ヘリ・車・残骸）か null。駐機場所に置いてある機体は数えない（駐機場所は着艦の場所の外。
    //   艦橋の後ろの j_1 の翼の先は帯 + foulPad にかかる）
    _landingFoul(ctx) {
      for (const o of (ctx && ctx.vehicles) || []) {
        if (o === this || o.disposed || o.sunk || (o.wrecked && o.wreckFall) || !o.pos) continue;
        if (o.kind === 'jet' && !o.wrecked && o.mode === 'ground' && typeof o._atSpot === 'function' && o._atSpot()) continue;
        if (this._foulOf(o, false) === 'landing') return o;
      }
      return null;
    }

    // 手で走る（甲板）: 今の前輪の指令のまま止まるまで（ブレーキいっぱい）+ deck.guardMargin m 走ったときの機体（deck.guardStep m ごと）が、
    //   箱・他の乗り物（機体なら翼まで）に当たる → 'obstacle'、車輪が甲板から出る → 'edge'、どちらでもなければ null。
    //   dir = 1 前 / −1 後ろ
    _taxiGuard(ctx, dir) {
      const d = this.def, D = d.deck;
      const u = Math.abs(this.u);
      // 止まるまでの距離: ブレーキいっぱい + 摩擦 − 今の推力（スロットルを戻しても回転はすぐには下がらない。前へのときだけ）
      const dec = Math.max(D.guardMinDecel, d.brake + d.taxiFriction - (dir > 0 ? this._thrust() : 0));
      const dist = u * u / (2 * dec) + D.guardMargin;
      const fade = clamp(1 - u / d.steerFadeSpeed, 0, 1);
      const tn = Math.tan(this.cmd.steer * d.noseSteer * D2R * fade);
      const snap = this._obsSnap(ctx);
      const cands = this._gcands || (this._gcands = []);
      cands.length = 0;
      const nav = ctx && ctx.nav, R = dist + HULL_R + D.boxReach, x0 = this.pos.x, z0 = this.pos.z;
      if (nav && typeof nav.itemsIn === 'function') nav.itemsIn(x0 - R, z0 - R, x0 + R, z0 + R, cands);
      if (this.collider) this.collider.query(x0 - R, z0 - R, x0 + R, z0 + R, cands);
      const po = { snap, cands, gap: D.guardGap }, ov = this._overlapStart(x0, z0, this.yaw, ctx, po);
      // 後ろへ: 車輪がもう甲板の外に出ている（端で斜めに止まった・艦首の先）なら 3 つとも甲板に乗るまで甲板の判定はしない（甲板の内へ戻れる）
      let onYet = dir > 0 || this._poseOnDeck(x0, z0, this.yaw, ctx);
      let x = x0, z = z0, yaw = this.yaw;
      const n = Math.max(1, Math.ceil(dist / D.guardStep)), ds = dist / n;
      for (let k = 1; k <= n; k++) {
        yaw = wrap(yaw - dir * ds / d.wheelbase * tn);
        x += Math.sin(yaw) * ds * dir; z += Math.cos(yaw) * ds * dir;
        const od = this._poseOnDeck(x, z, yaw, ctx);
        if (onYet && !od) return 'edge';
        if (od) onYet = true;
        if (this._blockedFrom(ov, x, z, yaw, k * ds, ctx, po)) return 'obstacle';
      }
      return null;
    }

    // 3 つの車輪（前輪・両方の主脚）が甲板の上か（(x, z) に向き yaw で置いたとき。機首・尾は甲板の外へ出てもよい）
    _poseOnDeck(x, z, yaw, ctx) {
      const ops = this.ops;
      if (!ops) return true;
      const c = Math.cos(yaw), sn = Math.sin(yaw), y = ops.deckY;
      for (let i = 0; i < 3; i++) {
        const p = this.contacts[i];
        const S = this._support(ctx, x + p.x * c + p.z * sn, z - p.x * sn + p.z * c, y);
        if (S.y === null || S.y < y - this.def.deck.heightTol) return false;
      }
      return true;
    }

    // 他の乗り物の今の位置（経路を選ぶ・止まる判定で何度も使う）: 地上の戦闘機は機体の球（翼まで）、ほかは _pushCircle
    _obsSnap(ctx, filter) {
      const D = this.def.deck, S = filter ? (this._snapF || (this._snapF = { jets: [], jo: [], others: [], n: 0 })) : (this._snap || (this._snap = { jets: [], jo: [], others: [], n: 0 }));
      S.others.length = 0;
      let n = 0;
      const others = (ctx && ctx.vehicles) || [];
      for (let k = 0; k < others.length; k++) {
        const o = others[k];
        if (o === this || o.disposed || o.sunk || (o.wrecked && o.wreckFall)) continue;
        if (Math.abs(o.pos.x - this.pos.x) > D.snapReach || Math.abs(o.pos.z - this.pos.z) > D.snapReach) continue;
        if (filter && !filter(o)) continue;
        if (o.kind === 'jet' && o.mode === 'ground' && typeof o._hullWorld === 'function') {
          const hw = o._hw || (o._hw = HULL.map(() => new THREE.Vector3()));
          o._hullWorld(hw);
          S.jo[n / HULL.length | 0] = o;
          for (let i = 0; i < hw.length; i++) { S.jets[n * 4] = hw[i].x; S.jets[n * 4 + 1] = hw[i].y; S.jets[n * 4 + 2] = hw[i].z; S.jets[n * 4 + 3] = HULL[i].r; n++; }
        } else if (typeof o._pushCircle === 'function') S.others.push(o);
      }
      S.n = n;
      return S;
    }

    // (x, z) に向き yaw で置いた機体の球が箱（甲板の上の物。ジェットブラストデフレクターは乗り越える）・他の乗り物に当たるか。
    //   地上の戦闘機とは球どうしで deck.jetGap m 以上離れていること（翼の先が隣の機体の尾翼・翼に入らない）。
    //   o = { vehiclesOnly, snap（_obsSnap）, cands（集めておいた箱）}
    _poseBlocked(x, z, yaw, ctx, o) { return this._poseScan(x, z, yaw, ctx, o, false) < 0; }
    // 同じ判定の隙間（m。負 = 当たり・めり込みの深さ。機体どうしは jetGap を引いた残り）。exact でなければ当たりを 1 つ見つけたら返す
    //   （そのときの値は当たりの深さ、当たらなければ Infinity）。exact は一番狭い所（当たっていない物は数えない: 0 以上はすべて「空いている」）
    _poseGap(x, z, yaw, ctx, o) { return this._poseScan(x, z, yaw, ctx, o, true); }
    _poseScan(x, z, yaw, ctx, o, exact) {
      o = o || {};
      const D = this.def.deck, c = Math.cos(yaw), sn = Math.sin(yaw), y = this.ops ? this.ops.deckY : this.pos.y, R = HULL_R + D.boxReach;
      let cands = o.cands;
      if (!o.vehiclesOnly && !cands) {
        cands = this._pcands || (this._pcands = []);
        cands.length = 0;
        const nav = ctx && ctx.nav;
        if (nav && typeof nav.itemsIn === 'function') nav.itemsIn(x - R, z - R, x + R, z + R, cands);
        if (this.collider) this.collider.query(x - R, z - R, x + R, z + R, cands);
      }
      if (o.vehiclesOnly) cands = null;
      const snap = o.snap || this._obsSnap(ctx), J = snap.jets, gap = o.gap != null ? o.gap : D.jetGap;
      const jbd = this.ops && this.ops.jbd;
      let m = Infinity;
      for (let i = 0; i < HULL.length; i++) {
        const hh = HULL[i], r = hh.r;
        const wx = x + hh.x * c + hh.z * sn, wz = z - hh.x * sn + hh.z * c, wy = y + hh.y;
        if (cands) {
          for (let n = 0; n < cands.length; n++) {
            const b = cands[n];
            if (b.f & 1) continue;
            if (wx + r < b.x0 || wx - r > b.x1 || wz + r < b.z0 || wz - r > b.z1) continue;
            if (jbd && this._isJbd(b, jbd)) continue;
            const top = b.k === 1 ? MR.Nav3D.itemTop(b, wx, wz) : b.y1;
            if (wy - r >= top - D.topClear) continue;
            const dx = wx - clamp(wx, b.x0, b.x1), dz = wz - clamp(wz, b.z0, b.z1), dy = wy - clamp(wy, b.y0, top), d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < r * r) {
              this._lastBlock = { hull: i, box: [b.x0, b.y0, b.z0, b.x1, top, b.z1] };
              const g = Math.sqrt(d2) - r;
              if (!exact) return g;
              if (g < m) m = g;
            }
          }
        }
        for (let k = 0; k < snap.n; k++) {
          const dx = wx - J[k * 4], dy = wy - J[k * 4 + 1], dz = wz - J[k * 4 + 2], mm = r + J[k * 4 + 3] + gap, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < mm * mm) {
            this._lastBlock = { hull: i, jet: k / HULL.length | 0, obj: snap.jo && snap.jo[k / HULL.length | 0] };
            const g = Math.sqrt(d2) - mm;
            if (!exact) return g;
            if (g < m) m = g;
          }
        }
        for (let k = 0; k < snap.others.length; k++) {
          const ov = snap.others[k];
          if (Math.abs(ov.pos.x - wx) > D.otherReach || Math.abs(ov.pos.z - wz) > D.otherReach) continue;
          const oh = (ov.def && ov.def.height) || D.otherHeight;
          if (wy - r > ov.pos.y + oh || wy + r < ov.pos.y) continue;
          const q = ov._pushCircle(wx, wz, r), push = Math.hypot(q.x - wx, q.z - wz);
          if (push > D.pushEps) {
            this._lastBlock = { hull: i, vehicle: ov.cityId || ov.kind, obj: ov };
            if (!exact) return -push;
            if (-push < m) m = -push;
          }
        }
      }
      return m;
    }

    // 初めから触れている所（_poseBlocked。止まった所が隣の機体の翼の近く・箱の角）から動く経路の確かめ: start = _overlapStart（触れて
    //   いなければ null）。触れている間は隙間（_poseGap）が始まりより deck.overlapTol m 狭くなれば当たり（離れていく向きだけ通す。翼を隣の機体へ
    //   押し込まない）、deck.overlapSkip m 動いてもまだ触れていれば当たり。離れたら（隙間 ≥ 0）ふつうの判定。trav = 動いた距離
    _overlapStart(x, z, yaw, ctx, o) {
      if (!this._poseBlocked(x, z, yaw, ctx, o)) return null;
      return { on: true, g0: this._poseGap(x, z, yaw, ctx, o) };
    }
    _blockedFrom(start, x, z, yaw, trav, ctx, o) {
      if (start && start.on) {
        const D = this.def.deck, g = this._poseGap(x, z, yaw, ctx, o);
        if (g >= 0) { start.on = false; return false; }
        return g < start.g0 - D.overlapTol || trav > D.overlapSkip;
      }
      return this._poseBlocked(x, z, yaw, ctx, o);
    }

    // ---------- 空母 ----------

    _carrier(dt, ctx) {
      const ops = this.ops, d = this.def;
      if (!ops) return;
      const box = ops.box;
      const nearCarrier = this.p.x > box.x0 - 30 && this.p.x < box.x1 + 30 && this.p.z > box.z0 - 30 && this.p.z < box.z1 + 30;
      const onDeck = this.mode === 'ground' && nearCarrier && Math.abs(this.pos.y - ops.deckY) < 0.6;
      this.onDeck = onDeck;
      if (this.mode === 'ground' && Math.abs(this.u) < d.deck.manualMax) this._taxiing = true;
      // カタパルトに入る（止まりかけで近く・向きが近い・脚が下りている）。自動の地上滑走は目的のカタパルトだけ、誘導路の終わり
      //  （deck.hookDist m）で（解除の後の待ち時間 _catCool は手で止まったときだけ）
      const A0 = this._auto, A = A0 && !A0.stopping && !(A0.pre && !A0.pre.done) && !(A0.fwd && !A0.fwd.done) ? A0 : null; // 止まる途中・下がる途中は手のときと同じ
      if (onDeck && !this.cat && !this.arrest && this.driver && this.gearPos > 0.95 && (A || Math.abs(this.u) < d.catSnapSpeed)) {
        for (const c of ops.cats) {
          if (A && (!A.route || A.route.cat !== c)) continue;
          const dist = Math.hypot(this.pos.x - c.x, this.pos.z - c.z);
          const dyaw = Math.abs(wrap(this.yaw - c.yaw * D2R)) / D2R;
          const ok = A ? ((A.rem < d.deck.hookDist && this.u < d.catSnapSpeed * d.deck.hookSpeedMul) || (Math.abs(this.u) < d.catSnapSpeed && dist < d.catSnapRadius && A.rem < d.catSnapRadius))
            : (dist < d.catSnapRadius && !(this._catCool > 0));
          if (ok && dyaw < d.catSnapAngle) {
            // 自動で来た（すぐ近く）なら位置合わせは deck.alignTime 秒
            this.cat = { ph: 'align', t: 0, c, from: { x: this.pos.x, z: this.pos.z, yaw: this.yaw }, hold: 0, auto: !!(A0 && !A0.stopping), armed: false, alignT: A ? d.deck.alignTime : d.catAlignTime };
            this.u = 0; this.theta = 0; this.abOn = false; this.throttle = Math.min(this.throttle, A ? 1 : d.deck.hookThrottle);
            this._auto = null; this.deckRoute = null;
            this.events.push({ t: 'cat_hook', cat: c.id, yaw: c.yaw, auto: !!A });
            break;
          }
        }
      }
      // 着艦: 脚を下ろして空母の着艦の向きに並んで近づいている（hookAutoRange m 以内・進入路の後ろ・向きが hookAutoAngle° 以内）と
      //  フックを下ろす（自動）。下ろした後は向きが大きく外れる・遠ざかる・脚を上げると上げる。空母の甲板の外で接地したら上げる（道路）
      const L = ops.landing;
      const dl = Math.hypot(this.p.x - L.x, this.p.z - L.z);
      if (this.mode === 'air') {
        const vhl = Math.hypot(this.vel.x, this.vel.z) || 1, cosH = (this.vel.x * L.fx + this.vel.z * L.fz) / vhl;
        const al = (this.p.x - L.x) * L.fx + (this.p.z - L.z) * L.fz, lt = Math.abs((this.p.x - L.x) * L.rx + (this.p.z - L.z) * L.rz);
        const ang = num(d.hookAutoAngle, 40) * D2R;
        const lined = al < 150 && lt < 80 + Math.max(0, -al) * 0.3 && cosH > Math.cos(ang);
        if (this.gearDown && dl < d.hookAutoRange && lined) { if (!this.hookDown) { this.hookDown = true; this.events.push({ t: 'hook', down: true }); } }
        else if (this.hookDown && (!this.gearDown || dl > d.hookAutoRange * 1.2 || cosH < Math.cos(ang * 1.8))) this.hookDown = false;
      } else if (this.hookDown && !onDeck && !this.arrest) this.hookDown = false;
      // 甲板に機体（着艦の場所）: 空母へ進入している（フックを下ろした・自動着艦）間は甲板員に知らせ（LANDNEED → _clearDeck が clearWait 秒で
      //  片付ける）、deck.foulEvery 秒ごとに着艦の場所を見る（deckFoul: HUD の警告。自動着艦は近くでやり直す）
      const apC = this.autoland && this.autoland.kind === 'carrier';
      if (this.mode === 'air' && this.driver && (this.hookDown || apC)) {
        if (ctx && ctx.time != null) LANDNEED.set(ops, ctx.time);
        if (this.time >= (this._foulAt || 0)) { this._foulAt = this.time + d.deck.foulEvery; this.deckFoul = this._landingFoul(ctx); }
      } else { this.deckFoul = null; this._foulAt = 0; }
      // ワイヤー: 甲板の上でフックの先が越えた
      if (this.hookDown && this.hookPos > 0.9 && !this.arrest && nearCarrier && this.hookTip) {
        this._apply(); // フックの先はこのフレームの位置・姿勢で（root を先に動かす。getWorldPosition が親から行列を作り直す）
        const tip = this.hookTip.getWorldPosition(this._v3);
        const along = (tip.x - L.x) * L.fx + (tip.z - L.z) * L.fz, lat = (tip.x - L.x) * L.rx + (tip.z - L.z) * L.rz;
        const prev = this._hookAlong;
        this._hookAlong = along;
        if (prev != null && tip.y < ops.deckY + d.wireHeight && Math.abs(lat) <= L.wireHalfWidth && this.speed > 3) {
          for (let k = 0; k < L.wires.length; k++) {
            const w = L.wires[k].d;
            if (prev < w && along >= w) {
              this._catchWire(k, ctx);
              break;
            }
          }
        }
        // ボルター: フックの先がワイヤーを全部越えた（+2 m）のに掛からなかった。甲板を走って越えたときだけでなく、甲板のすぐ上
        //  （bolterHeight m より低い）を浮いたまま越えたときも（以前はそのまま接地してボルターにならず、アイドルのまま甲板の端から落ちた）
        const wl = L.wires[L.wires.length - 1].d + 2;
        if (!this.arrest && !this.bolter && prev != null && prev < wl && along >= wl &&
          (this.mode === 'ground' || (tip.y < ops.deckY + num(d.bolterHeight, 8) && Math.abs(lat) <= L.wireHalfWidth + 6))) {
          this.bolter = true;
          this.events.push({ t: 'bolter', air: this.mode === 'air' });
        }
      } else this._hookAlong = null;
      // 空中のボルターは甲板から bolterClear m 上がったか空母から離れたら終わり（自動着艦はそこからやり直し）
      if (this.bolter && this.mode === 'air' && (!nearCarrier || this.p.y > ops.deckY + num(d.bolterClear, 40))) this.bolter = false;
      // 甲板で止まっていると弾を補給
      if (onDeck && Math.abs(this.u) < 1 && !this.cat && (this.ammo < d.gun.ammo || this.missileCount < d.missile.count || this.flareCount < d.flares.count)) {
        this.rearmT += dt;
        if (this.rearmT >= d.rearmTime) {
          this.ammo = d.gun.ammo; this.missileCount = d.missile.count; this.flareCount = d.flares.count; this.rearmT = 0;
          this._storesShow(); this.events.push({ t: 'rearm' });
        }
      } else this.rearmT = 0;
    }

    _catchWire(k, ctx) {
      const L = this.ops.landing, d = this.def;
      if (this.mode === 'air') {
        // 甲板のすぐ上でワイヤーを拾った: 接地と同じ条件（沈む速さ・速さ・傾き・機首）を満たさなければ墜落、満たせば甲板に下ろす
        const sink = -this.vel.y, V = this.speed, bank = Math.abs(this.bankDeg), pitch = this.pitchDeg;
        const rec = { t: +this.time.toFixed(2), sink: +sink.toFixed(2), speed: +V.toFixed(1), bank: +bank.toFixed(1), pitch: +pitch.toFixed(1), gear: this.gearPos > 0.9, water: false, hook: true, wire: k + 1, ok: false };
        this.landings.push(rec);
        if (this.landings.length > 20) this.landings.shift();
        if (this.gearPos < 0.9 || sink > d.touchdownSink || V > d.touchdownSpeed || bank > d.touchdownRoll || pitch < d.touchdownPitch) { this._crash('deck', Math.max(V, sink), ctx); return; }
        rec.ok = true;
        this.events.push({ t: 'touchdown', sink, speed: V });
        this.axes();
        this.u = Math.hypot(this.vel.x, this.vel.z);
        this.yaw = Math.atan2(this._fwd.x, this._fwd.z);
        this.theta = clamp(this.pitchDeg * D2R, 0, d.rotateAoA * D2R);
        // 甲板へは一度に下ろさない（地上の 1 歩が 8 m/s で下ろす。フックの先は車輪より下なので車輪はまだ少し上）
        this.pos.y = clamp(this.pos.y, this.ops.deckY, this.ops.deckY + 2.5);
        this.mode = 'ground'; this.grounded = true; this.airborne = false;
        this._syncFromGround();
      }
      const v0 = Math.max(5, this.u);
      this.arrest = { wire: k + 1, t: 0, v0, decel: v0 / d.arrestTime, hold: 0, yaw: Math.atan2(L.fx, L.fz), x0: this.pos.x, z0: this.pos.z };
      this.bolter = false;
      this.events.push({ t: 'arrest', wire: k + 1, speed: v0 });
      this._sound('arrest_catch', 1, this.center(this._v1), { refDistance: 15, maxDistance: 400, rate: clamp(1.85 / d.arrestTime, 0.8, 1.25), priority: 3 });
      if (ctx && typeof ctx.onImpact === 'function') ctx.onImpact(this, 8);
    }
    _arrestStep(h) {
      const A = this.arrest, d = this.def;
      A.t += h;
      if (this.u > 0) this.u = Math.max(0, this.u - A.decel * h);
      // ワイヤーが機首を着艦の向きへ引く
      this.yaw = wrap(this.yaw + clamp(wrap(A.yaw - this.yaw), -h * 0.5, h * 0.5));
      if (this.u <= 0) {
        A.hold += h;
        if (A.hold >= d.arrestHold) { this.arrest = null; this.hookDown = false; this.events.push({ t: 'arrest_done', dist: +Math.hypot(this.pos.x - A.x0, this.pos.z - A.z0).toFixed(1) }); }
      }
    }

    // カタパルト: align（位置合わせ）→ ready（全開を待つ）→ tension（溜め・音）→ stroke（端まで加速）
    _catStep(h, ctx) {
      const C = this.cat, d = this.def, c = C.c;
      C.t += h;
      if (C.ph === 'align') {
        const at = C.alignT || d.catAlignTime, k = smooth(0, 1, C.t / at);
        this.pos.x = C.from.x + (c.x - C.from.x) * k;
        this.pos.z = C.from.z + (c.z - C.from.z) * k;
        this.yaw = wrap(C.from.yaw + wrap(c.yaw * D2R - C.from.yaw) * k);
        this.launchBar = Math.min(1, C.t / at);
        this.u = 0;
        if (C.t >= at) { C.ph = 'ready'; C.t = 0; this.events.push({ t: 'cat_ready', cat: c.id }); }
        return;
      }
      if (C.ph === 'ready') {
        this.u = 0;
        if (this.driver && this.throttle >= d.catThrottle && this.n > 0.85) { C.hold += h; if (C.hold > 0.25) { C.ph = 'tension'; C.t = 0; this._catLaunchSound(); } }
        else C.hold = 0;
        // 外す: スティックを一度戻して（armed）から下の端へ deck.unhookHold 秒（止まるために下へ倒したままの手では外れない）
        const sy = this.ctl.manual ? (this.ctl.thrDown ? -1 : 0) : this.ctl.stickY;
        if (sy > d.deck.cancelStick) C.armed = true;
        if (this.driver && C.armed && !C.auto && sy < this.def.idleBrake) {
          C.off = (C.off || 0) + h;
          if (C.off > d.deck.unhookHold) { this.cat = null; this._catCool = d.deck.unhookCool; this.launchBar = 0; this.events.push({ t: 'cat_unhook', why: 'stick' }); }
        } else C.off = 0;
        return;
      }
      if (C.ph === 'tension') {
        this.u = 0;
        if (this.fx && Math.random() < h * 30) this._steam(c, Math.random() * 6);
        if (C.t >= d.catTension) { C.ph = 'stroke'; C.t = 0; C.s = 0; this.events.push({ t: 'cat_launch', cat: c.id }); }
        return;
      }
      // stroke: 一定の加速で甲板の端（length m）までに catSpeed
      const a = d.catSpeed * d.catSpeed / (2 * c.length);
      this.u = Math.min(d.catSpeed, this.u + a * h);
      C.s = (C.s || 0) + this.u * h;
      this.yaw = c.yaw * D2R;
      this.pos.x = c.x + c.fx * C.s; this.pos.z = c.z + c.fz * C.s;
      if (this.fx && Math.random() < h * 20) this._steam(c, Math.max(0, C.s - 4));
      if (C.s >= c.length - 0.1) {
        // 端: 空中へ。カタパルトはここで外れる
        this.cat = null;
        this.launchBar = 0;
        this.theta = 4 * D2R;
        this._toAir(1.5);
        this.events.push({ t: 'cat_end', speed: this.u, time: +(C.t).toFixed(2), yaw: c.yaw });
      } else this.theta = 0;
    }
    _steam(c, s) {
      if (!this.fx) return;
      const p = this._v3.set(c.x + c.fx * s + (Math.random() - 0.5) * 0.6, this.ops.deckY + 0.2, c.z + c.fz * s + (Math.random() - 0.5) * 0.6);
      if (typeof this.fx.steam === 'function') this.fx.steam(p, 1 + Math.random()); else if (this.fx.smoke) this.fx.smoke(p, 0.8);
    }
    _catLaunchSound() {
      const d = this.def;
      const stroke = 2 * this.cat.c.length / d.catSpeed;
      const rate = clamp(d.catSoundTime / (d.catTension + stroke), 0.85, 1.25);
      this._sound('catapult_launch', 1, this.center(this._v1), { refDistance: 15, maxDistance: 600, rate, priority: 3 });
    }

    // 脚・フック・キャノピー・フラップ・エアブレーキ、離陸の後に脚を自動で上げる
    _autoSystems(dt, ctx) {
      const d = this.def;
      // 速さの保護（_spdProt）が働いた: 着艦・着陸に並んでいなければ脚も上げる（脚を下ろしたまま遅く飛び続けると 85 m/s に届かず脚が上がらず、
      //  着陸の形のまま地面を避けなかった）
      const cleanUp = this._spdProt && !this._lined && !this.hookDown && this.agl > d.autoGearAgl;
      if (d.autoGear && this.mode === 'air' && this.gearDown && this.driver && this.agl > d.autoGearAgl && ((this.vel.y > 2 && this.speed > d.autoGearSpeed) || cleanUp) && !this._autoGearDone) {
        this._autoGearDone = true;
        this.toggleGear();
      }
      if (this.mode === 'ground') this._autoGearDone = false;
      // かんたん・自動着艦: 脚も自動（着艦・着陸の向きに並んで近く・低く・遅いと下ろす。離れる・速くなると上げる）
      if (this.mode === 'air') this._lineUp();
      if (this.mode === 'air' && this.driver && (this.ctl.easy || this.autoland)) {
        const E = d.easy, ap = this.autoland;
        //  （手で降りる: 並んで低く、下りていて、減速を押しているか gearSlow m/s より遅い。並んで飛んでいるだけでは下ろさない）
        const want = ap ? ap.gear : (this.gearDown ? !!this._lined : !!(this._lined && this.agl < E.gearAgl && this.vel.y < -0.5 && ((this.ctl.slow && this.speed < E.gearSpeed) || this.speed < E.gearSlow)));
        if (want && !this.gearDown) this.toggleGear();
        else if (!want && this.gearDown && this.agl > E.gearUpAgl && (ap || this.speed > E.gearUpSpeed || !this._lined)) this.toggleGear();
      }
      // ミサイル・フレア: 空中でも少しずつ補給（missile.reloadTime / flares.reloadTime 秒に 1 発）
      if (this.missileCount < d.missile.count) { this._missileT += dt; if (this._missileT >= d.missile.reloadTime) { this._missileT = 0; this.missileCount++; this._storesShow(); } } else this._missileT = 0;
      if (this.flareCount < d.flares.count) { this._flareT += dt; if (this._flareT >= d.flares.reloadTime) { this._flareT = 0; this.flareCount++; } } else this._flareT = 0;
      this.flaps += clamp((this.gearDown || this.speed < 90 ? 1 : 0) - this.flaps, -dt, dt);
      this.airbrake += clamp((this.cmd.airbrake ? 1 : 0) - this.airbrake, -dt * 2, dt * 2);
    }

    // ---------- 見た目・音 ----------

    _animate(dt, force) {
      const d = this.def;
      const step = (cur, target, time) => cur + clamp(target - cur, -dt / time, dt / time);
      this.gearPos = force ? (this.gearDown ? 1 : 0) : step(this.gearPos, this.gearDown ? 1 : 0, d.gearTime);
      this.canopyPos = force ? (this.canopyOpen ? 1 : 0) : step(this.canopyPos, this.canopyOpen ? 1 : 0, d.canopyTime);
      this.hookPos = force ? (this.hookDown ? 1 : 0) : step(this.hookPos, this.hookDown ? 1 : 0, d.hookTime);
      if (!this.cat && this.launchBar > 0 && !force) this.launchBar = Math.max(0, this.launchBar - dt);
      // 脚（GLB はクリップの時間、コードの機体は回転）
      const gt = (1 - this.gearPos) * (this.gearClipLen || 1.5);
      if (this.gearAction && this.mixer) {
        if (Math.abs(gt - this._gearT) > 1e-4) {
          this.gearAction.time = gt; this.mixer.update(0); this._gearT = gt;
          const inner = this.gearPos > 0.01;
          for (const n of this._gearInner) n.visible = inner;
        }
      } else if (this.gearNodes) {
        const k = 1 - this.gearPos;
        for (const gn of this.gearNodes) {
          if (gn.name === 'gear_nose') gn.rotation.x = -k * 1.62;
          else gn.rotation.z = (gn.name === 'gear_main_l' ? -1 : 1) * k * 1.5;
          gn.visible = this.gearPos > 0.03;
        }
      }
      // 動翼
      const c = this.cmd, H = this.hinges;
      const air = this.mode === 'air';
      const pitchIn = air ? clamp((c.n - 1) / (this.def.gLimit - 1), -1, 1) : (c.pitchUp ? 0.6 : 0);
      const rollIn = air ? clamp(c.p / (this.def.rollRate * D2R), -1, 1) : 0;
      const yawIn = air ? c.rud : clamp(c.steer, -1, 1) * 0.5;
      const set = (name, deg) => {
        const h = H[name];
        if (!h) return;
        const v = clamp(deg, h.min, h.max);
        if (Math.abs(v - h.last) < 0.05) return;
        h.last = v;
        h.node.quaternion.setFromAxisAngle(h.axis, v * D2R);
      };
      set('stab_l', -pitchIn * 18 + rollIn * 5); set('stab_r', -pitchIn * 18 - rollIn * 5);
      set('aileron_l', rollIn * 25 + this.flaps * 10); set('aileron_r', -rollIn * 25 + this.flaps * 10);
      set('flap_l', this.flaps * 30); set('flap_r', this.flaps * 30);
      set('rudder_l', -yawIn * 25); set('rudder_r', -yawIn * 25);
      set('airbrake', this.airbrake * 50);
      set('canopy', this.canopyPos * 38);
      set('hook', this.hookPos * 76.8);
      set('launch_bar', this.launchBar * 86.7);
      // 車輪（地上で転がる・前輪は向く）
      if (this.wheelNodes) {
        const roll = this.mode === 'ground' ? this.u : 0;
        for (const w of this.wheelNodes) {
          const r = w.nose ? d.noseWheelRadius : d.wheelRadius;
          w.spin = (w.spin + roll / r * dt) % (Math.PI * 2);
          this._e.set(w.spin, w.nose ? -this.steer : 0, 0, 'YXZ');
          w.node.quaternion.copy(w.q0).multiply(this._dq.setFromEuler(this._e));
        }
      }
      // アフターバーナー（炎の長さ・揺らぎ）と光
      const ab = this.wrecked ? 0 : this.ab;
      if (this._plumes) {
        const fl = 0.85 + 0.15 * Math.sin(this.time * 47) * Math.sin(this.time * 31 + 1);
        for (const pl of this._plumes) {
          pl.group.visible = ab > 0.03;
          if (!pl.group.visible) continue;
          pl.outer.scale.set(1, 1, (2.5 + 4 * ab) * fl);
          pl.inner.scale.set(1, 1, (1.2 + 2.2 * ab) * fl);
          pl.core.material.opacity = 0.9 * ab;
        }
      }
      if (this.abLight) {
        this.abLight.intensity = ab > 0.03 ? ab * (2.2 + Math.random() * 0.8) : 0;
        if (ab > 0.03) this.abLight.position.copy(this.toWorld(this._v1.set(0, 2.2, -8), this._v2));
      }
      // 航法灯（エンジンが掛かっているとき。衝突防止灯は 1 秒に 1 回）
      if (this._lights) {
        const on = this.engineOn && !this.wrecked && !this.sinking;
        const flash = (this.time % 1.0) < 0.1;
        for (let i = 0; i < this._lights.length; i++) this._lights[i].visible = on && (i < 3 || flash);
      }
      if (this.mixer && force) this.mixer.update(0);
      // 影: 地面から shadowAgl m より上では落とさない（影の地図はカメラの周り 60 m だけ = 高い所の機体の影はどこにも映らず、描く回数だけかかる）
      const sa = d.shadowAgl == null ? 25 : d.shadowAgl;
      const cast = this.mode === 'ground' || (this._casting === false ? this.agl < sa : this.agl < sa + 5);
      if (cast !== this._casting) this._setCast(cast);
    }
    _setCast(on) {
      this._casting = on;
      if (!this.model) return;
      this.model.traverse((o) => { if (o.isMesh && !o.userData.jetGlass && !(o.parent && /_plume$/.test(o.parent.name))) o.castShadow = on; });
    }

    // 飛んでいくキャノピー・座席
    _updateDebris(dt) {
      const j = this._jettisoned;
      if (j && j.node.parent === this.scene) {
        j.t += dt;
        j.vel.y -= G * dt;
        j.vel.multiplyScalar(Math.max(0, 1 - dt * 0.6));
        j.node.position.addScaledVector(j.vel, dt);
        j.node.rotation.x += j.spin.x * dt; j.node.rotation.y += j.spin.y * dt;
        if (j.t > 6 || j.node.position.y < -5) j.node.visible = false;
        // 地上で射出した（機体は止まったまま）: 飛んだキャノピーが消えたら新しいキャノピーを付ける（開けて。また止めてある姿勢になれる）
        if (j.t > 6 && this.mode === 'ground' && !this.wrecked && !this.sinking && !this.driver && Math.abs(this.u) < 0.5) {
          this._restoreCanopy();
          this.canopyOpen = true; this.canopyPos = 1;
        }
      }
      const s = this._seatMesh;
      if (s) {
        s.t += dt;
        s.vel.y -= (s.t < 0.6 ? -2 : G) * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        if (s.t > 0.6) { s.mesh.rotation.x += dt * 3; s.vel.multiplyScalar(Math.max(0, 1 - dt * 0.5)); }
        if (s.t > 7) { if (s.mesh.parent) s.mesh.parent.remove(s.mesh); this._seatMesh = null; }
      }
    }

    // 翼の下のミサイル（GLB の aim9x_l / aim9x_r / aim120_l / aim120_r。コードの機体には無い）: 残りの数だけ見せる
    _storesShow() {
      if (!this.model) return;
      const names = ['aim9x_l', 'aim9x_r', 'aim120_l', 'aim120_r'];
      if (!this._stores) this._stores = names.map((n) => this.model.getObjectByName(n) || null);
      for (let i = 0; i < this._stores.length; i++) if (this._stores[i]) this._stores[i].visible = i < this.missileCount;
    }
    // ミサイルを 1 発使う（game.js の MR.Missiles が飛ばす）。発射位置（翼の下。世界）か、無ければ null
    takeMissile(out) {
      if (this.missileCount <= 0 || this.wrecked) return null;
      this.missileCount--;
      const i = this.missileCount;
      if (this._stores && this._stores[i]) { this._stores[i].getWorldPosition(out); } else this.toWorld(this._v1.set(i % 2 ? -3.2 : 3.2, 1.7, 0.5), out);
      this._storesShow();
      this._missileT = 0;
      return out;
    }
    // フレアを n 発使う。使えた数
    takeFlares(n) { const k = Math.min(n, this.flareCount); this.flareCount -= k; return k; }

    _apply() {
      if (!this.root || !this.quat) return;
      this.root.position.copy(this.pos);
      this.root.quaternion.copy(this.quat);
    }

    _engineAudio(dt) {
      const a = this.audio;
      if (!a) return;
      if (!this.engineOn || this.spin <= 0.01 || this.wrecked || this.sinking) { this._stopEngine(); return; }
      if (!this.engine && typeof a.jet === 'function') {
        try { this.engine = a.jet(this.center(this._v1)); } catch (e) { this.engine = null; }
      }
      if (!this.engine) return;
      const inside = !!(this.localInside && this.listenerPos);
      const wind = inside && this.mode === 'air' ? clamp(this.speed / this.def.maxSpeed, 0, 1) : 0;
      this.engine.set(this.n, this.ab, wind, this.spin, inside && this.cockpit);
      this.engine.setPosition(inside ? this.listenerPos : this._v1.copy(this.p));
      // 自分が乗っていない機体が速く近くを通る: フライバイ
      this.flybyT -= dt;
      if (!this.localInside && this.mode === 'air' && this.speed > 80 && this.flybyT <= 0 && a.listenerPosition) {
        const L = a.listenerPosition();
        if (L) {
          const rx = L.x - this.p.x, ry = L.y - this.p.y, rz = L.z - this.p.z;
          const v = this.vel, vv = v.lengthSq();
          const tc = (rx * v.x + ry * v.y + rz * v.z) / vv; // いちばん近づくまでの秒
          if (tc > 0 && tc < 1.6) {
            const cx = rx - v.x * tc, cy = ry - v.y * tc, cz = rz - v.z * tc;
            if (Math.hypot(cx, cy, cz) < this.def.flybyRange) {
              this.flybyT = 4;
              this._sound('jet_flyby', 1, null, { delay: Math.max(0, tc - 1.57), priority: 2 });
            }
          }
        }
      }
    }
    _stopEngine() {
      if (this.engine) { try { this.engine.stop(); } catch (e) { /* ignore */ } }
      this.engine = null;
      this.rpm = 0;
    }

    // ---------- オンライン（フェーズ E4）----------
    netState() {
      const r = (v) => Math.round(v * 100) / 100, q = this.quat;
      return {
        p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], q: [r(q.x * 100) / 100, r(q.y * 100) / 100, r(q.z * 100) / 100, r(q.w * 100) / 100],
        v: [r(this.vel.x), r(this.vel.y), r(this.vel.z)], thr: r(this.throttle), ab: r(this.ab), gear: this.gearDown ? 1 : 0, hook: this.hookDown ? 1 : 0,
        canopy: this.canopyOpen ? 1 : 0, hp: Math.round(this.health), mode: this.mode === 'air' ? 1 : 0,
        // かんたん・200 G（E4 で同期）: G・G の上限・自動着艦の段階・ミサイルとフレアの残り
        g: r(this.gload), ga: r(this.gAuth), ap: this.autoland ? (this.autoland.phase || 'start') : null, msl: this.missileCount, flr: this.flareCount,
        seats: this.occupants.slice(0, this.seatCount).map((o) => (o ? (o.remote ? o.id : -1) : null))
      };
    }

    dispose() {
      this._dropParked();
      super.dispose();
      this._restoreCanopy();
      if (this._seatMesh && this._seatMesh.mesh.parent) this._seatMesh.mesh.parent.remove(this._seatMesh.mesh);
      this._seatMesh = null;
      if (this.abLight) { this.abLight.intensity = 0; this.abLight = null; }
      if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
      for (const m of this._ownMats || []) m.dispose();
      this._ownMats = [];
    }
  }

  Jet.DEFAULTS = DEFAULTS;
  Jet.parkedStats = { built: 0 };
  Jet._parkedCache = PARKED;
  Jet.HULL = HULL;
  Jet.BOXES = BOXES;
  Jet.HINGES = HINGES;
  MR.Jet = Jet;
})();
