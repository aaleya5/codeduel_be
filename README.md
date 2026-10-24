# LeetCode Daily Challenge Tracker - Backend

A production-ready backend application for tracking LeetCode daily challenges with automated evaluation, streak tracking, and penalty management.

For the prioritized gap analysis, verification checklist, product roadmap, and
academic deliverables, see the [CodeDuel project roadmap](../PROJECT_ROADMAP.md).

## 🚀 Features

- **User Authentication**: JWT-based authentication with secure password hashing
- **Challenge Management**: Create and join challenges with customizable rules
- **LeetCode Integration**: Fetch submissions from LeetCode GraphQL API
- **Automated Evaluation**: Daily cron jobs to evaluate challenge progress
- **Streak Tracking**: Track current and longest streaks
- **Penalty System**: Virtual penalty tracking for missed days
- **Dashboard**: Comprehensive progress overview and leaderboards
- **Clean Architecture**: Service-based structure with separation of concerns

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT (jsonwebtoken)
- **Encryption**: AES-256-GCM (crypto)
- **Scheduling**: node-cron
- **HTTP Client**: Axios
- **Logging**: Winston
- **Validation**: express-validator

## 📁 Project Structure

```
src/
 ├── app.js                      # Express app setup
 ├── server.js                   # Server entry point
 ├── config/
 │    ├── env.js                 # Environment configuration
 │    ├── prisma.js              # Prisma client setup
 │    └── cron.js                # Cron job manager
 ├── routes/
 │    ├── auth.routes.js         # Authentication routes
 │    ├── challenge.routes.js    # Challenge routes
 │    └── dashboard.routes.js    # Dashboard routes
 ├── controllers/
 │    ├── auth.controller.js     # Auth request handlers
 │    ├── challenge.controller.js # Challenge request handlers
 │    └── dashboard.controller.js # Dashboard request handlers
 ├── services/
 │    ├── auth.service.js        # Authentication business logic
 │    ├── challenge.service.js   # Challenge business logic
 │    ├── leetcode.service.js    # LeetCode API integration
 │    ├── penalty.service.js     # Penalty management
 │    └── evaluation.service.js  # Daily evaluation logic
 ├── middlewares/
 │    ├── auth.middleware.js     # JWT authentication
 │    └── error.middleware.js    # Error handling
 ├── utils/
 │    ├── jwt.js                 # JWT utilities
 │    ├── encryption.js          # Encryption utilities
 │    └── logger.js              # Winston logger
 └── prisma/
      └── schema.prisma          # Database schema
```

## 🚦 Getting Started

### Prerequisites

- Node.js (v18 or higher; CI uses Node.js 22)
- PostgreSQL (v12 or higher)
- npm or yarn

### Installation

1. **Clone the repository**

   ```bash
   cd "f:\DATA\College\Project and stuff\Leetcode streak"
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:

   - `DATABASE_URL`: PostgreSQL connection string
   - `JWT_SECRET`: Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `ENCRYPTION_KEY`: Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `CHALLENGE_TIME_ZONE`: IANA time zone for challenge-day boundaries, evaluation, and streaks (defaults to `Asia/Kolkata`)
   - Other configuration as needed

4. **Set up database**

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. **Seed demo data for feature demos**

   ```bash
   npm run prisma:seed
   ```

   This creates a small active challenge and 3 demo users with streak and submission history so you can showcase the dashboard, leaderboard, and heatmap without needing to manually create data.

   Demo login credentials:

   - `alexdemo` / `Demo123!`
   - `sarahdemo` / `Demo123!`
   - `mikedemo` / `Demo123!`

6. **Start the server**

   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production mode
   npm start
   ```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

Challenge calendar dates and evaluation cutoffs use `CHALLENGE_TIME_ZONE`
(default `Asia/Kolkata`); persisted timestamps remain UTC. The cron job uses
this same zone, so evaluations run at the configured `DAILY_EVALUATION_TIME`
in the challenge time zone. Run the automated backend tests with `npm test`.

Apply database changes with `npm run prisma:migrate` before starting the
updated backend. Payment orders reserve their amount against the member's
outstanding balance; concurrent orders and manual payments cannot consume the
same balance. A payment with an invalid verification signature remains pending
so an unauthenticated/invalid callback cannot release its reservation. Pending
orders still need provider-webhook reconciliation or a verified expiry process
before their reservations can be released automatically.

