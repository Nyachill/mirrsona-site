// 入力。スマホは Pointer Events（マルチタッチ対応）、PC はキーボード + マウス（ポインタロック）。
//   左側ゾーン: タッチした場所にスティックが出る（フローティング）
//   右側ゾーン: スワイプで視点
//   ボタン: 撃つ / ジャンプ / リロード / 切替 / 照準（ADS。タッチはトグル、PC は右クリック押しっぱなし）
//   ヘリ: ジャンプ = 上昇（押している間 jumpHeld）、#btn-descend = 下降（押している間 descendHeld。キーは C / Ctrl）、
//         #btn-camera = 視点の切替（consumeCamera。キー V）、#btn-seat = 座席を移る（consumeSeat。キー X）
//   街: #btn-pickup = 拾う（consumePickup。キー F。F は今まで通り乗り降りも兼ねる: 拾えた物があれば game がそちらを優先）、
//       #btn-heal = 回復（consumeHeal。キー H）、全体の地図（consumeMap。キー M。ミニマップのタップは minimap.js）、
//       #btn-drop = 降下（バトルロイヤルの輸送ヘリ。consumeDrop。キーはジャンプと同じ Space）
//   戦闘機: #btn-gear = 脚（consumeGear。キー G）、#btn-eject = 脱出（consumeEject。キー Ctrl+E。E だけなら今まで通り乗り降り）、
//         #btn-missile = ミサイル（consumeMissile。キー F。F の乗り降りは game が戦闘機の操縦席では使わない: interactKey）、
//         #btn-flare = フレア（consumeFlare。キー X）、#btn-launch = 発艦（consumeLaunch。キー T。空母の甲板で自動でカタパルトへ）。
//         機関砲は撃つボタン / マウス / Space（jumpHeld）。
//         かんたん操作: #btn-boost = 加速（押している間 boostHeld。キー Shift）、#btn-slow = 減速（slowHeld。キー C / Ctrl）、
//         #btn-land = 着艦・着陸（consumeLand。キー L。空中で自動着艦・もう一度で取り消し）、#btn-settings = 設定（consumeSettings。キー P）
window.MR = window.MR || {};

