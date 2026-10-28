import {
  JobCompanyTarget,
  JobSourceError,
  JobSourceProvider,
  PublicJobPosting,
} from '../../services/job-discovery/job.types.js';

const USER_AGENT = 'CareerOutreachEngine/1.0 (public-careers-discovery)';
const lastRequestByHost = new Map<string, number>();
const crawlDelayByHost = new Map<string, number>();

function plainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (match?.[1] || match?.[2] || match?.[3])?.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

export class OfficialCareersProvider implements JobSourceProvider {
  readonly name = 'official_careers' as const;
  private readonly robotsRules = new Map<string, { disallowed: string[]; crawlDelayMs: number } | null>();

  constructor(private readonly companyDomain: string, private readonly careersUrl?: string | null) {}

  async discover(company: JobCompanyTarget): Promise<PublicJobPosting[]> {
    const domain = this.companyDomain.toLowerCase().replace(/^www\./, '');
    if (!domain || domain.includes('localhost')) {
      throw new JobSourceError('No verified company domain or official careers URL is available.', 'unsupported_source');
    }

    let pageUrl: URL;
    try {
      pageUrl = new URL(this.careersUrl || `https://${domain}/`);
    } catch {
      throw new JobSourceError('The supplied company careers URL is invalid.', 'unsupported_source');
    }
    if (pageUrl.protocol !== 'https:' || !this.isCompanyHost(pageUrl.hostname, domain)) {
      throw new JobSourceError('The careers page must use HTTPS on the company domain.', 'unsupported_source');
    }

    const robots = await this.fetchRobots(pageUrl.origin, pageUrl.pathname);
    if (!robots.allowed) {
      throw new JobSourceError('The company robots.txt disallows this careers-page path.', 'blocked');
    }

    const response = await this.fetchPage(pageUrl);
    if (!response.ok) {
      if (response.status === 429) throw new JobSourceError('Company careers site rate limit reached.', 'rate_limited');
      if (response.status === 401 || response.status === 403) throw new JobSourceError('Company careers page denied access.', 'blocked');
      throw new JobSourceError(`Company careers page returned HTTP ${response.status}.`, 'provider_failure');
    }
    if (!/text\/html/i.test(response.headers.get('content-type') || '')) {
      throw new JobSourceError('Company careers page did not return HTML.', 'unsupported_source');
    }

    const finalUrl = new URL(response.url || pageUrl.href);
    if (!this.isCompanyHost(finalUrl.hostname, domain)) {
      throw new JobSourceError('Company careers page redirected outside the company domain.', 'unsupported_source');
    }
    const html = await response.text();
    const directPosting = this.extractDirectPosting(html, finalUrl);
    if (directPosting) return [directPosting];

    let postings = this.extractLinkedPostings(html, finalUrl);
    if (postings.length === 0) {
      const careersPage = this.findCareersPage(html, finalUrl, domain);
      if (careersPage && careersPage.href !== finalUrl.href) {
        const careersRobots = await this.fetchRobots(careersPage.origin, careersPage.pathname);
        if (!careersRobots.allowed) {
          throw new JobSourceError('The company robots.txt disallows its careers-page path.', 'blocked');
        }
        const careersResponse = await this.fetchPage(careersPage);
        if (careersResponse.status === 429) throw new JobSourceError('Company careers site rate limit reached.', 'rate_limited');
        if (!careersResponse.ok) {
          throw new JobSourceError(`Official careers page returned HTTP ${careersResponse.status}.`, 'provider_failure');
        }
        if (!/text\/html/i.test(careersResponse.headers.get('content-type') || '')) {
          throw new JobSourceError('Official careers page did not return HTML.', 'unsupported_source');
        }
        const careersFinalUrl = new URL(careersResponse.url || careersPage.href);
        if (!this.isCompanyHost(careersFinalUrl.hostname, domain)) {
          throw new JobSourceError('Official careers page redirected outside the company domain.', 'unsupported_source');
        }
        const careersHtml = await careersResponse.text();
        const directCareersPosting = this.extractDirectPosting(careersHtml, careersFinalUrl);
        postings = directCareersPosting
          ? [directCareersPosting]
          : this.extractLinkedPostings(careersHtml, careersFinalUrl);
      }
    }

    if (postings.length === 0) {
      throw new JobSourceError(
        `No public job links were identified on ${company.name}'s official careers page.`,
        'unsupported_source'
      );
    }
    return postings;
  }

