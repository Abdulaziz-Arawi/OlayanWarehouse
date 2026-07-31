const SUPABASE_URL = 'https://kaxwfvegfpezomvlkqjz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_WXPqJWDFhMOUwPhOsrS3VA_S_ey3IAh';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORE_LABELS = { freezer:'فريزر المواد المجمدة', pantry:'مخزن المواد الغذائية', cleaning:'مخزن أدوات النظافة' };
const STORE_SHORT = { freezer:'الفريزر', pantry:'المواد الغذائية', cleaning:'أدوات النظافة' };

let DB = { items: [], vouchers: [], requests: [], invoices: [], quality: [], workers: [], attendance: [], inventoryCounts: [] };
let busy = false;
let currentUserEmail = null;
let fulfillingRequestId = null;

function fmtNum(n){
  n = Number(n);
  if (Number.isNaN(n)) return '0';
  return (Math.round(n*100)/100).toLocaleString('en-US');
}
function todayStr(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){
  if(!d) return '-';
  const parts = d.split('-');
  if(parts.length===3) return parts[2]+'/'+parts[1]+'/'+parts[0];
  return d;
}
function showBootLoader(text){
  const el = document.getElementById('bootLoader');
  if(!el) return;
  if(text) document.getElementById('bootText').innerHTML = text;
  el.classList.remove('hide');
}
function hideBootLoader(){
  const el = document.getElementById('bootLoader');
  if(el) el.classList.add('hide');
}

function showAppAlert(message){
  document.getElementById('appAlertMessage').textContent = message;
  document.getElementById('appAlertOverlay').classList.add('show');
}
document.getElementById('appAlertCloseBtn').addEventListener('click', ()=>{
  document.getElementById('appAlertOverlay').classList.remove('show');
});

(function initScrollReveal(){
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ظهور تدريجي للكروت عند دخولها الشاشة أثناء التمرير — لمسة احترافية خفيفة
  if(!reduceMotion && 'IntersectionObserver' in window){
    const io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('scroll-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    function observeScrollCards(){
      const vh = window.innerHeight;
      document.querySelectorAll('.view.active .card:not(.scroll-in)').forEach(function(card){
        const r = card.getBoundingClientRect();
        // الكروت الظاهرة فوق الشاشة أصلًا (عند فتح التبويب) تاخذ أنيميشن التبويب العادي، وما تتكرر معها
        if(r.top < vh && r.bottom > 0){ card.classList.add('scroll-in'); return; }
        card.classList.add('scroll-pre');
        io.observe(card);
      });
    }
    observeScrollCards();
    document.querySelectorAll('.tab').forEach(function(tab){
      tab.addEventListener('click', function(){ setTimeout(observeScrollCards, 50); });
    });
  }
})();

(function initThemeToggle(){
  const dayBtn = document.getElementById('themeDayBtn');
  const nightBtn = document.getElementById('themeNightBtn');
  if(!dayBtn || !nightBtn) return;
  function currentTheme(){
    return document.documentElement.getAttribute('data-theme') === 'night' ? 'night' : 'day';
  }
  function syncButtons(){
    const t = currentTheme();
    dayBtn.classList.toggle('active', t === 'day');
    nightBtn.classList.toggle('active', t === 'night');
  }
  function setTheme(t){
    try{ localStorage.setItem('siteTheme', t); }catch(e){}
    location.reload();
  }
  dayBtn.addEventListener('click', function(){ if(currentTheme() !== 'day') setTheme('day'); });
  nightBtn.addEventListener('click', function(){ if(currentTheme() !== 'night') setTheme('night'); });
  syncButtons();
})();

function setConn(state, text){
  const pDot = document.getElementById('profileDbDot');
  const pText = document.getElementById('profileDbText');
  const pRow = document.getElementById('profileDbStatus');
  if(pDot && pText && pRow){
    pDot.className = 'conn-dot' + (state ? ' '+state : '');
    pText.textContent = state==='ok' ? 'متصل بقاعدة البيانات' : (state==='err' ? 'تعذر الاتصال بقاعدة البيانات' : text);
    pRow.className = 'profile-session' + (state==='ok' ? ' online' : (state==='err' ? ' offline' : ''));
  }
}

let dbActivityIdleTimer = null;
function setDbActivity(state){
  const el = document.getElementById('dbActivity');
  if(!el) return;
  el.className = 'db-activity' + (state ? ' '+state : '');
  el.title = state==='err' ? 'تعذر الاتصال — اضغط لإعادة المحاولة'
    : state==='busy' ? 'جارٍ الإرسال إلى قاعدة البيانات...'
    : 'متصل بقاعدة البيانات';
  clearTimeout(dbActivityIdleTimer);
  if(state==='ok'){
    dbActivityIdleTimer = setTimeout(()=>{
      if(el.classList.contains('ok')) setDbActivity('');
    }, 1400);
  }
}
document.getElementById('dbActivity').addEventListener('click', ()=>{
  if(document.getElementById('dbActivity').classList.contains('err')) loadDB();
});

function showErr(prefix, error){
  alert(prefix + (error && error.message ? ('\n\nتفاصيل تقنية: ' + error.message) : ''));
}

function animateCounters(container){
  container.querySelectorAll('[data-count]').forEach(el=>{
    const target = parseInt(el.dataset.count, 10) || 0;
    if(target === 0){ el.textContent = '0'; return; }
    let cur = 0;
    const step = Math.max(1, Math.ceil(target/24));
    const tick = ()=>{
      cur = Math.min(target, cur + step);
      el.textContent = cur.toLocaleString('en-US');
      if(cur < target) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function tryLogin(){
  const email = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  showBootLoader('جارٍ تسجيل الدخول...');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if(error){
    hideBootLoader();
    errorEl.textContent = 'بيانات الدخول غير صحيحة، أو الحساب غير موجود.';
    errorEl.style.display = 'block';
    return;
  }
  errorEl.style.display = 'none';
  await enterApp();
}

async function enterApp(){
  showBootLoader('جارٍ تحميل بياناتك...' + (typeof randomBootTip==='function' ? (' — ' + randomBootTip()) : ''));
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  await applyRole();
  await populateProfile();
  await loadDB();
  hideBootLoader();
  maybeShowWelcome();
  if(typeof applyPersonalization === 'function') applyPersonalization();
  if(typeof maybeShowWeeklySummary === 'function') maybeShowWeeklySummary();
  if(typeof maybeShowAnniversary === 'function') maybeShowAnniversary();
  if(typeof reloadStickyNote === 'function') reloadStickyNote();
}

let currentRole = 'viewer';

async function applyRole(){
  currentRole = 'viewer';
  try{
    const { data: userData } = await sb.auth.getUser();
    const uid = userData && userData.user ? userData.user.id : null;
    if(uid){
      const { data: profile } = await sb.from('profiles').select('role').eq('id', uid).single();
      if(profile && profile.role === 'admin') currentRole = 'admin';
      else if(profile && profile.role === 'requester') currentRole = 'requester';
    }
  }catch(e){
    console.error('تعذر تحديد صلاحية المستخدم، سيتم افتراض "مشاهد فقط" للأمان.', e);
  }

  const badge = document.getElementById('roleBadge');
  const adminTabs = document.querySelectorAll('.tab[data-admin-only]');
  const newVoucherBtn = document.getElementById('newVoucherBtn');
  const requesterTab = document.querySelector('.tab[data-requester-only]');
  const searchBtn = document.getElementById('globalSearchBtn');

  adminTabs.forEach(t=> t.style.display = (currentRole === 'admin') ? '' : 'none');
  if(newVoucherBtn) newVoucherBtn.style.display = (currentRole === 'admin') ? 'flex' : 'none';

  if(currentRole === 'requester'){
    badge.style.display = 'inline-block';
    badge.textContent = 'طلب أصناف';
    document.querySelectorAll('.tab').forEach(t=>{ if(!t.hasAttribute('data-requester-only')) t.style.display = 'none'; });
    if(requesterTab) requesterTab.style.display = '';
    if(searchBtn) searchBtn.style.display = 'none';
    switchToTab('myrequests');
  } else {
    if(requesterTab) requesterTab.style.display = 'none';
    if(currentRole === 'admin'){
      badge.style.display = 'none';
    } else {
      badge.style.display = 'inline-block';
      badge.textContent = 'مشاهدة فقط';
      const activeTab = document.querySelector('.tab.active');
      if(activeTab && (activeTab.hasAttribute('data-admin-only') || activeTab.hasAttribute('data-requester-only'))){
        switchToTab('dashboard');
      }
    }
  }
}

document.getElementById('loginBtn').addEventListener('click', tryLogin);
['loginUser','loginPass'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key==='Enter') tryLogin();
  });
});
document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  const nameEl = document.getElementById('profileName');
  const name = (nameEl && nameEl.textContent && nameEl.textContent !== 'الحساب') ? nameEl.textContent : '';
  if(typeof devToast === 'function'){
    devToast('<i class="fa-solid fa-hand"></i> شكرًا على شغلك اليوم' + (name ? ' يا ' + name : '') + '، نشوفك قريب!');
  }
  await sb.auth.signOut();
  setTimeout(function(){ location.reload(); }, 900);
});

function initialsOf(email){
  if(!email) return '؟';
  const local = email.split('@')[0] || '';
  const clean = local.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g,'').toLowerCase();
  return (clean.slice(0,2) || local.slice(0,2)).toUpperCase();
}
async function populateProfile(){
  try{
    const { data: userData } = await sb.auth.getUser();
    const user = userData && userData.user ? userData.user : null;
    if(!user) return;
    currentUserEmail = user.email || null;
    const email = user.email || 'بدون بريد';
    const name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || email.split('@')[0];
    const ini = initialsOf(email);

    const setEl = (id, txt)=>{ const el=document.getElementById(id); if(el) el.textContent = txt; };
    setEl('profileName', name);
    setEl('profileEmail', email);
    setEl('profileHeadName', name);
    setEl('profileHeadEmail', email);
    setEl('profileAvatar', ini);
    setEl('profileAvatarBig', ini);

    const roleEl = document.getElementById('profileRole');
    const roleText = document.getElementById('profileRoleText');
    if(roleEl && roleText){
      if(currentRole === 'admin'){
        roleEl.classList.remove('viewer');
        roleText.textContent = 'مسؤول';
      } else if(currentRole === 'requester'){
        roleEl.classList.add('viewer');
        roleText.textContent = 'طلب أصناف';
      } else {
        roleEl.classList.add('viewer');
        roleText.textContent = 'مشاهد فقط';
      }
    }

    const pmSettings = document.getElementById('pmSettings');
    if(pmSettings) pmSettings.style.display = (currentRole === 'admin') ? 'flex' : 'none';
  }catch(e){ console.error('profile populate failed', e); }
}

(function setupProfileMenu(){
  const root = document.getElementById('profileRoot');
  const trigger = document.getElementById('profileTrigger');
  const menu = document.getElementById('profileMenu');
  if(!root || !trigger || !menu) return;

  const toggle = (force)=>{
    const willOpen = typeof force === 'boolean' ? force : !root.classList.contains('open');
    root.classList.toggle('open', willOpen);
    trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  };

  trigger.addEventListener('click', (e)=>{ e.stopPropagation(); toggle(); });
  trigger.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle(); }
    if(e.key==='Escape'){ toggle(false); }
  });
  document.addEventListener('click', (e)=>{
    if(!root.contains(e.target)) toggle(false);
  });
  menu.addEventListener('click', (e)=>{
    if(!e.target.closest('.profile-item')) return;
  });

  const goto = (view)=>{
    const tab = document.querySelector('.tab[data-view="'+view+'"]');
    if(!tab || tab.style.display === 'none') return;
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('view-'+view).classList.add('active');
    toggle(false);
  };

  document.getElementById('pmDashboard').addEventListener('click', ()=> goto('dashboard'));
  document.getElementById('pmLedger').addEventListener('click', ()=> goto('ledger'));
  document.getElementById('pmLog').addEventListener('click', ()=> goto('log'));
  document.getElementById('pmSettings').addEventListener('click', ()=> goto('settings'));
  document.getElementById('pmShortcuts').addEventListener('click', ()=>{ toggle(false); openShortcutsHelp(); });

  const fsBtn = document.getElementById('pmFullscreen');
  fsBtn.addEventListener('click', async ()=>{
    try{
      if(!document.fullscreenElement){
        await document.documentElement.requestFullscreen();
        fsBtn.querySelector('.ico').innerHTML = '<i class="fa-solid fa-compress"></i>';
      } else {
        await document.exitFullscreen();
        fsBtn.querySelector('.ico').innerHTML = '<i class="fa-solid fa-expand"></i>';
      }
    }catch(e){}
  });
})();

const GEO_GATE_KEY = 'geoGateOk';
async function checkGeoGate(){
  const cached = sessionStorage.getItem(GEO_GATE_KEY);
  if(cached === '1') return true;
  if(cached === '0') return false;
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=> ctrl.abort(), 6000);
    const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
    clearTimeout(t);
    const d = await res.json();
    if(d && d.error) throw new Error(d.reason || 'geo error');
    const city = (d.city||'');
    const region = (d.region||'') + ' ' + (d.region_code||'');
    const country = (d.country_name||'') + ' ' + (d.country_code||'');
    const isMecca = /mecca|makkah/i.test(city) || /mecca|makkah/i.test(region);
    const isSaudi = /saudi/i.test(country) || /\bSA\b/.test(country);
    const ok = isMecca && isSaudi;
    sessionStorage.setItem(GEO_GATE_KEY, ok ? '1' : '0');
    return ok;
  }catch(e){
    console.warn('تعذّر التحقق من الموقع الجغرافي عبر IP؛ سيتم السماح بالدخول افتراضيًا لتفادي تعطيل الموظفين بسبب عطل بخدمة خارجية.', e);
    return true;
  }
}
function showGeoBlocked(){
  const loader = document.getElementById('bootLoader');
  loader.classList.remove('hide');
  loader.innerHTML = '<div class="boot-loader-inner" style="max-width:320px;padding:0 20px;">'
    + '<div style="font-size:40px;margin-bottom:14px;"><i class="fa-solid fa-ban"></i></div>'
    + '<div class="boot-brand">غير متاح من موقعك الحالي</div>'
    + '<p class="boot-text" style="font-family:var(--font-body);font-size:13px;line-height:1.8;">هذا النظام مخصص للاستخدام داخل مكة المكرمة فقط.<br>إذا كنت تعتقد أن هذا خطأ، تواصل مع إدارة النظام.</p>'
    + '</div>';
}

(async function checkExistingSession(){
  const { data } = await sb.auth.getSession();
  if(data && data.session){
    await enterApp();
    return;
  }
  const allowed = await checkGeoGate();
  if(allowed){
    hideBootLoader();
  } else {
    showGeoBlocked();
  }
})();

async function loadDB(){
  setConn('', 'جارٍ التحميل...');
  setDbActivity('busy');
  try{
    const [{ data: items, error: itemsErr }, { data: vouchers, error: vErr }, { data: requests, error: rErr }, { data: invoices, error: invErr }, { data: quality, error: qErr }, { data: workers, error: wErr }, { data: attendance, error: attErr }] = await Promise.all([
      sb.from('items').select('*').order('name'),
      sb.from('vouchers').select('*, voucher_lines(*)').order('created_at', { ascending:false }),
      sb.from('material_requests').select('*, material_request_lines(*)').order('created_at', { ascending:false }),
      sb.from('invoice_archive').select('*').order('created_at', { ascending:false }),
      sb.from('quality_checks').select('*').order('created_at', { ascending:false }),
      sb.from('workers').select('*').order('name'),
      sb.from('attendance').select('*').order('attendance_date', { ascending:false })
    ]);
    if(itemsErr) throw itemsErr;
    if(vErr) throw vErr;
    if(rErr) throw rErr;
    if(invErr) throw invErr;
    if(qErr) throw qErr;
    if(wErr) throw wErr;
    if(attErr) throw attErr;

    DB.items = (items||[]).map(i=>({
      id:i.id, store:i.store, name:i.name, unit:i.unit,
      balance:Number(i.balance), min:Number(i.min_qty), barcode:i.barcode || null,
      photo:i.photo_path || null,
      price: Number(i.unit_price || 0)
    }));
    DB.vouchers = (vouchers||[]).map(v=>({
      id:v.id, type:v.type, number:v.number, date:v.voucher_date,
      party:v.party, notes:v.notes, createdAt:new Date(v.created_at).getTime(),
      photoUrl: v.photo_path || null,
      signedPhotoUrl: v.signed_photo_path || null,
      closed: !!v.closed,
      closedAt: v.closed_at || null,
      lines:(v.voucher_lines||[]).map(l=>({
        itemId:l.item_id, name:l.name, unit:l.unit, qty:Number(l.qty), store:l.store
      }))
    }));

    DB.requests = (requests||[]).map(r=>{
      const linkedVoucher = r.fulfilled_voucher_id ? DB.vouchers.find(v=>v.id===r.fulfilled_voucher_id) : null;
      return {
        id:r.id, number:r.number, requestedBy:r.requested_by, notes:r.notes, status:r.status,
        date:r.request_date, createdAt:new Date(r.created_at).getTime(),
        fulfilledVoucherId:r.fulfilled_voucher_id || null,
        fulfilledVoucherNumber: linkedVoucher ? linkedVoucher.number : null,
        lines:(r.material_request_lines||[]).map(l=>({
          itemId:l.item_id, name:l.name, unit:l.unit, qty:Number(l.qty), store:l.store
        }))
      };
    });

    DB.invoices = (invoices||[]).map(v=>({
      id:v.id, number:v.number, note:v.note, party:v.party || null, photoUrl:v.photo_path || null,
      docType: v.doc_type || 'supplier',
      docDate: v.doc_date || new Date(v.created_at).toISOString().slice(0,10),
      createdAt:new Date(v.created_at).getTime()
    }));

    DB.quality = (quality||[]).map(q=>({
      id:q.id, store:q.store, photoUrl:q.photo_path || null,
      warehouseNote:q.warehouse_note, storageNote:q.storage_note,
      date:q.check_date, createdAt:new Date(q.created_at).getTime()
    }));

    DB.workers = (workers||[]).map(w=>({
      id:w.id, name:w.name, jobTitle:w.job_title, active: w.active !== false, createdAt:new Date(w.created_at).getTime()
    }));
    DB.attendance = (attendance||[]).map(a=>({
      id:a.id, workerId:a.worker_id, date:a.attendance_date, status:a.status, createdAt:new Date(a.created_at).getTime()
    }));

    // جدول الجرد اختياري — لو ما زال المستخدم ما شغّل SQL إنشاء الجداول، نتجاهل الخطأ بهدوء
    // بدل ما نكسر تحميل بقية الموقع (لهذا معزول بمحاولة try/catch مستقلة عن بقية الجداول).
    try{
      const { data: invCounts, error: icErr } = await sb.from('inventory_counts').select('*, inventory_count_lines(*)').order('count_date', { ascending:false });
      if(icErr) throw icErr;
      DB.inventoryCounts = (invCounts||[]).map(c=>({
        id:c.id, date:c.count_date, store:c.store||null, notes:c.notes, createdBy:c.created_by,
        finalized: !!c.finalized, createdAt: new Date(c.created_at).getTime(),
        lines: (c.inventory_count_lines||[]).map(l=>({
          id:l.id, itemId:l.item_id, name:l.item_name, store:l.store, unit:l.unit,
          systemQty:Number(l.system_qty), countedQty:Number(l.counted_qty), note:l.note
        }))
      }));
    }catch(icEx){
      console.warn('تعذر تحميل بيانات الجرد — تأكد إنك شغّلت SQL إنشاء جداول الجرد بلوحة تحكم Supabase.', icEx);
      DB.inventoryCounts = DB.inventoryCounts || [];
    }

    setConn('ok', 'متصل بقاعدة البيانات');
    setDbActivity('ok');
    renderAll();
  }catch(e){
    console.error(e);
    setConn('err', 'تعذر الاتصال — اضغط لإعادة المحاولة');
    setDbActivity('err');
  }
}

function switchToTab(view){
  const tab = document.querySelector('.tab[data-view="'+view+'"]');
  if(!tab || tab.style.display === 'none') return false;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('view-'+view).classList.add('active');
  if(view==='ledger') renderLedgerSelect();
  if(view==='reports' && typeof renderMonthlyReport==='function') renderMonthlyReport();
  return true;
}

document.getElementById('tabs').addEventListener('click', (e)=>{
  const tab = e.target.closest('.tab');
  if(!tab) return;
  switchToTab(tab.dataset.view);
});
document.getElementById('settingsPinBtn').addEventListener('click', ()=> switchToTab('settings'));

function getItemsByStore(store){
  return DB.items.filter(i=> store==='all' || i.store===store);
}
function findItem(id){ return DB.items.find(i=>i.id===id); }
function normName(s){
  s = (s||'').trim();
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, '');
  s = s.replace(/[إأآا]/g, 'ا');
  s = s.replace(/[ىی]/g, 'ي');
  s = s.replace(/\s+/g, ' ');
  return s.toLowerCase();
}
function findItemByStoreName(store, name){
  const n = normName(name);
  return DB.items.find(i=> i.store===store && normName(i.name)===n);
}
function findItemByBarcode(code){
  code = (code||'').trim();
  if(!code) return null;
  return DB.items.find(i=> i.barcode && i.barcode===code);
}

// تحديث ذرّي لرصيد صنف عبر دالة قاعدة بيانات (increment_item_balance) بدل قراءة الرصيد
// محليًا ثم حسابه وكتابته — يمنع تعارض الأرصدة (Lost Update) لو موظفين سجّلوا سندات
// بنفس اللحظة على نفس الصنف. تتطلب تشغيل ملف SQL المرفق مرة واحدة بلوحة تحكم Supabase.
async function incrementItemBalance(itemId, delta){
  const { data, error } = await sb.rpc('increment_item_balance', { p_item_id: itemId, p_delta: delta });
  if(error) throw error;
  return Math.round(Number(data) * 100) / 100;
}

document.getElementById('addItemBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const store = document.getElementById('newItemStore').value;
  const name = document.getElementById('newItemName').value.trim();
  const unit = document.getElementById('newItemUnit').value.trim() || 'وحدة';
  const balance = parseFloat(document.getElementById('newItemBalance').value) || 0;
  const min = parseFloat(document.getElementById('newItemMin').value) || 0;
  const barcode = document.getElementById('newItemBarcode').value.trim() || null;
  if(!name){ showAppAlert('الرجاء إدخال اسم الصنف.'); return; }

  if(barcode && DB.items.some(i=> i.barcode===barcode)){
    showAppAlert('هذا الباركود مستخدم مسبقًا لصنف آخر. كل باركود يجب أن يكون مرتبطًا بصنف واحد فقط.');
    return;
  }

  busy = true;
  const existing = findItemByStoreName(store, name);
  try{
    if(existing){
      const newBalance = Math.round((existing.balance + balance)*100)/100;
      const payload = { balance:newBalance };
      if(min>0) payload.min_qty = min;
      if(barcode) payload.barcode = barcode;
      const { error } = await sb.from('items').update(payload).eq('id', existing.id);
      if(error) throw error;
      await loadDB();
      showAppAlert('هذا الصنف موجود مسبقًا في '+STORE_LABELS[store]+' باسم "'+existing.name+'" — تم دمج الكمية مع رصيده الحالي بدل إنشاء صنف مكرر. الرصيد الآن: '+fmtNum(newBalance)+' '+existing.unit);
    } else {
      const { error } = await sb.from('items').insert({ store, name, unit, balance, min_qty:min, barcode });
      if(error) throw error;
      await loadDB();
    }
    document.getElementById('newItemName').value='';
    document.getElementById('newItemUnit').value='';
    document.getElementById('newItemBalance').value=0;
    document.getElementById('newItemMin').value=0;
    document.getElementById('newItemBarcode').value='';
  }catch(e){
    if(e && e.code === '23505'){
      showAppAlert('هذا الباركود مستخدم مسبقًا لصنف آخر بقاعدة البيانات.');
    } else {
      showErr('تعذرت إضافة الصنف.', e);
    }
  }
  busy = false;
});

document.getElementById('itemsFilterStore').addEventListener('change', renderItemsTable);
document.getElementById('itemsSearch').addEventListener('input', renderItemsTable);

document.getElementById('exportItemsExcelBtn').addEventListener('click', ()=>{
  const store = document.getElementById('itemsFilterStore').value;
  const q = document.getElementById('itemsSearch').value.trim().toLowerCase();
  let list = getItemsByStore(store);
  if(q) list = list.filter(i=> i.name.toLowerCase().includes(q));

  if(list.length===0){ showAppAlert('لا توجد أصناف لتصديرها حسب الفلترة الحالية.'); return; }

  const rows = list.map(i=>({
    'الصنف': i.name,
    'المخزن': STORE_LABELS[i.store] || i.store,
    'الوحدة': i.unit,
    'الرصيد الحالي': i.balance,
    'الحد الأدنى': i.min,
    'الباركود': i.barcode || '',
    'عند الحد الأدنى؟': (i.min>0 && i.balance<=i.min) ? 'نعم' : 'لا'
  }));

  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الأصناف');
    XLSX.writeFile(wb, 'أصناف-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

function renderItemsTable(){
  const store = document.getElementById('itemsFilterStore').value;
  const q = document.getElementById('itemsSearch').value.trim().toLowerCase();
  const tbody = document.querySelector('#itemsTable tbody');
  let list = getItemsByStore(store);
  if(q) list = list.filter(i=> i.name.toLowerCase().includes(q));
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="icon"><i class="fa-solid fa-box"></i></div>لا توجد أصناف مطابقة. أضف صنفًا جديدًا من الأعلى.</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(i=>{
    const low = i.min>0 && i.balance<=i.min;
    return `<tr>
      <td class="wrap-cell" data-label="الصنف" title="${escapeHtml(i.name)}">${escapeHtml(i.name)}</td>
      <td class="wrap-cell" data-label="المخزن"><span class="pill pill-store-${i.store}">${STORE_LABELS[i.store]}</span></td>
      <td data-label="الوحدة">${escapeHtml(i.unit)}</td>
      <td class="mono mono-cell ${low?'low-flag':''}" data-label="الرصيد الحالي">${fmtNum(i.balance)}${low?' <i class="fa-solid fa-triangle-exclamation"></i>':''}</td>
      <td class="mono mono-cell" data-label="الحد الأدنى">${fmtNum(i.min)}</td>
      <td data-label="الباركود">
        <input class="mono item-barcode-input" data-item-barcode="${i.id}" value="${escapeHtml(i.barcode||'')}" placeholder="لا يوجد باركود" style="font-size:12.5px;padding:8px 10px;width:100%;text-align:center;">
      </td>
      <td data-label="الصورة">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">
          ${i.photo ? `<img src="${i.photo}" alt="" data-view-item-photo="${i.photo}" style="width:30px;height:30px;object-fit:cover;border-radius:7px;border:1px solid var(--line-strong);cursor:pointer;flex-shrink:0;">` : ''}
          <button class="btn-ghost btn-sm" data-photo-item="${i.id}" title="${i.photo ? 'استبدال الصورة' : 'إرفاق صورة'}" style="flex-shrink:0;padding:6px 9px;">${i.photo ? '<i class="fa-solid fa-arrows-rotate"></i>' : '<i class="fa-solid fa-camera"></i>'}</button>
          ${i.photo ? `<button class="btn-danger-outline btn-sm" data-photo-remove="${i.id}" title="حذف الصورة" style="flex-shrink:0;"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      </td>
      <td data-label=""><button class="btn-danger-outline btn-sm" data-del="${i.id}" disabled>حذف</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(busy) return;
      if(!confirm('حذف هذا الصنف؟ سجل السندات القديم يبقى كما هو.')) return;
      busy = true;
      try{
        const { error } = await sb.from('items').delete().eq('id', btn.dataset.del);
        if(error) throw error;
        await loadDB();
      }catch(e){ showErr('تعذر حذف الصنف.', e); }
      busy = false;
    });
  });

  tbody.querySelectorAll('[data-item-barcode]').forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      if(busy) return;
      const itemId = inp.dataset.itemBarcode;
      const original = (findItem(itemId) || {}).barcode || null;
      const newCode = inp.value.trim() || null;
      if(newCode === original) return;

      if(newCode && DB.items.some(x=> x.barcode===newCode && x.id!==itemId)){
        showAppAlert('هذا الباركود مستخدم مسبقًا لصنف آخر. كل باركود يجب أن يكون مرتبطًا بصنف واحد فقط.');
        inp.value = original || '';
        return;
      }
      busy = true;
      inp.disabled = true;
      try{
        const { error } = await sb.from('items').update({ barcode: newCode }).eq('id', itemId);
        if(error) throw error;
        await loadDB();
      }catch(e){
        if(e && e.code === '23505'){
          showAppAlert('هذا الباركود مستخدم مسبقًا لصنف آخر بقاعدة البيانات.');
        } else {
          showErr('تعذر حفظ الباركود.', e);
        }
        inp.value = original || '';
        inp.disabled = false;
      }
      busy = false;
    });
  });

  tbody.querySelectorAll('[data-view-item-photo]').forEach(img=>{
    img.addEventListener('click', ()=> window.open(img.dataset.viewItemPhoto, '_blank'));
  });
  tbody.querySelectorAll('[data-photo-item]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      itemPhotoTargetId = btn.dataset.photoItem;
      document.getElementById('itemPhotoInput').click();
    });
  });
  tbody.querySelectorAll('[data-photo-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(busy) return;
      if(!confirm('حذف صورة هذا الصنف؟')) return;
      busy = true;
      try{
        const { error } = await sb.from('items').update({ photo_path: null }).eq('id', btn.dataset.photoRemove);
        if(error) throw error;
        await loadDB();
      }catch(e){ showErr('تعذر حذف الصورة.', e); }
      busy = false;
    });
  });
}

let itemPhotoTargetId = null;
document.getElementById('itemPhotoInput').addEventListener('change', async ()=>{
  const input = document.getElementById('itemPhotoInput');
  const file = input.files[0];
  const itemId = itemPhotoTargetId;
  input.value = '';
  if(!file || !itemId) return;
  try{
    const url = await uploadVoucherPhoto(file, 'items', itemId);
    const { error } = await sb.from('items').update({ photo_path: url }).eq('id', itemId);
    if(error) throw error;
    await loadDB();
  }catch(e){
    showErr('تعذر رفع صورة الصنف.', e);
  }
});

let zxingReader = null;
let scannerControls = null;
let scannerOnResult = null;
let lastScanCode = null;
let lastScanTime = 0;
let scannerPaused = false;

async function openScanner(onResult, statusText){
  const overlay = document.getElementById('scannerOverlay');
  const statusEl = document.getElementById('scannerStatus');
  statusEl.textContent = statusText || 'وجّه الكاميرا نحو الباركود...';
  overlay.classList.add('show');
  scannerOnResult = onResult;
  lastScanCode = null; lastScanTime = 0;
  scannerPaused = false;
  document.getElementById('scannerQuickAdd').style.display = 'none';

  if(!window.ZXingBrowser){
    statusEl.textContent = 'تعذر تحميل أداة المسح — تأكد من اتصالك بالإنترنت وحدّث الصفحة.';
    return;
  }
  try{
    if(!zxingReader) zxingReader = new ZXingBrowser.BrowserMultiFormatReader();
    const videoEl = document.getElementById('scannerVideo');
    scannerControls = await zxingReader.decodeFromVideoDevice(undefined, videoEl, (result)=>{
      if(!result || scannerPaused) return;
      const text = result.getText();
      const now = Date.now();
      if(text === lastScanCode && (now - lastScanTime) < 2000) return;
      lastScanCode = text; lastScanTime = now;
      if(scannerOnResult) scannerOnResult(text);
    });
  }catch(e){
    console.error(e);
    statusEl.textContent = 'تعذر فتح الكاميرا — تأكد إنك سمحت للموقع بالوصول للكاميرا.';
  }
}

function closeScanner(){
  document.getElementById('scannerOverlay').classList.remove('show');
  if(scannerControls){ try{ scannerControls.stop(); }catch(e){} scannerControls = null; }
  scannerOnResult = null;
  scannerPaused = false;
  document.getElementById('scannerQuickAdd').style.display = 'none';
  quickAddTableId = null;
}
document.getElementById('closeScannerBtn').addEventListener('click', closeScanner);

function storeOptionsHtml(selected){
  return Object.keys(STORE_SHORT).map(s=> `<option value="${s}" ${s===selected?'selected':''}>${STORE_SHORT[s]}</option>`).join('');
}
function uidLocal(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }

function addVoucherLineRow(tableId){
  const tbody = document.querySelector('#'+tableId+' tbody');
  const rowId = uidLocal('line');
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowId;
  tr.innerHTML = `
    <td class="store-col"><select class="line-store">${storeOptionsHtml('freezer')}</select></td>
    <td><input class="line-name" list="dl_${rowId}" placeholder="اسم الصنف">
      <datalist id="dl_${rowId}"></datalist>
    </td>
    <td class="unit-col"><input class="line-unit" placeholder="الوحدة"></td>
    <td class="qty-col"><input type="number" min="0" step="any" class="line-qty" value="1"></td>
    <td class="rm-col"><button class="rm-line" title="إزالة"><i class="fa-solid fa-xmark"></i></button></td>
  `;
  tbody.appendChild(tr);

  const storeSel = tr.querySelector('.line-store');
  const nameInput = tr.querySelector('.line-name');
  const unitInput = tr.querySelector('.line-unit');

  function refreshDatalist(){
    const dl = tr.querySelector('datalist');
    dl.innerHTML = getItemsByStore(storeSel.value).map(i=> `<option value="${escapeHtml(i.name)}">`).join('');
  }
  function tryAutoUnit(){
    const it = findItemByStoreName(storeSel.value, nameInput.value);
    if(it) unitInput.value = it.unit;
  }
  refreshDatalist();
  storeSel.addEventListener('change', ()=>{ refreshDatalist(); tryAutoUnit(); });
  nameInput.addEventListener('input', tryAutoUnit);
  tr.querySelector('.rm-line').addEventListener('click', ()=> tr.remove());
}

