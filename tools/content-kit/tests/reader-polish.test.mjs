import assert from 'node:assert/strict'
import test from 'node:test'

import { loadContent } from '../src/loader.mjs'
import { renderDocuments, DOCUMENT_PATHS } from '../src/renderer.mjs'
import { validateLoadedContent } from '../src/validator.mjs'

const report = validateLoadedContent(await loadContent())
assert.equal(
  report.ok,
  true,
  report.errors.map((error) => `${error.code}:${error.path}:${error.message}`).join('\n'),
)
const pages = renderDocuments(report)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('INDEX exposes every fixed reader page with readable names and counts', () => {
  const index = pages.get('INDEX.md')
  assert.equal(pages.size, 32)
  assert.deepEqual([...pages.keys()], DOCUMENT_PATHS)

  for (const relativePath of DOCUMENT_PATHS) {
    assert.match(index, new RegExp(`\\]\\(\\./${escapeRegExp(relativePath)}\\)`), relativePath)
  }

  assert.match(index, /10 门 \/ 120 天赋/)
  assert.match(index, /36 普通 \/ 16 核心/)
  assert.match(index, /6 条人物线 \+ 4 项独立核心/)
  assert.match(index, /32 套幕敌人 \+ 2 套终战/)
  assert.match(index, /金刚功（RKF01）/)
  assert.match(index, /普通法宝/)
  assert.match(index, /第4幕事件/)
  assert.match(index, /独立核心机缘（4项）/)
  assert.match(index, /终战敌人/)
})

test('reader pages use player-facing rewards, bases, categories, and method abilities', () => {
  const eventPage = pages.get('events/ACT1.md')
  assert.match(eventPage, /- 获得：气血 20%（当前幕参考气血）/)
  assert.match(eventPage, /- 成本：灵石 75%（普通法宝价格参照）/)
  assert.match(eventPage, /- 获得：修为 20%（当前境界下一次完整突破需求）/)
  assert.match(eventPage, /- 胜利获得：青锋石（`RC01`） ×2/)
  assert.doesNotMatch(eventPage, /- 胜利兑现：/)
  assert.doesNotMatch(eventPage, /H\*|C\*|X\*/)
  assert.doesNotMatch(eventPage, /- 事件目标：/)
  assert.match(eventPage, /事件效用目标（gross_U）：0\.4、1/)

  const methodPage = pages.get('methods/RKF01.md')
  assert.match(methodPage, /属性侧重：主属性=防御；次属性=攻击、最大气血/)
  assert.match(methodPage, /\| 强化 \|/)
  assert.match(methodPage, /\| 循环 \|/)
  assert.match(methodPage, /\| 转化 \|/)
  assert.doesNotMatch(methodPage, /类别：(?:enhance|cycle|convert)/)
  assert.match(methodPage, /## 固有被动/)
  assert.match(methodPage, /当前护盾实际吸收敌方主动直接攻击的正伤害时/)
  assert.match(methodPage, /## 行旅能力/)
  assert.match(methodPage, /完成休整后为下一场战斗准备相当于当前幕参考气血的12%的护盾/)
})
