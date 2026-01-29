/**
 * Date Filtering Module for Search APIs (Serper & Tavily)
 *
 * This module provides date extraction and filtering for search results.
 * It handles HTML pages, PDFs, and URL-based date extraction.
 *
 * INSTALLATION:
 * npm install pdf-parse
 *
 * USAGE (ESM):
 * import { searchWithSerper, searchWithTavily, filterByScrapedDate } from './date-filter-module.js';
 *
 * const results = await searchWithSerper({
 *   query: 'privacy law regulation',
 *   apiKey: 'your-serper-api-key',
 *   domains: ['lawfirm.com'],
 *   startDate: '2025-10-01',
 *   endDate: '2026-01-12'
 * });
 */

import { PDFParse } from 'pdf-parse';

// ============================================================================
// DATE EXTRACTION FROM PDF
// ============================================================================

/**
 * Extract publication date from a PDF URL
 * Tries: PDF metadata (CreationDate, ModDate), then text content patterns
 *
 * @param {string} url - URL of the PDF to extract date from
 * @returns {Promise<Date|null>} - Extracted date or null
 */
export async function extractDateFromPdf(url) {
  try {
    // pdf-parse v2 API: pass URL directly, it handles fetching
    const parser = new PDFParse({ url });

    // Get metadata first (fast, no text extraction needed)
    const infoResult = await parser.getInfo();

    if (infoResult.info) {
      // Try CreationDate first (usually more accurate for publication)
      const creationDate = infoResult.info.CreationDate;
      if (creationDate) {
        const dateMatch = creationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(date.getTime())) {
            console.log(`[PDF] Found creation date: ${date.toISOString().split('T')[0]} for ${url}`);
            return date;
          }
        }
      }

      // Try ModDate as fallback
      const modDate = infoResult.info.ModDate;
      if (modDate) {
        const dateMatch = modDate.match(/D:(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(date.getTime())) {
            console.log(`[PDF] Found mod date: ${date.toISOString().split('T')[0]} for ${url}`);
            return date;
          }
        }
      }
    }

    // Try to find date in PDF text content (first page usually has date)
    const textResult = await parser.getText({ maxPages: 1 });
    if (textResult.text) {
      const textSample = textResult.text.substring(0, 2000);
      const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
      const monthsAbbrev = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

      // "July 23, 2025" format (supports 2000-2039)
      const monthDayYear = new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i');
      const match = textSample.match(monthDayYear);
      if (match) {
        const date = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
        if (!isNaN(date.getTime())) {
          console.log(`[PDF] Found text date: ${date.toISOString().split('T')[0]} for ${url}`);
          return date;
        }
      }

      // "23 July 2025" format (supports 2000-2039)
      const dayMonthYear = new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i');
      const dayMonthMatch = textSample.match(dayMonthYear);
      if (dayMonthMatch) {
        const date = new Date(`${dayMonthMatch[2]} ${dayMonthMatch[1]}, ${dayMonthMatch[3]}`);
        if (!isNaN(date.getTime())) {
          console.log(`[PDF] Found text date: ${date.toISOString().split('T')[0]} for ${url}`);
          return date;
        }
      }

      // Abbreviated months: "Jul 23, 2025" or "23 Jul 2025" (supports 2000-2039)
      const abbrevMonthDayYear = new RegExp(`(${monthsAbbrev})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i');
      const abbrevMatch = textSample.match(abbrevMonthDayYear);
      if (abbrevMatch) {
        const date = new Date(`${abbrevMatch[1]} ${abbrevMatch[2]}, ${abbrevMatch[3]}`);
        if (!isNaN(date.getTime())) {
          console.log(`[PDF] Found text date: ${date.toISOString().split('T')[0]} for ${url}`);
          return date;
        }
      }

      // ISO format (supports 2000-2039)
      const isoMatch = textSample.match(/\b(20[0-3]\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/);
      if (isoMatch) {
        const date = new Date(isoMatch[0]);
        if (!isNaN(date.getTime())) {
          console.log(`[PDF] Found ISO date: ${date.toISOString().split('T')[0]} for ${url}`);
          return date;
        }
      }
    }

    return null;
  } catch (error) {
    console.log(`[PDF] Error extracting date from ${url}: ${error.message}`);
    return null;
  }
}

// ============================================================================
// DATE EXTRACTION FROM URL (HTML or PDF)
// ============================================================================

/**
 * Extract publication date from a URL (handles both HTML pages and PDFs)
 *
 * Extraction order:
 * 1. For PDFs: metadata, text content, URL path
 * 2. For HTML: meta tags, JSON-LD, time elements, URL patterns, text patterns, CSS classes
 *
 * @param {string} url - URL to extract date from
 * @returns {Promise<Date|null>} - Extracted date or null
 */
export async function extractDateFromUrl(url) {
  // Check if this is obviously a PDF URL
  const isPdfUrl = url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf?');
  if (isPdfUrl) {
    const pdfDate = await extractDateFromPdf(url);
    if (pdfDate) return pdfDate;

    // If PDF extraction failed, try URL-based date extraction
    // Look for /YYYY/MM/ or /YYYY/MM/DD/ patterns in the URL
    const urlDateMatch = url.match(/\/(\d{4})\/(\d{2})(?:\/(\d{2}))?[\/\-]/);
    if (urlDateMatch) {
      const year = urlDateMatch[1];
      const month = urlDateMatch[2];
      const day = urlDateMatch[3] || '15'; // Default to mid-month if no day
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        console.log(`[URL] Found date in PDF URL path: ${date.toISOString().split('T')[0]} for ${url}`);
        return date;
      }
    }
    return null; // PDF URL but no date found
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DateExtractor/1.0)'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    // Check Content-Type for PDF (handles PDFs without .pdf extension)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      try {
        // Use the dedicated PDF extractor (which uses pdf-parse v2 API)
        const pdfDate = await extractDateFromPdf(url);
        if (pdfDate) return pdfDate;
      } catch (e) {
        console.log(`[PDF] Parse error: ${e.message}`);
      }
      return null;
    }

    const html = await response.text();

    // Try multiple date extraction methods

    // 1. Meta tags (most reliable)
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

    // 2. JSON-LD schema.org data
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
          // JSON parse failed, continue
        }
      }
    }

    // 3. Time element with datetime attribute
    const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
    if (timeMatch && timeMatch[1]) {
      const date = new Date(timeMatch[1]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // 4. Common date patterns in URL
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
      const date = new Date(`${urlYearMonthMatch[1]}-${urlYearMonthMatch[2]}-15`); // Default to mid-month
      if (!isNaN(date.getTime())) {
        console.log(`[URL] Found year/month in URL: ${date.toISOString().split('T')[0]} for ${url}`);
        return date;
      }
    }

    // 5. Text-based dates in HTML (for sites that display dates as plain text)
    const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
    const monthsAbbrev = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
    const textDatePatterns = [
      // "July 23, 2025" or "July 23 2025" (supports 2000-2039)
      new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
      // "23 July 2025" (supports 2000-2039)
      new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i'),
      // "Jul 23, 2025" or "Jul 23 2025" - abbreviated months (supports 2000-2039)
      new RegExp(`(${monthsAbbrev})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
      // "23 Jul 2025" or "23-Jul-2025" - abbreviated months (supports 2000-2039)
      new RegExp(`(\\d{1,2})[-\\s](${monthsAbbrev})[-\\s](20[0-3]\\d)`, 'i'),
      // "2025-07-23" or "2025/07/23" in visible text (supports 2000-2039)
      /\b(20[0-3]\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/,
      // "2025.07.23" dot-separated format (supports 2000-2039)
      /\b(20[0-3]\d)\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\b/,
      // "07/23/2025" US format (supports 2000-2039)
      /(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(20[0-3]\d)/,
      // "23/07/2025" European DD/MM/YYYY format (supports 2000-2039)
      /(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20[0-3]\d)/,
      // "Last review date: 31 December 2024" or "Published: January 15, 2025" - prefixed patterns
      new RegExp(`(?:date|published|posted|updated|review)[:\\s]+(?:(\\d{1,2})\\s+)?(${months})\\s+(\\d{1,2}),?\\s+(20[0-3]\\d)`, 'i'),
      new RegExp(`(?:date|published|posted|updated|review)[:\\s]+(\\d{1,2})\\s+(${months})\\s+(20[0-3]\\d)`, 'i'),
    ];

    for (const pattern of textDatePatterns) {
      const match = html.match(pattern);
      if (match) {
        let dateStr;
        const patternStr = pattern.source;

        // Check pattern type based on its structure
        if (patternStr.startsWith(`(${months})`) || patternStr.startsWith(`(${monthsAbbrev})`)) {
          // "Month Day, Year" or "Jul 23, 2025" format
          dateStr = `${match[1]} ${match[2]}, ${match[3]}`;
        } else if (patternStr.includes('date|published|posted|updated|review')) {
          // Prefixed patterns like "Last review date: 31 December 2024"
          // These have variable capture groups
          if (match[4]) {
            // Format: prefix + day + month + year (4 groups)
            dateStr = `${match[2]} ${match[1] || match[3]}, ${match[4]}`;
          } else {
            // Format: prefix + day + month + year (3 groups)
            dateStr = `${match[2]} ${match[1]}, ${match[3]}`;
          }
        } else if (patternStr.includes(`(${months})`) || patternStr.includes(`(${monthsAbbrev})`)) {
          // "Day Month Year" or "23-Jul-2025" format
          dateStr = `${match[2]} ${match[1]}, ${match[3]}`;
        } else if (patternStr.includes('\\.')) {
          // Dot-separated: 2025.07.23
          dateStr = `${match[1]}-${match[2]}-${match[3]}`;
        } else if (match[0].includes('/') && match[3]) {
          // Slash formats: MM/DD/YYYY or DD/MM/YYYY
          // Try US format first (MM/DD/YYYY)
          const usDate = new Date(`${match[3]}-${match[1]}-${match[2]}`);
          if (!isNaN(usDate.getTime()) && usDate.getDate() === parseInt(match[2])) {
            return usDate;
          }
          // Try European format (DD/MM/YYYY)
          dateStr = `${match[3]}-${match[2]}-${match[1]}`;
        } else {
          // ISO format (YYYY-MM-DD or YYYY/MM/DD)
          dateStr = match[0];
        }
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // 6. Look for date in common CSS class patterns (date, published, posted)
    const dateClassPatterns = [
      /<[^>]*class=["'][^"']*(?:date|published|posted|timestamp)[^"']*["'][^>]*>([^<]+)</gi,
      /<span[^>]*>(?:Published|Posted|Date)[:\s]*([^<]+)</gi,
    ];

    for (const pattern of dateClassPatterns) {
      const matches = [...html.matchAll(pattern)];
      for (const match of matches) {
        const potentialDate = match[1].trim();
        const date = new Date(potentialDate);
        if (!isNaN(date.getTime()) && date.getFullYear() >= 2000) {
          return date;
        }
      }
    }

    return null;
  } catch (error) {
    // Fetch failed (timeout, network error, etc.)
    return null;
  }
}

// ============================================================================
// RESULT FILTERING BY SCRAPED DATE
// ============================================================================

/**
 * Filter search results by scraping HTML/PDF for publication dates
 *
 * @param {Array} results - Array of search results with {title, url, content, published_date?}
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<Array>} - Filtered results within date range
 */
export async function filterByScrapedDate(results, startDate, endDate) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  const filteredResults = [];
  let scrapedCount = 0;
  let filteredCount = 0;

  for (const item of results) {
    // If we already have a valid date from the API, use it
    if (item.published_date) {
      const pubMs = new Date(item.published_date).getTime();
      if (!isNaN(pubMs)) {
        if (pubMs >= startMs && pubMs <= endMs) {
          filteredResults.push(item);
        } else {
          filteredCount++;
        }
        continue;
      }
    }

    // Otherwise, try to scrape the date from the page (HTML or PDF)
    const scrapedDate = await extractDateFromUrl(item.url);
    scrapedCount++;

    if (scrapedDate) {
      const pubMs = scrapedDate.getTime();
      item.published_date = scrapedDate.toISOString().split('T')[0]; // Add scraped date
      item.date_source = 'scraped';

      if (pubMs >= startMs && pubMs <= endMs) {
        filteredResults.push(item);
      } else {
        console.log(`[Scraper] Filtered: ${item.url} (date: ${item.published_date})`);
        filteredCount++;
      }
    } else {
      // No date found, keep the result (benefit of the doubt)
      filteredResults.push(item);
    }
  }

  if (scrapedCount > 0) {
    console.log(`[Scraper] Scraped ${scrapedCount} URLs, filtered ${filteredCount} outside date range`);
  }

  return filteredResults;
}

// ============================================================================
// SERPER (GOOGLE) SEARCH WITH DATE FILTERING
// ============================================================================

/**
 * Search using Serper (Google) API with date filtering
 *
 * @param {Object} options
 * @param {string} options.query - Search query
 * @param {string} options.apiKey - Serper API key
 * @param {string[]} [options.domains] - Optional domains to restrict search to
 * @param {string} [options.startDate] - Start date in YYYY-MM-DD format
 * @param {string} [options.endDate] - End date in YYYY-MM-DD format
 * @param {number} [options.numResults=10] - Number of results to return
 * @returns {Promise<Array>} - Filtered search results
 */
export async function searchWithSerper({ query, apiKey, domains, startDate, endDate, numResults = 10 }) {
  console.log('[Serper] Search request');
  console.log('[Serper] Query:', query);
  if (startDate && endDate) {
    console.log('[Serper] Date range:', startDate, 'to', endDate);
  }

  // Build site-restricted query if domains provided
  let searchQuery = query;
  if (domains && domains.length > 0) {
    const siteFilter = domains.slice(0, 5).map(d => `site:${d}`).join(' OR ');
    searchQuery = `(${siteFilter}) ${query}`;
  }

  // Build Serper request with date filtering
  const serperRequest = {
    q: searchQuery,
    num: numResults
  };

  // Add date range filter using tbs parameter (Google's time-based search)
  // Format: cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY
  if (startDate && endDate) {
    const startParts = startDate.split('-'); // YYYY-MM-DD
    const endParts = endDate.split('-');
    const startFormatted = `${startParts[1]}/${startParts[2]}/${startParts[0]}`; // MM/DD/YYYY
    const endFormatted = `${endParts[1]}/${endParts[2]}/${endParts[0]}`;
    serperRequest.tbs = `cdr:1,cd_min:${startFormatted},cd_max:${endFormatted}`;
    console.log('[Serper] Date filter:', serperRequest.tbs);
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(serperRequest)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Serper API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // First filter: by API-provided dates
  let filteredResults = data.organic || [];

  if (startDate && endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    const beforeFilter = filteredResults.length;
    filteredResults = filteredResults.filter(item => {
      if (!item.date) {
        return true; // Keep results without a date
      }
      const pubDate = new Date(item.date);
      if (isNaN(pubDate.getTime())) {
        return true; // Can't parse date, keep it
      }
      const pubMs = pubDate.getTime();
      return pubMs >= startMs && pubMs <= endMs;
    });

    const filtered = beforeFilter - filteredResults.length;
    if (filtered > 0) {
      console.log(`[Serper] API date filter removed ${filtered} results`);
    }
  }

  // Transform to standard format
  let results = filteredResults.map(item => ({
    title: item.title,
    url: item.link,
    content: item.snippet || '',
    published_date: item.date || null
  }));

  // Second filter: scrape HTML/PDF for actual publication dates
  if (startDate && endDate) {
    console.log('[Serper] Applying HTML/PDF date scraping filter...');
    results = await filterByScrapedDate(results, startDate, endDate);
  }

  console.log('[Serper] Final results:', results.length);
  return results;
}

// ============================================================================
// TAVILY SEARCH WITH DATE FILTERING
// ============================================================================

/**
 * Search using Tavily API with date filtering
 *
 * @param {Object} options
 * @param {string} options.query - Search query
 * @param {string} options.apiKey - Tavily API key
 * @param {string[]} [options.domains] - Optional domains to restrict search to
 * @param {string} [options.startDate] - Start date in YYYY-MM-DD format
 * @param {string} [options.endDate] - End date in YYYY-MM-DD format
 * @param {number} [options.numResults=5] - Number of results to return
 * @returns {Promise<Array>} - Filtered search results
 */
export async function searchWithTavily({ query, apiKey, domains, startDate, endDate, numResults = 5 }) {
  console.log('[Tavily] Search request');
  console.log('[Tavily] Query:', query);
  if (startDate && endDate) {
    console.log('[Tavily] Date range:', startDate, 'to', endDate);
  }

  const tavilyRequest = {
    api_key: apiKey,
    query: query,
    search_depth: 'advanced',
    include_answer: false,
    include_raw_content: false,
    max_results: numResults
  };

  // Use start_date/end_date params (newer Tavily API) for precise date filtering
  if (startDate && endDate) {
    tavilyRequest.start_date = startDate;
    tavilyRequest.end_date = endDate;
    console.log('[Tavily] Using start_date/end_date:', startDate, 'to', endDate);
  }

  // Add domain filtering if provided
  if (domains && domains.length > 0) {
    tavilyRequest.include_domains = domains;
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(tavilyRequest)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // First filter: by API-provided dates
  let filteredResults = data.results || [];

  if (startDate && endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    const beforeFilter = filteredResults.length;
    filteredResults = filteredResults.filter(item => {
      if (!item.published_date) {
        return true; // Keep results without a date
      }
      const pubMs = new Date(item.published_date).getTime();
      return pubMs >= startMs && pubMs <= endMs;
    });

    const filtered = beforeFilter - filteredResults.length;
    if (filtered > 0) {
      console.log(`[Tavily] API date filter removed ${filtered} results`);
    }
  }

  // Transform to standard format
  let results = filteredResults.map(item => ({
    title: item.title,
    url: item.url,
    content: item.content || '',
    published_date: item.published_date || null
  }));

  // Second filter: scrape HTML/PDF for actual publication dates
  if (startDate && endDate) {
    console.log('[Tavily] Applying HTML/PDF date scraping filter...');
    results = await filterByScrapedDate(results, startDate, endDate);
  }

  console.log('[Tavily] Final results:', results.length);
  return results;
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

/*
// Example: Search with Serper
const serperResults = await searchWithSerper({
  query: 'privacy law regulation 2025',
  apiKey: 'your-serper-api-key',
  domains: ['lawfirm.com', 'legalsite.com'],
  startDate: '2025-10-01',
  endDate: '2026-01-12',
  numResults: 10
});

// Example: Search with Tavily
const tavilyResults = await searchWithTavily({
  query: 'HIPAA compliance healthcare',
  apiKey: 'your-tavily-api-key',
  domains: ['healthlaw.com'],
  startDate: '2025-06-01',
  endDate: '2025-12-31',
  numResults: 5
});

// Example: Filter existing results
const myResults = [
  { title: 'Article 1', url: 'https://example.com/article1', content: '...' },
  { title: 'Article 2', url: 'https://example.com/article2', content: '...' }
];
const filtered = await filterByScrapedDate(myResults, '2025-01-01', '2025-12-31');
*/
