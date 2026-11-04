/**
 * Presentation-only effects: timing (speed / skip), screen shake, hit-stop,
 * particles and floating text. Nothing here touches game state.
 */
export const EL_COLOR = {
    jin: '#f6d36b', mu: '#4fdc8e', shui: '#45c9f5', huo: '#ff5a2c', tu: '#e0a14e', zhuo: '#8a7f95',
};
let speed = 1;
let skipping = false;
export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
export function setSpeed(value) { speed = value; }
export function getSpeed() { return speed; }
export function setSkipping(value) { skipping = value; }
export const isSkipping = () => skipping;
const factor = () => (skipping ? 0.12 : 1 / speed);
export function wait(ms) {
    const t = ms * factor();
    return t < 4 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, t));
}
export function anim(el, frames, ms, opts = {}) {
    if (!el || !el.animate)
        return Promise.resolve();
    const a = el.animate(frames, { duration: Math.max(1, ms * factor()), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none', ...opts });
    return a.finished.then(() => undefined, () => undefined);
}
let stage = null;
let canvas = null;
let ctx = null;
const particles = [];
let raf = 0;
export function mountFx(stageEl) {
    stage = stageEl;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.width = stageEl.offsetWidth;
    canvas.height = stageEl.offsetHeight;
    stageEl.appendChild(canvas);
    ctx = canvas.getContext('2d');
}
export function resizeFx(w, h) {
    if (canvas) {
        canvas.width = w;
        canvas.height = h;
    }
}
function loop() {
    if (!ctx || !canvas) {
        raf = 0;
        return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.life += 16 * (skipping ? 3 : speed);
        if (p.life >= p.max) {
            particles.splice(i, 1);
            continue;
        }
        const t = p.life / p.max;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.94;
        p.vy = p.vy * 0.94 + (p.kind === 'ember' ? -0.05 : p.kind === 'ink' ? 0.25 : 0.12);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        if (p.kind === 'spark') {
            ctx.lineWidth = p.size * (1 - t);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
            ctx.stroke();
        }
        else if (p.kind === 'ring') {
            ctx.lineWidth = 6 * (1 - t);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (0.3 + t * 1.4), 0, Math.PI * 2);
            ctx.stroke();
        }
        else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (p.kind === 'ink' ? 1 - t * 0.3 : 1 - t), 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
    raf = particles.length ? requestAnimationFrame(loop) : 0;
}
/** Stage-space coordinates of an element's centre. */
export function centerOf(el) {
    if (!el || !stage)
        return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const scale = s.width / stage.offsetWidth;
    return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale };
}
export function burst(x, y, color, count = 24, power = 1, kind = 'spark') {
    if (reducedMotion())
        count = Math.min(count, 6);
    for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = (2 + Math.random() * 9) * power;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (kind === 'ink' ? 2 : 0), life: 0, max: 380 + Math.random() * 420, size: kind === 'ink' ? 3 + Math.random() * 9 : 2 + Math.random() * 3 * power, color, kind, rot: 0 });
    }
    if (!raf)
        raf = requestAnimationFrame(loop);
}
export function ring(x, y, color, size = 90) {
    particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 520, size, color, kind: 'ring', rot: 0 });
    if (!raf)
        raf = requestAnimationFrame(loop);
}
/** Screen shake on the stage; level 0..4. */
export function shake(level) {
    if (!stage || reducedMotion() || level <= 0)
        return;
    const amp = [0, 4, 9, 16, 26][Math.min(4, Math.round(level))];
    const frames = [];
    for (let i = 0; i < 8; i += 1) {
        const d = amp * (1 - i / 8);
        frames.push({ transform: `translate(${(Math.random() * 2 - 1) * d}px, ${(Math.random() * 2 - 1) * d}px)` });
    }
    frames.push({ transform: 'translate(0,0)' });
    const target = stage.querySelector('.shake-root') ?? stage;
    target.animate(frames, { duration: 260 + level * 60, easing: 'linear' });
}
/** Freezes the frame briefly — the "weight" of a hit. */
export function hitstop(ms) {
    if (reducedMotion())
        return Promise.resolve();
    return wait(ms);
}
export function flash(color = 'rgba(255,255,255,.75)', ms = 160) {
    if (!stage || reducedMotion())
        return;
    const el = document.createElement('div');
    el.className = 'fx-flash';
    el.style.background = color;
    stage.appendChild(el);
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * factor() + 40, easing: 'ease-out' }).finished.then(() => el.remove(), () => el.remove());
}
/** Floating text at stage coordinates. */
export function floatText(x, y, text, cls = '', rise = 70, ms = 900) {
    if (!stage)
        return null;
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    stage.appendChild(el);
    el.animate([
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
        { transform: 'translate(-50%,-60%) scale(1.25)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-50%,-60%) scale(1)', opacity: 1, offset: 0.3 },
        { transform: `translate(-50%, calc(-50% - ${rise}px)) scale(.9)`, opacity: 0 },
    ], { duration: ms * factor() + 60, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.then(() => el.remove(), () => el.remove());
    return el;
}
/** A glowing streak flying between two points. */
export async function comet(from, to, color, ms = 260, size = 26) {
    if (!stage)
        return;
    const el = document.createElement('div');
    el.className = 'fx-comet';
    el.style.setProperty('--c', color);
    el.style.width = el.style.height = `${size}px`;
    stage.appendChild(el);
    const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    await anim(el, [
        { transform: `translate(${from.x - size / 2}px, ${from.y - size / 2}px) rotate(${angle}deg) scaleX(1)` },
        { transform: `translate(${to.x - size / 2}px, ${to.y - size / 2}px) rotate(${angle}deg) scaleX(3.2)` },
    ], ms, { easing: 'cubic-bezier(.6,0,.9,.4)' });
    el.remove();
}
/** A jagged lightning bolt from the top of the stage to a point. */
export function lightning(x, y, color = '#e9e4ff') {
    if (!stage)
        return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fx-bolt');
    svg.setAttribute('viewBox', `0 0 ${stage.offsetWidth} ${stage.offsetHeight}`);
    let d = `M ${x + (Math.random() * 120 - 60)} -10`;
    const steps = 9;
    for (let i = 1; i <= steps; i += 1)
        d += ` L ${x + (Math.random() * 70 - 35) * (1 - i / steps)} ${(y * i) / steps}`;
    for (const [w, c] of [[14, 'rgba(160,140,255,.35)'], [5, color]]) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', c);
        path.setAttribute('stroke-width', String(w));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linejoin', 'bevel');
        svg.appendChild(path);
    }
    stage.appendChild(svg);
    svg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 420 * factor() + 60 }).finished.then(() => svg.remove(), () => svg.remove());
}
