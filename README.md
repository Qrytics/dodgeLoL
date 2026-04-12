# DodgeLoL ⚡

A high-intensity micro-mechanics trainer inspired by [loldodgegame.com](https://loldodgegame.com). Sharpen your reflexes by dodging a relentless barrage of League of Legends–style skillshots, rendered from a **top-down isometric perspective**.

**Live game:** [mario-belmonte.com/games/dodgeLoL](https://mario-belmonte.com/games/dodgeLoL/)

---

## 🎮 How to Play

| Control | Action |
|---------|--------|
| **Right-click** | Move your character to the clicked position (inverse-projected from iso screen to world space) |
| **D** or **F** | Flash — instantly teleport up to 230 world-units toward your cursor |
| **ESC** | Return to the main menu at any time |
| **SPACE** | Restart after game over |
| **Left-click** | Select difficulty on the menu screen |

### Rules
- Choose a difficulty on the menu screen: **Easy**, **Normal**, **Hard**, or **Insane**.
- Survive as long as possible against incoming skillshots.
- Each projectile/AoE that hits you deals damage (shown in the HP bar above your character).
- Difficulty **escalates** over time: projectiles get faster and spawn more frequently.
- Your best time (high score) is tracked in-session.
- A **Back to Games** button in the top-left links back to the games hub.

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

Open [http://localhost:5173/](http://localhost:5173/) in your browser.

### Build for production

```bash
npm run build
```

The production-ready files will be in the `dist/` folder, using relative asset paths so the game can be hosted from subpaths (e.g. GitHub Pages repo sites like `/dodgeLoL/`).

### Preview the production build locally

```bash
npm run preview
```

---

## 🎨 Isometric Perspective

The game world is a **900×900 world-unit square** rendered using a dynamic 30° isometric projection:

- The canvas fills the **entire browser viewport** and recalculates the projection on every resize.
- `makeProjection(canvasW, canvasH)` computes scale, origin, and projection functions dynamically so the iso diamond always fills the available space.
- All gameplay logic (movement, collision, spawning) runs in flat 2-D world coordinates.
- A `worldToScreen` / `screenToWorld` pair maps between world and canvas space.
- Mouse clicks are **inverse-projected** back to world coordinates so movement targets feel precise.
- Projectile travel directions are computed in world space and their screen-space angle is derived from velocity projection.
- A subtle vignette and arena fill provide depth without obscuring gameplay.

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
- Instantly teleports the player up to **230 world-units** toward the cursor.
- Cooldown varies by difficulty (10s Easy → 22s Insane), displayed as ~300s in the UI for League flavour.
- Flash cooldown shown as an arc around the player and as a HUD element.

### Projectile Engine
- **Linear skillshots**: Red rectangular projectiles spawned from random world-space edges, aimed at the player's current position.
- **Circular AoE** (Morg Q / Leona R style): Delayed explosions with a 1.5s warning indicator. The exploding ring fills as the timer counts down.

### Collision Detection
- **Circle-to-Circle** for linear projectiles: uses the projectile's effective radius (~30% of its longest dimension) vs the player hitbox (radius 9). Much more forgiving than the old OBB approach — eliminates false "phantom" deaths.
- **Circle-to-Circle** for AoE explosions: checks distance between centres in world space.
- The player's **hitbox radius (9)** is significantly smaller than the visual body (~16) for fairness.

### Difficulty Presets

| Setting | Easy | Normal | Hard | Insane |
|---------|------|--------|------|--------|
| Spawn interval | 2000ms | 1400ms | 1000ms | 700ms |
| Projectile speed | 140 | 200 | 260 | 320 |
| AoE interval | 6000ms | 4000ms | 3000ms | 2200ms |
| Escalation period | 15s | 10s | 8s | 6s |
| Projectile damage | 15 | 20 | 25 | 30 |
| AoE damage | 25 | 35 | 40 | 50 |
| Flash cooldown | 10s | 15s | 18s | 22s |

### Escalation
Every escalation period (varies by difficulty):
- Projectile speed increases.
- Spawn interval decreases (more frequent projectiles).
- AoE spawn frequency increases.

---

## � Bug Fixes & Improvements (April 2026)

- **Full-screen canvas**: the game fills the entire browser viewport and dynamically resizes.
- **Dynamic iso projection**: `makeProjection()` recomputes scale + origin on every resize so the diamond always fills the screen — no more tiny corner rendering.
- **Difficulty selector**: four presets (Easy / Normal / Hard / Insane) with left-click selection on the menu.
- **Restart support**: right-click or SPACE on game-over restarts immediately; ESC returns to menu.
- **Back to Games button**: HTML overlay link in the top-left corner → `mario-belmonte.com/games`.
- **Forgiving hitboxes**: switched from OBB to circle-circle collision with a small effective radius; player hitbox reduced to 9 (from 13). Eliminates phantom deaths.
- **Hit particles**: projectile and AoE impacts spawn orange particle bursts for visual feedback.
- **Vignette + arena fill**: subtle vignette gradient and semi-transparent arena fill for depth.
- **Correct inverse mouse projection**: right-click world coordinates are computed by inverting the iso transform.
- **AoE despawn fix**: explosion particles are properly removed after their animation completes.
- **Isometric player cylinder**: 3-D iso cylinder with top-cap highlight and ground shadow.
- **Isometric projectiles**: velocity projected to screen-angle; body flattened to match iso plane.
- **Isometric AoE / ripples**: all circles rendered as proper iso ellipses.
- **HUD polish**: rounded panels, responsive font sizing, flash button with ⚡ icon.
- **`dt` cap**: delta-time capped at 50 ms to prevent physics tunnelling.
- **Ripple + particle cleanup**: expired effects filtered every frame.

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
