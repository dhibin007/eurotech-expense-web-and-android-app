import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const authClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Missing authorization token.' }, 401)

  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  if (userError || !userData.user) {
    return json({ error: 'Invalid or expired login session.' }, 401)
  }

  const { data: profile, error: profileError } = await adminClient
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError) return json({ error: profileError.message }, 500)
  if (profile?.role !== 'admin') return json({ error: 'Admin access required.' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch (_) {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const employeeId = String(body.employee_id ?? '').trim()
  const password = String(body.password ?? '').trim()

  if (!employeeId) return json({ error: 'Employee ID is required.' }, 400)
  if (password.length < 4) {
    return json({ error: 'Password must contain at least 4 characters.' }, 400)
  }

  const { data: employee, error: employeeError } = await adminClient
    .from('employees')
    .select('id, name, auth_user_id')
    .eq('id', employeeId)
    .maybeSingle()

  if (employeeError) return json({ error: employeeError.message }, 500)
  if (!employee) return json({ error: 'Employee not found.' }, 404)
  if (!employee.auth_user_id) return json({ error: 'This employee has no login account.' }, 400)

  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    employee.auth_user_id,
    { password },
  )

  if (updateError) return json({ error: updateError.message }, 500)

  return json({
    success: true,
    employee_id: employee.id,
    employee_name: employee.name,
  })
})
