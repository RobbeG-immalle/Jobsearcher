import { Page } from 'playwright';
import { BaseScraper } from './base';
import { Job, SearchOptions } from '../types';

const BASE_URL = 'https://www.jobat.be';

export class JobatScraper extends BaseScraper {
  async scrape(keywords: string[], options: SearchOptions): Promise<Job[]> {
    const jobs: Job[] = [];
    const query = keywords.join(' ');
    const location = options.location ?? 'Belgium';
    const maxResults = options.maxResults ?? 30;

    await this.launch();
    const page = await this.newPage();

    try {
      const searchUrl =
        `${BASE_URL}/en/jobs?q=${encodeURIComponent(query)}&where=${encodeURIComponent(location)}`;
      console.log(`[Jobat] Searching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      await this.dismissCookies(page);

      let pageNum = 1;
      while (jobs.length < maxResults) {
        const pageJobs = await this.extractJobsFromPage(page);
        if (pageJobs.length === 0) break;
        jobs.push(...pageJobs);

        if (jobs.length >= maxResults) break;

        // Next page
        const nextBtn = page.locator('a[rel="next"], .pagination-next a').first();
        if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) break;

        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded');
        await this.randomDelay();
        pageNum++;

        if (pageNum >= 5) break;
      }
    } catch (err) {
      console.error('[Jobat] Scrape error:', err);
    } finally {
      await this.close();
    }

    return jobs.slice(0, maxResults);
  }

  private async extractJobsFromPage(page: Page): Promise<Job[]> {
    const jobs: Job[] = [];

    await page.waitForSelector(
      'article.job, .job-card, [data-testid="job-card"]',
      { timeout: 10000 },
    ).catch(() => null);

    const cards = await page.locator('article.job, .job-card, [data-testid="job-card"]').all();

    for (const card of cards) {
      try {
        const title =
          (await card.locator('h2, h3, .job-title').first().textContent())?.trim() ?? '';
        const company =
          (await card.locator('.company, .employer').first().textContent().catch(() => ''))?.trim() ?? '';
        const location =
          (await card.locator('.location, .job-location').first().textContent().catch(() => ''))?.trim() ?? '';
        const description =
          (await card.locator('.description, .job-description').first().textContent().catch(() => ''))?.trim() ?? '';

        const href = await card.locator('a').first().getAttribute('href').catch(() => null);
        const url = href ? (href.startsWith('http') ? href : `${BASE_URL}${href}`) : '';

        if (title && url) {
          jobs.push({
            title,
            company,
            location,
            description,
            url,
            source: 'Jobat',
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
        'button[id*="accept"], button[class*="consent-accept"]',
      ).first();
      if (await acceptBtn.isVisible({ timeout: 3000 })) {
        await acceptBtn.click();
        await this.randomDelay(300, 600);
      }
    } catch {
      // No cookie banner – continue
    }
  }
}
