// 天気の見た目（MR.WeatherView）。数は weather.js（MR.Weather）、ここは THREE 側。game.js が天気のあるゲーム（街のソロ）のときだけ作る
//   （天気がオフ = これを作らない = 今までと同じ描画・プログラム・ドローコール）。
//
// ■ M1: 雲と霞のドーム・空 / 太陽 / 半球光 / 霧の色（sky.applyWeather）・露出・ビューシーンの光・
//   環境マップの強さ（materials.setEnvScale、2 Hz まで）・川の空の映り込み（water.js の WEATHER）・遠景のガラスの空の色・
//   変わった知らせ（hud.showWeather）。霧の距離と描画距離は game.js（_updateCity の高さの表の後）。
// ■ M2: 雨（1 回の描画）・水しぶき（1 回、出ている間だけ）・川の波紋（water.js の uRain）・濡れた外の地面（materials.getWet の uWet / uPuddle、
//   陸と遠景も）・室内（自分の 4 Hz の天井の問い合わせ）・雨と風の音（MR.WeatherAudio: 後からデコード want / release、ループ）。雷（M3）は後から。
//
// ■ 雨（rain: true、drops 粒。InstancedBufferGeometry の板 + ShaderMaterial、透明・depthWrite 無し・トーンマップと霧あり）:
//   粒は箱 dropBox（m）の中で世界に固定（pos = カメラ + mod(seed × 箱 + 落ちた量 − カメラ, 箱) − 箱 / 2）。落ちた量 uFall は CPU で
//   倍精度で積分して箱で丸める（時計から作らない）。板は「粒の速さ − カメラの速さ」の向きに伸ばす（速いほど長く、streakMax 倍まで）。
//   カメラの速さ = 前のフレームからの移動 / dt。velJump m と velJumpSpeed × dt m（どの乗り物より速い）の両方より大きく動いた（復活・自由カメラ・
//   乗り降り・置き直し）・dt 0 のフレームは 0、velMax まで（以前は 1 フレーム 5 m の決まった距離で、30 fps の 150 m/s の戦闘機は毎フレーム
//   「飛んだ」になり、速さで粒を消せなかった）。
//   見え方 = 雨の強さ × 粒ごとの dropOpacity × 速さ（streakMaxSpeed で消える）× 雲の層より上で消える。屋根の地図（下）で屋根の下の粒は描かない。
//   近い粒は nearFade m で消す（閉じた操縦席・車内の 1 人称は cabinClear の半径 = 窓より内側に粒を描かない）。画像 rain_streak.png が無ければ
//   シェーダーの細い線（画像は真ん中の streakCrop の幅だけを板に当てる）。
// ■ 水しぶき（splashes: true）: 候補の点 splashPool 個（カメラから splashRadius m の輪の中）を 4 Hz の時に splashPoolQueriesPerTick 個ずつ
//   nav に問い合わせて作り直す（地面の高さ・頭の上の天井 = 屋根の下は使わない・水 = 波紋の点）。毎フレームの nav の問い合わせは無い。
//   1 フレーム splashPerSec × 雨 × dt 個（splashPerSec × dt × splashCapK + 1 個まで）を乾いた点から ± splashJitter / 2 m に出す。splashMax 個の輪のバッファ（全部を毎回上げ直す）、
//   時計はゲームの dt の和で 256 秒ごとに全部の t0 と一緒に引く。splash_flipbook.png（4×4）が無ければシェーダーの輪。
// ■ 屋根の地図（cover。粒ごとに屋根の下を描かない）: カメラのまわり coverCells × coverCells の coverCell m の升（世界に固定、升の番号は
//   世界の升の mod = 粒の箱と同じ考え方）ごとに、升にかかる当たり判定の要素（nav.itemsIn）のうち下面が目の高さより上の物の「一番高い下面」
//   （屋根に少しでもかかる升は、その升のどこの屋根の下の粒も消す = 壁の内側に粒が漏れない。建物の中の粒は上の階の床でも消える。外の
//   壁ぎわの 1 升に粒が無いのは見えない）を DataTexture（RG に 1/16 m の 16 ビット、65535 = 空）に書く。雨のシェーダーは粒の升を引き、
//   その高さより下の粒を描かない（ロビー・コンコース・ひさし・高架・橋の下は描かない、戸口・ひさしの外の通りの雨は見える。天井より上の粒は
//   屋根が深さで隠す）。室内の度合いには同じ升の「一番低い下面」を使う。
//   1 フレームに coverQueries（1/60 秒あたり）回まで、カメラに近い升から順に問い合わせる（升を書いたときの目の高さの上下で一番近い要素の
//   境目の高さ（下面・上面）を覚えておき、目がその間を出た升・当たり判定のチャンクが届いた升も。境目の間なら答えは変わらない = 通り・空の上は
//   高さが変わっても問い合わせない。以前は目の高さが 0.75 m 変わるたびに全部の升をやり直し、上昇 3 m/s で毎秒 約 2700 回だった）。カメラが升を移ると入ってきた列・行は空にしてから問い合わせる。飛んだフレームは全部空に
//   して coverBurst 回。雨の無い間は何もしない。頂点のテクスチャが使えない端末は無し（室内なら全部の粒を消す = 以前と同じ）。
// ■ 室内（音・水しぶき）: 4 Hz で描くカメラの位置の nav.ceilingHeight（自由カメラでも）。indoorCeiling m より低い天井が無ければ外、
//   あれば屋根の地図のまわり indoorRadius m の升で天井の無い（開いた）升の割合 f から 1 − f × indoorOpenK（ひさし・高架の下で通りが
//   すぐそこなら外、ロビー・コンコースの中は 1）。そのチャンクが当たり判定に無ければ外。0.4 秒でなめらかに。室内（0.5 以上）は水しぶきを
//   出さない、雨の音は室内の度合いで下げる。
// ■ 濡れ: wet を wetTarget へ riseSec（上がる）/ drySec（乾く）の速さで（最初と飛んだフレームはすぐ）。水たまり uPuddle は wet で
//   puddleLight（雨）〜 puddleStorm（雷雨）。uWet / uPuddle / tWetMask は materials.wetUniforms（濡れる材質・陸・遠景が共有）。
//
// ■ 雲のドーム（1 回の描画）: カメラについて動く内向きの球（BackSide）。gl_Position = xyww（いつも一番奥）、depthTest あり・depthWrite 無し、
//   透明（opaque の後）・renderOrder −1（透明の中で最初）。何も描かれていない所（空の背景の球の上）にだけ出る。discard は使わない（alpha 0）。
//   - 雲の層（cloudH の平面）と巻雲（cirrusH）。clouds_a.png / clouds_b.png（データ = LinearEncoding、RepeatWrapping、ミップマップ）。
//     無ければ（render.weather.clouds: false か manifest に無い）CLOUDS 0 で作る = 霞と一面の曇りだけ（テクスチャを引かない）。
//     届くまでは 1×1 の代わり（R 0 = 雲が無い）。cloudDetail: false（タッチ端末）は細かいテクスチャと影の 2 回の読みを省く。
//   - 風: オフセットは CPU で倍精度で積分して [0, 1) に丸めてから渡す（off −= 風 × dt / 大きさ）。時計（オンラインは 1.8e9 秒）から
//     作らない（float の精度が無くなる）。風は weather の windX / windZ × view.cloudWind。
//   - 霞: 地平線へ向かうほど hazeDist で今の霧の色へ。霧が濃い（fogMul / farMul < 1）ときは hazeDense（0..1）× 帯（地平線より下と
//     haze.bandDeg 度まで 1、fadeDeg で 0）で霧の色・不透明にする = 描画距離で切れた建物の向こうも霧の色（段ボールの切り絵にならない）。
//     この霧の色は three の霧と同じく出力の色空間に直した後で混ぜる（霧の中の建物と同じ色になる）。
//   - カメラが雲の層に近づくと雲だけ薄くする（0.75 × cloudH 〜 cloudH）。霞は残す。
//   - 色は weather.js がリニアにしたもの。最後に encodings_fragment（コンポーザーの道もそのまま canvas に描く道も同じ明るさ）。
//     toneMapped: false（背景の球と同じ）。
// ■ 毎フレーム: update(dt, p) は _update（シミュレーション: オフセット・知らせ・環境マップ）。ソロの設定のパネルで止まっている間は
//   呼ばれない。preRender(cam) は _render（置くのと uniform を書くだけ。時間を進めない）。どちらも割り当て無し。
// ■ 設定: game.json の weather（weather.view にこのファイルの数）と render.weather（質の切り替えだけ。mobile で上書き）。
window.MR = window.MR || {};

