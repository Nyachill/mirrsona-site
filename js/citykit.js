// 街の細かい物（hq3d Q3。MR.CityKit。THREE も DOM も使わない = Node のテストも require する）。
// 入れない建物の段（chunkFull の cat 'exterior' で SHELL / NOCOL でない箱）の外に向いた壁に、見た目だけの部品を決定的に置く:
//   kit_ac（窓のエアコン。れんがの窓の格子 = 3 m ごと・階 3.6 m・窓台 0.9 m）、kit_awning（1 階の店の日よけ）、kit_sign（突き出しの看板）、
//   kit_flag（旗）、kit_vent（壁の換気口）、kit_lamp（店の上の灯り）。部品の形は assets/models/city_kit.glb（tools/gen/build_city_kit.py）、
//   描くのは MR.CityProps（world.js。種類ごとの InstancedMesh、影なし、render.city.kit）。
// 当たり判定・Nav3D・citygen・far.bin の鍵は変えない（見た目だけ）。オンラインでも同じ置き方（見た目だけなので端末のクラスで出る・出ないが違ってよい）。
// 数値: render.city.cityKit（classes / dist / maxTris / ms / phone / palette、ここの DEF の minLow / minLowOther / keep / mats も上書きできる）
//
// 守ること（計画 §4 Q3 の keep-out）: 歩ける面から 0.6 m 以内で 2.2 m より低い所に部品を置かない（日よけは 2.6 m 以上）
//   = どの部品も下の端が地面・歩道（箱の下端 ≤ 0.3 m の段）から minLow（2.6 m）以上。扉・梯子（と呼ぶ側が渡す点）から 1 m（keep）以内に置かない（スポーン地点は地面なので 2.2 m 上の部品とは重ならない）。
// place(data, cfg, extraKeep, city) → [{ type, x, y, z, rot, tint }]（city = MR.CityGen: ほかのチャンクの面を supportHeightAt で見る）（rot: 部品の +Z = 壁の外向き、tint: 0..1 の色の番号 = cfg.tints から選ぶ）
window.MR = window.MR || {};

