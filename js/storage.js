// 端末にダウンロードしたゲームデータを保存する層。
//   ネイティブ（iOS アプリ）: Capacitor Filesystem（アプリの Data ディレクトリ）
//   Web（Safari / GitHub Pages）: IndexedDB
// どちらも同じ API で使えるようにしてある。
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

  async readText(key) {
    if (this.native) {
      try {
        const res = await this.fs.readFile({ path: this._path(key), directory: 'DATA', encoding: 'utf8' });
        return typeof res.data === 'string' ? res.data : await this._blobToText(res.data);
      } catch (e) {
        return null;
      }
    }
    const rec = await this._idbGet(key);
    if (!rec) return null;
    if (typeof rec.text === 'string') return rec.text;
    if (rec.buf) return new TextDecoder().decode(rec.buf);
    return null;
  }

  async writeText(key, text) {
    if (this.native) {
      await this._ensureParent(key);
      await this.fs.writeFile({ path: this._path(key), directory: 'DATA', data: text, encoding: 'utf8', recursive: true });
      return;
    }
    await this._idbPut(key, { text });
  }

  async readBinary(key) {
    if (this.native) {
      try {
        const res = await this.fs.readFile({ path: this._path(key), directory: 'DATA' });
        if (typeof res.data === 'string') return MR.Storage.base64ToBuffer(res.data);
        return await res.data.arrayBuffer();
      } catch (e) {
        return null;
      }
    }
    const rec = await this._idbGet(key);
    if (!rec) return null;
    if (rec.buf) return rec.buf;
    if (typeof rec.text === 'string') return new TextEncoder().encode(rec.text).buffer;
    return null;
  }

  async writeBinary(key, arrayBuffer) {
    if (this.native) {
      await this._ensureParent(key);
      await this.fs.writeFile({
        path: this._path(key),
        directory: 'DATA',
        data: MR.Storage.bufferToBase64(arrayBuffer),
        recursive: true
      });
      return;
    }
    await this._idbPut(key, { buf: arrayBuffer });
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

  async remove(key) {
    if (this.native) {
      try { await this.fs.deleteFile({ path: this._path(key), directory: 'DATA' }); } catch (e) { /* 無ければ無視 */ }
      return;
    }
    await this._idbDelete(key);
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
    return this.root + '/' + key;
  }

  async _mkdir(path) {
    try {
      await this.fs.mkdir({ path, directory: 'DATA', recursive: true });
    } catch (e) {
      // 既に存在する場合はエラーになるので無視
    }
  }

  async _ensureParent(key) {
    const idx = key.lastIndexOf('/');
    if (idx > 0) await this._mkdir(this._path(key.slice(0, idx)));
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
