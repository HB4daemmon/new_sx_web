import { BattleRig, drawRig } from './rig.js';

const requiredAssetIds = [
  'battle-scene',
  'start-scene',
  'map-scene',
  'player',
  'enemy',
  'artifact-rr09',
  'artifact-rr11',
  'artifact-rr15',
  'ui-panel',
  'ui-button-primary',
  'ui-button-secondary',
  'ui-meter',
  'player-attack',
  'player-rage',
  'enemy-attack',
];
const requiredAssets = new Map([
  ['battle-scene', { src: '/assets/scene-battle.png', kind: 'scene', screen: 'battle' }],
  ['start-scene', { src: '/assets/scene-start.png', kind: 'scene', screen: 'start' }],
  ['map-scene', { src: '/assets/scene-map.png', kind: 'scene', screen: 'map' }],
  ['player', { src: '/assets/player.png', kind: 'character', screen: 'battle' }],
  ['enemy', { src: '/assets/enemy.png', kind: 'character', screen: 'battle' }],
  ['artifact-rr09', { src: '/assets/artifact-rr09.png', kind: 'artifact', target: 'artifact-rr09', contentId: 'RR09' }],
  ['artifact-rr11', { src: '/assets/artifact-rr11.png', kind: 'artifact', target: 'artifact-rr11', contentId: 'RR11' }],
  ['artifact-rr15', { src: '/assets/artifact-rr15.png', kind: 'artifact', target: 'artifact-rr15', contentId: 'RR15' }],
  ['ui-panel', { src: '/assets/ui-panel.png', kind: 'module' }],
  ['ui-button-primary', { src: '/assets/ui-button-primary.png', kind: 'module' }],
  ['ui-button-secondary', { src: '/assets/ui-button-secondary.png', kind: 'module' }],
  ['ui-meter', { src: '/assets/ui-meter.png', kind: 'module' }],
  ['player-attack', { src: '/assets/player-attack.png', kind: 'pose' }],
  ['player-rage', { src: '/assets/player-rage.png', kind: 'pose' }],
  ['enemy-attack', { src: '/assets/enemy-attack.png', kind: 'pose' }],
]);
const assetPathPattern = /^\/assets\/(?:scene-(?:battle|start|map)|player(?:-attack|-rage)?|enemy(?:-attack)?|artifact-[a-z0-9-]+|ui-(?:panel|button-primary|button-secondary|meter))\.png$/;
const poseImages = new Map();
const libraryImages = new Map();
let artLibrary = null;
let battleRig = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const methods = {
  RKF01: { name: '金刚功', cue: '普攻、怒技后获得护盾。' },
  RKF02: { name: '归元诀', cue: '怒技后按实际怒耗返气。' },
  RKF03: { name: '回春功', cue: '以最大气血提高治疗。' },
  RKF04: { name: '御火诀', cue: '攻击施加持续燃烧。' },
  RKF05: { name: '养剑诀', cue: '普攻积累剑势。' },
};
const artifacts = {
  'artifact-rr09': {
    title: '震岳鼓',
    name: '震岳鼓',
    copy: '防御 +8。敌方行动中，若已有护盾反击造成伤害，该次敌方行动结束时额外获得10点怒气；此法宝不提供反击效果。',
    stats: [['防御', '+8'], ['回怒', '符合条件的敌方行动结束时 +10']],
  },
  'artifact-rr11': {
    title: '余烬盏',
    name: '余烬盏',
    copy: '最大气血 +30。自身施加的中毒或燃烧每轮首次对敌方气血造成伤害后，额外获得10点怒气；伤害被护盾完全吸收时不触发，每轮最多一次。',
    stats: [['最大气血', '+30'], ['回怒', '每轮最多一次 +10']],
  },
  'artifact-rr15': {
    title: '定心佩',
    name: '定心佩',
    copy: '最大气血 +30。受到来自其他来源的削怒效果降低50%；多项削怒抗性相加，最高降低100%，不影响获得怒气或受击回怒。',
    stats: [['最大气血', '+30'], ['外来削怒', '降低 50%']],
  },
};
const mapNodes = {
  coast: { path: '沿潮路', encounter: 'EN-A1-L1' },
  stone: { path: '绕石阶', encounter: 'EN-A1-L1' },
};
const enemyPreview = {
  id: 'EN-A1-L1',
  name: '养锋石卫',
  method: '养剑诀',
  place: '古道',
  summary: '潮路转弯处立着一尊磨损的石卫。',
  description: '古道边的石卫残缺不全，掌中长剑仍映着潮光。',
};
const captureScreens = new Set(['start', 'map', 'battle', 'choice']);
const allowedViews = new Set(['overview', 'start', 'map', 'battle', 'choice', 'compare']);
const app = document.querySelector('#preview-app');
const assetStatus = document.querySelector('#asset-status');
const captureButton = document.querySelector('#capture-preview');
const dialog = document.querySelector('#detail-dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogCopy = document.querySelector('#dialog-copy');
const dialogStats = document.querySelector('#dialog-stats');
const settingsForm = document.querySelector('#profile-settings');
const methodCue = document.querySelector('#method-cue');
const choiceConfirm = document.querySelector('.choice-confirm');
const screenDeck = document.querySelector('.screen-deck');
const gameScreens = [...document.querySelectorAll('.game-screen')];
const overviewSlots = new Map(
  [...document.querySelectorAll('[data-overview-slot]')]
    .map(slot => [slot.dataset.overviewSlot, slot]),
);
const routeGraph = document.querySelector('.map-graph');
const routeCanvas = document.querySelector('canvas.route-lines');
const requestedMethod = new URLSearchParams(location.search).get('method');
let selectedMethod = Object.hasOwn(methods, requestedMethod) ? requestedMethod : 'RKF01';
let selectedArtifact = null;
let chosenArtifact = null;
let dialogKind = '';
let closingDialogForRoute = false;
let profile = { name: '方寄云', seed: '山海初行' };
let battleTimer = null;
let battleActive = false;
let battlePhase = 0;
const initialCombat = {
  player: { hp: 640, max: 920, shield: 180, rage: 36 },
  enemy: { hp: 344, max: 450, shield: 50, rage: 44 },
};
let combat = structuredClone(initialCombat);
const battleBeats = [
  { actor: 'player', target: 'enemy', action: 'attack', hits: [30, 31, 31], rage: 64, targetRage: 68, label: '普攻' },
  { actor: 'enemy', target: 'player', action: 'attack', hits: [18, 18, 18], rage: 93, targetRage: 77, label: '盾挡' },
  { actor: 'player', target: 'enemy', action: 'rage', hits: [46, 46, 46], rage: 0, targetRage: 100, label: '怒技' },
  { actor: 'enemy', action: 'artifact', artifact: 'RR05', label: '镇心玉 · 触发' },
  { actor: 'player', action: 'heal', heal: 36, label: '恢复 · 气血 +36' },
  { actor: 'enemy', target: 'player', action: 'rage', hits: [152], rage: 0, targetRage: 90, label: '怒技' },
];

app.dataset.assetsReady = 'false';
app.dataset.visualApproval = 'pending';
app.dataset.previewSpeed = 'normal';
app.dataset.previewPaused = 'false';
app.dataset.animationKind = 'illustrated-poses';

function resetActor(image) {
  image.classList.remove('is-striking', 'is-hit');
  image.dataset.pose = 'idle';
  const asset = requiredAssets.get(image.dataset.assetTarget);
  if (!image.hidden && asset) image.src = asset.src;
}

function syncMotionPause() {
  app.dataset.motionPaused = String(app.dataset.previewPaused === 'true' || dialog.open || document.hidden);
  battleRig?.configure({
    active: battleActive, paused: app.dataset.motionPaused === 'true',
    reduced: reducedMotion.matches, speed: app.dataset.previewSpeed === 'fast' ? 2 : 1,
    method: selectedMethod,
  });
}

document.querySelectorAll('.battle-actors img').forEach(image => {
  image.addEventListener('animationend', () => resetActor(image));
});
reducedMotion.addEventListener('change', () => {
  document.querySelectorAll('.battle-actors img').forEach(resetActor);
  syncMotionPause();
});
document.addEventListener('visibilitychange', () => {
  syncMotionPause();
  scheduleBattleBeat();
});
window.addEventListener('pagehide', () => {
  clearTimeout(battleTimer);
  battleRig?.dispose();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    battleRig = artLibrary && new BattleRig(document.querySelector('.combat-rig'), artLibrary, libraryImages);
    syncMotionPause();
    scheduleBattleBeat();
  }
});

