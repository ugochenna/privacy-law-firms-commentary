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

// Request logging middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const start = Date.now();
    console.log(`[REQ] ${req.method} ${req.path} started`);
    res.on('finish', () => {
      console.log(`[REQ] ${req.method} ${req.path} completed in ${Date.now() - start}ms (status: ${res.statusCode})`);
    });
    res.on('close', () => {
      if (!res.writableFinished) {
        console.log(`[REQ] ${req.method} ${req.path} CONNECTION CLOSED BY CLIENT after ${Date.now() - start}ms`);
      }
    });
  }
  next();
});

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

console.log('API Keys loaded:', {
  anthropic: ANTHROPIC_API_KEY ? 'Yes' : 'NO',
  serper: SERPER_API_KEY ? 'Yes' : 'NO',
  tavily: TAVILY_API_KEY ? 'Yes' : 'NO (optional)'
});

// Wrapper for filterByScrapedDate that adds strictMode support
// Uses the comprehensive date extraction from date-filter-module.js
// FIXED: Parallel scraping with overall timeout to prevent hanging requests
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
          console.log(`[Scraper] Filtered by API date: ${item.url} (${item.published_date} outside range)`);
        }
        continue;
      }
    }
    // No valid date — needs scraping
    needsScraping.push(item);
  }

  console.log(`[Scraper] ${filteredResults.length} items with API dates, ${needsScraping.length} need scraping`);

  // Phase 2: Scrape URLs in parallel (max 5 concurrent) with overall 15s timeout
  if (needsScraping.length > 0) {
    const SCRAPE_CONCURRENCY = 5;
    const OVERALL_TIMEOUT_MS = 25000; // 25 seconds max for all scraping
    const scrapeStartTime = Date.now();

    for (let i = 0; i < needsScraping.length; i += SCRAPE_CONCURRENCY) {
      // Check overall timeout
      if (Date.now() - scrapeStartTime > OVERALL_TIMEOUT_MS) {
        console.log(`[Scraper] Overall timeout reached after ${i} URLs. Including remaining ${needsScraping.length - i} items without date check.`);
        // Include remaining items (benefit of the doubt)
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
            console.log(`[Scraper] Filtered: ${item.url} (date: ${item.published_date} outside range)`);
          }
        } else {
          // No date found - include unless strict mode
          if (!strictMode) {
            filteredResults.push(item);
          } else {
            console.log(`[Scraper] Excluded (strict mode): ${item.url} (no date found)`);
          }
        }
      }
    }
  }

  console.log(`[Scraper] Final: ${filteredResults.length} results after date filtering (strict: ${strictMode})`);
  return filteredResults;
}

// Serper search endpoint - IMPROVED v2
// Changes: 1) Increased results to 20, 2) Filter out non-content pages, 3) Removed tbs date filter (rely on post-processing)
app.post('/api/search', async (req, res) => {
  try {
    const { query, include_domains, start_date, end_date, strict_date_filter } = req.body;

    // Log received date parameters for debugging
    console.log('[Serper] Date range:', start_date, 'to', end_date, 'strict:', strict_date_filter);

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
});

// Tavily search endpoint
app.post('/api/search-tavily', async (req, res) => {
  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: 'Tavily API key not configured', results: [] });
  }

  try {
    const { query, include_domains, start_date, end_date, strict_date_filter } = req.body;

    console.log('[Tavily] Request:', { query, start_date, end_date, strict_date_filter });

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
});

// Claude API endpoint with SSE streaming and automatic retry for overloaded errors
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, model } = req.body;

    // Select model based on user choice
    const selectedModel = model === 'opus'
      ? 'claude-opus-4-5-20251101'
      : 'claude-sonnet-4-20250514';

    console.log('[Claude] Using model:', selectedModel);

    // Retry logic for overloaded errors — retries happen BEFORE streaming starts
    const maxRetries = 3;
    let lastError = null;
    let streamResponse = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 16000,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.ok) {
        console.log('[Claude] Streaming started on attempt', attempt);
        streamResponse = response;
        break;
      }

      // Handle error responses (non-streaming errors like 529 overloaded)
      const errorText = await response.text();
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        errorMessage = errorText.substring(0, 200) || errorMessage;
      }

      const isOverloaded = response.status === 529 || errorMessage.toLowerCase().includes('overloaded');
      console.error(`[Claude] Attempt ${attempt}/${maxRetries} failed:`, errorMessage);

      if (isOverloaded && attempt < maxRetries) {
        const waitSeconds = attempt * 5; // 5s, 10s
        console.log(`[Claude] API overloaded. Retrying in ${waitSeconds}s...`);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        lastError = errorMessage;
        continue;
      }

      lastError = errorMessage;
      break;
    }

    if (!streamResponse) {
      throw new Error(lastError || 'Unknown error');
    }

    // Set SSE headers to keep the connection alive
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Read the Claude SSE stream and forward text deltas to the client
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines from the buffer
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            // Forward text chunk to client
            res.write(`data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`);
          } else if (event.type === 'message_stop') {
            // Stream complete
            res.write(`data: ${JSON.stringify({ type: 'done', stop_reason: 'end_turn' })}\n\n`);
          } else if (event.type === 'message_start' && event.message) {
            console.log('[Claude] Stream message_start:', {
              id: event.message.id,
              model: event.message.model
            });
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6).trim();
      if (data !== '[DONE]') {
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`);
          } else if (event.type === 'message_stop') {
            res.write(`data: ${JSON.stringify({ type: 'done', stop_reason: 'end_turn' })}\n\n`);
          }
        } catch {
          // Skip
        }
      }
    }

    console.log('[Claude] Stream complete');
    res.end();

  } catch (error) {
    console.error('[Claude] Error:', error.message);
    // If headers already sent (streaming started), send error as SSE event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
