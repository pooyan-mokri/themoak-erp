# Google OAuth Redirect URI Troubleshooting

## Common Issue: redirect_uri_mismatch

### Why This Happens

1. **Google Propagation Delay**: Google says "It may take 5 minutes to a few hours for settings to take effect"
2. **URI Mismatch**: The redirect URI in your code doesn't match what's in Google Console
3. **Case Sensitivity**: URIs are case-sensitive
4. **Trailing Slashes**: Must match exactly (no trailing slash)

## Step-by-Step Fix

### 1. Verify Redirect URI in Google Cloud Console

1. Go to: https://console.cloud.google.com/apis/credentials
2. Click your OAuth 2.0 Client ID
3. Check "Authorized redirect URIs" section
4. Make sure you have **exactly** this (no trailing slash):
   ```
   https://erp.themoak.com/api/google-drive/callback
   ```

### 2. Set Environment Variable in Vercel (Recommended)

To ensure the correct URI is used, set it explicitly:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - **Key**: `GOOGLE_REDIRECT_URI`
   - **Value**: `https://erp.themoak.com/api/google-drive/callback`
   - **Environment**: Production, Preview, Development (select all)
3. **Redeploy** your application after adding the variable

### 3. Check What URI Is Actually Being Used

After deploying, check your Vercel function logs:
1. Go to Vercel Dashboard → Your Project → Functions
2. Look for logs that say: `[Google Drive] Generating auth URL with redirect URI:`
3. Verify it matches: `https://erp.themoak.com/api/google-drive/callback`

### 4. Wait for Google Propagation

Even after adding the URI correctly:
- **Minimum wait**: 5 minutes
- **Typical wait**: 15-30 minutes
- **Maximum wait**: A few hours (rare)

### 5. Verify Both URIs Match Exactly

The URI in Google Console must match the URI in your code **exactly**:

✅ **Correct:**
```
https://erp.themoak.com/api/google-drive/callback
```

❌ **Wrong (trailing slash):**
```
https://erp.themoak.com/api/google-drive/callback/
```

❌ **Wrong (http instead of https):**
```
http://erp.themoak.com/api/google-drive/callback
```

❌ **Wrong (different domain):**
```
https://themoak-erp.vercel.app/api/google-drive/callback
```

## Quick Checklist

- [ ] Added `https://erp.themoak.com/api/google-drive/callback` to Google Console
- [ ] No trailing slash in Google Console
- [ ] Set `GOOGLE_REDIRECT_URI` in Vercel environment variables
- [ ] Redeployed after setting environment variable
- [ ] Waited at least 5 minutes after adding URI to Google Console
- [ ] Checked Vercel logs to verify the URI being used

## If Still Not Working

1. **Double-check Google Console**: Sometimes you need to refresh the page to see the updated URIs
2. **Try a different browser**: Clear cache or use incognito mode
3. **Check Vercel logs**: See what redirect URI is actually being sent
4. **Wait longer**: Sometimes it takes the full few hours Google mentions
5. **Verify custom domain**: Make sure `erp.themoak.com` is properly configured in Vercel

## Testing

After waiting and verifying, try connecting again:
1. Go to Settings → Google Drive
2. Enter Client ID and Client Secret
3. Click "ذخیره اعتبارنامه‌ها"
4. Click "اتصال به Google Drive"
5. If it still fails, check the error message - it will show what URI was expected vs received

