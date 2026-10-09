// 遊んでいる間の「足あと」（crumb）と、続きから再開するための保存（snap）。
//   iPhone がメモリ不足で WebView を落とすと、アプリは index.html を読み直して開始画面に戻る（「たまに急に最初の画面に戻る」）。
//   そのとき何をしていたかを 1 行で残し（crumb）、遊んでいた所・持ち物を覚えておいて（snap）次の起動で続きから始める。
//
//   localStorage の mirrsona.session = { snap, crumb, counters }。書くのは saveEvery 秒ごとに 1 回（snap と crumb をまとめて）
//   crumb: { at, reason, nav, lvl, mode, online, min, fps, calls, tris, geos, texs, full, lod, cache, veh, alt,
//            audioMB, texReleased, capFail, storageMode, volatileMB }
//     reason: tick（前で遊んでいる。saveEvery 秒ごと）| event（乗る・降りる・拾う・死ぬ。前で遊んでいる）| hidden（裏へ）| pagehide |
//             ctxlost（WebGL の文脈が消えた。裏で消えたときは hidden のまま）| memwarn | resume（続きから始めようとしている = 起動中・前）|
//             card（起動して開始画面の「続きから」を待っている）| exit（ふつうに終えた。snap は消す）
//   counters: { day, ctxLost, ctxRestored, rehydrated, memwarn }（起動をまたいで数える。日が変わったら 0 から）
//   snap（capture）: { v: 1, at, reason, level, cityMode, online, resumable, why, t, kills, x, y, z, yaw, pitch, hp, dead, st,
//                     wi, wa（アリーナの武器）, inv（街の持ち物）, taken（取った地図の物）, vehState（触った乗り物）, veh, counted }
//     resumable: false = 続きからは始めない（オンライン・バトルロイヤル・乗り物・空中。M5）。落ちた回数には数える
//   mirrsona.crashes = [時刻…]（前で遊んでいる途中で終わった回数。続けて落ちるなら省メモリ → 開始画面）、mirrsona.saverUntil = 時刻
//
// 起動（main.js）: boot() → 前の crumb（「前回: …」の 1 行）と snap、落ちた回数。decide() → 'none' | 'resume' | 'saver' | 'title'。
// ゲーム（game.js）: start() で apply(game, snap)、毎フレーム _sessionTick → save(game, reason)、leaveToTitle / バトロワの結果で clear()。
// THREE も DOM の描画も使わない（apply だけ game を通して動かす）。localStorage が無い・投げる環境（プライベート・Node）では何もしない
window.MR = window.MR || {};

