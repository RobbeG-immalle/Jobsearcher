import { Page } from 'playwright';
import { BaseScraper } from './base';
import { Job, SearchOptions } from '../types';

const BASE_URL = 'https://www.stepstone.be';

export class StepstoneScraper extends BaseScraper {
  async scrape(keywords: string[], options: SearchOptions): Promise<Job[]> {
    const jobs: Job[] = [];
    const query = keywords.join(' ');
    const location = options.location ?? 'Belgium';
    const maxResults = options.maxResults ?? 30;

    await this.launch();
    const page = await this.newPage();

    try {
      const searchUrl =
        `${BASE_URL}/jobs/en?q=${encodeURIComponent(query)}&where=${encodeURIComponent(location)}`;
      console.log(`[Stepstone] Searching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      await this.dismissCookies(page);

      let pageNum = 0;
      while (jobs.length < maxResults) {
        const pageJobs = await this.extractJobsFromPage(page);
        jobs.push(...pageJobs);

        if (jobs.length >= maxResults) break;

        // Stepstone pagination
        const nextBtn = page.locator('[data-at="pagination-btn-next"], a[aria-label*="next"]').first();
        if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) break;

        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded');
        await this.randomDelay();
        pageNum++;

        if (pageNum >= 5) break;
      }
    } catch (err) {
      console.error('[Stepstone] Scrape error:', err);
    } finally {
      await this.close();
    }

    return jobs.slice(0, maxResults);
  }

  private async extractJobsFromPage(page: Page): Promise<Job[]> {
    const jobs: Job[] = [];

    await page.waitForSelector('[data-at="job-item"], article[data-at]', {
      timeout: 10000,
    }).catch(() => null);

    const cards = await page.locator('[data-at="job-item"]').all();

    for (const card of cards) {
      try {
        const title =
          (await card.locator('[data-at="job-item-title"]').first().textContent())?.trim() ?? '';
        const company =
          (await card.locator('[data-at="job-item-company-name"]').first().textContent())?.trim() ?? '';
        const location =
          (await card.locator('[data-at="job-item-location"]').first().textContent())?.trim() ?? '';
        const description =
          (await card.locator('[data-at="job-item-intro"]').first().textContent().catch(() => ''))?.trim() ?? '';
        const salary =
          (await card.locator('[data-at="job-item-salary"]').first().textContent().catch(() => ''))?.trim();

        const href = await card.locator('a[data-at="job-item-title"]').first().getAttribute('href').catch(() => null);
        const url = href ? (href.startsWith('http') ? href : `${BASE_URL}${href}`) : '';

        const postedDate =
          (await card.locator('[data-at="job-item-posted-date"]').first().textContent().catch(() => ''))?.trim();

        if (title && url) {
          jobs.push({
            title,
            company,
            location,
            description,
            url,
            source: 'Stepstone',
            postedDate,
            salary,
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
        '#ccmgt_explicit_accept, button[aria-label*="ccept"], button[id*="accept"]',
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
