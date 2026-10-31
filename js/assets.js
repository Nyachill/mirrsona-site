// ゲームデータの「ダウンロード → 端末に保存 → 読み込み」を担当する。
//
// サーバー側の構成（assets/ フォルダをそのまま置く）:
//   manifest.json            … { version, files: [{ path, size, sha256, tier? }] }
//   config/game.json         … 数値設定
//   levels/arena01.json      … マップ
//   hd/... sd/...            … 品質ティア別のテクスチャ・モデル・空（path の先頭が hd/ or sd/ → manifest に tier が付く）
//   models/*.glb, sounds/*.mp3, sky/*.jpg … 共通（tier なし）
//
// 起動時の流れ:
//   1. サーバーの manifest.json を取りに行く（タイムアウトあり）
//   2. 端末に保存してあるバージョンと違えば（または自分のティアのファイルが足りなければ）差分ダウンロードして保存
//      … ダウンロードするのは「共通 + 自分のティア」だけ
//   3. 端末のデータを読み込んでゲームへ渡す（JSON は即読み、バイナリは使う時に読む）
//   4. サーバーにも端末にも無ければ、アプリ内蔵のデータ（defaults.js）で起動
//
// メモリ: バイナリは起動時には読まず、loadTexture / loadModel / loadAudio が呼ばれた時に端末ストレージから読んで
// デコードし、デコード結果だけをキャッシュする。ArrayBuffer は小さいもの（KEEP_BLOB_BYTES 以下）だけ残す。
//
// 後から読む素材（manifest の lazy: true。tools/build-manifest.js の LAZY_GLOBS = 街のタイル・大きなランドマーク GLB）:
//   起動時のダウンロード（_select / _allStored / _download）にも存在確認（_loadFromStorage の _storageHas）にも入れない。
//   使う時に fetchLazy(path, { priority }) が取りに行く: 端末の meta/lazy.json（path → 保存した物の sha256）が manifest の sha256 と
//   同じなら端末から読む（ハッシュは計算しない）、違えば / 無ければネットから取って検証 → 保存 → meta/lazy.json を更新。
//   同時に取りに行くのは lazyConcurrency（2）まで（priority の小さい順）、失敗は lazyRetries 回まで間を空けてやり直す。
//   端末に保存できない環境では、このセッションの間だけ lazyMemBytes（LRU）までメモリに持つ。
//   has(path) は lazy の物も true、getBuffer / loadModel / loadTexture / loadAudio は lazy の物なら fetchLazy を通す。
window.MR = window.MR || {};

