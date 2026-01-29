export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const { prompt, model } = req.body;

    // Select model based on user choice
    const MODEL_NAME = model === 'opus'
      ? 'claude-opus-4-5-20251101'
      : 'claude-sonnet-4-20250514';

    console.log('[Claude] Using model:', MODEL_NAME);

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
          model: MODEL_NAME,
          max_tokens: 16000,
          stream: true,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
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

    // Set SSE headers to keep the connection alive on Vercel
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
}
