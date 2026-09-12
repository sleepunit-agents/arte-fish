// Enemy entities and AI

// Awareness states — drives AI behavior and glow color
const AWARENESS = {
    UNAWARE:    'UNAWARE',    // wandering, no detection — normal color
    SUSPICIOUS: 'SUSPICIOUS', // moving toward last known pos — amber
    ALERTED:    'ALERTED',    // actively investigating — orange
    AGGRO:      'AGGRO',      // direct detection, chasing — red
};

class Enemy {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.hp = 0;
        this.maxHp = 0;
        this.damage = 0;
        this.name = 'Unknown';
        this.color = '#ff4444';
        this.glowColor = 'rgba(255, 68, 68, 0.3)';
        this.id = Math.random();

        // ── Awareness state machine ──────────────────────────────────────────
        // Flow: UNAWARE → (detect) → AGGRO → (lose) → ALERTED → SUSPICIOUS → UNAWARE
        this.awarenessState = AWARENESS.UNAWARE;
        this.lastKnownPlayerPos = null; // {x, y} — last confirmed player position
        this.alertTurns = 0;            // countdown for ALERTED / SUSPICIOUS states
        this.pendingAware = false;      // 1-turn surprise buffer (UNAWARE → AGGRO delay)
        this.neverDeaggros = false;     // Leviathan override: stays AGGRO forever

        this.detectionRadius = 5; // smaller than player view radius (8)