MR.Input = class Input {
  constructor(els) {
    this.els = els;                 // { canvas, stickZone, stick, knob, lookPad, fire, fireLeft?, jump, reload, swap, ads?, vehicle?, descend?, camera?, seat?, pickup?, heal?, drop?, gear?, eject?, missile?, flare?, launch?, land?, boost?, slow?, settings? }
    this.move = { x: 0, y: 0 };
    this.fireHeld = false;
    this._firePress = false;
    this._jump = false;
    this._reload = false;
    this._swap = false;
    this._select = -1;              // 数字キーで武器を直接選ぶ（0 始まり。-1 = 無し）
    this._interact = false;         // 乗り物に乗る／降りる（E キー / #btn-vehicle）
    this._jumpTouch = false;        // ジャンプボタンを押している（ヘリの上昇）
    this._descendTouch = false;     // 下降ボタンを押している（ヘリ）
    this._camera = false;           // 視点の切替（V / #btn-camera）
    this._seat = false;             // 座席を移る（X / #btn-seat）
    this._pickup = false;           // 拾う（F / #btn-pickup）
    this._heal = false;             // 回復（H / #btn-heal）
    this._map = false;              // 全体の地図（M）
    this._drop = false;             // 降下（#btn-drop）
    this._specNext = false;         // 観戦: 次の人（#btn-spec-next）
    this._gear = false;             // 戦闘機: 脚（G / #btn-gear）
    this._eject = false;            // 戦闘機: 脱出（Ctrl+E / #btn-eject）
    this._missile = false;          // 戦闘機: ミサイル（F / #btn-missile。フェーズ E2）
    this._flare = false;            // 戦闘機・ヘリ: フレア（X / #btn-flare。フェーズ E2）
    this._launch = false;           // 戦闘機: 発艦（T / #btn-launch。空母の甲板で自動でカタパルトへ → 射出）
    this._land = false;             // 戦闘機: 着艦・着陸（L / #btn-land。自動着艦の開始・取り消し）
    this._boostTouch = false;       // 戦闘機（かんたん）: 加速ボタンを押している
    this._slowTouch = false;        // 戦闘機（かんたん）: 減速ボタンを押している
    this._settings = false;         // 設定（P / #btn-settings）
    this.interactKey = '';          // 最後の乗り降りの入力（'KeyE' / 'KeyF' / 'button'）
    this.adsHeld = false;           // 照準中か（#btn-ads のトグル状態 or マウス右ボタン）
    this._adsToggled = false;
    this.lookScale = 1;             // 視点移動量の倍率（ADS 中に Game が def.ads.sensitivity を入れる）
    this.fireDragLook = true;       // 撃つボタンを押したまま指を動かすと視点が動く（Game が config.controls.fireDragLook で設定）
    this._firePointers = {};        // 撃つボタンを押している指: pointerId -> { x, y }
    this._look = { x: 0, y: 0 };
    this.stickRadius = 55;          // CSS px
    this.stickPointer = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.lookPointer = null;
    this.lookLast = { x: 0, y: 0 };
    this.keys = {};
    this.pointerLocked = false;
    this.isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.enabled = false;
    this._bind();
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.reset(); }

  reset() {
    this.move.x = 0; this.move.y = 0;
    this.fireHeld = false; this._firePress = false; this._firePointers = {};
    this._jump = false; this._reload = false; this._swap = false; this._select = -1; this._interact = false;
    this._jumpTouch = false; this._descendTouch = false; this._camera = false; this._seat = false;
    this._pickup = false; this._heal = false; this._map = false; this._drop = false; this._specNext = false;
    this._gear = false; this._eject = false; this._missile = false; this._flare = false; this._launch = false;
    this._land = false; this._boostTouch = false; this._slowTouch = false; this._settings = false;
    this._look.x = 0; this._look.y = 0;
    this.stickPointer = null; this.lookPointer = null;
    this.keys = {};
    this._setAds(false);
    this._adsToggled = false;
    this._placeStick(null);
  }

  // 視点移動量（px × lookScale）を取り出してゼロに戻す
  consumeLook() {
    const s = this.lookScale;
    const d = { x: this._look.x * s, y: this._look.y * s };
    this._look.x = 0; this._look.y = 0;
    return d;
  }
  // 消費せずに今フレームの視点移動量を見る（銃のスウェイ用）
  peekLook() { const s = this.lookScale; return { x: this._look.x * s, y: this._look.y * s }; }
  consumeFirePress() { const v = this._firePress; this._firePress = false; return v; }
  consumeJump() { const v = this._jump; this._jump = false; return v; }
  consumeReload() { const v = this._reload; this._reload = false; return v; }
  consumeSwap() { const v = this._swap; this._swap = false; return v; }
  consumeSelect() { const v = this._select; this._select = -1; return v; }
  // 乗り物の乗り降り（押した瞬間だけ true）
  consumeInteract() { const v = this._interact; this._interact = false; return v; }
  // ヘリ: 視点の切替・座席を移る（押した瞬間だけ true）、上昇・下降（押している間 true）
  consumeCamera() { const v = this._camera; this._camera = false; return v; }
  consumeSeat() { const v = this._seat; this._seat = false; return v; }
  // 街: 拾う・回復・全体の地図・降下（押した瞬間だけ true）
  consumePickup() { const v = this._pickup; this._pickup = false; return v; }
  consumeHeal() { const v = this._heal; this._heal = false; return v; }
  consumeMap() { const v = this._map; this._map = false; return v; }
  consumeDrop() { const v = this._drop; this._drop = false; return v; }
  consumeSpectate() { const v = this._specNext; this._specNext = false; return v; }
  // 戦闘機: 脚・脱出・ミサイル・フレア（押した瞬間だけ true）
  consumeGear() { const v = this._gear; this._gear = false; return v; }
  consumeEject() { const v = this._eject; this._eject = false; return v; }
  consumeMissile() { const v = this._missile; this._missile = false; return v; }
  consumeFlare() { const v = this._flare; this._flare = false; return v; }
  consumeLaunch() { const v = this._launch; this._launch = false; return v; }
  consumeLand() { const v = this._land; this._land = false; return v; }
  consumeSettings() { const v = this._settings; this._settings = false; return v; }
  get boostHeld() { return this._boostTouch || !!(this.keys.ShiftLeft || this.keys.ShiftRight); }
  get slowHeld() { return this._slowTouch || !!(this.keys.KeyC || this.keys.ControlLeft || this.keys.ControlRight); }
  get jumpHeld() { return this._jumpTouch || !!this.keys.Space; }
  get descendHeld() { return this._descendTouch || !!(this.keys.KeyC || this.keys.ControlLeft || this.keys.ControlRight); }
  // ADS の状態が前回の呼び出しから変わっていれば true（音を鳴らす等に使う）
  consumeAdsToggle() { const v = this._adsToggled; this._adsToggled = false; return v; }
  // ADS をプログラムから設定（死亡時に解く等）
  setAds(on) { this._setAds(on); }

  _setAds(on) {
    on = !!on;
    if (on !== this.adsHeld) { this.adsHeld = on; this._adsToggled = true; }
    const el = this.els && this.els.ads;
    if (el && el.classList) el.classList.toggle('pressed', on);
  }

  // ---------- 内部 ----------

  _bind() {
    const e = this.els;
    const opt = { passive: false };

    // スクロール・ズーム・長押しメニューを殺す
    document.addEventListener('touchmove', (ev) => { if (this.enabled) ev.preventDefault(); }, opt);
    document.addEventListener('gesturestart', (ev) => ev.preventDefault(), opt);
    document.addEventListener('contextmenu', (ev) => { if (this.enabled) ev.preventDefault(); });
    document.addEventListener('dblclick', (ev) => { if (this.enabled) ev.preventDefault(); }, opt);

    // --- スティック ---
    e.stickZone.addEventListener('pointerdown', (ev) => {
      if (!this.enabled || this.stickPointer !== null || ev.pointerType === 'mouse') return;
      ev.preventDefault();
      this.stickPointer = ev.pointerId;
      try { e.stickZone.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      this.stickOrigin = this._clampStickOrigin(ev.clientX, ev.clientY);
      this._placeStick(this.stickOrigin);
      this._updateStick(ev.clientX, ev.clientY);
    });
    e.stickZone.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== this.stickPointer) return;
      ev.preventDefault();
      this._updateStick(ev.clientX, ev.clientY);
    });
    const stickEnd = (ev) => {
      if (ev.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.move.x = 0; this.move.y = 0;
      this._placeStick(null);
    };
    e.stickZone.addEventListener('pointerup', stickEnd);
    e.stickZone.addEventListener('pointercancel', stickEnd);

    // --- 視点パッド ---
    e.lookPad.addEventListener('pointerdown', (ev) => {
      if (!this.enabled || this.lookPointer !== null || ev.pointerType === 'mouse') return;
      ev.preventDefault();
      this.lookPointer = ev.pointerId;
      try { e.lookPad.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      this.lookLast.x = ev.clientX; this.lookLast.y = ev.clientY;
    });
    e.lookPad.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== this.lookPointer) return;
      ev.preventDefault();
      this._look.x += ev.clientX - this.lookLast.x;
      this._look.y += ev.clientY - this.lookLast.y;
      this.lookLast.x = ev.clientX; this.lookLast.y = ev.clientY;
    });
    const lookEnd = (ev) => { if (ev.pointerId === this.lookPointer) this.lookPointer = null; };
    e.lookPad.addEventListener('pointerup', lookEnd);
    e.lookPad.addEventListener('pointercancel', lookEnd);

    // --- ボタン ---
    // 撃つボタン（右、左にもう 1 つ置ける）。押したまま指を動かすと視点が動くので、連射しながら狙いを変えられる。
    // 2 本の指で両方押しているときは、片方を離しても撃ち続ける
    this._fireButton(e.fire);
    this._fireButton(e.fireLeft);
    this._holdButton(e.jump, () => { this._jump = true; this._jumpTouch = true; }, () => { this._jumpTouch = false; });
    this._holdButton(e.descend, () => { this._descendTouch = true; }, () => { this._descendTouch = false; });
    this._holdButton(e.camera, () => { this._camera = true; });
    this._holdButton(e.seat, () => { this._seat = true; });
    this._holdButton(e.reload, () => { this._reload = true; });
    this._holdButton(e.swap, () => { this._swap = true; });
    this._holdButton(e.vehicle, () => { this._interact = true; this.interactKey = 'button'; });
    this._holdButton(e.gear, () => { this._gear = true; });
    this._holdButton(e.eject, () => { this._eject = true; });
    this._holdButton(e.missile, () => { this._missile = true; });
    this._holdButton(e.flare, () => { this._flare = true; });
    this._holdButton(e.launch, () => { this._launch = true; });
    this._holdButton(e.land, () => { this._land = true; });
    this._holdButton(e.boost, () => { this._boostTouch = true; }, () => { this._boostTouch = false; });
    this._holdButton(e.slow, () => { this._slowTouch = true; }, () => { this._slowTouch = false; });
    this._holdButton(e.settings, () => { this._settings = true; });
    this._holdButton(e.pickup, () => { this._pickup = true; });
    this._holdButton(e.heal, () => { this._heal = true; });
    this._holdButton(e.drop, () => { this._drop = true; });
    this._holdButton(e.spec, () => { this._specNext = true; });
    // 照準はトグル（押すたびに切替。pressed クラスは状態を表す）
    if (e.ads) {
      e.ads.addEventListener('pointerdown', (ev) => {
        if (!this.enabled) return;
        ev.preventDefault();
        this._setAds(!this.adsHeld);
      });
    }

    // --- PC: キーボード ---
    window.addEventListener('keydown', (ev) => {
      if (!this.enabled) return;
      if (ev.repeat) return;
      this.keys[ev.code] = true;
      if (ev.code === 'Space') { this._jump = true; ev.preventDefault(); }
      if (ev.code === 'KeyR') this._reload = true;
      if (ev.code === 'KeyQ') this._swap = true;
      if (ev.code === 'KeyE' && (ev.ctrlKey || ev.metaKey)) { this._eject = true; ev.preventDefault(); }
      else if (ev.code === 'KeyE' || ev.code === 'KeyF') { this._interact = true; this.interactKey = ev.code; }
      if (ev.code === 'KeyF') { this._pickup = true; this._missile = true; }
      if (ev.code === 'KeyG') this._gear = true;
      if (ev.code === 'KeyT') this._launch = true;
      if (ev.code === 'KeyL') this._land = true;
      if (ev.code === 'KeyP') this._settings = true;
      if (ev.code === 'KeyX') this._flare = true;
      if (ev.code === 'KeyH') this._heal = true;
      if (ev.code === 'KeyM') this._map = true;
      if (ev.code === 'KeyV') this._camera = true;
      if (ev.code === 'KeyX') this._seat = true;
      if (ev.code === 'ControlLeft' || ev.code === 'ControlRight') ev.preventDefault();
      const digit = /^Digit([1-9])$/.exec(ev.code);
      if (digit) this._select = Number(digit[1]) - 1;
    });
    window.addEventListener('keyup', (ev) => { this.keys[ev.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.fireHeld = false; this._setAds(false); });

    // --- PC: マウス（ポインタロック） ---
    e.canvas.addEventListener('mousedown', (ev) => {
      if (!this.enabled || this.isTouchDevice) return;
      if (!this.pointerLocked) {
        if (e.canvas.requestPointerLock) e.canvas.requestPointerLock();
        return;
      }
      if (ev.button === 0) { this.fireHeld = true; this._firePress = true; }
      if (ev.button === 2) this._setAds(true);   // 右ボタン押しっぱなしで照準
    });
    window.addEventListener('mouseup', (ev) => {
      if (ev.button === 0) this.fireHeld = false;
      if (ev.button === 2 && !this.isTouchDevice) this._setAds(false);
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === e.canvas;
      if (!this.pointerLocked) { this.fireHeld = false; this._setAds(false); }
    });
    document.addEventListener('mousemove', (ev) => {
      if (!this.pointerLocked) return;
      this._look.x += ev.movementX;
      this._look.y += ev.movementY;
    });
    window.addEventListener('wheel', (ev) => { if (this.enabled && this.pointerLocked) this._swap = true; }, { passive: true });
  }

  _holdButton(el, onDown, onUp) {
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      if (!this.enabled) return;
      ev.preventDefault();
      try { el.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      el.classList.add('pressed');
      onDown();
    });
    const up = (ev) => {
      el.classList.remove('pressed');
      if (onUp) onUp();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  _fireButton(el) {
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      if (!this.enabled) return;
      ev.preventDefault();
      try { el.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      el.classList.add('pressed');
      this._firePointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      this.fireHeld = true;
      this._firePress = true;
    });
    el.addEventListener('pointermove', (ev) => {
      const p = this._firePointers[ev.pointerId];
      if (!p) return;
      ev.preventDefault();
      if (this.fireDragLook) {
        this._look.x += ev.clientX - p.x;
        this._look.y += ev.clientY - p.y;
      }
      p.x = ev.clientX; p.y = ev.clientY;
    });
    const up = (ev) => {
      if (!this._firePointers[ev.pointerId]) return;
      delete this._firePointers[ev.pointerId];
      el.classList.remove('pressed');
      if (!Object.keys(this._firePointers).length) this.fireHeld = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  _clampStickOrigin(x, y) {
    const zone = this.els.stickZone.getBoundingClientRect();
    const r = this.stickRadius + 10;
    return {
      x: Math.max(zone.left + r, Math.min(zone.right - r, x)),
      y: Math.max(zone.top + r, Math.min(zone.bottom - r, y))
    };
  }

  _placeStick(origin) {
    const s = this.els.stick;
    if (!origin) {
      s.classList.remove('active');
      s.style.left = '';
      s.style.top = '';
      this.els.knob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    s.classList.add('active');
    const half = s.offsetWidth / 2 || 56;
    s.style.left = (origin.x - half) + 'px';
    s.style.top = (origin.y - half) + 'px';
  }

  _updateStick(x, y) {
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const r = this.stickRadius;
    if (len > r) { dx = dx / len * r; dy = dy / len * r; }
    this.els.knob.style.transform = 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px))';
    let mx = dx / r, my = -dy / r;
    const mag = Math.hypot(mx, my);
    if (mag < 0.12) { mx = 0; my = 0; }
    this.move.x = mx; this.move.y = my;
  }

  // キーボードぶんを足した移動ベクトル
  getMove() {
    let x = this.move.x, y = this.move.y;
    const k = this.keys;
    if (k.KeyW || k.ArrowUp) y += 1;
    if (k.KeyS || k.ArrowDown) y -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }
};
