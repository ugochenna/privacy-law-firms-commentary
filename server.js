import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const result = dotenv.config({ path: join(__dirname, '.env') });
if (result.error) {
  console.error('Error loading .env file:', result.error);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || 'claude-sonnet-4-20250514';

// Debug: Check if keys are loaded
console.log('API Keys loaded:', {
  anthropic: ANTHROPIC_API_KEY ? 'Yes (' + ANTHROPIC_API_KEY.substring(0, 10) + '...)' : 'NO',
  serper: SERPER_API_KEY ? 'Yes (' + SERPER_API_KEY.substring(0, 8) + '...)' : 'NO'
});

// Serper (Google) search endpoint
app.post('/api/search', async (req, res) => {
  console.log('[Serper] Search request received');
  try {
    const { query, include_domains } = req.body;
    console.log('[Serper] Query:', query.substring(0, 80) + '...');

    // Build site-restricted query if domains provided
    let searchQuery = query;
    if (include_domains && include_domains.length > 0) {
      // Add site: operators for domain filtering
      const siteFilter = include_domains.slice(0, 5).map(d => `site:${d}`).join(' OR ');
      searchQuery = `(${siteFilter}) ${query}`;
    }

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: searchQuery,
        num: 10
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Serper] API Error:', errorText);
      throw new Error(`Serper API error: ${response.status}`);
    }

    const data = await response.json();

    // Transform Serper response to match expected format
    const results = (data.organic || []).map(item => ({
      title: item.title,
      url: item.link,
      content: item.snippet || ''
    }));

    console.log('[Serper] Results found:', results.length);
    res.json({ results });
  } catch (error) {
    console.error('[Serper] Error:', error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
});

// Claude API endpoint
app.post('/api/generate', async (req, res) => {
  console.log('[Claude] Generate request received');
  try {
    const { prompt } = req.body;
    console.log('[Claude] Prompt length:', prompt.length, 'chars');
    console.log('[Claude] Calling API with model:', MODEL_NAME);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

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
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Claude] API Error:', errorData);
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Claude] Response received, tokens used:', data.usage?.output_tokens || 'unknown');
    res.json(data);
  } catch (error) {
    console.error('[Claude] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Using model: ${MODEL_NAME}`);
  console.log(`Search: Serper (Google)`);
});
