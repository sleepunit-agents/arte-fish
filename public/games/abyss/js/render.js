// Rendering engine - all canvas drawing

const TILE_SIZE = 12;

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.tileSize = TILE_SIZE;

        // Logical size in CSS pixels; the backing store is scaled by
        // devicePixelRatio so text and tiles stay crisp on HiDPI / zoomed
        // displays (the 8px upgrade text was a nearest-neighbour smear at 175%).
        this.width = MAP_WIDTH * this.tileSize;
        this.height = MAP_HEIGHT * this.tileSize;
        this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // Color palette - dark, bioluminescent aesthetic
        // floor/wall/wallExplored/floorExplored/wallHighlight shift per depth tier
        this.colors = {
            background: '#000a0f',
            wall: '#0a1a1f',
            wallExplored: '#0a1618',
            wallHighlight: 'rgba(10, 106, 112, 0.3)',
            floor: '#0a2a2f',
            floorExplored: '#061418',
            player: '#3df7ff',
            playerGlow: '#1ac8d6',
            fog: '#000a0f'
        };

        // Subtle bioluminescent particle system (static dots)
        this.particles = this.generateParticles();

        // Particle color (changes per floor)
        this.particleColor = 'rgba(61, 247, 255, ';

        // Damage flash state
        this.damageFlash = 0; // frames remaining
    }

    generateParticles() {
        // Sparse bioluminescent dots on visible floors
        const particles = [];
        const count = 60;
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * MAP_WIDTH,
                y: Math.random() * MAP_HEIGHT,
                brightness: Math.random(),
                phase: Math.random() * Math.PI * 2,
                speed: 0.03 + Math.random() * 0.04
            });
        }
        return particles;
    }

    updateParticles() {
        for (const p of this.particles) {
            p.phase += p.speed;
        }
    }

    triggerDamageFlash() {
        this.damageFlash = 6;
    }

    clear() {
        this.ctx.fillStyle = this.colors.background;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    updateColorsForFloor(floor) {
        // Shift color palette based on depth
        // Floors 1-2: cyan/teal (shallow)
        // Floors 3-4: purple/violet (mid-depth)
        // Floor 5: crimson/deep red (abyssal)
        // Floor 6+ (void): near-black with faint starlight

        if (floor <= 2) {
            // Shallow - original cyan/teal palette
            this.colors.background = '#000a0f';
            this.colors.wall = '#0a1a1f';
            this.colors.wallExplored = '#0a1618';
            this.colors.wallHighlight = 'rgba(10, 106, 112, 0.3)';
            this.colors.floor = '#0a2a2f';
            this.colors.floorExplored = '#061418';
            this.particleColor = 'rgba(61, 247, 255, ';
        } else if (floor <= 4) {
            // Mid-depth - purple/violet palette
            this.colors.background = '#0a000f';
            this.colors.wall = '#1a0a2f';
            this.colors.wallExplored = '#100820';
            this.colors.wallHighlight = 'rgba(100, 60, 180, 0.3)';
            this.colors.floor = '#1a0a3a';
            this.colors.floorExplored = '#0d061a';
            this.particleColor = 'rgba(180, 120, 255, ';
        } else if (floor <= 5) {
            // Abyssal - crimson/dark red palette
            this.colors.background = '#0f0003';
            this.colors.wall = '#2a0508';
            this.colors.wallExplored = '#1a0305';
            this.colors.wallHighlight = 'rgba(150, 30, 50, 0.3)';
            this.colors.floor = '#3a0a0f';
            this.colors.floorExplored = '#150204';
            this.particleColor = 'rgba(255, 80, 120, ';
        } else {
            // The Void — near-black. Not bioluminescence. Something else.
            this.colors.background = '#020204';
            this.colors.wall = '#060608';
            this.colors.wallExplored = '#040406';
            this.colors.wallHighlight = 'rgba(40, 40, 60, 0.15)';
            this.colors.floor = '#08080c';
            this.colors.floorExplored = '#050507';
            this.particleColor = 'rgba(180, 180, 220, ';
        }
    }

    render(map, player, enemyManager, itemManager) {
        this.updateColorsForFloor(player.floor);
        this.updateParticles();
        this.clear();
        this.renderMap(map);
        this.renderParticles(map);
        if (itemManager) this.renderItems(map, itemManager.items);
        if (enemyManager) this.renderEnemies(map, enemyManager.enemies);

        // Void aura: dark overlay on tiles within 3 of a living Leviathan.
        // The world literally dims around it.
        if (enemyManager) {
            for (const enemy of enemyManager.enemies) {
                if (enemy.type === 'leviathan' && enemy.isAlive()) {
                    this.renderVoidAura(enemy, map);
                }
            }
        }

        this.renderPlayer(player);

        // Damage flash overlay
        if (this.damageFlash > 0) {
            const alpha = this.damageFlash / 10;
            this.ctx.fillStyle = `rgba(255, 0, 0, ${alpha * 0.3})`;
            this.ctx.fillRect(0, 0, this.width, this.height);
            this.damageFlash--;
        }
    }

    // Dark overlay around the Leviathan — anti-light field
    renderVoidAura(leviathan, map) {
        const radius = leviathan.voidAuraRadius || 3;
        const ts = this.tileSize;
        const lx = leviathan.x;
        const ly = leviathan.y;

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                const tx = lx + dx;
                const ty = ly + dy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;

                const tile = map.getTile(tx, ty);
                if (!tile || !tile.visible) continue;

                // Stronger darkness closer to the Leviathan
                const intensity = 1 - (dist / radius);
                const alpha = intensity * 0.5;
                this.ctx.fillStyle = `rgba(0, 0, 5, ${alpha})`;
                this.ctx.fillRect(tx * ts, ty * ts, ts, ts);
            }
        }
    }

    renderMap(map) {
        for (let key in map.tiles) {
            const tile = map.tiles[key];

            // Only render explored tiles
            if (!tile.explored) {
                continue;
            }

            const x = tile.x * this.tileSize;
            const y = tile.y * this.tileSize;

            if (tile.walkable) {
                // Floor tile
                if (tile.visible) {
                    this.ctx.fillStyle = this.colors.floor;
                    this.ctx.fillRect(x, y, this.tileSize, this.tileSize);
                } else {
                    // Explored but not visible - darker floor (depth-aware)
                    this.ctx.fillStyle = this.colors.floorExplored;
                    this.ctx.fillRect(x, y, this.tileSize, this.tileSize);
                }
            } else {
                // Wall tile
                if (tile.visible) {
                    this.ctx.fillStyle = this.colors.wall;
                    this.ctx.fillRect(x, y, this.tileSize, this.tileSize);

                    // Add edge highlight for visible walls (depth-aware)
                    this.ctx.fillStyle = this.colors.wallHighlight;
                    this.ctx.fillRect(x, y, this.tileSize, 1);
                } else {
                    // Explored walls (depth-aware)
                    this.ctx.fillStyle = this.colors.wallExplored;
                    this.ctx.fillRect(x, y, this.tileSize, this.tileSize);
                }
            }
        }
    }

    renderParticles(map) {
        for (const p of this.particles) {
            const tileX = Math.floor(p.x);
            const tileY = Math.floor(p.y);
            const tile = map.getTile(tileX, tileY);

            if (!tile || !tile.visible || !tile.walkable) continue;

            const brightness = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p.phase));
            const alpha = brightness * 0.25;

            const px = tileX * this.tileSize + (p.x - tileX) * this.tileSize;
            const py = tileY * this.tileSize + (p.y - tileY) * this.tileSize;

            this.ctx.fillStyle = (this.particleColor || 'rgba(61, 247, 255, ') + `${alpha})`;
            this.ctx.fillRect(px, py, 1.5, 1.5);
        }
    }

    renderEnemies(map, enemies) {
        for (const enemy of enemies) {
            if (!enemy.isAlive()) continue;

            // Only render if visible
            const tile = map.getTile(enemy.x, enemy.y);
            if (!tile || !tile.visible) continue;

            this.renderEnemy(enemy);
        }
    }

    renderEnemy(enemy) {
        const x = enemy.x * this.tileSize;
        const y = enemy.y * this.tileSize;
        const ts = this.tileSize;

        if (enemy.type === 'anglerfish') {
            this.renderAnglerfish(x, y, ts, enemy);
        } else if (enemy.type === 'deepcrawler') {
            this.renderDeepCrawler(x, y, ts, enemy);
        } else if (enemy.type === 'phantomjellyfish') {
            this.renderPhantomJellyfish(x, y, ts, enemy);
        } else if (enemy.type === 'leviathan') {
            this.renderLeviathan(x, y, ts, enemy);
        } else {
            // Generic fallback
            this.ctx.fillStyle = enemy.color;
            this.ctx.fillRect(x + 2, y + 2, ts - 4, ts - 4);
        }

        // Awareness state indicator — small dot in top-right corner.
        // UNAWARE: no dot. SUSPICIOUS/ALERTED/AGGRO: colored dot so the player
        // can read enemy state at a glance without guessing.
        const stateColor = this.awarenessColor(enemy);
        if (stateColor) {
            this.ctx.fillStyle = stateColor;
            this.ctx.fillRect(x + ts - 3, y + 1, 2, 2);
        }

        // Facing indicator — directional triangle on the edge the enemy faces.
        // UNAWARE: dim white (subtle directional hint for stealth planning).
        // SUSPICIOUS+: uses state color (the locked gaze is the threat).
        // Leviathan: no indicator (omnidirectional, always watching).
        if (enemy.facing && enemy.type !== 'leviathan') {
            const fc = stateColor || 'rgba(255, 255, 255, 0.4)';
            this.ctx.fillStyle = fc;
            const cx = x + ts / 2;
            const cy = y + ts / 2;
            this.ctx.beginPath();
            switch (enemy.facing) {
                case 'N':
                    this.ctx.moveTo(cx - 3, y + 3);
                    this.ctx.lineTo(cx, y);
                    this.ctx.lineTo(cx + 3, y + 3);
                    break;
                case 'S':
                    this.ctx.moveTo(cx - 3, y + ts - 3);
                    this.ctx.lineTo(cx, y + ts);
                    this.ctx.lineTo(cx + 3, y + ts - 3);
                    break;
                case 'W':
                    this.ctx.moveTo(x + 3, cy - 3);
                    this.ctx.lineTo(x, cy);
                    this.ctx.lineTo(x + 3, cy + 3);
                    break;
                case 'E':
                    this.ctx.moveTo(x + ts - 3, cy - 3);
                    this.ctx.lineTo(x + ts, cy);
                    this.ctx.lineTo(x + ts - 3, cy + 3);
                    break;
            }
            this.ctx.fill();
        }

        // HP bar above enemy (only if damaged)
        if (enemy.hp < enemy.maxHp) {
            this.renderHPBar(x, y, ts, enemy);
        }
    }

    // Returns the awareness state color string, or null for UNAWARE.
    awarenessColor(enemy) {
        switch (enemy.awarenessState) {
            case 'SUSPICIOUS': return '#d4a017'; // amber — heard something
            case 'ALERTED':    return '#e07b39'; // orange — actively searching
            case 'AGGRO':      return '#e05252'; // red — sees you
            default:           return null;      // UNAWARE — no indicator shown
        }
    }

    renderAnglerfish(x, y, ts, enemy) {
        // Glow
        const dim = enemy.lureDim || 1.0;
        const grad = this.ctx.createRadialGradient(
            x + ts / 2, y + ts / 2, 0,
            x + ts / 2, y + ts / 2, ts * 1.8
        );
        grad.addColorStop(0, `rgba(255, 180, 0, ${0.4 * dim})`);
        grad.addColorStop(1, 'rgba(255, 180, 0, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(x - ts / 2, y - ts / 2, ts * 2, ts * 2);

        // Body - dark, jagged
        this.ctx.fillStyle = '#1a0a00';
        this.ctx.fillRect(x + 1, y + 3, ts - 2, ts - 5);

        // Jaw (wider bottom)
        this.ctx.fillStyle = '#2a1000';
        this.ctx.fillRect(x, y + ts - 5, ts, 4);

        // Teeth hint
        this.ctx.fillStyle = '#8a6a44';
        for (let t = 0; t < 3; t++) {
            this.ctx.fillRect(x + 2 + t * 3, y + ts - 4, 1, 2);
        }

        // Lure antenna
        this.ctx.fillStyle = `rgba(255, 220, 50, ${0.6 * dim})`;
        this.ctx.fillRect(x + ts / 2 - 1, y, 1, 3);

        // Lure bulb
        const lureAlpha = 0.7 + 0.3 * dim;
        this.ctx.fillStyle = `rgba(255, 240, 80, ${lureAlpha})`;
        this.ctx.fillRect(x + ts / 2 - 1, y - 1, 2, 2);

        // Eyes - two tiny red dots
        this.ctx.fillStyle = '#ff3300';
        this.ctx.fillRect(x + 2, y + 4, 2, 1);
        this.ctx.fillRect(x + ts - 4, y + 4, 2, 1);
    }

    renderDeepCrawler(x, y, ts, enemy) {
        // Glow
        const grad = this.ctx.createRadialGradient(
            x + ts / 2, y + ts / 2, 0,
            x + ts / 2, y + ts / 2, ts * 1.5
        );
        grad.addColorStop(0, 'rgba(120, 40, 180, 0.35)');
        grad.addColorStop(1, 'rgba(120, 40, 180, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(x - ts / 2, y - ts / 2, ts * 2, ts * 2);

        // Body - segmented
        this.ctx.fillStyle = '#3a1a5a';
        this.ctx.fillRect(x + 1, y + 2, ts - 2, ts - 4);

        // Segment lines
        this.ctx.fillStyle = '#2a0e3e';
        this.ctx.fillRect(x + 1, y + 5, ts - 2, 1);
        this.ctx.fillRect(x + 1, y + 8, ts - 2, 1);

        // Many small legs suggestion
        this.ctx.fillStyle = '#5a2a8a';
        for (let l = 0; l < 3; l++) {
            this.ctx.fillRect(x + l * 3 + 2, y + ts - 2, 1, 2);
            this.ctx.fillRect(x + l * 3 + 2, y, 1, -2);
        }

        // Eyes - pale purple dots
        this.ctx.fillStyle = '#cc88ff';
        this.ctx.fillRect(x + 2, y + 3, 1, 1);
        this.ctx.fillRect(x + ts - 3, y + 3, 1, 1);
        this.ctx.fillRect(x + ts / 2 - 1, y + 3, 1, 1); // extra eye
    }

    renderPhantomJellyfish(x, y, ts, enemy) {
        // Passive jellyfish (Floor 3): softer blue glow — peaceful, unthreatening
        // Aggressive jellyfish: original purple glow
        const isPassive = enemy.passive;
        const glowR = isPassive ? 100 : 180;
        const glowG = isPassive ? 180 : 120;
        const glowA = isPassive ? 0.35 : 0.45;

        const grad = this.ctx.createRadialGradient(
            x + ts / 2, y + ts / 2, 0,
            x + ts / 2, y + ts / 2, ts * 1.8
        );
        grad.addColorStop(0, `rgba(${glowR}, ${glowG}, 255, ${glowA})`);
        grad.addColorStop(1, `rgba(${glowR}, ${glowG}, 255, 0)`);
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(x - ts / 2, y - ts / 2, ts * 2, ts * 2);

        // Bell/dome body — bluer tint for passive
        this.ctx.fillStyle = isPassive ? '#4060aa' : '#7040aa';
        this.ctx.fillRect(x + 2, y + 1, ts - 4, 4);
        this.ctx.fillRect(x + 1, y + 2, ts - 2, 2);

        // Transparent inner glow
        this.ctx.fillStyle = isPassive
            ? 'rgba(100, 180, 255, 0.6)'
            : 'rgba(180, 120, 255, 0.6)';
        this.ctx.fillRect(x + 3, y + 2, ts - 6, 2);

        // Trailing tentacles (animated wave — slower drift for passive)
        const pulse = Math.sin(enemy.tentaclePulse || 0);
        this.ctx.fillStyle = isPassive
            ? 'rgba(80, 140, 200, 0.7)'
            : 'rgba(140, 80, 200, 0.7)';
        for (let i = 0; i < 4; i++) {
            const tx = x + 2 + i * 2;
            const offset = Math.floor(pulse * (i % 2 === 0 ? 1 : -1));
            this.ctx.fillRect(tx, y + 5 + offset, 1, 3);
        }

        // Core (glowing center)
        this.ctx.fillStyle = isPassive ? '#b0d8ff' : '#e0b0ff';
        this.ctx.fillRect(x + ts / 2 - 1, y + 3, 2, 1);
    }

    renderLeviathan(x, y, ts, enemy) {
        // Massive crimson glow
        const grad = this.ctx.createRadialGradient(
            x + ts / 2, y + ts / 2, 0,
            x + ts / 2, y + ts / 2, ts * 2.2
        );
        grad.addColorStop(0, 'rgba(255, 80, 120, 0.5)');
        grad.addColorStop(1, 'rgba(255, 80, 120, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(x - ts, y - ts, ts * 3, ts * 3);

        // Massive body - fills the whole tile
        this.ctx.fillStyle = '#4a0a18';
        this.ctx.fillRect(x, y + 1, ts, ts - 2);

        // Scaled texture
        this.ctx.fillStyle = '#5a1020';
        for (let sy = 0; sy < 3; sy++) {
            this.ctx.fillRect(x + sy % 2, y + 2 + sy * 3, ts - (sy % 2), 1);
        }

        // Glowing eyes - pulsing menace
        const eyePulse = 0.7 + 0.3 * Math.sin(enemy.eyePulse || 0);
        this.ctx.fillStyle = `rgba(255, 60, 80, ${eyePulse})`;
        this.ctx.fillRect(x + 2, y + 3, 2, 2);
        this.ctx.fillRect(x + ts - 4, y + 3, 2, 2);

        // Fangs/maw hint
        this.ctx.fillStyle = '#cc4455';
        this.ctx.fillRect(x + 2, y + ts - 3, 2, 2);
        this.ctx.fillRect(x + ts - 4, y + ts - 3, 2, 2);
    }

    renderHPBar(x, y, ts, enemy) {
        const barW = ts;
        const barH = 2;
        const barY = y - 4;
        const pct = enemy.hp / enemy.maxHp;

        this.ctx.fillStyle = '#300a00';
        this.ctx.fillRect(x, barY, barW, barH);

        const barColor = pct > 0.5 ? '#44ff88' : pct > 0.25 ? '#ffaa00' : '#ff3300';
        this.ctx.fillStyle = barColor;
        this.ctx.fillRect(x, barY, Math.floor(barW * pct), barH);
    }

    renderItems(map, items) {
        for (const item of items) {
            // Render if visible OR if revealed (stairs, post-Leviathan exits)
            const tile = map.getTile(item.x, item.y);
            if (!tile) continue;
            const isRevealed = item.revealed && (
                item.type === 'stairs' || item.type === 'stairs_up' || item.type === 'void_passage'
            );
            if (!tile.visible && !isRevealed) continue;

            const x = item.x * this.tileSize;
            const y = item.y * this.tileSize;
            const ts = this.tileSize;

            if (item.type === 'oxygen') {
                // Oxygen canister - cyan cylinder with glow
                const grad = this.ctx.createRadialGradient(
                    x + ts / 2, y + ts / 2, 0,
                    x + ts / 2, y + ts / 2, ts * 1.2
                );
                grad.addColorStop(0, 'rgba(61, 247, 255, 0.3)');
                grad.addColorStop(1, 'rgba(61, 247, 255, 0)');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(x - ts / 4, y - ts / 4, ts * 1.5, ts * 1.5);

                // Canister body
                this.ctx.fillStyle = '#1a4a5a';
                this.ctx.fillRect(x + 3, y + 2, ts - 6, ts - 4);

                // Top cap
                this.ctx.fillStyle = '#3df7ff';
                this.ctx.fillRect(x + 3, y + 2, ts - 6, 2);

                // O2 label (small accent)
                this.ctx.fillStyle = '#3df7ff';
                this.ctx.fillRect(x + ts / 2 - 1, y + ts / 2, 2, 2);
            } else if (item.type === 'stairs') {
                // Stairs down - descending symbols with green glow
                const grad = this.ctx.createRadialGradient(
                    x + ts / 2, y + ts / 2, 0,
                    x + ts / 2, y + ts / 2, ts * 1.3
                );
                grad.addColorStop(0, 'rgba(120, 255, 180, 0.35)');
                grad.addColorStop(1, 'rgba(120, 255, 180, 0)');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(x - ts / 4, y - ts / 4, ts * 1.5, ts * 1.5);

                // Stairs pattern - descending lines
                this.ctx.fillStyle = '#44ff88';
                for (let i = 0; i < 3; i++) {
                    const sx = x + 2 + i * 3;
                    const sy = y + 3 + i * 2;
                    this.ctx.fillRect(sx, sy, 3, 1);
                }

                // Down arrow accent
                this.ctx.fillStyle = '#44ff88';
                this.ctx.fillRect(x + ts / 2 - 1, y + ts - 3, 2, 1);
                this.ctx.fillRect(x + ts / 2 - 2, y + ts - 4, 4, 1);
            } else if (item.type === 'stairs_up') {
                // Stairs UP — green glow, familiar. Surface. Loop. Safety.
                const grad = this.ctx.createRadialGradient(
                    x + ts / 2, y + ts / 2, 0,
                    x + ts / 2, y + ts / 2, ts * 1.3
                );
                grad.addColorStop(0, 'rgba(120, 255, 180, 0.35)');
                grad.addColorStop(1, 'rgba(120, 255, 180, 0)');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(x - ts / 4, y - ts / 4, ts * 1.5, ts * 1.5);

                // Ascending lines
                this.ctx.fillStyle = '#44ff88';
                for (let i = 0; i < 3; i++) {
                    const sx = x + 2 + i * 3;
                    const sy = y + ts - 5 - i * 2;
                    this.ctx.fillRect(sx, sy, 3, 1);
                }

                // Up arrow accent
                this.ctx.fillStyle = '#44ff88';
                this.ctx.fillRect(x + ts / 2 - 1, y + 2, 2, 1);
                this.ctx.fillRect(x + ts / 2 - 2, y + 3, 4, 1);
            } else if (item.type === 'void_passage') {
                // Void passage — dim white, barely visible, pulsing slowly.
                // A dark hole. Something else.
                const pulse = 0.15 + 0.1 * Math.sin(Date.now() / 1500);
                const grad = this.ctx.createRadialGradient(
                    x + ts / 2, y + ts / 2, 0,
                    x + ts / 2, y + ts / 2, ts * 1.0
                );
                grad.addColorStop(0, `rgba(200, 200, 220, ${pulse})`);
                grad.addColorStop(1, 'rgba(200, 200, 220, 0)');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(x - ts / 4, y - ts / 4, ts * 1.5, ts * 1.5);

                // Dark hole center
                this.ctx.fillStyle = '#020204';
                this.ctx.fillRect(x + 3, y + 3, ts - 6, ts - 6);

                // Faint edge glow
                this.ctx.fillStyle = `rgba(160, 160, 180, ${pulse * 0.8})`;
                this.ctx.fillRect(x + 2, y + 2, ts - 4, 1);
                this.ctx.fillRect(x + 2, y + ts - 3, ts - 4, 1);
                this.ctx.fillRect(x + 2, y + 3, 1, ts - 6);
                this.ctx.fillRect(x + ts - 3, y + 3, 1, ts - 6);
            }
        }
    }

    renderPlayer(player) {
        const x = player.x * this.tileSize;
        const y = player.y * this.tileSize;

        // Draw glow first
        const gradient = this.ctx.createRadialGradient(
            x + this.tileSize / 2,
            y + this.tileSize / 2,
            0,
            x + this.tileSize / 2,
            y + this.tileSize / 2,
            this.tileSize * 1.5
        );
        gradient.addColorStop(0, 'rgba(61, 247, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(61, 247, 255, 0)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(
            x - this.tileSize / 2,
            y - this.tileSize / 2,
            this.tileSize * 2,
            this.tileSize * 2
        );

        // Draw submersible body - simple geometric shape
        this.ctx.fillStyle = this.colors.player;

        // Main body
        this.ctx.fillRect(
            x + 2,
            y + 3,
            this.tileSize - 4,
            this.tileSize - 6
        );

        // Front viewport
        this.ctx.fillStyle = this.colors.playerGlow;
        this.ctx.fillRect(
            x + this.tileSize / 2 - 2,
            y + 4,
            4,
            3
        );

        // Small accent lights
        this.ctx.fillRect(x + 3, y + this.tileSize - 4, 1, 1);
        this.ctx.fillRect(x + this.tileSize - 4, y + this.tileSize - 4, 1, 1);
    }

    renderGameOver(player) {
        const w = this.width;
        const h = this.height;

        // Dark overlay
        this.ctx.fillStyle = 'rgba(0, 4, 8, 0.88)';
        this.ctx.fillRect(0, 0, w, h);

        // Loop count (if > 1)
        this.ctx.font = '9px "Courier New", monospace';
        this.ctx.letterSpacing = '0.15em';
        this.ctx.fillStyle = '#0a3040';
        this.ctx.textAlign = 'center';
        if (player.loopCount > 1) {
            this.ctx.fillText(`LOOP ${player.loopCount}`, w / 2, h / 2 - 54);
        }

        // Depth and floor reached
        this.ctx.font = '10px "Courier New", monospace';
        this.ctx.letterSpacing = '0.2em';
        this.ctx.fillStyle = '#1a4a5a';
        this.ctx.fillText(`FLOOR ${player.floor}`, w / 2, h / 2 - 40);

        this.ctx.font = 'bold 22px "Courier New", monospace';
        this.ctx.fillStyle = '#3df7ff';
        this.ctx.fillText(`${player.depthMeters}m`, w / 2, h / 2 - 16);

        // Death reason
        this.ctx.font = '11px "Courier New", monospace';
        this.ctx.fillStyle = '#cc2200';
        const deathReason = player.oxygen <= 0 ? 'OXYGEN DEPLETED' : 'HULL INTEGRITY LOST';
        this.ctx.fillText(deathReason, w / 2, h / 2 + 8);

        this.ctx.font = '9px "Courier New", monospace';
        this.ctx.fillStyle = '#1a5a4a';
        this.ctx.fillText('[ PRESS ENTER TO DESCEND AGAIN ]', w / 2, h / 2 + 32);

        this.ctx.textAlign = 'left';
        this.ctx.letterSpacing = '0px';
    }

    // Word-wrap helper for canvas text. Returns lines that fit maxWidth
    // under the current ctx.font.
    wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let line = '';
        for (const word of words) {
            const trial = line ? `${line} ${word}` : word;
            if (this.ctx.measureText(trial).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = trial;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    // Upgrade selection screen — shown when player finds stairs.
    // Solid panel, sized to the text; descriptions wrap inside it instead of
    // running off the right edge of the canvas.
    renderUpgradeScreen(upgrades, currentFloor) {
        const w = this.width;
        const h = this.height;
        const ctx = this.ctx;

        // Dim the world
        ctx.fillStyle = 'rgba(0, 4, 8, 0.82)';
        ctx.fillRect(0, 0, w, h);

        const panelW = Math.min(460, w - 40);
        const padX = 32;
        const gutter = 34; // the [n] column
        const textW = panelW - padX * 2 - gutter;
        const nameFont = 'bold 13px "Courier New", monospace';
        const descFont = '11px "Courier New", monospace';
        const descLineH = 15;
        const optionGap = 20;

        // Measure first so the panel fits its contents. The measurement has
        // to happen under exactly the state the text is drawn with: canvas
        // letterSpacing is sticky, and '0' without a unit is silently
        // rejected, so a leftover '0.08em' from the title was widening the
        // drawn text past what wrapText had measured (the "Stairs location"
        // overflow on floor 1).
        ctx.letterSpacing = '0px';
        ctx.font = descFont;
        const wrapped = upgrades.map(u => this.wrapText(u.desc, textW));
        let optionsH = 0;
        for (const lines of wrapped) optionsH += 18 + lines.length * descLineH + optionGap;
        const headerH = 72;
        const footerH = 38;
        const panelH = headerH + optionsH + footerH - optionGap + 8;
        const px = Math.round((w - panelW) / 2);
        const py = Math.round((h - panelH) / 2);

        // Panel
        ctx.fillStyle = '#020d14';
        ctx.fillRect(px, py, panelW, panelH);
        ctx.strokeStyle = '#0f4a5a';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);

        // Header
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.letterSpacing = '0.25em';
        ctx.font = '10px "Courier New", monospace';
        ctx.fillStyle = '#2a7a8a';
        ctx.fillText('SYSTEM MODIFICATION', w / 2, py + 28);

        ctx.letterSpacing = '0.08em';
        ctx.font = 'bold 14px "Courier New", monospace';
        ctx.fillStyle = '#3df7ff';
        ctx.fillText(`FLOOR ${currentFloor} COMPLETE — CHOOSE ONE`, w / 2, py + 52);

        // Options
        ctx.textAlign = 'left';
        ctx.letterSpacing = '0px';
        const labelX = px + padX;
        const textX = labelX + gutter;
        let y = py + headerH + 16;
        upgrades.forEach((upgrade, i) => {
            ctx.font = nameFont;
            ctx.fillStyle = '#3df7ff';
            ctx.fillText(`[${i + 1}]`, labelX, y);
            ctx.fillStyle = '#d0f0e8';
            ctx.fillText(upgrade.name, textX, y);

            ctx.font = descFont;
            ctx.fillStyle = '#6fb8a8';
            wrapped[i].forEach((line, j) => {
                ctx.fillText(line, textX, y + 16 + j * descLineH);
            });
            y += 18 + wrapped[i].length * descLineH + optionGap;
        });

        // Footer hint
        ctx.textAlign = 'center';
        ctx.letterSpacing = '0.2em';
        ctx.font = '9px "Courier New", monospace';
        ctx.fillStyle = '#2a7a8a';
        ctx.fillText('PRESS 1 2 3', w / 2, py + panelH - 16);

        ctx.textAlign = 'left';
        ctx.letterSpacing = '0px';
    }

    // Void ending screen — the true ending. No restart. Just the screen.
    // "SIGNAL LOST AT [depth]m. RECORDING ENDS."
    renderVoidEnding(player) {
        const w = this.width;
        const h = this.height;

        // Near-total black
        this.ctx.fillStyle = '#010102';
        this.ctx.fillRect(0, 0, w, h);

        // Faint star-like pinpricks — not bioluminescence, something else
        for (let i = 0; i < 30; i++) {
            const sx = (Math.sin(i * 7.3 + 0.5) * 0.5 + 0.5) * w;
            const sy = (Math.cos(i * 11.1 + 0.3) * 0.5 + 0.5) * h;
            const brightness = 0.03 + 0.02 * Math.sin(i * 3.7);
            this.ctx.fillStyle = `rgba(180, 180, 220, ${brightness})`;
            this.ctx.fillRect(sx, sy, 1, 1);
        }

        // The message — small, quiet, final
        this.ctx.font = '10px "Courier New", monospace';
        this.ctx.letterSpacing = '0.15em';
        this.ctx.fillStyle = '#2a2a3a';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`SIGNAL LOST AT ${player.depthMeters}m.`, w / 2, h / 2 - 6);

        this.ctx.fillStyle = '#1a1a28';
        this.ctx.fillText('RECORDING ENDS.', w / 2, h / 2 + 12);

        this.ctx.textAlign = 'left';
        this.ctx.letterSpacing = '0px';
    }

    // Loop transition screen — shown after defeating all Leviathans
    renderLoopTransition(nextLoop, player) {
        const w = this.width;
        const h = this.height;

        // Near-black overlay with faint crimson (you were just on floor 5)
        this.ctx.fillStyle = 'rgba(8, 0, 2, 0.94)';
        this.ctx.fillRect(0, 0, w, h);

        // "Leviathan destroyed"
        this.ctx.font = '10px "Courier New", monospace';
        this.ctx.letterSpacing = '0.15em';
        this.ctx.fillStyle = '#5a1020';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('LEVIATHAN DESTROYED', w / 2, h / 2 - 52);

        // Depth
        this.ctx.font = 'bold 20px "Courier New", monospace';
        this.ctx.fillStyle = '#3df7ff';
        this.ctx.fillText(`${player.depthMeters}m`, w / 2, h / 2 - 28);

        // Surface message
        this.ctx.font = '10px "Courier New", monospace';
        this.ctx.fillStyle = '#1a4a5a';
        this.ctx.fillText('HULL RESTORED. ASCENDING.', w / 2, h / 2 - 4);

        // Loop indicator
        this.ctx.font = 'bold 11px "Courier New", monospace';
        this.ctx.fillStyle = '#cc4455';
        this.ctx.fillText(`LOOP ${nextLoop} BEGINS`, w / 2, h / 2 + 20);

        this.ctx.font = '9px "Courier New", monospace';
        this.ctx.fillStyle = '#3a6a5a';
        this.ctx.fillText('enemies +15% per loop', w / 2, h / 2 + 36);

        this.ctx.font = '9px "Courier New", monospace';
        this.ctx.fillStyle = '#1a5a4a';
        this.ctx.fillText('[ PRESS ENTER TO DESCEND AGAIN ]', w / 2, h / 2 + 58);

        this.ctx.textAlign = 'left';
        this.ctx.letterSpacing = '0px';
    }
}
