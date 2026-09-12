// Main game loop and initialization

const ENEMY_COUNT = 8; // base enemies per map
const DEBUG = /[?&]debug\b/.test(window.location.search);

// Loop opening messages (Floor 1 entry)
const LOOP_MESSAGES = [
    'Descending into the abyss...',       // loop 1
    'You remember the descent.',           // loop 2
    'The water remembers you.',            // loop 3
    'The Leviathan is waiting.',           // loop 4+
];

// Per-loop floor entry messages. Each floor maps to an array of message arrays.
// Index 0 = loop 1 (teach), 1 = loop 2 (recognition), 2+ = loop 3+ (familiarity).
// Falls back to last defined variant for higher loops.
const FLOOR_MESSAGES = {
    2: [
        ['Movement in the walls. They hunt in packs.'],
        ['The packs are waiting. They remember formation.'],
        ['The packs.'],
    ],
    3: [
        ['Jellyfish drift in the current. They carry oxygen.', 'No canisters this deep.'],
        ['The jellyfish are still here. You know what they carry.'],
        ['The harvest.'],
    ],
    5: [
        ['Something massive is down here.'],
        ["It's here. Waiting, like before."],
        ['Again.'],
    ],
};

// Floor 4 messages vary by disturbance AND loop.
const FLOOR4_MESSAGES = {
    quiet: [
        ['The water is still.'],
        ['Still waters. You passed through gently.'],
        ['Stillness.'],
    ],
    noticed: [
        ['Something has changed in the current.'],
        ['The current shifts. It felt you arrive.'],
        ['The ocean stirs.'],
    ],
    hunted: [
        ['The water remembers you.', 'No canisters. The jellyfish carry what you need.'],
        ['They are already searching.', 'You know what the jellyfish carry.'],
        ['The hunt.'],
    ],
};

// Leviathan death messages per loop.
const LEVIATHAN_DEATH_MESSAGES = [
    ['The deep goes quiet.', 'Two paths. One leads up. One leads down.'],
    ['Quiet again.', 'You know the choice.'],
    ['Silence.', 'Up. Or down.'],
];

// Void entry messages per loop.
const VOID_ENTRY_MESSAGES = [
    ['Descending past floor 5. Sonar returns no floor below.', 'Depth: unknown.'],
    ['Past the floor. Into nothing.'],
    ['Down.'],
];

