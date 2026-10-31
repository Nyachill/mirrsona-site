// 端末のクラスと画質のはしご（MR.Cine）。THREE も DOM も使わない（Node の tools/cine-test.js も require する）。
// 計画: plans/nyc-cinematic.md rev 4 の §3.1（クラス）・§10.1（予算）・§11.2 / §11.3（はしご）。C0 では「計算して報告するだけ」:
//   画面の大きさ（pixelRatio）を変えるのは render.cine.applyCaps（既定 false）か URL の ?cinecaps=1 のときだけ（呼ぶ側 = cinebench.js が見る）。
//   はしごは決めたことを記録するだけで、描画は変えない（後のマイルストーンが report() を見て実行する）。
//
// ■ 使い方（cinebench.js / game.js から）
//   const flags = MR.Cine.flagsFromSearch(location.search);           // { class, noastc, webgl1, cinecaps, bench, memprobe }
//   const info  = MR.Cine.envInfo(navigator, screen, window)           // { touch, ua, platform, cssW, cssH, screenW, screenH, dpr, cores, ramGB }（+ 呼ぶ側で model / osVersion）
//   info.saver = MR.Session.saverActive…; info.override = flags.class;
//   const st    = MR.Cine.classify(info, game.config)                  // 静的なクラス { cls, reason, kind, ramGB, model, ios16, osMajor, … }
//   const caps  = MR.Cine.probeCaps(renderer.getContext(), flags)     // 生の WebGL の文脈（THREE なし）: webgl2 / astc / hdrTarget / 上限 …
//   const eff   = MR.Cine.effectiveClass(st, caps, flags)              // { cls, reason }
//   const dec   = MR.Cine.decide(game.config, info, caps, flags)       // 上の 3 つ + pixelRatio / pixelCap / dprCap / budgets / apply をまとめて
//   const lad   = new MR.Cine.Ladder({ config: game.config, cls: eff.cls, online, now: () => Date.now(), storage: localStorage,
//                                        visible: document.visibilityState === 'visible' });
//     launchId を渡さなければ、このページの読み込みで 1 つの id（MR.Cine.LAUNCH_ID）。「もう一度」で Ladder を作り直しても同じ起動。
//     前の起動で保存した段（persisted）は level と decisions（reason 'stored'）に入った状態で始まり、stepDown はその次の段から。
//     毎フレーム lad.sample({ t, intervalMs, cpuMs, streamerBusy, cam: {x,y,z} })（t は秒）
//     lad.onVisibility(visible) / lad.contextLost() / lad.memory(gpuMB) / lad.safePoint() / lad.report() / lad.debugLines()
//   MR.Cine.debugLines(dec, lad) は DEBUG の表示（左上）用の短い行。
//
// ■ 数値: game.json の render.cine（classes / ladder / online / applyCaps）と render.devices（機種 id → [RAM GB, 名前]）。無いキーは下の既定値。
//   予算の表は tools/cine-budget.json（Node は自動で読む。ブラウザは MR.Cine.setBudgets(json) か、classes の gpuMB だけ）。
//
// ■ 分かっている穴（C0b 以降）
//   - アプリ（Capacitor）の iPad の WKWebView の UA はデスクトップの形で 'Version/x Safari' も 'CPU OS' も無い。osVersion（@capacitor/device、
//     新しいアプリのビルドが要る）が無いと iOS の版が分からず ios16 = false（osUnknown = true）。呼ぶ側が機能で推し量った版を
//     info.osMajorHint に入れれば使う（例: Object.groupBy が無い → 17.3 以下とみなして 16 = 控えめ）。
//   - classifyWindow は §11.3 のとおり「中央値 33.3 ms + CPU < 10 ms」を capped（何もしない）にする。60 Hz の画面で GPU が重く vsync で
//     30 fps に落ちた iPhone もここに入り、下りない。はしごを実際に動かす（C1 以降）前に計画の持ち主と相談する。
//   - 段 1（MSAA → FXAA）は §11.3 の引き金が無いので stepDown('force', 1) でだけ下りる。
(function (root) {
  const MR = root.MR || (root.MR = {});

  const CLASS_NAMES = ['low', 'phone', 'phonePlus', 'tablet', 'tabletPro', 'desktop'];
  // px = 描画バッファの上限（Mpx）、dpr = クラスの DPR の上限、gpuMB = §10.1 の GPU 合計（はしごのメモリの引き金に使う）
  // post = ポストの描画の大きさ（CSS の画素の何倍。V2 R0）。null = レンダラーの DPR（desktop）
  const DEF_CLASSES = {
    low: { px: 0.75, dpr: 2, gpuMB: 180, post: 1 },
    phone: { px: 1.1, dpr: 3, gpuMB: 260, post: 1.3 },
    phonePlus: { px: 1.1, dpr: 3, gpuMB: 290, post: 1.3 },
    tablet: { px: 2.2, dpr: 2, gpuMB: 320, post: 1.15 },
    tabletPro: { px: 3.2, dpr: 2, gpuMB: 600, post: 1.25 },
    desktop: { px: 4, dpr: 2, gpuMB: 1000, post: null }
  };
  const DEF_DETECT = { lowRamGB: 3, plusRamGB: 8, tabletMinCss: 600, ios16Gpu: 150, ios16Audio: 90 };
  const DEF_LADDER = {
    windowFrames: 60, windowEvery: 60, sustain: 3, gapK: 2.5,
    idleSec: 5, camSec: 5, camMoveM: 2,
    capped: [[33.3, 1], [16.7, 0.5]], cpuCapped: 10, cpuBound: 12, gpuP90: 18.5, gpuCpuMax: 10,
    persistLaunches: 2, persistDays: 7, decayDays: 7, visibleBefore: 2, memFrac: 0.9, memCooldown: 30,
    storageKey: 'mirrsona.cineLadder'
  };
  const DEF_ONLINE = { fullIn: 100, fullOut: 124, fireEscapeDist: 25, detailDist: 45, ladderOff: [4, 5, 9], lens: false, wrecks: false, vignette: 0.35 };

  // §11.2 のはしご。kind: U = uniform だけ（いつでも）、T = テクスチャの差し替え（1 フレーム 1 枚まで）、P = プログラム / ターゲット
  // （安全な所でだけ）、L = 次の起動。steps = その段の中の段階。gpu / cpu / mem = どの引き金で下りるか。online: false = オンラインでは使わない。
  // classes = その段が意味を持つクラス（無ければ全部）
  const RUNGS = [
    { n: 0, id: 'defaults', kind: null, steps: [], change: 'class defaults', saves: '' },
    { n: 1, id: 'msaa', kind: 'L', steps: ['fxaa'], change: 'MSAA → FXAA', saves: '48 MB / Mpx', classes: ['tabletPro', 'desktop'] },
    { n: 2, id: 'interior', kind: 'U', steps: ['half', 'off'], change: 'interior distance ½ ring → 0', saves: 'GPU 6–12 %', gpu: true },
    { n: 3, id: 'probe', kind: 'U', steps: ['1/4', 'off'], change: 'probe 1 face / 2 frames → 1 / 4 → weight 0', saves: 'draws, GPU', gpu: true },
    { n: 4, id: 'life', kind: 'U', steps: ['-30%', 'nopeople'], change: 'life caps −30 % → people off', saves: '≤ 40 k triangles', cpu: true, online: false },
    { n: 5, id: 'details', kind: 'U', steps: ['30m', 'off'], change: 'instanced details → 30 m → off', saves: '20–40 k triangles', online: false },
    { n: 6, id: 'heroTex', kind: 'T', steps: ['512'], change: 'hero near textures 1024 → 512; near × 0.6', saves: '≈ 10–15 MB', mem: true },
    { n: 7, id: 'facadeLayers', kind: 'T', steps: ['half'], change: 'facade array layers 256 → 128 (tablet 512 → 256)', saves: '≈ 2 MB (tablet ≈ 6)', mem: true },
    { n: 8, id: 'scale', kind: 'P', steps: ['0.8', '0.6'], change: 'render scale (pixel cap × 0.8 → × 0.6)', saves: '≈ 10 → 20 MB, GPU 25–45 %', gpu: true },
    { n: 9, id: 'ring', kind: 'U', steps: ['85', '70'], change: 'detail ring fullIn 100 → 85 → 70 m; LOD −15 %', saves: 'geometry, draws', cpu: true, online: false },
    { n: 10, id: 'shadow', kind: 'P', steps: ['1024'], change: 'shadow map 2048 → 1024 (tabletPro)', saves: '25 MB', gpu: true, classes: ['tabletPro', 'desktop'] },
    { n: 11, id: 'low', kind: 'L', steps: ['low'], change: 'low', saves: 'everything', classes: ['phone', 'phonePlus', 'tablet', 'tabletPro', 'desktop'] }
  ];

  // このページの読み込みで 1 つ（Ladder の既定の launchId）
  const LAUNCH_ID = 'L' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);

  // ---------- 小物 ----------
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function merge(def, over) {
    const o = {};
    for (const k in def) o[k] = def[k];
    if (over && typeof over === 'object') for (const k in over) if (over[k] !== undefined) o[k] = over[k];
    return o;
  }
  function cineCfg(config) {
    const r = (config && config.render) || {};
    return r.cine || {};
  }
  function classTable(config) {
    const c = cineCfg(config).classes || {};
    const out = {};
    for (const n of CLASS_NAMES) out[n] = merge(DEF_CLASSES[n], c[n]);
    return out;
  }
  function detectCfg(config) { return merge(DEF_DETECT, cineCfg(config).detect); }
  function ladderCfg(config) { return merge(DEF_LADDER, cineCfg(config).ladder); }
  function devicesTable(config) { return (config && config.render && config.render.devices) || {}; }
  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function pct(a, p) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }
  function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; }

  // ---------- URL ----------
  // location.search の文字列から（window は読まない）
  function flagsFromSearch(search) {
    const f = { class: null, noastc: false, webgl1: false, cinecaps: false, bench: null, memprobe: false };
    const s = String(search || '').replace(/^\?/, '');
    if (!s) return f;
    const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } }; // 壊れた %xx はそのまま
    for (const part of s.split('&')) {
      const i = part.indexOf('=');
      const k = dec(i < 0 ? part : part.slice(0, i));
      const v = i < 0 ? '' : dec(part.slice(i + 1));
      const on = v === '' || v === '1' || v === 'true';
      if (k === 'class') f.class = CLASS_NAMES.indexOf(v) >= 0 ? v : null;
      else if (k === 'noastc') f.noastc = on;
      else if (k === 'webgl1') f.webgl1 = on;
      else if (k === 'cinecaps') f.cinecaps = on;
      else if (k === 'bench') f.bench = v || null; // ?bench=cine だけ（空の ?bench ではベンチにしない）
      else if (k === 'memprobe') f.memprobe = on;
    }
    return f;
  }

  // ---------- OS ----------
  // '16.7.2' か UA の 'OS 16_7 like Mac OS X' / 'Version/16.6'（iPadOS のデスクトップ UA）→ 16
  function iosMajor(info) {
    if (info.osVersion) {
      const m = /^(\d+)/.exec(String(info.osVersion));
      if (m) return +m[1];
    }
    const ua = String(info.ua || '');
    let m = /(?:iPhone|CPU) OS (\d+)_/.exec(ua);
    if (m) return +m[1];
    if (isAppleTouch(info)) {
      m = /Version\/(\d+)[.\d]* .*Safari/.exec(ua);
      if (m) return +m[1];
    }
    if (typeof info.osMajorHint === 'number' && isFinite(info.osMajorHint)) return info.osMajorHint;
    return null;
  }
  const APPLE_MODEL = /^(iPhone|iPad|iPod)\d/;
  // 表の中の一番古い（小さい）大きい番号。これより古い知らない id は low（iOS 15 が入る古い端末は 2〜3 GB）
  function oldestMajor(devs, fam) {
    let m = Infinity;
    for (const k in devs) { const r = new RegExp('^' + fam + '(\\d+),').exec(k); if (r) m = Math.min(m, +r[1]); }
    return m;
  }
  function isAppleTouch(info) {
    const ua = String(info.ua || ''), pf = String(info.platform || '');
    if (/iPhone|iPad|iPod/.test(ua) || /^(iPhone|iPad|iPod)/.test(pf)) return true;
    if (APPLE_MODEL.test(String(info.model || ''))) return true;
    // iPadOS 13+ の Safari はデスクトップの UA（MacIntel）。タッチがあれば iPad
    return !!info.touch && (pf === 'MacIntel' || /Macintosh/.test(ua));
  }

  // ---------- 静的なクラス（§3.1）----------
  // info: { touch, ua, platform, model, ramGB, cssW, cssH, dpr, osVersion, saver, override }
  function classify(info, config) {
    info = info || {};
    const det = detectCfg(config);
    const devs = devicesTable(config);
    const out = { cls: 'phone', reason: '', kind: 'phone', model: info.model || null, modelName: null, ramGB: null, ios16: false, osMajor: null, saver: !!info.saver, override: null };
    const ua = String(info.ua || '');
    const model = info.model ? String(info.model) : '';
    const appleModel = APPLE_MODEL.test(model); // シミュレーターの 'arm64' / 'x86_64' などは機種 id ではない → UA と画面で
    const row = appleModel && Array.isArray(devs[model]) ? devs[model] : null;
    if (row) { out.ramGB = typeof row[0] === 'number' ? row[0] : null; out.modelName = row[1] || null; }
    else if (typeof info.ramGB === 'number') out.ramGB = info.ramGB;
    // 端末の種類
    const apple = isAppleTouch(info);
    // Web 版（機種 id が無い）の Apple のタッチ端末: 画面の大きさ × DPR から同じ画面の機種を推し量り、その中の一番小さい RAM（控えめ）
    let guess = null;
    // （Safari は navigator.deviceMemory を出さない。出ていればエミュレーション（Chromium の 8）なので、画面が表にあればそちらを使う）
    if (!row && apple && !appleModel) {
      guess = guessModel(info, config);
      if (guess.ids.length) { out.guess = guess; out.ramGB = guess.ramMin; }
    }
    // 端末の種類は画面（screen）の短い辺で（Slide Over・狭い Split View の窓で iPad が phone にならない）。無ければ窓
    const sw = num(info.screenW, 0), sh = num(info.screenH, 0);
    const shortSide = (sw > 0 && sh > 0) ? Math.min(sw, sh) : Math.min(num(info.cssW, 0), num(info.cssH, 0));
    if (/^iPad/.test(model) || (!appleModel && apple && (/iPad/.test(ua) || /iPad/.test(String(info.platform || '')) || (!/iPhone|iPod/.test(ua) && shortSide >= det.tabletMinCss)))) out.kind = 'tablet';
    else if (/^iPhone|^iPod/.test(model) && appleModel || apple) out.kind = 'phone';
    else if (info.touch && (/Android|Mobile/.test(ua))) out.kind = shortSide >= det.tabletMinCss ? 'tablet' : 'phone';
    else if (info.touch && !/Windows|Linux x86|CrOS|X11/.test(ua + ' ' + (info.platform || ''))) out.kind = shortSide >= det.tabletMinCss ? 'tablet' : 'phone';
    else out.kind = 'desktop';
    out.touch = out.kind !== 'desktop';
    // iOS ≤ 16: WebGL がページのプロセスの中 → 予算に上限（§3.1）
    if (out.touch && apple) {
      out.osMajor = iosMajor(info);
      out.ios16 = out.osMajor != null && out.osMajor <= 16;
      out.osUnknown = out.osMajor == null;
    }
    // クラス
    let cls, reason;
    if (out.kind === 'desktop') { cls = 'desktop'; reason = 'no touch'; }
    else if (out.ramGB != null) {
      if (out.ramGB <= det.lowRamGB) { cls = 'low'; reason = out.ramGB + ' GB'; }
      else if (out.kind === 'tablet') { cls = out.ramGB >= det.plusRamGB ? 'tabletPro' : 'tablet'; reason = out.ramGB + ' GB'; }
      else { cls = out.ramGB >= det.plusRamGB ? 'phonePlus' : 'phone'; reason = out.ramGB + ' GB'; }
      if (row) reason = model + ' ' + reason;
      else if (guess && guess.ids.length) reason = 'screen ' + guess.key + ' ' + (guess.ramMin === guess.ramMax ? guess.ramMin : guess.ramMin + '-' + guess.ramMax) + ' GB' + (guess.ramMin !== guess.ramMax ? ' (min)' : '');
    } else if (appleModel && (/^iPod/.test(model) || +/(\d+),/.exec(model + ',')[1] < oldestMajor(devs, model.replace(/\d.*$/, '')))) {
      cls = 'low'; reason = 'old ' + model;   // 表より古い知らない機種（と知らない iPod）
    } else {
      cls = out.kind; reason = appleModel ? 'unknown ' + model : 'web ' + out.kind;
    }
    if (out.saver) { cls = 'low'; reason = 'saver'; }
    if (info.override && CLASS_NAMES.indexOf(info.override) >= 0) { out.override = info.override; cls = info.override; reason = 'override'; }
    out.cls = cls; out.reason = reason;
    return out;
  }

  // ---------- Web 版の機種の推定（画面の大きさ × DPR → render.screens）----------
  // iPhone / iPad の Safari は機種も RAM も出さない（GPU の文字列も 'Apple GPU'、hardwareConcurrency は 4 か 8 に丸める）。
  // 出しているのは screen.width / height（向きで入れ替わる）と devicePixelRatio だけなので、同じ画面の機種の一覧を返す。
  // 例: 393x852@3 = iPhone 14 Pro / 15 / 15 Pro / 16（6〜8 GB）、834x1194@2 = iPad Pro 11 第 1〜4 世代（4〜8 GB）、834x1210@2 = iPad Pro 11 (M4)。
  function guessModel(info, config) {
    info = info || {};
    const sw = num(info.screenW, 0), sh = num(info.screenH, 0), dpr = num(info.dpr, 0);
    const key = Math.round(Math.min(sw, sh)) + 'x' + Math.round(Math.max(sw, sh)) + '@' + Math.round(dpr);
    const out = { key, ids: [], names: [], ramOf: {}, ramMin: null, ramMax: null }; // ramOf: 名前 → RAM（GB）
    const tab = (config && config.render && config.render.screens) || {};
    const devs = devicesTable(config);
    const ids = sw > 0 && sh > 0 && Array.isArray(tab[key]) ? tab[key] : [];
    for (const id of ids) {
      const r = devs[id];
      if (!Array.isArray(r)) continue;
      out.ids.push(id);
      const nm = String(r[1] || id).replace(/ 1TB$/, '');
      if (out.names.indexOf(nm) < 0) out.names.push(nm);
      if (typeof r[0] === 'number') out.ramOf[nm] = Math.max(out.ramOf[nm] || 0, r[0]);
      if (typeof r[0] === 'number') { out.ramMin = out.ramMin == null ? r[0] : Math.min(out.ramMin, r[0]); out.ramMax = out.ramMax == null ? r[0] : Math.max(out.ramMax, r[0]); }
    }
    return out;
  }
  // ブラウザの navigator / screen / window から classify の info を作る（DOM のオブジェクトを受け取るだけ。Node のテストは偽物を渡す）
  function envInfo(nav, scr, win) {
    nav = nav || {}; scr = scr || {}; win = win || {};
    const tp = num(nav.maxTouchPoints, 0);
    return {
      touch: tp > 0 || ('ontouchstart' in win), maxTouchPoints: tp, ua: String(nav.userAgent || ''), platform: String(nav.platform || ''),
      cssW: num(win.innerWidth, 0), cssH: num(win.innerHeight, 0), screenW: num(scr.width, 0), screenH: num(scr.height, 0), dpr: num(win.devicePixelRatio, 1),
      cores: num(nav.hardwareConcurrency, 0) || null, ramGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined
    };
  }

  // ---------- GPU の機能を調べる（生の WebGL。THREE なし）----------
  // flags.noastc / flags.webgl1 は「無いことにする」（テスト用）。three の状態を崩さないよう、変えた bind は元に戻す。
  function probeCaps(gl, flags) {
    flags = flags || {};
    const caps = { webgl2: false, astcExt: false, astc: false, hdrTarget: false, floatExt: null, parallelCompile: false, timerQuery: false,
      maxTextureSize: 0, maxTextureUnits: 0, maxCombinedUnits: 0, maxVaryings: 0, maxAttribs: 0, maxFragUniforms: 0, maxVertUniforms: 0,
      maxSamples: 0, maxArrayLayers: 0, anisotropy: false, floatLinear: false, renderer: '', version: '', flags: { noastc: !!flags.noastc, webgl1: !!flags.webgl1 }, error: null };
    if (!gl) { caps.error = 'no context'; return caps; }
    try {
      const P = (e) => { try { return gl.getParameter(e); } catch (er) { return 0; } };
      const ext = (n) => { try { return gl.getExtension(n); } catch (er) { return null; } };
      const clearErr = () => { for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++) { /* 前の誤りを捨てる */ } };
      caps.version = String(P(gl.VERSION) || '');
      caps.webgl2 = /WebGL 2/.test(caps.version) || (typeof root.WebGL2RenderingContext !== 'undefined' && gl instanceof root.WebGL2RenderingContext);
      caps.maxTextureSize = P(gl.MAX_TEXTURE_SIZE) | 0;
      caps.maxTextureUnits = P(gl.MAX_TEXTURE_IMAGE_UNITS) | 0;
      caps.maxCombinedUnits = P(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) | 0;
      caps.maxVaryings = P(gl.MAX_VARYING_VECTORS) | 0;
      caps.maxAttribs = P(gl.MAX_VERTEX_ATTRIBS) | 0;
      caps.maxFragUniforms = P(gl.MAX_FRAGMENT_UNIFORM_VECTORS) | 0;
      caps.maxVertUniforms = P(gl.MAX_VERTEX_UNIFORM_VECTORS) | 0;
      if (caps.webgl2) { caps.maxSamples = P(gl.MAX_SAMPLES) | 0; caps.maxArrayLayers = P(gl.MAX_ARRAY_TEXTURE_LAYERS) | 0; }
      caps.parallelCompile = !!ext('KHR_parallel_shader_compile');
      caps.timerQuery = !!(ext('EXT_disjoint_timer_query_webgl2') || ext('EXT_disjoint_timer_query'));
      caps.anisotropy = !!ext('EXT_texture_filter_anisotropic');
      caps.floatLinear = !!ext('OES_texture_float_linear');
      const dbg = ext('WEBGL_debug_renderer_info');
      caps.renderer = String((dbg && P(dbg.UNMASKED_RENDERER_WEBGL)) || P(gl.RENDERER) || '');
      const prevTex = P(gl.TEXTURE_BINDING_2D) || null;
      // ASTC: 拡張がある + 4×4 の 1 ブロック（16 バイト）を上げて GL の誤りが無い
      const astc = ext('WEBGL_compressed_texture_astc');
      caps.astcExt = !!astc;
      if (astc && astc.COMPRESSED_RGBA_ASTC_4x4_KHR) {
        clearErr();
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        const block = new Uint8Array(16);
        block[0] = 0xfc; block[1] = 0xfd; block[2] = 0xff; block[3] = 0xff; block[4] = 0xff; block[5] = 0xff; block[6] = 0xff; block[7] = 0xff; // 定数色のブロック（void-extent）
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, astc.COMPRESSED_RGBA_ASTC_4x4_KHR, 4, 4, 0, block);
        caps.astc = gl.getError() === gl.NO_ERROR;
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.deleteTexture(t);
      }
      // HDR のターゲット: RGBA16F の framebuffer が complete
      if (caps.webgl2) {
        const f32 = ext('EXT_color_buffer_float'), f16 = f32 ? null : ext('EXT_color_buffer_half_float');
        caps.floatExt = f32 ? 'EXT_color_buffer_float' : (f16 ? 'EXT_color_buffer_half_float' : null);
        if (caps.floatExt) {
          clearErr();
          const prevFb = P(gl.FRAMEBUFFER_BINDING) || null;
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
          caps.hdrTarget = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
          gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
          gl.bindTexture(gl.TEXTURE_2D, prevTex);
          gl.deleteFramebuffer(fb);
          gl.deleteTexture(t);
          clearErr();
        }
      }
    } catch (e) { caps.error = String(e && e.message || e); }
    if (flags.noastc) caps.astc = false;
    if (flags.webgl1) { caps.webgl2 = false; caps.hdrTarget = false; }
    return caps;
  }

  // ---------- 実際に使うクラス（§3.1）----------
  // タッチ: WebGL2 + ASTC + HDR のターゲットがそろえば静的なクラス、どれかが無ければ low。デスクトップ: WebGL2 が無ければ low。
  // ?class= で決めたクラスはテスト用に機能の確かめを飛ばす（SwiftShader には ASTC が無い）。ただし ?noastc=1 / ?webgl1=1 は必ず low。
  function effectiveClass(st, caps, flags) {
    flags = flags || {};
    caps = caps || {};
    const cls = st.cls;
    if (flags.noastc || flags.webgl1) return { cls: 'low', reason: flags.webgl1 ? 'webgl1 flag' : 'noastc flag' };
    if (cls === 'low') return { cls, reason: 'static low' };
    if (st.override) return { cls, reason: 'override' };
    if (cls === 'desktop') return caps.webgl2 ? { cls, reason: 'ok' } : { cls: 'low', reason: 'no webgl2' };
    if (!caps.webgl2) return { cls: 'low', reason: 'no webgl2' };
    if (!caps.astc) return { cls: 'low', reason: caps.astcExt ? 'astc upload failed' : 'no astc' };
    if (!caps.hdrTarget) return { cls: 'low', reason: 'no hdr target' };
    return { cls, reason: 'ok' };
  }

  // ---------- 描画バッファ（§3.1 / §10.2）----------
  function pixelRatio(cls, cssW, cssH, dpr, config) {
    const c = classTable(config)[cls] || DEF_CLASSES.phone;
    const area = Math.max(1, num(cssW, 1) * num(cssH, 1));
    return Math.min(c.dpr, Math.max(0.25, num(dpr, 1)), Math.sqrt(c.px * 1e6 / area));
  }
  function pixelCap(cls, config) { return (classTable(config)[cls] || DEF_CLASSES.phone).px * 1e6; }
  // ポスト（EffectComposer）の描画の大きさ s（CSS の画素 × s。cinematic-interiors V2 R0）。o: { cls, cssW, cssH, rendererDpr, saver, look, ladder }
  //   s = クラスの post（null = レンダラーの DPR）を レンダラーの DPR・クラスの px（Mpx）で切る（1 より下にはしない = 前と同じ）× はしごの段 8。
  //   省メモリ・look: false（?look=0 / render.look.enabled false）は 1（前と同じ = CSS の画素）
  function renderScale(config, o) {
    o = o || {};
    if (o.saver || o.look === false) return 1;
    const c = classTable(config)[o.cls] || classTable(config).phone;
    const dpr = Math.max(1, num(o.rendererDpr, 1));
    const post = (typeof c.post === 'number' && c.post > 0) ? c.post : dpr;
    const area = Math.max(1, num(o.cssW, 1) * num(o.cssH, 1));
    const s = Math.max(1, Math.min(post, dpr, Math.sqrt(c.px * 1e6 / area)));
    const k = num(o.ladder, 1);
    return Math.round(s * (k > 0 ? k : 1) * 1000) / 1000;
  }

  // ---------- 予算（§10.1）----------
  let budgetTable = null;
  function setBudgets(t) { budgetTable = t || null; }
  function loadBudgets() {
    if (budgetTable) return budgetTable;
    if (typeof module !== 'undefined' && typeof require === 'function' && typeof __dirname === 'string') {
      try { budgetTable = require(require('path').join(__dirname, '..', '..', 'tools', 'cine-budget.json')); } catch (e) { /* 無ければ classes の gpuMB だけ */ }
    }
    return budgetTable;
  }
  // cls の予算。ios16 なら gpuMB / audioMB を上限で切る。table を渡さなければ tools/cine-budget.json（Node）か setBudgets のもの
  function budgets(cls, ios16, table, config) {
    const t = table || loadBudgets();
    const row = t && t.budgets && t.budgets[cls];
    const out = row ? merge({}, row) : { gpuMB: (classTable(config)[cls] || DEF_CLASSES.phone).gpuMB };
    out.cls = cls;
    if (ios16) {
      const caps = (t && t.ios16) || {};
      const det = detectCfg(config);
      const g = num(caps.gpuMB, det.ios16Gpu), a = num(caps.audioMB, det.ios16Audio);
      if (out.gpuMB != null) out.gpuMB = Math.min(out.gpuMB, g); else out.gpuMB = g;
      if (out.audioMB != null) out.audioMB = Math.min(out.audioMB, a); else out.audioMB = a;
      if (out.transientMB != null) out.transientMB = Math.min(out.transientMB, g);
      out.ios16 = true;
    }
    return out;
  }

  // オンラインの決まった値（§7.3）: どのクラスでも同じ
  function onlineProfile(cls, config) {
    const o = merge(DEF_ONLINE, cineCfg(config).online);
    o.ladderOff = (o.ladderOff || []).slice();
    return o;
  }

  // まとめて決める（cinebench.js / game.js 用）
  function decide(config, info, caps, flags) {
    flags = flags || {};
    info = merge(info || {}, {});
    if (flags.class && !info.override) info.override = flags.class;
    const st = classify(info, config);
    const eff = effectiveClass(st, caps, flags);
    const pr = pixelRatio(eff.cls, info.cssW, info.cssH, info.dpr, config);
    const cfg = cineCfg(config);
    return {
      static: st, effective: eff, cls: eff.cls, caps: caps || null,
      pixelRatio: pr, pixelCap: pixelCap(eff.cls, config), dprCap: classTable(config)[eff.cls].dpr,
      buffer: Math.floor(num(info.cssW, 0) * pr) * Math.floor(num(info.cssH, 0) * pr), // three の setSize と同じ切り捨て
      budgets: budgets(eff.cls, st.ios16, null, config),
      apply: !!(cfg.applyCaps || flags.cinecaps)
    };
  }

  // ---------- 1 つの窓（60 フレーム）の分類（§11.3）----------
  // capped（33.3 / 16.7 ms に張り付き + CPU が軽い = 低電力・画面の上限 → 何もしない）/ cpu / gpu / ok
  function classifyWindow(intervals, cpuMs, config) {
    const L = (config && config.windowFrames != null && config.cpuBound != null) ? config : ladderCfg(config);
    const med = median(intervals), p90 = pct(intervals, 0.9);
    const cpu = Array.isArray(cpuMs) ? mean(cpuMs) : num(cpuMs, 0);
    const res = { kind: 'ok', median: med, p90, cpu };
    if (cpu > L.cpuBound) res.kind = 'cpu';
    else if (cpu < L.cpuCapped && L.capped.some((c) => Math.abs(med - c[0]) <= c[1])) res.kind = 'capped';
    else if (p90 > L.gpuP90 && cpu < L.gpuCpuMax) res.kind = 'gpu';
    return res;
  }

  // ---------- はしご（§11.2 / §11.3）----------
  // opts: { config, cls, online, now: () => ms, storage: { getItem, setItem }, launchId（既定 LAUNCH_ID = このページの読み込み）, visible }
  // C0 では決めたことを記録するだけ（decisions / pending / persisted）。描画を変えるのは後のマイルストーン。
  function Ladder(opts) {
    opts = opts || {};
    this.cfg = ladderCfg(opts.config);
    this.config = opts.config || null;
    this.cls = opts.cls || 'phone';
    this.online = !!opts.online;
    this.now = opts.now || (() => Date.now());
    this.storage = opts.storage !== undefined ? opts.storage : safeStorage(root);
    this.launchId = opts.launchId != null ? opts.launchId : LAUNCH_ID; // 時刻でなくてよい（引き金の時刻は別に持つ）
    this.level = {};          // 段 id → 下りた段階の数（このセッション）
    this.decisions = [];      // { t, rung, id, kind, step, reason, state: 'applied' | 'pending' | 'nextLaunch' }
    this.pending = [];        // P の段（安全な所を待つ）
    this.windows = [];        // 最近の窓の結果（最大 20）
    this.streak = { gpu: 0, cpu: 0, lastAt: -1e9, kind: null };
    this.lastWindowAt = -1e9; // 秒
    this.win = null;          // 集めている窓 { intervals, cpu, startT }
    this.lastBusyT = null;
    this.camHist = [];
    this.gateOpen = false;
    this.visible = opts.visible !== undefined ? !!opts.visible : true; this.visibleSince = this.now(); // 見え始めは作った時
    this.memAt = null;        // 最後にメモリで下りた時刻（ms）
    this.contextLosses = { counted: 0, ignored: 0 };
    this.refuseOptional = false;
    this.persisted = [];      // 前の起動からの（まだ 7 日たっていない）下げた段
    this._load();
  }
  function safeStorage(r) {
    try { return r.localStorage || null; } catch (e) { return null; }
  }
  Ladder.RUNGS = RUNGS;
  Ladder.prototype._read = function () {
    if (!this.storage) return null;
    try { const s = this.storage.getItem(this.cfg.storageKey); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  };
  Ladder.prototype._write = function (rec) {
    if (!this.storage) return false;
    try { this.storage.setItem(this.cfg.storageKey, JSON.stringify(rec)); return true; } catch (e) { return false; }
  };
  // 7 日より古い引き金・保存した段を捨てる。残っている保存した段は persisted（次の起動で使う = L 扱い）
  Ladder.prototype._load = function () {
    const rec = this._read() || {};
    const now = this.now(), day = 86400000;
    const trig = {}, stored = {};
    for (const k in (rec.triggers || {})) {
      // 1 回 = { id: 起動 id, t: 時刻 }（古い形の数字は id も時刻も同じ）
      const l = (Array.isArray(rec.triggers[k]) ? rec.triggers[k] : []).map((x) => typeof x === 'number' ? { id: x, t: x } : x)
        .filter((x) => x && typeof x.t === 'number' && now - x.t <= this.cfg.persistDays * day);
      if (l.length) trig[k] = l;
    }
    for (const k in (rec.stored || {})) {
      const t = rec.stored[k];
      if (typeof t === 'number' && now - t <= this.cfg.decayDays * day) stored[k] = t;
    }
    this.rec = { cls: rec.cls || this.cls, triggers: trig, stored };
    if (rec.cls && rec.cls !== this.cls) this.rec = { cls: this.cls, triggers: {}, stored: {} }; // クラスが変わったら（別の端末・設定）忘れる
    this.persisted = Object.keys(this.rec.stored).map((k) => ({ key: k, since: this.rec.stored[k] }));
    this._write(this.rec);
    // 保存した段はこの起動の始めから下りている: level に入れ、decisions に 'stored'（起動時 = 安全な所なので P / L も applied）
    const best = {};
    for (const p of this.persisted) {
      const m = /^(\d+):(\d+)$/.exec(p.key), r = m && RUNGS[+m[1]];
      if (!r || !r.kind) continue;
      if (this.online && r.online === false) continue;
      if (r.classes && r.classes.indexOf(this.cls) < 0) continue;
      const k = Math.min(+m[2], r.steps.length);
      if (k > (best[r.n] || 0)) best[r.n] = k;
    }
    for (const n in best) {
      const r = RUNGS[n];
      this.level[r.id] = best[n];
      this.decisions.push({ t: now, rung: r.n, id: r.id, kind: r.kind, step: r.steps[best[n] - 1], reason: 'stored', state: 'applied', stored: true });
    }
  };
  Ladder.prototype.rung = function (n) { return RUNGS[n] || null; };
  Ladder.prototype.usable = function (r) {
    if (!r || !r.kind) return false;
    if (this.online && r.online === false) return false;
    if (r.classes && r.classes.indexOf(this.cls) < 0) return false;
    return (this.level[r.id] || 0) < r.steps.length;
  };
  // 窓の外の判定: 読み込みが streamerIdle 秒止まっていて、カメラが camSec 秒前の位置から camMoveM m 以内
  Ladder.prototype._gate = function (t, busy, cam) {
    const L = this.cfg;
    if (busy || this.lastBusyT == null) this.lastBusyT = t; // 始まりは読み込み中と同じ（最初の街の画面では測らない）
    if (cam) {
      this.camHist.push({ t, x: cam.x || 0, y: cam.y || 0, z: cam.z || 0 });
      while (this.camHist.length > 1 && this.camHist[1].t <= t - L.camSec) this.camHist.shift();
    }
    if (t - this.lastBusyT < L.idleSec) return false;
    if (!cam || !this.camHist.length) return true;
    const old = this.camHist[0];
    if (t - old.t < L.camSec - 1e-6) return false; // まだ 5 秒ぶんの記録が無い
    const dx = cam.x - old.x, dy = cam.y - old.y, dz = cam.z - old.z;
    return dx * dx + dy * dy + dz * dz <= L.camMoveM * L.camMoveM;
  };
  // 毎フレーム: { t（秒）, intervalMs（rAF の間隔）, cpuMs（_loop の JS 時間）, streamerBusy, cam }
  // 窓が 1 つ終わったら結果（{ kind, … }）を返す。下りたら結果の decision に入る
  Ladder.prototype.sample = function (s) {
    const L = this.cfg, t = s.t;
    this.gateOpen = this._gate(t, !!s.streamerBusy, s.cam || null);
    if (!this.gateOpen || !this.visible) { this.win = null; return null; }
    if (!this.win) {
      if (t - this.lastWindowAt < L.windowEvery) return null;
      this.win = { intervals: [], cpu: [], startT: t };
      return null; // 最初のフレームの間隔は窓の前のものなので数えない
    }
    this.win.intervals.push(num(s.intervalMs, 0));
    this.win.cpu.push(num(s.cpuMs, 0));
    if (this.win.intervals.length < L.windowFrames) return null;
    const res = classifyWindow(this.win.intervals, this.win.cpu, L);
    res.t = this.win.startT;
    this.lastWindowAt = this.win.startT;
    this.win = null;
    this._onWindow(res);
    return res;
  };
  Ladder.prototype._onWindow = function (res) {
    const L = this.cfg;
    this.windows.push({ t: res.t, kind: res.kind, median: +res.median.toFixed(2), p90: +res.p90.toFixed(2), cpu: +res.cpu.toFixed(2) });
    if (this.windows.length > 20) this.windows.shift();
    const st = this.streak;
    // 窓どうしが windowEvery × gapK 秒より離れたら（ゲートで止まっていた）続きにしない
    const gap = res.t - st.lastAt > L.windowEvery * L.gapK;
    if (res.kind === 'gpu' || res.kind === 'cpu') {
      if (gap || st.kind !== res.kind) { st.gpu = 0; st.cpu = 0; }
      st[res.kind]++;
      st.kind = res.kind;
    } else { st.gpu = 0; st.cpu = 0; st.kind = null; }
    st.lastAt = res.t;
    if (st.gpu >= L.sustain) { st.gpu = 0; res.decision = this.stepDown('gpu'); }
    else if (st.cpu >= L.sustain) { st.cpu = 0; res.decision = this.stepDown('cpu'); }
  };
  // 次の段へ 1 つ下りる（上がることはない）。reason: 'gpu' | 'cpu' | 'mem' | 'force'
  Ladder.prototype.stepDown = function (reason, n) {
    let r = null;
    if (n != null) r = this.usable(RUNGS[n]) ? RUNGS[n] : null;
    else {
      const key = reason === 'gpu' ? 'gpu' : reason === 'cpu' ? 'cpu' : 'mem';
      r = RUNGS.find((x) => x[key] && this.usable(x)) || null;
      // GPU / メモリの段が尽きたら 11（low、次の起動）。CPU は下の読み込みの予算
      if (!r && key !== 'cpu' && this.usable(RUNGS[11])) r = RUNGS[11];
    }
    if (!r) {
      // CPU の段が尽きたら読み込みの予算（streamer）を下げる記録だけ
      const d = { t: this.now(), rung: null, id: reason === 'cpu' ? 'streamerBudget' : 'none', kind: reason === 'cpu' ? 'U' : null, step: null, reason, state: reason === 'cpu' ? 'applied' : 'none' };
      this.decisions.push(d);
      return d;
    }
    const lv = (this.level[r.id] || 0);
    this.level[r.id] = lv + 1;
    const d = { t: this.now(), rung: r.n, id: r.id, kind: r.kind, step: r.steps[lv], reason, state: r.kind === 'P' ? 'pending' : r.kind === 'L' ? 'nextLaunch' : 'applied' };
    this.decisions.push(d);
    if (r.kind === 'P') this.pending.push(d);
    d.stored = this._trigger(r.n + ':' + (lv + 1));
    return d;
  };
  // 同じ段が 7 日以内に 2 回の起動で起きたら保存する（同じ起動で何度起きても 1 回）
  Ladder.prototype._trigger = function (key) {
    const rec = this.rec;
    const l = rec.triggers[key] || (rec.triggers[key] = []);
    if (!l.some((x) => x.id === this.launchId)) l.push({ id: this.launchId, t: this.now() });
    let stored = false;
    if (l.length >= this.cfg.persistLaunches && !rec.stored[key]) { rec.stored[key] = this.now(); stored = true; }
    this._write(rec);
    return stored;
  };
  // 安全な所（死亡画面・全体の地図・読み込み・映画のカメラの停止）: 待っていた P の段を「使った」にして返す
  Ladder.prototype.safePoint = function () {
    const out = this.pending.splice(0);
    for (const d of out) { d.state = 'applied'; d.appliedAt = this.now(); }
    return out;
  };
  // 見える / 見えない（document.visibilityState）
  Ladder.prototype.onVisibility = function (visible) {
    if (visible && !this.visible) this.visibleSince = this.now();
    if (!visible) this.win = null;
    this.visible = !!visible;
  };
  // WebGL の文脈が消えた。見えていて、その前 visibleBefore 秒も見えていたときだけ数える（裏での消失は数えない）
  Ladder.prototype.contextLost = function () {
    const ok = this.visible && this.now() - this.visibleSince >= this.cfg.visibleBefore * 1000;
    if (ok) this.contextLosses.counted++; else this.contextLosses.ignored++;
    return ok;
  };
  // GPU の MB（gpuStats）: クラスの gpuMB × memFrac を超えたら任意の upload を断り、テクスチャの段（6 / 7）
  Ladder.prototype.memory = function (gpuMB, ios16) {
    const lim = budgets(this.cls, ios16, null, this.config).gpuMB * this.cfg.memFrac;
    if (!(gpuMB > lim)) return null;
    this.refuseOptional = true;
    // 最初に超えたら段 6、memCooldown 秒たってもまだ超えていれば次の段（7 → 尽きたら 11）
    const now = this.now();
    if (this.memAt != null && now - this.memAt < this.cfg.memCooldown * 1000) return null;
    this.memAt = now;
    return this.stepDown('mem');
  };
  // 段 8（render scale）の今の倍率: 安全な所で使った（applied）段階だけ。待っている（pending）段階は数えない
  Ladder.prototype.renderScale = function () {
    let k = 1;
    for (const d of this.decisions) if (d.id === 'scale' && d.state === 'applied') { const v = parseFloat(d.step); if (v > 0 && v < k) k = v; }
    return k;
  };
  Ladder.prototype.report = function () {
    return {
      cls: this.cls, online: this.online, gate: this.gateOpen, level: merge({}, this.level),
      decisions: this.decisions.slice(), pending: this.pending.map((d) => d.id + ':' + d.step),
      persisted: this.persisted.slice(), windows: this.windows.slice(), streak: { gpu: this.streak.gpu, cpu: this.streak.cpu },
      contextLosses: merge({}, this.contextLosses), refuseOptional: this.refuseOptional
    };
  };
  Ladder.prototype.debugLines = function () {
    const w = this.windows[this.windows.length - 1];
    const last = this.decisions[this.decisions.length - 1];
    return [
      'ladder ' + (this.gateOpen ? 'measuring' : 'wait') + ' gpu ' + this.streak.gpu + ' cpu ' + this.streak.cpu +
        (w ? ' | ' + w.kind + ' ' + w.median + '/' + w.p90 + 'ms cpu ' + w.cpu : ''),
      'rungs ' + (last ? last.rung + ' ' + last.id + ':' + last.step + ' ' + last.state : 'none') +
        (this.pending.length ? ' pending ' + this.pending.length : '') + (this.persisted.length ? ' stored ' + this.persisted.map((p) => p.key).join(',') : '')
    ];
  };

  // DEBUG の表示用の行（decide() の結果）
  function debugLines(dec, ladder) {
    if (!dec) return [];
    const st = dec.static, eff = dec.effective, c = dec.caps || {};
    const lines = [
      'cine ' + st.cls + (eff.cls !== st.cls ? '→' + eff.cls : '') + ' (' + (eff.reason === 'ok' ? st.reason : eff.reason) + ')' +
        (st.ios16 ? ' iOS' + st.osMajor : '') + ' pr ' + dec.pixelRatio.toFixed(2) + ' ' + (dec.buffer / 1e6).toFixed(2) + '/' + (dec.pixelCap / 1e6).toFixed(2) + 'Mpx' +
        (dec.apply ? ' applied' : ' report'),
      'gl' + (c.webgl2 ? '2' : '1') + ' astc ' + (c.astc ? 'y' : 'n') + ' hdr ' + (c.hdrTarget ? 'y' : 'n') + ' psc ' + (c.parallelCompile ? 'y' : 'n') +
        ' tex ' + (c.maxTextureSize || 0) + ' units ' + (c.maxTextureUnits || 0) + ' gpu≤' + (dec.budgets && dec.budgets.gpuMB) + 'MB'
    ];
    return ladder ? lines.concat(ladder.debugLines()) : lines;
  }

  const Cine = {
    CLASSES: CLASS_NAMES, DEF_CLASSES, RUNGS, LAUNCH_ID,
    classTable, flagsFromSearch, iosMajor, classify, guessModel, envInfo, probeCaps, effectiveClass,
    pixelRatio, pixelCap, renderScale, budgets, setBudgets, onlineProfile, decide, classifyWindow, Ladder, debugLines,
    _median: median, _pct: pct
  };
  MR.Cine = Cine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cine;
})(typeof window !== 'undefined' ? window : globalThis);
