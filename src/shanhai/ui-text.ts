const DEFAULT_KEYWORDS = [
  '气血上限',
  '暴击率',
  '护盾吸收',
  '持续伤害',
  '直接伤害',
  '最大气血',
  '伤害减免',
  '伤害提高',
  '护盾',
  '气血',
  '攻击',
  '防御',
  '速度',
  '暴击',
  '修为',
  '灵石',
  '怒气',
  '治疗',
  '中毒',
  '燃烧',
  '虚弱',
  '破甲',
  '剑意',
  '蓄势',
  '盾返',
  '减伤',
  '回怒',
  '怒技',
  '普攻',
  '天赋',
  '功法',
  '法宝',
  '叠层',
  '气血损失',
  '三选一',
];

const NUMBER_PATTERN = /^(?:[×x]\s*)?[+\-\u2212]?\d+(?:,\d{3})*(?:\.\d+)?(?:%|％|倍)?/;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] as string);
}

export function semanticTextMarkup(value: unknown, keywords: readonly string[] = DEFAULT_KEYWORDS): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const tokens = [...new Set(keywords.filter((keyword) => typeof keyword === 'string' && keyword.length > 0))]
    .sort((left, right) => right.length - left.length);
  let markup = '';

  for (let index = 0; index < text.length;) {
    const keyword = tokens.find((token) => text.startsWith(token, index));
    if (keyword) {
      markup += `<strong class="text-keyword">${escapeHtml(keyword)}</strong>`;
      index += keyword.length;
      continue;
    }

    const number = text.slice(index).match(NUMBER_PATTERN)?.[0];
    if (number) {
      markup += `<strong class="text-number">${escapeHtml(number)}</strong>`;
      index += number.length;
      continue;
    }

    markup += escapeHtml(text[index] || '');
    index += 1;
  }

  return markup;
}