function updateOverviewScales() {
  if (app.dataset.view !== 'overview') return;
  for (const slot of overviewSlots.values()) {
    const { width, height } = slot.getBoundingClientRect();
    if (width <= 0 || height <= 0) continue;
    slot.style.setProperty('--overview-scale', String(Math.min(width / 390, height / 760)));
  }
}

const overviewResizeObserver = new ResizeObserver(updateOverviewScales);
overviewSlots.forEach(slot => overviewResizeObserver.observe(slot));

function drawRouteLines() {
  const width = routeGraph.clientWidth;
  const height = routeGraph.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  routeCanvas.width = Math.round(width * ratio);
  routeCanvas.height = Math.round(height * ratio);
  const context = routeCanvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const center = selector => {
    const node = routeGraph.querySelector(selector);
    return [node.offsetLeft + node.offsetWidth / 2, node.offsetTop + node.offsetHeight / 2];
  };
  const origin = center('.current-node');
  context.lineCap = 'round';
  context.lineWidth = 1.4;
  for (const side of ['left', 'right']) {
    const node = center(`.route-${side}`);
    const future = center(`.future-${side}`);
    context.setLineDash([]);
    context.strokeStyle = '#91a296';
    context.beginPath();
    context.moveTo(...origin);
    context.bezierCurveTo(origin[0], origin[1] - 58, node[0], node[1] + 62, ...node);
    context.stroke();
    context.setLineDash([2, 6]);
    context.strokeStyle = '#bbc5bc';
    context.beginPath();
    context.moveTo(...node);
    context.bezierCurveTo(node[0], node[1] - 42, future[0], future[1] + 42, ...future);
    context.stroke();
  }
}
const routeResizeObserver = new ResizeObserver(drawRouteLines);
routeResizeObserver.observe(routeGraph);