MR.CityKit = (function () {
  // 部品の寸法（build_city_kit.py の extras.info と同じ。下の端 low・出っ張り out・幅 w）
  const PIECES = {
    kit_ac: { low: -0.32, out: 0.42, w: 0.66 },
    kit_awning: { low: -0.62, out: 1.04, w: 2.2 },
    kit_sign: { low: -1.18, out: 0.98, w: 0.08 },
    kit_flag: { low: -0.16, out: 1.93, w: 0.2, high: 1.45 },
    kit_vent: { low: -0.3, out: 0.08, w: 0.9 },
    kit_lamp: { low: -0.12, out: 0.6, w: 0.26 }
  };
  const TYPES = Object.keys(PIECES);
  // 既定（render.city.kit で上書き）
  const DEF = {
    minLow: 2.6, minLowOther: 2.2, keep: 1.0, outTest: 1.2, minFace: 6, maxPerChunk: 400,
    // 材質ごとの窓の格子（bay = 窓の間隔、storey = 階の高さ、sill = 窓台の高さ、x0 = 最初の窓の中心）と置く物の割合
    mats: {
      brick_brown: { bay: 3, storey: 3.6, sill: 0.9, x0: 1.5, ac: 0.14, awning: 0.55, lamp: 0.25 },
      brick_red: { bay: 3, storey: 3.6, sill: 0.9, x0: 1.5, ac: 0.14, awning: 0.55, lamp: 0.25 },
      office_stone: { bay: 3, storey: 4, sill: 0.9, x0: 1.5, sign: 0.08, flag: 0.03, vent: 0.04 },
      limestone_win: { bay: 3, storey: 4, sill: 0.9, x0: 1.5, sign: 0.08, flag: 0.04, vent: 0.03 },
      limestone: { bay: 3, storey: 4, sill: 0.9, x0: 1.5, sign: 0.06, flag: 0.05, awning: 0.2 },
      concrete: { bay: 3, storey: 3.5, sill: 0.9, x0: 1.5, vent: 0.06, sign: 0.05 },
      glass_tower: { bay: 3, storey: 4, sill: 0.9, x0: 1.5, flag: 0.02 }
    },
    tints: 6
  };

  function cfgOf(c) {
    const o = Object.assign({}, DEF, c || {});
    o.mats = Object.assign({}, DEF.mats, (c && c.mats) || {});
    return o;
  }

  // 整数の hash（どの端末でも同じ）→ 0..1
  function h01(a, b, c, d) {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (v | 0); h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; };
    mix(a); mix(b); mix(c); mix(d);
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const q = (v) => Math.round(v * 100);

  // 箱の 2D の格子（4 m）。insideAny(x, y, z, skip) = 点がどれかの箱（skip 以外）の中か
  // 格子を作るのは 256 箱ごとに yield するジェネレーター（job の中で yield* する。place は全部回す）
  function* boxGridJob(boxes) {
    const C = 4, map = new Map();
    for (let i = 0; i < boxes.length; i++) {
      if ((i & 255) === 255) yield;
      const b = boxes[i];
      if ((b.f & 1) && !(b.f & 4)) continue; // NOCOL（見た目だけの箱）は数えない（歩ける面は見る）
      const x0 = Math.floor((b.x - b.w / 2) / C), x1 = Math.floor((b.x + b.w / 2) / C);
      const z0 = Math.floor((b.z - b.d / 2) / C), z1 = Math.floor((b.z + b.d / 2) / C);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx * 73856093 ^ gz * 19349663;
        let a = map.get(k); if (!a) map.set(k, a = []); a.push(i);
      }
    }
    return {
      inside(x, y, z, skip) {
        const a = map.get(Math.floor(x / C) * 73856093 ^ Math.floor(z / C) * 19349663);
        if (!a) return false;
        for (const i of a) {
          if (i === skip) continue;
          const b = boxes[i];
          if ((b.f & 1) || b.cat === 'sidewalk' || b.cat === 'road' || b.cat === 'prop') continue;
          if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2 && y >= b.y && y <= b.y + b.h) return true;
        }
        return false;
      },
      // (x, z) の上で ymax より低い歩ける面（WALK の箱の上面）の一番高い所。無ければ −1e9
      walkTop(x, z, ymax) {
        const a = map.get(Math.floor(x / C) * 73856093 ^ Math.floor(z / C) * 19349663);
        let top = -1e9;
        if (!a) return top;
        for (const i of a) {
          const b = boxes[i];
          if (!(b.f & 4)) continue;
          const t = b.y + b.h;
          if (t <= ymax && t > top && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) top = t;
        }
        return top;
      }
    };
  }

  // (x, z) の区画の段の上面（citygen の supportHeightAt の区画の部分と同じ式: 一番上の段は L.top、下の段は上面 + 1.2 = パラペットの余裕、
  // 駐車場は L.top）。区画は中心のチャンクの ixLots にあり、持ち主のチャンクの外へはみ出すので周り 3 × 3 を見る。支えの格子（約 11 MB）は作らない
  function lotTop(city, x, z) {
    let top = -1e9;
    if (!city.ixLots || typeof city._ci !== 'function') return top;
    const cs = city.cs || 128;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const ci = city._ci(x + i * cs, z + j * cs);
      if (ci < 0) continue;
      for (const li of city.ixLots[ci]) {
        const L = city.lots[li];
        if (x < L.x0 || x > L.x1 || z < L.z0 || z > L.z1) continue;
        const n = L.tiers.length;
        for (let t = 0; t < n; t++) {
          const q = L.tiers[t];
          if (x < q[0] || x > q[2] || z < q[1] || z > q[3]) continue;
          const h = t === n - 1 ? L.top : q[5] + 1.2;
          if (h > top) top = h;
        }
        if (L.kind === 'parking' && L.top > top) top = L.top;
      }
    }
    return top;
  }

  // 少しずつ進める版（8 箱ごとに yield。CityProps が 1 フレームの ms の中で回す）。終わると out を返す
  function* job(data, kitCfg, extraKeep, city) {
    const cfg = cfgOf(kitCfg);
    const out = [];
    if (!data || !data.boxes) return out;
    const boxes = data.boxes;
    const G = yield* boxGridJob(boxes);
    yield;
    // 近づけない点（扉・梯子・呼ばれた側の点 = スポーン地点）
    const keepPts = [];
    for (const b of data.buildings || []) if (b.door) keepPts.push(b.door[0], b.door[2]);
    for (const l of data.ladders || []) keepPts.push(l.x, l.z);
    if (extraKeep) for (const p of extraKeep) keepPts.push(p[0], p[1]);
    const nearKeep = (x, z, r) => {
      const rr = (cfg.keep + r) * (cfg.keep + r);
      for (let i = 0; i < keepPts.length; i += 2) { const dx = x - keepPts[i], dz = z - keepPts[i + 1]; if (dx * dx + dz * dz < rr) return true; }
      return false;
    };
    // 置いた物どうしが重ならない（同じ壁の同じ高さで幅の分）
    const taken = [];
    const clash = (x, y, z, w, hgt) => {
      for (let i = 0; i < taken.length; i += 5) {
        if (Math.abs(taken[i + 1] - y) < (hgt + taken[i + 4]) / 2 && Math.hypot(taken[i] - x, taken[i + 2] - z) < (w + taken[i + 3]) / 2 + 0.2) return true;
      }
      return false;
    };
    const push = (type, x, y, z, rot, tintSeed, groundY) => {
      const P = PIECES[type];
      if (nearKeep(x, z, P.w / 2)) return false;
      const hgt = -P.low + 0.3;
      if (clash(x, y, z, P.w, hgt)) return false;
      // 下の歩ける面（階段・張り出し・低い屋根・高架）から minLow / minLowOther m（壁の外 0.05 m〜出っ張り + 0.6 m、幅 + 0.6 m）
      const need = type === 'kit_awning' ? cfg.minLow : cfg.minLowOther, sx = Math.sin(rot), sz = Math.cos(rot);
      const lowY = y + P.low;
      for (const t of [0.05, P.out * 0.5, P.out + 0.6]) for (const u of [-P.w / 2 - 0.6, 0, P.w / 2 + 0.6]) {
        const wx = x + sx * t - sz * u, wz = z + sz * t + sx * u;
        let top = Math.max(groundY, G.walkTop(wx, wz, y + 0.5));
        // ほかのチャンクの区画の面（区画は持ち主のチャンクの外へはみ出す）: citygen の支えの高さ（計画だけから = どの端末でも同じ。
        // 低い段の上は余裕つきの値なので控えめになる）
        if (city) {
          const sh = lotTop(city, wx, wz);
          if (sh <= y + 0.5) { if (sh > top) top = sh; } else if (t > 0.1) return false; // 外のこの点はほかの建物の中（区画の段の上の面が部品より高い）
        }
        if (lowY - top < need) return false;
      }
      // 外に出た所が空いている（隣の建物・橋・高架にめり込まない）
      const ox = x + Math.sin(rot) * P.out, oz = z + Math.cos(rot) * P.out;
      if (G.inside(ox, y + P.low * 0.5, oz, -1)) return false;
      if (P.high && (G.inside(ox, y + P.high, oz, -1) || G.inside(x + Math.sin(rot) * P.out * 0.5, y + P.high * 0.5, z + Math.cos(rot) * P.out * 0.5, -1))) return false; // 上へ伸びる物（旗）の先
      taken.push(x, y, z, P.w, hgt);
      out.push({ type, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), rot, tint: Math.floor(tintSeed * cfg.tints) });
      return true;
    };
    let ops = 0;
    for (let bi = 0; bi < boxes.length && out.length < cfg.maxPerChunk; bi++) {
      if ((bi & 7) === 7) yield;
      const b = boxes[bi];
      if (b.cat !== 'exterior' || (b.f & 17) || b.h < 3) continue;
      const M = cfg.mats[b.mat];
      if (!M) continue;
      const ground = b.y <= 0.3; // 地面からの段（1 階がある）
      const groundY = ground ? Math.max(0, b.y) : b.y;
      // 4 つの面: [法線 x, 法線 z, 面の長さ, 面の中心 x, z]
      const faces = [[1, 0, b.d, b.x + b.w / 2, b.z], [-1, 0, b.d, b.x - b.w / 2, b.z], [0, 1, b.w, b.x, b.z + b.d / 2], [0, -1, b.w, b.x, b.z - b.d / 2]];
      for (let fi = 0; fi < 4; fi++) {
        const [nx, nz, L, cx, cz] = faces[fi];
        if (L < cfg.minFace) continue;
        yield; // 面ごと（高い塔は面ひとつで窓が数百）
        // 外に向いた面か（面の外 outTest m の 3 点・2 つの高さが空いている）
        const tx = -nz, tz = nx; // 面に沿った向き
        let open = true;
        for (const s of [-0.35, 0, 0.35]) for (const yy of [b.y + Math.min(3.2, b.h * 0.5), b.y + b.h * 0.6]) {
          if (G.inside(cx + nx * cfg.outTest + tx * s * L, yy, cz + nz * cfg.outTest + tz * s * L, bi)) { open = false; break; }
        }
        if (!open) continue;
        const rot = Math.atan2(nx, nz); // +Z（部品の外）を法線へ
        // 窓の格子は世界座標（テクスチャの u = 座標 / tile）。面に沿った座標 = x（法線が z）か z（法線が x）
        const along0 = nx !== 0 ? cz - L / 2 : cx - L / 2;
        const k0 = Math.ceil((along0 + 0.6 - M.x0) / M.bay), k1 = Math.floor((along0 + L - 0.6 - M.x0) / M.bay);
        const top = b.y + b.h;
        const fseed = h01(q(b.x), q(b.y), q(b.z), fi);
        for (let k = k0; k <= k1; k++) {
          const a = M.x0 + k * M.bay; // 窓の中心（面に沿った座標）
          const px = nx !== 0 ? cx : a, pz = nx !== 0 ? a : cz;
          const fx = px + nx * 0.005, fz = pz + nz * 0.005;
          // 1 階: 日よけ（2 つの窓ごと）・灯り・看板
          if (ground) {
            const r = h01(q(px), q(pz), 11, fi);
            // 店 = 3 窓ずつのひと続き。日よけは店ごとに（その店の窓ぜんぶ・同じ色）、窓の真ん中・まぐさ石の 0.15 m 上
            const shop = Math.floor(k / 3), rs = h01(q(cx), q(cz), shop, 31 + fi);
            if (M.awning && rs < M.awning) {
              push('kit_awning', fx, b.y + M.sill + 1.85 + 0.22 + 0.15 + 0.62 - 0.35, fz, rot, h01(q(cx), q(cz), shop, 12 + fi), groundY);
            } else if (M.lamp && r > 1 - M.lamp) {
              push('kit_lamp', fx, groundY + 3.4, fz, rot, 0, groundY);
            } else if (M.sign && h01(q(px), q(pz), 13, fi) < M.sign) {
              push('kit_sign', fx, groundY + 4.2, fz, rot, h01(q(px), q(pz), 14, fi), groundY);
            }
          }
          // 上の階: 窓のエアコン・換気口・旗
          if (++ops % 6 === 0) yield;
          for (let f = 1; f < 40; f++) {
            const sill = b.y + f * M.storey + M.sill; // 壁のテクスチャの v は箱の下端から（world.js _fullBox の face(…, y0)）
            if (sill > top - 1.2) break;
            if (sill < b.y + 0.5) continue;
            const r = h01(q(px), q(sill), 21, fi) * 0.7 + fseed * 0.3;
            if (M.ac && r < M.ac) push('kit_ac', fx, sill + (cfg.acLift || 0.12), fz, rot, 0, groundY); // 下の窓枠に載る（窓台より少し上）
            else if (M.vent && r > 1 - M.vent) push('kit_vent', fx, sill + 1.4, fz, rot, 0, groundY);
            else if (M.flag && f === 1 && h01(q(px), q(pz), 22, fi) < M.flag) push('kit_flag', fx, sill + 2.2, fz, rot, h01(q(px), q(pz), 23, fi), groundY);
          }
        }
      }
    }
    return out;
  }

  function place(data, kitCfg, extraKeep, city) {
    const g = job(data, kitCfg, extraKeep, city);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }

  // 置き方の hash（QT3: 同じ入力 → 同じ結果）
  function hash(list) {
    let h = 2166136261 >>> 0;
    for (const p of list) {
      const s = p.type + p.x + ',' + p.y + ',' + p.z + ',' + p.rot.toFixed(4) + ',' + p.tint;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    }
    return h.toString(16);
  }

  return { PIECES, TYPES, DEF, place, job, hash, cfgOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MR.CityKit;