MR.WeatherView = class WeatherView {
  static get VIEW_DEFAULTS() {
    return {
      cloudWind: 2.2,      // 雲の層の風 = 地上の風 × これ
      cloudWindB: 1.2,     // 細かい方の雲（clouds_b）は × これ
      cirrusWind: 2.5,     // 巻雲は × これ
      domeRadius: 450,     // 球の半径（xyww なので見た目には効かない。near より大きければよい）
      domeSegments: [48, 24],
      farOverFog: 1.15,    // 霧が濃いときの描画距離 ≥ 霧の終わり × これ（game.js）
      startToastSec: 2,    // 始めてから何秒で今の天気を知らせるか
      startText: 'いまの天気',
      toastBlend: 0.3,     // 変わった知らせは移り変わりがここまで進んで（画面で見えるようになって）から
      // 終わる天気（雨・霧・雷）の知らせは、それがほとんど見えなくなってから（toastBlend だけだと「雨がやんだ」が雨の 7 割・粒の 8 割のうちに出ていた）:
      //   rain = 雨（雪も）が行き先の状態の雨 + これ以下（0.03 で粒は数が雨の 7 %・不透明度が 13 %）、fog = fogMul と farMul が行き先の値 × これ以上（霧の終わりが晴れの 9 割）、
      //   lightning = 雷の回数（1 分あたり）が行き先 + これ以下。来る天気（雨が降ってきた・霧が出てきた）は toastBlend のまま。
      //   降る状態（rain / snow > 0）への知らせは霧の終わり（fog）を見ない（霧 → 雨は「雨が降ってきた」= 来る天気）
      toastEnd: { rain: 0.03, fog: 0.9, lightning: 0.5 },
      // 一面の曇り（雨・霧・雷雨）の半球光の色: 空の色 hemiSky・地面の照り返し hemiGround（sRGB）へ p.over × hemiOver だけ寄せる（強さは hemiMul）。
      //   以前は強さだけ変わり、夕日の照り返し（橙）が残って、下を向いた面（アーケード・ひさし・グランドセントラルの車両基地の天井）が灰色の雨の中で橙に光っていた
      hemiSky: '#a4a7ae',
      hemiGround: '#5a5856',
      hemiOver: 1,
      envHz: 2,            // 環境マップの強さを変える回数（1 秒あたり）の上限
      envStep: 0.02,       // これより小さい変化では変えない（移り変わりの終わりは除く）
      // 雨（M2）
      fallSpeed: 9,        // 粒の落ちる速さ m/s
      rainWind: 0.5,       // 粒の横の速さ = 風 × これ
      streakMax: 3,        // 板の長さ（速さ / fallSpeed）の上限の倍率
      rainColor: '#c9ced8', // 粒の色（sRGB）× rainLight × 半球光の強さ（天気オフの値との比）+ 太陽 × rainSun
      rainLight: 0.8,
      rainSun: 0.05,
      rainFadeIn: 0.12,    // 雨の強さがここまでの間は不透明度と粒の数を 0 から上げる（降り始め・やみ際）
      rainOpMin: 0.7,      // 不透明度 = … ×（rainOpMin + (1 − rainOpMin) × 雨）
      speedFadeFrom: 0.7,  // カメラの速さが streakMaxSpeed × これから streakMaxSpeed で粒を消す
      cloudFadeFrom: 0.8,  // カメラが雲の層（cloudH）× これより上なら粒を薄く（cloudH で 0）
      indoorHz: 4,         // 室内の問い合わせ・水しぶきの候補の作り直しの回数（1 秒あたり）
      indoorCeiling: 60,   // カメラの上これより低い天井があれば屋根の下（m。グランドセントラルのコンコースの天井は目から 35.75 m）
      indoorRadius: 4,     // 屋根の下のとき、まわりこの半径（m）の屋根の地図で開いた所の割合を見る（ひさし・高架の下は外）
      indoorOpenK: 2.5,    // 室内 = 1 − 開いた所の割合 × これ（0 まで）
      indoorFadeSec: 0.4,
      splashLife: 0.4,     // 水しぶき 1 つの長さ（秒）
      splashSize: 0.34,    // 1 コマの大きさ（m。0.2 では通りの 2〜4 画素の点で、ほとんど見えなかった）
      splashBright: 2.0,   // 水しぶきの色 = 粒の色 × これ
      splashJitter: 0.6,   // 候補の点のまわりに出す幅（m）
      splashCapK: 1.5,     // 1 フレームに出す数の上限 = splashPerSec × dt × これ + 1（長いフレームの後にまとめて出さない。フレームの長さによらず同じ数 / 秒）
      splashMinR: 2,       // 候補の点の輪の内側の半径（m）
      splashCover: 60,     // 候補の点の上にこれより低い天井（屋根・高架・橋）があれば使わない（m）
      splashMaxDy: 30,     // カメラとの高さの差がこれより大きい点は使わない（m）
      // 川の波紋（water.js）: 大・中・小 3 つの升（m）に 1 つずつ広がる輪（升の 0.3 倍まで）と落ちた瞬間の明るい点。小さい升は近く（rippleNear m）だけ。
      //   以前は 1.2 m の升に細い輪 1 つ・強さ × 雨（0.55）・近くに水の候補の点が無いと × 0.6 で、ふつうの雨では泳いでいても桟橋からもほとんど見えなかった
      rippleCells: [0.8, 0.45, 0.25],
      rippleWidth: 0.025,  // 輪の幅（× 升 = 0.02 / 0.011 / 0.006 m）。1 画素より細くはしない（太らせた分は √ で薄く）
      rippleFull: [0.4, 0.6, 0.9], // 升 A / B / C のどれにも輪がある雨（それより弱い雨は升の 雨 / これ の割合だけ）
      rippleOnset: 0.15,   // 輪の強さがいっぱいになる雨（降り始め・やみ際だけ薄い）
      rippleDist: [25, 40], // カメラからの距離（3D、m）で消す
      rippleNear: [4, 7],  // 小さい升（C）を消す距離（3D、m）
      rippleNormal: 0.9,   // 輪の斜面の法線の強さ
      rippleDot: 1.5,      // 落ちた瞬間の点の明るさ（× 輪の明るさ）
      rippleDotSize: 0.06, // 落ちた瞬間の点の半径（× 升）
      rippleLight: 1.5,    // 波紋の輪が映す曇り空の明るさ（× 雲の色。曇り・雨の川は空の映り込みが一色なので法線だけでは見えない）
      clockRebase: 256     // 水しぶきの時計を引く間隔（秒）
    };
  }
  // render.weather（質の切り替えだけ。霧・描画距離・敵の見える距離は変えない）。タッチ端末は render.weather.mobile で上書き
  static config(rs, touch) {
    const base = Object.assign({ clouds: true, cloudDetail: true, textureMax: null, rain: true, splashes: true, puddles: true,
      drops: 3000, dropBox: [26, 18, 26], dropLen: 0.75, dropWidth: 0.035, dropOpacity: [0.3, 0.6], nearFade: 0.6,
      dropMinPx: 1.5, dropMaxPx: 4, dropsMin: 0.3, streakCrop: 0.14, cabinClear: { heli: 3.0, jet: 4.5, car: 1.6 }, streakMaxSpeed: 60, splashMax: 64, splashPerSec: 120, splashRadius: 12,
      splashPool: 48, splashPoolQueriesPerTick: 8, velJump: 5, velJumpSpeed: 450, velMax: 120,
      cover: true, coverCells: 32, coverCell: 1, coverQueries: 48, coverBurst: 384, coverChecks: 384 }, (rs && rs.weather) || {});
    if (touch && rs && rs.weather && rs.weather.mobile) Object.assign(base, rs.weather.mobile);
    delete base.mobile;
    return base;
  }
  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  // '#rrggbb'（sRGB）→ リニアの [r, g, b]
  static hexLin(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    return [WeatherView.lin(((n >> 16) & 255) / 255), WeatherView.lin(((n >> 8) & 255) / 255), WeatherView.lin((n & 255) / 255)];
  }
  // sRGB → リニア（three の Color.convertSRGBToLinear と同じ式）
  static lin(c) { return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4); }
  // 数の uniform を変わったときだけ書く（preRender）
  static setU(un, v) { if (un.value !== v) un.value = v; }

  // game: MR.Game（scene / sky / renderer / rs / hud / materials / world / assets / _vSun / _vHemi）。opts: { weather（MR.Weather）}
  constructor(game, opts) {
    opts = opts || {};
    this.game = game;
    this.weather = opts.weather;
    this.cfg = this.weather.cfg;
    this.level = this.weather.level;
    this.vc = Object.assign({}, WeatherView.VIEW_DEFAULTS, this.cfg.view || {});
    this.rq = WeatherView.config(game.rs, !!(game.input && game.input.isTouchDevice));
    this.scene = game.scene;
    this.sky = game.sky;
    this.renderer = game.renderer;
    this.disposed = false;
    // 1 フレームの時間はテスト（smoke-weather.js / screenshot.js --w1）が外から測る（中で performance.now を呼ぶと割り当てが出る）
    this.stats = { toasts: 0, envSets: 0, navQueries: 0, ceilQueries: 0, indoorQueries: 0, velResets: 0, splashes: 0, poolTicks: 0, rebases: 0,
      coverQueries: 0, coverResets: 0, coverUploads: 0, coverSkips: 0 };
    this._cam = new THREE.Vector3();
    // 元の値（倍率の元）
    this.baseExposure = this.renderer ? this.renderer.toneMappingExposure : 1;
    if (this.sky && this.sky.weatherBase) this.sky.weatherBase({ hemiSky: WeatherView.hexLin(this.vc.hemiSky || '#a4a7ae'), hemiGround: WeatherView.hexLin(this.vc.hemiGround || '#5a5856'), hemiOver: this.vc.hemiOver });
    this._vSun = game._vSun || null;
    this._vHemi = game._vHemi || null;
    this._vSunI = this._vSun ? this._vSun.intensity : 0;
    this._vHemiI = this._vHemi ? this._vHemi.intensity : 0;
    // 川（WEATHER で作った水だけ）・遠景のガラスの空の色
    const world = game.world || null;
    this.water = world && world.water && world.water.weather ? world.water : null;
    this.farU = world && world.farMaterial && world.farMaterial.userData && world.farMaterial.userData.uniforms ? world.farMaterial.userData.uniforms : null;
    this._farSky0 = this.farU && this.farU.uSky ? this.farU.uSky.value.clone() : null;
    this._envExtra = world && world.farMaterial ? [world.farMaterial] : null;
    this._envK = 1;
    this._envT = 0;
    // 雲のオフセット（倍精度・[0, 1)）
    this._ax = 0; this._az = 0; this._bx = 0; this._bz = 0; this._cx = 0; this._cz = 0;
    // 知らせ
    this._startT = 0;
    this._startDone = false;
    this._pendId = '';     // 変わった（p.changed）けれどまだ知らせていない状態と前の状態（blend が toastBlend に届いたら出す）
    this._pendFrom = '';
    this._toastLim = WeatherView.toastLimits(this.cfg, this.vc);
    this.lastToast = null;
    // 後から見せる物（雨・雷。M2 / M3）: precompile で一度だけ見せてコンパイルする
    this._lazy = [];
    this._buildDome(game.assets);
    // ---- 雨・水しぶき・濡れ・音（M2）----
    this._cu = new THREE.Vector3();      // update の時のカメラ（描くカメラ。自由カメラ・乗り物の視点も）
    this._cp = new THREE.Vector3();      // 前のフレームのカメラ
    this._hasPrev = false;
    this.camVel = new THREE.Vector3();   // カメラの速さ（飛んだフレームは 0）
    // 毎フレーム変わる小数は Float64Array に（オブジェクトのフィールドに書くと V8 では箱を作ることがある = 毎フレームの割り当て）:
    //   0..2 粒の落ちた量（箱で丸める） 3..5 粒の相対速度の向き 6 その大きさ 7 カメラの速さ 8 室内（0..1） 9 室内の目標 10 室内の問い合わせまでの秒
    //   11 濡れ 12 水たまり 13 雨の不透明度 14 水しぶきの時計 15 最後に出した時刻 16 出す数の端数 17 チャンクの印の古さ 18 1 m 先の 1 画素（m）
    //   19 粒が速さで消えていない割合（1 = ふつう、0 = 速いカメラ） 20 雲の層の下の割合（0 = 雲の層より上）
    this._rv = new Float64Array(21);
    this._rv[4] = -1; this._rv[6] = this.vc.fallSpeed; this._rv[15] = -1e9; this._rv[19] = 1; this._rv[20] = 1;
    this._initRipples();
    this._ckX = 1e9; this._ckZ = 1e9; this._ckMask = 0;
    this.cabin = null;                   // 閉じた操縦席・車内の 1 人称（'heli' | 'jet' | 'car'）
    this._wetInit = false;
    this._rainCol = WeatherView.hexLin(this.vc.rainColor || '#c9ced8');
    this._fw = new THREE.Vector3(0, 0, -1);   // カメラの向き（水しぶきは前に多く出す）
    this._buildRain(game.assets);
    this._buildSplash(game.assets);
    this._loadWetMask(game.assets);
    this.sound = MR.WeatherAudio ? new MR.WeatherAudio(game.audio, this.weather, game.config && game.config.audio) : null;
  }

  // ---------- 雲と霞のドーム ----------
  _buildDome(assets) {
    const L = this.level, H = this.cfg.haze || {};
    const canTex = !!(assets && typeof assets.resolve === 'function' && typeof assets.loadTexture === 'function');
    let ka = null, kb = null;
    if (canTex && this.rq.clouds !== false && (!this.game.rs || this.game.rs.textures !== false)) {
      try { ka = assets.resolve('textures/weather/clouds_a.png'); kb = assets.resolve('textures/weather/clouds_b.png'); } catch (e) { ka = kb = null; }
    }
    this.cloudsOn = !!(ka && kb);
    const blank = WeatherView.blankCloud();
    const deg = Math.PI / 180;
    const u = this.u = {
      tA: { value: blank }, tB: { value: blank },
      camPos: { value: new THREE.Vector3() },
      sunDir: { value: this.sky && this.sky.sunDir ? this.sky.sunDir.clone() : new THREE.Vector3(-0.55, 0.3, -0.45).normalize() },
      sunCol: { value: new THREE.Color(1, 1, 1) },
      coverage: { value: 0 }, softness: { value: 0.1 }, erode: { value: 0.3 }, overcast: { value: 0 }, cirrus: { value: 0 },
      offA: { value: new THREE.Vector2() }, offB: { value: new THREE.Vector2() }, offC: { value: new THREE.Vector2() },
      litCol: { value: new THREE.Color() }, shadeCol: { value: new THREE.Color() }, ovCol: { value: new THREE.Color() },
      cirCol: { value: new THREE.Color() }, hazeCol: { value: new THREE.Color() },
      cloudH: { value: L.cloudH || 1600 }, cirrusH: { value: L.cirrusH || 8000 }, scaleA: { value: L.scaleA || 12000 }, scaleB: { value: L.scaleB || 3000 },
      hazeDist: { value: 22000 }, opacity: { value: 1 }, fade: { value: 1 },
      hazeDense: { value: 0 },
      band: { value: new THREE.Vector2(Math.sin((H.bandDeg == null ? 4 : H.bandDeg) * deg), Math.sin((H.fadeDeg == null ? 12 : H.fadeDeg) * deg)) }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: WeatherView.DOME_VERT, fragmentShader: WeatherView.DOME_FRAG,
      defines: { CLOUDS: this.cloudsOn ? 1 : 0, CLOUD_DETAIL: this.cloudsOn && this.rq.cloudDetail !== false ? 1 : 0 },
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: false
    });
    mat.name = 'weatherDome';
    const seg = this.vc.domeSegments || [48, 24];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(this.vc.domeRadius, seg[0], seg[1]), mat);
    mesh.name = 'weatherDome';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    this.dome = mesh;
    this.domeMaterial = mat;
    this.cloudSource = this.cloudsOn ? 'loading' : (this.rq.clouds === false ? 'off' : 'none');
    if (!this.cloudsOn) { this.ready = Promise.resolve(this.cloudSource); return; }
    const opts = { srgb: false, anisotropy: 4 };
    if (this.rq.textureMax) opts.maxSize = this.rq.textureMax;
    const get = (key, slot) => {
      let pr;
      try { pr = Promise.resolve(assets.loadTexture(key, opts)); } catch (e) { pr = Promise.reject(e); }
      return pr.then((t) => {
        if (this.disposed || !t) return false;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        u[slot].value = t;
        return true;
      }, (e) => { console.warn('[Weather] 雲の画像を読めません（雲なしで続けます）:', key, e && e.message); return false; });
    };
    this.ready = Promise.all([get(ka, 'tA'), get(kb, 'tB')]).then((r) => {
      // 片方だけ届いた: 雲の形が崩れるので両方とも代わり（雲なし・霞と曇りだけ）にする
      if (!(r[0] && r[1])) { u.tA.value = blank; u.tB.value = blank; this.cloudSource = 'failed'; } else this.cloudSource = 'files';
      return this.cloudSource;
    });
  }

  // テクスチャが届く前・届かないときの代わり（R 0 = 雲が無い、G / B 0.5 = 中くらい）。プログラムと sampler は同じまま
  static blankCloud() {
    if (WeatherView._blank) return WeatherView._blank;
    const t = new THREE.DataTexture(new Uint8Array([0, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return (WeatherView._blank = t);
  }

  // ---------- 毎フレーム（シミュレーション）----------
  update(dt, p) {
    if (this.disposed || !p) return;
    if (dt > 0) {
      // 雲のオフセット: 風下へ流れる = 世界の点が引く uv が風上へ（off −= 風 × dt / 大きさ）
      const k = this.vc.cloudWind, wx = p.windX * k, wz = p.windZ * k;
      const sA = this.u.scaleA.value, sB = this.u.scaleB.value, kb = this.vc.cloudWindB, kc = this.vc.cirrusWind;
      this._ax -= wx * dt / sA; this._ax -= Math.floor(this._ax);
      this._az -= wz * dt / sA; this._az -= Math.floor(this._az);
      this._bx -= wx * kb * dt / sB; this._bx -= Math.floor(this._bx);
      this._bz -= wz * kb * dt / sB; this._bz -= Math.floor(this._bz);
      this._cx -= wx * kc * dt / (sB * 2.3); this._cx -= Math.floor(this._cx);
      this._cz -= wz * kc * dt / (sB * 2.3); this._cz -= Math.floor(this._cz);
    }
    this._toastTick(dt, p);
    // 環境マップの強さ（envHz 回 / 秒まで。小さい変化は移り変わりが終わるまで待つ）
    this._envT -= dt;
    if (this._envT <= 0) {
      this._envT = 1 / Math.max(0.1, this.vc.envHz);
      const minS = this.cfg.env && this.cfg.env.minScale != null ? this.cfg.env.minScale : 0.25;
      const k = Math.max(minS, Math.min(1, p.envMul));
      const d = Math.abs(k - this._envK);
      if (d > this.vc.envStep || (d > 0 && p.blend >= 1)) this.setEnvScale(k);
    }
    this._rainTick(dt, p);
  }

  setEnvScale(k) {
    this._envK = k;
    this.stats.envSets++;
    const m = this.game.materials;
    if (m && typeof m.setEnvScale === 'function') m.setEnvScale(k, this._envExtra);
  }
  get envScale() { return this._envK; }

  // 変わった知らせ（p.changed: 飛んだフレームは weather.js が出さない）と、始めて startToastSec 秒後の 1 回。
  //   変わった知らせは移り変わりが toastBlend まで進んでから（変わり始め = blend 0 で出すと、画面が変わる前に消えていた）。終わる天気（雨がやんだ・
  //   霧が晴れた・雷がおさまった）はそれがほとんど見えなくなってから（_toastReady / toastEnd。以前は blend 0.3 = 雨 0.385（雨の 7 割）・粒の画素の 8 割・
  //   雨の音がまだいっぱいの所で「雨がやんだ」が出て、その後 20 秒雨が降っていた）。
  //   文は前の状態ごと（Weather.toastText: 雨 → 曇り「雨がやんだ」、霧 → 曇り「霧が晴れてきた」、雷雨 → 雨「雷がおさまった」）。
  //   始めの「いまの天気」は画面に出ている状態: 移り変わりの途中でまだ見えるようになっていなければ（_toastReady）前の状態（prevId）を出して、
  //   変わった知らせを後で（以前は来る途中の状態を出し、雨が降っているのに「曇り いまの天気」になった）。始める前に変わって知らせが
  //   待っていれば、始めの知らせはその知らせに任せる（同じフレームに 2 つ出さない）。変わった知らせは始めの知らせの後。
  //   出せない間（戦闘機の HUD・ロビー・死亡画面・結果の画面）に来た知らせは後で出し直さない。設定のパネル・全体の地図の間（_toastWait）は
  //   始めの知らせも変わった知らせも待って、閉じたら出す
  _toastTick(dt, p) {
    // 死んでいる間は出さない（死亡画面・復活する場所の板と重ねない）。出ている知らせも消す
    const dead = !!(this.game.player && this.game.player.dead);
    if (dead && !this._wasDead && this.game.hud && typeof this.game.hud.hideWeather === 'function') this.game.hud.hideWeather();
    this._wasDead = dead;
    if (p.jumped) this._pendId = '';
    else if (p.changed) { this._pendId = p.id; this._pendFrom = p.prevId; }
    if (!this._startDone) {
      this._startT += dt;
      if (this._startT < this.vc.startToastSec) return;
      // 設定のパネル・全体の地図の間は始めの知らせも待つ（閉じたら出す）。以前は先に _startDone を立ててから _toast が断られ、
      //   始めて 2 秒の時に地図を開いていると始めの知らせが二度と出なかった
      if (this._toastWait()) return;
      this._startDone = true;
      if (!this._toastReady(p) && p.prevId && p.prevId !== p.id) {
        this._toast(p.prevId, '', true);
        if (this._pendId !== p.id) { this._pendId = p.id; this._pendFrom = p.prevId; }
      } else if (this._pendId !== p.id) this._toast(p.id, '', true);
    }
    if (this._pendId) {
      if (p.id !== this._pendId) this._pendId = '';
      else if (this._toastReady(p) && !this._toastWait()) { const id = this._pendId; this._pendId = ''; this._toast(id, this._pendFrom, false); }
    }
  }
  // 移り変わりが画面で見えるようになったか: blend ≥ toastBlend、そのうえ終わる天気（雨・雪・霧・雷）はほとんど見えなくなってから（toastEnd）。
  //   行き先の状態の値と今の p だけで決める（前の状態の値は見ない = force で移り変わりの途中から変えても同じ）。雨が降ってくる・霧が出てくる側は
  //   p が行き先より小さい / 大きいので待たない
  //   限り（行き先の状態ごと: 雨・雪の上限、fogMul・farMul の下限、雷の上限）は始めに 1 回作る（毎フレームの道で小数を返す関数・クロージャを作らない）
  _toastReady(p) {
    if (p.blend < this.vc.toastBlend) return false;
    if (p.blend >= 1) return true;
    const L = this._toastLim[p.id];
    if (!L) return true;
    return !(p.rain > L[0] || p.snow > L[1] || p.fogMul < L[2] || p.farMul < L[3] || p.lightningPerMin > L[4]);
  }
  static toastLimits(cfg, vc) {
    const te = vc.toastEnd || {}, out = {};
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    for (const id in cfg.states) {
      const st = cfg.states[id] || {}, L = new Float64Array(5);
      L[0] = te.rain != null ? num(st.rain, 0) + te.rain : Infinity;
      L[1] = te.rain != null ? num(st.snow, 0) + te.rain : Infinity;
      // 降る天気（雨・雷雨・雪）へは霧の終わりを待たない: 知らせは「雨が降ってきた」= 来る天気（霧 → 雨で霧の 9 割の終わりを待つと
      //   blend 0.86・雨がもう 86 % の所で出ていた）。霧が晴れたことを言う文は降らない状態への知らせだけ
      const precip = num(st.rain, 0) > 0 || num(st.snow, 0) > 0;
      L[2] = te.fog != null && !precip ? num(st.fogMul, 1) * te.fog : -Infinity;
      L[3] = te.fog != null && !precip ? num(st.farMul, 1) * te.fog : -Infinity;
      L[4] = te.lightning != null ? num(st.lightningPerMin, 0) + te.lightning : Infinity;
      out[id] = L;
    }
    return out;
  }
  _toastAllowed() {
    const g = this.game, h = g.hud;
    if (!h || typeof h.showWeather !== 'function') return false;
    if (this._toastWait()) return false;                  // 設定のパネル・全体の地図（#fullmap）の間は待つ（閉じたら出す。_toastTick）
    if (g.player && g.player.dead) return false;           // 死亡画面（ビルド 11 からは #hud.respawning の復活する場所の板）
    if (g.jetHud && g.jetHud.visible) return false;      // 戦闘機の HUD（キャンバス）は上の方位のテープ・数字で埋まっている
    if (h._lobbyKey) return false;                         // オンラインのバトロワのロビー（#ry-lobby）
    // 結果の画面（#result: z-index 7・暗い幕の下で知らせが薄く透けていた）と、バトロワが終わってから結果が出るまで（resultDelay）。
    //   優勝したプレイヤーは生きていてゲームも進むので、以前は「優勝！」の上に知らせが出た（hud.showResult は出ている知らせを消すだけ）
    if (h.resultShown) return false;
    if (g.royale && g.royale.over) return false;
    return true;
  }
  // 知らせを待たせる間（捨てずに、閉じたら出す）: 設定のパネル・全体の地図（M / ミニマップのタップ。復活する場所の地図の選び方も）
  _toastWait() {
    const g = this.game, mm = g.play && g.play.minimap;
    return !!(g.settingsOpen || (mm && mm.full && mm.full.open));
  }
  _toast(id, from, start) {
    if (!this._toastAllowed()) return false;
    const st = (this.cfg.states && this.cfg.states[id]) || {};
    const text = start ? this.vc.startText : MR.Weather.toastText(this.cfg, from, id);
    this.game.hud.showWeather(st.icon || '', st.name || id, text, this.cfg.toastMs);
    this.stats.toasts++;
    this.lastToast = { id, from: from || '', text, start: !!start };
    return true;
  }

  // ---------- 描く前（置く・uniform を書くだけ。時間は進めない）----------
  preRender(cam) {
    if (this.disposed) return;
    // 色・ベクトルは成分ごとに書く（setRGB / set / lerp に小数を渡すと V8 が引数の箱を作る = 毎フレームの割り当て）。
    //   数の uniform（{ value }）は変わったときだけ書く: three の uniform は Texture や Color も入る同じ形のオブジェクトなので、
    //   V8 では小数を入れるたびに箱を作る（移り変わりの間だけになる）
    const p = this.weather.p, u = this.u, S = WeatherView.setU;
    const c = this._cam.setFromMatrixPosition(cam.matrixWorld);
    this.dome.position.copy(c);
    u.camPos.value.copy(c);
    if (this.sky && this.sky.applyWeather) this.sky.applyWeather(p, 1);
    S(u.coverage, p.cov); S(u.softness, p.soft); S(u.erode, p.erode); S(u.overcast, p.over); S(u.cirrus, p.cirrus);
    let o = u.litCol.value, a = p.lit; o.r = a[0]; o.g = a[1]; o.b = a[2];
    o = u.shadeCol.value; a = p.shade; o.r = a[0]; o.g = a[1]; o.b = a[2];
    o = u.ovCol.value; a = p.ov; o.r = a[0]; o.g = a[1]; o.b = a[2];
    o = u.cirCol.value; a = p.cir; o.r = a[0]; o.g = a[1]; o.b = a[2];
    // 霞 = 今の霧の色（状態に haze があればそちらへ）
    const fog = this.scene.fog, h = u.hazeCol.value, hh = p.hasHaze, hz = p.haze;
    if (fog) h.copy(fog.color); else { h.r = 0.6; h.g = 0.6; h.b = 0.62; }
    h.r += (hz[0] - h.r) * hh; h.g += (hz[1] - h.g) * hh; h.b += (hz[2] - h.b) * hh;
    S(u.hazeDist, p.hazeDist);
    S(u.hazeDense, p.hazeDense);
    if (this.sky && this.sky.sun) {
      // 雲の縁の光は太陽の色をもう一度リニアにした濃い色（資料の雲の見た目 = 見直した色。game.json の雲の色も同じ考え方で決めてある）
      const sm = p.sunMul < 1 ? p.sunMul : 1, sc = this.sky.sun.color, sv = u.sunCol.value, L = WeatherView.lin;
      sv.r = L(sc.r) * sm; sv.g = L(sc.g) * sm; sv.b = L(sc.b) * sm;
    }
    const cH = u.cloudH.value;
    let f = (c.y - 0.75 * cH) / (0.25 * cH);
    f = f < 0 ? 0 : (f > 1 ? 1 : f);
    S(u.fade, 1 - f * f * (3 - 2 * f));
    o = u.offA.value; o.x = this._ax; o.y = this._az;
    o = u.offB.value; o.x = this._bx; o.y = this._bz;
    o = u.offC.value; o.x = this._cx; o.y = this._cz;
    // 露出・ビューシーン（銃と腕）の光
    if (this.renderer) this.renderer.toneMappingExposure = this.baseExposure * p.exposure;
    if (this._vSun && this.sky) { this._vSun.intensity = this._vSunI * p.sunMul; this._vSun.color.copy(this.sky.sun.color); }
    if (this._vHemi) {
      this._vHemi.intensity = this._vHemiI * p.hemiMul;
      // 色は本体の半球光の天気の色（sky.hemiBaseSky / hemiBaseGround。ビューシーンの光は本体の半球光の複製なので元の色は同じ）
      if (this.sky && this.sky.hemiBaseSky) { this._vHemi.color.copy(this.sky.hemiBaseSky); this._vHemi.groundColor.copy(this.sky.hemiBaseGround); }
    }
    // 川: 曇りの空の色を映す・空の映り込みときらめきを弱める
    const w0 = !!(this.water && this.water.uniforms.uRain);
    if (this.water) {
      const w = this.water.uniforms;
      S(w.uOvercast, p.over);
      o = w.uOvCol.value; a = p.ov; o.r = a[0]; o.g = a[1]; o.b = a[2];
      S(w.uSkyMul, p.skyRefl);
      S(w.uGlint, p.glint * (1 - p.over));
    }
    if (this.water && w0) {
      const w = this.water.uniforms;
      S(w.uRain, p.rain);
      if (w.uRippleLight) S(w.uRippleLight, this.vc.rippleLight);
      this._pxAt1m();
      if (w.uRippleK) w.uRippleK.value[3] = this._rv[18];   // 輪の幅の下限 = 1 画素（Float32Array: 書いても箱を作らない）
    }
    this._rainPreRender(c, p);
    // 遠景のガラスが映す空（夕焼けの色 → 曇りの色）
    if (this._farSky0) {
      const fs = this.farU.uSky.value, f0 = this._farSky0, ov = p.ov, k = p.over;
      fs.r = f0.r + (ov[0] - f0.r) * k; fs.g = f0.g + (ov[1] - f0.g) * k; fs.b = f0.b + (ov[2] - f0.b) * k;
    }
  }

  // 後から見せる物（雨・水しぶき・雷）のプログラムを最初のフレームの後にまとめてコンパイルする（最初の雨・雷で止まらない）
  //   コンポーザーのある端末は本体のパスと同じ描画先（readBuffer = リニア）でコンパイルする（描画先の色空間がプログラムのキーに入る。
  //   キャンバスのまま（sRGB）でコンパイルすると最初の雨でもう一度コンパイルしていた）
  //   コンパイルするのは後から見せる物だけ: その間だけシーンの子を「見えている光 + 後から見せる物」に差し替える（r128 の renderer.compile は
  //   見えない物も含めてシーンの全部の材質をなめるので、隠すだけでは減らない。光の数・霧・環境マップはプログラムのキーに入るので同じシーンで）。
  //   以前はシーン全部の材質（まだ描いていない後ろの建物・乗り物も）を最初のフレームでコンパイルしていた
  precompile(camera) {
    const r = this.renderer;
    if (!this._lazy.length || !r || typeof r.compile !== 'function') return 0;
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const vis = this._lazy.map((m) => m.visible);
    for (const m of this._lazy) m.visible = true;
    const sc = this.scene, kids = sc.children, lights = [];
    sc.traverseVisible((o) => { if (o.isLight) lights.push(o); });
    const progs = r.info && r.info.programs ? r.info.programs.length : -1;
    const comp = this.game.composer, rt = typeof r.getRenderTarget === 'function' ? r.getRenderTarget() : null;
    const setRT = typeof r.setRenderTarget === 'function';
    try {
      if (setRT && comp && comp.readBuffer) r.setRenderTarget(comp.readBuffer);
      sc.children = lights.concat(this._lazy);   // 親はそのまま（世界の行列は描いたときのもの）。traverse だけがこの並びを見る
      r.compile(sc, camera);
    } catch (e) { console.warn('[Weather] precompile', e && e.message); }
    sc.children = kids;
    if (setRT && comp && comp.readBuffer) r.setRenderTarget(rt);
    this._lazy.forEach((m, i) => { m.visible = vis[i]; });
    const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    this.stats.precompile = { meshes: this._lazy.length, lights: lights.length, programs: progs >= 0 && r.info.programs ? r.info.programs.length - progs : null, ms: Math.round((t1 - t0) * 100) / 100 };
    return this._lazy.length;
  }

  // 天気の描画の数（スクリーンショットの数え方・テスト用）
  meshes() { return [this.dome].concat(this._lazy); }
  get rainVisible() { return !!(this.rain && this.rain.visible); }
  // テスト・デバッグ用（中身は _rv）
  get indoor() { return this._rv[8]; }
  get wet() { return this._rv[11]; }
  get puddle() { return this._rv[12]; }
  get rainOpacity() { return this._rv[13]; }
  get camSpeed() { return this._rv[7]; }
  get splashClock() { return this._rv[14]; }
  set splashClock(v) { this._rv[14] = v; }
  get splashVisible() { return !!(this.splash && this.splash.visible); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.dome) {
      if (this.dome.parent) this.dome.parent.remove(this.dome);
      this.dome.geometry.dispose();
      this.domeMaterial.dispose();
    }
    for (const m of this._lazy) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this._lazy = [];
    if (this.cv) { this.cv.tex.dispose(); this.cv = null; }   // 屋根の地図はこのゲームの物
    // 雲・雨・水しぶき・水たまりのテクスチャは assets のキャッシュの物（次のゲームでも使う）なので捨てない。元の光・露出・環境マップに戻す
    //   （同じレンダラーを使い回す）。濡れの uniform は Materials（レベルごとに次のゲームも使う）の物なので 0 に戻す
    if (this.renderer) this.renderer.toneMappingExposure = this.baseExposure;
    if (this._envK !== 1) this.setEnvScale(1);
    if (this.wetU) { this.wetU.uWet.value = 0; this.wetU.uPuddle.value = 0; }
    if (this.sound) { this.sound.dispose(); this.sound = null; }
    // 出ている知らせを消す（消すタイマーは実時間なので、「もう一度」・タイトルへ・止めた後も 3.5 秒残っていた）
    const h = this.game && this.game.hud;
    if (h && typeof h.hideWeather === 'function') h.hideWeather();
  }

  // ---------- 雨（M2）----------
  // 板 1 枚（x −0.5..0.5、y 0..1）を粒の数だけ（InstancedBufferGeometry）
  static quad() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }
  // 霧の uniform（UniformsLib.fog の複製）+ extra。UniformsUtils.merge はテクスチャも複製するので使わない
  static fogUniforms(extra) { return Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), extra); }

  _buildRain(assets) {
    const rq = this.rq, N = Math.max(0, Math.round(rq.drops || 0));
    this.rain = null;
    this.rainSource = 'off';
    if (rq.rain === false || !N) return;
    const g = WeatherView.quad();
    const seed = new Float32Array(N * 4);
    let a = (N * 2654435761) >>> 0;   // 決まった乱数（粒の並びは毎回同じ）
    for (let i = 0; i < N * 4; i++) {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      seed[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = N;
    const box = rq.dropBox || [26, 18, 26], op = rq.dropOpacity || [0.15, 0.4];
    const cv = this._makeCover();
    const u = this.ru = WeatherView.fogUniforms({
      tStreak: { value: WeatherView.blankCloud() }, uHasTex: { value: 0 }, uCrop: { value: rq.streakCrop },
      tCover: { value: cv ? cv.tex : WeatherView.blankCloud() }, uCover: { value: new THREE.Vector2(cv ? cv.N : 1, cv ? cv.cs : 1) },
      uBox: { value: new THREE.Vector3(box[0], box[1], box[2]) }, uOp: { value: new THREE.Vector2(op[0], op[1]) },
      uPx: { value: new Float32Array([0.002, rq.dropMinPx || 1.5, 1e6]) },   // 1 m 先の 1 画素の大きさ（m）・粒の幅の下限・上限（描く画素）
      // 毎フレーム変わる数は Float32Array に書く（three の vec3 / vec4 の uniform は配列も受ける）。{ value } や Vector の成分に小数を
      //   書くと V8 では箱を作ることがある（毎フレームの割り当て）
      uFall: { value: new Float32Array(3) }, uDir: { value: new Float32Array([0, -1, 0]) },
      uRainP: { value: new Float32Array([0, rq.dropLen, rq.dropWidth, rq.nearFade]) },   // 不透明度・長さ・幅・近くで消す半径
      uColor: { value: new Float32Array([0.5, 0.5, 0.5]) }
    });
    // 両面（板の向きは粒の速さとカメラで決まるので、表裏を決めない = 裏を向いた板が消えない）
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: WeatherView.RAIN_VERT, fragmentShader: WeatherView.RAIN_FRAG,
      defines: { COVER: cv ? 1 : 0 }, transparent: true, depthWrite: false, depthTest: true, fog: true, side: THREE.DoubleSide });
    mat.name = 'weatherRain';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'weatherRain';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.scene.add(mesh);
    this.rain = mesh;
    this.rainCount = N;
    this._lazy.push(mesh);
    this.rainSource = 'procedural';
    this._loadSprite(assets, 'textures/weather/rain_streak.png', u.tStreak, u.uHasTex, 'rainSource');
  }

  // ---------- 屋根の地図（cover）----------
  // 升 coverCells × coverCells（coverCell m）。bytes = テクスチャ（RG = 天井の下面の高さ (h + 512) × 16、65535 = 空）、H = 高さ（倍精度）、
  //   Lo = 一番低い下面（室内の度合い用）、W = 升の真ん中の目の高さが箱の中（壁・入れない建物。室内の度合いでは数えない）、
  //   WX / WZ = その升に今入っている世界の升（SENT = まだ）、E = 問い合わせたときの目の高さ、VL / VH = その下・上で一番近い境目の高さ（目が
  //   VL より上・VH より下にいる間は H / Lo / W は同じ）、L = そのときチャンクが当たり判定にあったか。
  //   ox / oz = カメラの升からの位置を近い順に並べたもの（ring 個までが indoorRadius の中）
  _makeCover() {
    const rq = this.rq;
    this.cv = null;
    if (rq.cover === false) return null;
    const caps = this.renderer && this.renderer.capabilities;
    if (caps && caps.vertexTextures === false) return null;
    const N = Math.max(4, Math.min(128, Math.round(rq.coverCells || 32))), cs = rq.coverCell > 0 ? rq.coverCell : 1, NN = N * N;
    const bytes = new Uint8Array(NN * 4).fill(255);
    const tex = new THREE.DataTexture(bytes, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false;
    tex.needsUpdate = true;
    const h = N >> 1, offs = [];
    for (let dz = -h; dz < N - h; dz++) for (let dx = -h; dx < N - h; dx++) offs.push([dx, dz, dx * dx + dz * dz]);
    offs.sort((a, b) => (a[2] - b[2]) || (a[1] - b[1]) || (a[0] - b[0]));
    const ox = new Int16Array(NN), oz = new Int16Array(NN);
    const rr = (this.vc.indoorRadius || 4) / cs;
    let ring = 0;
    offs.forEach((o, i) => { ox[i] = o[0]; oz[i] = o[1]; if (o[2] <= rr * rr) ring = i + 1; });
    const SENT = 0x7fffffff;
    this._cvItems = [];
    this.cv = { N, cs, NN, bytes, tex, ox, oz, ring, SENT, H: new Float64Array(NN).fill(Infinity), Lo: new Float64Array(NN).fill(Infinity), W: new Uint8Array(NN), E: new Float64Array(NN),
      VL: new Float64Array(NN), VH: new Float64Array(NN),
      WX: new Int32Array(NN).fill(SENT), WZ: new Int32Array(NN).fill(SENT), L: new Uint8Array(NN), cx: 0, cz: 0, init: false, i: 0, dirty: false };
    return this.cv;
  }
  // 全部の升を空・まだにする（飛んだフレーム・初め）
  _coverReset() {
    const cv = this.cv;
    cv.bytes.fill(255); cv.H.fill(Infinity); cv.Lo.fill(Infinity); cv.W.fill(0); cv.WX.fill(cv.SENT); cv.WZ.fill(cv.SENT); cv.L.fill(0);
    cv.i = 0; cv.dirty = true;
    this.stats.coverResets++;
  }
  // 升 s（テクスチャの番号）を空・まだに
  _coverClear(s) {
    const cv = this.cv;
    cv.bytes[s * 4] = 255; cv.bytes[s * 4 + 1] = 255; cv.H[s] = Infinity; cv.Lo[s] = Infinity; cv.WX[s] = cv.SENT; cv.L[s] = 0; cv.W[s] = 0;
  }
  _coverWrite(s, h) {
    let v = 65535;
    // 切り上げ（1/16 m に丸めて天井のすぐ下の粒が残らない。天井より上の数 cm は床・屋根の中）
    if (h < 3583) { v = Math.ceil((h + 512) * 16); if (v < 0) v = 0; else if (v > 65534) v = 65534; }
    const b = this.cv.bytes;
    b[s * 4] = v >> 8; b[s * 4 + 1] = v & 255;
    this.cv.dirty = true;
  }
  // 毎フレーム（雨の間だけ）: 窓をカメラの升へ動かす → 近い升から問い合わせる
  _coverTick(nav, c, dt, jumped) {
    const cv = this.cv, rq = this.rq, N = cv.N, cs = cv.cs, NN = cv.NN, h = N >> 1;
    const ccx = Math.floor(c.x / cs), ccz = Math.floor(c.z / cs);
    const dcx = ccx - cv.cx, dcz = ccz - cv.cz;
    let q = Math.ceil(rq.coverQueries * dt * 60);
    if (jumped || !cv.init || dcx >= N || dcx <= -N || dcz >= N || dcz <= -N) { this._coverReset(); q = rq.coverBurst; }
    else {
      // 窓に入ってきた列（x）・行（z）: 前の升の値が残っているので空にする（問い合わせるまで雨を描く）
      if (dcx > 0) for (let wx = ccx + N - h - dcx; wx < ccx + N - h; wx++) { const sx = ((wx % N) + N) % N; for (let r = 0; r < N; r++) this._coverClear(sx + r * N); }
      else if (dcx < 0) for (let wx = ccx - h; wx < ccx - h - dcx; wx++) { const sx = ((wx % N) + N) % N; for (let r = 0; r < N; r++) this._coverClear(sx + r * N); }
      if (dcz > 0) for (let wz = ccz + N - h - dcz; wz < ccz + N - h; wz++) { const sz = (((wz % N) + N) % N) * N; for (let r = 0; r < N; r++) this._coverClear(sz + r); }
      else if (dcz < 0) for (let wz = ccz - h; wz < ccz - h - dcz; wz++) { const sz = (((wz % N) + N) % N) * N; for (let r = 0; r < N; r++) this._coverClear(sz + r); }
      if (dcx || dcz) cv.dirty = true;
    }
    cv.cx = ccx; cv.cz = ccz; cv.init = true;
    if (nav && typeof nav.itemsIn === 'function') {
      if (q < 1) q = 1;
      const eye = c.y, e0 = cs * 0.01, items = this._cvItems;
      let checks = rq.coverChecks > NN ? NN : rq.coverChecks, i = cv.i;
      while (q > 0 && checks > 0) {
        checks--;
        const k = i;
        i++; if (i >= NN) i = 0;
        const wx = ccx + cv.ox[k], wz = ccz + cv.oz[k];
        const s = (((wx % N) + N) % N) + (((wz % N) + N) % N) * N;
        const x = (wx + 0.5) * cs, z = (wz + 0.5) * cs;
        const loaded = this._chunkLoaded(nav, x, z);
        if (cv.WX[s] === wx && cv.WZ[s] === wz) {
          if (cv.L[s]) { if ((eye > cv.VL[s] && eye < cv.VH[s]) || eye === cv.E[s]) continue; }
          else if (!loaded) continue;
        }
        let hi = -Infinity, lo = Infinity, wall = 0, vl = -Infinity, vh = Infinity;
        if (loaded) {
          // 升（端は少し内側 = 升の境目にちょうど接する壁は入れない）にかかる要素の下面（スロープは裏面）のうち目より上のもの
          items.length = 0;
          nav.itemsIn(wx * cs + e0, wz * cs + e0, (wx + 1) * cs - e0, (wz + 1) * cs - e0, items);
          for (let n = 0; n < items.length; n++) {
            const b = items[n];
            if (b.k !== 1 && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
              if (b.y0 <= eye && b.y1 >= eye) wall = 1;
              if (b.y1 < eye) { if (b.y1 > vl) vl = b.y1; } else if (b.y1 < vh) vh = b.y1;
            }
            const top = b.k === 1 ? b.y1 - b.t : b.y0, bot = b.k === 1 ? b.y0 - b.t : b.y0;
            if (top < eye) { if (top > vl) vl = top; } else if (top < vh) vh = top;
            if (bot < eye) { if (bot > vl) vl = bot; } else if (bot < vh) vh = bot;
            if (top < eye) continue;
            if (top > hi) hi = top;
            const l = bot > eye ? bot : eye;
            if (l < lo) lo = l;
          }
          items.length = 0;
          q--; this.stats.coverQueries++;
        }
        const hh = hi > -Infinity ? hi : Infinity;
        cv.WX[s] = wx; cv.WZ[s] = wz; cv.E[s] = eye; cv.VL[s] = vl; cv.VH[s] = vh; cv.L[s] = loaded ? 1 : 0; cv.Lo[s] = lo; cv.W[s] = wall;
        if (cv.H[s] !== hh) { cv.H[s] = hh; this._coverWrite(s, hh); }
      }
      cv.i = i;
    }
    if (cv.dirty) { cv.tex.needsUpdate = true; cv.dirty = false; this.stats.coverUploads++; }
  }
  // 屋根の地図のまわり indoorRadius m の升で開いた（目の上 indoorCeiling m に天井が無い）升の割合（分かる升だけ。壁・入れない建物の
  //   中の升は数えない = 入れない建物は「開いた」所ではない。無ければ −1）
  _coverOpen(eye) {
    const cv = this.cv, N = cv.N, lim = eye + this.vc.indoorCeiling;
    let open = 0, n = 0;
    for (let k = 0; k < cv.ring; k++) {
      const wx = cv.cx + cv.ox[k], wz = cv.cz + cv.oz[k];
      const s = (((wx % N) + N) % N) + (((wz % N) + N) % N) * N;
      if (cv.WX[s] !== wx || cv.WZ[s] !== wz || !cv.L[s] || cv.W[s]) continue;
      n++;
      if (!(cv.Lo[s] < lim)) open++;
    }
    return n ? open / n : -1;
  }
  // テスト用: 雨のシェーダーと同じ式で、その点の粒を屋根の地図が消すか
  coverHides(x, y, z) {
    const cv = this.cv;
    if (!cv) return false;
    const N = cv.N, wx = Math.floor(x / cv.cs), wz = Math.floor(z / cv.cs);
    const s = (((wx % N) + N) % N) + (((wz % N) + N) % N) * N;
    const v = cv.bytes[s * 4] * 256 + cv.bytes[s * 4 + 1];
    return v < 65535 && y < v * 0.0625 - 512;
  }

  // 粒・水しぶきの画像（sRGB の色・まっすぐのアルファ。シェーダーで sRGBToLinear）。届くまで・無ければシェーダーの形（has 0）
  _loadSprite(assets, path, texU, hasU, field) {
    if (!assets || typeof assets.resolve !== 'function' || typeof assets.loadTexture !== 'function' || (this.game.rs && this.game.rs.textures === false)) return;
    let key = null;
    try { key = assets.resolve(path); } catch (e) { key = null; }
    if (!key) return;
    const opts = { srgb: false };
    if (this.rq.textureMax) opts.maxSize = this.rq.textureMax;
    this[field] = 'loading';
    let pr;
    try { pr = Promise.resolve(assets.loadTexture(key, opts)); } catch (e) { pr = Promise.reject(e); }
    pr.then((t) => {
      if (this.disposed || !t) return;
      texU.value = t; hasU.value = 1; this[field] = 'files';
    }, (e) => { this[field] = 'failed'; console.warn('[Weather] 画像を読めません（シェーダーの形で続けます）:', path, e && e.message); });
  }

  _buildSplash(assets) {
    const rq = this.rq, M = Math.max(0, Math.round(rq.splashMax || 0)), P = Math.max(0, Math.round(rq.splashPool || 0));
    this.splash = null;
    this.splashSource = 'off';
    if (rq.splashes === false || !M || !P || !this.rain) return;
    const g = WeatherView.quad();
    const arr = new Float32Array(M * 4);
    for (let i = 0; i < M; i++) arr[i * 4 + 3] = -1e4;
    const attr = new THREE.InstancedBufferAttribute(arr, 4);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSplash', attr);
    g.instanceCount = M;
    const u = this.su = WeatherView.fogUniforms({
      tFlip: { value: WeatherView.blankCloud() }, uHasTex: { value: 0 },
      uSpl: { value: new Float32Array([0, 1, this.vc.splashLife, this.vc.splashSize]) },   // 時計・不透明度・長さ（秒）・1 コマの大きさ（m）
      uColor: { value: new Float32Array([0.5, 0.5, 0.5]) }
    });
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: WeatherView.SPLASH_VERT, fragmentShader: WeatherView.SPLASH_FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: true, side: THREE.DoubleSide });
    mat.name = 'weatherSplash';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'weatherSplash';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.scene.add(mesh);
    this.splash = mesh;
    this._splAttr = attr;
    this._splW = 0;
    this._lazy.push(mesh);
    // 候補の点（x, y, z, 種類 0 = 無し / 1 = 乾いた地面 / 2 = 水 / 3 = 使えない（屋根の下・高さが離れている））
    this._pX = new Float32Array(P); this._pY = new Float32Array(P); this._pZ = new Float32Array(P);
    this._pK = new Uint8Array(P); this._pD = new Float32Array(P);
    this._gbuf = [];
    // 乱数の表（毎フレームの Math.random は V8 で最適化されないと小数の箱を作る。表を順に読む）。天気の seed から作る（Math.random を使うと
    //   天気のあるゲームだけ後の乱数（敵の湧く場所など）がずれ、天気あり / なしの画・数を比べられなかった）
    this._rt = new Float32Array(1024);
    let rs = ((this.weather.seed >>> 0) ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < 1024; i++) {
      rs = (rs + 0x6d2b79f5) >>> 0;
      let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      this._rt[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    this._ri = 0;
    this.poolDry = 0; this.poolWater = 0; this._waterNear = false;
    this.splashSource = 'procedural';
    this._loadSprite(assets, 'textures/weather/splash_flipbook.png', u.tFlip, u.uHasTex, 'splashSource');
  }

  // 水たまりの画像（wet_mask.png: データ = LinearEncoding、RepeatWrapping、ミップマップ）。puddles: false・無いときは 1×1 の代わり（水たまり無し）
  _loadWetMask(assets) {
    const M = this.game.materials;
    this.wetU = M && M.wetUniforms ? M.wetUniforms : null;
    this.wetSource = this.wetU ? 'none' : 'off';
    if (!this.wetU) return;
    const Wc = this.cfg.wet || {}, num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
    this.wetU.uMaskTile.value = Wc.maskTile || 6;
    // 濡れた見た目の数（game.json の weather.wet。無いキーは materials.js の既定 = 今までの見た目）
    const mo = Array.isArray(Wc.mottle) ? Wc.mottle : [];
    if (this.wetU.uWetLook) this.wetU.uWetLook.value.set(num(Wc.darken, 0.3), num(Wc.rough, 0.5), num(Wc.puddleRough, 0.05), num(Wc.puddleDark, 0.35));
    if (this.wetU.uWetMottle) this.wetU.uWetMottle.value.set(num(mo[0], 0.55), num(mo[1], 0.9), num(Wc.roughMottle, 1.4), Math.max(1e-3, num(Wc.puddleEdge, 0.04)));
    if (this.wetU.uWetFar) this.wetU.uWetFar.value = num(Wc.farDarken, 0.28);
    if (this.rq.puddles === false || !assets || typeof assets.resolve !== 'function' || typeof assets.loadTexture !== 'function' || (this.game.rs && this.game.rs.textures === false)) return;
    let key = null;
    try { key = assets.resolve('textures/weather/wet_mask.png'); } catch (e) { key = null; }
    if (!key) return;
    const opts = { srgb: false, anisotropy: 4 };
    if (this.rq.textureMax) opts.maxSize = this.rq.textureMax;
    this.wetSource = 'loading';
    let pr;
    try { pr = Promise.resolve(assets.loadTexture(key, opts)); } catch (e) { pr = Promise.reject(e); }
    pr.then((t) => {
      if (this.disposed || !t) return;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this.wetU.tWetMask.value = t;
      this.wetSource = 'files';
    }, (e) => { this.wetSource = 'failed'; console.warn('[Weather] wet_mask.png を読めません（水たまり無しで続けます）:', e && e.message); });
  }

  // 川の波紋の形（game.json の weather.view → water.js の uRipple / uRippleK / uRippleD / uRippleN）。1 画素の大きさ（uRippleK.w）は毎フレーム
  _initRipples() {
    const w = this.water && this.water.uniforms, vc = this.vc;
    if (!w || !w.uRipple) return;
    const arr = (a, d) => d.map((x, i) => (Array.isArray(a) && Number.isFinite(Number(a[i])) ? Number(a[i]) : x));
    const cells = arr(vc.rippleCells, [0.8, 0.45, 0.25]), full = arr(vc.rippleFull, [0.4, 0.6, 0.9]), dist = arr(vc.rippleDist, [25, 40]), nr = arr(vc.rippleNear, [4, 7]);
    const r = w.uRipple.value, k = w.uRippleK.value, d = w.uRippleD.value, n = w.uRippleN.value;
    this._pxAt1m();
    r[0] = cells[0]; r[1] = cells[1]; r[2] = cells[2]; r[3] = vc.rippleWidth;
    k[0] = Math.max(1e-3, full[0]); k[1] = Math.max(1e-3, full[1]); k[2] = Math.max(1e-3, full[2]); k[3] = this._rv[18];
    d[0] = dist[0]; d[1] = Math.max(dist[0] + 0.01, dist[1]); d[2] = nr[0]; d[3] = Math.max(nr[0] + 0.01, nr[1]);
    n[0] = vc.rippleNormal; n[1] = Math.max(1e-3, vc.rippleOnset); n[2] = vc.rippleDot; n[3] = Math.max(1e-3, vc.rippleDotSize);
  }
  // 本体のカメラで 1 m 先の 1 画素の大きさ（m）= 2 tan(縦の視野 / 2) / 描く高さ → _rv[18]（小数を返すと箱を作ることがある）
  _pxAt1m() {
    const cam = this.game.mainCamera || this.game.camera, el = this.renderer && this.renderer.domElement;
    const hpx = el && el.height ? el.height : 720, fov = cam && cam.fov ? cam.fov : 70;
    this._rv[18] = 2 * Math.tan(fov * 0.008726646259971648) / hpx;
  }

  // 閉じた操縦席・車内の 1 人称か（雨を窓の内側に描かない・音を下げる）。ヘリ・戦闘機は def.roof が false でなければ屋根あり、
  //   車は def.roof のあるもの（M4 の vehicles.types.<id>.roof）。輸送ヘリ（バトロワ）も中
  _cabinKind() {
    const g = this.game, v = g.vehicle;
    if ((g.royale && g.royale.riding) || (g.cityOnline && g.cityOnline.riding)) return 'heli';
    if (!v || g.freeCam || (g.player && g.player.dead)) return null;
    const roof = v.def ? v.def.roof : undefined;
    if (v.kind === 'heli') return !g.heliChase && roof !== false ? 'heli' : null;
    if (v.kind === 'jet') return !g.jetChase && roof !== false ? 'jet' : null;
    return roof ? 'car' : null;
  }

  // 毎フレーム（_update の中）: カメラの速さ・濡れ・粒の落ちた量・室内と候補の点（4 Hz）・水しぶき・音
  _rainTick(dt, p) {
    const g = this.game, vc = this.vc, rq = this.rq;
    const c = this._cu;
    if (g.camera && typeof g.camera.getWorldPosition === 'function') { g.camera.getWorldPosition(c); g.camera.getWorldDirection(this._fw); }
    const v = this.camVel;
    let jumped = false;
    if (this._hasPrev && dt > 0) {
      const dx = c.x - this._cp.x, dy = c.y - this._cp.y, dz = c.z - this._cp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // 飛んだ = velJump m と「どの乗り物より速い」velJumpSpeed × dt m の両方より遠く（30 / 20 fps の速い戦闘機は 1 フレームに 5 m より動く）
      if (d > rq.velJump && d > rq.velJumpSpeed * dt) {
        v.x = 0; v.y = 0; v.z = 0; this.stats.velResets++; jumped = true;
        if (this._pK) this._pK.fill(0);   // 水しぶきの候補の点は前の場所のもの
      } else {
        let k = 1 / dt;
        const sp = d * k;
        if (sp > rq.velMax) k *= rq.velMax / sp;
        v.x = dx * k; v.y = dy * k; v.z = dz * k;
      }
    } else { v.x = 0; v.y = 0; v.z = 0; }
    this._rv[7] = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    this._cp.copy(c);
    this._hasPrev = true;
    // 粒が速さで消えていない割合と雲の層の下の割合（音・屋根の地図・水しぶきの候補の点。描く粒は _rainPreRender が同じ式）
    {
      let lod = 1, cl = 1;
      const sp = this._rv[7], sm = rq.streakMaxSpeed, s0 = sm * vc.speedFadeFrom;
      if (sp > s0) { const f = sp >= sm ? 1 : (sp - s0) / (sm - s0); lod = 1 - f * f * (3 - 2 * f); }
      const cH = this.u && this.u.cloudH ? this.u.cloudH.value : 0, c0 = cH * vc.cloudFadeFrom;
      if (cH > 0 && c.y > c0) cl = c.y >= cH ? 0 : 1 - (c.y - c0) / (cH - c0);
      this._rv[19] = lod; this._rv[20] = cl;
    }
    // 濡れ（最初と飛んだフレームはすぐ目標へ）
    const W = this.cfg.wet || {}, tw = p.wetTarget;
    if (!this._wetInit || p.jumped) { this._rv[11] = tw; this._wetInit = true; }
    else if (this._rv[11] < tw) { this._rv[11] += dt / Math.max(0.001, W.riseSec || 60); if (this._rv[11] > tw) this._rv[11] = tw; }
    else if (this._rv[11] > tw) { this._rv[11] -= dt / Math.max(0.001, W.drySec || 240); if (this._rv[11] < tw) this._rv[11] = tw; }
    // 水たまり: 濡れ we が puddleKnee までは puddleLight × (we / knee)²、その先は puddleStorm へまっすぐ（雨の濡れ 0.8 で puddleLight、雷雨 1 で puddleStorm）
    const pl = W.puddleLight == null ? 0.05 : W.puddleLight, ps = W.puddleStorm == null ? 0.3 : W.puddleStorm, we = this._rv[11];
    const kn = W.puddleKnee > 0 && W.puddleKnee < 1 ? W.puddleKnee : 0.8;
    this._rv[12] = we < kn ? pl * (we / kn) * (we / kn) : pl + (ps - pl) * (we - kn) / (1 - kn);
    // 粒の落ちた量（風 × rainWind で横へ）と、カメラから見た粒の速さ
    if (this.rain) {
      const b = this.ru.uBox.value, fs = vc.fallSpeed, wk = vc.rainWind;   // uBox は変わらない
      const vx = p.windX * wk, vy = -fs, vz = p.windZ * wk;
      let x = this._rv[0] + vx * dt; x -= Math.floor(x / b.x) * b.x; this._rv[0] = x;
      let y = this._rv[1] + vy * dt; y -= Math.floor(y / b.y) * b.y; this._rv[1] = y;
      let z = this._rv[2] + vz * dt; z -= Math.floor(z / b.z) * b.z; this._rv[2] = z;
      const rx = vx - v.x, ry = vy - v.y, rz = vz - v.z, rs = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (rs > 0.001) { this._rv[3] = rx / rs; this._rv[4] = ry / rs; this._rv[5] = rz / rs; }
      this._rv[6] = rs;
    }
    this.cabin = this._cabinKind();
    // 室内（4 Hz）と水しぶきの候補の点
    this._rv[10] -= dt;
    if (this._rv[10] <= 0) {
      const hz = Math.max(0.5, vc.indoorHz);
      this._rv[10] += 1 / hz;
      if (this._rv[10] < 0) this._rv[10] = 0;
      const nav = g.world && g.world.nav;
      this._chunkMask(nav, c, 1 / hz);
      this._rv[9] = this._indoorTarget(nav, c);
      if (this.splash && p.rain > 0.005 && this._rv[9] < 0.5 && this._rv[19] * this._rv[20] > 0) this._poolTick(nav, c);
    }
    // 屋根の地図（雨の間だけ。4 Hz のチャンクの印の後）。粒が 1 つも見えない間（速いカメラ・雲の層の上）は問い合わせない（窓も動かさない。
    //   また見えたら窓の動いた分の升を空にしてから、遠くへ動いていれば全部やり直す）。以前は 250 m/s の戦闘機でも毎秒 約 3000 回問い合わせていた
    if (this.cv && p.rain > 0 && this._rv[19] * this._rv[20] > 0) this._coverTick(g.world && g.world.nav, c, dt, jumped || !this.cv.init);
    else if (this.cv && p.rain > 0) { if (jumped) this.cv.init = false; this.stats.coverSkips++; }
    else if (this.cv) this.cv.init = false;   // 雨の無い間に動いた分は次の雨の始めに全部やり直す
    const fd = dt / Math.max(0.001, vc.indoorFadeSec);
    if (this._rv[8] < this._rv[9]) { this._rv[8] += fd; if (this._rv[8] > this._rv[9]) this._rv[8] = this._rv[9]; }
    else if (this._rv[8] > this._rv[9]) { this._rv[8] -= fd; if (this._rv[8] < this._rv[9]) this._rv[8] = this._rv[9]; }
    if (this.splash) this._splashTick(dt, p);
    if (this.sound) {
      const s = this.sound, si = s.inp;
      si[0] = this._rv[8];
      si[1] = this.cabin ? 1 : 0;
      si[2] = g._windVol || 0;
      // 外の雨の音も粒と同じく、速いカメラでは下げ（× fast まで。粒は M4 で画面の雨に替わる。300 m を 620 km/h で飛ぶ戦闘機の
      //   チェイスカメラで、粒が 1 つも無いのに雨の音だけ外と同じ大きさだった）、雲の層の上では 0（屋根の音も。雲の上の操縦席で雨が鳴っていた）
      si[4] = this._rv[19];
      si[5] = this._rv[20];
      s.update(dt, p);
    }
  }

  // カメラの周り 3 × 3 のチャンクが当たり判定にあるか（ビット）。キーの文字列を作るのはカメラのチャンクが変わったときと 1 秒ごとだけ
  _chunkMask(nav, c, step) {
    if (!nav || typeof nav.hasChunk !== 'function' || !nav.chunkSize) { this._ckMask = 511; return; }
    const cs = nav.chunkSize, cx = Math.floor((c.x - nav.minX) / cs), cz = Math.floor((c.z - nav.minZ) / cs);
    this._rv[17] += step;
    if (cx === this._ckX && cz === this._ckZ && this._rv[17] < 1) return;
    this._ckX = cx; this._ckZ = cz; this._rv[17] = 0;
    let m = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (nav.hasChunk((cx + i) + '_' + (cz + j))) m |= 1 << ((j + 1) * 3 + i + 1);
    this._ckMask = m;
  }
  _chunkLoaded(nav, x, z) {
    if (!nav || typeof nav.hasChunk !== 'function' || !nav.chunkSize) return true;
    const cs = nav.chunkSize, i = Math.floor((x - nav.minX) / cs) - this._ckX, j = Math.floor((z - nav.minZ) / cs) - this._ckZ;
    if (i < -1 || i > 1 || j < -1 || j > 1) return false;
    return (this._ckMask & (1 << ((j + 1) * 3 + i + 1))) !== 0;
  }
  // 頭の上 indoorCeiling m より低い天井があれば屋根の下。カメラのチャンクが当たり判定に無ければ外
  _queryIndoor(nav, c) {
    if (!nav || typeof nav.ceilingHeight !== 'function') return false;
    if (!this._chunkLoaded(nav, c.x, c.z)) return false;
    this.stats.indoorQueries++;
    return nav.ceilingHeight(c.x, c.z, c.y, 0) - c.y < this.vc.indoorCeiling;
  }
  // 室内の度合い（0..1）: 屋根の下でなければ 0。屋根の下なら屋根の地図のまわりの開いた升の割合 f から 1 − f × indoorOpenK
  //   （ひさし・高架の下で通りがすぐそこなら外）。地図が無い・まだ分からなければ 1
  _indoorTarget(nav, c) {
    if (!this._queryIndoor(nav, c)) return 0;
    if (!this.cv || !this.cv.init) return 1;
    const f = this._coverOpen(c.y);
    if (f < 0) return 1;
    const k = 1 - f * this.vc.indoorOpenK;
    return k < 0 ? 0 : k;
  }
  // 候補の点を splashPoolQueriesPerTick 個作り直す（空き・使えない点 → 輪の外 → 遠い順）
  _poolTick(nav, c) {
    if (!nav || typeof nav.groundInfo !== 'function') return;
    this.stats.poolTicks++;
    const K = this._pK, X = this._pX, Z = this._pZ, D = this._pD, P = K.length, R = this.rq.splashRadius;
    const T = this._rt;
    for (let i = 0; i < P; i++) {
      if (K[i] === 0 || K[i] === 3) { D[i] = 2e9 + T[(this._ri = (this._ri + 1) & 1023)]; continue; }
      const dx = X[i] - c.x, dz = Z[i] - c.z, d = Math.sqrt(dx * dx + dz * dz);
      D[i] = d > R ? 1e9 + d : d;
    }
    const Q = Math.min(P, Math.max(0, this.rq.splashPoolQueriesPerTick | 0));
    for (let q = 0; q < Q; q++) {
      let bi = 0, bd = -1;
      for (let i = 0; i < P; i++) if (D[i] > bd) { bd = D[i]; bi = i; }
      D[bi] = -1;
      this._poolQuery(nav, bi, c);
    }
    let dry = 0, water = 0;
    for (let i = 0; i < P; i++) { if (K[i] === 1) dry++; else if (K[i] === 2) water++; }
    this.poolDry = dry; this.poolWater = water; this._waterNear = water > 0;
  }
  _poolQuery(nav, i, c) {
    const R = this.rq.splashRadius, vc = this.vc, T = this._rt, r0 = vc.splashMinR < R ? vc.splashMinR : 0;
    // 輪（splashMinR〜splashRadius m）の中で面積が一様に（すぐ足元の大きな水しぶきは出さない）
    const r = Math.sqrt(r0 * r0 + (R * R - r0 * r0) * T[(this._ri = (this._ri + 1) & 1023)]), a = T[(this._ri = (this._ri + 1) & 1023)] * 6.283185307179586;
    const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
    this._pX[i] = x; this._pZ[i] = z; this._pK[i] = 0;
    if (!this._chunkLoaded(nav, x, z)) return;
    this.stats.navQueries++;
    const gi = nav.groundInfo(x, z, c.y + 2, 0, this._gbuf);   // 小さな物を 2 つ作る（nav の作り。4 Hz × 8 点まで = 毎秒 32 回まで）
    const y = gi.y, w = gi.water;
    if (w !== null && w !== undefined && (y === null || w > y)) { this._pY[i] = w; this._pK[i] = 2; return; }
    if (y === null || Math.abs(y - c.y) > vc.splashMaxDy) { this._pK[i] = 3; return; }
    this.stats.ceilQueries++;
    if (nav.ceilingHeight(x, z, y + 0.1, 0) - y < vc.splashCover) { this._pK[i] = 3; return; }
    this._pY[i] = y; this._pK[i] = 1;
  }
  // 水しぶき: 時計（256 秒ごとに全部の t0 と一緒に引く）、乾いた点に 1 フレーム splashPerSec × dt × splashCapK + 1 個まで
  _splashTick(dt, p) {
    const vc = this.vc, attr = this._splAttr, arr = attr.array, M = arr.length >> 2;
    this._rv[14] += dt;
    if (this._rv[14] >= vc.clockRebase) {
      const R = vc.clockRebase;
      this._rv[14] -= R; this._rv[15] -= R;
      for (let i = 0; i < M; i++) arr[i * 4 + 3] -= R;
      attr.needsUpdate = true;
      this.stats.rebases++;
    }
    if (!(p.rain > 0.01) || this._rv[9] > 0.5 || this._rv[8] > 0.5 || this.poolDry <= 0) { this._rv[16] = 0; return; }
    this._rv[16] += this.rq.splashPerSec * p.rain * dt;
    let n = Math.floor(this._rv[16]);
    // 上限はこのフレームの長さの分（以前は 1 フレーム 4 個で、20 fps の雷雨は 120 / 秒のつもりが 80 / 秒だった）
    const cap = Math.ceil(this.rq.splashPerSec * dt * vc.splashCapK) + 1;
    if (n > cap) n = cap;
    this._rv[16] -= n;
    if (this._rv[16] > 1) this._rv[16] = 1;
    const K = this._pK, P = K.length, T = this._rt, X = this._pX, Z = this._pZ, cx = this._cu.x, cz = this._cu.z, fx = this._fw.x, fz = this._fw.z;
    const R2 = (this.rq.splashRadius + 2) * (this.rq.splashRadius + 2);
    let wrote = 0, ri = this._ri;
    for (let s = 0; s < n; s++) {
      // 乾いた点を 8 回まで引く。カメラの前（水平に見て前の半分）の点が先（見えない後ろに出しても数だけ使う）
      let i = -1;
      for (let tr = 0; tr < 8; tr++) {
        ri = (ri + 1) & 1023;
        const j = Math.floor(T[ri] * P);
        if (K[j] !== 1) continue;
        const ex = X[j] - cx, ez = Z[j] - cz;
        if (ex * ex + ez * ez > R2) continue;   // まだ作り直していない遠い点（動いた後）
        if (i < 0) i = j;
        if (ex * fx + ez * fz > 0) { i = j; break; }
      }
      if (i < 0) continue;
      const o = this._splW * 4;
      ri = (ri + 1) & 1023;
      arr[o] = this._pX[i] + (T[ri] - 0.5) * vc.splashJitter;
      arr[o + 1] = this._pY[i] + 0.01;
      ri = (ri + 1) & 1023;
      arr[o + 2] = this._pZ[i] + (T[ri] - 0.5) * vc.splashJitter;
      arr[o + 3] = this._rv[14];
      this._splW = (this._splW + 1) % M;
      wrote++;
    }
    this._ri = ri;
    if (wrote) { attr.needsUpdate = true; this._rv[15] = this._rv[14]; this.stats.splashes += wrote; }
  }

  // 描く前（preRender から）: 雨・水しぶき・濡れの uniform
  _rainPreRender(c, p) {
    const vc = this.vc, rq = this.rq;
    // 濡れ: 0.002 より変わったか目標に着いたときだけ書く（{ value } の小数は書くたびに箱を作る。乾く間は数分ずっと変わる）
    if (this.wetU) {
      const uw = this.wetU.uWet, up = this.wetU.uPuddle, wv = this._rv[11], pv = rq.puddles === false ? 0 : this._rv[12];
      if (uw.value !== wv && (Math.abs(uw.value - wv) > 0.002 || wv === p.wetTarget)) uw.value = wv;
      if (up.value !== pv && (Math.abs(up.value - pv) > 0.002 || wv === p.wetTarget)) up.value = pv;
    }
    const sky = this.sky, h = sky && sky.hemi, sn = sky && sky.sun, base = sky && sky._wx;
    // 粒の色（リニア）: rainColor × rainLight × 半球光の強さの比（雨 0.7・雷雨 0.55）+ 太陽を少し
    const rc = this._rainCol, k1 = vc.rainLight * (h && base && base.hemiI > 0 ? h.intensity / base.hemiI : 1), k2 = sn ? sn.intensity * vc.rainSun : 0;
    const cr = rc[0] * k1 + (sn ? sn.color.r : 1) * k2, cg = rc[1] * k1 + (sn ? sn.color.g : 1) * k2, cb = rc[2] * k1 + (sn ? sn.color.b : 1) * k2;
    if (this.rain) {
      const u = this.ru, r = p.rain;
      let op = 0, fk = 0;
      if (r > 0) {
        const fi = vc.rainFadeIn, a = r >= fi ? 1 : r / fi;
        fk = a * a * (3 - 2 * a);
        op = fk * (vc.rainOpMin + (1 - vc.rainOpMin) * r);
        // 屋根の地図が無い（頂点のテクスチャが使えない）ときは室内で全部消す
        if (!this.cv) op *= 1 - this._rv[8];
        // 速いと消す（M4 で画面の雨に替わる）・雲の層より上は無し
        const sp = this._rv[7], sm = rq.streakMaxSpeed, s0 = sm * vc.speedFadeFrom;
        if (sp > s0) { const f = sp >= sm ? 1 : (sp - s0) / (sm - s0); op *= 1 - f * f * (3 - 2 * f); }
        const cH = this.u.cloudH.value, c0 = cH * vc.cloudFadeFrom;
        if (c.y > c0) { const f = c.y >= cH ? 1 : (c.y - c0) / (cH - c0); op *= 1 - f; }
      }
      this._rv[13] = op;
      const rp = u.uRainP.value;
      rp[0] = op;
      const vis = op > 0.002;
      this.rain.visible = vis;
      if (vis) {
        let o = u.uFall.value; o[0] = this._rv[0]; o[1] = this._rv[1]; o[2] = this._rv[2];
        o = u.uDir.value; o[0] = this._rv[3]; o[1] = this._rv[4]; o[2] = this._rv[5];
        let L = this._rv[6] / vc.fallSpeed;
        L = L < 1 ? 1 : (L > vc.streakMax ? vc.streakMax : L);
        rp[1] = rq.dropLen * L;
        const cc = this.cabin && rq.cabinClear ? rq.cabinClear[this.cabin] : 0;
        rp[3] = cc > 0 ? cc : rq.nearFade;
        // 1 m 先の 1 画素（縦の視野 / 描く高さ）と、粒の幅の上限（dropMaxPx は CSS の画素 × 描く解像度の倍率）
        const px = u.uPx.value;
        this._pxAt1m();
        px[0] = this._rv[18];
        const pr = this.renderer && typeof this.renderer.getPixelRatio === 'function' ? this.renderer.getPixelRatio() : 1;
        const mx = (rq.dropMaxPx || 0) * pr;
        px[2] = mx > px[1] ? mx : (rq.dropMaxPx ? px[1] : 1e6);
        // 粒の数も rainFadeIn より弱い雨では同じ割合で減らす（降り始め・やみ際は粒が少なく薄い。以前は数が dropsMin で止まり、雨 0.04 でも雨の
        //   粒の半分が薄く描かれて、やみ際の画素の 47 % が雨だった）
        const dm = rq.dropsMin, n = Math.round(this.rainCount * (r >= 1 ? 1 : dm + (1 - dm) * r) * fk);
        if (this.rain.geometry.instanceCount !== n) this.rain.geometry.instanceCount = n;
        o = u.uColor.value; o[0] = cr; o[1] = cg; o[2] = cb;
      }
    }
    if (this.splash) {
      const u = this.su, vis = this._rv[14] - this._rv[15] < vc.splashLife + 0.05;
      this.splash.visible = vis;
      if (vis) {
        const sp = u.uSpl.value;
        sp[0] = this._rv[14]; sp[1] = 1 - this._rv[8];
        const o = u.uColor.value, kb = vc.splashBright; o[0] = cr * kb; o[1] = cg * kb; o[2] = cb * kb;
      }
    }
  }
};

