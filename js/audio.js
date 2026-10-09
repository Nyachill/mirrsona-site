// 効果音・環境音・BGM。
//   - 音声ファイル（assets の sounds/*.mp3）があればそれを鳴らし、無ければ WebAudio で合成した音にフォールバックする
//     （バイナリ無しの内蔵データ起動でも今まで通り鳴る）。
//   - ファイルは unlock()（最初のタップ）のあとバックグラウンドで少しずつデコードする（メインスレッドを止めない）。
//     まだデコードが終わっていない音は合成音で鳴る。
//   - 3D 音: play(name, { pos }) で PannerNode（equalpower / inverse）。リスナーは毎フレーム setListener(camera)。
//   - ゲインバス: master の下に sfx / music / ambience（音量は config の audio）。master → リミッター → 出力。
//
// 音声スレッドを重くしないための決まり（iPad で「128 サンプル鳴って 896 サンプル無音」になった件の対策。tools/audio-stress.js で確認）:
//   1. 鳴らした音はすべて「ボイス」として登録し、鳴り終わったら（onended / 期限切れの掃除 / タイマーの保険）
//      音源・フィルタ・ゲイン・パンナーを全部 disconnect する。WebKit は繋がったままのノードを毎回処理し続ける。
//   2. AudioParam のオートメーションを溜めない。WebKit は過去のイベントを捨てずに毎クォンタムたどるので、
//      位置（リスナー・パンナー）は _setNow: cancelScheduledValues(0) → .value（.value も仕様上 setValueAtTime なので
//      毎回前の 1 件を消す。残るのは常に 1 件）。30 Hz まで・動いた成分だけ。
//      なめらかに変える値（エンジン・音量）は _glide: cancelScheduledValues(0) → setValueAtTime → setTargetAtTime（常に 2 件）、15 Hz まで。
//      目標に着いたら（時定数の 6 倍後）_settleGlides が _setNow と同じ「過去の 1 件」に置き換える
//      （WebKit は SetTarget が 1 件でも残っていると、その値をずっとサンプルごとに計算し続ける）。
//   3. 同時発音数の上限（モバイル 20 / PC 32。合成音も 1 声と数える）。同じ名前は 4 つまで・25 ms 以上空ける（名前ごとの上書きは
//      config の audio.limits）。間隔は前の音より大きい（近い・大事な）音なら無視して通す（遠くの同じ音に消されない）。
//      自分の銃声・リロードは channel 'self' で他の人の同じ武器とは別に数える。
//      いっぱいなら一番小さい（遠い）音を止めて入れ替える。遠くて聞こえない 3D 音は最初から鳴らさない。
//   4. master の後ろにリミッター（DynamicsCompressor。しきい値 -2 dB・ratio 20 で、ふつうの 1 発には掛からず重なった
//      ピークだけ抑える）。自動のメイクアップゲインは WebKit / Chromium と同じ式（compressorMakeupDb）で求めて打ち消す。
//      config の audio.limiter: false で外す。
//
// 使い方（main.js）: const audio = new MR.Audio({ assets, config: gameConfig.audio }); タップで audio.unlock();
//                 もしくは new MR.Audio() のあと audio.init(assets, config.audio)
// game.js からは shoot / enemyShoot / reload / empty / hit / hurt / kill（従来通り）と
//   footstep(surface) / jump() / land() / impact(surface, pos) / whizz(pos) / casing(pos) / swap() / ads(on) / death()
//   ambience('ambience_dusk') / music('music_combat') / stop('music') / setListener(camera) / setVolumes(cfg) / stats()
window.MR = window.MR || {};

