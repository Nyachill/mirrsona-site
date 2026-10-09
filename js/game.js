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
    this.config = this.assets.get('config/game.json');
    // オンライン: arena は arena01、街（city_dm / city_royale）は midtown（main.js が welcome の level を opts.level に入れる）
    this.levelId = opts.mode === 'online' ? (opts.level || 'arena01') : (opts.level || Game.chooseLevel(this.config));
    this.level = this.assets.get('levels/' + this.levelId + '.json');
    if (!this.level) { this.levelId = 'arena01'; this.level = this.assets.get('levels/arena01.json'); }
    if (!this.config || !this.level) throw new Error('ゲームデータが読み込めていません');
    this.isCity = !!this.level.chunkSize;
    this.cityCfg = Object.assign({ enemies: false, vehicles: false }, this.config.city || {});
    // 街の遊び方: free | royale（opts.cityMode > URL ?mode= > free）
    let cm = opts.cityMode;
    if (!cm) { try { const m = /[?&]mode=(free|royale)\b/.exec((typeof location !== 'undefined' && location.search) || ''); cm = m ? m[1] : null; } catch (e) { cm = null; } }
    this.cityMode = this.isCity && opts.mode !== 'online' ? (cm === 'royale' ? 'royale' : 'free') : null;

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
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.fps = 0;
    this.shake = 0;
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
    // タッチは pointerdown → 同じ指の pointerup（ボタンの中で離した）で押したことにする。'click' だけだと、別の指（左のスティックの親指）が
    //  画面に触れている間はブラウザが click を出さず（Chromium・iOS Safari）、パネルは開くのに選択肢と「閉じる」が効かなかった。
    //  マウスは今まで通り click（タッチの後に来る click は 0.7 秒の間は捨てる = 2 回にならない）
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (!el || !el.addEventListener) return;
      let pid = null, lastT = 0;
      const fire = () => { const g = Game._active; if (g) fn(g); };
      el.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') pid = ev.pointerId; });
      el.addEventListener('pointercancel', (ev) => { if (ev.pointerId === pid) pid = null; });
      el.addEventListener('pointerup', (ev) => {
        if (ev.pointerType === 'mouse' || ev.pointerId !== pid) return;
        pid = null;
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
    on('st-invert', (g) => { g.jetInvert = !g.jetInvert; g._syncSettings(); });
    on('st-flare', (g) => { g.jetAutoFlare = !g.jetAutoFlare; g._syncSettings(); });
    on('st-close', (g) => g.toggleSettings(false));
  }
  _pickScheme(sc) {
    this.setJetScheme(sc, true);
    this._syncSettings();
    this.hud.showMessage('戦闘機の操作: ' + ({ easy: 'かんたん', aim: '視点で操縦', manual: 'マニュアル' })[sc], 1200);
  }
  toggleSettings(on) {
    this.settingsOpen = on === undefined ? !this.settingsOpen : !!on;
    const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('settings') : null;
    if (el && el.classList) el.classList.toggle('hidden', !this.settingsOpen);
    if (this.settingsOpen) { this._syncSettings(); if (this.input.reset) { const en = this.input.enabled; this.input.reset(); this.input.enabled = en; } }
  }
  _syncSettings() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const sc = this._jetScheme();
    for (const k of ['easy', 'aim', 'manual']) { const b = document.getElementById('st-' + k); if (b && b.classList) b.classList.toggle('sel', k === sc); }
    const t = (id, label, v) => { const b = document.getElementById(id); if (b) b.innerHTML = label + ' <b>' + (v ? 'オン' : 'オフ') + '</b>'; };
    t('st-invert', '上下反転', this.jetInvert);
    t('st-flare', '自動フレア', this.jetAutoFlare);
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
    const rs = this._renderSettings();
    this.rs = rs;
    Game._active = this;
    Game._bindSettings();

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
    }, this.level.sky || {}, skyExtra));
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
    if (this.isCity) {
      this.world = new MR.CityWorld(this.scene, this.level, rs, { materials: this.materials, assets: this.assets, renderer: this.renderer });
      this.city = this.world.city;
      if (this.world.water && this.level.sky) this.world.water.uniforms.uSunDir.value.fromArray(this.level.sky.sunDir || [-0.55, 0.3, -0.45]).normalize();
    } else {
      this.world = new MR.World(this.scene, this.level, rs, { materials: this.materials, assets: this.assets, renderer: this.renderer });
    }
    if (!this.materials) this.materials = this.world.materials;
    this.fx = new MR.FX(this.scene);
    this.fx.maxParticles = rs.fxMaxParticles || 0;
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
    const vHemi = this.sky.hemi.clone();
    vHemi.intensity = this.sky.hemi.intensity * 1.3;
    const vSun = new THREE.DirectionalLight(this.sky.sun.color, this.sky.sun.intensity * 0.8);
    vSun.position.copy(this.sky.sunDir).multiplyScalar(50);
    this.viewScene.add(vHemi, vSun);
    // カメラ基準のフィルライト（銃が逆光で真っ黒にならないように）
    const fill = new THREE.PointLight(MR.srgb('#ffe2c0'), 1.6, 3, 1.5);
    fill.position.set(0.35, 0.45, 0.25);
    this.viewRoot.add(fill);
    // 環境マップはファイル版が後から届くので、ビューシーン側も追従させる
    if (typeof this.sky.onEnvironment === 'function') this.sky.onEnvironment((tex) => { this.viewScene.environment = tex; });
    else if (this.sky.envTexture) this.viewScene.environment = this.sky.envTexture;

    // --- プレイヤー ---
    this.player = new MR.Player(this.camera, cfg.player);
    this.player.mode3d = this.isCity; // 街: カプセルの 3D 移動（階段・梯子・落下・水泳）。arena01 は今まで通り
    this.scene.add(this.player.object);

    // 操作設定（config.controls）: 撃つボタンのドラッグで視点、左の撃つボタン
    const controls = Object.assign({ fireDragLook: true, leftFireButton: true }, cfg.controls || {});
    this.input.fireDragLook = controls.fireDragLook !== false;
    if (this.hud.root && this.hud.root.classList) this.hud.root.classList.toggle('no-left-fire', !controls.leftFireButton || !this.input.isTouchDevice);
    // 設定（#btn-settings / P。中身は戦闘機の操作だけ）: 戦闘機が出るソロの街だけ（アリーナ・オンラインは今まで通り出さない）
    this.settingsAvail = this.isCity && !this.online;
    if (this.hud.root && this.hud.root.classList) this.hud.root.classList.toggle('has-settings', this.settingsAvail);

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
    // 街: 落ちている物・持ち物（ピストルだけで始まる）・ミニマップ。バトルロイヤルは安全地帯と参加者
    // オンライン: CityPlay（サーバーに頼む形）と CityOnline（乗り物・範囲・ラウンド）。仮想の参加者・AI の敵は出さない
    if (this.isCity && MR.CityPlay) {
      if (this.online && MR.CityOnline) this.cityOnline = new MR.CityOnline(this);
      this.play = new MR.CityPlay(this);
      if (!this.online && this.cityMode === 'royale' && MR.RoyaleMode) this.royale = new MR.RoyaleMode(this, { seed: this.opts.royaleSeed, transport: this.opts.transport, contestants: this.opts.contestants });
    }
    // 復活する場所を選ぶ（respawn.js）: ソロの街：フリーとアリーナだけ（バトルロイヤルは 1 回だけ、オンラインはサーバーが決める）
    if (!this.online && !this.royale && MR.RespawnUI && (cfg.respawn || {}).enabled !== false) this.respawnUI = new MR.RespawnUI(this, cfg.respawn || {});

    // --- ポストプロセス ---
    if (useComposer) this._setupComposer(rs);
    // 街: ヘリの操縦席を重ね描くカメラとパス（ヘリに乗った一人称のときだけ動く）
    if (this.isCity) this._setupCockpit();
    // 街: 戦闘機のアフターバーナーの光（1 灯だけ。ライトの数を変えないため常にシーンに置く）と HUD
    if (this.isCity && this._jetsOn() && MR.Jet) this._setupJets();

    if (this.online) this._startOnline();
    else if (this.resume && MR.Session) MR.Session.apply(this, this.resume); // 続きから（位置・持ち物。_respawnPlayer の代わり）
    else this._respawnPlayer();
    if (this.royale) this.royale.begin();
    else if (this.play && !this.online && !this._resumed) this.hud.showMessage('光る輪の上の武器を拾おう', 2600);
    // 街: 立っている所の近景と遠景を最初のフレームの前に作っておく（render.city.primeMs まで）
    if (this.isCity) {
      this.camera.updateMatrixWorld(true);
      const cp = this.camera.getWorldPosition(new THREE.Vector3());
      this.world.loadNavNow(this.player.pos.x, this.player.pos.z);
      this.cityPrimeMs = this.world.streamer.prime(cp, this.cityRender.primeMs || 1500);
      this.world.props.update(cp);
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
    // レンダーターゲット経由だと outputEncoding が効かないので、最後に sRGB へ変換する
    if (THREE.GammaCorrectionShader) this.composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
    // 画面端を少し暗くし、彩度をわずかに上げる（render.vignette / render.saturation。0 と 1 で無効）
    if ((rs.vignette > 0 || rs.saturation !== 1) && THREE.ShaderPass) {
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

  // ビネット + 彩度のシェーダー（ガンマ補正の後、FXAA の前に入れる）
  static gradeShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        vignette: { value: 0.35 },
        saturation: { value: 1.06 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec4 c = texture2D(tDiffuse, vUv);',
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
      this.composer.setSize(w, h);
      if (this.fxaaPass) {
        const pr = this.renderer.getPixelRatio();
        this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      }
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
    if (this.input.consumeSettings && this.input.consumeSettings() && (this.settingsAvail || this.settingsOpen) && (this.settingsOpen || !this._deathUI)) this.toggleSettings();
    if (this.settingsOpen && !this.online) { if (!this._ctxLost && !(this._gl && this._gl.isContextLost())) this._render(); return; }
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
          '  veh ' + (this.vehicles[0] ? this.vehicles[0].modelSource : '-') + (this.isCity ? this._cityDebug() : ''));
      }
    }
  }

  _render() {
    // ビューモデルのルートをカメラに重ねる
    this.camera.updateMatrixWorld(true);
    this.viewRoot.matrix.copy(this.camera.matrixWorld);
    this.viewRoot.matrixWorldNeedsUpdate = true;
    this.sky.update(this.camera.getWorldPosition(this._tmpV3));
    if (this.mainCamera) this._syncMainCamera();
    const cockpit = this.cockpitCamera ? this._syncCockpit() : false;
    if (this.jetHud && this.jetHud.visible) this._drawJetHud();

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.mainCamera || this.camera);
      if (cockpit) { this.renderer.clearDepth(); this._renderCockpit(this.renderer); }
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.camera);
    }
  }

  _update(dt) {
    const player = this.player;
    // ADS（照準）: 入力 → 武器 → HUD / 視点感度（player.update の前に。lookScale は consumeLook に掛かる）
    // 梯子・水中・よじ登りの間は銃を下げる（撃てない・覗けない。arena01 では常に撃てる）
    // ヘリの操縦席・3 人称カメラでは撃てない（銃は隠す）
    // 戦闘機は人の銃を撃たない（操縦席の撃つボタンは機関砲。_updateJetGun）
    const heliNoFire = !!(this.vehicle && ((this.vehicle.kind === 'heli' && (!(this.vehicleSeat > 0) || this.heliChase)) || this.vehicle.kind === 'jet'));
    // 街のオンライン: バトロワのロビー・結果の間と輸送ヘリの中は撃てない（サーバーも数えない）
    const canShoot = player.canShoot && !heliNoFire && !(this.cityOnline && !this.cityOnline.canShoot);
    const healing = !!(this.play && this.play.heal);
    if (this.isCity) for (const w of this.weapons) w.setLowered((!canShoot || healing) && !player.dead);
    this.weapon.setAds(!player.dead && this.input.adsHeld && canShoot);
    this.input.lookScale = this.weapon.lookScale();
    // 照準線は「実際に覗いている」とき（リロード中は腰だめに戻る）だけ消す。ボタンの表示はトグル状態
    this.hud.setAds(this.weapon.adsActive, this.weapon.ads);
    if (this.hud.setScope) this.hud.setScope(!player.dead && this.weapon.scoped);
    const look = this.input.peekLook ? this.input.peekLook() : { x: 0, y: 0 };

    // 乗り物（プレイヤーより先に動かし、座席の位置を今フレームのものにする）
    // 街のオンラインは 0 台でも回す（近くに来た乗り物を作るのは cityOnline.updateVehicles。止めると二度と出ない）
    if (this.vehicles.length || this.cityOnline) this._updateVehicles(dt);

    if (this.royale) this.royale.tick();
    if (player.dead) {
      this._drainJetInput();
      if (this.online) this._updateOnlineDeath(dt);
      else if (!this.royale) {
        // ソロ: 「復活する場所」の画面（respawn.js。場所を選んで「復活」）。無ければ（自動テストの AUTO_RESPAWN）respawnDelay 秒後に今まで通り
        if (this._deathUI) this._deathUI.update(dt);
        else if (this.time >= this.respawnAt) this._respawnPlayer();
      }
    } else {
      // ほかの道で生き返った（テスト・続きから）: 復活の画面を閉じる
      if (this._deathUI) { this._deathUI.close('revived'); this._deathUI = null; }
      if (this.respawnUI) this.respawnUI.tick(dt); // 復活の直後の暗転を戻す
      if (this.play) this.play.preUpdate();
      this._updateVehicleInteract();
      if (this.vehicle) {
        this._updateDriving(dt);
      } else if (this.freeCam) {
        this._updateFreeCam();
      } else if (this.royale && this.royale.riding) {
        this.royale.updateRide(dt);
      } else if (this.cityOnline && this.cityOnline.riding) {
        this.cityOnline.updateRide(dt);
      } else {
        player.update(dt, this.input, this.world);
        if (this.isCity) this._cityPlayerEvents();
        // 徒歩のときは車体に押し出される。オンラインでは押された先が箱に掛かれば箱の外へ戻す
        // （サーバーは壁の中の位置を受け取らない。車と壁に挟まれたら車体に少しめり込む方を選ぶ）
        for (const v of this.vehicles) {
          if (this.isCity && (Math.abs(player.pos.y - v.pos.y) > 1.6 || player.state !== 'walk')) continue; // 街: 高さの違う車（高架の上と下）・梯子や水の中は押さない
          if (v.sunk || (this.isCity && v.wrecked && v.root && !v.root.visible)) continue;
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

      if (this.play) this.play.weaponInput(); // 街: 3 つの枠（切替・1〜3・装填。予備が無ければ「弾がない」）
      else {
        if (this.input.consumeSwap()) this._selectWeapon((this.weaponIndex + 1) % this.weapons.length);
        const sel = this.input.consumeSelect ? this.input.consumeSelect() : -1;
        if (sel >= 0 && sel < this.weapons.length && sel !== this.weaponIndex) this._selectWeapon(sel);
        if (this.input.consumeReload()) this.weapon.startReload(this.time);
      }
      const press = this.input.consumeFirePress();
      if (healing && (press || this.input.fireHeld)) this.play.cancelHeal('fire'); // 撃つと回復をやめる
      const wantFire = this.weapon.def.automatic ? this.input.fireHeld : press;
      if (wantFire && canShoot) this.weapon.tryFire(this.time, (dirs, def) => this._resolveShots(dirs, def));
    }
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
    this.fovKick = THREE.MathUtils.lerp(this.fovKick, 0, Math.min(1, dt * 12));
    // 運転中は速度に応じて少し広角に（スピード感）
    const vcfg = this.config.vehicles || {};
    const jv = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    const boost = jv ? (this.jetChase ? (jv.def.chaseFovBoost == null ? 12 : jv.def.chaseFovBoost) : (jv.def.cockpitFovBoost == null ? 5 : jv.def.cockpitFovBoost)) : (vcfg.fovBoost == null ? 6 : vcfg.fovBoost);
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
      playerAir: !!(this.vehicle && (this.vehicle.kind === 'heli' || this.vehicle.kind === 'jet') && !this.vehicle.grounded),
      airGroundY: this.vehicle && (this.vehicle.kind === 'heli' || this.vehicle.kind === 'jet') ? this.vehicle.groundY : 0,
      airAgl: this.vehicle && (this.vehicle.kind === 'heli' || this.vehicle.kind === 'jet') ? this.vehicle.agl : 0,
      airSpeed: this.vehicle && (this.vehicle.kind === 'heli' || this.vehicle.kind === 'jet') ? this.vehicle.speed : 0,
      airRange: this.vehicle && this.vehicle.kind === 'jet' && this.cityEnemyCfg ? this.cityEnemyCfg.jetAttackRange : undefined,
      onEnemyShot: (enemy, damage) => this._onEnemyShot(damage, enemy)
    };
    if (this.director) {
      // 街: 出し入れ・経路探索（予算つき）→ 敵の更新（時間を測る）
      ctx.director = this.director;
      ctx.camFwd = this.camera.getWorldDirection(this._camFwdE || (this._camFwdE = new THREE.Vector3()));
      const t0 = MR.EnemyDirector.now();
      this.director.update(dt, ctx);
      for (const e of this.enemies) e.update(ctx);
      const ms = MR.EnemyDirector.now() - t0, st = this.director.stats;
      st.frames++; st.updMs += (ms - st.updMs) * 0.05; if (ms > st.updMsMax) st.updMsMax = ms;
      st.lastMs = ms;
    } else {
      for (const e of this.enemies) e.update(ctx);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].removed) { this.enemies[i].dispose(); this.enemies.splice(i, 1); }
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
    const origin = this.player.eyePosition(this._tmpV1);
    const muzzle = this.weapon.muzzleWorldPosition(this._tmpV2);
    let anyHit = false, anyKill = false;
    let impactSound = false; // 散弾でも着弾音は 1 発分だけ
    const canImpact = typeof this.audio.impact === 'function';
    for (const dir of dirs) {
      const wall = this.world.nav.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range);
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
        if (!v.wrecked) { v.hit(def.damage, vhit.point, this._vehicleCtx()); anyHit = true; }
        end = vhit.point;
      } else if (best) {
        const mult = best.head ? (this.config.enemies.headshotMultiplier || 2) : 1;
        const killed = best.enemy.takeDamage(def.damage * mult, dir);
        this.fx.hitFlesh(best.point, dir);
        if (!impactSound && canImpact) { this.audio.impact('flesh', best.point); impactSound = true; }
        anyHit = true;
        if (killed) { anyKill = true; this._onKill(); }
        end = best.point;
      } else if (wall) {
        end = new THREE.Vector3(wall.x, wall.y, wall.z);
        this.fx.impact(end, new THREE.Vector3(wall.nx, wall.ny, wall.nz));
        if (!impactSound && canImpact) {
          this.audio.impact(MR.Audio.impactSurfaceAt ? MR.Audio.impactSurfaceAt(this.world.nav, end) : 'concrete', end);
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

  _onKill() {
    this.kills++;
    this.hud.setKills(this.kills);
    this.audio.kill();
  }

  // opts: { kind: 'bullet' | 'explosion' | 'fall' | 'zone'（街の防具は bullet / explosion だけに効く）, head（頭）, quiet（音と揺れ無し: 安全地帯）}
  _playerHit(damage, opts) {
    if (this.play) damage = this.play.absorb(damage, opts);
    this.lastHurt = (opts && opts.kind) || 'other';
    if (this.royale) this.royale.lastHurt = this.lastHurt;
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
  _onPlayerDied(delay) {
    if (this.vehicle) this._exitVehicle(true);
    if (this.play) this.play.onDeath();
    this.hud.showDeath(!this.royale);
    this.input.reset();
    this.respawnAt = this.time + delay;
    if (this.royale) { this.respawnAt = Infinity; this.royale.onPlayerDied(this.lastHurt === 'bullet' ? (this._lastAttacker || null) : null); }
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
  _respawnPlayer(spot) {
    if (this.vehicle) this._exitVehicle();
    let free;
    if (this.isCity) {
      const sp = spot || this._citySpawn();
      free = { x: sp.x, z: sp.z };
      this.world.loadNavNow(sp.x, sp.z); // 置き直しは予算なしで全部すぐ（その場の当たり判定）
      // _citySpawn は高さを持たない（通りの上 + 1 m まで）。spot は屋上・甲板の高さ + stepHint まで
      const hint = spot ? spot.y + ((this.config.respawn || {}).stepHint == null ? 0.3 : this.config.respawn.stepHint) : (sp.y || 0) + 1;
      const gy = this.world.nav.groundHeight(sp.x, sp.z, hint, 0.2);
      this.player.spawn(sp.x, sp.z, sp.yawDeg, gy == null ? (spot ? spot.y : 0) : gy);
      if (spot) {
        // placePlayer と同じ: カプセルを箱の外・床の上に落ち着かせる
        const p = this.player, r = this.world.nav.resolveCapsule(p.pos, p.radius, 1.8, 0.45, { snapDown: 0.45 });
        p.pos.set(r.x, r.y, r.z); p.peakY = p.pos.y; p._apply();
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
    const sp = this.city.spawnPoints('solo', seed)[0] || { x: 0, y: 0, z: 30, zone: '' };
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
    if (this.isCity) this.world.loadNavNow(x, z); // 置き直しは予算なしで全部すぐ（先の位置・歩きの予算を消して）
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
          const w = this.world.nav.waterLevelAt(p.pos.x, p.pos.z);
          if (w !== null && this.fx.splash) this.fx.splash(this._tmpV3.set(p.pos.x, w + 0.05, p.pos.z), Math.min(2, 0.6 + -e.vy * 0.08));
          break;
        }
        case 'stroke': {
          if (a.swimStroke) a.swimStroke();
          // 目の前（少し下）の水面に小さなしぶき（画面の下に見える）
          const w = this.world.nav.waterLevelAt(p.pos.x, p.pos.z);
          if (w !== null && this.fx.splash) this.fx.splash(this._tmpV3.set(p.pos.x - Math.sin(p.yawAngle) * 0.9, w + 0.02, p.pos.z - Math.cos(p.yawAngle) * 0.9), 0.35);
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
  _citySurface() {
    const p = this.player;
    const g = this.world.nav.groundInfo(p.pos.x, p.pos.z, p.pos.y + 0.05, 0.2);
    const b = g && g.box;
    if (!b) return 'concrete';
    const m = String((b.cat === 'roof' && b.mt) || b.mat || '');
    if (/wood|crate|plank|boardwalk/.test(m)) return 'wood';
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

  // 毎フレーム（街）: 当たり判定のチャンク・リング・小物・水、高さに合わせた霧と描画距離
  _updateCity(dt) {
    const cam = this.camera.getWorldPosition(this._camWorldC || (this._camWorldC = new THREE.Vector3()));
    const fwd = this.camera.getWorldDirection(this._camFwdC || (this._camFwdC = new THREE.Vector3()));
    // 運転中は 2 秒先の当たり判定も読む（速く走っても前の箱・高架がある）。ヘリは速度の向き、1 フレームに読む数を絞る
    const v = this.vehicle;
    if (v && (v.kind === 'heli' || v.kind === 'jet')) {
      // 戦闘機は 1.5 秒先、ただし navLeadMax m まで、地面から navLeadAgl m より上では読まない（建物は HeliCollider が掃引で見るので、
      //  先のリングは地上・低空の小物のためだけ。遠い先のリングを pin するとモバイルの小さなキャッシュで先読みと取り合いになる）
      if (v.kind === 'jet') {
        const sp = Math.hypot(v.vel.x, v.vel.z), dmax = v.def.navLeadMax == null ? 300 : v.def.navLeadMax;
        const t = sp > 1 ? Math.min(1.5, dmax / sp) : 0;
        this.world.navLead = v.mode === 'air' && v.agl > (v.def.navLeadAgl == null ? 400 : v.def.navLeadAgl) ? null : { x: v.pos.x + v.vel.x * t, z: v.pos.z + v.vel.z * t };
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
    // 死んでいる間: 選んだ復活の場所の周りを少しずつ先読み（respawn.js の lead。死んだ所の周りはそのまま）
    const rl = this._deathUI && this._deathUI.lead;
    if (rl) this._loadNavAt(rl.x, rl.z, this._deathUI.navOps, dt);
    this.world.update(dt, cam, this.player.pos, this.time, fwd);
    if (this.play) this.play.update(dt);
    if (this.royale) this.royale.update(dt);
    if (this.cityOnline) this.cityOnline.update(dt);
    if (this.parachute) this.parachute.update(dt);
    if (!this.online && this.cityCfg.vehicles && MR.Vehicle && this.rs.vehicles !== false) this._updateCityVehicles(dt);
    if (this.world.water && this.sky.background && this.sky.background.material && this.sky.background.material.map) this.world.water.setSkyTexture(this.sky.background.material.map);
    // 高さ（地面からではなくカメラの y）で near / far / 霧を補間
    const tab = this.cityRender.altitude, y = Math.max(0, cam.y);
    let a = tab[0], b = tab[tab.length - 1], t = 0;
    for (let i = 0; i < tab.length - 1; i++) if (y >= tab[i].y && y <= tab[i + 1].y) { a = tab[i]; b = tab[i + 1]; t = (y - a.y) / (b.y - a.y); break; }
    if (y > tab[tab.length - 1].y) { a = b; t = 0; }
    const L = (k) => a[k] + (b[k] - a[k]) * t;
    this._cityNear = L('near'); this._cityFar = L('far');
    if (this.scene.fog) { this.scene.fog.near = L('fogNear'); this.scene.fog.far = L('fogFar'); }
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
    const inCabin = (this.vehicle && this.vehicle.kind === 'heli' && !this.heliChase) || (this.vehicle && this.vehicle.kind === 'jet' && !this.jetChase) || (this.royale && this.royale.riding) || (this.cityOnline && this.cityOnline.riding);
    const chute = p.state === 'chute';
    const wind = Math.pow(wk, 1.2) * (indoors ? 0.25 : 1) * (inCabin ? 0.4 : 1) * (chute ? 0.35 : 1);
    if (wind > 0.04 && !this._windLoop) this._windLoop = a.loop('wind_high', { volume: wind, fadeIn: 1.5 });
    if (this._windLoop) { if (wind < 0.02) { this._windLoop.stop(1.0); this._windLoop = null; } else this._windLoop.setVolume(wind); }
    // 水音: 近くの水（16 方向 × 距離）→ その方向で陸と水の境目を二分探索した点
    let best = null;
    const R = ac.waterLapRange;
    const swimming = p.state === 'swim';
    if (swimming) best = { x: cam.x, z: cam.z, d: 0 };
    else if (city && typeof city.isWater === 'function' && eyeY < 60) {
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

  _cityDebug() {
    const i = this.world.info();
    const pl = this.play, lv = pl && pl.view ? pl.view.stats : null, mm = pl && pl.minimap ? pl.minimap.stats : null;
    return '  city full ' + i.fullBuilt + '/' + i.full + ' lod ' + i.lodBuilt + '/' + i.lod + ' sky ' + i.skyVisible + '/' + i.sky +
      ' queue ' + i.queue + ' build ' + i.buildMs.toFixed(1) + 'ms geo ' + i.geoLive + ' props ' + i.props +
      (lv ? '  loot ' + lv.items + ' items ' + lv.meshes + ' calls ' + lv.source + '/' + lv.weapons : '') +
      (mm ? '  map ' + mm.drawMs.toFixed(2) + 'ms tiles ' + mm.tiles : '');
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
    const heliOK = !!(MR.Helicopter && types.heli && this.cityCfg.helis !== false); // ヘリポートのヘリ（id h_<パッド>）
    const jetOK = !!(types.jet && this._jetsOn());                                    // 空母の戦闘機（id j_1..j_4）
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v === this.vehicle) continue;
      // 無人で飛んでいる戦闘機（射出の後）は墜ちるまで残す
      if (v.kind === 'jet' && v.mode === 'air' && !v.wrecked && !v.sunk) continue;
      const c = city.chunkOf(v.pos.x, v.pos.z);
      // 戦闘機で飛んでいるときは 1.5 秒先（navLead）の周りも残す（読み込んだ先の車を作ってすぐ消すのを繰り返さない）
      const ld = W.navLead, dl = ld ? Math.hypot(v.pos.x - ld.x, v.pos.z - ld.z) : Infinity;
      if (nav.hasChunk(c.cx + '_' + c.cz) && Math.min(dl, Math.hypot(v.pos.x - p.x, v.pos.z - p.z)) < 300) continue;
      const touched = v.cityTouched || v.health < v.def.health || v.pos.distanceTo(v.spawnPos) > 2;
      if (touched && !v.wrecked && !v.sinking) saved.set(v.cityId, { spec: v.citySpec, x: v.pos.x, y: v.pos.y, z: v.pos.z, yaw: v.yaw, health: v.health, air: v.kind === 'heli' && !v.grounded, ammo: v.kind === 'jet' ? v.ammo : undefined });
      else saved.delete(v.cityId);
      if (v.headlight) v.detachHeadlight();
      v.dispose();
      this.vehicles.splice(i, 1);
      live.delete(v.cityId);
    }
    for (const [id, st] of saved) {
      if (live.has(id) || this.vehicles.length >= maxLive) continue;
      const c = city.chunkOf(st.x, st.z);
      if (!nav.hasChunk(c.cx + '_' + c.cz)) continue;
      this._makeCityVehicle(st.spec, st);
    }
    for (const ch of nav.chunks.values()) {
      const data = W.cache.full(ch.cx, ch.cz);
      if (!data || !data.vehicles) continue;
      for (const sp of data.vehicles) {
        if (this.vehicles.length >= maxLive) return;
        if ((sp.type === 'heli' && !heliOK) || (sp.type === 'jet' && !jetOK) || !types[sp.type] || live.has(sp.id) || saved.has(sp.id)) continue;
        this._makeCityVehicle(sp, null);
      }
    }
  }

  _makeCityVehicle(spec, state) {
    const vcfg = this.config.vehicles || {}, nav = this.world.nav;
    const def = Object.assign({ id: spec.type }, vcfg.types[spec.type]);
    if (def.kind === 'heli' && MR.Helicopter) return this._makeCityHeli(spec, state, def);
    if (def.kind === 'jet') return MR.Jet ? this._makeCityJet(spec, state, def) : null;
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
    const on = !!(v && ((v.kind === 'heli' && !this.heliChase) || (v.kind === 'jet' && !this.jetChase)) && v.cockpit && !this.freeCam && !this.player.dead);
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

  // ---------- 戦闘機（フェーズ E1）----------

  // 戦闘機を出すか（街のソロ: city.jets、バトルロイヤル: royale.jets も。オンラインはフェーズ E4）
  _jetsOn() {
    if (!this.isCity || this.online || !MR.Jet) return false;
    if (this.cityCfg.jets === false) return false;
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
    if (st) { v.cityTouched = true; if (typeof st.ammo === 'number') v.ammo = st.ammo; }
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
      if (!vhit.vehicle.wrecked) { vhit.vehicle.hit(dmg, vhit.point, this._vehicleCtx()); anyHit = true; }
    } else if (best) {
      end = best.point;
      const killed = best.enemy.takeDamage(dmg, dir);
      this.fx.hitFlesh(best.point, dir);
      if (typeof this.audio.impact === 'function') this.audio.impact('flesh', best.point);
      anyHit = true;
      if (killed) { kill = true; this._onKill(); }
    } else if (wall) {
      end = this._tmpV2.set(wall.x, wall.y, wall.z);
      if (wall.water) { if (this.fx.splash) this.fx.splash(end, 0.5); }
      else {
        this.fx.impact(end, this._jetN || (this._jetN = new THREE.Vector3()).set(wall.nx, wall.ny, wall.nz));
        if (typeof this.fx.smoke === 'function' && Math.random() < 0.3) this.fx.smoke(end, 0.6);
      }
    } else end = this._tmpV2.copy(muzzle).addScaledVector(dir, range);
    this._tracerN = (this._tracerN || 0) + n;
    if (this._tracerN >= (G.tracerEvery || 3)) {
      this._tracerN = 0;
      if (typeof this.fx.streak === 'function') this.fx.streak(muzzle, end, G.tracerSpeed || 1000); else this.fx.tracer(muzzle, end, false);
    }
    if (anyHit) { this.hud.hit(kill); this.audio.hit(); }
    this.shake = Math.min(0.5, this.shake + 0.02);
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
  _jetRay(o, d, maxT) {
    const nav = this.world.nav;
    let best = null;
    const near = nav.raycast(o.x, o.y, o.z, d.x, d.y, d.z, Math.min(maxT, 300), { water: true });
    if (near) best = { t: near.t, x: near.x, y: near.y, z: near.z, nx: near.nx, ny: near.ny, nz: near.nz, water: !!near.water, src: 'nav' };
    const coll = this.heliCollider;
    const lim = best ? best.t : maxT;
    if (coll) {
      for (let t0 = 0; t0 < lim; t0 += 48) {
        const t1 = Math.min(lim, t0 + 48);
        const t = coll.raycast(o.x + d.x * t0, o.y + d.y * t0, o.z + d.z * t0, d.x, d.y, d.z, t1 - t0);
        if (t !== null) { const tt = t0 + t; best = { t: tt, x: o.x + d.x * tt, y: o.y + d.y * tt, z: o.z + d.z * tt, nx: -d.x, ny: -d.y, nz: -d.z, src: 'building' }; break; }
      }
    }
    // 地面（読み込んでいない所）: y = 0 の面（水なら水面）
    if (d.y < -1e-4) {
      let tg = (o.y - 0) / -d.y;
      if (tg < (best ? best.t : maxT)) {
        const gx = o.x + d.x * tg, gz = o.z + d.z * tg;
        const w = this.city && this.city.isWater && this.city.isWater(gx, gz);
        if (w) tg = (o.y - (this.city.waterY != null ? this.city.waterY : -2)) / -d.y;
        if (tg < (best ? best.t : maxT)) best = { t: tg, x: o.x + d.x * tg, y: o.y + d.y * tg, z: o.z + d.z * tg, nx: 0, ny: 1, nz: 0, water: !!w, src: 'ground' };
      }
    }
    return best;
  }

  // ミサイル・フレア（操縦席）: ロック（速度の向きから missile.lockCone° 以内・lockMin〜lockRange m の一番よい目標に lockTime 秒 → ロック。
  //   空の目標（ヘリ・戦闘機）を優先、続けて lockKeep° 以内なら保つ）・ミサイルボタン（F）でロックした目標へ（無ければまっすぐ）・
  //   フレアボタン（X）・自動フレア（設定。向かってくるミサイルが flares.autoRange m か autoTime 秒以内）
  _updateJetWeapons(dt, v) {
    const inp = this.input, d = v.def, MC = d.missile, FC = d.flares;
    const pilot = !(this.vehicleSeat > 0) && !this.player.dead && !v.wrecked;
    if (!this.missiles && MR.Missiles) this.missiles = new MR.Missiles(this.scene, this.fx, this.audio, MC);
    const wantM = typeof inp.consumeMissile === 'function' && inp.consumeMissile();
    const wantF = typeof inp.consumeFlare === 'function' && inp.consumeFlare();
    // ロック（空中、操縦席だけ）
    let L = this._jetLock;
    //  自動着艦・着陸の間はロックしない（最終進入でスマホの横の「ロック 240 m」が案内の板と右の列に重なっていた。撃つ場面でもない）
    if (!pilot || v.mode !== 'air' || v.missileCount <= 0 || v.autoland) { L = this._jetLock = null; }
    else {
      const fwd = this._tmpV4 || (this._tmpV4 = new THREE.Vector3());
      fwd.copy(v.vel).normalize();
      const c = v.center(this._tmpV5 || (this._tmpV5 = new THREE.Vector3()));
      const tp = this._tmpV6 || (this._tmpV6 = new THREE.Vector3());
      // 見えるか（機体から目標まで建物・地面にさえぎられない。missile.lockClear m の手前まで）
      const ld = this._lockD || (this._lockD = new THREE.Vector3());
      const visible = (dx, dy, dz, dist) => { ld.set(dx / dist, dy / dist, dz / dist); const h = this._jetRay(c, ld, dist); return !h || h.t >= dist - MC.lockClear; };
      const score = (t, needLos) => {
        if (!MR.Missiles.alive(t) || t === v) return null;
        MR.Missiles.targetPos(t, tp);
        const dx = tp.x - c.x, dy = tp.y - c.y, dz = tp.z - c.z, dist = Math.hypot(dx, dy, dz);
        if (dist < MC.lockMin || dist > MC.lockRange) return null;
        const ang = Math.acos(THREE.MathUtils.clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / dist, -1, 1)) * 180 / Math.PI;
        if (needLos && ang <= MC.lockKeep && !visible(dx, dy, dz, dist)) return null;
        return { ang, dist, s: ang / MC.lockCone + dist / MC.lockRange * 0.5 - (t.kind === 'heli' || (t.kind === 'jet' && t.mode === 'air') ? 0.3 : 0) };
      };
      // 保つ: lockKeep° 以内（見えなくなっても lockHide 秒は保つ）
      if (L) {
        const sc = score(L.target, false);
        if (sc && this.time - (L.losT || 0) > 0.25) { L.losT = this.time; L.seen = score(L.target, true) ? this.time : (L.seen || this.time); }
        if (!sc || sc.ang > MC.lockKeep || this.time - (L.seen || this.time) > MC.lockHide) L = this._jetLock = null; else { L.dist = sc.dist; L.ang = sc.ang; }
      }
      // 一番よい目標（0.25 秒ごとに探す）
      this._lockScanT = (this._lockScanT || 0) - dt;
      if (this._lockScanT <= 0) {
        this._lockScanT = MC.lockScan;
        let best = null, bs = null;
        const consider = (t) => { const sc = score(t, true); if (sc && sc.ang <= MC.lockCone && (!bs || sc.s < bs.s)) { best = t; bs = sc; } };
        //  止めてある無人の戦闘機（空母の甲板の味方の機体）はロックしない（着艦・低空で甲板の j_2 をロックして、ミサイルが外れて街の建物へ飛んでいた）
        for (const o of this.vehicles) if (!o.sunk && !o.wrecked && o !== v && !(o.kind === 'jet' && o.mode !== 'air' && !o.driver)) consider(o);
        for (const e of this.enemies) if (!e.dead) consider(e);
        this._lockScan = { best: best ? (best.cityId || best.kind || 'enemy') : null, ang: bs ? +bs.ang.toFixed(1) : null, n: this.vehicles.length };
        if (best && (!L || (L.target !== best && !L.locked))) L = this._jetLock = { target: best, t: 0, locked: false, dist: bs.dist, ang: bs.ang, seen: this.time, losT: this.time };
      }
      if (L && !L.locked) {
        L.t += dt;
        if (L.t >= MC.lockTime) {
          L.locked = true;
          if (this.audio && typeof this.audio.play === 'function') this.audio.play('lock_solid', { priority: 2, channel: 'self', volume: 0.8 });
        }
      }
    }
    // ミサイル
    this._missileCool = Math.max(0, (this._missileCool || 0) - dt);
    if (wantM && pilot) {
      if (v.mode !== 'air') this.hud.showMessage('ミサイルは飛んでいるときに撃てます', 1000);
      else if (v.missileCount <= 0) this.hud.showMessage('ミサイルがありません（空母で補給）', 1200);
      else if (this._missileCool <= 0 && this.missiles) {
        const from = v.takeMissile(new THREE.Vector3());
        if (from) {
          const dir = new THREE.Vector3().copy(v.vel).normalize();
          const tgt = L && L.locked ? L.target : null;
          this.missiles.fire({ from, vel: v.vel, dir, target: tgt, owner: v });
          this._missileCool = MC.cooldown;
          this.jetMissilesFired = (this.jetMissilesFired || 0) + 1;
          this.hud.showMessage(tgt ? 'ミサイル発射（ロック）' : 'ミサイル発射', 800);
        }
      }
    }
    // フレア（ボタン・自動）
    this._flareCool = Math.max(0, (this._flareCool || 0) - dt);
    const inc = this.missiles ? this.missiles.incomingFor(v) : null;
    v.incoming = inc;
    const autoF = pilot && this.jetAutoFlare && inc && (inc.dist < FC.autoRange || inc.tti < FC.autoTime);
    if ((wantF || autoF) && pilot && this._flareCool <= 0 && v.mode === 'air') {
      const n = v.takeFlares(FC.burst);
      if (n > 0 && this.missiles) { this.missiles.popFlares(v, n); this._flareCool = FC.cooldown; this.jetFlaresPopped = (this.jetFlaresPopped || 0) + n; if (autoF && !wantF) this.jetAutoFlares = (this.jetAutoFlares || 0) + 1; }
      else if (wantF && n <= 0) this.hud.showMessage('フレアがありません', 900);
    }
    // 向かってくるミサイルの警告音（1 秒ごと）
    if (inc && pilot) {
      this._rwrT = (this._rwrT || 0) - dt;
      if (this._rwrT <= 0 && this.audio && typeof this.audio.play === 'function') { this._rwrT = FC.rwrEvery; this.audio.play('rwr_warning', { priority: 2, channel: 'self', volume: 0.8 }); }
    }
  }
  // ミサイルの当たり判定・爆発（MR.Missiles.update の ctx）
  _missileCtx() {
    if (!this._mctx) {
      this._mctx = {
        vehicles: this.vehicles, enemies: this.enemies,
        ray: (o, d, maxT) => this._jetRay(o, d, maxT),
        onDetonate: (p, m, obj, water, air) => this._missileBlast(p, m, obj, water, air)
      };
    }
    this._mctx.vehicles = this.vehicles; this._mctx.enemies = this.enemies;
    return this._mctx;
  }
  // 爆発: blastRadius m の乗り物・敵・プレイヤーに damage（中心で全部、端で 0.4 倍）。当たった物は全部
  _missileBlast(p, m, obj, water, air) {
    const MC = (m.owner && m.owner.def && m.owner.def.missile) || (this.missiles && this.missiles.cfg) || {};
    const R = MC.blastRadius || 16, D = MC.damage || 650, edge = MC.blastEdge == null ? 0.6 : MC.blastEdge, pk = MC.playerBlast == null ? 0.3 : MC.playerBlast;
    if (water) { if (this.fx.splash) this.fx.splash(p, 3); }
    else if (this.fx.explosion) this.fx.explosion(p, air ? 3 : 4.5, 0.5);
    const ctx = this._vehicleCtx();
    for (const v of this.vehicles) {
      if (v.wrecked || v.sunk || v === m.owner) continue;
      const c = v.center ? v.center(this._tmpV3) : v.pos;
      const dist = obj === v ? 0 : Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      if (dist > R) continue;
      const k = 1 - dist / R * edge;
      if (v.hit) v.hit(D * k, p, ctx); else if (v.damage) v.damage(D * k, ctx);
      if (m.owner === this.vehicle) { this.hud.hit(v.wrecked); this.jetMissileHits = (this.jetMissileHits || 0) + 1; }
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dist = obj === e ? 0 : Math.hypot(e.pos.x - p.x, e.pos.y + 1 - p.y, e.pos.z - p.z);
      if (dist > R) continue;
      const dir = this._tmpV3.set(e.pos.x - p.x, 0.5, e.pos.z - p.z).normalize();
      if (e.takeDamage(D * (1 - dist / R * edge), dir)) { this._onKill(); if (m.owner === this.vehicle) this.hud.hit(true); }
    }
    if (!this.player.dead && !(this.vehicle && this.vehicle === m.owner)) {
      const P = this.player.pos, dist = Math.hypot(P.x - p.x, P.y + 1 - p.y, P.z - p.z);
      if (dist < R) this._playerHit(D * pk * (1 - dist / R * edge), { kind: 'explosion' });
    }
    const pl = this.vehicle ? this.vehicle.pos : this.player.pos;
    const dd = Math.hypot(pl.x - p.x, pl.z - p.z);
    if (dd < 120) this.shake = Math.min(1.5, this.shake + (1 - dd / 120) * 0.8);
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
      cam.position.set(0, H, D);
      P.yaw.updateMatrixWorld(true);
      const cw = cam.getWorldPosition(this._tmpV3);
      const dx = cw.x - pivot.x, dy = cw.y - pivot.y, dz = cw.z - pivot.z, len = Math.hypot(dx, dy, dz) || 1;
      let t = len;
      const h = this.world.nav.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len, { water: true });
      if (h && h.t < t) t = h.t;
      const coll = this.heliCollider;
      if (coll) { const t2 = coll.raycast(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len); if (t2 !== null && t2 < t) t = t2; }
      let want = Math.max(0.12, Math.min(1, (t - 1.0) / len));
      // 地上で後ろがすぐ壁（艦橋の前の j_4 など）: カメラを高くして上から見る（高くした所が空いていれば）
      let liftT = 0;
      if (want < 0.6 && v.mode === 'ground') {
        const lift = v.def.chaseLift, H2 = H + lift;
        cam.position.set(0, H2, D);
        P.yaw.updateMatrixWorld(true);
        const c2 = cam.getWorldPosition(this._tmpV3);
        const ex = c2.x - pivot.x, ey = c2.y - pivot.y, ez = c2.z - pivot.z, l2 = Math.hypot(ex, ey, ez) || 1;
        let t2 = l2;
        const h2 = this.world.nav.raycast(pivot.x, pivot.y, pivot.z, ex / l2, ey / l2, ez / l2, l2, { water: true });
        if (h2 && h2.t < t2) t2 = h2.t;
        if (coll) { const t3 = coll.raycast(pivot.x, pivot.y, pivot.z, ex / l2, ey / l2, ez / l2, l2); if (t3 !== null && t3 < t2) t2 = t3; }
        const w2 = Math.max(0.12, Math.min(1, (t2 - 1.0) / l2));
        if (w2 > want + 0.2) { liftT = lift; want = w2; }
      }
      this._chaseLift = (this._chaseLift || 0) + (liftT - (this._chaseLift || 0)) * Math.min(1, dt * 3);
      if (this._chaseK == null || want < this._chaseK) this._chaseK = want;
      else this._chaseK += (want - this._chaseK) * Math.min(1, dt * 2.5);
      cam.position.set(P.shakeOffset.x, (H + this._chaseLift) * this._chaseK + P.shakeOffset.y, D * this._chaseK);
      if (this._chaseLift > 0.05) cam.rotation.x = -Math.atan2(this._chaseLift, D) * 0.85; // 高くした分だけ見下ろす
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
    info.missiles = v.missileCount; info.flares = v.flareCount; info.incoming = v.incoming || null;
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
    else if (v.incoming && v.mode === 'air' && (v.incoming.tti < 6 || v.incoming.dist < 2500)) warn = 'ミサイル接近';
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
    if (low) {
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
        onKill: () => this._onKill(),
        onImpact: (v, speed) => { if (v === this.vehicle) this.shake = Math.min(1.5, this.shake + Math.min(1, speed / v.def.maxSpeed) * 1.2); },
        onExplode: (v) => this._vehicleExploded(v),
        // 街: 水に落ちた車（沈む）→ 運転席が水面に着いたら降ろして泳がせる
        onSink: (v) => { if (v === this.vehicle) this.shake = Math.min(1.5, this.shake + 0.8); },
        // 街のオンラインはサーバーにも降りたと伝える（水の上の位置。サーバーは沈んだ車を後で sunk にする）
        onSinkEject: (v) => { if (v === this.vehicle) this._exitVehicle(!this.cityOnline); },
        onSunk: (v) => { if (v === this.vehicle) this._exitVehicle(!this.cityOnline); }
      };
    }
    this._vctx.time = this.time;
    this._vctx.enemies = this.enemies;
    return this._vctx;
  }

  _updateVehicles(dt) {
    const ctx = this._vehicleCtx();
    if (this.vehicle && this.vehicle.kind === 'jet') {
      // 戦闘機: 操縦席だけが飛ばす（ジャンプボタン・Space は機関砲。consumeJump は捨てる）
      this.input.consumeJump();
      if (!(this.vehicleSeat > 0)) this._jetControls(dt, this.vehicle);
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
      this.world.nav.setDynamicBoxes(this.vehicles.map((v) => v.aabb()));
    }
    // 戦闘機: 機関砲・出来事・HUD
    const jv = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    if (jv) { this._updateJetGun(dt, jv); this._updateJetWeapons(dt, jv); this._jetEvents(jv); }
    else this._jetLock = null;
    if (this.missiles && (this.missiles.list.length || this.missiles.flares.length)) this.missiles.update(dt, this._missileCtx());
    for (const v of this.vehicles) if (v.kind === 'jet' && v !== jv && v.events.length) v.events.length = 0;
    if (this.jetHud) this.jetHud.show(!!jv && !(this.vehicleSeat > 0) && !this.player.dead);
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
      this.hud.setVehicle(v ? { name: v.name, kmh: v.speedKmh, health: v.health, maxHealth: v.def.health, heli: v.kind === 'heli' || v.kind === 'jet' } : null);
    }
    if (this.hud.setHeli) {
      const v = this.vehicle;
      if (v && v.kind === 'heli') {
        const pilot = !(this.vehicleSeat > 0);
        if (v.cantLand > 0.5 && pilot && this.time - (this._cantLandMsg || -9) > 2.5) { this._cantLandMsg = this.time; this.hud.showMessage('ここには降りられません', 1200); }
        // 席を移る: ソロは地上で止まっているとき、オンラインは空いている席があればいつでも（サーバーが vseat で決める）
        const canSeat = this.online ? (v.seatCount > 1 && v.freeSeat() >= 0) : (v.grounded && v.speed < 1 && v.seatCount > 1);
        this.hud.setHeli({ alt: v.agl, asl: v.pos.y - ((this.city && this.city.waterY) != null ? this.city.waterY : -2), rpm: v.rotor, starting: pilot && v.rotor < v.def.liftRpm && v.engineOn,
          pilot, chase: !!this.heliChase, seat: canSeat });
      } else this.hud.setHeli(null);
    }
  }

  _drainJetInput() {
    const inp = this.input;
    for (const k of ['consumeGear', 'consumeEject', 'consumeMissile', 'consumeFlare', 'consumeLaunch', 'consumeLand']) if (typeof inp[k] === 'function') inp[k]();
  }

  // 乗り降り（E キー / 乗り物ボタン）。近くの乗り物をボタンに出す
  _updateVehicleInteract() {
    const player = this.player;
    const vcfg = this.config.vehicles || {};
    let near = null;
    if (!this.vehicle) {
      let best = vcfg.enterDistance == null ? 3 : vcfg.enterDistance;
      for (const v of this.vehicles) {
        if (v.wrecked) continue;
        // 他の人が運転中（オンライン）: arena は乗れない。街は空いている席があれば同乗できる（ロビー・結果の間・範囲の外の車は乗れない）
        if (v.driver && v.driver.remote && (!this.cityOnline || v.freeSeat() < 0)) continue;
        if (v.netInactive) continue;
        if (this.isCity && (v.sinking || player.state !== 'walk' || Math.abs(player.pos.y - v.pos.y) > 2)) continue;
        const d = v.distanceTo(player.pos.x, player.pos.z);
        if (d < best) { best = d; near = v; }
      }
    }
    this._nearVehicle = near;
    if (near && near.kind === 'heli' && near !== this._preparedHeli && typeof this.audio.prepareRotor === 'function') { this._preparedHeli = near; this.audio.prepareRotor(); }
    if (near && near.kind === 'jet' && near !== this._preparedJet && typeof this.audio.prepareJet === 'function') { this._preparedJet = near; this.audio.prepareJet(); }
    const hv = this.vehicle && this.vehicle.kind === 'heli' ? this.vehicle : null;
    const jv = this.vehicle && this.vehicle.kind === 'jet' ? this.vehicle : null;
    // 戦闘機: 降りられるのは地上で止まっているときだけ（飛んでいる間は脱出ボタン）
    const jetCanExit = !!jv && jv.mode === 'ground' && jv.speed < 2 && (!jv.cat || jv.cat.ph === 'align' || jv.cat.ph === 'ready') && !jv._auto;
    if (this.hud.setVehiclePrompt) this.hud.setVehiclePrompt(this.vehicle ? (jv ? (jetCanExit ? '降りる' : null) : (hv && !hv.grounded && hv.agl > 2.5 ? '飛び降り' : '降りる')) : (near ? '乗る' : null));
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
    const seatReq = typeof this.input.consumeSeat === 'function' ? this.input.consumeSeat() : false;
    if (seatReq && hv && !this.online && hv.grounded && hv.speed < 1) {
      const to = hv.switchSeat(player);
      if (to >= 0) { this.vehicleSeat = to; this._driveYaw = hv.yaw; this.hud.showMessage(['操縦席', '助手席', '後ろの席', '後ろの席'][to] || '席', 900); }
    } else if (seatReq && this.vehicle && this.cityOnline) {
      // オンライン: 次の空いた席をサーバーに頼む（vseat で移る）
      const v = this.vehicle, from = this.vehicleSeat || 0;
      for (let k = 1; k < v.seatCount; k++) {
        const j = (from + k) % v.seatCount;
        if (!v.occupants[j]) { this.net.send({ t: 'enter', i: v.netIndex, seat: j }); break; }
      }
    }
    const want = typeof this.input.consumeInteract === 'function' ? this.input.consumeInteract() : false;
    if (!want) return;
    if (this.vehicle) this._exitVehicle();
    else if (near) this._enterVehicle(near);
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
    const want = this.cityOnline && typeof seat === 'number' ? seat : (this.isCity && v.driver && v.driver !== this.player ? -1 : undefined);
    if (!v || v.wrecked || !v.enter(this.player, want)) return;
    this.vehicle = v;
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
    if (v.kind === 'heli') {
      // ヘリ: 前（風防）を向いて座る。一人称なら操縦席を重ね描く
      this.player.yawAngle = v.yaw + Math.PI; this.player.pitchAngle = -0.08;
      v.localInside = true;
      v.setCockpit(!this.heliChase);
      this._chaseK = null;
      if (typeof this.audio.prepareRotor === 'function') this.audio.prepareRotor();
    }
    this.player.setSeated(v.seatWorld(this.vehicleSeat || 0, this._tmpV1));
    this._stepDist = 0; this._stepTime = 0;
    if (!(v.kind === 'jet' && this.time < (this._jetTutUntil || 0))) this.hud.showMessage(v.name, 900); // 戦闘機の説明を出すときは名前を重ねない
  }

  // silent: サーバーに exit を送らない（死亡・爆発・運転手を外されたときはサーバーが先に知っている）
  _exitVehicle(silent) {
    const v = this.vehicle;
    if (!v) return;
    if (v.kind === 'heli') { this._exitHeli(v, silent); return; }
    if (v.kind === 'jet') { this._exitJet(v, silent, v.wrecked); return; }
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
    if ((v.kind !== 'heli' && v.kind !== 'jet') || this.vehicleSeat > 0) this.player.yawAngle += v.yaw - this._driveYaw;
    this._driveYaw = v.yaw;
    this.player.updateSeated(dt, this.input, v.seatWorld(this.vehicleSeat || 0, this._tmpV1));
    if (v.kind === 'heli') this._updateHeliView(dt, v);
    else if (v.kind === 'jet') this._updateJetView(dt, v);
  }

  // 乗り物が爆発した: 周囲の敵とプレイヤーにダメージ、乗っていたら降ろして致命傷
  _vehicleExploded(v) {
    if (this.online) {
      // ダメージ・撃破はサーバー（damage / kill が来る）。乗っていたら降りるだけ
      if (this.vehicle === v) this._exitVehicle(true);
      const d = Math.hypot(this.player.pos.x - v.pos.x, this.player.pos.z - v.pos.z);
      this.shake = Math.min(2, this.shake + (d < 25 ? 1.2 : 0.3));
      return;
    }
    const c = v.center(this._tmpV2);
    const R = v.def.explodeRadius, D = v.def.explodeDamage;
    // 街は高さも数える（屋上の敵は下の車の爆発で死なない）
    const dist3 = (p, yo) => this.isCity ? Math.hypot(p.x - c.x, (p.y + yo) - c.y, p.z - c.z) : Math.hypot(p.x - c.x, p.z - c.z);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dist = dist3(e.pos, 1);
      if (dist > R) continue;
      const dir = this._tmpV3.set(e.pos.x - c.x, 0.4, e.pos.z - c.z).normalize();
      if (e.takeDamage(D * (1 - dist / R * 0.6), dir)) this._onKill();
    }
    if (this.vehicle === v) {
      this._exitVehicle();
      this._playerHit(D, { kind: 'explosion' });
    } else if (!this.player.dead) {
      const dist = dist3(this.player.pos, 1);
      if (dist < R) this._playerHit(D * (1 - dist / R * 0.7), { kind: 'explosion' });
    }
    this.shake = Math.min(2, this.shake + 1.2);
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
    if (p.dead || this._waitingSpawn) return null;
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
        if (!impactSound && canImpact) {
          this.audio.impact(MR.Audio.impactSurfaceAt ? MR.Audio.impactSurfaceAt(this.world.nav, end) : 'concrete', end);
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

  stop() {
    this.running = false;
    this.input.disable();
    this._sessionSave('exit');
    this._sessionStop();
    if (this._windLoop) { this._windLoop.stop(0.3); this._windLoop = null; }
    if (this._lapLoop) { this._lapLoop.stop(0.3); this._lapLoop = null; }
    if (this.royale) { this.royale.dispose(); }
    if (this.cityOnline) { this.cityOnline.dispose(); }
    if (this.respawnUI) { this.respawnUI.dispose(); } // 復活の画面・地図で選ぶ途中を閉じる（共有の #hud に respawning を残さない）
    if (this.play) { this.play.dispose(); }
    if (this.parachute) { this.parachute.dispose(); this.parachute = null; }
    if (this.jetHud) this.jetHud.reset();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
    if (typeof this.audio.stop === 'function') this.audio.stop();
    if (this.missiles) this.missiles.dispose(); // 飛んでいるミサイルのループ音（missile_loop）が次のゲームまで鳴り続けない（stats は残す）
    if (this._catMarker) { // カタパルトへの目印（形 3 つ・材質 1 つ。共有のレンダラーに残さない）
      const M = this._catMarker;
      if (M.group.parent) M.group.parent.remove(M.group);
      M.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      M.mat.dispose();
      this._catMarker = null;
    }
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    for (const v of this.vehicles) v.dispose();
    this.vehicles = [];
    this.vehicle = null;
    if (this.online) {
      for (const r of this.remotes.values()) r.dispose();
      this.remotes.clear();
      if (this.net) { this.net.setHandler(null); this.net.close(); }
      if (this.hud.disableOnline) this.hud.disableOnline();
    }
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
