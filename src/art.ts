/** PNG art sourced from the Twemoji artwork set; see assets/casual/SOURCES.md. */
export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]!));

type ArtAsset = {
  file: string;
  alt: string;
};

const iconArt: Record<string, ArtAsset> = {
  sword: { file: '2694.png', alt: '交叉双剑' },
  swords: { file: '2694.png', alt: '交叉双剑' },
  spear: { file: '2694.png', alt: '交叉双剑' },
  flame: { file: '1f525.png', alt: '火焰' },
  shield: { file: '1f6e1.png', alt: '盾牌' },
  mirror: { file: '1fa9e.png', alt: '镜子' },
  fist: { file: '270a.png', alt: '举起的拳头' },
  bolt: { file: '26a1.png', alt: '闪电' },
  lotus: { file: '1fab7.png', alt: '荷花' },
  sun: { file: '2600.png', alt: '太阳' },
  moon: { file: '1f319.png', alt: '月牙' },
  eye: { file: '1f441.png', alt: '眼睛' },
  mountain: { file: '26f0.png', alt: '山峰' },
  cloud: { file: '2601.png', alt: '云' },
  wave: { file: '1f30a.png', alt: '海浪' },
  pearl: { file: '1f52e.png', alt: '水晶球' },
  orbs: { file: '1f52e.png', alt: '水晶球' },
  bell: { file: '1f514.png', alt: '铃铛' },
  flag: { file: '1f6a9.png', alt: '旗帜' },
  jade: { file: '1f48e.png', alt: '宝石' },
  feather: { file: '1fab6.png', alt: '羽毛' },
  lamp: { file: '1fa94.png', alt: '排灯' },
  coin: { file: '1fa99.png', alt: '硬币' },
  gourd: { file: '1f3fa.png', alt: '双耳陶瓶' },
  ring: { file: '1f48d.png', alt: '戒指' },
  seal: { file: '1f4dc.png', alt: '卷轴' },
  book: { file: '1f4d6.png', alt: '打开的书' },
  gate: { file: '26e9.png', alt: '鸟居' },
  camp: { file: '1f3d5.png', alt: '露营地' },
  diamond: { file: '1f48e.png', alt: '宝石' },
  skull: { file: '1f480.png', alt: '骷髅' },
  gear: { file: '2699.png', alt: '齿轮' },
  sound: { file: '1f50a.png', alt: '扬声器' },
  help: { file: '2754.png', alt: '白色问号' },
  arrow: { file: '27a1.png', alt: '向右箭头' },
  check: { file: '2714.png', alt: '勾号' },
  close: { file: '274c.png', alt: '叉号' },
  heart: { file: '2764.png', alt: '爱心' },
  star: { file: '2b50.png', alt: '星星' },
};

const portraitArt: Record<string, ArtAsset> = {
  swordsman: { file: '1f472.png', alt: '戴中国帽的人' },
  hermit: { file: '1f474.png', alt: '老年男性' },
  guardian: { file: '1f9d8.png', alt: '冥想中的人' },
  nezha: { file: '1f466.png', alt: '男孩' },
  sorcerer: { file: '1f9d9.png', alt: '法师' },
  fox: { file: '1f98a.png', alt: '狐狸' },
  demon: { file: '1f479.png', alt: '妖怪面具' },
  peacock: { file: '1f99a.png', alt: '孔雀' },
  golem: { file: '1faa8.png', alt: '岩石' },
  traveler: { file: '1f9d1.png', alt: '成人' },
};

const assetUrl = (file: string): string => `./assets/casual/${file}`;
const resolveIcon = (name: string): ArtAsset => iconArt[name] ?? iconArt.star;

export function icon(name: string, size = 28, cls = ''): string {
  const art = resolveIcon(name);
  const dimension = Number.isFinite(size) ? Math.max(1, Math.round(size)) : 28;
  return `<img class="icon ${esc(cls)}" width="${dimension}" height="${dimension}" src="${assetUrl(art.file)}" alt="${esc(art.alt)}" aria-hidden="true" data-icon="${esc(name)}" decoding="async" draggable="false">`;
}

export function sigil(name: string, tone = 'jade'): string {
  const art = resolveIcon(name);
  return `<img class="sigil" width="72" height="72" src="${assetUrl(art.file)}" alt="${esc(art.alt)}" aria-hidden="true" data-sigil="${esc(name)}" data-tone="${esc(tone)}" style="object-fit:contain" decoding="async" draggable="false">`;
}

export function portrait(kind: string, large = false): string {
  const art = portraitArt[kind] ?? portraitArt.traveler;
  return `<img class="portrait${large ? ' portrait-large' : ''}" width="240" height="280" src="${assetUrl(art.file)}" alt="${esc(art.alt)}" data-kind="${esc(kind)}" style="object-fit:contain" decoding="async" draggable="false">`;
}

export function landscape(): string {
  return `<img class="landscape" width="800" height="840" src="${assetUrl('landscape.png')}" alt="" style="object-fit:cover" decoding="async" draggable="false">`;
}
