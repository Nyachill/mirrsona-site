// ストーリーの中身（MR.Story。THREE / DOM を使わない = Node のテストが require する）。計画: dev-notes/plans/story/story-plan.md（rev 1）+ story-plan-rev2.md。
//   章は JSON のデータ（assets/story/chapters/*.json）で、決まった動詞（VERBS）だけを並べる（Apple の規約 8: データ。eval / Function / 式は無い）。
//   知らない動詞の章・needs が APP_LEVEL より大きい章は読まない（一覧に「アップデートが必要です」）。
//
// ■ 章の形（v1）: { id, v, needs, level, city, title, en, caption[], weather, systems{}, loadout{}, zones{ dark[] }, anchors{}, actors{}, groups{}, interact{},
//   shots{}, lines{}, intel[], steps[], fail[], rewards{}, rating{} }
//   step: { id, checkpoint?, obj?, count?, mark?[], do?[], on?[{ when, do, once? }], until, fail?[], then? }
//     do は順に実行（["wait", 秒] で次まで待つ）。until が成り立ったら then（無ければ次の step。{ "flag:x": "id", "else": "id" } は旗で分かれる）。
//     until / fail / on.when は出来事のとき と 10 Hz に見る。checkpoint の step は do を出し終えたら host に 'checkpoint' を出す。
// ■ 条件: VERBS.cond。場所の条件（near / inside / leave / actorNear / hpBelow）は host.query(name, args) に聞く。ほかは Runner が出来事から覚える。
// ■ 実行: Runner.drain() が host に渡す命令の列（{ verb, args, step }）。host（storymode.js）が game を動かし、起きたことを Runner.event(type, data) で返す。
// ■ 保存: toJSON / fromJSON（チェックポイント = step に入った直後の状態）。乱数は章 id + checkpoint の種（mulberry32）。
(function (root) {
  'use strict';
  const RELEASE = 17; // このアプリが出す章の版（story.json の release がこれ以下の draft の章は出した章 = isDraft が false）
  const APP_LEVEL = 2; // 2: billboard（看板の乗っ取り）・choice（2 つの選択）。この動詞を使う章は needs 2

  // 動詞の表（needs の段ごと）。値 = 引数の数の最小（-1 = 可変）
  const COND = {
    near: 2, inside: 2, leave: 2, time: 1, timerDone: 0, dead: 1, killed: 2, alive: 2, interact: 1, held: 1, picked: 1,
    inVehicle: 1, exitVehicle: 1, vehicleDead: 1, lifted: 1, done: 1, flag: 1, counter: 2, hpBelow: 1, actorNear: 3,
    civBoarded: 1, boarded: 0, playerDead: 0, landed: 3, all: -1, any: -1, not: 1, never: 0, always: 0
  };
  const ACTION = {
    obj: 1, mark: 1, unmark: 0, radio: 1, talk: 1, card: 0, cine: 1, spawn: 1, despawn: 1, ally: 2, civ: 2, director: 1,
    give: 1, take: 1, loadout: 0, weather: 1, music: 1, sfx: 1, explode: 1, breach: 1, support: 1, vtol: 1, vehicle: 2,
    fade: 1, teleport: 1, area: 1, timer: 1, set: 1, inc: 1, wait: 1, checkpoint: 0, relight: 1, blackout: 1, intel: 1,
    unlock: 1, end: 1, flag: 1, hint: 1, billboard: 1, choice: 1
  };
  // v2 で使う予定の動詞（今のアプリでは知らない = needs 2 の章だけ）
  const LATER = ['alert', 'boss', 'gunner', 'convoy'];

  // ---------- 小物 ----------
  function hash(s) { // FNV-1a 32 bit
    let h = 0x811c9dc5;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    const f = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.state = () => a; f.set = (v) => { a = v >>> 0; };
    return f;
  }
  const isArr = Array.isArray;
  const isObj = (o) => !!o && typeof o === 'object' && !isArr(o);

  // ---------- 検証 ----------
  // 章を見て、エラーの文の配列（空なら使える）。opts: { appLevel, cast（話す人の id の表）, limits: { radioChars, radioLines, talkLines } }
  function validate(ch, opts) {
    opts = opts || {};
    const app = opts.appLevel == null ? APP_LEVEL : opts.appLevel;
    const lim = Object.assign({ radioChars: 22, radioLines: 2, talkLines: 3 }, opts.limits || {});
    const err = [];
    const E = (m) => err.push(m);
    if (!isObj(ch)) return ['章が JSON の物ではありません'];
    if (typeof ch.id !== 'string' || !ch.id) E('id がありません');
    if (ch.v !== 1) E('v が 1 ではありません: ' + ch.v);
    if (!(ch.needs >= 1)) E('needs がありません');
    if (ch.needs > app) { E('needs ' + ch.needs + ' > APP_LEVEL ' + app); return err; }
    if (typeof ch.level !== 'string') E('level がありません');
    if (!isArr(ch.steps) || !ch.steps.length) { E('steps がありません'); return err; }
    const ids = new Set();
    for (const s of ch.steps) { if (!s || typeof s.id !== 'string') E('step に id がありません'); else if (ids.has(s.id)) E('step の id が重なっています: ' + s.id); else ids.add(s.id); }
    const lines = ch.lines || {}, groups = ch.groups || {}, actors = ch.actors || {}, shots = ch.shots || {}, inter = ch.interact || {}, anchors = ch.anchors || {};
    const cast = opts.cast || null;
    const choiceIds = new Set();
    const acts = [];
    for (const s of ch.steps) acts.push(...(s.do || []), ...[].concat(...(s.on || []).map((o) => (o && o.do) || [])));
    for (const k of Object.keys(ch.shots || {})) acts.push(...((ch.shots[k] && ch.shots[k].pre) || []), ...((ch.shots[k] && ch.shots[k].post) || []));
    for (const a of acts) if (isArr(a) && a[0] === 'choice' && isObj(a[1]) && a[1].id) choiceIds.add(a[1].id);
    const anchorRef = (a, where) => {
      if (typeof a === 'string') {
        if (a[0] === '@') { const nm = a.slice(1).split('.')[0]; if (!actors[nm]) E(where + ': 役者がいません ' + a); return; }
        if (!anchors[a] && !groups[a] && !inter[a]) E(where + ': 場所がありません ' + a);
        return;
      }
      if (!isObj(a)) E(where + ': 場所の形が違います');
    };
    const condCheck = (c, where) => {
      if (!isArr(c) || typeof c[0] !== 'string') { E(where + ': 条件の形が違います ' + JSON.stringify(c)); return; }
      const v = c[0];
      if (LATER.indexOf(v) >= 0 || !Object.prototype.hasOwnProperty.call(COND, v)) { E(where + ': 知らない条件 ' + v); return; }
      const n = COND[v];
      if (n >= 0 && c.length - 1 < n) E(where + ': 条件 ' + v + ' の引数が足りません');
      if (v === 'all' || v === 'any') for (let i = 1; i < c.length; i++) condCheck(c[i], where);
      if (v === 'not') condCheck(c[1], where);
      if ((v === 'near' || v === 'inside' || v === 'leave')) anchorRef(c[1], where);
      if (v === 'actorNear') { if (!actors[c[1]]) E(where + ': 役者がいません ' + c[1]); anchorRef(c[2], where); }
      if (v === 'landed') { if (!actors[c[1]] || actors[c[1]].kind !== 'vtol') E(where + ': landed は VTOL の役者 ' + c[1]); anchorRef(c[2], where); if (!(ch.needs >= 2)) E(where + ': landed は needs 2 の章だけ'); }
      if ((v === 'dead' || v === 'killed' || v === 'alive') && !groups[c[1]] && !tagOf(groups, c[1])) E(where + ': 隊がありません ' + c[1]);
      if ((v === 'interact' || v === 'held') && !inter[c[1]]) E(where + ': 調べる物がありません ' + c[1]);
      if (v === 'done' && !lines[c[1]] && !shots[c[1]] && !choiceIds.has(c[1])) E(where + ': せりふ / 場面がありません ' + c[1]);
    };
    const actCheck = (a, where) => {
      if (!isArr(a) || typeof a[0] !== 'string') { E(where + ': 命令の形が違います ' + JSON.stringify(a)); return; }
      const v = a[0];
      if (LATER.indexOf(v) >= 0 || !Object.prototype.hasOwnProperty.call(ACTION, v)) { E(where + ': 知らない命令 ' + v); return; }
      if (a.length - 1 < ACTION[v]) E(where + ': 命令 ' + v + ' の引数が足りません');
      if ((v === 'radio' || v === 'talk') && !lines[a[1]]) E(where + ': せりふがありません ' + a[1]);
      if (v === 'cine' && !shots[a[1]]) E(where + ': 場面がありません ' + a[1]);
      if ((v === 'spawn' || v === 'despawn') && !groups[a[1]]) E(where + ': 隊がありません ' + a[1]);
      if ((v === 'ally' || v === 'civ') && !actors[a[1]]) E(where + ': 役者がいません ' + a[1]);
      if (v === 'mark') for (const m of (isArr(a[1]) ? a[1] : [a[1]])) anchorRef(m, where);
      if (v === 'teleport') anchorRef(a[1], where);
      if (v === 'intel' && !(ch.intel || []).some((x) => x.id === a[1])) E(where + ': 資料がありません ' + a[1]);
      if (v === 'end' && a[1] !== 'success' && a[1] !== 'fail') E(where + ': end は success / fail');
      // needs 2 の動詞: 古い版の章（needs 1）では使えない
      if ((v === 'billboard' || v === 'choice') && !(ch.needs >= 2)) E(where + ': ' + v + ' は needs 2 の章だけ');
      if (v === 'billboard' && ['rescue', 'kagami', 'off'].indexOf(a[1]) < 0) E(where + ': billboard は rescue / kagami / off');
      if (v === 'choice') {
        const c = a[1];
        if (!isObj(c) || typeof c.id !== 'string' || !isArr(c.options) || c.options.length < 2 || c.options.length > 3) E(where + ': choice は { id, prompt, options: [2〜3] }');
        else if (c.timeout != null && !(c.timeout >= 0 && c.timeout < c.options.length)) E(where + ': choice の timeout は選択肢の番号');
        else for (const o of c.options) if (!isObj(o) || typeof o.label !== 'string' || typeof o.flag !== 'string') E(where + ': choice の選択肢は { label, flag }');
      }
    };
    for (const s of ch.steps) {
      const w = 'step ' + s.id;
      if (s.until == null) E(w + ': until がありません'); else condCheck(s.until, w);
      for (const a of s.do || []) actCheck(a, w);
      for (const f of s.fail || []) condCheck(f, w + ' fail');
      for (const o of s.on || []) { if (!o || !o.when) E(w + ': on に when がありません'); else { condCheck(o.when, w + ' on'); for (const a of o.do || []) actCheck(a, w + ' on'); } }
      for (const m of s.mark || []) anchorRef(m, w + ' mark');
      if (s.then != null) {
        const tgt = typeof s.then === 'string' ? [s.then] : (isObj(s.then) ? Object.keys(s.then).map((k) => s.then[k]) : null);
        if (!tgt) E(w + ': then の形が違います');
        else for (const t of tgt) if (t !== 'end' && !ids.has(t)) E(w + ': then の行き先がありません ' + t);
        if (isObj(s.then)) for (const k of Object.keys(s.then)) if (k !== 'else' && !/^flag:/.test(k)) E(w + ': then の鍵は flag: か else だけ ' + k);
      }
    }
    for (const f of ch.fail || []) condCheck(f, 'fail');
    // せりふの長さ（無線 22 字 × 2 行、会話 3 行）と話す人
    for (const id of Object.keys(lines)) {
      const L = lines[id];
      if (!isArr(L) || !L.length) { E('せりふ ' + id + ' が空です'); continue; }
      for (const ln of L) {
        if (!isArr(ln) || typeof ln[0] !== 'string' || typeof ln[1] !== 'string' || !ln[1].trim()) { E('せりふ ' + id + ' の行の形が違います'); continue; }
        if (cast && !cast[ln[0]]) E('せりふ ' + id + ': 話す人がいません ' + ln[0]);
        const rows = ln[1].split('\n');
        const talk = isObj(ln[2]) && ln[2].box;
        if (rows.length > (talk ? lim.talkLines : lim.radioLines)) E('せりふ ' + id + ': 行が多すぎます「' + ln[1] + '」');
        for (const r of rows) if (!talk && r.length > lim.radioChars) E('せりふ ' + id + ': 1 行 ' + lim.radioChars + ' 字を超えています「' + r + '」');
      }
    }
    // 場面（cine）の鍵の形
    for (const id of Object.keys(shots)) {
      const S = shots[id];
      if (!isObj(S) || !isArr(S.keys) || !S.keys.length) { E('場面 ' + id + ' に keys がありません'); continue; }
      let t0 = -1;
      for (const k of S.keys) { if (!(k.t >= t0)) E('場面 ' + id + ': keys の t が増えていません'); t0 = k.t; if (!k.p) E('場面 ' + id + ': p がありません'); else anchorRef(k.p, 'shot ' + id); }
      if (S.lines && !lines[S.lines]) E('場面 ' + id + ': せりふがありません ' + S.lines);
    }
    for (const id of Object.keys(groups)) {
      const G0 = groups[id];
      if (!isObj(G0)) { E('隊 ' + id + ' の形が違います'); continue; }
      if (!(G0.n >= 1) && !isArr(G0.at)) E('隊 ' + id + ': n がありません');
      if (G0.at) for (const a of (isArr(G0.at) ? G0.at : [G0.at])) anchorRef(a, 'group ' + id);
    }
    for (const id of Object.keys(actors)) { const A = actors[id]; if (!isObj(A) || ['ally', 'civ', 'puppet', 'vtol'].indexOf(A.kind) < 0) E('役者 ' + id + ' の kind が違います'); else if (A.at) anchorRef(A.at, 'actor ' + id); }
    for (const id of Object.keys(inter)) { const I = inter[id]; if (!isObj(I) || !I.at) E('調べる物 ' + id + ' に at がありません'); else anchorRef(I.at, 'interact ' + id); }
    // どの step にも行けるか（最初から then / 次 でたどる）
    const reach = new Set(), stack = [0];
    while (stack.length) {
      const i = stack.pop();
      if (i < 0 || i >= ch.steps.length || reach.has(i)) continue;
      reach.add(i);
      const s = ch.steps[i];
      const tg = s.then == null ? [i + 1] : (typeof s.then === 'string' ? [s.then] : Object.keys(s.then).map((k) => s.then[k])).map((t) => (t === 'end' ? -1 : ch.steps.findIndex((x) => x.id === t)));
      for (const t of tg) stack.push(t);
    }
    for (let i = 0; i < ch.steps.length; i++) if (!reach.has(i)) E('step ' + ch.steps[i].id + ' に行けません');
    return err;
  }
  // 隊の tag（groups[x].tag が y のとき y でも引ける）
  function tagOf(groups, tag) { for (const k of Object.keys(groups)) if (groups[k] && groups[k].tag === tag) return k; return null; }

  // ---------- 実行 ----------
  class Runner {
    // ch: 検証済みの章、opts: { host: { query(name, args) → bool }, seed, sweepHz }
    constructor(ch, opts) {
      opts = opts || {};
      this.ch = ch;
      this.host = opts.host || null;
      this.sweepDt = 1 / (opts.sweepHz || 10);
      this.steps = ch.steps;
      this.stepIndex = -1;
      this.stepT = 0;          // 今の step の経った秒（paused の間は進まない）
      this.totalT = 0;
      this.paused = false;
      this.timer = null;       // { end（stepT）, label }
      this.flags = {}; this.counters = {};
      this.tags = {};          // tag → { spawned, dead, waiting }
      this.facts = { interact: {}, held: {}, picked: {}, lifted: {}, done: {}, vehicleDead: {}, civBoarded: 0, boarded: false, inVehicle: null, exitVehicle: {}, playerDead: false };
      this.kills = {};         // tag → 倒した数（how ごと: this.how[tag][how]）
      this.how = {};
      this.out = [];           // host への命令
      this.seq = null;         // { list, pc, wait, src }: 実行中の do
      this.ons = [];           // 今の step の on（{ when, do, once, fired }）
      this.seqs = [];          // on の do（並べて実行）
      this.ended = null;       // { result, reason }
      this._sweep = 0;
      this.cpState = null;     // 今の step に入った直後（チェックポイント用）
      this.seed = opts.seed != null ? opts.seed >>> 0 : hash(ch.id);
      this.rand = rng(this.seed);
      this.stats = { evals: 0, events: 0 };
    }

    get step() { return this.stepIndex >= 0 ? this.steps[this.stepIndex] : null; }

    // 最初から、または id の step から
    start(stepId) {
      let i = 0;
      if (stepId) { i = this.steps.findIndex((s) => s.id === stepId); if (i < 0) i = 0; }
      this._enter(i);
      return this;
    }

    _enter(i) {
      if (i < 0 || i >= this.steps.length) { this._end('success', 'steps'); return; }
      this.stepIndex = i;
      this.stepT = 0;
      this.timer = null;
      const s = this.steps[i];
      // チェックポイント用: 入った直後（do の前）の状態
      this.cpState = this._state();
      this.out.push({ verb: 'enter', args: [s.id], step: s.id });
      if (s.obj != null) this.out.push({ verb: 'obj', args: [s.obj, s.count || null], step: s.id });
      if (s.mark) this.out.push({ verb: 'mark', args: [s.mark], step: s.id });
      this.ons = (s.on || []).map((o) => ({ when: o.when, do: o.do || [], once: o.once !== false, fired: false }));
      this.seqs = [];
      this.seq = { list: (s.do || []).slice(), pc: 0, wait: 0, cp: !!s.checkpoint };
      this._runSeq(this.seq);
      if (this.seq && this.seq.pc >= this.seq.list.length) this._seqDone(this.seq);
    }

    _seqDone(q) {
      if (q === this.seq) { if (q.cp) this.out.push({ verb: 'checkpoint', args: [this.step.id], step: this.step.id }); this.seq = null; }
    }

    _runSeq(q) {
      const sid = this.step ? this.step.id : null;
      while (q.pc < q.list.length && !this.ended) {
        if (q.wait > 0) return;
        const a = q.list[q.pc++];
        const v = a[0];
        if (v === 'wait') { q.wait = +a[1] || 0; if (q.wait > 0) return; continue; }
        if (v === 'set') { this.flags[a[1]] = a.length > 2 ? a[2] : true; continue; }
        if (v === 'flag') { this.flags[a[1]] = a.length > 2 ? a[2] : true; continue; }
        if (v === 'inc') { this.counters[a[1]] = (this.counters[a[1]] || 0) + (a.length > 2 ? +a[2] : 1); continue; }
        if (v === 'timer') { this.timer = { end: this.stepT + (+a[1] || 0), label: a[2] || null }; this.out.push({ verb: 'timer', args: [+a[1] || 0, a[2] || null], step: sid }); continue; }
        if (v === 'end') { this.out.push({ verb: 'end', args: a.slice(1), step: sid }); this._end(a[1], a[2] || null); return; }
        if (v === 'checkpoint') { this.cpState = this._state(); this.out.push({ verb: 'checkpoint', args: [sid], step: sid }); continue; }
        this.out.push({ verb: v, args: a.slice(1), step: sid });
      }
    }

    _end(result, reason) {
      if (this.ended) return;
      this.ended = { result: result === 'fail' ? 'fail' : 'success', reason: reason || null };
      if (!this.out.length || this.out[this.out.length - 1].verb !== 'end') this.out.push({ verb: 'end', args: [this.ended.result, this.ended.reason], step: this.step ? this.step.id : null });
    }

    // host が毎フレーム取る
    drain() { const o = this.out; this.out = []; return o; }

    // 出来事（host から）
    event(type, d) {
      if (this.ended) return;
      d = d || {};
      this.stats.events++;
      const F = this.facts;
      switch (type) {
        case 'spawn': { const t = this._tag(d.tag); t.spawned += d.n == null ? 1 : d.n; t.tried = true; break; }
        case 'waiting': { const t = this._tag(d.tag); t.waiting = !!d.on; break; }
        case 'kill': {
          const t = this._tag(d.tag); t.dead++;
          this.kills[d.tag] = (this.kills[d.tag] || 0) + 1;
          const hw = this.how[d.tag] || (this.how[d.tag] = {}); hw[d.how || 'other'] = (hw[d.how || 'other'] || 0) + 1;
          break;
        }
        case 'despawn': { const t = this._tag(d.tag); t.spawned = Math.max(t.dead, t.spawned - (d.n == null ? 1 : d.n)); break; }
        case 'interact': F.interact[d.id] = true; break;
        case 'held': F.held[d.id] = true; break;
        case 'picked': F.picked[d.kind] = (F.picked[d.kind] || 0) + 1; break;
        case 'lifted': F.lifted[d.to] = true; break;
        case 'done': F.done[d.id] = true; break;
        case 'vehicleDead': F.vehicleDead[d.tag] = true; break;
        case 'enterVehicle': F.inVehicle = d.type || d.tag || 'vehicle'; F.inVehicleTag = d.tag || null; break;
        case 'exitVehicle': if (F.inVehicle) F.exitVehicle[F.inVehicle] = true; if (F.inVehicleTag) F.exitVehicle[F.inVehicleTag] = true; F.inVehicle = null; F.inVehicleTag = null; break;
        case 'civBoarded': F.civBoarded += d.n == null ? 1 : d.n; break;
        case 'boarded': F.boarded = true; break;
        case 'playerDead': F.playerDead = true; break;
        case 'flag': this.flags[d.name] = d.value == null ? true : d.value; break;
        case 'counter': this.counters[d.name] = (this.counters[d.name] || 0) + (d.n == null ? 1 : d.n); break;
        default: break;
      }
      this._check();
    }

    _tag(tag) { return this.tags[tag] || (this.tags[tag] = { spawned: 0, dead: 0, waiting: false }); }

    // 毎フレーム（dt 秒）
    tick(dt) {
      if (this.ended || this.stepIndex < 0) return;
      if (!this.paused) {
        this.stepT += dt; this.totalT += dt;
        for (const q of [this.seq].concat(this.seqs)) {
          if (!q || q.wait <= 0) continue;
          q.wait -= dt;
          if (q.wait <= 0) { q.wait = 0; this._runSeq(q); if (q.pc >= q.list.length) this._seqDone(q); }
        }
        this.seqs = this.seqs.filter((q) => q.pc < q.list.length);
      }
      this._sweep -= dt;
      if (this._sweep <= 0) { this._sweep = this.sweepDt; this._check(); }
    }

    // 条件
    cond(c) {
      this.stats.evals++;
      if (!c) return false;
      const v = c[0], F = this.facts;
      switch (v) {
        case 'always': return true;
        case 'never': return false;
        case 'all': for (let i = 1; i < c.length; i++) if (!this.cond(c[i])) return false; return true;
        case 'any': for (let i = 1; i < c.length; i++) if (this.cond(c[i])) return true; return false;
        case 'not': return !this.cond(c[1]);
        case 'time': return this.stepT >= (+c[1] || 0);
        case 'timerDone': return !!this.timer && this.stepT >= this.timer.end;
        case 'dead': { const t = this.tags[c[1]]; return !!t && (t.spawned > 0 || t.tried) && t.dead >= t.spawned && !t.waiting; }
        case 'killed': return (this.kills[c[1]] || 0) >= (+c[2] || 1);
        case 'alive': { const t = this.tags[c[1]]; return !!t && (t.spawned > 0 || t.tried) && !t.waiting && (t.spawned - t.dead) <= (+c[2] || 0); }
        case 'interact': return !!F.interact[c[1]];
        case 'held': return !!F.held[c[1]];
        case 'picked': return !!F.picked[c[1]];
        case 'lifted': return !!F.lifted[c[1]];
        case 'done': return !!F.done[c[1]];
        case 'vehicleDead': return !!F.vehicleDead[c[1]];
        case 'inVehicle': return F.inVehicle != null && (c[1] === '*' || F.inVehicle === c[1] || F.inVehicleTag === c[1]);
        case 'exitVehicle': return !!F.exitVehicle[c[1]];
        case 'civBoarded': return F.civBoarded >= (+c[1] || 0);
        case 'boarded': return F.boarded;
        case 'playerDead': return F.playerDead;
        case 'flag': return !!this.flags[c[1]];
        case 'counter': return (this.counters[c[1]] || 0) >= (+c[2] || 0);
        default: return this.host && typeof this.host.query === 'function' ? !!this.host.query(v, c.slice(1)) : false;
      }
    }

    _check() {
      if (this.ended || this.stepIndex < 0 || this.paused) return;
      const s = this.step;
      // 章の失敗・step の失敗
      for (const f of (this.ch.fail || []).concat(s.fail || [])) if (this.cond(f)) { this.out.push({ verb: 'failed', args: [f[0]], step: s.id }); this._end('fail', f[0]); return; }
      // on（step の中の出来事）
      for (const o of this.ons) {
        if (o.fired && o.once) continue;
        if (!this.cond(o.when)) continue;
        o.fired = true;
        const q = { list: o.do.slice(), pc: 0, wait: 0 };
        this._runSeq(q);
        if (q.pc < q.list.length) this.seqs.push(q);
        if (this.ended) return;
      }
      if (this.seq) return; // do を出し終えるまで次へ行かない（wait の途中）
      if (!this.cond(s.until)) return;
      this.out.push({ verb: 'leave', args: [s.id], step: s.id });
      this._enter(this._next(s));
    }

    _next(s) {
      const i = this.stepIndex;
      if (s.then == null) return i + 1;
      let t = s.then;
      if (isObj(t)) {
        let pick = t.else;
        for (const k of Object.keys(t)) if (k !== 'else' && this.flags[k.slice(5)]) { pick = t[k]; break; }
        t = pick;
      }
      if (t === 'end' || t == null) return this.steps.length;
      const j = this.steps.findIndex((x) => x.id === t);
      return j < 0 ? i + 1 : j;
    }

    pause(on) { this.paused = !!on; }

    // 保存
    _state() {
      return {
        ch: this.ch.id, step: this.stepIndex >= 0 ? this.steps[this.stepIndex].id : null, stepT: this.stepT, totalT: this.totalT,
        flags: Object.assign({}, this.flags), counters: Object.assign({}, this.counters),
        tags: JSON.parse(JSON.stringify(this.tags)), kills: Object.assign({}, this.kills), how: JSON.parse(JSON.stringify(this.how)),
        facts: JSON.parse(JSON.stringify(this.facts)), rng: this.rand.state(), seed: this.seed
      };
    }
    toJSON() { return this._state(); }
    // チェックポイント（cpState）か toJSON の形から: その step に入り直す（do をもう一度）
    fromJSON(j, reenter) {
      if (!j || j.ch !== this.ch.id) return false;
      this.flags = Object.assign({}, j.flags || {}); this.counters = Object.assign({}, j.counters || {});
      this.tags = JSON.parse(JSON.stringify(j.tags || {}));
      for (const k of Object.keys(this.tags)) this.tags[k].waiting = false;
      this.kills = Object.assign({}, j.kills || {}); this.how = JSON.parse(JSON.stringify(j.how || {}));
      this.facts = Object.assign(this.facts, JSON.parse(JSON.stringify(j.facts || {})));
      this.facts.playerDead = false; this.facts.inVehicle = null; this.facts.inVehicleTag = null;
      this.totalT = +j.totalT || 0;
      if (j.rng != null) this.rand.set(j.rng);
      this.ended = null;
      this.out = [];
      const i = Math.max(0, this.steps.findIndex((s) => s.id === j.step));
      if (reenter !== false) this._enter(i); else { this.stepIndex = i; this.stepT = +j.stepT || 0; }
      return true;
    }
  }

  // 進み具合（localStorage / DATA の 1 つの JSON）。新しい t の方を使う。壊れていれば捨てる
  const Progress = {
    KEY: 'mirrsona.story',
    blank() { return { v: 1, t: 0, diff: 'normal', unlocked: [], done: {}, cp: null, relit: [], intel: [], unlocks: [], seen: {}, hub: { bunk: '新入り' }, playSec: 0, world: { at: null } }; },
    parse(text) {
      if (typeof text !== 'string' || !text) return null;
      try { const o = JSON.parse(text); return Progress.clean(o); } catch (e) { return null; }
    },
    clean(o) {
      if (!isObj(o) || o.v !== 1) return null;
      const b = Progress.blank();
      for (const k of Object.keys(b)) if (o[k] !== undefined && typeof o[k] === typeof b[k] && isArr(o[k]) === isArr(b[k])) b[k] = o[k];
      if (isObj(o.cp)) b.cp = o.cp;
      if (typeof o.t === 'number') b.t = o.t;
      return b;
    },
    // 2 つの写しのうち新しい方（どちらも壊れていれば空）
    newest(a, b) {
      const pa = typeof a === 'string' ? Progress.parse(a) : (a ? Progress.clean(a) : null);
      const pb = typeof b === 'string' ? Progress.parse(b) : (b ? Progress.clean(b) : null);
      if (pa && pb) return pa.t >= pb.t ? pa : pb;
      return pa || pb || Progress.blank();
    }
  };

  // 作りかけの章（story.json の chapter に draft: true）: 一覧に出さない・始められない・前の章の「次へ」にもならない（配るビルドに半端な章を出さない）。
  //   テストと開発だけ MR.CONFIG.STORY_DRAFTS（URL ?storydraft=1）か opts.drafts で出す
  //   出した章（build 17 の第3〜5章）は story.json では draft: true のまま release: <このアプリの RELEASE 以下> を付ける = release を知らない古いアプリ
  //   （ビルド 16.x）は今まで通り作りかけとして隠し（古いコードで遊ばせない）、release を知っているアプリだけ出す（isDraft）
  function draftsOn(opts) { return !!((opts && opts.drafts) || (root && root.MR && root.MR.CONFIG && root.MR.CONFIG.STORY_DRAFTS)); }
  function isDraft(c) { return !!(c && c.draft) && !(typeof c.release === 'number' && c.release <= RELEASE); }
  function listed(campaign, opts) { const on = draftsOn(opts); return (campaign.chapters || []).filter((c) => !isDraft(c) || on); }
  // 章が始められるか（一覧）: { ok, why: 'locked' | 'update' | 'broken' | 'missing' | 'city' }
  function chapterState(campaign, prog, id, opts) {
    opts = opts || {};
    const e = (campaign.chapters || []).find((c) => c.id === id);
    if (!e || (isDraft(e) && !draftsOn(opts))) return { ok: false, why: 'missing' };
    if ((e.needs || 1) > (opts.appLevel == null ? APP_LEVEL : opts.appLevel)) return { ok: false, why: 'update' };
    const city = (campaign.world && campaign.world.cities || []).find((c) => c.id === (e.city || 'midtown'));
    if (city && (city.needs || 1) > (opts.appLevel == null ? APP_LEVEL : opts.appLevel)) return { ok: false, why: 'update' };
    const first = (campaign.chapters || [])[0];
    const unlocked = (e === first) || (prog && prog.unlocked.indexOf(id) >= 0) || (e.unlockAfter && prog && e.unlockAfter.every((x) => prog.done[x]));
    if (!unlocked && !opts.all) return { ok: false, why: 'locked' };
    if (opts.levels && !opts.levels(e.level || 'midtown')) return { ok: false, why: 'city' };
    return { ok: true, why: null };
  }

  // 都市が行けるか（航路図）
  function cityOpen(campaign, prog, cityId, opts) {
    const c = (campaign.world && campaign.world.cities || []).find((x) => x.id === cityId);
    if (!c) return false;
    if ((c.needs || 1) > ((opts && opts.appLevel) == null ? APP_LEVEL : opts.appLevel)) return false;
    return (c.unlock || []).every((ch) => prog && prog.done[ch]);
  }

  // 評価（S〜C）: 時間・受けたダメージ・命中・民間人の無事・資料
  function rate(r, rating) {
    rating = rating || {};
    const par = rating.par || 600;
    const w = Object.assign({ time: 1, damage: 1, accuracy: 0.5, civilians: 2, intel: 0.5 }, rating.weights || {});
    const sTime = Math.max(0, Math.min(1, 1.5 - (r.sec || par) / par));
    const sDmg = Math.max(0, 1 - (r.damage || 0) / 400);
    const sAcc = Math.max(0, Math.min(1, r.accuracy == null ? 0.5 : r.accuracy * 2));
    const sCiv = r.civTotal ? (r.civSafe || 0) / r.civTotal : 1;
    const sInt = r.intelTotal ? (r.intel || 0) / r.intelTotal : 1;
    const tot = w.time + w.damage + w.accuracy + w.civilians + w.intel;
    const score = (sTime * w.time + sDmg * w.damage + sAcc * w.accuracy + sCiv * w.civilians + sInt * w.intel) / (tot || 1);
    const rank = score >= 0.85 ? 'S' : score >= 0.7 ? 'A' : score >= 0.5 ? 'B' : 'C';
    return { score: Math.round(score * 100), rank };
  }

  const Story = { APP_LEVEL, VERSION: 1, COND, ACTION, LATER, hash, rng, validate, Runner, Progress, chapterState, listed, draftsOn, isDraft, RELEASE, cityOpen, rate, tagOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Story;
  if (root) { root.MR = root.MR || {}; root.MR.Story = Story; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
