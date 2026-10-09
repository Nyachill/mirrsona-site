// 戦闘機の HUD（MR.JetHUD）。画面いっぱいの <canvas id="jet-hud">（pointer-events なし）に 2D で描く。
//   一人称（操縦席）: 緑のヘッドアップディスプレイ（ピッチラダー・方位のテープ・速度 km/h・高度 m・推力 %・AB・G・脚 / フック・
//     機関砲の照準（収束点）・速度ベクトル・見ている向き（操縦の目標）・失速 / 引き起こせ・空母に近いと着艦の誘導）。
//   3 人称（チェイス）: 白い簡単な表示（画面の中心が操縦の目標、機首の向き・照準・速度・高度・推力・警告）。
//   draw(info) は毎フレーム呼んでよい（隠れているときは何もしない）。info:
//     { jet（MR.Jet）, camera（THREE.Camera。投影に使う）, chase, aim（世界の向き。手動なら null）, gunPoint（収束点の世界座標）,
//       ammo, maxAmmo, asl（海抜 m）, agl（地面から m）, prompt（文字。カタパルトなど）, approach（{ dist, dev, lat, point }。着艦の誘導）,
//       warn（'失速' など）, bounds（地図の端）, hint（説明の行の配列。初めて乗ったとき）,
//       scheme（'easy' | 'aim' | 'manual'）, lock（{ point, locked, k, dist }。ミサイルのロック）, missiles / flares（残り）,
//       gfx（大きな G の見た目 0..1: 画面の端を暗く）}。G は荷重倍数で、gEffect.warnG / hotG で色が変わる（「G 120」）
//     prompt は \n で 2 行目以降（小さい字）
// 文字は日本語（「速度」「高度」「推力」「失速」「引き起こせ」「脚」「フック」「機銃」）。iPad で読める大きさ、線は 1.5〜2 px
window.MR = window.MR || {};

