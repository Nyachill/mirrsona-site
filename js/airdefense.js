// 対空の見張り（MR.AirDefense。E2.3 = MANPADS の陣地。ソロの街：フリーとバトルロイヤルだけ。オンライン・アリーナには無い）。
//   THREE を使わない（game の口だけ使う: game._jetRay・game.missiles.fire・game.airCombat.spike・game.fx・game.audio）。
//   陣地: ホットゾーン（空母は除く）の周り siteRadius m の建物の屋上（区画の一番上の段 = HeliCollider に入る段と同じ。上面が roofMin〜roofMax m・
//     面積 minArea m² 以上・上に何も無い）から sites 個を街の seed で決める（どの端末でも同じ。ゾーンを並べ替えて 1 つずつ、陣地どうしは minSpacing m 以上）。
//     レベルに airDefense.sites: [[x, z], …] があればそれ（高さは HeliCollider の面）。
//   状態: idle → track（見つけた。RWR の探知 = spike 'search'。reaction 秒の間）→ lock（lockTime 秒。spike 'lock'）→ launch（chance で撃つ。
//     game.missiles.fire({ type: 'manpads', target, owner: site })・spike 'launch'・後方噴射の煙・aa_fire）→ cooldown（cooldown 秒）→ idle。
//     撃った陣地は revealSec 秒ミニマップ / 全体の地図に赤く出て、戦闘機のロックの目標になる（lockables）。爆発が killRadius m 以内・機関砲 gunHits 発で
//     respawn 秒黙る（dead）。
//   見る: 陣地ごとに checkHz 回/秒（順番に。1 フレームの視線のレイは 1 本まで = game._jetRay、結果の物は使い回す）。目標はプレイヤーが乗っている
//     空中の乗り物のうち targets の種類（b15 から戦闘機だけ。'heli' / 'car' を足せばヘリ・飛んでいる車も）: range m 以内・地面から minAgl m 以上・
//     高さ maxAlt m 以下・見える。
//   猶予（ロックしない）: カタパルト・発艦の直後の上昇（jet._prot）・自動着艦 / 着陸の最終進入・空母から carrierSafe m 以内。撃つのは空中の自分たちの
//     ミサイルが maxActive 本より少なく、最後の発射から graceAfterLaunch 秒たってから（ロックを始めるのもその後）。
//   数値は game.json の city.airDefense（バトルロイヤルは royale.airDefense を上に重ねる）。enabled: false で出さない。setEnabled(false) はテスト用
window.MR = window.MR || {};

