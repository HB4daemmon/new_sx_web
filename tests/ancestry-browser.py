"""Real HTTP/standalone UI validation, with explicit progression fixtures.

The harness resolves the generated HTML and output directory from this
checkout by default. ``PLAY_HTML_PATH``/``PLAY_HTML``, ``BROWSER_OUTPUT_DIR``
and ``CHROMIUM_PATH`` may override those defaults.
"""

import argparse
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def configured_path(value, fallback):
    path = Path(value).expanduser() if value else fallback
    if not path.is_absolute():
        path = ROOT / path
    return path.resolve()


def configured_env(*names):
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def chromium_executable(value=None):
    if value:
        path = configured_path(value, ROOT / "chromium")
        if not path.is_file():
            raise FileNotFoundError(f"Chromium executable not found: {path}")
        return str(path)
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        executable = shutil.which(name)
        if executable:
            return executable
    return None


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", help="HTTP URL to validate instead of standalone PLAY.html")
parser.add_argument(
    "--html",
    "--play-html",
    dest="html",
    default=configured_env("PLAY_HTML_PATH", "PLAY_HTML"),
    help="standalone PLAY.html path (default: checkout/PLAY.html)",
)
parser.add_argument(
    "--output",
    default=configured_env("BROWSER_OUTPUT_DIR") or str(ROOT / "verification" / "ancestry-ui"),
    help="directory for screenshots and the JSON report",
)
parser.add_argument(
    "--chromium",
    dest="chromium",
    default=os.environ.get("CHROMIUM_PATH"),
    help="Chromium executable path (default: CHROMIUM_PATH or PATH lookup)",
)
args = parser.parse_args()

html_path = configured_path(args.html, ROOT / "PLAY.html")
out = configured_path(args.output, ROOT / "verification" / "ancestry-ui")
out.mkdir(parents=True, exist_ok=True)
chromium_path = chromium_executable(args.chromium)
report = {
    "checks": [],
    "errors": [],
    "overflow": [],
    "mode": "http" if args.url else "standalone",
    "config": {
        "html": str(html_path),
        "output": str(out),
        "chromium": chromium_path or "Playwright-managed Chromium",
    },
}


def check(name, ok):
    report["checks"].append({"name": name, "passed": bool(ok)})
    assert ok, name


def assert_creation_copy(page, kind, selector):
    option_count = page.locator(selector).count()
    check(f"{kind} choices have visible explanations", option_count > 0)
    for index in range(option_count):
        option = page.locator(selector).nth(index)
        name = option.locator("strong").inner_text().strip()
        option.click()
        insight = page.locator(f".creation-{kind}")
        check(f"{kind} choice {index + 1} explanation exists", insight.count() == 1)
        check(
            f"{kind} choice {index + 1} explanation is non-empty",
            bool(insight.inner_text().strip()),
        )
        check(
            f"{kind} choice {index + 1} explanation matches selection",
            insight.locator("h3").inner_text().strip() == name,
        )