function placeScreens(view) {
  const inOverview = view === 'overview';
  for (const screen of gameScreens) {
    const parent = inOverview ? overviewSlots.get(screen.dataset.screen) : screenDeck;
    if (screen.parentElement !== parent) parent.append(screen);
    screen.inert = inOverview;
    if (inOverview) screen.setAttribute('aria-hidden', 'true');
    else screen.removeAttribute('aria-hidden');
  }
  if (inOverview) updateOverviewScales();
  requestAnimationFrame(drawRouteLines);
}

function getRoute() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('screen');
  const view = allowedViews.has(requested) ? requested : 'overview';
  const node = view === 'map' && mapNodes[params.get('node')] ? params.get('node') : null;
  const capture = captureScreens.has(view) && params.get('capture') === '1' && !node;
  return { view, node, capture, requested, rawNode: params.get('node') };
}

function renderRoute({ normalize = false } = {}) {
  const route = getRoute();
  const validNode = route.node;
  const url = new URL(location.href);
  let changed = false;
  if (route.requested !== route.view) {
    url.searchParams.set('screen', route.view);
    changed = true;
  }
  if ((route.rawNode || null) !== validNode) {
    if (validNode) url.searchParams.set('node', validNode);
    else url.searchParams.delete('node');
    changed = true;
  }
  if (route.capture) {
    url.searchParams.delete('node');
    changed ||= url.search !== location.search;
  } else if (url.searchParams.has('capture') && !route.capture) {
    url.searchParams.delete('capture');
    changed = true;
  }
  if (normalize && changed) history.replaceState({}, '', url);

  app.dataset.view = route.view;
  placeScreens(route.view);
  captureButton.hidden = route.view === 'overview' || route.view === 'compare';
  document.querySelectorAll('[data-view-link]').forEach(link => {
    if (link.dataset.viewLink === route.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (route.capture && app.dataset.assetsReady === 'true') {
    app.dataset.capture = 'true';
  } else {
    delete app.dataset.capture;
  }

  if (validNode) {
    showNodeDialog(validNode);
  } else if (dialog.open && dialogKind === 'node') {
    closingDialogForRoute = true;
    dialog.close();
  }
  syncBattlePlayback(route.view);
  return route;
}

function renderCombat() {
  for (const [side, unit] of Object.entries(combat)) {
    const status = document.querySelector(`.${side}-status`);
    const cap = unit.max + unit.shield;
    status.querySelector('.health-value').textContent = `${unit.hp}/${unit.max}`;
    status.querySelector('.shield-value').textContent = String(unit.shield);
    status.querySelector('.rage-value').textContent = `${unit.rage}/100`;
    status.querySelector(`.${side}-health`).style.width = `${unit.hp / cap * 100}%`;
    status.querySelector(`.${side}-shield`).style.width = `${unit.shield / cap * 100}%`;
    status.querySelector(`.${side}-rage`).style.width = `${unit.rage}%`;
    const combined = status.querySelector('.combined-meter');
    combined.setAttribute('aria-valuemax', cap);
    combined.setAttribute('aria-valuenow', unit.hp + unit.shield);
    combined.setAttribute('aria-valuetext', `气血${unit.hp}，护盾${unit.shield}`);
    status.querySelector('.rage-meter').setAttribute('aria-valuenow', unit.rage);
  }
}

function scheduleBattleBeat() {
  clearTimeout(battleTimer);
  battleTimer = null;
  if (!battleActive || app.dataset.previewPaused === 'true' || dialog.open || document.hidden) return;
  battleTimer = setTimeout(playBattleBeat, app.dataset.previewSpeed === 'fast' ? 1200 : 2400);
}

function playBattleBeat() {
  if (!battleActive || app.dataset.previewPaused === 'true' || dialog.open || document.hidden) return;
  const feedback = document.querySelector('.battle-feedback');
  document.querySelectorAll('.battle-actors img').forEach(resetActor);
  if (battlePhase === battleBeats.length) {
    combat = structuredClone(initialCombat);
    battlePhase = 0;
    feedback.hidden = true;
    document.querySelector('.round-label').textContent = '第三回合';
    battleRig?.reset();
  } else {
    const beat = battleBeats[battlePhase++];
    const impact = () => {
      if (!battleActive) return;
      if (beat.hits) {
        const target = combat[beat.target];
        const damage = beat.hits.reduce((sum, hit) => sum + hit, 0);
        const absorbed = Math.min(target.shield, damage);
        target.shield -= absorbed;
        target.hp = Math.max(0, target.hp - damage + absorbed);
        target.rage = beat.targetRage;
        combat[beat.actor].rage = beat.rage;
        feedback.textContent = `${beat.label} · 合计 ${damage}`;
        battleRig?.play(beat.target, absorbed > 0 ? 'guard' : 'hit');
      } else {
        if (beat.heal) combat[beat.actor].hp = Math.min(combat[beat.actor].max, combat[beat.actor].hp + beat.heal);
        feedback.textContent = beat.label;
      }
      feedback.dataset.kind = beat.action;
      feedback.hidden = false;
      renderCombat();
    };
    feedback.hidden = true;
    document.querySelector('.round-label').textContent = battlePhase >= 3 ? '第四回合' : '第三回合';
    if (battleRig) {
      battleRig.play(beat.actor, beat.action, impact, artLibrary.artifacts[beat.artifact]?.src);
    } else {
      impact();
    }
    if (!battleRig && !reducedMotion.matches && beat.hits) {
      const actor = document.querySelector(`.${beat.actor}-art`);
      const pose = beat.label === '怒技' ? 'rage' : 'attack';
      actor.src = (poseImages.get(`${beat.actor}-${pose}`) || poseImages.get(`${beat.actor}-attack`)).src;
      actor.dataset.pose = pose;
      actor.classList.add('is-striking');
      document.querySelector(`.${beat.target}-art`).classList.add('is-hit');
    }
  }
  renderCombat();
  scheduleBattleBeat();
}

function syncBattlePlayback(view) {
  const active = view === 'battle' && app.dataset.assetsReady === 'true';
  if (active === battleActive) return;
  battleActive = active;
  clearTimeout(battleTimer);
  battleTimer = null;
  combat = structuredClone(initialCombat);
  battlePhase = 0;
  document.querySelector('.battle-feedback').hidden = true;
  document.querySelectorAll('.battle-actors img').forEach(resetActor);
  battleRig?.reset();
  document.querySelector('.round-label').textContent = '第三回合';
  renderCombat();
  syncMotionPause();
  scheduleBattleBeat();
}

function navigate(view, { historyMode = 'push', node = null, capture = false, nodeModal = false } = {}) {
  if (!allowedViews.has(view)) return;
  const url = new URL(location.href);
  url.searchParams.set('screen', view);
  url.searchParams.delete('node');
  url.searchParams.delete('capture');
  if (node && view === 'map' && mapNodes[node]) url.searchParams.set('node', node);
  if (capture && captureScreens.has(view)) url.searchParams.set('capture', '1');
  if (historyMode === 'push') history.pushState({ nodeModal }, '', url);
  else if (historyMode === 'replace') history.replaceState({ nodeModal }, '', url);
  renderRoute();
}

document.querySelectorAll('[data-view-link]').forEach(link => {
  link.addEventListener('click', event => {
    if (
      event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    ) return;
    event.preventDefault();
    navigate(link.dataset.viewLink);
  });
});

window.addEventListener('popstate', () => renderRoute());

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        reject(new Error(`Empty image: ${src}`));
        return;
      }
      try {
        await image.decode();
        resolve(image);
      } catch {
        reject(new Error(`Unable to decode image: ${src}`));
      }
    };
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

function validManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) return false;
  const byId = new Map();
  for (const asset of manifest.assets) {
    if (
      !asset || typeof asset.id !== 'string' ||
      typeof asset.src !== 'string' || !assetPathPattern.test(asset.src) ||
      !['scene', 'character', 'artifact', 'module', 'pose'].includes(asset.kind)
    ) return false;
    if (byId.has(asset.id)) return false;
    byId.set(asset.id, asset);
  }
  return requiredAssetIds.every(id => {
    const asset = byId.get(id);
    const expected = requiredAssets.get(id);
    return asset?.required === true && asset.src === expected.src && asset.kind === expected.kind &&
      (!expected.screen || asset.screen === expected.screen) &&
      (!expected.target || asset.target === expected.target) &&
      (!expected.contentId || asset.contentId === expected.contentId);
  });
}

