export interface Job {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  source: string;
  postedDate?: string;
  salary?: string;
  jobType?: string;
}

export interface ScoredJob extends Job {
  score: number;
  matchedSkills: string[];
}

export interface CVData {
  rawText: string;
  skills: string[];
  location: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface SearchOptions {
  location?: string;
  radius?: number;
  maxResults?: number;
  jobType?: 'fulltime' | 'parttime' | 'contract' | 'internship';
}

export interface EmailOptions {
  to: string;
  jobTitle: string;
  company: string;
  jobUrl: string;
  applicantName: string;
  applicantEmail: string;
  coverLetter?: string;
  cvPath?: string;
}

export interface SearchResult {
  jobs: ScoredJob[];
  totalFound: number;
  searchedAt: string;
  location: string;
  skills: string[];
}
