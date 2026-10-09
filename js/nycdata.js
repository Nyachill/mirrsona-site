// 「本物のニューヨーク」のデータ（assets/levels/nyc/）の読み取り。THREE にも DOM にも依存しない（citygen.js と同じ UMD）。
//   ブラウザ: <script> で読む → MR.NycData      Node / Worker: require('../www/js/nycdata.js') → NycData（globalThis.MR.NycData にも入る）
//   作り方: tools/nyc/fetch_overture.py → tools/nyc/build_nyc.py（tools/nyc/README.md）。まだゲームからは使っていない（フェーズ R1 で citygen v2 が使う）
//
// ■ 座標: 単位 m、+Y 上、+X = 格子の東（イースト川の方）、−Z = 格子の北（アベニューを北へ）。原点 = パーク街の中心線 × 42 丁目の中心線。
//   マンハッタンの格子が軸にそろうように、真北から GRID_ROTATION（約 29.0°）回してある（nyc.json の frame）。
//   世界 bounds（x −2900..3100, z −3000..9800）。タイル = 512 m 四方。tx = floor((x − minX) / 512), tz = floor((z − minZ) / 512)。
//   ファイル assets/levels/nyc/t_<tx>_<tz>.bin（nyc.json の隣。hd / sd 共通。陸も建物も無いタイルはファイルが無い = 全部水）。
//   nyc.json の tiles["tx_tz"] にバイト数と件数（tileColumns の順）、tileFile にファイル名の形、tileVersion に版。
//
// ■ タイルの持ち主: 建物（と部品）は外形の重心があるタイル。道・線・面はタイルの境で切ってある（隣と端点を共有する）。
//   → 建物だけはタイルの外へはみ出す（最大でも数百 m。座標は ±1024 m まで表せる）。
//
// ■ バイナリ（リトルエンディアン。セクションと列はすべて 4 バイト境界）
//   header 24 B: u32 magic 0x5443594E ('NYCT') | u16 version(1) | u16 nSections | i16 tx | i16 tz | f32 cx | f32 cz（タイル中心）| f32 scale（1/32 m）
//   section table: nSections × { char[4] tag, u32 offset（ファイル先頭から）, u32 byteLength }
//   座標は i16（タイル中心からの scale 単位）。デコードでワールド座標の Float32Array（x, z の交互）にする。
//   多角形ブロック: u32 nFeat, nRings, nVerts | u32 ringStart[nFeat+1] | u32 vertStart[nRings+1] | i16 xz[2·nVerts]
//     1 つ目のリングが外周（符号付き面積 ½Σ(x_i z_{i+1} − x_{i+1} z_i) > 0）、残りが穴（< 0）。閉じる頂点（最初と同じ点）は持たない。
//   線ブロック: u32 n, nVerts | u32 vertStart[n+1] | i16 xz[2·nVerts] | (ROAD のみ) i16 y[nVerts]（cm）
//   STRS: u32 n | u32 off[n+1] | utf-8 バイト列。0 番は ''（名前なし）
//   BLDG: 多角形ブロック + u32 gid | u16 height（dm、屋根の頂上）| u16 minHeight（dm、下端。宙に浮く建物・キャノピー）| u16 roofHeight（dm、
//         屋根の形の部分）| u16 name | u32 partStart[n+1]（PART の範囲）| u32 facadeColor | u32 roofColor（0x1RRGGBB、0 = 不明）|
//         u16 flags（buildingFlags）| u8 floors | u8 cls | u8 style | u8 roofShape | u8 facadeMat | u8 roofMat（enums）
//   PART: 多角形ブロック + u16 parent（このタイルの BLDG の番号）| u16 height | u16 minHeight | u16 roofHeight（dm）| u16 name |
//         u32 facadeColor | u32 roofColor | u8 roofShape | u8 facadeMat | u8 roofMat | u8 estimated（partFlags のビット: 1 = 高さが推定、
//         2 = remainder = 外形から部品を引いた残りを build_nyc.py が足したもの）
//         部品がある建物（flags & hasParts）は部品だけで形を作る。部品が外形を覆っていなかった所は remainder 部品で埋めてあるので
//         穴は空かない（flags & remainder）。外形の height は「その敷地に実際に立っているもの」の包絡（地面から積み上がる部品と
//         remainder の最大。他の建物の張り出しのように宙に浮いた部品は含めない）で、当たり判定・遠景用。
//         同じ建物の部品は「下端と上端が 0.5 m 以内」で重なることは無い（同じ高さの角柱が二重にならない。build_nyc.py の dedupe_parts、
//         tools/nyc/check.js の intraParts）。高さの範囲が入れ子の部品（上端が同じ・下端が同じ）も重ならない（内側の方が切ってある。
//         地面から立つ段は「0〜200 m の塔」と「塔の形を抜いた 0〜100 m の低層部」のように分かれていて、面が重ならない）
//         buildingFlags（nyc.json）: hasParts 1, heightEstimated 2, landmark 4, ml 8, courtyard 16, elevated 32, minEstimated 64, multi 128,
//         remainder 256, override 512（tools/nyc/overrides.json で直した）, underConstruction 1024（工事中。高さは今の高さに抑えてある）,
//         floorsEstimated 2048（floors はデータでなく高さから数えた値: データに階数が無い、または高さに比べてありえない階数だった）
//   ROAD: 線ブロック（y 付き。橋・高架の路面の高さ。地上は 0）+ u8 cls | u8 flags（roadFlags）| i8 level | u8 pad |
//         u8 curbL | u8 curbR（中心線から左右の縁石まで、0.1 m 単位）| u8 swL | u8 swR（歩道の幅、0.1 m）| u16 name
//         左右は線の向き（頂点の順）に対して。左 = 進行方向の左（x 右・z 下の画面で見て反時計回り側 = 法線 (−dz, dx)）。
//         車道・路地の幅は建物の壁・地図の歩道の線・並行する反対車線から測った値（無ければ種類ごとの既定値）
//   AREA: 多角形ブロック + u8 kind（areaKind。land = 陸。陸でない所は水面）| u8 sub（kind が water のとき waterKind）| u16 name | i16 y（cm）
//   LINE: 線ブロック（y なし）+ u8 kind（lineKind）| u16 name
//   PNTS: u32 n | i16 xz[2n] | u8 kind（pointKind）| u16 name
//
// ■ API
//   NycData.decodeTile(buffer)                ArrayBuffer か Uint8Array → { tx, tz, cx, cz, strings, buildings, parts, roads, areas, lines, points }
//                                            （各ブロックは列ごとの型付き配列。xz はワールド座標、高さ・幅は m の Float32Array）
//   NycData.tileKey(tx, tz) / tileOf(meta, x, z) → [tx, tz] / tileRect(meta, tx, tz) → [x0, z0, x1, z1] / tileUrl(meta, tx, tz) / hasTile(meta, tx, tz)
//   NycData.tilesInRect(meta, x0, z0, x1, z1) → [[tx, tz], …]（ファイルがあるものだけ）
//   NycData.ring(block, ringIndex) → Float32Array [x0, z0, x1, z1, …]（コピー）  NycData.rings(block, feature) → [ringIndex…]
//   NycData.building(tile, i) / part(tile, i) / road(tile, i) / area(tile, i)  → ふつうのオブジェクト（デバッグ・ツール用。遅い）
//   NycData.enumName(meta, 'roadClass', code) / enumCode(meta, 'areaKind', 'park')
//   NycData.signedArea(xz, a, b) … 頂点 a..b（含まない）の符号付き面積
//   NycData.pointIn(block, i, x, z) … 点が多角形ブロック（buildings / parts / areas）の i 番の中か（穴は外）
(function (root) {
  const MR = root.MR || (root.MR = {});
  const MAGIC = 0x5443594e;

  function Reader(buf, off) {
    this.buf = buf;
    this.dv = new DataView(buf);
    this.p = off;
  }
  Reader.prototype.u32 = function () { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; };
  Reader.prototype._align = function () { this.p = (this.p + 3) & ~3; };
  Reader.prototype.arr = function (Type, n) {
    const a = new Type(this.buf, this.p, n);
    this.p += n * Type.BYTES_PER_ELEMENT;
    this._align();
    return a;
  };

  function polyBlock(r, cx, cz, scale) {
    const n = r.u32(), nRings = r.u32(), nVerts = r.u32();
    const ringStart = r.arr(Uint32Array, n + 1);
    const vertStart = r.arr(Uint32Array, nRings + 1);
    const q = r.arr(Int16Array, nVerts * 2);
    const xz = new Float32Array(nVerts * 2);
    for (let i = 0; i < nVerts * 2; i += 2) { xz[i] = cx + q[i] * scale; xz[i + 1] = cz + q[i + 1] * scale; }
    return { count: n, ringStart, vertStart, xz };
  }

  function lineBlock(r, cx, cz, scale, withY) {
    const n = r.u32(), nVerts = r.u32();
    const vertStart = r.arr(Uint32Array, n + 1);
    const q = r.arr(Int16Array, nVerts * 2);
    const xz = new Float32Array(nVerts * 2);
    for (let i = 0; i < nVerts * 2; i += 2) { xz[i] = cx + q[i] * scale; xz[i + 1] = cz + q[i + 1] * scale; }
    const out = { count: n, vertStart, xz };
    if (withY) {
      const yq = r.arr(Int16Array, nVerts);
      const y = new Float32Array(nVerts);
      for (let i = 0; i < nVerts; i++) y[i] = yq[i] * 0.01;
      out.y = y;
    }
    return out;
  }

  function scaled(src, k) {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] * k;
    return out;
  }

  const td = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function utf8(bytes) {
    if (td) return td.decode(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  const SECTIONS = {
    STRS(r, t) {
      const n = r.u32();
      const off = r.arr(Uint32Array, n + 1);
      const bytes = new Uint8Array(r.buf, r.p, off[n]);
      const s = new Array(n);
      for (let i = 0; i < n; i++) s[i] = i === 0 ? '' : utf8(bytes.subarray(off[i], off[i + 1]));
      t.strings = s;
    },
    BLDG(r, t) {
      const b = polyBlock(r, t.cx, t.cz, t.scale);
      const n = b.count;
      b.gid = r.arr(Uint32Array, n);
      b.height = scaled(r.arr(Uint16Array, n), 0.1);
      b.minHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.roofHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      b.partStart = r.arr(Uint32Array, n + 1);
      b.facadeColor = r.arr(Uint32Array, n);
      b.roofColor = r.arr(Uint32Array, n);
      b.flags = r.arr(Uint16Array, n);
      b.floors = r.arr(Uint8Array, n);
      b.cls = r.arr(Uint8Array, n);
      b.style = r.arr(Uint8Array, n);
      b.roofShape = r.arr(Uint8Array, n);
      b.facadeMat = r.arr(Uint8Array, n);
      b.roofMat = r.arr(Uint8Array, n);
      t.buildings = b;
    },
    PART(r, t) {
      const b = polyBlock(r, t.cx, t.cz, t.scale);
      const n = b.count;
      b.parent = r.arr(Uint16Array, n);
      b.height = scaled(r.arr(Uint16Array, n), 0.1);
      b.minHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.roofHeight = scaled(r.arr(Uint16Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      b.facadeColor = r.arr(Uint32Array, n);
      b.roofColor = r.arr(Uint32Array, n);
      b.roofShape = r.arr(Uint8Array, n);
      b.facadeMat = r.arr(Uint8Array, n);
      b.roofMat = r.arr(Uint8Array, n);
      b.estimated = r.arr(Uint8Array, n);
      t.parts = b;
    },
    ROAD(r, t) {
      const b = lineBlock(r, t.cx, t.cz, t.scale, true);
      const n = b.count;
      b.cls = r.arr(Uint8Array, n);
      b.flags = r.arr(Uint8Array, n);
      b.level = r.arr(Int8Array, n);
      r.arr(Uint8Array, n); // pad
      b.curbL = scaled(r.arr(Uint8Array, n), 0.1);
      b.curbR = scaled(r.arr(Uint8Array, n), 0.1);
      b.swL = scaled(r.arr(Uint8Array, n), 0.1);
      b.swR = scaled(r.arr(Uint8Array, n), 0.1);
      b.name = r.arr(Uint16Array, n);
      t.roads = b;
    },
    AREA(r, t) {
      const b = polyBlock(r, t.cx, t.cz, t.scale);
      const n = b.count;
      b.kind = r.arr(Uint8Array, n);
      b.sub = r.arr(Uint8Array, n);
      b.name = r.arr(Uint16Array, n);
      b.y = scaled(r.arr(Int16Array, n), 0.01);
      t.areas = b;
    },
    LINE(r, t) {
      const b = lineBlock(r, t.cx, t.cz, t.scale, false);
      b.kind = r.arr(Uint8Array, b.count);
      b.name = r.arr(Uint16Array, b.count);
      t.lines = b;
    },
    PNTS(r, t) {
      const n = r.u32();
      const q = r.arr(Int16Array, n * 2);
      const xz = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i += 2) { xz[i] = t.cx + q[i] * t.scale; xz[i + 1] = t.cz + q[i + 1] * t.scale; }
      t.points = { count: n, xz, kind: r.arr(Uint8Array, n), name: r.arr(Uint16Array, n) };
    }
  };

  const EMPTY_POLY = () => ({ count: 0, ringStart: new Uint32Array(1), vertStart: new Uint32Array(1), xz: new Float32Array(0) });

  function decodeTile(input) {
    let buf;
    if (input instanceof ArrayBuffer) buf = input;
    else if (ArrayBuffer.isView(input)) {
      buf = (input.byteOffset % 4 === 0 && input.byteOffset === 0 && input.byteLength === input.buffer.byteLength)
        ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    } else throw new Error('NycData.decodeTile: ArrayBuffer expected');
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('NycData: not a NYC tile');
    const version = dv.getUint16(4, true);
    if (version !== 1) throw new Error('NycData: unsupported tile version ' + version);
    const nSec = dv.getUint16(6, true);
    const t = {
      version, tx: dv.getInt16(8, true), tz: dv.getInt16(10, true),
      cx: dv.getFloat32(12, true), cz: dv.getFloat32(16, true), scale: dv.getFloat32(20, true),
      strings: [''], buildings: null, parts: null, roads: null, areas: null, lines: null, points: null,
      byteLength: buf.byteLength
    };
    for (let i = 0; i < nSec; i++) {
      const o = 24 + i * 12;
      const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
      const off = dv.getUint32(o + 4, true);
      const fn = SECTIONS[tag];
      if (fn) fn(new Reader(buf, off), t); // 知らないセクションは飛ばす（新しい版の追加分）
    }
    if (!t.buildings) t.buildings = Object.assign(EMPTY_POLY(), { gid: new Uint32Array(0), partStart: new Uint32Array(1) });
    if (!t.parts) t.parts = EMPTY_POLY();
    if (!t.areas) t.areas = EMPTY_POLY();
    if (!t.roads) t.roads = { count: 0, vertStart: new Uint32Array(1), xz: new Float32Array(0), y: new Float32Array(0) };
    if (!t.lines) t.lines = { count: 0, vertStart: new Uint32Array(1), xz: new Float32Array(0) };
    if (!t.points) t.points = { count: 0, xz: new Float32Array(0), kind: new Uint8Array(0), name: new Uint16Array(0) };
    return t;
  }

  // ---------- タイルの位置 ----------
  function tileKey(tx, tz) { return tx + '_' + tz; }
  function tileOf(meta, x, z) {
    const b = meta.bounds;
    return [Math.floor((x - b.minX) / meta.tile), Math.floor((z - b.minZ) / meta.tile)];
  }
  function tileRect(meta, tx, tz) {
    const b = meta.bounds;
    const x0 = b.minX + tx * meta.tile, z0 = b.minZ + tz * meta.tile;
    return [x0, z0, x0 + meta.tile, z0 + meta.tile];
  }
  function hasTile(meta, tx, tz) { return !!meta.tiles[tileKey(tx, tz)]; }
  function tileUrl(meta, tx, tz) { return 'levels/nyc/t_' + tx + '_' + tz + '.bin'; }
  function tilesInRect(meta, x0, z0, x1, z1) {
    const a = tileOf(meta, x0, z0), b = tileOf(meta, x1, z1);
    const out = [];
    for (let tx = Math.max(0, a[0]); tx <= Math.min(meta.tilesX - 1, b[0]); tx++) {
      for (let tz = Math.max(0, a[1]); tz <= Math.min(meta.tilesZ - 1, b[1]); tz++) if (hasTile(meta, tx, tz)) out.push([tx, tz]);
    }
    return out;
  }

  // ---------- 便利関数（ツール・デバッグ用） ----------
  function rings(block, i) {
    const out = [];
    for (let k = block.ringStart[i]; k < block.ringStart[i + 1]; k++) out.push(k);
    return out;
  }
  function ring(block, k) {
    return block.xz.slice(block.vertStart[k] * 2, block.vertStart[k + 1] * 2);
  }
  function signedArea(xz, a, b) {
    let s = 0;
    for (let i = a; i < b; i++) {
      const j = i + 1 < b ? i + 1 : a;
      s += xz[i * 2] * xz[j * 2 + 1] - xz[j * 2] * xz[i * 2 + 1];
    }
    return s / 2;
  }
  function polyRings(block, i) { return rings(block, i).map((k) => Array.from(ring(block, k))); }
  function building(t, i) {
    const b = t.buildings;
    const parts = [];
    for (let k = b.partStart[i]; k < b.partStart[i + 1]; k++) parts.push(part(t, k));
    return {
      gid: b.gid[i], rings: polyRings(b, i), height: b.height[i], minHeight: b.minHeight[i], roofHeight: b.roofHeight[i],
      name: t.strings[b.name[i]], facadeColor: b.facadeColor[i], roofColor: b.roofColor[i], flags: b.flags[i],
      floors: b.floors[i], cls: b.cls[i], style: b.style[i], roofShape: b.roofShape[i], facadeMat: b.facadeMat[i],
      roofMat: b.roofMat[i], parts
    };
  }
  function part(t, i) {
    const p = t.parts;
    return {
      parent: p.parent[i], rings: polyRings(p, i), height: p.height[i], minHeight: p.minHeight[i], roofHeight: p.roofHeight[i],
      name: t.strings[p.name[i]], facadeColor: p.facadeColor[i], roofColor: p.roofColor[i], roofShape: p.roofShape[i],
      facadeMat: p.facadeMat[i], roofMat: p.roofMat[i], estimated: !!(p.estimated[i] & 1), remainder: !!(p.estimated[i] & 2)
    };
  }
  function road(t, i) {
    const r = t.roads;
    const a = r.vertStart[i], b = r.vertStart[i + 1];
    return {
      xz: Array.from(r.xz.subarray(a * 2, b * 2)), y: Array.from(r.y.subarray(a, b)), cls: r.cls[i], flags: r.flags[i],
      level: r.level[i], curbL: r.curbL[i], curbR: r.curbR[i], swL: r.swL[i], swR: r.swR[i], name: t.strings[r.name[i]]
    };
  }
  function area(t, i) {
    const a = t.areas;
    return { rings: polyRings(a, i), kind: a.kind[i], sub: a.sub[i], name: t.strings[a.name[i]], y: a.y[i] };
  }
  // 点 (x, z) が多角形ブロックの i 番（外周の中で、どの穴の中でもない）に入っているか
  function insideRing(xz, a, b, x, z) {
    let c = false;
    for (let i = a, j = b - 1; i < b; j = i++) {
      const xi = xz[i * 2], zi = xz[i * 2 + 1], xj = xz[j * 2], zj = xz[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  function pointIn(block, i, x, z) {
    const r0 = block.ringStart[i], r1 = block.ringStart[i + 1];
    if (!insideRing(block.xz, block.vertStart[r0], block.vertStart[r0 + 1], x, z)) return false;
    for (let k = r0 + 1; k < r1; k++) if (insideRing(block.xz, block.vertStart[k], block.vertStart[k + 1], x, z)) return false;
    return true;
  }
  function enumName(meta, kind, c) { return (meta.enums[kind] || [])[c] || ''; }
  function enumCode(meta, kind, name) { return (meta.enums[kind] || []).indexOf(name); }

  const NycData = {
    MAGIC, decodeTile, tileKey, tileOf, tileRect, hasTile, tileUrl, tilesInRect,
    rings, ring, signedArea, pointIn, building, part, road, area, enumName, enumCode
  };
  MR.NycData = NycData;
  if (typeof module !== 'undefined' && module.exports) module.exports = NycData;
})(typeof window !== 'undefined' ? window : globalThis);
