// 起動処理: ロード画面 → データ準備（ダウンロード） → タップで開始
//
// URL パラメータ（Web / 動作確認用）:
//   ?tier=hd|sd   … アセットの品質ティアを固定（既定は MR.CONFIG.ASSET_TIER = 'auto'）
//   ?harness=1    … 自動テスト用。準備完了で window.MR_READY = true / window.MR_ASSETS を公開し、
//                    フルスクリーン・画面回転ロックをしない（tools/screenshot.js が使う）
//   ?noenv=1      … 環境マップ（PMREM）を使わない（sky.js が見る。SwiftShader で真っ黒になる対策）
//   ?server=ws://127.0.0.1:8787 … オンライン対戦のサーバー（既定は game.json の online.server。空なら「サーバー未設定」）
//   ?level=midtown … ソロで遊ぶレベル（既定は game.json の level。無ければ arena01）。オンラインは arena01 のまま
//   ?spawn=123     … 街の開始地点の乱数（spawnPoints('solo', seed)）
//   ?mode=free|royale|arena … ソロのモード（開始画面で選ばずに「ソロ」ですぐ始める）。?rseed= バトルロイヤルの乱数
//   ?picker=1      … 自動テストでもモードの選択を出す（harness / ?level= / ?mode= のときは「ソロ」ですぐ始める）
//
// 開始画面: 「ソロ」（#btn-start）→ モードを選ぶ（#solo-panel: 「街：フリー」「街：バトルロイヤル」「アリーナ」。最後に選んだものを覚えて
//   印を付ける。mirrsona.soloMode）。テクスチャは起動時に「たぶん選ぶ」レベル（前回のモード / URL / game.json の level）の分を先に読み、
//   違うレベルを選んだらそのとき読む。「オンライン」（遊び方 = アリーナ / 街：個人戦 / 街：バトルロイヤル（最後に選んだものを覚える。
//   mirrsona.onlineMode、初めてはアリーナ）・コールサイン・ルームを選んで接続 → welcome が来たらオンラインで開始。街は先にテクスチャを読む）。
//   自動テストは window.MR_START_ONLINE({ server, room, name, mode }) / window.MR_START_SOLO('free' | 'royale' | 'arena') でも始められる。
//   バトルロイヤルの「もう一度」は読み直さずに同じレンダラーで新しいゲームを始める（opts.onAgain）
window.MR = window.MR || {};

