import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { rateLimit } from 'express-rate-limit';

import { parseCVBuffer } from './cv/parser';
import { extractCVData } from './cv/extractor';
import { IndeedScraper } from './scrapers/indeed';
import { StepstoneScraper } from './scrapers/stepstone';
import { VDABScraper } from './scrapers/vdab';
import { JobatScraper } from './scrapers/jobat';
import { scoreJobs } from './scoring/scorer';
import { sendApplicationEmail, generateEmailDraft } from './email/mailer';
import { CVData, EmailOptions, Job, SearchOptions, SearchResult } from './types';

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Ensure upload directory exists
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Serve the static frontend
app.use(express.static(path.resolve(process.cwd(), 'public')));

// Allowed scraper sources (allowlist to prevent dynamic dispatch on user input)
const ALLOWED_SOURCES = ['indeed', 'stepstone', 'vdab', 'jobat'] as const;
type SourceKey = typeof ALLOWED_SOURCES[number];

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and plain-text files are accepted'));
    }
  },
});

// Rate limiter for file-upload endpoints (prevent DoS / resource exhaustion)
const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Rate limiter for the search endpoint (Playwright scraping is resource-intensive)
const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please try again later.' },
});

// ---------------------------------------------------------------------------
// Helper: construct a safe path within UPLOAD_DIR using only the basename.
// path.basename() strips any directory components, preventing traversal.
// ---------------------------------------------------------------------------
function safeUploadPath(userFilename: string): string {
  return path.join(UPLOAD_DIR, path.basename(userFilename));
}

/**
 * Determine MIME type from a file extension (for server-side CV files).
 */
function mimeFromExt(filename: string): string {
  return path.extname(filename).toLowerCase() === '.pdf'
    ? 'application/pdf'
    : 'text/plain';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Simple health check.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /cv/parse
 * Upload a CV (PDF or text) and get back extracted skills + location.
 *
 * Body: multipart/form-data  →  field "cv" (file)
 * Response: CVData (without rawText)
 */
app.post(
  '/cv/parse',
  uploadRateLimit,
  upload.single('cv'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CV file uploaded (field name: "cv")' });
        return;
      }

      const buffer = fs.readFileSync(safeUploadPath(req.file.filename));
      const rawText = await parseCVBuffer(buffer, req.file.mimetype);
      const cvData = extractCVData(rawText);

      // Remove raw text from response to keep payload small
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawText: _raw, ...safeData } = cvData;
      res.json(safeData);
    } catch (err) {
      next(err);
    } finally {
      // Clean up uploaded temp file using the multer-generated filename
      if (req.file?.filename) fs.unlink(safeUploadPath(req.file.filename), () => null);
    }
  },
);

/**
 * POST /jobs/search
 * Search for jobs based on CV or manually supplied parameters.
 *
 * Body (JSON):
 * {
 *   cvFilename?: string,      // filename (basename only) of a CV file in the uploads directory
 *   skills?: string[],        // override / supplement extracted skills
 *   location?: string,        // override extracted location (e.g. "Ghent")
 *   radius?: number,          // km radius (where supported)
 *   maxResults?: number,      // per source (default 20)
 *   jobType?: string,
 *   sources?: string[],       // ["indeed","stepstone","vdab","jobat"] – default: all
 * }
 */
app.post('/jobs/search', searchRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    let cvData: CVData | null = null;

    if (req.body.cvFilename) {
      // Use only the basename to prevent path traversal
      const safePath = safeUploadPath(req.body.cvFilename);
      if (!fs.existsSync(safePath)) {
        res.status(404).json({ error: 'CV file not found in the uploads directory.' });
        return;
      }
      const buffer = fs.readFileSync(safePath);
      const raw = await parseCVBuffer(buffer, mimeFromExt(req.body.cvFilename));
      cvData = extractCVData(raw);
    }

    const skills: string[] = req.body.skills ?? cvData?.skills ?? [];
    const location: string = req.body.location ?? cvData?.location ?? 'Belgium';

    if (skills.length === 0) {
      res.status(400).json({
        error: 'No skills found. Provide a CV or pass "skills" array in the request body.',
      });
      return;
    }

    const options: SearchOptions = {
      location,
      radius: req.body.radius,
      maxResults: Number(req.body.maxResults ?? 20),
      jobType: req.body.jobType,
    };

    const requestedSources = sanitiseSources(req.body.sources);
    const headless = process.env.HEADLESS !== 'false';

    const allJobs = await runScrapers(skills, options, requestedSources, headless);
    const scoredJobs = scoreJobs(allJobs, skills);

    const result: SearchResult = {
      jobs: scoredJobs,
      totalFound: scoredJobs.length,
      searchedAt: new Date().toISOString(),
      location,
      skills,
    };

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /jobs/search-with-cv
 * Upload a CV file and search for jobs in one request.
 *
 * Body: multipart/form-data
 *   - cv (file): PDF or text CV
 *   - location (string, optional): override extracted location
 *   - maxResults (number, optional)
 *   - sources (comma-separated string, optional): "indeed,stepstone,vdab,jobat"
 */
app.post(
  '/jobs/search-with-cv',
  uploadRateLimit,
  upload.single('cv'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CV file uploaded (field name: "cv")' });
        return;
      }

      const buffer = fs.readFileSync(safeUploadPath(req.file.filename));
      const rawText = await parseCVBuffer(buffer, req.file.mimetype);
      const cvData = extractCVData(rawText);

      const location = req.body.location ?? cvData.location;
      const skills = cvData.skills;

      if (skills.length === 0) {
        res.status(400).json({ error: 'No recognisable skills found in the uploaded CV.' });
        return;
      }

      const options: SearchOptions = {
        location,
        maxResults: Number(req.body.maxResults ?? 20),
        jobType: req.body.jobType,
      };

      const requestedSources = req.body.sources
        ? sanitiseSources(req.body.sources.split(',').map((s: string) => s.trim()))
        : [...ALLOWED_SOURCES];

      const headless = process.env.HEADLESS !== 'false';
      const allJobs = await runScrapers(skills, options, requestedSources, headless);
      const scoredJobs = scoreJobs(allJobs, skills);

      const result: SearchResult = {
        jobs: scoredJobs,
        totalFound: scoredJobs.length,
        searchedAt: new Date().toISOString(),
        location,
        skills,
      };

      res.json(result);
    } catch (err) {
      next(err);
    } finally {
      if (req.file?.filename) fs.unlink(safeUploadPath(req.file.filename), () => null);
    }
  },
);