MR.Session = (function () {
  const KEY = 'mirrsona.session';
  const CRASH_KEY = 'mirrsona.crashes';
  const SAVER_KEY = 'mirrsona.saverUntil';
  // 前で遊んでいる途中で終わった（= 落ちた）とみなす reason。hidden / pagehide / memwarn は裏で消された・アプリを切り替えた
  const UNCLEAN = { tick: true, ctxlost: true, event: true, resume: true };
  const LEVEL_NAME = { midtown: '街', arena01: 'アリーナ' };
  const VEH_NAME = { heli: 'ヘリ', jet: '戦闘機', car: '車' };
  const DEFAULTS = {
    session: { enabled: true, saveEvery: 3, maxAgeMin: 30, webTapToResume: true, visibleWait: 5, airAgl: 4, maxTaken: 300, maxVehState: 12, messageMs: 3000, eventGap: 1 },
    crashLoop: { window: 1800, saverAfter: 2, titleAfter: 3, saverStickyHours: 24 },
    contextLoss: { pause: true, rehydrateMax: 20, watchdog: 6, reloadOncePerMin: 10 }
  };

  function store() {
    try { return (typeof window !== 'undefined' && window.localStorage) || null; } catch (e) { return null; }
  }
  function getJSON(key) {
    const ls = store();
    if (!ls) return null;
    try { const s = ls.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function setJSON(key, v) {
    const ls = store();
    if (!ls) return false;
    try { if (v == null) ls.removeItem(key); else ls.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  const read = () => getJSON(KEY);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const write = (rec) => setJSON(KEY, rec);
  function today() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function navType() {
    try {
      const e = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      return (e && e.type) || null;
    } catch (e) { return null; }
  }
  const nowMs = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  const mb = (b) => Math.round(b / 104857.6) / 10;
  const r2 = (v) => Math.round((+v || 0) * 100) / 100;

  const S = {
    stats: { writes: 0, bytes: 0, ms: 0, msMax: 0, snapBytes: 0, captureMs: 0 },
    _rec: null,

    // game.json の stability（無いキーは既定値）
    config(stab) {
      stab = stab || {};
      const out = {};
      for (const k of Object.keys(DEFAULTS)) out[k] = Object.assign({}, DEFAULTS[k], stab[k] || {});
      out.saver = stab.saver || {};
      return out;
    },

    // 今の記録（無ければ空）。counters の日付が変わっていれば 0 から
    record() {
      if (!this._rec) {
        // 壊れた値（数・文字列・配列）は空から。snap / crumb も物でなければ捨てる
        const r = read();
        this._rec = isObj(r) ? r : {};
        if (!isObj(this._rec.snap)) this._rec.snap = null;
        if (!isObj(this._rec.crumb)) this._rec.crumb = null;
      }
      const rec = this._rec;
      const d = today();
      if (!isObj(rec.counters) || rec.counters.day !== d) rec.counters = { day: d, ctxLost: 0, ctxRestored: 0, rehydrated: 0, memwarn: 0 };
      return rec;
    },
    load() { return this.record(); },

    // 起動時（1 回だけ）: 前の crumb と snap を返し、前で遊んでいる途中で終わっていたら落ちた回数に足す（noteEnd）。
    //   表示した crumb は seen にして次の起動では出さない
    boot(now) {
      now = now == null ? Date.now() : now;
      const rec = this.record();
      const prev = rec.crumb || null;
      const unclean = !!(prev && UNCLEAN[prev.reason] && !prev.seen);
      if (prev && !prev.seen) prev.seen = true;
      const counted = this.noteEnd(rec, now);
      // 書けない（容量・禁止）なら数えた回数も markLaunch も残らないので、続きからは自動で始めない（decide の env.readonly）
      const writable = write(rec) && (!counted || this._crashWriteOk !== false);
      return { prev, unclean, counters: rec.counters, snap: rec.snap || null, crashes: this.crashes(), counted, writable };
    },

    // 前の snap が残っていて（ふつうに終えていない）、最後の reason が前で遊んでいるもの（tick / event / ctxlost / resume）なら 1 回と数える。
    //   hidden / pagehide / memwarn で終わったもの（裏で消された・アプリを切り替えた）は数えない。同じ終わり方を 2 回数えない（counted）
    noteEnd(rec, now) {
      const snap = rec && rec.snap;
      if (!snap || snap.counted || !UNCLEAN[snap.reason]) return false;
      snap.counted = true;
      const list = this.crashes();
      list.push(snap.at || now);
      while (list.length > 10) list.shift();
      this._crashWriteOk = setJSON(CRASH_KEY, list);
      return true;
    },
    crashes() { const a = getJSON(CRASH_KEY); return Array.isArray(a) ? a.filter((x) => typeof x === 'number') : []; },

    // どう始めるか（純粋な関数。Node のテストが表で確かめる）
    //   'none'   続きから始めない（snap が無い・古い・続きにできない・自動テスト / URL の ?mode= ?level=）
    //   'resume' 続きから
    //   'saver'  続きから、省メモリで（window 秒の中で saverAfter 回落ちた、または省メモリの期限内）
    //   'title'  開始画面（「続きから」のカードを出す。window 秒の中で titleAfter 回）
    decide(now, snap, crashes, stab, env) {
      const c = this.config(stab), s = c.session, cl = c.crashLoop;
      env = env || {};
      if (!snap || s.enabled === false || snap.v !== 1) return 'none';
      if (env.direct || env.harness) return 'none';
      if (snap.resumable === false || snap.online) return 'none';
      // 位置の無い snap（別の版・書き換え）は続きにできない
      if (!['x', 'y', 'z'].every((k) => typeof snap[k] === 'number' && isFinite(snap[k]))) return 'none';
      if (!(now - (snap.at || 0) <= s.maxAgeMin * 60000)) return 'none';
      const n = (crashes || []).filter((t) => now - t <= cl.window * 1000 && t <= now + 60000).length;
      if (n >= cl.titleAfter || env.readonly) return 'title';
      if (n >= cl.saverAfter || (env.saverUntil && now < env.saverUntil)) return 'saver';
      return 'resume';
    },

    // 省メモリ（続けて落ちたら saverStickyHours 時間。開始画面の「省メモリモード（解除）」で戻す）
    saverUntil() { const v = getJSON(SAVER_KEY); return typeof v === 'number' ? v : 0; },
    saverActive(now) { return (now == null ? Date.now() : now) < this.saverUntil(); },
    enterSaver(now, stab) {
      const cl = this.config(stab).crashLoop;
      setJSON(SAVER_KEY, (now == null ? Date.now() : now) + cl.saverStickyHours * 3600000);
    },
    clearSaver() { setJSON(SAVER_KEY, null); },

    // 描画設定に省メモリ（stability.saver）を重ねる。rs は _renderSettings / main.js の rsBase（mobile を重ねた後）。
    //   街の値は render.city と render.city.mobile の両方に重ねる（CityWorld.config がタッチ端末で mobile を後から重ねるため）
    saverRender(rs, stab) {
      const sv = (stab && stab.saver) || {};
      const out = Object.assign({}, rs, sv.render || {});
      if (sv.city) {
        out.city = Object.assign({}, (rs && rs.city) || {}, sv.city);
        if (rs && rs.city && rs.city.mobile) out.city.mobile = Object.assign({}, rs.city.mobile, sv.city);
      }
      return out;
    },

    // 続きから始める直前（main.js）: この起動が落ちたら（ゲームが最初の保存をする前でも）次の起動で数えられるように
    //   main.js は decide の直後（兵士のパース・街のテクスチャの先読みの前）に呼ぶ: 読み込み中に落ちても数える
    markLaunch() {
      const rec = this.record();
      if (!rec.snap) return false;
      rec.snap.reason = 'resume';
      rec.snap.counted = false;
      rec.snap.at = Date.now();
      return write(rec);
    },
    // 起動中（ゲームの前）の snap の reason だけ変える: hidden / pagehide（裏へ。数えない）・card（開始画面で「続きから」を待つ。数えない）・
    //   resume（前で読み込み中。数える = markLaunch）。ほかは counted を変えない（数えた終わり方を数え直さない）
    markReason(reason) {
      const rec = this.record();
      if (!rec.snap) return false;
      if (reason === 'resume' && (rec.snap.counted || rec.snap.reason !== 'resume')) return this.markLaunch();
      if (rec.snap.reason === reason) return false;
      rec.snap.reason = reason;
      return write(rec);
    },

    // ふつうに終えた（開始画面へ・バトルロイヤルの結果・新しく始める）: snap を消す。crumb と counters は残す
    clear() {
      const rec = this.record();
      rec.snap = null;
      if (rec.crumb && UNCLEAN[rec.crumb.reason]) rec.crumb.reason = 'exit';
      write(rec);
    },

    // 数える（ctxLost / ctxRestored / memwarn …）。書くのは次の save で
    count(name, by) {
      try {
        const c = this.record().counters;
        c[name] = (+c[name] || 0) + (by == null ? 1 : by);
      } catch (e) { /* 数えられなくても遊べる */ }
    },

    // crumb を作る（game を見るだけ。変えない）
    crumb(game, reason) {
      const c = { at: Date.now(), reason: reason || 'tick', nav: navType() };
      if (!game) return c;
      c.lvl = game.levelId || null;
      c.mode = game.cityMode || (game.online ? (game.net && game.net.mode) || 'online' : 'arena');
      c.online = !!game.online;
      c.min = Math.round((game.time || 0) / 6) / 10;
      c.fps = game._crumbFps || 0;
      if (game.saver) c.saver = true;
      if (game._resumed) c.resumed = true;
      const r = game.renderer && game.renderer.info;
      if (r) {
        c.calls = r.render ? r.render.calls : 0;
        c.tris = r.render ? r.render.triangles : 0;
        c.geos = r.memory ? r.memory.geometries : 0;
        c.texs = r.memory ? r.memory.textures : 0;
      }
      const st = game.world && game.world.streamer && game.world.streamer.stats;
      if (st) { c.full = st.full; c.lod = st.lod; }
      const cache = game.world && game.world.cache;
      if (cache && cache.size != null) c.cache = cache.size;
      const v = game.vehicle;
      if (v) {
        c.veh = v.kind || 'car';
        c.alt = v.pos ? Math.round(v.pos.y) : null;
      } else if (game.player && game.player.pos) c.alt = Math.round(game.player.pos.y);
      // 音（デコード済み。iPhone の 48 kHz に揃えた MB）
      let ab = 0;
      const au = game.audio;
      if (au && au.buffers) {
        const rate = (au.ctx && au.ctx.sampleRate) || 48000;
        for (const k in au.buffers) { const b = au.buffers[k]; if (b && b.length) ab += b.length * (b.numberOfChannels || 1) * 4 * 48000 / rate; }
      }
      c.audioMB = mb(ab);
      const AM = MR.AssetManager;
      c.texReleased = (AM && AM.releasedCount) || 0;
      c.capFail = (AM && AM.capFail) || 0;
      const A = game.assets;
      const sto = A && A.storage;
      c.storageMode = sto ? (sto.native ? 'fs' : (sto.db ? 'idb' : 'none')) : null;
      let vb = 0;
      if (A && A.volatile) for (const k in A.volatile) { const x = A.volatile[k]; if (x) vb += typeof x === 'string' ? x.length : (x.byteLength || 0); }
      c.volatileMB = mb(vb);
      return c;
    },

    // 続きから始めるための保存（game を見るだけ。変えない）。null = 保存しない（バトルロイヤルの決着の後）
    capture(game, reason) {
      const p = game && game.player;
      if (!p || !p.pos) return null;
      const cfg = this.config(game.config && game.config.stability).session;
      const s = { v: 1, at: Date.now(), reason: reason || 'tick', level: game.levelId, cityMode: game.cityMode || null, online: !!game.online, resumable: true, counted: false };
      if (game.saver) s.saver = true;
      if (game.online) { s.mode = (game.net && game.net.mode) || null; s.resumable = false; s.why = 'online'; return s; }
      if (game.royale) {
        if (game.royale.over) return null;
        s.resumable = false; s.why = 'royale';
      }
      s.t = Math.round(game.time || 0);
      s.kills = game.kills | 0;
      s.x = r2(p.pos.x); s.y = r2(p.pos.y); s.z = r2(p.pos.z);
      s.yaw = Math.round(p.yawAngle * 1000) / 1000; s.pitch = Math.round(p.pitchAngle * 1000) / 1000;
      s.hp = Math.round(p.health); s.dead = !!p.dead; s.st = p.state || 'walk';
      const v = game.vehicle;
      if (v) {
        s.veh = { id: v.cityId || v.id || null, kind: v.kind || 'car', seat: game.vehicleSeat | 0 };
        if (s.resumable) { s.resumable = false; s.why = 'vehicle'; }
      } else if (s.resumable && !s.dead && (s.st === 'fall' || s.st === 'chute' || (s.st === 'walk' && !p.grounded)) && game.isCity && game.world && game.world.nav) {
        // 空中（自由落下・パラシュート・歩きのまま宙にいる = 空中のヘリから飛び降りた・屋上の縁から落ちた）は M5。
        // 跳んだ・段を降りた程度（airAgl m まで）は地面に置いて続ける
        const nav = game.world.nav;
        let g = nav.groundHeight ? nav.groundHeight(p.pos.x, p.pos.z, p.pos.y + 0.5, 0.2) : null;
        if (g == null && nav.waterLevelAt) g = nav.waterLevelAt(p.pos.x, p.pos.z);
        const agl = p.pos.y - (g == null ? 0 : g);
        if (agl > cfg.airAgl) { s.resumable = false; s.why = 'air'; }
      }
      if (game.play && game.play.inv) {
        if (typeof game.play._syncSlotAmmo === 'function') game.play._syncSlotAmmo();
        s.inv = game.play.inv.toJSON();
        // 取った地図の物（"cx_cz_n"）。全部取った物は id、残りがある物は [id, 残り]。新しい方から maxTaken 個まで
        const loot = game.play.loot;
        if (loot && loot.state) {
          const taken = [];
          for (const [id, st] of loot.state) {
            if (!/^\d+_\d+_\d+$/.test(id)) continue;
            if (st.gone) taken.push(id); else if (st.qty != null) taken.push([id, st.qty]);
          }
          if (taken.length) s.taken = taken.slice(-cfg.maxTaken);
        }
      } else if (game.weapons && game.weapons.length) {
        // アリーナ: 持っている武器と、武器ごとの装填数・予備
        s.wi = game.weaponIndex | 0;
        s.wa = game.weapons.map((w) => [w.ammo | 0, w.reserve | 0]);
      }
      // 触った乗り物（街。チャンクから外れて覚えている分 + 今出ている触った物）。戻ったときに同じ場所・HP で出る（game._cityVehState）
      if (game.isCity && (game._cityVehState || game.vehicles)) {
        const out = new Map();
        if (game._cityVehState) for (const [id, st] of game._cityVehState) out.set(id, st);
        for (const w of game.vehicles || []) {
          if (!w.cityId || !w.citySpec || w === v || w.wrecked || w.sinking || w.sunk) continue;
          if (w.kind === 'jet' && w.mode === 'air') continue;
          const touched = w.cityTouched || (w.def && w.health < w.def.health) || (w.spawnPos && w.pos.distanceTo(w.spawnPos) > 2);
          if (!touched) continue;
          out.set(w.cityId, { spec: w.citySpec, x: w.pos.x, y: w.pos.y, z: w.pos.z, yaw: w.yaw, health: w.health, air: w.kind === 'heli' && !w.grounded, ammo: w.kind === 'jet' ? w.ammo : undefined });
        }
        if (out.size) {
          const list = [];
          for (const [id, st] of out) {
            const sp = st.spec || {};
            list.push([id, { id: sp.id, type: sp.type, x: r2(sp.x), y: r2(sp.y), z: r2(sp.z), yaw: sp.yaw }, r2(st.x), r2(st.y), r2(st.z), r2(st.yaw), Math.round(st.health), st.air ? 1 : 0, st.ammo]);
          }
          s.vehState = list.slice(-cfg.maxVehState);
        }
      }
      return s;
    },

    // 続きから（game.start() の中、_respawnPlayer の代わり）。位置・向き・体力・撃破数・持ち物・取った物・触った乗り物
    apply(game, snap) {
      const p = game.player, cfg = this.config(game.config && game.config.stability).session;
      const W = game.world;
      // ヘリ・戦闘機のフレームの読み込みの予算が残っていると、足元のチャンクが当たり判定に入らず（groundHeight が null）浮く・泳ぐ・ずれる
      // （placePlayer / _respawnPlayer は world.loadNavNow で全部すぐ読む。ここでも先に消しておく）
      if (W) { W.navLead = null; W.navBudget = null; W.navMsCap = null; }
      const max = (game.config.player || {}).maxHealth || 100;
      // 壊れた・数でない値（文字列・NaN・Infinity）は 0 / 既定にする（decide は x / y / z しか見ない。NaN の向きはカメラを壊す）
      const num = (v, d) => { const n = +v; return typeof v !== 'boolean' && v !== null && v !== '' && isFinite(n) ? n : d; };
      const yawDeg = num(snap.yaw, 0) * 180 / Math.PI;
      // 触った乗り物は、そのチャンクが読まれたら同じ状態で出る（_updateCityVehicles）。復活の場所を決める前に戻す: 死亡画面のまま落ちたときの
      //   resumeSpot（respawn.js）は乗り物（塔の上のヘリ・甲板の戦闘機・止めた車）を見る。後で戻していたので、乗って行ったヘリがまだ塔の上に
      //   いることになり、ヘリでしか降りられない 230 m の塔の上に一人で出ていた
      if (game.isCity && Array.isArray(snap.vehState)) {
        const saved = game._cityVehState || (game._cityVehState = new Map());
        for (const e of snap.vehState) {
          if (!Array.isArray(e) || !e[1] || !e[1].type) continue;
          const x = num(e[2], NaN), y = num(e[3], NaN), z = num(e[4], NaN);
          if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
          saved.set(e[0], { spec: e[1], x, y, z, yaw: num(e[5], 0), health: num(e[6], undefined), air: !!e[7], ammo: e[8] == null ? undefined : num(e[8], undefined) });
        }
      }
      if (snap.dead) {
        // 死亡画面のまま落ちた: ソロの街：フリー・アリーナは覚えている「復活する場所」（respawn.js。決められない・投げたら今まで通り）
        const ui = game.respawnUI;
        let spot = null;
        try { spot = ui && typeof ui.resumeSpot === 'function' ? ui.resumeSpot(snap) : null; } catch (e) { spot = null; console.warn('[Session] 復活する場所を決められません:', e && e.message); }
        game._respawnPlayer(spot || undefined);
      } else if (game.isCity) {
        game.placePlayer(snap.x, snap.z, snap.y + 0.3, yawDeg);
      } else {
        const nav = W && W.nav;
        const f = nav && nav.nearestFree ? nav.nearestFree(snap.x, snap.z) : { x: snap.x, z: snap.z };
        p.spawn(f.x, f.z, yawDeg);
      }
      if (!snap.dead) {
        p.pitchAngle = Math.max(-1.5, Math.min(1.5, num(snap.pitch, 0)));
        const hp = num(snap.hp, max);
        p.health = Math.max(1, Math.min(max, hp > 0 ? hp : max));
        p._apply();
      }
      game.kills = Math.max(0, snap.kills | 0);
      if (game.hud.setKills) game.hud.setKills(game.kills);
      game.hud.setHealth(p.health, max);
      // 持ち物（街）
      const play = game.play;
      if (play && snap.inv && !snap.dead) {
        const inv = play.inv, j = snap.inv, defs = play.weaponDefs || {};
        inv.slots = [0, 1, 2].map((i) => { const x = (j.slots || [])[i]; return x && defs[x.id] ? { id: x.id, ammo: Math.max(0, Math.min(x.ammo | 0, defs[x.id].magazineSize || 999)) } : null; });
        for (const cal of Object.keys(inv.ammo)) inv.ammo[cal] = Math.max(0, Math.min(inv.capOf(cal) || Infinity, ((j.ammo || {})[cal]) | 0));
        for (const m of Object.keys(inv.meds)) inv.meds[m] = Math.max(0, Math.min(inv.medCap(m) || Infinity, ((j.meds || {})[m]) | 0));
        const arm = (slot) => { const a = j[slot]; return a && a.dur > 0 ? { dur: Math.min(a.dur, inv.armorMax(slot)), max: inv.armorMax(slot) } : null; };
        inv.vest = arm('vest'); inv.helmet = arm('helmet');
        inv.version = (inv.version || 0) + 1;
        const cur = j.cur >= 0 && inv.slots[j.cur] ? j.cur : inv.firstSlot();
        inv.cur = -1;
        if (cur >= 0) play.selectSlot(cur, true);
      }
      if (play && play.loot && snap.taken && typeof play.loot.applyTaken === 'function') play.loot.applyTaken(snap.taken);
      // アリーナの武器
      if (!play && Array.isArray(snap.wa) && !snap.dead) {
        snap.wa.forEach((a, i) => { const w = game.weapons[i]; if (w && Array.isArray(a)) { w.ammo = Math.max(0, Math.min(a[0] | 0, w.def.magazineSize)); w.reserve = Math.max(0, a[1] | 0); } });
        const wi = snap.wi >= 0 && snap.wi < game.weapons.length ? snap.wi : 0;
        game._selectWeapon(wi, true);
      }
      // 表示は最初に描いたフレームから messageMs（game._sessionTick が _resumeMsg を見て時計を始め直す。最初の描画は重いので）
      const msg = game.saver ? '前回の続きから再開しました（省メモリモード）' : '前回の続きから再開しました';
      game.hud.showMessage(msg, 600000);
      game._resumeMsg = msg;
      game._resumed = snap;
      this.stats.applied = (this.stats.applied || 0) + 1;
    },

    // 1 回の書き込み（crumb + counters + snap）。exit は snap を消す（ふつうに終えた）
    save(game, reason) {
      const t0 = nowMs();
      const rec = this.record();
      try { rec.crumb = this.crumb(game, reason); } catch (e) { rec.crumb = { at: Date.now(), reason: reason || 'tick', err: String(e && e.message).slice(0, 80) }; }
      if (reason === 'exit') rec.snap = null;
      else if (game) {
        const c0 = nowMs();
        try { rec.snap = this.capture(game, reason); } catch (e) { if (rec.snap) rec.snap.reason = reason; }
        this.stats.captureMs = nowMs() - c0;
      }
      const ok = write(rec);
      const ms = nowMs() - t0;
      const s = this.stats;
      s.writes++; s.ms = ms; if (ms > s.msMax) s.msMax = ms;
      try { s.bytes = JSON.stringify(rec).length; s.snapBytes = rec.snap ? JSON.stringify(rec.snap).length : 0; } catch (e) { /* 無視 */ }
      return ok;
    },

    // 開始画面の 1 行: 「前回: 街 12 分・ヘリ 150 m・tex 210・音 64 MB」
    describe(c) {
      if (!c) return '';
      const parts = [];
      const lv = LEVEL_NAME[c.lvl] || c.lvl || '?';
      parts.push(lv + (c.online ? '（オンライン）' : '') + ' ' + Math.max(0, Math.round(c.min || 0)) + ' 分');
      if (c.veh) parts.push((VEH_NAME[c.veh] || c.veh) + (c.alt != null ? ' ' + c.alt + ' m' : ''));
      if (c.texs != null) parts.push('tex ' + c.texs);
      if (c.audioMB != null) parts.push('音 ' + Math.round(c.audioMB) + ' MB');
      if (c.fps) parts.push(c.fps + ' fps');
      if (c.reason && c.reason !== 'tick') parts.push(c.reason);
      if (c.saver) parts.push('省メモリ');
      if (c.storageMode === 'none') parts.push('保存なし ' + Math.round(c.volatileMB || 0) + ' MB');
      return '前回: ' + parts.join('・');
    },

    // テスト用
    _reset() { this._rec = null; this.stats = { writes: 0, bytes: 0, ms: 0, msMax: 0, snapBytes: 0, captureMs: 0 }; }
  };
  S.KEY = KEY;
  S.CRASH_KEY = CRASH_KEY;
  S.SAVER_KEY = SAVER_KEY;
  S.UNCLEAN = UNCLEAN;
  S.DEFAULTS = DEFAULTS;
  return S;
})();
