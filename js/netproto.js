// オンライン対戦のプロトコル（クライアントとサーバーで共有する）。THREE に依存しない素の JS。
//   ブラウザ: <script> で読む → MR.NetProto
//   Node / Cloudflare Worker: require('../www/js/netproto.js') / import でも動く（globalThis.MR.NetProto に入る）
//
// 方式: サーバー（部屋ごとに 1 つ。Node の ws か Cloudflare Durable Object）が中継 + 判定する。
//   - 位置・向きはクライアントが持つ（client-authoritative）。サーバーは速度の上限・壁の通り抜け・高さ（空中にいられる時間）を確かめる。
//   - 命中判定は撃った側のクライアントがする（自分の画面で当たったものが当たる）。サーバーは
//     連射速度・弾倉・ダメージ上限・射程・視線（地図の箱）・撃った向きを確かめてから HP を減らす（HP・撃破・復活はサーバーが持つ）。
//   - 乗り物は運転している人のクライアントが物理を計算して送る。所有権（誰が運転中か・座席）と HP はサーバーが持つ。
//   - 街（city_*）はさらに: 落ちている物・持ち物（武器・弾・回復・防具）・回復・安全地帯 / 試合範囲・落下ダメージ・ラウンド（バトロワ）も
//     サーバーが持つ。クライアントは自分で落下ダメージ・安全地帯のダメージを入れない（damage が来る）。
//   - 通信は JSON テキスト。座標は 1 cm、角度は 0.001 rad に丸める（q() / qa()）。
//
// ■ VERSION 2（街のオンライン。VERSION 1 のクライアントは error version で入れない）
// ■ モード（部屋の名前の一部）: 接続先は ws(s)://<server>/room/<部屋名>?mode=<モード>（無ければ arena）。
//   サーバーの部屋は「モード:部屋名」ごと（Worker は idFromName(mode + ':' + 名前)、Node 版も同じキー）。
//   arena       … arena01 のデスマッチ（VERSION 1 と同じ動き。下の「街だけ」の項目は無い）
//   city_dm     … midtown の個人戦。試合範囲（area: ホットゾーンの周り半径 online.city.areaRadius）の外は毎秒ダメージ。
//                 online.city.rotateMinutes ごとに次のホットゾーンへ移る（rotateWarning 秒前に area の next で予告、移るときは
//                 全員を新しい範囲に spawn し直す。持ち物はそのまま）。死んだら RESPAWN 後に範囲の中で復活（持ち物は最初の物に戻る）
//   city_royale … midtown のバトルロイヤル（1 回だけの命）。round の ph: lobby（待つ。ダメージ・拾う・乗り物なし）→ countdown
//                 （minPlayers 人以上で countdown 秒。満員ならすぐ）→ drop（輸送ヘリ。各自 jump で降りる。航路の終わりで強制）→ play
//                 → end（生き残り 1 人以下。result を resultTime 秒）→ 新しい lobby（新しい seed・落ちている物と乗り物は最初から）。
//                 途中から来た人は spec（見るだけ）で次のラウンドを待つ。死んだ人は dead（見るだけ）
//
// メッセージ（t が種類）。「C→S」はクライアントからサーバー、「S→C」はサーバーからクライアント。「街」は city_* だけのもの。
//   C→S hello    { t, v: VERSION, mode?, name, weapon, rt? }      接続直後に 1 回。mode は URL と同じ（違えば error mode）。
//                rt は前の welcome の再開トークン（再接続のとき）
//   C→S state    { t, s: seq, p: [x,y,z], yaw, pitch, mv: 0 停止|1 歩き|2 走り, ads: 0|1, w: 武器 id, veh: 乗り物番号 or -1, gr: 0|1 接地,
//                  m?: 動き（街。MOVE: 0 歩く・跳ぶ・落ちる / 1 梯子 / 2 泳ぐ / 3 乗り越え・よじ登り・梯子の上り切り / 4 自由落下 / 5 パラシュート）,
//                  seat?: 乗っている席（街。0 = 運転席・操縦席） }
//                送信は STATE_HZ（15 回/秒）。死んでいる間は送らない。p は足元（乗車中は座席の目 − eyeHeight）
//   C→S fire     { t, n, w, o: [x,y,z], d: [[dx,dy,dz], ...] }           撃った（他の人の画面に弾道と銃声を出す）。弾ごとの向き（散弾は複数）
//   C→S hit      { t, n, target: 相手 id, w, dmg, head: 0|1, o: [x,y,z], pt: [x,y,z] }
//                自分の弾が相手に当たった。o は撃った位置（目）、pt は当たった点
//                n は射撃の通し番号（1 回引き金を引くごとに +1）。同じ n の fire / hit / vhit は同じ射撃（散弾の弾はまとめて数える）。
//                hit / vhit は同じ n の fire が先に通っていないと数えない。
//                街: w は持っている武器だけ（拾った物。最初はピストル）。弾は口径ごとに数える（撃ち切ったら撃てない）。ヘリの操縦席は撃てない
//   C→S enter    { t, i, seat? }  乗り物 i に乗りたい（arena: 運転席だけ。サーバーが vowner で許可）。
//                街: seat = 座る席（省略 = 運転席が空いていれば運転席、無ければ空いている席）。乗っている車の別の席への enter は席替え。
//                結果は vseat（全員）と、運転席なら vowner
//   C→S exit     { t, i, p: [x,z]（arena）| [x,y,z]（街）, yaw }      降りる位置（サーバーが確かめる。空中のヘリからは飛び降り）
//   C→S vstate   { t, i, p: [x,z]（arena）| [x,y,z]（街）, yaw, sp: 速度 m/s, st: 舵角 rad,
//                  pitch?, roll?（街: 車体の傾き rad）, rpm?, col?（ヘリ: 回転数 0..1・上下の入力 -1..1）, vy?（街: 上下の速さ m/s） }
//                運転手・操縦士だけ、STATE_HZ で（はねたときは runover の直前にも）
//   C→S vhit     { t, n, i, w, dmg, o: [x,y,z] }                         乗り物を撃った
//   C→S runover  { t, target, i }                                         乗り物で相手をはねた
//   C→S respawn  { t }                                                    死亡後、RESPAWN_DELAY 経過後に送る（city_royale では使えない）
//   C→S ping     { t, c: クライアント時刻 ms }
//   C→S pickup   { t, id, n?, swap? }   街: 落ちている物 id を拾う。n = 取る数（弾・回復。省略で入るだけ全部）。
//                swap = { w, ammo }: 武器の枠がいっぱい（メイン 2 つ / サブ 1 つ）のとき手放す武器と装填数（サーバーが足元に落とす）。
//                結果は picked（全員。by が自分でなければ取れなかった）と inv（自分）。防具は今のより良いときだけ（古い方はサーバーが落とす）
//   C→S heal     { t, item: 'medkit'|'bandage' } | { t, cancel: 1 }   街: 回復を始める / やめる。終わりの時刻にサーバーが HP を足す
//                （撃つ・跳ぶ・乗る・持ち替える・梯子 / 泳ぐ / 乗り越え / 降下・死ぬと中止。物は減らない。撃たれても続く）
//   C→S jump     { t, p: [x,y,z] }      city_royale: 輸送ヘリから飛び降りる（p = 今の自分の位置。航路の上で今の時刻の近く）
//   C→S b        { t, m: [メッセージ, …] }  束ね（BUNDLE_MAX 通まで。hello と b は入れられない）。中身は 1 通ずつ届いたのと同じに扱う
//                （state・fire・hit を 1 フレームにまとめると Cloudflare のリクエスト数が減る）
//
//   S→C welcome  { t, id, room, v, mode, level, now: サーバー時刻 ms, rt: 再開トークン, players: [PlayerInfo], vehicles: [VehicleInfo],
//                  cfg: { maxPlayers, respawnDelay, stateHz },
//                  街: seed（部屋 / ラウンドの seed）, lseed（落ちている物の種類の seed: Loot.choose）, vset（乗り物の範囲。下）,
//                      loot: { st: [[id, gone 0|1, qty?, ammo?, dur?], …]（最初と違う地図の物）, drops: [Drop] }, inv: Inv（自分）,
//                      area?（city_dm: area と同じ中身）, round?（city_royale: round と同じ中身） }
//                再接続で hello に rt を付けると、同じ人（id・撃破数・死亡数）として続きから入れる
//   S→C join     { t, player: PlayerInfo }       S→C leave { t, id }
//   S→C snap     { t, now, pl: [[id, x, y, z, yaw, pitch, mv, ads, w, veh, gr, ack(, m, seat)], ...], vh: [[i, x, z, yaw, sp, st, driver(, y, pitch, roll, rpm)], ...] }
//                SNAP_HZ（15 回/秒）。pl は生きている人、vh は動いている（運転中・直近に動いた）乗り物。
//                ack はその人の state のうちサーバーが最後に処理した s（通ったかどうかは位置で分かる）。
//                街: 行の後ろに ( ) の項目が付く。受け取る人ごとに近い人・乗り物だけ（online.city.interest m、空中は interestAir m）。
//                自分の行は必ず入る。死んでいる人・見ている人には全員
//   S→C fire     { t, id, w, o, d }               他の人が撃った（自分の分は来ない。街は fireRange m 以内の人だけ）
//   S→C damage   { t, target, attacker, dmg, hp, head, w, kind?, ar? }  kind（街）: gun | explosion | vehicle | fall | zone。
//                ar（街）: 受けた人の防具の残り [ベスト, ヘルメット]（防具の分はサーバーが引いてある）
//   S→C kill     { t, target, attacker, w, head, kills, deaths, by: 'gun'|'vehicle'|'explosion'|'fall'|'zone', rank? }
//                attacker の kills / target の deaths。rank（city_royale）= 倒れた人の順位
//   S→C spawn    { t, id, p: [x,z]（arena）| [x,y,z]（街）, yaw, hp, inv? }  復活（自分の場合はそこへ移動）。再開した本人にだけ、
//                今の位置と HP でも来る。inv は本人あてのとき（持ち物が最初に戻った）
//   S→C vowner   { t, i, id }                     乗り物 i の運転手（id = -1 は空き）。enter が通らなければ自分の id にならない
//   S→C vseat    { t, i, occ: [id or -1, …] }     街: 乗り物 i の席ごとの人（0 = 運転席・操縦席）
//   S→C vdamage  { t, i, hp }                     S→C vexplode { t, i, attacker, p?, how?: 'sunk' }（街: p = 場所、sunk = 沈んだ）
//   S→C vrespawn { t, i, p: [x,z]（arena）| [x,y,z]（街）, yaw, hp }
//   S→C pong     { t, c, s: サーバー時刻 ms }
//   S→C error    { t, code: 'full'|'version'|'bad'|'rate'|'busy'|'mode', msg }
//   S→C picked   { t, id, by, n, left }           街: by が id の物を n 個拾った。left = 残りの数（0 = 無くなった）
//   S→C loot     { t, add?: [Drop], gone?: [id], back?: [id], reset?: 1, lseed? }
//                街: add = サーバーが落とした物（死んだ人の持ち物・入れ替えた武器・防具。id は "s<n>"）、gone = 消えた落とし物、
//                back = 元に戻った地図の物（取られてから loot.respawnSec 秒。city_royale は戻らない）、reset = 全部最初に戻す（city_royale の drop の始まりと新しい lobby。
//                lseed = 新しい落ちている物の seed: Loot.World を作り直し、落とし物も消す）
//   S→C inv      { t, inv: Inv }                  街: サーバーの数えている自分の持ち物（拾った・撃った・回復・死んだ後）
//   S→C heal     { t, id, item, st: 'start'|'done'|'cancel', end?, hp? }  街: start（end = 終わるサーバー時刻）/ cancel は本人だけ、
//                done（hp = 回復後）は全員
//   S→C area     { t, x, z, r, dps, zone, at, until, next?: { x, z, r, zone, at }, vset }  city_dm: 試合範囲（zone = ホットゾーンの id、
//                at = この範囲になったサーバー ms、until = 次へ移るサーバー ms）。next = 次の範囲と移る時刻（予告。rotateWarning 秒前）
//   S→C round    { t, ph: 'lobby'|'countdown'|'drop'|'play'|'end', n: ラウンドの番号, seed, lseed, t0: その段階の始まり（サーバー ms）,
//                  t1?: 終わり（countdown の終わり・end の終わり）, alive, total, min, zone?: { z0: 安全地帯の時計の 0（サーバー ms）,
//                  phases: [{ wait, shrink, r, dps }], circles: [[x,z,r], …] }, flight?: { x0, z0, x1, z1, len, dx, dz, y, speed, t0 } }
//                city_royale: 段階が変わるたび（と welcome）。安全地帯は MR.Royale.zoneAt({ phases, circles }, (now − z0) / 1000) で決まる。
//                輸送ヘリは flight.t0 に (x0, z0) を出て (dx, dz) へ speed m/s、高さ y。ph が lobby になったら落ちている物と乗り物は最初から
//   S→C jumped   { t, id, p: [x,y,z], forced? }  city_royale: id が輸送ヘリから降りた（forced = 航路の終わりで降ろされた）
//   S→C result   { t, winner: id or -1, ranks: [[id, rank, kills], …], next: 次の lobby のサーバー ms }
//   PlayerInfo  = { id, name, hp, kills, deaths, alive: 0|1, w, st?（city_royale: lobby|plane|air|alive|dead|spec）, ar?: [ベスト, ヘルメット] }
//   VehicleInfo = { i, type, p: [x,z], yaw, hp, driver: id or -1, wrecked: 0|1 }（arena）
//               = { i, id, type, p: [x,y,z], yaw, pitch, roll, hp, driver, occ: [id or -1, …], wrecked, rpm }（街。i = city.vehicleSpawns() の番号、
//                 id = その id（'v12' / 'h_h_gct'））。街の welcome の vehicles は最初と違う（動いた・傷ついた・乗っている・壊れた）物だけで、
//                 ほかは vehicleSpawns() の位置（yaw は度）・満タンの HP のまま。vset = { all: 1 }（全部）か { x, z, r }（中心がこの円の中の物だけ）
//   Drop        = { id, type, x, y, z, qty, ammo?, dur? }（Loot.ITEMS の種類）
//   Inv         = { w: [武器 id, …]（最大 3: メイン 2 + サブ 1。順番に意味は無い）, ammo: { 口径: 弾の数（装填数を含む） }, meds: { medkit, bandage },
//                 vest: 耐久 or 0, helmet: 耐久 or 0 }
// 大きさ: クライアント → サーバーは 1 通 MAX_MESSAGE 文字まで。サーバー → クライアント（welcome / snap は人数・乗り物の数で
//   大きくなる）は MAX_SERVER_MESSAGE まで受け付ける
(function (root) {
  const MR = root.MR || (root.MR = {});

  const VERSION = 2;
  const STATE_HZ = 15;          // クライアントが state / vstate を送る回数（毎秒）
  const SNAP_HZ = 15;           // サーバーが snap を送る回数（毎秒）
  const INTERP_DELAY = 0.12;    // 他プレイヤーを何秒遅れで描くか（スナップショット補間）の最小値。届き方が揺れると net.js が広げる
  const MAX_INTERP_DELAY = 0.4; // 同じく最大値（秒）
  const MAX_EXTRAPOLATE = 0.15; // 最後のスナップショットより先を何秒まで外挿するか
  const MAX_PLAYERS = 8;
  const MAX_MESSAGE = 4096;     // クライアントから受け付ける 1 メッセージの最大長（文字。束ね b を含む）
  const MAX_SERVER_MESSAGE = 262144; // サーバーから受け付ける 1 メッセージの最大長（welcome / snap は人数・乗り物・落ちている物の数で大きくなる）
  const MAX_SPEED = 9;          // 歩き・走りの速度上限（m/s、余裕込み）。これを大きく超える瞬間移動は無視する
  const MAX_VEHICLE_SPEED = 32; // 乗り物の速度上限（m/s、余裕込み）
  const MAX_HELI_SPEED = 56;    // ヘリの水平の速度上限（m/s、余裕込み。vehicles.types.heli.maxSpeed 45 × 1.15 + 3 まで）
  const BUNDLE_MAX = 8;         // 束ね（b）に入れられるメッセージの数
  const RESPAWN_DELAY = 3;      // 秒
  const HEADSHOT_MULT = 2;      // config.enemies.headshotMultiplier と同じ既定値（サーバーは config を見る）
  const NAME_MAX = 16;

  const C2S = ['hello', 'state', 'fire', 'hit', 'enter', 'exit', 'vstate', 'vhit', 'runover', 'respawn', 'ping', 'pickup', 'heal', 'jump', 'b'];
  const S2C = ['welcome', 'join', 'leave', 'snap', 'fire', 'damage', 'kill', 'spawn', 'vowner', 'vdamage', 'vexplode', 'vrespawn', 'pong', 'error',
    'vseat', 'picked', 'loot', 'inv', 'heal', 'area', 'round', 'jumped', 'result'];
  // モード（部屋の名前の一部）と、state の m（動き）
  const MODES = ['arena', 'city_dm', 'city_royale'];
  const MOVE = { WALK: 0, LADDER: 1, SWIM: 2, VAULT: 3, FALL: 4, CHUTE: 5 };

  // 丸め（通信量を減らす）
  const q = (v) => Math.round(v * 100) / 100;      // 1 cm
  const qa = (v) => Math.round(v * 1000) / 1000;   // 0.001 rad
  const qv = (a) => [q(a[0]), q(a[1]), q(a[2])];
  const qd = (a) => [qa(a[0]), qa(a[1]), qa(a[2])];

  function encode(msg) { return JSON.stringify(msg); }

  // 文字列 → オブジェクト。壊れている・大きすぎる（maxLen 文字、既定 MAX_MESSAGE）・t が無いものは null
  function decode(data, allowed, maxLen) {
    if (typeof data !== 'string' || data.length > (maxLen || MAX_MESSAGE)) return null;
    let m;
    try { m = JSON.parse(data); } catch (e) { return null; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
    if (allowed && allowed.indexOf(m.t) < 0) return null;
    return m;
  }

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isVec = (a, n) => Array.isArray(a) && a.length === n && a.every(isNum);

  // 名前: 制御文字を除き、前後の空白を落として NAME_MAX 文字まで。空なら null
  function cleanName(name) {
    if (typeof name !== 'string') return null;
    const s = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX);
    return s || null;
  }

  // 自由入力の名前は使わない（App Store のユーザー生成コンテンツ規約を避けるため）。プリセットのコールサイン + 番号
  const CALLSIGNS = ['Falcon', 'Viper', 'Ghost', 'Raven', 'Cobra', 'Wolf', 'Hawk', 'Shadow', 'Blaze', 'Storm', 'Fox', 'Titan', 'Echo', 'Nova', 'Bolt', 'Rogue'];
  function randomName(rnd) {
    const r = rnd || Math.random;
    return CALLSIGNS[Math.floor(r() * CALLSIGNS.length)] + '-' + String(Math.floor(r() * 90) + 10);
  }

  // 部屋名: 英数字と - _ のみ、1〜24 文字。それ以外は 'public'
  function cleanRoom(room) {
    const s = String(room || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    return s || 'public';
  }

  // モード: MODES のどれか（違えば null。省略は 'arena'）
  function cleanMode(mode) {
    if (mode == null || mode === '') return 'arena';
    const s = String(mode).toLowerCase();
    return MODES.indexOf(s) >= 0 ? s : null;
  }
  const isCity = (mode) => mode === 'city_dm' || mode === 'city_royale';

  // 落下ダメージ（game.js の _onLand と同じ式。fd = config.player.fallDamage）: 落差 drop m が minHeight を超えた分 ×
  // perMeter + 超えた分² × curve。街のオンラインではサーバーがこれで計算する
  function fallDamage(drop, fd) {
    fd = fd || {};
    const over = drop - (isNum(fd.minHeight) ? fd.minHeight : 6);
    if (!(over > 0)) return 0;
    return (isNum(fd.perMeter) ? fd.perMeter : 5) * over + (isNum(fd.curve) ? fd.curve : 0.4) * over * over;
  }

  // 撃った側が報告した命中がもっともらしいか（サーバーが使う）。
  //   def: config.weapons の 1 つ、rep: hit メッセージ、opts: { headMult, now, lastShots: 時刻(ms)の配列, nav, slack }
  //   戻り値 { ok, dmg, reason }
  function checkHit(def, rep, opts) {
    opts = opts || {};
    if (!def) return { ok: false, reason: 'weapon' };
    if (!isNum(rep.dmg) || rep.dmg <= 0) return { ok: false, reason: 'dmg' };
    if (!isVec(rep.o, 3) || !isVec(rep.pt, 3)) return { ok: false, reason: 'vec' };
    const headMult = isNum(opts.headMult) ? opts.headMult : HEADSHOT_MULT;
    const pellets = Math.max(1, def.pellets || 1);
    const maxDmg = (def.damage || 0) * (rep.head ? headMult : 1) * pellets * 1.001;
    if (rep.dmg > maxDmg) return { ok: false, reason: 'too much damage' };
    const dx = rep.pt[0] - rep.o[0], dy = rep.pt[1] - rep.o[1], dz = rep.pt[2] - rep.o[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > (def.range || 100) + (opts.slack || 3)) return { ok: false, reason: 'range' };
    if (opts.nav && dist > 0.5 && typeof opts.nav.lineOfSight === 'function') {
      // 当たった点の少し手前まで（相手の体の表面で箱に触れていても通す）
      const k = Math.max(0, (dist - 0.6) / dist);
      if (!opts.nav.lineOfSight(rep.o[0], rep.o[1], rep.o[2], rep.o[0] + dx * k, rep.o[1] + dy * k, rep.o[2] + dz * k)) return { ok: false, reason: 'wall' };
    }
    return { ok: true, dmg: rep.dmg };
  }

  // 連射速度の確認（サーバーが使う）。トークンバケツで、単位は「撃っていられる秒数」:
  //   1 射撃（fire / hit の n ごとに 1 回）で 1 / fireRate 秒ぶん使い、実時間 × factor（既定 1.15）で貯まる。
  //   上限は burst 秒（既定 0.6）+ 1 射撃ぶん。
  //   - 届く時刻で測るが、携帯回線で数通まとめて届いても burst 秒ぶんまでは落とさない（届く間隔の揺れは数えない）
  //   - 武器を持ち替えても同じ 1 つのバケツなので、何丁も回して速く撃つことはできない
  //   st: 呼ぶ側が人ごとに持つ状態 {}（tok / at を書き込む）、now: ms、opts: { burst, factor }。戻り値 true = 許可（使った）
  function allowShot(def, st, now, opts) {
    opts = opts || {};
    const rate = Math.max(0.5, (def && def.fireRate) || 10);
    const cost = 1 / rate;
    const burst = isNum(opts.burst) ? opts.burst : 0.6;
    const factor = isNum(opts.factor) ? opts.factor : 1.15;
    const cap = burst + cost;
    if (!isNum(st.at) || !isNum(st.tok)) { st.at = now; st.tok = cap; }
    const gap = Math.max(0, (now - st.at) / 1000);
    st.at = Math.max(st.at, now);
    st.tok = Math.min(cap, st.tok + gap * factor);
    if (st.tok + 1e-9 < cost) return false;
    st.tok -= cost;
    return true;
  }

  // 位置の更新がもっともらしいか（瞬間移動の検出）。dt 秒で dist m 動いた
  function plausibleMove(dist, dt, inVehicle) {
    const vmax = inVehicle ? MAX_VEHICLE_SPEED : MAX_SPEED;
    return dist <= vmax * Math.max(dt, 0.05) * 1.5 + 1.0;
  }

  MR.NetProto = {
    VERSION, STATE_HZ, SNAP_HZ, INTERP_DELAY, MAX_INTERP_DELAY, MAX_EXTRAPOLATE, MAX_PLAYERS, MAX_MESSAGE, MAX_SERVER_MESSAGE,
    MAX_SPEED, MAX_VEHICLE_SPEED, MAX_HELI_SPEED, BUNDLE_MAX, RESPAWN_DELAY, HEADSHOT_MULT, NAME_MAX, C2S, S2C, CALLSIGNS, MODES, MOVE,
    q, qa, qv, qd, encode, decode, isNum, isVec, cleanName, cleanRoom, cleanMode, isCity, randomName, checkHit, allowShot, plausibleMove, fallDamage
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MR.NetProto;
})(typeof window !== 'undefined' ? window : globalThis);
