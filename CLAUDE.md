# Project Instructions for Claude

## Date-Filtered Web Searches

When performing web searches that need to be restricted by a date range, use `date-filter-module.js`.

### Setup
```bash
npm install pdf-parse
```

### Usage

```javascript
import { searchWithSerper, searchWithTavily, filterByScrapedDate } from './date-filter-module.js';

// Serper (Google) search with date filtering
const results = await searchWithSerper({
  query: 'privacy law regulation',
  apiKey: process.env.SERPER_API_KEY,
  domains: ['lawfirm.com'],           // optional - restrict to specific domains
  startDate: '2025-10-01',            // YYYY-MM-DD format
  endDate: '2026-01-12',
  numResults: 10                       // optional, default 10
});

// Tavily search with date filtering
const results = await searchWithTavily({
  query: 'HIPAA compliance',
  apiKey: process.env.TAVILY_API_KEY,
  domains: ['healthlaw.com'],          // optional
  startDate: '2025-06-01',
  endDate: '2025-12-31',
  numResults: 5                        // optional, default 5
});

// Filter existing results by publication date
const filtered = await filterByScrapedDate(existingResults, '2025-01-01', '2025-12-31');
```

### How It Works

The module applies multi-layer date filtering:
1. **API-level**: Serper's `tbs` parameter, Tavily's `days` parameter
2. **API response dates**: Filters by returned date fields
3. **HTML scraping**: Extracts dates from meta tags, JSON-LD, `<time>` elements, text patterns
4. **PDF scraping**: Extracts dates from PDF metadata and text content
5. **URL fallback**: Extracts dates from URL paths like `/2024/08/`

### When to Use

Use this module when:
- The user specifies a date range for search results
- You need to filter out articles published outside a specific time period
- Searching for recent news, articles, or legal commentaries
