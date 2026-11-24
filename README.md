# VERA: Experience & Reservation Agent

An agentic travel concierge prototype. You tell VERA what you'd like to do, by text or voice, and it
finds suitable activities and restaurants, books them and, when the merchant requires it, pays for them.
It can do this on its own (**autonomous mode**) or suggest options for you to choose from (**hands-on mode**).

> "I'm looking for a guided tour for 4 people around 12 PM and our budget is under £40 per person."

> **Academic concept prototype.** VERA was designed during a sprint-week project using the Soft
> Ecosystems Methodology. It is not affiliated with or endorsed by Visa. All merchants, availability,
> agent-to-agent handshakes and payments are **simulated**, and no card data is collected.

## Features

| Feature | What the prototype does |
| --- | --- |
| Natural-language requests | Pulls party size, time, day, budget (£ $ € ¥, per person or total), category, area, dietary and access needs out of a free-text prompt |
| Voice | Speech-to-text input and read-aloud replies, where the browser supports them |
| Visa-only discovery | Only merchants that accept Visa are considered, and the agent says how many it skipped |
| Personalised ranking | Ranks by rating, interest match, time fit and price, and learns from your past bookings and star ratings |
| Hands-on mode (UC-001) | Shows up to 5 options with reasons. You pick one and VERA books it |
| Autonomous mode (UC-002) | VERA books the best match itself. Add "just book it" to any prompt to do this once |
| Spending limit | VERA never pays more than your per-booking limit without your approval |
| Simulated secure payment | Logs a simulated agent handshake and a tokenised Click to Pay-style payment. Merchants that don't require prepayment are reserved without charge |
| Bookings and cancellation (UC-003) | Cancel bookings. Free-cancellation merchants refund, non-refundable ones refuse and the booking stays active |
| Transparency | Every booking keeps an agent log (prompt, decisions, payment steps), which acts as the incident report described in the liability model |

## Run it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>. Bookings and settings are kept in your browser's local storage.
Use **Settings → Reset demo data** to start again.

## Tests

The agent logic in `js/agent.js` is plain JavaScript with no DOM, so it is tested with Node's built-in test runner (Node 18+):

```bash
npm test
```

## Publish on GitHub

1. Create an empty repository on GitHub, then push:
   ```bash
   git remote add origin https://github.com/<your-username>/vera-agent.git
   git push -u origin main
   ```
2. For a live demo, go to **Settings → Pages** in the repository, choose **Deploy from a branch**, then select `main` and `/ (root)`.
   The app will be at `https://<your-username>.github.io/vera-agent/`.

The included GitHub Actions workflow runs the tests on every push and pull request.

## Project structure

```
index.html            App shell (Chat, Bookings and Settings tabs)
css/styles.css        Styles, with light and dark themes
js/data.js            Fictional Tokyo merchant directory (stands in for the merchant database)
js/agent.js           Agent core: parse → discover → select → book → pay → cancel/rate
js/app.js             UI wiring
tests/agent.test.js   Unit tests for the agent core
docs/concept.md       Concept: ECHO, holons (TWO-CE), use cases, class diagram, roadmap, FAQ
```

## How the agent works

The three holons from the design map directly to code:

1. **Discover** (`parsePrompt`, `search`): turn the prompt into a request and filter the directory down to
   Visa-accepting merchants in the right area, category, budget and dietary/access needs that have free slots.
2. **Select** (`search` ranking, `learnPreferences`): score what's left and explain each suggestion.
3. **Pay** (`createBooking`, `processPayment`): check the price limit, run the simulated handshake, pay with a
   token and confirm.

See [docs/concept.md](docs/concept.md) for the full design.

## What would make it real

- Replace `js/data.js` with real merchant data and booking APIs
- Replace the simulated handshake and payment with a real agent-payment integration and tokenised checkout
- Use an LLM for prompt understanding instead of the rule-based parser
- Add user accounts and server-side storage
- Roadmap items: maps and navigation, transport booking, calendar sync and merchant scoring

## License

[MIT](LICENSE)
