// 街の遊び（フェーズ C3）: 落ちている物・持ち物・武器の 3 枠・回復・防具・敵の落とし物・ミニマップを game.js につなぐ。
// game.js が街（フリー / バトルロイヤル）のときだけ new MR.CityPlay(game) を作る（arena01 とオンラインは今まで通り）。
//
//   持ち物は MR.Loot.Inventory（loot.js）。開始はピストルだけ（game.json loot.start）。武器の Weapon は game.weapons（武器ごとに 1 つ）を
//   使い回し、枠の装填数（slots[i].ammo）を持ち替えのたびに Weapon.ammo と出し入れする（同じ武器を 2 つ持てる）。
//   予備の弾は口径ごと（Weapon.pool = 持ち物、Weapon.calibre）。リロードで減り、空なら装填できない（「弾がない」）。
//   切替: 切替ボタン / Q / ホイール = 次の空でない枠、1〜3 キー・枠のタップ = その枠。
//   拾う: 武器・防具は「拾う」ボタン（F キー）。半径 pickupRadius m・足元から上下 pickupHeight m・目から見える物のうち、
//     向いている方の近いもの。武器は空いた枠、無ければ今のメイン枠と入れ替えて古い方（装填数ごと）を足元に落とす。
//     弾・回復は歩いて重なれば上限まで自動で拾う（残りは置いたまま）。
//   回復: #btn-heal / H。足りない体力が包帯の量（heal.bandageBelow）以下で包帯があれば包帯、ほかは救急キット。time 秒の間
//     （歩きは moveScale 倍の速さ。走りは無い）撃つ・跳ぶ・乗る・梯子・泳ぐで中止。終わったら回復して 1 つ使う。
//   防具: 敵の弾は headChance で頭（enemyHeadMult 倍）、頭はヘルメット・体はベストが reduce の割合を肩代わり（耐久が減る）。
//     落下・安全地帯は素通し。
//   敵が死ぬと持っていた武器（装填済み）+ 口径の弾の箱 + 時々包帯を落とす（水の中では落とさない）。
//   フリーで死ぬと自分のメイン武器と弾を落とし、復活は開始の持ち物から。
// オンライン（フェーズ D2。game.online）: 落ちている物・持ち物はサーバーが持つ。ここは頼んで、知らせを当てるだけ:
//   拾う → pickup { id, n?, swap? }（拾っている間は「…」。サーバーの picked が自分なら持ち物に入れる、他の人なら「取られた」）。
//   弾・回復の自動で拾うのも pickup（1 つの物に 1.5 秒に 1 回まで）。回復 → heal { item }（サーバーの start で始まり、done で HP、
//   cancel で終わり。自分で止めたら heal { cancel }）。持ち物の数は inv（サーバーの数え。弾は装填数込みの合計なので、
//   装填数を引いた残りを予備にする。撃ってまだサーバーに届いていない分も引く）。防具の残りは damage の ar。
//   落とし物・地図の物が戻る・消える・最初から（loot add / back / gone / reset）もサーバーの知らせで。自分では落とさない・戻さない
window.MR = window.MR || {};

