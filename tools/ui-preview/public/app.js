const requiredAssetIds = [
  'battle-scene',
  'start-scene',
  'player',
  'enemy',
  'artifact-rr09',
  'artifact-rr11',
  'artifact-rr15',
];
const requiredAssets = new Map([
  ['battle-scene', { src: '/assets/scene-battle.webp', kind: 'scene', screen: 'battle' }],
  ['start-scene', { src: '/assets/scene-start.webp', kind: 'scene', screen: 'start' }],
  ['player', { src: '/assets/player.png', kind: 'character', screen: 'battle' }],
  ['enemy', { src: '/assets/enemy.png', kind: 'character', screen: 'battle' }],
  ['artifact-rr09', { src: '/assets/artifact-rr09.svg', kind: 'artifact', target: 'artifact-rr09', contentId: 'RR09' }],
  ['artifact-rr11', { src: '/assets/artifact-rr11.svg', kind: 'artifact', target: 'artifact-rr11', contentId: 'RR11' }],
  ['artifact-rr15', { src: '/assets/artifact-rr15.svg', kind: 'artifact', target: 'artifact-rr15', contentId: 'RR15' }],
]);
const methods = {
  RKF01: {
    name: '金刚功',
    cue: '防御化盾，借盾反击。',
  },
  RKF02: {
    name: '归元诀',
    cue: '怒技返还怒气，衔接更快。',
  },
  RKF03: {
    name: '回春功',
    cue: '攻击兼有治疗，气血越高回复越多。',
  },
  RKF04: {
    name: '御火诀',
    cue: '叠加燃烧，持续伤敌。',
  },
  RKF05: {
    name: '养剑诀',
    cue: '普攻积剑势，持续增强。',
  },
};
const allowedScreens = new Set(['battle', 'start', 'choice']);
const allowedViews = new Set(['overview', ...allowedScreens, 'compare']);
const assetPathPattern = /^\/assets\/(?:scene-(?:battle|start)\.(?:png|webp)|(?:player|enemy)\.(?:png|webp)|artifact-[a-z0-9-]+\.(?:png|webp)|artifact-rr(?:09|11|15)\.svg)$/;
const app = document.querySelector('#preview-app');
const assetStatus = document.querySelector('#asset-status');
const captureButton = document.querySelector('#capture-preview');
const params = new URLSearchParams(location.search);
const initialScreen = params.get('screen');
let currentView = allowedViews.has(initialScreen) ? initialScreen : 'overview';
let selectedArtifact = 'artifact-rr09';
let selectedMethod = 'RKF01';
let captureRequested = allowedScreens.has(currentView) && params.get('capture') === '1';
app.dataset.assetsReady = 'false';
app.dataset.visualApproval = 'pending';
app.dataset.previewSpeed = 'normal';
app.dataset.previewPaused = 'false';

function setView(view, { historyMode = 'push', preserveCapture = false } = {}) {
  if (!allowedViews.has(view)) return;
  const requestCapture = preserveCapture &&
    allowedScreens.has(view) &&
    new URLSearchParams(location.search).get('capture') === '1';
  currentView = view === 'compare' ? 'battle' : view;
  app.dataset.view = view;
  captureButton.hidden = view === 'overview' || view === 'compare';
  document.querySelectorAll('[data-view-link]').forEach(link => {
    if (link.dataset.viewLink === view) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  const url = new URL(location.href);
  url.searchParams.set('screen', view);
  captureRequested = requestCapture;
  if (!captureRequested) {
    delete app.dataset.capture;
    url.searchParams.delete('capture');
  } else if (app.dataset.assetsReady === 'true') {
    app.dataset.capture = 'true';
  }

  if (historyMode === 'push' && url.href !== location.href) {
    history.pushState(null, '', url);
  } else if (historyMode === 'replace' && url.href !== location.href) {
    history.replaceState(null, '', url);
  }
}

function viewFromLocation() {
  const view = new URLSearchParams(location.search).get('screen');
  return allowedViews.has(view) ? view : 'overview';
}

document.querySelectorAll('[data-view-link]').forEach(link => {
  link.addEventListener('click', event => {
    if (
      event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    ) return;
    event.preventDefault();
    setView(link.dataset.viewLink);
  });
});

window.addEventListener('popstate', () => {
  setView(viewFromLocation(), { historyMode: 'none', preserveCapture: true });
});

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
      !['scene', 'character', 'artifact'].includes(asset.kind)
    ) {
      return false;
    }
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

  const results = await Promise.allSettled(manifest.assets
    .filter(asset => asset.required)
    .map(attachAsset));
  const requiredLoaded = manifest.assets
    .filter(asset => asset.required)
    .every((asset, index) => results[index]?.status === 'fulfilled');
  if (!requiredLoaded) {
    assetStatus.textContent = '待装入正式素材';
    return;
  }

  app.dataset.assetsReady = 'true';
  app.dataset.visualApproval = 'pending';
  assetStatus.textContent = '素材已载入，待视觉确认';
  captureButton.disabled = false;

  if (captureRequested) {
    app.dataset.capture = 'true';
  }
}

