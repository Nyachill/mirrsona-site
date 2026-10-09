// 落ちている物（戦利品）と持ち物。THREE にも DOM にも依存しない（フェーズ D でサーバーも require する）。
//   ブラウザ: <script> で読む → MR.Loot      Node: require('../www/js/loot.js') → Loot（globalThis.MR.Loot にも入る）
//
// ■ 物の種類（Loot.ITEMS）: 武器 pistol / p90 / rifle / shotgun / lmg / sniper、弾 ammo_9mm / ammo_57 / ammo_556 / ammo_12g / ammo_338、
//   回復 medkit / bandage、防具 armor_vest / helmet。数（弾の箱の数・回復量・上限・耐久）は game.json の loot。
//
// ■ 地図の物の id は citygen の lootSpawns の id（"cx_cz_n"）。種類は Loot.choose(id, table, tables, seed) が id のハッシュと
//   ワールドプランの表（midtown.json loot.tables の [種類, 重み]）から整数だけで決める（どの端末でもサーバーでも同じ）。
//   落とした物（敵・自分が落とした武器・弾）の id は "d<n>"（オンラインのサーバーが落とした物は "s<n>"。opts.dropPrefix）。
//
// ■ 状態を変えるのは World の 4 つだけ（フェーズ D はここをサーバー経由にする）:
//   take(id, by, n)   拾う（n = 数。弾の箱は上限まで取って残りは置いたまま。省略で全部）→ 取れた数
//   drop(spec, pos)   落とす → 新しい id
//   isTaken(id)       もう無いか
//   onChange(fn)      変わったら fn({ op: 'take' | 'drop' | 'respawn' | 'expire', id, item, by, n })
//   update(t)         ソロ: 取られた地図の物は respawnSec 秒後に戻る（0 = 戻らない）。落とした物は dropLifetime 秒で消える
//   状態は id ごとに持つので、チャンクが当たり判定から外れても（キャッシュから消えても）取った物は取ったまま。
//
// ■ 持ち物（Inventory）: 枠 3 つ（0 = メイン 1、1 = メイン 2、2 = サブ（ピストル））。枠は { id, ammo（装填数）} か null。
//   弾は口径ごと（ammo[cal]、上限 calibres[cal].cap）。回復 meds.medkit / bandage（上限 meds[type].cap）。
//   防具 vest / helmet = { dur, max } か null（ダメージを reduce の割合だけ肩代わりし、肩代わりした分だけ耐久が減る）。
(function (root) {
  const MR = root.MR || (root.MR = {});

  // ---------- 決定的なハッシュ（整数だけ。citygen と同じ混ぜ方）----------
  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16; return h >>> 0;
  }
  function strHash(s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  // id（文字列）+ seed（整数）+ salt（用途）→ 32 bit
  function idHash(id, seed, salt) { return fmix((strHash(id) ^ fmix((seed | 0) + 0x9e3779b9)) + Math.imul(salt | 0, 0x27d4eb2d)); }

  const ITEMS = {
    pistol: { kind: 'weapon' }, p90: { kind: 'weapon' }, rifle: { kind: 'weapon' }, shotgun: { kind: 'weapon' }, lmg: { kind: 'weapon' }, sniper: { kind: 'weapon' },
    ammo_9mm: { kind: 'ammo', cal: '9mm' }, ammo_57: { kind: 'ammo', cal: '57' }, ammo_556: { kind: 'ammo', cal: '556' },
    ammo_12g: { kind: 'ammo', cal: '12g' }, ammo_338: { kind: 'ammo', cal: '338' },
    medkit: { kind: 'med', name: '救急キット' }, bandage: { kind: 'med', name: '包帯' },
    armor_vest: { kind: 'armor', slot: 'vest', name: '防弾ベスト' }, helmet: { kind: 'armor', slot: 'helmet', name: 'ヘルメット' }
  };

  // 設定の既定値（game.json の loot が無いキー）
  const DEFAULTS = {
    start: { weapons: ['pistol'], ammo: { '9mm': 30 }, meds: {} },
    calibres: {
      '9mm': { name: '9mm', cap: 150, box: 30, color: '#e9c22a' },
      '57': { name: '5.7mm', cap: 250, box: 50, color: '#1fb7cc' },
      '556': { name: '5.56', cap: 240, box: 40, color: '#5cc23a' },
      '12g': { name: '12ga', cap: 40, box: 10, color: '#d8382a' },
      '338': { name: '.338', cap: 30, box: 8, color: '#9152d8' }
    },
    weaponCalibre: { p90: '57', rifle: '556', lmg: '556', shotgun: '12g', sniper: '338', pistol: '9mm' },
    sidearms: ['pistol'],
    weaponLoaded: 1,
    meds: { medkit: { heal: 75, time: 4, cap: 3 }, bandage: { heal: 20, time: 2, cap: 8 } },
    armor: { vest: { reduce: 0.3, durability: 100 }, helmet: { reduce: 0.4, durability: 80 }, headChance: 0.15, enemyHeadMult: 1.5 },
    respawnSec: 150, dropLifetime: 300
  };

  function merge(base, over) {
    const out = Object.assign({}, base);
    if (!over) return out;
    for (const k of Object.keys(over)) {
      const v = over[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? merge(base[k], v) : v;
    }
    return out;
  }

  const Loot = {
    ITEMS,
    DEFAULTS,
    hash: idHash,
    config(cfg) { return merge(DEFAULTS, cfg || {}); },
    kindOf(type) { return (ITEMS[type] && ITEMS[type].kind) || null; },
    calOf(cfg, weaponId) { return (cfg.weaponCalibre || {})[weaponId] || null; },
    ammoType(cal) { return 'ammo_' + cal; },
    isSidearm(cfg, weaponId) { return (cfg.sidearms || ['pistol']).indexOf(weaponId) >= 0; },

    // 地図の物の種類: 表 tables[table] = [[種類, 重み]…] から id のハッシュで 1 つ（重みは 1/1000 単位の整数にして足す）
    choose(id, table, tables, seed) {
      const list = (tables && (tables[table] || tables.interior)) || [];
      if (!list.length) return 'bandage';
      let sum = 0;
      const w = [];
      for (const p of list) { const k = Math.max(0, Math.round((+p[1] || 0) * 1000)); w.push(k); sum += k; }
      if (sum <= 0) return list[0][0];
      let t = idHash(id, seed, 1) % sum;
      for (let i = 0; i < list.length; i++) { t -= w[i]; if (t < 0) return list[i][0]; }
      return list[list.length - 1][0];
    },

    // 地図の物の向き（0..2π）。見た目だけ（武器を寝かせる向き）
    yawOf(id, seed) { return (idHash(id, seed, 2) % 3600) / 3600 * Math.PI * 2; },

    // 新品の中身: 弾の箱の数、武器の装填数、防具の耐久
    fill(cfg, type, weaponDefs) {
      const it = ITEMS[type] || {};
      const item = { type, qty: 1 };
      if (it.kind === 'ammo') item.qty = ((cfg.calibres || {})[it.cal] || {}).box || 30;
      else if (it.kind === 'weapon') {
        const d = weaponDefs && weaponDefs[type];
        item.ammo = d ? Math.round((d.magazineSize || 0) * (cfg.weaponLoaded == null ? 1 : cfg.weaponLoaded)) : 0;
      } else if (it.kind === 'armor') item.dur = ((cfg.armor || {})[it.slot] || {}).durability || 100;
      return item;
    }
  };

  // ==================================================================================================================
  // 落ちている物の状態（地図の物 + 落とした物）
  // ==================================================================================================================
  class World {
    // city: MR.CityGen（lootSpawns / chunkOf / plan）、cfg: Loot.config(game.json の loot)、opts: { weaponDefs: { id: def }, seed, dropPrefix }
    constructor(city, cfg, opts) {
      opts = opts || {};
      this.city = city;
      this.cfg = cfg || Loot.config();
      this.plan = city.plan || {};
      this.tables = (this.plan.loot && this.plan.loot.tables) || {};
      this.seed = opts.seed != null ? opts.seed : (this.plan.seed | 0);
      this.weaponDefs = opts.weaponDefs || {};
      this.chunkSize = this.plan.chunkSize || 128;
      // 地図の物は持ち主のチャンク（id の cx_cz）の外へはみ出すことがある（建物の区画はチャンクをまたぐ。citygen の maxOverhang の約束。
      // 実測で約 9 % の物が最大 約 33 m 外）。query は位置の周りのこの幅のチャンクも見る（見なかった頃は境目の近くの武器が拾えなかった）
      this.reach = city.maxOverhang != null ? city.maxOverhang : (this.plan.maxOverhang || 64);
      this._chunks = new Map();    // "cx_cz" → [地図の物]（キャッシュ。消えても state から作り直す）
      this._order = [];            // キャッシュの古い順
      this.cacheCap = opts.cacheCap || 96;
      this.state = new Map();      // 地図の物の id → { gone, at, qty?, ammo?, dur? }（変わった物だけ）
      this.drops = new Map();      // 落とした物の id → 物
      this._dropChunks = new Map(); // "cx_cz" → Set(id)
      this._dropSeq = 0;
      this.dropPrefix = opts.dropPrefix || 'd'; // 落とした物の id の頭（サーバーは 's'。クライアントの 'd' と混ざらない）
      this._cbs = [];
      this.version = 0;            // 何か変わるたびに増える（描画の作り直しの合図）
      this.time = 0;
      this._respawnTimer = 0;
      this.stats = { taken: 0, dropped: 0, respawned: 0, expired: 0, chunks: 0 };
    }

    onChange(fn) { if (typeof fn === 'function') this._cbs.push(fn); return () => { const i = this._cbs.indexOf(fn); if (i >= 0) this._cbs.splice(i, 1); }; }
    _emit(ev) { this.version++; for (const fn of this._cbs) { try { fn(ev); } catch (e) { /* 表示側の失敗で状態は止めない */ } } }

    // チャンクの地図の物（lootSpawns → 種類 → 中身。状態を当てる）
    mapItems(cx, cz) {
      const key = cx + '_' + cz;
      let list = this._chunks.get(key);
      if (list) return list;
      if (cx < 0 || cz < 0 || cx >= (this.city.ncx || 47) || cz >= (this.city.ncz || 47)) return [];
      const spawns = this.city.lootSpawns(cx, cz) || [];
      list = [];
      for (const s of spawns) {
        const type = Loot.choose(s.id, s.table, this.tables, this.seed);
        const it = Loot.fill(this.cfg, type, this.weaponDefs);
        const item = { id: s.id, type, x: s.x, y: s.y, z: s.z, qty: it.qty, ammo: it.ammo, dur: it.dur, yaw: Loot.yawOf(s.id, this.seed), table: s.table, map: true, gone: false };
        item.qty0 = item.qty; item.ammo0 = item.ammo; item.dur0 = item.dur;
        this._applyState(item);
        list.push(item);
      }
      // 物の外接矩形（query がはみ出し分の隣のチャンクを素早く飛ばす）
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const it of list) { if (it.x < x0) x0 = it.x; if (it.x > x1) x1 = it.x; if (it.z < z0) z0 = it.z; if (it.z > z1) z1 = it.z; }
      list.bb = [x0, z0, x1, z1];
      this._chunks.set(key, list);
      this._order.push(key);
      this.stats.chunks++;
      while (this._order.length > this.cacheCap) this._chunks.delete(this._order.shift());
      return list;
    }

    _applyState(item) {
      const s = this.state.get(item.id);
      if (!s) { item.gone = false; item.qty = item.qty0; item.ammo = item.ammo0; item.dur = item.dur0; return; }
      item.gone = !!s.gone;
      if (s.qty != null) item.qty = s.qty;
      if (s.ammo != null) item.ammo = s.ammo;
      if (s.dur != null) item.dur = s.dur;
    }

    _chunkOf(x, z) {
      const c = this.city.chunkOf(x, z);
      return c;
    }

    // id の物（地図の物は持ち主のチャンクを作る）。無ければ null
    get(id) {
      if (typeof id !== 'string') return null;
      if (this.drops.has(id)) return this.drops.get(id);
      const m = /^(\d+)_(\d+)_\d+$/.exec(id);
      if (!m) return null;
      const list = this.mapItems(+m[1], +m[2]);
      for (const it of list) if (it.id === id) return it;
      return null;
    }

    isTaken(id) {
      if (this.drops.has(id)) return false;
      const s = this.state.get(id);
      if (s) return !!s.gone;
      return !this.get(id);
    }

    // (x, z) から水平 r m 以内の、まだある物（y を指定すると |y − 物の y| ≤ dy だけ）。out に足して返す。
    // 地図の物は持ち主のチャンクの外へ reach m まではみ出すので、その幅の隣のチャンクも見る（外接矩形が届かなければ飛ばす）。
    // 落とした物は位置のチャンクに入れてあるので、範囲のチャンクだけ
    query(x, z, r, out, y, dy) {
      out = out || [];
      const S = this.chunkSize, b = this.city.plan && this.city.plan.bounds ? this.city.plan.bounds : { minX: -2900, minZ: -3000 };
      const minX = b.minX, minZ = b.minZ, M = this.reach;
      const cx0 = Math.floor((x - r - minX) / S), cx1 = Math.floor((x + r - minX) / S);
      const cz0 = Math.floor((z - r - minZ) / S), cz1 = Math.floor((z + r - minZ) / S);
      const ox0 = Math.floor((x - r - M - minX) / S), ox1 = Math.floor((x + r + M - minX) / S);
      const oz0 = Math.floor((z - r - M - minZ) / S), oz1 = Math.floor((z + r + M - minZ) / S);
      const r2 = r * r, useY = typeof y === 'number';
      for (let cz = oz0; cz <= oz1; cz++) {
        for (let cx = ox0; cx <= ox1; cx++) {
          const list = this.mapItems(cx, cz), bb = list.bb;
          if (!bb || (x + r >= bb[0] && x - r <= bb[2] && z + r >= bb[1] && z - r <= bb[3])) for (const it of list) {
            if (it.gone) continue;
            const dx = it.x - x, dz = it.z - z;
            if (dx * dx + dz * dz > r2) continue;
            if (useY && Math.abs(it.y - y) > dy) continue;
            out.push(it);
          }
          if (cx < cx0 || cx > cx1 || cz < cz0 || cz > cz1) continue;
          const ds = this._dropChunks.get(cx + '_' + cz);
          if (ds) for (const id of ds) {
            const it = this.drops.get(id);
            if (!it || it.gone) continue;
            const dx = it.x - x, dz = it.z - z;
            if (dx * dx + dz * dz > r2) continue;
            if (useY && Math.abs(it.y - y) > dy) continue;
            out.push(it);
          }
        }
      }
      return out;
    }

    // 拾う。n = 取る数（弾・回復の箱の中身。武器・防具は 1 つまるごと）。戻り値 = 取れた数（0 = 取れない）
    take(id, by, n) {
      const it = this.get(id);
      if (!it || it.gone) return 0;
      const all = n == null || n >= it.qty;
      const got = all ? it.qty : Math.max(0, Math.floor(n));
      if (got <= 0) return 0;
      if (all) {
        it.gone = true; it.qty = 0;
        if (it.map) this.state.set(id, { gone: true, at: this.time });
        else this._removeDrop(id);
      } else {
        it.qty -= got;
        if (it.map) { const s = this.state.get(id) || {}; s.qty = it.qty; s.gone = false; this.state.set(id, s); }
      }
      this.stats.taken++;
      this._emit({ op: 'take', id, item: it, by, n: got, all });
      return got;
    }

    // 落とす。spec: { type, qty?, ammo?, dur? }、pos: { x, y, z }。戻り値 = 新しい id
    drop(spec, pos) {
      if (!spec || !ITEMS[spec.type]) return null;
      const id = this.dropPrefix + (++this._dropSeq);
      const base = Loot.fill(this.cfg, spec.type, this.weaponDefs);
      const it = {
        id, type: spec.type, x: +pos.x || 0, y: +pos.y || 0, z: +pos.z || 0,
        qty: spec.qty != null ? spec.qty : base.qty, ammo: spec.ammo != null ? spec.ammo : base.ammo, dur: spec.dur != null ? spec.dur : base.dur,
        yaw: spec.yaw != null ? spec.yaw : Loot.yawOf(id, this.seed), map: false, gone: false, at: this.time
      };
      this.drops.set(id, it);
      const c = this._chunkOf(it.x, it.z), key = c.cx + '_' + c.cz;
      let set = this._dropChunks.get(key);
      if (!set) { set = new Set(); this._dropChunks.set(key, set); }
      set.add(id);
      it.ck = key;
      this.stats.dropped++;
      this._emit({ op: 'drop', id, item: it });
      return id;
    }

    _removeDrop(id) {
      const it = this.drops.get(id);
      if (!it) return;
      this.drops.delete(id);
      const set = this._dropChunks.get(it.ck);
      if (set) { set.delete(id); if (!set.size) this._dropChunks.delete(it.ck); }
    }

    // ---------- オンライン（フェーズ D2。状態はサーバーが決め、クライアントはその知らせを当てるだけ）----------
    // サーバーが落とした物（loot add / welcome の drops。id はサーバーの "s<n>"）をそのまま置く
    putDrop(d) {
      if (!d || typeof d.id !== 'string' || !ITEMS[d.type]) return null;
      if (this.drops.has(d.id)) this._removeDrop(d.id);
      const base = Loot.fill(this.cfg, d.type, this.weaponDefs);
      const it = {
        id: d.id, type: d.type, x: +d.x || 0, y: +d.y || 0, z: +d.z || 0,
        qty: d.qty != null ? d.qty : base.qty, ammo: d.ammo != null ? d.ammo : base.ammo, dur: d.dur != null ? d.dur : base.dur,
        yaw: Loot.yawOf(d.id, this.seed), map: false, gone: false, at: this.time
      };
      this.drops.set(d.id, it);
      const c = this._chunkOf(it.x, it.z), key = c.cx + '_' + c.cz;
      let set = this._dropChunks.get(key);
      if (!set) { set = new Set(); this._dropChunks.set(key, set); }
      set.add(d.id);
      it.ck = key;
      this.stats.dropped++;
      this._emit({ op: 'drop', id: d.id, item: it });
      return d.id;
    }
    // 地図の物の状態をそのまま当てる（welcome の loot.st [id, gone, qty?]・picked の left）。gone = 無くなった、qty = 残り
    setRemoteState(id, gone, qty) {
      if (this.drops.has(id)) {
        const it = this.drops.get(id);
        if (gone) { it.gone = true; this._removeDrop(id); } else if (qty != null) it.qty = qty;
        this._emit({ op: gone ? 'take' : 'update', id, item: it });
        return;
      }
      if (!/^\d+_\d+_\d+$/.test(String(id))) return;
      const s = gone ? { gone: true, at: this.time } : (qty != null ? { gone: false, qty, at: this.time } : null);
      if (s) this.state.set(id, s); else this.state.delete(id);
      const it = this.get(id);
      if (it) this._applyState(it);
      this._emit({ op: gone ? 'take' : 'update', id, item: it });
    }
    // 落とし物が消えた（loot gone）/ 地図の物が戻った（loot back）
    removeDrop(id) { const it = this.drops.get(id); if (!it) return; this._removeDrop(id); it.gone = true; this._emit({ op: 'expire', id, item: it }); }
    restore(id) {
      this.state.delete(id);
      const it = this.get(id);
      if (it) this._applyState(it);
      this._emit({ op: 'respawn', id, item: it });
    }

    // 時間を進める（ソロ）: 取られた地図の物を戻す（近く nearR m に人がいる間は戻さない）・古い落とし物を消す
    update(t, px, pz, nearR) {
      this.time = t;
      if (t < this._respawnTimer) return;
      this._respawnTimer = t + 1;
      const R = this.cfg.respawnSec, near2 = (nearR == null ? 25 : nearR) * (nearR == null ? 25 : nearR);
      if (R > 0) {
        for (const [id, s] of this.state) {
          if (!s.gone || t - s.at < R) continue;
          const it = this.get(id);
          if (it && px != null && (it.x - px) * (it.x - px) + (it.z - pz) * (it.z - pz) < near2) continue;
          this.state.delete(id);
          if (it) this._applyState(it);
          this.stats.respawned++;
          this._emit({ op: 'respawn', id, item: it });
        }
      }
      const L = this.cfg.dropLifetime;
      if (L > 0) {
        for (const [id, it] of this.drops) {
          if (t - it.at < L) continue;
          this._removeDrop(id);
          this.stats.expired++;
          this._emit({ op: 'expire', id, item: it });
        }
      }
    }

    // フェーズ D 用: 変わった状態だけ（地図の物）と落とし物の一覧
    snapshot() {
      const st = [];
      for (const [id, s] of this.state) st.push({ id, gone: s.gone ? 1 : 0, qty: s.qty, ammo: s.ammo, dur: s.dur });
      const dr = [];
      for (const it of this.drops.values()) dr.push({ id: it.id, type: it.type, x: it.x, y: it.y, z: it.z, qty: it.qty, ammo: it.ammo, dur: it.dur });
      return { state: st, drops: dr };
    }

    // 続きから（session.js）: 取った地図の物を当てる。list の要素は id（全部取った）か [id, 残り]。落とし物（"d<n>"）は当てない
    applyTaken(list) {
      if (!Array.isArray(list)) return 0;
      let n = 0;
      for (const e of list) {
        const id = Array.isArray(e) ? e[0] : e;
        if (typeof id !== 'string' || !/^\d+_\d+_\d+$/.test(id)) continue;
        const s = Array.isArray(e) ? { gone: false, qty: Math.max(0, e[1] | 0), at: this.time } : { gone: true, at: this.time };
        this.state.set(id, s);
        const m = /^(\d+)_(\d+)_/.exec(id);
        const list2 = this._chunks.get(m[1] + '_' + m[2]);
        if (list2) for (const it of list2) if (it.id === id) this._applyState(it);
        n++;
      }
      if (n) this._emit({ op: 'restore', id: null, item: null, n });
      return n;
    }
  }

  // ==================================================================================================================
  // 持ち物
  // ==================================================================================================================
  class Inventory {
    // cfg: Loot.config(...)、weaponDefs: { id: def }（弾倉の大きさ）
    constructor(cfg, weaponDefs) {
      this.cfg = cfg || Loot.config();
      this.weaponDefs = weaponDefs || {};
      this.reset();
    }

    reset(start) {
      const s = start || this.cfg.start || {};
      this.slots = [null, null, null];
      this.cur = -1;
      this.lastPrimary = 0;
      this.ammo = {};
      for (const cal of Object.keys(this.cfg.calibres || {})) this.ammo[cal] = 0;
      this.meds = { medkit: 0, bandage: 0 };
      this.vest = null;
      this.helmet = null;
      for (const w of s.weapons || []) {
        const d = this.weaponDefs[w];
        this.equip(w, d ? d.magazineSize : 0);
      }
      for (const cal of Object.keys(s.ammo || {})) this.ammo[cal] = Math.min(this.capOf(cal), (this.ammo[cal] || 0) + s.ammo[cal]);
      for (const m of Object.keys(s.meds || {})) this.meds[m] = Math.min(this.medCap(m), s.meds[m]);
      if (s.vest) this.vest = { dur: this.armorMax('vest'), max: this.armorMax('vest') };
      if (s.helmet) this.helmet = { dur: this.armorMax('helmet'), max: this.armorMax('helmet') };
      this.cur = this.firstSlot();
      this.version = (this.version || 0) + 1;
    }

    calOf(weaponId) { return Loot.calOf(this.cfg, weaponId); }
    capOf(cal) { return ((this.cfg.calibres || {})[cal] || {}).cap || 0; }
    medCap(type) { return ((this.cfg.meds || {})[type] || {}).cap || 0; }
    armorMax(slot) { return ((this.cfg.armor || {})[slot] || {}).durability || 100; }

    // weapon.js の弾の出し入れ（reserve）
    ammoOf(cal) { return this.ammo[cal] || 0; }
    setAmmo(cal, v) { this.ammo[cal] = Math.max(0, Math.min(this.capOf(cal) || Infinity, Math.floor(v))); this.version++; }

    // 弾を足す（上限まで）。戻り値 = 足せた数
    addAmmo(cal, n) {
      const room = Math.max(0, this.capOf(cal) - (this.ammo[cal] || 0));
      const got = Math.max(0, Math.min(room, Math.floor(n)));
      if (got > 0) { this.ammo[cal] = (this.ammo[cal] || 0) + got; this.version++; }
      return got;
    }
    addMed(type, n) {
      const room = Math.max(0, this.medCap(type) - (this.meds[type] || 0));
      const got = Math.max(0, Math.min(room, Math.floor(n == null ? 1 : n)));
      if (got > 0) { this.meds[type] = (this.meds[type] || 0) + got; this.version++; }
      return got;
    }
    useMed(type) { if (!(this.meds[type] > 0)) return false; this.meds[type]--; this.version++; return true; }

    firstSlot() { for (const i of [0, 1, 2]) if (this.slots[i]) return i; return -1; }
    occupied() { const out = []; for (let i = 0; i < 3; i++) if (this.slots[i]) out.push(i); return out; }
    // 次の空でない枠（切替ボタン）
    nextSlot(from) {
      for (let k = 1; k <= 3; k++) { const i = ((from < 0 ? -1 : from) + k + 3) % 3; if (this.slots[i]) return i; }
      return -1;
    }
    select(i) {
      if (!this.slots[i]) return false;
      this.cur = i;
      if (i < 2) this.lastPrimary = i;
      this.version++;
      return true;
    }

    // 武器を拾ったらどの枠に入るか（と、入れ替えで落とす物）: ピストルはサブ枠、ほかは空いたメイン枠、無ければ今のメイン枠
    //（サブを持っているときは最後に使ったメイン枠）
    slotFor(weaponId) {
      if (Loot.isSidearm(this.cfg, weaponId)) return 2;
      if (!this.slots[0]) return 0;
      if (!this.slots[1]) return 1;
      return this.cur === 0 || this.cur === 1 ? this.cur : this.lastPrimary;
    }

    // 武器を持つ。戻り値 { slot, dropped: { id, ammo } | null }
    equip(weaponId, ammo) {
      const slot = this.slotFor(weaponId);
      const old = this.slots[slot];
      this.slots[slot] = { id: weaponId, ammo: Math.max(0, ammo | 0) };
      if (slot < 2) this.lastPrimary = slot;
      this.version++;
      return { slot, dropped: old ? { id: old.id, ammo: old.ammo } : null };
    }

    // 防具を着る。古い物があれば（壊れていなければ）落とす物として返す
    wear(slot, dur) {
      const max = this.armorMax(slot);
      const old = this[slot];
      this[slot] = { dur: Math.max(1, Math.min(max, dur == null ? max : dur)), max };
      this.version++;
      return old && old.dur > 0 ? { dur: old.dur } : null;
    }

    // 防具を拾う価値があるか（持っていない・今のより耐久が多い）
    wantsArmor(slot, dur) { const cur = this[slot]; return !cur || (dur || 0) > cur.dur + 0.5; }

    // ダメージに防具を当てる。kind: 'bullet'（防具が効く）| それ以外（落下・安全地帯は素通し）、head: 頭か。戻り値 = 体に入るダメージ
    absorb(damage, kind, head) {
      if (kind !== 'bullet' && kind !== 'explosion') return damage;
      const slot = head ? 'helmet' : 'vest';
      if (kind === 'explosion' && head) return damage;
      const a = this[slot];
      if (!a || a.dur <= 0) return damage;
      const red = ((this.cfg.armor || {})[slot] || {}).reduce || 0;
      const soak = Math.min(a.dur, damage * red);
      a.dur -= soak;
      if (a.dur <= 0.01) this[slot] = null; // 壊れた
      this.version++;
      return damage - soak;
    }

    // フェーズ D 用
    toJSON() {
      return { slots: this.slots.map((s) => s ? { id: s.id, ammo: s.ammo } : null), cur: this.cur, ammo: Object.assign({}, this.ammo), meds: Object.assign({}, this.meds),
        vest: this.vest ? Object.assign({}, this.vest) : null, helmet: this.helmet ? Object.assign({}, this.helmet) : null };
    }
  }

  Loot.World = World;
  Loot.Inventory = Inventory;
  MR.Loot = Loot;
  if (typeof module !== 'undefined' && module.exports) module.exports = Loot;
})(typeof window !== 'undefined' ? window : globalThis);