function refreshAllLineDatalists(tableId){
  document.querySelectorAll('#'+tableId+' tbody tr').forEach(tr=>{
    const store = tr.querySelector('.line-store').value;
    const dl = tr.querySelector('datalist');
    if(dl) dl.innerHTML = getItemsByStore(store).map(i=> `<option value="${escapeHtml(i.name)}">`).join('');
  });
}

document.getElementById('inAddLine').addEventListener('click', ()=> addVoucherLineRow('inLinesTable'));
document.getElementById('outAddLine').addEventListener('click', ()=> addVoucherLineRow('outLinesTable'));

function collectLines(tableId){
  const lines = [];
  document.querySelectorAll('#'+tableId+' tbody tr').forEach(tr=>{
    const store = tr.querySelector('.line-store').value;
    const name = tr.querySelector('.line-name').value.trim();
    const unit = tr.querySelector('.line-unit').value.trim();
    const qty = parseFloat(tr.querySelector('.line-qty').value);
    if(name && qty>0){
      lines.push({ store, name, unit, qty });
    }
  });
  return lines;
}
function voucherStoreList(v){
  const seen = [];
  v.lines.forEach(l=>{ if(l.store && !seen.includes(l.store)) seen.push(l.store); });
  return seen;
}
function storePillsHtml(stores){
  if(!stores.length) return '-';
  return stores.map(s=> `<span class="pill pill-store-${s}">${STORE_LABELS[s]}</span>`).join(' ');
}

