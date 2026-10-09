// ミニマップと全体の地図（街）。citygen の minimap()（水・陸・通り・街区・公園・桟橋・橋・ラベル・ヘリポート）と skyline()（建物の外形）から
// 地図の画像（タイル）を作り、毎フレームはその画像を回して貼るだけ（ベクタを毎フレーム描かない）。
//   タイル: 1 枚 tileSize px（既定 256）× tileRes m/px（既定 2）= 512 m 四方。要る所だけ 1 フレームに 1 枚まで作り（1 枚 1〜2 ms）、
//     maxTiles 枚まで覚える。
//   全体図: overviewRes m/px（既定 8）の 1 枚（6 km → 750 px）。最初に作る（PC で十数 ms）。全体の地図と、ミニマップの半径が
//     overviewFrom m を超えたとき（ヘリ・降下）に使う。全体の地図で拡大したらタイルを重ねる。
//   ミニマップ（#minimap。右上）: プレイヤーが上（rotate: true。false なら北が上）、半径 radius m（ヘリ・落下中は高さで flyRadius まで広がる）。
//     自分の矢印・近くの乗り物とヘリ・ヘリポート・地名・安全地帯（今 = 青、次 = 白の点線）・目印（黄）・輸送ヘリの航路。
//     タップで全体の地図。描くのは hz 回/秒まで（stats.drawMs / drawMax で時間）。
//   全体の地図（#fullmap）: 1 本指で動かす・2 本指で拡大（PC はホイール）、タップで目印（目印をもう一度タップで消す）。「閉じる」/ M / Esc。
//     ヘリポート（ヘリがあるか）・近くの乗り物・地名・自分の位置と向き・安全地帯と次の安全地帯・輸送ヘリの航路。
//   設定は game.json の minimap（radius / flyRadius / flyFrom / flyTo / rotate / tileRes / tileSize / overviewRes / maxTiles / hz / labels）。
window.MR = window.MR || {};

