// ゲーム本体。各システムをつないでメインループを回す。
// 描画は 2 段: メインシーン（世界・敵）→ ビューシーン（自分の銃と腕。深度を消してから描くので壁にめり込まない）
// → ブルーム + FXAA（設定で切れる）
// opts.mode: 'solo'（既定。AI の敵）| 'online'（opts.net = 接続済みの MR.Net。敵は出さず、他のプレイヤーは MR.RemotePlayer。
//   HP・撃破・復活・乗り物の運転手と HP はサーバーが決める。自分の弾の命中は hit / vhit / runover で報告するだけで、ここでは減らさない）
// opts.level: レベルの id（'arena01' / 'midtown'）。無ければ Game.chooseLevel（URL ?level= > game.json の level > arena01）。
//   レベルに chunkSize があれば街（city）モード: MR.CityWorld（world.js）+ MR.Streamer（streamer.js）で描き、当たりは MR.Nav3D。
//   街では本体シーンを別のカメラ（mainCamera: 高さで near / far と霧が変わる）で描く（ビューモデルは今までの camera、near 0.02）。
//   敵・乗り物は game.json の city.enemies / city.vehicles が true のときだけ（今は false。フェーズ C で入れる）。
//   opts.spawnSeed: 街の開始地点（spawnPoints('solo', seed)）。無ければ URL ?spawn= か乱数
//   ヘリ（街のヘリポート。heli.js の MR.Helicopter）: 操縦席は左スティック = 前後・横、ジャンプ = 上昇、#btn-descend = 下降、向きはカメラの向きを
//   なめらかに追う（カメラはヘリと一緒に回らない）。撃てない（銃は隠す）。同乗の席は 360° 見て撃てる（ソロは地上でだけ席を移れる）。
//   一人称はヘリのメッシュをレイヤー 1 にも入れ、本体のパスの後に深度を消して near の小さいカメラ（cockpitCamera）で重ね描く
//   （高い所では本体の near が大きくなり、操縦席が切れるため）。V / #btn-camera で 3 人称（チェイスカメラ。壁の手前に寄る）、選択は覚える
// 戦闘機（フェーズ E1。jet.js の MR.Jet、空母の甲板 carrier_jet_1..4。city.jets / royale.jets で切れる）: 既定は「見た方へ飛ぶ」
//   （視点のスワイプ / マウスでカメラの向き = 目標、機体が傾けて引いてそちらへ向く）。左スティック: 上下 = スロットル（上の端で
//   アフターバーナー、下の端でアイドル → 地上ならブレーキ）、左右 = ロール / 前輪。撃つボタン = 機関砲（_updateJetGun）、脚・視点・脱出。
//   カメラは 3 人称（既定。jetCam で覚える）か操縦席（HUD は jethud.js）。controls.jet = 'manual'（または URL ?jet=manual）は
//   スティック = ピッチ・ロール、スロットルは上昇 / 下降のボタン
// 街の遊び方（フェーズ C3）: opts.cityMode = 'free'（既定。敵が湧き続け、死んでも復活）| 'royale'（バトルロイヤル。1 回だけ・安全地帯）。
//   URL ?mode=royale でも。どちらも MR.CityPlay（cityplay.js: 落ちている物・持ち物・武器の 3 枠・回復・防具・ミニマップ）を使い、
//   royale は MR.RoyaleMode（royale.js: 輸送ヘリ → 降下・安全地帯・参加者・結果）も。arena01 には無い
// 街のオンライン（フェーズ D2。opts.mode = 'online' で net.mode が city_dm / city_royale、opts.level = 'midtown'）:
//   MR.CityPlay（落ちている物・持ち物。拾う・回復はサーバーに頼み、picked / inv / heal で当てる）+ MR.CityOnline（cityonline.js:
//   乗り物の番号ごとの記録・試合範囲・ラウンド・輸送ヘリ・観戦・結果）。AI の敵・仮想の参加者は出さない。自分の動きはソロと同じ
//   （落下ダメージ・安全地帯のダメージはサーバーの damage だけ）。state に m（動き）と seat、乗車中の p は席の足元、輸送ヘリの中は航路の位置。
//   fire / hit / vhit は次の state と同じ束（net.queue）。乗り物は enter → vseat（席）で座る。運転席・操縦席だけ vstate（3D）
window.MR = window.MR || {};

MR.Game = class Game {
  // player.state → netproto の MOVE（街の state の m）
  static get MOVE_OF() { return { walk: 0, ladder: 1, swim: 2, vault: 3, fall: 4, chute: 5 }; }

  constructor(opts) {
    this.opts = opts;
    this.canvas = opts.canvas;
    this.assets = opts.assets;
    this.audio = opts.audio;
    this.hud = opts.hud;
    this.input = opts.input;
    this.config = Game.overlay(this.assets.get('config/game.json'));
    // オンライン: arena は arena01、街（city_dm / city_royale）は midtown（main.js が welcome の level を opts.level に入れる）
    this.levelId = opts.mode === 'online' ? (opts.level || 'arena01') : (opts.level || Game.chooseLevel(this.config));
    this.level = this.assets.get('levels/' + this.levelId + '.json');
    if (!this.level) { this.levelId = 'arena01'; this.level = this.assets.get('levels/arena01.json'); }
    if (!this.config || !this.level) throw new Error('ゲームデータが読み込めていません');
    this.isCity = !!this.level.chunkSize;
    // レベルごとの上書き（manhattan.json の city / royale。例: city.jets false）。midtown は持っていないので今まで通り
    this.cityCfg = Object.assign({ enemies: false, vehicles: false }, this.config.city || {}, this.level.city || {});
    // royale は 1 段深く重ねる（level.royale.transport は game.json の transport の上に。transport 全体を置き換えない）
    if (this.level.royale) {
      const base = this.config.royale || {}, over = this.level.royale, ry = Object.assign({}, base);
      for (const k of Object.keys(over)) {
        const v = over[k], b0 = base[k];
        ry[k] = (v && typeof v === 'object' && !Array.isArray(v) && b0 && typeof b0 === 'object' && !Array.isArray(b0)) ? Object.assign({}, b0, v) : v;
      }
      this.config = Object.assign({}, this.config, { royale: ry });
    }
    // 街の遊び方: free | royale（opts.cityMode > URL ?mode= > free）
    let cm = opts.cityMode;
    if (!cm) { try { const m = /[?&]mode=(free|royale)\b/.exec((typeof location !== 'undefined' && location.search) || ''); cm = m ? m[1] : null; } catch (e) { cm = null; } }
    //   'story'（ストーリー。storymode.js。opts.story = { chapter, campaign, cp, diff }）
    this.cityMode = this.isCity && opts.mode !== 'online' ? (cm === 'royale' ? 'royale' : (cm === 'story' && opts.story && opts.story.chapter ? 'story' : 'free')) : null;

    this.kills = 0;
    this.enemies = [];
    this.spawnTimer = 1.0;
    this.time = 0;
    this.lastFrame = 0;
    this.running = false;
    this.respawnAt = 0;
    this.weaponIndex = 0;
    this.weapons = [];
    this.vehicles = [];
    this.vehicle = null;        // 乗っている乗り物（MR.Vehicle）か null
    this._nearVehicle = null;   // 乗れる距離にある乗り物
    this._driveYaw = 0;
    this.headlight = null;
    this.heliChase = Game._loadPref('heliCam') === 'chase'; // ヘリの 3 人称カメラ（覚えておく）
    this.jetChase = Game._loadPref('jetCam') !== 'cockpit';  // 戦闘機は 3 人称が既定（覚えておく）
    // VTOL（MIRRSONA）の視点（V3）: 'near'（3 人称・近い）→ 'far'（3 人称・遠い）→ 'cockpit'（操縦席）。覚えておく（前の版の 'chase' は 'near'）。
    //   this.vtolChase は vtolCam から出す（cockpit でなければ true。代入もできる = Game.prototype の getter / setter）
    this.vtolCam = Game._vtolCamPref(Game._loadPref('vtolCam'));
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.fps = 0;
    this.shake = 0;
    this.rumble = 0;
    this.fovKick = 0;
    this._tmpV1 = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpV3 = new THREE.Vector3();
    // オンライン
    this.mode = opts.mode === 'online' ? 'online' : 'solo';
    this.online = this.mode === 'online';
    this.net = this.online ? (opts.net || null) : null;
    if (this.online && !this.net) throw new Error('オンラインの接続がありません');
    this.onlineCfg = Object.assign({ server: '', maxPlayers: 8, respawnDelay: 3 }, this.config.online || {});
    this.remotes = new Map();   // id → MR.RemotePlayer
    this._waitingSpawn = false; // 接続直後・再接続後、サーバーの spawn を待っている
    this._pendingEnter = -1;    // enter を送って vowner を待っている乗り物の番号
    this._runoverSent = {};     // 相手 id → 最後に runover を送った時刻（同じ相手に連打しない）
    this._netTimer = 0;
    // 続きから（session.js。main.js が前回の snap を渡す）と省メモリ（続けて落ちたとき。stability.saver）
    this.resume = !this.online && opts.resume ? opts.resume : null;
    this.saver = !!opts.saver;
    this._noMusic = this.saver && (((this.config.stability || {}).saver || {}).audio || {}).music === false;
  }

  // レベルの id: URL の ?level= > game.json の level > 'arena01'（無いレベルは arena01）
  // game.json の v17（ビルド 17 からのアプリだけが読む上書き。古いアプリは上の値のまま = b17 の検証 S5）を config に深く重ねる。
  //   読み込んだ config そのものに 1 回だけ（同じ物を何度渡してもよい）
  static overlay(cfg) {
    if (!cfg || !cfg.v17 || cfg._v17) return cfg;
    const deep = (dst, src) => {
      for (const k of Object.keys(src)) {
        if (k === '_note') continue;
        const v = src[k], d = dst[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) deep(d, v);
        else dst[k] = v;
      }
    };
    deep(cfg, cfg.v17);
    Object.defineProperty(cfg, '_v17', { value: true, enumerable: false });
    return cfg;
  }
  static chooseLevel(config, search) {
    if (search == null) { try { search = (typeof location !== 'undefined' && location.search) || ''; } catch (e) { search = ''; } }
    const m = /[?&]level=([a-z0-9_-]+)/i.exec(search || '');
    if (m) return m[1];
    return (config && typeof config.level === 'string' && config.level) || 'arena01';
  }

  // 端末ごとの小さな設定（ヘリのカメラなど）。保存できない環境でも動く
  // ---------- 設定の画面（#settings。戦闘機の操作・上下反転・自動フレア）----------
  // 画面のボタンは 1 回だけつなぎ、今のゲーム（Game._active）に効かせる（「もう一度」で作り直しても重ならない）
  static _bindSettings() {
    if (Game._settingsBound || typeof document === 'undefined' || !document.getElementById) return;
    Game._settingsBound = true;
    // input.js は document の touchmove を止める（ページが動かないように）。設定の板は低い画面（スマホの横）で縦にあふれるので指でスクロールさせる
    const stPanel = document.getElementById('settings');
    if (stPanel && stPanel.addEventListener) stPanel.addEventListener('touchmove', (ev) => { ev.stopPropagation(); }, { passive: true });
    // タッチは pointerdown → 同じ指の pointerup（ボタンの中で離した）で押したことにする。'click' だけだと、別の指（左のスティックの親指）が
    //  画面に触れている間はブラウザが click を出さず（Chromium・iOS Safari）、パネルは開くのに選択肢と「閉じる」が効かなかった。
    //  マウスは今まで通り click（タッチの後に来る click は 0.7 秒の間は捨てる = 2 回にならない）。捨てる時計はどのボタンでも共有（b16.2:
    //  「タイトルに戻る」をタッチすると同じ所に「いいえ」が出て、後から来る click がそれを押していた = ボタンごとの時計だと別のボタンの click を捨てない）
    let lastT = 0;
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (!el || !el.addEventListener) return;
      let pid = null, dx0 = 0, dy0 = 0;
      const fire = () => { const g = Game._active; if (g) fn(g); };
      el.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') { pid = ev.pointerId; dx0 = ev.clientX; dy0 = ev.clientY; } });
      el.addEventListener('pointercancel', (ev) => { if (ev.pointerId === pid) pid = null; });
      el.addEventListener('pointerup', (ev) => {
        if (ev.pointerType === 'mouse' || ev.pointerId !== pid) return;
        pid = null;
        if (Math.abs(ev.clientX - dx0) > 10 || Math.abs(ev.clientY - dy0) > 10) return; // 板をスクロールした指
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (r && (ev.clientX < r.left - 4 || ev.clientX > r.right + 4 || ev.clientY < r.top - 4 || ev.clientY > r.bottom + 4)) return; // ボタンの外へずらして離した
        if (ev.preventDefault) ev.preventDefault();
        lastT = Date.now(); fire();
      });
      el.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); if (Date.now() - lastT < 700) return; fire(); });
    };
    on('st-easy', (g) => g._pickScheme('easy'));
    on('st-aim', (g) => g._pickScheme('aim'));
    on('st-manual', (g) => g._pickScheme('manual'));
    on('st-vtol-easy', (g) => g._pickVtolScheme('easy'));
    on('st-vtol-aim', (g) => g._pickVtolScheme('aim'));
    on('st-invert', (g) => { g.jetInvert = !g.jetInvert; g._syncSettings(); });
    on('st-flare', (g) => { g.jetAutoFlare = !g.jetAutoFlare; g._syncSettings(); });
    on('st-bake', (g) => g._toggleBake());
    on('st-bake-clear', (g) => g._clearBake());
    on('st-close', (g) => g.toggleSettings(false));
    for (const id of ['auto', 'dusk', 'golden', 'noon', 'haze', 'blue', 'night']) on('st-tod-' + id, (g) => g._pickTod(id));
    // ゲーム（b16.2。どのゲームでも）: 省メモリモード（自動 / オン / オフ）・タイトルに戻る（確かめてから）
    for (const id of ['auto', 'on', 'off']) on('st-saver-' + id, (g) => g._pickSaver(id));
    on('st-leave', (g) => g._leaveAsk(true));
    on('st-leave-no', (g) => g._leaveAsk(false));
    on('st-leave-yes', (g) => g._leaveConfirm());
    // Esc: 「タイトルに戻りますか？」を出している間は「いいえ」
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', (ev) => Game._settingsKey(ev));
  }
  static _settingsKey(ev) {
    const g = Game._active;
    if (!g || !g.settingsOpen || !g._leaveAsking || !ev || (ev.key !== 'Escape' && ev.code !== 'Escape')) return false;
    if (ev.preventDefault) ev.preventDefault();
    g._leaveAsk(false);
    return true;
  }
  // 省メモリモード（session.js の saverMode）: 選んだものは次のゲームから（描画・材質を作り直さない）。オフは期限と落ちた回数も消す
  _pickSaver(m) {
    if (!MR.Session || !MR.Session.setSaverMode) return;
    MR.Session.setSaverMode(m);
    this._syncSettings(); // 選んだもの（✓）と今の状態の 1 行が板の中で変わる（知らせは出さない: 板の上に出て 1 行を隠していた）
  }
  // 次に始めるゲームが省メモリか（オンラインは省メモリを使わない）
  _saverNext() { return !!(MR.Session && MR.Session.saverActive && MR.Session.saverActive()) && !this.online; }
  // タイトルに戻る: 1 回目は板の中で確かめる（はい / いいえ）、はい → leaveToTitle（snap を消す = 次の起動で続きからにしない。オンラインは部屋を出る）
  _leaveAsk(on) {
    this._leaveAsking = !!on && this.settingsOpen;
    const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('settings') : null;
    if (el && el.classList) el.classList.toggle('asking', this._leaveAsking);
    const ask = typeof document !== 'undefined' && document.getElementById ? document.getElementById('st-leave-ask') : null;
    if (ask && ask.classList) ask.classList.toggle('hidden', !this._leaveAsking);
  }
  _leaveConfirm() {
    if (!this._leaveAsking || this._leaving) return;
    this._leftFromSettings = (this._leftFromSettings || 0) + 1; // テスト用
    this._leaveAsk(false);
    this.toggleSettings(false);
    this.leaveToTitle();
  }
  // 時間帯（tod.js）: 覚えて次のゲームから（遊んでいる間は変えない = 空の画像・PMREM を作り直さない）
  _pickTod(id) {
    const cfg = (this.config.render || {}).tod;
    if (!MR.Tod || !cfg || !MR.Tod.norm(cfg, id)) return;
    MR.Tod.save(id);
    this._syncSettings();
    this.hud.showMessage('時間帯: ' + MR.Tod.label(cfg, id) + '（次のゲームから）', 1400);
  }
  // 街のデータ（前もって作った遠景 far.bin = MR.CityBake。main.js が opts.cityBake で渡す。ゲームをまたいで残る物なので、ここからは
  //   呼ぶだけで、ゲームを覚えさせない = listener を付けない。表示は設定を開いている間 _loop が 0.5 秒ごとに _syncSettings で）
  _toggleBake() {
    const b = this.opts.cityBake;
    if (!b) return;
    b.setUser(!b.user);
    this._syncSettings();
    this.hud.showMessage('街のデータのダウンロード: ' + (b.user ? 'オン' : 'オフ'), 1200);
  }
  _clearBake() {
    const b = this.opts.cityBake;
    if (!b) return;
    b.clear().then(() => { if (Game._active === this) this._syncSettings(); });
    this._syncSettings();
    this.hud.showMessage('街のデータを削除しました', 1400);
  }
  _pickScheme(sc) {
    this.setJetScheme(sc, true);
    this._syncSettings();
    this.hud.showMessage('戦闘機の操作: ' + ({ easy: 'かんたん', aim: '視点で操縦', manual: 'マニュアル' })[sc], 1200);
  }
  _pickVtolScheme(sc) {
    this.setVtolScheme(sc, true);
    this._syncSettings();
    this.hud.showMessage('VTOL の操作: ' + ({ easy: 'かんたん', aim: '視点で操縦' })[sc], 1200);
  }
  toggleSettings(on) {
    this.settingsOpen = on === undefined ? !this.settingsOpen : !!on;
    const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('settings') : null;
    if (el && el.classList) el.classList.toggle('hidden', !this.settingsOpen);
    if (this._leaveAsking || !this.settingsOpen) this._leaveAsk(false); // 開き直したら「タイトルに戻りますか？」は出さない
    // スコアボード（オンライン）は閉じてから開く（板と重ねない。P キーはスコアボードを開いたままでも効く。hud.toggleScoreboard は板の間は開かない）
    if (this.settingsOpen && this.hud && this.hud.scoreboardOpen && typeof this.hud.toggleScoreboard === 'function') this.hud.toggleScoreboard(false);
    //  開いている間は #message（「街のデータを削除しました」など設定のボタンの返事）を板の上に出す（style.css の #hud.settings-open #message。
    //  以前は 92 % の板の後ろに描かれて読めなかった）
    if (this.hud.root && this.hud.root.classList) this.hud.root.classList.toggle('settings-open', this.settingsOpen);
    if (this.settingsOpen) {
      this._syncSettings(); if (this.input.reset) { const en = this.input.enabled; this.input.reset(); this.input.enabled = en; }
      if (this.hud && typeof this.hud.hideWeather === 'function') this.hud.hideWeather(); // 天気の知らせを設定の板と重ねない（ソロは止まっていても消すタイマーは実時間）
    }
    // ソロは開いている間止まる: ロックのうなり / はっきりした音（lock_tone / lock_solid のループ）を止める（閉じれば次のロックでまた鳴る）
    if (this.settingsOpen && this.airCombat) { if (this.airCombat.quiet) this.airCombat.quiet(); else if (this.airCombat.idle) this.airCombat.idle(); } // RWR の音も
  }
  _syncSettings() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const sc = this._jetScheme();
    for (const k of ['easy', 'aim', 'manual']) { const b = document.getElementById('st-' + k); if (b && b.classList) b.classList.toggle('sel', k === sc); }
    const vs = this._vtolScheme();
    for (const k of ['easy', 'aim']) { const b = document.getElementById('st-vtol-' + k); if (b && b.classList) b.classList.toggle('sel', k === vs); }
    // 中身: 戦闘機の操作（opt-in で戦闘機を出したときだけ）・VTOL の操作（VTOL を出す街）・自動フレア（どちらか）・街のデータ
    const pnl = document.getElementById('settings');
    if (pnl && pnl.classList) {
      pnl.classList.toggle('no-jet', !this._jetsOn()); pnl.classList.toggle('no-vtol', !this._vtolHere());
      // アリーナ・オンライン（b16.2 から設定を出す）: ゲームの段だけ（操作・自動フレア・街のデータ・時間帯はソロの街だけ = 今まで通り）
      pnl.classList.toggle('game-only', !this.isCity || this.online);
    }
    // ゲーム: 省メモリモード（選んでいるもの・今のゲーム・次のゲーム）
    const sm = MR.Session && MR.Session.saverMode ? MR.Session.saverMode() : 'auto';
    for (const k of ['auto', 'on', 'off']) { const b = document.getElementById('st-saver-' + k); if (b && b.classList) b.classList.toggle('sel', k === sm); }
    const si = document.getElementById('st-saver-info');
    if (si) {
      const next = this._saverNext(), solo = !!(MR.Session && MR.Session.saverActive && MR.Session.saverActive());
      si.textContent = this.online ? (solo ? 'オンラインは通常の画質・ソロの次のゲームから省メモリ' : 'いまは通常の画質で動いています')
        : (this.saver ? 'いまは省メモリで動いています' : 'いまは通常の画質で動いています') + (next !== this.saver ? '・次のゲームから反映されます' : '');
    }
    const t = (id, label, v) => { const b = document.getElementById(id); if (b) b.innerHTML = label + ' <b>' + (v ? 'オン' : 'オフ') + '</b>'; };
    t('st-invert', '上下反転', this.jetInvert);
    t('st-flare', '自動フレア', this.jetAutoFlare);
    const tc = (this.config.render || {}).tod;
    const stEl = document.getElementById('settings');
    if (stEl && stEl.classList) stEl.classList.toggle('no-tod', !(MR.Tod && tc)); // 古いデータ（render.tod が無い）では 時間帯 の段を隠す
    if (MR.Tod && tc) {
      const cur = MR.Tod.norm(tc, MR.Tod.load()) || MR.Tod.norm(tc, tc.default) || 'auto';
      for (const k of ['auto', 'dusk', 'golden', 'noon', 'haze', 'blue', 'night']) {
        const bt = document.getElementById('st-tod-' + k);
        if (!bt || !bt.classList) continue;
        const ok = k === 'auto' || MR.Tod.valid(tc, k);
        bt.classList.toggle('hidden', !ok);
        bt.classList.toggle('sel', ok && k === cur);
        bt.textContent = MR.Tod.label(tc, k);
      }
      const ti = document.getElementById('st-tod-info');
      if (ti) ti.textContent = '今: ' + this.tod.label + '　次のゲームから';
    }
    const b = this.opts.cityBake, el = document.getElementById('settings');
    if (el && el.classList) el.classList.toggle('no-bake', !b);
    if (b) {
      t('st-bake', '街のデータをダウンロード', b.user);
      const info = document.getElementById('st-bake-info');
      if (info) info.textContent = b.infoText();
    }
  }

  // 水のしぶき（MR.WaterFX）を使うか: game.json の waterFx.enabled と URL の ?spray=0
  static sprayOn(c) {
    if (c && c.enabled === false) return false;
    try { if (/[?&]spray=0\b/.test((typeof location !== 'undefined' && location.search) || '')) return false; } catch (e) { /* ignore */ }
    return true;
  }

  static _loadPref(key) { try { return window.localStorage ? window.localStorage.getItem('mirrsona.' + key) : null; } catch (e) { return null; } }
  static _savePref(key, v) { try { if (window.localStorage) window.localStorage.setItem('mirrsona.' + key, v); } catch (e) { /* ignore */ } }

  // 端末に合わせた描画設定（config.render + config.render.mobile）
  _renderSettings() {
    const base = Object.assign({
      fov: 72, maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, bloom: true, bloomStrength: 0.35,
      bloomRadius: 0.4, bloomThreshold: 0.8, exposure: 1.0, fogNear: 45, fogFar: 140, fxaa: true,
      textures: true, anisotropy: 8, vignette: 0.35, saturation: 1.06, props: true
    }, this.config.render || {});
    if (this.input.isTouchDevice && base.mobile) Object.assign(base, base.mobile);
    if (this.saver && MR.Session) return MR.Session.saverRender(base, this.config.stability); // 省メモリ: render と render.city に重ねる
    return base;
  }

  start() {
    const cfg = this.config;
    // 時間帯（tod.js）: ゲームごとに 1 つ決めて、空・光・霧・露出・窓・小物の発光・ランドマークの夜の数を作る前に重ねる（夕方 = 今までと同じ値そのもの）
    // ストーリーの章は書いてある時間帯（chapter.tod）、無ければ夕方（b16: 章は夕方の光で作ってある。おまかせで夜の序章にしない）
    if (this.opts.story && this.opts.story.chapter && this.opts.tod == null) this.opts.tod = this.opts.story.chapter.tod || 'dusk';
    this.tod = Game._todSelect(this);
    this._todSight = this.tod.sight; // 敵の見える距離の倍率（_update の敵の ctx。夕方は 1）
    const rs = MR.Tod ? MR.Tod.applyRender(this._renderSettings(), this.tod.preset, MR.CityWorld ? MR.CityWorld.DEFAULTS : null) : this._renderSettings();
    this.rs = rs;
    Game._active = this;
    Game._bindSettings();
    // 天気（weather.js / weather_view.js）を使うか。null = オフ（何も作らない = 今までと同じ描画）
    // ストーリー: 章の天気（weather: clear / cloudy / rain / fog …）。opts.weather（テスト）が先
    //  'clear' は天気なし（今まで通り・ドームの描画を足さない）
    const chW = this.opts.story && this.opts.story.chapter && this.opts.story.chapter.weather;
    if (this.opts.story && this.opts.story.chapter && this.opts.weather == null) this.opts.weather = chW && chW !== 'clear' ? chW : 'off'; // 晴れ・書いていない章は天気なし（予定の乱数で降らない）
    const wsel = Game._weatherSelect(this);

    // --- レンダラー ---
    const useComposer = !!(rs.bloom && THREE.EffectComposer && THREE.UnrealBloomPass);
    // opts.renderer: 前のゲームのレンダラーを使い回す（バトルロイヤルの「もう一度」。同じ canvas に WebGL を作り直さない）
    this.renderer = this.opts.renderer || new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !useComposer, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rs.maxPixelRatio));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = rs.exposure;
    this.renderer.shadowMap.enabled = !!rs.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    if (MR.CineBench) MR.CineBench.init(this); // 端末のクラス（game.cine）・?bench=cine / ?memprobe=1（cinebench.js）

    // --- シーン ---
    this.scene = new THREE.Scene();
    this.viewScene = new THREE.Scene();
    // near は 0.02: 照準（ADS）でカメラがダットサイトの中に入るので、レンズ前のドットを切らない
    this.camera = new THREE.PerspectiveCamera(rs.fov, 1, 0.02, 900);
    let skyExtra = {};
    if (this.isCity) {
      this.cityRender = MR.CityWorld.config(rs);
      const a0 = this.cityRender.altitude[0];
      skyExtra = { fogNear: a0.fogNear, fogFar: a0.fogFar, shadowRadius: this.cityRender.shadowRadius, shadowDistance: this.cityRender.shadowDistance, shadowFar: this.cityRender.shadowFar, followY: true, hemiIntensity: this.cityRender.hemiIntensity };
      // 本体シーン用のカメラ（camera の位置・向きを毎フレーム写す。near / far は高さで変える）
      this.mainCamera = new THREE.PerspectiveCamera(rs.fov, 1, a0.near, a0.far);
      this.mainCamera.matrixAutoUpdate = false;
    }
    this.sky = new MR.Sky(this.scene, this.renderer, Object.assign({
      shadows: rs.shadows, shadowMapSize: rs.shadowMapSize, fogNear: rs.fogNear, fogFar: rs.fogFar,
      assets: this.assets, useFiles: rs.textures !== false, anisotropy: rs.anisotropy
    }, this._todSky(), skyExtra));
    // 街: 影の外形は光の側の面で描く（world.js）。同じ面の外壁・屋上に影が乗らないよう法線方向のずらしを大きく
    if (this.isCity && this.sky.sun && this.sky.sun.shadow && this.cityRender.shadowNormalBias != null) this.sky.sun.shadow.normalBias = this.cityRender.shadowNormalBias;
    // マテリアル（ファイルテクスチャ or Canvas 版）→ 世界。テクスチャ・props.glb は非同期に差し替わる
    if (MR.Textures) MR.Textures.anisotropy = rs.anisotropy;
    // ロード画面で先読みした MR.Materials（main.js）があればそれを使う
    this.materials = this.opts.materials || (MR.Materials
      ? new MR.Materials(this.assets, this.renderer, { tier: this.assets.tier, anisotropy: rs.anisotropy, useFiles: rs.textures !== false, seed: this.level.seed,
        windowEmissive: this.isCity ? this.cityRender.windowEmissive : undefined, textureMax: this.isCity ? this.cityRender.textureMax : null })
      : null);
    if (this.materials && !this.materials.renderer) this.materials.renderer = this.renderer;
    // 見た目の色調・室内の光・家具の配色（look.js。world の前に決める: 家具の色は作るときに選ぶ）
    this.lookCfg = MR.Look ? MR.Look.config(this.config.render, this.input.isTouchDevice, this.levelId) : null;
    if (this.lookCfg && MR.Tod) this.lookCfg = MR.Tod.applyLook(this.lookCfg, this.tod.preset); // 時間帯の色調（grade）
    if (MR.Interiors) MR.Interiors.lookOn = !!this.lookCfg;
    this.look = this.lookCfg ? MR.Look.create(this, this.lookCfg) : null;
    if (this.isCity) {
      // v2 の街（manhattan）: core.bin とタイル（MR.NycTiles）は main.js が用意して opts で渡す（prepareLevelData）。前もって作った遠景（far.bin）は midtown だけ。
      //   建物の中の家具と自動ドア（interiors / doors）は midtown（v1 の chunkFull）だけ（b14: v2 の chunkFull はまだ確かめていない = manhattan では出さない）
      const v2level = this.level && this.level.generator === 'nyc';
      this.world = new MR.CityWorld(this.scene, this.level, rs, { materials: this.materials, assets: this.assets, renderer: this.renderer, core: this.opts.core || null, tiles: this.opts.tiles || null, bake: this.opts.cityBake || null, rail: v2level ? this._railOpts() : null, interiors: v2level ? null : this._interiorsOpts(), doors: v2level ? null : this._doorsOpts(), weather: !!wsel });
      this.city = this.world.city;
      if (this._gpuTexOk() && this._gpuTexMB() > 0) this.world.landmarkWarm = (lm, done) => this._warmLandmarks(lm, done); // S7d
      // V2 X1: 遠景の窓の色・屋上・建物の色味（farlook.js。?look=0 / render.look.enabled false / render.city.look.enabled false で使わない）
      if (MR.FarLook && (!MR.CineBench || MR.CineBench.lookOn(cfg))) this.farLook = MR.FarLook.extend(this.world.farMaterial, this.world.cfg.look);
      if (this.world.props) { this.world.props.view = this.camera; this.world.props.sun = this.sky.sunDir || null; } // 小物を視錐台で 1 つずつ間引く（L0。mainCamera は同じ行列・fov。太陽は空の生きている向き）
      if (this.world.furn) this.world.furn.onAdded = (key, res) => this._onFurnAdded(key, res);
      if (this.world.furnView && this.sky) this.world.furnView.sunDir = this.sky.sunDir; // 窓の日なた（光の札）の向き
      if (this.world.furnView && this.sky && this.tod && this.tod.sky) { // 時間帯: 窓の日なたは太陽の強さに合わせる（夕方 = 1 のまま）
        const s0 = (this.level.sky && this.level.sky.sunIntensity) || 1.8, s1 = this._todSky().sunIntensity;
        if (typeof s1 === 'number') this.world.furnView.sunScale = Math.max(0, Math.min(1.5, s1 / s0));
      }
      // 水面の太陽: 今の空の向き（時間帯を重ねた空。夕方はレベルの sunDir と同じ値）。色は時間帯の空があるときだけ（夕方は water.js の既定 = レベルの色のまま）
      if (this.world.water && (this.level.sky || this.tod.sky)) this.world.water.uniforms.uSunDir.value.copy(this.sky.sunDir);
      if (this.world.water && this.tod.sky && this.sky.opts.sunColor && this.world.water.uniforms.uSunColor) this.world.water.uniforms.uSunColor.value.copy(MR.srgb(this.sky.opts.sunColor));
      if (this.world.water && this.tod.sky) { // 空の画像が届く前・画像の無い起動の映り込みも時間帯の色（夕方は今まで通り）
        const wu = this.world.water.uniforms, so = this.sky.opts;
        if (wu.uHorizon && so.horizon) wu.uHorizon.value.copy(MR.srgb(so.horizon));
        if (wu.uZenith && so.zenith) wu.uZenith.value.copy(MR.srgb(so.zenith));
      }
      // 窓の発光: 材質は「もう一度」で使い回すので、時間帯で変えた（今か前のゲームで）ときだけ、もう作ってある窓の材質にも当て直す
      if (this.materials && typeof this.materials.setWindowEmissive === 'function' && (this.tod.windows || this.materials._todWindows)) {
        this.materials.setWindowEmissive(this.world.cfg.windowEmissive, true);
        this.materials._todWindows = !!this.tod.windows;
      }
    } else {
      this.world = new MR.World(this.scene, this.level, rs, { materials: this.materials, assets: this.assets, renderer: this.renderer });
    }
    if (!this.materials) this.materials = this.world.materials;
    this.fx = new MR.FX(this.scene);
    this.fx.maxParticles = rs.fxMaxParticles || 0;
    // ミサイル・空の戦い（街。乗り物が無くても・歩いていても飛んでいるミサイルは毎フレーム進む = _update。オンラインは見た目だけ = D10）
    if (this.isCity && MR.Missiles) this.missiles = this._makeMissiles();
    if (this.isCity && MR.AirCombat) this.airCombat = new MR.AirCombat(this);
    // 墜落・爆発の見た目と火の記録（E3.1。街だけ。アリーナは今まで通りの fx.explosion）。PC の光（PointLight）はここで 1 つだけ作る（後から足さない）
    if (this.isCity && MR.Crashes) {
      const mobile = !!(this.input && this.input.isTouchDevice);
      // 破片（E3.2。1 つの InstancedMesh、最初の破片で作る）: 跳ねる面は当たり判定（読んだチャンクは nav、ほかは HeliCollider）を跳ねる所の予測のときだけ見る
      if (MR.Debris) {
        const FC = cfg.fire || {}, CP = Object.assign({}, MR.Crashes.CAPS, FC.caps || {}, (mobile && FC.mobile && FC.mobile.caps) || {});
        this.debris = new MR.Debris(this.scene, FC.debrisFx || {}, {
          cap: CP.debris, mobile, audio: this.audio,
          support: (x, z, yRef) => this._burnSupport(x, z, yRef).y,
          water: (x, z) => (this.city ? this.city.groundAt(x, z).water : null)
        });
      }
      this.crashes = new MR.Crashes(this.scene, cfg.fire || {}, {
        fx: this.fx, audio: this.audio, assets: this.assets, mobile, puffs: () => this._puffsObj(),
        blasts: (cfg.explosives || {}).blasts || {}, onShake: (k) => { this.shake = Math.min(1.5, this.shake + k); },
        // 地面の火のダメージ（ソロだけ。オンラインは目標を渡さない = D10）・沈んだ残骸の火を消す水面
        fireTargets: (visit) => this._fireTargets(visit), onFireHit: (out, n) => this._onFireHits(out, n),
        waterAt: (x, z) => (this.city ? this.city.groundAt(x, z).water : null),
        debris: this.debris || null,
        onSecondary: (x, y, z, r, dmg, kind) => this._onSecondary(x, y, z, r, dmg, kind)
      });
      // 派手な爆発と壁の当たり（destruct-3 M1）: crashes の見た目の爆発の後に重ねる（描画は増えない。オンラインも見た目だけ）
      //   ?blastfx=0・MR.CONFIG.BLASTFX = false で前の見た目（撮影の前後の比べ）
      const bq = (typeof location !== 'undefined' && location.search) || '';
      if (MR.BlastFX && ((cfg.destruct || {}).fx || {}).enabled !== false && !/[?&]blastfx=0/.test(bq) && MR.CONFIG.BLASTFX !== false) {
        this.blastFx = new MR.BlastFX(this, (cfg.destruct || {}).fx || {});
        this.crashes.onBlast = (x, y, z, s, o) => this.blastFx.blast(x, y, z, s, o);
      }
    }
    // 壊れる物（destruct.js / destruct_view.js。街だけ。オンラインは見た目だけ = 当たり判定を変えない）
    // 壊れる物は midtown（v1）だけ（b14: v2 の街 = manhattan の chunkFull・柱では確かめていない = 出さない）
    if (this.isCity && MR.Destruction && (cfg.destruct || {}).enabled !== false && !(this.city && this.city.version === 2)) this.destruct = new MR.Destruction(this, cfg.destruct || {});
    // 兵士の glTF を（まだなら）パースしておく。終わるまでにスポーンした敵はコードモデルのまま
    if (MR.CharacterGLB) MR.CharacterGLB.preload(this.assets, cfg.enemies.model).catch(() => {});
    // 街の敵: 設定は enemies に city.enemy を上書き。出し入れと経路探索の予算は MR.EnemyDirector（city.enemies が true のとき）
    if (this.isCity) {
      this.cityEnemyCfg = Object.assign({}, cfg.enemies, this.cityCfg.enemy || {});
      if (this.cityCfg.enemies && !this.online && MR.EnemyDirector) this.director = new MR.EnemyDirector(this, this.cityCfg);
    }

    // ビューシーン（銃と腕）: ライトは本体シーンと同じ向きで複製（影は無し）
    this.viewRoot = new THREE.Object3D();
    this.viewRoot.matrixAutoUpdate = false;
    this.viewScene.add(this.viewRoot);
    // ライトは参照を持つ（render.view で強さ。hq3d: 後ろ上からの縁の光 rim で銃と腕の輪郭を出す。?kit=0 は b13 まで = rim なし）
    const kit = MR.ViewArms ? MR.ViewArms.kitOn(rs) : false;
    if (MR.Weapon) { MR.Weapon.kit = kit; MR.Weapon.armsFile = (kit && rs.view && rs.view.arms) || ''; }
    const vw = Object.assign({ hemi: 1.3, sun: 0.8, fill: 1.6, rim: 0, rimColor: '#bcd4ff', rimPos: [-0.6, 0.8, 1.2], rimTarget: [0.12, -0.14, -0.4] }, kit ? (rs.view || {}) : {});
    this._vHemi = this.sky.hemi.clone();
    this._vHemi.intensity = this.sky.hemi.intensity * vw.hemi;
    this._vSun = new THREE.DirectionalLight(this.sky.sun.color, this.sky.sun.intensity * vw.sun);
    this._vSun.position.copy(this.sky.sunDir).multiplyScalar(50);
    this.viewScene.add(this._vHemi, this._vSun); // look.js（室内）・天気が _vHemi / _vSun の強さ・色を変える（嵐の中で銃だけ日なたにならない）
    // カメラ基準のフィルライト（銃が逆光で真っ黒にならないように）
    this._vFill = new THREE.PointLight(MR.srgb('#ffe2c0'), vw.fill, 3, 1.5);
    this._vFill.position.set(0.35, 0.45, 0.25);
    this.viewRoot.add(this._vFill);
    if (vw.rim > 0) {
      // カメラ基準の縁の光（後ろ上から。target は銃のあたり）
      this._vRim = new THREE.DirectionalLight(MR.srgb(vw.rimColor), vw.rim);
      this._vRim.position.set(vw.rimPos[0], vw.rimPos[1], vw.rimPos[2]);
      this._vRim.target.position.set(vw.rimTarget[0], vw.rimTarget[1], vw.rimTarget[2]);
      this.viewRoot.add(this._vRim, this._vRim.target);
    }
    // 環境マップはファイル版が後から届くので、ビューシーン側も追従させる
    if (typeof this.sky.onEnvironment === 'function') this.sky.onEnvironment((tex) => { this.viewScene.environment = tex; });
    else if (this.sky.envTexture) this.viewScene.environment = this.sky.envTexture;

    // --- 天気（数 = MR.Weather、見た目 = MR.WeatherView）。オフのゲームでは作らない ---
    if (wsel) {
      const wc = cfg.weather;
      this.weather = new MR.Weather(wc, MR.Weather.levelConfig(wc, this.levelId, this.isCity), { seed: wsel.seed, force: wsel.force, cycle: wsel.cycle });
      this._wxOffset = wsel.offset;
      this.weatherView = new MR.WeatherView(this, { weather: this.weather });
    }

    // --- プレイヤー ---
    this.player = new MR.Player(this.camera, cfg.player);
    this.player.mode3d = this.isCity; // 街: カプセルの 3D 移動（階段・梯子・落下・水泳）。arena01 は今まで通り
    this.scene.add(this.player.object);

    // 操作設定（config.controls）: 撃つボタンのドラッグで視点、左の撃つボタン
    const controls = Object.assign({ fireDragLook: true, leftFireButton: true }, cfg.controls || {});
    this.input.fireDragLook = controls.fireDragLook !== false;
    if (this.hud.root && this.hud.root.classList) this.hud.root.classList.toggle('no-left-fire', !controls.leftFireButton || !this.input.isTouchDevice);
    // 設定（#btn-settings / P）: どのゲームでも（b16.2。以前はソロの街だけ）。いちばん上に「ゲーム」（省メモリモード・タイトルに戻る）。
    //   ソロの街はその下に VTOL の操作（VTOL を出す街）・戦闘機の操作（opt-in で戦闘機を出すとき）・自動フレア・街のデータ（far.bin のオン・オフ /
    //   削除）・時間帯。操作の段は #settings.no-jet / no-vtol、アリーナ・オンラインは #settings.game-only で隠す。
    //   開いている間止まるのはソロの街：フリー・アリーナ・ストーリー。オンラインとバトルロイヤルは止まらない（_settingsLive）
    this.settingsAvail = true;
    this._settingsLive = this.online || this.cityMode === 'royale';
    this.settingsOpen = false;
    this._leaveAsking = false;
    this._stOff = false;
    if (this.hud.root && this.hud.root.classList) { this.hud.root.classList.toggle('has-settings', this.settingsAvail); this.hud.root.classList.remove('settings-open'); this.hud.root.classList.remove('no-settings'); }
    { const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('settings') : null; if (el && el.classList) { el.classList.add('hidden'); el.classList.remove('asking'); } } // 「もう一度」: 前のゲームの開いた板を残さない
    this._leaveAsk(false);

    // --- 乗り物（levels の vehicles。設定は config.vehicles）。街では city.vehicles が true のとき、チャンクの vehicles から出す（_updateCityVehicles）---
    //   街のオンラインはサーバーの番号の記録から近い物だけ（cityonline.js）
    if (!this.isCity) this._spawnVehicles();
    else if ((this.cityCfg.vehicles || this.online) && MR.Vehicle && this.rs.vehicles !== false) this._makeHeadlight();

    // 発砲時に周囲を照らす点光源（本体シーン側。カメラの子）
    this.muzzleLight = new THREE.PointLight(MR.srgb('#ffb060'), 0, 10, 2);
    this.muzzleLight.position.set(0.2, -0.2, -0.9);
    this.camera.add(this.muzzleLight);

    // --- 武器 ---
    for (const def of cfg.weapons) {
      const w = new MR.Weapon(def, this.camera, this.viewRoot, this.audio, this.fx, this.muzzleLight, this.assets);
      w.setVisible(false);
      w.onChange = (ammo, reserve, reloading) => { if (w === this.weapon) this.hud.setAmmo(ammo, reserve, reloading); };
      this.weapons.push(w);
    }
    this.hud.setWeapons(this.weapons.map((w) => w.def.name));
    this._selectWeapon(0, true);
    // ナイフ（melee.js。game.weapons には入らない）: 「格闘」ボタン。オンラインは出さない（melee.online）
    this.melee = (MR.Melee && MR.Melee.enabledFor(this)) ? new MR.Melee(this, cfg.melee) : null;
    if (MR.Melee) MR.Melee.enemyCfg = this.melee ? this.melee.cfg.enemy : null; // 敵のナイフ（K3。オンラインは持たない）
    this.input.meleeGuardMs = this.melee ? this.melee.cfg.guardMs : 150;
    if (this.hud.root && this.hud.root.classList) this.hud.root.classList.toggle('has-knife', !!this.melee);
    // 街: 落ちている物・持ち物（ピストルだけで始まる）・ミニマップ。バトルロイヤルは安全地帯と参加者
    // オンライン: CityPlay（サーバーに頼む形）と CityOnline（乗り物・範囲・ラウンド）。仮想の参加者・AI の敵は出さない
    if (this.isCity && MR.CityPlay) {
      if (this.online && MR.CityOnline) this.cityOnline = new MR.CityOnline(this);
      this.play = new MR.CityPlay(this);
      if (!this.online && this.cityMode === 'royale' && MR.RoyaleMode) this.royale = new MR.RoyaleMode(this, { seed: this.opts.royaleSeed, transport: this.opts.transport, contestants: this.opts.contestants });
      // ストーリー（storymode.js）: 章の systems（対空の陣地・船・ヘリ・戦闘機・街の乗り物）は下の作り分けが this.story を見る
      if (!this.online && this.cityMode === 'story' && MR.StoryMode) this.story = new MR.StoryMode(this, this.opts.story);
    }
    // 対空の見張り（MANPADS の陣地。airdefense.js）: ソロの街：フリーとバトルロイヤルだけ。city.airDefense（バトロワは royale.airDefense を重ねる）。
    //  enabled: false・opts.airDefense === false・URL ?airdef=0 で出さない
    if (this.isCity && !this.online && this.cityMode && MR.AirDefense && this.opts.airDefense !== false && !(this.story && !this._storySys('airDefense'))) {
      const adc = Object.assign({}, this.cityCfg.airDefense || {}, this.cityMode === 'royale' ? ((cfg.royale || {}).airDefense || {}) : {});
      let off = adc.enabled === false;
      try { if (/[?&]airdef=0\b/.test((typeof location !== 'undefined' && location.search) || '')) off = true; } catch (e) { /* ignore */ }
      // ストーリー: 章の airDefense（sites = 陣地の場所、cfg = 数の上書き。章が決めた陣地だけ・倒れたら戻らない など）
      const sAD = this.story && this.story.ch && this.story.ch.airDefense;
      if (sAD && Array.isArray(sAD.sites)) this._adSites = sAD.sites;
      // 章の陣地は章の目的（第5章の counter aa）なので、街の切り替え（enabled: false・?airdef=0）では消さない（消すと章が終わらない）
      if (sAD) { off = false; adc.enabled = true; }
      if (!off) this.airDefense = new MR.AirDefense(this, sAD && sAD.cfg ? Object.assign({}, adc, sAD.cfg) : adc);
    }
    // 復活する場所を選ぶ（respawn.js）: ソロの街：フリーとアリーナだけ（バトルロイヤルは 1 回だけ、オンラインはサーバーが決める）
    if (!this.online && !this.royale && !this.story && MR.RespawnUI && (cfg.respawn || {}).enabled !== false) this.respawnUI = new MR.RespawnUI(this, cfg.respawn || {});
    // Sky High の高速エレベーター（lift.js。ソロの街と、welcome の caps に 'lift' がある街のオンライン = lift / lifted）
    if (this.isCity && (!this.online || this.cityOnline) && MR.Lift && this.city && this.city.lifts && this.city.lifts.length) this.lift = new MR.Lift(this, cfg.lift);

    // --- ポストプロセス ---
    if (useComposer) this._setupComposer(rs);
    // 街: ヘリの操縦席を重ね描くカメラとパス（ヘリに乗った一人称のときだけ動く）
    if (this.isCity) this._setupCockpit();
    // 街: 戦闘機のアフターバーナーの光（1 灯だけ。ライトの数を変えないため常にシーンに置く）と HUD
    if (this.isCity && this._jetsOn() && MR.Jet) this._setupJets();
    else if (this.isCity && this._vtolOn() && MR.JetHUD) this._setupJetHud(); // VTOL（V3）: 同じキャンバスに drawVtol
    // 街: 船（boats。ソロのフリー・バトルロイヤル。マリーナのボート・波・航跡。オンラインは boats M5）
    //   VTOL の機内（V2）も同じ動く足場（Platforms の 'v' の provider）なので、ボートが無くても VTOL が出るなら作る
    {
      const boatsOn = this.cityCfg.boats !== false && !(this.cityMode === 'royale' && (cfg.royale || {}).boats === false) && !(this.story && !this._storySys('boats'));
      const vd = this.isCity && !this.online && (this._vtolHere() || this.story) && // ストーリーの七号機（'no7'）も機内を歩く
         this.assets && typeof this.assets.get === 'function' ? this.assets.get('levels/vtol.json') : null;
      const cabin = vd && vd.cabin && vd.cabin.walk && vd.cabin.profile ? vd.cabin : null;
      if (this.isCity && !this.online && MR.CityBoats && (boatsOn || cabin)) {
        this.cityBoats = new MR.CityBoats(this, { boats: boatsOn, vtol: cabin });
        if (cabin && this.cityBoats.platforms && MR.Vtol.cabinProvider) this.cityBoats.platforms.addProvider(MR.Vtol.cabinProvider(() => this.vehicles, cabin));
      }
    }
    // 街: 水のしぶき（waterfx.js。ヘリの吹き下ろし。?spray=0 か waterFx.enabled: false で今までのスプライト）
    if (this.isCity && MR.WaterFX && Game.sprayOn(cfg.waterFx)) {
      this.waterFx = new MR.WaterFX(this.scene, { cfg: cfg.waterFx, mobile: this.input.isTouchDevice, saver: this.saver, city: this.city, water: this.world.water, audio: this.audio });
      this.fx.waterFx = this.waterFx;
      if (this.gradePass && this.gradePass.uniforms.uLensCells) this.gradePass.uniforms.uLensCells.value = this.waterFx.cfg.lensCells;
    }

    // manhattan: タイムズスクエアの看板・LED・売店・TKTS の階段（timessq.js。見た目だけ。?ts=0 か render.city.timesSquare.enabled: false で出さない）
    if (MR.TimesSquare && MR.TimesSquare.enabled(this)) this.timesSquare = new MR.TimesSquare(this);
    if (this.online) this._startOnline();
    else if (this.story) this._respawnPlayer(this.story.startSpot()); // ストーリー: 章の始め・チェックポイントの場所（続きからも story が決める）
    else if (this.resume && MR.Session) MR.Session.apply(this, this.resume); // 続きから（位置・持ち物。_respawnPlayer の代わり）
    else this._respawnPlayer();
    if (this.royale) this.royale.begin();
    else if (this.story) this.story.begin();
    else if (this.play && !this.online && !this._resumed) this.hud.showMessage('光る輪の上の武器を拾おう', 2600);
    // 街: 立っている所の近景と遠景を最初のフレームの前に作っておく（render.city.primeMs まで）
    if (this.isCity) {
      this.camera.updateMatrixWorld(true);
      const cp = this.camera.getWorldPosition(new THREE.Vector3());
      this.world.loadNavNow(this.player.pos.x, this.player.pos.z, this.player.pos.y + 0.3);
      this.cityPrimeMs = this.world.streamer.prime(cp, this.cityRender.primeMs || 1500);
      this.world.props.update(cp);
      // 外壁の材質（MR.Facade。v2 の街）のプログラムも最初の描画の前に
      if (this.world.facadeMat && this.renderer) this.world.precompileFacade(this.renderer, this.mainCamera || this.camera, this.composer && this.composer.readBuffer);
      // 家具のシェーダー（色つきのインスタンス・照明）を最初の描画の前に作っておく（初めて家具が見えたフレームで止まらない）
      if (this.world.furnView && this.renderer && typeof this.renderer.compile === 'function' && !this._furnCompiled) {
        this._furnCompiled = true;
        try { this.renderer.compile(this.scene, this.mainCamera || this.camera); } catch (e) { /* 描画で作る */ }
      }
    }
    this.hud.setKills(this.kills);
    this.hud.show();

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this._resize();

    // stop() で外す（外さないと document が古いゲームを持ち続け、「もう一度」のたびに前のゲームと街がまるごと残っていた）
    this._onVis = () => {
      if (document.hidden) { this.input.reset(); this._sessionSave('hidden'); }
      else {
        if (typeof this.audio.resume === 'function') this.audio.resume(); // iOS: 復帰後に止まった音を起こす
        if (!this._ctxLost) this._sessionSave('tick'); // 前に戻った: ここから落ちたら数える（文脈が消えたままなら _ctxTick が ctxlost）
      }
      this.lastFrame = performance.now();
    };
    document.addEventListener('visibilitychange', this._onVis);

    // --- 音: 環境音 + BGM、足音の状態 ---
    const acfg = cfg.audio || {};
    if (this.audio && typeof this.audio.ambience === 'function') {
      this.audio.ambience((this.isCity && this.cityCfg.ambience) || acfg.ambienceName || 'ambience_dusk');
      if (!this._noMusic) this.audio.music(acfg.musicName || 'music_combat');
    }
    this._stepDist = 0;
    this._stepTime = 0;
    this._wasGrounded = true;
    this._lastStepPos = new THREE.Vector3().copy(this.player.pos);

    this._sessionStart();

    this.input.enable();
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // ---------- 足あと・続きから（session.js の MR.Session。stability.session）と WebGL の文脈が消えたとき（stability.contextLoss）----------
  _sessionStart() {
    const stab = MR.Session ? MR.Session.config(this.config.stability) : { session: { enabled: false }, contextLoss: {} };
    this._sessCfg = stab.session;
    this._ctxCfg = stab.contextLoss;
    this._sessNext = 0;
    this._sessFrames = 0;
    this._sessT0 = 0;
    this._crumbFps = 0;
    this._ctxLost = 0;
    try { this._gl = this.renderer && this.renderer.getContext ? this.renderer.getContext() : null; } catch (e) { this._gl = null; }
    // WebGL の文脈が消えた（iOS 17+ の GPU プロセスが落ちた・裏で消された）: ソロは止めて待ち、戻ったら読み直さずに続ける
    this._onCtxLost = () => this._ctxOnLost();
    this._onCtxRestored = () => this._ctxOnRestored();
    try {
      if (this.canvas && this.canvas.addEventListener) {
        this.canvas.addEventListener('webglcontextlost', this._onCtxLost);
        this.canvas.addEventListener('webglcontextrestored', this._onCtxRestored);
      }
    } catch (e) { /* 無視 */ }
    if (!MR.Session || this._sessCfg.enabled === false) return;
    // ページを閉じるときも書く（裏へ行くときは _onVis）
    this._onPageHide = () => this._sessionSave('pagehide');
    try { window.addEventListener('pagehide', this._onPageHide); } catch (e) { /* 無視 */ }
    // 出来事（乗る・降りる・拾う・死ぬ）を見分ける元
    this._sessVeh = this.vehicle;
    this._sessDead = !!(this.player && this.player.dead);
    this._sessInv = this.play && this.play.inv ? this.play.inv.version : 0;
    this._sessEventAt = 0;
    this._sessionSave('tick'); // すぐに 1 回（始めた直後に落ちても次の起動で数えて・続きからにする）
  }

  _sessionStop() {
    try {
      if (this._onPageHide) window.removeEventListener('pagehide', this._onPageHide);
      if (this.canvas && this.canvas.removeEventListener) {
        if (this._onCtxLost) this.canvas.removeEventListener('webglcontextlost', this._onCtxLost);
        if (this._onCtxRestored) this.canvas.removeEventListener('webglcontextrestored', this._onCtxRestored);
      }
      if (this._ctxTap) { window.removeEventListener('pointerdown', this._ctxTap, true); this._ctxTap = null; }
    } catch (e) { /* 無視 */ }
    this._onPageHide = this._onCtxLost = this._onCtxRestored = null;
  }

  _sessionTick(now) {
    if (!this._sessCfg || this._sessCfg.enabled === false || !MR.Session) return;
    this._sessFrames++;
    const t = typeof performance !== 'undefined' ? performance.now() : now; // this.time は dt 0.05 で頭打ちなので実時間で
    // 「前回の続きから再開しました」は最初のフレームを描いた後から messageMs（apply の時点では最初の描画・シェーダーのコンパイルの前）
    if (this._resumeMsg && this._sessFrames >= 2) { this.hud.showMessage(this._resumeMsg, this._sessCfg.messageMs); this._resumeMsg = null; }
    // 出来事（乗った・降りた・死んだ・持ち物が変わった）は次のフレームで 1 回だけ（eventGap 秒に 1 回まで）
    const inv = this.play && this.play.inv ? this.play.inv.version : 0, dead = !!(this.player && this.player.dead);
    if (this.vehicle !== this._sessVeh || dead !== this._sessDead || inv !== this._sessInv) {
      if (t - this._sessEventAt >= this._sessCfg.eventGap * 1000) {
        this._sessVeh = this.vehicle; this._sessDead = dead; this._sessInv = inv;
        this._sessEventAt = t;
        this._sessionSave('event');
        return;
      }
    }
    if (!this._sessT0) { this._sessT0 = t; this._sessNext = t + this._sessCfg.saveEvery * 1000; return; }
    if (t < this._sessNext) return;
    this._crumbFps = Math.round(this._sessFrames * 1000 / Math.max(1, t - this._sessT0));
    this._sessFrames = 0;
    this._sessT0 = t;
    this._sessNext = t + this._sessCfg.saveEvery * 1000;
    this._sessionSave('tick');
  }

  _sessionSave(reason) {
    if (!MR.Session || !this._sessCfg || this._sessCfg.enabled === false) return;
    if (this._sessExited) return;
    // 文脈が消えて読み直している途中（_ctxGiveUp）: 読み直しで来る visibilitychange（hidden）・pagehide で ctxlost を上書きしない
    //   （上書きすると次の起動で数えず「前回」の 1 行も出なかった）
    if (this._sessReloading && (reason === 'hidden' || reason === 'pagehide')) return;
    if (reason === 'exit') this._sessExited = true;
    try { MR.Session.save(this, reason); } catch (e) { /* 書けなくても遊べる */ }
  }

  // 文脈が消えた: ソロは止める（真っ黒な間に敵に撃たれない）。オンラインは更新を続け、描かないだけ
  _ctxOnLost() {
    if (MR.Session) MR.Session.count('ctxLost');
    this._ctxLost = performance.now();
    this._sessReloading = false; // 読み直したはずのページがまだ動いている（読み直しが止められた）: また普通に保存する
    this._ctxVisibleAt = 0;
    this._ctxRehydrating = 0;
    this._ctxGaveUp = false;
    // 裏にいる間に消えた（iOS が裏のアプリの GPU を捨てる）: 落ちたことにしない（hidden のまま。見えるようになったら _ctxTick が ctxlost）
    this._ctxBg = typeof document !== 'undefined' && !!document.hidden;
    this._sessionSave(this._ctxBg ? 'hidden' : 'ctxlost');
    if (this.input && this.input.reset) this.input.reset();
    this.hud.showMessage('画面を復元中…', 600000);
  }

  // 文脈が戻った: three が GL の状態を作り直し、形と Canvas のテクスチャは CPU の写しから自分で送り直す。
  //   画像を GPU に送った後に捨てている（AssetManager.releasedCount > 0）ときは、読み直して（rehydrateAll）から続ける
  _ctxOnRestored() {
    if (MR.Session) MR.Session.count('ctxRestored');
    const AM = MR.AssetManager;
    const released = (AM && AM.releasedCount) || 0;
    if (!released) { this._ctxDone(); return; }
    if (typeof AM.rehydrateAll !== 'function') { this._ctxGiveUp('norehydrate'); return; }
    const t0 = performance.now();
    this._ctxRehydrating = t0;
    let p;
    try { p = Promise.resolve(AM.rehydrateAll((r) => { if (this._ctxLost) this.hud.showMessage('画面を復元中… ' + Math.round((r || 0) * 100) + ' %', 600000); })); } catch (e) { p = Promise.reject(e); }
    p.then(() => {
      if (!this.running || this._ctxRehydrating !== t0) return;
      if (MR.Session) MR.Session.count('rehydrated', Math.round(performance.now() - t0));
      this._ctxDone();
    }, (e) => {
      if (!this.running || this._ctxRehydrating !== t0) return;
      console.warn('[Game] 画像の読み直しに失敗', e);
      this._ctxGiveUp('rehydrate');
    });
  }

  _ctxDone() {
    this._ctxLost = 0;
    this._sessReloading = false;
    this._ctxRehydrating = 0;
    this._ctxGaveUp = false;
    if (this._ctxTap) { try { window.removeEventListener('pointerdown', this._ctxTap, true); } catch (e) { /* 無視 */ } this._ctxTap = null; }
    this._ctxBg = false;
    this.lastFrame = performance.now();
    this.hud.showMessage('', 1);
    this._sessionSave(typeof document !== 'undefined' && document.hidden ? 'hidden' : 'tick'); // 裏で戻ったなら裏のまま
  }

  // 文脈が消えている間（_loop から毎フレーム）。戻り値 true = このフレームは何もしない（ソロ）
  //   見えるようになってから watchdog 秒たっても戻らない・読み直しが rehydrateMax 秒を超えた → 保存して読み直す（続きからになる）
  _ctxTick(now) {
    const c = this._ctxCfg || {}, t = performance.now();
    if (typeof document !== 'undefined' && document.hidden) this._ctxVisibleAt = 0;
    else if (!this._ctxVisibleAt) {
      this._ctxVisibleAt = t;
      if (this._ctxBg) { this._ctxBg = false; this._sessionSave('ctxlost'); } // 前に戻ってもまだ消えている
    }
    if (!this._ctxGaveUp) {
      if (this._ctxRehydrating && t - this._ctxRehydrating > (c.rehydrateMax || 20) * 1000) this._ctxGiveUp('rehydrate-timeout');
      else if (!this._ctxRehydrating && this._ctxVisibleAt && t - this._ctxVisibleAt > (c.watchdog || 6) * 1000) this._ctxGiveUp('watchdog');
    }
    this.lastFrame = now;
    return !this.online && c.pause !== false;
  }

  // 最後の手段: 読み直す（MR.Session の続きからで戻る）。reloadOncePerMin 分に 1 回まで。それより多いならタップを待つ
  _ctxGiveUp(why) {
    if (this._ctxGaveUp) return;
    this._ctxGaveUp = why || true;
    const c = this._ctxCfg || {}, key = 'mirrsona.ctxReload';
    let last = 0;
    try { last = +(window.sessionStorage && window.sessionStorage.getItem(key)) || 0; } catch (e) { last = 0; }
    // 読み直す直前にもう一度保存して（タップを待つ間に裏へ行って hidden になっていることがある）、読み直しの hidden / pagehide では書かない
    const reload = () => {
      this._sessReloading = false;
      this._sessionSave(typeof document !== 'undefined' && document.hidden ? 'hidden' : 'ctxlost');
      this._sessReloading = true;
      try { if (typeof location !== 'undefined' && location.reload) location.reload(); } catch (e) { /* 無視 */ }
    };
    if (Date.now() - last > (c.reloadOncePerMin || 10) * 60000) {
      try { if (window.sessionStorage) window.sessionStorage.setItem(key, String(Date.now())); } catch (e) { /* 無視 */ }
      this._ctxReloads = (this._ctxReloads || 0) + 1;
      reload();
      return;
    }
    this._sessionSave(typeof document !== 'undefined' && document.hidden ? 'hidden' : 'ctxlost');
    this.hud.showMessage('画面を復元できませんでした — タップで再読み込み', 3600000);
    this._ctxTap = () => { this._ctxReloads = (this._ctxReloads || 0) + 1; reload(); };
    try { window.addEventListener('pointerdown', this._ctxTap, true); } catch (e) { /* 無視 */ }
  }

  _setupComposer(rs) {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    // 既定のレンダーターゲットは深度 16 bit（遠くで Z ファイティング）かつ 8 bit（暗い空が段々になる）なので、
    // 深度 24 bit + ステンシル、WebGL2 なら半精度浮動小数のターゲットを明示して渡す
    let target = null;
    try {
      const px = this.renderer.getDrawingBufferSize ? this.renderer.getDrawingBufferSize(new THREE.Vector2()) : size.clone();
      const caps = this.renderer.capabilities || {};
      const ext = this.renderer.extensions;
      const half = rs.hdrBuffer !== false && !!caps.isWebGL2 && !!(ext && typeof ext.has === 'function' && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float')));
      target = new THREE.WebGLRenderTarget(Math.max(1, px.x), Math.max(1, px.y), {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
        type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, stencilBuffer: true
      });
    } catch (e) { target = null; }
    this.composer = target ? new THREE.EffectComposer(this.renderer, target) : new THREE.EffectComposer(this.renderer);
    const mainPass = new THREE.RenderPass(this.scene, this.mainCamera || this.camera);
    const viewPass = new THREE.RenderPass(this.viewScene, this.camera);
    viewPass.clear = false;
    viewPass.clearDepth = true;
    this.composer.addPass(mainPass);
    this.composer.addPass(viewPass);
    this.bloomPass = new THREE.UnrealBloomPass(size, rs.bloomStrength, rs.bloomRadius, rs.bloomThreshold);
    this.composer.addPass(this.bloomPass);
    // look.js: ガンマ補正と色調を 1 つのパスで（全画面のパスが 1 つ減る）
    if (this.look && THREE.ShaderPass) { this.gradePass = this.look.makePass(); this.composer.addPass(this.gradePass); }
    // レンダーターゲット経由だと outputEncoding が効かないので、最後に sRGB へ変換する
    else if (THREE.GammaCorrectionShader) this.composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
    // 画面端を少し暗くし、彩度をわずかに上げる（render.vignette / render.saturation。0 と 1 で無効）
    if (!this.look && (rs.vignette > 0 || rs.saturation !== 1) && THREE.ShaderPass) {
      this.gradePass = new THREE.ShaderPass(Game.gradeShader());
      this.gradePass.uniforms.vignette.value = rs.vignette || 0;
      this.gradePass.uniforms.saturation.value = rs.saturation == null ? 1 : rs.saturation;
      this.composer.addPass(this.gradePass);
    }
    if (rs.fxaa && THREE.FXAAShader) {
      this.fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
      this.composer.addPass(this.fxaaPass);
    }
  }

  // ビネット + 彩度のシェーダー（ガンマ補正の後、FXAA の前に入れる）。
  //   レンズの水滴（MR.WaterFX の lens 0..1。uLens が 0 なら何もしない = uniform の分岐だけ）: 画面を格子に分け、マスごとに乱数で
  //   水滴の位置・大きさ・寿命を決める。水滴の中は外の景色を少し引き寄せて写す（屈折のまね）・縁を暗く・上を明るく。少しずつ下へ流れて消える
  static gradeShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        vignette: { value: 0.35 },
        saturation: { value: 1.06 },
        uLens: { value: 0 }, uLensT: { value: 0 }, uAspect: { value: 1.6 }, uLensCells: { value: 7 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation;',
        'uniform float uLens; uniform float uLensT; uniform float uAspect; uniform float uLensCells;',
        'varying vec2 vUv;',
        'float lHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }',
        'void main() {',
        '  vec2 uv = vUv;',
        '  float lm = 0.0, lrim = 0.0, lspec = 0.0;',
        '  if (uLens > 0.001) {',
        '    vec2 p = vec2(vUv.x * uAspect, vUv.y) * uLensCells;',
        '    vec2 cell = floor(p), f = fract(p);',
        '    float h = lHash(cell), h2 = lHash(cell + 17.3), h3 = lHash(cell + 41.7);',
        '    float per = 2.2 + 2.6 * h2;',
        '    float ph = fract(uLensT / per + h);',
        '    float on = smoothstep(h3 - 0.08, h3, uLens * 0.85);',
        '    vec2 ctr = vec2(0.25 + 0.5 * h, 0.75 - 0.5 * h2 * 0.5 - ph * 0.35 * h3);',
        '    float r = 0.07 + 0.15 * fract(h * 7.31);',
        '    vec2 d = f - ctr; d.y *= 1.0 + ph * 0.6;',
        '    float q = length(d) / r;',
        '    lm = on * (1.0 - smoothstep(0.75, 1.0, q)) * (1.0 - smoothstep(0.6, 1.0, ph)) * smoothstep(0.0, 0.05, ph);',
        '    lrim = lm * smoothstep(0.7, 0.98, q);',
        // 水滴は凸レンズ: 中の景色は逆さで大きい（中心から外へ向かうほど反対側を写す）
        '    uv = vUv + d / uLensCells * vec2(1.0 / uAspect, 1.0) * lm * 2.2;',
        '    vec2 hl = d / r - vec2(-0.35, 0.4);',
        '    lspec = lm * (1.0 - smoothstep(0.0, 0.22, length(hl)));',
        '  }',
        '  uv = 1.0 - abs(1.0 - abs(uv));', // 画面の外は鏡に（端の画素が伸びない）
        '  vec4 c = texture2D(tDiffuse, uv);',
        '  if (lm > 0.0) c.rgb = c.rgb * (1.0 - 0.35 * lrim) * (1.0 + 0.08 * lm) + vec3(0.55) * lspec;',
        '  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));',
        '  c.rgb = mix(vec3(l), c.rgb, saturation);',
        '  vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);',
        '  float v = 1.0 - smoothstep(0.35, 1.05, length(d) * 1.4142) * vignette;',
        '  gl_FragColor = vec4(c.rgb * v, c.a);',
        '}'
      ].join('\n')
    };
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.mainCamera) { this.mainCamera.aspect = w / h; this.mainCamera.updateProjectionMatrix(); }
    if (this.composer) {
      // R0: ポストは CSS の画素 × s で描く（ターゲットを渡した EffectComposer は _pixelRatio 1。s はクラスごと = cinebench.js postScale）
      const s = MR.CineBench && MR.CineBench.postScale ? MR.CineBench.postScale(this, w, h) : 1;
      if (this.composer._pixelRatio !== s) this.composer.setPixelRatio(s);
      this.composer.setSize(w, h);
      if (this.gradePass && this.gradePass.uniforms.uAspect) this.gradePass.uniforms.uAspect.value = w / Math.max(1, h);
      if (this.fxaaPass) this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * s), 1 / (h * s));
    }
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this._loop(t));
    if (this._ctxLost && this._ctxTick(now)) return; // WebGL の文脈が消えている間（ソロは止める。オンラインは描かないだけ）
    this._sessionTick(now); // 足あと・続きからの保存（session.js）: saveEvery 秒ごとに 1 回だけ書く
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    // 設定（ボタン・P）: ソロは開いている間ゲームを止める（描くだけ）
    // 復活する場所を選んでいる間は設定を開かない（死亡画面の上に重ねない。開いていれば閉じるのはよい）
    //   死んでいる間・結果の画面の間（止まらないオンライン・バトルロイヤルで起きる）は開かない・開いていれば閉じる・ボタンも隠す（#hud.no-settings）
    const stOff = !!(this._deathUI || (this.player && this.player.dead) || (this.hud && this.hud.resultShown));
    if (stOff !== !!this._stOff) { this._stOff = stOff; if (this.hud.root && this.hud.root.classList) this.hud.root.classList.toggle('no-settings', stOff); }
    if (this.settingsOpen && stOff) this.toggleSettings(false);
    if (this.input.consumeSettings && this.input.consumeSettings() && (this.settingsAvail || this.settingsOpen) && (this.settingsOpen || !stOff)) this.toggleSettings();
    if (this.settingsOpen && (this._settingsT = (this._settingsT || 0) + dt) > 0.5) { this._settingsT = 0; this._syncSettings(); } // ダウンロードの進み
    if (this.settingsOpen && this.input.consumeMelee) this.input.consumeMelee(); // 設定を開いている間のナイフの入力は捨てる（閉じたときに振らない）
    if (this.settingsOpen && !this.online && !this._settingsLive) { if (!this._ctxLost && !(this._gl && this._gl.isContextLost())) this._render(); return; }
    this.time += dt;
    this._update(dt);
    if (!this._ctxLost && !(this._gl && this._gl.isContextLost())) this._render(); // 文脈が消えた直後（イベントの前）も描かない
    // オンライン: 最初の描画（シェーダーのコンパイル）で止まっていた間の ping は RTT に数えない
    if (this.online && !this._pingsReset) { this._pingsReset = true; this.net.discardPings(); }

    if (MR.CONFIG.DEBUG) {
      this.frameCount++;
      this.fpsTimer += dt;
      if (this.fpsTimer >= 0.5) {
        this.fps = Math.round(this.frameCount / this.fpsTimer);
        this.frameCount = 0; this.fpsTimer = 0;
        const info = this.renderer.info.render;
        this.hud.setDebug(this.fps + ' fps  calls ' + info.calls + '  tris ' + info.triangles + '  enemies ' + this.enemies.length +
          '  data ' + this.assets.source + ' ' + (this.assets.manifest && this.assets.manifest.version) + ' ' + (this.assets.tier || '') +
          '  tex ' + (this.materials ? this.materials.source : '-') + ' props ' + this.world.propsSource + ' sky ' + this.sky.source +
          '  gun ' + this.weapon.modelSource + ' char ' + (this.enemies[0] ? this.enemies[0].character.source : '-') + ' audio ' + (this.audio.source || '-') +
          '  veh ' + (this.vehicles[0] ? this.vehicles[0].modelSource : '-') + (this.isCity ? this._cityDebug() : '') + (this.destruct ? this.destruct.debugText() : '') + (MR.CineBench ? MR.CineBench.debugText(this) : ''));
      }
    }
  }

  _render() {
    this._gateFrame(); // 描くフレームごと（設定を開いて止めている間も _render だけは回る）
    this._gpuTexPreDraw();
    // ビューモデルのルートをカメラに重ねる
    this.camera.updateMatrixWorld(true);
    this.viewRoot.matrix.copy(this.camera.matrixWorld);
    this.viewRoot.matrixWorldNeedsUpdate = true;
    this.sky.update(this.camera.getWorldPosition(this._tmpV3));
    if (this.mainCamera) this._syncMainCamera();
    if (this.weatherView) this.weatherView.preRender(this.mainCamera || this.camera); // 置いて uniform を書くだけ（時間は進めない）
    // 室内の色は天気の色（sky.hemiBaseSky / hemiBaseGround）から混ぜ直す: preRender の sky.applyWeather と _vHemi が半球光の色を天気の色に書くので、
    //   その後（描く直前）に look の室内の色を重ねる（_update の中で混ぜても、ここで毎フレーム上書きされて室内の色が消えていた）
    if (this.weatherView && this.look) this.look.reapply();
    if (this.isCity && (this._underK > 0 || this._under)) this._underLight(); // 地下（NC6）: 太陽 0・半球光・霧の色・空を隠す（_underK で混ぜる）
    // 地下（NC6 の直し）: 口の近く（surfaceLevel 1）は口の視錐台の外の地上の物（近景のメッシュ・乗り物・敵）を描かない、深い所（2）は地上の乗り物・敵も
    //   描かない。地下では影の地図を描き直さない（太陽 0 = 影は見えない）。どちらも描いた後に戻す（持ち主の visible を上書きしない）
    //   オンライン（NC8 の直し）: ほかのプレイヤー（体と名前の札）も同じ決まり + 通りのカメラからは口の視錐台の外の駅の中のプレイヤーを描かない
    const hid = this.isCity && (this.world.surfaceLevel || (this.remotes.size && this.world.city && this.world.city.rail && this.world.city.rail.pits)) ? this._portalCull() : null;
    const sm0 = this.renderer.shadowMap, underSm = !!(sm0 && this.isCity && this.world.underground), smAuto = underSm ? sm0.autoUpdate : true;
    if (underSm) sm0.autoUpdate = false;
    const cockpit = this.cockpitCamera ? this._syncCockpit() : false;
    if (this.jetHud && this.jetHud.visible) { if (this.vehicle && this.vehicle.kind === 'vtol') this._drawVtolHud(); else this._drawJetHud(); }

    // ステンシルの書く mask を戻してからクリアする（three r128 の clear は mask を戻さない。ボートの舷縁の板の bit が積もらないように）
    const sst = this.renderer.state;
    if (sst && sst.buffers && sst.buffers.stencil && sst.buffers.stencil.setMask) sst.buffers.stencil.setMask(0xff);
    if (this.melee) this.melee.beforeRender(); // 届いたナイフを画面の外で 1 回描く（最初の「格闘」で止まらない）
    // 爆発の閃光（destruct-3 M1）: 描く間だけ露出を上げて戻す（ライトを増やさない・天気 / 時間帯の露出はそのまま）
    const bfk = this.blastFx ? this.blastFx.flash() : 0, ex0 = this.renderer.toneMappingExposure;
    if (bfk > 0) this.renderer.toneMappingExposure = ex0 * (1 + bfk);
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.mainCamera || this.camera);
      if (cockpit) { this.renderer.clearDepth(); this._renderCockpit(this.renderer); }
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.camera);
    }
    if (bfk > 0) this.renderer.toneMappingExposure = ex0;
    if (this.melee) this.melee.afterRender();
    if (underSm) sm0.autoUpdate = smAuto;
    if (hid) { for (let i = 0; i < hid.length; i++) hid[i].visible = true; hid.length = 0; }
    // 天気: 後から見せる物（雨・雷）のプログラムを最初のフレームの後にコンパイルしておく
    if (this.weatherView && !this._wxCompiled) { this._wxCompiled = true; this.weatherView.precompile(this.mainCamera || this.camera); }
  }

  _update(dt) {
    this._gpuTexStep();
    const player = this.player;
    // 天気: 時計を進めて今の値（p）。シミュレーションだけ（ソロの設定のパネルで止まっている間は進まない）
    const wp = this.weather ? this.weather.update(this._weatherClock(dt)) : null;
    // ADS（照準）: 入力 → 武器 → HUD / 視点感度（player.update の前に。lookScale は consumeLook に掛かる）
    // 梯子・水中・よじ登りの間は銃を下げる（撃てない・覗けない。arena01 では常に撃てる）
    // ヘリの操縦席・3 人称カメラでは撃てない（銃は隠す）
    // 戦闘機は人の銃を撃たない（操縦席の撃つボタンは機関砲。_updateJetGun）
    const heliNoFire = !!(this.vehicle && ((this.vehicle.kind === 'heli' && (!(this.vehicleSeat > 0) || this.heliChase)) || this.vehicle.kind === 'jet' || this.vehicle.kind === 'vtol')) || !!(this.cityBoats && this.cityBoats.noFire);
    // 街のオンライン: バトロワのロビー・結果の間と輸送ヘリの中は撃てない（サーバーも数えない）
    const canShoot = player.canShoot && !heliNoFire && !(this.cityOnline && !this.cityOnline.canShoot) && !(this.lift && this.lift.riding);
    const healing = !!(this.play && this.play.heal);
    if (this.isCity) for (const w of this.weapons) w.setLowered((!canShoot || healing) && !player.dead);
    this.weapon.setAds(!player.dead && this.input.adsHeld && canShoot && !(this.melee && this.melee.busy)); // ナイフの間は覗かない（音も鳴らさない）
    this.input.lookScale = this.weapon.lookScale();
    // 照準線は「実際に覗いている」とき（リロード中は腰だめに戻る）だけ消す。ボタンの表示はトグル状態
    this.hud.setAds(this.weapon.adsActive, this.weapon.ads);
    if (this.hud.setScope) this.hud.setScope(!player.dead && this.weapon.scoped);
    const look = this.input.peekLook ? this.input.peekLook() : { x: 0, y: 0 };

    // 乗り物（プレイヤーより先に動かし、座席の位置を今フレームのものにする）
    // 街のオンラインは 0 台でも回す（近くに来た乗り物を作るのは cityOnline.updateVehicles。止めると二度と出ない）
    if (this.cityBoats) this.cityBoats.preUpdate(dt); // 船: 時計・波（乗り物より先）
    if (this.vehicles.length || this.cityOnline) this._updateVehicles(dt);
    // ミサイル・フレア・煙の帯: 毎フレーム（乗り物が無くても・歩いていても。消えた後の帯もここで薄くなる）
    // 対空の見張り: 見る・ロック・撃つ（撃ったミサイルは同じフレームの missiles.update から飛ぶ）
    if (this.airDefense) this.airDefense.update(dt);
    if (this.missiles) this.missiles.update(dt, this._missileCtx());
    // 墜落の火の記録（カメラからの距離で煙・炎を出す・残骸について行く・音）。板は後の puffs.update が書く
    if (this.crashes) this.crashes.update(dt, this.camera.getWorldPosition(this._crashCam || (this._crashCam = new THREE.Vector3()))); // 描く前でも今のカメラ（mainCamera は _render で写す）
    if (this.blastFx) this.blastFx.update(dt);
    if (this.debris) this.debris.update(dt, this._crashCam); // 破片と外れた部品（跳ねる・止まる・沈む）
    if (this.airCombat) {
      const av = this.vehicle;
      if (!(av && (av.kind === 'jet' || av.kind === 'vtol') && !(this.vehicleSeat > 0) && !player.dead)) this.airCombat.idle(); // ロックの音は戦闘機・VTOL の操縦席だけ
      // RWR（印・音）は戦闘機・ヘリ・VTOL に乗っている間だけ（乗っていなければ消す）
      if (!(av && (av.kind === 'jet' || av.kind === 'heli' || av.kind === 'vtol') && !player.dead) && (this.rwr || this.airCombat.rwrSound)) this.airCombat.rwrOff();
    }

    if (this.royale) this.royale.tick();
    if (this.story) this.story.tick();
    // ナイフ（V・中ボタン・「格闘」）: 徒歩のときだけ振る。乗り物の中・死んでいる間の押した分は捨てる（V は乗り物の視点の切替）
    const meleePress = typeof this.input.consumeMelee === 'function' ? this.input.consumeMelee() : false;
    if (player.dead) {
      this._drainJetInput();
      // エレベーター: _onPlayerDied を通らない死に方でも暗いまま残さない
      if (this.lift && (this.lift.ride || this.lift.fade > 0)) this.lift.onDeath();
      if (this.online) this._updateOnlineDeath(dt);
      else if (!this.royale && !this.story) {
        // ソロ: 「復活する場所」の画面（respawn.js。場所を選んで「復活」）。無ければ（自動テストの AUTO_RESPAWN）respawnDelay 秒後に今まで通り
        if (this._deathUI) this._deathUI.update(dt);
        else if (this.time >= this.respawnAt) this._respawnPlayer();
      }
    } else {
      // ほかの道で生き返った（テスト・続きから）: 復活の画面を閉じる
      if (this._deathUI) { this._deathUI.close('revived'); this._deathUI = null; }
      if (this.respawnUI) this.respawnUI.tick(dt); // 復活の直後の暗転を戻す
      if (this.play) this.play.preUpdate();
      if (this.lift) this.lift.update(dt);
      this._updateVehicleInteract();
      if (this.story && this.story.cineActive) {
        this.story.updateCine(dt); // ストーリーの場面: カメラだけ動く（プレイヤーは止まったまま。乗り物の中でも = 第5章の甲板）
      } else if (this.vehicle) {
        this._updateDriving(dt);
      } else if (this.freeCam) {
        this._updateFreeCam();
      } else if (this.royale && this.royale.riding) {
        this.royale.updateRide(dt);
      } else if (this.cityOnline && this.cityOnline.riding) {
        this.cityOnline.updateRide(dt);
      } else if (this.lift && this.lift.riding) {
        // エレベーターの暗転の間は動かない（lift.js が置き直す）。跳ぶ入力は捨てる（着いたとたんに跳ばない）
        this.input.consumeJump();
      } else {
        this._crouchInput(player);
        player.update(dt, this.input, this.cityBoats ? this.cityBoats.playerWorld() : this.world); // 近くの船の甲板も歩ける nav（M3）
        if (player.stoodByJump) { player.stoodByJump = false; this.input.setCrouch(false); } // ジャンプで立った: ボタンの切り替えも戻す
        if (this.isCity) this._cityPlayerEvents();
        if (this.cityBoats) this.cityBoats.postPlayer(dt); // 動く甲板に乗る・降りる、泳いでいる人をボートが押す・はねる
        if (this.isCity) this._vtolWalkTick(dt); // VTOL の機内（V2）: 足場の上・'boarded'・外の案内
        // 徒歩のときは車体に押し出される。オンラインでは押された先が箱に掛かれば箱の外へ戻す
        // （サーバーは壁の中の位置を受け取らない。車と壁に挟まれたら車体に少しめり込む方を選ぶ）
        for (const v of this.vehicles) {
          if (this.isCity && (Math.abs(player.pos.y - v.pos.y) > 1.6 || player.state !== 'walk')) continue; // 街: 高さの違う車（高架の上と下）・梯子や水の中は押さない
          if (v.sunk || (this.isCity && v.wrecked && v.root && !v.root.visible)) continue;
          if (v.carrier) continue; // VTOL に積んだ車（V2c）: 機内の足場の箱（':car' の型）が止める
          if (v.kind === 'vtol' && v.walkable && v.walkable() && this.cityBoats && this.cityBoats.platforms) continue; // VTOL の機内（V2）: 殻の箱（動く足場）が止める（傾斜板を上がれる）
          if (!v.pushOut(player.pos, player.radius)) continue;
          if (this.isCity) { const s = this.world.nav.resolveCapsule(player.pos, player.radius, 1.8, 0.45, { snapDown: 0.45 }); player.pos.x = s.x; player.pos.z = s.z; }
          else if (this.online) {
            const s = this.world.nav.resolveCircle(player.pos.x, player.pos.z, player.radius);
            player.pos.x = s.x; player.pos.z = s.z;
          }
          player._apply();
        }
        this._updateFootsteps(dt, player);
      }

      if (this.melee) {
        if (meleePress && !this.vehicle) this.melee.press();
        this.melee.update(dt);
      }
      const meleeBusy = !!(this.melee && this.melee.busy);
      if (meleeBusy) { /* 振っている間の切替・装填は振り終わってから */ }
      else if (this.play) this.play.weaponInput(); // 街: 3 つの枠（切替・1〜3・装填。予備が無ければ「弾がない」）
      else {
        if (this.input.consumeSwap()) this._selectWeapon((this.weaponIndex + 1) % this.weapons.length);
        const sel = this.input.consumeSelect ? this.input.consumeSelect() : -1;
        if (sel >= 0 && sel < this.weapons.length && sel !== this.weaponIndex) this._selectWeapon(sel);
        if (this.input.consumeReload()) this.weapon.startReload(this.time);
      }
      const press = this.input.consumeFirePress();
      if (healing && (press || this.input.fireHeld)) this.play.cancelHeal('fire'); // 撃つと回復をやめる
      const wantFire = this.weapon.def.automatic ? this.input.fireHeld : press;
      if (wantFire && canShoot && !meleeBusy) this.weapon.tryFire(this.time, (dirs, def) => this._resolveShots(dirs, def));
    }
    if (this.hud.setCrouch) this.hud.setCrouch(this._crouchOk() && !player.dead && !this.vehicle && !this.freeCam && !(this.royale && this.royale.riding) && (!player.mode3d || player.state === 'walk'), player.crouched);
    const mv = this.input.getMove();
    const moving = !player.dead && !this.vehicle && (mv.x !== 0 || mv.y !== 0);
    for (const w of this.weapons) w.update(this.time, dt, look, moving, player.grounded);

    // カメラの揺れと FOV
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      player.shakeOffset.set((Math.random() - 0.5) * this.shake * 0.05, (Math.random() - 0.5) * this.shake * 0.05, 0);
    } else {
      player.shakeOffset.set(0, 0, 0);
    }
    // 低いゆれ（destruct-3 M1: 大きな爆発・倒壊の地響き。blastFx が足す）
    if (this.rumble > 0) {
      this.rumble = Math.max(0, this.rumble - dt * 0.7);
      const r = this.rumble, tt = this.time || 0;
      player.shakeOffset.x += (Math.sin(tt * 21.7) * 0.6 + Math.sin(tt * 13.1) * 0.4) * r * 0.025;
      player.shakeOffset.y += (Math.sin(tt * 17.3) * 0.6 + Math.sin(tt * 9.4) * 0.4) * r * 0.03;
    }
    this.fovKick = THREE.MathUtils.lerp(this.fovKick, 0, Math.min(1, dt * 12));
    // 運転中は速度に応じて少し広角に（スピード感）
    const vcfg = this.config.vehicles || {};
    const jv = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    const vtv = this.vehicle && this.vehicle.kind === 'vtol' ? this.vehicle : null;
    const boost = jv ? (this.jetChase ? (jv.def.chaseFovBoost == null ? 12 : jv.def.chaseFovBoost) : (jv.def.cockpitFovBoost == null ? 5 : jv.def.cockpitFovBoost))
      : vtv ? (this.vtolChase ? (vtv.def.chaseFovBoost == null ? 10 : vtv.def.chaseFovBoost) : (vtv.def.cockpitFovBoost == null ? 5 : vtv.def.cockpitFovBoost)) : (vcfg.fovBoost == null ? 6 : vcfg.fovBoost);
    const driveFov = this.vehicle ? this.vehicle.speedRatio * boost : 0;
    // 大きな G（戦闘機）: 見た目だけ少し視野を狭める（gEffect。操縦は変わらない）
    let gFx = 0;
    if (jv && jv.mode === 'air') { const GE = jv.def.gEffect; gFx = THREE.MathUtils.clamp((Math.abs(jv.gload) - GE.from) / Math.max(1, GE.full - GE.from), 0, 1); }
    this._gFx = (this._gFx || 0) + (gFx - (this._gFx || 0)) * Math.min(1, dt * (jv ? jv.def.gEffect.rate : 4));
    const fov = this.weapon.blendFov(this.rs.fov) + this.fovKick + driveFov - (jv ? this._gFx * jv.def.gEffect.fovSqueeze : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // 敵
    const ctx = {
      world: this.world, player, enemies: this.enemies, dt, time: this.time, fx: this.fx, audio: this.audio,
      audioCfg: this.config.audio || {},
      vehicles: this.vehicles,
      // ヘリで飛んでいる: 敵は heliAttackRange まで撃ち、追うときはヘリの真下の地面を目指す
      // 戦闘機も同じ（撃つ距離は city.enemy.jetAttackRange）
      playerAir: !!(this.vehicle && Game.isAirKind(this.vehicle.kind) && !this.vehicle.grounded),
      airGroundY: this.vehicle && Game.isAirKind(this.vehicle.kind) ? this.vehicle.groundY : 0,
      airAgl: this.vehicle && Game.isAirKind(this.vehicle.kind) ? this.vehicle.agl : 0,
      airSpeed: this.vehicle && Game.isAirKind(this.vehicle.kind) ? this.vehicle.speed : 0,
      //  VTOL: 巡航（翼で飛ぶ）は戦闘機と同じ jetAttackRange、ホバーはヘリと同じ（heliAttackRange）
      airRange: this.vehicle && (this.vehicle.kind === 'jet' || (this.vehicle.kind === 'vtol' && this.vehicle.flight === 'cruise')) && this.cityEnemyCfg ? this.cityEnemyCfg.jetAttackRange : undefined,
      // 家具の上に立っている: 追う先は同じ階の床の近い空いた所（机の上の点へは歩行グラフでは行けない）
      playerFloor: this.isCity ? this._playerFloorSpot() : null,
      // 天気: 霧・雨で見つける距離と撃つ距離が短い（ソロの AI だけ。撃つ距離は weather.enemy.minAttackMul まで）
      //   時間帯（夜など）: さらに enemySight を掛ける（ソロの AI だけ。夕方は 1）
      visMul: (wp && !this.online ? wp.vis : 1) * (this.online ? 1 : this._todSight),
      attackMul: (wp && !this.online ? Math.max(wp.vis, this.weather.cfg.enemy.minAttackMul) : 1) * (this.online ? 1 : this._todSight),
      onEnemyShot: (enemy, damage) => this._onEnemyShot(damage, enemy),
      onEnemyMelee: (enemy, damage) => this._onEnemyMelee(enemy, damage),
      holdFire: !!(this.story && this.story.holdFire), // ストーリーの場面・会話の間は撃たない
      playerVehicle: !!this.vehicle // 乗り物の中の人には敵はナイフで来ない（撃つ）
    };
    if (this.cityBoats) this.cityBoats.enemyCtx(ctx, dt); // 水の上: 敵は岸の点を追う・ボートの撃つ距離・速いボートの間は出さない
    if (this.director) {
      // 街: 出し入れ・経路探索（予算つき）→ 敵の更新（時間を測る）
      ctx.director = this.director;
      ctx.camFwd = this.camera.getWorldDirection(this._camFwdE || (this._camFwdE = new THREE.Vector3()));
      const t0 = MR.EnemyDirector.now();
      this.director.update(dt, ctx);
      // director が今消した敵（despawnDist より遠い）は動かさない（遠くへ復活したフレームに、消える 8 体が 1.9 km 先のプレイヤーへの
      //  道を考えて 17 ms かかっていた）
      for (const e of this.enemies) if (!e.removed) e.update(ctx);
      const ms = MR.EnemyDirector.now() - t0, st = this.director.stats;
      st.frames++; st.updMs += (ms - st.updMs) * 0.05; if (ms > st.updMsMax) st.updMsMax = ms;
      st.lastMs = ms;
    } else {
      for (const e of this.enemies) e.update(ctx);
    }
    // 消えた敵: すぐ見えなくして一覧から外し、捨てる（マテリアル・骨のテクスチャ）のは 1 フレーム enemies.disposePerFrame 体まで
    //   （遠くへ復活すると離れた敵 7 体と片付けた敵が同じフレームに消え、1 体ずつ捨てるのが重なって 45〜90 ms のフレームになっていた）
    //   捨てるのは消えた次のフレームから（遠くへ復活したフレーム = director がまとめて消すフレームには捨てない）
    const trash = this._enemyTrash || (this._enemyTrash = []);
    if (trash.length) {
      let n = Math.max(1, this.config.enemies.disposePerFrame | 0);
      while (n-- > 0 && trash.length) trash.shift().dispose();
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.removed) continue;
      this.enemies.splice(i, 1);
      if (e.group && e.group.parent) e.group.parent.remove(e.group);
      trash.push(e);
    }

    // スポーン（オンラインは敵を出さない。街は director が出す）
    if (!this.online && !this.isCity) this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.config.enemies.spawnInterval;
      const alive = this.enemies.filter((e) => !e.dead).length;
      if (alive < this.config.enemies.maxAlive) this._spawnEnemy();
    }

    // オンライン: 送受信・他のプレイヤー
    if (this.online) this._updateOnline(dt);

    if (this.isCity) this._updateCity(dt);
    // 街の自由モード: 射出の後の降下・パラシュートの HUD（バトルロイヤルは royale.js が出す）
    if (this.isCity && !this.royale && !this.cityOnline && this.hud.root && this.hud.root.classList) {
      const fs = this.player.state === 'fall' ? 1 : (this.player.state === 'chute' ? 2 : 0);
      if (fs !== this._fallHud) { this._fallHud = fs; this.hud.root.classList.toggle('falling', fs === 1); this.hud.root.classList.toggle('chute', fs === 2); }
    }

    this.fx.update(dt, this.camera);
    if (this.destruct) this.destruct.update(dt); // 破片・歩行グラフの柱・近景の形（1 フレームに 1 チャンク）・はねた小物・直す
    if (this.puffs) this.puffs.update(dt, this.camera.getWorldPosition(this._puffCam || (this._puffCam = new THREE.Vector3()))); // 本当のカメラの位置（mainCamera は行列だけ写すので position は原点のまま）
    if (this.cityBoats) this.cityBoats.update(dt); // 航跡・しぶき・ボートの中に水面を描かない板・#hud.boat
    if (this.weatherView) this.weatherView.update(dt, wp); // 天気の見た目のシミュレーション（雲の流れ・知らせ・環境マップの強さ）
    if (typeof this.audio.setListener === 'function') this.audio.setListener(this.camera);
    // iOS で電話・Siri・画面ロックのあと AudioContext が止まったままなら、1 秒ごとに起こしてみる
    this._audioCheck = (this._audioCheck || 0) + dt;
    if (this._audioCheck > 1) { this._audioCheck = 0; if (typeof this.audio.resume === 'function') this.audio.resume(); }
  }

  // 足音（0.42 m ごと / 0.5 s ごと、地面に居て動いているとき）・ジャンプ・着地
  _updateFootsteps(dt, player) {
    if (typeof this.audio.footstep !== 'function') return;
    const acfg = this.config.audio || {};
    const mv = this.input.getMove();
    const walking = (mv.x !== 0 || mv.y !== 0) && player.grounded;
    const moved = Math.hypot(player.pos.x - this._lastStepPos.x, player.pos.z - this._lastStepPos.z);
    if (walking) {
      this._stepDist += moved;
      this._stepTime += dt;
      if (this._stepDist >= (acfg.footstepDistance || 0.42) || this._stepTime >= (acfg.footstepInterval || 0.5)) {
        this._stepDist = 0; this._stepTime = 0;
        this.audio.footstep(this.isCity ? this._citySurface() : (MR.Audio.footstepSurfaceAt ? MR.Audio.footstepSurfaceAt(this.level, player.pos.x, player.pos.z) : 'dirt'));
      }
    } else { this._stepDist = 0; this._stepTime = 0; }
    // 街のジャンプ・着地の音は player.events から（_cityPlayerEvents。落下の高さで音を変える）
    if (!this.isCity && this._wasGrounded && !player.grounded && this.audio.jump) this.audio.jump();
    if (!this.isCity && !this._wasGrounded && player.grounded && this.audio.land) this.audio.land();
    this._lastStepPos.copy(player.pos);
    this._wasGrounded = player.grounded;
  }

  // ---------- 射撃 ----------

  _resolveShots(dirs, def) {
    if (this.online) { this._resolveShotsOnline(dirs, def); return; }
    if (this.story) this.story.onPlayerFire(); // 近くの見張り（guard）が気づく
    const origin = this.player.eyePosition(this._tmpV1);
    const muzzle = this.weapon.muzzleWorldPosition(this._tmpV2);
    let anyHit = false, anyKill = false;
    let impactSound = false; // 散弾でも着弾音は 1 発分だけ
    const canImpact = typeof this.audio.impact === 'function';
    for (const dir of dirs) {
      let wall = this.world.nav.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range);
      if (this.cityBoats) wall = this.cityBoats.clipRay(origin, dir, wall, def.range); // 動く船の船体・船室で止まる
      const maxT = wall ? wall.t : def.range;
      let best = null;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const h = e.intersectRay(origin, dir, maxT);
        if (h && (best === null || h.t < best.t)) { best = h; best.enemy = e; }
      }
      // 乗り物（乗っているものは除く）。敵より手前なら乗り物に当たる
      let vhit = null;
      for (const v of this.vehicles) {
        if (v === this.vehicle) continue;
        const h = v.intersectRay(origin, dir, best ? best.t : maxT);
        if (h && (vhit === null || h.t < vhit.t)) { vhit = h; vhit.vehicle = v; }
      }
      let end;
      if (vhit && (!best || vhit.t < best.t)) {
        const v = vhit.vehicle;
        this.fx.impact(vhit.point, vhit.normal);
        if (!impactSound && canImpact) { this.audio.impact('metal', vhit.point); impactSound = true; }
        if (!v.wrecked) { v._selfT = this.time; v.hit(def.damage, vhit.point, this._vehicleCtx()); anyHit = true; }
        end = vhit.point;
      } else if (best) {
        const mult = best.head ? (this.config.enemies.headshotMultiplier || 2) : 1;
        const killed = best.enemy.takeDamage(def.damage * mult, dir);
        this.fx.hitFlesh(best.point, dir);
        if (!impactSound && canImpact) { this.audio.impact('flesh', best.point); impactSound = true; }
        anyHit = true;
        if (killed) { anyKill = true; this._onKill(best.enemy, 'shot'); }
        end = best.point;
      } else if (wall) {
        end = new THREE.Vector3(wall.x, wall.y, wall.z);
        this.fx.impact(end, new THREE.Vector3(wall.nx, wall.ny, wall.nz));
        if (this.destruct && wall.box && wall.box.cat) this.structHit({ x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz, radius: 0.5, damage: def.damage, edge: 0, kind: 'bullet', weapon: def.id, box: wall.box }); // 小物・外壁の升（destruct-2 R3）
        if (!impactSound && canImpact) {
          this.audio.impact(this._impactSurface(wall, end), end);
          impactSound = true;
        }
      } else {
        end = origin.clone().addScaledVector(dir, def.range);
      }
      this.fx.tracer(muzzle, end, false);
    }
    this.player.kick((def.recoil || 0.05) * 8);
    this.fovKick += def.id === 'shotgun' ? 2.5 : 0.8;
    if (anyHit) { this.hud.hit(anyKill); this.audio.hit(); }
  }

  // 敵のナイフが当たった（徒歩のときだけ。ベストが効く）
  _onEnemyMelee(enemy, damage) {
    if (this.vehicle || this.player.dead) return;
    this._lastAttacker = enemy;
    const p = this.player.chestPosition(this._tmpV3);
    this.fx.hitFlesh(p, this._tmpV1.set(this.player.pos.x - enemy.pos.x, 0, this.player.pos.z - enemy.pos.z).normalize());
    if (typeof this.audio.play === 'function') this.audio.play('knife_hit', { volume: MR.Melee.enemyCfg ? MR.Melee.enemyCfg.volHit : 0.9 });
    this._playerHit(damage, { kind: 'melee' });
  }

  // victim: 倒した敵（無ければ null）、how: 'shot' | 'gun' | 'explosion' | 'fire' | 'vehicle' | 'melee'（ストーリーの隊の数え方）
  _onKill(victim, how) {
    this.kills++;
    this.hud.setKills(this.kills);
    this.audio.kill();
    if (this.story && victim) this.story.onKill(victim, how);
  }
  // ストーリーの章の systems（無いキーは false = 出さない。ambient は数）
  _storySys(k) { const S = this.story && this.story.ch && this.story.ch.systems; return !!(S && S[k]); }

  // opts: { kind: 'bullet' | 'explosion' | 'fall' | 'zone' | 'fire'（地面の火。街の防具は bullet / explosion だけに効く）, head（頭）, quiet（音と揺れ無し: 安全地帯）}
  _playerHit(damage, opts) {
    if (opts && opts.by !== undefined) this._lastAttacker = opts.by;
    if (this.play) damage = this.play.absorb(damage, opts);
    this.lastHurt = (opts && opts.kind) || 'other';
    if (this.royale) this.royale.lastHurt = this.lastHurt;
    if (this.lift && damage > 0) this.lift.onHit(); // エレベーター: 最初の commit 秒なら中止
    if (this.story && damage > 0) this.story.onPlayerHit(damage, opts);
    const died = this.player.takeDamage(damage);
    this.hud.setHealth(this.player.health, this.config.player.maxHealth);
    this.hud.damage();
    if (!(opts && opts.quiet)) {
      this.audio.hurt();
      this.shake = Math.min(1.5, this.shake + 0.6);
    }
    if (died) this._onPlayerDied(this.config.player.respawnDelay || 3);
  }

  // 死んだ: 乗り物から降ろし、死亡画面、delay 秒後に復活（オンラインはその時点で respawn を送る）
  // パラシュート（脱出・降下）を閉じる。chute_land / land のほか、死んだ・復活・置き直しでも（以前は着地の出来事でしか閉じず、パラシュートの下で
  //   撃たれて死ぬ → 「復活」でキャノピーが頭の上に残った）。view: 銃と腕（脱出・降下で隠した viewRoot）も戻す
  _closeChute(view) {
    if (this.parachute && this.parachute.root.visible) this.parachute.close();
    if (view && this.viewRoot && !this.freeCam && !this.vehicle) this.viewRoot.visible = true;
  }

  _onPlayerDied(delay) {
    if (this.melee) this.melee.cancel();
    this._closeChute(false);
    if (this.vehicle) this._exitVehicle(true);
    if (this.input.setCrouch) this.input.setCrouch(false); // しゃがむの切り替えを戻す（復活したらしゃがんでいない）
    if (this.player.standUp) this.player.standUp();
    if (this.lift) this.lift.onDeath();
    if (this.play) this.play.onDeath();
    if (!this.online) this.hud.setDeathInfo(null, null, this.lastHurt === 'fire' ? '炎に巻かれた' : (this.lastHurt === 'collapse' ? '建物の下敷きになった' : '')); // 地面の火（E3.2）・倒壊（destruct-3 M3）
    this.hud.showDeath(!this.royale && !this.story);
    this.input.reset();
    this.respawnAt = this.time + delay;
    if (this.story) { this.respawnAt = Infinity; this.story.onPlayerDied(this._lastAttacker || null); } // ストーリー: 任務失敗（チェックポイントから）
    if (this.royale) { this.respawnAt = Infinity; this.royale.onPlayerDied(this.lastHurt === 'bullet' || this.lastHurt === 'melee' ? (this._lastAttacker || null) : null); }
    // ソロ（街：フリー・アリーナ）: 「復活する場所」を選ぶ画面。死んだ所（空中でも）を覚えて「近く」・地図の中心に使う
    const dp = this.deathPos || (this.deathPos = { x: 0, y: 0, z: 0 });
    dp.x = this.player.pos.x; dp.y = this.player.pos.y; dp.z = this.player.pos.z;
    this._deathUI = (this.respawnUI && !this.royale && !this.online && !MR.CONFIG.AUTO_RESPAWN) ? this.respawnUI : null;
    if (this._deathUI) this._deathUI.onDeath(dp);
    for (const w of this.weapons) w.cancelReload();
    if (typeof this.audio.death === 'function') this.audio.death();
    if (typeof this.audio.stop === 'function') this.audio.stop('music'); // 復活時に再開
  }

  // 復活。spot（{ x, y, z, yawDeg }。respawn.js が選んで確かめた場所）が無ければ今まで通り（街: ホットゾーンの通り / アリーナ: 開始地点）
  _respawnPlayer(spot, pre) {
    if (this.vehicle) this._exitVehicle();
    this._closeChute(true);
    if (this.waterFx) this.waterFx.lens = 0; // 別の場所に出る: レンズの水滴は持っていかない
    let free;
    if (this.isCity) {
      const sp = spot || pre || this._citySpawn();
      // v2 の街: その場のタイルがまだなら届くまで待つ（「もう一度」の新しい開始地点・続きからの場所。同じ sp で呼び直す）
      if (this._tileHold(sp.x, sp.z, () => this._respawnPlayer(spot, sp))) return;
      free = { x: sp.x, z: sp.z };
      // 復活のフレームは近景の組み立ての予算を半分（streamer._run）・予算の家具の仕事をしない（world.update）: 遠くへの復活のフレームが 40 ms を超えていた
      if (this.world.streamer) this.world.streamer.calm = 1;
      this.world.furnCalm = true;
      if (this.world.furn) this.world.furn.active = true; // 歩いて復活する（家具もこの置き直しで読む）
      this.world.loadNavNow(sp.x, sp.z, spot ? spot.y + 0.3 : null); // 置き直しは予算なしで全部すぐ（その場の当たり判定。高さが分かれば家具はその階の建物だけ）
      // _citySpawn は高さを持たない（通りの上 + 1 m まで）。spot は屋上・甲板の高さ + stepHint まで
      const hint = spot ? spot.y + ((this.config.respawn || {}).stepHint == null ? 0.3 : this.config.respawn.stepHint) : (sp.y || 0) + 1;
      const gy = this.world.nav.groundHeight(sp.x, sp.z, hint, 0.2);
      this.player.spawn(sp.x, sp.z, sp.yawDeg, gy == null ? (spot ? spot.y : 0) : gy);
      if (spot) {
        // placePlayer と同じ: カプセルを箱の外・床の上に落ち着かせる
        const p = this.player, r = this.world.nav.resolveCapsule(p.pos, p.radius, 1.8, 0.45, { snapDown: 0.45 });
        p.pos.set(r.x, r.y, r.z); this._furnPlace(p); p.peakY = p.pos.y; p._apply();
      }
    } else if (spot) {
      free = { x: spot.x, z: spot.z };
      this.player.spawn(spot.x, spot.z, spot.yawDeg);
    } else {
      const start = this.level.playerStart || [0, 0, 0];
      free = this.world.nav.nearestFree(start[0], start[1]);
      this.player.spawn(free.x, free.z, start[2] || 0);
    }
    this.hud.setHealth(this.player.health, this.config.player.maxHealth);
    this.hud.showDeath(false);
    if (this.play) this.play.onRespawn(); // 街: 開始の持ち物（ピストル）から
    // 足音・着地の状態をリセット（空中で死んだ直後の復活で着地音が鳴らないように）
    this._wasGrounded = true;
    this._stepDist = 0; this._stepTime = 0;
    if (this._lastStepPos) this._lastStepPos.copy(this.player.pos);
    if (this.running && !this._noMusic && typeof this.audio.music === 'function') this.audio.music((this.config.audio || {}).musicName || 'music_combat');
    // 近くの敵: 場所を選んだときは respawn.js が先に片付けている（見られていない所を先に選ぶ・消すのは maxCleared 体まで）
    if (!spot) {
      for (const e of this.enemies) {
        if (!e.dead && Math.hypot(e.pos.x - free.x, e.pos.z - free.z) < 10) e.takeDamage(99999, null);
      }
    }
    if (this._deathUI) { this._deathUI.close('respawned'); this._deathUI = null; }
  }

  // 建物の中の家具の設定（world に渡す）。city.interiors（オンラインは online.city.interiors）、?furn=0 / MR.CONFIG.FURN === false で切る、
  //   ?furn=1 / MR.CONFIG.FURN === true でいつも入れる（テスト）。当たり判定と描画は必ず一緒に入る・切れる
  _interiorsOpts() {
    const json = this.assets.get('config/interiors.json');
    if (!json || !MR.Interiors) return null;
    const q = (typeof location !== 'undefined' && location.search) || '';
    const force = /[?&]furn=1/.test(q) || MR.CONFIG.FURN === true;
    if (/[?&]furn=0/.test(q) || MR.CONFIG.FURN === false) return null;
    const on = this.online ? ((this.config.online || {}).city || {}).interiors === true : this.cityCfg.interiors !== false;
    if (!on && !force) return null;
    // 省メモリ: 描画の近くの部品・飾り・照明を減らす（当たり判定の家具はいつも全部描く）
    const sav = this.saver ? ((this.config.stability || {}).saver || {}).interiors : null;
    // look.js: 天井の板（shell）・照明の色と明るさ・室内の持ち上げ（render.look.interiors）
    const lv = this.lookCfg ? Object.assign({ shell: true }, this.lookCfg.interiors || {}) : null;
    const view = lv || sav ? Object.assign({}, lv || {}, sav || {}) : null;
    // look の無いとき（?look=0 など）は省メモリの look だけの値（アトラス・光の札・飾り）を使わない = 今まで通り
    if (view && !lv) for (const k of ['atlas', 'cards', 'maxShell', 'dressDist', 'glass', 'lightBake', 'foliage']) delete view[k];
    if (view && lv && this.rs && this.rs.textures === false) view.atlas = 0; // 軽くする設定では模様のアトラスを作らない（色だけ。省メモリより後で）
    return { json, player: this.config.player, levelId: this.levelId, view };
  }
  // 地下鉄の駅（nyc-complete NC6。stations.js の MR.Stations → MR.Underground）: v2 の街。opts.rail（テストの空洞など）が先、opts.rail === false・
  //   レベルの underground.enabled false で無し。ソロは ?under=0・MR.CONFIG.UNDER === false でも無し。
  //   オンライン（NC8）: game.json の online.city.stations（online.levels.<id>.city.stations が先。サーバーの CityWorld.stationsOn と同じ決まり）が
  //   false なら無し。サーバーも同じ駅を持つので、オンラインでは URL / MR.CONFIG では切らない（片方だけ駅があると穴・岩・駅の物が食い違う）
  _railOpts() {
    if (this.opts.rail === false) return null;
    if (this.opts.rail) return this.opts.rail;
    if (!MR.Stations) return null;
    if (this.online) {
      const on = this.config.online || {}, lv = ((on.levels || {})[this.levelId] || {}).city || {};
      const st = lv.stations != null ? lv.stations : (on.city || {}).stations;
      if (st === false) return null;
    } else {
      const q = (typeof location !== 'undefined' && location.search) || '';
      if (/[?&]under=0/.test(q) || MR.CONFIG.UNDER === false) return null;
    }
    return MR.Stations.underground(this.level);
  }
  // 地下（nyc-complete NC6 = rail-r4 §4.3）: 霧・描画距離（_updateCity の高さの表の後）と光・空（_render の天気の後）。数は game.json の rail.underground
  _underCfg() {
    return this._ucfg || (this._ucfg = Object.assign({ far: 160, fogNear: 18, fogFar: 120, fogColor: '#0d0f12', hemiMul: 0.85, hemiSky: '#d6dde2', hemiGround: '#9a968c', sunMul: 0, envMul: 0.35, hideSky: true }, ((this.config.rail || {}).underground) || {}));
  }
  // 地下の度合い _underK（0..1）: 空洞に入る / 出るときに blendSec 秒で変える（以前は階段の天井の下へ 1 歩入ったとたんに光・霧・描画距離が
  //   切り替わった）。置き直し（カメラが blendJump m より飛んだ）はすぐ。使うときは smoothstep（_underEase）
  _underBlend(dt, cam) {
    const c = this._underCfg(), on = !!this.world.underground, sec = c.blendSec || 0;
    const p = this._ubCam || (this._ubCam = { x: cam.x, y: cam.y, z: cam.z });
    const jump = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z) > (c.blendJump || 5);
    p.x = cam.x; p.y = cam.y; p.z = cam.z;
    let k = this._underK || 0;
    const t = on ? 1 : 0;
    if (jump || !(sec > 0)) k = t;
    else if (k < t) k = Math.min(t, k + dt / sec);
    else if (k > t) k = Math.max(t, k - dt / sec);
    this._underK = k;
  }
  _underEase() { const k = this._underK || 0; return k * k * (3 - 2 * k); }
  _underFog() {
    const c = this._underCfg(), fog = this.scene.fog, k = this._underEase();
    this._cityFar += (Math.min(this._cityFar, c.far) - this._cityFar) * k;
    if (fog) { fog.near += (c.fogNear - fog.near) * k; fog.far += (c.fogFar - fog.far) * k; }
  }
  // 口の視錐台（_render）: 隠した物の配列（描いた後に戻す）
  _portalCull() {
    const W = this.world, out = this._pcHid || (this._pcHid = []);
    out.length = 0;
    if (this._portalOff == null) this._portalOff = MR.CONFIG.PORTAL === false || /[?&]portal=0/.test((typeof location !== 'undefined' && location.search) || ''); // 見比べ用（?portal=0）
    if (this._portalOff) return out;
    const cam = this.camera.getWorldPosition(this._pcCam || (this._pcCam = new THREE.Vector3())), lv = W.surfaceLevel;
    if (!lv) return this._portalCullStreet(cam, out);
    let n = 0;
    if (lv === 1) { n = W.portalHide(cam, out); if (n < 0) return out; }
    // 地上の乗り物・敵（地面より上 = y > −1）: 深い所では全部、口の近くでは視錐台の外の物
    const s = this._pcS || (this._pcS = new THREE.Sphere());
    const test = (x, y, z, r) => { if (y < -1 || !(lv >= 2 || n > 0)) return false; if (lv >= 2) return true; s.center.set(x, y, z); s.radius = r; return !W.portalSeesSphere(s); };
    for (const v of this.vehicles) {
      const o = v.root;
      if (!o || !o.visible || v === this.vehicle) continue;
      if (test(v.pos.x, v.pos.y + 1.5, v.pos.z, v.kind === 'jet' ? 12 : v.kind === 'heli' ? 9 : 5)) { o.visible = false; out.push(o); }
    }
    for (const e of this.enemies) {
      const o = e.group;
      if (!o || !o.visible || e.removed) continue;
      if (test(e.pos.x, e.pos.y + 0.9, e.pos.z, 1.3)) { o.visible = false; out.push(o); }
    }
    // ほかのプレイヤー（オンライン）: 敵と同じ（体の球は名前の札まで）
    for (const r of this.remotes.values()) if (r.pos && test(r.pos.x, r.pos.y + 1.1, r.pos.z, 1.4)) this._pcHideRemote(r, out);
    return out;
  }
  _pcHideRemote(r, out) {
    if (r.group && r.group.visible) { r.group.visible = false; out.push(r.group); }
    if (r.tag && r.tag.visible) { r.tag.visible = false; out.push(r.tag); }
  }
  // 通りのカメラ（surfaceLevel 0）: 地面より下（体の球の上 = 名前の札まで地面の下）のほかのプレイヤーは、近くの口の視錐台に入らなければ描かない
  //   （地面と岩に隠れる。名前の札が地面の上に透けない・描画を減らす）
  _portalCullStreet(cam, out) {
    if (!this.remotes.size) return out;
    const W = this.world, C = W.city;
    let n = -2;
    const s = this._pcS || (this._pcS = new THREE.Sphere());
    for (const r of this.remotes.values()) {
      if (!r.pos || !((r.group && r.group.visible) || (r.tag && r.tag.visible))) continue;
      if (r.pos.y + 2.5 >= C.groundAt(r.pos.x, r.pos.z).y) continue;
      if (n === -2) n = W.portalSetupStreet(cam);
      if (n < 0) return out;
      s.center.set(r.pos.x, r.pos.y + 1.1, r.pos.z); s.radius = 1.4;
      if (n === 0 || !W.portalSeesSphere(s)) this._pcHideRemote(r, out);
    }
    return out;
  }
  // 空の球（dome / background）の半径を r m に（1 = 元の大きさ）
  _skyScale(r) {
    const sky = this.sky;
    for (const m of [sky.dome, sky.background]) {
      if (!m) continue;
      const R = (m.geometry && m.geometry.parameters && m.geometry.parameters.radius) || 600, k = r === 1 ? 1 : Math.min(1, r / R);
      if (m.scale.x !== k) m.scale.setScalar(k);
    }
  }
  // 地下の間の光と空（入ったときに今の値を覚え、出たら戻す。天気のあるゲームは天気が毎フレーム書き直すので戻さない）。
  //   地上の値と地下の値を _underK（smoothstep）で混ぜる（rail.underground.blendSec）
  _underLight() {
    const W = this.world, k0 = this._underK || 0, on = k0 > 0, sky = this.sky;
    if (!sky) return;
    const c = this._underCfg(), fog = this.scene.fog;
    if (on && !this._under) {
      this._under = { sunI: sky.sun.intensity, hemiI: sky.hemi.intensity, hs: sky.hemi.color.clone(), hg: sky.hemi.groundColor.clone(), fog: fog ? fog.color.clone() : null,
        dome: sky.dome.visible, bg: sky.background ? sky.background.visible : null };
      this._underCols = { s: MR.srgb(c.hemiSky), g: MR.srgb(c.hemiGround), f: MR.srgb(c.fogColor) };
      this._uEnv = 1;
    }
    if (on) {
      const b = this._under, U = this._underCols, k = this._underEase();
      sky.sun.intensity = (this.weatherView ? sky.sun.intensity : b.sunI) * (1 + (c.sunMul - 1) * k);
      sky.hemi.intensity = (this.weatherView ? sky.hemi.intensity : b.hemiI) * (1 + (c.hemiMul - 1) * k);
      if (!this.weatherView) { sky.hemi.color.copy(b.hs); sky.hemi.groundColor.copy(b.hg); if (fog && b.fog) fog.color.copy(b.fog); }
      sky.hemi.color.lerp(U.s, k); sky.hemi.groundColor.lerp(U.g, k);
      if (fog) fog.color.lerp(U.f, k);
      if (this.materials && this.materials.setEnvScale && !this.weatherView) {
        const e = 1 + (c.envMul - 1) * k;
        if (Math.abs(e - this._uEnv) > 0.005 || (k === 1 && this._uEnv !== e)) { this.materials.setEnvScale(e); this._uEnv = e; }
      }
      // 空は地上を全部隠している間（surfaceLevel 2）だけ隠す。口の近く（1）は階段の上に空が見える（隠すと口の上が黒い穴だった）。
      //   空の球（カメラが中心）は今の描画距離（地下は far、混ぜている間はその間）の内側へ縮める（見た目は同じ。far で切れると黒い）
      const hide = c.hideSky && W.underground && (W.surfaceLevel || 0) >= 2;
      sky.dome.visible = hide ? false : b.dome; if (sky.background && b.bg !== null) sky.background.visible = hide ? false : b.bg;
      this._skyScale(hide ? 1 : Math.max(10, (this._cityFar || c.far) * 0.9));
    } else if (this._under) {
      const b = this._under;
      if (!this.weatherView) {
        sky.sun.intensity = b.sunI; sky.hemi.intensity = b.hemiI; sky.hemi.color.copy(b.hs); sky.hemi.groundColor.copy(b.hg);
        if (fog && b.fog) fog.color.copy(b.fog);
        if (this.materials && this.materials.setEnvScale) this.materials.setEnvScale(1);
      }
      sky.dome.visible = b.dome; if (sky.background && b.bg !== null) sky.background.visible = b.bg;
      this._skyScale(1);
      this._under = null;
    }
  }
  // 入口の自動ドア（doors.js。見た目だけ = 当たり判定なし）: city.doors（オンラインは online.city.doors も false でなければ）、?doors=0|1・MR.CONFIG.DOORS
  _doorsOpts() {
    if (!MR.Doors || !MR.Interiors || !this.assets.get('config/interiors.json')) return null;
    const q = (typeof location !== 'undefined' && location.search) || '';
    if (/[?&]doors=0/.test(q) || MR.CONFIG.DOORS === false) return null;
    const c = this.cityCfg.doors || {};
    const on = (c.enabled !== false) && (!this.online || ((this.config.online || {}).city || {}).doors !== false);
    if (!on && !/[?&]doors=1/.test(q) && MR.CONFIG.DOORS !== true) return null;
    return Object.assign({}, c, { levelId: this.levelId, json: this.assets.get('config/interiors.json'), view: (this.cityRender || {}).doors || null });
  }
  // 自動ドアの音（開き始め・閉じ始め。soundDist m より遠ければ鳴らさない）
  _doorSound(type, d, opening) {
    const c = (this.world.doors && this.world.doors.cfg) || {};
    const P = this.player;
    if (Math.hypot(d.x - P.pos.x, d.z - P.pos.z) > (c.soundDist || 30) || !this.audio.play) return;
    this._tmpDoor = this._tmpDoor || new THREE.Vector3();
    this.audio.play(type === 'slide' ? 'door_slide' : 'door_swing', { pos: this._tmpDoor.set(d.x, d.y + 1.2, d.z), volume: (c.volume == null ? 0.5 : c.volume) * (opening ? 1 : 0.8), rate: opening ? 1 : 0.92, priority: 0.6 });
  }
  // しゃがむ（徒歩・ソロ。オンラインはサーバーとほかの人には立った体のままなので出さない = player.crouch: false でも消える）
  _crouchOk() { return !this.online && (this.config.player || {}).crouch !== false; }
  _crouchInput(player) {
    const ok = this._crouchOk() && !player.dead && (!player.mode3d || player.state === 'walk');
    if (!ok && this.input.crouchWanted) this.input.setCrouch(false); // 梯子・泳ぐ・死ぬ: 切り替えも戻す（出てきたらまた押す）
    player.wantCrouch = ok && this.input.crouchWanted;
  }
  // 家具の箱の中に足がある（置き直し・復活・続きから）: 同じ建物・同じ階の空いた所へ（押し出しで壁を越えない）
  _furnPlace(p) {
    const W = this.world;
    if (!W || !W.furn) return false;
    const s = W.furnSafeSpot(p.pos.x, p.pos.y, p.pos.z, p.radius);
    if (!s) return false;
    p.pos.set(s.x, s.y, s.z);
    const r = W.nav.resolveCapsule(p.pos, p.radius, 1.8, 0.45, { snapDown: 0.45 });
    p.pos.set(r.x, r.y, r.z); p.peakY = p.pos.y; p.vel.x = 0; p.vel.z = 0; p._apply();
    return true;
  }
  // プレイヤーが家具の上（足元の箱が cat 'furn'）なら同じ建物・同じ階の床の空いた所（0.5 秒ごと）。ほかは null
  _playerFloorSpot() {
    const W = this.world, p = this.player;
    if (!W.furn || p.dead || this.vehicle || !p.grounded) { this._pfs = null; this._pfsBox = null; return null; }
    const gi = W.nav.groundInfo(p.pos.x, p.pos.z, p.pos.y + 0.05, 0.2);
    if (!gi.box || gi.box.cat !== 'furn') { this._pfs = null; this._pfsBox = null; return null; }
    // 同じ家具の上で 0.5 m 以上動いていなければ前の答え（空いた所を探すのは家具の上に乗ったとき・動いたときだけ）
    //   見つからなかった（null）ときも覚える（以前は毎フレーム探し直していた）
    if (this._pfsBox === gi.box && this._pfsAt && Math.hypot(p.pos.x - this._pfsAt.x, p.pos.z - this._pfsAt.z) < 0.5) return this._pfs;
    this._pfsBox = gi.box; this._pfsAt = { x: p.pos.x, z: p.pos.z };
    this._pfs = W.furn.floorNear(p.pos.x, p.pos.y, p.pos.z);
    return this._pfs;
  }
  // 家具のチャンクが当たり判定に入った: 箱の中に入った敵（とプレイヤー）を同じ階の空いた所へ
  _onFurnAdded(key, res) {
    const W = this.world;
    for (const e of this.enemies) {
      if (e.dead || !e.pos) continue;
      const s = W.furnSafeSpot(e.pos.x, e.pos.y, e.pos.z, 0.35);
      if (!s) continue;
      e.pos.x = s.x; e.pos.y = s.y; e.pos.z = s.z;
      e.path = null; e.repathAt = 0;
      W.furnStats = (W.furnStats || 0) + 1;
    }
    const p = this.player;
    if (p && !p.dead && p.state === 'walk' && !this.vehicle) this._furnPlace(p);
    // 家具が無い間に落とした物（ヘリから倒した敵の武器など）が家具の箱の中に入った: 同じ階の空いた所へ落とし直す（ソロ。
    //   オンラインの落とし物はサーバーの物で、拾う位置を変えるのは M3）
    const L = !this.online && this.play && this.play.loot;
    if (L && L.drops) {
      for (const it of Array.from(L.drops.values())) {
        if (it.gone || it.map) continue;
        const s = W.furnSafeSpot(it.x, it.y, it.z, 0.3);
        if (!s) continue;
        L._removeDrop(it.id);
        L.drop({ type: it.type, qty: it.qty, ammo: it.ammo, dur: it.dur, yaw: it.yaw }, { x: s.x, y: s.y, z: s.z });
        W.furnStats = (W.furnStats || 0) + 1;
      }
    }
  }

  // 街: (x, z) の周りの当たり判定のチャンクを読む（respawn.js が復活の前に足元を用意する）
  //   ops 無し: 今すぐ全部（= world.loadNavNow: 先の位置と予算を消してから）。ops あり: 先読み = navLead にして 1/60 秒あたり ops 個の仕事
  //   （world.update が進める。_updateCity が歩きの予算を入れた後に呼ぶので、そのフレームはこちらが勝つ）
  _loadNavAt(x, z, ops, dt) {
    const W = this.world;
    if (ops == null) { W.loadNavNow(x, z); return; } // 先の位置・予算（歩きの ms の上限も）を消して今すぐ全部
    W.navLead = { x, z };
    W.navBudget = Math.max(1, Math.round(ops * Math.min(3, Math.max(1, (dt || 0) * 60))));
    W.navMsCap = null; // 先読みは数の予算だけ（_updateCity の歩きの ms の上限を上書き）
  }

  // ---------- 街 ----------

  // 開始地点: ホットゾーンの道の上（citygen の spawnPoints('solo', seed)）。ゾーンの中心（ランドマーク）の方を向く
  _citySpawn() {
    let seed = this.opts.spawnSeed;
    if (seed == null) {
      const m = /[?&]spawn=(\d+)/.exec((typeof location !== 'undefined' && location.search) || '');
      seed = m ? Number(m[1]) : Math.floor(Math.random() * 1e6);
    }
    this.spawnSeed = seed;
    // v2 の街は MR.NycTiles.soloSpawn と同じ（main.js がその周りのタイルを先に読んでいる）
    const sp = this.city.version === 2 && MR.NycTiles ? MR.NycTiles.soloSpawn(this.city, seed) : (this.city.spawnPoints('solo', seed)[0] || { x: 0, y: 0, z: 30, zone: '' });
    const zone = (this.city.hotZones || []).find((h) => h.id === sp.zone);
    const tx = zone ? zone.x : sp.x, tz = zone ? zone.z : sp.z - 10;
    const yawDeg = THREE.MathUtils.radToDeg(Math.atan2(-(tx - sp.x), -(tz - sp.z)));
    return { x: sp.x, z: sp.z, yawDeg, zone: sp.zone };
  }

  // 自動テスト・スクリーンショット用: カメラ（目の位置）を自由に置く（重力・当たり判定なし）。null で元に戻す
  //   c.weapon === false（または地面から 30 m より上）なら銃を隠す
  //   街で戻すときは、カメラの真下の立てる面（無ければ水面・近くの空き）に足を置く
  setFreeCam(c) {
    this.freeCam = c ? { x: c.x, y: c.y, z: c.z, yaw: c.yaw || 0, pitch: c.pitch || 0 } : null;
    const hide = !!c && (c.weapon === false || (c.weapon !== true && c.y > 30));
    if (this.viewRoot) this.viewRoot.visible = !hide;
    if (!c) {
      if (this.isCity) { const p = this.player; this.placePlayer(p.pos.x, p.pos.z, p.pos.y + 0.3, THREE.MathUtils.radToDeg(p.yawAngle)); return; }
      this.player.pos.y = 0; this.player.vy = 0; this.player.grounded = true; this.player._apply(); return;
    }
    this._updateFreeCam();
  }

  // 街: プレイヤーを (x, z) の、高さ yHint 以下で一番高い立てる面に置く（無ければ水面に浮かべる / 近くの空き）。テスト・撮影・自由カメラの戻り
  placePlayer(x, z, yHint, yawDeg) {
    const p = this.player, nav = this.world.nav;
    // v2 の街: その場のタイルがまだなら、届くまで待ってから置く（_tileHoldTick。待つ間は動かさない・「街のデータを読み込み中」）
    if (this._tileHold(x, z, () => this.placePlayer(x, z, yHint, yawDeg))) return;
    if (this.cityBoats) this.cityBoats.clearRide(); // 動く甲板から外す（速さは足さない）
    this._closeChute(true); // 置き直す = 歩いて立つ（降下・脱出の途中でも）
    if (this.isCity && this.world.furn && !this.vehicle) this.world.furn.active = true; // 歩いて置かれる: 家具もこの置き直しで読む（前のフレームの乗り物の値を使わない）
    if (this.isCity) this.world.loadNavNow(x, z, yHint == null ? 1 : yHint); // 置き直しは予算なしで全部すぐ（先の位置・歩きの予算を消して。家具はその階だけ）
    let y = nav.groundHeight(x, z, yHint == null ? 1 : yHint, 0.2);
    const hp = p.health, dead = p.dead, pitch = p.pitchAngle;
    p.spawn(x, z, yawDeg == null ? THREE.MathUtils.radToDeg(p.yawAngle) : yawDeg, y == null ? 0 : y);
    p.health = hp; p.dead = dead; p.pitchAngle = pitch;
    if (y === null && this.isCity) {
      const w = nav.waterLevelAt(x, z);
      if (w !== null) { p.pos.y = w + p._c3().swimEyeAbove - p.eyeHeight; p.state = 'swim'; p.grounded = false; }
      else { const f = nav.nearestFree(x, z, 8); p.pos.set(f.x, 0, f.z); }
    }
    if (p.state === 'walk') { const r = nav.resolveCapsule(p.pos, p.radius, 1.8, 0.45, { snapDown: 0.45 }); p.pos.set(r.x, r.y, r.z); }
    if (this.isCity && p.state === 'walk') this._furnPlace(p);
    p.peakY = p.pos.y;
    p._apply();
    this._wasGrounded = true;
    this._stepDist = 0; this._stepTime = 0;
    if (this._lastStepPos) this._lastStepPos.copy(p.pos);
  }

  // 街: プレイヤーの出来事（着地・水・梯子）→ 音・落下ダメージ・揺れ
  _cityPlayerEvents() {
    const p = this.player, ev = p.events;
    if (!ev.length) return;
    const a = this.audio;
    for (const e of ev) {
      if (this.play) this.play.onPlayerEvent(e);
      switch (e.t) {
        case 'land': this._onLand(e); break;
        case 'chute': {
          // パラシュートが開いた（音の膨らむ所 0.62 s に合わせて大きくなる）
          if (!this.parachute && MR.Parachute) this.parachute = new MR.Parachute(p.yaw);
          if (this.parachute) this.parachute.open(e.openTime);
          if (a.play) a.play('parachute_open', { priority: 3 });
          this.shake = Math.min(1.5, this.shake + 0.5);
          break;
        }
        case 'chute_land':
          if (this.parachute) this.parachute.close();
          if (this.viewRoot && !this.freeCam) this.viewRoot.visible = true;
          break;
        case 'jump': case 'vault': if (a.jump) a.jump(); break;
        case 'splash': {
          if (e.vy < -3 && a.splash) a.splash(null, false); else if (a.swimStroke) a.swimStroke();
          this.shake = Math.min(1.5, this.shake + Math.min(0.6, -e.vy * 0.04));
          const w = this.world.nav.waterLevelAt(p.pos.x, p.pos.z, p.pos.y);
          if (w !== null && this.fx.splash) this.fx.splash(this._tmpV3.set(p.pos.x, w + 0.05, p.pos.z), Math.min(2, 0.6 + -e.vy * 0.08), 'body');
          break;
        }
        case 'stroke': {
          if (a.swimStroke) a.swimStroke();
          // 目の前（少し下）の水面に小さなしぶき（画面の下に見える）
          const w = this.world.nav.waterLevelAt(p.pos.x, p.pos.z, p.pos.y);
          if (w !== null && this.fx.splash) this.fx.splash(this._tmpV3.set(p.pos.x - Math.sin(p.yawAngle) * 0.9, w + 0.02, p.pos.z - Math.cos(p.yawAngle) * 0.9), 0.35, 'swim');
          break;
        }
        case 'ladder_step': if (a.ladderStep) a.ladderStep(); break;
        case 'ladder': if (e.on && a.ladderStep) a.ladderStep(); break;
        case 'climb_out': if (a.land) a.land(); break;
        default: break;
      }
    }
    ev.length = 0;
  }

  // 着地: 落差が fallDamage.minHeight を超えたら perMeter × 超えた m + curve × 超えた m²（config.player.fallDamage）
  _onLand(e) {
    if (this.parachute && this.parachute.root.visible) this.parachute.close();
    const fd = Object.assign({ minHeight: 6, perMeter: 5, curve: 0.4 }, (this.config.player || {}).fallDamage || {});
    const over = e.drop - fd.minHeight;
    if (over > 0) {
      const dmg = fd.perMeter * over + fd.curve * over * over;
      this.lastFall = { drop: e.drop, damage: dmg, time: this.time };
      if (this.audio.landHard) this.audio.landHard();
      this.shake = Math.min(2, this.shake + 0.5 + Math.min(1, over * 0.08));
      // オンライン: 落下ダメージはサーバーが state の流れから計算して damage（kind fall）で送る
      if (!this.online) this._playerHit(dmg, { kind: 'fall' });
    } else if ((e.drop > 1.2 || e.vy < -6) && this.audio.land) this.audio.land();
  }

  // 足元の面の材質 → 足音（木の床・金属（非常階段・橋・甲板）・それ以外はコンクリート）
  // 着弾音の面: 家具（cat 'furn'）の金属・ガラスは金属、ほかは今まで通り
  _impactSurface(hit, end) {
    const fb = hit && hit.box && hit.box.cat === 'furn' ? String(hit.box.mat || '') : '';
    if (/metal|glass/.test(fb)) return 'metal';
    return MR.Audio.impactSurfaceAt ? MR.Audio.impactSurfaceAt(this.world.nav, end) : 'concrete';
  }
  _citySurface() {
    const p = this.player;
    const g = (this.cityBoats ? this.cityBoats.surfaceNav() : this.world.nav).groundInfo(p.pos.x, p.pos.z, p.pos.y + 0.05, 0.2);
    const b = g && g.box;
    if (!b) return 'concrete';
    const m = String((b.cat === 'roof' && b.mt) || b.mat || '');
    if (/wood|crate|plank|boardwalk|laminate/.test(m)) return 'wood'; // 家具の天板（furn_wood / furn_laminate）も木
    if (m === 'furn_fabric') return 'dirt'; // 布張り（ソファ・ベッド・ブース）はやわらかい音
    if (/metal|steel|grat|carrier|hull|iron|truss|rail/.test(m)) return 'metal';
    if (/grass|dirt|soil|gravel/.test(m)) return 'dirt';
    return 'concrete';
  }
  _updateFreeCam() {
    const f = this.freeCam, p = this.player;
    p.pos.set(f.x, f.y - p.eyeHeight, f.z);
    p.yawAngle = f.yaw; p.pitchAngle = f.pitch; p.recoilPitch = 0; p.vy = 0; p.grounded = true; p.bobTime = 0;
    p._apply();
  }

  // v2 の街（タイル）: (x, z) の周り 3 × 3 チャンクのタイルがまだなら、頼んで then を覚えておき true（呼ぶ側はそこで止める）。
  //   毎フレームの _tileHoldTick が届いたのを見て then を呼ぶ（置き直し）。タイルを使わない街（midtown）はいつも false
  _tileHold(x, z, then) {
    const city = this.city;
    if (!this.isCity || !city || city.version !== 2 || !city.tiles || typeof city.request !== 'function') return false;
    if (this._tileReady3(x, z)) { this._placeHold = null; return false; }
    const first = !this._placeHold;
    this._placeHold = { x, z, then, t: 0 };
    const p = this.player;
    p.pos.set(x, p.pos.y, z); p.vy = 0; p.vel.x = 0; p.vel.z = 0; p._apply();
    if (first && this.hud) this.hud.showMessage('街のデータを読み込み中…', 60000);
    return true;
  }
  _tileReady3(x, z) {
    const city = this.city, c = city.chunkOf(x, z);
    let ok = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = c.cx + dx, cz = c.cz + dz;
      if (cx < 0 || cz < 0 || cx >= city.ncx || cz >= city.ncz) continue;
      if (!city.request(cx, cz, 1e6)) ok = false; // 頼む（いちばん先に）
    }
    return ok;
  }
  // 毎フレーム: 待っている置き直しのタイルが届いたら置く（待つ間はプレイヤーを止めておく）
  _tileHoldTick(dt) {
    const h = this._placeHold;
    if (!h) return;
    h.t += dt;
    const p = this.player;
    p.pos.x = h.x; p.pos.z = h.z; p.vy = 0; p.vel.x = 0; p.vel.z = 0; p._apply();
    if (!this._tileReady3(h.x, h.z)) return;
    this._placeHold = null;
    if (this.hud) this.hud.showMessage('', 1);
    h.then();
    // オンライン: 置いた位置から移動の予算を数え直す（待っている間は state を送っていない。サーバーは spawn の位置で待っている）
    if (this.online && this._lastNetPos) { this._lastNetPos.copy(this.player.pos); this._netSpeed = 0; this._netResetMove(); }
  }

  // v2 の街: タイルの先読み（render.city.tilePrefetchRadius 枚の周り + 飛んでいる・落ちているときは速度 × tileFlightLead 秒先の周り）と、
  //   組み立てに使わなかったフレームの残りでタイルのデコード（tiles.pump。1 フレームに 1 つまで）。0.25 秒ごとに先読み
  _updateTiles(dt) {
    const tiles = this.city && this.city.tiles;
    if (!tiles || this.city.version !== 2 || tiles.sync) return;
    const rc = this.cityRender;
    this._tilePf = (this._tilePf || 0) - dt;
    if (this._tilePf <= 0) {
      this._tilePf = 0.25;
      const v = this.vehicle, P = this.player;
      const air = (v && Game.isAirKind(v.kind) && !v.grounded) || P.falling || P.state === 'fall' || P.state === 'chute' || (this.royale && this.royale.riding);
      const vel = v ? v.vel : P.vel, lead = air && vel ? (rc.tileFlightLead == null ? 2 : rc.tileFlightLead) : 0;
      const src = v ? v.pos : P.pos;
      tiles.prefetchAround(src.x, src.z, rc.tilePrefetchRadius == null ? 1 : rc.tilePrefetchRadius, vel ? vel.x * lead : 0, vel ? vel.z * lead : 0);
    }
    const st = this.world.streamer ? this.world.streamer.stats : null;
    const left = rc.buildMsPerFrame - (st ? st.buildMs : 0);
    if (left > 0 || this._placeHold) tiles.pump(this._placeHold ? Infinity : left);
  }

  // 毎フレーム（街）: 当たり判定のチャンク・リング・小物・水、高さに合わせた霧と描画距離
  _updateCity(dt) {
    const cam = this.camera.getWorldPosition(this._camWorldC || (this._camWorldC = new THREE.Vector3()));
    const fwd = this.camera.getWorldDirection(this._camFwdC || (this._camFwdC = new THREE.Vector3()));
    // 運転中は 2 秒先の当たり判定も読む（速く走っても前の箱・高架がある）。ヘリは速度の向き、1 フレームに読む数を絞る
    const v = this.vehicle;
    if (v && Game.isAirKind(v.kind)) {
      // 戦闘機は 1.5 秒先、ただし navLeadMax m まで、地面から navLeadAgl m より上では読まない（建物は HeliCollider が掃引で見るので、
      //  先のリングは地上・低空の小物のためだけ。遠い先のリングを pin するとモバイルの小さなキャッシュで先読みと取り合いになる）
      if (v.kind === 'jet') {
        const sp = Math.hypot(v.vel.x, v.vel.z), dmax = v.def.navLeadMax == null ? 300 : v.def.navLeadMax;
        const t = sp > 1 ? Math.min(1.5, dmax / sp) : 0;
        this.world.navLead = v.mode === 'air' && v.agl > (v.def.navLeadAgl == null ? 400 : v.def.navLeadAgl) ? null : { x: v.pos.x + v.vel.x * t, z: v.pos.z + v.vel.z * t };
      } else if (v.kind === 'vtol') {
        // VTOL: 2 秒先、ただし navLeadMax m まで、地面から navLeadAgl m より上では読まない（建物は HeliCollider が掃引で見る）
        const sp = Math.hypot(v.vel.x, v.vel.z), dmax = v.def.navLeadMax == null ? 300 : v.def.navLeadMax;
        const t = sp > 1 ? Math.min(2, dmax / sp) : 0;
        this.world.navLead = !v.grounded && v.agl > (v.def.navLeadAgl == null ? 400 : v.def.navLeadAgl) ? null : { x: v.pos.x + v.vel.x * t, z: v.pos.z + v.vel.z * t };
      } else this.world.navLead = { x: v.pos.x + v.vel.x * 2, z: v.pos.z + v.vel.z * 2 };
      //  仕事の数は 1/60 秒あたり（20 fps のフレームでは 3 倍まで）: 1 フレームあたりだと遅い端末ほど実時間で読むのが遅れ、低く飛ぶ戦闘機の前の
      //  地上の車が近くなってから出ていた（SMOKE_FPS=20 の 11e / 13e で機銃を撃てる間にジープが出たり出なかったり）
      this.world.navBudget = Math.max(1, Math.round((v.def.navOpsPerFrame || 1) * Math.min(3, Math.max(1, dt * 60))));
      this.world.navMsCap = null;
    } else if (this.player.falling || (this.royale && this.royale.riding) || (this.cityOnline && this.cityOnline.riding)) {
      // 降下中・輸送ヘリ: 真下（と 2 秒先）を少しずつ読む
      const P = this.player;
      this.world.navLead = { x: P.pos.x + P.vel.x * 2, z: P.pos.z + P.vel.z * 2 };
      this.world.navBudget = Math.max(1, Math.round(Math.min(3, Math.max(1, dt * 60))));
      this.world.navMsCap = null;
    } else {
      // 歩き・車も少しずつ（render.city.navOpsWalk 個 / 1/60 秒、1 フレーム navMsWalk ms まで。立っているチャンクはいつもすぐ）。
      //  以前は全部すぐで、チャンクをまたぐたびに chunkFull + 当たり判定への追加が 1 フレームに重なり 20〜80 ms 止まっていた。
      //  navOpsWalk 0 で以前と同じ（全部すぐ）
      this.world.navLead = v ? { x: v.pos.x + Math.sin(v.yaw) * v.speed * 2, z: v.pos.z + Math.cos(v.yaw) * v.speed * 2 } : null;
      const wo = this.world.cfg.navOpsWalk;
      this.world.navBudget = wo > 0 ? Math.max(1, Math.round(wo * Math.min(3, Math.max(1, dt * 60)))) : null;
      this.world.navMsCap = wo > 0 ? this.world.cfg.navMsWalk : null;
    }
    // 家具: 歩き・地上の乗り物のときだけ（ヘリ・戦闘機・輸送ヘリ・降下・パラシュートでは外す。当たり判定と描画は一緒）。
    //   死んでいる間・観戦中は外さない（以前は外していて、死亡画面・観戦の画面から家具が消え、観戦している人が何も無い部屋で机の高さに浮いていた）
    if (this.world.furn) {
      const P = this.player;
      this.world.furn.active = !(v && Game.isAirKind(v.kind)) && !P.falling && !(this.royale && this.royale.riding) && !(this.cityOnline && this.cityOnline.riding);
      this.world.furnVel = v ? v.vel : P.vel;
    }
    // 自動ドア: 開ける人（プレイヤー・生きている敵・ほかのプレイヤー）。配列は使い回す
    if (this.world.doors) {
      const P = this.player, A = this._doorAgents || (this._doorAgents = []);
      let n = 0;
      const put = (x, y, z, vx, vz) => { const o = A[n] || (A[n] = { x: 0, y: 0, z: 0, vx: 0, vz: 0 }); o.x = x; o.y = y; o.z = z; o.vx = vx || 0; o.vz = vz || 0; n++; };
      // 車は vel が無い（速さ speed と向き yaw）
      const vvx = v ? (v.vel ? v.vel.x : Math.sin(v.yaw || 0) * (v.speed || 0)) : P.vel.x, vvz = v ? (v.vel ? v.vel.z : Math.cos(v.yaw || 0) * (v.speed || 0)) : P.vel.z;
      if (!P.dead && !(v && Game.isAirKind(v.kind))) put(P.pos.x, P.pos.y, P.pos.z, vvx, vvz);
      // 敵の速さは前のフレームの位置から（扉の lead 秒先を見る）
      const idt = dt > 1e-4 ? 1 / dt : 0;
      for (const e of this.enemies) {
        if (e.dead || e.removed || !e.pos) continue;
        const vx = e._dpx != null ? (e.pos.x - e._dpx) * idt : 0, vz = e._dpz != null ? (e.pos.z - e._dpz) * idt : 0;
        e._dpx = e.pos.x; e._dpz = e.pos.z;
        put(e.pos.x, e.pos.y, e.pos.z, Math.abs(vx) < 15 ? vx : 0, Math.abs(vz) < 15 ? vz : 0);
      }
      for (const r of this.remotes.values()) if (!r.away && r.pos) put(r.pos.x, r.pos.y, r.pos.z, 0, 0);
      A.length = n;
      this.world.doorAgents = A;
      if (!this.world.doors.onSound) this.world.doors.onSound = (type, d, opening) => this._doorSound(type, d, opening);
    }
    // 死んでいる間: 選んだ復活の場所の周りを少しずつ先読み（respawn.js の lead。死んだ所の周りはそのまま）
    const rl = this._deathUI && this._deathUI.lead;
    if (rl) this._loadNavAt(rl.x, rl.z, this._deathUI.navOps, dt);
    // 同じ所の立っているチャンクの近景も先に作っておく（streamer の lead。復活のフレームで近景を予算 3 倍で作らない）
    if (this.world.streamer) this.world.streamer.lead = rl || null;
    if (rl && this.play && this.play.prepareAt) this.play.prepareAt(rl.x, rl.z); // ミニマップのタイル・落ちている物のチャンクも 1 フレームに 1 つ
    this.world.update(dt, cam, this.player.pos, this.time, fwd);
    if (this.look) this.look.update(dt); // 室内の度合い k（world.update が決めた furnView.insideNow から）
    if (this.city.version === 2) { this._updateTiles(dt); this._tileHoldTick(dt); }
    if (this.play) this.play.update(dt);
    if (this.royale) this.royale.update(dt);
    if (this.story) this.story.update(dt);
    if (this.cityOnline) this.cityOnline.update(dt);
    if (this.parachute) this.parachute.update(dt);
    if (!this.online && this.cityCfg.vehicles && MR.Vehicle && this.rs.vehicles !== false) this._updateCityVehicles(dt);
    if (this.waterFx) { this.waterFx.self = this.vehicle || null; this.waterFx.update(dt, this.camera, this.vehicles); }
    if (this.timesSquare) this.timesSquare.update(dt, this.camera);
    // レンズの水滴は gradePass があるときだけ（無ければ何もしない）
    if (this.gradePass && this.gradePass.uniforms.uLens) { const u = this.gradePass.uniforms; u.uLens.value = (this.waterFx && this.waterFx.lens) || 0; u.uLensT.value = this.time; }
    if (this.world.water && this.sky.background && this.sky.background.material && this.sky.background.material.map) this.world.water.setSkyTexture(this.sky.background.material.map);
    // 高さ（地面からではなくカメラの y）で near / far / 霧を補間
    const tab = this.cityRender.altitude, y = Math.max(0, cam.y);
    let a = tab[0], b = tab[tab.length - 1], t = 0;
    for (let i = 0; i < tab.length - 1; i++) if (y >= tab[i].y && y <= tab[i + 1].y) { a = tab[i]; b = tab[i + 1]; t = (y - a.y) / (b.y - a.y); break; }
    if (y > tab[tab.length - 1].y) { a = b; t = 0; }
    const L = (k) => a[k] + (b[k] - a[k]) * t;
    this._cityNear = L('near'); this._cityFar = L('far');
    // 歩いている（梯子・泳ぎ・乗り越え・跳んでいる間も）ときの near は最後に立っていた床からの高さで（屋上 274 m のパラペット・
    //   エンパイアのテラスが切れない。skyhigh.md §6）。far と霧はカメラの高さのまま（遠くまで見える）
    const pl = this.player;
    if (!this.vehicle && !this.freeCam && !pl.dead && !(this.royale && this.royale.riding) && pl.state !== 'fall' && pl.state !== 'chute') {
      if (pl.grounded || pl.state !== 'walk' || this._nearFootY == null) this._nearFootY = pl.pos.y;
      const ny = Math.max(0, cam.y - this._nearFootY);
      let na = tab[0], nb = tab[tab.length - 1], nt = 0;
      for (let i = 0; i < tab.length - 1; i++) if (ny >= tab[i].y && ny <= tab[i + 1].y) { na = tab[i]; nb = tab[i + 1]; nt = (ny - na.y) / (nb.y - na.y); break; }
      if (ny > tab[tab.length - 1].y) { na = nb; nt = 0; }
      this._cityNear = Math.min(this._cityNear, na.near + (nb.near - na.near) * nt);
    } else this._nearFootY = null;
    if (this.scene.fog) { this.scene.fog.near = L('fogNear'); this.scene.fog.far = L('fogFar'); }
    if (this.weather) this._weatherFog();
    this._underBlend(dt, cam);
    if (this._underK > 0) this._underFog(); // 地下（NC6）
    this._cityAudioTimer = (this._cityAudioTimer || 0) - dt;
    if (this._cityAudioTimer <= 0) { this._cityAudioTimer = 0.25; this._updateCityAudio(cam); }
  }

  // 街の音（4 Hz）: 室内（頭の上 indoorCeiling m 以内に天井）なら環境音を下げる・高い所の風（wind_high）・
  // 近くの岸の水音（water_lap を一番近い岸の点に置いた 3D のループ。waterLapRange m 以内だけ）
  _updateCityAudio(cam) {
    const a = this.audio, p = this.player, nav = this.world.nav, city = this.city;
    const ac = Object.assign({ indoorCeiling: 25, indoorAmbience: 0.4, windFrom: 30, windFull: 140, waterLapRange: 40 }, this.cityCfg.audio || {});
    const eyeY = cam.y;
    const ceil = this.freeCam ? Infinity : nav.ceilingHeight(cam.x, cam.z, eyeY, 0);
    const indoors = ceil - eyeY < ac.indoorCeiling;
    p.indoors = indoors;
    if (typeof a.setAmbienceLevel === 'function') a.setAmbienceLevel(indoors ? ac.indoorAmbience : 1);
    if (typeof a.loop !== 'function') return;
    // 風: 高さ（地面からではなくカメラの y）で強く、室内は弱く
    const wk = Math.max(0, Math.min(1, (eyeY - ac.windFrom) / (ac.windFull - ac.windFrom)));
    // ヘリの操縦席の中は窓が閉まっているので弱く（機内の風は heli_wind）
    const inCabin = (this.vehicle && this.vehicle.kind === 'heli' && !this.heliChase) || (this.vehicle && this.vehicle.kind === 'jet' && !this.jetChase) || (this.vehicle && this.vehicle.kind === 'vtol' && !this.vtolChase) || (this.royale && this.royale.riding) || (this.cityOnline && this.cityOnline.riding);
    const chute = p.state === 'chute';
    const wind = Math.pow(wk, 1.2) * (indoors ? 0.25 : 1) * (inCabin ? 0.4 : 1) * (chute ? 0.35 : 1);
    this._windVol = wind; // 天気の wind_gust は wind_high との和が 1 を超えない（weather_view.js の MR.WeatherAudio）
    if (wind > 0.04 && !this._windLoop) this._windLoop = a.loop('wind_high', { volume: wind, fadeIn: 1.5 });
    if (this._windLoop) { if (wind < 0.02) { this._windLoop.stop(1.0); this._windLoop = null; } else this._windLoop.setVolume(wind); }
    // 水音: 近くの水（16 方向 × 距離）→ その方向で陸と水の境目を二分探索した点
    let best = null;
    const R = ac.waterLapRange;
    const swimming = p.state === 'swim';
    if (swimming) best = { x: cam.x, z: cam.z, d: 0 };
    else if (city && typeof city.isWater === 'function' && eyeY < 60 && !this.world.underground) { // 地下（NC5）では岸の水音を鳴らさない
      if (city.isWater(cam.x, cam.z)) best = { x: cam.x, z: cam.z, d: 0 };
      else {
        for (let i = 0; i < 16; i++) {
          const ang = i / 16 * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
          let lo = 0, hi = -1;
          for (const d of [4, 9, 15, 22, 30, 40, 48]) { if (d > R + 8) break; if (city.isWater(cam.x + dx * d, cam.z + dz * d)) { hi = d; break; } lo = d; }
          if (hi < 0 || (best && lo >= best.d)) continue;
          for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (city.isWater(cam.x + dx * m, cam.z + dz * m)) hi = m; else lo = m; }
          if (!best || hi < best.d) best = { x: cam.x + dx * hi, z: cam.z + dz * hi, d: hi };
        }
      }
    }
    const wy = (nav.waterLevelAt && best) ? (nav.waterLevelAt(best.x, best.z) || (city.plan && city.plan.waterY) || -2) : 0;
    if (best && best.d <= R) {
      const pos = { x: best.x, y: wy, z: best.z };
      if (!this._lapLoop) this._lapLoop = a.loop('water_lap', { pos, volume: 1, refDistance: 4, maxDistance: 60, fadeIn: 1.2 });
      this._lapLoop.setPosition(pos);
      this._lapLoop.setVolume(swimming ? 0.6 : 1);
    } else if (this._lapLoop && (!best || best.d > R + 8)) { this._lapLoop.stop(1.0); this._lapLoop = null; }
  }

  _syncMainCamera() {
    const mc = this.mainCamera, c = this.camera;
    mc.matrix.copy(c.matrixWorld);
    mc.matrixWorld.copy(c.matrixWorld);
    mc.matrixWorldInverse.copy(c.matrixWorldInverse);
    const near = this._cityNear || mc.near, far = this._cityFar || mc.far;
    if (mc.fov !== c.fov || mc.aspect !== c.aspect || mc.near !== near || mc.far !== far) {
      mc.fov = c.fov; mc.aspect = c.aspect; mc.near = near; mc.far = far;
      mc.updateProjectionMatrix();
    }
  }

  // ---------- 時間帯（tod.js = MR.Tod）----------
  // どの時間帯で遊ぶか（ゲームを作るときに 1 回。MR.Tod.pick の順）: オンライン → render.tod.online（夕方）。opts.tod（テスト）> URL ?tod=<id>|auto >
  //   window.MR_TOD_DEFAULT（自動テストの固定 'dusk'）> ?harness=1 は夕方 > アリーナは render.tod.arena（夕方）> 設定 mirrsona.tod > render.tod.default。
  //   'auto'（おまかせ）は seed（opts.todSeed > URL &seed= > crypto の乱数。Math.random は使わない = 後の乱数の並びを変えない）の重みで。
  //   戻り値 { id, label, preset, seed, sky（空を変えるか）, windows（窓を変えるか）, sight（敵の見える距離の倍率）}
  static _todSelect(g) {
    const T = MR.Tod, cfg = g.config && g.config.render ? g.config.render.tod : null;
    const out = { id: 'dusk', label: '夕方', preset: {}, seed: 0, sky: false, windows: false, sight: 1 };
    if (!T || !cfg) return out;
    let q = '';
    try { q = (typeof location !== 'undefined' && location.search) || ''; } catch (e) { q = ''; }
    let seed = g.opts && g.opts.todSeed != null ? (Number(g.opts.todSeed) >>> 0) : T.parseSeed(q);
    // 乱数の seed は「おまかせ」のときだけ引く（オンライン・夕方に決まったゲームで crypto を引かない = RSEED のテストの並びをずらさない）
    const seedFn = () => {
      if (seed === null) {
        try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0; } catch (e) { seed = null; }
        if (seed === null) seed = (Date.now() * 2654435761) >>> 0;
      }
      return seed;
    };
    const forced = g.opts && g.opts.tod != null ? g.opts.tod : (g.resume && typeof g.resume.tod === 'string' && T.valid(cfg, g.resume.tod) ? g.resume.tod : T.parseUrl(q, cfg));
    if (forced === null && /[?&]tod=/i.test(q)) console.warn('[Tod] URL の tod の値は使えません（auto / ' + T.ids(cfg).join(' / ') + '）。いつもの時間帯で始めます');
    const def = typeof window !== 'undefined' ? window.MR_TOD_DEFAULT : undefined;
    const id = T.pick(cfg, seedFn, T.load(), { online: g.online, arena: !g.isCity, forced, def, harness: !!MR.HARNESS });
    const p = T.preset(cfg, id);
    out.id = id; out.label = T.label(cfg, id); out.preset = p; out.seed = seed || 0;
    out.sky = !T.isEmpty(p.sky) || !!(p.hemi && (p.hemi.sky || p.hemi.ground)) || !!(p.fog && p.fog.color);
    out.windows = !!(p.windows && typeof p.windows.glow === 'number' && p.windows.glow !== 1);
    out.sight = T.enemySight(p);
    return out;
  }
  // 空の opts（レベルの sky + 時間帯。夕方はレベルの sky そのもの）
  _todSky() {
    const base = this.level.sky || {};
    return MR.Tod && this.tod ? (MR.Tod.skyOpts(base, this.tod.preset) || {}) : base;
  }

  // ---------- 天気（weather.js = MR.Weather の数、weather_view.js = MR.WeatherView の見た目）----------
  // 使うか・どう始めるか（先に当たったもの）: オンライン → 使わない（M5 まで）。weather.enabled: false・レベルが無効（arena01 など）→ 使わない。
  //   opts.weather（テスト: 'off' | 状態の id | 'cycle' | { seed, force, cycle, startState }。予定に無い状態も決められる）>
  //   URL ?weather=off|cycle|<状態>（予定に入っている状態だけ = Weather.parseUrl。まだ無い雪・M1 の雨は使えない）>
  //   window.MR_WEATHER_DEFAULT（自動テストの固定。'off' でオフ）> 設定（予定どおり、ソロはゲームごとに乱数の seed = 「もう一度」で別の天気）。
  //   戻り値 null（オフ）か { seed, force, cycle, startState, offset（ソロの時計のずらし）}
  static _weatherSelect(g) {
    const W = MR.Weather;
    const wc = g.config && g.config.weather;
    if (!W || !MR.WeatherView || !wc || g.online) return null;
    const cfg = W.mergeConfig(wc);
    if (cfg.enabled === false || !W.levelConfig(cfg, g.levelId, g.isCity).enabled) return null;
    let sel = g.opts ? g.opts.weather : undefined;
    if (sel === undefined || sel === null) {
      let url = null;
      const q = (typeof location !== 'undefined' && location.search) || '';
      try { url = W.parseUrl(q, cfg); } catch (e) { url = null; }
      // 使えない値（予定に入っていない状態・知らない名前）は黙って捨てない（実機の確かめで「?weather=storm が効かない」と分かるように）
      if (url === null && /[?&]weather=/i.test(q)) {
        const ok = Object.keys(cfg.states).filter((k) => Number(cfg.states[k].weight) > 0);
        console.warn('[Weather] URL の weather の値は今は使えません（予定に入っている天気だけ: off / cycle / ' + ok.join(' / ') + '）。いつもの天気で始めます');
      }
      sel = url;
    }
    if (sel === undefined || sel === null) {
      // 自動テストの固定（'off'）。ほかの値は URL と同じ（予定に入っていない状態は使わない = 'auto' と同じ）
      const d = typeof window !== 'undefined' ? window.MR_WEATHER_DEFAULT : undefined;
      if (typeof d === 'string' && d !== '') sel = W.parseUrl('?weather=' + encodeURIComponent(d), cfg);
    }
    if (sel === 'off' || sel === false) return null;
    const out = { seed: null, force: null, cycle: false, startState: null, offset: 0 };
    if (typeof sel === 'string') {
      if (sel === 'cycle') out.cycle = true;
      else if (Object.prototype.hasOwnProperty.call(cfg.states, sel)) out.force = sel;
    } else if (sel && typeof sel === 'object') {
      if (sel.seed !== undefined && sel.seed !== null) out.seed = Number(sel.seed) >>> 0;
      if (sel.force && Object.prototype.hasOwnProperty.call(cfg.states, sel.force)) out.force = sel.force;
      out.cycle = !!sel.cycle;
      if (sel.startState) out.startState = sel.startState;
    }
    // seed は crypto から（Math.random を使うと天気のあるゲームだけ後の乱数（敵の湧く場所など）が 1 つずれる）
    if (out.seed === null) {
      let s = null;
      try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) s = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0; } catch (e) { s = null; }
      out.seed = s === null ? Math.floor(Math.random() * 4294967296) >>> 0 : s;
    }
    out.offset = out.cycle ? 0 : W.soloOffset(cfg, out.seed, out.startState);
    return out;
  }
  // 天気の時計（秒）: ソロ = ゲームの時間 + seed ごとのずらし（止まっている間は進まない）。オンラインは M5（サーバーの時計へ滑らかに寄せる）
  _weatherClock(dt) { return this.time + (this._wxOffset || 0); }
  // 霧の距離 × fogMul、描画距離 = min(高さの表の far, max(霧の終わり × farOverFog, 表の far × farMul))（霧が薄いときは表のまま。
  //   霧が濃いときに切れた建物の向こうは雲のドームの霞が霧の色で埋める）。_updateCity の高さの表の後に毎フレーム
  _weatherFog() {
    const p = this.weather.p, fog = this.scene.fog;
    if (fog) { fog.near *= p.fogMul; fog.far *= p.fogMul; }
    if (p.fogMul < 1 || p.farMul < 1) {
      const ff = fog ? fog.far : this._cityFar;
      this._cityFar = Math.min(this._cityFar, Math.max(ff * this.weatherView.vc.farOverFog, this._cityFar * p.farMul));
    }
  }
  // 天気を決める（ソロ・テスト・スクリーンショット）。id = 状態（null で予定に戻る）、opts.instant: すぐ（知らせ無し）。オンラインと天気オフでは何もしない
  setWeather(id, opts) {
    if (this.online || !this.weather) return false;
    return this.weather.force(id === undefined ? null : id, opts);
  }

  _cityDebug() {
    const i = this.world.info();
    const pl = this.play, lv = pl && pl.view ? pl.view.stats : null, mm = pl && pl.minimap ? pl.minimap.stats : null;
    return '  city full ' + i.fullBuilt + '/' + i.full + ' lod ' + i.lodBuilt + '/' + i.lod + ' sky ' + i.skyVisible + '/' + i.sky +
      ' queue ' + i.queue + ' build ' + i.buildMs.toFixed(1) + 'ms geo ' + i.geoLive + ' props ' + i.props +
      (lv ? '  loot ' + lv.items + ' items ' + lv.meshes + ' calls ' + lv.source + '/' + lv.weapons : '') +
      (mm ? '  map ' + mm.drawMs.toFixed(2) + 'ms tiles ' + mm.tiles : '') +
      (this.opts.cityBake ? '  ' + this.opts.cityBake.debugLine() + ' sky ' + (this.world.skySource || '-') + ' lod ' + ((i.bake || {}).lod || 0) + '/' + (((i.bake || {}).lod || 0) + ((i.bake || {}).lodGen || 0)) : '') +
      (this.weather ? '  wx ' + this.weather.p.id + (this.weather.p.blend < 1 ? '<' + this.weather.p.prevId + ' ' + this.weather.p.blend.toFixed(2) : '') : '');
  }

  // ---------- 乗り物 ----------

  _spawnVehicles() {
    const vcfg = this.config.vehicles || {};
    const types = vcfg.types || {};
    const list = Array.isArray(this.level.vehicles) ? this.level.vehicles : [];
    if (!MR.Vehicle || this.rs.vehicles === false || !list.length) return;
    this._makeHeadlight();
    for (let li = 0; li < list.length; li++) {
      const spec = list[li];
      const def = types[spec.type];
      if (!def) { console.warn('[Game] 乗り物の種類が設定にありません:', spec.type); continue; }
      const yaw = THREE.MathUtils.degToRad(spec.yaw || 0);
      const d = Object.assign({ id: spec.type }, def);
      const spot = MR.Vehicle.findSpawn(this.world.nav, Object.assign({}, MR.Vehicle.DEFAULTS, d), spec.x || 0, spec.z || 0, yaw);
      const v = new MR.Vehicle(this.scene, d, { x: spot.x, z: spot.z, yaw, assets: this.assets, audio: this.audio, fx: this.fx, common: vcfg });
      // サーバーの乗り物番号（level.vehicles のうち種類が設定にあるものの通し番号。server/room.js と同じ数え方）
      v.netIndex = this.vehicles.length;
      v.netControlled = this.online;
      this.vehicles.push(v);
    }
  }

  // ヘッドライトは 1 灯だけ作ってシーンに常に置く（ライト数が変わるとシェーダーが作り直されるので）。乗った車に貸す
  _makeHeadlight() {
    const vcfg = this.config.vehicles || {};
    if (vcfg.headlights !== false && !this.headlight && THREE.SpotLight) {
      this.headlight = new THREE.SpotLight(MR.srgb('#ffe9c4'), 0, vcfg.headlightDistance || 30, 0.6, 0.5, 1.5);
      this.headlight.castShadow = false;
      this.scene.add(this.headlight);
      this.scene.add(this.headlight.target);
    }
  }

  // ---------- 街の乗り物 ----------
  // nav に読んであるチャンク（プレイヤーの周り 3 × 3 + 運転中の先）の chunkFull().vehicles（ヘリ以外）を出す。
  // プレイヤーが乗った・動かした・傷つけた車（触った車）は、チャンクから外れたら状態（位置・向き・HP）を覚えて消し、
  // その場所のチャンクがまた読まれたら同じ状態で出す。触っていない車・壊れた車はチャンクから外れたら消す（次は citygen の場所に新品）
  _updateCityVehicles(dt) {
    this._cityVehTimer = (this._cityVehTimer || 0) - dt;
    //  当たり判定のチャンクが増えた・減ったフレームはすぐ（0.5 秒ごとだと速い乗り物では出る所が 0〜70 m ずれる）
    const nv = this.world.navVer || 0;
    if (this._cityVehTimer > 0 && nv === this._cityVehNavVer) return;
    this._cityVehNavVer = nv;
    this._cityVehTimer = 0.5;
    const W = this.world, nav = W.nav, city = this.city;
    const vcfg = this.config.vehicles || {}, types = vcfg.types || {};
    const live = this._cityVehById || (this._cityVehById = new Map());
    const saved = this._cityVehState || (this._cityVehState = new Map());
    const p = this.player.pos;
    const maxLive = this.cityCfg.maxVehicles || 24;
    const heliOK = !!(MR.Helicopter && types.heli && this.cityCfg.helis !== false && !(this.story && !this._storySys('helis'))); // ヘリポートのヘリ（id h_<パッド>）
    const carsOK = !(this.story && !this._storySys('cityVehicles')); // ストーリー: 章の systems.cityVehicles（街の車）
    const jetOK = !!(types.jet && this._jetsOn());                                    // 空母の戦闘機（id j_1..j_4）
    // 残す・作るのは当たり判定のチャンクにあって、プレイヤーか先の位置（navLead）から 300 m 以内の乗り物（作る側も同じ決まり: 遠くへの復活の後、
    //   まだ外していない前の場所のチャンク（world.navRemovePerFrame）の車を消してすぐ作り直さない）
    const ld = W.navLead;
    const near = (x, z) => Math.min(ld ? Math.hypot(x - ld.x, z - ld.z) : Infinity, Math.hypot(x - p.x, z - p.z)) < 300;
    let vtolGone = false;
    const cargoOff = this._cargoOff || (this._cargoOff = []);
    cargoOff.length = 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v === this.vehicle) continue;
      if (v.storyPinned) continue; // ストーリーの七号機・台本の車（storymode.js が持つ）
      if (v.carrier) continue; // VTOL に積んだ車（V2c）: 機体と一緒（機体を消すときに覚えて消す = 下の cargoOff）
      // 無人で飛んでいる戦闘機（射出の後）は墜ちるまで残す
      if (v.kind === 'jet' && v.mode === 'air' && !v.wrecked && !v.sunk) continue;
      // VTOL: 空中（無人で降りている途中）は残す。地上は今の位置から unloadDist m まで残す（チャンクの外の高い屋上でも）
      if (v.kind === 'vtol' && ((!v.grounded && !v.wrecked && !v.sunk) || Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < this._vtolDist('unloadDist'))) continue;
      if (v.platform && !v.wrecked && !v.sunk) continue; // 動く船の甲板に降りているヘリ（boats M3）: 船と一緒に動く。消さない
      if (v.storyPinned) continue; // 物語の機体（七号機 'no7'）: 遠く・チャンクの外でも消さない
      const c = city.chunkOf(v.pos.x, v.pos.z);
      // 戦闘機で飛んでいるときは 1.5 秒先（navLead）の周りも残す（読み込んだ先の車を作ってすぐ消すのを繰り返さない）
      if (nav.hasChunk(c.cx + '_' + c.cz) && near(v.pos.x, v.pos.z)) continue;
      const touched = v.cityTouched || v.health < v.def.health || v.pos.distanceTo(v.spawnPos) > 2;
      const armedK = v.kind === 'jet' || v.kind === 'vtol'; // 機関砲・吊り物を持つ（VTOL は V3）
      if (touched && !v.wrecked && !v.sinking) saved.set(v.cityId, { spec: v.citySpec, x: v.pos.x, y: v.pos.y, z: v.pos.z, yaw: v.yaw, health: v.health, air: (v.kind === 'heli' || v.kind === 'vtol') && !v.grounded, ammo: armedK ? v.ammo : undefined,
        msl: armedK ? Object.assign({}, v.missileCounts()) : undefined, flr: armedK || v.kind === 'heli' ? v.flareCount : undefined });
      else saved.delete(v.cityId);
      if (v.headlight) v.detachHeadlight();
      if (v.kind === 'vtol' && v._cargo && MR.VtolCargo) {
        // 積んだ車は機体の座標の姿勢（e[11] と同じ [機体の id, x, y, z, 向き]）を覚えて一緒に消す。機体を作り直したら積んだまま出す
        const car = v._cargo.car, lk = MR.VtolCargo.link(v);
        if (lk && car.cityId && !car.wrecked) saved.set(car.cityId, { spec: car.citySpec, x: car.pos.x, y: car.pos.y, z: car.pos.z, yaw: car.yaw, health: car.health, air: false, cr: lk });
        else if (car.cityId) saved.delete(car.cityId);
        cargoOff.push(car);
      }
      v.dispose();
      this.vehicles.splice(i, 1);
      live.delete(v.cityId);
      if (v.kind === 'vtol') vtolGone = true;
    }
    for (const car of cargoOff) {
      const k = this.vehicles.indexOf(car);
      if (car === this.vehicle) continue;
      if (car.headlight) car.detachHeadlight();
      car.carrier = null; car.dispose();
      if (k >= 0) this.vehicles.splice(k, 1);
      live.delete(car.cityId);
    }
    // 最後の VTOL を消した（unloadDist m より遠い）: その GLB とまとめた形を GPU から捨てる（VX の (c)。近づけば読み直す）
    if (vtolGone && MR.Vtol && MR.Vtol.releaseAssets) MR.Vtol.releaseAssets(this.assets, this.vehicles);
    for (const [id, st] of saved) {
      if (live.has(id) || this.vehicles.length >= maxLive || st.cr) continue; // 積んだ車（st.cr）は機体の後（下）
      // 覚えている状態でも、出さない設定の種類は出さない（VX: build 15 の続きからの snap の j_* = 戦闘機・ヘリを切った街のヘリ）
      const stType = st.spec && st.spec.type;
      if ((stType === 'jet' && !jetOK) || (stType === 'heli' && !heliOK)) continue;
      // VTOL: 当たり判定のチャンクを待たない（高い屋上は HeliCollider で立てる）。loadDist m に来たら作る（= GLB を読む）
      if (st.spec && st.spec.type === 'vtol') { if (!this._vtolOn()) continue; if (Math.hypot(st.x - p.x, st.z - p.z) < this._vtolDist('loadDist')) this._makeCityVehicle(st.spec, st); continue; }
      const c = city.chunkOf(st.x, st.z);
      if (!nav.hasChunk(c.cx + '_' + c.cz) || !near(st.x, st.z)) continue;
      this._makeCityVehicle(st.spec, st);
    }
    // VTOL（MIRRSONA）: game.json の vtol.spawns（このレベルの物）。近く（loadDist m）に来るまで何も作らない・読まない（遅延）
    if (this._vtolOn()) for (const sp of this._vtolSpawns()) {
      if (live.has(sp.id) || saved.has(sp.id) || this.vehicles.length >= maxLive) continue;
      if (Math.hypot(sp.x - p.x, sp.z - p.z) < this._vtolDist('loadDist')) this._makeCityVehicle(sp, null);
    }
    // VTOL に積んだまま覚えている車（V2c。st.cr = [機体の id, x, y, z, 向き]）: 機体が出ていれば積んだ状態で作る（2 段目 = 機体の後）
    for (const [id, st] of saved) {
      if (!st.cr || live.has(id) || this.vehicles.length >= maxLive) continue;
      const host = live.get(st.cr[0]);
      if (!host || host.kind !== 'vtol' || host._cargo || !host.attachCargo) continue;
      const car = this._makeCityVehicle(st.spec, st);
      if (car && !host.attachCargo(car, Math.cos(st.cr[4] || 0) >= 0 ? 1 : -1)) { /* 置き場所が埋まっている: 覚えている位置のまま */ }
      if (car) saved.delete(id);
    }
    const vrep = this._vtolOn() ? this._vtolReplaced() : null; // VTOL の置き場所にいたヘリ（Sky High の屋上の h_h_tower）は出さない
    for (const ch of nav.chunks.values()) {
      if (ch.furn) continue; // 家具のチャンク（cx_cz#f）
      const data = W.cache.full(ch.cx, ch.cz);
      if (!data || !data.vehicles) continue;
      for (const sp of data.vehicles) {
        if (this.vehicles.length >= maxLive) return;
        if (vrep && vrep.has(sp.id)) continue;
        if ((sp.type === 'heli' && !heliOK) || (sp.type === 'jet' && !jetOK) || (sp.type !== 'heli' && sp.type !== 'jet' && !carsOK) || !types[sp.type] || live.has(sp.id) || saved.has(sp.id) || !near(sp.x, sp.z)) continue;
        if (types[sp.type].kind === 'boat' && !(this.cityBoats && this.cityBoats.boatsOn)) continue; // マリーナのボート（boats）
        this._makeCityVehicle(sp, null);
      }
    }
  }

  _makeCityVehicle(spec, state) {
    const vcfg = this.config.vehicles || {}, nav = this.world.nav;
    const def = Object.assign({ id: spec.type }, vcfg.types[spec.type]);
    if (def.kind === 'heli' && MR.Helicopter) return this._makeCityHeli(spec, state, def);
    if (def.kind === 'jet') return MR.Jet ? this._makeCityJet(spec, state, def) : null;
    if (def.kind === 'vtol') return MR.Vtol ? this._makeCityVtol(spec, state, def) : null;
    if (def.kind === 'boat') return this.cityBoats && MR.Boat ? this.cityBoats.makeBoat(spec, state, def) : null;
    const yaw0 = THREE.MathUtils.degToRad(spec.yaw || 0);
    const spot = MR.Vehicle.findSpawn(nav, Object.assign({}, MR.Vehicle.DEFAULTS, def), spec.x, spec.z, yaw0);
    const gy = nav.groundHeight(spot.x, spot.z, (spec.y || 0) + 1, 0.3);
    const home = { x: spot.x, y: gy == null ? (spec.y || 0) : gy, z: spot.z };
    const x = state ? state.x : home.x, y = state ? state.y : home.y, z = state ? state.z : home.z;
    const v = new MR.Vehicle(this.scene, def, { x, y, z, yaw: state ? state.yaw : yaw0, assets: this.assets, audio: this.audio, fx: this.fx, common: vcfg, terrain: true });
    v.spawnPos.set(home.x, home.y, home.z);
    v.spawnYaw = yaw0;
    if (state) { v.health = state.health; v.cityTouched = true; }
    v.cityId = spec.id;
    v.citySpec = spec;
    v.netIndex = -1;
    this.vehicles.push(v);
    this._cityVehById.set(spec.id, v);
    return v;
  }

  // ---------- ヘリ ----------

  // 建物の当たり判定（街全体。最初のヘリを出すときに作る）
  _heliColl() {
    if (!this.heliCollider && MR.HeliCollider && this.city) this.heliCollider = new MR.HeliCollider(this.city);
    return this.heliCollider || null;
  }

  // ヘリポートのヘリ（state があれば覚えていた位置・向き・HP、空中なら自動で降りる）。置き場所は citygen のパッドそのまま
  _makeCityHeli(spec, state, def) {
    const vcfg = this.config.vehicles || {}, nav = this.world.nav;
    const yaw0 = THREE.MathUtils.degToRad(spec.yaw || 0);
    const gy = nav.groundHeight(spec.x, spec.z, (spec.y || 0) + 0.5, 0.3);
    const home = { x: spec.x, y: gy == null ? (spec.y || 0) : gy, z: spec.z };
    const st = state || null;
    const v = new MR.Helicopter(this.scene, def, {
      x: st ? st.x : home.x, y: st ? st.y : home.y, z: st ? st.z : home.z, yaw: st ? st.yaw : yaw0,
      assets: this.assets, audio: this.audio, fx: this.fx, common: vcfg, collider: this._heliColl(), city: this.city,
      airborne: !!(st && st.air), health: st ? st.health : undefined
    });
    if (st && typeof st.flr === 'number' && v.def.flares) v.flareCount = Math.max(0, Math.min(v.def.flares.count, st.flr | 0)); // フレアの残り
    v.spawnPos.set(home.x, home.y, home.z);
    v.spawnYaw = yaw0;
    if (st) v.cityTouched = true;
    v.cityId = spec.id;
    v.citySpec = spec;
    v.netIndex = -1;
    this.vehicles.push(v);
    (this._cityVehById || (this._cityVehById = new Map())).set(spec.id, v);
    return v;
  }

  // 操縦席を重ね描くカメラ（レイヤー 1 だけ、near 0.05）と、本体のパスの後に入れるパス。ライトはレイヤー 1 にも入れる
  // （ライトの数が同じなので同じシェーダーで描ける）
  _setupCockpit() {
    this.cockpitCamera = new THREE.PerspectiveCamera(this.rs.fov, 1, 0.05, 60);
    this.cockpitCamera.matrixAutoUpdate = false;
    this.cockpitCamera.layers.set(1);
    for (const l of [this.sky.sun, this.sky.hemi, this.muzzleLight, this.headlight]) if (l && l.layers) l.layers.enable(1);
    if (this.composer && THREE.RenderPass) {
      const pass = new THREE.RenderPass(this.scene, this.cockpitCamera);
      pass.clear = false; pass.clearDepth = true; pass.enabled = false;
      const base = pass.render.bind(pass);
      pass.render = (r, w, rb, dt, mask) => this._renderCockpit(r, () => base(r, w, rb, dt, mask));
      this.composer.insertPass(pass, 1);
      this.cockpitPass = pass;
    }
  }

  // 操縦席のパス: 影の地図は本体のパスで作ったもの（ヘリ自身の影も入っている）をそのまま使い、シーンの行列も作り直さない
  _renderCockpit(r, fn) {
    const sm = r.shadowMap, au = sm.autoUpdate, sa = this.scene.autoUpdate;
    sm.autoUpdate = false; this.scene.autoUpdate = false;
    try { if (fn) fn(); else r.render(this.scene, this.cockpitCamera); } finally { sm.autoUpdate = au; this.scene.autoUpdate = sa; }
  }

  // ヘリの一人称のときだけ操縦席のパスを動かし、カメラを写す
  _syncCockpit() {
    const v = this.vehicle;
    const on = !!(v && ((v.kind === 'heli' && !this.heliChase) || (v.kind === 'jet' && !this.jetChase) || (v.kind === 'vtol' && !this.vtolChase)) && v.cockpit && !this.freeCam && !this.player.dead);
    if (this.cockpitPass) this.cockpitPass.enabled = on;
    if (!on) return false;
    const cc = this.cockpitCamera, c = this.camera;
    cc.matrix.copy(c.matrixWorld); cc.matrixWorld.copy(c.matrixWorld); cc.matrixWorldInverse.copy(c.matrixWorldInverse);
    if (cc.fov !== c.fov || cc.aspect !== c.aspect) { cc.fov = c.fov; cc.aspect = c.aspect; cc.updateProjectionMatrix(); }
    return true;
  }

  // ヘリに乗っている間のカメラ: 一人称（機体の傾きを少しだけ）/ 3 人称（ヘリの後ろ上。壁・地面の手前に寄る）。銃は操縦席と 3 人称で隠す
  _updateHeliView(dt, v) {
    const P = this.player, cam = this.camera, d = v.def;
    const chase = !!this.heliChase;
    v.localInside = true;
    v.setCockpit(!chase);
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = !chase && this.vehicleSeat > 0;
    if (chase) {
      cam.rotation.z = 0;
      const pivot = v.toWorld(this._chasePivotL || (this._chasePivotL = new THREE.Vector3(0, 2.4, -1.2)), this._tmpV2);
      const D = (d.chaseDistance || 15) + v.speedRatio * (d.chaseSpeedDist || 4), H = d.chaseHeight == null ? 2.5 : d.chaseHeight;
      P.yaw.position.copy(pivot);
      cam.position.set(0, H, D);
      P.yaw.updateMatrixWorld(true);
      const cw = cam.getWorldPosition(this._tmpV3);
      const dx = cw.x - pivot.x, dy = cw.y - pivot.y, dz = cw.z - pivot.z, len = Math.hypot(dx, dy, dz) || 1;
      let t = len;
      const h = this.world.nav.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len, { water: true });
      if (h && h.t < t) t = h.t;
      const coll = this.heliCollider;
      if (coll) { const t2 = coll.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len); if (t2 !== null && t2 < t) t = t2; }
      const want = Math.max(0.15, Math.min(1, (t - 0.8) / len));
      if (this._chaseK == null || want < this._chaseK) this._chaseK = want;
      else this._chaseK += (want - this._chaseK) * Math.min(1, dt * 2.5);
      cam.position.set(P.shakeOffset.x, H * this._chaseK + P.shakeOffset.y, D * this._chaseK);
    } else {
      // 機体の左右の傾き（見ている向きでは前後の傾き）を cameraRoll の割合だけカメラにも
      const rel = P.yawAngle - (v.yaw + Math.PI);
      const k = d.cameraRoll == null ? 0.25 : d.cameraRoll;
      cam.rotation.z = -(v.roll * Math.cos(rel) + v.pitch * Math.sin(rel)) * k;
    }
    v.listenerPos = cam.getWorldPosition(this._heliEar || (this._heliEar = new THREE.Vector3()));
  }

  // ---------- VTOL（MIRRSONA。dev-notes/plans/mirrsona-vtol.md の V1）----------

  // 空を飛ぶ乗り物か（ヘリ・戦闘機・VTOL）
  static isAirKind(k) { return k === 'heli' || k === 'jet' || k === 'vtol'; }
  // VTOL を出すか（ソロの街：フリーとバトルロイヤル（royale.vtol）。オンラインは無し）。VX: 戦闘機をゲームから外し、VTOL が唯一の固定翼機（既定で出す）。
  //  city.vtol false・opts.vtol === false・URL ?vtol=0 で出さない（?vtol=1 / opts.vtol true は city.vtol false でも出す）。
  //  置き場所ごとの modes（free / royale）は _vtolSpawns が見る
  _vtolOn() {
    const t = ((this.config.vehicles || {}).types || {}).vtol;
    if (!this.isCity || this.online || !MR.Vtol || !t || this.opts.vtol === false) return false;
    if (this._vtolUrl == null) { this._vtolUrl = ''; try { const m = /[?&]vtol=([01])\b/.exec((typeof location !== 'undefined' && location.search) || ''); this._vtolUrl = m ? m[1] : ''; } catch (e) { /* ignore */ } }
    if (this._vtolUrl === '0') return false;
    if (this._vtolUrl === '1' || this.opts.vtol === true) return true;
    if (this.cityCfg.vtol === false) return false;
    if (this._jetsOn() && (this._jetsUrl === '1' || this.opts.jets === true)) return false; // ?jets=1（opt-in の戦闘機）: 甲板・屋上を戦闘機の場面に空ける
    if (this.cityMode === 'royale') return (this.config.royale || {}).vtol === true;
    return true;
  }
  // このゲームに VTOL が出るか（_vtolOn で、このレベル・モードに置き場所がある。manhattan は vtol.spawns に行が無い）。設定の板の「VTOL の操作」はこれで出す
  _vtolHere() { return this._vtolOn() && this._vtolSpawns().length > 0; }
  // VTOL の置き場所が代わりに使う乗り物の id（vtol.spawns[].replaces。屋上のパッドのヘリ）
  _vtolReplaced() {
    if (!this._vtolRep) { this._vtolRep = new Set(); for (const s of this._vtolSpawns()) for (const id of s.replaces || []) this._vtolRep.add(id); }
    return this._vtolRep;
  }
  _vtolDef() { return ((this.config.vehicles || {}).types || {}).vtol || {}; }
  _vtolDist(k) { const d = this._vtolDef(); return typeof d[k] === 'number' ? d[k] : (k === 'loadDist' ? 400 : 650); }
  // vtol.spawns / pads の 1 行の場所: carrierLocal: [x, z, 向き] = 空母の甲板のローカル（Game.carrierToWorld）、
  //   ほかは x / y / z / yaw（度）。空母の行（noJets）は戦闘機を出すとき（opt-in）は使わない（カタパルト・誘導路の上）。無ければ null
  _vtolPlace(s) {
    if (s.noJets && this._jetsOn()) return null;
    if (Array.isArray(s.carrierLocal)) return Game.carrierToWorld(this.city, s.carrierLocal[0], s.carrierLocal[1], s.carrierLocal[2] || 0);
    return { x: s.x, y: s.y || 0, z: s.z, yaw: s.yaw || 0 };
  }
  // 空母の甲板の座標（ローカル: 艦首 +Z・左舷 +X・甲板の上 y = 0。向き heading 度 = 0 が艦首）→ 世界 { x, y（甲板）, z, yaw（度）}。
  //   citygen の _carrierOps と同じ式（landmarks の carrier の params: x / z / yaw / deckTop）。VTOL の置き場所は citygen / midtown.json に入れない
  //   （genKey・citycache・オンラインの乗り物の番号が変わる）ので game.json の carrierLocal からここで。空母が無い街は null
  static carrierToWorld(city, lx, lz, heading) {
    const lm = city && city.plan && (city.plan.landmarks || []).find((l) => l.kind === 'carrier'), p = lm && lm.params;
    if (!p) return null;
    const th = p.yaw * Math.PI / 180, c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
    const r2 = (v) => Math.round(v * 100) / 100;
    return { x: r2(p.x + lx * c + lz * sn), y: (city.waterY || 0) + p.deckTop, z: r2(p.z - lx * sn + lz * c), yaw: r2((((heading || 0) + p.yaw) % 360 + 540) % 360 - 180) };
  }
  // 空母の甲板の VTOL の置き場所（VTOL を出さない設定でも: 復活の候補の場所に使う）。[{ id, x, y, z, yaw（度）}]
  _vtolCarrierSpots() {
    if (this._vtolCs) return this._vtolCs;
    const lv = this.city && this.city.plan ? this.city.plan.id : null;
    this._vtolCs = [];
    for (const s of this._vtolDef().spawns || []) {
      if ((s.level && s.level !== lv) || !Array.isArray(s.carrierLocal) || (s.noJets && this._jetsOn())) continue;
      const q = this._vtolPlace(s);
      if (q) this._vtolCs.push({ id: s.id, x: q.x, y: q.y, z: q.z, yaw: q.yaw });
    }
    return this._vtolCs;
  }
  // このレベルの置き場所（vtol.spawns の level が今のレベル・modes にこのモード）。citygen の vehicleSpawns と同じ形 { id, type: 'vtol', x, y, z, yaw（度）, replaces }
  _vtolSpawns() {
    if (this._vtolSp) return this._vtolSp;
    const lv = this.city && this.city.plan ? this.city.plan.id : null, mode = this.cityMode || 'free';
    this._vtolSp = [];
    for (const s of this._vtolDef().spawns || []) {
      if ((s.level && s.level !== lv) || (Array.isArray(s.modes) && s.modes.indexOf(mode) < 0)) continue;
      const q = this._vtolPlace(s);
      if (q) this._vtolSp.push({ id: s.id, type: 'vtol', x: q.x, y: q.y, z: q.z, yaw: q.yaw, name: s.name, replaces: s.replaces || null });
    }
    return this._vtolSp;
  }
  // 自動着陸の目標: このレベルの pads（大きさ w × d）、ヘリポート（2r × 2r。狭いものは「狭すぎ」の判定だけ）、道路（戦闘機の autoland.roads か vtol.autoland.roads）
  _vtolSpotsList() {
    const d = this._vtolDef(), lv = this.city && this.city.plan ? this.city.plan.id : null;
    const pads = [];
    for (const p of d.pads || []) {
      if (p.level && p.level !== lv) continue;
      const q = this._vtolPlace(p); // 空母（carrierLocal）は甲板の VTOL の置き場所（艦橋・着艦の帯の外）。戦闘機を出すとき（opt-in）は使わない
      if (q) pads.push({ id: p.id, name: p.name, x: q.x, y: q.y, z: q.z, w: p.w, d: p.d, yaw: q.yaw || 0 });
    }
    for (const h of (this.city && this.city.helipads) || []) {
      if (h.id === 'h_carrier') continue; // 空母のヘリ（46 丁目の桟橋）は小さい。空母の甲板は上の pads（carrier）
      if (pads.some((p) => Math.hypot(p.x - h.x, p.z - h.z) < 1 && Math.abs(p.y - h.y) < 2)) continue;
      pads.push({ id: h.id, name: h.label || 'ヘリポート', x: h.x, y: h.y, z: h.z, w: (h.r || 8) * 2, d: (h.r || 8) * 2, yaw: 0 });
    }
    const AL = d.autoland || {};
    const roads = AL.roads === 'jet' || AL.roads == null ? ((((this.config.vehicles || {}).types || {}).jet || {}).autoland || {}).roads || [] : (Array.isArray(AL.roads) ? AL.roads : []);
    return { pads, roads };
  }
  // 屋上の置き場所（state があれば覚えていた位置・向き・HP、空中なら無人でホバリングしてから降りる）
  _makeCityVtol(spec, state, def) {
    const vcfg = this.config.vehicles || {}, nav = this.world.nav;
    const coll = this._heliColl();
    const yaw0 = THREE.MathUtils.degToRad(spec.yaw || 0);
    const sup = coll ? coll.supportAt(spec.x, spec.z, (spec.y || 0) + 0.5, 0.6) : null;
    let gy = sup && sup.y !== null ? sup.y : null;
    const cc = this.city.chunkOf(spec.x, spec.z);
    if (nav.hasChunk(cc.cx + '_' + cc.cz)) { const g = nav.groundHeight(spec.x, spec.z, (spec.y || 0) + 0.5, 0.3); if (g !== null) gy = gy === null ? g : Math.max(gy, g); }
    const home = { x: spec.x, y: gy == null ? (spec.y || 0) : gy, z: spec.z };
    const st = state || null;
    const data = this.assets && typeof this.assets.get === 'function' ? this.assets.get('levels/vtol.json') : null;
    const v = new MR.Vtol(this.scene, def, {
      x: st ? st.x : home.x, y: st ? st.y : home.y, z: st ? st.z : home.z, yaw: st ? st.yaw : yaw0,
      assets: this.assets, audio: this.audio, fx: this.fx, common: vcfg, collider: coll, city: this.city, data,
      airborne: !!(st && st.air), health: st ? st.health : undefined
    });
    v.spawnPos.set(home.x, home.y, home.z);
    v.spawnYaw = yaw0;
    if (st) {
      v.cityTouched = true;
      if (typeof st.ammo === 'number') v.ammo = st.ammo; // 覚えている弾・吊り物・フレア（V3）
      if (st.msl) v.setMissileCounts(st.msl);
      if (typeof st.flr === 'number') v.flareCount = st.flr;
    }
    v.cityId = spec.id;
    v.citySpec = spec;
    v.netIndex = -1;
    v.setSpots(this._vtolSpotsList());
    // 物語の入口: game.json の spawns[].home の機体（空母の v_carrier。安定した id）。その機体がまだ出ていなければ最初に出た機体
    const homeSp = (this._vtolDef().spawns || []).find((q) => q.home);
    if (homeSp && spec.id === homeSp.id) MR.Vtol.home = v;
    else if (!MR.Vtol.home || MR.Vtol.home.disposed) MR.Vtol.home = v;
    this.vehicles.push(v);
    (this._cityVehById || (this._cityVehById = new Map())).set(spec.id, v);
    return v;
  }
  // 操作: 'easy'（かんたん: スティック = 行きたい方へ。タッチの既定）| 'aim'（巡航は見た方へ。PC の既定）。
  //   URL ?vtol= > 端末の設定（vtolControl。設定の画面の「VTOL の操作」。戦闘機の jetControl とは別）> game.json の controls.vtol（'auto'）
  _vtolScheme() {
    if (this._vtolSchemeV == null) {
      const ok = (x) => x === 'easy' || x === 'aim';
      let sc = (this.config.controls || {}).vtol;
      if (!ok(sc)) sc = this.input && this.input.isTouchDevice ? 'easy' : 'aim';
      const pref = Game._loadPref('vtolControl');
      if (ok(pref)) sc = pref;
      try { const q = /[?&]vtol=(easy|aim)\b/.exec((typeof location !== 'undefined' && location.search) || ''); if (q) sc = q[1]; } catch (e) { /* ignore */ }
      this._vtolSchemeV = sc;
    }
    return this._vtolSchemeV;
  }
  // VTOL に外から「乗る」ボタン / E で乗れるか（V1 の乗り方。V2 で後ろの傾斜板から歩いて・車で乗る形に替えるときは vehicles.types.vtol.board.exterior: false。
  //   外の乗り方はこの関数だけが決める）
  _vtolBoardExterior(v) { return !(v && v.def && v.def.board && v.def.board.exterior === false); }
  setVtolScheme(sc, save) {
    if (sc !== 'easy' && sc !== 'aim') return false;
    this._vtolSchemeV = sc;
    if (save) Game._savePref('vtolControl', sc);
    const v = this.vehicle && this.vehicle.kind === 'vtol' ? this.vehicle : null;
    if (v) { v.hdgHold = null; v.altHold = null; v.posHold = null; } // 前の操作の「保つ向き・高さ」へ急に向かない
    return true;
  }
  // 操縦席の入力: 左スティック・上昇 / 下降（巡航では加速 / 減速）・見ている向き・「着陸」（L / #btn-land）
  _vtolControls(dt, v) {
    const inp = this.input, mv = inp.getMove(), P = this.player;
    const cruise = v.flight === 'cruise';
    const up = !!inp.jumpHeld, down = !!inp.descendHeld;
    v.setVtolControls({ stickX: mv.x, stickY: mv.y, climb: cruise ? 0 : (up ? 1 : 0) - (down ? 1 : 0),
      boost: cruise && (up || !!inp.boostHeld), slow: cruise && (down || !!inp.slowHeld), yaw: P.yawAngle + Math.PI, pitch: P.pitchAngle, scheme: this._vtolScheme() });
    if (typeof inp.consumeLand === 'function' && inp.consumeLand()) {
      if (!v.grounded) {
        if (v.autoland) v.cancelAutoland('button');
        else v.startAutoland(this._vehicleCtx());
      } else if (v.cabin) v.openRamp(v.rampState === 'closed' || v.rampState === 'closing'); // 地上: 同じボタン（L）が傾斜板の開け閉め（V2）
    }
    if (v.cabin) this._vtolRampMsgs(v);
    this._vtolEvents(v);
  }
  // 機内（V2）: 徒歩のプレイヤーが足場の上か・機内に入ったか（v.noteWalker → 'boarded'）、外の案内（hintDist m の中で 1 回）、傾斜板のメッセージ
  _vtolWalkTick(dt) {
    if (!this.vehicles.length) return;
    const p = this.player;
    let hint = null;
    for (const v of this.vehicles) {
      if (v.kind !== 'vtol' || !v.cabin) continue;
      v.noteWalker(p);
      this._vtolRampMsgs(v);
      if (!v.onPlatform(p) && !v.wrecked && v.grounded && !v.driver && Math.abs(p.pos.y - v.pos.y) < 3 && v.distanceTo(p.pos.x, p.pos.z) < v.def.board.hintDist) hint = v;
    }
    if (hint && !this._vtolHint) this.hud.showMessage(hint.rampState === 'closed' && !hint._cabinOn ? 'ランプが閉まっています' : '後ろのランプから乗れます', 2200);
    if (hint) { this._vtolHint = hint; this._vtolHintT = this.time; }
    else if (this._vtolHint && this.time - (this._vtolHintT || 0) > 3) this._vtolHint = null;
  }
  // 傾斜板の出来事（v.rampMsg）→ メッセージ（近くの機体だけ・同じものは 1 回）
  _vtolRampMsgs(v) {
    const m = v.rampMsg;
    if (!m || m.n === v._rampMsgSeen) return;
    v._rampMsgSeen = m.n;
    const p = this.player;
    if (Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) > 60) return;
    const R = { water: '水の上では開けません', ground: '地面が合わずランプを下ろせません', ship: '動いている船の上では開けません', air: '着陸中のみ', tilt: '傾いていてランプを下ろせません', moving: '止まってから開けます', wrecked: null, none: null };
    const t = m.t === 'ramp_lift' ? 'ランプを閉じています' : m.t === 'ramp_wait' ? 'ランプに人がいます' : m.t === 'ramp_refused' ? R[m.why] : null;
    if (t) this.hud.showMessage(t, 1600);
  }
  // 出来事 → メッセージ（狭すぎるヘリポート・降りられる所が無い・ふさがっている・着陸した）
  _vtolEvents(v) {
    const E = v.events;
    if (!E.length) return;
    for (const e of E) {
      if (e.t === 'autoland_small') this.hud.showMessage(e.name + ' は狭すぎます — ' + e.to + ' へ', 2200);
      else if (e.t === 'autoland_none') this.hud.showMessage(e.small ? e.small + ' は狭すぎます — 降りられる所がありません' : '降りられる所がありません', 2200);
      else if (e.t === 'autoland') this.hud.showMessage('自動着陸: ' + e.name, 1500);
      else if (e.t === 'autoland_blocked') this.hud.showMessage(e.name + ' はふさがっています', 2000);
      else if (e.t === 'autoland_done') this.hud.showMessage('着陸しました', 1200);
      else if (e.t === 'rearm') this.hud.showMessage('補給', 1200);
      (this.vtolLog || (this.vtolLog = [])).push(e);
      if (this.vtolLog.length > 40) this.vtolLog.shift();
    }
    E.length = 0;
  }
  // 速度の箱の名前: 機体名・ナセルの角度（5° ごと）・自動着陸
  _vtolLabel(v) {
    const th = Math.round(v.theta / 5) * 5, ap = v.autoland ? ' 自動着陸' : '';
    const k = th + '|' + ap;
    if (k !== this._vtolLabelK) { this._vtolLabelK = k; this._vtolLabelS = v.name + '  ナセル ' + th + '°' + ap; }
    return this._vtolLabelS;
  }
  // 乗っている間のカメラ: 3 人称（機体の後ろ上。壁・地面の手前に寄る。かんたんの巡航は機首の向きへ戻る）/ 操縦席（機体の傾きを少し）
  _updateVtolView(dt, v) {
    const P = this.player, cam = this.camera, d = v.def;
    const chase = !!this.vtolChase;
    v.localInside = true;
    v.setCockpit(!chase);
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = false;
    // かんたんの巡航: 見回し（右側のスワイプ）が無ければ camRecenter.delay 秒で機首の向きへ戻る（rate /秒・pitch rad）
    const RC = d.camRecenter || { delay: 1.5, rate: 1.5, pitch: -0.12 };
    if (this._vtolCamYaw != null && Math.abs(P.yawAngle - this._vtolCamYaw) > 1e-5) this._vtolSwipeT = this.time;
    if (!(this.vehicleSeat > 0) && v.flight === 'cruise' && this._vtolScheme() === 'easy' && this.time - (this._vtolSwipeT || -9) > RC.delay) {
      const want = v.yaw + Math.PI;
      let dy = want - P.yawAngle; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      P.yawAngle += dy * Math.min(1, dt * RC.rate);
      P.pitchAngle += (RC.pitch - P.pitchAngle) * Math.min(1, dt * RC.rate);
      P._apply();
    }
    this._vtolCamYaw = P.yawAngle;
    if (chase) {
      cam.rotation.z = 0;
      const pv = d.chasePivot || [0, 4.5, -1], CC = d.chaseClamp || { min: 0.15, wallPad: 1.2, ease: 2.5 };
      const pivot = v.toWorld((this._vtolPivotL || (this._vtolPivotL = new THREE.Vector3())).set(pv[0], pv[1], pv[2]), this._tmpV2);
      // 近い / 遠い（V3。cams[vtolCam]。無ければ前の chaseDistance / chaseHeight / chaseSpeedDist）
      const CM = (d.cams && d.cams[this.vtolCam === 'far' ? 'far' : 'near']) || {};
      const D = (CM.distance != null ? CM.distance : (d.chaseDistance || 44)) + v.speedRatio * (CM.speedDist != null ? CM.speedDist : (d.chaseSpeedDist || 12));
      const H = CM.height != null ? CM.height : (d.chaseHeight == null ? 10 : d.chaseHeight);
      P.yaw.position.copy(pivot);
      cam.position.set(0, H, D);
      P.yaw.updateMatrixWorld(true);
      const cw = cam.getWorldPosition(this._tmpV3);
      const dx = cw.x - pivot.x, dy = cw.y - pivot.y, dz = cw.z - pivot.z, len = Math.hypot(dx, dy, dz) || 1;
      let t = len;
      const h = this.world.nav.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len, { water: true });
      if (h && h.t < t) t = h.t;
      const coll = this.heliCollider;
      if (coll) { const t2 = coll.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len); if (t2 !== null && t2 < t) t = t2; }
      const want = Math.max(CC.min, Math.min(1, (t - CC.wallPad) / len));
      if (this._chaseK == null || want < this._chaseK) this._chaseK = want;
      else this._chaseK += (want - this._chaseK) * Math.min(1, dt * CC.ease);
      cam.position.set(P.shakeOffset.x, H * this._chaseK + P.shakeOffset.y, D * this._chaseK);
      // 最後の確かめ（V3。戦闘機と同じ）: 自分の機体（箱と球 + cams.hullMargin m）の中には置かない = 外に出るまで上げる。
      //   上げた所までの線（ピボット = 胴体の中から）が壁に当たれば、その手前に置いてからもう一度上げる
      if (v.ownHullHas) {
        const CS = d.cams || {}, margin = CS.hullMargin == null ? 0.6 : CS.hullMargin, upMax = CS.raiseMax || 12, upStep = CS.raiseStep || 0.25;
        for (let k = 0; k < 3; k++) {
          P.yaw.updateMatrixWorld(true);
          const cw = cam.getWorldPosition(this._tmpV3);
          let up = 0;
          while (up < upMax && v.ownHullHas(cw.x, cw.y + up, cw.z, margin)) up += upStep;
          if (up <= 0) break;
          P.yaw.position.y += up; this._vtolRaised = (this._vtolRaised || 0) + 1;
          P.yaw.updateMatrixWorld(true);
          const cw2 = cam.getWorldPosition(this._tmpV3);
          const ex = cw2.x - pivot.x, ey = cw2.y - pivot.y, ez = cw2.z - pivot.z, el = Math.hypot(ex, ey, ez) || 1;
          let tw = el;
          const hw = this.world.nav.raycast(pivot.x, pivot.y, pivot.z, ex / el, ey / el, ez / el, el, { water: true });
          if (hw && hw.t < tw) tw = hw.t;
          if (coll) { const t3 = coll.raycast(pivot.x, pivot.y, pivot.z, ex / el, ey / el, ez / el, el); if (t3 !== null && t3 < tw) tw = t3; }
          if (tw >= el || k === 2) break; // 3 回目は機体の外を先に（壁は見ない）
          // 壁の手前（wallPad m）へ: 下げた分は P.yaw ではなくカメラの距離で
          const kk = Math.max(0, (tw - CC.wallPad) / el);
          P.yaw.position.y -= up;
          this._chaseK = Math.min(this._chaseK, kk);
          cam.position.set(P.shakeOffset.x, H * this._chaseK + P.shakeOffset.y, D * this._chaseK);
        }
      }
    } else {
      const rel = P.yawAngle - (v.yaw + Math.PI);
      const k = d.cameraRoll == null ? 0.2 : d.cameraRoll;
      cam.rotation.z = -(v.roll * Math.cos(rel) + v.pitch * Math.sin(rel)) * k;
    }
    v.listenerPos = cam.getWorldPosition(this._vtolEar || (this._vtolEar = new THREE.Vector3()));
  }
  // 降りる（地上で止まっているとき: 座席の出口 → 機首の横・後ろ → 周り）。dead: 墜落で死んだ（その場に置くだけ）
  // VTOL に積んだ車から降りる（V2c）: 積み込み・降ろす途中は降りられない。積んである（stowed）なら機内の左舷の通路（cabin.cargo.autoExit）に立つ
  _exitCargoCar(v, force) {
    const p = this.player, h = v.carrier && v.carrier.host;
    if (!force && v.cargoState !== 'stowed') { if (this.time - (this._cargoBusyMsgT || -9) > 1.5) { this._cargoBusyMsgT = this.time; this.hud.showMessage('積み込み中…', 1200); } return false; }
    this.vehicle = null; this.vehicleSeat = 0;
    this._resetSeatCamera && this._resetSeatCamera();
    const ep = h && h.walkable && h.walkable() && this.cityBoats && this.cityBoats.platforms && MR.VtolCargo ? MR.VtolCargo.exitPoint(h, this._tmpV2) : null;
    if (ep) { this.cityBoats.standOnDeck({ x: ep.x, y: ep.y, z: ep.z }, h.yaw + Math.PI); h.noteStandUp(); }
    else { const c = v.center(this._tmpV1); this.placePlayer(c.x, c.z, c.y + 0.3, THREE.MathUtils.radToDeg(p.yawAngle)); }
    v.exit(p);
    if (this.headlight && v.detachHeadlight()) { this.scene.add(this.headlight); this.scene.add(this.headlight.target); }
    if (this.hud.setVehicle) this.hud.setVehicle(null);
    return true;
  }
  // VTOL の貨物室（V2c）の出来事とメッセージ: 積んだら運転手を通路へ（cargo.autoExitDriver）、壊れた機体から外れた車に乗っていたら降ろす、
  //   車で近づいたら案内（cargo.hintDist m・1 回）、cargoMsg → メッセージ（その機体に関わる人だけ）
  _vtolCargoTick() {
    const p = this.player, cv = this.vehicle && !this.vehicle.kind ? this.vehicle : null;
    let hint = null;
    for (const v of this.vehicles) {
      if (v.kind !== 'vtol' || !v._cargoOn || !v._cargoOn()) continue;
      const c = v._cargo;
      if (v._released && v._released.length) {
        for (const r of v._released) if (this.vehicle === r.car && r.why !== 'unloaded') { if (r.car.carrier) r.car.carrier = null; this._exitVehicle(true); }
        v._released.length = 0;
      }
      if (c && c.state === 'stowed' && v._cargoStowedT != null && c.car === this.vehicle && v.def.cargo.autoExitDriver) { v._cargoStowedT = null; this._exitCargoCar(c.car); }
      const m = v.cargoMsg, near = (cv && (cv === (c && c.car) || Math.hypot(cv.pos.x - v.pos.x, cv.pos.z - v.pos.z) < 40)) || (c && this.vehicle === c.car) || Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z) < 40;
      if (m && m.n !== v._cargoMsgSeen) { v._cargoMsgSeen = m.n; if (near && m.text) this.hud.showMessage(m.text, 1800); }
      if (cv && !cv.carrier && !c && v.grounded && !v.wrecked && v.distanceTo(cv.pos.x, cv.pos.z) < v.def.cargo.hintDist && Math.abs(cv.pos.y - v.pos.y) < 2) hint = v;
    }
    if (hint && !this._cargoHint) this.hud.showMessage('ランプへゆっくり進むと積み込みます', 2200);
    this._cargoHint = hint;
  }
  _exitVtol(v, dead) {
    const p = this.player;
    const seat = Math.max(0, v.seatOf(p));
    v.localInside = false; v.listenerPos = null; v.setCockpit(false);
    // 武装（V3）: 銃の音・ロック・保留のミサイル・HUD
    this._vtolGunStop(v);
    this._jetLock = null; this._vtolMslPend = 0; this.bombCue = null;
    if (this.airCombat) this.airCombat.idle();
    if (this.jetHud) this.jetHud.show(false);
    this.vehicle = null; this.vehicleSeat = 0;
    this._resetSeatCamera();
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = true;
    // V2: 着陸して水平なら席の前に立つ（機内の足場。world の findExit は胴体の 2 m 下の地面になる）。操縦席なら傾斜板を開ける（openOnStandUp）。
    //   機内に立てない（傾いて降りた・データが無い・ボートの足場が無い）ときは今まで通り横の出口（exit_l / exit_r → 周り）
    const sp = !dead && v.grounded && v.walkable && v.walkable() && this.cityBoats && this.cityBoats.platforms ? v.standPoint(seat, this._tmpV2) : null;
    if (dead || !v.grounded) {
      const c = v.center(this._tmpV1);
      p.pos.set(c.x, c.y - p.eyeHeight, c.z);
      p._apply();
    } else if (sp) {
      this.cityBoats.standOnDeck({ x: sp.x, y: sp.y, z: sp.z }, v.yaw);
      v.noteStandUp();
    } else {
      const e = v.findExit(seat, this.world.nav, p.radius);
      this.placePlayer(e.x, e.z, e.y == null ? v.pos.y + 1 : e.y + 0.3, THREE.MathUtils.radToDeg(p.yawAngle));
    }
    v.exit(p);
    if (sp && seat === 0 && v.def.ramp && v.def.ramp.openOnStandUp && v.rampState !== 'open' && v.rampState !== 'opening') v.openRamp(true);
    if (this.hud.setVehicle) this.hud.setVehicle(null);
    if (this.hud.setHeli) this.hud.setHeli(null);
    if (this.hud.setVtol) this.hud.setVtol(null);
  }

  // ---------- VTOL の武装（V3。dev-notes/plans/vtol-v3-impl.md）----------
  // 視点の覚え方（前の版の 'chase' と無い値は 'near'）
  static _vtolCamPref(p) { return p === 'far' || p === 'cockpit' ? p : 'near'; }
  get vtolChase() { return this.vtolCam !== 'cockpit'; }
  set vtolChase(b) { this.vtolCam = b ? (this.vtolCam === 'far' ? 'far' : 'near') : 'cockpit'; }
  // 吊り物の形: 試作弾（ordnance.glb の proj_aim9x / proj_gbu）を焼いて付ける。届くまでは筒の代わり（長さは missiles.types）
  _vtolStores(v) {
    if (!v || typeof v.setStoreGeo !== 'function') return;
    if (!this.missiles && MR.Missiles) this.missiles = this._makeMissiles();
    const Ms = this.missiles;
    const lens = {}, types = {};
    for (const e of v._loadout()) types[e[1]] = 1;
    for (const e of v._bombLoadout()) types[e[1]] = 1;
    for (const k in types) lens[k] = Ms ? Ms.typeCfg(k).length : 3;
    v.setStoreGeo(MR.Missiles ? MR.Missiles._baked : null, lens);
    if (Ms && typeof Ms.preload === 'function') Ms.preload(Object.keys(types)).then(() => { if (!v.disposed) v.setStoreGeo(MR.Missiles._baked); });
  }
  // 撃つ・ロックの向き: ホバー（θ ≥ 45°）はカメラの向き、巡航は速度の向き（gun.hoverAimSpeed m/s より遅ければ機首）
  _vtolAimDir(v, out) {
    out = out || new THREE.Vector3();
    if (v.theta >= 45) return this.camera.getWorldDirection(out);
    if (v.speed > (v.def.gun.hoverAimSpeed || 30)) return out.copy(v.vel).normalize();
    return out.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
  }
  // 翼の銃を p（世界）へ向ける: 重心から p への向きを機体の座標で gunYaw / gunPitchUp / gunPitchDown（度）に収めて v.gunAim に書く。
  //   out = 収めた向きで p と同じ距離の点（HUD のピパー・弾の向かう点）
  _vtolAimAt(v, p, out) {
    const G = v.def.gun, c = v.center(this._vaC || (this._vaC = new THREE.Vector3()));
    const d = (this._vaD || (this._vaD = new THREE.Vector3())).subVectors(p, c);
    const dist = Math.max(1, d.length());
    d.multiplyScalar(1 / dist);
    const qi = (this._vaQ || (this._vaQ = new THREE.Quaternion())).copy(v.quat).invert();
    d.applyQuaternion(qi);
    const D2R = Math.PI / 180;
    const yaw = Math.max(-G.gunYaw * D2R, Math.min(G.gunYaw * D2R, Math.atan2(d.x, d.z)));
    const pitch = Math.max(-G.gunPitchDown * D2R, Math.min(G.gunPitchUp * D2R, Math.asin(Math.max(-1, Math.min(1, d.y)))));
    v.gunAim.yaw = yaw; v.gunAim.pitch = pitch;
    d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(v.quat);
    return out.copy(c).addScaledVector(d, dist);
  }
  // 照準の点（HUD のピパー・操縦士の銃）: ホバーは画面の真ん中に見えている所（カメラからのレイ。当たらなければ convergence m 先）、
  //   巡航は飛ぶ向き（_vtolAimDir）のレイが当たる所（当たらなければ convergence m 先）。どちらも銃の首振りの中に収める（v.gunAim を書く）。同じフレームは 1 回だけ計算する
  _vtolGunPoint(v, out) {
    const k = this._vgpK || (this._vgpK = { v: null, t: -1, p: new THREE.Vector3() });
    if (k.v === v && k.t === this.time) return out.copy(k.p);
    const G = v.def.gun, c = v.center(this._vgC || (this._vgC = new THREE.Vector3()));
    const d = this._vtolAimDir(v, this._vgD || (this._vgD = new THREE.Vector3()));
    const pt = this._vgT || (this._vgT = new THREE.Vector3());
    if (v.theta >= 45) {
      const cp = this.camera.getWorldPosition(this._vgP || (this._vgP = new THREE.Vector3()));
      const off = cp.distanceTo(c);
      const h = this._jetRay(cp, d, (G.range || 1400) + off, this._vgHit || (this._vgHit = {}));
      if (h && h.t > off * 0.5) pt.set(h.x, h.y, h.z); else pt.copy(cp).addScaledVector(d, (G.convergence || 400) + off);
    } else {
      // 巡航: 飛ぶ向きのレイが当たる所（地上の目標へ向かって降りれば弾がそこへ集まる）、当たらなければ convergence m 先
      const h = this._jetRay(c, d, G.range || 1400, this._vgHit || (this._vgHit = {}));
      if (h && h.t > 30) pt.set(h.x, h.y, h.z); else pt.copy(c).addScaledVector(d, G.convergence || 400);
    }
    this._vtolAimAt(v, pt, k.p);
    k.v = v; k.t = this.time;
    return out.copy(k.p);
  }
  // 翼の銃（操縦席）: 撃つボタン / マウスを押している間（Space は上昇）。出ていなければ出す（armTime 秒）→ 押したまま撃ち始める。
  //   左右の銃口を交互に、1 フレームの弾は _gunVolley（戦闘機と同じ）。空なら「弾切れ（パッドで補給）」
  _updateVtolGun(dt, v) {
    const G = v.def.gun, inp = this.input;
    const want = !!inp.fireHeld && !this.player.dead && !v.wrecked && !(this.vehicleSeat > 0) && !this.online;
    if (want) v.arm();
    if (want && v.ammo <= 0 && this.time - (this._vtolEmptyT || -9) > 1.5) { this._vtolEmptyT = this.time; this.hud.showMessage('弾切れ（' + (v.def.rearmHint || 'パッド') + 'で補給）', 1200); }
    if (!want || v.ammo <= 0 || !v.armed) { if (this._vtolGunV || v.firing) this._vtolGunStop(v); return; }
    v.firing = true; this._vtolGunV = v;
    this._gunSndT = (this._gunSndT || 0) - dt;
    if (this._gunSndT <= 0 && this.audio && typeof this.audio.play === 'function') {
      this._gunSndT = G.burst;
      this._gunSnd = this.audio.play('cannon_m61', { priority: 3, channel: 'self' });
      this.audio.play('cannon_tail', { volume: 0.5, synth: false, channel: 'self' });
    }
    this._gunAcc = (this._gunAcc || 0) + G.rate * dt;
    let n = Math.floor(this._gunAcc);
    if (n <= 0) return;
    this._gunAcc -= n;
    n = Math.min(n, v.ammo);
    v.ammo -= n;
    v.shots = (v.shots || 0) + n;
    this._vtolMz = this._vtolMz ? 0 : 1;
    const muzzle = v.muzzleWorld(this._vtolMz, this._tmpV1);
    const aim = this._vtolGunPoint(v, this._vgAim || (this._vgAim = new THREE.Vector3()));
    const dir = this._tmpV3.copy(aim).sub(muzzle).normalize();
    this._gunVolley(v, muzzle, dir, n, G);
  }
  _vtolGunStop(v) {
    if (this._gunSnd) { try { this._gunSnd.stop(0.02); } catch (e) { /* ignore */ } this._gunSnd = null; }
    this._gunAcc = 0; this._gunSndT = 0;
    if (v) v.firing = false;
    this._vtolGunV = null;
  }
  // ミサイル・爆弾（操縦席。「ミサイル」= #btn-missile / F。F は地上では降りる = 空中だけ）: 扉が閉じていれば出して（arm）、開くまで
  //   armTime + arm.pending 秒だけ待って撃つ。ロック・撃つ型・爆弾の落ちる所は AirCombat.updateVtol、フレアと RWR は updateHeli（その後）
  _updateVtolWeapons(dt, v) {
    if (!this.airCombat && MR.AirCombat) this.airCombat = new MR.AirCombat(this);
    if (!this.airCombat) return;
    const inp = this.input, A = v.def.arm;
    let wantM = typeof inp.consumeMissile === 'function' && inp.consumeMissile();
    const air = MR.AirCombat.inAir(v);
    if (wantM && !air) { wantM = false; if (!inp._interact) this.hud.showMessage('ミサイルは飛んでいるときに撃てます', 1000); }
    const stores = v.missileCount + v.bombCount;
    if (wantM && stores > 0 && !v.bayOpen && !this.online) { v.arm(); this._vtolMslPend = this.time + A.armTime + A.pending; wantM = false; }
    if (this._vtolMslPend) {
      if (!air) this._vtolMslPend = 0;
      else if (v.bayOpen) { this._vtolMslPend = 0; wantM = true; }
      else if (this.time > this._vtolMslPend) this._vtolMslPend = 0;
      else v.arm();
    }
    if (wantM) v.arm();
    this.airCombat.updateVtol(dt, v, wantM);
  }
  // 物語の射撃（v.fireGunsAt / v.fireMissileAt が置いた仕事。操縦士がいなくてもよい）
  vtolFireGuns(v, p, sec) { return !!(v && v.fireGunsAt && v.fireGunsAt(p, sec)); }
  vtolFireMissile(v, target) { return !!(v && v.fireMissileAt && v.fireMissileAt(target)); }
  _updateVtolTasks(dt) {
    if (this.online) return;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.kind !== 'vtol' || (!v.gunTask && !v.missileTask)) continue;
      if (!v._storeLen) this._vtolStores(v); // 吊り物の形（操縦士が乗っていない機体は、ここで初めて）
      if (v.gunTask) this._vtolGunTask(dt, v);
      if (v.missileTask) this._vtolMissileTask(v);
    }
  }
  _vtolGunTask(dt, v) {
    const T = v.gunTask, G = v.def.gun, A = v.def.arm;
    const late = T.end == null && v.time - T.t0 > A.armTime + A.pending + 5; // 出せない（壊れかけ・ずっと地上の片付け）
    if (v.wrecked || v.disposed || v.ammo <= 0 || late || (T.end != null && v.time > T.end)) { v.gunTask = null; if (this._vtolGunV !== v) v.firing = false; return; }
    v.arm();
    const aim = this._vtolAimAt(v, T.p, this._vtA || (this._vtA = new THREE.Vector3()));
    if (!v.armed) return;
    if (T.end == null) T.end = v.time + T.sec; // sec 秒は出しきってから
    v.firing = true;
    T.acc = (T.acc || 0) + G.rate * dt;
    T.sndT = (T.sndT || 0) - dt;
    let n = Math.floor(T.acc);
    if (n <= 0) return;
    T.acc -= n;
    n = Math.min(n, v.ammo);
    v.ammo -= n;
    v.shots = (v.shots || 0) + n;
    T.mz = T.mz ? 0 : 1;
    const muzzle = v.muzzleWorld(T.mz, this._vtM || (this._vtM = new THREE.Vector3()));
    const dir = (this._vtDir || (this._vtDir = new THREE.Vector3())).copy(aim).sub(muzzle).normalize();
    if (T.sndT <= 0 && this.audio && typeof this.audio.play === 'function') { T.sndT = G.burst; this.audio.play('cannon_m61', { pos: muzzle, priority: 2, refDistance: 30, maxDistance: 1500 }); }
    this.vtolGunShots = (this.vtolGunShots || 0) + n;
    if (this._gunVolley(v, muzzle, dir, n, G, this.vehicle === v && !(this.vehicleSeat > 0))) this.vtolGunHits = (this.vtolGunHits || 0) + 1;
  }
  _vtolMissileTask(v) {
    const T = v.missileTask, A = v.def.arm;
    if (v.wrecked || v.disposed || v.missileCount + v.bombCount <= 0 || v.time - T.t0 > A.armTime + A.pending + 5) { v.missileTask = null; return; }
    v.arm();
    if (!v.bayOpen) return;
    v.missileTask = null;
    this._vtolLaunch(v, T.target);
  }
  // 1 発（操縦士がいなくてもよい。物語・テスト）: target = 乗り物 / 敵（ロックしたのと同じ）か { x, y, z }（狙う点）
  _vtolLaunch(v, target) {
    if (!this.missiles && MR.Missiles) this.missiles = this._makeMissiles();
    const Ms = this.missiles;
    if (!Ms || !target) return false;
    const obj = !!(target.pos || target.kind || typeof target.takeDamage === 'function' || target.isAASite);
    const tp = this._vlTp || (this._vlTp = new THREE.Vector3());
    if (obj) MR.Missiles.targetPos(target, tp); else tp.set(target.x, target.y, target.z);
    const c = v.center(this._vlC || (this._vlC = new THREE.Vector3()));
    const dir = (this._vlD || (this._vlD = new THREE.Vector3())).subVectors(tp, c);
    const dist = dir.length() || 1;
    dir.multiplyScalar(1 / dist);
    const kind = obj && MR.Missiles.isAir(target) ? 'air' : 'ground';
    let type = MR.MissileCore ? MR.MissileCore.pickType(Ms.cfg, v.missileCounts(), kind, dist, 0, null) : null;
    if (!type && kind !== 'air' && v.bombCount > 0 && v.bombReady()) type = v._bombLoadout()[0][1];
    if (!type) return false;
    const from = v.takeMissile(type, this._vlF || (this._vlF = new THREE.Vector3()));
    if (!from) return false;
    Ms.fire({ from, vel: v.vel, dir, target: obj ? target : null, owner: v, type, aim: obj ? null : tp });
    this.vtolMissilesFired = (this.vtolMissilesFired || 0) + 1;
    return true;
  }
  // HUD（jethud.js の drawVtol。別の担当が書く）に渡す中身。drawVtol が無ければ何もしない
  _drawVtolHud() {
    const v = this.vehicle;
    if (!v || v.kind !== 'vtol' || !this.jetHud || typeof this.jetHud.drawVtol !== 'function') return;
    const d = v.def;
    const info = this._vtolHudInfo || (this._vtolHudInfo = {});
    info.vtol = true; info.v = v; info.camera = this.camera; info.chase = !!this.vtolChase; info.cockpit = !this.vtolChase; info.cam = this.vtolCam;
    const L = this._jetLock;
    info.lock = null;
    if (L && MR.Missiles && MR.Missiles.alive(L.target)) {
      const lk = this._vtolLockI || (this._vtolLockI = { point: new THREE.Vector3() });
      MR.Missiles.targetPos(L.target, lk.point); lk.locked = !!L.locked; lk.k = Math.min(1, L.t / Math.max(0.01, d.missile.lockTime)); lk.dist = L.dist;
      info.lock = lk;
    }
    info.missiles = v.missileCount; info.missileTypes = v.missileCounts(); info.flares = v.flareCount; info.incoming = v.incoming || null;
    info.rwr = this.rwr && this.rwr.st > 0 ? this.rwr : null;
    info.bomb = this.bombCue && !this.online ? this.bombCue : null;
    info.gunPoint = v.armPos > 0 ? this._vtolGunPoint(v, this._vtolGunP || (this._vtolGunP = new THREE.Vector3())) : null;
    info.firing = !!v.firing; info.ammo = v.ammo; info.ammoMax = d.gun.ammo; info.time = this.time;
    info.arm = v.armPos; info.armed = v.armed;
    info.speed = v.speed; info.alt = v.agl; info.theta = v.theta;
    const wy = this.city && this.city.waterY != null ? this.city.waterY : -2;
    info.asl = v.pos.y - wy;
    let warn = null;
    if (v.incoming && !v.grounded && (v.incoming.tti < 6 || v.incoming.dist < 2500)) warn = Game.MSL_WARN[(MR.AirCombat ? MR.AirCombat.clock(v.incoming.bearing) : 12) % 12];
    else if (v.stall && !v.grounded) warn = '失速';
    info.warn = warn;
    this.jetHud.drawVtol(info);
  }

  // ---------- 戦闘機（フェーズ E1）----------

  // 戦闘機を出すか（街のソロ: city.jets、バトルロイヤル: royale.jets も。オンラインはフェーズ E4）
  //  VX: city.jets / royale.jets は false（戦闘機をゲームから外した）。opt-in: URL ?jets=1・opts.jets true（テスト・戦闘機の画。VTOL は出さない）
  _jetsOn() {
    if (!this.isCity || this.online || !MR.Jet) return false;
    if (this._jetsUrl == null) { this._jetsUrl = ''; try { const m = /[?&]jets=([01])\b/.exec((typeof location !== 'undefined' && location.search) || ''); this._jetsUrl = m ? m[1] : ''; } catch (e) { /* ignore */ } }
    if (this._jetsUrl === '1' || this.opts.jets === true) return true;
    if (this._jetsUrl === '0' || this.opts.jets === false) return false;
    if (this.cityCfg.jets === false) return false;
    if (this.cityMode === 'story') return false; // ストーリーは VTOL（七号機）だけ（plan rev 2 §1）
    if (this.cityMode === 'royale') return (this.config.royale || {}).jets !== false;
    return true;
  }
  // 戦闘機の操作: 'easy'（かんたん: 左スティック = 行きたい方向・速さは自動。タッチの既定）| 'aim'（視点で操縦: 見た方へ飛ぶ。PC の既定）|
  //   'manual'（スティック = ピッチ・ロール）。URL ?jet= > 端末の設定（jetControl。設定の画面で選ぶ）> game.json の controls.jet
  //   （'auto' = タッチの端末なら easy、そうでなければ aim）
  _jetScheme() {
    if (this._jetSchemeV == null) {
      const ok = (x) => x === 'easy' || x === 'aim' || x === 'manual';
      let sc = (this.config.controls || {}).jet;
      if (!ok(sc)) sc = this.input && this.input.isTouchDevice ? 'easy' : 'aim';
      const pref = Game._loadPref('jetControl');
      if (ok(pref)) sc = pref;
      try { const q = /[?&]jet=(easy|aim|manual)\b/.exec((typeof location !== 'undefined' && location.search) || ''); if (q) sc = q[1]; } catch (e) { /* ignore */ }
      this._jetSchemeV = sc;
    }
    return this._jetSchemeV;
  }
  _jetManual() { return this._jetScheme() === 'manual'; }
  _jetEasy() { return this._jetScheme() === 'easy'; }
  // 操作を変える（設定の画面・テスト）。save なら端末に覚える。飛んでいる途中でも安全に: 見る向きを今の飛ぶ向きに合わせ、
  //   かんたんの「保つ向き・高度」を今の値で覚え直す（前の操作の目標へ急に向かない）
  setJetScheme(sc, save) {
    if (sc !== 'easy' && sc !== 'aim' && sc !== 'manual') return false;
    const prev = this._jetScheme();
    this._jetSchemeV = sc;
    if (save !== false) Game._savePref('jetControl', sc);
    const v = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    if (v && prev !== sc) {
      v._easy = null;
      const P = this.player;
      v.axes();
      const d = v.mode === 'air' && v.speed > 20 ? v.vel.clone().normalize() : v._fwd.clone();
      P.yawAngle = Math.atan2(-d.x, -d.z); P.pitchAngle = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      P._apply();
      this._jetCamGoal = null; this._jetSwipeT = this.time; this._jetEasyCamS = null;
    }
    return true;
  }
  // かんたんの設定: 上下反転（jetInvert）・自動フレア（jetAutoFlare。既定はオン）
  get jetInvert() { if (this._jetInvV == null) this._jetInvV = Game._loadPref('jetInvert') === '1'; return this._jetInvV; }
  set jetInvert(on) { this._jetInvV = !!on; Game._savePref('jetInvert', on ? '1' : '0'); }
  get jetAutoFlare() { if (this._jetAfV == null) this._jetAfV = Game._loadPref('jetAutoFlare') !== '0'; return this._jetAfV; }
  set jetAutoFlare(on) { this._jetAfV = !!on; Game._savePref('jetAutoFlare', on ? '1' : '0'); }
  // アフターバーナーの光（render.jetLight。モバイルは無し）と HUD のキャンバス
  _setupJets() {
    if (this.rs.jetLight !== false && THREE.PointLight) {
      this.abLight = new THREE.PointLight(MR.srgb('#ffb066'), 0, 45, 2);
      this.abLight.castShadow = false;
      this.abLight.layers.enable(1);
      this.scene.add(this.abLight);
    }
    this._setupJetHud();
  }
  // #jet-hud のキャンバス（戦闘機の draw・VTOL の drawVtol）
  _setupJetHud() {
    let cv = null;
    try { cv = typeof document !== 'undefined' && document.getElementById ? document.getElementById('jet-hud') : null; } catch (e) { cv = null; }
    this.jetHud = MR.JetHUD ? new MR.JetHUD(cv && typeof cv.getContext === 'function' ? cv : null) : null;
  }

  // 空母の駐機場所の戦闘機（state があれば覚えていた位置・向き・HP・弾）。置き場所は citygen の carrierOps そのまま
  _makeCityJet(spec, state, def) {
    const vcfg = this.config.vehicles || {}, nav = this.world.nav;
    const yaw0 = THREE.MathUtils.degToRad(spec.yaw || 0);
    const gy = nav.groundHeight(spec.x, spec.z, (spec.y || 0) + 0.5, 0.3);
    const home = { x: spec.x, y: gy == null ? (spec.y || 0) : gy, z: spec.z };
    const st = state || null;
    const v = new MR.Jet(this.scene, def, {
      x: st ? st.x : home.x, y: st ? st.y : home.y, z: st ? st.z : home.z, yaw: st ? st.yaw : yaw0,
      assets: this.assets, audio: this.audio, fx: this.fx, common: vcfg, collider: this._heliColl(), city: this.city,
      health: st ? st.health : undefined
    });
    v.spawnPos.set(home.x, home.y, home.z);
    v.spawnYaw = yaw0;
    if (st) {
      v.cityTouched = true;
      if (typeof st.ammo === 'number') v.ammo = st.ammo;
      if (st.msl && typeof st.msl === 'object') v.setMissileCounts(st.msl); // 型ごとのミサイル・フレアの残り（補給するまで）
      if (typeof st.flr === 'number') v.flareCount = Math.max(0, Math.min(v.def.flares.count, st.flr | 0));
    }
    v.cityId = spec.id;
    v.citySpec = spec;
    v.netIndex = -1;
    this.vehicles.push(v);
    (this._cityVehById || (this._cityVehById = new Map())).set(spec.id, v);
    return v;
  }

  // 見ている向き（カメラの向き = 操縦の目標）。player の yawAngle / pitchAngle から（操縦席のカメラは機体に固定なので camera からは取らない）
  _aimDir(out) {
    const P = this.player, cp = Math.cos(P.pitchAngle);
    return out.set(-Math.sin(P.yawAngle) * cp, Math.sin(P.pitchAngle), -Math.cos(P.yawAngle) * cp);
  }

  // 操縦席の入力: 左スティック（スロットル・ロール / 前輪）、見ている向き、脚・視点、手動ならスティック = ピッチ・ロール
  //   かんたん（easy）: 見ている向きは操縦に使わない（右側は見回すだけ）。加速・減速ボタン（Shift / C）、上下反転（設定）。
  //   着艦・着陸ボタン（L）: 空中で自動着艦・着陸を始める / 取り消す（どの操作でも）
  _jetControls(dt, v) {
    const inp = this.input, mv = inp.getMove();
    const scheme = this._jetScheme(), manual = scheme === 'manual', easy = scheme === 'easy';
    const aim = manual || easy ? null : this._aimDir(this._jetAimV || (this._jetAimV = new THREE.Vector3()));
    const k = inp.keys || {};
    const launch = typeof inp.consumeLaunch === 'function' && inp.consumeLaunch();
    const land = typeof inp.consumeLand === 'function' && inp.consumeLand();
    // 右側をスワイプしている（カメラを寄せる _jetCamAssist は見回している間は止まる）
    const lk = inp.peekLook ? inp.peekLook() : null;
    if (lk && Math.abs(lk.x) + Math.abs(lk.y) > 0.5) this._jetSwipeT = this.time;
    v.setJetControls({ stickX: mv.x, stickY: mv.y, aim, scheme, invert: easy && this.jetInvert, boost: easy && !!inp.boostHeld, slow: easy && !!inp.slowHeld,
      thrUp: inp._jumpTouch || !!(k.ShiftLeft || k.ShiftRight), thrDown: inp.descendHeld, launch });
    if (land) { if (v.autoland) v.cancelAutoland('button'); else v.startAutoland(this._vehicleCtx()); }
    if (typeof inp.consumeGear === 'function' && inp.consumeGear()) v.toggleGear();
  }

  // 機関砲（M61）: 撃つボタン / マウス / Space を押している間 gun.rate 発/秒。1 フレームの弾をまとめて 1 本の当たり判定（機首の向き、
  //   gun.convergence m で照準に収束、gun.spread° のばらつき）。敵・乗り物・建物・地面。トレーサーは gun.tracerEvery 発に 1 本（飛んでいく光）。
  //   音は gun.burst 秒ごとに cannon_m61（+ cannon_tail）、離したら止める
  _updateJetGun(dt, v) {
    const G = v.def.gun, inp = this.input;
    const held = (inp.fireHeld || !!(inp.keys && inp.keys.Space)) && !this.player.dead && v.ammo > 0 && !v.wrecked && !(this.vehicleSeat > 0);
    if (!held) {
      this._gunAcc = 0; this._gunSndT = 0;
      if (this._gunSnd) { try { this._gunSnd.stop(0.02); } catch (e) { /* ignore */ } this._gunSnd = null; }
      if (v.firing && v.ammo <= 0) this.hud.showMessage('弾切れ（空母で補給）', 1200);
      v.firing = false;
      return;
    }
    v.firing = true;
    this._gunSndT = (this._gunSndT || 0) - dt;
    if (this._gunSndT <= 0 && this.audio && typeof this.audio.play === 'function') {
      this._gunSndT = G.burst;
      this._gunSnd = this.audio.play('cannon_m61', { priority: 3, channel: 'self' });
      this.audio.play('cannon_tail', { volume: 0.5, synth: false, channel: 'self' });
    }
    this._gunAcc = (this._gunAcc || 0) + G.rate * dt;
    let n = Math.floor(this._gunAcc);
    if (n <= 0) return;
    this._gunAcc -= n;
    n = Math.min(n, v.ammo);
    v.ammo -= n;
    v.shots = (v.shots || 0) + n;
    const muzzle = v.toWorld(v.muzzleL, this._tmpV1);
    const conv = this._jetGunPoint(v, this._tmpV2);
    const dir = this._tmpV3.copy(conv).sub(muzzle).normalize();
    // かんたん: ピパーの近くの目標へ弾を向ける（照準アシスト）
    if (this._jetEasy() && this._jetGunAssist(v, muzzle, dir, this._jetAsD || (this._jetAsD = new THREE.Vector3()))) { dir.copy(this._jetAsD); this.jetGunAssisted = (this.jetGunAssisted || 0) + n; }
    this._gunVolley(v, muzzle, dir, n, G);
  }
  // 1 フレームの弾（n 発）をまとめて 1 本の当たり判定（_updateJetGun から取り出した。同じ Math.random の順番 = 戦闘機の結果は前と同じ）。
  //   muzzle / dir（単位）は世界、G = 機体の gun（spread / range / damage / tracerEvery / tracerSpeed）。v = 撃つ機体（自分には当たらない）。
  //   mine === false: 操縦士のいない機体（物語の 七号機 の fireGunsAt）= 撃破・当たりの印・揺れ・手柄を自分のものにしない。
  //   muzzle と dir に this._tmpV2 を渡さない（当たった所を書く）
  _gunVolley(v, muzzle, dir, n, G, mine) {
    const own = mine !== false;
    const sp = (G.spread || 0) * Math.PI / 180;
    if (sp > 0) { dir.x += (Math.random() - 0.5) * sp * 2; dir.y += (Math.random() - 0.5) * sp * 2; dir.z += (Math.random() - 0.5) * sp * 2; dir.normalize(); }
    const range = G.range || 1600;
    const wall = this._jetRay(muzzle, dir, range);
    let maxT = wall ? wall.t : range;
    let best = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const h = e.intersectRay(muzzle, dir, maxT);
      if (h && (!best || h.t < best.t)) { best = h; best.enemy = e; }
    }
    let vhit = null;
    for (const o of this.vehicles) {
      if (o === v || o.sunk) continue;
      const h = o.intersectRay(muzzle, dir, best ? best.t : maxT);
      if (h && (!vhit || h.t < vhit.t)) { vhit = h; vhit.vehicle = o; }
    }
    const dmg = G.damage * n;
    let end, anyHit = false, kill = false;
    if (vhit && (!best || vhit.t < best.t)) {
      end = vhit.point;
      this.fx.impact(vhit.point, vhit.normal);
      if (typeof this.audio.impact === 'function') this.audio.impact('metal', vhit.point);
      if (!vhit.vehicle.wrecked) { if (own) vhit.vehicle._selfT = this.time; vhit.vehicle.hit(dmg, vhit.point, this._vehicleCtx()); anyHit = true; }
    } else if (best) {
      end = best.point;
      const killed = best.enemy.takeDamage(dmg, dir);
      this.fx.hitFlesh(best.point, dir);
      if (typeof this.audio.impact === 'function') this.audio.impact('flesh', best.point);
      anyHit = true;
      if (killed) { kill = true; if (own) this._onKill(best.enemy, 'gun'); }
    } else if (wall) {
      end = this._tmpV2.set(wall.x, wall.y, wall.z);
      if (this.airDefense && !wall.water && this.airDefense.gunHit(end.x, end.y, end.z, n)) anyHit = true; // 屋上の対空の陣地（gunHits 発で黙る）
      if (wall.water) { if (this.fx.splash) this.fx.splash(end, 0.5, 'bullet'); }
      else {
        this.fx.impact(end, this._jetN || (this._jetN = new THREE.Vector3()).set(wall.nx, wall.ny, wall.nz));
        if (typeof this.fx.smoke === 'function' && Math.random() < 0.3) this.fx.smoke(end, 0.6);
        if (this.destruct) this.structHit({ x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz, radius: 1.2, damage: dmg, edge: 0.5, kind: 'gun', box: wall.box || null, own: !!own }); // 機関砲: えぐれ・小物
      }
    } else end = this._tmpV2.copy(muzzle).addScaledVector(dir, range);
    this._tracerN = (this._tracerN || 0) + n;
    if (this._tracerN >= (G.tracerEvery || 3)) {
      this._tracerN = 0;
      if (typeof this.fx.streak === 'function') this.fx.streak(muzzle, end, G.tracerSpeed || 1000); else this.fx.tracer(muzzle, end, false);
    }
    if (anyHit && own) { this.hud.hit(kill); this.audio.hit(); }
    if (own) this.shake = Math.min(0.5, this.shake + 0.02);
    return anyHit;
  }
  // 照準の点（HUD のピパー）: 飛んでいる向き（速度ベクトル。地上は機首）に gun.convergence m 先。
  //   アーケード: 弾は機体の進む向きへ飛ぶ（迎え角と弾の落ちを打ち消した照準）ので、見た方へ飛ぶ操縦のまま「見た所に当たる」
  _jetGunPoint(v, out) {
    v.axes();
    const c = v.center(out);
    const d = v.mode === 'air' && v.speed > 30 ? this._jetGunD || (this._jetGunD = new THREE.Vector3()) : v._fwd;
    if (d !== v._fwd) d.copy(v.vel).multiplyScalar(1 / v.speed);
    return c.addScaledVector(d, v.def.gun.convergence || 650);
  }
  // 遠くまで届くレイ（機関砲）: 読み込み済みの nav（細かい箱・水）→ HeliCollider を 48 m ずつ → 地面（陸 0・水面）
  //   out（任意）: 結果を書く物（ミサイル・ロックは毎回作らない）。無ければ新しい物
  _jetRay(o, d, maxT, out) {
    const nav = this.world.nav;
    let best = null;
    const near = nav.raycast(o.x, o.y, o.z, d.x, d.y, d.z, Math.min(maxT, 300), { water: true });
    if (near) best = Game._rayPut(out, near.t, near.x, near.y, near.z, near.nx, near.ny, near.nz, !!near.water, 'nav', near.box);
    const coll = this.heliCollider;
    const lim = best ? best.t : maxT;
    if (coll) {
      for (let t0 = 0; t0 < lim; t0 += 48) {
        const t1 = Math.min(lim, t0 + 48);
        const t = coll.raycast(o.x + d.x * t0, o.y + d.y * t0, o.z + d.z * t0, d.x, d.y, d.z, t1 - t0);
        if (t !== null) { const tt = t0 + t; best = Game._rayPut(out || best, tt, o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt, -d.x, -d.y, -d.z, false, 'building'); break; }
      }
    }
    // 動く船の船体・船室（boats）
    if (this.cityBoats) {
      const h = this.cityBoats.shipRayT(o, d, best ? best.t : maxT);
      if (h) best = { t: h.t, x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, src: 'ship' };
    }
    // 地面（読み込んでいない所）: y = 0 の面（水なら水面）
    if (d.y < -1e-4) {
      let tg = (o.y - 0) / -d.y;
      if (tg < (best ? best.t : maxT)) {
        const gx = o.x + d.x * tg, gz = o.z + d.z * tg;
        const w = this.city && this.city.isWater && this.city.isWater(gx, gz);
        if (w) tg = (o.y - (this.city.waterY != null ? this.city.waterY : -2)) / -d.y;
        if (tg < (best ? best.t : maxT)) best = Game._rayPut(out || best, tg, o.x + d.x * tg, o.y + d.y * tg, o.z + d.z * tg, 0, 1, 0, !!w, 'ground');
      }
    }
    return best;
  }
  static _rayPut(r, t, x, y, z, nx, ny, nz, water, src, box) {
    r = r || {};
    r.t = t; r.x = x; r.y = y; r.z = z; r.nx = nx; r.ny = ny; r.nz = nz; r.water = water; r.src = src; r.box = box || null; // box: 壊れる物（小物の箱）
    return r;
  }

  // ミサイル・フレア（操縦席）: ロック・撃つ・フレア・警告は MR.AirCombat（aircombat.js）。テスト（jeteasy-touch・smoke 13f / 16）がこの名前で呼ぶ
  _updateJetWeapons(dt, v) {
    if (!this.airCombat && MR.AirCombat) this.airCombat = new MR.AirCombat(this);
    if (this.airCombat) this.airCombat.update(dt, v);
  }
  // ミサイルの数値: 機体の missile（vehicles.types.jet.missile: センサー・発射・地上の目標の飛び方）の上に game.json の missiles（型・上限・煙）
  _missileCfg() {
    const cfg = this.config, jt = ((cfg.vehicles || {}).types || {}).jet;
    return Object.assign({}, (jt && jt.missile) || {}, cfg.missiles || {});
  }
  _makeMissiles() {
    return new MR.Missiles(this.scene, this.fx, this.audio, this._missileCfg(), {
      assets: this.assets, mobile: !!(this.input && this.input.isTouchDevice), visualOnly: !!this.online, puffs: this.config.puffs || null, lazyBake: true
    });
  }
  // ミサイルの当たり判定・爆発（MR.Missiles.update の ctx）
  _missileCtx() {
    if (!this._mctx) {
      this._mctx = {
        vehicles: this.vehicles, enemies: this.enemies, camera: null,
        ray: (o, d, maxT, out) => this._jetRay(o, d, maxT, out),
        onDetonate: (p, m, obj, water, air) => this._missileBlast(p, m, obj, water, air)
      };
    }
    this._mctx.vehicles = this.vehicles; this._mctx.enemies = this.enemies;
    this._mctx.camera = this.camera.getWorldPosition(this._mslCam || (this._mslCam = new THREE.Vector3())); // 煙の帯をカメラへ向ける・近いミサイルの音
    return this._mctx;
  }
  // 爆発（E3.4: ダメージは game.explode → MR.Explosive.blast。数値は explosives.blasts[型]（aim9x / aim120 / manpads）。無い型は m.tc から同じ形を作る）。
  //   形は前の計算と同じ（tools/blast-regress.json の数 ± 1 %）: blastRadius m の乗り物・敵・プレイヤーに damage（中心で全部、端で × (1 − edge)）、
  //   歩いているプレイヤーは × player（0.3）、乗り物は × vs（= armor）。視線（見える割合）は当たった面の手前（飛んできた向きの逆に 0.3 m）から。
  //   乗っている人は乗り物が守る（D9、seat 'vehicle'）: 乗り物が vehicle × vs を受け、乗っている人はその爆風 × driverExposure（戦闘機 0・ヘリ 0.25・ジープ 0.35）。
  //   直接は当たらない。死ぬのは乗り物が爆発したとき（_vehicleExploded）。撃った機体（持ち主）は数えない。手柄は持ち主が自分の乗っている機体のとき
  //   滑空爆弾（E2.5。m.tc.glide = gbu16）: 同じ道。見た目の大きさは blasts.gbu16.fx、揺れは shakeRange m、spec の struct（構造物へのダメージ）は
  //   game.explode → MR.Explosive の out.struct = game.lastExplodeStruct へそのまま（受けるだけ。建物を壊すのは destruct の流れ）
  _missileBlast(p, m, obj, water, air) {
    const key = m.k || (m.tc && m.tc.key) || '';
    const XB = ((this.config && this.config.explosives) || {}).blasts || {};
    const glide = !!(m.tc && m.tc.glide);
    const fxS = glide && XB[key] && XB[key].fx ? XB[key].fx : (air ? 3 : 4.5);
    if (this.crashes) this.crashes.blast(p.x, p.y, p.z, fxS, { water, air, silent: true, shake: false, splash: 'missile' }); // 見た目（E3.1。音は missile_explode。水しぶきは WaterFX の 'missile'）
    else if (water) { if (this.fx.splash) this.fx.splash(p, glide && XB[key] && XB[key].splash ? XB[key].splash : 3, 'missile'); }
    else if (this.fx.explosion) this.fx.explosion(p, fxS, 0.5);
    if (this.online) return; // ダメージはサーバー（D10。visualOnly なのでふつうは呼ばれない）
    if (this.airDefense) this.airDefense.onBlast(p.x, p.y, p.z, m.owner); // 対空の陣地は killRadius m 以内の爆発で黙る（陣地のミサイルは数えない）
    const spec = (key && XB[key]) || this._missileSpec(m);
    // 自分の撃ったミサイルか（持ち主の無いミサイル・地上の対空ミサイルは自分の手柄にしない。歩いていると null === null だった）
    const mine = !!m.owner && m.owner === this.vehicle;
    // 視線の元: 飛んできた向きの逆（壁・地面の手前）
    const mv = m.core && m.core.v;
    let nx = 0, ny = 1, nz = 0;
    if (mv) { const L = Math.hypot(mv[0], mv[1], mv[2]); if (L > 1e-3) { nx = -mv[0] / L; ny = -mv[1] / L; nz = -mv[2] / L; } }
    const o = this._mxo || (this._mxo = { noFx: true, silent: true, noShake: true, skip: null, missile: true, key: '' });
    o.skip = m.owner || null; o.key = key || 'missile';
    this.explode(p.x, p.y, p.z, nx, ny, nz, spec, mine ? 'self' : null, obj || null, o);
    o.skip = null;
    const pl = this.vehicle ? this.vehicle.pos : this.player.pos;
    const dd = Math.hypot(pl.x - p.x, pl.z - p.z);
    const shR = glide && spec.shakeRange ? spec.shakeRange : 120; // ミサイルは今まで通り 120 m
    if (dd < shR) this.shake = Math.min(1.5, this.shake + (1 - dd / shR) * (glide && spec.shakeGain ? spec.shakeGain : 0.8));
  }
  // 壊れる物への当たり（爆発・弾・機関砲・はねる）。info は MR.Destruction.hit を参照。壊した数（街でなければ 0）
  structHit(info) { return this.destruct ? this.destruct.hit(info) : 0; }
  // explosives.blasts に無い型: m.tc（blastRadius / damage / blastEdge / playerBlast）から同じ形を作る（型ごとに 1 回）
  _missileSpec(m) {
    const MC = m.tc || (m.owner && m.owner.def && m.owner.def.missile) || (this.missiles && this.missiles.cfg) || {};
    const c = this._mspecs || (this._mspecs = new Map());
    let sp = c.get(MC);
    if (!sp) {
      const D = MC.damage || 650;
      sp = { radius: MC.blastRadius || 16, edge: MC.blastEdge == null ? 0.6 : MC.blastEdge, chest: 1, centerDist: true, damage: D, vehicle: D,
        player: MC.playerBlast == null ? 0.3 : MC.playerBlast, prop: 1, vs: { apc: 0.35, heli: 0.6, jet: 0.5, default: 1 }, shakeRange: 120, fx: 3 };
      const vt = (this.config.vehicles || {}).types || {};
      for (const k in vt) if (vt[k] && typeof vt[k].armor === 'number') sp.vs[k] = vt[k].armor; // 乗り物は armor（v.hit と同じ）
      c.set(MC, sp);
    }
    return sp;
  }
  // ---------- 爆発の入口（E3.0。weapons2 の game.explode と同じ形）----------
  // explode(x, y, z, nx, ny, nz, blastKey, by, hitObj, opts) … 爆発はここ 1 つを通す。数値は explosives.blasts[blastKey]（MR.Explosive の形）。
  //   (nx, ny, nz) 当たった面の法線（空中は飛んできた向きの逆）、by = 起こした物（'self' / プレイヤー / 乗っている乗り物 = 自分の手柄、敵、null = 連鎖）、
  //   hitObj = 直撃した物（距離 0）。opts: { water（水面: しぶきと湯気）, silent（音なし）, skip（数えない物）, noFx,
  //   struct: { radius, damage }（任意。構造物へのダメージ = 後で。今は MR.Explosive の out.struct と game.lastExplodeStruct に書くだけ。blasts の struct も同じ）}
  //   当たり: MR.Explosive.blast（env は 1 回だけ作る。敵・this.vehicles・プレイヤー。視線は当たり判定を読んだチャンクなら nav、ほかは HeliCollider）。
  //     兵士は takeDamage（自分の手柄なら _onKill）、乗り物は v.damage（そのまま = 弾の armor を二重に掛けない）、プレイヤーは _playerHit（kind 'explosion'
  //     = ベストだけ）。乗っている人は乗り物が守る（D9: 乗り物が爆発しなければ × driverExposure）。
  //   揺れ（shakeRange）・音（farFrom m 以内は 3D の explosion_large、遠いと 2D の explosion_far を音の速さで遅らせて ≤ 1.5 秒）・見た目（街は MR.Puffs:
  //   大きな爆発 1 + 小さい 2〜4 + 煙 4〜6 + fx の火花。アリーナは今まで通りの fx.explosion = 板を作らない）。オンラインは見た目だけ（D10）。戻り値は当たった数
  //   E3.4: _missileBlast（ミサイル）・_vehicleExploded（乗り物の爆発）もここを通す。blastKey は名前か spec そのもの（乗り物の explodeRadius / explodeDamage を
  //   重ねたもの・blasts に無いミサイルの型）。opts.noShake（揺れは呼ぶ側）、opts.key（数える名前）、opts.missile（自分のミサイルが当たった乗り物を jetMissileHits に）。
  //   数: explodeStats { calls, byKey: { 名前: 回数 } }（場面 19 の F12）
  explode(x, y, z, nx, ny, nz, blastKey, by, hitObj, opts) {
    const XC = this.config.explosives || {};
    const spec = (blastKey && typeof blastKey === 'object') ? blastKey
      : ((XC.blasts && XC.blasts[blastKey]) || (MR.Explosive && MR.Explosive.DEFAULT) || { radius: 6, fx: 3, shakeRange: 60 });
    const XS = this.explodeStats || (this.explodeStats = { calls: 0, byKey: {} });
    const sk = (opts && opts.key) || (typeof blastKey === 'string' ? blastKey : 'spec');
    XS.calls++; XS.byKey[sk] = (XS.byKey[sk] || 0) + 1;
    // 点・結果の配列・blast の opts は深さごと（乗り物が爆発して、その爆発がまた explode を呼んでも外の点・結果を上書きしない）
    const depth = (this._xDepth || 0) + 1;
    const ps = this._xPs || (this._xPs = []);
    const p = ps[depth] || (ps[depth] = new THREE.Vector3());
    p.set(x, y, z);
    const water = !!(opts && opts.water);
    if (!(opts && opts.noFx)) this._explodeFx(p, spec, water);
    // 揺れ・音（カメラからの距離）
    const cam = this.camera.getWorldPosition ? this.camera.getWorldPosition(this._mslCam2 || (this._mslCam2 = new THREE.Vector3())) : this.camera.position; // 本当のカメラの位置（偽のゲームのテストは position だけ）
    const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    const sr = spec.shakeRange || 60;
    if (d < sr && !(opts && opts.noShake)) this.shake = Math.min(1.5, this.shake + (1 - d / sr) * 0.9);
    if (!(opts && opts.silent) && this.audio && typeof this.audio.play === 'function') {
      const far = XC.farFrom || 300;
      if (d <= far) this.audio.play('explosion_large', { pos: p, refDistance: 25, maxDistance: 1200, priority: 3 });
      else this.audio.play('explosion_far', { volume: Math.max(0.15, Math.min(1, far / d)), delay: Math.min(1.5, d / 343), priority: 2 });
    }
    // 壊れる物（destruct_view.js）: opts.struct > spec.struct > 爆発の半径とダメージ。spec.struct: false で壊さない。水面は壊さない。
    //   オンラインは destruct が見た目だけにする（当たり判定・記録を変えない = DS14b）
    if (this.destruct && !water) {
      const st = (opts && opts.struct) || (spec.struct !== undefined ? spec.struct : spec);
      if (st && st.radius > 0) {
        const si = this._xsi || (this._xsi = { x: 0, y: 0, z: 0, radius: 0, damage: 0, edge: undefined, kind: '' }); // 法線は渡さない（ミサイルの n は飛んできた向き = 面ではない。destruct が面を探す）
        si.x = x; si.y = y; si.z = z; si.radius = st.radius; si.damage = st.damage || 0; si.edge = st.edge !== undefined ? st.edge : spec.edge;
        si.kind = st.kind || ((opts && opts.missile) ? 'missile' : (/Crash$/.test(sk) ? 'vehicle' : 'blast'));
        si.structMul = st.structMul > 0 ? st.structMul : (spec.structMul > 0 ? spec.structMul : 0); // 壊す倍率（ミサイル 6。無ければ destruct.scale.struct）
        si.own = by === 'self' || (by != null && (by === this.player || (!!this.vehicle && by === this.vehicle))); // 倒壊の手柄（destruct-3 M3）
        this.structHit(si);
      }
    }
    if (this.online || !MR.Explosive) return 0; // ダメージはサーバー（D10）
    this._xDepth = depth;
    const outs = this._xOuts || (this._xOuts = []);
    const out = outs[depth] || (outs[depth] = []);
    const bos = this._xOpts || (this._xOpts = []);
    const bo = bos[depth] || (bos[depth] = { hitObj: null, skip: null, cone: null, struct: null });
    bo.hitObj = hitObj || null; bo.skip = (opts && opts.skip) || null; bo.cone = (opts && opts.cone) || null; bo.struct = (opts && opts.struct) || null;
    let n = 0;
    try {
      n = MR.Explosive.blast(spec, x, y, z, nx || 0, ny || 0, nz || 0, this._explodeEnv(), out, bo);
      this._explodeApply(out, n, p, by, opts);
    } finally {
      this._xDepth = depth - 1;
      this.lastExplodeStruct = out.struct || null; // 構造物のダメージ（受けて報告するだけ。効き目は後で）
      bo.hitObj = null; bo.skip = null; bo.cone = null; bo.struct = null;
    }
    return n;
  }
  _explodeApply(out, n, p, by, opts) {
    const mine = by === 'self' || (by != null && (by === this.player || (!!this.vehicle && by === this.vehicle)));
    const seated = this.vehicle;
    const ctx = this._vehicleCtx ? this._vehicleCtx() : null;
    // 乗り物が先（乗っている人は乗り物が爆発したかで決まる）
    for (let i = 0; i < n; i++) {
      const e = out[i];
      if (e.cls !== 'vehicle' || !(e.dmg > 0)) continue;
      const v = e.target;
      if (v.wrecked || !v.damage) continue;
      if (mine && v !== seated) v._selfT = this.time;
      v.damage(e.dmg, ctx);
      if (mine && v !== seated) this.hud.hit(v.wrecked);
      if (mine && v !== seated && opts && opts.missile) this.jetMissileHits = (this.jetMissileHits || 0) + 1;
    }
    const dirs = this._xDirs || (this._xDirs = []), dd = this._xDepth || 0;
    const dir = dirs[dd] || (dirs[dd] = new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const e = out[i];
      if (e.cls === 'soldier') {
        const en = e.target;
        if (en.dead || !(e.dmg > 0)) continue;
        dir.set(en.pos.x - p.x, 0.5, en.pos.z - p.z).normalize();
        if (en.takeDamage(e.dmg, dir) && mine) { this._onKill(en, 'explosion'); this.hud.hit(true); }
      } else if (e.cls === 'player' && e.target === this.player) {
        if (this.player.dead) continue;
        if (e.via) {
          // D9: 乗っていた乗り物が残っていれば × driverExposure（爆発して降ろされたら _vehicleExploded が決める）。数は MR.Explosive の seat
          if (this.vehicle !== e.via) continue;
          this.blastToSeated = (this.blastToSeated || 0) + e.dmg;
          if (e.dmg > 0) this._playerHit(e.dmg, { kind: 'explosion', by });
          else { this.hud.damage(); this.shake = Math.min(1.5, this.shake + 0.3); }
        } else if ((!seated || !this.isCity) && e.dmg > 0) this._playerHit(e.dmg, { kind: 'explosion', by }); // アリーナは乗っていても直接（seatedIn が null）
      }
    }
  }
  // MR.Explosive の env（1 回だけ作る。目標の記述も使い回す）
  _explodeEnv() {
    if (this._xenv) return this._xenv;
    const g = this;
    const t = { obj: null, cls: '', x: 0, y: 0, z: 0, h: 0, r: 0, typeId: null, kind: null, defId: null, driverExposure: 0 };
    const c = new THREE.Vector3();
    this._xenv = {
      each(visit) {
        for (const e of g.enemies) {
          if (e.dead) continue;
          t.obj = e; t.cls = 'soldier'; t.x = e.pos.x; t.y = e.pos.y; t.z = e.pos.z; t.h = 1.8; t.r = 0;
          t.typeId = null; t.kind = null; t.defId = null; t.driverExposure = 0;
          visit(t);
        }
        for (const v of g.vehicles) {
          if (v.wrecked || v.sunk) continue;
          if (v.center) v.center(c); else c.copy(v.pos);
          const df = v.def || {};
          t.obj = v; t.cls = 'vehicle'; t.x = c.x; t.y = c.y; t.z = c.z; t.h = df.height || 2;
          t.r = Math.min(df.width || 2, df.length || 4) * 0.5;
          t.typeId = v.id || null; t.kind = v.kind || null; t.defId = df.id || v.id || null; t.driverExposure = df.driverExposure || 0;
          visit(t);
        }
        const pl = g.player;
        if (pl && !pl.dead) {
          t.obj = pl; t.cls = 'player'; t.x = pl.pos.x; t.y = pl.pos.y; t.z = pl.pos.z; t.h = 1.8; t.r = 0;
          t.typeId = null; t.kind = null; t.defId = null; t.driverExposure = 0;
          visit(t);
        }
      },
      flat: !g.isCity, // アリーナは水平の距離（前の車の爆発と同じ）
      // D9 は街だけ（アリーナで乗っていれば今まで通り直接受ける）
      seatedIn(obj) { return obj === g.player && g.vehicle && g.isCity ? g.vehicle : null; },
      los(ax, ay, az, bx, by, bz) {
        if (!g.isCity || !g.world) return true; // アリーナは当たり判定の箱で見ない（今まで通りの爆発の形）
        const nav = g.world.nav;
        if (nav && g.city && nav.hasChunk) {
          const ch = g.city.chunkOf((ax + bx) * 0.5, (az + bz) * 0.5);
          if (nav.hasChunk(ch.cx + '_' + ch.cz)) return nav.lineOfSight(ax, ay, az, bx, by, bz);
        }
        const coll = g._heliColl ? g._heliColl() : null;
        if (!coll) return true;
        const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
        if (L < 1e-6) return true;
        return coll.raycast(ax, ay, az, dx / L, dy / L, dz / L, L) === null;
      }
    };
    return this._xenv;
  }
  // ---------- 墜落の火（E3.1。MR.Burn の plan → MR.Crashes）----------
  // 乗り物の _explodeFx / _impactFx（ctx.crashFx）から。sp = { stage: 'explode' | 'land', x, y, z（中心）, vx, vy, vz, air, crash }
  //   explode: 空中で撃墜（sp.air）→ 段 air（火の玉と落ちる残骸の燃える尾。記録は残骸について行き、落ちたら land）。
  //            ほかは墜落の点の面（classify: 水 / 地面 / 屋上 / 壁 / 甲板）で段 ground。壁に当たった残骸は落ちた所でも land。
  //   land: 撃墜（air）か壁の後の残骸が落ちた → 段 land（爆風なし・地面の火・焦げ・水なら湯気）。地上で燃えている残骸が落ち着いただけなら小さな火の玉
  //   戻り値 true = 見た目を引き受けた（乗り物は fx.explosion を呼ばない）。ダメージは今まで通り onExplode → _vehicleExploded（E3.4 で explode へ）
  _crashFx(v, sp) {
    const C = this.crashes, B = MR.Burn;
    if (!C || !B || !v) return false;
    const kind = v.kind === 'jet' ? 'jet' : (v.kind === 'heli' ? 'heli' : (v.kind === 'vtol' ? 'vtol' : 'car'));
    // ボート（boats）: いつも水の上 = 船体の上の小さな火の玉 + しぶき・湯気（火の記録・地面の火・焦げ・破片なし。沈むのは boat.js）
    if (v.kind === 'boat') {
      if (sp.stage === 'land') return true;
      const wy = typeof v.waterY === 'number' && isFinite(v.waterY) ? v.waterY : sp.y;
      const s = C.sizeOf('car');
      C.blast(sp.x, Math.max(sp.y, wy + 0.8), sp.z, s * 0.7, { silent: true, ring: false, shake: false });
      C.blast(sp.x, wy + 0.3, sp.z, s, { water: true, kind: 'car' });
      if (C.stats) C.stats.boats = (C.stats.boats || 0) + 1;
      return true;
    }
    const bs = this._burnSpec || (this._burnSpec = { kind: '', stage: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, surface: '', box: null, slide: false });
    bs.kind = kind; bs.vx = sp.vx; bs.vy = sp.vy; bs.vz = sp.vz; bs.box = null; bs.slide = false;
    let fresh = false;
    if (sp.stage === 'land') {
      const rec = v._fireRec;
      if (!((rec && rec.awaitLand) || v._landPending)) {
        // 地面・屋上で燃えていた残骸が水に落ちた: 水の上で燃え続けない（湯気にして消す。火の玉は出さない）
        const Sw = this._burnSupport(sp.x, sp.z, sp.y + 1);
        if (Sw.y == null && Sw.water != null) {
          if (rec && rec.sec > 0 && !rec.out) C.quench(rec, sp.x, Sw.water + 0.3, sp.z); else C.splash(sp.x, Sw.water + 0.3, sp.z, C.sizeOf(kind) * 0.5);
          return true;
        }
        C.impact(sp.x, sp.y, sp.z, C.sizeOf(kind) * 0.4);
        return true;
      }
      v._landPending = false;
      bs.stage = 'land';
    } else if (sp.air) { bs.stage = 'air'; fresh = true; }
    else { bs.stage = 'ground'; fresh = true; }
    // 面: 足元（墜落の点 = 中心の下）
    const y = v.pos ? Math.min(v.pos.y, sp.y) : sp.y;
    bs.x = sp.x; bs.z = sp.z; bs.y = y;
    if (bs.stage === 'air') bs.surface = 'air';
    else {
      const info = this._burnClassify(sp.x, y, sp.z, sp.y + 1, sp.crash);
      if (info.box) { bs.box = info.box; if (sp.crash.y != null) bs.y = sp.crash.y; }
      bs.surface = info.surface;
      if (bs.surface !== 'wall' && bs.surface !== 'water' && info.sy != null && bs.surface !== 'air') bs.y = info.sy;
      if (bs.surface === 'water' && info.sw != null) bs.y = info.sw;
      if (bs.surface === 'air') { bs.surface = 'ground'; } // 落ちてきた残骸の「空中」は足元の面（支えが少し下）
    }
    const FCB = this._burnCfg || (this._burnCfg = Object.assign({}, this.config.fire || {}, { blasts: (this.config.explosives || {}).blasts || {} }));
    this._crashSeq = (this._crashSeq || 0) + 1;
    const seed = (Math.imul(this._crashSeq, 2654435761) ^ Math.floor(sp.x * 7 + sp.z * 13)) >>> 0;
    const plan = B.plan(seed, bs, FCB, this._burnWorld(), this._burnPlan || (this._burnPlan = B.newPlan()));
    const ops = this.city && this.city.carrierOps;
    if (ops && plan.patches.length) B.cull(plan, ops.jetSpots, (FCB.patch && FCB.patch.keepOut) || 6); // 空母の駐機場所には火を置かない
    // VTOL の置き場所（空母の甲板・Sky High の屋上。翼幅 44 m）にも地面の火を置かない（止めてある機体・乗りに来た人が燃えない）
    if (plan.patches.length && this._vtolOn()) { const vs = this._vtolSpawns(); if (vs.length) B.cull(plan, vs, ((FCB.patch && FCB.patch.keepOut) || 6) + (this._vtolDef().width || 44) / 2); }
    // 地面の火の連鎖の段（地面の火で壊れた車は gen = その火の gen + 1。_onFireHits）
    const fo = this._crashO || (this._crashO = { by: null, gen: 0 });
    // 起こした物（地面の火で倒れた敵の手柄）: 墜落の最初の段で決めて覚える（落ちた所の land・滑った後の爆発も同じ。respawn で消す）
    if (v._crashBy === undefined || v._crashBy === null) v._crashBy = this._crashCause(v);
    fo.by = v._crashBy; fo.gen = v._fireGen || 0;
    if (bs.stage !== 'air') v._fireGen = 0;
    if (bs.stage === 'land') { C.land(v, plan, fo); return true; }
    const rec = C.explode(bs, plan, fo);
    if (fresh && rec) {
      if (bs.stage === 'air') C.attach(v, rec);
      else if (bs.surface === 'wall') v._landPending = true; // 壁の火はそこに残り、落ちた残骸は落ちた所で燃える
      else if (bs.surface !== 'water') C.attach(v, rec);
    } else if (bs.surface === 'wall') v._landPending = true;
    return true;
  }
  // 墜落を起こした物: 'self' = プレイヤー（乗っていた・causeSec 秒以内に降りた / 撃った / 自分の爆発が当たった・射出した無人の機体）、
  //   ほかは地面の火で壊れた車ならその火の by、無ければ null（敵・連鎖）。ソロだけ（オンラインの手柄はサーバー）
  _crashCause(v) {
    if (!v || this.online) return null;
    if (v === this.vehicle || v.pilotless) return 'self';
    const sec = (this.config.fire || {}).causeSec || 30;
    if (v._selfT != null && this.time - v._selfT <= sec) return 'self';
    return v._fireBy != null ? v._fireBy : null;
  }
  // 滑る墜落（E3.3。jet._updateSlide から）: ev = 'start'（乗っている人は死ぬ・起こした物を決める）/ 'patch'（跡の地面の火。駐機場所の近くは置かない）/
  //   'spark'（火花の板）。数は slideStats
  _onSlide(v, ev, x, y, z, vx, vz) {
    const SS = this.slideStats || (this.slideStats = { slides: 0, patches: 0, culled: 0, sparks: 0, pilots: 0 });
    const FC = this.config.fire || {}, SL = FC.slide || {};
    if (ev === 'start') {
      SS.slides++;
      v._crashBy = this._crashCause(v);
      if (this.vehicle === v && !this.player.dead) { SS.pilots++; this._playerHit((this.config.player.maxHealth || 100) * 100, { kind: 'crash' }); }
      return;
    }
    const C = this.crashes;
    if (!C) return;
    if (ev === 'patch') {
      const ops = this.city && this.city.carrierOps, ko = (FC.patch && FC.patch.keepOut) || 6;
      const pk = (FC.patch && FC.patch.jet) || {}, k = SL.trail || [0.7, 0.6, 0.6], life = pk.life || [35, 55];
      const r0 = (pk.r0 || 3) * k[0], r1 = (pk.r1 || 6) * k[1];
      if (ops && ops.jetSpots) for (const q of ops.jetSpots) { const qx = Array.isArray(q) ? q[0] : q.x, qz = Array.isArray(q) ? q[1] : q.z; if (Math.hypot(x - qx, z - qz) < ko + r1) { SS.culled++; return; } }
      C.addPatch(x, y, z, r0, r1, 0, (life[0] + Math.random() * (life[1] - life[0])) * k[2], v._crashBy == null ? null : v._crashBy, 'jet', 0);
      SS.patches++;
    } else if (ev === 'spark') {
      const sp = SL.sparkSpeed || [4, 10];
      SS.sparks += C.sparks(x, y, z, vx, vz, SL.sparks || 3, sp[0], sp[1]);
    }
  }
  // 誘爆（MR.Crashes の待ち行列から）: 小さな爆風 = explode の 'secondary'（見た目と secondary_pop は MR.Crashes。揺れは explode）。
  //   オンラインは explode がダメージを入れない（D10）。数は secondaryStats
  _onSecondary(x, y, z, r, dmg, kind) {
    const S = this.secondaryStats || (this.secondaryStats = { n: 0, hits: 0, last: null });
    S.n++;
    const o = this._secO || (this._secO = { noFx: true, silent: true });
    const n = this.explode(x, y, z, 0, 1, 0, 'secondary', null, null, o);
    S.hits += n || 0;
    S.last = { x, y, z, r, dmg, kind, hits: n || 0 };
  }
  // 地面の火（MR.Burn.Field）の目標: 敵・車（ヘリ・戦闘機は焼かない）・歩いているプレイヤー（乗っている人は乗り物が守る = D9）。ソロだけ
  _fireTargets(visit) {
    if (this.online) return;
    const t = this._fireT || (this._fireT = { obj: null, cls: '', x: 0, y: 0, z: 0 });
    for (const e of this.enemies) {
      if (e.dead) continue;
      t.obj = e; t.cls = 'soldier'; t.x = e.pos.x; t.y = e.pos.y; t.z = e.pos.z;
      visit(t);
    }
    for (const v of this.vehicles) {
      if (v.wrecked || v.sunk || v.netControlled || v.kind === 'heli' || v.kind === 'jet' || v.kind === 'vtol') continue; // 空の乗り物は地面の火で焼かない
      t.obj = v; t.cls = 'vehicle'; t.x = v.pos.x; t.y = v.pos.y; t.z = v.pos.z;
      visit(t);
    }
    const pl = this.player;
    if (pl && !pl.dead && !this.vehicle) {
      t.obj = pl; t.cls = 'player'; t.x = pl.pos.x; t.y = pl.pos.y; t.z = pl.pos.z;
      visit(t);
    }
  }
  // 地面の火のダメージ（fire.tick 秒ごと）: プレイヤーは _playerHit（kind 'fire' = 防具は効かない。痛い音と揺れは fire.hurtEvery 秒に 1 回）、
  //   敵は takeDamage、車は v.damage（vehicleDps。壊れたら _fireGen = 火の gen + 1 → その車の地面の火の段。gen ≥ chainMax の火は車を焼かない）
  _onFireHits(out, n) {
    if (this.online) return;
    const FS = this.fireStats || (this.fireStats = { player: 0, enemy: 0, vehicle: 0, kills: 0, chained: 0 });
    const ctx = this._vehicleCtx();
    const dir = this._fireDir || (this._fireDir = new THREE.Vector3(0, 1, 0));
    const every = (this.config.fire || {}).hurtEvery || 0.9;
    for (let i = 0; i < n; i++) {
      const e = out[i];
      if (e.cls === 'player') {
        if (e.target !== this.player || this.player.dead || this.vehicle) continue;
        const loud = this.time - (this._fireHurtT == null ? -1e9 : this._fireHurtT) >= every;
        if (loud) this._fireHurtT = this.time;
        FS.player += e.dmg;
        this._playerHit(e.dmg, { kind: 'fire', quiet: !loud });
      } else if (e.cls === 'soldier') {
        const en = e.target;
        if (en.dead) continue;
        dir.set(0, 1, 0);
        FS.enemy += e.dmg;
        if (en.takeDamage(e.dmg, dir)) { FS.kills++; if (e.by === 'self' || (e.by != null && e.by === this.player)) this._onKill(en, 'fire'); }
      } else if (e.cls === 'vehicle') {
        const v = e.target;
        if (v.wrecked || !v.damage) continue;
        FS.vehicle += e.dmg;
        v._fireGen = (e.gen || 0) + 1;
        v._fireBy = e.by == null ? null : e.by; // その車の火の by（_crashCause）
        v.damage(e.dmg, ctx);
        if (v.wrecked) FS.chained++; else { v._fireGen = 0; v._fireBy = null; }
      }
    }
  }
  // 墜落の点の面（MR.Burn.classify。_crashFx と場面 19 の F1）: y = 足元の高さ、yRef = 支えを探す高さ、cr = jet の crash（{ kind, box, y }）か null。
  //   戻り値は使い回しの info（surface・sy = 支えの高さ・sw = 水面・box = cr.box の写し（使い回し）か null）
  _burnClassify(x, y, z, yRef, cr) {
    const info = this._burnInfo || (this._burnInfo = { y: 0, support: null, ground: null, water: null, box: null, ny: null, deck: false, airAgl: 3, roofMin: 4, surface: '', sy: null, sw: null });
    const box = this._burnBox || (this._burnBox = [0, 0, 0, 0, 0, 0]);
    const FC = this.config.fire || {};
    const S = this._burnSupport(x, z, yRef);
    const g = this.city ? this.city.groundAt(x, z) : null;
    info.y = y; info.support = S.y; info.ground = g ? g.y : null; info.water = S.water;
    info.box = null; info.ny = null; info.airAgl = FC.airAgl || 3; info.roofMin = FC.roofMin || 4;
    if (cr && cr.box && cr.box.length >= 6) {
      for (let i = 0; i < 6; i++) box[i] = cr.box[i];
      info.box = box;
      if (cr.y != null) info.y = cr.y;
    }
    const ops = this.city && this.city.carrierOps;
    info.deck = !!(ops && x > ops.box.x0 && x < ops.box.x1 && z > ops.box.z0 && z < ops.box.z1 && Math.abs(y - ops.deckY) < 2);
    info.surface = cr && cr.kind === 'water' ? 'water' : MR.Burn.classify(info);
    info.sy = S.y; info.sw = S.water;
    return info;
  }
  // 足元の面（当たり判定を読んだチャンクは nav、ほかは HeliCollider）: { y | null, water | null }（使い回し）
  _burnSupport(x, z, yRef) {
    const r = this._bsR || (this._bsR = { y: null, water: null });
    r.y = null; r.water = null;
    const nav = this.world && this.world.nav, city = this.city;
    let gi = null;
    if (nav && city && nav.hasChunk) {
      const cc = city.chunkOf(x, z);
      if (nav.hasChunk(cc.cx + '_' + cc.cz)) gi = nav.groundInfo(x, z, yRef, 0.3);
    }
    if (!gi) { const coll = this._heliColl ? this._heliColl() : null; if (coll && coll.supportAt) gi = coll.supportAt(x, z, yRef, 0.45); }
    if (gi) { r.y = gi.y == null || !isFinite(gi.y) ? null : gi.y; r.water = gi.water == null ? null : gi.water; }
    else if (city) { const g = city.groundAt(x, z); r.y = g.water == null ? g.y : null; r.water = g.water; }
    return r;
  }
  // MR.Burn の world（1 回だけ作る）
  _burnWorld() {
    if (this._bw) return this._bw;
    const g = this;
    this._bw = {
      support(x, z, yRef) { return g._burnSupport(x, z, yRef).y; },
      water(x, z) { return g.city ? g.city.groundAt(x, z).water : null; }
    };
    return this._bw;
  }
  // 板の煙・爆発（街だけ。最初の爆発で作る = アリーナ・メニューは作らない）
  _puffsObj() {
    if (!this.puffs && this.isCity && MR.Puffs) this.puffs = new MR.Puffs(this.scene, this.config.puffs || {}, { assets: this.assets, mobile: !!(this.input && this.input.isTouchDevice) });
    return this.puffs || null;
  }
  _explodeFx(p, spec, water) {
    const s = spec.fx || 3;
    if (this.crashes) { this.crashes.blast(p.x, p.y, p.z, s, { water, silent: true, shake: false }); return; } // 街（E3.1）: 音と揺れは explode が
    const P = this._puffsObj();
    if (!P) { // アリーナ: 今まで通りの火花・煙のスプライト
      if (water && this.fx.splash) this.fx.splash(p, s, 'crash'); else if (this.fx.explosion) this.fx.explosion(p, s, 0.5);
      return;
    }
    const o = this._xo || (this._xo = {});
    const R = Math.random;
    if (water) {
      if (this.fx.splash) this.fx.splash(p, s, 'crash');
      // 湯気
      for (let i = 0, n = 3 + (R() * 2 | 0); i < n; i++) {
        Game._puffOpt(o, (R() - 0.5) * 2, 1.5 + R() * 1.5, (R() - 0.5) * 2, s * 0.5, 1.2, 0.8, 0.55, 0.92, 0.94, 0.96, 0);
        P.spawn('smoke', p.x + (R() - 0.5) * s, p.y + 0.3, p.z + (R() - 0.5) * s, s * 0.9, 3 + R() * 1.5, o);
      }
      return;
    }
    // 大きな火の玉 1 + 小さい 2〜4
    Game._puffOpt(o, 0, 0.6, 0, s * 0.25, 0, 0.6, 1, 1, 1, 1, R() * 6.28);
    P.spawn('explosion', p.x, p.y + s * 0.15, p.z, s * 2.4, 1.9 + R() * 0.3, o);
    for (let i = 0, n = 2 + (R() * 3 | 0); i < n; i++) {
      Game._puffOpt(o, (R() - 0.5) * s * 1.6, s * (0.3 + R() * 0.6), (R() - 0.5) * s * 1.6, s * 0.3, 0, 1.4, 1, 1, 1, 1, R() * 6.28);
      o.frame0 = R() * 4;
      P.spawn('explosion', p.x + (R() - 0.5) * s * 0.9, p.y + R() * s * 0.4, p.z + (R() - 0.5) * s * 0.9, s * (0.9 + R() * 0.5), 1.3 + R() * 0.5, o);
    }
    // 煙 4〜6（暗い灰色、上へ）
    for (let i = 0, n = 4 + (R() * 3 | 0); i < n; i++) {
      Game._puffOpt(o, (R() - 0.5) * s * 0.8, 1.2 + R() * 1.6, (R() - 0.5) * s * 0.8, s * 0.55, 0.35, 0.5, 0.75, 0.16, 0.15, 0.14, R() * 6.28);
      o.fadeIn = 0.35;
      P.spawn('smoke', p.x + (R() - 0.5) * s, p.y + s * 0.3 + R() * s * 0.5, p.z + (R() - 0.5) * s, s * 1.5, 4.5 + R() * 2, o);
    }
    if (this.fx.explosion) this.fx.explosion(p, s, 0.25); // 火花（約 15 個）
  }
  // spawn の o を詰める（使い回し）
  static _puffOpt(o, vx, vy, vz, grow, rise, drag, alpha, r, g, b, rot) {
    o.vx = vx; o.vy = vy; o.vz = vz; o.grow = grow; o.rise = rise; o.drag = drag; o.alpha = alpha;
    o.r = r; o.g = g; o.b = b; o.rot = rot; o.spin = (Math.random() - 0.5) * 0.6;
    o.frame0 = 0; o.fps = 0; o.loop = false; o.fadeIn = 0.06; o.fadeOut = null;
    return o;
  }
  // 機関砲の照準アシスト（かんたん）: ピパーの向き dir から gunAssist.cone° 以内・range m 以内の目標（乗り物・敵）へ向けた向き（無ければ null）
  _jetGunAssist(v, muzzle, dir, out) {
    const GA = v.def.gunAssist;
    if (!GA || !(GA.cone > 0)) return null;
    const cosC = Math.cos(GA.cone * Math.PI / 180);
    let best = null, bestCos = cosC;
    const tp = this._tmpV6 || (this._tmpV6 = new THREE.Vector3());
    const check = (t) => {
      MR.Missiles ? MR.Missiles.targetPos(t, tp) : tp.copy(t.pos);
      const dx = tp.x - muzzle.x, dy = tp.y - muzzle.y, dz = tp.z - muzzle.z, dist = Math.hypot(dx, dy, dz);
      if (dist < 20 || dist > GA.range) return;
      const cs = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
      if (cs > bestCos) { bestCos = cs; best = t; out.set(dx / dist, dy / dist, dz / dist); }
    };
    for (const e of this.enemies) if (!e.dead) check(e);
    for (const o of this.vehicles) if (o !== v && !o.wrecked && !o.sunk) check(o);
    return best ? out : null;
  }

  // 戦闘機に乗っている間のカメラ: 3 人称（見ている向きの後ろ上。壁の手前に寄る。速いほど引いて広角）/ 操縦席（機体に固定。HUD は機首の向き）
  _updateJetView(dt, v) {
    const P = this.player, cam = this.camera, d = v.def;
    const chase = !!this.jetChase;
    v.localInside = true;
    v.setCockpit(!chase);
    this._jetCamAssist(dt, v);
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = false;
    if (chase) {
      // かんたん: カメラは機体の飛ぶ向きの後ろ（なめらかに追う）+ 右側のスワイプで見回す（離すと戻る）
      if (this._jetEasy() && !(this.vehicleSeat > 0)) this._jetEasyCam(dt, v);
      // 手動の操縦: カメラは機体の後ろへゆっくり戻る（スワイプしている間は自由に見回せる）
      else if (this._jetManual()) {
        const lk = this.input.peekLook ? this.input.peekLook() : { x: 0, y: 0 };
        if (Math.abs(lk.x) + Math.abs(lk.y) > 0.5) this._jetLookT = this.time;
        if (this.time - (this._jetLookT || -9) > 1.2) {
          v.axes();
          const ty = Math.atan2(-v._fwd.x, -v._fwd.z), tp = Math.asin(THREE.MathUtils.clamp(v._fwd.y, -1, 1)) * 0.85 - 0.06;
          const k = Math.min(1, dt * 3);
          let dy = ty - P.yawAngle;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          P.yawAngle += dy * k; P.pitchAngle += (tp - P.pitchAngle) * k;
          P._apply();
        }
      }
      cam.rotation.set(0, 0, 0);
      P.yaw.rotation.set(0, P.yawAngle, 0);
      const pivot = v.center(this._tmpV2);
      pivot.y += 1.6;
      const D = (d.chaseDistance || 24) + v.speedRatio * (d.chaseSpeedDist || 10), H = d.chaseHeight == null ? 5 : d.chaseHeight;
      P.yaw.position.copy(pivot);
      const coll = this.heliCollider, margin = d.chaseHullMargin == null ? 1 : d.chaseHullMargin;
      // 機体が見えるかは 2 本の線で見る: 上（pivot = 重心 + 1.6 m）と胴（機体の原点 + 1.6 m = 胴の真ん中の高さ）。以前は上の線だけで、j_4 で
      //   見回しから戻る途中に上の線は艦橋の角の横を通り、胴（機体の前半）は艦橋の壁に隠れたフレームがあった（b13 の検証の j05）
      const body = v.toWorld ? v.toWorld(this._chaseBodyL || (this._chaseBodyL = new THREE.Vector3(0, 1.6, 0)), this._chaseBodyW || (this._chaseBodyW = new THREE.Vector3())) : null;
      // 点 q から (cx, cy, cz) までの線が壁・地面・水面で切れていれば、手前（1 m 前）までの割合（0.12〜1）
      const reach = (q, cx, cy, cz) => {
        const dx = cx - q.x, dy = cy - q.y, dz = cz - q.z, len = Math.hypot(dx, dy, dz) || 1;
        let t = len;
        const h = this.world.nav.raycast(q.x, q.y, q.z, dx / len, dy / len, dz / len, len, { water: true });
        if (h && h.t < t) t = h.t;
        if (coll) { const t2 = coll.raycast(q.x, q.y, q.z, dx / len, dy / len, dz / len, len); if (t2 !== null && t2 < t) t = t2; }
        return t >= len ? 1 : Math.max(0.12, Math.min(1, (t - 1.0) / len));
      };
      // pivot から (dx, dy, dz) の向き・割合 w のカメラ: 胴の線も切れなくなるまで pivot の方へ寄せる（3 回まで）
      const clearW = (dx, dy, dz, w) => {
        for (let i = 0; i < 3 && body && w > 0.12; i++) {
          const wb = reach(body, pivot.x + dx * w, pivot.y + dy * w, pivot.z + dz * w);
          if (wb >= 1) break;
          w = Math.max(0.12, w * wb);
        }
        return w;
      };
      // 後ろ (0, oy, oz)（視点の座標）へ置いたとき、壁・地面・水面の手前まで来られる割合 w（0.12〜1）と、そこが自分の機体の外か
      const probe = (oy, oz) => {
        cam.position.set(0, oy, oz);
        P.yaw.updateMatrixWorld(true);
        const cw = cam.getWorldPosition(this._tmpV3);
        const dx = cw.x - pivot.x, dy = cw.y - pivot.y, dz = cw.z - pivot.z, len = Math.hypot(dx, dy, dz) || 1;
        const w = clearW(dx, dy, dz, reach(pivot, cw.x, cw.y, cw.z));
        const cx = pivot.x + dx * w, cy = pivot.y + dy * w, cz = pivot.z + dz * w;
        const out = !(v.ownHullHas && v.ownHullHas(cx, cy, cz, margin));
        return { w, dist: len * w, out, x: cx, y: cy, z: cz };
      };
      // カメラの所から機体のすぐ後ろの甲板・地面（尾翼の 1.3 m 後ろ）が見えるか（間に艦橋の屋根などが無い = 画面の下の手前に壁がかぶらない）
      const tail = v.toWorld ? v.toWorld(this._chaseTailL || (this._chaseTailL = new THREE.Vector3(0, 0.3, -8)), this._chaseTailW || (this._chaseTailW = new THREE.Vector3())) : null;
      const sees = (r) => {
        if (!tail) return true;
        const ex = tail.x - r.x, ey = tail.y - r.y, ez = tail.z - r.z, L = Math.hypot(ex, ey, ez) || 1;
        const h = this.world.nav.raycast(r.x, r.y, r.z, ex / L, ey / L, ez / L, L, { water: true });
        if (h && h.t < L - 0.5) return false;
        if (coll) { const t2 = coll.raycast(r.x, r.y, r.z, ex / L, ey / L, ez / L, L); if (t2 !== null && t2 < L - 0.5) return false; }
        return true;
      };
      // カメラの真下に機体の足元より 2 m 以上高い物（艦橋の屋根・後ろの建物）がある = 壁の向こう・上に出ている（手前に屋根がかぶる）
      const over = (r) => {
        let top = -Infinity;
        const h = this.world.nav.raycast(r.x, r.y, r.z, 0, -1, 0, 60);
        if (h) top = r.y - h.t;
        if (coll) { const t2 = coll.raycast(r.x, r.y, r.z, 0, -1, 0, 60); if (t2 !== null) top = Math.max(top, r.y - t2); }
        return top > v.pos.y + 2;
      };
      const p0 = probe(H, D);
      let want = p0.w, liftT = 0, nearT = 1;
      // 地上で後ろがすぐ壁（艦橋の前の j_4 など）・寄せたカメラが自分の機体（尾翼）の中: 高くした所（chaseLift m 上）か、高くして近づけた所
      //   （真上に近い。距離 × chaseNear）へ（上から見下ろす）。自分の機体の外のものだけ、カメラから機体の後ろが見える → 真下が壁の上でない
      //   （艦橋の屋根が手前にかぶらない）ものが先、同じなら一番遠く引けるもの（2 m 以上遠くなるときだけ替える = 行ったり来たりしない）。以前は高くした所が
      //   ふさがっていると後ろの壁の手前 = 尾翼の中にカメラが入り、画面が灰色の板（尾翼と文字）になった
      if (v.mode === 'ground' && (want < 0.6 || !p0.out)) {
        const lift = v.def.chaseLift, nearK = d.chaseNear == null ? 0.3 : d.chaseNear;
        const score = (r) => (r.out ? (sees(r) ? 1000 : 0) + (over(r) ? 0 : 500) + r.dist : -1);
        let best = score(p0);
        for (const c of [{ lift, near: 1 }, { lift, near: nearK }]) {
          const r = probe(H + lift, D * c.near), sc = score(r);
          if (sc < 0 || sc < best + 2) continue;
          best = sc; want = r.w; liftT = c.lift; nearT = c.near;
        }
      }
      const kk = this._chaseK == null ? 1 : Math.min(1, dt * 3); // 乗った・視点を切り替えた最初のフレームはすぐその場所
      this._chaseLift = (this._chaseLift || 0) + (liftT - (this._chaseLift || 0)) * kk;
      this._chaseNear = (this._chaseNear == null ? 1 : this._chaseNear) + (nearT - (this._chaseNear == null ? 1 : this._chaseNear)) * kk;
      if (this._chaseK == null || want < this._chaseK) this._chaseK = want;
      else this._chaseK += (want - this._chaseK) * Math.min(1, dt * 2.5);
      const Hc = H + this._chaseLift, Dc = D * this._chaseNear;
      cam.position.set(P.shakeOffset.x, Hc * this._chaseK + P.shakeOffset.y, Dc * this._chaseK);
      // 寄せている途中（高さ・距離を目標へなめらかに動かす間、見回しから戻る間）も、今置いた所と機体の間に壁（艦橋など）があれば probe と同じく
      //   壁の手前まで寄せる（_chaseK を下げる = 次のフレームから今まで通りなめらかに引く）。以前は目標の所だけを確かめ、j_4 で見回しから戻る
      //   2〜3 フレーム、高さの途中のカメラが艦橋の後ろを通って機体が見えなかった
      //   上の線と胴の線の両方（probe と同じ clearW）
      {
        P.yaw.updateMatrixWorld(true);
        const cw = cam.getWorldPosition(this._tmpV3);
        const dx = cw.x - pivot.x, dy = cw.y - pivot.y, dz = cw.z - pivot.z, len = Math.hypot(dx, dy, dz);
        if (len > 2) {
          const w = clearW(dx, dy, dz, reach(pivot, cw.x, cw.y, cw.z));
          if (w < 1) {
            this._chaseK *= w;
            cam.position.set(P.shakeOffset.x, Hc * this._chaseK + P.shakeOffset.y, Dc * this._chaseK);
          }
        }
      }
      // 高くした・近づけた分だけ見下ろす（高くしただけなら 0.85 倍 = 少し前も見える、近づけた所は全部 = 機体がいつもの所に見える。
      //   0.85 倍のままだと真上に近い所では機体が画面の下の案内の板に隠れた）
      const look = Math.atan2(Hc, Dc) - Math.atan2(H, D), nearK0 = d.chaseNear == null ? 0.3 : d.chaseNear;
      if (look > 0.01) cam.rotation.x = -look * (0.85 + 0.15 * THREE.MathUtils.clamp((1 - this._chaseNear) / Math.max(0.01, 1 - nearK0), 0, 1));
      // 最後の確かめ: 動いている途中（なめらかに寄せる間）でも自分の機体の中には置かない（外に出るまで上げる）
      if (v.ownHullHas) {
        P.yaw.updateMatrixWorld(true);
        const cw = cam.getWorldPosition(this._tmpV3);
        let up = 0;
        while (up < 12 && v.ownHullHas(cw.x, cw.y + up, cw.z, margin)) up += 0.25;
        if (up > 0) { P.yaw.position.y += up; this._chaseRaised = (this._chaseRaised || 0) + 1; }
      }
    } else {
      // 操縦席: 目の位置で機体と一緒に回る（カメラは -Z を向くので Y で 180° 回す）
      P.yaw.position.copy(v.seatWorld(this.vehicleSeat || 0, this._tmpV1));
      const q = this._jetCamQ || (this._jetCamQ = new THREE.Quaternion());
      const flip = this._jetFlipQ || (this._jetFlipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      q.copy(v.quat).multiply(flip);
      P.yaw.quaternion.copy(q);
      P.pitch.rotation.set(0, 0, 0);
      cam.position.set(P.shakeOffset.x * 0.3, P.shakeOffset.y * 0.3, 0);
      cam.rotation.set(0, 0, 0);
    }
    v.listenerPos = cam.getWorldPosition(this._jetEar || (this._jetEar = new THREE.Vector3()));
  }

  // 見ている向き（= 操縦の目標）を寄せる（見た方へ飛ぶ操縦。右側をスワイプしている間・その 0.6 秒後までは寄せない）:
  //   カタパルトにつながった・発艦した → カタパルトの向きで上へ（_jetCamGoal）、離陸の直後の上昇・地図の端・地面の近くで
  //   FCS が目標を置き換えた（v.aimAssist）→ そちらへ。カメラを離した後に元の（外・下の）向きへ戻って飛んでいかない
  _jetCamAssist(dt, v) {
    const P = this.player;
    if (this._jetManual() || this._jetEasy() || this.vehicleSeat > 0) return;
    const CA = v.def.camAssist;
    if (this.time - (this._jetSwipeT == null ? -9 : this._jetSwipeT) < CA.swipePause) { this._jetCamGoal = null; return; }
    const g = this._jetCamGoal;
    let ty, tp, rate;
    if (v.groundAvoid) this._jetAvoidT = this.time;
    if (g && this.time < g.until) { ty = g.yaw; tp = g.pitch; rate = CA.goalRate; }
    else if (v.aimAssist) { const a = v.aimAssist; ty = Math.atan2(-a.x, -a.z); tp = Math.asin(THREE.MathUtils.clamp(a.y, -1, 1)); rate = CA.followRate; }
    else if (this.time - (this._jetAvoidT == null ? -99 : this._jetAvoidT) < CA.levelAfter && P.pitchAngle > CA.levelPitch * Math.PI / 180) {
      // 地面・建物を避けて上を向かせた後（スワイプしていない）: 見ている向きを水平の少し上（levelPitch°）へ戻す（上り続けて何千 m も上がらない）
      ty = P.yawAngle; tp = CA.levelPitch * Math.PI / 180; rate = CA.followRate;
    } else return;
    const k = 1 - Math.exp(-dt * rate);
    let dy = ty - P.yawAngle;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    P.yawAngle += dy * k; P.pitchAngle += (tp - P.pitchAngle) * k;
    P._apply();
  }
  // かんたんの 3 人称カメラ: 基準 = 機体の飛ぶ向き（地上・遅いときは機首）を easy.camRate /s で追い、1 秒に camMaxRate° までしか回さない
  //   （200 G の急旋回でも画面が振り回されない。機体は軸の中心なので画面の真ん中に見えたまま）。上下は経路角 × camPitchK + camPitch°。
  //   右側のスワイプは基準からのずれ（見回す）。スワイプをやめて lookDelay 秒たつと lookReturn /s で基準へ戻る
  _jetEasyCam(dt, v) {
    const P = this.player, EC = v.def.easyCam || {};
    v.axes();
    const air = v.mode === 'air' && v.speed > 20;
    const dx = air ? v.vel.x : v._fwd.x, dy = air ? v.vel.y : 0, dz = air ? v.vel.z : v._fwd.z;
    const hl = Math.hypot(dx, dz) || 1;
    const by = Math.atan2(-dx, -dz), bp = Math.atan2(dy, hl) * (EC.pitchK == null ? 0.6 : EC.pitchK) + (EC.pitch == null ? -4 : EC.pitch) * Math.PI / 180;
    let S = this._jetEasyCamS;
    if (!S || S.v !== v) S = this._jetEasyCamS = { v, yaw: by, pitch: bp, offY: 0, offP: 0, lastY: by, lastP: bp };
    const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    // スワイプ（player.updateSeated が足した分）= 基準からのずれ
    S.offY = wrapA(S.offY + wrapA(P.yawAngle - S.lastY)); S.offP += P.pitchAngle - S.lastP;
    if (this.time - (this._jetSwipeT == null ? -9 : this._jetSwipeT) > (EC.lookDelay == null ? 1.2 : EC.lookDelay)) {
      const k = 1 - Math.exp(-dt * (EC.lookReturn == null ? 1.5 : EC.lookReturn));
      S.offY -= S.offY * k; S.offP -= S.offP * k;
    }
    S.offP = THREE.MathUtils.clamp(S.offP, -1.2, 1.2);
    const kr = 1 - Math.exp(-dt * (EC.rate == null ? 3 : EC.rate)), mx = (EC.maxRate == null ? 160 : EC.maxRate) * Math.PI / 180 * dt;
    S.yaw = wrapA(S.yaw + THREE.MathUtils.clamp(wrapA(by - S.yaw) * kr, -mx, mx));
    S.pitch += THREE.MathUtils.clamp((bp - S.pitch) * kr, -mx, mx);
    P.yawAngle = wrapA(S.yaw + S.offY);
    P.pitchAngle = THREE.MathUtils.clamp(S.pitch + S.offP, -1.4, 1.4);
    S.lastY = P.yawAngle; S.lastP = P.pitchAngle;
    P._apply();
  }
  _jetCamTo(yawDeg, pitchDeg, sec) {
    const a = yawDeg * Math.PI / 180;
    this._jetCamGoal = { yaw: Math.atan2(-Math.sin(a), -Math.cos(a)), pitch: pitchDeg * Math.PI / 180, until: this.time + sec };
  }

  // カメラを人のものに戻す（戦闘機から降りた・射出した）
  _resetSeatCamera() {
    const P = this.player;
    this.camera.position.set(0, 0, 0); this.camera.rotation.set(0, 0, 0);
    P.yaw.rotation.set(0, P.yawAngle, 0);
    P.pitch.rotation.set(P.pitchAngle, 0, 0);
    this._chaseK = null;
  }

  // 戦闘機から降りる（地上で止まっているとき: 座席の出口 → 他の出口 → 周り）。dead: 墜落で死んだ（その場に置くだけ）
  _exitJet(v, silent, dead) {
    const p = this.player;
    const seat = Math.max(0, v.seatOf(p));
    v.localInside = false; v.listenerPos = null; v.setCockpit(false);
    this.vehicle = null; this.vehicleSeat = 0;
    this._resetSeatCamera();
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = true;
    if (dead) {
      const c = v.center(this._tmpV1);
      p.pos.set(c.x, c.y - p.eyeHeight, c.z);
      p._apply();
    } else {
      const e = v.findExit(seat, this.world.nav, p.radius);
      this.placePlayer(e.x, e.z, e.y == null ? v.pos.y + 1 : e.y + 0.3, THREE.MathUtils.radToDeg(p.yawAngle));
    }
    v.exit(p);
    this._jetLeft(v);
  }
  _jetLeft(v) {
    if (this._gunSnd) { try { this._gunSnd.stop(0.02); } catch (e) { /* ignore */ } this._gunSnd = null; }
    this._gunAcc = 0; this._gunSndT = 0;
    if (v) { v.firing = false; if (v.abLight === this.abLight) v.attachAbLight(null); }
    if (this.abLight) this.abLight.intensity = 0;
    if (this.hud.setVehicle) this.hud.setVehicle(null);
    if (this.hud.setJet) this.hud.setJet(null);
    if (this.jetHud) this.jetHud.show(false);
    this._ejectArm = 0;
  }

  // 射出: キャノピーが飛び、座席ごと上へ → パラシュート（royale.fall の設定。地面から chuteHeight m 以下ならすぐ開く）。機体は無人で飛び続けて墜ちる
  _ejectJet(v) {
    const p = this.player;
    const seat = v.seatWorld(Math.max(0, v.seatOf(p)), this._tmpV1).clone();
    const vel = v.vel.clone();
    v.eject(this.fx);
    v.localInside = false; v.listenerPos = null; v.setCockpit(false);
    this.vehicle = null; this.vehicleSeat = 0;
    this._resetSeatCamera();
    this._jetLeft(v);
    p.pos.set(seat.x, seat.y - p.eyeHeight + 1.2, seat.z);
    p.state = 'walk'; p.ladder = null; p._vault = null;
    const h = Math.hypot(vel.x, vel.z), cap = v.def.ejectMaxHorizontal == null ? 40 : v.def.ejectMaxHorizontal, k = h > cap ? cap / h : 1;
    const fc = Object.assign({}, (this.config.royale || {}).fall || {});
    p.startFall(vel.x * k, vel.z * k, fc, (x, z) => (this.city && typeof this.city.supportHeightAt === 'function' ? this.city.supportHeightAt(x, z) : 0));
    const vyMax = v.def.ejectMaxVy == null ? 10 : v.def.ejectMaxVy;
    p.vy = Math.max(-vyMax, Math.min(vyMax, vel.y)) + (v.def.ejectSpeed || 20);
    p._apply();
    this._wasGrounded = false;
    if (this._lastStepPos) this._lastStepPos.copy(p.pos);
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = false;
    this.shake = Math.min(2, this.shake + 1.0);
    this.hud.showMessage('脱出', 1200);
    this.jetEjections = (this.jetEjections || 0) + 1;
  }

  // 戦闘機の出来事（カタパルト・着艦・補給・墜落…）→ 案内・揺れ
  _jetEvents(v) {
    const ev = v.events;
    if (!ev.length) return;
    for (const e of ev) {
      switch (e.t) {
        case 'cat_hook': this.hud.showMessage('カタパルト接続', 1200); this._jetCamTo(e.yaw, v.def.climb.pitch, v.def.camAssist.hookTime); break;
        case 'cat_unhook': this.hud.showMessage(e.why === 'bump' ? 'ぶつかってカタパルトが外れました' : 'カタパルト解除', 1500); break;
        case 'cat_launch': this.shake = Math.min(1.5, this.shake + 0.8); break;
        case 'cat_end': this.hud.showMessage('発艦', 900); this._jetCamTo(e.yaw, v.def.climb.pitch, v.def.camAssist.launchTime); this._jetClimbHintT = this.time + v.def.hud.climbHintTime; break;
        case 'auto_start': if (e.src === 'capture') this.hud.showMessage('カタパルトへ誘導します', 1200); else if (e.src === 'tow') this.hud.showMessage('牽引車でカタパルトの後ろへ移しました', 1600); else if (e.back) this.hud.showMessage('後ろへ下がってからカタパルトへ', 1400); break;
        case 'auto_cancel': this.hud.showMessage('自動走行を止めました', 1000); break;
        case 'deck_blocked': this.hud.showMessage('カタパルトへの通路がふさがっています', 1600); break;
        case 'deck_busy': this.hud.showMessage(e.why === 'deck' ? '甲板員が ほかの機体を移しています — 待ちます' : e.wait ? 'カタパルトが空くのを待ちます' : 'カタパルトに ほかの機体がいます', 1600); break;
        case 'deck_edge': this.hud.showMessage(e.back ? '後ろは甲板の端 — 止まります' : '甲板の端 — 止まります', 1200); break;
        case 'deck_obstacle': this.hud.showMessage('ぶつかるので止まります', 1200); break;
        case 'deck_none': this.hud.showMessage('発艦ボタンは空母の甲板で使えます', 1400); break;
        case 'arrest': this.hud.showMessage('着艦 ' + e.wire + ' 番ワイヤー', 1600); this.shake = Math.min(1.5, this.shake + 0.9); break;
        case 'bolter': this.hud.showMessage('ボルター！ 全開で上がれ', 1600); break;
        case 'rearm': this.hud.showMessage('弾薬補給', 1200); break;
        case 'gear_locked': this.hud.showMessage('地上では脚を上げられません', 1200); break;
        case 'touchdown': this.shake = Math.min(1.2, this.shake + Math.min(0.8, (e.sink || 0) * 0.15)); break;
        case 'autoland': this.hud.showMessage(e.kind === 'carrier' ? '自動着艦を始めます' : '自動着陸を始めます（' + e.name + '）', 1400); break;
        case 'autoland_off': { const w = e.kind === 'road' ? '自動着陸' : '自動着艦'; this.hud.showMessage(e.why === 'stick' ? w + 'を解除しました（スティック）' : e.why === 'fail' ? w + 'できませんでした — 自分で操縦してください' : w + 'を解除しました', e.why === 'fail' ? 2500 : 1300); break; }
        case 'autoland_done': this.hud.showMessage(e.kind === 'carrier' ? '着艦しました' : '着陸しました', 1500); break;
        case 'autoland_none': this.hud.showMessage('近くに降りられる所がありません', 1300); break;
        case 'autoland_retry': this.hud.showMessage(e.why === 'foul' ? '甲板に機体があります — やり直し' : '進入をやり直します', e.why === 'foul' ? 2000 : 1200); break;
        default: break;
      }
    }
    ev.length = 0;
  }

  // HUD（jethud.js）の中身: 照準・着艦の誘導・警告・案内。_render でカメラが決まってから描く
  _drawJetHud() {
    const v = this.vehicle;
    if (!v || v.kind !== 'jet' || !this.jetHud) return;
    const d = v.def, ops = this.city && this.city.carrierOps;
    const info = this._jetHudInfo || (this._jetHudInfo = {});
    info.jet = v; info.camera = this.camera; info.chase = !!this.jetChase;
    const scheme = this._jetScheme();
    info.scheme = scheme;
    info.aim = scheme === 'aim' ? this._aimDir(this._jetAimV || (this._jetAimV = new THREE.Vector3())) : null;
    // ロック（四角）・ミサイル・フレアの数・向かってくるミサイル・G（色と画面の端）
    const L = this._jetLock;
    info.lock = null;
    if (L && MR.Missiles && MR.Missiles.alive(L.target)) {
      const lk = this._jetLockI || (this._jetLockI = { point: new THREE.Vector3() });
      MR.Missiles.targetPos(L.target, lk.point); lk.locked = !!L.locked; lk.k = Math.min(1, L.t / Math.max(0.01, d.missile.lockTime)); lk.dist = L.dist;
      info.lock = lk;
    }
    info.missiles = v.missileCount; info.missileTypes = v.missileCounts ? v.missileCounts() : null; info.flares = v.flareCount; info.incoming = v.incoming || null;
    info.rwr = this.rwr && this.rwr.st > 0 ? this.rwr : null; // RWR の印（方位の輪。jethud が lastBoxes.rwr に置く）
    // 滑空爆弾（E2.5。AirCombat の g.bombCue）: 右の列の「GBU n」と、落とせる範囲のときだけ落ちる所の印（ok / point）
    info.bomb = this.bombCue && this.vehicle === v && !this.online ? this.bombCue : null;
    info.gfx = this._gFx || 0;
    info.gunPoint = this._jetGunPoint(v, this._jetGunP || (this._jetGunP = new THREE.Vector3()));
    info.firing = !!v.firing; info.ammo = v.ammo;
    const wy = this.city && this.city.waterY != null ? this.city.waterY : -2;
    info.asl = v.p.y - wy; info.agl = v.mode === 'air' ? Math.max(0, v.pos.y - v.groundY) : 0;
    // 着艦の誘導（脚を下ろして空母に近づいている）
    info.approach = null;
    const ac = d.approach || {};
    if (ops && v.mode === 'air' && v.gearDown) {
      const L = ops.landing;
      const rx = v.pos.x - L.x, rz = v.pos.z - L.z;
      const along = rx * L.fx + rz * L.fz, lat = rx * L.rx + rz * L.rz;
      const dist = -along;
      if (dist > -20 && dist < (ac.range || 4000)) {
        const want = ops.deckY + Math.tan((ac.glideSlope || 3.5) * Math.PI / 180) * Math.max(0, dist);
        const a = this._jetAppr || (this._jetAppr = { point: new THREE.Vector3() });
        a.dist = Math.max(0, dist); a.dev = v.pos.y - want; a.lat = -lat; a.auto = !!v.autoland;
        a.point.set(L.x, ops.deckY, L.z);
        info.approach = a;
      }
    }
    // 警告と案内（かんたん: 地面・建物を自動で避けている間は「危険」、地図の端は案内の文字）
    let warn = '';
    const easy = scheme === 'easy';
    if (easy && v.mode === 'air' && (v.groundAvoid || v.pullUp)) warn = '危険';
    else if (v.incoming && v.mode === 'air' && (v.incoming.tti < 6 || v.incoming.dist < 2500)) warn = Game.MSL_WARN[(MR.AirCombat ? MR.AirCombat.clock(v.incoming.bearing) : 12) % 12]; // 「ミサイル接近 ◯時」（文字列を毎フレーム作らない）
    else if (v.pullUp) warn = '引き起こせ';
    else if (v.deckFoul && v.mode === 'air') warn = '甲板に機体があります';
    else if (v.stall && v.mode === 'air') warn = '失速';
    else if (v.outOfBounds && !easy) warn = '戻れ';
    else if (v.mode === 'air' && v.gearPos < 0.05 && v.vel.y < -1 && info.agl < 120 && v.speed < 110) warn = '脚';
    info.warn = warn;
    info.prompt = this._jetPrompt(v);
    // 初めて乗ったときの説明（1 回だけ、10 秒か発艦まで）
    // かんたん: 甲板の説明（初めて乗ったとき）と、空で初めて自分で飛ぶときの説明（mirrsona.jetEasyTut。hud.tutorialTime 秒）
    if (easy && v.mode === 'air' && !v._prot && !v.autoland && !this._jetEasyTutDone) {
      this._jetEasyTutDone = true;
      if (Game._loadPref('jetEasyTut') !== '1') { this._jetEasyTutUntil = this.time + d.hud.tutorialTime; Game._savePref('jetEasyTut', '1'); }
    }
    const deckHint = this.time < (this._jetTutUntil || 0) && v.mode === 'ground' && !(v.cat && v.cat.ph !== 'align' && v.cat.ph !== 'ready');
    if (easy) info.hint = deckHint ? ['「発艦」をタップ（または左スティックを上へ）→ 自動で発艦', '空では 左スティックで行きたい方向へ・離すと水平に戻ります']
      : (this.time < (this._jetEasyTutUntil || 0) && v.mode === 'air' ? ['左スティックで行きたい方向へ', '離すと水平に戻ります', '加速・減速は右のボタン・空母の近くで「着艦」'] : null);
    else info.hint = deckHint
      ? (this._jetManual() ? null : ['左スティック: 上＝推力・下＝ブレーキ（止まって続けると後退）・横＝前輪', '甲板では「発艦」か スティック上 で自動でカタパルトへ → 発艦', '右側をスワイプ: 見た方へ飛ぶ（発艦の後は自動で上昇）'])
      : null;
    this.jetHud.draw(info);
  }

  // 案内（HUD の下の黄色い文字。\n で 2 行目は小さく）: 始動・甲板（自動でカタパルトへ・距離）・カタパルト・発艦の後・補給・脱出
  _jetPrompt(v) {
    const d = v.def, manual = this._jetManual();
    const starting = v.engineOn && v.spin < 1 && v.mode === 'ground';
    const C = v.cat, A = v._auto, R = v.deckRoute;
    const go = manual ? '推力＋' : 'スティック上';
    if (C) {
      if (C.ph === 'align') return 'カタパルト接続中';
      if (C.ph === 'ready') return C.auto ? '発艦準備…（全開）' : (manual ? '発艦: 「発艦」か 推力＋' : '発艦: 「発艦」か 左スティックを上へ') + '\n外す: スティックを下へ ' + d.deck.unhookHold + ' 秒';
      return '発艦！';
    }
    if (v.arrest) return '着艦ワイヤー';
    if (A) {
      if (A.stopping) return '止まります\nスティックを離してから ' + go + ' でまた自動';
      const back = A.pre && !A.pre.done, fwd = A.fwd && !A.fwd.done;
      return (fwd ? (back ? '少し前へ出て 後ろへ下がってから カタパルト ' : '少し前へ出てから カタパルト ') : back ? '後ろへ下がってから カタパルト ' : 'カタパルト ') + A.route.cat.id + ' へ自動走行  あと ' + Math.round(A.rem) + ' m\n' + (starting ? 'エンジン始動中…  ' : '') + 'スティックを下・横へ倒すと中止';
    }
    if (v.mode === 'ground' && v.onDeck && !v.bolter && v.speed < 13) {
      const head = (starting ? 'エンジン始動中…  ' : '');
      if (v.deckWait && v.deckWaitWhy === 'deck') return '誘導路に ほかの機体 — 甲板員が移しています\n' + head + '空いたら自動で発艦・下へ倒すと取り消し';
      if (v.deckWait) return 'カタパルトに ほかの機体がいます\n' + head + '空いたら自動で発艦・下へ倒すと取り消し';
      if (v.deckBusy) return 'カタパルトに ほかの機体がいます\n' + head + '「発艦」か ' + go + ' で 空いたら自動発艦';
      if (v.edgeStop) return (v.stopWhy === 'edge' ? '甲板の端 — 止まります' : 'ぶつかるので止まります') + '\n「発艦」か ' + go + ' で自動・下を続けると後退';
      if (!R) return '「発艦」か ' + go + ' で自動発艦\n' + head + '（後ろへ下がってからカタパルトへ）';
      const c = R.cat, dx = c.x - v.pos.x, dz = c.z - v.pos.z, P = this.player;
      const rel = Math.atan2(dx, dz) - Math.atan2(-Math.sin(P.yawAngle), -Math.cos(P.yawAngle));
      const a = Math.atan2(Math.sin(rel), Math.cos(rel));
      const arrow = Math.abs(a) < Math.PI / 4 ? '▲' : (Math.abs(a) > Math.PI * 3 / 4 ? '▼' : (a > 0 ? '◀' : '▶'));
      return '「発艦」か ' + go + ' で自動発艦\n' + head + 'カタパルト ' + c.id + ' ' + arrow + ' ' + Math.round(Math.hypot(dx, dz)) + ' m';
    }
    // 甲板の外の地上（道路に降りた後など）: 離陸のしかた
    if (v.mode === 'ground' && !v.onDeck && !v.arrest && !v.bolter && !v.autoland) {
      if (v._roadGo) return '離陸滑走中…（自動で機首上げ）\nスティックを下へ倒すと中止';
      if (v.speed < 13) {
        const ez = this._jetEasy();
        return (ez ? '「離陸」か「加速」で離陸' : '「離陸」か ' + go + ' で離陸') + '\n' + (starting ? 'エンジン始動中…  ' : '') + (manual ? '速くなったらスティック上で機首上げ' : (ez ? '左スティックの横で前輪' : '右側をスワイプ: 走る向き'));
      }
    }
    if (starting) return 'エンジン始動中…';
    if (v.onDeck && v.mode === 'ground' && v.speed < 1 && v.ammo < d.gun.ammo) return '弾薬補給中';
    if (this._ejectArm > this.time) return 'もう一度押すと脱出';
    const easy = this._jetEasy();
    if (v.autoland) {
      const ap = v.autoland, what = ap.kind === 'carrier' ? '自動着艦' : '自動着陸（' + ap.strip.name + '）';
      const ph = { out: '進入の始まりへ', intercept: '進入路へ', final: '最終進入', rollout: '接地', bolter: 'ボルター — やり直し', go: 'やり直し — 上昇中' }[ap.phase] || '';
      const dist = ap.dist != null && ap.phase !== 'out' ? '  あと ' + (ap.dist >= 1000 ? (ap.dist / 1000).toFixed(1) + ' km' : Math.round(Math.max(0, ap.dist)) + ' m') : '';
      return what + '中  ' + ph + dist + '\n左スティックを倒すと解除';
    }
    if (v.mode === 'air' && this.time < (this._jetClimbHintT || 0)) return easy ? '自動で上昇中\n左スティックで行きたい方向へ' : '自動で上昇中\n右側をスワイプして行きたい方を見る';
    if (easy && v.mode === 'air' && v.outOfBounds) return 'マップの端 — 自動で引き返します';
    if (easy && v.mode === 'air' && v.groundAvoid) return '地面・建物を自動でよけています';
    return '';
  }

  // カタパルトへの目印（甲板の上: 誘導路の線・カタパルトの始点の輪と矢印）。操縦席で甲板にいて、つながっていないとき。
  //   材質は 1 つ（加算でない半透明・霧なし）、メッシュ 3 つ（線は点の列を書き換える）
  _updateCatMarker(jv) {
    const show = !!jv && !(this.vehicleSeat > 0) && jv.mode === 'ground' && jv.onDeck && !jv.cat && !jv.arrest && !!jv.deckRoute && !this.player.dead;
    let M = this._catMarker;
    if (!show) { if (M) M.group.visible = false; return; }
    const ops = this.city && this.city.carrierOps;
    if (!ops) return;
    if (!M) {
      const mat = new THREE.MeshBasicMaterial({ color: MR.srgb('#ffcf4a'), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const group = new THREE.Group();
      group.name = 'cat_marker';
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 40), mat);
      ring.rotation.x = -Math.PI / 2;
      // 矢印（シェブロン 3 つ。前 = +Z）
      const pos = [];
      for (let k = 0; k < 3; k++) {
        const z0 = 4 + k * 3.2;
        pos.push(-1.6, 0, z0, 0, 0, z0 + 1.6, 0, 0, z0 + 0.8, -1.6, 0, z0, 0, 0, z0 + 0.8, -1.6, 0, z0 - 0.8);
        pos.push(1.6, 0, z0, 0, 0, z0 + 0.8, 0, 0, z0 + 1.6, 1.6, 0, z0, 1.6, 0, z0 - 0.8, 0, 0, z0 + 0.8);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const chev = new THREE.Mesh(cg, mat);
      const head = new THREE.Group();
      head.add(ring, chev);
      // 誘導路の線（幅 0.5 m の帯。点は最大 64）
      const N = 64, lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      lg.setIndex(idx);
      const line = new THREE.Mesh(lg, mat);
      line.frustumCulled = false;
      group.add(head, line);
      for (const m of [ring, chev, line]) { m.renderOrder = 2; m.castShadow = false; m.receiveShadow = false; }
      this.scene.add(group);
      M = this._catMarker = { group, head, line, N, route: null, mat };
    }
    M.group.visible = true;
    const R = jv.deckRoute, c = R.cat, y = ops.deckY + 0.06;
    M.head.position.set(c.x, y, c.z);
    M.head.rotation.y = c.yaw * Math.PI / 180;
    M.mat.opacity = 0.65 + 0.3 * Math.abs(Math.sin(this.time * 3));
    if (M.route !== R) {
      M.route = R;
      // 経路を 3 m ごとに区切って帯にする（最初は機体の位置から）
      const pts = [];
      const tmp = new THREE.Vector3();
      for (let s = 0; s <= R.len && pts.length < M.N; s += Math.max(3, R.len / (M.N - 1))) { jv._routeAt(R, s, tmp); pts.push(tmp.x, tmp.z); }
      jv._routeAt(R, R.len, tmp);
      if (pts.length < M.N * 2) pts.push(tmp.x, tmp.z);
      const n = pts.length / 2, arr = M.line.geometry.attributes.position.array;
      for (let i = 0; i < n; i++) {
        const x = pts[i * 2], z = pts[i * 2 + 1];
        const j = Math.min(n - 1, i + 1), h = Math.max(0, i - 1);
        let dx = pts[j * 2] - pts[h * 2], dz = pts[j * 2 + 1] - pts[h * 2 + 1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        arr.set([x - dz * 0.45, y, z + dx * 0.45, x + dz * 0.45, y, z - dx * 0.45], i * 6);
      }
      M.line.geometry.attributes.position.needsUpdate = true;
      M.line.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    }
  }

  // ヘリから降りる: 地上（低い）なら座席の出口（空いていなければ他の出口・周り）。空中ならドアの外へ、ヘリの速さのまま落ちる
  // （落下ダメージは C1 の規則: 一番高かった所 = 降りた所から着地点まで）。ヘリは自分で降りる
  _exitHeli(v, silent) {
    const p = this.player;
    const seat = Math.max(0, v.seatOf(p));
    const low = v.grounded || v.agl < 2.5;
    // オンライン: 操縦士は最後の位置を送ってから降りる（同じ束で exit の前に）
    if (this.cityOnline && !silent && seat === 0) this.net.queue(this._vstateCity(v));
    const hSpeed = Math.hypot(v.vel.x, v.vel.z);
    v.localInside = false; v.listenerPos = null; v.setCockpit(false);
    this.vehicle = null; this.vehicleSeat = 0;
    this.camera.position.set(0, 0, 0); this.camera.rotation.z = 0;
    this._chaseK = null;
    if (this.viewRoot && !this.freeCam) this.viewRoot.visible = true;
    const deck = low && this.cityBoats ? this.cityBoats.heliDeckExit(v, seat) : null; // 動く船の甲板に降りているヘリ（boats M3）
    if (deck) this.cityBoats.standOnDeck(deck);
    else if (low) {
      const e = v.findExit(seat, this.world.nav, p.radius);
      this.placePlayer(e.x, e.z, e.y == null ? v.pos.y + 1 : e.y + 0.3, THREE.MathUtils.radToDeg(p.yawAngle));
    } else {
      const ex = v.exitWorld(seat, this._tmpV1);
      p.pos.set(ex.x, ex.y + 0.3, ex.z);
      const q = this.world.nav.resolveCapsule(p.pos, p.radius, 1.8, 0.45, { snapDown: 0, air: true });
      p.pos.x = q.x; p.pos.z = q.z;
      p.state = 'walk'; p.grounded = false; p.ladder = null; p._vault = null;
      p.vy = v.vel.y; p.vel.x = v.vel.x; p.vel.z = v.vel.z;
      // オンライン: サーバーの移動の予算（歩きの速さ）を超えないよう、持ち出す横の速さは 10 m/s まで
      if (this.online) { const h = Math.hypot(p.vel.x, p.vel.z); if (h > 10) { p.vel.x *= 10 / h; p.vel.z *= 10 / h; } p.vy = Math.min(p.vy, 3); }
      p.peakY = p.pos.y; p.airTime = 1; p._jumped = true; p.eyeOffset = 0;
      p._apply();
      this._wasGrounded = false;
      if (this._lastStepPos) this._lastStepPos.copy(p.pos);
    }
    v.exit(p);
    if (this.hud.setVehicle) this.hud.setVehicle(null);
    if (this.hud.setHeli) this.hud.setHeli(null);
    if (this.hud.setRwr) this.hud.setRwr(null);
    if (this.cityOnline) this._sendExitCity(v, silent, low ? 0 : Math.min(30, hSpeed / Math.max(0.5, (this.config.player || {}).airControl || 2.5) + 2));
  }

  // 街のオンライン: 降りた位置（足元 [x, y, z]）をサーバーへ。空中のヘリからは飛び降り（momentum: サーバーが足す移動の予算）
  _sendExitCity(v, silent, momentum) {
    const P = MR.NetProto, p = this.player;
    if (!silent) {
      this.net.send({ t: 'exit', i: v.netIndex, p: P.qv([p.pos.x, p.pos.y, p.pos.z]), yaw: P.qa(p.yawAngle) });
      this._exitResentAt = this.time;
      this._exitSeq = (this.net._seq || 0) + 1; // この後の最初の state の番号（サーバーがそれを処理していれば exit も処理済み）
    }
    this._netResetMove();
    if (momentum > 0) this._netGuardBonus = (this._netGuardBonus || 0) + momentum;
  }

  // 街のオンライン: 運転席・操縦席の vstate（3D。ヘリは回転数・上下の入力も）
  _vstateCity(v) {
    const P = MR.NetProto;
    const heli = v.kind === 'heli';
    const sp = heli ? Math.hypot(v.vel.x, v.vel.z) : v.speed;
    const m = { t: 'vstate', i: v.netIndex, p: P.qv([v.pos.x, v.pos.y, v.pos.z]), yaw: P.qa(v.yaw), sp: P.q(sp), st: P.qa(heli ? 0 : v.steer), pitch: P.qa(v.pitch || 0), roll: P.qa(v.roll || 0) };
    if (heli) { m.rpm = P.q(v.rotor); m.col = P.q(v.ctl.climb); m.vy = P.q(v.vel.y); } else m.vy = P.q(v.vy || 0);
    return m;
  }

  // 行で動いていたヘリを自分で操縦し始める（操縦席に座った・移った）: 回転数・接地はそのまま続ける
  _takeHeliControl(v) {
    v.spin = Math.max(v.spin || 0, v.rotor || 0);
    if (v.rotor > 0.02) v.engineOn = true;
    v.autoT = 0;
    if (typeof v.agl === 'number') { v.grounded = v.agl < 0.2; v.airborne = !v.grounded; }
  }

  // 街のオンライン: サーバーが同じ乗り物の別の席に移した（vseat）
  _changeSeat(seat) {
    const v = this.vehicle;
    if (!v) return;
    const from = this.vehicleSeat || 0;
    if (from === seat) return;
    if (from === 0) { v.clearDriver(); if (this.headlight && v.detachHeadlight()) { this.scene.add(this.headlight); this.scene.add(this.headlight.target); } }
    else v.occupants[from] = null;
    v.occupants[seat] = this.player;
    this.vehicleSeat = seat;
    this._driveYaw = v.yaw;
    if (seat === 0 && v.kind === 'heli') this._takeHeliControl(v);
    if (seat === 0 && this.headlight) v.attachHeadlight(this.headlight);
    this.player.setSeated(v.seatWorld(seat, this._tmpV1));
    this.hud.showMessage(v.kind === 'heli' ? (['操縦席', '助手席', '後ろの席', '後ろの席'][seat] || '席') : (seat === 0 ? '運転席' : '助手席'), 900);
  }

  _vehicleCtx() {
    if (!this._vctx) {
      this._vctx = {
        nav: this.world.nav, enemies: this.enemies, player: this.player, vehicles: this.vehicles, fx: this.fx, audio: this.audio, time: 0,
        city: this.city || null,
        camera: this.camera, // 甲板員の片付けは見えない所で（jet.js _camSees）
        onKill: (e) => this._onKill(e, 'vehicle'),
        onImpact: (v, speed) => { if (v === this.vehicle) this.shake = Math.min(1.5, this.shake + Math.min(1, speed / v.def.maxSpeed) * 1.2); },
        onExplode: (v) => this._vehicleExploded(v),
        crashFx: null, // 街: (v, spec) → true（MR.Crashes が見た目を引き受けた）。下で毎回入れる
        // 街: 水に落ちた車（沈む）→ 運転席が水面に着いたら降ろして泳がせる
        onSink: (v) => { if (v === this.vehicle) this.shake = Math.min(1.5, this.shake + 0.8); },
        // 街のオンラインはサーバーにも降りたと伝える（水の上の位置。サーバーは沈んだ車を後で sunk にする）
        onSinkEject: (v) => { if (v === this.vehicle) this._exitVehicle(!this.cityOnline); },
        onSunk: (v) => { if (v === this.vehicle) this._exitVehicle(!this.cityOnline); }
      };
    }
    this._vctx.time = this.time;
    this._vctx.enemies = this.enemies;
    // 徒歩のプレイヤー（VTOL の傾斜板の開け閉め・機内。V2）
    this._vctx.walker = !this.vehicle && this.player && !this.player.dead && !this.freeCam && !(this.royale && this.royale.riding) ? this.player : null;
    this._vctx.crashFx = this.crashes ? (this._crashFxFn || (this._crashFxFn = (v, sp) => this._crashFx(v, sp))) : null;
    this._vctx.debris = this.debris && !this.debris.disposed ? this.debris : null; // 壊れた戦闘機・ヘリの外れる部品（detachDebris）
    // 滑る墜落（E3.3。jet._slideStart）: ソロの街だけ（オンラインはサーバーの plan = E4、アリーナは今まで通り）
    this._vctx.slide = this.crashes && this.isCity && !this.online ? ((this.config.fire || {}).slide || null) : null;
    this._vctx.fire = this.config.fire || null;
    this._vctx.onSlide = this._onSlideFn || (this._onSlideFn = (v, ev, x, y, z, vx, vz) => this._onSlide(v, ev, x, y, z, vx, vz));
    return this._vctx;
  }

  _updateVehicles(dt) {
    const ctx = this._vehicleCtx();
    if (this.vehicle && this.vehicle.kind === 'jet') {
      // 戦闘機: 操縦席だけが飛ばす（ジャンプボタン・Space は機関砲。consumeJump は捨てる）
      this.input.consumeJump();
      if (!(this.vehicleSeat > 0)) this._jetControls(dt, this.vehicle);
    } else if (this.vehicle && this.vehicle.kind === 'vtol') {
      // VTOL: 操縦席だけが飛ばす（上昇 / 下降 = ジャンプ / 下降ボタン、巡航では加速 / 減速。「着陸」= 自動着陸）
      this.input.consumeJump();
      if (!(this.vehicleSeat > 0)) this._vtolControls(dt, this.vehicle);
    } else if (this.vehicle && this.vehicle.kind === 'heli') {
      // ヘリ: 操縦席だけが飛ばす（上昇 = ジャンプを押している間、下降 = 下降ボタン。向きはカメラの向き）。同乗の席は見て撃つだけ
      this.input.consumeJump();
      if (!(this.vehicleSeat > 0)) {
        const mv = this.input.getMove();
        const climb = (this.input.jumpHeld ? 1 : 0) - (this.input.descendHeld ? 1 : 0);
        this.vehicle.setFlight(mv.y, mv.x, climb, this.player.yawAngle + Math.PI);
      }
    } else if (this.vehicle && !(this.vehicleSeat > 0)) { // 運転席だけが運転する（同乗の席は見るだけ。C2 / D）
      const mv = this.input.getMove();
      this.vehicle.setControls(mv.y, mv.x);
      if (this.input.consumeJump()) this.vehicle.horn(); // 運転中のジャンプボタンはクラクション
    }
    if (this.cityOnline) {
      // 街のオンライン: 自分が運転・操縦している物だけ物理（cityonline.js）
      this.cityOnline.updateVehicles(dt);
      if (this.vehicle && !(this.vehicleSeat > 0) && this.vehicle.kind !== 'heli') this._checkRunOver();
    } else if (this.online) {
      for (const v of this.vehicles) {
        // 他の人が運転中・直近に動かした車はサーバーから来た位置（補間）に置く。自分の車と止まっている車は物理
        const s = (v !== this.vehicle && !v.wrecked) ? this.net.sampleVehicle(v.netIndex, this._vsample || (this._vsample = {})) : null;
        if (s) v.netPose(s.x, s.z, s.yaw, s.sp, s.st, dt);
        else v.update(dt, ctx);
      }
      if (this.vehicle) this._checkRunOver();
    } else {
      for (const v of this.vehicles) v.update(dt, ctx);
    }
    // 敵の経路探索に乗り物の位置を反映（0.4 s ごと）
    this._navVehicleTimer = (this._navVehicleTimer || 0) - dt;
    if (this._navVehicleTimer <= 0 && typeof this.world.nav.setDynamicBoxes === 'function') {
      this._navVehicleTimer = 0.4;
      const dyn = this._dynBoxes || (this._dynBoxes = []);
      dyn.length = 0;
      for (const v of this.vehicles) if (!v.carrier) dyn.push(v.aabb()); // VTOL に積んだ車（V2c）は機体の箱に入っている
      this.world.nav.setDynamicBoxes(dyn);
    }
    // 戦闘機: 機関砲・出来事・HUD
    const jv = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    const vv = this.vehicle && this.vehicle.kind === 'vtol' && !(this.vehicleSeat > 0) && !this.player.dead ? this.vehicle : null; // VTOL の操縦席（V3: 翼の銃・ミサイル・爆弾）
    if (jv) { this._updateJetGun(dt, jv); this._updateJetWeapons(dt, jv); this._jetEvents(jv); }
    else if (vv) { this._updateVtolGun(dt, vv); this._updateVtolWeapons(dt, vv); }
    else this._jetLock = null;
    if (!vv && this._vtolGunV) this._vtolGunStop(this._vtolGunV);
    this._updateVtolTasks(dt); // 物語の射撃（v.gunTask / v.missileTask。操縦士がいなくてもよい）
    if (this.isCity && !this.online && MR.VtolCargo) this._vtolCargoTick(); // VTOL の貨物室（V2c）
    // ヘリ・VTOL: 守るだけ（フレア・RWR。D4。VTOL は VX から = 対空の見張りの目標になるので必ずだませる）。フレアのボタン / X はここで先に読む
    //  （_updateVehicleInteract が戦闘機の外の 1 回押しを捨てる前）
    const hv0 = this.vehicle && (this.vehicle.kind === 'heli' || this.vehicle.kind === 'vtol') ? this.vehicle : null;
    if (hv0 && this.airCombat && !this.player.dead) this.airCombat.updateHeli(dt, hv0);
    for (const v of this.vehicles) if (v.kind === 'jet' && v !== jv && v.events.length) v.events.length = 0;
    if (this.jetHud) this.jetHud.show(!!(jv || vv) && !(this.vehicleSeat > 0) && !this.player.dead); // vv は操縦席・生きている VTOL
    // 発艦ボタン（#btn-launch）: 操縦席で空母の甲板の上（自動で走っている・射出の途中は隠す）
    let deckBtn = !!jv && !(this.vehicleSeat > 0) && jv.mode === 'ground' && jv.onDeck && !jv.arrest && (!jv._auto || jv._auto.stopping) && !(jv.deckWait && !jv.cat) && (!jv.cat || (jv.cat.ph === 'ready' && !jv.cat.auto));
    //  甲板の外の地上（道路に降りた後）で止まっている・ゆっくり: 同じボタンを「離陸」にする（全開で走って自動で離陸）
    if (!deckBtn && jv && !(this.vehicleSeat > 0) && jv.mode === 'ground' && !jv.onDeck && !jv.arrest && !jv.bolter && !jv.cat && !jv.autoland && !jv._roadGo && jv.speed < 30 && !jv.wrecked) deckBtn = 'road';
    // 着艦・着陸ボタン（#btn-land）: 操縦席で空中、空母の近く（着艦）か道路（着陸）があるとき。自動着艦中は「解除」
    let landBtn = null;
    if (jv && !(this.vehicleSeat > 0) && jv.mode === 'air' && !jv.wrecked && !jv._prot) {
      if (jv.autoland) landBtn = 'off';
      else { const t = jv.autolandTarget(); if (t) landBtn = t.kind; }
    }
    if (this.hud.setJet) this.hud.setJet(jv ? { pilot: !(this.vehicleSeat > 0), air: jv.mode === 'air', stopped: jv.mode === 'ground' && jv.speed < 2, chase: !!this.jetChase, manual: this._jetManual(), easy: this._jetEasy(), deck: deckBtn, land: landBtn } : null);
    this._updateCatMarker(jv);
    if (jv && jv.abLight !== this.abLight && this.abLight && !(this.vehicleSeat > 0)) jv.attachAbLight(this.abLight);
    if (this.hud.setVehicle) {
      const v = this.vehicle;
      this.hud.setVehicle(v ? { name: v.kind === 'vtol' ? this._vtolLabel(v) : v.name, kmh: v.speedKmh, health: v.health, maxHealth: v.def.health, heli: v.kind === 'heli' || v.kind === 'jet' || v.kind === 'vtol' } : null);
    }
    if (this.hud.setHeli) {
      const v = this.vehicle;
      if (v && v.kind === 'heli') {
        const pilot = !(this.vehicleSeat > 0);
        if (v.cantLand > 0.5 && pilot && this.time - (this._cantLandMsg || -9) > 2.5) { this._cantLandMsg = this.time; this.hud.showMessage('ここには降りられません', 1200); }
        // 席を移る: ソロは地上で止まっているとき、オンラインは空いている席があればいつでも（サーバーが vseat で決める）
        //  操縦席は地上で止まっているときだけ（オンラインも。空中の操縦士の X はフレア = D4）
        const grounded = v.grounded && v.speed < 1;
        const canSeat = this.online ? (v.seatCount > 1 && v.freeSeat() >= 0 && (!pilot || grounded)) : (grounded && v.seatCount > 1);
        const air = MR.AirCombat ? MR.AirCombat.heliAir(v) : !v.grounded;
        this.hud.setHeli({ alt: v.agl, asl: v.pos.y - ((this.city && this.city.waterY) != null ? this.city.waterY : -2), rpm: v.rotor, starting: pilot && v.rotor < v.def.liftRpm && v.engineOn,
          pilot, chase: !!this.heliChase, seat: canSeat, air, flares: this.online ? null : v.flareCount });
      } else if (v && v.kind === 'vtol') {
        // VTOL: ヘリと同じボタン（上昇 / 下降 / 視点 / 降りる）と高度。始動の輪は回転数（spool）
        const pilot = !(this.vehicleSeat > 0);
        if (v.cantLand > 0.5 && pilot && this.time - (this._cantLandMsg || -9) > 2.5) { this._cantLandMsg = this.time; this.hud.showMessage('ここには降りられません', 1200); }
        const air = MR.AirCombat ? MR.AirCombat.heliAir(v) : !v.grounded;
        this.hud.setHeli({ alt: v.agl, asl: v.pos.y - ((this.city && this.city.waterY) != null ? this.city.waterY : -2), rpm: v.spool, starting: pilot && v.spool < v.def.liftSpool && v.engineOn,
          pilot, chase: !!this.vtolChase, seat: false, air, flares: this.online ? null : v.flareCount });
      } else this.hud.setHeli(null);
    }
    if (this.hud.setVtol) {
      const v = this.vehicle && this.vehicle.kind === 'vtol' ? this.vehicle : null;
      const pilot = !!v && !(this.vehicleSeat > 0);
      let land = null;
      if (pilot && !v.grounded && !v.wrecked) land = v.autoland ? 'off' : 'land';
      else if (pilot && v.grounded && !v.wrecked && v.cabin) land = v.rampWant ? 'rclose' : 'ropen'; // 地上: 傾斜板（V2）
      this.hud.setVtol(v ? { pilot, cruise: v.flight === 'cruise', land, armed: v.armPos >= 1, arming: v.armPos > 0 && v.armPos < 1 } : null);
    }
    // RWR の輪（ヘリ・VTOL に乗っている人。戦闘機は jethud のキャンバスに描く）
    if (this.hud.setRwr) this.hud.setRwr(this.vehicle && (this.vehicle.kind === 'heli' || this.vehicle.kind === 'vtol') && !this.player.dead ? this.rwr : null);
  }

  _drainJetInput() {
    const inp = this.input;
    for (const k of ['consumeGear', 'consumeEject', 'consumeMissile', 'consumeFlare', 'consumeLaunch', 'consumeLand']) if (typeof inp[k] === 'function') inp[k]();
  }

  // 乗り降り（E キー / 乗り物ボタン）。近くの乗り物をボタンに出す
  _updateVehicleInteract() {
    const player = this.player;
    const vcfg = this.config.vehicles || {};
    let near = null, nearSeat = -1;
    if (!this.vehicle && !(this.lift && this.lift.riding)) {
      let best = vcfg.enterDistance == null ? 3 : vcfg.enterDistance;
      for (const v of this.vehicles) {
        if (v.wrecked) continue;
        if (v.storyNo7 && !(this.story && this.story.seatsOk)) continue; // 七号機の席はストーリーが許したときだけ（第5章の操縦席。ほかの章で飛んで行かない）
        // 他の人が運転中（オンライン）: arena は乗れない。街は空いている席があれば同乗できる（ロビー・結果の間・範囲の外の車は乗れない）
        if (v.driver && v.driver.remote && (!this.cityOnline || v.freeSeat() < 0)) continue;
        if (v.netInactive) continue;
        if (v.kind === 'vtol' && !this._vtolBoardExterior(v)) {
          // V2: 外の「乗る」は無い。機内の席の前（席の stand から board.seatReach m・席の方を向いている）で「操縦する」/「副操縦席」
          const si = v.seatNear ? v.seatNear(player) : -1;
          if (si >= 0) { near = v; nearSeat = si; best = -1; }
          continue;
        }
        if (v.kind === 'boat') {
          // ボート: 桟橋・浮き桟橋・水の中から（甲板の高さで比べる。enterDistance は boats の値）
          if (!this.cityBoats || !this.cityBoats.canEnter(v, player)) continue;
          const db = v.distanceTo(player.pos.x, player.pos.z) - (this.cityBoats.enterDistance() - (vcfg.enterDistance == null ? 3 : vcfg.enterDistance));
          if (db < best) { best = db; near = v; }
          continue;
        }
        if (v.carrier) {
          // VTOL に積んだ車（V2c）: 着陸して止まっているときだけ。機内（左舷の通路）からか、傾斜板の上・先から（床の 2 m 下なので段の差は cargo.enterDy まで）
          const h = v.carrier.host;
          if (v.cargoState !== 'stowed' || !h || !h.grounded || player.state !== 'walk' || Math.abs(player.pos.y - v.pos.y) > ((h.def.cargo && h.def.cargo.enterDy) || 2.6)) continue;
        } else if (this.isCity && (v.sinking || player.state !== 'walk' || Math.abs(player.pos.y - v.pos.y) > 2)) continue;
        const d = v.distanceTo(player.pos.x, player.pos.z);
        if (d < best) { best = d; near = v; }
      }
    }
    this._nearVehicle = near;
    this._nearSeat = nearSeat;
    if (near && near.kind === 'heli' && near !== this._preparedHeli && typeof this.audio.prepareRotor === 'function') { this._preparedHeli = near; this.audio.prepareRotor(); }
    if (near && near.kind === 'jet' && near !== this._preparedJet && typeof this.audio.prepareJet === 'function') { this._preparedJet = near; this.audio.prepareJet(); }
    if (near && near.kind === 'vtol' && near !== this._preparedJet && typeof this.audio.prepareJet === 'function') { this._preparedJet = near; this.audio.prepareJet(); }
    const hv = this.vehicle && this.vehicle.kind === 'heli' ? this.vehicle : null;
    const jv = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    const vv = this.vehicle && this.vehicle.kind === 'vtol' ? this.vehicle : null;
    if (vv) {
      // VTOL: 降りられるのは地上で止まっているときだけ。視点（3 人称 ⇔ 操縦席）
      const canExit = vv.grounded && vv.speed < 1;
      if (this.hud.setVehiclePrompt) this.hud.setVehiclePrompt(canExit ? '降りる' : null);
      // 視点: 近い 3 人称 → 遠い 3 人称 → 操縦席 → …（V3）
      if (typeof this.input.consumeCamera === 'function' && this.input.consumeCamera()) { this.vtolCam = Game.VTOL_CAMS[(Game.VTOL_CAMS.indexOf(this.vtolCam) + 1) % Game.VTOL_CAMS.length]; Game._savePref('vtolCam', this.vtolCam); this._chaseK = null; vv.setCockpit(!this.vtolChase); }
      if (typeof this.input.consumeSeat === 'function') this.input.consumeSeat();
      this._drainJetInput();
      const want = typeof this.input.consumeInteract === 'function' ? this.input.consumeInteract() : false;
      if (want && canExit) this._exitVehicle();
      return;
    }
    // 戦闘機: 降りられるのは地上で止まっているときだけ（飛んでいる間は脱出ボタン）
    const jetCanExit = !!jv && jv.mode === 'ground' && jv.speed < 2 && (!jv.cat || jv.cat.ph === 'align' || jv.cat.ph === 'ready') && !jv._auto;
    const storyAt = !this.vehicle && !near && this.story ? this.story.prompt() : null; // ストーリーの調べる物（配電盤・資料・話す…）
    const liftAt = !this.vehicle && !near && !storyAt && this.lift ? this.lift.prompt() : storyAt; // 近くに乗り物が無ければエレベーターの扉（lift.js）
    const nearLabel = near && near.kind === 'vtol' && nearSeat >= 0 ? (nearSeat === 0 ? '操縦する' : nearSeat === 1 ? '副操縦席' : '座る') : '乗る';
    if (this.hud.setVehiclePrompt) this.hud.setVehiclePrompt(this.vehicle ? (jv ? (jetCanExit ? '降りる' : null) : (hv && !hv.grounded && hv.agl > 2.5 ? '飛び降り' : (this.vehicle.kind === 'boat' && this.cityBoats && this.cityBoats.exitLabel(this.vehicle)) || '降りる')) : (near ? nearLabel : liftAt));
    if (jv) {
      // 視点（3 人称 ⇔ 操縦席）・脱出（タッチは 2 回押す。Ctrl+E はすぐ）
      if (typeof this.input.consumeCamera === 'function' && this.input.consumeCamera()) { this.jetChase = !this.jetChase; Game._savePref('jetCam', this.jetChase ? 'chase' : 'cockpit'); this._chaseK = null; }
      if (typeof this.input.consumeSeat === 'function') this.input.consumeSeat();
      if (this.vehicleSeat > 0 && typeof this.input.consumeLaunch === 'function') this.input.consumeLaunch(); // 後ろの席の発艦（T）は捨てる
      // ミサイル・フレア・着艦は操縦席が _updateJetWeapons / _jetControls で先に読む。後ろの席の押したものは捨てる
      if (this.vehicleSeat > 0) for (const k of ['consumeMissile', 'consumeFlare', 'consumeLand']) if (typeof this.input[k] === 'function') this.input[k]();
      if (typeof this.input.consumeEject === 'function' && this.input.consumeEject() && !(this.vehicleSeat > 0)) {
        const kb = this.input.keys && (this.input.keys.ControlLeft || this.input.keys.ControlRight || this.input.keys.MetaLeft || this.input.keys.MetaRight);
        if (kb || this._ejectArm > this.time) { this._ejectArm = 0; this._ejectJet(jv); return; }
        this._ejectArm = this.time + (jv.def.ejectArmTime == null ? 2 : jv.def.ejectArmTime);
      }
      const want = typeof this.input.consumeInteract === 'function' ? this.input.consumeInteract() : false;
      if (want && this.input.interactKey !== 'KeyF' && jetCanExit) this._exitVehicle();
      return;
    }
    // 戦闘機だけの 1 回押し（脚 G・脱出 Ctrl+E・ミサイル F・フレア X）は戦闘機の外では捨てる（歩いている間に押したものが次に乗ったときに効かない。
    //  F は乗る・拾うと同じキー）。フレアはフェーズ E2 でヘリも使う（そのときはヘリの操縦席で先に読む）
    this._drainJetInput();
    // ヘリ: 視点（一人称 ⇔ 3 人称）・座席を移る（ソロは地上で止まっているときだけ）
    const cam = typeof this.input.consumeCamera === 'function' ? this.input.consumeCamera() : false;
    if (cam && hv) { this.heliChase = !this.heliChase; Game._savePref('heliCam', this.heliChase ? 'chase' : 'cockpit'); this._chaseK = null; }
    const bv = this.vehicle && this.vehicle.kind === 'boat' ? this.vehicle : null;
    if (cam && bv && this.cityBoats) this.cityBoats.toggleCamera(); // ボート: 座席 ⇔ 後ろから
    const seatFromKey = !!this.input.seatFromKey; // consumeSeat が消すので先に読む
    let seatReq = typeof this.input.consumeSeat === 'function' ? this.input.consumeSeat() : false;
    //  空中のヘリの操縦士: キー（X = フレア）からは席を移らない（D4。ボタンは #hud.heli.piloting.heli-air で隠れている）
    if (seatReq && hv && !(this.vehicleSeat > 0) && !(hv.grounded && hv.speed < 1) && seatFromKey) seatReq = false;
    if (seatReq && bv && this.cityBoats && this.cityBoats.canSwitch(bv)) {
      const to = bv.switchSeat(player);
      if (to >= 0) { this.vehicleSeat = to; this._driveYaw = bv.yaw; this.hud.showMessage(to === 0 ? '運転席' : '席 ' + (to + 1), 900); }
    } else if (seatReq && hv && !this.online && hv.grounded && hv.speed < 1) {
      const to = hv.switchSeat(player);
      if (to >= 0) { this.vehicleSeat = to; this._driveYaw = hv.yaw; this.hud.showMessage(['操縦席', '助手席', '後ろの席', '後ろの席'][to] || '席', 900); }
    } else if (seatReq && this.vehicle && this.cityOnline) {
      // オンライン: 次の空いた席をサーバーに頼む（vseat で移る）
      const v = this.vehicle, from = this.vehicleSeat || 0;
      //  ヘリの操縦席から移るのは地上で止まっているときだけ（同乗の席どうしは空中でも移れる）
      const lockedPilot = from === 0 && v.kind === 'heli' && !(v.grounded && v.speed < 1);
      for (let k = 1; k < v.seatCount && !lockedPilot; k++) {
        const j = (from + k) % v.seatCount;
        if (!v.occupants[j]) { this.net.send({ t: 'enter', i: v.netIndex, seat: j }); break; }
      }
    }
    const want = typeof this.input.consumeInteract === 'function' ? this.input.consumeInteract() : false;
    if (!want) return;
    if (this.vehicle) this._exitVehicle();
    else if (near) this._enterVehicle(near, false, near.kind === 'vtol' && nearSeat >= 0 ? nearSeat : undefined);
    else if (storyAt) this.story.press();
    else if (this.lift && (liftAt || this.lift.open)) this.lift.press();
  }

  // granted: サーバーが認めた（オンライン）。seat: 街のオンラインでサーバーが決めた席（vseat）
  _enterVehicle(v, granted, seat) {
    // オンライン: サーバーに頼み、vowner（arena）/ vseat（街）で自分に決まってから座る
    if (this.online && !granted) {
      if (!v || v.wrecked || this._pendingEnter >= 0) return;
      if (v.driver && v.driver.remote && !this.cityOnline) { this.hud.showMessage('他の人が運転中', 900); return; }
      this._pendingEnter = v.netIndex;
      this._pendingEnterAt = this.time;
      if (this.play && this.play.heal) this.play.cancelHeal('vehicle');
      this.net.send({ t: 'enter', i: v.netIndex });
      return;
    }
    let want = this.cityOnline && typeof seat === 'number' ? seat : (this.isCity && v.driver && v.driver !== this.player ? -1 : undefined);
    if (!this.online && v && v.kind === 'vtol' && typeof seat === 'number') want = seat; // V2: 機内の席（操縦席 0・副操縦席 1）
    if (v && (v.kind === 'vtol' || v.carrier) && this.cityBoats) this.cityBoats.clearRide(); // 機内の足場から席へ（VTOL に積んだ車も。V2c）
    if (v && v.carrier && v.carrier.host && !v.carrier.host.grounded) { this.hud.showMessage('飛行中は乗れません', 1200); return; }
    if (!v || v.wrecked || !v.enter(this.player, want)) return;
    this.vehicle = v;
    if (this.story) this.story.onEnterVehicle(v);
    if (this.waterFx && v.kind === 'heli') this.waterFx.warm(); // しぶきのパイプラインを 1 フレーム描いて作らせる
    this.vehicleSeat = Math.max(0, v.seatOf(this.player));
    v.cityTouched = true;
    this._driveYaw = v.yaw;
    if (this.cityOnline && this.vehicleSeat === 0 && v.kind === 'heli') this._takeHeliControl(v);
    if (this.headlight && this.vehicleSeat === 0) v.attachHeadlight(this.headlight);
    if (v.kind === 'jet') {
      // 戦闘機: 機首の向きを見て座る（見ている向き = 操縦の目標）。一人称なら操縦席を重ね描く
      v.axes();
      // 見ている向き = 機首の向き・水平（下を向いて座ると、離陸の後に海へ向かって飛ぶ）
      this.player.yawAngle = Math.atan2(-v._fwd.x, -v._fwd.z); this.player.pitchAngle = Math.max(0, Math.asin(THREE.MathUtils.clamp(v._fwd.y, -1, 1)));
      this._jetCamGoal = null; this._jetSwipeT = -9; this._jetClimbHintT = 0; this._jetEasyCamS = null; this._jetLock = null;
      // 甲板で初めて乗った: 操縦の説明（1 回だけ。jetTut）
      if (this.vehicleSeat === 0 && !this._jetManual() && Game._loadPref('jetTut') !== '1' && v.mode === 'ground') { this._jetTutUntil = this.time + v.def.hud.tutorialTime; Game._savePref('jetTut', '1'); }
      v.localInside = true;
      v.setCockpit(!this.jetChase);
      if (this.abLight && this.vehicleSeat === 0) v.attachAbLight(this.abLight);
      this._chaseK = null;
      this._ejectArm = 0;
      if (this.play && this.play.heal) this.play.cancelHeal('vehicle');
    }
    if (v.kind === 'vtol') {
      // VTOL: 機首の向きを見て座る。一人称なら操縦席を重ね描く
      this.player.yawAngle = v.yaw + Math.PI; this.player.pitchAngle = -0.05;
      v.localInside = true;
      v.setCockpit(!this.vtolChase);
      this._chaseK = null; this._vtolSwipeT = -9; this._vtolCamYaw = null;
      if (v.spots == null) v.setSpots(this._vtolSpotsList());
      this._vtolStores(v); // 吊り物の形（AIM-9X・GBU-16 の試作弾を焼いて付ける。届くまでは筒の代わり）
      if (this.play && this.play.heal) this.play.cancelHeal('vehicle');
      // 初めて操縦席に乗った: 操縦の説明（1 回だけ。vtolTut。戦闘機の jetTut とは別）
      if (this.vehicleSeat === 0 && Game._loadPref('vtolTut') !== '1') {
        Game._savePref('vtolTut', '1');
        this.hud.showMessage('「上昇」でまっすぐ上がる・左スティックを前へ倒し続けると巡航・「着陸」で自動着陸', ((v.def.hud && v.def.hud.tutorialTime) || 6) * 1000);
      }
    }
    if (v.kind === 'heli') {
      // ヘリ: 前（風防）を向いて座る。一人称なら操縦席を重ね描く
      this.player.yawAngle = v.yaw + Math.PI; this.player.pitchAngle = -0.08;
      v.localInside = true;
      v.setCockpit(!this.heliChase);
      this._chaseK = null;
      if (typeof this.audio.prepareRotor === 'function') this.audio.prepareRotor();
    }
    if (v.kind !== 'heli' && v.kind !== 'jet' && v.kind !== 'vtol' && v.kind !== 'boat') {
      // 車: 前（風防）を向いて座る（b16.1: 以前は乗る前の向きのままで、後ろを向いて乗ると座席の背が画面いっぱいになった）
      this.player.yawAngle = v.yaw + Math.PI; this.player.pitchAngle = -0.05;
    }
    // オンライン: どの乗り物も乗ると向きが最大 180° 変わるので次の state をすぐ送る（サーバーは最後に送った視線から fireCone の外の fire を捨てる。
    //   b16.1 は車だけ、b17 からヘリ・VTOL・戦闘機も = 同乗の席ですぐ撃つ弾が捨てられない）
    if (this.net && typeof this.net.requestState === 'function') this.net.requestState();
    if (v.kind === 'boat' && this.cityBoats) this.cityBoats.onEnter(v); // ボート: 水の中から乗っても座席では撃てる
    this.player.setSeated(v.seatWorld(this.vehicleSeat || 0, this._tmpV1));
    this._stepDist = 0; this._stepTime = 0;
    if (v.carrier && v.carrier.host && v.carrier.host._cargo && this.vehicleSeat === 0) {
      // VTOL に積んだ車（V2c）: 降ろし方（前から積んだ = 後ろへ下りる = スティックを下、後ろから積んだ = 上）
      this.hud.showMessage(v.carrier.host._cargo.dir > 0 ? 'スティックを下へ倒して降ろす' : 'スティックを上へ倒して降ろす', 2400);
      return;
    }
    if (!(v.kind === 'jet' && this.time < (this._jetTutUntil || 0))) this.hud.showMessage(v.name, 900); // 戦闘機の説明を出すときは名前を重ねない
  }

  // silent: サーバーに exit を送らない（死亡・爆発・運転手を外されたときはサーバーが先に知っている）
  _exitVehicle(silent) {
    const v = this.vehicle;
    if (!v) return;
    if (this.story) this.story.onExitVehicle(v);
    v._selfT = this.time; // 降りた乗り物が causeSec 秒以内に墜ちたら自分の手柄（_crashCause）
    if (v.carrier) { this._exitCargoCar(v, silent === true || v.wrecked || this.player.dead); return; } // VTOL に積んだ車（V2c。死亡・爆発・置き直しは積み込み中でも降ろす）
    if (v.kind === 'heli') { this._exitHeli(v, silent); return; }
    if (v.kind === 'jet') { this._exitJet(v, silent, v.wrecked); return; }
    if (v.kind === 'vtol') { this._exitVtol(v, v.wrecked); return; }
    if (v.kind === 'boat' && this.cityBoats) { this.cityBoats.exitBoat(v); return; } // ボート: 甲板・浮き桟橋・桟橋 → 水（泳ぐ）
    const player = this.player;
    const driver = !(this.vehicleSeat > 0);
    if (this.online && driver) v.speed = 0; // 降りたら止める（サーバーも速度 0 にする）
    if (this.online && !silent && driver) {
      // 最後の位置を送ってから exit
      v.steer = 0;
      if (this.cityOnline) this.net.queue(Object.assign(this._vstateCity(v), { sp: 0, st: 0 }));
      else this.net.send({ t: 'vstate', i: v.netIndex, p: [MR.NetProto.q(v.pos.x), MR.NetProto.q(v.pos.z)], yaw: MR.NetProto.qa(v.yaw), sp: 0, st: 0 });
    }
    if (this.isCity) {
      // 街: 座席の出口 → 他の出口 → 車の周り → 近くの空き（Vehicle.findExit）。水の上なら泳ぐ
      const seat = Math.max(0, v.seatOf(player));
      const e = v.findExit(seat, this.world.nav, player.radius);
      const yaw = player.yawAngle;
      this.vehicle = null; this.vehicleSeat = 0;
      this.placePlayer(e.x, e.z, e.y == null ? v.pos.y + 1 : e.y + 0.3, THREE.MathUtils.radToDeg(yaw));
      v.exit(player);
      if (this.headlight && v.detachHeadlight()) { this.scene.add(this.headlight); this.scene.add(this.headlight.target); }
      if (this.hud.setVehicle) this.hud.setVehicle(null);
      if (this.cityOnline) this._sendExitCity(v, silent);
      return;
    }
    const exit = v.exitWorld(this._tmpV1);
    let spot = this.world.nav.resolveCircle(exit.x, exit.z, player.radius);
    if (v.pushOut(spot, player.radius)) spot = this.world.nav.resolveCircle(spot.x, spot.z, player.radius);
    if (this.online && !silent && Math.hypot(spot.x - v.pos.x, spot.z - v.pos.z) > (this.onlineCfg.exitDistance || 8) - 0.5) {
      // サーバーは車体から離れすぎた降車位置を受け取らず、車体の横（箱の外へ押し出した所）に置く（room.js _exitSpot）。同じ所に降りる
      const side = (v.def.width || 1.95) / 2 + 0.8;
      spot = this.world.nav.resolveCircle(v.pos.x + Math.cos(v.yaw) * side, v.pos.z - Math.sin(v.yaw) * side, player.radius);
    }
    player.pos.set(spot.x, 0, spot.z);
    player.vy = 0; player.grounded = true;
    player._apply();
    v.exit();
    if (this.headlight && v.detachHeadlight()) { this.scene.add(this.headlight); this.scene.add(this.headlight.target); }
    this.vehicle = null;
    if (this._lastStepPos) this._lastStepPos.copy(player.pos);
    this._wasGrounded = true;
    if (this.hud.setVehicle) this.hud.setVehicle(null);
    if (this.online && !silent) {
      const P = MR.NetProto;
      this.net.send({ t: 'exit', i: v.netIndex, p: [P.q(player.pos.x), P.q(player.pos.z)], yaw: P.qa(player.yawAngle) });
      this._exitResentAt = this.time; // 届かなければ（snap がまだ乗っていると言う）1 秒後から送り直す
    }
    if (this.online) this._netResetMove(); // 降りた位置から数え直す（サーバーも exit で予算を満タンにする）
  }

  // 運転中: 車の向きの変化ぶんだけ視点も回し、カメラを座席に置く。
  // ヘリの操縦席はカメラを回さない（ヘリの方がカメラの向きを追う）。同乗の席はヘリと一緒に回る
  _updateDriving(dt) {
    const v = this.vehicle;
    // 戦闘機の操縦席: 見ている向きは世界に固定（機体がそちらへ向く）。後ろの席は機体と一緒に回る
    if ((v.kind !== 'heli' && v.kind !== 'jet' && v.kind !== 'vtol') || this.vehicleSeat > 0) this.player.yawAngle += v.yaw - this._driveYaw;
    this._driveYaw = v.yaw;
    this.player.updateSeated(dt, this.input, v.seatWorld(this.vehicleSeat || 0, this._tmpV1));
    if (v.kind === 'heli') this._updateHeliView(dt, v);
    else if (v.kind === 'jet') this._updateJetView(dt, v);
    else if (v.kind === 'vtol') this._updateVtolView(dt, v);
    else if (v.kind === 'boat' && this.cityBoats) this.cityBoats.updateView(dt, v);
  }

  // 乗り物が爆発した: 周囲の敵とプレイヤーにダメージ、乗っていたら降ろして致命傷（explodeDamage そのまま）。
  //   E3.4: ダメージは game.explode → MR.Explosive.blast。数値は explosives.blasts の carCrash / heliCrash / jetCrash（形）に、乗り物の
  //   explodeRadius / explodeDamage を半径とダメージとして重ねる（ピックアップ・装甲車は自分の数）。前の計算と同じ（tools/blast-regress.json ± 1 %）:
  //   敵 × (1 − d / R × 0.6)、プレイヤー × (1 − d / R × 0.7)（胸 = 足元 + 1 m まで。街は 3D・アリーナは水平）。ほかの止まっている乗り物は受けない（vehicle 0）。
  //   別の乗り物に乗っている（街、D9 seat 'occupant'）: 乗っている人の位置の爆風を乗り物が × armor（vs）、人が × driverExposure で受ける。
  //   手柄は墜落を起こした物（v._crashBy / _crashCause: 自分が乗っていた・撃った・降りた … なら自分）。以前は倒れた敵を全部自分の手柄にしていた
  _vehicleExploded(v) {
    if (this.story) this.story.onVehicleDead(v);
    if (this.online) {
      // ダメージ・撃破はサーバー（damage / kill が来る）。乗っていたら降りるだけ
      if (this.vehicle === v) this._exitVehicle(true);
      if (this.destruct) { const c = v.center(this._tmpV2); this.structHit({ x: c.x, y: c.y, z: c.z, radius: v.def.explodeRadius, damage: v.def.explodeDamage, kind: 'vehicle' }); } // 見た目だけ
      const d = Math.hypot(this.player.pos.x - v.pos.x, this.player.pos.z - v.pos.z);
      this.shake = Math.min(2, this.shake + (d < 25 ? 1.2 : 0.3));
      return;
    }
    // VTOL に積んだ車が壊れた（V2c 5.3）: 残骸は付いたまま、機体に cargo.blastHostDamage（機体の箱の中の爆発。爆風の vehicle 0 では機体に効かない）
    if (v.carrier && v.carrier.host && !v.carrier.host.wrecked) { const h = v.carrier.host; h.damage(((h.def.cargo || {}).blastHostDamage) || 0, this._vehicleCtx()); }
    const c = v.center(this._tmpV2);
    const cx = c.x, cy = c.y, cz = c.z; // explode の中で別の乗り物が爆発すると _tmpV2 が書き換わる
    if (this.airDefense) this.airDefense.onBlast(cx, cy, cz, null); // 屋上に落ちた機体の爆発でも陣地は黙る
    const by = (v._crashBy !== undefined && v._crashBy !== null) ? v._crashBy : this._crashCause(v);
    const rode = this.vehicle === v;
    if (rode) {
      this._exitVehicle();
      this._playerHit(v.def.explodeDamage, { kind: 'explosion' });
    }
    const o = this._vxo || (this._vxo = { noFx: true, silent: true, noShake: true, skip: null, key: '' });
    const key = v.kind === 'jet' || v.kind === 'vtol' ? 'jetCrash' : (v.kind === 'heli' ? 'heliCrash' : 'carCrash'); // VTOL は戦闘機の形に自分の explodeRadius / explodeDamage
    o.skip = rode ? this.player : null; o.key = key;
    this.explode(cx, cy, cz, 0, 1, 0, this._vehicleSpec(key, v.def), by, null, o);
    o.skip = null;
    // 近くのボートにも（boats M4。ボートは cityBoats.blast が受ける）。壊れたボートの爆発がここへ戻ってくる（連鎖）ので、中心は自分の変数で
    if (this.cityBoats) { const c0 = new THREE.Vector3(cx, cy, cz); this.cityBoats.blast(c0, v.def.explodeRadius, v.def.explodeDamage, v); }
    if (!this.crashes) this.shake = Math.min(2, this.shake + 1.2); // 街は MR.Crashes が距離で揺らす
  }
  // 乗り物の爆発の spec: explosives.blasts[key] に def の explodeRadius / explodeDamage を重ねる（組み合わせごとに 1 回）
  _vehicleSpec(key, def) {
    const base = ((this.config.explosives || {}).blasts || {})[key] || { edge: 0.6, playerEdge: 0.7, chest: 1, centerDist: true, seat: 'occupant', vehicle: 0, player: 1, vs: { default: 1 } };
    const R = def && typeof def.explodeRadius === 'number' ? def.explodeRadius : base.radius;
    const D = def && typeof def.explodeDamage === 'number' ? def.explodeDamage : base.damage;
    if (R === base.radius && D === base.damage) return base;
    const c = this._vspecs || (this._vspecs = new Map());
    const k = key + ':' + R + ':' + D;
    let sp = c.get(k);
    if (!sp) { sp = Object.assign({}, base, { radius: R, damage: D }); c.set(k, sp); }
    return sp;
  }

  // 敵の弾が当たった: 乗っていれば車体が受ける（装甲ぶん減らし、開放車は driverExposure の割合だけ運転手にも）
  // 敵の弾が当たった（街: headChance で頭。頭は enemyHeadMult 倍、防具はヘルメット / ベスト）
  _onEnemyShot(damage, enemy) {
    const v = this.vehicle;
    this._lastAttacker = enemy || null;
    let head = false;
    if (this.play) {
      const ac = this.play.cfg.armor || {};
      head = Math.random() < (ac.headChance || 0);
      if (head) damage *= ac.enemyHeadMult || 1;
    }
    if (!v) { this._playerHit(damage, { kind: 'bullet', head }); return; }
    const exposure = v.def.driverExposure || 0;
    v.hit(damage, null, this._vehicleCtx());
    if (this.vehicle !== v) return; // 爆発して降ろされた
    if (exposure > 0) {
      this._playerHit(damage * exposure, { kind: 'bullet', head });
    } else {
      this.hud.damage();
      this.shake = Math.min(1.5, this.shake + 0.15);
      if (typeof this.audio.impact === 'function') this.audio.impact('metal', v.center(this._tmpV2));
    }
  }

  // ---------- オンライン ----------

  _startOnline() {
    const net = this.net;
    const P = MR.NetProto;
    if (this.hud.enableOnline) this.hud.enableOnline();
    if (this.hud.onLeave) this.hud.onLeave(() => this.leaveToTitle());
    // プロトタイプを持たない表（'constructor' などの武器 id が Object の関数に化けない）
    this._weaponDefs = Object.create(null);
    for (const d of this.config.weapons) this._weaponDefs[d.id] = d;
    this._shotN = 0;             // 射撃の通し番号（fire / hit / vhit の n）
    this._exitResentAt = -10;    // 最後に exit を送った時刻（サーバーがまだ乗っていると思っていたら 1 秒ごとに送り直す: _netCheckSelf）
    // サーバーの spawn が来るまでは開始地点で待つ（撃てない・state を送らない）
    this._waitForSpawn();
    net.stateProvider = () => this._netState();
    // 送った state を番号つきで覚える（snap の ack と突き合わせて、サーバーに拒否されたかを見る）
    net.onStateSent = (seq, s) => {
      const h = this._netSentHist;
      if (!h || this.vehicle) return;
      h.push({ seq, t: net.clock(), x: s.p[0], z: s.p[2] });
      while (h.length > 64) h.shift();
    };
    net.vstateProvider = () => {
      const v = this.vehicle;
      if (!v || this.player.dead || v.wrecked) return null;
      if (this.cityOnline) {
        if (this.vehicleSeat > 0) return null; // 同乗は送らない（運転席・操縦席だけ）
        const m = this._vstateCity(v);
        delete m.t;
        return m;
      }
      return { i: v.netIndex, p: [P.q(v.pos.x), P.q(v.pos.z)], yaw: P.qa(v.yaw), sp: P.q(v.speed), st: P.qa(v.steer) };
    };
    this._netStatusCb = (status, text) => {
      if (!this.running && status !== 'open') return;
      if (status === 'open') this.hud.setNetBanner(null);
      else if (status === 'error') this.hud.setNetBanner(text, { leave: true });
      else if (status === 'reconnecting' || status === 'connecting') this.hud.setNetBanner('接続が切れました。' + text, { leave: true });
    };
    net.onStatus((st, text) => { if (this.net === net && this._netStatusCb) this._netStatusCb(st, text); });
    this._lastNetPos = new THREE.Vector3().copy(this.player.pos);
    this._netSpeed = 0;
    this._netSent = null;        // 最後に送った自分の位置（サーバーの移動の予算を真似る。null = 次の送信から数え直す）
    this._netSentHist = [];      // 最近送った位置 { seq, t, x, z }（サーバーに拒否されていないかの確認）
    this._netStuck = 0;
    this._netSettleUntil = 0;
    this.netCorrections = 0;     // サーバーの位置に戻した回数（テスト・デバッグ用）
    this.netClamps = 0;          // 移動を予算の内側に縮めた回数
    if (net.welcome) this._applyWelcome(net.welcome, true);
    net.setHandler((m) => this._onNet(m));
  }

  _waitForSpawn() {
    if (this.vehicle) this._exitVehicle(true);
    if (this.cityOnline) {
      // 街: 試合範囲の中心 / ロビーのホットゾーンで待つ（spawn がすぐ来る）
      const w = this.cityOnline.waitPos();
      this.placePlayer(w.x, w.z, 400, 0);
    } else {
      const start = this.level.playerStart || [0, 0, 0];
      const free = this.world.nav.nearestFree(start[0], start[1]);
      this.player.spawn(free.x, free.z, start[2] || 0);
    }
    this.player.dead = true;
    this._waitingSpawn = true;
    this._waitingSince = this.time;
    this._netResetMove();
    this.hud.showDeath(false);
    this.hud.setHealth(this.player.health, this.config.player.maxHealth);
  }

  // welcome（接続・再接続）: 他のプレイヤーを作り直し、乗り物の状態を合わせる
  _applyWelcome(m, first) {
    this._appliedWelcome = m;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    if (!first) this._waitForSpawn();
    this._pendingEnter = -1;
    this._lastAck = null; // 再開しても state の番号は続くが、サーバー側の記録とは突き合わせ直す
    this._netStuck = 0;
    for (const info of (Array.isArray(m.players) ? m.players : [])) {
      if (info && info.id !== this.net.id) this._addRemote(info);
    }
    const self = this.net.players.get(this.net.id);
    this.kills = self ? (self.kills || 0) : 0;
    this.hud.setKills(this.kills);
    const P = MR.NetProto;
    if (this.cityOnline) { this.cityOnline.applyWelcome(m); this._updateNetHud(true); return; }
    for (const vi of (Array.isArray(m.vehicles) ? m.vehicles : [])) {
      const v = this.vehicles[vi.i];
      if (!v) continue;
      if (v.wrecked && !vi.wrecked) v.netRespawn(null, null, null, vi.hp);
      if (P.isVec(vi.p, 2) && !v.wrecked) v.netPose(vi.p[0], vi.p[1], P.isNum(vi.yaw) ? vi.yaw : v.yaw, 0, 0, 0);
      v.setHealth(vi.hp);
      if (vi.wrecked) v.netWreck();
      this._setVehicleDriver(v, P.isNum(vi.driver) ? vi.driver : -1, true);
    }
    this._updateNetHud(true);
  }

  _addRemote(info) {
    if (!info || info.id === this.net.id) return null;
    let r = this.remotes.get(info.id);
    if (r) { r.setName(info.name); return r; }
    r = new MR.RemotePlayer(this.scene, info, {
      enemyCfg: this.config.enemies, weapons: this._weaponDefs, fx: this.fx, audio: this.audio, nav: this.world.nav, city: this.isCity
    });
    this.remotes.set(info.id, r);
    return r;
  }

  // 送る自分の状態（net.update が STATE_HZ で呼ぶ）。死亡中・spawn 待ちは null
  _netState() {
    const p = this.player;
    // v2 の街: 置き直しのタイルを待っている間（_placeHold）は送らない（高さがまだ決まっていない）
    if (p.dead || this._waitingSpawn || this._placeHold) return null;
    const P = MR.NetProto;
    if (this.cityOnline) return this._netStateCity();
    if (!this.vehicle) this._netMoveGuard();
    else this._netSent = null; // 乗車中はサーバーが席の位置しか見ない（降りたら exit の位置から数え直す）
    const sp = this._netSpeed || 0;
    return {
      p: P.qv([p.pos.x, p.pos.y, p.pos.z]), yaw: P.qa(p.yawAngle), pitch: P.qa(p.pitchAngle),
      mv: this.vehicle ? 0 : (sp > 3.5 ? 2 : (sp > 0.3 ? 1 : 0)),
      ads: this.weapon && this.weapon.adsActive ? 1 : 0, w: this.weapon ? this.weapon.def.id : '',
      veh: this.vehicle ? this.vehicle.netIndex : -1, gr: p.grounded ? 1 : 0
    };
  }

  // サーバーが位置を決めた（復活・降車・再接続）: 移動の予算を満タンから数え直し、しばらくずれの確認を休む
  _netResetMove() {
    this._netSent = null;
    if (this._netSentHist) this._netSentHist.length = 0;
    this._netStuck = 0;
    this._netSettleUntil = this.time + 1.5;
  }

  // サーバーの移動の予算（server/room.js の _budget: MAX_SPEED × moveSpeedFactor m/s で貯まり、上限 moveBurst m）を
  // 少し内側で真似る。1 回でも超えるとサーバーは位置を受け取らず、その後の移動も上限を超えて止まったままになるので、
  // 超えそうな移動（他の人の体に押された・車に押された・降りた位置が遠いなど）はここで縮める。ふつうの歩き・走りは届かない
  _netMoveGuard() {
    const p = this.player;
    const P = MR.NetProto;
    const oc = this.onlineCfg;
    const now = this.net.clock();
    const rate = P.MAX_SPEED * (oc.moveSpeedFactor || 1.5) * 0.85;
    const burst = (oc.moveBurst || 2.5) * 0.8;
    const catchupMax = oc.moveCatchupMax || 2.0; // サーバーも空いた秒はここまでしか数えない
    const s = this._netSent;
    if (!s) { this._netSent = { x: p.pos.x, y: p.pos.y, z: p.pos.z, tok: burst, at: now }; return; }
    const gap = Math.max(0, (now - s.at) / 1000);
    s.at = now;
    s.tok = Math.min(Math.max(burst, rate * Math.min(gap, catchupMax)), s.tok + rate * gap);
    const cost = (x, y, z) => Math.hypot(x - s.x, z - s.z) + Math.max(0, y - s.y);
    let c = cost(p.pos.x, p.pos.y, p.pos.z);
    if (c > s.tok) {
      // 予算の分だけ進んだ所まで戻す（箱に掛かれば resolveCircle で外へ。それで超えるなら手前へ、最後は前に送った位置）
      let x = s.x, y = s.y, z = s.z;
      for (const f of [1, 0.7, 0.4]) {
        const k = s.tok / c * f;
        const ty = s.y + (p.pos.y - s.y) * k;
        const sol = this.world.nav.resolveCircle(s.x + (p.pos.x - s.x) * k, s.z + (p.pos.z - s.z) * k, p.radius);
        if (cost(sol.x, ty, sol.z) <= s.tok) { x = sol.x; y = ty; z = sol.z; break; }
      }
      p.pos.set(x, Math.min(p.pos.y, Math.max(y, s.y)), z);
      p._apply();
      this.netClamps++;
      c = cost(p.pos.x, p.pos.y, p.pos.z);
    }
    s.tok = Math.max(0, s.tok - c);
    s.x = p.pos.x; s.y = p.pos.y; s.z = p.pos.z;
  }

  // 街: state（m = 動き、seat = 席）。乗車中の p は席の足元（サーバーと同じ式: 車の位置 + 席をヨーだけ回した所 − 目の高さ。
  // 同乗はサーバーの最新の車の位置を延ばして使う）。輸送ヘリの中は航路の位置（サーバーは見ない。生きている印）
  _netStateCity() {
    const p = this.player, P = MR.NetProto, co = this.cityOnline;
    const sp = this._netSpeed || 0;
    const base = { yaw: P.qa(p.yawAngle), pitch: P.qa(p.pitchAngle), ads: this.weapon && this.weapon.adsActive ? 1 : 0, w: this.weapon ? this.weapon.def.id : '' };
    if (co.riding && co.ridePos) {
      this._netSent = null;
      const q = co.ridePos;
      return Object.assign(base, { p: P.qv([q.x, q.y, q.z]), mv: 0, veh: -1, gr: 1, m: 0 });
    }
    const v = this.vehicle;
    // 乗る返事（vseat）を待っている間は送らない: enter の後に歩きの位置を送ると、サーバーは先に席を決めているので席から遠い（seat）と数える
    if (!v && this._pendingEnter >= 0) return null;
    // エレベーター（オンライン）: lift を送ってから lifted で置かれるまでは送らない（置く前の位置はサーバーが行き違いとして捨てるが、送らなければ数えもしない）
    if (!v && this.lift && this.lift.netHold) return null;
    if (v) {
      this._netSent = null;
      const seat = this.vehicleSeat || 0;
      const e = this._seatFeet(v, seat, seat > 0);
      return Object.assign(base, { p: P.qv([e.x, e.y, e.z]), mv: 0, veh: v.netIndex, gr: 1, m: 0, seat });
    }
    this._netMoveGuardCity();
    const m = Game.MOVE_OF[p.state] || 0;
    return Object.assign(base, { p: P.qv([p.pos.x, p.pos.y, p.pos.z]), mv: sp > 3.5 ? 2 : (sp > 0.3 ? 1 : 0), veh: -1, gr: p.grounded ? 1 : 0, m });
  }

  // 席の足元（サーバーの _seatPos と同じ: 車の位置 + 席（設定の seats[k].seat）をヨーだけ回した所、高さは席の目 − eyeHeight）。
  // predict: 同乗（運転は他の人）なら車はサーバーの最新の行を今 + 片道ぶん延ばした位置（見えている補間より新しい）
  _seatFeet(v, seat, predict) {
    let x = v.pos.x, y = v.pos.y, z = v.pos.z, yaw = v.yaw;
    if (predict) {
      const net = this.net;
      const s = net.predictVehicle(v.netIndex, net.serverNow() + Math.min(150, (net.rtt || 80) / 2), this._predS || (this._predS = {}), 500);
      if (s && s.has3d && !s.stale) { x = s.x; y = s.y; z = s.z; yaw = s.yaw; }
    }
    const seats = v.def.seats;
    let l;
    if (Array.isArray(seats) && seats[seat] && Array.isArray(seats[seat].seat)) l = seats[seat].seat;
    else if (seat === 0 && Array.isArray(v.def.seat)) l = v.def.seat;
    else { const b = Array.isArray(v.def.seat) ? v.def.seat : [0.4, 1.2, 0]; l = [-b[0], b[1], b[2]]; }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const out = this._seatOut || (this._seatOut = { x: 0, y: 0, z: 0 });
    out.x = x + l[0] * c + l[2] * s; out.y = y + l[1] - this.player.eyeHeight; out.z = z - l[0] * s + l[2] * c;
    return out;
  }

  // 街: サーバーの移動の予算（cityroom.js: 動きごとの速さ。歩く・梯子・泳ぐ・乗り越えは MAX_SPEED × moveSpeedFactor、自由落下は
  // horiz × 1.25 + 4、パラシュートは (chuteFwdMax + chuteStrafe) × 1.25 + 3。上向きの移動も数える（梯子・降下は数えない））を少し内側で真似る
  _netMoveGuardCity() {
    const p = this.player, P = MR.NetProto, oc = this.onlineCfg;
    const now = this.net.clock();
    const st = p.state, fall = st === 'fall', chute = st === 'chute';
    const fc = (this.cityOnline && this.cityOnline.fallCfg) || {};
    const walk = P.MAX_SPEED * (oc.moveSpeedFactor || 1.5);
    const full = fall ? (fc.horiz || 24) * 1.25 + 4 : (chute ? ((fc.chuteFwdMax || 12) + (fc.chuteStrafe || 3)) * 1.25 + 3 : walk);
    const rate = full * 0.85;
    const burst = ((fall || chute) ? full * 0.25 + (oc.moveBurst || 2.5) : (oc.moveBurst || 2.5)) * 0.8;
    const catchupMax = oc.moveCatchupMax || 2.0;
    const upCounts = !(st === 'ladder' || fall || chute);
    const s = this._netSent;
    if (!s) { this._netSent = { x: p.pos.x, y: p.pos.y, z: p.pos.z, tok: burst, at: now }; return; }
    const gap = Math.max(0, (now - s.at) / 1000);
    s.at = now;
    s.tok = Math.min(Math.max(burst, rate * Math.min(gap, catchupMax)), s.tok + rate * gap);
    const cost = (x, y, z) => Math.hypot(x - s.x, z - s.z) + (upCounts ? Math.max(0, y - s.y) : 0);
    let c = cost(p.pos.x, p.pos.y, p.pos.z);
    if (c > s.tok && c > 1e-6) {
      // 予算の分だけ進んだ所まで戻す（箱には入れない: カプセルで押し出す）
      const k = s.tok / c;
      const nx = s.x + (p.pos.x - s.x) * k, nz = s.z + (p.pos.z - s.z) * k;
      const ny = upCounts ? s.y + Math.max(0, p.pos.y - s.y) * k + Math.min(0, p.pos.y - s.y) : p.pos.y;
      const q = this.world.nav.resolveCapsule({ x: nx, y: ny, z: nz }, p.radius, 1.8, 0.45, { snapDown: 0 });
      if (cost(q.x, ny, q.z) <= s.tok + 1e-6) { p.pos.set(q.x, ny, q.z); p._apply(); this.netClamps++; }
      c = cost(p.pos.x, p.pos.y, p.pos.z);
    }
    s.tok = Math.max(0, s.tok - c);
    s.x = p.pos.x; s.y = p.pos.y; s.z = p.pos.z;
  }

  // サーバーに拒否されていないか: snap の自分の行には「サーバーが最後に処理した state の番号」（ack）がある。
  // その state が通っていればサーバーの位置はそのとき送った位置と同じ。違う（拒否されて前の位置のまま）状態が
  // snap 3 つ続いたら、サーバーの位置へ戻す（戻した位置はサーバーと同じなので次の state から通る）。
  // ack が進まないあいだ（上りだけ詰まっている。後でまとめて届いて通る）は判断しない
  _netCheckSelf() {
    const net = this.net;
    const ss = net.selfServer;
    if (!ss || ss.t === this._selfSnapT) return;
    this._selfSnapT = ss.t;
    const p = this.player;
    // サーバーは乗っていると思っているのに、こちらは降りている（exit が届かなかった）: 降りると伝え直す（1 秒に 1 回）
    // 街: snap の行がまだ exit を処理する前のもの（ack が exit の後の state に届いていない）なら待つ（行き違いで二重に送らない）
    const exitSeen = !this.cityOnline || !MR.NetProto.isNum(ss.ack) || ss.ack >= (this._exitSeq || 0);
    if (ss.veh >= 0 && !this.vehicle && !p.dead && !this._waitingSpawn && this._pendingEnter < 0 && exitSeen && this.time - (this._exitResentAt || -10) > 1) {
      this._exitResentAt = this.time;
      if (this.cityOnline) this._exitSeq = (this.net._seq || 0) + 1;
      const P = MR.NetProto;
      this.net.send({ t: 'exit', i: ss.veh, p: this.cityOnline ? P.qv([p.pos.x, p.pos.y, p.pos.z]) : [P.q(p.pos.x), P.q(p.pos.z)], yaw: P.qa(p.yawAngle) });
    }
    const riding = !!(this.cityOnline && this.cityOnline.riding);
    if (this.vehicle || p.dead || this._waitingSpawn || riding || ss.veh >= 0 || this.time < this._netSettleUntil || !MR.NetProto.isNum(ss.ack)) { this._netStuck = 0; return; }
    if (ss.ack === this._lastAck) return; // サーバーはまだ新しい state を処理していない（上りが詰まっている）
    this._lastAck = ss.ack;
    let e = null;
    for (let i = this._netSentHist.length - 1; i >= 0; i--) if (this._netSentHist[i].seq === ss.ack) { e = this._netSentHist[i]; break; }
    if (!e || Math.hypot(e.x - ss.x, e.z - ss.z) < 0.05) { this._netStuck = 0; return; } // 通った（または覚えていない古い番号）
    if (++this._netStuck < 3) return;
    console.warn('[Net] サーバーの位置に戻します', ss.x, ss.z, '（端末では', p.pos.x.toFixed(2), p.pos.z.toFixed(2) + '）');
    if (this.cityOnline) {
      // 街: サーバーが最後に受け取った位置（高さも）。落ちる / 立つは次のフレームの動きで決まる
      p.pos.set(ss.x, ss.y, ss.z);
      if (p.state === 'ladder' || p.state === 'vault') { p.state = 'walk'; p.ladder = null; p._vault = null; }
      if (p.state === 'walk') { p.grounded = false; p.peakY = p.pos.y; }
    } else p.pos.set(ss.x, Math.max(0, ss.y), ss.z);
    p.vy = 0;
    p._apply();
    this._lastNetPos.copy(p.pos);
    if (this._lastStepPos) this._lastStepPos.copy(p.pos);
    this.netCorrections++;
    this._netResetMove();
    this._netSettleUntil = this.time + 0.5;
  }

  _updateOnline(dt) {
    const net = this.net;
    // 自分の水平速度（歩き / 走りの判定用）
    const p = this.player;
    const moved = Math.hypot(p.pos.x - this._lastNetPos.x, p.pos.z - this._lastNetPos.z);
    this._netSpeed += (Math.min(moved / Math.max(dt, 1e-3), 40) - this._netSpeed) * Math.min(1, dt * 10);
    this._lastNetPos.copy(p.pos);
    this._netCheckSelf(); // 送る前に（直した位置をこのフレームの state で送る）
    net.update();
    // enter の返事が来ない（届かなかった）ときは 3 秒で諦める
    if (this._pendingEnter >= 0 && this.time - this._pendingEnterAt > 3) this._pendingEnter = -1;
    // 他のプレイヤー
    const s = this._rsample || (this._rsample = {});
    const walking = !p.dead && !this.vehicle;
    const camPos = this.camera.getWorldPosition(this._camWorld || (this._camWorld = new THREE.Vector3()));
    let pushed = false;
    for (const r of this.remotes.values()) {
      if (!r.dead) {
        const st = net.sample(r.id, s);
        // 街: 行が 1 秒以上来ない人（interest の外・輸送ヘリの中）は隠す（退出ではない）
        if (st && !(this.isCity && st.stale)) r.applyState(st);
        else if (this.isCity && r.hasState) r.setAway(true);
      }
      r.update(dt, camPos);
      // 体どうしで重ならないよう、自分だけ押し出す（相手の位置は相手のもの）
      if (walking && r.targetable) {
        const dx = p.pos.x - r.pos.x, dz = p.pos.z - r.pos.z, minD = p.radius + r.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-8 && Math.abs(p.pos.y - r.pos.y) < 1.5) {
          const d = Math.sqrt(d2);
          if (this.isCity) {
            const sol = this.world.nav.resolveCapsule({ x: r.pos.x + dx / d * minD, y: p.pos.y, z: r.pos.z + dz / d * minD }, p.radius, 1.8, 0.45, { snapDown: 0 });
            p.pos.x = sol.x; p.pos.z = sol.z;
          } else {
            const sol = this.world.nav.resolveCircle(r.pos.x + dx / d * minD, r.pos.z + dz / d * minD, p.radius);
            p.pos.x = sol.x; p.pos.z = sol.z;
          }
          pushed = true;
        }
      }
    }
    if (pushed) p._apply();
    this._netTimer -= dt;
    if (this._netTimer <= 0) { this._netTimer = 0.5; this._updateNetHud(); }
  }

  _updateNetHud(force) {
    const net = this.net;
    this.hud.setNet({ status: net.connected ? 'open' : net.status, text: net.statusText, ping: net.hasRtt ? net.rtt : null, players: net.players.size, max: (net.welcome && net.welcome.cfg && net.welcome.cfg.maxPlayers) || this.onlineCfg.maxPlayers });
    if (this.hud.scoreboardOpen || force) {
      const rows = net.scoreboard().map((pl) => ({ id: pl.id, name: pl.name, kills: pl.kills, deaths: pl.deaths, alive: pl.alive, ping: pl.id === net.id && net.hasRtt ? net.rtt : null }));
      this.hud.setScoreboard(rows, net.id);
    }
  }

  // 死亡中（オンライン）: 復活の待ち時間が過ぎたら respawn を送る（返事の spawn が来なければ 1.5 秒ごとに送り直す）
  _updateOnlineDeath(dt) {
    // 街のバトロワ: 1 回だけの命（respawn は送らない）。やられた・途中から来た人は観戦（cityonline.js）
    if (this._spawnHeld) return; // v2 の街: サーバーは置いた。復活の場所のタイルを待っている（_onSpawnCity）
    if (this.cityOnline && this.cityOnline.isRoyale) { this.cityOnline.updateDead(dt || 0); return; }
    if (this._waitingSpawn) {
      // 接続直後: spawn が来ないまま 3 秒経ったら頼む（サーバーは hello の直後に spawn を送るので通常は来る）
      if (this.time - this._waitingSince > 3 && this.time >= (this._spawnAskAt || 0)) {
        this._spawnAskAt = this.time + 3;
        this.net.send({ t: 'respawn' });
      }
      return;
    }
    const left = this.respawnAt - this.time;
    const sec = Math.max(0, Math.ceil(left));
    if (sec !== this._deathSec) {
      this._deathSec = sec;
      this.hud.setDeathInfo(null, sec > 0 ? sec + ' 秒後に復活します' : '復活中…');
    }
    if (left <= 0 && this.net.connected) {
      this.respawnAt = this.time + 1.5;
      this.net.send({ t: 'respawn' });
    }
  }

  // 自分の射撃（オンライン）: 当たり判定は自分の画面で。相手ごとにダメージをまとめて hit、乗り物は vhit。HP は減らさない
  _resolveShotsOnline(dirs, def) {
    const P = MR.NetProto;
    const origin = this.player.eyePosition(this._tmpV1);
    const muzzle = this.weapon.muzzleWorldPosition(this._tmpV2);
    const headMult = this.config.enemies.headshotMultiplier || 2;
    const hits = new Map();   // 相手 id → { dmg, head, pt }
    const vhits = new Map();  // 乗り物番号 → dmg
    let anyHit = false;
    let impactSound = false;
    const canImpact = typeof this.audio.impact === 'function';
    const d = [];
    for (const dir of dirs) {
      d.push(P.qd([dir.x, dir.y, dir.z]));
      const wall = this.world.nav.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range);
      const maxT = wall ? wall.t : def.range;
      let best = null;
      for (const r of this.remotes.values()) {
        const h = r.intersectRay(origin, dir, maxT);
        if (h && (best === null || h.t < best.t)) { best = h; best.remote = r; }
      }
      let vhit = null;
      for (const v of this.vehicles) {
        if (v === this.vehicle) continue;
        const h = v.intersectRay(origin, dir, best ? best.t : maxT);
        if (h && (vhit === null || h.t < vhit.t)) { vhit = h; vhit.vehicle = v; }
      }
      let end;
      if (vhit && (!best || vhit.t < best.t)) {
        const v = vhit.vehicle;
        this.fx.impact(vhit.point, vhit.normal);
        if (!impactSound && canImpact) { this.audio.impact('metal', vhit.point); impactSound = true; }
        if (!v.wrecked) { vhits.set(v.netIndex, (vhits.get(v.netIndex) || 0) + def.damage); anyHit = true; }
        end = vhit.point;
      } else if (best) {
        const r = best.remote;
        const e = hits.get(r.id) || { dmg: 0, head: 0, pt: best.point.clone() };
        e.dmg += def.damage * (best.head ? headMult : 1);
        if (best.head) e.head = 1;
        hits.set(r.id, e);
        r.flinch();
        this.fx.hitFlesh(best.point, dir);
        if (!impactSound && canImpact) { this.audio.impact('flesh', best.point); impactSound = true; }
        anyHit = true;
        end = best.point;
      } else if (wall) {
        end = new THREE.Vector3(wall.x, wall.y, wall.z);
        this.fx.impact(end, new THREE.Vector3(wall.nx, wall.ny, wall.nz));
        if (this.destruct && wall.box && wall.box.cat) this.structHit({ x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz, radius: 0.5, damage: def.damage, edge: 0, kind: 'bullet', weapon: def.id, box: wall.box }); // 小物・外壁の升（destruct-2 R3）
        if (!impactSound && canImpact) {
          this.audio.impact(this._impactSurface(wall, end), end);
          impactSound = true;
        }
      } else {
        end = origin.clone().addScaledVector(dir, def.range);
      }
      this.fx.tracer(muzzle, end, false);
    }
    const o = P.qv([origin.x, origin.y, origin.z]);
    // 射撃の通し番号: サーバーは同じ n の fire が通った後の hit / vhit だけを数え、散弾の弾は n でまとめる
    const n = ++this._shotN;
    // 街: 次の state と同じ束で送る（Cloudflare の数え方で 1 通）。落ちながら撃ったときは state を前倒し（撃った位置と state の位置を近くに）
    const send = this.cityOnline ? (m) => this.net.queue(m) : (m) => this.net.send(m);
    if (this.cityOnline) {
      const pl = this.player;
      if (Math.abs(pl.vy || 0) > 3 || (this._netSent && Math.abs(pl.pos.y - this._netSent.y) > 0.3)) this.net.requestState();
      if (this.play) this.play.noteShot(def.id);
    }
    send({ t: 'fire', n, w: def.id, o, d });
    for (const [id, e] of hits) {
      send({ t: 'hit', n, target: id, w: def.id, dmg: Math.round(e.dmg * 1000) / 1000, head: e.head, o, pt: P.qv([e.pt.x, e.pt.y, e.pt.z]) });
    }
    for (const [i, dmg] of vhits) send({ t: 'vhit', n, i, w: def.id, dmg, o });
    this.player.kick((def.recoil || 0.05) * 8);
    this.fovKick += def.id === 'shotgun' ? 2.5 : 0.8;
    if (anyHit) { this.hud.hit(false); this.audio.hit(); }
  }

  // 運転中に他のプレイヤーをはねた（判定は自分の画面、撃破はサーバー）。同じ相手には 0.5 秒に 1 回。
  // 当たるのは車体の進む側（前進なら前寄り、後退なら後ろ寄り）だけ（サーバーも後ろ半分は数えない）。
  // サーバーは最後の vstate の車の位置で確かめるので、今の位置の vstate を先に送る
  _checkRunOver() {
    const v = this.vehicle;
    if (!v || v.wrecked || Math.abs(v.speed) < v.def.runOverSpeed) return;
    const P = MR.NetProto;
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    const hw = v.def.width / 2, hl = v.def.length / 2;
    const dir = v.speed > 0 ? 1 : -1;
    let sentPose = false;
    for (const r of this.remotes.values()) {
      if (!r.targetable) continue;
      if (this.isCity && Math.abs(r.pos.y - v.pos.y) > 1.8) continue; // 街: 高さの違う人（高架の上と下・屋上）
      const dx = r.pos.x - v.pos.x, dz = r.pos.z - v.pos.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) >= hw + r.radius || Math.abs(lz) >= hl + r.radius) continue;
      if (dir * lz < -hl * 0.25) continue; // 進む向きの反対側（車が離れていく）
      if (this.time - (this._runoverSent[r.id] || -10) < 0.5) continue;
      this._runoverSent[r.id] = this.time;
      if (!sentPose) {
        sentPose = true;
        if (this.cityOnline) this.net.queue(this._vstateCity(v));
        else this.net.send({ t: 'vstate', i: v.netIndex, p: [P.q(v.pos.x), P.q(v.pos.z)], yaw: P.qa(v.yaw), sp: P.q(v.speed), st: P.qa(v.steer) });
      }
      this.net.send({ t: 'runover', target: r.id, i: v.netIndex });
      const p = this._tmpV3.set(r.pos.x, (this.isCity ? r.pos.y : 0) + 0.9, r.pos.z);
      this.fx.hitFlesh(p, v.forward());
      if (typeof this.audio.impact === 'function') this.audio.impact('flesh', p);
    }
  }

  // 街の spawn（3D）: 自分ならそこへ（持ち物もサーバーの物に）、他の人なら兵士を立たせる
  _onSpawnCity(m) {
    const P = MR.NetProto, me = this.net.id;
    if (m.id === me) {
      if (this.vehicle) this._exitVehicle(true);
      // v2 の街の読み込み中の spawn（ld: 1。復活・範囲の入れ替え・切れた後の再開でサーバーが「読み込み中」にした。その間は他の人の snap に
      //   出ず撃たれない）: state を止め、その場所の 3 × 3 のタイルが届いたら ready。置くのはサーバーの次の spawn（ld なし）
      if (m.ld) {
        this.net.loading = true;
        this._ldSpawn = m;
        this._spawnHeld = true;
        this._waitingSpawn = false;
        const go = () => { if (this._ldSpawn !== m) return; this._ldSpawn = null; this.net.ready(); };
        if (this._tileHold(m.p[0], m.p[2], go)) { this.player.dead = true; this.hud.setDeathInfo(null, '街のデータを読み込み中…', null); } else go();
        return;
      }
      this._ldSpawn = null;
      this.net.loading = false; // サーバーが置いた（ready の返事・再開の spawn）
      // v2 の街: 復活の場所の周り 3 × 3 のタイルがまだなら、届くまで死んだまま待つ（撃てない・動かない・state を送らない・
      //   respawn を送り直さない）。届いたらこの spawn をもう一度（読み込み中を知らない古いサーバー: 置いてから待つ）
      this._spawnHeld = false;
      if (this._tileHold(m.p[0], m.p[2], () => { this._spawnHeld = false; this._onSpawnCity(m); })) {
        this._spawnHeld = true;
        this._waitingSpawn = false;
        this.player.dead = true;
        this.hud.setDeathInfo(null, '街のデータを読み込み中…', null);
        return;
      }
      const yawDeg = P.isNum(m.yaw) ? THREE.MathUtils.radToDeg(m.yaw) : 0;
      this.player.dead = false;
      this.placePlayer(m.p[0], m.p[2], m.p[1] + 0.5, yawDeg);
      this.player.dead = false;
      this.player.pitchAngle = 0;
      if (P.isNum(m.hp)) this.player.health = m.hp;
      this._waitingSpawn = false;
      this.cityOnline.onSpawnSelf(m);
      this.hud.setHealth(this.player.health, this.config.player.maxHealth);
      this.hud.showDeath(false);
      this.hud.setDeathInfo('やられた', '数秒後に復活します', '');
      this._lastNetPos.copy(this.player.pos);
      this._netSpeed = 0;
      this._netResetMove();
      if (this.running && typeof this.audio.music === 'function') this.audio.music((this.config.audio || {}).musicName || 'music_combat');
    } else {
      let r = this.remotes.get(m.id);
      if (!r) { const info = this.net.players.get(m.id); if (info) r = this._addRemote(info); }
      if (r) r.spawn(m.p[0], m.p[2], m.yaw, m.p[1]);
    }
  }

  _setVehicleDriver(v, id, quiet) {
    const me = this.net.id;
    if (id === me) return;
    if (this.vehicle === v) this._exitVehicle(true); // サーバーが運転手を外した
    if (id >= 0) {
      if (!v.driver || !v.driver.remote || v.driver.id !== id) {
        if (quiet) v.driver = { remote: true, id };
        else { v.enter({ remote: true, id }); v.driver = { remote: true, id }; }
      }
    } else if (v.driver && v.driver.remote) {
      if (quiet) v.clearDriver(); // 音（ドア）を鳴らさずに外す。エンジン音は止める
      else v.exit();
    }
  }

  _weaponLabel(w, by) {
    const has = (o, k) => !!o && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
    const def = has(this._weaponDefs, w) ? this._weaponDefs[w] : null;
    if (def) return def.name || w;
    const types = (this.config.vehicles || {}).types || {};
    if (has(types, w)) return (types[w].name || w) + (by === 'explosion' ? 'の爆発' : '');
    if (by === 'explosion') return '爆発';
    if (by === 'vehicle') return '車';
    // 街: 落下・安全地帯（city_dm は試合範囲の外）・退出
    if (by === 'fall') return '落下';
    if (by === 'fire') return '炎に巻かれた';
    if (by === 'collapse') return '倒壊';
    if (by === 'zone') return this.cityOnline && !this.cityOnline.isRoyale ? '範囲の外' : '安全地帯';
    if (by === 'leave') return '退出';
    return w || '';
  }

  // サーバーからのメッセージ
  _onNet(m) {
    const net = this.net;
    const me = net.id;
    const P = MR.NetProto;
    const co = this.cityOnline;
    if (co) {
      // 街だけのメッセージ・乗り物（番号は vehicleSpawns の順。作ってある物だけ見た目に当てる）
      switch (m.t) {
        case 'vowner': case 'vseat': case 'vdamage': case 'vexplode': case 'vrespawn': co.onVehicleMsg(m); return;
        case 'picked': if (this.play) this.play.onPicked(m); return;
        case 'loot': if (this.play) this.play.onLootMsg(m); return;
        case 'inv': if (this.play) this.play.applyServerInv(m.inv); return;
        case 'heal': if (this.play) this.play.onHealMsg(m); return;
        case 'area': co._setArea(m); return;
        case 'round': co._setRound(m); return;
        case 'jumped': co.onJumped(m); return;
        case 'lifted': // エレベーター: 自分は lift.js、他の人は spawn と同じく補間しないで置く
          if (m.id === me) { if (this.lift) this.lift.onLifted(m); } else if (!m.no && P.isVec(m.p, 3)) { const r = this.remotes.get(m.id); if (r) r.spawn(m.p[0], m.p[2], m.yaw, m.p[1]); }
          return;
        case 'result': co.onResult(m); return;
        default: break;
      }
    }
    switch (m.t) {
      case 'welcome':
        if (m !== this._appliedWelcome) this._applyWelcome(m, false); // 開始時のものは _startOnline で当て済み
        break;
      case 'join':
        if (m.player) { this._addRemote(m.player); this.hud.showMessage(m.player.name + ' が参加しました', 1500); }
        this._updateNetHud(true);
        break;
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (r) { this.hud.showMessage(r.name + ' が退出しました', 1500); r.dispose(); this.remotes.delete(m.id); }
        this._updateNetHud(true);
        break;
      }
      case 'fire': {
        const r = this.remotes.get(m.id);
        if (r) r.onFire(m, this.player.dead ? null : this.player.eyePosition(this._tmpV3));
        break;
      }
      case 'damage':
        if (m.target === me) {
          if (this.player.dead) break;
          if (P.isNum(m.hp)) this.player.health = Math.max(0, m.hp);
          this.hud.setHealth(this.player.health, this.config.player.maxHealth);
          this.hud.damage();
          if (this.lift && this.lift.open) this.lift.closePanel(); // エレベーターの板は閉じる（板の間は撃つボタンが隠れている）
          // 街: 防具の残り（ar）、安全地帯・落下は静かに（音と揺れは別に出している）
          const quiet = co ? co.onDamageSelf(m) === 'quiet' : false;
          if (!quiet) {
            this.audio.hurt();
            this.shake = Math.min(1.5, this.shake + 0.6);
          }
        } else {
          const r = this.remotes.get(m.target);
          if (r) r.flinch();
        }
        break;
      case 'kill': {
        const killer = net.playerName(m.attacker);
        const victimName = net.playerName(m.target);
        const wl = this._weaponLabel(m.w, m.by);
        const self = m.attacker !== m.target && m.attacker >= 0;
        if (co) co.onKill(m);
        this.hud.addKillFeed(self ? killer : '', victimName, wl, { self: m.attacker === me, victim: m.target === me, head: !!m.head });
        if (m.attacker === me && m.target !== me) {
          if (P.isNum(m.kills)) this.kills = m.kills; else this.kills++;
          this.hud.setKills(this.kills);
          this.hud.hit(true);
          this.audio.kill();
        }
        if (m.target === me) {
          if (this._spawnHeld) { this._spawnHeld = false; this._placeHold = null; this._ldSpawn = null; this.net.loading = false; this.player.dead = false; } // 置かれるのを待つ間にやられた
          if (!this.player.dead) {
            this.player.health = 0;
            this.player.dead = true;
            this._waitingSpawn = false;
            const delay = (net.welcome && net.welcome.cfg && P.isNum(net.welcome.cfg.respawnDelay)) ? net.welcome.cfg.respawnDelay : (this.onlineCfg.respawnDelay || P.RESPAWN_DELAY);
            this._onPlayerDied(delay);
            this.hud.setHealth(0, this.config.player.maxHealth);
            this._deathSec = -1;
            this.hud.setDeathInfo('やられた', '', self ? killer + ' にやられた（' + wl + '）' : (wl ? '（' + wl + '）' : ''));
            // バトロワ: 順位を出して、少ししたら観戦に切り替わる（復活は無い）
            if (co && co.isRoyale) this.hud.setDeathInfo(null, (P.isNum(m.rank) ? '#' + m.rank + ' / ' + Math.max(m.rank, co.total || 0) + '　' : '') + 'まもなく観戦', null);
          }
        } else {
          const r = this.remotes.get(m.target);
          if (r) {
            let dir = null;
            const a = m.attacker === me ? this.player.pos : (this.remotes.get(m.attacker) || {}).pos;
            if (a) dir = new THREE.Vector3(r.pos.x - a.x, 0, r.pos.z - a.z).normalize();
            r.die(dir);
          }
        }
        this._updateNetHud(true);
        break;
      }
      case 'spawn': {
        if (co && P.isVec(m.p, 3)) { this._onSpawnCity(m); break; }
        if (!P.isVec(m.p, 2)) break;
        if (m.id === me) {
          if (this.vehicle) this._exitVehicle(true);
          const yawDeg = P.isNum(m.yaw) ? THREE.MathUtils.radToDeg(m.yaw) : 0;
          this.player.spawn(m.p[0], m.p[1], yawDeg);
          if (P.isNum(m.hp)) this.player.health = m.hp;
          this._waitingSpawn = false;
          this.hud.setHealth(this.player.health, this.config.player.maxHealth);
          this.hud.showDeath(false);
          this.hud.setDeathInfo('やられた', '数秒後に復活します', '');
          this._wasGrounded = true;
          this._stepDist = 0; this._stepTime = 0;
          if (this._lastStepPos) this._lastStepPos.copy(this.player.pos);
          this._lastNetPos.copy(this.player.pos);
          this._netSpeed = 0;
          this._netResetMove(); // サーバーも予算を満タンにしている（room.js _resetMove）
          if (this.running && typeof this.audio.music === 'function') this.audio.music((this.config.audio || {}).musicName || 'music_combat');
        } else {
          let r = this.remotes.get(m.id);
          if (!r) { const info = net.players.get(m.id); if (info) r = this._addRemote(info); }
          if (r) r.spawn(m.p[0], m.p[1], m.yaw);
        }
        break;
      }
      case 'vowner': {
        const v = this.vehicles[m.i];
        if (!v) break;
        if (m.id === me) {
          if (this._pendingEnter === m.i && !this.player.dead && !this.vehicle) {
            this._pendingEnter = -1;
            v.driver = null;
            this._enterVehicle(v, true);
          } else if (this.vehicle !== v) {
            // 頼んでいないのに自分になった（古い enter の返事など）: 降りると伝える
            this.net.send({ t: 'exit', i: m.i, p: [P.q(this.player.pos.x), P.q(this.player.pos.z)], yaw: P.qa(this.player.yawAngle) });
          }
        } else {
          if (this._pendingEnter === m.i) { this._pendingEnter = -1; this.hud.showMessage('乗れません', 900); }
          this._setVehicleDriver(v, m.id, false);
        }
        break;
      }
      case 'vdamage': {
        const v = this.vehicles[m.i];
        if (!v) break;
        const before = v.health;
        v.setHealth(m.hp);
        if (v === this.vehicle && v.health < before) { this.hud.damage(); this.shake = Math.min(1.5, this.shake + 0.15); }
        break;
      }
      case 'vexplode': {
        const v = this.vehicles[m.i];
        if (v) v.netExplode(this._vehicleCtx());
        if (this._pendingEnter === m.i) this._pendingEnter = -1;
        break;
      }
      case 'vrespawn': {
        const v = this.vehicles[m.i];
        if (!v) break;
        if (v === this.vehicle) this._exitVehicle(true);
        v.driver = null;
        v.netRespawn(P.isVec(m.p, 2) ? m.p[0] : null, P.isVec(m.p, 2) ? m.p[1] : null, m.yaw, m.hp);
        break;
      }
      case 'error':
        if (m.code === 'rate') console.warn('[Net] サーバーのレート制限');
        break;
      default:
        break;
    }
  }

  // ---------- 武器 ----------

  _selectWeapon(index, silent) {
    if (this.melee && this.melee.busy) this.melee.cancel(); // 拾った武器に持ち替えた（振っている途中）: 先にナイフをしまう
    const prevAds = this.weapon ? { _ads: this.weapon.ads, _adsBlend: this.weapon.adsBlend } : null;
    if (this.weapon) { this.weapon.cancelReload(); this.weapon.setVisible(false); }
    this.weaponIndex = index;
    this.weapon = this.weapons[index];
    this.weapon.setVisible(true);
    // 照準したまま持ち替えたら、FOV が一瞬戻って入り直す／照準音が鳴り直すのを防ぐ
    if (prevAds && typeof this.weapon.inheritAds === 'function') this.weapon.inheritAds(prevAds);
    this.weapon.nextFire = this.time + 0.35;
    this.hud.setWeapon(this.weapon.def.name, index);
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve, false);
    if (!silent) this.hud.showMessage(this.weapon.def.name, 900);
    if (!silent && typeof this.audio.swap === 'function') this.audio.swap();
  }

  // ---------- 敵 ----------

  _spawnEnemy() {
    const pts = this.level.spawnPoints || [[30, 30]];
    const minD = this.config.enemies.minSpawnDistance || 15;
    let chosen = pts[Math.floor(Math.random() * pts.length)];
    // 死んでいる間は、選んでいる復活の場所（respawn.js の target。番号の地点は敵の出る所と同じ）の近くにも出さない
    const tg = this._deathUI && this._deathUI.target;
    for (let i = 0; i < 8; i++) {
      const c = pts[Math.floor(Math.random() * pts.length)];
      if (Math.hypot(c[0] - this.player.pos.x, c[1] - this.player.pos.z) >= minD && !(tg && Math.hypot(c[0] - tg.x, c[1] - tg.z) < minD)) { chosen = c; break; }
    }
    const free = this.world.nav.nearestFree(chosen[0], chosen[1]);
    this.enemies.push(new MR.Enemy(this.scene, this.config.enemies, free.x, free.z));
  }

  // 街: (x, y, z) に敵を 1 体出す（テスト・撮影用。role: hunter / climber / overwatch）
  spawnCityEnemy(x, y, z, role) {
    if (!this.director) this.director = new MR.EnemyDirector(this, Object.assign({}, this.cityCfg, { enemyCount: 0 }));
    const e = this.director.spawnAt(x, y, z, role === 'overwatch' ? 'roof' : 'street', null);
    if (role) e.role = role;
    return e;
  }

  // tools/screenshot.js が使う: 指定位置の近くに敵を 1 体出して返す
  _spawnEnemyAt(x, z) {
    const free = this.world.nav.nearestFree(x, z);
    const e = new MR.Enemy(this.scene, this.config.enemies, free.x, free.z);
    this.enemies.push(e);
    return e;
  }

  // オンラインをやめて開始画面に戻る（スコアボード・接続の帯の「タイトルへ」）。接続を閉じてからページを読み直す
  // （ゲームデータは端末に保存済みなので、読み直しはダウンロードせずに開始画面まで進む）
  // opts.again: 'royale' など。main.js の opts.onAgain があれば読み直さずにその場で新しいゲームを始める（失敗したら読み直して
  // 開始画面でそのモードを選んだ状態にする: mirrsona.autostart）
  leaveToTitle(opts) {
    if (this._leaving) return;
    this._leaving = true;
    if (MR.Session) MR.Session.clear(); // ふつうに終えた: 次の起動で続きから始めない
    if (opts && opts.again && typeof this.opts.onAgain === 'function') {
      try { if (this.opts.onAgain(String(opts.again), this) !== false) return; } catch (e) { console.warn('[Game] もう一度', e); }
    }
    if (opts && opts.again) Game._savePref('autostart', String(opts.again));
    try { this.stop(); } catch (e) { console.warn('[Game] stop', e); }
    if (typeof window !== 'undefined' && window.MR_GAME === this) window.MR_GAME = null;
    if (typeof location !== 'undefined' && location.reload) setTimeout(() => location.reload(), 50);
  }

  // ---------- GPU のテクスチャ（「もう一度」の後。render.gpuTextures）----------
  // main.js の settleMaterials は前のゲームの使っていないテクスチャ（兵士・乗り物の GLB など）を GPU から捨てる。捨てるのは新しい場面が
  //   組み上がってから（releaseAfter 秒。ゲームの時間）: 始めた直後は街の材質・ランドマーク・空・最初の敵がまだ場面に無く、捨てたものを
  //   次のフレームで全部上げ直していた（S7c: 街：フリー →「もう一度」で 1 フレームに 46〜85 MB）
  scheduleGpuRelease(fn) {
    const c = (this.config.render && this.config.render.gpuTextures) || {};
    const after = typeof c.releaseAfter === 'number' ? c.releaseAfter : 4;
    if (!(after > 0)) { fn(); return; }
    this._gpuRelease = { fn, at: this.time + after };
  }

  // 兵士・乗り物の形のテクスチャで GPU に無いもの（捨てた後・初めて）を 1 フレーム warmPerFrame 個ずつ先に上げる。
  //   乗り物は視野で切られるので、視野の外で出た物は見える前に上がる（チャンクの乗り物・GLB への差し替えは warmScan 秒ごとに見る）。
  //   兵士はスキンメッシュで視野で切らない（character_glb.js の frustumCulled = false）= 出たフレームに視野の外でも描かれて全部上がるので、
  //   出たフレームの描画の前（_gpuTexPreDraw）に見つけ、上がりきるまで隠す（hide。director は視野の外に出す。S7c: 兵士と銃で 1 フレームに 30〜46 MB）
  warmTexturesOf(root, opts) {
    if (!root || !this._gpuTexOk()) return 0;
    const q = this._warmQ || (this._warmQ = []);
    const pend = [];
    MR.AssetManager.texturesIn([root]).forEach((t) => { if (!this._texOnGpu(t)) pend.push(t); });
    if (!pend.length) return 0;
    if (opts && opts.hide && root.visible) {
      root.visible = false;
      (this._warmHidden || (this._warmHidden = [])).push({ root, tex: pend, at: this.time });
      q.unshift(...pend); // 隠している物を先に
    } else q.push(...pend);
    return pend.length;
  }

  _texOnGpu(t) {
    const im = t.image;
    if (!im || im.width === 0 || t.version === 0 || t.isRenderTargetTexture) return true; // 上げられない・上げる物が無い
    const p = this.renderer.properties.get(t);
    return p.__webglTexture !== undefined && p.__version === t.version;
  }

  _gpuTexCfg() { return (this.config.render && this.config.render.gpuTextures) || {}; }
  _gpuTexOk() { const r = this.renderer; return !!(r && r.properties && typeof r.properties.get === 'function' && typeof r.initTexture === 'function'); } // テストの偽のレンダラーには無い

  // _update の最初: 先送りした解放・乗り物の見回り・1 フレーム分の upload・隠していた兵士を戻す
  _gpuTexStep() {
    if (this._gpuRelease && this.time >= this._gpuRelease.at) {
      const r = this._gpuRelease; this._gpuRelease = null;
      try { r.fn(); } catch (e) { console.warn('[Game] GPU の解放', e); }
    }
    const c = this._gpuTexCfg();
    if (this._warmLm) this._warmLandmarkStep(c);
    this._gpuSweepStep();
    const per = typeof c.warmPerFrame === 'number' ? c.warmPerFrame : 1;
    if (!(per > 0) || !this._gpuTexOk()) return;
    this._warmT = (this._warmT || 0) - (this.time - (this._warmLast == null ? this.time : this._warmLast));
    this._warmLast = this.time;
    if (this._warmT <= 0) {
      this._warmT = typeof c.warmScan === 'number' ? c.warmScan : 0.25;
      const seen = this._warmSeen || (this._warmSeen = new WeakMap());
      for (const v of this.vehicles || []) if (v.root && v.model && seen.get(v.root) !== v.model) { seen.set(v.root, v.model); this.warmTexturesOf(v.root); }
    }
    const q = this._warmQ;
    let n = 0;
    while (q && q.length && n < per) {
      const t = q.shift();
      if (this._texOnGpu(t)) continue;
      try { this.renderer.initTexture(t); } catch (e) { /* 次の描画に任せる */ }
      n++;
    }
    const h = this._warmHidden;
    if (h && h.length) {
      // hideMax 秒（ゲームの時間）で必ず戻す: 待ちから外れたテクスチャ・initTexture の失敗・文脈の作り直しで、見えないまま撃つ敵を残さない
      const hideMax = typeof c.hideMax === 'number' ? c.hideMax : 2;
      for (let i = h.length - 1; i >= 0; i--) {
        const e = h[i];
        if (this.time - e.at >= hideMax || e.tex.every((t) => this._texOnGpu(t))) { e.root.visible = true; h.splice(i, 1); }
      }
    }
  }

  // 場面で使っていないテクスチャを GPU から捨てる（render.gpuSweep。iPhone の GPU のメモリの余裕 = mem 計画）。every 秒ごとに場面
  //   （本体 + ビューモデル）と持っている武器が使うテクスチャを集め、読み込んだテクスチャ（assets の画像・GLB・その縮めた写し）で after 秒
  //   続けて使われていない GPU の物を 1 回 max 個まで dispose する（画像は残る）。どの素材も同じ扱い（後から足す素材も特別なコード無しで）。
  //   捨てない: keep のパス（空・天気・水・腕。天気や時間で入れ替わる物）、持っている武器、場面にある物（乗っている乗り物・背景・環境）。
  //   HUD・Canvas の物は assets の物ではないので対象外。上げ直すのは _gateDraw（1 フレーム gateMB まで。超える分は描くのを次のフレームへ）
  _gpuSweepStep() {
    const c = this.rs && this.rs.gpuSweep;
    if (!c || c.enabled === false || !this.assets || !this._gpuTexOk()) return;
    this._installDrawGate();
    const st = this._sweepStats;
    if (!this._sweepJob) {
      if (this._sweepAt != null && this.time < this._sweepAt) return;
      this._sweepAt = this.time + (c.every > 0 ? c.every : 2);
      this._sweepJob = this._sweepGen(c);
    }
    // 場面をなめるのは 1 フレーム sliceMs まで（街は物が多く、1 回でなめると 6〜20 ms）
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const budget = c.sliceMs > 0 ? c.sliceMs : 1;
    let r;
    try { r = this._sweepJob.next(t0 ? () => performance.now() - t0 > budget : () => false); } catch (e) { r = { done: true }; console.warn('[Game] gpuSweep', e); }
    if (r.done) this._sweepJob = null;
    if (t0) { const ms = performance.now() - t0; if (!(st.msMax >= ms)) st.msMax = ms; }
  }

  // 1 回の見回り（ジェネレーター。next(over) の over() が true なら次のフレームへ）
  *_sweepGen(c) {
    let over = yield;
    const A = this.assets, SL = MR.AssetManager.TEXTURE_SLOTS, st = this._sweepStats;
    // 場面のテクスチャ（材質ごとに 1 回だけ見る。texturesIn は材質の全部のキーを見るので街で 20 ms を超えた）
    const used = new Set(), mseen = new Set();
    const addMat = (m) => {
      if (!m || mseen.has(m)) return;
      mseen.add(m);
      for (let i = 0; i < SL.length; i++) { const t = m[SL[i]]; if (t) used.add(t); }
      for (const u of [m.uniforms, m.userData && m.userData.uniforms]) if (u) for (const k in u) { const v = u[k] && u[k].value; if (v && v.isTexture) used.add(v); }
    };
    const roots = [this.scene, this.viewScene];
    // 持っている武器（街は枠の武器、アリーナは全部）・乗っている乗り物も（場面の外にあっても）
    const inv = this.play && this.play.inv;
    const held = inv && inv.slots ? new Set(inv.slots.filter(Boolean).map((sl) => sl.id)) : null;
    for (const w of this.weapons || []) if (w && w.group && (!held || held.has(w.def.id))) roots.push(w.group);
    if (this.vehicle && this.vehicle.root) roots.push(this.vehicle.root);
    // このレベルの材質（Materials のセット）と街の小物の部品は場面に無くても残す（main.js の settleMaterials と同じ: 高い所から降りると
    //   チャンクがまとめて出来て、外壁の材質を何十フレームも上げ直していた）
    const sets = this.materials && this.materials.sets;
    if (sets) for (const nm in sets) { const sx = sets[nm]; if (sx && sx.textures) for (const tk in sx.textures) if (sx.textures[tk]) used.add(sx.textures[tk]); }
    const pr = this.world && this.world.props;
    if (pr && pr.kinds) for (const ty in pr.kinds) { const kd = pr.kinds[ty]; for (const pp of (kd && kd.parts) || []) if (pp.mat) addMat(pp.mat); }
    const stack = [];
    for (const root of roots) {
      if (!root) continue;
      if (root.background && root.background.isTexture) used.add(root.background);
      if (root.environment && root.environment.isTexture) used.add(root.environment);
      stack.push(root);
    }
    let k = 0;
    while (stack.length) {
      const o = stack.pop();
      const m = o.material;
      if (m) { if (Array.isArray(m)) for (let i = 0; i < m.length; i++) addMat(m[i]); else addMat(m); }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
      if ((++k & 255) === 0 && over()) over = (yield) || over;
    }
    st.sweeps++;
    // 捨てる候補（assets の画像・GLB・縮めた写し）: 読み込みの数が変わったときだけ作り直す
    const nk = Object.keys(A._texLoaded).length + ':' + Object.keys(A._modelLoaded).length + ':' + ((MR.AssetManager.lowCopies || []).length);
    if (this._sweepKey !== nk || st.sweeps % 15 === 0) { // 数が同じでも入れ替わることがある（forgetTexture と新しい読み込み）
      this._sweepKey = nk;
      const keepPaths = Array.isArray(c.keep) ? c.keep : ['sky/', 'weather', 'water/', 'arms.glb', 'knife.glb'];
      const kept = (key) => { for (const kp of keepPaths) if (key.indexOf(kp) >= 0) return true; return false; };
      const cand = new Set(), cm = new Set();
      for (const key in A._texLoaded) { const t = A._texLoaded[key]; if (t && t.isTexture && !kept(key)) cand.add(t); }
      const scan = (sc) => sc.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const mm of ms) { if (cm.has(mm)) continue; cm.add(mm); for (const sl of SL) if (mm[sl] && mm[sl].isTexture) cand.add(mm[sl]); }
      });
      for (const key in A._modelLoaded) { const g = A._modelLoaded[key]; if (g && g.scene && !kept(key)) scan(g.scene); }
      for (const sc of MR.AssetManager.lowCopies || []) scan(sc);
      this._sweepCand = Array.from(cand);
    }
    const last = this._sweepSeen || (this._sweepSeen = new WeakMap());
    const after = typeof c.after === 'number' ? c.after : 20, max = c.max > 0 ? c.max : 16;
    const q = this._warmQ || (this._warmQ = []);
    let n = 0;
    for (const t of this._sweepCand) {
      if (used.has(t)) {
        last.set(t, this.time);
        // 捨てた物が場面に戻った（視野の外・まだ描いていない）: 描く前に 1 フレーム warmPerFrame 個ずつ上げる
        if (this._swept.has(t) && !this._texOnGpu(t) && q.indexOf(t) < 0) { q.push(t); st.prewarm = (st.prewarm || 0) + 1; }
        continue;
      }
      if (!last.has(t)) { last.set(t, this.time); continue; }
      if (n >= max || this.time - last.get(t) < after) continue;
      const im = t.image;
      if (!im || im.width === 0 || t.isRenderTargetTexture) continue; // 閉じた画像は上げ直せない
      const p = this.renderer.properties.get(t);
      if (p.__webglTexture === undefined) continue; // GPU に無い
      st.mb += this._texBytes(t) / 1048576;
      t.dispose();
      this._swept.add(t);
      last.set(t, this.time);
      st.released++; n++;
    }
  }

  _texBytes(t) {
    const im = t && t.image;
    return im && im.width ? im.width * im.height * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1) : 0;
  }

  // 捨てたテクスチャ（_swept）を使う描画は、そのフレームで上げ直す量が gateMB を超えるなら次のフレームへ送る（描かない）。
  //   一度に戻って来ても 1 フレームの upload を抑える（S7c / S7d の先上げと同じ考え）。上げ直した物は _swept から外れる
  _installDrawGate() {
    if (this._swept) return;
    const r = this.renderer;
    this._swept = r.__mrSwept || (r.__mrSwept = new WeakSet()); // 前のゲームが捨てた物も同じ扱い（同じレンダラー）
    this._sweepStats = { sweeps: 0, released: 0, mb: 0, msMax: 0, reup: 0, reupMB: 0, frameMB: 0, frameMBMax: 0, deferred: 0, deferFrames: 0 };
    r.__mrGateGame = this; // 「もう一度」は同じレンダラーを使うので、包むのは 1 回だけ（前のゲームを持たない）
    if (r.__mrGate || typeof r.renderBufferDirect !== 'function') return;
    const orig = r.renderBufferDirect, SL = MR.AssetManager.TEXTURE_SLOTS;
    r.__mrGate = true;
    r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const self = r.__mrGateGame;
      if (material && self && self._swept) {
        let need = 0, list = null;
        for (let i = 0; i < SL.length; i++) {
          const t = material[SL[i]];
          if (t && self._swept.has(t) && !self._texOnGpu(t)) { need += self._texBytes(t); (list || (list = [])).push(t); }
        }
        if (list) {
          const st = self._sweepStats, cap = ((self.rs.gpuSweep && self.rs.gpuSweep.gateMB) || 8) * 1048576;
          if (st.frameMB > 0 && st.frameMB + need > cap) { st.deferred++; st._deferNow = true; return; }
          st.frameMB += need; st.reup += list.length; st.reupMB += need / 1048576;
          for (const t of list) self._swept.delete(t);
        }
      }
      return orig.apply(this, arguments);
    };
  }

  // フレームの始め: 上げ直しの量を数え直す（_gpuTexStep）
  _gateFrame() {
    const st = this._sweepStats;
    if (!st) return;
    const mb = st.frameMB / 1048576;
    if (mb > st.frameMBMax) st.frameMBMax = mb;
    if (st._deferNow) { st.deferFrames++; st._deferNow = false; }
    st.frameMB = 0;
  }

  _gpuTexMB() { const c = this._gpuTexCfg(); return typeof c.warmMBPerFrame === 'number' ? c.warmMBPerFrame : 8; }

  // S7d: ランドマークの GLB が届いたら（CityLandmarks はそれまで隠して代わりの箱のまま）、今の位置で見えるノード（近いノード / 遠景のノード。
  //   近いときだけのノード（NEAR_ONLY）は今見えるものだけ）のテクスチャを 1 フレーム warmMBPerFrame MB ずつ上げ、上がりきったら done（見せる）。
  //   以前は初めて見えたフレームに全部上がった（「もう一度」のバトロワの輸送ヘリから 1 フレームに 57.7 MB）。landmarkMax 秒で必ず見せる
  _warmLandmarks(lm, done) {
    const L = this._warmLm;
    if (L) { L.lms.push(lm); L.done.push(done); L.q = null; return; }
    this._warmLm = { lms: [lm], done: [done], q: null, at: this.time };
    // ループが回っていない（テストの道具が running = false にして手で _update する・止めた）ときは待たずに見せる
    //   （propsReady はこの後で解ける。待つと _update を待つ道具と止まり合う）。ループが一度回った後か、3 秒待っても始まらないとき
    let idle = 0;
    const poll = setInterval(() => {
      const W = this._warmLm;
      if (!W || W.done.indexOf(done) < 0) { clearInterval(poll); return; }
      if (this.running || (!W.n && ++idle < 30)) return; // 始める前（start の前）は 3 秒まで待つ
      clearInterval(poll);
      this._warmLm = null;
      for (const d of W.done) { try { d(); } catch (e) { console.warn('[Game] ランドマーク', e); } }
    }, 100);
  }

  // 今のカメラの視錐台に入るランドマークのメッシュ（近い / 遠景・近いときだけのノードは今の距離で）のテクスチャで GPU に無いもの。
  //   視野の外の物は今まで通り見えたときに上がる（全部先に上げると、フリーの開始で見えない 約 73 MB を GPU に足していた）
  _landmarkPending(lms) {
    const cam = this.mainCamera || this.camera; // 街は本体シーンを mainCamera で描く（far が高さで変わる）
    if (cam === this.camera) cam.updateMatrixWorld();
    const m4 = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, new THREE.Matrix4().copy(cam.matrixWorld).invert());
    const fr = new THREE.Frustum().setFromProjectionMatrix(m4);
    const set = new Set(), out = [];
    const take = (o) => {
      if (!o.isMesh && !o.isPoints) return;
      if (o.frustumCulled !== false && o.geometry && !fr.intersectsObject(o)) return;
      MR.AssetManager.texturesIn([o], set);
    };
    for (const lm of lms) {
      try { lm.update(this.camera.position, this.time || 0); } catch (e) { /* 次のフレーム */ }
      for (const o of lm.placed) if (o.visible) o.traverseVisible(take);
      if (lm.night && lm.night.group) lm.night.group.traverseVisible(take);
    }
    set.forEach((t) => { if (!this._texOnGpu(t)) out.push(t); });
    return out;
  }

  _warmLandmarkStep(c) {
    const L = this._warmLm;
    if (!L) return;
    // 始めた直後のフレームはレンダーターゲット・影の地図（約 10 MB）を作るので、そこに重ねない（warmDelayFrames）
    L.n = (L.n || 0) + 1;
    if (L.n <= (typeof c.warmDelayFrames === 'number' ? c.warmDelayFrames : 2) && this.time - L.at < 1) return;
    if (!L.q) L.q = this._landmarkPending(L.lms);
    const cap = this._gpuTexMB() * 1048576;
    let b = 0;
    while (L.q.length) {
      const t = L.q[0];
      if (this._texOnGpu(t)) { L.q.shift(); continue; }
      const im = t.image, sz = (im.width || 0) * (im.height || 0) * 4;
      if (b > 0 && b + sz > cap) break;
      L.q.shift();
      try { this.renderer.initTexture(t); } catch (e) { /* 描くときに上がる */ }
      b += sz;
    }
    const max = typeof c.landmarkMax === 'number' ? c.landmarkMax : 3;
    // 待ちが空になったら、もう一度今のカメラで見る（隠している間に向きが変わった・近いときだけのノードが見えた）
    if (!L.q.length && !L.again && this.time - L.at < max) { L.again = true; L.q = this._landmarkPending(L.lms); if (L.q.length) return; }
    if (!L.q.length || this.time - L.at >= max) {
      this._warmLm = null;
      for (const d of L.done) { try { d(); } catch (e) { console.warn('[Game] ランドマーク', e); } }
    }
  }

  // _render の最初（このフレームで出た兵士を、描く前に）
  _gpuTexPreDraw() {
    if (!this.enemies || !this.enemies.length || !this._gpuTexOk()) return;
    const c = this._gpuTexCfg();
    if (!((typeof c.warmPerFrame === 'number' ? c.warmPerFrame : 1) > 0)) return;
    const seen = this._warmSeen || (this._warmSeen = new WeakMap());
    for (const e of this.enemies) if (e.group && e.character && seen.get(e.group) !== e.character) { seen.set(e.group, e.character); this.warmTexturesOf(e.group, { hide: true }); }
  }

  stop() {
    this.running = false;
    // 物語の入口が前のゲームの場面を持ち続けない・まとめた形と VTOL の GLB（形・材質・テクスチャ）を GPU から捨てる（VX。次のゲームで近づけば読み直す）
    if (MR.Vtol) { MR.Vtol.home = null; if (MR.Vtol.releaseAssets) MR.Vtol.releaseAssets(this.assets, null); else if (MR.Vtol.releaseParked) MR.Vtol.releaseParked(); }
    if (this.renderer && this.renderer.__mrGateGame === this) this.renderer.__mrGateGame = null;
    this.input.disable();
    this._sessionSave('exit');
    this._sessionStop();
    if (this._windLoop) { this._windLoop.stop(0.3); this._windLoop = null; }
    if (this._lapLoop) { this._lapLoop.stop(0.3); this._lapLoop = null; }
    if (this.royale) { this.royale.dispose(); }
    if (this.story) { this.story.dispose(); }
    if (this.look) this.look.dispose();
    if (this.cityOnline) { this.cityOnline.dispose(); }
    if (this.lift) this.lift.dispose();
    if (this.cityBoats) { this.cityBoats.dispose(); this.cityBoats = null; }
    if (this.waterFx) { this.waterFx.dispose(); this.waterFx = null; this.fx.waterFx = null; }
    if (this.timesSquare) { this.timesSquare.dispose(); this.timesSquare = null; }
    if (this.respawnUI) { this.respawnUI.dispose(); } // 復活の画面・地図で選ぶ途中を閉じる（共有の #hud に respawning を残さない）
    if (this.play) { this.play.dispose(); }
    if (this.parachute) { this.parachute.dispose(); this.parachute = null; }
    if (this.melee) { this.melee.dispose(); }
    if (this.jetHud) this.jetHud.reset();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
    if (typeof this.audio.stop === 'function') this.audio.stop();
    // 銃と腕（コードの腕の形・材質・フラッシュ。GLB の形はキャッシュと共有なので捨てない）。「もう一度」で共有のレンダラーに残さない
    for (const w of this.weapons) { if (w && !w.disposed) w.dispose(); }
    if (this.missiles) this.missiles.dispose(); // 飛んでいるミサイルのループ音（missile_loop）が次のゲームまで鳴り続けない（stats は残す）
    if (this.airCombat) this.airCombat.dispose(); // ロックの音（lock_tone / lock_solid）
    if (this.airDefense) { this.airDefense.dispose(); this.airDefense = null; }
    if (this.blastFx) { this.blastFx.dispose(); this.blastFx = null; }
    if (this.crashes) { this.crashes.dispose(); this.crashes = null; } // 火の記録・fire_loop / steam_hiss・輪と焦げのメッシュ・光
    if (this.debris) this.debris.dispose(); // 破片のメッシュ（外れた部品は乗り物の dispose が元へ戻す。releaseNode は捨てた後でも安全）
    if (this.puffs) { this.puffs.dispose(); this.puffs = null; } // 板の煙・爆発（形・材質・GPU のテクスチャ）
    if (this.hud && this.hud.setRwr) this.hud.setRwr(null); // #rwr の輪（共有の #hud）
    if (this.hud && this.hud.root && this.hud.root.classList) this.hud.root.classList.remove('heli-air');
    if (this._catMarker) { // カタパルトへの目印（形 3 つ・材質 1 つ。共有のレンダラーに残さない）
      const M = this._catMarker;
      if (M.group.parent) M.group.parent.remove(M.group);
      M.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      M.mat.dispose();
      this._catMarker = null;
    }
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    if (this._enemyTrash) { for (const e of this._enemyTrash) e.dispose(); this._enemyTrash = []; }
    for (const v of this.vehicles) v.dispose();
    this.vehicles = [];
    this.vehicle = null;
    if (this.online) {
      for (const r of this.remotes.values()) r.dispose();
      this.remotes.clear();
      if (this.net) { this.net.setHandler(null); this.net.close(); }
      if (this.hud.disableOnline) this.hud.disableOnline();
    }
    if (this.destruct) { this.destruct.dispose(); this.destruct = null; } // 破片・えぐれのメッシュ・nav と streamer へのつなぎ
    if (this.weatherView) { this.weatherView.dispose(); this.weatherView = null; } // 露出・環境マップの強さを元に戻す（レンダラーと材質は次のゲームも使う）
    if (this.world && this.world.dispose) this.world.dispose();
    if (this.sky && this.sky.dispose) this.sky.dispose();
    // ポストプロセスの描画先（レンダラーを次のゲームで使い回すときに残さない）
    if (this.composer) {
      try {
        if (this.composer.renderTarget1) this.composer.renderTarget1.dispose();
        if (this.composer.renderTarget2) this.composer.renderTarget2.dispose();
        if (this.bloomPass && this.bloomPass.dispose) this.bloomPass.dispose();
      } catch (e) { /* 無視 */ }
    }
  }
};
// 「ミサイル接近 ◯時」（時計の時 % 12 で引く。0 = 12 時）
MR.Game.VTOL_CAMS = ['near', 'far', 'cockpit']; // VTOL の視点の順（V3）
MR.Game.MSL_WARN = ['ミサイル接近 12時', 'ミサイル接近 1時', 'ミサイル接近 2時', 'ミサイル接近 3時', 'ミサイル接近 4時', 'ミサイル接近 5時',
  'ミサイル接近 6時', 'ミサイル接近 7時', 'ミサイル接近 8時', 'ミサイル接近 9時', 'ミサイル接近 10時', 'ミサイル接近 11時'];
