# Vercel Deployment Setup

## Required Environment Variables

You need to set the following environment variables in your Vercel project:

### 1. Database
```
DATABASE_URL=postgresql://user:password@host:5432/database?schema=public
```
Get this from your PostgreSQL provider (Vercel Postgres, Supabase, Neon, etc.)

### 2. Authentication (Required)
```
AUTH_SECRET=<generate-a-random-secret>
```

**Note:** You can use either `AUTH_SECRET` (NextAuth v5) or `NEXTAUTH_SECRET` (NextAuth v4) - both are supported.

**Generate the secret:**
```bash
openssl rand -base64 32
```

Or use this online: https://generate-secret.vercel.app/32

**Important:** The secret MUST be at least 32 characters long.

### 3. Authentication URL (Production)
```
AUTH_URL=https://your-production-domain.vercel.app
```

### 4. WooCommerce (Optional)
```
WOOCOMMERCE_URL=https://your-woocommerce-site.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxx
```

## Setting Environment Variables on Vercel

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add each variable:
   - Variable name (e.g., `AUTH_SECRET`)
   - Value (e.g., the generated secret)
   - Environment: Select **Production**, **Preview**, and **Development**
4. Click **Save**

## After Setting Environment Variables

1. Trigger a new deployment (push a commit or redeploy from Vercel dashboard)
2. The application should now work correctly

## Current Deployment Status

- ✅ TypeScript: 0 errors
- ✅ Database schema: Synced with `prisma db push`
- ⚠️  Environment variables: Need to be configured on Vercel

## Error: "There was a problem with the server configuration"

This error occurs when `AUTH_SECRET` is missing. Follow the steps above to set it.
