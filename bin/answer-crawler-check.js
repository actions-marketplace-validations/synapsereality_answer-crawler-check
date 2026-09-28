#!/usr/bin/env node
// Exit 0 when every chosen crawler may fetch every URL, 1 when not, 2 on bad input.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { UPSTREAM_URL, loadList, missingUpstream, resolveAgents } from '../src/agents.js'
import { check, format } from '../src/check.js'
import { load } from '../src/fetch.js'

const HELP = `Usage: answer-crawler-check [options] <sitemap>...

Reads each sitemap (URL or file, gzipped or not, indexes followed), then tests
every page URL against the robots.txt of its site for every chosen AI answer
crawler. Fails when any of them is blocked.

Options:
  --agents SPEC      answer (default), answer-extended, all, or names: A,B,C
                     Presets and names mix: answer,GPTBot
  --robots FILE|URL  use this robots.txt for every site instead of fetching it
  --site-dir DIR     read sitemaps and robots.txt from a local build folder
                     when the file exists there (check before deploying)
  --url URL          also check this page (repeatable)
  --require-named    fail when a crawler has no User-agent group of its own
  --list FILE|URL    crawler list in ai.robots.txt robots.json format;
                     "latest" fetches the current upstream file
  --max-urls N       stop after N page URLs (default 50000)
  --json FILE        write the full report as JSON ("-" for stdout)
  --report-only      print the report but always exit 0
  --list-agents      print the crawlers SPEC resolves to, then exit
  -h, --help         this help
  -v, --version      version

Docs: https://synapsereality.io/open-source/answer-crawler-check/
Crawler list: ai-robots-txt/ai.robots.txt (MIT), vendored in data/robots.json`

async function main(argv) {
  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        agents: { type: 'string', default: 'answer' },
        robots: { type: 'string' },
        'site-dir': { type: 'string' },
        url: { type: 'string', multiple: true, default: [] },
        'require-named': { type: 'boolean', default: false },
        list: { type: 'string' },
        'max-urls': { type: 'string', default: '50000' },
        json: { type: 'string' },
        'report-only': { type: 'boolean', default: false },
        'list-agents': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    })
  } catch (e) {
    console.error(`answer-crawler-check: ${e.message}\n\n${HELP}`)
    return 2
  }
  const { values: v, positionals } = args
  if (v.help) {
    console.log(HELP)
    return 0
  }
  if (v.version) {
    console.log('answer-crawler-check 0.1.0')
    return 0
  }

  let list
  if (v.list) {
    const src = v.list === 'latest' ? UPSTREAM_URL : v.list
    const res = await load(src)
    try {
      if (res.status !== 200) throw new Error(res.error || `HTTP ${res.status}`)
      list = JSON.parse(res.text)
    } catch (e) {
      console.error(`answer-crawler-check: could not read crawler list ${src}: ${e.message}`)
      return 2
    }
  } else {
    list = loadList()
  }

  if (v['list-agents']) {
    for (const a of resolveAgents(v.agents, list)) console.log(a)
    return 0
  }
  if (!positionals.length && !v.url.length) {
    console.error(`answer-crawler-check: give at least one sitemap or --url\n\n${HELP}`)
    return 2
  }
  const maxUrls = Number.parseInt(v['max-urls'], 10)
  if (!(maxUrls > 0)) {
    console.error('answer-crawler-check: --max-urls must be a positive number')
    return 2
  }
  const gap = missingUpstream(list)
  if (gap.length) console.error(`note: not in the crawler list, checked by name anyway: ${gap.join(', ')}`)

  const report = await check({
    sitemaps: positionals,
    urls: v.url,
    robots: v.robots,
    siteDir: v['site-dir'],
    agents: v.agents,
    list,
    requireNamed: v['require-named'],
    maxUrls,
  })
  const toStdout = v.json === '-'
  const text = format(report)
  if (toStdout) console.error(text)
  else console.log(text)
  if (v.json) {
    const payload = JSON.stringify(report, null, 2)
    if (toStdout) console.log(payload)
    else writeFileSync(v.json, payload + '\n')
  }
  return report.ok || v['report-only'] ? 0 : 1
}

process.exitCode = await main(process.argv.slice(2))
