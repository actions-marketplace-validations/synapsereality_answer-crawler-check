// Network and file access, kept in one place so the tests can swap it.
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

export const USER_AGENT = 'answer-crawler-check/0.1 (+https://synapsereality.io/open-source/answer-crawler-check/)'

const isUrl = (s) => /^https?:\/\//i.test(s)

function decode(buf) {
  // Sitemaps may be gzipped whatever their name says. Check the magic bytes.
  const bytes = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf
  return bytes.toString('utf8')
}

/**
 * Read a URL or a local file. Returns {status, text}; status is 200 for a file.
 * Network errors come back as {status: 0, error}.
 */
export async function load(source, { timeoutMs = 20000, maxBytes = 50 * 1024 * 1024 } = {}) {
  if (!isUrl(source)) {
    try {
      return { status: 200, text: decode(await readFile(source)) }
    } catch (e) {
      return { status: 0, text: '', error: `${source}: ${e.code || e.message}` }
    }
  }
  try {
    const res = await fetch(source, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) return { status: res.status, text: '', error: `larger than ${maxBytes} bytes` }
    return { status: res.status, text: decode(buf) }
  } catch (e) {
    return { status: 0, text: '', error: e?.cause?.code || e?.name || String(e) }
  }
}
