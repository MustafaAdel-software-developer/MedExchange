# MedExchange

Healthcare ordering platform API — NestJS, Prisma, PostgreSQL.

## Stack

- **API:** NestJS (TypeScript)
- **ORM:** Prisma
- **DB:** PostgreSQL
- **Auth:** JWT + refresh tokens
- **Payments:** Stripe Checkout (embedded)

## Quick start

```bash
cd nest-api
cp .env.example .env
# edit DATABASE_URL, JWT_*, etc.

npm install
npx prisma generate
npm run start:dev
```

Health check: `GET http://localhost:3000/health/db`

## Project layout

```
nest-api/
  prisma/          # schema
  src/
    auth/          # login, register, tokens, email confirm/reset
    entities/      # practices / entity context
    identifications/
    orders/
    payments/      # payment links + Stripe webhook
    services/      # service catalog / wizard reads
    catalog/       # states, categories, taxonomies
    ...
```

## Notes

Frontend (Vite + React + TypeScript) lands in a top-level `frontend/` folder in a later wave. This repository currently publishes the Nest API.
