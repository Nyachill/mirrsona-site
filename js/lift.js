// Mirrsona Sky High の高速エレベーター（ソロの街と街のオンライン。dev-notes/plans/skyhigh.md §6）。
//   駅は citygen の city.lifts（midtown.json のランドマークの params.lift: L0 ロビー / L1 128 m デッキ / L2 256 m スカイフロア）。
//   動く床は作らない: 扉の前（radius m 以内・高さの差 maxDy m 以内・扉の面より前 = 駅の点から扉の向きに frontMin m より前・扉の幅 = 左右 halfW m 以内）で「エレベーター」（乗る ボタン / E・F）→ 行き先の板（#lift-panel。
//   タップ・1〜9 キー・Esc / もう一度 F で閉じる）→ 暗転（fadeOut 秒）→ 真っ暗の間に game.placePlayer（world.loadNavNow で当たり判定を
//   その場で全部読む = 落ちない）→ 明ける（fadeIn 秒）。全体で time 秒、その間は動けない・撃てない。
//   最初の commit 秒の間にダメージを受けると中止（その場で明ける）。それより後は着くまで続ける。
//   使えないとき: 死んでいる・乗っている・回復中（「回復中は使えません」）・梯子 / 泳ぎ / 空中・自由カメラ・輸送ヘリ / 降下中。
//   音: lift_ding（扉）と lift_ride（うなり）。ファイルが無いので下の合成音（audio.js の SYNTH に足す）。
//   オンライン（S5）: welcome の caps に 'lift' があるサーバーだけ（net.hasCap。無ければ扉の案内を出さない。'liftDoor' が無い b14 のサーバーでは
//   扉の前の円を legacyRadius m まで = atDoor）。commit 秒で中止できなく
//   なったら lift { l, s } を送り、サーバーの lifted（p・yaw）で置く（真っ暗のまま待つ。netWait 秒来ない・no なら中止）。送ってから
//   置くまでは state を送らない（netHold。game._netStateCity）。サーバーの判定は server/cityroom.js の _onLift。
//   数値は game.json の lift（無いキーは DEFAULTS）。行き先の名前は lift.labels（駅の名前 → 日本語）。
//   見た目（b15。オーナーの「スカイハイにエレベーターがない」）: 扉・枠・案内板・ロビーの天井と照明・入口のひさしと看板・床の案内の矢印は
//   lift_view.js（MR.LiftView。lift.view の数値）。扉の近く（lift.guide.dist m）・扉のあるロビーの中では画面に「エレベーター」と向きの矢印（#lift-guide）
window.MR = window.MR || {};

