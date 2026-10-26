# NestJS + Prisma backend

The API runs on NestJS at port 8787 and uses Prisma Client with PostgreSQL. All backend persistence uses typed Prisma model queries and transactions. The schema is in `prisma/schema.prisma`, mapped to the supplied osTicket table structures and the React-specific `ost_branch` table and ticket metadata.

## Setup

1. Install packages with `npm install`.
2. Configure `DATABASE_URL` and the API/SMTP variables in `.env`.
3. Create the PostgreSQL database if needed.
4. Run `npm run prisma:generate` and `npm run prisma:push`. These commands create/update the PostgreSQL schema; they do not import rows from the source SQL dump.
5. Run `npm run api`, then `npm run dev`.

The Nest API modules are under `backend/src`: authentication, tickets, admin data, mail, and Prisma. Keep database credentials and bootstrap credentials out of source control.
