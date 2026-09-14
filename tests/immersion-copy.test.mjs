import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const presentation=readFileSync(new URL('../src/presentation.ts',import.meta.url),'utf8');

test('UI16.1 removes meta guidance from primary play surfaces',()=>{
 for(const phrase of [
  '择一，伴此生',
  '入劫将替换当前命途。',
  '此举的牵连',
  '择一整备',
  '本局不产出',
  '开始新命途时，现有进度将被替换。',
  '选择一项属性淬炼',
  '每幕十站，进入下一幕时生命回满',
  '属性来源 ${icon'
 ])assert(!app.includes(phrase),phrase);
 assert(app.includes('旧途将断。'));
 assert(app.includes('命盘无隙。'));
 assert(app.includes('气血 +30%'));
 assert.match(presentation,/UI_REVISION='16\.1'/);
});

test('decision-critical mechanics remain visible',()=>{
 assert(app.includes('abilityLines(this.content,a'));
 assert(app.includes('check-stakes'));
 assert(app.includes('详细战报'));
 assert(app.includes('根骨明细'));
 assert(app.includes('怒满则发。'));
});
