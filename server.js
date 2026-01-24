import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractDateFromUrl } from './date-filter-module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || 'claude-sonnet-4-20250514';

console.log('API Keys loaded:', {
  anthropic: ANTHROPIC_API_KEY ? 'Yes' : 'NO',
  serper: SERPER_API_KEY ? 'Yes' : 'NO',
  tavily: TAVILY_API_KEY ? 'Yes' : 'NO (optional)'
});

// Wrapper for filterByScrapedDate that adds strictMode support
// Uses the comprehensive date extraction from date-filter-module.js
async function filterByScrapedDate(results, startDate, endDate, strictMode = false) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const filteredResults = [];

  for (const item of results) {
    // If we already have a valid date from the API, use it
    if (item.published_date) {
      const pubMs = new Date(item.published_date).getTime();
      if (!isNaN(pubMs)) {
        if (pubMs >= startMs && pubMs <= endMs) filteredResults.push(item);
        continue;
      }
    }

    // Use the module's comprehensive date extraction
    const scrapedDate = await extractDateFromUrl(item.url);
    if (scrapedDate) {
      const pubMs = scrapedDate.getTime();
      item.published_date = scrapedDate.toISOString().split('T')[0];
      item.date_source = 'scraped';
      if (pubMs >= startMs && pubMs <= endMs) {
        filteredResults.push(item);
      } else {
        console.log(`[Scraper] Filtered: ${item.url} (date: ${item.published_date} outside range)`);
      }
    } else {
      // No date found - include only if not in strict mode
      if (!strictMode) {
        filteredResults.push(item);
      } else {
        console.log(`[Scraper] Excluded (strict mode): ${item.url} (no date found)`);
      }
    }
  }

  return filteredResults;
}

// Serper search endpoint - IMPROVED v2
// Changes: 1) Increased results to 20, 2) Filter out non-content pages, 3) Removed tbs date filter (rely on post-processing)
app.post('/api/search', async (req, res) => {
  try {
    const { query, include_domains, start_date, end_date, strict_date_filter } = req.body;

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
      results = await filterByScrapedDate(results, start_date, end_date, strict_date_filter);
    }

    console.log('[Serper] Final results:', results.length, strict_date_filter ? '(strict mode)' : '');

    res.json({ results });
  } catch (error) {
    console.error('[Serper] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
});

// Tavily search endpoint
app.post('/api/search-tavily', async (req, res) => {
  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: 'Tavily API key not configured', results: [] });
  }

  try {
    const { query, include_domains, start_date, end_date, strict_date_filter } = req.body;

    let days = 365;
    if (start_date) {
      const startMs = new Date(start_date).getTime();
      days = Math.ceil((Date.now() - startMs) / (1000 * 60 * 60 * 24));
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tavilyRequest)
    });

    if (!response.ok) throw new Error(`Tavily API error: ${response.status}`);

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
      results = await filterByScrapedDate(results, start_date, end_date, strict_date_filter);
    }

    console.log('[Tavily] Final results:', results.length, strict_date_filter ? '(strict mode)' : '');

    res.json({ results });
  } catch (error) {
    console.error('[Tavily] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
});

// Claude API endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[Claude] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
