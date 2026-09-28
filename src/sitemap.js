// Sitemap reading: <urlset> and <sitemapindex>, plain or gzipped, local or remote.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function unescapeXml(s) {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .trim()
}

/** @returns {{kind: 'index'|'urlset'|'unknown', locs: string[]}} */
export function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<(?:\w+:)?loc>\s*([\s\S]*?)\s*<\/(?:\w+:)?loc>/g)].map((m) => unescapeXml(m[1]))
  const kind = /<(?:\w+:)?sitemapindex[\s>]/.test(xml) ? 'index' : /<(?:\w+:)?urlset[\s>]/.test(xml) ? 'urlset' : 'unknown'
  return { kind, locs }
}

/**
 * Collect page URLs from one or more sitemaps, following sitemap indexes.
 * `load` is injected (see fetch.js). Problems are returned, not thrown, so one
 * broken child sitemap does not hide the rest.
 */
export async function collectUrls(sources, load, { maxUrls = 50000, maxSitemaps = 500 } = {}) {
  const urls = new Set()
  const problems = []
  const queue = [...sources]
  const seen = new Set()
  let truncated = false
  while (queue.length) {
    const src = queue.shift()
    if (seen.has(src)) continue
    if (seen.size >= maxSitemaps) {
      truncated = true
      break
    }
    seen.add(src)
    let res
    try {
      res = await load(src)
    } catch (e) {
      problems.push(`${src}: ${e.message}`)
      continue
    }
    if (res.status !== 200) {
      problems.push(`${src}: ${res.status ? `HTTP ${res.status}` : res.error}`)
      continue
    }
    const { kind, locs } = parseSitemap(res.text)
    if (kind === 'unknown') {
      problems.push(`${src}: not a sitemap (no <urlset> or <sitemapindex>)`)
      continue
    }
    for (const loc of locs) {
      if (kind === 'index') queue.push(loc)
      else if (urls.size < maxUrls) urls.add(loc)
      else truncated = true
    }
  }
  return { urls: [...urls], problems, sitemaps: seen.size, truncated }
}