MR.WeatherView.DOME_VERT = [
  'varying vec3 vDir;',
  'void main() {',
  '  vDir = position;',
  '  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '  gl_Position = p.xyww;',   // いつも一番奥（描かれていない所だけに出る）
  '}'
].join('\n');

// 雲の層（cloudH）+ 巻雲（cirrusH）+ 地平線の霞 + 霧が濃いときの地平線より下の霧の色。alpha 0 で何も描かない（discard しない）
MR.WeatherView.DOME_FRAG = [
  'uniform sampler2D tA; uniform sampler2D tB;',
  'uniform vec3 camPos; uniform vec3 sunDir; uniform vec3 sunCol;',
  'uniform float coverage; uniform float softness; uniform float erode; uniform float overcast; uniform float cirrus;',
  'uniform vec2 offA; uniform vec2 offB; uniform vec2 offC;',
  'uniform vec3 litCol; uniform vec3 shadeCol; uniform vec3 ovCol; uniform vec3 cirCol; uniform vec3 hazeCol;',
  'uniform float cloudH; uniform float cirrusH; uniform float scaleA; uniform float scaleB; uniform float hazeDist; uniform float opacity;',
  'uniform float fade; uniform float hazeDense; uniform vec2 band;',
  'varying vec3 vDir;',
  'vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }',
  'void main() {',
  '  vec3 rd = normalize(vDir);',
  '  float up = rd.y;',
  '  vec3 C = hazeCol;',
  '  float A = 0.0;',
  '  if (up < 0.002) {',
  // 地平線より下: 曇っているときだけ霞（背景の画の地面の色を隠す）
  '    A = overcast * (1.0 - smoothstep(0.0, 0.25, -up));',
  '  } else {',
  '    float sunPhase = max(dot(rd, sunDir), 0.0);',
  '    float t = max(cloudH - camPos.y, 50.0) / max(up, 0.012);',
  '    vec2 p = camPos.xz + rd.xz * t;',
  '#if CLOUDS',
  // 巻雲（高い・後ろ）
  '    float tC = max(cirrusH - camPos.y, 100.0) / max(up, 0.02);',
  '    vec2 pc = camPos.xz + rd.xz * tC;',
  '    float cg = texture2D(tB, rot(pc, -0.35) / (scaleB * 2.3) + offC).g;',
  '    float ci = cirrus * smoothstep(0.76, 1.0, cg) * 0.55;',
  '    vec3 ccol = cirCol + sunCol * pow(sunPhase, 5.0) * 0.6;',
  // 雲の層（積雲の場 + 細かい塊 + 一面の曇り）
  '    vec2 uvA = p / scaleA + offA;',
  '    vec3 a = texture2D(tA, uvA).rgb;',
  '    vec3 b = texture2D(tB, rot(p, 0.6) / scaleB + offB).rgb;',
  '    float thr = 1.0 - coverage;',
  '    float field = a.r + (b.r - 0.5) * 0.16;',
  '    float edge = 1.0 - smoothstep(thr, thr + 0.25, field);',
  '#if CLOUD_DETAIL',
  '    float det = texture2D(tA, uvA * 5.0 + vec2(0.31, 0.17)).g;',
  '    float g2 = mix(a.g, det, 0.5);',
  '#else',
  '    float g2 = a.g;',
  '#endif',
  '    float d = smoothstep(thr, thr + softness, field - (1.0 - g2) * erode * edge);',
  '    float thick = clamp((a.b - thr) / 0.22, 0.0, 1.0);',
  '#if CLOUD_DETAIL',
  '    vec2 sd = normalize(sunDir.xz + vec2(1e-4)) * 0.008;',
  '    float bS = texture2D(tA, uvA + sd).b;',
  '#else',
  '    float bS = a.b;',
  '#endif',
  '    float light = clamp(0.55 - (bS - a.b) * 9.0 + (g2 - 0.5) * 0.5 * (1.0 - 0.5 * thick), 0.0, 1.0) * (1.0 - 0.5 * thick);',
  '    d *= mix(0.6, 1.0, max(thick, overcast));',
  '    vec3 col = mix(shadeCol, litCol, light);',
  '    col += sunCol * pow(sunPhase, 7.0) * (1.0 - thick) * 0.9;',   // 太陽の側の縁が光る
  '    float ov = overcast * (0.86 + 0.14 * b.b);',
  '    vec3 ovc = ovCol * (0.82 + 0.36 * (b.b - 0.5) + 0.25 * (1.0 - a.b) * overcast);',
  '    float alpha = 1.0 - (1.0 - d) * (1.0 - ov);',
  '    vec3 deck = (col * d + ovc * ov * (1.0 - d)) / max(alpha, 1e-3);',
  '    A = alpha + ci * (1.0 - alpha);',
  '    C = (deck * alpha + ccol * ci * (1.0 - alpha)) / max(A, 1e-3);',
  '#else',
  // 雲の画が無い: 一面の曇りだけ（テクスチャを引かない）
  '    A = overcast * 0.93;',
  '    C = ovCol * (0.9 + 0.25 * (1.0 - overcast) * overcast) + sunCol * pow(sunPhase, 7.0) * 0.05 * (1.0 - overcast);',
  '#endif',
  // 地平線へ向かうほど霞
  '    float hz = 1.0 - exp(-t / hazeDist);',
  '    C = mix(C, hazeCol, hz);',
  '    A *= max(smoothstep(0.002, 0.05, up), overcast) * (1.0 - 0.6 * smoothstep(0.6, 1.0, hz) * (1.0 - overcast));',
  '  }',
  '  A *= opacity * fade;',
  '  gl_FragColor = vec4(C, A);',
  '  #include <encodings_fragment>',
  // 霧が濃い: 地平線より下と bandDeg までは霧の色・不透明（fadeDeg で元に戻る）。three の霧（fog_fragment）と同じく出力の色空間に
  //   直した後で混ぜる = 霧の中の建物とぴったり同じ色（コンポーザーの道でも canvas に直接描く道でも）
  '  float hd = hazeDense * (1.0 - smoothstep(band.x, band.y, up));',
  '  float A2 = A * (1.0 - hd) + hd;',
  '  gl_FragColor = vec4((gl_FragColor.rgb * A * (1.0 - hd) + hazeCol * hd) / max(A2, 1e-4), A2);',
  '}'
].join('\n');

