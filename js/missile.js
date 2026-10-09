// 戦闘機のミサイルとフレア（MR.Missiles。game.js が 1 つ持つ。THREE は使うが DOM は使わない）。
//   fire({ from, vel, dir, target, owner }) … 翼の下（from）から撃つ。target（乗り物・敵・フレア）があれば追う（先読みの追尾:
//     届くまでの秒 × 相手の速さだけ先を狙い、turnG G で曲がれる分だけ向きを変える。地上の目標は上から: loftFrom m より遠い間は
//     目標の上 (距離 − loftFrom) × loftK m（loftMax まで）を狙う。目標が建物の陰なら見えるまで狙いを liftRate m/s で上げる）、無ければ dir へまっすぐ（地上・屋上の目標）。
//     dropTime 秒は落ちるだけ（レールを離れる）→ ロケット（accel m/s² で speed m/s まで、motorTime 秒）→ life 秒で自爆。
//     armTime 秒より後、目標（と途中の乗り物・敵）に fuse m まで近づく・建物・地面・水に当たると爆発（ctx.onDetonate）。
//   popFlares(owner, n) … 機体の後ろにフレア（光る玉が落ちる）を n 発。owner を追っているミサイルは decoyRange m 以内なら
//     decoyChance の確率でフレアを追うようになる。
//   incomingFor(v) … v を追っているミサイルのうち一番近いもの { dist, tti }（自動フレア・HUD の「ミサイル接近」）か null。
//   見た目: 白い筒（共有の形・材質）+ 炎のスプライト、煙は fx.smoke を trailEvery 秒ごと。音: missile_launch（撃つ）・missile_loop（3D の
//   ループ。爆発・消えたら止める）・missile_explode。数値は vehicles.types.jet.missile（game.js が渡す）
window.MR = window.MR || {};

