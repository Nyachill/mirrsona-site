// 街の地区の灯（MR.CityLights。ストーリーだけ。storymode.js が作る）: ヴェールが止めたのはホットゾーン（地区）の送電だけ（plan §1）。
//   遠景: 街の遠景の材質の uZones（vec4(x, z, R, r)）・uZoneDim（world.js makeFarMaterial。far.bin の鍵の外）。R の中で r の外の窓は dim 倍。
//     灯をつける（relight）= r を 0 → R へ ringSec 秒で広げる、消す（blackout）= r を R → 0。どの地区も R 0 なら今までと同じ（フリー・バトロワ・アリーナ）。
//   近景: 暗い地区の中にいる間、窓のある外壁の材質の発光を dim 倍へ寄せる（地区の外・灯がついたら戻す）。
//   光の柱: InstancedMesh 1 つ（上の開いた 8 角の筒・加算・霧なし・影なし・テクスチャなし）= 1 回の描画で 12 本まで。
//   地図: zonesInfo() = [{ id, x, z, r, lit }]（minimap が金色で塗る）。
window.MR = window.MR || {};

(function () {
  const DEF = { dim: 0.35, ringSec: 4, pillarH: 400, pillarR: 4, pillarColor: '#ffd9a0', pillarSec: 12, nearSec: 1.5 };

  class CityLights {
    constructor(game, cfg) {
      this.game = game;
      this.cfg = Object.assign({}, DEF, cfg || {});
      const C = game.city || {};
      const list = C.hotZones || [];
      this.zones = [];
      const seen = {};
      for (const z of list) {
        if (!z || seen[z.id]) continue;
        seen[z.id] = 1;
        this.zones.push({ id: z.id, x: z.x, z: z.z, R: z.r || 150, r: z.r || 150, to: z.r || 150, rate: 0, pillar: 0 });
      }
      this.mat = game.world && game.world.farMaterial ? game.world.farMaterial : null;
      this.U = this.mat && this.mat.userData.uniforms ? this.mat.userData.uniforms : null;
      if (this.U && this.U.uZoneDim) this.U.uZoneDim.value = this.cfg.dim;
      this.nearK = 1; this._winMats = null;
      this.pillars = null;
      this.stats = { relights: 0, blackouts: 0 };
      this._write();
    }

    zone(id) { return this.zones.find((z) => z.id === id) || null; }
    isLit(id) { const z = this.zone(id); return !z || z.r >= z.R - 0.01; }

    // 章の始め: ids を暗く（すぐ）、ほかは明るく
    setDark(ids) {
      const dark = new Set(ids || []);
      for (const z of this.zones) { z.r = z.to = dark.has(z.id) ? 0 : z.R; z.rate = 0; z.pillar = 0; }
      this._write();
    }
    relight(id, instant) {
      const z = this.zone(id); if (!z) return false;
      z.to = z.R; z.rate = z.R / Math.max(0.01, this.cfg.ringSec); z.pillar = this.cfg.pillarSec;
      if (instant) z.r = z.R;
      this.stats.relights++;
      const a = this.game.audio; if (a && typeof a.play === 'function') a.play('relight_chord', { volume: 0.7, priority: 2 });
      this._write();
      return true;
    }
    blackout(id, instant) {
      const z = this.zone(id); if (!z) return false;
      z.to = 0; z.rate = z.R / Math.max(0.01, this.cfg.ringSec * 0.5);
      if (instant) z.r = 0;
      this.stats.blackouts++;
      this._write();
      return true;
    }
    // 全部の地区がもう動いていないか
    get settled() { return this.zones.every((z) => z.r === z.to); }

    update(dt) {
      let ch = false;
      for (const z of this.zones) {
        if (z.r !== z.to) { z.r = z.r < z.to ? Math.min(z.to, z.r + z.rate * dt) : Math.max(z.to, z.r - z.rate * dt); ch = true; }
        if (z.pillar > 0) { z.pillar = Math.max(0, z.pillar - dt); ch = true; }
      }
      if (ch) this._write();
      this._near(dt);
    }

    _write() {
      const U = this.U;
      if (U && U.uZones) {
        const v = U.uZones.value;
        for (let i = 0; i < v.length; i++) { const z = this.zones[i]; if (z) v[i].set(z.x, z.z, z.R, z.r); else v[i].set(0, 0, 0, 0); }
      }
      this._pillars();
    }

    // 近景の窓: 暗い地区の中（r の外）にいる間は発光を dim 倍へ
    _near(dt) {
      const p = this.game.player && this.game.player.pos;
      if (!p) return;
      let want = 1;
      for (const z of this.zones) { const d = Math.hypot(p.x - z.x, p.z - z.z); if (d < z.R && d >= z.r) { want = this.cfg.dim; break; } }
      if (this.nearK === want) return;
      const s = dt / Math.max(0.05, this.cfg.nearSec);
      this.nearK = this.nearK < want ? Math.min(want, this.nearK + s) : Math.max(want, this.nearK - s);
      this._applyNear(this.nearK);
    }
    _applyNear(k) {
      const M = this.game.materials;
      if (!M || !M.materials) return;
      if (!this._winMats) {
        this._winMats = [];
        const add = (m) => { if (m && m.userData && m.userData.mrDef && m.userData.mrDef.windows && typeof m.emissiveIntensity === 'number') { if (m.userData.storyEmi == null) m.userData.storyEmi = m.emissiveIntensity; this._winMats.push(m); } };
        for (const key in M.materials) add(M.materials[key]);
        if (M._wet) for (const key in M._wet) add(M._wet[key]);
      }
      for (const m of this._winMats) m.emissiveIntensity = m.userData.storyEmi * k;
    }

    _pillars() {
      const live = this.zones.filter((z) => z.pillar > 0);
      if (!live.length && !this.pillars) return;
      const g = this.game;
      if (!this.pillars) {
        const geo = new THREE.CylinderGeometry(this.cfg.pillarR, this.cfg.pillarR * 1.6, this.cfg.pillarH, 8, 1, true);
        geo.translate(0, this.cfg.pillarH / 2, 0);
        // 縦の色の消え方（下が明るい）を頂点色で
        const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { const k = 1 - pos.getY(i) / this.cfg.pillarH; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k * k; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const mat = new THREE.MeshBasicMaterial({ color: MR.srgb(this.cfg.pillarColor), vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
        this.pillars = new THREE.InstancedMesh(geo, mat, 12);
        this.pillars.frustumCulled = false;
        this.pillars.castShadow = false; this.pillars.receiveShadow = false;
        this.pillars.name = 'storyPillars';
        g.scene.add(this.pillars);
      }
      const m = this._m || (this._m = new THREE.Matrix4());
      let n = 0;
      for (const z of live) {
        if (n >= 12) break;
        const k = Math.min(1, z.pillar / 2) * Math.min(1, (this.cfg.pillarSec - z.pillar) / 0.6 + 0.2);
        const y = (g.city && g.city.groundAt ? (g.city.groundAt(z.x, z.z).y || 0) : 0);
        m.makeScale(k, 1, k).setPosition(z.x, y, z.z);
        this.pillars.setMatrixAt(n++, m);
      }
      this.pillars.count = n;
      this.pillars.instanceMatrix.needsUpdate = true;
      this.pillars.visible = n > 0;
    }

    zonesInfo() { return this.zones.map((z) => ({ id: z.id, x: z.x, z: z.z, r: z.R, lit: z.R > 0 ? z.r / z.R : 1 })); }

    dispose() {
      // 地区の uniform を今までの値（どこも明るい）に戻す（材質は次のゲームでも使う）
      for (const z of this.zones) { z.r = z.to = z.R; z.pillar = 0; }
      if (this.U && this.U.uZones) for (const v of this.U.uZones.value) v.set(0, 0, 0, 0);
      if (this.U && this.U.uZoneDim) this.U.uZoneDim.value = 1;
      if (this._winMats) this._applyNear(1);
      if (this.pillars) { if (this.pillars.parent) this.pillars.parent.remove(this.pillars); this.pillars.geometry.dispose(); this.pillars.material.dispose(); this.pillars.dispose && this.pillars.dispose(); this.pillars = null; }
    }
  }

  MR.CityLights = CityLights;
})();