// 雨の粒: 箱 uBox の中で世界に固定（落ちた量 uFall は CPU で丸めた値）。uRainP = (不透明度, 長さ, 幅, 近くで消す半径)。板は uDir（カメラから見た粒の速さの向き）に長さ分伸ばし、
//   向きとカメラへの向きの外積の向きに幅。頭（v 0）が進む側。近い粒と箱の端は消す
MR.WeatherView.RAIN_VERT = [
  'attribute vec4 aSeed;',
  'uniform vec3 uFall; uniform vec3 uBox; uniform vec3 uDir; uniform vec4 uRainP; uniform vec2 uOp; uniform vec3 uPx;',
  '#if COVER',
  'uniform sampler2D tCover; uniform vec2 uCover;',   // 屋根の地図（升の数・升の大きさ m）
  '#endif',
  'varying vec2 vUv; varying float vA;',
  '#include <fog_pars_vertex>',
  'void main() {',
  '  vec3 p = cameraPosition + mod(aSeed.xyz * uBox + uFall - cameraPosition, uBox) - uBox * 0.5;',
  '#if COVER',
  // 粒の升の天井（RG = (高さ + 512) × 16、65535 = 空）より下の粒は描かない（4 頂点とも画面の外 = 板ごと消える）
  '  vec4 cvt = texture2D(tCover, (mod(floor(p.xz / uCover.y), uCover.x) + 0.5) / uCover.x);',
  '  float cvh = floor(cvt.r * 255.0 + 0.5) * 256.0 + floor(cvt.g * 255.0 + 0.5);',
  '  if (cvh < 65534.5 && p.y < cvh * 0.0625 - 512.0) { vUv = vec2(0.0); vA = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }',
  '#endif',
  '  vec3 q = abs(p - cameraPosition) / (uBox * 0.5);',
  '  float edge = 1.0 - smoothstep(0.7, 1.0, max(q.x, max(q.y, q.z)));',
  '  vec3 toCam = cameraPosition - p;',
  '  vec3 side = cross(uDir, toCam);',
  '  float sl = length(side);',
  '  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);',
  '  float len = uRainP.y * (0.7 + 0.6 * fract(aSeed.w * 7.31));',
  // 幅は dropMinPx 画素より細くしない（遠い粒が 1 画素より細いとミップマップで薄まって見えなくなる）・dropMaxPx（CSS の画素）より太くしない
  //   （幅は世界の m なので、目の前 0.6〜1.5 m の粒が 10〜29 画素の太い半透明の棒になっていた）
  '  float dc = length(toCam) * uPx.x;',
  '  float wd = clamp(uRainP.z * (0.8 + 0.4 * aSeed.w), dc * uPx.y, dc * uPx.z);',
  '  vec3 wp = p - uDir * (position.y * len) + side * (position.x * wd);',
  '  float d = length(wp - cameraPosition);',
  '  vA = edge * smoothstep(uRainP.w, uRainP.w * 1.5 + 0.3, d) * mix(uOp.x, uOp.y, aSeed.w) * uRainP.x;',
  '  vUv = vec2(position.x + 0.5, position.y);',
  '  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '}'
].join('\n');

