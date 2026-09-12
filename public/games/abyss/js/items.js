// Items and pickups

class Item {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
    }
}

class ItemManager {
    constructor() {
        this.items = [];
    }

    // Spawn oxygen canisters on the map
    spawnItems(map, count, type = 'oxygen') {
        for (let i = 0; i < count; i++) {
            const tile = map.findRandomWalkableTile();
            if (tile) {
                this.items.push(new Item(tile.x, tile.y, type));
            }
        }
    }

    // Spawn stairs (only one per floor)
    // Enforces minimum distance from player so stairs never appear in starting FOV.
    // minDist should be at least viewRadius + a few tiles (default 11).
    spawnStairs(map, player, minDist = 11) {
        const maxAttempts = 200;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const tile = map.findRandomWalkableTile();
            if (!tile) break;
            if (!map.isInMainRegion(tile.x, tile.y)) continue;

            if (player) {
                const dx = tile.x - player.x;
                const dy = tile.y - player.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) continue;
            }

            this.items.push(new Item(tile.x, tile.y, 'stairs'));
            return;
        }

        // Fallback: place stairs anywhere reachable if no valid tile found
        const fallback = map.findRandomWalkableTile();
        if (fallback) {
            this.items.push(new Item(fallback.x, fallback.y, 'stairs'));
        }
    }

    // Floor drops: `count` pickups, each a hull repair kit with probability
    // TUNING.hullKitShare, otherwise an oxygen canister.
    spawnDrops(map, count) {
        for (let i = 0; i < count; i++) {
            const type = Math.random() < TUNING.hullKitShare ? 'hull' : 'oxygen';
            this.spawnItems(map, 1, type);
        }
    }

    // Get item at position
    getAt(x, y) {
        return this.items.find(item => item.x === x && item.y === y);
    }

    // Remove item at position
    removeAt(x, y) {
        const index = this.items.findIndex(item => item.x === x && item.y === y);
        if (index !== -1) {
            const item = this.items[index];
            this.items.splice(index, 1);
            return item;
        }
        return null;
    }

    // Get all items
    getAll() {
        return this.items;
    }

    // Get stairs item (or null)
    getStairs() {
        return this.items.find(item => item.type === 'stairs') || null;
    }

    // Clear all items
    clear() {
        this.items = [];
    }
}

// ─── Upgrade Pool ──────────────────────────────────────────────────────────
// All possible upgrades, organized by floor tier

const UPGRADE_POOL = {
    // Common — available on all floors
    common: [
        {
            key: 'hull_patch',
            name: 'Hull Patch',
            desc: 'Emergency seal on a breach. Restore 20 hull integrity.',
            icon: '[PATCH]'
        },
        {
            key: 'depth_mapping',
            name: 'Depth Mapping',
            desc: 'Enhanced sonar pings the stairwell. Stairs location revealed on entry.',
            icon: '[SONAR]'
        },
        {
            key: 'hull_ramming',
            name: 'Reinforced Ram',
            desc: 'Harden the bow plating. +3 attack damage permanently.',
            icon: '[RAM]'
        },
        {
            key: 'o2_recycler',
            name: 'O2 Recycler',
            desc: `Rebreather loop. Oxygen depletes ${Math.round(TUNING.recyclerStep * 100)}% slower permanently. Recovers ${Math.round(TUNING.upgradeRefillShare * 100)}% of spent oxygen.`,
            icon: '[O2+]'
        },
        {
            key: 'bulkhead_bracing',
            name: 'Bulkhead Bracing',
            desc: `Cross-braced frames. Hull takes ${Math.round(TUNING.bracingStep * 100)}% less damage permanently. Patches ${Math.round(TUNING.upgradeRefillShare * 100)}% of current damage.`,
            icon: '[BRACE]'
        },
    ],
    // Uncommon — floor 2+
    uncommon: [
        {
            key: 'reinforced_plating',
            name: 'Reinforced Plating',
            desc: 'Ablative armor layer. Reduce all incoming damage by 2.',
            icon: '[ARMOR]'
        },
        {
            key: 'enhanced_sonar',
            name: 'Enhanced Sonar',
            desc: 'Wider sweep radius. View range +1 tile permanently.',
            icon: '[VIEW+]'
        },
        {
            key: 'depth_charge',
            name: 'Depth Charge',
            desc: 'Single-use warhead. Your next attack deals triple damage.',
            icon: '[CHARGE]'
        },
    ],
    // Rare — floor 4+
    rare: [
        {
            key: 'emergency_repair',
            name: 'Emergency Repair',
            desc: 'Full hull team deployed. Restore 40 hull integrity.',
            icon: '[REPAIR]'
        },
        {
            key: 'pressure_hull',
            name: 'Pressure Hull',
            desc: 'Deep-rated construction. Maximum hull integrity +15.',
            icon: '[HULL+]'
        },
    ]
};

// Generate 3 random upgrade choices for a floor
function generateUpgradeChoices(floor) {
    const pool = [...UPGRADE_POOL.common];
    if (floor >= 2) pool.push(...UPGRADE_POOL.uncommon);
    if (floor >= 4) pool.push(...UPGRADE_POOL.rare);

    // Shuffle and pick 3 (or fewer if pool is small)
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, shuffled.length));
}
