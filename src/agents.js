// Which crawlers to test. The names and descriptions come from the
// ai-robots-txt/ai.robots.txt project (MIT), vendored in data/robots.json.
// See data/UPSTREAM.md for the commit it was taken from.
import { readFileSync } from 'node:fs'

export const UPSTREAM_URL = 'https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json'

/**
 * Crawlers that fetch pages when an AI answer is being written, or that build
 * the search index those answers cite. Blocking one of these can take a site
 * out of that engine's answers, which is the mistake this tool exists to catch.
 * Training-only crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot, ...) are
 * left out on purpose: blocking them is a legitimate choice.
 *
 * Googlebot and Bingbot are not in the upstream list, because they are search
 * crawlers, but Google's AI features and Copilot answer from their indexes.
 */
export const ANSWER_TIME = [
  'OAI-SearchBot', // ChatGPT search
  'ChatGPT-User', // ChatGPT fetching a page for a user
  'Claude-SearchBot', // Claude's search index
  'Claude-User', // Claude fetching a page for a user
  'PerplexityBot', // Perplexity's index
  'Perplexity-User', // Perplexity fetching a page for a user
  'DuckAssistBot', // DuckDuckGo's AI answers
  'MistralAI-User', // Le Chat fetching a page for a user
  'Applebot', // Siri, Spotlight and Safari suggestions
  'Googlebot', // Google Search, AI Overviews and AI Mode
  'Bingbot', // Bing, and Copilot answers
]
const NOT_UPSTREAM = new Set(['googlebot', 'bingbot'])

// Upstream `function` values that describe answer-time fetching.
const ANSWER_FUNCTIONS = new Set(['ai search crawlers', 'ai assistants', 'search result generation.'])

/** Load a robots.json-shaped object: {Name: {operator, function, ...}}. */
export function loadList(path = new URL('../data/robots.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Case-insensitive de-duplication that keeps the first spelling seen. */
function unique(names) {
  const seen = new Set()
  return names.filter((n) => {
    const k = n.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Turn an `--agents` value into a list of crawler names.
 *   answer           ANSWER_TIME (default)
 *   answer-extended  ANSWER_TIME plus every upstream agent whose function is AI search or an assistant
 *   all              every upstream agent, plus Googlebot and Bingbot
 *   A,B,C            exactly these names
 * Presets and names can be mixed: `answer,GPTBot`.
 */
export function resolveAgents(spec, list) {
  const out = []
  for (const part of String(spec || 'answer').split(',').map((s) => s.trim()).filter(Boolean)) {
    const key = part.toLowerCase()
    if (key === 'answer') out.push(...ANSWER_TIME)
    else if (key === 'answer-extended') {
      out.push(...ANSWER_TIME)
      for (const [name, info] of Object.entries(list)) {
        if (ANSWER_FUNCTIONS.has(String(info.function || '').trim().toLowerCase())) out.push(name)
      }
    } else if (key === 'all') out.push(...Object.keys(list), 'Googlebot', 'Bingbot')
    else out.push(part)
  }
  return unique(out)
}

/** Curated names that the upstream list does not know. Should be empty; a test enforces it. */
export function missingUpstream(list) {
  const known = new Set(Object.keys(list).map((k) => k.toLowerCase()))
  return ANSWER_TIME.filter((n) => !NOT_UPSTREAM.has(n.toLowerCase()) && !known.has(n.toLowerCase()))
}

/** Operator and description for a name, if upstream has it. */
export function describe(name, list) {
  const hit = Object.entries(list).find(([k]) => k.toLowerCase() === name.toLowerCase())
  return hit ? hit[1] : null
}
