import { useEffect, useRef, useCallback } from 'react';

// ─── Canvas & World constants ─────────────────────────────────────────────────
const CANVAS_W = 960;
const CANVAS_H = 640;

// The "game world" is a square grid. All gameplay logic runs in world coords.
const WORLD_W = 800;
const WORLD_H = 800;

// ─── Isometric projection ─────────────────────────────────────────────────────
// Standard cabinet iso: x-axis goes right-down, y-axis goes left-down.
// We project world (wx, wy) → screen (sx, sy).
const ISO_SCALE_X = 0.866; // cos(30°)
const ISO_SCALE_Y = 0.5;   // sin(30°)
const ISO_TILE   = 60;     // logical tile size in world coords
const ORIGIN_X = CANVAS_W / 2; // screen origin
const ORIGIN_Y = 80;           // screen origin (top of iso diamond)

function worldToScreen(wx, wy) {
  // centre world on origin
  const ox = wx - WORLD_W / 2;
  const oy = wy - WORLD_H / 2;
  const sx = ORIGIN_X + (ox - oy) * ISO_SCALE_X;
  const sy = ORIGIN_Y + (ox + oy) * ISO_SCALE_Y;
  return { sx, sy };
}

function screenToWorld(sx, sy) {
  // Inverse of worldToScreen
  const rx = sx - ORIGIN_X;
  const ry = sy - ORIGIN_Y;
  // rx =  (ox - oy) * ISO_SCALE_X
  // ry =  (ox + oy) * ISO_SCALE_Y
  const ox = rx / (2 * ISO_SCALE_X) + ry / (2 * ISO_SCALE_Y);
  const oy = ry / (2 * ISO_SCALE_Y) - rx / (2 * ISO_SCALE_X);
  return { wx: ox + WORLD_W / 2, wy: oy + WORLD_H / 2 };
}

// ─── Game constants ───────────────────────────────────────────────────────────
const PLAYER_RADIUS = 18;
const PLAYER_HITBOX_RADIUS = 13;
const PLAYER_SPEED = 250; // world-units/s
const FLASH_RANGE = 220;
const FLASH_COOLDOWN = 15; // seconds (gameplay)
const FLASH_VISUAL_COOLDOWN = 300; // shown in UI

const BASE_SPAWN_INTERVAL = 1400; // ms
const BASE_PROJECTILE_SPEED = 200; // world-units/s
const PROJECTILE_W = 14;
const PROJECTILE_H = 44;

const AOE_RADIUS = 60;
const AOE_DELAY = 1500; // ms

const ESCALATION_INTERVAL = 10; // seconds
const SPEED_INCREMENT = 25;
const SPAWN_INTERVAL_DECREMENT = 80;
const MIN_SPAWN_INTERVAL = 300;

const ARRIVAL_THRESHOLD = 4;

// ─── Helper functions ─────────────────────────────────────────────────────────
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Circle vs oriented rectangle in 2-D world space (OBB check via axis projection)
function circleOBB(cx, cy, cr, px, py, halfW, halfH, angle) {
  // Transform circle centre to OBB local space
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = cx - px;
  const dy = cy - py;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const nearX = clamp(lx, -halfW, halfW);
  const nearY = clamp(ly, -halfH, halfH);
  return Math.hypot(lx - nearX, ly - nearY) < cr;
}

// Spawn projectile from a world-space edge aimed at (tx, ty)
function spawnProjectile(tx, ty, speed) {
  const edge = Math.floor(Math.random() * 4);
  const m = PROJECTILE_H;
  let wx, wy;
  switch (edge) {
    case 0: wx = Math.random() * WORLD_W; wy = -m; break;
    case 1: wx = WORLD_W + m; wy = Math.random() * WORLD_H; break;
    case 2: wx = Math.random() * WORLD_W; wy = WORLD_H + m; break;
    default: wx = -m; wy = Math.random() * WORLD_H; break;
  }
  const angle = Math.atan2(ty - wy, tx - wx);
  return {
    type: 'linear',
    wx, wy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    w: PROJECTILE_W,
    h: PROJECTILE_H,
  };
}

