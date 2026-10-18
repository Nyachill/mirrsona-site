// 端末の機能テスト（raw WebGL。three.js を使わない）。render-bench.html が読む。
// window.BenchCaps.run({ gl1: bool, salt0: n }) → Promise<result>
// どのテストも try/catch で包み、拡張が無ければ status 'unsupported'（失敗にしない）。WebGL1 だけのブラウザでも動く。
(function () {
  'use strict';

  function now() { return performance.now(); }
  function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- context ----------
  function makeCtx(gl1) {
    const c = document.createElement('canvas'); c.width = c.height = 4;
    let gl = null, v = 0;
    const attr = { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    if (!gl1) { try { gl = c.getContext('webgl2', attr); } catch (e) { gl = null; } if (gl) v = 2; }
    if (!gl) { try { gl = c.getContext('webgl', attr) || c.getContext('experimental-webgl', attr); } catch (e) { gl = null; } if (gl) v = 1; }
    return { canvas: c, gl, v };
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return s;
  }
  function program(gl, vs, fs, attribs) {
    const p = gl.createProgram();
    const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v); gl.attachShader(p, f);
    (attribs || []).forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = (gl.getShaderInfoLog(v) || '') + (gl.getShaderInfoLog(f) || '') + (gl.getProgramInfoLog(p) || '');
      throw new Error('link: ' + log.slice(0, 600));
    }
    return p;
  }

  // ---------- sampling helper: draw a fullscreen triangle into a 4×4 RGBA8 target and read one pixel ----------
  function Sampler(ctx) {
    const gl = ctx.gl;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const tgt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tgt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tgt, 0);
    const VS1 = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
    const VS3 = '#version 300 es\nin vec2 p; out vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
    const px = new Uint8Array(4);
    return {
      VS1, VS3, fbo, buf,
      // draw with `prog` into `fb` (default: the RGBA8 4×4 target); returns [r,g,b,a] of pixel (1,1) of the RGBA8 target
      draw(prog, setup, fb) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb || fbo); gl.viewport(0, 0, 4, 4);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        if (setup) setup(prog);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (fb && fb !== fbo) return null;
        gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2], px[3]];
      }
    };
  }
  const close = (a, b, tol) => a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= tol;

  // ---------- compressed block generators ----------
  // ASTC void-extent block (constant colour, LDR): bits 0..8 = 0x1FC, bit 9 = 0 (LDR), bits 10..11 = 1, bits 12..63 = all ones
  // ("no extent"), bits 64..127 = R, G, B, A as 16-bit UNORM. Valid for every block footprint.
  function astcBlock(c) {
    const b = new Uint8Array(16);
    b[0] = 0xFC; b[1] = 0xFD; for (let i = 2; i < 8; i++) b[i] = 0xFF;
    for (let k = 0; k < 4; k++) { const v = c[k] * 257; b[8 + 2 * k] = v & 255; b[9 + 2 * k] = (v >> 8) & 255; }
    return b;
  }
  // S3TC DXT1: colour0 == colour1 (RGB565) → 3-colour mode, all indices 0 = colour0
  function dxt1Block(c) {
    const r = Math.round(c[0] * 31 / 255), g = Math.round(c[1] * 63 / 255), bl = Math.round(c[2] * 31 / 255);
    const v = (r << 11) | (g << 5) | bl;
    return new Uint8Array([v & 255, v >> 8, v & 255, v >> 8, 0, 0, 0, 0]);
  }
  function dxt1Expect(c) {
    const r = Math.round(c[0] * 31 / 255), g = Math.round(c[1] * 63 / 255), bl = Math.round(c[2] * 31 / 255);
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (bl << 3) | (bl >> 2), 255];
  }
  function blocks(fn, c, n) { const one = fn(c); const out = new Uint8Array(one.length * n); for (let i = 0; i < n; i++) out.set(one, i * one.length); return out; }

  const COLORS = [[200, 100, 50, 255], [40, 180, 220, 255], [250, 230, 20, 255]];

  function texParams(gl, target, filter) {
    const f = filter || gl.LINEAR;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // 2D compressed: upload a 2×2-block texture, each block its own colour (row-major, block 0 at t = 0),
  // sample every block's centre with NEAREST → also catches a wrong block order / row stride inside one image
  const BLOCK_COLORS = [COLORS[0], COLORS[1], COLORS[2], [90, 60, 160, 255]];
  function testCompressed2D(ctx, S, fmt, bw, bh, blockFn, expectFn) {
    const gl = ctx.gl;
    const w = bw * 2, h = bh * 2;
    const per = BLOCK_COLORS.map((c) => blockFn(c));
    const data = new Uint8Array(per[0].length * 4); per.forEach((a, i) => data.set(a, i * a.length));
    while (gl.getError()) { /* clear */ }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    const t0 = now();
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, data);
    const err = gl.getError();
    const uploadMs = now() - t0;
    texParams(gl, gl.TEXTURE_2D, gl.NEAREST);
    if (err) { gl.deleteTexture(tex); return { status: 'fail', glError: '0x' + err.toString(16), size: w + 'x' + h }; }
    const fs = 'precision mediump float; uniform sampler2D t; uniform vec2 uUv; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, uUv); }';
    const p = program(gl, S.VS1, fs, ['p']);
    const res = []; let ok = true;
    for (let i = 0; i < 4; i++) {
      const bx = i & 1, by = i >> 1;
      const got = S.draw(p, (pr) => { gl.uniform1i(gl.getUniformLocation(pr, 't'), 0); gl.uniform2f(gl.getUniformLocation(pr, 'uUv'), (bx + 0.5) / 2, (by + 0.5) / 2); });
      const exp = expectFn(BLOCK_COLORS[i]);
      if (!close(got, exp, 3)) ok = false;
      res.push({ block: i, got, expect: exp });
    }
    gl.deleteTexture(tex); gl.deleteProgram(p);
    return { status: ok ? 'ok' : 'fail', got: res[0].got, expect: res[0].expect, blocks: res, size: w + 'x' + h, uploadMs: +uploadMs.toFixed(3) };
  }

  // 2D ARRAY (WebGL2): three layers of different colours; method 'image3d' = compressedTexImage3D, 'storage' = texStorage3D + compressedTexSubImage3D
  function testArray(ctx, S, fmt, bw, bh, blockFn, expectFn, method) {
    const gl = ctx.gl;
    const w = bw * 2, h = bh * 2, L = COLORS.length;
    let all = null;
    if (fmt !== 'rgba8') {
      const layers = COLORS.map((c) => blocks(blockFn, c, 4));
      all = new Uint8Array(layers[0].length * L); layers.forEach((a, i) => all.set(a, i * a.length));
    }
    while (gl.getError()) { /* clear */ }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const t0 = now();
    if (fmt === 'rgba8') {
      const px = new Uint8Array(w * h * 4 * L);
      for (let l = 0; l < L; l++) for (let i = 0; i < w * h; i++) px.set(COLORS[l], (l * w * h + i) * 4);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, L, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    } else if (method === 'storage') {
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, fmt, w, h, L);
      gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, w, h, L, fmt, all);
    } else {
      gl.compressedTexImage3D(gl.TEXTURE_2D_ARRAY, 0, fmt, w, h, L, 0, all);
    }
    const err = gl.getError();
    const uploadMs = now() - t0;
    texParams(gl, gl.TEXTURE_2D_ARRAY);
    if (err) { gl.deleteTexture(tex); return { status: 'fail', glError: '0x' + err.toString(16), layers: L, size: w + 'x' + h }; }
    const fs = '#version 300 es\nprecision mediump float; precision mediump sampler2DArray; uniform sampler2DArray t; uniform float uL; in vec2 vUv; out vec4 o; void main(){ o = texture(t, vec3(0.5, 0.5, uL)); }';
    const p = program(gl, S.VS3, fs, ['p']);
    const res = [];
    let ok = true;
    for (let l = 0; l < L; l++) {
      const got = S.draw(p, (pr) => { gl.uniform1i(gl.getUniformLocation(pr, 't'), 0); gl.uniform1f(gl.getUniformLocation(pr, 'uL'), l); });
      const exp = fmt === 'rgba8' ? COLORS[l] : expectFn(COLORS[l]);
      if (!close(got, exp, 3)) ok = false;
      res.push({ layer: l, got, expect: exp });
    }
    gl.deleteTexture(tex); gl.deleteProgram(p);
    return { status: ok ? 'ok' : 'fail', layers: res, size: w + 'x' + h + 'x' + L, uploadMs: +uploadMs.toFixed(3) };
  }

  // float16 helpers
  function toHalf(f) {
    const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f); const x = b.getUint32(0);
    const s = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    if (e <= 0) return s; if (e >= 31) return s | 0x7c00;
    return s | (e << 10) | (m >> 13);
  }

  // RGBA16F: 2×1 texture (0 and 1), LINEAR, sample between the texel centres → 0.5 if linear filtering works
  function testHalfLinear(ctx, S) {
    const gl = ctx.gl;
    let type, internal;
    if (ctx.v === 2) { type = gl.HALF_FLOAT; internal = gl.RGBA16F; }
    else {
      const ext = gl.getExtension('OES_texture_half_float');
      if (!ext) return { status: 'unsupported', why: 'OES_texture_half_float' };
      type = ext.HALF_FLOAT_OES; internal = gl.RGBA;
    }
    const linExt = !!gl.getExtension('OES_texture_half_float_linear');
    // WebGL1 without OES_texture_half_float_linear: half float is NEAREST-only by spec → unsupported, not a failure
    if (ctx.v === 1 && !linExt) return { status: 'unsupported', why: 'OES_texture_half_float_linear', extLinear: false, core: false };
    const one = toHalf(1);
    const data = new Uint16Array([0, 0, 0, one, one, one, one, one]);
    while (gl.getError()) { /* clear */ }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 2, 1, 0, gl.RGBA, type, data);
    const err = gl.getError();
    texParams(gl, gl.TEXTURE_2D);
    if (err) { gl.deleteTexture(tex); return { status: 'fail', glError: '0x' + err.toString(16), extLinear: linExt }; }
    const fs = 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vec2(0.5, 0.5)).rgb, 1.0); }';
    const p = program(gl, S.VS1, fs, ['p']);
    const got = S.draw(p, (pr) => gl.uniform1i(gl.getUniformLocation(pr, 't'), 0));
    gl.deleteTexture(tex); gl.deleteProgram(p);
    const mid = got[0] >= 110 && got[0] <= 145;
    return { status: mid ? 'ok' : 'fail', got, expect: '≈128', filter: mid ? 'linear' : (got[0] > 200 || got[0] < 50) ? 'nearest-or-incomplete' : '?', extLinear: linExt, core: ctx.v === 2 };
  }

  // render to RGBA16F (value > 1), then sample it scaled down into RGBA8
  function testHalfRender(ctx, S) {
    const gl = ctx.gl;
    let type, internal;
    const cbf = ctx.v === 2 ? !!gl.getExtension('EXT_color_buffer_float') : false;
    const cbh = !!gl.getExtension('EXT_color_buffer_half_float');
    if (ctx.v === 2) { type = gl.HALF_FLOAT; internal = gl.RGBA16F; }
    else {
      const ext = gl.getExtension('OES_texture_half_float');
      if (!ext) return { status: 'unsupported', why: 'OES_texture_half_float' };
      type = ext.HALF_FLOAT_OES; internal = gl.RGBA;
    }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      return { status: (cbf || cbh) ? 'fail' : 'unsupported', fbStatus: '0x' + st.toString(16), EXT_color_buffer_float: cbf, EXT_color_buffer_half_float: cbh };
    }
    const fsW = 'precision highp float; varying vec2 vUv; void main(){ gl_FragColor = vec4(3.0, 0.25, 1.5, 1.0); }';
    const pW = program(gl, S.VS1, fsW, ['p']);
    S.draw(pW, null, fb);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const fsR = 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vec2(0.5)) * vec4(0.25, 1.0, 0.5, 1.0); }';
    const pR = program(gl, S.VS1, fsR, ['p']);
    const got = S.draw(pR, (pr) => gl.uniform1i(gl.getUniformLocation(pr, 't'), 0));
    const exp = [191, 64, 191, 255];
    gl.deleteProgram(pW); gl.deleteProgram(pR); gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    return { status: close(got, exp, 3) ? 'ok' : 'fail', got, expect: exp, EXT_color_buffer_float: cbf, EXT_color_buffer_half_float: cbh };
  }

  // framebuffer completeness of float formats (WebGL2: texStorage2D; WebGL1: RGBA + HALF_FLOAT_OES / FLOAT)
  function testFloatTargets(ctx) {
    const gl = ctx.gl;
    const out = { EXT_color_buffer_float: false, EXT_color_buffer_half_float: false, formats: {} };
    if (ctx.v === 2) out.EXT_color_buffer_float = !!gl.getExtension('EXT_color_buffer_float');
    out.EXT_color_buffer_half_float = !!gl.getExtension('EXT_color_buffer_half_float');
    const fmts = [];
    if (ctx.v === 2) {
      fmts.push(['RGBA16F', gl.RGBA16F], ['RG16F', gl.RG16F], ['R16F', gl.R16F], ['R11F_G11F_B10F', gl.R11F_G11F_B10F], ['RGBA32F', gl.RGBA32F], ['RGBA8', gl.RGBA8]);
    } else {
      const h = gl.getExtension('OES_texture_half_float'), f = gl.getExtension('OES_texture_float');
      if (f) gl.getExtension('WEBGL_color_buffer_float'); // needed before RGBA/FLOAT can be a render target
      if (h) fmts.push(['RGBA/HALF_FLOAT_OES', null, h.HALF_FLOAT_OES]);
      if (f) fmts.push(['RGBA/FLOAT', null, gl.FLOAT]);
      fmts.push(['RGBA/UNSIGNED_BYTE', null, gl.UNSIGNED_BYTE]);
    }
    for (const [name, internal, type] of fmts) {
      try {
        while (gl.getError()) { /* clear */ }
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        if (ctx.v === 2) gl.texStorage2D(gl.TEXTURE_2D, 1, internal, 4, 4);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, type, null);
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        out.formats[name] = st === gl.FRAMEBUFFER_COMPLETE ? 'complete' : 'incomplete(0x' + st.toString(16) + ')';
        gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      } catch (e) { out.formats[name] = 'error: ' + e.message; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const half = out.formats.RGBA16F || out.formats['RGBA/HALF_FLOAT_OES'];
    out.status = half === 'complete' ? 'ok' : (out.EXT_color_buffer_float || out.EXT_color_buffer_half_float) ? 'fail' : 'unsupported';
    return out;
  }

  function limits(ctx) {
    const gl = ctx.gl, o = {};
    const names = ['MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_VARYING_VECTORS',
      'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_TEXTURE_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE',
      'MAX_RENDERBUFFER_SIZE'];
    if (ctx.v === 2) names.push('MAX_ARRAY_TEXTURE_LAYERS', 'MAX_SAMPLES', 'MAX_3D_TEXTURE_SIZE', 'MAX_DRAW_BUFFERS', 'MAX_COLOR_ATTACHMENTS',
      'MAX_VARYING_COMPONENTS', 'MAX_FRAGMENT_UNIFORM_BLOCKS', 'MAX_UNIFORM_BLOCK_SIZE');
    for (const n of names) { try { o[n] = gl[n] != null ? gl.getParameter(gl[n]) : null; } catch (e) { o[n] = null; } }
    if (ctx.v !== 2) { o.MAX_ARRAY_TEXTURE_LAYERS = null; o.MAX_SAMPLES = null; }
    try { const a = gl.getExtension('EXT_texture_filter_anisotropic'); o.MAX_TEXTURE_MAX_ANISOTROPY = a ? gl.getParameter(a.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null; } catch (e) { /* none */ }
    try { const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); o.ALIASED_POINT_SIZE_RANGE = r ? [r[0], r[1]] : null; } catch (e) { /* none */ }
    try { const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); o.fragmentHighpFloat = hp ? hp.precision : 0; } catch (e) { /* none */ }
    return o;
  }

  // ---------- worst-case programs ----------
  function header(v, stage, salt) {
    if (v === 2) {
      return ['#version 300 es', 'precision highp float;', 'precision highp int;', 'precision highp sampler2DArray;', 'precision highp sampler2DShadow;',
        '#define SALT ' + salt.toFixed(1),
        stage === 'v' ? '#define ATTR in\n#define VARY out\n#define TEX2DLOD(s, uv) textureLod(s, uv, 0.0)\n#define VID float(gl_VertexID)'
          : '#define VARY in\nout vec4 fragColor;\n#define FRAG fragColor',
        '#define TEX2D texture', '#define TEXCUBELOD(s, d, l) textureLod(s, d, l)', '#define ARR sampler2DArray',
        '#define TEXARR(s, uv, l) texture(s, vec3(uv, l))', '#define SHADOW_T sampler2DShadow',
        'float shadowTap(SHADOW_T s, vec3 c) { return texture(s, c); }'].join('\n') + '\n';
    }
    return [stage === 'f' ? 'precision highp float;' : '', '#define SALT ' + salt.toFixed(1),
      stage === 'v' ? '#define ATTR attribute\n#define VARY varying\n#define TEX2DLOD(s, uv) texture2DLod(s, uv, 0.0)\n#define VID aVid'
        : '#define VARY varying\n#define FRAG gl_FragColor',
      '#define TEX2D texture2D', '#define TEXCUBELOD(s, d, l) textureCube(s, d, l)', '#define ARR sampler2D',
      '#define TEXARR(s, uv, l) texture2D(s, (fract(uv) + vec2(mod(l, 4.0), floor(l / 4.0))) * 0.25)', '#define SHADOW_T sampler2D',
      stage === 'f' ? 'float unpackD(vec4 v) { return dot(v, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }\nfloat shadowTap(SHADOW_T s, vec3 c) { return step(c.z, unpackD(texture2D(s, c.xy))); }' : ''
    ].join('\n') + '\n';
  }

  // "uber facade": texture arrays (albedo / normal / ORM / interior rooms), interior-mapping raymarch, 3 cascades × 16-tap PCF,
  // GGX sun + hemisphere + env cube, 16 street lamps, wet (puddles + ripples), height fog with sun inscatter, ACES
  const FACADE_VS = [
    'ATTR vec3 position; ATTR vec3 normal; ATTR vec4 tangent; ATTR vec2 uv; ATTR vec4 aInfo;',
    'uniform mat4 uModel; uniform mat4 uView; uniform mat4 uProj;',
    'VARY vec3 vWp; VARY vec3 vN; VARY vec4 vT; VARY vec2 vUv; VARY vec4 vInfo; VARY float vViewZ;',
    'void main() {',
    '  vec4 wp = uModel * vec4(position, 1.0); vWp = wp.xyz;',
    '  vN = mat3(uModel) * normal; vT = vec4(mat3(uModel) * tangent.xyz, tangent.w); vUv = uv; vInfo = aInfo;',
    '  vec4 vp = uView * wp; vViewZ = -vp.z; gl_Position = uProj * vp + vec4(SALT * 1e-9);',
    '}'].join('\n');
  const FACADE_FS = [
    'uniform ARR uAlbedo; uniform ARR uNormal; uniform ARR uOrm; uniform ARR uRooms;',
    'uniform SHADOW_T uShadow; uniform samplerCube uEnv; uniform sampler2D uNoise; uniform sampler2D uLut;',
    'uniform mat4 uShadowMat[3]; uniform vec4 uCascade;',
    'uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGroundCol;',
    'uniform vec4 uFog; uniform vec3 uFogCol; uniform vec3 uInscatterCol;',
    'uniform vec4 uWet; uniform vec4 uWindow; uniform vec3 uCam; uniform float uTime; uniform float uExposure;',
    'uniform vec4 uLightPos[16]; uniform vec4 uLightCol[16]; uniform int uLightCount;',
    'VARY vec3 vWp; VARY vec3 vN; VARY vec4 vT; VARY vec2 vUv; VARY vec4 vInfo; VARY float vViewZ;',
    'const float PI = 3.14159265;',
    'float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'vec3 interior(vec3 wp, vec3 cam, vec3 n, out float win) {',
    '  vec3 t = abs(n.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0); vec3 b = vec3(0.0, 1.0, 0.0);',
    '  vec2 cell = vec2(dot(wp, t) / uWindow.x, (wp.y - 0.15) / uWindow.y);',
    '  vec2 f = fract(cell); vec2 id = floor(cell);',
    '  win = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.78);',
    '  vec3 rd = normalize(wp - cam);',
    '  vec3 d = vec3(dot(rd, t) / uWindow.x, rd.y / uWindow.y, -dot(rd, n) / uWindow.z);',
    '  vec3 p = vec3(f, 0.0);',
    '  vec3 tt = (step(vec3(0.0), d) - p) / d;',
    '  float tm = min(min(tt.x, tt.y), tt.z);',
    '  for (int k = 0; k < 3; k++) {',                     // furniture planes at depth 0.35 / 0.55 / 0.75 (opaque where the hash says)
    '    float z = 0.35 + 0.2 * float(k); float tk = z / max(d.z, 1e-4); vec3 hp = p + d * tk;',
    '    float occ = step(0.5, h21(id * (1.3 + float(k)) + floor(hp.xy * 3.0))) * step(hp.y, 0.45);',
    '    if (occ > 0.5 && tk < tm) tm = tk;',
    '  }',
    '  vec3 hp = p + d * tm; float z = clamp(hp.z, 0.0, 1.0);',
    '  vec2 ruv = (hp.xy - 0.5) / (1.0 + z * 3.0) + 0.5;',
    '  float r = h21(id + 0.37); float layer = floor(r * 8.0);',
    '  vec3 c = TEXARR(uRooms, clamp(ruv, 0.02, 0.98), layer).rgb;',
    '  float lit = step(1.0 - uWindow.w, h21(id * 1.71 + 3.1));',
    '  return c * mix(0.06, 1.3, lit) * (1.0 - 0.5 * z);',
    '}',
    'float shadowPCF(vec3 wp, float viewZ, vec3 n) {',
    '  int ci = viewZ < uCascade.x ? 0 : (viewZ < uCascade.y ? 1 : 2);',
    '  mat4 m = ci == 0 ? uShadowMat[0] : (ci == 1 ? uShadowMat[1] : uShadowMat[2]);',
    '  vec4 sc = m * vec4(wp + n * 0.05 * (1.0 + float(ci)), 1.0); sc.xyz /= sc.w;',
    '  sc.x = (sc.x + float(ci)) / 3.0;',
    '  if (sc.z > 1.0) return 1.0;',
    '  float rot = h21(gl_FragCoord.xy) * 6.2831; float s = 0.0;',
    '  for (int i = 0; i < 16; i++) {',
    '    float a = float(i) * 2.39996 + rot; float rr = sqrt((float(i) + 0.5) / 16.0) * uCascade.w;',
    '    s += shadowTap(uShadow, vec3(sc.xy + vec2(cos(a), sin(a)) * rr, sc.z - 0.0015));',
    '  }',
    '  return s / 16.0;',
    '}',
    'vec3 heightFog(vec3 col, vec3 wp, vec3 cam) {',
    '  vec3 rd = wp - cam; float dist = length(rd); rd /= max(dist, 1e-3);',
    '  float b = uFog.y; float k = abs(rd.y) > 1e-3 ? (1.0 - exp(-dist * rd.y * b)) / (rd.y * b) : dist;',
    '  float od = uFog.x * exp(-cam.y * b) * max(k - uFog.z, 0.0);',
    '  float tr = max(exp(-od), 1.0 - uFog.w);',
    '  float s = pow(max(dot(rd, uSunDir), 0.0), 6.0);',
    '  return col * tr + mix(uFogCol, uInscatterCol, s) * (1.0 - tr);',
    '}',
    'float D_GGX(float a, float nh) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }',
    'float V_SmithJ(float a, float nv, float nl) { float a2 = a * a; float gv = nl * sqrt(nv * nv * (1.0 - a2) + a2); float gl = nv * sqrt(nl * nl * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-4); }',
    'vec3 F_Schlick(vec3 f0, float vh) { return f0 + (1.0 - f0) * pow(1.0 - vh, 5.0); }',
    'vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',
    'vec3 lut(vec3 c) { float s = 32.0; float b = c.b * (s - 1.0); float b0 = floor(b); float b1 = min(b0 + 1.0, s - 1.0);',
    '  vec2 o = vec2((c.r * (s - 1.0) + 0.5) / (s * s), (c.g * (s - 1.0) + 0.5) / s);',
    '  return mix(TEX2D(uLut, o + vec2(b0 / s, 0.0)).rgb, TEX2D(uLut, o + vec2(b1 / s, 0.0)).rgb, b - b0); }',
    'void main() {',
    '  float layer = vInfo.x; vec2 uv = vUv; vec3 V = normalize(uCam - vWp);',
    '  vec4 alb = TEXARR(uAlbedo, uv, layer); vec3 orm = TEXARR(uOrm, uv, layer).rgb;',
    '  vec3 nt = TEXARR(uNormal, uv, layer).xyz * 2.0 - 1.0;',
    '  vec3 N0 = normalize(vN); vec3 T = normalize(vT.xyz - N0 * dot(vT.xyz, N0)); vec3 B = cross(N0, T) * vT.w;',
    '  vec3 N = normalize(T * nt.x + B * nt.y + N0 * nt.z);',
    '  vec3 albedo = alb.rgb * (0.9 + 0.2 * vInfo.w); float rough = orm.g; float metal = orm.b; float ao = orm.r;',
    // wet: puddles on up-facing surfaces, streaks on walls, two scrolling ripple samples
    '  float puddle = smoothstep(0.45, 0.6, TEX2D(uNoise, vWp.xz * 0.05).r) * step(0.7, N0.y) * uWet.y;',
    '  float streak = (1.0 - step(0.7, N0.y)) * smoothstep(0.3, 0.9, TEX2D(uNoise, vec2(vWp.x * 0.3, vWp.y * 0.02 + uTime * 0.01)).g);',
    '  float wet = clamp(uWet.x * (0.6 + 0.4 * streak) + puddle, 0.0, 1.0);',
    '  vec2 rp = vWp.xz * 0.8; vec3 r1 = TEX2D(uNoise, rp + vec2(uTime * 0.05, 0.0)).xyz * 2.0 - 1.0; vec3 r2 = TEX2D(uNoise, rp * 1.7 - vec2(0.0, uTime * 0.07)).xyz * 2.0 - 1.0;',
    '  N = normalize(mix(N, normalize(N0 + vec3(r1.x + r2.x, 0.0, r1.y + r2.y) * 0.08 * uWet.w), puddle));',
    '  albedo *= mix(1.0, 0.55, wet * (1.0 - metal)); rough = mix(rough, 0.05, wet);',
    '  float win; vec3 inter = interior(vWp, uCam, N0, win);',
    '  albedo = mix(albedo, albedo * 0.15, win); rough = mix(rough, 0.04, win); metal = mix(metal, 0.0, win);',
    '  float sh = shadowPCF(vWp, vViewZ, N0);',
    '  float a = max(rough * rough, 0.002); vec3 f0 = mix(vec3(0.04), albedo, metal); vec3 diff = albedo * (1.0 - metal) / PI;',
    '  vec3 L = normalize(uSunDir); vec3 H = normalize(L + V);',
    '  float nl = max(dot(N, L), 0.0), nv = max(dot(N, V), 1e-3), nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.0);',
    '  vec3 F = F_Schlick(f0, vh);',
    '  vec3 col = (diff * (1.0 - F) + F * D_GGX(a, nh) * V_SmithJ(a, nv, nl)) * uSunCol * nl * sh;',
    '  vec3 R = reflect(-V, N); vec3 env = TEXCUBELOD(uEnv, R, rough * 6.0).rgb;',
    '  vec3 Fa = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);',
    '  col += diff * PI * mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5) * ao + env * Fa * ao;',
    '  for (int i = 0; i < 16; i++) {',
    '    if (i >= uLightCount) break;',
    '    vec3 d = uLightPos[i].xyz - vWp; float d2 = dot(d, d); vec3 l = d * inversesqrt(d2);',
    '    float r = uLightPos[i].w; float att = pow(clamp(1.0 - d2 / (r * r), 0.0, 1.0), 2.0) / max(d2, 0.01);',
    '    vec3 h = normalize(l + V); float nl2 = max(dot(N, l), 0.0);',
    '    col += (diff + F_Schlick(f0, max(dot(V, h), 0.0)) * D_GGX(a, max(dot(N, h), 0.0)) * 0.25) * uLightCol[i].rgb * nl2 * att;',
    '  }',
    '  col += inter * win;',
    '  col = heightFog(col, vWp, uCam);',
    '  col = aces(col * uExposure); col = pow(col, vec3(1.0 / 2.2)); col = lut(col);',
    '  FRAG = vec4(col, alb.a) + vec4(SALT * 1e-9);',
    '}'].join('\n');

  // VAT (vertex animation texture) + instancing: instance matrix (4 attributes), instanceColor, per-instance clip / phase / speed
  const VAT_VS = [
    'ATTR vec3 position; ATTR vec3 normal; ATTR vec2 uv; ATTR float aVid;',
    'ATTR vec4 iM0; ATTR vec4 iM1; ATTR vec4 iM2; ATTR vec4 iM3; ATTR vec3 instanceColor; ATTR vec4 aAnim;',
    'uniform sampler2D uVatPos; uniform sampler2D uVatNrm; uniform vec4 uVatInfo; uniform vec4 uVatMin; uniform vec4 uVatMax;',
    'uniform float uTime; uniform mat4 uView; uniform mat4 uProj; uniform vec3 uCam; uniform vec4 uFog; uniform vec4 uWind;',
    'VARY vec3 vN; VARY vec2 vUv; VARY vec3 vColor; VARY float vFog; VARY vec3 vWp;',
    'vec2 vatUv(float frame, float vid) { float idx = frame * uVatInfo.y + vid; float x = mod(idx, uVatInfo.z); float y = floor(idx / uVatInfo.z); return (vec2(x, y) + 0.5) / uVatInfo.zw; }',
    'void main() {',
    '  float clipLen = max(aAnim.y, 1.0); float t = uTime * aAnim.z + aAnim.w; float f = mod(t, clipLen);',
    '  float f0 = floor(f); float f1 = mod(f0 + 1.0, clipLen); float fa = f - f0; float vid = VID;',
    '  vec3 p0 = TEX2DLOD(uVatPos, vatUv(aAnim.x + f0, vid)).xyz; vec3 p1 = TEX2DLOD(uVatPos, vatUv(aAnim.x + f1, vid)).xyz;',
    '  vec3 n0 = TEX2DLOD(uVatNrm, vatUv(aAnim.x + f0, vid)).xyz; vec3 n1 = TEX2DLOD(uVatNrm, vatUv(aAnim.x + f1, vid)).xyz;',
    '  vec3 p = mix(uVatMin.xyz, uVatMax.xyz, mix(p0, p1, fa)) + position * 1e-4;',
    '  vec3 n = normalize(mix(n0, n1, fa) * 2.0 - 1.0 + normal * 1e-4);',
    '  mat4 im = mat4(iM0, iM1, iM2, iM3);',
    '  vec4 wp = im * vec4(p, 1.0);',
    '  wp.xz += uWind.xy * sin(uTime * uWind.z + wp.x * 0.1 + wp.z * 0.13) * max(p.y, 0.0) * uWind.w;',
    '  vWp = wp.xyz; vN = normalize(mat3(im) * n); vUv = uv; vColor = instanceColor;',
    '  float dist = length(wp.xyz - uCam); vFog = 1.0 - exp(-uFog.x * dist * exp(-wp.y * uFog.y));',
    '  gl_Position = uProj * uView * wp + vec4(SALT * 1e-9);',
    '}'].join('\n');
  const VAT_FS = [
    'uniform sampler2D uMap; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uFogCol;',
    'VARY vec3 vN; VARY vec2 vUv; VARY vec3 vColor; VARY float vFog; VARY vec3 vWp;',
    'void main() {',
    '  vec4 c = TEX2D(uMap, vUv); c.rgb *= vColor;',
    '  vec3 n = normalize(vN); float nl = max(dot(n, normalize(uSunDir)), 0.0);',
    '  vec3 col = c.rgb * (uSunCol * nl + uSkyCol * (0.5 + 0.5 * n.y));',
    '  col = mix(col, uFogCol, clamp(vFog, 0.0, 1.0));',
    '  FRAG = vec4(pow(col, vec3(1.0 / 2.2)), c.a) + vec4(SALT * 1e-9);',
    '}'].join('\n');

  const ATTRS = {
    facade: ['position', 'normal', 'tangent', 'uv', 'aInfo'],
    vat: ['position', 'normal', 'uv', 'aVid', 'iM0', 'iM1', 'iM2', 'iM3', 'instanceColor', 'aAnim']
  };

  let saltN = 1 + Math.floor(Math.random() * 1e5);
  function sources(ctx, which) {
    const s = saltN++;
    const vs = which === 'facade' ? FACADE_VS : VAT_VS, fs = which === 'facade' ? FACADE_FS : VAT_FS;
    return { vs: header(ctx.v, 'v', s) + vs, fs: header(ctx.v, 'f', s) + fs };
  }
  // bind every sampler to its own unit (WebGL2 refuses to draw with two sampler types on one unit)
  function bindSamplers(gl, p) {
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); let unit = 0;
    for (let i = 0; i < n; i++) {
      const u = gl.getActiveUniform(p, i);
      const t = u.type;
      const isSampler = t === gl.SAMPLER_2D || t === gl.SAMPLER_CUBE || (gl.SAMPLER_2D_ARRAY && t === gl.SAMPLER_2D_ARRAY) ||
        (gl.SAMPLER_2D_SHADOW && t === gl.SAMPLER_2D_SHADOW) || (gl.SAMPLER_3D && t === gl.SAMPLER_3D);
      if (isSampler) gl.uniform1i(gl.getUniformLocation(p, u.name), unit++);
    }
    return { samplers: unit, uniforms: n };
  }
  function firstDraw(ctx, S, p) {
    const gl = ctx.gl;
    const t0 = now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo); gl.viewport(0, 0, 4, 4);
    gl.useProgram(p);
    const info = bindSamplers(gl, p);
    const maxAttr = Math.min(16, gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 8);
    for (let i = 0; i < maxAttr; i++) gl.disableVertexAttribArray(i);
    while (gl.getError()) { /* clear stale errors (compile / upload) so drawError is this draw's */ }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const err = gl.getError();
    return { ms: now() - t0, glError: err ? '0x' + err.toString(16) : 0, samplers: info.samplers, uniforms: info.uniforms };
  }
  function linkInfo(gl, p, v, f) {
    return ((gl.getShaderInfoLog(v) || '') + (gl.getShaderInfoLog(f) || '') + (gl.getProgramInfoLog(p) || '')).slice(0, 800);
  }
  // synchronous: compile + link + LINK_STATUS (blocks until done), then the first draw (some drivers finish compiling there)
  function compileSync(ctx, S, which) {
    const gl = ctx.gl; const src = sources(ctx, which);
    const t0 = now();
    const v = compile(gl, gl.VERTEX_SHADER, src.vs), f = compile(gl, gl.FRAGMENT_SHADER, src.fs);
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f);
    ATTRS[which].forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    const linkMs = now() - t0;
    if (!ok) { const log = linkInfo(gl, p, v, f); gl.deleteProgram(p); return { ok: false, linkMs, log }; }
    const d = firstDraw(ctx, S, p);
    gl.deleteProgram(p); gl.deleteShader(v); gl.deleteShader(f);
    return { ok: true, linkMs, firstDrawMs: d.ms, totalMs: linkMs + d.ms, drawError: d.glError, samplers: d.samplers, uniforms: d.uniforms };
  }
  // KHR_parallel_shader_compile: the calls return at once; poll COMPLETION_STATUS_KHR (setTimeout loop) until it is done
  async function compileParallel(ctx, S, which, ext) {
    const gl = ctx.gl; const src = sources(ctx, which);
    const t0 = now();
    const v = compile(gl, gl.VERTEX_SHADER, src.vs), f = compile(gl, gl.FRAGMENT_SHADER, src.fs);
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f);
    ATTRS[which].forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    let blockingMs = now() - t0, polls = 0;
    while (true) {
      const q0 = now();
      const done = gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR);
      blockingMs += now() - q0; polls++;
      if (done) break;
      if (now() - t0 > 60000) break;
      await sleep(1);
    }
    const completeMs = now() - t0;
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    if (!ok) { const log = linkInfo(gl, p, v, f); gl.deleteProgram(p); return { ok: false, completeMs, log }; }
    const d = firstDraw(ctx, S, p);
    gl.deleteProgram(p); gl.deleteShader(v); gl.deleteShader(f);
    return { ok: true, blockingMs, completeMs, polls, firstDrawMs: d.ms, drawError: d.glError };
  }

  async function compileTests(ctx, S, reps) {
    const out = { reps };
    const ext = ctx.gl.getExtension('KHR_parallel_shader_compile');
    out.parallelExt = !!ext;
    for (const which of ['facade', 'vat']) {
      const r = { sync: [], parallel: [] };
      for (let i = 0; i < reps; i++) {
        try { r.sync.push(compileSync(ctx, S, which)); } catch (e) { r.sync.push({ ok: false, error: String(e && e.message || e) }); }
        await sleep(0);
      }
      if (ext) {
        for (let i = 0; i < reps; i++) {
          try { r.parallel.push(await compileParallel(ctx, S, which, ext)); } catch (e) { r.parallel.push({ ok: false, error: String(e && e.message || e) }); }
        }
      }
      const okS = r.sync.filter((x) => x.ok);
      r.status = okS.length === reps ? 'ok' : 'fail';
      r.firstTotalMs = okS.length ? +okS[0].totalMs.toFixed(1) : null;
      r.medianLinkMs = okS.length ? +median(okS.map((x) => x.linkMs)).toFixed(1) : null;
      r.medianTotalMs = okS.length ? +median(okS.map((x) => x.totalMs)).toFixed(1) : null;
      const okP = r.parallel.filter((x) => x.ok);
      if (okP.length) {
        r.parallelMedianBlockingMs = +median(okP.map((x) => x.blockingMs)).toFixed(2);
        r.parallelMedianCompleteMs = +median(okP.map((x) => x.completeMs)).toFixed(1);
      }
      if (!okS.length) r.log = r.sync[0] && (r.sync[0].log || r.sync[0].error);
      r.sync = r.sync.map(round); r.parallel = r.parallel.map(round);
      out[which] = r;
    }
    return out;
  }
  function round(o) { const c = {}; for (const k in o) c[k] = typeof o[k] === 'number' ? +o[k].toFixed(2) : o[k]; return c; }

  function info(ctx) {
    const o = {
      ua: navigator.userAgent, platform: navigator.platform || null, dpr: window.devicePixelRatio,
      screen: screen.width + 'x' + screen.height, viewport: innerWidth + 'x' + innerHeight,
      hardwareConcurrency: navigator.hardwareConcurrency || null, deviceMemory: navigator.deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0, webgl: ctx.v
    };
    const gl = ctx.gl;
    if (gl) {
      try { o.version = gl.getParameter(gl.VERSION); o.glsl = gl.getParameter(gl.SHADING_LANGUAGE_VERSION); o.vendor = gl.getParameter(gl.VENDOR); o.renderer = gl.getParameter(gl.RENDERER); } catch (e) { /* none */ }
      try { const d = gl.getExtension('WEBGL_debug_renderer_info'); if (d) { o.unmaskedVendor = gl.getParameter(d.UNMASKED_VENDOR_WEBGL); o.unmaskedRenderer = gl.getParameter(d.UNMASKED_RENDERER_WEBGL); } } catch (e) { /* none */ }
      try { o.extensions = gl.getSupportedExtensions(); } catch (e) { o.extensions = null; }
    }
    return o;
  }

  async function run(opts) {
    opts = opts || {};
    const res = { errors: [] };
    const ctx = makeCtx(!!opts.gl1);
    res.info = info(ctx);
    if (!ctx.gl) { res.errors.push('no WebGL'); res.status = 'no-webgl'; return res; }
    const gl = ctx.gl;
    let S;
    try { S = Sampler(ctx); } catch (e) { res.errors.push('sampler: ' + e.message); return res; }
    const T = (key, fn) => { try { res[key] = fn(); } catch (e) { res[key] = { status: 'error', error: String(e && e.message || e) }; res.errors.push(key + ': ' + (e && e.message || e)); } };
    T('limits', () => limits(ctx));
    T('ext', () => ({
      KHR_parallel_shader_compile: !!gl.getExtension('KHR_parallel_shader_compile'),
      EXT_disjoint_timer_query: !!gl.getExtension('EXT_disjoint_timer_query'),
      EXT_disjoint_timer_query_webgl2: ctx.v === 2 ? !!gl.getExtension('EXT_disjoint_timer_query_webgl2') : false,
      WEBGL_compressed_texture_astc: !!gl.getExtension('WEBGL_compressed_texture_astc'),
      WEBGL_compressed_texture_etc: !!gl.getExtension('WEBGL_compressed_texture_etc'),
      WEBGL_compressed_texture_s3tc: !!gl.getExtension('WEBGL_compressed_texture_s3tc'),
      WEBGL_compressed_texture_pvrtc: !!(gl.getExtension('WEBGL_compressed_texture_pvrtc') || gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc')),
      OES_texture_half_float_linear: !!gl.getExtension('OES_texture_half_float_linear'),
      OES_texture_float_linear: !!gl.getExtension('OES_texture_float_linear'),
      EXT_color_buffer_float: ctx.v === 2 ? !!gl.getExtension('EXT_color_buffer_float') : false,
      EXT_color_buffer_half_float: !!gl.getExtension('EXT_color_buffer_half_float'),
      EXT_texture_filter_anisotropic: !!gl.getExtension('EXT_texture_filter_anisotropic'),
      OES_standard_derivatives: ctx.v === 2 ? true : !!gl.getExtension('OES_standard_derivatives'),
      EXT_shader_texture_lod: ctx.v === 2 ? true : !!gl.getExtension('EXT_shader_texture_lod')
    }));
    res.timerQuery = { status: (res.ext.EXT_disjoint_timer_query || res.ext.EXT_disjoint_timer_query_webgl2) ? 'ok' : 'unsupported',
      EXT_disjoint_timer_query: res.ext.EXT_disjoint_timer_query, EXT_disjoint_timer_query_webgl2: res.ext.EXT_disjoint_timer_query_webgl2 };
    res.parallelCompile = { status: res.ext.KHR_parallel_shader_compile ? 'ok' : 'unsupported' };

    // ?noastc=1 (opts.noAstc): pretend ASTC is missing (checks the 'unsupported' path on a device that has it)
    const astc = opts.noAstc ? null : gl.getExtension('WEBGL_compressed_texture_astc');
    const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
    const ident = (c) => c.slice();
    if (astc) {
      try { res.astcProfiles = astc.getSupportedProfiles ? astc.getSupportedProfiles() : null; } catch (e) { /* none */ }
      T('astc4x4', () => testCompressed2D(ctx, S, astc.COMPRESSED_RGBA_ASTC_4x4_KHR, 4, 4, astcBlock, ident));
      T('astc6x6', () => testCompressed2D(ctx, S, astc.COMPRESSED_RGBA_ASTC_6x6_KHR, 6, 6, astcBlock, ident));
      // negative control: an all-zero block is a reserved block mode → the decoder returns the error colour, not the test colour
      T('astcNegative', () => {
        const r = testCompressed2D(ctx, S, astc.COMPRESSED_RGBA_ASTC_4x4_KHR, 4, 4, () => new Uint8Array(16), () => COLORS[0]);
        return { status: r.status === 'fail' && !r.glError ? 'ok' : r.glError ? 'ok' : 'fail', got: r.got, glError: r.glError || 0, note: 'expects NOT the test colour (error colour, usually magenta)' };
      });
      T('astc4x4srgb', () => {
        const r = testCompressed2D(ctx, S, astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR, 4, 4, astcBlock, (c) => [Math.round(srgbToLin(c[0])), Math.round(srgbToLin(c[1])), Math.round(srgbToLin(c[2])), c[3]]);
        r.note = 'sRGB decode in the sampler'; return r;
      });
    } else {
      res.astc4x4 = { status: 'unsupported' }; res.astcNegative = { status: 'unsupported' }; res.astc6x6 = { status: 'unsupported' }; res.astc4x4srgb = { status: 'unsupported' };
    }
    if (ctx.v === 2) {
      T('rgba8Array', () => testArray(ctx, S, 'rgba8', 4, 4, null, null));
      if (astc) {
        T('astcArray', () => testArray(ctx, S, astc.COMPRESSED_RGBA_ASTC_4x4_KHR, 4, 4, astcBlock, ident, 'image3d'));
        T('astcArray6x6Storage', () => testArray(ctx, S, astc.COMPRESSED_RGBA_ASTC_6x6_KHR, 6, 6, astcBlock, ident, 'storage'));
      } else { res.astcArray = { status: 'unsupported' }; res.astcArray6x6Storage = { status: 'unsupported' }; }
      // the same array code with S3TC DXT1 (desktop; a second path check next to ASTC)
      if (s3tc) T('s3tcArray', () => testArray(ctx, S, s3tc.COMPRESSED_RGB_S3TC_DXT1_EXT, 4, 4, dxt1Block, dxt1Expect, 'image3d'));
      else res.s3tcArray = { status: 'unsupported' };
    } else {
      res.rgba8Array = { status: 'unsupported', why: 'WebGL1' }; res.astcArray = { status: 'unsupported', why: 'WebGL1' };
      res.astcArray6x6Storage = { status: 'unsupported', why: 'WebGL1' }; res.s3tcArray = { status: 'unsupported', why: 'WebGL1' };
    }
    T('halfLinear', () => testHalfLinear(ctx, S));
    T('halfRender', () => testHalfRender(ctx, S));
    T('floatTargets', () => testFloatTargets(ctx));
    try { res.compile = await compileTests(ctx, S, opts.compileReps || 3); } catch (e) { res.compile = { status: 'error', error: String(e) }; res.errors.push('compile: ' + e); }
    try { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) { /* none */ }
    return res;
  }
  function srgbToLin(c) { const x = c / 255; return 255 * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); }

  window.BenchCaps = { run, astcBlock, dxt1Block, toHalf };
})();