function compressImage(file, maxDim, quality){
  maxDim = maxDim || 1600; quality = quality || 0.82;
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=> reject(new Error('تعذرت قراءة الصورة.'));
    reader.onload = (e)=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error('تعذر تحميل الصورة.'));
      img.onload = ()=>{
        let { width, height } = img;
        if(width > maxDim || height > maxDim){
          if(width > height){ height = Math.round(height * maxDim/width); width = maxDim; }
          else { width = Math.round(width * maxDim/height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob=> blob ? resolve(blob) : reject(new Error('تعذر ضغط الصورة.')), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadVoucherPhoto(file, type, number){
  if(!file) return null;
  const blob = await compressImage(file);
  const safeName = (number||'sanad').replace(/[^a-zA-Z0-9-_]/g,'_');
  const path = type + '/' + safeName + '-' + Date.now() + '.jpg';
  const { error } = await sb.storage.from('voucher-photos').upload(path, blob, { contentType:'image/jpeg', upsert:true });
  if(error) throw error;
  const { data } = sb.storage.from('voucher-photos').getPublicUrl(path);
  return data.publicUrl;
}

function wirePhotoPreview(inputId, previewId){
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  input.addEventListener('change', ()=>{
    const file = input.files[0];
    if(!file){ preview.style.display='none'; preview.innerHTML=''; return; }
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" class="photo-thumb">`;
    preview.style.display = 'block';
  });
}
wirePhotoPreview('inPhoto','inPhotoPreview');
wirePhotoPreview('outPhoto','outPhotoPreview');

function addOrIncrementLineForItem(tableId, item){
  const rows = document.querySelectorAll('#'+tableId+' tbody tr');
  for(const tr of rows){
    const storeSel = tr.querySelector('.line-store');
    const nameInput = tr.querySelector('.line-name');
    if(storeSel.value === item.store && normName(nameInput.value) === normName(item.name)){
      const qtyInput = tr.querySelector('.line-qty');
      qtyInput.value = (parseFloat(qtyInput.value) || 0) + 1;
      return;
    }
  }
  addVoucherLineRow(tableId);
  const newRow = document.querySelector('#'+tableId+' tbody tr:last-child');
  const storeSel = newRow.querySelector('.line-store');
  storeSel.value = item.store;
  storeSel.dispatchEvent(new Event('change'));
  newRow.querySelector('.line-name').value = item.name;
  newRow.querySelector('.line-unit').value = item.unit;
  newRow.querySelector('.line-qty').value = 1;
}

let quickAddTableId = null;

function showQuickAddForm(code, tableId){
  quickAddTableId = tableId;
  scannerPaused = true;
  document.getElementById('quickAddCode').textContent = code;
  document.getElementById('quickAddName').value = '';
  document.getElementById('quickAddUnit').value = 'وحدة';
  document.getElementById('scannerQuickAdd').style.display = 'block';
  document.getElementById('scannerStatus').textContent = 'باركود جديد — عبّي بيانات الصنف بالأسفل أو تجاهله ومتابعة المسح.';
  document.getElementById('quickAddName').focus();
}
function hideQuickAddForm(){
  document.getElementById('scannerQuickAdd').style.display = 'none';
  scannerPaused = false;
  quickAddTableId = null;
}
document.getElementById('quickAddSkipBtn').addEventListener('click', ()=>{
  hideQuickAddForm();
  document.getElementById('scannerStatus').textContent = 'وجّه الكاميرا نحو باركود الصنف...';
});
document.getElementById('quickAddConfirmBtn').addEventListener('click', async ()=>{
  const code = document.getElementById('quickAddCode').textContent;
  const store = document.getElementById('quickAddStore').value;
  const name = document.getElementById('quickAddName').value.trim();
  const unit = document.getElementById('quickAddUnit').value.trim() || 'وحدة';
  if(!name){ showAppAlert('الرجاء إدخال اسم الصنف.'); return; }
  const tableId = quickAddTableId;
  const btn = document.getElementById('quickAddConfirmBtn');
  btn.disabled = true;
  try{
    const { data: created, error } = await sb.from('items').insert({ store, name, unit, balance:0, min_qty:0, barcode:code }).select().single();
    if(error) throw error;
    const item = { id:created.id, store:created.store, name:created.name, unit:created.unit, balance:0, min:0, barcode:code };
    DB.items.push(item);
    addOrIncrementLineForItem(tableId, item);
    document.getElementById('scannerStatus').innerHTML = '<i class="fa-solid fa-check"></i> تمت إضافة "' + escapeHtml(name) + '" وربطه بالسند';
    hideQuickAddForm();
  }catch(e){
    showAppAlert(e && e.code==='23505' ? 'هذا الباركود مستخدم مسبقًا لصنف آخر.' : 'تعذرت إضافة الصنف.');
  }
  btn.disabled = false;
});

async function quickAddViaPrompt(code, tableId){
  const name = prompt('صنف جديد (باركود: ' + code + ') — اكتب اسم الصنف:');
  if(!name || !name.trim()) return;
  const storeChoice = prompt('اختر رقم المخزن:\n1 = فريزر المواد المجمدة\n2 = مخزن المواد الغذائية\n3 = مخزن أدوات النظافة', '1');
  const store = ({'1':'freezer','2':'pantry','3':'cleaning'})[(storeChoice||'').trim()] || 'freezer';
  const unit = prompt('وحدة القياس:', 'وحدة') || 'وحدة';
  try{
    const { data: created, error } = await sb.from('items').insert({ store, name:name.trim(), unit, balance:0, min_qty:0, barcode:code }).select().single();
    if(error) throw error;
    const item = { id:created.id, store:created.store, name:created.name, unit:created.unit, balance:0, min:0, barcode:code };
    DB.items.push(item);
    addOrIncrementLineForItem(tableId, item);
  }catch(e){
    showAppAlert(e && e.code==='23505' ? 'هذا الباركود مستخدم مسبقًا لصنف آخر.' : 'تعذرت إضافة الصنف: ' + (e && e.message || ''));
  }
}

function wireBarcodeScanForVoucher(scanBtnId, manualInputId, tableId, allowQuickAdd){
  document.getElementById(scanBtnId).addEventListener('click', ()=>{
    openScanner((code)=>{
      const item = findItemByBarcode(code);
      const statusEl = document.getElementById('scannerStatus');
      if(item){
        addOrIncrementLineForItem(tableId, item);
        statusEl.innerHTML = '<i class="fa-solid fa-check"></i> تمت إضافة: ' + escapeHtml(item.name);
      } else if(allowQuickAdd){
        showQuickAddForm(code, tableId);
      } else {
        statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> لا يوجد صنف مرتبط بهذا الباركود (' + escapeHtml(code) + ')';
      }
    }, 'وجّه الكاميرا نحو باركود الصنف...');
  });

  const manualInput = document.getElementById(manualInputId);
  manualInput.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter') return;
    e.preventDefault();
    const code = manualInput.value.trim();
    manualInput.value = '';
    if(!code) return;
    const item = findItemByBarcode(code);
    if(item){ addOrIncrementLineForItem(tableId, item); }
    else if(allowQuickAdd){ quickAddViaPrompt(code, tableId); }
    else { showAppAlert('لا يوجد صنف مرتبط بهذا الباركود: ' + code); }
  });
}
wireBarcodeScanForVoucher('inScanBtn','inManualBarcode','inLinesTable', true);
wireBarcodeScanForVoucher('outScanBtn','outManualBarcode','outLinesTable', false);

document.getElementById('inSubmit').addEventListener('click', async ()=>{
  if(busy) return;
  const number = document.getElementById('inNumber').value.trim();
  const date = document.getElementById('inDate').value || todayStr();
  const source = document.getElementById('inSource').value.trim();
  const notes = document.getElementById('inNotes').value.trim();
  const rawLines = collectLines('inLinesTable');

  if(!number){ showAppAlert('الرجاء إدخال رقم السند / الفاتورة.'); return; }
  if(rawLines.length===0){ showAppAlert('أضف صنفًا واحدًا على الأقل مع كمية أكبر من صفر.'); return; }

  const btn = document.getElementById('inSubmit');
  busy = true; btn.disabled = true;
  const appliedDeltas = [];
  try{
    const { data: dupCheck, error: dupErr } = await sb.from('vouchers').select('id').eq('type','in').ilike('number', number);
    if(dupErr) throw dupErr;
    if(dupCheck && dupCheck.length>0){ showAppAlert('رقم السند "'+number+'" مستخدم مسبقًا لسند توريد آخر.'); busy=false; btn.disabled=false; return; }

    const resolvedShortages = [];
    for(const l of rawLines){
      let it = findItemByStoreName(l.store, l.name);
      if(!it){
        const { data: created, error: cErr } = await sb.from('items').insert({ store:l.store, name:l.name, unit:l.unit||'وحدة', balance:0, min_qty:0 }).select().single();
        if(cErr) throw cErr;
        it = { id:created.id, store:created.store, name:created.name, unit:created.unit, balance:0, min:0 };
        DB.items.push(it);
      }
      const wasLow = it.min > 0 && it.balance <= it.min;
      const newBalance = await incrementItemBalance(it.id, l.qty);
      appliedDeltas.push({ itemId: it.id, delta: l.qty });
      it.balance = newBalance;
      l._itemId = it.id;
      l._unit = it.unit;
      if(wasLow && newBalance > it.min) resolvedShortages.push(it.name);
    }

    const photoFile = document.getElementById('inPhoto').files[0] || null;
    const photoUrl = await uploadVoucherPhoto(photoFile, 'in', number);

    const { data: voucher, error: vErr } = await sb.from('vouchers')
      .insert({ type:'in', number, voucher_date:date, party:source||null, notes:notes||null, photo_path: photoUrl })
      .select().single();
    if(vErr) throw vErr;

    const linesPayload = rawLines.map(l=>({
      voucher_id: voucher.id, item_id:l._itemId, store:l.store, name:l.name, unit:l._unit, qty:l.qty
    }));
    const { error: lErr } = await sb.from('voucher_lines').insert(linesPayload);
    if(lErr) throw lErr;

    document.querySelector('#inLinesTable tbody').innerHTML = '';
    document.getElementById('inNumber').value = '';
    document.getElementById('inSource').value = '';
    document.getElementById('inNotes').value = '';
    document.getElementById('inPhoto').value = '';
    document.getElementById('inPhotoPreview').style.display = 'none';
    document.getElementById('inPhotoPreview').innerHTML = '';
    await loadDB();
    const touchedStores = [...new Set(rawLines.map(l=>l.store))].map(s=>STORE_LABELS[s]).join('، ');
    let stampSub = 'تم تحديث الأرصدة في: ' + touchedStores + '.';
    if(resolvedShortages.length > 0){
      stampSub += ' <i class="fa-solid fa-champagne-glasses"></i> كذلك رجع "' + escapeHtml(resolvedShortages.join('، ')) + '" فوق الحد الأدنى!';
      if(typeof recordShortageRescue === 'function') recordShortageRescue(resolvedShortages.length);
    }
    showStamp('in', number, 'تم حفظ سند التوريد', stampSub);
  }catch(e){
    let revertOk = true;
    for(const d of appliedDeltas.slice().reverse()){
      try{
        const reverted = await incrementItemBalance(d.itemId, -d.delta);
        const it = findItem(d.itemId); if(it) it.balance = reverted;
      }catch(revertErr){ revertOk = false; console.error('تعذر التراجع التلقائي عن رصيد بعد فشل حفظ سند التوريد', revertErr); }
    }
    if(e && e.code === '23505'){
      showAppAlert('رقم السند مستخدم مسبقًا بقاعدة البيانات، اختر رقمًا آخر.' + (revertOk ? '' : ' (تعذر التراجع الكامل عن تعديل الأرصدة تلقائيًا — راجع الأصناف قبل إعادة المحاولة.)'));
    } else {
      showErr(revertOk
        ? 'تعذر حفظ سند التوريد. تم التراجع تلقائيًا عن أي تعديل مؤقت على الأرصدة.'
        : 'تعذر حفظ سند التوريد، وتعذر أيضًا التراجع الكامل عن تعديل الأرصدة تلقائيًا. راجع سجل السندات والأصناف قبل ما تعيد المحاولة.', e);
    }
    await loadDB();
  }
  busy = false; btn.disabled = false;
});

document.getElementById('outSubmit').addEventListener('click', async ()=>{
  if(busy) return;
  const number = document.getElementById('outNumber').value.trim();
  const date = document.getElementById('outDate').value || todayStr();
  const dest = document.getElementById('outDest').value.trim();
  const notes = document.getElementById('outNotes').value.trim();
  const rawLines = collectLines('outLinesTable');
  const warnEl = document.getElementById('outWarning');
  warnEl.style.display = 'none';
  warnEl.innerHTML = '';

  if(!number){ showAppAlert('الرجاء إدخال رقم السند / الفاتورة.'); return; }
  if(rawLines.length===0){ showAppAlert('أضف صنفًا واحدًا على الأقل مع كمية أكبر من صفر.'); return; }

  const shortages = [];
  rawLines.forEach(l=>{
    const it = findItemByStoreName(l.store, l.name);
    if(it && l.qty > it.balance){
      shortages.push({ name: it.name, unit: it.unit, available: it.balance, requested: l.qty });
    }
  });
  if(shortages.length > 0){
    warnEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> الكمية المطلوبة أكبر من الرصيد المتوفر لهذه الأصناف — الرصيد بيصير سالب لو تابعت:<br>' +
      shortages.map(s=> '• ' + escapeHtml(s.name) + ': متوفر ' + fmtNum(s.available) + ' ' + escapeHtml(s.unit) + ' — مطلوب ' + fmtNum(s.requested)).join('<br>');
    warnEl.style.display = 'block';
    if(!confirm('الكمية المطلوبة أكبر من الرصيد المتوفر لـ '+shortages.length+' صنف، وسيصبح رصيدها سالبًا لو تابعت. متابعة الصرف رغم النقص؟')) return;
  }

  const btn = document.getElementById('outSubmit');
  busy = true; btn.disabled = true;
  const appliedDeltas = [];
  try{
    const { data: dupCheck, error: dupErr } = await sb.from('vouchers').select('id').eq('type','out').ilike('number', number);
    if(dupErr) throw dupErr;
    if(dupCheck && dupCheck.length>0){ showAppAlert('رقم السند "'+number+'" مستخدم مسبقًا لسند صرف آخر.'); busy=false; btn.disabled=false; return; }

    for(const l of rawLines){
      const it = findItemByStoreName(l.store, l.name);
      if(it){
        const newBalance = await incrementItemBalance(it.id, -l.qty);
        appliedDeltas.push({ itemId: it.id, delta: -l.qty });
        it.balance = newBalance;
        l._itemId = it.id;
        l._unit = it.unit;
      } else {
        l._itemId = null;
        l._unit = l.unit || 'وحدة';
      }
    }

    const photoFile = document.getElementById('outPhoto').files[0] || null;
    const photoUrl = await uploadVoucherPhoto(photoFile, 'out', number);

    const { data: voucher, error: vErr } = await sb.from('vouchers')
      .insert({ type:'out', number, voucher_date:date, party:dest||null, notes:notes||null, photo_path: photoUrl })
      .select().single();
    if(vErr) throw vErr;

    const linesPayload = rawLines.map(l=>({
      voucher_id: voucher.id, item_id:l._itemId, store:l.store, name:l.name, unit:l._unit, qty:l.qty
    }));
    const { error: lErr } = await sb.from('voucher_lines').insert(linesPayload);
    if(lErr) throw lErr;

    if(fulfillingRequestId){
      try{
        await sb.from('material_requests').update({ status:'fulfilled', fulfilled_voucher_id: voucher.id }).eq('id', fulfillingRequestId);
      }catch(reqLinkErr){ console.error('تعذر ربط السند بالطلب الأصلي', reqLinkErr); }
      fulfillingRequestId = null;
    }

    document.querySelector('#outLinesTable tbody').innerHTML = '';
    document.getElementById('outNumber').value = '';
    document.getElementById('outDest').value = '';
    document.getElementById('outNotes').value = '';
    document.getElementById('outPhoto').value = '';
    document.getElementById('outPhotoPreview').style.display = 'none';
    document.getElementById('outPhotoPreview').innerHTML = '';
    await loadDB();
    const touchedStores = [...new Set(rawLines.map(l=>l.store))].map(s=>STORE_LABELS[s]).join('، ');
    showStamp('out', number, 'تم حفظ سند الصرف', 'تم خصم الكميات من: ' + touchedStores + '.');
  }catch(e){
    let revertOk = true;
    for(const d of appliedDeltas.slice().reverse()){
      try{
        const reverted = await incrementItemBalance(d.itemId, -d.delta);
        const it = findItem(d.itemId); if(it) it.balance = reverted;
      }catch(revertErr){ revertOk = false; console.error('تعذر التراجع التلقائي عن رصيد بعد فشل حفظ سند الصرف', revertErr); }
    }
    if(e && e.code === '23505'){
      showAppAlert('رقم السند مستخدم مسبقًا بقاعدة البيانات، اختر رقمًا آخر.' + (revertOk ? '' : ' (تعذر التراجع الكامل عن تعديل الأرصدة تلقائيًا — راجع الأصناف قبل إعادة المحاولة.)'));
    } else {
      showErr(revertOk
        ? 'تعذر حفظ سند الصرف. تم التراجع تلقائيًا عن أي تعديل مؤقت على الأرصدة.'
        : 'تعذر حفظ سند الصرف، وتعذر أيضًا التراجع الكامل عن تعديل الأرصدة تلقائيًا. راجع سجل السندات والأصناف قبل ما تعيد المحاولة.', e);
    }
    await loadDB();
  }
  busy = false; btn.disabled = false;
});

function showStamp(type, number, title, sub){
  const overlay = document.getElementById('stampOverlay');
  const ring = document.getElementById('stampRing');
  ring.className = 'stamp-ring ' + type;
  document.getElementById('stampLabel').textContent = type==='in' ? 'سند توريد' : 'سند صرف';
  document.getElementById('stampNumber').textContent = number;
  document.getElementById('stampTitle').textContent = title;
  const dirIco = document.getElementById('stampDirIco');
  if(dirIco) dirIco.innerHTML = type==='in' ? '<i class="fa-solid fa-inbox"></i>' : '<i class="fa-solid fa-paper-plane"></i>';
  const praise = (typeof randomPraise === 'function') ? randomPraise() : '';
  document.getElementById('stampSub').innerHTML = sub + (praise ? ' ' + praise : '');
  overlay.classList.add('show');
  if(typeof burstConfetti === 'function') burstConfetti(55);
  if(typeof checkMilestone === 'function') checkMilestone();
  if(typeof playStampSound === 'function') playStampSound();
}
document.getElementById('stampCloseBtn').addEventListener('click', ()=>{
  document.getElementById('stampOverlay').classList.remove('show');
});

['logFilterPeriod','logFilterStore','logSearch'].forEach(id=>{
  document.getElementById(id).addEventListener('input', renderLogTable);
});

function renderLogTable(){
  const period = document.getElementById('logFilterPeriod').value;
  const store = document.getElementById('logFilterStore').value;
  const q = document.getElementById('logSearch').value.trim().toLowerCase();
  let list = DB.vouchers.slice();
  if(period==='open') list = list.filter(v=>!v.closed);
  if(store!=='all') list = list.filter(v=>voucherStoreList(v).includes(store));
  if(q) list = list.filter(v=>v.number.toLowerCase().includes(q));

  const inList  = list.filter(v=>v.type==='in');
  const outList = list.filter(v=>v.type==='out');

  fillLogSection('logTableIn',  inList,  'in',  period);
  fillLogSection('logTableOut', outList, 'out', period);
  document.getElementById('logInCount').textContent  = inList.length;
  document.getElementById('logOutCount').textContent = outList.length;
}

function fillLogSection(tableId, list, type, period){
  const tbody = document.querySelector('#'+tableId+' tbody');
  if(list.length===0){
    const msg = period==='open'
      ? (type==='in' ? 'لا توجد فواتير توريد مفتوحة حاليًا — اختر "الكل" من فلتر الحالة لعرض الأرشيف.'
                     : 'لا توجد سندات صرف مفتوحة حاليًا — اختر "الكل" من فلتر الحالة لعرض الأرشيف.')
      : (type==='in' ? 'لا توجد فواتير توريد مطابقة.' : 'لا توجد سندات صرف مطابقة.');
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell"><div class="empty-state"><div class="icon">${type==='in'?'<i class="fa-solid fa-inbox"></i>':'<i class="fa-solid fa-paper-plane"></i>'}</div>${msg}</div></td></tr>`;
    return;
  }
  const partyLabel = type==='in' ? 'المورد' : 'الجهة المستلمة';
  tbody.innerHTML = list.map(v=>`
    <tr>
      <td class="mono" data-label="رقم السند">${v.number}</td>
      <td data-label="الحالة">${v.closed ? '<span class="pill" style="background:var(--freezer-soft);color:var(--freezer);"><i class="fa-solid fa-lock"></i> مقفل</span>' : '<span class="pill pill-in">مفتوح</span>'}</td>
      <td data-label="المخزن">${storePillsHtml(voucherStoreList(v))}</td>
      <td data-label="التاريخ">${fmtDate(v.date)}</td>
      <td data-label="${partyLabel}">${v.party?escapeHtml(v.party):'-'}</td>
      <td class="mono" data-label="عدد الأصناف">${v.lines.length}</td>
      <td data-label=""><button class="btn-ghost btn-sm" data-view-v="${v.id}">عرض</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-view-v]').forEach(btn=>{
    btn.addEventListener('click', ()=> openVoucherDetail(btn.dataset.viewV));
  });
}

let currentDetailVoucher = null;
let editingVoucherId = null;
function openVoucherDetail(id){
  const v = DB.vouchers.find(x=>x.id===id);
  if(!v) return;
  currentDetailVoucher = v;
  const body = document.getElementById('voucherDetailBody');
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span class="pill ${v.type==='in'?'pill-in':'pill-out'}" style="font-size:13px;">${v.type==='in'?'سند توريد':'سند صرف'}</span>
      <span class="mono" style="font-weight:700;">${v.number}</span>
    </div>
    ${v.closed ? `<div style="background:var(--freezer-soft);color:var(--freezer);border-radius:9px;padding:8px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;"><i class="fa-solid fa-lock"></i> سند مقفل (مؤرشف) — لا يمكن تعديله أو حذفه.</div>` : `
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button class="btn-ghost btn-sm" id="editVoucherBtn" style="flex:1;"><i class="fa-solid fa-pen"></i> تعديل السند</button>
      <button class="btn-danger-outline btn-sm" id="deleteVoucherBtn" style="flex:1;"><i class="fa-solid fa-trash"></i> حذف السند</button>
    </div>
    `}
    <p style="margin:4px 0;font-size:13px;"><b>التاريخ:</b> ${fmtDate(v.date)}</p>
    <p style="margin:4px 0;font-size:13px;"><b>${v.type==='in'?'المورد':'الجهة المستلمة'}:</b> ${v.party?escapeHtml(v.party):'-'}</p>
    ${v.notes?`<p style="margin:4px 0;font-size:13px;"><b>ملاحظات:</b> ${escapeHtml(v.notes)}</p>`:''}
    <table class="lines-table" style="margin-top:10px;">
      <thead><tr><th>المخزن</th><th>الصنف</th><th>الكمية</th><th>الوحدة</th></tr></thead>
      <tbody>
        ${v.lines.map(l=>`<tr><td><span class="pill pill-store-${l.store}">${STORE_LABELS[l.store]||'-'}</span></td><td>${escapeHtml(l.name)}</td><td class="mono">${fmtNum(l.qty)}</td><td>${escapeHtml(l.unit)}</td></tr>`).join('')}
      </tbody>
    </table>
    ${v.photoUrl ? `<img src="${v.photoUrl}" class="voucher-photo" onclick="window.open('${v.photoUrl}','_blank')" title="اضغط لعرض الصورة كاملة"><div style="font-size:11.5px;color:var(--ink-soft);margin-top:4px;">اضغط على الصورة لعرضها بحجمها الكامل</div>` : ''}
    <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px;">
      <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 8px;font-weight:700;">صورة السند الموقّع (بعد الختم والتوقيع)</p>
      <div id="signedPhotoWrap">
        ${v.signedPhotoUrl
          ? `<img src="${v.signedPhotoUrl}" class="voucher-photo" onclick="window.open('${v.signedPhotoUrl}','_blank')" title="اضغط لعرض الصورة كاملة">`
          : `<div class="empty-state" style="padding:16px;"><div class="icon"><i class="fa-solid fa-signature"></i></div>لم تُرفع صورة موقّعة بعد — الطباعة حاليًا تصدر النموذج الفارغ.</div>`}
      </div>
      ${v.closed ? '' : `
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="file" id="signedPhotoInput" accept="image/*" style="flex:1;min-width:180px;">
        <button class="btn-in btn-sm" id="signedPhotoUploadBtn">${v.signedPhotoUrl ? 'استبدال الصورة' : 'رفع الصورة الموقّعة'}</button>
      </div>
      <p class="note-hint" style="margin-top:6px;margin-bottom:0;">بعد رفع صورة الورقة المختومة والموقّعة، زر "طباعة / PDF" بيطبع هذي الصورة بدل النموذج الفارغ.</p>
      `}
    </div>
  `;
  document.getElementById('voucherDetailOverlay').classList.add('show');
  if(v.closed) return;

  document.getElementById('editVoucherBtn').addEventListener('click', ()=> openEditVoucher(v));
  document.getElementById('deleteVoucherBtn').addEventListener('click', ()=> deleteVoucherConfirm(v));

  const signedBtn = document.getElementById('signedPhotoUploadBtn');
  signedBtn.addEventListener('click', async ()=>{
    const input = document.getElementById('signedPhotoInput');
    const file = input.files[0];
    if(!file){ showAppAlert('اختر صورة الورقة الموقّعة أولاً.'); return; }
    signedBtn.disabled = true;
    signedBtn.textContent = 'جارٍ الرفع...';
    try{
      const url = await uploadVoucherPhoto(file, 'signed-'+v.type, v.number);
      const { error } = await sb.from('vouchers').update({ signed_photo_path: url }).eq('id', v.id);
      if(error) throw error;
      v.signedPhotoUrl = url;
      openVoucherDetail(v.id);
    }catch(e){
      showErr('تعذر رفع الصورة الموقّعة.', e);
      signedBtn.disabled = false;
      signedBtn.textContent = v.signedPhotoUrl ? 'استبدال الصورة' : 'رفع الصورة الموقّعة';
    }
  });
}

function openEditVoucher(v){
  if(busy) return;
  if(v.closed){ showAppAlert('هذا السند مقفل ولا يمكن تعديله.'); return; }
  editingVoucherId = v.id;
  document.getElementById('editVoucherNumberLabel').textContent = '(' + v.number + ')';
  document.getElementById('editNumber').value = v.number;
  document.getElementById('editDate').value = v.date;
  document.getElementById('editParty').value = v.party || '';
  document.getElementById('editPartyLabel').textContent = v.type==='in' ? 'المورد' : 'الجهة المستلمة';
  document.getElementById('editNotes').value = v.notes || '';

  const tbody = document.querySelector('#editLinesTable tbody');
  tbody.innerHTML = '';
  v.lines.forEach(l=>{
    addVoucherLineRow('editLinesTable');
    const row = document.querySelector('#editLinesTable tbody tr:last-child');
    const storeSel = row.querySelector('.line-store');
    storeSel.value = l.store;
    storeSel.dispatchEvent(new Event('change'));
    row.querySelector('.line-name').value = l.name;
    row.querySelector('.line-unit').value = l.unit;
    row.querySelector('.line-qty').value = l.qty;
  });

  document.getElementById('voucherDetailOverlay').classList.remove('show');
  document.getElementById('editVoucherOverlay').classList.add('show');
}
document.getElementById('editAddLine').addEventListener('click', ()=> addVoucherLineRow('editLinesTable'));
document.getElementById('closeEditVoucher').addEventListener('click', ()=>{
  document.getElementById('editVoucherOverlay').classList.remove('show');
});

document.getElementById('editVoucherSave').addEventListener('click', async ()=>{
  if(busy) return;
  const v = DB.vouchers.find(x=>x.id===editingVoucherId);
  if(!v){ showAppAlert('تعذر إيجاد السند.'); return; }
  if(v.closed){ showAppAlert('هذا السند مقفل ولا يمكن تعديله.'); return; }

  const number = document.getElementById('editNumber').value.trim();
  const date = document.getElementById('editDate').value || v.date;
  const party = document.getElementById('editParty').value.trim();
  const notes = document.getElementById('editNotes').value.trim();
  const newLines = collectLines('editLinesTable');

  if(!number){ showAppAlert('الرجاء إدخال رقم السند.'); return; }
  if(newLines.length===0){ showAppAlert('أضف صنفًا واحدًا على الأقل مع كمية أكبر من صفر.'); return; }

  const btn = document.getElementById('editVoucherSave');
  busy = true; btn.disabled = true;
  const appliedDeltas = [];
  try{
    if(number.toLowerCase() !== v.number.toLowerCase()){
      const { data: dupCheck, error: dupErr } = await sb.from('vouchers').select('id').eq('type', v.type).ilike('number', number);
      if(dupErr) throw dupErr;
      if(dupCheck && dupCheck.some(d=> d.id !== v.id)){
        showAppAlert('رقم السند "'+number+'" مستخدم مسبقًا لسند آخر من نفس النوع.');
        busy=false; btn.disabled=false; return;
      }
    }

    // نرجّع أثر بنود السند القديمة على أرصدة الأصناف أولاً (عكس تام لعملية الإنشاء)
    for(const l of v.lines){
      if(!l.itemId) continue;
      const it = findItem(l.itemId);
      if(!it) continue;
      const delta = (v.type==='in' ? -l.qty : l.qty);
      const reverted = await incrementItemBalance(it.id, delta);
      appliedDeltas.push({ itemId: it.id, delta });
      it.balance = reverted;
    }

    // ثم نطبّق أثر البنود الجديدة من الصفر (بنفس منطق إنشاء سند جديد)
    for(const l of newLines){
      let it = findItemByStoreName(l.store, l.name);
      if(!it){
        const { data: created, error: cErr } = await sb.from('items').insert({ store:l.store, name:l.name, unit:l.unit||'وحدة', balance:0, min_qty:0 }).select().single();
        if(cErr) throw cErr;
        it = { id:created.id, store:created.store, name:created.name, unit:created.unit, balance:0, min:0 };
        DB.items.push(it);
      }
      const delta = (v.type==='in' ? l.qty : -l.qty);
      const applied = await incrementItemBalance(it.id, delta);
      appliedDeltas.push({ itemId: it.id, delta });
      it.balance = applied;
      l._itemId = it.id;
      l._unit = it.unit;
    }

    const { error: delErr } = await sb.from('voucher_lines').delete().eq('voucher_id', v.id);
    if(delErr) throw delErr;
    const linesPayload = newLines.map(l=>({
      voucher_id: v.id, item_id:l._itemId, store:l.store, name:l.name, unit:l._unit, qty:l.qty
    }));
    const { error: insErr } = await sb.from('voucher_lines').insert(linesPayload);
    if(insErr) throw insErr;

    const { error: vErr } = await sb.from('vouchers').update({
      number, voucher_date: date, party: party || null, notes: notes || null
    }).eq('id', v.id);
    if(vErr) throw vErr;

    document.getElementById('editVoucherOverlay').classList.remove('show');
    await loadDB();
    showAppAlert('تم حفظ تعديلات السند وتحديث الأرصدة.');
  }catch(e){
    let revertOk = true;
    for(const d of appliedDeltas.slice().reverse()){
      try{
        const reverted = await incrementItemBalance(d.itemId, -d.delta);
        const it = findItem(d.itemId); if(it) it.balance = reverted;
      }catch(revertErr){ revertOk = false; console.error('تعذر التراجع التلقائي عن رصيد بعد فشل تعديل السند', revertErr); }
    }
    if(e && e.code === '23505'){
      showAppAlert('رقم السند مستخدم مسبقًا بقاعدة البيانات، اختر رقمًا آخر.' + (revertOk ? '' : ' (تعذر التراجع الكامل عن تعديل الأرصدة تلقائيًا — راجع الأصناف قبل إعادة المحاولة.)'));
    } else {
      showErr(revertOk
        ? 'تعذر حفظ تعديل السند. تم التراجع تلقائيًا عن أي تعديل مؤقت على الأرصدة.'
        : 'تعذر حفظ تعديل السند، وتعذر أيضًا التراجع الكامل عن تعديل الأرصدة تلقائيًا. راجع سجل السندات والأصناف قبل ما تعيد المحاولة.', e);
    }
    await loadDB();
  }
  busy = false; btn.disabled = false;
});

function deleteVoucherConfirm(v){
  if(busy) return;
  if(v.closed){ showAppAlert('هذا السند مقفل ولا يمكن حذفه.'); return; }
  if(!confirm('سيتم حذف السند "'+v.number+'" نهائيًا وإرجاع أثره على أرصدة الأصناف. هذا الإجراء لا يمكن التراجع عنه. متابعة؟')) return;
  deleteVoucherNow(v);
}

async function deleteVoucherNow(v){
  if(busy) return;
  busy = true;
  const appliedDeltas = [];
  try{
    for(const l of v.lines){
      if(!l.itemId) continue;
      const it = findItem(l.itemId);
      if(!it) continue;
      const delta = (v.type==='in' ? -l.qty : l.qty);
      const reverted = await incrementItemBalance(it.id, delta);
      appliedDeltas.push({ itemId: it.id, delta });
      it.balance = reverted;
    }

    const linkedReq = DB.requests.find(r=> r.fulfilledVoucherId === v.id);
    if(linkedReq){
      const { error: reqErr } = await sb.from('material_requests').update({ status:'pending', fulfilled_voucher_id:null }).eq('id', linkedReq.id);
      if(reqErr) throw reqErr;
    }

    const { error: lErr } = await sb.from('voucher_lines').delete().eq('voucher_id', v.id);
    if(lErr) throw lErr;
    const { error: vErr } = await sb.from('vouchers').delete().eq('id', v.id);
    if(vErr) throw vErr;

    document.getElementById('voucherDetailOverlay').classList.remove('show');
    await loadDB();
    showAppAlert('تم حذف السند وإرجاع أثره على الأرصدة.');
  }catch(e){
    let revertOk = true;
    for(const d of appliedDeltas.slice().reverse()){
      try{
        const reverted = await incrementItemBalance(d.itemId, -d.delta);
        const it = findItem(d.itemId); if(it) it.balance = reverted;
      }catch(revertErr){ revertOk = false; console.error('تعذر التراجع التلقائي عن رصيد بعد فشل حذف السند', revertErr); }
    }
    showErr(revertOk
      ? 'تعذر حذف السند. تم التراجع تلقائيًا عن أي تعديل مؤقت على الأرصدة.'
      : 'تعذر حذف السند، وتعذر أيضًا التراجع الكامل عن تعديل الأرصدة تلقائيًا. راجع سجل السندات والأصناف قبل ما تعيد المحاولة.', e);
    await loadDB();
  }
  busy = false;
}

document.getElementById('closeVoucherDetail').addEventListener('click', ()=>{
  document.getElementById('voucherDetailOverlay').classList.remove('show');
});

function printVoucher(v){
  const area = document.getElementById('printArea');

  if(v.signedPhotoUrl){
    area.innerHTML = `
      <div style="text-align:center;">
        <img src="${v.signedPhotoUrl}" style="max-width:100%;height:auto;">
      </div>
    `;
    window.print();
    return;
  }

  area.innerHTML = `
    <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B2430;padding-bottom:14px;margin-bottom:18px;">
        <div>
          <div style="font-weight:800;font-size:20px;">فنادق سليمان موسى العليان</div>
          <div style="font-size:13px;color:#555;margin-top:2px;">${v.type==='in'?'سند توريد (وارد)':'سند صرف (صادر)'}</div>
        </div>
        <div style="text-align:left;">
          <div style="font-family:monospace;font-weight:700;font-size:19px;">${v.number}</div>
          <div style="font-size:12px;color:#555;">${fmtDate(v.date)}</div>
        </div>
      </div>
      <p style="margin:6px 0;font-size:14px;"><b>${v.type==='in'?'المورد':'الجهة المستلمة'}:</b> ${v.party?escapeHtml(v.party):'-'}</p>
      ${v.notes?`<p style="margin:6px 0;font-size:14px;"><b>ملاحظات:</b> ${escapeHtml(v.notes)}</p>`:''}
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;">
        <thead>
          <tr style="background:#eee;">
            <th style="border:1px solid #ccc;padding:8px;text-align:right;">المخزن</th>
            <th style="border:1px solid #ccc;padding:8px;text-align:right;">الصنف</th>
            <th style="border:1px solid #ccc;padding:8px;text-align:right;">الكمية</th>
            <th style="border:1px solid #ccc;padding:8px;text-align:right;">الوحدة</th>
          </tr>
        </thead>
        <tbody>
          ${v.lines.map(l=>`<tr>
            <td style="border:1px solid #ccc;padding:8px;">${STORE_LABELS[l.store]||'-'}</td>
            <td style="border:1px solid #ccc;padding:8px;">${escapeHtml(l.name)}</td>
            <td style="border:1px solid #ccc;padding:8px;font-family:monospace;">${fmtNum(l.qty)}</td>
            <td style="border:1px solid #ccc;padding:8px;">${escapeHtml(l.unit)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${v.photoUrl ? `<div style="margin-top:18px;"><div style="font-size:12px;color:#555;margin-bottom:6px;">صورة مرفقة:</div><img src="${v.photoUrl}" style="max-width:320px;max-height:320px;border:1px solid #ccc;border-radius:6px;"></div>` : ''}
      <div style="margin-top:56px;display:flex;justify-content:space-between;font-size:13px;">
        <div>توقيع ${v.type==='in'?'المورّد':'المستلم'}: ______________________</div>
        <div>توقيع أمين المخزن: ______________________</div>
      </div>
    </div>
  `;
  window.print();
}
document.getElementById('printVoucherBtn').addEventListener('click', ()=>{
  if(currentDetailVoucher) printVoucher(currentDetailVoucher);
});

document.getElementById('exportExcelBtn').addEventListener('click', ()=>{
  const period = document.getElementById('logFilterPeriod').value;
  const store = document.getElementById('logFilterStore').value;
  const q = document.getElementById('logSearch').value.trim().toLowerCase();
  let list = DB.vouchers.slice();
  if(period==='open') list = list.filter(v=>!v.closed);
  if(store!=='all') list = list.filter(v=>voucherStoreList(v).includes(store));
  if(q) list = list.filter(v=>v.number.toLowerCase().includes(q));

  if(list.length===0){ showAppAlert('لا توجد سندات لتصديرها حسب الفلترة الحالية.'); return; }

  const summaryRows = list.map(v=>({
    'رقم السند': v.number,
    'الحالة': v.closed ? 'مقفل (مؤرشف)' : 'مفتوح',
    'النوع': v.type==='in' ? 'توريد (وارد)' : 'صرف (صادر)',
    'المخزن': voucherStoreList(v).map(s=>STORE_LABELS[s]).join(' + '),
    'التاريخ': v.date,
    'الجهة': v.party || '',
    'ملاحظات': v.notes || '',
    'عدد الأصناف': v.lines.length,
    'رابط الصورة': v.photoUrl || ''
  }));

  const detailRows = [];
  list.forEach(v=>{
    v.lines.forEach(l=>{
      detailRows.push({
        'رقم السند': v.number,
        'النوع': v.type==='in' ? 'توريد' : 'صرف',
        'التاريخ': v.date,
        'المخزن': STORE_LABELS[l.store] || l.store,
        'الصنف': l.name,
        'الكمية': l.qty,
        'الوحدة': l.unit
      });
    });
  });

  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'ملخص السندات');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'تفاصيل الأصناف');
    XLSX.writeFile(wb, 'سندات-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

function itemOptionsHtml(){
  const groups = {};
  DB.items.forEach(i=>{ (groups[i.store] = groups[i.store] || []).push(i); });
  return Object.keys(STORE_LABELS).map(s=>{
    const its = (groups[s]||[]).slice().sort((a,b)=> a.name.localeCompare(b.name,'ar'));
    if(!its.length) return '';
    return `<optgroup label="${STORE_LABELS[s]}">` + its.map(i=>{
      const low = i.min>0 && i.balance<=i.min;
      return `<option value="${i.id}">${escapeHtml(i.name)} — متوفر: ${fmtNum(i.balance)} ${escapeHtml(i.unit)}${low?' <i class="fa-solid fa-triangle-exclamation"></i>':''}</option>`;
    }).join('') + `</optgroup>`;
  }).join('');
}

function addRequestLineRow(){
  const tbody = document.querySelector('#reqLinesTable tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="req-item-select"><option value="">اختر صنف...</option>${itemOptionsHtml()}</select></td>
    <td class="unit-col req-item-unit">-</td>
    <td class="qty-col"><input type="number" min="0" step="any" class="req-item-qty" value="1"></td>
    <td class="rm-col"><button class="rm-line" title="إزالة"><i class="fa-solid fa-xmark"></i></button></td>
  `;
  tbody.appendChild(tr);
  const sel = tr.querySelector('.req-item-select');
  const unitCell = tr.querySelector('.req-item-unit');
  sel.addEventListener('change', ()=>{
    const it = findItem(sel.value);
    if(it){
      const low = it.min>0 && it.balance<=it.min;
      unitCell.innerHTML = `${escapeHtml(it.unit)}<br><span class="mono" style="font-size:11px;color:${low?'var(--warn)':'var(--ink-soft)'};">متوفر: ${fmtNum(it.balance)}${low?' <i class="fa-solid fa-triangle-exclamation"></i>':''}</span>`;
    } else {
      unitCell.textContent = '-';
    }
  });
  tr.querySelector('.rm-line').addEventListener('click', ()=> tr.remove());
}
document.getElementById('reqAddLine').addEventListener('click', addRequestLineRow);

function collectRequestLines(){
  const lines = [];
  document.querySelectorAll('#reqLinesTable tbody tr').forEach(tr=>{
    const itemId = tr.querySelector('.req-item-select').value;
    const qty = parseFloat(tr.querySelector('.req-item-qty').value);
    if(itemId && qty>0){
      const it = findItem(itemId);
      if(it) lines.push({ itemId: it.id, store: it.store, name: it.name, unit: it.unit, qty });
    }
  });
  return lines;
}

function requestAutoNumber(){
  const nums = DB.requests.map(r=> parseInt((r.number||'').replace(/\D/g,''),10)).filter(n=>!Number.isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4,'0');
}

document.getElementById('reqSubmit').addEventListener('click', async ()=>{
  if(busy) return;
  const lines = collectRequestLines();
  if(lines.length===0){ showAppAlert('أضف صنفًا واحدًا على الأقل مع كمية أكبر من صفر.'); return; }
  let number = document.getElementById('reqNumber').value.trim();
  if(!number) number = requestAutoNumber();
  if(DB.requests.some(r=> r.number.toLowerCase()===number.toLowerCase())){
    showAppAlert('رقم الطلب "'+number+'" مستخدم مسبقًا.'); return;
  }
  const date = document.getElementById('reqDate').value || todayStr();
  const notes = document.getElementById('reqNotes').value.trim();

  const btn = document.getElementById('reqSubmit');
  busy = true; btn.disabled = true;
  try{
    const { data: reqRow, error: rErr } = await sb.from('material_requests')
      .insert({ number, requested_by: currentUserEmail, notes: notes||null, status:'pending', request_date: date })
      .select().single();
    if(rErr) throw rErr;

    const linesPayload = lines.map(l=>({
      request_id: reqRow.id, item_id:l.itemId, store:l.store, name:l.name, unit:l.unit, qty:l.qty
    }));
    const { error: lErr } = await sb.from('material_request_lines').insert(linesPayload);
    if(lErr) throw lErr;

    document.querySelector('#reqLinesTable tbody').innerHTML = '';
    document.getElementById('reqNumber').value = '';
    document.getElementById('reqNotes').value = '';
    await loadDB();
    showStamp('in', number, 'تم إرسال الطلب', 'أمين المستودع بيراجعه ويحوّله لسند صرف قريبًا.');
  }catch(e){
    showErr('تعذر إرسال الطلب.', e);
  }
  busy = false; btn.disabled = false;
});

function renderMyRequestsTable(){
  const tbody = document.querySelector('#myRequestsTable tbody');
  if(!tbody) return;
  const mine = DB.requests.filter(r=> r.requestedBy === currentUserEmail).sort((a,b)=> b.createdAt - a.createdAt);
  if(mine.length===0){
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon"><i class="fa-solid fa-pen-to-square"></i></div>ما سويت أي طلب لسا.</div></td></tr>';
    return;
  }
  tbody.innerHTML = mine.map(r=>{
    const statusClass = r.status==='fulfilled' ? 'pill-in' : (r.status==='rejected' ? 'pill-out' : 'pill-pending');
    const statusText = r.status==='fulfilled' ? 'تم الصرف' : (r.status==='rejected' ? 'مرفوض' : 'قيد الانتظار');
    const itemsSummary = r.lines.map(l=> escapeHtml(l.name)+' ('+fmtNum(l.qty)+')').join('، ');
    return `<tr>
      <td class="mono mono-cell">${r.number}</td>
      <td class="wrap-cell" title="${itemsSummary}">${itemsSummary}</td>
      <td><span class="pill ${statusClass}">${statusText}</span></td>
      <td>${fmtDate(r.date)}</td>
      <td class="mono mono-cell">${r.fulfilledVoucherNumber || '-'}</td>
    </tr>`;
  }).join('');
}

function renderIncomingRequestsTable(){
  const tbody = document.querySelector('#incomingRequestsTable tbody');
  if(!tbody) return;
  const filter = document.getElementById('reqFilterStatus').value;
  let list = DB.requests.slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(filter !== 'all') list = list.filter(r=> r.status===filter);
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-inbox"></i></div>لا توجد طلبات مطابقة.</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r=>{
    const statusClass = r.status==='fulfilled' ? 'pill-in' : (r.status==='rejected' ? 'pill-out' : 'pill-pending');
    const statusText = r.status==='fulfilled' ? 'تم الصرف' : (r.status==='rejected' ? 'مرفوض' : 'قيد الانتظار');
    const itemsSummary = r.lines.map(l=> escapeHtml(l.name)+' ('+fmtNum(l.qty)+')').join('، ');
    const actions = r.status==='pending'
      ? `<button class="btn-in btn-sm" data-fulfill="${r.id}">تحويل لسند صرف</button> <button class="btn-danger-outline btn-sm" data-reject="${r.id}">رفض</button>`
      : `<button class="btn-ghost btn-sm" data-view-req="${r.id}">عرض</button>`;
    return `<tr>
      <td class="mono mono-cell">${r.number}</td>
      <td class="wrap-cell">${escapeHtml(r.requestedBy||'-')}</td>
      <td class="wrap-cell" title="${itemsSummary}">${itemsSummary}</td>
      <td><span class="pill ${statusClass}">${statusText}</span></td>
      <td>${fmtDate(r.date)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-fulfill]').forEach(btn=>{
    btn.addEventListener('click', ()=> fulfillRequest(btn.dataset.fulfill));
  });
  tbody.querySelectorAll('[data-reject]').forEach(btn=>{
    btn.addEventListener('click', ()=> rejectRequest(btn.dataset.reject));
  });
  tbody.querySelectorAll('[data-view-req]').forEach(btn=>{
    btn.addEventListener('click', ()=> openRequestDetail(btn.dataset.viewReq));
  });
}
document.getElementById('reqFilterStatus').addEventListener('change', renderIncomingRequestsTable);

document.getElementById('exportRequestsExcelBtn').addEventListener('click', ()=>{
  const filter = document.getElementById('reqFilterStatus').value;
  let list = DB.requests.slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(filter !== 'all') list = list.filter(r=> r.status===filter);
  if(list.length===0){ showAppAlert('لا توجد طلبات لتصديرها حسب الفلترة الحالية.'); return; }

  const statusLabels = { pending:'قيد الانتظار', fulfilled:'تم الصرف', rejected:'مرفوض' };
  const rows = list.map(r=>({
    'رقم الطلب': r.number,
    'الطالب': r.requestedBy || '',
    'الأصناف': r.lines.map(l=> l.name+' ('+fmtNum(l.qty)+' '+l.unit+')').join('، '),
    'الحالة': statusLabels[r.status] || r.status,
    'التاريخ': r.date,
    'سند الصرف': r.fulfilledVoucherNumber || '',
    'ملاحظات': r.notes || ''
  }));

  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الطلبات');
    XLSX.writeFile(wb, 'طلبات-الأصناف-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

function fulfillRequest(id){
  const r = DB.requests.find(x=>x.id===id);
  if(!r) return;
  fulfillingRequestId = id;
  document.querySelector('#outLinesTable tbody').innerHTML = '';
  r.lines.forEach(l=>{
    addVoucherLineRow('outLinesTable');
    const row = document.querySelector('#outLinesTable tbody tr:last-child');
    const storeSel = row.querySelector('.line-store');
    storeSel.value = l.store;
    storeSel.dispatchEvent(new Event('change'));
    row.querySelector('.line-name').value = l.name;
    row.querySelector('.line-unit').value = l.unit;
    row.querySelector('.line-qty').value = l.qty;
  });
  document.getElementById('outDest').value = r.requestedBy || '';
  document.getElementById('outNotes').value = 'تنفيذًا للطلب رقم ' + r.number + (r.notes ? ' — ' + r.notes : '');
  switchToTab('voucherOut');
}

async function rejectRequest(id){
  if(busy) return;
  if(!confirm('تأكيد رفض هذا الطلب؟')) return;
  busy = true;
  try{
    const { error } = await sb.from('material_requests').update({ status:'rejected' }).eq('id', id);
    if(error) throw error;
    await loadDB();
  }catch(e){ showErr('تعذر رفض الطلب.', e); }
  busy = false;
}

function openRequestDetail(id){
  const r = DB.requests.find(x=>x.id===id);
  if(!r) return;
  const statusClass = r.status==='fulfilled' ? 'pill-in' : (r.status==='rejected' ? 'pill-out' : 'pill-pending');
  const statusText = r.status==='fulfilled' ? 'تم الصرف' : (r.status==='rejected' ? 'مرفوض' : 'قيد الانتظار');
  document.getElementById('requestDetailBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span class="pill ${statusClass}" style="font-size:13px;">${statusText}</span>
      <span class="mono" style="font-weight:700;">${r.number}</span>
    </div>
    <p style="margin:4px 0;font-size:13px;"><b>الطالب:</b> ${escapeHtml(r.requestedBy||'-')}</p>
    <p style="margin:4px 0;font-size:13px;"><b>التاريخ:</b> ${fmtDate(r.date)}</p>
    ${r.notes ? `<p style="margin:4px 0;font-size:13px;"><b>ملاحظات:</b> ${escapeHtml(r.notes)}</p>` : ''}
    ${r.fulfilledVoucherNumber ? `<p style="margin:4px 0;font-size:13px;"><b>سند الصرف:</b> <span class="mono">${r.fulfilledVoucherNumber}</span></p>` : ''}
    <table class="lines-table" style="margin-top:10px;">
      <thead><tr><th>المخزن</th><th>الصنف</th><th>الكمية</th><th>الوحدة</th></tr></thead>
      <tbody>
        ${r.lines.map(l=>`<tr><td><span class="pill pill-store-${l.store}">${STORE_LABELS[l.store]||'-'}</span></td><td>${escapeHtml(l.name)}</td><td class="mono">${fmtNum(l.qty)}</td><td>${escapeHtml(l.unit)}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('requestDetailOverlay').classList.add('show');
}
document.getElementById('closeRequestDetail').addEventListener('click', ()=>{
  document.getElementById('requestDetailOverlay').classList.remove('show');
});

wirePhotoPreview('invPhoto','invPhotoPreview');

document.getElementById('invSubmit').addEventListener('click', async ()=>{
  if(busy) return;
  const docType = document.getElementById('invType').value;
  const number = document.getElementById('invNumber').value.trim();
  const date = document.getElementById('invDate').value || todayStr();
  const party = document.getElementById('invParty').value.trim();
  const note = document.getElementById('invNote').value.trim();
  const photoFile = document.getElementById('invPhoto').files[0] || null;
  if(!number){ showAppAlert('الرجاء إدخال رقم الفاتورة أو السند.'); return; }
  if(!photoFile){ showAppAlert('الرجاء إرفاق الصورة.'); return; }

  const btn = document.getElementById('invSubmit');
  busy = true; btn.disabled = true;
  try{
    const photoUrl = await uploadVoucherPhoto(photoFile, 'invoices', number);
    const { error } = await sb.from('invoice_archive').insert({ number, note: note||null, party: party||null, photo_path: photoUrl, doc_type: docType, doc_date: date });
    if(error) throw error;

    document.getElementById('invNumber').value = '';
    document.getElementById('invParty').value = '';
    document.getElementById('invNote').value = '';
    document.getElementById('invDate').value = todayStr();
    document.getElementById('invPhoto').value = '';
    document.getElementById('invPhotoPreview').style.display = 'none';
    document.getElementById('invPhotoPreview').innerHTML = '';
    await loadDB();
  }catch(e){
    showErr('تعذر حفظ الفاتورة بالأرشيف.', e);
  }
  busy = false; btn.disabled = false;
});

document.getElementById('invFilterFrom').addEventListener('change', renderInvoicesTable);
document.getElementById('invFilterTo').addEventListener('change', renderInvoicesTable);
document.getElementById('invClearDatesBtn').addEventListener('click', ()=>{
  document.getElementById('invFilterFrom').value = '';
  document.getElementById('invFilterTo').value = '';
  renderInvoicesTable();
});
document.getElementById('invSearch').addEventListener('input', renderInvoicesTable);

const ARABIC_MONTH_NAMES = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const INVOICE_TYPE_LABELS = { supplier:'فاتورة مورد', issue:'سند صرف', purchase_request:'سند طلب شراء' };
const INVOICE_TYPE_PILL_CLASS = { supplier:'pill-inv-supplier', issue:'pill-inv-issue', purchase_request:'pill-inv-purchase' };

function invoiceRowHtml(v){
  const typeText = INVOICE_TYPE_LABELS[v.docType] || v.docType;
  const typeClass = INVOICE_TYPE_PILL_CLASS[v.docType] || 'pill-inv-supplier';
  return `<tr>
    <td><span class="pill ${typeClass}">${typeText}</span></td>
    <td class="mono mono-cell">${v.number}</td>
    <td><input type="date" class="mono inv-date-input" data-inv-date="${v.id}" value="${v.docDate}" style="padding:6px 8px;font-size:12.5px;"></td>
    <td>${v.photoUrl ? `<img src="${v.photoUrl}" alt="" data-view-inv-photo="${v.photoUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid var(--line-strong);cursor:pointer;">` : '-'}</td>
    <td class="wrap-cell">${v.party ? `<b>${escapeHtml(v.party)}</b>` : ''}${(v.party && v.note) ? '<br>' : ''}${v.note ? `<span style="color:var(--ink-soft);font-size:12px;">${escapeHtml(v.note)}</span>` : ''}${(!v.party && !v.note) ? '-' : ''}</td>
    <td>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn-ghost btn-sm" data-inv-print="${v.id}"><i class="fa-solid fa-print"></i> PDF</button>
        <button class="btn-danger-outline btn-sm" data-inv-del="${v.id}" disabled>حذف</button>
      </div>
    </td>
  </tr>`;
}

function invoicePrintBlockHtml(v){
  const typeText = INVOICE_TYPE_LABELS[v.docType] || v.docType;
  return `
    <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B2430;padding-bottom:14px;margin-bottom:16px;">
        <div>
          <div style="font-weight:800;font-size:22px;">${v.party ? escapeHtml(v.party) : 'فنادق سليمان موسى العليان'}</div>
          <div style="font-size:13px;color:#555;margin-top:2px;">${typeText}${v.note ? ' — ' + escapeHtml(v.note) : ''}</div>
        </div>
        <div style="text-align:left;">
          <div style="font-family:monospace;font-weight:700;font-size:19px;">${v.number}</div>
          <div style="font-size:12px;color:#555;">${fmtDate(v.docDate)}</div>
        </div>
      </div>
      ${v.photoUrl ? `<div style="text-align:center;"><img src="${v.photoUrl}" style="max-width:100%;max-height:900px;border:1px solid #ccc;border-radius:6px;"></div>` : '<p>لا توجد صورة مرفقة.</p>'}
    </div>
  `;
}

function printInvoice(v){
  const area = document.getElementById('printArea');
  area.innerHTML = invoicePrintBlockHtml(v);
  window.print();
}

function printInvoiceList(list){
  if(!list || list.length===0){ showAppAlert('لا توجد فواتير مطابقة للطباعة.'); return; }
  const area = document.getElementById('printArea');
  area.innerHTML = list.map((v,idx)=>
    `<div style="${idx>0 ? 'break-before:page;' : ''}padding-top:${idx>0 ? '20px' : '0'};">${invoicePrintBlockHtml(v)}</div>`
  ).join('');
  window.print();
}

document.getElementById('printSupplierAllBtn').addEventListener('click', ()=>{
  printInvoiceList(getFilteredInvoices('supplier'));
});
document.getElementById('printIssueAllBtn').addEventListener('click', ()=>{
  printInvoiceList(getFilteredInvoices('issue'));
});
document.getElementById('printPurchaseAllBtn').addEventListener('click', ()=>{
  printInvoiceList(getFilteredInvoices('purchase_request'));
});

function getFilteredInvoices(docType){
  const from = document.getElementById('invFilterFrom').value;
  const to = document.getElementById('invFilterTo').value;
  const q = document.getElementById('invSearch').value.trim().toLowerCase();
  let list = DB.invoices.slice().sort((a,b)=> (b.docDate||'').localeCompare(a.docDate||''));
  if(docType) list = list.filter(v=> v.docType === docType);
  if(from) list = list.filter(v=> (v.docDate||'') >= from);
  if(to) list = list.filter(v=> (v.docDate||'') <= to);
  if(q) list = list.filter(v=> v.number.toLowerCase().includes(q) || (v.note||'').toLowerCase().includes(q) || (v.party||'').toLowerCase().includes(q));
  return list;
}

function renderInvoiceBox(containerId, docType){
  const container = document.getElementById(containerId);
  const list = getFilteredInvoices(docType);

  if(list.length===0){
    container.innerHTML = '<div class="empty-state"><div class="icon"><i class="fa-solid fa-receipt"></i></div>لا توجد فواتير مطابقة بهذا القسم.</div>';
    return;
  }

  const groups = {};
  list.forEach(v=>{
    const key = (v.docDate || '').slice(0,7);
    if(!groups[key]) groups[key] = [];
    groups[key].push(v);
  });
  const monthKeys = Object.keys(groups).sort((a,b)=> b.localeCompare(a));

  container.innerHTML = monthKeys.map(key=>{
    const [y, m] = key.split('-').map(Number);
    const monthLabel = (ARABIC_MONTH_NAMES[m-1] || '') + ' ' + y;
    const rows = groups[key].map(invoiceRowHtml).join('');
    return `<div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <h3 style="font-family:var(--font-display);font-size:15px;margin:0;">${monthLabel} <span class="mono" style="font-size:12px;color:var(--ink-soft);font-weight:400;">(${groups[key].length})</span></h3>
        <button class="btn-ghost btn-sm" data-print-month="${key}" data-print-month-type="${docType}"><i class="fa-solid fa-print"></i> طباعة هذا الشهر</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <colgroup><col style="width:13%"><col style="width:12%"><col style="width:15%"><col style="width:10%"><col style="width:26%"><col style="width:24%"></colgroup>
          <thead><tr><th>النوع</th><th>الرقم</th><th>التاريخ</th><th>الصورة</th><th>المورد / ملاحظة</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-view-inv-photo]').forEach(img=>{
    img.addEventListener('click', ()=> window.open(img.dataset.viewInvPhoto, '_blank'));
  });
  container.querySelectorAll('[data-inv-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(busy) return;
      if(!confirm('حذف هذه الفاتورة من الأرشيف؟')) return;
      busy = true;
      try{
        const { error } = await sb.from('invoice_archive').delete().eq('id', btn.dataset.invDel);
        if(error) throw error;
        await loadDB();
      }catch(e){ showErr('تعذر حذف الفاتورة.', e); }
      busy = false;
    });
  });
  container.querySelectorAll('[data-inv-print]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const v = DB.invoices.find(x=>x.id===btn.dataset.invPrint);
      if(v) printInvoice(v);
    });
  });
  container.querySelectorAll('[data-print-month]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.printMonth;
      const monthList = getFilteredInvoices(btn.dataset.printMonthType).filter(v=> (v.docDate||'').slice(0,7) === key);
      printInvoiceList(monthList);
    });
  });
  container.querySelectorAll('[data-inv-date]').forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      if(busy) return;
      const newDate = inp.value;
      if(!newDate) return;
      busy = true;
      try{
        const { error } = await sb.from('invoice_archive').update({ doc_date: newDate }).eq('id', inp.dataset.invDate);
        if(error) throw error;
        await loadDB();
      }catch(e){ showErr('تعذر تحديث التاريخ.', e); }
      busy = false;
    });
  });
}

function renderInvoicesTable(){
  renderInvoiceBox('invoicesGroupsSupplier', 'supplier');
  renderInvoiceBox('invoicesGroupsIssue', 'issue');
  renderInvoiceBox('invoicesGroupsPurchase', 'purchase_request');
}

document.getElementById('exportInvoicesExcelBtn').addEventListener('click', ()=>{
  const list = getFilteredInvoices(null); // كل الأنواع، بنفس فلاتر التاريخ والبحث الحالية
  if(list.length===0){ showAppAlert('لا توجد فواتير لتصديرها حسب الفلترة الحالية.'); return; }

  const rows = list.map(v=>({
    'النوع': INVOICE_TYPE_LABELS[v.docType] || v.docType,
    'الرقم': v.number,
    'التاريخ': v.docDate,
    'المورد / الجهة': v.party || '',
    'ملاحظة': v.note || '',
    'رابط الصورة': v.photoUrl || ''
  }));

  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الأرشيف');
    XLSX.writeFile(wb, 'أرشيف-الفواتير-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

wirePhotoPreview('qcPhoto','qcPhotoPreview');

document.getElementById('qcSubmit').addEventListener('click', async ()=>{
  if(busy) return;
  const store = document.getElementById('qcStore').value;
  const date = document.getElementById('qcDate').value || todayStr();
  const warehouseNote = document.getElementById('qcWarehouseNote').value.trim();
  const storageNote = document.getElementById('qcStorageNote').value.trim();
  const photoFile = document.getElementById('qcPhoto').files[0] || null;

  if(!warehouseNote && !storageNote && !photoFile){
    showAppAlert('من فضلك أدخل معلومات (جودة المخزن أو جودة التخزين) أو أرفق صورة قبل الحفظ.');
    return;
  }

  const btn = document.getElementById('qcSubmit');
  busy = true; btn.disabled = true;
  try{
    const photoUrl = photoFile ? await uploadVoucherPhoto(photoFile, 'quality', store) : null;
    const { error } = await sb.from('quality_checks').insert({
      store, check_date: date, warehouse_note: warehouseNote||null, storage_note: storageNote||null, photo_path: photoUrl
    });
    if(error) throw error;

    document.getElementById('qcWarehouseNote').value = '';
    document.getElementById('qcStorageNote').value = '';
    document.getElementById('qcPhoto').value = '';
    document.getElementById('qcPhotoPreview').style.display = 'none';
    document.getElementById('qcPhotoPreview').innerHTML = '';
    document.getElementById('qcDate').value = todayStr();
    await loadDB();
  }catch(e){
    showErr('تعذر حفظ تقييم الجودة.', e);
  }
  busy = false; btn.disabled = false;
});

document.getElementById('qcFilterStore').addEventListener('change', renderQualityTable);

document.getElementById('exportQualityExcelBtn').addEventListener('click', ()=>{
  const store = document.getElementById('qcFilterStore').value;
  let list = DB.quality.slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(store !== 'all') list = list.filter(q=> q.store === store);
  if(list.length===0){ showAppAlert('لا توجد تقييمات جودة لتصديرها حسب الفلترة الحالية.'); return; }

  const rows = list.map(q=>({
    'المخزن': STORE_LABELS[q.store] || q.store,
    'التاريخ': q.date,
    'جودة المخزن': q.warehouseNote || '',
    'جودة التخزين': q.storageNote || '',
    'رابط الصورة': q.photoUrl || ''
  }));

  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الجودة');
    XLSX.writeFile(wb, 'تقييمات-الجودة-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

function renderQualityTable(){
  const tbody = document.querySelector('#qualityTable tbody');
  const store = document.getElementById('qcFilterStore').value;
  let list = DB.quality.slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(store !== 'all') list = list.filter(q=> q.store === store);

  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-camera"></i></div>لا توجد تقييمات جودة مسجّلة بعد.</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(q=>`
    <tr>
      <td><span class="pill pill-store-${q.store}">${STORE_LABELS[q.store]||q.store}</span></td>
      <td>${fmtDate(q.date)}</td>
      <td>${q.photoUrl ? `<img src="${q.photoUrl}" alt="" data-view-qc-photo="${q.photoUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid var(--line-strong);cursor:pointer;">` : '-'}</td>
      <td class="wrap-cell">${escapeHtml(q.warehouseNote||'-')}</td>
      <td class="wrap-cell">${escapeHtml(q.storageNote||'-')}</td>
      <td><button class="btn-danger-outline btn-sm" data-qc-del="${q.id}" disabled>حذف</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-view-qc-photo]').forEach(img=>{
    img.addEventListener('click', ()=> window.open(img.dataset.viewQcPhoto, '_blank'));
  });
  tbody.querySelectorAll('[data-qc-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(busy) return;
      if(!confirm('حذف تقييم الجودة هذا؟')) return;
      busy = true;
      try{
        const { error } = await sb.from('quality_checks').delete().eq('id', btn.dataset.qcDel);
        if(error) throw error;
        await loadDB();
      }catch(e){ showErr('تعذر الحذف.', e); }
      busy = false;
    });
  });
}

