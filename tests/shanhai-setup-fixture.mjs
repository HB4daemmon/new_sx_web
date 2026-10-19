export async function setSetupSeed(page, value) {
  await page.locator('[name="seed"]').evaluate((input, seed) => {
    if (!(input instanceof HTMLInputElement) || input.type !== 'hidden') {
      throw new Error('Setup seed must be a hidden input');
    }
    input.value = String(seed);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
