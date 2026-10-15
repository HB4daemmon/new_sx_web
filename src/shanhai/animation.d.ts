export interface AnimationRig {
  canvas: HTMLCanvasElement;
  timeline: {
    actions: Map<string, { action: string; impacted: boolean; onImpact?: () => void }>;
    configure(options?: {
      active?: boolean;
      paused?: boolean;
      reduced?: boolean;
      speed?: number;
    }): void;
    play(side: string, action: string, onImpact?: (() => void) | null, artifactSrc?: string | null): unknown;
    advance(delta: number): number;
  };
  configure(method: string): void;
  setCharacter(side: string, id: string): void;
  draw(): void;
  dispose(): void;
}

export interface AnimationRuntime {
  FrameStart: {
    create(
      canvas: HTMLCanvasElement,
      manifest: Record<string, any>,
      images: Map<string, HTMLImageElement>,
    ): Promise<AnimationRig>;
  };
  FrameBattle: {
    create(
      canvas: HTMLCanvasElement,
      manifest: Record<string, any>,
      images: Map<string, HTMLImageElement>,
      onFailure?: () => void,
    ): Promise<AnimationRig>;
  };
}

declare global {
  interface HTMLCanvasElement {
    getFrameSnapshot?: () => Record<string, any>;
  }
}
