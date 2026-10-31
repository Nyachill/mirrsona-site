// 時間帯（MR.Tod。plan dev-notes/plans/time-of-day.md の TOD M1）。THREE にも DOM にも依存しない（Node の require でも動く UMD）。
//   ブラウザ: <script> で読む → MR.Tod      Node: require('../www/js/tod.js') → Tod（globalThis.MR.Tod にも入る）
//
// ■ 1 ゲームごとに時間帯（プリセット）を 1 つ決める（ゲームの途中では変わらない = PMREM・プログラムを遊んでいる間に作らない）。
//   数は game.json の render.tod: { default, weights, online, arena, labels, presets: { <id>: { … } } }。
//   dusk は {}（= レベルの sky と render の値そのまま = 今までと同じ）。render.tod が無いアプリ・データも dusk。
// ■ pick(cfg, seed, setting, ctx) → プリセットの id（先に当たったもの）:
//   オンライン → cfg.online（古いアプリと同じ夕方）。ctx.forced（opts.tod・URL ?tod=）> ctx.def（window.MR_TOD_DEFAULT = 自動テストの固定）>
//   ctx.harness（?harness=1 は 'dusk'）> アリーナ（街でないレベル）は cfg.arena > setting（設定 mirrsona.tod）> cfg.default。
//   'auto'（おまかせ）は seed から weights の重みで決める（同じ seed なら同じ。Math.random を使わない）。
// ■ プリセットのキー（どれも無ければ今までの値。倍率は今の夕方に対して）:
//   sky:        レベルの sky に重ねる（zenith / horizon / ground / sunColor / sunDir / sunIntensity / background / env /
//               disc（false = 太陽の円盤を描かない）/ moon・stars（画像が無いときシェーダーの空に星）/ hemiSky / hemiGround / fogColor（hex））
//   hemi:       { mul（半球光の強さの倍率）, sky, ground（色 hex）}
//   fog:        { mul（霧の距離の倍率。街は高さの表の fogNear / fogFar、アリーナは render.fogNear / fogFar）, color（hex）}
//   exposure:   露出の倍率（renderer.toneMappingExposure = render.exposure × これ。天気はさらにこの上に掛ける）
//   grade:      render.look.grade に重ねる（{ outdoor: {…}, indoor: {…} }）
//   windows:    { glow（窓の発光 windowEmissive・遠景の farWindowGlow の倍率）, lit（遠景の灯りの割合 farWindowLit・farlook の litOffice / litHome の倍率。1 まで）}
//   lamps:      小物（街灯・信号・売店）の発光 propEmissive の倍率
//   landmarkNight: ランドマークの夜の度合い（render.city.landmarkNight.night を置き換える。0..1）
//   enemySight: 敵（ソロの AI）の見つける距離・撃つ距離の倍率（天気の vis にさらに掛ける）
// ■ 設定: localStorage の mirrsona.tod（'auto' かプリセットの id）。次のゲームから。
(function (root) {
  'use strict';
  const MR = root.MR = root.MR || {};
  const PREF = 'mirrsona.tod';

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const empty = (o) => !isObj(o) || Object.keys(o).length === 0;

  // 32 bit の seed → [0, 1)（mulberry32 の 1 歩。どのエンジンでも同じ）
  function hash01(seed) {
    let t = ((seed >>> 0) + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const Tod = {
    PREF,
    hash01,
    // プリセットの id の一覧（presets の順）
    ids(cfg) { return cfg && isObj(cfg.presets) ? Object.keys(cfg.presets) : []; },
    valid(cfg, id) { return typeof id === 'string' && !!cfg && isObj(cfg.presets) && Object.prototype.hasOwnProperty.call(cfg.presets, id); },
    // 設定の選択肢（'auto' + プリセット）
    choices(cfg) { return ['auto'].concat(Tod.ids(cfg)); },
    // 'auto' か知っている id（ほかは null）
    norm(cfg, v) {
      if (v === 'auto') return 'auto';
      return Tod.valid(cfg, v) ? v : null;
    },
    // ふつうの夕方の id（presets に dusk が無ければ online / 最初のプリセット）
    base(cfg) {
      if (Tod.valid(cfg, 'dusk')) return 'dusk';
      if (cfg && Tod.valid(cfg, cfg.online)) return cfg.online;
      const ids = Tod.ids(cfg);
      return ids.length ? ids[0] : 'dusk';
    },
    // seed から重みで 1 つ（weights に無いプリセットは 0、全部 0 なら base）
    weighted(cfg, seed) {
      const ids = Tod.ids(cfg), w = (cfg && cfg.weights) || {};
      let total = 0;
      for (const id of ids) total += Math.max(0, num(w[id], 0));
      if (!(total > 0)) return Tod.base(cfg);
      let r = hash01(seed) * total;
      for (const id of ids) {
        const x = Math.max(0, num(w[id], 0));
        if (x <= 0) continue;
        if (r < x) return id;
        r -= x;
      }
      for (let i = ids.length - 1; i >= 0; i--) if (num(w[ids[i]], 0) > 0) return ids[i];
      return Tod.base(cfg);
    },
    // ctx: { online, arena（街でないレベル）, forced（opts.tod / URL）, def（MR_TOD_DEFAULT）, harness }
    pick(cfg, seed, setting, ctx) {
      ctx = ctx || {};
      if (!cfg || !isObj(cfg.presets)) return 'dusk';
      const res = (v) => (v === 'auto' ? Tod.weighted(cfg, typeof seed === 'function' ? seed() : seed) : v); // seed は関数でもよい（おまかせのときだけ呼ぶ）
      if (ctx.online) return Tod.valid(cfg, cfg.online) ? cfg.online : Tod.base(cfg);
      const f = Tod.norm(cfg, ctx.forced);
      if (f) return res(f);
      const d = Tod.norm(cfg, ctx.def);
      if (d) return res(d);
      if (ctx.harness) return Tod.base(cfg);
      if (ctx.arena) return Tod.valid(cfg, cfg.arena) ? cfg.arena : Tod.base(cfg);
      const s = Tod.norm(cfg, setting);
      if (s) return res(s);
      const c = Tod.norm(cfg, cfg.default);
      return c ? res(c) : Tod.base(cfg);
    },
    preset(cfg, id) { return Tod.valid(cfg, id) && isObj(cfg.presets[id]) ? cfg.presets[id] : {}; },
    label(cfg, id) {
      const L = (cfg && cfg.labels) || {};
      return typeof L[id] === 'string' ? L[id] : String(id);
    },
    isEmpty: empty,

    // ---- 重ねる（どれも入力をいじらない。プリセットが空なら入力そのものを返す = 今までと同じオブジェクト）----
    // レベルの sky + プリセット → 空（MR.Sky）の opts。hemi / fog の色もここ
    skyOpts(levelSky, p) {
      if (empty(p) || (empty(p.sky) && !(isObj(p.hemi) && (p.hemi.sky || p.hemi.ground || p.hemi.mul != null)) && !(isObj(p.fog) && p.fog.color))) return levelSky;
      const o = Object.assign({}, levelSky || {}, isObj(p.sky) ? p.sky : {});
      if (isObj(p.hemi)) {
        if (typeof p.hemi.sky === 'string') o.hemiSky = p.hemi.sky;
        if (typeof p.hemi.ground === 'string') o.hemiGround = p.hemi.ground;
        // アリーナ（街でないレベル）の半球光の強さ（街は render.city.hemiIntensity を applyRender が掛ける）
        if (p.hemi.mul != null) o.hemiIntensity = num((levelSky || {}).hemiIntensity, 0.75) * num(p.hemi.mul, 1);
      }
      if (isObj(p.fog) && typeof p.fog.color === 'string') o.fogColor = p.fog.color;
      return o;
    },
    // render の設定（_renderSettings の結果）+ プリセット → 新しい rs（render.city と render.city.mobile も写して掛ける）。
    //   cityDefaults: MR.CityWorld.DEFAULTS（game.json に無いキーの元の値）
    applyRender(rs, p, cityDefaults) {
      if (empty(p) || !rs) return rs;
      const out = Object.assign({}, rs);
      const D = cityDefaults || {};
      const ex = num(p.exposure, 1);
      if (ex !== 1) out.exposure = num(rs.exposure, 1) * ex;
      const fm = isObj(p.fog) ? num(p.fog.mul, 1) : 1;
      if (fm !== 1) { out.fogNear = num(rs.fogNear, 45) * fm; out.fogFar = num(rs.fogFar, 140) * fm; }
      if (!isObj(rs.city)) return out;
      const W = isObj(p.windows) ? p.windows : {};
      const glow = num(W.glow, 1), lit = num(W.lit, 1), lamps = num(p.lamps, 1);
      const hm = isObj(p.hemi) ? num(p.hemi.mul, 1) : 1;
      const city = Object.assign({}, rs.city);
      const mob = isObj(rs.city.mobile) ? Object.assign({}, rs.city.mobile) : null;
      // 掛ける: city（無ければ既定値）と、mobile に同じキーがあればそれも（CityWorld.config が mobile を上に重ねる）
      const scale = (k, m, def) => {
        if (m === 1) return;
        city[k] = num(city[k], num(D[k], def)) * m;
        if (mob && typeof mob[k] === 'number') mob[k] *= m;
      };
      scale('windowEmissive', glow, 1.4);
      scale('farWindowGlow', glow, 1.25);
      scale('farWindowLit', lit, 1);
      scale('propEmissive', lamps, 2);
      scale('hemiIntensity', hm, 1);
      // 霧の終わりはその行の描画距離（far）の 0.95 倍まで（昼の × 1.4 で far を越えると、高い所から街の端が霧なしで切れて見えた）
      const alt = (tab) => (Array.isArray(tab) ? tab.map((r) => {
        if (!isObj(r)) return r;
        let ff = num(r.fogFar, 0) * fm;
        if (typeof r.far === 'number' && ff > r.far * 0.95) ff = Math.max(num(r.fogFar, 0), r.far * 0.95);
        return Object.assign({}, r, { fogNear: Math.min(num(r.fogNear, 0) * fm, ff * 0.9), fogFar: ff });
      }) : tab);
      if (fm !== 1) {
        city.altitude = alt(city.altitude || D.altitude);
        if (mob && mob.altitude) mob.altitude = alt(mob.altitude);
      }
      if (lit !== 1) {
        const lk = (look) => {
          if (!isObj(look)) return look;
          const w = Object.assign({}, look.windows || {});
          const sc = (r, d) => { const a = Array.isArray(r) ? r : d; return [Math.min(1, a[0] * lit), Math.min(1, a[1] * lit)]; };
          w.litOffice = sc(w.litOffice, [0.55, 0.8]);
          w.litHome = sc(w.litHome, [0.25, 0.45]);
          return Object.assign({}, look, { windows: w });
        };
        city.look = lk(city.look || {});
        if (mob && isObj(mob.look)) mob.look = lk(mob.look);
      }
      if (typeof p.landmarkNight === 'number') {
        const ln = Math.max(0, Math.min(1, p.landmarkNight));
        city.landmarkNight = Object.assign({}, city.landmarkNight || {}, { night: ln });
        if (mob && isObj(mob.landmarkNight)) mob.landmarkNight = Object.assign({}, mob.landmarkNight, { night: ln });
      }
      if (mob) city.mobile = mob;
      out.city = city;
      return out;
    },
    // render.look の設定（MR.Look.config の結果）+ プリセットの grade → 新しい設定（1 段の深さまで重ねる）
    applyLook(lookCfg, p) {
      if (!lookCfg || empty(p) || !isObj(p.grade)) return lookCfg;
      const g0 = isObj(lookCfg.grade) ? lookCfg.grade : {};
      const g = Object.assign({}, g0);
      for (const k of Object.keys(p.grade)) g[k] = isObj(p.grade[k]) && isObj(g0[k]) ? Object.assign({}, g0[k], p.grade[k]) : p.grade[k];
      return Object.assign({}, lookCfg, { grade: g });
    },
    enemySight(p) { return empty(p) ? 1 : Math.max(0.05, num(p.enemySight, 1)); },

    // ---- URL・設定 ----
    parseUrl(search, cfg) {
      const m = /[?&]tod=([a-z0-9_-]+)/i.exec(search || '');
      return m ? Tod.norm(cfg, m[1].toLowerCase()) : null;
    },
    parseSeed(search) {
      const m = /[?&]seed=(\d+)/.exec(search || '');
      return m ? (Number(m[1]) >>> 0) : null;
    },
    load(storage) {
      try {
        const s = storage || (root.localStorage || null);
        return s ? s.getItem(PREF) : null;
      } catch (e) { return null; }
    },
    save(v, storage) {
      try {
        const s = storage || (root.localStorage || null);
        if (s) s.setItem(PREF, String(v));
        return true;
      } catch (e) { return false; }
    }
  };

  MR.Tod = Tod;
  if (typeof module !== 'undefined' && module.exports) module.exports = Tod;
})(typeof window !== 'undefined' ? window : globalThis);
