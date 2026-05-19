# 💰 Expense Tracker (Telegram Bot + Web Dashboard)

A personal expense tracker. Log expenses in seconds via a Telegram bot — view them on a clean dark-mode dashboard with charts and budget tracking.

---

## ✨ Features

- **Quick-log via Telegram** — send `150 lunch` and it auto-categorizes
- **Step-by-step `/add`** flow for when you want full control
- **Auto-categorization** (Food, Transport, Entertainment, College, Gym, Shopping, Health, Skincare, Misc)
- **Budget tracking** with warnings at 80% and 100%
- **Web dashboard** with category pie chart and daily bar chart
- **SQLite storage** — no DB setup needed; data lives in `expenses.db`
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
```

> If you leave `TELEGRAM_BOT_TOKEN` as `your_token_here`, the dashboard still runs but the bot stays disabled.

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

---

## 📁 Project Structure

```
expense-tracker/
├── server.js          # Express server + bot bootstrap
├── database.js        # SQLite + query helpers
├── bot.js             # Telegram bot logic
├── routes/api.js      # REST API routes
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
- Database file `expenses.db` is created next to `server.js` on first run.
- Delete `expenses.db` to start over.
- For 24/7 use, run with **pm2**: `pm2 start server.js --name expenses`.

## 🐛 Troubleshooting

- **Bot not responding?** Make sure your `MY_TELEGRAM_USER_ID` matches the account you're messaging from. The bot ignores everyone else.
- **`polling_error` ETELEGRAM 409**: another instance of the bot is running. Stop it first.
- **`better-sqlite3` build error on Windows**: install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload).
