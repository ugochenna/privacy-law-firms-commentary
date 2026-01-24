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

      const monthDayYear = new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(202\\d)`, 'i');
      const match = textSample.match(monthDayYear);
      if (match) {
        const date = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }

      const isoMatch = textSample.match(/\b(202\d)[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/);
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
    const timeout = setTimeout(() => controller.abort(), 5000);

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

    const urlDateMatch = url.match(/\/(\d{4})[-\/](\d{2})[-\/](\d{2})\//);
    if (urlDateMatch) {
      const date = new Date(`${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`);
      if (!isNaN(date.getTime())) {
        return date;
      }
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
        if (pubMs >= startMs && pubMs <= endMs) {
          filteredResults.push(item);
        }
        continue;
      }
    }

    const scrapedDate = await extractDateFromUrl(item.url);

    if (scrapedDate) {
      const pubMs = scrapedDate.getTime();
      item.published_date = scrapedDate.toISOString().split('T')[0];
      item.date_source = 'scraped';

      if (pubMs >= startMs && pubMs <= endMs) {
        filteredResults.push(item);
      }
    } else {
      filteredResults.push(item);
    }
  }

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
    const { query, include_domains, start_date, end_date } = req.body;

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

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tavilyRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = await response.json();

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

    if (start_date && end_date) {
      results = await filterByScrapedDate(results, start_date, end_date);
    }

    res.json({ results });
  } catch (error) {
    console.error('[Tavily] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
}
