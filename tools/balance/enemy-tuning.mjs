// Applies the documented enemy stat retune to content/shanhai/enemies/**.
// Multipliers apply to the originally authored values at BASELINE_COMMIT, so
// re-running is idempotent. Validate with
// `SIM_SEEDS=24 node tests/shanhai-balance-audit.mjs`.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const BASELINE_COMMIT = 'f6c4098';

export const ENEMY_TUNING = {
  // Act 1: normals bled ~10% HP each, so players entered the boss on fumes.
  'EN-A1-C1': { attack: 0.85, why: '第一幕普通战消耗过高，首领前血量见底' },
  'EN-A1-C2': { attack: 0.85, why: '同上' },
  'EN-A1-C3': { attack: 0.85, why: '同上' },
  'EN-A1-C4': { attack: 0.85, why: '同上' },
  'EN-A1-L2': { attack: 0.9, why: '精英减益+削怒叠加压制过强' },
  // Act 2: normals cost ~0% HP — no tension; raise to a light toll.
  'EN-A2-C1': { attack: 1.12, why: '第二幕普通战几乎零损血；1.3 过调导致第二幕死亡翻倍，回调' },
  'EN-A2-C3': { attack: 1.12, why: '同上' },
  'EN-A2-C4': { attack: 1.0, why: '连雷爆发已足够，维持原值' },
  'EN-A2-B2': { attack: 0.72, why: '满血三回合内秒杀玩家，二轮复测失败率仍达23%' },
  // Act 3: bursty elite/boss killed from >50% HP in two rounds.
  'EN-A3-B1': { attack: 0.72, why: '两回合连雷爆发秒杀，二轮复测失败率22%' },
  'EN-A3-L1': { attack: 0.8, why: '镇心玉放大下两回合秒杀' },
  // Act 4: a "normal" glass cannon one-shot full-HP players 43% of the time.
  'EN-A4-C4': { attack: 0.8, max_hp: 0.75, why: '普通战满血两回合秒杀：镇心玉换为玄铁甲（去掉×1.6爆发）；气血过厚拖长普通战' },
  'EN-A4-L2': { attack: 0.88, why: '精英暴击火攻爆发过高' },
  'EN-A4-B1': { attack: 0.88, why: '首领三回合击杀高血量玩家' },
};

const round = value => Math.round(value * 10) / 10;

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = 'content/shanhai/enemies';
  const files = [];
  for (const act of await readdir(root)) {
    for (const name of await readdir(path.join(root, act))) {
      if (name.endsWith('.yaml')) files.push(path.join(root, act, name));
    }
  }
  for (const file of files) {
    let text = await readFile(file, 'utf8');
    const id = text.match(/^id: (\S+)$/m)?.[1];
    const tune = ENEMY_TUNING[id];
    if (!tune) continue;
    const original = execFileSync('git', ['show', `${BASELINE_COMMIT}:${file}`], { encoding: 'utf8' });
    for (const stat of ['attack', 'defense', 'max_hp']) {
      if (!tune[stat]) continue;
      const pattern = new RegExp(`^(  ${stat}: )([0-9.]+)$`, 'm');
      const match = original.match(pattern);
      if (!match || !pattern.test(text)) throw new Error(`${id}: ${stat} not found`);
      const next = round(Number(match[2]) * tune[stat]);
      text = text.replace(pattern, `$1${next}`);
      console.log(`${id} ${stat} ${match[2]} -> ${next}  (${tune.why})`);
    }
    await writeFile(file, text);
  }
}