Daily evaluations persist the result, streak update, and any penalty ledger
entry in one transaction. A duplicate run for the same member/challenge/day
does not apply the penalty again. If a LeetCode submission fetch fails, the day
is left unevaluated and can be retried on a later run. Session/database errors,
malformed provider responses, and missing difficulty metadata for a
difficulty-filtered challenge also remain unverified and do not cause
penalties. A valid empty accepted-submission response is treated as zero
submissions. A member without a LeetCode username is still recorded as
incomplete under the current policy.

### Automated tests

Run `npm test` from `codeduel_be`. Tests use Node's built-in test runner and
mock persistence/provider boundaries, so they do not require PostgreSQL,
LeetCode credentials, or Razorpay keys. The CI workflow runs the backend suite
in both UTC and `Asia/Kolkata`, validates/generates the Prisma client, and
builds the frontend. These unit tests do not replace database-backed API
integration tests.

## 📡 API Endpoints

Unless noted otherwise, endpoints require `Authorization: Bearer <token>`.

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get current user profile (protected)
- `PUT /api/auth/profile` - Update user profile (protected)

### Challenges

- `POST /api/challenges` - Create new challenge (protected)
- `GET /api/challenges?status=ACTIVE&owned=true` - List the current user's challenges; both query filters are optional (protected)
- `GET /api/challenges/invite/:inviteCode` - Preview a shareable invitation (protected)
- `POST /api/challenges/invite/:inviteCode/request` - Request to join from an invitation (protected)
- `GET /api/challenges/:id` - Get challenge details (protected)
- `POST /api/challenges/:id/join` - Request to join a challenge by ID (protected)
- `GET /api/challenges/:id/join-requests` - List pending join requests (owner only)
- `PATCH /api/challenges/:id/join-requests/:requestId` - Approve or reject a request (owner only; body: `{ "decision": "APPROVED" }` or `{ "decision": "REJECTED" }`)
- `PATCH /api/challenges/:id/status` - Update challenge status (owner only)
- `PATCH /api/challenges/:id` - Update challenge rules (owner only)
- `DELETE /api/challenges/:id/members/:memberId` - Remove a member (owner only)
- `POST /api/challenges/:id/members/:memberId/penalty-adjustment` - Adjust a member's penalty (owner only; body: `{ "amount": 5, "reason": "..." }`)
- `GET /api/challenges/:id/disputes` - List pending penalty disputes (owner only)
- `POST /api/challenges/:id/penalties/:penaltyId/dispute` - Dispute your penalty (body: `{ "reason": "..." }`)
- `POST /api/challenges/:id/penalties/:penaltyId/resolve` - Resolve a dispute (owner only; body: `{ "action": "UPHOLD" }` or `{ "action": "WAIVE", "note": "..." }`)

Every challenge has a shareable invite link. Joining is approval-based: the
owner reviews pending requests from the challenge page, and approval activates
the member's challenge membership. The frontend create-challenge form includes
30-day presets for one problem per day and two problems per day; custom rules
remain available.

### Dashboard

- `GET /api/dashboard` - Get dashboard overview (protected)
- `GET /api/dashboard/today` - Get today's status (protected)
- `GET /api/dashboard/challenge/:id` - Get detailed challenge progress (protected)
- `GET /api/dashboard/challenge/:id/leaderboard` - Get challenge leaderboard (protected)
- `GET /api/dashboard/challenge/:id/chart` - Get challenge submission chart (protected)
- `GET /api/dashboard/activity-heatmap` - Get the current user's activity heatmap (protected)
- `GET /api/dashboard/stats` - Get streak and activity statistics (protected)
- `GET /api/dashboard/submission-chart` - Get the current user's submission chart (protected)
- `GET /api/dashboard/leaderboard` - Get the global leaderboard (protected)
- `POST /api/dashboard/evaluate` - Manually evaluate a challenge you own (protected; body: `{ "challengeId": "...", "date": "YYYY-MM-DD" }`, with `date` optional)

### LeetCode

