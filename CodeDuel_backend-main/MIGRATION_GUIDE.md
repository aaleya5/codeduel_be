# Database Migration Guide

## Running Migrations

After adding the `ProblemMetadata` table to the Prisma schema, you need to create and apply a migration.

### Step 1: Generate Prisma Client

```bash
npm run prisma:generate
```

### Step 2: Create Migration

```bash
npm run prisma:migrate
```

When prompted for a migration name, enter:

```
add_problem_metadata_table
```

### Step 3: Apply Migration

The migration will be automatically applied. Verify with:

```bash
npx prisma studio
```

## Migration Details

### New Table: `problem_metadata`

```sql
CREATE TABLE "problem_metadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "titleSlug" TEXT NOT NULL UNIQUE,
    "questionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "acRate" REAL,
    "likes" INTEGER,
    "dislikes" INTEGER,
    "isPaidOnly" BOOLEAN NOT NULL DEFAULT false,
    "topicTags" TEXT[],
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "problem_metadata_titleSlug_idx" ON "problem_metadata"("titleSlug");
CREATE INDEX "problem_metadata_difficulty_idx" ON "problem_metadata"("difficulty");
```

## Rollback (if needed)

```bash
npx prisma migrate reset
```

**⚠️ WARNING:** This will delete all data and reapply all migrations from scratch!

## Verify Schema

```bash
npx prisma db pull
```

This will verify your database schema matches Prisma schema.