/**
 * POST /email/apply
 * Send a job application email.
 *
 * Body (JSON):
 * {
 *   to: string,             // recruiter email address
 *   jobTitle: string,
 *   company: string,
 *   jobUrl: string,
 *   applicantName: string,
 *   applicantEmail: string,
 *   coverLetter?: string,   // if omitted, a default letter is generated
 *   cvFilename?: string,    // basename of a CV file in the uploads directory to attach
 * }
 */
app.post('/email/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const required = ['to', 'jobTitle', 'company', 'jobUrl', 'applicantName', 'applicantEmail'];
    const missing = required.filter((f) => !req.body[f]);
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    // Derive safe CV path from basename only (prevents path traversal)
    let safeCvPath: string | undefined;
    if (req.body.cvFilename) {
      safeCvPath = safeUploadPath(req.body.cvFilename);
    }

    const opts: EmailOptions = {
      to: req.body.to,
      jobTitle: req.body.jobTitle,
      company: req.body.company,
      jobUrl: req.body.jobUrl,
      applicantName: req.body.applicantName,
      applicantEmail: req.body.applicantEmail,
      coverLetter: req.body.coverLetter,
      cvPath: safeCvPath,
    };

    await sendApplicationEmail(opts);
    res.json({ success: true, message: `Application sent to ${opts.to}` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /email/generate
 * Generate an application email draft without sending it.
 *
 * Body (JSON):
 * {
 *   jobTitle: string,
 *   company: string,
 *   jobUrl: string,
 *   applicantName: string,
 *   applicantEmail: string,
 *   coverLetter?: string,
 * }
 * Response: { subject: string, body: string }
 */
app.post('/email/generate', (req: Request, res: Response) => {
  const required = ['jobTitle', 'company', 'jobUrl', 'applicantName', 'applicantEmail'];
  const missing = required.filter((f) => !req.body[f]);
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }

  const opts: EmailOptions = {
    to: '', // Not needed for draft generation – recipient is chosen by the user when sending manually
    jobTitle: req.body.jobTitle,
    company: req.body.company,
    jobUrl: req.body.jobUrl,
    applicantName: req.body.applicantName,
    applicantEmail: req.body.applicantEmail,
    coverLetter: req.body.coverLetter,
  };

  const draft = generateEmailDraft(opts);
  res.json(draft);
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter user-supplied source names to only allowlisted values, preventing
 * dynamic method dispatch on arbitrary user-controlled strings.
 */
function sanitiseSources(input: unknown): SourceKey[] {
  if (!Array.isArray(input)) return [...ALLOWED_SOURCES];
  return (input as string[])
    .map((s) => s.toLowerCase().trim())
    .filter((s): s is SourceKey => (ALLOWED_SOURCES as readonly string[]).includes(s));
}

async function runScrapers(
  skills: string[],
  options: SearchOptions,
  sources: SourceKey[],
  headless: boolean,
): Promise<Job[]> {
  // Use explicit switch to avoid dynamic property access on user-derived keys
  function scrapeSource(source: SourceKey): Promise<Job[]> {
    switch (source) {
      case 'indeed':    return new IndeedScraper(headless).scrape(skills, options);
      case 'stepstone': return new StepstoneScraper(headless).scrape(skills, options);
      case 'vdab':      return new VDABScraper(headless).scrape(skills, options);
      case 'jobat':     return new JobatScraper(headless).scrape(skills, options);
    }
  }

  const tasks = sources.map((source) =>
    scrapeSource(source).catch((err: Error) => {
      console.error('[Scraper] Failed for source:', source, '-', err.message);
      return [] as Job[];
    }),
  );

  const results = await Promise.all(tasks);
  return results.flat();
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
  console.log(`Jobsearcher API listening on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /cv/parse              (multipart: cv)');
  console.log('  POST /jobs/search           (JSON body)');
  console.log('  POST /jobs/search-with-cv   (multipart: cv + optional fields)');
  console.log('  POST /email/apply           (JSON body)');
  console.log('  POST /email/generate        (JSON body)');
  console.log(`  GET  /                      (UI)`);
});

export default app;
