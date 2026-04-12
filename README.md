# DodgeLoL ⚡

A high-intensity micro-mechanics trainer inspired by [loldodgegame.com](https://loldodgegame.com). Sharpen your reflexes by dodging a relentless barrage of League of Legends–style skillshots in a top-down arena.

**Live game:** [mario-belmonte.com/games/dodgeLoL](https://mario-belmonte.com/games/dodgeLoL/)

---

## 🎮 How to Play

| Control | Action |
|---------|--------|
| **Right-click** | Move your character to the clicked position |
| **D** or **F** | Flash — instantly teleport up to 200px toward your cursor (15s cooldown) |

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
- An **arrival threshold** (5px) prevents jittering near the destination.

### Flash Ability (D/F key)
- Instantly teleports the player up to **200px** toward the cursor.
- **15-second** gameplay cooldown (displayed as 300s in the UI overlay for style purposes).
- Flash cooldown shown as an arc around the player and as a HUD element.

### Projectile Engine
- **Linear skillshots**: Red rectangular projectiles spawned from random canvas edges, aimed at the player's current position.
- **Circular AoE** (Morg Q / Leona R style): Delayed explosions with a 1.5s warning indicator. The exploding ring fills as the timer counts down.

### Collision Detection
- **Circle-to-Rectangle**: Linear projectiles use precise AABB closest-point distance check.
- **Circle-to-Circle**: AoE explosions check the distance between centers.
- The player's **hitbox** is slightly smaller than the visible character for fairness.

### Escalation
Every 10 seconds:
- Projectile speed increases.
- Spawn interval decreases (more frequent projectiles).
- AoE spawn frequency increases.

---

## 📁 Project Structure

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
