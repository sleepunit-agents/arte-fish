// Player entity and state

class Player {
    constructor(x, y, floor = 1) {
        this.x = x;
        this.y = y;
        this.hp = 100;
        this.maxHp = 100;
        this.oxygen = 100;
        this.maxOxygen = 100;
        this.floor = floor;  // current floor number
        this.depthMeters = 100 * floor;  // starts at 100m per floor
        this.moves = 0;
        this.viewRadius = 8;
        this.attackPower = 15;   // base attack damage

        // Loop state — persists across loops within a run
        this.loopCount = 1;

        // Upgrade bonuses — all persist across loops
        this.sonarBonus = 0;      // Enhanced Sonar stacks (+1 view per pickup)
        this.armorBonus = 0;      // reduces incoming damage
        this.attackBonus = 0;     // added to attackPower (kept separate for display)
        this.oxygenDecayRate = 1; // oxygen consumed per 2 turns (default 1)
        this.depthCharge = false; // one-shot triple damage on next attack
        this.stairsRevealed = false; // sonar mapping for next floor

        // Disturbance — cumulative kill count across the run.
        // Floor 4 (The Silence) reads this to determine the ocean's response.
        // Quiet (0-3), Noticed (4-8), Hunted (9+).
        this.disturbance = 0;
    }

    moveTo(x, y) {
        this.x = x;
        this.y = y;
        this.moves++;
        // Depth increases as we move within floor
        this.depthMeters = (100 * this.floor) + Math.floor(this.moves / 5);
    }

    replenishOxygen(amount) {
        this.oxygen = Math.min(this.maxOxygen, this.oxygen + amount);
    }

    descendFloor() {
        this.floor++;
        this.depthMeters = 100 * this.floor;
        this.moves = 0;
        this.stairsRevealed = false; // reset per-floor navigation bonus
    }

    // Begin a new loop: restore hull and oxygen, increment loop counter
    beginLoop() {
        this.loopCount++;
        this.floor = 1;
        this.depthMeters = 100;
        this.moves = 0;
        this.hp = this.maxHp;     // hull restored
        this.oxygen = this.maxOxygen; // oxygen restored
        this.stairsRevealed = false;
        this.depthCharge = false; // depth charge consumed each loop
    }

    // Try to move, checking only map (not enemies — that's handled by Game)
    moveBy(dx, dy, map) {
        const newX = this.x + dx;
        const newY = this.y + dy;

        if (map.isWalkable(newX, newY)) {
            this.moveTo(newX, newY);
            return true;
        }
        return false;
    }

    // Get the target position without actually moving
    getTargetPos(dx, dy) {
        return { x: this.x + dx, y: this.y + dy };
    }

    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
    }

    consumeOxygen(amount) {
        // oxygenDecayRate < 1 means slower depletion via probabilistic skipping
        // e.g. rate=0.67: ~67% chance to consume each tick — keeps oxygen as integer
        const effective = this.oxygenDecayRate < 1
            ? (Math.random() < this.oxygenDecayRate ? amount : 0)
            : amount;
        this.oxygen = Math.max(0, this.oxygen - effective);
    }

    isDead() {
        return this.hp <= 0;
    }

    // Apply an upgrade by key
    applyUpgrade(upgradeKey) {
        switch (upgradeKey) {
            case 'hull_patch':
                this.hp = Math.min(this.maxHp, this.hp + 20);
                break;
            case 'emergency_repair':
                this.hp = Math.min(this.maxHp, this.hp + 40);
                break;
            case 'reinforced_plating':
                this.armorBonus += 2;
                break;
            case 'pressure_hull':
                this.maxHp += 15;
                this.hp += 15;
                break;
            case 'enhanced_sonar':
                this.sonarBonus += 1;
                this.viewRadius += 1;
                break;
            case 'depth_mapping':
                this.stairsRevealed = true;
                break;
            case 'depth_charge':
                this.depthCharge = true;
                break;
            case 'hull_ramming':
                this.attackPower += 3;
                this.attackBonus += 3;
                break;
            case 'o2_recycler':
                this.oxygenDecayRate = Math.max(0.5, this.oxygenDecayRate - 0.33);
                break;
        }
    }
}
