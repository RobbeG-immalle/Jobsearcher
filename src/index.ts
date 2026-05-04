import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { parseCVBuffer, parseCVFile } from './cv/parser';
import { extractCVData } from './cv/extractor';
import { IndeedScraper } from './scrapers/indeed';
import { StepstoneScraper } from './scrapers/stepstone';
import { VDABScraper } from './scrapers/vdab';
import { JobatScraper } from './scrapers/jobat';
import { scoreJobs } from './scoring/scorer';
import { sendApplicationEmail } from './email/mailer';
import { CVData, EmailOptions, Job, SearchOptions, SearchResult } from './types';

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Ensure upload directory exists
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  upload.single('cv'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CV file uploaded (field name: "cv")' });
        return;
      }

      const rawText = await parseCVBuffer(
        fs.readFileSync(req.file.path),
        req.file.mimetype,
      );
      const cvData = extractCVData(rawText);

      // Remove raw text from response to keep payload small
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rawText: _raw, ...safeData } = cvData;
      res.json(safeData);
    } catch (err) {
      next(err);
    } finally {
      // Clean up uploaded temp file
      if (req.file?.path) fs.unlink(req.file.path, () => null);
    }
  },
);

/**
 * POST /jobs/search
 * Search for jobs based on CV or manually supplied parameters.
 *
 * Body (JSON):
 * {
 *   cvPath?: string,          // absolute path to CV file on server (alternative to upload)
 *   skills?: string[],        // override / supplement extracted skills
 *   location?: string,        // override extracted location (e.g. "Ghent")
 *   radius?: number,          // km radius (where supported)
 *   maxResults?: number,      // per source (default 20)
 *   jobType?: string,
 *   sources?: string[],       // ["indeed","stepstone","vdab","jobat"] – default: all
 * }
 */
app.post('/jobs/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let cvData: CVData | null = null;

    if (req.body.cvPath) {
      const raw = await parseCVFile(req.body.cvPath);
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
      maxResults: req.body.maxResults ?? 20,
      jobType: req.body.jobType,
    };

    const requestedSources: string[] = req.body.sources ?? ['indeed', 'stepstone', 'vdab', 'jobat'];
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
  upload.single('cv'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No CV file uploaded (field name: "cv")' });
        return;
      }

      const rawText = await parseCVBuffer(
        fs.readFileSync(req.file.path),
        req.file.mimetype,
      );
      const cvData = extractCVData(rawText);

      const location = req.body.location ?? cvData.location;
      const skills = cvData.skills;

      if (skills.length === 0) {
        res.status(400).json({ error: 'No recognisable skills found in the uploaded CV.' });
        return;
      }

      const options: SearchOptions = {
        location,
        maxResults: parseInt(req.body.maxResults ?? '20', 10),
        jobType: req.body.jobType,
      };

      const requestedSources: string[] = req.body.sources
        ? req.body.sources.split(',').map((s: string) => s.trim().toLowerCase())
        : ['indeed', 'stepstone', 'vdab', 'jobat'];

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
      if (req.file?.path) fs.unlink(req.file.path, () => null);
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
 *   cvPath?: string,        // absolute path to attach as PDF
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

    const opts: EmailOptions = {
      to: req.body.to,
      jobTitle: req.body.jobTitle,
      company: req.body.company,
      jobUrl: req.body.jobUrl,
      applicantName: req.body.applicantName,
      applicantEmail: req.body.applicantEmail,
      coverLetter: req.body.coverLetter,
      cvPath: req.body.cvPath,
    };

    await sendApplicationEmail(opts);
    res.json({ success: true, message: `Application sent to ${opts.to}` });
  } catch (err) {
    next(err);
  }
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
async function runScrapers(
  skills: string[],
  options: SearchOptions,
  sources: string[],
  headless: boolean,
): Promise<Job[]> {
  const scraperMap: Record<string, () => Promise<Job[]>> = {
    indeed: () => new IndeedScraper(headless).scrape(skills, options),
    stepstone: () => new StepstoneScraper(headless).scrape(skills, options),
    vdab: () => new VDABScraper(headless).scrape(skills, options),
    jobat: () => new JobatScraper(headless).scrape(skills, options),
  };

  const tasks = sources
    .filter((s) => scraperMap[s])
    .map((s) =>
      scraperMap[s]().catch((err) => {
        console.error(`[${s}] Failed:`, err.message);
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
});

export default app;
