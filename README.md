# Jobsearcher

A Node.js + TypeScript REST API that uses **Playwright** to scrape Belgian job boards (Indeed, Stepstone, VDAB, Jobat), matches listings against a candidate's CV, scores them for relevance, and can send personalised application emails.

---

## Features

| Feature | Detail |
|---|---|
| CV parsing | Upload a **PDF** or plain-text CV |
| Skill extraction | Detects 80+ tech skills and spoken languages from CV text |
| Location extraction | Detects Belgian cities / regions from CV |
| Job scraping | Indeed BE, Stepstone BE, VDAB, Jobat BE |
| Relevance scoring | 0–100 score based on skill matches + recency |
| Email applications | Send personalised cover-letter emails via SMTP (nodemailer) |
| REST API | Express with CORS, JSON + multipart support |

---

## Requirements

- **Node.js ≥ 18**
- Playwright browsers: `npx playwright install chromium`

---

## Quick start

```bash
# 1. Clone and install
npm install
npx playwright install chromium

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in SMTP credentials

# 3. Start the API (TypeScript, no build step)
npm run dev
# → Listening on http://localhost:3000
```

To build a production bundle:

```bash
npm run build
npm start
```

---

## API Reference

### `GET /health`
Returns `{ status: "ok", timestamp: "…" }`.

---

### `POST /cv/parse`
Extract skills and location from an uploaded CV.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cv` | file (multipart) | ✅ | PDF or plain-text CV |

**Response**
```json
{
  "skills": ["typescript", "react", "node.js", "docker"],
  "location": "Ghent",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+32479123456"
}
```

---

### `POST /jobs/search`
Search for jobs using manually supplied parameters (or a server-side CV file path).

**Body (JSON)**
```json
{
  "skills": ["typescript", "react"],
  "location": "Antwerp",
  "maxResults": 20,
  "sources": ["indeed", "stepstone", "vdab", "jobat"]
}
```

| Field | Default | Description |
|---|---|---|
| `skills` | — | Array of skill strings to search for |
| `location` | `"Belgium"` | City, region, or "Belgium" |
| `maxResults` | `20` | Max results per source |
| `sources` | all four | Subset of `["indeed","stepstone","vdab","jobat"]` |
| `jobType` | — | `"fulltime"` / `"parttime"` / `"contract"` / `"internship"` |
| `cvFilename` | — | Filename (basename only) of a previously uploaded CV file in the uploads directory |

**Response**
```json
{
  "jobs": [
    {
      "title": "Frontend Developer",
      "company": "Acme NV",
      "location": "Antwerp",
      "description": "…",
      "url": "https://…",
      "source": "Indeed",
      "postedDate": "2 days ago",
      "score": 72,
      "matchedSkills": ["typescript", "react"]
    }
  ],
  "totalFound": 42,
  "searchedAt": "2024-05-04T14:25:00.000Z",
  "location": "Antwerp",
  "skills": ["typescript", "react"]
}
```

---

### `POST /jobs/search-with-cv`
Upload a CV and search in one request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `cv` | file (multipart) | ✅ | PDF or text CV |
| `location` | string | — | Override extracted location |
| `maxResults` | number | — | Max results per source (default 20) |
| `sources` | comma-separated string | — | e.g. `"indeed,vdab"` |

---

### `POST /email/apply`
Send a job application email.

**Body (JSON)**
```json
{
  "to": "recruiter@company.com",
  "jobTitle": "Frontend Developer",
  "company": "Acme NV",
  "jobUrl": "https://be.indeed.com/…",
  "applicantName": "Jane Doe",
  "applicantEmail": "jane@example.com",
  "coverLetter": "Dear Hiring Manager,\n\nI am very interested in…",
  "cvFilename": "my-cv-abc123.pdf"
}
```

`coverLetter` and `cvFilename` are optional. If `coverLetter` is omitted, a professional default is generated. If `cvFilename` is provided and the file exists in the uploads directory, it is attached to the email as `CV.pdf`.

---

## Environment variables

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | Use TLS (`true`) or STARTTLS (`false`) |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password / app password |
| `EMAIL_FROM` | SMTP_USER | Sender display name + address |
| `HEADLESS` | `true` | Run Playwright browsers headlessly |

---

## Project structure

```
src/
├── index.ts           # Express API entry point
├── types.ts           # Shared TypeScript interfaces
├── cv/
│   ├── parser.ts      # PDF + text CV parsing (pdf-parse)
│   └── extractor.ts   # Skill & location extraction
├── scrapers/
│   ├── base.ts        # Abstract BaseScraper (Playwright)
│   ├── indeed.ts      # Indeed Belgium scraper
│   ├── stepstone.ts   # Stepstone Belgium scraper
│   ├── vdab.ts        # VDAB scraper
│   └── jobat.ts       # Jobat Belgium scraper
├── scoring/
│   └── scorer.ts      # Relevance scoring (0–100)
└── email/
    └── mailer.ts      # Nodemailer email sender
```

---

## Extending

### Adding a new job board
1. Create `src/scrapers/mynewsite.ts` extending `BaseScraper`.
2. Implement the `scrape(keywords, options): Promise<Job[]>` method.
3. Register it in the `scraperMap` inside `runScrapers()` in `src/index.ts`.
4. Add the new key to the `sources` array accepted by the API.

### Adding new skills
Edit the `TECH_SKILLS` array in `src/cv/extractor.ts`.
