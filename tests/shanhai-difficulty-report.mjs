const ACTS = Object.freeze([1, 2, 3, 4]);
const OUTCOMES = Object.freeze([
  ['won', '通关'],
  ['lost', '失败'],
  ['undecided', '未决'],
  ['error', '错误'],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeCell(value) {
  return String(value)
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未提供';
  return `${(value * 100).toFixed(1)}%`;
}

function count(value) {
  return Number.isFinite(value) ? String(value) : '未提供';
}

function rateValue(summary) {
  if (!isRecord(summary)) return '未提供';
  const successes = count(summary.successes);
  const total = count(summary.total);
  if (summary.total === 0) return `${successes}/${total}（无样本）`;
  if (Number.isFinite(summary.rate)) {
    return `${successes}/${total}（${percent(summary.rate)}）`;
  }
  return `${successes}/${total}（比例未提供）`;
}

function wilsonValue(summary) {
  if (!isRecord(summary)) return '未提供';
  if (summary.total === 0) return '无样本';
  if (!isRecord(summary.wilson95) ||
    !Number.isFinite(summary.wilson95.lower) ||
    !Number.isFinite(summary.wilson95.upper)) {
    return '未提供';
  }
  return `[${percent(summary.wilson95.lower)}, ${percent(summary.wilson95.upper)}]`;
}

function targetValue(targets, act) {
  const value = targets?.cumulativeActPassRates?.[`act${act}`];
  return Number.isFinite(value) ? percent(value) : '未提供';
}

function tableRow(values) {
  return `| ${values.map(escapeCell).join(' | ')} |`;
}

function sortedEntries(value) {
  if (!isRecord(value)) return [];
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function renderActTable(metrics, targets) {
  const lines = [
    tableRow([
      '幕',
      '累计通关率（成功/固定总样本）',
      '目标',
      '累计样本数',
      'Wilson 95% CI',
      '条件幕胜率（成功/入幕样本）',
      '入幕样本数',
      '条件 Wilson 95% CI',
    ]),
    tableRow(['---', '---', '---:', '---:', '---', '---', '---:', '---']),
  ];

  for (const act of ACTS) {
    const pass = metrics?.acts?.[String(act)];
    const cumulative = pass?.cumulative;
    const conditional = pass?.conditional;
    lines.push(tableRow([
      `第 ${act} 幕`,
      rateValue(cumulative),
      targetValue(targets, act),
      count(cumulative?.total),
      wilsonValue(cumulative),
      rateValue(conditional),
      count(conditional?.total),
      wilsonValue(conditional),
    ]));
  }
  return lines;
}

function renderMethodTables(metrics, targets, configuredMethods = []) {
  const byMethod = metrics?.byMethod;
  if (!isRecord(byMethod)) return ['未提供起始功法分组指标。'];

  const methodIds = [...new Set([
    ...(Array.isArray(configuredMethods)
      ? configuredMethods.filter(method => typeof method === 'string')
      : []),
    ...Object.keys(byMethod),
  ])];
  if (methodIds.length === 0) return ['未提供起始功法分组指标。'];

  const lines = [];
  for (const method of methodIds) {
    const methodMetrics = byMethod[method];
    lines.push(`### ${escapeCell(method)}`);
    if (!isRecord(methodMetrics)) {
      lines.push('', '未提供该功法的指标。');
      continue;
    }
    lines.push('', `样本数：${count(methodMetrics.runs)}`, '');
    lines.push(...renderActTable(methodMetrics, targets), '');
  }
  return lines.slice(0, -1);
}

function renderOutcomes(outcomes) {
  if (!isRecord(outcomes)) return '未提供';
  return OUTCOMES
    .map(([key, label]) => `${label} ${count(outcomes[key])}`)
    .join(' / ');
}

function renderSeeds(configuration) {
  const seeds = configuration?.seeds;
  if (!Array.isArray(seeds)) return ['种子标签：未提供'];
  return [
    `种子标签数：${seeds.length}`,
    '种子标签：',
    ...(seeds.length ? seeds.map(seed => `  - \`${escapeCell(seed)}\``) : ['  - 无']),
  ];
}

function renderMultipliers(adjustment) {
  const multipliers = adjustment?.multipliers;
  if (!isRecord(multipliers)) return ['未提供离线倍率。'];
  const rows = [
    tableRow(['幕', '攻击', '防御', '最大气血']),
    tableRow(['---', '---:', '---:', '---:']),
  ];
  for (const [act, values] of sortedEntries(multipliers)) {
    if (!isRecord(values)) {
      rows.push(tableRow([act, '未提供', '未提供', '未提供']));
      continue;
    }
    rows.push(tableRow([
      act,
      count(values.attack),
      count(values.defense),
      count(values.max_hp),
    ]));
  }
  return rows;
}

function renderFinalBattle(finalBattle, targetDescription) {
  if (!isRecord(finalBattle)) return ['未提供终战独立统计。'];
  const winRate = finalBattle.winRate;
  return [
    `- 统计口径：${escapeCell(targetDescription ?? '仅在进入第五幕的运行中单独统计；未提供进一步说明。')}`,
    `- 进入第五幕样本：${count(finalBattle.eligibleRuns)}`,
    `- 终战胜场：${count(finalBattle.wins)}`,
    `- 终战胜率：${rateValue(winRate)}；Wilson 95% CI ${wilsonValue(winRate)}`,
    `- 终战结果：${renderOutcomes(finalBattle.outcomes)}`,
    '- 此统计独立于第一至第四幕累计通关率。',
  ];
}

export function renderDifficultyReport(report) {
  if (!isRecord(report) || !isRecord(report.metrics)) {
    throw new TypeError('difficulty report must contain a metrics object');
  }

  const configuration = isRecord(report.configuration) ? report.configuration : {};
  const targets = isRecord(report.targets) ? report.targets : {};
  const metrics = report.metrics;
  const adjustment = configuration.enemyStatAdjustment;
  const seeds = renderSeeds(configuration);
  const lines = [
    '# 山海难度校准报告',
    '',
    '> 本报告是自动策略条件下的游戏模拟，不是人类玩家胜率或体验结论。',
    '',
    '## 运行配置',
    '',
    `- 报告结构版本：${count(report.schemaVersion)}`,
    `- 输入配置哈希：${escapeCell(report.inputHash ?? '未提供')}`,
    `- 内容版本：${escapeCell(configuration.contentVersion ?? '未提供')}`,
    `- 源内容 SHA-256：${escapeCell(configuration.sourceContentHash ?? '未提供')}`,
    `- 运行时与策略 SHA-256：${escapeCell(configuration.runtimeAndPolicyHash ?? '未提供')}`,
    `- 种子前缀：${escapeCell(configuration.seedPrefix ?? '未提供')}`,
    `- 种子拆分：${escapeCell(configuration.split ?? '未提供')}`,
    `- 每种起始功法种子数：${count(configuration.seedsPerMethod)}`,
    `- 起始功法：${Array.isArray(configuration.methods) ? configuration.methods.map(escapeCell).join('、') : '未提供'}`,
    ...seeds,
    `- 策略：${escapeCell(configuration.policy ?? '未提供')}`,
    `- 策略实现：${escapeCell(configuration.policySource ?? '未提供')}`,
    '',
    '## 四幕通关表现',
    '',
    '累计通关分母固定为该组全部运行数；条件幕胜率只以进入该幕的运行数为分母。',
    '',
    ...renderActTable(metrics, targets),
    '',
    '## 各起始功法四幕率',
    '',
    '每种功法分别以自己的运行样本作为固定累计分母；条件幕胜率仍以该功法中进入该幕的运行数为分母。',
    '',
    ...renderMethodTables(metrics, targets, configuration.methods),
    '',
    '## 第五幕终战',
    '',
    ...renderFinalBattle(metrics.finalBattle, targets.finalAct),
    '',
    '## 运行结局',
    '',
    `- 全部运行：通关 ${count(metrics.outcomes?.won)} / 失败 ${count(metrics.outcomes?.lost)} / 未决 ${count(metrics.outcomes?.undecided)} / 错误 ${count(metrics.outcomes?.error)}`,
    `- 未决运行数：${count(metrics.outcomes?.undecided)}`,
    `- 错误运行数：${count(metrics.errors?.total)}`,
    `- 结局分布：${renderOutcomes(metrics.outcomes)}`,
    '',
    '## 离线敌方倍率',
    '',
    `- 调整模式：${escapeCell(adjustment?.mode ?? '未提供')}`,
    `- 调整字段：${Array.isArray(adjustment?.fields) ? adjustment.fields.map(escapeCell).join('、') : '未提供'}`,
    '',
    ...renderMultipliers(adjustment),
    '',
    `- 说明：${escapeCell(adjustment?.note ?? '未提供倍率应用范围说明。')}`,
    '',
    '## 策略边界与实测状态',
    '',
    `- 策略限制：${escapeCell(configuration.policyContract ?? '未提供策略合同。')}`,
    `- 策略说明：${escapeCell(configuration.policyNotes ?? '未提供策略说明。')}`,
    `- 运行步数上限：${count(configuration.runStepGuard)}`,
    `- 单场战斗回合上限：${count(configuration.battleRoundLimit)}`,
    `- 目标胜率：${escapeCell(targets.interpretation ?? '未提供目标解释。')}`,
    `- 内容实测字段：${targets.measuredContentFieldsRemainNull === true ? '`measured: null`（按报告元数据标记）' : targets.measuredContentFieldsRemainNull === false ? '报告未标记为 null，请核对实测字段状态。' : '未提供字段状态，不能据此推断实测结果。'}`,
    '- 模拟结果仅用于所选策略下的校准参考，不得写入内容的实测字段或表述为人类胜率。',
    '',
  ];

  return lines.join('\n');
}
