# Google Drive Integration Setup

This guide explains how to set up Google Drive integration for file storage in Themoak ERP.

## Prerequisites

1. A Google Cloud Project
2. OAuth 2.0 credentials (Client ID and Client Secret)
3. Node.js package: `googleapis`

## Installation

Install the required package:

```bash
npm install googleapis
```

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"

4. Create OAuth 2.0 Credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - For local: `http://localhost:3000/api/google-drive/callback`
     - For production: `https://your-domain.com/api/google-drive/callback`
   - Save and copy the Client ID and Client Secret

## Environment Variables

Add the following to your `.env` file:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-drive/callback
```

For production (Vercel), add these as environment variables in your Vercel project settings.

## Usage

1. Go to Settings page (`/dashboard/settings`)
2. Scroll to "ذخیره‌سازی Google Drive" section
3. Click "اتصال به Google Drive"
4. Authorize the application in the Google OAuth flow
5. You'll be redirected back and the connection will be established

## How It Works

- When Google Drive is connected, all receipt files (images and PDFs) are uploaded to Google Drive
- Files are stored in a folder named "Themoak ERP Receipts"
- The folder is created automatically on first upload
- Files are stored with format: `gdrive:fileId` in the database
- If Google Drive is not connected, files fall back to local storage (`public/uploads/receipts/`)

## Security Notes

- OAuth tokens are stored encrypted in the database
- Tokens are automatically refreshed when expired
- Files uploaded to Google Drive are set to "anyone with link can view" for easy access
- Consider using service account with domain-wide delegation for enterprise setups

## Troubleshooting

### "Google Drive not connected" error
- Make sure you've completed the OAuth flow in settings
- Check that environment variables are set correctly
- Verify the redirect URI matches in Google Cloud Console

### Token refresh errors
- Reconnect Google Drive in settings
- Check that refresh_token was obtained (requires `prompt: 'consent'`)

### Upload failures
- Check Google Drive API quota limits
- Verify folder permissions
- Check network connectivity