MR.WeatherView.RAIN_FRAG = [
  '#include <common>',
  'uniform sampler2D tStreak; uniform float uHasTex; uniform vec3 uColor; uniform float uCrop;',
  'varying vec2 vUv; varying float vA;',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  vec3 col = uColor;',
  '  float a;',
  '  if (uHasTex > 0.5) {',
  // rain_streak.png は 64 px の幅の真ん中 6 px が芯（まわりは薄い光）。板の幅は真ん中の uCrop（streakCrop）だけに当てる（0.14 で芯 = 板の約 2/3。
  //   0.3（芯 = 1/3）では板の幅の下限 dropMinPx でも芯が 0.5 画素で、タッチ端末の雨がほとんど見えなかった）
  '    vec4 t = sRGBToLinear(texture2D(tStreak, vec2(0.5 + (vUv.x - 0.5) * uCrop, vUv.y)));',
  '    a = t.a; col *= t.rgb;',
  '  } else {',
  // 画像が無い: 細い線（頭が明るく、尾に向かって消える）
  '    float x = 1.0 - abs(vUv.x * 2.0 - 1.0);',
  '    a = x * x * x * smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.08, 1.0, vUv.y));',
  '  }',
  '  gl_FragColor = vec4(col, a * vA);',
  '  #include <tonemapping_fragment>',
  '  #include <encodings_fragment>',
  '  #include <fog_fragment>',
  '}'
].join('\n');

