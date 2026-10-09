import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import './style.css';
const URL='https://ayotbrasmikzmdskgwqa.supabase.co';
const KEY='sb_publishable_gdPsXvKBSs0oR9M9wcRHPw_on4s0H4l';
const supabase=createClient(URL,KEY);
const money=n=>`AED ${Number(n||0).toFixed(2)}`;
const fmt=d=>d?new Date(d).toLocaleDateString('en-GB'):'';
const balance=(id,ts)=>ts.filter(t=>t.employee_id===id).reduce((s,t)=>s+(t.type==='credit'?+t.amount:-t.amount),0);
async function getData(){const [{data:e,error:ee},{data:t,error:te}]=await Promise.all([supabase.from('employees').select('*').order('name'),supabase.from('transactions').select('*').order('transaction_date',{ascending:false}).order('created_at',{ascending:false})]);if(ee)throw ee;if(te)throw te;return{employees:e||[],txns:t||[]}}
function excel(employees, txns, mode='all', employeeId=null) {
  try {
    const employeeMap = Object.fromEntries(employees.map(e => [e.id, e.name]));
    let rows = [...txns];
    if (employeeId) rows = rows.filter(t => t.employee_id === employeeId);
    if (mode === 'expenses') rows = rows.filter(t => t.type === 'debit');
    if (mode === 'issued') rows = rows.filter(t => t.type === 'credit');

    const transactionRows = rows.map(t => ({
      Date: fmt(t.transaction_date),
      Employee: employeeMap[t.employee_id] || t.employee_id || '',
      Type: t.type === 'credit' ? 'Cash Issued' : 'Expense',
      Project: t.project || '',
      Description: t.description || '',
      'Amount (AED)': Number(t.amount || 0),
      'Receipt Path': t.receipt_path || ''
    }));

    const walletRows = employees.map(e => {
      const r = txns.filter(t => t.employee_id === e.id);
      const issued = r.filter(t => t.type === 'credit').reduce((s,t) => s + Number(t.amount || 0), 0);
      const spent = r.filter(t => t.type === 'debit').reduce((s,t) => s + Number(t.amount || 0), 0);
      return {
        Employee: e.name || '',
        Username: e.username || '',
        'Cash Issued (AED)': issued,
        'Expenses (AED)': spent,
        'Available Balance (AED)': issued - spent,
        Status: e.active === false ? 'Inactive' : 'Active'
      };
    });

    const totalIssued = txns.filter(t=>t.type==='credit').reduce((s,t)=>s+Number(t.amount||0),0);
    const totalSpent = txns.filter(t=>t.type==='debit').reduce((s,t)=>s+Number(t.amount||0),0);

    const summaryRows = [
      ['EUROTECH Expense Report'],
      ['Generated', new Date().toLocaleString()],
      [],
      ['Employees', employees.filter(e=>e.active !== false).length],
      ['Total Cash Issued (AED)', totalIssued],
      ['Total Expenses (AED)', totalSpent],
      ['Available Cash (AED)', totalIssued - totalSpent]
    ];

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(transactionRows);
    ws1['!cols'] = [
      {wch:14},{wch:25},{wch:15},{wch:28},{wch:38},{wch:16},{wch:45}
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Transactions');

    const ws2 = XLSX.utils.json_to_sheet(walletRows);
    ws2['!cols'] = [{wch:28},{wch:20},{wch:20},{wch:18},{wch:24},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Wallet Summary');

    const ws3 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws3['!cols'] = [{wch:30},{wch:25}];
    XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

    const suffix = employeeId ? 'employee_ledger' : (mode === 'expenses' ? 'expenses' : mode === 'issued' ? 'cash_issued' : 'full_report');
    XLSX.writeFile(wb, `EUROTECH_Expense_${suffix}_${new Date().toISOString().slice(0,10)}.xlsx`);
  } catch (err) {
    console.error('Excel export failed:', err);
    alert('Excel export failed: ' + (err?.message || err));
  }
}


function normalizeReceiptPath(value) {
  let p = String(value || '').trim();
  try { p = decodeURIComponent(p); } catch (_) {}
  p = p.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/(?:sign|authenticated|public)\/receipts\//i, '');
  p = p.replace(/^storage\/v1\/object\/(?:sign|authenticated|public)\/receipts\//i, '');
  p = p.replace(/^receipts\//i, '');
  p = p.replace(/^\/+/, '');
  return p;
}

function receiptExtension(path, blob) {
  const m = String(path || '').match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (m) return m[1].toLowerCase();
  const type = String(blob?.type || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('pdf')) return 'pdf';
  return 'jpg';
}

async function downloadReceipts(employees, txns, employeeId=null) {
  const candidates = txns.filter(t => t.type === 'debit' && t.receipt_path && (!employeeId || t.employee_id === employeeId));
  if (!candidates.length) { alert('No receipts are available for the selected records.'); return; }

  const employeeMap = Object.fromEntries(employees.map(e => [e.id, e.name || e.id]));
  const zip = new JSZip();
  let downloaded = 0, skipped = 0;
  const failures = [];
  const usedNames = new Set();

  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];
    const path = normalizeReceiptPath(t.receipt_path);
    try {
      let blob = null;
      let firstError = '';

      // Primary method: Supabase authenticated storage download.
      const direct = await supabase.storage.from('receipts').download(path);
      if (!direct.error && direct.data && direct.data.size > 0) {
        blob = direct.data;
      } else {
        firstError = direct.error?.message || 'Storage download returned no file';
      }

      // Fallback: short-lived signed URL.
      if (!blob) {
        const signed = await supabase.storage.from('receipts').createSignedUrl(path, 600);
        if (!signed.error && signed.data?.signedUrl) {
          const response = await fetch(signed.data.signedUrl, { cache: 'no-store' });
          if (response.ok) {
            const candidateBlob = await response.blob();
            if (candidateBlob.size > 0) blob = candidateBlob;
            else firstError = 'Signed URL returned an empty file';
          } else {
            firstError = `Signed URL HTTP ${response.status}`;
          }
        } else {
          firstError = signed.error?.message || firstError || 'Could not create signed URL';
        }
      }

      if (!blob) {
        skipped++;
        failures.push(`${t.transaction_date || 'unknown date'} / ${employeeMap[t.employee_id] || 'Employee'}: ${firstError || 'download failed'} [${t.receipt_path}]`);
        continue;
      }

      const employee = String(employeeMap[t.employee_id] || 'Employee').replace(/[\\/:*?"<>|]/g,'_');
      const date = t.transaction_date || 'unknown-date';
      const project = String(t.project || 'No Project').replace(/[\\/:*?"<>|]/g,'_').slice(0,50);
      const description = String(t.description || 'Receipt').replace(/[\\/:*?"<>|]/g,'_').slice(0,50);
      const ext = receiptExtension(path, blob);
      let name = `${date}_${project}_${description}.${ext}`.replace(/\s+/g,'_');
      const originalName = name;
      let n = 2;
      while (usedNames.has(`${employee}/${name}`)) name = originalName.replace(`.${ext}`,`_${n++}.${ext}`);
      usedNames.add(`${employee}/${name}`);
      zip.file(`${employee}/${name}`, blob);
      downloaded++;
    } catch (e) {
      skipped++;
      failures.push(`${t.transaction_date || 'unknown date'} / ${employeeMap[t.employee_id] || 'Employee'}: ${e?.message || e} [${t.receipt_path}]`);
      console.warn('Receipt download failed', t.id, e);
    }
  }

  if (!downloaded) {
    const detail = failures.slice(0,3).join('\n');
    alert(`No receipt images could be downloaded.\n\n${detail || 'The receipts may have expired after the 6-month retention period.'}`);
    return;
  }

  try {
    const out = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{level:6} });
    const downloadUrl = window.URL.createObjectURL(out);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `EUROTECH_Receipts_${new Date().toISOString().slice(0,10)}${employeeId?'_employee':''}.zip`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 60000);
    alert(`Receipt ZIP created successfully.\n\n${downloaded} receipt(s) downloaded${skipped ? `\n${skipped} unavailable/skipped` : ''}.`);
  } catch (e) {
    alert(`Could not create the ZIP file: ${e?.message || e}`);
  }
}

async function resetEmployeePassword(employeeId, password) {
  const { data, error } = await supabase.functions.invoke('admin-reset-employee-password', {
    body: { employee_id: employeeId, password },
  });
  if (error) throw new Error(error.message || 'Password reset failed.');
  if (data?.error) throw new Error(data.error);
  return data;
}

function Login({done}){const[e,setE]=useState(''),[p,setP]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);async function go(x){x.preventDefault();setBusy(true);setErr('');let{data,error}=await supabase.auth.signInWithPassword({email:e,password:p});if(error){setErr(error.message);setBusy(false);return}let{data:pr}=await supabase.from('user_profiles').select('role').eq('id',data.user.id).single();if(pr?.role!=='admin'){await supabase.auth.signOut();setErr('Admin access only');setBusy(false);return}done(data.user)}return <div className="login"><form onSubmit={go}><b className="logo">€</b><h1>EUROTECH Expense</h1><p>Petty Cash Admin Dashboard</p><input type="email" placeholder="Admin email" value={e} onChange={x=>setE(x.target.value)} required/><input type="password" placeholder="Password" value={p} onChange={x=>setP(x.target.value)} required/>{err&&<div className="err">{err}</div>}<button disabled={busy}>{busy?'SIGNING IN…':'LOGIN'}</button></form></div>}
function App(){const[user,setUser]=useState(null),[d,setD]=useState({employees:[],txns:[]}),[page,setPage]=useState('dashboard'),[sel,setSel]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');async function load(){setBusy(true);try{setD(await getData())}catch(e){setErr(e.message)}finally{setBusy(false)}}useEffect(()=>{supabase.auth.getSession().then(({data})=>{if(data.session)setUser(data.session.user)});},[]);useEffect(()=>{if(user)load()},[user]);if(!user)return <Login done={setUser}/>;let{employees,txns}=d,issued=txns.filter(t=>t.type==='credit').reduce((s,t)=>s+ +t.amount,0),spent=txns.filter(t=>t.type==='debit').reduce((s,t)=>s+ +t.amount,0);return <div className="app"><aside><h2>€ EUROTECH</h2>{['dashboard','wallets','transactions','employees'].map(x=><button className={page===x?'active':''} onClick={()=>setPage(x)}>{x==='dashboard'?'Dashboard':x==='wallets'?'Wallet Ledgers':x==='transactions'?'Transactions':'Employees'}</button>)}<button onClick={()=>supabase.auth.signOut()}>Logout</button></aside><main><header><div><h1>{page}</h1><small>EUROTECH Expense • Admin</small></div><button onClick={load}>{busy?'Refreshing…':'↻ Refresh'}</button></header>{err&&<div className="err m">{err}</div>}{page==='dashboard'&&<Dashboard employees={employees} txns={txns} issued={issued} spent={spent} onSelect={e=>{setSel(e);setPage('wallets')}}/>}{page==='wallets'&&<Wallets employees={employees} txns={txns} sel={sel} setSel={setSel}/>} {page==='transactions'&&<Transactions employees={employees} txns={txns}/>} {page==='employees'&&<Employees employees={employees}/>}</main></div>}
function Dashboard({employees,txns,issued,spent,onSelect}){return <section><div className="stats"><Card a="Employees" b={employees.length}/><Card a="Cash Issued" b={money(issued)}/><Card a="Expenses" b={money(spent)}/><Card a="Available Cash" b={money(issued-spent)}/></div><div className="head"><h2>Wallet Ledgers</h2><div><button onClick={()=>excel(employees,txns)}>↓ Download Excel</button><button onClick={()=>downloadReceipts(employees,txns)}>📦 Download Receipts</button><button onClick={()=>excel(employees,txns,'expenses')}>Expenses Excel</button></div></div><div className="grid">{employees.filter(e=>e.active!==false).map(e=><button className="wallet" onClick={()=>onSelect(e)}><b>{e.name}</b><small>@{e.username}</small><strong>{money(balance(e.id,txns))}</strong><span>View ledger →</span></button>)}</div></section>}
function Card({a,b}){return <div className="card"><small>{a}</small><strong>{b}</strong></div>}
function Wallets({employees,txns,sel,setSel}){let e=sel||employees.find(x=>x.active!==false);let rows=e?txns.filter(t=>t.employee_id===e.id):[];return <section><div className="head"><h2>Wallet Ledgers</h2><div>{e&&<button onClick={()=>excel(employees,rows,'all',e.id)}>↓ Employee Excel</button>}{e&&<button onClick={()=>downloadReceipts(employees,rows,e.id)}>📦 Employee Receipts</button>}<button onClick={()=>excel(employees,txns)}>↓ Full Excel</button></div></div><div className="wallets"><div className="list">{employees.filter(e=>e.active!==false).map(x=><button className={e?.id===x.id?'selected':''} onClick={()=>setSel(x)}>{x.name}<b>{money(balance(x.id,txns))}</b></button>)}</div>{e&&<div className="ledger"><h2>{e.name}</h2><h3>{money(balance(e.id,txns))}</h3><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Project</th><th>Amount</th></tr></thead><tbody>{rows.map(t=><tr><td>{fmt(t.transaction_date)}</td><td>{t.type}</td><td>{t.description}</td><td>{t.project}</td><td>{t.type==='credit'?'+':'-'} {money(t.amount)}</td></tr>)}</tbody></table></div>}</div></section>}
function Transactions({employees,txns}){return <section><div className="head"><h2>Transactions</h2><div><button onClick={()=>excel(employees,txns)}>↓ Excel</button><button onClick={()=>downloadReceipts(employees,txns)}>📦 Receipts</button><button onClick={()=>excel(employees,txns,'expenses')}>Expenses</button><button onClick={()=>excel(employees,txns,'issued')}>Cash Issued</button></div></div><table><thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Description</th><th>Project</th><th>Amount</th></tr></thead><tbody>{txns.map(t=><tr><td>{fmt(t.transaction_date)}</td><td>{employees.find(e=>e.id===t.employee_id)?.name||''}</td><td>{t.type}</td><td>{t.description}</td><td>{t.project}</td><td>{money(t.amount)}</td></tr>)}</tbody></table></section>}
function Employees({employees}){
  const [selected,setSelected]=useState(null);
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  function open(e){
    setSelected(e); setPassword(''); setConfirm(''); setMessage(''); setError('');
  }
  function close(){if(!busy)setSelected(null)}
  async function save(e){
    e.preventDefault(); setError(''); setMessage('');
    if(password.length < 4){setError('Password must contain at least 4 characters.');return}
    if(password !== confirm){setError('Passwords do not match.');return}
    setBusy(true);
    try{
      await resetEmployeePassword(selected.id,password);
      setMessage(`Password updated for ${selected.name}.`);
      setPassword(''); setConfirm('');
    }catch(err){setError(err?.message||String(err))}
    finally{setBusy(false)}
  }

  return <section>
    <div className="head"><h2>Employees</h2><span className="muted">Admin can reset employee login passwords here.</span></div>
    <div className="grid">
      {employees.filter(e=>e.active !== false).map(e=><div className="emp" key={e.id}>
        <b>{e.name}</b><small>@{e.username}</small><small>{e.email}</small>
        <span>{e.active===false?'Inactive':'Active'}</span>
        <button onClick={()=>open(e)}>🔑 Set / Reset Password</button>
      </div>)}
    </div>
    {selected && <div className="modalBack" onMouseDown={close}>
      <form className="modal" onSubmit={save} onMouseDown={e=>e.stopPropagation()}>
        <h2>Set Employee Password</h2>
        <p><b>{selected.name}</b><br/><small>@{selected.username}</small></p>
        <input type="password" placeholder="New password / PIN" value={password} onChange={e=>setPassword(e.target.value)} minLength={4} autoFocus required />
        <input type="password" placeholder="Confirm password / PIN" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={4} required />
        {error&&<div className="err">{error}</div>}
        {message&&<div className="ok">{message}</div>}
        <div className="modalActions">
          <button type="button" onClick={close} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy}>{busy?'Saving…':'Save Password'}</button>
        </div>
      </form>
    </div>}
  </section>
}
createRoot(document.getElementById('root')).render(<App/>);
