// Map generation and tile management

const MAP_WIDTH = 60;
const MAP_HEIGHT = 40;

class GameMap {
    constructor() {
        this.width = MAP_WIDTH;
        this.height = MAP_HEIGHT;
        this.tiles = {};
        this.fov = null;
        this.mainRegion = null; // set of keys in the largest connected region
    }

    generate() {
        // Use cellular automata for cave-like underwater trenches
        const map = new ROT.Map.Cellular(this.width, this.height, {
            born: [4, 5, 6, 7, 8],
            survive: [2, 3, 4, 5]
        });

        map.randomize(0.5);

        // Run several iterations to smooth it out
        for (let i = 0; i < 4; i++) {
            map.create();
        }

        // Convert to tile map
        map.create((x, y, value) => {
            const key = `${x},${y}`;
            this.tiles[key] = {
                x: x,
                y: y,
                walkable: value === 0,
                explored: false,
                visible: false
            };
        });

        // Find the largest connected region and store it
        this.mainRegion = this.findLargestRegion();

        // If the main region is too small, regenerate
        if (!this.mainRegion || this.mainRegion.size < 100) {
            this.tiles = {};
            this.generate();
            return;
        }

        // Set up FOV computation
        this.setupFOV();
    }

    // Flood-fill from a walkable tile to find all connected tiles
    floodFill(startX, startY) {
        const visited = new Set();
        const queue = [[startX, startY]];

        while (queue.length > 0) {
            const [x, y] = queue.shift();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            if (!this.isWalkable(x, y)) continue;

            visited.add(key);

            // 4-directional neighbors
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
        }

        return visited;
    }

    // Find the largest connected region among all walkable tiles
    findLargestRegion() {
        const visited = new Set();
        let largestRegion = new Set();

        for (let key in this.tiles) {
            if (!this.tiles[key].walkable) continue;
            if (visited.has(key)) continue;

            const tile = this.tiles[key];
            const region = this.floodFill(tile.x, tile.y);

            for (const k of region) visited.add(k);

            if (region.size > largestRegion.size) {
                largestRegion = region;
            }
        }

        return largestRegion;
    }

    // Generate an open void map — vast, nearly empty space.
    // Almost entirely floor with a thin border wall. The ceiling is gone.
    // Used for the void below floor 5.
    generateOpen() {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const key = `${x},${y}`;
                // Thin border — 1-tile wall at edges
                const isEdge = x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
                // Sparse pillars — very occasional walls for subtle orientation
                const isPillar = !isEdge && Math.random() < 0.005;
                this.tiles[key] = {
                    x: x,
                    y: y,
                    walkable: !isEdge && !isPillar,
                    explored: false,
                    visible: false
                };
            }
        }

        this.mainRegion = this.findLargestRegion();
        this.setupFOV();
    }

    setupFOV() {
        // Set up field of view
        this.fov = new ROT.FOV.PreciseShadowcasting((x, y) => {
            return this.isTransparent(x, y);
        });
    }

    isTransparent(x, y) {
        const key = `${x},${y}`;
        const tile = this.tiles[key];
        return tile && tile.walkable;
    }

    isWalkable(x, y) {
        const key = `${x},${y}`;
        const tile = this.tiles[key];
        return tile && tile.walkable;
    }

    // Is a tile in the main (largest) connected region?
    isInMainRegion(x, y) {
        const key = `${x},${y}`;
        return this.mainRegion ? this.mainRegion.has(key) : this.isWalkable(x, y);
    }

    getTile(x, y) {
        const key = `${x},${y}`;
        return this.tiles[key];
    }

    // Clear all tile visibility (call before addFOV to start a fresh frame)
    clearVisibility() {
        for (let key in this.tiles) {
            this.tiles[key].visible = false;
            this.tiles[key].lit = false;
        }
    }

    // Mark tiles lit by an environmental source (Anglerfish lure, item glow).
    // Lit is not seen: a lit tile only becomes visible if the player has line
    // of sight to it — resolveLighting() does that intersection. Without it,
    // a lure behind a wall revealed the whole room it stood in.
    addLight(x, y, radius) {
        this.fov.compute(x, y, radius, (x, y) => {
            const tile = this.tiles[`${x},${y}`];
            if (tile) tile.lit = true;
        });
    }

    // Reveal lit tiles the player can actually see. Line of sight here is
    // unbounded by view radius — a lure across a dark room is visible from
    // the far side; one around a corner is not.
    resolveLighting(px, py) {
        const reach = Math.max(this.width, this.height);
        this.fov.compute(px, py, reach, (x, y) => {
            const tile = this.tiles[`${x},${y}`];
            if (tile && tile.lit) {
                tile.visible = true;
                tile.explored = true;
            }
        });
    }

    // Add a light source / FOV origin — marks tiles as visible without clearing.
    // Call multiple times to union several light sources.
    addFOV(x, y, radius) {
        this.fov.compute(x, y, radius, (x, y, r, visibility) => {
            const key = `${x},${y}`;
            const tile = this.tiles[key];
            if (tile) {
                tile.visible = true;
                tile.explored = true;
            }
        });
    }

    computeFOV(x, y, radius) {
        this.clearVisibility();
        this.addFOV(x, y, radius);
    }

    // Find a random walkable tile in the main connected region
    findRandomWalkableTile() {
        const candidates = [];
        if (this.mainRegion) {
            for (const key of this.mainRegion) {
                const tile = this.tiles[key];
                if (tile && tile.walkable) candidates.push(tile);
            }
        }

        // Fallback to any walkable tile if no main region
        if (candidates.length === 0) {
            for (let key in this.tiles) {
                if (this.tiles[key].walkable) {
                    candidates.push(this.tiles[key]);
                }
            }
        }

        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // Is a tile currently lit by player FOV?
    isVisible(x, y) {
        const key = `${x},${y}`;
        const tile = this.tiles[key];
        return tile ? tile.visible : false;
    }
}
