const hits = new Map()

function allow(ip, limit = 30, windowMs = 60_000, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < windowMs)
  if (recent.length >= limit) {
    hits.set(ip, recent)
    return false
  }
  recent.push(now)
  hits.set(ip, recent)
  return true
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return new Response('Not found', { status: 404 })
    }
    if (!env.AGNES_API_KEY || !env.UPSTREAM_URL) {
      return new Response('Relay is not configured', { status: 500 })
    }
    if (env.PROXY_TOKEN) {
      if (request.headers.get('authorization') !== `Bearer ${env.PROXY_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 })
      }
    }
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    if (!allow(ip, Number(env.RATE_LIMIT || 30))) {
      return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } })
    }
    let body = await request.text()
    if (env.MODEL) {
      try {
        const json = JSON.parse(body)
        json.model = env.MODEL
        body = JSON.stringify(json)
      } catch {
        return new Response('Expected JSON', { status: 400 })
      }
    }
    const upstream = await fetch(env.UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AGNES_API_KEY}`
      },
      body
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
