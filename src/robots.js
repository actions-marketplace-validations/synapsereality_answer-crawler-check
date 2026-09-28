// A small robots.txt reader: User-agent groups, Allow, Disallow, Sitemap.
// Group choice and rule precedence follow RFC 9309 (the Robots Exclusion
// Protocol), which is also what Google documents: a crawler obeys the group
// that names its product token, else the `*` group; inside a group the longest
// matching pattern wins, and Allow wins a tie.

// RFC 9309 asks parsers to read at least 500 KiB. Past that we stop and say so,
// because a partial file that happens to miss a Disallow reads like permission.
export const MAX_BYTES = 512 * 1024
const MAX_RULES = 20_000

/**
 * @typedef {{allow: boolean, pattern: string, line: number}} Rule
 * @typedef {{groups: Map<string, Rule[]>, sitemaps: string[], truncated: boolean}} Robots
 */

/** The product token of a User-agent value, lower-cased: `GPTBot/1.1 (+https://...)` -> `gptbot`. */
export function agentToken(value) {
  const v = value.trim()
  if (v.startsWith('*')) return '*'
  const m = /^[^\s/;(]+/.exec(v)
  return (m ? m[0] : v).toLowerCase()
}

/**
 * One spelling per path, so `/über` and `/%c3%bcber` compare equal: non-ASCII is
 * percent-encoded as UTF-8 and existing escapes get upper-case hex.
 */
export function normPath(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out += '%' + s.slice(i + 1, i + 3).toUpperCase()
      i += 2
    } else if (ch.charCodeAt(0) < 128) {
      out += ch
    } else {
      const cp = s.codePointAt(i)
      const chars = String.fromCodePoint(cp)
      for (const b of Buffer.from(chars, 'utf8')) out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
      i += chars.length - 1
    }
  }
  return out
}

/** @returns {Robots} */
export function parseRobots(text) {
  const robots = { groups: new Map(), sitemaps: [], truncated: false }
  let body = text ?? ''
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
    body = Buffer.from(body, 'utf8').subarray(0, MAX_BYTES).toString('utf8')
    robots.truncated = true
  }
  // A UTF-8 byte order mark would otherwise glue itself to the first key.
  const lines = body.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  let current = []
  let lastWasAgent = false
  let count = 0
  lines.forEach((raw, idx) => {
    const line = raw.split('#', 1)[0].trim()
    const colon = line.indexOf(':')
    if (!line || colon < 0) return
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      // Consecutive User-agent lines share one group.
      if (!lastWasAgent) current = []
      const agent = agentToken(value)
      current.push(agent)
      if (!robots.groups.has(agent)) robots.groups.set(agent, [])
      lastWasAgent = true
      return
    }
    if (key === 'sitemap') {
      // Not a group member, so it does not end a run of User-agent lines.
      if (value) robots.sitemaps.push(value)
      return
    }
    lastWasAgent = false
    if ((key === 'allow' || key === 'disallow') && current.length) {
      if (count >= MAX_RULES) {
        robots.truncated = true
        return
      }
      count++
      // `Disallow:` with no value allows everything, which is the same as no rule.
      if (key === 'disallow' && value === '') return
      for (const agent of current) {
        robots.groups.get(agent).push({ allow: key === 'allow', pattern: normPath(value), line: idx + 1 })
      }
    }
  })
  return robots
}

/**
 * Does `pattern` match `path`? `*` matches any run of characters and a
 * trailing `$` anchors the end; otherwise a pattern is a prefix. Written as a
 * two-pointer walk, which cannot backtrack exponentially on a hostile file.
 */
export function matches(pattern, path) {
  let p = pattern
  const anchored = p.endsWith('$')
  if (anchored) p = p.slice(0, -1)
  else p += '*'
  let pi = 0
  let si = 0
  let star = -1
  let starS = 0
  for (;;) {
    if (pi === p.length) {
      if (!anchored || si === path.length) return true
      if (star >= 0 && starS < path.length) {
        starS++
        si = starS
        pi = star + 1
        continue
      }
      return false
    }
    const ch = p[pi]
    if (ch === '*') {
      star = pi
      starS = si
      pi++
    } else if (si < path.length && ch === path[si]) {
      pi++
      si++
    } else if (star >= 0 && starS < path.length) {
      starS++
      si = starS
      pi = star + 1
    } else {
      return false
    }
  }
}

/**
 * Is `agent` allowed to fetch `path` (path plus query)?
 * @returns {{allowed: boolean, group: string|null, rule: Rule|null}}
 */
export function allows(robots, agent, path) {
  const token = agentToken(agent)
  let group = token
  let rules = robots.groups.get(token)
  if (rules === undefined) {
    group = '*'
    rules = robots.groups.get('*')
  }
  if (rules === undefined) return { allowed: true, group: null, rule: null }
  // RFC 9309 section 2.2.2: /robots.txt itself is always allowed.
  if (path === '/robots.txt') return { allowed: true, group, rule: null }
  const target = normPath(path || '/')
  let best = null
  for (const r of rules) {
    if (!matches(r.pattern, target)) continue
    // Length is counted on the pattern as written, `*` and `$` included, as Google does.
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
      best = r
    }
  }
  return { allowed: best ? best.allow : true, group, rule: best }
}

/** Does any group name this agent, as opposed to it falling through to `*`? */
export function names(robots, agent) {
  return robots.groups.has(agentToken(agent))
}
