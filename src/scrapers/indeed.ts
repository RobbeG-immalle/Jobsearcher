import { Page } from 'playwright';
import { BaseScraper } from './base';
import { Job, SearchOptions } from '../types';

const BASE_URL = 'https://be.indeed.com';

export class IndeedScraper extends BaseScraper {
  async scrape(keywords: string[], options: SearchOptions): Promise<Job[]> {
    const jobs: Job[] = [];
    const query = keywords.join(' ');
    const location = options.location ?? 'Belgium';
    const maxResults = options.maxResults ?? 30;

    await this.launch();
    const page = await this.newPage();

    try {
      const searchUrl = `${BASE_URL}/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&lang=en`;
      console.log(`[Indeed] Searching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Handle cookie banner if present
      await this.dismissCookies(page);

      let pageNum = 0;
      while (jobs.length < maxResults) {
        const pageJobs = await this.extractJobsFromPage(page);
        jobs.push(...pageJobs);

        if (jobs.length >= maxResults) break;

        // Go to next page
        const nextBtn = page.locator('a[data-testid="pagination-page-next"]').first();
        if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) break;

        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded');
        await this.randomDelay();
        pageNum++;

        if (pageNum >= 5) break; // Safety cap
      }
    } catch (err) {
      console.error('[Indeed] Scrape error:', err);
    } finally {
      await this.close();
    }

    return jobs.slice(0, maxResults);
  }

  private async extractJobsFromPage(page: Page): Promise<Job[]> {
    const jobs: Job[] = [];

    // Wait for job cards to load
    await page.waitForSelector('[data-testid="slider_item"], .job_seen_beacon', {
      timeout: 10000,
    }).catch(() => null);

    const cards = await page.locator('.job_seen_beacon, [data-testid="slider_item"]').all();

    for (const card of cards) {
      try {
        const title =
          (await card.locator('h2.jobTitle span[title], h2.jobTitle a span').first().textContent())?.trim() ?? '';
        const company =
          (await card.locator('[data-testid="company-name"], .companyName').first().textContent())?.trim() ?? '';
        const location =
          (await card.locator('[data-testid="text-location"], .companyLocation').first().textContent())?.trim() ?? '';
        const description =
          (await card.locator('.job-snippet, [data-testid="jobDescriptionText"]').first().textContent())?.trim() ?? '';
        const salary =
          (await card.locator('[data-testid="attribute_snippet_testid"]').first().textContent().catch(() => ''))?.trim();
        const jobType =
          (await card.locator('[data-testid="attribute_snippet_testid"]').nth(1).textContent().catch(() => ''))?.trim();

        // Build URL
        const href = await card.locator('a[id^="job_"], h2 a').first().getAttribute('href').catch(() => null);
        const url = href ? (href.startsWith('http') ? href : `${BASE_URL}${href}`) : '';

        const postedDate =
          (await card.locator('[data-testid="myJobsStateDate"], .date').first().textContent().catch(() => ''))?.trim();

        if (title && url) {
          jobs.push({
            title,
            company,
            location,
            description,
            url,
            source: 'Indeed',
            postedDate,
            salary,
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
        'button#onetrust-accept-btn-handler, button[id*="accept"], button[class*="accept-cookie"]',
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
