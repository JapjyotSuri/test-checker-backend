# Setting up Admins

Everyone who signs up becomes a **Student** (role `USER`). Admins are not created through the app; you set them by running a query on your database.

## Make a user an Admin (only 2 admins)

Run this in your PostgreSQL database (replace the email with the actual user email):

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com';
```

To set a second admin:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'second-admin@example.com';
```

The user must have signed up at least once (so they exist in the `users` table). After running the query, that user will see the Admin dashboard and can promote students to Checkers from **Students** or **Checkers → Add Checker**.

## Role flow summary

- **Sign up** → role = `USER` (Student)
- **Admin** → set manually via DB query (e.g. 2 admins)
- **Checker** → Admin promotes a Student from the dashboard (Students → Make Checker, or Checkers → Add Checker)
