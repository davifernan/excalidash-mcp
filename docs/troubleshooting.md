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

## Login suddenly fails after it had been working

Don't assume the password broke. ExcaliDash rate-limits sign-ins per account and IP, by default 20
attempts per 15 minutes, and every start of this server is one login. Restart it in a loop, or run a
few test scripts, and you are there.

What you get then is **not** a 401, so it doesn't read as a credentials problem at all. Every login
response carries the limit as headers, and they say how long it lasts:

```
ratelimit-policy: 20;w=900     20 attempts per 15 minutes
ratelimit-remaining: 4
ratelimit-reset: 250           seconds until it clears
```

Wait it out instead of retrying, because the rejected attempts count too. An admin can raise the
limit in ExcaliDash's auth settings.

## The agent gives me a board link and it doesn't open

The agent has its own account, so the boards it creates belong to that account, not yours. Ask it to
share the board:

```
share_board(board_id, with="you@example.com")
```

Or set `EXCALIDASH_SHARE_WITH` to your address so every board reaches you automatically. See
[Sharing](../README.md#sharing).

## `share_board` won't accept a person's name

It resolves only an exact address, an exact name or username, or a user id. Anything else comes back
as a list to confirm, including when there is exactly one match, because the instance's lookup
matches fragments: a search for `ann` returns the account `Joanne` when the Ann you meant has no
account at all. Give the email address and it goes through.

The recipient does need an account on the same instance. There is no way to share a board out to
somebody who has none.

## REST works, but nothing appears live

Socket.IO isn't getting through. The stock ExcaliDash frontend proxies `/socket.io/` with the
`Upgrade`/`Connection` headers already, but a proxy *in front of* it (Cloudflare, Traefik, another
Nginx) needs WebSockets enabled too.

A path prefix on `EXCALIDASH_BACKEND_URL` is carried into the Socket.IO path automatically, so
`https://host/api` connects at `/api/socket.io/`.

## `export_png` fails with a Playwright error

The headless browser isn't installed:

```bash
npx -y excalidash-mcp setup-browser
```

On a minimal Linux server or container, install the required operating-system libraries too:

```bash
npx -y excalidash-mcp setup-browser --with-deps
```

## Diagrams look messy

If arrows cut through boxes or labels sit under them, the diagram was probably drawn with
`draw_scene`, which takes absolute coordinates and leaves layout to whoever wrote them. Use
`draw_graph` for anything made of boxes and arrows. It describes structure only and runs dagre for
the geometry.
