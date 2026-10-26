# osTicket React

## Backend

The API runs on NestJS with Prisma Client and PostgreSQL. The Prisma schema maps the supplied osTicket SQL table structures and the React-specific branch metadata. The backend uses typed Prisma model queries and transactions; no SQL driver or raw-query compatibility layer is used.

Set `DATABASE_URL`, run `npm run prisma:generate`, then `npm run prisma:push` to create/update the PostgreSQL schema. Start the API with `npm run api` on port 8787, then run `npm run dev`. See [backend/README.md](backend/README.md) for details.

The SQL file is used as a schema reference; its source-database rows are not imported by Prisma. Back up any existing PostgreSQL database before applying schema changes.
