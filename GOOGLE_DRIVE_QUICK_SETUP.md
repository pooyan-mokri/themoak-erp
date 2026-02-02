# Google Drive Quick Setup Guide

## Step 1: Install the Package

```bash
npm install googleapis
```

## Step 2: Create Google Cloud Project & Credentials

### 2.1 Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/
2. Sign in with your Google account (pooyanmokri@gmail.com)

### 2.2 Create or Select a Project
1. Click the project dropdown at the top
2. Click "New Project"
3. Name it: "Themoak ERP" (or any name you prefer)
4. Click "Create"

### 2.3 Enable Google Drive API
1. In the left sidebar, go to **"APIs & Services"** > **"Library"**
2. Search for **"Google Drive API"**
3. Click on it and press **"Enable"**

### 2.4 Create OAuth 2.0 Credentials
1. Go to **"APIs & Services"** > **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"OAuth client ID"**
4. If prompted, configure the OAuth consent screen first:
   - Choose **"External"** (unless you have a Google Workspace)
   - Fill in:
     - App name: "Themoak ERP"
     - User support email: your email
     - Developer contact: your email
   - Click "Save and Continue" through the steps
   - Add your email as a test user (if in testing mode)

5. Back to creating OAuth client ID:
   - Application type: **"Web application"**
   - Name: "Themoak ERP Web Client"
   - **Authorized redirect URIs**: Add these:
     ```
     http://localhost:3000/api/google-drive/callback
     https://your-production-domain.com/api/google-drive/callback
     ```
   - Click **"Create"**

6. **IMPORTANT**: Copy the **Client ID** and **Client Secret** immediately (you won't see the secret again!)

## Step 3: Add Environment Variables

### For Local Development (.env file):
Add these lines to your `.env` file in the project root:

```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-drive/callback
```

**Replace `your-client-id-here` and `your-client-secret-here` with the actual values from Step 2.4**

### For Vercel Production:
1. Go to your Vercel project dashboard
2. Go to **Settings** > **Environment Variables**
3. Add each variable:
   - `GOOGLE_CLIENT_ID` = your client ID
   - `GOOGLE_CLIENT_SECRET` = your client secret
   - `GOOGLE_REDIRECT_URI` = `https://your-domain.vercel.app/api/google-drive/callback`

## Step 4: Restart Your Development Server

After adding the environment variables, restart your Next.js server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

## Step 5: Connect Google Drive

1. Open your app: http://localhost:3000
2. Log in as admin
3. Go to **Settings** (`/dashboard/settings`)
4. Scroll to **"ذخیره‌سازی Google Drive"** section
5. Click **"اتصال به Google Drive"**
6. You'll be redirected to Google to authorize
7. Click **"Allow"** to grant permissions
8. You'll be redirected back and see "متصل به Google Drive"

## Troubleshooting

### Error: "Missing required parameter: client_id"
- ✅ Make sure you added `GOOGLE_CLIENT_ID` to your `.env` file
- ✅ Restart your development server after adding env variables
- ✅ Check that there are no typos in the variable names

### Error: "redirect_uri_mismatch"
- ✅ Make sure the redirect URI in Google Cloud Console matches exactly:
  - Local: `http://localhost:3000/api/google-drive/callback`
  - Production: `https://your-domain.com/api/google-drive/callback`
- ✅ Check for trailing slashes or typos

### Error: "access_denied"
- ✅ Make sure you clicked "Allow" in the Google authorization screen
- ✅ If in testing mode, make sure your email is added as a test user

### Still having issues?
1. Check the browser console for errors
2. Check the server terminal for error messages
3. Verify all environment variables are set correctly
4. Make sure you restarted the server after adding env variables