        // ── Facing & LOS Cone ──────────────────────────────────────────────
        // Enemies detect within a forward cone, not a radius bubble.
        // facing is set by movement (wander) or locked toward target (chase).
        // coneThreshold = cos(halfAngle): higher = narrower cone.
        //   -1 = 360° (detect everywhere), 0 = 180°, 0.5 = 120°, 0.707 = 90°
        this.facing = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
        this.coneThreshold = -1; // default: omnidirectional (override per type)
    }

    isAlive() { return this.hp > 0; }

    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        return this.hp <= 0;
    }

    isAt(x, y) { return this.x === x && this.y === y; }

    // ── Backward-compat shim for combat.js ──────────────────────────────────
    //
    // combat.js checks `!enemy.aware` for surprise attacks.
    // SUSPICIOUS / ALERTED enemies count as unaware — you can ambush them while
    // they're searching, which rewards breaking LOS during a chase.
    get aware() {
        return this.awarenessState === AWARENESS.AGGRO && !this.pendingAware;
    }
    // combat.js sets `enemy.aware = true` after landing a surprise hit.
    set aware(val) {
        if (val) {
            this.awarenessState = AWARENESS.AGGRO;
            this.pendingAware = false;
        }
    }

    // ── LOS Cone Detection ──────────────────────────────────────────────────
    //
    // Returns true if (targetX, targetY) is within this enemy's forward cone.
    // Angle only — walls are canSee()'s job.
    // The cone is defined by coneThreshold = cos(halfAngle).
    // Subclasses can override for exotic patterns (e.g. dual-cone jellyfish).
    //
    isInDetectionCone(targetX, targetY) {
        // Same tile = always detected
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return true;

        const facingVec = { 'N': [0,-1], 'S': [0,1], 'E': [1,0], 'W': [-1,0] }[this.facing];
        if (!facingVec) return true; // safety fallback

        // cos(angle) between facing direction and direction to target
        const cosAngle = (dx * facingVec[0] + dy * facingVec[1]) / dist;
        return cosAngle >= this.coneThreshold;
    }

    // Range, cone, and line of sight. Before the LOS check, an anglerfish
    // facing you through solid rock saw you — the cone was pure angle+radius.
    canSee(player, map) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        if (Math.sqrt(dx * dx + dy * dy) > this.detectionRadius) return false;
        if (!this.isInDetectionCone(player.x, player.y)) return false;
        return map.hasLineOfSight(this.x, this.y, player.x, player.y, this.detectionRadius + 1);
    }

    // ── Awareness update ─────────────────────────────────────────────────────
    //
    // Called at the start of each enemy turn. Drives state transitions.
    //
    // 1-turn surprise window (preserved from v0.4):
    //   Turn N:   player enters range → pendingAware = true (state still UNAWARE)
    //   Turn N+1: player attacks → surprise! THEN flush → AGGRO
    //   Turn N+2: AGGRO, no more surprise
    //
    updateAwareness(player, map) {
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const inRange = Math.sqrt(dx * dx + dy * dy) <= this.detectionRadius;

        switch (this.awarenessState) {
            case AWARENESS.UNAWARE: {
                // UNAWARE: detection requires range, the facing cone, AND an
                // unobstructed line. Walking behind an unaware enemy is safe;
                // so is standing on the far side of a wall.
                const detected = this.canSee(player, map);
                if (this.pendingAware) {
                    // Flush: go fully AGGRO
                    this.awarenessState = AWARENESS.AGGRO;
                    this.pendingAware = false;
                    this.lastKnownPlayerPos = { x: player.x, y: player.y };
                } else if (detected) {
                    this.pendingAware = true;
                    this.lastKnownPlayerPos = { x: player.x, y: player.y };
                }
                break;
            }

            case AWARENESS.SUSPICIOUS:
            case AWARENESS.ALERTED: {
                // Investigating enemies have their facing locked toward lastKnownPlayerPos.
                // They detect within their cone — approach from behind to stay hidden.
                const detected = this.canSee(player, map);
                if (detected) {
                    // Re-acquired — back to AGGRO, no surprise (already alert)
                    this.awarenessState = AWARENESS.AGGRO;
                    this.alertTurns = 0;
                    this.lastKnownPlayerPos = { x: player.x, y: player.y };
                }
                break;
            }

            case AWARENESS.AGGRO:
                // AGGRO: facing always tracks player — cone check would always pass.
                // Use simple range check. Deaggro handled by _chaseTurn (map visibility).
                if (inRange && map.hasLineOfSight(this.x, this.y, player.x, player.y, this.detectionRadius + 1)) {
                    this.lastKnownPlayerPos = { x: player.x, y: player.y };
                }
                break;
        }
    }

    // ── AI turn dispatcher ───────────────────────────────────────────────────

    takeTurn(player, map, enemies) {
        this.updateAwareness(player, map);

        switch (this.awarenessState) {
            case AWARENESS.UNAWARE:
                return this._wanderTurn(map, enemies);
            case AWARENESS.SUSPICIOUS:
            case AWARENESS.ALERTED:
                return this._investigateTurn(map, enemies);
            case AWARENESS.AGGRO:
                if (this.pendingAware) return null; // surprise window: hold position
                return this._chaseTurn(player, map, enemies);
        }
        return null;
    }

    // ── UNAWARE: random wander ───────────────────────────────────────────────
    //
    // Picks a random adjacent walkable tile. Enemies feel alive even before they
    // spot the player, and their position becomes unpredictable — making timing
    // matter for the future LOS system.
    //
    _wanderTurn(map, enemies) {
        const dirs = [
            { dx:  0, dy: -1, f: 'N' },
            { dx:  0, dy:  1, f: 'S' },
            { dx: -1, dy:  0, f: 'W' },
            { dx:  1, dy:  0, f: 'E' },
        ];
        // Fisher-Yates shuffle
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }
        for (const { dx, dy, f } of dirs) {
            const nx = this.x + dx;
            const ny = this.y + dy;
            if (map.isWalkable(nx, ny) && !enemies.some(e => e !== this && e.isAt(nx, ny))) {
                this.facing = f;
                return { type: 'move', x: nx, y: ny };
            }
        }
        return null; // completely boxed in
    }

    // ── ALERTED / SUSPICIOUS: investigate last known position ───────────────
    //
    // Moves toward lastKnownPlayerPos. Counts down alertTurns.
    // ALERTED → SUSPICIOUS → UNAWARE as turns expire.
    //
    _investigateTurn(map, enemies) {
        this.alertTurns--;
        if (this.alertTurns <= 0) {
            if (this.awarenessState === AWARENESS.ALERTED) {
                this.awarenessState = AWARENESS.SUSPICIOUS;
                this.alertTurns = 2 + Math.floor(Math.random() * 2); // 2–3 turns
            } else {
                // SUSPICIOUS → UNAWARE: gave up the search
                this.awarenessState = AWARENESS.UNAWARE;
                this.lastKnownPlayerPos = null;
            }
        }

        if (this.lastKnownPlayerPos) {
            const atTarget = this.x === this.lastKnownPlayerPos.x &&
                             this.y === this.lastKnownPlayerPos.y;
            if (atTarget) {
                return this._wanderTurn(map, enemies); // arrived — search locally
            }
            const path = this.findPath(this.lastKnownPlayerPos.x, this.lastKnownPlayerPos.y, map, enemies);
            if (path && path.length > 1) {
                const [nx, ny] = path[1];
                if (!enemies.some(e => e !== this && e.isAt(nx, ny))) {
                    this._updateFacingToward(nx, ny);
                    return { type: 'move', x: nx, y: ny };
                }
            }
        }

        return this._wanderTurn(map, enemies);
    }

    // ── AGGRO: chase and attack ──────────────────────────────────────────────
    //
    // Pathfinds toward player. Transitions to ALERTED if player leaves FOV
    // (unless neverDeaggros). Facing always tracks player while chasing.
    //
    _chaseTurn(player, map, enemies) {
        const inFOV = map.isVisible(this.x, this.y);
        if (!inFOV && !this.neverDeaggros) {
            this.awarenessState = AWARENESS.ALERTED;
            this.alertTurns = 4 + Math.floor(Math.random() * 3); // 4–6 turns
            return this._investigateTurn(map, enemies);
        }

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.abs(dx) + Math.abs(dy);

        this._updateFacingToward(player.x, player.y);

        if (dist === 1) {
            return { type: 'attack', target: player };
        }

        const path = this.findPath(player.x, player.y, map, enemies);
        if (path && path.length > 1) {
            const [nx, ny] = path[1];
            if (!enemies.some(e => e !== this && e.isAt(nx, ny))) {
                return { type: 'move', x: nx, y: ny };
            }
        }

        return null;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _updateFacingToward(tx, ty) {
        const dx = tx - this.x;
        const dy = ty - this.y;
        this.facing = Math.abs(dx) >= Math.abs(dy)
            ? (dx > 0 ? 'E' : 'W')
            : (dy > 0 ? 'S' : 'N');
    }

    findPath(targetX, targetY, map, enemies) {
        const passable = (x, y) =>
            map.isWalkable(x, y) && !enemies.some(e => e !== this && e.isAt(x, y));
        const astar = new ROT.Path.AStar(targetX, targetY, passable, { topology: 4 });
        const path = [];
        astar.compute(this.x, this.y, (x, y) => path.push([x, y]));
        return path.length > 0 ? path : null;
    }
}