MR.AirDefense = class AirDefense {
  constructor(game, cfg) {
    this.g = game;
    this.cfg = Object.assign({}, AirDefense.DEFAULTS, cfg || {});
    this.enabled = this.cfg.enabled !== false;
    this.sites = [];
    this.stats = { checks: 0, rays: 0, tracks: 0, locks: 0, launches: 0, rolledOut: 0, killed: 0, gunKills: 0, blastKills: 0, ms: 0, frames: 0, maxRays: 0 };
    this._rr = 0;            // 順番（次に見る陣地）
    this._rays = 0;          // このフレームのレイの数
    this._lastLaunch = -1e9; // 最後の発射の時刻（graceAfterLaunch）
    this._lk = [];           // lockables（使い回し）
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, water: false, src: null };
    this._o = { x: 0, y: 0, z: 0 }; this._d = { x: 0, y: 0, z: 0 }; this._vel = { x: 0, y: 0, z: 0 };
    this._c = typeof THREE !== 'undefined' ? new THREE.Vector3() : { x: 0, y: 0, z: 0 };
    this._fo = { from: null, vel: null, dir: null, target: null, owner: null, type: 'manpads', seed: 0 };
    this._bb = { x: 0, y: 0, z: 0 };
    this._aglAt = { v: null, x: 0, y: 0, z: 0, s: 0 }; // _aglOf の前の値
    this._carrierC = undefined;                        // _carrier の値（1 回だけ）
    const city = game.city;
    this._rng = AirDefense.rng(((city && city.seed) | 0) ^ 0xad5eed);
    if (this.enabled) this._derive();
  }

  // 決まった乱数（mulberry32）
  static rng(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled && !this.sites.length) this._derive();
    if (!this.enabled) for (const s of this.sites) { s.st = 'idle'; s.target = null; }
  }

  _hc() {
    const g = this.g;
    if (!g.heliCollider && MR.HeliCollider && g.city) g.heliCollider = new MR.HeliCollider(g.city);
    return g.heliCollider || null;
  }

  // 空母の真ん中（carrierSafe を測る所）
  //  （空母は動かないので 1 回だけ作って覚える。_grace が毎フレーム呼ぶ）
  _carrier() {
    if (this._carrierC !== undefined) return this._carrierC;
    const ops = this.g.city && this.g.city.carrierOps;
    this._carrierC = ops && ops.box ? { x: (ops.box.x0 + ops.box.x1) / 2, z: (ops.box.z0 + ops.box.z1) / 2 } : null;
    return this._carrierC;
  }

  // 陣地を決める（1 回だけ）
  _derive() {
    const g = this.g, C = this.cfg, city = g.city;
    this.sites.length = 0;
    if (!city) return;
    const hc = this._hc();
    const rnd = this._rng;
    // ストーリーの章の陣地（g._adSites = [[x, z], …]）が先。無ければレベルの物
    const lvl = g._adSites ? { sites: g._adSites } : ((g.level && g.level.airDefense) || null);
    const add = (x, y, z, zone) => {
      const s = { isAASite: true, kind: 'aa_site', cityId: 'ad_' + (this.sites.length + 1), i: this.sites.length, zone: zone || '',
        pos: { x, y, z }, st: 'idle', target: null, next: 0, react: 0, lockT: 0, cdUntil: 0, revealUntil: -1e9, deadUntil: 0, dead: false, hits: 0, miss: 0, launches: 0 };
      this.sites.push(s);
      return s;
    };
    if (lvl && Array.isArray(lvl.sites) && lvl.sites.length) {
      for (const q of lvl.sites) {
        const sp = hc ? hc.supportAt(q[0], q[1], 1e4, 0) : null;
        add(q[0], sp && sp.y != null ? sp.y : 0, q[1], '');
      }
    } else {
      const carrier = this._carrier();
      const zones = (city.hotZones || []).filter((z) => z.id !== 'carrier' && !(carrier && Math.hypot(z.x - carrier.x, z.z - carrier.z) < (z.r || 0) + 200));
      // ゾーンごとの候補（区画の一番上の段）
      const R = C.siteRadius, lots = city.lots || [];
      const cand = zones.map(() => []);
      for (let li = 0; li < lots.length; li++) {
        const L = lots[li];
        if (!L.tiers || !L.tiers.length) continue;
        let t = L.tiers[0];
        for (let k = 1; k < L.tiers.length; k++) if (L.tiers[k][5] > t[5]) t = L.tiers[k];
        const top = t[5], area = (t[2] - t[0]) * (t[3] - t[1]);
        if (top < C.roofMin || top > C.roofMax || area < C.minArea) continue;
        const cx = (t[0] + t[2]) / 2, cz = (t[1] + t[3]) / 2;
        for (let zi = 0; zi < zones.length; zi++) if (Math.hypot(cx - zones[zi].x, cz - zones[zi].z) <= R) cand[zi].push([cx, top, cz]);
      }
      // ゾーンの順番を並べ替え（決まった乱数）
      const order = zones.map((z, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      const want = Math.max(0, C.sites | 0);
      let guard = 0;
      while (this.sites.length < want && guard++ < want * 4 + 8) {
        let added = false;
        for (let k = 0; k < order.length && this.sites.length < want; k++) {
          const zi = order[k], list = cand[zi];
          // その区画の候補から決まった乱数で（上に何も無い・ほかの陣地から離れた所）
          for (let tries = 0; tries < 12 && list.length; tries++) {
            const j = Math.floor(rnd() * list.length);
            const c = list[j];
            list[j] = list[list.length - 1]; list.pop();
            let near = false;
            for (const s of this.sites) if (Math.hypot(s.pos.x - c[0], s.pos.z - c[2]) < C.minSpacing) { near = true; break; }
            if (near) continue;
            if (hc && hc.ceilingAt(c[0], c[2], c[1] + 0.3, 3) !== Infinity) continue;
            add(c[0], c[1], c[2], zones[zi].id);
            added = true;
            break;
          }
        }
        if (!added) break;
      }
    }
    // 見る時刻をずらす（順番）
    const n = this.sites.length, hz = Math.max(0.5, C.checkHz);
    for (let i = 0; i < n; i++) this.sites[i].next = (g.time || 0) + i / (hz * Math.max(1, n));
  }

  // プレイヤーが乗っている空中の乗り物（目標）か null。狙う種類は cfg.targets（'jet' / 'heli' / 'vtol' / 'car'。b15: 戦闘機だけ。VX: 戦闘機と VTOL = オーナーの
  //   「bot がミサイル撃ってきてる」。ヘリ・飛んでいる車は狙わない）
  _target() {
    const g = this.g, v = g.vehicle, T = this.cfg.targets;
    if (!v || g.player.dead || v.wrecked || v.sunk) return null;
    const kind = v.kind === 'jet' || v.kind === 'heli' || v.kind === 'vtol' ? v.kind : 'car';
    if (Array.isArray(T) && T.indexOf(kind) < 0) return null;
    if (v.kind === 'jet') return v.mode === 'air' ? v : null;
    // ヘリと VTOL（VX: 戦闘機をゲームから外したので VTOL が主な目標）は空中だけ。どちらもフレアと RWR を持つ（AirCombat.updateHeli）
    if (v.kind === 'heli' || v.kind === 'vtol') return MR.AirCombat && MR.AirCombat.heliAir ? (MR.AirCombat.heliAir(v) ? v : null) : (!v.grounded ? v : null);
    return v.airborne ? v : null;
  }

  // 猶予（ロックしない）: カタパルト・発艦の直後の上昇・自動着艦の最終進入・空母の近く
  _grace(v) {
    if (v._prot || v.cat || v.arrest) return true;
    if (v.autoland && (v.autoland.phase === 'final' || (v.kind === 'vtol' && (v.autoland.phase === 'hold' || v.autoland.phase === 'descend')))) return true; // VTOL の自動着陸は真上で止まって降りる間
    const cr = this._carrier();
    if (cr && Math.hypot(v.pos.x - cr.x, v.pos.z - cr.z) < this.cfg.carrierSafe) return true;
    return false;
  }

  // 自分たちのミサイル（陣地が撃った物）で飛んでいる数
  _active() {
    const M = this.g.missiles;
    if (!M) return 0;
    let n = 0;
    for (let i = 0; i < M.list.length; i++) { const o = M.list[i].owner; if (o && o.isAASite && !M.list[i].dead) n++; }
    return n;
  }

  // 地面・屋上・水面からの高さ。戦闘機は自分の agl。ほか（ヘリ）は HeliCollider の支え（屋上・桟橋の箱）か水面か地面
  //  （citygen の groundAt だけだと建物を見ず、水の上は川底で、屋上・川の上の低いヘリが minAgl の外になっていた）。
  //  支えを引くと物を作るので、乗り物が 3 m 動くまで前の値を使う（ホバリング中は毎フレーム作らない）
  _aglOf(v) {
    if (typeof v.agl === 'number') return v.agl;
    const p = v.pos, q = this._aglAt;
    if (q.v === v && Math.abs(p.x - q.x) < 3 && Math.abs(p.z - q.z) < 3 && Math.abs(p.y - q.y) < 3) return p.y - q.s;
    let s = 0;
    const hc = this._hc(), city = this.g.city;
    if (hc) {
      const sp = hc.supportAt(p.x, p.z, p.y, 0);
      s = sp.y != null ? sp.y : (sp.water != null ? sp.water : 0);
      if (sp.water != null && sp.y != null && sp.water > sp.y) s = sp.water;
    } else if (city && city.groundAt) {
      const gq = city.groundAt(p.x, p.z);
      s = gq.water != null ? Math.max(gq.water, gq.y || 0) : (gq.y || 0);
    }
    q.v = v; q.x = p.x; q.y = p.y; q.z = p.z; q.s = s;
    return p.y - s;
  }

  // 範囲・高さ（レイ無し）
  _inBand(s, v, c) {
    const C = this.cfg;
    const d = Math.hypot(c.x - s.pos.x, c.y - s.pos.y, c.z - s.pos.z);
    if (d > C.range) return false;
    if (c.y > C.maxAlt) return false;
    if (this._aglOf(v) < C.minAgl) return false;
    return true;
  }

  // 陣地から c が見えるか（レイ 1 本）
  _los(s, c) {
    const C = this.cfg, o = this._o, d = this._d;
    o.x = s.pos.x; o.y = s.pos.y + C.launchHeight; o.z = s.pos.z;
    const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z, L = Math.hypot(dx, dy, dz) || 1;
    d.x = dx / L; d.y = dy / L; d.z = dz / L;
    this._rays++; this.stats.rays++;
    const h = this.g._jetRay(o, d, L, this._hit);
    return !(h && h.t < L - 12);
  }

  // 毎フレーム（game._update: missiles.update の前）
  update(dt) {
    if (!this.enabled || !this.sites.length) return;
    const t0 = AirDefense.now();
    const g = this.g, C = this.cfg, now = g.time || 0, n = this.sites.length;
    this._rays = 0;
    const v = this._target();
    let c = null, graced = true;
    if (v) {
      if (typeof v.center === 'function') c = v.center(this._c);
      else { c = this._c; c.x = v.pos.x; c.y = v.pos.y; c.z = v.pos.z; }
      graced = this._grace(v);
    }
    const period = 1 / Math.max(0.5, C.checkHz);
    // 順番に: 時刻が来た陣地を見る（レイが要る陣地は 1 フレームに 1 つまで。残りは次のフレーム）
    let defer = -1;
    for (let k = 0; k < n; k++) {
      const s = this.sites[(this._rr + k) % n];
      if (now < s.next) continue;
      // 黙っている（壊れた）陣地: respawn 秒で戻る
      if (s.dead) { if (now >= s.deadUntil) { s.dead = false; s.st = 'idle'; s.hits = 0; } s.next = now + period; continue; }
      if (s.st === 'cooldown') { if (now >= s.cdUntil) s.st = 'idle'; else { s.next = now + period; continue; } }
      const ok = !!v && !graced && this._inBand(s, v, c);
      if (!ok) { this._lose(s); s.next = now + period; this.stats.checks++; continue; }
      // 撃てない間（graceAfterLaunch・maxActive）はロックを始めない（見つけるだけ）
      if (this._rays >= 1) { defer = (this._rr + k) % n; break; } // レイはこのフレームもう使った: この陣地は次のフレームの最初
      this.stats.checks++;
      s.next = now + period;
      if (!this._los(s, c)) {
        if (++s.miss >= C.losMisses) this._lose(s);
        continue;
      }
      s.miss = 0;
      this._step(s, v, c, now);
    }
    this._rr = defer >= 0 ? defer : (this._rr + 1) % n;
    this.stats.maxRays = Math.max(this.stats.maxRays, this._rays);
    this.stats.frames++;
    this.stats.ms += AirDefense.now() - t0;
  }

  // 見えている陣地の 1 歩（状態を進める）
  _step(s, v, c, now) {
    const C = this.cfg, AC = this.g.airCombat;
    const canLaunch = now - this._lastLaunch >= C.graceAfterLaunch && this._active() < C.maxActive;
    if (s.st === 'idle' || s.target !== v) {
      s.st = 'track'; s.target = v; s.react = now + C.reaction[0] + this._rng() * (C.reaction[1] - C.reaction[0]);
      this.stats.tracks++;
    }
    if (s.st === 'track') {
      if (now >= s.react && canLaunch) { s.st = 'lock'; s.lockT = now; this.stats.locks++; }
      // 探知の音（spike 'search'）はロックが本当に始まる searchToneLead 秒前から（撃てる間だけ）。b16: 戦闘機をやめて VTOL だけになり、
      //   以前は撃てない間（graceAfterLaunch・maxActive・反応の待ち）もずっと探知の音で、陣地の近くでは 45 % の時間鳴っていた（発射は 8 分に 1 回）
      else { if (AC && (C.searchToneLead < 0 || (canLaunch && now >= s.react - C.searchToneLead))) AC.spike(v, s, 'search'); return; } // −1 = b15 の鳴らし方（比べる用）
    }
    if (s.st === 'lock') {
      if (now - s.lockT < C.lockTime) { if (AC) AC.spike(v, s, 'lock'); return; }
      if (!canLaunch) { s.st = 'track'; s.react = now; if (AC && C.searchToneLead < 0) AC.spike(v, s, 'search'); return; } // ロックの途中でほかの陣地が撃った: 探知に戻る（撃てるようになったらまたロック）
      if (this._rng() > C.chance) { this.stats.rolledOut++; this._cool(s, now); return; }
      this._launch(s, v, c, now);
    }
  }

  _lose(s) {
    if (s.st === 'track' || s.st === 'lock') s.st = 'idle';
    s.target = null; s.miss = 0;
  }

  _cool(s, now) {
    const C = this.cfg;
    s.st = 'cooldown'; s.target = null;
    s.cdUntil = now + C.cooldown[0] + this._rng() * (C.cooldown[1] - C.cooldown[0]);
  }

  // 撃つ（game.missiles.fire だけ）。後方噴射の煙・aa_fire・RWR の発射
  _launch(s, v, c, now) {
    const g = this.g, C = this.cfg, M = g.missiles;
    if (!M) { this._cool(s, now); return; }
    const o = this._o, d = this._d, vel = this._vel;
    o.x = s.pos.x; o.y = s.pos.y + C.launchHeight; o.z = s.pos.z;
    let dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy = dy / L + C.launchLoft; dz /= L;
    const l2 = Math.hypot(dx, dy, dz) || 1;
    d.x = dx / l2; d.y = dy / l2; d.z = dz / l2;
    vel.x = d.x * C.launchSpeed; vel.y = d.y * C.launchSpeed; vel.z = d.z * C.launchSpeed;
    const fo = this._fo;
    fo.from = o; fo.vel = vel; fo.dir = d; fo.target = v; fo.owner = s; fo.type = C.type || 'manpads';
    fo.seed = (Math.imul((s.i + 1) * 2654435761, ++s.launches) ^ ((now * 1000) | 0)) >>> 0;
    M.fire(fo);
    fo.target = null; fo.owner = null;
    this._lastLaunch = now;
    this.stats.launches++;
    s.revealUntil = now + C.revealSec;
    if (g.airCombat) g.airCombat.spike(v, s, 'launch');
    // 後方噴射の煙（屋上、発射の向きの後ろ）・音
    if (g.fx && typeof g.fx.smoke === 'function') {
      const b = this._bb;
      b.x = o.x - d.x * 2.5; b.y = s.pos.y + 1.2; b.z = o.z - d.z * 2.5;
      g.fx.smoke(b, 1.8); g.fx.smoke(o, 1.1);
    }
    if (g.audio && typeof g.audio.play === 'function') g.audio.play('aa_fire', { pos: o, priority: 3, refDistance: 20, maxDistance: 1500 });
    this._cool(s, now);
  }

  // ---------- 見えている・壊す ----------
  isRevealed(s) { return !s.dead && (this.g.time || 0) < s.revealUntil; }
  // 戦闘機のロックの目標（撃って見えている陣地。使い回しの配列）
  lockables() {
    const out = this._lk;
    out.length = 0;
    if (!this.enabled) return out;
    for (let i = 0; i < this.sites.length; i++) if (this.isRevealed(this.sites[i])) out.push(this.sites[i]);
    return out;
  }
  // 爆発（ミサイル・乗り物）: killRadius m 以内の陣地は respawn 秒黙る。owner が陣地の物（自分のミサイル）は数えない
  onBlast(x, y, z, owner) {
    if (!this.sites.length || (owner && owner.isAASite)) return 0;
    const R = this.cfg.killRadius;
    let k = 0;
    for (const s of this.sites) {
      if (s.dead) continue;
      if (Math.hypot(s.pos.x - x, s.pos.y + 1 - y, s.pos.z - z) <= R) { this._kill(s); this.stats.blastKills++; k++; }
    }
    return k;
  }
  // 機関砲の n 発が (x, y, z) に当たった: gunRadius m 以内の陣地に数え、gunHits 発で黙る
  gunHit(x, y, z, n) {
    if (!this.sites.length) return false;
    const R = this.cfg.gunRadius;
    for (const s of this.sites) {
      if (s.dead) continue;
      if (Math.abs(s.pos.x - x) > R || Math.abs(s.pos.z - z) > R) continue;
      if (Math.hypot(s.pos.x - x, s.pos.y + 1 - y, s.pos.z - z) > R) continue;
      s.hits += n;
      if (s.hits >= this.cfg.gunHits) { this._kill(s); this.stats.gunKills++; }
      return true;
    }
    return false;
  }
  // 建物が倒れた（destruct-3 M3）: 外す範囲 C の中の陣地を無くす（on false = 直した: 戻す）
  collapse(C, on) {
    let k = 0;
    for (const s of this.sites) {
      if (s.pos.x < C.x0 - 0.5 || s.pos.x > C.x1 + 0.5 || s.pos.z < C.z0 - 0.5 || s.pos.z > C.z1 + 0.5 || s.pos.y < C.y0 - 2) continue;
      if (on) { if (s.gone) continue; if (!s.dead) this._kill(s); s.deadUntil = Infinity; s.gone = true; k++; } // 黙っている陣地を殺し直さない（L2）
      else if (s.gone) { s.gone = false; s.deadUntil = 0; k++; }
    }
    return k;
  }
  _kill(s) {
    const now = this.g.time || 0;
    s.dead = true; s.st = 'dead'; s.target = null; s.deadUntil = now + this.cfg.respawn; s.revealUntil = -1e9; s.hits = 0;
    this.stats.killed++;
    const g = this.g;
    if (g.fx && typeof g.fx.smoke === 'function') { const b = this._bb; b.x = s.pos.x; b.y = s.pos.y + 1; b.z = s.pos.z; g.fx.smoke(b, 2.4); }
  }

  avgMs() { return this.stats.frames ? this.stats.ms / this.stats.frames : 0; }
  dispose() { for (const s of this.sites) { s.target = null; } this._lk.length = 0; }
  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
};

MR.AirDefense.DEFAULTS = {
  enabled: true, sites: 3, targets: ['jet', 'vtol'], siteRadius: 260, roofMin: 18, roofMax: 170, minArea: 90, range: 1600, minAgl: 25, maxAlt: 900,
  lockTime: 1.6, reaction: [1.0, 2.5], cooldown: [30, 45], maxActive: 1, chance: 0.6, graceAfterLaunch: 12, carrierSafe: 900,
  revealSec: 20, killRadius: 14, gunHits: 12, respawn: 120, soldierDist: 350, checkHz: 4, type: 'manpads',
  gunRadius: 5, minSpacing: 60, launchHeight: 2.2, launchSpeed: 30, launchLoft: 0.15, losMisses: 2, searchToneLead: 0.5
};
