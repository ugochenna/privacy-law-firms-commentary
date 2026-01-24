import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// Helper function to extract publication date from PDF
async function extractDateFromPdf(url) {
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

    const pdfData = await pdfParse(buffer);

    if (pdfData.info) {
      const creationDate = pdfData.info.CreationDate;
      if (creationDate) {
        const dateMatch = creationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }

      const modDate = pdfData.info.ModDate;
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

    if (pdfData.text) {
      const textSample = pdfData.text.substring(0, 2000);
      const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
      const monthsAbbrev = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

      // "July 23, 2025" format (supports 2000-2039)
      const monthDayYear = new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i');
      const match = textSample.match(monthDayYear);
      if (match) {
        const date = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      // "23 July 2025" format (supports 2000-2039)
      const dayMonthYear = new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i');
      const dayMonthMatch = textSample.match(dayMonthYear);
      if (dayMonthMatch) {
        const date = new Date(`${dayMonthMatch[2]} ${dayMonthMatch[1]}, ${dayMonthMatch[3]}`);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      // Abbreviated months: "Jul 23, 2025" (supports 2000-2039)
      const abbrevMonthDayYear = new RegExp(`(${monthsAbbrev})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i');
      const abbrevMatch = textSample.match(abbrevMonthDayYear);
      if (abbrevMatch) {
        const date = new Date(`${abbrevMatch[1]} ${abbrevMatch[2]}, ${abbrevMatch[3]}`);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      const isoMatch = textSample.match(/\b(20[0-3]\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/);
      if (isoMatch) {
        const date = new Date(isoMatch[0]);
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
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      try {
        const pdfData = await pdfParse(buffer);
        if (pdfData.info?.CreationDate) {
          const dateMatch = pdfData.info.CreationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
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

// Filter results by scraping HTML for publication dates - PARALLEL VERSION for Vercel
async function filterByScrapedDate(results, startDate, endDate, strictMode = false) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  console.log(`[Tavily] filterByScrapedDate: ${results.length} results, strict=${strictMode}, range=${startDate} to ${endDate}`);

  // Process all URLs in parallel instead of sequentially (fixes Vercel timeout)
  const processedResults = await Promise.all(
    results.map(async (item) => {
      // If item already has a valid published_date, check it
      if (item.published_date) {
        const pubMs = new Date(item.published_date).getTime();
        if (!isNaN(pubMs)) {
          if (pubMs >= startMs && pubMs <= endMs) {
            console.log(`[Tavily] KEEP (API date): ${item.url} - ${item.published_date}`);
            return item;
          }
          console.log(`[Tavily] SKIP (API date out of range): ${item.url} - ${item.published_date}`);
          return null; // Date exists but outside range
        }
      }

      // Try to scrape the date from the URL
      try {
        const scrapedDate = await extractDateFromUrl(item.url);
        if (scrapedDate) {
          const pubMs = scrapedDate.getTime();
          item.published_date = scrapedDate.toISOString().split('T')[0];
          item.date_source = 'scraped';
          if (pubMs >= startMs && pubMs <= endMs) {
            console.log(`[Tavily] KEEP (scraped): ${item.url} - ${item.published_date}`);
            return item;
          }
          console.log(`[Tavily] SKIP (scraped date out of range): ${item.url} - ${item.published_date}`);
          return null; // Scraped date outside range
        }
      } catch (e) {
        console.log(`[Tavily] Scrape error for ${item.url}: ${e.message}`);
      }

      // No date found - include only if not in strict mode
      if (strictMode) {
        console.log(`[Tavily] SKIP (strict mode, no date): ${item.url}`);
        return null;
      }
      console.log(`[Tavily] KEEP (no date, non-strict): ${item.url}`);
      return item;
    })
  );

  const filtered = processedResults.filter(Boolean);
  console.log(`[Tavily] filterByScrapedDate result: ${filtered.length} of ${results.length} kept`);
  return filtered;
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

    let days = 365;
    if (start_date) {
      const startMs = new Date(start_date).getTime();
      const nowMs = Date.now();
      days = Math.ceil((nowMs - startMs) / (1000 * 60 * 60 * 24));
    }

    const tavilyRequest = {
      api_key: TAVILY_API_KEY,
      query: query,
      search_depth: 'advanced',
      include_answer: false,
      include_raw_content: false,
      max_results: 10,
      days: days
    };

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

    let results = filteredResults.map(item => ({
      title: item.title,
      url: item.url,
      content: item.content || '',
      published_date: item.published_date || null
    }));

    // Final date filtering by scraping actual pages - with timeout fallback
    if (start_date && end_date) {
      const preScrapedResults = [...results]; // Keep a copy in case scraping times out
      try {
        const scrapePromise = filterByScrapedDate(results, start_date, end_date, strict_date_filter);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Scrape timeout')), 25000)
        );
        results = await Promise.race([scrapePromise, timeoutPromise]);
      } catch (e) {
        console.log('[Tavily] Scraping timed out, returning API-filtered results');
        // On timeout, return results filtered only by API dates (not strict scraped filtering)
        results = preScrapedResults;
      }
    }

    console.log('[Tavily] Final results:', results.length, strict_date_filter ? '(strict mode)' : '');

    res.json({ results });
  } catch (error) {
    console.error('[Tavily] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
}
