import { Job, ScoredJob } from '../types';

/**
 * Score each job listing against the candidate's extracted skills.
 *
 * Scoring model (0–100):
 *  - Title match  (up to 40 pts): each matched skill in the title = 10 pts
 *  - Description match (up to 40 pts): each matched skill in the description = 2 pts
 *  - Recency bonus (up to 20 pts): posted within 7 days = 20, 30 days = 10
 */
export function scoreJobs(jobs: Job[], skills: string[]): ScoredJob[] {
  const normalizedSkills = skills.map((s) => s.toLowerCase());

  const scored = jobs.map((job): ScoredJob => {
    const titleLower = job.title.toLowerCase();
    const descLower = (job.description ?? '').toLowerCase();

    const matchedSkills = new Set<string>();
    let score = 0;

    for (const skill of normalizedSkills) {
      const pattern = new RegExp(`(?<![a-z0-9])${escapeRegex(skill)}(?![a-z0-9])`, 'i');

      if (pattern.test(titleLower)) {
        matchedSkills.add(skill);
        score += 10;
      } else if (pattern.test(descLower)) {
        matchedSkills.add(skill);
        score += 2;
      }
    }

    // Recency bonus
    if (job.postedDate) {
      const recency = parseRecency(job.postedDate);
      if (recency !== null) {
        if (recency <= 7) score += 20;
        else if (recency <= 30) score += 10;
      }
    }

    // Cap at 100
    score = Math.min(100, score);

    return {
      ...job,
      score,
      matchedSkills: Array.from(matchedSkills),
    };
  });

  // Sort descending by score
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Parse a "posted date" string into days-ago (integer).
 * Returns null if the string cannot be parsed.
 * Handles common formats from Indeed/VDAB/Stepstone ("2 days ago", "Today", "30+ days ago" …)
 */
function parseRecency(postedDate: string): number | null {
  const lower = postedDate.toLowerCase().trim();

  if (lower === 'today' || lower === 'just posted' || lower === 'vandaag' || lower === 'aujourd\'hui') {
    return 0;
  }

  // "X days ago" / "X dagen geleden"
  const daysMatch = lower.match(/(\d+)\+?\s*(day|dag|jour)/);
  if (daysMatch) return parseInt(daysMatch[1], 10);

  // "X hours ago"
  const hoursMatch = lower.match(/(\d+)\s*(hour|uur|heure)/);
  if (hoursMatch) return 0;

  // "X weeks ago"
  const weeksMatch = lower.match(/(\d+)\s*(week)/);
  if (weeksMatch) return parseInt(weeksMatch[1], 10) * 7;

  // "X months ago"
  const monthsMatch = lower.match(/(\d+)\s*(month|maand|mois)/);
  if (monthsMatch) return parseInt(monthsMatch[1], 10) * 30;

  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