function renderDashboard(){
  if(typeof renderGreetingBar === 'function') renderGreetingBar();
  if(typeof renderShortageBanner === 'function') renderShortageBanner();
  if(typeof renderHealthRing === 'function') renderHealthRing();
  if(typeof renderBusiestCard === 'function') renderBusiestCard();
  if(typeof renderPredictedShortages === 'function') renderPredictedShortages();
  if(typeof renderActionCenter === 'function') renderActionCenter();
  if(typeof renderCompareStrip === 'function') renderCompareStrip();
  if(typeof renderMonthlyChart === 'function') renderMonthlyChart();
  if(typeof renderTopItems === 'function') renderTopItems();
  if(typeof renderTopSuppliers === 'function') renderTopSuppliers();
  // شريط المؤشرات العام (KPI)
  const kpiEl = document.getElementById('dashKpis');
  if(kpiEl){
    const totalItems = DB.items.length;
    const totalIn  = DB.vouchers.filter(v=>v.type==='in').length;
    const totalOut = DB.vouchers.filter(v=>v.type==='out').length;
    const totalLow = DB.items.filter(i=> i.min>0 && i.balance<=i.min).length;
    kpiEl.innerHTML = `
      <div class="kpi-tile kpi-items">
        <div class="kpi-head"><span class="kpi-ico"><i class="fa-solid fa-box"></i></span><span class="kpi-label">إجمالي الأصناف</span></div>
        <div class="kpi-value" data-count="${totalItems}">0</div>
      </div>
      <div class="kpi-tile kpi-in">
        <div class="kpi-head"><span class="kpi-ico"><i class="fa-solid fa-inbox"></i></span><span class="kpi-label">سندات التوريد</span></div>
        <div class="kpi-value" data-count="${totalIn}">0</div>
      </div>
      <div class="kpi-tile kpi-out">
        <div class="kpi-head"><span class="kpi-ico"><i class="fa-solid fa-paper-plane"></i></span><span class="kpi-label">سندات الصرف</span></div>
        <div class="kpi-value" data-count="${totalOut}">0</div>
      </div>
      <div class="kpi-tile kpi-low ${totalLow>0?'has-low':''}">
        <div class="kpi-head"><span class="kpi-ico"><i class="fa-solid fa-triangle-exclamation"></i></span><span class="kpi-label">أصناف عند الحد الأدنى</span></div>
        <div class="kpi-value" data-count="${totalLow}">0</div>
      </div>
    `;
    animateCounters(kpiEl);
  }

  const cardsEl = document.getElementById('dashCards');
  const stores = ['freezer','pantry','cleaning'];
  cardsEl.innerHTML = stores.map(s=>{
    const items = getItemsByStore(s);
    const totalIn = DB.vouchers.filter(v=>v.type==='in' && v.lines.some(l=>l.store===s)).length;
    const totalOut = DB.vouchers.filter(v=>v.type==='out' && v.lines.some(l=>l.store===s)).length;
    const low = items.filter(i=> i.min>0 && i.balance<=i.min);
    const sparkValues = (typeof computeStoreSparkline==='function') ? computeStoreSparkline(s) : [];
    const sparkSvg = (typeof sparklineSvg==='function') ? sparklineSvg(sparkValues) : '';
    return `
      <div class="store-card ${s}">
        <div class="tag">${s==='freezer'?'FREEZER':s==='pantry'?'PANTRY':'CLEANING'}</div>
        <h3>${STORE_LABELS[s]}</h3>
        <div class="stat-row"><span>عدد الأصناف</span><b data-count="${items.length}">0</b></div>
        <div class="stat-row"><span>سندات التوريد</span><b data-count="${totalIn}">0</b></div>
        <div class="stat-row"><span>سندات الصرف</span><b data-count="${totalOut}">0</b></div>
        ${low.length>0 ? `<div class="low-badge warn"><i class="fa-solid fa-triangle-exclamation"></i> ${low.length} صنف عند الحد الأدنى أو أقل</div>` : `<div class="low-badge">لا يوجد نقص حاليًا</div>`}
        <div class="store-sparkline-wrap">
          <div class="ssw-label">حركة آخر 7 أيام</div>
          ${sparkSvg}
        </div>
      </div>
    `;
  }).join('');
  animateCounters(cardsEl);

  const tbody = document.querySelector('#dashRecentTable tbody');
  const recent = DB.vouchers.slice(0,8);
  if(recent.length===0){
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell"><div class="empty-state"><div class="icon"><i class="fa-solid fa-receipt"></i></div>لم تُسجَّل أي سندات بعد.</div></td></tr>';
  } else {
    tbody.innerHTML = recent.map(v=>`
      <tr>
        <td class="mono" data-label="رقم السند">${v.number}</td>
        <td data-label="النوع"><span class="pill ${v.type==='in'?'pill-in':'pill-out'}">${v.type==='in'?'وارد':'صادر'}</span></td>
        <td data-label="المخزن">${storePillsHtml(voucherStoreList(v))}</td>
        <td data-label="التاريخ">${fmtDate(v.date)}</td>
        <td class="mono" data-label="عدد الأصناف">${v.lines.length}</td>
      </tr>
    `).join('');
  }
}

document.getElementById('ledgerItemSelect').addEventListener('change', renderLedgerTable);

function renderLedgerSelect(){
  const sel = document.getElementById('ledgerItemSelect');
  const current = sel.value;
  if(DB.items.length===0){
    sel.innerHTML = '<option value="">لا توجد أصناف بعد</option>';
    document.querySelector('#ledgerTable tbody').innerHTML = '';
    document.getElementById('ledgerSummary').innerHTML = '';
    return;
  }
  sel.innerHTML = '<option value="__ALL__"><i class="fa-solid fa-clipboard-list"></i> كل الأصناف — كشف شامل</option>'
    + DB.items.map(i=>`<option value="${i.id}" ${i.id===current?'selected':''}>${escapeHtml(i.name)} — ${STORE_LABELS[i.store]}</option>`).join('');
  if(current) sel.value = current;
  renderLedgerTable();
}

function getItemMovesWithBalance(id){
  const it = findItem(id);
  if(!it) return { it:null, rows:[] };
  const moves = [];
  DB.vouchers.forEach(v=>{
    v.lines.forEach(l=>{
      if(l.itemId===id) moves.push({ date:v.date, number:v.number, type:v.type, qty:l.qty, createdAt:v.createdAt });
    });
  });
  moves.sort((a,b)=> a.createdAt - b.createdAt);
  let running = it.balance - moves.reduce((acc,m)=> acc + (m.type==='in'?m.qty:-m.qty), 0);
  const rows = moves.map(m=>{
    running += (m.type==='in' ? m.qty : -m.qty);
    return { date:m.date, number:m.number, type:m.type, qty:m.qty, balanceAfter: running };
  });
  return { it, rows };
}

function getAllMovesFlat(){
  const moves = [];
  DB.vouchers.forEach(v=>{
    v.lines.forEach(l=>{
      moves.push({
        date: v.date, number: v.number, type: v.type, qty: l.qty, createdAt: v.createdAt,
        itemId: l.itemId, itemName: l.name || '(صنف محذوف)',
        store: l.store || null, unit: l.unit || '',
        party: v.party || ''
      });
    });
  });
  moves.sort((a,b)=> b.createdAt - a.createdAt);
  return moves;
}

(function(){
  const search = document.getElementById('ledgerItemSearch');
  if(!search) return;
  search.addEventListener('input', function(){
    const sel = document.getElementById('ledgerItemSelect');
    const nq = normName(search.value.trim());
    let firstVisible = null;
    Array.from(sel.options).forEach(function(opt){
      if(!opt.value || opt.value==='__ALL__'){ return; }
      const match = !nq || normName(opt.textContent).indexOf(nq) > -1;
      opt.hidden = !match;
      if(match && !firstVisible) firstVisible = opt;
    });
    if(nq && firstVisible && sel.selectedOptions[0] && sel.selectedOptions[0].hidden){
      sel.value = firstVisible.value;
      renderLedgerTable();
    }
  });
})();

(function(){
  const periodSel = document.getElementById('ledgerPeriodSelect');
  const fromWrap = document.getElementById('ledgerCustomFromWrap');
  const toWrap = document.getElementById('ledgerCustomToWrap');
  if(!periodSel) return;
  periodSel.addEventListener('change', function(){
    const isCustom = periodSel.value === 'custom';
    fromWrap.style.display = isCustom ? 'block' : 'none';
    toWrap.style.display = isCustom ? 'block' : 'none';
    renderLedgerTable();
  });
  document.getElementById('ledgerFromDate').addEventListener('change', renderLedgerTable);
  document.getElementById('ledgerToDate').addEventListener('change', renderLedgerTable);
})();

function computeLedgerPeriodBounds(){
  const val = document.getElementById('ledgerPeriodSelect').value;
  if(val==='all') return { from:null, to:null };
  if(val==='custom'){
    const from = document.getElementById('ledgerFromDate').value || null;
    const to = document.getElementById('ledgerToDate').value || null;
    return { from: from, to: to };
  }
  const days = parseInt(val, 10) || 30;
  const d = new Date(); d.setDate(d.getDate() - days);
  return { from: localDateStr(d), to: null };
}
function filterMovesByPeriod(moves, bounds){
  return moves.filter(function(m){
    if(bounds.from && m.date < bounds.from) return false;
    if(bounds.to && m.date > bounds.to) return false;
    return true;
  });
}
function ledgerPeriodLabel(bounds){
  const val = document.getElementById('ledgerPeriodSelect').value;
  if(val==='30') return 'آخر 30 يوم';
  if(val==='90') return 'آخر 90 يوم';
  if(val==='custom') return (bounds.from?fmtDate(bounds.from):'البداية') + ' — ' + (bounds.to?fmtDate(bounds.to):'اليوم');
  return 'كل الفترة المسجّلة';
}

let ledgerGroupedView = false;
(function(){
  const btn = document.getElementById('ledgerGroupToggle');
  if(!btn) return;
  btn.addEventListener('click', function(){
    ledgerGroupedView = !ledgerGroupedView;
    btn.classList.toggle('btn-in', ledgerGroupedView);
    renderLedgerTable();
  });
})();
function groupMovesByMonth(moves){
  const groups = {};
  const order = [];
  moves.forEach(function(m){
    const key = (m.date||'').slice(0,7);
    if(!groups[key]){ groups[key] = { month:key, in:0, out:0, count:0, lastBalance:null }; order.push(key); }
    if(m.type==='in') groups[key].in += m.qty; else groups[key].out += m.qty;
    groups[key].count++;
    groups[key].lastBalance = m.balanceAfter;
  });
  return order.sort().map(function(k){ return groups[k]; });
}

function renderLedgerKpis(moves){
  const el = document.getElementById('ledgerKpis');
  if(!el) return;
  const totalIn = moves.filter(function(m){return m.type==='in';}).reduce(function(s,m){return s+m.qty;},0);
  const totalOut = moves.filter(function(m){return m.type==='out';}).reduce(function(s,m){return s+m.qty;},0);
  const net = totalIn - totalOut;
  el.innerHTML =
      kpiTile('kpi-in','<i class="fa-solid fa-inbox"></i>','إجمالي الوارد', fmtNum(totalIn), false)
    + kpiTile('kpi-out','<i class="fa-solid fa-paper-plane"></i>','إجمالي الصادر', fmtNum(totalOut), false)
    + kpiTile(net>=0?'kpi-items':'kpi-low','<i class="fa-solid fa-scale-balanced"></i>','صافي التغيّر', (net>=0?'+':'')+fmtNum(net), false)
    + kpiTile('kpi-low','<i class="fa-solid fa-receipt"></i>','عدد الحركات', moves.length, true);
  animateCounters(el);
}

