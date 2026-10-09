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
    // concourse_ceiling / grass / gravel_roof / stair_stone / billboards / hull_grey / carrier_deck / rock。
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
