// --- Configuration ---
const CONFIG = {
    width: 400,
    height: 600,
    boxHeight: 25,    // Height of each slab
    boxSize: 120,     // Initial Width and Depth
    initialSpeed: 3,
    speedIncrement: 0.15,
    gravity: 0.8,
    colorSpeed: 5,
    cameraOffset: 150 // Vertical offset for camera
};

// --- State Management ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const startMsg = document.getElementById('start-msg');

// Set canvas resolution
canvas.width = CONFIG.width;
canvas.height = CONFIG.height;

let state = {
    mode: 'START', // START, PLAYING, GAMEOVER
    stack: [],
    debris: [],
    score: 0,
    lives: 3,
    currentBox: null,
    cameraY: 0,
    hue: 0
};
const livesEl = document.getElementById('lives');

// --- Helpers ---

// Convert 3D world coordinates to 2D screen coordinates (Isometric)
function toIso(x, y, z) {
    const isoX = (x - z) + CONFIG.width / 2;
    const isoY = (x + z) * 0.5 - y + CONFIG.height / 2 + CONFIG.cameraOffset;
    return { x: isoX, y: isoY };
}

function getColor(hue, lightnessOffset = 0) {
    return `hsl(${hue}, 70%, ${50 + lightnessOffset}%)`;
}

// --- Audio ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'perfect') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(550, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
    }
}

// --- Classes ---

class Box {
    constructor(x, y, z, w, d, hue) {
        this.x = x;
        this.y = y; // Vertical height (up is positive)
        this.z = z;
        this.w = w; // Size on X
        this.d = d; // Size on Z
        this.h = CONFIG.boxHeight;
        this.hue = hue;
        this.vx = 0;
        this.vz = 0;
        this.vy = 0;
    }

    draw(context, cameraY) {
        const topColor = getColor(this.hue, 10);
        const rightColor = getColor(this.hue, -10);
        const leftColor = getColor(this.hue, -20);

        // Calculate vertices
        // We need to draw 3 faces: Top, Right (X-face), Left (Z-face)
        // Top face is at y + h

        const nodes = [
            { x: this.x, y: this.y, z: this.z },                      // 0: Bottom-Back-Left
            { x: this.x + this.w, y: this.y, z: this.z },             // 1: Bottom-Back-Right
            { x: this.x + this.w, y: this.y, z: this.z + this.d },    // 2: Bottom-Front-Right
            { x: this.x, y: this.y, z: this.z + this.d },             // 3: Bottom-Front-Left
            { x: this.x, y: this.y + this.h, z: this.z },             // 4: Top-Back-Left
            { x: this.x + this.w, y: this.y + this.h, z: this.z },    // 5: Top-Back-Right
            { x: this.x + this.w, y: this.y + this.h, z: this.z + this.d }, // 6: Top-Front-Right
            { x: this.x, y: this.y + this.h, z: this.z + this.d },    // 7: Top-Front-Left
        ];

        // Project to 2D
        // Apply cameraY (subtract because y is up)
        const p = nodes.map(n => toIso(n.x, n.y - cameraY, n.z));

        context.lineWidth = 1;
        context.lineJoin = 'round';
        context.strokeStyle = 'rgba(0,0,0,0.1)';

        // Draw Left Face (3, 2, 6, 7) - Z axis face
        context.fillStyle = leftColor;
        context.beginPath();
        context.moveTo(p[3].x, p[3].y);
        context.lineTo(p[2].x, p[2].y);
        context.lineTo(p[6].x, p[6].y);
        context.lineTo(p[7].x, p[7].y);
        context.closePath();
        context.fill();
        context.stroke();

        // Draw Right Face (1, 2, 6, 5) - X axis face
        context.fillStyle = rightColor;
        context.beginPath();
        context.moveTo(p[1].x, p[1].y);
        context.lineTo(p[2].x, p[2].y);
        context.lineTo(p[6].x, p[6].y);
        context.lineTo(p[5].x, p[5].y);
        context.closePath();
        context.fill();
        context.stroke();

        // Draw Top Face (4, 5, 6, 7)
        context.fillStyle = topColor;
        context.beginPath();
        context.moveTo(p[4].x, p[4].y);
        context.lineTo(p[5].x, p[5].y);
        context.lineTo(p[6].x, p[6].y);
        context.lineTo(p[7].x, p[7].y);
        context.closePath();
        context.fill();
        context.stroke();
    }