function renderLedgerTrendChart(moves){
  const el = document.getElementById('ledgerTrendChart');
  if(!el) return;
  if(moves.length===0){
    el.innerHTML = '<div class="ledger-trend-empty">لا توجد حركات كافية لعرض الرسم البياني.</div>';
    return;
  }
  const w = 560, h = 150, padL = 38, padR = 12, padT = 14, padB = 22;
  const values = moves.map(function(m){ return m.balanceAfter; });
  const maxV = Math.max.apply(null, values.concat([1]));
  const minV = Math.min.apply(null, values.concat([0]));
  const range = (maxV - minV) || 1;
  const stepX = (w - padL - padR) / Math.max(1, moves.length - 1);
  const points = values.map(function(v,i){
    const x = padL + i*stepX;
    const y = padT + (h - padT - padB) - ((v - minV)/range) * (h - padT - padB);
    return { x:x, y:y };
  });
  const pathD = points.map(function(p,i){ return (i===0?'M':'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  const areaD = pathD + ' L' + points[points.length-1].x.toFixed(1) + ',' + (h-padB) + ' L' + points[0].x.toFixed(1) + ',' + (h-padB) + ' Z';

  const firstDate = fmtDate(moves[0].date);
  const lastDate = fmtDate(moves[moves.length-1].date);
  const midIdx = Math.floor(moves.length/2);
  const midDate = fmtDate(moves[midIdx].date);

  el.innerHTML =
    '<svg class="ledger-trend-svg" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'
    + '<line x1="'+padL+'" y1="'+padT+'" x2="'+padL+'" y2="'+(h-padB)+'" stroke="var(--line)" stroke-width="1"/>'
    + '<line x1="'+padL+'" y1="'+(h-padB)+'" x2="'+(w-padR)+'" y2="'+(h-padB)+'" stroke="var(--line)" stroke-width="1"/>'
    + '<text x="4" y="'+(padT+4)+'" font-size="10" fill="var(--ink-soft)">'+fmtNum(maxV)+'</text>'
    + '<text x="4" y="'+(h-padB)+'" font-size="10" fill="var(--ink-soft)">'+fmtNum(minV)+'</text>'
    + '<path d="'+areaD+'" fill="var(--freezer-soft)" stroke="none"/>'
    + '<path d="'+pathD+'" fill="none" stroke="var(--freezer)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'
    + points.map(function(p,i){ return (i===points.length-1) ? '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.5" fill="var(--freezer)"/>' : ''; }).join('')
    + '<text x="'+padL+'" y="'+(h-4)+'" font-size="10" fill="var(--ink-soft)" text-anchor="start">'+firstDate+'</text>'
    + '<text x="'+((padL+w-padR)/2)+'" y="'+(h-4)+'" font-size="10" fill="var(--ink-soft)" text-anchor="middle">'+midDate+'</text>'
    + '<text x="'+(w-padR)+'" y="'+(h-4)+'" font-size="10" fill="var(--ink-soft)" text-anchor="end">'+lastDate+'</text>'
    + '</svg>';
}

function computeConsumptionTrend(it, fullMoves){
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
  const cutoffStr = localDateStr(cutoff);
  const recentOut = fullMoves.filter(function(m){ return m.type==='out' && m.date >= cutoffStr; });
  const totalOut = recentOut.reduce(function(s,m){return s+m.qty;},0);
  const avgPerDay = totalOut/30;
  if(avgPerDay<=0) return { hasConsumption:false };
  const daysLeft = it.balance>0 ? (it.balance/avgPerDay) : 0;
  return { hasConsumption:true, avgPerDay:avgPerDay, daysLeft:daysLeft };
}
function renderConsumptionTrend(it, fullMoves){
  const el = document.getElementById('ledgerConsumptionTrend');
  if(!el) return;
  const c = computeConsumptionTrend(it, fullMoves);
  if(!c.hasConsumption){
    el.innerHTML = '<div class="consumption-trend ct-flat"><div class="ct-days">— لا استهلاك حديث —</div>'
      + '<div class="ct-label">لا يوجد صرف لهذا الصنف آخر 30 يوم</div></div>';
    return;
  }
  const days = Math.round(c.daysLeft*10)/10;
  const warn = days <= 7;
  el.innerHTML = '<div class="consumption-trend '+(warn?'ct-warn':'ct-ok')+'">'
    + '<div class="ct-days">~'+days+' يوم</div>'
    + '<div class="ct-label">'+(warn?'<i class="fa-solid fa-triangle-exclamation"></i> ':'')+'متوقع نفاذ الرصيد الحالي عند هذا المعدّل</div>'
    + '<div class="ct-rate">معدّل الاستهلاك: '+fmtNum(Math.round(c.avgPerDay*100)/100)+' '+escapeHtml(it.unit||'')+' / يوم (آخر 30 يوم)</div>'
    + '</div>';
}

function renderInOutCompare(moves){
  const el = document.getElementById('ledgerInOutCompare');
  if(!el) return;
  const totalIn = moves.filter(function(m){return m.type==='in';}).reduce(function(s,m){return s+m.qty;},0);
  const totalOut = moves.filter(function(m){return m.type==='out';}).reduce(function(s,m){return s+m.qty;},0);
  const total = totalIn + totalOut;
  if(total<=0){
    el.innerHTML = '<div class="ledger-io-empty">لا توجد حركات في هذه الفترة.</div>';
    return;
  }
  const inPct = Math.round((totalIn/total)*100);
  const outPct = 100 - inPct;
  el.innerHTML =
      '<div class="ledger-io-bar">'
    + (inPct>0 ? '<div class="ledger-io-seg io-in" style="width:'+inPct+'%;">'+(inPct>=12?inPct+'%':'')+'</div>' : '')
    + (outPct>0 ? '<div class="ledger-io-seg io-out" style="width:'+outPct+'%;">'+(outPct>=12?outPct+'%':'')+'</div>' : '')
    + '</div>'
    + '<div class="ledger-io-legend">'
    + '<span><i style="background:var(--stamp-in);"></i>وارد '+fmtNum(totalIn)+' ('+inPct+'%)</span>'
    + '<span><i style="background:var(--stamp-out);"></i>صادر '+fmtNum(totalOut)+' ('+outPct+'%)</span>'
    + '</div>';
}

function setLedgerTableMode(isAll){
  const singleWrap = document.getElementById('ledgerSingleWrap');
  const groupedWrap = document.getElementById('ledgerGroupedByItem');
  if(singleWrap) singleWrap.style.display = isAll ? 'none' : '';
  if(groupedWrap) groupedWrap.style.display = isAll ? '' : 'none';
}

function renderAllItemsLedgerTable(){
  setLedgerTableMode(true);
  const summary = document.getElementById('ledgerSummary');
  const titleEl = document.getElementById('ledgerTableTitle');
  const groupBtn = document.getElementById('ledgerGroupToggle');
  if(groupBtn) groupBtn.style.display = 'none';

  const allMoves = getAllMovesFlat();
  const bounds = computeLedgerPeriodBounds();
  const filteredMoves = filterMovesByPeriod(allMoves, bounds);
  const periodLabel = ledgerPeriodLabel(bounds);

  renderLedgerKpis(filteredMoves);

  const trendEl = document.getElementById('ledgerTrendChart');
  if(trendEl) trendEl.innerHTML = '<div class="ledger-trend-empty">رسم الرصيد متاح فقط عند اختيار صنف محدّد بالأعلى — كل صنف بالأسفل له جدول وتقدير استهلاك خاص فيه.</div>';
  const consEl = document.getElementById('ledgerConsumptionTrend');
  if(consEl) consEl.innerHTML = '<div class="consumption-trend ct-flat"><div class="ct-days">—</div><div class="ct-label">تقدير الاستهلاك موجود مع كل صنف على حدة بالأسفل</div></div>';
  renderInOutCompare(filteredMoves);

  titleEl.textContent = 'كل حركات المخزن — مقسّمة لكل صنف (' + periodLabel + ')';

  // نجمع الأصناف اللي لها حركة بالفترة المحدّدة، ونبني لكل واحد كشفه الكامل (رصيد بعد كل حركة) بنفس منطق كشف الصنف المفرد
  const activeIds = new Set(filteredMoves.map(m=>m.itemId));
  const groupedEl = document.getElementById('ledgerGroupedByItem');
  if(activeIds.size===0){
    groupedEl.innerHTML = '<div class="empty-state"><div class="icon"><i class="fa-solid fa-file"></i></div>لا توجد حركات في هذه الفترة.</div>';
    const distinctItems0 = 0;
    summary.innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;">
        <div><label>عدد الأصناف المتحركة</label><span class="mono">${distinctItems0}</span></div>
        <div><label>إجمالي عدد الحركات</label><span class="mono">0</span></div>
        <div><label>الفترة المعروضة</label><span class="mono">${periodLabel}</span></div>
      </div>
    `;
    return;
  }

  const blocks = DB.items
    .filter(it=> activeIds.has(it.id))
    .map(it=>{
      const full = getItemMovesWithBalance(it.id).rows;
      const periodRows = filterMovesByPeriod(full, bounds);
      const c = computeConsumptionTrend(it, full);
      const totalIn = periodRows.filter(m=>m.type==='in').reduce((s,m)=>s+m.qty,0);
      const totalOut = periodRows.filter(m=>m.type==='out').reduce((s,m)=>s+m.qty,0);
      const low = it.min>0 && it.balance<=it.min;
      const consumptionHtml = c.hasConsumption
        ? '<i class="fa-solid fa-arrow-trend-down"></i> معدّل الاستهلاك: <b>' + fmtNum(Math.round(c.avgPerDay*100)/100) + ' ' + escapeHtml(it.unit||'') + ' / يوم</b> (آخر 30 يوم)'
          + (c.daysLeft ? ' — متوقع نفاذ الرصيد خلال <b>~' + (Math.round(c.daysLeft*10)/10) + ' يوم</b>' + (c.daysLeft<=7?' <i class="fa-solid fa-triangle-exclamation"></i>':'') : '')
        : '<i class="fa-solid fa-arrow-trend-down"></i> لا يوجد استهلاك حديث لهذا الصنف (آخر 30 يوم)';
      const rowsHtml = periodRows.map(m=>`<tr>
        <td data-label="التاريخ">${fmtDate(m.date)}</td>
        <td class="mono" data-label="رقم السند">${m.number}</td>
        <td data-label="النوع"><span class="pill ${m.type==='in'?'pill-in':'pill-out'}">${m.type==='in'?'وارد':'صادر'}</span></td>
        <td class="mono mono-cell" data-label="الكمية">${m.type==='in'?'+':'−'}${fmtNum(m.qty)}</td>
        <td class="ledger-balance" data-label="الرصيد بعد الحركة">${fmtNum(m.balanceAfter)}</td>
        <td class="wrap-cell" data-label="الجهة">${m.party ? escapeHtml(m.party) : '-'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty-cell"><div class="empty-state"><div class="icon"><i class="fa-solid fa-file"></i></div>لا توجد حركات في هذه الفترة.</div></td></tr>';

      return `<div class="card ledger-item-block">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <h3 style="margin:0;font-size:15px;">${escapeHtml(it.name)}</h3>
            <span class="pill pill-store-${it.store}">${STORE_LABELS[it.store]}</span>
            ${low ? '<span class="pill pill-out"><i class="fa-solid fa-triangle-exclamation"></i> عند الحد الأدنى</span>' : ''}
          </div>
          <div style="font-size:12.5px;color:var(--ink-soft);display:flex;gap:14px;flex-wrap:wrap;">
            <span>الرصيد الحالي: <b class="mono-cell" style="color:var(--ink);">${fmtNum(it.balance)} ${escapeHtml(it.unit)}</b></span>
            <span>وارد الفترة: <b class="mono-cell" style="color:var(--stamp-in);">${fmtNum(totalIn)}</b></span>
            <span>صادر الفترة: <b class="mono-cell" style="color:var(--stamp-out);">${fmtNum(totalOut)}</b></span>
          </div>
        </div>
        <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px;">${consumptionHtml}</div>
        <div class="table-wrap" style="max-height:none;">
          <table class="data ledger-item-table">
            <colgroup><col style="width:14%"><col style="width:18%"><col style="width:12%"><col style="width:14%"><col style="width:16%"><col style="width:26%"></colgroup>
            <thead><tr><th>التاريخ</th><th>رقم السند</th><th>النوع</th><th>الكمية</th><th>الرصيد بعد الحركة</th><th>الجهة</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
    });

  groupedEl.innerHTML = blocks.join('');

  const distinctItems = activeIds.size;
  summary.innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;">
      <div><label>عدد الأصناف المتحركة</label><span class="mono">${distinctItems}</span></div>
      <div><label>إجمالي عدد الحركات</label><span class="mono">${filteredMoves.length}</span></div>
      <div><label>الفترة المعروضة</label><span class="mono">${periodLabel}</span></div>
    </div>
  `;
}

function renderLedgerTable(){
  const id = document.getElementById('ledgerItemSelect').value;
  if(id === '__ALL__'){ renderAllItemsLedgerTable(); return; }
  const groupBtn = document.getElementById('ledgerGroupToggle');
  if(groupBtn) groupBtn.style.display = '';
  setLedgerTableMode(false);
  const { it, rows: moves } = getItemMovesWithBalance(id);
  const tbody = document.querySelector('#ledgerTable tbody');
  const summary = document.getElementById('ledgerSummary');
  if(!it){
    tbody.innerHTML='';
    summary.innerHTML='';
    ['ledgerKpis','ledgerTrendChart','ledgerConsumptionTrend','ledgerInOutCompare'].forEach(function(cid){
      const e = document.getElementById(cid); if(e) e.innerHTML='';
    });
    return;
  }

  const bounds = computeLedgerPeriodBounds();
  const filteredMoves = filterMovesByPeriod(moves, bounds);
  const periodLabel = ledgerPeriodLabel(bounds);

  renderLedgerKpis(filteredMoves);
  renderLedgerTrendChart(filteredMoves);
  renderConsumptionTrend(it, moves);
  renderInOutCompare(filteredMoves);

  const titleEl = document.getElementById('ledgerTableTitle');
  let rows;
  if(ledgerGroupedView){
    const groups = groupMovesByMonth(filteredMoves);
    titleEl.textContent = 'تفاصيل الحركات — تجميع شهري (' + periodLabel + ')';
    rows = groups.map(function(g){
      const net = g.in - g.out;
      return `<tr class="ledger-month-row">
        <td colspan="2" data-label="الشهر">${monthShortLabel(g.month)} ${g.month.slice(0,4)} <span style="color:var(--ink-soft);font-weight:500;">(${g.count} حركة)</span></td>
        <td class="mono" data-label="الوارد/الصادر">وارد ${fmtNum(g.in)} · صادر ${fmtNum(g.out)}</td>
        <td class="mono mono-cell" data-label="صافي التغيّر">${net>=0?'+':''}${fmtNum(net)}</td>
        <td class="ledger-balance" data-label="الرصيد بنهاية الشهر">${fmtNum(g.lastBalance)}</td>
      </tr>`;
    });
  } else {
    titleEl.textContent = 'تفاصيل الحركات (' + periodLabel + ')';
    rows = filteredMoves.map(m=>`<tr>
      <td data-label="التاريخ">${fmtDate(m.date)}</td>
      <td class="mono" data-label="رقم السند">${m.number}</td>
      <td data-label="النوع"><span class="pill ${m.type==='in'?'pill-in':'pill-out'}">${m.type==='in'?'وارد':'صادر'}</span></td>
      <td class="mono mono-cell" data-label="الكمية">${m.type==='in'?'+':'−'}${fmtNum(m.qty)}</td>
      <td class="ledger-balance" data-label="الرصيد بعد الحركة">${fmtNum(m.balanceAfter)}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="5" class="empty-cell"><div class="empty-state"><div class="icon"><i class="fa-solid fa-file"></i></div>لا توجد حركات في هذه الفترة.</div></td></tr>';

  const low = it.min>0 && it.balance<=it.min;
  summary.innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;">
      <div><label>المخزن</label><span class="pill pill-store-${it.store}">${STORE_LABELS[it.store]}</span></div>
      <div><label>الوحدة</label><span>${escapeHtml(it.unit)}</span></div>
      <div><label>الرصيد الحالي</label><span class="ledger-balance ${low?'low-flag':''}">${fmtNum(it.balance)} ${low?'<i class="fa-solid fa-triangle-exclamation"></i> عند الحد الأدنى':''}</span></div>
      <div><label>الفترة المعروضة</label><span class="mono">${periodLabel}</span></div>
    </div>
  `;
}

function printAllItemsLedger(){
  const allMoves = getAllMovesFlat();
  const printBounds = computeLedgerPeriodBounds();
  const printMoves = filterMovesByPeriod(allMoves, printBounds);
  const printTotalIn = printMoves.filter(m=>m.type==='in').reduce((s,m)=>s+m.qty,0);
  const printTotalOut = printMoves.filter(m=>m.type==='out').reduce((s,m)=>s+m.qty,0);
  const distinctItems = new Set(printMoves.map(m=>m.itemId)).size;
  const area = document.getElementById('printArea');
  area.innerHTML = `
    <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B2430;padding-bottom:14px;margin-bottom:18px;">
        <div>
          <div style="font-weight:800;font-size:20px;">فنادق سليمان موسى العليان</div>
          <div style="font-size:13px;color:#555;margin-top:2px;">كشف شامل لحركة كل الأصناف</div>
        </div>
        <div style="text-align:left;">
          <div style="font-size:12px;color:#555;">${ledgerPeriodLabel(printBounds)}</div>
          <div style="font-size:12px;color:#555;">تاريخ الطباعة: ${fmtDate(todayStr())}</div>
        </div>
      </div>
      <div style="display:flex;gap:22px;margin-bottom:16px;font-size:13px;flex-wrap:wrap;">
        <div><b>عدد الأصناف المتحركة:</b> ${distinctItems}</div>
        <div><b>إجمالي الوارد:</b> ${fmtNum(printTotalIn)}</div>
        <div><b>إجمالي الصادر:</b> ${fmtNum(printTotalOut)}</div>
        <div><b>عدد الحركات:</b> ${printMoves.length}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#EDE8DC;">
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">التاريخ</th>
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">الصنف</th>
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">المخزن</th>
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">النوع</th>
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">الكمية</th>
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">الجهة</th>
            <th style="padding:6px 7px;text-align:right;border-bottom:2px solid #1B2430;">رقم السند</th>
          </tr>
        </thead>
        <tbody>
          ${printMoves.map(m=>`<tr>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${fmtDate(m.date)}</td>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${escapeHtml(m.itemName)}</td>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${m.store ? STORE_LABELS[m.store] : '-'}</td>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${m.type==='in'?'وارد':'صادر'}</td>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${m.type==='in'?'+':'−'}${fmtNum(m.qty)}</td>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${m.party ? escapeHtml(m.party) : '-'}</td>
            <td style="padding:5px 7px;border-bottom:1px solid #ddd;">${m.number}</td>
          </tr>`).join('') || '<tr><td colspan="7" style="padding:14px;text-align:center;color:#777;">لا توجد حركات في هذه الفترة.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  window.print();
}

document.getElementById('ledgerPrintBtn').addEventListener('click', ()=>{
  const id = document.getElementById('ledgerItemSelect').value;
  if(id === '__ALL__'){ printAllItemsLedger(); return; }
  const { it, rows: moves } = getItemMovesWithBalance(id);
  if(!it){ showAppAlert('اختر صنفًا أولاً.'); return; }
  const printBounds = computeLedgerPeriodBounds();
  const printMoves = filterMovesByPeriod(moves, printBounds);
  const printTotalIn = printMoves.filter(m=>m.type==='in').reduce((s,m)=>s+m.qty,0);
  const printTotalOut = printMoves.filter(m=>m.type==='out').reduce((s,m)=>s+m.qty,0);
  const area = document.getElementById('printArea');
  area.innerHTML = `
    <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;color:#111;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B2430;padding-bottom:14px;margin-bottom:18px;">
        <div>
          <div style="font-weight:800;font-size:20px;">فنادق سليمان موسى العليان</div>
          <div style="font-size:13px;color:#555;margin-top:2px;">الحركه اليوميه لصنف: ${escapeHtml(it.name)}</div>
        </div>
        <div style="text-align:left;">
          <div style="font-size:12px;color:#555;">${ledgerPeriodLabel(printBounds)}</div>
          <div style="font-size:12px;color:#555;">تاريخ الطباعة: ${fmtDate(todayStr())}</div>
        </div>
      </div>
      <div style="display:flex;gap:22px;margin-bottom:16px;font-size:13px;flex-wrap:wrap;">
        <div><b>المخزن:</b> ${STORE_LABELS[it.store]}</div>
        <div><b>الوحدة:</b> ${escapeHtml(it.unit)}</div>
        <div><b>الرصيد الحالي:</b> ${fmtNum(it.balance)}</div>
        <div><b>إجمالي الوارد:</b> ${fmtNum(printTotalIn)}</div>
        <div><b>إجمالي الصادر:</b> ${fmtNum(printTotalOut)}</div>
        <div><b>صافي التغيّر:</b> ${(printTotalIn-printTotalOut)>=0?'+':''}${fmtNum(printTotalIn-printTotalOut)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead>
          <tr style="background:#EDE8DC;">
            <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #1B2430;">التاريخ</th>
            <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #1B2430;">رقم السند</th>
            <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #1B2430;">النوع</th>
            <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #1B2430;">الكمية</th>
            <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #1B2430;">الرصيد بعد الحركة</th>
          </tr>
        </thead>
        <tbody>
          ${printMoves.map(m=>`<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${fmtDate(m.date)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${m.number}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${m.type==='in'?'وارد':'صادر'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${m.type==='in'?'+':'−'}${fmtNum(m.qty)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${fmtNum(m.balanceAfter)}</td>
          </tr>`).join('') || '<tr><td colspan="5" style="padding:14px;text-align:center;color:#777;">لا توجد حركات في هذه الفترة.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  window.print();
});

function exportAllItemsLedgerExcel(){
  const allMoves = getAllMovesFlat();
  const bounds = computeLedgerPeriodBounds();
  const filteredMoves = filterMovesByPeriod(allMoves, bounds);
  if(filteredMoves.length===0){ showAppAlert('لا توجد حركات في هذه الفترة لتصديرها.'); return; }

  const totalIn = filteredMoves.filter(m=>m.type==='in').reduce((s,m)=>s+m.qty,0);
  const totalOut = filteredMoves.filter(m=>m.type==='out').reduce((s,m)=>s+m.qty,0);
  const distinctItems = new Set(filteredMoves.map(m=>m.itemId)).size;

  const summaryRows = [{
    'الفترة المعروضة': ledgerPeriodLabel(bounds),
    'عدد الأصناف المتحركة': distinctItems,
    'إجمالي الوارد': totalIn,
    'إجمالي الصادر': totalOut,
    'صافي التغيّر': totalIn - totalOut,
    'عدد الحركات': filteredMoves.length,
    'تاريخ التصدير': todayStr()
  }];
  const rows = filteredMoves.map(m=>({
    'التاريخ': m.date,
    'الصنف': m.itemName,
    'المخزن': m.store ? (STORE_LABELS[m.store]||m.store) : '',
    'النوع': m.type==='in' ? 'وارد' : 'صادر',
    'الكمية': m.type==='in' ? m.qty : -m.qty,
    'الوحدة': m.unit,
    'الجهة': m.party,
    'رقم السند': m.number
  }));

  try{
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [ {wch:22},{wch:20},{wch:14},{wch:14},{wch:14},{wch:12},{wch:14} ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص');
    const wsDetail = XLSX.utils.json_to_sheet(rows);
    wsDetail['!cols'] = [ {wch:12},{wch:24},{wch:14},{wch:10},{wch:10},{wch:10},{wch:20},{wch:14} ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'كل الحركات');
    XLSX.writeFile(wb, 'كشف-حركة-كل-الأصناف-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
}

document.getElementById('exportLedgerExcelBtn').addEventListener('click', ()=>{
  const id = document.getElementById('ledgerItemSelect').value;
  if(id === '__ALL__'){ exportAllItemsLedgerExcel(); return; }
  const { it, rows: moves } = getItemMovesWithBalance(id);
  if(!it){ showAppAlert('اختر صنفًا أولاً.'); return; }
  const bounds = computeLedgerPeriodBounds();
  const filteredMoves = filterMovesByPeriod(moves, bounds);
  if(filteredMoves.length===0){ showAppAlert('لا توجد حركات في هذه الفترة لتصديرها.'); return; }

  const totalIn = filteredMoves.filter(m=>m.type==='in').reduce((s,m)=>s+m.qty,0);
  const totalOut = filteredMoves.filter(m=>m.type==='out').reduce((s,m)=>s+m.qty,0);
  const c = computeConsumptionTrend(it, moves);
  const consumptionText = c.hasConsumption
    ? ('متوقع نفاذ الرصيد خلال ~' + (Math.round(c.daysLeft*10)/10) + ' يوم (بمعدّل ' + (Math.round(c.avgPerDay*100)/100) + ' ' + (it.unit||'') + '/يوم آخر 30 يوم)')
    : 'لا يوجد استهلاك حديث (آخر 30 يوم) لهذا الصنف';

  const summaryRows = [{
    'اسم الصنف': it.name,
    'المخزن': STORE_LABELS[it.store] || it.store,
    'الوحدة': it.unit,
    'الرصيد الحالي': it.balance,
    'الحد الأدنى للتنبيه': it.min || 0,
    'الفترة المعروضة': ledgerPeriodLabel(bounds),
    'إجمالي الوارد': totalIn,
    'إجمالي الصادر': totalOut,
    'صافي التغيّر': totalIn - totalOut,
    'عدد الحركات': filteredMoves.length,
    'اتجاه الاستهلاك': consumptionText,
    'تاريخ التصدير': todayStr()
  }];
  const rows = filteredMoves.map(m=>({
    'التاريخ': m.date,
    'رقم السند': m.number,
    'النوع': m.type==='in' ? 'وارد' : 'صادر',
    'الكمية': m.type==='in' ? m.qty : -m.qty,
    'الرصيد بعد الحركة': m.balanceAfter
  }));

  try{
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary['!cols'] = [ {wch:22},{wch:18},{wch:10},{wch:14},{wch:16},{wch:22},{wch:14},{wch:14},{wch:14},{wch:12},{wch:46},{wch:14} ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص');
    const wsDetail = XLSX.utils.json_to_sheet(rows);
    wsDetail['!cols'] = [ {wch:12},{wch:16},{wch:10},{wch:12},{wch:18} ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'كشف الحركة');
    XLSX.writeFile(wb, 'كشف-حركة-' + it.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g,'_') + '-' + todayStr() + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

function currentMonthStr(){ return todayStr().slice(0,7); }

function vouchersInMonth(monthStr){
  return DB.vouchers.filter(v=> (v.date||'').slice(0,7) === monthStr);
}

function shiftMonthStr(monthStr, delta){
  const parts = monthStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1]-1+delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function itemBalanceAtMonthEnd(itemId, monthStr){
  const it = findItem(itemId);
  if(!it) return null;
  let future = 0;
  DB.vouchers.forEach(v=>{
    const vMonth = (v.date||'').slice(0,7);
    if(vMonth > monthStr){
      v.lines.forEach(l=>{
        if(l.itemId === itemId) future += (v.type==='in' ? l.qty : -l.qty);
      });
    }
  });
  return it.balance - future;
}

document.getElementById('reportMonth').addEventListener('change', renderMonthlyReport);
document.getElementById('reportPrevMonthBtn').addEventListener('click', ()=>{
  const cur = document.getElementById('reportMonth').value || currentMonthStr();
  document.getElementById('reportMonth').value = shiftMonthStr(cur, -1);
  renderMonthlyReport();
});
document.getElementById('reportThisMonthBtn').addEventListener('click', ()=>{
  document.getElementById('reportMonth').value = currentMonthStr();
  renderMonthlyReport();
});
document.getElementById('reportFilterStore').addEventListener('change', renderMonthlyReport);
document.getElementById('reportSearch').addEventListener('input', renderMonthlyReport);

function reportDeltaHtml(cur, prev){
  if(prev === 0){
    if(cur === 0) return '<span style="font-size:11px;opacity:.8;">— بدون بيانات مقارنة</span>';
    return '<span style="font-size:11px;opacity:.9;">جديد عن الشهر السابق</span>';
  }
  const d = Math.round(((cur-prev)/prev)*100);
  const sign = d>0?'+':'';
  return `<span style="font-size:11px;opacity:.9;">${sign}${d}% عن الشهر السابق</span>`;
}

function renderMonthlyReport(){
  const monthStr = document.getElementById('reportMonth').value || currentMonthStr();
  const prevMonthStr = shiftMonthStr(monthStr, -1);
  const list = vouchersInMonth(monthStr);
  const prevList = vouchersInMonth(prevMonthStr);
  const storeKeys = Object.keys(STORE_LABELS);

  const cardsEl = document.getElementById('reportStoreCards');
  cardsEl.innerHTML = storeKeys.map(s=>{
    const inVouchers = list.filter(v=>v.type==='in' && v.lines.some(l=>l.store===s));
    const outVouchers = list.filter(v=>v.type==='out' && v.lines.some(l=>l.store===s));
    const qtyIn = list.filter(v=>v.type==='in').reduce((sum,v)=> sum + v.lines.filter(l=>l.store===s).reduce((a,l)=>a+l.qty,0), 0);
    const qtyOut = list.filter(v=>v.type==='out').reduce((sum,v)=> sum + v.lines.filter(l=>l.store===s).reduce((a,l)=>a+l.qty,0), 0);
    const prevQtyIn = prevList.filter(v=>v.type==='in').reduce((sum,v)=> sum + v.lines.filter(l=>l.store===s).reduce((a,l)=>a+l.qty,0), 0);
    const prevQtyOut = prevList.filter(v=>v.type==='out').reduce((sum,v)=> sum + v.lines.filter(l=>l.store===s).reduce((a,l)=>a+l.qty,0), 0);
    return `<div class="store-card ${s}">
      <div class="tag">${s.toUpperCase()}</div>
      <h3>${STORE_LABELS[s]}</h3>
      <div class="stat-row"><span>سندات التوريد</span><b data-count="${inVouchers.length}">0</b></div>
      <div class="stat-row"><span>سندات الصرف</span><b data-count="${outVouchers.length}">0</b></div>
      <div class="stat-row"><span>إجمالي الكمية الواردة</span><b class="mono">${fmtNum(qtyIn)}</b></div>
      <div class="stat-row" style="margin-top:-2px;margin-bottom:6px;justify-content:flex-end;">${reportDeltaHtml(qtyIn, prevQtyIn)}</div>
      <div class="stat-row"><span>إجمالي الكمية الصادرة</span><b class="mono">${fmtNum(qtyOut)}</b></div>
      <div class="stat-row" style="margin-top:-2px;justify-content:flex-end;">${reportDeltaHtml(qtyOut, prevQtyOut)}</div>
    </div>`;
  }).join('');
  animateCounters(cardsEl);

  const inParties = {};
  list.filter(v=>v.type==='in' && v.party).forEach(v=>{ inParties[v.party] = (inParties[v.party]||0)+1; });
  const outParties = {};
  list.filter(v=>v.type==='out' && v.party).forEach(v=>{ outParties[v.party] = (outParties[v.party]||0)+1; });
  const topIn = Object.entries(inParties).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topOut = Object.entries(outParties).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const activeItems = new Set(list.flatMap(v=>v.lines.map(l=> l.itemId || l.name))).size;

  const partyRow = (name,count)=> `<div class="stat-row" style="color:var(--ink);"><span class="wrap-cell" style="max-width:70%;">${escapeHtml(name)}</span><b class="mono">${count}</b></div>`;
  document.getElementById('reportPartiesCards').innerHTML = `
    <div class="card">
      <h3 style="font-family:var(--font-display);font-size:14px;margin:0 0 10px;">أكثر الموردين توريدًا</h3>
      ${topIn.length ? topIn.map(x=>partyRow(x[0],x[1])).join('') : '<p style="font-size:12.5px;color:var(--ink-soft);margin:0;">لا توجد بيانات لهذا الشهر.</p>'}
    </div>
    <div class="card">
      <h3 style="font-family:var(--font-display);font-size:14px;margin:0 0 10px;">أكثر الجهات استلامًا</h3>
      ${topOut.length ? topOut.map(x=>partyRow(x[0],x[1])).join('') : '<p style="font-size:12.5px;color:var(--ink-soft);margin:0;">لا توجد بيانات لهذا الشهر.</p>'}
    </div>
    <div class="card">
      <h3 style="font-family:var(--font-display);font-size:14px;margin:0 0 10px;">ملخص الشهر</h3>
      <div class="stat-row" style="color:var(--ink);"><span>إجمالي السندات</span><b class="mono">${list.length}</b></div>
      <div class="stat-row" style="color:var(--ink);"><span>أصناف تحرّكت</span><b class="mono">${activeItems}</b></div>
    </div>
  `;

  const filterStore = document.getElementById('reportFilterStore').value;
  const q = document.getElementById('reportSearch').value.trim().toLowerCase();

  const totals = {};
  list.forEach(v=>{
    v.lines.forEach(l=>{
      const key = (l.itemId || l.name) + '||' + l.store;
      if(!totals[key]) totals[key] = { itemId:l.itemId, name:l.name, store:l.store, unit:l.unit, in:0, out:0 };
      if(v.type==='in') totals[key].in += l.qty; else totals[key].out += l.qty;
    });
  });
  let rows = Object.values(totals);
  if(filterStore !== 'all') rows = rows.filter(r=> r.store === filterStore);
  if(q) rows = rows.filter(r=> r.name.toLowerCase().includes(q));
  rows.sort((a,b)=> (b.in+b.out) - (a.in+a.out));

  const tbody = document.querySelector('#reportItemsTable tbody');
  if(rows.length===0){
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon"><i class="fa-solid fa-chart-column"></i></div>لا توجد أي حركة مطابقة لهذا الشهر.</div></td></tr>';
  } else {
    tbody.innerHTML = rows.map(r=>{
      const net = r.in - r.out;
      const endBal = r.itemId ? itemBalanceAtMonthEnd(r.itemId, monthStr) : null;
      return `<tr>
        <td class="wrap-cell" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td>
        <td class="wrap-cell" title="${STORE_LABELS[r.store]||r.store}"><span class="pill pill-store-${r.store}" style="white-space:nowrap;">${STORE_SHORT[r.store]||STORE_LABELS[r.store]||r.store}</span></td>
        <td>${escapeHtml(r.unit)}</td>
        <td class="mono mono-cell">${fmtNum(r.in)}</td>
        <td class="mono mono-cell">${fmtNum(r.out)}</td>
        <td class="mono mono-cell ${net<0?'neg-flag':''}">${net>=0?'+':''}${fmtNum(net)}</td>
        <td class="mono mono-cell">${endBal===null ? '-' : fmtNum(endBal)}</td>
      </tr>`;
    }).join('');
  }
}

document.getElementById('reportExportBtn').addEventListener('click', ()=>{
  const monthStr = document.getElementById('reportMonth').value || currentMonthStr();
  const list = vouchersInMonth(monthStr);
  if(list.length===0){ showAppAlert('لا توجد بيانات مسجّلة لهذا الشهر.'); return; }

  const storeKeys = Object.keys(STORE_LABELS);
  const summaryRows = storeKeys.map(s=>{
    const qtyIn = list.filter(v=>v.type==='in').reduce((sum,v)=> sum + v.lines.filter(l=>l.store===s).reduce((a,l)=>a+l.qty,0), 0);
    const qtyOut = list.filter(v=>v.type==='out').reduce((sum,v)=> sum + v.lines.filter(l=>l.store===s).reduce((a,l)=>a+l.qty,0), 0);
    return {
      'المخزن': STORE_LABELS[s],
      'سندات التوريد': list.filter(v=>v.type==='in' && v.lines.some(l=>l.store===s)).length,
      'سندات الصرف': list.filter(v=>v.type==='out' && v.lines.some(l=>l.store===s)).length,
      'إجمالي الوارد': qtyIn,
      'إجمالي الصادر': qtyOut,
      'صافي التغيّر': qtyIn - qtyOut
    };
  });

  const totals = {};
  list.forEach(v=>{
    v.lines.forEach(l=>{
      const key = (l.itemId || l.name) + '||' + l.store;
      if(!totals[key]) totals[key] = { itemId:l.itemId, name:l.name, store:l.store, unit:l.unit, in:0, out:0 };
      if(v.type==='in') totals[key].in += l.qty; else totals[key].out += l.qty;
    });
  });
  const detailRows = Object.values(totals).map(r=>{
    const endBal = r.itemId ? itemBalanceAtMonthEnd(r.itemId, monthStr) : '-';
    return {
      'الصنف': r.name,
      'المخزن': STORE_LABELS[r.store] || r.store,
      'الوحدة': r.unit,
      'إجمالي الوارد': r.in,
      'إجمالي الصادر': r.out,
      'صافي التغيّر': r.in - r.out,
      'الرصيد بنهاية الشهر': endBal
    };
  });

  const inParties = {};
  list.filter(v=>v.type==='in' && v.party).forEach(v=>{ inParties[v.party] = (inParties[v.party]||0)+1; });
  const outParties = {};
  list.filter(v=>v.type==='out' && v.party).forEach(v=>{ outParties[v.party] = (outParties[v.party]||0)+1; });
  const partiesRows = [
    ...Object.entries(inParties).map(([name,count])=>({ 'النوع':'مورّد (وارد)', 'الاسم':name, 'عدد السندات':count })),
    ...Object.entries(outParties).map(([name,count])=>({ 'النوع':'جهة مستلمة (صادر)', 'الاسم':name, 'عدد السندات':count }))
  ];

  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'ملخص المخازن');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'تفاصيل الأصناف');
    if(partiesRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(partiesRows), 'الموردين والجهات');
    XLSX.writeFile(wb, 'تقرير-' + monthStr + '.xlsx');
  }catch(e){
    showErr('تعذر إنشاء ملف Excel.', e);
  }
});

function renderAll(){
  renderDashboard();
  renderItemsTable();
  renderLogTable();
  renderLedgerSelect();
  renderMonthlyReport();
  renderMyRequestsTable();
  renderIncomingRequestsTable();
  renderInvoicesTable();
  renderQualityTable();
  renderWorkersTable();
  renderAttendanceGrid();
  renderAttendanceLog();
  renderClosePeriodSummary();
  refreshAllLineDatalists('inLinesTable');
  refreshAllLineDatalists('outLinesTable');
  if(typeof renderItemsStats === 'function') renderItemsStats();
  if(typeof renderQualityStats === 'function') renderQualityStats();
  if(typeof renderInvoicesStats === 'function') renderInvoicesStats();
  if(typeof renderSettingsStats === 'function') renderSettingsStats();
  if(typeof renderLogStats === 'function') renderLogStats();
  if(typeof renderInventoryHistory === 'function') renderInventoryHistory();
  if(typeof renderInventoryStats === 'function') renderInventoryStats();
}

document.getElementById('inDate').value = todayStr();
document.getElementById('outDate').value = todayStr();
document.getElementById('reportMonth').value = currentMonthStr();
document.getElementById('reqDate').value = todayStr();
document.getElementById('qcDate').value = todayStr();
document.getElementById('invDate').value = todayStr();
document.getElementById('attendanceDate').value = todayStr();
document.getElementById('attendanceLogMonth').value = currentMonthStr();

function renderClosePeriodSummary(){
  const el = document.getElementById('closePeriodSummary');
  if(!el) return;
  const open = DB.vouchers.filter(v=>!v.closed);
  if(open.length===0){
    el.textContent = 'لا توجد سندات مفتوحة حاليًا للإقفال.';
    return;
  }
  const inCount = open.filter(v=>v.type==='in').length;
  const outCount = open.filter(v=>v.type==='out').length;
  const dates = open.map(v=>v.date).filter(Boolean).sort();
  const from = dates[0], to = dates[dates.length-1];
  el.innerHTML = `السندات المفتوحة حاليًا: <b>${open.length}</b> (${inCount} توريد، ${outCount} صرف)${from?` — من ${fmtDate(from)} إلى ${fmtDate(to)}`:''}`;
}

document.getElementById('closePeriodBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const open = DB.vouchers.filter(v=>!v.closed);
  if(open.length===0){ showAppAlert('لا توجد سندات مفتوحة حاليًا للإقفال.'); return; }
  const inCount = open.filter(v=>v.type==='in').length;
  const outCount = open.filter(v=>v.type==='out').length;
  if(!confirm(
    'سيتم إقفال '+open.length+' سند ('+inCount+' توريد، '+outCount+' صرف) وتحويلها لأرشيف دائم.\n'+
    'بعد الإقفال لن تقدر تعدّلها أو تحذفها أبدًا، وسجل السندات (المفتوح) بيرجع فاضي ويبدأ من جديد.\n'+
    'أرصدة الأصناف لن تتأثر إطلاقًا. متابعة؟'
  )) return;

  const btn = document.getElementById('closePeriodBtn');
  busy = true; btn.disabled = true;
  try{
    const { error } = await sb.from('vouchers')
      .update({ closed:true, closed_at: new Date().toISOString() })
      .eq('closed', false);
    if(error) throw error;
    await loadDB();
    if(typeof showMonthCertificate === 'function'){
      showMonthCertificate(open, inCount, outCount);
    } else {
      showAppAlert('تم إقفال '+open.length+' سند بنجاح وترحيلها للأرشيف. سجل السندات المفتوح صار فاضي ويبدأ من جديد.');
    }
  }catch(e){
    showErr('تعذر إقفال الشهر الحالي. تأكد إنك أضفت عمودي closed و closed_at لجدول vouchers بقاعدة البيانات.', e);
  }
  busy = false; btn.disabled = false;
});

document.getElementById('mergeDuplicatesBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const groups = {};
  DB.items.forEach(it=>{
    const key = it.store + '||' + normName(it.name);
    if(!groups[key]) groups[key] = [];
    groups[key].push(it);
  });
  const dupGroups = Object.values(groups).filter(g=> g.length>1);
  if(dupGroups.length===0){ showAppAlert('ما فيه أصناف مكررة حاليًا.'); return; }

  const preview = dupGroups.map(g=> g[0].name + ' ('+STORE_LABELS[g[0].store]+') — ' + g.length + ' نسخ').join('\n');
  if(!confirm('تم العثور على '+dupGroups.length+' صنف مكرر:\n\n'+preview+'\n\nسيتم دمجها في نسخة واحدة لكل صنف مع جمع أرصدتها. متابعة؟')) return;

  busy = true;
  try{
    for(const g of dupGroups){
      const survivor = g[0];
      let mergedBalance = survivor.balance;
      let mergedMin = survivor.min||0;
      for(let i=1;i<g.length;i++){
        mergedBalance = Math.round((mergedBalance + g[i].balance)*100)/100;
        mergedMin = Math.max(mergedMin, g[i].min||0);
        const { error: rpErr } = await sb.from('voucher_lines').update({ item_id: survivor.id }).eq('item_id', g[i].id);
        if(rpErr) throw rpErr;
        const { error: delErr } = await sb.from('items').delete().eq('id', g[i].id);
        if(delErr) throw delErr;
      }
      const { error: upErr } = await sb.from('items').update({ balance:mergedBalance, min_qty:mergedMin }).eq('id', survivor.id);
      if(upErr) throw upErr;
    }
    await loadDB();
    showAppAlert('تم دمج '+dupGroups.length+' صنف مكرر بنجاح.');
  }catch(e){
    showErr('تعذر دمج بعض الأصناف المكررة.', e);
    await loadDB();
  }
  busy = false;
});

document.getElementById('resetBalancesBtn').addEventListener('click', async ()=>{
  if(busy) return;
  if(DB.items.length===0){ showAppAlert('لا توجد أصناف حاليًا.'); return; }
  if(!confirm('سيتم تصفير رصيد كل الأصناف إلى صفر، مع الإبقاء على أسماء الأصناف وسجل السندات. متابعة؟')) return;
  busy = true;
  try{
    const { error } = await sb.from('items').update({ balance:0 }).not('id','is',null);
    if(error) throw error;
    await loadDB();
    showAppAlert('تم تصفير كل الأرصدة.');
  }catch(e){ showErr('تعذر تصفير الأرصدة.', e); }
  busy = false;
});

document.getElementById('resetVouchersBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const openVouchers = DB.vouchers.filter(v=>!v.closed);
  const closedCount = DB.vouchers.length - openVouchers.length;
  if(openVouchers.length===0){
    showAppAlert(closedCount>0
      ? 'لا توجد سندات مفتوحة للحذف. يوجد '+closedCount+' سند مقفل (مؤرشف) وهي محمية ولن تُحذف.'
      : 'لا توجد سندات حاليًا.');
    return;
  }
  if(!confirm(
    'سيتم حذف '+openVouchers.length+' سند مفتوح (غير مقفل) نهائيًا.'+
    (closedCount>0 ? ' يوجد '+closedCount+' سند مقفل (مؤرشف) محمي تمامًا ولن يتأثر.' : '')+
    ' الأصناف وأرصدتها الحالية ستبقى كما هي. متابعة؟'
  )) return;
  busy = true;
  try{
    const { error } = await sb.from('vouchers').delete().eq('closed', false);
    if(error) throw error;
    await loadDB();
    showAppAlert('تم حذف السندات المفتوحة. السندات المقفلة (الأرشيف) بقيت محفوظة كما هي.');
  }catch(e){ showErr('تعذر حذف سجل السندات.', e); }
  busy = false;
});

document.getElementById('resetItemsBtn').addEventListener('click', async ()=>{
  if(busy) return;
  if(DB.items.length===0){ showAppAlert('لا توجد أصناف حاليًا.'); return; }
  if(!confirm('سيتم حذف كل الأصناف من المخازن الثلاثة نهائيًا. سجل السندات القديم سيبقى كأرشيف فقط. متابعة؟')) return;
  busy = true;
  try{
    const { error } = await sb.from('items').delete().not('id','is',null);
    if(error) throw error;
    await loadDB();
    showAppAlert('تم حذف كل الأصناف.');
  }catch(e){ showErr('تعذر حذف كل الأصناف.', e); }
  busy = false;
});

const fullResetInput = document.getElementById('fullResetConfirmInput');
const fullResetBtn = document.getElementById('fullResetBtn');
fullResetInput.addEventListener('input', ()=>{
  fullResetBtn.disabled = fullResetInput.value.trim() !== 'حذف الكل';
});
fullResetBtn.addEventListener('click', async ()=>{
  if(busy) return;
  if(fullResetInput.value.trim() !== 'حذف الكل') return;
  const closedCount = DB.vouchers.filter(v=>v.closed).length;
  if(!confirm(
    'تأكيد أخير: سيتم حذف كل الأصناف وكل السندات المفتوحة (غير المقفلة) نهائيًا ولا يمكن التراجع.'+
    (closedCount>0 ? ' يوجد '+closedCount+' سند مقفل (أرشيف شهري) محمي تمامًا ولن يُحذف.' : '')+
    ' متابعة؟'
  )) return;
  busy = true;
  try{
    const { error: e1 } = await sb.from('vouchers').delete().eq('closed', false);
    if(e1) throw e1;
    const { error: e2 } = await sb.from('items').delete().not('id','is',null);
    if(e2) throw e2;
    await loadDB();
    fullResetInput.value = '';
    fullResetBtn.disabled = true;
    showAppAlert('تمت إعادة التعيين. السندات المقفلة (الأرشيف) بقيت محفوظة كما هي.');
  }catch(e){ showErr('تعذرت إعادة التعيين الشاملة.', e); }
  busy = false;
});

const ATTENDANCE_STATUS_LABELS = { present:'حاضر', absent:'غائب' };

function findWorker(id){ return DB.workers.find(w=>w.id===id); }

document.getElementById('addWorkerBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const name = document.getElementById('newWorkerName').value.trim();
  const job = document.getElementById('newWorkerJob').value.trim();
  if(!name){ showAppAlert('الرجاء إدخال اسم العامل.'); return; }
  busy = true;
  try{
    const { error } = await sb.from('workers').insert({ name, job_title: job||null, active:true });
    if(error) throw error;
    document.getElementById('newWorkerName').value = '';
    document.getElementById('newWorkerJob').value = '';
    await loadDB();
  }catch(e){ showErr('تعذرت إضافة العامل.', e); }
  busy = false;
});

function renderWorkersTable(){
  const tbody = document.querySelector('#workersTable tbody');
  if(!tbody) return;
  if(DB.workers.length===0){
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="icon"><i class="fa-solid fa-helmet-safety"></i></div>لا يوجد عمال مسجّلين بعد.</div></td></tr>';
    return;
  }
  tbody.innerHTML = DB.workers.slice().sort((a,b)=> a.name.localeCompare(b.name,'ar')).map(w=>`
    <tr>
      <td>${escapeHtml(w.name)}</td>
      <td>${escapeHtml(w.jobTitle||'-')}</td>
      <td><button class="btn-danger-outline btn-sm" data-del-worker="${w.id}">حذف</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-del-worker]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(busy) return;
      if(!confirm('حذف هذا العامل؟ سجل الحضور القديم الخاص فيه يبقى محفوظًا.')) return;
      busy = true;
      try{
        const { error } = await sb.from('workers').delete().eq('id', btn.dataset.delWorker);
        if(error) throw error;
        await loadDB();
      }catch(e){ showErr('تعذر حذف العامل.', e); }
      busy = false;
    });
  });
}

function renderAttendanceGrid(){
  const tbody = document.querySelector('#attendanceGridTable tbody');
  if(!tbody) return;
  const date = document.getElementById('attendanceDate').value || todayStr();
  if(DB.workers.length===0){
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="icon"><i class="fa-solid fa-helmet-safety"></i></div>أضف عمال أولاً من الأعلى.</div></td></tr>';
    return;
  }
  const list = DB.workers.slice().sort((a,b)=> a.name.localeCompare(b.name,'ar'));
  tbody.innerHTML = list.map(w=>{
    const rec = DB.attendance.find(a=> a.workerId===w.id && a.date===date);
    const status = rec ? rec.status : 'present';
    return `<tr data-worker-row="${w.id}">
      <td>${escapeHtml(w.name)}</td>
      <td>${escapeHtml(w.jobTitle||'-')}</td>
      <td>
        <select class="attendance-status-select" data-worker-status="${w.id}">
          <option value="present" ${status==='present'?'selected':''}>حاضر</option>
          <option value="absent" ${status==='absent'?'selected':''}>غائب</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

document.getElementById('attendanceDate').addEventListener('change', renderAttendanceGrid);
document.getElementById('attendanceTodayBtn').addEventListener('click', ()=>{
  document.getElementById('attendanceDate').value = todayStr();
  renderAttendanceGrid();
});
document.getElementById('markAllPresentBtn').addEventListener('click', ()=>{
  document.querySelectorAll('#attendanceGridTable [data-worker-status]').forEach(sel=> sel.value='present');
});

document.getElementById('saveAttendanceBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const date = document.getElementById('attendanceDate').value || todayStr();
  const rows = document.querySelectorAll('#attendanceGridTable [data-worker-status]');
  if(rows.length===0){ showAppAlert('لا يوجد عمال لتسجيل حضورهم.'); return; }
  const payload = Array.from(rows).map(sel=>({
    worker_id: sel.dataset.workerStatus,
    attendance_date: date,
    status: sel.value
  }));
  busy = true;
  const btn = document.getElementById('saveAttendanceBtn');
  btn.disabled = true;
  try{
    const { error } = await sb.from('attendance').upsert(payload, { onConflict: 'worker_id,attendance_date' });
    if(error) throw error;
    await loadDB();
    showAppAlert('تم حفظ تحضير يوم ' + fmtDate(date) + ' بنجاح.');
  }catch(e){ showErr('تعذر حفظ التحضير.', e); }
  busy = false; btn.disabled = false;
});

function renderAttendanceLog(){
  const tbody = document.querySelector('#attendanceLogTable tbody');
  if(!tbody) return;
  const month = document.getElementById('attendanceLogMonth').value;
  const q = document.getElementById('attendanceLogSearch').value.trim().toLowerCase();
  let list = DB.attendance.slice();
  if(month) list = list.filter(a=> (a.date||'').slice(0,7) === month);
  if(q) list = list.filter(a=>{
    const w = findWorker(a.workerId);
    return w && w.name.toLowerCase().includes(q);
  });
  list.sort((a,b)=> (b.date||'').localeCompare(a.date||''));

  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="icon"><i class="fa-solid fa-clipboard-list"></i></div>لا توجد سجلات حضور مطابقة.</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(a=>{
    const w = findWorker(a.workerId);
    const cls = a.status==='present' ? 'pill-in' : 'pill-out';
    return `<tr>
      <td>${fmtDate(a.date)}</td>
      <td>${w ? escapeHtml(w.name) : '(عامل محذوف)'}</td>
      <td>${w ? escapeHtml(w.jobTitle||'-') : '-'}</td>
      <td><span class="pill ${cls}">${ATTENDANCE_STATUS_LABELS[a.status]||a.status}</span></td>
    </tr>`;
  }).join('');
}
document.getElementById('attendanceLogMonth').addEventListener('change', renderAttendanceLog);
document.getElementById('attendanceLogSearch').addEventListener('input', renderAttendanceLog);

document.getElementById('exportAttendanceExcelBtn').addEventListener('click', ()=>{
  const month = document.getElementById('attendanceLogMonth').value;
  const q = document.getElementById('attendanceLogSearch').value.trim().toLowerCase();
  let list = DB.attendance.slice();
  if(month) list = list.filter(a=> (a.date||'').slice(0,7) === month);
  if(q) list = list.filter(a=>{
    const w = findWorker(a.workerId);
    return w && w.name.toLowerCase().includes(q);
  });
  if(list.length===0){ showAppAlert('لا توجد سجلات لتصديرها حسب الفلترة الحالية.'); return; }
  list.sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  const rows = list.map(a=>{
    const w = findWorker(a.workerId);
    return {
      'التاريخ': a.date,
      'الاسم': w ? w.name : '(عامل محذوف)',
      'الوظيفة': w ? (w.jobTitle||'') : '',
      'الحالة': ATTENDANCE_STATUS_LABELS[a.status] || a.status
    };
  });
  try{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الحضور');
    XLSX.writeFile(wb, 'حضور-العمال-' + todayStr() + '.xlsx');
  }catch(e){ showErr('تعذر إنشاء ملف Excel.', e); }
});

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============ الجرد (Inventory Count) ============ */
document.getElementById('invCountDate').value = todayStr();

function invVarianceHtml(systemQty, countedQty){
  const diff = Math.round((countedQty - systemQty) * 100) / 100;
  const cls = diff===0 ? 'zero' : (diff>0 ? 'pos' : 'neg');
  const sign = diff>0 ? '+' : '';
  return '<span class="inv-variance '+cls+'">'+sign+fmtNum(diff)+'</span>';
}

document.getElementById('startInventoryCountBtn').addEventListener('click', ()=>{
  const storeFilter = document.getElementById('invCountStore').value;
  let items = DB.items.slice();
  if(storeFilter !== 'all') items = items.filter(i=> i.store===storeFilter);
  items.sort((a,b)=> (a.store+a.name).localeCompare(b.store+b.name, 'ar'));

  if(items.length===0){ showAppAlert('لا توجد أصناف مطابقة لهذا المخزن.'); return; }

  const tbody = document.querySelector('#inventoryCountTable tbody');
  tbody.innerHTML = items.map(i=>`<tr data-item-id="${i.id}">
    <td class="wrap-cell" data-label="الصنف">${escapeHtml(i.name)}</td>
    <td data-label="المخزن"><span class="pill pill-store-${i.store}">${STORE_LABELS[i.store]}</span></td>
    <td data-label="الوحدة">${escapeHtml(i.unit)}</td>
    <td class="mono mono-cell" data-label="الرصيد بالنظام">${fmtNum(i.balance)}</td>
    <td data-label="الكمية الفعلية"><input type="number" step="any" class="inv-counted-input" value="${i.balance}" data-system="${i.balance}"></td>
    <td data-label="الفرق" class="inv-var-cell">${invVarianceHtml(i.balance, i.balance)}</td>
  </tr>`).join('');

  tbody.querySelectorAll('.inv-counted-input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const system = parseFloat(inp.dataset.system) || 0;
      const counted = parseFloat(inp.value);
      const cell = inp.closest('tr').querySelector('.inv-var-cell');
      cell.innerHTML = invVarianceHtml(system, isNaN(counted) ? system : counted);
    });
  });

  document.getElementById('inventoryCountArea').style.display = 'block';
  document.getElementById('inventoryCountArea').scrollIntoView({behavior:'smooth', block:'nearest'});
});

document.getElementById('cancelInventoryCountBtn').addEventListener('click', ()=>{
  document.getElementById('inventoryCountArea').style.display = 'none';
  document.querySelector('#inventoryCountTable tbody').innerHTML = '';
  document.getElementById('invCountNotes').value = '';
});

document.getElementById('saveInventoryCountBtn').addEventListener('click', async ()=>{
  if(busy) return;
  const date = document.getElementById('invCountDate').value || todayStr();
  const storeFilter = document.getElementById('invCountStore').value;
  const notes = document.getElementById('invCountNotes').value.trim();

  const rows = Array.from(document.querySelectorAll('#inventoryCountTable tbody tr')).map(tr=>{
    const itemId = tr.dataset.itemId;
    const it = findItem(itemId);
    const input = tr.querySelector('.inv-counted-input');
    const counted = parseFloat(input.value);
    return {
      itemId, name: it ? it.name : '', store: it ? it.store : '', unit: it ? it.unit : '',
      systemQty: it ? it.balance : 0,
      countedQty: isNaN(counted) ? (it ? it.balance : 0) : counted
    };
  });
  if(rows.length===0){ showAppAlert('ابدأ الجرد أولاً قبل الحفظ.'); return; }

  const btn = document.getElementById('saveInventoryCountBtn');
  busy = true; btn.disabled = true;
  try{
    const { data: created, error: cErr } = await sb.from('inventory_counts')
      .insert({ count_date: date, store: storeFilter==='all' ? null : storeFilter, notes: notes||null, created_by: currentUserEmail||null })
      .select().single();
    if(cErr) throw cErr;

    const linesPayload = rows.map(r=>({
      count_id: created.id, item_id: r.itemId, item_name: r.name, store: r.store, unit: r.unit,
      system_qty: r.systemQty, counted_qty: r.countedQty
    }));
    const { error: lErr } = await sb.from('inventory_count_lines').insert(linesPayload);
    if(lErr) throw lErr;

    const varianceCount = rows.filter(r=> Math.round((r.countedQty-r.systemQty)*100)/100 !== 0).length;
    document.getElementById('inventoryCountArea').style.display = 'none';
    document.querySelector('#inventoryCountTable tbody').innerHTML = '';
    document.getElementById('invCountNotes').value = '';
    await loadDB();
    showAppAlert(varianceCount===0
      ? 'تم حفظ الجرد — كل الأرصدة مطابقة، ما فيه أي فرق. <i class="fa-solid fa-champagne-glasses"></i>'
      : 'تم حفظ الجرد. فيه '+varianceCount+' صنف بينهم فرق عن رصيد النظام — افتح "عرض" من سجل الجرد لمراجعتها وتطبيق التعديل على الأرصدة.');
  }catch(e){
    showErr('تعذر حفظ الجرد. تأكد إنك شغّلت SQL إنشاء جداول الجرد بلوحة تحكم Supabase.', e);
  }
  busy = false; btn.disabled = false;
});

function renderInventoryHistory(){
  const tbody = document.querySelector('#inventoryHistoryTable tbody');
  if(!tbody) return;
  const list = DB.inventoryCounts.slice().sort((a,b)=> b.createdAt - a.createdAt);
  if(list.length===0){
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-calculator"></i></div>ما فيه عمليات جرد مسجّلة بعد.</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c=>{
    const varianceCount = c.lines.filter(l=> Math.round((l.countedQty-l.systemQty)*100)/100 !== 0).length;
    return `<tr>
      <td data-label="التاريخ">${fmtDate(c.date)}</td>
      <td data-label="المخزن">${c.store ? `<span class="pill pill-store-${c.store}">${STORE_LABELS[c.store]}</span>` : 'كل المخازن'}</td>
      <td class="mono mono-cell" data-label="عدد الأصناف">${c.lines.length}</td>
      <td class="mono mono-cell" data-label="الفروقات">${varianceCount}</td>
      <td data-label="الحالة">${c.finalized ? '<span class="pill pill-in"><i class="fa-solid fa-circle-check"></i> مطبّق على الأرصدة</span>' : '<span class="pill pill-pending">لم يُطبّق بعد</span>'}</td>
      <td data-label=""><button class="btn-ghost btn-sm" data-view-count="${c.id}">عرض</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-view-count]').forEach(btn=>{
    btn.addEventListener('click', ()=> openInventoryDetail(btn.dataset.viewCount));
  });
}

let currentInventoryDetail = null;
function openInventoryDetail(id){
  const c = DB.inventoryCounts.find(x=>x.id===id);
  if(!c) return;
  currentInventoryDetail = c;
  const varianceLines = c.lines.filter(l=> Math.round((l.countedQty-l.systemQty)*100)/100 !== 0);
  const body = document.getElementById('inventoryDetailBody');
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span class="pill ${c.finalized?'pill-in':'pill-pending'}" style="font-size:13px;">${c.finalized?'<i class="fa-solid fa-circle-check"></i> مطبّق على الأرصدة':'لم يُطبّق بعد'}</span>
      <span class="mono" style="font-weight:700;">${fmtDate(c.date)}</span>
    </div>
    <p style="margin:4px 0;font-size:13px;"><b>المخزن:</b> ${c.store ? STORE_LABELS[c.store] : 'كل المخازن'}</p>
    ${c.notes ? `<p style="margin:4px 0;font-size:13px;"><b>ملاحظات:</b> ${escapeHtml(c.notes)}</p>` : ''}
    <table class="lines-table" style="margin-top:10px;">
      <thead><tr><th>الصنف</th><th>المخزن</th><th>بالنظام</th><th>الفعلي</th><th>الفرق</th></tr></thead>
      <tbody>
        ${c.lines.map(l=>`<tr>
          <td>${escapeHtml(l.name)}</td>
          <td><span class="pill pill-store-${l.store}">${STORE_LABELS[l.store]||'-'}</span></td>
          <td class="mono">${fmtNum(l.systemQty)}</td>
          <td class="mono">${fmtNum(l.countedQty)}</td>
          <td>${invVarianceHtml(l.systemQty, l.countedQty)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${!c.finalized && varianceLines.length>0 ? `
    <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px;">
      <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 8px;">فيه ${varianceLines.length} صنف بينهم فرق عن رصيد النظام. تقدر تحدّث أرصدة المخزون لتطابق الجرد الفعلي.</p>
      <button class="btn-in" id="applyInventoryAdjustBtn" style="width:100%;"><i class="fa-solid fa-circle-check"></i> تطبيق التعديلات على الأرصدة</button>
    </div>
    ` : ''}
  `;
  document.getElementById('inventoryDetailOverlay').classList.add('show');

  const applyBtn = document.getElementById('applyInventoryAdjustBtn');
  if(applyBtn){
    applyBtn.addEventListener('click', ()=> applyInventoryAdjustments(c));
  }
}
document.getElementById('closeInventoryDetail').addEventListener('click', ()=>{
  document.getElementById('inventoryDetailOverlay').classList.remove('show');
});

async function applyInventoryAdjustments(c){
  if(busy) return;
  const varianceLines = c.lines.filter(l=> Math.round((l.countedQty-l.systemQty)*100)/100 !== 0);
  if(!confirm('سيتم تحديث رصيد '+varianceLines.length+' صنف ليطابق الكمية الفعلية المجرودة. هذا التحديث مباشر على الأرصدة ولا يُنشئ سند حركة. متابعة؟')) return;

  busy = true;
  try{
    for(const l of varianceLines){
      if(!l.itemId) continue;
      const it = findItem(l.itemId);
      if(!it) continue;
      const { error: uErr } = await sb.from('items').update({ balance: l.countedQty }).eq('id', it.id);
      if(uErr) throw uErr;
      it.balance = l.countedQty;
    }
    const { error: fErr } = await sb.from('inventory_counts').update({ finalized:true }).eq('id', c.id);
    if(fErr) throw fErr;

    document.getElementById('inventoryDetailOverlay').classList.remove('show');
    await loadDB();
    showAppAlert('تم تحديث الأرصدة لتطابق الجرد الفعلي.');
  }catch(e){
    showErr('تعذر تطبيق التعديلات. لو تحدّث جزء من الأرصدة، راجع الأصناف قبل ما تعيد المحاولة.', e);
    await loadDB();
  }
  busy = false;
}

document.getElementById('exportInventoryDetailExcelBtn').addEventListener('click', ()=>{
  const c = currentInventoryDetail;
  if(!c){ showAppAlert('افتح تفاصيل جرد أولاً.'); return; }
  const rows = c.lines.map(l=>({
    'الصنف': l.name,
    'المخزن': STORE_LABELS[l.store] || l.store,
    'الوحدة': l.unit,
    'الرصيد بالنظام': l.systemQty,
    'الكمية الفعلية': l.countedQty,
    'الفرق': Math.round((l.countedQty-l.systemQty)*100)/100
  }));
  try{
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [ {wch:24},{wch:16},{wch:10},{wch:14},{wch:14},{wch:10} ];
    XLSX.utils.book_append_sheet(wb, ws, 'الجرد');
    XLSX.writeFile(wb, 'جرد-' + fmtDate(c.date).replace(/\//g,'-') + '.xlsx');
  }catch(e){ showErr('تعذر إنشاء ملف Excel.', e); }
});

function renderInventoryStats(){
  const el = document.getElementById('inventoryStatsStrip');
  if(!el) return;
  const list = DB.inventoryCounts;
  const total = list.length;
  const last = list.slice().sort((a,b)=> b.createdAt - a.createdAt)[0];
  const lastDate = last ? fmtDate(last.date) : '—';
  const lastVariance = last ? last.lines.filter(l=> Math.round((l.countedQty-l.systemQty)*100)/100 !== 0).length : 0;
  const notFinalized = list.filter(c=> !c.finalized && c.lines.some(l=> Math.round((l.countedQty-l.systemQty)*100)/100 !== 0)).length;
  el.innerHTML =
      kpiTile('kpi-items','<i class="fa-solid fa-calculator"></i>','عدد عمليات الجرد', total, true)
    + kpiTile('kpi-items','<i class="fa-solid fa-calendar-days"></i>','آخر جرد', lastDate, false)
    + kpiTile(lastVariance>0?'kpi-low':'kpi-in','<i class="fa-solid fa-scale-balanced"></i>','فروقات آخر جرد', lastVariance, true)
    + kpiTile(notFinalized>0?'kpi-low':'kpi-in','<i class="fa-solid fa-hourglass-half"></i>','جرد بانتظار التطبيق', notFinalized, true);
  animateCounters(el);
}

document.getElementById('newVoucherBtn').addEventListener('click', ()=>{
  document.getElementById('newVoucherOverlay').classList.add('show');
});
document.getElementById('closeNewVoucher').addEventListener('click', ()=>{
  document.getElementById('newVoucherOverlay').classList.remove('show');
});
document.getElementById('chooseVoucherIn').addEventListener('click', ()=>{
  document.getElementById('newVoucherOverlay').classList.remove('show');
  switchToTab('voucherIn');
});
document.getElementById('chooseVoucherOut').addEventListener('click', ()=>{
  document.getElementById('newVoucherOverlay').classList.remove('show');
  switchToTab('voucherOut');
});

function openGlobalSearch(){
  const overlay = document.getElementById('globalSearchOverlay');
  const input = document.getElementById('globalSearchInput');
  overlay.classList.add('show');
  input.value = '';
  renderGlobalSearchResults('');
  setTimeout(()=> input.focus(), 30);
}
document.getElementById('globalSearchBtn').addEventListener('click', openGlobalSearch);
document.getElementById('closeGlobalSearch').addEventListener('click', ()=>{
  document.getElementById('globalSearchOverlay').classList.remove('show');
});
document.getElementById('globalSearchInput').addEventListener('input', (e)=> renderGlobalSearchResults(e.target.value));

function renderGlobalSearchResults(q){
  q = (q||'').trim().toLowerCase();
  const resEl = document.getElementById('globalSearchResults');
  if(!q){
    resEl.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="icon"><i class="fa-solid fa-magnifying-glass"></i></div>اكتب اسم صنف، رقم سند، أو باركود...</div>';
    return;
  }
  const itemMatches = (DB.items||[]).filter(i=> i.name.toLowerCase().includes(q) || (i.barcode||'').toLowerCase().includes(q)).slice(0,8);
  const voucherMatches = (DB.vouchers||[]).filter(v=> v.number.toLowerCase().includes(q) || (v.party||'').toLowerCase().includes(q)).slice(0,8);

  let html = '';
  if(itemMatches.length){
    html += '<div style="font-size:11.5px;color:var(--ink-soft);font-weight:700;margin:6px 4px;">الأصناف</div>';
    html += itemMatches.map(i=> `
      <div class="profile-item" data-goto-item="${i.id}">
        <span class="ico"><i class="fa-solid fa-box"></i></span>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <div>${escapeHtml(i.name)}</div>
          <div style="font-size:11px;color:var(--ink-soft);">${STORE_LABELS[i.store]||i.store} · الرصيد: ${fmtNum(i.balance)} ${escapeHtml(i.unit)}</div>
        </div>
      </div>`).join('');
  }
  if(voucherMatches.length){
    html += '<div style="font-size:11.5px;color:var(--ink-soft);font-weight:700;margin:10px 4px 6px;">السندات</div>';
    html += voucherMatches.map(v=> `
      <div class="profile-item" data-goto-voucher="${v.id}">
        <span class="ico">${v.type==='in'?'<i class="fa-solid fa-inbox"></i>':'<i class="fa-solid fa-paper-plane"></i>'}</span>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <div class="mono">${v.number}</div>
          <div style="font-size:11px;color:var(--ink-soft);">${v.type==='in'?'سند توريد':'سند صرف'} · ${fmtDate(v.date)}</div>
        </div>
      </div>`).join('');
  }
  if(!itemMatches.length && !voucherMatches.length){
    html = '<div class="empty-state" style="padding:24px;"><div class="icon"><i class="fa-solid fa-magnifying-glass"></i></div>ما فيه نتائج مطابقة.</div>';
  }
  resEl.innerHTML = html;

  resEl.querySelectorAll('[data-goto-item]').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.getElementById('globalSearchOverlay').classList.remove('show');
      if(!switchToTab('items')) return;
      const filterSel = document.getElementById('itemsFilterStore');
      if(filterSel) filterSel.value = 'all';
      const searchBox = document.getElementById('itemsSearch');
      const item = DB.items.find(i=>i.id===el.dataset.gotoItem);
      if(searchBox && item){ searchBox.value = item.name; renderItemsTable(); }
    });
  });
  resEl.querySelectorAll('[data-goto-voucher]').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.getElementById('globalSearchOverlay').classList.remove('show');
      switchToTab('log');
      openVoucherDetail(el.dataset.gotoVoucher);
    });
  });
}

function openShortcutsHelp(){
  const rows = [
    ['/', 'فتح البحث الشامل'],
    ['Ctrl / Cmd + K', 'فتح البحث الشامل (بديل)'],
    ['n', 'سند جديد (توريد أو صرف)'],
    ['d', 'لوحة التحكم'],
    ['a', 'الأصناف'],
    ['i', 'سند توريد (وارد) مباشرة'],
    ['o', 'سند صرف (صادر) مباشرة'],
    ['s', 'سجل السندات'],
    ['l', 'الحركه اليوميه'],
    ['r', 'تقارير شهرية']
  ];
  if(document.querySelector('.tab[data-view="workforce"]')) rows.push(['w','تحضير العمال']);
  rows.push(['e','الإعدادات']);
  rows.push(['Esc','إغلاق أي نافذة مفتوحة']);
  rows.push(['?','عرض هذه القائمة']);
  document.getElementById('shortcutsHelpList').innerHTML = rows.map(([k,d])=>
    `<div class="shortcut-row"><span>${d}</span><kbd>${k}</kbd></div>`
  ).join('');
  document.getElementById('shortcutsHelpOverlay').classList.add('show');
}
document.getElementById('closeShortcutsHelp').addEventListener('click', ()=>{
  document.getElementById('shortcutsHelpOverlay').classList.remove('show');
});

document.getElementById('closeBrandList').addEventListener('click', ()=>{
  document.getElementById('brandListOverlay').classList.remove('show');
});

function renderBrandBalancesList(){
  const el = document.getElementById('brandBalancesList');
  const storeKeys = Object.keys(STORE_LABELS);
  let html = '';
  storeKeys.forEach(s=>{
    const items = getItemsByStore(s).slice().sort((a,b)=> a.name.localeCompare(b.name,'ar'));
    if(!items.length) return;
    html += `<div style="margin-bottom:14px;">
      <div style="font-family:var(--font-display);font-weight:700;font-size:12.5px;color:var(--ink-soft);margin-bottom:6px;">${STORE_LABELS[s]}</div>`;
    html += items.map(i=>{
      const low = i.min>0 && i.balance<=i.min;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(i.name)}">${escapeHtml(i.name)}</span>
        <b class="mono" style="flex-shrink:0;white-space:nowrap;direction:ltr;${low?'color:var(--warn);':''}">${fmtNum(i.balance)} ${escapeHtml(i.unit)}${low?' <i class="fa-solid fa-triangle-exclamation"></i>':''}</b>
      </div>`;
    }).join('');
    html += `</div>`;
  });
  el.innerHTML = html || '<p style="color:var(--ink-soft);font-size:13px;">لا توجد أصناف مسجّلة بعد.</p>';
}

function isTypingContext(){
  const el = document.activeElement;
  if(!el) return false;
  const tag = el.tagName;
  return tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || el.isContentEditable;
}

function closeTopMostOverlay(){
  const scannerOv = document.getElementById('scannerOverlay');
  if(scannerOv && scannerOv.classList.contains('show')){ closeScanner(); return; }
  document.querySelectorAll('.stamp-overlay.show').forEach(o=> o.classList.remove('show'));
}

document.addEventListener('keydown', (e)=>{
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='k'){
    e.preventDefault();
    openGlobalSearch();
    return;
  }
  if(e.key === 'Escape'){
    closeTopMostOverlay();
    return;
  }
  if(e.shiftKey && (e.key === 'L' || e.code === 'KeyL')){
    e.preventDefault();
    renderBrandBalancesList();
    document.getElementById('brandListOverlay').classList.add('show');
    return;
  }
  if(isTypingContext()) return;
  switch(e.key){
    case '/': e.preventDefault(); openGlobalSearch(); break;
    case '?': openShortcutsHelp(); break;
    case 'd': switchToTab('dashboard'); break;
    case 'a': switchToTab('items'); break;
    case 'n': document.getElementById('newVoucherOverlay').classList.add('show'); break;
    case 'i': switchToTab('voucherIn'); break;
    case 'o': switchToTab('voucherOut'); break;
    case 's': switchToTab('log'); break;
    case 'l': switchToTab('ledger'); break;
    case 'r': switchToTab('reports'); break;
    case 'e': switchToTab('settings'); break;
    case 'w': switchToTab('workforce'); break;
  }
});

//----------------------------------------------------------------


/* ====== وضع المطور: حماية سطحية للصفحة (تبديل نظيف قابل للإيقاف) ====== */
let devGuardActive = false;

// توست بسيط ذاتي (ينشئ عنصره بنفسه، بلا اعتماد على HTML خارجي)
function devToast(msg){
  let t = document.getElementById('devGuardToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'devGuardToast';
    document.body.appendChild(t);
  }
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
}

// هل الهدف حقل إدخال؟ (نسمح فيه بالنسخ/اللصق والقائمة حتى لا نكسر إدخال البيانات)
function isEditableTarget(el){
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// معالجات مسمّاة حتى يمكن إضافتها وإزالتها (تبديل حقيقي)
function guardKeydown(e){
  const k = e.keyCode;
  const isDevTools = (k === 123) ||                                   // F12
    (e.ctrlKey && e.shiftKey && (k === 73 || k === 74 || k === 67)) || // Ctrl+Shift+I/J/C
    (e.ctrlKey && k === 85);                                          // Ctrl+U (عرض المصدر)
  if(isDevTools){
    e.preventDefault();
    devToast(k === 85 ? 'عرض المصدر معطّل' : 'أدوات المطور معطّلة');
    return false;
  }
}
function guardContext(e){
  if(isEditableTarget(e.target)) return;      // اسمح بالقائمة داخل الحقول
  e.preventDefault();
  devToast('النقر بالزر الأيمن معطّل');
  return false;
}
function guardClipboard(e){
  if(isEditableTarget(e.target)) return;      // اسمح بالنسخ/اللصق داخل الحقول
  e.preventDefault();
  devToast('النسخ/القص/اللصق معطّل');
  return false;
}
function guardDrag(e){ e.preventDefault(); return false; }

const CLIP_EVENTS = ['cut','copy','paste'];
const DRAG_EVENTS = ['dragstart','drop'];

function enableDevGuard(){
  if(devGuardActive) return;
  document.addEventListener('keydown', guardKeydown);
  // ملاحظة: النقر بالزر الأيمن تتكفّل به القائمة المخصّصة (customCtxMenu) في الأسفل
  CLIP_EVENTS.forEach(function(ev){ document.addEventListener(ev, guardClipboard); });
  DRAG_EVENTS.forEach(function(ev){ document.addEventListener(ev, guardDrag); });
  devGuardActive = true;
}
function disableDevGuard(){
  if(!devGuardActive) return;
  document.removeEventListener('keydown', guardKeydown);
  CLIP_EVENTS.forEach(function(ev){ document.removeEventListener(ev, guardClipboard); });
  DRAG_EVENTS.forEach(function(ev){ document.removeEventListener(ev, guardDrag); });
  devGuardActive = false;
}

function updateDevModeUI(){
  const btn = document.getElementById('DeveloperMode');
  const status = document.getElementById('devModeStatus');
  if(!btn) return;
  if(devGuardActive){
    btn.textContent = 'تفعيل وضع المطور';
    btn.classList.remove('btn-in');
    btn.classList.add('btn-danger-outline');
    if(status){ status.textContent = '● الحماية مُفعّلة'; status.style.color = 'var(--stamp-in)'; }
  } else {
    btn.textContent = 'إلغاء وضع المطور';
    btn.classList.remove('btn-danger-outline');
    btn.classList.add('btn-in');
    if(status){ status.textContent = '○ الحماية متوقفة'; status.style.color = 'var(--ink-soft)'; }
  }
}

const devModeBtn = document.getElementById('DeveloperMode');
if(devModeBtn){
  devModeBtn.addEventListener('click', function(){
    if(devGuardActive){ disableDevGuard(); } else { enableDevGuard(); }
    try{ localStorage.setItem('devGuard', devGuardActive ? '1' : '0'); }catch(e){}
    updateDevModeUI();
    devToast(devGuardActive ? 'تم تفعيل وضع المطور' : 'تم إلغاء وضع المطور');
  });

  // استرجاع الحالة المحفوظة عند فتح الصفحة
  (function(){
    let saved = '0';
    try{ saved = localStorage.getItem('devGuard') || '0'; }catch(e){}
    if(saved === '1') enableDevGuard();
    updateDevModeUI();
  })();
}

/* ====== قائمة النقر بالزر الأيمن المخصّصة (أزرار حسب محتوى الصفحة) ====== */
(function(){
  const menu = document.createElement('div');
  menu.id = 'customCtxMenu';
  menu.setAttribute('role','menu');
  document.body.appendChild(menu);

  function hideMenu(){ menu.classList.remove('show'); }

  function copyText(text){
    if(!text){ devToast('لا يوجد شيء لنسخه'); return; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ devToast('تم النسخ'); }).catch(function(){ fallbackCopy(text); });
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text){
    try{
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      devToast('تم النسخ');
    }catch(e){ devToast('تعذّر النسخ'); }
  }
  function pasteInto(field){
    if(navigator.clipboard && navigator.clipboard.readText){
      navigator.clipboard.readText().then(function(txt){ insertAtCursor(field, txt); devToast('تم اللصق'); })
        .catch(function(){ devToast('تعذّر اللصق — استخدم Ctrl+V'); });
    } else { devToast('تعذّر اللصق — استخدم Ctrl+V'); }
  }
  function insertAtCursor(field, text){
    field.focus();
    const s = field.selectionStart != null ? field.selectionStart : field.value.length;
    const e = field.selectionEnd != null ? field.selectionEnd : field.value.length;
    field.value = field.value.slice(0,s) + text + field.value.slice(e);
    const pos = s + text.length;
    try{ field.setSelectionRange(pos,pos); }catch(_){}
    field.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function clickTab(view){
    const t = document.querySelector('.tab[data-view="'+view+'"]');
    if(t) t.click();
  }

  function makeItem(icon, label, handler, danger){
    const it = document.createElement('div');
    it.className = 'ctx-item' + (danger ? ' danger' : '');
    it.setAttribute('role','menuitem');
    const ico = document.createElement('span'); ico.className='ci-ico'; ico.innerHTML=icon;
    const tx = document.createElement('span'); tx.textContent=label;
    it.appendChild(ico); it.appendChild(tx);
    it.addEventListener('click', function(){ hideMenu(); handler(); });
    return it;
  }
  function makeSep(){ const s=document.createElement('div'); s.className='ctx-sep'; return s; }
  function makeLabel(t){ const l=document.createElement('div'); l.className='ctx-label'; l.textContent=t; return l; }

  function buildItems(target){
    const frag = document.createDocumentFragment();
    let has = false;

    // (1) صورة
    const img = target.closest ? target.closest('img') : null;
    if(img && img.getAttribute('src')){
      const src = img.getAttribute('src');
      frag.appendChild(makeLabel('الصورة'));
      frag.appendChild(makeItem('<i class="fa-solid fa-magnifying-glass"></i>','فتح الصورة بحجمها الكامل', function(){ window.open(src,'_blank'); }));
      frag.appendChild(makeItem('⧉','نسخ رابط الصورة', function(){ copyText(src); }));
      has = true;
    }

    // (2) صف سند / طلب فيه زر "عرض"
    const row = target.closest ? target.closest('tr') : null;
    if(row){
      const vBtn = row.querySelector('[data-view-v]');
      const rBtn = row.querySelector('[data-view-req]');
      const numCell = row.querySelector('td.mono');
      if(vBtn){
        if(has) frag.appendChild(makeSep());
        frag.appendChild(makeLabel('السند'));
        frag.appendChild(makeItem('◉','عرض تفاصيل السند', function(){ vBtn.click(); }));
        if(numCell) frag.appendChild(makeItem('#','نسخ رقم السند', function(){ copyText(numCell.textContent.trim()); }));
        has = true;
      } else if(rBtn){
        if(has) frag.appendChild(makeSep());
        frag.appendChild(makeLabel('الطلب'));
        frag.appendChild(makeItem('◉','عرض تفاصيل الطلب', function(){ rBtn.click(); }));
        has = true;
      }
    }

    // (3) حقل إدخال
    const field = target.closest ? target.closest('input, textarea') : null;
    if(field && field.type !== 'file' && field.type !== 'checkbox' && field.type !== 'radio'){
      if(has) frag.appendChild(makeSep());
      frag.appendChild(makeLabel('الحقل'));
      frag.appendChild(makeItem('⧉','نسخ', function(){
        const sel = (window.getSelection && window.getSelection().toString()) || '';
        copyText(sel || field.value);
      }));
      frag.appendChild(makeItem('<i class="fa-solid fa-paste"></i>','لصق', function(){ pasteInto(field); }));
      frag.appendChild(makeItem('▦','تحديد الكل', function(){ field.focus(); try{ field.select(); }catch(_){} }));
      frag.appendChild(makeItem('<i class="fa-solid fa-delete-left"></i>','مسح الحقل', function(){ field.value=''; field.dispatchEvent(new Event('input',{bubbles:true})); field.focus(); }, true));
      has = true;
    }

    // (4) نص محدد خارج الحقول
    const sel = (window.getSelection && window.getSelection().toString().trim()) || '';
    if(sel && !field){
      if(has) frag.appendChild(makeSep());
      frag.appendChild(makeLabel('النص المحدد'));
      frag.appendChild(makeItem('⧉','نسخ النص المحدد', function(){ copyText(sel); }));
      has = true;
    }

    // (5) إجراءات عامة (دائمًا)
    if(has) frag.appendChild(makeSep());
    frag.appendChild(makeLabel('تنقّل سريع'));
    frag.appendChild(makeItem('<i class="fa-solid fa-house"></i>','لوحة التحكم', function(){ clickTab('dashboard'); }));
    const searchBtn = document.getElementById('globalSearchBtn');
    if(searchBtn && searchBtn.offsetParent !== null) frag.appendChild(makeItem('<i class="fa-solid fa-magnifying-glass"></i>','بحث', function(){ searchBtn.click(); }));
    const newVBtn = document.getElementById('newVoucherBtn');
    if(newVBtn && newVBtn.offsetParent !== null) frag.appendChild(makeItem('+','سند جديد', function(){ newVBtn.click(); }));
    frag.appendChild(makeSep());
    frag.appendChild(makeItem('<i class="fa-solid fa-print"></i>','طباعة الصفحة', function(){ window.print(); }));
    frag.appendChild(makeItem('<i class="fa-solid fa-arrows-rotate"></i>','تحديث الصفحة', function(){ location.reload(); }));

    return frag;
  }

  document.addEventListener('contextmenu', function(e){
    // لا نعترض النقر داخل القائمة نفسها
    if(menu.contains(e.target)) return;
    e.preventDefault();
    menu.innerHTML = '';
    menu.appendChild(buildItems(e.target));
    // إظهار مبدئي للقياس ثم تحديد الموضع
    menu.style.left = '-9999px'; menu.style.top = '-9999px';
    menu.classList.add('show');
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = e.clientX - mw;                 // RTL: تُفتح يسار المؤشر
    if(left < 8) left = e.clientX;             // ما فيه مساحة يسار → افتحها يمين
    if(left + mw > vw - 8) left = vw - mw - 8;
    if(left < 8) left = 8;
    let top = e.clientY;
    if(top + mh > vh - 8) top = vh - mh - 8;
    if(top < 8) top = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  });

  document.addEventListener('click', function(e){ if(!menu.contains(e.target)) hideMenu(); });
  document.addEventListener('scroll', hideMenu, true);
  window.addEventListener('resize', hideMenu);
  window.addEventListener('blur', hideMenu);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') hideMenu(); });
})();


/* ====== كارد موقع المستخدم الحالي ====== */
(function(){
  const resultEl = document.getElementById('locationResult');
  const gpsBtn   = document.getElementById('getLocationBtn');
  const ipBtn    = document.getElementById('getIpLocationBtn');
  const acctLine = document.getElementById('locAccountLine');
  if(!resultEl || !gpsBtn) return;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function show(html){ resultEl.innerHTML = html; }
  function refreshAccount(){
    if(!acctLine) return;
    const email = (typeof currentUserEmail !== 'undefined' && currentUserEmail) ? currentUserEmail : '—';
    acctLine.textContent = 'الحساب الحالي: ' + email;
  }
  refreshAccount();

  function mapBtn(lat, lon){
    const url = 'https://www.google.com/maps?q=' + lat + ',' + lon;
    return '<a class="btn-ghost btn-sm loc-map-btn" href="' + url + '" target="_blank" rel="noopener"><i class="fa-solid fa-map"></i> فتح في خرائط Google</a>';
  }

  function renderGps(d){
    let html = '<div class="loc-box">';
    html += '<p class="loc-place">' + esc(d.place) + '</p>';
    html += '<div class="loc-row"><span class="loc-key">خط العرض / الطول</span><span class="loc-val">' + d.lat.toFixed(5) + ' , ' + d.lon.toFixed(5) + '</span></div>';
    html += '<div class="loc-row"><span class="loc-key">دقة التحديد</span><span class="loc-val">≈ ' + Math.round(d.acc) + ' م</span></div>';
    html += '<div class="loc-row"><span class="loc-key">وقت التحديد</span><span class="loc-val">' + new Date().toLocaleString('ar') + '</span></div>';
    html += mapBtn(d.lat, d.lon);
    html += '</div>';
    show(html);
  }
  function renderIp(d){
    const place = [d.city, d.region, d.country_name].filter(Boolean).join('، ') || 'غير معروف';
    let html = '<div class="loc-box">';
    html += '<p class="loc-place">' + esc(place) + '</p>';
    if(d.ip)  html += '<div class="loc-row"><span class="loc-key">عنوان الإنترنت (IP)</span><span class="loc-val">' + esc(d.ip) + '</span></div>';
    if(d.org) html += '<div class="loc-row"><span class="loc-key">مزوّد الخدمة</span><span class="loc-val">' + esc(d.org) + '</span></div>';
    if(d.postal) html += '<div class="loc-row"><span class="loc-key">الرمز البريدي</span><span class="loc-val">' + esc(d.postal) + '</span></div>';
    if(d.timezone) html += '<div class="loc-row"><span class="loc-key">المنطقة الزمنية</span><span class="loc-val">' + esc(d.timezone) + '</span></div>';
    if(d.latitude && d.longitude) html += mapBtn(d.latitude, d.longitude);
    html += '</div>';
    show(html);
  }

  function busy(btn, on, original){
    if(on){ btn.dataset._t = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ التحديد...'; }
    else  { btn.disabled = false; btn.textContent = btn.dataset._t || original; }
  }

  gpsBtn.addEventListener('click', function(){
    refreshAccount();
    if(!('geolocation' in navigator)){ show('<div class="loc-err">المتصفح لا يدعم تحديد الموقع.</div>'); return; }
    busy(gpsBtn, true);
    show('<div class="loc-loading">جارٍ الحصول على الموقع... اسمح بإذن الموقع عند ظهوره.</div>');
    navigator.geolocation.getCurrentPosition(function(pos){
      const lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy;
      renderGps({ lat, lon, acc, place: 'جارٍ تحديد اسم المكان...' });
      busy(gpsBtn, false);
      fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon + '&accept-language=ar')
        .then(function(r){ return r.json(); })
        .then(function(g){ renderGps({ lat, lon, acc, place: g.display_name || 'الإحداثيات متوفرة (تعذّر اسم المكان)' }); })
        .catch(function(){ renderGps({ lat, lon, acc, place: 'الإحداثيات متوفرة (تعذّر تحديد اسم المكان)' }); });
    }, function(err){
      let msg = 'تعذّر تحديد الموقع.';
      if(err.code === 1) msg = 'تم رفض إذن الموقع. فعّله من إعدادات المتصفح (أيقونة القفل بجانب الرابط) ثم أعد المحاولة.';
      else if(err.code === 2) msg = 'الموقع غير متاح حاليًا. تأكد من تفعيل خدمة الموقع في الجهاز.';
      else if(err.code === 3) msg = 'انتهت مهلة تحديد الموقع، حاول مرة أخرى.';
      show('<div class="loc-err">' + msg + '</div>');
      busy(gpsBtn, false);
    }, { enableHighAccuracy:true, timeout:12000, maximumAge:0 });
  });

  ipBtn.addEventListener('click', function(){
    refreshAccount();
    busy(ipBtn, true);
    show('<div class="loc-loading">جارٍ تحديد الموقع حسب عنوان الإنترنت...</div>');
    fetch('https://ipapi.co/json/')
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d && d.error){ throw new Error(d.reason || 'error'); }
        renderIp(d);
        busy(ipBtn, false);
      })
      .catch(function(){
        show('<div class="loc-err">تعذّر تحديد الموقع حسب الإنترنت (قد يكون بسبب مانع الإعلانات أو تجاوز حد الطلبات المجاني).</div>');
        busy(ipBtn, false);
      });
  });
})();

/* ====== بوكس الترحيب والتعليمات ====== */
(function(){
  const overlay = document.getElementById('welcomeOverlay');
  const listEl  = document.getElementById('welcomeList');
  const subEl   = document.getElementById('welcomeSub');
  const closeBtn = document.getElementById('closeWelcome');
  const dontShowBox = document.getElementById('welcomeDontShow');
  if(!overlay) return;

  function item(icon, html){
    return '<div class="welcome-item"><span class="wi-ico">' + icon + '</span><span class="wi-text">' + html + '</span></div>';
  }

  // تعليمات مشتركة لكل الأدوار
  function commonItems(){
    return [
      item('<i class="fa-solid fa-magnifying-glass"></i>', 'اضغط <kbd>/</kbd> أو زر <b>بحث</b> أعلى الصفحة للوصول السريع لأي صنف أو سند.'),
      item('◉', 'كليك يمين في أي مكان بالصفحة يفتح لك قائمة اختصارات حسب محتوى الشاشة.')
    ];
  }

  function itemsForRole(role){
    if(role === 'admin'){
      return [
        item('<i class="fa-solid fa-house"></i>', '<b>لوحة التحكم</b> تعرض أرصدة كل مخزن، آخر السندات، والأصناف اللي وصلت للحد الأدنى.'),
        item('<i class="fa-solid fa-box"></i>', 'من تبويب <b>الأصناف</b> أضف أصناف كل مخزن وحدّد الوحدة والحد الأدنى للتنبيه.'),
        item('<i class="fa-solid fa-plus"></i>', 'اضغط <kbd>n</kbd> أو زر <b>سند جديد</b> لتسجيل سند توريد (وارد) أو صرف (صادر).'),
        item('<i class="fa-solid fa-file-lines"></i>', '<b>سجل السندات</b> يفصل فواتير التوريد عن سندات الصرف في قسمين منفصلين.'),
        item('<i class="fa-solid fa-chart-column"></i>', '<b>الحركه اليوميه</b> يوريك كل حركات صنف معيّن ورصيده تاريخيًا.'),
        item('<i class="fa-solid fa-inbox"></i>', '<b>الطلبات الواردة</b> فيها طلبات الأصناف اللي يرسلها الموظفون لتوافق عليها.'),
        item('<i class="fa-solid fa-calendar-days"></i>', '<b>تقارير شهرية</b> و<b>الأرشيف</b> لمراجعة أي شهر سابق بعد إقفاله.')
      ].concat(commonItems());
    }
    if(role === 'requester'){
      return [
        item('<i class="fa-solid fa-pen-to-square"></i>', 'من تبويب <b>طلباتي</b> اطلب أي أصناف تحتاجها من المستودع.'),
        item('<i class="fa-solid fa-eye"></i>', 'تابع حالة طلبك (قيد الانتظار / تمت الموافقة) في نفس الصفحة أول بأول.')
      ].concat(commonItems());
    }
    return [
      item('<i class="fa-solid fa-eye"></i>', 'حسابك للمشاهدة فقط — تقدر تستعرض البيانات لكن ما تقدر تعدّلها.'),
      item('<i class="fa-solid fa-house"></i>', '<b>لوحة التحكم</b> تعطيك نظرة عامة سريعة على كل المخازن.')
    ].concat(commonItems());
  }

  function roleLabel(role){
    if(role === 'admin') return 'حساب مسؤول';
    if(role === 'requester') return 'حساب طلب أصناف';
    return 'حساب مشاهدة فقط';
  }

  function buildContent(){
    const role = (typeof currentRole !== 'undefined') ? currentRole : 'viewer';
    subEl.textContent = 'سجل المخزن العليان الذهبي — ' + roleLabel(role);
    listEl.className = 'welcome-list';
    listEl.innerHTML = itemsForRole(role).join('');
  }

  function openWelcome(forced){
    buildContent();
    dontShowBox.checked = false;
    dontShowBox.parentElement.style.display = forced ? 'none' : 'flex';
    overlay.classList.add('show');
  }
  function closeWelcome(){
    overlay.classList.remove('show');
  }

  function storageKey(){
    const email = (typeof currentUserEmail !== 'undefined' && currentUserEmail) ? currentUserEmail : 'guest';
    return 'welcomeSeen_' + email;
  }

  window.maybeShowWelcome = function(){
    let seen = null;
    try{ seen = localStorage.getItem(storageKey()); }catch(e){}
    if(seen === '1') return;
    openWelcome(false);
  };

  closeBtn.addEventListener('click', function(){
    if(dontShowBox.checked){
      try{ localStorage.setItem(storageKey(), '1'); }catch(e){}
    }
    closeWelcome();
  });

  const pmWelcome = document.getElementById('pmWelcome');
  if(pmWelcome){
    pmWelcome.addEventListener('click', function(){
      const menuRoot = document.getElementById('profileRoot');
      if(menuRoot) menuRoot.classList.remove('open');
      openWelcome(true);
    });
  }
})();

/* ====== لمسات مرح خفيفة: ترحيب يومي، أيام متتالية، احتفال بالإنجاز ====== */

// ترحيب حسب وقت اليوم + شارة "أيام متتالية" (streak) لتحفيز أمين المستودع
function greetingPhrase(){
  const h = new Date().getHours();
  if(h>=5 && h<12)  return { text:'صباح الخير', icon:'<i class="fa-solid fa-sun"></i>' };
  if(h>=12 && h<17) return { text:'طاب يومك',   icon:'<i class="fa-solid fa-cloud-sun"></i>' };
  if(h>=17 && h<21) return { text:'مساء الخير', icon:'<i class="fa-solid fa-city"></i>' };
  return { text:'سهرة طيبة', icon:'<i class="fa-solid fa-moon"></i>' };
}
function localDateStr(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function computeLoginStreak(){
  const email = (typeof currentUserEmail !== 'undefined' && currentUserEmail) ? currentUserEmail : 'guest';
  const key = 'loginStreak_' + email;
  const now = new Date();
  const todayStr = localDateStr(now);
  let data = null;
  try{ data = JSON.parse(localStorage.getItem(key) || 'null'); }catch(e){}
  if(!data || !data.lastDate){
    data = { count:1, lastDate:todayStr };
  } else if(data.lastDate !== todayStr){
    const [py,pm,pd] = data.lastDate.split('-').map(Number);
    const prev = new Date(py, pm-1, pd);
    const [ty,tm,td] = todayStr.split('-').map(Number);
    const cur = new Date(ty, tm-1, td);
    const diffDays = Math.round((cur - prev) / 86400000);
    data.count = (diffDays === 1) ? (data.count||1) + 1 : 1;
    data.lastDate = todayStr;
  }
  try{ localStorage.setItem(key, JSON.stringify(data)); }catch(e){}
  try{
    const longest = parseInt(localStorage.getItem('longestLoginStreak')||'0', 10) || 0;
    if(data.count > longest) localStorage.setItem('longestLoginStreak', String(data.count));
  }catch(e){}
  return data.count;
}
// لقب رمزي للفريق حسب إجمالي عدد السندات المسجّلة (مؤشر خبرة، وليس تقييم شخصي)
const TEAM_RANKS = [
  { min:0,   icon:'<i class="fa-solid fa-seedling"></i>', label:'بداية الطريق' },
  { min:20,  icon:'<i class="fa-solid fa-box"></i>', label:'مسؤول مخزون نشط' },
  { min:100, icon:'<i class="fa-solid fa-star"></i>', label:'خبير مستودع' },
  { min:300, icon:'<i class="fa-solid fa-medal"></i>', label:'خبير مستودع محترف' },
  { min:700, icon:'<i class="fa-solid fa-crown"></i>', label:'أسطورة المخزن' }
];
function teamRank(totalVouchers){
  let rank = TEAM_RANKS[0];
  for(const r of TEAM_RANKS){ if(totalVouchers >= r.min) rank = r; }
  return rank;
}

function renderGreetingBar(){
  const bar = document.getElementById('greetBar');
  if(!bar) return;
  const nameEl = document.getElementById('profileName');
  const name = (nameEl && nameEl.textContent && nameEl.textContent !== 'الحساب') ? nameEl.textContent : '';
  const g = greetingPhrase();
  document.getElementById('greetText').innerHTML = g.icon + ' ' + g.text + (name ? ' يا ' + name : '') + ' — هذي نظرة سريعة على المخزن اليوم.';
  const briefEl = document.getElementById('greetBrief');
  if(briefEl && typeof computeDayBrief === 'function') briefEl.innerHTML = computeDayBrief();

  const streak = computeLoginStreak();
  const streakEl = document.getElementById('greetStreak');
  if(streak >= 2){
    streakEl.style.display = 'inline-flex';
    streakEl.innerHTML = '<i class="fa-solid fa-fire"></i> ' + streak + ' ' + (streak===2 ? 'يومين متتاليين' : 'أيام متتالية');
  } else if(streakEl){
    streakEl.style.display = 'none';
  }

  const rankEl = document.getElementById('greetRank');
  if(rankEl && typeof DB !== 'undefined' && DB.vouchers){
    const rank = teamRank(DB.vouchers.length);
    rankEl.style.display = 'inline-flex';
    rankEl.innerHTML = rank.icon + ' ' + rank.label;
    rankEl.title = 'مستوى الفريق حسب إجمالي السندات المسجّلة (' + DB.vouchers.length + ' سند)';
  }

  const todayEl = document.getElementById('greetToday');
  if(todayEl && typeof DB !== 'undefined' && DB.vouchers){
    const todayStr = localDateStr(new Date());
    const todayCount = DB.vouchers.filter(function(v){ return v.date === todayStr; }).length;
    if(todayCount > 0){
      todayEl.style.display = 'inline-flex';
      todayEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + todayCount + ' سند اليوم';
    } else {
      todayEl.style.display = 'none';
    }
  }

  bar.style.display = 'flex';
}

// احتفال قصّاصات ورق خفيف بألوان الموقع — لا يظهر لو المستخدم يفضّل تقليل الحركة
function burstConfetti(count){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  count = count || 55;
  let layer = document.getElementById('confettiLayer');
  if(!layer){
    layer = document.createElement('div');
    layer.id = 'confettiLayer';
    document.body.appendChild(layer);
  }
  const colors = ['#2F6F8F','#A8631E','#4C7A4C','#C7791D','#1B2430'];
  for(let i=0;i<count;i++){
    const el = document.createElement('span');
    el.className = 'confetti-piece';
    el.style.left = (Math.random()*100) + 'vw';
    el.style.background = colors[Math.floor(Math.random()*colors.length)];
    const duration = 2.2 + Math.random()*1.4;
    const delay = Math.random()*0.3;
    el.style.animationDuration = duration + 's';
    el.style.animationDelay = delay + 's';
    layer.appendChild(el);
    setTimeout(function(){ el.remove(); }, (duration+delay)*1000 + 200);
  }
}

// احتفال بمحطات الإنجاز (كل عدد سندات مسجّلة يصل لرقم مستدير)
const CELEBRATION_MILESTONES = [10,25,50,100,150,200,300,500,750,1000,1500,2000,3000,5000,7500,10000];
function checkMilestone(){
  if(typeof DB === 'undefined' || !DB.vouchers) return;
  const total = DB.vouchers.length;
  let lastCelebrated = 0;
  try{ lastCelebrated = parseInt(localStorage.getItem('milestoneReached') || '0', 10) || 0; }catch(e){}
  const hits = CELEBRATION_MILESTONES.filter(function(m){ return m > lastCelebrated && total >= m; });
  if(hits.length === 0) return;
  const hit = hits[hits.length - 1];
  try{ localStorage.setItem('milestoneReached', String(hit)); }catch(e){}
  showMilestoneToast(hit);
}
function showMilestoneToast(n){
  let t = document.getElementById('milestoneToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'milestoneToast';
    document.body.appendChild(t);
  }
  t.innerHTML = '<i class="fa-solid fa-trophy"></i> وصلتوا لـ ' + n.toLocaleString('en-US') + ' سند مسجّل! عمل ممتاز يا فريق المستودع.';
  t.classList.add('show');
  burstConfetti(90);
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.classList.remove('show'); }, 4200);
}

