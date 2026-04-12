import { useEffect, useRef, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
const CANVAS_W = 900;
const CANVAS_H = 600;
const PLAYER_RADIUS = 18;
const PLAYER_HITBOX_RADIUS = 13; // smaller than visual for fairness
const PLAYER_SPEED = 220; // px/s
const FLASH_RANGE = 200;
const FLASH_COOLDOWN = 15; // seconds (gameplay)
const FLASH_VISUAL_COOLDOWN = 300; // seconds shown in UI

const BASE_SPAWN_INTERVAL = 1400; // ms
const BASE_PROJECTILE_SPEED = 180; // px/s
const PROJECTILE_W = 14;
const PROJECTILE_H = 40;

const AOE_RADIUS = 55;
const AOE_DELAY = 1500; // ms

const ESCALATION_INTERVAL = 10; // seconds
const SPEED_INCREMENT = 25;
const SPAWN_INTERVAL_DECREMENT = 80;
const MIN_SPAWN_INTERVAL = 300;

const GRID_SIZE = 60;
const ARRIVAL_THRESHOLD = 5;

// ─── Helper functions ─────────────────────────────────────────────────────────
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Circle vs Rectangle (axis-aligned) collision
function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nearX = clamp(cx, rx, rx + rw);
  const nearY = clamp(cy, ry, ry + rh);
  return dist(cx, cy, nearX, nearY) < cr;
}

// Spawn a linear projectile from a random canvas edge aimed at (tx, ty)
function spawnProjectile(tx, ty, speed) {
  const edge = Math.floor(Math.random() * 4); // 0=top,1=right,2=bottom,3=left
  let x, y;
  switch (edge) {
    case 0: x = Math.random() * CANVAS_W; y = -PROJECTILE_W; break;
    case 1: x = CANVAS_W + PROJECTILE_W; y = Math.random() * CANVAS_H; break;
    case 2: x = Math.random() * CANVAS_W; y = CANVAS_H + PROJECTILE_W; break;
    default: x = -PROJECTILE_W; y = Math.random() * CANVAS_H; break;
  }
  const angle = Math.atan2(ty - y, tx - x);
  return {
    type: 'linear',
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    w: PROJECTILE_W,
    h: PROJECTILE_H,
  };
}

