import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { loadList } from '../src/agents.js'
import { check, format, robotsState } from '../src/check.js'
import { parseSitemap } from '../src/sitemap.js'

const list = loadList()
let server
let base
const routes = new Map()

before(async () => {
  server = createServer((req, res) => {
    const r = routes.get(req.url)
    if (!r) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(r.status ?? 200, r.headers ?? {}).end(r.body ?? '')
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const urlset = (...paths) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
    .map((p) => `<url><loc>${base}${p}</loc></url>`)
    .join('')}</urlset>`

function site(robots, pages = ['/', '/blog/post', '/docs/a']) {
  routes.clear()
  routes.set('/sitemap.xml', { body: urlset(...pages) })
  if (robots !== null) routes.set('/robots.txt', typeof robots === 'string' ? { body: robots } : robots)
}

test('parseSitemap reads urlset, index, namespaces, entities and CDATA', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc> https://e.com/a?x=1&amp;y=2 </loc></url></urlset>'), {
    kind: 'urlset',
    locs: ['https://e.com/a?x=1&y=2'],
  })
  assert.equal(parseSitemap('<sm:sitemapindex><sm:sitemap><sm:loc>u</sm:loc></sm:sitemap></sm:sitemapindex>').kind, 'index')
  assert.deepEqual(parseSitemap('<urlset><url><loc><![CDATA[https://e.com/b]]></loc></url></urlset>').locs, ['https://e.com/b'])
})

test('robotsState follows RFC 9309', () => {
  assert.equal(robotsState(200), 'ok')
  assert.equal(robotsState(404), 'unavailable')
  assert.equal(robotsState(403), 'unavailable')
  assert.equal(robotsState(429), 'unreachable')
  assert.equal(robotsState(503), 'unreachable')
  assert.equal(robotsState(0), 'unreachable')
})

test('an open robots.txt passes', async () => {
  site('User-agent: *\nAllow: /\n')
  const r = await check({ sitemaps: [`${base}/sitemap.xml`], list })
  assert.equal(r.ok, true, r.problems.join('\n'))
  assert.equal(r.pages, 3)
})

test('a crawler blocked on one path fails, with the rule quoted', async () => {
  site('User-agent: *\nAllow: /\n\nUser-agent: Claude-SearchBot\nDisallow: /docs/\n')
  const r = await check({ sitemaps: [`${base}/sitemap.xml`], list })
  assert.equal(r.ok, false)
  const claude = r.agents.find((a) => a.name === 'Claude-SearchBot')
  assert.deepEqual(claude.blocked.map((b) => b.url), [`${base}/docs/a`])
  assert.match(claude.blocked[0].rule, /Disallow: \/docs\/ \(line 5\)/)
  assert.match(format(r), /BLOCKED Claude-SearchBot/)
  assert.equal(r.agents.filter((a) => a.blocked.length).length, 1)
})

test('blocking only training crawlers passes the default preset', async () => {
  site('User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n')
  assert.equal((await check({ sitemaps: [`${base}/sitemap.xml`], list })).ok, true)
  const all = await check({ sitemaps: [`${base}/sitemap.xml`], list, agents: 'answer,GPTBot' })
  assert.equal(all.ok, false)
})

test('a wildcard Disallow blocks every crawler without its own group', async () => {
  site('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n')
  const r = await check({ sitemaps: [`${base}/sitemap.xml`], list })
  const blocked = r.agents.filter((a) => a.blocked.length).map((a) => a.name)
  assert.ok(!blocked.includes('OAI-SearchBot'))
  assert.ok(blocked.includes('PerplexityBot'))
})

test('--require-named fails crawlers that only fall through to *', async () => {
  site('User-agent: *\nAllow: /\n')
  const r = await check({ sitemaps: [`${base}/sitemap.xml`], list, requireNamed: true, agents: 'GPTBot' })
  assert.equal(r.ok, false)
  assert.match(r.problems.join(), /GPTBot: no User-agent group/)
})

test('a missing robots.txt means everything is allowed', async () => {
  site(null)
  assert.equal((await check({ sitemaps: [`${base}/sitemap.xml`], list })).ok, true)
})

test('a 503 robots.txt counts as blocked everywhere', async () => {
  site({ status: 503 })
  const r = await check({ sitemaps: [`${base}/sitemap.xml`], list, agents: 'PerplexityBot' })
  assert.equal(r.ok, false)
  assert.equal(r.agents[0].blocked.length, 3)
  assert.match(r.problems.join(), /disallow everything/)
})

test('sitemap indexes and gzip are followed', async () => {
  site('User-agent: *\nDisallow: /b\n', [])
  routes.set('/index.xml', {
    body: `<sitemapindex><sitemap><loc>${base}/s1.xml</loc></sitemap><sitemap><loc>${base}/s2.xml.gz</loc></sitemap></sitemapindex>`,
  })
  routes.set('/s1.xml', { body: urlset('/a') })
  routes.set('/s2.xml.gz', { body: gzipSync(urlset('/b')) })
  const r = await check({ sitemaps: [`${base}/index.xml`], list, agents: 'Bingbot' })
  assert.equal(r.pages, 2)
  assert.deepEqual(r.agents[0].blocked.map((b) => b.url), [`${base}/b`])
})

test('a broken sitemap is a problem, and no URLs at all is a problem', async () => {
  site('User-agent: *\nAllow: /\n', [])
  const r = await check({ sitemaps: [`${base}/missing.xml`], list })
  assert.equal(r.ok, false)
  assert.match(r.problems.join('\n'), /HTTP 404/)
  assert.match(r.problems.join('\n'), /no page URLs/)
})

test('--site-dir reads the local build and never touches the network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acc-'))
  writeFileSync(join(dir, 'sitemap-index.xml'), '<sitemapindex><sitemap><loc>https://example.invalid/sitemap-0.xml</loc></sitemap></sitemapindex>')
  writeFileSync(join(dir, 'sitemap-0.xml'), '<urlset><url><loc>https://example.invalid/</loc></url><url><loc>https://example.invalid/p/</loc></url></urlset>')
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\nUser-agent: ChatGPT-User\nDisallow: /p/\n')
  const r = await check({ sitemaps: [join(dir, 'sitemap-index.xml')], siteDir: dir, list })
  assert.equal(r.pages, 2)
  assert.deepEqual(r.agents.filter((a) => a.blocked.length).map((a) => a.name), ['ChatGPT-User'])
})

function cli(args) {
  return new Promise((ok) => {
    execFile(process.execPath, [new URL('../bin/answer-crawler-check.js', import.meta.url).pathname, ...args], (err, stdout, stderr) =>
      ok({ code: err ? err.code : 0, stdout, stderr }))
  })
}

test('CLI exit codes: 0 open, 1 blocked, 2 bad input, report-only', async () => {
  site('User-agent: *\nAllow: /\n')
  assert.equal((await cli([`${base}/sitemap.xml`])).code, 0)
  site('User-agent: PerplexityBot\nDisallow: /\n')
  const bad = await cli([`${base}/sitemap.xml`])
  assert.equal(bad.code, 1)
  assert.match(bad.stdout, /FAILED/)
  assert.equal((await cli([`${base}/sitemap.xml`, '--report-only'])).code, 0)
  assert.equal((await cli([])).code, 2)
  assert.equal((await cli(['--bogus'])).code, 2)
})

test('CLI --json - prints the report as JSON on stdout', async () => {
  site('User-agent: *\nAllow: /\n')
  const r = await cli([`${base}/sitemap.xml`, '--json', '-', '--agents', 'GPTBot'])
  const j = JSON.parse(r.stdout)
  assert.equal(j.ok, true)
  assert.equal(j.agents[0].name, 'GPTBot')
})
