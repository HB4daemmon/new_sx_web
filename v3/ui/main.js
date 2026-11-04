import { deserialize, serialize, SAVE_KEY } from '../core/run.js';
import { mountBattle, unmountBattle } from './battle-view.js';
import { mountFx, resizeFx, setSpeed } from './fx.js';
import { $, h } from './h.js';
import { readMeta, writeMeta } from './meta.js';
import { renderScreen } from './screens.js';
import { playSfx, setSfxEnabled, unlockSfx } from './sfx.js';
export const app = {
    run: null, meta: readMeta(), view: 'title', endReport: null, settlement: null,
};
let stage;
let screenRoot;
let overlayRoot;
export const LAND = { w: 1280, h: 720 };
export const PORT = { w: 720, h: 1280 };
export let portrait = false;
export const stageSize = { w: 1280, h: 720 };
export function save() {
    try {
        if (app.run && !app.run.log.includes('finished'))
            localStorage.setItem(SAVE_KEY, serialize(app.run));
        else
            localStorage.removeItem(SAVE_KEY);
    }
    catch { /* storage unavailable: the run continues in memory */ }
    writeMeta(app.meta);
}
export function loadSaved() {
    try {
        return deserialize(localStorage.getItem(SAVE_KEY));
    }
    catch {
        return null;
    }
}
/** Applies a mutation to the run, persists it and re-renders. */
export function act(fn, sfx = 'click') {
    if (!app.run)
        return;
    fn(app.run);
    if (sfx)
        playSfx(sfx);
    save();
    render();
}
export function go(view) {
    app.view = view;
    render();
}
let lastKey = '';
export function render() {
    const run = app.run;
    const key = app.view === 'run' && run ? `run:${run.screen.name}` : app.view;
    stage.dataset.screen = app.view === 'run' && run ? run.screen.name : app.view;
    if (app.view === 'run' && run?.screen.name === 'battle') {
        if (lastKey !== key) {
            screenRoot.replaceChildren();
            mountBattle(screenRoot);
            inkWipe();
        }
        lastKey = key;
        return;
    }
    unmountBattle();
    const changed = lastKey !== key;
    lastKey = key;
    screenRoot.replaceChildren(renderScreen());
    if (changed)
        inkWipe();
}
function inkWipe() {
    const el = screenRoot.firstElementChild;
    el?.animate([{ opacity: 0, filter: 'blur(6px)', transform: 'scale(1.03)' }, { opacity: 1, filter: 'blur(0)', transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
export function showOverlay(content, opts = {}) {
    const close = () => { layer.remove(); opts.onClose?.(); };
    const layer = h(`div.overlay${opts.cls ? `.${opts.cls}` : ''}`, {
        onclick: (e) => { if (e.target === layer && opts.closable !== false)
            close(); },
    }, h('div.overlay-panel', null, content, opts.closable === false ? null : h('button.overlay-close', { type: 'button', onclick: close, 'aria-label': '关闭' }, '×')));
    overlayRoot.appendChild(layer);
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    return close;
}
export const closeOverlays = () => overlayRoot.replaceChildren();
export const overlayOpen = () => overlayRoot.childElementCount > 0;
export function toast(text, cls = '') {
    const el = h(`div.toast${cls ? `.${cls}` : ''}`, null, text);
    overlayRoot.appendChild(el);
    el.animate([{ opacity: 0, transform: 'translate(-50%, 20px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 200 });
    setTimeout(() => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => el.remove()), 1800);
}
function fit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    portrait = vh / vw > 1.15;
    const size = portrait
        ? { w: PORT.w, h: Math.round(Math.min(1560, Math.max(PORT.h, (PORT.w * vh) / vw))) }
        : { w: Math.round(Math.min(1560, Math.max(LAND.w, (LAND.h * vw) / vh))), h: LAND.h };
    stageSize.w = size.w;
    stageSize.h = size.h;
    const scale = Math.min(vw / size.w, vh / size.h);
    stage.style.width = `${size.w}px`;
    stage.style.height = `${size.h}px`;
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    stage.classList.toggle('port', portrait);
    stage.classList.toggle('land', !portrait);
    document.documentElement.style.setProperty('--stage-scale', String(scale));
    resizeFx(size.w, size.h);
}
export function boot(root) {
    stage = h('div#stage.stage');
    const shakeRoot = h('div.shake-root');
    screenRoot = h('div.screen-root');
    overlayRoot = h('div.overlay-root');
    shakeRoot.append(screenRoot);
    stage.append(shakeRoot, overlayRoot);
    root.replaceChildren(stage);
    fit();
    mountFx(stage);
    window.addEventListener('resize', () => { const was = portrait; fit(); if (was !== portrait) {
        lastKey = '';
        render();
    } });
    setSfxEnabled(app.meta.sound);
    setSpeed(app.meta.speed);
    const unlock = () => unlockSfx();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    app.run = loadSaved();
    if (app.run && ['won', 'lost'].includes(app.run.screen.name))
        app.view = 'run';
    render();
}
const root = $('#app');
if (root)
    boot(root);
