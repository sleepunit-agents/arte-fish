/**
 * Cross face canvas for arte.fish — presence's Gray-Scott field driven by Art's live /state.
 *
 * Self-contained embed: all shader and effect code inlined from sleepunit-agents/presence
 * (src/faces/cross/, src/ambient/).  Only /state is a runtime dependency — the canvas
 * degrades to idle Gray-Scott if /state is unreachable or presence is down.
 *
 * Signal mapping:
 *   voice "listening" → leftward advection + cool blue overlay
 *   voice "speaking"  → rightward advection + warm amber glow; intensity rides voiceLevel
 *   voice "thinking"  → fast drift + feed surge + whole-field cool bloom
 *   idle / offline    → unmodified Gray-Scott substrate (same as today's canvas)
 *
 * AGPL-3.0-only · jbarket/arte-fish
 * Sources: sleepunit-agents/presence (AGPL-3.0-only)
 */

// ── Types (presence/src/shared/state.ts) ─────────────────────────────────────

interface ArtState {
  activity: number;
  mood: 'idle' | 'conversation' | 'task' | 'free-time' | 'error';
  voice?: 'idle' | 'listening' | 'thinking' | 'speaking' | null;
  voiceLevel?: number | null;
}

function idleState(): ArtState {
  return { activity: 0, mood: 'idle', voice: 'idle', voiceLevel: null };
}

interface SimParams {
  feed: number;
  kill: number;
  Du: number;
  Dv: number;
  stepsPerFrame: number;
  mood: number;
}

function stateToParams(state: ArtState): SimParams {
  switch (state.mood) {
    case 'conversation': return { feed: 0.0545, kill: 0.0615, Du: 0.2097, Dv: 0.105, stepsPerFrame: 16, mood: 0.7  };
    case 'task':         return { feed: 0.0367, kill: 0.0610, Du: 0.2097, Dv: 0.105, stepsPerFrame: 20, mood: 0.4  };
    case 'free-time':    return { feed: 0.0300, kill: 0.0555, Du: 0.2097, Dv: 0.105, stepsPerFrame: 8,  mood: 0.15 };
    case 'error':        return { feed: 0.0780, kill: 0.0610, Du: 0.2097, Dv: 0.105, stepsPerFrame: 32, mood: 0.95 };
    default:             return { feed: 0.0140, kill: 0.0450, Du: 0.2097, Dv: 0.105, stepsPerFrame: 8,  mood: 0.0  };
  }
}

const MOOD_PARAMS: { bValue: number; feed: number; kill: number }[] = [
  { bValue: 0.00, feed: 0.0140, kill: 0.0450 },
  { bValue: 0.15, feed: 0.0300, kill: 0.0555 },
  { bValue: 0.40, feed: 0.0367, kill: 0.0610 },
  { bValue: 0.70, feed: 0.0545, kill: 0.0615 },
  { bValue: 0.95, feed: 0.0780, kill: 0.0610 },
];

const IDLE_PRESETS: { feed: number; kill: number }[] = [
  { feed: 0.0140, kill: 0.0450 },
  { feed: 0.0250, kill: 0.0600 },
  { feed: 0.0300, kill: 0.0557 },
];

// ── Effect seam (presence/src/faces/cross/effect.ts) ─────────────────────────

interface EffectState {
  voice: 'idle' | 'listening' | 'thinking' | 'speaking';
  activity: number;
  voiceLevel: number | null;
}

interface EffectDelta {
  advX: number;
  advY: number;
  feedBoost: number;
  killBoost: number;
  gravityBoost: number;
  stepsBoost: number;
}

const ZERO_DELTA: EffectDelta = {
  advX: 0, advY: 0, feedBoost: 0, killBoost: 0, gravityBoost: 0, stepsBoost: 0,
};

interface SimEffect {
  tick(state: EffectState, time: number, dt: number): EffectDelta;
  draw?(ctx: CanvasRenderingContext2D, w: number, h: number, state: EffectState, time: number): void;
}

function combineDeltas(deltas: EffectDelta[]): EffectDelta {
  const out = { ...ZERO_DELTA };
  for (const d of deltas) {
    out.advX         += d.advX;
    out.advY         += d.advY;
    out.feedBoost    += d.feedBoost;
    out.killBoost    += d.killBoost;
    out.gravityBoost += d.gravityBoost;
    out.stepsBoost   += d.stepsBoost;
  }
  return out;
}

// ── NeuralSplitEffect (presence/src/faces/cross/neural.ts) ───────────────────

