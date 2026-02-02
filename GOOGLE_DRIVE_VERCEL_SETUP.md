# Google Drive Setup for Vercel

## How It Works Now

✅ **Credentials are stored in the database** (not environment variables)
- Go to Settings → Google Drive section
- Enter your Client ID and Client Secret
- Click "ذخیره اعتبارنامه‌ها" (Save Credentials)
- Then click "اتصال به Google Drive" (Connect to Google Drive)

## Installing googleapis in Vercel

**You don't need to do anything!** Vercel automatically installs packages from `package.json` during build.

Since `googleapis` is already in your `package.json`:
```json
"googleapis": "^144.0.0"
```

Vercel will:
1. Run `npm install` automatically when you deploy
2. Install all dependencies including `googleapis`
3. Build your application

## Setup Steps

### 1. Get Google OAuth Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable Google Drive API
4. Create OAuth 2.0 credentials (Web application)
5. Add redirect URI: `https://your-domain.vercel.app/api/google-drive/callback`
6. Copy Client ID and Client Secret

### 2. Configure in Your App
1. Deploy your app to Vercel (or run locally)
2. Log in as admin
3. Go to Settings (`/dashboard/settings`)
4. Scroll to "ذخیره‌سازی Google Drive"
5. Enter:
   - **Google Client ID**: Your Client ID
   - **Google Client Secret**: Your Client Secret
6. Click "ذخیره اعتبارنامه‌ها"
7. Click "اتصال به Google Drive"
8. Authorize in Google OAuth flow

### 3. For Production (Vercel)
- Make sure redirect URI in Google Cloud Console matches: `https://your-domain.vercel.app/api/google-drive/callback`
- The redirect URI is automatically detected from `AUTH_URL` or `NEXTAUTH_URL` environment variables
- Credentials are stored in your database, so they work across all environments

## Benefits of This Approach

✅ **No Vercel environment variables needed** - Everything is in the database
✅ **Easy to update** - Change credentials through the UI
✅ **Works in all environments** - Same setup for local, staging, and production
✅ **Secure** - Credentials stored in database (encrypted if you have encryption)

## Troubleshooting

### "googleapis not found" error
- This shouldn't happen in Vercel (it installs automatically)
- Locally: Run `npm install`
- Check that `googleapis` is in `package.json`

### "OAuth credentials not configured"
- Make sure you've entered and saved Client ID and Client Secret in settings
- Click "ذخیره اعتبارنامه‌ها" before trying to connect

### Redirect URI mismatch
- Check Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs
- Must match: `https://your-domain.vercel.app/api/google-drive/callback`
- For local: `http://localhost:3000/api/google-drive/callback`

