import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cleanupSecret = Deno.env.get('RECEIPT_CLEANUP_SECRET')!

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const suppliedSecret = req.headers.get('x-receipt-cleanup-secret')
  if (!cleanupSecret || suppliedSecret !== cleanupSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Retention is based on the transaction date, not the upload date.
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 6)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const { data: rows, error: queryError } = await admin
    .from('transactions')
    .select('id, receipt_path, transaction_date')
    .not('receipt_path', 'is', null)
    .lt('transaction_date', cutoffDate)
    .order('transaction_date', { ascending: true })
    .limit(1000)

  if (queryError) {
    return new Response(JSON.stringify({ error: queryError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!rows?.length) {
    return new Response(JSON.stringify({
      success: true,
      cutoff_date: cutoffDate,
      scanned: 0,
      deleted: 0,
      message: 'No receipts are older than 6 months.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const paths = rows.map((r) => r.receipt_path).filter(Boolean)
  const { error: storageError } = await admin.storage.from('receipts').remove(paths)

  if (storageError) {
    // Do not clear receipt_path when Storage deletion fails.
    return new Response(JSON.stringify({
      success: false,
      cutoff_date: cutoffDate,
      scanned: rows.length,
      deleted: 0,
      error: storageError.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const ids = rows.map((r) => r.id)
  const { error: clearError } = await admin
    .from('transactions')
    .update({ receipt_path: null, updated_at: new Date().toISOString() })
    .in('id', ids)

  if (clearError) {
    // The files are already gone. This is intentionally reported so it can be repaired.
    return new Response(JSON.stringify({
      success: false,
      cutoff_date: cutoffDate,
      scanned: rows.length,
      deleted: rows.length,
      warning: 'Receipt files were deleted, but transaction paths could not be cleared.',
      error: clearError.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    success: true,
    cutoff_date: cutoffDate,
    scanned: rows.length,
    deleted: rows.length,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
