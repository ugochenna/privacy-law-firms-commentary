import { ReportConfig, GeneratedReport } from "../types";
import { COUNTRIES, PHARMA_AREAS } from "../constants";

const API_BASE = 'http://localhost:3002';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeResponse {
  content: ClaudeContentBlock[];
}

export const generateLegalReport = async (config: ReportConfig): Promise<GeneratedReport> => {
  const firmList = config.selectedFirms.map(f => `${f.name} (${f.url})`).join(", ");
  const topicList = config.selectedTopics.map(t => t.label).join(", ");
  const countryList = COUNTRIES.join(", ");
  const areaList = PHARMA_AREAS.join(", ");

  // Search ALL selected law firms in parallel batches with rate limiting
  // Serper API limit: 5 requests per second
  let searchResults = "";
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const firms = config.selectedFirms;
    const batchSize = 4; // Process 4 firms at a time to stay under 5/sec limit

    for (let i = 0; i < firms.length; i += batchSize) {
      const batch = firms.slice(i, i + batchSize);

      const searchPromises = batch.map(async (firm) => {
        try {
          const domain = new URL(firm.url).hostname;
          // Include date range in search to help filter results
          const startYear = config.startDate.split('-')[0];
          const endYear = config.endDate.split('-')[0];
          const query = `${topicList} new law regulation ${startYear} ${endYear}`;

          const response = await fetch(`${API_BASE}/api/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: query,
              include_domains: [domain]
            })
          });

          if (response.ok) {
            const data: TavilyResponse = await response.json();
            if (data.results && data.results.length > 0) {
              let firmResults = `\n### ${firm.name}\n`;
              data.results.slice(0, 3).forEach((r: TavilyResult) => {
                const content = r.content.length > 300 ? r.content.substring(0, 300) + '...' : r.content;
                firmResults += `- **${r.title}**\n  ${r.url}\n  ${content}\n`;
              });
              return firmResults;
            }
          }
          return "";
        } catch {
          return "";
        }
      });

      const batchResults = await Promise.all(searchPromises);
      searchResults += batchResults.filter(r => r).join("\n");

      // Wait 1.5 seconds between batches to respect rate limit (5 req/sec)
      if (i + batchSize < firms.length) {
        await delay(1500);
      }
    }

    if (searchResults) {
      searchResults = "\n## Search Results by Firm\n" + searchResults;
    }
  } catch (error) {
    console.error("Search error:", error);
    searchResults = "";
  }

  const prompt = `
You are a legal research assistant for attorneys in pharmaceutical regulatory compliance.

**SEARCH RESULTS:**
${searchResults || "No search results available."}

**TASK:**
Analyze the search results and organize findings BY LAW FIRM, highlighting new laws, regulations, and proposed legislation.

Law Firms: ${firmList}
Legal Topics: ${topicList}
Countries: ${countryList}
Date Range of Interest: ${config.startDate} to ${config.endDate}

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

**Source:** [Title of Commentary](URL)

---

(Repeat for each law firm)

---

## Summary Table

| Law/Regulation | Status | Effective Date | Jurisdiction | Commenting Firm | Source Link |
|----------------|--------|----------------|--------------|-----------------|-------------|
[List all identified laws with clickable source links]

**IMPORTANT:**
- Start each firm section with the SPECIFIC LAWS/REGULATIONS they discuss
- Put the source link at the END of each firm's commentary section
- ONLY include laws explicitly mentioned in the search results
- Use the EXACT source URLs from the search results
- If a firm has no relevant commentaries, state "No relevant commentaries found for this firm"
`;

  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const data: ClaudeResponse = await response.json();

    const markdownText = data.content
      .filter((block): block is ClaudeContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n') || "No report generated.";

    // Better HTML conversion for Word export
    const htmlContent = generateWordHtml(markdownText, config);

    return {
      markdownContent: markdownText,
      htmlContent: htmlContent
    };

  } catch (error) {
    console.error("Error generating report:", error);
    throw error;
  }
};

function generateWordHtml(markdown: string, config: ReportConfig): string {
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
