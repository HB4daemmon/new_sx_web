import {
  assetUrl,
  characterSkin,
  getAnimationManifest,
  loadArtLibrary,
} from './art-assets.js';
import type { AnimationRig, AnimationRuntime } from './animation.js';
import { battlePresentationCue } from './battle-presentation.js';
import { combatPresentationMotion } from './battle-playback.js';
import type { CombatPresentationGroup } from './battle-playback.js';
import type { BattleFrame, Side } from './types.js';

export interface BattleArtAction {
  side: Side;
  action: 'attack' | 'rage' | 'hit' | 'guard' | 'heal' | 'artifact';
}

export function battleActionForFrame(frame: BattleFrame): BattleArtAction | undefined {
  if (frame.kind !== 'action' || !frame.actor) return undefined;
  const actionKind = battlePresentationCue(frame).actionKind;
  if (actionKind === 'basic') return { side: frame.actor, action: 'attack' };
  if (actionKind === 'rage') return { side: frame.actor, action: 'rage' };
  return undefined;
}

export function battleReactionsForGroup(
  group: CombatPresentationGroup,
  releasingActions: ReadonlySet<Side> = new Set(),
): BattleArtAction[] {
  const reactions: BattleArtAction[] = [];
  for (const side of ['player', 'enemy'] as const) {
    const summary = group[side];
    const motion = combatPresentationMotion(summary, group.dot);
    if (motion === 'hit' || motion === 'dot') reactions.push({ side, action: 'hit' });
    else if (motion === 'block') reactions.push({ side, action: 'guard' });
    else if (!releasingActions.has(side)) {
      if (motion === 'heal') reactions.push({ side, action: 'heal' });
      else if (motion === 'shield' || motion === 'buff') reactions.push({ side, action: 'artifact' });
    }
  }
  return reactions;
}

interface StartMount {
  canvas: HTMLCanvasElement;
  token: number;
  method: string;
}

interface BattleMount {
  canvas: HTMLCanvasElement;
  token: number;
  arena: HTMLElement;
  state: Omit<BattleArtSync, 'canvas' | 'arena'>;
  onDraw?: EventListener;
  resizeObserver?: ResizeObserver;
  motionQuery?: MediaQueryList;
  onMotionChange?: () => void;
}

interface BattleArtSync {
  canvas: HTMLCanvasElement | null;
  arena: HTMLElement | null;
  method: string;
  enemyMethod: string;
  enemyId: string;
  paused: boolean;
  cursorChanged: boolean;
  elapsed?: number;
  frame?: BattleFrame;
  group?: CombatPresentationGroup;
}

interface DynamicAnimationRig extends AnimationRig {
  hasCharacter(id: string): boolean;
  addCharacter(
    manifest: Record<string, any>,
    images: Map<string, HTMLImageElement>,
    id: string,
  ): void;
}