(function () {
  // 既定の音量（config の audio が無いときに使う）
  const DEFAULT_VOLUMES = { master: 0.8, sfx: 1.0, music: 0.5, ambience: 0.6 };

  // 3D 音の既定パラメータ（PannerNode）
  const PANNER = { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 2, maxDistance: 60, rolloffFactor: 1.2 };

  // 負荷対策の既定値（config の audio の同名キーで上書き）
  const MIX_DEFAULTS = {
    maxVoices: 32,          // 同時に鳴らす単発音の上限（PC）。ループ（環境音・BGM・エンジン）は数えない
    maxVoicesMobile: 20,    // タッチ端末
    perNameMax: 4,          // 同じ名前（末尾の _数字 を除く）の同時発音数
    minInterval: 0.025,     // 同じ名前を鳴らす最小間隔（秒）
    minGain: 0.02,          // 3D 音: 距離減衰を見積もってこれ未満なら鳴らさない
    listenerHz: 30,         // リスナーの位置・向きを書く最大回数（毎秒）
    engineHz: 15,           // エンジン音のパラメータを更新する最大回数（毎秒）
    latencyHint: 'interactive',
    limiter: { threshold: -2, knee: 0, ratio: 20, attack: 0.003, release: 0.25 },
    // 名前ごとの上書き { max, interval }。'*_tail' / 'impact_*' のように * で前後一致
    limits: {
      casing: { max: 2, interval: 0.05 },
      whizz: { max: 2, interval: 0.06 },
      hitmarker: { max: 2, interval: 0.04 },
      hurt: { max: 2, interval: 0.08 },
      '*_tail': { max: 2 },
      '*_fire': { max: 4, interval: 0.02 },
      'impact_*': { max: 3 },
      'footstep_*': { max: 2 },
      'reload_*': { max: 1 },
      swim_stroke: { max: 2, interval: 0.35 },
      ladder_step: { max: 2, interval: 0.12 }
    }
  };

  // ファイル音の基準音量（ファイルは -1 dBFS に正規化されている前提）。名前そのまま → 末尾の _数字 を落とした名前 の順で探す
  const LEVELS = {
    p90_fire: 0.9, shotgun_fire: 1.0, p90_tail: 0.5, shotgun_tail: 0.5, enemy_fire: 0.9,
    reload_p90: 0.8, reload_shotgun: 0.8, reload_rifle: 0.8, reload_sniper: 0.8, reload_pistol: 0.8, reload_lmg: 0.8, bolt_cycle: 0.7, rifle_fire: 0.85, lmg_fire: 0.85, pistol_fire: 0.9, empty: 0.6, weapon_swap: 0.6,
    footstep_dirt: 0.35, footstep_concrete: 0.35, jump: 0.5, land: 0.6,
    impact_concrete: 0.55, impact_metal: 0.6, impact_flesh: 0.6,
    hitmarker: 0.5, kill: 0.6, hurt: 0.8, death: 0.9, whizz: 0.7, casing: 0.3,
    ads_in: 0.4, ads_out: 0.4, ambience_dusk: 1.0, music_combat: 1.0,
    engine_idle: 0.5, engine_loop: 0.55, engine_start: 0.7, vehicle_door: 0.6, vehicle_impact: 0.85, vehicle_explode: 1.0, tire_skid: 0.45, horn: 0.7,
    // 街（reports の city-audio / city2-audio の推奨値）
    ambience_city: 1.0, music_city: 0.9, footstep_wood: 0.32, footstep_metal: 0.3, ladder_step: 0.3, fall_land_hard: 0.85,
    swim_stroke: 0.45, splash: 0.8, water_lap: 0.45, wind_high: 0.35, parachute_open: 0.75,
    heli_rotor: 0.6, heli_start: 0.52, heli_wind: 0.35, pickup_weapon: 0.6, pickup_ammo: 0.5, pickup_med: 0.5, heal: 0.55, zone_damage: 0.6,
    // 戦闘機（reports の jet-jetaudio の推奨値）・爆発（fx-audio）
    jet_engine: 0.45, jet_afterburner: 0.65, jet_flyby: 0.9, cannon_m61: 0.8, cannon_tail: 0.42, missile_launch: 0.9, missile_loop: 0.6, missile_explode: 0.85,
    lock_tone: 0.18, lock_solid: 0.13, rwr_warning: 0.2, catapult_launch: 0.85, arrest_catch: 0.9, gear_motor: 0.4, canopy_motor: 0.45, flare_pop: 0.6, sonic_boom: 1.0,
    explosion_large: 1.0, explosion_far: 0.8
  };

  // デコードの優先順（先頭から）。ここに無いものはアルファベット順で後ろに付く
  const PRIORITY = ['p90_fire', 'p90_tail', 'footstep_dirt', 'footstep_concrete', 'ambience_dusk', 'enemy_fire', 'hitmarker', 'impact_concrete',
    'shotgun_fire', 'rifle_fire', 'pistol_fire', 'sniper_fire', 'lmg_fire', 'bolt_cycle', 'reload_p90', 'reload_shotgun', 'reload_rifle', 'reload_sniper', 'reload_pistol', 'reload_lmg', 'hurt', 'kill', 'whizz', 'impact_metal', 'impact_flesh', 'casing', 'music_combat',
    'vehicle_door', 'engine_start', 'engine_loop', 'engine_idle', 'vehicle_impact', 'vehicle_explode', 'horn', 'tire_skid',
    // 街の音（arena01 のデコード順を変えないよう後ろに足す。街では鳴らすときに _prioritize で前に出る）
    'ambience_city', 'footstep_wood', 'footstep_metal', 'ladder_step', 'fall_land_hard', 'splash', 'swim_stroke', 'water_lap', 'wind_high', 'music_city',
    'heli_start', 'heli_rotor', 'heli_wind',
    // フェーズ C3（拾う・回復・パラシュート）
    'pickup_weapon', 'pickup_ammo', 'pickup_med', 'heal', 'parachute_open',
    // フェーズ E1（戦闘機。街で乗るときに prepareJet で前に出る）
    'jet_engine', 'cannon_m61', 'jet_afterburner', 'catapult_launch', 'arrest_catch', 'gear_motor', 'jet_flyby', 'canopy_motor', 'cannon_tail', 'explosion_large', 'explosion_far',
    'missile_launch', 'missile_explode', 'lock_tone', 'lock_solid', 'rwr_warning', 'missile_loop', 'flare_pop', 'sonic_boom'];

  const DECODE_BATCH = 2;      // 一度にデコードを始めるファイル数
  const DECODE_INTERVAL = 60;  // バッチ間の待ち（ms）
  const FOOTSTEP_MIN_INTERVAL = 0.25;
  const LOOP_FADE_IN = 1.0;
  const LOOP_FADE_OUT = 0.6;
  const STEAL_FADE = 0.008;    // 入れ替えで止める音のフェード（秒）
  const POS_EPS = 0.005;       // 位置（m）: これ未満の変化は書かない
  const DIR_EPS = 0.0005;      // 向き（単位ベクトルの成分）: 同上

  function baseName(name) {
    return String(name || '').replace(/_\d+$/, '');
  }

  function isMobile() {
    try {
      const n = window.navigator || {};
      return (n.maxTouchPoints || 0) > 1 || /iPhone|iPad|iPod|Android/i.test(n.userAgent || '');
    } catch (e) { return false; }
  }

  MR.Audio = class Audio {
    // opts: 省略可。{ assets, config } を渡すと init() 相当（main.js はこの形で呼ぶ）
    constructor(opts) {
      this.ctx = null;
      this.master = null;
      this.limiter = null;
      this.buses = null;          // { sfx, music, ambience }
      this.noiseBuffer = null;
      this.enabled = true;
      this.buffers = {};          // name -> AudioBuffer（デコード済み）
      this.assets = null;
      this.volumes = Object.assign({}, DEFAULT_VOLUMES);
      this.mix = Audio._mixFrom(null);
      this.files = {};            // name -> assets のパス（'sounds/p90_fire.mp3'）
      this.variants = {};         // base -> [name, ...]（footstep_dirt -> [footstep_dirt_1, ...]）
      this._rr = {};              // base -> 次に鳴らすバリアントの index
      this._queue = [];           // デコード待ちの name
      this._decoding = false;
      this._decodeTimer = null;
      this._loops = { ambience: null, music: null };  // { name, handle, pending }
      this._active = [];          // 鳴っているボイス（単発・ループとも）。開放（disconnect）すると外れる
      this._voices = 0;           // 上限に数える単発ボイスの数（止めにかかったものは除く）
      this._lastStart = {};       // 名前 -> 最後に鳴らし始めた時刻
      this._cur = null;           // 合成音を組み立て中のボイス（ノードの登録先）
      this._vid = 0;
      this._stats = { played: 0, synth: 0, dropped: 0, culled: 0, stolen: 0, released: 0 };
      this._lastFootstep = -1;
      this._lastListener = -1;
      this._fwd = null; this._up = null; this._lpos = null;
      this._wf = null; this._wu = null; this._wp = null;   // 最後にリスナーへ書いた値
      this._hasListenerPos = false;
      this.source = 'synth';      // 'synth' | 'mixed' | 'files'（デバッグ表示用。1 つでもファイルを鳴らせたら mixed）
      if (opts && (opts.assets || opts.config)) this.init(opts.assets, opts.config);
    }

    // config の audio から負荷対策の設定を作る（無いキーは既定値）
    static _mixFrom(cfg) {
      cfg = cfg || {};
      const d = MIX_DEFAULTS;
      const num = (k) => (typeof cfg[k] === 'number' && isFinite(cfg[k])) ? cfg[k] : d[k];
      let limiter = d.limiter;
      if (cfg.limiter === false) limiter = null;
      else if (cfg.limiter && typeof cfg.limiter === 'object') limiter = Object.assign({}, d.limiter, cfg.limiter);
      const limits = Object.assign({}, d.limits, (cfg.limits && typeof cfg.limits === 'object') ? cfg.limits : {});
      const exact = {}, patterns = [];
      for (const k of Object.keys(limits)) {
        const v = limits[k];
        if (!v || typeof v !== 'object') continue;
        if (k.indexOf('*') >= 0) patterns.push({ re: new RegExp('^' + k.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'), v });
        else exact[k] = v;
      }
      return {
        maxVoices: Math.max(4, Math.round(num('maxVoices'))),
        maxVoicesMobile: Math.max(4, Math.round(num('maxVoicesMobile'))),
        perNameMax: Math.max(1, Math.round(num('perNameMax'))),
        minInterval: Math.max(0, num('minInterval')),
        minGain: Math.max(0, num('minGain')),
        listenerHz: Math.max(5, num('listenerHz')),
        engineHz: Math.max(5, num('engineHz')),
        latencyHint: (typeof cfg.latencyHint === 'string' || typeof cfg.latencyHint === 'number') ? cfg.latencyHint : d.latencyHint,
        limiter, exact, patterns
      };
    }

    // アセットマネージャと音量設定を覚える。unlock 前後どちらで呼んでもよい
    init(assets, cfg) {
      this.assets = assets || null;
      this.mix = Audio._mixFrom(cfg);
      this.setVolumes(cfg);
      this._scanFiles();
      if (this.ctx) this._scheduleDecode();
    }

    // 音量設定 { master, sfx, music, ambience }（0..1。無いキーは既定値のまま）
    setVolumes(cfg) {
      cfg = cfg || {};
      for (const k of Object.keys(DEFAULT_VOLUMES)) {
        const v = cfg[k];
        if (typeof v === 'number' && isFinite(v)) this.volumes[k] = Math.max(0, Math.min(1, v));
      }
      if (!this.ctx) return;
      this._glide(this.master.gain, this.volumes.master, 0.05);
      for (const k of ['sfx', 'music', 'ambience']) this._glide(this.buses[k].gain, this.volumes[k] * (k === 'ambience' && this._ambLevel != null ? this._ambLevel : 1), 0.05);
    }

    // 環境音バスの係数（街の室内で下げる。0..1、なめらかに。変わらなければ何もしない）
    setAmbienceLevel(f) {
      f = Math.max(0, Math.min(1, +f || 0));
      if (Math.abs(f - (this._ambLevel == null ? 1 : this._ambLevel)) < 0.01) return;
      this._ambLevel = f;
      if (this.ctx && this.buses) this._glide(this.buses.ambience.gain, this.volumes.ambience * f, 0.4);
    }

    // 同時発音数の上限（端末で変える）
    voiceLimit() {
      if (this._mobile == null) this._mobile = isMobile();
      return this._mobile ? this.mix.maxVoicesMobile : this.mix.maxVoices;
    }

    // デバッグ用の数字
    stats() {
      let loops = 0;
      for (const v of this._active) if (!v.budget) loops++;
      return Object.assign({ voices: this._voices, limit: this.voiceLimit(), tracked: this._active.length, loops }, this._stats);
    }

    // ---------- AudioParam を溜めずに書く ----------

    // すぐに値を変える（位置など）。仕様では .value = v は setValueAtTime(v, currentTime) と同じで必ずイベントが 1 件増える
    // （Chromium も WebKit もそう）。なので前回の書き込みで残ったイベントを cancelScheduledValues(0) で消してから書く
    // → 1 つのパラメータに残るのは常に 1 件。値がほとんど変わらないとき（eps 未満）は何も呼ばない
    _setNow(p, v, eps) {
      if (!p || !isFinite(v)) return;
      if (this && this._glides) this._glides.delete(p);
      if (p._mrLast !== undefined && Math.abs(v - p._mrLast) < (eps || 0)) return;
      if (p._mrLast !== undefined && typeof p.cancelScheduledValues === 'function') {
        try { p.cancelScheduledValues(0); } catch (e) { /* ignore */ }
      }
      p._mrLast = v;
      try { p.value = v; } catch (e) { /* ignore */ }
    }

    // なめらかに値を変える。イベントは常に 2 件（今の値 → 目標へ指数で近づく）。
    // 時定数の 6 倍たったら（目標まで 0.25 % 以内）_settleGlides が目標の値の 1 件だけにする
    _glide(p, v, tc) {
      if (!p || !isFinite(v)) return;
      if (typeof p.setTargetAtTime !== 'function' || !this.ctx) { try { p.value = v; } catch (e) { /* ignore */ } return; }
      const now = this.ctx.currentTime;
      try {
        const cur = p.value;
        p.cancelScheduledValues(0);
        p.setValueAtTime(isFinite(cur) ? cur : v, now);
        p.setTargetAtTime(v, now, tc);
        (this._glides || (this._glides = new Map())).set(p, { v, until: now + tc * 6 });
      } catch (e) {
        try { p.value = v; } catch (e2) { /* ignore */ }
      }
    }

    // 目標に着いた _glide を「目標の値の SetValue 1 件」に置き換える（_setNow と同じ形）。
    // WebKit の AudioParamTimeline::hasValues() は SetTarget が残っている限り true を返し、その AudioParam を毎クォンタム
    // サンプルごとに計算する（パンナー・フィルタも重い経路になる）。過去の SetValue 1 件なら定数として扱う
    _settleGlides(now) {
      const G = this._glides;
      if (!G || !G.size) return;
      for (const [p, g] of G) {
        if (now < g.until) continue;
        G.delete(p);
        try { p.cancelScheduledValues(0); p.value = g.v; } catch (e) { /* 切り離し済みのノード */ }
        p._mrLast = g.v;
      }
    }

    // DynamicsCompressor が自動で掛けるメイクアップゲイン（dB）。WebKit / Chromium の DynamicsCompressorKernel と同じ式:
    //   makeup = (1 / saturate(1, k)) ^ 0.6。k は knee の指数曲線の係数で、knee の終わりで傾きが 1 / ratio になる値を
    //   kAtSlope と同じ二分探索（15 回）で求める。threshold / knee / ratio はブラウザと同じ範囲に丸める
    static compressorMakeupDb(threshold, knee, ratio) {
      const th = Math.max(-100, Math.min(0, +threshold || 0));
      const kn = Math.max(0, Math.min(40, +knee || 0));
      const slope = 1 / Math.max(1, Math.min(20, +ratio || 1));
      const db2lin = (db) => Math.pow(10, db / 20);
      const lin2db = (x) => 20 * Math.log10(Math.max(1e-30, x));
      const lt = db2lin(th);
      const kneeCurve = (x, k) => (x < lt ? x : lt + (1 - Math.exp(-k * (x - lt))) / k);
      const slopeAt = (x, k) => {
        if (x < lt) return 1;
        const x2 = x * 1.001;
        return (lin2db(kneeCurve(x2, k)) - lin2db(kneeCurve(x, k))) / (lin2db(x2) - lin2db(x));
      };
      const kneeDb = th + kn, kneeLin = db2lin(kneeDb);
      let minK = 0.1, maxK = 10000, k = 5;
      for (let i = 0; i < 15; i++) {
        if (slopeAt(kneeLin, k) < slope) maxK = k; else minK = k;
        k = Math.sqrt(minK * maxK);
      }
      const yKneeDb = lin2db(kneeCurve(kneeLin, k));
      const sat1 = 1 < kneeLin ? kneeCurve(1, k) : db2lin(yKneeDb + slope * (0 - kneeDb));
      return lin2db(Math.pow(1 / sat1, 0.6));
    }

    // iOS は最初のタップの中で AudioContext を作らないと音が出ない
    // 止まっている（suspended / iOS の interrupted）AudioContext を起こす。何度呼んでも安全
    resume() {
      if (!this.ctx || typeof this.ctx.resume !== 'function') return;
      if (this.ctx.state === 'running') return;
      try {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* ジェスチャー無しでは拒否されることがある */ }
    }

    unlock() {
      if (this.ctx) {
        this.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      try {
        const hint = this.mix.latencyHint;
        if (window.AudioContext && AC === window.AudioContext && hint != null) {
          try { this.ctx = new AC({ latencyHint: hint }); } catch (e) { this.ctx = new AC(); }
        } else {
          this.ctx = new AC();
        }
      } catch (e) {
        this.enabled = false;
        this.ctx = null;
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volumes.master;
      // リミッター: master → compressor → makeup 打ち消し → destination
      let out = ctx.destination;
      const L = this.mix.limiter;
      if (L && typeof ctx.createDynamicsCompressor === 'function') {
        try {
          const c = ctx.createDynamicsCompressor();
          c.threshold.value = L.threshold; c.knee.value = L.knee; c.ratio.value = L.ratio;
          c.attack.value = L.attack; c.release.value = L.release;
          // DynamicsCompressor は自動でメイクアップゲイン（0 dB 入力の圧縮量の 0.6 乗。knee の曲線込み）を掛けるので、
          // しきい値より小さい音が持ち上がらないよう同じ量だけ戻す（ブラウザの計算式をそのまま写した compressorMakeupDb）
          const makeupDb = Audio.compressorMakeupDb(L.threshold, L.knee, L.ratio);
          const comp = ctx.createGain();
          comp.gain.value = Math.pow(10, -makeupDb / 20);
          c.connect(comp);
          comp.connect(ctx.destination);
          this.limiter = { node: c, makeup: comp, makeupDb };
          out = c;
        } catch (e) { this.limiter = null; out = ctx.destination; }
      }
      this.master.connect(out);
      this.buses = {};
      for (const k of ['sfx', 'music', 'ambience']) {
        const g = ctx.createGain();
        g.gain.value = this.volumes[k] * (k === 'ambience' && this._ambLevel != null ? this._ambLevel : 1);
        g.connect(this.master);
        this.buses[k] = g;
      }
      this.noiseBuffer = this._makeNoise(1.0);
      this.resume();
      // 割り込み（電話など）から戻ったとき、running 以外で止まっていたら起こす
      try {
        ctx.onstatechange = () => {
          if (this.ctx && this.ctx.state !== 'running' && typeof document !== 'undefined' && !document.hidden) this.resume();
        };
      } catch (e) { /* 任意 */ }
      this._scheduleDecode();
    }

    _makeNoise(seconds) {
      const sr = this.ctx.sampleRate || 44100;
      const buf = this.ctx.createBuffer(1, Math.floor(sr * seconds), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    _ready() {
      return this.enabled && this.ctx && this.ctx.state === 'running';
    }

    // ---------- ファイルの発見とデコード ----------

    // assets の中から sounds/<name>.(mp3|ogg|wav|m4a) を集める
    _scanFiles() {
      this.files = {};
      this.variants = {};
      const a = this.assets;
      if (!a) return;
      let keys = [];
      try {
        if (typeof a.keys === 'function') keys = a.keys();
        else {
          const set = {};
          for (const k of Object.keys(a.files || {})) set[k] = true;
          for (const k of Object.keys(a.stored || {})) set[k] = true;
          for (const k of Object.keys(a.data || {})) set[k] = true;
          keys = Object.keys(set);
        }
      } catch (e) { keys = []; }
      for (const k of keys) {
        const m = /^(?:(?:hd|sd)\/)?sounds\/([^/]+)\.(mp3|ogg|wav|m4a)$/i.exec(k);
        if (!m) continue;
        if (typeof a.has === 'function' && !a.has(k)) continue;
        const name = m[1];
        if (this.files[name]) continue;
        // ティア付きの置き場所もあり得るので resolve() に任せる（通常は共通の sounds/ のみ）
        let path = k;
        if (typeof a.resolve === 'function') {
          try { path = a.resolve('sounds/' + name + '.' + m[2]) || k; } catch (e) { path = k; }
        }
        this.files[name] = path;
        const base = baseName(name);
        if (base !== name) (this.variants[base] = this.variants[base] || []).push(name);
      }
      for (const b of Object.keys(this.variants)) this.variants[b].sort();
    }

    // そのファイル音が使える（存在する）か
    hasFile(name) {
      return !!this.files[name];
    }

    // デコード済みか
    isDecoded(name) {
      return !!this.buffers[name];
    }

    _scheduleDecode() {
      if (!this.ctx || !this.assets || typeof this.assets.loadAudio !== 'function') return;
      const names = Object.keys(this.files).filter((n) => !this.buffers[n] && this._queue.indexOf(n) < 0);
      const rank = (n) => {
        const i = PRIORITY.indexOf(baseName(n));
        return i < 0 ? PRIORITY.length : i;
      };
      names.sort((x, y) => (rank(x) - rank(y)) || (x < y ? -1 : x > y ? 1 : 0));
      this._queue = this._queue.concat(names);
      this._pumpDecode();
    }

    // 少しずつデコードする（setTimeout で間を空けてメインスレッドを止めない）
    _pumpDecode() {
      if (this._decoding || this._decodeTimer || !this._queue.length) return;
      this._decoding = true;
      const batch = this._queue.splice(0, DECODE_BATCH);
      const jobs = batch.map((name) => this._decodeOne(name));
      Promise.all(jobs).then(() => {
        this._decoding = false;
        this._afterDecode();
        if (this._queue.length) {
          this._decodeTimer = setTimeout(() => { this._decodeTimer = null; this._pumpDecode(); }, DECODE_INTERVAL);
        }
      });
    }

    _decodeOne(name) {
      const path = this.files[name];
      if (!path || this.buffers[name]) return Promise.resolve();
      let p;
      try {
        p = this.assets.loadAudio(path, this.ctx);
      } catch (e) {
        p = Promise.reject(e);
      }
      return Promise.resolve(p).then((buf) => {
        if (buf) this.buffers[name] = buf;
      }).catch((e) => {
        console.warn('[Audio] デコード失敗（合成音で続行）:', name, e && e.message);
        delete this.files[name];
        const vs = this.variants[baseName(name)];
        if (vs) { const i = vs.indexOf(name); if (i >= 0) vs.splice(i, 1); }
      });
    }

    // 必要になった音を列の先頭へ（鳴らそうとしたのにまだデコードされていないとき）
    _prioritize(name) {
      const i = this._queue.indexOf(name);
      if (i > 0) { this._queue.splice(i, 1); this._queue.unshift(name); }
    }

    // デコードが進んだら、待っていたループ（環境音・BGM・loop() の水音や風）を始める
    _afterDecode() {
      for (const kind of ['ambience', 'music']) {
        const L = this._loops[kind];
        if (L && L.pending && this.buffers[L.name] && this._ready()) this._startLoop(kind, L.name);
      }
      if (this._extra) for (const L of this._extra) if (L.pending) this._startExtra(L);
    }

    // ---------- 出力先（バス or 3D パンナー） ----------

    // opts.pos（THREE.Vector3 相当 {x,y,z}）があれば PannerNode を作ってバスに繋ぎ、無ければバスそのもの
    _out(opts, bus) {
      const dest = this.buses[bus || 'sfx'] || this.master;
      const pos = opts && opts.pos;
      if (!pos || typeof this.ctx.createPanner !== 'function') return { node: dest, panner: null };
      let panner;
      try {
        panner = this.ctx.createPanner();
      } catch (e) {
        return { node: dest, panner: null };
      }
      try {
        panner.panningModel = PANNER.panningModel;
        panner.distanceModel = PANNER.distanceModel;
        panner.refDistance = (opts.refDistance != null) ? opts.refDistance : PANNER.refDistance;
        panner.maxDistance = (opts.maxDistance != null) ? opts.maxDistance : PANNER.maxDistance;
        panner.rolloffFactor = (opts.rolloff != null) ? opts.rolloff : PANNER.rolloffFactor;
      } catch (e) { /* 古い実装で読み取り専用なことがある */ }
      this._setPannerPos(panner, pos);
      panner.connect(dest);
      return { node: panner, panner };
    }

    _setPannerPos(panner, p) {
      if (!panner || !p) return;
      if (panner.positionX) {
        this._setNow(panner.positionX, p.x, POS_EPS); this._setNow(panner.positionY, p.y, POS_EPS); this._setNow(panner.positionZ, p.z, POS_EPS);
      } else if (typeof panner.setPosition === 'function') {
        panner.setPosition(p.x, p.y, p.z);
      }
    }

    // 従来互換（t は使わない）: パンナーの位置を書く。イベントは各パラメータ 1 件まで（_setNow と同じ）
    static setNodePosition(panner, x, y, z, t) {
      if (!panner) return;
      if (panner.positionX) {
        const w = Audio.prototype._setNow;
        w(panner.positionX, x, POS_EPS); w(panner.positionY, y, POS_EPS); w(panner.positionZ, z, POS_EPS);
      } else if (typeof panner.setPosition === 'function') {
        panner.setPosition(x, y, z);
      }
    }

    // 毎フレーム呼ぶ。カメラの位置・向きをリスナーに写す（書き込みは listenerHz まで、動いたときだけ）。
    // ついでに鳴り終わったボイスを片付ける
    setListener(camera) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this._sweep(now);
      if (!camera) return;
      const L = this.ctx.listener;
      if (!L) return;
      if (!this._fwd) {
        this._fwd = new THREE.Vector3(); this._up = new THREE.Vector3(); this._lpos = new THREE.Vector3();
        this._wf = new THREE.Vector3(); this._wu = new THREE.Vector3(); this._wp = new THREE.Vector3();
      }
      camera.getWorldPosition(this._lpos);
      this._hasListenerPos = true;
      // 待っているループがあれば（コンテキストが running になった後に）始める
      if ((this._loops.ambience && this._loops.ambience.pending) || (this._loops.music && this._loops.music.pending) || (this._extra && this._extra.some((L) => L.pending))) this._afterDecode();
      if (this._lastListener >= 0 && now - this._lastListener < 0.9 / this.mix.listenerHz) return;
      camera.getWorldDirection(this._fwd);
      this._up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(Audio._tmpQ || (Audio._tmpQ = new THREE.Quaternion())));
      const p = this._lpos, f = this._fwd, u = this._up;
      if (this._lastListener >= 0 && p.distanceToSquared(this._wp) < 0.0001 && f.distanceToSquared(this._wf) < 1e-6 && u.distanceToSquared(this._wu) < 1e-6) return;
      this._lastListener = now;
      this._wp.copy(p); this._wf.copy(f); this._wu.copy(u);
      if (L.positionX) {
        this._setNow(L.positionX, p.x, POS_EPS); this._setNow(L.positionY, p.y, POS_EPS); this._setNow(L.positionZ, p.z, POS_EPS);
        this._setNow(L.forwardX, f.x, DIR_EPS); this._setNow(L.forwardY, f.y, DIR_EPS); this._setNow(L.forwardZ, f.z, DIR_EPS);
        this._setNow(L.upX, u.x, DIR_EPS); this._setNow(L.upY, u.y, DIR_EPS); this._setNow(L.upZ, u.z, DIR_EPS);
      } else {
        // 古い Safari: setPosition / setOrientation
        if (typeof L.setPosition === 'function') L.setPosition(p.x, p.y, p.z);
        if (typeof L.setOrientation === 'function') L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
      }
    }

    // ---------- ボイスの管理 ----------

    // name の音量係数（LEVELS）
    _level(name) {
      if (LEVELS[name] != null) return LEVELS[name];
      const b = baseName(name);
      return LEVELS[b] != null ? LEVELS[b] : 0.7;
    }

    _limitFor(key) {
      const m = this.mix;
      let v = m.exact[key];
      if (!v) for (const p of m.patterns) if (p.re.test(key)) { v = p.v; break; }
      v = v || {};
      return {
        max: (typeof v.max === 'number' && v.max >= 1) ? Math.round(v.max) : m.perNameMax,
        interval: (typeof v.interval === 'number' && v.interval >= 0) ? v.interval : m.minInterval
      };
    }

    // 聞こえる大きさの見積もり（基準音量 × 音量 × 距離減衰（inverse））
    _estimate(name, opts) {
      let g = this._level(name) * (opts.volume == null ? 1 : opts.volume);
      const pos = opts.pos;
      if (pos && this._hasListenerPos) {
        const l = this._lpos;
        const d = Math.sqrt((pos.x - l.x) * (pos.x - l.x) + (pos.y - l.y) * (pos.y - l.y) + (pos.z - l.z) * (pos.z - l.z));
        const ref = opts.refDistance != null ? opts.refDistance : PANNER.refDistance;
        const roll = opts.rolloff != null ? opts.rolloff : PANNER.rolloffFactor;
        g *= ref / (ref + roll * (Math.max(d, ref) - ref));
      }
      return g;
    }

    // 鳴らしてよいか。同じキーの上限・間隔、全体の上限（いっぱいなら一番小さい音を止めて入れ替える）。
    // key: 数える単位（名前、または 'self:' + 名前）、base: 上限の設定を引く名前。
    // 間隔は「直前の同じキーの音が今度の音以上に大きい」ときだけ効かせる（遠くの同じ銃声が近くの銃声を消さない）
    _admit(key, prio, now, base) {
      const lim = this._limitFor(base || key);
      const last = this._lastStart[key];
      if (last && now - last.t < lim.interval && last.prio >= prio) { this._stats.dropped++; return false; }
      let same = 0, weakest = null;
      for (const v of this._active) {
        if (!v.budget || v.stopping || v.key !== key) continue;
        same++;
        if (!weakest || v.prio < weakest.prio) weakest = v;
      }
      if (same >= lim.max) {
        if (weakest.prio > prio * 1.5) { this._stats.dropped++; return false; }
        this._kill(weakest);
      }
      const cap = this.voiceLimit();
      if (this._voices >= cap) {
        let low = null;
        for (const v of this._active) if (v.budget && !v.stopping && (!low || v.prio < low.prio)) low = v;
        if (!low || low.prio > prio) { this._stats.dropped++; return false; }
        this._kill(low);
      }
      this._lastStart[key] = { t: now, prio };
      return true;
    }

    _newVoice(props) {
      const v = Object.assign({ id: ++this._vid, key: '', prio: 0, start: 0, end: Infinity, budget: false, stopping: false, released: false, nodes: [], sources: [], gain: null }, props);
      this._active.push(v);
      if (v.budget) this._voices++;
      return v;
    }

    // ボイスを止める（短いフェード）。上限の枠はすぐ空ける。ノードの開放はフェードの後
    _stopVoice(v, fade) {
      if (!v || v.released || v.stopping) return;
      v.stopping = true;
      if (v.budget) this._voices = Math.max(0, this._voices - 1);
      const now = this.ctx.currentTime;
      const f = Math.max(0.005, fade || 0.03);
      if (v.gain) {
        const p = v.gain.gain;
        if (this._glides) this._glides.delete(p); // 途中の _glide の後始末が消えていく音を元の音量に戻さないように
        try {
          const cur = p.value;
          p.cancelScheduledValues(0);
          p.setValueAtTime(Math.max(0.0001, isFinite(cur) ? cur : 0.0001), now);
          p.exponentialRampToValueAtTime(0.0001, now + f);
        } catch (e) { try { p.value = 0; } catch (e2) { /* ignore */ } }
      }
      for (const s of v.sources) { try { s.stop(now + f + 0.005); } catch (e) { /* 既に止まっている */ } }
      v.end = Math.min(v.end, now + f + 0.01);
      setTimeout(() => this._release(v), Math.ceil((f + 0.1) * 1000));
    }

    _kill(v) {
      this._stats.stolen++;
      this._stopVoice(v, STEAL_FADE);
    }

    // ノードを全部切り離して一覧から外す
    _release(v) {
      if (!v || v.released) return;
      v.released = true;
      if (v.budget && !v.stopping) this._voices = Math.max(0, this._voices - 1);
      v.stopping = true;
      for (const s of v.sources) { try { s.onended = null; } catch (e) { /* ignore */ } }
      for (const n of v.nodes) { if (n) { try { n.disconnect(); } catch (e) { /* 二重 disconnect は無視 */ } } }
      const i = this._active.indexOf(v);
      if (i >= 0) this._active.splice(i, 1);
      this._stats.released++;
    }

    // 期限を過ぎたボイスを片付ける（onended が来ない実装・タイマーが遅れたときの保険）。目標に着いた _glide も片付ける
    _sweep(now) {
      for (let i = this._active.length - 1; i >= 0; i--) {
        const v = this._active[i];
        if (v && now > v.end + 0.1) this._release(v);
      }
      this._settleGlides(now);
    }

    // 合成音の組み立て中ならノードをボイスに登録する
    _n(node) {
      if (this._cur) this._cur.nodes.push(node);
      return node;
    }

    // 合成音の音源を t0〜t1 で鳴らす（ボイスの終わりを延ばす）
    _run(src, t0, t1) {
      src.start(t0);
      src.stop(t1);
      if (this._cur) {
        this._cur.sources.push(src);
        if (t1 > this._cur.end) this._cur.end = t1;
      }
    }

    // ---------- 汎用再生 ----------

    // name（'footstep_dirt' のような base でも可）から実際に鳴らすファイル名を選ぶ。バリアントはラウンドロビン。無ければ null
    _pickName(name) {
      if (this.files[name]) return name;
      const vs = this.variants[name];
      if (vs && vs.length) {
        const i = (this._rr[name] || 0) % vs.length;
        this._rr[name] = i + 1;
        return vs[i];
      }
      return null;
    }

    // 音を鳴らす。opts: { volume (係数, 既定 1), rate (再生速度, 既定 1), pos (THREE.Vector3 世界座標 → 3D), loop, bus ('sfx'|'music'|'ambience'),
    //   refDistance, maxDistance, rolloff, delay (秒), synth (false にすると合成フォールバックを鳴らさない), priority (係数, 既定 1),
    //   channel（'self' など。同じ名前でも channel が違えば同時発音数・間隔を別に数える） }
    // 戻り値: { name, file, stop(), setPosition(pos) } か null（鳴らせなかった・上限で間引いた）
    play(name, opts) {
      if (!this._ready() || !name) return null;
      opts = opts || {};
      const now = this.ctx.currentTime;
      this._sweep(now);
      const file = this._pickName(name);
      const decoded = !!(file && this.buffers[file]);
      if (file && !decoded) this._prioritize(file);  // ファイルはあるがまだデコード中 → 優先度を上げて合成音で鳴らす
      if (decoded && opts.loop) return this._playFile(file, opts, null);
      let synth = null;
      if (!decoded) {
        if (opts.synth === false) return null;
        synth = this._synthFor(baseName(file || name));
        if (!synth) return null;
      }
      const base = baseName(file || name);
      // channel（'self' = 自分の銃声など）ごとに別に数える。上限・間隔の設定は名前（base）で引く
      const key = opts.channel ? opts.channel + ':' + base : base;
      const est = this._estimate(file || name, opts);
      if (opts.pos && est < this.mix.minGain) { this._stats.culled++; return null; }
      const prio = est * (opts.pos ? 1 : 1.5) * (opts.priority || 1);
      if (!this._admit(key, prio, now, base)) return null;
      this._stats.played++;
      if (decoded) return this._playFile(file, opts, { key, prio });
      this._stats.synth++;
      return this._playSynth(synth, file || name, opts, { key, prio });
    }

    _playSynth(fn, name, opts, slot) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const out = this._out(opts, opts.bus);
      const vg = ctx.createGain();
      vg.gain.value = 1;
      vg.connect(out.node);
      const v = this._newVoice({ key: slot.key, prio: slot.prio, start: now, end: now, budget: true, nodes: [vg, out.panner], gain: vg });
      this._cur = v;
      try {
        fn.call(this, vg, opts.volume == null ? 1 : opts.volume, Object.assign({}, opts, { _name: baseName(name) }));
      } catch (e) {
        this._cur = null;
        for (const s of v.sources) { try { s.stop(); } catch (e2) { /* ignore */ } }
        this._release(v);
        return null;
      }
      this._cur = null;
      if (v.end <= now) v.end = now + 0.05;
      setTimeout(() => this._release(v), Math.ceil((v.end - now) * 1000) + 150);
      this.source = this.source === 'files' ? 'mixed' : this.source;
      const self = this;
      return { name, file: null, synth: true, stop: (fade) => self._stopVoice(v, fade || 0.03), setPosition: (p) => self._setPannerPos(out.panner, p) };
    }

    // slot: { key, prio }（単発）か null（ループ。上限に数えない）
    _playFile(file, opts, slot) {
      const loop = !!opts.loop;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const t = now + (opts.delay || 0);
      const src = ctx.createBufferSource();
      src.buffer = this.buffers[file];
      src.loop = loop;
      const rate = (opts.rate != null) ? opts.rate : 1;
      if (src.playbackRate) { try { src.playbackRate.value = rate; } catch (e) { /* ignore */ } }
      const g = ctx.createGain();
      const vol = this._level(file) * (opts.volume == null ? 1 : opts.volume);
      if (loop && opts.fadeIn) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, vol), t + opts.fadeIn);
        // フェードが終わったら 1 件の SetValue にする（ループはずっと鳴るので、2 件のまま残すとずっとサンプルごとの計算になる）
        (this._glides || (this._glides = new Map())).set(g.gain, { v: Math.max(0.0001, vol), until: t + opts.fadeIn + 0.05 });
      } else {
        g.gain.value = vol;
      }
      const out = this._out(opts, opts.bus);
      src.connect(g);
      g.connect(out.node);
      const dur = (src.buffer && src.buffer.duration ? src.buffer.duration : 2) / Math.max(0.1, rate);
      const v = this._newVoice({
        key: slot ? slot.key : baseName(file), prio: slot ? slot.prio : 0, start: t, end: loop ? Infinity : t + dur,
        budget: !loop, nodes: [src, g, out.panner], sources: [src], gain: g
      });
      src.onended = () => this._release(v);
      // onended が来ない実装のための保険（setListener の掃除でも拾う）
      if (!loop) setTimeout(() => this._release(v), Math.ceil((dur + (opts.delay || 0)) * 1000) + 250);
      try {
        src.start(t);
      } catch (e) {
        this._release(v);
        return null;
      }
      this.source = (this.source === 'synth') ? 'files' : this.source;
      const self = this;
      return {
        name: file, file, synth: false, source: src, gain: g, panner: out.panner,
        stop: (fade) => self._stopVoice(v, fade || 0.03),
        setPosition: (p) => self._setPannerPos(out.panner, p)
      };
    }

    // ---------- ループ（環境音・BGM） ----------

    // 環境音ループ（ambience バス）。ファイルがまだ無ければデコード後に自動で始まる。合成フォールバックは無し（無音）
    ambience(name) { this._loop('ambience', name); }

    // BGM ループ（music バス）
    music(name) { this._loop('music', name); }

    _loop(kind, name) {
      const cur = this._loops[kind];
      if (cur && cur.name === name && (cur.handle || cur.pending)) return;
      if (cur && cur.handle) cur.handle.stop(LOOP_FADE_OUT);
      if (!name) { this._loops[kind] = null; return; }
      this._loops[kind] = { name, handle: null, pending: true };
      if (this.files[name]) this._prioritize(name);
      if (this.buffers[name] && this._ready()) this._startLoop(kind, name);
    }

    _startLoop(kind, name) {
      const L = this._loops[kind];
      if (!L || L.name !== name) return;
      const h = this._playFile(name, { loop: true, bus: kind, fadeIn: LOOP_FADE_IN }, null);
      if (!h) return;
      L.handle = h;
      L.pending = false;
    }

    // 長く鳴らすループ（水辺の water_lap・高所の wind_high など）。opts: { pos（あれば 3D）, volume, bus（既定 'ambience'）,
    //   refDistance, maxDistance, fadeIn }。ファイルがデコードされるまで待つ（合成のフォールバックは無し = 無音。環境音と同じ）。
    // 戻り値 { playing, setPosition(p), setVolume(v), stop(fade) }。位置は _setNow（イベント 1 件）、音量は _glide（2 件 → 着いたら 1 件）。
    // 上限（maxVoices）には数えない（環境音と同じ）。毎フレーム呼んでよいが、ゲームは 4 Hz 程度で呼ぶ
    loop(name, opts) {
      opts = opts || {};
      const self = this;
      const L = { name, opts, pos: opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null, vol: opts.volume == null ? 1 : opts.volume, handle: null, pending: true, stopped: false };
      (this._extra || (this._extra = [])).push(L);
      if (this.files[name]) this._prioritize(name);
      this._startExtra(L);
      return {
        get playing() { return !!L.handle; },
        setPosition(p) {
          if (!p) return;
          L.pos = { x: p.x, y: p.y, z: p.z };
          if (L.handle && L.handle.panner) self._setPannerPos(L.handle.panner, L.pos);
        },
        setVolume(v) {
          v = Math.max(0, +v || 0);
          if (Math.abs(v - L.vol) < 0.01) return;
          L.vol = v;
          if (L.handle && L.handle.gain) self._glide(L.handle.gain.gain, Math.max(0.0001, self._level(L.handle.file) * v), 0.3);
        },
        stop(fade) {
          if (L.stopped) return;
          L.stopped = true;
          if (L.handle) L.handle.stop(fade || LOOP_FADE_OUT);
          const i = self._extra.indexOf(L);
          if (i >= 0) self._extra.splice(i, 1);
        }
      };
    }

    _startExtra(L) {
      if (L.stopped || L.handle || !this._ready()) return;
      const file = this.files[L.name] ? L.name : this._pickName(L.name);
      if (!file || !this.buffers[file]) return;
      const o = L.opts;
      const h = this._playFile(file, { loop: true, bus: o.bus || 'ambience', fadeIn: o.fadeIn || LOOP_FADE_IN, volume: Math.max(0.0001, L.vol), pos: L.pos,
        refDistance: o.refDistance, maxDistance: o.maxDistance, rolloff: o.rolloff }, null);
      if (h) { L.handle = h; L.pending = false; }
    }

    // 止める。what: 'ambience' | 'music' | play() が返したハンドル | 省略で両ループ
    stop(what) {
      if (what && typeof what.stop === 'function') { what.stop(0.05); return; }
      const kinds = what ? [what] : ['ambience', 'music'];
      for (const k of kinds) {
        const L = this._loops[k];
        if (!L) continue;
        if (L.handle) L.handle.stop(LOOP_FADE_OUT);
        this._loops[k] = null;
      }
    }

    // ---------- ゲームから呼ぶ音 ----------

    // 銃声。kind: 'p90' | 'shotgun' | 'rifle'（= p90）。sounds: 武器定義の { fire, tail, reload }（省略可）
    shoot(kind, sounds) {
      if (!this._ready()) return;
      const k = Audio.weaponKey(kind);
      const fire = (sounds && sounds.fire) || (k + '_fire');
      const tail = (sounds && sounds.tail) || (k + '_tail');
      // 自分の銃声は 'self' で数える（他の人の同じ武器の銃声に間引かれない）
      this.play(fire, { volume: 1, priority: 2, channel: 'self' });
      if (this._pickName(tail)) this.play(tail, { volume: 0.5, synth: false, channel: 'self' }); // 残響はファイルがあるときだけ
    }

    static weaponKey(kind) {
      if (kind === 'shotgun' || kind === 'rifle' || kind === 'sniper' || kind === 'pistol' || kind === 'lmg') return kind;
      return 'p90';
    }

    // 敵の銃声。pos（世界座標）があれば 3D、無ければ従来の距離減衰だけ
    enemyShoot(distance, pos) {
      if (!this._ready()) return;
      if (pos) {
        this.play('enemy_fire', { pos, volume: 1, refDistance: 6 });
      } else {
        const vol = Math.max(0.05, 0.5 - (distance || 0) / 60) / 0.5;
        this.play('enemy_fire', { volume: vol });
      }
    }

    empty(kind, sounds) {
      this.play('empty');
    }

    // リロード音。戻り値は play() のハンドル（weapon.js がリロードをやめたとき stop する）か null
    reload(kind, sounds) {
      if (!this._ready()) return null;
      const name = (sounds && sounds.reload) || ('reload_' + Audio.weaponKey(kind));
      return this.play(name, { priority: 2, channel: 'self' });
    }

    // 敵に当てた
    hit() {
      this.play('hitmarker', { priority: 2 });
    }

    // 自分が被弾
    hurt() {
      this.play('hurt', { priority: 3 });
    }

    kill() {
      this.play('kill', { priority: 3 });
    }

    // 足音。surface: 'dirt' | 'concrete' | 'wood'（木の床）| 'metal'（非常階段・橋・甲板）。0.25 s 以内の連続呼び出しは無視、ピッチ ±8 %。
    // その面のファイルが無ければ concrete（dirt ⇔ concrete は互いに）
    footstep(surface) {
      if (!this._ready()) return;
      const now = this.ctx.currentTime;
      if (this._lastFootstep >= 0 && now - this._lastFootstep < FOOTSTEP_MIN_INTERVAL) return;
      this._lastFootstep = now;
      const s = (surface === 'concrete' || surface === 'wood' || surface === 'metal') ? surface : 'dirt';
      let name = 'footstep_' + s;
      if (!this._pickable(name)) {
        const other = 'footstep_' + (s === 'concrete' ? 'dirt' : 'concrete');
        if (this._pickable(other)) name = other;
      }
      this.play(name, { rate: 1 + (Math.random() * 2 - 1) * 0.08, volume: s === 'dirt' ? 0.9 : 1 });
    }

    // 梯子の 1 段（足の金属音）
    ladderStep() { this.play('ladder_step', { rate: 1 + (Math.random() * 2 - 1) * 0.06 }); }
    // 高い所から落ちた着地（落下ダメージのとき。land の代わり）
    landHard() { this.play('fall_land_hard', { priority: 2 }); }
    // 水: 飛び込み（pos があれば 3D。heavy = 車が沈む）/ ひとかき
    splash(pos, heavy) { this.play('splash', { pos, volume: heavy ? 1 : 0.85, rate: heavy ? 0.8 : 1, priority: 2, refDistance: heavy ? 8 : 3 }); }
    swimStroke() { this.play('swim_stroke', { rate: 1 + (Math.random() * 2 - 1) * 0.06 }); }

    _pickable(base) {
      return !!(this.files[base] || (this.variants[base] && this.variants[base].length));
    }

    // 着弾。surface: 'concrete' | 'metal' | 'flesh'。pos があれば 3D
    impact(surface, pos) {
      const s = (surface === 'metal' || surface === 'flesh') ? surface : 'concrete';
      this.play('impact_' + s, { pos, rate: 1 + (Math.random() * 2 - 1) * 0.06 });
    }

    // 弾が耳元を抜ける音
    whizz(pos) {
      this.play('whizz', { pos, rate: 1 + (Math.random() * 2 - 1) * 0.1, refDistance: 1, priority: 2 });
    }

    // 薬莢が落ちる音
    casing(pos) {
      this.play('casing', { pos, rate: 1 + (Math.random() * 2 - 1) * 0.1, delay: 0.25 + Math.random() * 0.15, priority: 0.5 });
    }

    jump() { this.play('jump'); }
    land() { this.play('land'); }

    // 乗り物に乗った: エンジン音のデコードを優先する
    prepareEngine() {
      for (const n of ['engine_loop', 'engine_idle']) if (this.files[n]) this._prioritize(n);
    }

    // 乗り物のエンジン音。戻り値 { set(rpm, volume), setPosition(pos), stop() } か null（まだ鳴らせない）。
    // rpm 0..1（0 = アイドル）。ファイル engine_idle / engine_loop があればクロスフェード + playbackRate（0.6〜2.2 倍）、
    // どちらも無ければオシレータで合成。ファイルがデコード中なら合成で始めてデコード後に差し替える。
    // set / setPosition は毎フレーム呼んでよい（中で engineHz / listenerHz に間引き、変化が無ければ何もしない）
    engine(pos) {
      if (!this._ready()) return null;
      const ctx = this.ctx;
      const self = this;
      const out = this._out({ pos: pos || { x: 0, y: 0, z: 0 }, refDistance: 3, maxDistance: 90 }, 'sfx');
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(out.node);
      const ev = this._newVoice({ key: 'engine', budget: false, nodes: [master, out.panner], gain: master });
      const voices = {};      // 'loop' | 'idle' -> { src, gain, level }
      let synth = null;
      let stopped = false;
      const want = { rpm: 0, vol: 1 };
      const done = { rpm: -1, vol: -1, mode: '' };
      let lastApply = -1, lastPos = -1;
      const lp = { x: NaN, y: NaN, z: NaN };
      const wantFiles = this._pickable('engine_loop');
      const startVoice = (kind, name) => {
        if (voices[kind] || !this.buffers[name]) return;
        const src = ctx.createBufferSource();
        src.buffer = this.buffers[name];
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(g);
        g.connect(master);
        src.start();
        ev.nodes.push(src, g);
        ev.sources.push(src);
        voices[kind] = { src, gain: g, level: this._level(name) };
      };
      const startSynth = () => {
        if (synth) return;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 42;
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = 21;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        filter.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        const sg = ctx.createGain();
        sg.gain.value = 0.5;
        osc.connect(filter); filter.connect(g);
        sub.connect(sg); sg.connect(g);
        g.connect(master);
        osc.start(); sub.start();
        const sv = this._newVoice({ key: 'engine_synth', budget: false, nodes: [osc, sub, filter, g, sg], sources: [osc, sub], gain: g });
        synth = { osc, sub, filter, gain: g, voice: sv };
      };
      const stopSynth = () => {
        if (!synth) return;
        const s = synth; synth = null;
        this._stopVoice(s.voice, 0.3);
      };
      if (wantFiles) {
        this._prioritize('engine_loop');
        if (this.files.engine_idle) this._prioritize('engine_idle');
        startVoice('loop', 'engine_loop');
        if (this._pickable('engine_idle')) startVoice('idle', 'engine_idle');
        if (!voices.loop) startSynth();
      } else {
        startSynth();
      }
      this.source = this.source === 'synth' && wantFiles ? 'mixed' : this.source;
      // 間引いてパラメータに反映する
      const apply = () => {
        const now = ctx.currentTime;
        if (lastApply >= 0 && now - lastApply < 0.9 / self.mix.engineHz) return;
        if (wantFiles) {
          if (!voices.loop) startVoice('loop', 'engine_loop');
          if (!voices.idle && self._pickable('engine_idle')) startVoice('idle', 'engine_idle');
          if (voices.loop && synth) stopSynth();
        }
        const mode = (voices.loop ? 'f' : '') + (voices.idle ? 'i' : '') + (synth ? 's' : '');
        const rpm = want.rpm, vol = want.vol;
        const rpmChanged = mode !== done.mode || Math.abs(rpm - done.rpm) > 0.004;
        const volChanged = Math.abs(vol - done.vol) > 0.004;
        if (!rpmChanged && !volChanged) return;
        lastApply = now;
        if (volChanged) self._glide(master.gain, Math.max(0.0001, vol), 0.05);
        if (rpmChanged) {
          if (voices.loop) {
            const v = voices.loop;
            if (v.src.playbackRate) self._glide(v.src.playbackRate, 0.6 + 1.6 * rpm, 0.08);
            const idleMix = voices.idle ? Math.max(0, 1 - rpm * 2.5) : 0;
            self._glide(v.gain.gain, Math.max(0.0001, v.level * (0.3 + 0.7 * rpm) * (1 - idleMix * 0.6)), 0.08);
            if (voices.idle) self._glide(voices.idle.gain.gain, Math.max(0.0001, voices.idle.level * idleMix), 0.08);
          }
          if (synth) {
            const f = 40 * (1 + 2.2 * rpm);
            self._glide(synth.osc.frequency, f, 0.08);
            self._glide(synth.sub.frequency, f / 2, 0.08);
            self._glide(synth.filter.frequency, 280 + 1400 * rpm, 0.08);
            self._glide(synth.gain.gain, 0.18 + 0.22 * rpm, 0.08);
          }
        }
        done.rpm = rpm; done.vol = vol; done.mode = mode;
      };
      return {
        set(rpm, volume) {
          if (stopped) return;
          want.rpm = Math.max(0, Math.min(1, rpm || 0));
          want.vol = Math.max(0, volume == null ? 1 : volume);
          apply();
        },
        setPosition(p) {
          if (stopped || !p || !out.panner) return;
          const now = ctx.currentTime;
          if (lastPos >= 0 && now - lastPos < 0.9 / self.mix.listenerHz) return;
          const dx = p.x - lp.x, dy = p.y - lp.y, dz = p.z - lp.z;
          if (lastPos >= 0 && dx * dx + dy * dy + dz * dz < 0.0004) return;
          lastPos = now; lp.x = p.x; lp.y = p.y; lp.z = p.z;
          self._setPannerPos(out.panner, p);
        },
        stop() {
          if (stopped) return;
          stopped = true;
          stopSynth();
          self._stopVoice(ev, 0.35);
        }
      };
    }
    // ヘリに近づいた・乗った: ローター音のデコードを優先する
    prepareRotor() {
      for (const n of ['heli_start', 'heli_rotor', 'heli_wind']) if (this.files[n]) this._prioritize(n);
    }

    // ヘリのローター音。戻り値 { set(rpm, load, wind, fade), setPosition(pos), stop() } か null（まだ鳴らせない）。
    //   heli_rotor（ループ、3D）: 再生速度 = 回転数 rpm（0..1）と負荷 load（-1 降下 .. +1 上昇・高速）で 0.7〜1.4 倍、音量は回転数。
    //   heli_wind（ループ、乗っている人だけ: パンナーを通さずそのまま sfx へ）: wind（0..1、速さ）で音量と 0.85〜1.2 倍。
    //   fade（0..1）: 始動の音（heli_start）が鳴っている間はループを後から重ねる係数。
    //   ファイルがまだデコードされていなければ合成（羽根を切るノイズを 7 Hz で区切る + 28 Hz のうなり）で始め、デコード後に差し替える。
    //   エンジン音と同じ規則: パラメータは _glide（engineHz まで・変化が無ければ書かない）、位置は _setNow（listenerHz まで）
    rotor(pos) {
      if (!this._ready()) return null;
      const ctx = this.ctx;
      const self = this;
      const out = this._out({ pos: pos || { x: 0, y: 0, z: 0 }, refDistance: 7, maxDistance: 500, rolloff: 1 }, 'sfx');
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(out.node);
      const ev = this._newVoice({ key: 'rotor', budget: false, nodes: [master, out.panner], gain: master });
      const loops = {};       // 'rotor' | 'wind' -> { src, gain, level }
      let synth = null;
      let stopped = false;
      const want = { rpm: 0, load: 0, wind: 0, fade: 1 };
      const done = { rate: -1, gain: -1, wg: -1, wr: -1, mode: '' };
      let lastApply = -1, lastPos = -1;
      const lp = { x: NaN, y: NaN, z: NaN };
      const wantFiles = this._pickable('heli_rotor');
      const startLoop = (kind, name, dest) => {
        if (loops[kind] || !this.buffers[name]) return;
        const src = ctx.createBufferSource();
        src.buffer = this.buffers[name];
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(g);
        g.connect(dest);
        src.start();
        ev.nodes.push(src, g);
        ev.sources.push(src);
        loops[kind] = { src, gain: g, level: this._level(name) };
      };
      const startSynth = () => {
        if (synth) return;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer || this._makeNoise(1.0);
        noise.loop = true;
        const lp1 = ctx.createBiquadFilter();
        lp1.type = 'lowpass'; lp1.frequency.value = 650; lp1.Q.value = 0.7;
        const am = ctx.createGain();
        am.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.type = 'square'; lfo.frequency.value = 7;
        const lfoG = ctx.createGain();
        lfoG.gain.value = 0.45;
        const hum = ctx.createOscillator();
        hum.type = 'triangle'; hum.frequency.value = 28;
        const humG = ctx.createGain();
        humG.gain.value = 0.35;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        noise.connect(lp1); lp1.connect(am); hum.connect(humG); humG.connect(am);
        lfo.connect(lfoG); lfoG.connect(am.gain);
        am.connect(g); g.connect(master);
        noise.start(); lfo.start(); hum.start();
        const sv = this._newVoice({ key: 'rotor_synth', budget: false, nodes: [noise, lp1, am, lfo, lfoG, hum, humG, g], sources: [noise, lfo, hum], gain: g });
        synth = { lfo, hum, lp: lp1, gain: g, voice: sv };
      };
      const stopSynth = () => {
        if (!synth) return;
        const s = synth; synth = null;
        this._stopVoice(s.voice, 0.3);
      };
      if (wantFiles) {
        this.prepareRotor();
        startLoop('rotor', 'heli_rotor', master);
        if (!loops.rotor) startSynth();
      } else startSynth();
      this.source = this.source === 'synth' && wantFiles ? 'mixed' : this.source;
      const apply = () => {
        const now = ctx.currentTime;
        if (lastApply >= 0 && now - lastApply < 0.9 / self.mix.engineHz) return;
        if (wantFiles) {
          if (!loops.rotor) startLoop('rotor', 'heli_rotor', master);
          if (loops.rotor && synth) stopSynth();
        }
        if (want.wind > 0.02 && !loops.wind && self._pickable('heli_wind')) startLoop('wind', 'heli_wind', self.buses.sfx);
        const rpm = want.rpm;
        const rate = Math.max(0.7, Math.min(1.4, 0.7 + 0.3 * rpm + (rpm > 0.85 ? want.load * 0.3 : 0)));
        const gain = Math.max(0.0001, Math.pow(rpm, 1.5) * want.fade);
        const wg = Math.max(0.0001, Math.pow(want.wind, 1.5));
        const wr = 0.85 + 0.35 * want.wind;
        const mode = (loops.rotor ? 'f' : '') + (loops.wind ? 'w' : '') + (synth ? 's' : '');
        const ch = (a, b, eps) => Math.abs(a - b) > eps;
        if (mode === done.mode && !ch(rate, done.rate, 0.004) && !ch(gain, done.gain, 0.004) && !ch(wg, done.wg, 0.004) && !ch(wr, done.wr, 0.004)) return;
        lastApply = now;
        if (mode !== done.mode || ch(gain, done.gain, 0.004)) self._glide(master.gain, gain, 0.08);
        if (loops.rotor) {
          const v = loops.rotor;
          if (mode !== done.mode || ch(rate, done.rate, 0.004)) { if (v.src.playbackRate) self._glide(v.src.playbackRate, rate, 0.1); }
          if (mode !== done.mode) self._glide(v.gain.gain, v.level, 0.1);
        }
        if (synth && (mode !== done.mode || ch(rate, done.rate, 0.004))) {
          self._glide(synth.lfo.frequency, 7 * rate, 0.1);
          self._glide(synth.hum.frequency, 28 * rate, 0.1);
          self._glide(synth.lp.frequency, 450 + 450 * rate, 0.1);
          if (mode !== done.mode) self._glide(synth.gain.gain, 0.5, 0.1);
        }
        if (loops.wind && (mode !== done.mode || ch(wg, done.wg, 0.004) || ch(wr, done.wr, 0.004))) {
          const w = loops.wind;
          self._glide(w.gain.gain, Math.max(0.0001, w.level * wg), 0.15);
          if (w.src.playbackRate) self._glide(w.src.playbackRate, wr, 0.15);
        }
        done.rate = rate; done.gain = gain; done.wg = wg; done.wr = wr; done.mode = mode;
      };
      return {
        set(rpm, load, wind, fade) {
          if (stopped) return;
          want.rpm = Math.max(0, Math.min(1, +rpm || 0));
          want.load = Math.max(-1, Math.min(1, +load || 0));
          want.wind = Math.max(0, Math.min(1, +wind || 0));
          want.fade = fade == null ? 1 : Math.max(0, Math.min(1, +fade || 0));
          apply();
        },
        setPosition(p) {
          if (stopped || !p || !out.panner) return;
          const now = ctx.currentTime;
          if (lastPos >= 0 && now - lastPos < 0.9 / self.mix.listenerHz) return;
          const dx = p.x - lp.x, dy = p.y - lp.y, dz = p.z - lp.z;
          if (lastPos >= 0 && dx * dx + dy * dy + dz * dz < 0.0004) return;
          lastPos = now; lp.x = p.x; lp.y = p.y; lp.z = p.z;
          self._setPannerPos(out.panner, p);
        },
        stop(fade) {
          if (stopped) return;
          stopped = true;
          stopSynth();
          const f = fade || 0.6;
          if (loops.wind) self._glide(loops.wind.gain.gain, 0.0001, f / 4); // 風はパンナーを通らないので個別に下げる
          self._stopVoice(ev, f);
        }
      };
    }
    // 戦闘機に近づいた・乗った: エンジン・機関砲・カタパルトの音のデコードを優先する
    prepareJet() {
      for (const n of ['jet_engine', 'jet_afterburner', 'cannon_m61', 'cannon_tail', 'catapult_launch', 'arrest_catch', 'gear_motor', 'canopy_motor', 'heli_wind', 'explosion_large']) if (this.files[n]) this._prioritize(n);
    }

    // 最後に setListener で書いたリスナーの位置（無ければ null）。戦闘機のフライバイの判定に使う
    listenerPosition() { return this._hasListenerPos ? this._lpos : null; }

    // 戦闘機のエンジン音。戻り値 { set(n, ab, wind, spin, cockpit), setPosition(pos), stop(fade) } か null（まだ鳴らせない）。
    //   jet_engine（ループ、3D: ref 25 m・max 1500 m）: 再生速度 0.6 + 0.9 × n（n = 回転数の進み 0..1。アイドル 0.6 倍〜ミリタリー 1.5 倍）、
    //   音量 0.55 + 0.45 × n（spin = 始動 0..1 を掛ける。cockpit（一人称の操縦席）なら 0.63 倍）。
    //   jet_afterburner（同じパンナーに重ねる）: 音量 ab（0..1）、再生速度 0.9〜1.15。
    //   heli_wind（乗っている人だけ: パンナーを通さず sfx へ）: wind（0..1、速さ）で音量と 0.85〜1.2 倍。
    //   ファイルがデコード中なら合成（帯域ノイズ + 2.2 kHz の正弦）で始め、デコード後に差し替える。rotor() と同じ規則
    //   （パラメータは _glide を engineHz まで・変化が無ければ書かない、位置は _setNow を listenerHz まで、止めたら全部外す）
    jet(pos) {
      if (!this._ready()) return null;
      const ctx = this.ctx;
      const self = this;
      const out = this._out({ pos: pos || { x: 0, y: 0, z: 0 }, refDistance: 25, maxDistance: 1500, rolloff: 1 }, 'sfx');
      const master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(out.node);
      const ev = this._newVoice({ key: 'jet', budget: false, nodes: [master, out.panner], gain: master });
      const loops = {};
      let synth = null;
      let stopped = false;
      const want = { n: 0, ab: 0, wind: 0, spin: 1, cockpit: false };
      const done = { rate: -1, gain: -1, abg: -1, abr: -1, wg: -1, wr: -1, mode: '' };
      let lastApply = -1, lastPos = -1;
      const lp = { x: NaN, y: NaN, z: NaN };
      const wantFiles = this._pickable('jet_engine');
      const startLoop = (kind, name, dest) => {
        if (loops[kind] || !this.buffers[name]) return;
        const src = ctx.createBufferSource();
        src.buffer = this.buffers[name];
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(g);
        g.connect(dest);
        src.start();
        ev.nodes.push(src, g);
        ev.sources.push(src);
        loops[kind] = { src, gain: g, level: this._level(name) };
      };
      const startSynth = () => {
        if (synth) return;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer || this._makeNoise(1.0);
        noise.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
        const whine = ctx.createOscillator();
        whine.type = 'sine'; whine.frequency.value = 2200;
        const wg = ctx.createGain();
        wg.gain.value = 0.05;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        noise.connect(bp); bp.connect(g); whine.connect(wg); wg.connect(g); g.connect(master);
        noise.start(); whine.start();
        const sv = this._newVoice({ key: 'jet_synth', budget: false, nodes: [noise, bp, whine, wg, g], sources: [noise, whine], gain: g });
        synth = { bp, whine, gain: g, voice: sv };
      };
      const stopSynth = () => {
        if (!synth) return;
        const s = synth; synth = null;
        this._stopVoice(s.voice, 0.3);
      };
      if (wantFiles) {
        this.prepareJet();
        startLoop('engine', 'jet_engine', master);
        if (!loops.engine) startSynth();
      } else startSynth();
      this.source = this.source === 'synth' && wantFiles ? 'mixed' : this.source;
      const apply = () => {
        const now = ctx.currentTime;
        if (lastApply >= 0 && now - lastApply < 0.9 / self.mix.engineHz) return;
        if (wantFiles) {
          if (!loops.engine) startLoop('engine', 'jet_engine', master);
          if (loops.engine && synth) stopSynth();
        }
        if (want.ab > 0.02 && !loops.ab && self._pickable('jet_afterburner')) startLoop('ab', 'jet_afterburner', master);
        if (want.wind > 0.02 && !loops.wind && self._pickable('heli_wind')) startLoop('wind', 'heli_wind', self.buses.sfx);
        const n = want.n;
        const rate = Math.max(0.5, Math.min(1.5, (0.6 + 0.9 * n) * (0.55 + 0.45 * want.spin)));
        const gain = Math.max(0.0001, (0.55 + 0.45 * n) * want.spin * (want.cockpit ? 0.63 : 1));
        const abg = Math.max(0.0001, want.ab * (want.cockpit ? 0.7 : 1));
        const abr = 0.9 + 0.25 * n;
        const wg = Math.max(0.0001, Math.pow(want.wind, 1.5) * (want.cockpit ? 0.5 : 1));
        const wr = 0.85 + 0.35 * want.wind;
        const mode = (loops.engine ? 'f' : '') + (loops.ab ? 'a' : '') + (loops.wind ? 'w' : '') + (synth ? 's' : '');
        const ch = (a, b, eps) => Math.abs(a - b) > eps;
        if (mode === done.mode && !ch(rate, done.rate, 0.004) && !ch(gain, done.gain, 0.004) && !ch(abg, done.abg, 0.004) && !ch(abr, done.abr, 0.004) && !ch(wg, done.wg, 0.004) && !ch(wr, done.wr, 0.004)) return;
        lastApply = now;
        const nm = mode !== done.mode;
        if (nm || ch(gain, done.gain, 0.004)) self._glide(master.gain, gain, 0.08);
        if (loops.engine) {
          const v = loops.engine;
          if (nm || ch(rate, done.rate, 0.004)) { if (v.src.playbackRate) self._glide(v.src.playbackRate, rate, 0.1); }
          if (nm) self._glide(v.gain.gain, v.level, 0.1);
        }
        if (loops.ab && (nm || ch(abg, done.abg, 0.004) || ch(abr, done.abr, 0.004))) {
          const v = loops.ab;
          // 点火 0.25 s・消えるのは 0.4 s（時定数はその 1/3）
          self._glide(v.gain.gain, Math.max(0.0001, v.level * abg / Math.max(0.05, gain)), abg > done.abg ? 0.08 : 0.13);
          if (v.src.playbackRate) self._glide(v.src.playbackRate, abr, 0.1);
        }
        if (synth && (nm || ch(rate, done.rate, 0.004))) {
          self._glide(synth.whine.frequency, 2200 * rate, 0.1);
          self._glide(synth.bp.frequency, 500 + 900 * rate + 600 * want.ab, 0.1);
          if (nm) self._glide(synth.gain.gain, 0.45, 0.1);
        }
        if (loops.wind && (nm || ch(wg, done.wg, 0.004) || ch(wr, done.wr, 0.004))) {
          const w = loops.wind;
          self._glide(w.gain.gain, Math.max(0.0001, w.level * wg), 0.15);
          if (w.src.playbackRate) self._glide(w.src.playbackRate, wr, 0.15);
        }
        done.rate = rate; done.gain = gain; done.abg = abg; done.abr = abr; done.wg = wg; done.wr = wr; done.mode = mode;
      };
      return {
        set(n, ab, wind, spin, cockpit) {
          if (stopped) return;
          want.n = Math.max(0, Math.min(1, +n || 0));
          want.ab = Math.max(0, Math.min(1, +ab || 0));
          want.wind = Math.max(0, Math.min(1, +wind || 0));
          want.spin = spin == null ? 1 : Math.max(0, Math.min(1, +spin || 0));
          want.cockpit = !!cockpit;
          apply();
        },
        setPosition(p) {
          if (stopped || !p || !out.panner) return;
          const now = ctx.currentTime;
          if (lastPos >= 0 && now - lastPos < 0.9 / self.mix.listenerHz) return;
          const dx = p.x - lp.x, dy = p.y - lp.y, dz = p.z - lp.z;
          if (lastPos >= 0 && dx * dx + dy * dy + dz * dz < 0.0004) return;
          lastPos = now; lp.x = p.x; lp.y = p.y; lp.z = p.z;
          self._setPannerPos(out.panner, p);
        },
        stop(fade) {
          if (stopped) return;
          stopped = true;
          stopSynth();
          const f = fade || 0.6;
          if (loops.wind) self._glide(loops.wind.gain.gain, 0.0001, f / 4);
          self._stopVoice(ev, f);
        }
      };
    }

    swap() { this.play('weapon_swap'); }
    ads(on) { this.play(on ? 'ads_in' : 'ads_out', { volume: 0.5 }); }
    death() { this.play('death', { priority: 3 }); }

    // ---------- 当たった面の判定（game.js が使うヘルパー） ----------

    // nav の箱の type → 面の種類
    static surfaceForType(type) {
      if (type === 'container' || type === 'barrel' || type === 'lamp' || type === 'metal') return 'metal';
      if (type === 'enemy' || type === 'flesh') return 'flesh';
      return 'concrete';
    }

    // 足音の面: 道路（|x| or |z| < roadWidth/2）なら concrete、それ以外は dirt
    static footstepSurfaceAt(level, x, z) {
      const half = ((level && level.roadWidth) || 7) / 2;
      return (Math.abs(x) < half || Math.abs(z) < half) ? 'concrete' : 'dirt';
    }

    // 着弾の面: 当たった点 {x,y,z} が nav の箱の表面にあればその type から、地面なら concrete
    static impactSurfaceAt(nav, point) {
      if (!nav || !point) return 'concrete';
      if (point.y <= 0.02) return 'concrete';
      const eps = 0.05;
      const solids = nav.solids || nav.boxes || [];
      for (const b of solids) {
        if (!b || b.w == null) continue;
        if (point.x < b.x - b.w / 2 - eps || point.x > b.x + b.w / 2 + eps) continue;
        if (point.z < b.z - b.d / 2 - eps || point.z > b.z + b.d / 2 + eps) continue;
        if (point.y < -eps || point.y > b.h + eps) continue;
        return Audio.surfaceForType(b.type);
      }
      return 'concrete';
    }

    // ---------- 合成音（ファイルが無い／まだデコード中のとき） ----------
    // 合成関数の中で作るノードは必ず _n() で、音源は _run() で鳴らす（ボイスに登録されて鳴り終わったら切り離される）

    // base 名 → 合成関数 (dest, volume, opts)
    _synthFor(base) {
      const S = Audio.SYNTH;
      if (S[base]) return S[base];
      if (/_tail$/.test(base)) return null;           // 残響はファイル専用
      if (/^footstep_/.test(base)) return S.footstep;
      if (/^impact_/.test(base)) return null;
      if (/^reload_/.test(base)) return S.reload;
      if (/_fire$/.test(base)) return S.fire;
      if (/^ambience_|^music_/.test(base)) return null; // ループは無音
      return null;
    }

    _osc(type, freq) {
      const o = this._n(this.ctx.createOscillator());
      o.type = type;
      if (freq != null) o.frequency.value = freq;
      return o;
    }

    _gainNode() { return this._n(this.ctx.createGain()); }

    _filter(type, freq, q) {
      const f = this._n(this.ctx.createBiquadFilter());
      f.type = type;
      f.frequency.value = freq;
      if (q != null) f.Q.value = q;
      return f;
    }

    // 短い矩形波のクリック
    _click(freq, dur, vol, dest, when) {
      if (!this._ready()) return;
      const t = (when != null) ? when : this.ctx.currentTime;
      const osc = this._osc('square', freq);
      const g = this._gainNode();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g);
      g.connect(dest || this.buses.sfx || this.master);
      this._run(osc, t, t + dur + 0.01);
    }

    // ノイズバースト（バンドパス/ローパス付き）
    _noise(dest, t, filterType, freq, q, vol, dur) {
      const noise = this._n(this.ctx.createBufferSource());
      noise.buffer = this.noiseBuffer;
      const f = this._filter(filterType, freq, q);
      const g = this._gainNode();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      noise.connect(f); f.connect(g); g.connect(dest);
      this._run(noise, t, t + dur + 0.05);
      return f;
    }

    // 正弦波のピッチ落ち
    _thump(dest, t, type, f0, f1, vol, dur) {
      const osc = this._osc(type, null);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur * 0.8);
      const g = this._gainNode();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(dest);
      this._run(osc, t, t + dur + 0.02);
    }

    // 従来互換: 音声ファイル（ArrayBuffer）を直接登録して鳴らす
    async loadBuffer(name, arrayBuffer) {
      if (!this.ctx) return;
      const copy = arrayBuffer.slice(0);
      const buf = await new Promise((resolve, reject) => {
        let ret = null;
        try {
          ret = this.ctx.decodeAudioData(copy, resolve, reject);
        } catch (e) { reject(e); return; }
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
      });
      this.buffers[name] = buf;
      if (!this.files[name]) this.files[name] = '(memory)';
    }

    playBuffer(name, volume) {
      if (!this._ready() || !this.buffers[name]) return null;
      return this.play(name, { volume: volume == null ? 1 : volume, synth: false });
    }
  };

  // 合成音のテーブル。this は MR.Audio のインスタンス。(dest, volume, opts)
  MR.Audio.SYNTH = {
    // 銃声: ノイズのバースト + 低音のドン（opts.kind / 名前で p90 と shotgun を区別）
    fire(dest, vol, opts) {
      const t = this.ctx.currentTime;
      const big = /shotgun/.test(opts && opts._name || '') || (opts && opts.big);
      this._noise(dest, t, 'bandpass', big ? 600 : 1400, 0.7, (big ? 1.0 : 0.7) * vol, big ? 0.28 : 0.12);
      this._thump(dest, t, 'sine', big ? 110 : 160, 40, 0.8 * vol, 0.18);
    },
    shotgun_fire(dest, vol, opts) {
      MR.Audio.SYNTH.fire.call(this, dest, vol, Object.assign({}, opts, { big: true }));
    },
    // 敵の銃声（こもった音）
    enemy_fire(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 900, null, 0.5 * vol, 0.15);
    },
    empty(dest, vol) { this._click(2000, 0.04, 0.3 * vol, dest); },
    reload(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(900, 0.05, 0.4 * vol, dest, t);
      this._click(1400, 0.05, 0.4 * vol, dest, t + 0.45);
      this._click(700, 0.08, 0.5 * vol, dest, t + 0.9);
    },
    reload_shotgun(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(1100, 0.04, 0.35 * vol, dest, t);
      this._click(1100, 0.04, 0.35 * vol, dest, t + 0.5);
      this._click(1100, 0.04, 0.35 * vol, dest, t + 1.0);
      this._click(600, 0.09, 0.5 * vol, dest, t + 1.6);
      this._click(800, 0.06, 0.4 * vol, dest, t + 1.8);
    },
    hitmarker(dest, vol) { this._click(2600, 0.03, 0.35 * vol, dest); },
    hurt(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'triangle', 220, 90, 0.5 * vol, 0.25);
    },
    kill(dest, vol) {
      const t = this.ctx.currentTime;
      [660, 880].forEach((f, i) => {
        const osc = this._osc('square', f);
        const g = this._gainNode();
        g.gain.setValueAtTime(0.0001, t + i * 0.07);
        g.gain.linearRampToValueAtTime(0.25 * vol, t + i * 0.07 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.12);
        osc.connect(g); g.connect(dest);
        this._run(osc, t + i * 0.07, t + i * 0.07 + 0.15);
      });
    },
    // 足音: ローパスした短いノイズ + かすかな低音
    footstep(dest, vol, opts) {
      const t = this.ctx.currentTime;
      const r = (opts && opts.rate) || 1;
      this._noise(dest, t, 'lowpass', 500 * r, null, 0.18 * vol, 0.08);
      this._thump(dest, t, 'sine', 120 * r, 60, 0.12 * vol, 0.1);
    },
    impact_concrete(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'bandpass', 2500, 1.2, 0.35 * vol, 0.06);
    },
    impact_metal(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'bandpass', 3200, 2.0, 0.3 * vol, 0.05);
      this._thump(dest, t, 'triangle', 1800, 1200, 0.2 * vol, 0.18);
    },
    impact_flesh(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 700, null, 0.3 * vol, 0.08);
      this._thump(dest, t, 'sine', 150, 70, 0.25 * vol, 0.12);
    },
    whizz(dest, vol) {
      const t = this.ctx.currentTime;
      const f = this._noise(dest, t, 'bandpass', 3000, 6, 0.4 * vol, 0.16);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.16);
    },
    casing(dest, vol, opts) {
      const t = this.ctx.currentTime + ((opts && opts.delay) || 0);
      this._click(4200, 0.02, 0.12 * vol, dest, t);
      this._click(5200, 0.02, 0.08 * vol, dest, t + 0.07);
    },
    jump(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 900, null, 0.15 * vol, 0.12);
    },
    land(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 400, null, 0.3 * vol, 0.1);
      this._thump(dest, t, 'sine', 110, 50, 0.25 * vol, 0.14);
    },
    weapon_swap(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(800, 0.05, 0.3 * vol, dest, t);
      this._click(1300, 0.05, 0.3 * vol, dest, t + 0.12);
    },
    ads_in(dest, vol) { this._click(1600, 0.03, 0.15 * vol, dest); },
    ads_out(dest, vol) { this._click(1200, 0.03, 0.15 * vol, dest); },
    // ボルトアクション（上げ・引き・押し・下げの 4 クリック）
    bolt_cycle(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(900, 0.04, 0.4 * vol, dest, t);
      this._click(700, 0.05, 0.4 * vol, dest, t + 0.18);
      this._click(1100, 0.04, 0.35 * vol, dest, t + 0.38);
      this._click(800, 0.05, 0.4 * vol, dest, t + 0.5);
    },
    death(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sawtooth', 90, 35, 0.35 * vol, 1.2);
      this._thump(dest, t + 0.5, 'sine', 60, 50, 0.3 * vol, 0.3);
      this._thump(dest, t + 1.1, 'sine', 60, 50, 0.3 * vol, 0.3);
    },
    // ---------- 街 ----------
    footstep_wood(dest, vol, opts) {
      const t = this.ctx.currentTime;
      const r = (opts && opts.rate) || 1;
      this._noise(dest, t, 'lowpass', 380 * r, null, 0.16 * vol, 0.07);
      this._thump(dest, t, 'sine', 150 * r, 90, 0.16 * vol, 0.12);
    },
    // 金属（非常階段・甲板）: 足音 + 短い金属の響き
    footstep_metal(dest, vol, opts) {
      const t = this.ctx.currentTime;
      const r = (opts && opts.rate) || 1;
      this._noise(dest, t, 'lowpass', 600 * r, null, 0.16 * vol, 0.07);
      this._thump(dest, t, 'triangle', 520 * r, 470, 0.07 * vol, 0.12);
    },
    ladder_step(dest, vol, opts) {
      const t = this.ctx.currentTime;
      const r = (opts && opts.rate) || 1;
      this._noise(dest, t, 'lowpass', 700 * r, null, 0.12 * vol, 0.05);
      this._thump(dest, t, 'triangle', 610 * r, 560, 0.08 * vol, 0.1);
    },
    fall_land_hard(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 500, null, 0.5 * vol, 0.16);
      this._thump(dest, t, 'sine', 135, 58, 0.55 * vol, 0.3);
      this._click(900, 0.04, 0.12 * vol, dest, t + 0.06);
    },
    swim_stroke(dest, vol) {
      const t = this.ctx.currentTime;
      const f = this._noise(dest, t, 'lowpass', 900, null, 0.22 * vol, 0.32);
      f.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    },
    splash(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 1600, null, 0.55 * vol, 0.5);
      this._noise(dest, t + 0.05, 'bandpass', 700, 0.8, 0.3 * vol, 0.9);
      this._thump(dest, t, 'sine', 120, 45, 0.4 * vol, 0.25);
    },
    // ---------- 拾う・回復・パラシュート・安全地帯（フェーズ C3。ファイルが無いとき）----------
    pickup_weapon(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'bandpass', 1800, 0.8, 0.22 * vol, 0.12);
      this._click(700, 0.05, 0.35 * vol, dest, t + 0.12);
      this._click(1200, 0.04, 0.3 * vol, dest, t + 0.3);
      this._click(900, 0.06, 0.35 * vol, dest, t + 0.42);
    },
    pickup_ammo(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sine', 160, 80, 0.3 * vol, 0.1);
      for (let i = 0; i < 4; i++) this._click(2200 + i * 350, 0.025, 0.12 * vol, dest, t + 0.06 + i * 0.045);
    },
    pickup_med(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'highpass', 2500, null, 0.15 * vol, 0.18);
      this._click(1000, 0.04, 0.25 * vol, dest, t + 0.2);
    },
    heal(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'bandpass', 1400, 0.6, 0.12 * vol, 0.6);
      this._noise(dest, t + 0.8, 'bandpass', 900, 0.6, 0.12 * vol, 0.5);
      this._noise(dest, t + 1.6, 'bandpass', 1200, 0.6, 0.12 * vol, 0.5);
      this._click(800, 0.05, 0.25 * vol, dest, t + 2.6);
    },
    parachute_open(dest, vol) {
      const t = this.ctx.currentTime;
      const f = this._noise(dest, t, 'bandpass', 400, 0.7, 0.35 * vol, 0.62);
      f.frequency.exponentialRampToValueAtTime(1500, t + 0.6);
      this._thump(dest, t + 0.6, 'sine', 120, 45, 0.6 * vol, 0.35);
      this._noise(dest, t + 0.6, 'lowpass', 700, null, 0.45 * vol, 0.9);
    },
    // 安全地帯の外（1 秒ごと）: 低いうなり
    zone_damage(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sawtooth', 95, 70, 0.18 * vol, 0.32);
      this._noise(dest, t, 'bandpass', 3000, 2, 0.08 * vol, 0.2);
    },
    // ---------- 乗り物 ----------
    // スターター（上がっていく唸り）→ 点火
    engine_start(dest, vol) {
      const t = this.ctx.currentTime;
      const osc = this._osc('sawtooth', null);
      osc.frequency.setValueAtTime(60, t);
      osc.frequency.linearRampToValueAtTime(130, t + 0.7);
      const f = this._filter('lowpass', 500, null);
      const g = this._gainNode();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.25 * vol, t + 0.1);
      g.gain.setValueAtTime(0.25 * vol, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      osc.connect(f); f.connect(g); g.connect(dest);
      this._run(osc, t, t + 1.05);
      this._thump(dest, t + 0.75, 'sine', 90, 45, 0.4 * vol, 0.25);
    },
    // ヘリの始動（4 s）: スターターの唸りが上がり、点火の「ボッ」、タービンの高い音へ
    heli_start(dest, vol) {
      const t = this.ctx.currentTime;
      const osc = this._osc('sawtooth', null);
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.linearRampToValueAtTime(210, t + 1.8);
      osc.frequency.linearRampToValueAtTime(900, t + 3.6);
      const f = this._filter('lowpass', 900, null);
      const g = this._gainNode();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14 * vol, t + 0.4);
      g.gain.setValueAtTime(0.14 * vol, t + 3.4);
      g.gain.exponentialRampToValueAtTime(0.001, t + 3.95);
      osc.connect(f); f.connect(g); g.connect(dest);
      this._run(osc, t, t + 4.0);
      this._thump(dest, t + 1.05, 'sine', 110, 40, 0.5 * vol, 0.35);
      this._noise(dest, t + 1.0, 'lowpass', 600, null, 0.25 * vol, 2.8);
    },
    vehicle_door(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 700, null, 0.35 * vol, 0.1);
      this._thump(dest, t, 'sine', 140, 60, 0.4 * vol, 0.16);
      this._click(1800, 0.03, 0.2 * vol, dest, t + 0.05);
    },
    vehicle_impact(dest, vol) {
      const t = this.ctx.currentTime;
      this._noise(dest, t, 'lowpass', 900, null, 0.6 * vol, 0.25);
      this._thump(dest, t, 'triangle', 120, 40, 0.6 * vol, 0.3);
      this._click(2400, 0.04, 0.2 * vol, dest, t + 0.08);
      this._click(1900, 0.04, 0.15 * vol, dest, t + 0.17);
    },
    vehicle_explode(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sine', 70, 18, 1.0 * vol, 1.4);
      this._noise(dest, t, 'lowpass', 1800, null, 0.9 * vol, 0.6);
      this._noise(dest, t + 0.1, 'lowpass', 500, null, 0.6 * vol, 1.6);
      for (let i = 0; i < 6; i++) this._click(600 + Math.random() * 900, 0.03, 0.12 * vol, dest, t + 0.3 + Math.random() * 1.2);
    },
    tire_skid(dest, vol) {
      const t = this.ctx.currentTime;
      const f = this._noise(dest, t, 'bandpass', 1500, 8, 0.3 * vol, 0.5);
      f.frequency.linearRampToValueAtTime(1900, t + 0.5);
    },
    horn(dest, vol) {
      const t = this.ctx.currentTime;
      for (const freq of [420, 528]) {
        const osc = this._osc('square', freq);
        const f = this._filter('lowpass', 1600, null);
        const g = this._gainNode();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12 * vol, t + 0.03);
        g.gain.setValueAtTime(0.12 * vol, t + 0.55);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.connect(f); f.connect(g); g.connect(dest);
        this._run(osc, t, t + 0.7);
      }
    }
  };
  // ---------- 戦闘機（フェーズ E1）: ファイルがデコードされるまでの合成 ----------
  Object.assign(MR.Audio.SYNTH, {
    // 機関砲の 0.6 s の連射（100 Hz で区切ったノイズ）
    cannon_m61(dest, vol) {
      const t = this.ctx.currentTime;
      const noise = this._n(this.ctx.createBufferSource());
      noise.buffer = this.noiseBuffer;
      const f = this._filter('bandpass', 1400, 0.7);
      const am = this._gainNode();
      am.gain.value = 0.5;
      const lfo = this._osc('square', 100);
      const lg = this._gainNode();
      lg.gain.value = 0.5;
      const g = this._gainNode();
      g.gain.setValueAtTime(0.55 * vol, t);
      g.gain.setValueAtTime(0.55 * vol, t + 0.55);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      noise.connect(f); f.connect(am); lfo.connect(lg); lg.connect(am.gain); am.connect(g); g.connect(dest);
      this._run(noise, t, t + 0.72); this._run(lfo, t, t + 0.72);
      this._thump(dest, t, 'sine', 90, 50, 0.3 * vol, 0.6);
    },
    // カタパルト: 蒸気の唸りが上がって 2.4 s で止める音
    catapult_launch(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sine', 120, 50, 0.5 * vol, 0.3);
      const f = this._noise(dest, t + 0.05, 'bandpass', 250, 0.8, 0.5 * vol, 2.6);
      f.frequency.linearRampToValueAtTime(1400, t + 2.4);
      this._thump(dest, t + 2.4, 'sine', 70, 25, 0.8 * vol, 0.6);
      this._noise(dest, t + 2.4, 'lowpass', 2500, null, 0.4 * vol, 0.8);
    },
    // 着艦ワイヤー: どすん + ケーブルの唸りが下がる
    arrest_catch(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sine', 110, 35, 0.8 * vol, 0.4);
      this._noise(dest, t, 'lowpass', 1500, null, 0.5 * vol, 0.3);
      const osc = this._osc('sawtooth', null);
      osc.frequency.setValueAtTime(1000, t + 0.07);
      osc.frequency.exponentialRampToValueAtTime(180, t + 1.85);
      const fl = this._filter('lowpass', 1800, null);
      const g = this._gainNode();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12 * vol, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
      osc.connect(fl); fl.connect(g); g.connect(dest);
      this._run(osc, t, t + 1.95);
    },
    // 脚・キャノピーのモーター
    gear_motor(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(1500, 0.03, 0.2 * vol, dest, t);
      const osc = this._osc('sawtooth', null);
      osc.frequency.setValueAtTime(300, t + 0.05);
      osc.frequency.linearRampToValueAtTime(520, t + 1.3);
      const fl = this._filter('lowpass', 900, null);
      const g = this._gainNode();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.08 * vol, t + 0.15);
      g.gain.setValueAtTime(0.08 * vol, t + 1.25);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      osc.connect(fl); fl.connect(g); g.connect(dest);
      this._run(osc, t, t + 1.55);
      this._thump(dest, t + 1.32, 'triangle', 160, 70, 0.4 * vol, 0.15);
    },
    canopy_motor(dest, vol) {
      const t = this.ctx.currentTime;
      const osc = this._osc('sawtooth', 210);
      const fl = this._filter('lowpass', 700, null);
      const g = this._gainNode();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06 * vol, t + 0.1);
      g.gain.setValueAtTime(0.06 * vol, t + 2.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.25);
      osc.connect(fl); fl.connect(g); g.connect(dest);
      this._run(osc, t, t + 2.3);
      this._thump(dest, t + 2.22, 'triangle', 150, 60, 0.35 * vol, 0.15);
    },
    // フライバイ: 下がっていくバンドパスのノイズ
    jet_flyby(dest, vol) {
      const t = this.ctx.currentTime;
      const noise = this._n(this.ctx.createBufferSource());
      noise.buffer = this.noiseBuffer;
      const bp = this._filter('bandpass', 2600, 1.0);
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(350, t + 3.3);
      const g = this._gainNode();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7 * vol, t + 1.6);
      g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
      noise.connect(bp); bp.connect(g); g.connect(dest);
      this._run(noise, t, t + 3.55);
    },
    missile_launch(dest, vol) {
      const t = this.ctx.currentTime;
      this._click(900, 0.04, 0.3 * vol, dest, t);
      const f = this._noise(dest, t + 0.03, 'bandpass', 3000, 0.7, 0.6 * vol, 1.6);
      f.frequency.exponentialRampToValueAtTime(500, t + 1.5);
    },
    explosion_large(dest, vol) { MR.Audio.SYNTH.vehicle_explode.call(this, dest, vol * 1.1); },
    explosion_far(dest, vol) {
      const t = this.ctx.currentTime;
      this._thump(dest, t, 'sine', 50, 20, 0.6 * vol, 2.0);
      this._noise(dest, t, 'lowpass', 300, null, 0.5 * vol, 2.2);
    }
  });
  // 'p90_fire' / 'rifle_fire' も fire に
  MR.Audio.SYNTH.p90_fire = MR.Audio.SYNTH.fire;
  MR.Audio.SYNTH.rifle_fire = MR.Audio.SYNTH.fire;
  MR.Audio.SYNTH.reload_p90 = MR.Audio.SYNTH.reload;
  MR.Audio.SYNTH.reload_rifle = MR.Audio.SYNTH.reload;
  for (const k of ['sniper', 'pistol', 'lmg']) { MR.Audio.SYNTH[k + '_fire'] = MR.Audio.SYNTH.fire; MR.Audio.SYNTH['reload_' + k] = MR.Audio.SYNTH.reload; }
  MR.Audio.MIX_DEFAULTS = MIX_DEFAULTS;
})();
