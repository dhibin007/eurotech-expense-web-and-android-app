# EUROTECH Expense Web

This version includes:
- Admin employee password/PIN reset
- Receipt ZIP download
- CORS-enabled password reset Edge Function for browser use

## One-time Edge Function deployment

From this project folder:

```powershell
npx supabase link --project-ref ayotbrasmikzmdskgwqa
npx supabase functions deploy admin-reset-employee-password
```

Then run:

```powershell
npm install
npm run dev
```

The browser uses the Supabase publishable key only. Never put a service-role key in the browser.