async function attachAsset(asset) {
  const decodedImage = await loadImage(asset.src);
  if (asset.kind === 'module') return;
  if (asset.kind === 'pose') {
    poseImages.set(asset.id, decodedImage);
    return;
  }
  const targets = [...document.querySelectorAll(`[data-asset-target="${asset.id}"]`)];
  if (targets.length === 0) throw new Error(`Missing asset target: ${asset.id}`);

  await Promise.all(targets.map(async target => {
    target.src = decodedImage.src;
    await target.decode();
    if (target.naturalWidth === 0 || target.naturalHeight === 0) {
      throw new Error(`Empty target image: ${asset.id}`);
    }
  }));
  targets.forEach(target => {
    target.hidden = false;
  });
}

async function loadApprovedAssets() {
  let manifest;
  try {
    const response = await fetch('/assets/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Manifest unavailable');
    manifest = await response.json();
  } catch {
    assetStatus.textContent = '待装入正式素材';
    return;
  }

  if (!validManifest(manifest)) {
    assetStatus.textContent = '待装入正式素材';
    return;
  }

  const required = manifest.assets.filter(asset => requiredAssetIds.includes(asset.id));
  const results = await Promise.allSettled(required.map(attachAsset));
  if (results.length !== requiredAssetIds.length || results.some(result => result.status !== 'fulfilled')) {
    assetStatus.textContent = '待装入正式素材';
    return;
  }

  app.dataset.assetsReady = 'true';
  app.dataset.assetStyle = 'hand-drawn-cartoon';
  app.dataset.visualApproval = 'pending';
  assetStatus.textContent = '素材已载入 · 待视觉确认';
  captureButton.disabled = false;
  renderRoute();
  await loadArtLibrary();
}

