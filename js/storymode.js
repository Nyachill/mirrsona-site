// ストーリーの遊び（MR.StoryMode。game.js が cityMode 'story' のとき CityPlay の後に作る = game.story）と進み具合の保存（MR.StoryStore）。
//   計画: dev-notes/plans/story/story-plan.md（rev 1）+ story-plan-rev2.md。章のデータは story.js の MR.Story（形と実行）、ここは game を動かす係。
//   RoyaleMode と同じ口: begin()（置いた後）・tick()（死んでいても毎フレーム）・update(dt)（街の更新の後）・cineActive / updateCine(dt)（プレイヤーの
//   更新の代わり）・onPlayerDied(killer)・onKill(victim, how)・onPlayerHit(dmg, opts)・onLift(name)・mapInfo()・prompt() / press()（乗る ボタンの
//   調べる物）・sessionInfo()・dispose()。
//   ■ 場所（anchors）: { zone | heliport | landmark | lift | perch | p, d: [dx, dy, dz], yaw, r, ground } / '@役者'（'@no7.ramp' = 七号機のランプの先）/ 調べる物の id。
//     ground: true は当たり判定の床に下ろす（読んでいなければその場で読む）。
//   ■ 隊（groups）: { at | perch: [番号], n, role(s): guard | hunt | overwatch | climber, weapon, look, tag, hp, acc, dmg, spread, waves, gap }。
//     出すのは director.spawnAt（歩行グラフにつながった床）。e.persistent（director が消さない・数えない）・e.storyTag・e.storyUnit。
//   ■ チェックポイント: step に入った直後の Runner の状態 + 持ち物・体力・立つ場所・役者・七号機・灯・生きている隊員。やり直しはその場で
//     （隊員を消して作り直し、持ち物はチェックポイントの物 = 開始の持ち物ではない）。章の最初から・次の章は leaveToTitle({ again: 'story:<id>' })。
//   ■ 数値は game.json の story（無いキーは DEF）。
window.MR = window.MR || {};