class NeuralSplitEffect implements SimEffect {
  private listenS = 0;
  private speakS  = 0;
  private thinkS  = 0;
  private envS    = 0;
  private levelS  = 0;

  tick(state: EffectState, _time: number, dt: number): EffectDelta {
    const ease = (cur: number, target: number, rate: number): number =>
      cur + (target - cur) * (1 - Math.exp(-rate * dt / 16));

    const isListening = state.voice === 'listening';
    const isSpeaking  = state.voice === 'speaking';
    const isThinking  = state.voice === 'thinking';

    this.listenS = ease(this.listenS, isListening ? 1 : 0, 0.025);
    this.speakS  = ease(this.speakS,  isSpeaking  ? 1 : 0, 0.040);
    this.thinkS  = ease(this.thinkS,  isThinking  ? 1 : 0, 0.025);
    this.envS    = ease(this.envS,    state.activity,       0.040);
    const levelTarget = state.voiceLevel !== null ? state.voiceLevel : this.envS;
    this.levelS  = ease(this.levelS,  levelTarget,          0.150);

    return {
      advX:         -this.listenS * 0.35 + this.speakS * 0.50 * this.levelS,
      advY:          this.thinkS * 0.18,
      feedBoost:     this.speakS * 0.006 * this.levelS + this.thinkS * 0.015,
      killBoost:     this.listenS * 0.003,
      gravityBoost:  this.thinkS * 0.015,
      stepsBoost:    Math.round(this.thinkS * 10 + this.speakS * 4 * this.levelS),
    };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, _state: EffectState, _time: number): void {
    ctx.clearRect(0, 0, w, h);

    if (this.listenS > 0.005) {
      const blueGrad = ctx.createLinearGradient(0, 0, w * 0.65, 0);
      blueGrad.addColorStop(0, `rgba(70, 140, 255, ${(0.20 * this.listenS).toFixed(3)})`);
      blueGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = blueGrad;
      ctx.fillRect(0, 0, w, h);

      const dimRight = ctx.createLinearGradient(w * 0.35, 0, w, 0);
      dimRight.addColorStop(0, 'rgba(0,0,0,0)');
      dimRight.addColorStop(1, `rgba(0,0,0,${(0.38 * this.listenS).toFixed(3)})`);
      ctx.fillStyle = dimRight;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.speakS > 0.005) {
      const intensity = this.speakS * this.levelS;
      const warmGrad = ctx.createLinearGradient(w * 0.35, 0, w, 0);
      warmGrad.addColorStop(0,   'rgba(0,0,0,0)');
      warmGrad.addColorStop(0.7, `rgba(255, 180, 60, ${(0.16 * intensity).toFixed(3)})`);
      warmGrad.addColorStop(1,   `rgba(255, 220, 120, ${(0.26 * intensity).toFixed(3)})`);
      ctx.fillStyle = warmGrad;
      ctx.fillRect(0, 0, w, h);

      const dimLeft = ctx.createLinearGradient(0, 0, w * 0.65, 0);
      dimLeft.addColorStop(0, `rgba(0,0,0,${(0.36 * this.speakS).toFixed(3)})`);
      dimLeft.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dimLeft;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.thinkS > 0.005) {
      ctx.fillStyle = `rgba(180, 210, 255, ${(0.07 * this.thinkS).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

// ── Shaders (presence/src/ambient/shaders.ts) ─────────────────────────────────

const vertexShader = /* glsl */ `#version 300 es
  layout(location = 0) in vec2 a_position;
  out vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const simulationShader = /* glsl */ `#version 300 es
  precision highp float;

  uniform sampler2D u_state;
  uniform vec2 u_resolution;
  uniform float u_Du;
  uniform float u_Dv;
  uniform float u_feed;
  uniform float u_kill;
  uniform float u_dt;
  uniform float u_time;
  uniform vec2 u_advection;
  uniform float u_ageRate;
  uniform float u_gravity;

  uniform float u_moodFeeds[5];
  uniform float u_moodKills[5];
  const float moodB[5] = float[5](0.0, 0.15, 0.40, 0.70, 0.95);

  in vec2 v_uv;
  out vec4 fragColor;

  vec2 tap(vec2 base, vec2 offset) {
    return texture(u_state, base + offset / u_resolution).rg;
  }

  void main() {
    vec2 eddy = vec2(
      sin(v_uv.y * 6.28 + u_time * 0.08) + 0.5 * sin(v_uv.y * 12.56 + u_time * 0.13),
      cos(v_uv.x * 6.28 + u_time * 0.06) + 0.5 * cos(v_uv.x * 12.56 + u_time * 0.11)
    ) * 0.08;
    vec2 toCenter = (vec2(0.5) - v_uv) * u_resolution;
    float dist = length(toCenter);
    vec2 gravity = toCenter / (dist + 0.001) * u_gravity;
    vec2 vel = u_advection + eddy + gravity;
    vec2 advUV = v_uv - vel / u_resolution;

    vec4 c4 = texture(u_state, advUV);
    float U = c4.r;
    float V = c4.g;
    float B = c4.b;
    float A = c4.a;

    vec2 lap = -vec2(U, V);
    lap += 0.20 * tap(advUV, vec2(-1.0, 0.0));
    lap += 0.20 * tap(advUV, vec2( 1.0, 0.0));
    lap += 0.20 * tap(advUV, vec2( 0.0,-1.0));
    lap += 0.20 * tap(advUV, vec2( 0.0, 1.0));
    lap += 0.05 * tap(advUV, vec2(-1.0,-1.0));
    lap += 0.05 * tap(advUV, vec2( 1.0,-1.0));
    lap += 0.05 * tap(advUV, vec2(-1.0, 1.0));
    lap += 0.05 * tap(advUV, vec2( 1.0, 1.0));

    float pixelF = u_moodFeeds[0];
    float pixelK = u_moodKills[0];
    for (int i = 0; i < 4; i++) {
      if (B >= moodB[i] && B <= moodB[i + 1]) {
        float t = (B - moodB[i]) / (moodB[i + 1] - moodB[i] + 0.001);
        pixelF = mix(u_moodFeeds[i], u_moodFeeds[i + 1], t);
        pixelK = mix(u_moodKills[i], u_moodKills[i + 1], t);
        break;
      }
    }
    if (B > moodB[4]) { pixelF = u_moodFeeds[4]; pixelK = u_moodKills[4]; }
    float f = pixelF;
    float k = pixelK;

    float ageBoost = smoothstep(0.6, 1.0, A) * 0.01;
    float effectiveKill = k + ageBoost;

    float UVV = U * V * V;
    float dU = u_Du * lap.r - UVV + f * (1.0 - U);
    float dV = u_Dv * lap.g + UVV - (f + effectiveKill) * V;

    float newU = clamp(U + dU * u_dt, 0.0, 1.0);
    float newV = clamp(V + dV * u_dt, 0.0, 1.0);

    float ageRate = u_ageRate;
    float newA = A + ageRate * smoothstep(0.01, 0.05, V);
    newA = clamp(newA, 0.0, 1.0);

    float sumBV = B * V;
    float sumV  = V + 0.001;
    vec2 offs[8] = vec2[8](
      vec2(-1,0), vec2(1,0), vec2(0,-1), vec2(0,1),
      vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1)
    );
    float wt[8] = float[8](0.20, 0.20, 0.20, 0.20, 0.05, 0.05, 0.05, 0.05);
    for (int i = 0; i < 8; i++) {
      vec4 n = texture(u_state, v_uv + offs[i] / u_resolution);
      sumBV += wt[i] * n.b * n.g;
      sumV  += wt[i] * n.g;
    }
    float neighborB = clamp(sumBV / sumV, 0.0, 1.0);
    float stick = mix(smoothstep(0.003, 0.01, V), 1.0, step(0.05, B));
    float newB = mix(neighborB, B, stick);
    newB *= smoothstep(0.0, 0.005, newV);

    float vDecay = smoothstep(0.8, 1.0, A) * 0.003;
    newV *= (1.0 - vDecay);
    newA *= smoothstep(0.0, 0.01, newV);

    fragColor = vec4(newU, newV, newB, newA);
  }
`;

const renderShader = /* glsl */ `#version 300 es
  precision highp float;

  uniform sampler2D u_state;
  uniform float u_time;
  uniform float u_activity;
  uniform vec2 u_resolution;
  uniform vec2 u_screenResolution;

  in vec2 v_uv;
  out vec4 fragColor;

  vec3 moodHue(float mood) {
    vec3 c0 = vec3(0.05, 0.35, 1.00);
    vec3 c1 = vec3(0.00, 0.95, 0.55);
    vec3 c2 = vec3(1.00, 0.70, 0.00);
    vec3 c3 = vec3(1.00, 0.08, 0.58);
    vec3 c4 = vec3(1.00, 0.05, 0.10);
    if (mood < 0.15) return mix(c0, c1, mood / 0.15);
    if (mood < 0.40) return mix(c1, c2, (mood - 0.15) / 0.25);
    if (mood < 0.70) return mix(c2, c3, (mood - 0.40) / 0.30);
    return mix(c3, c4, clamp((mood - 0.70) / 0.25, 0.0, 1.0));
  }

  vec3 palette(float v, float mood) {
    vec3 hue  = moodHue(mood);
    vec3 bg   = hue * 0.02;
    vec3 low  = hue * 0.10;
    vec3 mid  = hue * 0.35;
    vec3 high = hue * 0.75;
    vec3 peak = hue * 0.65 + vec3(0.35);
    if (v < 0.05) return mix(bg,  low,  v / 0.05);
    if (v < 0.15) return mix(low, mid,  (v - 0.05) / 0.10);
    if (v < 0.35) return mix(mid, high, (v - 0.15) / 0.20);
    return mix(high, peak, clamp((v - 0.35) / 0.30, 0.0, 1.0));
  }

  void main() {
    vec4 state    = texture(u_state, v_uv);
    float v       = state.g;
    float moodTag = state.b;
    float age     = state.a;
    vec2 texel    = 1.0 / u_resolution;

    float glowV = 0.0, glowBV = 0.0, glowW = 0.0;
    for (int ring = 1; ring <= 4; ring++) {
      float r = float(ring) * 2.5;
      float w = 1.0 / (float(ring) * float(ring));
      for (int j = 0; j < 8; j++) {
        float a = float(j) * 0.7854;
        vec2 off = vec2(cos(a), sin(a)) * r * texel;
        vec4 s = texture(u_state, v_uv + off);
        glowV  += s.g * w;
        glowBV += s.b * s.g * w;
        glowW  += w;
      }
    }
    glowV /= glowW;
    float glowMood  = glowBV / (glowV * glowW + 0.001);
    vec3 glowColor  = moodHue(glowMood) * glowV * 0.6;

    float vL   = texture(u_state, v_uv + vec2(-texel.x, 0.0)).g;
    float vR   = texture(u_state, v_uv + vec2( texel.x, 0.0)).g;
    float vD   = texture(u_state, v_uv + vec2(0.0, -texel.y)).g;
    float vU   = texture(u_state, v_uv + vec2(0.0,  texel.y)).g;
    float edge = length(vec2(vR - vL, vU - vD)) * 5.0;
    edge = smoothstep(0.05, 0.5, edge);
    vec3 edgeColor = moodHue(moodTag) * edge * 1.2;

    vec3 baseColor = palette(v, moodTag);
    float ageFade  = smoothstep(0.5, 1.0, age);
    float lum      = dot(baseColor, vec3(0.299, 0.587, 0.114));
    baseColor = mix(baseColor, vec3(lum), ageFade * 0.7);
    baseColor *= 1.0 - ageFade * 0.4;

    vec3 color = baseColor + glowColor + edgeColor;
    color *= 1.0 + u_activity * 0.3;

    float scanline = 0.93 + 0.07 * sin(gl_FragCoord.y * 1.8);
    color *= scanline;

    float grain = (fract(sin(dot(gl_FragCoord.xy + u_time * 7.0,
                   vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.04;
    color += grain;

    vec2 vc = v_uv * 2.0 - 1.0;
    float vignette = 1.0 - dot(vc, vc) * 0.3;
    color *= max(vignette, 0.0);

    fragColor = vec4(max(color, vec3(0.0)), 1.0);
  }
`;

const disturbShader = /* glsl */ `#version 300 es
  precision highp float;

  uniform sampler2D u_state;
  uniform vec2 u_resolution;
  uniform float u_seed;
  uniform float u_mood;

  in vec2 v_uv;
  out vec4 fragColor;

  float hash(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h + u_seed) * 43758.5453);
  }

  void main() {
    vec4 current = texture(u_state, v_uv);
    float U = current.r, V = current.g, B = current.b, A = current.a;
    vec2 px = v_uv * u_resolution;

    float clusterCX = hash(vec2(0.0, u_seed)) * u_resolution.x;
    float clusterCY = hash(vec2(50.0, u_seed)) * u_resolution.y;
    float clusterRadius = 25.0;
    float seedCount = 2.0 + floor(hash(vec2(u_seed, 0.0)) * 2.0);

    for (float i = 0.0; i < 3.0; i++) {
      if (i >= seedCount) break;
      float angle = hash(vec2(i, u_seed + 1.0)) * 6.283;
      float r = hash(vec2(i + 100.0, u_seed + 1.0)) * clusterRadius;
      float cx = clusterCX + cos(angle) * r;
      float cy = clusterCY + sin(angle) * r;
      float seedRadius = 5.0 + hash(vec2(i + 100.0, u_seed)) * 5.0;
      float fadeRadius = seedRadius * 5.0;
      float dist = length(px - vec2(cx, cy));
      if (dist < fadeRadius) {
        float fade = smoothstep(fadeRadius, seedRadius * 1.5, dist);
        V *= mix(0.2, 1.0, fade);
        A = mix(min(A + 0.3, 1.0), A, fade);
      }
      if (dist < seedRadius && V < 0.10) {
        float falloff = 1.0 - smoothstep(0.0, seedRadius, dist);
        V = 0.25 * falloff + hash(px * 0.01 + i) * 0.01;
        U = 0.75;
        B = u_mood;
        A = 0.0;
      }
    }
    fragColor = vec4(U, V, B, A);
  }
`;

const seedShader = /* glsl */ `#version 300 es
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_seed;
  uniform float u_mood;

  in vec2 v_uv;
  out vec4 fragColor;

  float hash(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h + u_seed) * 43758.5453);
  }

  void main() {
    float U = 1.0, V = 0.0, B = 0.0, A = 0.0;
    vec2 px = v_uv * u_resolution;
    for (float i = 0.0; i < 8.0; i++) {
      float cx   = hash(vec2(i, u_seed)) * u_resolution.x;
      float cy   = hash(vec2(i + 50.0, u_seed)) * u_resolution.y;
      float size = 4.0 + hash(vec2(i + 100.0, u_seed)) * 8.0;
      if (abs(px.x - cx) < size && abs(px.y - cy) < size) {
        V = 0.25 + hash(px * 0.01 + i) * 0.01;
        U = 0.75;
        B = u_mood;
      }
    }
    fragColor = vec4(U, V, B, A);
  }
`;

// ── GL helpers (presence/src/ambient/gl.ts) ───────────────────────────────────

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[cross] Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vert = createShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`[cross] Program link error: ${log}`);
  }
  return prog;
}

