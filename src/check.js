// The check itself: every sitemap URL against every chosen crawler.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, resolveAgents } from './agents.js'
import { load as defaultLoad } from './fetch.js'
import { allows, names, parseRobots } from './robots.js'
import { collectUrls } from './sitemap.js'

const isUrl = (s) => /^https?:\/\//i.test(s)

/**
 * A loader that serves URLs from a local build folder when the file exists
 * there (`https://example.com/sitemap-0.xml` -> `dist/sitemap-0.xml`), so a CI
 * job can check the build before it is deployed.
 */
export function withSiteDir(siteDir, load = defaultLoad) {
  if (!siteDir) return load
  return async (source, opts) => {
    if (isUrl(source)) {
      const local = join(siteDir, decodeURIComponent(new URL(source).pathname))
      if (statSync(local, { throwIfNoEntry: false })?.isFile()) return load(local, opts)
    }
    return load(source, opts)
  }
}

/**
 * How a crawler treats a robots.txt response (RFC 9309 section 2.3.1):
 * 2xx: obey the file. 4xx: no rules, crawl everything. 5xx, 429 or no answer:
 * assume everything is disallowed. Google treats 429 like a 5xx, so we do too.
 */
export function robotsState(status) {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 400 && status < 500 && status !== 429) return 'unavailable'
  return 'unreachable'
}

function ruleText(r) {
  return r ? `${r.allow ? 'Allow' : 'Disallow'}: ${r.pattern} (line ${r.line})` : ''
}

/**
 * @param {object} o
 * @param {string[]} o.sitemaps sitemap URLs or files
 * @param {string[]} [o.urls] extra page URLs
 * @param {string} [o.robots] one robots.txt (file or URL) used for every origin
 * @param {string} [o.siteDir] local build folder, see withSiteDir
 * @param {string} [o.agents] agent spec, see resolveAgents
 * @param {object} o.list robots.json contents
 * @param {boolean} [o.requireNamed] fail when an agent only falls through to `*`
 */
export async function check(o) {
  const load = withSiteDir(o.siteDir, o.load ?? defaultLoad)
  const agents = resolveAgents(o.agents, o.list)
  const problems = []
  const warnings = []

  const found = await collectUrls(o.sitemaps ?? [], load, { maxUrls: o.maxUrls ?? 50000 })
  problems.push(...found.problems.map((p) => `sitemap ${p}`))
  if (found.truncated) warnings.push(`stopped after ${o.maxUrls ?? 50000} URLs or 500 sitemaps`)
  const pages = [...new Set([...found.urls, ...(o.urls ?? [])])].filter((u) => {
    if (isUrl(u)) return true
    warnings.push(`skipped ${u}: not an absolute http(s) URL`)
    return false
  })

  // robots.txt is per origin (scheme, host, port), so group pages by origin.
  const byOrigin = new Map()
  for (const u of pages) {
    const origin = new URL(u).origin
    if (!byOrigin.has(origin)) byOrigin.set(origin, [])
    byOrigin.get(origin).push(u)
  }

  let robotsSource = o.robots
  if (!robotsSource && o.siteDir && existsSync(join(o.siteDir, 'robots.txt'))) robotsSource = join(o.siteDir, 'robots.txt')
  const shared = robotsSource ? await load(robotsSource) : null
  if (shared && shared.status !== 200) {
    problems.push(`robots.txt ${robotsSource}: ${shared.status ? `HTTP ${shared.status}` : shared.error}`)
  }

  const origins = []
  const results = new Map(agents.map((a) => [a, { name: a, named: true, blocked: [], info: describe(a, o.list) }]))
  for (const [origin, urls] of byOrigin) {
    const res = shared ?? (await load(`${origin}/robots.txt`))
    const state = shared ? (shared.status === 200 ? 'ok' : 'unreachable') : robotsState(res.status)
    const robots = state === 'ok' ? parseRobots(res.text) : null
    origins.push({ origin, source: robotsSource ?? `${origin}/robots.txt`, status: res.status, state, pages: urls.length, truncated: robots?.truncated ?? false })
    if (state === 'unreachable' && !shared) {
      problems.push(`${origin}/robots.txt answered ${res.status ? `HTTP ${res.status}` : res.error}. ` +
        'Crawlers treat that as "disallow everything", so every page on this origin counts as blocked.')
    }
    if (robots?.truncated) problems.push(`${origin}/robots.txt is over 512 KiB; only the first part was read`)
    for (const agent of agents) {
      const r = results.get(agent)
      if (robots && !names(robots, agent)) r.named = false
      for (const u of urls) {
        if (state === 'unavailable') continue
        if (!robots) {
          r.blocked.push({ url: u, rule: 'robots.txt unreachable' })
          continue
        }
        const p = new URL(u)
        const verdict = allows(robots, agent, p.pathname + p.search)
        if (!verdict.allowed) r.blocked.push({ url: u, rule: ruleText(verdict.rule), group: verdict.group })
      }
    }
  }

  const agentResults = [...results.values()]
  for (const r of agentResults) {
    if (r.blocked.length) problems.push(`${r.name}: blocked from ${r.blocked.length} of ${pages.length} URL(s)`)
    if (o.requireNamed && !r.named) problems.push(`${r.name}: no User-agent group names it (it falls through to *)`)
  }
  if (!pages.length) problems.push('no page URLs to check')

  return {
    ok: problems.length === 0,
    pages: pages.length,
    sitemaps: found.sitemaps,
    agents: agentResults,
    origins,
    problems,
    warnings,
  }
}

/** Human-readable report. */
export function format(report, { show = 5 } = {}) {
  const out = []
  const n = report.agents.length
  for (const o of report.origins) {
    const note = { ok: '', unavailable: ' (no robots.txt rules apply)', unreachable: ' (treated as disallow all)' }[o.state]
    const how = isUrl(o.source) ? (o.status ? `HTTP ${o.status}` : 'no answer') : o.status ? 'local file' : 'unreadable'
    out.push(`${o.origin}: robots.txt from ${o.source}, ${how}${note}, ${o.pages} page(s)`)
  }
  for (const a of report.agents) {
    const mark = a.blocked.length ? 'BLOCKED' : 'ok     '
    const named = a.named ? '' : '  (no group of its own, uses *)'
    out.push(`${mark} ${a.name}${a.blocked.length ? `  ${a.blocked.length} URL(s)` : ''}${named}`)
    for (const b of a.blocked.slice(0, show)) out.push(`          ${b.url}  ${b.rule}`)
    if (a.blocked.length > show) out.push(`          ... and ${a.blocked.length - show} more`)
  }
  for (const w of report.warnings) out.push(`warning: ${w}`)
  if (report.ok) {
    out.push(`answer-crawler-check: OK, ${n} crawler(s) allowed on all ${report.pages} URL(s)`)
  } else {
    out.push(`answer-crawler-check: FAILED, ${report.problems.length} problem(s)`)
    for (const p of report.problems) out.push(`  ${p}`)
  }
  return out.join('\n')
}
