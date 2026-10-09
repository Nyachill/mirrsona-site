// 画面上の表示（DOM）。ゲーム側からイベントで更新する。
window.MR = window.MR || {};

MR.HUD = class HUD {
  constructor(root) {
    this.root = root;
    const q = (sel) => root.querySelector(sel);
    this.hpBar = q('#hp-bar');
    this.hpWrap = q('#hp-wrap');
    this.ammoMag = q('#ammo-mag');
    this.ammoReserve = q('#ammo-reserve');
    this.weaponName = q('#weapon-name');
    this.kills = q('#kills');
    this.hitMarker = q('#hit-marker');
    this.vignette = q('#damage-vignette');
    this.message = q('#message');
    this.death = q('#death-overlay');
    this.debug = q('#debug');
    this.crosshair = q('#crosshair');
    this.adsBtn = q('#btn-ads');
    this.weaponList = q('#weapon-list');
    this.scope = q('#scope');
    this.vehicleHud = q('#vehicle-hud');
    this.vehicleName = q('#vehicle-name');
    this.vehicleSpeed = q('#vehicle-speed');
    this.vehicleHp = q('#vehicle-hp');
    this.vehicleBtn = q('#btn-vehicle');
    this.vehicleBtnLabel = (this.vehicleBtn && typeof this.vehicleBtn.querySelector === 'function') ? this.vehicleBtn.querySelector('span') : null;
    // ヘリ: 高度（地面から / 海から）・回転数の輪（始動中）・下降 / 視点 / 座席のボタン
    this.heliInfo = q('#heli-info');
    this.heliAlt = q('#heli-alt');
    this.heliAsl = q('#heli-asl');
    this.heliRpm = q('#heli-rpm');
    this.heliRpmText = q('#heli-rpm-text');
    this.seatBtn = q('#btn-seat');
    this._heliKey = '';
    this._heliOn = false;
    this._vehicleShown = false;
    this._vehiclePrompt = null;
    this._lastKmh = -1;
    this.scoped = false;
    this.ads = false;
    this._hitTimer = null;
    this._msgTimer = null;
    this._vigTimer = null;
    // オンライン（enableOnline() で使う）
    this.killfeed = q('#killfeed');
    this.netInfo = q('#net-info');
    this.netBanner = q('#net-banner');
    this.netBannerText = this.netBanner && typeof this.netBanner.querySelector === 'function' ? this.netBanner.querySelector('.nb-text') : null;
    this.leaveBtns = [q('#btn-leave'), q('#btn-leave-banner')].filter(Boolean);
    this._leaveCb = null;
    this.scoreboard = q('#scoreboard');
    this.scoreBody = q('#scoreboard-body');
    this.killsWrap = q('#kills-wrap');
    this.deathTitle = q('.death-title');
    this.deathSub = q('.death-sub');
    this.deathBy = q('.death-by');
    this.scoreboardOpen = false;
    this.online = false;
    this._feed = [];
    this._netText = '';
    this._bannerText = null;
    // 街（cityplay.js / minimap.js / royale.js）: 武器の枠・防具・回復・拾う・ミニマップ・方位・バトルロイヤル・結果
    this.slotsEl = q('#slots');
    this.armorEl = q('#armor');
    this.vestBar = q('#ar-vest');
    this.helmetBar = q('#ar-helmet');
    this.healBtn = q('#btn-heal');
    this.healRing = q('#heal-ring');
    this.pickupBtn = q('#btn-pickup');
    this.royaleInfo = q('#royale-info');
    this.zoneTint = q('#zone-tint');
    this.resultEl = q('#result');
    this.dropBtn = q('#btn-drop');
    this.compass = q('#compass');
    this._slotKey = '';
    this._armorKey = '';
    this._healKey = '';
    this._pickupText = null;
    this._royaleKey = '';
    this._tint = -1;
    this._compassKey = '';
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setHealth(current, max) {
    const ratio = Math.max(0, Math.min(1, current / max));
    this.hpBar.style.width = (ratio * 100).toFixed(1) + '%';
    this.hpWrap.classList.toggle('low', ratio <= 0.3);
  }

  setAmmo(mag, reserve, reloading) {
    this.ammoMag.textContent = reloading ? '…' : String(mag);
    this.ammoReserve.textContent = String(reserve);
    this.ammoMag.classList.toggle('empty', !reloading && mag === 0);
  }

  // 武器一覧（右上の小さなタブ）。index は選択中
  setWeapons(names) {
    if (!this.weaponList || typeof this.weaponList.appendChild !== 'function' || typeof document === 'undefined' || !document.createElement) return;
    this.weaponList.textContent = '';
    this.weaponItems = [];
    for (let i = 0; i < names.length; i++) {
      const el = document.createElement('span');
      el.className = 'weapon-item';
      el.textContent = (i + 1) + ' ' + names[i];
      this.weaponList.appendChild(el);
      this.weaponItems.push(el);
    }
  }

  setWeapon(name, index) {
    this.weaponName.textContent = name;
    if (this.weaponItems && typeof index === 'number') {
      for (let i = 0; i < this.weaponItems.length; i++) this.weaponItems[i].classList.toggle('active', i === index);
    }
  }

  // スコープ（スナイパーの照準）: 画面を黒い円で覆いレティクルを出す。モデル側は weapon.js が隠す
  setScope(on) {
    on = !!on;
    if (on === this.scoped) return;
    this.scoped = on;
    if (this.scope) this.scope.classList.toggle('hidden', !on);
  }

  // 照準（ADS）中: クロスヘアを隠し（.ads）、照準ボタンを押下状態にする。毎フレーム呼んでよい
  // active: 実際に覗いている（照準線を消す）、requested: ボタンのトグル状態（省略時は active と同じ）
  setAds(active, requested) {
    active = !!active;
    requested = requested === undefined ? active : !!requested;
    if (active !== this.ads) {
      this.ads = active;
      if (this.crosshair) this.crosshair.classList.toggle('ads', active);
    }
    if (requested !== this.adsRequested) {
      this.adsRequested = requested;
      if (this.adsBtn) this.adsBtn.classList.toggle('pressed', requested);
    }
  }

  setKills(n) {
    this.kills.textContent = String(n);
  }

  // 乗り物に乗っている間の表示（名前・速度 km/h・耐久）。null で隠す。毎フレーム呼んでよい
  setVehicle(info) {
    if (!this.vehicleHud) return;
    const on = !!info;
    if (on !== this._vehicleShown) {
      this._vehicleShown = on;
      this.vehicleHud.classList.toggle('hidden', !on);
      this.root.classList.toggle('driving', on);
      this._lastKmh = -1;
    }
    if (!on) return;
    const kmh = Math.round(info.kmh || 0);
    if (kmh !== this._lastKmh) { this._lastKmh = kmh; if (this.vehicleSpeed) this.vehicleSpeed.textContent = String(kmh); }
    if (this.vehicleName && this.vehicleName.textContent !== info.name) this.vehicleName.textContent = info.name || '';
    this.vehicleHud.classList.toggle('is-heli', !!info.heli);
    const ratio = Math.max(0, Math.min(1, (info.health || 0) / (info.maxHealth || 1)));
    if (this.vehicleHp) this.vehicleHp.style.width = (ratio * 100).toFixed(1) + '%';
    this.vehicleHud.classList.toggle('low', ratio <= 0.3);
  }

  // ヘリに乗っている間（setVehicle の後に毎フレーム呼んでよい）。info = { alt（地面から m）, asl（海面から m）, rpm 0..1,
  //   starting（始動中）, pilot（操縦席）, chase（3 人称）, seat（座席を移れる）} か null。
  //   #hud に heli（乗っている）/ piloting（操縦席: 撃つボタンを隠して下降ボタンを出す）のクラス
  setHeli(info) {
    const on = !!info;
    if (on !== this._heliOn) {
      this._heliOn = on;
      this.root.classList.toggle('heli', on);
      if (this.heliInfo) this.heliInfo.classList.toggle('hidden', !on);
      if (!on) { this.root.classList.remove('piloting'); this.root.classList.remove('chase'); if (this.heliRpm) this.heliRpm.classList.add('hidden'); if (this.seatBtn) this.seatBtn.classList.add('hidden'); this._heliKey = ''; }
    }
    if (!on) return;
    const alt = Math.max(0, Math.round(info.alt || 0)), asl = Math.round(info.asl || 0);
    const pct = Math.round(Math.max(0, Math.min(1, info.rpm || 0)) * 100);
    const key = alt + '|' + asl + '|' + (info.starting ? pct : -1) + '|' + (info.pilot ? 1 : 0) + (info.chase ? 1 : 0) + (info.seat ? 1 : 0);
    if (key === this._heliKey) return;
    this._heliKey = key;
    this.root.classList.toggle('piloting', !!info.pilot);
    this.root.classList.toggle('chase', !!info.chase);
    if (this.heliAlt) this.heliAlt.textContent = String(alt);
    if (this.heliAsl) this.heliAsl.textContent = String(asl);
    if (this.heliRpm) {
      this.heliRpm.classList.toggle('hidden', !info.starting);
      if (info.starting) {
        if (this.heliRpm.style && typeof this.heliRpm.style.setProperty === 'function') this.heliRpm.style.setProperty('--rpm', pct + '%');
        if (this.heliRpmText) this.heliRpmText.textContent = pct + '%';
      }
    }
    if (this.seatBtn) this.seatBtn.classList.toggle('hidden', !info.seat);
  }

  // 戦闘機に乗っている間（毎フレーム呼んでよい）。info = { pilot（操縦席）, air（飛んでいる）, stopped（地上で止まっている）,
  //   chase（3 人称）, manual（手動の操縦）, deck（甲板で発艦ボタンを出す）} か null。#hud に jet / jet-pilot / jet-air / jet-manual のクラス（ボタンの出し分けは style.css）
  //   easy（かんたん操作: #hud.jet-easy = 加速・減速・ミサイル・フレアの配置）、land（'carrier' | 'road' | 'off' = 着艦・着陸ボタン（#btn-land）の文字。null で隠す）
  setJet(info) {
    const key = info ? ((info.pilot ? 'p' : '') + (info.air ? 'a' : '') + (info.stopped ? 's' : '') + (info.chase ? 'c' : '') + (info.manual ? 'm' : '') + (info.deck ? (info.deck === 'road' ? 'r' : 'd') : '') + (info.easy ? 'e' : '') + (info.land || '')) : '';
    if (key === this._jetKey) return;
    this._jetKey = key;
    const rc = this.root.classList;
    rc.toggle('jet', !!info);
    rc.toggle('jet-pilot', !!(info && info.pilot));
    rc.toggle('jet-air', !!(info && info.air));
    rc.toggle('jet-stopped', !!(info && info.stopped));
    rc.toggle('jet-chase', !!(info && info.chase));
    rc.toggle('jet-manual', !!(info && info.manual));
    rc.toggle('jet-deck', !!(info && info.deck)); // 空母の甲板: 発艦ボタン（#btn-launch）。deck === 'road'（道路などに止まっている）は「離陸」
    if (info && info.deck) {
      const lb = this.root.querySelector('#btn-launch span');
      if (lb) lb.textContent = info.deck === 'road' ? '離陸' : '発艦';
    }
    rc.toggle('jet-easy', !!(info && info.easy));
    rc.toggle('jet-land', !!(info && info.land));
    if (info && info.land) {
      const b = this.root.querySelector('#btn-land .land-label');
      if (b) b.textContent = info.land === 'off' ? '解除' : (info.land === 'road' ? '着陸' : '着艦');
      const bb = this.root.querySelector('#btn-land');
      if (bb && bb.classList) bb.classList.toggle('land-off', info.land === 'off');
    }
  }

  // 乗り降りボタン: text（'乗る' / '降りる'）で表示、null で隠す
  setVehiclePrompt(text) {
    if (!this.vehicleBtn) return;
    text = text || null;
    if (text === this._vehiclePrompt) return;
    this._vehiclePrompt = text;
    this.vehicleBtn.classList.toggle('hidden', !text);
    if (text) (this.vehicleBtnLabel || this.vehicleBtn).textContent = text;
  }

  hit(isKill) {
    this.hitMarker.classList.remove('show', 'kill');
    // 連続でも毎回アニメーションが出るように再描画を挟む
    void this.hitMarker.offsetWidth;
    this.hitMarker.classList.add('show');
    if (isKill) this.hitMarker.classList.add('kill');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.hitMarker.classList.remove('show', 'kill'), 140);
  }

  damage() {
    this.vignette.classList.remove('show');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('show');
    clearTimeout(this._vigTimer);
    this._vigTimer = setTimeout(() => this.vignette.classList.remove('show'), 350);
  }

  showMessage(text, ms) {
    this.message.textContent = text;
    this.message.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => this.message.classList.remove('show'), ms || 1500);
  }

  showDeath(visible) {
    this.death.classList.toggle('hidden', !visible);
  }

  // ---------- オンライン ----------

  // 撃破数をタップ（PC は Tab キー）でスコアボードを開閉。接続表示・キルフィードを使う
  enableOnline() {
    if (this.online) return;
    this.online = true;
    this.root.classList.add('online');
    const toggle = (e) => { if (e && e.preventDefault) e.preventDefault(); this.toggleScoreboard(); };
    if (this.killsWrap && this.killsWrap.addEventListener) {
      this.killsWrap.addEventListener('click', toggle);
    }
    if (this.scoreboard && this.scoreboard.addEventListener) this.scoreboard.addEventListener('click', toggle);
    // 「タイトルへ」: スコアボードの中（いつでも）と接続の帯（切れているとき）。押したら onLeave の関数を呼ぶ
    for (const b of this.leaveBtns) {
      if (!b.addEventListener || b._leaveBound) continue;
      b._leaveBound = true;
      const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
      b.addEventListener('pointerdown', stop);
      b.addEventListener('click', (e) => { stop(e); if (e && e.preventDefault) e.preventDefault(); if (this.online && this._leaveCb) this._leaveCb(); });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      this._onKey = (e) => { if (e.code === 'Tab' || e.key === 'Tab') { e.preventDefault(); this.toggleScoreboard(); } };
      window.addEventListener('keydown', this._onKey);
    }
  }

  disableOnline() {
    if (!this.online) return;
    this.online = false;
    this.root.classList.remove('online');
    if (this._onKey && typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('keydown', this._onKey);
    this.toggleScoreboard(false);
    this.setNetBanner(null);
  }

  toggleScoreboard(on) {
    this.scoreboardOpen = on === undefined ? !this.scoreboardOpen : !!on;
    if (this.scoreboard) this.scoreboard.classList.toggle('hidden', !this.scoreboardOpen);
  }

  // rows: [{ id, name, kills, deaths, ping }]（並べ替え済み）、selfId: 自分の行を強調
  setScoreboard(rows, selfId) {
    if (!this.scoreBody) return;
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let html = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      html += '<tr class="' + (r.id === selfId ? 'self' : '') + (r.alive === 0 ? ' dead' : '') + '"><td class="rank">' + (i + 1) + '</td><td class="name">' + esc(r.name) +
        '</td><td>' + (r.kills | 0) + '</td><td>' + (r.deaths | 0) + '</td><td class="ping">' + (r.ping == null ? '-' : Math.round(r.ping)) + '</td></tr>';
    }
    if (html !== this._scoreHtml) { this._scoreHtml = html; this.scoreBody.innerHTML = html; }
  }

  // 接続表示（左上）: { ping, players, max, status }
  setNet(info) {
    if (!this.netInfo) return;
    let text = '';
    let bad = false;
    if (info) {
      if (info.status === 'open') text = (info.ping == null ? '--' : Math.round(info.ping)) + 'ms  ' + info.players + '/' + info.max; // null = まだ測っていない
      else { text = info.text || '接続中…'; bad = true; }
    }
    if (text === this._netText) return;
    this._netText = text;
    this.netInfo.textContent = text;
    this.netInfo.classList.toggle('bad', bad || (info && info.ping > 200));
    this.netInfo.classList.toggle('hidden', !text);
  }

  // オンラインから抜ける（「タイトルへ」ボタン）ときに呼ぶ関数
  onLeave(fn) { this._leaveCb = typeof fn === 'function' ? fn : null; }

  // 画面上部の帯（再接続中・エラー）。null で隠す。opts.leave = true で「タイトルへ」ボタンも出す
  setNetBanner(text, opts) {
    if (!this.netBanner) return;
    text = text || null;
    const leave = !!(text && opts && opts.leave);
    const key = text ? (leave ? '1' : '0') + text : null;
    if (key === this._bannerText) return;
    this._bannerText = key;
    if (this.netBannerText) this.netBannerText.textContent = text || '';
    else this.netBanner.textContent = text || '';
    const btn = this.leaveBtns[1];
    if (btn && btn.classList) btn.classList.toggle('hidden', !leave);
    this.netBanner.classList.toggle('with-action', leave);
    this.netBanner.classList.toggle('hidden', !text);
  }

  // キルフィード（左上）: 「A ▸ B (武器)」。6 秒で消える、最大 5 行
  addKillFeed(attacker, target, weapon, opts) {
    opts = opts || {};
    if (!this.killfeed || typeof document === 'undefined' || !document.createElement) return;
    const el = document.createElement('div');
    el.className = 'kf-line' + (opts.self ? ' self' : '') + (opts.victim ? ' victim' : '');
    const text = (attacker ? attacker + ' \u25B8 ' : '') + target + (weapon ? ' (' + weapon + ')' : '') + (opts.head ? ' \u2316' : '');
    el.textContent = text;
    if (typeof this.killfeed.appendChild === 'function') this.killfeed.appendChild(el);
    const item = { el, timer: null };
    this._feed.push(item);
    const remove = () => {
      const i = this._feed.indexOf(item);
      if (i >= 0) this._feed.splice(i, 1);
      clearTimeout(item.timer);
      if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
    };
    item.timer = setTimeout(remove, opts.ms || 6000);
    while (this._feed.length > 5) {
      const old = this._feed[0];
      clearTimeout(old.timer);
      this._feed.shift();
      if (old.el.parentNode && old.el.parentNode.removeChild) old.el.parentNode.removeChild(old.el);
    }
    return text;
  }

  // 死亡画面の文言（オンライン）。title: 大きい見出し、by: 誰に・何でやられたか（見出しの下の小さい行。'' で隠す）、
  // sub: 復活までの秒数。null は今のまま。名前と武器名は長いので見出しには入れない（狭い横画面で折り返すため）
  setDeathInfo(title, sub, by) {
    if (title != null && this.deathTitle) this.deathTitle.textContent = title;
    if (sub != null && this.deathSub) this.deathSub.textContent = sub;
    if (by != null && this.deathBy) {
      this.deathBy.textContent = by;
      this.deathBy.classList.toggle('hidden', !by);
    }
  }

  // ---------- 街 ----------

  // 街の HUD（#hud.city: 武器の枠・ミニマップ・回復を出し、右上の弾数と武器一覧を隠す）
  setCity(on) {
    on = !!on;
    this.root.classList.toggle('city', on);
    for (const el of [this.slotsEl, this.healBtn]) if (el) el.classList.toggle('hidden', !on);
    if (!on) { if (this.armorEl) this.armorEl.classList.add('hidden'); this._slotKey = ''; this._armorKey = ''; this._healKey = ''; }
  }

  // 武器の枠（3 つ）: [{ id, short, name, ammo, mag, reserve, cal, active } | null]。変わったときだけ書く
  setSlots(slots) {
    const el = this.slotsEl;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    let key = '';
    for (const s of slots) key += s ? s.id + ':' + s.ammo + '/' + s.reserve + (s.active ? '*' : '') + (s.reloading ? 'r' : '') + '|' : '-|';
    if (key === this._slotKey) return;
    this._slotKey = key;
    const cards = el.querySelectorAll('.slot');
    for (let i = 0; i < cards.length && i < slots.length; i++) {
      const c = cards[i], s = slots[i];
      c.classList.toggle('empty', !s);
      c.classList.toggle('active', !!(s && s.active));
      c.classList.toggle('dry', !!(s && s.ammo === 0 && s.reserve === 0));
      c.setAttribute('data-w', s ? s.id : '');
      const name = c.querySelector('.slot-name'), mag = c.querySelector('.slot-mag'), res = c.querySelector('.slot-res');
      if (name) name.textContent = s ? (s.short || s.name) : (i === 2 ? 'サブ' : '空き');
      if (mag) mag.textContent = s ? (s.reloading ? '…' : String(s.ammo)) : '';
      if (res) res.textContent = s ? String(s.reserve) : '';
    }
  }

  // 防具: { vest: 0..1 | null, helmet: 0..1 | null }
  setArmor(a) {
    const key = (a.vest == null ? '-' : a.vest.toFixed(2)) + '|' + (a.helmet == null ? '-' : a.helmet.toFixed(2));
    if (key === this._armorKey) return;
    this._armorKey = key;
    if (this.armorEl) this.armorEl.classList.toggle('hidden', a.vest == null && a.helmet == null);
    const put = (row, v) => {
      if (!row) return;
      row.classList.toggle('hidden', v == null);
      const bar = row.querySelector && row.querySelector('i');
      if (bar && v != null) bar.style.width = (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%';
    };
    put(this.vestBar, a.vest);
    put(this.helmetBar, a.helmet);
  }

  // 回復: { medkit, bandage, active: 種類 | null, progress 0..1, left 秒 }
  setHeal(h) {
    const key = h.medkit + '|' + h.bandage + '|' + (h.active || '') + '|' + (h.active ? Math.round(h.progress * 50) : 0);
    if (key === this._healKey) return;
    this._healKey = key;
    const b = this.healBtn;
    if (b) {
      b.classList.toggle('none', !(h.medkit > 0 || h.bandage > 0));
      b.classList.toggle('pressed-on', !!h.active);
      const mk = b.querySelector && b.querySelector('.heal-mk'), bd = b.querySelector && b.querySelector('.heal-bd');
      if (mk) mk.textContent = String(h.medkit | 0);
      if (bd) bd.textContent = String(h.bandage | 0);
    }
    const r = this.healRing;
    if (r) {
      r.classList.toggle('hidden', !h.active);
      if (h.active) {
        if (r.style && typeof r.style.setProperty === 'function') r.style.setProperty('--p', (h.progress * 100).toFixed(1) + '%');
        const t = r.querySelector && r.querySelector('.hr-text');
        if (t) t.textContent = (h.active === 'medkit' ? '救急キット' : '包帯');
        const sec = r.querySelector && r.querySelector('.hr-sec');
        if (sec) sec.textContent = Math.max(0, h.left || 0).toFixed(1) + 's';
      }
    }
  }

  // 拾うボタン: text（「拾う：ライフル」）と sub（入れ替えで落とす物など）。null で隠す
  setPickup(text, sub) {
    const key = text ? text + '|' + (sub || '') : null;
    if (key === this._pickupText) return;
    this._pickupText = key;
    const b = this.pickupBtn;
    if (!b) return;
    b.classList.toggle('hidden', !text);
    if (!text) return;
    const main = b.querySelector && b.querySelector('.pk-main'), s2 = b.querySelector && b.querySelector('.pk-sub');
    if (main) main.textContent = text; else b.textContent = text;
    if (s2) { s2.textContent = sub || ''; s2.classList.toggle('hidden', !sub); }
  }

  // バトルロイヤル: { alive, zone（「縮小まで 0:45」など）, dist（安全地帯までの m か null）, warn（外にいる）,
  //   label（数の見出し。既定「残り」。街の個人戦は「人数」）, distLabel（既定「安全地帯まで 」）}。null で隠す
  setRoyale(info) {
    const el = this.royaleInfo;
    if (!el) return;
    if (!info) { if (this._royaleKey !== '') { this._royaleKey = ''; el.classList.add('hidden'); } return; }
    const label = info.label || '残り', dl = info.distLabel || '安全地帯まで ';
    const key = info.alive + '|' + info.zone + '|' + (info.dist == null ? '' : info.dist) + '|' + (info.warn ? 1 : 0) + '|' + label + '|' + dl;
    if (key === this._royaleKey) return;
    this._royaleKey = key;
    el.classList.remove('hidden');
    el.classList.toggle('warn', !!info.warn);
    const a = el.querySelector && el.querySelector('.ry-alive'), z = el.querySelector && el.querySelector('.ry-zone'), d = el.querySelector && el.querySelector('.ry-dist');
    const lb = el.querySelector && el.querySelector('.ry-label');
    if (lb && lb.textContent !== label) lb.textContent = label;
    if (a) a.textContent = String(info.alive);
    if (z) z.textContent = info.zone || '';
    if (d) { d.textContent = info.dist == null ? '' : dl + info.dist + ' m'; d.classList.toggle('hidden', info.dist == null); }
  }

  // オンラインのバトロワのロビー: { title, text（「あと 1 人で開始」「開始まで 12 秒」）, names: [{ name, self }], countdown }。null で隠す
  setLobby(info) {
    const el = this.lobbyEl || (this.lobbyEl = this.root.querySelector ? this.root.querySelector('#ry-lobby') : null);
    if (!el) return;
    if (!info) { if (this._lobbyKey !== '') { this._lobbyKey = ''; el.classList.add('hidden'); } return; }
    const key = info.title + '|' + info.text + '|' + info.names.map((n) => n.name + (n.self ? '*' : '')).join(',') + (info.countdown ? 'c' : '');
    if (key === this._lobbyKey) return;
    this._lobbyKey = key;
    el.classList.remove('hidden');
    el.classList.toggle('countdown', !!info.countdown);
    const t = el.querySelector && el.querySelector('.lb-title'), x = el.querySelector && el.querySelector('.lb-text'), n = el.querySelector && el.querySelector('.lb-names');
    if (t) t.textContent = info.title || '';
    if (x) x.textContent = info.text || '';
    if (n) {
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      n.innerHTML = info.names.map((p) => '<span class="lb-name' + (p.self ? ' self' : '') + '">' + esc(p.name) + '</span>').join('');
    }
  }

  // 観戦中の表示（「観戦中：○○」と次の人ボタン）。null で隠す
  setSpectate(text) {
    const el = this.specEl || (this.specEl = this.root.querySelector ? this.root.querySelector('#spectate') : null);
    if (!el) return;
    text = text || null;
    if (text === this._specText) return;
    this._specText = text;
    el.classList.toggle('hidden', !text);
    const t = el.querySelector && el.querySelector('.sp-name');
    if (t) t.textContent = text || ''; else el.textContent = text || '';
  }

  // 結果画面の「次のラウンドまで N 秒」（オンライン）
  setResultNext(text) {
    const el = this.resultEl;
    if (!el || el.classList.contains('hidden')) return;
    const n = el.querySelector && el.querySelector('.rs-next');
    if (n && n.textContent !== text) n.textContent = text || '';
  }

  // 安全地帯の外にいる間の画面の縁の色（0..1）
  setZoneTint(k) {
    const v = Math.round(Math.max(0, Math.min(1, k)) * 20) / 20;
    if (v === this._tint || !this.zoneTint) return;
    this._tint = v;
    this.zoneTint.style.opacity = String(v);
  }

  // 方位（画面上の帯）: yawDeg（北 = 0、時計回り）、wp: { bearing（度）, dist（m）} | null
  setCompass(yawDeg, wp) {
    const el = this.compass;
    if (!el) return;
    const y = ((yawDeg % 360) + 360) % 360;
    const key = Math.round(y * 2) + '|' + (wp ? Math.round(wp.bearing) + ':' + Math.round(wp.dist) : '');
    if (key === this._compassKey) return;
    this._compassKey = key;
    const strip = el.querySelector && el.querySelector('.cmp-strip');
    // 帯は 1° = 2 px、N が 0 px。中央に今の向き
    if (strip && strip.style) strip.style.transform = 'translateX(' + (-y * 2).toFixed(1) + 'px)';
    const mk = el.querySelector && el.querySelector('.cmp-wp'), ds = el.querySelector && el.querySelector('.cmp-dist');
    if (mk) {
      let d = wp ? ((wp.bearing - y + 540) % 360) - 180 : 0;
      const on = !!wp;
      mk.classList.toggle('hidden', !on);
      mk.classList.toggle('edge', on && Math.abs(d) > 52);
      if (on && mk.style) mk.style.left = 'calc(50% + ' + (Math.max(-52, Math.min(52, d)) * 2).toFixed(1) + 'px)';
    }
    if (ds) { ds.textContent = wp ? (wp.dist >= 1000 ? (wp.dist / 1000).toFixed(1) + ' km' : Math.round(wp.dist) + ' m') : ''; ds.classList.toggle('hidden', !wp); }
  }

  // 降下ボタン（バトルロイヤルの輸送ヘリ）
  setDrop(on, text) {
    if (!this.dropBtn) return;
    this.dropBtn.classList.toggle('hidden', !on);
    const sp = this.dropBtn.querySelector && this.dropBtn.querySelector('span');
    if (on && text && sp) sp.textContent = text;
  }

  // 結果画面: { win, title, rank, total, kills, time（秒）}。null で隠す。onAgain / onTitle はボタン
  //   オンライン（online: true）: list（[{ rank, name, kills, self }] 順位の一覧）と nextText（次のラウンドまで）。「もう一度」は出さない
  showResult(r, onAgain, onTitle) {
    const el = this.resultEl;
    if (!el) return;
    el.classList.toggle('hidden', !r);
    if (!r) {
      // 隠すときはボタンの関数も外す（関数はゲームを持つので、外さないと「もう一度」の後も前のゲームが次の結果まで残っていた）
      for (const sel of ['#btn-again', '#btn-title']) {
        const b = el.querySelector && el.querySelector(sel);
        if (b && b._rsBound) { if (b.removeEventListener) b.removeEventListener('click', b._rsBound); b._rsBound = null; }
      }
      return;
    }
    // 画面中央のお知らせは結果の下に残さない
    clearTimeout(this._msgTimer);
    if (this.message) this.message.classList.remove('show');
    el.classList.toggle('win', !!r.win);
    el.classList.toggle('online', !!r.online);
    const set = (sel, t) => { const n = el.querySelector && el.querySelector(sel); if (n) n.textContent = t; };
    const mm = Math.floor((r.time || 0) / 60), ss = Math.floor((r.time || 0) % 60);
    set('.rs-title', r.title || (r.win ? '優勝！' : 'やられた'));
    set('.rs-rank', '#' + r.rank + ' / ' + r.total);
    set('.rs-kills', String(r.kills | 0));
    set('.rs-time', mm + ':' + (ss < 10 ? '0' : '') + ss);
    set('.rs-by', r.by || '');
    set('.rs-next', r.nextText || '');
    const list = el.querySelector && el.querySelector('.rs-list');
    if (list) {
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      list.innerHTML = (r.list || []).slice(0, 8).map((x) => '<div class="rs-row' + (x.self ? ' self' : '') + '"><span class="rs-r">#' + (x.rank | 0) + '</span><span class="rs-n">' + esc(x.name) +
        '</span><span class="rs-k">撃破 ' + (x.kills | 0) + '</span></div>').join('');
      list.classList.toggle('hidden', !(r.list && r.list.length));
    }
    const bind = (sel, fn) => {
      const b = el.querySelector && el.querySelector(sel);
      if (!b || !b.addEventListener) return;
      if (b._rsBound) b.removeEventListener('click', b._rsBound);
      b._rsBound = (e) => { if (e && e.preventDefault) e.preventDefault(); if (fn) fn(); };
      b.addEventListener('click', b._rsBound);
    };
    bind('#btn-again', onAgain);
    bind('#btn-title', onTitle);
  }

  setDebug(text) {
    if (!this.debug) return;
    this.debug.textContent = text;
    this.debug.classList.toggle('hidden', !text);
  }
};
