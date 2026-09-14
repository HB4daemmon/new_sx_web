import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
const presentation=readFileSync(new URL('../src/presentation.ts',import.meta.url),'utf8');

test('UI16.2 keeps primary play surfaces in-world and trims draft meta copy',()=>{
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
 for(const phrase of ['<span class="muted">择一</span>',"['精进','合流','新路']",'draft-lane-head','fighter-side-badge','THE FINAL CHOICE','>详细战报<','>导出<','>导入<'])assert(!app.includes(phrase),phrase);
 assert(app.includes("s.current?.type==='boss'?'劫首遗珍'"));
 assert(app.includes("s.current?.type==='elite'?'强敌遗珍'"));
 assert.match(presentation,/UI_REVISION='16\.2'/);
});

test('decision-critical mechanics remain visible',()=>{
 assert(app.includes('abilityLines(this.content,a'));
 assert(app.includes('check-stakes'));
 assert(app.includes('战痕详录'));
 assert(app.includes('根骨来处'));
 assert(app.includes('怒满则发。'));
});
