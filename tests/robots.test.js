import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentToken, allows, matches, names, normPath, parseRobots } from '../src/robots.js'

const allowed = (txt, agent, path) => allows(parseRobots(txt), agent, path).allowed

test('a named group overrides the wildcard group entirely', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n'
  assert.equal(allowed(txt, 'OAI-SearchBot', '/page'), true)
  assert.equal(allowed(txt, 'PerplexityBot', '/page'), false)
})

test('a named group does not inherit the wildcard rules', () => {
  const txt = 'User-agent: *\nDisallow: /private/\n\nUser-agent: GPTBot\nDisallow: /x/\n'
  assert.equal(allowed(txt, 'GPTBot', '/private/a'), true)
})

test('agent names match case-insensitively and by product token', () => {
  const txt = 'User-agent: claude-searchbot/1.0 (+https://anthropic.com)\nDisallow: /\n'
  assert.equal(allowed(txt, 'Claude-SearchBot', '/'), false)
  assert.equal(agentToken('GPTBot/1.1 (+https://openai.com/gptbot)'), 'gptbot')
  assert.equal(agentToken('AI2Bot-DeepResearchEval'), 'ai2bot-deepresearcheval')
  assert.equal(agentToken('bigsur.ai'), 'bigsur.ai')
})

test('consecutive User-agent lines share one group, and Sitemap does not split it', () => {
  const txt = 'User-agent: GPTBot\nSitemap: https://e.com/s.xml\nUser-agent: ClaudeBot\nDisallow: /\n'
  const r = parseRobots(txt)
  assert.equal(allows(r, 'GPTBot', '/a').allowed, false)
  assert.equal(allows(r, 'ClaudeBot', '/a').allowed, false)
  assert.deepEqual(r.sitemaps, ['https://e.com/s.xml'])
})

test('groups naming the same agent twice are merged', () => {
  const txt = 'User-agent: Bingbot\nAllow: /\n\nUser-agent: Bingbot\nDisallow: /secret\n'
  assert.equal(allowed(txt, 'Bingbot', '/secret/x'), false)
  assert.equal(allowed(txt, 'Bingbot', '/open'), true)
})

test('longest match wins and Allow wins a tie', () => {
  const txt = 'User-agent: *\nDisallow: /blog/\nAllow: /blog/public/\nDisallow: /tie\nAllow: /tie\n'
  assert.equal(allowed(txt, 'x', '/blog/secret'), false)
  assert.equal(allowed(txt, 'x', '/blog/public/post'), true)
  assert.equal(allowed(txt, 'x', '/tie'), true)
})

test('wildcards and end anchors', () => {
  assert.equal(matches('/*.pdf$', '/files/a.pdf'), true)
  assert.equal(matches('/*.pdf$', '/files/a.pdf?x=1'), false)
  assert.equal(matches('/*.html', '/a/b.html?x'), true)
  assert.equal(matches('/', '/anything'), true)
  assert.equal(matches('/a$', '/ab'), false)
  assert.equal(matches('/a*b*c$', '/axxbyyc'), true)
  const txt = 'User-agent: PerplexityBot\nDisallow: /*\n'
  assert.equal(allowed(txt, 'PerplexityBot', '/'), false)
})

test('a hostile pattern does not backtrack exponentially', () => {
  const t = Date.now()
  matches('/*a*a*a*a*a*a*a*a*a*a*a*a*b$', '/' + 'a'.repeat(3000))
  assert.ok(Date.now() - t < 2000)
})

test('empty Disallow allows everything; no rules at all allows everything', () => {
  assert.equal(allowed('User-agent: *\nDisallow:\n', 'x', '/a'), true)
  assert.equal(allowed('', 'x', '/a'), true)
  assert.equal(allowed('User-agent: GPTBot\n', 'GPTBot', '/a'), true)
})

test('robots.txt itself is always allowed', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /\n', 'x', '/robots.txt'), true)
})

test('comments, CRLF and a byte order mark', () => {
  const txt = '﻿User-agent: * # everyone\r\nDisallow: /tmp # scratch\r\n'
  assert.equal(allowed(txt, 'x', '/tmp/1'), false)
  assert.equal(allowed(txt, 'x', '/ok'), true)
})

test('non-ASCII paths and escapes compare equal', () => {
  assert.equal(normPath('/über'), '/%C3%BCber')
  assert.equal(normPath('/%c3%bcber'), '/%C3%BCber')
  assert.equal(allowed('User-agent: *\nDisallow: /über\n', 'x', '/%C3%BCber/a'), false)
  assert.equal(allowed('User-agent: *\nDisallow: /%E2%82%AC\n', 'x', '/€'), false)
})

test('the rule that decided is reported with its line', () => {
  const v = allows(parseRobots('User-agent: *\n\nDisallow: /admin\n'), 'x', '/admin/a')
  assert.deepEqual(v.rule, { allow: false, pattern: '/admin', line: 3 })
  assert.equal(v.group, '*')
})

test('names() tells a named group from a wildcard fallback', () => {
  const r = parseRobots('User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /\n')
  assert.equal(names(r, 'gptbot'), true)
  assert.equal(names(r, 'ClaudeBot'), false)
})

test('an oversized file is marked truncated', () => {
  const big = 'User-agent: *\n' + 'Disallow: /x\n'.repeat(60000)
  assert.equal(parseRobots(big).truncated, true)
})
