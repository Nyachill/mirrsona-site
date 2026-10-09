// 復活する場所を選ぶ（ソロの街：フリーとアリーナ。オーナーの「ソロのリスポーンは自分で決めれるようにして」）。
//   バトルロイヤル（1 回だけ）とオンライン（サーバーが決める）には出さない。数値は game.json の respawn（無いキーは DEFAULTS）。
//
//   MR.RespawnSpots（DOM を使わない。Node のスモークでも動く）: 候補の場所を作り、確かめ、危なさで並べる
//     options(game, cfg, pick)   選べるもの: 街 = ランダム / 近く /（地図の場所）/ ホットゾーンごと（空母は甲板）、アリーナ = 中央 / ランダム / 近く / 地点 1..N
//     validate(game, x, y, z, cfg, out)   当たり判定のチャンクが読んであり（loadedAround）、立てる面があって水の中でなく、カプセルが箱から
//                                  maxPush m 以内で出られ、頭の上が headroom m 空いていて、乗り物（戦闘機は主翼まで・ヘリは機体の箱）から離れていて、
//                                  ヘリでしか行けないパッド（塔の上）ならヘリが降りている（padHeli）
//     threat(game, x, y, z, cfg, out)    生きている敵までの距離・見られているか（倒した敵に見られているか）→ cls（0 安全 / 1 見られる /
//                                  2 倒した敵に見られる / 3 enemyClear m 以内）・close（enemyClear m 以内の敵の数）・need（近いか見ている敵の数 =
//                                  安全にするのに片付ける数）
//     zoneCandidates / randomCandidates / deckCandidates / padCandidates / nearCandidates / arenaCandidates   候補の一覧（安い計算だけ）
//     onDeck / deckPath(city, …)   空母の甲板の外形（右舷のエレベーターは外）の中か・まっすぐ歩いて外へ出ないか
//     padHeli / heliOnlyBlocked   ヘリポートにヘリが降りているか・ヘリでしか行けないパッド（塔の上）でヘリがいないか
//     openYaw / spotYaw            復活する向き（face が無ければ目の前の扇が壁でふさがっていない向きへ回す。街もアリーナも）
//     coarseSnap(game, x, z, ppm, cfg)   地図をタップした所 → 甲板 / ヘリポートの横 / 入れる建物の屋上 / 高架・橋（水の上でも）/ 近くの通り・公園
//                                  （水の上は岸から指の太さ（waterSnap）までだけ。それより沖は「ここには出られません」）。甲板・ヘリポートは face（向く所）つき
//   MR.RespawnUI（respawn.js の後半）: 死亡画面の「復活する場所」（選択肢・地図で選ぶ・「復活」とカウントダウン・見ている敵を片付ける
//     （アリーナは見えない所へ動かす _hideSpot）・死亡画面のまま落ちた後の続きから resumeSpot）
window.MR = window.MR || {};

