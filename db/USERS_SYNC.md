# Why `users` table is empty after sign-up

## "Duplicate key on email" but 0 rows in pgAdmin?

If the backend logs **duplicate key value violates unique constraint "users_email_key"** but **SELECT * FROM users** in pgAdmin shows **0 rows**, you are almost certainly querying a **different database** than the backend.

- The backend uses the database from **`DATABASE_URL`** in `test-checker-backend/.env`.
- In pgAdmin, check that you are connected to the **same database name** (and same host/port) as in `DATABASE_URL`.

When the backend starts, it now logs: **"PostgreSQL connected to database: &lt;name&gt;"**. Use that exact database in pgAdmin (right-click it → Query Tool → run `SELECT * FROM users`).

---

Users are **not** created at sign-up time in our app. They are created when the **backend** first sees that user (when they call an API that uses auth).

## How users get into the `users` table

1. **First API call after sign-in**  
   When a signed-in user hits the app (e.g. dashboard), the frontend calls `GET /api/auth/me`.  
   The auth middleware then:
   - Verifies the Clerk token
   - Looks up the user by `clerk_id` in the DB
   - **If not found**: fetches the user from Clerk and **INSERTs** into `users` (role = USER)

2. **Clerk webhook (optional)**  
   If you configure Clerk to send `user.created` to `POST /api/auth/webhook`, we can also insert users at sign-up. In local dev this usually needs a public URL (e.g. ngrok).

## If you see 0 rows in `users`

- **Backend not running**  
  The frontend (Clerk) can sign up/sign in without the backend. If the backend is not running, `/api/auth/me` never runs and no user is created.  
  **Fix:** Start the backend (e.g. `npm run start` in `test-checker-backend`), then sign in again and open the dashboard.

- **Frontend can’t reach the backend**  
  If `NEXT_PUBLIC_API_URL` is wrong or the backend is on another port/host, the frontend may not call your backend.  
  **Fix:** In the frontend `.env.local`, set  
  `NEXT_PUBLIC_API_URL=http://localhost:4000/api`  
  (or the URL where your backend actually runs). Restart the frontend, sign in, and open the dashboard.

- **Request fails (401, 500, network)**  
  If `/api/auth/me` fails (wrong Clerk keys, DB down, etc.), the middleware never inserts a user.  
  **Fix:** Check backend logs when you sign in. You should see `[Auth] New user created in DB: <id> <email>` when a user is created. If you see 401/500, fix Clerk config or DB connection.

## Quick check

1. Start the **backend** (e.g. port 4000).
2. In the frontend, set `NEXT_PUBLIC_API_URL=http://localhost:4000/api` and restart.
3. Sign in (or sign up then sign in) and go to the dashboard.
4. In the backend terminal you should see: `[Auth] New user created in DB: ...`
5. In pgAdmin run: `SELECT * FROM users;` — you should see that user.
