import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// Helper function to extract publication date from PDF
async function extractDateFromPdf(url) {
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
    const pdfData = await pdfParse(buffer);

    if (pdfData.info) {
      const creationDate = pdfData.info.CreationDate;
      if (creationDate) {
        const dateMatch = creationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(date.getTime())) return date;
        }
      }
    }

    if (pdfData.text) {
      const textSample = pdfData.text.substring(0, 2000);
      const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
      const monthDayYear = new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(202\\d)`, 'i');
      const match = textSample.match(monthDayYear);
      if (match) {
        const date = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
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
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegalResearchBot/1.0)' },
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

    // URL date pattern
    const urlDateMatch = url.match(/\/(\d{4})[-\/](\d{2})[-\/](\d{2})\//);
    if (urlDateMatch) {
      const date = new Date(`${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`);
      if (!isNaN(date.getTime())) return date;
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Filter results by scraping HTML for publication dates
async function filterByScrapedDate(results, startDate, endDate) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const filteredResults = [];

  for (const item of results) {
    if (item.published_date) {
      const pubMs = new Date(item.published_date).getTime();
      if (!isNaN(pubMs)) {
        if (pubMs >= startMs && pubMs <= endMs) filteredResults.push(item);
        continue;
      }
    }

    const scrapedDate = await extractDateFromUrl(item.url);
    if (scrapedDate) {
      const pubMs = scrapedDate.getTime();
      item.published_date = scrapedDate.toISOString().split('T')[0];
      if (pubMs >= startMs && pubMs <= endMs) filteredResults.push(item);
    } else {
      filteredResults.push(item);
    }
  }

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
    const { query, include_domains, start_date, end_date } = req.body;

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

    // Filter out non-content pages (cookie notices, attorney profiles, etc.)
    filteredResults = filteredResults.filter(item => {
      const url = item.link.toLowerCase();
      const title = (item.title || '').toLowerCase();

      // Exclude cookie/privacy policy pages
      if (url.includes('/cookie') || url.includes('/privacy-policy') || url.includes('/privacy-notice')) {
        return false;
      }
      // Exclude attorney profile pages
      if (url.includes('/people/') || url.includes('/attorneys/') || url.includes('/lawyer/') || url.includes('/team/')) {
        return false;
      }
      // Exclude generic pages
      if (url.includes('/about-us') || url.includes('/contact') || url.includes('/careers')) {
        return false;
      }
      // Exclude if title suggests it's just a cookie notice
      if (title.includes('cookie notice') || title.includes('cookie policy')) {
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
      results = await filterByScrapedDate(results, start_date, end_date);
    }

    console.log('[Serper] Final results:', results.length);

    res.json({ results });
  } catch (error) {
    console.error('[Serper] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
}