// Pick the right message variant for the current loop count.
function getLoopVariant(messageArray, loopCount) {
    const idx = Math.min(loopCount - 1, messageArray.length - 1);
    return messageArray[idx];
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.ui = new UI();
        this.map = null;
        this.player = null;
        this.enemyManager = null;
        this.itemManager = null;

        // Game states: 'playing' | 'upgrading' | 'looptransition' | 'gameover'
        //              | 'leviathandeath' | 'void'
        this.state = 'playing';
        this.turn = 0;
        this.currentFloor = 1;

        // Upgrade screen state
        this.pendingUpgrades = [];

        // Floor 4 disturbance tier — set when floor 4 generates
        this.disturbanceTier = null;

        this.init();
    }

    init() {
        this.state = 'playing';
        this.turn = 0;
        this.currentFloor = 1;
        this.pendingUpgrades = [];
        this.disturbanceTier = null;
        this.player = null; // Full reset on new game

        // Reset renderer state
        if (this.renderer) {
            this.renderer.damageFlash = 0;
            this.renderer.particles = this.renderer.generateParticles();
        }

        this.generateFloor(this.currentFloor);
    }

    generateFloor(floorNum) {
        // Reset floor-specific state so it doesn't leak between floors
        this.disturbanceTier = null;

        this.map = new GameMap();
        this.map.generate();

        const startTile = this.map.findRandomWalkableTile();
        if (!this.player) {
            this.player = new Player(startTile.x, startTile.y, floorNum);
        } else {
            this.player.x = startTile.x;
            this.player.y = startTile.y;
        }

        // Spawn enemies: count varies by floor design
        this.enemyManager = new EnemyManager();
        const loopBonus = this.player ? (this.player.loopCount - 1) : 0;
        let enemyCount;
        if (floorNum === 2) {
            // The Pack: more crawlers than usual (x1.3)
            enemyCount = Math.round((ENEMY_COUNT + Math.floor(floorNum / 2) + loopBonus) * 1.3);
        } else if (floorNum === 3) {
            // The Harvest: 4-5 passive jellyfish (tuned for oxygen balance)
            enemyCount = 4 + Math.floor(Math.random() * 2) + loopBonus;
        } else {
            enemyCount = ENEMY_COUNT + Math.floor(floorNum / 2) + loopBonus;
        }
        this.enemyManager.spawnEnemies(this.map, this.player, enemyCount, floorNum);

        // Floor 4 (The Silence): adapt to player's accumulated disturbance.
        // The ocean reads your kill history and responds.
        if (floorNum === 4 && this.player) {
            this._applyDisturbanceTier();
        }

        // Scale enemy stats for current loop
        if (this.player && this.player.loopCount > 1) {
            this.enemyManager.scaleForLoop(this.player.loopCount);
        }

        // Floor 1 (The Lure): reduced view radius — pressure at depth limits
        // sonar. The cave is dark; Anglerfish lures are your navigational aids.
        // Killing them removes their light. On other floors, full view restored.
        // Set BEFORE spawning items so stairs distance respects current view.
        const baseView = floorNum === 1 ? 5 : 8;
        this.player.viewRadius = baseView + this.player.sonarBonus;

        // Spawn items — canister count varies by floor design and disturbance
        this.itemManager = new ItemManager();
        const noOxygenCanisters = floorNum === 3 || this.disturbanceTier === 'hunted';
        if (!noOxygenCanisters) {
            let oxygenCount;
            if (this.disturbanceTier === 'quiet') {
                oxygenCount = 4 + Math.floor(Math.random() * 2); // 4-5 (plentiful)
            } else if (this.disturbanceTier === 'noticed') {
                oxygenCount = 2 + Math.floor(Math.random() * 2); // 2-3 (reduced)
            } else {
                oxygenCount = 2 + Math.floor(Math.random() * 3); // 2-4 (normal)
            }
            this.itemManager.spawnItems(this.map, oxygenCount, 'oxygen');
        }
        // Pass player so stairs spawn outside starting FOV (min dist = viewRadius + 3)
        this.itemManager.spawnStairs(this.map, this.player, this.player.viewRadius + 3);

        // Reveal stairs: depth_mapping upgrade OR Floor 3 (you know WHERE to go)
        if ((this.player && this.player.stairsRevealed) || floorNum === 3) {
            const stairs = this.itemManager.getStairs();
            if (stairs) stairs.revealed = true;
        }

        this.updateFOV();
        this.render();
        this.ui.update(this.player);

        const loop = this.player ? this.player.loopCount : 1;

        if (floorNum === 1) {
            this.ui.clear();
            const loopIdx = Math.min(loop - 1, LOOP_MESSAGES.length - 1);
            this.ui.addMessage(LOOP_MESSAGES[loopIdx], 'system');
            if (loop > 1) {
                this.ui.addMessage(`Loop ${loop}. Enemies stronger.`, 'system');
            }
            // Only teach sonar on first descent — player knows by loop 2
            if (loop === 1) {
                this.ui.addMessage('Sonar range limited. Follow the light.', 'system');
            }
        } else {
            this.ui.addMessage(`Floor ${floorNum}. ${100 * floorNum}m depth.`, 'system');

            if (floorNum === 4) {
                // Floor 4: disturbance tier × loop
                const tierMessages = FLOOR4_MESSAGES[this.disturbanceTier] || FLOOR4_MESSAGES.quiet;
                const msgs = getLoopVariant(tierMessages, loop);
                msgs.forEach(m => this.ui.addMessage(m, 'system'));
            } else if (FLOOR_MESSAGES[floorNum]) {
                // Floors 2, 3, 5: loop-aware messages
                const msgs = getLoopVariant(FLOOR_MESSAGES[floorNum], loop);
                msgs.forEach(m => this.ui.addMessage(m, 'system'));
            }
        }
    }

    // Called when player steps on stairs — show upgrade screen before descending
    triggerUpgradeScreen() {
        this.state = 'upgrading';
        this.pendingUpgrades = generateUpgradeChoices(this.currentFloor);
        this.renderer.renderUpgradeScreen(this.pendingUpgrades, this.currentFloor);
    }

    // Apply chosen upgrade and descend
    applyUpgradeAndDescend(choice) {
        if (choice < 0 || choice >= this.pendingUpgrades.length) return;

        const upgrade = this.pendingUpgrades[choice];
        this.player.applyUpgrade(upgrade.key);
        this.ui.addMessage(`System upgrade: ${upgrade.name}`, 'pickup');

        this.state = 'playing';
        this.pendingUpgrades = [];
        this.currentFloor++;
        this.player.descendFloor();

        this.generateFloor(this.currentFloor);
    }

    // Called when all Leviathans on floor 5 are dead — loop complete
    checkLeviathanVictory() {
        if (this.currentFloor < 5) return false;
        const leviathansAlive = this.enemyManager.enemies.some(
            e => e.type === 'leviathan' && e.isAlive()
        );
        return !leviathansAlive;
    }

    // Leviathan death: the deep goes quiet. All enemies reset to UNAWARE.
    // Disturbance counter resets. Two exits appear: stairs up, void passage down.
    triggerLeviathanDeath() {
        // The ocean exhales
        for (const enemy of this.enemyManager.enemies) {
            if (enemy.isAlive()) {
                enemy.awarenessState = AWARENESS.UNAWARE;
                enemy.lastKnownPlayerPos = null;
                enemy.alertTurns = 0;
                enemy.pendingAware = false;
            }
        }
        this.player.disturbance = 0;

        // Loop-aware Leviathan death narration
        const loop = this.player ? this.player.loopCount : 1;
        const deathMsgs = getLoopVariant(LEVIATHAN_DEATH_MESSAGES, loop);
        deathMsgs.forEach(m => this.ui.addMessage(m, 'system'));

        // Spawn dual exits near the player
        // Stairs up (green, familiar) — surface and loop
        // Void passage (dim white) — the true ending
        const stairsUp = this._spawnNearPlayer('stairs_up', 4, 8);
        const voidPassage = this._spawnNearPlayer('void_passage', 4, 8);

        if (stairsUp) stairsUp.revealed = true;
        if (voidPassage) voidPassage.revealed = true;

        this.state = 'playing'; // resume immediately — player walks to their choice
        this.updateFOV();
        this.render();
    }

    // Spawn an item near the player at a reasonable distance
    _spawnNearPlayer(type, minDist, maxDist) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const tile = this.map.findRandomWalkableTile();
            if (!tile) continue;
            if (!this.map.isInMainRegion(tile.x, tile.y)) continue;
            const dx = tile.x - this.player.x;
            const dy = tile.y - this.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist || dist > maxDist) continue;
            if (this.enemyManager.getAt(tile.x, tile.y)) continue;
            if (this.itemManager.getAt(tile.x, tile.y)) continue;

            const item = new Item(tile.x, tile.y, type);
            this.itemManager.items.push(item);
            return item;
        }
        // Fallback: place it anywhere
        const tile = this.map.findRandomWalkableTile();
        if (tile) {
            const item = new Item(tile.x, tile.y, type);
            this.itemManager.items.push(item);
            return item;
        }
        return null;
    }

    // Generate the void floor — vast, open, empty, dark.
    // No enemies. No items. No stairs. Just descent until the oxygen runs out.
    generateVoidFloor() {
        this.state = 'void';
        this.currentFloor = 6; // beyond floor 5
        this.map = new GameMap();
        this.map.generateOpen(); // open void map
        this.enemyManager = new EnemyManager();
        this.itemManager = new ItemManager();

        // Place player in the center
        const cx = Math.floor(MAP_WIDTH / 2);
        const cy = Math.floor(MAP_HEIGHT / 2);
        this.player.x = cx;
        this.player.y = cy;
        this.player.floor = 6;
        this.player.moves = 0;

        this.updateFOV();
        this.render();
        this.ui.update(this.player);
    }

    // Begin a new loop
    triggerLoopTransition() {
        const nextLoop = this.player.loopCount + 1;
        this.player.beginLoop();
        this.currentFloor = 1;
        this.turn = 0;
        this.state = 'looptransition';
        this.renderer.renderLoopTransition(nextLoop, this.player);
    }

    setupInput() {
        window.addEventListener('keydown', (e) => {
            // Void ending: no restart. The screen holds. Close the tab.
            if (this.state === 'voidending') {
                return; // swallow all input
            }

            // Loop transition screen: press Enter to continue
            if (this.state === 'looptransition') {
                if (e.key === 'Enter') {
                    this.state = 'playing';
                    this.generateFloor(1);
                }
                return;
            }

            // Game over: press Enter to restart fresh
            if (this.state === 'gameover') {
                if (e.key === 'Enter') {
                    this.init();
                }
                return;
            }

            // Upgrade screen: 1/2/3 to pick
            if (this.state === 'upgrading') {
                if (e.key === '1') { this.applyUpgradeAndDescend(0); e.preventDefault(); }
                else if (e.key === '2') { this.applyUpgradeAndDescend(1); e.preventDefault(); }
                else if (e.key === '3') { this.applyUpgradeAndDescend(2); e.preventDefault(); }
                return;
            }

            // Debug keys: Shift + Number to jump to floor (1-9). Only with ?debug in the URL.
            if (DEBUG && e.shiftKey && e.key >= '1' && e.key <= '9') {
                const targetFloor = parseInt(e.key);
                this.currentFloor = targetFloor;
                this.player.floor = targetFloor;
                this.player.depthMeters = 100 * targetFloor;
                this.ui.addMessage(`[DEBUG] Jumping to floor ${targetFloor}...`, 'system');
                this.generateFloor(targetFloor);
                e.preventDefault();
                return;
            }

            let acted = false;

            let dx = 0, dy = 0;
            switch(e.key) {
                case 'ArrowUp':
                case 'w':
                case 'W':
                    dx = 0; dy = -1; break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    dx = 0; dy = 1; break;
                case 'ArrowLeft':
                case 'a':
                case 'A':
                    dx = -1; dy = 0; break;
                case 'ArrowRight':
                case 'd':
                case 'D':
                    dx = 1; dy = 0; break;
                default:
                    return;
            }

            e.preventDefault();

            const target = this.player.getTargetPos(dx, dy);
            const enemyAtTarget = this.enemyManager.getAt(target.x, target.y);

            if (enemyAtTarget) {
                // Apply depth charge if active (triple damage, one-shot)
                let savedAttackPower = null;
                if (this.player.depthCharge) {
                    savedAttackPower = this.player.attackPower;
                    this.player.attackPower *= 3;
                    this.player.depthCharge = false;
                    this.ui.addMessage('DEPTH CHARGE DETONATED!', 'combat');
                }

                const result = Combat.playerAttack(this.player, enemyAtTarget);

                if (savedAttackPower !== null) {
                    this.player.attackPower = savedAttackPower;
                }

                const msg = Combat.formatMessage(result);
                if (msg) this.ui.addMessage(msg.text, msg.cssClass);

                // Pack cascade: attacking a Deep Crawler alerts the pack
                if (enemyAtTarget.type === 'deepcrawler' && enemyAtTarget.packAlert) {
                    const alerted = enemyAtTarget.packAlert(
                        this.enemyManager.enemies, this.player
                    );
                    if (alerted > 0) {
                        this.ui.addMessage('Vibrations ripple through the walls...', 'system');
                    }
                }

                if (result.killed) {
                    // Track kill for Floor 4 disturbance system
                    this.player.disturbance++;

                    // Passive jellyfish release carried oxygen on death
                    if (enemyAtTarget.carriedOxygen > 0) {
                        this.player.replenishOxygen(enemyAtTarget.carriedOxygen);
                        this.ui.addMessage(
                            `The jellyfish drifts apart. +${enemyAtTarget.carriedOxygen} O2.`,
                            'pickup'
                        );
                    }

                    // Floor 4 Hunted: death makes noise. All Deep Crawlers
                    // within 8 tiles go SUSPICIOUS on any kill.
                    if (this.disturbanceTier === 'hunted') {
                        let cascaded = 0;
                        for (const other of this.enemyManager.enemies) {
                            if (!other.isAlive()) continue;
                            if (other === enemyAtTarget) continue;
                            if (other.type !== 'deepcrawler') continue;
                            if (other.awarenessState === AWARENESS.AGGRO) continue;
                            const ddx = other.x - enemyAtTarget.x;
                            const ddy = other.y - enemyAtTarget.y;
                            if (Math.sqrt(ddx * ddx + ddy * ddy) <= 8) {
                                other.awarenessState = AWARENESS.SUSPICIOUS;
                                other.lastKnownPlayerPos = { x: this.player.x, y: this.player.y };
                                other.alertTurns = 4;
                                cascaded++;
                            }
                        }
                        if (cascaded > 0) {
                            this.ui.addMessage('The death echoes through the water...', 'system');
                        }
                    }

                    this.enemyManager.cleanup();

                    // Check for Leviathan victory — triggers death sequence, not loop
                    if (this.checkLeviathanVictory()) {
                        this.triggerLeviathanDeath();
                        return;
                    }
                }
                acted = true;
            } else {
                const moved = this.player.moveBy(dx, dy, this.map);
                if (moved) {
                    const item = this.itemManager.getAt(this.player.x, this.player.y);
                    if (item) {
                        if (item.type === 'oxygen') {
                            this.player.replenishOxygen(50);
                            this.itemManager.removeAt(item.x, item.y);
                            this.ui.addMessage('Oxygen canister recovered. +50 O2.', 'pickup');
                        } else if (item.type === 'stairs') {
                            this.itemManager.removeAt(item.x, item.y);
                            // Show upgrade screen before descending
                            this.triggerUpgradeScreen();
                            return;
                        } else if (item.type === 'stairs_up') {
                            // Surface — loop transition
                            this.itemManager.removeAt(item.x, item.y);
                            this.ui.addMessage('ASCENDING. HULL RESTORED.', 'system');
                            this.triggerLoopTransition();
                            return;
                        } else if (item.type === 'void_passage') {
                            // The void — descend past everything
                            this.itemManager.removeAt(item.x, item.y);
                            this.ui.clear();
                            const voidLoop = this.player ? this.player.loopCount : 1;
                            const voidMsgs = getLoopVariant(VOID_ENTRY_MESSAGES, voidLoop);
                            voidMsgs.forEach(m => this.ui.addMessage(m, 'system'));
                            this.generateVoidFloor();
                            return;
                        }
                    }
                    acted = true;
                }
            }

            if (acted) {
                this.turn++;
                this.updateFOV();

                // Consume oxygen — every other turn normally, every turn in the void
                const oxygenTick = this.state === 'void'
                    ? true                     // void: 1 per turn (2× rate)
                    : (this.turn % 2 === 0);   // normal: 1 per 2 turns
                if (oxygenTick) {
                    this.player.consumeOxygen(1);
                    if (this.player.oxygen <= 0 && !this.player.isDead()) {
                        if (this.state === 'void') {
                            // Void death — the true ending
                            this.state = 'voidending';
                            this.ui.addMessage(`SIGNAL LOST AT ${this.player.depthMeters}m. RECORDING ENDS.`, 'death');
                            this.renderer.renderVoidEnding(this.player);
                            return;
                        } else {
                            this.ui.addMessage('OXYGEN DEPLETED. SUFFOCATING.', 'death');
                        }
                    }
                }

                // Enemy turns
                const enemyResults = this.enemyManager.processTurns(this.player, this.map);
                for (const result of enemyResults) {
                    if (result.type === 'packCascade') {
                        this.ui.addMessage('Vibrations ripple through the walls...', 'system');
                        continue;
                    }
                    const combatResult = Combat.enemyAttack(result.enemy, this.player);
                    const msg = Combat.formatMessage(combatResult);
                    if (msg) this.ui.addMessage(msg.text, msg.cssClass);

                    if (combatResult.damage > 0) {
                        this.renderer.triggerDamageFlash();
                    }

                    // Leviathan shockwave: when it attacks, all enemies within
                    // 5 tiles go AGGRO. The boss fight is not a 1v1.
                    if (result.enemy.type === 'leviathan') {
                        let shockwaved = 0;
                        for (const other of this.enemyManager.enemies) {
                            if (!other.isAlive()) continue;
                            if (other === result.enemy) continue;
                            if (other.awarenessState === AWARENESS.AGGRO) continue;
                            const sdx = other.x - result.enemy.x;
                            const sdy = other.y - result.enemy.y;
                            if (Math.sqrt(sdx * sdx + sdy * sdy) <= 5) {
                                other.awarenessState = AWARENESS.AGGRO;
                                other.lastKnownPlayerPos = { x: this.player.x, y: this.player.y };
                                other.pendingAware = false;
                                shockwaved++;
                            }
                        }
                        if (shockwaved > 0) {
                            this.ui.addMessage('The impact ripples outward. Everything stirs.', 'system');
                        }
                    }
                }

                this.ui.update(this.player);

                // Check player death (void ending handled above in oxygen tick)
                if (this.state !== 'voidending') {
                    if (this.player.isDead() || this.player.oxygen <= 0) {
                        if (this.state === 'void') {
                            // Void death
                            this.state = 'voidending';
                            this.renderer.renderVoidEnding(this.player);
                            return;
                        }
                        this.state = 'gameover';
                        if (this.player.hp <= 0) {
                            this.ui.addMessage('HULL BREACHED. ALL SYSTEMS OFFLINE.', 'death');
                        }
                    }
                }

                this.render();

                if (this.state === 'gameover') {
                    this.renderer.renderGameOver(this.player);
                } else if (this.state === 'voidending') {
                    this.renderer.renderVoidEnding(this.player);
                }
            }
        });
    }

    // ── Floor 4: The Silence — Disturbance Tier System ──────────────────
    //
    // The ocean adapts to how you played floors 1-3.
    //   Quiet  (0-3 kills): The water is still. Normal spawns.
    //   Noticed (4-8 kills): Something has changed. Enemies start SUSPICIOUS.
    //   Hunted  (9+ kills): The water remembers you. Enemies start ALERTED.
    //
    _applyDisturbanceTier() {
        const d = this.player.disturbance;

        if (d <= 3) {
            // Quiet: the ocean doesn't know you're here. No modifications.
            this.disturbanceTier = 'quiet';
        } else if (d <= 8) {
            // Noticed: enemies spawn SUSPICIOUS, detection +1, fewer canisters
            this.disturbanceTier = 'noticed';
            for (const enemy of this.enemyManager.enemies) {
                enemy.awarenessState = AWARENESS.SUSPICIOUS;
                enemy.lastKnownPlayerPos = {
                    x: Math.floor(MAP_WIDTH / 2),
                    y: Math.floor(MAP_HEIGHT / 2)
                };
                enemy.alertTurns = 6;
                enemy.detectionRadius += 1;
            }
        } else {
            // Hunted: enemies spawn ALERTED, detection +2, no canisters —
            // only jellyfish carry O2, and they're NOT passive.
            // Pack alerting is active on ALL enemy types.
            this.disturbanceTier = 'hunted';
            for (const enemy of this.enemyManager.enemies) {
                enemy.awarenessState = AWARENESS.ALERTED;
                enemy.lastKnownPlayerPos = {
                    x: Math.floor(MAP_WIDTH / 2),
                    y: Math.floor(MAP_HEIGHT / 2)
                };
                enemy.alertTurns = 8;
                enemy.detectionRadius += 2;
            }
            // Give jellyfish oxygen (they're NOT passive on floor 4 Hunted)
            for (const enemy of this.enemyManager.enemies) {
                if (enemy.type === 'phantomjellyfish') {
                    enemy.carriedOxygen = 15;
                }
            }
        }
    }

    updateFOV() {
        // Multi-source FOV: player vision + environmental light sources.
        // On Floor 1 (The Lure), player view is 5 — Anglerfish lures and item
        // glows become the primary navigational aids. Killing an Anglerfish
        // removes its light permanently. Information has a cost.
        this.map.clearVisibility();

        // Void aura: the Leviathan emits an anti-light field. Within 3 tiles,
        // player view radius is reduced by 2 (minimum 3). Approaching the thing
        // you need to attack also means seeing less. Floor 1 taught you light
        // costs proximity; Floor 5 inverts it — approach the danger, lose the light.
        let effectiveViewRadius = this.player.viewRadius;
        if (this.enemyManager) {
            for (const enemy of this.enemyManager.enemies) {
                if (enemy.type === 'leviathan' && enemy.isAlive()) {
                    const dx = this.player.x - enemy.x;
                    const dy = this.player.y - enemy.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= (enemy.voidAuraRadius || 3)) {
                        effectiveViewRadius = Math.max(3, effectiveViewRadius - (enemy.voidAuraReduction || 2));
                    }
                }
            }
        }
        this.map.addFOV(this.player.x, this.player.y, effectiveViewRadius);

        // Anglerfish emit light from their lures (radius breathes with lureDim)
        if (this.enemyManager) {
            for (const enemy of this.enemyManager.enemies) {
                if (enemy.type === 'anglerfish' && enemy.isAlive()) {
                    this.map.addFOV(enemy.x, enemy.y, enemy.lightRadius);
                }
            }
        }

        // On Floor 1: items emit faint 1-tile glow (breadcrumbs in the dark)
        if (this.currentFloor === 1 && this.itemManager) {
            for (const item of this.itemManager.items) {
                this.map.addFOV(item.x, item.y, 1);
            }
        }
    }

    render() {
        this.renderer.render(this.map, this.player, this.enemyManager, this.itemManager);
    }
}

// Start the game when page loads
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.setupInput();
});
