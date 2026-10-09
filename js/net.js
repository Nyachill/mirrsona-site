// オンライン対戦の通信（クライアント側）。プロトコルは netproto.js（MR.NetProto）の冒頭を参照。
//   - connect(url, room, name, weapon): ws(s)://<server>/room/<room> に接続して hello を送る。welcome で準備完了
//   - update(): 毎フレーム呼ぶ。stateProvider / vstateProvider が返すものを STATE_HZ で送り、2 秒ごとに ping
//   - ping → RTT とサーバー時計とのずれ（offset）を推定。serverNow() = 端末の時刻 + offset。
//     welcome（接続・再接続）と、画面が 1 秒以上止まった後（端末の時計が止まっていたかもしれない）は測り直す
//   - snap はプレイヤー・乗り物ごとのバッファに入れ、sample(id) / sampleVehicle(i) で
//     serverNow() - interpDelay の時点を補間して返す（位置は線形、角度は短い方向に回る）。interpDelay は snap の届き方の
//     揺れ（直近 3 秒の遅れの 90 % 点 + snap 間隔）に合わせて INTERP_DELAY〜MAX_INTERP_DELAY で動く。
//     最後の snap より先は MAX_EXTRAPOLATE 秒まで直前の動きを延ばす（遅れて届いても止まって跳ねない）
//   - 切れたら 1 s, 2 s, 4 s … 最大 10 s の間隔で再接続（status と onStatus で画面に出す）。close() で終わり
//     接続（ハンドシェイク〜welcome）が connectTimeout（既定 8 s）で終わらない、または接続中に何も届かない状態が
//     idleTimeout（既定 10 s）続いたときも、ソケットを閉じて同じ間隔で再接続する。
//     画面が resumeDropAfter（5 s）以上止まっていた後はすぐ入り直し、それより短ければ resumeCheck（3 s）以内に何か届くか見る
//   - 再接続の hello には前の welcome の再開トークン（rt）を付ける → サーバーは同じ人（id・撃破数）として続ける。
//     遊んでいる途中の再接続で full / busy が返ったとき（自分の古い接続がまだ席を取っているなど）は諦めずに待って入り直す
//   - 自分の行（snap の pl）は selfServer に入れる（サーバーが自分をどこにいると思っているか・最後に処理した state の番号 ack。
//     game.js が位置のずれを直す）。送った state は onStateSent(seq, state) で知らせる
//   - それ以外のメッセージ（join / leave / fire / damage / kill / spawn / vowner …）は setHandler(fn) に渡す。
//     ハンドラが付く前に届いたものは貯めておき、付いた時点でまとめて渡す（welcome とゲーム開始の間に来たもの）
// THREE に依存しない（Node 22 の global WebSocket でも動く。tools/smoke-test.js が使う）
//
// 街（city_dm / city_royale。connect の 5 番目の引数 mode）:
//   - 接続先は …/room/<room>?mode=<mode>、hello に mode を付ける（arena は今まで通り何も付けない）
//   - 束ね（bundle。既定は街だけ）: queue(msg) は次の state と一緒に送る（fire / hit / vhit）。send(msg) は貯まっている分と一緒に
//     すぐ送る。STATE_HZ の送信は [vstate, state, 貯めた分…, ping] を { t: 'b', m: [...] }（BUNDLE_MAX 通・MAX_MESSAGE 文字まで）
//     1 通にする（Cloudflare の Durable Object は受けた WebSocket のメッセージの数で数えるので、撃ち合いでも 1 秒 15 通前後）。
//     requestState() で次の update() に state を前倒しする（落ちながら撃ったときなど、撃った位置と state の位置を近くに保つ）
//   - snap の行は 14 列（… ack, m, seat）。sample() は m / seat も返す。入っていない人（遠い = interest の外）の行は来ないので、
//     1 秒以上空いて戻ってきた人のバッファは作り直す（前の位置から滑ってこない）
//   - 乗り物の行は 11 列（… y, pitch, roll, rpm）。sampleVehicle() は y / pitch / roll / rpm も補間する。
//     predictVehicle(i, t) は最新の行をサーバー時刻 t まで延ばした位置（同乗の席の位置・自分の乗っている乗り物の見た目）
//   - vehicles は乗り物の番号 i ごと（街の welcome は最初と違う物だけ。vseat の occ で席を持つ）
//   - stats: wsOut / bytesOut（送った WebSocket のメッセージ・バイト）、bytesIn、bundles（束ねた数）
window.MR = window.MR || {};