(function () {
  const D2R = Math.PI / 180;
  const DEF = {
    enabled: true, difficulty: 'normal',
    diffs: { easy: { hp: 0.7, acc: 0.6, dmg: 0.6 }, normal: { hp: 1, acc: 1, dmg: 1 }, hard: { hp: 1.3, acc: 1.25, dmg: 1.35 } },
    radio: {}, talk: {}, markers: { max: 3 }, card: { sec: 3.2 },
    ally: {}, civ: {}, caps: { enemies: 7, others: 3, shadowDist: 30 },
    cine: { maxDistNoFade: 250, skipHold: 0.6 },
    relight: {}, vtol: {},
    strike: { length: 30, noFire: 12, delay: 3, cooldown: 45, shots: 6, blast: 'vtol_gun', pass: 2.2, height: 60 },
    interact: { radius: 2.2, dy: 1.8, holdCancelDist: 4, hitCancel: 20, hitSetback: 0.6 },
    board: { radius: 3.2, fadeSec: 0.45 },
    billboard: { size: [512, 256], intensity: 1.4, texts: {} },
    alert: { radius: 30 },
    failDelay: 1.6, resultDelay: 2.4, save: { maxBytes: 16384 }
  };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const merge = (a, b) => { const o = Object.assign({}, a); for (const k of Object.keys(b || {})) o[k] = isObj(a[k]) && isObj(b[k]) ? Object.assign({}, a[k], b[k]) : b[k]; return o; };

  // ---------- 進み具合（localStorage + 端末の DATA の写し。新しい方を使う）----------
  const StoryStore = {
    storage: null, prog: null, _mirrorT: 0,
    init(storage) {
      StoryStore.storage = storage || null;
      const S = MR.Story;
      let ls = null;
      try { ls = typeof localStorage !== 'undefined' ? localStorage.getItem(S.Progress.KEY) : null; } catch (e) { ls = null; }
      StoryStore.prog = S.Progress.newest(ls, null);
      if (storage && typeof storage.readText === 'function') {
        return storage.readText('story/progress.json').then((t) => { StoryStore.prog = S.Progress.newest(StoryStore.prog, t); return StoryStore.prog; }, () => StoryStore.prog);
      }
      return Promise.resolve(StoryStore.prog);
    },
    get() { if (!StoryStore.prog) StoryStore.prog = MR.Story.Progress.newest(StoryStore._ls(), null); return StoryStore.prog; },
    _ls() { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(MR.Story.Progress.KEY) : null; } catch (e) { return null; } },
    save(maxBytes) {
      const p = StoryStore.get();
      p.t = Date.now();
      let txt = JSON.stringify(p);
      // 大きすぎる: チェックポイントの持ち物の細かい物を捨てる（それでも大きければチェックポイントを捨てる）
      if (txt.length > (maxBytes || 16384) && p.cp) { p.cp = Object.assign({}, p.cp, { actors: null, units: null }); txt = JSON.stringify(p); }
      if (txt.length > (maxBytes || 16384)) { p.cp = null; txt = JSON.stringify(p); }
      let ok = false;
      try { if (typeof localStorage !== 'undefined') { localStorage.setItem(MR.Story.Progress.KEY, txt); ok = true; } } catch (e) { ok = false; }
      const st = StoryStore.storage;
      if (st && typeof st.writeText === 'function') { try { st.writeText('story/progress.json', txt).catch(() => {}); } catch (e) { /* 無視 */ } }
      StoryStore.bytes = txt.length;
      return ok;
    },
    reset() { StoryStore.prog = MR.Story.Progress.blank(); StoryStore.save(); }
  };

  class StoryMode {
    // opts: { chapter（検証済みの JSON）, campaign（story.json）, cp（チェックポイントの記録 = progress.cp）, diff }
    constructor(game, opts) {
      opts = opts || {};
      this.game = game;
      this.cfg = merge(DEF, game.config.story || {});
      this.campaign = opts.campaign || game.assets.get('story/story.json') || { cast: {}, chapters: [] };
      this.ch = opts.chapter;
      if (!this.ch) throw new Error('ストーリーの章がありません');
      this.cpRec = opts.cp && opts.cp.ch === this.ch.id ? opts.cp : null;
      this.diffName = opts.diff || (StoryStore.get().diff) || this.cfg.difficulty;
      this.diff = this.cfg.diffs[this.diffName] || this.cfg.diffs.normal;
      const cast = Object.assign({}, this.campaign.cast || {});
      this.ui = MR.StoryUI ? new MR.StoryUI(game, cast, this.cfg) : null;
      if (this.ui) { this.ui.onStrike = () => this.pressStrike(); this.ui.onSkip = () => this.skipCine(); }
      this.lights = MR.CityLights && game.world && game.world.farMaterial ? new MR.CityLights(game, this.cfg.relight) : null;
      this.runner = new MR.Story.Runner(this.ch, { host: this, seed: MR.Story.hash(this.ch.id + '|' + (this.cpRec ? this.cpRec.step : '')) });
      this.rand = MR.Story.rng(MR.Story.hash(this.ch.id + '#rng'));
      this.anchorCache = {};
      this.actors = {};
      this.vtol = null;
      this.groupUnits = {};   // group id → [Enemy | null]（番号 k）
      this.waves = {};        // group id → { left, t, gap }
      this.markIds = []; this.interDone = {}; this.hold = null;
      this.cine = null; this.cineQueue = [];
      this.area = null; this.wall = null;
      this.boardZone = null;  // { r }: 七号機のランプの先に歩いて来たら boarded
      this._boarding = 0;
      this.strike = null;     // { n, cool, aiming, line }
      this.over = null;       // { result, t }
      this.failT = 0;
      this.killsTotal = 0;
      this.stats = { kills: 0, damage: 0, t0: 0, retries: 0, cps: 0, strikes: 0, strikeKills: 0, cpuMs: 0, cpuMax: 0, frames: 0, civTotal: 0, civSafe: 0 };
      this.lastCp = null;
      this.paused = false;
      this._tmp = new THREE.Vector3();
      this.onEnd = opts.onEnd || null;
      this._applySystems();
    }

    get riding() { return false; }
    get cineActive() { return !!this.cine; }
    get holdFire() { return !!this.cine || this.paused; }

    // ---------- 章の設定 ----------
    _applySystems() {
      const g = this.game, S = this.ch.systems || {};
      if (g.director) { g.director.cfg.enemyCount = S.ambient == null ? 0 : S.ambient; for (const e of g.enemies) if (!e.persistent) e.removed = true; }
      if (this.lights) this.lights.setDark((this.ch.zones && this.ch.zones.dark || []).filter((z) => StoryStore.get().relit.indexOf(z) < 0));
    }

    // 始める場所（チェックポイントがあればその場所）
    startSpot() {
      if (this.cpRec && this.cpRec.spot) return Object.assign({}, this.cpRec.spot);
      const a = this.resolve(this.ch.start || { zone: 'skyhigh' });
      return { x: a.x, y: a.y, z: a.z, yawDeg: a.yaw || 0 };
    }

    begin() {
      const g = this.game;
      this.stats.t0 = g.time;
      this.ui && this.ui.fade(1, 0);
      this.ui && this.ui.fade(0, 1.2);
      if (!this.cpRec) this._loadout(this.ch.loadout);
      // 役者（七号機以外は章の始めに置く）
      for (const id of Object.keys(this.ch.actors || {})) this._ensureActor(id);
      if (this.cpRec) {
        this._restoreCp(this.cpRec, true);
      } else {
        if (this.ui && this.ch.card !== false) this.ui.card(this.ch.title, this.ch.en, this.ch.caption);
        this.runner.start();
      }
      this._pump();
    }

    // ---------- 場所 ----------
    resolve(a, noCache) {
      if (a == null) return null;
      const g = this.game, C = g.city;
      if (typeof a === 'string') {
        if (a[0] === '@') {
          const [nm, part] = a.slice(1).split('.');
          if (nm === 'player') return { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z };
          const ac = this.actors[nm];
          if (ac && ac.kind === 'vtol') {
            const v = ac.v;
            if (!v) return null;
            if (part === 'ramp') { const t = ac.rampTip(this._tmp); return t ? { x: t.x, y: t.y, z: t.z } : null; }
            return { x: v.pos.x, y: v.pos.y + 3, z: v.pos.z };
          }
          if (ac) return { x: ac.pos.x, y: ac.pos.y, z: ac.pos.z };
          return null;
        }
        if (this.anchorCache[a] && !noCache) return this.anchorCache[a];
        const def = (this.ch.anchors || {})[a] || ((this.ch.interact || {})[a] && this.ch.interact[a].at) || null;
        const grp = !def && (this.ch.groups || {})[a];
        const r = def ? this.resolve(def) : (grp ? this.resolve(Array.isArray(grp.at) ? grp.at[0] : grp.at) : null);
        if (r && !this._dyn(def)) this.anchorCache[a] = r;
        return r;
      }
      if (!isObj(a)) return null;
      let x = 0, y = 0, z = 0, yaw = a.yaw || 0, base = null;
      if (a.p) { x = a.p[0]; y = a.p[1]; z = a.p[2]; base = true; }
      else if (a.zone) { const h = (C.hotZones || []).find((q) => q.id === a.zone); if (h) { x = h.x; z = h.z; base = h; } }
      else if (a.heliport) { const h = (C.helipads || []).find((q) => q.id === a.heliport); if (h) { x = h.x; y = h.y; z = h.z; base = h; } }
      else if (a.lift) { for (const L of C.lifts || []) for (const s of L.stations) if (s.name === a.lift) { x = s.x; y = s.y; z = s.z; base = s; } }
      else if (a.perch != null) { const ps = (C.perches || []).filter((q) => !a.lm || q.lm === a.lm); const q = ps[a.perch]; if (q) { x = q.x; y = q.y; z = q.z; base = q; } }
      else if (a.landmark) {
        const lm = ((C.plan && C.plan.landmarks) || []).find((q) => q.id === a.landmark);
        if (lm) {
          if (lm.params && lm.params.x != null) { x = lm.params.x; z = lm.params.z; }
          else if (lm.claim) { x = (lm.claim[0] + lm.claim[2]) / 2; z = (lm.claim[1] + lm.claim[3]) / 2; }
          base = lm;
        }
      } else if (a.at) { const r0 = this.resolve(a.at); if (r0) { x = r0.x; y = r0.y; z = r0.z; base = r0; } }
      if (!base) return null;
      if (a.d) { x += a.d[0] || 0; y += a.d[1] || 0; z += a.d[2] || 0; }
      if (a.ground) { const gy = this._groundAt(x, z, y); if (gy !== null) y = gy; }
      return { x, y, z, yaw, r: a.r || 0 };
    }
    _dyn(def) { return typeof def === 'string' && def[0] === '@'; }
    _groundAt(x, z, yHint) {
      const g = this.game, nav = g.world.nav, c = g.city.chunkOf(x, z);
      if (!nav.hasChunk(c.cx + '_' + c.cz)) g.world.loadNavNow(x, z, yHint + 0.3);
      return nav.groundHeight(x, z, yHint + 1.5, 3);
    }

    // ---------- 役者 ----------
    _ensureActor(id) {
      if (this.actors[id]) return this.actors[id];
      const def = (this.ch.actors || {})[id];
      if (!def) return null;
      const g = this.game;
      if (def.kind === 'vtol') {
        if (!MR.StoryVtol) return null;
        const p = this.resolve(def.at || { zone: 'skyhigh' }) || { x: 0, y: 0, z: 0, yaw: 0 };
        const sv = new MR.StoryVtol(g, { x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0 }, this.cfg.vtol);
        sv.kind = 'vtol'; sv.id = id;
        this.actors[id] = sv;
        if (def.spawn !== false) { const v = sv.ensure(); if (v && def.air) sv.hoverAt(p, p.yaw || 0, true); }
        return sv;
      }
      if (!MR.StoryActor) return null;
      const p = this.resolve(def.at) || { x: g.player.pos.x + 2, y: g.player.pos.y, z: g.player.pos.z, yaw: 0 };
      const a = new MR.StoryActor(g, id, def, p, { cfg: Object.assign({ shadowDist: this.cfg.caps.shadowDist }, def.kind === 'civ' ? this.cfg.civ : this.cfg.ally), rand: this.rand });
      this.actors[id] = a;
      if (def.kind === 'civ') this.stats.civTotal++;
      if (def.mode) a.setMode(def.mode, def.target ? this.resolve(def.target) : null);
      return a;
    }
    onActorBoarded(a) { if (a.kind === 'civ') this.runner.event('civBoarded', { n: 1 }); }

    // 見えるか（カメラの前で、視線が通る）: 味方を後ろへ移すとき
    sees(p) {
      const g = this.game, cam = g.camera;
      const cp = cam.getWorldPosition(this._cp || (this._cp = new THREE.Vector3()));
      const f = cam.getWorldDirection(this._cf || (this._cf = new THREE.Vector3()));
      const dx = p.x - cp.x, dy = p.y + 1 - cp.y, dz = p.z - cp.z, d = Math.hypot(dx, dy, dz) || 1;
      if ((dx * f.x + dy * f.y + dz * f.z) / d < 0.5) return false;
      return g.world.nav.lineOfSight(cp.x, cp.y, cp.z, p.x, p.y + 1, p.z);
    }

    // ---------- 隊 ----------
    _spawnGroup(gid, wave) {
      const g = this.game, G0 = (this.ch.groups || {})[gid];
      if (!G0) return 0;
      if (!g.director && MR.EnemyDirector) g.director = new MR.EnemyDirector(g, Object.assign({}, g.cityCfg, { enemyCount: 0 }));
      const D = g.director;
      const tag = G0.tag || gid;
      const n = G0.n || (Array.isArray(G0.perch) ? G0.perch.length : (Array.isArray(G0.at) ? G0.at.length : 1));
      const list = this.groupUnits[gid] || (this.groupUnits[gid] = []);
      const alive = () => g.enemies.filter((e) => e.storyTag && !e.dead && !e.removed).length;
      let made = 0;
      for (let k = 0; k < n; k++) {
        if (alive() >= this.cfg.caps.enemies) break;
        const e = this._spawnUnit(gid, G0, k, D);
        if (!e) continue;
        list[k + (wave || 0) * n] = e;
        made++;
      }
      this.runner.event('spawn', { tag, n: made }); // 0 人でも（出せなかった隊を「倒した」に数える = 先へ進める）
      const w = G0.waves || 1;
      const st = this.waves[gid] || (this.waves[gid] = { left: w - 1, t: 0, gap: G0.gap || 8, wave: 0 });
      if (wave == null) { st.left = w - 1; st.wave = 0; st.t = 0; }
      this.runner.event('waiting', { tag, on: st.left > 0 });
      return made;
    }

    _spawnUnit(gid, G0, k, D, at) {
      const g = this.game, nav = g.world.nav;
      let p = at || null;
      const roles = G0.roles || [];
      const role = roles[k] || G0.role || 'hunt';
      if (!p && Array.isArray(G0.perch)) {
        const ps = (g.city.perches || []).filter((q) => !G0.lm || q.lm === G0.lm);
        const q = ps[G0.perch[k % G0.perch.length]];
        if (q) p = { x: q.x, y: q.y, z: q.z, perch: q };
      }
      if (!p) {
        const ats = Array.isArray(G0.at) ? G0.at : [G0.at];
        const a = this.resolve(ats[k % ats.length]);
        if (!a) return null;
        const sp = G0.spread || 0;
        const ang = this.rand() * Math.PI * 2, rr = sp * Math.sqrt(this.rand());
        p = { x: a.x + Math.cos(ang) * rr, y: a.y, z: a.z + Math.sin(ang) * rr };
      }
      const c = g.city.chunkOf(p.x, p.z);
      if (!nav.hasChunk(c.cx + '_' + c.cz)) g.world.loadNavNow(p.x, p.z, p.y + 0.3);
      // 床に立てる所（近くを探す）
      let gy = nav.groundHeight(p.x, p.z, p.y + 0.6, 0.6);
      if (gy === null || Math.abs(gy - p.y) > 1.2) {
        let ok = false;
        for (let t = 1; t <= 6 && !ok; t++) for (let j = 0; j < 8 && !ok; j++) {
          const x = p.x + Math.cos(j * Math.PI / 4) * t, z = p.z + Math.sin(j * Math.PI / 4) * t;
          const y = nav.groundHeight(x, z, p.y + 0.6, 0.6);
          if (y !== null && Math.abs(y - p.y) < 1.2) { p = Object.assign({}, p, { x, z }); gy = y; ok = true; }
        }
        if (!ok) return null;
      }
      const q = nav.resolveCapsule({ x: p.x, y: gy, z: p.z }, 0.4, 1.8, 0.45, { snapDown: 0.2 });
      const kind = role === 'overwatch' ? 'roof' : 'street';
      const e = D.spawnAt(q.x, gy, q.z, kind, null);
      e.persistent = true; e.storyTag = G0.tag || gid; e.storyUnit = gid + '#' + k; e.storyGroup = gid;
      e.storyHome = { x: q.x, y: gy, z: q.z }; // 迷子を戻す所（_updateUnstuck）
      e.knife = false;
      e.role = role === 'hunt' ? 'hunter' : role;
      if (p.perch) { e.perch = p.perch; e.watch = { x: q.x, y: gy, z: q.z }; e.role = 'overwatch'; }
      if (e.role === 'overwatch' && !e.perch) e.watch = { x: q.x, y: gy, z: q.z };
      if (e.role === 'guard') { e.home = { x: q.x, y: gy, z: q.z }; e.yaw = this.rand() * Math.PI * 2; }
      const df = this.diff;
      const hp = (G0.hp || 1) * df.hp, acc = (G0.acc || 1) * df.acc, dmg = (G0.dmg || 1) * df.dmg;
      e.health *= hp;
      e.cfg = Object.assign({}, e.cfg, { hitChance: e.cfg.hitChance * acc, damage: e.cfg.damage * dmg });
      if (MR.StoryActor) MR.StoryActor.tint(e.character, G0.look || 'veil');
      return e;
    }

    _despawnGroup(gid) {
      const list = this.groupUnits[gid] || [];
      let n = 0;
      for (const e of list) if (e && !e.dead && !e.removed) { e.removed = true; n++; }
      if (n) this.runner.event('despawn', { tag: ((this.ch.groups || {})[gid] || {}).tag || gid, n });
      if (this.waves[gid]) this.waves[gid].left = 0;
      this.runner.event('waiting', { tag: ((this.ch.groups || {})[gid] || {}).tag || gid, on: false });
    }

    _updateWaves(dt) {
      const g = this.game;
      for (const gid of Object.keys(this.waves)) {
        const st = this.waves[gid];
        if (st.left <= 0) continue;
        const G0 = this.ch.groups[gid], tag = G0.tag || gid;
        const alive = g.enemies.filter((e) => e.storyGroup === gid && !e.dead && !e.removed).length;
        st.t += dt;
        if (alive === 0 || st.t >= st.gap * 2.5) {
          if (st.t < st.gap) continue;
          st.left--; st.wave++; st.t = 0;
          this._spawnGroup(gid, st.wave);
          this.runner.event('waiting', { tag, on: st.left > 0 });
        }
      }
    }

    // 撃った・撃たれた: 近くの見張り（guard）が気づく
    alert(p, r) {
      for (const e of this.game.enemies) if (e.storyTag && e.role === 'guard' && !e.dead && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < (r || this.cfg.alert.radius)) e.alerted = true;
    }

    // ---------- 出来事（game.js から）----------
    onKill(victim, how) {
      if (!victim || !victim.storyTag || victim._storyCounted) return;
      victim._storyCounted = true;
      this.killsTotal++;
      if (how !== 'ally' && how !== 'other') this.stats.kills++;
      if (how === 'strike' || this._striking) this.stats.strikeKills++;
      this.runner.event('kill', { tag: victim.storyTag, how: this._striking ? 'strike' : (how || 'shot') });
    }
    onPlayerHit(dmg, opts) {
      this.stats.damage += dmg || 0;
      // 長押しの間の被弾: 小さい弾は進みを hitSetback 秒戻すだけ、合計 hitCancel を超えたら中断（1 発ごとに最初からだと、敵の多いときに終わらない）
      if (this.hold && this.hold.def.cancelOnHit && dmg > 0) {
        const I = this.cfg.interact, h = this.hold;
        h.dmg = (h.dmg || 0) + dmg;
        if (h.dmg >= (I.hitCancel || 20)) { this.hold = null; this.ui && this.ui.holdGauge(null); this.ui && this.ui.toast('中断された — もう一度', 1.4); }
        else h.t = Math.max(0, h.t - (I.hitSetback != null ? I.hitSetback : 0.6));
      }
      this.alert(this.game.player.pos, 40);
    }
    onPlayerFire() { this.alert(this.game.player.pos, this.cfg.alert.radius); }
    onPlayerDied() {
      const g = this.game;
      this.hold = null; if (this.ui) this.ui.holdGauge(null);
      if (this.cine) this._endCine(true);
      g.respawnAt = Infinity;
      this.runner.event('playerDead');
      this._pump();
      if (!this.over) this._fail('やられた');
    }
    onLift(name) { this.runner.event('lifted', { to: name }); }
    onEnterVehicle(v) { this.runner.event('enterVehicle', { type: v.def && v.def.id, tag: v.storyTag || v.cityId }); }
    onExitVehicle(v) { this.runner.event('exitVehicle', {}); }
    onVehicleDead(v) { if (v && v.storyTag) this.runner.event('vehicleDead', { tag: v.storyTag }); }
    onPickup(kind) { this.runner.event('picked', { kind }); }

    // 場所の条件（story.js の Runner が聞く）
    query(name, args) {
      const g = this.game, P = g.player.pos;
      switch (name) {
        case 'near': { const a = this.resolve(args[0]); return !!a && Math.hypot(P.x - a.x, P.y - a.y, P.z - a.z) <= (+args[1] || 3); }
        case 'inside': { const a = this.resolve(args[0]); return !!a && Math.hypot(P.x - a.x, P.z - a.z) <= (+args[1] || a.r || 10) && Math.abs(P.y - a.y) < (args[2] || 6); }
        case 'leave': { const a = this.resolve(args[0]); return !!a && Math.hypot(P.x - a.x, P.z - a.z) > (+args[1] || 40); }
        case 'landed': { const ac = this.actors[args[0]], a = this.resolve(args[1]), v = ac && ac.v; return !!(v && a && v.grounded && !v.wrecked && Math.hypot(v.pos.x - a.x, v.pos.z - a.z) <= (+args[2] || 15) && Math.abs(v.pos.y - a.y) < 4); }
        case 'actorNear': { const ac = this.actors[args[0]], a = this.resolve(args[1]); if (!ac || !a) return false; const p = ac.v ? ac.v.pos : ac.pos; return Math.hypot(p.x - a.x, p.z - a.z) <= (+args[2] || 3); }
        case 'hpBelow': return g.player.health < (+args[0] || 0);
        default: return false;
      }
    }

    // ---------- 命令の実行 ----------
    _pump() {
      let guard = 0;
      while (guard++ < 20) {
        const cmds = this.runner.drain();
        if (!cmds.length) break;
        for (const c of cmds) this._exec(c);
      }
    }

    _exec(c) {
      const g = this.game, a = c.args, ui = this.ui;
      switch (c.verb) {
        case 'enter': this.stepId = a[0]; this.markIds = (this.runner.step && this.runner.step.mark) || []; this.objSpec = null; if (ui) ui.objective(''); break;
        case 'leave': break;
        case 'obj': this.objText = a[0]; this.objSpec = a[1] || null; break;
        case 'mark': this.markIds = Array.isArray(a[0]) ? a[0].slice() : [a[0]]; break;
        case 'unmark': this.markIds = []; break;
        case 'radio': { const L = (this.ch.lines || {})[a[0]]; if (ui && L) ui.radio(L, a[0]); else this.runner.event('done', { id: a[0] }); break; }
        case 'talk': { const L = (this.ch.lines || {})[a[0]]; if (ui && L) { if (!this.cine) this._pause(true); ui.talk(L, () => { if (!this.cine) this._pause(false); this.runner.event('done', { id: a[0] }); this._pump(); }, a[0]); } else this.runner.event('done', { id: a[0] }); break; }
        case 'card': if (ui) ui.card(a[0] || this.ch.title, a[1] || this.ch.en, a[2] || this.ch.caption); break;
        case 'cine': this._startCine(a[0]); break;
        case 'spawn': this._spawnGroup(a[0]); break;
        case 'despawn': this._despawnGroup(a[0]); break;
        case 'ally': case 'civ': {
          const ac = this._ensureActor(a[0]);
          if (!ac || ac.kind === 'vtol') break;
          const mode = a[1];
          if (mode === 'hide') { const R = (Array.isArray(a[2]) ? a[2] : ((this.ch.anchors || {})[a[2]] || {}).cover || []).map((x) => this.resolve(Array.isArray(x) ? { p: x, ground: true } : x)).filter(Boolean); ac.setMode('hide', null, R); }
          else if (mode === 'place') { const p = this.resolve(a[2]); if (p) ac.placeAt(p); ac.setMode('idle'); }
          else if (mode === 'board') {
            const an = a[2] || '@no7.ramp';
            ac.setMode('board', this.resolve(an));
            if (typeof an === 'string' && an.charAt(0) === '@') {
              // 七号機が降りてランプが開いてから（ランプの先が地面の近く）。それまでは target なし = その場で待つ
              const vk = an.slice(1).split('.')[0];
              ac.targetFn = () => {
                const v = this.actors[vk];
                if (v && v.kind === 'vtol' && !v.rampOpen) return null;
                ac.rampFn = () => this.resolve(an);
                const q = this.resolve(an);
                if (!q || Math.abs(q.y - this._groundY(q.x, q.z, q.y)) >= 1) return null;
                // ランプの先は胴体の経路の箱（aabb + 0.6 m）の中なので、経路の行き先はその外（機体の中心から外へ）。
                // 着いたらランプの先までまっすぐ歩く（rampFn）
                if (v && v.v) {
                  const dx = q.x - v.v.pos.x, dz = q.z - v.v.pos.z, l = Math.hypot(dx, dz) || 1;
                  // 胴体の箱（vtol.js boxDef[0] = aabb の箱）の後ろの端 + 経路の膨らませ 0.6 m の外
                  const F = v.v.boxDef && v.v.boxDef[0], out = (F ? Math.max(Math.abs(F.z0), Math.abs(F.z1)) + 0.6 : l) + (this.cfg.board.outside || 1.5);
                  if (l < out) { q.x = v.v.pos.x + dx / l * out; q.z = v.v.pos.z + dz / l * out; }
                }
                return q;
              };
            }
          }
          else if (Array.isArray(a[2])) { const R = a[2].map((x) => this.resolve(x)).filter(Boolean); ac.setMode(mode, R[R.length - 1] || null, R); }
          else ac.setMode(mode, a[2] ? this.resolve(a[2]) : null);
          break;
        }
        case 'director': if (g.director && a[0] && a[0].ambient != null) g.director.cfg.enemyCount = a[0].ambient; break;
        case 'give': this._give(a[0]); break;
        case 'take': break;
        case 'loadout': this._loadout(a[0] || this.ch.loadout); break;
        case 'weather': if (typeof g.setWeather === 'function' && g.weather) { try { g.setWeather(a[0], { instant: !!a[1] }); } catch (e) { /* 無視 */ } } break;
        case 'music': if (g.audio && typeof g.audio.music === 'function') g.audio.music(a[0]); break;
        case 'sfx': if (g.audio && typeof g.audio.play === 'function') g.audio.play(a[0], { priority: 2 }); break;
        case 'explode': { const p = this.resolve(a[0]); if (p) g.explode(p.x, p.y + 0.3, p.z, 0, 1, 0, a[1] || 'carCrash', a[2] === 'self' ? 'self' : null, null, {}); break; }
        case 'breach': this._breach(a[0], a[1]); break;
        case 'support': this._support(a[0]); break;
        case 'vtol': this._vtolCmd(a); break;
        case 'vehicle': this._vehicleCmd(a); break;
        case 'fade': if (ui) ui.fade(+a[0], a[1] == null ? 0.5 : +a[1]); break;
        case 'teleport': { const p = this.resolve(a[0]); if (p) { g.placePlayer(p.x, p.z, p.y + 0.4, p.yaw || 0); } break; }
        case 'area': this._area(a); break;
        case 'timer': break;
        case 'checkpoint': this._checkpoint(); break;
        case 'relight': if (this.lights) this.lights.relight(a[0], !!a[1]); this._relit(a[0]); break;
        case 'blackout': { const ids = Array.isArray(a[0]) ? a[0] : [a[0]]; this._blackout(ids, a[1] || 0.6); break; }
        case 'intel': this._intel(a[0]); break;
        case 'unlock': { const p = StoryStore.get(); for (const u of (Array.isArray(a[0]) ? a[0] : [a[0]])) if (p.unlocks.indexOf(u) < 0) p.unlocks.push(u); break; }
        case 'hint': if (ui) ui.toast(a[0], a[1] || 2.5); break;
        case 'billboard': this._billboard(a[0]); break;
        case 'choice': this._choice(a[0]); break;
        case 'failed': break;
        case 'end': if (a[0] === 'fail') this._fail(StoryMode.FAIL_TEXT[a[1]] || (typeof a[1] === 'string' && /[^\x00-\x7f]/.test(a[1]) ? a[1] : '任務失敗')); else this._success(); break;
        default: break;
      }
    }

    _pause(on) { this.paused = !!on; this.runner.pause(on || !!this.cine); if (this.game.input) { if (on) this.game.input.reset(); } }

    _give(o) {
      const play = this.game.play; if (!play || !o) return;
      const inv = play.inv;
      for (const w of o.weapons || []) { const d = this.game.weapons.find((x) => x.def.id === w); inv.equip(w, d ? d.def.magazineSize : 0); }
      for (const cal of Object.keys(o.ammo || {})) inv.addAmmo(cal, o.ammo[cal]);
      for (const m of Object.keys(o.meds || {})) inv.addMed(m, o.meds[m]);
      if (o.vest) inv.wear('vest');
      if (o.helmet) inv.wear('helmet');
      const s = inv.cur >= 0 ? inv.cur : inv.firstSlot();
      if (s >= 0) { inv.cur = -1; play.selectSlot(s, true); }
    }
    _loadout(L) {
      const play = this.game.play; if (!play || !L) return;
      const weapons = (L.slots || L.weapons || []).filter(Boolean);
      play.inv.reset({ weapons, ammo: L.ammo || {}, meds: L.meds || {}, vest: !!L.vest, helmet: !!L.helmet });
      const s = play.inv.firstSlot();
      if (s >= 0) { play.inv.cur = -1; play.selectSlot(s, true); }
    }

    // ---------- 七号機 ----------
    _vtolCmd(a) {
      const id = typeof a[1] === 'string' && this.ch.actors && this.ch.actors[a[1]] && this.ch.actors[a[1]].kind === 'vtol' ? a.splice(1, 1)[0] : (Object.keys(this.ch.actors || {}).find((k) => this.ch.actors[k].kind === 'vtol') || 'no7');
      const sv = this._ensureActor(id);
      if (!sv) return;
      const op = a[0];
      if (op === 'hover') { const p = this.resolve(a[1]); if (p) sv.hoverAt(p, a[2] != null ? a[2] : p.yaw, !!a[3]); }
      else if (op === 'path') { const pts = (a[1] || []).map((x) => this.resolve(x)).filter(Boolean); sv.followPath(pts, a[2], a[3]); }
      else if (op === 'ramp') sv.ramp(a[1] !== false);
      else if (op === 'board') this.boardZone = { id };
      else if (op === 'unboard') this.boardZone = null;
      else if (op === 'fire') { const p = this.resolve(a[1]); if (p) sv.fireAt(p, a[2] || 2); }
      else if (op === 'seats') this.seatsOk = a[1] !== false; // 機内の席（「操縦する」）を許す
      else if (op === 'pilot') {
        // プレイヤーを操縦席へ（ランプから乗った後 = boarded の後）。台本の自動操縦はやめる
        const g = this.game, v = sv.v; if (!v || v.wrecked) return;
        sv.release();
        if (g.vehicle === v && (g.vehicleSeat | 0) !== 0) g._exitVehicle(true); // 副操縦席で cockpit を満たした: 操縦席へ移す（地上の甲板）
        if (g.vehicle !== v) g._enterVehicle(v, true, 0);
        this._pilotV = v; // 空中で七号機を離れたら失敗（_updatePilot）
      }
      else if (op === 'park') { const p = this.resolve(a[1]); if (p) sv.park(p, a[2] != null ? a[2] : p.yaw); }
      else if (op === 'leave') { const v = sv.v; if (v) sv.followPath([{ x: v.pos.x + Math.sin(v.yaw) * 400, y: v.pos.y + 120, z: v.pos.z + Math.cos(v.yaw) * 400 }], 45); }
    }

    _vehicleCmd(a) {
      const g = this.game, op = a[0];
      if (op === 'spawn') {
        const p = this.resolve(a[2]); if (!p) return;
        // 同じ札の生きている台本の車があれば先に消す（チェックポイントのやり直しで step の do がもう一度出す = 2 台にならない）
        for (const o of (this.storyVehicles || []).slice()) if (o.storyTag === (a[3] || a[1])) this._removeVehicle(o);
        const v = g._makeCityVehicle({ id: 'story_' + a[3], type: a[1], x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0 }, null);
        if (v) { v.storyPinned = true; v.storyTag = a[3] || a[1]; v.cityTouched = true; (this.storyVehicles || (this.storyVehicles = [])).push(v); }
      } else if (op === 'destroy') {
        // 台本で壊す（支援射撃の場面: 爆風が装甲に足りなくても必ず壊れる）
        const v = (this.storyVehicles || []).slice().reverse().find((x) => x.storyTag === a[1] && !x.wrecked);
        if (v && !v.wrecked && typeof v.damage === 'function') v.damage(1e6, g._vehicleCtx());
      }
    }

    _removeVehicle(v) {
      const g = this.game;
      if (v === g.vehicle) return;
      const i = g.vehicles.indexOf(v);
      if (v.headlight) v.detachHeadlight();
      try { v.dispose(); } catch (e) { /* 無視 */ }
      if (i >= 0) g.vehicles.splice(i, 1);
      if (g._cityVehById) g._cityVehById.delete(v.cityId);
      this.storyVehicles = (this.storyVehicles || []).filter((x) => x !== v);
    }
    // 乗る（V2）: 傾斜板を歩いて機内に入った（vtol.js の boarded の数が増えた = 'boarded'）。外の「乗る」は無い。
    //  乗せる人の数（step の count: ['civBoarded', n]）がそろうまでは待つ（先に入っても、そろった時に boarded）
    _updateBoard(dt) {
      const z = this.boardZone;
      if (!z) return;
      const sv = this.actors[z.id], v = sv && sv.v;
      if (!v) return;
      if (z.n0 == null) {
        z.n0 = v.boarded | 0;
        // 乗る step が始まった時にもう機内にいる（止めてある機体は傾斜板が開いている = 戦いの間に機内に入った）: その時点で乗った
        if (v._walkerIn && v.onPlatform && v.onPlatform(this.game.player)) z.in = true;
      }
      if (!z.in && (v.boarded | 0) > z.n0) z.in = true; // V2 の本物の 'boarded'（歩いて機内の床の縁を越えた）だけ
      if (!z.in) return;
      const cnt = this.runner.step && this.runner.step.count;
      if (cnt && cnt[0] === 'civBoarded' && (this.runner.facts.civBoarded || 0) < (+cnt[1] || 0)) {
        if (this.ui && !(this._boardHintT > this.game.time)) { this.ui.toast('市民が乗るのを待つ', 1.6); this._boardHintT = this.game.time + 4; }
        return;
      }
      this.boardZone = null;
      this.runner.event('boarded');
    }

    // 操縦を任された七号機（vtol pilot の後）から空中で降りた = 失敗（無人で降りた所によっては傾斜板が開かず、先へ進めなくなる）
    _updatePilot() {
      const v = this._pilotV;
      if (!v || this.over || this._repilot) return;
      if (v.wrecked || v.disposed) { this._pilotV = null; return; } // 墜ちた: 章の fail（vehicleDead）
      if (this.game.vehicle !== v && !v.grounded) { this._pilotV = null; this._fail('七号機を離れた'); }
    }

    // ---------- 調べる物（乗る ボタン / F）----------
    _activeInter() {
      const I = this.ch.interact || {}, out = [];
      for (const id of Object.keys(I)) {
        if (this.interDone[id]) continue;
        const d = I[id];
        if (d.intel || d.always || this.markIds.indexOf(id) >= 0) out.push(id);
      }
      return out;
    }
    _nearInter() {
      if (this.cine || this.paused || this.over) return null;
      const P = this.game.player.pos, R = this.cfg.interact;
      let best = null, bd = Infinity;
      for (const id of this._activeInter()) {
        const d0 = this.ch.interact[id], p = this.resolve(d0.at);
        if (!p) continue;
        const d = Math.hypot(P.x - p.x, P.z - p.z);
        if (d <= (d0.radius || R.radius) && Math.abs(P.y - p.y) <= R.dy && d < bd) { bd = d; best = id; }
      }
      return best;
    }
    prompt() {
      if (this.hold) return null;
      const id = this._nearInter();
      if (!id) return null;
      const d = this.ch.interact[id];
      return (d.verb || '調べる') + (d.label ? '：' + d.label : '');
    }
    press() {
      const id = this._nearInter();
      if (!id || this.hold) return false;
      const d = this.ch.interact[id];
      if (d.hold) { this.hold = { id, def: d, t: 0, need: d.hold }; return true; }
      this._interacted(id);
      return true;
    }
    _interacted(id) {
      const d = this.ch.interact[id];
      this.interDone[id] = true;
      if (d.intel) this._intel(d.intel);
      if (d.sfx && this.game.audio && this.game.audio.play) this.game.audio.play(d.sfx, { priority: 2 });
      this.runner.event('interact', { id });
      if (d.hold) this.runner.event('held', { id });
    }
    _updateHold(dt) {
      const h = this.hold;
      if (!h) { if (this.ui && this.ui.holdV >= 0) this.ui.holdGauge(null); return; } // 押さえるのが終わった・消えた（チェックポイント・飛ばした step）のゲージを残さない
      const P = this.game.player, p = this.resolve(h.def.at);
      if (P.dead || !p || Math.hypot(P.pos.x - p.x, P.pos.z - p.z) > this.cfg.interact.holdCancelDist) { this.hold = null; if (this.ui) { this.ui.holdGauge(null); this.ui.toast('離れたので中断', 1.2); } return; }
      h.t += dt;
      if (this.ui) this.ui.holdGauge(Math.min(1, h.t / h.need), (h.def.label || '') + ' ' + (h.def.verb || ''));
      if (h.t >= h.need) { this.hold = null; if (this.ui) this.ui.holdGauge(null); this._interacted(h.id); }
    }

    _intel(id) {
      const card = (this.ch.intel || []).find((x) => x.id === id);
      if (!card) return;
      const p = StoryStore.get();
      if (p.intel.indexOf(id) < 0) p.intel.push(id);
      this.intelGot = (this.intelGot || 0) + 1;
      if (this.ui) { this._pause(true); this.ui.intel(card, () => this._pause(false)); }
    }

    // ---------- 破る（壁の穴）----------
    _breach(anchor, r) {
      const g = this.game, p = this.resolve(anchor);
      if (!p) return;
      const n = this.resolve({ at: anchor, d: [0, 0, 0] });
      g.explode(p.x, p.y + 1.2, p.z, 0, 0, 0, 'carCrash', null, null, { struct: { radius: r || 3.5, damage: 2000 } });
      if (g.destruct) g.structHit({ x: p.x, y: p.y + 1.2, z: p.z, radius: r || 3.5, damage: 2000, kind: 'missile' });
      this.breached = (this.breached || 0) + 1;
      void n;
    }

    // ---------- 支援射撃 ----------
    _support(n) {
      if (n === 'off' || n === false || n === 0) { this.strike = null; this._strikeHome = null; if (this.ui) this.ui.setStrike(null); this._strikeLine(null); return; }
      // refill: 撃ち尽くしても冷めの後に 1 回戻る（外して装甲車が残ると先へ進めなかった）
      this.strike = { n: +n || 1, cool: 0, aiming: false, line: null, pending: null, refill: this.cfg.strike.refill !== false };
    }
    // 照準の地面の点（カメラの前のレイ）と向きから 1 本の線
    _strikeAim() {
      const g = this.game, cam = g.camera, nav = g.world.nav;
      const o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
      const h = nav.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 300);
      let px, py, pz;
      if (h) { px = h.x; py = h.y; pz = h.z; } else { const t = d.y < -0.05 ? (o.y - g.player.pos.y) / -d.y : 60; px = o.x + d.x * t; py = g.player.pos.y; pz = o.z + d.z * t; }
      const yaw = Math.atan2(d.x, d.z), L = this.cfg.strike.length;
      return { x0: px - Math.sin(yaw) * L / 2, z0: pz - Math.cos(yaw) * L / 2, x1: px + Math.sin(yaw) * L / 2, z1: pz + Math.cos(yaw) * L / 2, y: py, cx: px, cz: pz, yaw };
    }
    _strikeTooClose(L) {
      const nf = this.cfg.strike.noFire;
      const pts = [this.game.player.pos].concat(Object.keys(this.actors).map((k) => this.actors[k]).filter((a) => a.kind !== 'vtol' && !a.gone).map((a) => a.pos));
      for (const p of pts) {
        const vx = L.x1 - L.x0, vz = L.z1 - L.z0, l2 = vx * vx + vz * vz || 1;
        const u = Math.max(0, Math.min(1, ((p.x - L.x0) * vx + (p.z - L.z0) * vz) / l2));
        if (Math.hypot(p.x - (L.x0 + vx * u), p.z - (L.z0 + vz * u)) < nf) return true;
      }
      return false;
    }
    pressStrike() {
      const S = this.strike;
      if (!S || this.cine || this.over || this.game.player.dead) return false;
      if (S.n <= 0 || S.cool > 0 || S.pending) return false;
      if (!S.aiming) { S.aiming = true; return true; }
      const L = this._strikeAim();
      if (this._strikeTooClose(L)) { if (this.ui) this.ui.toast('近すぎる — 味方に当たる', 1.6); this.stats.strikeRefused = (this.stats.strikeRefused || 0) + 1; return false; }
      S.aiming = false; S.n--; S.cool = this.cfg.strike.cooldown;
      S.pending = { L, t: 0, k: 0 };
      this.stats.strikes++;
      if (this.ui) this.ui.radio([['genji', 'ゲンジ、了解。' + Math.round(this.cfg.strike.delay) + ' 秒で行く']], null);
      if (this.game.audio && this.game.audio.play) this.game.audio.play('strike_inbound', { priority: 2 });
      // 七号機が線の上を通る
      const sv = this.actors[Object.keys(this.actors).find((k) => this.actors[k].kind === 'vtol')];
      if (sv && sv.v) {
        // 弾はゲームが撃つ（_updateStrike）ので機体の通り道は見せるだけ: 線の上の一番高い箱 + routeClear より上をまっすぐ（塔の間を 60 m で
        // 抜けようとして登り降りの区間に分かれ、第4章ではロックフェラーの塔を越えて 285 m まで上がって戻るのに 1 分かかっていた）。通ったら待つ所へ戻る
        const home = this._strikeHome || (this._strikeHome = { x: sv.v.pos.x, y: sv.v.pos.y, z: sv.v.pos.z });
        const a = { x: L.x0 - Math.sin(L.yaw) * 120, y: 0, z: L.z0 - Math.cos(L.yaw) * 120 }, b = { x: L.x1 + Math.sin(L.yaw) * 160, y: 0, z: L.z1 + Math.cos(L.yaw) * 160 };
        const H = Math.max(L.y + this.cfg.strike.height, sv._lineTop({ x: a.x, y: 0, z: a.z }, { x: b.x, y: 0, z: b.z }) + sv.cfg.routeClear);
        a.y = H; b.y = H + 20;
        // 塔に囲まれた所（待つ所から maxClimb m より上がらないと通れない）は待つ所で線の方を向くだけ（上がって戻るのに何十秒もかかる）
        if (H - home.y > (this.cfg.strike.maxClimb != null ? this.cfg.strike.maxClimb : 40)) sv.hoverAt(home, Math.atan2((L.x0 + L.x1) / 2 - home.x, (L.z0 + L.z1) / 2 - home.z) * 180 / Math.PI);
        else sv.followPath([a, b, { x: home.x, y: H + 20, z: home.z }, home], 70);
        this._strikeVtol = sv;
      }
      return true;
    }
    _updateStrike(dt) {
      const S = this.strike;
      if (!S) return;
      if (S.cool > 0) S.cool = Math.max(0, S.cool - dt);
      if (S.n <= 0 && S.refill && !S.pending && S.cool <= 0) { S.n = 1; if (this.ui) this.ui.toast('支援射撃 もう一度使えます', 1.6); }
      const P = S.pending;
      if (P) {
        P.t += dt;
        const C = this.cfg.strike, t0 = C.delay, t1 = C.delay + C.pass;
        while (P.t >= t0 + (t1 - t0) * (P.k / C.shots) && P.k < C.shots) {
          const u = (P.k + 0.5) / C.shots, L = P.L;
          const x = L.x0 + (L.x1 - L.x0) * u, z = L.z0 + (L.z1 - L.z0) * u;
          this._strikeHit(x, this._groundY(x, z, L.y), z, true);
          P.k++;
        }
        if (P.k >= C.shots) S.pending = null;
      }
      if (this.ui) this.ui.setStrike(S.n > 0 || S.pending || S.cool > 0 ? { n: S.n, ready: S.n > 0 && S.cool <= 0 && !S.pending, cool: S.cool, aiming: S.aiming } : null);
      this._strikeLine(S.aiming ? this._strikeAim() : null);
    }
    _groundY(x, z, y) { const g = this.game.world.nav.groundHeight(x, z, y + 3, 6); return g === null ? y : g; }
    _strikeHit(x, y, z, mine) {
      const g = this.game, C = this.cfg.strike;
      const from = new THREE.Vector3(x - 8, y + C.height, z - 8), to = new THREE.Vector3(x, y, z);
      if (g.fx && g.fx.streak) g.fx.streak(from, to); else if (g.fx) g.fx.tracer(from, to, false);
      this._striking = !!mine;
      try { g.explode(x, y + 0.2, z, 0, 1, 0, C.blast || 'vtol_gun', mine ? 'self' : null, null, { struct: { radius: 2, damage: 300 } }); } finally { this._striking = false; }
    }
    // 照準の線（地面に平らな板 1 枚。照準の間だけ）
    _strikeLine(L) {
      const g = this.game;
      if (!L) { if (this._lineMesh) this._lineMesh.visible = false; return; }
      if (!this._lineMesh) {
        const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: MR.srgb('#ff5a3c'), transparent: true, opacity: 0.55, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
        this._lineMesh = new THREE.Mesh(geo, mat); this._lineMesh.renderOrder = 3; this._lineMesh.frustumCulled = false;
        g.scene.add(this._lineMesh);
      }
      const m = this._lineMesh;
      m.visible = true;
      m.position.set(L.cx, L.y + 0.15, L.cz);
      m.rotation.set(0, L.yaw, 0);
      m.scale.set(this._strikeTooClose(L) ? 1.2 : 2.4, 1, this.cfg.strike.length);
      m.material.color.copy(MR.srgb(this._strikeTooClose(L) ? '#7a7a7a' : '#ff5a3c'));
    }

    // ---------- 作戦の範囲（青い壁）----------
    _area(a) {
      const g = this.game;
      if (a[0] === 'off' || a[0] === false) { this.area = null; if (this.wall) this.wall.visible = false; return; }
      const p = this.resolve(a[0]); if (!p) return;
      this.area = { x: p.x, y: p.y, z: p.z, r: +a[1] || p.r || 40 };
      if (!this.wall) {
        const geo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true); geo.translate(0, 0.5, 0);
        const tex = MR.RoyaleMode && MR.RoyaleMode.wallTexture ? MR.RoyaleMode.wallTexture() : null;
        const mat = new THREE.MeshBasicMaterial({ color: MR.srgb('#4fd6ff'), map: tex, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
        this.wall = new THREE.Mesh(geo, mat); this.wall.frustumCulled = false; this.wall.renderOrder = 2;
        g.scene.add(this.wall);
      }
      this.wall.visible = true;
      this.wall.position.set(this.area.x, this.area.y - 2, this.area.z);
      this.wall.scale.set(this.area.r, 24, this.area.r);
    }

    // ---------- 灯 ----------
    _relit(id) { const p = StoryStore.get(); if (p.relit.indexOf(id) < 0) p.relit.push(id); }
    _blackout(ids, stagger) {
      this._blackQ = ids.map((id, i) => ({ id, t: i * stagger }));
    }
    _updateBlackout(dt) {
      const q = this._blackQ; if (!q || !q.length) return;
      for (const e of q) { e.t -= dt; if (e.t <= 0 && !e.done) { e.done = true; if (this.lights) this.lights.blackout(e.id); } }
      this._blackQ = q.filter((e) => !e.done);
    }

    // ---------- 場面（cine）----------
    _startCine(id) {
      const g = this.game, shot = (this.ch.shots || {})[id];
      if (!shot || !MR.StoryCam) { this.runner.event('done', { id }); return; }
      if (this.cine) this._endCine(true);
      // 場面の前の命令（七号機を置く・役者の位置）
      for (const pc of shot.pre || []) this._exec({ verb: pc[0], args: pc.slice(1), step: this.stepId });
      const cam = new MR.StoryCam(g.camera, shot, (x) => this.resolve(x));
      this.cine = { id, cam, shot, t: 0, relit: false, black: false };
      this.runner.pause(true);
      g.input.reset();
      if (g.input.disable) g.input.disable();
      if (g.viewRoot) g.viewRoot.visible = false;
      if (this.ui) { this.ui.letterbox(!!shot.letterbox || shot.letterbox == null); this.ui.clearRadio(); }
      if (shot.lines && this.ui) this.ui.talk(this.ch.lines[shot.lines] || [], null, shot.lines);
      if (this.ui) this.ui.setAuto(true);
      if (g.world.streamer) g.world.streamer.lead = { x: cam.keys[0].p.x, z: cam.keys[0].p.z };
      this.stats.cines = (this.stats.cines || 0) + 1;
    }
    updateCine(dt) {
      const C = this.cine; if (!C) return;
      C.t += dt;
      C.cam.update(dt);
      const S = C.shot;
      if (S.relight && !C.relit && C.t >= (S.relight.at || 0)) { C.relit = true; if (this.lights) this.lights.relight(S.relight.zone); this._relit(S.relight.zone); }
      if (S.blackout && !C.black && C.t >= (S.blackout.at || 0)) { C.black = true; this._blackout(S.blackout.zones || [], S.blackout.stagger || 0.6); }
      if (C.cam.done && !(this.ui && this.ui.talking && S.waitLines)) this._endCine(false);
    }
    skipCine() {
      const C = this.cine; if (!C) return false;
      C.cam.skip();
      const S = C.shot;
      if (S.relight && !C.relit) { C.relit = true; if (this.lights) this.lights.relight(S.relight.zone, true); this._relit(S.relight.zone); }
      if (S.blackout && !C.black) { C.black = true; if (this.lights) for (const z of S.blackout.zones || []) this.lights.blackout(z, true); }
      this._endCine(true);
      return true;
    }
    _endCine(skipped) {
      const C = this.cine, g = this.game; if (!C) return;
      this.cine = null;
      C.cam.restore();
      if (g.input.enable) g.input.enable();
      g.input.reset();
      if (g.viewRoot && !g.vehicle) g.viewRoot.visible = true;
      if (this.ui) { this.ui.letterbox(false); if (this.ui.talking) this.ui.skipTalk(); this.ui.setAuto(false); }
      if (g.world.streamer) g.world.streamer.lead = null;
      for (const pc of C.shot.post || []) this._exec({ verb: pc[0], args: pc.slice(1), step: this.stepId });
      this.runner.pause(this.paused);
      this.runner.event('done', { id: C.id });
      if (C.shot.lines) this.runner.event('done', { id: C.shot.lines });
      this._pump();
    }

    // ---------- チェックポイント ----------
    _checkpoint() {
      const g = this.game, P = g.player, inv = g.play ? g.play.inv : null;
      const st = this.runner.cpState;
      if (!st) return;
      const doSpawns = new Set(((this.runner.step && this.runner.step.do) || []).filter((x) => x[0] === 'spawn').map((x) => x[1]));
      const units = [];
      for (const gid of Object.keys(this.groupUnits)) {
        if (doSpawns.has(gid)) continue;
        this.groupUnits[gid].forEach((e, k) => { if (e && !e.dead && !e.removed) units.push([gid, k, +e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2)]); });
      }
      const actors = {};
      for (const id of Object.keys(this.actors)) {
        const a = this.actors[id];
        if (a.kind === 'vtol') { const v = a.v; actors[id] = v ? { vtol: 1, p: [+v.pos.x.toFixed(2), +v.pos.y.toFixed(2), +v.pos.z.toFixed(2)], yaw: +(v.yaw / D2R).toFixed(1), ramp: a.rampWant, air: v.grounded ? 0 : 1, pilot: g.vehicle === v && (g.vehicleSeat | 0) === 0 ? 1 : 0 } : null; }
        else actors[id] = { p: [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)], yaw: +((a.body.yaw / D2R) - 180).toFixed(1), mode: a.mode, t: a.target ? [a.target.x, a.target.y, a.target.z] : null, gone: a.gone ? 1 : 0, route: a.route ? a.route.map((q) => [q.x, q.y, q.z]) : null, ri: a.routeI };
      }
      const rec = {
        ch: this.ch.id, step: st.step, state: st, t: Date.now(),
        spot: { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), yawDeg: +(P.yawAngle / D2R).toFixed(1) },
        hp: Math.round(P.health),
        inv: inv ? { slots: inv.slots.map((s) => (s ? { id: s.id, ammo: s.ammo } : null)), ammo: Object.assign({}, inv.ammo), meds: Object.assign({}, inv.meds), vest: inv.vest ? inv.vest.dur : 0, helmet: inv.helmet ? inv.helmet.dur : 0, cur: inv.cur } : null,
        seatsOk: this.seatsOk ? 1 : 0,
        aaDead: g.airDefense && this.ch.airDefense ? g.airDefense.sites.map((s, i) => (s.dead ? i : -1)).filter((i) => i >= 0) : null,
        billboard: this.billboardMode || null, units, actors, vehicles: (this.storyVehicles || []).map((v) => v.cityId), lights: this.lights ? this.lights.zones.map((z) => [z.id, z.to > 0 ? 1 : 0]) : null,
        strike: this.strike ? { n: this.strike.n, refill: !!this.strike.refill } : null, area: this.area, board: this.boardZone ? { id: this.boardZone.id } : null, inter: Object.assign({}, this.interDone), stats: { kills: this.stats.kills, damage: this.stats.damage, sec: g.time - this.stats.t0 }
      };
      // 持ち物の装填数をそろえてから
      if (g.play && g.play._syncSlotAmmo) { g.play._syncSlotAmmo(); if (rec.inv) rec.inv.slots = inv.slots.map((s) => (s ? { id: s.id, ammo: s.ammo } : null)); }
      // 壊れた物（destruct）の記録の鍵: やり直しでこの後に壊した壁・小物を戻す（b16）。保存（16 KB）には入れない = メモリだけ
      this._cpDx = this._dxMark();
      this.lastCp = rec;
      this.stats.cps++;
      const p = StoryStore.get();
      p.cp = rec;
      StoryStore.save(this.cfg.save.maxBytes);
      if (this.ui) this.ui.toast('チェックポイント', 1.2);
    }

    // チェックポイントからやり直す（その場で）。first: 章の始め（続きから）
    _restoreCp(rec, first) {
      const g = this.game;
      // 隊員を消す
      for (const e of g.enemies) if (e.storyTag) e.removed = true;
      this.groupUnits = {}; this.waves = {};
      this.hold = null; this.over = null; this.failT = 0; this._pilotV = null;
      // 開いていた資料のカードを閉じて止めを外す（閉じないとやり直しの後も Runner が止まったまま）
      if (this.ui && this.ui.intelCur) { this.ui.intelCur = null; this.ui.intelCb = null; if (this.ui.el.intel) this.ui.el.intel.classList.add('hidden'); this.ui._modal(); }
      if (this.paused) this._pause(false);
      if (this.ui) { this.ui.hideFail(); this.ui.hideResult(); this.ui.holdGauge(null); this.ui.clearRadio(); this.ui.radioDone.length = 0; } // 消した無線を「聞き終えた」にしない（戻した Runner に届く）
      if (!first) {
        // チェックポイントの後に壊した物を戻す（b16: 以前はやり直しても破った壁・銃の穴・壊れた小物がそのまま = 同じ場面が違う形になった）
        if (rec === this.lastCp && this._cpDx && g.destruct && typeof g.destruct.rollback === 'function') this.stats.dxRolledBack = (this.stats.dxRolledBack || 0) + g.destruct.rollback(this._cpDx);
        g._respawnPlayer(rec.spot);
        this.stats.retries++;
      }
      // やり直しの体力の下限 story.cpMinHp（b17: 30 だと iPad で c2 の「捜索」が同じ窓の波へ 30 で戻り、すぐまた倒れた）
      g.player.health = Math.min(g.config.player.maxHealth, Math.max((g.config.story && g.config.story.cpMinHp) || 30, rec.hp || g.config.player.maxHealth));
      g.hud.setHealth(g.player.health, g.config.player.maxHealth);
      // 持ち物
      const play = g.play, I = rec.inv;
      if (play && I) {
        play.inv.reset({ weapons: [] });
        I.slots.forEach((s, i) => { if (s) play.inv.slots[i] = { id: s.id, ammo: s.ammo }; });
        for (const c of Object.keys(I.ammo || {})) play.inv.ammo[c] = I.ammo[c];
        for (const m of Object.keys(I.meds || {})) play.inv.meds[m] = I.meds[m];
        if (I.vest) play.inv.wear('vest', I.vest);
        if (I.helmet) play.inv.wear('helmet', I.helmet);
        play.inv.version++;
        const s = I.cur >= 0 && play.inv.slots[I.cur] ? I.cur : play.inv.firstSlot();
        if (s >= 0) { play.inv.cur = -1; play.selectSlot(s, true); }
      }
      // 灯
      if (this.lights && rec.lights) { const dark = rec.lights.filter((z) => !z[1]).map((z) => z[0]); this.lights.setDark(dark); }
      // 役者
      for (const id of Object.keys(rec.actors || {})) {
        const s = rec.actors[id], a = this._ensureActor(id);
        if (!a || !s) continue;
        if (a.kind === 'vtol') {
          const p = { x: s.p[0], y: s.p[1], z: s.p[2] };
          a.rampWant = s.ramp || 0;
          // 墜ちた・沈んだ七号機は直してから（やり直しで残骸の横に立たない）
          if (a.v && (a.v.wrecked || a.v.sinking || a.v.sunk) && typeof a.v.respawn === 'function') a.v.respawn();
          if (g.vehicle === a.v) g._exitVehicle && g._exitVehicle();
          if (s.air) a.hoverAt(p, s.yaw, true); else a.park(p, s.yaw);
          if (a.v && !s.air) a.v.openRamp(!!a.rampWant);
          // 操縦していた（空中のチェックポイント）: 操縦席に戻す（_respawnPlayer の後に座る）
          if (s.pilot && a.v) { a.release(); this._repilot = a.v; this._pilotV = a.v; }
        } else {
          a.placeAt({ x: s.p[0], y: s.p[1], z: s.p[2], yaw: s.yaw });
          if (s.gone) { a.gone = true; a.boarded = true; a.body.group.visible = false; }
          a.setMode(s.mode || 'idle', s.t ? { x: s.t[0], y: s.t[1], z: s.t[2] } : null, s.route ? s.route.map((q) => ({ x: q[0], y: q[1], z: q[2] })) : null);
          if (s.route) a.routeI = s.ri || 0;
        }
      }
      // 調べ終わった物は step に入ったときの Runner の状態から（rec.inter は checkpoint を出した時 = step の do の wait の後なので、その間に話した人が
      // 「話した」のまま戻り、Runner の facts は話していない = until が成り立たなくなっていた）
      this.interDone = {};
      const fi = rec.state && rec.state.facts && rec.state.facts.interact;
      if (fi) for (const k of Object.keys(fi)) if (fi[k]) this.interDone[k] = true;
      this.boardZone = rec.board || null;
      this.seatsOk = !!rec.seatsOk;
      if (rec.area) this._area([{ p: [rec.area.x, rec.area.y, rec.area.z] }, rec.area.r]); else this._area(['off']);
      this.choiceCur = null; if (this.ui) this.ui.hideChoice();
      if (rec.billboard) this._billboard(rec.billboard); else if (this._bbOrig) this._billboardRestore();
      this._support('off'); // 照準の線・ボタンを消してから
      // 支援射撃: チェックポイントの step の do が support を出すなら、do に任せる（先に戻すと do の wait の間に前の装甲車を撃てて、新しい装甲車を倒さずに step が進んだ）
      const cpStep = (this.ch.steps || []).find((x) => x.id === rec.step);
      const doSupport = !!(cpStep && (cpStep.do || []).some((d) => d[0] === 'support'));
      if (rec.strike && !doSupport) this._support(rec.strike.n); if (this.strike && rec.strike && rec.strike.refill) this.strike.refill = true;
      // チェックポイントの後に出した台本の車は消す（やり直しで 2 台目にならない）
      const keepV = new Set(rec.vehicles || []);
      for (const v of (this.storyVehicles || []).slice()) if (!keepV.has(v.cityId)) this._removeVehicle(v);
      if (rec.stats && first) { this.stats.kills = rec.stats.kills || 0; this.stats.damage = rec.stats.damage || 0; this.stats.t0 = g.time - (rec.stats.sec || 0); }
      // 生きていた隊員（この step の do が出す隊は do が出し直す）
      const D = g.director || (g.director = new MR.EnemyDirector(g, Object.assign({}, g.cityCfg, { enemyCount: 0 })));
      // Runner（step に入り直す = do をもう一度）
      this.runner.fromJSON(rec.state);
      // 黙らせた対空陣地はやり直しでも黙ったまま（陣地は戻らない）= 数は今の数に合わせる
      if (this.ch.airDefense && g.airDefense && g.airDefense.sites) {
        // 続きから（新しい AirDefense）は黙らせた陣地を記録から黙らせ直す
        for (const i of rec.aaDead || []) { const s = g.airDefense.sites[i]; if (s && !s.dead) { s.dead = true; s.st = 'dead'; s.target = null; s.deadUntil = 1e15; } }
        const n = g.airDefense.sites.filter((s) => s.dead).length; this.runner.counters.aa = n; this._aaDead = n;
      }
      if (this._repilot) { const v = this._repilot; this._repilot = null; if (!v.wrecked && g.vehicle !== v) g._enterVehicle(v, true, 0); }
      for (const u of rec.units || []) {
        const G0 = (this.ch.groups || {})[u[0]]; if (!G0) continue;
        const e = this._spawnUnit(u[0], G0, u[1] % (G0.n || 1), D, { x: u[2], y: u[3], z: u[4] });
        if (e) { (this.groupUnits[u[0]] || (this.groupUnits[u[0]] = []))[u[1]] = e; }
      }
      this.lastCp = rec;
      // 続きから（first）: この起動で印を付けていないので、今の記録を印にする（b16.1: 以前は null のままで、続きからの後のやり直しは壊した壁を戻さなかった）
      if (first) this._cpDx = this._dxMark();
      if (this.ui) this.ui.fade(1, 0), this.ui.fade(0, 0.8);
      this._pump();
    }
    // 壊れた物の記録の印（checkpoint() があれば記録ごと = 育った穴も戻せる）
    _dxMark() {
      const X = this.game.destruct;
      if (!X) return null;
      return typeof X.checkpoint === 'function' ? X.checkpoint() : typeof X.keys === 'function' ? X.keys() : null;
    }
    retry() { if (this.lastCp) this._restoreCp(this.lastCp, false); else this.game.leaveToTitle({ again: 'story:' + this.ch.id }); }

    // ---------- 失敗・成功 ----------
    _fail(why) {
      if (this.over) return;
      this.over = { result: 'fail', t: 0, why };
      this.choiceCur = null; if (this.ui) this.ui.hideChoice();
      this.stats.fails = (this.stats.fails || 0) + 1;
    }
    _success() {
      if (this.over) return;
      this.over = { result: 'success', t: 0 };
      const g = this.game, p = StoryStore.get(), R = this.ch.rewards || {};
      const sec = g.time - this.stats.t0;
      const intelTotal = (this.ch.intel || []).length, intel = (this.ch.intel || []).filter((x) => p.intel.indexOf(x.id) >= 0).length;
      const civTotal = this.stats.civTotal, civSafe = civTotal; // 民間人は撃たれない（ヴェールは民間人を撃たない）
      const r = MR.Story.rate({ sec, damage: this.stats.damage, accuracy: null, civTotal, civSafe, intel, intelTotal }, this.ch.rating);
      const prev = p.done[this.ch.id];
      const order = ['C', 'B', 'A', 'S'];
      p.done[this.ch.id] = { best: Math.round(prev && prev.best ? Math.min(prev.best, sec) : sec), rank: prev && order.indexOf(prev.rank) > order.indexOf(r.rank) ? prev.rank : r.rank, intel: (this.ch.intel || []).filter((x) => p.intel.indexOf(x.id) >= 0).map((x) => x.id) };
      if (R.relight) this._relit(R.relight);
      for (const u of R.unlock || []) if (p.unlocks.indexOf(u) < 0) p.unlocks.push(u);
      if (R.next && p.unlocked.indexOf(R.next) < 0) p.unlocked.push(R.next);
      if (p.unlocked.indexOf(this.ch.id) < 0) p.unlocked.push(this.ch.id);
      p.cp = null;
      p.playSec = (p.playSec || 0) + Math.round(sec);
      StoryStore.save(this.cfg.save.maxBytes);
      // 次の章はこのアプリで出撃できるときだけ（needs が APP_LEVEL より大きい章は「アップデート」= ボタンを出さない）
      const nextOk = R.next && (this.campaign.chapters || []).some((c) => c.id === R.next) && MR.Story.chapterState(this.campaign, p, R.next, { all: true }).ok;
      this.result = { title: this.ch.title, rank: r.rank, score: r.score, sec, kills: this.stats.kills, damage: this.stats.damage, civTotal, civSafe, intel, intelTotal, next: nextOk ? R.next : null };
      if (MR.Session) MR.Session.clear();
    }
    _updateOver(dt) {
      const O = this.over; if (!O) return;
      const g = this.game, ui = this.ui;
      O.t += dt;
      if (O.result === 'fail' && !O.shown && O.t >= this.cfg.failDelay) {
        O.shown = true;
        g.hud.showDeath(false);
        if (ui) ui.showFail(O.why, (w) => this.failChoice(w), !!this.lastCp);
      }
      if (O.result === 'success' && !O.shown && O.t >= this.cfg.resultDelay) {
        O.shown = true;
        if (ui) ui.showResult(this.result, (w) => this.resultChoice(w));
        if (g.input) g.input.reset();
      }
    }
    failChoice(w) {
      const g = this.game;
      if (w === 'cp' && this.lastCp) { this._restoreCp(this.lastCp, false); return; }
      if (w === 'ship') { g.leaveToTitle({ again: 'storyhub' }); return; }
      const p = StoryStore.get(); p.cp = null; StoryStore.save(this.cfg.save.maxBytes);
      g.leaveToTitle({ again: 'story:' + this.ch.id });
    }
    resultChoice(w) {
      const g = this.game;
      if (w === 'next' && this.result && this.result.next) { g.leaveToTitle({ again: 'story:' + this.result.next }); return; }
      if (w === 'again') { g.leaveToTitle({ again: 'story:' + this.ch.id }); return; }
      g.leaveToTitle({ again: 'storyhub' });
    }

    // ---------- 毎フレーム ----------
    tick() {
      // 死んでいても: 失敗・結果の画面
      const dt = this._lastDt || 1 / 60;
      this._updateOver(dt);
      if (this.ui && this.game.player.dead) this.ui.update(dt, this.game.camera);
    }
    update(dt) {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this._lastDt = dt;
      const g = this.game;
      if (!g.player.dead) {
        this.runner.tick(this.cine ? 0 : dt);
        // 無線を出し終えたせりふ
        if (this.ui && this.ui.radioDone.length) { for (const id of this.ui.radioDone) this.runner.event('done', { id }); this.ui.radioDone.length = 0; }
        this._pump();
        // 倒れたのに数えていない隊員（地面の火・落下など、手柄の無い死に方）も隊の数に
        for (const e of g.enemies) if (e.storyTag && e.dead && !e._storyCounted) this.onKill(e, 'other');
        this._updateWaves(dt);
        this._updateHold(dt);
        this._updateBoard(dt);
        this._updatePilot();
        this._updateStrike(dt);
        this._updateAA();
        this._updateUnstuck(dt);
        if (this.billboardMode && this._bbOrig && this._bbOrig.mat.map !== this._bbTex) this._billboard(this.billboardMode); // 後からファイルの絵が届いた
        if (this.choiceCur && this.choiceT > 0 && !this.paused) { this.choiceT -= dt; if (this.choiceT <= 0) { const c = this.choiceCur; this.choose(c.timeout != null ? +c.timeout : c.options.length - 1); } }
      }
      this._updateBlackout(dt);
      if (this.lights) this.lights.update(dt);
      // 役者
      const ctx = this._actorCtx(dt);
      for (const id of Object.keys(this.actors)) { const a = this.actors[id]; if (a.kind !== 'vtol') a.update(dt, ctx, this); else a.tick(dt); }
      // 目標・目印
      if (this.ui) {
        this.ui.objective(this.objText || '', this._countText(), this.runner.timer ? this.runner.timer.end - this.runner.stepT : null, this._objDist());
        this.ui.setMarks(this._marks());
        this.ui.update(dt, g.camera);
      }
      const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      this.stats.frames++; this.stats.cpuMs += ms; if (ms > this.stats.cpuMax) this.stats.cpuMax = ms;
    }
    // 迷子の隊員（b16）: 経路が無いまま story.unstuck.sec 秒、プレイヤーと高さが dy m より違う（別の階・格納庫に落ちた）隊員は出した所へ戻す。
    //   第5章の甲板の隊が舷側の通路から空母の格納庫（ship interiors）へ下りて、甲板へ戻る経路が無く、倒せない隊が残って章が進まなかった
    _updateUnstuck(dt) {
      const U = this.cfg.unstuck || {}, sec = U.sec > 0 ? U.sec : 6, dy = U.dy > 0 ? U.dy : 4, g = this.game, P = g.player.pos;
      this._unstuckT = (this._unstuckT || 0) + dt;
      if (this._unstuckT < 0.5) return;
      const step = this._unstuckT; this._unstuckT = 0;
      // b16.1: 高さの違う所が仕事の役（climber = 屋上へ上がる・overwatch = 見張り台）は迷子にしない（以前は第3章の climber が屋根と通りを行き来した）。
      //   プレイヤーに見えている隊員（画面の錐台の中 + 視線が通る）は動かさない（目の前で消えない）。出す所も見えない・近くない所だけ（下の okAt）
      const skip = U.skipRoles || ['climber', 'overwatch'], seeD = U.seeDist > 0 ? U.seeDist : 150, homeK = U.homeWaitK > 0 ? U.homeWaitK : 3, nav = g.world && g.world.nav;
      const popMin = U.popMin >= 0 ? U.popMin : 25, rings = U.altRings || [6, 12, 20], altN = U.altAngles > 0 ? U.altAngles : 8;
      const eye = g.player.eyePosition ? g.player.eyePosition(this._tmpEye || (this._tmpEye = new THREE.Vector3())) : { x: P.x, y: P.y + 1.6, z: P.z };
      const cam = g.camera, fr = this._fr || (this._fr = new THREE.Frustum()), pm = this._pm || (this._pm = new THREE.Matrix4()), sph = this._sph || (this._sph = new THREE.Sphere());
      // b17: 画面の錐台はカメラ、視線は目とカメラの両方から（3 人称の乗り物・ヘリ・VTOL ではカメラが体から離れていて、目からの視線だけでは
      //   画面に見えている隊員を見えないとして動かしていた）
      const cp = this._tmpCam || (this._tmpCam = new THREE.Vector3());
      if (cam) { cam.updateWorldMatrix(true, false); pm.multiplyMatrices(cam.projectionMatrix, pm.copy(cam.matrixWorld).invert()); fr.setFromProjectionMatrix(pm); cp.setFromMatrixPosition(cam.matrixWorld); }
      const losFrom = (o, x, y, z) => Math.hypot(x - o.x, y - o.y, z - o.z) < seeD && nav.lineOfSight(o.x, o.y, o.z, x, y, z);
      const seen = (x, y, z) => {
        if (!nav || typeof nav.lineOfSight !== 'function') return false;
        if (cam) { sph.center.set(x, y, z); sph.radius = 1.2; if (!fr.intersectsSphere(sph)) return false; }
        return losFrom(eye, x, y, z) || (cam && losFrom(cp, x, y, z));
      };
      // 出す所: 見えていない・プレイヤーから popMin m より遠い（目の前・すぐ横に急に出ない）。sec × homeWaitK を過ぎたら出した所の周りの輪
      //   （同じ高さの歩ける所）も探す（出した所がずっと見えている = 開けた甲板の下の隊員を、見えている甲板には出さずに戻す）
      const okAt = (x, y, z) => Math.hypot(x - P.x, y - P.y, z - P.z) >= popMin && !seen(x, y + 1.3, z) && !(cam && Math.hypot(x - cp.x, y - cp.y, z - cp.z) < popMin);
      const spot = (H, wide) => {
        if (okAt(H.x, H.y, H.z)) return H;
        if (!wide || !nav) return null;
        for (const r of rings) for (let k = 0; k < altN; k++) {
          const a = k / altN * Math.PI * 2, x = H.x + Math.cos(a) * r, z = H.z + Math.sin(a) * r;
          const w = typeof nav.walkableAt === 'function' ? nav.walkableAt(x, z, H.y, 3) : null;
          if (w === false) continue;
          if (w === null) { const gi = nav.groundInfo(x, z, H.y + 0.3, 0.3); if (gi.y == null || Math.abs(gi.y - H.y) > 0.6) continue; }
          if (okAt(x, H.y, z)) return { x, y: H.y, z };
        }
        return null;
      };
      for (const e of g.enemies) {
        if (!e.storyTag || e.dead || e.removed || !e.storyHome) continue;
        if (skip.indexOf(e.role) >= 0 || e.perch || e.climb) { e._lostT = 0; continue; }
        const lost = !(e.path && e.path.length) && !e.pathPending && Math.abs(e.pos.y - P.y) > dy && Math.abs(e.storyHome.y - P.y) < Math.abs(e.pos.y - P.y);
        e._lostT = lost ? (e._lostT || 0) + step : 0;
        if (e._lostT < sec) continue;
        const H = seen(e.pos.x, e.pos.y + 1.3, e.pos.z) ? null : spot(e.storyHome, e._lostT >= sec * homeK);
        if (!H) { this.stats.unstuckSeen = (this.stats.unstuckSeen || 0) + 1; continue; } // 見えなくなるまで・出せる所ができるまで待つ
        e._lostT = 0;
        e.pos.set ? e.pos.set(H.x, H.y, H.z) : (e.pos.x = H.x, e.pos.y = H.y, e.pos.z = H.z);
        if (e.vel && e.vel.set) e.vel.set(0, 0, 0);
        e.path = null; e.legs = null; e.repathAt = 0;
        if (H !== e.storyHome) this.stats.unstuckAlt = (this.stats.unstuckAlt || 0) + 1;
        this.stats.unstuck = (this.stats.unstuck || 0) + 1;
      }
    }
    _actorCtx(dt) {
      const g = this.game;
      const c = this._ctx || (this._ctx = { world: g.world, player: g.player, enemies: g.enemies, vehicles: g.vehicles, fx: g.fx, audio: g.audio, director: null, time: 0, dt: 0 });
      c.dt = dt; c.time = g.time; c.director = g.director; c.enemies = g.enemies; c.vehicles = g.vehicles;
      return c;
    }
    _countText() {
      const s = this.objSpec; if (!s) return '';
      const R = this.runner;
      if (s[0] === 'alive' || s[0] === 'dead') { const t = R.tags[s[1]]; if (!t) return ''; const left = t.spawned - t.dead + (t.waiting ? 1 : 0); return '残り ' + Math.max(0, t.spawned - t.dead) + (t.waiting ? '+' : ''); }
      if (s[0] === 'civBoarded') return '乗せた人 ' + R.facts.civBoarded + ' / ' + s[1];
      if (s[0] === 'held') return this.hold ? Math.round(100 * this.hold.t / this.hold.need) + '%' : '';
      if (s[0] === 'killed') return (R.kills[s[1]] || 0) + ' / ' + s[2];
      if (s[0] === 'strike') return this.strike ? '支援射撃 ' + this.strike.n : '';
      if (s[0] === 'counter') return (R.counters[s[1]] || 0) + ' / ' + s[2];
      return '';
    }
    // 印の点の近く（40 m）の対空陣地が黙っている（章の airDefense のときだけ）
    _aaSiteDead(p) {
      const AD = this.game.airDefense;
      if (!AD || !this.ch.airDefense || !AD.sites) return false;
      for (const st of AD.sites) if (st.dead && Math.hypot(st.pos.x - p.x, st.pos.z - p.z) < 40) return true;
      return false;
    }
    _marks() {
      const out = [];
      for (const m of this.markIds) {
        const p = typeof m === 'string' && m[0] === '@' ? this.resolve(m) : this.resolve(m);
        if (!p) continue;
        const I = (this.ch.interact || {})[m];
        if (I && this.interDone[m]) continue;
        if (this._aaSiteDead(p)) continue; // 黙らせた対空陣地の印は消す
        const nm = typeof m === 'string' && m[0] === '@' ? m.slice(1).split('.')[0] : null;
        const ac = nm ? this.actors[nm] : null;
        out.push({ x: p.x, y: p.y, z: p.z, label: I ? I.label : (ac && ac.def ? ac.def.name : ''), kind: ac && ac.kind === 'ally' ? 'ally' : ac && ac.kind === 'civ' ? 'civ' : 'goal' });
      }
      // 味方は印を付けていなくても青緑で
      for (const id of Object.keys(this.actors)) { const a = this.actors[id]; if (a.kind === 'ally' && !a.gone && out.length < this.cfg.markers.max && this.markIds.indexOf('@' + id) < 0) out.push({ x: a.pos.x, y: a.pos.y + 0.6, z: a.pos.z, label: a.def.name || '', kind: 'ally' }); }
      return out;
    }
    _objDist() {
      const m = this.markIds[0]; if (m == null) return null;
      const p = this.resolve(m); if (!p) return null;
      const P = this.game.player.pos;
      return Math.hypot(P.x - p.x, P.y - p.y, P.z - p.z);
    }

    // ミニマップ・全体の地図
    mapInfo() {
      const zones = this.lights ? this.lights.zonesInfo().filter((z) => z.lit >= 0.999 && StoryStore.get().relit.indexOf(z.id) >= 0).map((z) => ({ x: z.x, z: z.z, r: z.r, gold: true })) : [];
      const marks = this._marks().map((m) => ({ x: m.x, z: m.z, kind: m.kind }));
      return { cur: this.area ? { x: this.area.x, z: this.area.z, r: this.area.r } : null, next: null, flight: null, marks, zones };
    }

    // 続きから（session.js の snap）
    sessionInfo() { return { ch: this.ch.id, cp: this.lastCp ? this.lastCp.step : null, diff: this.diffName }; }

    // ---------- 章の対空陣地（airDefense.sites）: いつも見えている（ロックできる・地図）・黙らせた数を counter 'aa' に ----------
    _updateAA() {
      const AD = this.game.airDefense;
      if (!AD || !this.ch.airDefense || !AD.sites) return;
      let n = 0;
      for (const s of AD.sites) { if (s.dead) n++; else if (s.revealUntil < 1e12) s.revealUntil = 1e15; }
      const was = this._aaDead || 0;
      if (n > was) { this.runner.event('counter', { name: 'aa', n: n - was }); this._aaDead = n; }
    }

    // ---------- 看板の乗っ取り（needs 2）: 街の看板の材質（共有）の絵を Canvas の知らせに替える。'off' と dispose で戻す ----------
    _billboard(mode) {
      const g = this.game, mat = g.world && g.world.mat ? g.world.mat('billboard') : null;
      if (!mat) return;
      if (!this._bbOrig) this._bbOrig = { mat, color: mat.color.getHex(), emissive: mat.emissive.getHex(), ei: mat.emissiveIntensity };
      // 元の絵は戻すときに読む（後から届いたファイルの絵を捨てない。materials.js が届いたときに map を替える）
      if (mat.map !== this._bbTex) { const o = this._bbOrig; o.map = mat.map; o.emissiveMap = mat.emissiveMap; o.color = mat.color.getHex(); o.emissive = mat.emissive.getHex(); o.ei = mat.emissiveIntensity; }
      if (mode === 'off') { this._billboardRestore(); return; }
      const B = this.cfg.billboard, tex = this._bbTex || (this._bbTex = this._bbCanvas());
      if (!tex) return;
      const c = tex.image, x = c.getContext('2d');
      const T = (B.texts || {})[mode] || {}, lines = T.lines || [];
      // 看板は 4 × 4 のアトラスの 1 マスを縦横比に合わせて中央で切り出す（world.js _billboard）= 16 マスのどれにも、真ん中に同じ知らせを描く
      const cw = c.width / 4, chh = c.height / 4;
      for (let k = 0; k < 16; k++) {
        const ox = (k % 4) * cw, oy = Math.floor(k / 4) * chh, cx = ox + cw / 2, cy = oy + chh / 2;
        x.save(); x.beginPath(); x.rect(ox, oy, cw, chh); x.clip();
        x.fillStyle = T.bg || '#06121c'; x.fillRect(ox, oy, cw, chh);
        if (mode === 'kagami') {
          // 鏡の面（バイザー）の形（実在の人の顔は使わない）
          x.fillStyle = '#1a0608'; x.beginPath(); x.ellipse(cx, cy - chh * 0.04, cw * 0.2, chh * 0.26, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = '#c8d4e0'; x.fillRect(cx - cw * 0.17, cy - chh * 0.1, cw * 0.34, chh * 0.07);
        }
        x.fillStyle = T.color || '#e8f4ff'; x.textAlign = 'center'; x.textBaseline = 'middle';
        const n = lines.length, gap = chh * 0.13, y0 = cy - (n - 1) * gap / 2 + (mode === 'kagami' ? chh * 0.22 : 0);
        lines.forEach((ln, i) => {
          x.font = (i === 0 ? 'bold ' + Math.round(chh * 0.11) : Math.round(chh * 0.065)) + 'px sans-serif';
          x.fillText(ln, cx, mode === 'kagami' ? y0 + i * gap * 0.8 : y0 + i * gap, cw * 0.92);
        });
        x.restore();
      }
      tex.needsUpdate = true;
      mat.map = tex; mat.emissiveMap = tex; mat.color.setHex(0xffffff); mat.emissive.setHex(0xffffff); mat.emissiveIntensity = B.intensity; mat.needsUpdate = true;
      this.billboardMode = mode;
    }
    _bbCanvas() {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas'); c.width = this.cfg.billboard.size[0]; c.height = this.cfg.billboard.size[1];
      if (!c.getContext || !c.getContext('2d')) return null;
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
      return t;
    }
    _billboardRestore() {
      const o = this._bbOrig; if (!o) return;
      const m = o.mat;
      if (m.map === this._bbTex) { m.map = o.map; m.emissiveMap = o.emissiveMap; } m.color.setHex(o.color); m.emissive.setHex(o.emissive); m.emissiveIntensity = o.ei; m.needsUpdate = true;
      this._bbOrig = null; this.billboardMode = null;
    }
    // ---------- 選択（needs 2）: 2〜3 つのボタン。選んだら旗（flag）を立て、done（id）を出す。時間切れは最後の選択肢 ----------
    _choice(c) {
      const R = this.runner, done = (i) => {
        if (this.choiceCur !== c) return;
        this.choiceCur = null;
        const o = c.options[i] || c.options[c.options.length - 1];
        R.flags[o.flag] = true; R.event('flag', { name: o.flag });
        R.event('done', { id: c.id });
        this.stats.choices = (this.stats.choices || 0) + 1;
      };
      this.choiceCur = c;
      this.choiceT = c.sec || 0;
      this._choiceDone = done;
      if (this.ui) this.ui.choice(c.prompt || '', c.options.map((o) => o.label), done);
    }
    choose(i) { if (this.choiceCur && this._choiceDone) { if (this.ui && this.ui.choiceOn) this.ui.pickChoice(i); else { if (this.ui) this.ui.hideChoice(); this._choiceDone(i); } } }

    dispose() {
      const g = this.game;
      this._billboardRestore();
      if (this._bbTex) { this._bbTex.dispose(); this._bbTex = null; }
      if (this.cine) { this.cine.cam.restore(); this.cine = null; if (g.input && g.input.enable) g.input.enable(); }
      for (const id of Object.keys(this.actors)) { try { this.actors[id].dispose(); } catch (e) { /* 無視 */ } }
      this.actors = {};
      if (this.ui) this.ui.dispose();
      if (this.lights) this.lights.dispose();
      for (const m of [this.wall, this._lineMesh]) if (m) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); }
      this.wall = null; this._lineMesh = null;
    }
  }

  // 失敗の理由（章の fail の条件の名前）→ 失敗の板の文（Runner の 'end' が onPlayerDied の _fail より先に来る）
  StoryMode.FAIL_TEXT = { playerDead: 'やられた', leave: '作戦の範囲を離れた', vehicleDead: '七号機を失った' };
  MR.StoryMode = StoryMode;
  MR.StoryStore = StoryStore;
})();