/* ====== رسائل تحفيزية متنوّعة ====== */
const PRAISE_PHRASES = [
  'ممتاز! المخزون بأيدٍ أمينة <i class="fa-solid fa-dumbbell"></i>',
  'سند نظيف ومرتّب <i class="fa-solid fa-wand-magic-sparkles"></i>',
  'استمر بهذا الأداء <i class="fa-solid fa-rocket"></i>',
  'شغل احترافي كالعادة <i class="fa-solid fa-thumbs-up"></i>',
  'دقة وسرعة — بالضبط كذا نبيها <i class="fa-solid fa-bullseye"></i>',
  'يوم تاني، إنجاز تاني <i class="fa-solid fa-star"></i>',
  'عمل تمام <i class="fa-solid fa-thumbs-up"></i>'
];
function randomPraise(){
  return PRAISE_PHRASES[Math.floor(Math.random()*PRAISE_PHRASES.length)];
}

/* ====== "يوم بدون نقص" — عداد حقيقي محسوب من أرصدة الأصناف الفعلية ====== */
function getLongestNoShortage(current){
  let longest = 0;
  try{ longest = parseInt(localStorage.getItem('noShortageLongest') || '0', 10) || 0; }catch(e){}
  if(current > longest){
    longest = current;
    try{ localStorage.setItem('noShortageLongest', String(longest)); }catch(e){}
  }
  return longest;
}
function computeNoShortageStreak(){
  const todayStr = localDateStr(new Date());
  const hasLow = (typeof DB !== 'undefined' && DB.items) ? DB.items.some(function(i){ return i.min>0 && i.balance<=i.min; }) : false;
  if(hasLow){
    try{ localStorage.setItem('noShortageStart', todayStr); }catch(e){}
    return { days:0, longest:getLongestNoShortage(0), hasLowNow:true };
  }
  let start = null;
  try{ start = localStorage.getItem('noShortageStart'); }catch(e){}
  if(!start){
    try{ localStorage.setItem('noShortageStart', todayStr); }catch(e){}
    start = todayStr;
  }
  const [sy,sm,sd] = start.split('-').map(Number);
  const startDate = new Date(sy, sm-1, sd);
  const [ty,tm,td] = todayStr.split('-').map(Number);
  const today = new Date(ty, tm-1, td);
  const days = Math.max(0, Math.round((today - startDate) / 86400000));
  return { days:days, longest:getLongestNoShortage(days), hasLowNow:false };
}
function renderShortageBanner(){
  const row = document.getElementById('miniBannerRow');
  const mainEl = document.getElementById('shortageBannerMain');
  const subEl = document.getElementById('shortageBannerSub');
  const bannerEl = document.getElementById('shortageBanner');
  if(!row || !mainEl) return;
  const icoEl = bannerEl ? bannerEl.querySelector('.sb-ico') : null;
  const r = computeNoShortageStreak();
  if(r.hasLowNow){
    bannerEl.classList.add('sb-warn');
    if(icoEl) icoEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    mainEl.textContent = 'فيه نقص حاليًا في بعض الأصناف';
    subEl.textContent = 'أطول فترة بدون نقص: ' + r.longest + ' يوم';
  } else {
    bannerEl.classList.remove('sb-warn');
    const isRecord = r.days > 0 && r.days === r.longest;
    bannerEl.classList.toggle('sb-pride', isRecord);
    if(icoEl) icoEl.innerHTML = isRecord ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-solid fa-shield-halved"></i>';
    mainEl.textContent = (isRecord ? 'رقم قياسي جديد! ' : '') + r.days + ' يوم بدون نقص';
    subEl.textContent = 'أطول فترة: ' + r.longest + ' يوم';
    if(isRecord){
      const todayStr = localDateStr(new Date());
      let celebratedDay = null;
      try{ celebratedDay = localStorage.getItem('prideCelebratedDay'); }catch(e){}
      if(celebratedDay !== todayStr){
        try{ localStorage.setItem('prideCelebratedDay', todayStr); }catch(e){}
        if(typeof burstConfetti === 'function') burstConfetti(70);
      }
    }
  }
  row.style.display = 'flex';
}