  private extractLinkedPostings(html: string, pageUrl: URL): PublicJobPosting[] {
    const postings: PublicJobPosting[] = [];
    const seen = new Set<string>();
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchorPattern)) {
      const attrs = match[1];
      const anchorText = plainText(match[2]);
      const href = attribute(attrs, 'href');
      if (!href || anchorText.length < 4 || anchorText.length > 180) continue;
      let jobUrl: URL;
      try {
        jobUrl = new URL(href, pageUrl);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(jobUrl.protocol)) continue;
      const anchorContext = html.slice(Math.max(0, (match.index || 0) - 350), Math.min(html.length, (match.index || 0) + match[0].length + 350));
      const label = `${anchorText} ${attribute(attrs, 'title') || ''}`.trim();
      const isJobPath = /\/(jobs?|openings?|positions?)(\/|[-?#]|$)/i.test(jobUrl.pathname);
      const isSpecificCareersPath = /\/careers?\/.+/i.test(jobUrl.pathname) &&
        !/^(careers?|jobs?|view jobs?|open positions?)$/i.test(label);
      const isJobLink = isJobPath || isSpecificCareersPath;
      if (!isJobLink || seen.has(jobUrl.href)) continue;
      seen.add(jobUrl.href);
      postings.push({
        title: anchorText,
        location: this.extractLocation(anchorContext),
        description: plainText(anchorContext).slice(0, 4000) || undefined,
        jobUrl: jobUrl.href,
        sourceUrl: pageUrl.href,
      });
      if (postings.length >= 100) break;
    }
    return postings;
  }

  private findCareersPage(html: string, pageUrl: URL, domain: string): URL | undefined {
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchorPattern)) {
      const href = attribute(match[1], 'href');
      if (!href) continue;
      try {
        const target = new URL(href, pageUrl);
        const label = plainText(match[2]);
        const isCareersLanding = /\/(careers?|jobs?)(\/)?$/i.test(target.pathname) ||
          /^(careers?|jobs?|join our team|work with us)$/i.test(label);
        if (
          isCareersLanding &&
          target.protocol === 'https:' &&
          this.isCompanyHost(target.hostname, domain)
        ) {
          return target;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private async fetchRobots(origin: string, path: string): Promise<{ allowed: boolean }> {
    if (this.robotsRules.has(origin)) {
      const policy = this.robotsRules.get(origin);
      return { allowed: policy !== null && !(policy?.disallowed || []).some((prefix) => path.startsWith(prefix)) };
    }
    const robotsUrl = new URL('/robots.txt', origin);
    const response = await this.fetchPage(robotsUrl);
    if (response.status === 404) {
      this.robotsRules.set(origin, { disallowed: [], crawlDelayMs: 0 });
      return { allowed: true };
    }
    if (response.status === 429) throw new JobSourceError('Company robots.txt rate limit reached.', 'rate_limited');
    if (response.status === 401 || response.status === 403) {
      this.robotsRules.set(origin, null);
      return { allowed: false };
    }
    if (!response.ok) throw new JobSourceError(`robots.txt returned HTTP ${response.status}.`, 'provider_failure');

    const lines = (await response.text()).split(/\r?\n/);
    let appliesToAll = false;
    let groupStarted = false;
    const disallowed: string[] = [];
    let crawlDelayMs = 0;
    for (const line of lines) {
      const trimmed = line.split('#')[0].trim();
      const directive = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (!directive) continue;
      const key = directive[1].toLowerCase();
      const value = directive[2].trim();
      if (key === 'user-agent') {
        if (groupStarted && disallowed.length > 0) break;
        groupStarted = true;
        appliesToAll = value === '*' || USER_AGENT.toLowerCase().includes(value.toLowerCase());
      } else if (groupStarted && appliesToAll && key === 'disallow' && value) {
        disallowed.push(value);
      } else if (groupStarted && appliesToAll && key === 'crawl-delay') {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > 0) crawlDelayMs = Math.max(crawlDelayMs, seconds * 1000);
      }
    }
    this.robotsRules.set(origin, { disallowed, crawlDelayMs });
    crawlDelayByHost.set(new URL(origin).host, crawlDelayMs);
    return { allowed: !disallowed.some((prefix) => path.startsWith(prefix)) };
  }

  private async fetchPage(url: URL): Promise<Response> {
    const host = url.host;
    const lastRequest = lastRequestByHost.get(host) || 0;
    const minimumInterval = Math.max(1000, crawlDelayByHost.get(host) || 0);
    const waitMs = Math.max(0, minimumInterval - (Date.now() - lastRequest));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestByHost.set(host, Date.now());
    try {
      return await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new JobSourceError(`Official careers request failed: ${error instanceof Error ? error.message : String(error)}`, 'provider_failure');
    }
  }

  private extractDirectPosting(html: string, pageUrl: URL): PublicJobPosting | null {
    if (!/\/(jobs?|openings?|positions?)(\/|[-?#]|$)/i.test(pageUrl.pathname)) return null;
    const title = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    if (!title) return null;
    const description = attribute(html.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i)?.[0] || '', 'content');
    return {
      title,
      description: description ? plainText(description) : undefined,
      jobUrl: pageUrl.href,
      sourceUrl: pageUrl.href,
    };
  }

  private extractLocation(context: string): string | undefined {
    const text = plainText(context);
    const location = text.match(/\b(?:Remote(?:\s*[-(][^)]+)?)|(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3},\s*[A-Z]{2})\b/);
    return location?.[0];
  }

  private isCompanyHost(hostname: string, domain: string): boolean {
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  }
}
