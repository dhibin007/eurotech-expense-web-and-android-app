# EUROTECH Expense Web

Admin web dashboard for EUROTECH Expense using Supabase.

## GitHub Pages

This project is configured for GitHub Pages using GitHub Actions.

1. Upload/push this project to your GitHub repository.
2. In GitHub open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to the `main` branch (or run the workflow manually).
5. Open the Pages URL shown by GitHub.

The Vite build uses relative asset paths, so the app works when hosted under a repository path such as `/EUROTECH-Expense-Web/`.

## Local development

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm run build
```

The `supabase/functions` folder contains Edge Function source code. It is not served by GitHub Pages; deploy those functions separately with the Supabase CLI.

## Employee management (web admin)

The Employees page now supports:
- Add employee (creates the employee's Supabase Auth login and employee profile)
- Edit employee name, username, and email
- Set/reset employee PIN or password

The `create-employee` Edge Function is required for secure employee creation. It validates the logged-in Supabase admin and keeps the service-role key on the server (never place the service-role key in the website).

Deploy it to the same Supabase project used by this app:

```powershell
npx supabase login
npx supabase link --project-ref ayotbrasmikzmdskgwqa
npx supabase functions deploy create-employee
```

The project already contains the source for `admin-reset-employee-password`, which the PIN reset button uses. Existing employee records and transactions are not deleted by these changes.
