// Combat system - bump-to-attack, damage calculation

class Combat {
    // Player attacks an enemy. Returns result object.
    // Surprise attack: if enemy is unaware, deal double damage (no counter this turn).
    static playerAttack(player, enemy) {
        const surprise = !enemy.aware;

        // Small variance to keep it interesting
        const variance = Math.floor(Math.random() * 5) - 2; // -2 to +2
        const baseDamage = Math.max(1, player.attackPower + variance);
        const rawDamage = surprise ? baseDamage * 2 : baseDamage;

        // Apply enemy armor (damage reduction) — minimum 1 damage always gets through.
        // Armor is applied AFTER surprise multiplier: ambushes pierce more effectively.
        const armor = enemy.armor || 0;
        const damage = Math.max(1, rawDamage - armor);

        const died = enemy.takeDamage(damage);

        // Surprise attack wakes the enemy
        if (surprise) enemy.aware = true;

        return {
            type: 'playerAttack',
            attacker: 'player',
            target: enemy,
            damage: damage,
            killed: died,
            surprise: surprise
        };
    }

    // Enemy attacks player. Returns result object.
    static enemyAttack(enemy, player) {
        const variance = Math.floor(Math.random() * 4) - 1; // -1 to +3
        const rawDamage = Math.max(1, enemy.damage + variance);
        // Apply player armor reduction, then Bulkhead Bracing (minimum 1 damage)
        const plated = rawDamage - (player.armorBonus || 0);
        const damage = Math.max(1, Math.round(plated * (player.hullDamageMult ?? 1)));
        player.takeDamage(damage);

        return {
            type: 'enemyAttack',
            attacker: enemy,
            target: 'player',
            damage: damage,
            killed: player.isDead()
        };
    }

    // Format a combat result into a log message
    static formatMessage(result) {
        if (result.type === 'playerAttack') {
            if (result.surprise && result.killed) {
                return {
                    text: `Ambush! The ${result.target.name} never saw you coming. Destroyed. (+${result.damage})`,
                    cssClass: 'combat'
                };
            }
            if (result.surprise) {
                return {
                    text: `Ambush strike! ${result.target.name} hit for ${result.damage}. It's aware now.`,
                    cssClass: 'combat'
                };
            }
            if (result.killed) {
                return {
                    text: `You destroy the ${result.target.name}! (+${result.damage} dmg)`,
                    cssClass: 'combat'
                };
            }
            return {
                text: `You ram the ${result.target.name} for ${result.damage} damage.`,
                cssClass: 'combat'
            };
        }

        if (result.type === 'enemyAttack') {
            if (result.killed) {
                return {
                    text: `The ${result.attacker.name} tears through your hull. SYSTEMS CRITICAL.`,
                    cssClass: 'death'
                };
            }
            return {
                text: `The ${result.attacker.name} hits your hull for ${result.damage} damage!`,
                cssClass: 'damage'
            };
        }

        return null;
    }
}