    update() {
        this.x += this.vx;
        this.z += this.vz;
        this.y += this.vy; // Only used for debris falling
    }
}

class Debris extends Box {
    constructor(x, y, z, w, d, hue) {
        super(x, y, z, w, d, hue);
        this.vy = 0;
        this.life = 1.0; // Opacity/Life
    }

    update() {
        this.vy -= CONFIG.gravity; // Gravity pulls down (negative Y)
        this.y += this.vy;
        this.life -= 0.02;
    }

    draw(context, cameraY) {
        if (this.life <= 0) return;
        context.globalAlpha = this.life;
        super.draw(context, cameraY);
        context.globalAlpha = 1.0;
    }
}

// --- Game Logic ---

function initGame() {
    state.stack = [];
    state.debris = [];
    state.score = 0;
    state.lives = 3;
    state.cameraY = 0;
    state.hue = Math.random() * 360;
    scoreEl.innerText = '0';
    livesEl.innerText = 'Lives: 3';
    scoreEl.classList.remove('shake');

    // Create base block
    const baseBox = new Box(
        -CONFIG.boxSize / 2, // Center X
        0,                   // Base Y
        -CONFIG.boxSize / 2, // Center Z
        CONFIG.boxSize,
        CONFIG.boxSize,
        state.hue
    );
    state.stack.push(baseBox);

    spawnNextBox();
    state.mode = 'PLAYING';
    startMsg.style.display = 'none';
}

function spawnNextBox() {
    const prevBox = state.stack[state.stack.length - 1];
    state.hue += CONFIG.colorSpeed;

    // Determine direction (alternating)
    // Even score: Move along X. Odd score: Move along Z.
    const moveX = state.score % 2 === 0;

    const newBox = new Box(
        prevBox.x,
        prevBox.y + CONFIG.boxHeight,
        prevBox.z,
        prevBox.w,
        prevBox.d,
        state.hue
    );

    const speed = CONFIG.initialSpeed + (state.score * CONFIG.speedIncrement);

    const startPos = (state.score % 4 < 2) ? -200 : 200;
    const direction = (state.score % 4 < 2) ? 1 : -1;

    if (moveX) {
        newBox.x = startPos;
        newBox.vx = speed * direction;
    } else {
        newBox.z = startPos;
        newBox.vz = speed * direction;
    }

    state.currentBox = newBox;
}