MR.JetHUD = class JetHUD {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    this.visible = false;
    this.w = 0; this.h = 0; this.dpr = 1;
    this._v = null; this._v2 = null;
    this.stats = { frames: 0, ms: 0 };
    this.reset();
  }

  // 隠して消す（#jet-hud は「もう一度」の前後のゲームで共有。前のゲームの最後の 1 枚を残さない）
  reset() {
    this.visible = false;
    const c = this.canvas;
    if (c && c.classList) c.classList.add('hidden');
    if (this.ctx && c && c.width) {
      if (this.ctx.setTransform) this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, c.width, c.height);
    }
  }

  show(on) {
    on = !!on;
    if (on === this.visible) return;
    this.visible = on;
    if (this.canvas && this.canvas.classList) this.canvas.classList.toggle('hidden', !on);
    if (!on && this.ctx && this.w) this.ctx.clearRect(0, 0, this.w, this.h);
  }

  _resize() {
    const c = this.canvas;
    const W = (typeof window !== 'undefined' && window.innerWidth) || 844, H = (typeof window !== 'undefined' && window.innerHeight) || 390;
    const dpr = Math.min(1.5, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (W === this.cw && H === this.ch && dpr === this.dpr) return;
    this.cw = W; this.ch = H; this.dpr = dpr;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    if (c.style) { c.style.width = W + 'px'; c.style.height = H + 'px'; }
    this.w = W; this.h = H;
  }

  // 世界の点 → 画面（CSS px）。カメラの後ろなら null
  _project(p, cam, out) {
    const v = this._v || (this._v = new THREE.Vector3());
    v.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.1) return null;
    v.applyMatrix4(cam.projectionMatrix);
    out.x = (v.x + 1) / 2 * this.w; out.y = (1 - v.y) / 2 * this.h;
    return out;
  }
  // 世界の向き → 画面（無限遠の点）
  _projectDir(d, cam, out) {
    const v = this._v2 || (this._v2 = new THREE.Vector3());
    const e = cam.matrixWorld.elements;
    v.set(e[12] + d.x * 1000, e[13] + d.y * 1000, e[14] + d.z * 1000);
    return this._project(v, cam, out);
  }

  draw(info) {
    if (!this.visible || !this.ctx || !info || !info.jet || !info.camera) return;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    this._resize();
    const ctx = this.ctx, W = this.w, H = this.h, J = info.jet, cam = info.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const chase = !!info.chase;
    const col = chase ? 'rgba(240,248,255,0.92)' : 'rgba(125,255,154,0.92)';
    const dim = chase ? 'rgba(240,248,255,0.72)' : 'rgba(125,255,154,0.7)';
    const warnCol = 'rgba(255,82,82,0.95)';
    const S = Math.min(W, H);
    const fs = Math.round(Math.max(12, Math.min(18, S * 0.034)));
    ctx.lineWidth = Math.max(1.5, S / 420);
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.font = '600 ' + fs + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.textBaseline = 'middle';
    if (chase) { ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 3; } else { ctx.shadowBlur = 0; }
    cam.updateMatrixWorld();
    const cx = W / 2, cy = H / 2;
    const P = { x: 0, y: 0 };
    J.axes();
    const fwd = J._fwd;
    const boxW = fs * 4.6, boxH = fs * 1.9;
    const L = this._layout(W, H, S, cx, cy, fs, boxW, boxH, chase);
    const lx = L.lx, rx = L.rx, ry0 = L.ry;
    // 右の列の文字（機銃・ミサイル / フレア・脚・フック。右揃えで箱より左へはみ出す）の場所: ラダー・ロックの文字はここに描かない
    const ry = ry0 + boxH * 2.05;
    const airInfo = J.mode === 'air' && info.missiles != null;
    const wInfo = Math.max(ctx.measureText ? ctx.measureText('機銃 ' + (info.ammo != null ? info.ammo : J.ammo)).width : fs * 4,
      airInfo && ctx.measureText ? ctx.measureText('ミサイル ' + info.missiles + '  フレア ' + info.flares).width : 0);
    const infoR = this._infoR || (this._infoR = [0, 0, 0, 0]);
    infoR[0] = rx + boxW / 2 - wInfo - 6; infoR[1] = ry - fs * 0.8; infoR[2] = rx + boxW / 2 + 4; infoR[3] = ry + fs * (airInfo ? 4.05 : 2.7) + fs * 0.8;
    // 照準（機銃の弾が集まる所）: ラダーの数字をその上に描かない
    const pip = info.gunPoint && this._project(info.gunPoint, cam, P) ? (this._pip || (this._pip = { x: 0, y: 0 })) : null;
    if (pip) { pip.x = P.x; pip.y = P.y; }
    // --- ピッチラダー（一人称。左右は速度・高度の箱の内側まで、右の列の文字を除く）---
    if (!chase) this._ladder(ctx, J, cam, cx, cy, S, col, dim, fs, L, infoR, pip);
    // --- 方位のテープ（上）---
    this._heading(ctx, J, W, H, S, col, dim, fs);
    // --- 速度（左）・高度（右）---
    const kmh = Math.round(J.speed * 3.6);
    this._box(ctx, lx - boxW / 2, cy - boxH / 2, boxW, boxH, '速度', String(kmh), 'km/h', fs, col, dim, J.stall ? warnCol : null);
    const alt = Math.round(info.asl || 0);
    this._box(ctx, rx - boxW / 2, ry0 - boxH / 2, boxW, boxH, '高度', String(alt), 'm', fs, col, dim, info.warn === '引き起こせ' ? warnCol : null);
    ctx.textAlign = 'center';
    if (info.agl != null && info.agl < 600 && J.mode === 'air') { ctx.fillStyle = dim; ctx.fillText('R ' + Math.round(info.agl), rx, ry0 + boxH * 1.2); ctx.fillStyle = col; }
    // --- 推力・AB・G（左下。スティックの右。低い画面（スマホの横）は速度の箱の上: 親指のスティックの下にならない）・機銃・脚・フック（高度の箱の下）---
    //  低い画面で初めての説明を出している間は推力を描かない（説明がその場所を使う）
    const LB = this.lastBoxes || (this.lastBoxes = {});
    LB.thrust = null; LB.prompt = null; LB.hint = null; LB.lock = null; LB.info = null; LB.glide = null;
    // 速度・高度の箱と右の列の 1 行ずつの文字の場所（CSS px）: 案内の板をここに重ねない（スマホの横で自動着陸の長い案内の板の
    //  右上の角が「脚 …」の行にかかっていた）。テストも見る（lastBoxes.rows）
    const rows = LB.rows || (LB.rows = []);
    rows.length = 0;
    const pushRow = (x0, y0, x1, y1) => { rows.push([x0, y0, x1, y1]); };
    const textRow = (txt, xr, y, f) => { const w = ctx.measureText ? ctx.measureText(txt).width : f * txt.length; pushRow(xr - w, y - f * 0.9, xr, y + f * 0.3); };
    pushRow(lx - boxW / 2, cy - boxH / 2 - fs * 1.1, lx + boxW / 2, cy + boxH / 2 + fs * 1.1);
    pushRow(rx - boxW / 2, ry0 - boxH / 2 - fs * 1.1, rx + boxW / 2, ry0 + boxH / 2 + fs * 1.1);
    const thrOn = !(L.low && info.hint && info.hint.length);
    const by = L.ty;
    const thrPct = Math.round(J.throttle * 100);
    const tx0 = L.tx;
    if (thrOn) {
      ctx.textAlign = 'left';
      ctx.fillText('推力 ' + thrPct + '%', tx0, by);
      if (J.ab > 0.05) { ctx.fillStyle = 'rgba(255,170,60,0.95)'; ctx.fillText('AB', tx0 + fs * 5.6, by); ctx.fillStyle = col; }
      // G: 大きいほど色を変える（gEffect.warnG で黄、hotG で赤）。9 G を超えたら整数で大きく「G 120」
      const GE = (J.def && J.def.gEffect) || { warnG: 30, hotG: 120 };
      const gv = Math.abs(J.gload);
      ctx.fillStyle = gv >= GE.hotG ? 'rgba(255,82,82,0.98)' : (gv >= GE.warnG ? 'rgba(255,207,74,0.98)' : col);
      if (gv > 9) { ctx.font = '700 ' + Math.round(fs * 1.25) + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; ctx.fillText('G ' + Math.round(J.gload), tx0, by + fs * 1.45); ctx.font = '600 ' + fs + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; }
      else ctx.fillText('G ' + J.gload.toFixed(1), tx0, by + fs * 1.35);
      ctx.fillStyle = col;
      // 推力のバー
      ctx.strokeStyle = dim;
      ctx.strokeRect(tx0, by - fs * 1.4, boxW, fs * 0.45);
      ctx.fillStyle = J.ab > 0.05 ? 'rgba(255,170,60,0.9)' : col;
      ctx.fillRect(tx0, by - fs * 1.4, boxW * Math.min(1, J.throttle), fs * 0.45);
      // 描いた文字の場所（CSS px。テストがボタン・スティックと重ならないか見る）
      LB.thrust = [tx0, by - fs * 1.4, tx0 + Math.max(boxW, fs * 7.2), by + fs * 1.35 + fs * 0.6];
    }
    ctx.fillStyle = col; ctx.strokeStyle = col;
    ctx.textAlign = 'right';
    LB.info = infoR;
    if (info.agl != null && info.agl < 600 && J.mode === 'air') { const tw = ctx.measureText ? ctx.measureText('R ' + Math.round(info.agl)).width : fs * 3; pushRow(rx - tw / 2, ry0 + boxH * 1.2 - fs * 0.9, rx + tw / 2, ry0 + boxH * 1.2 + fs * 0.3); }
    const gunTxt = '機銃 ' + (info.ammo != null ? info.ammo : J.ammo);
    textRow(gunTxt, rx + boxW / 2, ry, fs);
    ctx.fillText(gunTxt, rx + boxW / 2, ry);
    // ミサイル・フレアの残り（空中）
    let ry2 = ry;
    if (J.mode === 'air' && info.missiles != null) {
      ry2 += fs * 1.35; const mTxt = 'ミサイル ' + info.missiles + '  フレア ' + info.flares; textRow(mTxt, rx + boxW / 2, ry2, fs); ctx.fillText(mTxt, rx + boxW / 2, ry2);
    }
    const gearTxt = J.gearPos > 0.98 ? '脚 ↓' : (J.gearPos < 0.02 ? '' : '脚 …');
    //  脚の行は「脚 …」と「脚 ↓」の広い方の場所（下ろしている途中で案内の板が動かない）
    if (gearTxt) { textRow(J.gearPos > 0.98 || !ctx.measureText || ctx.measureText('脚 ↓').width >= ctx.measureText('脚 …').width ? '脚 ↓' : '脚 …', rx + boxW / 2, ry2 + fs * 1.35, fs); ctx.fillStyle = J.gearPos > 0.98 ? col : 'rgba(255,207,74,0.95)'; ctx.fillText(gearTxt, rx + boxW / 2, ry2 + fs * 1.35); ctx.fillStyle = col; }
    if (J.hookDown) { textRow('フック', rx + boxW / 2, ry2 + fs * 2.7, fs); ctx.fillText('フック', rx + boxW / 2, ry2 + fs * 2.7); }
    // --- 機首の向き（×）・速度ベクトル（○）・照準・操縦の目標 ---
    //  （上の方位のテープ・「撃破」の所（テープの数字の下まで）には描かない: 甲板で下を向いた機体の照準がテープに重なっていた）
    const symTop = this._tapeY(fs) + fs * 2.2;
    if (this._projectDir(fwd, cam, P) && P.y > symTop) this._nose(ctx, P.x, P.y, S, col);
    if (!chase && J.mode === 'air' && J.speed > 20) {
      const vd = this._v3 || (this._v3 = new THREE.Vector3());
      vd.copy(J.vel).normalize();
      if (this._projectDir(vd, cam, P) && P.y > symTop) this._fpm(ctx, P.x, P.y, S, col);
    }
    if (pip && pip.y > symTop) this._pipper(ctx, pip.x, pip.y, S, col, info.firing);
    if (info.aim) {
      if (chase) this._aim(ctx, cx, cy, S, col);
      else if (this._projectDir(info.aim, cam, P) && P.y > symTop) this._aim(ctx, P.x, P.y, S, col);
    }
    // ロック（目標を四角で囲む）は案内・説明の板の後で描く（文字を板・右の列に重ねない）
    const lockAt = info.lock && this._project(info.lock.point, cam, P) ? (this._lockP || (this._lockP = { x: 0, y: 0 })) : null;
    if (lockAt) { lockAt.x = P.x; lockAt.y = P.y; }
    // --- 大きな G の見た目（画面の端を暗く。操縦は変わらない）---
    if (info.gfx > 0.02) {
      const GE = (J.def && J.def.gEffect) || { vignette: 0.5 };
      const g = ctx.createRadialGradient(cx, cy, S * 0.35, cx, cy, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + (Math.min(1, info.gfx) * GE.vignette).toFixed(3) + ')');
      const sb0 = ctx.shadowBlur; ctx.shadowBlur = 0;
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.shadowBlur = sb0; ctx.fillStyle = col;
    }
    // --- 警告・案内 ---
    ctx.textAlign = 'center';
    const flash = (J.time % 0.6) < 0.4;
    let wy = cy - S * 0.2;
    LB.warn = null;
    if (info.warn) {
      // 点滅で消えている間も場所は取っておく（着艦の横のバーが点滅に合わせて動かない）。lastBoxes.warn
      ctx.font = '700 ' + Math.round(fs * 1.5) + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
      const ww = ctx.measureText ? ctx.measureText(info.warn).width : fs * 1.5 * info.warn.length;
      const wb = this._warnBox || (this._warnBox = [0, 0, 0, 0]);
      wb[0] = cx - ww / 2; wb[1] = wy - fs * 0.9; wb[2] = cx + ww / 2; wb[3] = wy + fs * 0.9;
      LB.warn = wb;
      if (flash) { ctx.fillStyle = warnCol; ctx.fillText(info.warn, cx, wy); }
      ctx.font = '600 ' + fs + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
      ctx.fillStyle = col;
    }
    if (info.prompt) {
      // 1 行目は大きく、\n の後（2 行目〜）は小さく下へ。画面の幅に入らなければ縮める。後ろに暗い板（ラダー・機体の上でも読める）
      const lines = String(info.prompt).split('\n');
      const P0 = this._promptFit(ctx, lines, L.prompt, fs, rows, H);
      this.lastBoxes.prompt = this._panel(ctx, lines, P0.x, P0.y, P0.w, fs, 'rgba(255,207,74,0.98)', true);
    }
    // 初めて乗ったときの説明（方位のテープの下、白。後ろに暗い板）
    //  低い画面（スマホの横）は 2 行まで（3 行の板がピッチラダーの上半分を隠していた）
    if (info.hint && info.hint.length) this.lastBoxes.hint = this._panel(ctx, L.low && info.hint.length > 2 ? info.hint.slice(0, 2) : info.hint, L.hintX, L.hintY, L.hintW, fs, 'rgba(255,255,255,0.96)', false);
    // --- 着艦の誘導（案内・説明の板の後: 左右の横のバーを板・推力・右の列・ボタンにかからない高さへ置く。lastBoxes.glide / lat）---
    //  （以前は板より先に cy + S × 0.3 へ描き、自動着艦の最終進入で横の線が案内の 2 行目「左スティックを倒すと解除」を横切っていた）
    LB.lat = null; LB.latHidden = false;
    if (info.approach) this._approach(ctx, info.approach, cam, cx, cy, S, col, dim, fs, L, rows, infoR, symTop);
    // ロック: 四角（ロック中は赤く「ロック」、探している間は点線で縮む）。距離の文字は四角の下・上・右・左の順に、右の列・案内・説明・
    //  推力・速度 / 高度の箱に重ならない所へ（スマホの横で「ロック 289 m」が「ミサイル 4 フレア 30」と案内の板の下に入っていた）
    if (lockAt) {
      const ob = this._lockObs || (this._lockObs = []);
      ob.length = 0;
      const bS = this._lbS || (this._lbS = [0, 0, 0, 0]), bA = this._lbA || (this._lbA = [0, 0, 0, 0]);
      bS[0] = lx - boxW / 2; bS[1] = cy - boxH / 2 - fs * 1.2; bS[2] = lx + boxW / 2; bS[3] = cy + boxH / 2 + fs * 1.2;
      bA[0] = rx - boxW / 2; bA[1] = cy - boxH / 2 - fs * 1.2; bA[2] = rx + boxW / 2; bA[3] = cy + boxH * 1.2 + fs * 0.8;
      //  右下のボタンの列（右から 280 px・下から 262 px。_layout と同じ）と左下の撃つボタン・スティックの所も避ける
      const bB = this._lbB || (this._lbB = [0, 0, 0, 0]), bL = this._lbL || (this._lbL = [0, 0, 0, 0]);
      bB[0] = this.w - 280; bB[1] = this.h - 262; bB[2] = this.w; bB[3] = this.h;
      bL[0] = 0; bL[1] = this.h - 170; bL[2] = 140; bL[3] = this.h;
      ob.push(LB.info, LB.prompt, LB.hint, LB.thrust, LB.glide, LB.lat, LB.warn, bS, bA, bB, bL);
      this._lockBox(ctx, lockAt.x, lockAt.y, S, fs, info.lock, ob);
    }
    ctx.shadowBlur = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stats.frames++;
    if (t0) this.stats.ms += ((performance.now() - t0) - this.stats.ms) * 0.05;
  }

  // 置き場所（CSS px）。ボタン（style.css）の場所を避ける: 右下のボタンの列（右から 280 px・下から 262 px）、左下のスティック
  //  （左 22〜134 px・下から 48〜160 px）、左の撃つボタン（左 30〜102 px）。速度の箱は左、高度の箱は右（ボタンの列の左）。
  //  狭い画面（右に箱が入らない）では高度の箱も左（速度の箱の右隣）。tx = 左下の推力・G の左端
  _layout(W, H, S, cx, cy, fs, boxW, boxH, chase) {
    const out = this._lay || (this._lay = { lx: 0, rx: 0, ry: 0, tx: 0, ty: 0, glideX: 0, latW: 0, hintX: 0, hintY: 0, hintW: 0, prompt: { x: 0, y: 0, w: 0 } });
    let lx = chase ? W * 0.2 : cx - S * 0.42, rx = chase ? W * 0.8 : cx + S * 0.42;
    const btnL = W - 280, btnTop = H - 262;
    const colBottom = cy + boxH * 2.05 + fs * 4.6; // 右の列（高度・R・機銃・脚・フック）の下の端
    lx = Math.max(lx, 110 + boxW / 2);
    if (colBottom > btnTop && rx + boxW / 2 > btnL) {
      rx = btnL - boxW / 2;
      if (rx - boxW / 2 < cx + S * 0.12) { rx = lx + boxW + fs * 1.4; } // 右に入らない: 速度の箱の右隣
    }
    out.lx = lx; out.rx = rx; out.ry = cy;
    // ピッチラダーを描いてよい左右（箱の内側。狭くて高度の箱が左にあるときはその右から）
    const inner = Math.max(lx, rx) === rx && rx > cx ? rx - boxW / 2 - 6 : cx + S * 0.36;
    out.clipL = Math.max(cx - S * 0.36, Math.max(lx, rx < cx ? rx : lx) + boxW / 2 + 6);
    out.clipR = Math.min(cx + S * 0.36, inner);
    // 推力・G: 高い画面は左下（スティックの右・下から）。低い画面（H < 560: スマホの横）は親指の届く所が画面の下半分の全部なので、
    //  速度の箱の上（「速度」の文字の上）へ
    const low = H < 560;
    out.tx = low ? lx - boxW / 2 : Math.max(lx - boxW / 2, 146);
    out.ty = low ? cy - boxH / 2 - fs * 3.6 : H - fs * (chase ? 5.2 : 4.4); // 低い画面: 大きな「G 120」が「速度」の見出しにかからない
    // 案内（黄色）: 画面の中央の下。右下のボタンの列（右から 280 px・下から 262 px）にかかる高さなら、左のスティック（低い画面は
    //  親指の場所 = 左 180 px まで）とボタンの列の間に収める
    let py = cy + S * 0.26, px = cx, pw = W * 0.92;
    if (py + fs * 1.4 > H - 262) { const l0 = low ? 180 : 150, r0 = Math.max(l0 + 200, W - 280); px = (l0 + r0) / 2; pw = r0 - l0; }
    out.prompt.x = px; out.prompt.y = py; out.prompt.w = pw;
    // 初めての説明: 方位のテープの下。低い画面は推力の右から右上の地図の左まで（推力の文字に重ねない）
    out.hintY = cy - S * 0.21;
    //  低い画面: 左の撃つボタン（左 30〜102 px）の右から発艦ボタン（右から 236 px）の左まで。推力の文字はその間（10 秒）描かない
    out.low = low;
    if (low && W - 245 - 112 >= 300) { const l0 = 112, r0 = W - 245; out.hintX = (l0 + r0) / 2; out.hintW = r0 - l0; }
    else { out.hintX = cx; out.hintW = W * 0.9; }
    out.glideX = rx > cx ? Math.min(cx + S * 0.28, rx - boxW / 2 - 14) : cx + S * 0.28;
    // ラダーの横線の長さ（数字が箱・着艦の縦のバーにかからない）
    out.rung = Math.max(S * 0.06, Math.min(S * 0.13, Math.min(out.glideX, out.clipR) - cx - fs * 2.6, cx - out.clipL - fs * 2.6));
    out.latW = Math.max(30, Math.min(S * 0.22, (colBottom > btnTop ? btnL : W) - cx - 14));
    return out;
  }

  // 案内の板の場所（L.prompt の帯 = 中心 x・幅 w・1 行目の y）を、速度・高度の箱と右の列の文字の行（rows）にかからないように直す。
  //  板が行にかかれば、その行の側の帯の端を行の手前（3 px）まで寄せる（帯の中で中央揃え）。それで 1 行目が元の 8 割より小さく
  //  なるなら、帯はそのままで板をかかった行の下へずらす（画面に入れば）。返すのは { x, y, w }（作り置き）
  _promptFit(ctx, lines, P0, fs, rows, H) {
    const out = this._pfit || (this._pfit = { x: 0, y: 0, w: 0 });
    out.x = P0.x; out.y = P0.y; out.w = P0.w;
    if (!rows || !rows.length) return out;
    const m = 3;
    const hit = (b, q) => b[2] > q[0] - m && b[0] < q[2] + m && b[3] > q[1] - m && b[1] < q[3] + m;
    const full = this._panel(ctx, lines, out.x, out.y, out.w, fs, null, true, true);
    const needW = full[2] - full[0];
    let l = P0.x - P0.w / 2, r = P0.x + P0.w / 2, b = full;
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (let i = 0; i < rows.length; i++) {
        const q = rows[i];
        if (!hit(b, q)) continue;
        if ((q[0] + q[2]) / 2 >= (b[0] + b[2]) / 2) { if (q[0] - m < r) { r = q[0] - m; moved = true; } }
        else if (q[2] + m > l) { l = q[2] + m; moved = true; }
      }
      if (!moved) break;
      out.x = (l + r) / 2; out.w = Math.max(40, r - l);
      b = this._panel(ctx, lines, out.x, out.y, out.w, fs, null, true, true);
    }
    let clear = true;
    for (let i = 0; i < rows.length; i++) if (hit(b, rows[i])) { clear = false; break; }
    if (clear && b[2] - b[0] >= Math.min(needW, P0.w) * 0.8) return out;
    // 狭くなりすぎる / まだかかる: 元の帯のまま、かかっていた行の下へ
    let low = -Infinity;
    for (let i = 0; i < rows.length; i++) if (hit(full, rows[i])) low = Math.max(low, rows[i][3]);
    const dy = low + m + 1 - full[1];
    if (dy > 0 && full[3] + dy <= H - 2) { out.x = P0.x; out.w = P0.w; out.y = P0.y + dy; }
    return out;
  }

  // 文字の行（lines）を (x, y) から下へ中央揃えで、後ろに暗い角丸の板。big なら 1 行目は大きく太く。maxW に入らなければ縮める
  _panel(ctx, lines, x, y, maxW, fs, color, big, measureOnly) {
    const font = (f, b) => (b ? '700 ' : '600 ') + f + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    const rows = [];
    let wMax = 0, hSum = 0;
    for (let i = 0; i < lines.length; i++) {
      const b = big && i === 0;
      let f = Math.round(b ? fs * 1.2 : fs * 0.95);
      ctx.font = font(f, b);
      let w = ctx.measureText ? ctx.measureText(lines[i]).width : 0;
      if (w > maxW) { f = Math.max(10, Math.floor(f * maxW / w)); ctx.font = font(f, b); w = ctx.measureText ? ctx.measureText(lines[i]).width : maxW; }
      rows.push({ f, b, w });
      wMax = Math.max(wMax, w); hSum += f * 1.35;
    }
    const pad = fs * 0.45, top = y - rows[0].f * 0.75 - pad * 0.5;
    if (measureOnly) { ctx.font = font(fs, false); return [x - wMax / 2 - pad, top, x + wMax / 2 + pad, top + hSum + pad]; }
    const sb = ctx.shadowBlur;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const bx = x - wMax / 2 - pad, bw = wMax + pad * 2, bh = hSum + pad, r = Math.min(8, bh / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, top, bw, bh, r); else ctx.rect(bx, top, bw, bh);
    ctx.fill();
    ctx.shadowBlur = sb;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    let yy = y;
    for (let i = 0; i < rows.length; i++) {
      ctx.font = font(rows[i].f, rows[i].b);
      ctx.fillText(lines[i], x, yy);
      yy += rows[i].f * 1.35;
    }
    ctx.font = font(fs, false);
    return [bx, top, bx + bw, top + bh];
  }

  _box(ctx, x, y, w, h, label, value, unit, fs, col, dim, warn) {
    ctx.strokeStyle = warn || col;
    ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'left';
    ctx.fillStyle = dim;
    ctx.font = '600 ' + Math.max(11, Math.round(fs * 0.8)) + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; // 見出し・単位は 11 px 以上
    ctx.fillText(label, x + 2, y - fs * 0.6);
    ctx.textAlign = 'right';
    ctx.fillText(unit, x + w - 2, y + h + fs * 0.6);
    ctx.fillStyle = warn || col;
    ctx.font = '700 ' + Math.round(fs * 1.25) + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillText(value, x + w - 6, y + h / 2);
    ctx.font = '600 ' + fs + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillStyle = col; ctx.strokeStyle = col;
  }

  // ラダーの数字を (x, y) に描いてよいか: 照準（pip）から fs × 1.8 より遠く、右の列の文字の所（excl）にかからない
  _numFree(x, y, fs, pip, excl) {
    if (pip && Math.hypot(x - pip.x, y - pip.y) <= fs * 1.8) return false;
    const hw = fs * 0.85, hh = fs * 0.65;
    return !(excl && x + hw > excl[0] && x - hw < excl[2] && y + hh > excl[1] && y - hh < excl[3]);
  }
  _ladder(ctx, J, cam, cx, cy, S, col, dim, fs, L, excl, pip) {
    const D2R = Math.PI / 180;
    const psi = Math.atan2(J._fwd.x, J._fwd.z);
    const A = { x: 0, y: 0 }, B = { x: 0, y: 0 };
    const d = this._ld || (this._ld = new THREE.Vector3());
    ctx.save();
    ctx.beginPath();
    const top = Math.max(cy - S * 0.36, this._tapeY(fs) + fs * 2.9); // 上の方位のテープ（とその数字）にかからない
    const x0 = L ? L.clipL : cx - S * 0.36, x1 = L ? L.clipR : cx + S * 0.36;
    ctx.rect(x0, top, Math.max(0, x1 - x0), cy + S * 0.36 - top);
    //  右の列の文字（機銃・ミサイル / フレア）の所は描かない（evenodd で穴を開ける）
    if (excl && excl[0] < x1 && excl[2] > x0) { ctx.rect(Math.max(x0, excl[0]), excl[1], Math.min(x1, excl[2]) - Math.max(x0, excl[0]), excl[3] - excl[1]); ctx.clip('evenodd'); }
    else ctx.clip();
    const pitch = Math.asin(Math.max(-1, Math.min(1, J._fwd.y))) / D2R;
    const lo = Math.max(-90, Math.floor((pitch - 35) / 5) * 5), hi = Math.min(90, Math.ceil((pitch + 35) / 5) * 5);
    for (let th = lo; th <= hi; th += 5) {
      const t = th * D2R, c = Math.cos(t);
      d.set(Math.sin(psi) * c, Math.sin(t), Math.cos(psi) * c);
      if (!this._projectDir(d, cam, A)) continue;
      const psi2 = psi + 4 * D2R;
      d.set(Math.sin(psi2) * c, Math.sin(t), Math.cos(psi2) * c);
      if (!this._projectDir(d, cam, B)) continue;
      let ux = B.x - A.x, uy = B.y - A.y;
      const l = Math.hypot(ux, uy) || 1;
      ux /= l; uy /= l;
      // 右（西→東）向きのベクトルの符号を画面の右に合わせる
      const half = th === 0 ? S * 0.33 : (L ? L.rung : S * 0.13), gap = th === 0 ? S * 0.05 : Math.min(S * 0.045, (L ? L.rung : S * 0.13) * 0.35);
      ctx.strokeStyle = th === 0 ? col : (th > 0 ? col : dim);
      ctx.setLineDash(th < 0 ? [6, 5] : []);
      ctx.beginPath();
      ctx.moveTo(A.x - ux * half, A.y - uy * half); ctx.lineTo(A.x - ux * gap, A.y - uy * gap);
      ctx.moveTo(A.x + ux * gap, A.y + uy * gap); ctx.lineTo(A.x + ux * half, A.y + uy * half);
      // 端のひげ（地平線へ向く）
      if (th !== 0) {
        const nx = -uy * (th > 0 ? 1 : -1) * S * 0.018, ny = ux * (th > 0 ? 1 : -1) * S * 0.018;
        ctx.moveTo(A.x - ux * half, A.y - uy * half); ctx.lineTo(A.x - ux * half + nx, A.y - uy * half + ny);
        ctx.moveTo(A.x + ux * half, A.y + uy * half); ctx.lineTo(A.x + ux * half + nx, A.y + uy * half + ny);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (th !== 0) {
        ctx.fillStyle = th > 0 ? col : dim;
        ctx.textAlign = 'center';
        //  数字は照準（pip）の上には描かない
        const ax = A.x + ux * (half + fs * 1.1), ay = A.y + uy * (half + fs * 1.1), bx = A.x - ux * (half + fs * 1.1), by = A.y - uy * (half + fs * 1.1);
        //  右の列の文字の所（excl）に少しでもかかる数字は描かない（半分に切れた数字が文字の横に残っていた）
        if (this._numFree(ax, ay, fs, pip, excl)) ctx.fillText(String(Math.abs(th)), ax, ay);
        if (this._numFree(bx, by, fs, pip, excl)) ctx.fillText(String(Math.abs(th)), bx, by);
      }
    }
    ctx.restore();
    ctx.strokeStyle = col; ctx.fillStyle = col;
  }

  // 方位のテープの高さ（上の「撃破」の札 = 42 px までの下）
  _tapeY(fs) { return Math.max(fs * 3.9, 48 + fs * 1.1); }

  _heading(ctx, J, W, H, S, col, dim, fs) {
    const hdg = J.headingDeg;
    const cx = W / 2, y = this._tapeY(fs), span = S * 0.5, range = 30; // 上の「撃破」の下（街の方位の帯は戦闘機では隠す）
    ctx.textAlign = 'center';
    ctx.strokeStyle = col;
    ctx.beginPath();
    for (let a = Math.ceil((hdg - range) / 5) * 5; a <= hdg + range; a += 5) {
      const x = cx + (a - hdg) / range * span / 2;
      const big = ((a % 10) + 10) % 10 === 0;
      ctx.moveTo(x, y); ctx.lineTo(x, y + (big ? fs * 0.7 : fs * 0.4));
      if (big) { const v = ((a % 360) + 360) % 360; ctx.fillText(String(v / 10 | 0).padStart(2, '0'), x, y - fs * 0.55); }
    }
    ctx.stroke();
    // 今の方位
    ctx.beginPath();
    ctx.moveTo(cx, y + fs * 0.9); ctx.lineTo(cx - fs * 0.4, y + fs * 1.45); ctx.lineTo(cx + fs * 0.4, y + fs * 1.45); ctx.closePath();
    ctx.fill();
    ctx.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, y + fs * 2.2);
  }

  _nose(ctx, x, y, S, col) {
    const r = S * 0.02;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - r * 2, y); ctx.lineTo(x - r * 0.7, y); ctx.lineTo(x - r * 0.35, y + r * 0.6); ctx.lineTo(x, y);
    ctx.lineTo(x + r * 0.35, y + r * 0.6); ctx.lineTo(x + r * 0.7, y); ctx.lineTo(x + r * 2, y);
    ctx.stroke();
  }
  _fpm(ctx, x, y, S, col) {
    const r = S * 0.014;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.moveTo(x - r, y); ctx.lineTo(x - r * 2.6, y);
    ctx.moveTo(x + r, y); ctx.lineTo(x + r * 2.6, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 2);
    ctx.stroke();
  }
  _pipper(ctx, x, y, S, col, firing) {
    const r = S * 0.032;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, firing ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
  _aim(ctx, x, y, S, col) {
    const r = S * 0.022;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 1.6, y); ctx.lineTo(x - r * 1.1, y);
    ctx.moveTo(x + r * 1.1, y); ctx.lineTo(x + r * 1.6, y);
    ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x, y - r * 1.1);
    ctx.stroke();
    ctx.restore();
  }

  _lockBox(ctx, x, y, S, fs, L, obs) {
    const r = S * (L.locked ? 0.035 : 0.035 + 0.04 * (1 - L.k));
    ctx.save();
    ctx.strokeStyle = L.locked ? 'rgba(255,82,82,0.98)' : 'rgba(255,207,74,0.95)';
    ctx.lineWidth = Math.max(2, S / 300);
    if (!L.locked) ctx.setLineDash([6, 4]);
    ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.textAlign = 'center';
    // 距離の文字: 「ロック 240 m」→ 入らなければ「240 m」（四角の赤で locked はわかる）。四角の下・上・右・左・斜め 4 つ、少し離した 4 つの順に
    //  ほかの物（右の列・案内・説明・推力・速度 / 高度の箱・画面の端）に重ならない所。どこにも入らなければ文字は出さない
    //  （前は全部ふさがると下に重ねて描いていた: スマホの横の自動着艦の最終進入で案内の板と「ミサイル 4 フレア 30」の上）
    const dTxt = L.dist >= 1000 ? (L.dist / 1000).toFixed(1) + ' km' : Math.round(L.dist) + ' m';
    const txts = this._lockTxt || (this._lockTxt = ['', '']);
    txts[0] = L.locked ? 'ロック ' + dTxt : dTxt; txts[1] = L.locked ? dTxt : '';
    const h = fs * 1.1, gap = 6;
    const cand = this._lockCand || (this._lockCand = []);
    let tx = 0, ty = 0, tw = 0, txt = null;
    for (const t of txts) {
      if (!t || txt) continue;
      const w = ctx.measureText ? ctx.measureText(t).width : fs * 0.6 * t.length;
      cand.length = 0;
      const dy = r + fs * 0.9, dx = r + w / 2 + gap;
      cand.push(x, y + dy, x, y - dy, x + dx, y, x - dx, y,
        x + dx, y + dy, x - dx, y + dy, x + dx, y - dy, x - dx, y - dy,
        x, y + dy + h * 1.2, x, y - dy - h * 1.2, x + dx + w * 0.6, y, x - dx - w * 0.6, y);
      for (let i = 0; i < cand.length; i += 2) {
        const cx0 = cand[i], cy0 = cand[i + 1];
        const a0 = cx0 - w / 2, a1 = cx0 + w / 2, b0 = cy0 - h / 2, b1 = cy0 + h / 2;
        let hit = a0 < 2 || a1 > this.w - 2 || b0 < 2 || b1 > this.h - 2;
        if (!hit && obs) for (const o of obs) if (o && a0 < o[2] && a1 > o[0] && b0 < o[3] && b1 > o[1]) { hit = true; break; }
        if (!hit) { tx = cx0; ty = cy0; tw = w; txt = t; break; }
      }
    }
    // 文字の後ろに暗い板と縁取り（赤い「ロック 1.2 km」がオレンジ・れんがの建物の上で読めなかった）
    if (txt) {
      const pad = Math.max(3, fs * 0.25), sb = ctx.shadowBlur, fill = ctx.fillStyle;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(tx - tw / 2 - pad, ty - h / 2, tw + pad * 2, h, Math.min(6, h / 2)); else ctx.rect(tx - tw / 2 - pad, ty - h / 2, tw + pad * 2, h);
      ctx.fill();
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fs * 0.18); ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      if (ctx.strokeText) ctx.strokeText(txt, tx, ty);
      ctx.fillStyle = L.locked ? 'rgba(255,110,110,1)' : fill;
      ctx.fillText(txt, tx, ty);
      ctx.shadowBlur = sb;
    }
    if (this.lastBoxes) this.lastBoxes.lock = txt ? [tx - tw / 2, ty - h / 2, tx + tw / 2, ty + h / 2] : null;
    if (this.lastBoxes) this.lastBoxes.lockText = txt;
    ctx.restore();
  }

  // 着艦の誘導の左右の横のバーの高さと半分の長さ。既定は cy + S × 0.3・長さ wMax。そこで案内・説明の板・推力・縦のバー（lastBoxes.glide）・
  //  速度 / 高度の箱と右の列の文字（rows / infoR）・右下のボタンの列（右から 280 px・下から 262 px）・左下のスティック・下の真ん中の
  //  機体の名前と HP（#vehicle-hud）にかかるなら、かかった物の下か上の高さを試す。その高さで横にある物（真ん中 cx より右 / 左）の手前まで
  //  短くしてよい（S × 0.08 以上。スマホの横は右の列が真ん中のすぐ右まで来る）。既定に近く長いものを選ぶ。どこも無ければ描かない
  //  （null。lastBoxes.latHidden）。線・点・下の「着艦 … m」の文字（text = 文字の幅）の場所を lastBoxes.lat に残す（テストが見る）
  _latY(cx, cy, S, wMax, fs, textW, rows, infoR, symTop) {
    const LB = this.lastBoxes || {};
    //  下の文字「着艦 … m」は by + 1.3 fs が中心（textBaseline 'middle'）で、字の下の端は約 + 0.55 fs まで
    const dr = S * 0.012, up = Math.max(6, dr) + 1, dn = textW ? fs * 1.3 + fs * 0.55 : Math.max(6, dr) + 1, gap = 4;
    const wMin = Math.max(30, S * 0.08);
    const obs = this._latObs || (this._latObs = []);
    obs.length = 0;
    for (const k of ['prompt', 'hint', 'thrust', 'glide', 'warn']) if (LB[k]) obs.push(LB[k]);
    if (rows) for (const o of rows) obs.push(o);
    if (infoR) obs.push(infoR);
    const bB = this._latB || (this._latB = [0, 0, 0, 0]), bL = this._latL || (this._latL = [0, 0, 0, 0]);
    bB[0] = this.w - 280; bB[1] = this.h - 262; bB[2] = this.w; bB[3] = this.h;
    bL[0] = 0; bL[1] = this.h - 170; bL[2] = 140; bL[3] = this.h;
    obs.push(bB, bL);
    const vh = this._domBox('vehicle-hud'); // 下の真ん中の機体の名前と HP のバー（DOM）
    if (vh) obs.push(vh);
    const yMin = (symTop || 0) + up, yMax = this.h - 2 - dn;
    // 高さ y で使える半分の長さ（線の端の点の半径・文字の半分の幅も入る）。使えなければ 0
    const widthAt = (y) => {
      if (y < yMin || y > yMax) return 0;
      let hx = Math.min(cx, this.w - cx) - 2;
      for (const o of obs) {
        if (!(o[3] > y - up && o[1] < y + dn)) continue;
        if (o[0] >= cx) hx = Math.min(hx, o[0] - gap - cx);
        else if (o[2] <= cx) hx = Math.min(hx, cx - o[2] - gap);
        else return 0;
      }
      if (textW && hx < textW / 2) return 0;
      const w = Math.min(wMax, hx - dr - 1);
      return w >= wMin ? w : 0;
    };
    const y0 = cy + S * 0.3;
    let by = y0, w = widthAt(y0);
    if (w < wMax) {
      let score = w > 0 ? wMax - w : Infinity;
      for (const o of obs) {
        for (let k = 0; k < 2; k++) { // 物のすぐ下・すぐ上（配列を作らない）
          const y = k ? o[1] - gap - dn : o[3] + gap + up;
          const ww = widthAt(y);
          if (!ww) continue;
          const sc = Math.abs(y - y0) + (wMax - ww);
          if (sc < score) { score = sc; by = y; w = ww; }
        }
      }
    }
    LB.latHidden = !w;
    if (!w) { LB.lat = null; return null; }
    const box = LB.latBox || (LB.latBox = [0, 0, 0, 0]);
    const hx = Math.max(w + dr + 1, textW ? textW / 2 : 0);
    box[0] = cx - hx; box[1] = by - up; box[2] = cx + hx; box[3] = by + dn;
    LB.lat = box;
    const out = this._latOut || (this._latOut = { y: 0, w: 0 });
    out.y = by; out.w = w;
    return out;
  }

  // DOM の要素の場所（CSS px、見えていなければ null）。0.5 秒ごとに測り直す（毎フレームの getBoundingClientRect でレイアウトを起こさない）
  _domBox(id) {
    const C = this._domC || (this._domC = {});
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const e = C[id] || (C[id] = { t: -1e9, box: null });
    if (now - e.t < 500 && now >= e.t) return e.box;
    e.t = now; e.box = null;
    const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null;
    if (!el || !el.getBoundingClientRect || (el.classList && el.classList.contains('hidden'))) return null;
    const b = el.getBoundingClientRect();
    if (b && b.width > 0 && b.height > 0) e.box = [b.left, b.top, b.right, b.bottom];
    return e.box;
  }

  // 着艦の誘導: 接地点の菱形、グライドスロープの上下・中心線の左右のずれ（バー）、距離
  //  縦のバーは右の列の文字（infoR）・速度 / 高度の箱と文字の行（rows）にかからないよう、かかる側の端をその手前で止める
  //  （中心 cy より上の物は上の端、下の物は下の端。点は上下それぞれの長さで動く）。描いた場所は lastBoxes.glide
  _approach(ctx, A, cam, cx, cy, S, col, dim, fs, L, rows, infoR, symTop) {
    const P = { x: 0, y: 0 };
    if (A.point && this._project(A.point, cam, P)) {
      const r = S * 0.025;
      ctx.strokeStyle = 'rgba(255,207,74,0.95)';
      ctx.beginPath();
      ctx.moveTo(P.x, P.y - r); ctx.lineTo(P.x + r, P.y); ctx.lineTo(P.x, P.y + r); ctx.lineTo(P.x - r, P.y); ctx.closePath();
      ctx.stroke();
    }
    // 右側の縦のバー（上下のずれ: 上 = 高い）と下の横のバー（左右）
    const bx = L ? L.glideX : cx + S * 0.28, h = S * 0.22, dr = S * 0.012, half = Math.max(6, dr) + 3, gap = dr + 4;
    let top = cy - h, bot = cy + h;
    const clipBy = (o) => {
      if (!o || o[0] > bx + half || o[2] < bx - half || o[1] > bot || o[3] < top) return;
      if (o[1] >= cy) bot = Math.min(bot, o[1] - gap);
      else if (o[3] <= cy) top = Math.max(top, o[3] + gap);
    };
    if (rows) for (const o of rows) clipBy(o);
    clipBy(infoR);
    top = Math.min(top, cy - 12); bot = Math.max(bot, cy + 12);
    if (this.lastBoxes) this.lastBoxes.glide = [bx - half, top - dr, bx + half, bot + dr];
    ctx.strokeStyle = dim;
    ctx.beginPath(); ctx.moveTo(bx, top); ctx.lineTo(bx, bot); ctx.moveTo(bx - 6, cy); ctx.lineTo(bx + 6, cy); ctx.stroke();
    const dv = Math.max(-1, Math.min(1, A.dev / 20));
    ctx.fillStyle = Math.abs(A.dev) < 6 ? 'rgba(125,255,154,0.95)' : 'rgba(255,207,74,0.95)';
    ctx.beginPath(); ctx.arc(bx, dv >= 0 ? cy - dv * (cy - top) : cy - dv * (bot - cy), dr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    const km = A.dist >= 1000 ? (A.dist / 1000).toFixed(1) + ' km' : Math.round(A.dist) + ' m';
    const tip = Math.abs(A.dev) < 6 && Math.abs(A.lat) < 6 ? '' : (Math.abs(A.dev) >= Math.abs(A.lat) * 0.6 ? (A.dev > 0 ? '高い' : '低い') : (A.lat > 0 ? '右へ' : '左へ'));
    const txt = A.auto ? '' : '着艦 ' + km + (tip ? '  ' + tip : ''); // 自動着艦の間は案内の文字に距離が出る
    const LP = this._latY(cx, cy, S, L ? L.latW : S * 0.22, fs, txt ? (ctx.measureText ? ctx.measureText(txt).width : fs * txt.length) : 0, rows, infoR, symTop);
    if (LP) {
      const by = LP.y, w = LP.w;
      ctx.strokeStyle = dim;
      ctx.beginPath(); ctx.moveTo(cx - w, by); ctx.lineTo(cx + w, by); ctx.moveTo(cx, by - 6); ctx.lineTo(cx, by + 6); ctx.stroke();
      const dl = Math.max(-1, Math.min(1, A.lat / 30));
      ctx.fillStyle = Math.abs(A.lat) < 6 ? 'rgba(125,255,154,0.95)' : 'rgba(255,207,74,0.95)';
      ctx.beginPath(); ctx.arc(cx + dl * w, by, S * 0.012, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      if (txt) ctx.fillText(txt, cx, by + fs * 1.3);
    }
    ctx.strokeStyle = col;
  }
};
