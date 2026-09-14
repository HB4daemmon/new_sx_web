"""Real HTTP/standalone UI validation, with explicit progression fixtures."""
from pathlib import Path
import argparse,json,os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--url');ap.add_argument('--output',default='verification/ancestry-ui');args=ap.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
report={'checks':[],'errors':[],'overflow':[],'mode':'http' if args.url else 'standalone'}
def check(name,ok):
 report['checks'].append({'name':name,'passed':bool(ok)})
 assert ok,name
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:report['errors'].append(str(e)));page.set_default_timeout(10000)
 def ev(code):return page.evaluate("()=>{const a=document.querySelector('fengshen-game');"+code+'}')
 def fit(name):
  x=page.evaluate('({w:innerWidth,d:document.documentElement.scrollWidth})');check(name,x['d']<=x['w']+1)
 def fixture(race='human',origin='wanderer',xp=75):
  page.evaluate('''([race,origin,xp])=>{const a=document.querySelector('fengshen-game');a.game=a.game.constructor.create(a.content,a.game.s.seed,origin,a.game.s.fate,'Review','',race);a.home=false;a.modal='';a.view='journey';a.paused=true;a.selectedTalent='';a.game.gainXP(xp);a.save();a.render();}''',[race,origin,xp])
 try:
  if args.url:page.goto(args.url,wait_until='networkidle')
  else:
   page.evaluate("Object.defineProperty(window,'localStorage',{configurable:true,value:{data:{},getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=String(v)},removeItem(k){delete this.data[k]}}})")
   page.set_content((root/'PLAY.html').read_text(),wait_until='load')
  page.wait_for_selector('[data-action=race]');check('four ancestries',page.locator('[data-action=race]').count()==4);check('five vocations',page.locator('[data-action=origin]').count()==5)
  page.locator('[data-action=race][data-id=dragon]').click();page.locator('[data-action=origin]').last.click();page.locator('[data-action=fates]').click();page.locator('[data-action=fate]').first.click();page.locator('[data-action=start]').click()
  check('identity preserved',ev("return a.game.s.race==='dragon'&&a.game.s.origin===a.content.origins.at(-1).id"))
  for w,h in [(375,667),(390,844),(750,1334),(1440,1000)]:
   page.set_viewport_size({'width':w,'height':h});fixture();fit(f'{w} talent fits')
   check(f'{w} three choices',page.locator('[data-action=selectTalent]').count()==3)
   check(f'{w} confirm initially disabled',page.locator('[data-action=chooseTalent]').is_disabled())
   old=ev('return JSON.stringify(a.game.s.rng)');page.locator('[data-action=selectTalent]').first.click();check(f'{w} selection is non-random',ev('return JSON.stringify(a.game.s.rng)')==old)
   check(f'{w} confirm enabled',page.locator('[data-action=chooseTalent]').is_enabled());page.screenshot(path=str(out/f'talent-{w}.png'),full_page=True)
   page.locator('.talent-modal [data-action=settings]').click();check(f'{w} settings is only dialog',page.locator('[role=dialog]').count()==1);page.locator('[data-action=close]').click();check(f'{w} return to talent',page.locator('.talent-modal').count()==1)
   page.locator('[data-action=chooseTalent]').click();check(f'{w} exactly one acquired',ev('return a.game.s.talents.length')==1)
  for race in ['human','spirit','dragon','ling']:
   fixture(race,xp=1000)
   for i in range(4):
    page.locator('[data-action=selectTalent]').first.click();page.locator('[data-action=chooseTalent]').click()
   check(race+' queued choices complete',ev('return a.game.s.talents.length===4&&!a.game.s.talentDraft'))
   ev("a.view='build';a.render();");check(race+' talent ledger exists',page.locator('details[data-panel=talents]').count()==1)
   page.locator('details[data-panel=talents]>summary').click();fit(race+' ledger fits')
  fixture('spirit',xp=0);ev("a.game.s.phase='event';a.game.s.eventId='race.spirit.0';a.game.s.eventPhase='trail';a.game.s.eventStep=0;a.render();");fit('race event fits');check('public event odds visible',page.locator('.check-badge').count()>=2);check('locked racial talent choice hidden',page.locator('[data-action=event][data-id=foxfire]').count()==0);ev("a.game.s.talents=['talent.spirit.fox'];a.render();");check('racial talent reveals story solution',page.locator('[data-action=event][data-id=foxfire]').count()==1);page.screenshot(path=str(out/'race-event-spirit.png'),full_page=True)
  fixture('human',xp=75);page.locator('[data-action=selectTalent]').first.click();before=ev('return JSON.stringify(a.game.s.talentDraft)');ev('a.save()')
  if args.url:
   page.reload(wait_until='networkidle');page.locator('[data-action=resume]').click();check('reload preserves offer',ev('return JSON.stringify(a.game.s.talentDraft)')==before)
  check('no JS errors',not report['errors']);report['passed']=True
 finally:
  (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));browser.close()
print(json.dumps({'passed':report.get('passed',False),'checks':len(report['checks']),'mode':report['mode']}))
