export const ELEMENTS = ['mu', 'huo', 'tu', 'jin', 'shui'];
export const EL_NAME = { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' };
/** 相生: 木→火→土→金→水→木 */
export const GEN = { mu: 'huo', huo: 'tu', tu: 'jin', jin: 'shui', shui: 'mu' };
/** 相克: the key overcomes the value. */
export const KE = { mu: 'tu', tu: 'shui', shui: 'huo', huo: 'jin', jin: 'mu' };
/** The element that overcomes `el`. */
export const counterOf = (el) => Object.keys(KE).find(key => KE[key] === el);
export const EL_EFFECT = {
    jin: '锐：暴击率 +12%',
    mu: '生：回复气血',
    shui: '护：获得护盾',
    huo: '焚：灼烧敌人',
    tu: '镇：倍率 +0.5',
};