MR.Net = class Net {
  constructor(opts) {
    opts = opts || {};
    this.P = MR.NetProto;
    this.WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.clock = opts.now || (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
    this.ws = null;
    this.url = '';
    this.room = 'public';
    this.name = '';
    this.weapon = '';
    this.id = -1;
    this.welcome = null;
    this.players = new Map();     // id → PlayerInfo（スコア・名前。自分も含む）
    this._names = new Map();      // id → 名前（抜けた人も結果画面で名前を出すために覚えておく）
    this.vehicles = [];           // welcome の VehicleInfo（以降は vowner / vdamage / vrespawn で更新）
    this.status = 'idle';         // idle | connecting | open | reconnecting | closed | error
    this.statusText = '';
    this.error = null;            // { code, msg }（full / version など、再接続しない失敗）
    this.rtt = 0;                 // ms
    this.offset = 0;              // サーバー時刻 − 端末の時刻（ms）
    this._offsetSamples = [];
    this._rttSamples = [];        // 直近の RTT（ms）。表示はこの中央値（1 回だけの遅い返事に引っぱられない）
    this._pingEpoch = 0;          // これより前に送った ping の返事は測定に使わない（discardPings）
    this.selfServer = null;       // { t, x, y, z, veh, ack } サーバーの snap にある自分の位置と、最後に処理された state の番号
    this.connectTimeout = opts.connectTimeout || 8000;  // ms。接続〜welcome の上限
    this.idleTimeout = opts.idleTimeout || 10000;       // ms。接続中に何も届かない時間の上限（snap は 15 回/秒来る）
    this.resumeDropAfter = opts.resumeDropAfter || 5000; // ms。画面がこれ以上止まっていたら（バックグラウンド）すぐ入り直す
    this.resumeCheck = opts.resumeCheck || 3000;         // ms。それより短い停止の後、何か届くまで待つ時間
    this.resumeToken = null;      // welcome の rt（再接続の hello に付ける）
    this._hadWelcome = false;     // この connect() で一度でも welcome が来たか（来た後の full / busy は待って入り直す）
    this._closeWhy = null;
    this._lastUpdate = 0;
    this._lastUpdateWall = 0;
    // バックグラウンドに回った（画面ロック・アプリ切り替え）かを覚える（戻った後の update で、長ければすぐ入り直す）
    this._wasHidden = false;
    this._onVisibility = () => { if (this._isHidden()) this._wasHidden = true; };
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      try { document.addEventListener('visibilitychange', this._onVisibility); } catch (e) { /* 任意 */ }
    }
    this.interpDelay = this.P.INTERP_DELAY * 1000; // ms。他のプレイヤーを描く遅れ（届き方の揺れで広がる）
    this._late = [];              // 直近の snap の遅れ（serverNow() − snap.now、ms）
    this._connTimer = null;
    this._lastRecv = 0;
    this.stateProvider = null;    // () => state メッセージ（t 以外）か null（死亡中など）
    this.vstateProvider = null;   // () => vstate メッセージ（t 以外）か null（運転していない）
    this.onStateSent = null;      // (seq, state) => void  state を送った（game.js が送った位置を番号つきで覚える）
    this._handler = null;
    this._queue = [];
    this._buffers = new Map();    // プレイヤー id → [{ t, s: [...] }]
    this._vbuffers = new Map();   // 乗り物 i → [{ t, s: [...] }]
    this._seq = 0;
    this._nextState = 0;
    this._nextPing = 0;
    this._retry = 0;
    this._retryTimer = null;
    this._closedByUser = false;
    this._statusCbs = [];
    this._welcomeWaiters = [];
    this.mode = 'arena';          // arena | city_dm | city_royale（connect の mode）
    this.city = false;
    this.bundle = opts.bundle;    // 束ねるか（undefined = 街だけ）
    this._out = [];               // 束ねて送るメッセージ（queue / send）
    this._pingDue = false;
    this.stats = { sent: 0, received: 0, bad: 0, reconnects: 0, wsOut: 0, bytesOut: 0, bytesIn: 0, bundles: 0, msgsOut: 0 };
  }

  // ---------- 接続 ----------

  // url: 'wss://host' / 'ws://127.0.0.1:8787'（末尾の / と /room/... は付けない）。mode: 'arena'（既定）| 'city_dm' | 'city_royale'。
  // 戻り値: welcome で解決する Promise
  connect(url, room, name, weapon, mode) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.room = this.P.cleanRoom(room);
    this.name = this.P.cleanName(name) || this.P.randomName();
    this.weapon = weapon || '';
    this.mode = this.P.cleanMode(mode) || 'arena';
    this.city = this.P.isCity(this.mode);
    this._bundling = this.bundle == null ? this.city : !!this.bundle;
    this._out.length = 0;
    this._closedByUser = false;
    this.error = null;
    this._retry = 0;
    this.resumeToken = null;
    this._hadWelcome = false;
    const p = new Promise((resolve, reject) => this._welcomeWaiters.push({ resolve, reject }));
    this._open();
    return p;
  }

  get endpoint() { return this.url + '/room/' + encodeURIComponent(this.room) + (this.mode && this.mode !== 'arena' ? '?mode=' + encodeURIComponent(this.mode) : ''); }
  get connected() { return this.status === 'open' && !!this.welcome; }

  _open() {
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    if (!this.WS) { this._fail('nows', 'この端末は WebSocket を使えません'); return; }
    if (!this.url) { this._fail('noserver', 'サーバーが設定されていません'); return; }
    this._setStatus(this._retry ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new this.WS(this.endpoint); } catch (e) { this._scheduleReconnect(); return; }
    this.ws = ws;
    // ハンドシェイクが返ってこない（ホスト違い・認証付き Wi-Fi など）／開いても welcome が来ないときは諦めて再接続
    clearTimeout(this._connTimer);
    this._connTimer = setTimeout(() => {
      this._connTimer = null;
      if (ws !== this.ws || this.welcome) return;
      this._drop(ws, '応答がありません。');
    }, this.connectTimeout);
    ws.onopen = () => {
      if (ws !== this.ws) return;
      const hello = { t: 'hello', v: this.P.VERSION, name: this.name, weapon: this.weapon };
      if (this.mode && this.mode !== 'arena') hello.mode = this.mode; // 街: URL と同じモード（違えば error mode）
      if (this.resumeToken) hello.rt = this.resumeToken; // 再接続: 同じ人として続ける
      this._sendRaw(hello);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      const data = typeof ev.data === 'string' ? ev.data : (ev.data && ev.data.toString ? ev.data.toString() : '');
      this._receive(data);
    };
    ws.onerror = () => { /* onclose が続けて来る */ };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      clearTimeout(this._connTimer);
      this._connTimer = null;
      this.ws = null;
      this.welcome = null;
      this._out.length = 0;
      if (this._closedByUser || this.error) return;
      const why = this._closeWhy;
      this._closeWhy = null;
      this._scheduleReconnect(why);
    };
  }

  // こちらから見切りをつけて閉じる（onclose を待たない。閉じる処理が戻ってこない端末もある）→ 再接続。now: すぐ入り直す
  _drop(ws, why, now) {
    clearTimeout(this._connTimer);
    this._connTimer = null;
    if (ws === this.ws) { this.ws = null; this.welcome = null; }
    try { ws.close(); } catch (e) { /* ignore */ }
    this.stats.timeouts = (this.stats.timeouts || 0) + 1;
    this._scheduleReconnect(why, now);
  }

  _scheduleReconnect(why, now) {
    if (this._closedByUser || this.error) return;
    clearTimeout(this._retryTimer);
    const delay = now ? 0 : Math.min(10, Math.pow(2, this._retry)) * 1000; // 1 s, 2 s, 4 s, 8 s, 10 s …
    this._retry++;
    this.stats.reconnects++;
    this._setStatus('reconnecting', (why || '') + (delay ? '再接続中…（' + Math.round(delay / 1000) + ' 秒後）' : '再接続中…'));
    this._retryTimer = setTimeout(() => this._open(), delay);
  }

  // 再接続しない失敗（満員・バージョン違いなど）
  _fail(code, msg) {
    this.error = { code, msg: msg || code };
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    clearTimeout(this._connTimer);
    this._connTimer = null;
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch (e) { /* ignore */ } }
    this._setStatus('error', Net.errorText(code, msg));
    const waiters = this._welcomeWaiters.splice(0);
    for (const w of waiters) w.reject(Object.assign(new Error(Net.errorText(code, msg)), { code }));
    this._emit({ t: 'error', code, msg });
  }

  _isHidden() { return typeof document !== 'undefined' && !!document && !!document.hidden; }

  close() {
    this._closedByUser = true;
    if (typeof document !== 'undefined' && document && typeof document.removeEventListener === 'function') {
      try { document.removeEventListener('visibilitychange', this._onVisibility); } catch (e) { /* 任意 */ }
    }
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    clearTimeout(this._connTimer);
    this._connTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.welcome = null;
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    this._setStatus('closed');
    const waiters = this._welcomeWaiters.splice(0);
    for (const w of waiters) w.reject(Object.assign(new Error('切断しました'), { code: 'closed' }));
  }

  onStatus(fn) { if (typeof fn === 'function') this._statusCbs.push(fn); }

  _setStatus(status, text) {
    this.status = status;
    this.statusText = text != null ? text : Net.statusText(status);
    for (const fn of this._statusCbs) { try { fn(status, this.statusText); } catch (e) { console.warn('[Net] onStatus', e); } }
  }

  static statusText(status) {
    return { idle: '', connecting: '接続中…', open: '接続しました', reconnecting: '再接続中…', closed: '切断しました', error: '接続できません' }[status] || status;
  }

  static errorText(code, msg) {
    const t = {
      full: '部屋が満員です（最大 ' + ((MR.NetProto && MR.NetProto.MAX_PLAYERS) || 8) + ' 人）',
      busy: '部屋が混み合っています',
      version: 'アプリのバージョンがサーバーと合いません。アプリを更新してください',
      rate: '通信が多すぎるため切断されました',
      bad: '不正な通信のため切断されました',
      mode: 'モードがサーバーの部屋と合いません。アプリを更新してください',
      noserver: 'サーバーが設定されていません',
      nows: 'この端末は WebSocket を使えません'
    }[code];
    return t || ('エラー: ' + (msg || code));
  }

  // ---------- 送信 ----------

  _sendRaw(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      const text = this.P.encode(msg);
      ws.send(text);
      this.stats.sent++; this.stats.wsOut++; this.stats.bytesOut += text.length;
      this.stats.msgsOut += msg.t === 'b' ? msg.m.length : 1;
      return true;
    } catch (e) { return false; }
  }

  // welcome 後だけ送る（hello / ping 以外）。束ねるとき（街）は貯まっている分と一緒にすぐ送る（順番はそのまま）
  send(msg) {
    if (!this.connected) return false;
    if (!this._bundling) return this._sendRaw(msg);
    this._out.push(msg);
    return this._flush();
  }

  // 次の state と一緒に送る（束ねないときはすぐ送る）
  queue(msg) {
    if (!this.connected) return false;
    if (!this._bundling) return this._sendRaw(msg);
    this._out.push(msg);
    return true;
  }

  // 次の update() で state を送る（STATE_HZ を待たない）
  requestState() { this._nextState = 0; }

  // 貯まっている分を送る: 1 通なら素のまま、2 通以上は { t: 'b', m }（BUNDLE_MAX 通・MAX_MESSAGE 文字を超えたら分ける）
  _flush() {
    const P = this.P, out = this._out;
    let ok = true;
    while (out.length) {
      const batch = [];
      let len = 16;
      while (out.length && batch.length < P.BUNDLE_MAX) {
        const n = P.encode(out[0]).length + 1;
        if (batch.length && len + n > P.MAX_MESSAGE - 32) break;
        batch.push(out.shift());
        len += n;
      }
      if (batch.length === 1) ok = this._sendRaw(batch[0]) && ok;
      else { ok = this._sendRaw({ t: 'b', m: batch }) && ok; this.stats.bundles++; }
    }
    return ok;
  }

  // 毎フレーム。state / vstate（STATE_HZ）と ping（2 s ごと）
  update() {
    if (!this.connected) return;
    const now = this.clock();
    // 画面が止まっていた（バックグラウンド・画面ロック）: 端末の時計（performance.now）が止まっていたかもしれないので
    // 時計のずれを測り直す。長く止まっていたらサーバーはもう切っている（閉じたことが届かない接続もある）のですぐ入り直す
    // （再開トークンで同じ人として戻る）。短ければ resumeCheck 以内に何か届くかを見る（届かなければ下で切る）
    // 止まっていた時間は壁時計でも測る（端末が眠っている間 performance.now が進まないことがある）
    const wall = Date.now();
    const gap = this._lastUpdate ? Math.max(now - this._lastUpdate, wall - this._lastUpdateWall) : 0;
    if (gap > 1000) {
      const hidden = this._wasHidden;
      this._wasHidden = false;
      this._lastUpdate = now; this._lastUpdateWall = wall;
      this._offsetSamples.length = 0;
      this._rttSamples.length = 0;
      this._late.length = 0;
      this._nextPing = now;
      // バックグラウンドから戻った（描画が重くて止まっただけなら入り直さない）
      if (hidden && gap > this.resumeDropAfter) { this._drop(this.ws, '', true); return; }
      // 止まっていた間に届いていた分はこの後すぐ処理される。それでも resumeCheck 以内に何も届かなければ下の確認で切る
      this._lastRecv = now - this.idleTimeout + this.resumeCheck;
    }
    if (!this._isHidden()) this._wasHidden = false;
    this._lastUpdate = now; this._lastUpdateWall = wall;
    // 開いているのに何も届かない（電波が切れたのに onclose が来ない）→ 閉じて再接続
    if (this._lastRecv && now - this._lastRecv > this.idleTimeout) { this._drop(this.ws, '応答がありません。'); return; }
    if (this._bundling) { this._updateBundled(now); return; }
    if (now >= this._nextState) {
      const iv = 1000 / this.P.STATE_HZ;
      this._nextState += iv;
      if (this._nextState <= now) this._nextState = now + iv; // 止まっていた（バックグラウンド）ら今から数え直す
      const s = this.stateProvider ? this.stateProvider() : null;
      if (s) {
        const seq = ++this._seq;
        if (this.send(Object.assign({ t: 'state', s: seq }, s)) && this.onStateSent) {
          try { this.onStateSent(seq, s); } catch (e) { console.warn('[Net] onStateSent', e); }
        }
      }
      const vs = this.vstateProvider ? this.vstateProvider() : null;
      if (vs) this.send(Object.assign({ t: 'vstate' }, vs));
    }
    if (now >= this._nextPing) {
      this._nextPing = now + 2000;
      this._sendRaw({ t: 'ping', c: Math.round(now * 1000) / 1000 });
    }
  }

  // 束ねる（街）: STATE_HZ ごとに [vstate, state, 貯めた分 …, ping] を 1 通に。vstate を先に（サーバーは state の席の位置を
  // 車の最新の位置で確かめる）。state が無い（死亡中・観戦中）ときは貯めた分と ping だけ
  _updateBundled(now) {
    if (now >= this._nextPing) { this._nextPing = now + 2000; this._pingDue = true; }
    if (now >= this._nextState) {
      const iv = 1000 / this.P.STATE_HZ;
      this._nextState += iv;
      if (this._nextState <= now) this._nextState = now + iv;
      const head = [];
      const vs = this.vstateProvider ? this.vstateProvider() : null;
      if (vs) head.push(Object.assign({ t: 'vstate' }, vs));
      const s = this.stateProvider ? this.stateProvider() : null;
      let seq = 0;
      if (s) { seq = ++this._seq; head.push(Object.assign({ t: 'state', s: seq }, s)); }
      if (head.length) this._out.unshift(...head);
      if (this._pingDue) { this._pingDue = false; this._out.push({ t: 'ping', c: Math.round(now * 1000) / 1000 }); }
      const ok = this._out.length ? this._flush() : true;
      if (s && ok && this.onStateSent) {
        try { this.onStateSent(seq, s); } catch (e) { console.warn('[Net] onStateSent', e); }
      }
    }
    // ping は次の STATE_HZ の区切りで（state が無くても区切りは来る）
  }

  // ---------- 受信 ----------

  setHandler(fn) {
    this._handler = fn;
    if (fn) {
      const q = this._queue.splice(0);
      for (const m of q) this._emit(m);
    }
  }

  _emit(m) {
    if (!this._handler) { if (m.t !== 'snap' && this._queue.length < 500) this._queue.push(m); return; } // snap はバッファに入っているので貯めない
    try { this._handler(m); } catch (e) { console.error('[Net] handler', m && m.t, e); }
  }

  // ゲームの最初の描画（シェーダーのコンパイルで数秒止まることがある）の後に呼ぶ: それまでに送った ping の返事は
  // 遅れて処理されるので RTT に数えない。次の ping はすぐ送る
  discardPings() {
    this._pingEpoch = this.clock();
    this._rttSamples.length = 0;
    this.rtt = 0;
    if (this.connected) this._nextPing = Math.min(this._nextPing, this._pingEpoch + 100);
  }

  _receive(data) {
    // サーバーからのメッセージ（welcome / snap は人数・乗り物の数で大きくなる）は MAX_SERVER_MESSAGE まで受ける
    const m = this.P.decode(data, this.P.S2C, this.P.MAX_SERVER_MESSAGE);
    if (!m) { this.stats.bad++; return; }
    this.stats.received++;
    this.stats.bytesIn += data.length;
    this._lastRecv = this.clock();
    const P = this.P;
    switch (m.t) {
      case 'welcome': {
        this.id = m.id;
        this.welcome = m;
        this._retry = 0;
        this._hadWelcome = true;
        if (typeof m.rt === 'string' && m.rt) this.resumeToken = m.rt;
        clearTimeout(this._connTimer);
        this._connTimer = null;
        this.selfServer = null;
        this._buffers.clear();
        this._vbuffers.clear();
        this.players.clear();
        for (const p of (Array.isArray(m.players) ? m.players : [])) if (p && P.isNum(p.id)) this.players.set(p.id, Object.assign({}, p));
        if (!this.players.has(m.id)) this.players.set(m.id, { id: m.id, name: this.name, hp: 100, kills: 0, deaths: 0, alive: 1, w: this.weapon });
        // 乗り物は番号 i ごと（arena は全部が順番に来るので配列と同じ。街は最初と違う物だけ）
        this.vehicles = [];
        for (const v of (Array.isArray(m.vehicles) ? m.vehicles : [])) {
          if (!v) continue;
          const i = P.isNum(v.i) ? v.i : this.vehicles.length;
          this.vehicles[i] = Object.assign({}, v);
        }
        this._out.length = 0;
        // 時計のずれと RTT は測り直す（再接続の前後で端末の時計が止まっていた・回線が変わったかもしれない）
        this._offsetSamples.length = 0;
        this._rttSamples.length = 0;
        this._late.length = 0;
        if (P.isNum(m.now)) this._addOffsetSample(m.now - this.clock(), 1e9);
        this._nextState = 0;
        this._nextPing = this.clock() + 300;
        this._setStatus('open');
        const waiters = this._welcomeWaiters.splice(0);
        for (const w of waiters) w.resolve(m);
        this._emit(m);
        return;
      }
      case 'pong': {
        const now = this.clock();
        if (!P.isNum(m.c) || !P.isNum(m.s)) return;
        if (m.c < this._pingEpoch) return; // 最初の描画より前に送った分（返事の処理が遅れている）
        const rtt = Math.max(0, now - m.c);
        // 表示用: 直近 5 個の中央値（偶数個なら小さい方）。1 回だけ遅れた返事（GC・描画の詰まり）で跳ねない
        this._rttSamples.push(rtt);
        if (this._rttSamples.length > 5) this._rttSamples.shift();
        const sorted = this._rttSamples.slice().sort((a, b) => a - b);
        this.rtt = sorted[(sorted.length - 1) >> 1];
        this._addOffsetSample(m.s + rtt / 2 - now, rtt);
        return;
      }
      case 'snap': {
        if (!P.isNum(m.now)) return;
        this._trackLate(this.serverNow() - m.now);
        if (Array.isArray(m.pl)) {
          for (const r of m.pl) {
            if (!Array.isArray(r) || r.length < 5) continue;
            if (r[0] === this.id) {
              const ss = this.selfServer || (this.selfServer = {});
              ss.t = m.now; ss.x = r[1]; ss.y = r[2]; ss.z = r[3]; ss.veh = r[9] == null ? -1 : r[9];
              ss.ack = P.isNum(r[11]) ? r[11] : null;
              if (r.length >= 14) { ss.m = r[12] | 0; ss.seat = P.isNum(r[13]) ? r[13] : -1; }
              continue;
            }
            this._push(this._buffers, r[0], m.now, r);
          }
        }
        if (Array.isArray(m.vh)) {
          for (const r of m.vh) {
            if (!Array.isArray(r) || r.length < 4) continue;
            if (r[6] === this.id) continue; // 自分が運転している車は自分の物理が正
            this._push(this._vbuffers, r[0], m.now, r);
            if (this.city) {
              // 街: 乗り物の最後に分かった位置（遠くなって行が来なくなっても、そこに置いておく）
              const v = this.vehicles[r[0]] || (this.vehicles[r[0]] = { i: r[0] });
              v.p = [r[1], r.length >= 11 ? r[7] : (v.p ? v.p[1] : 0), r[2]]; v.yaw = r[3]; v.driver = r[6];
              if (r.length >= 11) { v.pitch = r[8]; v.roll = r[9]; v.rpm = r[10]; }
              v.rowT = m.now;
            }
          }
        }
        this._emit(m);
        return;
      }
      case 'join':
        if (m.player && P.isNum(m.player.id)) this.players.set(m.player.id, Object.assign({}, m.player));
        break;
      case 'leave': {
        const lp = this.players.get(m.id);
        if (lp && lp.name) this._names.set(m.id, lp.name);
        this.players.delete(m.id);
        this._buffers.delete(m.id);
        break;
      }
      case 'kill': {
        const a = this.players.get(m.attacker), t = this.players.get(m.target);
        if (a && P.isNum(m.kills)) a.kills = m.kills;
        if (t) { if (P.isNum(m.deaths)) t.deaths = m.deaths; t.alive = 0; t.hp = 0; }
        this._buffers.delete(m.target);
        break;
      }
      case 'damage': {
        const t = this.players.get(m.target);
        if (t && P.isNum(m.hp)) t.hp = m.hp;
        break;
      }
      case 'spawn': {
        const t = this.players.get(m.id);
        if (t) { t.alive = 1; if (P.isNum(m.hp)) t.hp = m.hp; }
        this._buffers.delete(m.id);
        if (m.id === this.id) this.selfServer = null;
        break;
      }
      case 'vowner': {
        if (this.city && P.isNum(m.i) && !this.vehicles[m.i]) this.vehicles[m.i] = { i: m.i };
        const v = this.vehicles[m.i];
        if (v) v.driver = m.id;
        if (m.id === this.id) this._vbuffers.delete(m.i);
        break;
      }
      case 'vseat': { // 街: 席ごとの人
        if (!P.isNum(m.i) || !Array.isArray(m.occ)) break;
        const v = this.vehicles[m.i] || (this.vehicles[m.i] = { i: m.i });
        v.occ = m.occ.slice();
        v.driver = P.isNum(m.occ[0]) ? m.occ[0] : -1;
        if (v.driver === this.id) this._vbuffers.delete(m.i);
        break;
      }
      case 'vdamage': { const v = this.vehicles[m.i]; if (v && P.isNum(m.hp)) v.hp = m.hp; break; }
      case 'vexplode': {
        const v = this.vehicles[m.i];
        if (v) { v.wrecked = 1; v.hp = 0; v.driver = -1; if (v.occ) v.occ = v.occ.map(() => -1); if (P.isVec(m.p, 3)) v.p = m.p.slice(); }
        this._vbuffers.delete(m.i);
        break;
      }
      case 'vrespawn': {
        if (this.city && P.isNum(m.i) && !this.vehicles[m.i]) this.vehicles[m.i] = { i: m.i };
        const v = this.vehicles[m.i];
        if (v) {
          v.wrecked = 0; v.driver = -1; if (v.occ) v.occ = v.occ.map(() => -1);
          if (P.isNum(m.hp)) v.hp = m.hp; if (P.isVec(m.p, 2) || P.isVec(m.p, 3)) v.p = m.p.slice(); if (P.isNum(m.yaw)) v.yaw = m.yaw;
          v.pitch = 0; v.roll = 0; v.rpm = 0;
        }
        this._vbuffers.delete(m.i);
        break;
      }
      case 'error':
        // バージョン違いは再接続しても通らないので止める。bad / rate は切断されれば再接続する。
        // 満員・混雑: 最初の接続なら止める（開始画面に出す）。遊んでいる途中の再接続なら（電波の切り替えで自分の古い接続が
        // まだ席を取っているなど）、サーバーが閉じた後に待って入り直す
        if (m.code === 'version') { this._fail(m.code, m.msg); return; }
        if (m.code === 'full' || m.code === 'busy') {
          if (!this._hadWelcome) { this._fail(m.code, m.msg); return; }
          this._closeWhy = Net.errorText(m.code, m.msg) + '。';
        }
        break;
      default:
        break;
    }
    this._emit(m);
  }

  _push(map, key, t, row) {
    let buf = map.get(key);
    if (!buf) { buf = []; map.set(key, buf); }
    // 順番が入れ替わったものは捨てる
    if (buf.length && t <= buf[buf.length - 1].t) return;
    // 街: 1 秒以上行が来なかった（interest の外に出ていた・輸送ヘリに乗っていた）人・乗り物は前の位置から補間しない
    if (this.city && buf.length && t - buf[buf.length - 1].t > 1000) buf.length = 0;
    buf.push({ t, s: row });
    // 1.5 秒より古いものを捨てる（最低 2 つは残す）
    while (buf.length > 2 && t - buf[0].t > 1500) buf.shift();
  }

  // 往復時間が短いサンプルほど正確なので、直近 8 個のうち RTT 最小のものを使う。
  // 新しいサンプルが今の推定と RTT 以上（最低 250 ms）ずれていたら端末の時計が飛んだとみなし、古いサンプルを捨てる
  _addOffsetSample(offset, rtt) {
    const cur = this._offsetSamples.length ? this.offset : null;
    if (cur !== null && rtt < 1e8 && Math.abs(offset - cur) > Math.max(250, rtt)) this._offsetSamples.length = 0;
    this._offsetSamples.push({ offset, rtt });
    if (this._offsetSamples.length > 8) this._offsetSamples.shift();
    let best = this._offsetSamples[0];
    for (const s of this._offsetSamples) if (s.rtt < best.rtt) best = s;
    this.offset = best.offset;
  }

  // snap の遅れ（serverNow() − snap.now）から補間の遅れ interpDelay を決める: 直近 45 個（3 秒）の 90 % 点 + snap 間隔 + 10 ms。
  // 時計の推定のずれも同じ時計で測るので打ち消し合う。広げるのは速く（1 通 20 ms まで）、縮めるのはゆっくり（1 通 2 ms）
  _trackLate(late) {
    if (!isFinite(late)) return;
    const L = this._late;
    L.push(late);
    if (L.length > 45) L.shift();
    if (L.length < 6) return;
    const sorted = L.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)];
    const P = this.P;
    const target = Math.max(P.INTERP_DELAY * 1000, Math.min(P.MAX_INTERP_DELAY * 1000, p90 + 1000 / P.SNAP_HZ + 10));
    const d = target - this.interpDelay;
    this.interpDelay += d > 0 ? Math.min(d, 20) : Math.max(d, -2);
  }

  get hasRtt() { return this._rttSamples.length > 0; }

  serverNow() { return this.clock() + this.offset; }
  renderTime() { return this.serverNow() - this.interpDelay; }

  // ---------- 補間 ----------

  // プレイヤー id の補間した状態 { x, y, z, yaw, pitch, mv, ads, w, veh, gr, t, stale } か null（スナップショットが無い）
  sample(id, out) {
    const r = this._interp(this._buffers.get(id), [1, 2, 3], [4, 5], [2]); // 高さ（ジャンプ）は延ばさない（地面に沈まないように）
    if (!r) return null;
    const o = out || {};
    o.x = r.v[1]; o.y = r.v[2]; o.z = r.v[3]; o.yaw = r.v[4]; o.pitch = r.v[5];
    o.mv = r.row[6] | 0; o.ads = r.row[7] | 0; o.w = r.row[8]; o.veh = r.row[9] == null ? -1 : r.row[9]; o.gr = r.row[10] == null ? 1 : r.row[10];
    o.m = r.row.length >= 14 ? (r.row[12] | 0) : 0; o.seat = r.row.length >= 14 && this.P.isNum(r.row[13]) ? r.row[13] : -1; // 街: 動き・席
    o.t = r.t; o.stale = r.stale;
    return o;
  }

  // 乗り物 i の補間した状態 { x, z, yaw, sp, st, driver, stale } か null。街の行（11 列）なら y / pitch / roll / rpm も（has3d）
  sampleVehicle(i, out) {
    const buf = this._vbuffers.get(i);
    const city = !!(buf && buf.length && buf[buf.length - 1].s.length >= 11);
    const r = city ? this._interp(buf, [1, 2, 4, 5, 7, 10], [3, 8, 9]) : this._interp(buf, [1, 2, 4, 5], [3]);
    if (!r) return null;
    const o = out || {};
    o.x = r.v[1]; o.z = r.v[2]; o.yaw = r.v[3]; o.sp = r.v[4] || 0; o.st = r.v[5] || 0;
    o.driver = r.row[6] == null ? -1 : r.row[6];
    o.has3d = city;
    if (city) { o.y = r.v[7]; o.pitch = r.v[8] || 0; o.roll = r.v[9] || 0; o.rpm = r.v[10] || 0; }
    o.t = r.t; o.stale = r.stale;
    return o;
  }

  // 乗り物 i の最新の行をサーバー時刻 t（ms）まで延ばした状態（直前の 2 行の動き。延ばすのは maxAhead ms まで）。
  // 同乗している乗り物（運転は他の人）の席の位置: サーバーは最新の vstate の車で席を確かめるので、補間（遅れて見える）ではなくこちらを使う
  predictVehicle(i, t, out, maxAhead) {
    const buf = this._vbuffers.get(i);
    if (!buf || !buf.length) return null;
    const last = buf[buf.length - 1], prev = buf.length >= 2 ? buf[buf.length - 2] : null;
    const L = last.s, city = L.length >= 11;
    const o = out || {};
    const ahead = Math.max(0, Math.min(maxAhead == null ? 400 : maxAhead, t - last.t));
    const span = prev ? last.t - prev.t : 0;
    const k = prev && span > 0 && span <= 600 ? ahead / span : 0;
    const lin = (c) => L[c] + (prev && k ? (L[c] - prev.s[c]) * k : 0);
    o.x = lin(1); o.z = lin(2);
    o.yaw = prev && k ? Net.lerpAngle(prev.s[3], L[3], 1 + k) : L[3];
    o.sp = L[4] || 0; o.st = L[5] || 0; o.driver = L[6] == null ? -1 : L[6];
    o.has3d = city;
    if (city) {
      o.y = lin(7);
      o.pitch = L[8] || 0; o.roll = L[9] || 0; o.rpm = L[10] || 0;
      // 速さ（m/s）: 直前の 2 行から
      if (prev && span > 0) { const s = 1000 / span; o.vx = (L[1] - prev.s[1]) * s; o.vy = (L[7] - prev.s[7]) * s; o.vz = (L[2] - prev.s[2]) * s; } else { o.vx = 0; o.vy = 0; o.vz = 0; }
    }
    o.t = last.t; o.stale = t - last.t > 1000;
    return o;
  }

  // lin: 線形補間する列、ang: 角度として補間する列（hold: lin のうち外挿しない列）。それ以外は新しい方の値。
  // 最後のスナップショットより先（次が遅れている）は、続いて届いた直前の 2 つの動きを MAX_EXTRAPOLATE 秒まで延ばす
  _interp(buf, lin, ang, hold) {
    if (!buf || !buf.length) return null;
    const rt = this.renderTime();
    const last = buf[buf.length - 1];
    if (buf.length === 1 || rt >= last.t) {
      const prev = buf.length >= 2 ? buf[buf.length - 2] : null;
      const span = prev ? last.t - prev.t : 0;
      if (prev && rt > last.t && span > 0 && span <= 2.5 * 1000 / this.P.SNAP_HZ) {
        const k = 1 + Math.min(rt - last.t, this.P.MAX_EXTRAPOLATE * 1000) / span;
        const v = last.s.slice();
        for (const c of lin) if (!hold || hold.indexOf(c) < 0) v[c] = prev.s[c] + (last.s[c] - prev.s[c]) * k;
        for (const c of ang) v[c] = Net.lerpAngle(prev.s[c], last.s[c], k);
        return { v, row: last.s, t: last.t, stale: rt - last.t > 1000 };
      }
      return { v: last.s.slice(), row: last.s, t: last.t, stale: rt - last.t > 1000 };
    }
    if (rt <= buf[0].t) return { v: buf[0].s.slice(), row: buf[0].s, t: buf[0].t, stale: false };
    let i = buf.length - 2;
    while (i > 0 && buf[i].t > rt) i--;
    const a = buf[i], b = buf[i + 1];
    const k = (rt - a.t) / Math.max(1e-6, b.t - a.t);
    const v = b.s.slice();
    for (const c of lin) v[c] = a.s[c] + (b.s[c] - a.s[c]) * k;
    for (const c of ang) v[c] = Net.lerpAngle(a.s[c], b.s[c], k);
    return { v, row: b.s, t: rt, stale: false };
  }

  // 短い方向に回る角度の補間
  static lerpAngle(a, b, k) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  // ---------- 便利 ----------

  playerName(id) {
    const p = this.players.get(id);
    if (p) return p.name;
    if (id === -1 || id == null) return '';
    return this._names.get(id) || ('#' + id);
  }

  // スコアボード用: kills 降順 → deaths 昇順 → 名前
  scoreboard() {
    const list = Array.from(this.players.values());
    list.sort((a, b) => (b.kills || 0) - (a.kills || 0) || (a.deaths || 0) - (b.deaths || 0) || String(a.name).localeCompare(String(b.name)));
    return list;
  }
};
