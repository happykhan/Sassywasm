import { test, expect, type Page } from '@playwright/test'
import { join } from 'path'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'

// Helpers ---------------------------------------------------------------------

function writeFasta(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sassy-e2e-'))
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

// The submit button shares the word "Search" with the mode bar, so target the
// primary action button by its class to stay unambiguous.
function clickRun(page: Page) {
  return page.locator('button.btn-primary').click()
}

// Core / smoke ----------------------------------------------------------------

test('app loads with the four CLI modes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hero-title')).toHaveText('Sassywasm')
  for (const cli of ['sassy search', 'sassy grep', 'sassy filter', 'sassy crispr']) {
    await expect(page.getByText(cli, { exact: true })).toBeVisible()
  }
})

test('search finds the expected matches', async ({ page }) => {
  await page.goto('/')
  await page.locator('textarea').nth(0).fill('ATCGATCG')
  await page.locator('textarea').nth(1).fill('AAAAAATCGATCGAAAAAATCGATCGAA')
  await clickRun(page)
  await expect(page.locator('.results-summary')).toBeVisible()
  // two exact occurrences with k defaulting to 1
  await expect(page.locator('.match-card').first()).toBeVisible()
  await expect(page.locator('.results-count')).toContainText('match')
})

// Sample data button ----------------------------------------------------------

test('sample data button populates inputs and runs for each mode', async ({ page }) => {
  await page.goto('/')

  // search mode
  await page.getByRole('button', { name: /Load sample data/ }).click()
  await expect(page.locator('textarea').nth(0)).not.toHaveValue('')
  await clickRun(page)
  await expect(page.locator('.match-card').first()).toBeVisible()

  // filter mode loads FASTA sample
  await page.getByText('sassy filter', { exact: true }).click()
  await page.getByRole('button', { name: /Load sample data/ }).click()
  await expect(page.locator('textarea.fasta-input')).toContainText('>seq1')
  await clickRun(page)
  await expect(page.locator('.filter-row').first()).toBeVisible()

  // crispr mode loads guide + sets PAM
  await page.getByText('sassy crispr', { exact: true }).click()
  await page.getByRole('button', { name: /Load sample data/ }).click()
  await expect(page.locator('textarea').nth(0)).not.toHaveValue('')
  await clickRun(page)
  await expect(page.locator('.results-summary')).toBeVisible()
})

// File upload -----------------------------------------------------------------

test('uploading a FASTA file populates the pattern and target', async ({ page }) => {
  await page.goto('/')
  const pat = writeFasta('pattern.fasta', '>p\nATCGATCGATCGATCGATCG\n')
  const tgt = writeFasta('target.fasta', '>t\nTTTTATCGATCGATCGATCGATCGAAAA\n')

  await page.locator('input[type=file]').nth(0).setInputFiles(pat)
  await page.locator('input[type=file]').nth(1).setInputFiles(tgt)

  await expect(page.locator('textarea').nth(0)).toHaveValue('ATCGATCGATCGATCGATCG')
  await expect(page.locator('textarea').nth(1)).toHaveValue('TTTTATCGATCGATCGATCGATCGAAAA')

  await clickRun(page)
  await expect(page.locator('.match-card').first()).toBeVisible()
})

// Regression: re-uploading the SAME file after editing must work again.
// Previously the native <input> value was never reset, so the browser fired no
// `change` event for an identical file and the upload was silently ignored.
test('re-uploading the same file works after the textarea is cleared', async ({ page }) => {
  await page.goto('/')
  const pat = writeFasta('same.fasta', '>p\nAAAACCCCGGGGTTTT\n')

  const input = page.locator('input[type=file]').nth(0)
  const textarea = page.locator('textarea').nth(0)

  await input.setInputFiles(pat)
  await expect(textarea).toHaveValue('AAAACCCCGGGGTTTT')

  // user clears the field, then re-uploads the identical file
  await textarea.fill('')
  await expect(textarea).toHaveValue('')
  await input.setInputFiles(pat)
  await expect(textarea).toHaveValue('AAAACCCCGGGGTTTT')
})

// About page / SPA routing ----------------------------------------------------

test('clicking About navigates to the about page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'About', exact: true }).first().click()
  await expect(page).toHaveURL(/\/Sassywasm\/about$/)
  await expect(page.locator('.hero-title')).toHaveText('About Sassywasm')
  await expect(page.getByText('Approximate DNA string matching in the browser')).toBeVisible()
})

// Simulates a GitHub Pages deep link / refresh. On GH Pages the server has no
// /about file, so 404.html rewrites the URL to /Sassywasm/?/about and redirects
// to the app root. This test feeds that encoded URL straight to index.html and
// asserts the decoder restores /Sassywasm/about and renders the About page.
test('SPA fallback decoder restores a deep-linked route', async ({ page }) => {
  await page.goto('/?/about')
  await expect(page).toHaveURL(/\/Sassywasm\/about$/)
  await expect(page.locator('.hero-title')).toHaveText('About Sassywasm')
})

// Guards the GitHub Pages fallback file ships in the build output.
test('404.html fallback is served with the redirect script', async ({ request }) => {
  const res = await request.get('/Sassywasm/404.html')
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('pathSegmentsToKeep')
})
