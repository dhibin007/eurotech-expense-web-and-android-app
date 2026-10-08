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
