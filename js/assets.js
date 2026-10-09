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

  _select(manifest) {
    const files = (manifest && Array.isArray(manifest.files)) ? manifest.files : [];
    return files.filter((f) => this._wanted(f));
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
      try {
        remoteManifest = await this._fetchJson(this.server + '/manifest.json?t=' + Date.now());
      } catch (e) {
        console.warn('[Assets] サーバーに接続できません:', e.message);
      }
    }

    if (remoteManifest && Array.isArray(remoteManifest.files)) {
      // バージョンが違えば差分ダウンロード。同じでも自分のティアのファイルが端末に無ければ（ティア切替）取りに行く
      let need = !localManifest || remoteManifest.version !== localVersion;
      if (!need) need = !(await this._allStored(this._select(remoteManifest)));
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

  _result(version) {
    return { source: this.source, version, tier: this.tier, totalBytes: this.totalBytes, downloadedBytes: this.downloadedBytes };
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
    return Object.keys(set).sort();
  }

  // バイナリの生データ。メモリに無ければ端末ストレージから読む。無ければ null
  async getBuffer(path) {
    const v = this.data[path];
    if (v && typeof v.byteLength === 'number') return v;
    if (v) return null; // JSON
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
    for (const k in this._modelLoaded) {
      const g = this._modelLoaded[k];
      if (!g || !g.scene) continue;
      g.scene.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) for (const s of AssetManager.TEXTURE_SLOTS) drop(m[s]);
      });
    }
    return n;
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

  // 保存データを消して次回起動時に再ダウンロードさせる
  async reset() {
    if (this.storage.clearAll) await this.storage.clearAll();
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
    for (const f of wanted) {
      const prev = localByPath[f.path];
      const same = prev && prev.sha256 && f.sha256 && prev.sha256 === f.sha256;
      if (same) {
        if (!(await this._storageHas(f.path))) todo.push(f); // ファイル実体が無ければ取り直す
      } else if (!(await this._storedMatches(f))) {
        todo.push(f); // 前回の途中まで保存できた分（ハッシュ一致）は飛ばす = 中断からの再開
      }
    }

    const totalBytes = todo.reduce((s, f) => s + (f.size || 0), 0);
    let doneBytes = 0;
    const tierLabel = ' (' + this.tier + ')';
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      const label = 'ダウンロード中 ' + (i + 1) + '/' + todo.length + '  ' + AssetManager.formatBytes(doneBytes) + ' / ' + AssetManager.formatBytes(totalBytes) + tierLabel;
      report(label, totalBytes ? doneBytes / totalBytes * 0.9 : (i / Math.max(1, todo.length)) * 0.9);

      const url = this.server + '/' + f.path + '?v=' + encodeURIComponent(manifest.version);
      let lastReport = 0;
      const buf = await this._fetchBuffer(url, (received) => {
        // 大きなファイルの途中経過（0.2 秒に 1 回）
        const t = Date.now();
        if (t - lastReport < 200) return;
        lastReport = t;
        const part = doneBytes + Math.min(received, f.size || received);
        report('ダウンロード中 ' + (i + 1) + '/' + todo.length + '  ' + AssetManager.formatBytes(part) + ' / ' + AssetManager.formatBytes(totalBytes) + tierLabel, totalBytes ? part / totalBytes * 0.9 : 0);
      });
      if (f.sha256 && typeof crypto !== 'undefined' && crypto.subtle) {
        const hash = await AssetManager.sha256(buf);
        if (hash !== f.sha256) throw new Error('ハッシュ不一致: ' + f.path);
      }
      await this._writeBinary(f.path, buf);
      doneBytes += buf.byteLength;
    }
    this.downloadedBytes += doneBytes;

    // 全部揃ってから manifest と version を更新（途中で失敗したら古い状態のまま。保存できた分は次回の再開に使う）
    await this._writeText('meta/manifest.json', JSON.stringify(manifest));
    await this._writeText('meta/version.txt', manifest.version);
    report('保存完了 ' + AssetManager.formatBytes(doneBytes) + tierLabel, 0.92);
  }

  // manifest のうち自分のティア向けのものを読む。JSON は即デコード、バイナリは実体の有無だけ確認する（使う時に読む）
  async _loadFromStorage(manifest) {
    const data = {};
    const stored = {};
    const files = {};
    let total = 0;
    for (const f of manifest.files) {
      files[f.path] = f;
      const wanted = this._wanted(f);
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
    this.data = data;
    this.stored = stored;
    this.files = files;
    this.totalBytes = total;
    return true;
  }

  _loadEmbedded() {
    const embedded = MR.DEFAULT_DATA || { version: 'embedded', files: {} };
    this.data = {};
    this.stored = {};
    this.files = {};
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

  // timeoutMs は「応答が来るまで」と「本文が止まったまま」の上限。本文はチャンクごとにタイマーをかけ直すので、
  // 大きなファイルでも回線が生きている限り切れない。onProgress(受信バイト, 全体バイト) で進捗を返す
  async _fetchBuffer(url, onProgress) {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    const arm = () => {
      if (!controller) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