if not args.url and not html_path.is_file():
    raise FileNotFoundError(f"PLAY.html not found: {html_path}")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=chromium_path,
        args=["--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.on("pageerror", lambda error: report["errors"].append(str(error)))
    page.set_default_timeout(10000)

    def ev(code):
        return page.evaluate(
            "()=>{const a=document.querySelector('fengshen-game');" + code + "}"
        )

    def fit(name):
        sizes = page.evaluate("({w:innerWidth,d:document.documentElement.scrollWidth})")
        check(name, sizes["d"] <= sizes["w"] + 1)

    def fixture(race="human", origin="wanderer", xp=75):
        page.evaluate(
            """([race,origin,xp])=>{
                const a=document.querySelector('fengshen-game');
                a.game=a.game.constructor.create(a.content,a.game.s.seed,origin,a.game.s.fate,'Review','',race);
                a.home=false;a.modal='';a.view='journey';a.paused=true;a.selectedTalent='';
                a.game.gainXP(xp);a.save();a.render();
            }""",
            [race, origin, xp],
        )

    try:
        if args.url:
            page.goto(args.url, wait_until="networkidle")
        else:
            page.evaluate(
                """Object.defineProperty(window,'localStorage',{
                    configurable:true,
                    value:{
                        data:{},
                        getItem(k){return this.data[k]??null},
                        setItem(k,v){this.data[k]=String(v)},
                        removeItem(k){delete this.data[k]}
                    }
                })"""
            )
            page.set_content(html_path.read_text(encoding="utf-8"), wait_until="load")
        page.wait_for_selector("[data-action=race]")
        check("four ancestries", page.locator("[data-action=race]").count() == 4)
        check("five vocations", page.locator("[data-action=origin]").count() == 5)
        assert_creation_copy(page, "race", "[data-action=race]")
        assert_creation_copy(page, "origin", "[data-action=origin]")

        page.locator("[data-action=race][data-id=dragon]").click()
        page.locator("[data-action=origin]").last.click()
        page.locator("[data-action=fates]").click()
        assert_creation_copy(page, "fate", "[data-action=fate]")
        page.locator("[data-action=fate]").first.click()
        page.locator("[data-action=start]").click()
        check(
            "identity preserved",
            ev("return a.game.s.race==='dragon'&&a.game.s.origin===a.content.origins.at(-1).id"),
        )

        for width, height in [(375, 667), (390, 844), (750, 1334), (1440, 1000)]:
            page.set_viewport_size({"width": width, "height": height})
            fixture()
            fit(f"{width} talent fits")
            check(f"{width} three choices", page.locator("[data-action=selectTalent]").count() == 3)
            check(
                f"{width} confirm initially disabled",
                page.locator("[data-action=chooseTalent]").is_disabled(),
            )
            old = ev("return JSON.stringify(a.game.s.rng)")
            page.locator("[data-action=selectTalent]").first.click()
            check(
                f"{width} selection is non-random",
                ev("return JSON.stringify(a.game.s.rng)") == old,
            )
            check(
                f"{width} confirm enabled",
                page.locator("[data-action=chooseTalent]").is_enabled(),
            )
            page.screenshot(path=str(out / f"talent-{width}.png"), full_page=True)
            page.locator(".talent-modal [data-action=settings]").click()
            check(
                f"{width} settings is only dialog",
                page.locator("[role=dialog]").count() == 1,
            )
            page.locator("[data-action=close]").click()
            check(f"{width} return to talent", page.locator(".talent-modal").count() == 1)
            page.locator("[data-action=chooseTalent]").click()
            check(
                f"{width} exactly one acquired",
                ev("return a.game.s.talents.length") == 1,
            )

        for race in ["human", "spirit", "dragon", "ling"]:
            fixture(race, xp=1000)
            for _ in range(4):
                page.locator("[data-action=selectTalent]").first.click()
                page.locator("[data-action=chooseTalent]").click()
            check(
                race + " queued choices complete",
                ev("return a.game.s.talents.length===4&&!a.game.s.talentDraft"),
            )
            ev("a.view='build';a.render();")
            check(
                race + " talent ledger exists",
                page.locator("details[data-panel=talents]").count() == 1,
            )
            page.locator("details[data-panel=talents]>summary").click()
            fit(race + " ledger fits")

        fixture("spirit", xp=0)
        ev(
            "a.game.s.phase='event';a.game.s.eventId='race.spirit.0';"
            "a.game.s.eventPhase='trail';a.game.s.eventStep=0;a.render();"
        )
        fit("race event fits")
        check("public event odds visible", page.locator(".check-badge").count() >= 2)
        check(
            "locked racial talent choice hidden",
            page.locator("[data-action=event][data-id=foxfire]").count() == 0,
        )
        ev("a.game.s.talents=['talent.spirit.fox'];a.render();")
        check(
            "racial talent reveals story solution",
            page.locator("[data-action=event][data-id=foxfire]").count() == 1,
        )
        page.screenshot(path=str(out / "race-event-spirit.png"), full_page=True)

        fixture("human", xp=75)
        page.locator("[data-action=selectTalent]").first.click()
        before = ev("return JSON.stringify(a.game.s.talentDraft)")
        ev("a.save()")
        if args.url:
            page.reload(wait_until="networkidle")
            page.locator("[data-action=resume]").click()
            check(
                "reload preserves offer",
                ev("return JSON.stringify(a.game.s.talentDraft)") == before,
            )
        check("no JS errors", not report["errors"])
        report["passed"] = True
    finally:
        report_path = out / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()

print(
    json.dumps(
        {
            "passed": report.get("passed", False),
            "checks": len(report["checks"]),
            "mode": report["mode"],
        }
    )
)