(function () {
  const $ = (id) => document.getElementById(id);
  const search = (typeof location !== 'undefined' && location.search) || '';
  const HARNESS = /[?&]harness=1\b/.test(search);
  MR.HARNESS = HARNESS;
  window.MR_READY = false;

  function resolveAssetServer() {
    const cfg = MR.CONFIG.ASSET_SERVER;
    if (cfg) return cfg;
    // Web で動いているなら、ページと同じ場所の assets/ を使う
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      // プレビュー（単体 HTML）の場合は assets が無いので空にしておく
      if (window.MR_PREVIEW) return '';
      return new URL('assets', location.href).toString().replace(/\/$/, '');
    }
    // アプリ内（capacitor:// / file:）: 配信用サイトから取る
    return MR.CONFIG.NATIVE_ASSET_SERVER || '';
  }

  // オンラインのサーバー: URL の ?server= が最優先、次に game.json の online.server
  function resolveNetServer(gameConfig) {
    const m = /[?&]server=([^&#]+)/.exec(search);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    return String(((gameConfig && gameConfig.online) || {}).server || '').trim();
  }

  // 端末に覚えておく小さな設定（使えない環境では覚えないだけ）
  const prefs = {
    get(key) { try { return window.localStorage ? window.localStorage.getItem('mirrsona.' + key) : null; } catch (e) { return null; } },
    set(key, value) { try { if (window.localStorage) window.localStorage.setItem('mirrsona.' + key, value); } catch (e) { /* 保存できなくても続ける */ } }
  };

  // コールサイン: 自由入力は使わない（App Store の UGC 規約）。プリセット + 2 桁の番号のみ
  function validCallsign(name) {
    const P = MR.NetProto;
    if (!P || typeof name !== 'string') return false;
    const m = /^([A-Za-z]+)-([1-9][0-9])$/.exec(name);
    return !!m && P.CALLSIGNS.indexOf(m[1]) >= 0;
  }

  async function boot() {
    const progressBar = $('progress-bar');
    const status = $('status');
    const startBtn = $('btn-start');
    const versionEl = $('version');
    const loading = $('loading');

    // 前回が遊んでいる途中で終わった（iOS が WebView を落とした等）なら、そのときの様子を 1 行出す（session.js。DEBUG なら毎回）
    //   boot() は前回の snap（続きから）と落ちた回数も返す（下の「続きから」で使う）
    let sb = null;
    if (MR.Session) {
      try {
        const b = sb = MR.Session.boot();
        if (b.prev && (b.unclean || MR.CONFIG.DEBUG)) {
          const line = MR.Session.describe(b.prev);
          const el = $('crumb');
          if (el) { el.textContent = line; el.classList.remove('hidden'); }
          console.info('[Session]', line, JSON.stringify(b.prev), JSON.stringify(b.counters));
        }
      } catch (e) { /* 無視 */ }
    }

    const storage = new MR.Storage();
    try {
      await storage.init();
    } catch (e) {
      console.warn('[Boot] storage init failed', e);
    }

    // ティア: 'auto' → タッチ端末は sd、PC は hd。URL の ?tier= が最優先
    const tier = MR.AssetManager.pickTier(MR.CONFIG.ASSET_TIER);
    MR.TIER = tier;

    const assets = new MR.AssetManager(storage, {
      server: resolveAssetServer(),
      timeoutMs: MR.CONFIG.FETCH_TIMEOUT_MS,
      tier,
      keepBytes: MR.CONFIG.KEEP_BLOB_BYTES
    });
    window.MR_ASSETS = assets; // デバッグ・テスト用

    let info;
    try {
      info = await assets.prepare((text, ratio) => {
        status.textContent = text;
        progressBar.style.width = (Math.max(0.02, ratio) * 100).toFixed(1) + '%';
      });
    } catch (e) {
      console.error(e);
      status.textContent = 'データの準備に失敗しました: ' + e.message;
      return;
    }

    const sourceLabel = { remote: 'サーバーから更新', cache: '端末内のデータ', embedded: '内蔵データ' }[info.source] || info.source;
    const fmt = MR.AssetManager.formatBytes;
    let dataLabel = 'data ' + info.version + '（' + sourceLabel + '）';
    if (info.source !== 'embedded') {
      dataLabel += ' / ' + info.tier.toUpperCase() + ' ' + fmt(info.totalBytes);
      if (info.downloadedBytes) dataLabel += '（更新 ' + fmt(info.downloadedBytes) + '）';
    }
    versionEl.textContent = 'app ' + MR.CONFIG.APP_VERSION + ' / ' + dataLabel;
    status.textContent = info.source === 'embedded' ? '準備完了（内蔵データ）' : '準備完了 ' + info.tier.toUpperCase() + ' ' + fmt(info.totalBytes);
    progressBar.style.width = '100%';

    // 前回が途中で終わっていたら続きから（session.js の decide: none / resume / saver / title）。決めるのはデータの準備の後・重いデコードの前。
    //   アプリは WebView が裏で落ちてもすぐ読み直すので、見えるようになるまで兵士のパース・テクスチャ・ゲームを始めない
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const stab = (assets.get('config/game.json') || {}).stability || {};
    const sessCfg = MR.Session ? MR.Session.config(stab).session : {};
    let resumeDecision = 'none';
    if (sb && sb.snap && MR.Session) {
      const urlDirect = (HARNESS && !/[?&]picker=1\b/.test(search)) || /[?&](level|mode)=/.test(search);
      try { resumeDecision = MR.Session.decide(Date.now(), sb.snap, sb.crashes, stab, { direct: urlDirect, harness: HARNESS, saverUntil: MR.Session.saverUntil(), readonly: sb.writable === false }); } catch (e) { resumeDecision = 'none'; }
    }
    // 続きからの起動（resume / saver）: ここから先（兵士のパース・街のテクスチャの先読み = いちばん重い所）で落ちても次の起動で数える
    //   （数えないと、落ちる → 読み直す → また続きから、が終わらない）。裏にいる間・ページを閉じたときは数えない（hidden / pagehide）、
    //   開始画面で「続きから」を待っている間も数えない（card）。ゲームが始まったらゲームの保存に任せる（bootGuardOff）
    //   title（続けて落ちた）は開始画面で待つだけなので card から（「続きから」を押したら startResume が resume にする）
    let bootPhase = resumeDecision === 'title' ? 'card' : 'resume', bootGuardOff = () => {};
    if (resumeDecision !== 'none' && MR.Session) {
      const mark = () => { try { MR.Session.markReason(document.visibilityState === 'hidden' ? 'hidden' : bootPhase); } catch (e) { /* 無視 */ } };
      const onHide = () => { try { MR.Session.markReason('pagehide'); } catch (e) { /* 無視 */ } };
      try { if (document.visibilityState === 'hidden' || bootPhase !== 'resume') mark(); else MR.Session.markLaunch(); } catch (e) { /* 無視 */ }
      document.addEventListener('visibilitychange', mark);
      window.addEventListener('pagehide', onHide);
      bootGuardOff = (phase) => {
        if (phase) { bootPhase = phase; mark(); return; }
        document.removeEventListener('visibilitychange', mark);
        window.removeEventListener('pagehide', onHide);
        bootGuardOff = () => {};
      };
    }
    let visible = true;
    if (resumeDecision !== 'none' || isNative) {
      if (document.visibilityState === 'hidden') status.textContent = '待機中';
      visible = (await whenVisible(sessCfg.visibleWait)) === 'visible';
    }

    // 兵士モデルはロード画面の間にパースしておく（無ければ即 false でコードモデルに戻る）
    if (MR.CharacterGLB && info.source !== 'embedded') {
      status.textContent = 'モデルを準備中';
      const gcfg = assets.get('config/game.json') || {};
      try { await MR.CharacterGLB.preload(assets, (gcfg.enemies || {}).model); } catch (e) { /* フォールバック */ }
      status.textContent = info.source === 'embedded' ? '準備完了（内蔵データ）' : '準備完了 ' + info.tier.toUpperCase() + ' ' + fmt(info.totalBytes);
    }
    startBtn.classList.remove('hidden');

    const gameConfig = assets.get('config/game.json') || {};
    // ソロのモード: free / royale（街）・arena（arena01）。URL の ?mode= / ?level=、前回のモード（mirrsona.soloMode）
    const SOLO = { free: { level: 'midtown', cityMode: 'free' }, royale: { level: 'midtown', cityMode: 'royale' }, arena: { level: 'arena01', cityMode: null } };
    const urlMode = (/[?&]mode=(free|royale|arena)\b/.exec(search) || [])[1] || null;
    const urlLevel = /[?&]level=/.test(search);
    let lastMode = prefs.get('soloMode');
    if (!SOLO[lastMode]) lastMode = null;
    const autostart = prefs.get('autostart');
    if (autostart) prefs.set('autostart', '');
    if (SOLO[autostart]) lastMode = autostart;
    // 「ソロ」ですぐ始めるか（自動テスト・URL でレベルかモードを指定）。それ以外はモードを選ぶ
    const directSolo = (HARNESS && !/[?&]picker=1\b/.test(search)) || urlLevel || !!urlMode;
    // レベル: URL の ?level= > ?mode= > 前回のモード > game.json の level > arena01（ソロだけ。オンラインは arena01）
    let levelId = urlLevel ? MR.Game.chooseLevel(gameConfig) : (urlMode ? SOLO[urlMode].level : (lastMode && !directSolo ? SOLO[lastMode].level : MR.Game.chooseLevel(gameConfig)));
    if (!assets.get('levels/' + levelId + '.json')) levelId = 'arena01';
    // 続きから始めるモード（今は街：フリーとアリーナの歩き。バトルロイヤル・乗り物・空中・オンラインは M5）と省メモリ
    const resumeMode = resumeDecision !== 'none' && sb.snap ? (sb.snap.level === 'midtown' ? sb.snap.cityMode : (sb.snap.level === 'arena01' ? 'arena' : null)) : null;
    const resumeSolo = resumeMode && resumeMode !== 'royale' && SOLO[resumeMode] && assets.get('levels/' + SOLO[resumeMode].level + '.json') ? SOLO[resumeMode] : null;
    if (!resumeSolo) { resumeDecision = 'none'; bootGuardOff('card'); }
    const saverNow = () => !!(MR.Session && MR.Session.saverActive());
    const resumeSaver = resumeDecision === 'saver' || resumeDecision === 'title' || saverNow();
    window.MR_RESUME = { decision: resumeDecision, crashes: sb ? sb.crashes.length : 0, counted: !!(sb && sb.counted), visible, native: isNative }; // テスト用
    const audio = new MR.Audio({ assets, config: gameConfig.audio });
    const hud = new MR.HUD($('hud'));
    const input = new MR.Input({
      canvas: $('game'),
      stickZone: $('stick-zone'),
      stick: $('stick'),
      knob: $('stick-knob'),
      lookPad: $('look-pad'),
      fire: $('btn-fire'),
      fireLeft: $('btn-fire-left'),
      jump: $('btn-jump'),
      reload: $('btn-reload'),
      swap: $('btn-swap'),
      ads: $('btn-ads'),
      vehicle: $('btn-vehicle'),
      descend: $('btn-descend'),
      camera: $('btn-camera'),
      seat: $('btn-seat'),
      pickup: $('btn-pickup'),
      heal: $('btn-heal'),
      drop: $('btn-drop'),
      gear: $('btn-gear'),
      eject: $('btn-eject'),
      missile: $('btn-missile'),
      flare: $('btn-flare'),
      launch: $('btn-launch'),
      land: $('btn-land'),
      boost: $('btn-boost'),
      slow: $('btn-slow'),
      settings: $('btn-settings'),
      spec: $('btn-spec-next')
    });

    // 世界のテクスチャもロード画面の間にデコードしておく（ゲーム中の差し替えによるカクつきを避ける）。10 秒（街は 20 秒）で打ち切り
    //   レベルごとに作る（街は窓の発光・テクスチャの上限が違う）。違うレベルを選んだら、そのとき読む（prepareMaterials）
    const matsByLevel = {};
    const rsBase = Object.assign({ anisotropy: 8, textures: true }, gameConfig.render || {});
    if (input.isTouchDevice && rsBase.mobile) Object.assign(rsBase, rsBase.mobile);
    const readyText = () => (info.source === 'embedded' ? '準備完了（内蔵データ）' : '準備完了 ' + info.tier.toUpperCase() + ' ' + fmt(info.totalBytes));
    //   省メモリ（saver）は別の材質（テクスチャの上限が違う）: キーは 'midtown|saver'
    const matKey = (lvId, saver) => lvId + (saver ? '|saver' : '');
    const prepareMaterials = async (lvId, onStatus, saver) => {
      const key = matKey(lvId, saver);
      if (Object.prototype.hasOwnProperty.call(matsByLevel, key)) return matsByLevel[key];
      if (!MR.Materials || info.source === 'embedded') { matsByLevel[key] = null; return null; }
      const ld = assets.get('levels/' + lvId + '.json') || {};
      const city = !!ld.chunkSize;
      try {
        const rsL = saver && MR.Session ? MR.Session.saverRender(rsBase, gameConfig.stability) : rsBase;
        const cityR = city && MR.CityWorld ? MR.CityWorld.config(rsL) : null;
        const m = new MR.Materials(assets, null, { tier, anisotropy: rsBase.anisotropy, useFiles: rsBase.textures !== false, seed: ld.seed, windowEmissive: cityR ? cityR.windowEmissive : undefined, textureMax: cityR ? cityR.textureMax : null });
        if (onStatus) onStatus(city ? '街のテクスチャを準備中' : 'テクスチャを準備中');
        // 街のときは街の材質も（arena01 では今までどおり arena の分だけ）
        await Promise.race([m.preload({ city }), new Promise((r) => setTimeout(r, city ? 20000 : 10000))]);
        matsByLevel[key] = m;
      } catch (e) {
        console.warn('[Boot] テクスチャの先読みに失敗:', e && e.message);
        matsByLevel[key] = null;
      }
      return matsByLevel[key];
    };
    // 先読みは「たぶん選ぶ」レベルが分かるときだけ（URL・自動テスト・前回のモード）。初めての起動では何も読まない
    //   （前はアリーナを読んでいて、街を選ぶ人は 148 MB の画像をずっと持っていた）。選んだときに startSolo が読む
    //   開始画面に止める（続けて落ちた: title）ときは何も先読みしない（先読みで落ちて読み直す、を繰り返さない。「続きから」を押したら読む）
    if (MR.Materials && info.source !== 'embedded' && resumeDecision !== 'title' && (directSolo || lastMode || resumeSolo)) {
      startBtn.classList.add('hidden');
      await prepareMaterials(resumeSolo ? resumeSolo.level : levelId, (t) => { status.textContent = t; }, resumeSolo ? resumeSaver : saverNow());
      status.textContent = readyText();
      startBtn.classList.remove('hidden');
      if ($('btn-online')) $('btn-online').classList.remove('hidden');
    }

    // 始めたゲームのレベルの材質を覚え（ゲームが自分で作ったものも。次の「もう一度」で使い回す）、ほかのレベルの材質のテクスチャは捨てる。
    //   今のレベルが使うキー（PC では街とアリーナで同じアルベドのキーがある）は残す
    let settledLevel = null;
    const settleMaterials = (game) => {
      const lv = game && game.levelId ? matKey(game.levelId, game.saver) : null;
      if (!lv) return;
      // レベルが変わったら、新しい場面で使っていない読み込み済みテクスチャ（前のレベルの GLB など）を GPU から捨てる（画像は残る）
      if (settledLevel && settledLevel !== lv && typeof assets.releaseGpuTextures === 'function') {
        try { assets.releaseGpuTextures(MR.AssetManager.texturesIn([game.scene, game.viewScene])); } catch (e) { console.warn('[Boot] GPU の解放', e); }
      }
      settledLevel = lv;
      if (!matsByLevel[lv] && game.materials && game.materials.textureKeys) matsByLevel[lv] = game.materials;
      const cur = matsByLevel[lv];
      const keep = cur && cur.textureKeys ? cur.textureKeys() : new Set();
      for (const k of Object.keys(matsByLevel)) {
        if (k === lv) continue;
        const m = matsByLevel[k];
        if (m && m !== cur && typeof m.disposeTextures === 'function') { try { m.disposeTextures(keep); } catch (e) { console.warn('[Boot] 材質の解放', e); } }
        delete matsByLevel[k];
      }
    };

    let started = false;
    let current = null; // { level, cityMode }（「もう一度」で同じものを始める）
    // mode: 'solo' | 'online'（net = welcome 済みの MR.Net）、solo: { level, cityMode }
    const makeGame = (mode, net, solo, renderer) => {
      // オンライン: arena は arena01、街（city_dm / city_royale）は welcome の level（midtown）
      const onlineLv = net && net.welcome && net.welcome.level === 'midtown' && MR.NetProto.isCity(net.mode) ? 'midtown' : 'arena01';
      const lv = mode === 'online' ? onlineLv : ((solo && solo.level) || levelId);
      const saver = mode !== 'online' && !!(solo && solo.saver);
      const key = matKey(lv, saver);
      const mats = Object.prototype.hasOwnProperty.call(matsByLevel, key) ? matsByLevel[key] : null;
      return new MR.Game({ canvas: $('game'), assets, audio, hud, input, materials: mats, mode, net, level: lv,
        cityMode: mode === 'online' ? null : (solo && solo.cityMode) || null, renderer: renderer || null, onAgain: mode === 'online' ? null : relaunch,
        resume: mode !== 'online' && solo && solo.resume ? solo.resume : null, saver });
    };
    const launch = (mode, net, solo) => {
      if (started) return false;
      started = true;
      bootGuardOff(); // ここからはゲームが保存する
      startBtn.removeEventListener('click', onSolo);
      audio.unlock();
      if (!HARNESS) tryFullscreen();
      loading.classList.add('hidden');
      try {
        current = solo || null;
        const game = makeGame(mode, net, solo, null);
        window.MR_GAME = game; // デバッグ用
        game.start();
        settleMaterials(game);
        return true;
      } catch (e) {
        console.error(e);
        started = false;
        if (net) net.close();
        loading.classList.remove('hidden');
        status.textContent = '起動に失敗しました: ' + e.message;
        return false;
      }
    };
    // 「もう一度」: 今のゲームを止め、同じレンダラーで同じモードを始める（読み直さない。音のロックも外れたまま）
    function relaunch(again, old) {
      let solo = SOLO[again] || current;
      if (!solo) return false;
      solo = Object.assign({}, solo, { resume: null, saver: saverNow() }); // 「もう一度」は新しく（続きからではない）
      const renderer = old && old.renderer;
      try { old.stop(); } catch (e) { console.warn('[Boot] stop', e); }
      try {
        const game = makeGame('solo', null, solo, renderer);
        window.MR_GAME = game;
        game.start();
        settleMaterials(game);
        current = solo;
        return true;
      } catch (e) {
        console.error(e);
        return false; // 読み直しに任せる
      }
    }

    // ---------- 続きから（カード）----------
    const resumeCard = $('resume-card');
    const hideResume = () => { if (resumeCard) resumeCard.classList.add('hidden'); };

    // ---------- ソロ: モードを選ぶ ----------
    const soloPanel = $('solo-panel');
    const soloStatus = $('solo-status');
    const markLast = () => {
      if (!soloPanel || !soloPanel.querySelectorAll) return;
      for (const b of soloPanel.querySelectorAll('.mode-opt')) b.classList.toggle('last', b.getAttribute('data-mode') === lastMode);
    };
    let soloBusy = false;
    const startSolo = async (m) => {
      const solo = SOLO[m];
      if (!solo || soloBusy || started) return false;
      soloBusy = true;
      lastMode = m;
      prefs.set('soloMode', m);
      markLast();
      if (MR.Session) MR.Session.clear(); // 新しく始める: 前回の続きは捨てる
      hideResume();
      const saver = saverNow();
      if (!Object.prototype.hasOwnProperty.call(matsByLevel, matKey(solo.level, saver))) {
        if (soloPanel) soloPanel.classList.add('busy');
        await prepareMaterials(solo.level, (t) => { if (soloStatus) soloStatus.textContent = t + '…'; }, saver);
        if (soloPanel) soloPanel.classList.remove('busy');
        if (soloStatus) soloStatus.textContent = '';
      }
      soloBusy = false;
      return launch('solo', null, Object.assign({}, solo, { saver }));
    };
    const openSolo = () => {
      if (started) return;
      loading.classList.add('solo-open');
      if (soloPanel) soloPanel.classList.remove('hidden');
      markLast();
    };
    const closeSolo = () => {
      loading.classList.remove('solo-open');
      if (soloPanel) soloPanel.classList.add('hidden');
    };
    if (soloPanel && soloPanel.querySelectorAll) {
      for (const b of soloPanel.querySelectorAll('.mode-opt')) b.addEventListener('click', () => { startSolo(b.getAttribute('data-mode')); });
    }
    const soloBack = $('btn-solo-back');
    if (soloBack) soloBack.addEventListener('click', closeSolo);
    // 「ソロ」: 自動テスト・URL 指定ならすぐ始める（今までどおり #btn-start で arena01 / ?level= のレベル）、ほかはモードを選ぶ
    const onSolo = () => {
      if (directSolo) {
        const m = urlMode || null;
        const solo = m ? SOLO[m] : { level: levelId, cityMode: null };
        launch('solo', null, solo);
      } else openSolo();
    };
    startBtn.addEventListener('click', onSolo);
    window.MR_START_SOLO = (m) => startSolo(m); // 自動テスト用
    if (SOLO[autostart] && !directSolo) openSolo(); // 「もう一度」で読み直したとき: 選ぶ画面をすぐ出す

    // ---------- オンライン ----------
    const onlineBtn = $('btn-online');
    const panel = $('online-panel');
    const callsignEl = $('callsign');
    const roomInput = $('room-code');
    const onlineStatus = $('online-status');
    const connectBtn = $('btn-connect');
    const netServer = resolveNetServer(gameConfig);
    const firstWeapon = ((gameConfig.weapons || [])[0] || {}).id || '';
    let callsign = prefs.get('callsign');
    if (!validCallsign(callsign)) { callsign = MR.NetProto.randomName(); prefs.set('callsign', callsign); }
    if (callsignEl) callsignEl.textContent = callsign;
    const savedRoom = prefs.get('room');
    if (roomInput && savedRoom) roomInput.value = MR.NetProto.cleanRoom(savedRoom);
    let pending = null; // 接続中の MR.Net
    // 遊び方（アリーナ / 街：個人戦 / 街：バトルロイヤル）。最後に選んだもの（無ければアリーナ）
    let onlineMode = MR.NetProto.cleanMode(prefs.get('onlineMode')) || 'arena';
    const modeBtns = panel && panel.querySelectorAll ? Array.from(panel.querySelectorAll('.op-mode')) : [];
    const markMode = () => { for (const b of modeBtns) b.classList.toggle('sel', b.getAttribute('data-mode') === onlineMode); };
    for (const b of modeBtns) b.addEventListener('click', () => { onlineMode = MR.NetProto.cleanMode(b.getAttribute('data-mode')) || 'arena'; prefs.set('onlineMode', onlineMode); markMode(); });
    markMode();

    const setOnlineStatus = (text, isError) => {
      if (!onlineStatus) return;
      onlineStatus.textContent = text || '';
      onlineStatus.classList.toggle('error', !!isError);
    };
    const cancelPending = () => {
      connectSeq++; // テクスチャを読んでいる途中の接続もやめる
      if (pending) { const n = pending; pending = null; n.close(); }
      if (connectBtn) connectBtn.disabled = false;
    };
    // 接続して welcome が来たらオンラインで始める。戻り値: 始まったら true。opts.mode: arena | city_dm | city_royale（省略は選んでいるもの）
    let connectSeq = 0;
    const connectOnline = async (opts) => {
      opts = opts || {};
      const server = opts.server || netServer;
      if (!server) { setOnlineStatus('サーバー未設定です', true); return false; }
      cancelPending();
      const mode = MR.NetProto.cleanMode(opts.mode != null ? opts.mode : onlineMode) || 'arena';
      const room = MR.NetProto.cleanRoom(opts.room != null ? opts.room : (roomInput ? roomInput.value : 'public'));
      if (roomInput) roomInput.value = room;
      prefs.set('room', room);
      const seq = ++connectSeq;
      if (connectBtn) connectBtn.disabled = true;
      // テクスチャを先に読んでから接続する（つないだまま長く待たせない）。街は midtown、アリーナは arena01（起動時には先読みしないことがある）
      const onlineLevel = MR.NetProto.isCity(mode) ? 'midtown' : 'arena01';
      if (!Object.prototype.hasOwnProperty.call(matsByLevel, onlineLevel)) {
        await prepareMaterials(onlineLevel, (t) => setOnlineStatus(t + '…'));
        if (seq !== connectSeq || started) return false;
      }
      const net = new MR.Net();
      pending = net;
      setOnlineStatus('接続中…');
      net.onStatus((st, text) => {
        if (pending !== net) return;
        if (st === 'reconnecting') setOnlineStatus('サーバーに接続できません。' + text, true);
        else if (st === 'connecting') setOnlineStatus('接続中…');
      });
      return net.connect(server, room, opts.name || callsign, firstWeapon, mode).then(() => {
        if (pending !== net) return false;
        pending = null;
        setOnlineStatus('接続しました（ルーム ' + room + '）');
        return launch('online', net);
      }).catch((e) => {
        if (pending === net) { pending = null; if (connectBtn) connectBtn.disabled = false; }
        if (e && e.code !== 'closed') setOnlineStatus((e && e.message) || '接続できません', true);
        return false;
      });
    };

    if (onlineBtn) {
      if (!netServer) {
        onlineBtn.disabled = true;
        onlineBtn.textContent = 'オンライン（サーバー未設定）';
      }
      onlineBtn.addEventListener('click', () => {
        if (!netServer || started) return;
        closeSolo();
        loading.classList.add('online-open');
        if (panel) panel.classList.remove('hidden');
        setOnlineStatus('');
      });
    }
    const reroll = $('btn-reroll');
    if (reroll) reroll.addEventListener('click', () => {
      callsign = MR.NetProto.randomName();
      prefs.set('callsign', callsign);
      if (callsignEl) callsignEl.textContent = callsign;
    });
    const back = $('btn-online-back');
    if (back) back.addEventListener('click', () => {
      cancelPending();
      setOnlineStatus('');
      loading.classList.remove('online-open');
      if (panel) panel.classList.add('hidden');
    });
    if (roomInput) {
      // 英数字と - _ だけ（小文字）
      roomInput.addEventListener('input', () => {
        const v = roomInput.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
        if (v !== roomInput.value) roomInput.value = v;
      });
      roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { roomInput.blur(); connectOnline(); } });
    }
    if (connectBtn) connectBtn.addEventListener('click', () => { connectOnline(); });
    if (onlineBtn && !startBtn.classList.contains('hidden')) onlineBtn.classList.remove('hidden');
    window.MR_START_ONLINE = (opts) => connectOnline(opts); // 自動テスト用

    // ---------- 続きから: アプリはすぐ・Web は 1 回タップ（音と全画面のロックを外す）。続けて落ちたら開始画面に「続きから」----------
    let resumeBusy = false;
    const startResume = async () => {
      if (resumeBusy || started || !resumeSolo || !sb || !sb.snap) return false;
      resumeBusy = true;
      hideResume();
      if (resumeSaver && !saverNow()) MR.Session.enterSaver(Date.now(), stab);
      MR.Session.markLaunch(); // ここから先で落ちても次の起動で数える（続けて落ちる → 省メモリ → 開始画面）
      bootGuardOff('resume'); // 裏へ行ったら hidden、戻ったら resume
      if (!Object.prototype.hasOwnProperty.call(matsByLevel, matKey(resumeSolo.level, resumeSaver))) {
        startBtn.classList.add('hidden');
        await prepareMaterials(resumeSolo.level, (t) => { status.textContent = t; }, resumeSaver);
        status.textContent = readyText();
        startBtn.classList.remove('hidden');
      }
      resumeBusy = false;
      return launch('solo', null, Object.assign({}, resumeSolo, { resume: sb.snap, saver: resumeSaver }));
    };
    window.MR_START_RESUME = () => startResume(); // 自動テスト用
    const saverOff = $('btn-saver-off');
    if (resumeSolo) {
      const auto = resumeDecision !== 'title' && visible && (isNative || sessCfg.webTapToResume === false);
      if (auto) startResume();
      else if (resumeCard) {
        const btn = $('btn-resume'), sub = $('resume-sub');
        const ago = Math.max(1, Math.round((Date.now() - (sb.snap.at || Date.now())) / 60000));
        const name = { free: '街：フリー', arena: 'アリーナ' }[resumeMode] || resumeMode;
        if (btn) btn.textContent = resumeDecision === 'title' ? '続きから' : '前回の続きから再開 ▶';
        if (sub) sub.textContent = name + '（' + ago + ' 分前）' + (resumeSaver ? '・省メモリモード' : '');
        resumeCard.classList.remove('hidden');
        bootGuardOff('card'); // 押すのを待っている間に閉じた・落ちたのは数えない
        if (btn) btn.addEventListener('click', () => { audio.unlock(); if (!HARNESS) tryFullscreen(); startResume(); });
        // アプリで見えないまま待っていた（WebKit のくせで visibilitychange が来ない）: 見えるようになったらすぐ始める
        if (isNative && !visible && resumeDecision !== 'title') {
          const onVis = () => { if (document.visibilityState !== 'hidden') { document.removeEventListener('visibilitychange', onVis); startResume(); } };
          document.addEventListener('visibilitychange', onVis);
        }
      }
    } else if (saverOff && saverNow()) {
      saverOff.classList.remove('hidden');
      saverOff.addEventListener('click', () => { MR.Session.clearSaver(); saverOff.classList.add('hidden'); });
    }

    // カード・「前回: …」・省メモリの解除を出したら開始画面を詰める（style.css の resume-open。横向きの iPhone でロゴが切れない）
    const shownEl = (id) => { const el = $(id); return !!el && !el.classList.contains('hidden'); };
    if (shownEl('resume-card') || shownEl('crumb') || shownEl('btn-saver-off')) loading.classList.add('resume-open');
    // 自動テスト（tools/screenshot.js）はこれを待ってから #btn-start を押す
    window.MR_READY = true;
  }

  // 見えるようになるまで待つ（アプリは裏で WebView が落ちるとすぐ読み直すので、boot() が裏で走ることがある）。
  //   'visible' = 見えている。sec 秒たっても visibilitychange が来ず、でもフォーカスがある（WebKit のくせ）なら 'card'（タップで始める）
  function whenVisible(sec) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') { resolve('visible'); return; }
      let done = false, timer = 0;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); resolve(v); };
      const onVis = () => { if (document.visibilityState !== 'hidden') finish('visible'); };
      document.addEventListener('visibilitychange', onVis);
      const check = () => {
        let focus = false;
        try { focus = !!(document.hasFocus && document.hasFocus()); } catch (e) { focus = false; }
        if (focus) finish('card'); else timer = setTimeout(check, 1000);
      };
      timer = setTimeout(check, Math.max(0, +sec || 5) * 1000);
    });
  }

  function tryFullscreen() {
    const isStandalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isStandalone || native) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try {
        const p = req.call(el);
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* iPhone Safari は非対応 */ }
    }
    if (screen.orientation && screen.orientation.lock) {
      try {
        const p = screen.orientation.lock('landscape');
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* 非対応 */ }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
