import { ReportConfig, GeneratedReport } from "../types";
import { COUNTRIES, PHARMA_AREAS } from "../constants";

const API_BASE = '';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}


export const generateLegalReport = async (config: ReportConfig): Promise<GeneratedReport> => {
  const firmList = config.selectedFirms.map(f => `${f.name} (${f.url})`).join(", ");
  const topicList = config.selectedTopics.map(t => t.label).join(", ");
  const countryList = COUNTRIES.join(", ");
  const areaList = PHARMA_AREAS.join(", ");

  // Search each topic separately for each firm
  // Total searches = topics × firms (e.g., 5 topics × 20 firms = 100 searches)
  // Serper API limit: 5 requests per second
  let searchResults = "";
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Determine search endpoint based on provider
  const searchProvider = config.searchProvider || 'serper';
  const searchEndpoint = searchProvider === 'tavily' ? '/api/search-tavily' : '/api/search';
  const searchProviderLabel = searchProvider === 'tavily' ? 'Tavily (AI Research)' : 'Serper (Google Search)';

  // Get abort signal if provided
  const abortSignal = config.abortSignal;

  // Log full search configuration for debugging erratic results
  console.log('[Search] Config:', {
    dateRange: `${config.startDate} to ${config.endDate}`,
    strictDateFilter: config.strictDateFilter,
    searchProvider: searchProvider,
    firmsCount: config.selectedFirms.length,
    topicsCount: config.selectedTopics.length,
    modelProvider: config.modelProvider || 'sonnet'
  });

  console.log(`[Search] Using provider: ${searchProviderLabel}`);

  // Extract years from date range for query filtering
  const startYear = config.startDate.split('-')[0];
  const endYear = config.endDate.split('-')[0];
  const yearFilter = startYear === endYear ? startYear : `(${startYear} OR ${endYear})`;

  // Topic keywords mapping - keys must match LEGAL_TOPICS labels exactly
  // Each topic has 2 query variants covering different angles of the same legal area
  // This doubles searches but dramatically improves hit rate vs. one long AND query
  const topicKeywords: Record<string, string[]> = {
    'Privacy / Data Protection': [
      'data protection law new regulation',
      'privacy compliance enforcement action'
    ],
    'AI / Automated Decision-Making': [
      'artificial intelligence AI regulation law',
      'automated decision-making algorithmic governance'
    ],
    'Cybersecurity / Incident Reporting': [
      'cybersecurity regulation compliance requirement',
      'data breach notification incident reporting'
    ],
    'Health Information / HIPAA-type': [
      'HIPAA health data privacy regulation',
      'health information protection law'
    ],
    'Patient Support Programs': [
      'patient support program pharmaceutical compliance',
      'copay assistance hub services FDA regulation'
    ],
    'Consent, Digital Tracking & Privacy Notices': [
      'cookie consent banner regulation',
      'online tracking privacy notice requirement'
    ]
  };

  try {
    const firms = config.selectedFirms;
    const topics = config.selectedTopics;

    // Calculate total searches: firms × topics × keyword variants (2 per topic)
    const totalVariants = topics.reduce((sum, t) => {
      const variants = topicKeywords[t.label] || [t.label.split('/')[0].trim()];
      return sum + variants.length;
    }, 0);
    console.log(`[Search] Total searches: ${firms.length * totalVariants} (${firms.length} firms × ${topics.length} topics × ~2 keyword variants)`);

    const batchSize = 4; // Process 4 searches at a time to stay under 5/sec limit
    const resultsByFirm: Record<string, string[]> = {};
    // Track seen URLs per firm to deduplicate across keyword variants
    const seenUrlsByFirm: Record<string, Set<string>> = {};

    // Search one topic at a time, iterating keyword variants then firms
    for (let topicIdx = 0; topicIdx < topics.length; topicIdx++) {
      const topic = topics[topicIdx];
      const keywordVariants = topicKeywords[topic.label] || [topic.label.split('/')[0].trim()];
      console.log(`[Search] === Topic ${topicIdx + 1}/${topics.length}: ${topic.label} (${keywordVariants.length} query variants) ===`);

      let topicResultCount = 0;

      // Run each keyword variant across all firms
      for (let variantIdx = 0; variantIdx < keywordVariants.length; variantIdx++) {
        const keywords = keywordVariants[variantIdx];
        console.log(`[Search]   Variant ${variantIdx + 1}/${keywordVariants.length}: "${keywords}"`);

        const firmTasks = firms.map(firm => ({ firm, topic, keywords }));

        for (let i = 0; i < firmTasks.length; i += batchSize) {
          const batch = firmTasks.slice(i, i + batchSize);

          const searchPromises = batch.map(async ({ firm, topic, keywords }) => {
            try {
              // Extract root domain (drop subdomains like www, resourcehub, etc.)
              // e.g. "resourcehub.bakermckenzie.com" → "bakermckenzie.com"
              const hostname = new URL(firm.url).hostname;
              const parts = hostname.split('.');
              const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
              const query = `${keywords} law regulation ${yearFilter}`;

              console.log(`[Search] Fetching: ${firm.name} / ${topic.label} v${variantIdx + 1} (domain: ${domain})`);

              const response = await fetch(`${API_BASE}${searchEndpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: query,
                  include_domains: [domain],
                  start_date: config.startDate,
                  end_date: config.endDate,
                  strict_date_filter: config.strictDateFilter || false
                }),
                signal: abortSignal
              });

              if (response.ok) {
                const data: TavilyResponse = await response.json();
                if (data.results && data.results.length > 0) {
                  // Deduplicate: filter out URLs already seen for this firm
                  if (!seenUrlsByFirm[firm.name]) {
                    seenUrlsByFirm[firm.name] = new Set();
                  }
                  const newResults = data.results.filter(r => !seenUrlsByFirm[firm.name].has(r.url));
                  // Mark these URLs as seen
                  for (const r of data.results) {
                    seenUrlsByFirm[firm.name].add(r.url);
                  }

                  if (newResults.length > 0) {
                    console.log(`[Search] ${firm.name} / ${topic.label} v${variantIdx + 1}: ${newResults.length} new results (${data.results.length - newResults.length} dupes skipped)`);
                    // Take top 10 new results for better coverage
                    const topResults = newResults.slice(0, 10);
                    const formattedResults = topResults.map(r => {
                      const title = r.title.length > 80 ? r.title.substring(0, 80) + '...' : r.title;
                      const content = r.content.length > 150 ? r.content.substring(0, 150) + '...' : r.content;
                      return `- [${topic.label}] **${title}**\n  ${r.url}\n  ${content}`;
                    });
                    return {
                      firmName: firm.name,
                      topicLabel: topic.label,
                      result: formattedResults.join('\n'),
                      count: topResults.length
                    };
                  } else {
                    console.log(`[Search] ${firm.name} / ${topic.label} v${variantIdx + 1}: ${data.results.length} results (all duplicates)`);
                  }
                } else {
                  console.log(`[Search] ${firm.name} / ${topic.label} v${variantIdx + 1}: 0 results`);
                }
              } else {
                const errorText = await response.text().catch(() => 'unknown');
                console.error(`[Search] ${firm.name} / ${topic.label} v${variantIdx + 1}: HTTP ${response.status} - ${errorText.substring(0, 200)}`);
              }
              return null;
            } catch (err: any) {
              if (err.name === 'AbortError') throw err; // Re-throw abort so it propagates
              console.error(`[Search] ${firm.name} / ${topic.label} v${variantIdx + 1}: Error - ${err.message}`);
              return null;
            }
          });

          const batchResults = await Promise.all(searchPromises);

          // Group results by firm
          for (const result of batchResults) {
            if (result) {
              if (!resultsByFirm[result.firmName]) {
                resultsByFirm[result.firmName] = [];
              }
              resultsByFirm[result.firmName].push(result.result);
              topicResultCount += result.count;
            }
          }

          // Wait 1.5 seconds between batches to respect rate limit (5 req/sec)
          if (i + batchSize < firmTasks.length) {
            await delay(1500);
          }
        }

        // Brief delay between keyword variants for the same topic
        if (variantIdx + 1 < keywordVariants.length) {
          await delay(1000);
        }
      }

      console.log(`[Search] === Topic "${topic.label}" complete: ${topicResultCount} results ===`);

      // Report progress
      config.onProgress?.({
        currentTopic: topic.label,
        topicIndex: topicIdx + 1,
        totalTopics: topics.length,
        resultsFound: topicResultCount
      });
    }

    // Format results grouped by firm
    const firmsWithResults: string[] = [];
    for (const [firmName, results] of Object.entries(resultsByFirm)) {
      if (results.length > 0) {
        searchResults += `\n### ${firmName}\n${results.join('\n')}\n`;
        firmsWithResults.push(firmName);
      }
    }

    if (searchResults) {
      searchResults = "\n## Search Results by Firm\n" + searchResults;
    }

    // Summary log for debugging
    console.log(`[Search] COMPLETE: ${firmsWithResults.length} firms with results out of ${firms.length} total firms`);
    console.log(`[Search] Firms with results: ${firmsWithResults.join(', ') || 'NONE'}`);
    console.log(`[Search] Total search results text length: ${searchResults.length} chars`);
  } catch (error: any) {
    if (error.name === 'AbortError') throw error; // Re-throw abort
    console.error("Search error:", error);
    searchResults = "";
  }

  const prompt = `
You are a legal research assistant for attorneys in pharmaceutical regulatory compliance.

**SEARCH RESULTS:**
${searchResults || "No search results available."}

**TASK:**
Analyze the search results and organize findings BY LAW FIRM IN ALPHABETICAL ORDER, highlighting new laws, regulations, and proposed legislation.

Law Firms: ${firmList}
Legal Topics: ${topicList}
Countries: ${countryList}
Date Range of Interest: ${config.startDate} to ${config.endDate}
Search Provider Used: ${searchProviderLabel}

**OUTPUT FORMAT:**

## Executive Summary
Brief 2-3 sentence overview of key new/proposed laws identified across all firms.

---

## [Law Firm Name]

### Laws & Regulations Covered:
- **[Law/Regulation Name 1]** (Status: Enacted/Proposed | Effective: [Date] | Jurisdiction: [Country/State])
- **[Law/Regulation Name 2]** (Status: Enacted/Proposed | Effective: [Date] | Jurisdiction: [Country/State])

### Commentary Summary:
[Summarize the firm's analysis and key insights about the above laws/regulations. Include:
- What the law requires
- Compliance deadlines
- Key obligations for pharmaceutical companies
- Impact on: ${areaList}]

### Life Sciences Impact:
[For EACH law/regulation cited above, provide a brief 2-3 sentence description of how it specifically impacts life sciences companies, including:
- Clinical trials and patient data handling
- Drug development and regulatory submissions
- Healthcare provider/patient communications
- Real-world evidence and pharmacovigilance data
- Digital health applications and connected devices]

**Source:** [Title of Commentary](URL)

---

(Repeat for each law firm)

---

## Summary Table

| Law/Regulation | Status | Effective Date | Jurisdiction | Commenting Firm | Source Link |
|----------------|--------|----------------|--------------|-----------------|-------------|
[List all identified laws with clickable source links]

**IMPORTANT:**
- Present law firms in ALPHABETICAL ORDER (A-Z)
- Start each firm section with the SPECIFIC LAWS/REGULATIONS they discuss
- Put the source link at the END of each firm's commentary section
- ONLY include laws explicitly mentioned in the search results
- Use the EXACT source URLs from the search results
- If a firm has no relevant commentaries in the search results, SKIP that firm entirely - do not include any section for them
- Only include firms that have actual commentary content to report
`;

  try {
    // Combined abort controller that handles both user abort and timeout
    const combinedController = new AbortController();
    const timeoutId = setTimeout(() => combinedController.abort(), 300000); // 5 min timeout

    // If user provided an abort signal, forward it to the combined controller
    if (abortSignal) {
      if (abortSignal.aborted) {
        combinedController.abort();
      } else {
        abortSignal.addEventListener('abort', () => combinedController.abort());
      }
    }

    const modelToUse = config.modelProvider || 'sonnet';
    console.log('[Claude] Sending request with model:', modelToUse);

    const response = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, model: modelToUse }),
      signal: combinedController.signal
    });

    console.log('[Claude] Response status:', response.status);

    if (!response.ok) {
      clearTimeout(timeoutId);
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        // response wasn't JSON
      }
      throw new Error(errorMessage);
    }

    // Read the SSE stream and accumulate text
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';

    console.log('[Claude] Reading SSE stream...');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines from the buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'text_delta' && event.text) {
            accumulatedText += event.text;
          } else if (event.type === 'done') {
            console.log('[Claude] Stream done, stop_reason:', event.stop_reason);
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Claude streaming error');
          }
        } catch (parseError: any) {
          // Re-throw if it's our own error (not a JSON parse error)
          if (parseError.message && parseError.message !== 'Claude streaming error' &&
              !parseError.message.includes('JSON')) {
            // It's a thrown error from the event.type === 'error' case
            if (parseError.message.includes('streaming error') || parseError.message.includes('API')) {
              throw parseError;
            }
          }
          // Skip unparseable SSE lines
        }
      }
    }

    // Process any remaining buffer content
    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6).trim();
      if (data) {
        try {
          const event = JSON.parse(data);
          if (event.type === 'text_delta' && event.text) {
            accumulatedText += event.text;
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Claude streaming error');
          }
        } catch {
          // Skip
        }
      }
    }

    clearTimeout(timeoutId);

    const markdownText = accumulatedText || "No report generated.";
    console.log('[Claude] Stream complete. Markdown text length:', markdownText.length);

    // Better HTML conversion for Word export
    const htmlContent = generateWordHtml(markdownText, config);

    return {
      markdownContent: markdownText,
      htmlContent: htmlContent
    };

  } catch (error: any) {
    console.error("Error generating report:", error);
    // Re-throw with clear message for proxy/network failures
    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
      throw new Error('Network error: Could not reach the backend server. Make sure the backend is running on port 3001.');
    }
    throw error;
  }
};