// 水しぶき: aSplash = (x, y, z, 出た時刻)。Y 軸のまわりにカメラへ向ける板（1 コマ uSize m、地面に触れる所は v 0.18）。
//   uSpl = (時計, 不透明度, 長さ, 大きさ)。コマ = (時計 − t0) × 16 / 長さ（4 × 4、左上から行ごと）。終わった物は画面の外へ
MR.WeatherView.SPLASH_VERT = [
  'attribute vec4 aSplash;',
  'uniform vec4 uSpl;',   // 時計・不透明度・長さ・大きさ
  'varying vec2 vUv; varying float vF; varying float vAge;',
  '#include <fog_pars_vertex>',
  'void main() {',
  '  float f = (uSpl.x - aSplash.w) / uSpl.z;',
  '  vUv = vec2(position.x + 0.5, position.y); vF = 0.0; vAge = f;',
  '  if (f < 0.0 || f >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }',
  '  vec3 toC = cameraPosition - aSplash.xyz; toC.y = 0.0;',
  '  float tl = length(toC);',
  '  vec3 fw = tl > 1e-4 ? toC / tl : vec3(0.0, 0.0, 1.0);',
  '  vec3 right = vec3(fw.z, 0.0, -fw.x);',
  '  float s = uSpl.w * (0.8 + 0.5 * fract(sin(dot(aSplash.xz, vec2(12.9898, 78.233))) * 43758.5453));',
  '  vec3 wp = aSplash.xyz + right * (position.x * s) + vec3(0.0, (position.y - 0.18) * s, 0.0);',
  '  vF = min(floor(f * 16.0), 15.0);',
  '  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  #include <fog_vertex>',
  '}'
].join('\n');