// Spawn AoE near player in world space
function spawnAoE(tx, ty) {
  const angle = Math.random() * Math.PI * 2;
  const r = 80 + Math.random() * 200;
  return {
    type: 'aoe',
    wx: clamp(tx + Math.cos(angle) * r, AOE_RADIUS, WORLD_W - AOE_RADIUS),
    wy: clamp(ty + Math.sin(angle) * r, AOE_RADIUS, WORLD_H - AOE_RADIUS),
    radius: AOE_RADIUS,
    born: performance.now(),
    exploded: false,
    explodeTime: AOE_DELAY,
    showExplosion: false,
    explosionLife: 0,
  };
}

// ─── Isometric drawing helpers ────────────────────────────────────────────────

// Draw an iso ellipse (circle projected onto iso plane)
function isoCircle(ctx, wx, wy, r) {
  const { sx, sy } = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, ISO_SCALE_Y / ISO_SCALE_X * 0.6); // flatten to look like ground
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.restore();
}

// Draw iso flat ring (stroke only)
function isoCircleStroke(ctx, wx, wy, r, color, lw) {
  const { sx, sy } = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, 0.35);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Draw iso partial arc (for progress indicators)
function isoArcStroke(ctx, wx, wy, r, startAngle, endAngle, color, lw) {
  const { sx, sy } = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, 0.35);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, r, startAngle, endAngle);
  ctx.stroke();
  ctx.restore();
}