// ─── Enemy Types ───────────────────────────────────────────────────────────

class Anglerfish extends Enemy {
    constructor(x, y) {
        super(x, y, 'anglerfish');
        this.name = 'Anglerfish';
        this.hp = 18;
        this.maxHp = 18;
        this.damage = 12;
        this.color = '#ff6a00';
        this.glowColor = 'rgba(255, 180, 0, 0.35)';
        this.lureDim = 1.0;
        this.lureDelta = -0.03;
        this.detectionRadius = 4;

        // LOS cone: narrow 90° forward arc. Easiest to flank.
        // cos(45°) ≈ 0.707
        this.coneThreshold = 0.707;

        // Light emission — Anglerfish lures illuminate surrounding tiles.
        // Radius breathes with lureDim: 3 when bright, 2 when dim.
        this.lightRadius = 3;
    }

    animate() {
        this.lureDim += this.lureDelta;
        if (this.lureDim <= 0.3 || this.lureDim >= 1.0) this.lureDelta *= -1;
        this.lureDim = Math.max(0.3, Math.min(1.0, this.lureDim));

        // Light breathes with the lure
        this.lightRadius = this.lureDim > 0.5 ? 3 : 2;
    }
}

class DeepCrawler extends Enemy {
    constructor(x, y) {
        super(x, y, 'deepcrawler');
        this.name = 'Deep Crawler';
        this.hp = 10;
        this.maxHp = 10;
        this.damage = 7;
        this.color = '#8844cc';
        this.glowColor = 'rgba(136, 68, 204, 0.3)';
        this.detectionRadius = 6;
        this.cascadeTriggered = 0; // pack alert notification for UI

        // LOS cone: wider 120° forward arc. Harder to predict.
        // cos(60°) = 0.5
        this.coneThreshold = 0.5;
    }

    // Override takeTurn to detect proximity-based AGGRO transitions and cascade
    takeTurn(player, map, enemies) {
        const wasBefore = this.awarenessState;
        const result = super.takeTurn(player, map, enemies);

        // Pack alerting: if we just went AGGRO from detection, alert the pack
        if (wasBefore !== AWARENESS.AGGRO && this.awarenessState === AWARENESS.AGGRO) {
            this.cascadeTriggered = this.packAlert(enemies, player);
        }

        return result;
    }

    // Alert nearby Deep Crawlers — one hop, 6-tile Euclidean radius.
    // Returns count of newly alerted crawlers.
    packAlert(enemies, player) {
        let alerted = 0;
        for (const other of enemies) {
            if (other === this) continue;
            if (other.type !== 'deepcrawler') continue;
            if (!other.isAlive()) continue;
            if (other.awarenessState === AWARENESS.AGGRO) continue;

            const dx = other.x - this.x;
            const dy = other.y - this.y;
            if (Math.sqrt(dx * dx + dy * dy) <= 6) {
                other.awarenessState = AWARENESS.AGGRO;
                other.lastKnownPlayerPos = { x: player.x, y: player.y };
                other.pendingAware = false;
                alerted++;
            }
        }
        return alerted;
    }
}