- `POST /api/leetcode/session` - Store the current user's encrypted LeetCode session (protected; body includes `cookie`, optional `csrfToken` and `expiresAt`)
- `GET /api/leetcode/session` - Check stored session status (protected)
- `DELETE /api/leetcode/session` - Invalidate the stored session (protected)
- `GET /api/leetcode/profile/:username` - Fetch profile, active years, calendar, and all-time activity needed for streak calculations (protected)
- `GET /api/leetcode/submissions/:username?date=YYYY-MM-DD` - Fetch accepted submissions for one calendar date (protected; individual submission details are limited to LeetCode's recent-submission window)
- `GET /api/leetcode/test/:username` - Test the LeetCode connection and fetch the latest accepted submissions (protected)
- `GET /api/leetcode/problem/:titleSlug` - Fetch problem metadata (protected)

### Notifications

- `GET /api/notifications?unreadOnly=true` - List notifications; `unreadOnly` is optional (protected)
- `GET /api/notifications/unread-count` - Get unread notification count (protected)
- `PATCH /api/notifications/read-all` - Mark all notifications as read (protected)
- `PATCH /api/notifications/:id/read` - Mark one notification as read (protected)

### Payments

- `POST /api/payments/create-order` - Create a Razorpay order for your penalty balance (protected; body: `{ "memberId": "...", "amount": 100 }`)
- `POST /api/payments/verify` - Verify a Razorpay payment (protected; body: `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`)
- `GET /api/payments/history/:memberId` - Get your payment history for a membership (protected)
- `POST /api/payments/manual` - Record an offline payment (challenge owner only; body includes `challengeId`, `memberId`, `amount`, and optional `note`)
- `GET /api/payments/ledger/:memberId` - Get a member's combined penalty and payment ledger (member or challenge owner)

### Health Check

- `GET /` - API root and route-group overview (public)
- `GET /health` - Server health status

## 🗄️ Database Schema

### User

- User authentication and profile information
- LeetCode username mapping

### Challenge
- Challenge configuration, invite code, and rules
- Start/end dates, difficulty filters, penalty amounts

### ChallengeMember

- User participation in challenges
- Streak tracking and penalty totals

### ChallengeJoinRequest

- One join request per user and challenge
- Pending requests can be approved or rejected by the challenge owner

### DailyResult

- Daily evaluation results
- Submission counts and problem tracking

### PenaltyLedger

- Penalty transaction history

### LeetCodeSession

- Encrypted session storage for LeetCode API

## ⚙️ Configuration

### Cron Jobs

Daily evaluation runs automatically based on `DAILY_EVALUATION_TIME` in `.env`:

```env
# Run at 1:00 AM daily (recommended)
DAILY_EVALUATION_TIME=0 1 * * *

# For testing - run every 15 minutes
DAILY_EVALUATION_TIME=*/15 * * * *
```

### Challenge Rules

When creating a challenge, configure:

- `minSubmissionsPerDay`: Minimum accepted submissions required
- `difficultyFilter`: Array of difficulties (Easy, Medium, Hard)
- `uniqueProblemConstraint`: Whether to count unique problems only
- `penaltyAmount`: Virtual penalty for missed days

## 🔐 Security Features

- Password hashing with bcrypt (12 rounds)
- JWT-based authentication
- AES-256-GCM encryption for sensitive data
- Input validation on all endpoints
- SQL injection protection via Prisma ORM
- Environment variable validation on startup

## 📝 Development Notes

### Adding New Features

1. **Service Layer**: Add business logic in `src/services/`
2. **Controller**: Add request handlers in `src/controllers/`
3. **Routes**: Define endpoints in `src/routes/`
4. **Validation**: Add input validation in controllers

### Database Changes

```bash
# Create migration
npm run prisma:migrate

# Regenerate Prisma Client
npm run prisma:generate

# Open Prisma Studio (DB GUI)
npm run prisma:studio
```

### Logging

Uses Winston for structured logging:

- Console logs with colors (development)
- File logs: `logs/combined.log`, `logs/error.log`
- Exception/rejection logs

## 🐛 Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Ensure database exists: `createdb leetcode_tracker`

### LeetCode API Rate Limiting

- LeetCode may rate limit requests
- Consider adding delays between requests
- Store session data for authenticated requests

### Cron Jobs Not Running

- Check `CRON_ENABLED=true` in `.env`
- Verify cron expression syntax
- Check logs for error messages

## 🚀 Production Deployment

1. **Environment**

   - Set `NODE_ENV=production`
   - Use strong secrets for `JWT_SECRET` and `ENCRYPTION_KEY`
   - Configure `CORS_ORIGIN` to your frontend URL

2. **Database**

   - Use production PostgreSQL instance
   - Run migrations: `npm run prisma:migrate`

3. **Process Management**

   - Use PM2 or similar for process management
   - Enable clustering for high availability

4. **Monitoring**
   - Monitor logs in `logs/` directory
   - Set up error alerting
   - Monitor cron job execution

## 📄 License

ISC

## 👤 Author

Built with ❤️ for the LeetCode community