function generateWordHtml(markdown: string, config: ReportConfig): string {
  // Debug: log the received searchProvider value
  console.log('[Word Export] config.searchProvider:', config.searchProvider, 'type:', typeof config.searchProvider);

  // Normalize search provider value
  const searchProvider = (config.searchProvider || 'serper').toLowerCase().trim();
  const searchProviderLabel = searchProvider === 'tavily' ? 'Tavily (AI Research)' : 'Serper (Google Search)';

  // Get AI model label
  const modelProvider = (config.modelProvider || 'sonnet').toLowerCase().trim();
  const modelProviderLabel = modelProvider === 'opus' ? 'Claude Opus 4.5' : 'Claude Sonnet 4';

  // Get selected legal areas
  const selectedTopicsLabel = config.selectedTopics.map(t => t.label).join(', ') || 'None selected';

  console.log('[Word Export] Normalized provider:', searchProvider, '=> Label:', searchProviderLabel);

  // Convert markdown to proper HTML for Word
  let html = markdown;

  // Convert tables first (before other conversions mess with the structure)
  html = convertMarkdownTables(html);

  // Convert headers
  html = html.replace(/^### (.*$)/gm, '<h3 style="color: #6d28d9; font-size: 14pt; margin-top: 16px;">$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2 style="color: #4c1d95; font-size: 16pt; margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px;">$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1 style="color: #2e1065; font-size: 18pt;">$1</h1>');

  // Convert bold and italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Convert links - make them clickable in Word
  html = html.replace(/\[(.*?)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" style="color: #2563eb;">$1</a>');

  // Convert bullet points
  html = html.replace(/^- (.*$)/gm, '<li style="margin-left: 20px;">$1</li>');
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin: 10px 0;">$&</ul>');

  // Convert line breaks
  html = html.replace(/\n\n/g, '</p><p style="margin: 10px 0;">');
  html = html.replace(/\n/g, '<br/>');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 { color: #2e1065; font-size: 18pt; border-bottom: 2px solid #2e1065; padding-bottom: 8px; }
    h2 { color: #4c1d95; font-size: 16pt; margin-top: 24px; }
    h3 { color: #6d28d9; font-size: 14pt; margin-top: 16px; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
      font-size: 10pt;
    }
    th {
      background-color: #f3e8ff;
      border: 1px solid #c4b5fd;
      padding: 10px;
      text-align: left;
      font-weight: bold;
      color: #4c1d95;
    }
    td {
      border: 1px solid #ddd;
      padding: 8px;
      vertical-align: top;
    }
    tr:nth-child(even) { background-color: #faf5ff; }
    a { color: #2563eb; text-decoration: underline; }
    ul { margin: 10px 0 10px 20px; }
    li { margin: 4px 0; }
    .header-info {
      background-color: #f8f4ff;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="header-info">
    <h1>Regulatory Intelligence Report</h1>
    <p><strong>Date Range:</strong> ${config.startDate} to ${config.endDate}</p>
    <p><strong>Legal Areas:</strong> ${selectedTopicsLabel}</p>
    <p><strong>AI Model:</strong> ${modelProviderLabel}</p>
    <p><strong>Search Provider:</strong> ${searchProviderLabel}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
  </div>
  <p style="margin: 10px 0;">${html}</p>
</body>
</html>
  `;
}

function convertMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n');
  let result: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this is a table row (starts and ends with |)
    if (line.startsWith('|') && line.endsWith('|')) {
      // Skip separator rows (|---|---|)
      if (line.match(/^\|[\s\-:]+\|$/)) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableRows = [];
      }

      tableRows.push(line);
    } else {
      // End of table
      if (inTable && tableRows.length > 0) {
        result.push(buildHtmlTable(tableRows));
        tableRows = [];
        inTable = false;
      }
      result.push(line);
    }
  }

  // Handle table at end of content
  if (inTable && tableRows.length > 0) {
    result.push(buildHtmlTable(tableRows));
  }

  return result.join('\n');
}

function buildHtmlTable(rows: string[]): string {
  if (rows.length === 0) return '';

  let html = '<table>';

  rows.forEach((row, index) => {
    const cells = row.split('|').filter(cell => cell.trim() !== '');
    const tag = index === 0 ? 'th' : 'td';

    html += '<tr>';
    cells.forEach(cell => {
      html += `<${tag}>${cell.trim()}</${tag}>`;
    });
    html += '</tr>';
  });

  html += '</table>';
  return html;
}