// Draw iso filled ellipse
function isoCircleFill(ctx, wx, wy, r, color) {
  const { sx, sy } = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, 0.35);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function DodgeGame() {
  const canvasRef = useRef(null);

  // All mutable game state in a single ref (avoids stale closures in rAF)
  const stateRef = useRef({
    player: { wx: WORLD_W / 2, wy: WORLD_H / 2 },
    playerTarget: null,
    playerHP: 100,

    flashCooldownLeft: 0,
    mouseWx: WORLD_W / 2,
    mouseWy: WORLD_H / 2,

    projectiles: [],
    aoes: [],
    ripples: [],

    alive: false,
    started: false,
    score: 0,
    highScore: 0,
    lastTime: 0,
    elapsed: 0,

    nextSpawn: 0,
    spawnInterval: BASE_SPAWN_INTERVAL,
    projectileSpeed: BASE_PROJECTILE_SPEED,
    nextAoe: 0,
    aoeInterval: 4000,
    nextEscalation: ESCALATION_INTERVAL,
  });

  const rafRef = useRef(null);

  // ── Drawing ──────────────────────────────────────────────────────────────────
  const draw = useCallback((ctx, state, now) => {
    const { player, projectiles, aoes, ripples, flashCooldownLeft, alive, started } = state;

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // ── Isometric grid ──────────────────────────────────────────────────────
    const tiles = Math.ceil(WORLD_W / ISO_TILE);
    ctx.strokeStyle = 'rgba(100,120,200,0.12)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= tiles; gx++) {
      const wx = gx * ISO_TILE;
      const { sx: sx0, sy: sy0 } = worldToScreen(wx, 0);
      const { sx: sx1, sy: sy1 } = worldToScreen(wx, WORLD_H);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }
    for (let gy = 0; gy <= tiles; gy++) {
      const wy = gy * ISO_TILE;
      const { sx: sx0, sy: sy0 } = worldToScreen(0, wy);
      const { sx: sx1, sy: sy1 } = worldToScreen(WORLD_W, wy);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }

    // ── Arena border diamond ────────────────────────────────────────────────
    const corners = [
      worldToScreen(0, 0),
      worldToScreen(WORLD_W, 0),
      worldToScreen(WORLD_W, WORLD_H),
      worldToScreen(0, WORLD_H),
    ];
    ctx.strokeStyle = 'rgba(100,160,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(corners[0].sx, corners[0].sy);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
    ctx.closePath();
    ctx.stroke();

    if (!started) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#cddaff';
      ctx.font = 'bold 44px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('DODGE GAME', CANVAS_W / 2, CANVAS_H / 2 - 60);
      ctx.font = '20px Arial';
      ctx.fillStyle = '#8899bb';
      ctx.fillText('Right-click to move · D/F to Flash', CANVAS_W / 2, CANVAS_H / 2 - 8);
      ctx.fillText('Avoid all incoming skillshots', CANVAS_W / 2, CANVAS_H / 2 + 22);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = 'bold 22px Arial';
      ctx.fillText('Right-click anywhere to START', CANVAS_W / 2, CANVAS_H / 2 + 72);
      ctx.textAlign = 'left';
      return;
    }

    if (!alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#ff5252';
      ctx.font = 'bold 50px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - 60);
      ctx.fillStyle = '#cddaff';
      ctx.font = '24px Arial';
      ctx.fillText(`Score: ${state.score.toFixed(1)}s`, CANVAS_W / 2, CANVAS_H / 2);
      ctx.fillText(`Best: ${state.highScore.toFixed(1)}s`, CANVAS_W / 2, CANVAS_H / 2 + 36);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = 'bold 20px Arial';
      ctx.fillText('Right-click to play again', CANVAS_W / 2, CANVAS_H / 2 + 92);
      ctx.textAlign = 'left';
      return;
    }

    // ── Ripples (move indicators) ───────────────────────────────────────────
    for (const rip of ripples) {
      const age = (now - rip.born) / rip.life;
      if (age >= 1) continue;
      const r = rip.maxR * age;
      const alpha = 0.55 * (1 - age);
      isoCircleStroke(ctx, rip.wx, rip.wy, r, `rgba(79,195,247,${alpha.toFixed(3)})`, 2);
    }

    // ── AoE indicators ──────────────────────────────────────────────────────
    for (const aoe of aoes) {
      const ageMs = now - aoe.born;
      const progress = Math.min(ageMs / aoe.explodeTime, 1);

      if (aoe.showExplosion) {
        const eAge = aoe.explosionLife;
        const alpha = Math.max(0, 1 - eAge / 320).toFixed(3);
        isoCircleFill(ctx, aoe.wx, aoe.wy, aoe.radius * (1 + eAge / 160), `rgba(255,100,0,${alpha})`);
        isoCircleStroke(ctx, aoe.wx, aoe.wy, aoe.radius * (1.2 + eAge / 120), `rgba(255,200,0,${alpha})`, 3);
      } else {
        // Ground shadow / fill
        isoCircleFill(ctx, aoe.wx, aoe.wy, aoe.radius, `rgba(255,60,60,${(0.06 + 0.10 * progress).toFixed(3)})`);
        // Outer ring
        isoCircleStroke(ctx, aoe.wx, aoe.wy, aoe.radius, `rgba(255,80,80,${(0.35 + 0.45 * progress).toFixed(3)})`, 3);
        // Progress arc
        isoArcStroke(ctx, aoe.wx, aoe.wy, aoe.radius - 7,
          -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress,
          'rgba(255,40,40,0.95)', 4);
      }
    }

    // ── Linear projectiles ──────────────────────────────────────────────────
    for (const proj of projectiles) {
      const { sx, sy } = worldToScreen(proj.wx, proj.wy);
      // The iso projection distorts the movement direction visually.
      // We compute the screen-space angle from velocity projected to screen.
      const { sx: sx2, sy: sy2 } = worldToScreen(proj.wx + proj.vx * 0.05, proj.wy + proj.vy * 0.05);
      const screenAngle = Math.atan2(sy2 - sy, sx2 - sx);

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(screenAngle - Math.PI / 2);
      // Flatten on y axis to mimic iso
      ctx.scale(1, 0.55);

      const H = proj.h;
      const W = proj.w;
      const grad = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
      grad.addColorStop(0,   'rgba(255,70,70,0.95)');
      grad.addColorStop(0.45,'rgba(255,140,30,1)');
      grad.addColorStop(1,   'rgba(255,70,70,0.25)');
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(255,100,0,0.9)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.roundRect(-W / 2, -H / 2, W, H, 5);
      ctx.fill();
      ctx.restore();
    }

    // ── Player shadow ───────────────────────────────────────────────────────
    isoCircleFill(ctx, player.wx, player.wy, PLAYER_RADIUS * 1.1, 'rgba(0,0,0,0.4)');

    // ── Player body ─────────────────────────────────────────────────────────
    const { sx: psx, sy: psy } = worldToScreen(player.wx, player.wy);

    // Outer glow
    const glow = ctx.createRadialGradient(psx, psy, 0, psx, psy, PLAYER_RADIUS * 2.2);
    glow.addColorStop(0, 'rgba(79,195,247,0.30)');
    glow.addColorStop(1, 'rgba(79,195,247,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(psx, psy, PLAYER_RADIUS * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Isometric "cylinder" body — draw as an iso ellipse + vertical rect cap
    const bodyRx = PLAYER_RADIUS;
    const bodyRy = PLAYER_RADIUS * 0.38; // iso vertical compression
    const bodyH  = PLAYER_RADIUS * 0.8;  // height of cylinder shaft

    // Cylinder shaft (sides)
    const bodyGradV = ctx.createLinearGradient(psx - bodyRx, psy, psx + bodyRx, psy);
    bodyGradV.addColorStop(0, '#0277bd');
    bodyGradV.addColorStop(0.4, '#81d4fa');
    bodyGradV.addColorStop(1, '#0277bd');
    ctx.fillStyle = bodyGradV;
    ctx.beginPath();
    ctx.ellipse(psx, psy + bodyH / 2, bodyRx, bodyRy, 0, 0, Math.PI); // bottom half-ellipse
    ctx.lineTo(psx - bodyRx, psy - bodyH / 2);
    ctx.ellipse(psx, psy - bodyH / 2, bodyRx, bodyRy, 0, Math.PI, 0); // top half-ellipse
    ctx.closePath();
    ctx.fill();

    // Top cap
    const topGrad = ctx.createRadialGradient(psx - 3, psy - bodyH / 2 - 1, 1, psx, psy - bodyH / 2, bodyRx);
    topGrad.addColorStop(0, '#b3e5fc');
    topGrad.addColorStop(1, '#0288d1');
    ctx.fillStyle = topGrad;
    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(psx, psy - bodyH / 2, bodyRx, bodyRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ── HP bar ──────────────────────────────────────────────────────────────
    const barW = 44;
    const barH = 5;
    const barX = psx - barW / 2;
    const barY = psy - PLAYER_RADIUS - bodyH - 14;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = '#222';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = state.playerHP > 50 ? '#4caf50' : state.playerHP > 25 ? '#ff9800' : '#f44336';
    ctx.fillRect(barX, barY, barW * (state.playerHP / 100), barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // ── Flash cooldown ring ─────────────────────────────────────────────────
    if (flashCooldownLeft > 0) {
      const cdProg = 1 - flashCooldownLeft / FLASH_COOLDOWN;
      ctx.strokeStyle = 'rgba(180,140,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(psx, psy, bodyRx + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdProg);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(200,170,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(psx, psy, bodyRx + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── HUD panel ───────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 190, 60, 6);
    ctx.fill();
    ctx.fillStyle = '#cddaff';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Time: ${state.score.toFixed(1)}s`, 18, 30);
    ctx.fillText(`Best: ${state.highScore.toFixed(1)}s`, 18, 52);

    // Flash skill button
    const flashReady = flashCooldownLeft <= 0;
    ctx.fillStyle = flashReady ? 'rgba(140,100,255,0.9)' : 'rgba(40,40,60,0.9)';
    ctx.beginPath();
    ctx.roundRect(CANVAS_W - 84, 8, 76, 46, 6);
    ctx.fill();
    ctx.strokeStyle = flashReady ? 'rgba(200,170,255,0.8)' : 'rgba(80,80,100,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = flashReady ? '#fff' : '#666';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[D / F]', CANVAS_W - 46, 27);
    ctx.font = '11px monospace';
    ctx.fillText(
      flashReady ? 'FLASH ⚡' : `${Math.ceil(flashCooldownLeft * (FLASH_VISUAL_COOLDOWN / FLASH_COOLDOWN))}s`,
      CANVAS_W - 46, 44
    );
    ctx.textAlign = 'left';
  }, []);

  // ── Start / Restart ────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const state = stateRef.current;
    state.player = { wx: WORLD_W / 2, wy: WORLD_H / 2 };
    state.playerTarget = null;
    state.playerHP = 100;
    state.flashCooldownLeft = 0;
    state.projectiles = [];
    state.aoes = [];
    state.ripples = [];
    state.alive = true;
    state.started = true;
    state.score = 0;
    state.elapsed = 0;
    state.lastTime = performance.now();
    state.nextSpawn = performance.now() + 1000;
    state.nextAoe = performance.now() + 3000;
    state.spawnInterval = BASE_SPAWN_INTERVAL;
    state.projectileSpeed = BASE_PROJECTILE_SPEED;
    state.aoeInterval = 4000;
    state.nextEscalation = ESCALATION_INTERVAL;
  }, []);

  // ── Input handlers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getWorldCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const sx = (e.clientX - rect.left) * scaleX;
      const sy = (e.clientY - rect.top) * scaleY;
      const { wx, wy } = screenToWorld(sx, sy);
      return {
        wx: clamp(wx, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS),
        wy: clamp(wy, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS),
      };
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      const { wx, wy } = getWorldCoords(e);
      const state = stateRef.current;
      if (!state.started || !state.alive) {
        startGame();
        return;
      }
      state.playerTarget = { wx, wy };
      state.ripples.push({ wx, wy, born: performance.now(), life: 600, maxR: 30 });
    };

    const handleMouseMove = (e) => {
      const { wx, wy } = getWorldCoords(e);
      stateRef.current.mouseWx = wx;
      stateRef.current.mouseWy = wy;
    };

    const handleKeyDown = (e) => {
      const state = stateRef.current;
      if (!state.alive) return;
      if (e.key === 'd' || e.key === 'D' || e.key === 'f' || e.key === 'F') {
        if (state.flashCooldownLeft > 0) return;
        const dx = state.mouseWx - state.player.wx;
        const dy = state.mouseWy - state.player.wy;
        const d = Math.hypot(dx, dy);
        const flashDist = Math.min(d, FLASH_RANGE);
        if (d > 0) {
          state.player.wx = clamp(state.player.wx + (dx / d) * flashDist, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
          state.player.wy = clamp(state.player.wy + (dy / d) * flashDist, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
        }
        state.flashCooldownLeft = FLASH_COOLDOWN;
        state.playerTarget = null;
      }
    };

    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [startGame]);

  // ── Game loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const gameLoop = (now) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const state = stateRef.current;

      const dt = Math.min((now - state.lastTime) / 1000, 0.05);
      state.lastTime = now;

      if (state.alive) {
        state.elapsed += dt;
        state.score = state.elapsed;
        if (state.score > state.highScore) state.highScore = state.score;

        // Escalation
        if (state.elapsed >= state.nextEscalation) {
          state.nextEscalation += ESCALATION_INTERVAL;
          state.projectileSpeed += SPEED_INCREMENT;
          state.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, state.spawnInterval - SPAWN_INTERVAL_DECREMENT);
          state.aoeInterval = Math.max(2000, state.aoeInterval - 200);
        }

        // Flash cooldown
        if (state.flashCooldownLeft > 0) {
          state.flashCooldownLeft = Math.max(0, state.flashCooldownLeft - dt);
        }

        // Player movement
        if (state.playerTarget) {
          const { wx: tx, wy: ty } = state.playerTarget;
          const dx = tx - state.player.wx;
          const dy = ty - state.player.wy;
          const d = Math.hypot(dx, dy);
          if (d < ARRIVAL_THRESHOLD) {
            state.player.wx = tx;
            state.player.wy = ty;
            state.playerTarget = null;
          } else {
            const step = PLAYER_SPEED * dt;
            if (d < step) {
              state.player.wx = tx;
              state.player.wy = ty;
              state.playerTarget = null;
            } else {
              state.player.wx += (dx / d) * step;
              state.player.wy += (dy / d) * step;
            }
          }
          state.player.wx = clamp(state.player.wx, PLAYER_RADIUS, WORLD_W - PLAYER_RADIUS);
          state.player.wy = clamp(state.player.wy, PLAYER_RADIUS, WORLD_H - PLAYER_RADIUS);
        }

        // Spawn linear projectiles
        if (now >= state.nextSpawn) {
          state.nextSpawn = now + state.spawnInterval + (Math.random() - 0.5) * 200;
          const count = 1 + Math.floor(Math.random() * Math.min(3, 1 + state.elapsed / 20));
          for (let i = 0; i < count; i++) {
            state.projectiles.push(spawnProjectile(state.player.wx, state.player.wy, state.projectileSpeed));
          }
        }

        // Spawn AoEs
        if (now >= state.nextAoe) {
          state.nextAoe = now + state.aoeInterval + (Math.random() - 0.5) * 800;
          state.aoes.push(spawnAoE(state.player.wx, state.player.wy));
        }

        // Update & check projectile collisions
        const margin = 120;
        state.projectiles = state.projectiles.filter(proj => {
          proj.wx += proj.vx * dt;
          proj.wy += proj.vy * dt;
          if (
            proj.wx < -margin || proj.wx > WORLD_W + margin ||
            proj.wy < -margin || proj.wy > WORLD_H + margin
          ) return false;
          // OBB collision: proj is an oriented rectangle in world space
          if (circleOBB(
            state.player.wx, state.player.wy, PLAYER_HITBOX_RADIUS,
            proj.wx, proj.wy, proj.w / 2, proj.h / 2, proj.angle
          )) {
            state.playerHP -= 20;
            if (state.playerHP <= 0) state.alive = false;
            return false;
          }
          return true;
        });

        // Update & check AoE collisions
        state.aoes = state.aoes.filter(aoe => {
          if (aoe.showExplosion) {
            aoe.explosionLife += dt * 1000;
            return aoe.explosionLife <= 380;
          }
          const ageMs = now - aoe.born;
          if (!aoe.exploded && ageMs >= aoe.explodeTime) {
            aoe.exploded = true;
            aoe.showExplosion = true;
            aoe.explosionLife = 0;
            if (dist(state.player.wx, state.player.wy, aoe.wx, aoe.wy) < aoe.radius + PLAYER_HITBOX_RADIUS) {
              state.playerHP -= 35;
              if (state.playerHP <= 0) state.alive = false;
            }
          }
          return true;
        });

        // Clean up expired ripples
        state.ripples = state.ripples.filter(r => now - r.born < r.life);
      }

      draw(ctx, state, now);
      rafRef.current = requestAnimationFrame(gameLoop);
    };

    stateRef.current.lastTime = performance.now();
    rafRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 select-none">
      <div className="mb-3 text-center">
        <h1 className="text-3xl font-bold text-blue-300 tracking-wider">
          ⚡ DodgeLoL
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Right-click to move · <kbd className="bg-gray-700 text-gray-200 px-1 rounded">D</kbd>/<kbd className="bg-gray-700 text-gray-200 px-1 rounded">F</kbd> to Flash
        </p>
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="border-2 border-blue-900 rounded-lg cursor-crosshair"
        style={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain' }}
      />

      <div className="mt-3 text-gray-500 text-xs text-center max-w-lg">
        Dodge all incoming skillshots · Difficulty escalates every 10 seconds · Flash (D/F) has a 15s cooldown
      </div>
    </div>
  );
}
