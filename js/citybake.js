// 前もって作った街の形（prebaked-city）: 遠景のデータ far.bin を端末にダウンロードしておき、起動時・飛行中に作る代わりに読む（MR.CityBake）。
//   far.bin = LOD の 512 m 区画（world.buildLod の形）・スカイライン（buildSkyline の区画ごとの形）・chunkTops・skyline() のデータ。
//   CI（.github/workflows/deploy-pages.yml）が tools/bake-city.js で作り、サイトの assets/city/<level>/ に置く（manifest.json には入れない:
//   入れると今のアプリがみな起動時に全部をダウンロードしてしまう）。アプリは自分で city/<level>/index.json を見て、自分の鍵の far.bin を
//   バックグラウンドでダウンロードし、端末の Caches（iOS: Library/Caches。消されてもよい。Web: IndexedDB の cache/）に置く。
//   無い・合わない・壊れている・設定でオフ → いつも今まで通りその場で作る（遅いだけで、形は同じ）。
//
// ■ 同じ形になる約束: world.js の CityGeo は q（1/256 m・uv 1/1024 の格子に丸める）で書き、ランドマークの部品は後ろの lm セグメントにあるので、
//   同じ citygen・同じ midtown.json・同じ world.js からはバイトまで同じ配列になる。ここの符号化は格子の整数で持つので、読んだ形は
//   実行時に作った形とバイトまで同じ（tools/bake-city.js --check / --selftest、smoke の 16、tools/city-bake-e2e.js が確かめる）。
//
// ■ 鍵（keys）: どれも同期・ファイルを読まない（Function.prototype.toString。preview.html・http の LAN でも同じ値）
//   fmtKey = hash64('MRC' + FORMAT + meshSig + readSig + matSig)  … ディレクトリの名前（city/<level>/<fmtKey>/）。形を書くコード（world.js の
//            CityGeo と MESH_METHODS / STATIC_METHODS・MR.srgb・この符号化 ENCODER_SIG）、読むコード（readSig = このファイル全部 = 名前付きの
//            関数 citybakeModule の toString（符号化・復元・ワーカー・端末の扱い）と world.js の READER_METHODS / READER_STATIC）と
//            材質の定義（DEFS の名前・tile・procTile）。読む側も鍵に入れる: アプリはサイトの index.json から鍵だけでビルドを選ぶので、
//            入れないと、自分の --check に落ちた（読むコードが壊れた）アプリが、同じ鍵のほかのビルドの far.bin を壊れたコードで読んで違う形を
//            出せた。inflate（lib/fflate-inflate.min.js）は入れない: 中身ごとの FNV（check）が縮める前のバイトを確かめる（合わなければ使わない）。
//            さらに tools/bake-city.js は、ある木の --check が落ちたらその鍵のビルドを index.json から全部外す（鍵が覆わないコードの違いでも）
//   genKey = hash64(CityGen.moduleSource() + JSON.stringify(level))  … far.bin はこれがちょうど同じときだけ使う
//
// ■ ファイル（FORMAT 1、リトルエンディアン。可変長の整数は LEB128、符号付きは zigzag）
//   'MRCF' u16 FORMAT u16 flags(bit0 = 中身を deflate-raw) u32 全体の長さ u8[8] fmtKey u8[8] genKey str level u16 nsx u16 nsz
//   u16 n 文字列（メッシュ・属性・ランドマークの名前）u16 n tile 表 { u16 名前, f32 u, f32 v } u32 n 中身の表
//   { u8 kind, u16 a, u16 b, u8 part, u32 check, u32 off, u32 comp, u32 raw } → 4 バイトにそろえて本体（off は本体の先頭から）
//   kind 1 = LOD 区画 (sx, sz)  2 = スカイラインの区画 (sx, sz)  4 = chunkTops（Float32Array）  5 = skyline() のデータ
//   （0 = 近景のチャンク、3 = 空のチャンクは M3 の詳細パック用に空けてある）。check = 縮める前の中身の FNV-1a（壊れたファイルを見つける）
//   メッシュの並び（kind 1 / 2）: varint n、メッシュごとに 名前 nv ni、lm セグメント [名前 v0 nv i0 ni]、属性の表
//   { 名前 itemSize 型 normalized 符号化 }（grid = 格子の整数の差分・rle = 同じ値の続き・delta = 整数の差分・raw）、インデックス
//   （偶数 r = r/2 個の四角形 a,a+1,a+2,a,a+2,a+3（a = まだ使っていない次の頂点）/ 奇数 r = (r−1)/2 個の三角形を差分で）
//
// ■ 読み方: ワーカー（このファイルを new Worker で。inflate と復元をメインスレッドの外で。配列は transfer）。far.bin のバイト列はメインスレッドに
//   1 つだけ（起動時の prime はメインスレッドで復元する）、ワーカーには中身ごとの縮めたバイト列の写しを送る。ワーカーが作れない・答えない
//   （preview.html・Node・capacitor:// で失敗・workerCallTimeoutMs を過ぎた）ときはメインスレッドで少しずつ（world.lodJob が yield する）。
//   CityBake はレベルごとに 1 つ（get）。ゲーム・ワールドへの参照は持たない（「もう一度」の後も残る。ワールドは数だけ渡す: acquire / release）。
//   起動時（main.js）: prepare（端末の far.bin を開き、名前の SHA256 を確かめ、スカイライン・chunkTops・skyline() のデータを先に復元）→
//   startDownload（サイトの index.json を見て、無ければ far.bin をダウンロード → SHA256 を確かめて .part に書いてから名前を変える = 途中で落ちても
//   壊れたファイルは残らない）。端末の保存・読み込みは 1 回 storageTimeoutMs まで（終わらなければ失敗 = メモリで使う）。
//   街を始める前（main.js の startSolo・オンライン・続きから）: whenSky（prepare とスカイラインの復元を最長 startWaitMs 待つ）。
//   ゲーム中: world が request('lod' | 'sky' | 'tops' | 'skydata') で受け取る（無ければ null = その場で作る）。街（とアリーナ）のゲームの最中に
//   開いた far.bin は LOD の区画にだけ使い、スカイライン・chunkTops・skyline() は復元しない（そのゲームはもう自分で作った物を使っている）。
//   設定（#settings の「街のデータ」）: ダウンロードのオン・オフ（mirrsona.cityBake）と「街のデータを削除」（clear）。
//
// ■ どのファイルを使うか: サイトの index.json が決める。一度ネットで index を読んだら（端末に写しがある）、その index がこの鍵に名前を書いている
//   far.bin だけを開く（起動時の prepare も写しで）。ネットで読んだ index が開いているファイルの名前を書いていない（サイトが別のファイルに
//   入れ替えた・取り消した）→ そのファイルはすぐ使うのをやめ（スカイライン・chunkTops・skyline() も捨てる）、端末から消し、書いてあるファイルを
//   ダウンロードする。写しの無い端末（まだ index を読んだことが無い）だけ、端末にあるこの鍵の far.bin をどれでも開く（名前の SHA256 は確かめる）。
// ■ 消す・取り直すのは「端末で壊れた」ファイルだけ: 名前（中身の SHA256 の頭）と中身が合わない・途中で切れた。SHA256 が合うファイルの復元に
//   失敗した（ワーカーのメモリ不足・この端末のエンジンだけの例外・サイトの中身そのものが悪い）ときは、取り直しても同じバイトなので、
//   消さず・取り直さず、このセッションだけ使わない（_unusable。その場で作る）。ワーカーで失敗したらまずメインスレッドで 1 回やり直し
//   （ワーカーは止める）、そこでも失敗したら使わない。far.bin を取りに行くのは 1 セッションに fetchMax 回まで（設定の操作で数え直す）。
(function citybakeModule() { // 名前は鍵（readSig）のため: citybakeModule.toString() = このファイルのコード全部
  'use strict';
  const root = typeof window !== 'undefined' ? window : self;
  const MR = root.MR = root.MR || {};
  const IN_WORKER = typeof window === 'undefined' && typeof importScripts === 'function';
  // ワーカーで読むこのファイルの URL（ページから）。preview.html（中に埋め込み）・Node では '' = ワーカーを使わない
  const SCRIPT_SRC = (!IN_WORKER && typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  const FORMAT = 1;
  const TYPED = [Float32Array, Int8Array, Uint8Array, Int16Array, Uint16Array]; // 型の番号
  const SIZE = [4, 1, 1, 2, 2];
  const GRID = 0, RLE = 1, DELTA = 2, RAW = 3;
  // 知っている属性（world.js の CityGeo.toGeometry が作るもの）。ほかの属性・型を見たら符号化しない（失敗 = 形が変わらないように）
  const ATTRS = {
    position: { itemSize: 3, type: 0, normalized: false, codec: GRID, scaleLog2: 8 },
    normal: { itemSize: 3, type: 1, normalized: true, codec: RLE },
    uv: { itemSize: 2, type: 0, normalized: false, codec: GRID, scaleLog2: 10 },
    color: { itemSize: 3, type: 2, normalized: true, codec: RLE },
    aInfo: { itemSize: 4, type: 2, normalized: false, codec: RLE }
  };
  const ENCODER_SIG = 'MRC' + FORMAT + ';codec grid,rle,delta,raw;type f32,i8,u8,i16,u16;index quads;attr ' +
    Object.keys(ATTRS).map((k) => k + ':' + ATTRS[k].codec + '/' + ATTRS[k].type + '/' + ATTRS[k].itemSize + '/' + (ATTRS[k].scaleLog2 || 0)).join(',') +
    ';kind 1 lod 2 sky 4 tops 5 skydata;bounds three-r128';
  const KIND = { lod: 1, sky: 2, tops: 4, skydata: 5 };
  // 中身 1 つの縮める前の長さの上限（今の far.bin の一番大きい中身は 約 0.25 MB）。壊れた頭で inflate が何 GB も確保しないように
  const MAX_RAW = 64 * 1048576;
  const FAR_NAME = /^far\.([0-9a-f]{16})\.bin$/; // 端末・サイトの far.bin の名前（中身の SHA256 の頭 16 桁）

  // ---------- 小さな道具 ----------
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const utf8 = (s) => enc.encode(s);
  const unutf8 = (b) => dec.decode(b);
  const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
  // 2 本の 32 bit（murmur3 の混ぜ方）で UTF-16 の 1 文字ずつ → 16 桁の 16 進
  function hash64(s) {
    let h1 = 0x9747b28c | 0, h2 = (0x85ebca6b ^ s.length) | 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      let k = Math.imul(c, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
      h1 ^= k; h1 = (h1 << 13) | (h1 >>> 19); h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
      let j = Math.imul(c ^ 0x5bd1, 0x85ebca77); j = (j << 17) | (j >>> 15); j = Math.imul(j, 0xc2b2ae3d);
      h2 ^= j; h2 = (h2 << 11) | (h2 >>> 21); h2 = (Math.imul(h2, 9) + 0x27d4eb2f) | 0;
    }
    const fmix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h; };
    h1 ^= s.length; h2 ^= s.length;
    h1 = (h1 + h2) | 0; h2 = (h2 + h1) | 0;
    h1 = fmix(h1); h2 = fmix(h2);
    h1 = (h1 + h2) | 0; h2 = (h2 + h1) | 0;
    return hex8(h1) + hex8(h2);
  }
  // FNV-1a（32 bit）。縮める前の中身の確かめ（壊れた・いじられたファイル）
  function fnv(b) {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // SHA-256（crypto.subtle が無い所 = http の LAN・古い端末用。同期）
  const SHA_K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(u8) {
    const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = u8.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
    m.set(u8); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(nb - 4, (l * 8) >>> 0); dv.setUint32(nb - 8, Math.floor(l / 536870912));
    const w = new Int32Array(64);
    for (let off = 0; off < nb; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) + w[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10))) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    let s = '';
    for (let i = 0; i < 8; i++) s += hex8(H[i]);
    return s;
  }
  function inflate(comp, rawLen) {
    const F = root.fflate;
    if (!F || typeof F.inflateSync !== 'function') throw new Error('inflate unavailable');
    const out = F.inflateSync(comp, { out: new Uint8Array(rawLen) });
    if (out.length !== rawLen) throw new Error('inflate length ' + out.length + ' != ' + rawLen);
    return out.length === out.buffer.byteLength ? out : out.slice();
  }

  // ---------- 書く（Node の tools/bake-city.js が使う）----------
  class Writer {
    constructor(cap) { this.b = new Uint8Array(cap || 65536); this.n = 0; }
    need(k) {
      if (this.n + k <= this.b.length) return;
      let c = this.b.length * 2;
      while (this.n + k > c) c *= 2;
      const nb = new Uint8Array(c); nb.set(this.b.subarray(0, this.n)); this.b = nb;
    }
    u8(v) { this.need(1); this.b[this.n++] = v & 255; }
    u16(v) { if (!(v >= 0 && v < 65536)) throw new Error('u16 range ' + v); this.need(2); this.b[this.n++] = v & 255; this.b[this.n++] = (v >>> 8) & 255; }
    u32(v) { if (!(v >= 0 && v < 4294967296)) throw new Error('u32 range ' + v); this.need(4); for (let i = 0; i < 4; i++) this.b[this.n++] = Math.floor(v / Math.pow(2, 8 * i)) & 255; }
    f32(v) { this.need(4); new DataView(this.b.buffer, this.b.byteOffset).setFloat32(this.n, v, true); this.n += 4; }
    f64(v) { this.need(8); new DataView(this.b.buffer, this.b.byteOffset).setFloat64(this.n, v, true); this.n += 8; }
    vu(v) {
      if (!(v >= 0 && v <= Number.MAX_SAFE_INTEGER) || v !== Math.floor(v)) throw new Error('varint ' + v);
      this.need(8);
      while (v >= 128) { this.b[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); }
      this.b[this.n++] = v;
    }
    vs(v) { this.vu(v >= 0 ? v * 2 : -v * 2 - 1); }
    bytes(u8) { this.need(u8.length); this.b.set(u8, this.n); this.n += u8.length; }
    str(s) { const e = utf8(s); if (e.length > 255) throw new Error('string too long'); this.u8(e.length); this.bytes(e); }
    val(type, v) { // 型 type の値 1 つ（rle / raw）
      if (type === 1 || type === 2) this.u8(v);
      else if (type === 3 || type === 4) { this.need(2); this.b[this.n++] = v & 255; this.b[this.n++] = (v >> 8) & 255; }
      else this.f32(v);
    }
    out() { return this.b.slice(0, this.n); }
  }
  const typeOf = (arr) => { for (let t = 0; t < TYPED.length; t++) if (arr instanceof TYPED[t]) return t; return -1; };

  // メッシュの並び → バイト列。meshes: [{ name, attrs: [{ name, itemSize, normalized, array }], idx, nv, ni, segs }]。sid(文字列) → 番号
  function encodeMeshes(meshes, sid) {
    const w = new Writer(1 << 16);
    w.vu(meshes.length);
    for (const m of meshes) {
      w.vu(sid(m.name)); w.vu(m.nv); w.vu(m.ni);
      const segs = m.segs || [];
      w.vu(segs.length);
      for (const s of segs) { w.vu(sid(s[0])); w.vu(s[1]); w.vu(s[2]); w.vu(s[3]); w.vu(s[4]); }
      w.u8(m.attrs.length);
      for (const a of m.attrs) encodeAttr(w, a, m.nv, sid);
      encodeIndex(w, m.idx, m.ni, m.nv);
    }
    return w.out();
  }
  function encodeAttr(w, a, nv, sid) {
    const spec = ATTRS[a.name], arr = a.array, k = a.itemSize, type = typeOf(arr);
    if (!spec) throw new Error('unknown attribute ' + a.name);
    if (type !== spec.type || k !== spec.itemSize || !!a.normalized !== spec.normalized) throw new Error('attribute layout ' + a.name);
    if (arr.length !== nv * k) throw new Error('attribute length ' + a.name);
    w.vu(sid(a.name)); w.u8(k); w.u8(type); w.u8(a.normalized ? 1 : 0); w.u8(spec.codec);
    if (spec.codec === GRID) {
      const sc = Math.pow(2, spec.scaleLog2);
      w.vu(spec.scaleLog2);
      for (let c = 0; c < k; c++) {
        let prev = 0;
        for (let i = 0; i < nv; i++) {
          const v = arr[i * k + c], q = Math.round(v * sc);
          if (q / sc !== v || (v === 0 && 1 / v < 0)) throw new Error('not on the grid: ' + a.name + ' ' + v);
          w.vs(q - prev); prev = q;
        }
      }
    } else if (spec.codec === RLE) {
      let i = 0;
      while (i < nv) {
        let j = i + 1;
        for (; j < nv; j++) { let same = true; for (let c = 0; c < k; c++) if (arr[j * k + c] !== arr[i * k + c]) { same = false; break; } if (!same) break; }
        w.vu(j - i);
        for (let c = 0; c < k; c++) w.val(type, arr[i * k + c]);
        i = j;
      }
    } else throw new Error('codec');
  }
  const isQuad = (I, i, a) => I[i] === a && I[i + 1] === a + 1 && I[i + 2] === a + 2 && I[i + 3] === a && I[i + 4] === a + 2 && I[i + 5] === a + 3;
  function encodeIndex(w, I, ni, nv) {
    if (ni % 3) throw new Error('index count');
    let i = 0, fresh = 0;
    while (i < ni) {
      let q = 0;
      while (i + 6 <= ni && isQuad(I, i, fresh)) { q++; i += 6; fresh += 4; }
      if (q) { w.vu(q * 2); continue; }
      const start = i, f0 = fresh;
      let t = 0, f = fresh;
      do {
        for (let j = 0; j < 3; j++) { const v = I[i + j]; if (!(v < nv)) throw new Error('index range'); if (v + 1 > f) f = v + 1; }
        i += 3; t++;
      } while (i < ni && !(i + 6 <= ni && isQuad(I, i, f)));
      w.vu(t * 2 + 1);
      let g = f0;
      for (let j = start; j < i; j++) { const v = I[j]; w.vs(v - g); if (v + 1 > g) g = v + 1; }
      fresh = f;
    }
  }

  // skyline() のデータ（kind 5）: { size, groups: [{ key, sx, sz, boxes: [{ x, y, z, w, h, d, mat, o, lm? }] }] }。
  //   x..d は 1 cm 単位の整数で持てる（citygen の r2）ならその整数の差分、そうでない値が 1 つでもあれば f64 のまま（その欄だけ）
  const SKY_F = ['x', 'y', 'z', 'w', 'h', 'd'];
  function encodeSkyData(sky, sid) {
    const w = new Writer(1 << 20), all = [];
    for (const g of sky.groups) for (const b of g.boxes) all.push(b);
    w.vu(sky.size); w.vu(sky.groups.length);
    for (const g of sky.groups) { w.vu(g.sx); w.vu(g.sz); w.vu(g.boxes.length); if (g.key !== g.sx + '_' + g.sz) throw new Error('sky key'); }
    for (const b of all) {
      const keys = Object.keys(b).join(',');
      if (keys !== 'x,y,z,w,h,d,mat,o' && keys !== 'x,y,z,w,h,d,mat,o,lm') throw new Error('sky box fields ' + keys);
    }
    for (const f of SKY_F) {
      const cent = all.every((b) => Math.round(b[f] * 100) / 100 === b[f] && !(b[f] === 0 && 1 / b[f] < 0));
      w.u8(cent ? 0 : 1);
      let prev = 0;
      for (const b of all) { if (cent) { const q = Math.round(b[f] * 100); w.vs(q - prev); prev = q; } else w.f64(b[f]); }
    }
    let prev = 0;
    for (const b of all) { w.vs(b.o - prev); prev = b.o; }
    for (const b of all) w.vu(sid(b.mat));
    for (const b of all) w.vu(b.lm ? sid(b.lm) + 1 : 0);
    return w.out();
  }

  // ファイル全体。o: { magic: 'MRCF', fmt, gen（16 桁）, level, nsx, nsz, tiles: [[名前, u, v]], entries: [{ kind, a, b, part, meshes | raw | sky }] }、
  //   deflate(Uint8Array) → Uint8Array（tools/lib/fflate.js の deflateSync、level 9）
  function writeFile(o, deflate) {
    const strs = [], sidMap = new Map();
    const sid = (s) => { let i = sidMap.get(s); if (i === undefined) { i = strs.length; strs.push(s); sidMap.set(s, i); } return i; };
    for (const t of o.tiles || []) sid(t[0]);
    const blobs = [];
    for (const e of o.entries) {
      let raw;
      if (e.strings) for (const x of e.strings) sid(x); // 外で符号化した raw が使う文字列（テスト用）
      if (e.meshes) raw = encodeMeshes(e.meshes, sid);
      else if (e.sky) raw = encodeSkyData(e.sky, sid);
      else raw = e.raw;
      const comp = deflate ? deflate(raw) : raw;
      blobs.push({ e, raw, comp, check: fnv(raw) });
    }
    const h = new Writer(1 << 16);
    const m = o.magic || 'MRCF';
    for (let i = 0; i < 4; i++) h.u8(m.charCodeAt(i));
    h.u16(FORMAT); h.u16(deflate ? 1 : 0);
    const lenAt = h.n; h.u32(0);
    const key8 = (s) => { for (let i = 0; i < 8; i++) h.u8(s ? parseInt(s.substr(i * 2, 2), 16) : 0); };
    key8(o.fmt); key8(o.gen);
    h.str(o.level); h.u16(o.nsx); h.u16(o.nsz);
    h.u16(strs.length); for (const s of strs) h.str(s);
    h.u16((o.tiles || []).length); for (const t of o.tiles || []) { h.u16(sid(t[0])); h.f32(t[1]); h.f32(t[2]); }
    h.u32(blobs.length);
    let off = 0;
    for (const bl of blobs) {
      const e = bl.e;
      h.u8(e.kind); h.u16(e.a || 0); h.u16(e.b || 0); h.u8(e.part || 0); h.u32(bl.check); h.u32(off); h.u32(bl.comp.length); h.u32(bl.raw.length);
      off += bl.comp.length;
    }
    while (h.n % 4) h.u8(0);
    const total = h.n + off;
    const out = new Uint8Array(total);
    out.set(h.b.subarray(0, h.n));
    new DataView(out.buffer).setUint32(lenAt, total, true);
    let p = h.n;
    for (const bl of blobs) { out.set(bl.comp, p); p += bl.comp.length; }
    return out;
  }

  // ---------- 読む（ワーカーとメインスレッド）----------
  // 頭（中身の表まで）。長さ・魔法の言葉・版・表の範囲が合わなければ例外
  function parseHeader(u8) {
    let p = 0;
    const need = (k) => { if (p + k > u8.length) throw new Error('short header'); };
    const u8r = () => { need(1); return u8[p++]; };
    const u16 = () => { need(2); const v = u8[p] | (u8[p + 1] << 8); p += 2; return v; };
    const u32 = () => { need(4); const v = (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16)) + u8[p + 3] * 16777216; p += 4; return v; };
    const str = () => { const n = u8r(); need(n); const s = unutf8(u8.subarray(p, p + n)); p += n; return s; };
    const hexk = () => { need(8); let s = ''; for (let i = 0; i < 8; i++) s += u8[p + i].toString(16).padStart(2, '0'); p += 8; return s; };
    const magic = String.fromCharCode(u8r(), u8r(), u8r(), u8r());
    if (magic !== 'MRCF' && magic !== 'MRCP') throw new Error('magic');
    const format = u16(), flags = u16(), totalLen = u32();
    if (format !== FORMAT) throw new Error('format ' + format);
    if (totalLen !== u8.length) throw new Error('length ' + u8.length + ' != ' + totalLen);
    const fmt = hexk(), gen = hexk(), level = str(), nsx = u16(), nsz = u16();
    const ns = u16(), strings = [];
    for (let i = 0; i < ns; i++) strings.push(str());
    const nt = u16(), tiles = [];
    for (let i = 0; i < nt; i++) { const s = u16(); need(8); const dv = new DataView(u8.buffer, u8.byteOffset + p, 8); tiles.push([strings[s], dv.getFloat32(0, true), dv.getFloat32(4, true)]); p += 8; }
    const ne = u32(), entries = [];
    for (let i = 0; i < ne; i++) entries.push({ kind: u8r(), a: u16(), b: u16(), part: u8r(), check: u32(), off: u32(), comp: u32(), raw: u32() });
    while (p % 4) p++;
    const body = p;
    for (const e of entries) {
      if (body + e.off + e.comp > u8.length) throw new Error('entry range');
      if (e.raw > MAX_RAW || (!(flags & 1) && e.raw !== e.comp)) throw new Error('entry size');
    }
    return { magic, format, flags, totalLen, fmt, gen, level, nsx, nsz, strings, tiles, entries, body };
  }
  const entryKey = (kind, a, b) => kind + ':' + a + '_' + b;
  function entryBytes(u8, hdr, e) {
    const comp = u8.subarray(hdr.body + e.off, hdr.body + e.off + e.comp);
    const raw = (hdr.flags & 1) ? inflate(comp, e.raw) : comp.slice();
    if (fnv(raw) !== e.check) throw new Error('check');
    return raw;
  }

  // メッシュの並びを復元 → [{ name, attrs: [{ name, itemSize, normalized, array }], idx, nv, ni, segs, bounds: { box, sphere }, segBox }]。
  //   tileFix: { 材質名: [u の倍率, v の倍率] }（端末の tile が作ったときと違う: uv を掛け直す）。おかしな所があれば例外（= 使わずに作る）
  function decodeMeshes(raw, strings, tileFix) {
    const it = decodeMeshesGen(raw, strings, tileFix, Infinity);
    let r;
    do { r = it.next(); } while (!r.done);
    return r.value;
  }
  // 同じ（ジェネレーター）: 頂点が stepVerts より多いメッシュは属性・インデックス・境界ごとに yield 'decode'（ワーカーが無いときの
  //   メインスレッドの復元。1 歩を短く）
  function* decodeMeshesGen(raw, strings, tileFix, stepVerts) {
    let p = 0;
    const n = raw.length;
    const vu = () => { let v = 0, m = 1, c; do { if (p >= n) throw new Error('short'); c = raw[p++]; v += (c & 127) * m; m *= 128; if (m > 9007199254740992) throw new Error('varint'); } while (c & 128); return v; };
    const vs = () => { const v = vu(); return v % 2 ? -(v + 1) / 2 : v / 2; };
    const str = (i) => { if (i >= strings.length) throw new Error('string id'); return strings[i]; };
    const out = [], nm = vu();
    for (let mi = 0; mi < nm; mi++) {
      const name = str(vu()), nv = vu(), ni = vu();
      if (nv > 16777216 || ni > 50331648) throw new Error('size');
      const nseg = vu(), segs = nseg ? [] : null;
      for (let s = 0; s < nseg; s++) {
        const sg = [str(vu()), vu(), vu(), vu(), vu()];
        if (sg[1] + sg[2] > nv || sg[3] + sg[4] > ni) throw new Error('segment');
        segs.push(sg);
      }
      if (p >= n) throw new Error('short');
      const na = raw[p++], attrs = [];
      for (let ai = 0; ai < na; ai++) {
        const aname = str(vu());
        if (p + 4 > n) throw new Error('short');
        const k = raw[p++], type = raw[p++], normalized = raw[p++] === 1, codec = raw[p++];
        if (!(type < TYPED.length) || !(k >= 1 && k <= 4)) throw new Error('codec');
        const arr = new TYPED[type](nv * k);
        if (codec === GRID) {
          const sl = vu();
          if (sl > 16) throw new Error('codec');
          const inv = 1 / Math.pow(2, sl);
          for (let c = 0; c < k; c++) {
            let q = 0;
            for (let i = 0; i < nv; i++) {
              // vs() をその場で（頂点が多いので関数呼び出しを省く）
              let v = 0, m = 1, b;
              do { if (p >= n) throw new Error('short'); b = raw[p++]; v += (b & 127) * m; m *= 128; } while (b & 128);
              q += v % 2 ? -(v + 1) / 2 : v / 2;
              arr[i * k + c] = q * inv;
            }
          }
        } else if (codec === RLE) {
          const sz = SIZE[type];
          let i = 0;
          while (i < nv) {
            const cnt = vu();
            if (!cnt || i + cnt > nv || p + k * sz > n) throw new Error('rle');
            const vals = [];
            for (let c = 0; c < k; c++) {
              let v;
              if (type === 1) { v = raw[p]; if (v > 127) v -= 256; } else if (type === 2) v = raw[p];
              else if (type === 3) { v = raw[p] | (raw[p + 1] << 8); if (v > 32767) v -= 65536; } else if (type === 4) v = raw[p] | (raw[p + 1] << 8);
              else v = new DataView(raw.buffer, raw.byteOffset + p, 4).getFloat32(0, true);
              p += sz; vals.push(v);
            }
            for (let j = 0; j < cnt; j++, i++) for (let c = 0; c < k; c++) arr[i * k + c] = vals[c];
          }
        } else if (codec === DELTA) {
          for (let c = 0; c < k; c++) { let q = 0; for (let i = 0; i < nv; i++) { q += vs(); arr[i * k + c] = q; } }
        } else if (codec === RAW) {
          const bytes = nv * k * SIZE[type];
          if (p + bytes > n) throw new Error('short');
          new Uint8Array(arr.buffer).set(raw.subarray(p, p + bytes)); p += bytes;
        } else throw new Error('codec ' + codec);
        attrs.push({ name: aname, itemSize: k, normalized, array: arr });
        if (nv > stepVerts) yield 'decode';
      }
      const I = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
      let i = 0, fresh = 0;
      while (i < ni) {
        const r = vu();
        if (r % 2 === 0) {
          let q = r / 2;
          if (!q || i + q * 6 > ni || fresh + q * 4 > nv) throw new Error('index');
          for (; q > 0; q--) { I[i] = fresh; I[i + 1] = fresh + 1; I[i + 2] = fresh + 2; I[i + 3] = fresh; I[i + 4] = fresh + 2; I[i + 5] = fresh + 3; i += 6; fresh += 4; }
        } else {
          let c = (r - 1) / 2 * 3;
          if (!c || i + c > ni) throw new Error('index');
          for (; c > 0; c--) { const v = fresh + vs(); if (!(v >= 0 && v < nv)) throw new Error('index range'); I[i++] = v; if (v + 1 > fresh) fresh = v + 1; }
        }
      }
      if (nv > stepVerts) yield 'decode';
      const fix = tileFix && tileFix[name.split('@')[0]];
      if (fix) for (const a of attrs) if (a.name === 'uv') for (let j = 0; j < a.array.length; j += 2) { a.array[j] *= fix[0]; a.array[j + 1] *= fix[1]; }
      const pos = attrs.find((a) => a.name === 'position');
      const m = { name, attrs, idx: I, nv, ni, segs, bounds: pos ? bounds(pos.array, nv) : null, segBox: pos && segs ? partBoxes(pos.array, segs) : null };
      out.push(m);
    }
    if (p !== n) throw new Error('trailing bytes');
    return out;
  }
  // three r128 の computeBoundingBox / computeBoundingSphere と同じ計算（同じ順番の倍精度の演算 = 同じ値）
  function bounds(pos, nv) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
      if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    let cx = 0, cy = 0, cz = 0;
    if (!(x1 < x0 || y1 < y0 || z1 < z0)) { cx = (x0 + x1) * 0.5; cy = (y0 + y1) * 0.5; cz = (z0 + z1) * 0.5; }
    let r2 = 0;
    for (let i = 0; i < nv; i++) { const dx = cx - pos[i * 3], dy = cy - pos[i * 3 + 1], dz = cz - pos[i * 3 + 2]; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
    return { box: [x0, y0, z0, x1, y1, z1], sphere: [cx, cy, cz, Math.sqrt(r2)] };
  }
  // world.js の CityGeo.partBoxes と同じ（ワーカーには world.js が無いので写し。--check が同じ値か確かめる）
  function partBoxes(pos, segs) {
    const n = segs.length + 1, out = new Array(n * 7);
    for (let k = 0; k < n; k++) {
      const a = k === 0 ? 0 : segs[k - 1][1], b = k === 0 ? segs[0][1] : segs[k - 1][1] + segs[k - 1][2];
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = a; i < b; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
        if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
      let r2 = 0;
      const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5, cz = (z0 + z1) * 0.5;
      for (let i = a; i < b; i++) { const dx = cx - pos[i * 3], dy = cy - pos[i * 3 + 1], dz = cz - pos[i * 3 + 2]; r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
      const o = k * 7;
      out[o] = x0; out[o + 1] = y0; out[o + 2] = z0; out[o + 3] = x1; out[o + 4] = y1; out[o + 5] = z1; out[o + 6] = Math.sqrt(r2);
    }
    return out;
  }
  function decodeSkyData(raw, strings) {
    let p = 0;
    const n = raw.length;
    const vu = () => { let v = 0, m = 1, c; do { if (p >= n) throw new Error('short'); c = raw[p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
    const vs = () => { const v = vu(); return v % 2 ? -(v + 1) / 2 : v / 2; };
    const size = vu(), ng = vu(), groups = [], all = [];
    for (let i = 0; i < ng; i++) { const sx = vu(), sz = vu(), nb = vu(); groups.push({ key: sx + '_' + sz, sx, sz, boxes: new Array(nb) }); for (let j = 0; j < nb; j++) all.push([i, j]); }
    const N = all.length, cols = [];
    for (let fi = 0; fi < SKY_F.length; fi++) {
      if (p >= n) throw new Error('short');
      const mode = raw[p++], col = new Float64Array(N);
      if (mode === 0) { let q = 0; for (let i = 0; i < N; i++) { q += vs(); col[i] = q / 100; } }
      else { if (p + N * 8 > n) throw new Error('short'); const dv = new DataView(raw.buffer, raw.byteOffset + p, N * 8); for (let i = 0; i < N; i++) col[i] = dv.getFloat64(i * 8, true); p += N * 8; }
      cols.push(col);
    }
    const o = new Float64Array(N);
    let q = 0;
    for (let i = 0; i < N; i++) { q += vs(); o[i] = q; }
    const mats = new Array(N), lms = new Array(N);
    for (let i = 0; i < N; i++) mats[i] = strings[vu()];
    for (let i = 0; i < N; i++) { const v = vu(); lms[i] = v ? strings[v - 1] : null; }
    if (p !== n) throw new Error('trailing bytes');
    return { size, groups, N, cols, o, mats, lms, all };
  }
  // decodeSkyData の結果 → citygen の skyline() と同じ形のオブジェクト（メインスレッドで。キーの順番も同じ）
  function buildSkyObjects(d) {
    const X = d.cols[0], Y = d.cols[1], Z = d.cols[2], Wd = d.cols[3], Hh = d.cols[4], D = d.cols[5];
    for (let i = 0; i < d.N; i++) {
      const s = { x: X[i], y: Y[i], z: Z[i], w: Wd[i], h: Hh[i], d: D[i], mat: d.mats[i], o: d.o[i] };
      if (d.lms[i]) s.lm = d.lms[i];
      const a = d.all[i];
      d.groups[a[0]].boxes[a[1]] = s;
    }
    return { size: d.size, groups: d.groups };
  }
  // 中身 1 つを復元（ワーカーとメインスレッドで同じ）。戻り値: { kind, a, b, meshes } / { tops } / { sky }
  function decodeEntry(u8, hdr, e, tileFix) {
    const raw = entryBytes(u8, hdr, e);
    if (e.kind === 4) { if (raw.length % 4) throw new Error('tops'); return { kind: 4, tops: new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice() }; }
    if (e.kind === 5) { const d = decodeSkyData(raw, hdr.strings); delete d.all; return { kind: 5, sky: d }; } // all は作り直す（下の skyAll）
    if (e.kind === 1 || e.kind === 2) return { kind: e.kind, a: e.a, b: e.b, meshes: decodeMeshes(raw, hdr.strings, tileFix) };
    throw new Error('kind ' + e.kind);
  }
  function skyAll(d) { const all = []; d.groups.forEach((g, i) => { for (let j = 0; j < g.boxes.length; j++) all.push([i, j]); }); d.all = all; return d; }
  // 送るときに移す（transfer）配列
  function transferables(res, list) {
    if (res.meshes) for (const m of res.meshes) { for (const a of m.attrs) list.push(a.array.buffer); list.push(m.idx.buffer); }
    if (res.tops) list.push(res.tops.buffer);
    if (res.sky) { for (const c of res.sky.cols) list.push(c.buffer); list.push(res.sky.o.buffer); }
    return list;
  }

  const Codec = { FORMAT, ATTRS, ENCODER_SIG, KIND, hash64, fnv, sha256, writeFile, parseHeader, decodeEntry, decodeMeshes, decodeMeshesGen, encodeMeshes, encodeSkyData, decodeSkyData, buildSkyObjects, skyAll, bounds, partBoxes, entryKey, inflate };

  // ---------- ワーカー ----------
  //   far.bin のバイト列はメインスレッドだけが持つ（起動時の prime はメインスレッドで復元する。2 つ持たない）。ワーカーには open で
  //   文字列の表だけ、decode で中身ごとの縮めたバイト列（写し・transfer）を送る
  if (IN_WORKER) {
    try { importScripts(new URL('../lib/fflate-inflate.min.js', self.location.href).href); } catch (e) { /* inflate が無ければ ping が inflate: false */ }
    const files = new Map(); // 名前 → { strings, flags }
    self.onmessage = (ev) => {
      const m = ev.data || {};
      const reply = (o, tr) => { o.id = m.id; self.postMessage(o, tr || []); };
      try {
        if (m.op === 'ping') reply({ ok: true, inflate: !!(self.fflate && self.fflate.inflateSync) });
        else if (m.op === 'open') {
          if (!Array.isArray(m.strings)) throw new Error('strings');
          files.set(m.file, { strings: m.strings, flags: m.flags | 0 });
          reply({ ok: true });
        } else if (m.op === 'decode') {
          const f = files.get(m.file);
          if (!f) { reply({ ok: false, error: 'no file' }); return; }
          const results = [], tr = [], hdr = { body: 0, flags: f.flags, strings: f.strings };
          for (const it of m.items) {
            if (!it) { results.push(null); continue; }
            const e = { kind: it.kind, a: it.a, b: it.b, check: it.check, raw: it.raw, off: 0, comp: it.comp.length };
            if (e.raw > MAX_RAW) throw new Error('entry size');
            const r = decodeEntry(it.comp, hdr, e, m.tileFix || null);
            results.push(r); transferables(r, tr);
          }
          reply({ ok: true, results }, tr);
        } else if (m.op === 'close') { files.delete(m.file); reply({ ok: true }); }
        else if (m.op === 'clear') { files.clear(); reply({ ok: true }); }
      } catch (e) { reply({ ok: false, error: String((e && e.message) || e) }); }
    };
    return;
  }

  // ---------- メインスレッド: MR.CityBake ----------
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const pref = {
    get(k) { try { return root.localStorage ? root.localStorage.getItem('mirrsona.' + k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (root.localStorage) root.localStorage.setItem('mirrsona.' + k, v); } catch (e) { /* 保存できなくても続ける */ } }
  };
  const urlOff = () => { try { return /[?&]bake=0\b/.test((root.location && root.location.search) || ''); } catch (e) { return false; } };

  MR.CityBake = class CityBake {
    static get FORMAT() { return FORMAT; }
    static get ENCODER_SIG() { return ENCODER_SIG; }
    static get Codec() { return Codec; }
    static get IN_WORKER() { return IN_WORKER; }
    // 形を書く world.js のメソッド（鍵の meshSig に入る。tools/bake-city.js --selftest の T-list がこの一覧から外れた呼び出しを探す）
    static get MESH_METHODS() { return ['buildFull', '_fullBox', '_fullRamp', '_rampUnderside', '_ladder', '_decal', '_lanes', '_track3', '_billboard', '_farBox', 'buildLod', '_lodOut', 'buildSkyline', '_skyMesh', '_fullPrism', '_farPrism']; }
    static get STATIC_METHODS() { return ['wall', 'lin', 'farStyles', 'treeBlob', 'laneGaps', 'cutSegments', 'cutMesh', 'side', 'sortedSides', 'convexFan', 'prismWalls', 'prismCap', '_wetSplit']; }
    // far.bin の復元結果を形にする world.js のメソッド（鍵の readSig に入る。--selftest の T-list が、復元を読むのにここに無いメソッドを探す）
    static get READER_METHODS() { return ['lodJob', '_lodBaked', 'skylineMeshes']; }
    static get READER_STATIC() { return ['bakedGeometry']; }
    // このファイルのコード全部（符号化・復元・ワーカー・端末の扱い）。ファイルを読まない（preview.html・Node でも同じ文字列）
    static moduleSource() { return citybakeModule.toString(); }
    // render.city.bake の既定値（game.json に無いキー）
    static get DEFAULTS() {
      return {
        enabled: true,        // 使う（false = いつもその場で作る）
        download: true,       // サイトから far.bin をダウンロードする（設定の「街のデータをダウンロード」がオフなら使わない・落とさない）
        packs: false,         // 近景のチャンクのパック（M3。まだ無い）
        worker: true,         // ワーカーで復元する（false / 作れない = メインスレッドで少しずつ）
        workerTimeoutMs: 4000, // ワーカーの最初の返事を待つ ms（来なければメインスレッド）
        workerCallTimeoutMs: 10000, // その後の 1 回の返事（開く・復元）を待つ ms。来なければワーカーを止めてメインスレッドで
        storageTimeoutMs: 15000, // 端末の保存・読み込み 1 回を待つ ms（IndexedDB の書き込みが終わらない等）。過ぎたら失敗として続ける
        startWaitMs: 2000,    // 街を始める前に、起動時に始めた far.bin の確認・スカイラインの復元を待つ上限（main.js の whenSky）
        waitFrames: 6,        // LOD の区画の復元を待つフレーム数（その間は次の仕事へ。waitFrames と waitMs の両方が過ぎたらその場で作る）
        waitMs: 100,          //   と ms
        stepVerts: 8192,      // ワーカーが無いとき（メインスレッドの復元）: 頂点がこれより多いメッシュは属性ごとに 1 歩
        pauseAboveSpeed: 60,  // ゲーム中: この速さ（m/s）より速く動いている間は保存（端末への書き込み）を待つ
        playGapMs: 1500,      // ゲーム中の保存の間隔（落ち着いてから）
        calmFrameMs: 22,      // ゲーム中: 1 フレームの平均がこれより長い間は保存を待つ
        calmMaxWaitMs: 60000, // 待つのはここまで（その後はすぐ書く）
        prefetchLod: true,    // LOD の区画の復元を前もって始める（streamer: lodIn + prefetchMargin m に入ったら）
        prefetchMargin: 150,  //   m
        readyMax: 16,         // 復元して受け取りを待っている区画の上限（古いものから捨てる。1 つ平均 0.2 MB）
        fetchMax: 2           // 1 セッションに far.bin を取りに行く回数の上限（取り直しは 1 回まで。設定のオン・「街のデータを削除」で数え直す）
      };
    }
    // render の設定（render.city.bake と、タッチ端末は render.city.mobile.bake）→ 使う値
    static config(rs) {
      const city = (rs && rs.city) || {};
      const touch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || ('ontouchstart' in root);
      return Object.assign({}, CityBake.DEFAULTS, city.bake || {}, touch && city.mobile && city.mobile.bake ? city.mobile.bake : {});
    }
    static hash64(s) { return hash64(s); }
    static sha256(u8) { return sha256(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)); }
    static async sha256Async(buf) {
      const c = root.crypto;
      if (c && c.subtle && typeof c.subtle.digest === 'function') {
        try { const d = await c.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { /* 下へ */ }
      }
      return sha256(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
    }
    // 鍵の材料（文字列）。meshSig: 形を書くコード、readSig: 読むコード、matSig: 材質の定義
    static meshSig() {
      const W = MR.CityWorld, G = MR.CityGeo;
      let s = G.toString();
      for (const m of CityBake.MESH_METHODS) { const f = W.prototype[m]; s += '\n' + (f ? f.toString() : 'missing:' + m); }
      for (const m of CityBake.STATIC_METHODS) { const f = W[m]; s += '\n' + (f ? f.toString() : 'missing:' + m); }
      return s + '\n' + MR.srgb.toString() + '\n' + ENCODER_SIG;
    }
    // 読むコード: このファイル全部 + world.js の READER_METHODS / READER_STATIC
    static readSig() {
      const W = MR.CityWorld;
      let s = CityBake.moduleSource();
      for (const m of CityBake.READER_METHODS) { const f = W.prototype[m]; s += '\n' + (f ? f.toString() : 'missing:' + m); }
      for (const m of CityBake.READER_STATIC) { const f = W[m]; s += '\n' + (f ? f.toString() : 'missing:' + m); }
      return s;
    }
    static matSig() {
      const D = (MR.Materials && MR.Materials.DEFS) || {};
      return Object.keys(D).sort().map((k) => k + ':' + JSON.stringify(D[k].tile === undefined ? null : D[k].tile) + '/' + JSON.stringify(D[k].procTile === undefined ? null : D[k].procTile)).join(';');
    }
    // { fmt, gen, key: 'fmt.gen', ms }（同期。数 ms）
    static keys(level) {
      const t0 = now();
      const fmt = hash64('MRC' + FORMAT + CityBake.meshSig() + CityBake.readSig() + CityBake.matSig());
      const gen = hash64(MR.CityGen.moduleSource() + JSON.stringify(level));
      return { fmt, gen, key: fmt + '.' + gen, ms: now() - t0 };
    }

    // レベルごとに 1 つ（「もう一度」・オンラインでも同じもの）。opts: { levelId, level, storage, assets（_fetchBuffer と server を使う）, cfg }
    static get(opts) {
      const reg = CityBake._reg || (CityBake._reg = {});
      let b = reg[opts.levelId];
      if (!b) b = reg[opts.levelId] = new CityBake(opts);
      return b;
    }
    static instances() { const reg = CityBake._reg || {}; return Object.keys(reg).map((k) => reg[k]); }

    constructor(opts) {
      this.levelId = opts.levelId;
      this.level = opts.level;
      this.storage = opts.storage || null;
      this.assets = opts.assets || null;
      this.server = (opts.server != null ? opts.server : (opts.assets && opts.assets.server)) || '';
      this.cfg = Object.assign({}, CityBake.DEFAULTS, opts.cfg || {});
      this.dir = 'CACHE';
      this.keys = null;
      this.far = null;       // { name, size, keys: Set（'kind:a_b'）, tiles, u8（メインスレッドのときだけ）, hdr（同）, worker: bool }
      this.tops = null;      // Float32Array（kind 4）
      this.sky = null;       // Map 'sx_sz' → メッシュ（kind 2。頂点の配列は共有、インデックスは lm セグメントがあれば使うたびに写す）
      this.skyData = null;   // skyline() と同じ形（kind 5）
      this._ready = new Map();   // 'kind:a_b' → 復元したメッシュ（LOD。受け取ったら消す）
      this._inflight = new Map(); // 'kind:a_b' → 'pending'
      this._worker = null; this._workerState = 'none'; // none | starting | ok | failed
      this._wq = new Map(); this._wid = 0;
      this._epoch = 0;       // clear() のたびに増える（古いダウンロード・返事を捨てる）
      this._listeners = [];
      this._play = { speed: 0, ema: 16, t: 0 };
      // 街のワールドの数（CityWorld が作るとき acquire・dispose で release）と、街ではないゲーム（アリーナ）の最中（trim）。
      //   どちらかの間に far.bin が開いたら（ダウンロードがゲームの途中で終わった）、スカイライン・chunkTops・skyline() は復元しない:
      //   そのゲームはもう自分で作った物を使っていて、復元しても使わずに持つだけ（+13 MB）。次に街を始めるとき（whenSky）に復元する
      this._users = 0; this._hold = false;
      this.user = pref.get('cityBake') !== 'off';
      this.noStore = false;
      this.tileOf = null;    // (材質) → 端末の tile（M3 の近景のパック用。far.bin は使わない）
      // このセッションで使えないと分かった far.bin の名前（SHA256 は合うのに復元できなかった。消さない・取り直さない・また開かない）と、
      //   far.bin を取りに行った回数（fetchMax まで）
      this._unusable = new Set();
      this._fetches = 0;
      this.stats = {
        fmt: '', gen: '', build: '', far: false, farName: '', farBytes: 0, state: 'idle', got: 0, total: 0, dir: this.dir, worker: 'none',
        hits: 0, miss: { noPack: 0, loading: 0, fmt: 0, gen: 0, hash: 0, mat: 0, codec: 0, error: 0 }, decodeMs: 0, decodeMax: 0,
        prepareMs: 0, keyMs: 0, downloads: 0, downloadedBytes: 0, fetches: 0, stored: false, online: null, lastError: '',
        workerFail: 0, unusable: 0, retired: 0, fetchCapped: 0
      };
    }

    // 使えるか（設定・URL・game.json）
    get usable() { return !!(this.cfg.enabled !== false && this.user && !urlOff()); }
    get ready() { return !!this.far; }
    onStatus(fn) { this._listeners.push(fn); return () => { const i = this._listeners.indexOf(fn); if (i >= 0) this._listeners.splice(i, 1); }; }
    _emit(state, extra) {
      if (state) this.stats.state = state;
      if (extra) Object.assign(this.stats, extra);
      for (const fn of this._listeners.slice()) { try { fn(this.stats, this); } catch (e) { /* 表示の失敗は無視 */ } }
    }
    // 開始画面の 1 行（無ければ ''）
    statusText() {
      const st = this.stats, fmt = (n) => (n / 1048576).toFixed(1);
      if (!this.usable) return '';
      if (this.far) return '街のデータ ✓';
      if (st.state === 'downloading') return '街のデータ ' + fmt(st.got) + ' / ' + fmt(st.total || st.got) + ' MB';
      if (st.state === 'checking') return '街のデータを確認中';
      return '';
    }
    // 設定の画面の 1 行
    infoText() {
      const st = this.stats, mb = (n) => (n / 1048576).toFixed(1) + ' MB';
      if (!this.user) return 'オフ（街はその場で作ります）';
      if (this.cfg.enabled === false || urlOff()) return '使わない設定です';
      if (this.far) return '端末にあります（' + mb(st.farBytes) + (this.noStore ? '・このときだけ' : '') + '）';
      if (st.state === 'downloading') return 'ダウンロード中 ' + mb(st.got) + ' / ' + mb(st.total || st.got);
      if (st.state === 'offline') return 'サーバーにつながりません（街はその場で作ります）';
      if (st.state === 'none') return 'この版の街のデータはまだありません';
      if (st.state === 'unusable') return 'この端末では使えませんでした（街はその場で作ります）';
      if (st.state === 'error') return '失敗しました（次の起動でもう一度）';
      return 'まだありません';
    }
    // DEBUG の行
    debugLine() {
      const st = this.stats, m = st.miss, tot = st.hits + m.noPack + m.loading + m.fmt + m.gen + m.hash + m.mat + m.codec + m.error;
      const k = this.keys ? this.keys.fmt.slice(0, 8) + '.' + this.keys.gen.slice(0, 4) : '-';
      return 'bake ' + k + ' far' + (this.far ? '✓' : '✗') + ' hit ' + (tot ? Math.round(st.hits * 100 / tot) : 0) + '% miss load ' + m.loading +
        ' none ' + m.noPack + ' hash ' + m.hash + ' mat ' + m.mat + ' fmt ' + m.fmt + ' err ' + (m.error + m.codec) + ' dir ' + (this.noStore ? 'mem' : st.dir) +
        ' worker' + (this._workerState === 'ok' ? '✓' : (this._workerState === 'failed' || this._workerState === 'none' ? '✗' : '…')) + (this.usable ? '' : ' off');
    }

    // ---------- 起動時 ----------
    // 端末の far.bin を開き、スカイライン・chunkTops・skyline() のデータを先に復元しておく（ネットは待たない）
    prepare() {
      if (this._prep) return this._prep;
      this._prep = this._prepare().catch((e) => { console.warn('[CityBake] prepare', e); this.stats.lastError = String((e && e.message) || e); });
      return this._prep;
    }
    async _prepare() {
      const t0 = now();
      if (!this.keys) { this.keys = CityBake.keys(this.level); this.stats.fmt = this.keys.fmt; this.stats.gen = this.keys.gen; this.stats.keyMs = this.keys.ms; }
      if (!this.usable) { this._emit('off'); return; }
      if (this.far) return;
      const S = this.storage, o = { dir: this.dir };
      if (!S || typeof S.list !== 'function') return;
      const dir = this._fmtDir();
      let names = [];
      try { names = await this._st(S.list(dir, o)); } catch (e) { names = []; }
      for (const n of names) if (/\.part$/.test(n)) { try { await this._st(S.remove(dir + n, o)); } catch (e) { /* 次の起動で */ } }
      const fars = names.filter((n) => FAR_NAME.test(n));
      // 端末の index.json の写し（最後にネットで読んだ index）。あれば、そこにこの鍵の名前が書いてあるファイルだけを開き、ほかの far.bin は消す
      //   （サイトが入れ替えた・取り消したファイルを使わない）。無い・壊れている写し（まだ index を読んだことが無い）→ list の結果をどれでも
      let idx = null;
      try {
        const t = await this._st(S.readText('city/' + this.levelId + '/index.json', o));
        const j = t ? JSON.parse(t) : null;
        if (j && j.v === 1 && Array.isArray(j.builds)) idx = j;
      } catch (e) { idx = null; }
      let order = fars;
      if (idx) {
        const b = this._buildOf(idx);
        order = b && fars.indexOf(b.far.f) >= 0 ? [b.far.f] : [];
        for (const n of fars) {
          if (order.indexOf(n) >= 0) continue;
          this.stats.unlisted = (this.stats.unlisted || 0) + 1;
          try { await this._st(S.remove(dir + n, o)); } catch (e) { /* 次の起動で */ }
        }
      }
      for (const n of order) {
        if (this.far) break;
        let buf = null;
        try { buf = await this._st(S.readBinary(dir + n, o)); } catch (e) { buf = null; }
        if (!buf) continue;
        const r = await this._open(new Uint8Array(buf), n, true, false);
        if (r === 'bad') { try { await this._st(S.remove(dir + n, o)); } catch (e) { /* 無視 */ } }
      }
      this.stats.prepareMs = now() - t0;
      this._emit(this.far ? 'ready' : 'idle');
    }
    _fmtDir() { return 'city/' + this.levelId + '/' + this.keys.fmt + '/'; }
    // index.json の中のこの鍵（fmt・gen）のビルド（far の名前・大きさ・SHA256 がそろっているもの）| null
    _buildOf(idx) {
      const K = this.keys;
      return (idx && Array.isArray(idx.builds) && idx.builds.find((b) => b && b.fmt === K.fmt && b.gen === K.gen && b.far && FAR_NAME.test(b.far.f) && b.far.size > 0 && /^[0-9a-f]{64}$/.test(b.far.sha256))) || null;
    }
    // 端末の保存・読み込み 1 回（storageTimeoutMs を過ぎたら失敗。IndexedDB の書き込みのトランザクションが終わらない等で止まらない）
    _st(p) {
      const ms = this.cfg.storageTimeoutMs > 0 ? this.cfg.storageTimeoutMs : 15000;
      let t = null;
      return Promise.race([Promise.resolve(p), new Promise((res, rej) => { t = setTimeout(() => rej(new Error('storage timeout')), ms); })])
        .then((v) => { clearTimeout(t); return v; }, (e) => { clearTimeout(t); throw e; });
    }

    // far.bin のバイト列を開く: 頭を確かめ（長さ・版・鍵・名前の SHA256）、ワーカーに文字列の表を渡し、スカイライン・chunkTops・skyline() を
    //   復元しておく（街のゲームの最中なら復元しない = 次に街を始めるとき）。verified: SHA256 を確かめたばかり（ダウンロード）。
    //   戻り値 'ok' | 'gen'（この citygen / world.js 用ではない）| 'bad'（端末で壊れた = 名前の SHA256 と合わない。消してよい）|
    //   'fail'（SHA256 は合うのに読めない・復元できない。消さない・取り直さない = 同じバイトが来るだけ。このセッションは使わない）|
    //   'later'（clear() された等。消さない）
    async _open(u8, name, stored, verified) {
      if (this._unusable.has(name)) return 'fail';
      const ep = this._epoch, t0 = now();
      // 端末のファイルは名前（far.<SHA256 の頭 16 桁>.bin）と中身が合うか（頭の表・文字列も含めて全部。中身ごとの FNV は縮めた後の中身しか見ない）。
      //   頭より先に見る: 端末で壊れた頭（鍵のバイト）を「ほかの鍵のファイル」と取り違えて残さない
      if (!verified) {
        const m = FAR_NAME.exec(name);
        let sha = '';
        try { sha = await CityBake.sha256Async(u8); } catch (e) { sha = ''; }
        if (ep !== this._epoch) return 'later';
        if (!m || sha.slice(0, 16) !== m[1]) {
          this.stats.miss.error++; this.stats.badStored = (this.stats.badStored || 0) + 1; this.stats.lastError = 'far.bin の SHA256 が名前と合いません';
          console.warn('[CityBake] 端末の far.bin が壊れています（消して取り直します）:', name);
          return 'bad';
        }
      }
      let hdr = null;
      try { hdr = parseHeader(u8); } catch (e) { hdr = null; }
      if (!hdr || hdr.magic !== 'MRCF' || hdr.level !== this.levelId) return this._fail(name, hdr ? 'far.bin の頭が違います（' + hdr.magic + ' ' + hdr.level + '）' : 'far.bin の頭が読めません');
      if (hdr.fmt !== this.keys.fmt) { this.stats.miss.fmt++; return 'gen'; } // ほかの鍵のファイル（消さない。片付けは index を読んだとき）
      if (hdr.gen !== this.keys.gen) { this.stats.miss.gen++; return 'gen'; }
      const keys = new Set(hdr.entries.map((e) => entryKey(e.kind, e.a, e.b)));
      const far = { name, size: u8.length, keys, tiles: hdr.tiles, u8, hdr, worker: false, stored: !!stored, skyLater: false };
      if (this.cfg.worker !== false && await this._startWorker()) {
        let r = null;
        try { r = await this._call({ op: 'open', file: name, strings: hdr.strings, flags: hdr.flags }); } catch (e) { r = null; }
        if (ep !== this._epoch) return 'later';
        far.worker = !!(r && r.ok && this._worker); // ワーカーが落ちた・止まった: メインスレッドだけで
      }
      // スカイライン・chunkTops・skyline()（起動時に同期で要る）。街のゲームの最中は復元しない（そのゲームは使わない）
      if (this._users > 0 || this._hold) far.skyLater = true;
      else {
        const res = await this._decodeFar(far, ep);
        if (ep !== this._epoch) return 'later';
        if (!res) { this._dropFar(far); return this._fail(name, this.stats.lastError || 'sky'); }
      }
      this.far = far;
      this.stats.far = true; this.stats.farName = name; this.stats.farBytes = far.size; this.stats.stored = !!stored;
      this.stats.openMs = now() - t0;
      return 'ok';
    }
    // スカイライン（kind 2）・chunkTops（4）・skyline() のデータ（5）を復元して持つ。失敗 → null。
    //   出来上がったときに街のワールドがある（その間に街が始まった）なら持たない（そのワールドは自分で作った物を使っている）
    async _decodeFar(far, ep) {
      const want = [];
      for (const k of far.keys) if (/^[245]:/.test(k)) want.push(k);
      let res;
      try { res = await this._decode(far, want); } catch (e) { this.stats.lastError = String((e && e.message) || e); return null; }
      if (ep !== this._epoch || far.dropped) return null; // その間に使うのをやめた（index が入れ替えた・壊れていた）
      if (this._users > 0 || this._hold) { far.skyLater = true; this.stats.skyDropped = (this.stats.skyDropped || 0) + 1; return res; }
      const sky = new Map();
      for (const r of res) {
        if (!r) continue;
        if (r.kind === 4) this.tops = r.tops;
        else if (r.kind === 5) this.skyData = buildSkyObjects(skyAll(r.sky));
        else if (r.kind === 2) sky.set(r.a + '_' + r.b, r.meshes);
      }
      this.sky = sky;
      far.skyLater = false;
      return res;
    }
    _dropFar(far) {
      if (!far) return;
      far.dropped = true;
      if (far.worker && this._worker) this._call({ op: 'close', file: far.name }).catch(() => {});
      if (this.far === far) { this.far = null; this.stats.far = false; }
    }
    // SHA256 は合う（サイトから来たままの）ファイルが使えない: このセッションはもう開かない・取りに行かない。消さない（取り直しても同じバイト。
    //   端末のメモリ不足など一時的なら次の起動でまた使える。サイトが別のファイルにすれば次に index を読んだときに入れ替わる）→ 'fail'
    _fail(name, why) {
      this._unusable.add(name);
      this.stats.unusable = this._unusable.size;
      this.stats.miss.error++;
      this.stats.lastError = String(why || 'decode');
      console.warn('[CityBake] far.bin を使えません（このときはその場で作ります。消さず・取り直しません）:', name, this.stats.lastError);
      return 'fail';
    }

    // ---------- ワーカー ----------
    _startWorker() {
      if (this._workerState === 'ok') return Promise.resolve(!!this._worker);
      if (this._workerState === 'failed') return Promise.resolve(false);
      if (this._wstart) return this._wstart;
      this._wstart = new Promise((resolve) => {
        if (!SCRIPT_SRC || typeof Worker === 'undefined') { this._workerState = 'failed'; this.stats.worker = 'none'; resolve(false); return; }
        let w;
        try { w = new Worker(SCRIPT_SRC); } catch (e) { this._workerState = 'failed'; this.stats.worker = 'error'; resolve(false); return; }
        this._workerState = 'starting';
        this._worker = w;
        w.onmessage = (ev) => { const m = ev.data || {}; const q = this._wq.get(m.id); if (q) { this._wq.delete(m.id); clearTimeout(q.timer); q.resolve(m); } };
        w.onerror = (ev) => {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (this._worker === w) this._workerDown(this._workerState === 'ok' ? 'crashed' : 'error');
          resolve(false);
        };
        this._call({ op: 'ping' }, null, this.cfg.workerTimeoutMs || 4000).then((m) => {
          if (this._worker !== w) { resolve(false); return; }
          if (m && m.ok && m.inflate) { this._workerState = 'ok'; this.stats.worker = 'ok'; resolve(true); }
          else { this._workerDown('no-inflate'); resolve(false); }
        }, () => { if (this._worker === w) this._workerDown('timeout'); resolve(false); });
      });
      return this._wstart;
    }
    // ワーカーを止める（返事が来ない・落ちた）: 待っている呼び出しはみな失敗（'worker error'）、この後はメインスレッドで復元する
    _workerDown(why) {
      const w = this._worker;
      this._worker = null; this._workerState = 'failed'; this.stats.worker = why;
      try { if (w) w.terminate(); } catch (e) { /* 無視 */ }
      const qs = Array.from(this._wq.values());
      this._wq.clear();
      for (const q of qs) { clearTimeout(q.timer); q.reject(new Error('worker error')); }
      if (this.far) this.far.worker = false;
      if (why !== 'none') console.warn('[CityBake] ワーカーを使いません（' + why + '）: メインスレッドで復元します');
    }
    // 1 回の呼び出し。ms（既定 workerCallTimeoutMs）までに返事が無ければワーカーを止める
    _call(msg, tr, ms) {
      return new Promise((resolve, reject) => {
        if (!this._worker) { reject(new Error('no worker')); return; }
        msg.id = ++this._wid;
        const q = { resolve, reject, timer: null };
        const to = ms > 0 ? ms : (this.cfg.workerCallTimeoutMs > 0 ? this.cfg.workerCallTimeoutMs : 10000);
        q.timer = setTimeout(() => { if (this._wq.get(msg.id) === q) this._workerDown('timeout'); }, to);
        this._wq.set(msg.id, q);
        try { this._worker.postMessage(msg, tr || []); } catch (e) { clearTimeout(q.timer); this._wq.delete(msg.id); reject(e); }
      });
    }
    // 中身をまとめて復元 → 結果の配列（keys の順。無い中身は null）。ワーカーかメインスレッド。ワーカーで失敗した（落ちた・止まった・
    //   ワーカーの中の例外 = メモリ不足の RangeError・この端末のエンジンだけの例外・postMessage の DataCloneError）→ ファイルのせいとは限らない
    //   （SHA256 は確かめてある）: ワーカーを止めて、この後はメインスレッドで（ここでも 1 回やり直す）。メインスレッドの失敗は例外（呼んだ側が
    //   使えないファイルにする）。opts.noMain: ワーカーで失敗したらやり直さずに null（LOD の区画: world の次の request が 'main' を受け取り、
    //   decodeJob で少しずつ。ゲームの途中で 1 つの区画を一度に復元しない）
    async _decode(far, keys, opts) {
      const t0 = now();
      let out = null;
      const byKey = this._byKey(far), tileFix = this._tileFix(far, this.tileOf);
      if (far.worker && this._worker) {
        const items = [], tr = [];
        for (const k of keys) {
          const e = byKey.get(k);
          if (!e) { items.push(null); continue; }
          const p = far.hdr.body + e.off, comp = far.u8.slice(p, p + e.comp);
          items.push({ kind: e.kind, a: e.a, b: e.b, check: e.check, raw: e.raw, comp });
          tr.push(comp.buffer);
        }
        try {
          const r = await this._call({ op: 'decode', file: far.name, items, tileFix }, tr);
          if (!r || !r.ok) throw new Error((r && r.error) || 'decode');
          out = r.results;
        } catch (e) {
          const msg = String((e && e.message) || e);
          if (!/^(worker error|no worker)$/.test(msg)) { // ワーカーの中の例外・送れない: このワーカーはもう使わない（メモリも返す）
            this.stats.workerFail++;
            this.stats.lastError = 'worker: ' + msg;
            if (this._worker) this._workerDown('decode: ' + msg);
          }
          far.worker = false; // この後はメインスレッドで
        }
      }
      if (!out && opts && opts.noMain) return null;
      if (!out) {
        out = [];
        let ts = now();
        for (const k of keys) {
          const e = byKey.get(k);
          out.push(e ? decodeEntry(far.u8, far.hdr, e, tileFix) : null);
          if (now() - ts > 8) { await new Promise((r) => setTimeout(r, 0)); ts = now(); } // 開始画面を止めない
        }
      }
      const ms = now() - t0;
      this.stats.decodeMs += ms; if (ms > this.stats.decodeMax) this.stats.decodeMax = ms;
      return out;
    }
    _byKey(far) {
      if (!far._byKey) { far._byKey = new Map(); for (const e of far.hdr.entries) far._byKey.set(entryKey(e.kind, e.a, e.b), e); }
      return far._byKey;
    }
    // 端末の tile（tileOf(材質) → [u, v]）と作ったときの tile が違う材質の uv の倍率。far.bin の材質は far / billboards（tile で
    //   uv を割らない）だけなので tile 表は空 = いつも null（近景のパック（M3）が使う）
    _tileFix(far, tileOf) {
      if (!tileOf || !far.tiles || !far.tiles.length) return null;
      return CityBake.tileFix(far.tiles, tileOf);
    }
    static tileFix(tiles, tileOf) {
      let fix = null;
      for (const t of tiles) {
        let cur = null;
        try { cur = tileOf(t[0]); } catch (e) { cur = null; }
        const u = Array.isArray(cur) ? cur[0] : cur, v = Array.isArray(cur) ? cur[1] : cur;
        if (u > 0 && v > 0 && (Math.fround(u) !== t[1] || Math.fround(v) !== t[2])) (fix || (fix = {}))[t[0]] = [t[1] / u, t[2] / v];
      }
      return fix;
    }

    // ---------- ゲーム中（world が呼ぶ。数だけ受け取り、ゲーム・ワールドは覚えない）----------
    // 街のワールドができた / 捨てた（CityWorld の constructor / dispose）。数だけ数える（ワールドは覚えない）
    acquire() { this._users++; this._hold = false; }
    release() { if (this._users > 0) this._users--; }
    // far.bin のこの中身があるか（使える状態か）
    has(kind, a, b) { return !!(this.far && this.usable && this.far.keys.has(entryKey(KIND[kind], a, b))); }
    get mainThread() { return !!(this.far && !this.far.worker); }
    // kind 'tops' → Float32Array | null、'sky' → Map | null、'skydata' → skyline() の形 | null（復元していなければ null = その場で作る）、
    //   'lod' → 復元したメッシュの並び | 'pending'（ワーカーで復元中）| null（無い = その場で作る）。メインスレッドで復元するときは 'main'
    //   （world が decodeJob で）: ワーカーが無いとき・opts.sync（起動時の prime。その場で同期で組み立てるのでワーカーの返事を待てない）
    request(kind, a, b, opts) {
      if (!this.usable) return null;
      if (kind === 'tops') { if (this.tops) { this.stats.hits++; return this.tops; } this._miss(); return null; }
      if (kind === 'sky') { if (this.sky && this.sky.size) { this.stats.hits++; return this.sky; } this._miss(); return null; }
      if (kind === 'skydata') return this.skyData;
      if (kind !== 'lod') return null;
      const k = entryKey(1, a, b);
      if (!this.far || !this.far.keys.has(k)) { this._miss(); return null; }
      const r = this._ready.get(k);
      if (r) { this._ready.delete(k); return r === 'error' ? null : r; }
      if (!this.far.worker || (opts && opts.sync)) return 'main';
      if (this._inflight.get(k) === 'drop') this._inflight.set(k, 'pending'); // 捨てる印を付けた復元がまだ届いていない: やはり使う
      else if (!this._inflight.has(k)) this._post(k);
      return 'pending';
    }
    // 作り始める前に復元を始めておく（ワーカーのときだけ）
    prefetch(kind, a, b) {
      if (kind !== 'lod' || !this.usable || !this.far || !this.far.worker || this.cfg.prefetchLod === false) return;
      const k = entryKey(1, a, b);
      if (!this.far.keys.has(k) || this._ready.has(k)) return;
      if (this._inflight.get(k) === 'drop') this._inflight.set(k, 'pending');
      else if (!this._inflight.has(k)) this._post(k);
    }
    // この区画の復元結果は要らない（出来上がった・リングから外れた）: 持っていれば捨て、復元中なら届いたときに捨てる
    forget(kind, a, b) {
      const k = entryKey(KIND[kind], a, b);
      this._ready.delete(k);
      if (this._inflight.has(k)) this._inflight.set(k, 'drop');
    }
    // keep(sx, sz) が false の LOD の区画の復元結果を捨てる（先読みしたが入らなかった区画。streamer が時々）
    prune(keep) {
      for (const k of Array.from(this._ready.keys()).concat(Array.from(this._inflight.keys()))) {
        const m = /^1:(\d+)_(\d+)$/.exec(k);
        if (m && !keep(+m[1], +m[2])) this.forget('lod', +m[1], +m[2]);
      }
    }
    _post(k) {
      const far = this.far, ep = this._epoch, t0 = now();
      this._inflight.set(k, 'pending');
      this._decode(far, [k], { noMain: true }).then((res) => {
        const drop = this._inflight.get(k) === 'drop';
        this._inflight.delete(k);
        if (!res) return; // ワーカーで失敗した（ワーカーはもう使わない）: world の次の request が 'main' を受け取ってメインスレッドで少しずつ
        const lat = now() - t0, st = this.stats; // ワーカーへ送ってから届くまで（ms）
        st.wkN = (st.wkN || 0) + 1; st.wkLatSum = (st.wkLatSum || 0) + lat; if (!(lat <= st.wkLatMax)) st.wkLatMax = lat;
        if (ep !== this._epoch || this.far !== far) return;
        if (drop) { st.wkDropped = (st.wkDropped || 0) + 1; return; }
        const r = res && res[0];
        this._ready.set(k, r && r.meshes ? r.meshes : 'error');
        while (this._ready.size > (this.cfg.readyMax || 16)) this._ready.delete(this._ready.keys().next().value); // 取りに来なかったもの
      }, (e) => {
        this._inflight.delete(k);
        if (ep !== this._epoch) return;
        this._broken(far, e);
      });
    }
    // メインスレッドで少しずつ復元（ジェネレーター。yield 'inflate' / 'decode'）→ メッシュの並び | null
    *decodeJob(kind, a, b) {
      const far = this.far;
      if (!far || !far.u8) return null;
      const e = this._byKey(far).get(entryKey(KIND[kind], a, b));
      if (!e) return null;
      const t0 = now();
      let raw;
      try { raw = entryBytes(far.u8, far.hdr, e); } catch (err) { this._broken(far, err); return null; }
      yield 'inflate';
      let meshes;
      const it = decodeMeshesGen(raw, far.hdr.strings, this._tileFix(far, this.tileOf), this.cfg.stepVerts || 8192);
      for (;;) {
        let r;
        try { r = it.next(); } catch (err) { this._broken(far, err); return null; }
        if (r.done) { meshes = r.value; break; }
        yield 'decode';
      }
      const ms = now() - t0;
      this.stats.decodeMs += ms; if (ms > this.stats.decodeMax) this.stats.decodeMax = ms;
      yield 'decode';
      return meshes;
    }
    // メインスレッドでも復元に失敗した: このセッションではそのファイルを使わず、この後はその場で作る（_fail）。開いた far.bin はどれも名前の
    //   SHA256（ダウンロードは index の SHA256）を確かめてあるので、消さない・取り直さない（同じバイトが来て同じ失敗をくり返すだけだった）
    _broken(far, err) {
      if (!far || this.far !== far) return; // もう捨てた
      this._dropFar(far);
      this._ready.clear();
      this._fail(far.name, (err && err.message) || err);
      this._emit('unusable');
    }
    _miss() { this.stats.miss.noPack++; } // ファイルが無い・その中身が無い
    hit() { this.stats.hits++; }
    missWait() { this.stats.miss.loading++; }
    missMat() { this.stats.miss.mat++; }
    // 毎フレーム（CityWorld.update）: カメラなどの位置 [x, z, …]・速さ m/s・1 フレームの ms。ゲーム中の保存の頃合いに使う
    update(points, speed, frameMs) {
      const p = this._play;
      p.t = now(); p.speed = speed || 0;
      if (frameMs > 0 && frameMs < 1000) p.ema += (frameMs - p.ema) * 0.1;
    }
    // ゲーム中なら落ち着くまで待つ（速く動いている・フレームが長い間は書かない。最長 calmMaxWaitMs）
    async _calm(ep) {
      const c = this.cfg, t0 = now();
      for (;;) {
        if (ep !== this._epoch) return false;
        const p = this._play, playing = now() - p.t < 1000;
        if (!playing) return true;
        if (p.speed <= (c.pauseAboveSpeed || 60) && p.ema <= (c.calmFrameMs || 22) && now() - (this._lastWrite || 0) > (c.playGapMs || 0)) return true;
        if (now() - t0 > (c.calmMaxWaitMs || 60000)) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    // ---------- ダウンロード ----------
    startDownload() {
      if (this._dl) return this._dl;
      const ep = this._epoch;
      this._dl = this._download(ep).catch((e) => {
        console.warn('[CityBake] download', e);
        if (ep === this._epoch) this._emit('error', { lastError: String((e && e.message) || e) });
      }).then(() => { if (this._dl && ep === this._epoch) this._dl = null; });
      return this._dl;
    }
    async _download(ep) {
      await this.prepare();
      if (ep !== this._epoch) return;
      if (!this.usable || this.cfg.download === false || !this.server || !this.assets || typeof this.assets._fetchBuffer !== 'function') { if (!this.far) this._emit(this.usable ? 'idle' : 'off'); return; }
      this._emit('checking');
      let idx;
      try {
        const buf = await this.assets._fetchBuffer(this.server + '/city/' + this.levelId + '/index.json?t=' + Date.now());
        idx = JSON.parse(unutf8(new Uint8Array(buf)));
        if (!idx || idx.v !== 1 || !Array.isArray(idx.builds)) throw new Error('index');
        this.stats.online = true;
      } catch (e) {
        if (ep !== this._epoch) return;
        // HTTP の 404 など = サーバーにはつながるが街のデータが無い（まだ作っていない版・作るのに失敗した）。つながらない = オフライン
        const http = /^HTTP \d+/.test(String((e && e.message) || ''));
        this.stats.online = http;
        this._emit(this.far ? 'ready' : (http ? 'none' : 'offline'));
        return;
      }
      if (ep !== this._epoch) return;
      const K = this.keys;
      const build = this._buildOf(idx);
      this.stats.build = build ? build.id : '';
      // 端末の写し（オフラインの起動で使う。次の起動の prepare はここに書いてあるファイルだけを開く）
      await this._writeAtomic('city/' + this.levelId + '/index.json', utf8(JSON.stringify(idx))).catch(() => {});
      if (ep !== this._epoch) return;
      // 開いている far.bin を index が書いていない（サイトが別のファイルに入れ替えた・この鍵のビルドを取り消した）: もう使わない
      if (this.far && (!build || this.far.name !== build.far.f)) this._retire(build ? 'replaced' : 'revoked');
      // 片付け（ネットで index が読めたときだけ）: index のこの鍵のファイルのほかは消す（今まで開いていたファイルも）
      await this._cleanup(build).catch(() => {});
      if (ep !== this._epoch) return;
      if (!build) { this._emit(this.far ? 'ready' : 'none'); return; }
      const f = build.far;
      if (this.far && this.far.name === f.f) { this._emit('ready'); return; }
      if (this._unusable.has(f.f)) { this._emit('unusable'); return; } // このセッションで復元できなかったファイル（取り直しても同じバイト）
      const key = this._fmtDir() + f.f, o = { dir: this.dir };
      // 端末にある（名前 = 中身の SHA256 の頭）: 開くだけ（開くときに SHA256 を確かめる）
      if (!this.far && this.storage && !this.noStore) {
        let have = null;
        try { have = (await this._st(this.storage.list(this._fmtDir(), o))).indexOf(f.f) >= 0 ? await this._st(this.storage.readBinary(key, o)) : null; } catch (e) { have = null; }
        if (ep !== this._epoch) return;
        if (have) {
          const r = await this._open(new Uint8Array(have), f.f, true, false);
          if (r === 'ok') { this._emit('ready'); return; }
          if (ep !== this._epoch || r === 'later') return;
          if (r !== 'bad') { this._emit('unusable'); return; } // SHA256 は合う（サイトのままの）ファイル: 消さない・取り直さない
          try { await this._st(this.storage.remove(key, o)); } catch (e) { /* 無視 */ } // 端末で壊れた: 消して取り直す
        }
      }
      if (this.far) { this._emit('ready'); return; }
      // 1 セッションに取りに行くのは fetchMax 回まで（何かが毎回失敗しても、同じファイルを取り続けない）
      const max = this.cfg.fetchMax >= 1 ? this.cfg.fetchMax : 2;
      if (this._fetches >= max) {
        this.stats.fetchCapped++;
        this._emit('error', { lastError: 'far.bin はこのセッションでもう ' + this._fetches + ' 回取りました（次の起動で）' });
        return;
      }
      this._fetches++; this.stats.fetches = this._fetches;
      this._emit('downloading', { got: 0, total: f.size || 0 });
      const buf = await this.assets._fetchBuffer(this.server + '/city/' + this.levelId + '/' + K.fmt + '/' + f.f, (got, total) => {
        if (ep === this._epoch) this._emit('downloading', { got, total: total || f.size || 0 });
      });
      if (ep !== this._epoch) return;
      this.stats.downloads++; this.stats.downloadedBytes += buf.byteLength;
      const sha = await CityBake.sha256Async(buf);
      if (buf.byteLength !== f.size || sha !== f.sha256 || f.f.indexOf('.' + sha.slice(0, 16) + '.') < 0) {
        this.stats.badSha = (this.stats.badSha || 0) + 1;
        throw new Error('far.bin の SHA256 が合いません（保存しません）');
      }
      const u8 = new Uint8Array(buf);
      // 端末に保存（ゲーム中は落ち着いてから）。保存できなければ（容量・止まった）このときだけメモリで使う
      if (!this.noStore && this.storage) {
        await this._calm(ep);
        if (ep !== this._epoch) return;
        try { await this._writeAtomic(key, u8); this._lastWrite = now(); } catch (e) { this.noStore = true; console.warn('[CityBake] 保存できません（このときだけ使います）:', e && e.message); }
      }
      if (ep !== this._epoch) return;
      if (!this.far) await this._open(u8, f.f, !this.noStore, true);
      if (ep !== this._epoch) return;
      this._emit(this.far ? 'ready' : (this._unusable.has(f.f) ? 'unusable' : 'error'));
    }
    // 開いている far.bin をやめる（サイトの index が別のファイルにした・取り消した）。スカイライン・chunkTops・skyline() もそのファイルから
    //   復元した物なので捨てる（もう始まっているゲームは自分の写しを使い続け、この後の LOD の区画はその場で作る。次に街を始めるときは
    //   index のファイルか、その場で作る）。端末のファイルは _cleanup が消す
    _retire(why) {
      const far = this.far;
      if (!far) return;
      console.warn('[CityBake] サイトの index に無い far.bin を使うのをやめます（' + why + '）:', far.name);
      this._dropFar(far);
      this.sky = null; this.tops = null; this.skyData = null;
      this._ready.clear();
      this.stats.retired++; this.stats.retiredName = far.name;
      Object.assign(this.stats, { farName: '', farBytes: 0, stored: false });
    }
    // .part に書いてから名前を変える（ネイティブ。iOS の rename は原子的）。IndexedDB は put 1 回が原子的なのでそのまま。
    //   1 回ずつ storageTimeoutMs まで（過ぎたら失敗 = 呼んだ側はメモリで使う）。書くのは写し（u8 はこの後メインスレッドで持つ）
    async _writeAtomic(key, u8) {
      const S = this.storage, o = { dir: this.dir };
      if (!S) throw new Error('no storage');
      const buf = u8.slice().buffer;
      if (S.native && typeof S.rename === 'function') {
        await this._st(S.writeBinary(key + '.part', buf, o));
        await this._st(S.rename(key + '.part', key, o));
      } else await this._st(S.writeBinary(key, buf, o));
    }
    // この版（fmt）のディレクトリの、index のこの鍵のビルドの物ではないファイル（今まで開いていた物も = _retire の後）と、ほかの fmt の
    //   ディレクトリを消す
    async _cleanup(build) {
      const S = this.storage, o = { dir: this.dir };
      if (!S || typeof S.list !== 'function') return;
      const base = 'city/' + this.levelId + '/', keep = new Set();
      if (build && build.far) keep.add(build.far.f);
      for (const n of await this._st(S.list(base, o))) {
        if (/^[0-9a-f]{16}$/.test(n) && n !== this.keys.fmt) await this._st(S.removeTree(base + n + '/', o)); // ほかの版の world.js 用
      }
      for (const n of await this._st(S.list(this._fmtDir(), o))) {
        if (keep.has(n) || /\.part$/.test(n)) continue; // .part は書いている途中かもしれない（起動時の prepare が消す）
        await this._st(S.remove(this._fmtDir() + n, o));
      }
    }

    // ---------- 設定 ----------
    setUser(on) {
      this.user = !!on;
      pref.set('cityBake', on ? 'on' : 'off');
      if (on) { this._prep = null; this._fetches = 0; this._unusable.clear(); this.prepare().then(() => this.startDownload()); } // 自分で入れ直した = 数え直す
      else { this._epoch++; this._dl = null; this._prep = null; this._inflight.clear(); this._ready.clear(); this._emit('off'); }
    }
    // 「街のデータを削除」: 端末の city/ を消し、持っている物を捨てる（この後はその場で作る）。オンならまたダウンロードする
    async clear() {
      this._epoch++;
      this._dl = null; this._prep = null;
      this._fetches = 0; this._unusable.clear(); // 自分で消した = 取り直し・使えなかったファイルも数え直す
      const far = this.far;
      if (far) far.dropped = true;
      this.far = null; this.tops = null; this.sky = null; this.skyData = null;
      this._ready.clear(); this._inflight.clear();
      if (far && far.worker && this._worker) this._call({ op: 'clear' }).catch(() => {});
      this.noStore = false;
      Object.assign(this.stats, { far: false, farName: '', farBytes: 0, got: 0, total: 0, stored: false, build: '' });
      if (this.storage && typeof this.storage.removeTree === 'function') { try { await this._st(this.storage.removeTree('city/', { dir: this.dir })); } catch (e) { console.warn('[CityBake] 削除', e); } }
      this._emit('idle');
      if (this.usable && this.cfg.download !== false) this.startDownload();
    }
    // 街ではないゲーム（アリーナ）を始めた: 起動時に復元したスカイライン・skyline() の配列を捨てる（約 13 MB）。そのゲームの最中に far.bin が
    //   開いても復元しない（_hold）。次に街を選んだとき（main.js の whenSky）に復元し直す。「もう一度」でそのまま街を始めたときは
    //   スカイライン・chunkTops をその場で作る（LOD の区画は far.bin から）
    trim() {
      this._hold = true;
      if (!this.far || !this.sky) return;
      this.sky = null; this.tops = null; this.skyData = null; this._ready.clear();
    }
    // スカイライン・chunkTops・skyline() を復元しておく（ワーカー）。街を始める前に（開始画面・モードの画面）。Promise（終わったら / 何もしない）
    ensureSky() {
      this._hold = false;
      const far = this.far, ep = this._epoch;
      if (!far || this.sky || !this.usable) return Promise.resolve(false);
      if (this._users > 0) return Promise.resolve(false); // 街のゲームの最中（そのゲームは使わない）
      if (this._resky) return this._resky;
      this._resky = this._decodeFar(far, ep).then((r) => { if (!r && ep === this._epoch && this.far === far) this._broken(far, new Error(this.stats.lastError || 'sky')); return !!this.sky; }, () => false)
        .then((v) => { this._resky = null; return v; });
      return this._resky;
    }
    // 街を始める前に待つ: 起動時の prepare（端末の far.bin を開く）と、まだならスカイラインの復元。最長 maxMs（既定 startWaitMs）。
    //   待たずに始めても形は同じ（その場で作るだけ）。開始画面ですぐ押した・遅い端末でも maxMs で始める
    whenSky(maxMs) {
      const ms = maxMs >= 0 ? maxMs : (this.cfg.startWaitMs >= 0 ? this.cfg.startWaitMs : 2000);
      if (!this.usable) return Promise.resolve(false);
      const work = (this._prep || this.prepare()).then(() => this.ensureSky());
      let t = null;
      return Promise.race([work, new Promise((r) => { t = setTimeout(() => r(false), ms); })]).then((v) => { clearTimeout(t); return v; }, () => { clearTimeout(t); return false; });
    }
    // テスト用: メモリのバイト列を far.bin として使う（保存しない。名前の SHA256 は確かめない）
    async useFar(u8, name) {
      if (!this.keys) { this.keys = CityBake.keys(this.level); this.stats.fmt = this.keys.fmt; this.stats.gen = this.keys.gen; }
      return this._open(u8, name || 'far.mem.bin', false, true);
    }
    // 街の CityGen に skyline() のデータを入れる（同じ genKey のときだけ。起動時の 100 ms 前後の skyline() を省く）
    seedCity(city) {
      if (!this.usable || !this.skyData || !city || typeof city.seedSkyline !== 'function') return false;
      return city.seedSkyline(this.skyData);
    }
  };
})();
