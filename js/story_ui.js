// ストーリーの画面（MR.StoryUI。DOM だけ。storymode.js が作る）: 無線の帯 #story-radio・会話の箱 #story-talk・章の札 #story-card・目標 #story-obj・
//   目印 #story-marks（最大 story.markers.max。画面に映した菱形と距離の DOM = GPU 0）・暗転 #story-fade・上下の帯 #story-letterbox・資料 #story-intel・
//   任務失敗 #story-fail・結果 #story-result・支援射撃 #btn-strike。
//   ボタンは設定の板と同じ: タッチは pointerdown → 同じ指の pointerup（スティックに親指が触れていても効く）、マウスは click。
//   状態は JS に持つ（自動テストは DOM ではなく radio.cur / talkCur / objText … を見る）。文字は esc してから入れる。
window.MR = window.MR || {};

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const DEF = { radio: { minSec: 1.2, perChar: 0.11, maxQueue: 8, gap: 0.25 }, talk: { autoSec: 2.4, perChar: 0.06, skipHold: 0.6, history: 60 }, markers: { max: 3, edge: 28 }, card: { sec: 3.2 } };

  class StoryUI {
    // cast: { id: { name, color, initial } }
    constructor(game, cast, cfg) {
      this.game = game;
      this.cast = cast || {};
      const c = cfg || {};
      this.cfg = { radio: Object.assign({}, DEF.radio, c.radio || {}), talk: Object.assign({}, DEF.talk, c.talk || {}), markers: Object.assign({}, DEF.markers, c.markers || {}), card: Object.assign({}, DEF.card, c.card || {}) };
      const d = typeof document !== 'undefined' && document.getElementById ? document : null;
      const $ = (id) => (d ? d.getElementById(id) : null);
      this.el = {
        hud: $('hud'), radio: $('story-radio'), talk: $('story-talk'), card: $('story-card'), obj: $('story-obj'), marks: $('story-marks'),
        fade: $('story-fade'), lb: $('story-letterbox'), intel: $('story-intel'), fail: $('story-fail'), result: $('story-result'), strike: $('btn-strike'),
        hold: $('story-hold'), toast: $('story-toast'), choice: $('story-choice')
      };
      // 無線
      this.radioQ = []; this.radioCur = null; this.radioT = 0; this.radioGap = 0; this.radioDone = []; // 出し終えたせりふの組の id（host が見る）
      // 会話
      this.talkQ = null; this.talkI = 0; this.talkT = 0; this.talkAuto = false; this.talkCb = null; this.talkCur = null; this.history = [];
      // 札
      this.cardT = 0; this.cardOn = false;
      // 目標
      this.objText = ''; this.objCount = ''; this.objTimer = null; this.objDist = null;
      // 目印
      this.markList = []; this._markEls = [];
      // 暗転・帯
      this.fadeV = 0; this.fadeTo = 0; this.fadeRate = 0; this.lbOn = false;
      this.intelCur = null; this.intelCb = null;
      this.failOn = false; this.failCb = null; this.resultOn = false; this.resultCb = null;
      this.strikeState = null; this.onStrike = null;
      this.holdV = -1;
      this.choiceCb = null;
      this.stats = { radio: 0, talk: 0, taps: 0 };
      this._bind();
    }

    who(id) { return this.cast[id] || { name: id, color: '#9ab', initial: (id || '?').slice(0, 1) }; }
    _badge(id) { const w = this.who(id); return '<b class="sx-badge" style="background:' + esc(w.color) + '">' + esc(w.initial || w.name.slice(0, 1)) + '</b>'; }

    // ---------- 無線（止めない）----------
    // lines: [[who, text, { inner, critical }]...]、id: せりふの組の id（全部出し終えたら radioDone に入る）
    radio(lines, id) {
      const R = this.cfg.radio;
      let k = 0;
      for (const ln of lines || []) {
        const e = { who: ln[0], text: ln[1], opt: ln[2] || {}, id: ++k === lines.length ? id : null };
        if (e.opt.critical) this.radioQ.unshift(e); else this.radioQ.push(e);
      }
      while (this.radioQ.length > R.maxQueue) this.radioQ.splice(this.radioQ.findIndex((q) => !q.opt.critical && !q.id) >= 0 ? this.radioQ.findIndex((q) => !q.opt.critical && !q.id) : 0, 1);
      if (!lines || !lines.length) { if (id) this.radioDone.push(id); }
    }
    _radioShow(e) {
      this.radioCur = e;
      this.radioT = this.cfg.radio.minSec + e.text.length * this.cfg.radio.perChar;
      this.stats.radio++;
      this._hist(e);
      const el = this.el.radio;
      if (el) {
        const w = this.who(e.who);
        el.innerHTML = this._badge(e.who) + '<span class="sx-name">' + esc(e.opt.inner ? '' : w.name) + '</span><span class="sx-text' + (e.opt.inner ? ' inner' : '') + '">' + esc(e.text).replace(/\n/g, '<br>') + '</span>';
        el.classList.remove('hidden');
      }
      this._sfx('radio_squelch');
    }
    _radioEnd() {
      const e = this.radioCur;
      if (e && e.id) this.radioDone.push(e.id);
      this.radioCur = null;
      this.radioGap = this.cfg.radio.gap;
      if (this.el.radio) this.el.radio.classList.add('hidden');
    }
    tapRadio() { if (this.radioCur) { this.stats.taps++; this._radioEnd(); } }
    clearRadio() { for (const q of this.radioQ) if (q.id) this.radioDone.push(q.id); this.radioQ = []; if (this.radioCur) this._radioEnd(); }

    // ---------- 会話の箱（止める。場面の中では場面のまま）----------
    talk(lines, cb, id) {
      if (this.talkQ) this._talkFinish();
      this.talkQ = (lines || []).slice(); this.talkI = 0; this.talkCb = cb || null; this.talkId = id || null;
      this.stats.talk++;
      if (!this.talkQ.length) { this._talkFinish(); return; }
      this._talkShow();
    }
    get talking() { return !!this.talkQ; }
    _talkShow() {
      const ln = this.talkQ[this.talkI];
      this.talkCur = { who: ln[0], text: ln[1] };
      this._hist(this.talkCur);
      this.talkT = this.cfg.talk.autoSec + ln[1].length * this.cfg.talk.perChar;
      const el = this.el.talk;
      if (el) {
        const w = this.who(ln[0]), inner = ln[2] && ln[2].inner;
        const body = el.querySelector ? el.querySelector('.st-body') : null;
        const html = this._badge(ln[0]) + '<span class="sx-name">' + esc(inner ? '' : w.name) + '</span><span class="sx-text' + (inner ? ' inner' : '') + '">' + esc(ln[1]).replace(/\n/g, '<br>') + '</span>';
        if (body) body.innerHTML = html;
        el.classList.remove('hidden');
        el.classList.toggle('auto', this.talkAuto);
      }
      this._sfx('type_tick');
    }
    tapTalk() {
      if (!this.talkQ) return;
      this.stats.taps++;
      this.talkI++;
      if (this.talkI >= this.talkQ.length) this._talkFinish(); else this._talkShow();
    }
    skipTalk() { if (this.talkQ) this._talkFinish(); }
    setAuto(on) { this.talkAuto = on == null ? !this.talkAuto : !!on; if (this.el.talk) this.el.talk.classList.toggle('auto', this.talkAuto); }
    _talkFinish() {
      const cb = this.talkCb, id = this.talkId;
      this.talkQ = null; this.talkCur = null; this.talkCb = null; this.talkId = null;
      if (this.el.talk) this.el.talk.classList.add('hidden');
      if (cb) cb(id);
    }
    _hist(e) { this.history.push({ who: e.who, text: e.text }); if (this.history.length > this.cfg.talk.history) this.history.shift(); }

    // ---------- 章の札 ----------
    card(title, en, caption, sec) {
      this.cardOn = true;
      this.cardT = sec == null ? this.cfg.card.sec : sec;
      const el = this.el.card;
      if (el) {
        el.innerHTML = '<div class="sc-title mirror">' + esc(title) + '</div><div class="sc-en">' + esc(en || '') + '</div>' +
          (caption || []).map((c) => '<div class="sc-cap">' + esc(c) + '</div>').join('');
        el.classList.remove('hidden');
      }
      this._cardCls(true);
    }
    hideCard() { this.cardOn = false; this.cardT = 0; if (this.el.card) this.el.card.classList.add('hidden'); this._cardCls(false); }
    // 章のカードの間は #message（チェックポイントなど）を隠す（スマホの横でカードの題と重なる）
    _cardCls(on) { if (this.el.hud && this.el.hud.classList) this.el.hud.classList.toggle('story-card-on', !!on); }

    // ---------- 目標 ----------
    objective(text, count, timer, dist) {
      const t = text || '', c = count == null ? '' : String(count), tm = timer == null ? null : Math.max(0, Math.ceil(timer)), ds = dist == null ? null : Math.round(dist);
      if (t === this.objText && c === this.objCount && tm === this.objTimer && ds === this.objDist) return;
      const changed = t !== this.objText;
      this.objText = t; this.objCount = c; this.objTimer = tm; this.objDist = ds;
      const el = this.el.obj;
      if (!el) return;
      if (!t) { el.classList.add('hidden'); return; }
      const mm = tm == null ? '' : (Math.floor(tm / 60) + ':' + String(tm % 60).padStart(2, '0'));
      el.innerHTML = '<span class="so-goal">' + esc(t) + '</span>' + (c ? '<span class="so-count">' + esc(c) + '</span>' : '') + (mm ? '<span class="so-timer">' + mm + '</span>' : '') + (ds != null ? '<span class="so-dist">' + ds + ' m</span>' : '');
      el.classList.remove('hidden');
      if (changed) { el.classList.remove('new'); el.classList.add('new'); this._sfx('obj_ping'); }
    }

    // ---------- 目印（画面に映す）----------
    // list: [{ x, y, z, label, kind: 'goal' | 'ally' | 'civ' }]
    setMarks(list) { this.markList = (list || []).slice(0, this.cfg.markers.max); }
    _updateMarks(camera) {
      const box = this.el.marks;
      const W = (typeof window !== 'undefined' && window.innerWidth) || 844, H = (typeof window !== 'undefined' && window.innerHeight) || 390;
      const edge = this.cfg.markers.edge;
      this.markScreen = [];
      if (!camera || typeof THREE === 'undefined') return;
      const v = this._mv || (this._mv = new THREE.Vector3()), cp = this._cp || (this._cp = new THREE.Vector3());
      camera.getWorldPosition(cp);
      for (let i = 0; i < this.cfg.markers.max; i++) {
        const m = this.markList[i];
        let el = this._markEls[i];
        if (!el && box && m && typeof document !== 'undefined' && document.createElement) {
          el = document.createElement('div'); el.className = 'sm-mark'; el.innerHTML = '<i></i><span></span>';
          if (box.appendChild) box.appendChild(el);
          this._markEls[i] = el;
        }
        if (!m) { if (el && el.style) el.style.display = 'none'; continue; }
        v.set(m.x, (m.y || 0) + 1.2, m.z);
        const dist = cp.distanceTo(v);
        v.project(camera);
        let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H, off = false;
        if (v.z > 1) { x = W - x; y = H - y; off = true; } // 後ろ: 反対側へ
        if (x < edge || x > W - edge || y < edge || y > H - edge) off = true;
        x = Math.max(edge, Math.min(W - edge, x)); y = Math.max(edge, Math.min(H - edge, y));
        this.markScreen.push({ x, y, off, dist, kind: m.kind || 'goal' });
        if (el && el.style) {
          el.style.display = 'block';
          el.style.transform = 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)';
          el.className = 'sm-mark ' + (m.kind || 'goal') + (off ? ' off' : '') + (x > W * 0.6 ? ' left' : '');
          const sp = el.querySelector ? el.querySelector('span') : null;
          if (sp) sp.textContent = (m.label ? m.label + ' ' : '') + Math.round(dist) + ' m';
        }
      }
    }

    // ---------- 暗転・帯・ゲージ ----------
    fade(to, sec) { this.fadeTo = Math.max(0, Math.min(1, to)); this.fadeRate = sec > 0 ? 1 / sec : Infinity; if (!(sec > 0)) this._setFade(this.fadeTo); }
    get faded() { return this.fadeV >= 0.999; }
    _setFade(v) { this.fadeV = v; const f = this.el.fade; if (f && f.style) { f.style.opacity = v.toFixed(3); f.style.display = v > 0 ? 'block' : 'none'; } }
    letterbox(on) { this.lbOn = !!on; if (this.el.lb) this.el.lb.classList.toggle('on', this.lbOn); if (this.el.hud) this.el.hud.classList.toggle('story-cine', this.lbOn); }
    holdGauge(v, label) {
      const k = v == null ? -1 : Math.round(v * 100);
      if (k === this.holdV) return;
      this.holdV = k;
      const el = this.el.hold;
      if (!el) return;
      if (k < 0) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      el.innerHTML = '<span class="sh-label">' + esc(label || '') + '</span><span class="sh-bar"><i style="width:' + k + '%"></i></span>';
    }
    toast(text, sec) { if (this.game && this.game.hud && this.game.hud.showMessage) this.game.hud.showMessage(text, (sec || 2) * 1000); }

    // ---------- 選択（下の真ん中にボタン 2〜3 つ。ゲームは止めない = 無線の選択）----------
    choice(prompt, labels, cb) {
      this.choiceCb = cb || null;
      const el = this.el.choice;
      if (el) {
        el.innerHTML = '<div class="sc-q">' + esc(prompt || '') + '</div><div class="sc-opts">' + labels.map((l, i) => '<button class="sx-btn" type="button" data-act="choice-' + i + '">' + esc(l) + '</button>').join('') + '</div>';
        el.classList.remove('hidden');
      }
      if (this.el.hud && this.el.hud.classList) this.el.hud.classList.add('story-choice-on');
      this.choiceOn = true;
    }
    hideChoice() { this.choiceOn = false; this.choiceCb = null; if (this.el.choice) this.el.choice.classList.add('hidden'); if (this.el.hud && this.el.hud.classList) this.el.hud.classList.remove('story-choice-on'); }
    pickChoice(i) { const cb = this.choiceCb; if (!this.choiceOn) return; this.hideChoice(); this.stats.taps++; if (cb) cb(i); }

    // ---------- 資料 ----------
    intel(card, cb) {
      this.intelCur = card; this.intelCb = cb || null;
      const el = this.el.intel;
      if (el) {
        el.innerHTML = '<div class="si-title">' + esc(card.title) + '</div><div class="si-body">' + esc(card.body).replace(/\n/g, '<br>') + '</div><button class="si-close sx-btn" type="button" data-act="intel-close">閉じる</button>';
        el.classList.remove('hidden');
      }
      this._modal();
    }
    closeIntel() { if (!this.intelCur) return; const cb = this.intelCb; this.intelCur = null; this.intelCb = null; if (this.el.intel) this.el.intel.classList.add('hidden'); this._modal(); if (cb) cb(); }

    // ---------- 任務失敗 ----------
    showFail(why, cb, hasCp) {
      this.failOn = true; this.failCb = cb;
      const el = this.el.fail;
      if (el) {
        el.innerHTML = '<div class="sf-title">任務失敗</div><div class="sf-why">' + esc(why || '') + '</div><div class="sf-actions">' +
          (hasCp ? '<button class="sx-btn" type="button" data-act="fail-cp">チェックポイントから</button>' : '') +
          '<button class="sx-btn" type="button" data-act="fail-restart">章の最初から</button><button class="sx-btn" type="button" data-act="fail-ship">船に戻る</button></div>';
        el.classList.remove('hidden');
      }
      this._modal();
    }
    hideFail() { this.failOn = false; this.failCb = null; if (this.el.fail) this.el.fail.classList.add('hidden'); this._modal(); }
    chooseFail(which) { if (!this.failOn) return false; const cb = this.failCb; this.hideFail(); if (cb) cb(which); return true; }

    // ---------- 結果 ----------
    showResult(r, cb) {
      this.resultOn = true; this.resultCb = cb; this.resultData = r;
      const el = this.el.result;
      if (el) {
        const mm = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
        el.innerHTML = '<div class="sr-title">' + esc(r.title) + '</div><div class="sr-sub">任務完了</div><div class="sr-rank">' + esc(r.rank) + '</div>' +
          '<div class="sr-stats"><span>時間 <b>' + mm(r.sec || 0) + '</b></span><span>撃破 <b>' + (r.kills || 0) + '</b></span><span>被弾 <b>' + Math.round(r.damage || 0) + '</b></span>' +
          (r.civTotal ? '<span>民間人 <b>' + (r.civSafe || 0) + ' / ' + r.civTotal + '</b></span>' : '') + '<span>資料 <b>' + (r.intel || 0) + ' / ' + (r.intelTotal || 0) + '</b></span></div>' +
          '<div class="sr-actions">' + (r.next ? '<button class="sx-btn main" type="button" data-act="res-next">次の章へ</button>' : '') +
          '<button class="sx-btn" type="button" data-act="res-again">もう一度</button><button class="sx-btn" type="button" data-act="res-ship">船に戻る</button></div>';
        el.classList.remove('hidden');
      }
      this._modal();
    }
    hideResult() { this.resultOn = false; this.resultCb = null; if (this.el.result) this.el.result.classList.add('hidden'); this._modal(); }
    chooseResult(which) { if (!this.resultOn) return false; const cb = this.resultCb; this.hideResult(); if (cb) cb(which); return true; }

    // ---------- 支援射撃のボタン ----------
    // st: null（隠す）| { n, ready, cool, aiming }
    setStrike(st) {
      const key = st ? (st.n + '|' + (st.ready ? 1 : 0) + '|' + Math.ceil(st.cool || 0) + '|' + (st.aiming ? 1 : 0)) : '';
      if (key === this._strikeKey) return;
      this._strikeKey = key;
      this.strikeState = st;
      const el = this.el.strike;
      if (!el) return;
      el.classList.toggle('hidden', !st);
      { const hud = typeof document !== 'undefined' && document.getElementById ? document.getElementById('hud') : null; if (hud && hud.classList) hud.classList.toggle('story-strike', !!st); } // 狭い画面の無線の幅（style.css）
      if (!st) return;
      el.classList.toggle('cool', !st.ready);
      el.classList.toggle('aiming', !!st.aiming);
      el.innerHTML = '<span>' + (st.aiming ? '決定' : '支援射撃') + '</span><b class="sk-n">' + (st.ready ? st.n : Math.ceil(st.cool || 0) + 's') + '</b>';
    }
    tapStrike() { if (this.strikeState && this.onStrike) { this.stats.taps++; this.onStrike(); } }

    // ---------- 毎フレーム ----------
    update(dt, camera) {
      // 無線
      if (this.radioCur) { this.radioT -= dt; if (this.radioT <= 0) this._radioEnd(); }
      else if (this.radioGap > 0) this.radioGap -= dt;
      else if (this.radioQ.length) this._radioShow(this.radioQ.shift());
      // 会話のオート
      if (this.talkQ && this.talkAuto) { this.talkT -= dt; if (this.talkT <= 0) this.tapTalk(); }
      // 札
      if (this.cardOn) { this.cardT -= dt; if (this.cardT <= 0) this.hideCard(); }
      // 暗転
      if (this.fadeV !== this.fadeTo) {
        const s = this.fadeRate === Infinity ? 1 : this.fadeRate * dt;
        const v = this.fadeV < this.fadeTo ? Math.min(this.fadeTo, this.fadeV + s) : Math.max(this.fadeTo, this.fadeV - s);
        this._setFade(v);
      }
      this._updateMarks(camera);
    }

    // 板（資料・任務失敗・結果）の間は #hud.story-modal（ボタン・スティック・メッセージを隠す）
    _modal() { const on = !!(this.intelCur || this.failOn || this.resultOn); if (this.el.hud && this.el.hud.classList) this.el.hud.classList.toggle('story-modal', on); }
    _sfx(name) { const a = this.game && this.game.audio; if (a && typeof a.play === 'function') a.play(name, { volume: 0.5, priority: 1 }); }

    // ボタン: 1 回だけつなぐ（StoryUI._active に効かせる）
    _bind() {
      StoryUI._active = this;
      if (StoryUI._bound || typeof document === 'undefined' || !document.getElementById) return;
      StoryUI._bound = true;
      const cur = () => StoryUI._active;
      const act = (name) => {
        const u = cur(); if (!u) return;
        if (name === 'radio') u.tapRadio();
        else if (name === 'talk') u.tapTalk();
        else if (name === 'talk-auto') u.setAuto();
        else if (name === 'talk-skip') u.skipTalk();
        else if (name === 'intel-close') u.closeIntel();
        else if (name === 'fail-cp') u.chooseFail('cp');
        else if (name === 'fail-restart') u.chooseFail('restart');
        else if (name === 'fail-ship') u.chooseFail('ship');
        else if (name === 'res-next') u.chooseResult('next');
        else if (name === 'res-again') u.chooseResult('again');
        else if (name === 'res-ship') u.chooseResult('ship');
        else if (name === 'strike') u.tapStrike();
        else if (name === 'skip-cine') { if (u.onSkip) u.onSkip(); }
        else if (/^choice-\d$/.test(name)) u.pickChoice(+name.slice(7));
      };
      const actOf = (t, dflt) => { const b = t && typeof t.closest === 'function' ? t.closest('[data-act]') : null; return b && b.getAttribute ? b.getAttribute('data-act') : dflt; };
      const bind = (id, dflt) => {
        const el = document.getElementById(id);
        if (!el || !el.addEventListener) return;
        let pid = null, down = null, lastT = 0, t0 = 0;
        el.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse') return; pid = ev.pointerId; down = actOf(ev.target, dflt); t0 = ev.timeStamp || 0; if (ev.stopPropagation) ev.stopPropagation(); });
        el.addEventListener('pointercancel', (ev) => { if (ev.pointerId === pid) pid = null; });
        el.addEventListener('pointerup', (ev) => {
          if (ev.pointerType === 'mouse' || ev.pointerId !== pid) return;
          pid = null;
          const a = actOf(ev.target, dflt);
          if (!a || a !== down) return;
          if (ev.preventDefault) ev.preventDefault();
          lastT = Date.now();
          // 会話の「スキップ」は 0.6 秒押したときだけ（間違えて飛ばさない）
          if (a === 'talk-skip' && (ev.timeStamp || 0) - t0 < ((cur() && cur().cfg.talk.skipHold) || 0.6) * 1000 * 0.98) return;
          act(a);
        });
        el.addEventListener('click', (ev) => { if (Date.now() - lastT < 600) return; const a = actOf(ev.target, dflt); if (a) act(a); });
      };
      for (const [id, d] of [['story-radio', 'radio'], ['story-talk', 'talk'], ['story-intel', null], ['story-fail', null], ['story-result', null], ['btn-strike', 'strike'], ['story-skip', 'skip-cine'], ['story-choice', null]]) bind(id, d);
    }

    dispose() {
      this.clearRadio();
      if (this.talkQ) { this.talkCb = null; this._talkFinish(); }
      this.hideCard(); this.hideFail(); this.hideResult(); this.closeIntel(); this.hideChoice();
      this.objective(''); this.setMarks([]); this._updateMarks(null);
      for (const el of this._markEls) if (el && el.style) el.style.display = 'none';
      this._setFade(0); this.letterbox(false); this.setStrike(null); this.holdGauge(null);
      if (StoryUI._active === this) StoryUI._active = null;
    }
  }

  MR.StoryUI = StoryUI;
})();