MR.WeatherView.SPLASH_FRAG = [
  '#include <common>',
  'uniform sampler2D tFlip; uniform float uHasTex; uniform vec3 uColor; uniform vec4 uSpl;',
  'varying vec2 vUv; varying float vF; varying float vAge;',
  '#include <fog_pars_fragment>',
  'void main() {',
  '  vec3 col = uColor;',
  '  float a;',
  '  if (uHasTex > 0.5) {',
  '    float cx = mod(vF, 4.0), cy = floor(vF / 4.0);',
  '    vec4 t = sRGBToLinear(texture2D(tFlip, (vUv + vec2(cx, 3.0 - cy)) / 4.0));',
  '    a = t.a; col *= t.rgb;',
  '  } else {',
  // 画像が無い: 広がる冠（2 つの山）と消えていく粒
  '    float x = abs(vUv.x * 2.0 - 1.0), y = (vUv.y - 0.18) / 0.82;',
  '    float r = 0.15 + 0.7 * vAge;',
  '    a = exp(-pow((x - r) * 9.0, 2.0)) * (1.0 - smoothstep(0.0, 0.35 * (1.0 - vAge) + 0.05, abs(y - 0.1 * (1.0 - vAge)))) * (1.0 - vAge);',
  '  }',
  '  gl_FragColor = vec4(col, a * uSpl.y * 0.8);',
  '  #include <tonemapping_fragment>',
  '  #include <encodings_fragment>',
  '  #include <fog_fragment>',
  '}'
].join('\n');

