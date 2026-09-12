// Balance knobs — the numbers to turn as people play. Loaded before every
// other module, so anything below can read TUNING at definition time.

const TUNING = {
    // Floor drops: the same count as before, this share of them hull repair
    // kits instead of oxygen canisters.
    hullKitShare: 0.20,
    hullKitRepair: 25,

    // O2 Recycler: each pickup cuts oxygen use by recyclerStep, down to
    // recyclerMinRate of normal.
    recyclerStep: 0.33,
    recyclerMinRate: 0.5,

    // Bulkhead Bracing: each pickup cuts incoming hull damage by bracingStep,
    // down to bracingMinMult of normal. Applied after Reinforced Plating.
    bracingStep: 0.25,
    bracingMinMult: 0.5,

    // Taking either of those also refills this share of what is missing
    // (spent oxygen / hull damage). 0 turns it off.
    upgradeRefillShare: 0.25,
};
