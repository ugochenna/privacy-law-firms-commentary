// Lazy-load pdf-parse so a missing/broken package doesn't crash the entire function
let PDFParseClass = null;
try {
  const mod = await import('pdf-parse');
  PDFParseClass = mod.PDFParse;
} catch {
  console.log('[Tavily] pdf-parse not available, PDF date extraction disabled');
}

// Helper function to extract publication date from PDF (uses pdf-parse v2 API)
async function extractDateFromPdf(url) {
  if (!PDFParseClass) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LegalResearchBot/1.0)'
      },
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
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }

      const modDate = info.ModDate;
      if (modDate) {
        const dateMatch = modDate.match(/D:(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(date.getTime())) {
            return date;
          }
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

      const isoMatch = textSample.match(/\b(20[0-3]\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/);
      if (isoMatch) {
        const date = new Date(isoMatch[0]);
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
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);  // Increased for Vercel latency

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LegalResearchBot/1.0)'
      },
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
            if (!isNaN(date.getTime())) {
              return date;
            }
          }
        }
      } catch (e) {
        // PDF parse failed
      }
      return null;
    }

    const html = await response.text();

    const metaPatterns = [
      /meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
      /meta[^>]*content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
      /meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i,
      /meta[^>]*content=["']([^"']+)["'][^>]*name=["']date["']/i,
      /meta[^>]*name=["']publish[_-]?date["'][^>]*content=["']([^"']+)["']/i,
      /meta[^>]*name=["']DC\.date["'][^>]*content=["']([^"']+)["']/i,
    ];

    for (const pattern of metaPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const date = new Date(match[1]);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const script of jsonLdMatch) {
        try {
          const jsonContent = script.replace(/<script[^>]*>|<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          const dateStr = data.datePublished || data.dateCreated ||
                         (data['@graph'] && data['@graph'].find(i => i.datePublished)?.datePublished);
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return date;
            }
          }
        } catch (e) {
          // JSON parse failed
        }
      }
    }

    const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
    if (timeMatch && timeMatch[1]) {
      const date = new Date(timeMatch[1]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // URL date patterns
    // Try YYYY/MM/DD first
    const urlDateMatch = url.match(/\/(\d{4})[-\/](\d{2})[-\/](\d{2})\//);
    if (urlDateMatch) {
      const date = new Date(`${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    // Try YYYY/MM (without day) - common in law firm URLs like /2018/05/article-name
    const urlYearMonthMatch = url.match(/\/(\d{4})\/(\d{2})\/[a-zA-Z]/);
    if (urlYearMonthMatch) {
      const date = new Date(`${urlYearMonthMatch[1]}-${urlYearMonthMatch[2]}-15`);
      if (!isNaN(date.getTime())) {
        return date;
      }
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
        if (!isNaN(date.getTime())) {
          return date;
        }
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
          console.log(`[Tavily] Filtered by API date: ${item.url} (${item.published_date} outside range)`);
        }
        continue;
      }
    }
    // No valid date — needs scraping
    needsScraping.push(item);
  }

  console.log(`[Tavily] ${filteredResults.length} items with API dates, ${needsScraping.length} need scraping`);

  // Phase 2: Scrape URLs in parallel (max 5 concurrent) with overall 25s timeout
  if (needsScraping.length > 0) {
    const SCRAPE_CONCURRENCY = 5;
    const OVERALL_TIMEOUT_MS = 25000;
    const scrapeStartTime = Date.now();

    for (let i = 0; i < needsScraping.length; i += SCRAPE_CONCURRENCY) {
      // Check overall timeout
      if (Date.now() - scrapeStartTime > OVERALL_TIMEOUT_MS) {
        console.log(`[Tavily] Overall timeout reached after ${i} URLs. Including remaining ${needsScraping.length - i} items without date check.`);
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
            console.log(`[Tavily] Filtered: ${item.url} (date: ${item.published_date} outside range)`);
          }
        } else {
          // No date found - include unless strict mode
          if (!strictMode) {
            filteredResults.push(item);
          } else {
            console.log(`[Tavily] Excluded (strict mode): ${item.url} (no date found)`);
          }
        }
      }
    }
  }

  console.log(`[Tavily] Final: ${filteredResults.length} results after date filtering (strict: ${strictMode})`);
  return filteredResults;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: 'TAVILY_API_KEY not configured', results: [] });
  }

  try {
    const { query, include_domains, start_date, end_date, strict_date_filter } = req.body;

    // Debug logging for Vercel
    console.log('[Tavily] Request received:', { query, include_domains, start_date, end_date, strict_date_filter });

    const tavilyRequest = {
      api_key: TAVILY_API_KEY,
      query: query,
      search_depth: 'advanced',
      include_answer: false,
      include_raw_content: false,
      max_results: 20
    };

    // Use start_date/end_date params (newer Tavily API) for precise date filtering
    if (start_date && end_date) {
      tavilyRequest.start_date = start_date;
      tavilyRequest.end_date = end_date;
      console.log('[Tavily] Using start_date/end_date:', start_date, 'to', end_date);
    }

    if (include_domains && include_domains.length > 0) {
      tavilyRequest.include_domains = include_domains;
    }

    console.log('[Tavily] Calling Tavily API with:', JSON.stringify(tavilyRequest, null, 2));

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tavilyRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Tavily] API error response:', errorText);
      throw new Error(`Tavily API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[Tavily] API returned:', data.results?.length || 0, 'results');

    let filteredResults = data.results || [];

    if (start_date && end_date) {
      const startMs = new Date(start_date).getTime();
      const endMs = new Date(end_date).getTime();

      filteredResults = filteredResults.filter(item => {
        if (!item.published_date) return true;
        const pubMs = new Date(item.published_date).getTime();
        return pubMs >= startMs && pubMs <= endMs;
      });
    }

    // Try to extract dates from content text and URL when Tavily doesn't provide published_date
    let results = filteredResults.map(item => {
      let pubDate = item.published_date || null;

      if (!pubDate) {
        // Try extracting date from URL path (e.g., /2025/11/article-name)
        const urlDateMatch = item.url.match(/\/(\d{4})\/(\d{2})(?:\/(\d{2}))?\/[a-zA-Z]/);
        if (urlDateMatch) {
          const year = urlDateMatch[1];
          const month = urlDateMatch[2];
          const day = urlDateMatch[3] || '15';
          const d = new Date(`${year}-${month}-${day}`);
          if (!isNaN(d.getTime())) {
            pubDate = d.toISOString().split('T')[0];
            console.log(`[Tavily] Extracted date from URL: ${pubDate} for ${item.url}`);
          }
        }
      }

      if (!pubDate && item.content) {
        // Try extracting date from content snippet
        const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
        const monthsAbbrev = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
        const contentPatterns = [
          new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
          new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i'),
          new RegExp(`(${monthsAbbrev})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
          /\b(20[0-3]\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/,
        ];
        for (const pattern of contentPatterns) {
          const match = item.content.match(pattern);
          if (match) {
            const d = new Date(match[0]);
            if (!isNaN(d.getTime())) {
              pubDate = d.toISOString().split('T')[0];
              console.log(`[Tavily] Extracted date from content: ${pubDate} for ${item.url}`);
              break;
            }
          }
        }
      }

      return {
        title: item.title,
        url: item.url,
        content: item.content || '',
        published_date: pubDate
      };
    });

    console.log(`[Tavily] After content/URL date extraction: ${results.filter(r => r.published_date).length}/${results.length} have dates`);

    // Final date filtering by scraping actual pages
    if (start_date && end_date) {
      const beforeScrape = results.length;
      results = await filterByScrapedDate(results, start_date, end_date, strict_date_filter);
      console.log(`[Tavily] Scrape filtering: ${beforeScrape} -> ${results.length} results`);
    }

    console.log('[Tavily] Final results:', results.length, strict_date_filter ? '(strict mode)' : '');

    res.json({ results });
  } catch (error) {
    console.error('[Tavily] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
}
