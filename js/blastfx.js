// 派手な爆発と壁の当たり（destruct-3 M1。街だけ。数値は game.json の destruct.fx、タッチ端末は destruct.fx.mobile で上書き）。
//
// ■ MR.BlastFX（game.blastFx。game.js が街で crashes と一緒に作る）: 今ある見た目（MR.Crashes の火の玉・輪・光、MR.Puffs、MR.DestructDebris、
//   DestructDecals）の上に重ねるだけ。自分のメッシュは持たない（描画の数は増えない。画面の土ぼこりは DOM の #dust-overlay）。
//   blast(x, y, z, s, o)  … MR.Crashes.blast の後（crashes.onBlast = 全部の爆発・墜落・ミサイル・誘爆）。s = 火の玉の大きさ（spec.fx）。
//     o: { water, air, kind }（silent / shake は crashes の物 = ここの層は鳴らす）。中身: 芯の閃光 + ゆっくり膨らむ火の玉・地面を転がる土ぼこりの輪（風で流れて fx.dust.life 秒残る）・
//     残る煙の柱・火花（ember）・大きさの違う破片（dxChip / dxChunk / dxSlab。chunk と slab は止まるとがれきの欠片 = 残る）・揺れ（game.shake の
//     キック + game.rumble の低いゆれ）・画面の土ぼこり・音の層（blast_crack・blast_rumble・遅れて debris_rain_n）。
//   wall(x, y, z, nx, nz, s, kind) … 壁に当たった（destruct_view.js の穴・壁のえぐれ・銃の穴）: 法線の向きに粉の噴き出し・塊・
//     むき出しのれんが / 鉄筋の板（destruct.exposed）・crumble_n。
//   update(dt, cam) … 風（game.weather.p.windX / windZ、無ければ fx.wind）を puffs に・画面の土ぼこりを減らす。
//   重い層（土ぼこりの輪・柱・破片・音）は fx.minGap 秒に 1 回まで（誘爆の連続で板を使い切らない）。板の数は puffs の caps の中（いっぱいなら古い物を使い回す）。
//   stats { blasts, walls, dust, sparks, chunks, sounds, skipped, ms, msMax }
(function () {
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  MR.BlastFX = class BlastFX {
    constructor(game, cfg) {
      this.game = game;
      cfg = cfg || {};
      const mobile = !!(game.input && game.input.isTouchDevice);
      this.mobile = mobile;
      this.cfg = Object.assign({}, BlastFX.DEFAULTS, cfg, (mobile && cfg.mobile) || {});
      this.stats = { blasts: 0, walls: 0, dust: 0, sparks: 0, chunks: 0, sounds: 0, skipped: 0, ms: 0, msMax: 0, column: 0, burning: 0 };
      this._o = {};
      this._p = { x: 0, y: 0, z: 0 };
      this._lastHeavy = -1e9;
      this._lastWall = -1e9;
      this.dust = 0;          // 画面の土ぼこり 0..1
      this._dustShown = -1;
      this._windT = 0;
      this._el = null;
      this.emitters = []; this.burns = []; this._stage = [];
      this._flashK = 0; this._flashT = 0; this._flashDur = 0.2;
    }

    // game._render が描く間だけ露出に掛ける倍率（1 + これ）。短い山（u² で減る）
    flash() { return this._flashK > 0 ? this._flashK * (1 - this._flashT / this._flashDur) * (1 - this._flashT / this._flashDur) : 0; }

    _puffs() { const g = this.game; return g && typeof g._puffsObj === 'function' ? g._puffsObj() : null; }
    _t() { return (this.game && this.game.time) || 0; }
    _cam() {
      const g = this.game, c = g.camera;
      if (!c) return null;
      if (c.getWorldPosition) return c.getWorldPosition(this._camV || (this._camV = new THREE.Vector3()));
      return c.position;
    }

    static _opt(o, vx, vy, vz, grow, rise, drag, alpha, r, g, b, rot) {
      o.vx = vx; o.vy = vy; o.vz = vz; o.grow = grow; o.rise = rise; o.drag = drag; o.alpha = alpha;
      o.r = r; o.g = g; o.b = b; o.rot = rot; o.spin = (Math.random() - 0.5) * 0.5;
      o.frame0 = 0; o.fps = 0; o.loop = false; o.fadeIn = 0.06; o.fadeOut = null; o.fog = 1; o.wind = 0;
      return o;
    }

    // 地面までの高さ（下へ 1 本のレイ。読んでいないチャンクは city の支えの高さ）
    _ground(x, y, z, reach) {
      const g = this.game, nav = g.world && g.world.nav;
      if (nav && typeof nav.raycast === 'function') {
        const h = nav.raycast(x, y + 0.3, z, 0, -1, 0, reach + 0.3);
        if (h) return y + 0.3 - h.t;
      }
      const c = g.city;
      if (c && typeof c.supportHeightAt === 'function') { const sy = c.supportHeightAt(x, z); if (sy != null && y - sy <= reach) return sy; }
      return null;
    }

    blast(x, y, z, s, o) {
      const C = this.cfg;
      if (C.enabled === false) return;
      const t0 = now();
      s = s > 0 ? s : 3;
      const water = !!(o && o.water), air = !!(o && o.air);
      this.stats.blasts++;
      const P = this._puffs();
      const R = Math.random, op = this._o;
      const cam = this._cam();
      const d = cam ? Math.hypot(cam.x - x, cam.y - y, cam.z - z) : 1e9;
      const t = this._t();
      const heavy = t - this._lastHeavy >= (C.minGap > 0 ? C.minGap : 0.25);
      if (heavy) this._lastHeavy = t; else this.stats.skipped++;
      const gy = (water || air) ? null : this._ground(x, y, z, Math.max(2, s * 1.6));
      const onGround = gy != null;
      const FB = C.fireball || {}, ks = FB.scale > 0 ? FB.scale : 1; // 火の玉の大きさの倍率（ミサイル・GBU は s が大きい）
      if (P && !water) {
        // 白く熱い芯（加算の fire の板。2〜3 フレーム）
        const hc = FB.core || [3, 2.8, 2.4];
        BlastFX._opt(op, 0, 0, 0, s * ks * 6, 0, 0, 1, hc[0], hc[1], hc[2], R() * 6.28);
        op.fadeIn = 0.005; op.fadeOut = 0.04; op.fog = 0.5;
        P.spawn('fire', x, y + s * 0.3, z, s * ks * (FB.coreSize || 1.4), FB.coreSec || 0.1, op);
        // 芯の閃光（明るく短い）
        BlastFX._opt(op, 0, 0, 0, s * ks * 3.5, 0, 0, 1, 1.9, 1.55, 1.1, R() * 6.28);
        op.frame0 = 1; op.fadeIn = 0.01; op.fadeOut = 0.18;
        P.spawn('explosion', x, y + s * 0.2, z, s * ks * 1.6, 0.32, op);
        // ゆっくり膨らむ火の玉（上へ）
        const nb = C.billow | 0;
        for (let i = 0; i < nb; i++) {
          const a = R() * 6.283, rr = s * ks * (0.3 + R() * 0.5);
          BlastFX._opt(op, Math.cos(a) * s * 0.8, s * (0.7 + R() * 0.7), Math.sin(a) * s * 0.8, s * ks * 0.55, 0.6, 1.1, 0.95, 1.3, 1.0, 0.85, R() * 6.28);
          op.frame0 = 2 + R() * 6; op.fadeIn = 0.06;
          P.spawn('explosion', x + Math.cos(a) * rr, y + s * ks * (0.25 + R() * 0.5), z + Math.sin(a) * rr, s * ks * (1.3 + R() * 0.6), 1.9 + R() * 0.9, op);
        }
        // 熱と衝撃の輪（crashes の輪を大きく 1 つ足す。輪のメッシュは 1 つ = 描画は増えない）
        const CR = this.game.crashes;
        if (heavy && CR && typeof CR._addRing === 'function' && FB.ring > 0) CR._addRing(x, onGround ? gy : y, z, s * FB.ring);
        // 露出の閃光（ライトは増やさない。game._render が描く間だけ露出に掛ける）
        const FL = C.flash || {};
        if (FL.gain > 0 && cam) {
          const fr = (FL.range || 220) * Math.min(2, Math.max(0.5, s / 4));
          if (d < fr) {
            const f = 1 - d / fr, k = FL.gain * f * f * Math.min(1.5, s / 4);
            if (k > this._flashK) { this._flashK = Math.min(FL.max || 1.2, k); this._flashT = 0; this._flashDur = FL.sec || 0.22; }
          }
        }
        // 火花（ember。重力で落ちる）
        const ns = Math.min(C.sparks | 0, 6 + (s * (C.sparksPerFx || 4) | 0));
        for (let i = 0; i < ns; i++) {
          const a = R() * 6.283, up = 0.15 + R() * 0.85, sp = s * (3 + R() * 6);
          BlastFX._opt(op, Math.cos(a) * sp * (1 - up * 0.5), sp * up, Math.sin(a) * sp * (1 - up * 0.5), -0.04, -11, 0.6, 1, 1.7, 1.05, 0.45, 0);
          P.spawn('ember', x, y + 0.3, z, 0.18 + R() * 0.3, 0.6 + R() * 1.1, op);
        }
        this.stats.sparks += ns;
        // 重い層は次のフレームから 1 つずつ（destruct-3 M4: 爆発のフレームを短く。端末で 50 ms を超えていた）
        if (heavy) this._stage.push({ x, y, z, gy, s, d, onGround, air, k: 0 });
      }
      // 破片は _stageStep（次のフレームから）
      // 揺れ: 近いほど強いキックと、低いゆれ（game.rumble。game.js が少しずつ減らす）
      const SH = C.shake || {};
      const sr = (SH.range || 140) * Math.min(2, Math.max(0.6, s / 4));
      if (d < sr) { // o.shake / o.silent は crashes の explosion_large と揺れのこと（explode が持つ）。ここの層はいつも
        const f = 1 - d / sr;
        this.game.shake = Math.min(SH.max || 2, (this.game.shake || 0) + f * (SH.kick || 0.5) * Math.min(2, s / 3));
        this.game.rumble = Math.min(SH.rumbleMax || 1.5, (this.game.rumble || 0) + f * (SH.rumble || 0.6) * Math.min(2, s / 3));
      }
      // 画面の土ぼこり（地面の近い爆発）
      const SD = C.screenDust || {};
      if (!water && onGround && d < (SD.range || 30)) this.addDust((1 - d / (SD.range || 30)) * (SD.gain || 0.7) * Math.min(1.5, s / 3));
      // 音の層（explosion_large / explosion_far は explode / crashes が鳴らす）
      if (heavy && !water) this._sounds(x, y, z, s, d, onGround);
      const ms = now() - t0;
      this.stats.ms = ms; if (ms > this.stats.msMax) this.stats.msMax = ms;
    }

    // 地面を転がる土ぼこりの輪: 外へ広がって止まり、風で流れて長く残る
    _dustRing(P, x, gy, z, s, d) {
      const C = this.cfg, DU = C.dust || {}, R = Math.random, op = this._o;
      const n = Math.max(4, Math.round((DU.n || 12) * Math.min(1.6, s / 4)));
      const col = DU.color || [0.42, 0.38, 0.33];
      const life = DU.life || [12, 22];
      for (let i = 0; i < n; i++) {
        const a = (i + R() * 0.6) / n * 6.283, sp = s * (DU.speed || 3.5) * (0.7 + R() * 0.6);
        const j = 0.85 + R() * 0.3;
        // 板は地面に刺さると縁がまっすぐに切れて見える（柔らかい粒子なし）: 半分の大きさだけ上に置き、育つ分だけ上がる（rise）
        const sz = s * (1.1 + R() * 0.5), gr = s * (DU.grow || 0.35), dr = DU.drag || 0.9; // 上がる速さの終わり = rise / drag = 育つ速さの半分（下の縁が同じ高さ）
        BlastFX._opt(op, Math.cos(a) * sp, 0.3 + R() * 0.6, Math.sin(a) * sp, gr, gr * dr * 0.5, dr, DU.alpha || 0.55, col[0] * j, col[1] * j, col[2] * j, R() * 6.28);
        op.fadeIn = 0.25; op.wind = DU.wind == null ? 1 : DU.wind; op.fadeOut = 4;
        P.spawn('smoke', x + Math.cos(a) * s * 0.4, gy + sz * 0.42, z + Math.sin(a) * s * 0.4, sz, life[0] + R() * (life[1] - life[0]), op);
      }
      this.stats.dust += n;
    }

    // 爆発の重い層: 1 フレーム目 = 土ぼこりの輪と霞、2 = 柱・立ちのぼる煙・燃える破片、3 = 破片（大きさ 3 つ。地面・屋上の爆発だけ）
    _stageStep() {
      const J = this._stage[0];
      if (!J) return;
      const P = this.game.puffs, C = this.cfg;
      if (J.k === 0) { if (P && J.onGround) { this._dustRing(P, J.x, J.gy, J.z, J.s, J.d); this._haze(P, J.x, J.gy, J.z, J.s); } }
      else if (J.k === 1) {
        if (P && !J.air) this._column(P, J.x, J.onGround ? J.gy : J.y, J.z, J.s);
        if (J.onGround) { this._emitter(J.x, J.gy, J.z, J.s); this._burning(J.x, J.gy, J.z, J.s); }
      } else {
        const DX = this.game.destruct;
        if (J.onGround && DX && DX.debris) {
          const k = Math.min(1.6, J.s / 4), DB = C.debris || {};
          const add = (kit, n, up) => { n = Math.round(n * k); if (n <= 0) return; DX._burst(kit, J.x, J.gy + 0.4, J.z, n, 0, up, 0); this.stats.chunks += n; };
          add('dxChip', DB.chip | 0, 3); add('dxChunk', DB.chunk | 0, 3); add('dxSlab', DB.slab | 0, 2);
        }
        this._stage.shift();
        return;
      }
      J.k++;
    }
    // 待っている重い層を全部（テスト）
    flushStages() { while (this._stage.length) this._stageStep(); }

    // 低く薄い霞（大きな板。fx.haze.life 秒、風で流れる = 煙が晴れた後も通りがかすむ）
    _haze(P, x, gy, z, s) {
      const HZ = this.cfg.haze || {}, R = Math.random, op = this._o;
      const n = HZ.n | 0, life = HZ.life || [20, 30], col = HZ.color || [0.46, 0.43, 0.39];
      for (let i = 0; i < n; i++) {
        const a = R() * 6.283, rr = s * (1 + R() * 2.5), sz = s * (HZ.size || 3.2) * (0.8 + R() * 0.4);
        BlastFX._opt(op, Math.cos(a) * 1.2, 0.15, Math.sin(a) * 1.2, s * 0.12, 0.05, 0.4, HZ.alpha || 0.28, col[0], col[1], col[2], R() * 6.28);
        op.fadeIn = 1.5; op.wind = 1; op.fadeOut = 6; op.fog = 0.8;
        P.spawn('smoke', x + Math.cos(a) * rr, gy + sz * 0.38, z + Math.sin(a) * rr, sz, life[0] + R() * (life[1] - life[0]), op);
      }
      this.stats.dust += n;
    }

    // 立ちのぼる黒い煙（えぐれから fx.column.sec 秒、every 秒ごとに 1 枚。数は fx.column.max まで、いっぱいなら一番古い物を止める）
    _emitter(x, gy, z, s) {
      const CO = this.cfg.column || {};
      if (!(CO.sec > 0)) return;
      const E = this.emitters, max = CO.max || 3;
      if (E.length >= max) E.shift();
      E.push({ x, y: gy, z, s, t: 0, next: 0.6, sec: CO.sec * (0.85 + Math.random() * 0.3) });
    }
    _emit(dt, P) {
      const CO = this.cfg.column || {}, E = this.emitters, R = Math.random, op = this._o, every = CO.every || 0.9;
      for (let i = E.length - 1; i >= 0; i--) {
        const e = E[i];
        e.t += dt;
        if (e.t >= e.sec) { E.splice(i, 1); continue; }
        if (e.t < e.next) continue;
        e.next = e.t + every * (0.8 + R() * 0.4);
        const u = e.t / e.sec, a = (CO.alpha || 0.6) * (1 - u * u * 0.6), g = (CO.grey || 0.22) + R() * 0.08, sz = e.s * (1.2 + u * 1.2) * (0.8 + R() * 0.4);
        BlastFX._opt(op, (R() - 0.5) * 0.6, 1.2 + R() * 1.0, (R() - 0.5) * 0.6, e.s * 0.4, 0.15, 0.3, a, g, g * 0.95, g * 0.9, R() * 6.28);
        op.fadeIn = 0.8; op.wind = 1; op.fadeOut = 4; op.fog = 0.5;
        P.spawn('smoke', e.x + (R() - 0.5) * e.s * 0.5, e.y + e.s * 0.4, e.z + (R() - 0.5) * e.s * 0.5, sz, (CO.puffLife || [10, 16])[0] + R() * 6, op);
        this.stats.column++;
      }
    }

    // 燃えながら飛ぶ破片（自分で放物線を進め、炎と煙の尾を puffs に。落ちたら少し燃える）
    _burning(x, gy, z, s) {
      const BU = this.cfg.burning || {}, n = BU.n | 0, R = Math.random, B = this.burns;
      for (let i = 0; i < n; i++) {
        if (B.length >= (BU.max || 8)) B.shift();
        const a = R() * 6.283, sp = (BU.speed || [6, 14])[0] + R() * ((BU.speed || [6, 14])[1] - (BU.speed || [6, 14])[0]);
        B.push({ x, y: gy + 0.6, z, vx: Math.cos(a) * sp, vy: (BU.up || 9) * (0.7 + R() * 0.6), vz: Math.sin(a) * sp, gy, t: 0, landed: -1, f: 0, m: 0, s: Math.min(1.5, s / 4) });
      }
      this.stats.burning += n;
    }
    _burn(dt, P) {
      const BU = this.cfg.burning || {}, B = this.burns, R = Math.random, op = this._o, ground = BU.groundSec || 4;
      for (let i = B.length - 1; i >= 0; i--) {
        const b = B[i];
        b.t += dt;
        if (b.landed < 0) {
          b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          if (b.y <= b.gy + 0.1 && b.vy < 0) { b.y = b.gy + 0.1; b.landed = b.t; }
        } else if (b.t - b.landed > ground) { B.splice(i, 1); continue; }
        const k = b.landed < 0 ? 1 : 1 - (b.t - b.landed) / ground;
        b.f -= dt; b.m -= dt;
        if (b.f <= 0) {
          b.f = BU.fireEvery || 0.05;
          BlastFX._opt(op, 0, 0.6, 0, -0.3, 0.3, 1, 1, 1.4, 0.9, 0.5, R() * 6.28);
          op.fadeIn = 0.02;
          P.spawn('fire', b.x, b.y, b.z, (0.35 + R() * 0.25) * b.s * (0.5 + 0.5 * k), 0.35 + R() * 0.2, op);
        }
        if (b.m <= 0) {
          b.m = BU.smokeEvery || 0.12;
          const g = 0.1 + R() * 0.06;
          BlastFX._opt(op, 0, 0.8, 0, 0.5, 0.4, 0.6, 0.55 * (0.4 + 0.6 * k), g, g, g, R() * 6.28);
          op.fadeIn = 0.1; op.wind = 1;
          P.spawn('smoke', b.x, b.y + 0.2, b.z, 0.6 * b.s, 1.2 + R() * 0.6, op);
        }
      }
    }

    // 残る煙の柱（暗い灰色。上がって風で流れる）
    _column(P, x, y, z, s) {
      const C = this.cfg, CO = C.column || {}, R = Math.random, op = this._o;
      const n = CO.n || 3, life = CO.life || [14, 24];
      for (let i = 0; i < n; i++) {
        const g = 0.12 + R() * 0.08;
        BlastFX._opt(op, (R() - 0.5) * 0.8, 1.5 + R() * 1.2, (R() - 0.5) * 0.8, s * 0.45, 0.25, 0.35, CO.alpha || 0.6, g, g * 0.95, g * 0.9, R() * 6.28);
        op.fadeIn = 0.8; op.wind = 1; op.fadeOut = 5; op.fog = 0.6;
        P.spawn('smoke', x + (R() - 0.5) * s * 0.6, y + s * 0.6 + i * s * 0.5, z + (R() - 0.5) * s * 0.6, s * 1.6, life[0] + R() * (life[1] - life[0]), op);
      }
    }

    _play(name, p, opts) {
      const a = this.game.audio;
      if (!a || typeof a.play !== 'function') return;
      if (typeof a.prepare === 'function' && !this._prepared) { this._prepared = true; try { a.prepare('destruct'); } catch (e) { /* 無ければ鳴らないだけ */ } }
      this.stats.sounds++;
      const P = this._p; P.x = p.x; P.y = p.y; P.z = p.z;
      a.play(name, Object.assign({ pos: P }, opts));
    }

    _sounds(x, y, z, s, d, onGround) {
      const S = this.cfg.sound || {}, R = Math.random, p = { x, y, z };
      const k = Math.min(1, s / 4);
      if (d < (S.crackRange || 250)) this._play('blast_crack', p, { refDistance: 20, maxDistance: S.crackRange || 250, volume: 0.6 + 0.4 * k, rate: 0.9 + R() * 0.2, priority: 3 });
      this._play('blast_rumble', p, { refDistance: 40, maxDistance: S.rumbleRange || 1200, volume: 0.5 + 0.5 * k, rate: 0.85 + R() * 0.25, priority: 2, delay: Math.min(1.2, d / 343) });
      if (onGround && d < (S.debrisRange || 160)) {
        const v = 1 + Math.floor(R() * 3);
        this._play('debris_rain_' + v, p, { refDistance: 10, maxDistance: S.debrisRange || 160, volume: 0.5 + 0.5 * k, rate: 0.9 + R() * 0.2, priority: 1, delay: 0.35 + R() * 0.5 + d / 343 });
      }
    }

    // 壁の当たり: 粉の噴き出し・塊・むき出しのれんがの板・崩れる音
    // 外壁の地の色（塊・欠片を外壁の色で。MR.Facade.facadeAt があればそれ、無ければ材質の placeholder）
    _wallColor(x, y, z, mat) {
      const F = MR.Facade;
      if (F && typeof F.facadeAt === 'function') {
        try { const f = F.facadeAt(x, y, z); const c = f && (f.color || f.albedo || f.tint); if (typeof c === 'string') return c; } catch (e) { /* 無ければ材質 */ }
      }
      const D = MR.Materials && MR.Materials.DEFS, m = mat && D && D[mat];
      return (m && m.placeholder) || null;
    }

    wall(x, y, z, nx, nz, s, kind, mat) {
      const C = this.cfg;
      if (C.enabled === false) return;
      const W = C.wall || {}, R = Math.random, op = this._o;
      s = s > 0 ? s : 1.5;
      this.stats.walls++;
      const t = this._t();
      const P = this._puffs();
      if (P) {
        const n = Math.max(2, Math.round((W.puffs || 6) * Math.min(1.5, s / 2)));
        for (let i = 0; i < n; i++) {
          const sp = (W.speed || 6) * (0.6 + R() * 0.8);
          const g = 0.5 + R() * 0.12;
          BlastFX._opt(op, nx * sp + (R() - 0.5) * 2, 0.4 + R() * 1.2, nz * sp + (R() - 0.5) * 2, s * 0.6, 0.15, 1.4, W.alpha || 0.6, g, g * 0.94, g * 0.86, R() * 6.28);
          op.fadeIn = 0.05; op.wind = 1; op.fadeOut = 2.5;
          P.spawn('smoke', x + nx * 0.4, y + (R() - 0.3) * s * 0.6, z + nz * 0.4, s * (0.7 + R() * 0.5), (W.life || 6) * (0.7 + R() * 0.6), op);
        }
        this.stats.dust += n;
      }
      const DX = this.game.destruct;
      if (DX && DX.debris) {
        const k = Math.min(1.5, s / 2), sp = W.push || 5, col = kind === 'gun' ? null : this._wallColor(x, y, z, mat);
        DX._burst('dxChunk', x + nx * 0.3, y, z + nz * 0.3, Math.round((W.chunks || 4) * k), nx * sp, 2, nz * sp, col);
        DX._burst('dxChip', x + nx * 0.3, y, z + nz * 0.3, Math.round((W.chips || 6) * k), nx * sp * 1.4, 2.5, nz * sp * 1.4, col);
        if (kind === 'breach' && W.slabs > 0) DX._burst('dxSlab', x + nx * 0.3, y + 0.6, z + nz * 0.3, Math.round(W.slabs * k), nx * sp * 0.8, 2, nz * sp * 0.8, col);
        if (DX.exposed && kind !== 'gun' && kind !== 'breach' && kind !== 'collapse') DX.exposed.add(this._v3(x, y, z), { x: nx, y: 0, z: nz }, (W.exposed || 1.4) * s * (0.8 + R() * 0.4));
      }
      if (t - this._lastWall > 0.15) {
        this._lastWall = t;
        this._play('crumble_' + (1 + Math.floor(R() * 2)), { x, y, z }, { refDistance: 8, maxDistance: 160, volume: Math.min(1, 0.5 + s * 0.2), rate: 0.9 + R() * 0.2, priority: 1 });
      }
      const cam = this._cam();
      if (cam) { const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z), SD = C.screenDust || {}; if (d < (SD.wallRange || 6)) this.addDust((1 - d / (SD.wallRange || 6)) * (SD.wallGain || 0.35)); }
    }
    _v3(x, y, z) { const v = this._vv || (this._vv = { x: 0, y: 0, z: 0 }); v.x = x; v.y = y; v.z = z; return v; }

    addDust(k) { if (k > 0) this.dust = Math.min(1, this.dust + k); }

    update(dt) {
      const C = this.cfg;
      this._windT -= dt;
      if (this._windT <= 0) {
        this._windT = 0.5;
        const P = this.game.puffs; // 作らない（板は最初の爆発で作る = 場面 32 の P4）
        if (P && typeof P.setWind === 'function') {
          const w = this.game.weather && this.game.weather.p;
          if (w && isFinite(w.windX) && isFinite(w.windZ)) P.setWind(w.windX * (C.windScale || 0.5), w.windZ * (C.windScale || 0.5));
          else { const W = C.wind || [0.8, 0.3]; P.setWind(W[0], W[1]); }
        }
      }
      if (this._flashK > 0) { this._flashT += dt; if (this._flashT >= this._flashDur) this._flashK = 0; }
      if (this._stage.length) { if (this._stage.length > 6) this._stage.splice(0, this._stage.length - 6); this._stageStep(); }
      if (this.emitters.length || this.burns.length) {
        const P = this.game.puffs;
        if (P) { if (this.emitters.length) this._emit(dt, P); if (this.burns.length) this._burn(dt, P); }
      }
      if (this.dust > 0) this.dust = Math.max(0, this.dust - dt / ((C.screenDust && C.screenDust.fade) || 2.5));
      this._showDust();
    }

    _showDust() {
      const v = Math.round(this.dust * 50) / 50;
      if (v === this._dustShown) return;
      this._dustShown = v;
      if (typeof document === 'undefined') return;
      const el = this._el || (this._el = document.getElementById('dust-overlay'));
      if (!el || !el.style) return;
      el.style.opacity = String(Math.min(1, v * ((this.cfg.screenDust && this.cfg.screenDust.max) || 0.85)));
      el.style.display = v > 0 ? 'block' : 'none';
    }

    dispose() {
      this.emitters.length = 0; this.burns.length = 0; this._stage.length = 0; this._flashK = 0;
      this.dust = 0; this._showDust();
      const P = this.game.puffs;
      if (P && typeof P.setWind === 'function') P.setWind(0, 0);
      this._el = null;
    }
  };

  MR.BlastFX.DEFAULTS = {
    enabled: true, minGap: 0.25, billow: 6, sparks: 80, sparksPerFx: 8,
    dust: { n: 24, speed: 3.5, grow: 0.35, drag: 0.9, alpha: 0.55, life: [12, 22], color: [0.42, 0.38, 0.33], wind: 1 },
    column: { n: 3, life: [14, 24], alpha: 0.7, sec: 32, every: 0.8, max: 3, puffLife: [10, 16] },
    fireball: { scale: 4, core: [3, 2.8, 2.4], coreSize: 1.4, coreSec: 0.12, ring: 1.5 },
    flash: { gain: 0.9, range: 220, sec: 0.22, max: 1.2 },
    haze: { n: 12, life: [26, 36], alpha: 0.3, size: 3.2, color: [0.46, 0.43, 0.39] },
    burning: { n: 4, max: 8, speed: [6, 14], up: 9, groundSec: 4, fireEvery: 0.05, smokeEvery: 0.14 },
    debris: { chip: 24, chunk: 16, slab: 6 },
    shake: { range: 140, kick: 0.5, rumble: 0.6, rumbleMax: 1.5, max: 2 },
    screenDust: { range: 30, gain: 0.7, wallRange: 6, wallGain: 0.35, fade: 2.5, max: 0.85 },
    wall: { puffs: 12, speed: 6, alpha: 0.6, life: 6, chunks: 8, chips: 12, slabs: 4, push: 5, exposed: 1.4 },
    sound: { crackRange: 250, rumbleRange: 1200, debrisRange: 160 },
    wind: [0.8, 0.3], windScale: 0.5
  };
})();
