import inventory from '../data/content-links.json'

export function GET() {
  return new Response(JSON.stringify(inventory), {
    headers: { 'Content-Type': 'application/json' },
  })
}