function placeBox() {
    if (state.mode !== 'PLAYING') return;

    const current = state.currentBox;
    const prev = state.stack[state.stack.length - 1];
    const moveX = state.score % 2 === 0;

    // Check for perfect match (Tolerance)
    const diff = moveX ? current.x - prev.x : current.z - prev.z;
    if (Math.abs(diff) < 3) {
        playSound('perfect');
        if (moveX) current.x = prev.x;
        else current.z = prev.z;
    }

    let overlap, debrisX, debrisZ, debrisW, debrisD;

    if (moveX) {
        // Moving on X axis
        overlap = prev.w - Math.abs(current.x - prev.x);

        if (overlap > 0) {
            // Cut logic for X
            debrisZ = current.z;
            debrisD = current.d;
            debrisW = current.w - overlap;

            if (current.x > prev.x) {
                // Overhang Right
                debrisX = current.x + overlap;
                current.w = overlap;
            } else {
                // Overhang Left
                debrisX = current.x;
                current.x = prev.x; // Snap to left edge of prev
                current.w = overlap;
            }
        }
    } else {
        // Moving on Z axis
        overlap = prev.d - Math.abs(current.z - prev.z);

        if (overlap > 0) {
            // Cut logic for Z
            debrisX = current.x;
            debrisW = current.w;
            debrisD = current.d - overlap;

            if (current.z > prev.z) {
                // Overhang Front
                debrisZ = current.z + overlap;
                current.d = overlap;
            } else {
                // Overhang Back
                debrisZ = current.z;
                current.z = prev.z;
                current.d = overlap;
            }
        }
    }

    if (overlap > 0) {
        // Success: Cut the box
        if (debrisW > 0.1 && debrisD > 0.1) {
            const debris = new Debris(debrisX, current.y, debrisZ, debrisW, debrisD, current.hue);
            state.debris.push(debris);
        }

        current.vx = 0; // Stop moving
        current.vz = 0;
        state.stack.push(current);
        state.score++;
        scoreEl.innerText = state.score;

        // Camera movement logic
        // If stack gets too high, move camera up (increase cameraY)
        if (state.score > 5) {
            state.cameraY += CONFIG.boxHeight;
        }

        spawnNextBox();

    } else {
        // Missed the stack completely
        state.lives--;
        livesEl.innerText = 'Lives: ' + state.lives;

        // Drop the current box as debris
        const debris = new Debris(current.x, current.y, current.z, current.w, current.d, current.hue);
        state.debris.push(debris);

        if (state.lives > 0) {
            // Retry: Spawn a new box for the current level
            spawnNextBox();
        } else {
            gameOver();
        }
    }
}

function gameOver() {
    state.mode = 'GAMEOVER';

    // Make the current box fall as debris
    const current = state.currentBox;
    const debris = new Debris(current.x, current.y, current.z, current.w, current.d, current.hue);
    state.debris.push(debris);
    state.currentBox = null;

    scoreEl.classList.add('shake');
    startMsg.innerText = "Game Over! Tap to Restart";
    startMsg.style.display = 'block';
}

// --- Main Loop ---

function loop() {
    // 1. Update
    if (state.mode === 'PLAYING' && state.currentBox) {
        state.currentBox.update();

        // Bounce logic: Reverse velocity if hitting limits
        const limit = 280;
        if (state.currentBox.x > limit && state.currentBox.vx > 0) {
            state.currentBox.vx *= -1;
        } else if (state.currentBox.x < -limit && state.currentBox.vx < 0) {
            state.currentBox.vx *= -1;
        }
        if (state.currentBox.z > limit && state.currentBox.vz > 0) {
            state.currentBox.vz *= -1;
        } else if (state.currentBox.z < -limit && state.currentBox.vz < 0) {
            state.currentBox.vz *= -1;
        }
    }

    // Update debris
    for (let i = state.debris.length - 1; i >= 0; i--) {
        state.debris[i].update();
        // Remove if way below camera
        if (state.debris[i].y < state.cameraY - 500) {
            state.debris.splice(i, 1); // Remove off-screen debris
        }
    }

    // 2. Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Stack
    state.stack.forEach(box => box.draw(ctx, state.cameraY));

    // Draw Debris
    state.debris.forEach(d => d.draw(ctx, state.cameraY));

    // Draw Current Moving Box
    if (state.currentBox) {
        state.currentBox.draw(ctx, state.cameraY);
    }

    requestAnimationFrame(loop);
}

// --- Input Handling ---

function handleInput(e) {
    if (e.type === 'keydown' && e.code !== 'Space') return;
    e.preventDefault(); // Prevent scrolling on spacebar

    if (state.mode === 'START' || state.mode === 'GAMEOVER') {
        initGame();
    } else if (state.mode === 'PLAYING') {
        placeBox();
    }
}

window.addEventListener('keydown', handleInput);
window.addEventListener('pointerdown', handleInput);

// Start Loop
loop();
