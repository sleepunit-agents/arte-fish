// UI updates - HUD elements and message log

class UI {
    constructor() {
        this.depthEl = document.getElementById('depth');
        this.hpEl = document.getElementById('hp');
        this.oxygenEl = document.getElementById('oxygen');
        this.loopEl = document.getElementById('loop');
        this.loopDisplayEl = document.getElementById('loop-display');
        this.messageLogEl = document.getElementById('message-log');

        this.maxMessages = 3;
        this.messages = [];
    }

    update(player) {
        this.depthEl.textContent = `${player.depthMeters}m`;
        this.hpEl.textContent = player.hp;
        this.oxygenEl.textContent = player.oxygen;

        // Show loop counter once player has looped
        if (player.loopCount > 1) {
            this.loopDisplayEl.style.display = '';
            this.loopEl.textContent = player.loopCount;
        } else {
            this.loopDisplayEl.style.display = 'none';
        }

        // Color coding for low values
        if (player.hp < 30) {
            this.hpEl.style.color = '#ff4444';
        } else if (player.hp < 60) {
            this.hpEl.style.color = '#ffaa44';
        } else {
            this.hpEl.style.color = '#3df7ff';
        }

        if (player.oxygen < 30) {
            this.oxygenEl.style.color = '#ff9944';
        } else {
            this.oxygenEl.style.color = '#3df7ff';
        }
    }

    // Add a message to the log
    addMessage(text, cssClass = '') {
        this.messages.push({ text, cssClass });
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
        }
        this.renderMessages();
    }

    renderMessages() {
        this.messageLogEl.innerHTML = '';
        for (const msg of this.messages) {
            const el = document.createElement('div');
            el.className = 'message' + (msg.cssClass ? ' ' + msg.cssClass : '');
            el.textContent = msg.text;
            this.messageLogEl.appendChild(el);
        }
    }

    clear() {
        this.messages = [];
        this.renderMessages();
    }
}
