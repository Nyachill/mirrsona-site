// ストーリーの場面のカメラ（MR.StoryCam）。cine.js の MR.Cine（端末のクラス）とは別物。
//   鍵 keys: [{ t, p: 場所, look: 場所 | '@役者', fov, roll, ease: 'linear' | 'inOut', cut }]。位置は Catmull-Rom、向きは look の点、FOV は直線。
//   game.camera だけを動かす（プレイヤーの体は動かさない = setFreeCam は使わない）。終わったら元のカメラの姿勢に戻す。
//   揺れ shake: [[t, 大きさ, 長さ]]。resolve(anchor) は storymode が渡す（{ x, y, z }）。
window.MR = window.MR || {};

(function () {
  const ease = (k, u) => (k === 'inOut' ? u * u * (3 - 2 * u) : k === 'in' ? u * u : k === 'out' ? 1 - (1 - u) * (1 - u) : u);
  const cr = (p0, p1, p2, p3, u) => { const u2 = u * u, u3 = u2 * u; return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); };

  class StoryCam {
    // shot: 章の shots[id]、resolve: (anchor) → { x, y, z } | null
    constructor(camera, shot, resolve) {
      this.camera = camera;
      this.shot = shot;
      this.t = 0;
      this.dur = shot.keys[shot.keys.length - 1].t + (shot.hold == null ? 0.5 : shot.hold);
      this.keys = shot.keys.map((k) => ({ t: k.t, p: resolve(k.p), look: k.look ? k.look : null, fov: k.fov, roll: k.roll || 0, ease: k.ease || 'linear', cut: !!k.cut }));
      this.resolve = resolve;
      this.saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, parent: camera.parent };
      this._look = new THREE.Vector3(); this._p = new THREE.Vector3(); this._m = new THREE.Matrix4();
      this.done = false;
      this.fov0 = camera.fov;
      // カメラは player.object の子のことがある: 場面の間は世界の座標で置く（親から外す）
      if (camera.parent) { this.parent = camera.parent; camera.parent.remove(camera); }
    }

    // 時刻 t の姿勢
    _pose(t, out) {
      const K = this.keys;
      let i = 0;
      while (i < K.length - 1 && t >= K[i + 1].t) i++;
      const a = K[i], b = K[Math.min(K.length - 1, i + 1)];
      const span = b.t - a.t;
      let u = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 0;
      if (b.cut) u = 0;
      u = ease(b.ease, u);
      const p0 = K[Math.max(0, i - 1)].p, p1 = a.p, p2 = b.p, p3 = K[Math.min(K.length - 1, i + 2)].p;
      if (p1 && p2) out.p.set(cr(p0.x, p1.x, p2.x, p3.x, u), cr(p0.y, p1.y, p2.y, p3.y, u), cr(p0.z, p1.z, p2.z, p3.z, u));
      const la = a.look ? this.resolve(a.look) : null, lb = b.look ? this.resolve(b.look) : la;
      if (la && lb) out.look.set(la.x + (lb.x - la.x) * u, la.y + (lb.y - la.y) * u, la.z + (lb.z - la.z) * u);
      out.fov = (a.fov || this.fov0) + ((b.fov || a.fov || this.fov0) - (a.fov || this.fov0)) * u;
      out.roll = a.roll + (b.roll - a.roll) * u;
      return out;
    }

    update(dt) {
      if (this.done) return;
      this.t += dt;
      const o = this._o || (this._o = { p: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, roll: 0 });
      this._pose(Math.min(this.t, this.dur), o);
      const c = this.camera;
      c.position.copy(o.p);
      // 揺れ
      for (const s of this.shot.shake || []) {
        const dt0 = this.t - s[0];
        if (dt0 >= 0 && dt0 < s[2]) { const k = s[1] * (1 - dt0 / s[2]); c.position.x += Math.sin(this.t * 61) * k; c.position.y += Math.sin(this.t * 47 + 1) * k; }
      }
      this._m.lookAt(c.position, o.look, THREE.Object3D.DefaultUp);
      c.quaternion.setFromRotationMatrix(this._m);
      if (o.roll) c.rotateZ(o.roll * Math.PI / 180);
      if (Math.abs(c.fov - o.fov) > 0.01) { c.fov = o.fov; c.updateProjectionMatrix(); }
      c.updateMatrixWorld(true);
      if (this.t >= this.dur) this.done = true;
    }

    skip() { this.t = this.dur; this.update(0); this.done = true; }

    // 元に戻す（カメラを親に戻し、姿勢と FOV）
    restore() {
      const c = this.camera, s = this.saved;
      if (this.parent) this.parent.add(c);
      c.position.copy(s.pos); c.quaternion.copy(s.quat);
      if (c.fov !== s.fov) { c.fov = s.fov; c.updateProjectionMatrix(); }
      c.updateMatrixWorld(true);
    }
  }

  MR.StoryCam = StoryCam;
})();
