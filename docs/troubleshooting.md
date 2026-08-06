# Troubleshooting

## `Expected JSON from … but got HTML`

The URL in `EXCALIDASH_BACKEND_URL` is being answered by the frontend rather than the backend.
Almost always a missing `/api` suffix.

```bash
curl -sS https://draw.example.com/api/health    # → {"status":"ok"}
curl -sS https://draw.example.com/health        # → HTML, and that is correct
```

Backend routes live under `/api` when you go through the frontend. `/health` and `/drawings` at the
root serve the single-page app, not the API.

## Login fails, or everything answers with a 302

You are pointing at the backend directly while it runs with `TRUST_PROXY`, so it redirects plain HTTP
to your public URL. Either add the proxy hints:

```json
"EXCALIDASH_PROXY_PROTO": "https",
"EXCALIDASH_PROXY_HOST": "draw.example.com"
```

…or switch to the `/api` URL, where they aren't needed.

## Login returns 401

The account doesn't exist or the password is wrong. Check it by logging into ExcaliDash in a browser
with exactly those credentials.

## REST works, but nothing appears live

Socket.IO isn't getting through. The stock ExcaliDash frontend proxies `/socket.io/` with the
`Upgrade`/`Connection` headers already, but a proxy *in front of* it (Cloudflare, Traefik, another
Nginx) needs WebSockets enabled too.

A path prefix on `EXCALIDASH_BACKEND_URL` is carried into the Socket.IO path automatically, so
`https://host/api` connects at `/api/socket.io/`.

## `export_png` fails with a Playwright error

The headless browser isn't installed:

```bash
npx playwright install chromium
```

## Diagrams look messy

If arrows cut through boxes or labels sit under them, the diagram was probably drawn with
`draw_scene`, which takes absolute coordinates and leaves layout to whoever wrote them. Use
`draw_graph` for anything made of boxes and arrows. It describes structure only and runs dagre for
the geometry.
