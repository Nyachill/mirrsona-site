// C0b: 端末のクラスを実行時に決める・層ごとの描画の数・端末で測るベンチ（plans/nyc-cinematic.md rev 4 §3.1・§10.4・§10.5・§11）。
//   MR.CineBench.init(game)   … game.js の start()（レンダラーを作った直後）から 1 回。game.cine = { static, effective, caps, pixelRatio, budgets, … }。
//                               画面の大きさ（pixelRatio）を下げるのは render.cine.applyCaps か URL の ?cinecaps=1 のときだけ（既定は報告だけ）。
//                               ?bench=cine（街）/ ?memprobe=1&route=heli|walk[&max=MB] のときだけベンチを始める（ほかは何もしない）。
//   MR.CineBench.debugText(game) … MR.CONFIG.DEBUG の左上の表示に足す行（クラス・pixelRatio・バッファの Mpx・描画 本体 / 影・三角形・プログラム）。
//   MR.CineBench.bootNote(afterEl) … 開始画面に「前回のメモリ測定: N MB まで」（前の ?memprobe の記録があるときだけ）。
//   MR.CineLayers.measure(game) … 1 フレームだけ renderer.renderBufferDirect を包んで描き、層ごとの描画の数・三角形を返す（影のパスは別）。
//                               包むのはこの呼び出しの間だけ（ふだんは何も足さない）。層は名前の付いた根（下の LAYERS）。分からない物は other。
// 数値（姿勢・フレーム数・25 MB の刻み）はベンチの道具の決まりなのでここに書く（ゲームの数値ではない）。
(function (root) {
  const MR = root.MR || (root.MR = {});
  const LAYERS = ['detail', 'lod', 'skyline', 'ground', 'water', 'props', 'landmarks', 'vehicles', 'enemies', 'loot', 'fx', 'sky', 'viewmodel', 'post', 'other'];
  const BENCH_KEY = 'mirrsona.cineBench', MEM_KEY = 'mirrsona.memprobe';
  const lsGet = (k) => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (root.localStorage) root.localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const now = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
  const raf = (f) => (root.requestAnimationFrame ? root.requestAnimationFrame(f) : setTimeout(() => f(now()), 16));
  const nextFrame = () => new Promise((r) => raf(r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  function med(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; }
  function search() { try { return (root.location && root.location.search) || ''; } catch (e) { return ''; } }
  function param(k) { const m = new RegExp('[?&]' + k + '=([^&]*)').exec(search()); return m ? decodeURIComponent(m[1]) : null; }

  // ---------- 層ごとの描画の数 ----------
  function nameLayer(n) {
    if (!n) return null;
    if (n.indexOf('chunk:') === 0) return 'detail';
    if (n.indexOf('lod:') === 0) return 'lod';
    if (n.indexOf('sky:') === 0 || n === 'cityFar') return 'skyline';
    if (n.indexOf('city:lake') === 0 || n === 'water') return 'water';
    if (n.indexOf('city:') === 0 || n === 'ground' || n === 'road') return 'ground';
    if (n === 'cityProps' || n.indexOf('prop:') === 0) return 'props';
    if (n === 'cityLandmarks') return 'landmarks';
    if (n.indexOf('vehicle:') === 0) return 'vehicles';
    if (n === 'loot' || n.indexOf('loot:') === 0) return 'loot';
    if (n.indexOf('fx:') === 0) return 'fx';
    if (n === 'skyDome' || n === 'skyBackground') return 'sky';
    return null;
  }
  function makeClassifier(game) {
    const ids = new Map();
    for (const e of game.enemies || []) if (e && e.group) ids.set(e.group, 'enemies');
    const rp = game.remotePlayers || game.remotes;
    if (rp) for (const k in rp) { const p = rp[k]; if (p && p.group) ids.set(p.group, 'enemies'); if (p && p.tag) ids.set(p.tag, 'enemies'); }
    for (const v of game.vehicles || []) if (v && v.root) ids.set(v.root, 'vehicles');
    const cache = new Map();
    return function (obj, sc) {
      if (sc && sc !== game.scene) return sc === game.viewScene ? 'viewmodel' : 'post';
      if (!obj) return 'other';
      const hit = cache.get(obj);
      if (hit) return hit;
      let layer = null;
      for (let o = obj; o && !layer; o = o.parent) layer = ids.get(o) || nameLayer(o.name) || (o.isScene ? 'stop' : null);
      if (!layer || layer === 'stop') layer = (obj.isSprite || obj.isPoints) ? 'fx' : 'other';
      cache.set(obj, layer);
      return layer;
    };
  }
  function triCount(geo, grp, obj) {
    let n = 0;
    if (grp) n = grp.count;
    else if (geo.index) n = geo.index.count;
    else if (geo.attributes && geo.attributes.position) n = geo.attributes.position.count;
    if (geo.drawRange && geo.drawRange.count !== Infinity) n = Math.min(n, geo.drawRange.count);
    const inst = obj && obj.isInstancedMesh ? obj.count : (geo.isInstancedBufferGeometry ? (geo.instanceCount === Infinity ? 1 : geo.instanceCount) : 1);
    return obj && (obj.isMesh || obj.isInstancedMesh) ? Math.floor(n / 3) * inst : 0;
  }
  // 1 フレームを描いて数える（opts.render: 描く関数。既定 game._render）
  function measure(game, opts) {
    opts = opts || {};
    const r = game.renderer;
    const out = { main: {}, shadow: {}, trisMain: {}, trisShadow: {}, mainCalls: 0, shadowCalls: 0, calls: 0, triangles: 0, programs: 0 };
    if (!r || typeof r.renderBufferDirect !== 'function') return out;
    const cls = makeClassifier(game);
    const orig = r.renderBufferDirect, auto = r.info.autoReset;
    r.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
      try {
        const L = cls(obj, sc), shadow = !sc;
        const tab = shadow ? out.shadow : out.main, tt = shadow ? out.trisShadow : out.trisMain;
        tab[L] = (tab[L] || 0) + 1;
        tt[L] = (tt[L] || 0) + triCount(geo, grp, obj);
        if (shadow) out.shadowCalls++; else out.mainCalls++;
      } catch (e) { /* 数えるだけ */ }
      return orig.apply(this, arguments);
    };
    try {
      r.info.autoReset = false; r.info.reset();
      (opts.render || (() => game._render()))();
      out.calls = r.info.render.calls; out.triangles = r.info.render.triangles;
    } finally {
      r.renderBufferDirect = orig;
      r.info.autoReset = auto;
    }
    out.programs = r.info.programs ? r.info.programs.length : 0;
    return out;
  }
  MR.CineLayers = { LAYERS, measure, nameLayer, makeClassifier };

  // ---------- 実行時のクラス（レンダラーを作った直後）----------
  function init(game) {
    if (!MR.Cine || !game || !game.renderer) return null;
    let c = null;
    try {
      const Cine = MR.Cine, flags = Cine.flagsFromSearch(search());
      const info = Cine.envInfo(root.navigator, root.screen, root);
      if (game.saver) info.saver = true;
      const gl = game.renderer.getContext ? game.renderer.getContext() : null;
      // 機能の調べはレンダラーごとに 1 回（「もう一度」は同じレンダラー。three の GL の状態に毎回触らない）
      const fk = JSON.stringify(flags), R0 = game.renderer;
      const caps = R0.__cineCaps && R0.__cineCaps.k === fk && !(gl && gl.isContextLost && gl.isContextLost()) ? R0.__cineCaps.caps : Cine.probeCaps(gl, flags);
      try {
        R0.__cineCaps = { k: fk, caps };
        // 文脈が戻ったら調べ直す（戻った後は isContextLost() が false なので、前のを使ってしまう）
        const cv = R0.domElement;
        if (cv && cv.addEventListener && !R0.__cineCapsHook) { R0.__cineCapsHook = true; cv.addEventListener('webglcontextrestored', () => { R0.__cineCaps = null; }); }
      } catch (e) { /* なし */ }
      const dec = Cine.decide(game.config, info, caps, flags);
      const before = game.renderer.getPixelRatio ? game.renderer.getPixelRatio() : 1;
      if (dec.apply && dec.pixelRatio < before) game.renderer.setPixelRatio(dec.pixelRatio);
      c = { static: dec.static, effective: dec.effective, cls: dec.cls, caps, budgets: dec.budgets, apply: dec.apply, flags,
        pixelRatio: game.renderer.getPixelRatio ? game.renderer.getPixelRatio() : before, rendererPixelRatio: before,
        cinePixelRatio: dec.pixelRatio, pixelCap: dec.pixelCap, dprCap: dec.dprCap, decision: dec };
      game.cine = c;
      if (MR.CONFIG && MR.CONFIG.DEBUG && game.hud && game.hud.debug && game.hud.debug.style) game.hud.debug.style.whiteSpace = 'pre-line';
      if (flags.bench === 'cine' && game.isCity && !game._cineBench) game._cineBench = new Bench(game, param('quick') === '1');
      else if (flags.memprobe && game.isCity && !game._cineBench) game._cineBench = new MemProbe(game, param('route') === 'walk' ? 'walk' : 'heli', +(param('max') || 0) || 0);
      if (game._cineBench) game._cineBench.run().catch((e) => { try { console.warn('[CineBench]', e); } catch (er) { /* なし */ } });
    } catch (e) {
      game.cine = c || { error: String(e && e.message || e) };
    }
    return game.cine;
  }

  // DEBUG の行（2 秒ごとに 1 フレームぶん層を数える。DEBUG のときだけ）
  function debugText(game) {
    const c = game.cine;
    if (!c || c.error || !MR.Cine) return '';
    const r = game.renderer, t = now();
    // 2 秒ごとに次の本物のフレームの _render を 1 回だけ包んで数える（別に 1 フレーム描かない = fps に山が出ない）
    if (!game._cineDbg) game._cineDbg = { t: -1e9, m: null, armed: false };
    const D = game._cineDbg;
    if (!D.armed && t - D.t > 2000 && typeof game._render === 'function' && !Object.prototype.hasOwnProperty.call(game, '_render')) {
      D.armed = true;
      const own = game._render;
      game._render = function () {
        delete game._render; D.armed = false; D.t = now();
        let res;
        try { D.m = measure(game, { render: () => { res = own.apply(game, arguments); } }); } catch (e) { D.m = null; }
        return res;
      };
    }
    const m = D.m;
    const sz = r.getDrawingBufferSize ? r.getDrawingBufferSize(new (root.THREE.Vector2)()) : { x: 0, y: 0 };
    const st = c.static, eff = c.effective;
    const rows = [
      'cine ' + st.cls + '/' + eff.cls + ' (' + (eff.reason === 'ok' ? st.reason : eff.reason) + ')' + (c.apply ? ' caps on' : ' report'),
      'pr ' + r.getPixelRatio().toFixed(2) + ' buf ' + sz.x + 'x' + sz.y + ' ' + (sz.x * sz.y / 1e6).toFixed(2) + '/' + (c.pixelCap / 1e6).toFixed(2) + 'Mpx (cine pr ' + c.cinePixelRatio.toFixed(2) + ')' +
        (game.composer && game.composer.renderTarget1 ? ' scene ' + game.composer.renderTarget1.width + 'x' + game.composer.renderTarget1.height : '')
    ];
    if (m) {
      const top = Object.keys(m.main).sort((a, b) => m.main[b] - m.main[a]).slice(0, 6).map((k) => k + ' ' + m.main[k]).join(' ');
      rows.push('draws ' + m.mainCalls + '+' + m.shadowCalls + 'sh tris ' + Math.round(m.triangles / 1000) + 'k prog ' + m.programs);
      rows.push(top);
    }
    return '\n' + rows.join('\n');
  }

  // ---------- 姿勢（街。screenshot.js の 20 / 22 / 23 / 24 / 26 と同じ所 + 300 m）----------
  function poses(game) {
    const c = game.city;
    const look = (name, x, y, z, tx, ty, tz) => ({ name, x, y, z, yaw: Math.atan2(-(tx - x), -(tz - z)), pitch: Math.atan2(ty - y, Math.hypot(tx - x, tz - z)), weapon: y < 30 });
    const out = [look('street_gct', -34, 1.75, 21, -5, 16, -23.4)];
    out.push(look('times_square', (c && c.bwX ? c.bwX(-318) : -700) - 4, 1.75, -318, -702, 15, -290));
    let best = null;
    for (const L of (c && c.lots) || []) {
      if (!L.tiers || !L.tiers.length || L.ent) continue;
      const t = L.tiers[L.tiers.length - 1], top = t[5], mx = (t[0] + t[2]) / 2, mz = (t[1] + t[3]) / 2;
      if (top < 100 || top > 175 || Math.min(t[2] - t[0], t[3] - t[1]) < 16) continue;
      const d = Math.hypot(mx + 330, mz + 150);
      if (!best || d < best.d) best = { d, x: mx, z: mz, y: top, r: t };
    }
    if (best) {
      const tx = -5, tz = -100, dx = tx - best.x, dz = tz - best.z, L = Math.hypot(dx, dz);
      let s = Infinity;
      if (Math.abs(dx) > 1e-6) s = Math.min(s, ((dx > 0 ? best.r[2] : best.r[0]) - best.x) / (dx / L));
      if (Math.abs(dz) > 1e-6) s = Math.min(s, ((dz > 0 ? best.r[3] : best.r[1]) - best.z) / (dz / L));
      const p = look('roof', best.x + dx / L * (s - 1.6), best.y + 1.75, best.z + dz / L * (s - 1.6), tx, 25, tz); p.weapon = true; out.push(p);
    } else out.push(look('roof', -300, 150, -150, 0, 100, -60));
    out.push(look('heli_150m', 0, 150, 420, 0, 60, -500));
    out.push(look('skyline_300m', -200, 300, 1700, -250, 40, -200));
    out.push(look('water_hudson', -2048, 1.9, -248, -2205, 12, -360));
    return out;
  }

  // ---------- ?bench=cine ----------
  function Bench(game, quick) {
    this.game = game; this.quick = quick;
    this.frames = quick ? 30 : 120;
    this.res = { page: 'cine-bench', v: 1, time: new Date().toISOString(), url: search(), quick, done: false, poses: [], errors: [] };
    this.el = null;
  }
  Bench.prototype.ui = function (status) {
    const d = root.document;
    if (!d || !d.createElement) return;
    if (!this.el) {
      const el = this.el = d.createElement('div');
      el.id = 'cinebench';
      el.style.cssText = 'position:fixed;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));top:8px;max-height:70vh;overflow:auto;z-index:9999;' +
        'background:rgba(10,12,16,0.86);color:#e8e8e8;font:11px/1.35 -apple-system,system-ui,sans-serif;padding:8px 10px;border-radius:8px;pointer-events:auto;-webkit-user-select:text;user-select:text;';
      el.innerHTML = '<div id="cb-status" style="font-weight:700;font-size:13px"></div><div id="cb-table"></div>' +
        '<button id="cb-copy" style="min-height:44px;padding:8px 14px;margin:6px 6px 0 0">コピー</button><button id="cb-hide" style="min-height:44px;padding:8px 14px;margin-top:6px">隠す</button><span id="cb-copied"></span>';
      (d.body || d.documentElement).appendChild(el);
      const stop = (e) => e.stopPropagation();
      el.addEventListener('touchstart', stop); el.addEventListener('touchmove', stop); el.addEventListener('pointerdown', stop);
      d.getElementById('cb-copy').onclick = () => copyText(JSON.stringify(this.res), d.getElementById('cb-copied'));
      d.getElementById('cb-hide').onclick = () => { const t = d.getElementById('cb-table'); t.style.display = t.style.display === 'none' ? '' : 'none'; };
    }
    if (status != null) d.getElementById('cb-status').textContent = status;
    d.getElementById('cb-table').innerHTML = this.tableHtml();
  };
  Bench.prototype.tableHtml = function () {
    const td = (s) => '<td style="padding:1px 5px;border-bottom:1px solid #333">' + s + '</td>';
    let h = '<table style="border-collapse:collapse;margin-top:4px"><tr>' + ['姿勢', '中央値/p90/p99 ms', '>50ms', 'update ms', 'render ms', '描画 本体+影', '三角形'].map(td).join('') + '</tr>';
    for (const p of this.res.poses) {
      const b = p.base || {};
      h += '<tr>' + [p.name, b.median + ' / ' + b.p90 + ' / ' + b.p99, b.over50, b.updateMs, b.renderMs, p.layers ? p.layers.mainCalls + '+' + p.layers.shadowCalls : '-',
        p.layers ? Math.round(p.layers.triangles / 1000) + 'k' : '-'].map(td).join('') + '</tr>';
      for (const k in p.toggles || {}) {
        const t = p.toggles[k];
        h += '<tr style="color:#9aa3ad">' + ['  ' + k, t.skipped ? 'なし' : t.median + ' / ' + t.p90 + ' / ' + t.p99, t.over50 == null ? '' : t.over50, t.updateMs == null ? '' : t.updateMs, t.renderMs == null ? '' : t.renderMs, t.calls == null ? '' : t.calls, ''].map(td).join('') + '</tr>';
      }
      if (p.layers) h += '<tr style="color:#9aa3ad"><td colspan="7" style="padding:1px 5px">' + Object.keys(p.layers.main).sort((a, b) => p.layers.main[b] - p.layers.main[a]).map((k) => k + ' ' + p.layers.main[k] + (p.layers.shadow[k] ? '+' + p.layers.shadow[k] : '')).join(' · ') + '</td></tr>';
    }
    return h + '</table>';
  };
  // 実際のループで n フレーム: rAF の間隔・_update / renderer.render の CPU ms
  Bench.prototype.sample = async function (n) {
    const g = this.game, r = g.renderer;
    const upd = [], ren = [], ivals = [];
    let curR = 0;
    const ou = g._update, own = Object.prototype.hasOwnProperty.call(g, '_update'), orr = r.render;
    g._update = function (dt) { const t0 = now(); try { return ou.call(this, dt); } finally { upd.push(now() - t0); } };
    r.render = function () { const t0 = now(); try { return orr.apply(this, arguments); } finally { curR += now() - t0; } };
    try {
      let last = await nextFrame();
      for (let i = 0; i < n; i++) {
        const t = await nextFrame();
        ivals.push(t - last); last = t;
        ren.push(curR); curR = 0;
      }
    } finally { if (own) g._update = ou; else delete g._update; r.render = orr; }
    return { frames: n, median: r2(med(ivals)), p90: r2(pct(ivals, 0.9)), p99: r2(pct(ivals, 0.99)), over50: ivals.filter((x) => x > 50).length,
      updateMs: r2(med(upd)), updateP90: r2(pct(upd, 0.9)), renderMs: r2(med(ren)), renderP90: r2(pct(ren, 0.9)) };
  };
  // 読み込みが落ち着くまで（待ち行列が 30 フレーム続けて空、最長 maxMs）
  Bench.prototype.settle = async function (maxMs) {
    const g = this.game, t0 = now();
    let calm = 0;
    while (now() - t0 < maxMs) {
      await nextFrame();
      const s = g.world && g.world.streamer && g.world.streamer.stats;
      calm = s && s.queue === 0 ? calm + 1 : 0;
      if (calm >= 30) return { ms: Math.round(now() - t0), settled: true };
    }
    return { ms: Math.round(now() - t0), settled: false };
  };
  // 本体を描く先（composer の renderTarget1）の幅。post なしは描画バッファの幅
  function rtWidth(g) {
    const c = g.composer;
    if (c && c.renderTarget1) return c.renderTarget1.width;
    return g.renderer && g.renderer.domElement ? g.renderer.domElement.width : 0;
  }
  Bench.prototype.toggles = function () {
    const g = this.game, r = g.renderer, w = g.world;
    const T = [];
    T.push({ id: 'fog_off', on: () => {
      const ou = g._update, fog = g.scene.fog, keep = fog ? [fog.near, fog.far] : null;
      const w = function (dt) { const v = ou.call(this, dt); if (this.scene.fog) { this.scene.fog.near = 1e8; this.scene.fog.far = 2e8; } return v; };
      g._update = w;
      return () => { if (g._update === w) delete g._update; if (fog && keep) { fog.near = keep[0]; fog.far = keep[1]; } };
    } });
    T.push({ id: 'shadows_off', on: () => { const a = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; return () => { r.shadowMap.autoUpdate = a; r.shadowMap.needsUpdate = true; }; } });
    T.push({ id: 'post_off', on: () => { const c = g.composer; if (!c) return null; g.composer = null; return () => { g.composer = c; }; } });
    // 解像度 0.75 倍: レンダラーと EffectComposer の両方。composer は自分の pixelRatio（game.js は描く先を渡すので 1）で
    // setSize するので、renderer だけ変えると本体・影・ブルームは元の大きさのまま描いて最後のコピーだけ縮む。
    // composer の比 s × 0.75 にする（本体を描く先 renderTarget1 が 0.75 倍になる）。_resize で FXAA の解像度も合わせる
    T.push({ id: 'scale_0.75', on: () => {
      const pr = r.getPixelRatio(), bs = g._benchScale;
      r.setPixelRatio(pr * 0.75); g._benchScale = (bs > 0 ? bs : 1) * 0.75; g._resize(); // composer の比は _resize の postScale が × 0.75
      return () => { r.setPixelRatio(pr); g._benchScale = bs; g._resize(); };
    } });
    T.push({ id: 'props_off', on: () => { const grp = w && w.props && w.props.group; if (!grp) return null; const v = grp.visible; grp.visible = false; return () => { grp.visible = v; }; } });
    return T;
  };
  Bench.prototype.run = async function () {
    const g = this.game, R = this.res;
    this.ui('ベンチの準備中（街の読み込みを待っています）…');
    for (let i = 0; i < 600 && !g.running; i++) await sleep(100);
    if (g.world && g.world.propsReady) await Promise.race([g.world.propsReady, sleep(this.quick ? 15000 : 40000)]);
    R.cine = g.cine ? { static: g.cine.static, effective: g.cine.effective, pixelRatio: g.cine.pixelRatio, cinePixelRatio: g.cine.cinePixelRatio, pixelCap: g.cine.pixelCap, apply: g.cine.apply, budgets: g.cine.budgets,
      caps: g.cine.caps } : null;
    try { R.screen = { css: root.innerWidth + 'x' + root.innerHeight, dpr: root.devicePixelRatio, buffer: g.renderer.domElement.width + 'x' + g.renderer.domElement.height,
      scene: g.composer && g.composer.renderTarget1 ? g.composer.renderTarget1.width + 'x' + g.composer.renderTarget1.height : null }; } catch (e) { /* なし */ } // scene = 本体を実際に描く大きさ（post あり）
    // ベンチの間はプレイヤーがやられない（死亡画面で描画が変わらないように）
    g._playerHit = function () {};
    const list = poses(g), sel = this.quick ? list.slice(0, 2) : list;
    try {
      for (let i = 0; i < sel.length; i++) {
        const p = sel[i];
        this.ui('姿勢 ' + (i + 1) + '/' + sel.length + ' ' + p.name + ': 読み込みを待っています…');
        g.setFreeCam(p);
        const st = await this.settle(this.quick ? 8000 : 25000);
        await this.sample(20); // シェーダーの初回・テクスチャの上げを先に
        this.ui('姿勢 ' + (i + 1) + '/' + sel.length + ' ' + p.name + ': ' + this.frames + ' フレーム測定中…');
        const row = { name: p.name, cam: { x: r1(p.x), y: r1(p.y), z: r1(p.z) }, settle: st, base: await this.sample(this.frames), toggles: {}, rtW: rtWidth(g) };
        try { row.layers = measure(g); } catch (e) { R.errors.push(p.name + ' layers: ' + e.message); }
        R.poses.push(row);
        this.ui();
        if (this.quick && i > 0) continue; // quick: 切り替えは最初の姿勢だけ
        for (const t of this.toggles()) {
          let undo = null;
          try { undo = t.on(); } catch (e) { R.errors.push(t.id + ': ' + e.message); }
          if (!undo) { row.toggles[t.id] = { skipped: true }; continue; }
          try {
            await this.sample(10);
            const s = await this.sample(this.quick ? 20 : this.frames);
            try { s.calls = measure(g).calls; } catch (e) { /* なし */ }
            s.rtW = rtWidth(g);
            row.toggles[t.id] = s;
          } finally { undo(); }
          await this.sample(5);
          this.ui('姿勢 ' + (i + 1) + '/' + sel.length + ' ' + p.name + ': 切り替え ' + t.id);
        }
      }
    } catch (e) { R.errors.push(String(e && e.message || e)); }
    finally { delete g._playerHit; }
    R.done = true;
    lsSet(BENCH_KEY, JSON.stringify(R));
    root.__cineBench = R;
    this.ui(R.errors.length ? '完了（エラー ' + R.errors.length + ' 件）— 「コピー」で結果を送ってください' : '完了 — この表をスクリーンショットして「コピー」で結果を送ってください');
    return R;
  };

  function copyText(txt, el) {
    const done = (m) => { if (el) el.textContent = ' ' + m; };
    const fallback = () => {
      try {
        const d = root.document, ta = d.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
        d.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length);
        const ok = d.execCommand('copy'); d.body.removeChild(ta); done(ok ? 'コピーしました' : 'コピーできません');
      } catch (e) { done('コピーできません'); }
    };
    const nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(txt).then(() => done('コピーしました'), fallback); else fallback();
  }

  // ---------- ?memprobe=1&route=heli|walk[&max=MB] ----------
  // 道すじの場面を読んでから 25 MB ずつ型付き配列を取って全部のページに書く。取る前に「ここまで取れた」を localStorage に書く。
  // iOS が落とした（jetsam）なら、次の起動の開始画面に「前回のメモリ測定: N MB まで」= 本当の余裕。max まで取れたら放して終わり。
  function MemProbe(game, route, maxMB) {
    this.game = game; this.route = route; this.max = maxMB > 0 ? maxMB : 6000; this.step = 25; this.held = []; this.el = null;
  }
  MemProbe.prototype.show = function (s) {
    const d = root.document;
    if (!d || !d.createElement) return;
    if (!this.el) {
      this.el = d.createElement('div'); this.el.id = 'memprobe';
      this.el.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:9999;background:rgba(10,12,16,0.86);color:#ffd27a;font:13px -apple-system,system-ui,sans-serif;padding:6px 12px;border-radius:8px;pointer-events:none;';
      (d.body || d.documentElement).appendChild(this.el);
    }
    this.el.textContent = s;
  };
  MemProbe.prototype.run = async function () {
    const g = this.game;
    this.show('メモリ測定（' + this.route + '）: 読み込みを待っています…');
    for (let i = 0; i < 600 && !g.running; i++) await sleep(100);
    if (g.world && g.world.propsReady) await Promise.race([g.world.propsReady, sleep(30000)]);
    g._playerHit = function () {};
    if (g.isCity && g.setFreeCam) {
      const P = poses(g);
      const p = this.route === 'walk' ? P[0] : P[3];
      g.setFreeCam(p);
      const b = new Bench(g, true);
      await b.settle(20000);
      if (this.route === 'heli') { // ヘリの道すじ: パーク街の上 150 m を北へ 1 km（読み込みを動かす）
        for (let z = 420; z > -600; z -= 4) { g.setFreeCam(Object.assign({}, p, { z })); await nextFrame(); }
        await b.settle(15000);
      }
    }
    const rec = { route: this.route, reachedMB: 0, tryingMB: 0, max: this.max, t: Date.now(), done: false, level: g.levelId };
    for (let mb = 0; mb < this.max;) {
      rec.reachedMB = mb; rec.tryingMB = mb + this.step; rec.t = Date.now();
      lsSet(MEM_KEY, JSON.stringify(rec));
      this.show('メモリ測定（' + this.route + '）: ' + mb + ' MB 取れた → ' + rec.tryingMB + ' MB を試しています');
      const a = new Uint8Array(this.step * 1e6);
      for (let i = 0; i < a.length; i += 4096) a[i] = 1 + (i & 127);
      this.held.push(a);
      mb += this.step;
      await sleep(250);
      await nextFrame();
      rec.reachedMB = mb;
    }
    rec.done = true; rec.t = Date.now();
    lsSet(MEM_KEY, JSON.stringify(rec));
    this.held.length = 0;
    delete g._playerHit;
    root.__memProbe = rec;
    this.show('メモリ測定（' + this.route + '）: ' + rec.reachedMB + ' MB まで落ちずに取れました（上限）。放しました');
    return rec;
  };

  // 開始画面: 前の ?memprobe の結果（24 時間以内）
  function bootNote(after) {
    let rec = null;
    try { rec = JSON.parse(lsGet(MEM_KEY) || 'null'); } catch (e) { rec = null; }
    if (!rec || typeof rec.reachedMB !== 'number' || !(Date.now() - rec.t < 86400000)) return null;
    const txt = '前回のメモリ測定: ' + rec.reachedMB + ' MB まで（' + rec.route + '・' + (rec.done ? '上限 ' + rec.max + ' MB まで落ちなかった' : (rec.tryingMB) + ' MB を取る途中で落ちた = 本当の余裕') + '）';
    const d = root.document;
    if (d && d.createElement && after && after.parentNode) {
      let el = d.getElementById('memprobe-note');
      if (!el) { el = d.createElement('div'); el.id = 'memprobe-note'; el.style.cssText = 'margin-top:6px;font-size:12px;color:#ffd27a;user-select:text;-webkit-user-select:text;'; after.parentNode.insertBefore(el, after.nextSibling); }
      el.textContent = txt;
    }
    return txt;
  }

  // ?bench=cine / ?memprobe=1 は街で（main.js が「ソロ」を街：フリーにする）
  function wantsCity(s) { s = s == null ? search() : s; const f = MR.Cine ? MR.Cine.flagsFromSearch(s) : null; return f ? (f.bench === 'cine' || f.memprobe) : (/[?&]bench=cine\b/.test(s) || /[?&]memprobe(=1|=true)?(&|$)/.test(s)); }

  // ?look=0 か render.look.enabled === false なら look を使わない（R0 の描画の大きさも 1。farlook.js も見る）
  function lookOn(config) {
    if (/[?&]look=0(&|$)/.test(search())) return false;
    const lk = config && config.render && config.render.look;
    return !(lk && lk.enabled === false);
  }
  // V2 R0: ポストの描画の大きさ s（game.js _resize が composer.setPixelRatio(s) に使う）。クラスは game.cine、はしごは game.cineLadder（あれば）
  // ベンチの scale_0.75 は game._benchScale を置く（renderer の DPR も同じ倍率で下げるので、クラスの上限は下げる前の DPR で見る）
  function postScale(game, w, h) {
    const f = game._benchScale > 0 ? game._benchScale : 1;
    if (!MR.Cine || !MR.Cine.renderScale) return f;
    const c = game.cine || {}, r = game.renderer;
    const s = MR.Cine.renderScale(game.config, { cls: c.cls || 'phone', cssW: w, cssH: h, rendererDpr: (r && r.getPixelRatio ? r.getPixelRatio() : 1) / f,
      saver: !!game.saver, look: lookOn(game.config), ladder: game.cineLadder && game.cineLadder.renderScale ? game.cineLadder.renderScale() : 1 }) * f;
    if (game.cine) game.cine.postScale = s;
    return s;
  }
  MR.CineBench = { init, debugText, postScale, lookOn, bootNote, wantsCity, poses, Bench, MemProbe, BENCH_KEY, MEM_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = MR.CineBench;
})(typeof window !== 'undefined' ? window : globalThis);