function drawStartRig() {
  if (!artLibrary) return;
  const canvas = document.querySelector('.start-rig');
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const rig = artLibrary.rigs[selectedMethod];
  drawRig(context, rig, libraryImages.get(rig.src), {
    x: width / 2, y: height - 5, scale: Math.min(width / 230, height / 325),
    staticMode: true,
  });
  canvas.dataset.skin = selectedMethod;
}
new ResizeObserver(drawStartRig).observe(document.querySelector('.start-rig'));

async function loadArtLibrary() {
  app.dataset.libraryReady = 'false';
  try {
    const response = await fetch('/assets/library.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Art library unavailable');
    const library = await response.json();
    if (library.schemaVersion !== 1 || !Array.isArray(library.assets) ||
        !library.rigs || !library.map || !library.artifacts) throw new Error('Invalid art library');
    const safePath = /^\/assets\/(?:rig-(?:rkf0[1-5]|en-a1-l1)|map-(?:coast|stairs|forest|gate|rest|shop)|icon-[a-z0-9-]+|artifact-rr(?:09|11|15))\.png$/;
    const paths = [...new Set([
      ...library.assets.map(asset => asset.src),
      ...Object.values(library.artifacts).map(artifact => artifact.src),
    ])];
    if (!paths.every(src => safePath.test(src)) ||
        ![...Object.keys(methods), 'EN-A1-L1'].every(id =>
          library.rigs[id]?.parts && paths.includes(library.rigs[id].src)) ||
        !['coast', 'stairs', 'forest', 'gate', 'rest'].every(id => paths.includes(library.map[id]))) {
      throw new Error('Incomplete art library');
    }
    const decoded = await Promise.all(paths.map(async src => [src, await loadImage(src)]));
    decoded.forEach(([src, image]) => libraryImages.set(src, image));
    const renderer = new BattleRig(document.querySelector('.combat-rig'), library, libraryImages);
    if (!renderer.context || !document.querySelector('.start-rig').getContext('2d')) {
      renderer.dispose();
      throw new Error('Canvas unavailable');
    }
    artLibrary = library;
    battleRig = renderer;
    for (const image of document.querySelectorAll('[data-map-art]')) {
      image.src = library.map[image.dataset.mapArt];
      await image.decode();
      image.hidden = false;
    }
    for (const id of ['RR09', 'RR11', 'RR15']) {
      const image = document.querySelector(`[data-asset-target="artifact-${id.toLowerCase()}"]`);
      image.src = library.artifacts[id].src;
      await image.decode();
    }
    app.dataset.libraryReady = 'true';
    app.dataset.animationKind = 'cutout-skeletal';
    app.dataset.styleApproval = 'approved';
    assetStatus.textContent = '手绘风格 · 新素材待确认';
    document.querySelector('.catalog-button').disabled = false;
    drawStartRig();
    requestAnimationFrame(drawRouteLines);
    syncMotionPause();
  } catch {
    battleRig?.dispose();
    battleRig = null;
    artLibrary = null;
    libraryImages.clear();
    app.dataset.libraryReady = 'false';
    app.dataset.animationKind = 'illustrated-poses';
    document.querySelectorAll('[data-map-art]').forEach(image => { image.hidden = true; });
    for (const id of ['artifact-rr09', 'artifact-rr11', 'artifact-rr15']) {
      document.querySelector(`[data-asset-target="${id}"]`).src = requiredAssets.get(id).src;
    }
    // Retain the committed static illustrations and working HUD when a rig fails.
  }
}

