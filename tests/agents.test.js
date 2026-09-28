import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANSWER_TIME, describe, loadList, missingUpstream, resolveAgents } from '../src/agents.js'

const list = loadList()

test('the vendored list parses and every curated crawler is in it', () => {
  assert.ok(Object.keys(list).length > 100)
  assert.deepEqual(missingUpstream(list), [])
})

test('presets resolve and de-duplicate case-insensitively', () => {
  assert.deepEqual(resolveAgents('answer', list), ANSWER_TIME)
  const ext = resolveAgents('answer-extended', list)
  assert.ok(ext.length > ANSWER_TIME.length)
  assert.equal(new Set(ext.map((a) => a.toLowerCase())).size, ext.length)
  const all = resolveAgents('all', list)
  assert.ok(all.includes('GPTBot') && all.includes('Googlebot'))
  assert.deepEqual(resolveAgents('answer,gptbot,GPTBot', list), [...ANSWER_TIME, 'gptbot'])
  assert.deepEqual(resolveAgents('Foo, Bar', list), ['Foo', 'Bar'])
})

test('training crawlers are not in the answer preset', () => {
  for (const t of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot']) assert.ok(!ANSWER_TIME.includes(t))
})

test('describe() finds upstream entries whatever the case', () => {
  assert.ok(describe('oai-searchbot', list)?.operator)
  assert.equal(describe('Googlebot', list), null)
})
