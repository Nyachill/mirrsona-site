// Sky High のエレベーターの見た目と案内（MR.LiftView。lift.js の MR.Lift が作る。b15 = TestFlight ビルド 14 のオーナーの「スカイハイにエレベーターがない」）。
//   以前は駅（city.lifts）の 1.6 m の見えない点に立つまで何も無く、ロビー（L0）は天井の無い茶色の箱だった（skyhigh.glb の低層部の上の箱は
//   下の面を持たず、代わりの箱は GLB が読めると消えるので、ロビーから空が見えた）。ここで作るもの（ファイルは要らない = コードだけ・
//   GLB の有無に関係なく同じ）:
//   ■ 駅ごと（L0 ロビー / L1 デッキ / L2 スカイフロア）: ヘアラインの金属の両開きの扉・枠（光る縁）・呼びボタン・扉の上の案内板
//     「エレベーター」+ 階の名前（lift.labels）・床の案内の矢印（案内が出ている間だけ、扉へ向かって流れるように光る）
//   ■ 扉のあるランドマークのロビー（params.lobby。L0）: 天井（升目の板）と天井の照明・床の明かりの輪・壁の明るい板張り、
//     入口（params.doors）のひさしと看板「MIRRSONA SKY HIGH」（エレベーターのあるロビーは「エレベーター ↑」、無いロビーは「← エレベーターは西のロビー」）
//   ■ 画面の案内（#lift-guide）: 扉の近く（guide.dist m。ロビーの中の駅はそのロビーの中にいるときだけ）で、扉の前（ボタンが「エレベーター」）に着くまで
//     「エレベーター 12 m」と扉の向きの矢印。もう 1 つのロビーでは「エレベーターは西のロビー」
//   ■ 室内（inside）: カメラが扉のあるランドマークのロビーの中 → look.js の室内の度合い k（半球光の色・色調の明るさ。雨でも暗くない）
//   描画: 駅ごとに 2 つのメッシュ（金属 = MeshStandardMaterial・光るもの = 足し算の ShaderMaterial。どちらも 1 枚の Canvas の
//     アトラス 512 × 256 を共有）。カメラが createDist m に近づいたら作り、disposeDist m 離れたら捨てる（GPU 0.7 MB。戦闘機・ヘリで
//     遠くにいる間は持たない）。b16: 作るのは 1 フレーム buildMs ms ずつ（_buildGen の 1 歩 = 駅の扉 / 柱 / ロビー / 形 1 つ。以前は一度に作って
//     Chromium で最初 60 ms・作り直し 8〜21 ms のフレーム）、材質とアトラスは捨てない（dispose まで。以前は 600 m 離れるたびに捨て、戻るたびに
//     プログラム 2 つを作り直した）。離れて捨てるのは形だけ。扉の組（枠・案内板・呼びボタン）は駅ごとに壁までの広さ（wallClear m の余裕）に収まるよう
//     横へずらす（L0 は北の壁の内側から 1.1 m: 2.72 m の組の右の柱・光る縁・案内板の端・呼びボタンが壁に埋まっていた）。金属・天井・壁は別の小さいテクスチャ 256 × 64（看板の文字がミップマップで混ざらない）。駅の組はカメラから viewDist m より遠いと隠す。影は落とさない・受けない。ロビーの中の面（L0 の扉・柱・天井・板張り）は
//     太陽の直射を受けない（頂点の aSun = 0。影を受けないので、夕日が建物を抜けて西を向く壁が白く飛んでいた）。当たり判定には入れない（見た目だけ）。
//   数値は game.json の lift.view / lift.guide（無いキーは下の DEFAULTS）。
window.MR = window.MR || {};