MR.Missiles = class Missiles {
  constructor(scene, fx, audio, cfg) {
    this.scene = scene; this.fx = fx; this.audio = audio;
    this.cfg = Object.assign({}, Missiles.DEFAULTS, cfg || {});
    this.list = [];
    this.flares = [];
    this.stats = { fired: 0, hits: 0, decoyed: 0, flares: 0, detonated: 0 };
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._tp = new THREE.Vector3(); this._v5 = new THREE.Vector3();
  }

  _shared() {
    if (Missiles._S) return Missiles._S;
    const srgb = (h) => (MR.srgb ? MR.srgb(h) : new THREE.Color(h));
    const body = new THREE.CylinderGeometry(0.09, 0.09, 3.0, 8);
    body.rotateX(Math.PI / 2); // 前 = +Z
    const glow = (hex) => { try { return MR.FX && MR.FX.makeGlowTexture && typeof document !== 'undefined' ? MR.FX.makeGlowTexture(hex) : null; } catch (e) { return null; } };
    Missiles._S = {
      body, bodyMat: new THREE.MeshStandardMaterial({ color: srgb('#d9dcdf'), roughness: 0.5, metalness: 0.3 }),
      flame: new THREE.SpriteMaterial({ map: glow('#ffd28a'), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      flare: new THREE.SpriteMaterial({ map: glow('#fff2c0'), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    };
    return Missiles._S;
  }

  // 目標の今の位置（世界）。フレア・乗り物（重心）・敵（胸の高さ）・{ x, y, z }
  static targetPos(t, out) {
    if (!t) return null;
    if (t.isFlare) return out.copy(t.pos);
    if (typeof t.center === 'function') return t.center(out);
    if (t.pos) return out.set(t.pos.x, t.pos.y + 1.1, t.pos.z);
    return out.set(t.x, t.y, t.z);
  }
  static alive(t) {
    if (!t) return false;
    if (t.isFlare) return t.life > 0;
    return !(t.dead || t.wrecked || t.sunk || t.disposed || t.removed);
  }

  fire(o) {
    const S = this._shared(), C = this.cfg;
    const mesh = new THREE.Mesh(S.body, S.bodyMat);
    const flame = new THREE.Sprite(S.flame);
    flame.scale.set(1.6, 1.6, 1); flame.position.set(0, 0, -1.8); flame.visible = false;
    mesh.add(flame);
    mesh.position.copy(o.from);
    mesh.castShadow = false;
    this.scene.add(mesh);
    const vel = new THREE.Vector3();
    if (o.vel) vel.copy(o.vel);
    vel.addScaledVector(o.dir, this.cfg.ejectSpeed);
    const m = {
      mesh, flame, pos: mesh.position, vel, dir: new THREE.Vector3().copy(o.dir).normalize(), target: o.target || null, owner: o.owner || null,
      t: 0, trailT: 0, snd: null, dead: false, id: ++Missiles._id, from: [+o.from.x.toFixed(1), +o.from.y.toFixed(1), +o.from.z.toFixed(1)]
    };
    m.vel.y -= 2; // レールを離れて少し落ちる
    this._orient(m);
    this.list.push(m);
    this.stats.fired++;
    if (this.audio && typeof this.audio.play === 'function') {
      this.audio.play('missile_launch', { pos: o.from, priority: 3, refDistance: 20, maxDistance: 900 });
      try { m.snd = this.audio.play('missile_loop', { pos: o.from, loop: true, refDistance: 30, maxDistance: 1500, synth: false }); } catch (e) { m.snd = null; }
    }
    return m;
  }

  _orient(m) {
    const v = this._v1.copy(m.vel);
    if (v.lengthSq() < 1e-6) return;
    v.normalize();
    m.mesh.quaternion.setFromUnitVectors(Missiles._Z || (Missiles._Z = new THREE.Vector3(0, 0, 1)), v);
  }

  popFlares(owner, n) {
    if (!owner || n <= 0) return 0;
    const S = this._shared(), C = this.cfg;
    const c = typeof owner.center === 'function' ? owner.center(this._v1) : this._v1.copy(owner.pos);
    const back = this._v2.copy(owner.vel || this._v3.set(0, 0, 0));
    for (let i = 0; i < n; i++) {
      if (this.flares.length >= C.maxFlares) { const old = this.flares.shift(); if (old.sprite.parent) old.sprite.parent.remove(old.sprite); }
      const sp = new THREE.Sprite(S.flare);
      sp.scale.set(3, 3, 1);
      sp.position.copy(c);
      this.scene.add(sp);
      const side = (i % 2 ? 1 : -1) * (6 + Math.random() * 6);
      const f = { isFlare: true, pos: sp.position, vel: new THREE.Vector3(back.x * 0.6 + side * 0.3, back.y * 0.6 - 4 - Math.random() * 4, back.z * 0.6 + side * 0.3), life: C.flareLife, sprite: sp };
      this.flares.push(f);
    }
    this.stats.flares += n;
    if (this.audio && typeof this.audio.play === 'function') this.audio.play('flare_pop', { pos: c, priority: 2, refDistance: 10, maxDistance: 500 });
    // おとり: owner を追っているミサイル
    for (const m of this.list) {
      if (m.dead || m.target !== owner) continue;
      if (m.pos.distanceTo(c) > C.decoyRange) continue;
      if (Math.random() < C.decoyChance) { m.target = this.flares[this.flares.length - 1 - Math.floor(Math.random() * Math.min(n, this.flares.length))]; this.stats.decoyed++; m.decoyed = true; }
    }
    return n;
  }

  incomingFor(v) {
    let best = null;
    for (const m of this.list) {
      if (m.dead || m.target !== v) continue;
      const tp = Missiles.targetPos(v, this._tp);
      const d = m.pos.distanceTo(tp);
      const rel = this._v1.copy(m.vel); if (v.vel) rel.sub(v.vel);
      const close = Math.max(1, rel.dot(this._v2.copy(tp).sub(m.pos).normalize()));
      const tti = d / close;
      if (!best || d < best.dist) best = { dist: d, tti, missile: m };
    }
    return best;
  }

  // ctx: { vehicles, enemies, ray(o, d, maxT) → { t, x, y, z, water } | null, onDetonate(point, missile, hitObj) }
  // 線分 p0 → p0 + seg と目標 t の一番近い点が r m 以内なら { k, x, y, z }（使い回しの 1 つ）、でなければ null
  _near(t, r, p0, seg, segLen) {
    const tp = Missiles.targetPos(t, this._tp);
    const k = segLen > 1e-6 ? Math.max(0, Math.min(1, this._v2.copy(tp).sub(p0).dot(seg) / (segLen * segLen))) : 0;
    const cx = p0.x + seg.x * k, cy = p0.y + seg.y * k, cz = p0.z + seg.z * k;
    if (Math.hypot(tp.x - cx, tp.y - cy, tp.z - cz) >= r) return null;
    const o = this._nearHit || (this._nearHit = { k: 0, x: 0, y: 0, z: 0 });
    o.k = k; o.x = cx; o.y = cy; o.z = cz;
    return o;
  }
  update(dt, ctx) {
    const C = this.cfg, G = 9.81;
    // フレア: 落ちながら消える
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      f.vel.y -= G * 0.35 * dt;
      f.vel.multiplyScalar(Math.max(0, 1 - dt * 0.8));
      f.pos.addScaledVector(f.vel, dt);
      const k = Math.max(0, f.life / C.flareLife);
      f.sprite.scale.setScalar(1.2 + 2.4 * k);
      if (f.life <= 0) { if (f.sprite.parent) f.sprite.parent.remove(f.sprite); this.flares.splice(i, 1); }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (m.dead) { this._remove(i); continue; }
      m.t += dt;
      const p0 = this._v3.copy(m.pos);
      let V = m.vel.length();
      if (m.t < C.dropTime) {
        m.vel.y -= G * dt;
      } else {
        m.flame.visible = m.t < C.dropTime + C.motorTime;
        // 追う: 先読み（届くまでの秒 × 相手の速さ）の点へ、turnG G で曲がれる分だけ
        const tgt = m.target && Missiles.alive(m.target) ? m.target : null;
        if (m.target && !tgt) m.target = null;
        let want = null;
        if (tgt) {
          const tp = Missiles.targetPos(tgt, this._tp);
          const d = tp.distanceTo(m.pos);
          const tgo = d / Math.max(100, V);
          if (tgt.vel) tp.addScaledVector(tgt.vel, Math.min(tgo, 4));
          // 地上の目標（通りの車・兵士）: 上から突っ込む（低く追うと手前の建物に当たる）。水平の距離 loftFrom m より遠い間は
          //  目標の上（距離 × loftK、loftMax m まで）を狙う
          const air = tgt.isFlare || tgt.mode === 'air' || (tgt.kind === 'heli' && !tgt.grounded);
          if (!air) {
            // 目標まで建物・地面にさえぎられている（losEvery 秒ごとにレイ）間は狙いを liftRate m/s で上げる（建物を越えてから上から突っ込む。
            //  ロックした後に機体が動いて手前のビルの陰になった・発射の落下で見通しの下へ出た）。見えたらまっすぐ
            if (ctx && ctx.ray) {
              m.losT = (m.losT || 0) - dt;
              if (m.losT <= 0) {
                m.losT = C.losEvery;
                const dl = tp.distanceTo(m.pos);
                if (dl > 1) { const h = ctx.ray(m.pos, this._v5.copy(tp).sub(m.pos).multiplyScalar(1 / dl), dl); m.blocked = !!(h && h.t < dl - C.losClear); }
              }
              m.lift = m.blocked ? Math.min(C.loftMax, (m.lift || 0) + C.liftRate * dt) : 0;
            }
            const hd = Math.hypot(tp.x - m.pos.x, tp.z - m.pos.z);
            tp.y += Math.max(m.lift || 0, Math.min(C.loftMax, Math.max(0, (hd - C.loftFrom) * C.loftK)));
          }
          want = this._v1.copy(tp).sub(m.pos).normalize();
        } else want = this._v1.copy(m.dir);
        const cur = this._v2.copy(m.vel).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, cur.dot(want))));
        const maxA = C.turnG * G / Math.max(V, 50) * dt;
        if (ang > 1e-5) {
          const k = Math.min(1, maxA / ang);
          cur.lerp(want, k).normalize();
        }
        if (m.t < C.dropTime + C.motorTime) V = Math.min(C.speed, V + C.accel * dt);
        else V = Math.max(80, V - C.coastDrag * dt);
        m.vel.copy(cur).multiplyScalar(V);
        if (!tgt) m.dir.copy(cur);
      }
      m.pos.addScaledVector(m.vel, dt);
      this._orient(m);
      if (m.snd && typeof m.snd.setPosition === 'function') { try { m.snd.setPosition(m.pos); } catch (e) { /* ignore */ } }
      // 煙
      m.trailT -= dt;
      if (m.flame.visible && m.trailT <= 0 && this.fx && typeof this.fx.smoke === 'function') { m.trailT = C.trailEvery; this.fx.smoke(this._v2.copy(m.vel).normalize().multiplyScalar(-1.8).add(m.pos), 0.7); }
      if (m.t < C.armTime) { if (m.t > C.life) m.dead = true; continue; }
      // 当たり: 線分 p0 → m.pos と目標・乗り物・敵の近さ、建物・地面
      const seg = this._v1.copy(m.pos).sub(p0), segLen = seg.length();
      let hit = null, hitObj = null;
      if (m.target && !m.target.isFlare) { const h = this._near(m.target, C.fuse, p0, seg, segLen); if (h) { hit = h; hitObj = m.target; } }
      if (!hit && m.target && m.target.isFlare) { const h = this._near(m.target, C.fuse * 0.6, p0, seg, segLen); if (h) { hit = h; hitObj = null; } }
      if (!hit) for (const v of (ctx.vehicles || [])) {
        if (v === m.owner || v.wrecked || v.sunk || v.disposed) continue;
        if (Math.abs(v.pos.x - m.pos.x) > 60 || Math.abs(v.pos.z - m.pos.z) > 60) continue;
        const h = this._near(v, Math.max(C.fuse * 0.5, ((v.def && v.def.width) || 2) * 0.5 + 1), p0, seg, segLen);
        if (h) { hit = h; hitObj = v; break; }
      }
      if (!hit) for (const e of (ctx.enemies || [])) {
        if (e.dead || e.removed) continue;
        if (Math.abs(e.pos.x - m.pos.x) > 40 || Math.abs(e.pos.z - m.pos.z) > 40) continue;
        const h = this._near(e, 2.5, p0, seg, segLen);
        if (h) { hit = h; hitObj = e; break; }
      }
      if (!hit && ctx.ray && segLen > 1e-3) {
        const r = ctx.ray(p0, this._v2.copy(seg).multiplyScalar(1 / segLen), segLen);
        if (r) hit = { x: r.x, y: r.y, z: r.z, water: !!r.water, src: r.src || null };
      }
      if (hit) {
        m.pos.set(hit.x, hit.y, hit.z);
        this.stats.detonated++;
        this.last = { x: +hit.x.toFixed(1), y: +hit.y.toFixed(1), z: +hit.z.toFixed(1), t: +m.t.toFixed(2), obj: hitObj ? (hitObj.cityId || hitObj.kind || 'enemy') : null, water: !!hit.water, src: hit.src || null, from: m.from, target: m.target ? (m.target.isFlare ? 'flare' : (m.target.cityId || m.target.kind || 'enemy')) : null };
        if (hitObj) this.stats.hits++;
        if (ctx.onDetonate) ctx.onDetonate(m.pos, m, hitObj, !!hit.water);
        if (this.audio && typeof this.audio.play === 'function') this.audio.play('missile_explode', { pos: m.pos, priority: 3, refDistance: 25, maxDistance: 1500 });
        m.dead = true;
      } else if (m.t > C.life) {
        // 自爆（空中）
        this.last = { x: +m.pos.x.toFixed(1), y: +m.pos.y.toFixed(1), z: +m.pos.z.toFixed(1), t: +m.t.toFixed(2), obj: null, air: true };
        if (ctx.onDetonate) ctx.onDetonate(m.pos, m, null, false, true);
        m.dead = true;
      }
    }
  }

  _remove(i) {
    const m = this.list[i];
    if (m.mesh.parent) m.mesh.parent.remove(m.mesh);
    if (m.snd && typeof m.snd.stop === 'function') { try { m.snd.stop(0.05); } catch (e) { /* ignore */ } }
    m.snd = null;
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i);
    for (const f of this.flares) if (f.sprite.parent) f.sprite.parent.remove(f.sprite);
    this.flares.length = 0;
  }

  // ゲームを終える（Game.stop）: 飛んでいるミサイルのループ音（missile_loop）を止めて、ミサイルとフレアを外す。
  //   止めないと「もう一度」の後もループが鳴り続けていた（爆発・寿命でしか止めていなかった）。形・材質は共有（Missiles._S）なので捨てない
  dispose() {
    this.clear();
  }
};
MR.Missiles._id = 0;
// 飛び方の既定値（game.json の vehicles.types.jet.missile が上書き。数・ロックは jet.js の missile）
MR.Missiles.DEFAULTS = {
  speed: 480, accel: 220, ejectSpeed: 15, motorTime: 3.5, coastDrag: 40, dropTime: 0.25, armTime: 0.35, life: 9, turnG: 55, fuse: 9, loftFrom: 400, loftK: 0.5, loftMax: 300,
  losEvery: 0.1, losClear: 4, liftRate: 120, blastRadius: 16, damage: 650, trailEvery: 0.05, decoyRange: 2500, decoyChance: 0.8, flareLife: 3.2, maxFlares: 18
};
