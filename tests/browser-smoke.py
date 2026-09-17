"""Short standalone browser smoke flow for the generated offline build.

The harness resolves files from this checkout by default. Override paths with
``PLAY_HTML_PATH``/``PLAY_HTML``, ``BROWSER_OUTPUT_DIR`` and ``CHROMIUM_PATH``
or use the corresponding command-line options.
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
parser.add_argument(
    "--html",
    "--play-html",
    dest="html",
    default=configured_env("PLAY_HTML_PATH", "PLAY_HTML"),
    help="standalone PLAY.html path (default: checkout/PLAY.html)",
)
parser.add_argument(
    "--output",
    default=configured_env("BROWSER_OUTPUT_DIR") or str(ROOT / "verification" / "browser-smoke"),
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
out = configured_path(args.output, ROOT / "verification" / "browser-smoke")
out.mkdir(parents=True, exist_ok=True)
chromium_path = chromium_executable(args.chromium)
errors = []
checks = []
before = None
after = None


def check(name, condition):
    checks.append({"name": name, "passed": bool(condition)})
    assert condition, name


def assert_creation_insight(page, kind, options):
    option_count = page.locator(options).count()
    check(f"{kind} choices are present", option_count > 0)
    for index in range(option_count):
        option = page.locator(options).nth(index)
        option.click()
        insight = page.locator(f".creation-{kind}")
        check(
            f"{kind} choice {index + 1} has an explanation",
            insight.count() == 1 and bool(insight.inner_text().strip()),
        )
        check(
            f"{kind} choice {index + 1} explanation matches selection",
            insight.locator("h3").inner_text() == option.locator("strong").inner_text(),
        )


if not html_path.is_file():
    raise FileNotFoundError(f"PLAY.html not found: {html_path}")

report = {
    "errors": errors,
    "checks": checks,
    "remountSaveExact": False,
    "renderer": "Chromium set_content (local URL navigation denied by browser policy); in-memory Storage adapter",
    "config": {
        "html": str(html_path),
        "output": str(out),
        "chromium": chromium_path or "Playwright-managed Chromium",
    },
}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=chromium_path,
        headless=True,
        args=["--no-sandbox"],
    )
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 1060}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_default_timeout(10000)
        page.evaluate(
            """Object.defineProperty(window, 'localStorage', {
                configurable: true,
                value: {
                    data: {},
                    getItem(key) { return this.data[key] ?? null; },
                    setItem(key, value) { this.data[key] = String(value); },
                    removeItem(key) { delete this.data[key]; }
                }
            })"""
        )
        page.set_content(html_path.read_text(encoding="utf-8"), wait_until="domcontentloaded")
        page.wait_for_selector('[data-action="fates"]')

        assert_creation_insight(page, "race", '[data-action="race"]')
        assert_creation_insight(page, "origin", '[data-action="origin"]')
        page.locator('[data-action="race"]').first.click()
        page.locator('[data-action="origin"]').first.click()
        page.locator('[data-action="fates"]').click()
        assert_creation_insight(page, "fate", '[data-action="fate"]')
        page.locator('[data-action="fate"]').first.click()
        page.screenshot(path=str(out / "desktop-cover.png"), full_page=True)

        page.locator('[data-action="start"]').click()
        page.screenshot(path=str(out / "desktop-map.png"), full_page=True)
        check("route exposes a reachable node", page.locator(".map-node.available").count() > 0)
        page.locator(".map-node.available").first.click()
        page.locator('[data-action="pause"]').click()
        page.screenshot(path=str(out / "desktop-battle.png"), full_page=True)
        page.locator('[data-action="skip"]').click()
        page.locator('[data-action="finishBattle"]').click()
        page.screenshot(path=str(out / "desktop-reward.png"), full_page=True)
        page.locator('[data-action="skipReward"]').click()
        page.locator(".map-node.available").first.click()
        page.screenshot(path=str(out / "desktop-event.png"), full_page=True)

        for width, height in [(375, 667), (390, 844), (414, 896), (430, 932), (750, 1334)]:
            page.set_viewport_size({"width": width, "height": height})
            overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth")
            check(f"{width}x{height} has no horizontal overflow", not overflow)
            if width == 390:
                page.screenshot(path=str(out / "mobile-event.png"), full_page=True)

        page.locator('[data-action="event"]').first.click()
        if page.locator('[data-action="cancelReplacement"]').count():
            page.locator('[data-action="cancelReplacement"]').click()
        page.locator('[data-action="leaveEvent"]').click()
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(out / "mobile-map.png"), full_page=True)

        before = page.evaluate("JSON.parse(localStorage.getItem('fengshen-run-v44'))")
        page.evaluate(
            """const root = document.querySelector('fengshen-game');
            root.remove();
            document.body.append(document.createElement('fengshen-game'));"""
        )
        page.locator('[data-action="resume"]').click()
        after = page.evaluate("JSON.parse(localStorage.getItem('fengshen-run-v44'))")
        check("v44 save remains exact after remount", before == after)
        report["remountSaveExact"] = before == after

        page.locator('[data-action="tab"][data-id="build"]').last.click()
        strategy = page.locator(".deck-grid .ability-card.slot-strategy").first
        check(
            "strategy card exposes a behavior summary",
            strategy.count() == 1
            and bool(strategy.locator(".ability-behavior").inner_text().strip())
            and (strategy.locator(".ability-sections").get_attribute("aria-label") or "").startswith("行为："),
        )
        page.screenshot(path=str(out / "mobile-build.png"), full_page=True)
        check("browser page has no JavaScript errors", not errors)
    finally:
        browser.close()

report["errors"] = errors
(out / "browser-smoke.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(json.dumps({"errors": errors, "checks": len(checks), "remountSaveExact": before == after}))