captureButton.addEventListener('click', () => {
  if (captureButton.disabled || !captureScreens.has(app.dataset.view)) return;
  const url = new URL(location.href);
  url.searchParams.set('screen', app.dataset.view);
  url.searchParams.delete('node');
  url.searchParams.set('capture', '1');
  location.assign(url);
});

function fillStats(entries) {
  dialogStats.replaceChildren(...entries.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    return [term, detail];
  }));
}

function fillCombatDetails() {
  const entries = [
    [profile.name, methods[selectedMethod].name, combat.player],
    ['养锋石卫', '养剑诀', combat.enemy],
  ];
  dialogStats.replaceChildren(...entries.flatMap(([name, method, unit]) => {
    const term = document.createElement('dt');
    term.textContent = `${name} · ${method}`;
    const detail = document.createElement('dd');
    detail.className = 'combat-detail-values';
    for (const [label, value] of [
      ['气血', `${unit.hp}/${unit.max}`], ['护盾', String(unit.shield)],
      ['怒气', `${unit.rage}/100`],
    ]) {
      const metric = document.createElement('span');
      const caption = document.createElement('span');
      caption.textContent = label;
      const number = document.createElement('b');
      number.textContent = value;
      metric.append(caption, number);
      detail.append(metric);
    }
    return [term, detail];
  }));
}

function fillCopy(text) {
  const parts = [];
  const emphasis = /[+-]?\d+(?:\.\d+)?(?:\/\d+)?%?|护盾反击|中毒|燃烧|削怒|怒气/g;
  let position = 0;
  for (const match of text.matchAll(emphasis)) {
    parts.push(document.createTextNode(text.slice(position, match.index)));
    const label = document.createElement('strong');
    label.className = /\d/.test(match[0]) ? 'detail-value' : 'detail-keyword';
    label.textContent = match[0];
    parts.push(label);
    position = match.index + match[0].length;
  }
  parts.push(document.createTextNode(text.slice(position)));
  dialogCopy.replaceChildren(...parts);
}

