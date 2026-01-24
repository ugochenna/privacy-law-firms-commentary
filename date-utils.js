/**
 * Date Extraction Utilities
 *
 * Standalone module for extracting and filtering publication dates from web content.
 * Can be used in any Node.js application.
 *
 * Usage:
 *   import { extractDateFromUrl, extractDateFromPdf, filterByDateRange } from './date-utils.js';
 *
 *   // Extract date from any URL (HTML or PDF)
 *   const date = await extractDateFromUrl('https://example.com/article');
 *
 *   // Filter search results by date range
 *   const filtered = await filterByDateRange(results, '2025-01-01', '2025-12-31');
 *
 * Requirements:
 *   npm install pdf-parse
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('[date-utils] pdf-parse not installed. PDF date extraction will be disabled.');
  pdfParse = null;
}

/**
 * Extract publication date from PDF metadata or content
 * @param {string} url - URL of the PDF file
 * @param {number} timeout - Request timeout in ms (default: 10000)
 * @returns {Promise<Date|null>} - Extracted date or null
 */
export async function extractDateFromPdf(url, timeout = 10000) {
  if (!pdfParse) {
    console.warn('[date-utils] pdf-parse not available, skipping PDF extraction');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DateExtractor/1.0)' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfData = await pdfParse(buffer);

    // Method 1: PDF metadata (CreationDate)
    if (pdfData.info?.CreationDate) {
      const date = parsePdfDate(pdfData.info.CreationDate);
      if (date) return date;
    }

    // Method 2: PDF metadata (ModDate)
    if (pdfData.info?.ModDate) {
      const date = parsePdfDate(pdfData.info.ModDate);
      if (date) return date;
    }

    // Method 3: Extract from PDF text content (first 2000 chars)
    if (pdfData.text) {
      const date = extractDateFromText(pdfData.text.substring(0, 2000));
      if (date) return date;
    }

    return null;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.log(`[date-utils] PDF extraction error for ${url}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Parse PDF date format (D:YYYYMMDDHHmmss)
 * @param {string} pdfDateStr - PDF date string
 * @returns {Date|null}
 */
function parsePdfDate(pdfDateStr) {
  const match = pdfDateStr.match(/D:(\d{4})(\d{2})(\d{2})/);
  if (match) {
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}`);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Extract date from plain text using common patterns
 * @param {string} text - Text to search for dates
 * @returns {Date|null}
 */
export function extractDateFromText(text) {
  const months = 'January|February|March|April|May|June|July|August|September|October|November|December';

  const patterns = [
    // "January 23, 2025" or "January 23 2025"
    { regex: new RegExp(`(${months})\\s+(\\d{1,2}),?\\s+(20\\d{2})`, 'i'), format: 'MDY' },
    // "23 January 2025"
    { regex: new RegExp(`(\\d{1,2})\\s+(${months})\\s+(20\\d{2})`, 'i'), format: 'DMY' },
    // "2025-01-23" or "2025/01/23"
    { regex: /\b(20\d{2})[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/, format: 'ISO' },
    // "01/23/2025" US format
    { regex: /(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(20\d{2})/, format: 'US' },
    // "23/01/2025" EU format
    { regex: /(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20\d{2})/, format: 'EU' },
  ];

  for (const { regex, format } of patterns) {
    const match = text.match(regex);
    if (match) {
      let dateStr;
      switch (format) {
        case 'MDY': dateStr = `${match[1]} ${match[2]}, ${match[3]}`; break;
        case 'DMY': dateStr = `${match[2]} ${match[1]}, ${match[3]}`; break;
        case 'ISO': dateStr = match[0]; break;
        case 'US': dateStr = `${match[3]}-${match[1]}-${match[2]}`; break;
        case 'EU': dateStr = `${match[3]}-${match[2]}-${match[1]}`; break;
      }
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) return date;
    }
  }

  return null;
}

/**
 * Extract publication date from a URL (HTML page or PDF)
 * @param {string} url - URL to extract date from
 * @param {number} timeout - Request timeout in ms (default: 5000)
 * @returns {Promise<Date|null>} - Extracted date or null
 */
export async function extractDateFromUrl(url, timeout = 5000) {
  // Check if URL is obviously a PDF
  const isPdfUrl = url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('.pdf?');
  if (isPdfUrl) {
    const pdfDate = await extractDateFromPdf(url, timeout * 2);
    if (pdfDate) return pdfDate;

    // Fallback: try to extract date from URL path
    const urlDate = extractDateFromUrlPath(url);
    if (urlDate) return urlDate;

    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DateExtractor/1.0)' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) return null;

    // Check if response is actually a PDF
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (pdfParse) {
        try {
          const pdfData = await pdfParse(buffer);
          if (pdfData.info?.CreationDate) {
            const date = parsePdfDate(pdfData.info.CreationDate);
            if (date) return date;
          }
        } catch (e) { /* PDF parse failed */ }
      }
      return null;
    }

    const html = await response.text();

    // Method 1: Meta tags (most reliable)
    const metaDate = extractDateFromMetaTags(html);
    if (metaDate) return metaDate;

    // Method 2: JSON-LD structured data
    const jsonLdDate = extractDateFromJsonLd(html);
    if (jsonLdDate) return jsonLdDate;

    // Method 3: HTML time element
    const timeDate = extractDateFromTimeElement(html);
    if (timeDate) return timeDate;

    // Method 4: URL path pattern
    const urlDate = extractDateFromUrlPath(url);
    if (urlDate) return urlDate;

    // Method 5: Text patterns in HTML
    const textDate = extractDateFromHtmlText(html);
    if (textDate) return textDate;

    // Method 6: CSS class-based date elements
    const classDate = extractDateFromDateClasses(html);
    if (classDate) return classDate;

    return null;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.log(`[date-utils] Extraction error for ${url}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Extract date from HTML meta tags
 */
function extractDateFromMetaTags(html) {
  const patterns = [
    /meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /meta[^>]*content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    /meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i,
    /meta[^>]*content=["']([^"']+)["'][^>]*name=["']date["']/i,
    /meta[^>]*name=["']publish[_-]?date["'][^>]*content=["']([^"']+)["']/i,
    /meta[^>]*name=["']DC\.date["'][^>]*content=["']([^"']+)["']/i,
    /meta[^>]*name=["']article:published["'][^>]*content=["']([^"']+)["']/i,
    /meta[^>]*name=["']pubdate["'][^>]*content=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const date = new Date(match[1]);
      if (!isNaN(date.getTime())) return date;
    }
  }
  return null;
}

/**
 * Extract date from JSON-LD structured data
 */
function extractDateFromJsonLd(html) {
  const scriptMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!scriptMatches) return null;

  for (const script of scriptMatches) {
    try {
      const jsonContent = script.replace(/<script[^>]*>|<\/script>/gi, '');
      const data = JSON.parse(jsonContent);

      // Direct properties
      const dateStr = data.datePublished || data.dateCreated || data.publishDate;
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
      }

      // @graph array (common in WordPress sites)
      if (data['@graph']) {
        for (const item of data['@graph']) {
          if (item.datePublished) {
            const date = new Date(item.datePublished);
            if (!isNaN(date.getTime())) return date;
          }
        }
      }
    } catch (e) { /* JSON parse failed */ }
  }
  return null;
}

/**
 * Extract date from HTML time element
 */
function extractDateFromTimeElement(html) {
  const match = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
  if (match?.[1]) {
    const date = new Date(match[1]);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Extract date from URL path patterns
 */
function extractDateFromUrlPath(url) {
  // Pattern: /YYYY/MM/DD/ or /YYYY-MM-DD/
  const fullMatch = url.match(/\/(\d{4})[-\/](\d{2})[-\/](\d{2})[\/\-]/);
  if (fullMatch) {
    const date = new Date(`${fullMatch[1]}-${fullMatch[2]}-${fullMatch[3]}`);
    if (!isNaN(date.getTime())) return date;
  }

  // Pattern: /YYYY/MM/ (assume mid-month)
  const partialMatch = url.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
  if (partialMatch) {
    const date = new Date(`${partialMatch[1]}-${partialMatch[2]}-15`);
    if (!isNaN(date.getTime())) return date;
  }

  return null;
}

/**
 * Extract date from visible text in HTML
 */
function extractDateFromHtmlText(html) {
  // Remove script and style tags to avoid false positives
  const cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[\s\S]*?<\/style>/gi, '');

  return extractDateFromText(cleanHtml.substring(0, 10000));
}

/**
 * Extract date from elements with date-related CSS classes
 */
function extractDateFromDateClasses(html) {
  const patterns = [
    /<[^>]*class=["'][^"']*(?:date|published|posted|timestamp|pubdate)[^"']*["'][^>]*>([^<]{5,30})</gi,
    /<span[^>]*>(?:Published|Posted|Date)[:\s]*([^<]{5,30})</gi,
  ];

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)];
    for (const match of matches) {
      const potentialDate = match[1].trim();
      const date = new Date(potentialDate);
      if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
        return date;
      }
    }
  }
  return null;
}

/**
 * Filter an array of results by date range
 * @param {Array} results - Array of objects with 'url' property and optional 'published_date'
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Object} options - Optional configuration
 * @param {boolean} options.keepIfNoDate - Keep results if no date can be determined (default: true)
 * @param {boolean} options.addDateSource - Add 'date_source' field to results (default: true)
 * @returns {Promise<Array>} - Filtered results
 */
export async function filterByDateRange(results, startDate, endDate, options = {}) {
  const { keepIfNoDate = true, addDateSource = true } = options;

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  // Set end date to end of day
  const endOfDayMs = endMs + (24 * 60 * 60 * 1000) - 1;

  const filteredResults = [];

  for (const item of results) {
    // Check if item already has a valid date
    if (item.published_date) {
      const pubMs = new Date(item.published_date).getTime();
      if (!isNaN(pubMs)) {
        if (pubMs >= startMs && pubMs <= endOfDayMs) {
          if (addDateSource && !item.date_source) {
            item.date_source = 'provided';
          }
          filteredResults.push(item);
        }
        continue;
      }
    }

    // Try to extract date from URL
    if (item.url) {
      const scrapedDate = await extractDateFromUrl(item.url);

      if (scrapedDate) {
        const pubMs = scrapedDate.getTime();
        item.published_date = scrapedDate.toISOString().split('T')[0];
        if (addDateSource) {
          item.date_source = 'scraped';
        }

        if (pubMs >= startMs && pubMs <= endOfDayMs) {
          filteredResults.push(item);
        }
        continue;
      }
    }

    // No date found
    if (keepIfNoDate) {
      if (addDateSource) {
        item.date_source = 'unknown';
      }
      filteredResults.push(item);
    }
  }

  return filteredResults;
}

/**
 * Check if a date falls within a range
 * @param {Date|string} date - Date to check
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {boolean}
 */
export function isDateInRange(date, startDate, endDate) {
  const dateMs = new Date(date).getTime();
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime() + (24 * 60 * 60 * 1000) - 1;

  return dateMs >= startMs && dateMs <= endMs;
}

/**
 * Format date for Serper API (Google's tbs parameter)
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {string} - Formatted tbs parameter value
 */
export function formatDateForSerper(startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-');
  const [ey, em, ed] = endDate.split('-');
  return `cdr:1,cd_min:${sm}/${sd}/${sy},cd_max:${em}/${ed}/${ey}`;
}

/**
 * Calculate days between a date and today (for Tavily API)
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @returns {number} - Number of days
 */
export function calculateDaysFromDate(startDate) {
  const startMs = new Date(startDate).getTime();
  const nowMs = Date.now();
  return Math.ceil((nowMs - startMs) / (1000 * 60 * 60 * 24));
}

// Default export for convenience
export default {
  extractDateFromUrl,
  extractDateFromPdf,
  extractDateFromText,
  filterByDateRange,
  isDateInRange,
  formatDateForSerper,
  calculateDaysFromDate,
};
