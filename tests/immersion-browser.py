
"""Player-facing UI checks. Use --url for HTTP deployment-like verification.
Without --url use the exact standalone HTML via set_content (file URLs may be blocked).
Fixtures are explicit test scenarios, not claimed to be completed human playthroughs.
Requires playwright==1.57.0 and Chromium.
"""
from pathlib import Path
import argparse,json,os,subprocess
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument("--url")
parser.add_argument("--output",default=str(root/"verification"/"ui"))
args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
fixtures=json.loads(subprocess.check_output(["node","tests/immersion-fixtures.mjs"],cwd=root,text=True))
report={"mode":"http" if args.url else "standalone-set_content","checks":[],"screens":[],"errors":[],"overflow":[]}
def check(name,condition):
    report["checks"].append({"name":name,"passed":bool(condition)})
    if not condition:raise AssertionError(name)
with sync_playwright() as p:
    executable=os.environ.get("CHROMIUM_PATH") or ("/usr/bin/chromium" if Path("/usr/bin/chromium").exists() else None)
    browser=p.chromium.launch(headless=True,executable_path=executable,args=["--no-sandbox"])
    page=browser.new_page(viewport={"width":1440,"height":1000},device_scale_factor=1)
    page.on("pageerror",lambda e:report["errors"].append(str(e)))
    page.set_default_timeout(10000)
    def load():
        if args.url:
            page.goto(args.url,wait_until="networkidle")
        else:
            page.evaluate("Object.defineProperty(window,'localStorage',{configurable:true,value:{data:{},getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=String(v)},removeItem(k){delete this.data[k]}}})")
            page.set_content((root/"PLAY.html").read_text(),wait_until="load")
        page.wait_for_selector("[data-action=fates]")
    def shot(name):
        page.screenshot(path=str(out/(name+".png")),full_page=True)
        report["screens"].append(name)
    def state(name,view="journey"):
        page.evaluate("""([s,view])=>{const a=document.querySelector('fengshen-game');a.game=a.game.constructor.load(a.content,JSON.stringify(s));a.home=false;a.view=view;a.modal='';a.paused=true;a.codexFilter='equipped';a.render();}""",[fixtures[name],view])
    def no_overflow(name):
        sizes=page.evaluate("({w:innerWidth,doc:document.documentElement.scrollWidth})")
        if sizes["doc"]>sizes["w"]+1:report["overflow"].append({"scene":name,**sizes})
        check(name+" no horizontal document overflow",sizes["doc"]<=sizes["w"]+1)
    try:
        load();shot("home-desktop")
        text=page.locator("body").inner_text()
        check("landing has no developer feature billboard",not any(x in text for x in ["MVP","离线可玩","单人","CHARACTER ENCOUNTER"]))
        page.locator("[data-action=fates]").click()
        page.locator("[data-action=fate]").first.click()
        page.locator("[data-action=start]").click()
        page.evaluate("document.querySelector('fengshen-game').paused=true")
        state("map");shot("map-desktop")
        check("map is not a build dashboard",page.locator(".main-stage .resonance-panel,.main-stage .build-stage-path,.main-stage .build-advice").count()==0)
        check("empty journal does not reveal future characters",page.evaluate("document.querySelector('fengshen-game').karma().includes('character-relation')") is False)
        # Actual delegated clicks, no fixture mutation for this short route.
        page.locator(".map-node.available").first.click()
        page.locator("[data-action=skip]").click()
        page.locator("[data-action=finishBattle]").click()
        check("normal first fight reaches reward or death",page.evaluate("['reward','dead'].includes(document.querySelector('fengshen-game').game.s.phase)"))
        state("map","build")
        page.locator("details[data-panel=resonances]>summary").click()
        before=page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s)")
        page.locator("[data-action=inspect]").first.click()
        page.locator("details[data-panel=rank-effects]>summary").click()
        check("rank details are available",page.locator(".rank-effects section").count()==4)
        page.keyboard.press("Escape")
        check("disclosure remains open after closing details",page.locator("details[data-panel=resonances]").evaluate("(d)=>d.open"))
        check("reading cards does not alter run",before==page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s)"))
        state("battle")
        check("battle has a single player health surface",page.locator(".mobile-hud,.player-rail").count()==0)
        check("simple log is default",not page.evaluate("document.querySelector('fengshen-game').detailedLog"))
        log=page.locator(".battle-log")
        check("long battle is scrollable",log.evaluate("(d)=>d.scrollHeight>d.clientHeight"))
        log.evaluate("(d)=>{d.scrollTop=10;d.dispatchEvent(new Event('scroll'));}")
        page.evaluate("const a=document.querySelector('fengshen-game');a.game.s.battle.cursor+=4;a.render()")
        check("reading old battle rows survives the next frame",abs(log.evaluate("(d)=>d.scrollTop")-10)<2)
        check("follow latest control appears when reading history",page.locator("[data-action=followLog]").is_visible())
        page.locator("[data-action=followLog]").click()
        page.evaluate("const a=document.querySelector('fengshen-game');a.game.s.battle.cursor+=3;a.render()")
        check("following latest survives the next frame",log.evaluate("(d)=>d.scrollHeight-d.clientHeight-d.scrollTop<2"))
        check("both sides have independent log identity",page.locator(".battle-log .actor-player").count()>0 and page.locator(".battle-log .actor-enemy").count()>0)
        shot("battle-desktop")
        state_before=page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s)")
        page.locator("[data-action=settings]").first.click()
        page.locator("[data-action=detailedLog]").click()
        check("detailed mode persisted",page.evaluate("localStorage.getItem('fengshen-detailed-log')")== "true")
        page.keyboard.press("Escape")
        check("detailed mode exposes formula",page.locator(".combat-formula").count()>0)
        check("log mode changes no game state",state_before==page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s)"))
        page.locator("[data-action=settings]").first.click()
        page.locator("[data-action=detailedLog]").click()
        # Keyboard trapping and dismissal.
        page.locator(".modal button").last.focus();page.keyboard.press("Tab")
        check("tab focus remains in dialog",page.evaluate("!!document.activeElement.closest('.modal')"))
        page.keyboard.press("Escape")
        check("dialog dismissal restores focus",page.evaluate("document.activeElement.dataset.action")=="settings")
        state("map");page.locator("[data-action=character]:visible").first.click()
        page.locator("details[data-panel=stat-sources]>summary").click()
        check("full stat dimensions and sources remain available",page.locator(".character-stats>div").count()==7 and page.locator(".stat-source-list>div").count()==7)
        shot("attributes-desktop");page.keyboard.press("Escape")
        state("cost")
        check("unaffordable action is visible and disabled",page.locator("[data-action=event][data-id=pay]").is_disabled())
        check("unaffordable action states requirement",page.locator("[data-action=event][data-id=pay] .lock-reason").count()==1)
        state("event.1.hermit")
        check("first encounter does not pretend familiarity","认出" not in page.locator(".story-text").inner_text())
        check("unearned narrative branch is absent",page.locator("[data-action=event][data-id=back]").count()==0)
        state("returning")
        check("earned relationship unlocks visible branch",page.locator("[data-action=event][data-id=back]").is_enabled())
        check("known character receives returning prose","认出" in page.locator(".story-text").inner_text())
        shot("event-desktop")
        page.locator("[data-action=event][data-id=back]").click()
        check("event outcome is narrative rather than repeated preview","背后这一程" in page.locator(".event-result").inner_text())
        page.locator("[data-action=leaveEvent]").click()
        state("check")
        check("both check stakes visible",page.locator(".check-stakes").inner_text().find("生命 -8")>=0)
        state("replacement")
        inv=page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s.slots)")
        check("replacement warning and actions present",page.locator(".replacement-candidates [data-action=replace]").count()==3)
        page.locator("[data-action=cancelReplacement]").click()
        check("cancelling replacement keeps every equipped slot",inv==page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s.slots)"))
        # Every event page, including scenarios with locked numeric choices.
        for event in [k for k in fixtures if k.startswith("event.") or k.startswith("major.")]:
            state(event);no_overflow(event)
        # Representative responsive pages; all screens remain functional, not mockups.
        for w,h in [(375,667),(390,844),(414,896),(750,1334),(1024,768),(1440,1000)]:
            page.set_viewport_size({"width":w,"height":h})
            for name,view in [("map","journey"),("battle","journey"),("map","build"),("returning","journey"),("shop","journey"),("rest","journey"),("reward","journey"),("returning","karma"),("final","journey")]:
                state(name,view);no_overflow(f"{w}:{name}:{view}")
                if w in [390,750] and (name in ["battle","returning","reward"] or view=="build"):
                    shot(f"{name}-{view}-{w}")
            state("map")
            check(f"{w}: settings has one visible entry",page.locator("[data-action=settings]:visible").count()==1)
            page.locator("[data-action=settings]").first.click();no_overflow(f"{w}:settings")
            check(f"{w}: dialog within viewport",page.locator(".modal").evaluate("(d)=>d.getBoundingClientRect().left>=0 && d.getBoundingClientRect().right<=innerWidth+1"))
            if w==390:shot("settings-390")
        # Existing rules-version save still resumes in the revised UI.
        state("returning")
        old=page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s)")
        page.evaluate("(s)=>localStorage.setItem('fengshen-run-v1',s)",old)
        page.evaluate("document.querySelector('fengshen-game').remove();document.body.appendChild(document.createElement('fengshen-game'))")
        page.wait_for_selector("[data-action=resume]")
        page.locator("[data-action=resume]").click()
        check("2.9.0 save resumes with identical run",old==page.evaluate("JSON.stringify(document.querySelector('fengshen-game').game.s)"))
        check("no JavaScript errors",not report["errors"])
        report["passed"]=True
    except Exception as exc:
        report["passed"]=False;report["failure"]=str(exc)
        page.screenshot(path=str(out/"failure.png"),full_page=True)
        raise
    finally:
        (out/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
        browser.close()
print(json.dumps({"passed":report["passed"],"checks":len(report["checks"]),"screenshots":len(report["screens"]),"mode":report["mode"]}))
