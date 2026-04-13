import { useEffect, useRef, useState, useCallback } from 'react';

// ─── World constants (all gameplay runs in flat world-space) ──────────────────
const WORLD_W = 900;
const WORLD_H = 900;

// ─── Single ramping profile ──────────────────────────────────────────────────
const RAMP_CONFIG = {
  spawnInterval: 1400,
  projSpeed: 200,
  aoeInterval: 4000,
  escalationInterval: 10,
  speedInc: 25,
  spawnDec: 80,
  minSpawn: 350,
  projDmg: 20,
  aoeDmg: 35,
  flashCd: 15,
};

// ─── Game constants ───────────────────────────────────────────────────────────
const PLAYER_RADIUS = 16;
const PLAYER_HITBOX_RADIUS = 9;
const PLAYER_SPEED = 260;
const FLASH_RANGE = 230;
const FLASH_VISUAL_COOLDOWN = 300;

const PROJECTILE_W = 7;
const PROJECTILE_H = 96;
const PROJECTILE_SPAWN_MARGIN = 260;
const PROJECTILE_DESPAWN_MARGIN = 280;
const PROJECTILE_NEAR_RADIUS = 72;

const AOE_RADIUS = 55;
const AOE_DELAY = 1500;

const LUX_WARNING_MS = 950;
const LUX_ACTIVE_MS = 260;
const LUX_BEAM_HALF_W = 42;

const ROCKET_WARNING_MS = 780;
const ROCKET_RADIUS = 22;
const ROCKET_BASE_SPEED = 520;
const ROCKET_DESPAWN_MARGIN = 420;

const TURRET_FALL_MS = 800;
const TURRET_LIFE_MS = 7000;
const TURRET_BASE_INTERVAL = 11500;
const TURRET_MIN_INTERVAL = 5200;
const TURRET_INTERVAL_DECAY = 220;
const TURRET_SHOT_BASE_INTERVAL = 760;
const TURRET_SHOT_MIN_INTERVAL = 240;
const TURRET_SHOT_DECAY = 18;
const TURRET_SHOT_SPEED = 360;
const TURRET_SHOT_RADIUS = 5;

const WARNING_BLINK_MS = 140;

const ISO_TILE = 60;
const ARRIVAL_THRESHOLD = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function circleCircle(cx1, cy1, r1, cx2, cy2, r2) { return dist(cx1, cy1, cx2, cy2) < r1 + r2; }

function createNoiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.16);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  return buffer;
}

// ─── Dynamic isometric projection ────────────────────────────────────────────
function makeProjection(canvasW, canvasH) {
  const cosA = Math.cos(Math.PI / 6);
  const sinA = Math.sin(Math.PI / 6);
  const rawW = (WORLD_W + WORLD_H) * cosA;
  const rawH = (WORLD_W + WORLD_H) * sinA;
  const padding = 30;
  const scale = Math.min((canvasW - padding * 2) / rawW, (canvasH - padding * 2) / rawH);
  const originX = canvasW / 2;
  const originY = canvasH / 2;

  function worldToScreen(wx, wy) {
    const ox = wx - WORLD_W / 2, oy = wy - WORLD_H / 2;
    return { sx: originX + (ox - oy) * cosA * scale, sy: originY + (ox + oy) * sinA * scale };
  }
  function screenToWorld(sx, sy) {
    const rx = (sx - originX) / scale, ry = (sy - originY) / scale;
    return { wx: rx / (2 * cosA) + ry / (2 * sinA) + WORLD_W / 2, wy: ry / (2 * sinA) - rx / (2 * cosA) + WORLD_H / 2 };
  }
  return { worldToScreen, screenToWorld, scale, cosA, sinA };
}

// ─── Spawners ─────────────────────────────────────────────────────────────────
function spawnProjectile(tx, ty, speed) {
  const edge = Math.floor(Math.random() * 4);
  const m = PROJECTILE_SPAWN_MARGIN;
  let wx, wy;
  switch (edge) {
    case 0: wx = Math.random() * WORLD_W; wy = -m; break;
    case 1: wx = WORLD_W + m; wy = Math.random() * WORLD_H; break;
    case 2: wx = Math.random() * WORLD_W; wy = WORLD_H + m; break;
    default: wx = -m; wy = Math.random() * WORLD_H; break;
  }
  const angle = Math.atan2(ty - wy, tx - wx);
  return { wx, wy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, angle, w: PROJECTILE_W, h: PROJECTILE_H };
}

function spawnAoE(tx, ty) {
  const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 220;
  return {
    wx: clamp(tx + Math.cos(a) * r, AOE_RADIUS, WORLD_W - AOE_RADIUS),
    wy: clamp(ty + Math.sin(a) * r, AOE_RADIUS, WORLD_H - AOE_RADIUS),
    radius: AOE_RADIUS, born: performance.now(), exploded: false,
    explodeTime: AOE_DELAY, showExplosion: false, explosionLife: 0,
  };
}

// ─── Iso drawing helpers ──────────────────────────────────────────────────────
function isoStroke(ctx, proj, wx, wy, r, color, lw) {
  const { sx, sy } = proj.worldToScreen(wx, wy);
  const rx = r * proj.scale, ry = rx * (proj.sinA / proj.cosA);
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.ellipse(sx, sy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2); ctx.stroke();
}

function isoFill(ctx, proj, wx, wy, r, color) {
  const { sx, sy } = proj.worldToScreen(wx, wy);
  const rx = r * proj.scale, ry = rx * (proj.sinA / proj.cosA);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(sx, sy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2); ctx.fill();
}