export class GameArt {
  private runtimePromise: Promise<AnimationRuntime | null> | null = null;
  private runtimeFailed = false;
  private manifest: Record<string, any> | null = null;
  private startManifest: Record<string, any> | null = null;
  private images: Map<string, HTMLImageElement> | null = null;
  private battleSkinLoads = new Map<string, Promise<void>>();
  private startRig: AnimationRig | null = null;
  private pendingStart: StartMount | null = null;
  private startToken = 0;
  private battleRig: AnimationRig | null = null;
  private battleMount: BattleMount | null = null;
  private pendingBattle: BattleMount | null = null;
  private battleToken = 0;
  private battlePaused = false;
  private reducedMotion(): boolean {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  load(): Promise<boolean> {
    return this.runtimePromiseOrLoad().then(runtime => Boolean(runtime));
  }

  syncStart(canvas: HTMLCanvasElement | null, method: string): void {
    if (!canvas) {
      this.disposeStart();
      return;
    }
    if (this.runtimeFailed) return;
    if (this.startRig?.canvas === canvas) {
      this.startRig.configure(characterSkin(method));
      return;
    }
    if (this.pendingStart?.canvas === canvas) {
      this.pendingStart.method = method;
      return;
    }

    this.disposeStart();
    const mount = { canvas, token: this.startToken, method };
    this.pendingStart = mount;
    void this.createStart(mount);
  }

  syncBattle(state: BattleArtSync): void {
    const { canvas, arena } = state;
    if (!canvas || !arena) {
      this.disposeBattle();
      return;
    }
    this.battlePaused = state.paused;
    if (this.battleMount?.canvas === canvas && this.battleMount.arena === arena) {
      this.battleMount.state = {
        method: state.method,
        enemyMethod: state.enemyMethod,
        enemyId: state.enemyId,
        paused: state.paused,
        cursorChanged: state.cursorChanged,
        elapsed: state.elapsed,
        frame: state.frame,
        group: state.group,
      };
      if (this.battleRig) this.applyBattleState(state, this.battleRig);
      else this.syncFeedbackAnchors(this.battleMount);
      return;
    }
    if (this.pendingBattle?.canvas === canvas && this.pendingBattle.arena === arena) {
      const pending = this.pendingBattle;
      const cursorChanged = pending.state.cursorChanged || state.cursorChanged;
      pending.state = {
        ...state,
        cursorChanged,
      };
      return;
    }

    this.disposeBattle();
    const mount: BattleMount = {
      canvas,
      arena,
      token: this.battleToken,
      state: {
        method: state.method,
        enemyMethod: state.enemyMethod,
        enemyId: state.enemyId,
        paused: state.paused,
        cursorChanged: state.cursorChanged,
        elapsed: state.elapsed,
        frame: state.frame,
        group: state.group,
      },
    };
    this.pendingBattle = mount;
    mount.onDraw = () => this.syncFeedbackAnchors(mount);
    canvas.addEventListener('battle-art-draw', mount.onDraw);
    if (typeof ResizeObserver !== 'undefined') {
      mount.resizeObserver = new ResizeObserver(() => this.syncFeedbackAnchors(mount));
      mount.resizeObserver.observe(arena);
    }
    mount.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    mount.onMotionChange = () => {
      this.setBattlePaused(this.battlePaused);
      this.battleRig?.draw();
    };
    mount.motionQuery?.addEventListener?.('change', mount.onMotionChange);
    this.syncFeedbackAnchors(mount);
    void this.createBattle(mount);
  }

  setBattlePaused(paused: boolean): void {
    this.battlePaused = paused;
    const rig = this.battleRig;
    if (!rig) return;
    rig.timeline.configure({ active: true, paused, reduced: this.reducedMotion(), speed: 1 });
    if (!paused) rig.draw();
  }

  advanceBattle(gameDelta: number): void {
    const rig = this.battleRig;
    if (!rig || this.battlePaused || !Number.isFinite(gameDelta) || gameDelta <= 0) return;
    rig.timeline.advance(gameDelta);
    rig.draw();
  }

  drawBattle(): void {
    this.battleRig?.draw();
  }

  cancelBattle(): void {
    const rig = this.battleRig;
    if (!rig) return;
    rig.timeline.configure({ active: false, paused: false, reduced: false, speed: 1 });
    rig.draw();
  }

  dispose(): void {
    this.disposeStart();
    this.disposeBattle();
  }

  private async loadRuntime(): Promise<AnimationRuntime> {
    await loadArtLibrary();
    const source = getAnimationManifest();
    if (!source || typeof source !== 'object' || !source.characters) {
      throw new Error('Drawn-frame manifest unavailable');
    }
    const manifest = JSON.parse(JSON.stringify(source)) as Record<string, any>;
    const startManifest = { ...manifest, characters: {} as Record<string, any> };
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05'].map(async id => {
      const character = manifest.characters[id] as Record<string, any> | undefined;
      if (!character || typeof character.src !== 'string') {
        throw new Error(`Drawn-frame source unavailable: ${id}`);
      }
      const src = assetUrl(character.src);
      character.src = src;
      startManifest.characters[id] = character;
      images.set(src, await this.loadFrameImage(src));
    }));

    const runtimePath: string = './animation.js';
    const runtime = await import(runtimePath) as AnimationRuntime;
    this.manifest = manifest;
    this.startManifest = startManifest;
    this.images = images;
    return runtime;
  }

  private async loadFrameImage(src: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
      throw new Error(`Drawn-frame image is empty: ${src}`);
    }
    return image;
  }

  private resolvedFrameSource(source: string): string {
    return /^(?:https?:|file:)/.test(source) ? source : assetUrl(source);
  }

  private async imageForCharacter(id: string): Promise<HTMLImageElement> {
    const character = this.manifest?.characters?.[id] as Record<string, any> | undefined;
    if (!character || typeof character.src !== 'string') {
      throw new Error(`Drawn-frame character is unavailable: ${id}`);
    }
    const cached = this.images?.get(character.src);
    return cached || this.loadFrameImage(this.resolvedFrameSource(character.src));
  }

  private characterManifest(ids: string[]): Record<string, any> {
    const source = this.manifest;
    if (!source?.characters) throw new Error('Drawn-frame manifest unavailable');
    const characters: Record<string, any> = {};
    for (const id of ids) {
      const character = source.characters[id];
      if (!character || typeof character.src !== 'string') {
        throw new Error(`Drawn-frame character is unavailable: ${id}`);
      }
      characters[id] = {
        ...character,
        src: this.resolvedFrameSource(character.src),
      };
    }
    return { ...source, characters };
  }

  private async battleResources(
    state: BattleMount['state'],
  ): Promise<{ manifest: Record<string, any>; images: Map<string, HTMLImageElement> }> {
    const playerId = characterSkin(state.method);
    const enemyId = characterSkin(state.enemyMethod, state.enemyId);
    const manifest = this.characterManifest([playerId, enemyId]);
    const images = new Map<string, HTMLImageElement>();
    await Promise.all([playerId, enemyId].map(async id => {
      const src = manifest.characters[id].src as string;
      const cached = this.images?.get(src);
      images.set(src, cached || await this.loadFrameImage(src));
    }));
    return { manifest, images };
  }

  private async createStart(mount: StartMount): Promise<void> {
    try {
      const runtime = await this.runtimePromiseOrLoad();
      if (!this.isCurrentStart(mount)) return;
      if (!runtime) {
        this.pendingStart = null;
        return;
      }
      const rig = await runtime.FrameStart.create(
        mount.canvas,
        this.startManifest!,
        this.images!,
      );
      if (!this.isCurrentStart(mount) || !mount.canvas.isConnected) {
        rig.dispose();
        return;
      }
      this.startRig = rig;
      this.pendingStart = null;
      rig.configure(characterSkin(mount.method));
      mount.canvas.closest<HTMLElement>('[data-game-start-stage]')?.setAttribute('data-art-ready', 'true');
    } catch {
      if (this.isCurrentStart(mount)) this.pendingStart = null;
    }
  }

  private async createBattle(mount: BattleMount): Promise<void> {
    let rig: AnimationRig | null = null;
    try {
      const runtime = await this.runtimePromiseOrLoad();
      if (!this.isCurrentBattle(mount)) return;
      if (!runtime) {
        this.pendingBattle = null;
        this.battleMount = mount;
        mount.arena.dataset.artReady = 'false';
        this.syncFeedbackAnchors(mount);
        return;
      }
      let resources: Awaited<ReturnType<GameArt['battleResources']>>;
      while (this.isCurrentBattle(mount)) {
        const requested = [
          characterSkin(mount.state.method),
          characterSkin(mount.state.enemyMethod, mount.state.enemyId),
        ];
        resources = await this.battleResources(mount.state);
        const latest = [
          characterSkin(mount.state.method),
          characterSkin(mount.state.enemyMethod, mount.state.enemyId),
        ];
        if (requested[0] === latest[0] && requested[1] === latest[1]) break;
      }
      if (!this.isCurrentBattle(mount)) return;
      rig = await runtime.FrameBattle.create(
        mount.canvas,
        resources!.manifest,
        resources!.images,
        () => this.failBattle(mount),
      );
      if (!this.isCurrentBattle(mount) || !mount.canvas.isConnected) {
        rig.dispose();
        return;
      }
      this.battleRig = rig;
      this.battleMount = mount;
      this.pendingBattle = null;
      this.applyBattleState({
        canvas: mount.canvas,
        arena: mount.arena,
        ...mount.state,
        cursorChanged: true,
        paused: false,
      }, rig);
      if (mount.state.elapsed) {
        rig.timeline.advance(mount.state.elapsed);
        rig.draw();
      }
      this.setBattlePaused(mount.state.paused);
      mount.arena.dataset.artReady = 'true';
      mount.canvas.parentElement?.setAttribute('data-art-ready', 'true');
      this.syncFeedbackAnchors(mount);
    } catch {
      if (this.isCurrentBattle(mount)) {
        if (this.battleRig === rig) {
          this.battleRig = null;
          this.battleMount = null;
        }
        rig?.dispose();
        this.pendingBattle = null;
        this.battleMount = mount;
        mount.arena.dataset.artReady = 'false';
        this.syncFeedbackAnchors(mount);
      }
    }
  }

  private applyBattleState(state: BattleArtSync, rig: AnimationRig): void {
    const mount = this.battleMount;
    if (!mount) return;
    this.ensureBattleCharacter(rig, 'player', characterSkin(state.method));
    this.ensureBattleCharacter(
      rig,
      'enemy',
      characterSkin(state.enemyMethod, state.enemyId),
    );
    rig.timeline.configure({
      active: true,
      paused: state.paused,
      reduced: this.reducedMotion(),
      speed: 1,
    });
    this.battlePaused = state.paused;
    if (state.cursorChanged && state.frame) {
      const action = battleActionForFrame(state.frame);
      if (action) rig.timeline.play(action.side, action.action);
      else if (state.group) {
        const releasingActions = new Set<Side>();
        for (const side of ['player', 'enemy'] as const) {
          const action = rig.timeline.actions.get(side)?.action;
          if (action === 'rage' || action === 'attack') releasingActions.add(side);
        }
        for (const reaction of battleReactionsForGroup(state.group, releasingActions)) {
          rig.timeline.play(reaction.side, reaction.action);
        }
      }
    }
    if (!state.paused) rig.draw();
  }

  private ensureBattleCharacter(rig: AnimationRig, side: Side, id: string): void {
    const dynamicRig = rig as DynamicAnimationRig;
    if (dynamicRig.hasCharacter(id)) {
      rig.setCharacter(side, id);
      return;
    }
    if (this.battleSkinLoads.has(id)) return;

    const mount = this.battleMount;
    if (!mount) return;
    mount.arena.dataset.artReady = 'false';
    mount.canvas.parentElement?.setAttribute('data-art-ready', 'false');
    const load = (async () => {
      const manifest = this.characterManifest([id]);
      const characterImages = new Map<string, HTMLImageElement>();
      const image = await this.imageForCharacter(id);
      const src = manifest.characters[id].src as string;
      characterImages.set(src, image);
      if (!this.isCurrentBattle(mount) || this.battleRig !== rig ||
          (side === 'player' && characterSkin(mount.state.method) !== id) ||
          (side === 'enemy' && characterSkin(mount.state.enemyMethod, mount.state.enemyId) !== id)) {
        return;
      }
      dynamicRig.addCharacter(manifest, characterImages, id);
      rig.setCharacter(side, id);
      rig.draw();
      const ready = [
        characterSkin(mount.state.method),
        characterSkin(mount.state.enemyMethod, mount.state.enemyId),
      ].every(skin => dynamicRig.hasCharacter(skin));
      mount.arena.dataset.artReady = String(ready);
      mount.canvas.parentElement?.setAttribute('data-art-ready', String(ready));
      this.syncFeedbackAnchors(mount);
    })();
    this.battleSkinLoads.set(id, load);
    void load.catch(() => {
      if (this.isCurrentBattle(mount) && this.battleRig === rig) {
        mount.arena.dataset.artReady = 'false';
        mount.canvas.parentElement?.setAttribute('data-art-ready', 'false');
      }
    }).finally(() => {
      if (this.battleSkinLoads.get(id) === load) this.battleSkinLoads.delete(id);
    });
  }

  private failBattle(mount: BattleMount): void {
    if (!this.isCurrentBattle(mount)) return;
    this.battleRig?.dispose();
    this.battleRig = null;
    mount.arena.dataset.artReady = 'false';
    mount.canvas.parentElement?.setAttribute('data-art-ready', 'false');
    this.syncFeedbackAnchors(mount);
  }

  private syncFeedbackAnchors(mount: BattleMount): void {
    const snapshot = mount.canvas.getFrameSnapshot?.();
    for (const side of ['player', 'enemy'] as const) {
      let head = mount.arena.dataset.artReady === 'true' ? snapshot?.[side]?.head : undefined;
      if (!head) {
        const art = mount.arena.querySelector<HTMLElement>(
          `.combatant[data-side="${side}"] .fighter-art .character-art`,
        );
        if (!art) continue;
        const rect = art.getBoundingClientRect();
        const canvasRect = mount.canvas.getBoundingClientRect();
        const manifest = getAnimationManifest() as Record<string, any> | null;
        const character = manifest?.characters?.[art.dataset.artSkin || ''];
        const [left, top, right] = character?.cels?.[0]?.bounds || [0, 0, 400];
        const center = (left + right) / 800;
        head = {
          x: rect.left - canvasRect.left + rect.width * (side === 'player' ? center : 1 - center),
          y: rect.top - canvasRect.top + rect.height * top / 448,
        };
      }
      if (!head || !Number.isFinite(head.x) || !Number.isFinite(head.y)) continue;
      mount.arena.style.setProperty(`--${side}-head-x`, `${head.x.toFixed(2)}px`);
      mount.arena.style.setProperty(`--${side}-head-y`, `${head.y.toFixed(2)}px`);
    }
  }

  private runtimePromiseOrLoad(): Promise<AnimationRuntime | null> {
    if (!this.runtimePromise) {
      this.runtimePromise = this.loadRuntime().catch(() => {
        this.runtimeFailed = true;
        return null;
      });
    }
    return this.runtimePromise;
  }

  private isCurrentStart(mount: StartMount): boolean {
    return this.pendingStart === mount && mount.token === this.startToken;
  }

  private isCurrentBattle(mount: BattleMount): boolean {
    return (this.pendingBattle === mount || this.battleMount === mount) &&
      mount.token === this.battleToken;
  }

  private disposeStart(): void {
    this.startToken += 1;
    this.pendingStart = null;
    this.startRig?.dispose();
    this.startRig = null;
  }

  private disposeBattle(): void {
    this.battleToken += 1;
    const mount = this.battleMount || this.pendingBattle;
    if (mount?.onDraw) mount.canvas.removeEventListener('battle-art-draw', mount.onDraw);
    mount?.resizeObserver?.disconnect();
    if (mount?.onMotionChange) mount.motionQuery?.removeEventListener?.('change', mount.onMotionChange);
    this.pendingBattle = null;
    if (this.battleMount) {
      this.battleMount.arena.dataset.artReady = 'false';
      this.battleMount.canvas.parentElement?.setAttribute('data-art-ready', 'false');
    }
    this.battleRig?.dispose();
    this.battleRig = null;
    this.battleMount = null;
    this.battleSkinLoads.clear();
    this.battlePaused = false;
  }
}
