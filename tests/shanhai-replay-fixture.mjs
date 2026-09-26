const preparedPages = new WeakSet();
const pauseKey = 'shanhai-test-pause-next-replay';

export async function pauseNextReplay(page) {
  if (!preparedPages.has(page)) {
    await page.addInitScript(key => {
      if (sessionStorage.getItem(key) !== '1') return;
      // Pause via the real control before the first animation frame can advance.
      const observer = new MutationObserver(() => {
        if (sessionStorage.getItem(key) !== '1') {
          observer.disconnect();
          return;
        }
        const button = document.querySelector('[data-action="battle-pause"]');
        if (!(button instanceof HTMLButtonElement)) return;
        sessionStorage.removeItem(key);
        observer.disconnect();
        if (button.getAttribute('aria-pressed') !== 'true') button.click();
      });
      observer.observe(document, { childList: true, subtree: true });
    }, pauseKey);
    preparedPages.add(page);
  }
  await page.evaluate(key => sessionStorage.setItem(key, '1'), pauseKey);
}
