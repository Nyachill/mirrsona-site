// 起動処理: ロード画面 → データ準備（ダウンロード） → タップで開始
//
// URL パラメータ（Web / 動作確認用）:
//   ?tier=hd|sd   … アセットの品質ティアを固定（既定は MR.CONFIG.ASSET_TIER = 'auto'）
//   ?harness=1    … 自動テスト用。準備完了で window.MR_READY = true / window.MR_ASSETS を公開し、
//                    フルスクリーン・画面回転ロックをしない（tools/screenshot.js が使う）
//   ?noenv=1      … 環境マップ（PMREM）を使わない（sky.js が見る。SwiftShader で真っ黒になる対策）
//   ?server=ws://127.0.0.1:8787 … オンライン対戦のサーバー（既定は game.json の online.server。空なら「オンライン」のボタンを出さない）
//   ?level=midtown … ソロで遊ぶレベル（既定は game.json の level。無ければ arena01）。オンラインは arena01 のまま
//                    ?level=manhattan（本物のニューヨーク、v2 の街）: 始める前に core.bin と開始地点の周り 3 × 3 タイルを読む
//                    （prepareLevelData。「街のデータ n / 9」）。読めなければ midtown で始めてトースト。?mode=free|royale と一緒なら街の
//                    モードもそのレベルで（ふだんの「街：フリー / バトルロイヤル」のレベルは game.json の city.soloLevel、今は midtown）
//   ?spawn=123     … 街の開始地点の乱数（spawnPoints('solo', seed)）
//   ?mode=free|royale|arena … ソロのモード（開始画面で選ばずに「ソロ」ですぐ始める）。?rseed= バトルロイヤルの乱数
//   ?picker=1      … 自動テストでもモードの選択を出す（harness / ?level= / ?mode= のときは「ソロ」ですぐ始める）
//
// 開始画面: 「ソロ」（#btn-start）→ モードを選ぶ（#solo-panel: 「街：フリー」「街：バトルロイヤル」「アリーナ」。最後に選んだものを覚えて
//   印を付ける。mirrsona.soloMode）。テクスチャは起動時に「たぶん選ぶ」レベル（前回のモード / URL / game.json の level）の分を先に読み、
//   違うレベルを選んだらそのとき読む。「オンライン」（遊び方 = アリーナ / 街：個人戦 / 街：バトルロイヤル（最後に選んだものを覚える。
//   mirrsona.onlineMode、初めてはアリーナ）・コールサイン・ルームを選んで接続 → welcome が来たらオンラインで開始。街は先にテクスチャを読む）。
//   自動テストは window.MR_START_ONLINE({ server, room, name, mode, level }) / window.MR_START_SOLO('free' | 'royale' | 'arena' | 'manhattan') でも始められる。
//   'manhattan' =「街：ニューヨーク（試験版）」（manhattan の街：フリー。game.json の city.manhattanPicker が true のときだけ。データが読めなければ
//   midtown でトースト）
//   オンラインの v2 の街の読み込み中（welcome の後〜ready）は window.MR_ONLINE_PENDING() が { id, loading }。window.MR_HOLD_READY = true の間は
//   ready を送らずに待つ（tools/online-city-e2e.js --level manhattan が「読み込み中の人は他の人に見えない」を確かめる）
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

    if (MR.CineBench) { try { MR.CineBench.bootNote($('crumb')); } catch (e) { /* 無視 */ } } // 前回の ?memprobe の結果

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
      if (info.host) dataLabel += ' · ' + info.host; // 配信先（hosts.json があるときだけ。r2 / pages）
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
    // 前もって作った街の遠景（far.bin。citybake.js）: 端末にあれば開いてスカイライン・chunkTops を先に復元し、無ければバックグラウンドで
    //   ダウンロードする（開始画面もゲームも待たせない。無い間は今まで通りその場で作る）。開始画面に「街のデータ」の 1 行。
    //   preview.html（中に埋め込み・assets 無し）は使わない
    const cityLevelJson = assets.get('levels/midtown.json');
    const cityBake = MR.CityBake && cityLevelJson && !window.MR_PREVIEW
      ? MR.CityBake.get({ levelId: 'midtown', level: cityLevelJson, storage, assets, cfg: MR.CityBake.config(gameConfig.render || {}) }) : null;
    window.MR_CITYBAKE = cityBake; // テスト・デバッグ用
    if (cityBake) {
      const line = $('city-data');
      const show = () => { if (!line) return; const t = cityBake.statusText(); line.textContent = t; line.classList.toggle('hidden', !t); };
      cityBake.onStatus(show);
      cityBake.prepare().then(() => { show(); return cityBake.startDownload(); }).catch((e) => console.warn('[Boot] 街のデータ', e));
    }
    const urlMode = (/[?&]mode=(free|royale|arena)\b/.exec(search) || [])[1] || (MR.CineBench && MR.CineBench.wantsCity(search) ? 'free' : null); // ?bench=cine / ?memprobe=1 は街
    const urlLevel = /[?&]level=/.test(search);
    // ソロのモード: free / royale（街）・arena（arena01）。URL の ?mode= / ?level=、前回のモード（mirrsona.soloMode）
    //   街のレベル: game.json の city.soloLevel（今は midtown）。URL の ?level= が街（chunkSize のあるレベル）ならそれ
    let soloCity = (gameConfig.city || {}).soloLevel || 'midtown';
    if (urlLevel) { const u = MR.Game.chooseLevel(gameConfig), ud = assets.get('levels/' + u + '.json'); if (ud && ud.chunkSize) soloCity = u; }
    if (!assets.get('levels/' + soloCity + '.json')) soloCity = 'midtown';
    const SOLO = { free: { level: soloCity, cityMode: 'free' }, royale: { level: soloCity, cityMode: 'royale' }, arena: { level: 'arena01', cityMode: null } };
    // 「街：ニューヨーク（試験版）」= manhattan の街：フリー。ダウンロードする設定 city.manhattanPicker が true で manhattan.json があるときだけ。
    //   覚えていたのに出せない（false にした）ときは「街：フリー」を覚えていたことにする
    const nycPicker = (gameConfig.city || {}).manhattanPicker === true && !!assets.get('levels/manhattan.json');
    if (nycPicker) SOLO.manhattan = { level: 'manhattan', cityMode: 'free' };
    let lastMode = prefs.get('soloMode');
    if (lastMode === 'manhattan' && !SOLO.manhattan) lastMode = 'free';
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
    //   街は snap のレベル（midtown / manhattan。chunkSize のあるレベル）で続ける（今のソロの街と違っても）
    const snapLv = sb && sb.snap ? sb.snap.level : null, snapLvData = snapLv ? assets.get('levels/' + snapLv + '.json') : null;
    const snapCity = !!(snapLvData && snapLvData.chunkSize);
    const resumeMode = resumeDecision !== 'none' && sb.snap ? (snapCity ? sb.snap.cityMode : (snapLv === 'arena01' ? 'arena' : null)) : null;
    const resumeSolo = resumeMode && resumeMode !== 'royale' && SOLO[resumeMode] && assets.get('levels/' + SOLO[resumeMode].level + '.json') ? Object.assign({}, SOLO[resumeMode], snapCity ? { level: snapLv } : null) : null;
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
      knife: $('btn-knife'),
      ads: $('btn-ads'),
      vehicle: $('btn-vehicle'),
      descend: $('btn-descend'),
      crouch: $('btn-crouch'),
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
      if ($('btn-online') && resolveNetServer(gameConfig)) $('btn-online').classList.remove('hidden'); // サーバーが無ければ出さない（下の「オンライン」）
    }

    // ---------- v2 の街（manhattan.json の generator 'nyc'）のデータ: core.bin と開始地点の周りのタイル ----------
    //   MR.NycTiles.prepareLevel（core.bin → decodeCore → タイルの係 → 開始地点の 3 × 3 タイルを待つ）。読めたものはレベルごとに覚えて
    //   「もう一度」でも使う（同じタイルの係・同じ開始の乱数）。失敗（オフライン・内蔵データ・時間切れ）は ensureLevel が midtown に戻してトースト
    const levelData = {};
    const isNycLevel = (lv) => { const d = assets.get('levels/' + lv + '.json'); return !!(d && d.generator === 'nyc'); };
    const urlSpawn = /[?&]spawn=(\d+)/.exec(search);
    let pendingToast = null;
    const prepareLevelData = async (lvId, onStatus) => {
      if (!isNycLevel(lvId)) return null;
      if (levelData[lvId]) return levelData[lvId];
      if (!MR.NycTiles || !MR.NycData || !MR.CityGen.create) throw new Error('nyc scripts missing');
      const cityR = MR.CityWorld.config(rsBase);
      const r = await MR.NycTiles.prepareLevel(assets, assets.get('levels/' + lvId + '.json'), {
        cache: cityR.tileCache, concurrency: cityR.tileConcurrency, seed: urlSpawn ? Number(urlSpawn[1]) : undefined,
        timeoutMs: ((gameConfig.city || {}).loadTimeout || 60) * 1000,
        onStatus: (n, N) => { if (onStatus) onStatus('街のデータ ' + n + ' / ' + N); }
      });
      console.info('[Boot] 街のデータ', lvId, 'core', (r.core.byteLength / 1048576).toFixed(2) + ' MB', 'tiles', r.tiles.stats.decoded, Math.round(r.ms) + ' ms', 'spawn', Math.round(r.spawn.x), Math.round(r.spawn.z));
      levelData[lvId] = { core: r.core, tiles: r.tiles, spawnSeed: r.seed };
      return levelData[lvId];
    };
    // solo（{ level, cityMode }）を始められる形に: v2 の街ならデータを用意し、だめなら midtown（材質も読む）に替えてトーストを覚える
    const ensureLevel = async (solo, onStatus) => {
      if (!solo || !isNycLevel(solo.level)) return solo;
      try { await prepareLevelData(solo.level, onStatus); return solo; } catch (e) {
        console.warn('[Boot] 街のデータを読めません → midtown:', e && e.message);
        pendingToast = 'ニューヨークのデータを読み込めなかったので、いつもの街で始めます';
        const fb = Object.assign({}, solo, { level: 'midtown' });
        if (!Object.prototype.hasOwnProperty.call(matsByLevel, matKey('midtown', !!solo.saver))) await prepareMaterials('midtown', onStatus, !!solo.saver);
        return fb;
      }
    };

    // オンラインの v2 の街: core.bin とタイルの係だけ（開始地点はサーバーが welcome の後に決めるので、ここではタイルを待たない）。
    //   ソロで読んだもの（levelData）があればそれを使い、無ければ作ってレベルごとに覚える（ソロの「街：フリー」でも使う）
    const prepareLevelCore = async (lvId, onStatus) => {
      if (levelData[lvId]) return levelData[lvId];
      if (!MR.NycTiles || !MR.NycData || !MR.CityGen.create) throw new Error('nyc scripts missing');
      const lvl = assets.get('levels/' + lvId + '.json'), meta = assets.get(lvl.data || 'levels/nyc/nyc.json');
      if (!meta || !meta.bounds) throw new Error('nyc.json がありません');
      if (onStatus) onStatus('街のデータを準備中');
      const corePath = lvl.core || 'levels/nyc/core.bin';
      const buf = typeof assets.fetchLazy === 'function' ? await assets.fetchLazy(corePath, { priority: -2000 }) : await assets.getBuffer(corePath);
      if (!buf) throw new Error('core.bin がありません');
      const core = MR.NycData.decodeCore(buf);
      const cityR = MR.CityWorld.config(rsBase);
      const tiles = MR.NycTiles.fromAssets(assets, meta, { cache: cityR.tileCache, concurrency: cityR.tileConcurrency });
      levelData[lvId] = { core, tiles, spawnSeed: undefined };
      return levelData[lvId];
    };
    // welcome の後: 置かれそうな所（welcome.sp / 試合範囲の中心 / ロビーのホットゾーン）の周り 3 × 3 タイルを待つ（「街のデータ n / 9」）。
    //   待つ間も net.update()（ping。サーバーは loadTimeout まで待つ）。切れた・時間切れは reject
    const waitSpawnTiles = (lvId, net, onStatus) => {
      const ld = levelData[lvId], tiles = ld.tiles, w = net.welcome || {};
      let x, z;
      if (Array.isArray(w.sp) && w.sp.length >= 2) { x = w.sp[0]; z = w.sp[w.sp.length - 1]; }
      else if (w.area && isFinite(w.area.x)) { x = w.area.x; z = w.area.z; }
      else {
        if (!ld.probe) ld.probe = MR.CityGen.create(assets.get('levels/' + lvId + '.json'), { core: ld.core, meta: tiles.meta, gameOnly: true });
        const hz = ld.probe.hotZones || [], lz = ((gameConfig.online || {}).royale || {}).lobbyZone || 'gct';
        const h = hz.find((q) => q.id === lz) || hz[0] || { x: (ld.probe.minX + ld.probe.maxX) / 2, z: (ld.probe.minZ + ld.probe.maxZ) / 2 };
        x = h.x; z = h.z;
      }
      const c = tiles.tileOf(x, z), list = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const tx = c[0] + dx, tz = c[1] + dz;
        if (tx >= 0 && tz >= 0 && tx < tiles.nx && tz < tiles.nz && tiles.hasFile(tx, tz)) list.push([tx, tz]);
      }
      // タイルを待つ間に乗り物（駐車の車 8〜25 ms。core だけで決まり、同じ core のゲームの街が使う）を作っておく
      setTimeout(() => {
        try {
          (ld.probe || MR.CityGen.create(assets.get('levels/' + lvId + '.json'), { core: ld.core, meta: tiles.meta, gameOnly: true })).vehicleSpawns();
        } catch (e) { /* ゲームが作る */ }
      }, 0);
      const limitMs = Math.max(10, ((gameConfig.online || {}).loadTimeout || 60) - 5) * 1000;
      const t0 = performance.now();
      let n = 0, pumpT = 0;
      if (onStatus) onStatus('街のデータ 0 / ' + list.length);
      return new Promise((resolve, reject) => {
        const stop = () => clearInterval(pumpT);
        pumpT = setInterval(() => {
          const s0 = performance.now();
          while (performance.now() - s0 < 12 && tiles.pump(Infinity)) { /* 1 つずつ */ }
          try { net.update(); } catch (e) { /* 次で */ }
          if (net.status === 'error' || net.status === 'closed') { stop(); reject(Object.assign(new Error(net.statusText || '切断しました'), { code: (net.error && net.error.code) || 'closed' })); }
          else if (performance.now() - t0 > limitMs) { stop(); reject(Object.assign(new Error('街のデータの読み込みが時間切れ'), { code: 'tiles' })); }
        }, 16);
        Promise.all(list.map((t) => {
          const x0 = tiles.minX + t[0] * tiles.size, z0 = tiles.minZ + t[1] * tiles.size;
          return tiles.whenReady([x0 + 1, z0 + 1, x0 + tiles.size - 1, z0 + tiles.size - 1]).then(() => { n++; if (onStatus) onStatus('街のデータ ' + n + ' / ' + list.length); });
        })).then(() => { stop(); resolve(); }, (e) => { stop(); reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { code: 'tiles' })); });
      });
    };

    // 地図データの表示（ODbL / Overture のクレジット）: ニューヨークのデータ（levels/nyc/nyc.json）が入っている版ではいつも出す
    //   （ダウンロードできる配信物に含まれるので、遊ぶ前・どのモードでも見える所に。開始画面の下と設定の板）
    if (assets.get('levels/nyc/nyc.json')) for (const id of ['credits', 'st-credits']) { const el = $(id); if (el) el.classList.remove('hidden'); }

    // URL で v2 の街をすぐ始める（?level=manhattan・自動テスト）: 開始画面の間に街のデータも読んでおく（失敗は「ソロ」の時に midtown へ）
    {
      const dl = directSolo ? (urlMode ? SOLO[urlMode].level : levelId) : null;
      if (dl && isNycLevel(dl) && resumeDecision !== 'title') {
        startBtn.classList.add('hidden');
        try { await prepareLevelData(dl, (t) => { status.textContent = t; }); } catch (e) { console.warn('[Boot] 街のデータ（先読み）:', e && e.message); }
        status.textContent = readyText();
        startBtn.classList.remove('hidden');
      }
    }

    // 始めたゲームのレベルの材質を覚え（ゲームが自分で作ったものも。次の「もう一度」で使い回す）、ほかのレベルの材質のテクスチャは捨てる。
    //   今のレベルが使うキー（PC では街とアリーナで同じアルベドのキーがある）は残す
    let settledLevel = null;
    const settleMaterials = (game) => {
      const lv = game && game.levelId ? matKey(game.levelId, game.saver) : null;
      if (!lv) return;
      // 前のゲームがあれば（レベルが変わっても、同じレベルの「もう一度」でも）、新しい場面で使っていない読み込み済みテクスチャ
      //   （前のレベルの GLB・前のゲームで見た乗り物 / 兵士の GLB など）を GPU から捨てる（画像は残るので、使えば上げ直す）。
      //   以前はレベルが変わったときだけで、街：フリーで見た兵士・乗り物の GLB が「もう一度」のバトルロイヤルに残っていた
      //   捨てるのは新しい場面が組み上がってから（game.scheduleGpuRelease: render.gpuTextures.releaseAfter 秒。始めた直後に捨てると、まだ
      //   場面に無い街の材質・ランドマーク・空・敵も捨てて次のフレームで全部上げ直していた）。このレベルの材質（Materials のセット）は
      //   その時に場面に無くても残す（バトロワの空の上には近くの通りが無く、次の「もう一度」のフリーで通りの材質を 1 フレームに 66 MB
      //   上げ直していた。残すと test:mem の「もう一度」の後が 22〜32 MB 増えるが、ピークは変わらない）
      if (settledLevel && typeof assets.releaseGpuTextures === 'function') {
        const release = () => {
          const keep = MR.AssetManager.texturesIn([game.scene, game.viewScene]);
          const sets = game.materials && game.materials.sets;
          if (sets) for (const n in sets) { const st = sets[n]; if (st && st.textures) for (const k in st.textures) if (st.textures[k]) keep.add(st.textures[k]); }
          // S7d: 街の小物（city_props.glb）も場面に無くても残す（バトロワの空の上には小物が無く、次の「もう一度」のフリーで 7 MB 上げ直していた）
          const pr = game.world && game.world.props;
          if (pr && pr.kinds) for (const ty in pr.kinds) { const kd = pr.kinds[ty]; for (const p of (kd && kd.parts) || []) if (p.mat) for (const s of MR.AssetManager.TEXTURE_SLOTS) if (p.mat[s] && p.mat[s].isTexture) keep.add(p.mat[s]); }
          const cpk = game.isCity && typeof assets.resolve === 'function' ? assets.resolve('models/city_props.glb') : null;
          const cpg = cpk && assets._modelLoaded && assets._modelLoaded[cpk];
          if (cpg && cpg.scene) MR.AssetManager.texturesIn([cpg.scene], keep);
          assets.releaseGpuTextures(keep);
        };
        try { if (typeof game.scheduleGpuRelease === 'function') game.scheduleGpuRelease(release); else release(); } catch (e) { console.warn('[Boot] GPU の解放', e); }
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
      // オンライン: arena は arena01、街（city_dm / city_royale）は welcome の level（midtown / manhattan。そのレベルのデータがあるとき）
      const wl = net && net.welcome ? net.welcome.level : null;
      const onlineLv = wl && MR.NetProto.isCity(net.mode) && wl !== 'arena01' && assets.get('levels/' + wl + '.json') && (!isNycLevel(wl) || levelData[wl]) ? wl : 'arena01';
      const lv = mode === 'online' ? onlineLv : ((solo && solo.level) || levelId);
      const saver = mode !== 'online' && !!(solo && solo.saver);
      const key = matKey(lv, saver);
      const mats = Object.prototype.hasOwnProperty.call(matsByLevel, key) ? matsByLevel[key] : null;
      const nd = levelData[lv] || null; // v2 の街: core とタイル（ソロは prepareLevelData、オンラインは prepareLevelCore）
      // 街の遠景のデータ: 街のときだけ渡す（アリーナは起動時に復元したスカイラインの配列を捨てる = trim）
      if (cityBake && lv !== 'midtown') cityBake.trim();
      return new MR.Game({ canvas: $('game'), assets, audio, hud, input, materials: mats, mode, net, level: lv,
        core: nd ? nd.core : null, tiles: nd ? nd.tiles : null, spawnSeed: mode === 'online' ? undefined : (solo && solo.spawnSeed != null ? solo.spawnSeed : (nd ? nd.spawnSeed : undefined)),
        cityMode: mode === 'online' ? null : (solo && solo.cityMode) || null, renderer: renderer || null, onAgain: mode === 'online' ? null : relaunch,
        resume: mode !== 'online' && solo && solo.resume ? solo.resume : null, saver, cityBake: lv === 'midtown' ? cityBake : null });
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
        if (pendingToast) { hud.showMessage(pendingToast, 4500); pendingToast = null; }
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
      // v2 の街: 開始地点も新しく（?spawn= で決めたときを除く。その場のタイルはゲームが _tileHold で待つ）
      if (isNycLevel(solo.level) && levelData[solo.level] && !urlSpawn) solo.spawnSeed = Math.floor(Math.random() * 1e6);
      const renderer = old && old.renderer;
      try { old.stop(); } catch (e) { console.warn('[Boot] stop', e); }
      const go = () => {
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
      };
      // 街: far.bin があるのにスカイラインを今持っていない（ゲームの最中に届いた = 「街のデータを削除」の後に取り直した・アリーナで trim した）なら、
      //   開始画面の startSolo と同じく whenSky（前のゲームの stop で街のワールドを返した後のワーカーの復元。最長 startWaitMs）を待ってから始める
      //   （以前は待たずに始め、スカイラインをその場で作り直していた）。持っていれば・far.bin が無ければ今まで通りすぐ
      if (cityBake && solo.level === 'midtown' && cityBake.usable && cityBake.far && !cityBake.sky) {
        cityBake.whenSky().then(() => null, () => null).then(() => {
          if (go()) return;
          // 始められなかった: leaveToTitle と同じく読み直して開始画面でそのモードを選んだ状態にする
          try { MR.Game._savePref('autostart', String(again)); } catch (e) { /* 無視 */ }
          if (typeof location !== 'undefined' && location.reload) setTimeout(() => location.reload(), 50);
        });
        return true;
      }
      return go();
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
      // 街: 起動時に始めた far.bin の確認とスカイラインの復元を待つ（最長 startWaitMs。アリーナの後なら trim した配列をワーカーで戻す）
      const sky = cityBake && solo.level === 'midtown' ? cityBake.whenSky() : null;
      lastMode = m;
      prefs.set('soloMode', m);
      markLast();
      if (MR.Session) MR.Session.clear(); // 新しく始める: 前回の続きは捨てる
      hideResume();
      const saver = saverNow();
      const onSt = (t) => { if (soloStatus) soloStatus.textContent = t + '…'; };
      if (!Object.prototype.hasOwnProperty.call(matsByLevel, matKey(solo.level, saver))) {
        if (soloPanel) soloPanel.classList.add('busy');
        await prepareMaterials(solo.level, onSt, saver);
        if (soloPanel) soloPanel.classList.remove('busy');
        if (soloStatus) soloStatus.textContent = '';
      }
      let go = Object.assign({}, solo, { saver });
      if (isNycLevel(go.level) && !levelData[go.level]) {
        if (soloPanel) soloPanel.classList.add('busy');
        go = await ensureLevel(go, onSt);
        if (soloPanel) soloPanel.classList.remove('busy');
        if (soloStatus) soloStatus.textContent = '';
      }
      if (sky) await sky;
      soloBusy = false;
      return launch('solo', null, go);
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
      for (const b of soloPanel.querySelectorAll('.mode-opt')) {
        if (b.getAttribute('data-mode') === 'manhattan') b.classList.toggle('hidden', !nycPicker);
        b.addEventListener('click', () => { startSolo(b.getAttribute('data-mode')); });
      }
    }
    const soloBack = $('btn-solo-back');
    if (soloBack) soloBack.addEventListener('click', closeSolo);
    // 「ソロ」: 自動テスト・URL 指定ならすぐ始める（今までどおり #btn-start で arena01 / ?level= のレベル）、ほかはモードを選ぶ
    const onSolo = async () => {
      if (directSolo) {
        if (soloBusy || started) return;
        const m = urlMode || null;
        let solo = m ? SOLO[m] : { level: levelId, cityMode: null };
        if (isNycLevel(solo.level) && !levelData[solo.level]) {
          soloBusy = true;
          startBtn.classList.add('hidden');
          solo = await ensureLevel(solo, (t) => { status.textContent = t; });
          status.textContent = readyText();
          soloBusy = false;
        }
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
    // 街のレベル（街のモードのとき）: game.json の online.cityLevel（既定 midtown）。online.cityLevels が 2 つ以上（データのあるもの）なら
    //   「街: ミッドタウン / ニューヨーク」を出して選べる（mirrsona.onlineLevel に覚える）
    const onCfg = gameConfig.online || {};
    const hasLevel = (lv) => typeof lv === 'string' && !!assets.get('levels/' + lv + '.json');
    const defCityLevel = hasLevel(onCfg.cityLevel) ? onCfg.cityLevel : 'midtown';
    const cityLevels = (Array.isArray(onCfg.cityLevels) ? onCfg.cityLevels : [defCityLevel]).filter((lv, k, a) => hasLevel(lv) && a.indexOf(lv) === k);
    const LEVEL_LABEL = { midtown: 'ミッドタウン', manhattan: 'ニューヨーク' };
    let onlineLevel = cityLevels.length > 1 && cityLevels.indexOf(prefs.get('onlineLevel')) >= 0 ? prefs.get('onlineLevel') : defCityLevel;
    const levelRow = $('op-level');
    const levelBtns = [];
    if (levelRow && cityLevels.length > 1) {
      const box = levelRow.querySelector ? levelRow.querySelector('.op-levels') : null;
      for (const lv of cityLevels) {
        if (!box || !document.createElement) break;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'op-lv'; b.setAttribute('data-level', lv);
        b.textContent = LEVEL_LABEL[lv] || (assets.get('levels/' + lv + '.json') || {}).name || lv;
        b.addEventListener('click', () => { onlineLevel = lv; prefs.set('onlineLevel', lv); markMode(); });
        box.appendChild(b);
        levelBtns.push(b);
      }
    }
    function markMode() {
      for (const b of modeBtns) b.classList.toggle('sel', b.getAttribute('data-mode') === onlineMode);
      for (const b of levelBtns) b.classList.toggle('sel', b.getAttribute('data-level') === onlineLevel);
      const showLv = levelBtns.length > 1 && MR.NetProto.isCity(onlineMode);
      if (levelRow) levelRow.classList.toggle('hidden', !showLv);
      if (panel) panel.classList.toggle('has-level', showLv); // 背の低い画面では詰める（style.css）
    }
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
    // 接続して welcome が来たらオンラインで始める。戻り値: 始まったら true。opts.mode: arena | city_dm | city_royale（省略は選んでいるもの）、
    //   opts.level: 街のレベル（省略は選んでいるもの / online.cityLevel）。v2 の街（manhattan）は:
    //   接続の前に材質と core.bin（prepareLevelCore）→ URL と hello に level・ld → welcome（サーバーは「読み込み中」で待つ）→ 置かれそうな所の
    //   3 × 3 タイル（waitSpawnTiles、「街のデータ n / 9」）→ net.ready() → ゲーム。データが読めない・サーバーにその街が無い（error level）・
    //   時間切れは、トーストを覚えて midtown でつなぎ直す。online.levels.<level>.server があればその街の部屋はそのサーバーへ（URL の ?server= が先）
    let connectSeq = 0;
    const connectOnline = async (opts) => {
      opts = opts || {};
      const mode = MR.NetProto.cleanMode(opts.mode != null ? opts.mode : onlineMode) || 'arena';
      let cityLv = MR.NetProto.isCity(mode) ? (hasLevel(opts.level) ? opts.level : onlineLevel) : null;
      if (cityLv && !hasLevel(cityLv)) cityLv = 'midtown';
      const lvServer = (lv) => {
        const ls = lv && onCfg.levels && onCfg.levels[lv] ? String(onCfg.levels[lv].server || '').trim() : '';
        return opts.server || (ls && !/[?&]server=/.test(search) ? ls : netServer);
      };
      if (!lvServer(cityLv)) { setOnlineStatus('サーバー未設定です', true); return false; }
      cancelPending();
      const room = MR.NetProto.cleanRoom(opts.room != null ? opts.room : (roomInput ? roomInput.value : 'public'));
      if (roomInput) roomInput.value = room;
      prefs.set('room', room);
      const seq = ++connectSeq;
      if (connectBtn) connectBtn.disabled = true;
      const fallback = (why) => {
        console.warn('[Online] ' + cityLv + ' → midtown:', why);
        pendingToast = 'ニューヨークのデータを読み込めなかったので、いつもの街につなぎます';
        return connectOnline(Object.assign({}, opts, { mode, level: 'midtown', server: opts.server }));
      };
      // v2 の街: core.bin（とタイルの係）を接続の前に
      if (cityLv && isNycLevel(cityLv)) {
        try { await prepareLevelCore(cityLv, (t) => setOnlineStatus(t + '…')); } catch (e) {
          if (seq !== connectSeq || started) return false;
          return fallback(e && e.message);
        }
        if (seq !== connectSeq || started) return false;
      }
      // テクスチャを先に読んでから接続する（つないだまま長く待たせない）。街は選んだ街、アリーナは arena01（起動時には先読みしないことがある）
      const matLevel = cityLv || 'arena01';
      const sky = cityBake && matLevel === 'midtown' ? cityBake.whenSky() : null; // 街の遠景（startSolo と同じ。midtown だけ）
      if (!Object.prototype.hasOwnProperty.call(matsByLevel, matLevel)) {
        await prepareMaterials(matLevel, (t) => setOnlineStatus(t + '…'));
        if (seq !== connectSeq || started) return false;
      }
      if (sky) { await sky; if (seq !== connectSeq || started) return false; }
      const net = new MR.Net();
      pending = net;
      setOnlineStatus('接続中…');
      net.onStatus((st, text) => {
        if (pending !== net) return;
        if (st === 'reconnecting') setOnlineStatus('サーバーに接続できません。' + text, true);
        else if (st === 'connecting') setOnlineStatus('接続中…');
      });
      const v2 = !!(cityLv && isNycLevel(cityLv));
      return net.connect(lvServer(cityLv), room, opts.name || callsign, firstWeapon, mode, v2 ? cityLv : null).then(async (w) => {
        if (pending !== net) return false;
        if (v2 && w && w.level && w.level !== cityLv) throw Object.assign(new Error('level ' + w.level), { code: 'level' });
        if (net.loading) {
          // サーバーは「読み込み中」で待っている: 置かれそうな所のタイルが届いたら ready
          await waitSpawnTiles(cityLv, net, (t) => { if (pending === net) setOnlineStatus(t); });
          while (window.MR_HOLD_READY && pending === net && net.status === 'open') { await new Promise((r) => setTimeout(r, 100)); try { net.update(); } catch (e) { /* 次で */ } }
          if (pending !== net) return false;
          net.ready();
        }
        pending = null;
        setOnlineStatus('接続しました（ルーム ' + room + '）');
        return launch('online', net);
      }).catch((e) => {
        const mine = pending === net;
        if (mine) { pending = null; if (connectBtn) connectBtn.disabled = false; }
        // v2 の街に入れない（サーバーにその街が無い・タイルが読めない）→ midtown でつなぎ直す
        if (v2 && mine && e && (e.code === 'level' || e.code === 'tiles')) { net.close(); return fallback(e.message); }
        if (e && e.code !== 'closed') setOnlineStatus((e && e.message) || '接続できません', true);
        return false;
      });
    };

    // サーバーが無い（game.json の online.server が空で ?server= も無い）ときは「オンライン」を出さない（以前は薄い「オンライン（サーバー未設定）」:
    //   App Review 2.1 で「動かないボタン」に見える。plans/online2.md E46）。自動テストは ?server= か MR_START_ONLINE({ server }) で入る
    if (onlineBtn) {
      if (!netServer) onlineBtn.classList.add('hidden');
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
    if (onlineBtn && netServer && !startBtn.classList.contains('hidden')) onlineBtn.classList.remove('hidden');
    window.MR_START_ONLINE = (opts) => connectOnline(opts); // 自動テスト用
    window.MR_ONLINE_PENDING = () => (pending ? { id: pending.id, loading: !!pending.loading, status: pending.status, level: pending.level } : null);

    // ---------- 続きから: アプリはすぐ・Web は 1 回タップ（音と全画面のロックを外す）。続けて落ちたら開始画面に「続きから」----------
    let resumeBusy = false;
    const startResume = async () => {
      if (resumeBusy || started || !resumeSolo || !sb || !sb.snap) return false;
      resumeBusy = true;
      hideResume();
      if (resumeSaver && !saverNow()) MR.Session.enterSaver(Date.now(), stab);
      MR.Session.markLaunch(); // ここから先で落ちても次の起動で数える（続けて落ちる → 省メモリ → 開始画面）
      bootGuardOff('resume'); // 裏へ行ったら hidden、戻ったら resume
      const sky = cityBake && resumeSolo.level === 'midtown' ? cityBake.whenSky() : null; // 街の遠景（startSolo と同じ）
      if (!Object.prototype.hasOwnProperty.call(matsByLevel, matKey(resumeSolo.level, resumeSaver))) {
        startBtn.classList.add('hidden');
        await prepareMaterials(resumeSolo.level, (t) => { status.textContent = t; }, resumeSaver);
        status.textContent = readyText();
        startBtn.classList.remove('hidden');
      }
      // v2 の街: core と開始地点のタイル（続きの場所のタイルはゲームが placePlayer の _tileHold で待つ）。読めずに midtown になったら続きにしない
      let go = resumeSolo;
      if (isNycLevel(go.level)) {
        startBtn.classList.add('hidden');
        go = await ensureLevel(go, (t) => { status.textContent = t; });
        status.textContent = readyText();
        startBtn.classList.remove('hidden');
      }
      if (sky) await sky;
      resumeBusy = false;
      return launch('solo', null, Object.assign({}, go, { resume: go.level === resumeSolo.level ? sb.snap : null, saver: resumeSaver }));
    };
    window.MR_START_RESUME = () => startResume(); // 自動テスト用
    const saverOff = $('btn-saver-off');
    if (resumeSolo) {
      const auto = resumeDecision !== 'title' && visible && (isNative || sessCfg.webTapToResume === false);
      if (auto) startResume();
      else if (resumeCard) {
        const btn = $('btn-resume'), sub = $('resume-sub');
        const ago = Math.max(1, Math.round((Date.now() - (sb.snap.at || Date.now())) / 60000));
        const name = resumeMode === 'free' && sb.snap.level && sb.snap.level !== 'midtown' && isNycLevel(sb.snap.level) ? '街：ニューヨーク（試験版）'
          : ({ free: '街：フリー', arena: 'アリーナ' }[resumeMode] || resumeMode);
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