function configureDialog(kind) {
  dialogKind = kind;
  dialog.dataset.kind = kind;
  dialogCopy.hidden = false;
  dialogStats.hidden = false;
  settingsForm.hidden = true;
  document.querySelector('#artifact-catalog').hidden = true;
  dialog.querySelector('[data-dialog-action="cancel-node"]').hidden = true;
  dialog.querySelector('[data-dialog-action="confirm-node"]').hidden = true;
  dialog.querySelector('[data-dialog-action="back-catalog"]').hidden = true;
}

function openDialog(kind, artifactId = selectedArtifact) {
  if (kind === 'library') {
    configureDialog('library');
    dialogTitle.textContent = '法宝图鉴';
    dialogCopy.hidden = true;
    dialogStats.hidden = true;
    const catalog = document.querySelector('#artifact-catalog');
    catalog.replaceChildren();
    if (artLibrary) {
      for (const [label, rarity] of [['凡品', 'common'], ['珍品', 'rare'], ['传奇', 'legendary']]) {
        const title = document.createElement('h3');
        title.textContent = label;
        const list = document.createElement('div');
        list.className = 'catalog-items';
        for (const [id, artifact] of Object.entries(artLibrary.artifacts)) {
          if (artifact.rarity !== rarity) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.catalogId = id;
          button.title = artifact.name;
          const image = document.createElement('img');
          image.src = artifact.src;
          image.alt = '';
          const name = document.createElement('span');
          name.textContent = artifact.name;
          button.append(image, name);
          button.addEventListener('click', () => {
            configureDialog('artifact');
            dialogTitle.textContent = artifact.name;
            fillCopy(artifact.description);
            fillStats(artifact.stats);
            dialog.querySelector('[data-dialog-action="back-catalog"]').hidden = false;
          });
          list.append(button);
        }
        catalog.append(title, list);
      }
    }
    catalog.hidden = false;
  } else if (kind === 'artifact') {
    const artifact = artifacts[artifactId];
    if (!artifact) return;
    configureDialog('artifact');
    dialogTitle.textContent = artifact.title;
    fillCopy(artifact.copy);
    fillStats(artifact.stats);
  } else if (kind === 'battle') {
    configureDialog('battle');
    dialogTitle.textContent = '战斗';
    dialogCopy.hidden = true;
    fillCombatDetails();
  } else if (kind === 'settings') {
    configureDialog('settings');
    dialogTitle.textContent = '行旅信息';
    dialogCopy.hidden = true;
    dialogStats.hidden = true;
    settingsForm.hidden = false;
    settingsForm.elements['dao-name'].value = profile.name;
    settingsForm.elements.seed.value = profile.seed;
  }
  if (!dialog.open) dialog.showModal();
  syncMotionPause();
  scheduleBattleBeat();
}

function showNodeDialog(nodeId) {
  const node = mapNodes[nodeId];
  if (!node) return;
  if (dialog.open && dialogKind === 'node' && dialog.dataset.nodeId === nodeId) return;
  configureDialog('node');
  dialog.dataset.nodeId = nodeId;
  dialogTitle.textContent = enemyPreview.name;
  fillCopy(enemyPreview.summary);
  fillStats([
    ['地点', enemyPreview.place],
    ['功法', enemyPreview.method],
  ]);
  dialog.querySelector('[data-dialog-action="cancel-node"]').hidden = false;
  dialog.querySelector('[data-dialog-action="confirm-node"]').hidden = false;
  if (!dialog.open) dialog.showModal();
}

function closeNodePreview() {
  if (history.state?.nodeModal) {
    history.back();
  } else {
    navigate('map', { historyMode: 'replace' });
  }
}

function requestDialogClose() {
  if (!dialog.open) return;
  if (dialogKind === 'node') {
    closeNodePreview();
    return;
  }
  dialog.close();
}

document.querySelectorAll('[data-open-dialog]').forEach(button => {
  button.addEventListener('click', () => {
    openDialog(button.dataset.openDialog, button.dataset.artifactDetail || selectedArtifact);
  });
});

dialog.querySelector('.dialog-close-row').addEventListener('submit', event => {
  if (dialogKind === 'node') {
    event.preventDefault();
    closeNodePreview();
  }
});

dialog.addEventListener('cancel', event => {
  event.preventDefault();
  requestDialogClose();
});

dialog.addEventListener('click', event => {
  if (event.target === dialog) requestDialogClose();
});