MR.CityPlay = class CityPlay {
  constructor(game) {
    this.game = game;
    const cfg = game.config;
    this.cfg = MR.Loot.config(cfg.loot);
    this.weaponDefs = {};
    for (const d of cfg.weapons) this.weaponDefs[d.id] = d;
    this.inv = new MR.Loot.Inventory(this.cfg, this.weaponDefs);
    this.loot = new MR.Loot.World(game.city, this.cfg, { weaponDefs: this.weaponDefs });
    const touch = !!(game.input && game.input.isTouchDevice);
    this.view = MR.LootView ? new MR.LootView(game.scene, { assets: game.assets, cfg: this.cfg, weaponDefs: this.weaponDefs,
      drawDist: touch ? (this.cfg.drawDistMobile || this.cfg.drawDist) : this.cfg.drawDist }) : null;
    for (const w of game.weapons) {
      w.pool = this.inv;
      w.calibre = this.inv.calOf(w.def.id);
      w.onNoAmmo = () => this._noAmmo();
    }
    this.heal = null;          // { type, t, T, sound }
    this.target = null;        // 拾える物（武器・防具）
    this._autoTimer = 0;
    this._msgAt = -10;
    this._qbuf = [];
    this.stats = { autoPicked: 0, picked: 0, swapped: 0, enemyDrops: 0, heals: 0, healCancels: 0, absorbed: 0, deathDrops: 0,
      pickupsSent: 0, pickupsLost: 0, invApplied: 0, healsSent: 0 };
    // オンライン: 頼んだ拾い物（id → { at, kind, ammo }）・撃った弾（サーバーに届く前の分を inv から引く）
    this.online = !!game.online;
    this._pending = new Map();
    this._shots = [];
    this.hud = game.hud;
    if (this.hud.setCity) this.hud.setCity(true);
    this._bindSlots();
    this._buildCompass();
    this.minimap = MR.Minimap ? new MR.Minimap(game, Object.assign({}, cfg.minimap || {})) : null;
    this.waypoint = null;      // { x, z }（全体の地図でタップ）
    this.lootChanged = 0;
    this.loot.onChange(() => { this.lootChanged++; });
  }

  // ---------- 武器の枠 ----------

  // 今の武器の装填数を枠へ書き戻す
  _syncSlotAmmo() {
    const s = this.inv.slots[this.inv.cur], w = this.game.weapon;
    if (s && w && w.def.id === s.id) s.ammo = w.ammo;
  }

  selectSlot(i, silent) {
    const g = this.game, inv = this.inv;
    if (!inv.slots[i]) return false;
    this._syncSlotAmmo();
    const sameSlot = i === inv.cur && g.weapon && g.weapon.def.id === inv.slots[i].id;
    inv.select(i);
    const id = inv.slots[i].id;
    const wi = g.weapons.findIndex((w) => w.def.id === id);
    if (wi < 0) return false;
    if (!sameSlot) g._selectWeapon(wi, silent);
    g.weapon.ammo = Math.min(inv.slots[i].ammo, g.weapon.def.magazineSize);
    g.weapon._notify();
    this.cancelHeal('swap');
    return true;
  }

  // 切替・数字キー・装填（game.js の _update から。死んでいないとき）
  weaponInput() {
    const g = this.game, input = g.input, inv = this.inv;
    if (input.consumeSwap()) { const n = inv.nextSlot(inv.cur); if (n >= 0 && n !== inv.cur) this.selectSlot(n); }
    const sel = input.consumeSelect ? input.consumeSelect() : -1;
    if (sel >= 0 && sel < 3 && sel !== inv.cur) {
      if (inv.slots[sel]) this.selectSlot(sel);
      else this._say(sel === 2 ? 'サブの枠は空です' : '枠が空です', 900);
    }
    if (input.consumeReload()) {
      const w = g.weapon;
      if (!w.startReload(g.time) && !w.reloading && w.reserve <= 0 && w.ammo < w.def.magazineSize) this._noAmmo(true);
    }
  }

  _noAmmo(force) {
    const g = this.game;
    if (!force && g.time - this._msgAt < 1.2) return;
    this._msgAt = g.time;
    const cal = this.inv.calOf(g.weapon.def.id), c = (this.cfg.calibres || {})[cal];
    g.hud.showMessage('弾がない' + (c ? '（' + c.name + '）' : ''), 1100);
  }

  _say(text, ms) { this.game.hud.showMessage(text, ms || 1100); }

  // 枠のタップ = その枠を選ぶ（タッチ端末）
  //   枠の要素は次のゲームでも同じなので、ゲームごとに付けて dispose で外す（前は 1 回だけ付けていて、最初の CityPlay = 最初のゲームが
  //   「もう一度」のあとも残り、タップも最初のゲームに届いていた）
  _bindSlots() {
    this._slotDom = this._slotDom || [];
    const el = this.hud.slotsEl;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    const cards = el.querySelectorAll('.slot');
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (!c.addEventListener) continue;
      const fn = (ev) => {
        if (!this.game.input.enabled) return;
        if (ev && ev.preventDefault) ev.preventDefault();
        this.game.input._select = i;
      };
      c.addEventListener('pointerdown', fn);
      this._slotDom.push([c, fn]);
    }
  }

  // ---------- 方位の帯（canvas に一度だけ描く）----------
  _buildCompass() {
    const el = this.hud.compass;
    if (!el || typeof document === 'undefined' || !document.createElement) return;
    const strip = el.querySelector && el.querySelector('.cmp-strip');
    if (!strip || !strip.appendChild) return;
    if (strip.firstChild && strip.firstChild.tagName === 'CANVAS') return; // 前のゲーム（「もう一度」）で描いたもの
    const c = document.createElement('canvas');
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    c.width = Math.round(2160 * dpr); c.height = Math.round(22 * dpr);
    if (c.style) { c.style.width = '2160px'; c.style.height = '22px'; }
    const g = c.getContext && c.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    g.textAlign = 'center';
    for (let d = -360; d <= 720; d += 5) {
      const x = (d + 360) * 2, a = ((d % 360) + 360) % 360;
      const major = a % 45 === 0;
      g.fillStyle = a === 0 ? 'rgba(255,120,110,0.95)' : 'rgba(232,238,244,' + (major ? 0.9 : 0.45) + ')';
      if (major) {
        g.font = (names[a].length === 1 ? '600 12px' : '500 10px') + ' sans-serif';
        g.fillText(names[a], x, 13);
      } else if (a % 15 === 0) {
        g.fillRect(x - 0.5, 9, 1, 7);
      } else g.fillRect(x - 0.5, 12, 1, 4);
    }
    strip.appendChild(c);
  }

  // ---------- 毎フレーム ----------

  // 乗り降りの前に（拾う・回復・地図の入力）
  preUpdate() {
    const g = this.game, input = g.input, p = g.player;
    if (input.consumeMap && input.consumeMap() && this.minimap) this.minimap.toggleFull();
    if (input.consumeHeal && input.consumeHeal()) {
      if (this.heal) this.cancelHeal('button'); else this.startHeal();
    }
    const want = input.consumePickup ? input.consumePickup() : false;
    if (want && this.target && !p.dead && !g.vehicle) {
      if (this.online) { if (this._requestPickup(this.target)) input._interact = false; } // サーバーに頼む（picked で入る）
      else if (this._pickup(this.target)) input._interact = false; // F は乗り降りも兼ねるので、拾えたら乗らない
    }
  }

  update(dt) {
    const g = this.game, p = g.player, nav = g.world.nav;
    if (this.online) { this.loot.time = g.time; this._expirePending(); } // 戻る・消えるはサーバーの知らせで
    else this.loot.update(g.time, p.pos.x, p.pos.z);
    this._syncSlotAmmo();
    // 敵の落とし物（どう死んでも 1 回だけ）
    if (!this.online) for (const e of g.enemies) if (e.dead && !e._lootDropped) { e._lootDropped = true; this._enemyDrop(e); }
    const walking = !p.dead && !g.vehicle && !g.freeCam && p.state === 'walk' && !(g.royale && g.royale.riding) && this.canLoot;
    // 自動で拾う（弾・回復。10 Hz）
    this._autoTimer -= dt;
    if (walking && p.grounded && this._autoTimer <= 0) { this._autoTimer = 0.1; if (this.online) this._autoPickupOnline(); else this._autoPickup(); }
    // 拾える物（武器・防具）
    this.target = walking ? this._findTarget(nav) : null;
    this._updatePrompt();
    this._updateHeal(dt);
    // 見た目
    if (this.view) {
      const cam = g.camera.getWorldPosition(this._cam || (this._cam = new THREE.Vector3()));
      this.view.update(dt, cam, this.loot, g.time);
    }
    this._updateHud();
    if (this.minimap) this.minimap.update(dt);
  }

  // ---------- 拾う ----------

  _autoPickup() {
    const p = this.game.player, inv = this.inv, R = this.cfg.autoRadius || 1.1;
    const list = this.loot.query(p.pos.x, p.pos.z, R, this._buf(), p.pos.y + 0.2, 1.0);
    let ammo = 0, med = 0;
    for (const it of list) {
      const kind = MR.Loot.kindOf(it.type);
      if (kind === 'ammo') {
        const cal = MR.Loot.ITEMS[it.type].cal;
        const room = inv.capOf(cal) - inv.ammoOf(cal);
        if (room <= 0) continue;
        const got = this.loot.take(it.id, 'player', Math.min(room, it.qty));
        if (got > 0) { inv.addAmmo(cal, got); ammo += got; this.stats.autoPicked++; this._toast('+' + got + ' ' + ((this.cfg.calibres[cal] || {}).name || cal)); }
      } else if (kind === 'med') {
        const room = inv.medCap(it.type) - (inv.meds[it.type] || 0);
        if (room <= 0) continue;
        const got = this.loot.take(it.id, 'player', Math.min(room, it.qty));
        if (got > 0) { inv.addMed(it.type, got); med += got; this.stats.autoPicked++; this._toast('+' + got + ' ' + MR.Loot.ITEMS[it.type].name); }
      }
    }
    const a = this.game.audio;
    if (ammo && a.play) a.play('pickup_ammo', { priority: 2 });
    if (med && a.play) a.play('pickup_med', { priority: 2 });
  }

  // 拾ったときの小さな知らせ（画面中央のメッセージを使う）
  _toast(text) { this.game.hud.showMessage(text, 800); }
  _buf() { this._qbuf.length = 0; return this._qbuf; }

  _findTarget(nav) {
    const g = this.game, p = g.player, inv = this.inv;
    const R = this.cfg.pickupRadius || 1.6, H = this.cfg.pickupHeight || 1.2;
    const list = this.loot.query(p.pos.x, p.pos.z, R, this._buf(), p.pos.y + 0.2, H);
    if (!list.length) return null;
    const fx = -Math.sin(p.yawAngle), fz = -Math.cos(p.yawAngle);
    const ey = p.pos.y + p.eyeHeight;
    let best = null, bs = Infinity;
    for (const it of list) {
      const kind = MR.Loot.kindOf(it.type);
      if (kind === 'armor') { if (!inv.wantsArmor(MR.Loot.ITEMS[it.type].slot, it.dur)) continue; }
      else if (kind !== 'weapon') continue;
      const dx = it.x - p.pos.x, dz = it.z - p.pos.z, d = Math.hypot(dx, dz);
      const cos = d > 0.05 ? (dx * fx + dz * fz) / d : 1;
      const score = d + (1 - cos) * 0.8;
      if (score >= bs) continue;
      if (nav && typeof nav.lineOfSight === 'function' && d > 0.3 && !nav.lineOfSight(p.pos.x, ey, p.pos.z, it.x, it.y + 0.25, it.z)) continue;
      best = it; bs = score;
    }
    return best;
  }

  _itemName(type) {
    const it = MR.Loot.ITEMS[type] || {};
    if (it.kind === 'weapon') return (this.weaponDefs[type] && this.weaponDefs[type].name) || type;
    return it.name || type;
  }

  _updatePrompt() {
    const t = this.target;
    if (!t) { this.hud.setPickup(null); return; }
    if (this.online && this._pending.has(t.id)) { this.hud.setPickup('拾っています…', ''); return; }
    let sub = '';
    if (MR.Loot.kindOf(t.type) === 'weapon') {
      const slot = this.inv.slotFor(t.type), old = this.inv.slots[slot];
      if (old) sub = '⇄ ' + this._itemName(old.id);
    }
    this.hud.setPickup('拾う：' + this._itemName(t.type), sub);
  }

  // 武器・防具を拾う。戻り値 true = 拾えた
  _pickup(it) {
    const g = this.game, inv = this.inv, kind = MR.Loot.kindOf(it.type);
    if (kind === 'weapon') {
      if (!this.loot.take(it.id, 'player')) return false;
      this._syncSlotAmmo();
      const res = inv.equip(it.type, it.ammo || 0);
      if (res.dropped) { this.loot.drop({ type: res.dropped.id, ammo: res.dropped.ammo }, this._dropSpot(g.player.pos, 0, 0.55)); this.stats.swapped++; }
      // 今の枠を入れ替えた（同じ武器でも装填数が変わる）・空き枠に入れた → その枠に持ち替える
      if (res.slot === inv.cur) { inv.cur = -1; }
      this.selectSlot(res.slot, true);
      this.stats.picked++;
      if (g.audio.play) g.audio.play('pickup_weapon', { priority: 2 });
      this._say(this._itemName(it.type), 900);
      return true;
    }
    if (kind === 'armor') {
      const slot = MR.Loot.ITEMS[it.type].slot;
      if (!this.loot.take(it.id, 'player')) return false;
      const old = inv.wear(slot, it.dur);
      if (old) this.loot.drop({ type: it.type, dur: old.dur }, this._dropSpot(g.player.pos, 1, 0.55));
      this.stats.picked++;
      if (g.audio.play) g.audio.play('pickup_med', { priority: 2, rate: 0.8 });
      this._say(this._itemName(it.type), 900);
      return true;
    }
    return false;
  }

  // 落とす場所: base の周り k 番目（ずらして重ならないように）。壁の外・床の上（水なら base のまま）
  _dropSpot(base, k, r0) {
    const nav = this.game.world.nav;
    const a = 0.8 + k * 2.4, r = (r0 == null ? 0.6 : r0) + 0.22 * k;
    let x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
    let y = base.y;
    const gy = nav.groundHeight(x, z, base.y + 0.6, 0.2);
    if (gy == null || Math.abs(gy - base.y) > 1.2) { x = base.x; z = base.z; }
    else y = gy;
    if (typeof nav.resolveCapsule === 'function') {
      const q = nav.resolveCapsule({ x, y, z }, 0.3, 1.0, 0.3, { snapDown: 0.6 });
      if (q && Math.abs(q.y - y) < 1.2) { x = q.x; z = q.z; y = q.y; }
    }
    return { x, y, z };
  }

  // ---------- 敵・自分の落とし物 ----------

  _enemyDrop(e) {
    const nav = this.game.world.nav;
    const w = nav.waterLevelAt ? nav.waterLevelAt(e.pos.x, e.pos.z) : null;
    if (w !== null && e.pos.y < w + 0.5) return; // 水に沈んだ
    const base = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    const gy = nav.groundHeight(base.x, base.z, base.y + 0.5, 0.2);
    if (gy != null) base.y = gy;
    const ed = this.cfg.enemyDrop || {};
    const id = (e.character && e.character.weaponId) || 'rifle';
    const def = this.weaponDefs[id];
    let k = 0;
    if (def) this.loot.drop({ type: id, ammo: def.magazineSize }, this._dropSpot(base, k++, 0.3));
    const cal = this.inv.calOf(id);
    const n = ed.ammoBoxes == null ? 1 : ed.ammoBoxes;
    for (let i = 0; i < n && cal; i++) this.loot.drop({ type: MR.Loot.ammoType(cal) }, this._dropSpot(base, k++, 0.3));
    if (Math.random() < (ed.bandageChance == null ? 0.4 : ed.bandageChance)) this.loot.drop({ type: 'bandage' }, this._dropSpot(base, k++, 0.3));
    if (Math.random() < (ed.medkitChance || 0)) this.loot.drop({ type: 'medkit' }, this._dropSpot(base, k++, 0.3));
    this.stats.enemyDrops++;
  }

  // 自分が死んだ（フリー）: メイン武器（装填数ごと）と、その口径の弾を少し落とす（オンラインはサーバーが落とす）
  onDeath() {
    this.cancelHeal('death');
    this._syncSlotAmmo();
    if (this.online) { this._pending.clear(); return; }
    if (this.cfg.deathDrop === false) return;
    const p = this.game.player, nav = this.game.world.nav;
    const w = nav.waterLevelAt ? nav.waterLevelAt(p.pos.x, p.pos.z) : null;
    if (w !== null && p.state === 'swim') return;
    const base = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    let k = 0;
    const cals = {};
    for (let i = 0; i < 2; i++) {
      const s = this.inv.slots[i];
      if (!s) continue;
      this.loot.drop({ type: s.id, ammo: s.ammo }, this._dropSpot(base, k++, 0.4));
      cals[this.inv.calOf(s.id)] = true;
    }
    for (const cal of Object.keys(cals)) {
      const have = this.inv.ammoOf(cal);
      if (have > 0) this.loot.drop({ type: MR.Loot.ammoType(cal), qty: have }, this._dropSpot(base, k++, 0.4));
    }
    this.stats.deathDrops++;
  }

  // 復活（フリー）: 開始の持ち物（オンラインはサーバーの spawn / inv の持ち物）
  onRespawn() {
    this.cancelHeal('respawn');
    if (this.online) return;
    this.inv.reset();
    const s = this.inv.firstSlot();
    if (s >= 0) { this.inv.cur = -1; this.selectSlot(s, true); }
  }

  // ---------- 回復 ----------

  // 使う物: 足りない体力が少なく包帯があれば包帯、ほかは救急キット（無ければもう片方）
  _healChoice() {
    const p = this.game.player, max = this.game.config.player.maxHealth, miss = max - p.health, m = this.inv.meds;
    const below = (this.cfg.heal && this.cfg.heal.bandageBelow) || 30;
    if (m.bandage > 0 && (miss <= below || !(m.medkit > 0))) return 'bandage';
    if (m.medkit > 0) return 'medkit';
    return null;
  }

  startHeal() {
    const g = this.game, p = g.player;
    if (this.heal || p.dead) return false;
    if (g.vehicle || p.state !== 'walk' || (g.royale && g.royale.riding) || (g.cityOnline && g.cityOnline.riding)) { this._say('今は使えません', 900); return false; }
    if (p.health >= g.config.player.maxHealth) { this._say('体力は満タンです', 900); return false; }
    const type = this._healChoice();
    if (!type) { this._say('回復アイテムがありません', 1000); return false; }
    const mc = (this.cfg.meds || {})[type] || {};
    this.heal = { type, t: 0, T: mc.time || 3, amount: mc.heal || 20 };
    // オンライン: サーバーに頼む（start で時間が決まり、done で HP が入る）
    if (this.online) { this.heal.pending = true; this.heal.sentAt = g.time; g.net.send({ t: 'heal', item: type }); this.stats.healsSent++; }
    if (g.audio.play) this.heal.sound = g.audio.play('heal', { priority: 2, channel: 'self' }) || null;
    p.speedScale = (this.cfg.heal && this.cfg.heal.moveScale) || 0.5;
    if (g.input) g.input.setAds(false);
    return true;
  }

  // why: 'server'（サーバーが中止した）/ 'death' / 'stop' 以外の理由で止めたときは、オンラインならサーバーにも中止を伝える
  cancelHeal(why) {
    const h = this.heal;
    if (!h) return;
    this.heal = null;
    this.game.player.speedScale = 1;
    if (h.sound && h.sound.stop) { try { h.sound.stop(0.1); } catch (e) { /* 鳴り終わり */ } }
    this.stats.healCancels++;
    this.lastCancel = why;
    if (this.online && why !== 'server' && why !== 'death' && why !== 'stop' && why !== 'done' && this.game.net) this.game.net.send({ t: 'heal', cancel: 1 });
    if (why === 'fire' || why === 'jump' || why === 'vehicle') this._say('回復を中止', 700);
  }

  _updateHeal(dt) {
    const g = this.game, p = g.player, h = this.heal;
    if (!h) return;
    if (p.dead) { this.cancelHeal('death'); return; }
    if (g.vehicle) { this.cancelHeal('vehicle'); return; }
    if (p.state !== 'walk') { this.cancelHeal('state'); return; }
    if (this.online) {
      // 進み具合はサーバーの終わりの時刻から。HP はサーバーの done で（ここでは足さない）
      if (h.pending) { h.t = Math.min(h.T * 0.98, h.t + dt); if (g.time - h.sentAt > 2.5) this.cancelHeal('timeout'); return; }
      const left = Math.max(0, (h.end - g.net.serverNow()) / 1000);
      h.t = Math.max(0, h.T - left);
      if (left <= 0 && g.net.serverNow() - h.end > 2500) this.cancelHeal('server'); // done が来なかった
      return;
    }
    h.t += dt; // 撃つと中止は game.js（撃つボタンを読むところ）
    if (h.t < h.T) return;
    this.heal = null;
    p.speedScale = 1;
    if (!this.inv.useMed(h.type)) return;
    const max = g.config.player.maxHealth;
    const before = p.health;
    p.health = Math.min(max, p.health + h.amount);
    g.hud.setHealth(p.health, max);
    if (h.type === 'bandage' && h.sound && h.sound.stop) { try { h.sound.stop(0.1); } catch (e) { /* 鳴り終わり */ } }
    this.stats.heals++;
    this.lastHeal = { type: h.type, from: before, to: p.health };
    this._say('+' + Math.round(p.health - before) + ' 回復', 900);
  }

  // プレイヤーの出来事（game._cityPlayerEvents から）: 跳んだら回復をやめる
  onPlayerEvent(e) {
    if (this.heal && (e.t === 'jump' || e.t === 'vault' || e.t === 'ladder' || e.t === 'splash')) this.cancelHeal('jump');
  }

  // ---------- 防具 ----------

  // ---------- オンライン（サーバーに頼む・知らせを当てる）----------

  // 拾ってよいか（バトロワのロビー・結果の間は拾えない）
  get canLoot() { const co = this.game.cityOnline; return !co || co.fighting; }

  // 落ちている物を作り直す（welcome・loot reset: 新しい seed。落とし物は消える）
  resetLoot(lseed) {
    this.loot = new MR.Loot.World(this.game.city, this.cfg, { weaponDefs: this.weaponDefs, seed: lseed != null ? lseed >>> 0 : undefined });
    this.loot.onChange(() => { this.lootChanged++; });
    this.lootChanged++;
    this._pending.clear();
    this.target = null;
    if (this.view) this.view._ver = -1;
  }

  // 拾ってとサーバーに頼む。武器の枠がいっぱいなら入れ替える武器と装填数（swap）も。n = 取る数（弾・回復）
  _requestPickup(it, n) {
    const g = this.game, kind = MR.Loot.kindOf(it.type);
    if (!it || this._pending.has(it.id) || !g.net || !this.canLoot) return false;
    // このフレームの前に他の人の picked が届いていた（狙っていた物はもう無い）: 送らずに「取られた」
    if (this.loot.isTaken(it.id)) { if (kind === 'weapon' || kind === 'armor') { this.stats.pickupsLost++; this._say('取られた', 900); } return false; }
    const m = { t: 'pickup', id: it.id };
    if (n != null) m.n = Math.max(1, Math.floor(n));
    if (kind === 'weapon') {
      this._syncSlotAmmo();
      const slot = this.inv.slotFor(it.type), old = this.inv.slots[slot];
      if (old) m.swap = { w: old.id, ammo: Math.max(0, old.ammo | 0) };
    }
    g.net.send(m);
    this._pending.set(it.id, { at: g.time, kind });
    this.stats.pickupsSent++;
    return true;
  }
  _expirePending() {
    const t = this.game.time;
    for (const [id, p] of this._pending) if (t - p.at > 1.5) this._pending.delete(id);
  }

  // 弾・回復: 足元の物を上限まで（頼むだけ。1 つの物に 1.5 秒に 1 回まで）
  _autoPickupOnline() {
    const p = this.game.player, inv = this.inv, R = this.cfg.autoRadius || 1.1;
    const list = this.loot.query(p.pos.x, p.pos.z, R, this._buf(), p.pos.y + 0.2, 1.0);
    for (const it of list) {
      if (this._pending.has(it.id)) continue;
      const kind = MR.Loot.kindOf(it.type);
      if (kind === 'ammo') {
        const cal = MR.Loot.ITEMS[it.type].cal;
        const room = inv.capOf(cal) - inv.ammoOf(cal);
        if (room > 0) this._requestPickup(it, Math.min(room, it.qty));
      } else if (kind === 'med') {
        const room = inv.medCap(it.type) - (inv.meds[it.type] || 0);
        if (room > 0) this._requestPickup(it, Math.min(room, it.qty));
      }
    }
  }

  // picked（全員に来る）: 物の残りを当て、自分が拾ったなら持ち物に入れる（数は後の inv で合わせる）。他の人なら「取られた」
  onPicked(m) {
    const g = this.game, me = g.net ? g.net.id : -1;
    const it = this.loot.get(m.id);
    const snap = it ? { type: it.type, ammo: it.ammo, dur: it.dur } : null;
    const pend = this._pending.get(m.id);
    this._pending.delete(m.id);
    const left = typeof m.left === 'number' ? m.left : 0;
    this.loot.setRemoteState(m.id, !(left > 0), left > 0 ? left : null);
    if (m.by !== me) {
      if (pend) { this.stats.pickupsLost++; this._say('取られた', 900); }
      return;
    }
    if (!snap) return;
    const kind = MR.Loot.kindOf(snap.type), a = g.audio;
    if (kind === 'weapon') {
      this._syncSlotAmmo();
      const res = this.inv.equip(snap.type, snap.ammo || 0); // 入れ替えた古い武器はサーバーが足元に落とす（loot add）
      if (res.dropped) this.stats.swapped++;
      if (res.slot === this.inv.cur) this.inv.cur = -1;
      this.selectSlot(res.slot, true);
      this.stats.picked++;
      if (a.play) a.play('pickup_weapon', { priority: 2 });
      this._say(this._itemName(snap.type), 900);
    } else if (kind === 'armor') {
      this.inv.wear(MR.Loot.ITEMS[snap.type].slot, snap.dur);
      this.stats.picked++;
      if (a.play) a.play('pickup_med', { priority: 2, rate: 0.8 });
      this._say(this._itemName(snap.type), 900);
    } else if (kind === 'ammo') {
      const cal = MR.Loot.ITEMS[snap.type].cal;
      const got = this.inv.addAmmo(cal, m.n | 0);
      this.stats.autoPicked++;
      if (a.play) a.play('pickup_ammo', { priority: 2 });
      this._toast('+' + (got || m.n) + ' ' + ((this.cfg.calibres[cal] || {}).name || cal));
    } else if (kind === 'med') {
      this.inv.addMed(snap.type, m.n | 0);
      this.stats.autoPicked++;
      if (a.play) a.play('pickup_med', { priority: 2 });
      this._toast('+' + (m.n | 0) + ' ' + MR.Loot.ITEMS[snap.type].name);
    }
  }

  // loot（落とし物・戻る・消える・最初から）
  onLootMsg(m) {
    if (m.reset) { this.resetLoot(m.lseed); return; }
    if (Array.isArray(m.add)) for (const d of m.add) this.loot.putDrop(d);
    if (Array.isArray(m.gone)) for (const id of m.gone) { this.loot.removeDrop(id); this._pending.delete(id); }
    if (Array.isArray(m.back)) for (const id of m.back) this.loot.restore(id);
  }

  // 撃った（game.js）: サーバーに届く前の分を inv の弾の数から引くために覚える
  noteShot(weaponId) {
    const cal = this.inv.calOf(weaponId);
    if (!cal) return;
    this._shots.push({ t: this.game.time, cal });
    if (this._shots.length > 96) this._shots.shift();
  }
  _inflight() {
    const g = this.game, out = {};
    const win = (((g.net && g.net.rtt) || 80) + 1000 / 15 + 40) / 1000;
    for (const s of this._shots) if (g.time - s.t <= win) out[s.cal] = (out[s.cal] || 0) + 1;
    return out;
  }

  // サーバーの持ち物（inv / welcome / spawn）: 武器の枠・弾（口径ごとの合計 = 装填数 + 予備）・回復・防具をそのまま。
  // fresh: 枠を最初から作り直す（復活・ラウンドの始まり）。今持っている武器が無くなったら最初の枠に持ち替える
  applyServerInv(sinv, _unused, fresh) {
    if (!sinv) return;
    const g = this.game, inv = this.inv, L = MR.Loot, cfg = this.cfg;
    this._syncSlotAmmo();
    const curId = inv.slots[inv.cur] ? inv.slots[inv.cur].id : null;
    const want = (Array.isArray(sinv.w) ? sinv.w : []).filter((w) => !!this.weaponDefs[w]);
    const slots = [null, null, null];
    const keep = [];
    if (!fresh) {
      for (let i = 0; i < 3; i++) {
        const s = inv.slots[i];
        if (!s) continue;
        const k = want.indexOf(s.id);
        if (k < 0 || (i === 2) !== L.isSidearm(cfg, s.id)) continue;
        slots[i] = { id: s.id, ammo: s.ammo };
        want.splice(k, 1);
        keep.push(i);
      }
    }
    const fresh0 = [];
    for (const id of want) {
      let i = L.isSidearm(cfg, id) ? 2 : (!slots[0] ? 0 : (!slots[1] ? 1 : -1));
      if (i < 0 || slots[i]) { i = -1; for (const k of [0, 1, 2]) if (!slots[k]) { i = k; break; } }
      if (i < 0) break;
      slots[i] = { id, ammo: 0 };
      fresh0.push(i);
    }
    // 弾: サーバーの合計から、まだ届いていない撃った分を引き、今の枠（装填数）→ 残りの枠 → 新しい枠（満タンまで）の順に配る。残りが予備
    const inflight = fresh ? {} : this._inflight();
    const avail = {};
    for (const cal of Object.keys(cfg.calibres || {})) avail[cal] = 0;
    for (const cal of Object.keys(sinv.ammo || {})) avail[cal] = Math.max(0, (sinv.ammo[cal] | 0) - (inflight[cal] || 0));
    const order = keep.slice().sort((a, b) => (a === inv.cur ? -1 : b === inv.cur ? 1 : a - b)).concat(fresh0);
    for (const i of order) {
      const s = slots[i], cal = inv.calOf(s.id), mag = (this.weaponDefs[s.id] || {}).magazineSize | 0;
      const wantN = fresh0.indexOf(i) >= 0 ? mag : Math.min(mag, s.ammo | 0);
      const n = cal ? Math.max(0, Math.min(wantN, avail[cal] || 0)) : 0;
      s.ammo = n;
      if (cal) avail[cal] -= n;
    }
    inv.slots = slots;
    inv.ammo = avail;
    inv.meds = { medkit: Math.max(0, (sinv.meds || {}).medkit | 0), bandage: Math.max(0, (sinv.meds || {}).bandage | 0) };
    this.setArmor(sinv.vest, sinv.helmet);
    inv.version = (inv.version || 0) + 1;
    this.stats.invApplied++;
    // 持っている武器: 同じ枠に同じ武器が残っていれば装填数だけ、無ければ最初の枠へ
    if (inv.cur >= 0 && slots[inv.cur] && slots[inv.cur].id === curId && g.weapon && g.weapon.def.id === curId) {
      if (g.weapon.ammo !== slots[inv.cur].ammo) { g.weapon.ammo = slots[inv.cur].ammo; g.weapon._notify(); }
    } else {
      const f = slots[inv.cur] ? inv.cur : inv.firstSlot();
      if (f >= 0) { inv.cur = -1; this.selectSlot(f, true); }
    }
  }

  // 防具の残り（サーバーの damage の ar / inv）。0 = 無し
  setArmor(vest, helmet) {
    const inv = this.inv;
    inv.vest = vest > 0 ? { dur: vest, max: inv.armorMax('vest') } : null;
    inv.helmet = helmet > 0 ? { dur: helmet, max: inv.armorMax('helmet') } : null;
  }

  // heal（サーバー）: start（end = 終わるサーバー時刻）/ cancel（自分だけ）/ done（hp。全員に来る）
  onHealMsg(m) {
    const g = this.game, me = g.net ? g.net.id : -1;
    if (m.id !== me) return;
    const mc = (this.cfg.meds || {})[m.item] || {};
    if (m.st === 'start') {
      if (!this.heal || this.heal.type !== m.item) {
        if (this.heal) this.cancelHeal('server');
        this.heal = { type: m.item, t: 0, T: mc.time || 3, amount: mc.heal || 20 };
        g.player.speedScale = (this.cfg.heal && this.cfg.heal.moveScale) || 0.5;
      }
      this.heal.pending = false;
      this.heal.end = typeof m.end === 'number' ? m.end : g.net.serverNow() + this.heal.T * 1000;
    } else if (m.st === 'cancel') {
      if (this.heal) this.cancelHeal('server');
    } else if (m.st === 'done') {
      const h = this.heal, max = g.config.player.maxHealth, before = g.player.health;
      if (typeof m.hp === 'number' && !g.player.dead) { g.player.health = Math.min(max, m.hp); g.hud.setHealth(g.player.health, max); }
      if (h) {
        this.heal = null;
        g.player.speedScale = 1;
        if (h.type === 'bandage' && h.sound && h.sound.stop) { try { h.sound.stop(0.1); } catch (e) { /* 鳴り終わり */ } }
      }
      this.stats.heals++;
      this.lastHeal = { type: m.item, from: before, to: g.player.health };
      this._say('+' + Math.max(0, Math.round(g.player.health - before)) + ' 回復', 900);
    }
  }

  // 被弾（game._playerHit から）。opts: { kind: 'bullet' | 'explosion' | 'fall' | 'zone' …, head }。戻り値 = 体に入るダメージ
  absorb(damage, opts) {
    const kind = opts && opts.kind;
    const head = !!(opts && opts.head);
    const out = this.inv.absorb(damage, kind, head);
    if (out < damage) this.stats.absorbed += damage - out;
    return out;
  }

  // ---------- HUD ----------

  _updateHud() {
    const g = this.game, inv = this.inv, w = g.weapon;
    const slots = [];
    for (let i = 0; i < 3; i++) {
      const s = inv.slots[i];
      if (!s) { slots.push(null); continue; }
      const def = this.weaponDefs[s.id] || {};
      const active = i === inv.cur;
      const cal = inv.calOf(s.id);
      slots.push({ id: s.id, name: def.name, short: (this.cfg.shortNames || {})[s.id] || def.name, ammo: active && w ? w.ammo : s.ammo, mag: def.magazineSize,
        reserve: inv.ammoOf(cal), cal, active, reloading: active && w ? w.reloading : false });
    }
    this.hud.setSlots(slots);
    this.hud.setArmor({ vest: inv.vest ? inv.vest.dur / inv.vest.max : null, helmet: inv.helmet ? inv.helmet.dur / inv.helmet.max : null });
    const h = this.heal;
    this.hud.setHeal({ medkit: inv.meds.medkit || 0, bandage: inv.meds.bandage || 0, active: h ? h.type : null, progress: h ? Math.min(1, h.t / h.T) : 0, left: h ? h.T - h.t : 0 });
    // 方位: 北 = 0、時計回り。目印は全体の地図でタップした所
    const p = g.player;
    let wp = null;
    if (this.waypoint) {
      const dx = this.waypoint.x - p.pos.x, dz = this.waypoint.z - p.pos.z;
      wp = { bearing: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360, dist: Math.hypot(dx, dz) };
    }
    this.hud.setCompass(-p.yawAngle * 180 / Math.PI, wp);
  }

  // 目印（全体の地図から）
  setWaypoint(x, z) { this.waypoint = (x == null) ? null : { x, z }; }

  dispose() {
    this.cancelHeal('stop');
    for (const [c, fn] of this._slotDom || []) { if (c.removeEventListener) c.removeEventListener('pointerdown', fn); }
    this._slotDom = [];
    if (this.view) this.view.dispose();
    if (this.minimap) this.minimap.dispose();
    const h = this.hud;
    if (h.setPickup) h.setPickup(null);
    if (h.setHeal) h.setHeal({ medkit: 0, bandage: 0, active: null, progress: 0, left: 0 });
    if (h.setCity) h.setCity(false);
  }
};
