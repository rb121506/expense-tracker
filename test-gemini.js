require('dotenv').config();

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

function redactKey(key) {
  if (!key) return '(missing)';
  if (key.length <= 8) return `${key.slice(0, 2)}...`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function summarizeGeminiError(status, body) {
  try {
    const parsed = JSON.parse(body);
    const err = parsed.error || parsed;
    return {
      status,
      code: err.status || err.code || null,
      message: err.message || 'Gemini request failed.',
    };
  } catch (_err) {
    return { status, code: null, message: body || 'Gemini request failed.' };
  }
}

async function main() {
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.error('GEMINI_API_KEY is not configured. Add it to .env before running this test.');
    process.exitCode = 1;
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  console.log(`Testing Gemini model: ${model}`);
  console.log(`Using key: ${redactKey(apiKey)}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with only: ok' }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 10,
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = summarizeGeminiError(res.status, text);
    console.error(`Gemini test failed (${err.status}${err.code ? ` ${err.code}` : ''}): ${err.message}`);
    if (res.status === 429 || err.code === 'RESOURCE_EXHAUSTED') {
      console.error('This is a quota/rate-limit issue for the Google AI Studio project, not a local code syntax issue.');
    }
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(text);
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '(empty response)';
  console.log(`Gemini test succeeded: ${reply.trim()}`);
}

main().catch((err) => {
  console.error(`Gemini test crashed: ${err.message}`);
  process.exitCode = 1;
});