class PhantomJellyfish extends Enemy {
    constructor(x, y) {
        super(x, y, 'phantomjellyfish');
        this.name = 'Phantom Jellyfish';
        this.hp = 14;
        this.maxHp = 14;
        this.damage = 10;
        this.color = '#b478ff';
        this.glowColor = 'rgba(180, 120, 255, 0.4)';
        this.tentaclePulse = 0;
        this.detectionRadius = 5;
        this.passive = false;      // Floor 3: doesn't detect player from proximity
        this.carriedOxygen = 0;    // Floor 3: oxygen released on death

        // LOS cone: 2-directional — looks forward AND perpendicular (90° CW).
        // Pattern is learnable: N→also E, E→also S, S→also W, W→also N.
        // Each sub-cone is 90° (same as Anglerfish).
        this.coneThreshold = 0.707; // used for each sub-cone check
    }

    // Dual-cone: forward + perpendicular (90° clockwise from facing).
    // Two 90° cones = 180° coverage in two discrete directions.
    isInDetectionCone(targetX, targetY) {
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return true;

        const facingVecs = {
            'N': { fwd: [0,-1], perp: [1,0] },   // N + E
            'E': { fwd: [1,0],  perp: [0,1] },    // E + S
            'S': { fwd: [0,1],  perp: [-1,0] },   // S + W
            'W': { fwd: [-1,0], perp: [0,-1] },   // W + N
        };
        const vecs = facingVecs[this.facing];
        if (!vecs) return true;

        // Check forward cone
        const cosFwd = (dx * vecs.fwd[0] + dy * vecs.fwd[1]) / dist;
        if (cosFwd >= this.coneThreshold) return true;

        // Check perpendicular cone
        const cosPerp = (dx * vecs.perp[0] + dy * vecs.perp[1]) / dist;
        return cosPerp >= this.coneThreshold;
    }

    // Passive jellyfish don't detect the player from proximity.
    // They only go AGGRO when directly attacked (via the aware setter in combat).
    // Once aggro'd and deaggro'd, they return to passive wandering.
    updateAwareness(player, map) {
        if (this.passive && this.awarenessState !== AWARENESS.AGGRO) {
            return; // no proximity detection — drift peacefully
        }
        super.updateAwareness(player, map);
    }

    animate() { this.tentaclePulse += this.passive ? 0.05 : 0.1; }
}

class Leviathan extends Enemy {
    constructor(x, y) {
        super(x, y, 'leviathan');
        this.name = 'Leviathan';
        this.hp = 30;
        this.maxHp = 30;
        this.damage = 18;
        this.color = '#ff5078';
        this.glowColor = 'rgba(255, 80, 120, 0.45)';
        this.eyePulse = 0;
        this.detectionRadius = 8; // equals player default view — no stealth zone
        this.neverDeaggros = true; // once it sees you, it does not stop

        // Armor — damage reduction applied before HP loss (minimum 1 damage through)
        this.armor = 5;

        // Patrol sweep state — the Leviathan searches methodically, not randomly.
        // Straight line → wall → 90° turn (80% clockwise, 20% counter).
        // After 3-4 segments, pauses 1-2 turns (listening).
        this.patrolDir = ['N', 'S', 'E', 'W'][Math.floor(Math.random() * 4)];
        this.patrolSegments = 0;  // segments completed since last pause
        this.pauseTurns = 0;      // turns remaining in a listening pause

        // Void aura — anti-light field. Within 3 tiles, player view -2.
        this.voidAuraRadius = 3;
        this.voidAuraReduction = 2;
    }

    animate() { this.eyePulse += 0.08; }