MR.AssetManager = class AssetManager {
  constructor(storage, options) {
    options = options || {};
    this.storage = storage || {};
    this.server = options.server ? options.server.replace(/\/+$/, '') : '';
    this.timeoutMs = options.timeoutMs || 12000;
    this.tier = AssetManager.normalizeTier(options.tier) || 'hd';
    this.keepBytes = typeof options.keepBytes === 'number' ? options.keepBytes : 1024 * 1024;
    this.data = {};        // path -> デコード済みデータ（JSON はオブジェクト、バイナリは ArrayBuffer か null=ストレージにある）
    this.files = {};       // path -> manifest エントリ（全ティア）
    this.stored = {};      // path -> true: 端末ストレージに実体がある（自分のティア以外も含む）
    this.volatile = {};    // path -> ArrayBuffer|string: 端末に保存できなかったときのセッション内キャッシュ
    this.manifest = null;  // 現在使っているデータの manifest
    this.source = 'embedded'; // 'remote' | 'cache' | 'embedded'
    this.downloadedBytes = 0; // 今回の起動でダウンロードしたバイト数
    this.totalBytes = 0;      // 共通 + 自分のティアの合計サイズ（manifest の size の合計）
    this.textureCache = {};
    this.modelCache = {};
    this._texLoaded = {};   // textureCache のうち届いたもの（key → Texture。releaseGpuTextures 用）
    this._modelLoaded = {}; // modelCache のうち届いたもの（path → { scene, animations }）
    this.audioCache = {};
    this._bitmapSupport = null; // createImageBitmap(flipY) が正しく動くか（初回に調べる）
    // 配信先（hosts.json。_loadHosts）。null = 一覧なし = 今まで通り this.server（起動の入り口 = bootstrap）だけ
    this.hosts = null;        // [{ id, base, full, timeoutMs, maxFails, fails, dead, bootstrap }]
    this.hostsSource = 'none'; // 'none' | 'remote' | 'cache' | 'bad'
    this.hostUsed = '';        // manifest を取った配信先の id（一覧なしは ''）
    this.hostStats = { failovers: 0, byHost: {} }; // byHost: id → { files, bytes, fails }
    // lazy（後から読む）素材
    this.lazy = {};           // path -> manifest エントリ（自分のティアの lazy のもの）
    this.lazyConcurrency = Math.max(1, options.lazyConcurrency || 2);
    this.lazyRetries = typeof options.lazyRetries === 'number' ? options.lazyRetries : 2;
    this.lazyRetryMs = typeof options.lazyRetryMs === 'number' ? options.lazyRetryMs : 600;
    this.lazyMemBytes = typeof options.lazyMemBytes === 'number' ? options.lazyMemBytes : 48 * 1024 * 1024;
    this._lazyIndex = null;   // Promise<{ path: sha256 }>（meta/lazy.json。最初の fetchLazy で読む）
    this._lazyIndexWrite = Promise.resolve();
    this._lazyPending = {};   // path -> 取りに行っている途中の仕事 { promise, priority, seq, ... }
    this._lazyQueue = [];     // 順番待ちの仕事（priority の小さい順 → 頼まれた順）
    this._lazyActive = 0;
    this._lazySeq = 0;
    this._lazyMem = new Map(); // path -> ArrayBuffer（保存できない環境のメモリ。Map の順 = 古い順の LRU）
    this._lazyMemUsed = 0;
    this._lazyStats = { network: 0, networkBytes: 0, storage: 0, memory: 0, failed: 0, retries: 0, maxActive: 0, indexWrites: 0 };
  }

  // ---------- ティア ----------

  static normalizeTier(t) {
    return (t === 'hd' || t === 'sd') ? t : null;
  }

  // path の先頭セグメントが hd / sd ならそのティア、それ以外は null（共通）
  static tierOf(path) {
    const m = /^(hd|sd)\//.exec(path || '');
    return m ? m[1] : null;
  }

  static otherTier(tier) {
    return tier === 'hd' ? 'sd' : 'hd';
  }

  // 設定値（'auto' | 'hd' | 'sd'）と環境から実際のティアを決める。URL の ?tier= が最優先
  //   opts.search … location.search の代わり（テスト用）、opts.touch … タッチ端末かどうかの上書き
  static pickTier(configTier, opts) {
    opts = opts || {};
    let search = opts.search;
    if (search === undefined && typeof location !== 'undefined' && location.search) search = location.search;
    const m = /[?&]tier=(hd|sd)\b/.exec(search || '');
    if (m) return m[1];
    const fixed = AssetManager.normalizeTier(configTier);
    if (fixed) return fixed;
    let touch = opts.touch;
    if (touch === undefined) {
      const nav = (typeof navigator !== 'undefined') ? navigator : {};
      touch = (typeof window !== 'undefined' && 'ontouchstart' in window) || (nav.maxTouchPoints > 0);
    }
    return touch ? 'sd' : 'hd';
  }

  // manifest のエントリが自分のティア向け（共通 or 同じティア）か
  _wanted(entry) {
    const t = entry.tier || AssetManager.tierOf(entry.path);
    return !t || t === this.tier;
  }

  // 起動時にそろえるもの = 自分のティア向けで lazy でないもの（lazy は fetchLazy が使う時に取りに行く）
  _select(manifest) {
    const files = (manifest && Array.isArray(manifest.files)) ? manifest.files : [];
    return files.filter((f) => this._wanted(f) && !f.lazy);
  }

  // manifest の hostOnly（全部を持つ配信先 = hosts.json の full: true にだけ置くファイル。Pages の 1 GB を超える分）のうち自分のティア向け。
  //   files には入れない = hostOnly を知らない古いアプリ（ビルド 12 まで）は要求しない
  _selectHostOnly(manifest) {
    const files = (manifest && Array.isArray(manifest.hostOnly)) ? manifest.hostOnly : [];
    return files.filter((f) => f && typeof f.path === 'string' && !/\.json$/i.test(f.path) && this._wanted(f));
  }

  // ---------- 起動 ----------

  // progress(text, ratio) を呼びながら準備する。戻り値は { source, version, tier, totalBytes, downloadedBytes }
  async prepare(progress) {
    const report = (text, ratio) => { if (progress) progress(text, ratio); };

    report('データを確認中 (' + this.tier + ')', 0);
    const localVersion = await this._readText('meta/version.txt');
    let localManifest = null;
    const localManifestText = await this._readText('meta/manifest.json');
    if (localManifestText) {
      try { localManifest = JSON.parse(localManifestText); } catch (e) { localManifest = null; }
    }

    let remoteManifest = null;
    if (this.server) {
      // 配信先の一覧（hosts.json）。無い・壊れている = 今まで通り this.server だけ
      await this._loadHosts();
      remoteManifest = await this._fetchManifest();
    }

    if (remoteManifest && Array.isArray(remoteManifest.files)) {
      // バージョンが違えば差分ダウンロード。同じでも自分のティアのファイルが端末に無ければ（ティア切替）取りに行く
      let need = !localManifest || remoteManifest.version !== localVersion;
      if (!need) need = !(await this._allStored(this._select(remoteManifest)));
      // 全部を持つ配信先（full）だけにあるファイル（manifest の hostOnly）: 足りなければ取りに行く（取れなくても起動は続ける）
      if (!need && this._fullHost()) need = (await this._hostOnlyTodo(remoteManifest)).length > 0;
      if (need) {
        try {
          await this._download(remoteManifest, localManifest, report);
          localManifest = remoteManifest;
          this.source = 'remote';
        } catch (e) {
          console.warn('[Assets] ダウンロード失敗。手元のデータで続行します:', e.message);
          this.source = localManifest ? 'cache' : 'embedded';
        }
      } else {
        this.source = 'cache';
      }
    } else if (localManifest) {
      this.source = 'cache';
    }

    if (localManifest) {
      report('データを読み込み中', 0.95);
      const ok = await this._loadFromStorage(localManifest);
      if (ok) {
        this.manifest = localManifest;
        this._pruneRetired(localManifest); // 待たない（失敗しても起動は続ける）
        report('準備完了', 1);
        return this._result(localManifest.version);
      }
      console.warn('[Assets] 保存データが壊れています。内蔵データで起動します');
    }

    this._loadEmbedded();
    this.source = 'embedded';
    report('準備完了', 1);
    return this._result(this.manifest.version);
  }

  // manifest から外れたファイル（AssetManager.RETIRED）を端末から消す（1 回だけ: meta/retired.txt に印。今の manifest にまたあるファイルは消さない）。
  //   ダウンロードは manifest から外れたファイルを消さないので、外した物は端末に残り続けた（VX: fa18.glb sd 3.4 MB / hd 8.9 MB・戦闘機の音）
  async _pruneRetired(manifest) {
    try {
      const mark = 'vx1';
      if ((await this._readText('meta/retired.txt')) === mark) return 0;
      const inMan = new Set(((manifest && manifest.files) || []).map((f) => f.path));
      let n = 0, done = true;
      for (const path of AssetManager.RETIRED) {
        if (inMan.has(path)) { done = false; continue; } // 古い manifest（オフラインの起動・ダウンロードの失敗）にまだある → 印を付けずに次の起動で
        try { if (typeof this.storage.remove === 'function' && (await this._storageHas(path))) { await this.storage.remove(path); n++; } } catch (e) { done = false; /* 次の起動でまた */ }
      }
      if (done) await this.storage.writeText('meta/retired.txt', mark);
      this.retiredRemoved = n;
      return n;
    } catch (e) { return 0; }
  }

  _result(version) {
    return { source: this.source, version, tier: this.tier, totalBytes: this.totalBytes, downloadedBytes: this.downloadedBytes, host: this.hostUsed };
  }

  // ---------- 参照 ----------

  // JSON はパース済みオブジェクト。バイナリは ArrayBuffer（小さいもの）か null（ストレージにある。getBuffer で読む）
  get(path) {
    return this.data[path];
  }

  // そのパスのデータが使えるか（メモリ上 or 端末ストレージ上）
  has(path) {
    if (!path) return false;
    if (Object.prototype.hasOwnProperty.call(this.data, path)) return true;
    if (this.lazy[path]) return true; // 後から読む物（端末に無くても fetchLazy で取れる）
    return this.stored[path] === true;
  }

  // 論理パス（'textures/ground/albedo.jpg' や 'models/p90.glb'）から実際のキーを決める。
  //   1. 自分のティア `${tier}/${path}`  2. もう一方のティア（端末に残っていれば）  3. ティア無しの `${path}`
  // 先頭に hd/ or sd/ が付いた指定も受け付ける（その順で試す）。無ければ null
  resolve(logicalPath) {
    if (!logicalPath) return null;
    const own = AssetManager.tierOf(logicalPath);
    const bare = own ? logicalPath.slice(3) : logicalPath;
    const first = own || this.tier;
    const candidates = [first + '/' + bare, AssetManager.otherTier(first) + '/' + bare, bare];
    for (const c of candidates) if (this.has(c)) return c;
    return null;
  }

  // 現在のティアで利用できるパスの一覧（デバッグ・テスト用）
  keys() {
    const set = {};
    for (const k of Object.keys(this.data)) set[k] = true;
    for (const k of Object.keys(this.stored)) set[k] = true;
    for (const k of Object.keys(this.lazy)) set[k] = true;
    return Object.keys(set).sort();
  }

  // バイナリの生データ。メモリに無ければ端末ストレージから読む。無ければ null
  //   lazy の物は fetchLazy を通す（取れなければ reject）
  async getBuffer(path) {
    const v = this.data[path];
    if (v && typeof v.byteLength === 'number') return v;
    if (v) return null; // JSON
    if (this.lazy[path]) return this.fetchLazy(path);
    if (!this.stored[path]) return null;
    const buf = await this._readBinary(path);
    if (!buf) return null;
    if (buf.byteLength <= this.keepBytes) this.data[path] = buf; // 小さいものはメモリに残す
    return buf;
  }

  // デコード済みの大きい ArrayBuffer はメモリから捨てる（端末ストレージにあるので必要なら getBuffer で読み直す）。has() は true のまま
  _release(path) {
    const v = this.data[path];
    if (v && typeof v.byteLength === 'number' && v.byteLength > this.keepBytes && this.stored[path]) this.data[path] = null;
  }

  // ---------- ローダー ----------

  // 画像ファイル → THREE.Texture
  //   opts: { srgb, repeat: [u,v] | number, anisotropy, flipY (既定 true), wrap (既定 RepeatWrapping), minFilter, magFilter,
  //           maxSize（これより大きい画像は縮める。GPU メモリの節約。街のタッチ端末で使う）}
  // 同じ path は（srgb / flipY / maxSize が同じなら）同じ Texture を返す。repeat / anisotropy は初回作成時だけ反映される
  //   できた Texture の mrCacheKey にキャッシュのキーを入れる（materials.js の disposeTextures がレベルを移るときに使う）
  loadTexture(path, opts) {
    opts = opts || {};
    const flipY = opts.flipY !== false;
    const key = this.textureKey(path, opts);
    if (this.textureCache[key]) return this.textureCache[key];
    const p = this._loadTextureUncached(path, opts, flipY).then((t) => {
      if (t) { t.mrCacheKey = key; if (this.textureCache[key] === p) this._texLoaded[key] = t; }
      return t;
    }, (e) => {
      delete this.textureCache[key];
      throw e;
    });
    this.textureCache[key] = p;
    return p;
  }

  // loadTexture のキャッシュのキー（同じ path でも srgb / flipY / maxSize が違えば別の Texture）
  textureKey(path, opts) {
    opts = opts || {};
    return path + '|' + (opts.srgb ? 's' : 'l') + (opts.flipY !== false ? '' : '|nf') + (opts.maxSize ? '|m' + opts.maxSize : '');
  }

  // loadTexture のキャッシュから外す（GPU の解放は呼ぶ側の texture.dispose()。次に読むときはデコードし直す）
  forgetTexture(texture) {
    const k = texture && texture.mrCacheKey;
    if (k && this.textureCache[k]) delete this.textureCache[k];
    if (k && this._texLoaded[k] === texture) delete this._texLoaded[k];
  }

  // レベルを移ったとき（main.js）: 読み込んだテクスチャと GLB の材質のテクスチャのうち、keep（新しいゲームの場面が使っている Texture）に
  //   無いものを GPU から捨てる。画像（CPU 側）は残すので、あとで使われたら three がその場で上げ直す（デコードし直しはしない）。
  //   アリーナに移っても街の GLB（ランドマーク・ヘリ・戦闘機・小物）が GPU に残り続けていた（約 170 MB）。戻り値は捨てた枚数
  releaseGpuTextures(keep) {
    let n = 0;
    const seen = new Set();
    const drop = (t) => {
      if (!t || !t.isTexture || seen.has(t) || (keep && keep.has(t))) return;
      seen.add(t);
      const im = t.image;
      if (!im || im.width === 0) return; // 閉じた画像は上げ直せないので触らない
      t.dispose();
      n++;
    };
    for (const k in this._texLoaded) drop(this._texLoaded[k]);
    const scenes = [];
    for (const k in this._modelLoaded) { const g = this._modelLoaded[k]; if (g && g.scene) scenes.push(g.scene); }
    for (const sc of AssetManager.lowCopies || []) scenes.push(sc);
    for (const sc of scenes) {
      sc.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) for (const s of AssetManager.TEXTURE_SLOTS) drop(m[s]);
      });
    }
    return n;
  }

  // manifest から外したファイル（端末に残っていれば _pruneRetired が 1 回消す）。VX: 戦闘機をゲームから外した
  static get RETIRED() {
    return ['sd/models/fa18.glb', 'hd/models/fa18.glb', 'sounds/catapult_launch.mp3', 'sounds/arrest_catch.mp3', 'sounds/canopy_motor.mp3', 'sounds/sonic_boom.mp3',
      'sounds/jet_flyby.mp3', 'sounds/jet_afterburner.mp3'];
  }
  static get TEXTURE_SLOTS() { return ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap']; }

  // 場面（Object3D）の材質・uniforms・背景・環境が使っている Texture を集める（releaseGpuTextures の keep）
  static texturesIn(roots, out) {
    out = out || new Set();
    for (const root of roots) {
      if (!root) continue;
      if (root.background && root.background.isTexture) out.add(root.background);
      if (root.environment && root.environment.isTexture) out.add(root.environment);
      root.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
          for (const k in m) {
            const v = m[k];
            if (v && v.isTexture) out.add(v);
            else if (k === 'uniforms' && v) for (const u in v) { const uv = v[u] && v[u].value; if (uv && uv.isTexture) out.add(uv); }
          }
          // onBeforeCompile の材質が横に持つ uniforms（MR.Facade の tFacDetail など。b17: 見ずに wall_detail.jpg を毎回 GPU から捨てていた = 次の描画で上げ直し）
          const uu = m.userData && m.userData.uniforms;
          if (uu) for (const u in uu) { const uv = uu[u] && uu[u].value; if (uv && uv.isTexture) out.add(uv); }
        }
      });
    }
    return out;
  }

  async _loadTextureUncached(path, opts, flipY) {
    const buf = await this.getBuffer(path);
    if (!buf) throw new Error('texture not found: ' + path);
    const blob = new Blob([buf], { type: AssetManager.mimeFor(path) });
    let texture = null;
    if (await this._canUseImageBitmap()) {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: flipY ? 'flipY' : 'none', premultiplyAlpha: 'none' });
        texture = new THREE.Texture(bitmap);
        texture.flipY = false; // ImageBitmap は作成時に反転済み（ImageBitmap には UNPACK_FLIP_Y が効かないので false にしておく）
        texture.mrDecoder = 'imagebitmap';
      } catch (e) {
        console.warn('[Assets] createImageBitmap 失敗。TextureLoader で読みます:', path, e && e.message);
        texture = null;
      }
    }
    if (!texture) {
      const url = URL.createObjectURL(blob);
      try {
        texture = await new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error('texture decode failed: ' + path)));
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      texture.flipY = flipY;
      texture.mrDecoder = 'image';
    }
    if (opts.maxSize) texture = AssetManager.downscale(texture, opts.maxSize);
    this._applyTextureOpts(texture, opts);
    texture.needsUpdate = true;
    this._release(path);
    return texture;
  }

  // 元を壊さずに縮めた写し（元の画像は閉じない・元の Texture は捨てない）。max 以下か縮められなければ元のまま（共有）
  static scaledCopy(texture, max) {
    const img = texture && texture.image;
    const w = img && img.width, h = img && img.height;
    if (!w || !h || !(max > 0) || (w <= max && h <= max) || typeof document === 'undefined') return texture;
    try {
      const s = max / Math.max(w, h), cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      if (!ctx || typeof ctx.drawImage !== 'function') return texture;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      const t = new THREE.CanvasTexture(c);
      t.flipY = texture.flipY; t.wrapS = texture.wrapS; t.wrapT = texture.wrapT; t.encoding = texture.encoding; t.anisotropy = texture.anisotropy;
      t.offset.copy(texture.offset); t.repeat.copy(texture.repeat); t.rotation = texture.rotation; t.center.copy(texture.center);
      t.minFilter = texture.minFilter; t.magFilter = texture.magFilter; t.generateMipmaps = texture.generateMipmaps; t.format = texture.format; t.name = texture.name;
      t.mrDecoder = (texture.mrDecoder || '') + '+copy' + max;
      return t;
    } catch (e) {
      return texture;
    }
  }

  // GLB の場面の写しで、材質を複製してテクスチャを max 以下の写しにしたもの（同じ場面・同じ max は 1 つを使い回す）。
  //   遠くでしか見えない物（地面の武器・敵の銃）に使う: 手に持つ武器は元の場面のまま（mem 計画。iPhone で使わない武器の 1024 の
  //   テクスチャを GPU に上げない。その大きさではミップの 512 から下しか使わないので見た目は同じ）
  static lowCopy(scene, max) {
    if (!scene || !scene.isObject3D || !(max > 0)) return scene;
    const C = AssetManager._lowCopies || (AssetManager._lowCopies = new WeakMap());
    let per = C.get(scene);
    if (!per) { per = {}; C.set(scene, per); }
    if (per[max]) return per[max];
    const out = scene.clone(true);
    const mats = new Map(), texs = new Map();
    const tex = (t) => { if (!t || !t.isTexture) return t; let r = texs.get(t); if (!r) { r = AssetManager.scaledCopy(t, max); texs.set(t, r); } return r; };
    const mat = (m) => {
      if (!m) return m;
      let r = mats.get(m);
      if (r) return r;
      r = m.clone();
      for (const k of AssetManager.TEXTURE_SLOTS) if (r[k]) r[k] = tex(r[k]);
      mats.set(m, r);
      return r;
    };
    out.traverse((o) => { if (o.material) o.material = Array.isArray(o.material) ? o.material.map(mat) : mat(o.material); });
    out.userData.lowCopy = max;
    per[max] = out;
    (AssetManager.lowCopies || (AssetManager.lowCopies = [])).push(out); // releaseGpuTextures・game の gpuSweep も見る
    return out;
  }

  // 画像が max より大きければ Canvas に縮めて描いた新しい Texture にする（元の ImageBitmap は閉じる）。縮められなければそのまま
  static downscale(texture, max) {
    const img = texture && texture.image;
    const w = img && img.width, h = img && img.height;
    if (!w || !h || (w <= max && h <= max) || typeof document === 'undefined') return texture;
    try {
      const s = max / Math.max(w, h), cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      if (!ctx || typeof ctx.drawImage !== 'function') return texture;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      const t = new THREE.CanvasTexture(c);
      t.flipY = texture.flipY; // ImageBitmap は作成時に反転済み（false のまま）、<img> は true
      t.wrapS = texture.wrapS; t.wrapT = texture.wrapT; t.encoding = texture.encoding; t.anisotropy = texture.anisotropy;
      t.mrDecoder = (texture.mrDecoder || '') + '+scaled';
      if (img.close) img.close();
      texture.dispose();
      return t;
    } catch (e) {
      return texture;
    }
  }

  _applyTextureOpts(texture, opts) {
    const wrap = opts.wrap !== undefined ? opts.wrap : THREE.RepeatWrapping;
    texture.wrapS = wrap;
    texture.wrapT = wrap;
    if (opts.srgb) texture.encoding = THREE.sRGBEncoding;
    if (opts.repeat !== undefined) {
      if (typeof opts.repeat === 'number') texture.repeat.set(opts.repeat, opts.repeat);
      else if (opts.repeat && opts.repeat.length >= 2) texture.repeat.set(opts.repeat[0], opts.repeat[1]);
      else if (opts.repeat && typeof opts.repeat.x === 'number') texture.repeat.copy(opts.repeat);
    }
    if (opts.anisotropy) texture.anisotropy = opts.anisotropy;
    if (opts.minFilter !== undefined) texture.minFilter = opts.minFilter;
    if (opts.magFilter !== undefined) texture.magFilter = opts.magFilter;
    if (opts.generateMipmaps !== undefined) texture.generateMipmaps = opts.generateMipmaps;
  }

  // createImageBitmap が imageOrientation:'flipY' を正しく処理するか 1 回だけ調べる（上=赤 / 下=青 の 1x2 画像で確認）
  _canUseImageBitmap() {
    if (this._bitmapSupport) return this._bitmapSupport;
    this._bitmapSupport = (async () => {
      try {
        if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return false;
        const src = document.createElement('canvas');
        src.width = 1; src.height = 2;
        const sctx = src.getContext('2d');
        if (!sctx) return false;
        sctx.fillStyle = '#ff0000'; sctx.fillRect(0, 0, 1, 1);
        sctx.fillStyle = '#0000ff'; sctx.fillRect(0, 1, 1, 1);
        const bmp = await createImageBitmap(src, { imageOrientation: 'flipY' });
        const dst = document.createElement('canvas');
        dst.width = 1; dst.height = 2;
        const dctx = dst.getContext('2d');
        dctx.drawImage(bmp, 0, 0);
        const px = dctx.getImageData(0, 0, 1, 2).data;
        if (bmp.close) bmp.close();
        // 反転していれば上が青
        return px[2] > 200 && px[0] < 50 && px[4] > 200 && px[6] < 50;
      } catch (e) {
        return false;
      }
    })();
    return this._bitmapSupport;
  }

  // .glb → { scene, animations }（パース結果をキャッシュ。使う側は clone する。スキンは THREE.SkeletonUtils.clone）
  loadModel(path) {
    if (this.modelCache[path]) return this.modelCache[path];
    const p = (async () => {
      if (!THREE.GLTFLoader) throw new Error('THREE.GLTFLoader がありません');
      const buf = await this.getBuffer(path);
      if (!buf) throw new Error('model not found: ' + path);
      const gltf = await new Promise((resolve, reject) => {
        new THREE.GLTFLoader().parse(buf, '', resolve, (e) => reject(e instanceof Error ? e : new Error('glb parse failed: ' + path)));
      });
      this._release(path);
      // parser（GLB の本文を丸ごと抱えている）はキャッシュしない。scene と animations だけで足りる
      const out = { scene: gltf.scene, animations: gltf.animations || [] };
      this._modelLoaded[path] = out;
      return out;
    })().catch((e) => {
      delete this.modelCache[path];
      throw e;
    });
    this.modelCache[path] = p;
    return p;
  }

  // loadModel のキャッシュから 1 つ外して GPU の物（形・材質・テクスチャ）を捨てる（VX: 遠くへ離れた VTOL・game.stop）。
  //   使う側は clone を全部捨ててから呼ぶ（clone は形・材質を共有する）。読み込み中（まだ届いていない）なら何もしない = false。
  //   次に loadModel すれば端末ストレージから読み直す。戻り値は捨てたか
  releaseModel(path) {
    const g = this._modelLoaded[path];
    if (!g) return false;
    const geos = new Set(), mats = new Set(), texs = new Set();
    if (g.scene) g.scene.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { mats.add(m); for (const s of AssetManager.TEXTURE_SLOTS) if (m[s] && m[s].isTexture) texs.add(m[s]); }
    });
    geos.forEach((x) => x.dispose()); texs.forEach((x) => x.dispose()); mats.forEach((x) => x.dispose());
    delete this._modelLoaded[path];
    delete this.modelCache[path];
    this._release(path);
    return true;
  }

  // 音声ファイル → AudioBuffer（デコード結果をキャッシュ）
  loadAudio(path, audioCtx) {
    if (this.audioCache[path]) return this.audioCache[path];
    const p = (async () => {
      if (!audioCtx || typeof audioCtx.decodeAudioData !== 'function') throw new Error('AudioContext がありません');
      const buf = await this.getBuffer(path);
      if (!buf) throw new Error('audio not found: ' + path);
      // decodeAudioData は渡した ArrayBuffer を detach することがあるのでコピーを渡す
      const copy = buf.slice(0);
      const decoded = await new Promise((resolve, reject) => {
        let ret = null;
        try {
          ret = audioCtx.decodeAudioData(copy, resolve, (e) => reject(e instanceof Error ? e : new Error('audio decode failed: ' + path)));
        } catch (e) { reject(e); return; }
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
      });
      this._release(path);
      return decoded;
    })().catch((e) => {
      delete this.audioCache[path];
      throw e;
    });
    this.audioCache[path] = p;
    return p;
  }
  // デコード結果をキャッシュから外す（MR.Audio.release: 後からデコードする天気の音の PCM を手放す。ここに残すと AudioBuffer が
  //   ゲームの終わりまで残っていた）。次の loadAudio はもう一度読んでデコードする。戻り値 = 外したか
  forgetAudio(path) {
    if (!path || !this.audioCache[path]) return false;
    delete this.audioCache[path];
    return true;
  }

  // 保存データを消して次回起動時に再ダウンロードさせる
  async reset() {
    if (this.storage.clearAll) await this.storage.clearAll();
    this._lazyIndex = null;
  }

  // ---------- 後から読む素材（lazy） ----------

  // JSON を読む（内蔵・起動時にそろえた物はそのまま、lazy の物は fetchLazy で取ってパースし、覚える）。取れなければ reject
  loadJSON(path) {
    const v = this.data[path];
    if (v && typeof v === 'object' && typeof v.byteLength !== 'number') return Promise.resolve(v);
    return this.getBuffer(path).then((buf) => {
      if (!buf) throw new Error('json not found: ' + path);
      const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
      const o = JSON.parse(text);
      this.data[path] = o;
      return o;
    });
  }

  fetchLazy(path, opts) {
    const entry = this.lazy[path];
    if (!entry) {
      return this.getBuffer(path).then((b) => {
        if (!b) throw new Error('lazy asset not in manifest: ' + path);
        return b;
      });
    }
    const mem = this._lazyMem.get(path);
    if (mem) {
      this._lazyMem.delete(path); this._lazyMem.set(path, mem); // LRU: 使ったら新しい側へ
      this._lazyStats.memory++;
      return Promise.resolve(mem);
    }
    const pr = (opts && typeof opts.priority === 'number') ? opts.priority : 1;
    const pend = this._lazyPending[path];
    // 取りに行っている途中で manifest が変わった（sha が違う）仕事は使わない: 新しい仕事を作る（古い仕事は古い呼び出し側にだけ返る）
    if (pend && pend.entry.sha256 === entry.sha256) {
      if (pr < pend.priority && pend.queued) { pend.priority = pr; this._lazySort(); }
      return pend.promise;
    }
    const job = { path, entry, priority: pr, seq: this._lazySeq++, queued: true };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this._lazyPending[path] = job;
    this._lazyQueue.push(job);
    this._lazySort();
    this._lazyPump();
    return job.promise;
  }

  // lazy の状態（デバッグ・テスト用）
  lazyStats() {
    let bytes = 0;
    for (const k in this.lazy) bytes += this.lazy[k].size || 0;
    const s = this._lazyStats;
    return {
      entries: Object.keys(this.lazy).length, bytes,
      queued: this._lazyQueue.length, active: this._lazyActive, maxActive: s.maxActive,
      network: s.network, networkBytes: s.networkBytes, storage: s.storage, memory: s.memory,
      failed: s.failed, retries: s.retries, indexWrites: s.indexWrites,
      memEntries: this._lazyMem.size, memBytes: this._lazyMemUsed
    };
  }

  _lazySort() {
    this._lazyQueue.sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq));
  }

  _lazyPump() {
    while (this._lazyActive < this.lazyConcurrency && this._lazyQueue.length) {
      const job = this._lazyQueue.shift();
      job.queued = false;
      this._lazyActive++;
      if (this._lazyActive > this._lazyStats.maxActive) this._lazyStats.maxActive = this._lazyActive;
      // 片付けてから結果を返す（失敗を受け取った呼び出し側がすぐ頼み直しても、新しい仕事になる）
      const done = () => {
        this._lazyActive--;
        if (this._lazyPending[job.path] === job) delete this._lazyPending[job.path];
      };
      this._lazyRun(job).then((buf) => { done(); job.resolve(buf); }, (e) => { done(); this._lazyStats.failed++; job.reject(e); })
        .then(() => this._lazyPump());
    }
  }

  async _lazyRun(job) {
    const f = job.entry;
    const index = await this._lazyIndexLoad();
    // 端末にあって、保存した時の sha256 が manifest と同じ → そのまま読む（起動ごとにハッシュを計算しない）
    if (f.sha256 && index[f.path] === f.sha256) {
      const buf = await this._readBinary(f.path);
      if (buf) { this._lazyStats.storage++; return buf; }
    }
    if (!this.server) throw new Error('lazy asset unavailable (no server): ' + f.path);
    // URL は中身のハッシュで変わる（manifest のバージョンが上がっても中身が同じタイルは同じ URL = CDN のキャッシュが効く）
    const url = this.server + '/' + f.path + '?v=' + encodeURIComponent((f.sha256 || '').slice(0, 16) || (this.manifest && this.manifest.version) || '');
    let lastErr = null;
    for (let attempt = 0; attempt <= this.lazyRetries; attempt++) {
      if (attempt > 0) {
        this._lazyStats.retries++;
        await new Promise((r) => setTimeout(r, this.lazyRetryMs * Math.pow(2, attempt - 1)));
      }
      try {
        const buf = await this._fetchBuffer(url);
        if (f.sha256 && typeof crypto !== 'undefined' && crypto.subtle) {
          const hash = await AssetManager.sha256(buf);
          if (hash !== f.sha256) throw new Error('ハッシュ不一致: ' + f.path);
        }
        this._lazyStats.network++;
        this._lazyStats.networkBytes += buf.byteLength;
        this.downloadedBytes += buf.byteLength;
        await this._lazyStore(f, buf);
        return buf;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error('lazy asset failed: ' + f.path + ' (' + (lastErr && lastErr.message) + ')');
  }

  // 端末に保存して meta/lazy.json を更新。保存できない環境ではメモリ（LRU、lazyMemBytes まで）に持つ
  async _lazyStore(f, buf) {
    // manifest が変わって古くなった物は保存しない（新しい版の保存・索引を古い中身で上書きしない）
    if (!this._lazyCurrent(f)) return;
    let ok = false;
    try { await this.storage.writeBinary(f.path, buf); ok = await this._persisted(f.path); } catch (e) { ok = false; }
    if (ok) {
      const index = await this._lazyIndexLoad();
      if (!this._lazyCurrent(f)) return; // 書いている間に manifest が変わった: 索引に古い sha を書かない（次は不一致で取り直す）
      index[f.path] = f.sha256 || '';
      await this._lazyIndexSave();
      return;
    }
    this._lazyMemPut(f.path, buf);
  }

  _lazyCurrent(f) {
    const cur = this.lazy[f.path];
    return !!cur && cur.sha256 === f.sha256;
  }

  _lazyMemPut(path, buf) {
    const old = this._lazyMem.get(path);
    if (old) { this._lazyMemUsed -= old.byteLength; this._lazyMem.delete(path); }
    if (buf.byteLength > this.lazyMemBytes) return; // 1 つで上限を超える物は持たない（次もネットから）
    this._lazyMem.set(path, buf);
    this._lazyMemUsed += buf.byteLength;
    for (const [k, b] of this._lazyMem) {
      if (this._lazyMemUsed <= this.lazyMemBytes) break;
      this._lazyMem.delete(k);
      this._lazyMemUsed -= b.byteLength;
    }
  }

  _lazyIndexLoad() {
    if (!this._lazyIndex) {
      this._lazyIndex = this._readText('meta/lazy.json').then((t) => {
        let o = null;
        try { o = t ? JSON.parse(t) : null; } catch (e) { o = null; }
        return (o && typeof o === 'object') ? o : {};
      });
    }
    return this._lazyIndex;
  }

  // 書くのは 1 つずつ順番に（manifest に無い path・lazy でなくなった path は落とす = 版を重ねても索引が増え続けない）。保存の失敗は次の書き込みでまた試す
  _lazyIndexSave() {
    this._lazyIndexWrite = this._lazyIndexWrite.then(async () => {
      const index = await this._lazyIndexLoad();
      const out = {};
      for (const k of Object.keys(index)) if (this.files[k] && this.files[k].lazy) out[k] = index[k];
      this._lazyStats.indexWrites++;
      try { await this.storage.writeText('meta/lazy.json', JSON.stringify(out)); } catch (e) { /* 次でまた */ }
    });
    return this._lazyIndexWrite;
  }

  // ---------- 内部 ----------

  async _download(manifest, localManifest, report) {
    const localByPath = {};
    if (localManifest && Array.isArray(localManifest.files)) {
      for (const f of localManifest.files) localByPath[f.path] = f;
    }

    // 自分のティア向けのうち、ハッシュが同じで実体もあるファイルは飛ばす（差分ダウンロード）
    const wanted = this._select(manifest);
    const todo = [];
    // hostOnly: 端末の記録（meta/hostonly.json の sha256）と違う・実体が無い物だけ（大きいので読み直して確かめない）
    const hostOnlyRec = await this._hostOnlyRecord();
    for (const f of wanted) {
      const prev = localByPath[f.path];
      const same = prev && prev.sha256 && f.sha256 && prev.sha256 === f.sha256;
      if (same) {
        if (!(await this._storageHas(f.path))) todo.push(f); // ファイル実体が無ければ取り直す
      } else if (!(await this._storedMatches(f))) {
        todo.push(f); // 前回の途中まで保存できた分（ハッシュ一致）は飛ばす = 中断からの再開
      }
    }
    if (this._fullHost()) for (const f of await this._hostOnlyTodo(manifest, hostOnlyRec)) todo.push(Object.assign({ optional: true }, f)); // 最後に

    const totalBytes = todo.reduce((s, f) => s + (f.size || 0), 0);
    let doneBytes = 0;
    const tierLabel = ' (' + this.tier + ')';
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      const label = 'ダウンロード中 ' + (i + 1) + '/' + todo.length + '  ' + AssetManager.formatBytes(doneBytes) + ' / ' + AssetManager.formatBytes(totalBytes) + tierLabel;
      report(label, totalBytes ? doneBytes / totalBytes * 0.9 : (i / Math.max(1, todo.length)) * 0.9);

      let lastReport = 0;
      const onProgress = (received) => {
        // 大きなファイルの途中経過（0.2 秒に 1 回）
        const t = Date.now();
        if (t - lastReport < 200) return;
        lastReport = t;
        const part = doneBytes + Math.min(received, f.size || received);
        report('ダウンロード中 ' + (i + 1) + '/' + todo.length + '  ' + AssetManager.formatBytes(part) + ' / ' + AssetManager.formatBytes(totalBytes) + tierLabel, totalBytes ? part / totalBytes * 0.9 : 0);
      };
      let buf;
      try {
        buf = await this._fetchFile(f, manifest.version, onProgress);
      } catch (e) {
        if (!f.optional) throw e;
        console.warn('[Assets] 取れませんでした（無くても動きます）:', f.path, e && e.message);
        continue;
      }
      await this._writeBinary(f.path, buf);
      if (f.optional) { hostOnlyRec[f.path] = f.sha256 || ''; await this._writeText('meta/hostonly.json', JSON.stringify(hostOnlyRec)); }
      doneBytes += buf.byteLength;
    }
    this.downloadedBytes += doneBytes;

    // 全部揃ってから manifest と version を更新（途中で失敗したら古い状態のまま。保存できた分は次回の再開に使う）
    await this._writeText('meta/manifest.json', JSON.stringify(manifest));
    await this._writeText('meta/version.txt', manifest.version);
    report('保存完了 ' + AssetManager.formatBytes(doneBytes) + tierLabel, 0.92);
  }

  // manifest のうち自分のティア向けのものを読む。JSON は即デコード、バイナリは実体の有無だけ確認する（使う時に読む）
  //   lazy の物は端末に問い合わせない（タイルが数百あると起動ごとに数百回のネイティブ呼び出しになる）。this.lazy に覚えるだけ
  async _loadFromStorage(manifest) {
    const data = {};
    const stored = {};
    const files = {};
    const lazy = {};
    let total = 0;
    for (const f of manifest.files) {
      files[f.path] = f;
      const wanted = this._wanted(f);
      if (f.lazy) {
        if (wanted) lazy[f.path] = f;
        continue;
      }
      if (/\.json$/i.test(f.path)) {
        if (!wanted) continue;
        const buf = await this._readBinary(f.path);
        if (!buf) return false;
        try {
          data[f.path] = AssetManager.decode(f.path, buf);
        } catch (e) {
          console.warn('[Assets] デコード失敗:', f.path, e.message);
          return false;
        }
        stored[f.path] = true;
        total += f.size || buf.byteLength || 0;
        continue;
      }
      const present = await this._storageHas(f.path);
      if (present) stored[f.path] = true;
      if (!wanted) continue;
      total += f.size || 0;
      if (present) data[f.path] = null; // ストレージにある。getBuffer() で読む
      else console.warn('[Assets] ファイルが端末にありません（フォールバックで続行）:', f.path);
    }
    // hostOnly（全部を持つ配信先にだけあるファイル）: 端末にあれば使う。無ければ黙ってフォールバック（Pages だけの起動では来ない）
    const rec = await this._hostOnlyRecord();
    for (const f of this._selectHostOnly(manifest)) {
      if (files[f.path]) continue;
      files[f.path] = f;
      if (rec[f.path] !== (f.sha256 || '') || !(await this._storageHas(f.path))) continue; // 古い版の物は使わない（フォールバック）
      stored[f.path] = true;
      data[f.path] = null;
      total += f.size || 0;
    }
    this.data = data;
    this.stored = stored;
    this.files = files;
    this.lazy = lazy;
    this.totalBytes = total;
    return true;
  }

  _loadEmbedded() {
    const embedded = MR.DEFAULT_DATA || { version: 'embedded', files: {} };
    this.data = {};
    this.stored = {};
    this.files = {};
    this.lazy = {};
    this.totalBytes = 0;
    for (const path of Object.keys(embedded.files)) {
      // 内蔵データはオブジェクトのまま持っているので deep copy して渡す
      this.data[path] = JSON.parse(JSON.stringify(embedded.files[path]));
      this.files[path] = { path };
    }
    this.manifest = { version: embedded.version, files: Object.keys(embedded.files).map((p) => ({ path: p })) };
  }

  async _allStored(entries) {
    for (const f of entries) {
      if (!(await this._storageHas(f.path))) return false;
    }
    return true;
  }

  // storage.has が無い実装（テスト用スタブ等）でも動くように
  // 端末に保存できない環境（プライベートブラウズ等）では、このセッションの間だけメモリ（volatile）に持つ
  async _storageHas(key) {
    if (this.volatile[key] !== undefined) return true;
    const st = this.storage;
    try {
      if (typeof st.has === 'function') return !!(await st.has(key));
      if (typeof st.readBinary === 'function') return !!(await st.readBinary(key));
    } catch (e) { /* 読めない = 無い */ }
    return false;
  }

  async _writeBinary(key, buf) {
    try { await this.storage.writeBinary(key, buf); } catch (e) { console.warn('[Assets] 保存失敗:', key, e && e.message); }
    if (!(await this._persisted(key))) this.volatile[key] = buf;
  }

  async _writeText(key, text) {
    try { await this.storage.writeText(key, text); } catch (e) { console.warn('[Assets] 保存失敗:', key, e && e.message); }
    if (!(await this._persisted(key))) this.volatile[key] = text;
  }

  async _persisted(key) {
    const st = this.storage;
    try {
      if (typeof st.has === 'function') return !!(await st.has(key));
      if (typeof st.readText === 'function' && /\.(json|txt)$/i.test(key)) return (await st.readText(key)) != null;
      if (typeof st.readBinary === 'function') return !!(await st.readBinary(key));
    } catch (e) { /* 無い */ }
    return false;
  }

  // 端末にあるファイルの中身が manifest のハッシュと一致するか（中断したダウンロードの再開用）
  async _storedMatches(f) {
    if (!f.sha256) return false;
    if (!(await this._storageHas(f.path))) return false;
    if (typeof crypto === 'undefined' || !crypto.subtle) return true; // 検証できない環境では保存済みを信じる
    const buf = await this._readBinary(f.path);
    if (!buf) return false;
    try { return (await AssetManager.sha256(buf)) === f.sha256; } catch (e) { return false; }
  }

  async _readText(key) {
    if (typeof this.volatile[key] === 'string') return this.volatile[key];
    try {
      return typeof this.storage.readText === 'function' ? await this.storage.readText(key) : null;
    } catch (e) { return null; }
  }

  async _readBinary(key) {
    const v = this.volatile[key];
    if (v && typeof v !== 'string') return v;
    try {
      return typeof this.storage.readBinary === 'function' ? await this.storage.readBinary(key) : null;
    } catch (e) { return null; }
  }

  async _fetchJson(url) {
    const buf = await this._fetchBuffer(url);
    return JSON.parse(new TextDecoder().decode(buf));
  }

  // ---------- 配信先（hosts.json） ----------
  //
  // 起動の入り口（this.server = config.js の NATIVE_ASSET_SERVER か Web のページの assets/ = GitHub Pages）の hosts.json:
  //   { "v": 1, "hosts": [ { "id": "r2", "base": "https://assets.example.com/assets", "full": true, "timeoutMs": 8000, "maxFails": 2 },
  //                        { "id": "pages", "base": "https://nyachill.github.io/mirrsona-site/assets" } ] }
  //   上から順に manifest.json が取れた最初の配信先を使い（hostUsed）、ファイルは manifest の sha256 で確かめる。取れない・止まった・
  //   中身が違う（sha256 / 大きさ）ファイルは次の配信先から（失敗が maxFails 回でその配信先はこの起動ではもう使わない）。
  //   入り口はいつも最後の頼り（一覧に無ければ最後に足す）。full: true の配信先だけが manifest の hostOnly のファイルを持つ。
  //   ファイルが無い（404 など）= 一覧なし、壊れている・知らない v = 一覧なし（端末の写しも使わない）。つながらない（オフライン・
  //   入り口だけ落ちている）= 端末の写し（meta/hosts.json）。一覧なしは今まで通り（this.server だけ・同じ URL・同じ確かめ方）。
  //   hosts.json は manifest.json に入れない（CI の deploy-pages.yml が R2 に同期できたときだけ書く。古いアプリは読まない）
  static parseHosts(obj, bootstrap) {
    if (!obj || typeof obj !== 'object' || obj.v !== 1 || !Array.isArray(obj.hosts)) return null;
    const bootHttp = /^http:/i.test(bootstrap || '');
    const out = [];
    const seen = {};
    for (const h of obj.hosts.slice(0, 6)) {
      if (!h || typeof h !== 'object' || typeof h.base !== 'string') continue;
      const base = h.base.trim().replace(/\/+$/, '');
      // https だけ（入り口が http = 手元のテストのときだけ http も）。認証情報・クエリ・# は受けない
      if (!(/^https:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(base) || (bootHttp && /^http:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(base)))) continue;
      if (seen[base]) continue;
      seen[base] = true;
      const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : 0;
      out.push({
        id: (typeof h.id === 'string' && /^[A-Za-z0-9_.-]{1,24}$/.test(h.id)) ? h.id : 'h' + out.length,
        base,
        full: h.full === true,
        timeoutMs: num(h.timeoutMs, 2000, 60000),
        maxFails: Math.round(num(h.maxFails, 1, 10)) || 2,
        fails: 0, dead: false, bootstrap: base === bootstrap
      });
    }
    if (!out.length) return null;
    if (!out.some((h) => h.bootstrap)) out.push({ id: 'boot', base: bootstrap, full: false, timeoutMs: 0, maxFails: 2, fails: 0, dead: false, bootstrap: true });
    return out;
  }

  // hosts.json を読む。端末の写し（meta/hosts.json）が無いときは、入り口の manifest.json も同時に取りに行く（this._bootManifest）:
  //   一覧が無い（今の配信 = Pages だけ）なら待ち時間は今までと同じ・同じ URL の 1 回。写しがあるとき（R2 を使っている端末）は
  //   hosts.json を待ってから一覧の上から（入り口の manifest を毎回むだに取らない）。
  //   404 / 410 = 一覧を消した（R2 をやめた）→ 写しも消す。壊れている・知らない v → 一覧なし・写しも消す。
  //   つながらない・止まった・5xx（Pages の障害）→ 写しの一覧（入り口はいま答えなかったので、manifest は入り口を最後まで試さない）
  async _loadHosts() {
    this.hosts = null; this.hostsSource = 'none'; this.hostUsed = ''; this._bootManifest = null; this._bootDown = false;
    const cached = await this._readText('meta/hosts.json');
    if (!cached) {
      const p = this._fetchJson(this.server + '/manifest.json?t=' + Date.now());
      p.catch(() => {}); // 使わないこともある
      this._bootManifest = p;
    }
    let text = null, removed = false, down = false;
    try {
      text = new TextDecoder().decode(await this._fetchRaw(this.server + '/hosts.json?t=' + Date.now(), null, Math.min(this.timeoutMs, 4000)));
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (/^HTTP (404|410)\b/.test(msg)) removed = true; else down = true;
    }
    if (removed) { if (cached) await this._writeText('meta/hosts.json', ''); return; }
    if (down) {
      if (!cached) return;
      text = cached;
      this._bootDown = true;
    }
    let obj;
    try { obj = JSON.parse(text); } catch (e) { obj = null; }
    const list = AssetManager.parseHosts(obj, this.server);
    if (!list) {
      // 空の一覧 { v: 1, hosts: [] } はふつうの「一覧なし」（CI が R2 を使わないときに書く = 404 のエラーをコンソールに出さない）
      const empty = !!obj && obj.v === 1 && Array.isArray(obj.hosts) && obj.hosts.length === 0;
      if (!down) {
        if (!empty) { this.hostsSource = 'bad'; console.warn('[Assets] hosts.json が読めません（今まで通りの配信先を使います）'); }
        if (cached) await this._writeText('meta/hosts.json', '');
      }
      return;
    }
    this.hosts = list;
    this.hostsSource = down ? 'cache' : 'remote';
    if (!down && text !== cached) await this._writeText('meta/hosts.json', text);
  }

  // 一覧の上から manifest.json を取る。取れた配信先が以後の起点（hostUsed）。一覧なしは今まで通り this.server
  async _fetchManifest() {
    if (!this.hosts) {
      try {
        return await (this._bootManifest || this._fetchJson(this.server + '/manifest.json?t=' + Date.now()));
      } catch (e) {
        console.warn('[Assets] サーバーに接続できません:', e.message);
        return null;
      } finally { this._bootManifest = null; }
    }
    const boot = this._bootManifest;
    this._bootManifest = null;
    for (const h of this.hosts) {
      if (h.dead) continue;
      // 入り口が hosts.json に答えなかった（写しの一覧で動いている）: 入り口の manifest も待たない（止まった回線で待ち時間を足さない）
      if (h.bootstrap && this._bootDown) { h.dead = true; continue; }
      try {
        let m;
        if (h.bootstrap && boot) m = await boot; // 同時に取りに行っていた物
        else m = JSON.parse(new TextDecoder().decode(await this._fetchRaw(h.base + '/manifest.json?t=' + Date.now(), null, h.timeoutMs || this.timeoutMs)));
        if (!m || !Array.isArray(m.files)) throw new Error('manifest の形が違います');
        this.hostUsed = h.id;
        // 起点を先頭に（以後のファイル・街のデータはここから。だめなら一覧の順に次へ）
        this.hosts = [h].concat(this.hosts.filter((x) => x !== h));
        return m;
      } catch (e) {
        h.dead = true; // manifest が取れない配信先はこの起動のダウンロードでは使わない
        this._hostFail(h, e);
        console.warn('[Assets] 配信先 ' + h.id + ' に接続できません:', e && e.message);
      }
    }
    return null;
  }

  async _hostOnlyRecord() {
    try { const t = await this._readText('meta/hostonly.json'); const o = t ? JSON.parse(t) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }

  // manifest の hostOnly のうち、端末に今の sha256 の物が無いもの
  async _hostOnlyTodo(manifest, rec) {
    rec = rec || await this._hostOnlyRecord();
    const out = [];
    for (const f of this._selectHostOnly(manifest)) if (rec[f.path] !== (f.sha256 || '') || !(await this._storageHas(f.path))) out.push(f);
    return out;
  }

  // 起点の配信先が full（hostOnly のファイルを持つ）か
  _fullHost() {
    return !!(this.hosts && this.hostUsed && this.hosts[0] && this.hosts[0].id === this.hostUsed && this.hosts[0].full);
  }

  _hostFail(h, e) {
    h.fails++;
    if (h.fails >= h.maxFails) h.dead = true;
    const st = this.hostStats.byHost[h.id] || (this.hostStats.byHost[h.id] = { files: 0, bytes: 0, fails: 0 });
    st.fails++;
    st.lastError = String((e && e.message) || e).slice(0, 160);
  }

  _hostOk(h, bytes) {
    const st = this.hostStats.byHost[h.id] || (this.hostStats.byHost[h.id] = { files: 0, bytes: 0, fails: 0 });
    st.files++; st.bytes += bytes;
  }

  // manifest のファイル 1 つ。一覧なし = 今まで通り（this.server、crypto.subtle があれば sha256 を確かめる、違えば例外）。
  //   一覧あり = 起点から順に、取れない・大きさか sha256 が違えば次の配信先（hostOnly は full の配信先だけ）
  async _fetchFile(f, version, onProgress) {
    const rel = f.path + '?v=' + encodeURIComponent(version);
    const subtle = typeof crypto !== 'undefined' && crypto.subtle;
    if (!this.hosts) {
      const buf = await this._fetchRaw(this.server + '/' + rel, onProgress);
      if (f.sha256 && subtle) {
        const hash = await AssetManager.sha256(buf);
        if (hash !== f.sha256) throw new Error('ハッシュ不一致: ' + f.path);
      }
      return buf;
    }
    let lastErr = null;
    for (const h of this.hosts) {
      if (h.dead || (f.optional && !h.full)) continue;
      try {
        const buf = await this._fetchRaw(h.base + '/' + rel, onProgress, h.timeoutMs || this.timeoutMs);
        if (typeof f.size === 'number' && buf.byteLength !== f.size) throw new Error('大きさが違います: ' + f.path + ' (' + buf.byteLength + ' / ' + f.size + ')');
        if (f.sha256 && subtle) {
          const hash = await AssetManager.sha256(buf);
          if (hash !== f.sha256) throw new Error('ハッシュ不一致: ' + f.path);
        }
        this._hostOk(h, buf.byteLength);
        return buf;
      } catch (e) {
        lastErr = e;
        this._hostFail(h, e);
        this.hostStats.failovers++;
        console.warn('[Assets] ' + h.id + ' から取れません（次の配信先へ）:', e && e.message);
      }
    }
    throw lastErr || new Error('配信先がありません: ' + f.path);
  }

  // 入り口（this.server）の下の URL（街のデータ city/<level>/… を MR.CityBake が取る）を一覧の順に取る。
  //   名前に中身の SHA256 の頭 16 桁がある（far.<16 桁>.bin）なら確かめ、.json は JSON として読めることを確かめる（違えば次の配信先）。
  //   一覧なし・入り口の下ではない URL は今まで通り
  async _fetchBuffer(url, onProgress) {
    const pre = this.server ? this.server + '/' : '';
    if (!this.hosts || !pre || typeof url !== 'string' || url.indexOf(pre) !== 0) return this._fetchRaw(url, onProgress);
    const rel = url.slice(pre.length);
    const name = rel.split('?')[0];
    const m = /\.([0-9a-f]{16})\.[A-Za-z0-9]+$/.exec(name);
    const subtle = typeof crypto !== 'undefined' && crypto.subtle;
    // 起動の後（街のデータ）に全部の配信先が使えなくなっていたら（オフラインで起動した等）、もう一度だけ全部を試す
    if (this.hosts.every((h) => h.dead)) for (const h of this.hosts) { h.dead = false; h.fails = 0; }
    // index.json（どのファイルを使うかを決める物）は入り口（Pages）を先に: R2 が遅れていても古い index で端末の far.bin を消さない。
    //   中身の名前の物（far.<sha16>.bin）は起点（R2）から
    let order = this.hosts;
    if (!m) order = this.hosts.filter((h) => h.bootstrap).concat(this.hosts.filter((h) => !h.bootstrap));
    let lastErr = null;
    for (const h of order) {
      if (h.dead) continue;
      try {
        const buf = await this._fetchRaw(h.base + '/' + rel, onProgress, h.timeoutMs || this.timeoutMs);
        if (m && subtle && (await AssetManager.sha256(buf)).slice(0, 16) !== m[1]) throw new Error('ハッシュ不一致: ' + name);
        if (/\.json$/i.test(name)) JSON.parse(new TextDecoder().decode(buf));
        this._hostOk(h, buf.byteLength);
        return buf;
      } catch (e) {
        lastErr = e; // 最後の配信先（入り口）のエラーを返す: CityBake は HTTP の 404 を「街のデータなし」、つながらないを「オフライン」と扱う
        // 404 は配信先が生きている（その版の街のデータがまだ無いだけ）ので失敗に数えない（数えると R2 が manifest のファイルにも使われなくなる）
        if (!/^HTTP 404\b/.test(String((e && e.message) || ''))) this._hostFail(h, e);
        this.hostStats.failovers++;
        console.warn('[Assets] ' + h.id + ' から取れません（次の配信先へ）:', e && e.message);
      }
    }
    throw lastErr || new Error('配信先がありません: ' + rel);
  }

  // timeoutMs は「応答が来るまで」と「本文が止まったまま」の上限。本文はチャンクごとにタイマーをかけ直すので、
  // 大きなファイルでも回線が生きている限り切れない。onProgress(受信バイト, 全体バイト) で進捗を返す
  async _fetchRaw(url, onProgress, timeoutMs) {
    const limit = timeoutMs || this.timeoutMs;
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    const arm = () => {
      if (!controller) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), limit);
    };
    arm();
    try {
      const res = await fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const total = Number(res.headers && res.headers.get && res.headers.get('content-length')) || 0;
        const chunks = [];
        let received = 0;
        for (;;) {
          arm();
          const r = await reader.read();
          if (r.done) break;
          chunks.push(r.value);
          received += r.value.byteLength;
          if (onProgress) onProgress(received, total);
        }
        if (chunks.length === 1) return chunks[0].buffer.byteLength === received ? chunks[0].buffer : chunks[0].slice().buffer;
        const out = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.byteLength; }
        return out.buffer;
      }
      arm();
      return await res.arrayBuffer();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  static decode(path, buf) {
    if (/\.json$/i.test(path)) return JSON.parse(new TextDecoder().decode(buf));
    return buf;
  }

  static mimeFor(path) {
    if (/\.png$/i.test(path)) return 'image/png';
    if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
    if (/\.webp$/i.test(path)) return 'image/webp';
    if (/\.mp3$/i.test(path)) return 'audio/mpeg';
    if (/\.ogg$/i.test(path)) return 'audio/ogg';
    if (/\.wav$/i.test(path)) return 'audio/wav';
    if (/\.glb$/i.test(path)) return 'model/gltf-binary';
    return 'application/octet-stream';
  }

  static async sha256(buf) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  static formatBytes(n) {
    n = n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
};