// ---------- 天気の音（MR.WeatherAudio。WeatherView が作る。tools/audio-stress.js の場面 10 も本物を使う）----------
//   後からデコード（audio.lazyDecode。PCM は 48 kHz の float ステレオで 16 秒のループ 1 つ 約 6.2 MB なので、要る物だけ）:
//   雨の組（rain_light）は今の雨（p.rain）か今・次の枠（upcoming(t, 1)）の状態に雨がある間、強い雨の組（rain_heavy）は p.rain か今・次の状態の雨が
//   heavyFrom より強い間（雷雨。ふつうの雨 0.55 は rain_light だけ）、風の組（wind_gust）は雨があって今か次の状態の風が gustStateWind m/s 以上の間
//   （雷雨 12。雨 7 では鳴らさない）、屋根の組（rain_roof）は雨があって閉じた乗り物の中にいる間（出たら roofReleaseSec 秒で捨てる。ヘリ・輸送ヘリの
//   後も残っていた）、雷の組（thunder_near / far、M3）は今か次が雷雨の間。ほかの組は要らなくなって releaseSlots 枠たったら release（鳴っていれば
//   断られるので次の 4 Hz でもう一度）。天気オフ・アリーナは何もデコードしない。
//   ループ（audio.loop、環境音のバス）: 4 Hz で音量（setVolume = _glide、2 件 → 着いたら 1 件）。startAbove より大きくなったら始め、
//   stopBelow より小さいのが stopAfter 秒続いたら止める（fadeIn / fadeOut 秒、hz 回 / 秒）。雨 r、強い雨の度合い h =（r − heavyFrom）/（1 − heavyFrom）（0..1）、
//   聞こえる雨の量 a = r ≥ lightFull なら r、それより弱ければ lightFull ×（r / lightFull）^lightCurve（音の大きさの感じ方は振幅の約 0.6 乗なので、
//   1.5 乗で「聞こえる大きさ ≒ 雨の量」。やみ際の雨 0.03（知らせの所）で 0.013 = 粒が見えなくなる所でほぼ 0。以前は r / lightRamp（0.2）の min で、雨がやんでいく
//   移り変わりの 6 割まで（雨 0.2 まで）rain_light がいっぱいの音量のまま鳴っていた）:
//   rain_light =（1 − h²）× min(1, a / lightFull)、rain_heavy = h^1.5、室内 ×（1 − (1 − indoor) × 室内の度合い）、閉じた乗り物の中 × cabin
//   + rain_roof × a × roofInside、外の雨の粒が速いカメラで消える割合で × fast まで（inp[4]）、雲の層（cloudH）の上では全部 0（inp[5]。屋根の音も。
//   雲の上を飛ぶ戦闘機の操縦席で雨が鳴っていた）。wind_gust は風が gustFromWind m/s 以上（止めるのは 1 m/s 下）で 風 / gustFullWind × windGust、
//   wind_high との和が 1 を超えない、室内・乗り物で下げる。数は game.json の audio.weather（DEFAULTS は無いキーの既定値）。毎回のオブジェクトは作らない
//   （4 Hz の外は数を比べるだけ）
MR.WeatherAudio = class WeatherAudio {
  static get DEFAULTS() {
    return { indoor: 0.3, cabin: 0.25, fast: 0.3, roofInside: 1.0, windGust: 0.9, gustFromWind: 7, gustFullWind: 12, gustCabin: 0.4, gustStateWind: 10, lightFull: 0.55, lightCurve: 1.5,
      heavyFrom: 0.6, releaseSlots: 2, roofReleaseSec: 10, hz: 4, startAbove: 0.02, stopBelow: 0.01, stopAfter: 5, fadeIn: 1.5, fadeOut: 1.5 };
  }
  // audio: MR.Audio（loop / want / release。無ければ何もしない）、weather: MR.Weather、acfg: game.json の audio（audio.weather を読む）
  constructor(audio, weather, acfg) {
    this.audio = audio && typeof audio.loop === 'function' ? audio : null;
    this.weather = weather;
    this.cfg = weather.cfg;
    this.ac = Object.assign({}, WeatherAudio.DEFAULTS, (acfg && acfg.weather) || {});
    // sec: 屋根の組は要らなくなってからの秒で捨てる（ほかは枠の数 releaseSlots）
    this.groups = {
      rain: { names: ['rain_light'], wanted: false, lastK: -1e9 },
      heavy: { names: ['rain_heavy'], wanted: false, lastK: -1e9 },
      gust: { names: ['wind_gust'], wanted: false, lastK: -1e9 },
      roof: { names: ['rain_roof'], wanted: false, lastK: -1e9, sec: true, lastT: -1e9 },
      thunder: { names: ['thunder_near', 'thunder_far'], wanted: false, lastK: -1e9 }
    };
    const L = (name) => ({ name, h: null, vol: 0, below: 0 });
    this.loops = { light: L('rain_light'), heavy: L('rain_heavy'), roof: L('rain_roof'), gust: L('wind_gust') };
    // 入力（WeatherView が毎フレーム書く。Float64Array = 書いても箱を作らない）: 0 室内（0..1） 1 閉じた乗り物の中（1 人称なら 1） 2 今の wind_high の音量
    //   3 次の 4 Hz までの秒、4 外の雨の粒が速さで消えていない割合（1 = いつも。速いカメラで 0 へ = 外の雨の音は × fast まで）
    //   5 雲の層の下の割合（1 = 雲の層 × cloudFadeFrom より下、雲の層（cloudH）より上で 0 = 雨の音は全部 0）、6 update の dt の和（秒）
    this.inp = new Float64Array(7);
    this.inp[4] = 1; this.inp[5] = 1;
    this.stats = { wants: 0, releases: 0, refused: 0, starts: 0, stops: 0, ticks: 0 };
  }
  _rainOf(id) { const s = id && this.cfg.states[id]; return s ? (s.rain || 0) : 0; }
  _windOf(id) { const s = id && this.cfg.states[id]; return s ? (s.wind || 0) : 0; }
  _boltOf(id) { const s = id && this.cfg.states[id]; return s ? (s.lightningPerMin || 0) : 0; }

  update(dt, p) {
    const inp = this.inp;
    inp[6] += dt;
    inp[3] -= dt;
    if (inp[3] > 0) return;
    const tick = 1 / Math.max(0.5, this.ac.hz);
    inp[3] += tick;
    if (inp[3] < 0) inp[3] = 0;
    this.stats.ticks++;
    this._policy(p);
    if (!this.audio) return;
    const ac = this.ac, r = p.rain > 0 ? p.rain : 0;
    const cabin = inp[1] > 0.5, cloud = inp[5] > 0 ? (inp[5] < 1 ? inp[5] : 1) : 0;
    const inF = 1 - (1 - ac.indoor) * inp[0];
    const out = inF * (cabin ? ac.cabin : 1) * (1 - (1 - ac.fast) * (1 - inp[4])) * cloud;
    const hf = ac.heavyFrom < 0.99 ? ac.heavyFrom : 0.99;
    let h = r > hf ? (r - hf) / (1 - hf) : 0;
    if (h > 1) h = 1;
    // 聞こえる雨の量（lightFull より弱い雨は lightCurve 乗で小さく = やみ際・降り始めは粒と一緒に消える）
    const lf = ac.lightFull > 0 ? ac.lightFull : 0.55, fr = r < lf ? Math.pow(r / lf, ac.lightCurve > 0 ? ac.lightCurve : 1) : 1;
    const a = r < lf ? lf * fr : r;
    this._apply(this.loops.light, (1 - h * h) * fr * out, tick);
    this._apply(this.loops.heavy, Math.pow(h, 1.5) * out, tick);
    this._apply(this.loops.roof, cabin ? a * ac.roofInside * cloud : 0, tick);
    let gust = 0;
    const w = p.wind;
    if (this.groups.gust.wanted && r > 0.01 && w >= ac.gustFromWind - (this.loops.gust.h ? 1 : 0)) {
      gust = w / ac.gustFullWind;
      if (gust > 1 - inp[2]) gust = 1 - inp[2];
      if (gust < 0) gust = 0;
      gust *= ac.windGust * inF * (cabin ? ac.gustCabin : 1) * cloud;
    }
    this._apply(this.loops.gust, gust, tick);
  }

  // 後からデコードする組を want / release（今・前・次の枠の状態で決める。force（ソロ・テスト）では次 = 決めた状態）
  _policy(p) {
    const a = this.audio, W = this.weather, k = p.k, G = this.groups, ac = this.ac;
    if (!a || typeof a.want !== 'function') return;
    const nx = W.upcoming(p.t, 1)[0];
    const needRain = p.rain > 0 || this._rainOf(p.id) > 0 || this._rainOf(nx) > 0;   // 前の状態の雨は p.rain（移り変わりの間）
    const hf = ac.heavyFrom;
    const needHeavy = p.rain > hf || this._rainOf(p.id) > hf || this._rainOf(nx) > hf;
    const gw = ac.gustStateWind;
    const needGust = needRain && (this._windOf(p.id) >= gw || this._windOf(nx) >= gw || (p.rain > 0 && p.wind >= gw));
    const needBolt = p.lightningPerMin > 0 || this._boltOf(p.id) > 0 || this._boltOf(nx) > 0;
    this._group(G.rain, needRain, k);
    this._group(G.heavy, needHeavy, k);
    this._group(G.gust, needGust, k);
    this._group(G.roof, needRain && this.inp[1] > 0.5, k);
    this._group(G.thunder, needBolt, k);
  }
  _group(G, need, k) {
    const a = this.audio;
    if (need) {
      G.lastK = k;
      if (G.sec) G.lastT = this.inp[6];
      if (!G.wanted) { for (let i = 0; i < G.names.length; i++) a.want(G.names[i]); G.wanted = true; this.stats.wants++; }
      return;
    }
    if (!G.wanted) return;
    if (G.sec ? this.inp[6] - G.lastT < this.ac.roofReleaseSec : k - G.lastK < this.ac.releaseSlots) return;
    // その組のループが鳴っていれば先に止める（音量 0 のまま残っていることがある）
    for (const key in this.loops) { const L = this.loops[key]; if (L.h && G.names.indexOf(L.name) >= 0) { L.h.stop(this.ac.fadeOut); L.h = null; this.stats.stops++; } }
    let ok = true;
    for (let i = 0; i < G.names.length; i++) if (!a.release(G.names[i])) ok = false;
    if (ok) { G.wanted = false; this.stats.releases++; } else this.stats.refused++;
  }
  _apply(L, vol, tick) {
    const ac = this.ac;
    L.vol = vol;
    if (!L.h) {
      if (vol > ac.startAbove) { L.h = this.audio.loop(L.name, { volume: vol, fadeIn: ac.fadeIn }); L.below = 0; this.stats.starts++; }
      return;
    }
    if (vol < ac.stopBelow) {
      L.below += tick;
      if (L.below >= ac.stopAfter) { L.h.stop(ac.fadeOut); L.h = null; L.below = 0; this.stats.stops++; return; }
    } else L.below = 0;
    L.h.setVolume(vol);
  }
  // 鳴っているループの数（テスト用）
  playing() { let n = 0; for (const k in this.loops) if (this.loops[k].h) n++; return n; }
  // 止める: ループを止めて、組を全部 release（止めにかかったボイスは使っていないことになる）
  dispose() {
    for (const k in this.loops) { const L = this.loops[k]; if (L.h) { L.h.stop(0.5); L.h = null; } }
    if (this.audio && typeof this.audio.release === 'function') {
      for (const g in this.groups) { const G = this.groups[g]; if (!G.wanted) continue; for (const n of G.names) this.audio.release(n); G.wanted = false; }
    }
  }
};