    // Override wander with systematic patrol sweep.
    // The Leviathan moves in a straight line until blocked, then turns.
    // After 3-4 line segments, pauses for 1-2 turns (listening).
    // The pattern is readable but not mechanical — small randomness in turns.
    _wanderTurn(map, enemies) {
        // Listening pause
        if (this.pauseTurns > 0) {
            this.pauseTurns--;
            return null;
        }

        const dirVectors = {
            'N': { dx: 0, dy: -1 },
            'S': { dx: 0, dy: 1 },
            'E': { dx: 1, dy: 0 },
            'W': { dx: -1, dy: 0 },
        };
        const clockwise = { 'N': 'E', 'E': 'S', 'S': 'W', 'W': 'N' };
        const counter   = { 'N': 'W', 'W': 'S', 'S': 'E', 'E': 'N' };

        const { dx, dy } = dirVectors[this.patrolDir];
        const nx = this.x + dx;
        const ny = this.y + dy;

        if (map.isWalkable(nx, ny) && !enemies.some(e => e !== this && e.isAt(nx, ny))) {
            // Continue straight
            this.facing = this.patrolDir;
            return { type: 'move', x: nx, y: ny };
        }

        // Blocked — turn. 80% clockwise, 20% counter-clockwise.
        this.patrolDir = Math.random() < 0.8
            ? clockwise[this.patrolDir]
            : counter[this.patrolDir];
        this.patrolSegments++;

        // After 3-4 segments, pause for 1-2 turns (listening)
        if (this.patrolSegments >= 3 + Math.floor(Math.random() * 2)) {
            this.pauseTurns = 1 + Math.floor(Math.random() * 2);
            this.patrolSegments = 0;
        }

        // Try the new direction immediately
        const newVec = dirVectors[this.patrolDir];
        const nx2 = this.x + newVec.dx;
        const ny2 = this.y + newVec.dy;
        if (map.isWalkable(nx2, ny2) && !enemies.some(e => e !== this && e.isAt(nx2, ny2))) {
            this.facing = this.patrolDir;
            return { type: 'move', x: nx2, y: ny2 };
        }

        return null; // boxed in — hold position
    }
}

// ─── Enemy Manager ─────────────────────────────────────────────────────────

class EnemyManager {
    constructor() {
        this.enemies = [];
    }

    spawnEnemies(map, player, count, floor = 1) {
        let ENEMY_TYPES;
        if (floor === 1) {
            ENEMY_TYPES = [Anglerfish];                // The Lure: only light-bearers
        } else if (floor === 2) {
            ENEMY_TYPES = [DeepCrawler];               // The Pack: only crawlers
        } else if (floor === 3) {
            ENEMY_TYPES = [PhantomJellyfish];           // The Harvest: only passive jellyfish
        } else if (floor === 4) {
            // The Silence: all three types coexist for the first time.
            // Anglerfish (light/proximity), Crawlers (cascade), Jellyfish (oxygen).
            ENEMY_TYPES = [Anglerfish, DeepCrawler, PhantomJellyfish];
        } else {
            ENEMY_TYPES = [Leviathan, PhantomJellyfish];
        }

        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 30;
        const MIN_SPAWN_DIST = 5;

        while (spawned < count && attempts < maxAttempts) {
            attempts++;
            const tile = map.findRandomWalkableTile();
            if (!tile) break;
            if (!map.isInMainRegion(tile.x, tile.y)) continue;
            const dx = tile.x - player.x;
            const dy = tile.y - player.y;
            if (Math.sqrt(dx * dx + dy * dy) < MIN_SPAWN_DIST) continue;
            if (this.getAt(tile.x, tile.y)) continue;

            const EnemyClass = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
            this.enemies.push(new EnemyClass(tile.x, tile.y));
            spawned++;
        }

        // Floor 3 (The Harvest): jellyfish are passive and carry oxygen
        if (floor === 3) {
            for (const enemy of this.enemies) {
                if (enemy.type === 'phantomjellyfish') {
                    enemy.passive = true;
                    enemy.carriedOxygen = 15;
                }
            }
        }
    }

    scaleForLoop(loopCount) {
        if (loopCount <= 1) return;
        const scale = 1 + 0.15 * (loopCount - 1);
        for (const enemy of this.enemies) {
            enemy.hp = Math.round(enemy.maxHp * scale);
            enemy.maxHp = enemy.hp;
            enemy.damage = Math.round(enemy.damage * scale);
        }
    }

    getAt(x, y) {
        return this.enemies.find(e => e.isAlive() && e.isAt(x, y)) || null;
    }

    cleanup() {
        this.enemies = this.enemies.filter(e => e.isAlive());
    }

    processTurns(player, map) {
        const results = [];
        for (const enemy of this.enemies) {
            if (!enemy.isAlive()) continue;
            const action = enemy.takeTurn(player, map, this.enemies);

            // Pack cascade notification (Deep Crawlers — proximity detection path)
            if (enemy.cascadeTriggered > 0) {
                results.push({ type: 'packCascade', count: enemy.cascadeTriggered });
                enemy.cascadeTriggered = 0;
            }

            if (!action) continue;
            if (action.type === 'move') {
                enemy.x = action.x;
                enemy.y = action.y;
            } else if (action.type === 'attack') {
                results.push({ type: 'enemyAttack', enemy, damage: enemy.damage });
            }
        }
        for (const enemy of this.enemies) {
            if (enemy.animate) enemy.animate();
        }
        return results;
    }
}
