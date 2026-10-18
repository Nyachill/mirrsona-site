// テクスチャを Canvas で生成する（画像ファイル無しで PBR 風の質感を作る）。
// 本物の画像（assets/<tier>/textures/<mat>/）への差し替えは materials.js（MR.Materials）が行う。
// ここの Canvas 版は、画像が無いとき／届くまでのフォールバックとして使われる。
// MR.Textures.anisotropy（既定 4）を変えると、それ以降に作るカラーテクスチャの異方性フィルタに反映される。
window.MR = window.MR || {};

// 16進カラー → リニア色。r128 は色をそのままリニアとして扱うので、outputEncoding = sRGB の時は
// hex で指定した色をこれで変換しないと白っぽく浮く。
MR.srgb = function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); };

MR.Textures = (function () {
  const cache = {};

  function canvas(size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }

  // 1 歩ずつ進める版（ジェネレーター）と、すぐ全部の版（drain）。同じ結果（乱数の使う順番も同じ）。
  //   ジェネレーターは ROWS 行ごとに yield する（256² で 1 回 0.2〜0.5 ms）。街の読み込み（materials.js の prepare）が
  //   画像の無い端末で Canvas のテクスチャを 1 フレームの予算の中で少しずつ作るのに使う（MR.Textures.job）
  const ROWS = 16;
  function drain(it) { for (;;) { const r = it.next(); if (r.done) return r.value; } }

  // 値ノイズ（滑らか）。seed が同じなら同じ模様
  function* noiseGen(size, seed, octaves, scale) {
    const rnd = MR.seededRandom(seed);
    const grid = 32;
    const base = new Float32Array(grid * grid);
    for (let i = 0; i < base.length; i++) base[i] = rnd();
    const out = new Float32Array(size * size);
    let amp = 1, freq = scale, total = 0;
    for (let o = 0; o < octaves; o++) {
      for (let y = 0; y < size; y += ROWS) {
        noiseRows(out, size, grid, freq, amp, base, y, Math.min(size, y + ROWS));
        yield;
      }
      total += amp; amp *= 0.5; freq *= 2;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  // 重い内側のループはふつうの関数に（ジェネレーターの中のループは V8 で遅かった）
  function smooth(t) { return t * t * (3 - 2 * t); }
  function noiseSample(base, grid, x, y) {
    const gx = ((x % grid) + grid) % grid, gy = ((y % grid) + grid) % grid;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = (x0 + 1) % grid, y1 = (y0 + 1) % grid;
    const tx = smooth(gx - x0), ty = smooth(gy - y0);
    const a = base[y0 * grid + x0], b = base[y0 * grid + x1], c = base[y1 * grid + x0], d = base[y1 * grid + x1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }
  function noiseRows(out, size, grid, freq, amp, base, y0, y1) {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < size; x++) {
        out[y * size + x] += noiseSample(base, grid, x / size * grid * freq, y / size * grid * freq) * amp;
      }
    }
  }
  function makeNoise(size, seed, octaves, scale) { return drain(noiseGen(size, seed, octaves, scale)); }

  // 高さマップ → 法線マップ
  function* normalGen(height, size, strength) {
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y += ROWS * 2) {
      normalRows(height, size, strength, d, y, Math.min(size, y + ROWS * 2));
      yield;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function colorTexture(c, srgb) {
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (srgb !== false) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = (typeof T.anisotropy === 'number' && T.anisotropy > 0) ? T.anisotropy : 4;
    return tex;
  }

  function hexToRgb(hex) {
    const c = new THREE.Color(hex);
    return [c.r * 255, c.g * 255, c.b * 255];
  }

  function normalRows(height, size, strength, d, y0, y1) {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < size; x++) {
        const l = height[y * size + ((x - 1 + size) % size)], r = height[y * size + ((x + 1) % size)];
        const u = height[((y - 1 + size) % size) * size + x], b = height[((y + 1) % size) * size + x];
        let nx = (l - r) * strength, ny = (u - b) * strength, nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * size + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }
  }

  // ノイズで色を揺らした基本テクスチャ（地面・コンクリート・金属に共通）
  function* surfaceGen(opts) {
    const size = opts.size || 512;
    const n1 = yield* noiseGen(size, opts.seed, 4, 2);
    const n2 = yield* noiseGen(size, opts.seed + 99, 2, 12);
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const [r, g, b] = hexToRgb(opts.color);
    const amount = opts.variation || 30;
    const speck = opts.speckle || 0;
    const rnd = MR.seededRandom(opts.seed + 7);
    const rowPx = size * ROWS * 2;
    for (let i = 0; i < size * size; i += rowPx) {
      surfacePixels(d, n1, n2, r, g, b, amount, speck, rnd, i, Math.min(size * size, i + rowPx));
      yield;
    }
    ctx.putImageData(img, 0, 0);
    if (opts.draw) opts.draw(ctx, size, rnd);
    yield;
    const map = colorTexture(c);
    const normal = yield* normalGen(n1, size, opts.normalStrength || 1.5);
    return { map, normal };
  }

  function surfacePixels(d, n1, n2, r, g, b, amount, speck, rnd, i0, i1) {
    for (let i = i0; i < i1; i++) {
      let v = (n1[i] - 0.5) * amount + (n2[i] - 0.5) * amount * 0.5;
      if (speck && rnd() < speck) v += (rnd() - 0.3) * 60;
      const o = i * 4;
      d[o] = Math.max(0, Math.min(255, r + v));
      d[o + 1] = Math.max(0, Math.min(255, g + v));
      d[o + 2] = Math.max(0, Math.min(255, b + v));
      d[o + 3] = 255;
    }
  }

  function wallPixels(d, n, r, g, b, i0, i1) {
    for (let i = i0; i < i1; i++) {
      const v = (n[i] - 0.5) * 24, k = i * 4;
      d[k] = r + v; d[k + 1] = g + v; d[k + 2] = b + v; d[k + 3] = 255;
    }
  }

  // ジェネレーターの版（MR.Textures.job）: T の同じ名前の関数と同じものを同じキャッシュに作る（キャッシュにあればすぐ返す）
  const G = {
    // 地面: 乾いた土＋コンクリートの広場
    *ground() {
      if (cache.ground) return cache.ground;
      return (cache.ground = yield* surfaceGen({
        seed: 11, color: '#6b655a', variation: 34, speckle: 0.004, normalStrength: 2.2,
        draw(ctx, s) {
          // 大きな舗装パネルの継ぎ目
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 3;
          ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
          ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
        }
      }));
    },

    // 道路: アスファルト＋白線
    *road() {
      if (cache.road) return cache.road;
      return (cache.road = yield* surfaceGen({
        seed: 23, color: '#3b3c40', variation: 22, speckle: 0.01, normalStrength: 1.2,
        draw(ctx, s) {
          ctx.fillStyle = 'rgba(235,225,200,0.75)';
          // 中央の破線（横方向にタイルする前提: 画像の横がタイヤの進行方向）
          for (let x = 0; x < s; x += s / 2) ctx.fillRect(x + s * 0.08, s / 2 - 4, s * 0.3, 8);
          // 路肩線
          ctx.fillRect(0, 10, s, 5);
          ctx.fillRect(0, s - 15, s, 5);
        }
      }));
    },

    *concrete() {
      if (cache.concrete) return cache.concrete;
      return (cache.concrete = yield* surfaceGen({
        seed: 37, color: '#9b968d', variation: 24, speckle: 0.003, normalStrength: 1.6,
        draw(ctx, s, rnd) {
          // 汚れ
          for (let i = 0; i < 14; i++) {
            const g = ctx.createRadialGradient(rnd() * s, rnd() * s, 0, rnd() * s, rnd() * s, 40 + rnd() * 90);
            g.addColorStop(0, 'rgba(40,35,30,0.18)');
            g.addColorStop(1, 'rgba(40,35,30,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, s, s);
          }
        }
      }));
    },

    // コンテナや金属の板。縦のリブは形状で作るのでここは傷と塗装ムラ
    *metal(colorHex, seed) {
      const key = 'metal' + colorHex;
      if (cache[key]) return cache[key];
      return (cache[key] = yield* surfaceGen({
        seed: seed || 51, color: colorHex, variation: 26, speckle: 0.002, normalStrength: 0.8,
        draw(ctx, s, rnd) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 25; i++) {
            ctx.beginPath();
            const x = rnd() * s, y = rnd() * s;
            ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60);
            ctx.stroke();
          }
          // 錆
          ctx.fillStyle = 'rgba(120,80,40,0.25)';
          for (let i = 0; i < 10; i++) {
            const x = rnd() * s, y = rnd() * s, r = 10 + rnd() * 40;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          }
        }
      }));
    },

    // 街（midtown）の材質の Canvas 版（assets/<tier>/textures/<name>/ が無いとき）。1 枚がファイル版と同じ実寸を覆うように描く
    // （materials.js の tile と同じ。窓は同じ位置・同じ数）。name: limestone / brick_brown / brick_red / glass_tower / office_stone /
    // sidewalk / curb / asphalt_city / manhole / asphalt_patch / marble_floor / terrazzo / wood_floor / carpet_office / plaster_interior /
    // concourse_ceiling / grass / gravel_roof / stair_stone / billboards / hull_grey / carrier_deck / rock / railing（透ける柵）。
    // wall = 壁の色の上書き（同じ窓割りの色違い）。戻り値 { map, normal?, emissive? }
    *city(name, seed, wall) {
      const key = 'city:' + name + ':' + (wall || '');
      if (cache[key]) return cache[key];
      const S = 256;
      const sd = (seed || 1) * 31 + name.length * 7;
      let out;
      const surf = (color, o) => surfaceGen(Object.assign({ size: S, seed: sd, color, variation: 22, speckle: 0.004, normalStrength: 1.2 }, o || {}));
      const lines = (ctx, s, n, m, style, w) => { // n × m の目地
        ctx.strokeStyle = style; ctx.lineWidth = w || 2;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) { const x = Math.round(i * s / n) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, s); }
        for (let j = 0; j <= m; j++) { const y = Math.round(j * s / m) + 0.5; ctx.moveTo(0, y); ctx.lineTo(s, y); }
        ctx.stroke();
      };
      switch (name) {
        case 'limestone':
          out = yield* surf(wall || '#c9bfa8', { draw(ctx, s, rnd) {
            ctx.strokeStyle = 'rgba(80,70,55,0.35)'; ctx.lineWidth = 1.5;
            for (let r = 0; r < 8; r++) {
              const y = r * s / 8; ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(s, y + 0.5); ctx.stroke();
              const off = (r % 2) * s / 6 + rnd() * 6;
              for (let k = 0; k < 3; k++) { const x = (off + k * s / 3) % s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s / 8); ctx.stroke(); }
            }
          } });
          break;
        case 'brick_brown': case 'brick_red': {
          const red = name === 'brick_red';
          // 9 × 7.2 m = 3 柱間 × 2 階。窓 1.1 × 1.85、窓台 +0.9
          out = yield* G.windowFacade({ seed: sd, wall: wall || (red ? '#8e3d2c' : '#6a4a36'), bays: 3, storeys: 2, win: [0.317, 0.683, 0.25, 0.764],
            frame: red ? '#e8e2d6' : '#1c1a18', lit: 0.33, mortar: true, lintel: red ? '#7a3324' : '#9b8a72' });
          break;
        }
        case 'glass_tower':
          // 12 × 8 m = 8 枚 × 2 階。腰壁 0..1.0 m
          out = yield* G.windowFacade({ seed: sd, wall: wall || '#3e4650', bays: 8, storeys: 2, win: [0.04, 0.96, 0.25, 0.98], frame: '#8c949c', lit: 0.45, glass: ['#53677a', '#24313d'], runs: true });
          break;
        case 'office_stone':
          // 12 × 8 m = 4 柱間 × 2 階。窓 1.7 × 2.3、窓台 +0.9
          out = yield* G.windowFacade({ seed: sd, wall: wall || '#a39a8c', bays: 4, storeys: 2, win: [0.217, 0.783, 0.225, 0.8], frame: '#3a3c40', lit: 0.5, joints: true });
          break;
        case 'sidewalk':
          out = yield* surf('#9b988f', { draw(ctx, s) { lines(ctx, s, 4, 4, 'rgba(40,38,34,0.45)', 2); } });
          break;
        case 'curb': out = yield* surf('#8f8d8b', { speckle: 0.05 }); break;
        case 'asphalt_city': out = yield* surf('#2f2f32', { variation: 14, speckle: 0.03 }); break;
        case 'asphalt_patch': out = yield* surf('#262628', { variation: 10, speckle: 0.02 }); break;
        case 'manhole':
          out = yield* surf('#3a3836', { draw(ctx, s) {
            ctx.strokeStyle = 'rgba(15,14,13,0.8)'; ctx.lineWidth = 4;
            for (const r of [0.42, 0.3, 0.18]) { ctx.beginPath(); ctx.arc(s / 2, s / 2, r * s, 0, Math.PI * 2); ctx.stroke(); }
          } });
          break;
        case 'marble_floor':
          out = yield* surf('#ccab95', { variation: 30, draw(ctx, s, rnd) {
            ctx.strokeStyle = 'rgba(120,90,70,0.25)'; ctx.lineWidth = 1;
            for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.moveTo(rnd() * s, rnd() * s); ctx.bezierCurveTo(rnd() * s, rnd() * s, rnd() * s, rnd() * s, rnd() * s, rnd() * s); ctx.stroke(); }
            lines(ctx, s, 4, 4, 'rgba(70,55,45,0.4)', 1);
          } });
          break;
        case 'terrazzo': out = yield* surf('#b9b2a5', { speckle: 0.08, draw(ctx, s) { lines(ctx, s, 2, 2, 'rgba(150,120,60,0.7)', 2); } }); break;
        case 'wood_floor':
          out = yield* surf('#a8794e', { draw(ctx, s, rnd) {
            ctx.fillStyle = 'rgba(60,35,15,0.35)';
            for (let y = 0; y < s; y += s / 20) { ctx.fillRect(0, y, s, 1); for (let k = 0; k < 2; k++) ctx.fillRect(rnd() * s, y, 1, s / 20); }
          } });
          break;
        case 'carpet_office': out = yield* surf('#4a525c', { variation: 12, speckle: 0.05, draw(ctx, s) { lines(ctx, s, 4, 4, 'rgba(20,24,30,0.3)', 1); } }); break;
        case 'plaster_interior':
          out = yield* surf('#d9d3c6', { variation: 10, draw(ctx, s) { ctx.fillStyle = '#5a4030'; ctx.fillRect(0, s - Math.round(s * 0.14 / 3.6), s, Math.round(s * 0.14 / 3.6)); } });
          break;
        case 'concourse_ceiling': {
          out = yield* surf('#4d8b8e', { variation: 10 });
          const e = canvas(S); const ec = e.getContext('2d'); ec.fillStyle = '#000'; ec.fillRect(0, 0, S, S);
          const rnd = MR.seededRandom(sd);
          ec.fillStyle = '#ffd98a';
          for (let i = 0; i < 40; i++) { ec.beginPath(); ec.arc(rnd() * S, rnd() * S, 1 + rnd() * 2, 0, Math.PI * 2); ec.fill(); }
          out = { map: out.map, normal: out.normal, emissive: colorTexture(e) };
          break;
        }
        case 'grass': out = yield* surf('#4f6b2f', { variation: 26, speckle: 0.02, normalStrength: 2 }); break;
        case 'gravel_roof': out = yield* surf('#5f5a54', { variation: 18, speckle: 0.12 }); break;
        case 'stair_stone': out = yield* surf('#aaa397', { variation: 14 }); break;
        case 'billboards': out = T.billboardAtlas(sd); break;
        // 色だけの材質の質感（白に近い。material.color が色を決める）
        case 'hull_grey': out = yield* surf('#d8d8d8', { variation: 16, draw(ctx, s) { lines(ctx, s, 6, 3, 'rgba(0,0,0,0.12)', 1); } }); break;
        case 'carrier_deck': out = yield* surf('#d0d0d0', { variation: 12, draw(ctx, s) { lines(ctx, s, 3, 8, 'rgba(0,0,0,0.15)', 1); } }); break;
        case 'rock': out = yield* surf('#e0dcd4', { variation: 40, normalStrength: 3 }); break;
        case 'railing': {
          // 透ける柵（materials.js の alphaTest）: 1 枚 = 横 0.6 m に縦の棒 4 本、縦は柵の高さ全部（world.js が v = (y − 下端) ÷ 高さ）。
          //   上の手すり・下の横木。地は透明（アルファ 0）、色は白（material.color が色）
          const c = canvas(64), x = c.getContext('2d');
          x.clearRect(0, 0, 64, 64);
          x.fillStyle = '#ffffff';
          for (let k = 0; k < 4; k++) x.fillRect(k * 16 + 6, 0, 4, 64);
          x.fillRect(0, 0, 64, 5);   // 上の手すり（v = 1 側）
          x.fillRect(0, 52, 64, 4);  // 下の横木
          out = { map: colorTexture(c) };
          break;
        }
        default: out = yield* surf(wall || '#8a8680'); break;
      }
      cache[key] = out;
      return out;
    },

    // 窓のある外壁（1 枚 = bays 柱間 × storeys 階）。win = [u0, u1, v0, v1]（柱間・階の中の窓の範囲 0..1、v は下から）。
    // アルベドと発光（灯りのついた窓）。runs: 灯りを横に続ける（ガラスのオフィス）
    *windowFacade(o) {
      const size = 256;
      const albedo = canvas(size), emissive = canvas(size);
      const a = albedo.getContext('2d'), e = emissive.getContext('2d');
      const rnd = MR.seededRandom(o.seed || 7);
      const n = yield* noiseGen(size, o.seed || 7, 3, 3);
      const img = a.createImageData(size, size);
      const d = img.data;
      const [r, g, b] = hexToRgb(o.wall);
      for (let i0 = 0; i0 < size * size; i0 += size * ROWS * 2) {
        wallPixels(d, n, r, g, b, i0, Math.min(size * size, i0 + size * ROWS * 2));
        yield;
      }
      a.putImageData(img, 0, 0);
      if (o.mortar) { a.strokeStyle = 'rgba(30,25,20,0.18)'; a.lineWidth = 1; for (let y = 0; y < size; y += 4) { a.beginPath(); a.moveTo(0, y + 0.5); a.lineTo(size, y + 0.5); a.stroke(); } }
      if (o.joints) { a.strokeStyle = 'rgba(40,36,30,0.25)'; a.lineWidth = 1; for (let y = 0; y < size; y += size / 16) { a.beginPath(); a.moveTo(0, y + 0.5); a.lineTo(size, y + 0.5); a.stroke(); } }
      e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
      const cw = size / o.bays, ch = size / o.storeys;
      let litRun = false;
      for (let yi = 0; yi < o.storeys; yi++) {
        const rowTop = size - (yi + 1) * ch; // 下の階が画像の下
        for (let xi = 0; xi < o.bays; xi++) {
          const x = xi * cw + o.win[0] * cw, w = (o.win[1] - o.win[0]) * cw;
          const y = rowTop + (1 - o.win[3]) * ch, h = (o.win[3] - o.win[2]) * ch;
          const lit = o.runs ? (litRun = (rnd() < 0.25 ? !litRun : litRun) || rnd() < o.lit * 0.3) : rnd() < o.lit;
          if (o.lintel) { a.fillStyle = o.lintel; a.fillRect(x - 3, y - 6, w + 6, 5); a.fillRect(x - 3, y + h, w + 6, 3); }
          a.fillStyle = o.frame; a.fillRect(x - 2, y - 2, w + 4, h + 4);
          const gl = o.glass || ['#3f5468', '#1d2730'];
          const grad = a.createLinearGradient(x, y, x + w, y + h);
          grad.addColorStop(0, lit ? '#f2d7a2' : gl[0]); grad.addColorStop(1, lit ? '#d9ae6a' : gl[1]);
          a.fillStyle = grad; a.fillRect(x, y, w, h);
          a.fillStyle = 'rgba(0,0,0,0.45)'; a.fillRect(x + w / 2 - 1, y, 2, h);
          if (lit) { e.fillStyle = rnd() < 0.5 ? '#ffd28a' : '#ffe6b8'; e.fillRect(x, y, w, h); }
        }
      }
      return { map: colorTexture(albedo), emissive: colorTexture(emissive) };
    },
  };

  // ---------- 家具のアトラス（look.js の L5。interiors_view.js が使う）----------
  //   furnitureAtlas(size): size² に 4 × 4 のセル（names は interiors.json の look.cells.names と同じ順: 木 3 種・化粧板・布・革・ヘアライン・
  //   クローム・段ボール・本の背・紙・葉・敷物・岩綿の天井板（0.6 m 角 × 2 × 2）・スラット・コルク）。セルの縁 4 px は隣と混ざらない余白
  //   （模様は周期的なので余白も同じ模様の続き）。模様は sRGB の 0.73（リニアで約 0.5）の前後 = 家具の色 × 2 × 模様（own のセルは自分の色）。
  //   文字・ロゴは描かない。乱数は seed だけから（同じ Canvas の描画）。16 行ごとに yield
  const FONT = { // 5 × 7 のビットマップ（行ごとに 5 ビット、上から）。fillText は使わない
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
    E: [31, 16, 16, 30, 16, 16, 31], I: [14, 4, 4, 4, 4, 4, 14], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
    M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
    R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], X: [17, 17, 10, 4, 10, 17, 17],
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [30, 1, 1, 14, 1, 1, 30],
    '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
    '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12], ' ': [0, 0, 0, 0, 0, 0, 0],
    F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], U: [17, 17, 17, 17, 17, 17, 14],
    V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], Y: [17, 17, 10, 4, 4, 4, 4], '&': [12, 18, 20, 8, 21, 18, 13]
  };
  // 看板（画面のアトラスの下の 4 行。interiors.js の SIGNS と同じ順）。架空の名前だけ（使う前に検索して同じ業種の実在の会社が無いことを確かめた。
  //   dev-notes/interiors-progress.md）。行は | で区切る
  const SIGN_TEXT = ['MIRRSONA|LABS', 'ASHGROVE|& VALE', 'MIRR|CAPITAL', 'INKHAUS', 'BUREAU OF|CIVIC|RECORDS', 'EXIT', 'NOW|SERVING|42', 'OPEN', 'DELI', 'MIRRSONA'];
  const SIGN_COL = [['#0b0f1a', '#ff2fb3'], ['#1f4a3a', '#c49a4c'], ['#0b0f1a', '#34e07a'], ['#faf6ee', '#2f4fd8'], ['#e9e4d2', '#2a3a33'],
    ['#0c3a1c', '#e9ffe9'], ['#0b0f1a', '#ffb020'], ['#0b0f1a', '#ff4fa0'], ['#2b2b2b', '#ffd29a'], ['#0b1a1c', '#3fd0d0']];
  // 文字列を ctx に px 角のドットで描く（fillRect だけ）
  function drawText(ctx, str, x, y, px, color) {
    ctx.fillStyle = color;
    for (let k = 0; k < str.length; k++) {
      const gl = FONT[str[k]] || FONT[' '];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r] & (16 >> c)) ctx.fillRect(x + (k * 6 + c) * px, y + r * px, px, px);
    }
  }
  // 周期 per（格子の数）でつながる値ノイズ
  function hash2(x, y, seed) { let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, per, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0);
    const m = (v) => ((v % per) + per) % per;
    const a = hash2(m(x0), m(y0), seed), b = hash2(m(x0 + 1), m(y0), seed), c = hash2(m(x0), m(y0 + 1), seed), d = hash2(m(x0 + 1), m(y0 + 1), seed);
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }
  // 本の背の並び（u ごとの本の色・境目）。seed ごとに 1 回
  const bookTables = {};
  function bookTable(sd) {
    if (bookTables[sd]) return bookTables[sd];
    const col = new Uint8Array(256), edge = new Uint8Array(256);
    let x = 0, k = 0;
    while (x < 256) {
      const ww = 8 + Math.floor(hash2(k, 7, sd) * 13), ci = Math.floor(hash2(k, 3, sd) * BOOKS.length);
      for (let u = x; u < Math.min(256, x + ww); u++) { col[u] = ci; edge[u] = u - x <= 1 || x + ww - u <= 1 ? 1 : 0; }
      x += ww; k++;
    }
    return (bookTables[sd] = { col, edge });
  }
  const BOOKS = [[140, 40, 40], [40, 80, 150], [210, 160, 40], [50, 120, 70], [230, 225, 210], [90, 60, 120], [30, 30, 34], [200, 90, 40]];
  // セル i の 1 画素（u, v は 0..255 のセルの中の座標、周期 256）→ [r, g, b]（0..255、sRGB）
  function atlasPixel(i, u, v, sd) {
    const N = (x, y, per, s) => vnoise(x, y, per, sd + s);
    let g = 0.73;
    switch (i) {
      case 0: case 1: case 2: { // 木目（オーク・ウォールナット・バーチ）: v に沿った年輪 + 揺らぎ + 細かい道管
        const f = i === 1 ? 10 : i === 0 ? 6 : 4, a = i === 1 ? 0.11 : i === 0 ? 0.09 : 0.05;
        const w = N(u / 32, v / 64, 8, 3 + i) * 0.45; // 揺らぎは小さく（大きいと水の波紋に見えた）
        g = 0.73 + a * Math.sin(2 * Math.PI * (u / 256 * f + w)) + 0.05 * (N(u / 2, v / 32, 128, 9 + i) - 0.5) + (hash2(u, v, sd + i) < 0.01 ? -0.08 : 0);
        break;
      }
      case 3: g = 0.73 + 0.035 * (N(u / 8, v / 8, 32, 21) - 0.5) + 0.02 * (hash2(u, v, sd + 3) - 0.5); break;
      case 4: { // 布の織り目
        const wv = (((u >> 1) + (v >> 1)) & 1) ? 0.05 : -0.05;
        g = 0.73 + wv + 0.06 * (N(u / 16, v / 16, 16, 31) - 0.5) + 0.03 * (hash2(u, v, sd + 4) - 0.5);
        break;
      }
      case 5: { const c = Math.abs(N(u / 12, v / 12, 22, 41) * 2 - 1); g = 0.7 + 0.1 * c + 0.03 * (hash2(u, v, sd + 5) - 0.5); break; }
      case 6: g = 0.73 + 0.09 * (N(u / 1.5, v / 48, 171, 51) - 0.5) + 0.03 * (N(u / 16, v / 16, 16, 52) - 0.5); break;
      case 7: g = 0.73 + 0.18 * Math.sin(2 * Math.PI * v / 128) + 0.04 * (N(u / 32, v / 32, 8, 61) - 0.5); break;
      case 8: { // 段ボール: 細い波の線・しみ・真ん中のテープ
        g = 0.73 + 0.03 * Math.sin(2 * Math.PI * v / 8) + 0.06 * (N(u / 24, v / 24, 11, 71) - 0.5);
        if (u >= 108 && u < 148) g += 0.08;
        break;
      }
      case 9: { // 本の背（自分の色）: 幅 8〜20 px の本を並べる。上下は棚の影
        const bt = bookTable(sd), col = BOOKS[bt.col[u]], edge = bt.edge[u] ? 0.55 : 1;
        const shade = (v < 10 || v > 245 ? 0.45 : 1) * edge * (0.88 + 0.12 * N(u / 4, v / 32, 64, 81));
        const band = (v > 40 && v < 52) || (v > 196 && v < 206) ? 1.25 : 1;
        return [col[0] * shade * band, col[1] * shade * band, col[2] * shade * band];
      }
      case 10: g = 0.8 + 0.03 * (N(u / 4, v / 4, 64, 91) - 0.5); break;
      case 11: { // 葉（自分の色）
        const n1 = N(u / 18, v / 18, 14, 101), n2 = N(u / 6, v / 6, 43, 102);
        const l = n1 * 0.7 + n2 * 0.3;
        return l > 0.55 ? [95 + 80 * (l - 0.55), 150 + 120 * (l - 0.55), 70] : [40 + 40 * l, 85 + 60 * l, 45];
      }
      case 12: { // 敷物（自分の色）: 縁と模様
        const bu = Math.min(u, 255 - u), bv = Math.min(v, 255 - v), b = Math.min(bu, bv);
        if (b < 14) return [150, 50, 50];
        if (b < 22) return [230, 215, 185];
        const d = ((Math.floor(u / 32) + Math.floor(v / 32)) & 1) ? 1 : 0.86, n = 0.9 + 0.1 * N(u / 3, v / 3, 85, 111);
        return [60 * d * n, 90 * d * n, 120 * d * n];
      }
      case 13: { // 岩綿の天井板 0.6 m 角（セル 1.2 m = 2 × 2 枚）: 格子の線・穴の点
        const lu = u % 128, lv = v % 128;
        if (lu < 2 || lv < 2) g = 0.5;
        else g = 0.78 + 0.03 * (N(u / 6, v / 6, 43, 121) - 0.5) - (hash2(u, v, sd + 13) < 0.05 ? 0.07 : 0);
        break;
      }
      case 14: { const lu = u % 64; g = lu < 2 ? 0.55 : 0.73 + 0.025 * Math.sin(2 * Math.PI * (v / 256 * 6 + 0.25 * N(lu / 16, v / 64, 4, 131))) + 0.03 * (hash2(u >> 6, 1, sd + 14) - 0.5); break; } // 板 4 枚（床・天井のスラット。継ぎ目と木目は弱く）
      case 15: g = 0.73 + 0.14 * (hash2(u >> 1, v >> 1, sd + 15) - 0.5) + 0.05 * (N(u / 10, v / 10, 26, 141) - 0.5); break;
    }
    const c = Math.max(0, Math.min(1, g)) * 255;
    return [c, c, c];
  }
  // y0..y1 の行を d（y0 の行から始まる帯）に書く
  function atlasRows(d, size, cs, sd, y0, y1) {
    const sc = 256 / (cs - 8);
    for (let y = y0; y < y1; y++) {
      const cy = Math.floor(y / cs), ly = y - cy * cs;
      for (let x = 0; x < size; x++) {
        const cx = Math.floor(x / cs), lx = x - cx * cs, i = cy * 4 + cx;
        // 余白（4 px）も周期の続き: セルの中の 4..cs-4 が 0..256
        const u = ((Math.floor((lx - 4) * sc) % 256) + 256) % 256, v = ((Math.floor((ly - 4) * sc) % 256) + 256) % 256;
        const p = atlasPixel(i, u, v, sd), o = ((y - y0) * size + x) * 4;
        d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = 255;
      }
    }
  }
  G.furnitureAtlas = function* (size) {
    size = size || 1024;
    const key = 'furnAtlas' + size;
    if (cache[key]) return cache[key];
    const c = canvas(size), ctx = c.getContext('2d');
    // 1 歩 2 行。行の帯を使い回して、その歩で Canvas に書く（最後に 4 MB を 1 回で書く長い歩を作らない）
    const AR = 2, cs = size / 4; // 1 歩 2 行（遅い端末でも 1 歩 4 ms 前後）
    const img = ctx.createImageData(size, AR), d = img.data;
    for (let y = 0; y < size; y += AR) { atlasRows(d, size, cs, 7, y, Math.min(size, y + AR)); ctx.putImageData(img, 0, y); yield; }
    const tex = colorTexture(c, false); // sRGB の値のまま（シェーダーが 2.2 乗で戻す）
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return (cache[key] = tex);
  };
  // 画面のアトラス（4 × 4。0〜3 グラフ、4〜7 コード、8〜11 表計算、12〜15 スクリーンセーバー「MIRRSONA」）。発光に使う
  // 棚の商品の正面（お店の棚の段 1 つ = この 1 枚を横に繰り返す）: 箱・缶・瓶が並び、下に値札の帯。ラベルは色の帯と点だけ（字・ロゴなし）
  const PRODUCT_COL = ['#e8321e', '#1f6fe8', '#ffc81e', '#26b04a', '#ff6a10', '#8a3fd0', '#12c0d4', '#e0306e', '#f6f6f6', '#2b2b2b'];
  function productFront(x, ox, oy, p, kind, rnd) {
    x.fillStyle = '#20232a'; x.fillRect(ox, oy, p, p); // 棚の奥の影
    const base = oy + p * 0.86;
    let cx = ox + 1;
    while (cx < ox + p - 4) {
      const t = kind % 3, col = PRODUCT_COL[Math.floor(rnd() * PRODUCT_COL.length)], col2 = PRODUCT_COL[Math.floor(rnd() * PRODUCT_COL.length)];
      const w = t === 0 ? p * (0.12 + rnd() * 0.1) : t === 1 ? p * 0.08 : p * 0.07, h = t === 0 ? p * (0.45 + rnd() * 0.3) : t === 1 ? p * 0.35 : p * (0.55 + rnd() * 0.2);
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n && cx + w < ox + p - 1; k++) {
        const y0 = base - h;
        x.fillStyle = col; x.fillRect(cx, y0, w - 1, h);
        x.fillStyle = col2; x.fillRect(cx, y0 + h * 0.35, w - 1, h * 0.22); // ラベルの帯
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(cx + 1, y0 + 1, Math.max(1, w * 0.18), h - 2); // つや
        if (t === 2) { x.fillStyle = col; x.fillRect(cx + w * 0.3, y0 - h * 0.18, w * 0.38, h * 0.18); } // 瓶の首
        cx += w;
      }
      cx += 1;
    }
    x.fillStyle = '#f2f2ee'; x.fillRect(ox, base, p, p * 0.1); // 値札の帯
    x.fillStyle = '#e8321e';
    for (let k = 0; k < 6; k++) x.fillRect(ox + p * (0.04 + k * 0.16), base + p * 0.03, p * 0.07, p * 0.04);
  }
  // 4 × 8: 上の 4 行（0〜15）は画面、下の 4 行（16〜31）は看板（SIGN_TEXT）と商品の正面（26〜31）
  G.screenAtlas = function* (size) {
    size = size || 512;
    const key = 'screenAtlas' + size;
    if (cache[key]) return cache[key];
    const c = canvas(size), x = c.getContext('2d'), p = size / 4;
    c.height = size * 2;
    const rnd = MR.seededRandom(4242);
    for (let i = 0; i < 16; i++) {
      const ox = (i % 4) * p, oy = Math.floor(i / 4) * p, t = Math.floor(i / 4);
      if (t === 0) {
        x.fillStyle = '#0f1828'; x.fillRect(ox, oy, p, p);
        x.fillStyle = '#4aa8ff';
        for (let k = 0; k < 7; k++) { const h = p * (0.15 + rnd() * 0.45); x.fillRect(ox + p * 0.1 + k * p * 0.11, oy + p * 0.9 - h, p * 0.07, h); }
        x.fillStyle = '#ffb020'; x.fillRect(ox + p * 0.1, oy + p * 0.12, p * 0.35, p * 0.06);
        x.fillStyle = '#34e07a'; x.fillRect(ox + p * 0.55, oy + p * 0.12, p * 0.3, p * 0.06);
      } else if (t === 1) {
        x.fillStyle = '#1b1f2a'; x.fillRect(ox, oy, p, p);
        const cols = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#ffcb6b'];
        for (let k = 0; k < 12; k++) {
          let cx = ox + p * (0.08 + (k % 4 === 0 ? 0 : 0.06 * (1 + (k % 3))));
          const cy = oy + p * (0.07 + k * 0.075);
          for (let s = 0; s < 3; s++) { const w = p * (0.08 + rnd() * 0.2); x.fillStyle = cols[Math.floor(rnd() * cols.length)]; x.fillRect(cx, cy, w, p * 0.035); cx += w + p * 0.03; if (cx > ox + p * 0.9) break; }
        }
      } else if (t === 2) {
        x.fillStyle = '#f2f4f7'; x.fillRect(ox, oy, p, p);
        x.fillStyle = '#c9d1d9';
        for (let k = 0; k <= 10; k++) x.fillRect(ox, oy + p * 0.12 + k * p * 0.08, p, 1);
        for (let k = 0; k <= 5; k++) x.fillRect(ox + k * p * 0.2, oy + p * 0.12, 1, p);
        x.fillStyle = '#3fae5a'; x.fillRect(ox, oy, p, p * 0.1);
        for (let k = 0; k < 9; k++) if (rnd() < 0.5) { x.fillStyle = rnd() < 0.5 ? '#bfe5c8' : '#ffe1a8'; x.fillRect(ox + Math.floor(rnd() * 5) * p * 0.2 + 1, oy + p * 0.12 + k * p * 0.08 + 1, p * 0.2 - 2, p * 0.08 - 2); }
      } else {
        x.fillStyle = '#0b0f1a'; x.fillRect(ox, oy, p, p);
        const gr = x.createRadialGradient ? x.createRadialGradient(ox + p / 2, oy + p / 2, 0, ox + p / 2, oy + p / 2, p * 0.6) : null;
        if (gr) { gr.addColorStop(0, ['#16424a', '#3a1a44', '#14304a', '#40301a'][i - 12]); gr.addColorStop(1, '#0b0f1a'); x.fillStyle = gr; x.fillRect(ox, oy, p, p); }
        const px = Math.max(1, Math.floor(p / 64));
        drawText(x, 'MIRRSONA', ox + (p - 48 * px) / 2, oy + p * 0.45, px, ['#3fd0d0', '#ff6fb0', '#6fa8ff', '#ffb46b'][i - 12]);
      }
      yield;
    }
    for (let i = 0; i < 16; i++) {
      const ox = (i % 4) * p, oy = size + Math.floor(i / 4) * p;
      if (i >= 10) { productFront(x, ox, oy, p, i - 10, rnd); yield; continue; } // 10〜15: 棚の商品の正面（字は描かない）
      const t = SIGN_TEXT[i], cl = SIGN_COL[i] || ['#0b0f1a', ['#ff4fa0', '#4fe0ff', '#ffb46b', '#7bff9a'][i % 4]];
      x.fillStyle = cl[0]; x.fillRect(ox, oy, p, p);
      if (!t) { x.fillStyle = cl[1]; x.fillRect(ox, oy + p * 0.42, p, p * 0.16); yield; continue; }
      const lines = t.split('|'), longest = Math.max.apply(null, lines.map((l) => l.length));
      const px = Math.max(1, Math.floor(Math.min((p * 0.86) / (longest * 6), (p * 0.8) / (lines.length * 9))));
      const h = lines.length * 9 * px;
      lines.forEach((l, k) => drawText(x, l, ox + (p - (l.length * 6 - 1) * px) / 2, oy + (p - h) / 2 + k * 9 * px, px, cl[1]));
      yield;
    }
    const tex = colorTexture(c, false);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return (cache[key] = tex);
  };
  // 光の札（L7）: 128 × 512（2 の累乗。WebGL1 で縮められない）に 4 段（uv の下から 0 光のたまり（丸）・1 接地の影（角の丸い四角）・
  //   2 窓の光（uv の上 = 段の上の端が壁で濃く、奥へ薄い）・3 机の上の明るさ（平らな四角））。R が強さ（0..1）。リニアのデータ（色ではない）
  G.lightCards = function* () {
    if (cache.lightCards) return cache.lightCards;
    const w = 128, h = 512, c = canvas(w), ctx = c.getContext('2d');
    c.width = w; c.height = h;
    const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      const band = 3 - Math.floor(y / 128), ly = y % 128; // Canvas の上の行が uv の上（flipY）
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w * 2 - 1, v = (ly + 0.5) / 128 * 2 - 1;
        let t = 0;
        if (band === 0) { const r = Math.sqrt(u * u + v * v); t = r >= 1 ? 0 : Math.pow(1 - r * r, 1.6); }
        else if (band === 1) { const ax = Math.max(0, Math.abs(u) - 0.55) / 0.45, ay = Math.max(0, Math.abs(v) - 0.55) / 0.45, r = Math.sqrt(ax * ax + ay * ay); t = r >= 1 ? 0 : 1 - r * r * (3 - 2 * r); }
        else if (band === 3) { const ax = Math.max(0, Math.abs(u) - 0.86) / 0.14, ay = Math.max(0, Math.abs(v) - 0.86) / 0.14; t = (1 - Math.min(1, ax)) * (1 - Math.min(1, ay)); } // 机の上の明るさ（平らな四角、縁だけ柔らかく）
        else if (band === 2) { const side = Math.max(0, Math.abs(u) - 0.7) / 0.3, s = 1 - side * side, depth = (ly + 0.5) / 128; t = Math.max(0, s) * Math.pow(Math.max(0, 1 - depth), 1.5); } // 段の上の行（ly = 0）が壁
        const o = (y * w + x) * 4, val = Math.round(Math.max(0, Math.min(1, t)) * 255);
        d[o] = val; d[o + 1] = val; d[o + 2] = val; d[o + 3] = 255;
      }
      if ((y & 15) === 15) yield;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return (cache.lightCards = tex);
  };
  // 葉のカード（植物の十字の板。RGBA の透明 = alphaTest で切る）: 256²、明るい灰色の葉（家具の色で緑に染める）
  G.foliage = function* () {
    if (cache.foliage) return cache.foliage;
    const s = 256, c = canvas(s), x = c.getContext('2d');
    const rnd = MR.seededRandom(31337);
    x.clearRect(0, 0, s, s);
    for (let k = 0; k < 70; k++) {
      const cx = s * (0.15 + rnd() * 0.7), cy = s * (0.08 + rnd() * 0.8), r = s * (0.05 + rnd() * 0.06), a = rnd() * Math.PI * 2;
      const v = Math.floor(170 + rnd() * 85);
      x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      x.beginPath();
      x.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
      x.quadraticCurveTo(cx - Math.sin(a) * r * 0.5, cy + Math.cos(a) * r * 0.5, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      x.quadraticCurveTo(cx + Math.sin(a) * r * 0.5, cy - Math.cos(a) * r * 0.5, cx - Math.cos(a) * r, cy - Math.sin(a) * r);
      x.fill();
      if ((k & 15) === 15) yield;
    }
    x.fillStyle = 'rgb(120,110,95)'; x.fillRect(s * 0.48, s * 0.55, s * 0.04, s * 0.45); // 幹
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return (cache.foliage = tex);
  };
  G.FONT = FONT;
  G.drawText = drawText;

  const T = {
    anisotropy: 4,

    // 地面・道路・コンクリート・金属・街の材質・窓のある外壁: G（ジェネレーター）を最後まで回す
    ground() { return drain(G.ground()); },
    road() { return drain(G.road()); },
    concrete() { return drain(G.concrete()); },
    metal(colorHex, seed) { return drain(G.metal(colorHex, seed)); },
    city(name, seed, wall) { return drain(G.city(name, seed, wall)); },
    windowFacade(o) { return drain(G.windowFacade(o)); },
    // 1 歩ずつ作る版（for (;;) { const r = it.next(); if (r.done) break; } で回す。結果は T と同じキャッシュ）
    job: G,
    furnitureAtlas(size) { return drain(G.furnitureAtlas(size)); },
    screenAtlas(size) { return drain(G.screenAtlas(size)); },
    lightCards() { return drain(G.lightCards()); },
    foliage() { return drain(G.foliage()); },
    font5x7: FONT,

    // 建物の外壁: 1 タイル = 窓 4 列 × 3 階（12m × 9m）。アルベドと発光（灯りのついた窓）の 2 枚
    facade(seed) {
      const key = 'facade' + seed;
      if (cache[key]) return cache[key];
      const size = 512;
      const albedo = canvas(size), emissive = canvas(size);
      const a = albedo.getContext('2d'), e = emissive.getContext('2d');
      const rnd = MR.seededRandom(seed);
      const n = makeNoise(size, seed, 3, 3);
      const img = a.createImageData(size, size);
      const d = img.data;
      const [r, g, b] = hexToRgb('#8a8278');
      for (let i = 0; i < size * size; i++) {
        const v = (n[i] - 0.5) * 30;
        const o = i * 4;
        d[o] = r + v; d[o + 1] = g + v; d[o + 2] = b + v; d[o + 3] = 255;
      }
      a.putImageData(img, 0, 0);
      e.fillStyle = '#000';
      e.fillRect(0, 0, size, size);
      const cols = 4, rows = 3;
      const cw = size / cols, ch = size / rows;
      for (let yi = 0; yi < rows; yi++) {
        // 階の境目
        a.fillStyle = 'rgba(0,0,0,0.25)';
        a.fillRect(0, yi * ch, size, 4);
        for (let xi = 0; xi < cols; xi++) {
          const x = xi * cw + cw * 0.2, y = yi * ch + ch * 0.22, w = cw * 0.6, h = ch * 0.5;
          const lit = rnd() < 0.45;
          // 窓枠
          a.fillStyle = '#2b2f36';
          a.fillRect(x - 5, y - 5, w + 10, h + 10);
          // ガラス
          const glass = a.createLinearGradient(x, y, x + w, y + h);
          glass.addColorStop(0, lit ? '#f6d9a0' : '#3f5468');
          glass.addColorStop(1, lit ? '#e2b56a' : '#1d2730');
          a.fillStyle = glass;
          a.fillRect(x, y, w, h);
          a.fillStyle = 'rgba(0,0,0,0.5)';
          a.fillRect(x + w / 2 - 2, y, 4, h);
          if (lit) {
            e.fillStyle = rnd() < 0.5 ? '#ffd28a' : '#ffe6b8';
            e.fillRect(x, y, w, h);
          }
        }
      }
      const out = { map: colorTexture(albedo), emissive: colorTexture(emissive) };
      cache[key] = out;
      return out;
    },

    // タイムズスクエアの看板（4 × 4 枚。文字・ロゴは描かない: グラデーション・図形・棒）。アルベドは暗め、発光は明るい絵
    billboardAtlas(seed) {
      if (cache.billboards) return cache.billboards;
      const size = 512, p = size / 4;
      const em = canvas(size), al = canvas(size);
      const e = em.getContext('2d'), a = al.getContext('2d');
      const rnd = MR.seededRandom(seed || 99);
      const pal = [['#ff3d6e', '#ffd23d'], ['#2ee6ff', '#3d5bff'], ['#9dff3d', '#0b8f5a'], ['#ff8a1c', '#7a1cff'], ['#ffffff', '#ff2e2e'], ['#1cffd5', '#ff1cb4']];
      for (let i = 0; i < 16; i++) {
        const x = (i % 4) * p, y = Math.floor(i / 4) * p, c = pal[i % pal.length];
        const gr = e.createLinearGradient(x, y, x + p, y + p);
        gr.addColorStop(0, c[0]); gr.addColorStop(1, c[1]);
        e.fillStyle = gr; e.fillRect(x + 3, y + 3, p - 6, p - 6);
        e.fillStyle = 'rgba(255,255,255,0.85)';
        e.beginPath(); e.arc(x + p * (0.3 + rnd() * 0.4), y + p * (0.35 + rnd() * 0.3), p * (0.12 + rnd() * 0.12), 0, Math.PI * 2); e.fill();
        e.fillStyle = 'rgba(0,0,0,0.55)';
        for (let k = 0; k < 3; k++) e.fillRect(x + p * 0.12, y + p * (0.72 + k * 0.07), p * (0.3 + rnd() * 0.5), p * 0.035);
      }
      a.drawImage ? a.drawImage(em, 0, 0) : null;
      a.fillStyle = 'rgba(0,0,0,0.7)'; a.fillRect(0, 0, size, size);
      return (cache.billboards = { map: colorTexture(al), emissive: colorTexture(em) });
    },

    // 木箱・バレル用のストライプ（危険表示）
    hazard() {
      if (cache.hazard) return cache.hazard;
      const size = 128;
      const c = canvas(size);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#d9a81c';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#1e1e22';
      for (let i = -size; i < size * 2; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 - size, size); ctx.lineTo(i - size, size);
        ctx.closePath(); ctx.fill();
      }
      return (cache.hazard = colorTexture(c));
    }
  };

  return T;
})();
