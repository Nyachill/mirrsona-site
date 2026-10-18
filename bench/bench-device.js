// 描画ベンチの「端末の判定」（render-bench.html の一番上の枠）。MR.Cine（www/js/cine.js）と game.json の render.devices / render.screens を読み、
// Safari が出している物（UA・画面の大きさ × DPR・GPU の文字列・CPU のコア数・ASTC）から機種の候補とクラスを出す。
// サイトでは ../js/cine.js と ../assets/config/game.json、リポジトリ（tools/bench/）では ../../www/js/ と ../../assets/。
// 結果は window.__benchDevice（結果 JSON の device）。
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const CLS_JA = { low: 'low（最小）', phone: 'phone（スマホ）', phonePlus: 'phonePlus（8 GB 以上のスマホ）', tablet: 'tablet（iPad）', tabletPro: 'tabletPro（8 GB 以上の iPad）', desktop: 'desktop（PC）' };

  function loadScript(srcs) {
    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (i >= srcs.length) { resolve(null); return; }
        const s = document.createElement('script'); s.src = srcs[i];
        s.onload = () => resolve(srcs[i]); s.onerror = () => { i++; next(); };
        document.head.appendChild(s);
      };
      next();
    });
  }
  async function loadJson(urls) {
    for (const u of urls) {
      try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* 次 */ }
    }
    return null;
  }

  function probe(flags) {
    const c = document.createElement('canvas'); c.width = c.height = 4;
    let gl = null;
    try { if (!flags.webgl1) gl = c.getContext('webgl2'); } catch (e) { gl = null; }
    if (!gl) { try { gl = c.getContext('webgl'); } catch (e) { gl = null; } }
    const caps = window.MR.Cine.probeCaps(gl, flags);
    try { const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) { /* なし */ }
    return caps;
  }

  function build(config) {
    const Cine = window.MR.Cine;
    const flags = Cine.flagsFromSearch(location.search);
    const info = Cine.envInfo(navigator, screen, window);
    if (flags.class) info.override = flags.class;
    const caps = probe(flags);
    const dec = Cine.decide(config, info, caps, flags);
    const st = dec.static, eff = dec.effective, g = st.guess || Cine.guessModel(info, config);
    const det = Object.assign({ plusRamGB: 8 }, (config && config.render && config.render.cine && config.render.cine.detect) || {});
    // 全画面（横向き）でのバッファ（ゲームは window の大きさ。アドレスバーで少し変わる）
    const sw = Math.max(info.screenW, info.screenH), sh = Math.min(info.screenW, info.screenH);
    const prFull = Cine.pixelRatio(eff.cls, sw, sh, info.dpr, config);
    const bufFull = Math.floor(sw * prFull) * Math.floor(sh * prFull);
    const out = {
      guess: { key: g.key, names: g.names, ramOf: g.ramOf, ramMin: g.ramMin, ramMax: g.ramMax },
      static: { cls: st.cls, reason: st.reason, kind: st.kind, ramGB: st.ramGB, osMajor: st.osMajor, ios16: st.ios16 },
      effective: { cls: eff.cls, reason: eff.reason },
      pixelCapMpx: +(dec.pixelCap / 1e6).toFixed(2), dprCap: dec.dprCap,
      window: { css: info.cssW + 'x' + info.cssH, pixelRatio: +dec.pixelRatio.toFixed(3), bufferMpx: +(dec.buffer / 1e6).toFixed(2) },
      fullscreen: { css: sw + 'x' + sh, pixelRatio: +prFull.toFixed(3), bufferMpx: +(bufFull / 1e6).toFixed(2) },
      gpu: caps.renderer, webgl2: caps.webgl2, astc: caps.astc, astcExt: caps.astcExt, hdrTarget: caps.hdrTarget, floatExt: caps.floatExt,
      cores: info.cores, maxTouchPoints: info.maxTouchPoints, ua: info.ua, platform: info.platform, screen: info.screenW + 'x' + info.screenH, dpr: info.dpr,
      budgetsGpuMB: dec.budgets && dec.budgets.gpuMB, flags
    };
    // 日本語のまとめ
    const L = [];
    const macUa = /Macintosh/.test(info.ua) && info.maxTouchPoints > 1;
    let model;
    if (g.names.length) model = g.names.join(' / ');
    else if (st.kind === 'desktop') model = 'PC / Mac（タッチ無し）';
    else model = '分からない（画面 ' + esc(g.key) + ' が表に無い）';
    L.push(['推定機種', esc(model) + '<br><small>画面 ' + esc(g.key) + '（CSS px の短い辺 × 長い辺 @ DPR）。Safari は機種名を出さないので画面の大きさから。' +
      (macUa ? ' UA は Mac の形（iPadOS の Safari）ですが、タッチ点 ' + info.maxTouchPoints + ' なので iPad と判定。' : '') + '</small>']);
    if (g.ramMin != null) {
      let ram = g.ramMin === g.ramMax ? g.ramMin + ' GB' : g.ramMin + '〜' + g.ramMax + ' GB → 分からないので控えめに ' + g.ramMin + ' GB とみなす';
      if (g.ramMin < det.plusRamGB && g.ramMax >= det.plusRamGB && st.kind !== 'desktop') {
        const big = g.names.filter((n) => g.ramOf && g.ramOf[n] >= det.plusRamGB);
        ram += '<br><small>' + (big.length ? '8 GB の機種（' + esc(big.join('・')) + '）' : '8 GB 以上の機種') + 'なら本当は ' +
          (st.kind === 'tablet' ? 'tabletPro' : 'phonePlus') + '。アプリ版は機種 id で正しく分かります。</small>';
      }
      L.push(['RAM', ram]);
    }
    L.push(['クラス', '静的 <b>' + esc(CLS_JA[st.cls] || st.cls) + '</b> → 実際 <b>' + esc(CLS_JA[eff.cls] || eff.cls) + '</b>' +
      '<br><small>静的の理由: ' + esc(st.reason) + ' ／ 実際の理由: ' + esc(eff.reason === 'ok' ? 'WebGL2・ASTC・HDR の描画先がそろっている' : eff.reason) + '</small>']);
    L.push(['描画の上限', out.pixelCapMpx + ' Mpx（DPR は ' + dec.dprCap + ' まで）<br><small>全画面 ' + sw + '×' + sh + ' なら pixelRatio ' + out.fullscreen.pixelRatio +
      ' → ' + out.fullscreen.bufferMpx + ' Mpx ／ 今の窓 ' + out.window.css + ' は ' + out.window.pixelRatio + ' → ' + out.window.bufferMpx + ' Mpx。GPU 予算 ' + (out.budgetsGpuMB || '?') + ' MB</small>']);
    L.push(['GPU・機能', esc(caps.renderer || '?') + ' ／ WebGL ' + (caps.webgl2 ? '2' : '1') + ' ／ ASTC ' + (caps.astc ? '○' : (caps.astcExt ? '×（上げられない）' : '×')) +
      ' ／ HDR 描画先 ' + (caps.hdrTarget ? '○' : '×') + ' ／ CPU コア ' + (info.cores || '?') + '<br><small>Safari は GPU を「Apple GPU」、コア数を 4 か 8 に丸めて出すので機種の決め手にはなりません。</small>']);
    L.push(['OS', st.osMajor != null ? 'iOS / iPadOS ' + st.osMajor + (st.ios16 ? '（16 以下: GPU 150 MB まで）' : '') : '分からない']);
    L.push(['UA', '<small>' + esc(info.ua) + '</small>']);
    const html = '<div class="devhead">端末の判定 — この枠をスクリーンショットしてください</div><table class="dev">' +
      L.map((r) => '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('') + '</table>' +
      '<div class="devask">スクリーンショットしてほしいもの: ① この枠 ② 下の「まとめ」のタイル（すべて実行が終わってから）③ 機能テストの表。' +
      'できれば最後に「コピー」を押して結果 JSON も送ってください。iPad は <code>?auto=1&amp;w=2064&amp;h=1548</code> でもう 1 回。</div>';
    return { out, html };
  }

  async function main() {
    const el = document.getElementById('device');
    if (!el) return;
    el.innerHTML = '端末を判定中…';
    const src = (window.MR && window.MR.Cine) ? 'ready' : await loadScript(['../js/cine.js', '../../www/js/cine.js']);
    if (!window.MR || !window.MR.Cine) { el.textContent = '端末の判定: cine.js を読めません'; window.__benchDevice = { error: 'no cine.js' }; return; }
    const game = await loadJson(['../assets/config/game.json', '../../assets/config/game.json']);
    try {
      const r = build(game || {});
      if (!game) r.out.note = 'game.json を読めないので機種の表なし';
      r.out.cineSrc = src;
      window.__benchDevice = r.out;
      el.innerHTML = r.html + (game ? '' : '<div class="devask">（game.json を読めないので機種の表なし）</div>');
    } catch (e) {
      window.__benchDevice = { error: String(e && e.message || e) };
      el.textContent = '端末の判定でエラー: ' + (e && e.message || e);
    }
    window.dispatchEvent(new Event('device-ready'));
  }
  window.__benchDeviceReady = new Promise((r) => window.addEventListener('device-ready', r, { once: true }));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
