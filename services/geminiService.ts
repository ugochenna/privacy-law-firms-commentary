import { GoogleGenAI } from "@google/genai";
import { ReportConfig, GeneratedReport } from "../types";
import { COUNTRIES, PHARMA_AREAS } from "../constants";

export const generateLegalReport = async (config: ReportConfig): Promise<GeneratedReport> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey });

  const firmList = config.selectedFirms.map(f => `${f.name} (${f.url})`).join(", ");
  const topicList = config.selectedTopics.map(t => t.label).join(", ");
  const countryList = COUNTRIES.join(", ");
  const areaList = PHARMA_AREAS.join(", ");

  const prompt = `
    I am an attorney in the regulatory-monitoring area in the life sciences field (pharmaceuticals).
    
    **TASK:**
    Conduct a targeted search for **commentaries, client alerts, and blog posts** published SPECIFICALLY by the following Law Firms:
    ${firmList}

    **SCOPE:**
    Search ONLY for content regarding these specific Legal Topics:
    ${topicList}

    **CONSTRAINTS:**
    1. **SOURCE RESTRICTION:** You must ONLY summarize insights, opinions, and analysis originating from the selected law firms listed above. **Do NOT** summarize general news, government press releases, or other sources unless a selected law firm has explicitly written a commentary about it.
    2. **IF NO COMMENTARY:** If none of the selected law firms have written about a specific topic in the date range, explicitly state: "No specific commentaries found from the selected firms for this topic."
    3. **GEOGRAPHIC SCOPE:** Limit findings to issues affecting these countries: ${countryList}.
    4. **DATE RANGE:** ${config.startDate} to ${config.endDate}.
    5. **PHARMACEUTICAL IMPACT:** For each finding, explain the specific impact on these areas: ${areaList}.

    **REPORT STRUCTURE:**
    1. **Executive Summary**: Brief overview of what the selected firms are focusing on.
    2. **Detailed Analysis by Topic** (Iterate through each selected topic):
       - **Firm Commentaries**: Summarize what specific selected firms (e.g., "DLA Piper states...", "Sidley Austin advises...") are saying.
       - **Pharmaceutical Impact**: How this affects the industry according to the firms.
       - **Source Links**: Provide direct URLs to the law firm's article.
    3. **Table of Authorities**: A summary table listing: [Law Firm] | [Topic] | [Headline/Summary] | [Date].

    **CRITICAL:**
    - Cite the specific law firm for every point made.
    - Provide URLs for verification.
    - Professional, analytical tone.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    const markdownText = response.text || "No report generated.";
    
    // Simple conversion to an HTML-like string for the Word export (this is a simplified approach)
    // In a real app, we'd use a library to convert MD to HTML properly.
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; }
            h1 { font-size: 18pt; color: #2e1065; }
            h2 { font-size: 16pt; color: #4c1d95; margin-top: 20px; }
            h3 { font-size: 14pt; color: #6d28d9; }
            table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f3f4f6; }
            a { color: #2563eb; text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>Regulatory Intelligence Report</h1>
          <p><strong>Date Range:</strong> ${config.startDate} to ${config.endDate}</p>
          <hr/>
          ${markdownText
            .replace(/\n/g, '<br/>')
            .replace(/# (.*?)<br\/>/g, '<h1>$1</h1>')
            .replace(/## (.*?)<br\/>/g, '<h2>$1</h2>')
            .replace(/### (.*?)<br\/>/g, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
          }
        </body>
      </html>
    `;

    return {
      markdownContent: markdownText,
      htmlContent: htmlContent
    };

  } catch (error) {
    console.error("Error generating report:", error);
    throw error;
  }
};