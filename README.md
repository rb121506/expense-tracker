# 💰 Expense Tracker (Telegram Bot + Web Dashboard)

A personal expense tracker. Log expenses in seconds via a Telegram bot — view them on a clean dark-mode dashboard with charts and budget tracking.

---

## ✨ Features

- **Quick-log via Telegram** — send `150 lunch` and it auto-categorizes
- **Step-by-step `/add`** flow for when you want full control
- **Auto-categorization** (Food, Transport, Entertainment, College, Gym, Shopping, Health, Skincare, Misc)
- **Budget tracking** with warnings at 80% and 100%
- **Web dashboard** with category pie chart and daily bar chart
- **Neon Postgres storage** — works locally and on Vercel with one `DATABASE_URL`
- **Private** — bot responds only to your Telegram user ID

---

## 1. Create a Telegram Bot

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts (give it a name, then a username ending in `bot`).
3. BotFather replies with a token like `123456:ABC-DEF...`. Save it — that's your `TELEGRAM_BOT_TOKEN`.

## 2. Find Your Telegram User ID

1. On Telegram, search **@userinfobot** and start it.
2. It replies with your numeric ID. Save it as `MY_TELEGRAM_USER_ID`. (Only this account will be allowed to use the bot.)

## 3. Install Dependencies

Requires **Node.js 18+**.

```bash
cd expense-tracker
npm install
```

## 4. Configure `.env`

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```
TELEGRAM_BOT_TOKEN=123456:ABC-your-token
MY_TELEGRAM_USER_ID=987654321
PORT=3000
DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
DASHBOARD_PASSCODE=
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash-lite
```

> If you leave `TELEGRAM_BOT_TOKEN` or `MY_TELEGRAM_USER_ID` as the placeholder values, the dashboard still runs but the bot stays disabled. This keeps the bot private by default.

## 5. Run It

```bash
node server.js
```

You'll see:

```
💰 Expense Tracker running:
   Dashboard:  http://localhost:3000
   API base:   http://localhost:3000/api
[BOT] Telegram bot started (polling).
```

## 6. Using the Bot

Open Telegram → talk to your bot.

**Quick log** (fastest):
- `150 lunch` → ₹150, Food
- `500 auto` → ₹500, Transport
- `1200 gym` → ₹1200, Gym
- `80 chai` → ₹80, Food

**Commands:**

| Command | What it does |
| --- | --- |
| `/start` | Welcome message |
| `/help` | List all commands |
| `/add` | Add an expense step-by-step |
| `/summary` | Week + month totals |
| `/today` | Today's expenses |
| `/categories` | Spend grouped by category |
| `/budget` | Budget usage |
| `/setbudget 5000` | Set monthly budget |
| `/history` | Last 10 expenses |
| `/delete 12` | Delete expense by ID |

## 7. Dashboard

Open <http://localhost:3000>. You'll see:

- Top stats (spent, budget, remaining, count)
- Budget progress bar with warnings
- Category doughnut chart + daily bar chart
- Manual add-expense form
- Recent expenses table with delete buttons

## 8. AI Chat Setup

The dashboard chat uses Gemini to turn spending questions into safe read-only SQL.

1. Create or rotate a Gemini key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Add `GEMINI_API_KEY` to local `.env`.
3. Keep `GEMINI_MODEL=gemini-2.5-flash-lite` unless you intentionally want a different model.
4. In Vercel, add the same `GEMINI_API_KEY` and `GEMINI_MODEL` under Environment Variables.
5. Redeploy Vercel after changing environment variables.

To test the key locally:

```bash
npm run test:gemini
```

If a real Gemini key was ever pasted into code, screenshots, or chat, rotate it in Google AI Studio before using the app again.

---

## 📁 Project Structure

```
expense-tracker/
├── server.js          # Express server + bot bootstrap
├── categories.js      # Shared category definitions
├── database.js        # Neon Postgres + query helpers
├── bot.js             # Telegram bot logic
├── routes/api.js      # REST API routes
├── migrate-sqlite-to-neon.js
├── public/
│   ├── index.html     # Dashboard
│   ├── style.css      # Dark theme styles
│   └── app.js         # Frontend JS (charts, fetching)
├── .env               # Your secrets (gitignored)
├── .env.example
├── package.json
└── README.md
```

## 🔌 API Endpoints

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/expenses?month=YYYY-MM` | List expenses (optionally for a month) |
| GET | `/api/expenses/today` | Today's expenses |
| GET | `/api/summary?month=YYYY-MM` | Totals by category + by day |
| GET | `/api/budget` | Current month budget + spent |
| PUT | `/api/budget` | Update budget (`{ amount }`) |
| POST | `/api/expenses` | Add expense (`{ amount, category, description, date }`) |
| DELETE | `/api/expenses/:id` | Delete an expense |

## 🔧 Tips

- Default monthly budget is **₹5000** until you set one.
- Set `DATABASE_URL` locally and in Vercel before starting the app.
- Set `GEMINI_API_KEY` locally and in Vercel if you want AI Chat.
- The bot starts only when both `TELEGRAM_BOT_TOKEN` and `MY_TELEGRAM_USER_ID` are set.
- For 24/7 use, run with **pm2**: `pm2 start server.js --name expenses`.

## Migrating Old SQLite Data

If you previously used the SQLite version, keep your old `expenses.db`, set `DATABASE_URL`, then run:

```bash
node migrate-sqlite-to-neon.js
```

The migration script uses Node's built-in `node:sqlite` module, so run it with **Node.js 22+**.

## 🐛 Troubleshooting

- **Bot not responding?** Make sure your `MY_TELEGRAM_USER_ID` matches the account you're messaging from. The bot ignores everyone else.
- **`polling_error` ETELEGRAM 409**: another instance of the bot is running. Stop it first.
- **Database error on startup**: make sure `DATABASE_URL` is set and points to your Neon database.
- **Gemini says quota exceeded / 429**: this is a Google AI Studio project quota or billing issue, not usually a typo. Check Usage/Billing, wait for quota reset, enable billing, or use another project with available quota.
- **Gemini API key invalid**: rotate/create a key in Google AI Studio, update local `.env` and Vercel Environment Variables, then redeploy.
