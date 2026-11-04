export type El = 'jin' | 'mu' | 'shui' | 'huo' | 'tu';
export const ELEMENTS: readonly El[] = ['mu', 'huo', 'tu', 'jin', 'shui'];
export const EL_NAME: Record<El, string> = { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' };
/** 相生: 木→火→土→金→水→木 */
export const GEN: Record<El, El> = { mu: 'huo', huo: 'tu', tu: 'jin', jin: 'shui', shui: 'mu' };
/** 相克: the key overcomes the value. */
export const KE: Record<El, El> = { mu: 'tu', tu: 'shui', shui: 'huo', huo: 'jin', jin: 'mu' };
/** The element that overcomes `el`. */
export const counterOf = (el: El): El => (Object.keys(KE) as El[]).find(key => KE[key] === el)!;
export const EL_EFFECT: Record<El, string> = {
  jin: '锐：暴击率 +12%',
  mu: '生：回复气血',
  shui: '护：获得护盾',
  huo: '焚：灼烧敌人',
  tu: '镇：倍率 +0.5',
};