// Spawn a circular AoE at a random canvas position
function spawnAoE(tx, ty) {
  // near player but not on top
  const angle = Math.random() * Math.PI * 2;
  const r = 60 + Math.random() * 180;
  return {
    type: 'aoe',
    x: clamp(tx + Math.cos(angle) * r, AOE_RADIUS, CANVAS_W - AOE_RADIUS),
    y: clamp(ty + Math.sin(angle) * r, AOE_RADIUS, CANVAS_H - AOE_RADIUS),
    radius: AOE_RADIUS,
    born: performance.now(),
    exploded: false,
    explodeTime: AOE_DELAY,
    showExplosion: false,
    explosionLife: 0,
  };
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function DodgeGame() {
  const canvasRef = useRef(null);

  // All mutable game state in a single ref (avoids stale closures in rAF)
  const stateRef = useRef({
    // Player
    player: { x: CANVAS_W / 2, y: CANVAS_H / 2 },
    playerVx: 0,
    playerVy: 0,
    playerTarget: null,
    playerHP: 100,

    // Flash
    flashCooldownLeft: 0, // seconds
    mouseX: CANVAS_W / 2,
    mouseY: CANVAS_H / 2,

    // Projectiles
    projectiles: [],
    aoes: [],

    // Ripples
    ripples: [],

    // Game meta
    alive: false,
    started: false,
    score: 0,         // time survived (seconds)
    highScore: 0,
    lastTime: 0,
    elapsed: 0,       // seconds since start

    // Spawning
    nextSpawn: 0,
    spawnInterval: BASE_SPAWN_INTERVAL,
    projectileSpeed: BASE_PROJECTILE_SPEED,
    nextAoe: 0,
    aoeInterval: 4000, // ms
    nextEscalation: ESCALATION_INTERVAL,
  });

  const rafRef = useRef(null);

  // ── Drawing ──────────────────────────────────────────────────────────────────
  const draw = useCallback((ctx, state, now) => {
    const { player, projectiles, aoes, ripples, flashCooldownLeft, alive, started } = state;

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += GRID_SIZE) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y < CANVAS_H; y += GRID_SIZE) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    if (!started) {
      // Start screen
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#e0e0ff';
      ctx.font = 'bold 42px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('DODGE GAME', CANVAS_W / 2, CANVAS_H / 2 - 60);
      ctx.font = '20px Arial';
      ctx.fillStyle = '#aaaacc';
      ctx.fillText('Right-click to move · D/F to Flash', CANVAS_W / 2, CANVAS_H / 2 - 10);
      ctx.fillText('Avoid all incoming skillshots', CANVAS_W / 2, CANVAS_H / 2 + 20);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = 'bold 22px Arial';
      ctx.fillText('Right-click anywhere to START', CANVAS_W / 2, CANVAS_H / 2 + 70);
      ctx.textAlign = 'left';
      return;
    }

    if (!alive) {
      // Game over screen
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#ff5252';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', CANVAS_W / 2, CANVAS_H / 2 - 60);
      ctx.fillStyle = '#e0e0ff';
      ctx.font = '24px Arial';
      ctx.fillText(`Score: ${state.score.toFixed(1)}s`, CANVAS_W / 2, CANVAS_H / 2);
      ctx.fillText(`Best: ${state.highScore.toFixed(1)}s`, CANVAS_W / 2, CANVAS_H / 2 + 36);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = 'bold 20px Arial';
      ctx.fillText('Right-click to play again', CANVAS_W / 2, CANVAS_H / 2 + 90);
      ctx.textAlign = 'left';
      return;
    }

    // ── Ripples ────────────────────────────────────────────────────────────────
    for (const rip of ripples) {
      const age = (now - rip.born) / rip.life;
      if (age >= 1) continue;
      const r = rip.maxR * age;
      const alpha = 0.6 * (1 - age);
      ctx.strokeStyle = `rgba(79,195,247,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── AoE indicators ─────────────────────────────────────────────────────────
    for (const aoe of aoes) {
      const elapsed = now - aoe.born;
      const progress = Math.min(elapsed / aoe.explodeTime, 1);

      if (aoe.showExplosion) {
        // Explosion flash
        const eAge = aoe.explosionLife;
        const alpha = Math.max(0, 1 - eAge / 300);
        ctx.fillStyle = `rgba(255,100,0,${alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(aoe.x, aoe.y, aoe.radius * (1 + eAge / 200), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Charging ring
        ctx.strokeStyle = `rgba(255,80,80,${0.3 + 0.4 * progress})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(aoe.x, aoe.y, aoe.radius, 0, Math.PI * 2);
        ctx.stroke();

        // Fill indicator
        ctx.fillStyle = `rgba(255,80,80,${0.08 + 0.12 * progress})`;
        ctx.beginPath();
        ctx.arc(aoe.x, aoe.y, aoe.radius, 0, Math.PI * 2);
        ctx.fill();

        // Progress arc (Morg Q style)
        ctx.strokeStyle = `rgba(255,50,50,0.9)`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(aoe.x, aoe.y, aoe.radius - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.stroke();
      }
    }

    // ── Linear projectiles ─────────────────────────────────────────────────────
    for (const proj of projectiles) {
      ctx.save();
      ctx.translate(proj.x, proj.y);
      ctx.rotate(proj.angle + Math.PI / 2);
      const grad = ctx.createLinearGradient(0, -proj.h / 2, 0, proj.h / 2);
      grad.addColorStop(0, 'rgba(255,60,60,0.9)');
      grad.addColorStop(0.5, 'rgba(255,120,30,0.95)');
      grad.addColorStop(1, 'rgba(255,60,60,0.3)');
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(255,80,0,0.8)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.roundRect(-proj.w / 2, -proj.h / 2, proj.w, proj.h, 4);
      ctx.fill();
      ctx.restore();
    }

    // ── Player ─────────────────────────────────────────────────────────────────
    if (alive) {
      // Glow
      const glow = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, PLAYER_RADIUS * 2);
      glow.addColorStop(0, 'rgba(79,195,247,0.35)');
      glow.addColorStop(1, 'rgba(79,195,247,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_RADIUS * 2, 0, Math.PI * 2);
      ctx.fill();

      // Body
      const bodyGrad = ctx.createRadialGradient(
        player.x - 4, player.y - 4, 2,
        player.x, player.y, PLAYER_RADIUS
      );
      bodyGrad.addColorStop(0, '#81d4fa');
      bodyGrad.addColorStop(1, '#0277bd');
      ctx.fillStyle = bodyGrad;
      ctx.shadowColor = '#4fc3f7';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // HP bar
      const barW = 40;
      const barH = 5;
      const barX = player.x - barW / 2;
      const barY = player.y - PLAYER_RADIUS - 12;
      ctx.fillStyle = '#333';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = state.playerHP > 50 ? '#4caf50' : state.playerHP > 25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * (state.playerHP / 100), barH);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      // Flash cooldown indicator (small arc around player)
      if (flashCooldownLeft > 0) {
        const cdProgress = 1 - (flashCooldownLeft / FLASH_COOLDOWN);
        ctx.strokeStyle = 'rgba(200,170,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_RADIUS + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdProgress);
        ctx.stroke();
      } else {
        // Flash ready indicator
        ctx.strokeStyle = 'rgba(200,170,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_RADIUS + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ── HUD ───────────────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(8, 8, 180, 56);
    ctx.fillStyle = '#e0e0ff';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`Time: ${state.score.toFixed(1)}s`, 16, 28);
    ctx.fillText(`Best: ${state.highScore.toFixed(1)}s`, 16, 48);

    // Flash key indicator
    const flashReady = flashCooldownLeft <= 0;
    ctx.fillStyle = flashReady ? 'rgba(160,120,255,0.85)' : 'rgba(60,60,80,0.85)';
    ctx.fillRect(CANVAS_W - 80, 8, 72, 40);
    ctx.fillStyle = flashReady ? '#fff' : '#888';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[D/F]', CANVAS_W - 44, 24);
    ctx.font = '11px monospace';
    // The visual cooldown is 300s (per spec) while actual gameplay cooldown is 15s.
    // We scale the displayed value proportionally so the UI counts down from 300 to 0.
    ctx.fillText(flashReady ? 'FLASH' : `${Math.ceil(flashCooldownLeft * (FLASH_VISUAL_COOLDOWN / FLASH_COOLDOWN))}s`, CANVAS_W - 44, 40);
    ctx.textAlign = 'left';
  }, []);

  // ── Start / Restart game ───────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const state = stateRef.current;
    state.player = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    state.playerVx = 0;
    state.playerVy = 0;
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

    const handleContextMenu = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      const state = stateRef.current;
      if (!state.started || !state.alive) {
        startGame();
        return;
      }
      state.playerTarget = { x: cx, y: cy };
      // Add ripple
      state.ripples.push({ x: cx, y: cy, born: performance.now(), life: 600, maxR: 28 });
    };

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      stateRef.current.mouseX = (e.clientX - rect.left) * scaleX;
      stateRef.current.mouseY = (e.clientY - rect.top) * scaleY;
    };

    const handleKeyDown = (e) => {
      const state = stateRef.current;
      if (!state.alive) return;
      if (e.key === 'd' || e.key === 'D' || e.key === 'f' || e.key === 'F') {
        if (state.flashCooldownLeft > 0) return;
        // Flash toward mouse position
        const dx = state.mouseX - state.player.x;
        const dy = state.mouseY - state.player.y;
        const d = Math.hypot(dx, dy);
        const flashDist = Math.min(d, FLASH_RANGE);
        if (d > 0) {
          state.player.x = clamp(state.player.x + (dx / d) * flashDist, PLAYER_RADIUS, CANVAS_W - PLAYER_RADIUS);
          state.player.y = clamp(state.player.y + (dy / d) * flashDist, PLAYER_RADIUS, CANVAS_H - PLAYER_RADIUS);
        }
        state.flashCooldownLeft = FLASH_COOLDOWN;
        // Clear movement target after flash
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

  // ── Start animation loop ───────────────────────────────────────────────────
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

        if (state.elapsed >= state.nextEscalation) {
          state.nextEscalation += ESCALATION_INTERVAL;
          state.projectileSpeed += SPEED_INCREMENT;
          state.spawnInterval = Math.max(MIN_SPAWN_INTERVAL, state.spawnInterval - SPAWN_INTERVAL_DECREMENT);
          state.aoeInterval = Math.max(2000, state.aoeInterval - 300);
        }

        if (state.flashCooldownLeft > 0) {
          state.flashCooldownLeft = Math.max(0, state.flashCooldownLeft - dt);
        }

        if (state.playerTarget) {
          const dx = state.playerTarget.x - state.player.x;
          const dy = state.playerTarget.y - state.player.y;
          const d = Math.hypot(dx, dy);
          if (d < ARRIVAL_THRESHOLD) {
            state.playerTarget = null;
            state.playerVx = 0;
            state.playerVy = 0;
          } else {
            const speed = PLAYER_SPEED * dt;
            if (d < speed) {
              state.player.x = state.playerTarget.x;
              state.player.y = state.playerTarget.y;
              state.playerTarget = null;
              state.playerVx = 0;
              state.playerVy = 0;
            } else {
              state.player.x += (dx / d) * PLAYER_SPEED * dt;
              state.player.y += (dy / d) * PLAYER_SPEED * dt;
            }
          }
          state.player.x = clamp(state.player.x, PLAYER_RADIUS, CANVAS_W - PLAYER_RADIUS);
          state.player.y = clamp(state.player.y, PLAYER_RADIUS, CANVAS_H - PLAYER_RADIUS);
        }

        if (now >= state.nextSpawn) {
          state.nextSpawn = now + state.spawnInterval + (Math.random() - 0.5) * 200;
          const count = 1 + Math.floor(Math.random() * Math.min(3, 1 + state.elapsed / 20));
          for (let i = 0; i < count; i++) {
            state.projectiles.push(spawnProjectile(state.player.x, state.player.y, state.projectileSpeed));
          }
        }

        if (now >= state.nextAoe) {
          state.nextAoe = now + state.aoeInterval + (Math.random() - 0.5) * 1000;
          state.aoes.push(spawnAoE(state.player.x, state.player.y));
        }

        const margin = 100;
        state.projectiles = state.projectiles.filter(proj => {
          proj.x += proj.vx * dt;
          proj.y += proj.vy * dt;
          if (proj.x < -margin || proj.x > CANVAS_W + margin ||
              proj.y < -margin || proj.y > CANVAS_H + margin) return false;
          if (circleRect(state.player.x, state.player.y, PLAYER_HITBOX_RADIUS,
              proj.x - proj.w / 2, proj.y - proj.h / 2, proj.w, proj.h)) {
            state.playerHP -= 20;
            if (state.playerHP <= 0) state.alive = false;
            return false;
          }
          return true;
        });

        state.aoes = state.aoes.filter(aoe => {
          const ageMs = now - aoe.born;
          if (aoe.showExplosion) {
            aoe.explosionLife += dt * 1000;
            return aoe.explosionLife <= 350;
          }
          if (!aoe.exploded && ageMs >= aoe.explodeTime) {
            aoe.exploded = true;
            aoe.showExplosion = true;
            aoe.explosionLife = 0;
            if (dist(state.player.x, state.player.y, aoe.x, aoe.y) < aoe.radius + PLAYER_HITBOX_RADIUS) {
              state.playerHP -= 35;
              if (state.playerHP <= 0) state.alive = false;
            }
          }
          return true;
        });

        state.ripples = state.ripples.filter(r => (now - r.born) < r.life);
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
        className="border-2 border-gray-700 rounded-lg cursor-crosshair"
        style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
      />

      <div className="mt-3 text-gray-500 text-xs text-center max-w-lg">
        Dodge all incoming skillshots · Difficulty increases every 10 seconds · Flash has a 15s cooldown
      </div>
    </div>
  );
}