interface PingPong {
  textures: [WebGLTexture, WebGLTexture];
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  current: 0 | 1;
  readTexture(): WebGLTexture;
  writeFramebuffer(): WebGLFramebuffer;
  swap(): void;
}

function createStateTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

function createFb(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fb;
}

function createPingPong(gl: WebGL2RenderingContext, w: number, h: number): PingPong {
  const textures: [WebGLTexture, WebGLTexture] = [createStateTexture(gl, w, h), createStateTexture(gl, w, h)];
  const framebuffers: [WebGLFramebuffer, WebGLFramebuffer] = [createFb(gl, textures[0]), createFb(gl, textures[1])];
  return {
    textures, framebuffers,
    current: 0 as 0 | 1,
    readTexture()      { return this.textures[this.current]; },
    writeFramebuffer() { return this.framebuffers[1 - this.current as 0 | 1]; },
    swap()             { this.current = (1 - this.current) as 0 | 1; },
  };
}

function createQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface CrossCanvas {
  start: () => void;
  stop: () => void;
  dispose: () => void;
}

export interface CrossCanvasOpts {
  /** URL of the presence instance. Default: https://presence.one.sleepunit.com */
  stateUrl?: string;
  /** Poll interval in ms. Default: 1000 */
  pollMs?: number;
}