captureButton.addEventListener('click', () => {
  if (captureButton.disabled) return;
  const url = new URL(location.href);
  url.searchParams.set('screen', currentView);
  url.searchParams.set('capture', '1');
  location.assign(url);
});

const dialog = document.querySelector('#detail-dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogCopy = document.querySelector('#dialog-copy');
const dialogStats = document.querySelector('#dialog-stats');
const methodCue = document.querySelector('#method-cue');
const artifactDetails = {
  'artifact-rr09': {
    title: '震岳鼓',
    copy: '防御 +8。敌方行动中，若已有护盾反击造成伤害，该次敌方行动结束时额外获得10点怒气；此法宝不提供反击效果。',
    stats: [['防御', '+8'], ['回怒', '每次符合条件的敌方行动 +10']],
  },
  'artifact-rr11': {
    title: '余烬盏',
    copy: '最大气血 +30。自身施加的中毒或燃烧每轮首次对敌方气血造成伤害后，额外获得10点怒气；伤害被护盾完全吸收时不触发，每轮最多一次。',
    stats: [['最大气血', '+30'], ['回怒', '每轮最多一次 +10']],
  },
  'artifact-rr15': {
    title: '定心佩',
    copy: '最大气血 +30。受到来自其他来源的削怒效果降低50%；多项削怒抗性相加，最高降低100%，不影响获得怒气或受击回怒。',
    stats: [['最大气血', '+30'], ['外来削怒', '降低 50%']],
  },
};

function openDialog(kind, artifactId = selectedArtifact) {
  const artifact = artifactDetails[artifactId];
  const data = kind === 'artifact'
    ? artifact
    : {
      title: '战斗样稿',
      copy: '静态界面示例，不代表实战状态。两名角色各显示气血与护盾合并条、怒气条。',
      stats: [['方寄云', '金刚功'], ['养锋石卫', '养剑诀'], ['气血与护盾', '示例数值']],
    };
  dialogTitle.textContent = data.title;
  dialogCopy.textContent = data.copy;
  dialogStats.replaceChildren(...data.stats.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    return [term, detail];
  }));
  dialog.showModal();
}

document.querySelectorAll('[data-open-dialog]').forEach(button => {
  button.addEventListener('click', () => {
    openDialog(button.dataset.openDialog, button.dataset.artifactDetail || selectedArtifact);
  });
});

document.querySelectorAll('[data-battle-control="speed"], [data-battle-control="pause"]').forEach(button => {
  button.addEventListener('click', () => {
    const active = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(active));
    if (button.dataset.battleControl === 'speed') {
      app.dataset.previewSpeed = active ? 'fast' : 'normal';
      button.setAttribute('aria-label', active ? '恢复常速' : '切换倍速');
    } else {
      app.dataset.previewPaused = String(active);
      button.textContent = active ? '继续' : '暂停';
    }
  });
});

document.querySelector('[data-battle-control="skip"]').addEventListener('click', event => {
  const button = event.currentTarget;
  button.setAttribute('aria-pressed', 'true');
  button.dataset.skipFeedback = 'true';
  window.setTimeout(() => {
    button.setAttribute('aria-pressed', 'false');
    button.dataset.skipFeedback = 'false';
  }, 240);
});

document.querySelectorAll('[data-method]').forEach(button => {
  button.addEventListener('click', () => {
    selectedMethod = button.dataset.method;
    document.querySelectorAll('[data-method]').forEach(option => {
      option.setAttribute('aria-pressed', String(option === button));
    });
    methodCue.textContent = methods[selectedMethod].cue;
  });
});

document.querySelector('.start-form').addEventListener('submit', event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  dialogTitle.textContent = '踏入山海';
  dialogCopy.textContent = `${formData.get('dao-name') || '无名客'} · 命数种子 ${formData.get('seed') || '未填写'} · ${methods[selectedMethod].name}`;
  dialogStats.replaceChildren();
  dialog.showModal();
});

document.querySelectorAll('[data-artifact-choice]').forEach(button => {
  button.addEventListener('click', () => {
    selectedArtifact = button.dataset.artifactChoice;
    document.querySelectorAll('[data-artifact]').forEach(option => {
      const selected = option.dataset.artifact === selectedArtifact;
      option.classList.toggle('is-selected', selected);
      option.querySelector('[data-artifact-choice]').setAttribute('aria-pressed', String(selected));
    });
  });
});

document.querySelector('.choice-confirm').addEventListener('click', () => openDialog('artifact'));

dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});

setView(currentView, { historyMode: 'replace', preserveCapture: true });
loadApprovedAssets();
