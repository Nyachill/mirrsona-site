// 戦闘機の HUD（MR.JetHUD）。画面いっぱいの <canvas id="jet-hud">（pointer-events なし）に 2D で描く。
//   一人称（操縦席）: 緑のヘッドアップディスプレイ（ピッチラダー・方位のテープ・速度 km/h・高度 m・推力 %・AB・G・脚 / フック・
//     機関砲の照準（収束点）・速度ベクトル・見ている向き（操縦の目標）・失速 / 引き起こせ・空母に近いと着艦の誘導）。
//   3 人称（チェイス）: 白い簡単な表示（画面の中心が操縦の目標、機首の向き・照準・速度・高度・推力・警告）。
//   draw(info) は毎フレーム呼んでよい（隠れているときは何もしない）。info:
//     { jet（MR.Jet）, camera（THREE.Camera。投影に使う）, chase, aim（世界の向き。手動なら null）, gunPoint（収束点の世界座標）,
//       ammo, maxAmmo, asl（海抜 m）, agl（地面から m）, prompt（文字。カタパルトなど）, approach（{ dist, dev, lat, point }。着艦の誘導）,
//       warn（'失速' など）, bounds（地図の端）, hint（説明の行の配列。初めて乗ったとき）,
//       scheme（'easy' | 'aim' | 'manual'）, lock（{ point, locked, k, dist }。ミサイルのロック）, missiles / flares（残り）, missileTypes（型ごとの残り { aim9x, aim120 }。右の列は「9X 2 / 120 2」と次の行「フレア 60」）,
//       bomb（E2.5 の滑空爆弾 { n, ok, point, locked } か null。右の列のフレアの次の行「GBU 2」（脚・フックが上がっているとき = その行の場所）、
//         ok（落とせる範囲）なら黄色・落ちる所の輪 lastBoxes.bombCue（切り欠きの内側・右の列の外だけ））,
//       gfx（大きな G の見た目 0..1: 画面の端を暗く）}。G は荷重倍数で、gEffect.warnG / hotG で色が変わる（「G 120」）
//     prompt は \n で 2 行目以降（小さい字）
// 文字は日本語（「速度」「高度」「推力」「失速」「引き起こせ」「脚」「フック」「機銃」）。iPad で読める大きさ、線は 1.5〜2 px
// iPhone の切り欠き（Dynamic Island の横向きで左右 約 59〜62 px・下 約 21 px）: style.css のボタンは calc(var(--sar) + …) で内側へずれるので、
//   HUD の置き場所（_layout・ロックの文字・着艦の横のバー・画面の端）も同じ値（--sal / --sar / --sat / --sab = env(safe-area-inset-*)）だけ
//   内側にする（_insets()。以前は 0 として置き、高度の箱と右の列の文字が「視点」「脱出」のボタンに重なっていた）。lastBoxes.safe = 使える矩形
//   （これから足す物 = RWR の印などもこの中に置く）
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
    if (this.ins) this.ins.at = -1e9; // 回転・大きさが変わったら切り欠きも測り直す
  }

  // 切り欠きの幅（CSS px）{ l, r, t, b }。カスタムプロパティの getPropertyValue は env() を解かないので、padding に var(--sa*) を入れた
  //  見えない要素（全部の JetHUD で 1 つ: #jethud-safe）の computed padding で測る。0.5 秒ごと（毎フレームのスタイル計算を起こさない）
  _insets() {
    const ins = this.ins || (this.ins = { l: 0, r: 0, t: 0, b: 0, at: -1e9 });
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    if (now - ins.at < 500 && now >= ins.at) return ins;
    ins.at = now;
    try {
      if (typeof document === 'undefined' || !document.body || !document.createElement || typeof getComputedStyle !== 'function') return ins;
      let p = document.getElementById('jethud-safe');
      if (!p) {
        p = document.createElement('div');
        p.id = 'jethud-safe';
        p.setAttribute('aria-hidden', 'true');
        p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;' +
          'padding:var(--sat, 0px) var(--sar, 0px) var(--sab, 0px) var(--sal, 0px)';
        document.body.appendChild(p);
      }
      const cs = getComputedStyle(p);
      ins.l = Math.max(0, parseFloat(cs.paddingLeft) || 0); ins.r = Math.max(0, parseFloat(cs.paddingRight) || 0);
      ins.t = Math.max(0, parseFloat(cs.paddingTop) || 0); ins.b = Math.max(0, parseFloat(cs.paddingBottom) || 0);
    } catch (e) { /* 測れなければ前の値（最初は 0） */ }
    return ins;
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
    const I = this._I = this._insets();
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
    // 滑空爆弾の行「GBU 2」（E2.5）: 脚・フックが上がっているときだけ（その行の場所を使う = 右の列の高さは今まで通り fs × 5.4 まで）
    const bombRow = airInfo && info.bomb && info.bomb.n > 0 && J.gearPos < 0.02 && !J.hookDown;
    const wInfo = Math.max(ctx.measureText ? ctx.measureText('機銃 ' + (info.ammo != null ? info.ammo : J.ammo)).width : fs * 4,
      airInfo && ctx.measureText ? ctx.measureText(JetHUD.storesText(info)).width : 0,
      airInfo && ctx.measureText ? ctx.measureText(JetHUD.flaresText(info)).width : 0,
      bombRow && ctx.measureText ? ctx.measureText(JetHUD.bombText(info)).width : 0);
    const infoR = this._infoR || (this._infoR = [0, 0, 0, 0]);
    infoR[0] = rx + boxW / 2 - wInfo - 6; infoR[1] = ry - fs * 0.8; infoR[2] = rx + boxW / 2 + 4; infoR[3] = ry + fs * (airInfo ? 5.4 : 2.7) + fs * 0.8;
    // 照準（機銃の弾が集まる所）: ラダーの数字をその上に描かない
    const pip = info.gunPoint && this._project(info.gunPoint, cam, P) ? (this._pip || (this._pip = { x: 0, y: 0 })) : null;
    if (pip) { pip.x = P.x; pip.y = P.y; }
    // --- ピッチラダー（一人称。左右は速度・高度の箱の内側まで、右の列の文字を除く）---
    if (!chase) this._ladder(ctx, J, cam, cx, cy, S, col, dim, fs, L, infoR, pip);
    else if (this.lastBoxes) this.lastBoxes.ladder = null; // ラダーを描いてよい矩形（一人称だけ。テストが見る）
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
    const safe = LB.safe || (LB.safe = [0, 0, 0, 0]); // 切り欠きの内側（テストと、これから足す HUD の物が見る）
    safe[0] = I.l; safe[1] = I.t; safe[2] = W - I.r; safe[3] = H - I.b;
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
      const thrTxt = '推力 ' + thrPct + '%';
      ctx.fillText(thrTxt, tx0, by);
      let thrW = ctx.measureText ? ctx.measureText(thrTxt).width : fs * 5.3; // 描いた文字の右の端（案内の板を寄せるとき余分に狭めない）
      if (J.ab > 0.05) thrW = Math.max(thrW, fs * 5.6 + (ctx.measureText ? ctx.measureText('AB').width : fs * 1.5));
      if (J.ab > 0.05) { ctx.fillStyle = 'rgba(255,170,60,0.95)'; ctx.fillText('AB', tx0 + fs * 5.6, by); ctx.fillStyle = col; }
      // G: 大きいほど色を変える（gEffect.warnG で黄、hotG で赤）。9 G を超えたら整数で大きく「G 120」
      const GE = (J.def && J.def.gEffect) || { warnG: 30, hotG: 120 };
      const gv = Math.abs(J.gload);
      ctx.fillStyle = gv >= GE.hotG ? 'rgba(255,82,82,0.98)' : (gv >= GE.warnG ? 'rgba(255,207,74,0.98)' : col);
      if (gv > 9) { ctx.font = '700 ' + Math.round(fs * 1.25) + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; const gt = 'G ' + Math.round(J.gload); ctx.fillText(gt, tx0, by + fs * 1.45); thrW = Math.max(thrW, ctx.measureText ? ctx.measureText(gt).width : fs * 5); ctx.font = '600 ' + fs + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; }
      else { const gt = 'G ' + J.gload.toFixed(1); ctx.fillText(gt, tx0, by + fs * 1.35); thrW = Math.max(thrW, ctx.measureText ? ctx.measureText(gt).width : fs * 3); }
      ctx.fillStyle = col;
      // 推力のバー
      ctx.strokeStyle = dim;
      ctx.strokeRect(tx0, by - fs * 1.4, boxW, fs * 0.45);
      ctx.fillStyle = J.ab > 0.05 ? 'rgba(255,170,60,0.9)' : col;
      ctx.fillRect(tx0, by - fs * 1.4, boxW * Math.min(1, J.throttle), fs * 0.45);
      // 描いた文字の場所（CSS px。テストがボタン・スティックと重ならないか見る）
      LB.thrust = [tx0, by - fs * 1.4, tx0 + Math.max(boxW, thrW + 2), by + fs * 1.35 + fs * 0.6];
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
      ry2 += fs * 1.35; const mTxt = JetHUD.storesText(info); textRow(mTxt, rx + boxW / 2, ry2, fs); ctx.fillText(mTxt, rx + boxW / 2, ry2);
      ry2 += fs * 1.35; const fTxt = JetHUD.flaresText(info); textRow(fTxt, rx + boxW / 2, ry2, fs); ctx.fillText(fTxt, rx + boxW / 2, ry2);
      if (bombRow) {
        //  落とせる範囲（この「ミサイル」で爆弾を落とす）なら明るく、ほかは薄く
        ry2 += fs * 1.35; const bTxt = JetHUD.bombText(info); textRow(bTxt, rx + boxW / 2, ry2, fs);
        ctx.fillStyle = info.bomb.ok ? 'rgba(255,207,74,0.98)' : dim; ctx.fillText(bTxt, rx + boxW / 2, ry2); ctx.fillStyle = col;
      }
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
    // 滑空爆弾の落ちる所（E2.5。落とせる範囲のときだけ: ロックした地上の目標か CCIP の点）。方位のテープ・右の列・切り欠きの外には描かない
    LB.bombCue = null;
    if (info.bomb && info.bomb.ok && this._project(info.bomb.point, cam, P) && P.y > symTop) {
      const r = Math.max(8, S * 0.024), e = r * 1.45, q = this._cueBox || (this._cueBox = [0, 0, 0, 0]);
      q[0] = P.x - e; q[1] = P.y - e; q[2] = P.x + e; q[3] = P.y + e;
      if (q[0] >= safe[0] && q[2] <= safe[2] && q[1] >= safe[1] && q[3] <= safe[3] && !JetHUD._pHit(q, infoR)) {
        this._bombCue(ctx, P.x, P.y, r, info.bomb.locked);
        LB.bombCue = q;
      }
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
      const P0 = this._promptFit(ctx, lines, L.prompt, fs, rows, H, symTop, !!(info.hint && info.hint.length));
      this.lastBoxes.prompt = this._panel(ctx, lines, P0.x, P0.y, P0.w, fs, 'rgba(255,207,74,0.98)', true);
    }
    // 初めて乗ったときの説明（方位のテープの下、白。後ろに暗い板）
    //  低い画面（スマホの横）は 2 行まで（3 行の板がピッチラダーの上半分を隠していた）
    //  警告（「ミサイル接近 9時」「危険」…）が出ている間は描かない: 同じ高さ（cy − S × 0.2）で、説明の板が赤い警告の文字を隠していた
    if (info.hint && info.hint.length && !LB.warn) this.lastBoxes.hint = this._panel(ctx, L.low && info.hint.length > 2 ? info.hint.slice(0, 2) : info.hint, L.hintX, L.hintY, L.hintW, fs, 'rgba(255,255,255,0.96)', false);
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
      this._btnBoxes(bB, bL);
      ob.push(LB.info, LB.prompt, LB.hint, LB.thrust, LB.glide, LB.lat, LB.warn, bS, bA, bB, bL);
      this._lockBox(ctx, lockAt.x, lockAt.y, S, fs, info.lock, ob);
    }
    // RWR（来るミサイル・ロック・探知の向き）: 小さな輪と印。どの物にも重ならない所（lastBoxes.rwr）。置けなければ描かない（rwrHidden）
    LB.rwr = null; LB.rwrHidden = false; LB.rwrClock = null;
    if (info.rwr && info.rwr.st > 0) this._rwr(ctx, info.rwr, cx, cy, S, fs, col, dim, L, rows, symTop, J);
    ctx.shadowBlur = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stats.frames++;
    if (t0) this.stats.ms += ((performance.now() - t0) - this.stats.ms) * 0.05;
  }

  // VTOL（MIRRSONA。V3 の武装）の HUD: 戦闘機の draw とは別の小さな表示（高度・速度・ナセルは DOM の #heli-info / #vehicle-hud が出す
  //  = ラダー・方位のテープ・速度 / 高度の箱は描かない）。描くもの: 機銃の照準（gunPoint）・ロックの四角と「ロック …」・滑空爆弾の落ちる所の輪・
  //  警告（warn）・案内（prompt。任意）・右の列「機銃 n / 9X n / フレア n / GBU n / 武装」。右の列は右下のボタンの列（右から 280 px・下から 262 px）の
  //  左で、左下のスティック・#heli-info・#vehicle-hud・#rwr・#heli-rpm・ほかのボタン・ミニマップ・方位の帯・警告・案内にかからない一番下の高さ
  //  （入らなければボタンの列の上）。RWR は VTOL では DOM の #rwr（hud.setRwr）が出すので、#rwr が見えていればその場所を lastBoxes.rwr に入れて
  //  キャンバスには描かない（#rwr が無いときだけ _rwr で描く）。lastBoxes は戦闘機と同じ名前（rows / info / lock / rwr / safe / bombCue / warn / prompt）。
  //  info: { vtol, camera, chase, cockpit, gunPoint, ammo, ammoMax, lock, missileTypes, missiles?, flares, bomb, rwr, warn, prompt?, arm（0..1）, armed,
  //    speed, alt, theta, firing?, time? }
  drawVtol(info) {
    if (!this.visible || !this.ctx || !info || !info.camera) return;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    this._resize();
    const I = this._I = this._insets();
    const ctx = this.ctx, W = this.w, H = this.h, cam = info.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const chase = info.cockpit != null ? !info.cockpit : !!info.chase;
    const col = chase ? 'rgba(240,248,255,0.95)' : 'rgba(125,255,154,0.95)';
    const dim = chase ? 'rgba(240,248,255,0.72)' : 'rgba(125,255,154,0.7)';
    const yel = 'rgba(255,207,74,0.98)', warnCol = 'rgba(255,82,82,0.98)';
    const S = Math.min(W, H);
    const fs = Math.round(Math.max(12, Math.min(18, S * 0.034)));
    const F = (w, f) => w + ' ' + f + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.lineWidth = Math.max(1.5, S / 420);
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.font = F(600, fs);
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = chase ? 3 : 2;
    cam.updateMatrixWorld();
    const cx = W / 2, cy = H / 2, P = this._vP || (this._vP = { x: 0, y: 0 });
    const LB = this.lastBoxes || (this.lastBoxes = {});
    LB.thrust = null; LB.prompt = null; LB.hint = null; LB.lock = null; LB.lockText = null; LB.info = null; LB.glide = null; LB.lat = null; LB.latHidden = false;
    LB.ladder = null; LB.warn = null; LB.bombCue = null; LB.rwr = null; LB.rwrHidden = false; LB.rwrClock = null;
    const safe = LB.safe || (LB.safe = [0, 0, 0, 0]);
    safe[0] = I.l; safe[1] = I.t; safe[2] = W - I.r; safe[3] = H - I.b;
    //  方位の帯（#compass。上から 42〜76 px）の下から描く
    const symTop = I.t + 80;
    // 避ける物: 右下のボタンの列・左下のスティック・DOM（見えているものだけ。0.5 秒ごとに測る）
    const bB = this._vB || (this._vB = [0, 0, 0, 0]), bL = this._vL || (this._vL = [0, 0, 0, 0]);
    this._btnBoxes(bB, bL);
    const dom = this._vDom || (this._vDom = []);
    dom.length = 0;
    const ids = JetHUD.VTOL_AVOID;
    for (let i = 0; i < ids.length; i++) { const b = this._domBox(ids[i]); if (b) dom.push(b); }
    const rwrDom = this._domBox('rwr');
    // --- 警告（真ん中の上。点滅で消えている間も場所は取る = lastBoxes.warn）---
    const time = info.time != null ? info.time : t0 / 1000;
    if (info.warn) {
      ctx.font = F(700, Math.round(fs * 1.5));
      ctx.textAlign = 'center';
      const wy = cy - S * 0.2, ww = ctx.measureText ? ctx.measureText(info.warn).width : fs * 1.5 * info.warn.length;
      const wb = this._vWarn || (this._vWarn = [0, 0, 0, 0]);
      wb[0] = cx - ww / 2; wb[1] = wy - fs * 0.9; wb[2] = cx + ww / 2; wb[3] = wy + fs * 0.9;
      LB.warn = wb;
      if ((time % 0.6) < 0.4) { ctx.fillStyle = warnCol; ctx.fillText(info.warn, cx, wy); }
      ctx.font = F(600, fs); ctx.fillStyle = col;
    }
    // --- 案内（任意。真ん中の下・スティックとボタンの列の間）---
    if (info.prompt) {
      const pl = String(info.prompt).split('\n');
      const l0 = I.l + 150, r0 = Math.max(l0 + 200, bB[0] - 8);
      LB.prompt = this._panel(ctx, pl, (l0 + r0) / 2, cy + S * 0.18, r0 - l0, fs, yel, true);
    }
    // --- 右の列 ---
    const t = info.missileTypes;
    const mTxt = t && t.aim9x != null && !(t.aim120 > 0) ? '9X ' + (t.aim9x | 0) : (t || info.missiles != null ? JetHUD.storesText(info) : null);
    const ammo = info.ammo != null ? info.ammo | 0 : null;
    const armK = info.armed ? 1 : Math.max(0, Math.min(1, info.arm || 0));
    const lines = this._vLines || (this._vLines = [null, null, null, null, null]);
    const colors = this._vCols || (this._vCols = [null, null, null, null, null]);
    lines[0] = ammo != null ? '機銃 ' + ammo : null; colors[0] = ammo === 0 ? warnCol : col;
    lines[1] = mTxt; colors[1] = col;
    lines[2] = info.flares != null ? JetHUD.flaresText(info) : null; colors[2] = col;
    lines[3] = info.bomb ? JetHUD.bombText(info) : null; colors[3] = info.bomb && info.bomb.ok ? yel : dim;
    lines[4] = info.armed ? '武装' : (armK > 0.001 ? '武装…' : null); colors[4] = info.armed ? col : yel;
    //  幅は出しうる文字の一番広いもの（数が変わっても列が動かない）。高さはいつも 5 行
    let wCol = 0;
    if (ctx.measureText) {
      wCol = Math.max(ctx.measureText('機銃 ' + Math.max(888, info.ammoMax | 0)).width, ctx.measureText('武装…').width, ctx.measureText('フレア 88').width,
        mTxt ? ctx.measureText(mTxt).width : 0, lines[2] ? ctx.measureText(lines[2]).width : 0, lines[3] ? ctx.measureText(lines[3]).width : 0);
    } else wCol = fs * 5;
    const lh = fs * 1.35, padX = fs * 0.45, padY = fs * 0.3;
    const cw = wCol + padX * 2, ch = lh * 5 + padY * 2;
    const obs = this._vObs || (this._vObs = []);
    obs.length = 0;
    obs.push(bB, bL);
    for (let i = 0; i < dom.length; i++) obs.push(dom[i]);
    if (LB.warn) obs.push(LB.warn);
    if (LB.prompt) obs.push(LB.prompt);
    const box = this._vInfo || (this._vInfo = [0, 0, 0, 0]);
    const fits = (xr, yb) => {
      box[0] = xr - cw; box[1] = yb - ch; box[2] = xr; box[3] = yb;
      if (box[0] < safe[0] + 2 || box[2] > safe[2] - 2 || box[1] < symTop || box[3] > safe[3] - 2) return false;
      for (let i = 0; i < obs.length; i++) { const q = obs[i]; if (box[2] > q[0] - 3 && box[0] < q[2] + 3 && box[3] > q[1] - 3 && box[1] < q[3] + 3) return false; }
      return true;
    };
    let ok = false;
    //  機体（3 人称の真ん中）の上に描かない（V2 の直し: 以前はボタンの列の左 = 画面の真ん中の右に置き、380 / 381 / 383 で機体に重なった）。
    //  戦闘機の右の列と同じく端の場所から: 1) 右の端・ボタンの列の上（ミニマップの下）で一番下 → 2) 左の端・スティックの上で一番下 →
    //  3) ボタンの列の左で一番下（前の場所）→ 4) 右の端で一番下。1)・2) は真ん中の機体の囲み（S × 0.3）も避ける
    const mid = this._vMid || (this._vMid = [0, 0, 0, 0]);
    mid[0] = cx - S * 0.3; mid[1] = cy - S * 0.25; mid[2] = cx + S * 0.3; mid[3] = cy + S * 0.3;
    for (let k = 0; k < 4 && !ok; k++) {
      if (k === 0) obs.push(mid); else if (k === 2) obs.pop();
      const xr = k === 0 || k === 3 ? safe[2] - 8 : k === 1 ? Math.max(safe[0], bL[0]) + 8 + cw : bB[0] - 8;
      const yb0 = k === 0 || k === 3 ? bB[1] - 6 : k === 1 ? bL[1] - 6 : safe[3] - 6;
      for (let yb = yb0; yb - ch >= symTop && !ok; yb -= fs * 0.5) if (fits(xr, yb)) ok = true;
    }
    if (obs[obs.length - 1] === mid) obs.pop();
    LB.info = ok ? box : null;
    const rows = LB.rows || (LB.rows = []);
    rows.length = 0;
    if (ok) {
      const sb = ctx.shadowBlur;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(box[0], box[1], cw, ch, Math.min(8, fs * 0.5)); else ctx.rect(box[0], box[1], cw, ch);
      ctx.fill();
      ctx.shadowBlur = sb;
      ctx.textAlign = 'right';
      const xr = box[2] - padX;
      const rr = this._vRow || (this._vRow = []);
      let y = box[1] + padY + lh / 2;
      for (let i = 0; i < 5; i++, y += lh) {
        const s = lines[i];
        if (!s) continue;
        const w = ctx.measureText ? ctx.measureText(s).width : fs * s.length;
        const q = rr[i] || (rr[i] = [0, 0, 0, 0]);
        q[0] = xr - w; q[1] = y - fs * 0.65; q[2] = xr; q[3] = y + fs * 0.65;
        rows.push(q);
        if (i === 4 && !info.armed && (time % 0.5) > 0.32) continue; // 武装の途中は点滅（場所は取る）
        ctx.fillStyle = colors[i];
        ctx.fillText(s, xr, y);
      }
      ctx.fillStyle = col;
    }
    // --- 機銃の照準（収束点。武装していなければ薄く）---
    if (info.gunPoint && this._project(info.gunPoint, cam, P) && P.y > symTop && P.x > safe[0] && P.x < safe[2] && P.y < safe[3] &&
      !(rwrDom && P.x > rwrDom[0] && P.x < rwrDom[2] && P.y > rwrDom[1] && P.y < rwrDom[3])) {
      const c = armK >= 1 ? col : dim;
      ctx.strokeStyle = c; ctx.fillStyle = c;
      this._pipper(ctx, P.x, P.y, S, c, !!info.firing);
      ctx.strokeStyle = col; ctx.fillStyle = col;
    }
    // --- 滑空爆弾の落ちる所（落とせる範囲のときだけ）---
    if (info.bomb && info.bomb.ok && info.bomb.point && this._project(info.bomb.point, cam, P) && P.y > symTop) {
      const r = Math.max(8, S * 0.024), e = r * 1.45, q = this._vCue || (this._vCue = [0, 0, 0, 0]);
      q[0] = P.x - e; q[1] = P.y - e; q[2] = P.x + e; q[3] = P.y + e;
      if (q[0] >= safe[0] && q[2] <= safe[2] && q[1] >= safe[1] && q[3] <= safe[3] && !(LB.info && JetHUD._pHit(q, LB.info))) {
        this._bombCue(ctx, P.x, P.y, r, info.bomb.locked);
        LB.bombCue = q;
      }
    }
    // --- ロック（四角と「ロック …」。文字は右の列・案内・警告・ボタン・スティック・DOM にかからない所）---
    if (info.lock && info.lock.point && this._project(info.lock.point, cam, P)) {
      const ob = this._vLockObs || (this._vLockObs = []);
      ob.length = 0;
      if (LB.info) ob.push(LB.info);
      if (LB.prompt) ob.push(LB.prompt);
      if (LB.warn) ob.push(LB.warn);
      ob.push(bB, bL);
      for (let i = 0; i < dom.length; i++) ob.push(dom[i]);
      this._lockBox(ctx, P.x, P.y, S, fs, info.lock, ob);
    }
    // --- RWR: DOM の #rwr があればそれ。無ければキャンバスに（戦闘機と同じ輪）---
    if (rwrDom) LB.rwr = rwrDom;
    else if (info.rwr && info.rwr.st > 0) {
      const ro = this._vRwrObs || (this._vRwrObs = []);
      ro.length = 0;
      for (let i = 0; i < rows.length; i++) ro.push(rows[i]);
      for (let i = 0; i < dom.length; i++) ro.push(dom[i]);
      const J = this._vJ || (this._vJ = { time: 0 });
      J.time = time;
      this._rwr(ctx, info.rwr, cx, cy, S, fs, col, dim, null, ro, symTop, J);
    }
    ctx.shadowBlur = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stats.frames++;
    if (t0) this.stats.ms += ((performance.now() - t0) - this.stats.ms) * 0.05;
  }

  // RWR の輪: 半径 fs × 1.3（印の分だけ外へ）。場所は前の場所がまだ空いていればそのまま、無ければ方位のテープの記号の下から下へ fs ずつ、
  //  横は真ん中の左右（S × 0.3 → 0.45 → 0.15 → 真ん中）の順に、右の列・案内・説明・行・推力・ロックの文字・警告・着艦のバー・
  //  右下のボタンの列・左下のスティック・ミサイル / フレア / 加速 / 減速 / 着艦のボタン・機体の名前と HP・ミニマップにかからず、
  //  切り欠きの内側（lastBoxes.safe）に入る所。印は来る向き（上 = 機首、右回り）、真ん中は時計の時（「3時」）
  _rwr(ctx, R, cx, cy, S, fs, col, dim, L, rows, symTop, J) {
    const LB = this.lastBoxes;
    const r = Math.max(18, fs * 1.3), ro = r + fs * 0.55;
    const ob = this._rwrObs || (this._rwrObs = []);
    ob.length = 0;
    const ks = JetHUD.RWR_BOXES;
    for (let i = 0; i < ks.length; i++) if (LB[ks[i]]) ob.push(LB[ks[i]]);
    if (rows) for (let i = 0; i < rows.length; i++) ob.push(rows[i]);
    const bB = this._rwB || (this._rwB = [0, 0, 0, 0]), bL = this._rwL || (this._rwL = [0, 0, 0, 0]);
    this._btnBoxes(bB, bL); ob.push(bB, bL);
    const ids = JetHUD.RWR_AVOID;
    for (let i = 0; i < ids.length; i++) { const b = this._domBox(ids[i]); if (b) ob.push(b); }
    const sf = LB.safe;
    const box = LB.rwrBox || (LB.rwrBox = [0, 0, 0, 0]);
    const P = this._rwrP || (this._rwrP = { x: 0, y: 0, ok: false });
    let ok = P.ok && this._rwrFits(P.x, P.y, ro, sf, symTop, ob, box);
    if (!ok) {
      const xs = JetHUD.RWR_XS, y0 = symTop + ro + 2, y1 = (sf ? sf[3] : this.h) - ro - 2;
      for (let y = y0; y <= y1 && !ok; y += fs) {
        for (let i = 0; i < xs.length; i++) { const x = cx + xs[i] * S; if (this._rwrFits(x, y, ro, sf, symTop, ob, box)) { P.x = x; P.y = y; ok = true; break; } }
      }
    }
    P.ok = ok;
    if (!ok) { LB.rwrHidden = true; return; }
    this._rwrFits(P.x, P.y, ro, sf, symTop, ob, box); // box を今の場所に
    LB.rwr = box;
    const x = P.x, y = P.y;
    const sb = ctx.shadowBlur; ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dim;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, s0 = Math.sin(a), c0 = Math.cos(a); ctx.moveTo(x + s0 * r * 0.78, y - c0 * r * 0.78); ctx.lineTo(x + s0 * r, y - c0 * r); }
    ctx.stroke();
    // 印: 来る向き（上 = 機首、右回り）。探知は黄、ロックは橙、発射は赤（点滅）、信号が消えた後は薄く
    const flash = (J.time % 0.5) < 0.32;
    const c = R.st === 3 ? 'rgba(255,82,82,0.98)' : (R.st === 2 ? 'rgba(255,154,60,0.98)' : 'rgba(255,215,106,0.98)');
    const a = (R.bearing || 0) * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    const tip = r * 0.62, base = r + fs * 0.5, hw = fs * 0.42;
    ctx.globalAlpha = R.fresh ? (R.st === 3 && !flash ? 0.45 : 1) : 0.5;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x + sa * tip, y - ca * tip);
    ctx.lineTo(x + sa * base + ca * hw, y - ca * base + sa * hw);
    ctx.lineTo(x + sa * base - ca * hw, y - ca * base - sa * hw);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // 時計の時
    const txt = JetHUD.CLOCK_TXT[(R.clock || 12) % 12];
    if (this._rwrFs !== fs) { this._rwrFs = fs; this._rwrF1 = '700 ' + Math.max(11, Math.round(fs * 0.78)) + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; this._rwrF2 = '600 ' + fs + 'px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif'; }
    ctx.font = this._rwrF1;
    ctx.textAlign = 'center';
    ctx.fillStyle = R.fresh ? c : dim;
    ctx.fillText(txt, x, y + 1);
    ctx.font = this._rwrF2;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.shadowBlur = sb;
    LB.rwrClock = txt;
  }

  // RWR の輪の外接矩形 box（x, y が真ん中・半径 ro）が切り欠きの内側・方位のテープの下で、ob のどれにもかからないか
  _rwrFits(x, y, ro, sf, symTop, ob, box) {
    const m = 3;
    box[0] = x - ro; box[1] = y - ro; box[2] = x + ro; box[3] = y + ro;
    if (sf && (box[0] < sf[0] + 2 || box[1] < sf[1] + 2 || box[2] > sf[2] - 2 || box[3] > sf[3] - 2)) return false;
    if (box[1] < symTop) return false;
    for (let i = 0; i < ob.length; i++) { const q = ob[i]; if (box[2] > q[0] - m && box[0] < q[2] + m && box[3] > q[1] - m && box[1] < q[3] + m) return false; }
    return true;
  }

  // 置き場所（CSS px）。ボタン（style.css）の場所を避ける: 右下のボタンの列（右から 280 px・下から 262 px）、左下のスティック
  //  （左 22〜134 px・下から 48〜160 px）、左の撃つボタン（左 30〜102 px）。速度の箱は左、高度の箱は右（ボタンの列の左）。
  //  狭い画面（右に箱が入らない）では高度の箱も左（速度の箱の右隣）。tx = 左下の推力・G の左端
  //  どの数も切り欠き（this._I = _insets()）の内側から測る（ボタンは style.css で calc(var(--sar) + …) だけ内側にある）
  _layout(W, H, S, cx, cy, fs, boxW, boxH, chase) {
    const out = this._lay || (this._lay = { lx: 0, rx: 0, ry: 0, tx: 0, ty: 0, glideX: 0, latW: 0, hintX: 0, hintY: 0, hintW: 0, prompt: { x: 0, y: 0, w: 0 } });
    const I = this._I || { l: 0, r: 0, t: 0, b: 0 };
    let lx = chase ? W * 0.2 : cx - S * 0.42, rx = chase ? W * 0.8 : cx + S * 0.42;
    const btnL = W - I.r - 280, btnTop = H - I.b - 262;
    const colBottom = cy + boxH * 2.05 + fs * 4.6; // 右の列（高度・R・機銃・脚・フック）の下の端
    const halfSafe = Math.min(cx - I.l, W - I.r - cx); // 真ん中から切り欠きまでの近い方
    lx = Math.max(lx, I.l + 110 + boxW / 2);
    rx = Math.min(rx, W - I.r - 8 - boxW / 2);
    if (colBottom > btnTop && rx + boxW / 2 > btnL) {
      rx = btnL - boxW / 2;
      //  右に入らない: 速度の箱の右隣。速度の箱も左の端（切り欠き + 110 px）へ寄せる（一人称の cx − S × 0.42 のままだと右の列の文字が
      //  x 370 px まで来て、案内の板が入る幅が無く板が下の #vehicle-hud に重なった。ラダーも右の列の右から描くので広くなる）
      if (rx - boxW / 2 < cx + S * 0.12) { lx = I.l + 110 + boxW / 2; rx = lx + boxW + fs * 1.4; }
    }
    out.lx = lx; out.rx = rx; out.ry = cy;
    // ピッチラダーを描いてよい左右（箱の内側。狭くて高度の箱が左にあるときはその右から）
    const inner = Math.max(lx, rx) === rx && rx > cx ? rx - boxW / 2 - 6 : cx + S * 0.36;
    out.clipL = Math.max(cx - S * 0.36, Math.max(lx, rx < cx ? rx : lx) + boxW / 2 + 6);
    out.clipR = Math.min(cx + S * 0.36, inner);
    //  ラダーの高さ（cy ± S × 0.36）が右下のボタンの列にかかるなら列の左の端の手前まで（切り欠きで高度の箱が左へ移ると inner が
    //  cx + S × 0.36 になり、ラダーが「視点」の上に描かれていた）
    if (cy + S * 0.36 > btnTop) out.clipR = Math.min(out.clipR, btnL - 6);
    // 推力・G: 高い画面は左下（スティックの右・下から）。低い画面（H < 560: スマホの横）は親指の届く所が画面の下半分の全部なので、
    //  速度の箱の上（「速度」の文字の上）へ
    const low = H < 560;
    out.tx = low ? lx - boxW / 2 : Math.max(lx - boxW / 2, I.l + 146);
    out.ty = low ? cy - boxH / 2 - fs * 3.6 : H - I.b - fs * (chase ? 5.2 : 4.4); // 低い画面: 大きな「G 120」が「速度」の見出しにかからない
    // 案内（黄色）: 画面の中央の下。右下のボタンの列（右から 280 px・下から 262 px）にかかる高さなら、左のスティック（低い画面は
    //  親指の場所 = 左 180 px まで）とボタンの列の間に収める
    let py = cy + S * 0.26, px = cx, pw = Math.min(W * 0.92, halfSafe * 2 - 16);
    if (py + fs * 1.4 > btnTop) { const l0 = I.l + (low ? 180 : 150), r0 = Math.max(l0 + 200, btnL); px = (l0 + r0) / 2; pw = r0 - l0; }
    out.prompt.x = px; out.prompt.y = py; out.prompt.w = pw;
    // 初めての説明: 方位のテープの下。低い画面は推力の右から右上の地図の左まで（推力の文字に重ねない）
    out.hintY = cy - S * 0.21;
    //  低い画面: 左の撃つボタン（左 30〜102 px）の右から「視点」ボタン（右から 272 px）の左まで。推力の文字はその間（10 秒）描かない
    out.low = low;
    //  右の端は「視点」ボタン（かんたん: 右から 222〜272 px、上の端は下から 232 px）の左（以前は発艦ボタンの左 245 px まで: 切り欠きで
    //  帯が狭くなると説明の板が帯いっぱいに広がり、板の下の端が「視点」に 2 px かかった）
    if (low && (W - I.r - 276) - (I.l + 112) >= 300) { const l0 = I.l + 112, r0 = W - I.r - 276; out.hintX = (l0 + r0) / 2; out.hintW = r0 - l0; }
    else { out.hintX = cx; out.hintW = Math.min(W * 0.9, halfSafe * 2 - 16); }
    out.glideX = rx > cx ? Math.min(cx + S * 0.28, rx - boxW / 2 - 14) : cx + S * 0.28;
    //  縦のバー（cy ± S × 0.22）が右下のボタンの列の高さにかかるなら、列の左の端の手前まで（切り欠きで高度の箱が左へ移った狭い画面:
    //  cx + S × 0.28 が「視点」「脱出」「フレア」の上だった）
    if (cy + S * 0.22 > btnTop) out.glideX = Math.min(out.glideX, btnL - 12);
    // ラダーの横線の長さ（数字が箱・着艦の縦のバーにかからない）
    out.rung = Math.max(S * 0.06, Math.min(S * 0.13, Math.min(out.glideX, out.clipR) - cx - fs * 2.6, cx - out.clipL - fs * 2.6));
    out.latW = Math.max(30, Math.min(S * 0.22, (colBottom > btnTop ? btnL : W - I.r) - cx - 14));
    return out;
  }

  // 案内の板の場所（L.prompt の帯 = 中心 x・幅 w・1 行目の y）を、速度・高度の箱と右の列の文字の行（rows）・推力の文字・警告の文字・
  //  下の真ん中の機体の名前と HP（#vehicle-hud）にかからないように直す（obstacles）。板がかかれば、その物の側の帯の端を物の手前（3 px）まで
  //  寄せる（帯の中で中央揃え）。板の幅が元の 8 割（かつ 240 px か元の幅の小さい方）より小さくなる・まだかかるなら、帯はそのままで 2 px ずつ
  //  下・上に探して一番近いかからない高さ（方位のテープの記号の下 symTop から画面（切り欠きの内側）の下まで。初めての説明 noUp を
  //  出している間は下だけ）。切り欠きのあるスマホの横では高度の箱と右の列が左（速度の箱の右隣）へ移り、帯の左がその行で狭くなる。
  //  板の大きさは最初に 1 回だけ測る（帯を狭めると文字は縮む / 横に詰めるので、幅は min(必要な幅, 帯)・高さは測った高さ以下 = 余裕側）。
  //  返すのは { x, y, w }（作り置き）
  _promptFit(ctx, lines, P0, fs, rows, H, symTop, noUp) {
    const out = this._pfit || (this._pfit = { x: 0, y: 0, w: 0 });
    out.x = P0.x; out.y = P0.y; out.w = P0.w;
    const LB = this.lastBoxes || {};
    const obs = this._pobs || (this._pobs = []);
    obs.length = 0;
    if (rows) for (let i = 0; i < rows.length; i++) obs.push(rows[i]);
    if (LB.thrust) obs.push(LB.thrust);
    if (LB.warn) obs.push(LB.warn);
    const vh = this._domBox('vehicle-hud');
    const nHard = obs.length;
    if (vh) obs.push(vh); // 機体の名前と HP は柔らかい物: どこにも入らなければ 2 回目は見ない（押す物でも文字の行でもない）
    if (!obs.length) return out;
    let nObs = obs.length;
    const m = 3;
    const full = this._panel(ctx, lines, out.x, out.y, out.w, fs, null, true, true);
    const needW = full[2] - full[0];
    const F = this._pfa || (this._pfa = { full: null, P0: null, obs: null, nObs: 0, needW: 0, minW: 0, minAbs: 0, yMin: 0, yMax: 0, b: [0, 0, 0, 0], fit: { x: 0, w: 0 } });
    F.full = full; F.P0 = P0; F.obs = obs; F.needW = needW;
    F.minW = Math.min(needW, P0.w) * 0.8; F.minAbs = Math.min(needW, P0.w, 240);
    F.yMax = H - (this._I ? this._I.b : 0); F.yMin = (symTop || 0) + 2;
    const fit = F.fit;
    for (let pass = 0; pass < 2; pass++) {
      if (pass) { if (nObs === nHard || !nHard) break; nObs = nHard; }
      F.nObs = nObs;
      if (this._pfitAt(F, 0)) { out.x = fit.x; out.w = Math.max(40, fit.w); return out; }
      for (let k = 1; k <= 160; k++) {
        const d = k * 2;
        if (this._pfitAt(F, d)) { out.x = fit.x; out.w = Math.max(40, fit.w); out.y = P0.y + d; return out; }
        if (!noUp && this._pfitAt(F, -d)) { out.x = fit.x; out.w = Math.max(40, fit.w); out.y = P0.y - d; return out; }
      }
    }
    // どこにも入らない: 元の帯のまま、かかっていた行の下へ（入れば。今まで通り）
    let low = -Infinity;
    if (rows) for (let i = 0; i < rows.length; i++) if (JetHUD._pHit(full, rows[i])) low = Math.max(low, rows[i][3]);
    const dy = low + m + 1 - full[1];
    if (dy > 0 && full[3] + dy <= F.yMax) out.y = P0.y + dy;
    return out;
  }

  // _promptFit の 1 つの高さ: dy だけずらした板が帯を狭めて入るか（入れば F.fit に中心と帯の幅）。F は作り置きの引数の箱
  _pfitAt(F, dy) {
    const m = 3, full = F.full, P0 = F.P0, obs = F.obs, b = F.b, needW = F.needW;
    b[1] = full[1] + dy; b[3] = full[3] + dy;
    if (dy && (b[1] < F.yMin || b[3] > F.yMax)) return false;
    let l = P0.x - P0.w / 2, r = P0.x + P0.w / 2;
    for (let it = 0; it < 6; it++) {
      const w = Math.min(needW, r - l);
      b[0] = (l + r) / 2 - w / 2; b[2] = (l + r) / 2 + w / 2;
      let moved = false, any = false;
      for (let i = 0; i < F.nObs; i++) {
        const q = obs[i];
        if (!JetHUD._pHit(b, q)) continue;
        any = true;
        if ((q[0] + q[2]) / 2 >= (b[0] + b[2]) / 2) { if (q[0] - m < r) { r = q[0] - m; moved = true; } }
        else if (q[2] + m > l) { l = q[2] + m; moved = true; }
      }
      if (!any) { const w2 = Math.min(needW, r - l); if (w2 < F.minW || w2 < F.minAbs) return false; F.fit.x = (l + r) / 2; F.fit.w = r - l; return true; }
      if (!moved) return false;
    }
    return false;
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
      const wIn = Math.max(20, maxW - fs * 0.9); // 板（左右の余白 fs × 0.45 ずつ）が maxW に収まる文字の幅
      if (w > wIn) { f = Math.max(10, Math.floor(f * wIn / w)); ctx.font = font(f, b); w = ctx.measureText ? ctx.measureText(lines[i]).width : wIn; }
      //  10 px でも入らなければ横に詰める（fillText の maxWidth。切り欠きのあるスマホの横で長い案内の板が「フレア」にかかった）
      const squeeze = w > wIn;
      if (squeeze) w = wIn;
      rows.push({ f, b, w, squeeze });
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
      if (rows[i].squeeze) ctx.fillText(lines[i], x, yy, rows[i].w); else ctx.fillText(lines[i], x, yy);
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
    if (this.lastBoxes) { const lb = this.lastBoxes.ladder || (this.lastBoxes.ladder = [0, 0, 0, 0]); lb[0] = x0; lb[1] = top; lb[2] = Math.max(x0, x1); lb[3] = cy + S * 0.36; }
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
  _tapeY(fs) { return Math.max(fs * 3.9, 48 + fs * 1.1) + (this._I ? this._I.t : 0); }

  // 右下のボタンの列（右から 280 px・下から 262 px）と左下の撃つボタン・スティック（左 140 px・下から 170 px）の矩形。切り欠きの分だけ内側
  _btnBoxes(bB, bL) {
    const I = this._I || { l: 0, r: 0, t: 0, b: 0 };
    bB[0] = this.w - I.r - 280; bB[1] = this.h - I.b - 262; bB[2] = this.w; bB[3] = this.h;
    bL[0] = 0; bL[1] = this.h - I.b - 170; bL[2] = I.l + 140; bL[3] = this.h;
  }

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
        const I = this._I || { l: 0, r: 0, t: 0, b: 0 };
        let hit = a0 < I.l + 2 || a1 > this.w - I.r - 2 || b0 < I.t + 2 || b1 > this.h - I.b - 2;
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
    this._btnBoxes(bB, bL);
    obs.push(bB, bL);
    const vh = this._domBox('vehicle-hud'); // 下の真ん中の機体の名前と HP のバー（DOM）
    if (vh) obs.push(vh);
    const I = this._I || { l: 0, r: 0, t: 0, b: 0 };
    const yMin = (symTop || 0) + up, yMax = this.h - I.b - 2 - dn;
    // 高さ y で使える半分の長さ（線の端の点の半径・文字の半分の幅も入る）。使えなければ 0
    const widthAt = (y) => {
      if (y < yMin || y > yMax) return 0;
      let hx = Math.min(cx - I.l, this.w - I.r - cx) - 2;
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
    if (this.lastBoxes) { clipBy(this.lastBoxes.prompt); clipBy(this.lastBoxes.hint); } // 案内・説明の板（先に描いてある）
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

  // 右の列のミサイルの行: 型ごとの残り「9X 2 / 120 2」（型が分からなければ「ミサイル 4」）。フレアは次の行「フレア 60」
  //  （1 行の「9X 2 / 120 2  フレア 60」は長く、スマホの横の操縦席で画面の真ん中の機銃の照準まで届いていた）
  static storesText(info) {
    const t = info.missileTypes;
    if (t && (t.aim9x != null || t.aim120 != null)) return '9X ' + (t.aim9x | 0) + ' / 120 ' + (t.aim120 | 0);
    return 'ミサイル ' + info.missiles;
  }
  static flaresText(info) { return 'フレア ' + info.flares; }
  // 滑空爆弾の行（E2.5）「GBU 2」
  static bombText(info) { return 'GBU ' + ((info.bomb && info.bomb.n) | 0); }

  // 滑空爆弾の落ちる所の印（E2.5）: 黄色の輪と真ん中の点、上下左右の短い線。ロックした目標なら輪を二重に
  _bombCue(ctx, x, y, r, locked) {
    const sb = ctx.shadowBlur, st = ctx.strokeStyle, fl = ctx.fillStyle, lw = ctx.lineWidth;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = lw + 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,207,74,0.98)'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    if (locked) { ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo(x - r * 1.45, y); ctx.lineTo(x - r, y); ctx.moveTo(x + r, y); ctx.lineTo(x + r * 1.45, y);
    ctx.moveTo(x, y - r * 1.45); ctx.lineTo(x, y - r); ctx.moveTo(x, y + r); ctx.lineTo(x, y + r * 1.45);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,207,74,0.98)';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.shadowBlur = sb; ctx.strokeStyle = st; ctx.fillStyle = fl; ctx.lineWidth = lw;
  }
};
// RWR の輪が避ける DOM（見えているものだけ）と横の候補（真ん中から S の何倍か。左が先）
MR.JetHUD.RWR_AVOID = ['btn-flare', 'btn-missile', 'btn-boost', 'btn-slow', 'btn-land', 'btn-launch', 'btn-camera', 'btn-eject', 'btn-vehicle', 'vehicle-hud', 'minimap', 'kills-wrap', 'btn-settings'];
// VTOL の HUD（drawVtol）の右の列・ロックの文字が避ける DOM（見えているものだけ）
MR.JetHUD.VTOL_AVOID = ['btn-fire', 'btn-missile', 'btn-flare', 'btn-land', 'btn-camera', 'btn-vehicle', 'btn-jump', 'btn-descend', 'btn-settings', 'heli-info', 'heli-rpm', 'vehicle-hud', 'rwr', 'minimap', 'compass', 'kills-wrap', 'hp-wrap', 'weather-toast'];
MR.JetHUD.RWR_BOXES = ['info', 'prompt', 'hint', 'thrust', 'lock', 'warn', 'glide', 'lat'];
MR.JetHUD._pHit = function (b, q) { const m = 3; return b[2] > q[0] - m && b[0] < q[2] + m && b[3] > q[1] - m && b[1] < q[3] + m; };
MR.JetHUD.CLOCK_TXT = ['12時', '1時', '2時', '3時', '4時', '5時', '6時', '7時', '8時', '9時', '10時', '11時'];
MR.JetHUD.RWR_XS = [-0.3, 0.3, -0.45, 0.45, -0.15, 0.15, -0.6, 0.6, 0];