/**
 * Mount the cross face on two canvases.
 *
 * @param glCanvas  WebGL2 canvas (hero background, `#bg-canvas`)
 * @param fxCanvas  Canvas2D overlay for directional color overlays (`#fx-canvas`)
 * @param opts      Optional config
 * @returns         CrossCanvas handle, or null if WebGL2 is unavailable
 */
export function createCrossCanvas(
  glCanvas: HTMLCanvasElement,
  fxCanvas: HTMLCanvasElement,
  opts?: CrossCanvasOpts,
): CrossCanvas | null {
  const stateUrl = opts?.stateUrl ?? 'https://presence.one.sleepunit.com';
  const pollMs   = opts?.pollMs  ?? 1000;

  // ── WebGL2 setup ──────────────────────────────────────────────────────────
  const maybeGl = glCanvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!maybeGl) return null;
  // Explicit non-null typed const so closures below don't widen back to null.
  const gl: WebGL2RenderingContext = maybeGl;

  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) return null;  // RGBA16F render targets require this

  const maybeCtx = fxCanvas.getContext('2d');
  if (!maybeCtx) return null;
  const ctx2d: CanvasRenderingContext2D = maybeCtx;

  // ── Programs ──────────────────────────────────────────────────────────────
  const simProgram    = createProgram(gl, vertexShader, simulationShader);
  const renderProgram = createProgram(gl, vertexShader, renderShader);
  const seedProgram   = createProgram(gl, vertexShader, seedShader);
  const disturbProg   = createProgram(gl, vertexShader, disturbShader);
  const quad          = createQuad(gl);

  const simU = {
    state:      gl.getUniformLocation(simProgram, 'u_state')!,
    resolution: gl.getUniformLocation(simProgram, 'u_resolution')!,
    Du:         gl.getUniformLocation(simProgram, 'u_Du')!,
    Dv:         gl.getUniformLocation(simProgram, 'u_Dv')!,
    feed:       gl.getUniformLocation(simProgram, 'u_feed')!,
    kill:       gl.getUniformLocation(simProgram, 'u_kill')!,
    dt:         gl.getUniformLocation(simProgram, 'u_dt')!,
    time:       gl.getUniformLocation(simProgram, 'u_time')!,
    advection:  gl.getUniformLocation(simProgram, 'u_advection')!,
    ageRate:    gl.getUniformLocation(simProgram, 'u_ageRate')!,
    gravity:    gl.getUniformLocation(simProgram, 'u_gravity')!,
    moodFeeds:  gl.getUniformLocation(simProgram, 'u_moodFeeds')!,
    moodKills:  gl.getUniformLocation(simProgram, 'u_moodKills')!,
  };
  const renderU = {
    state:            gl.getUniformLocation(renderProgram, 'u_state')!,
    time:             gl.getUniformLocation(renderProgram, 'u_time')!,
    activity:         gl.getUniformLocation(renderProgram, 'u_activity')!,
    resolution:       gl.getUniformLocation(renderProgram, 'u_resolution')!,
    screenResolution: gl.getUniformLocation(renderProgram, 'u_screenResolution')!,
  };
  const seedU = {
    resolution: gl.getUniformLocation(seedProgram, 'u_resolution')!,
    seed:       gl.getUniformLocation(seedProgram, 'u_seed')!,
    mood:       gl.getUniformLocation(seedProgram, 'u_mood')!,
  };
  const disturbU = {
    state:      gl.getUniformLocation(disturbProg, 'u_state')!,
    resolution: gl.getUniformLocation(disturbProg, 'u_resolution')!,
    seed:       gl.getUniformLocation(disturbProg, 'u_seed')!,
    mood:       gl.getUniformLocation(disturbProg, 'u_mood')!,
  };

  // ── Simulation state ──────────────────────────────────────────────────────
  const SIM_SCALE = 0.3;
  let pingPong: PingPong;
  let simW = 0, simH = 0, scrW = 0, scrH = 0;

  let curFeed  = IDLE_PRESETS[0].feed;
  let curKill  = IDLE_PRESETS[0].kill;
  let curDu    = 0.2097;
  let curDv    = 0.105;
  let curSteps = 8;
  let curMood  = 0;

  let driftF = 0, driftK = 0, driftTF = 0, driftTK = 0;

  let idlePresetIdx      = 0;
  let idlePresetTimer    = 0;
  let idlePresetInterval = 180 + Math.random() * 120;
  let idleBaseF = IDLE_PRESETS[0].feed;
  let idleBaseK = IDLE_PRESETS[0].kill;

  let densityBuf: Float32Array | null = null;
  const DENSITY_LO = 0.25;
  const DENSITY_HI = 0.45;

  // ── /state polling ────────────────────────────────────────────────────────
  let artState: ArtState = idleState();

  async function pollState(): Promise<void> {
    try {
      const r = await fetch(`${stateUrl}/state`, {
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(String(r.status));
      artState = await r.json() as ArtState;
    } catch {
      /* hold last known state — canvas keeps running, no visual break */
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollStarted = false;

  // ── Effects ───────────────────────────────────────────────────────────────
  const effects: SimEffect[] = [new NeuralSplitEffect()];

  // ── Helpers ───────────────────────────────────────────────────────────────
  function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

  function doSeed(): void {
    gl.useProgram(seedProgram);
    gl.uniform2f(seedU.resolution, simW, simH);
    gl.uniform1f(seedU.seed, Math.random() * 1000);
    gl.uniform1f(seedU.mood, 0);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingPong.framebuffers[i]);
      gl.viewport(0, 0, simW, simH);
      gl.bindVertexArray(quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function doDisturb(): void {
    gl.useProgram(disturbProg);
    gl.uniform2f(disturbU.resolution, simW, simH);
    gl.uniform1f(disturbU.seed, Math.random() * 10000);
    gl.uniform1f(disturbU.mood, curMood);
    gl.uniform1i(disturbU.state, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pingPong.readTexture());
    gl.bindFramebuffer(gl.FRAMEBUFFER, pingPong.writeFramebuffer());
    gl.viewport(0, 0, simW, simH);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    pingPong.swap();
  }

  function measureDensity(): number {
    const needed = simW * 4;
    if (!densityBuf || densityBuf.length !== needed) densityBuf = new Float32Array(needed);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pingPong.framebuffers[pingPong.current]);
    gl.readPixels(0, Math.floor(simH / 2), simW, 1, gl.RGBA, gl.FLOAT, densityBuf);
    let sum = 0;
    for (let i = 0; i < simW; i++) sum += densityBuf[i * 4 + 1];
    return sum / simW;
  }

  let densityTimer: ReturnType<typeof setInterval> | null = null;

  // ── Resize ────────────────────────────────────────────────────────────────
  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    scrW = Math.floor(glCanvas.clientWidth  * dpr);
    scrH = Math.floor(glCanvas.clientHeight * dpr);
    simW = Math.floor(scrW * SIM_SCALE);
    simH = Math.floor(scrH * SIM_SCALE);

    glCanvas.width = scrW; glCanvas.height = scrH;
    fxCanvas.width = scrW; fxCanvas.height = scrH;

    pingPong = createPingPong(gl, simW, simH);
    doSeed();

    // Warm up: 500 silent steps so the face doesn't start blank
    gl.useProgram(simProgram);
    gl.uniform2f(simU.resolution, simW, simH);
    gl.uniform1f(simU.Du,   curDu);
    gl.uniform1f(simU.Dv,   curDv);
    gl.uniform1f(simU.feed, curFeed);
    gl.uniform1f(simU.kill, curKill);
    gl.uniform1fv(simU.moodFeeds, MOOD_PARAMS.map(m => m.feed));
    gl.uniform1fv(simU.moodKills, MOOD_PARAMS.map(m => m.kill));
    gl.uniform1f(simU.dt,         1.0);
    gl.uniform1f(simU.time,       0);
    gl.uniform1i(simU.state,      0);
    gl.uniform2f(simU.advection,  0, 0);
    gl.uniform1f(simU.ageRate,    0.00001 / 8);
    gl.uniform1f(simU.gravity,    0.02);
    gl.viewport(0, 0, simW, simH);
    gl.bindVertexArray(quad);
    for (let i = 0; i < 500; i++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pingPong.readTexture());
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingPong.writeFramebuffer());
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      pingPong.swap();
    }
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  // ── Animation loop ────────────────────────────────────────────────────────
  let globalTime = 0;
  let last: number | null = null;
  let rafId = 0;
  let running = false;

  function frame(ts: number): void {
    if (!running) return;
    const dt    = last !== null ? Math.min(ts - last, 100) : 16;
    const dtSec = dt / 1000;
    last = ts;
    globalTime += dtSec;

    // Idle preset rotation
    idlePresetTimer += dtSec;
    if (idlePresetTimer > idlePresetInterval) {
      idlePresetIdx      = (idlePresetIdx + 1) % IDLE_PRESETS.length;
      idlePresetTimer    = 0;
      idlePresetInterval = 180 + Math.random() * 120;
    }
    idleBaseF += (IDLE_PRESETS[idlePresetIdx].feed - idleBaseF) * 0.002;
    idleBaseK += (IDLE_PRESETS[idlePresetIdx].kill - idleBaseK) * 0.002;

    // Parameter interpolation
    const tgt    = stateToParams(artState);
    const isIdle = artState.mood === 'idle';
    const t      = isIdle ? 0.025 : 0.012;
    const moodT  = isIdle ? 0.002 : 0.008;

    curFeed  = lerp(curFeed,  isIdle ? idleBaseF : tgt.feed,                             t);
    curKill  = lerp(curKill,  isIdle ? idleBaseK : tgt.kill,                             t);
    curDu    = lerp(curDu,    tgt.Du,                                                     t);
    curDv    = lerp(curDv,    tgt.Dv,                                                     t);
    curSteps = Math.round(lerp(curSteps, tgt.stepsPerFrame + artState.activity * 6,       t));
    curMood  = lerp(curMood,  isIdle ? 0 : tgt.mood,                                     moodT);

    // Drunkard's walk
    if (Math.random() < 0.0005) {
      driftTF = (Math.random() - 0.5) * 0.010;
      driftTK = (Math.random() - 0.5) * 0.005;
    }
    driftF += (driftTF - driftF) * 0.008;
    driftK += (driftTK - driftK) * 0.008;
    const dScale  = isIdle ? 0.2 : 1.0;
    const lfoF    = Math.sin(globalTime * 0.05) * 0.005 * dScale;
    const lfoK    = Math.cos(globalTime * 0.07) * 0.003 * dScale;
    const actMod  = Math.max(0, artState.activity - 0.3) * 0.012;
    const totalF  = curFeed + driftF * dScale + lfoF;
    const totalK  = curKill + driftK * dScale + lfoK;

    // Advection base
    const advAngle    = globalTime * 0.01;
    const advWobble   = Math.sin(globalTime * 0.005) * 0.15;
    const baseAdvSpeed = 0.3;

    // Effects
    const effectState: EffectState = {
      voice:      (artState.voice ?? 'idle') as EffectState['voice'],
      activity:   artState.activity ?? 0,
      voiceLevel: artState.voiceLevel ?? null,
    };
    const delta    = combineDeltas(effects.map(e => e.tick(effectState, globalTime, dt)));
    const steps    = Math.max(1, curSteps + Math.round(delta.stepsBoost));
    const advPerStep = baseAdvSpeed / steps;
    const advX     = Math.cos(advAngle + advWobble) * advPerStep + delta.advX / steps;
    const advY     = Math.sin(advAngle * 0.7 + advWobble) * advPerStep * 0.8 + delta.advY / steps;

    // Simulate
    gl.useProgram(simProgram);
    gl.uniform2f(simU.resolution, simW, simH);
    gl.uniform1f(simU.Du,         curDu);
    gl.uniform1f(simU.Dv,         curDv);
    gl.uniform1f(simU.feed,       totalF + delta.feedBoost + actMod);
    gl.uniform1f(simU.kill,       totalK + delta.killBoost);
    gl.uniform1fv(simU.moodFeeds, MOOD_PARAMS.map(m => m.feed + actMod));
    gl.uniform1fv(simU.moodKills, MOOD_PARAMS.map(m => m.kill));
    gl.uniform1f(simU.dt,         1.0);
    gl.uniform1f(simU.time,       globalTime);
    gl.uniform1i(simU.state,      0);
    gl.uniform2f(simU.advection,  advX, advY);
    gl.uniform1f(simU.ageRate,    0.00001 / steps);
    gl.uniform1f(simU.gravity,    0.02 + delta.gravityBoost);
    gl.viewport(0, 0, simW, simH);
    gl.bindVertexArray(quad);
    for (let i = 0; i < steps; i++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pingPong.readTexture());
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingPong.writeFramebuffer());
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      pingPong.swap();
    }

    // Render GL to screen
    gl.useProgram(renderProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pingPong.readTexture());
    gl.uniform1i(renderU.state,              0);
    gl.uniform1f(renderU.time,               globalTime);
    gl.uniform1f(renderU.activity,           artState.activity ?? 0);
    gl.uniform2f(renderU.resolution,         simW, simH);
    gl.uniform2f(renderU.screenResolution,   scrW, scrH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, scrW, scrH);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Canvas2D overlay
    for (const e of effects) {
      e.draw?.(ctx2d, fxCanvas.width, fxCanvas.height, effectState, globalTime);
    }

    rafId = requestAnimationFrame(frame);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  resize();

  return {
    start() {
      if (running) return;
      running = true;

      if (!pollStarted) {
        pollStarted = true;
        void pollState();
        pollTimer = setInterval(() => { void pollState(); }, pollMs);
        // Density-based disturb trigger
        densityTimer = setInterval(() => {
          if (!pingPong) return;
          const d = measureDensity();
          const pressure = d < DENSITY_LO ? 0 : Math.min((d - DENSITY_LO) / (DENSITY_HI - DENSITY_LO), 1);
          if (Math.random() < 0.03 + pressure * 0.97) doDisturb();
        }, 500);
        console.log(`[arte.fish] cross face polling ${stateUrl}/state every ${pollMs}ms`);
      }

      rafId = requestAnimationFrame(ts => { last = ts; rafId = requestAnimationFrame(frame); });
    },

    stop() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },

    dispose() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (densityTimer) { clearInterval(densityTimer); densityTimer = null; }
      window.removeEventListener('resize', onResize);
    },
  };
}
