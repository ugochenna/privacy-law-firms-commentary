// Lazy-load pdf-parse so a missing/broken package doesn't crash the entire function
let PDFParseClass = null;
try {
  const mod = await import('pdf-parse');
  PDFParseClass = mod.PDFParse;
} catch {
  console.log('[Serper] pdf-parse not available, PDF date extraction disabled');
}

// Helper function to extract publication date from PDF (uses pdf-parse v2 API)
async function extractDateFromPdf(url) {
  if (!PDFParseClass) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalResearchBot/1.0)' },
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const parser = new PDFParseClass({ data: buffer });
    const info = await parser.getInfo();

    if (info) {
      const creationDate = info.CreationDate;
      if (creationDate) {
        const dateMatch = creationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(date.getTime())) return date;
        }
      }
    }

    const textResult = await parser.getText({ maxPages: 1 });
    const textSample = (textResult?.text || '').substring(0, 2000);

    if (textSample) {
      const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
      const monthsAbbrev = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

      const monthDayYear = new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i');
      const match = textSample.match(monthDayYear);
      if (match) {
        const date = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
        if (!isNaN(date.getTime())) return date;
      }

      const dayMonthYear = new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i');
      const dayMonthMatch = textSample.match(dayMonthYear);
      if (dayMonthMatch) {
        const date = new Date(`${dayMonthMatch[2]} ${dayMonthMatch[1]}, ${dayMonthMatch[3]}`);
        if (!isNaN(date.getTime())) return date;
      }

      const abbrevMonthDayYear = new RegExp(`(${monthsAbbrev})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i');
      const abbrevMatch = textSample.match(abbrevMonthDayYear);
      if (abbrevMatch) {
        const date = new Date(`${abbrevMatch[1]} ${abbrevMatch[2]}, ${abbrevMatch[3]}`);
        if (!isNaN(date.getTime())) return date;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Helper function to extract publication date from HTML or PDF
async function extractDateFromUrl(url) {
  const isPdfUrl = url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf?');
  if (isPdfUrl) {
    const pdfDate = await extractDateFromPdf(url);
    if (pdfDate) return pdfDate;
    const urlDateMatch = url.match(/\/(\d{4})\/(\d{2})(?:\/(\d{2}))?[\/\-]/);
    if (urlDateMatch) {
      const year = urlDateMatch[1];
      const month = urlDateMatch[2];
      const day = urlDateMatch[3] || '15';
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) return date;
    }
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);  // Increased for Vercel latency

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalResearchBot/1.0)' },
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      if (!PDFParseClass) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      try {
        const parser = new PDFParseClass({ data: buffer });
        const info = await parser.getInfo();
        if (info?.CreationDate) {
          const dateMatch = info.CreationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
          if (dateMatch) {
            const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
            if (!isNaN(date.getTime())) return date;
          }
        }
      } catch (e) {}
      return null;
    }

    const html = await response.text();

    // Meta tags
    const metaPatterns = [
      /meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
      /meta[^>]*content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
      /meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i,
    ];

    for (const pattern of metaPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const date = new Date(match[1]);
        if (!isNaN(date.getTime())) return date;
      }
    }

    // JSON-LD
    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const script of jsonLdMatch) {
        try {
          const jsonContent = script.replace(/<script[^>]*>|<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          const dateStr = data.datePublished || data.dateCreated;
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) return date;
          }
        } catch (e) {}
      }
    }

    // Time element
    const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
    if (timeMatch && timeMatch[1]) {
      const date = new Date(timeMatch[1]);
      if (!isNaN(date.getTime())) return date;
    }

    // URL date patterns
    // Try YYYY/MM/DD first
    const urlDateMatch = url.match(/\/(\d{4})[-\/](\d{2})[-\/](\d{2})\//);
    if (urlDateMatch) {
      const date = new Date(`${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`);
      if (!isNaN(date.getTime())) return date;
    }
    // Try YYYY/MM (without day) - common in law firm URLs like /2018/05/article-name
    const urlYearMonthMatch = url.match(/\/(\d{4})\/(\d{2})\/[a-zA-Z]/);
    if (urlYearMonthMatch) {
      const date = new Date(`${urlYearMonthMatch[1]}-${urlYearMonthMatch[2]}-15`);
      if (!isNaN(date.getTime())) return date;
    }

    // Text-based dates in HTML
    const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
    const monthsAbbrev = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
    const textDatePatterns = [
      new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
      new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i'),
      new RegExp(`(${monthsAbbrev})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
      new RegExp(`(\\d{1,2})[-\\s](${monthsAbbrev})[-\\s](20[0-3]\\d)`, 'i'),
      /\b(20[0-3]\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/,
    ];

    for (const pattern of textDatePatterns) {
      const match = html.match(pattern);
      if (match) {
        let dateStr;
        const patternStr = pattern.source;
        if (patternStr.startsWith(`(${months})`) || patternStr.startsWith(`(${monthsAbbrev})`)) {
          dateStr = `${match[1]} ${match[2]}, ${match[3]}`;
        } else if (patternStr.includes(`(${months})`) || patternStr.includes(`(${monthsAbbrev})`)) {
          dateStr = `${match[2]} ${match[1]}, ${match[3]}`;
        } else {
          dateStr = match[0];
        }
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Filter results by scraping HTML for publication dates - BATCHED PARALLEL VERSION
async function filterByScrapedDate(results, startDate, endDate, strictMode = false) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const filteredResults = [];
  const needsScraping = [];

  // Phase 1: Quickly process items that already have dates (no network calls)
  for (const item of results) {
    if (item.published_date) {
      const pubMs = new Date(item.published_date).getTime();
      if (!isNaN(pubMs)) {
        if (pubMs >= startMs && pubMs <= endMs) {
          filteredResults.push(item);
        } else {
          console.log(`[Serper] Filtered by API date: ${item.url} (${item.published_date} outside range)`);
        }
        continue;
      }
    }
    // No valid date — needs scraping
    needsScraping.push(item);
  }

  console.log(`[Serper] ${filteredResults.length} items with API dates, ${needsScraping.length} need scraping`);

  // Phase 2: Scrape URLs in parallel (max 5 concurrent) with overall 25s timeout
  if (needsScraping.length > 0) {
    const SCRAPE_CONCURRENCY = 5;
    const OVERALL_TIMEOUT_MS = 25000;
    const scrapeStartTime = Date.now();

    for (let i = 0; i < needsScraping.length; i += SCRAPE_CONCURRENCY) {
      // Check overall timeout
      if (Date.now() - scrapeStartTime > OVERALL_TIMEOUT_MS) {
        console.log(`[Serper] Overall timeout reached after ${i} URLs. Including remaining ${needsScraping.length - i} items without date check.`);
        for (let j = i; j < needsScraping.length; j++) {
          if (!strictMode) {
            filteredResults.push(needsScraping[j]);
          }
        }
        break;
      }

      const batch = needsScraping.slice(i, i + SCRAPE_CONCURRENCY);
      const remainingTime = OVERALL_TIMEOUT_MS - (Date.now() - scrapeStartTime);

      const batchPromises = batch.map(async (item) => {
        try {
          const scrapedDate = await Promise.race([
            extractDateFromUrl(item.url),
            new Promise((_, reject) => setTimeout(() => reject(new Error('scrape timeout')), Math.min(8000, remainingTime)))
          ]);
          return { item, scrapedDate };
        } catch {
          return { item, scrapedDate: null };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const { item, scrapedDate } of batchResults) {
        if (scrapedDate) {
          const pubMs = scrapedDate.getTime();
          item.published_date = scrapedDate.toISOString().split('T')[0];
          item.date_source = 'scraped';
          if (pubMs >= startMs && pubMs <= endMs) {
            filteredResults.push(item);
          } else {
            console.log(`[Serper] Filtered: ${item.url} (date: ${item.published_date} outside range)`);
          }
        } else {
          // No date found - include unless strict mode
          if (!strictMode) {
            filteredResults.push(item);
          } else {
            console.log(`[Serper] Excluded (strict mode): ${item.url} (no date found)`);
          }
        }
      }
    }
  }

  console.log(`[Serper] Final: ${filteredResults.length} results after date filtering (strict: ${strictMode})`);
  return filteredResults;
}

// Serper search endpoint - IMPROVED v2
// Changes: 1) Increased results to 20, 2) Filter out non-content pages, 3) Removed tbs date filter
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SERPER_API_KEY = process.env.SERPER_API_KEY;

  if (!SERPER_API_KEY) {
    return res.status(500).json({ error: 'SERPER_API_KEY not configured', results: [] });
  }

  try {
    const { query, include_domains, start_date, end_date, strict_date_filter } = req.body;

    // Debug logging for Vercel
    console.log('[Serper] Request received:', { query, include_domains, start_date, end_date, strict_date_filter });

    // Build query with site: operator
    let searchQuery = query;
    if (include_domains && include_domains.length > 0) {
      searchQuery = `site:${include_domains[0]} ${query}`;
    }

    // Increase results from 10 to 20 for better coverage
    // NOTE: Removed tbs date filter - Google's date indexing is often inaccurate
    // We rely on post-processing date filtering instead (filterByScrapedDate)
    const serperRequest = { q: searchQuery, num: 20 };

    console.log('[Serper] Query:', searchQuery);

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(serperRequest)
    });

    if (!response.ok) throw new Error(`Serper API error: ${response.status}`);

    const data = await response.json();
    let filteredResults = data.organic || [];

    console.log('[Serper] Raw results:', filteredResults.length);

    // Filter out non-content pages — only exclude standalone policy/profile pages,
    // not articles that happen to mention privacy/cookies in their URL
    filteredResults = filteredResults.filter(item => {
      const title = (item.title || '').toLowerCase();
      const path = new URL(item.link).pathname.toLowerCase();

      // Exclude standalone cookie/privacy policy pages (path ends with these)
      if (path.endsWith('/cookie-policy') || path.endsWith('/cookie-notice') ||
          path.endsWith('/privacy-policy') || path.endsWith('/privacy-notice') ||
          path.endsWith('/cookies')) {
        console.log(`[Serper] Filtered (policy page): ${item.link}`);
        return false;
      }
      // Exclude generic non-content pages
      if (path.endsWith('/about-us') || path.endsWith('/contact') || path.endsWith('/careers')) {
        console.log(`[Serper] Filtered (generic page): ${item.link}`);
        return false;
      }
      // Exclude if title is clearly just a cookie/privacy notice (not an article about it)
      if (title === 'cookie notice' || title === 'cookie policy' || title === 'privacy policy') {
        console.log(`[Serper] Filtered (policy title): ${item.link}`);
        return false;
      }
      return true;
    });

    console.log('[Serper] After content filter:', filteredResults.length);

    // Apply date filtering from API response dates
    if (start_date && end_date) {
      const startMs = new Date(start_date).getTime();
      const endMs = new Date(end_date).getTime();
      filteredResults = filteredResults.filter(item => {
        if (!item.date) return true; // Keep items without dates for scraping later
        const pubDate = new Date(item.date);
        if (isNaN(pubDate.getTime())) return true;
        return pubDate.getTime() >= startMs && pubDate.getTime() <= endMs;
      });
    }

    let results = filteredResults.map(item => ({
      title: item.title,
      url: item.link,
      content: item.snippet || '',
      published_date: item.date || null
    }));

    // Final date filtering by scraping actual pages
    if (start_date && end_date) {
      const beforeScrape = results.length;
      results = await filterByScrapedDate(results, start_date, end_date, strict_date_filter);
      console.log(`[Serper] Scrape filtering: ${beforeScrape} -> ${results.length} results`);
    }

    console.log('[Serper] Final results:', results.length, strict_date_filter ? '(strict mode)' : '');

    res.json({ results });
  } catch (error) {
    console.error('[Serper] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
}