(function () {
  const DEFAULTS = {
    enabled: true, autoAfter: 0,
    nearMin: 40, nearMax: 140, nearPref: 70, nearAngles: 12, nearRingSteps: 3, nearGrow: 100, nearMaxFar: 450,
    enemyClear: 35, losRange: 120, maxCleared: 2, maxMoved: 0, maxZoneFallbacks: 2, nearRoofPenalty: 5,
    streetMaxH: 0.6, roofMinH: 2.5,
    maxPush: 0.3, headroom: 1.9, stepHint: 0.3, probeR: 0.3,
    vehicleClear: 1.5, specClear: 3, jetClear: 1.5, heliClear: 6.5, padRim: 1.5, padHeliDy: 3, vehicleDy: 4, vehicleScan: 20, hideGap: 1.5, bridgeStep: 1.5,
    deckZones: ['carrier'], deckEdge: 3, laneClear: 4, deckLandingClear: 1, deckPathEdge: 1, deckPathStep: 1, deckNoseAhead: 30, deckSweepPenalty: 25,
    pickPpm: 0.5, pickSnap: 12, pickSnapPx: 24, pickSnapMax: 40, pickStep: 2, pickRings: 12, pickMaxPts: 500,
    waterSnapPx: 10, waterSnapMax: 10, pickBadTime: 1.5, pickTapMs: 1000, chipHoldMs: 800, resumeTries: 6,
    fineSnap: 6, fineStep: 1,
    searchMsPerFrame: 1.0, rescanSec: 1, navOpsPerFrame: 1, loadOpsPerFrame: 2, leadDelay: 0.5,
    loadMaxSec: 4, loadingNoteAfter: 0.25, fadeSec: 0.35, fadeMaxSec: 1.2, faceClear: 6, faceStep: 15, faceFan: 45, faceFar: 20, faceTurnCost: 1,
    arena: { nearMin: 15, nearMax: 40, enemyClear: 12, losRange: 60, maxCleared: 2, maxMoved: 6, randomSamples: 24, pointRings: [4, 8], pointAngles: 8, pointSnap: 1.5 }
  };
  const DECK = new WeakMap(); // CityGen → 甲板の床の箱（ローカル）
  const now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  // (x, z) から (tx, tz) を向く yaw（度。player.spawn と同じ: 前 = −Z）
  const yawTo = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z)) * 180 / Math.PI;
  // 候補の向き: face（甲板の戦闘機・ヘリポートのヘリ）があれば足を置く所からそちら、無ければ候補の yawDeg
  const faceYaw = (c, sp) => (c && c.face ? yawTo(sp.x, sp.z, c.face.x, c.face.z) : (c ? c.yawDeg : 0));
  // 32 bit の混ぜ合わせ（citygen の hash が無い環境でも動くように同じ形で持つ）
  const mix = (a, b) => { let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
  const rand = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const shuffle = (n, seed) => { const r = rand(seed), a = []; for (let i = 0; i < n; i++) a.push(i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  // 点から線分までの距離
  const segDist = (x, z, ax, az, bx, bz) => {
    const ux = bx - ax, uz = bz - az, L = ux * ux + uz * uz;
    const t = L > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / L)) : 0;
    return Math.hypot(x - ax - ux * t, z - az - uz * t);
  };

  // 乗り物の足元の長方形（ローカル。前 +Z）: 戦闘機は主翼・尾翼まで（Jet.BOXES。歩きの押し出し FUSE は主翼の下をくぐれるので使わない）、
  //   ヘリは機体の箱（Helicopter.BOXES。止まった回転翼は頭の上）、車は width × length
  const envOf = (boxes) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const b of boxes) { x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1); } return { x0, x1, z0, z1 }; };
  let JET_ENV = null, HELI_ENV = null;
  function footprint(kind, def) {
    if (kind === 'jet') { if (!JET_ENV) JET_ENV = MR.Jet && MR.Jet.BOXES ? envOf(MR.Jet.BOXES) : { x0: -6.8, x1: 6.8, z0: -6.7, z1: 11.6 }; return JET_ENV; }
    // ヘリ: heli.js の BOXES（キャビン x ±1.0 z −1.5〜2.67・テールブーム x ±0.35 z −7.95〜−1.5）を囲む長方形（heli.js はサーバーも読むので触らない）
    if (kind === 'heli') { if (!HELI_ENV) HELI_ENV = MR.Helicopter && MR.Helicopter.BOXES ? envOf(MR.Helicopter.BOXES) : { x0: -1.0, x1: 1.0, z0: -7.95, z1: 2.67 }; return HELI_ENV; }
    const w = (def && def.width) || 2, l = (def && def.length) || 4.5;
    return { x0: -w / 2, x1: w / 2, z0: -l / 2, z1: l / 2 };
  }
  // (x, z) が中心 (cx, cz)・向き yaw（rad）の足元の長方形 + m の中か（vehicle.js の toLocal と同じ回し方）
  function inFootprint(fp, cx, cz, yaw, x, z, m) {
    const c = Math.cos(yaw), s = Math.sin(yaw), dx = x - cx, dz = z - cz;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return lx > fp.x0 - m && lx < fp.x1 + m && lz > fp.z0 - m && lz < fp.z1 + m;
  }

  const Spots = {
    DEFAULTS,
    yawTo,
    faceYaw,
    // 復活する向き: face（戦闘機・ヘリ）があればそちら。ほかは候補の向き（死んだ所・ゾーンの真ん中）を openYaw で開けた方へ
    spotYaw(game, c, sp, cfg) { return c && c.face ? faceYaw(c, sp) : Spots.openYaw(game, sp, c ? c.yawDeg : 0, cfg); },
    // 目の高さで yawDeg の前の扇（左右 faceFan°、faceStep° ごとのレイ）が全部 faceClear m 開けていればそのまま。どれかが近い壁（屋上の
    //   階段室・隣の塔の壁・扉の前・アリーナのコンテナ）なら、扇のレイの距離（faceFar m まで）を真ん中ほど重く（cos）平均した値が一番大きい向きへ
    //   （回すほど faceTurnCost m / 90° 引く = 同じくらいなら近い向き）。レイは 1 回に 360 / faceStep 本まで。街は Nav3D（当たりの dist）、
    //   アリーナは MR.Nav（当たりの t。以前はアリーナで何もせず、「近く」がコンテナの 1.4 m 前で壁を向いていた）
    openYaw(game, sp, yawDeg, cfg) {
      const nav = game.world && game.world.nav, R = cfg.faceClear || 0, st = cfg.faceStep || 15, m = Math.round((cfg.faceFan || 0) / st);
      if (!nav || typeof nav.raycast !== 'function' || !(R > 0) || !(st > 0)) return yawDeg;
      const far = Math.max(R, cfg.faceFar || R), eye = (sp.y || 0) + ((game.player && game.player.eyeHeight) || 1.6), f = {}, N = Math.round(360 / st);
      const free = (k) => {
        const i = ((k % N) + N) % N;
        if (f[i] === undefined) {
          const a = (yawDeg + i * st) * Math.PI / 180, h = nav.raycast(sp.x, eye, sp.z, -Math.sin(a), 0, -Math.cos(a), far);
          const d = h ? (h.dist != null ? h.dist : h.t) : far;
          f[i] = typeof d === 'number' && isFinite(d) ? Math.min(far, d) : far;
        }
        return f[i];
      };
      let mn = Infinity;
      for (let j = -m; j <= m; j++) mn = Math.min(mn, free(j));
      if (mn >= R) return yawDeg;
      const score = (k) => { let s = 0, w = 0; for (let j = -m; j <= m; j++) { const c = Math.cos(j * st * Math.PI / 180); s += c * free(k + j); w += c; } return s / w; };
      // 真ん中（と左右 faceStep°）が faceClear m 開けている向きが先（平均だけだと、左右が遠くて真ん中が 4〜5 m の壁の向きを選ぶことがあった）
      const open = (k) => Math.min(free(k - 1), free(k), free(k + 1)) >= R;
      const n = Math.floor(180 / st), cost = (cfg.faceTurnCost || 0) * st / 90;
      let best = 0, bs = score(0), bo = open(0);
      for (let k = 1; k <= n; k++) for (const sg of [1, -1]) {
        const o = open(sg * k), v = score(sg * k) - cost * k;
        if ((o && !bo) || (o === bo && v > bs + 1e-6)) { bs = v; best = sg * k; bo = o; }
      }
      return yawDeg + best * st;
    },
    footprint,
    inFootprint,
    // game.json の respawn（arena: アリーナでは arena の値を上に重ねる）
    config(raw, arena) {
      raw = raw || {};
      const c = Object.assign({}, DEFAULTS, raw);
      c.arena = Object.assign({}, DEFAULTS.arena, raw.arena || {});
      return arena ? Object.assign({}, c, c.arena) : c;
    },

    // 選べるもの（ボタンの順）。pick: 地図で選んで覚えている場所 { x, z } か null
    options(game, cfg, pick) {
      if (!game.isCity) {
        const out = [{ id: 'center', label: '中央' }, { id: 'random', label: 'ランダム' }, { id: 'near', label: '近く' }];
        const pts = (game.level && game.level.spawnPoints) || [];
        const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
        pts.forEach((p, i) => {
          const a = Math.atan2(p[0], -p[1]) * 180 / Math.PI; // 北（−Z）から東回り
          out.push({ id: 'pt:' + (i + 1), label: '地点' + (i + 1) + ' ' + dirs[Math.round(((a + 360) % 360) / 45) % 8] });
        });
        return out;
      }
      const out = [{ id: 'random', label: 'ランダム' }, { id: 'near', label: '近く' }];
      if (pick) out.push({ id: 'mapLast', label: '地図の場所' });
      for (const h of (game.city.hotZones || [])) out.push({ id: 'zone:' + h.id, label: h.label || h.id, deck: (cfg.deckZones || []).indexOf(h.id) >= 0 });
      return out;
    },

    // (x, z) ± m の正方形にかかるチャンクが全部当たり判定に読んであるか（アリーナは常に true）
    loadedAround(game, x, z, m) {
      const city = game.city;
      if (!game.isCity || !city) return true;
      const nav = game.world.nav, a = city.chunkOf(x - m, z - m), b = city.chunkOf(x + m, z + m);
      for (let cz = a.cz; cz <= b.cz; cz++) for (let cx = a.cx; cx <= b.cx; cx++) if (!nav.hasChunk(cx + '_' + cz)) return false;
      return true;
    },
    // (x, z) のチャンクと周り 1 つ（地図の中だけ）が全部読んであるか（読み込み中の待ち）
    ringLoaded(game, x, z) {
      const city = game.city;
      if (!game.isCity || !city) return true;
      const nav = game.world.nav, c = city.chunkOf(x, z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cx = c.cx + dx, cz = c.cz + dz;
        if (cx < 0 || cz < 0 || cx >= city.ncx || cz >= city.ncz) continue;
        if (!nav.hasChunk(cx + '_' + cz)) return false;
      }
      return true;
    },
    // 今いるホットゾーン（無ければ null）
    zoneAt(city, x, z) {
      let best = null, bd = Infinity;
      for (const h of (city && city.hotZones) || []) { const d = Math.hypot(x - h.x, z - h.z); if (d < h.r && d < bd) { bd = d; best = h; } }
      return best;
    },

    // 乗り物（出ている物・まだ出していないチャンクの物・覚えている物）から離れているか。y は足の高さ（違う高さの物は見ない）
    clearOfVehicles(game, x, y, z, cfg) {
      const types = ((game.config && game.config.vehicles) || {}).types || {};
      const kindOf = (type) => (types[type] && types[type].kind) || 'car';
      const mOf = (kind) => (kind === 'jet' ? cfg.jetClear : cfg.vehicleClear);
      const dy = cfg.vehicleDy, scan = cfg.vehicleScan; // 違う高さの物は見ない・足元の長方形 + 余白が届く距離（戦闘機の主翼で 約 15 m）
      for (const v of game.vehicles || []) {
        if (v.sunk) continue;
        if (Math.abs((v.pos.y || 0) - y) > dy) continue;
        const kind = v.kind === 'jet' || v.kind === 'heli' ? v.kind : 'car';
        if (inFootprint(footprint(kind, v.def), v.pos.x, v.pos.z, v.yaw || 0, x, z, mOf(kind))) return false;
      }
      if (!game.isCity || !game.world || !game.world.cache) return true;
      const live = game._cityVehById, saved = game._cityVehState, city = game.city, W = game.world;
      if (saved) for (const [id, st] of saved) {
        if (live && live.has(id)) continue;
        if (Math.abs((st.y || 0) - y) > dy || Math.hypot(st.x - x, st.z - z) > scan) continue;
        const kind = kindOf(st.spec && st.spec.type);
        if (inFootprint(footprint(kind, types[st.spec && st.spec.type]), st.x, st.z, st.yaw || 0, x, z, mOf(kind) + cfg.specClear)) return false;
      }
      // チャンクの乗り物（まだ出ていない物。読んであるチャンクだけ = 新しく作らない）
      const a = city.chunkOf(x - scan, z - scan), b = city.chunkOf(x + scan, z + scan);
      for (let cz = a.cz; cz <= b.cz; cz++) for (let cx = a.cx; cx <= b.cx; cx++) {
        if (!W.cache.has(cx, cz)) continue;
        const d = W.cache.full(cx, cz);
        if (!d || !d.vehicles) continue;
        for (const sp of d.vehicles) {
          if ((live && live.has(sp.id)) || (saved && saved.has(sp.id))) continue;
          if (Math.abs((sp.y || 0) - y) > dy || Math.hypot(sp.x - x, sp.z - z) > scan) continue;
          const kind = kindOf(sp.type);
          if (inFootprint(footprint(kind, types[sp.type]), sp.x, sp.z, (sp.yaw || 0) * Math.PI / 180, x, z, mOf(kind) + cfg.specClear)) return false;
        }
      }
      return true;
    },

    // 細かい確かめ（「復活」の直前と、読んである候補）。out に足を置く位置 { x, y, z }
    validate(game, x, y, z, cfg, out) {
      const nav = game.world.nav, r = (game.player && game.player.radius) || 0.4;
      if (game.isCity) {
        const c = game.city;
        if (x < c.minX + 3 || x > c.maxX - 3 || z < c.minZ + 3 || z > c.maxZ - 3) return false;
        if (!Spots.loadedAround(game, x, z, r + 2)) return false;
        const gi = nav.groundInfo(x, z, y + cfg.stepHint, cfg.probeR);
        if (gi.y == null) return false;
        if (gi.water != null && gi.y < gi.water + 0.3) return false; // 水面の下（泳ぐ）
        const q = nav.resolveCapsule({ x, y: gi.y, z }, r, 1.8, 0.45, { snapDown: 0.45 });
        if (!q.grounded || Math.hypot(q.x - x, q.z - z) > cfg.maxPush || Math.abs(q.y - gi.y) > 0.5) return false;
        if (q.water != null && q.y < q.water + 0.3) return false;
        if (nav.ceilingHeight(q.x, q.z, q.y + 0.05, r * 0.9) < q.y + cfg.headroom) return false;
        if (!Spots.clearOfVehicles(game, q.x, q.y, q.z, cfg)) return false;
        if (Spots.heliOnlyBlocked(game, q.x, q.y, q.z, cfg)) return false;
        if (out) { out.x = q.x; out.y = q.y; out.z = q.z; }
        return true;
      }
      const half = ((game.level && game.level.size) || 100) / 2 - 1.5;
      if (Math.abs(x) > half || Math.abs(z) > half) return false;
      if (nav.isBlockedAt && nav.isBlockedAt(x, z)) return false;
      const q = nav.resolveCircle ? nav.resolveCircle(x, z, r) : { x, z };
      if (Math.hypot(q.x - x, q.z - z) > cfg.maxPush) return false;
      if (!Spots.clearOfVehicles(game, q.x, 0, q.z, cfg)) return false;
      if (out) { out.x = q.x; out.y = 0; out.z = q.z; }
      return true;
    },

    // validate が通らなければ同じ高さで fineStep m ずつ渦巻きに fineSnap m まで（読んであるチャンクだけ）
    fineSnap(game, x, y, z, cfg, out) {
      if (Spots.validate(game, x, y, z, cfg, out)) return true;
      const step = cfg.fineStep || 1;
      for (let r = step; r <= cfg.fineSnap + 1e-6; r += step) {
        const n = Math.max(6, Math.round(2 * Math.PI * r / step));
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (!Spots.loadedAround(game, px, pz, 2.4)) continue;
          if (Spots.validate(game, px, y, pz, cfg, out)) return true;
        }
      }
      return false;
    },

    // 危なさ。out.cls: 0 安全 / 1 敵に見える / 2 倒した敵に見える / 3 enemyClear m 以内に敵
    threat(game, x, y, z, cfg, out) {
      out = out || {};
      let minD = Infinity, seen = false, byKiller = false, seers = 0, close = 0, need = 0;
      const nav = game.world.nav, killer = game._lastAttacker, eyeY = y + 1.4;
      const here = Spots.loadedAround(game, x, z, 1);
      for (const e of game.enemies || []) {
        if (e.dead || e.removed) continue;
        const ey = e.pos.y || 0, dx = e.pos.x - x, dy = ey - y, dz = e.pos.z - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < minD) minD = d;
        if (d < cfg.enemyClear) close++;
        if (d > cfg.losRange) { if (d < cfg.enemyClear) need++; continue; }
        // 読んでいないチャンク = 箱が無い = 見える、と悲観的に
        const los = (!here || !Spots.loadedAround(game, e.pos.x, e.pos.z, 1)) ? true : nav.lineOfSight(e.pos.x, ey + 1.55, e.pos.z, x, eyeY, z);
        if (los) { seen = true; seers++; if (e === killer) byKiller = true; }
        if (los || d < cfg.enemyClear) need++;
      }
      out.minDist = minD; out.seen = seen; out.seenByKiller = byKiller; out.seers = seers; out.close = close; out.need = need;
      out.cls = minD < cfg.enemyClear ? 3 : (byKiller ? 2 : (seen ? 1 : 0));
      return out;
    },

    // ---------- 候補（安い計算だけ。{ x, y, z, yawDeg, kind, pref }。pref が小さいほど先）----------

    // ホットゾーンの通りの点（citygen の spawnPoints('online')。空母は甲板）
    zoneCandidates(game, id, cfg, seed) {
      const city = game.city, h = (city.hotZones || []).find((z) => z.id === id);
      if (!h) return [];
      if ((cfg.deckZones || []).indexOf(id) >= 0) return Spots.deckCandidates(game, cfg);
      const pts = city.spawnPoints('online').filter((p) => p.zone === id);
      const ord = shuffle(pts.length, mix(seed | 0, 0x3a1));
      return pts.map((p, i) => ({ x: p.x, y: p.y || 0, z: p.z, yawDeg: yawTo(p.x, p.z, h.x, h.z), kind: 'street', zone: id, pref: ord.indexOf(i) }));
    },

    // ランダム: 死んだゾーンではないゾーン（できれば）を seed で 2 つ。1 つ目の点が先
    randomCandidates(game, dp, cfg, seed) {
      const city = game.city, deck = cfg.deckZones || [];
      const spawns = city.spawnPoints('online');
      const zones = (city.hotZones || []).filter((h) => deck.indexOf(h.id) < 0 && spawns.some((p) => p.zone === h.id));
      if (!zones.length) return [];
      const dz = dp ? Spots.zoneAt(city, dp.x, dp.z) : null;
      let ord = shuffle(zones.length, mix(seed | 0, 0x5b7)).map((i) => zones[i]);
      if (dz && ord.length > 1) ord = ord.filter((h) => h !== dz).concat([dz]);
      const out = [];
      ord.slice(0, 2).forEach((h, k) => { for (const c of Spots.zoneCandidates(game, h.id, cfg, seed)) { c.pref += k * 100; out.push(c); } });
      return out;
    },

    // 空母の飛行甲板（midtown.json の params.deckOutline = landmarks2 の外形 CV_OUT。ローカル）。右舷のエレベーター（params.deck。外形の外の床）は
    //   甲板に数えない: 三方が 17 m の段差で、そこに出ると次の戦闘機へ歩くだけで海へ落ちた（落ちると船体を登れない）。
    //   外形が無ければ甲板の床の箱（citygen の _carrierDeck）。空母が無ければ null
    _deck(city) {
      let D = DECK.get(city);
      if (D === undefined) {
        const lm = ((city.plan && city.plan.landmarks) || []).find((l) => l.kind === 'carrier'), p = lm && lm.params;
        D = null;
        if (p) {
          const th = p.yaw * Math.PI / 180;
          D = { x: p.x, z: p.z, c: Math.round(Math.cos(th)), sn: Math.round(Math.sin(th)), poly: p.deckOutline && p.deckOutline.length > 2 ? p.deckOutline : null,
            boxes: typeof city._carrierDeck === 'function' ? city._carrierDeck(p) : (p.deck || []) };
        }
        DECK.set(city, D);
      }
      return D;
    },
    // (x, z) が甲板の中で、縁から m m 以上内側か。甲板が分からなければ true（validate に任せる）
    onDeck(city, x, z, m) {
      const D = Spots._deck(city);
      if (!D) return true;
      const dx = x - D.x, dz = z - D.z, lx = dx * D.c - dz * D.sn, lz = dx * D.sn + dz * D.c, P = D.poly;
      if (P) {
        let inside = false, md = Infinity;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const ax = P[j][0], az = P[j][1], bx = P[i][0], bz = P[i][1];
          if ((az > lz) !== (bz > lz) && lx < ax + (bx - ax) * (lz - az) / (bz - az)) inside = !inside;
          const d = segDist(lx, lz, ax, az, bx, bz);
          if (d < md) md = d;
        }
        return inside && md >= m;
      }
      if (!D.boxes || !D.boxes.length) return true;
      const inB = (u, v) => { for (const b of D.boxes) if (u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3]) return true; return false; };
      return inB(lx, lz) && inB(lx + m, lz) && inB(lx - m, lz) && inB(lx, lz + m) && inB(lx, lz - m);
    },
    // (ax, az) から (bx, bz) へまっすぐ歩いても甲板の外へ出ないか（step m ごとに縁から m m 内側）
    deckPath(city, ax, az, bx, bz, m, step) {
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (step || 1)));
      for (let i = 0; i <= n; i++) if (!Spots.onDeck(city, ax + (bx - ax) * i / n, az + (bz - az) * i / n, m)) return false;
      return true;
    },

    // 空母の甲板: 駐機している戦闘機の横と後ろ（主翼・尾翼 + jetClear の外）。甲板の外形の deckEdge m 内側（エレベーターは外）で、
    //   どの駐機場所の戦闘機へまっすぐ歩いても甲板から出ない（deckPathEdge）。誘導路・カタパルトから laneClear m、着艦の帯から
    //   deckLandingClear m（甲板員が「着艦の場所にかかる」と見るのと同じ foulPad。艦橋の後ろの 3 機はその線のすぐ外に止まっている）。
    //   艦橋の後ろの 3 機は斜めに並ぶので、j_1・j_2 の横はどこも後ろの機体の機首の前（走り出す所: 主翼の幅 + jetClear、機首から
    //   deckNoseAhead m）になる: そこは止めてある機体の前なら + deckSweepPenalty（使うのは前のない候補の機体が出払っているとき）。
    //   pref = その候補の機体が駐機場所にいればそこまでの距離、いなければ（飛んでいる・壊れた・動かした）100 + いる機体の一番近いものまでの距離。
    //   向き（face）は候補の機体、いなければ一番近いいる機体
    deckCandidates(game, cfg) {
      const city = game.city, co = city && city.carrierOps;
      if (!co) return [];
      // 候補の並べ方（形の決まりで、調整する数値ではない）: 主翼の外 + 1 m の左右に、機首側 / 尾側へ 4 m ずつずらした点と、尾翼の後ろ 1 点。
      //   どれが使えるかは下の確かめ（甲板の外形・誘導路・着艦の帯・ほかの機体の主翼）が決める
      const J = footprint('jet'), off = J.x1 + cfg.jetClear + 1, back = -J.z0 + cfg.jetClear + 1;
      const nose = { x0: -(J.x1 + cfg.jetClear), x1: J.x1 + cfg.jetClear, z0: J.z1, z1: J.z1 + (cfg.deckNoseAhead || 0) };
      const local = [[off, 0], [-off, 0], [off, 4], [-off, 4], [off, -4], [-off, -4], [off, 8], [-off, 8], [off, -8], [-off, -8], [off, 12], [-off, 12], [off, 16], [-off, 16], [-off, 20], [0, -back]];
      const B = co.box, e = cfg.deckEdge, L = co.landing, m = cfg.laneClear, lm = cfg.deckLandingClear != null ? cfg.deckLandingClear : m;
      const helis = city.vehicleSpawns().filter((v) => v.type === 'heli' && Math.abs((v.y || 0) - co.deckY) < cfg.vehicleDy);
      const parked = co.jetSpots.map((s, k) => Spots.jetParked(game, k, s));
      const out = [];
      co.jetSpots.forEach((s, k) => {
        const a = s.yaw * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
        for (const q of local) {
          const x = s.x + q[0] * c + q[1] * sn, z = s.z - q[0] * sn + q[1] * c;
          if (x < B.x0 + e || x > B.x1 - e || z < B.z0 + e || z > B.z1 - e || !Spots.onDeck(city, x, z, e)) continue;
          if (co.jetSpots.some((t) => inFootprint(J, t.x, t.z, t.yaw * Math.PI / 180, x, z, cfg.jetClear))) continue;
          if (co.jetSpots.some((t) => !Spots.deckPath(city, x, z, t.x, t.z, cfg.deckPathEdge, cfg.deckPathStep))) continue;
          if ((co.lanes || []).some((ln) => { for (let i = 0; i + 1 < ln.pts.length; i++) if (segDist(x, z, ln.pts[i].x, ln.pts[i].z, ln.pts[i + 1].x, ln.pts[i + 1].z) < m) return true; return false; })) continue;
          if ((co.cats || []).some((ct) => segDist(x, z, ct.x, ct.z, ct.endX, ct.endZ) < m)) continue;
          if (L) {
            const dx = x - L.x, dz = z - L.z, al = dx * L.fx + dz * L.fz, lt = dx * L.rx + dz * L.rz;
            if (al > -(L.rampDist || 0) - lm && al < L.length + lm && lt < (L.halfWidthStbd || 12) + lm && lt > -(L.halfWidthPort || 12) - lm) continue;
          }
          if (helis.some((hv) => Math.hypot(hv.x - x, hv.z - z) < cfg.heliClear)) continue;
          const sweep = co.jetSpots.some((t, i) => parked[i] && inFootprint(nose, t.x, t.z, t.yaw * Math.PI / 180, x, z, 0));
          let tk = k;
          if (!parked[k]) { let bd = Infinity; co.jetSpots.forEach((t, i) => { const d = Math.hypot(t.x - x, t.z - z); if (parked[i] && d < bd) { bd = d; tk = i; } }); }
          const T = co.jetSpots[tk], dT = Math.round(Math.hypot(x - T.x, z - T.z) * 10) / 10;
          out.push({ x, y: co.deckY, z, yawDeg: yawTo(x, z, T.x, T.z), face: { x: T.x, z: T.z }, kind: 'deck', jet: k, sweep,
            pref: (parked[k] ? dT : 100 + (parked[tk] ? dT : 100)) + (sweep ? (cfg.deckSweepPenalty || 0) : 0) });
        }
      });
      return out;
    },

    // 甲板の k 番目の駐機場所（j_<k+1>）に戦闘機が止まっているか: 出ている機体はその場所から 3 m 以内で壊れていない・飛んでいない、
    //   出ていなければ覚えている状態（動かした・壊した）が無いか場所の近く
    jetParked(game, k, s) {
      const id = 'j_' + (k + 1), v = game._cityVehById && game._cityVehById.get(id);
      if (v) return !v.wrecked && !v.sinking && !v.sunk && v.mode !== 'air' && Math.hypot(v.pos.x - s.x, v.pos.z - s.z) < 3;
      const st = game._cityVehState && game._cityVehState.get(id);
      return !st || Math.hypot(st.x - s.x, st.z - s.z) < 3;
    },

    // ヘリポートにヘリが降りているか → { x, z, yaw（rad）} | null。そのパッドのヘリ（h_<パッド>）: 出ている機体は壊れて・沈んでいない・地上で
    //   パッドの上（中心から pad.r、高さ ±padHeliDy m）、出ていなければ覚えている状態（動かした・空中で手放した）が同じ条件、どちらも無ければ
    //   （触っていない）置いた所（vehicleSpawns）。そのヘリがいなくても、ほかのヘリ（乗って来て置いた）が同じ条件ならそれ。ヘリを出さない設定なら null
    padHeli(game, pad, cfg) {
      const id = 'h_' + pad.id, types = ((game.config && game.config.vehicles) || {}).types || {};
      if (!types.heli || !MR.Helicopter || (game.cityCfg && game.cityCfg.helis === false)) return null;
      const dy = (cfg && cfg.padHeliDy) || 3, live = game._cityVehById, saved = game._cityVehState;
      const on = (x, y, z) => Math.hypot(x - pad.x, z - pad.z) < pad.r && Math.abs(y - pad.y) < dy;
      const liveOk = (v) => v.kind === 'heli' && !v.wrecked && !v.sinking && !v.sunk && v.grounded !== false && on(v.pos.x, v.pos.y, v.pos.z);
      const savedOk = (st) => !st.air && on(st.x, st.y, st.z);
      const own = live && live.get(id);
      if (own) { if (liveOk(own)) return { x: own.pos.x, z: own.pos.z, yaw: own.yaw || 0 }; }
      else {
        const st = saved && saved.get(id);
        if (st) { if (savedOk(st)) return { x: st.x, z: st.z, yaw: st.yaw || 0 }; }
        else {
          const sp = game.city.vehicleSpawns().find((q) => q.id === id);
          if (sp && on(sp.x, sp.y == null ? pad.y : sp.y, sp.z)) return { x: sp.x, z: sp.z, yaw: (sp.yaw || 0) * Math.PI / 180 };
        }
      }
      for (const v of game.vehicles || []) if (v !== own && liveOk(v)) return { x: v.pos.x, z: v.pos.z, yaw: v.yaw || 0 };
      if (saved) for (const [k, st] of saved) if (k !== id && !(live && live.has(k)) && st.spec && st.spec.type === 'heli' && savedOk(st)) return { x: st.x, z: st.z, yaw: st.yaw || 0 };
      return null;
    },

    // ヘリでしか行けないパッド（access 'heli'）の上（中心から pad.r + heliClear m・パッドの高さ ±padHeliDy m）で、ヘリが降りていない
    heliOnlyBlocked(game, x, y, z, cfg) {
      const dy = cfg.padHeliDy || 3;
      for (const pad of (game.city && game.city.helipads) || []) {
        if (pad.access !== 'heli' || Math.abs(y - pad.y) > dy || Math.hypot(x - pad.x, z - pad.z) > pad.r + cfg.heliClear) continue;
        if (!Spots.padHeli(game, pad, cfg)) return true;
      }
      return false;
    },

    // ヘリポート: パッドの縁（中心から pad.r − padRim）の、降りているヘリ（padHeli）の横から。heliClear 以上離れて機体の箱の外、ヘリの方を向く。
    //   ヘリが無ければ縁で中心を向く。ヘリでしか行けないパッド（access 'heli': 230 m の塔の上）はヘリが降りているときだけ
    //   （いなければ []: 歩いて降りられない）。小さいパッドは入れる建物の上なら屋上の出口、無ければ []（「ここには出られません」）
    padCandidates(game, pad, cfg) {
      const hv = Spots.padHeli(game, pad, cfg);
      if (!hv && pad.access === 'heli') return [];
      const hx = hv ? hv.x : pad.x, hz = hv ? hv.z : pad.z, yaw = hv ? hv.yaw : 0;
      const R = pad.r - cfg.padRim, out = [];
      if (R >= cfg.heliClear) {
        const H = footprint('heli'), c = Math.cos(yaw), s = Math.sin(yaw);
        // 機体の横（置いた向きの左右・少し内側で前後 2 m）が先、残りは縁を 30° ごと（降りたヘリが中心から外れていても縁の上）。
        //   候補の並べ方（形の決まりで、調整する数値ではない。離れ具合は heliClear / vehicleClear の確かめが決める）
        const qs = [[R, 0], [-R, 0], [R * 0.95, 2], [-R * 0.95, 2], [R * 0.95, -2], [-R * 0.95, -2]];
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; qs.push([Math.cos(a) * R, Math.sin(a) * R]); }
        for (const q of qs) {
          const x = pad.x + q[0] * c + q[1] * s, z = pad.z - q[0] * s + q[1] * c;
          if (Math.hypot(x - hx, z - hz) < cfg.heliClear - 1e-6) continue;
          if (hv && inFootprint(H, hx, hz, yaw, x, z, cfg.vehicleClear)) continue;
          if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 1)) continue;
          out.push({ x, y: pad.y, z, yawDeg: yawTo(x, z, hx, hz), face: { x: hx, z: hz }, kind: 'pad', pref: out.length, pad: pad.id });
        }
      }
      return out;
    },

    // 読んであるチャンクの入れる建物（chunkFull().buildings）。each(b) が true を返したらやめる
    _loadedBuildings(game, each) {
      const W = game.world;
      for (const ch of W.nav.chunks.values()) {
        if (!W.cache.has(ch.cx, ch.cz)) continue;
        const d = W.cache.full(ch.cx, ch.cz);
        for (const b of (d && d.buildings) || []) if (each(b)) return;
      }
    },

    // 近く: 死んだ所から nearMin〜nearMax m の通り（輪）・ホットゾーンの点・読んである入れる建物の扉と屋上。
    //   空母の上で死んだら甲板。何も無ければ nearMaxFar m まで輪を広げ、それでも無ければ一番近いホットゾーン（note）
    nearCandidates(game, dp, cfg, seed) {
      const city = game.city, co = city.carrierOps, e = cfg.deckEdge;
      if (co && dp.x > co.box.x0 - e && dp.x < co.box.x1 + e && dp.z > co.box.z0 - e && dp.z < co.box.z1 + e) return { list: Spots.deckCandidates(game, cfg) };
      const list = [];
      const inB = (x, z) => x > city.minX + 3 && x < city.maxX - 3 && z > city.minZ + 3 && z < city.maxZ - 3;
      const face = (c) => { c.yawDeg = yawTo(c.x, c.z, dp.x, dp.z); return c; };
      const ring = (r0, r1, steps) => {
        const n = cfg.nearAngles;
        for (let k = 0; k < steps; k++) {
          const r = steps > 1 ? r0 + (r1 - r0) * k / (steps - 1) : r0;
          for (let i = 0; i < n; i++) {
            const a = (i + 0.5 * (k % 2)) / n * Math.PI * 2, x = dp.x + Math.cos(a) * r, z = dp.z + Math.sin(a) * r;
            if (!inB(x, z) || city.isWater(x, z) || city._kept(x, z, 1)) continue;
            list.push(face({ x, y: city.groundY(x, z), z, kind: 'street', pref: Math.abs(r - cfg.nearPref) }));
          }
        }
      };
      ring(cfg.nearMin, cfg.nearMax, cfg.nearRingSteps);
      const inRange = (x, z) => { const d = Math.hypot(x - dp.x, z - dp.z); return d >= cfg.nearMin && d <= cfg.nearMax ? d : -1; };
      // ホットゾーンの点（もう作ってあれば。作るのは重いので、まだなら使わない）
      for (const p of city._spawns || []) { const d = inRange(p.x, p.z); if (d >= 0) list.push(face({ x: p.x, y: p.y || 0, z: p.z, kind: 'street', pref: Math.abs(d - cfg.nearPref) })); }
      // 扉の前（壁が背中を守る）と屋上（階段で上がれる）
      Spots._loadedBuildings(game, (b) => {
        if (b.door) { const d = inRange(b.door[0], b.door[2]); if (d >= 0) list.push(face({ x: b.door[0], y: b.door[1], z: b.door[2], kind: 'door', pref: Math.abs(d - cfg.nearPref) })); }
        if (b.roof) { const d = inRange(b.roof[0], b.roof[2]); if (d >= 0) list.push(face({ x: b.roof[0], y: b.roof[1], z: b.roof[2], kind: 'roof', pref: Math.abs(d - cfg.nearPref) + cfg.nearRoofPenalty })); }
        return false;
      });
      // 近くに陸が無い: 輪を nearGrow m ずつ nearMaxFar m まで広げる。空母（水の上なので輪には入らない）がその輪より近ければ甲板
      const deckZ = co ? (city.hotZones || []).find((h) => (cfg.deckZones || []).indexOf(h.id) >= 0) : null;
      const dDeck = co ? Math.hypot(Math.max(co.box.x0 - dp.x, 0, dp.x - co.box.x1), Math.max(co.box.z0 - dp.z, 0, dp.z - co.box.z1)) : Infinity;
      for (let R = cfg.nearMax; !list.length && R <= cfg.nearMaxFar + 1e-6; R += cfg.nearGrow) {
        if (deckZ && dDeck <= R) {
          const deck = Spots.deckCandidates(game, cfg);
          if (deck.length) return { list: deck, note: '近くに陸がないので ' + deckZ.label + ' から' };
        }
        if (R > cfg.nearMax) ring(R, R, 1);
      }
      if (list.length) return { list };
      // 近くに陸が無い（川の上で墜ちた）: 一番近いホットゾーン
      let best = null, bd = Infinity;
      for (const h of city.hotZones || []) {
        if ((cfg.deckZones || []).indexOf(h.id) >= 0) continue;
        const d = Math.hypot(h.x - dp.x, h.z - dp.z);
        if (d < bd) { bd = d; best = h; }
      }
      return best ? { list: Spots.zoneCandidates(game, best.id, cfg, seed), zone: best, note: '近くに出られる場所がないので ' + best.label + ' から' } : { list: [] };
    },

    // アリーナ: kind = center | random | near | pt（i は 0 始まり）。nearestFree を通す（古い MR.Nav は安い）
    arenaCandidates(game, kind, i, cfg, dp, seed) {
      const nav = game.world.nav, L = game.level || {}, start = L.playerStart || [0, 0, 0];
      const half = (L.size || 100) / 2 - 3, out = [];
      const add = (x, z, pref, yawDeg, snap) => {
        const f = nav.nearestFree(x, z);
        if (snap != null && Math.hypot(f.x - x, f.z - z) > snap) return; // 輪の点が箱の中: 押し出すと遠くへ行くので使わない
        if (out.some((c) => Math.hypot(c.x - f.x, c.z - f.z) < 1)) return;
        out.push({ x: f.x, y: 0, z: f.z, yawDeg: yawDeg == null ? yawTo(f.x, f.z, 0, 0) : yawDeg, kind: 'arena', pref });
      };
      // 中央・地点: その点（pref 0）と周りの輪（pointRings m・pointAngles 個。pref = 輪の半径。箱の中の点 = 押し出しが pointSnap m を超えるものは
      //   使わない）。見られていない所が先に並ぶので、点が敵に見えるときは近くの物陰へ（アリーナは狭く、1 点だけだとほぼ毎回だれかに見られていた）
      const point = (px, pz, yawDeg) => {
        add(px, pz, 0, yawDeg);
        const n = cfg.pointAngles || 8;
        (cfg.pointRings || []).forEach((R, k) => {
          for (let j = 0; j < n; j++) {
            const a = (j + 0.5 * (k % 2)) / n * Math.PI * 2, x = px + Math.cos(a) * R, z = pz + Math.sin(a) * R;
            if (Math.abs(x) > half || Math.abs(z) > half) continue;
            add(x, z, R, yawDeg, cfg.pointSnap == null ? 1.5 : cfg.pointSnap);
          }
        });
      };
      if (kind === 'center') point(start[0], start[1], start[2] || 0);
      else if (kind === 'pt') { const p = (L.spawnPoints || [])[i]; if (p) point(p[0], p[1], null); }
      else if (kind === 'random') {
        const r = rand(mix(seed | 0, 0x7c3));
        for (let k = 0; k < cfg.randomSamples; k++) add(-half + r() * 2 * half, -half + r() * 2 * half, k);
      } else if (kind === 'near' && dp) {
        const steps = Math.max(1, cfg.nearRingSteps | 0), n = Math.max(1, cfg.nearAngles | 0), mid = (cfg.nearMin + cfg.nearMax) / 2;
        for (let k = 0; k < steps; k++) {
          const R = steps > 1 ? cfg.nearMin + (cfg.nearMax - cfg.nearMin) * k / (steps - 1) : cfg.nearMin;
          for (let j = 0; j < n; j++) {
            const a = (j + 0.5 * (k % 2)) / n * Math.PI * 2, x = dp.x + Math.cos(a) * R, z = dp.z + Math.sin(a) * R;
            if (Math.abs(x) > half || Math.abs(z) > half) continue;
            add(x, z, Math.abs(R - mid));
          }
        }
      }
      return out;
    },

    // ---------- 地図をタップした所（1 回のタップに 1 回。安い計算 + タップしたチャンクの chunkFull 1 つまで（橋の縁は隣のチャンクも 1 つ））----------
    //   → { ok, why（out | water | pad | blocked）, x, y, z, kind（deck | pad | roof | structure | street | park）, face, pts, ms }
    coarseSnap(game, x, z, ppm, cfg) {
      const t0 = now(), city = game.city, res = { ok: false, why: '', x, y: 0, z, kind: '', face: null, pts: 0, ms: 0 };
      const done = () => { res.ms = now() - t0; return res; };
      // 地上（street）でも公園の中なら park（地図の印の名前が「公園」になる）
      const parkAt = (px, pz) => ((city && city.plan && city.plan.parks) || []).some((pk) => pk.rect && px >= pk.rect[0] && px <= pk.rect[2] && pz >= pk.rect[1] && pz <= pk.rect[3]);
      const hit = (px, py, pz, kind, face) => { res.ok = true; res.x = px; res.y = py; res.z = pz; res.kind = kind === 'street' && parkAt(px, pz) ? 'park' : kind; res.face = face || null; return done(); };
      if (!city) { res.why = 'out'; return done(); }
      if (x < city.minX + 3 || x > city.maxX - 3 || z < city.minZ + 3 || z > city.maxZ - 3) { res.why = 'out'; return done(); }
      const nearest = (list) => { let b = null, bd = Infinity; for (const c of list) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; b = c; } } return b; };
      // 1. 空母の上 → 甲板の一番近い点（向きは戦闘機）
      const co = city.carrierOps;
      if (co && x > co.box.x0 && x < co.box.x1 && z > co.box.z0 && z < co.box.z1) {
        const b = nearest(Spots.deckCandidates(game, cfg));
        if (b) return hit(b.x, b.y, b.z, 'deck', b.face);
      }
      // 2. ヘリポート → ヘリの横（向きはヘリ）
      for (const pad of city.helipads || []) {
        if (Math.hypot(pad.x - x, pad.z - z) >= pad.r) continue;
        const b = nearest(Spots.padCandidates(game, pad, cfg));
        if (b) return hit(b.x, b.y, b.z, 'pad', b.face);
        const bl = Spots._buildingAt(game, pad.x, pad.z);
        if (bl && bl.roof) return hit(bl.roof[0], bl.roof[1], bl.roof[2], 'roof');
        res.why = 'pad'; return done();
      }
      const water = city.isWater(x, z), gy = city.groundY(x, z), sh = city.supportHeightAt(x, z);
      const ws = Math.min(cfg.waterSnapMax, cfg.waterSnapPx / Math.max(1e-3, ppm));
      // 3. 建物・高架・橋の上: 入れる建物なら屋上の出口、高架・橋（水の上でも）・桟橋なら一番上の道・歩道・床の面（頭の上が空いている所）。
      //   ほかの屋上（入れない・ロビーの塔）は近くの通り。水の上の建物（空母の横の格納庫。地図では水）は選ばない
      if (sh - gy > cfg.roofMinH) {
        const b = Spots._buildingAt(game, x, z);
        if (b && b.roof && !water) return hit(b.roof[0], b.roof[1], b.roof[2], 'roof');
        if (!b) {
          const top = Spots._walkTopAt(game, x, z, cfg);
          if (top !== null && top - gy > cfg.roofMinH) return hit(x, top, z, 'structure');
        }
      }
      // 地図に描いてある橋の上・縁から指の太さまで（トラス・防護柵の上をタップした）: 橋の幅の中で一番近い道・歩道の面
      const bs = Spots._bridgeSnap(game, x, z, ws, cfg);
      if (bs) return hit(bs.x, bs.y, bs.z, 'structure');
      const street = (px, pz) => !city.isWater(px, pz) && !city._kept(px, pz, 1) && city.supportHeightAt(px, pz) - city.groundY(px, pz) < cfg.streetMaxH;
      // 4. 水の上: 岸から指の太さ（waterSnap m）までだけ
      if (water) {
        const st = Math.max(0.5, ws / 5);
        for (let r = st; r <= ws + 1e-6; r += st) {
          const n = Math.max(8, Math.round(2 * Math.PI * r / st));
          for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
            res.pts++;
            if (street(px, pz)) return hit(px, city.groundY(px, pz), pz, 'street');
          }
        }
        res.why = 'water'; return done();
      }
      // 5. 近くの通り（渦巻き。pickMaxPts 点まで）
      const snapR = Math.min(cfg.pickSnapMax, Math.max(cfg.pickSnap, cfg.pickSnapPx / Math.max(1e-3, ppm)));
      const step = Math.max(cfg.pickStep, snapR / cfg.pickRings);
      res.pts++;
      if (street(x, z)) return hit(x, gy, z, 'street');
      for (let r = step; r <= snapR + 1e-6 && res.pts < cfg.pickMaxPts; r += step) {
        const n = Math.max(8, Math.round(2 * Math.PI * r / step));
        for (let i = 0; i < n && res.pts < cfg.pickMaxPts; i++) {
          const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          res.pts++;
          if (street(px, pz)) return hit(px, city.groundY(px, pz), pz, 'street');
        }
      }
      res.why = 'blocked'; return done();
    },
    // (x, z) を含む入れる建物（タップしたチャンク = 作ってもこれ 1 つ。周りは読んであるものだけ）
    _buildingAt(game, x, z) {
      const city = game.city, W = game.world, c = city.chunkOf(x, z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cx = c.cx + dx, cz = c.cz + dz;
        if (cx < 0 || cz < 0 || cx >= city.ncx || cz >= city.ncz) continue;
        if ((dx || dz) && !W.cache.has(cx, cz)) continue;
        const d = W.cache.full(cx, cz);
        for (const b of (d && d.buildings) || []) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
      }
      return null;
    },
    // (x, z) の立てる面のうち道・歩道・桟橋・床（高架・橋）の箱と道の斜路の上面で、頭の上 headroom m に固い箱が無い一番高いもの（無ければ null）。
    //   橋の床の上のトラスの天板（landmark）のような上の物は飛ばす。見るのは (x, z) のチャンクと、読んである周りのチャンク（長い斜路・床は
    //   持ち主のチャンクの外へ maxOverhang m まではみ出す）。alongX: 東西の隣は読んでいなくても作る（橋: 長い斜路の区切りがはみ出す）
    _walkTopAt(game, x, z, cfg, alongX) {
      const city = game.city, W = game.world, c = city.chunkOf(x, z), F = (MR.CityGen && MR.CityGen.F) || { WALK: 4, NOCOL: 1 };
      const OK = { road: 1, sidewalk: 1, pier: 1, floor: 1 }, tops = [], head = (cfg && cfg.headroom) || 1.9, lists = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cx = c.cx + dx, cz = c.cz + dz;
        if (cx < 0 || cz < 0 || cx >= city.ncx || cz >= city.ncz) continue;
        if ((dx || dz) && !(alongX && !dz) && !W.cache.has(cx, cz)) continue;
        const d = W.cache.full(cx, cz);
        if (d) lists.push(d);
      }
      const inB = (b) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2;
      for (const d of lists) {
        for (const b of d.boxes || []) if ((b.f & F.WALK) && !(b.f & F.NOCOL) && OK[b.cat] && inB(b)) tops.push(b.y + b.h);
        for (const r of d.ramps || []) {
          if (r.cat !== 'road' || !inB(r)) continue;
          const u = r.axis === 'x' ? (x - (r.x - r.w / 2)) / r.w : (z - (r.z - r.d / 2)) / r.d;
          tops.push(r.dir > 0 ? r.y0 + (r.y1 - r.y0) * u : r.y1 - (r.y1 - r.y0) * u);
        }
      }
      tops.sort((a, b) => b - a);
      for (const top of tops) {
        let free = true;
        for (const d of lists) {
          for (const b of d.boxes || []) if (!(b.f & F.NOCOL) && inB(b) && b.y < top + head && b.y + b.h > top + 0.05) { free = false; break; }
          if (!free) break;
        }
        if (free) return top;
      }
      return null;
    },
    // 地図に描いてある橋（citygen の minimap().bridges）の上か縁から r m まで: 橋の幅の中を bridgeStep m ずつ外へ、道・歩道の面（地面・水面から
    //   roofMinH m より上 = 取り付けの斜路の下の端は除く）の一番近い所 { x, y, z }。無ければ null
    _bridgeSnap(game, x, z, r, cfg) {
      const city = game.city, mini = city && typeof city.minimap === 'function' ? city.minimap() : null;
      for (const br of (mini && mini.bridges) || []) {
        const px = Math.max(br.x0 + 1, Math.min(br.x1 - 1, x)), cz = Math.max(br.z0, Math.min(br.z1, z));
        if (Math.hypot(px - x, cz - z) > r) continue;
        const base = city.groundY(px, (br.z0 + br.z1) / 2), bs = (cfg && cfg.bridgeStep) || 1.5;
        for (let k = 0; k <= 2 * (br.z1 - br.z0) / bs + 1; k++) {
          const pz = cz + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * bs;
          if (pz < br.z0 || pz > br.z1) continue;
          const top = Spots._walkTopAt(game, px, pz, cfg, true);
          if (top !== null && top - Math.max(base, city.groundY(px, pz)) > cfg.roofMinH) return { x: px, y: top, z: pz };
        }
      }
      return null;
    }
  };
  MR.RespawnSpots = Spots;

  // ---------- 死亡画面の「復活する場所」（1 つのソロのゲームに 1 つ）----------
  //   状態: off → wait（カウントダウン。選び直せる）→ ready（「復活」を押せる）→ loading（場所の当たり判定を読む・最後の確かめ）→ off。
  //   picking（地図で選んでいる）は wait / ready の中。onDeath はどの状態からでも最初から。
  //   毎フレーム（死んでいる間）update(dt): キー（1〜9・Space・M）→ カウントダウン → 候補を確かめる仕事（searchMsPerFrame ms まで）→
  //   先読み（選んでから leadDelay 秒動かなければ、その場所の当たり判定を navOpsPerFrame で読む = game._loadNavAt）→ 読み込み中の待ち。
  //   画面の要素は最初に 1 回だけ探して持つ（スモークの偽の DOM は探すたびに新しい物を返す）。ボタンは 1 回だけつなぎ、今のゲーム
  //   （MR.Game._active）の respawnUI に効かせる（bindStatic。「もう一度」で作り直しても重ならない）
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const loadPref = (k) => { try { if (MR.Game && MR.Game._loadPref) return MR.Game._loadPref(k); return window.localStorage ? window.localStorage.getItem('mirrsona.' + k) : null; } catch (e) { return null; } };
  const savePref = (k, v) => { try { if (MR.Game && MR.Game._savePref) MR.Game._savePref(k, v); else if (window.localStorage) window.localStorage.setItem('mirrsona.' + k, v); } catch (e) { /* 無視 */ } };

  class RespawnUI {
    constructor(game, raw) {
      this.game = game;
      this.arena = !game.isCity;
      this.cfg = Spots.config(raw, this.arena);
      this.state = 'off';
      this.picking = false;
      this.lead = null;       // { x, z }: game._updateCity が先読みする所（死んでいる間だけ）
      this.target = null;     // { x, z }: 今いちばん良い場所（アリーナの敵はここの近くに出ない）
      this.navOps = this.cfg.navOpsPerFrame;
      this.options = [];
      this.cands = [];
      this.best = null;
      this.deaths = 0;
      this.stats = { deaths: 0, jobMsMax: 0, jobMs: 0, jobFrames: 0, passes: 0, candidates: 0, evals: 0, leadMoves: 0, cleared: 0, clearedWhy: [], moved: 0, movedWhy: [], fallbacks: 0,
        tapMs: 0, tapMsMax: 0, tapPts: 0, taps: 0, confirmAt: 0, loadSec: 0, respawns: 0, countdown: [], lastKind: '', lastNote: '' };
      const root = game.hud && game.hud.root, q = (s) => (root && root.querySelector ? root.querySelector(s) : null);
      this.root = root;
      this.overlay = game.hud && game.hud.death;
      this.el = { panel: q('#respawn-panel'), opts: q('#rp-opts'), go: q('#rp-go'), sec: q('#rp-go .rp-sec'), map: q('#rp-map'), note: q('#respawn-panel .rp-note'), sel: q('#respawn-panel .rp-sel'), fade: q('#respawn-fade') };
      if (this.el.fade && this.el.fade.style) this.el.fade.style.transitionDuration = this.cfg.fadeSec + 's';
      this.prefKey = this.arena ? 'respawnArena' : 'respawnCity';
      this.selId = loadPref(this.prefKey) || null;
      this.pick = this.arena ? null : RespawnUI.parsePick(loadPref('respawnCityPick'));
      this._html = '';
      RespawnUI.bindStatic();
    }

    // 覚えている地図の場所 "x,y,z,kind[,向く所 x,z]"（甲板・ヘリポートは戦闘機・ヘリの方を向く。古い 4 つの形も読める）
    static parsePick(s) {
      if (!s || typeof s !== 'string') return null;
      const a = s.split(',');
      const x = +a[0], y = +a[1], z = +a[2];
      if (a.length < 3 || !isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
      const fx = +a[4], fz = +a[5];
      return { x, y, z, kind: a[3] || 'street', face: a.length >= 6 && isFinite(fx) && isFinite(fz) ? { x: fx, z: fz } : null };
    }
    static pickString(p) {
      return p.x.toFixed(1) + ',' + p.y.toFixed(2) + ',' + p.z.toFixed(1) + ',' + p.kind + (p.face ? ',' + p.face.x.toFixed(1) + ',' + p.face.z.toFixed(1) : '');
    }

    get minimap() { const p = this.game.play; return p && p.minimap ? p.minimap : null; }
    get defaultId() { return this.arena ? 'center' : 'random'; }
    get selected() { return this.options.find((o) => o.id === this.selId) || null; }

    // ---------- 死んだ ----------
    onDeath(dp) {
      const g = this.game;
      this.deaths++; this.stats.deaths++;
      this.deathPos = { x: dp.x, y: dp.y, z: dp.z };
      this.state = 'off'; // 地図を閉じる（onCancel）で何もしないように
      this.picking = false;
      const mm = this.minimap;
      if (mm && mm.full && mm.full.open) mm.closeFull(); // 目印の地図・選んでいる途中の地図
      this.state = 'wait';
      this.lead = null; this.target = null; this._leadKey = null; this._autoGo = false; this._autoAt = 0; this._loadT = 0; this._loadedAt = null; this._fallback = 0; this._triedZones = [];
      this._passDone = 0;
      if (this._fade) { this._fade = null; if (this.el.fade && this.el.fade.classList) this.el.fade.classList.remove('show'); }
      this.navOps = this.cfg.navOpsPerFrame;
      this.seed = mix(((g.opts && g.opts.spawnSeed) | 0) + 7, this.deaths);
      this._pickChecked = false;
      this._note('');
      this.options = Spots.options(g, this.cfg, this.pick);
      let id = this.selId;
      if (!id || !this.options.some((o) => o.id === id)) id = this.defaultId; // 無くなったゾーン・地図の場所 → 既定
      this.selId = id;
      this._build(id);
      this._selT = g.time;
      this._lastSec = null;
      this.stats.countdown = [];
      this._render(true);
      if (this.el.panel) { this.el.panel.classList.remove('hidden'); this.el.panel.classList.toggle('arena', this.arena); this.el.panel.classList.toggle('kb', !(g.input && g.input.isTouchDevice)); }
      if (this.root && this.root.classList) this.root.classList.add('respawning');
      if (this.overlay && this.overlay.classList) this.overlay.classList.add('choose');
      this._countdown();
      if (typeof document !== 'undefined' && document.exitPointerLock && document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { /* 無視 */ } }
    }

    // ---------- 選ぶ ----------
    select(id, user) {
      if (this.state !== 'wait' && this.state !== 'ready') return false;
      const o = this.options.find((x) => x.id === id);
      if (!o || o.off) return false;
      if (this.picking) this.cancelPick();
      if (id !== this.selId || !this.cands.length) {
        this.selId = id;
        this._build(id);
        this._selT = this.game.time;
        this._autoGo = false;
        this._note(this._baseNote || '');
      }
      savePref(this.prefKey, id);
      this._render();
      return true;
    }
    selectIndex(i) { const o = this.options[i]; return o ? this.select(o.id, true) : false; }
    _move(d) {
      const n = this.options.length;
      let i = this.options.findIndex((o) => o.id === this.selId);
      for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!this.options[i].off) return this.select(this.options[i].id, true); }
      return false;
    }

    // 候補を作り直す（選んだとき・死んだとき）。重い計算はしない（確かめるのは update の仕事）
    _build(id) {
      const g = this.game, cfg = this.cfg, dp = this.deathPos || g.player.pos;
      let list = [];
      this._baseNote = '';
      if (this.arena) {
        if (id.indexOf('pt:') === 0) list = Spots.arenaCandidates(g, 'pt', (+id.slice(3)) - 1, cfg, dp, this.seed);
        else list = Spots.arenaCandidates(g, id, 0, cfg, dp, this.seed);
      } else if (id === 'random') list = Spots.randomCandidates(g, dp, cfg, this.seed);
      else if (id === 'near') { const r = Spots.nearCandidates(g, dp, cfg, this.seed); list = r.list; this._baseNote = r.note || ''; }
      else if (id === 'mapLast' && this.pick) {
        // 甲板・ヘリポートは戦闘機・ヘリの方（face）、ほかは死んだ所の方を向く
        const P = this.pick;
        list = [{ x: P.x, y: P.y, z: P.z, yawDeg: P.face ? yawTo(P.x, P.z, P.face.x, P.face.z) : yawTo(P.x, P.z, dp.x, dp.z), face: P.face || null, kind: P.kind, pref: 0, pick: true }];
      }
      else if (id.indexOf('zone:') === 0) list = Spots.zoneCandidates(g, id.slice(5), cfg, this.seed);
      this._setCands(list);
      this._note(this._baseNote);
    }
    _setCands(list) {
      const cfg = this.cfg;
      for (const c of list) {
        let m = Infinity;
        for (const e of this.game.enemies) if (!e.dead && !e.removed) m = Math.min(m, Math.hypot(e.pos.x - c.x, e.pos.z - c.z));
        c.ccls = m < cfg.enemyClear ? 1 : 0;
        c.ok = false; c.th = null; c.spot = null; c.seen = false;
      }
      list.sort((a, b) => (a.ccls - b.ccls) || (a.pref - b.pref));
      this.cands = list;
      this.best = null;
      this.stats.candidates = list.length;
      this._restartPass();
    }
    _restartPass() { this._job = this._pass(); this._passT = this.game.time; this.stats.passes++; }

    // 候補を 1 つずつ確かめる（読んであるチャンクだけ）。前に通った場所を先に試す
    *_pass() {
      const g = this.game, cfg = this.cfg;
      for (const c of this.cands) {
        if (!Spots.loadedAround(g, c.x, c.z, 2.4)) { c.ok = false; c.unloaded = true; yield; continue; }
        c.unloaded = false;
        const sp = c.spot || (c.spot = { x: c.x, y: c.y, z: c.z });
        let ok = c.ok && Spots.validate(g, sp.x, sp.y, sp.z, cfg, sp);
        if (!ok) ok = Spots.validate(g, c.x, c.y, c.z, cfg, sp);
        if (!ok && c.pick) ok = Spots.fineSnap(g, c.x, c.y, c.z, cfg, sp); // 地図で選んだ所は近くの立てる所へ
        c.ok = ok;
        c.seen = true;
        this.stats.evals++;
        if (ok) c.th = Spots.threat(g, sp.x, sp.y, sp.z, cfg, c.th || {});
        yield;
      }
    }
    _step(ms) {
      if (!this._job) return;
      const t0 = now();
      for (;;) {
        const r = this._job.next();
        if (r.done) { this._job = null; this._passDone = this.game.time; break; }
        if (now() - t0 >= ms) break;
      }
      const dt = now() - t0, st = this.stats;
      st.jobFrames++; st.jobMs += dt; if (dt > st.jobMsMax) st.jobMsMax = dt;
      this._rank();
    }
    _rank() {
      const cfg = this.cfg, mc = cfg.maxCleared + (cfg.maxMoved || 0);
      // 片付けても（maxCleared 体を消す・アリーナは maxMoved 体を動かす）近くに残る・まだ見ている敵の数
      const over = (c) => Math.max(0, (c.th.need || 0) - mc);
      let b = null;
      for (const c of this.cands) {
        if (!c.ok) continue;
        if (!b) { b = c; continue; }
        if (c.th.cls !== b.th.cls) { if (c.th.cls < b.th.cls) b = c; continue; }
        // 危ない所どうし（cls 1〜3）は、片付けた後に残る敵の少ない方 → 敵が近い所どうし（cls 3）は近い敵の少ない方 → pref
        if (c.th.cls >= 1) {
          const oc = over(c), ob = over(b);
          if (oc !== ob) { if (oc < ob) b = c; continue; }
          if (c.th.cls === 3 && c.th.close !== b.th.close) { if (c.th.close < b.th.close) b = c; continue; }
        }
        if (c.pref < b.pref) b = c;
      }
      this.best = b;
    }
    // 先読みする所: 確かめて一番良い場所、まだ無ければ確かめていない（読んでいない）一番目の候補
    _leadCand() {
      if (this.best) return this.best;
      for (const c of this.cands) if (!c.seen || c.unloaded) return c;
      return this.cands[0] || null;
    }

    // ---------- 毎フレーム（死んでいる間。game.js の死んでいる枝から）----------
    update(dt) {
      if (this.state === 'off') return;
      const g = this.game, inp = g.input, cfg = this.cfg;
      // キー（1〜9 は input.js の数字、Space = 復活、M = 地図で選ぶ）。読み込み中は捨てる
      const sel = inp.consumeSelect ? inp.consumeSelect() : -1;
      const jump = inp.consumeJump ? inp.consumeJump() : false;
      const map = inp.consumeMap ? inp.consumeMap() : false;
      if (this.state === 'wait' || this.state === 'ready') {
        if (sel >= 0) this.selectIndex(sel);
        if (map && !this.arena) { if (this.picking) this.cancelPick(); else this.openPick(); }
        if (jump) { if (this.picking) this.confirmPick(); else this.confirm(); }
      }
      // 覚えている地図の場所がまだ使えるか（死んだ次のフレーム。支えの格子を初めて作ると重いので死んだフレームから外す）
      if (!this._pickChecked) { this._pickChecked = true; this._checkPick(); }
      this._countdown();
      if (this.state === 'wait' && g.time >= g.respawnAt) {
        this.state = 'ready';
        this._render();
        if (this._autoGo || (cfg.autoAfter > 0 && !this._autoAt)) this._autoAt = g.time + (this._autoGo ? 0 : cfg.autoAfter);
      }
      if (this.state === 'ready' && this._autoAt && g.time >= this._autoAt && !this.picking) { this._autoAt = 0; this.confirm(); }
      // 候補を確かめる（敵が動くので rescanSec 秒ごとにやり直す）
      if (!this._job && this.state !== 'loading' && g.time - (this._passDone || 0) >= cfg.rescanSec) this._restartPass();
      this._step(cfg.searchMsPerFrame);
      const lc = this._leadCand();
      this.target = lc ? (lc.ok ? lc.spot : lc) : null;
      // 先読み（街）: 選んでから leadDelay 秒たったら。チャンクが変わるときだけ動かす
      if (!this.arena && lc && (this.state === 'loading' || g.time - this._selT >= cfg.leadDelay)) {
        const c = g.city.chunkOf(lc.x, lc.z), key = c.cx + '_' + c.cz;
        if (key !== this._leadKey) { this._leadKey = key; this.lead = { x: lc.x, z: lc.z }; this.stats.leadMoves++; }
      }
      if (this.state === 'loading') this._updateLoading(dt);
    }

    _countdown() {
      const g = this.game, left = Math.max(0, g.respawnAt - g.time);
      const s = this.state === 'wait' ? Math.max(1, Math.ceil(left - 1e-6)) : 0;
      if (s === this._lastSec) return;
      this._lastSec = s;
      if (s) this.stats.countdown.push(s);
      if (this.el.sec) this.el.sec.textContent = s ? String(s) : '';
      if (this.el.go && this.el.go.classList) this.el.go.classList.toggle('wait', !!s);
    }

    // ---------- 復活 ----------
    confirm() {
      if (this.state !== 'ready' || this.picking) return false;
      this.state = 'loading';
      this._loadT = 0; this._loadedAt = null;
      this.navOps = this.cfg.loadOpsPerFrame;
      this.stats.confirmAt = this.game.time;
      this._render();
      return true;
    }

    _updateLoading(dt) {
      const g = this.game, cfg = this.cfg;
      this._loadT += dt;
      const lc = this._leadCand();
      if (!this.arena && lc) {
        const loaded = Spots.ringLoaded(g, lc.x, lc.z) && !g.world._navPending;
        if (!loaded && this._loadT < cfg.loadMaxSec) {
          if (this._loadT >= cfg.loadingNoteAfter) this._note('読み込み中…');
          return;
        }
        if (!this._loadedAt) {
          // 読めた（読めないまま loadMaxSec 秒なら、ここで全部すぐ読む: 1 回止まっても落ちるよりよい）。乗り物は次のフレームにある
          if (!loaded) { g._loadNavAt(lc.x, lc.z); this.stats.loadForced = (this.stats.loadForced || 0) + 1; }
          this._loadedAt = g.time;
          this._restartPass();
          return;
        }
      } else if (!this._loadedAt) { this._loadedAt = g.time; this._restartPass(); return; }
      if (this._job) return; // 最後の確かめの途中
      this._finish();
    }

    // 最後: 一番良い場所へ。無ければ決めてある順に代わりの場所（ゾーン → 近いゾーン、ランダム → 今まで通り、地図 → 選び直し）
    _finish() {
      const g = this.game, cfg = this.cfg;
      this._rank();
      const c = this.best;
      if (!c) {
        const id = this.selId;
        if (id === 'mapLast') {
          this.state = 'ready'; this._loadedAt = null; this.navOps = cfg.navOpsPerFrame;
          this._render();
          this.openPick();
          this._note('ここには出られません — 別の場所を選んでください');
          if (this.minimap && this.minimap._pickUi) this.minimap._pickUi('ここには出られません — 別の場所を選んでください');
          return;
        }
        // 選んだゾーン・近く・甲板に出られる所が無い: 一番近いほかのゾーン
        if (id !== 'random' && this._nextZone(false)) return;
        // ランダム（と最後の手段）: 今まで通りの場所（citygen が確かめた通り） / アリーナの開始地点
        this._respawn(null, null);
        return;
      }
      const sp = c.spot, th = Spots.threat(g, sp.x, sp.y, sp.z, cfg, c.th || {});
      const list = th.cls >= 1 ? this._threatList(sp) : [];
      // 一番ましな候補でも、片付けた後（maxCleared 体を消す・アリーナは maxMoved 体を動かす）に enemyClear m 以内の敵か見ている敵が残る
      //   （囲まれている・見張られている）: 地図で選んだ所でなければ敵の少ないほかのゾーンへ（「<選んだもの> は危険なので <ゾーン> から」。
      //   ほかと合わせて maxZoneFallbacks 回まで。それでもなら一番ましな所 + 片付け）。以前は近い敵の数だけを見ていて、16〜19 体のいる
      //   ゾーンで 2 体消した後も 40〜60 m 先の 2〜4 体に見られて出ていた（ほかのゾーンは空いていた）
      if (list.length > cfg.maxCleared + (cfg.maxMoved || 0) && this._nextZone(true)) return;
      // まだ近くに敵がいる・敵に見られている（見られていない所が無かった）: 近い敵 → 見ている敵 → 倒した敵の順に、アリーナは見えない所へ
      //   動かし（maxMoved 体まで。数は減らさない）、街は静かに消す（maxCleared 体まで。director が視野の外に出し直す）
      if (th.cls >= 1) this._clearAround(sp, th, list);
      this._respawn(sp, c);
    }
    // 代わりのゾーン（_finish から。ほかと合わせて maxZoneFallbacks 回まで。地図で選んだ所・アリーナは無し）: 試したゾーン・今の候補のゾーン・空母は除く。
    //   danger（囲まれていた）: ゾーンの中と周り enemyClear m の生きている敵の少ないもの → 近いもの。ほかは近いもの。見つかれば候補を入れ替えて true
    _nextZone(danger) {
      const g = this.game, cfg = this.cfg, id = this.selId;
      if (this.arena || id === 'mapLast' || this._fallback >= (cfg.maxZoneFallbacks | 0)) return false;
      const from = this._fromPoint(), cur = id.indexOf('zone:') === 0 ? id.slice(5) : null;
      const skip = this._triedZones || (this._triedZones = []);
      for (const c of this.cands) if (c.zone && skip.indexOf(c.zone) < 0) skip.push(c.zone);
      let bz = null, bd = Infinity, bn = Infinity;
      for (const h of g.city.hotZones || []) {
        if (h.id === cur || (cfg.deckZones || []).indexOf(h.id) >= 0 || skip.indexOf(h.id) >= 0) continue;
        let n = 0;
        if (danger) for (const e of g.enemies) if (!e.dead && !e.removed && Math.hypot(e.pos.x - h.x, e.pos.z - h.z) < h.r + cfg.enemyClear) n++;
        const d = Math.hypot(h.x - from.x, h.z - from.z);
        if (n < bn || (n === bn && d < bd)) { bn = n; bd = d; bz = h; }
      }
      if (!bz) return false;
      this._fallback++; this.stats.fallbacks++;
      if (danger) this.stats.dangerFallbacks = (this.stats.dangerFallbacks || 0) + 1;
      skip.push(bz.id);
      const o = this.selected, name = o && id !== 'random' ? o.label : '';
      this._setCands(Spots.zoneCandidates(g, bz.id, cfg, this.seed));
      this._note((name ? name + (danger ? ' は危険なので ' : ' には出られないので ') : (danger ? '危険なので ' : '')) + bz.label + ' から');
      this._loadT = 0; this._loadedAt = null; this._leadKey = null;
      return true;
    }
    _fromPoint() {
      const o = this.selected;
      if (o && o.id.indexOf('zone:') === 0) { const h = (this.game.city.hotZones || []).find((z) => z.id === o.id.slice(5)); if (h) return h; }
      return this.deathPos || this.game.player.pos;
    }
    // 復活する所 sp の enemyClear m の中の敵と、losRange m の中から見ている敵（片付ける順: 近い → 見ている → 倒した敵）
    _threatList(sp) {
      const g = this.game, cfg = this.cfg, killer = g._lastAttacker, nav = g.world.nav, list = [];
      for (const e of g.enemies) {
        if (e.dead || e.removed) continue;
        const d = Math.hypot(e.pos.x - sp.x, (e.pos.y || 0) - sp.y, e.pos.z - sp.z);
        if (d < cfg.enemyClear) { list.push({ e, k: d, why: 'near' }); continue; }
        if (d > cfg.losRange) continue;
        if (nav.lineOfSight(e.pos.x, (e.pos.y || 0) + 1.55, e.pos.z, sp.x, sp.y + 1.4, sp.z)) list.push({ e, k: (e === killer ? 2000 : 1000) + d, why: e === killer ? 'killer' : 'sees' });
      }
      list.sort((a, b) => a.k - b.k);
      return list;
    }
    _clearAround(sp, th, list) {
      const cfg = this.cfg, st = this.stats;
      list = list || this._threatList(sp);
      let moved = 0, cleared = 0;
      for (const it of list) {
        if (moved < (cfg.maxMoved || 0)) {
          const to = this._hideSpot(sp, it.e);
          if (to) {
            const e = it.e;
            e.pos.x = to.x; e.pos.z = to.z;
            if (e.path) e.path = [];
            e.pathIndex = 0; e.repathTimer = 0;
            if (typeof e._apply === 'function') e._apply();
            moved++; st.moved = (st.moved || 0) + 1; (st.movedWhy || (st.movedWhy = [])).push(it.why);
            continue;
          }
        }
        if (cleared >= cfg.maxCleared) continue;
        it.e.removed = true;
        cleared++; st.cleared++; st.clearedWhy.push(it.why);
      }
    }
    // アリーナ: 敵を動かす先 = 復活する所から見えない（losRange m より遠いか視線が通らない）・enemyClear m と敵の出る距離の外・ほかの敵と重ならない所。
    //   敵の出る地点（seed の順）→ 闘技場の中の seed の点（randomSamples 個）。無ければ null（消す）
    _hideSpot(sp, e) {
      const g = this.game, cfg = this.cfg, nav = g.world.nav, L = g.level || {};
      if (this.arena !== true || !nav.nearestFree) return null;
      const minD = Math.max(cfg.enemyClear, ((g.config && g.config.enemies) || {}).minSpawnDistance || 0), half = (L.size || 100) / 2 - 3;
      const pts = (L.spawnPoints || []).slice(), ord = shuffle(pts.length, mix(this.seed | 0, 0x2f1 + (this.stats.moved | 0)));
      const tries = ord.map((i) => pts[i]);
      const r = rand(mix(this.seed | 0, 0x4d9 + (this.stats.moved | 0)));
      for (let k = 0; k < (cfg.randomSamples || 0); k++) tries.push([-half + r() * 2 * half, -half + r() * 2 * half]);
      for (const p of tries) {
        const f = nav.nearestFree(p[0], p[1]);
        const d = Math.hypot(f.x - sp.x, f.z - sp.z);
        if (d < minD) continue;
        if (d <= cfg.losRange && nav.lineOfSight(f.x, 1.55, f.z, sp.x, sp.y + 1.4, sp.z)) continue;
        if (g.enemies.some((o) => o !== e && !o.dead && !o.removed && Math.hypot(o.pos.x - f.x, o.pos.z - f.z) < cfg.hideGap)) continue;
        return f;
      }
      return null;
    }
    _respawn(sp, c) {
      const g = this.game, inp = g.input;
      this.stats.respawns++;
      this.stats.lastKind = c ? c.kind : 'fallback';
      this.stats.lastSpot = sp ? { x: sp.x, y: sp.y, z: sp.z } : null;
      this.stats.lastCls = c && c.th ? c.th.cls : null;
      this.stats.loadSec = g.time - this.stats.confirmAt;
      this.stats.lastNote = this.el.note ? this.el.note.textContent : '';
      this.stats.lastYaw = sp ? Spots.spotYaw(g, c, sp, this.cfg) : null;
      g._respawnPlayer(sp ? { x: sp.x, y: sp.y, z: sp.z, yawDeg: this.stats.lastYaw } : undefined); // → close('respawned')
      // 押しっぱなしの移動キーは残し、1 回押しの入力だけ捨てる（input.reset はしない）
      inp._jump = false; inp._select = -1; inp._map = false; inp._interact = false; inp._pickup = false; inp._heal = false; inp._reload = false; inp._swap = false; inp._firePress = false;
      // 街: 立っている所の近景ができるまで（最長 fadeMaxSec 秒）暗くしておく
      if (!this.arena && this.el.fade && this.el.fade.classList) { this.el.fade.classList.remove('hidden'); this.el.fade.classList.add('show'); this._fade = { t: 0 }; }
    }

    // 生きている間（game.js の生きている枝）: 復活の直後の暗転を戻す
    tick(dt) {
      const f = this._fade;
      if (!f) return;
      f.t += dt;
      const g = this.game, S = g.world && g.world.streamer;
      let built = true;
      if (S && S.full && g.city) { const c = g.city.chunkOf(g.player.pos.x, g.player.pos.z), e = S.full.get(g.city.chunkKey(c.cx, c.cz)); built = !!(e && e.state === 'built'); }
      if ((built && f.t > 0.05) || f.t >= this.cfg.fadeMaxSec) { this._fade = null; if (this.el.fade && this.el.fade.classList) this.el.fade.classList.remove('show'); }
    }

    // ---------- 地図で選ぶ（街）----------
    openPick() {
      if (this.arena || (this.state !== 'wait' && this.state !== 'ready')) return false;
      const mm = this.minimap;
      if (!mm || typeof mm.openPick !== 'function') return false;
      // 支えの格子（地図のタップで使う）を作るのは最初の 1 回だけ（地図を開く所で）
      if (this.game.city && this.game.city.supportHeightAt) this.game.city.supportHeightAt(0, 0);
      this.picking = true;
      this._pickRes = null;
      const ok = mm.openPick({
        centre: this.deathPos, death: this.deathPos, ppm: this.cfg.pickPpm, cfg: this.cfg,
        onTap: (x, z, ppm) => this.pickAt(x, z, ppm),
        onCancel: () => this.cancelPick(true)
      });
      if (!ok) { this.picking = false; return false; }
      if (this.root && this.root.classList) this.root.classList.add('picking');
      return true;
    }
    // 地図をタップした所（minimap.js の _tapAt からとテスト）→ coarseSnap の結果
    pickAt(x, z, ppm) {
      const r = Spots.coarseSnap(this.game, x, z, ppm || this.cfg.pickPpm, this.cfg), st = this.stats;
      st.taps++; st.tapMs = r.ms; st.tapPts = r.pts; if (r.ms > st.tapMsMax) st.tapMsMax = r.ms;
      this._pickRes = r.ok ? r : null;
      return r;
    }
    confirmPick() {
      if (!this.picking || !this._pickRes) return false;
      const r = this._pickRes;
      this.pick = { x: r.x, y: r.y, z: r.z, kind: r.kind, face: r.face ? { x: r.face.x, z: r.face.z } : null };
      savePref('respawnCityPick', RespawnUI.pickString(this.pick));
      this._endPick(true);
      this.options = Spots.options(this.game, this.cfg, this.pick);
      this.selId = null;
      this.select('mapLast', true);
      if (this.state === 'ready') this.confirm(); else this._autoGo = true; // まだ数えている: 「復活」を押せるようになったらすぐ
      return true;
    }
    cancelPick(fromMap) {
      if (!this.picking) return false;
      this._endPick(false, fromMap);
      return true;
    }
    _endPick(done, fromMap) {
      this.picking = false;
      if (this.root && this.root.classList) this.root.classList.remove('picking');
      const mm = this.minimap;
      if (!fromMap && mm && mm.pick) { mm.pick.done = true; mm.closeFull(); }
      this._render();
    }
    // 覚えている地図の場所がまだ使えるか（使えなければ「地図の場所」の下に小さく「使えません」・選んでいたら既定に戻して覚え直す）。
    //   死亡画面（wait / ready）と、死亡画面のまま落ちた後の続きから（resumeSpot。state off: 候補・画面は作らない）
    _checkPick() {
      if (this.arena || !this.pick) return;
      const r = Spots.coarseSnap(this.game, this.pick.x, this.pick.z, this.cfg.pickPpm, this.cfg);
      const o = this.options.find((x) => x.id === 'mapLast');
      if (!o) return;
      const live = this.state === 'wait' || this.state === 'ready';
      if (r.ok) {
        // 同じ場所でも甲板の向く戦闘機は変わる（駐機場所にいない機体）。選んでいれば候補を作り直す
        const P = this.pick;
        P.x = r.x; P.y = r.y; P.z = r.z; P.kind = r.kind; P.face = r.face ? { x: r.face.x, z: r.face.z } : null;
        if (this.selId === 'mapLast' && live) this._build('mapLast');
        return;
      }
      o.off = true; o.sub = '使えません';
      if (this.selId === 'mapLast') {
        // 既定に戻したことを覚える（以前は画面だけ戻して localStorage は「地図の場所」のまま。死亡画面のまま落ちると、続きからは
        //   ヘリが飛んで行った 230 m の塔の上に出ていた）
        this.selId = this.defaultId;
        savePref(this.prefKey, this.selId);
        this.stats.pickOff = (this.stats.pickOff || 0) + 1;
        if (live) { this._build(this.selId); this._note('地図の場所は使えません — ' + this.selected.label + ' にしました'); }
      }
      if (live) this._render(true);
    }

    // ---------- 画面 ----------
    _note(t) { this._noteText = t; if (this.el.note && this.el.note.textContent !== t) this.el.note.textContent = t; }
    _render(force) {
      const sel = this.selId, kb = !(this.game.input && this.game.input.isTouchDevice);
      let h = '';
      this.options.forEach((o, i) => {
        const key = i < 9 ? String(i + 1) : (i === 9 ? '0' : '');
        h += '<button type="button" class="rp-opt' + (o.id === sel ? ' sel' : '') + (o.off ? ' off' : '') + (o.deck ? ' deck' : '') + (o.label.length >= 8 ? ' long' : '') + '" data-id="' + esc(o.id) + '">' +
          (kb && key ? '<span class="rp-key">' + key + '</span>' : '') + '<span class="rp-name">' + esc(o.label) + '</span>' + (o.sub ? '<span class="rp-sub">' + esc(o.sub) + '</span>' : '') + '</button>';
      });
      if (this.el.opts && (force || h !== this._html)) { this._html = h; this.el.opts.innerHTML = h; }
      const o = this.selected;
      if (this.el.sel) this.el.sel.textContent = o ? o.label : '';
      if (this.el.go && this.el.go.classList) { this.el.go.classList.toggle('busy', this.state === 'loading'); this.el.go.classList.toggle('wait', this.state === 'wait'); }
      if (this.el.panel && this.el.panel.classList) this.el.panel.classList.toggle('loading', this.state === 'loading');
    }

    // ---------- 続きから（session.js: 死亡画面のまま落ちた snap。game.start の中で 1 回）----------
    //   覚えている選択で、その場で場所を決める（ランダム・中央 = 今まで通りなので null）。死んだ所 = snap の位置。候補を並べた順に確かめ、
    //   当たり判定の読んでいない所はすぐ読む（game._loadNavAt。「近く」は先に死んだ所の周り）。読むのは resumeTries 回まで。
    //   決められなければ null（今まで通りの場所）。敵はまだいないので危なさは見ない
    resumeSpot(snap) {
      const g = this.game, cfg = this.cfg;
      const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
      if (!snap) return null;
      this.deathPos = { x: num(snap.x), y: num(snap.y), z: num(snap.z) };
      this.seed = mix(((g.opts && g.opts.spawnSeed) | 0) + 7, 0x51);
      this.options = Spots.options(g, cfg, this.pick);
      // 地図の場所がヘリポート・甲板（乗り物しだいの場所）なら死亡画面と同じ確かめ（_checkPick: ヘリが飛んで行った塔の上は使えない →
      //   既定に戻して覚え直す）。乗り物の状態は session.js が先に戻してある（game._cityVehState）。ほかの種類は下の validate で足りる
      //   （coarseSnap は支えの格子を作る = 落ちた直後の起動で 約 0.1 秒・11 MB）
      if (this.selId === 'mapLast' && this.pick && (this.pick.kind === 'pad' || this.pick.kind === 'deck')) this._checkPick();
      const id = this.selId;
      if (!id || id === this.defaultId || !this.options.some((o) => o.id === id && !o.off)) { this.stats.resumed = !id || id === this.defaultId ? 'default' : 'gone'; return null; }
      let loads = 0;
      const load = (x, z) => { if (this.arena || loads >= (cfg.resumeTries || 0)) return false; g._loadNavAt(x, z); loads++; return true; };
      if (id === 'near') load(this.deathPos.x, this.deathPos.z);
      this._build(id);
      this._job = null; this._note('');
      let spot = null;
      for (const c of this.cands) {
        if (!this.arena && !Spots.loadedAround(g, c.x, c.z, 2.4) && !load(c.x, c.z)) continue;
        const sp = { x: c.x, y: c.y, z: c.z };
        if (Spots.validate(g, c.x, c.y, c.z, cfg, sp) || (c.pick && Spots.fineSnap(g, c.x, c.y, c.z, cfg, sp))) { spot = { x: sp.x, y: sp.y, z: sp.z, yawDeg: Spots.spotYaw(g, c, sp, cfg) }; break; }
      }
      this.cands = []; this.best = null;
      this.stats.resumed = spot ? id : 'fallback';
      return spot;
    }

    // 生き返った・止めた: 画面を閉じる（state off・先読みを外す）
    close(reason) {
      if (this.picking) { this.state = 'off'; this._endPick(false); }
      this.state = 'off';
      this.lead = null; this.target = null; this._job = null; this._leadKey = null; this._autoGo = false; this._autoAt = 0;
      this.closedBy = reason || '';
      if (this.root && this.root.classList) { this.root.classList.remove('respawning'); this.root.classList.remove('picking'); }
      if (this.overlay && this.overlay.classList) this.overlay.classList.remove('choose');
      if (this.el.panel && this.el.panel.classList) this.el.panel.classList.add('hidden');
    }
    dispose() {
      this.close('stop');
      this._fade = null;
      if (this.el.fade && this.el.fade.classList) this.el.fade.classList.remove('show');
    }

    // キー（input.js に無いもの: 0・テンキー・Enter・矢印・Esc）。1 つの keydown から今のゲームへ
    _onKey(ev) {
      if (this.state === 'off' || !ev || ev.repeat) return;
      const c = ev.code || '';
      let used = true;
      if (c === 'Enter' || c === 'NumpadEnter') { if (this.picking) this.confirmPick(); else this.confirm(); }
      else if (c === 'Escape') { if (this.picking) this.cancelPick(); else used = false; }
      else if (c === 'Digit0' || c === 'Numpad0') this.selectIndex(9);
      else if (/^Numpad[1-9]$/.test(c)) this.selectIndex(+c.slice(6) - 1);
      else if (c === 'ArrowLeft' || c === 'ArrowUp') this._move(-1);
      else if (c === 'ArrowRight' || c === 'ArrowDown') this._move(1);
      else used = false;
      if (used && ev.preventDefault) ev.preventDefault();
    }

    // 画面のボタン・選択肢・キーを 1 回だけつなぐ（_bindSettings と同じ: タッチは pointerdown → 同じ指の pointerup で押したことにする。
    //   別の指が画面に触れている間はブラウザが click を出さないため。マウスは click、タッチの後の click は 0.7 秒捨てる）
    static bindStatic() {
      if (RespawnUI._bound || typeof document === 'undefined' || !document.getElementById) return;
      RespawnUI._bound = true;
      // 止めたゲームは dispose で state が off になる（「もう一度」の後の古い画面は反応しない）
      const cur = () => { const g = MR.Game && MR.Game._active; return g && g.respawnUI && g.respawnUI.state !== 'off' ? g.respawnUI : null; };
      const inside = (el, ev) => { const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null; return !r || (ev.clientX >= r.left - 4 && ev.clientX <= r.right + 4 && ev.clientY >= r.top - 4 && ev.clientY <= r.bottom + 4); };
      const on = (id, fn) => {
        const el = document.getElementById(id);
        if (!el || !el.addEventListener) return;
        let pid = null, lastT = 0;
        const fire = () => { const u = cur(); if (u) fn(u); };
        el.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') pid = ev.pointerId; });
        el.addEventListener('pointercancel', (ev) => { if (ev.pointerId === pid) pid = null; });
        el.addEventListener('pointerup', (ev) => {
          if (ev.pointerType === 'mouse' || ev.pointerId !== pid) return;
          pid = null;
          if (!inside(el, ev)) return;
          if (ev.preventDefault) ev.preventDefault();
          lastT = Date.now(); fire();
        });
        el.addEventListener('click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); if (Date.now() - lastT < 700) return; fire(); });
      };
      on('rp-go', (u) => u.confirm());
      on('rp-map', (u) => u.openPick());
      on('btn-fm-spawn', (u) => u.confirmPick());
      on('btn-fm-back', (u) => u.cancelPick());
      // 選択肢（作り直すので親で受ける）。指を 10 px 以上動かしたらスクロール、chipHoldMs（0.8 秒）より長く置いていたら休めている指（どちらも
      //   選ばない。画面に置いた親指を離したとたんに別の場所を選び、開いた地図を閉じていた）。置いていた長さはイベントの timeStamp で測る
      //   （ハンドラーが動いた時刻の差だと、ページが重くて pointerdown と pointerup の間に 0.8 秒止まったふつうのタップも捨てていた。
      //   ほかの指が画面にあると click も来ない。minimap.js の evTime と同じ）
      const opts = document.getElementById('rp-opts');
      if (opts && opts.addEventListener) {
        let pid = null, sx = 0, sy = 0, chip = null, lastT = 0, downT = 0;
        const evTime = (ev) => { const t = ev && ev.timeStamp, n = now(); return typeof t === 'number' && t > 0 && t <= n + 1000 && t > n - 60000 ? t : n; };
        const chipOf = (t) => (t && typeof t.closest === 'function' ? t.closest('.rp-opt') : null);
        const idOf = (c) => (c && typeof c.getAttribute === 'function' ? c.getAttribute('data-id') : null);
        opts.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'mouse') return; pid = ev.pointerId; sx = ev.clientX; sy = ev.clientY; chip = chipOf(ev.target); downT = evTime(ev); });
        opts.addEventListener('pointercancel', (ev) => { if (ev.pointerId === pid) { pid = null; chip = null; } });
        opts.addEventListener('pointerup', (ev) => {
          if (ev.pointerType === 'mouse' || ev.pointerId !== pid) return;
          pid = null;
          const c = chip; chip = null;
          const u = cur(), hold = (u && u.cfg && u.cfg.chipHoldMs) || 800;
          if (!c || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10 || evTime(ev) - downT > hold || !inside(c, ev)) return;
          if (ev.preventDefault) ev.preventDefault();
          lastT = Date.now();
          const id = idOf(c);
          if (u && id) u.select(id, true);
        });
        opts.addEventListener('click', (ev) => {
          if (Date.now() - lastT < 700) return;
          const c = chipOf(ev.target), u = cur(), id = idOf(c);
          if (!c) return;
          if (ev.preventDefault) ev.preventDefault();
          if (u && id) u.select(id, true);
        });
        // input.js は document の touchmove を止める（ページが動かないように）。選択肢の一覧は指でスクロールさせる
        opts.addEventListener('touchmove', (ev) => { ev.stopPropagation(); }, { passive: true });
      }
      if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', (ev) => { const u = cur(); if (u) u._onKey(ev); });
    }
  }
  MR.RespawnUI = RespawnUI;
})();