/* ====== "صحة المخزون" — مؤشر دائري حسب نسبة الأصناف فوق الحد الأدنى ====== */
function computeStockHealth(){
  if(typeof DB === 'undefined' || !DB.items) return { pct:100, healthy:0, tracked:0 };
  const tracked = DB.items.filter(function(i){ return i.min>0; });
  if(tracked.length===0) return { pct:100, healthy:0, tracked:0 };
  const healthy = tracked.filter(function(i){ return i.balance>i.min; }).length;
  return { pct:Math.round((healthy/tracked.length)*100), healthy:healthy, tracked:tracked.length };
}
function renderHealthRing(){
  const pctEl = document.getElementById('healthPct');
  const subEl = document.getElementById('healthSub');
  const ring = document.getElementById('healthRingFg');
  if(!pctEl || !ring) return;
  const h = computeStockHealth();
  const circumference = 169.6;
  ring.style.strokeDashoffset = String(circumference * (1 - h.pct/100));
  let color = 'var(--stamp-in)';
  if(h.pct < 70) color = 'var(--danger)';
  else if(h.pct < 90) color = 'var(--pantry)';
  ring.setAttribute('stroke', color);
  pctEl.innerHTML = h.pct + '%';
  subEl.textContent = h.tracked>0 ? (h.healthy + ' من ' + h.tracked + ' صنف فوق الحد الأدنى') : 'لا توجد أصناف بحد أدنى محدّد';
}

/* ====== إنقاذ نقص: عدّاد إجمالي لمرّات رجوع صنف فوق الحد الأدنى ====== */
function recordShortageRescue(n){
  let count = 0;
  try{ count = parseInt(localStorage.getItem('shortageRescueCount') || '0', 10) || 0; }catch(e){}
  count += (n || 1);
  try{ localStorage.setItem('shortageRescueCount', String(count)); }catch(e){}
  return count;
}

/* ====== لوحة الأوسمة والإنجازات ====== */
const ACHIEVEMENTS = [
  { icon:'<i class="fa-solid fa-medal"></i>', name:'أول خطوة', desc:'أول سند مسجّل بالنظام', min:1, get:function(ctx){ return ctx.totalVouchers; }, target:1 },
  { icon:'<i class="fa-solid fa-box"></i>', name:'نشاط منتظم', desc:'20 سند مسجّل', get:function(ctx){ return ctx.totalVouchers; }, target:20 },
  { icon:'<i class="fa-solid fa-star"></i>', name:'خبير مستودع', desc:'100 سند مسجّل', get:function(ctx){ return ctx.totalVouchers; }, target:100 },
  { icon:'<i class="fa-solid fa-crown"></i>', name:'أسطورة المخزن', desc:'700 سند مسجّل', get:function(ctx){ return ctx.totalVouchers; }, target:700 },
  { icon:'<i class="fa-solid fa-fire"></i>', name:'أسبوع كامل', desc:'7 أيام دخول متتالية', get:function(ctx){ return ctx.longestLogin; }, target:7 },
  { icon:'<i class="fa-solid fa-fire"></i>', name:'شهر كامل', desc:'30 يوم دخول متتالية', get:function(ctx){ return ctx.longestLogin; }, target:30 },
  { icon:'<i class="fa-solid fa-shield-halved"></i>', name:'أسبوع بدون نقص', desc:'7 أيام متتالية بدون نقص مخزون', get:function(ctx){ return ctx.longestNoShortage; }, target:7 },
  { icon:'<i class="fa-solid fa-shield-halved"></i>', name:'شهر بدون نقص', desc:'30 يوم متتالي بدون نقص مخزون', get:function(ctx){ return ctx.longestNoShortage; }, target:30 },
  { icon:'<i class="fa-solid fa-truck-medical"></i>', name:'منقذ المخزون', desc:'أول مرة ترجّع صنفًا ناقصًا فوق الحد الأدنى', get:function(ctx){ return ctx.rescueCount; }, target:1 },
  { icon:'<i class="fa-solid fa-truck-medical"></i>', name:'منقذ خبير', desc:'10 مرات إنقاذ نقص', get:function(ctx){ return ctx.rescueCount; }, target:10 }
];
function achievementsContext(){
  let longestLogin=0, longestNoShortage=0, rescueCount=0;
  try{ longestLogin = parseInt(localStorage.getItem('longestLoginStreak')||'0', 10) || 0; }catch(e){}
  try{ longestNoShortage = parseInt(localStorage.getItem('noShortageLongest')||'0', 10) || 0; }catch(e){}
  try{ rescueCount = parseInt(localStorage.getItem('shortageRescueCount')||'0', 10) || 0; }catch(e){}
  const totalVouchers = (typeof DB !== 'undefined' && DB.vouchers) ? DB.vouchers.length : 0;
  return { totalVouchers:totalVouchers, longestLogin:longestLogin, longestNoShortage:longestNoShortage, rescueCount:rescueCount };
}
function buildAchievements(){
  const grid = document.getElementById('achvGrid');
  if(!grid) return;
  const ctx = achievementsContext();
  grid.innerHTML = ACHIEVEMENTS.map(function(a){
    const val = a.get(ctx);
    const unlocked = val >= a.target;
    return '<div class="achv-item ' + (unlocked?'unlocked':'locked') + '">'
      + '<span class="achv-ico">' + (unlocked ? a.icon : '<i class="fa-solid fa-lock"></i>') + '</span>'
      + '<div><div class="achv-name">' + a.name + '</div>'
      + '<div class="achv-desc">' + a.desc + (unlocked ? ' <i class="fa-solid fa-check"></i>' : ' — ' + Math.min(val,a.target) + '/' + a.target) + '</div></div>'
      + '</div>';
  }).join('');
}
(function(){
  const overlay = document.getElementById('achievementsOverlay');
  const pmAchv = document.getElementById('pmAchievements');
  if(!overlay || !pmAchv) return;
  pmAchv.addEventListener('click', function(){
    const menuRoot = document.getElementById('profileRoot');
    if(menuRoot) menuRoot.classList.remove('open');
    buildAchievements();
    overlay.classList.add('show');
  });
  const closeBtn = document.getElementById('closeAchievements');
  if(closeBtn) closeBtn.addEventListener('click', function(){ overlay.classList.remove('show'); });
})();

/* ====== بطاقة "يوم المخزن" — ملخص نصي ودّي لنشاط اليوم ====== */
function computeDayBrief(){
  if(typeof DB === 'undefined' || !DB.vouchers) return '';
  const todayStr = localDateStr(new Date());
  const todayVouchers = DB.vouchers.filter(function(v){ return v.date === todayStr; });
  const inCount = todayVouchers.filter(function(v){ return v.type==='in'; }).length;
  const outCount = todayVouchers.filter(function(v){ return v.type==='out'; }).length;
  const lowCount = DB.items ? DB.items.filter(function(i){ return i.min>0 && i.balance<=i.min; }).length : 0;
  if(inCount===0 && outCount===0){
    return 'ما فيه أي حركة مسجّلة اليوم لسه — يومك لسه بدايته <i class="fa-solid fa-cloud-sun"></i>';
  }
  const parts = [];
  if(inCount>0) parts.push(inCount + ' سند توريد');
  if(outCount>0) parts.push(outCount + ' سند صرف');
  let msg = 'اليوم سجّلت ' + parts.join(' و') + '.';
  msg += lowCount>0 ? (' فيه ' + lowCount + ' صنف يحتاج انتباه <i class="fa-solid fa-triangle-exclamation"></i>') : ' وكل المخازن بخير <i class="fa-solid fa-thumbs-up"></i>';
  return msg;
}

/* ====== "أسرع مخزن حركة" — أكثر مخزن نشاطًا آخر 7 أيام ====== */
function computeBusiestStore(){
  if(typeof DB === 'undefined' || !DB.vouchers) return { store:null, count:0 };
  const now = new Date();
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate()-7);
  const cutoffStr = localDateStr(cutoff);
  const counts = { freezer:0, pantry:0, cleaning:0 };
  DB.vouchers.forEach(function(v){
    if(v.date >= cutoffStr){
      v.lines.forEach(function(l){ if(counts.hasOwnProperty(l.store)) counts[l.store] += 1; });
    }
  });
  let best = null, bestCount = 0;
  Object.keys(counts).forEach(function(s){ if(counts[s] > bestCount){ bestCount = counts[s]; best = s; } });
  return { store:best, count:bestCount };
}
function renderBusiestCard(){
  const card = document.getElementById('busiestCard');
  const mainEl = document.getElementById('busiestMain');
  if(!card || !mainEl) return;
  const r = computeBusiestStore();
  if(!r.store || r.count===0){ card.style.display = 'none'; return; }
  mainEl.textContent = (STORE_LABELS[r.store] || r.store) + ' — ' + r.count + ' حركة';
  card.style.display = 'flex';
}

