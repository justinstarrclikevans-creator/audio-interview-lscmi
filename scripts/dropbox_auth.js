console.log(`
=========================================================
      DROPBOX API SETUP FOR CLASS EVALUATIONS
=========================================================

To automate downloading class videos from Dropbox, you need
a permanent Refresh Token. Follow these steps carefully:

STEP 1: Create a Dropbox App
1. Go to: https://www.dropbox.com/developers/apps
2. Click "Create App"
3. Choose "Scoped access" and "Full Dropbox" (or App Folder)
4. Name your app (e.g., Turn90 Class Evals)
5. Go to the "Permissions" tab and check:
   - files.metadata.read
   - files.content.read
   Click "Submit" at the bottom!
6. Go back to "Settings" tab and add an OAuth2 Redirect URI:
   https://oauth.pstmn.io/v1/browser-callback
7. Copy your "App key" (DROPBOX_APP_KEY) and "App secret" (DROPBOX_APP_SECRET).

STEP 2: Get an Authorization Code
Open this URL in your browser (REPLACE THE APP_KEY FIRST!):

https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY_HERE&response_type=code&token_access_type=offline&redirect_uri=https://oauth.pstmn.io/v1/browser-callback

Click "Allow". You will be redirected. Look at the URL bar and 
copy the "code=XXXXXX" part.

STEP 3: Generate the Refresh Token
Run this cURL command in your terminal, replacing the placeholders:

curl https://api.dropbox.com/oauth2/token \\
  -d code=YOUR_AUTHORIZATION_CODE_HERE \\
  -d grant_type=authorization_code \\
  -d client_id=YOUR_APP_KEY_HERE \\
  -d client_secret=YOUR_APP_SECRET_HERE \\
  -d redirect_uri=https://oauth.pstmn.io/v1/browser-callback

In the JSON response, copy the "refresh_token".

STEP 4: Add to your .env file (or Render Environment Variables)
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=your_refresh_token

Once these are set, the automated 11 PM cron job will run successfully!
=========================================================
`);
