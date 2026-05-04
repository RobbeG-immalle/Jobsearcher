import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Job, SearchOptions } from '../types';

/**
 * Abstract base class for all job-site scrapers.
 * Each subclass implements `scrape()` for a specific site.
 */
export abstract class BaseScraper {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected headless: boolean;

  constructor(headless = true) {
    this.headless = headless;
  }

  protected async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'nl-BE',
      viewport: { width: 1280, height: 800 },
    });
  }

  protected async newPage(): Promise<Page> {
    if (!this.context) throw new Error('Browser context not initialised');
    const page = await this.context.newPage();
    // Block images/fonts to speed up scraping
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot}', (route) =>
      route.abort(),
    );
    return page;
  }

  protected async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }

  /**
   * Scrape jobs for the given keywords and options.
   * Must be implemented by each subclass.
   */
  abstract scrape(keywords: string[], options: SearchOptions): Promise<Job[]>;

  /**
   * Helper: safe text content with fallback.
   */
  protected async safeText(page: Page, selector: string): Promise<string> {
    try {
      return (await page.textContent(selector, { timeout: 3000 }))?.trim() ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Helper: safe attribute with fallback.
   */
  protected async safeAttr(
    page: Page,
    selector: string,
    attr: string,
  ): Promise<string> {
    try {
      return (await page.getAttribute(selector, attr, { timeout: 3000 })) ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Pause execution for a random duration to avoid rate-limiting.
   */
  protected async randomDelay(minMs = 800, maxMs = 2000): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs) + minMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
