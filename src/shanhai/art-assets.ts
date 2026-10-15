type ArtRecord = {
  approval?: { status?: string; reviewedBy?: string };
  artifacts?: Record<string, string>;
  map?: Record<string, string>;
  scenes?: Record<string, string>;
};

type AnimationCharacter = {
  src?: string;
  bodyHeight?: number;
  review?: { status?: string; reviewedBy?: string; date?: string };
};

type AnimationManifest = {
  schemaVersion?: number;
  targetBodyHeight?: number;
  characters?: Record<string, AnimationCharacter>;
  approval?: string;
};

const GENERIC_METHOD_SKINS: Record<string, string> = {
  RKF06: 'RKF01',
  RKF07: 'RKF02',
  RKF08: 'RKF03',
  RKF09: 'RKF04',
  RKF10: 'RKF05',
};
const VALID_METHODS = new Set(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']);
const UNKNOWN_ENEMY_SKIN = 'EN-A1-L1';
const ENEMY_FRAME_IDS = new Set([
  ...Array.from({ length: 4 }, (_, act) => [
    ...Array.from({ length: 4 }, (_, index) => `EN-A${act + 1}-C${index + 1}`),
    ...Array.from({ length: 2 }, (_, index) => `EN-A${act + 1}-L${index + 1}`),
    ...Array.from({ length: 2 }, (_, index) => `EN-A${act + 1}-B${index + 1}`),
  ]).flat(),
  'EN-F1',
  'EN-F2',
]);
const PLAYER_FRAME_IDS = [...VALID_METHODS];
const NODE_ILLUSTRATIONS: Record<string, string> = {
  C: 'forest',
  E: 'coast',
  R: 'rest',
  S: 'shop',
  K: 'stairs',
  L: 'gate',
  B: 'gate',
  F: 'gate',
};
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
};

let artLibrary: ArtRecord | null = null;
let animationManifest: AnimationManifest | null = null;
let loading: Promise<void> | null = null;

function escapeAttribute(value: string): string {
  return value.replace(/[&"'<>]/g, character => HTML_ESCAPE[character]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function fetchJson<T>(source: string): Promise<T> {
  const response = await fetch(assetUrl(source), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load art manifest: ${source} (${response.status})`);
  return response.json() as Promise<T>;
}

export function assetUrl(src: string): string {
  if (typeof src !== 'string') throw new TypeError('Asset source must be a string');
  const relative = src.startsWith('/assets/')
    ? src.slice('/assets/'.length)
    : src.startsWith('assets/') ? src.slice('assets/'.length) : '';
  if (!relative || relative.split('/').some(segment => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment))) {
    throw new Error(`Invalid public asset path: ${src}`);
  }
  return new URL(`../assets/${relative}`, import.meta.url).href;
}

export function loadArtLibrary(): Promise<void> {
  if (!loading) {
    loading = Promise.all([
      fetchJson<ArtRecord>('/assets/game-art.json'),
      fetchJson<AnimationManifest>('/assets/frames.json'),
    ]).then(([library, frames]) => {
      if (!isRecord(library) ||
          library.approval?.status !== 'approved' ||
          library.approval?.reviewedBy !== 'user' ||
          !isRecord(library.artifacts) ||
          !isRecord(library.map) ||
          !isRecord(library.scenes) ||
          !isRecord(frames) ||
          frames.schemaVersion !== 1 ||
          frames.approval !== 'approved' ||
          !isRecord(frames.characters)) {
        throw new Error('Invalid approved game-art manifests');
      }
      const characterIds = Object.keys(frames.characters);
      if (characterIds.length !== PLAYER_FRAME_IDS.length + ENEMY_FRAME_IDS.size ||
          PLAYER_FRAME_IDS.some(id => !Object.hasOwn(frames.characters!, id)) ||
          [...ENEMY_FRAME_IDS].some(id => !Object.hasOwn(frames.characters!, id)) ||
          new Set(Object.values(frames.characters).map(character =>
            (character as AnimationCharacter)?.src)).size !== characterIds.length) {
        throw new Error('Invalid complete enemy game-art frame map');
      }
      for (const id of ENEMY_FRAME_IDS) {
        const character = frames.characters[id] as AnimationCharacter | undefined;
        if (!character || typeof character.src !== 'string' ||
            (id !== UNKNOWN_ENEMY_SKIN &&
              (character.review?.status !== 'agent-reviewed' ||
                character.review.reviewedBy !== 'agent' ||
                character.review.date !== '2026-10-15'))) {
          throw new Error(`Invalid reviewed enemy frame record: ${id}`);
        }
      }
      artLibrary = library;
      animationManifest = frames;
    }).catch(error => {
      loading = null;
      throw error;
    });
  }
  return loading;
}

export function getAnimationManifest(): AnimationManifest | null {
  return animationManifest;
}

export function characterSkin(method: string, enemyId?: string): string {
  if (enemyId !== undefined) {
    const hasAnimationManifest = animationManifest !== null;
    const enemyIsKnown = ENEMY_FRAME_IDS.has(enemyId) &&
      (!hasAnimationManifest || !!animationManifest?.characters?.[enemyId]);
    return enemyIsKnown ? enemyId : UNKNOWN_ENEMY_SKIN;
  }
  if (VALID_METHODS.has(method)) return method;
  return GENERIC_METHOD_SKINS[method] ?? 'RKF01';
}

export function characterArt(method: string, enemyId?: string): string {
  const skin = characterSkin(method, enemyId);
  const frames = animationManifest;
  const character = frames?.characters?.[skin];
  const source = character?.src ?? `/assets/frames-${skin.toLowerCase()}.png`;
  const targetHeight = frames?.targetBodyHeight ?? 300;
  const bodyHeight = character?.bodyHeight ?? targetHeight;
  const stature = targetHeight / bodyHeight;
  const background = escapeAttribute(`background-image:url(${assetUrl(source)})`);
  const fallback = enemyId !== undefined && skin === UNKNOWN_ENEMY_SKIN && enemyId !== skin
    ? ` data-art-fallback="unknown-enemy:${UNKNOWN_ENEMY_SKIN}"`
    : '';
  return `<span class="character-art" data-art-skin="${escapeAttribute(skin)}"${fallback} aria-hidden="true" style="--stature:${stature}"><span class="character-cel" style="${background}"></span></span>`;
}

function imageMarkup(className: string, source: string, extra = ''): string {
  return `<img class="${className}" src="${escapeAttribute(assetUrl(source))}" alt=""${extra}>`;
}

export function artifactArt(id: string): string {
  const source = artLibrary?.artifacts?.[id];
  return typeof source === 'string' ? imageMarkup('artifact-art', source) : '';
}

export function mapArt(type: string): string {
  const illustration = NODE_ILLUSTRATIONS[type];
  const source = illustration ? artLibrary?.map?.[illustration] : undefined;
  return typeof source === 'string'
    ? imageMarkup('map-node-art', source, ` data-node-type="${escapeAttribute(type)}" aria-hidden="true"`)
    : '';
}

export function sceneArt(kind: 'start' | 'map' | 'battle'): string {
  const source = artLibrary?.scenes?.[kind];
  return typeof source === 'string'
    ? imageMarkup('game-scene', source, ' aria-hidden="true"')
    : '';
}
