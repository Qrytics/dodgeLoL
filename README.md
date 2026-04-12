# DodgeLoL ⚡

A high-intensity micro-mechanics trainer inspired by [loldodgegame.com](https://loldodgegame.com). Sharpen your reflexes by dodging a relentless barrage of League of Legends–style skillshots, rendered from a **top-down isometric perspective**.

**Live game:** [mario-belmonte.com/games/dodgeLoL](https://mario-belmonte.com/games/dodgeLoL/)

---

## 🎮 How to Play

| Control | Action |
|---------|--------|
| **Right-click** | Move your character to the clicked position (click is inverse-projected from iso screen to world space) |
| **D** or **F** | Flash — instantly teleport up to 220 world-units toward your cursor (15s cooldown) |

### Rules
- Survive as long as possible against incoming skillshots.
- Each projectile that hits you deals damage (shown in the HP bar above your character).
- Difficulty **escalates every 10 seconds**: projectiles get faster and spawn more frequently.
- Your best time (high score) is tracked in-session.

---

## 🚀 Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or higher
- npm v9 or higher

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/Qrytics/dodgeLoL.git
cd dodgeLoL

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

Open [http://localhost:5173/games/dodgeLoL/](http://localhost:5173/games/dodgeLoL/) in your browser.

### Build for production

```bash
npm run build
```

The production-ready files will be in the `dist/` folder, configured with the base path `/games/dodgeLoL/`.

### Preview the production build locally

```bash
npm run preview
```

---

## 🎨 Isometric Perspective

The game world is an **800×800 world-unit square** rendered using a classic 30° isometric projection:

- All gameplay logic (movement, collision, spawning) runs in flat 2-D world coordinates.
- A `worldToScreen` / `screenToWorld` projection pair maps between world and canvas space at runtime.
- The isometric grid, player (cylinder), projectiles, AoE rings, and ripples are all drawn in iso-space.
- Mouse clicks are **inverse-projected** back to world coordinates so movement targets feel precise.
- Projectile travel directions are computed in world space and their screen-space angle is derived from velocity projection, giving correct visual trajectories without double-accounting for the iso distortion.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + Vite 8 |
| Styling | Tailwind CSS v4 |
| Game Rendering | HTML5 Canvas API |
| Game Loop | `requestAnimationFrame` |

---

## 🚢 Deployment

The game automatically deploys to **mario-belmonte.com/games/dodgeLoL** via GitHub Actions whenever changes are pushed to the `main` branch.

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | SSH hostname of the server (e.g. `mario-belmonte.com`) |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_KEY` | SSH private key (PEM format) |
| `DEPLOY_PATH` | Absolute path on the server (e.g. `/var/www/mario-belmonte.com/games/dodgeLoL`) |

### Setup Steps

1. Generate an SSH key pair:
   ```bash
   ssh-keygen -t ed25519 -C "github-deploy" -f deploy_key
   ```
2. Add the **public key** (`deploy_key.pub`) to the server's `~/.ssh/authorized_keys`.
3. Add the **private key** contents (`deploy_key`) as the `DEPLOY_KEY` GitHub secret.
4. Add the other secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`) in your repository's **Settings → Secrets and variables → Actions**.

---

## �� Game Mechanics

### Movement
- Uses **vector math** for smooth directional movement at a constant speed.
- An **arrival threshold** (4 world-units) prevents jittering near the destination.
- All movement operates in flat **world space**; the iso camera is purely presentational.

### Flash Ability (D/F key)
- Instantly teleports the player up to **220 world-units** toward the cursor.
- **15-second** gameplay cooldown (displayed as 300s in the UI overlay for style purposes).
- Flash cooldown shown as an arc around the player and as a HUD element.

### Projectile Engine
- **Linear skillshots**: Red rectangular projectiles spawned from random world-space edges, aimed at the player's current position.
- **Circular AoE** (Morg Q / Leona R style): Delayed explosions with a 1.5s warning indicator. The exploding ring fills as the timer counts down.

### Collision Detection
- **OBB (Oriented Bounding Box)**: Linear projectiles use a precise circle-vs-OBB check via axis-projection in world space, accounting for the projectile's travel angle.
- **Circle-to-Circle**: AoE explosions check the distance between centers in world space.
- The player's **hitbox** is slightly smaller than the visible character for fairness.

### Escalation
Every 10 seconds:
- Projectile speed increases.
- Spawn interval decreases (more frequent projectiles).
- AoE spawn frequency increases.

---

## � Bug Fixes & Improvements (April 2026)

- **Isometric camera**: full top-down iso perspective with `worldToScreen` / `screenToWorld` projection.
- **Accurate OBB collision**: linear projectiles now use an oriented bounding-box (OBB) check via axis-projection instead of an AABB approximation — drastically reduces phantom hits.
- **Correct inverse mouse projection**: right-click world coordinates are computed by inverting the iso transform, so you navigate exactly where you click.
- **Mouse tracking in world space**: Flash now targets the correct world position, not raw screen pixels.
- **AoE despawn fix**: explosion particles are properly removed after their animation completes (was leaking objects before).
- **Isometric player cylinder**: player rendered as a 3-D iso cylinder with top-cap highlight and a ground shadow ellipse.
- **Isometric projectiles**: velocity is projected to screen-angle; body is flattened on Y to match the iso plane.
- **Isometric AoE / ripples**: all circles are rendered as iso ellipses on the ground plane.
- **HUD polish**: rounded panels, better flash button layout, flash icon shows ⚡ when ready.
- **Arena border**: iso diamond border drawn around the playfield for spatial clarity.
- **`dt` cap**: delta-time is capped at 50 ms to prevent physics tunnelling after tab switches.
- **Ripple cleanup**: expired ripples are filtered every frame to avoid unbounded array growth.
- **Removed stale `playerVx/Vy`**: unused velocity fields removed; movement is purely target-driven.
- **Canvas size**: expanded to 960×640 to better frame the iso diamond.

---

## �📁 Project Structure

```
dodgeLoL/
├── src/
│   ├── DodgeGame.jsx   # Main game component (canvas + game loop)
│   ├── App.jsx         # Root React component
│   ├── main.jsx        # React entry point
│   └── index.css       # Global styles + Tailwind
├── .github/
│   └── workflows/
│       └── deploy.yml  # CI/CD deployment workflow
├── vite.config.js      # Vite config (base path, plugins)
└── index.html          # HTML entry point
```