dialog.addEventListener('close', () => {
  if (dialogKind === 'node' && !closingDialogForRoute) {
    navigate('map', { historyMode: 'replace' });
  }
  closingDialogForRoute = false;
  dialogKind = '';
  delete dialog.dataset.kind;
  delete dialog.dataset.nodeId;
  syncMotionPause();
  scheduleBattleBeat();
});

settingsForm.addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  profile = {
    name: String(formData.get('dao-name') || '').trim() || '方寄云',
    seed: String(formData.get('seed') || '').trim() || '山海初行',
  };
  document.querySelectorAll('[data-profile-name], [data-map-name], [data-battle-name]')
    .forEach(node => { node.textContent = profile.name; });
  dialog.close();
});

function renderMethod() {
  document.querySelectorAll('[data-method]').forEach(option => {
    option.setAttribute('aria-pressed', String(option.dataset.method === selectedMethod));
  });
  methodCue.textContent = methods[selectedMethod].cue;
  document.querySelector('[data-profile-method]').textContent = methods[selectedMethod].name;
  document.querySelector('[data-map-method]').textContent = methods[selectedMethod].name;
  document.querySelector('[data-battle-method]').textContent = methods[selectedMethod].name;
  drawStartRig();
  syncMotionPause();
}
document.querySelectorAll('[data-method]').forEach(button => {
  button.addEventListener('click', () => {
    selectedMethod = button.dataset.method;
    const url = new URL(location.href);
    url.searchParams.set('method', selectedMethod);
    history.replaceState(history.state, '', url);
    renderMethod();
  });
});

document.querySelector('.start-action').addEventListener('click', () => {
  navigate('map');
});

document.querySelectorAll('[data-map-node]').forEach(button => {
  button.addEventListener('click', () => {
    navigate('map', { node: button.dataset.mapNode, nodeModal: true });
  });
});

dialog.querySelector('[data-dialog-action="cancel-node"]').addEventListener('click', closeNodePreview);
dialog.querySelector('[data-dialog-action="back-catalog"]').addEventListener('click', () => openDialog('library'));
dialog.querySelector('[data-dialog-action="confirm-node"]').addEventListener('click', () => {
  if (!mapNodes[dialog.dataset.nodeId]) return;
  navigate('battle');
});

document.querySelectorAll('[data-battle-control="speed"], [data-battle-control="pause"]').forEach(button => {
  button.addEventListener('click', () => {
    const active = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(active));
    if (button.dataset.battleControl === 'speed') {
      app.dataset.previewSpeed = active ? 'fast' : 'normal';
      button.textContent = active ? '2×' : '1×';
      button.setAttribute('aria-label', active ? '恢复常速' : '切换倍速');
      button.title = active ? '恢复常速' : '切换倍速';
    } else {
      app.dataset.previewPaused = String(active);
      button.textContent = active ? '▶' : 'Ⅱ';
      button.setAttribute('aria-label', active ? '继续' : '暂停');
      button.title = active ? '继续' : '暂停';
    }
    syncMotionPause();
    scheduleBattleBeat();
  });
});

document.querySelector('[data-battle-control="skip"]').addEventListener('click', () => {
  navigate('choice');
});

document.querySelectorAll('[data-artifact-choice]').forEach(button => {
  button.addEventListener('click', () => {
    selectedArtifact = button.dataset.artifactChoice;
    document.querySelectorAll('[data-artifact]').forEach(option => {
      const selected = option.dataset.artifact === selectedArtifact;
      option.classList.toggle('is-selected', selected);
      option.querySelector('[data-artifact-choice]').setAttribute('aria-pressed', String(selected));
    });
    choiceConfirm.disabled = false;
  });
});

function renderInventory() {
  const inventory = document.querySelector('#map-inventory');
  const feedback = document.querySelector('#map-feedback');
  if (chosenArtifact) {
    inventory.textContent = `随身 · ${artifacts[chosenArtifact].name}`;
    inventory.hidden = false;
  } else {
    inventory.hidden = true;
  }
  feedback.textContent = chosenArtifact ? `收下了${artifacts[chosenArtifact].name}` : '';
  feedback.hidden = !chosenArtifact;
}

choiceConfirm.addEventListener('click', () => {
  if (!selectedArtifact || choiceConfirm.disabled) return;
  chosenArtifact = selectedArtifact;
  renderInventory();
  navigate('map');
});

renderInventory();
renderMethod();
renderRoute({ normalize: true });
loadApprovedAssets();