/* ====== رسم مصغّر (Sparkline) لحركة كل مخزن آخر 7 أيام ====== */
function computeStoreSparkline(store){
  if(typeof DB === 'undefined' || !DB.vouchers) return [0,0,0,0,0,0,0];
  const days = [];
  const now = new Date();
  for(let i=6;i>=0;i--){
    const d = new Date(now); d.setDate(d.getDate()-i);
    days.push(localDateStr(d));
  }
  return days.map(function(dStr){
    let net = 0;
    DB.vouchers.forEach(function(v){
      if(v.date === dStr){
        v.lines.forEach(function(l){
          if(l.store === store) net += (v.type==='in' ? l.qty : -l.qty);
        });
      }
    });
    return net;
  });
}
function sparklineSvg(values){
  if(!values || values.length===0) values=[0,0,0,0,0,0,0];
  const w = 100, h = 26, pad = 3;
  const max = Math.max.apply(null, values.concat([0.01]));
  const min = Math.min.apply(null, values.concat([0]));
  const range = (max - min) || 1;
  const stepX = (w - pad*2) / Math.max(1, values.length-1);
  const points = values.map(function(v,i){
    const x = pad + i*stepX;
    const y = h - pad - ((v-min)/range)*(h-pad*2);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" class="store-sparkline"><polyline points="'+points+'" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

/* ====== تنبؤ نقص مبكر — بناءً على معدّل الاستهلاك آخر 30 يوم ====== */
function computePredictedShortages(){
  if(typeof DB === 'undefined' || !DB.items || !DB.vouchers) return [];
  const now = new Date();
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate()-30);
  const cutoffStr = localDateStr(cutoff);
  const consumption = {};
  DB.vouchers.forEach(function(v){
    if(v.type==='out' && v.date >= cutoffStr){
      v.lines.forEach(function(l){
        if(!l.itemId) return;
        consumption[l.itemId] = (consumption[l.itemId]||0) + l.qty;
      });
    }
  });
  const results = [];
  DB.items.forEach(function(it){
    const totalOut = consumption[it.id] || 0;
    if(totalOut<=0) return;
    const avgPerDay = totalOut / 30;
    if(avgPerDay<=0) return;
    const daysLeft = it.balance / avgPerDay;
    const alreadyLow = it.min>0 && it.balance<=it.min;
    if(!alreadyLow && daysLeft <= 5){
      results.push({ name:it.name, store:it.store, daysLeft: Math.max(0, Math.round(daysLeft*10)/10) });
    }
  });
  results.sort(function(a,b){ return a.daysLeft - b.daysLeft; });
  return results;
}
function renderPredictedShortages(){
  const card = document.getElementById('predictedShortageCard');
  const list = document.getElementById('predictedShortageList');
  if(!card || !list) return;
  const results = computePredictedShortages();
  if(results.length===0){ card.style.display = 'none'; return; }
  list.innerHTML = results.slice(0,8).map(function(r){
    return '<div class="predicted-row"><span class="pr-name">'+r.name+' <span style="font-size:11px;color:var(--ink-soft);">('+(STORE_LABELS[r.store]||r.store)+')</span></span><span class="pr-days">~'+r.daysLeft+' يوم متبقّي</span></div>';
  }).join('');
  card.style.display = 'block';
}

/* ====== المظهر الشخصي: صورة رمزية، لقب، ثيم ألوان، صوت الختم ====== */
const AVATAR_OPTIONS = [
  {key:'box', icon:'<i class="fa-solid fa-box"></i>'},
  {key:'snowflake', icon:'<i class="fa-solid fa-snowflake"></i>'},
  {key:'basket', icon:'<i class="fa-solid fa-basket-shopping"></i>'},
  {key:'broom', icon:'<i class="fa-solid fa-broom"></i>'},
  {key:'star', icon:'<i class="fa-solid fa-star"></i>'},
  {key:'shield', icon:'<i class="fa-solid fa-shield-halved"></i>'},
  {key:'rocket', icon:'<i class="fa-solid fa-rocket"></i>'},
  {key:'paw', icon:'<i class="fa-solid fa-paw"></i>'},
  {key:'dragon', icon:'<i class="fa-solid fa-dragon"></i>'},
  {key:'bug', icon:'<i class="fa-solid fa-bug"></i>'},
  {key:'sparkles', icon:'<i class="fa-solid fa-wand-magic-sparkles"></i>'},
  {key:'fire', icon:'<i class="fa-solid fa-fire"></i>'}
];
function avatarIconFor(key){
  const found = AVATAR_OPTIONS.find(function(o){ return o.key===key; });
  return found ? found.icon : AVATAR_OPTIONS[0].icon;
}
const ACCENT_THEMES = [
  { key:'default', name:'الافتراضي', c1:'#2F6F8F', c2:'#A8631E' },
  { key:'royal',   name:'ياقوتي',    c1:'#6B4FA0', c2:'#B23A6B' },
  { key:'ocean',   name:'محيطي',     c1:'#1F6F78', c2:'#2F8F6F' },
  { key:'amber',   name:'كهرماني',   c1:'#B2791D', c2:'#8F4F2F' }
];
function personalizeKey(suffix){
  const email = (typeof currentUserEmail !== 'undefined' && currentUserEmail) ? currentUserEmail : 'guest';
  return suffix + '_' + email;
}
function hexToSoft(hex){
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+',0.14)';
}
function getPersonalization(){
  let avatarEmoji=null, customTitle='', themeKey='default', soundOn=false;
  try{ avatarEmoji = localStorage.getItem(personalizeKey('avatarEmoji')); }catch(e){}
  try{ customTitle = localStorage.getItem(personalizeKey('customTitle')) || ''; }catch(e){}
  try{ themeKey = localStorage.getItem('accentTheme') || 'default'; }catch(e){}
  try{ soundOn = localStorage.getItem('stampSoundOn') === '1'; }catch(e){}
  return { avatarEmoji:avatarEmoji, customTitle:customTitle, themeKey:themeKey, soundOn:soundOn };
}
function applyPersonalization(){
  const p = getPersonalization();
  if(p.avatarEmoji){
    const a1 = document.getElementById('profileAvatar');
    const a2 = document.getElementById('profileAvatarBig');
    if(a1) a1.innerHTML = avatarIconFor(p.avatarEmoji);
    if(a2) a2.innerHTML = avatarIconFor(p.avatarEmoji);
  }
  const titleEl = document.getElementById('profileCustomTitle');
  if(titleEl){
    if(p.customTitle){ titleEl.textContent = '"' + p.customTitle + '"'; titleEl.style.display = 'block'; }
    else { titleEl.style.display = 'none'; }
  }
  const theme = ACCENT_THEMES.find(function(t){ return t.key===p.themeKey; }) || ACCENT_THEMES[0];
  document.documentElement.style.setProperty('--accent1', theme.c1);
  document.documentElement.style.setProperty('--accent2', theme.c2);
  document.documentElement.style.setProperty('--accent1-soft', hexToSoft(theme.c1));
  document.documentElement.style.setProperty('--accent2-soft', hexToSoft(theme.c2));
}
function buildPersonalizeOverlay(){
  const p = getPersonalization();
  const avatarPicker = document.getElementById('avatarPicker');
  if(avatarPicker){
    avatarPicker.innerHTML = AVATAR_OPTIONS.map(function(o){
      const sel = (p.avatarEmoji===o.key) ? ' selected' : '';
      return '<div class="avatar-option'+sel+'" data-key="'+o.key+'">'+o.icon+'</div>';
    }).join('');
    avatarPicker.querySelectorAll('.avatar-option').forEach(function(el){
      el.addEventListener('click', function(){
        avatarPicker.querySelectorAll('.avatar-option').forEach(function(o){ o.classList.remove('selected'); });
        el.classList.add('selected');
      });
    });
  }
  const themePicker = document.getElementById('themePicker');
  if(themePicker){
    themePicker.innerHTML = ACCENT_THEMES.map(function(t){
      const sel = (p.themeKey===t.key) ? ' selected' : '';
      return '<div class="color-swatch'+sel+'" data-theme="'+t.key+'" title="'+t.name+'" style="background:linear-gradient(135deg,'+t.c1+','+t.c2+');"></div>';
    }).join('');
    themePicker.querySelectorAll('.color-swatch').forEach(function(el){
      el.addEventListener('click', function(){
        themePicker.querySelectorAll('.color-swatch').forEach(function(o){ o.classList.remove('selected'); });
        el.classList.add('selected');
      });
    });
  }
  const titleInput = document.getElementById('customTitleInput');
  if(titleInput) titleInput.value = p.customTitle;
  const soundToggle = document.getElementById('stampSoundToggle');
  if(soundToggle) soundToggle.checked = p.soundOn;
}
(function(){
  const overlay = document.getElementById('personalizeOverlay');
  const pmP = document.getElementById('pmPersonalize');
  const saveBtn = document.getElementById('savePersonalize');
  if(!overlay || !pmP) return;
  pmP.addEventListener('click', function(){
    const menuRoot = document.getElementById('profileRoot');
    if(menuRoot) menuRoot.classList.remove('open');
    buildPersonalizeOverlay();
    overlay.classList.add('show');
  });
  if(saveBtn){
    saveBtn.addEventListener('click', function(){
      const selectedAvatar = overlay.querySelector('.avatar-option.selected');
      const selectedTheme = overlay.querySelector('.color-swatch.selected');
      const titleVal = (document.getElementById('customTitleInput').value || '').trim();
      const soundOn = document.getElementById('stampSoundToggle').checked;
      try{
        if(selectedAvatar) localStorage.setItem(personalizeKey('avatarEmoji'), selectedAvatar.dataset.key);
        else localStorage.removeItem(personalizeKey('avatarEmoji'));
        if(titleVal) localStorage.setItem(personalizeKey('customTitle'), titleVal);
        else localStorage.removeItem(personalizeKey('customTitle'));
        if(selectedTheme) localStorage.setItem('accentTheme', selectedTheme.dataset.theme);
        localStorage.setItem('stampSoundOn', soundOn ? '1' : '0');
      }catch(e){}
      applyPersonalization();
      overlay.classList.remove('show');
      if(typeof devToast === 'function') devToast('تم حفظ تخصيصاتك <i class="fa-solid fa-wand-magic-sparkles"></i>');
    });
  }
})();

/* ====== توست احتفالي عام (يُعاد استخدامه للمحطات وذكرى الحساب) ====== */
function showBigToast(text, confettiCount){
  let t = document.getElementById('milestoneToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'milestoneToast';
    document.body.appendChild(t);
  }
  t.innerHTML = text;
  t.classList.add('show');
  if(typeof burstConfetti === 'function') burstConfetti(confettiCount || 70);
  clearTimeout(t._timer);
  t._timer = setTimeout(function(){ t.classList.remove('show'); }, 4200);
}

/* ====== ملخص الأسبوع (Weekly Wrapped) ====== */
function getWeekStartStr(){
  const now = new Date();
  const monday = new Date(now); monday.setDate(now.getDate() - now.getDay());
  return localDateStr(monday);
}
function computeWeeklySummary(){
  const weekStartStr = getWeekStartStr();
  const list = (typeof DB!=='undefined' && DB.vouchers) ? DB.vouchers.filter(function(v){ return v.date >= weekStartStr; }) : [];
  const inCount = list.filter(function(v){ return v.type==='in'; }).length;
  const outCount = list.filter(function(v){ return v.type==='out'; }).length;
  const busiest = computeBusiestStore();
  const totalVouchers = (typeof DB!=='undefined' && DB.vouchers) ? DB.vouchers.length : 0;
  const rank = teamRank(totalVouchers);
  const shortage = computeNoShortageStreak();
  return { weekStartStr:weekStartStr, inCount:inCount, outCount:outCount, busiest:busiest, rank:rank, shortage:shortage };
}
function openWeeklySummary(){
  const overlay = document.getElementById('weeklySummaryOverlay');
  const rangeEl = document.getElementById('weeklySummaryRange');
  const bodyEl = document.getElementById('weeklySummaryBody');
  if(!overlay) return;
  const s = computeWeeklySummary();
  const todayStr = localDateStr(new Date());
  rangeEl.textContent = 'من ' + fmtDate(s.weekStartStr) + ' إلى ' + fmtDate(todayStr);
  let html = '';
  html += '<div class="loc-row"><span class="loc-key">سندات التوريد</span><span class="loc-val">'+s.inCount+'</span></div>';
  html += '<div class="loc-row"><span class="loc-key">سندات الصرف</span><span class="loc-val">'+s.outCount+'</span></div>';
  html += '<div class="loc-row"><span class="loc-key">الأكثر نشاطًا</span><span class="loc-val">'+(s.busiest.store?(STORE_LABELS[s.busiest.store]||s.busiest.store):'—')+'</span></div>';
  html += '<div class="loc-row"><span class="loc-key">مستوى الفريق</span><span class="loc-val">'+s.rank.icon+' '+s.rank.label+'</span></div>';
  html += '<div class="loc-row"><span class="loc-key">أيام بدون نقص</span><span class="loc-val">'+s.shortage.days+' يوم</span></div>';
  bodyEl.innerHTML = html;
  overlay.classList.add('show');
  if(typeof burstConfetti==='function') burstConfetti(40);
}
function maybeShowWeeklySummary(){
  const weekStart = getWeekStartStr();
  let shownFor = null;
  try{ shownFor = localStorage.getItem('weeklySummaryShownFor'); }catch(e){}
  if(shownFor === weekStart) return;
  try{ localStorage.setItem('weeklySummaryShownFor', weekStart); }catch(e){}
  openWeeklySummary();
}
(function(){
  const overlay = document.getElementById('weeklySummaryOverlay');
  const pmW = document.getElementById('pmWeekly');
  const closeBtn = document.getElementById('closeWeeklySummary');
  if(!overlay || !pmW) return;
  pmW.addEventListener('click', function(){
    const menuRoot = document.getElementById('profileRoot');
    if(menuRoot) menuRoot.classList.remove('open');
    openWeeklySummary();
  });
  if(closeBtn) closeBtn.addEventListener('click', function(){ overlay.classList.remove('show'); });
})();

/* ====== شهادة إنجاز نهاية الشهر ====== */
function showMonthCertificate(open, inCount, outCount){
  const overlay = document.getElementById('certificateOverlay');
  const periodEl = document.getElementById('certPeriod');
  const bodyEl = document.getElementById('certBody');
  if(!overlay){ return; }
  const dates = open.map(function(v){ return v.date; }).filter(Boolean).sort();
  const from = dates[0], to = dates[dates.length-1];
  periodEl.textContent = from ? ('الفترة: ' + fmtDate(from) + ' — ' + fmtDate(to)) : '';
  const totalVouchers = (typeof DB!=='undefined' && DB.vouchers) ? DB.vouchers.length : 0;
  const rank = teamRank(totalVouchers);
  let html = '';
  html += '<p style="margin:0 0 8px;">تم إقفال <b>'+open.length+'</b> سند بنجاح (<b>'+inCount+'</b> توريد، <b>'+outCount+'</b> صرف) وترحيلها للأرشيف الدائم.</p>';
  html += '<p style="margin:0;">مستوى الفريق الحالي: <b>'+rank.icon+' '+rank.label+'</b></p>';
  bodyEl.innerHTML = html;
  overlay.classList.add('show');
  if(typeof burstConfetti === 'function') burstConfetti(100);
}
(function(){
  const closeBtn = document.getElementById('closeCertificate');
  if(closeBtn) closeBtn.addEventListener('click', function(){
    document.getElementById('certificateOverlay').classList.remove('show');
  });
})();

/* ====== ذكرى الحساب السنوية ====== */
function maybeShowAnniversary(){
  const email = (typeof currentUserEmail !== 'undefined' && currentUserEmail) ? currentUserEmail : 'guest';
  const key = 'firstLoginDate_' + email;
  const todayStr = localDateStr(new Date());
  let first = null;
  try{ first = localStorage.getItem(key); }catch(e){}
  if(!first){
    try{ localStorage.setItem(key, todayStr); }catch(e){}
    return;
  }
  const [fy,fm,fd] = first.split('-').map(Number);
  const [ty,tm,td] = todayStr.split('-').map(Number);
  if(fm===tm && fd===td && ty>fy){
    const years = ty - fy;
    const alreadyKey = 'anniversaryShown_' + email + '_' + ty;
    let shown = null;
    try{ shown = localStorage.getItem(alreadyKey); }catch(e){}
    if(shown) return;
    try{ localStorage.setItem(alreadyKey, '1'); }catch(e){}
    showBigToast('<i class="fa-solid fa-champagne-glasses"></i> عام كامل معنا! انضممت لأول مرة قبل ' + years + ' ' + (years===1?'سنة':'سنوات') + '، شكرًا على جهودك <i class="fa-solid fa-hands-praying"></i>', 80);
  }
}

/* ====== نصائح طريفة أثناء التحميل ====== */
const BOOT_TIPS = [
  'اضغط / في أي وقت للبحث السريع',
  'كليك يمين يفتح قائمة اختصارات ذكية حسب مكانك',
  'زر n يفتح سند جديد بسرعة',
  'راجع الأوسمة والإنجازات من قائمة حسابك',
  'شريط صحة المخزون يعطيك نظرة سريعة كل صباح',
  'تقدر تخصّص صورتك ولقبك من قائمة حسابك'
];
function randomBootTip(){
  return '<i class="fa-solid fa-lightbulb"></i> ' + BOOT_TIPS[Math.floor(Math.random()*BOOT_TIPS.length)];
}

/* ====== صوت ختم اختياري (Web Audio — بدون ملفات خارجية) ====== */
let _stampAudioCtx = null;
function playStampSound(){
  try{
    const p = (typeof getPersonalization==='function') ? getPersonalization() : { soundOn:false };
    if(!p.soundOn) return;
    if(!_stampAudioCtx) _stampAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _stampAudioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.25);
  }catch(e){}
}

/* ====== مركز الإجراءات: كل شي يحتاج انتباه أمين المستودع في مكان واحد ====== */
function renderActionCenter(){
  const card = document.getElementById('actionCenterCard');
  const list = document.getElementById('actionCenterList');
  const emptyEl = document.getElementById('actionCenterEmpty');
  if(!card || !list) return;
  if(typeof currentRole !== 'undefined' && currentRole !== 'admin'){ card.style.display = 'none'; return; }
  if(typeof DB === 'undefined'){ card.style.display = 'none'; return; }

  const rows = [];
  const pendingReq = (DB.requests||[]).filter(function(r){ return r.status==='pending'; }).length;
  if(pendingReq>0){
    rows.push({ danger:false, ico:'<i class="fa-solid fa-inbox"></i>', html:'<b>'+pendingReq+'</b> '+(pendingReq===1?'طلب صنف':'طلبات أصناف')+' بانتظار موافقتك', action:function(){ switchToTab('requests'); } });
  }
  const missingSigned = (DB.vouchers||[]).filter(function(v){ return !v.closed && !v.signedPhotoUrl; }).length;
  if(missingSigned>0){
    rows.push({ danger:false, ico:'<i class="fa-solid fa-signature"></i>', html:'<b>'+missingSigned+'</b> سند بدون صورة موقّعة بعد', action:function(){ switchToTab('log'); } });
  }
  const noMin = (DB.items||[]).filter(function(i){ return !i.min || i.min<=0; }).length;
  if(noMin>0){
    rows.push({ danger:false, ico:'<i class="fa-solid fa-gear"></i>', html:'<b>'+noMin+'</b> صنف بدون حد أدنى محدّد للتنبيه', action:function(){ switchToTab('items'); } });
  }
  const lowNow = (DB.items||[]).filter(function(i){ return i.min>0 && i.balance<=i.min; }).length;
  if(lowNow>0){
    rows.push({ danger:true, ico:'<i class="fa-solid fa-triangle-exclamation"></i>', html:'<b>'+lowNow+'</b> صنف عند الحد الأدنى أو أقل الآن', action:function(){ switchToTab('items'); } });
  }

  card.style.display = 'block';
  if(rows.length===0){
    list.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  list.innerHTML = rows.map(function(r,idx){
    return '<div class="action-row'+(r.danger?' ar-danger':'')+'" data-idx="'+idx+'">'
      + '<span class="ar-ico">'+r.ico+'</span>'
      + '<span class="ar-text">'+r.html+'</span>'
      + '<button class="btn-ghost btn-sm ar-btn">فتح</button>'
      + '</div>';
  }).join('');
  list.querySelectorAll('.action-row').forEach(function(el, idx){
    const btn = el.querySelector('.ar-btn');
    if(btn) btn.addEventListener('click', function(){ rows[idx].action(); });
  });
}

/* ====== بحث سريع عن صنف من الداشبورد ====== */
function renderQuickSearchResults(query){
  const results = document.getElementById('dashQuickSearchResults');
  if(!results) return;
  if(!query){ results.innerHTML = ''; return; }
  const nq = normName(query);
  const matches = (DB.items||[]).filter(function(i){ return normName(i.name).indexOf(nq) > -1; }).slice(0,8);
  if(matches.length===0){ results.innerHTML = '<div class="qsr-empty">ما فيه صنف مطابق.</div>'; return; }
  results.innerHTML = matches.map(function(i){
    const low = i.min>0 && i.balance<=i.min;
    return '<div class="qsr-item"><span class="qsr-name">'+escapeHtml(i.name)+' <span style="color:var(--ink-soft);font-size:11.5px;">('+(STORE_LABELS[i.store]||i.store)+')</span></span><span class="qsr-bal'+(low?' low':'')+'">'+fmtNum(i.balance)+' '+escapeHtml(i.unit||'')+'</span></div>';
  }).join('');
}
(function(){
  const input = document.getElementById('dashQuickSearch');
  if(!input) return;
  input.addEventListener('input', function(){ renderQuickSearchResults(input.value.trim()); });
})();

/* ====== ملاحظات سريعة شخصية (تُحفظ محليًا لكل مستخدم) ====== */
function stickyNoteKey(){
  const email = (typeof currentUserEmail !== 'undefined' && currentUserEmail) ? currentUserEmail : 'guest';
  return 'stickyNote_' + email;
}
function reloadStickyNote(){
  const ta = document.getElementById('dashStickyNote');
  if(!ta) return;
  try{ ta.value = localStorage.getItem(stickyNoteKey()) || ''; }catch(e){}
}
(function(){
  const ta = document.getElementById('dashStickyNote');
  const hint = document.getElementById('stickyNoteSaved');
  if(!ta) return;
  reloadStickyNote();
  let saveTimer = null;
  ta.addEventListener('input', function(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      try{ localStorage.setItem(stickyNoteKey(), ta.value); }catch(e){}
      if(hint){
        hint.innerHTML = '<i class="fa-solid fa-check"></i> تم الحفظ';
        hint.classList.add('show');
        clearTimeout(hint._t);
        hint._t = setTimeout(function(){ hint.classList.remove('show'); }, 1500);
      }
    }, 500);
  });
})();

/* ====== مقارنة الشهر الحالي بالشهر الماضي ====== */
function computeMonthComparison(){
  const cur = currentMonthStr();
  const prev = shiftMonthStr(cur, -1);
  const curList = vouchersInMonth(cur);
  const prevList = vouchersInMonth(prev);
  return {
    curIn: curList.filter(function(v){return v.type==='in';}).length,
    curOut: curList.filter(function(v){return v.type==='out';}).length,
    prevIn: prevList.filter(function(v){return v.type==='in';}).length,
    prevOut: prevList.filter(function(v){return v.type==='out';}).length
  };
}
function deltaHtml(cur, prev){
  if(prev===0){
    if(cur===0) return '<span class="cmp-delta flat">— بدون تغيّر</span>';
    return '<span class="cmp-delta up">▲ جديد</span>';
  }
  const pct = Math.round(((cur-prev)/prev)*100);
  if(pct===0) return '<span class="cmp-delta flat">— بدون تغيّر</span>';
  const cls = pct>0 ? 'up' : 'down';
  const arrow = pct>0 ? '▲' : '▼';
  return '<span class="cmp-delta '+cls+'">'+arrow+' '+Math.abs(pct)+'%</span>';
}
function renderCompareStrip(){
  const el = document.getElementById('compareStrip');
  if(!el || typeof DB === 'undefined') return;
  const c = computeMonthComparison();
  el.innerHTML =
      '<div class="cmp-item"><div class="cmp-label">سندات التوريد هذا الشهر</div><div class="cmp-value">'+c.curIn+' '+deltaHtml(c.curIn,c.prevIn)+'</div></div>'
    + '<div class="cmp-item"><div class="cmp-label">سندات الصرف هذا الشهر</div><div class="cmp-value">'+c.curOut+' '+deltaHtml(c.curOut,c.prevOut)+'</div></div>';
}

/* ====== رسم بياني شهري (آخر 6 أشهر) ====== */
function computeMonthlyChartData(){
  const months = [];
  const cur = currentMonthStr();
  for(let i=5;i>=0;i--){ months.push(shiftMonthStr(cur, -i)); }
  return months.map(function(m){
    const list = vouchersInMonth(m);
    return { month:m, inCount: list.filter(function(v){return v.type==='in';}).length, outCount: list.filter(function(v){return v.type==='out';}).length };
  });
}
function monthShortLabel(m){
  const parts = m.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return names[parseInt(parts[1],10)-1] || m;
}
function renderMonthlyChart(){
  const el = document.getElementById('monthlyChart');
  if(!el || typeof DB === 'undefined') return;
  const data = computeMonthlyChartData();
  const maxVal = Math.max.apply(null, data.map(function(d){return Math.max(d.inCount, d.outCount);}).concat([1]));
  const barsHtml = data.map(function(d){
    const inH = Math.max(2, Math.round((d.inCount/maxVal)*90));
    const outH = Math.max(2, Math.round((d.outCount/maxVal)*90));
    return '<div class="mbc-col">'
      + '<div class="mbc-bars">'
      + '<div class="mbc-bar mbc-in" style="height:'+inH+'px;" title="وارد: '+d.inCount+'"></div>'
      + '<div class="mbc-bar mbc-out" style="height:'+outH+'px;" title="صادر: '+d.outCount+'"></div>'
      + '</div>'
      + '<div class="mbc-month">'+monthShortLabel(d.month)+'</div>'
      + '</div>';
  }).join('');
  el.innerHTML = '<div class="month-bar-chart">'+barsHtml+'</div>'
    + '<div class="mbc-legend"><span><i style="background:var(--stamp-in);"></i>وارد</span><span><i style="background:var(--stamp-out);"></i>صادر</span></div>';
}

/* ====== الأصناف الأكثر حركة هذا الشهر ====== */
function computeTopItems(){
  if(typeof DB === 'undefined') return [];
  const monthStr = currentMonthStr();
  const list = vouchersInMonth(monthStr);
  const totals = {};
  list.forEach(function(v){
    v.lines.forEach(function(l){
      const key = l.itemId || l.name;
      if(!totals[key]) totals[key] = { name:l.name, qtyIn:0, qtyOut:0 };
      if(v.type==='in') totals[key].qtyIn += l.qty; else totals[key].qtyOut += l.qty;
    });
  });
  return Object.keys(totals).map(function(k){
    const t = totals[k];
    return { name:t.name, qtyIn:t.qtyIn, qtyOut:t.qtyOut, qty:t.qtyIn+t.qtyOut };
  }).sort(function(a,b){ return b.qty - a.qty; }).slice(0,5);
}
function renderTopItems(){
  const el = document.getElementById('topItemsList');
  if(!el) return;
  const top = computeTopItems();
  if(top.length===0){ el.innerHTML = '<div class="qsr-empty">ما فيه حركة مسجّلة هذا الشهر بعد.</div>'; return; }
  el.innerHTML = top.map(function(t,idx){
    return '<div class="top-row"><span class="tr-rank">'+(idx+1)+'</span>'
      + '<span class="tr-name">'+escapeHtml(t.name)+'<span class="tr-breakdown">توريد '+fmtNum(t.qtyIn)+' · صرف '+fmtNum(t.qtyOut)+'</span></span>'
      + '<span class="tr-val" title="إجمالي الحركة (توريد + صرف)">'+fmtNum(t.qty)+'</span></div>';
  }).join('');
}

/* ====== الموردون الأكثر تعاملاً هذا الشهر ====== */
function computeTopSuppliers(){
  if(typeof DB === 'undefined') return [];
  const monthStr = currentMonthStr();
  const list = vouchersInMonth(monthStr).filter(function(v){ return v.type==='in' && v.party; });
  const totals = {};
  list.forEach(function(v){
    const key = v.party.trim();
    if(!key) return;
    totals[key] = (totals[key]||0) + 1;
  });
  return Object.keys(totals).map(function(k){ return { name:k, count:totals[k] }; }).sort(function(a,b){ return b.count - a.count; }).slice(0,5);
}
function renderTopSuppliers(){
  const el = document.getElementById('topSuppliersList');
  if(!el) return;
  const top = computeTopSuppliers();
  if(top.length===0){ el.innerHTML = '<div class="qsr-empty">ما فيه موردين مسجّلين هذا الشهر بعد.</div>'; return; }
  el.innerHTML = top.map(function(t,idx){
    return '<div class="top-row"><span class="tr-rank">'+(idx+1)+'</span><span class="tr-name">'+escapeHtml(t.name)+'</span><span class="tr-val">'+t.count+' سند</span></div>';
  }).join('');
}

/* ====== اختصارات: متابعة آخر سند + تصدير حركة اليوم ====== */
(function(){
  const lastBtn = document.getElementById('dashLastVoucherBtn');
  if(lastBtn) lastBtn.addEventListener('click', function(){
    if(!DB.vouchers || DB.vouchers.length===0){ showAppAlert('ما فيه أي سندات مسجّلة بعد.'); return; }
    openVoucherDetail(DB.vouchers[0].id);
  });
  const expBtn = document.getElementById('dashExportTodayBtn');
  if(expBtn) expBtn.addEventListener('click', function(){
    const todayS = todayStr();
    const list = (DB.vouchers||[]).filter(function(v){ return v.date === todayS; });
    if(list.length===0){ showAppAlert('ما فيه أي سندات مسجّلة اليوم لتصديرها.'); return; }
    try{
      const rows = [];
      list.forEach(function(v){
        v.lines.forEach(function(l){
          rows.push({
            'رقم السند': v.number, 'النوع': v.type==='in'?'توريد':'صرف', 'المخزن': STORE_LABELS[l.store]||l.store,
            'الصنف': l.name, 'الكمية': l.qty, 'الوحدة': l.unit
          });
        });
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'حركة اليوم');
      XLSX.writeFile(wb, 'حركة-اليوم-' + todayS + '.xlsx');
    }catch(e){ showErr('تعذر إنشاء ملف Excel.', e); }
  });
})();

/* ====== أشرطة إحصائية لصفحات: الأصناف، الجودة، الأرشيف، الإعدادات، سجل السندات ====== */

function kpiTile(cls, ico, label, value, isCount){
  const valHtml = isCount ? ('<div class="kpi-value" data-count="'+value+'">0</div>') : ('<div class="kpi-value" style="font-size:15px;">'+value+'</div>');
  return '<div class="kpi-tile '+cls+'">'
    + '<div class="kpi-head"><span class="kpi-ico">'+ico+'</span><span class="kpi-label">'+label+'</span></div>'
    + valHtml
    + '</div>';
}

function renderItemsStats(){
  const el = document.getElementById('itemsStatsStrip');
  if(!el || typeof DB === 'undefined') return;
  const total = DB.items.length;
  const low = DB.items.filter(function(i){ return i.min>0 && i.balance<=i.min; }).length;
  const noMin = DB.items.filter(function(i){ return !i.min || i.min<=0; }).length;
  const noBarcode = DB.items.filter(function(i){ return !i.barcode; }).length;
  el.innerHTML =
      kpiTile('kpi-items','<i class="fa-solid fa-box"></i>','إجمالي الأصناف', total, true)
    + kpiTile('kpi-low','<i class="fa-solid fa-triangle-exclamation"></i>','عند الحد الأدنى أو أقل', low, true)
    + kpiTile('kpi-out','<i class="fa-solid fa-gear"></i>','بدون حد أدنى محدّد', noMin, true)
    + kpiTile('kpi-in','<i class="fa-solid fa-tag"></i>','بدون باركود', noBarcode, true);
  animateCounters(el);
}

function renderQualityStats(){
  const el = document.getElementById('qualityStatsStrip');
  if(!el || typeof DB === 'undefined') return;
  const total = DB.quality.length;
  const monthStr = currentMonthStr();
  const thisMonth = DB.quality.filter(function(q){ return (q.date||'').slice(0,7)===monthStr; }).length;
  let lastDate = null;
  DB.quality.forEach(function(q){ if(q.date && (!lastDate || q.date>lastDate)) lastDate = q.date; });

  const stores = ['freezer','pantry','cleaning'];
  let worstStore = null, worstDays = -1;
  stores.forEach(function(s){
    let last = null;
    DB.quality.forEach(function(q){ if(q.store===s && q.date && (!last || q.date>last)) last = q.date; });
    let days;
    if(!last){ days = Infinity; }
    else{
      const [ly,lm,ld] = last.split('-').map(Number);
      const lastD = new Date(ly, lm-1, ld);
      const today = new Date(); today.setHours(0,0,0,0);
      days = Math.round((today - lastD) / 86400000);
    }
    if(days > worstDays){ worstDays = days; worstStore = s; }
  });
  const worstText = (worstDays===Infinity) ? 'لا يوجد فحص بعد' : (worstDays+' يوم — '+(STORE_LABELS[worstStore]||worstStore));

  el.innerHTML =
      kpiTile('kpi-items','<i class="fa-solid fa-camera"></i>','إجمالي التقييمات', total, true)
    + kpiTile('kpi-in','<i class="fa-solid fa-calendar-days"></i>','تقييمات هذا الشهر', thisMonth, true)
    + kpiTile('kpi-out','<i class="fa-solid fa-stopwatch"></i>','أطول فترة بدون فحص', worstText, false)
    + kpiTile('kpi-low','<i class="fa-solid fa-calendar-days"></i>','آخر تقييم مسجّل', lastDate?fmtDate(lastDate):'لا يوجد بعد', false);
  animateCounters(el);
}

function renderInvoicesStats(){
  const el = document.getElementById('invoicesStatsStrip');
  if(!el || typeof DB === 'undefined') return;
  const total = DB.invoices.length;
  const supplier = DB.invoices.filter(function(v){ return v.docType==='supplier'; }).length;
  const issue = DB.invoices.filter(function(v){ return v.docType==='issue'; }).length;
  const purchase = DB.invoices.filter(function(v){ return v.docType==='purchase_request'; }).length;
  el.innerHTML =
      kpiTile('kpi-items','<i class="fa-solid fa-box-archive"></i>','إجمالي الفواتير المؤرشفة', total, true)
    + kpiTile('kpi-in','<i class="fa-solid fa-inbox"></i>','فواتير الموردين', supplier, true)
    + kpiTile('kpi-out','<i class="fa-solid fa-paper-plane"></i>','سندات الصرف', issue, true)
    + kpiTile('kpi-low','<i class="fa-solid fa-pen-to-square"></i>','سندات طلب الشراء', purchase, true);
  animateCounters(el);
}

function renderSettingsStats(){
  const el = document.getElementById('settingsStatsStrip');
  if(!el || typeof DB === 'undefined') return;
  const totalItems = DB.items.length;
  const openVouchers = DB.vouchers.filter(function(v){ return !v.closed; }).length;
  const closedVouchers = DB.vouchers.filter(function(v){ return v.closed; }).length;
  const totalInvoices = DB.invoices.length;
  el.innerHTML =
      kpiTile('kpi-items','<i class="fa-solid fa-box"></i>','إجمالي الأصناف', totalItems, true)
    + kpiTile('kpi-in','<i class="fa-solid fa-receipt"></i>','سندات مفتوحة (الشهر الحالي)', openVouchers, true)
    + kpiTile('kpi-out','<i class="fa-solid fa-lock"></i>','سندات مؤرشفة (مقفلة)', closedVouchers, true)
    + kpiTile('kpi-low','<i class="fa-solid fa-box-archive"></i>','فواتير مؤرشفة', totalInvoices, true);
  animateCounters(el);
}

function renderLogStats(){
  const el = document.getElementById('logStatsStrip');
  if(!el || typeof DB === 'undefined') return;
  const openVouchers = DB.vouchers.filter(function(v){ return !v.closed; }).length;
  const closedVouchers = DB.vouchers.filter(function(v){ return v.closed; }).length;
  const monthStr = currentMonthStr();
  const thisMonth = DB.vouchers.filter(function(v){ return (v.date||'').slice(0,7)===monthStr; }).length;
  el.innerHTML =
      kpiTile('kpi-in','<i class="fa-solid fa-receipt"></i>','سندات مفتوحة حاليًا', openVouchers, true)
    + kpiTile('kpi-out','<i class="fa-solid fa-lock"></i>','سندات مؤرشفة (مقفلة)', closedVouchers, true)
    + kpiTile('kpi-items','<i class="fa-solid fa-calendar-days"></i>','سندات هذا الشهر', thisMonth, true);
  animateCounters(el);
}
