# Dalal Desk

A customizable dashboard for Indian and global markets that runs on your own machine. It shows live (delayed) prices for SENSEX, NIFTY, sector indices, crude, gold, currencies, global indices and any stock you add. It also has top gainers and losers with market breadth, news headlines, and learning widgets.

No `npm install` is needed. The only requirement is **Node.js 18 or newer**.

## Run it

```bash
node server.js
# then open http://localhost:8787
```

Or double-click `start.bat` (Windows) or run `./start.sh` (macOS/Linux).

## Optional: Claude features

"What moved today" and "Ask about markets" use the Claude API. Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`, then restart. Everything else works without a key.

## Customizing

- **Customize** (top right) lets you move, resize (S/M/L), rename and remove widgets, add or remove symbols, and change the mover list or news feed.
- **Add widget** has price boards, movers, headlines, term of the day, Claude explanations and the market-session clock. You can also export and import your layout as JSON there.
- Your layout is saved to `data/layout.json`, so it follows you across browsers on the same machine. Copy that file to another machine to bring your layout with you.
- **Symbols** use Yahoo Finance codes: NSE stocks end in `.NS` (e.g. `INFY.NS`), BSE in `.BO`, indices start with `^` (`^NSEI`, `^BSESN`), futures end in `=F` (`GC=F` gold), and FX pairs end in `=X` (`INR=X` is USD/INR). The search box in Customize finds them for you.
- **Mover lists** (NIFTY 50, SENSEX 30, US mega caps) and the preset news feeds live in `config.json`. Index constituents change a few times a year, so update the lists when they do. Symbols that fail to load are skipped.
- **Glossary** for Term of the day is in `public/glossary.js`. Add your own terms there.

## API (if you want to build on it)

| Endpoint | What it returns |
|---|---|
| `GET /api/quotes?symbols=^NSEI,GC=F` | Price, change, day/52-week range, intraday sparkline |
| `GET /api/movers?list=nifty50&n=5` | Top gainers/losers plus advance/decline counts |
| `GET /api/news?url=<rss>&n=8` | Parsed RSS headlines |
| `GET /api/search?q=infosys` | Yahoo symbol search |
| `GET/PUT /api/layout` | Your saved layout |
| `POST /api/claude` | Claude proxy (needs `ANTHROPIC_API_KEY`) |

## Notes

- Data comes from Yahoo Finance's public chart endpoint, which is unofficial and rate-limited. The server caches quotes for 20 seconds and movers for 60 seconds. NSE/BSE prices are usually delayed by about 15 minutes.
- On a corporate network, finance sites may be blocked by a proxy. If prices don't load, try a personal network.
- By default the server listens only on `127.0.0.1`. Set `HOST=0.0.0.0` to open it from your phone on the same Wi-Fi.
- This is a learning tool, not investment advice.