MR.Minimap = class Minimap {
  static get DEFAULTS() {
    return { radius: 250, flyRadius: 650, flyFrom: 25, flyTo: 180, rotate: true, tileRes: 2, tileSize: 256, overviewRes: 8, overviewFrom: 420, maxTiles: 24, hz: 30, labels: true, vehicleRange: 400 };
  }

  static get COLORS() {
    return {
      water: '#16344a', land: '#2e3237', block: '#454a50', park: '#35603a', lake: '#1d4a66', pier: '#4d5359', bridge: '#767c83', plaza: '#3a3f45',
      bld0: [86, 92, 99], bld1: [150, 156, 163]
    };
  }

  constructor(game, cfg) {
    this.game = game;
    this.city = game.city;
    this.cfg = Object.assign({}, Minimap.DEFAULTS, cfg || {});
    this.data = this.city.minimap();
    this.bounds = this.data.bounds;
    this.stats = { draws: 0, drawMs: 0, drawMax: 0, tiles: 0, tileMs: 0, tileMax: 0, overviewMs: 0, fullDraws: 0, fullMs: 0 };
    this.tiles = new Map();     // "tx_tz" → { canvas, used }
    this._dom = [];             // [[要素, イベント, 関数]]（dispose で外す。#minimap / #fullmap は次のゲームでも同じ要素なので、残すと古いゲームが生き続ける）
    this._tick = 0;
    this._index();
    // ミニマップの canvas（#minimap の中に作る）
    const root = game.hud && game.hud.root;
    this.el = root && root.querySelector ? root.querySelector('#minimap') : null;
    this.canvas = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null;
    this.ctx = this.canvas && this.canvas.getContext ? this.canvas.getContext('2d') : null;
    if (this.el && this.canvas && this.el.appendChild) {
      if (this.el.insertBefore && this.el.firstChild) this.el.insertBefore(this.canvas, this.el.firstChild); else this.el.appendChild(this.canvas);
      this.el.classList.remove('hidden');
      this._listen(this.el, 'pointerdown', (e) => { if (e && e.preventDefault) e.preventDefault(); if (game.input && game.input.enabled) this.openFull(); });
    }
    if (this.el && this.el.classList && game.hud.compass) game.hud.compass.classList.remove('hidden');
    // 全体の地図
    this.full = { open: false, el: root && root.querySelector ? root.querySelector('#fullmap') : null, cx: 100, cz: 0, ppm: 0.06, dirty: true, t: 0 };
    this._setupFull();
    this._resize();
    if (typeof window !== 'undefined' && window.addEventListener) { this._onResize = () => this._resize(); window.addEventListener('resize', this._onResize); }
    // 全体図と立っている所のタイルは最初に作っておく
    this._overviewCanvas();
    const p = game.player && game.player.pos;
    if (p) this._tileAt(p.x, p.z, true);
  }

  // ---------- 地図のデータを 512 m の升に分ける（タイルを作るときに使う物だけ見る）----------
  _index() {
    const b = this.bounds, S = 512;
    this.gx = Math.ceil((b.maxX - b.minX) / S); this.gz = Math.ceil((b.maxZ - b.minZ) / S);
    const cells = this.cells = [];
    for (let i = 0; i < this.gx * this.gz; i++) cells.push({ blocks: [], roads: [], bld: [] });
    const add = (key, x0, z0, x1, z1, item) => {
      const i0 = Math.max(0, Math.floor((x0 - b.minX) / S)), i1 = Math.min(this.gx - 1, Math.floor((x1 - b.minX) / S));
      const j0 = Math.max(0, Math.floor((z0 - b.minZ) / S)), j1 = Math.min(this.gz - 1, Math.floor((z1 - b.minZ) / S));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * this.gx + i][key].push(item);
    };
    for (const r of this.data.blocks) add('blocks', r[0], r[1], r[2], r[3], r);
    for (const r of this.data.roads) {
      if (r.rect) add('roads', r.rect[0], r.rect[1], r.rect[2], r.rect[3], r);
      else if (r.pts) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of r.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } add('roads', x0, z0, x1, z1, r); }
    }
    let sky = null;
    try { sky = this.city.skyline(); } catch (e) { sky = null; }
    if (sky) for (const g of sky.groups) for (const bx of g.boxes) add('bld', bx.x - bx.w / 2, bx.z - bx.d / 2, bx.x + bx.w / 2, bx.z + bx.d / 2, bx);
  }

  // ---------- 地図を描く（ctx の変換は世界座標 → 画像。x0..x1, z0..z1 の範囲だけ）----------
  _paint(ctx, x0, z0, x1, z1, detail) {
    const C = Minimap.COLORS, d = this.data, b = this.bounds, S = 512;
    ctx.fillStyle = C.water;
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    const poly = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); };
    ctx.fillStyle = C.land;
    for (const l of d.land) { poly(l.poly); ctx.fill(); }
    const i0 = Math.max(0, Math.floor((x0 - b.minX) / S)), i1 = Math.min(this.gx - 1, Math.floor((x1 - b.minX) / S));
    const j0 = Math.max(0, Math.floor((z0 - b.minZ) / S)), j1 = Math.min(this.gz - 1, Math.floor((z1 - b.minZ) / S));
    const seen = new Set();
    const each = (key, fn) => {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const it of this.cells[j * this.gx + i][key]) { if (seen.has(it)) continue; seen.add(it); fn(it); }
    };
    ctx.fillStyle = C.block;
    each('blocks', (r) => { if (r[2] < x0 || r[0] > x1 || r[3] < z0 || r[1] > z1) return; ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); });
    ctx.fillStyle = C.park;
    for (const p of d.parks) { const r = p.rect; ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }
    // 斜めの道（ブロードウェイ・FDR）と広場は街区の上に
    each('roads', (r) => {
      if (!r.pts) return;
      ctx.fillStyle = r.kind === 'plaza' ? C.plaza : C.land;
      poly(r.pts); ctx.fill();
    });
    ctx.fillStyle = C.lake;
    for (const l of d.lakes) { poly(l.poly); ctx.fill(); }
    ctx.fillStyle = C.pier;
    for (const r of d.piers) ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    // 建物（高さで明るく）
    if (detail !== false) {
      const c0 = C.bld0, c1 = C.bld1;
      const cols = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8; cols.push('rgb(' + Math.round(c0[0] + (c1[0] - c0[0]) * t) + ',' + Math.round(c0[1] + (c1[1] - c0[1]) * t) + ',' + Math.round(c0[2] + (c1[2] - c0[2]) * t) + ')'); }
      let last = -1;
      each('bld', (bx) => {
        const bx0 = bx.x - bx.w / 2, bz0 = bx.z - bx.d / 2;
        if (bx0 > x1 || bx0 + bx.w < x0 || bz0 > z1 || bz0 + bx.d < z0) return;
        const k = Math.max(0, Math.min(8, Math.round(Math.sqrt(Math.max(0, bx.y + bx.h) / 260) * 8)));
        if (k !== last) { ctx.fillStyle = cols[k]; last = k; }
        ctx.fillRect(bx0, bz0, bx.w, bx.d);
      });
    }
    ctx.fillStyle = C.bridge;
    for (const br of d.bridges) ctx.fillRect(br.x0, br.z0, br.x1 - br.x0, br.z1 - br.z0);
  }

  // タイル（tx, tz）の画像。now = すぐ作る（無ければ null を返して次のフレームへ）
  _tile(tx, tz, now) {
    const key = tx + '_' + tz;
    let t = this.tiles.get(key);
    if (t) { t.used = this._tick; return t.canvas; }
    if (!now && this._builtThisFrame) return null;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const t0 = Minimap.now();
    const N = this.cfg.tileSize, res = this.cfg.tileRes, M = N * res;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) return null;
    const x0 = this.bounds.minX + tx * M, z0 = this.bounds.minZ + tz * M;
    ctx.setTransform(1 / res, 0, 0, 1 / res, -x0 / res, -z0 / res);
    this._paint(ctx, x0, z0, x0 + M, z0 + M, true);
    t = { canvas: c, used: this._tick, x0, z0, M };
    this.tiles.set(key, t);
    this._builtThisFrame = true;
    const ms = Minimap.now() - t0;
    this.stats.tiles++; this.stats.tileMs += ms; if (ms > this.stats.tileMax) this.stats.tileMax = ms;
    // 使っていない古いタイルを捨てる
    if (this.tiles.size > this.cfg.maxTiles) {
      let oldK = null, oldU = Infinity;
      for (const [k, v] of this.tiles) if (v.used < oldU && k !== key) { oldU = v.used; oldK = k; }
      if (oldK) { const v = this.tiles.get(oldK); v.canvas.width = v.canvas.height = 1; this.tiles.delete(oldK); }
    }
    return c;
  }
  _tileAt(x, z, now) {
    const M = this.cfg.tileSize * this.cfg.tileRes;
    return this._tile(Math.floor((x - this.bounds.minX) / M), Math.floor((z - this.bounds.minZ) / M), now);
  }

  // 全体図（1 枚）
  _overviewCanvas() {
    if (this._overview !== undefined) return this._overview;
    this._overview = null;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const t0 = Minimap.now();
    const b = this.bounds, res = this.cfg.overviewRes;
    const W = Math.ceil((b.maxX - b.minX) / res), H = Math.ceil((b.maxZ - b.minZ) / res);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1 / res, 0, 0, 1 / res, -b.minX / res, -b.minZ / res);
    this._paint(ctx, b.minX, b.minZ, b.maxX, b.maxZ, true);
    this._overview = c;
    this.stats.overviewMs = Minimap.now() - t0;
    return c;
  }

  // 選ぶ地図で選んだ所の輪の上の名前（coarseSnap の kind）
  static get PICK_LABEL() { return { roof: '屋上', deck: '甲板', pad: 'ヘリポート', structure: '高架', street: '道', park: '公園' }; }
  static now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  // ポインターイベントが起きた時刻（ブラウザが付ける timeStamp = performance.now と同じ時計。メインスレッドが詰まって処理が遅れても指の時刻のまま）。
  //   無い（テストの偽のイベント）・時計が違いそうなら今
  static evTime(e) { const t = e && e.timeStamp, n = Minimap.now(); return typeof t === 'number' && t > 0 && t <= n + 1000 && t > n - 60000 ? t : n; }

  _resize() {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.dpr = dpr;
    let w = 112, h = 112;
    if (this.el && this.el.clientWidth > 10) { w = this.el.clientWidth; h = this.el.clientHeight || w; }
    this.size = { w, h };
    if (this.canvas) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); if (this.canvas.style) { this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; } }
    const f = this.full;
    if (f.canvas) {
      let fw = (typeof window !== 'undefined' && window.innerWidth) || 844, fh = (typeof window !== 'undefined' && window.innerHeight) || 390;
      if (f.view && f.view.getBoundingClientRect) { const r = f.view.getBoundingClientRect(); if (r.width > 10) { fw = r.width; fh = r.height; } }
      f.w = fw; f.h = fh;
      f.canvas.width = Math.round(fw * dpr); f.canvas.height = Math.round(fh * dpr);
      if (f.canvas.style) { f.canvas.style.width = fw + 'px'; f.canvas.style.height = fh + 'px'; }
      f.dirty = true;
    }
  }

  // ---------- 状態（毎フレーム game から読む）----------
  _state() {
    const g = this.game, p = g.player;
    const v = g.vehicle;
    const cam = g.camera;
    let alt = 0;
    const R = g.royale || g.cityOnline; // ソロのバトロワ / 街のオンライン（同じ形: riding / ridePos / rideYaw / mapInfo）
    if (v && v.kind === 'heli') alt = v.agl || 0;
    else if (v && v.kind === 'jet') alt = Math.max(v.agl || 0, (v.speed || 0) * 2); // 戦闘機: 高さか速さで広く
    else if (p.state === 'fall' || p.state === 'chute') alt = p.agl || 0;
    else if (R && R.riding) alt = 400;
    const pos = (R && R.riding && R.ridePos) ? R.ridePos : p.pos;
    const yaw = (R && R.riding && R.rideYaw != null) ? R.rideYaw : p.yawAngle;
    return { x: pos.x, z: pos.z, yaw, alt, cam };
  }

  // ---------- 毎フレーム ----------
  update(dt) {
    this._tick++;
    this._builtThisFrame = false;
    this._acc = (this._acc || 0) + dt;
    const st = this._state();
    if (this.full.open) {
      this.full.t += dt;
      if (this.full.dirty || this.full.t > 0.2) { this.full.t = 0; this._drawFull(st); }
    }
    if (this._acc < 1 / this.cfg.hz) return;
    this._acc = 0;
    if (!this.ctx) return;
    // HUD が見えるようになった・画面の大きさが変わった（作ったときは HUD がまだ隠れていて大きさが分からないことがある）
    if ((this._tick & 15) === 0 && this.el && this.el.clientWidth && Math.abs(this.el.clientWidth - this.size.w) > 1) this._resize();
    const t0 = Minimap.now();
    this._draw(st);
    const ms = Minimap.now() - t0;
    this.stats.draws++;
    this.stats.drawMs += (ms - this.stats.drawMs) * 0.05;
    if (ms > this.stats.drawMax) this.stats.drawMax = ms;
    this.stats.lastMs = ms;
  }

  // 地図の半径（m）: 高いほど広く
  _radius(alt) {
    const c = this.cfg, k = Math.max(0, Math.min(1, (alt - c.flyFrom) / (c.flyTo - c.flyFrom)));
    return c.radius + (c.flyRadius - c.radius) * k * k * (3 - 2 * k);
  }

  _draw(st) {
    const ctx = this.ctx, dpr = this.dpr, w = this.size.w, h = this.size.h;
    const R = this._radius(st.alt);
    this._r += ((R) - (this._r || R)) * 0.15; if (!this._r) this._r = R;
    const ppm = Math.min(w, h) / 2 / this._r;
    const rot = this.cfg.rotate ? st.yaw : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = Minimap.COLORS.water;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot);
    ctx.scale(ppm, ppm);
    ctx.translate(-st.x, -st.z);
    // 広い（飛んでいる）ときは全体図、ふだんはタイル（回っているので対角線の長さまで）。タイルが無ければ全体図で埋める
    const ov = this._overview || null, b = this.bounds;
    if (ov && this._r > this.cfg.overviewFrom) ctx.drawImage(ov, b.minX, b.minZ, ov.width * this.cfg.overviewRes, ov.height * this.cfg.overviewRes);
    else {
      const M = this.cfg.tileSize * this.cfg.tileRes, ext = Math.hypot(w, h) / 2 / ppm;
      const tx0 = Math.floor((st.x - ext - b.minX) / M), tx1 = Math.floor((st.x + ext - b.minX) / M);
      const tz0 = Math.floor((st.z - ext - b.minZ) / M), tz1 = Math.floor((st.z + ext - b.minZ) / M);
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
        if (tx < 0 || tz < 0 || tx * M >= b.maxX - b.minX || tz * M >= b.maxZ - b.minZ) continue;
        const c = this._tile(tx, tz, false);
        if (c) ctx.drawImage(c, b.minX + tx * M, b.minZ + tz * M, M, M);
        else if (ov) ctx.drawImage(ov, (tx * M) / this.cfg.overviewRes, (tz * M) / this.cfg.overviewRes, M / this.cfg.overviewRes, M / this.cfg.overviewRes, b.minX + tx * M, b.minZ + tz * M, M, M);
      }
    }
    ctx.restore();
    // ここからは画面の座標（回した地図の上に、文字は立てたまま）
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toS = (x, z, out) => { const dx = (x - st.x) * ppm, dz = (z - st.z) * ppm; out.x = w / 2 + dx * cos - dz * sin; out.y = h / 2 + dx * sin + dz * cos; return out; };
    // 北の印の位置（地名はここと自分の矢印に重ねない）
    const n = toS(st.x, st.z - 1e6, { x: 0, y: 0 });
    const nx = n.x - w / 2, ny = n.y - h / 2, nl = Math.hypot(nx, ny) || 1;
    const rr = Math.min(w, h) / 2 - 9;
    const kx = w / 2 + nx / nl * rr, ky = h / 2 + ny / nl * rr;
    this._overlay(ctx, st, toS, ppm, w, h, false, [{ x0: kx - 9, x1: kx + 9, y0: ky - 9, y1: ky + 9 }, { x0: w / 2 - 8, x1: w / 2 + 8, y0: h / 2 - 9, y1: h / 2 + 9 }]);
    // 自分（真ん中の矢印。北が上なら向きに回す）
    this._arrow(ctx, w / 2, h / 2, this.cfg.rotate ? 0 : -st.yaw, 7);
    ctx.fillStyle = 'rgba(10,16,24,0.75)';
    ctx.beginPath(); ctx.arc(kx, ky, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff7a6e'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', kx, ky + 0.5);
  }

  _arrow(ctx, x, y, a, s) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(0, -s * 1.25); ctx.lineTo(s * 0.85, s); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s * 0.85, s); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // 安全地帯・航路・乗り物・ヘリポート・地名・目印（ミニマップと全体の地図で共通）。full: 全体の地図
  _overlay(ctx, st, toS, ppm, w, h, full, reserved, marks) {
    const g = this.game, q = { x: 0, y: 0 }, q2 = { x: 0, y: 0 };
    const RY = g.royale || g.cityOnline;
    const ry = RY && RY.mapInfo ? RY.mapInfo() : null;
    if (ry) {
      if (ry.cur) {
        // 安全地帯の外を青く塗る
        toS(ry.cur.x, ry.cur.z, q);
        const r = ry.cur.r * ppm;
        ctx.save();
        ctx.beginPath(); ctx.rect(-10, -10, w + 20, h + 20); ctx.arc(q.x, q.y, Math.max(0.5, r), 0, Math.PI * 2, true);
        ctx.fillStyle = 'rgba(40,90,220,0.28)';
        ctx.fill('evenodd');
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(90,160,255,0.95)'; ctx.lineWidth = full ? 2.5 : 1.8; ctx.stroke();
        ctx.restore();
      }
      if (ry.next) {
        toS(ry.next.x, ry.next.z, q);
        ctx.save();
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.5, ry.next.r * ppm), 0, Math.PI * 2);
        if (ctx.setLineDash) ctx.setLineDash(full ? [7, 5] : [4, 3]);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = full ? 2 : 1.4; ctx.stroke();
        ctx.restore();
      }
      if (ry.flight) {
        const f = ry.flight;
        toS(f.x0, f.z0, q); toS(f.x1, f.z1, q2);
        ctx.save();
        if (ctx.setLineDash) ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255,230,150,0.85)'; ctx.lineWidth = full ? 2 : 1.5;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
        ctx.restore();
        if (f.px != null) { toS(f.px, f.pz, q); ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(q.x, q.y, full ? 5 : 3.5, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // ヘリポート（ヘリがあれば明るく）
    const pads = this.data.helipads || [];
    for (const pad of pads) {
      toS(pad.x, pad.z, q);
      if (q.x < -12 || q.y < -12 || q.x > w + 12 || q.y > h + 12) continue;
      const has = this._heliPresent(pad);
      const r = full ? 8 : 5.5;
      ctx.fillStyle = has ? 'rgba(20,120,150,0.95)' : 'rgba(30,40,50,0.8)';
      ctx.strokeStyle = has ? '#bff6ff' : 'rgba(200,210,220,0.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = has ? '#ffffff' : 'rgba(220,230,240,0.6)';
      ctx.font = '700 ' + (full ? 10 : 7.5) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('H', q.x, q.y + 0.5);
    }
    // 乗り物（近くのもの。ヘリは輪、車は四角）
    const VR = full ? Infinity : this._r * 1.5;
    for (const v of g.vehicles) {
      if (v.wrecked || v === g.vehicle) continue;
      if (Math.hypot(v.pos.x - st.x, v.pos.z - st.z) > Math.min(VR, this.cfg.vehicleRange * (full ? 3 : 1))) continue;
      toS(v.pos.x, v.pos.z, q);
      if (q.x < -6 || q.y < -6 || q.x > w + 6 || q.y > h + 6) continue;
      if (v.kind === 'jet') {
        // 戦闘機: 機首の向きの三角形
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate((this.cfg.rotate && !full ? st.yaw : 0) - v.yaw);
        const s = full ? 1.4 : 1;
        ctx.fillStyle = '#c9d6e2'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 6 * s); ctx.lineTo(4.5 * s, -4 * s); ctx.lineTo(0, -2 * s); ctx.lineTo(-4.5 * s, -4 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      } else if (v.kind === 'heli') {
        ctx.strokeStyle = '#9fe9ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(q.x, q.y, full ? 6 : 4.5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#9fe9ff'; ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate((this.cfg.rotate && !full ? st.yaw : 0) - v.yaw);
        ctx.fillStyle = '#e8d38a'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
        const s = full ? 1.3 : 1;
        ctx.fillRect(-2.5 * s, -4 * s, 5 * s, 8 * s); ctx.strokeRect(-2.5 * s, -4 * s, 5 * s, 8 * s);
        ctx.restore();
      }
    }
    // 地名（重なるものは描かない。ホットゾーンが先。同じ名前は 1 つだけ）
    if (this.cfg.labels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = full ? 12 : 9;
      ctx.font = '600 ' + fs + 'px "Hiragino Sans", "Noto Sans JP", sans-serif';
      ctx.lineJoin = 'round';
      const placed = (reserved || []).slice(), names = {}, mk = marks || [];
      const hits = (r, list) => list.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0);
      for (const L of this.data.labels) {
        if (!full && L.kind !== 'hot') continue;
        if (names[L.text]) continue;
        toS(L.x, L.z, q);
        const tw = L.text.length * fs * 1.02 + 4, th = fs + 4;
        let x = q.x;
        if (!full) x = Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, x)); // ミニマップの縁で切れないよう内側へ
        if (x < -tw / 2 || q.y < -th || x > w + tw / 2 || q.y > h + th) continue;
        if (!full && (Math.abs(x - q.x) > tw * 0.6)) continue;
        let r = { x0: x - tw / 2, x1: x + tw / 2, y0: q.y - th / 2, y1: q.y + th / 2 };
        // 復活の場所を選ぶ地図: 死んだ所の ✕・選んだ所の輪と名前（marks）に重なる地名は、その印のすぐ下か上へずらす（どちらも読める）
        if (mk.length && hits(r, mk)) {
          let moved = null;
          for (const m of mk) {
            if (moved || !hits(r, [m])) continue;
            for (const y of [m.y1 + th / 2 + 1, m.y0 - th / 2 - 1]) {
              const r2 = { x0: r.x0, x1: r.x1, y0: y - th / 2, y1: y + th / 2 };
              if (!hits(r2, mk) && !hits(r2, placed)) { moved = r2; break; }
            }
          }
          if (moved) r = moved;
        }
        if (hits(r, placed)) continue;
        placed.push(r); names[L.text] = true;
        const ly = (r.y0 + r.y1) / 2;
        ctx.strokeStyle = 'rgba(8,12,18,0.85)'; ctx.lineWidth = 3;
        ctx.strokeText(L.text, x, ly);
        ctx.fillStyle = L.kind === 'hot' ? '#ffe6a8' : 'rgba(225,235,245,0.85)';
        ctx.fillText(L.text, x, ly);
      }
    }
    // 目印
    const wp = g.play && g.play.waypoint;
    if (wp) {
      toS(wp.x, wp.z, q);
      // ミニマップの外なら縁に
      let x = q.x, y = q.y;
      if (!full) { const m = 8; x = Math.max(m, Math.min(w - m, x)); y = Math.max(m, Math.min(h - m, y)); }
      ctx.save(); ctx.translate(x, y);
      const s = full ? 7 : 5;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath();
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // ヘリポートにヘリがあるか（出ているヘリがパッドの近く / まだ出していない（触っていない）なら置いてある）
  _heliPresent(pad) {
    const g = this.game, id = 'h_' + pad.id;
    if (g.cityOnline && g.cityOnline.recById) { const r = g.cityOnline.recById(id); return !!r && !r.wrecked && Math.hypot(r.x - pad.x, r.z - pad.z) < 15 && g.cityOnline.inVset(r); }
    const live = g._cityVehById && g._cityVehById.get(id);
    if (live) return !live.wrecked && Math.hypot(live.pos.x - pad.x, live.pos.z - pad.z) < 15;
    const saved = g._cityVehState && g._cityVehState.get(id);
    if (saved) return Math.hypot(saved.x - pad.x, saved.z - pad.z) < 15;
    return g.cityCfg ? g.cityCfg.helis !== false : true;
  }

  // ---------- 全体の地図 ----------
  _setupFull() {
    const f = this.full;
    if (!f.el || !f.el.querySelector) return;
    f.view = f.el.querySelector('.fm-view');
    f.canvas = (typeof document !== 'undefined' && document.createElement) ? document.createElement('canvas') : null;
    f.ctx = f.canvas && f.canvas.getContext ? f.canvas.getContext('2d') : null;
    if (f.view && f.canvas && f.view.appendChild) f.view.appendChild(f.canvas);
    const close = f.el.querySelector('#btn-fm-close'), clear = f.el.querySelector('#btn-fm-clear');
    // 復活する場所を選ぶとき（openPick）の説明・「ここには出られません」・「ここで復活」（ボタンは respawn.js が 1 回だけつなぐ）
    f.msg = f.el.querySelector('.fm-pick-msg');
    f.spawnBtn = f.el.querySelector('#btn-fm-spawn');
    const on = (el, ev, fn) => this._listen(el, ev, fn);
    on(close, 'click', (e) => { if (e && e.preventDefault) e.preventDefault(); this.closeFull(); });
    on(clear, 'click', (e) => { if (e && e.preventDefault) e.preventDefault(); if (this.game.play) this.game.play.setWaypoint(null); f.dirty = true; });
    // 指ごとの記録 { x, y, x0, y0, t, moved, noTap }（closeFull / openFull で空にする: 地図が閉じた後に上げた指は何もしない）。
    //   タップ = その指を 7 px 動かさずに 450 ms（選ぶときは pickTapMs）以内に上げた。ほかの指が置いてあってもよい（休めている親指）。
    //   つまむ・2 本で動かすのは 2 本以上置いてどれかの指が 7 px 動いたときから（その時に置いてある指はどれもタップにしない）。
    //   タップが 1 つ決まったら、その間置いてあったほかの指もタップにしない（2 本指のタップで 2 回にならない）
    const T = f.touch = { ptrs: new Map(), pinch: null };
    const ptrs = T.ptrs;
    const target = f.view;
    on(target, 'pointerdown', (e) => {
      if (e.preventDefault) e.preventDefault();
      if (!f.open) return;
      try { target.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: Minimap.evTime(e), moved: false, noTap: false });
      T.pinch = null; // 指の数が変わった: つまむのは次に動いたところから
    });
    on(target, 'pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      if (e.preventDefault) e.preventDefault();
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 7) p.moved = true;
      if (ptrs.size >= 2) {
        if (!T.pinch) {
          if (!p.moved) return; // 置いてあるだけの指・タップの指の小さな揺れでは地図を動かさない
          for (const q of ptrs.values()) q.noTap = true;
          T.pinch = this._pinchState(ptrs);
          return;
        }
        const now = this._pinchState(ptrs);
        if (T.pinch.d > 1) this._zoomAt(now.mx, now.my, now.d / T.pinch.d);
        f.cx -= (now.mx - T.pinch.mx) / f.ppm; f.cz -= (now.my - T.pinch.my) / f.ppm;
        T.pinch = now;
      } else if (p.moved) { f.cx -= dx / f.ppm; f.cz -= dy / f.ppm; }
      else return;
      this._clampFull(); f.dirty = true;
    });
    const up = (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      T.pinch = null;
      // 復活の場所を選ぶときは pickTapMs: 長押しの意味は無く、開いた直後の重いフレームで指を上げたのが遅れて届いても拾う
      const win = this.pick ? (this.pick.cfg.pickTapMs || 450) : 450;
      if (!f.open || p.moved || p.noTap || Minimap.evTime(e) - p.t >= win) return;
      for (const q of ptrs.values()) q.noTap = true;
      this._tapAt(e.clientX, e.clientY);
    };
    on(target, 'pointerup', up);
    on(target, 'pointercancel', (e) => { ptrs.delete(e.pointerId); T.pinch = null; });
    on(target, 'wheel', (e) => {
      if (e.preventDefault) e.preventDefault();
      const r = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0 };
      this._zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -e.deltaY));
      this._clampFull(); f.dirty = true;
    });
    if (typeof window !== 'undefined' && window.addEventListener) {
      this._onKey = (e) => { if (f.open && e.code === 'Escape') this.closeFull(); };
      window.addEventListener('keydown', this._onKey);
    }
  }

  _listen(el, ev, fn) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(ev, fn);
    this._dom.push([el, ev, fn]);
  }

  _pinchState(ptrs) {
    const a = Array.from(ptrs.values());
    const r = this.full.view && this.full.view.getBoundingClientRect ? this.full.view.getBoundingClientRect() : { left: 0, top: 0 };
    return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx: (a[0].x + a[1].x) / 2 - r.left, my: (a[0].y + a[1].y) / 2 - r.top };
  }

  // 画面の (sx, sy) を中心に k 倍
  _zoomAt(sx, sy, k) {
    const f = this.full;
    const wx = f.cx + (sx - f.w / 2) / f.ppm, wz = f.cz + (sy - f.h / 2) / f.ppm;
    const fit = this._fitPpm();
    f.ppm = Math.max(fit, Math.min(1.5, f.ppm * k));
    f.cx = wx - (sx - f.w / 2) / f.ppm; f.cz = wz - (sy - f.h / 2) / f.ppm;
  }
  _fitPpm() { const b = this.bounds, f = this.full; return Math.min((f.w || 844) / (b.maxX - b.minX), (f.h || 390) / (b.maxZ - b.minZ)) * 0.98; }
  _clampFull() {
    const f = this.full, b = this.bounds;
    const hw = f.w / 2 / f.ppm, hh = f.h / 2 / f.ppm;
    const cxMin = b.minX + Math.min(hw, (b.maxX - b.minX) / 2), cxMax = b.maxX - Math.min(hw, (b.maxX - b.minX) / 2);
    const czMin = b.minZ + Math.min(hh, (b.maxZ - b.minZ) / 2), czMax = b.maxZ - Math.min(hh, (b.maxZ - b.minZ) / 2);
    f.cx = Math.max(cxMin, Math.min(cxMax, f.cx)); f.cz = Math.max(czMin, Math.min(czMax, f.cz));
  }

  _tapAt(clientX, clientY) {
    const f = this.full, play = this.game.play;
    const r = f.view && f.view.getBoundingClientRect ? f.view.getBoundingClientRect() : { left: 0, top: 0 };
    const sx = clientX - r.left, sy = clientY - r.top;
    const x = f.cx + (sx - f.w / 2) / f.ppm, z = f.cz + (sy - f.h / 2) / f.ppm;
    if (this.pick) { f.dirty = true; return this._pickTap(x, z); }
    if (!play) return;
    const wp = play.waypoint;
    if (wp && Math.hypot((wp.x - x) * f.ppm, (wp.z - z) * f.ppm) < 18) play.setWaypoint(null);
    else play.setWaypoint(Math.round(x), Math.round(z));
    f.dirty = true;
  }

  toggleFull() { if (this.full.open) this.closeFull(); else this.openFull(); }

  openFull() {
    const f = this.full;
    if (!f.el || f.open) return;
    f.open = true;
    if (f.touch) { f.touch.ptrs.clear(); f.touch.pinch = null; }
    f.el.classList.remove('hidden');
    if (this.game.hud.root.classList) this.game.hud.root.classList.add('map-open');
    this._resize();
    // 全体が見える縮尺で、自分のいる方へ少し寄せる
    const st = this._state();
    f.ppm = this._fitPpm() * 1.0;
    f.cx = st.x; f.cz = st.z;
    this._clampFull();
    f.dirty = true;
    this._overviewCanvas();
    if (typeof document !== 'undefined' && document.exitPointerLock && document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { /* 無視 */ } }
    this._drawFull(st);
  }

  closeFull() {
    const f = this.full;
    if (!f.open) return;
    f.open = false;
    // 置いたままの指は忘れる（「ここで復活」・M・Esc で閉じた後に上げた指が目印のタップにならない）
    if (f.touch) { f.touch.ptrs.clear(); f.touch.pinch = null; }
    if (f.el) f.el.classList.add('hidden');
    if (this.game.hud.root.classList) this.game.hud.root.classList.remove('map-open');
    // 復活の場所を選んでいた: 「ここで復活」で閉じた（done）のでなければ取りやめ（「戻る」・Esc・M・死んだ）
    if (this.pick) {
      const p = this.pick;
      this.pick = null;
      if (f.el && f.el.classList) f.el.classList.remove('pick');
      this._pickUi('');
      if (!p.done && p.onCancel) p.onCancel();
    }
  }

  // ---------- 復活する場所を地図で選ぶ（respawn.js）----------
  //   opts: { centre / death: { x, z }（真ん中・赤い ✕）, ppm（屋上が見える縮尺。全体が入る縮尺〜1.5 px/m）, cfg（pickBadTime）,
  //           onTap(x, z, ppm) → { ok, x, z, kind }（coarseSnap）, onCancel() }。タップは目印の代わりに onTap、緑の輪 = 出られる所・赤い ✕ = 出られない
  openPick(opts) {
    const f = this.full;
    if (!f.el) return false;
    if (f.open) this.closeFull();
    this.openFull();
    if (!f.open) return false;
    this.pick = { onTap: opts.onTap, onCancel: opts.onCancel, mark: null, bad: null, done: false, death: opts.death || null, cfg: opts.cfg || {} };
    if (f.el.classList) f.el.classList.add('pick');
    const c = opts.centre || opts.death;
    f.ppm = Math.max(this._fitPpm(), Math.min(1.5, opts.ppm || 0.5));
    if (c) { f.cx = c.x; f.cz = c.z; }
    this._clampFull();
    f.dirty = true;
    this._pickUi('');
    this._drawFull(this._state());
    return true;
  }
  _pickTap(x, z) {
    const P = this.pick;
    const res = P.onTap ? P.onTap(x, z, this.full.ppm) : null;
    if (res && res.ok) { P.mark = { x: res.x, z: res.z, kind: res.kind }; P.bad = null; this._pickUi(''); }
    else { P.mark = null; P.bad = { x, z, t: Minimap.now() }; this._pickUi('ここには出られません'); }
    return res;
  }
  _pickUi(msg) {
    const f = this.full;
    if (f.msg && f.msg.textContent !== msg) f.msg.textContent = msg;
    if (f.spawnBtn && f.spawnBtn.classList) f.spawnBtn.classList.toggle('off', !(this.pick && this.pick.mark));
  }
  // 選ぶ地図の印の画面の箱（地名をずらす: _overlay の marks）。_drawPick と同じ大きさ
  _pickRects(toS) {
    const P = this.pick, q = { x: 0, y: 0 }, out = [];
    const sq = (x, y, s) => out.push({ x0: x - s, x1: x + s, y0: y - s, y1: y + s });
    if (P.death) { toS(P.death.x, P.death.z, q); sq(q.x, q.y, 10); }
    if (P.bad && Minimap.now() - P.bad.t < (P.cfg.pickBadTime || 1.5) * 1000) { toS(P.bad.x, P.bad.z, q); sq(q.x, q.y, 14); }
    if (P.mark) {
      toS(P.mark.x, P.mark.z, q); sq(q.x, q.y, 17);
      const label = Minimap.PICK_LABEL[P.mark.kind] || '';
      if (label) { const tw = label.length * 13 + 8; out.push({ x0: q.x - tw / 2, x1: q.x + tw / 2, y0: q.y - 17 - 16, y1: q.y - 15 }); }
    }
    return out;
  }
  _drawPick(ctx, toS) {
    const P = this.pick, q = { x: 0, y: 0 };
    const cross = (x, y, s, col) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
    };
    if (P.death) { toS(P.death.x, P.death.z, q); cross(q.x, q.y, 6, '#ff6b78'); }
    if (P.bad && Minimap.now() - P.bad.t < (P.cfg.pickBadTime || 1.5) * 1000) { toS(P.bad.x, P.bad.z, q); cross(q.x, q.y, 10, '#ff4d5e'); }
    if (P.mark) {
      toS(P.mark.x, P.mark.z, q);
      ctx.fillStyle = 'rgba(80,230,140,0.25)'; ctx.strokeStyle = '#5ef59a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(q.x, q.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5ef59a'; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill();
      const label = Minimap.PICK_LABEL[P.mark.kind] || '';
      if (label) {
        ctx.font = '700 13px "Hiragino Sans", "Noto Sans JP", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(8,12,18,0.9)'; ctx.lineWidth = 4;
        ctx.strokeText(label, q.x, q.y - 17); ctx.fillStyle = '#c9ffd9'; ctx.fillText(label, q.x, q.y - 17);
      }
    }
  }

  _drawFull(st) {
    const f = this.full, ctx = f.ctx;
    if (!ctx) return;
    const t0 = Minimap.now();
    f.dirty = false;
    const dpr = this.dpr, w = f.w, h = f.h, ppm = f.ppm;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1f2c';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2); ctx.scale(ppm, ppm); ctx.translate(-f.cx, -f.cz);
    const b = this.bounds;
    const ov = this._overviewCanvas();
    if (ov) ctx.drawImage(ov, b.minX, b.minZ, ov.width * this.cfg.overviewRes, ov.height * this.cfg.overviewRes);
    // 拡大したら細かいタイル（1 フレームに 1 枚まで作る。できるまで全体図）
    if (ppm * dpr > 1 / this.cfg.overviewRes * 1.6) {
      const M = this.cfg.tileSize * this.cfg.tileRes;
      const x0 = f.cx - w / 2 / ppm, x1 = f.cx + w / 2 / ppm, z0 = f.cz - h / 2 / ppm, z1 = f.cz + h / 2 / ppm;
      for (let tz = Math.max(0, Math.floor((z0 - b.minZ) / M)); tz <= Math.floor((z1 - b.minZ) / M); tz++) {
        for (let tx = Math.max(0, Math.floor((x0 - b.minX) / M)); tx <= Math.floor((x1 - b.minX) / M); tx++) {
          if (tx * M >= b.maxX - b.minX || tz * M >= b.maxZ - b.minZ) continue;
          const c = this._tile(tx, tz, false);
          if (c) ctx.drawImage(c, b.minX + tx * M, b.minZ + tz * M, M, M); else f.dirty = true;
        }
      }
    }
    ctx.restore();
    const toS = (x, z, out) => { out.x = w / 2 + (x - f.cx) * ppm; out.y = h / 2 + (z - f.cz) * ppm; return out; };
    this._overlay(ctx, st, toS, ppm, w, h, true, null, this.pick ? this._pickRects(toS) : null);
    const q = toS(st.x, st.z, { x: 0, y: 0 });
    if (this.pick) this._drawPick(ctx, toS); // 死んでいる: 自分の矢印の代わりに ✕ と選んだ所
    else this._arrow(ctx, q.x, q.y, -st.yaw, 9);
    // 縮尺（100 m / 1 km）
    const m = ppm * 1000 > 160 ? 100 : 1000, len = m * ppm;
    ctx.fillStyle = 'rgba(232,238,244,0.85)';
    ctx.fillRect(14, h - 22, len, 2);
    ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(m >= 1000 ? '1 km' : m + ' m', 14, h - 26);
    const ms = Minimap.now() - t0;
    this.stats.fullDraws++; this.stats.fullMs = ms;
  }

  dispose() {
    this.closeFull();
    if (this._onResize && typeof window !== 'undefined') window.removeEventListener('resize', this._onResize);
    if (this._onKey && typeof window !== 'undefined') window.removeEventListener('keydown', this._onKey);
    for (const [el, ev, fn] of this._dom) { if (el.removeEventListener) el.removeEventListener(ev, fn); }
    this._dom.length = 0;
    for (const t of this.tiles.values()) { t.canvas.width = t.canvas.height = 1; }
    this.tiles.clear();
    if (this.canvas && this.canvas.parentNode && this.canvas.parentNode.removeChild) this.canvas.parentNode.removeChild(this.canvas);
    if (this.full.canvas && this.full.canvas.parentNode && this.full.canvas.parentNode.removeChild) this.full.canvas.parentNode.removeChild(this.full.canvas);
  }
};
