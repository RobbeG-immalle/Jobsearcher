import { CVData } from '../types';

// ---------------------------------------------------------------------------
// Skill keywords – extend as needed
// ---------------------------------------------------------------------------
const TECH_SKILLS = [
  // Programming languages
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'c', 'go', 'rust',
  'kotlin', 'swift', 'ruby', 'php', 'scala', 'r', 'matlab', 'perl', 'bash',
  // Frontend
  'react', 'vue', 'angular', 'svelte', 'html', 'css', 'sass', 'tailwind',
  'next.js', 'nuxt', 'webpack', 'vite', 'redux',
  // Backend / frameworks
  'node.js', 'express', 'fastify', 'nestjs', 'django', 'flask', 'fastapi',
  'spring', 'asp.net', 'laravel', 'rails',
  // Databases
  'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
  'dynamodb', 'cassandra', 'sqlite', 'oracle',
  // Cloud / DevOps
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible',
  'jenkins', 'github actions', 'ci/cd', 'linux', 'nginx',
  // Data / AI / ML
  'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'scikit-learn',
  'pandas', 'numpy', 'power bi', 'tableau', 'spark', 'hadoop',
  // Other tech
  'graphql', 'rest api', 'microservices', 'agile', 'scrum', 'git', 'jira',
  'figma', 'photoshop', 'salesforce', 'sap', 'sharepoint',
  // Languages (spoken – relevant for Belgium)
  'dutch', 'french', 'english', 'german', 'nederlands', 'français',
];

// Belgian cities / regions used for location detection
const BELGIAN_LOCATIONS = [
  'antwerp', 'antwerpen', 'brussels', 'brussel', 'bruxelles',
  'ghent', 'gent', 'liège', 'liege', 'bruges', 'brugge',
  'leuven', 'namur', 'mons', 'mechelen', 'aalst', 'hasselt',
  'kortrijk', 'ostend', 'oostende', 'turnhout', 'genk', 'roeselare',
  'mouscron', 'charleroi', 'arlon', 'wavre', 'eupen',
  'flemish brabant', 'walloon brabant', 'east flanders', 'oost-vlaanderen',
  'west flanders', 'west-vlaanderen', 'hainaut', 'luxembourg', 'limburg',
  'flanders', 'wallonia', 'vlaanderen', 'wallonie', 'belgium', 'belgië',
];

/**
 * Extract structured information from raw CV text.
 */
export function extractCVData(rawText: string): CVData {
  const normalized = rawText.toLowerCase();

  return {
    rawText,
    skills: extractSkills(normalized),
    location: extractLocation(normalized),
    name: extractName(rawText),
    email: extractEmail(rawText),
    phone: extractPhone(rawText),
  };
}

function extractSkills(normalizedText: string): string[] {
  const found = new Set<string>();
  for (const skill of TECH_SKILLS) {
    // Use word-boundary-style check (skill appears as distinct token)
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegex(skill)}(?![a-z0-9])`, 'i');
    if (pattern.test(normalizedText)) {
      found.add(skill);
    }
  }
  return Array.from(found);
}

function extractLocation(normalizedText: string): string {
  for (const loc of BELGIAN_LOCATIONS) {
    if (normalizedText.includes(loc)) {
      // Return a canonical English name
      return canonicalLocation(loc);
    }
  }
  return 'Belgium'; // default fallback
}

function extractName(rawText: string): string | undefined {
  // First non-empty line is often the candidate's name
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0];
  // Skip if first line looks like a heading keyword
  if (!firstLine || /cv|curriculum|resume|vitae/i.test(firstLine)) {
    return lines[1];
  }
  return firstLine;
}

function extractEmail(rawText: string): string | undefined {
  const match = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : undefined;
}

function extractPhone(rawText: string): string | undefined {
  // Matches Belgian and international phone formats
  const match = rawText.match(
    /(\+32|0032|0)[1-9][0-9\s\-.]{6,12}[0-9]/,
  );
  return match ? match[0].replace(/\s/g, '') : undefined;
}

function canonicalLocation(loc: string): string {
  const map: Record<string, string> = {
    antwerpen: 'Antwerp',
    brussel: 'Brussels',
    bruxelles: 'Brussels',
    gent: 'Ghent',
    liege: 'Liège',
    brugge: 'Bruges',
    vlaanderen: 'Flanders',
    wallonie: 'Wallonia',
    'oost-vlaanderen': 'East Flanders',
    'west-vlaanderen': 'West Flanders',
    belgi: 'Belgium',   // matches partial strings like "belgie"
    belgië: 'Belgium',
    // pass-through for already-English names
  };
  return map[loc] ?? loc.charAt(0).toUpperCase() + loc.slice(1);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
