// 端末にダウンロードしたゲームデータを保存する層。
//   ネイティブ（iOS アプリ）: Capacitor Filesystem（アプリの Data ディレクトリ）
//   Web（Safari / GitHub Pages）: IndexedDB
// どちらも同じ API で使えるようにしてある。
//   opts.dir（呼び出しごと）: 'CACHE' = 消えてもよいデータ（前もって作った街の形 city/…。iOS: Library/Caches = iCloud に入らない・
//   端末が容量のために消すことがある。IndexedDB: キーの頭に cache/）。省略は今まで通り 'DATA'（ゲームデータ。iOS の Data）。
//   dir を付けた書き込みは保存できない環境（IndexedDB が開けない）で例外にする（CityBake がダウンロードを止める）。
//   list(prefix, opts): そのディレクトリの直下の名前（ファイルとディレクトリ）。rename(from, to, opts)・removeTree(prefix, opts)
window.MR = window.MR || {};

MR.Storage = class Storage {
  constructor() {
    const cap = window.Capacitor;
    this.native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    this.fs = null;
    this.db = null;
    this.root = 'gamedata';
  }

  async init() {
    if (this.native) {
      const cap = window.Capacitor;
      this.fs = typeof cap.registerPlugin === 'function'
        ? cap.registerPlugin('Filesystem')
        : (cap.Plugins && cap.Plugins.Filesystem);
      if (!this.fs) {
        console.warn('[Storage] Filesystem プラグインが見つかりません。IndexedDB にフォールバックします');
        this.native = false;
      } else {
        await this._mkdir(this.root);
        return;
      }
    }
    try {
      this.db = await this._openDb();
    } catch (e) {
      console.warn('[Storage] IndexedDB が使えません。保存なしで続行します:', e && e.message);
      this.db = null;
    }
  }

  // ---------- 公開 API ----------

  async readText(key, opts) {
    if (this.native) {
      try {
        const res = await this.fs.readFile({ path: this._path(key), directory: this._dir(opts), encoding: 'utf8' });
        return typeof res.data === 'string' ? res.data : await this._blobToText(res.data);
      } catch (e) {
        return null;
      }
    }
    const rec = await this._idbGet(this._k(key, opts));
    if (!rec) return null;
    if (typeof rec.text === 'string') return rec.text;
    if (rec.buf) return new TextDecoder().decode(rec.buf);
    return null;
  }

  async writeText(key, text, opts) {
    if (this.native) {
      await this._ensureParent(key, opts);
      await this.fs.writeFile({ path: this._path(key), directory: this._dir(opts), data: text, encoding: 'utf8', recursive: true });
      return;
    }
    if (opts && opts.dir && !this.db) throw new Error('no storage');
    await this._idbPut(this._k(key, opts), { text });
  }

  async readBinary(key, opts) {
    if (this.native) {
      try {
        const res = await this.fs.readFile({ path: this._path(key), directory: this._dir(opts) });
        if (typeof res.data === 'string') return MR.Storage.base64ToBuffer(res.data);
        return await res.data.arrayBuffer();
      } catch (e) {
        return null;
      }
    }
    const rec = await this._idbGet(this._k(key, opts));
    if (!rec) return null;
    if (rec.buf) return rec.buf;
    if (typeof rec.text === 'string') return new TextEncoder().encode(rec.text).buffer;
    return null;
  }

  async writeBinary(key, arrayBuffer, opts) {
    if (this.native) {
      await this._ensureParent(key, opts);
      await this.fs.writeFile({
        path: this._path(key),
        directory: this._dir(opts),
        data: MR.Storage.bufferToBase64(arrayBuffer),
        recursive: true
      });
      return;
    }
    if (opts && opts.dir && !this.db) throw new Error('no storage');
    await this._idbPut(this._k(key, opts), { buf: arrayBuffer });
  }

  // prefix（'city/midtown/' のようにディレクトリ。最後の / は無くてもよい）の直下の名前の一覧（ファイルとディレクトリ。無ければ []）
  async list(prefix, opts) {
    const dir = String(prefix || '').replace(/\/+$/, '');
    if (this.native) {
      try {
        const res = await this.fs.readdir({ path: this._path(dir), directory: this._dir(opts) });
        return (res.files || []).map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean);
      } catch (e) {
        return [];
      }
    }
    if (!this.db) return [];
    const base = this._k(dir ? dir + '/' : '', opts);
    const keys = await new Promise((resolve, reject) => {
      const store = this.db.transaction('files', 'readonly').objectStore('files');
      const range = IDBKeyRange.bound(base, base + '\uffff');
      if (typeof store.getAllKeys === 'function') {
        const req = store.getAllKeys(range);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
        return;
      }
      const out = [], req = store.openCursor(range);
      req.onsuccess = () => { const c = req.result; if (c) { out.push(c.key); c.continue(); } else resolve(out); };
      req.onerror = () => reject(req.error);
    });
    const names = new Set();
    for (const k of keys) { const rest = String(k).slice(base.length); if (rest) names.add(rest.split('/')[0]); }
    return Array.from(names);
  }

  // 名前を変える（ネイティブ: 同じディレクトリの中で。iOS の移動は原子的 = 書いている途中で落ちても to は前の中身か新しい中身）
  async rename(from, to, opts) {
    if (this.native) {
      try { await this.fs.deleteFile({ path: this._path(to), directory: this._dir(opts) }); } catch (e) { /* 無ければよい */ }
      await this.fs.rename({ from: this._path(from), to: this._path(to), directory: this._dir(opts), toDirectory: this._dir(opts) });
      return;
    }
    const rec = await this._idbGet(this._k(from, opts));
    if (!rec) throw new Error('rename: no ' + from);
    await this._idbPut(this._k(to, opts), rec);
    await this._idbDelete(this._k(from, opts));
  }

  // prefix のディレクトリをまるごと消す（無ければ何もしない）
  async removeTree(prefix, opts) {
    const dir = String(prefix || '').replace(/\/+$/, '');
    if (this.native) {
      try { await this.fs.rmdir({ path: this._path(dir), directory: this._dir(opts), recursive: true }); } catch (e) { /* 無ければよい */ }
      return;
    }
    if (!this.db) return;
    const base = this._k(dir ? dir + '/' : '', opts);
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(IDBKeyRange.bound(base, base + '\uffff'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ファイルが保存されているか（中身は読まない。ティア切替時の有無チェック用）
  async has(key) {
    if (this.native) {
      try {
        await this.fs.stat({ path: this._path(key), directory: 'DATA' });
        return true;
      } catch (e) {
        return false;
      }
    }
    if (!this.db) return false;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const req = typeof store.getKey === 'function' ? store.getKey(key) : store.get(key);
      req.onsuccess = () => resolve(req.result !== undefined && req.result !== null);
      req.onerror = () => reject(req.error);
    });
  }

  async remove(key, opts) {
    if (this.native) {
      try { await this.fs.deleteFile({ path: this._path(key), directory: this._dir(opts) }); } catch (e) { /* 無ければ無視 */ }
      return;
    }
    await this._idbDelete(this._k(key, opts));
  }

  // 保存済みデータを全部消す（デバッグ／再ダウンロード用）
  async clearAll() {
    if (this.native) {
      try { await this.fs.rmdir({ path: this.root, directory: 'DATA', recursive: true }); } catch (e) { /* ignore */ }
      await this._mkdir(this.root);
      return;
    }
    if (!this.db) return;
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- ネイティブ用ヘルパ ----------

  _path(key) {
    return key ? this.root + '/' + key : this.root;
  }
  // Capacitor の Directory（'DATA' = 今まで通り。'CACHE' = Library/Caches）
  _dir(opts) { return opts && opts.dir === 'CACHE' ? 'CACHE' : 'DATA'; }
  // IndexedDB のキー（CACHE は頭に cache/）
  _k(key, opts) { return opts && opts.dir === 'CACHE' ? 'cache/' + key : key; }

  async _mkdir(path, opts) {
    try {
      await this.fs.mkdir({ path, directory: this._dir(opts), recursive: true });
    } catch (e) {
      // 既に存在する場合はエラーになるので無視
    }
  }

  async _ensureParent(key, opts) {
    const idx = key.lastIndexOf('/');
    if (idx > 0) await this._mkdir(this._path(key.slice(0, idx)), opts);
  }

  async _blobToText(blob) {
    return await blob.text();
  }

  // ---------- IndexedDB 用ヘルパ ----------

  _openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB undefined')); return; }
      const req = indexedDB.open('mirrsona', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _idbGet(key) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  _idbPut(key, value) {
    if (!this.db) return Promise.resolve(); // 保存できない環境（プライベートブラウズ等）では黙って諦める
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readwrite');
      tx.objectStore('files').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  _idbDelete(key) {
    if (!this.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- base64 ----------

  static bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  static base64ToBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
};