(function () {
  const DEFAULTS = {
    enabled: true, createDist: 350, disposeDist: 600, viewDist: 220, buildMs: 2, wallClear: 0.08, doorBack: 0.8, doorW: 2.4, doorH: 3.3, frame: 0.16, signH: 0.75, signGap: 0.12,
    glow: 1, panelGain: 1.3, panelSize: 1.4, panelEvery: 6, poolGain: 0.06, poolRadius: 3.2, ceilingDrop: 0.06, cladding: true,
    canopy: { halfW: 3.5, depth: 3.5, y0: 5.0, y1: 5.5, inset: 0.02, signH: 0.75, signThick: 0.15, soffit: 0.17, rim: 0.08, downlight: 0.42 }, metalness: 0.55, roughness: 0.38, emissive: 0.35,
    texts: { title: 'MIRRSONA SKY HIGH', lift: 'エレベーター', here: 'この奥', other: 'エレベーターは西のロビー' }
  };
  const GUIDE = { dist: 15, markerFrom: 1.3, markerStep: 1.0, markers: 3, pulse: 5 };
  const AW = 512, AH = 256; // 光るもののアトラス（看板・案内板・明かりの輪・床の矢印・白）
  const SW = 256, SH = 64;   // 面のテクスチャ（金属・天井・壁・黒）。看板の文字と別にする: 同じ 1 枚だと斜めに見たときのミップマップで
  //                            水色の文字が金属に混ざり、ひさしの下・柱の板張りが水色に光った
  // 場所（Canvas の px: x0, y0, x1, y1）
  const SLOT = {
    canopyLift: [0, 0, 512, 64], canopyOther: [0, 64, 512, 128],
    sign0: [0, 128, 256, 192], sign1: [256, 128, 512, 192], sign2: [0, 192, 256, 256],
    pool: [256, 192, 320, 256], chevron: [320, 192, 384, 256], white: [384, 192, 448, 256]
  };
  const SURF = { metal: [0, 0, 64, 64], tile: [64, 0, 128, 64], panel: [128, 0, 192, 64], dark: [192, 0, 256, 64] };
  const FONT = '"Hiragino Sans", "Noto Sans JP", sans-serif';

  // Canvas の px の矩形 → uv（flipY = 少し内側）
  function uvOf(r, W, H) {
    const e = 1.5, w = W || AW, h = H || AH;
    return [(r[0] + e) / w, 1 - (r[3] - e) / h, (r[2] - e) / w, 1 - (r[1] + e) / h];
  }
  const uvS = (r) => uvOf(r, SW, SH);
  function lin(hex, k) { const c = MR.srgb(hex); return [c.r * (k == null ? 1 : k), c.g * (k == null ? 1 : k), c.b * (k == null ? 1 : k)]; }

  // 形を書く（世界の座標で。金属は color + aSun、光るものは aCol + aPulse）。sun = 今から書く面が太陽の直射を受けるか（1）・
  //   受けないか（0 = 建物の中: ロビーの扉・柱・天井・壁の板張り）
  class Geo {
    constructor(glow) { this.glow = glow; this.p = []; this.n = []; this.uv = []; this.c = []; this.k = []; this.s = []; this.i = []; this.sun = 1; }
    get count() { return this.p.length / 3; }
    // o = 角、u / v = 辺のベクトル、n = 表の向き、r = uv の矩形 [u0, v0, u1, v1]、col = 色（リニア）、k = 流れる番号（0 = 流れない）
    quad(o, u, v, n, r, col, k) {
      const b = this.count;
      const P = [o, [o[0] + u[0], o[1] + u[1], o[2] + u[2]], [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]], [o[0] + v[0], o[1] + v[1], o[2] + v[2]]];
      const T = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
      for (let j = 0; j < 4; j++) {
        this.p.push(P[j][0], P[j][1], P[j][2]); this.n.push(n[0], n[1], n[2]); this.uv.push(T[j][0], T[j][1]);
        this.c.push(col[0], col[1], col[2]); this.k.push(k || 0); this.s.push(this.sun);
      }
      const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0];
      if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
      else this.i.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    geometry() {
      if (!this.i.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      if (this.glow) {
        g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.c, 3));
        g.setAttribute('aPulse', new THREE.Float32BufferAttribute(this.k, 1));
      } else {
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
        g.setAttribute('aSun', new THREE.Float32BufferAttribute(this.s, 1));
      }
      g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return g;
    }
  }

  // 扉の向き（yaw 度。0 = +Z）の座標の組: n = 扉の表の向き、r = 扉を見ている人の右、W(u, v, w) = 原点 + r·u + 上·v + n·w
  function frameOf(x, y, z, yawDeg) {
    const a = yawDeg * Math.PI / 180, n = [Math.sin(a), 0, Math.cos(a)], r = [Math.cos(a), 0, -Math.sin(a)];
    const W = (u, v, w) => [x + r[0] * u + n[0] * w, y + v, z + r[2] * u + n[2] * w];
    const vec = (u, v, w) => [r[0] * u + n[0] * w, v, r[2] * u + n[2] * w];
    return { n, r, W, vec, up: [0, 1, 0] };
  }
  // 扉の座標の箱（u0..u1 × v0..v1 × w0..w1）。skip: 'u-' 'u+' 'v-' 'v+' 'w-' 'w+'
  function fbox(G, F, u0, u1, v0, v1, w0, w1, r, col, skip) {
    const S = skip || '', du = u1 - u0, dv = v1 - v0, dw = w1 - w0, neg = (a) => [-a[0], -a[1], -a[2]];
    if (S.indexOf('w+') < 0) G.quad(F.W(u0, v0, w1), F.vec(du, 0, 0), F.vec(0, dv, 0), F.n, r, col);
    if (S.indexOf('w-') < 0) G.quad(F.W(u1, v0, w0), F.vec(-du, 0, 0), F.vec(0, dv, 0), neg(F.n), r, col);
    if (S.indexOf('u+') < 0) G.quad(F.W(u1, v0, w1), F.vec(0, 0, -dw), F.vec(0, dv, 0), F.r, r, col);
    if (S.indexOf('u-') < 0) G.quad(F.W(u0, v0, w0), F.vec(0, 0, dw), F.vec(0, dv, 0), neg(F.r), r, col);
    if (S.indexOf('v+') < 0) G.quad(F.W(u0, v1, w1), F.vec(du, 0, 0), F.vec(0, 0, -dw), F.up, r, col);
    if (S.indexOf('v-') < 0) G.quad(F.W(u0, v0, w0), F.vec(du, 0, 0), F.vec(0, 0, dw), [0, -1, 0], r, col);
  }

  class LiftView {
    constructor(game, lift, cfg, guide) {
      this.game = game; this.lift = lift;
      const c = cfg || {};
      this.cfg = Object.assign({}, DEFAULTS, c);
      this.cfg.canopy = Object.assign({}, DEFAULTS.canopy, c.canopy || {});
      this.cfg.texts = Object.assign({}, DEFAULTS.texts, c.texts || {});
      this.gcfg = Object.assign({}, GUIDE, guide || {});
      this.group = null; this.tex = null; this.surf = null; this.metal = null; this.glowMat = null;
      this.parts = [];          // 駅ごと: { lift, i, s, group, meshes }
      this.inside = false;      // カメラが扉のあるランドマークのロビーの中（look.js の室内）
      this.guide = null;        // 画面の案内: { lift, i, dist, arrow, text }
      this.lobbies = this._lobbies();
      this._cp = new THREE.Vector3();
      this._act = 0; this._t = 0;
      this._gEl = null; this._gText = ''; this._gRot = ''; this._gShown = false;
      const d = typeof document !== 'undefined' && document.getElementById ? document : null;
      if (d) { const e = d.getElementById('lift-guide'); if (e) this._gEl = { root: e, text: e.querySelector ? e.querySelector('.lg-text') : null, arrow: e.querySelector ? e.querySelector('.lg-arrow') : null }; }
      this.stats = { builds: 0, disposes: 0, meshes: 0, verts: 0, buildMs: 0, stepMsMax: 0, buildFrames: 0, guides: 0, programs: 0 };
      this._job = null;
      // アトラス・面のテクスチャ・材質は街を始めるとき（読み込みの画面の間）に作る（b16: Chromium で最初の文字の描画が 60〜350 ms = 1 歩に入れると
      //   ヘリで近づいたフレームが止まった。2 枚で 0.6 MB。形は近づいてから 1 フレーム buildMs ms ずつ）
      if (typeof document !== 'undefined' && document.createElement && this.cfg.prebuild !== false) { try { this._ensureMats(); } catch (e) { console.warn('[LiftView] prebuild', e); } }
    }

    // ランドマークのロビー（params.lobby = [高さ, x の外, x の内, z の半分]、東西に 1 つずつ）と入口（params.doors）。世界の座標（yaw 0 のランドマークだけ）
    _lobbies() {
      const out = [], city = this.game.city, plan = city && city.plan;
      if (!plan) return out;
      for (const L of this.lift.lifts) {
        const lm = (plan.landmarks || []).find((q) => q.id === L.landmark), p = lm && lm.params;
        if (!p || !Array.isArray(p.lobby)) continue;
        const lb = p.lobby, s0 = L.stations[0], floor = s0 ? s0.y : (city.curbH || 0);
        for (const sx of [-1, 1]) {
          const a = sx * lb[1], b = sx * lb[2];
          const R = { lift: L, x0: p.x + Math.min(a, b), x1: p.x + Math.max(a, b), z0: p.z - lb[3], z1: p.z + lb[3], y0: floor, y1: lb[0], doors: [], hasLift: false, face: p.podium ? p.podium[1] : null, pz: p.z };
          R.cx = (R.x0 + R.x1) / 2; R.cz = (R.z0 + R.z1) / 2;
          R.hasLift = !!s0 && s0.x > R.x0 && s0.x < R.x1 && s0.z > R.z0 && s0.z < R.z1;
          for (const d of p.doors || []) {
            const dx = p.x + d[1], dz = p.z + d[3];
            if (dx > R.x0 && dx < R.x1) R.doors.push({ x: dx, y: d[2], z: dz, yaw: d[4], w: d[5], h: d[6], back: p.podium ? p.podium[1] - d[3] : 0 });
          }
          out.push(R);
        }
      }
      return out;
    }
    _lobbyAt(x, y, z) {
      for (const R of this.lobbies) if (x > R.x0 && x < R.x1 && z > R.z0 && z < R.z1 && y > R.y0 - 1 && y < R.y1) return R;
      return null;
    }
    // 駅のあるロビー（L0）。無ければ null（デッキ・スカイフロア）
    _stLobby(s) {
      const m = this._stL || (this._stL = new Map());
      if (!m.has(s)) m.set(s, this._lobbyAt(s.x, s.y + 1, s.z));
      return m.get(s);
    }

    // ---------- アトラス ----------
    _atlas() {
      const cv = document.createElement('canvas');
      cv.width = AW; cv.height = AH;
      const x = cv.getContext('2d'), T = this.cfg.texts, lab = this.lift.cfg.labels || {};
      x.fillStyle = '#000'; x.fillRect(0, 0, AW, AH);
      const pict = (px, py, s) => { // エレベーターの絵（角の丸い枠に上下の三角）
        x.strokeStyle = '#7fe6ff'; x.lineWidth = 3;
        x.strokeRect(px, py, s, s);
        x.fillStyle = '#ffffff';
        x.beginPath(); x.moveTo(px + s * 0.5, py + s * 0.14); x.lineTo(px + s * 0.76, py + s * 0.42); x.lineTo(px + s * 0.24, py + s * 0.42); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(px + s * 0.5, py + s * 0.86); x.lineTo(px + s * 0.76, py + s * 0.58); x.lineTo(px + s * 0.24, py + s * 0.58); x.closePath(); x.fill();
      };
      const arrow = (cx, cy, s, dir) => { // dir: 'up' | 'left' | 'right'
        x.save(); x.translate(cx, cy); x.rotate(dir === 'left' ? -Math.PI / 2 : dir === 'right' ? Math.PI / 2 : 0);
        x.fillStyle = '#7fe6ff';
        x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.8, 0); x.lineTo(s * 0.3, 0); x.lineTo(s * 0.3, s); x.lineTo(-s * 0.3, s); x.lineTo(-s * 0.3, 0); x.lineTo(-s * 0.8, 0); x.closePath(); x.fill();
        x.restore();
      };
      x.textBaseline = 'middle';
      // 幅に収まる大きさで書く（measureText の無い所は size のまま）
      const fit = (text, px, py, maxW, size, weight) => {
        let fs = size;
        x.font = weight + ' ' + fs + 'px ' + FONT;
        for (let k = 0; k < 12 && fs > 9; k++) { const m = x.measureText(text); if (!(m && m.width > maxW)) break; fs -= 1; x.font = weight + ' ' + fs + 'px ' + FONT; }
        x.fillText(text, px, py);
      };
      // ひさしの看板（エレベーターのあるロビー / 無いロビー）
      for (const k of ['canopyLift', 'canopyOther']) {
        const r = SLOT[k], cy = (r[1] + r[3]) / 2;
        x.fillStyle = '#e8fbff'; x.textAlign = 'left';
        fit(T.title, r[0] + 12, cy + 1, 262, 26, '700');
        x.fillStyle = '#7fe6ff'; x.fillRect(r[0] + 284, r[1] + 12, 2, 40);
        if (k === 'canopyLift') { pict(r[0] + 296, r[1] + 14, 36); x.fillStyle = '#ffffff'; fit(T.lift, r[0] + 340, cy + 1, 134, 22, '700'); arrow(r[0] + 492, cy, 13, 'up'); }
        else { arrow(r[0] + 306, cy, 12, this._otherDir || 'left'); x.fillStyle = '#ffffff'; fit(T.other, r[0] + 326, cy + 1, 180, 16, '700'); }
      }
      // 駅の案内板（エレベーター + 階の名前）
      const st = (this.lift.lifts[0] && this.lift.lifts[0].stations) || [];
      for (let i = 0; i < 3; i++) {
        const r = SLOT['sign' + i], s = st[i], name = s ? (lab[s.name] || s.name) : '';
        pict(r[0] + 10, r[1] + 10, 44);
        x.textAlign = 'left';
        x.fillStyle = '#ffffff'; fit(T.lift, r[0] + 66, r[1] + 22, 182, 24, '700');
        x.fillStyle = '#7fe6ff'; fit(name, r[0] + 66, r[1] + 47, 182, 17, '600');
      }
      // 明かりの輪・床の矢印・白
      let r = SLOT.pool;
      const rg = x.createRadialGradient ? x.createRadialGradient(r[0] + 32, r[1] + 32, 0, r[0] + 32, r[1] + 32, 30) : null;
      if (rg) { rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.45, '#9a9a9a'); rg.addColorStop(1, '#000000'); x.fillStyle = rg; } else x.fillStyle = '#808080';
      x.fillRect(r[0], r[1], 64, 64);
      r = SLOT.chevron;
      x.fillStyle = '#ffffff';
      x.beginPath(); x.moveTo(r[0] + 32, r[1] + 8); x.lineTo(r[0] + 58, r[1] + 40); x.lineTo(r[0] + 46, r[1] + 40); x.lineTo(r[0] + 32, r[1] + 24); x.lineTo(r[0] + 18, r[1] + 40); x.lineTo(r[0] + 6, r[1] + 40); x.closePath(); x.fill();
      r = SLOT.white; x.fillStyle = '#ffffff'; x.fillRect(r[0], r[1], 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 4;
      tex.name = 'lift:atlas';
      return tex;
    }

    // 面のテクスチャ: ヘアラインの金属（縦の細い線）・天井の板（升目）・壁の板・黒（案内板の板。光らない）
    _surface() {
      const cv = document.createElement('canvas');
      cv.width = SW; cv.height = SH;
      const x = cv.getContext('2d');
      const rnd = (() => { let a = 0x51f7; return () => { a = (a * 1103515245 + 12345) >>> 0; return (a >>> 8) / 16777216; }; })();
      let r = SURF.metal;
      x.fillStyle = '#b4bcc3'; x.fillRect(r[0], r[1], 64, 64);
      // ヘアライン（b16）: 64 px が扉 1 枚 1.2 m に広がるので、線ごとの差は ±2 % まで（±7 % でも 1 本 2 cm の縞がカーテンのひだに見えた = p11_top_door）。
      //   ステンレスに見せるのは横の明るさの流れ（左上が明るく右下へ少し暗い = 磨いた板の映り込み）と、縦に細かく途切れる線（線の中の明るさを 8 px ごとに変える）
      const lg = x.createLinearGradient ? x.createLinearGradient(r[0], r[1], r[2], r[3]) : null;
      if (lg) { lg.addColorStop(0, '#c4cbd1'); lg.addColorStop(0.55, '#b2bac1'); lg.addColorStop(1, '#a9b1b8'); x.fillStyle = lg; x.fillRect(r[0], r[1], 64, 64); }
      for (let i = r[0]; i < r[2]; i++) for (let y = r[1]; y < r[3]; y += 8) {
        const t = rnd();
        x.fillStyle = t < 0.5 ? 'rgba(255,255,255,' + (t * 0.04).toFixed(3) + ')' : 'rgba(40,46,52,' + ((t - 0.5) * 0.04).toFixed(3) + ')';
        x.fillRect(i, y, 1, 8);
      }
      r = SURF.tile;
      x.fillStyle = '#dcd8d0'; x.fillRect(r[0], r[1], 64, 64); x.fillStyle = '#9d988f'; x.fillRect(r[0], r[1], 64, 2); x.fillRect(r[0], r[1], 2, 64);
      r = SURF.panel;
      const gp = x.createLinearGradient ? x.createLinearGradient(0, r[1], 0, r[3]) : null;
      if (gp) { gp.addColorStop(0, '#d8d1c6'); gp.addColorStop(1, '#bdb5a9'); x.fillStyle = gp; } else x.fillStyle = '#cbc3b7';
      x.fillRect(r[0], r[1], 64, 64); x.fillStyle = '#857d72'; x.fillRect(r[0], r[1], 2, 64); x.fillRect(r[0], r[1], 64, 1);
      r = SURF.dark; x.fillStyle = '#000000'; x.fillRect(r[0], r[1], 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 4;
      tex.name = 'lift:surface';
      return tex;
    }

    // ---------- 作る / 捨てる ----------
    // すぐ全部作る（テスト・古い呼び方）
    _build() { const j = this._buildGen(); while (!j.next().done); }
    // 1 歩ずつ作るジェネレーター（update が 1 フレーム buildMs ms まで進める）。材質とアトラスは最初の 1 回だけ
    *_buildGen() {
      const C = this.cfg, g = this.game;
      if (!this.metal) { this._ensureMats(); yield; }
      const group = new THREE.Group();
      group.name = 'lift';
      const parts = [];
      let verts = 0;
      for (const L of this.lift.lifts) {
        for (let i = 0; i < L.stations.length; i++) {
          const s = L.stations[i], M = new Geo(false), G = new Geo(true);
          M.sun = this._stLobby(s) ? 0 : 1; // ロビーの中の駅（L0）は直射なし。デッキ・スカイフロア（ガラスの中）は今まで通り
          this._door(M, G, s, i);
          this._core(M, G, L, s, i);
          yield;
          if (i === 0) for (const R of this.lobbies) if (R.lift === L) { this._lobby(M, G, R); yield; }
          const grp = new THREE.Group();
          grp.name = 'lift:' + s.name;
          const meshes = [];
          for (const [mk, mat] of [[M, this.metal], [G, this.glowMat]]) {
            const geo = mk.geometry();
            if (!geo) continue;
            const m = new THREE.Mesh(geo, mat);
            m.name = 'lift:' + s.name + (mat === this.metal ? ':metal' : ':glow');
            m.castShadow = false; m.receiveShadow = false;
            m.matrixAutoUpdate = false;
            if (mat === this.glowMat) m.renderOrder = 2;
            grp.add(m); meshes.push(m);
            verts += geo.attributes.position.count;
            yield;
          }
          const bs = meshes.length ? meshes[0].geometry.boundingSphere : null;
          group.add(grp);
          parts.push({ lift: L, i, s, group: grp, meshes, c: bs ? bs.center.clone() : new THREE.Vector3(s.x, s.y, s.z), r: bs ? bs.radius : 5 });
        }
      }
      this.group = group; this.parts = parts;
      g.scene.add(this.group);
      this.stats.builds++; this.stats.meshes = this.parts.reduce((a, p) => a + p.meshes.length, 0); this.stats.verts = verts;
    }
    // アトラス・面のテクスチャ・材質（ゲームの間 1 回。捨てるのは dispose だけ = プログラムを作り直さない）
    _ensureMats() {
      if (this.metal) return;
      // もう 1 つのロビーの看板の矢印: エレベーターのあるロビーが、入口を見ている人の左か右か
      const LL = this.lobbies.find((R) => R.hasLift), LO = this.lobbies.find((R) => !R.hasLift && R.doors.length);
      if (LL && LO) { const d = LO.doors[0], F = frameOf(d.x, d.y, d.z, d.yaw); this._otherDir = (LL.cx - LO.cx) * F.r[0] + (LL.cz - LO.cz) * F.r[2] < 0 ? 'left' : 'right'; }
      this.tex = this._atlas();
      this.surf = this._surface();
      this._mats();
      this.stats.programs++;
    }
    _mats() {
      const C = this.cfg;
      this.metal = new THREE.MeshStandardMaterial({ map: this.surf, vertexColors: true, metalness: C.metalness, roughness: C.roughness,
        emissive: new THREE.Color(1, 1, 1), emissiveMap: this.surf, emissiveIntensity: C.emissive });
      this.metal.name = 'lift:metal';
      // 建物の中の面（aSun 0）は太陽・点光源の直接の光を受けない（半球光・環境・発光だけ）。影を受けない（receiveShadow なし）ので、
      //   以前は夕日が建物を通り抜けてロビーの東の壁（西を向く板張り）が白く飛んでいた（b15 の検証: 板張りを隠すと 202 → 86）
      this.metal.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSun;\nvarying float vSun;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSun = aSun;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSun;')
          .replace('#include <aomap_fragment>', '\treflectedLight.directDiffuse *= vSun;\n\treflectedLight.directSpecular *= vSun;\n#include <aomap_fragment>');
      };
      this.metal.customProgramCacheKey = () => 'lift:metal|sun';
      this.glowMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.tex }, uTime: { value: 0 }, uActive: { value: 0 }, uGain: { value: C.glow } },
        vertexShader: [
          'attribute vec3 aCol; attribute float aPulse;',
          'varying vec2 vUv; varying vec3 vCol; varying float vP;',
          'void main() { vUv = uv; vCol = aCol; vP = aPulse; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D map; uniform float uTime; uniform float uActive; uniform float uGain;',
          'varying vec2 vUv; varying vec3 vCol; varying float vP;',
          'void main() {',
          '  vec3 c = pow(texture2D(map, vUv).rgb, vec3(2.2)) * vCol * uGain;',
          '  if (vP > 0.5) { float w = 0.5 + 0.5 * sin(uTime - vP * 1.4); c *= uActive * (0.2 + 0.8 * w * w); }',
          '  gl_FragColor = vec4(c, 1.0);',
          '}'
        ].join('\n'),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
      });
      this.glowMat.name = 'lift:glow';
    }

    // 離れた: 形だけ捨てる（材質・アトラスは残す）。all = ゲームの終わり（材質も）
    _free(all) {
      if (this._job) { this._job = null; } // 作りかけ（シーンに入れる前の形は GC へ。GPU にはまだ上がっていない）
      if (this.group) {
        if (this.group.parent) this.group.parent.remove(this.group);
        for (const p of this.parts) for (const m of p.meshes) m.geometry.dispose();
        this.parts = [];
        this.group = null;
        this.stats.disposes++;
      }
      if (!all) return;
      if (this.metal) this.metal.dispose();
      if (this.glowMat) this.glowMat.dispose();
      if (this.tex) this.tex.dispose();
      if (this.surf) this.surf.dispose();
      this.metal = null; this.glowMat = null; this.tex = null; this.surf = null;
    }

    // 駅の扉・枠・案内板・呼びボタン・床の矢印
    _door(M, G, s, i) {
      const C = this.cfg, gc = this.gcfg;
      const dw = C.doorW, dh = C.doorH, fw = C.frame, hw = dw / 2;
      const F0 = frameOf(s.x - Math.sin(s.yaw * Math.PI / 180) * C.doorBack, s.y, s.z - Math.cos(s.yaw * Math.PI / 180) * C.doorBack, s.yaw);
      // 壁までの広さに収まるよう横へずらす（組の半分の幅 = 案内板の端 hw + fw）
      const sh = this._doorShift(s, F0, hw + fw + C.wallClear);
      const F = sh ? frameOf(F0.W(sh, 0, 0)[0], s.y, F0.W(sh, 0, 0)[2], s.yaw) : F0;
      this.doorShift = this.doorShift || {}; this.doorShift[s.name] = sh;
      const UM = uvS(SURF.metal), UD = uvS(SURF.dark), UW = uvOf(SLOT.white), UP = uvOf(SLOT.pool), UC = uvOf(SLOT.chevron);
      const frameCol = lin('#9aa4ad'), leafCol = lin('#f2f4f6'), cyan = lin('#6fe8ff', 1.25), white = [1, 1, 1];
      // 枠（左右の柱と上の梁。壁の中まで 0.3 m）
      fbox(M, F, -hw - fw, -hw, 0, dh + fw, -0.3, 0.06, UM, frameCol, 'v-');
      fbox(M, F, hw, hw + fw, 0, dh + fw, -0.3, 0.06, UM, frameCol, 'v-');
      fbox(M, F, -hw, hw, dh, dh + fw, -0.3, 0.06, UM, frameCol, 'u-u+');
      // 両開きの扉（真ん中に暗い合わせ目）
      M.quad(F.W(-hw, 0, 0), F.vec(hw - 0.008, 0, 0), F.vec(0, dh, 0), F.n, UM, leafCol);
      M.quad(F.W(0.008, 0, 0), F.vec(hw - 0.008, 0, 0), F.vec(0, dh, 0), F.n, UM, leafCol);
      M.quad(F.W(-0.008, 0, -0.012), F.vec(0.016, 0, 0), F.vec(0, dh, 0), F.n, UD, [0.12, 0.13, 0.14]); // 合わせ目（b16: 4 cm の黒 → 1.6 cm の暗い灰色）
      // 案内板（暗い板 + 光る文字）
      const sw = dw + 2 * fw, v0 = dh + fw + C.signGap, v1 = v0 + C.signH;
      fbox(M, F, -sw / 2, sw / 2, v0, v1, -0.3, 0.08, UD, [0.05, 0.05, 0.06]);
      G.quad(F.W(-sw / 2 + 0.05, v0 + 0.04, 0.086), F.vec(sw - 0.1, 0, 0), F.vec(0, C.signH - 0.08, 0), F.n, uvOf(SLOT['sign' + Math.min(2, i)]), white);
      // 光る縁（枠の内側）と呼びボタン
      const ew = 0.035, wf = 0.066;
      G.quad(F.W(-hw - 0.045, 0, wf), F.vec(ew, 0, 0), F.vec(0, dh + 0.045, 0), F.n, UW, cyan);
      G.quad(F.W(hw + 0.01, 0, wf), F.vec(ew, 0, 0), F.vec(0, dh + 0.045, 0), F.n, UW, cyan);
      G.quad(F.W(-hw - 0.01, dh + 0.01, wf), F.vec(dw + 0.02, 0, 0), F.vec(0, ew, 0), F.n, UW, cyan);
      G.quad(F.W(hw + fw / 2 - 0.05, 1.05, wf), F.vec(0.1, 0, 0), F.vec(0, 0.2, 0), F.n, UP, lin('#9ff4ff', 1.6));
      // 床の案内の矢印（扉へ向かう。案内が出ている間だけ光って流れる。k = 1 が扉から一番遠い）
      const n = Math.max(0, gc.markers | 0), cw = 1.1, cl = 0.75;
      for (let k = 1; k <= n; k++) {
        const w = C.doorBack + gc.markerFrom + (n - k) * gc.markerStep;
        G.quad(F.W(-cw / 2, 0.035, w + cl / 2), F.vec(cw, 0, 0), F.vec(0, 0, -cl), [0, 1, 0], UC, lin('#6fe8ff', 1.4), k);
      }
    }

    // 扉の組の横のずれ（m、扉を見ている人の右が +）。駅のロビー（L0）の壁の内側の面（ロビーの箱の wt 0.3 m 内側）までの広さが need より狭い側から
    //   離す。両側とも狭ければ真ん中。ロビーの外の駅（デッキ・スカイフロア）は 0
    _doorShift(s, F, need) {
      const R = this._stLobby(s);
      if (!R) return 0;
      const wt = 0.3, x0 = R.x0 + wt, x1 = R.x1 - wt, z0 = R.z0 + wt, z1 = R.z1 - wt, o = F.W(0, 0, 0), r = F.r;
      let up = Infinity, um = Infinity; // +u・−u の向きの広さ
      const lim = (o0, rr, lo, hi) => {
        if (Math.abs(rr) < 1e-6) return;
        const ta = (lo - o0) / rr, tb = (hi - o0) / rr, tp = Math.max(ta, tb), tm = Math.min(ta, tb);
        if (tp < up) up = tp; if (-tm < um) um = -tm;
      };
      lim(o[0], r[0], x0, x1); lim(o[2], r[2], z0, z1);
      if (!(up < 1e5 && um < 1e5)) return 0;
      if (up >= need && um >= need) return 0;
      if (up + um < 2 * need) return (up - um) / 2;
      return up < need ? up - need : need - um;
    }

    // エレベーターの柱（params.lift.core = [x0, x1, z0, z1]、ノード空間）の見える面に金属の板と角の光る線。ロビー（最初の駅: 天井まで）と
    //   スカイフロア（params.sky より上の駅: params.cap の下まで）だけ。デッキの柱は GLB（skyhigh.glb の扉と光る輪）のまま。扉のある面は案内板の上だけ
    _core(M, G, L, s, i) {
      const plan = this.game.city && this.game.city.plan, lm = plan && (plan.landmarks || []).find((q) => q.id === L.landmark), p = lm && lm.params;
      const c = p && p.lift && p.lift.core;
      if (!c) return;
      // 部屋の内側（ロビー: 壁の 0.3 m 内側、スカイフロア: 角柱からランタンの厚さの内側）と天井
      let top = 0, room = null;
      if (i === 0 && Array.isArray(p.lobby)) {
        top = p.lobby[0] - this.cfg.ceilingDrop;
        const R = this.lobbies.find((q) => q.lift === L && q.hasLift);
        if (R) room = [R.x0 + 0.3, R.z0 + 0.3, R.x1 - 0.3, R.z1 - 0.3];
      } else if (p.sky != null && s.y >= p.sky - 0.5 && Array.isArray(p.cap) && Array.isArray(p.prism)) {
        top = p.cap[0];
        const lw = p.lantern || 0;
        room = [p.x - p.prism[0] + lw, p.z - p.prism[1] + lw, p.x + p.prism[0] - lw, p.z + p.prism[1] - lw];
      }
      if (!room || !(top > s.y + 1)) return;
      // 柱の箱は部屋の内側に切る（実際の箱: ロビーは北の壁まで、スカイフロアはランタンまで）
      const C = this.cfg, x0 = Math.max(p.x + c[0], room[0]), x1 = Math.min(p.x + c[1], room[2]), z0 = Math.max(p.z + c[2], room[1]), z1 = Math.min(p.z + c[3], room[3]);
      if (!(x1 > x0 + 0.5 && z1 > z0 + 0.5)) return;
      const y0 = s.y, d = 0.02, cell = 3;
      const UM = uvS(SURF.metal), UW = uvOf(SLOT.white), col = lin('#5d666e'), cyan = lin('#6fe8ff', 1.1);
      const a = s.yaw * Math.PI / 180, nx = Math.round(Math.sin(a)), nz = Math.round(Math.cos(a));
      const signTop = y0 + C.doorH + C.frame + C.signGap + C.signH + 0.05;
      // 面: [原点 x, z, 横の向き ux, uz, 長さ, 外向き nx, nz]
      const faces = [[x0, z0, 0, 1, z1 - z0, -1, 0], [x0, z1, 1, 0, x1 - x0, 0, 1], [x1, z0, 0, 1, z1 - z0, 1, 0], [x0, z0, 1, 0, x1 - x0, 0, -1]];
      for (const f of faces) {
        // 壁に付いた面（ロビーの奥の壁・ランタンのガラス）は張らない: 面の真ん中の 0.3 m 外が部屋の内側か
        const mx = f[0] + f[2] * f[4] / 2 + f[5] * 0.3, mz = f[1] + f[3] * f[4] / 2 + f[6] * 0.3;
        if (!(mx > room[0] && mx < room[2] && mz > room[1] && mz < room[3])) continue;
        const doorFace = f[5] === nx && f[6] === nz;
        const ya = doorFace ? signTop : y0;
        for (let u = 0; u < f[4] - 0.01; u += cell) for (let y = ya; y < top - 0.01; y += cell) {
          const eu = Math.min(cell, f[4] - u), ey = Math.min(cell, top - y);
          M.quad([f[0] + f[2] * u + f[5] * d, y, f[1] + f[3] * u + f[6] * d], [f[2] * eu, 0, f[3] * eu], [0, ey, 0], [f[5], 0, f[6]],
            [UM[0], UM[1], UM[0] + (UM[2] - UM[0]) * eu / cell, UM[1] + (UM[3] - UM[1]) * ey / cell], col);
        }
        // 角の光る線（面の両端、床から上まで）
        if (!doorFace) for (const e of [0.03, f[4] - 0.07]) G.quad([f[0] + f[2] * e + f[5] * (d + 0.004), y0, f[1] + f[3] * e + f[6] * (d + 0.004)], [f[2] * 0.04, 0, f[3] * 0.04], [0, top - y0, 0], [f[5], 0, f[6]], UW, cyan);
      }
    }

    // 扉のあるランドマークのロビー: 天井・天井の照明・床の明かり・壁の板張り・入口のひさしと看板
    _lobby(M, G, R) {
      M.sun = 0; // 天井・板張りは建物の中（入口のひさしは外 = 下で 1 に戻す）
      const C = this.cfg, wt = 0.3, x0 = R.x0 + wt, x1 = R.x1 - wt, z0 = R.z0 + wt, z1 = R.z1 - wt;
      const yc = R.y1 - C.ceilingDrop, yf = R.y0;
      const UT = uvS(SURF.tile), UPn = uvS(SURF.panel), UW = uvOf(SLOT.white), UP = uvOf(SLOT.pool);
      const cell = 3;
      // 天井（下を向く升目の板）
      for (let x = x0; x < x1 - 0.01; x += cell) for (let z = z0; z < z1 - 0.01; z += cell) {
        const ex = Math.min(cell, x1 - x), ez = Math.min(cell, z1 - z);
        M.quad([x, yc, z], [ex, 0, 0], [0, 0, ez], [0, -1, 0], [UT[0], UT[1], UT[0] + (UT[2] - UT[0]) * ex / cell, UT[1] + (UT[3] - UT[1]) * ez / cell], lin('#e8e4dc'));
      }
      // 壁の板張り（奥と左右の壁の内側。正面はガラスと扉なので張らない）
      if (C.cladding) {
        const col = lin('#e2dcd2'), h = yc - yf, d = 0.02;
        const wall = (ox, oz, ux, uz, len, nx, nz) => {
          for (let a = 0; a < len - 0.01; a += cell) for (let y = yf; y < yc - 0.01; y += cell) {
            const ea = Math.min(cell, len - a), ey = Math.min(cell, yc - y);
            M.quad([ox + ux * a + nx * d, y, oz + uz * a + nz * d], [ux * ea, 0, uz * ea], [0, ey, 0], [nx, 0, nz],
              [UPn[0], UPn[1], UPn[0] + (UPn[2] - UPn[0]) * ea / cell, UPn[1] + (UPn[3] - UPn[1]) * ey / cell], col);
          }
          return h;
        };
        wall(x0, z0, 1, 0, x1 - x0, 0, 1);       // 奥（北）
        wall(x0, z0, 0, 1, z1 - z0, 1, 0);       // 西
        wall(x1, z0, 0, 1, z1 - z0, -1, 0);      // 東
      }
      // 天井の照明（升目ごと）と床の明かり
      const pe = C.panelEvery, ps = C.panelSize, warm = lin('#fff1dc', C.panelGain), pool = lin('#ffe9c8', C.poolGain), pr = C.poolRadius;
      for (let x = x0 + pe / 2; x < x1 - 1; x += pe) for (let z = z0 + pe / 2; z < z1 - 1; z += pe) {
        G.quad([x - ps / 2, yc - 0.01, z - ps / 2], [ps, 0, 0], [0, 0, ps], [0, -1, 0], UW, warm);
        if (C.poolGain > 0) G.quad([x - pr, yf + 0.025, z + pr], [2 * pr, 0, 0], [0, 0, -2 * pr], [0, 1, 0], UP, pool);
      }
      // 入口のひさしと看板。ひさしは skyhigh.glb にある（低層部の面から depth m・高さ y0〜y1 m・幅 ±halfW、下に水色の光）ので、こちらは
      //   その内側に inset m 小さく作る（GLB が読めれば中に隠れる・読めなければこれが見える）。看板の板はひさしの前の縁の上に立てる
      //   下の面（soffit）: GLB の下の水色の光の板（4.85〜5.0 m、全面が同じ水色 = 平らな水色の板に見えた）を下から soffit m の厚さの暗い金属の板で
      //   包み、縁の水色の線（rim m 幅）と温かいダウンライト 3 つにする（GLB が無くても同じ）
      const cp = C.canopy, e = cp.inset, sf = cp.soffit || 0;
      M.sun = 1;
      for (const d of R.doors) {
        const F = frameOf(d.x, d.y, d.z, d.yaw), hw = cp.halfW, w0 = Math.max(0, d.back), w1 = w0 + cp.depth, v0 = cp.y0 - d.y, v1 = cp.y1 - d.y;
        fbox(M, F, -hw + e, hw - e, v0 + e, v1 - e, w0 - 0.8, w1 - e, uvS(SURF.metal), lin('#8d969e'), 'w-'); // ガラスの面（低層部の面の 0.8 m 内側）から前へ
        const vb = v0 - sf; // 下の面の高さ
        if (sf > 0) fbox(M, F, -hw + e, hw - e, vb, v0 + e, w0 - 0.8, w1 - e, uvS(SURF.metal), lin('#3c4248'), 'w-v+');
        const rim = cp.rim || 0.08, cyanR = lin('#6fe8ff', 1.1), yb = vb - 0.006, ri = 0.12;
        G.quad(F.W(-hw + ri, yb, w1 - ri - rim), F.vec(2 * (hw - ri), 0, 0), F.vec(0, 0, rim), [0, -1, 0], UW, cyanR);          // 前の縁
        for (const xs of [-hw + ri, hw - ri - rim]) G.quad(F.W(xs, yb, w0 + ri), F.vec(rim, 0, 0), F.vec(0, 0, cp.depth - 2 * ri - rim), [0, -1, 0], UW, cyanR); // 左右の縁
        const dl = cp.downlight || 0.42, warmD = lin('#fff1dc', C.panelGain);
        for (const xs of [-hw / 2, 0, hw / 2]) G.quad(F.W(xs - dl / 2, yb, w0 + cp.depth / 2 - dl / 2), F.vec(dl, 0, 0), F.vec(0, 0, dl), [0, -1, 0], UW, warmD);
        fbox(M, F, -hw, hw, v1, v1 + cp.signH + 0.1, w1 - cp.signThick, w1, uvS(SURF.dark), [0.05, 0.05, 0.06], 'w-');
        G.quad(F.W(-hw + 0.1, v1 + 0.05, w1 + 0.006), F.vec(2 * hw - 0.2, 0, 0), F.vec(0, cp.signH, 0), F.n, uvOf(R.hasLift ? SLOT.canopyLift : SLOT.canopyOther), [1, 1, 1]);
        // 足元の明かり
        if (C.poolGain > 0) G.quad(F.W(-hw, 0.025, w1 + 0.6), F.vec(2 * hw, 0, 0), F.vec(0, 0, -(w1 + 0.6 - w0 + 0.6)), [0, 1, 0], UP, lin('#ffe9c8', C.poolGain * 1.5));
      }
    }

    // ---------- 毎フレーム（lift.update の最後。生きている間）----------
    update(dt) {
      const g = this.game, C = this.cfg;
      const cam = g.camera;
      if (!cam || !this.lift.lifts.length) return;
      cam.getWorldPosition(this._cp);
      const cp = this._cp;
      // 近づいたら作る・離れたら捨てる（一番近い駅の横の距離）
      let dmin = Infinity;
      for (const L of this.lift.lifts) { const s = L.stations[0]; if (s) dmin = Math.min(dmin, Math.hypot(cp.x - s.x, cp.z - s.z)); }
      if (!this.group && !this._job && dmin < C.createDist) { this._job = this._buildGen(); this._jobMs = 0; }
      else if ((this.group || this._job) && dmin > C.disposeDist) this._free(false);
      if (this._job) {
        // 1 フレーム buildMs ms まで（少なくとも 1 歩）
        const t0 = LiftView.now(), bud = C.buildMs > 0 ? C.buildMs : 2;
        let t1 = t0;
        for (;;) {
          const a = LiftView.now(), r = this._job.next();
          t1 = LiftView.now();
          if (t1 - a > this.stats.stepMsMax) this.stats.stepMsMax = t1 - a;
          if (r.done) { this._job = null; break; }
          if (t1 - t0 >= bud) break;
        }
        this._jobMs += t1 - t0; this.stats.buildFrames++;
        if (!this._job) this.stats.buildMs = this._jobMs;
      }
      // 駅の組の表示（カメラから viewDist m の中だけ）
      for (const p of this.parts) p.group.visible = cp.distanceTo(p.c) < C.viewDist + p.r;
      // 室内（扉のあるランドマークのロビーの中）
      const R = this._lobbyAt(cp.x, cp.y, cp.z);
      this.inside = !!R;
      // 画面の案内と床の矢印
      this._updateGuide();
      this._t += dt;
      const want = this.guide && this.guide.arrow ? 1 : 0;
      this._act += (want - this._act) * Math.min(1, dt * 4);
      if (this.glowMat) { const u = this.glowMat.uniforms; u.uTime.value = this._t * this.gcfg.pulse; u.uActive.value = this._act; }
    }

    // 案内: 扉の前に着いていない・歩いている・乗っていない間。扉の近く（guide.dist m・同じ階）か扉のあるロビーの中 → 扉の向き。もう 1 つのロビー → 文字だけ
    _updateGuide() {
      const g = this.game, p = g.player, lf = this.lift;
      let G = null;
      if (p && !p.dead && !g.vehicle && !g.freeCam && p.state === 'walk' && !lf.ride && !lf.open && lf.available() && !lf.stationAt()) {
        const q = p.pos, R = this._lobbyAt(q.x, q.y, q.z);
        let best = null, bd = Infinity;
        for (const L of lf.lifts) for (let i = 0; i < L.stations.length; i++) {
          const s = L.stations[i];
          if (Math.abs(q.y - s.y) > lf.cfg.maxDy + 0.5) continue;
          const d = Math.hypot(q.x - s.x, q.z - s.z);
          // ロビーの中の駅（L0）はそのロビーの中にいるときだけ（壁の外の歩道で壁を指して「エレベーター 3 m」と出さない）。ほかは guide.dist m 以内
          const sR = this._stLobby(s);
          if ((sR ? R === sR : d <= this.gcfg.dist) && d < bd) { bd = d; best = { lift: L, i, s }; }
        }
        if (best) G = { lift: best.lift, i: best.i, dist: bd, arrow: true, x: best.s.x, z: best.s.z, ang: 0 };
        else if (R && !R.hasLift) G = { lift: R.lift, i: 0, dist: 0, arrow: false };
      }
      // 矢印の向き（画面の上 = 見ている向き、時計回り）
      if (G && G.arrow) {
        const yaw = p.yawAngle || 0, dx = G.x - p.pos.x, dz = G.z - p.pos.z;
        G.ang = Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw));
      }
      this.guide = G;
      const E = this._gEl;
      if (!E) return;
      if (!G) { if (this._gShown) { E.root.classList.add('hidden'); this._gShown = false; } return; }
      if (!this._gShown) { E.root.classList.remove('hidden'); this._gShown = true; this.stats.guides++; }
      const txt = G.arrow ? this.cfg.texts.lift + ' ' + Math.max(1, Math.round(G.dist)) + ' m' : this.cfg.texts.other;
      if (txt !== this._gText && E.text) { E.text.textContent = txt; this._gText = txt; }
      const rot = G.arrow ? 'rotate(' + Math.round(G.ang * 180 / Math.PI / 3) * 3 + 'deg)' : 'none';
      if (rot !== this._gRot && E.arrow && E.arrow.style) { E.arrow.style.transform = G.arrow ? rot : ''; E.arrow.style.display = G.arrow ? '' : 'none'; this._gRot = rot; }
    }

    hideGuide() {
      this.guide = null;
      if (this._gEl && this._gShown) { this._gEl.root.classList.add('hidden'); this._gShown = false; }
    }

    info() {
      return { built: !!this.group, parts: this.parts.map((p) => ({ name: p.s.name, visible: p.group.visible, meshes: p.meshes.length })), inside: this.inside,
        guide: this.guide ? { i: this.guide.i, dist: +this.guide.dist.toFixed(1), arrow: this.guide.arrow } : null, stats: this.stats };
    }

    dispose() {
      this.hideGuide();
      this._free(true);
      this.inside = false;
    }
    static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  }
  LiftView.DEFAULTS = DEFAULTS;
  LiftView.GUIDE = GUIDE;
  LiftView.SLOT = SLOT;
  MR.LiftView = LiftView;
})();
