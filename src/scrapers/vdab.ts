import { Page } from 'playwright';
import { BaseScraper } from './base';
import { Job, SearchOptions } from '../types';

const BASE_URL = 'https://www.vdab.be';

export class VDABScraper extends BaseScraper {
  async scrape(keywords: string[], options: SearchOptions): Promise<Job[]> {
    const jobs: Job[] = [];
    const query = keywords.join(' ');
    const location = options.location ?? 'België';
    const maxResults = options.maxResults ?? 30;

    await this.launch();
    const page = await this.newPage();

    try {
      const searchUrl =
        `${BASE_URL}/vindeenjob/vacatures?sort=relevant&employmentType=&page=1` +
        `&keyword=${encodeURIComponent(query)}&municipality=${encodeURIComponent(location)}`;
      console.log(`[VDAB] Searching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      await this.dismissCookies(page);

      let pageNum = 1;
      while (jobs.length < maxResults) {
        const pageJobs = await this.extractJobsFromPage(page);
        jobs.push(...pageJobs);

        if (jobs.length >= maxResults) break;

        // Navigate next page
        pageNum++;
        const nextUrl = searchUrl.replace(/page=\d+/, `page=${pageNum}`);
        const prevCount = jobs.length;

        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.randomDelay();

        const newPageJobs = await this.extractJobsFromPage(page);
        if (newPageJobs.length === 0) break; // No more results

        jobs.push(...newPageJobs);

        if (jobs.length === prevCount) break; // Safety guard
        if (pageNum >= 5) break;
      }
    } catch (err) {
      console.error('[VDAB] Scrape error:', err);
    } finally {
      await this.close();
    }

    return jobs.slice(0, maxResults);
  }

  private async extractJobsFromPage(page: Page): Promise<Job[]> {
    const jobs: Job[] = [];

    await page.waitForSelector(
      '.vacancy-tile, article.vacancy, [data-testid="vacancy-card"]',
      { timeout: 10000 },
    ).catch(() => null);

    const cards = await page
      .locator('.vacancy-tile, article.vacancy, [data-testid="vacancy-card"]')
      .all();

    for (const card of cards) {
      try {
        const title =
          (await card.locator('h2, h3, .vacancy-title, [data-testid="vacancy-title"]').first().textContent())?.trim() ?? '';
        const company =
          (await card.locator('.company-name, [data-testid="company-name"]').first().textContent().catch(() => ''))?.trim() ?? '';
        const location =
          (await card.locator('.vacancy-location, [data-testid="location"]').first().textContent().catch(() => ''))?.trim() ?? '';
        const description =
          (await card.locator('.vacancy-description, [data-testid="description"]').first().textContent().catch(() => ''))?.trim() ?? '';
        const jobType =
          (await card.locator('.employment-type, [data-testid="employment-type"]').first().textContent().catch(() => ''))?.trim();

        const href = await card.locator('a').first().getAttribute('href').catch(() => null);
        const url = href
          ? href.startsWith('http')
            ? href
            : `${BASE_URL}${href}`
          : '';

        const postedDate =
          (await card.locator('.vacancy-date, [data-testid="date"]').first().textContent().catch(() => ''))?.trim();

        if (title && url) {
          jobs.push({
            title,
            company,
            location,
            description,
            url,
            source: 'VDAB',
            postedDate,
            jobType,
          });
        }
      } catch {
        // Skip malformed card
      }
    }

    return jobs;
  }

  private async dismissCookies(page: Page): Promise<void> {
    try {
      const acceptBtn = page.locator(
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, button[id*="accept"], button[class*="cookie-accept"]',
      ).first();
      if (await acceptBtn.isVisible({ timeout: 4000 })) {
        await acceptBtn.click();
        await this.randomDelay(300, 600);
      }
    } catch {
      // No cookie banner – continue
    }
  }
}
