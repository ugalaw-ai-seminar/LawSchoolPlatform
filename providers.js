// Multi-provider AI routing, ported from the LOQUITUR web app.
// Harder tasks go to stronger models; easy tasks go to cheaper ones.

import Anthropic from '@anthropic-ai/sdk';

const MODEL_TIERS = {
  gemini: { easy: 'gemini-3.8-flash', normal: 'gemini-3.8-flash', hard: 'gemini-3.1-pro-preview' },
  claude: { easy: 'claude-haiku-4-5-20251001', normal: 'claude-sonnet-5', hard: 'claude-opus-5-5' },
  openai: { easy: 'gpt-4o-mini', normal: 'gpt-4o', hard: 'gpt-4o' },
};

// Tasks that use a specific model instead of their difficulty tier (same as the web app)
const TASK_MODEL_OVERRIDES = {
  claude: { outline_full: 'claude-fable-5-1' }, // most capable Claude model for outline building
};

// Claude models that accept server-side refusal fallback (fallbacks: "default")
const CLAUDE_REFUSAL_FALLBACK_MODELS = ['claude-fable-5-1', 'claude-opus-5-5'];

// Output budget per provider. Claude streams, so it can be large: current Claude models think before
// answering and the thinking counts toward max_tokens, so a small cap can end a long outline with no text.
const DEFAULT_MAX_TOKENS = { claude: 64000, gemini: 8192, openai: 8192 };

// Fallback chain when a model is rejected by the provider (wrong tier, retired, etc.)
const FALLBACKS = {
  gemini: ['gemini-3.8-flash', 'gemini-2.5-flash'],
  claude: ['claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o-mini'],
};

const HARD = ['hypo', 'outline_full', 'career', 'bar', 'issue', 'draft_cite', 'cold_call', 'grade_text', 'exam_hypo'];
const EASY = ['cite_gen', 'cite_fix', 'quick', 'diagram'];

export function getDifficulty(task) {
  if (['easy', 'normal', 'hard'].includes(task)) return task;
  if (HARD.includes(task)) return 'hard';
  if (EASY.includes(task)) return 'easy';
  return 'normal';
}

const FORMAT_RULES = `

FORMATTING RULES:
- Format responses using clean markdown: use # ## ### for headers, numbered lists, and dash-based bullet lists.
- Use **bold** sparingly for key terms only.
- Keep formatting clean, professional, and easy to scan.`;

export function providerConfig() {
  const provider = (process.env.LOQUITUR_PROVIDER || '').toLowerCase();
  const key =
    process.env.LOQUITUR_API_KEY ||
    (provider === 'claude' && process.env.ANTHROPIC_API_KEY) ||
    (provider === 'gemini' && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) ||
    (provider === 'openai' && process.env.OPENAI_API_KEY) ||
    '';
  if (!provider || !key) return null;
  if (!MODEL_TIERS[provider]) throw new Error(`Unknown LOQUITUR_PROVIDER "${provider}". Use gemini, claude, or openai.`);
  return { provider, key };
}

export function modelFor(provider, difficulty) {
  const override = process.env[`LOQUITUR_MODEL_${difficulty.toUpperCase()}`];
  return override || MODEL_TIERS[provider][difficulty] || MODEL_TIERS[provider].normal;
}

/** Model for a specific task: an explicit LOQUITUR_MODEL_<TIER> setting wins, then task overrides, then the tier. */
export function modelForTask(provider, task) {
  const difficulty = getDifficulty(task);
  if (process.env[`LOQUITUR_MODEL_${difficulty.toUpperCase()}`]) return modelFor(provider, difficulty);
  return TASK_MODEL_OVERRIDES[provider]?.[task] || modelFor(provider, difficulty);
}

class ModelError extends Error {}

async function callGemini(key, model, system, prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: system + FORMAT_RULES }] },
    generationConfig: { maxOutputTokens: maxTokens },
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || `HTTP ${r.status}`;
    if (r.status === 404 || /model/i.test(msg)) throw new ModelError(msg);
    throw new Error(msg);
  }
  if (j.promptFeedback?.blockReason) throw new Error(`Blocked by Gemini safety filter (${j.promptFeedback.blockReason})`);
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new Error(`Gemini returned no text (finishReason: ${j.candidates?.[0]?.finishReason || 'unknown'})`);
  return text;
}

async function callClaude(key, model, system, prompt, maxTokens) {
  // Official SDK with streaming: long outlines on Fable/Opus can run past Node fetch's 5-minute
  // wait for response headers, and finalMessage() assembles the streamed reply (including fallbacks).
  const client = new Anthropic({ apiKey: key, fetch: (...args) => globalThis.fetch(...args) });
  const params = { model, max_tokens: maxTokens, system: system + FORMAT_RULES, messages: [{ role: 'user', content: prompt }] };
  let msg;
  try {
    msg = CLAUDE_REFUSAL_FALLBACK_MODELS.includes(model)
      // If a safety classifier declines, the API retries on the recommended fallback model in the same stream
      ? await client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
      : await client.messages.stream(params).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError || (e instanceof Anthropic.BadRequestError && /model/i.test(e.message))) throw new ModelError(e.message);
    throw e;
  }
  if (msg.stop_reason === 'refusal') {
    // Every model in the chain declined; any partial text is discarded
    throw new Error('Claude declined this request. Try rephrasing it, or use another provider.');
  }
  // After a mid-stream fallback the second model continues the first one's text, so join all text blocks
  const text = (msg.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('');
  if (msg.stop_reason === 'max_tokens') {
    if (!text) throw new Error('Claude ran out of room before writing an answer. Try shorter notes, or build the outline in smaller sections.');
    return { text: text + '\n\n---\n*Note: this response reached the length limit and may be cut off at the end.*', model: msg.model };
  }
  if (!text) throw new Error(`Claude returned no text (stop_reason: ${msg.stop_reason || 'unknown'})`);
  return { text, model: msg.model };
}

async function callOpenAI(key, model, system, prompt, maxTokens) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system + FORMAT_RULES }, { role: 'user', content: prompt }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const msg = j.error?.message || `HTTP ${r.status}`;
    if (r.status === 404 || /model/i.test(msg)) throw new ModelError(msg);
    throw new Error(msg);
  }
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned no text');
  return text;
}

const CALLERS = { gemini: callGemini, claude: callClaude, openai: callOpenAI };

/**
 * Run a task through the configured provider. Returns { text, model }.
 * Throws if no provider is configured (callers should check providerConfig() first).
 */
export async function runAI(cfg, system, prompt, task = 'normal', maxTokens = DEFAULT_MAX_TOKENS[cfg.provider] || 8192) {
  const difficulty = getDifficulty(task);
  const first = modelForTask(cfg.provider, task);
  // If a task-specific model (e.g. Fable for outlines) is rejected, try the tier's model before the general fallbacks
  const chain = [...new Set([first, modelFor(cfg.provider, difficulty), ...FALLBACKS[cfg.provider]])];
  const safePrompt = prompt.length > 60000 ? prompt.slice(0, 60000) + '\n\n[Content truncated]' : prompt;
  let lastErr;
  for (const model of chain) {
    try {
      const out = await CALLERS[cfg.provider](cfg.key, model, system, safePrompt, maxTokens);
      // Claude reports the model that actually served the reply (it can differ after a refusal fallback)
      return typeof out === 'string' ? { text: out, model } : out;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ModelError)) throw e;
      console.error(`[loquitur] model ${model} rejected (${e.message}); trying next`);
    }
  }
  throw lastErr;
}
