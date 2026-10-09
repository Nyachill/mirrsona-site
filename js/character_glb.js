// glTF（スキンメッシュ + アニメーションクリップ）で描く兵士。MR.Character と同じインターフェース:
//   root（足元が原点、正面 +Z の Group）、update(dt, { moving, speed, aiming })、flinch()、die(fromDir)、
//   muzzleWorldPosition(target)、hitSpheres(out)、dispose()、dead
// モデルは一度だけパースしてキャッシュし（preload）、敵ごとに THREE.SkeletonUtils.clone で複製する。
// クリップ: idle / walk / run / aim / aim_walk / hit / death。無いクリップは近いものへ倒す。
// クリップが 1 つも無いモデルでもポーズのまま描ける。GLB が無ければ enemy.js が MR.Character を使う。
window.MR = window.MR || {};

MR.CharacterGLB = (function () {
  // ---------- 設定（assets/config/game.json の enemies.model。無ければ既定値） ----------
  const DEFAULTS = {
    file: 'models/soldier.glb',
    weapon: 'models/p90.glb',
    scale: 1.0,
    gunOffset: { pos: [0, 0, 0], rot: [0, 0, 0] },
    fadeTime: 0.15,        // 状態切替のクロスフェード秒
    hitFadeTime: 0.15,     // 被弾オーバーレイを抜く秒
    flashTime: 0.07,       // 被弾フラッシュ秒
    sinkAfter: 2.6,        // 死亡後、沈み始めるまでの秒
    sinkSpeed: 0.9,        // 沈む速さ m/s
    runSpeed: 0.8,         // speed がこれを超えたら run
    hitbox: { head: 0.16, headOffset: 0.06, body: 0.38, chest: 0.32, legs: 0.24 }
  };
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const arr3 = (v, d) => (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number' && isFinite(x))) ? v : d;

  // 無いクリップの代わりに使う順番
  const CLIP_FALLBACK = {
    idle: ['idle', 'aim', 'walk', 'aim_walk', 'run'],
    walk: ['walk', 'run', 'aim_walk', 'idle', 'aim'],
    run: ['run', 'walk', 'aim_walk', 'idle', 'aim'],
    aim: ['aim', 'idle', 'aim_walk', 'walk', 'run'],
    aim_walk: ['aim_walk', 'walk', 'aim', 'run', 'idle'],
    hit: ['hit'],
    death: ['death']
  };
  const LOOP_STATES = ['idle', 'walk', 'run', 'aim', 'aim_walk'];
  const HEAD_BONES = ['head', 'neck_02', 'neck_01'];
  const PELVIS_BONES = ['pelvis', 'spine_01', 'hips', 'Hips'];
  const CHEST_BONES = ['spine_05', 'spine_04', 'spine_03', 'spine_02', 'Spine2', 'Spine1', 'Spine'];
  const CALF_BONES = [['calf_l', 'LeftLeg', 'calf.L'], ['calf_r', 'RightLeg', 'calf.R']];
  const SOCKET_NAMES = ['gun_socket'];
  const FLASH_COLOR = 0xff5a2a;

  // キャッシュ（パース済み glTF、銃の glTF scene、設定）
  const C = { gltf: null, gun: null, config: null, promise: null, info: null };

  // "Armature|idle" / "root|Idle" / "idle" のような名前を受け付ける
  // 銃のファイル名 → 武器 id（'models/p90.glb' → 'p90'）
  function gunId(logical) { const m = /([a-z0-9_]+)\.glb$/i.exec(String(logical || '')); return m ? m[1].toLowerCase() : 'p90'; }

  function findClip(clips, key) {
    if (!clips || !clips.length) return null;
    const k = key.toLowerCase();
    for (const c of clips) if (c.name && c.name.toLowerCase() === k) return c;
    for (const c of clips) {
      const n = (c.name || '').toLowerCase();
      const parts = n.split(/[|:/]/);
      if (parts[parts.length - 1] === k) return c;
    }
    return null;
  }

  function pickClip(clips, key) {
    for (const name of CLIP_FALLBACK[key] || [key]) {
      const c = findClip(clips, name);
      if (c) return c;
    }
    return null;
  }

  function firstNamed(root, names) {
    if (!root) return null;
    for (const n of names) {
      const o = root.getObjectByName(n);
      if (o) return o;
    }
    return null;
  }

  function preferredTier(assets) {
    let t = (assets && assets.tier) || (MR.CONFIG && MR.CONFIG.ASSET_TIER) || 'auto';
    if (t !== 'hd' && t !== 'sd') {
      const touch = (typeof navigator !== 'undefined') && navigator.maxTouchPoints > 0;
      t = touch ? 'sd' : 'hd';
    }
    return t;
  }

  // 論理パス（models/soldier.glb）→ 実際のキー（hd/models/soldier.glb 等）。無ければ null
  function resolveKey(assets, logical) {
    if (!assets || !logical) return null;
    if (typeof assets.resolve === 'function') {
      const k = assets.resolve(logical);
      if (k) return k;
    }
    if (typeof assets.has !== 'function') return null;
    const tier = preferredTier(assets);
    const other = tier === 'hd' ? 'sd' : 'hd';
    for (const k of [tier + '/' + logical, other + '/' + logical, logical]) if (assets.has(k)) return k;
    return null;
  }

  // assets.loadModel の戻り値を { scene, animations } に揃える（旧 API は scene だけを返す）
  async function loadParsed(assets, key) {
    const res = await assets.loadModel(key);
    if (!res) return null;
    if (res.scene && res.scene.isObject3D) return { scene: res.scene, animations: res.animations || [] };
    if (res.isObject3D) {
      // 旧 API: アニメーションが落ちているので、バッファが残っていれば自前でパースし直す
      const buf = (typeof assets.get === 'function') ? assets.get(key) : null;
      if (buf && buf.byteLength && THREE.GLTFLoader) {
        try {
          const gltf = await new Promise((resolve, reject) => { new THREE.GLTFLoader().parse(buf, '', resolve, reject); });
          return { scene: gltf.scene, animations: gltf.animations || [] };
        } catch (e) { /* scene だけで続ける */ }
      }
      return { scene: res, animations: res.animations || [] };
    }
    return null;
  }

  // r128 の PropertyBinding は、トラックが指すノードが見つからないとミキサーのルート（モデル全体）に
  // 結び付けてしまう。存在しないノード（名前が違う／uuid 参照）を指すトラックはここで捨てる
  function sanitizeClips(scene, clips) {
    const out = [];
    const PB = THREE.PropertyBinding;
    const canCheck = !!(PB && PB.parseTrackName && PB.findNode);
    let dropped = 0;
    for (const clip of clips || []) {
      if (!clip || !Array.isArray(clip.tracks)) continue;
      let tracks = clip.tracks;
      if (canCheck) {
        tracks = clip.tracks.filter((t) => {
          let parsed;
          try { parsed = PB.parseTrackName(t.name); } catch (e) { return false; }
          const name = parsed.nodeName;
          if (!name || name === '.') return true; // ルート自身への指定は正当
          const node = PB.findNode(scene, name);
          return !!node && node.name === name;
        });
      }
      dropped += clip.tracks.length - tracks.length;
      if (!tracks.length) continue;
      out.push(tracks.length === clip.tracks.length ? clip : new THREE.AnimationClip(clip.name, clip.duration, tracks));
    }
    if (dropped) console.warn('[CharacterGLB] ノードが見つからないトラックを ' + dropped + ' 本無視しました');
    return out;
  }

  function describe(gltf) {
    const info = { skinned: false, meshes: 0, bones: 0, socket: false, head: false, clips: [] };
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) info.skinned = true;
      if (o.isMesh) info.meshes++;
      if (o.isBone) info.bones++;
      if (SOCKET_NAMES.indexOf(o.name) >= 0) info.socket = true;
      if (o.name === 'head') info.head = true;
    });
    info.clips = (gltf.animations || []).map((a) => a.name);
    return info;
  }

  class CharacterGLB {
    // 一度だけモデルをパースする。戻り値 Promise<boolean>（使えるようになったら true。失敗しても reject しない）
    static preload(assets, modelCfg) {
      if (C.promise) return C.promise;
      if (modelCfg) C.config = modelCfg;
      const cfg = Object.assign({}, DEFAULTS, C.config || {});
      C.promise = (async () => {
        try {
          if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return false;
          if (!assets || typeof assets.loadModel !== 'function') return false;
          const key = resolveKey(assets, cfg.file || DEFAULTS.file);
          if (!key) return false;
          const gltf = await loadParsed(assets, key);
          if (!gltf || !gltf.scene) return false;
          gltf.animations = sanitizeClips(gltf.scene, gltf.animations);
          const info = describe(gltf);
          if (!info.meshes) return false;
          // 銃（無くても良い: プロシージャルのライフルで代用）。enemies.model.weapon は 1 つか配列（個体ごとにランダム）
          const guns = [], gunIds = [];
          const list = Array.isArray(cfg.weapon) ? cfg.weapon : [cfg.weapon || DEFAULTS.weapon];
          for (const gunLogical of list) {
            if (typeof gunLogical !== 'string') continue;
            // 敵の銃は常に軽い sd 版（無ければ他のティア）。hd の P90 は 5 万三角形あるので敵 6 体分は重すぎる
            const gunKey = resolveKey(assets, /^(hd|sd)\//.test(gunLogical) ? gunLogical : 'sd/' + gunLogical) || resolveKey(assets, gunLogical);
            if (!gunKey) continue;
            try {
              const g = await loadParsed(assets, gunKey);
              if (g && g.scene) { guns.push(g.scene); gunIds.push(gunId(gunLogical)); }
            } catch (e) {
              console.warn('[CharacterGLB] 銃モデルを読めません:', gunKey, e && e.message);
            }
          }
          const gun = guns[0] || null;
          C.gltf = gltf; C.gun = gun; C.guns = guns; C.gunIds = gunIds; C.info = info;
          console.log('[CharacterGLB] loaded', key, 'clips', info.clips.join(',') || '(none)', 'socket', info.socket, 'gun', !!gun);
          return true;
        } catch (e) {
          console.warn('[CharacterGLB] モデルを読めません。コードモデルで続行します:', e && e.message);
          C.gltf = null; C.gun = null; C.guns = []; C.gunIds = [];
          return false;
        }
      })();
      return C.promise;
    }

    // preload 無しでパース済み glTF を直接渡す（テスト・スクリーンショット用）。gunScene は省略可
    static setParsed(gltf, gunScene, modelCfg) {
      if (modelCfg) C.config = modelCfg;
      C.gltf = (gltf && gltf.scene) ? { scene: gltf.scene, animations: sanitizeClips(gltf.scene, gltf.animations || []) } : null;
      C.gun = (gunScene && gunScene.isObject3D) ? gunScene : null;
      C.guns = C.gun ? [C.gun] : [];
      C.gunIds = C.gun ? [gunId((modelCfg && (Array.isArray(modelCfg.weapon) ? modelCfg.weapon[0] : modelCfg.weapon)) || DEFAULTS.weapon)] : [];
      C.info = C.gltf ? describe(C.gltf) : null;
      C.promise = Promise.resolve(!!C.gltf);
      return !!C.gltf;
    }

    static available() {
      return !!(C.gltf && C.gltf.scene && THREE.SkeletonUtils);
    }

    static info() { return C.info; }

    // キャッシュを捨てる（テスト用）
    static reset() { C.gltf = null; C.gun = null; C.guns = []; C.gunIds = []; C.info = null; C.promise = null; }

    // opts: { scale, config } または AssetManager（互換）
    constructor(opts) {
      if (opts && typeof opts.loadModel === 'function') opts = { assets: opts };
      this.opts = opts || {};
      this.cfg = Object.assign({}, DEFAULTS, C.config || {}, this.opts.config || {});
      if (!CharacterGLB.available()) throw new Error('CharacterGLB: モデルが読み込まれていません（preload を待ってください）');

      const gltf = C.gltf;
      this.source = 'files'; // tools/screenshot.js が見る（MR.Character は 'procedural'）
      this.scale = num(this.opts.scale, num(this.cfg.scale, 1));
      this.root = new THREE.Group();
      this.model = THREE.SkeletonUtils.clone(gltf.scene);
      this.model.scale.setScalar(this.scale);
      this.root.add(this.model);

      this.dead = false;
      this.deathTime = 0;
      this.sink = 0;
      this.fallDir = 1;
      this.fallSide = 0;
      this.flashTimer = 0;
      this.flinchTimer = 0;
      this.hitTimer = 0;
      this.hitFading = false;
      this.phase = Math.random();            // 個体ごとの位相（全員が同期しないように）
      this.state = null;
      this.current = null;
      this.ownGeometries = [];
      this._tmpQ = new THREE.Quaternion();
      this._tmpV = new THREE.Vector3();
      this._savedQ = new THREE.Quaternion();
      this._tweaked = false;

      this._prepareMeshes();
      this._findBones();
      this._attachGun();
      this._setupAnimation(gltf.animations || []);
      this._prepareHitSpheres();
    }

    // マテリアルを個体ごとに複製（SkeletonUtils.clone は共有する）し、影・カリングを設定
    _prepareMeshes() {
      this.flashMats = [];
      this.ownMaterials = [];
      this.model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false; // スキンメッシュのバウンディングは当てにならない
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = mats.map((m) => {
          if (!m || typeof m.clone !== 'function') return m;
          const c = m.clone();
          this.ownMaterials.push(c);
          if (c.emissive) this.flashMats.push({ mat: c, color: c.emissive.clone(), intensity: c.emissiveIntensity });
          return c;
        });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
      });
    }

    _findBones() {
      this.headBone = firstNamed(this.model, HEAD_BONES);
      this.pelvisBone = firstNamed(this.model, PELVIS_BONES);
      this.chestBone = firstNamed(this.model, CHEST_BONES);
      this.calfBones = CALF_BONES.map((names) => firstNamed(this.model, names));
      this.socket = firstNamed(this.model, SOCKET_NAMES);
    }

    // 銃: P90 の glTF（キャッシュ）を複製して gun_socket に付ける。無ければコードのライフル
    _attachGun() {
      const off = this.cfg.gunOffset || {};
      const pos = arr3(off.pos, DEFAULTS.gunOffset.pos);
      const rot = arr3(off.rot, DEFAULTS.gunOffset.rot);
      let gun, muzzleLocal;
      const gi = (C.guns && C.guns.length) ? Math.floor(Math.random() * C.guns.length) : -1;
      const src = gi >= 0 ? C.guns[gi] : C.gun;
      // 持っている銃の武器 id（街で倒したときに落とす物。models/p90.glb → 'p90'。コードのライフルは 'rifle'）
      this.weaponId = gi >= 0 ? ((C.gunIds && C.gunIds[gi]) || 'p90') : (src ? 'p90' : 'rifle');
      if (src) {
        gun = src.clone();
        gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
        muzzleLocal = new THREE.Vector3(0, 0.03, -0.22); // P90: グリップ原点、全長 0.5m、銃口 -Z
      } else {
        gun = MR.Models.rifle(MR.Models.shared());
        gun.traverse((o) => { if (o.isMesh && o.geometry) this.ownGeometries.push(o.geometry); });
        muzzleLocal = gun.userData.muzzle ? gun.userData.muzzle.clone() : new THREE.Vector3(0, 0.07, -0.72);
      }
      this.gun = gun;
      this.gunIsGLB = !!src;
      if (this.socket) {
        // ソケットは「銃口 -Z の銃がそのまま収まる」向きで作られている（glTF 武器の規約）。設定のオフセットを上乗せ
        gun.position.set(pos[0], pos[1], pos[2]);
        gun.rotation.set(rot[0], rot[1], rot[2]);
        this.socket.add(gun);
      } else {
        // ソケットが無いモデル: 胸の前に固定（MR.Character と同じ考え方。銃口を +Z = 正面へ）
        gun.position.set(0.1 + pos[0], 1.26 + pos[1], 0.28 + pos[2]);
        gun.rotation.set(rot[0], Math.PI + rot[1], rot[2]);
        this.model.add(gun);
      }
      this.muzzleNode = gun.getObjectByName('muzzle') || null;
      this.muzzleLocal = muzzleLocal;
    }

    _setupAnimation(clips) {
      this.mixer = new THREE.AnimationMixer(this.model);
      this.actions = {};
      this.clipNames = {};
      for (const key of Object.keys(CLIP_FALLBACK)) {
        const clip = pickClip(clips, key);
        if (!clip) continue;
        // 同じクリップに倒れた状態は同じアクションを共有する（クロスフェードで自分自身へ移らないように）
        const existing = Object.keys(this.actions).find((k) => this.actions[k].getClip() === clip);
        this.actions[key] = existing ? this.actions[existing] : this.mixer.clipAction(clip);
        this.clipNames[key] = clip.name;
      }
      for (const key of LOOP_STATES) {
        const a = this.actions[key];
        if (a) { a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; }
      }
      const hit = this.actions.hit;
      if (hit && !LOOP_STATES.some((k) => this.actions[k] === hit)) { hit.setLoop(THREE.LoopOnce, 1); hit.clampWhenFinished = true; }
      const death = this.actions.death;
      if (death) { death.setLoop(THREE.LoopOnce, 1); death.clampWhenFinished = true; }
      this._play('idle', 0);
      this.mixer.update(0);
    }

    _prepareHitSpheres() {
      const hb = Object.assign({}, DEFAULTS.hitbox, this.cfg.hitbox || {});
      const s = this.scale;
      // 胴体 → 胸 → 頭の順（同じ距離なら胴体を優先するため、頭は最後）
      // 脚（膝）→ 腰 → 胸（spine_05 ≒ 1.35 m）→ 頭。同じ距離なら先に並ぶ胴体を優先するため、頭は最後
      this.spheres = [];
      const legR = num(hb.legs, 0.24) * s;
      if (legR > 0) {
        for (let i = 0; i < 2; i++) {
          const bone = this.calfBones ? this.calfBones[i] : null;
          this.spheres.push({ center: new THREE.Vector3(), radius: legR, head: false, bone, fixedY: 0.5 * s, fixedX: (i ? 0.12 : -0.12) * s });
        }
      }
      this.spheres.push(
        { center: new THREE.Vector3(), radius: num(hb.body, 0.38) * s, head: false, bone: this.pelvisBone, fixedY: 0.92 * s },
        { center: new THREE.Vector3(), radius: num(hb.chest, 0.32) * s, head: false, bone: this.chestBone, fixedY: 1.35 * s },
        { center: new THREE.Vector3(), radius: num(hb.head, 0.16) * s, head: true, bone: this.headBone, fixedY: 1.62 * s, up: num(hb.headOffset, 0.06) * s }
      );
    }

    // ---------- アニメーション ----------

    _desiredState(state) {
      const moving = !!(state && state.moving);
      const aiming = !!(state && state.aiming);
      const speed = num(state && state.speed, 1);
      if (moving && aiming) return 'aim_walk';
      if (moving) return speed > num(this.cfg.runSpeed, 0.8) ? 'run' : 'walk';
      if (aiming) return 'aim';
      return 'idle';
    }

    _play(name, fade) {
      const next = this.actions[name];
      this.state = name;
      if (!next) return;
      if (this.current === next) return;
      const prev = this.current;
      next.reset();
      next.enabled = true;
      next.setEffectiveTimeScale(1);
      next.setEffectiveWeight(1);
      if (next.loop !== THREE.LoopOnce) next.time = this.phase * next.getClip().duration; // 個体ごとの位相ずらし
      if (fade > 0) {
        if (prev) prev.fadeOut(fade);
        next.fadeIn(fade);
      } else if (prev) {
        prev.stop();
      }
      next.play();
      this.current = next;
    }

    // state: { moving: bool, speed: 0..1, aiming: bool }
    update(dt, state) {
      dt = num(dt, 0);
      if (this._tweaked) { this.chestBone.quaternion.copy(this._savedQ); this._tweaked = false; }
      if (this.dead) { this._updateDeath(dt); return; }

      const desired = this._desiredState(state || {});
      if (desired !== this.state) this._play(desired, num(this.cfg.fadeTime, 0.15));

      // 被弾オーバーレイ: 終わり際にフェードアウトして消す
      if (this.hitTimer > 0) {
        this.hitTimer -= dt;
        const hf = num(this.cfg.hitFadeTime, 0.15);
        if (!this.hitFading && this.hitTimer <= hf) {
          this.hitFading = true;
          if (this.actions.hit && this.actions.hit !== this.current) this.actions.hit.fadeOut(Math.max(0.01, hf));
        }
      }
      if (this.flinchTimer > 0) this.flinchTimer -= dt;
      if (this.flashTimer > 0) {
        this.flashTimer -= dt;
        if (this.flashTimer <= 0) this._setFlash(0);
      }

      this.mixer.update(dt);

      // hit クリップが無いときの仰け反り（ミキサーの後に胸のボーンを少し回す。次フレーム冒頭で戻す）
      if (!this.actions.hit && this.flinchTimer > 0 && this.chestBone) {
        const f = Math.max(0, this.flinchTimer / 0.18);
        this._savedQ.copy(this.chestBone.quaternion);
        this.chestBone.quaternion.multiply(this._tmpQ.setFromAxisAngle(this._tmpV.set(0, 0, 1), -f * 0.25));
        this._tweaked = true;
      }
    }

    flinch() {
      if (this.dead) return;
      this.flinchTimer = 0.18;
      this._setFlash(1);
      this.flashTimer = num(this.cfg.flashTime, 0.07);
      const hit = this.actions.hit;
      if (hit && hit !== this.current) {
        hit.reset();
        hit.enabled = true;
        hit.setEffectiveTimeScale(1);
        hit.setEffectiveWeight(1);
        hit.fadeIn(0.05);
        hit.play();
        this.hitTimer = hit.getClip().duration;
        this.hitFading = false;
      }
    }

    _setFlash(on) {
      for (const f of this.flashMats) {
        if (on) { f.mat.emissive.setHex(FLASH_COLOR); f.mat.emissiveIntensity = 0.9; }
        else { f.mat.emissive.copy(f.color); f.mat.emissiveIntensity = f.intensity; }
      }
    }

    die(fromDir) {
      if (this.dead) return;
      this.dead = true;
      this.deathTime = 0;
      this.flinchTimer = 0;
      this.hitTimer = 0;
      this._setFlash(0);
      // 撃たれた方向の反対へ倒れる（fromDir は弾の進行方向、ワールド）。death クリップがあるときはクリップ任せ
      if (fromDir) {
        const fwd = this._tmpV.set(0, 0, 1).applyQuaternion(this.root.quaternion);
        this.fallDir = fwd.dot(fromDir) > 0 ? 1 : -1;
      } else {
        this.fallDir = Math.random() < 0.5 ? 1 : -1;
      }
      this.fallSide = (Math.random() - 0.5) * 0.6;
      const death = this.actions.death;
      if (death) {
        const fade = 0.1;
        for (const k of Object.keys(this.actions)) {
          const a = this.actions[k];
          if (a !== death && a.isRunning()) a.fadeOut(fade);
        }
        death.reset();
        death.enabled = true;
        death.setEffectiveTimeScale(1);
        death.setEffectiveWeight(1);
        death.fadeIn(fade);
        death.play();
        this.current = death;
        this.state = 'death';
      }
    }

    _updateDeath(dt) {
      this.deathTime += dt;
      // しばらくして沈む（累積）
      if (this.deathTime > num(this.cfg.sinkAfter, 2.6)) this.sink += dt * num(this.cfg.sinkSpeed, 0.9);
      if (!this.actions.death) {
        // クリップが無い: MR.Character と同じく足元を支点に倒す
        const t = Math.min(1, this.deathTime / 0.5);
        const e = 1 - (1 - t) * (1 - t);
        this.root.rotation.x = this.fallDir * e * Math.PI / 2 * 0.98;
        this.root.rotation.z = this.fallSide * e;
        this.root.position.y = 0.05 * e - this.sink;
      } else {
        this.root.position.y = -this.sink;
      }
      this.mixer.update(dt);
    }

    // ---------- 判定・位置 ----------

    muzzleWorldPosition(target) {
      target = target || new THREE.Vector3();
      if (this.muzzleNode) {
        this.muzzleNode.updateWorldMatrix(true, false);
        return target.setFromMatrixPosition(this.muzzleNode.matrixWorld);
      }
      this.gun.updateWorldMatrix(true, false);
      return target.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld);
    }

    // 当たり判定の球（ワールド座標）。[{ center, radius, head }]。胴体の後に頭
    hitSpheres(out) {
      const list = out || [];
      list.length = 0;
      for (const s of this.spheres) {
        if (s.bone) {
          s.bone.updateWorldMatrix(true, false);
          s.center.setFromMatrixPosition(s.bone.matrixWorld);
          if (s.up) s.center.y += s.up;
        } else {
          this.root.updateWorldMatrix(true, false);
          s.center.set(s.fixedX || 0, s.fixedY, 0).applyMatrix4(this.root.matrixWorld);
        }
        list.push(s);
      }
      return list;
    }

    dispose() {
      if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); }
      for (const m of this.ownMaterials) m.dispose(); // テクスチャは共有なので消さない
      for (const g of this.ownGeometries) g.dispose(); // コードのライフルだけ（glTF のジオメトリは共有）
      this.model.traverse((o) => { if (o.isSkinnedMesh && o.skeleton && o.skeleton.dispose) o.skeleton.dispose(); });
      if (this.root.parent) this.root.parent.remove(this.root);
    }
  }

  CharacterGLB.DEFAULTS = DEFAULTS;
  return CharacterGLB;
})();