function isoArc(ctx, proj, wx, wy, r, start, end, color, lw) {
  const { sx, sy } = proj.worldToScreen(wx, wy);
  const rx = r * proj.scale, ry = rx * (proj.sinA / proj.cosA);
  ctx.save(); ctx.translate(sx, sy); ctx.scale(1, ry / Math.max(rx, 0.01));
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(0, 0, Math.max(rx, 1), start, end); ctx.stroke();
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DodgeGame() {
  const canvasRef = useRef(null);
  const projRef = useRef(makeProjection(1200, 800));
  const [gamePhase, setGamePhase] = useState('menu');
  const phaseRef = useRef('menu');
  const [musicVolume, setMusicVolume] = useState(0.5);

  useEffect(() => { phaseRef.current = gamePhase; }, [gamePhase]);

  const stateRef = useRef({
    player: { wx: WORLD_W / 2, wy: WORLD_H / 2 },
    playerTarget: null, playerHP: 100,
    flashCooldownLeft: 0, mouseWx: WORLD_W / 2, mouseWy: WORLD_H / 2,
    projectiles: [], aoes: [], luxBeams: [], rockets: [], turret: null, turretShots: [], warnings: [], ripples: [], particles: [],
    score: 0, highScore: 0, lastTime: 0, elapsed: 0,
    nextSpawn: 0, spawnInterval: 0, projectileSpeed: 0,
    nextAoe: 0, aoeInterval: 0, nextLux: 0, luxInterval: 0,
    nextRocket: 0, rocketInterval: 0, nextTurret: 0,
    turretInterval: 0, turretShotInterval: 0, nextEscalation: 0,
    cw: 1200, ch: 800,
  });
  const rafRef = useRef(null);
  const gameAudioRef = useRef(null);
  const rightHoldRef = useRef({ active: false, pointerId: null });
  const audioRef = useRef({
    ctx: null,
    master: null,
    noise: null,
    bgmStop: null,
    lastNearSfxAt: 0,
    lastWarnSfxAt: 0,
    bgmMode: null,
  });

  const ensureAudio = useCallback(() => {
    const bag = audioRef.current;
    if (!bag.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      bag.ctx = new Ctx();
      bag.master = bag.ctx.createGain();
      bag.master.gain.value = 0.2;
      bag.master.connect(bag.ctx.destination);
      bag.noise = createNoiseBuffer(bag.ctx);
    }
    return bag;
  }, []);

  const unlockAudio = useCallback(() => {
    const bag = ensureAudio();
    if (!bag?.ctx) return;
    if (bag.ctx.state === 'suspended') bag.ctx.resume();

    // Retry MP3 start on direct user gesture; some browsers require this.
    if (phaseRef.current === 'playing' && gameAudioRef.current) {
      gameAudioRef.current.play().catch(() => {});
    }
  }, [ensureAudio]);

  const stopBgm = useCallback(() => {
    const bag = audioRef.current;
    if (bag.bgmStop) {
      bag.bgmStop();
      bag.bgmStop = null;
    }
    bag.bgmMode = null;
  }, []);

  const playTone = useCallback((ctx, options = {}) => {
    const bag = audioRef.current;
    if (!bag.master) return;
    const {
      freq = 440,
      toFreq = null,
      type = 'sine',
      gain = 0.08,
      attack = 0.005,
      release = 0.12,
      duration = 0.16,
      when = ctx.currentTime,
      detune = 0,
    } = options;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 1), when + duration);
    if (detune) osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0001), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + release + attack);
    osc.connect(g); g.connect(bag.master);
    osc.start(when);
    osc.stop(when + duration + release + 0.02);
  }, []);

  const playNoise = useCallback((ctx, options = {}) => {
    const bag = audioRef.current;
    if (!bag.master || !bag.noise) return;
    const { gain = 0.06, duration = 0.08, when = ctx.currentTime } = options;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = bag.noise;
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    src.connect(filter); filter.connect(g); g.connect(bag.master);
    src.start(when);
    src.stop(when + duration + 0.02);
  }, []);

  const playDamageSfx = useCallback(() => {
    const bag = ensureAudio();
    if (!bag?.ctx || bag.ctx.state !== 'running') return;
    const t = bag.ctx.currentTime + 0.001;
    playTone(bag.ctx, { freq: 220, toFreq: 90, type: 'sawtooth', gain: 0.08, duration: 0.11, release: 0.08, when: t });
    playNoise(bag.ctx, { gain: 0.045, duration: 0.07, when: t + 0.005 });
  }, [ensureAudio, playNoise, playTone]);

  const playNearLaserSfx = useCallback((nowMs) => {
    const bag = ensureAudio();
    if (!bag?.ctx || bag.ctx.state !== 'running') return;
    if (nowMs - bag.lastNearSfxAt < 180) return;
    bag.lastNearSfxAt = nowMs;
    const t = bag.ctx.currentTime + 0.001;
    playTone(bag.ctx, { freq: 1600, toFreq: 900, type: 'triangle', gain: 0.03, duration: 0.06, release: 0.07, when: t });
  }, [ensureAudio, playTone]);

  const playFlashSfx = useCallback(() => {
    const bag = ensureAudio();
    if (!bag?.ctx || bag.ctx.state !== 'running') return;
    const t = bag.ctx.currentTime + 0.001;
    playTone(bag.ctx, { freq: 420, toFreq: 980, type: 'triangle', gain: 0.07, duration: 0.09, release: 0.09, when: t });
    playTone(bag.ctx, { freq: 760, toFreq: 1400, type: 'sine', gain: 0.05, duration: 0.08, release: 0.08, when: t + 0.01 });
  }, [ensureAudio, playTone]);

  const playWarningSfx = useCallback((nowMs) => {
    const bag = ensureAudio();
    if (!bag?.ctx || bag.ctx.state !== 'running') return;
    if (nowMs - bag.lastWarnSfxAt < 110) return;
    bag.lastWarnSfxAt = nowMs;
    const t = bag.ctx.currentTime + 0.001;
    playTone(bag.ctx, { freq: 1180, toFreq: 980, type: 'square', gain: 0.03, duration: 0.04, release: 0.06, when: t });
  }, [ensureAudio, playTone]);

  const playLuxSfx = useCallback(() => {
    const bag = ensureAudio();
    if (!bag?.ctx || bag.ctx.state !== 'running') return;
    const t = bag.ctx.currentTime + 0.001;
    playTone(bag.ctx, { freq: 260, toFreq: 1850, type: 'sawtooth', gain: 0.07, duration: 0.2, release: 0.18, when: t });
    playTone(bag.ctx, { freq: 980, toFreq: 2450, type: 'triangle', gain: 0.04, duration: 0.16, release: 0.12, when: t + 0.01 });
  }, [ensureAudio, playTone]);

  const playRocketSfx = useCallback(() => {
    const bag = ensureAudio();
    if (!bag?.ctx || bag.ctx.state !== 'running') return;
    const t = bag.ctx.currentTime + 0.001;
    playTone(bag.ctx, { freq: 110, toFreq: 85, type: 'sawtooth', gain: 0.08, duration: 0.18, release: 0.18, when: t });
    playNoise(bag.ctx, { gain: 0.04, duration: 0.14, when: t + 0.01 });
  }, [ensureAudio, playNoise, playTone]);

  const setBgmMode = useCallback((mode) => {
    const bag = ensureAudio();
    if (bag?.bgmMode === mode) return;

    // Stop MP3 if leaving game mode
    if (bag?.bgmMode === 'game' && gameAudioRef.current) {
      gameAudioRef.current.pause();
      gameAudioRef.current.currentTime = 0;
    }
    stopBgm();

    if (mode === 'game') {
      if (gameAudioRef.current) {
        gameAudioRef.current.volume = musicVolume;
        gameAudioRef.current.play().catch(() => {});
      }
      if (bag) bag.bgmMode = 'game';
      return;
    }

    // Procedural BGM uses WebAudio and only starts when the context is running.
    if (!bag?.ctx || bag.ctx.state !== 'running') return;

    const ctx = bag.ctx;
    const intervalMs = mode === 'menu' ? 880 : 320;
    const notes = mode === 'menu' ? [261.63, 329.63, 392.0, 329.63] : [174.61, 196, 220, 246.94, 220, 196];
    let step = 0;

    const tick = () => {
      const when = ctx.currentTime + 0.03;
      const n = notes[step % notes.length];
      if (mode === 'menu') {
        playTone(ctx, { freq: n, toFreq: n * 1.006, type: 'triangle', gain: 0.038, duration: 0.5, release: 0.35, when });
        playTone(ctx, { freq: n / 2, type: 'sine', gain: 0.018, duration: 0.52, release: 0.38, when: when + 0.02 });
      } else {
        playTone(ctx, { freq: n, toFreq: n * 0.96, type: 'sawtooth', gain: 0.03, duration: 0.16, release: 0.12, when });
        playTone(ctx, { freq: n * 2, toFreq: n * 2.25, type: 'square', gain: 0.013, duration: 0.055, release: 0.06, when: when + 0.025 });
      }
      step++;
    };

    tick();
    const id = window.setInterval(tick, intervalMs);
    bag.bgmMode = mode;
    bag.bgmStop = () => window.clearInterval(id);
  }, [ensureAudio, musicVolume, playTone, stopBgm]);

  useEffect(() => {
    if (gamePhase === 'playing') setBgmMode('game');
    if (gamePhase === 'menu' || gamePhase === 'dead') setBgmMode('menu');
  }, [gamePhase, setBgmMode]);

  useEffect(() => () => {
    stopBgm();
    if (gameAudioRef.current) {
      gameAudioRef.current.pause();
      gameAudioRef.current.currentTime = 0;
    }
    const bag = audioRef.current;
    if (bag.ctx && bag.ctx.state !== 'closed') bag.ctx.close();
  }, [stopBgm]);

  useEffect(() => {
    if (gameAudioRef.current) gameAudioRef.current.volume = musicVolume;
  }, [musicVolume]);

  // ── Resize ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      const c = canvasRef.current; if (!c) return;
      const w = window.innerWidth, h = window.innerHeight;
      c.width = w; c.height = h;
      projRef.current = makeProjection(w, h);
      stateRef.current.cw = w; stateRef.current.ch = h;
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Draw helper: game entities ─────────────────────────────────────────────
  const drawEntities = useCallback((ctx, state, now, proj, CW) => {
    const { player, projectiles, aoes, luxBeams, rockets, turret, turretShots, warnings, ripples, particles, flashCooldownLeft, ch: CH } = state;

    // Ripples
    for (const rip of ripples) {
      const age = (now - rip.born) / rip.life; if (age >= 1) continue;
      isoStroke(ctx, proj, rip.wx, rip.wy, rip.maxR * age, `rgba(79,195,247,${(0.5 * (1 - age)).toFixed(3)})`, 2);
    }

    // AoE
    for (const aoe of aoes) {
      const ageMs = now - aoe.born, progress = Math.min(ageMs / aoe.explodeTime, 1);
      if (aoe.showExplosion) {
        const e = aoe.explosionLife, a = Math.max(0, 1 - e / 350).toFixed(3);
        isoFill(ctx, proj, aoe.wx, aoe.wy, aoe.radius * (1 + e / 140), `rgba(255,90,0,${a})`);
        isoStroke(ctx, proj, aoe.wx, aoe.wy, aoe.radius * (1.3 + e / 100), `rgba(255,200,50,${(a * 0.7).toFixed(3)})`, 3);
      } else {
        isoFill(ctx, proj, aoe.wx, aoe.wy, aoe.radius, `rgba(255,50,50,${(0.05 + 0.12 * progress).toFixed(3)})`);
        isoStroke(ctx, proj, aoe.wx, aoe.wy, aoe.radius, `rgba(255,70,70,${(0.3 + 0.5 * progress).toFixed(3)})`, 2.5);
        isoArc(ctx, proj, aoe.wx, aoe.wy, aoe.radius - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, 'rgba(255,30,30,0.95)', 3.5);
      }
    }

    // Lux beams
    for (const beam of luxBeams) {
      const isWarning = now < beam.warnUntil;
      const isActive = now >= beam.warnUntil && now <= beam.fireUntil;
      if (!isWarning && !isActive) continue;

      const pulse = ((now - beam.born) % WARNING_BLINK_MS) / WARNING_BLINK_MS;
      const a = isWarning ? (pulse < 0.5 ? 0.85 : 0.22) : 1;
      const sw = beam.vertical
        ? [proj.worldToScreen(beam.linePos, 0), proj.worldToScreen(beam.linePos, WORLD_H)]
        : [proj.worldToScreen(0, beam.linePos), proj.worldToScreen(WORLD_W, beam.linePos)];

      if (isWarning) {
        ctx.strokeStyle = `rgba(255, 80, 80, ${a.toFixed(3)})`;
        ctx.shadowColor = 'rgba(255, 80, 80, 0.25)';
        ctx.shadowBlur = 8;
        ctx.lineWidth = Math.max(3, LUX_BEAM_HALF_W * proj.scale * 0.45);
      } else {
        ctx.strokeStyle = `rgba(180, 245, 255, ${a.toFixed(3)})`;
        ctx.shadowColor = 'rgba(90, 230, 255, 0.9)';
        ctx.shadowBlur = 24;
        ctx.lineWidth = Math.max(8, LUX_BEAM_HALF_W * proj.scale * 0.95);
      }
      ctx.beginPath();
      ctx.moveTo(sw[0].sx, sw[0].sy);
      ctx.lineTo(sw[1].sx, sw[1].sy);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Rockets
    for (const rk of rockets) {
      if (now < rk.warnUntil) continue;
      const { sx, sy } = proj.worldToScreen(rk.wx, rk.wy);
      const { sx: sx2, sy: sy2 } = proj.worldToScreen(rk.wx + rk.vx * 0.06, rk.wy + rk.vy * 0.06);
      const sa = Math.atan2(sy2 - sy, sx2 - sx);
      const bodyL = rk.r * 2.8;
      const bodyW = rk.r * 1.5;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(sa);
      ctx.scale(1, 0.65);
      const rg = ctx.createLinearGradient(-bodyL / 2, 0, bodyL / 2, 0);
      rg.addColorStop(0, 'rgba(255, 145, 90, 0.95)');
      rg.addColorStop(0.55, 'rgba(255, 214, 95, 1)');
      rg.addColorStop(1, 'rgba(255, 75, 55, 0.95)');
      ctx.fillStyle = rg;
      ctx.shadowColor = 'rgba(255, 120, 80, 0.9)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.roundRect(-bodyL / 2, -bodyW / 2, bodyL, bodyW, bodyW / 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(bodyL / 2 - 4, 0, bodyW * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Turret
    if (turret && now <= turret.despawnAt) {
      const { sx, sy } = proj.worldToScreen(turret.wx, turret.wy);
      const tRx = 14 * proj.scale;
      const tRy = Math.max(4, tRx * (proj.sinA / proj.cosA));
      const pulse = 0.75 + 0.25 * Math.sin(now / 110);
      ctx.fillStyle = `rgba(255, 45, 70, ${pulse.toFixed(3)})`;
      ctx.shadowColor = 'rgba(255, 40, 80, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(sx, sy, Math.max(7, tRx), tRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      const topY = sy - 13 * proj.scale;
      ctx.strokeStyle = 'rgba(255,120,130,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 2 * proj.scale);
      ctx.lineTo(sx, topY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 205, 210, 0.98)';
      ctx.beginPath();
      ctx.arc(sx, topY, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Turret shots
    for (const ts of turretShots) {
      const { sx, sy } = proj.worldToScreen(ts.wx, ts.wy);
      ctx.fillStyle = 'rgba(255, 25, 70, 0.95)';
      ctx.shadowColor = 'rgba(255, 30, 90, 0.95)';
      ctx.shadowBlur = 11;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, ts.r * proj.scale), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Projectiles
    for (const p of projectiles) {
      const { sx, sy } = proj.worldToScreen(p.wx, p.wy);
      const { sx: sx2, sy: sy2 } = proj.worldToScreen(p.wx + p.vx * 0.04, p.wy + p.vy * 0.04);
      const sa = Math.atan2(sy2 - sy, sx2 - sx);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(sa - Math.PI / 2); ctx.scale(1, 0.42);
      const grad = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 2);
      grad.addColorStop(0, 'rgba(75,220,255,0.02)');
      grad.addColorStop(0.2, 'rgba(120,240,255,0.75)');
      grad.addColorStop(0.5, 'rgba(235,255,255,1)');
      grad.addColorStop(0.8, 'rgba(120,240,255,0.75)');
      grad.addColorStop(1, 'rgba(75,220,255,0.02)');
      ctx.fillStyle = grad; ctx.shadowColor = 'rgba(0,210,255,0.95)'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 4); ctx.fill();

      const core = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 2);
      core.addColorStop(0, 'rgba(255,255,255,0.08)');
      core.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      core.addColorStop(1, 'rgba(255,255,255,0.08)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.roundRect(-p.w / 6, -p.h / 2, p.w / 3, p.h, 2); ctx.fill();
      ctx.restore();
    }

    // Particles
    for (const pt of particles) {
      const age = (now - pt.born) / pt.life; if (age >= 1) continue;
      const { sx, sy } = proj.worldToScreen(pt.wx, pt.wy);
      ctx.fillStyle = `rgba(${pt.color},${(1 - age).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(pt.r * (1 - age * 0.5), 0.5), 0, Math.PI * 2); ctx.fill();
    }

    // Player shadow
    isoFill(ctx, proj, player.wx, player.wy, PLAYER_RADIUS * 1.2, 'rgba(0,0,0,0.35)');

    // Player body
    const { sx: psx, sy: psy } = proj.worldToScreen(player.wx, player.wy);
    const bRx = PLAYER_RADIUS * proj.scale * 0.55;
    const bRy = bRx * (proj.sinA / proj.cosA);
    const bH = PLAYER_RADIUS * proj.scale * 0.45;

    // Glow
    const glow = ctx.createRadialGradient(psx, psy, 0, psx, psy, bRx * 3);
    glow.addColorStop(0, 'rgba(79,195,247,0.28)'); glow.addColorStop(1, 'rgba(79,195,247,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(psx, psy, bRx * 3, 0, Math.PI * 2); ctx.fill();

    // Shaft
    const sg = ctx.createLinearGradient(psx - bRx, psy, psx + bRx, psy);
    sg.addColorStop(0, '#01579b'); sg.addColorStop(0.35, '#4fc3f7'); sg.addColorStop(0.65, '#81d4fa'); sg.addColorStop(1, '#01579b');
    ctx.fillStyle = sg; ctx.beginPath();
    ctx.ellipse(psx, psy + bH / 2, bRx, bRy, 0, 0, Math.PI);
    ctx.lineTo(psx - bRx, psy - bH / 2);
    ctx.ellipse(psx, psy - bH / 2, bRx, bRy, 0, Math.PI, 0);
    ctx.closePath(); ctx.fill();

    // Top cap
    const tg = ctx.createRadialGradient(psx - bRx * 0.2, psy - bH / 2 - 1, 1, psx, psy - bH / 2, bRx);
    tg.addColorStop(0, '#e1f5fe'); tg.addColorStop(1, '#0288d1');
    ctx.fillStyle = tg; ctx.shadowColor = '#4fc3f7'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(psx, psy - bH / 2, bRx, bRy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // HP bar
    const barW = bRx * 3.2, barH = 5, barX = psx - barW / 2, barY = psy - bH - bRy - 14;
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect(barX - 1, barY - 1, barW + 2, barH + 2, 2); ctx.fill();
    ctx.fillStyle = state.playerHP > 50 ? '#4caf50' : state.playerHP > 25 ? '#ff9800' : '#f44336';
    ctx.beginPath(); ctx.roundRect(barX, barY, Math.max(barW * (state.playerHP / 100), 0), barH, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5; ctx.strokeRect(barX, barY, barW, barH);

    // Flash ring
    const ringR = bRx + 6;
    if (flashCooldownLeft > 0) {
      const p2 = 1 - flashCooldownLeft / RAMP_CONFIG.flashCd;
      ctx.strokeStyle = 'rgba(170,130,255,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(psx, psy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p2); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(190,160,255,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(psx, psy, ringR, 0, Math.PI * 2); ctx.stroke();
    }

    // HUD
    const hudX = 14, hudY = 50;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.roundRect(hudX, hudY, 170, 60, 8); ctx.fill();
    ctx.fillStyle = '#c8d6ff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`Time: ${state.score.toFixed(1)}s`, hudX + 12, hudY + 22);
    ctx.fillText(`Best: ${state.highScore.toFixed(1)}s`, hudX + 12, hudY + 44);

    // Flash HUD
    const flashReady = flashCooldownLeft <= 0;
    const fX = CW - 90, fY = 50;
    ctx.fillStyle = flashReady ? 'rgba(100,70,220,0.85)' : 'rgba(30,30,50,0.85)';
    ctx.beginPath(); ctx.roundRect(fX, fY, 76, 44, 8); ctx.fill();
    if (flashReady) { ctx.strokeStyle = 'rgba(180,150,255,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = flashReady ? '#fff' : '#555'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[D / F]', fX + 38, fY + 17);
    ctx.font = '11px monospace';
    ctx.fillText(flashReady ? 'FLASH ⚡' : `${Math.ceil(flashCooldownLeft * (FLASH_VISUAL_COOLDOWN / RAMP_CONFIG.flashCd))}s`, fX + 38, fY + 35);
    ctx.textAlign = 'left';

    // Directional warnings
    for (const w of warnings) {
      if (w.type === 'lux') continue;
      const age = now - w.born;
      if (age > w.life) continue;
      const pulse = (age % WARNING_BLINK_MS) / WARNING_BLINK_MS;
      const alpha = pulse < 0.5 ? 0.95 : 0.2;
      const color = w.type === 'lux' ? `rgba(255, 110, 110, ${alpha.toFixed(3)})` : `rgba(255, 190, 110, ${alpha.toFixed(3)})`;
      const size = w.type === 'lux' ? 28 : 24;
      const pad = 20;
      const edgeOffset = 18;
      const lanePos = w.lanePos ?? (w.side === 'top' || w.side === 'bottom' ? WORLD_W / 2 : WORLD_H / 2);
      const center = proj.worldToScreen(WORLD_W / 2, WORLD_H / 2);
      let cx = center.sx;
      let cy = center.sy;
      if (w.side === 'top') {
        const anchor = proj.worldToScreen(clamp(lanePos, 0, WORLD_W), 0);
        cx = anchor.sx;
        cy = anchor.sy;
      }
      if (w.side === 'right') {
        const anchor = proj.worldToScreen(WORLD_W, clamp(lanePos, 0, WORLD_H));
        cx = anchor.sx;
        cy = anchor.sy;
      }
      if (w.side === 'bottom') {
        const anchor = proj.worldToScreen(clamp(lanePos, 0, WORLD_W), WORLD_H);
        cx = anchor.sx;
        cy = anchor.sy;
      }
      if (w.side === 'left') {
        const anchor = proj.worldToScreen(0, clamp(lanePos, 0, WORLD_H));
        cx = anchor.sx;
        cy = anchor.sy;
      }

      const vx = cx - center.sx;
      const vy = cy - center.sy;
      const vLen = Math.max(1, Math.hypot(vx, vy));
      cx = clamp(cx + (vx / vLen) * edgeOffset, pad, CW - pad);
      cy = clamp(cy + (vy / vLen) * edgeOffset, pad, CH - pad);

      const angle = w.side === 'top' ? 0 : w.side === 'right' ? Math.PI / 2 : w.side === 'bottom' ? Math.PI : -Math.PI / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, size * 0.8);
      ctx.lineTo(-size * 0.5, -size * 0.6);
      ctx.lineTo(size * 0.5, -size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, []);

  // ── Main draw ──────────────────────────────────────────────────────────────
  const draw = useCallback((ctx, state, now) => {
    const { cw: CW, ch: CH } = state;
    const proj = projRef.current;
    const phase = phaseRef.current;

    ctx.fillStyle = '#0a0a18'; ctx.fillRect(0, 0, CW, CH);

    // Vignette
    const vig = ctx.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.2, CW / 2, CH / 2, Math.max(CW, CH) * 0.7);
    vig.addColorStop(0, 'rgba(10,10,24,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, CW, CH);

    // Grid
    const tiles = Math.ceil(WORLD_W / ISO_TILE);
    ctx.strokeStyle = 'rgba(80,100,180,0.10)'; ctx.lineWidth = 1;
    for (let i = 0; i <= tiles; i++) {
      const w = i * ISO_TILE;
      let a = proj.worldToScreen(w, 0), b = proj.worldToScreen(w, WORLD_H);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      a = proj.worldToScreen(0, w); b = proj.worldToScreen(WORLD_W, w);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }

    // Border
    const cn = [proj.worldToScreen(0, 0), proj.worldToScreen(WORLD_W, 0), proj.worldToScreen(WORLD_W, WORLD_H), proj.worldToScreen(0, WORLD_H)];
    ctx.strokeStyle = 'rgba(80,140,255,0.30)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cn[0].sx, cn[0].sy);
    for (let i = 1; i < 4; i++) ctx.lineTo(cn[i].sx, cn[i].sy);
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'rgba(30,40,80,0.06)'; ctx.fill();

    if (phase === 'menu') {
      drawEntities(ctx, state, now, proj, CW);
      ctx.fillStyle = 'rgba(0,0,0,0.50)'; ctx.fillRect(0, 0, CW, CH);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#cddaff'; ctx.font = `bold ${Math.min(CW * 0.05, 52)}px Arial`;
      ctx.fillText('DODGE GAME', CW / 2, CH / 2 - CH * 0.12);
      ctx.font = `${Math.min(CW * 0.02, 18)}px Arial`; ctx.fillStyle = '#7788aa';
      ctx.fillText('Right-click to move  ·  D / F to Flash  ·  ESC to menu', CW / 2, CH / 2 - CH * 0.06);
      ctx.fillText('Dodge all incoming skillshots — survive as long as you can', CW / 2, CH / 2 - CH * 0.025);
      ctx.fillStyle = '#4fc3f7'; ctx.font = `bold ${Math.min(CW * 0.022, 22)}px Arial`;
      ctx.fillText('Right-click anywhere to START', CW / 2, CH / 2 + CH * 0.11);
      ctx.textAlign = 'left';
      return;
    }

    if (phase === 'dead') {
      drawEntities(ctx, state, now, proj, CW);
      ctx.fillStyle = 'rgba(0,0,0,0.60)'; ctx.fillRect(0, 0, CW, CH);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5252'; ctx.font = `bold ${Math.min(CW * 0.055, 54)}px Arial`;
      ctx.fillText('GAME OVER', CW / 2, CH / 2 - CH * 0.10);
      ctx.fillStyle = '#cddaff'; ctx.font = `${Math.min(CW * 0.028, 26)}px Arial`;
      ctx.fillText(`Score: ${state.score.toFixed(1)}s`, CW / 2, CH / 2 - CH * 0.01);
      ctx.fillText(`Best: ${state.highScore.toFixed(1)}s`, CW / 2, CH / 2 + CH * 0.04);
      ctx.fillStyle = '#4fc3f7'; ctx.font = `bold ${Math.min(CW * 0.022, 22)}px Arial`;
      ctx.fillText('Right-click or SPACE to play again', CW / 2, CH / 2 + CH * 0.11);
      ctx.font = `${Math.min(CW * 0.016, 16)}px Arial`; ctx.fillStyle = '#7788aa';
      ctx.fillText('ESC to return to menu', CW / 2, CH / 2 + CH * 0.15);
      ctx.textAlign = 'left';
      return;
    }

    drawEntities(ctx, state, now, proj, CW);
  }, [drawEntities]);

  // ── Start / Restart ────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const d = RAMP_CONFIG;
    const s = stateRef.current;
    s.player = { wx: WORLD_W / 2, wy: WORLD_H / 2 };
    s.playerTarget = null; s.playerHP = 100; s.flashCooldownLeft = 0;
    s.projectiles = []; s.aoes = []; s.luxBeams = []; s.rockets = []; s.turret = null; s.turretShots = []; s.warnings = []; s.ripples = []; s.particles = [];
    s.score = 0; s.elapsed = 0;
    s.lastTime = performance.now();
    s.nextSpawn = performance.now() + 1200;
    s.nextAoe = performance.now() + 3000;
    s.nextLux = performance.now() + 5200;
    s.nextRocket = performance.now() + 4300;
    s.nextTurret = performance.now() + 6200;
    s.spawnInterval = d.spawnInterval; s.projectileSpeed = d.projSpeed;
    s.luxInterval = 12800;
    s.rocketInterval = 7600;
    s.turretInterval = TURRET_BASE_INTERVAL;
    s.turretShotInterval = TURRET_SHOT_BASE_INTERVAL;
    s.aoeInterval = d.aoeInterval; s.nextEscalation = d.escalationInterval;
    setGamePhase('playing');
  }, []);

  const goToMenu = useCallback(() => { setGamePhase('menu'); }, []);

  // ── Input ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.style.touchAction = 'none';

    const wc = (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const { wx, wy } = projRef.current.screenToWorld(sx, sy);
      return { wx: clamp(wx, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS), wy: clamp(wy, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS) };
    };

    const onPointerDown = (e) => {
      unlockAudio();
      if (phaseRef.current === 'playing') setBgmMode('game');
      else setBgmMode('menu');

      if (e.button !== 2) return;
      e.preventDefault();
      const phase = phaseRef.current;
      if (phase === 'menu' || phase === 'dead') { startGame(); return; }
      const { wx, wy } = wc(e);
      const s = stateRef.current;
      rightHoldRef.current = { active: true, pointerId: e.pointerId };
      s.playerTarget = { wx, wy };
      s.ripples.push({ wx, wy, born: performance.now(), life: 600, maxR: 32 });
    };

    const onMove = (e) => {
      const { wx, wy } = wc(e);
      const s = stateRef.current;
      s.mouseWx = wx;
      s.mouseWy = wy;
      const hold = rightHoldRef.current;
      if (phaseRef.current === 'playing' && hold.active && hold.pointerId === e.pointerId) {
        s.playerTarget = { wx, wy };
      }
    };
    const onPointerUp = (e) => {
      const hold = rightHoldRef.current;
      if (hold.active && hold.pointerId === e.pointerId) {
        rightHoldRef.current = { active: false, pointerId: null };
      }
    };
    const onPointerCancel = () => {
      rightHoldRef.current = { active: false, pointerId: null };
    };
    const blockContextMenu = (e) => e.preventDefault();

    const onKey = (e) => {
      unlockAudio();
      if (phaseRef.current === 'playing') setBgmMode('game');
      else setBgmMode('menu');
      if (e.key === 'Escape') { e.preventDefault(); goToMenu(); return; }
      if (phaseRef.current === 'dead' && e.key === ' ') { e.preventDefault(); startGame(); return; }
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      if ((e.key === 'd' || e.key === 'D' || e.key === 'f' || e.key === 'F') && s.flashCooldownLeft <= 0) {
        const dx = s.mouseWx - s.player.wx, dy = s.mouseWy - s.player.wy, d = Math.hypot(dx, dy);
        if (d > 0) {
          const fd = Math.min(d, FLASH_RANGE);
          s.player.wx = clamp(s.player.wx + (dx / d) * fd, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
          s.player.wy = clamp(s.player.wy + (dy / d) * fd, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
        }
        playFlashSfx();
        s.flashCooldownLeft = RAMP_CONFIG.flashCd; s.playerTarget = null;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerCancel);
    canvas.addEventListener('contextmenu', blockContextMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerCancel);
      canvas.removeEventListener('contextmenu', blockContextMenu);
      window.removeEventListener('keydown', onKey);
    };
  }, [goToMenu, playFlashSfx, setBgmMode, startGame, unlockAudio]);

  // ── Game loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = (now) => {
      const canvas = canvasRef.current; if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const s = stateRef.current;
      const dt = Math.min((now - s.lastTime) / 1000, 0.05);
      s.lastTime = now;

      if (phaseRef.current === 'playing') {
        s.elapsed += dt; s.score = s.elapsed;
        if (s.score > s.highScore) s.highScore = s.score;
        const d = RAMP_CONFIG;

        if (s.elapsed >= s.nextEscalation) {
          s.nextEscalation += d.escalationInterval;
          s.projectileSpeed += d.speedInc;
          s.spawnInterval = Math.max(d.minSpawn, s.spawnInterval - d.spawnDec);
          s.aoeInterval = Math.max(1800, s.aoeInterval - 180);
          s.luxInterval = Math.max(7600, s.luxInterval - 220);
          s.rocketInterval = Math.max(4300, s.rocketInterval - 150);
          s.turretInterval = Math.max(TURRET_MIN_INTERVAL, s.turretInterval - TURRET_INTERVAL_DECAY);
          s.turretShotInterval = Math.max(TURRET_SHOT_MIN_INTERVAL, s.turretShotInterval - TURRET_SHOT_DECAY);
        }

        if (s.flashCooldownLeft > 0) s.flashCooldownLeft = Math.max(0, s.flashCooldownLeft - dt);

        if (s.playerTarget) {
          const dx = s.playerTarget.wx - s.player.wx, dy = s.playerTarget.wy - s.player.wy, dd = Math.hypot(dx, dy), step = PLAYER_SPEED * dt;
          if (dd < ARRIVAL_THRESHOLD || dd < step) { s.player.wx = s.playerTarget.wx; s.player.wy = s.playerTarget.wy; s.playerTarget = null; }
          else { s.player.wx += (dx / dd) * step; s.player.wy += (dy / dd) * step; }
          s.player.wx = clamp(s.player.wx, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
          s.player.wy = clamp(s.player.wy, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
        }

        if (now >= s.nextSpawn) {
          s.nextSpawn = now + s.spawnInterval + (Math.random() - 0.5) * 200;
          const cnt = 1 + Math.floor(Math.random() * Math.min(3, 1 + s.elapsed / 25));
          for (let i = 0; i < cnt; i++) s.projectiles.push(spawnProjectile(s.player.wx, s.player.wy, s.projectileSpeed));
        }

        if (now >= s.nextAoe) {
          s.nextAoe = now + s.aoeInterval + (Math.random() - 0.5) * 800;
          s.aoes.push(spawnAoE(s.player.wx, s.player.wy));
        }

        if (now >= s.nextLux) {
          s.nextLux = now + s.luxInterval + (Math.random() - 0.5) * 900;
          const beam = spawnLuxBeam(now);
          s.luxBeams.push(beam);
        }

        if (now >= s.nextRocket) {
          s.nextRocket = now + s.rocketInterval + (Math.random() - 0.5) * 800;
          const rocketSpeed = Math.max(ROCKET_BASE_SPEED, s.projectileSpeed * 1.65);
          const rocket = spawnRocket(now, rocketSpeed);
          s.rockets.push(rocket);
          s.warnings.push({ type: 'rocket', side: rocket.side, lanePos: rocket.lanePos, born: now, life: ROCKET_WARNING_MS });
          playWarningSfx(now);
        }

        if (!s.turret && now >= s.nextTurret) {
          s.turret = spawnTurret(now, s.turretShotInterval);
          s.nextTurret = now + s.turretInterval + (Math.random() - 0.5) * 700;
        }

        if (s.turret) {
          if (now >= s.turret.despawnAt) {
            s.turret = null;
          } else if (now < s.turret.activeAt) {
            const p = clamp((now - s.turret.born) / TURRET_FALL_MS, 0, 1);
            s.turret.wy = -220 + (s.turret.targetWy + 220) * p;
          } else if (now >= s.turret.nextShotAt) {
            const dx = s.player.wx - s.turret.wx;
            const dy = s.player.wy - s.turret.wy;
            const len = Math.max(1, Math.hypot(dx, dy));
            const shotSpeed = Math.max(TURRET_SHOT_SPEED, s.projectileSpeed * 1.3);
            s.turretShots.push({
              wx: s.turret.wx,
              wy: s.turret.wy,
              vx: (dx / len) * shotSpeed,
              vy: (dy / len) * shotSpeed,
              r: TURRET_SHOT_RADIUS,
            });
            s.turret.nextShotAt = now + s.turretShotInterval + (Math.random() - 0.5) * 70;
          }
        }

        s.turretShots = s.turretShots.filter((shot) => {
          shot.wx += shot.vx * dt;
          shot.wy += shot.vy * dt;
          if (shot.wx < -PROJECTILE_DESPAWN_MARGIN || shot.wx > WORLD_W + PROJECTILE_DESPAWN_MARGIN || shot.wy < -PROJECTILE_DESPAWN_MARGIN || shot.wy > WORLD_H + PROJECTILE_DESPAWN_MARGIN) {
            return false;
          }
          if (circleCircle(s.player.wx, s.player.wy, PLAYER_HITBOX_RADIUS, shot.wx, shot.wy, shot.r)) {
            s.playerHP -= Math.max(10, Math.round(d.projDmg * 0.55));
            playDamageSfx();
            if (s.playerHP <= 0) { s.playerHP = 0; setGamePhase('dead'); }
            return false;
          }
          return true;
        });

        s.luxBeams = s.luxBeams.filter((beam) => {
          if (now > beam.fireUntil) return false;
          if (now >= beam.warnUntil && !beam.firedSfx) {
            beam.firedSfx = true;
            playLuxSfx();
          }
          if (now >= beam.warnUntil && !beam.hitApplied) {
            const inBeam = beam.vertical
              ? Math.abs(s.player.wx - beam.linePos) <= LUX_BEAM_HALF_W
              : Math.abs(s.player.wy - beam.linePos) <= LUX_BEAM_HALF_W;
            if (inBeam) {
              s.playerHP -= Math.max(32, Math.round(d.projDmg * 1.8));
              playDamageSfx();
              beam.hitApplied = true;
              if (s.playerHP <= 0) { s.playerHP = 0; setGamePhase('dead'); }
            }
          }
          return true;
        });

        s.rockets = s.rockets.filter((rk) => {
          if (now < rk.warnUntil) return true;
          if (!rk.started) {
            rk.started = true;
            playRocketSfx();
          }
          rk.wx += rk.vx * dt;
          rk.wy += rk.vy * dt;

          if (rk.wx < -ROCKET_DESPAWN_MARGIN || rk.wx > WORLD_W + ROCKET_DESPAWN_MARGIN || rk.wy < -ROCKET_DESPAWN_MARGIN || rk.wy > WORLD_H + ROCKET_DESPAWN_MARGIN) {
            return false;
          }

          if (circleCircle(s.player.wx, s.player.wy, PLAYER_HITBOX_RADIUS, rk.wx, rk.wy, rk.r)) {
            s.playerHP -= Math.max(35, Math.round(d.projDmg * 1.6));
            playDamageSfx();
            for (let k = 0; k < 10; k++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 80 + Math.random() * 120;
              s.particles.push({ wx: rk.wx, wy: rk.wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, life: 380 + Math.random() * 180, r: 2 + Math.random() * 4, color: '255,165,80' });
            }
            if (s.playerHP <= 0) { s.playerHP = 0; setGamePhase('dead'); }
            return false;
          }
          return true;
        });

        const margin = PROJECTILE_DESPAWN_MARGIN;
        const projHitR = Math.max(PROJECTILE_W, PROJECTILE_H) * 0.14;
        s.projectiles = s.projectiles.filter(p => {
          p.wx += p.vx * dt; p.wy += p.vy * dt;
          if (p.wx < -margin || p.wx > WORLD_W + margin || p.wy < -margin || p.wy > WORLD_H + margin) return false;
          const dToPlayer = dist(s.player.wx, s.player.wy, p.wx, p.wy);
          if (dToPlayer < PROJECTILE_NEAR_RADIUS && dToPlayer > PLAYER_HITBOX_RADIUS + projHitR + 2) {
            playNearLaserSfx(now);
          }
          if (circleCircle(s.player.wx, s.player.wy, PLAYER_HITBOX_RADIUS, p.wx, p.wy, projHitR)) {
            s.playerHP -= d.projDmg;
            playDamageSfx();
            for (let k = 0; k < 6; k++) {
              const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
              s.particles.push({ wx: p.wx, wy: p.wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, life: 350 + Math.random() * 200, r: 2 + Math.random() * 3, color: '255,120,40' });
            }
            if (s.playerHP <= 0) { s.playerHP = 0; setGamePhase('dead'); }
            return false;
          }
          return true;
        });

        s.aoes = s.aoes.filter(aoe => {
          if (aoe.showExplosion) { aoe.explosionLife += dt * 1000; return aoe.explosionLife <= 400; }
          if (!aoe.exploded && now - aoe.born >= aoe.explodeTime) {
            aoe.exploded = true; aoe.showExplosion = true; aoe.explosionLife = 0;
            if (dist(s.player.wx, s.player.wy, aoe.wx, aoe.wy) < aoe.radius + PLAYER_HITBOX_RADIUS) {
              s.playerHP -= d.aoeDmg;
              playDamageSfx();
              for (let k = 0; k < 10; k++) {
                const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 100;
                s.particles.push({ wx: aoe.wx + Math.cos(a) * 20, wy: aoe.wy + Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, life: 400 + Math.random() * 250, r: 3 + Math.random() * 4, color: '255,80,30' });
              }
              if (s.playerHP <= 0) { s.playerHP = 0; setGamePhase('dead'); }
            }
          }
          return true;
        });

        s.particles = s.particles.filter(pt => { pt.wx += pt.vx * dt; pt.wy += pt.vy * dt; pt.vx *= 0.96; pt.vy *= 0.96; return now - pt.born < pt.life; });
        s.ripples = s.ripples.filter(r => now - r.born < r.life);
        s.warnings = s.warnings.filter(w => now - w.born < w.life);
      }

      draw(ctx, s, now);
      rafRef.current = requestAnimationFrame(loop);
    };
    stateRef.current.lastTime = performance.now();
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw, playDamageSfx, playLuxSfx, playNearLaserSfx, playRocketSfx, playWarningSfx]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <a
        href="https://mario-belmonte.com/games"
        className="fixed top-3 left-3 z-50 inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl min-w-[165px] sm:min-w-[185px] whitespace-nowrap
                   border border-cyan-300/30 bg-gradient-to-b from-slate-800/85 to-slate-950/85
                   text-slate-100 text-sm sm:text-base font-semibold tracking-wide
                   shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md no-underline
                   transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-200/55 hover:shadow-[0_10px_28px_rgba(56,189,248,0.25)]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/65 active:translate-y-0"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to Games
      </a>
      <canvas ref={canvasRef} className="block w-full h-full" style={{ cursor: "url('/cursor.svg') 20 20, crosshair" }} />
      <audio ref={gameAudioRef} src="/Wind_Wall_Panic.mp3" loop preload="auto" playsInline />
      <div
        onContextMenu={e => e.preventDefault()}
        style={{
          position: 'fixed', bottom: '16px', right: '16px', zIndex: 50,
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'rgba(8,8,24,0.78)', border: '1px solid rgba(80,140,255,0.28)',
          borderRadius: '10px', padding: '6px 12px', backdropFilter: 'blur(10px)',
        }}
      >
        <span style={{ fontSize: '13px', color: '#7799cc', userSelect: 'none' }}>♪</span>
        <input
          type="range" min="0" max="1" step="0.01"
          value={musicVolume}
          onChange={e => setMusicVolume(parseFloat(e.target.value))}
          style={{ width: '80px', accentColor: '#4fc3f7', cursor: 'pointer', verticalAlign: 'middle' }}
        />
      </div>
    </div>
  );
}

function randomDirection() {
  const dirs = ['top', 'right', 'bottom', 'left'];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function spawnLuxBeam(now) {
  const side = randomDirection();
  const vertical = side === 'top' || side === 'bottom';
  const linePos = vertical
    ? 110 + Math.random() * (WORLD_W - 220)
    : 110 + Math.random() * (WORLD_H - 220);
  return {
    side,
    vertical,
    linePos,
    born: now,
    warnUntil: now + LUX_WARNING_MS,
    fireUntil: now + LUX_WARNING_MS + LUX_ACTIVE_MS,
    firedSfx: false,
    hitApplied: false,
  };
}

function spawnRocket(now, speed) {
  const side = randomDirection();
  const m = PROJECTILE_SPAWN_MARGIN;
  if (side === 'top') {
    const lanePos = 70 + Math.random() * (WORLD_W - 140);
    return { side, lanePos, wx: lanePos, wy: -m, vx: 0, vy: speed, r: ROCKET_RADIUS, warnUntil: now + ROCKET_WARNING_MS, started: false };
  }
  if (side === 'right') {
    const lanePos = 70 + Math.random() * (WORLD_H - 140);
    return { side, lanePos, wx: WORLD_W + m, wy: lanePos, vx: -speed, vy: 0, r: ROCKET_RADIUS, warnUntil: now + ROCKET_WARNING_MS, started: false };
  }
  if (side === 'bottom') {
    const lanePos = 70 + Math.random() * (WORLD_W - 140);
    return { side, lanePos, wx: lanePos, wy: WORLD_H + m, vx: 0, vy: -speed, r: ROCKET_RADIUS, warnUntil: now + ROCKET_WARNING_MS, started: false };
  }
  const lanePos = 70 + Math.random() * (WORLD_H - 140);
  return { side, lanePos, wx: -m, wy: lanePos, vx: speed, vy: 0, r: ROCKET_RADIUS, warnUntil: now + ROCKET_WARNING_MS, started: false };
}

function spawnTurret(now, shotInterval) {
  const wx = 100 + Math.random() * (WORLD_W - 200);
  const targetWy = 100 + Math.random() * (WORLD_H - 200);
  return {
    wx,
    wy: -220,
    targetWy,
    born: now,
    activeAt: now + TURRET_FALL_MS,
    despawnAt: now + TURRET_LIFE_MS,
    nextShotAt: now + TURRET_FALL_MS + 220,
    shotInterval,
  };
}