(function () {
  const DEFAULTS = {
    radius: 3, frontMin: -0.7, halfW: 1.4, legacyRadius: 1.6, maxDy: 1.5, time: 2.5, commit: 0.8, fadeOut: 0.45, fadeIn: 0.5, cooldown: 0.6, shake: 0.12, placeAbove: 0.6, arriveOffset: 0.03, netWait: 3,
    labels: { L0: 'ロビー', L1: 'デッキ 128 m', L2: 'スカイフロア 256 m' }
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  class Lift {
    constructor(game, raw) {
      this.game = game;
      this.cfg = Object.assign({}, DEFAULTS, raw || {});
      this.cfg.labels = Object.assign({}, DEFAULTS.labels, (raw && raw.labels) || {});
      this.lifts = (game.city && game.city.lifts) || [];
      this.net = game.online ? game.net : null; // オンライン: サーバーの lifted で置く
      this.open = null;      // { lift, from }: 行き先の板を開いている駅
      this.ride = null;      // { lift, from, to, t, placed }
      this.fade = 0;         // 暗転の濃さ（0〜1）
      this.coolUntil = 0;
      this.stats = { rides: 0, cancels: 0, placeErr: 0, lastY: null, blocked: '', sent: 0, refused: 0, timeouts: 0 };
      const d = typeof document !== 'undefined' && document.getElementById ? document : null;
      this.el = d ? { panel: d.getElementById('lift-panel'), opts: d.getElementById('lf-opts'), fade: d.getElementById('lift-fade'), hud: d.getElementById('hud') } : {};
      Lift._active = this;
      Lift.bindStatic();
      // 見た目（扉・案内板・ロビーの天井 …）と画面の案内。THREE の無い所（サーバー・テスト）は作らない
      this.view = MR.LiftView && typeof THREE !== 'undefined' && game.scene && this.lifts.length && !(raw && raw.view && raw.view.enabled === false) ? new MR.LiftView(game, this, (raw && raw.view) || {}, (raw && raw.guide) || {}) : null;
    }

    get riding() { return !!this.ride; }
    // オンライン: lift を送ってから置かれるまで（state を送らない）
    get netHold() { const r = this.ride; return !!(r && r.sent && !r.placed); }
    // 使えるか（オンラインはサーバーが lift を知っているときだけ）
    available() { return !this.net || (typeof this.net.hasCap === 'function' && this.net.hasCap('lift')); }

    _label(st) { return this.cfg.labels[st.name] || st.name; }

    // 扉の前にいる駅（{ lift, from }）。乗っていない・歩いて接地しているときだけ
    stationAt() {
      const g = this.game, p = g.player;
      if (!p || p.dead || g.vehicle || g.freeCam || p.state !== 'walk' || !this.available()) return null;
      if (g.royale && g.royale.riding) return null;
      if (g.cityOnline && (g.cityOnline.riding || g._waitingSpawn || g._pendingEnter >= 0)) return null;
      for (const L of this.lifts) {
        for (let i = 0; i < L.stations.length; i++) if (this.atDoor(L.stations[i], p.pos)) return { lift: L, from: i };
      }
      return null;
    }

    // 点 q が駅 s の扉の前か: 高さの差 maxDy m 以内・radius m 以内・扉の面より前（駅の点から扉の向き n に frontMin m より前）・
    //   扉の幅の中（左右 halfW m 以内。壁の裏・柱の向こう・角の壁の外の歩道では出さない）。形は MR.NetProto.liftDoor（サーバーの
    //   cityroom.js の _onLift も同じ形に liftReach / liftSide の余裕を足して確かめる）
    //   オンラインでサーバーの welcome の caps に 'liftDoor' が無い（b15 より前のサーバー: 扉の形を知らず、円 = そのサーバーの lift.radius 1.6 +
    //   liftReach 1 m だけを見る）ときは、radius を legacyRadius（1.6 = ビルド 14 のクライアント）までにする。アプリ（radius 3）がサーバーの
    //   デプロイより先に届いても、2.6〜3 m で押した「エレベーター」が netWait 秒待って「使えませんでした」にならない
    atDoor(s, q) {
      return MR.NetProto.liftDoor(s, q.x, q.y, q.z, this._door());
    }
    _door() {
      const c = this.cfg, n = this.net;
      if (!n || typeof n.hasCap !== 'function' || n.hasCap('liftDoor') || !(c.legacyRadius < c.radius)) return c;
      return this._legacy || (this._legacy = Object.assign({}, c, { radius: c.legacyRadius }));
    }

    // 乗る ボタンの文字（game._updateVehicleInteract が近くに乗り物が無いときに見る）
    prompt() {
      if (this.ride) return null;
      return this.stationAt() ? 'エレベーター' : null;
    }

    // ボタン / E・F: 板を開く・閉じる
    press() {
      if (this.ride) return;
      if (this.open) { this.closePanel(); return; }
      const at = this.stationAt();
      if (!at) return;
      const why = this._blocked();
      if (why) { this.stats.blocked = why; this.game.hud.showMessage(why, 1200); return; }
      this.open = at;
      this._renderPanel();
      if (this.el.panel) this.el.panel.classList.remove('hidden');
      if (this.el.hud) this.el.hud.classList.add('lift-open'); // 板の間は右の操作のボタン・照準・拾う を隠す（板と重ねない。閉じるは板の「閉じる」）
    }

    closePanel() {
      this.open = null;
      if (this.el.panel) this.el.panel.classList.add('hidden');
      if (this.el.hud) this.el.hud.classList.remove('lift-open');
    }

    _blocked() {
      const g = this.game;
      if (g.play && g.play.heal) return '回復中は使えません';
      if (g.time < this.coolUntil) return 'エレベーターを準備中…';
      return '';
    }

    // 板の行き先（今の駅を除く）。i は lift.stations の番号
    choices() {
      if (!this.open) return [];
      const L = this.open.lift, out = [];
      for (let i = 0; i < L.stations.length; i++) if (i !== this.open.from) out.push({ i, label: this._label(L.stations[i]) });
      return out;
    }

    _renderPanel() {
      const o = this.el.opts;
      if (!o) return;
      const here = this._label(this.open.lift.stations[this.open.from]);
      let h = '<div class="lf-here">現在地: ' + esc(here) + '</div>';
      this.choices().forEach((c, k) => { h += '<button class="lf-opt" type="button" data-i="' + c.i + '"><b class="lf-key">' + (k + 1) + '</b>' + esc(c.label) + '</button>'; });
      o.innerHTML = h;
    }

    // 行き先を選んだ（station の番号）。乗れなければ false
    choose(to) {
      const op = this.open;
      if (!op || this.ride) return false;
      const L = op.lift;
      if (!(to >= 0 && to < L.stations.length) || to === op.from) return false;
      const at = this.stationAt();
      const why = this._blocked();
      if (!at || at.lift !== L || why) { if (why) this.game.hud.showMessage(why, 1200); this.closePanel(); return false; }
      this.closePanel();
      const g = this.game, p = g.player;
      this.ride = { lift: L, from: at.from, to, t: 0, placed: false, rumble: false, net: !!this.net, sent: false, srv: null, wait: 0 };
      p.vel.x = 0; p.vel.z = 0; p.vy = 0;
      if (g.input && g.input.fireHeld) g.input.fireHeld = false;
      this._sound('lift_ding');
      return true;
    }

    // ダメージ（game._playerHit。オンラインは damage で closePanel だけ）: 板を開いていれば閉じる（板の間は撃つボタンを隠しているので、
    //   撃たれたら撃ち返せるように戻す）・乗っていれば commit 秒までなら中止
    onHit() {
      if (this.open) this.closePanel();
      const r = this.ride;
      if (!r || r.placed || r.t >= this.cfg.commit) return;
      this.ride = null;
      this.stats.cancels++;
      this.coolUntil = this.game.time + this.cfg.cooldown;
      this.game.hud.showMessage('エレベーターを中止しました', 1200);
    }

    // 中止（その場で明ける）
    _cancel(msg) {
      this.ride = null;
      this.stats.cancels++;
      this.coolUntil = this.game.time + this.cfg.cooldown;
      if (msg) this.game.hud.showMessage(msg, 1400);
    }

    // サーバーの lifted（自分あて。game._onNet）
    onLifted(m) {
      const r = this.ride, g = this.game;
      if (m.no) { this.stats.refused++; if (r && r.sent && !r.placed) this._cancel('エレベーターを使えませんでした'); return; }
      if (!Array.isArray(m.p) || m.p.length !== 3 || !g.player || g.player.dead) return;
      if (r && r.sent && !r.placed) { r.srv = m; if (r.t >= this.cfg.fadeOut) this._place(r); return; }
      // 乗っていないのに来た（行き違い）: サーバーの位置に合わせる。ほかのことを始めていたら（乗る・回復）置かない（_netCheckSelf が合わせる）
      if (g.vehicle || g._pendingEnter >= 0 || (g.play && g.play.heal)) return;
      this._place({ lift: (this.lifts.find((L) => L.id === m.l) || this.lifts[0]), to: m.s, srv: m, t: 0 });
    }

    onDeath() {
      this.closePanel();
      if (this.view) this.view.hideGuide();
      if (this.ride) { this.ride = null; this.stats.cancels++; }
      this._setFade(0); // update は生きている間だけなので、ここで戻す（暗いままだと復活の画面が見えない）
    }

    // 毎フレーム（生きている間。game._update）: 乗っている間の進み・暗転・板を開いたまま離れたら閉じる・板の 1〜9 キー
    update(dt) {
      const c = this.cfg, g = this.game;
      if (this.open) {
        const inp = g.input, sel = inp && typeof inp.consumeSelect === 'function' ? inp.consumeSelect() : -1; // 板の間は 1〜9 = 行き先（武器を持ち替えない）
        const ch = this.choices();
        if (sel >= 0 && sel < ch.length) this.choose(ch[sel].i);
        else { const at = this.stationAt(); if (!at || at.lift !== this.open.lift || at.from !== this.open.from) this.closePanel(); }
      }
      const r = this.ride;
      let target = 0;
      const placeAt = Math.max(c.fadeOut, c.time - c.fadeIn);
      if (r) {
        r.t += dt;
        if (r.net && !r.sent && r.t >= c.commit) { // もう中止できない: サーバーに頼む
          if (this.net && this.net.connected) { this.net.send({ t: 'lift', l: r.lift.id, s: r.to }); r.sent = true; this.stats.sent++; }
          else this._cancel('エレベーターを使えませんでした');
        }
        if (r.net && this.ride === r && !r.placed) {
          if (r.srv && r.t >= c.fadeOut) this._place(r);
          else if (r.t >= placeAt) { // 返事を真っ暗のまま待つ
            r.t = placeAt; r.wait += dt;
            if (r.wait > c.netWait) { this.stats.timeouts++; this._cancel('エレベーターを使えませんでした'); }
          }
        }
      }
      if (r && this.ride === r) {
        if (r.t >= c.fadeOut && !r.rumble) { r.rumble = true; this._sound('lift_ride'); }
        if (r.t >= c.fadeOut && !r.placed) g.shake = Math.max(g.shake, c.shake);
        if (!r.net && !r.placed && r.t >= placeAt) this._place(r);
        target = r.t < c.fadeOut ? r.t / c.fadeOut : (!r.placed ? 1 : Math.min(1, Math.max(0, 1 - (r.t - placeAt) / c.fadeIn)));
        if (r.t >= c.time && r.placed) { this.ride = null; target = 0; this.coolUntil = g.time + c.cooldown; }
      } else if (this.fade > 0) target = Math.max(0, this.fade - dt / c.fadeIn); // 中止・死んだ: その場で明ける
      this._setFade(target);
      if (this.view) this.view.update(dt);
    }

    _place(r) {
      const g = this.game, p = g.player, m = r.srv;
      const s = (r.lift && r.lift.stations[r.to]) || null;
      if (m) g.placePlayer(m.p[0], m.p[2], m.p[1] + this.cfg.placeAbove, (Number(m.yaw) || 0) * 180 / Math.PI); // オンライン: サーバーが置いた所
      else {
        // 駅の点から扉の向きへ arriveOffset m（b16: 駅の点 x −21 ちょうどにカメラがあると skyhigh.glb の台の箱の端の点がカメラの面に乗り、
        //   SwiftShader がロビーの床に黒いくさびを描いた。実機の GPU では面積 0 の三角形 = 描かない。テストの画とちょうどの面の境目を避ける）
        const ao = this.cfg.arriveOffset || 0, ay = s.yaw * Math.PI / 180;
        g.placePlayer(s.x + Math.sin(ay) * ao, s.z + Math.cos(ay) * ao, s.y + this.cfg.placeAbove, s.yaw + 180);
      }
      p.vel.x = 0; p.vel.z = 0; p.vy = 0;
      if (m && g._lastNetPos) { g._lastNetPos.copy(p.pos); g._netSpeed = 0; if (typeof g._netResetMove === 'function') g._netResetMove(); }
      r.placed = true;
      this.stats.rides++;
      this.stats.lastY = p.pos.y;
      const ty = m ? m.p[1] : (s ? s.y : p.pos.y);
      if (Math.abs(p.pos.y - ty) > 0.5) this.stats.placeErr++;
      this._sound('lift_ding');
      if (s) g.hud.showMessage(this._label(s), 1400);
      if (g.story && s) g.story.onLift(s.name); // ストーリーの条件 lifted
    }

    _setFade(v) {
      if (Math.abs(v - this.fade) < 1e-4 && (v === 0 || v === 1)) return;
      this.fade = v;
      const f = this.el.fade;
      if (f && f.style) { f.style.opacity = v.toFixed(3); f.style.display = v > 0 ? 'block' : 'none'; }
    }

    _sound(name) {
      const a = this.game.audio;
      if (a && typeof a.play === 'function') a.play(name, { priority: 2 });
    }

    dispose() {
      this.closePanel();
      this.ride = null;
      this._setFade(0);
      if (this.view) { this.view.dispose(); this.view = null; }
      if (Lift._active === this) Lift._active = null;
    }

    // 板のボタンと Esc は 1 回だけつなぎ、今のゲームの Lift（Lift._active）に効かせる（「もう一度」で作り直しても重ならない）。
    //   タッチは pointerdown → 同じ指の pointerup（ほかの指がスティックに触れていても効く。設定の板と同じ）、マウスは click
    static bindStatic() {
      if (Lift._bound || typeof document === 'undefined' || !document.getElementById) return;
      Lift._bound = true;
      const cur = () => (Lift._active && Lift._active.open ? Lift._active : null);
      const idOf = (t) => { const b = t && typeof t.closest === 'function' ? t.closest('.lf-opt') : null; return b && typeof b.getAttribute === 'function' ? Number(b.getAttribute('data-i')) : -1; };
      const opts = document.getElementById('lf-opts');
      if (opts && opts.addEventListener) {
        let pid = null, down = -1, lastT = 0;
        opts.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse') return; pid = ev.pointerId; down = idOf(ev.target); });
        opts.addEventListener('pointercancel', (ev) => { if (ev.pointerId === pid) pid = null; });
        opts.addEventListener('pointerup', (ev) => {
          if (ev.pointerType === 'mouse' || ev.pointerId !== pid) return;
          pid = null;
          const i = idOf(ev.target);
          if (i < 0 || i !== down) return;
          if (ev.preventDefault) ev.preventDefault();
          lastT = Date.now();
          const u = cur(); if (u) u.choose(i);
        });
        opts.addEventListener('click', (ev) => { if (Date.now() - lastT < 700) return; const i = idOf(ev.target); const u = cur(); if (u && i >= 0) u.choose(i); });
      }
      const close = document.getElementById('lf-close');
      if (close && close.addEventListener) {
        let lastT = 0;
        close.addEventListener('pointerup', (ev) => { if (ev.pointerType === 'mouse') return; lastT = Date.now(); const u = cur(); if (u) u.closePanel(); });
        close.addEventListener('click', () => { if (Date.now() - lastT < 700) return; const u = cur(); if (u) u.closePanel(); });
      }
      if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', (ev) => { if (ev.code === 'Escape') { const u = cur(); if (u) u.closePanel(); } });
    }
  }
  Lift.DEFAULTS = DEFAULTS;
  Lift._active = null;
  Lift._bound = false;
  MR.Lift = Lift;

  // 合成音（ファイルの音は無い。規約 7 のフォールバックだけで鳴る）: 扉のチャイムと、暗転の間の低いうなり
  if (MR.Audio && MR.Audio.SYNTH) {
    Object.assign(MR.Audio.SYNTH, {
      lift_ding(dest, vol) {
        const t = this.ctx.currentTime;
        for (const [f, dt] of [[880, 0], [1318.5, 0.16]]) {
          const o = this._osc('sine', f), g = this._gainNode();
          g.gain.setValueAtTime(0.0001, t + dt);
          g.gain.linearRampToValueAtTime(0.16 * vol, t + dt + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.7);
          o.connect(g); g.connect(dest);
          this._run(o, t + dt, t + dt + 0.72);
        }
      },
      lift_ride(dest, vol) {
        const t = this.ctx.currentTime, dur = 1.6;
        const noise = this._n(this.ctx.createBufferSource());
        noise.buffer = this.noiseBuffer;
        const f = this._filter('lowpass', 170, 0.8), g = this._gainNode();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.35 * vol, t + 0.25);
        g.gain.setValueAtTime(0.35 * vol, t + dur - 0.4);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        noise.connect(f); f.connect(g); g.connect(dest);
        this._run(noise, t, t + dur + 0.02);
        const o = this._osc('sine', 52), og = this._gainNode();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.linearRampToValueAtTime(0.2 * vol, t + 0.3);
        og.gain.setValueAtTime(0.2 * vol, t + dur - 0.4);
        og.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(og); og.connect(dest);
        this._run(o, t, t + dur + 0.02);
      }
    });
  }
})();
