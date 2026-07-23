(() => {
'use strict';

function removeDuplicateTopNavigation(){
  document.querySelectorAll('header .nav, header .actions, .top-nav, .top-navigation, .desktop-nav, .main-nav, .navbar-nav')
    .forEach(element=>element.remove());

  document.querySelectorAll('header button').forEach(button=>button.remove());
}
removeDuplicateTopNavigation();
window.addEventListener('DOMContentLoaded',removeDuplicateTopNavigation);

const cfg=window.CREATORSIN_CONFIG||{};
const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const main=$('#main'), gate=$('#authGate'), toast=$('#toast');
let authMode='signup', user=null, profile=null, members=[], connections=[], requests=[], follows=[], conversations=[], activeConversation=null, messageChannel=null, typingChannel=null, inboxChannel=null, typingTimer=null, currentChatOther=null, activeProfileId=null, activeProfileTab='posts';
const EMPTY='data:image/svg+xml;charset=utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="60" fill="#dceeff"/><circle cx="60" cy="45" r="22" fill="#58aaff"/><path d="M22 110c8-29 23-42 38-42s30 13 38 42" fill="#58aaff"/></svg>');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showToast(t){toast.textContent=t;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200)}
function modal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modalWrap').classList.remove('hidden')}
function closeModal(){$('#modalWrap').classList.add('hidden')}
$('#modalClose').onclick=closeModal;$('#modalWrap').onclick=e=>{if(e.target.id==='modalWrap')closeModal()};
function setTheme(next){
  const theme=next==='dark'?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.body.classList.toggle('dark',theme==='dark');
  localStorage.setItem('creatorsin-theme-choice',theme);
  localStorage.setItem('cin_theme',theme);
  
}
if(localStorage.getItem('creatorsin-light-default-v2')!=='done'){
  localStorage.setItem('creatorsin-theme-choice','light');
  localStorage.setItem('cin_theme','light');
  localStorage.setItem('creatorsin-light-default-v2','done');
}
setTheme(localStorage.getItem('creatorsin-theme-choice')||localStorage.getItem('cin_theme')||'light');

function setAuthMode(mode){authMode=mode;$$('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===mode));$('#authTitle').textContent=mode==='signup'?'Create your account':'Welcome back';$('#emailBtn').textContent=mode==='signup'?'Create account':'Log in';$('#nameInput').classList.toggle('hidden',mode==='login');$('#typeInput').classList.toggle('hidden',mode==='login');$('#authMsg').textContent=''}
$$('[data-auth]').forEach(b=>b.onclick=()=>setAuthMode(b.dataset.auth));
async function oauth(provider){const {error}=await sb.auth.signInWithOAuth({provider,options:{redirectTo:cfg.SITE_URL||location.origin}});if(error)$('#authMsg').textContent=error.message}
$('#googleBtn').onclick=()=>oauth('google');$('#appleBtn').onclick=()=>oauth('apple');
$('#emailBtn').onclick=async()=>{
  const button=$('#emailBtn');
  const email=$('#emailInput').value.trim();
  const password=$('#passwordInput').value;
  const name=$('#nameInput').value.trim();
  const account_type=$('#typeInput').value;
  $('#authMsg').textContent='';

  if(!email)return $('#authMsg').textContent='Enter your email address.';
  if(password.length<8)return $('#authMsg').textContent='Password must be at least 8 characters.';
  if(authMode==='signup'&&!name)return $('#authMsg').textContent='Enter your full name.';

  const original=button.textContent;
  button.disabled=true;
  button.classList.add('button-loading');
  button.textContent=authMode==='signup'?'Creating account…':'Logging in…';

  try{
    const result=authMode==='signup'
      ?await sb.auth.signUp({
          email,
          password,
          options:{
            data:{full_name:name,account_type},
            emailRedirectTo:cfg.SITE_URL||location.origin
          }
        })
      :await sb.auth.signInWithPassword({email,password});

    if(result.error){
      $('#authMsg').textContent=result.error.message;
      return
    }

    if(!result.data.session){
      $('#authMsg').textContent='Check your email to confirm your account, then return and log in.';
      return
    }

    $('#authMsg').textContent='Success. Loading your account…';
    await init()
  }catch(error){
    $('#authMsg').textContent=error?.message||'Something went wrong. Please try again.';
  }finally{
    button.disabled=false;
    button.classList.remove('button-loading');
    button.textContent=original
  }
};

['emailInput','passwordInput','nameInput'].forEach(id=>{
  $('#'+id)?.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      $('#emailBtn')?.click()
    }
  })
});


async function ensureProfile(){
  if(!user?.id)throw new Error('No signed-in user was found.');

  const md=user.user_metadata||{};
  const fallbackName=(md.full_name||md.name||user.email?.split('@')[0]||'Creator').trim();
  const fallbackType=['creator','brand','agency'].includes(md.account_type)?md.account_type:'creator';

  let {data:existing,error:readError}=await sb
    .from('profiles')
    .select('*')
    .eq('id',user.id)
    .maybeSingle();

  if(readError)throw new Error(`Profile could not be loaded: ${readError.message}`);

  if(!existing){
    const base=(fallbackName||'creator')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,'.')
      .replace(/^\.+|\.+$/g,'')
      .slice(0,28)||'creator';

    const candidate=`${base}.${user.id.slice(0,4)}`;

    const payload={
      id:user.id,
      email:user.email,
      full_name:fallbackName,
      username:candidate,
      account_type:fallbackType,
      avatar_url:md.avatar_url||md.picture||null,
      is_discoverable:true
    };

    const {error:createError}=await sb.from('profiles').insert(payload);

    if(createError){
      // A concurrent auth refresh may have created the row already.
      const {data:retry,error:retryError}=await sb
        .from('profiles')
        .select('*')
        .eq('id',user.id)
        .maybeSingle();

      if(retryError||!retry){
        throw new Error(`Profile could not be created: ${createError.message}`);
      }
      existing=retry;
    }else{
      const {data:created,error:createdError}=await sb
        .from('profiles')
        .select('*')
        .eq('id',user.id)
        .single();

      if(createdError)throw new Error(`Profile was created but could not be opened: ${createdError.message}`);
      existing=created;
    }
  }

  profile=existing;
}
function syncIdentity(){if(!profile)return;$('#sideName').textContent=profile.full_name;$('#sideType').textContent=(profile.is_founder?'Founder · ':'')+(profile.account_type||'creator');$('#sideAvatar').src=profile.avatar_url||EMPTY}
function setPage(page){
  $$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  const pages={feed,discover,messages:messagesPage,opportunities:opportunitiesPage,followingFeed:followingFeedPage,bookmarks:bookmarksPage,profile:profilePage};
  const handler=pages[page];
  if(typeof handler==='function')return handler();
  main.innerHTML=`<section class="card empty"><h2>Page unavailable</h2><p class="muted">This section could not load. Return Home and try again.</p><button class="primary" data-page="feed">Return Home</button></section>`
}
$$('[data-page]').forEach(b=>b.onclick=()=>setPage(b.dataset.page));

function renderPostText(text){
  return esc(text).replace(/(^|\s)@([A-Za-z0-9_.-]+)/g,'$1<span class="mention">@$2</span>').replace(/\n/g,'<br>');
}
function validHttpUrl(value){
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.toString():null}catch{return null}
}
async function uploadPostMedia(file){
  if(!file)return null;
  if(!file.type.startsWith('image/')&&!file.type.startsWith('video/'))throw new Error('Choose an image or video.');
  const limit=file.type.startsWith('video/')?80*1024*1024:12*1024*1024;
  if(file.size>limit)throw new Error(file.type.startsWith('video/')?'Videos must be under 80 MB.':'Images must be under 12 MB.');
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=`${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const {error}=await sb.storage.from('post-media').upload(path,file,{contentType:file.type,upsert:false});
  if(error)throw error;
  const {data}=sb.storage.from('post-media').getPublicUrl(path);
  return {url:data.publicUrl,type:file.type.startsWith('video/')?'video':'image'};
}
async function loadTimeline(filter='for-you'){
  const [{data:posts,error:postError},{data:jobs,error:jobError}]=await Promise.all([
    sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').order('created_at',{ascending:false}),
    sb.from('opportunities').select('id,business_id,title,description,opportunity_type,compensation,platforms,location,deadline,status,created_at,profiles!opportunities_business_id_fkey(full_name,username,avatar_url,is_verified,is_founder)').eq('status','open').order('created_at',{ascending:false})
  ]);
  if(postError)throw postError;
  const social=(posts||[]).map(x=>({...x,kind:'post'}));
  const opportunities=jobError?[]:(jobs||[]).map(x=>({...x,kind:'job'}));
  let items=[...social,...opportunities].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  if(filter==='following'){
    const followedIds=follows.map(f=>f.following_id);
    items=items.filter(x=>{
      const ownerId=x.kind==='post'?x.user_id:x.business_id;
      return ownerId===user.id||followedIds.includes(ownerId);
    });
  }
  return items;
}

function currentMentionQuery(textarea){
  const cursor=textarea.selectionStart;
  const before=textarea.value.slice(0,cursor);
  const match=before.match(/(^|\s)@([A-Za-z0-9_.-]*)$/);
  if(!match)return null;
  return {query:match[2].toLowerCase(),start:cursor-match[2].length-1,end:cursor};
}

function updateMentionChips(textarea){
  const box=$('#mentionChips');
  if(!box)return;
  const usernames=[...textarea.value.matchAll(/(^|\s)@([A-Za-z0-9_.-]+)/g)].map(m=>m[2]);
  const unique=[...new Set(usernames)];
  if(!unique.length){box.classList.add('hidden');box.innerHTML='';return}
  box.innerHTML=unique.map(name=>`<span class="mention-chip">@${esc(name)}</span>`).join('');
  box.classList.remove('hidden');
}

function setupMentionAutocomplete(textarea,menu){
  let results=[],activeIndex=0;
  const hide=()=>{menu.classList.add('hidden');menu.innerHTML='';results=[];activeIndex=0};
  const render=()=>{
    const mention=currentMentionQuery(textarea);
    if(!mention)return hide();
    results=(members||[])
      .filter(m=>{
        const sameId=m.id===user.id;
        const sameEmail=(m.email||'').toLowerCase()===(profile.email||user.email||'').toLowerCase();
        const sameVisibleProfile=(m.full_name||'').trim().toLowerCase()===(profile.full_name||'').trim().toLowerCase();
        return !sameId&&!sameEmail&&!sameVisibleProfile;
      })
      .filter(m=>{
        const username=(m.username||'').toLowerCase();
        const name=(m.full_name||'').toLowerCase();
        return !mention.query||username.includes(mention.query)||name.includes(mention.query)
      })
      .slice(0,50);
    if(!results.length){
      menu.innerHTML='<div class="mention-empty">No members found</div>';
      menu.classList.remove('hidden');
      return;
    }
    menu.innerHTML=results.map((m,i)=>`<button type="button" class="mention-option ${i===activeIndex?'active':''}" data-mention-index="${i}">
      <img class="avatar" src="${esc(m.avatar_url||EMPTY)}">
      <div><strong>${esc(m.full_name||'Member')}</strong><div class="muted">@${esc(m.username||'member')} · ${esc(m.account_type||'member')}</div></div>
    </button>`).join('');
    menu.classList.remove('hidden');
    $$('[data-mention-index]').forEach(b=>b.onmousedown=e=>{e.preventDefault();insertMention(Number(b.dataset.mentionIndex))});
  };
  const insertMention=index=>{
    const mention=currentMentionQuery(textarea);
    const m=results[index];
    if(!mention||!m)return;
    const username=m.username||m.full_name.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
    textarea.value=textarea.value.slice(0,mention.start)+'@'+username+' '+textarea.value.slice(mention.end);
    const pos=mention.start+username.length+2;
    textarea.focus();
    textarea.setSelectionRange(pos,pos);
    updateMentionChips(textarea);
    hide();
  };
  textarea.addEventListener('input',()=>{updateMentionChips(textarea);render()});
  textarea.addEventListener('keydown',e=>{
    if(menu.classList.contains('hidden'))return;
    if(e.key==='ArrowDown'){e.preventDefault();activeIndex=(activeIndex+1)%Math.max(results.length,1);render()}
    else if(e.key==='ArrowUp'){e.preventDefault();activeIndex=(activeIndex-1+Math.max(results.length,1))%Math.max(results.length,1);render()}
    else if((e.key==='Enter'||e.key==='Tab')&&results.length){e.preventDefault();insertMention(activeIndex)}
    else if(e.key==='Escape')hide()
  });
  textarea.addEventListener('blur',()=>setTimeout(hide,120));
}

async function dashboardPage(){
  await loadSocial();
  const [{count:postCount},{count:followerCount},{count:followingCount},{count:applicationCount},{data:unreadRows},{data:recentOpportunities},{data:pinnedRows}]=await Promise.all([
    sb.from('posts').select('*',{count:'exact',head:true}).eq('user_id',user.id),
    sb.from('follows').select('*',{count:'exact',head:true}).eq('following_id',user.id),
    sb.from('follows').select('*',{count:'exact',head:true}).eq('follower_id',user.id),
    sb.from('applications').select('*',{count:'exact',head:true}).eq('applicant_id',user.id),
    sb.from('messages').select('id').neq('sender_id',user.id).is('read_at',null),
    sb.from('opportunities').select('id,title,description,compensation,platforms,location,created_at,profiles!opportunities_business_id_fkey(full_name,avatar_url)').eq('status','open').order('created_at',{ascending:false}).limit(4),
    sb.from('profile_pinned_posts').select('post_id').eq('profile_id',user.id)
  ]);
  const fields=[profile.full_name,profile.username,profile.headline,profile.bio,profile.avatar_url,profile.niche,profile.location,profile.website_url];
  const socials=[profile.instagram_url,profile.tiktok_url,profile.youtube_url,profile.twitch_url,profile.x_url,profile.linkedin_url,profile.discord_url];
  const complete=fields.filter(Boolean).length+(socials.some(Boolean)?1:0)+((pinnedRows||[]).length?1:0);
  const strength=Math.min(100,Math.round((complete/(fields.length+2))*100));
  const hour=new Date().getHours(),greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
  const suggestions=members.filter(m=>!follows.some(f=>f.following_id===m.id)).slice(0,4);
  const tasks=[
    !profile.avatar_url&&{icon:'📷',title:'Add a profile picture',copy:'Help brands recognize and trust your profile.',action:'Profile',page:'profile'},
    strength<90&&{icon:'✨',title:'Complete your creator portfolio',copy:`Your profile is ${strength}% complete.`,action:'Improve profile',page:'profile'},
    !(pinnedRows||[]).length&&{icon:'📌',title:'Pin your best content',copy:'Show brands your strongest posts first.',action:'View posts',page:'profile'},
    !(postCount||0)&&{icon:'✍️',title:'Publish your first post',copy:'Share your work, ideas, or a recent creator win.',action:'Create post',page:'feed'},
    (unreadRows||[]).length>0&&{icon:'💬',title:'Reply to your inbox',copy:`You have ${(unreadRows||[]).length} unread message${(unreadRows||[]).length===1?'':'s'}.`,action:'Open inbox',page:'messages'},
    {icon:'💼',title:'Review new opportunities',copy:'Look for work that matches your niche.',action:'Open marketplace',page:'opportunities'}
  ].filter(Boolean).slice(0,5);
  main.innerHTML=`<div class="dashboard-page"><section class="card dashboard-hero"><h1>${greeting}, ${esc((profile.full_name||'Creator').split(' ')[0])}!</h1><p class="muted">Here is what is happening with your creator profile today.</p><div class="dashboard-actions"><button class="primary" data-dashboard-page="profile">Build Profile</button><button class="secondary" data-dashboard-page="opportunities">Find Opportunities</button><button class="secondary" data-dashboard-page="messages">Open Inbox</button></div></section><div class="dashboard-grid"><section class="card dashboard-stat"><strong>${followerCount||0}</strong><span>Followers</span></section><section class="card dashboard-stat"><strong>${followingCount||0}</strong><span>Following</span></section><section class="card dashboard-stat"><strong>${postCount||0}</strong><span>Posts</span></section><section class="card dashboard-stat"><strong>${applicationCount||0}</strong><span>Applications</span></section></div><div class="dashboard-layout"><div style="display:grid;gap:16px"><section class="card dashboard-card"><div class="profile-section-head"><div><h2>Your next steps</h2><p class="muted">Actions that strengthen your creator profile.</p></div></div>${tasks.map(t=>`<div class="dashboard-task"><div class="dashboard-task-icon">${t.icon}</div><div><strong>${esc(t.title)}</strong><div class="muted">${esc(t.copy)}</div></div><button class="secondary" data-dashboard-page="${t.page}">${esc(t.action)}</button></div>`).join('')}</section><section class="card dashboard-card"><div class="profile-section-head"><div><h2>Opportunities for you</h2><p class="muted">Newest real opportunities on CreatorsIn.</p></div><button class="secondary" data-dashboard-page="opportunities">View all</button></div>${(recentOpportunities||[]).length?(recentOpportunities||[]).map(o=>`<div class="dashboard-opportunity"><strong>${esc(o.title)}</strong><div class="muted">${esc(o.profiles?.full_name||'Business')} · ${formatRelativeTime(o.created_at)}</div><p>${esc(o.description||'')}</p></div>`).join(''):`<div class="profile-empty"><p class="muted">No open opportunities yet.</p></div>`}</section></div><div style="display:grid;gap:16px;align-content:start"><section class="card dashboard-card"><div class="profile-section-head"><div><h2>Profile strength</h2><p class="muted">Make your creator profile easier to hire.</p></div><strong>${strength}%</strong></div><div class="dashboard-progress"><i style="width:${strength}%"></i></div><button class="primary" data-dashboard-page="profile" style="width:100%;margin-top:15px">Improve Profile</button></section><section class="card dashboard-card"><div class="profile-section-head"><div><h2>People to know</h2><p class="muted">Profiles worth exploring.</p></div></div>${suggestions.length?suggestions.map(m=>`<div class="dashboard-person"><img src="${esc(m.avatar_url||EMPTY)}"><div style="min-width:0;flex:1"><button class="profile-link" data-profile-id="${m.id}"><strong>${esc(m.full_name)}</strong></button><div class="muted">@${esc(m.username||'member')} · ${esc(m.headline||m.account_type||'member')}</div></div></div>`).join(''):`<p class="muted">No suggestions yet.</p>`}<button class="secondary" data-dashboard-page="discover" style="width:100%;margin-top:12px">Open Discover</button></section><section class="card dashboard-card"><h2 style="margin-top:0">Inbox</h2><p class="muted">${(unreadRows||[]).length?`You have ${(unreadRows||[]).length} unread message${(unreadRows||[]).length===1?'':'s'}.`:'You are all caught up.'}</p><button class="secondary" data-dashboard-page="messages" style="width:100%">Open Inbox</button></section></div></div></div>`;
  $$('[data-dashboard-page]').forEach(b=>b.onclick=()=>setPage(b.dataset.dashboardPage));
  bindProfileLinks();
}


async function renderModernHomeSidebar(){
  const peopleBox=$('#whoToFollowWidget');
  const opportunityBox=$('#trendingOpportunitiesWidget');
  if(!peopleBox||!opportunityBox||!user)return;

  const suggestions=(members||[]).filter(m=>m.id!==user.id&&!follows.some(f=>f.following_id===m.id)).slice(0,4);
  peopleBox.innerHTML=suggestions.length?suggestions.map(m=>`<div class="widget-person">
    <img class="widget-avatar" src="${esc(m.avatar_url||EMPTY)}">
    <div class="widget-copy"><button class="profile-link" data-profile-id="${m.id}"><strong>${esc(m.full_name)} ${m.is_verified?'<span class="verified">✓</span>':''}</strong></button><span class="muted">@${esc(m.username||'member')}</span></div>
    <button class="primary widget-action" data-widget-follow="${m.id}">Follow</button>
  </div>`).join(''):'<div class="empty-widget"><p class="muted">No new suggestions right now.</p></div>';

  $$('[data-widget-follow]').forEach(button=>button.onclick=async()=>{
    const {error}=await sb.from('follows').insert({follower_id:user.id,following_id:button.dataset.widgetFollow});
    if(error)return showToast(error.message);
    showToast('Following creator');
    await loadSocial();
    renderModernHomeSidebar()
  });

  const {data,error}=await sb.from('opportunities')
    .select('id,title,compensation,business_id,profiles:opportunities_business_id_fkey(full_name,avatar_url,is_verified)')
    .eq('status','open').order('created_at',{ascending:false}).limit(4);

  opportunityBox.innerHTML=error
    ?'<div class="empty-widget"><p class="muted">Opportunities could not load.</p></div>'
    :(data||[]).length?(data||[]).map(o=>`<div class="widget-opportunity">
      <img class="widget-logo" src="${esc(o.profiles?.avatar_url||EMPTY)}">
      <div class="widget-copy"><strong>${esc(o.profiles?.full_name||'Brand')}</strong><span class="muted">${esc(o.title)}</span>${o.compensation?`<span class="muted">${esc(o.compensation)}</span>`:''}</div>
      <button class="secondary widget-action" data-page="opportunities">View</button>
    </div>`).join(''):'<div class="empty-widget"><p class="muted">No open opportunities yet.</p></div>';

  bindProfileLinks()
}

async function feed(){
  await loadSocial();
  main.innerHTML=`<div class="social-shell">
    <div class="feed-tabs"><button class="active" data-feed-filter="for-you">For you</button><button data-feed-filter="following">My network</button></div>
    <section class="card social-composer">
      <div class="composer-main"><img class="avatar" src="${esc(profile.avatar_url||EMPTY)}"><div class="mention-wrap"><textarea id="postText" maxlength="5000" placeholder="What’s happening in the creator world? Type @ to tag someone."></textarea><div class="mention-chips hidden" id="mentionChips"></div><div class="mention-menu hidden" id="mentionMenu"></div></div></div>
      <div class="link-box hidden" id="linkBox"><input class="field" id="postLink" placeholder="https://example.com"><button class="secondary" id="removeLinkBtn">Remove</button></div>
      <div class="media-preview hidden" id="mediaPreview"></div>
      <div class="upload-progress" id="uploadStatus"></div>
      <div class="composer-toolbar">
        <label class="tool-btn" for="postMediaInput">▧ Photo / video</label>
        <input class="hidden" id="postMediaInput" type="file" accept="image/*,video/*">
        <button class="tool-btn" id="addLinkBtn">↗ Link</button>
        <button class="tool-btn" id="tagHelpBtn">@ Tag</button>
        ${['brand','agency'].includes(profile.account_type)?'<button class="tool-btn" id="shareOpportunityBtn">▣ Job posting</button>':''}
        <button class="primary" id="postBtn">Post</button>
      </div>
    </section>
    <div class="feed" id="feedList"></div>
  </div>`;
  let selectedFile=null,currentFilter='for-you';
  setupMentionAutocomplete($('#postText'),$('#mentionMenu'));
  const mediaInput=$('#postMediaInput'),preview=$('#mediaPreview');
  mediaInput.onchange=e=>{
    selectedFile=e.target.files?.[0]||null;
    if(!selectedFile){preview.classList.add('hidden');return}
    const local=URL.createObjectURL(selectedFile);
    preview.innerHTML=`<button class="remove-media" id="removeMediaBtn">×</button>${selectedFile.type.startsWith('video/')?`<video controls src="${local}"></video>`:`<img src="${local}" alt="Post preview">`}`;
    preview.classList.remove('hidden');
    $('#removeMediaBtn').onclick=()=>{selectedFile=null;mediaInput.value='';preview.classList.add('hidden');preview.innerHTML=''}
  };
  $('#addLinkBtn').onclick=()=>$('#linkBox').classList.toggle('hidden');
  $('#removeLinkBtn').onclick=()=>{$('#postLink').value='';$('#linkBox').classList.add('hidden')};
  $('#tagHelpBtn').onclick=()=>showToast('Type @username in your post to tag a member');
  $('#shareOpportunityBtn')?.addEventListener('click',()=>setPage('opportunities'));
  $('#postBtn').onclick=async()=>{
    const content=$('#postText').value.trim(),rawLink=$('#postLink').value.trim(),link_url=rawLink?validHttpUrl(rawLink):null;
    if(rawLink&&!link_url)return showToast('Enter a valid https:// link');
    if(!content&&!selectedFile&&!link_url)return showToast('Add text, media, or a link');
    $('#postBtn').disabled=true;
    try{
      let media=null;
      if(selectedFile){$('#uploadStatus').textContent='Uploading media…';media=await uploadPostMedia(selectedFile)}
      const {error}=await sb.from('posts').insert({user_id:user.id,content:content||'',media_url:media?.url||null,media_type:media?.type||null,link_url});
      if(error)throw error;
      $('#postText').value='';$('#postLink').value='';selectedFile=null;$('#uploadStatus').textContent='';updateMentionChips($('#postText'));showToast('Post published');feed()
    }catch(err){showToast(err.message);$('#uploadStatus').textContent=''}finally{$('#postBtn').disabled=false}
  };
  $$('[data-feed-filter]').forEach(b=>b.onclick=()=>{$$('[data-feed-filter]').forEach(x=>x.classList.toggle('active',x===b));currentFilter=b.dataset.feedFilter;renderTimeline(currentFilter)});
  renderTimeline(currentFilter);
  renderModernHomeSidebar();
}
async function renderTimeline(filter){
  const list=$('#feedList');list.innerHTML='<section class="card empty"><p class="muted">Loading feed…</p></section>';
  try{
    const items=await loadTimeline(filter);
    if(!items.length){list.innerHTML=`<section class="card empty"><h2>No posts yet</h2><p class="muted">Follow real members or publish the first post.</p></section>`;return}
    const postIds=items.filter(x=>x.kind==='post').map(x=>x.id);
    let likes=[],comments=[],reposts=[];
    if(postIds.length){
      const [{data:l},{data:c},{data:r}]=await Promise.all([
        sb.from('post_likes').select('post_id,user_id').in('post_id',postIds),
        sb.from('post_comments').select('id,post_id,user_id,content,created_at,profiles:post_comments_user_id_fkey(full_name,avatar_url,username)').in('post_id',postIds).order('created_at'),
        sb.from('post_reposts').select('post_id,user_id,created_at').in('post_id',postIds)
      ]);likes=l||[];comments=c||[];reposts=r||[];
    }
    list.innerHTML=items.map(item=>item.kind==='job'?renderJobFeedItem(item):renderSocialPost(item,likes,comments,reposts)).join('');
    bindFeedActions();bindProfileLinks();
  }catch(e){list.innerHTML=`<section class="card empty"><h2>Could not load the feed</h2><p class="muted">${esc(e.message)}</p></section>`}
}
function renderSocialPost(p,likes=[],comments=[],reposts=[],options={}){
  const postLikes=likes.filter(x=>x.post_id===p.id);
  const postComments=comments.filter(x=>x.post_id===p.id);
  const postReposts=reposts.filter(x=>x.post_id===p.id);
  const liked=postLikes.some(x=>x.user_id===user.id);
  const reposted=postReposts.some(x=>x.user_id===user.id);
  const engagement=postLikes.length+postComments.length+(postReposts.length*2);
  return `<article class="card social-post">
    ${options.trending?`<div class="repost-context"><span class="engagement-label">🔥 ${engagement} engagement points</span>${options.rank?`<span>Trending #${options.rank}</span>`:''}</div>`:''}
    <div class="social-post-header"><img class="avatar" src="${esc(p.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><button class="profile-link" data-profile-id="${p.user_id}"><strong>${esc(p.profiles?.full_name||'Member')} ${p.profiles?.is_verified?'<span class="verified">✓</span>':''}${p.profiles?.is_founder?'<span class="badge">Founder</span>':''}</strong></button><div class="muted">@${esc(p.profiles?.username||'member')} · ${formatRelativeTime(p.created_at)}</div></div><div style="display:flex;gap:6px;align-items:center">${options.showPin?(options.pinned?`<button class="secondary pin-control" data-unpin-profile-post="${p.id}">Pinned</button>`:`<button class="secondary pin-control" data-pin-profile-post="${p.id}">Pin</button>`):''}${p.user_id===user.id?`<button class="secondary danger" data-delete-post="${p.id}">Delete</button>`:''}</div></div>
    <div class="social-post-body">${p.content?`<p>${renderPostText(p.content)}</p>`:''}${p.link_url?`<a class="post-link" href="${esc(p.link_url)}" target="_blank" rel="noopener"><strong>Open link ↗</strong><br>${esc(p.link_url)}</a>`:''}</div>
    ${p.media_url?(p.media_type==='video'?`<video class="post-media" controls preload="metadata" src="${esc(p.media_url)}"></video>`:`<img class="post-media" loading="lazy" src="${esc(p.media_url)}" alt="Post media">`):''}
    <div class="post-actions">
      <button class="post-action ${liked?'active':''}" data-like="${p.id}" data-tooltip="Like this post and support the creator" aria-label="Like this post">
        <span class="post-action-icon">♡</span>
        <span class="post-action-count">${postLikes.length}</span>
        <span class="post-action-label">Like</span>
      </button>
      <button class="post-action" data-toggle-comments="${p.id}" data-tooltip="Comment and join the conversation" aria-label="Comment on this post">
        <span class="post-action-icon">↩</span>
        <span class="post-action-count">${postComments.length}</span>
        <span class="post-action-label">Comment</span>
      </button>
      <button class="post-action ${reposted?'reposted':''}" data-repost="${p.id}" data-tooltip="Repost this content to help it reach more people" aria-label="Repost this post">
        <span class="post-action-icon">⟳</span>
        <span class="post-action-count">${postReposts.length}</span>
        <span class="post-action-label">Repost</span>
      </button>
      <button class="post-action" data-copy-post="${p.id}" data-tooltip="Copy a shareable link to this post" aria-label="Share this post">
        <span class="post-action-icon">↗</span>
        <span class="post-action-count">Share</span>
        <span class="post-action-label">Share</span>
      </button>
    </div>
    <div class="comments hidden" id="comments-${p.id}"><div>${postComments.map(c=>`<div class="comment-row"><img class="avatar" src="${esc(c.profiles?.avatar_url||EMPTY)}"><div class="comment-body"><button class="profile-link" data-profile-id="${c.user_id}"><strong>${esc(c.profiles?.full_name||'Member')}</strong></button><div>${renderPostText(c.content)}</div></div></div>`).join('')}</div><div class="comment-form"><input class="field" id="comment-input-${p.id}" placeholder="Write a reply"><button class="primary" data-comment="${p.id}">Reply</button></div></div>
  </article>`
}
function renderJobFeedItem(o){
  return `<article class="card social-post"><div class="social-post-header"><img class="avatar" src="${esc(o.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><button class="profile-link" data-profile-id="${o.business_id}"><strong>${esc(o.profiles?.full_name||'Business')} ${o.profiles?.is_verified?'<span class="verified">✓</span>':''}</strong></button><div class="muted">posted an opportunity · ${formatRelativeTime(o.created_at)}</div></div><span class="post-type">Opportunity</span></div><div class="social-post-body"><div class="job-card"><h3>${esc(o.title)}</h3><p>${esc(o.description)}</p><div class="job-meta">${o.compensation?`<span class="chip">${esc(o.compensation)}</span>`:''}${o.opportunity_type?`<span class="chip">${esc(o.opportunity_type)}</span>`:''}${o.platforms?`<span class="chip">${esc(o.platforms)}</span>`:''}${o.location?`<span class="chip">${esc(o.location)}</span>`:''}</div>${o.deadline?`<div class="muted">Apply by ${new Date(o.deadline).toLocaleDateString()}</div>`:''}<button class="primary" data-open-opportunity="${o.id}" style="margin-top:12px">View opportunity</button></div></div></article>`
}
function refreshPostSurface(){
  if(document.querySelector('.discover-traction'))discover();
  else if(activeProfileId&&document.querySelector('.public-profile'))renderPublicProfileTab(members.find(m=>m.id===activeProfileId)||profile,activeProfileTab);
  else renderTimeline(document.querySelector('[data-feed-filter].active')?.dataset.feedFilter||'for-you')
}
function bindFeedActions(){
  $$('[data-like]').forEach(b=>b.onclick=async()=>{
    const post_id=b.dataset.like;
    const {data}=await sb.from('post_likes').select('post_id').eq('post_id',post_id).eq('user_id',user.id).maybeSingle();
    const {error}=data
      ?await sb.from('post_likes').delete().eq('post_id',post_id).eq('user_id',user.id)
      :await sb.from('post_likes').insert({post_id,user_id:user.id});
    if(error)return showToast(error.message);
    refreshPostSurface()
  });
  $$('[data-toggle-comments]').forEach(b=>b.onclick=()=>$('#comments-'+b.dataset.toggleComments).classList.toggle('hidden'));
  $$('[data-comment]').forEach(b=>b.onclick=async()=>{
    const post_id=b.dataset.comment,input=$('#comment-input-'+post_id),content=input.value.trim();
    if(!content)return;
    const {error}=await sb.from('post_comments').insert({post_id,user_id:user.id,content});
    if(error)return showToast(error.message);
    refreshPostSurface()
  });
  $$('[data-repost]').forEach(b=>b.onclick=async()=>{
    const post_id=b.dataset.repost;
    const {data}=await sb.from('post_reposts').select('post_id').eq('post_id',post_id).eq('user_id',user.id).maybeSingle();
    const {error}=data
      ?await sb.from('post_reposts').delete().eq('post_id',post_id).eq('user_id',user.id)
      :await sb.from('post_reposts').insert({post_id,user_id:user.id});
    if(error)return showToast(error.message);
    showToast(data?'Repost removed':'Reposted');
    refreshPostSurface()
  });
  $$('[data-copy-post]').forEach(b=>b.onclick=async()=>{await navigator.clipboard.writeText(`${location.origin}/?post=${b.dataset.copyPost}`);showToast('Post link copied')});
  $$('[data-message-author]').forEach(b=>b.onclick=()=>startConversation(b.dataset.messageAuthor));
  $$('[data-delete-post]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('posts').delete().eq('id',b.dataset.deletePost).eq('user_id',user.id);if(error)return showToast(error.message);showToast('Post deleted');refreshPostSurface()});
  $$('[data-open-opportunity]').forEach(b=>b.onclick=()=>setPage('opportunities'));
}

async function loadSocial(){const [{data:m},{data:c},{data:r},{data:f}]=await Promise.all([sb.from('profiles').select('*').neq('id',user.id).order('created_at',{ascending:false}),sb.from('connections').select('*').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),sb.from('connections').select('*,profiles!connections_requester_id_fkey(*)').eq('addressee_id',user.id).eq('status','pending'),sb.from('follows').select('*').eq('follower_id',user.id)]);members=m||[];connections=c||[];requests=r||[];follows=f||[];}
function relationship(id){const c=connections.find(x=>(x.requester_id===user.id&&x.addressee_id===id)||(x.addressee_id===user.id&&x.requester_id===id));if(!c)return null;return c}
function recommendationScore(member){
  let score=0;
  const myNiche=(profile.niche||'').toLowerCase();
  const theirNiche=(member.niche||'').toLowerCase();
  const myLocation=(profile.location||'').toLowerCase();
  const theirLocation=(member.location||'').toLowerCase();

  if(myNiche&&theirNiche&&myNiche===theirNiche)score+=50;
  else if(myNiche&&theirNiche&&(theirNiche.includes(myNiche)||myNiche.includes(theirNiche)))score+=25;

  if(myLocation&&theirLocation&&myLocation===theirLocation)score+=18;
  if(profile.account_type==='creator'&&['brand','agency'].includes(member.account_type))score+=22;
  if(['brand','agency'].includes(profile.account_type)&&member.account_type==='creator')score+=22;
  if(member.is_verified)score+=8;
  if(member.is_founder)score+=5;

  const rel=relationship(member.id);
  if(rel?.status==='accepted')score-=20;
  if(follows.some(f=>f.following_id===member.id))score-=15;

  const ageDays=(Date.now()-new Date(member.created_at||Date.now()).getTime())/86400000;
  if(ageDays<14)score+=8;
  return score;
}
function recommendedMembers(){
  return [...members]
    .filter(m=>m.is_discoverable!==false)
    .sort((a,b)=>recommendationScore(b)-recommendationScore(a)||new Date(b.created_at)-new Date(a.created_at))
    .slice(0,12);
}
function memberRecommendationReason(member){
  const reasons=[];
  if(profile.niche&&member.niche&&profile.niche.toLowerCase()===member.niche.toLowerCase())reasons.push(`Also in ${member.niche}`);
  if(profile.location&&member.location&&profile.location.toLowerCase()===member.location.toLowerCase())reasons.push(`Near ${member.location}`);
  if(profile.account_type==='creator'&&member.account_type==='brand')reasons.push('Brand you may want to work with');
  if(profile.account_type==='creator'&&member.account_type==='agency')reasons.push('Agency you may want to connect with');
  if(['brand','agency'].includes(profile.account_type)&&member.account_type==='creator')reasons.push('Creator matching your account');
  if(member.is_verified)reasons.push('Verified member');
  if(!reasons.length)reasons.push('Recommended for your network');
  return reasons[0];
}

async function followingFeedPage(){
  await loadSocial();
  main.innerHTML=`<div class="social-shell"><div class="page-heading"><h1>Following</h1><p class="muted">Recent content from accounts you follow, plus your own posts.</p></div><div class="feed" id="followingContentFeed"></div></div>`;
  const box=$('#followingContentFeed');
  box.innerHTML='<section class="card empty"><p class="muted">Loading followed content…</p></section>';
  try{
    const followedIds=follows.map(row=>row.following_id);
    const ownerIds=[user.id,...followedIds];
    if(ownerIds.length===1){
      box.innerHTML=`<section class="card bookmark-empty"><h2>Your following feed is empty</h2><p class="muted">Follow creators in Discover to see their content here.</p><button class="primary" data-page="discover">Discover creators</button></section>`;
      return
    }
    const {data:posts,error}=await sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').in('user_id',ownerIds).order('created_at',{ascending:false});
    if(error)throw error;
    if(!(posts||[]).length){
      box.innerHTML='<section class="card bookmark-empty"><h2>No posts yet</h2><p class="muted">Posts from accounts you follow will appear here.</p></section>';
      return
    }
    const ids=posts.map(post=>post.id);
    const [{data:likes},{data:comments},{data:reposts}]=await Promise.all([
      sb.from('post_likes').select('post_id,user_id').in('post_id',ids),
      sb.from('post_comments').select('id,post_id,user_id,content,created_at,profiles:post_comments_user_id_fkey(full_name,avatar_url,username)').in('post_id',ids).order('created_at'),
      sb.from('post_reposts').select('post_id,user_id,created_at').in('post_id',ids)
    ]);
    box.innerHTML=posts.map(post=>renderSocialPost(post,likes||[],comments||[],reposts||[])).join('');
    bindFeedActions();bindProfileLinks()
  }catch(error){
    box.innerHTML=`<section class="card empty"><h2>Could not load Following</h2><p class="muted">${esc(error.message)}</p></section>`
  }
}

async function bookmarksPage(){
  main.innerHTML=`<div class="social-shell"><div class="page-heading"><h1>Bookmarks</h1><p class="muted">Posts you liked and wanted to find again.</p></div><div class="feed" id="bookmarkedContentFeed"></div></div>`;
  const box=$('#bookmarkedContentFeed');
  box.innerHTML='<section class="card empty"><p class="muted">Loading bookmarks…</p></section>';
  try{
    const {data:likedRows,error:likeError}=await sb.from('post_likes').select('post_id').eq('user_id',user.id);
    if(likeError)throw likeError;
    const ids=(likedRows||[]).map(row=>row.post_id);
    if(!ids.length){
      box.innerHTML='<section class="card bookmark-empty"><h2>No bookmarks yet</h2><p class="muted">Like a post and it will appear here.</p><button class="primary" data-page="feed">Browse Home</button></section>';
      return
    }
    const {data:posts,error}=await sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').in('id',ids).order('created_at',{ascending:false});
    if(error)throw error;
    const [{data:likes},{data:comments},{data:reposts}]=await Promise.all([
      sb.from('post_likes').select('post_id,user_id').in('post_id',ids),
      sb.from('post_comments').select('id,post_id,user_id,content,created_at,profiles:post_comments_user_id_fkey(full_name,avatar_url,username)').in('post_id',ids).order('created_at'),
      sb.from('post_reposts').select('post_id,user_id,created_at').in('post_id',ids)
    ]);
    box.innerHTML=(posts||[]).map(post=>renderSocialPost(post,likes||[],comments||[],reposts||[])).join('');
    bindFeedActions();bindProfileLinks()
  }catch(error){
    box.innerHTML=`<section class="card empty"><h2>Could not load Bookmarks</h2><p class="muted">${esc(error.message)}</p></section>`
  }
}

async function discover(){
  await loadSocial();
  main.innerHTML=`<div class="discover-traction">
    <section class="card discover-hero">
      <div class="discover-hero-top">
        <div><h1 style="margin:0 0 6px">Discover</h1><p class="muted" style="margin:0">See which creators and posts are gaining real traction across CreatorsIn.</p></div>
        <input class="field" id="tractionSearch" placeholder="Search creators or content" style="max-width:320px">
      </div>
      <div class="discover-tabs">
        <button class="discover-tab active" data-discover-view="trending">Trending</button>
        <button class="discover-tab" data-discover-view="creators">Rising creators</button>
        <button class="discover-tab" data-discover-view="content">Top content</button>
        <button class="discover-tab" data-discover-view="deals">Deal momentum</button>
      </div>
    </section>
    <div id="discoverTractionContent"></div>
  </div>`;

  let activeView='trending';
  let searchQuery='';

  const loadData=async()=>{
    const [{data:posts,error:postError},{data:likes},{data:comments},{data:reposts},{data:deals}]=await Promise.all([
      sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder,niche,location)').order('created_at',{ascending:false}).limit(100),
      sb.from('post_likes').select('post_id,user_id'),
      sb.from('post_comments').select('id,post_id,user_id,content,created_at,profiles:post_comments_user_id_fkey(full_name,avatar_url,username)').order('created_at'),
      sb.from('post_reposts').select('post_id,user_id,created_at'),
      sb.from('creator_deal_highlights').select('creator_id,created_at')
    ]);
    if(postError)throw postError;
    return {posts:posts||[],likes:likes||[],comments:comments||[],reposts:reposts||[],deals:deals||[]}
  };

  const render=async()=>{
    const box=$('#discoverTractionContent');
    box.innerHTML='<section class="card empty"><p class="muted">Calculating real traction…</p></section>';
    try{
      const data=await loadData();
      const followedIds=new Set(follows.map(row=>row.following_id));
      const filteredPosts=data.posts.filter(p=>{
        const text=`${p.content||''} ${p.profiles?.full_name||''} ${p.profiles?.username||''} ${p.profiles?.niche||''}`.toLowerCase();
        return p.user_id!==user.id&&!followedIds.has(p.user_id)&&text.includes(searchQuery)
      });

      const postStats=filteredPosts.map(p=>{
        const likeCount=data.likes.filter(x=>x.post_id===p.id).length;
        const commentCount=data.comments.filter(x=>x.post_id===p.id).length;
        const repostCount=data.reposts.filter(x=>x.post_id===p.id).length;
        const ageHours=Math.max(1,(Date.now()-new Date(p.created_at).getTime())/3600000);
        const freshness=Math.max(0,20-(ageHours/12));
        return {...p,likeCount,commentCount,repostCount,score:(likeCount*2)+(commentCount*3)+(repostCount*4)+freshness}
      }).sort((a,b)=>b.score-a.score);

      const creatorMap=new Map();
      data.posts.forEach(p=>{
        if(!p.profiles)return;
        if(searchQuery&&!`${p.profiles.full_name||''} ${p.profiles.username||''} ${p.profiles.niche||''}`.toLowerCase().includes(searchQuery)&&!filteredPosts.some(x=>x.user_id===p.user_id))return;
        const existing=creatorMap.get(p.user_id)||{id:p.user_id,profile:p.profiles,likes:0,comments:0,reposts:0,posts:0,deals:0,score:0};
        const creatorPosts=data.posts.filter(x=>x.user_id===p.user_id);
        existing.posts=creatorPosts.length;
        existing.likes=data.likes.filter(l=>creatorPosts.some(cp=>cp.id===l.post_id)).length;
        existing.comments=data.comments.filter(c=>creatorPosts.some(cp=>cp.id===c.post_id)).length;
        existing.reposts=data.reposts.filter(r=>creatorPosts.some(cp=>cp.id===r.post_id)).length;
        existing.deals=data.deals.filter(d=>d.creator_id===p.user_id).length;
        existing.score=(existing.likes*2)+(existing.comments*3)+(existing.reposts*4)+(existing.deals*12)+(existing.posts*.5);
        creatorMap.set(p.user_id,existing)
      });
      const creators=[...creatorMap.values()].sort((a,b)=>b.score-a.score);

      const creatorCards=(list)=>`<div class="trending-creators">${list.slice(0,9).map((c,i)=>{
        const max=Math.max(1,list[0]?.score||1);
        const isFollowing=follows.some(f=>f.following_id===c.id);
        return `<article class="card traction-card">
          <div class="traction-rank">#${i+1}</div>
          <div class="traction-head">
            <img class="traction-avatar" src="${esc(c.profile.avatar_url||EMPTY)}">
            <div><button class="profile-link" data-profile-id="${c.id}"><h3 style="margin:0">${esc(c.profile.full_name)} ${c.profile.is_verified?'<span class="verified">✓</span>':''}</h3></button><div class="muted">@${esc(c.profile.username||'member')} · ${esc(c.profile.niche||c.profile.account_type||'creator')}</div></div>
          </div>
          <div class="traction-metrics">
            <div class="traction-metric"><strong>${c.likes}</strong><span>Likes</span></div>
            <div class="traction-metric"><strong>${c.comments}</strong><span>Comments</span></div>
            <div class="traction-metric"><strong>${c.reposts}</strong><span>Reposts</span></div>
            <div class="traction-metric"><strong>${c.deals}</strong><span>Deals</span></div>
          </div>
          <div class="traction-score"><div class="traction-bar"><i style="width:${Math.max(4,Math.round(c.score/max*100))}%"></i></div><strong>${Math.round(c.score)}</strong></div>
          <div class="member-actions" style="margin-top:14px">
            ${c.id===user.id?'':isFollowing?`<button class="secondary" data-unfollow="${c.id}">Following</button>`:`<button class="primary" data-follow="${c.id}">Follow</button>`}
            <button class="secondary" data-profile-id="${c.id}">View profile</button>
          </div>
        </article>`
      }).join('')}</div>`;

      const contentFeed=(list)=>`<div class="trending-feed">${list.slice(0,20).map((p,i)=>renderSocialPost(p,data.likes,data.comments,data.reposts,{trending:true,rank:i+1})).join('')}</div>`;

      if(activeView==='creators'){
        box.innerHTML=`<section><div class="discover-section-head"><div><h2>Rising creators</h2><p class="muted">Ranked by authentic likes, replies, reposts, posting activity, and confirmed deal momentum.</p></div></div>${creators.length?creatorCards(creators):'<section class="card empty"><h2>No creator traction yet</h2></section>'}</section>`;
      }else if(activeView==='content'){
        box.innerHTML=`<section><div class="discover-section-head"><div><h2>Top content</h2><p class="muted">Posts currently earning the most engagement.</p></div></div>${postStats.length?contentFeed(postStats):'<section class="card empty"><h2>No content yet</h2></section>'}</section>`;
      }else if(activeView==='deals'){
        const dealCreators=creators.filter(c=>c.deals>0).sort((a,b)=>b.deals-a.deals||b.score-a.score);
        box.innerHTML=`<section><div class="discover-section-head"><div><h2>Deal momentum</h2><p class="muted">Creators with applications accepted by real businesses on CreatorsIn.</p></div></div>${dealCreators.length?creatorCards(dealCreators):'<section class="card empty"><h2>No confirmed deals yet</h2><p class="muted">Accepted opportunity applications will appear here automatically.</p></section>'}</section>`;
      }else{
        box.innerHTML=`<section><div class="discover-section-head"><div><h2>Creators gaining traction</h2><p class="muted">Members building momentum through real engagement and deals.</p></div><button class="secondary" data-switch-discover="creators">View all creators</button></div>${creators.length?creatorCards(creators.slice(0,6)):'<section class="card empty"><h2>No traction yet</h2></section>'}</section>
        <section><div class="discover-section-head"><div><h2>Content taking off</h2><p class="muted">Like, comment, repost, and discover what the community values.</p></div><button class="secondary" data-switch-discover="content">View all content</button></div>${postStats.length?contentFeed(postStats.slice(0,8)):'<section class="card empty"><h2>No posts yet</h2></section>'}</section>`;
      }

      $$('[data-switch-discover]').forEach(b=>b.onclick=()=>{activeView=b.dataset.switchDiscover;$$('[data-discover-view]').forEach(x=>x.classList.toggle('active',x.dataset.discoverView===activeView));render()});
      bindDiscover();
      bindFeedActions();
      bindProfileLinks()
    }catch(e){
      box.innerHTML=`<section class="card empty"><h2>Could not load Discover</h2><p class="muted">${esc(e.message)}</p></section>`
    }
  };

  $('#tractionSearch').oninput=e=>{searchQuery=e.target.value.trim().toLowerCase();render()};
  $$('[data-discover-view]').forEach(b=>b.onclick=()=>{activeView=b.dataset.discoverView;$$('[data-discover-view]').forEach(x=>x.classList.toggle('active',x===b));render()});
  render()
}
function bindDiscover(){
  $$('[data-follow]').forEach(b=>b.onclick=async()=>{
    const {error}=await sb.from('follows').insert({follower_id:user.id,following_id:b.dataset.follow});
    if(error)showToast(error.message);else{showToast('Following member');discover()}
  });
  $$('[data-unfollow]').forEach(b=>b.onclick=async()=>{
    const {error}=await sb.from('follows').delete().eq('follower_id',user.id).eq('following_id',b.dataset.unfollow);
    if(error)showToast(error.message);else{showToast('Unfollowed');discover()}
  });
  $$('[data-connect]').forEach(b=>b.onclick=async()=>{
    const {error}=await sb.from('connections').insert({requester_id:user.id,addressee_id:b.dataset.connect,status:'pending'});
    if(error)showToast(error.message);else{showToast('Connection request sent');discover()}
  });
  $$('[data-view]').forEach(b=>b.onclick=()=>showMember(b.dataset.view));
  $$('[data-message-user]').forEach(b=>b.onclick=()=>startConversation(b.dataset.messageUser))
}
async function showMember(id){
  return openMemberProfile(id);
}
async function fetchProfileCounts(memberId){
  const [{count:followers},{count:following},{count:postsCount},{count:connectionsCount}]=await Promise.all([
    sb.from('follows').select('*',{count:'exact',head:true}).eq('following_id',memberId),
    sb.from('follows').select('*',{count:'exact',head:true}).eq('follower_id',memberId),
    sb.from('posts').select('*',{count:'exact',head:true}).eq('user_id',memberId),
    sb.from('connections').select('*',{count:'exact',head:true}).eq('status','accepted').or(`requester_id.eq.${memberId},addressee_id.eq.${memberId}`)
  ]);
  return {followers:followers||0,following:following||0,posts:postsCount||0,connections:connectionsCount||0}
}

async function fetchCreatorTotalLikes(memberId){
  try{
    const {data,error}=await sb.rpc('get_creator_total_likes',{creator_id:memberId});
    if(error){
      console.warn('Total likes unavailable:',error.message);
      return 0
    }
    return Number(data||0)
  }catch(error){
    console.warn('Total likes unavailable:',error);
    return 0
  }
}

async function renderPublicProfile(memberId){
  await loadSocial();
  const [{data:member,error},{data:entries},{data:pins},{data:services}]=await Promise.all([
    sb.from('profiles').select('*').eq('id',memberId).single(),
    sb.from('profile_portfolio_entries').select('*').eq('profile_id',memberId).order('sort_order').order('start_date',{ascending:false}),
    sb.from('profile_pinned_posts').select('post_id,position').eq('profile_id',memberId).order('position'),
    sb.from('creator_services').select('*').eq('profile_id',memberId).order('sort_order').order('created_at')
  ]);
  if(error){main.innerHTML=`<section class="card empty"><h2>Profile not found</h2><p class="muted">${esc(error.message)}</p></section>`;return}
  if(memberId===user.id){profile=member;syncIdentity()}
  const [counts,creatorTotalLikes]=await Promise.all([
    fetchProfileCounts(memberId),
    fetchCreatorTotalLikes(memberId)
  ]);
  const isSelf=memberId===user.id;
  const rel=relationship(memberId);
  const isFollowing=follows.some(f=>f.following_id===memberId);
  const connectionButton=isSelf?'':rel?.status==='accepted'
    ?`<button class="secondary" disabled>Connected</button>`
    :rel?.status==='pending'
      ?`<button class="secondary" disabled>${rel.requester_id===user.id?'Request sent':'Request received'}</button>`
      :`<button class="secondary" data-profile-connect="${memberId}">Connect</button>`;
  const followButton=isSelf?'':isFollowing
    ?`<button class="secondary" data-profile-unfollow="${memberId}">Following</button>`
    :`<button class="primary" data-profile-follow="${memberId}">Follow</button>`;
  const messageButton=isSelf?'':`<button class="secondary" data-profile-message="${memberId}">Message</button>`;
  const socialLinks=[
    ['Website',member.website_url,'↗'],['Instagram',member.instagram_url,'◎'],['TikTok',member.tiktok_url,'♪'],
    ['YouTube',member.youtube_url,'▶'],['Twitch',member.twitch_url,'◈'],['X',member.x_url,'𝕏'],
    ['LinkedIn',member.linkedin_url,'in'],['Discord',member.discord_url,'◉']
  ].filter(x=>x[1]);
  const completedDeals=(entries||[]).filter(e=>e.entry_type==='deal').length;
  const shareUrl=`${location.origin}/${encodeURIComponent(member.username||member.id)}`;
  main.innerHTML=`<div class="creator-profile">
    ${!isSelf?'<button class="secondary profile-back" id="profileBackBtn">← Back</button>':''}
    <section class="card creator-hero-card">
      <div class="creator-banner" style="${member.banner_url?`background-image:url('${esc(member.banner_url)}')`:''}"></div>
      <div class="creator-profile-body">
        <div class="creator-profile-top">
          <img class="creator-profile-photo" src="${esc(member.avatar_url||EMPTY)}" alt="${esc(member.full_name)}">
          <div class="creator-identity">
            <div class="creator-name-row"><h1 class="creator-name">${esc(member.full_name)}</h1>${member.is_verified?'<span class="verified">✓</span>':''}${member.is_founder?'<span class="badge">Founder</span>':''}</div>
            <div class="creator-tagline">${esc(member.headline||member.account_type||'Creator')}</div>
            <div class="muted">@${esc(member.username||'member')}${member.location?` · ${esc(member.location)}`:''}</div>
          </div>
          <div class="creator-actions creator-header-actions">${followButton}${connectionButton}${messageButton}${isSelf?'<button class="primary" id="editOwnProfileBtn">Edit profile</button>':''}<button class="secondary" id="copyProfileLinkBtn">Share profile</button></div>
        </div>
        <p class="creator-bio">${esc(member.bio||'This creator has not added a bio yet.')}</p>
        <div class="creator-meta">${member.niche?`<span class="chip">${esc(member.niche)}</span>`:''}<span class="chip">${esc(member.account_type||'creator')}</span>${completedDeals?`<span class="deal-badge">${completedDeals} previous deal${completedDeals===1?'':'s'}</span>`:''}</div>
        <div class="business-status-row">
          <span class="business-status ${member.available_for_work!==false?'open':''}">${member.available_for_work!==false?'● Open to work':'○ Not accepting work'}</span>
          ${member.accepting_long_term?'<span class="business-status">Long-term partnerships</span>':''}
          ${member.accepting_short_term?'<span class="business-status">Short-term projects</span>':''}
          ${member.remote_available?'<span class="business-status">Remote available</span>':''}
        </div>
        ${socialLinks.length?`<div class="creator-socials">${socialLinks.map(s=>`<a class="social-pill" href="${esc(s[1])}" target="_blank" rel="noopener"><span>${s[2]}</span>${s[0]}</a>`).join('')}</div>`:''}
        <div class="creator-stats creator-stats-five">
          <div class="creator-stat"><strong>${counts.followers}</strong><span>Followers</span></div>
          <div class="creator-stat"><strong>${counts.following}</strong><span>Following</span></div>
          <div class="creator-stat"><strong>${counts.posts}</strong><span>Posts</span></div>
          <div class="creator-stat" title="Total likes received across all posts"><strong>${creatorTotalLikes}</strong><span>Total likes</span></div>
          <div class="creator-stat"><strong>${completedDeals}</strong><span>Deals & experience</span></div>
        </div>
      </div>
    </section>
    <div class="creator-profile-tabs">
      <button class="active" data-public-profile-tab="overview">Overview</button>
      <button data-public-profile-tab="posts">Posts</button>
      <button data-public-profile-tab="media">Media</button>
      <button data-public-profile-tab="experience">Deals & resume</button>
      <button data-public-profile-tab="about">About</button>
      ${['brand','agency'].includes(member.account_type)?'<button data-public-profile-tab="opportunities">Opportunities</button>':''}
    </div>
    <div id="publicProfileContent"></div>
  </div>`;
  $('#profileBackBtn')?.addEventListener('click',()=>history.back());
  $('#copyProfileLinkBtn').onclick=async()=>{await navigator.clipboard.writeText(shareUrl);showToast('Profile link copied')};
  $('#editOwnProfileBtn')?.addEventListener('click',()=>openCreatorProfileEditor(member));
  $('[data-profile-follow]')?.addEventListener('click',async()=>{
    const {error}=await sb.from('follows').insert({follower_id:user.id,following_id:memberId});
    if(error)return showToast(error.message);showToast('Following member');await renderPublicProfile(memberId)
  });
  $('[data-profile-unfollow]')?.addEventListener('click',async()=>{
    const {error}=await sb.from('follows').delete().eq('follower_id',user.id).eq('following_id',memberId);
    if(error)return showToast(error.message);showToast('Unfollowed');await renderPublicProfile(memberId)
  });
  $('[data-profile-connect]')?.addEventListener('click',async()=>{
    const {error}=await sb.from('connections').insert({requester_id:user.id,addressee_id:memberId,status:'pending'});
    if(error)return showToast(error.message);showToast('Connection request sent');await renderPublicProfile(memberId)
  });
  $('[data-profile-message]')?.addEventListener('click',()=>startConversation(memberId));
  $$('[data-public-profile-tab]').forEach(b=>b.onclick=()=>{
    $$('[data-public-profile-tab]').forEach(x=>x.classList.toggle('active',x===b));
    activeProfileTab=b.dataset.publicProfileTab;
    renderPublicProfileTab(member,activeProfileTab,entries||[],pins||[],services||[])
  });
  activeProfileTab='overview';
  renderPublicProfileTab(member,'overview',entries||[],pins||[],services||[])
}
async function renderPublicProfileTab(member,tab,entries=[],pins=[],services=[]){
  const box=$('#publicProfileContent');
  if(!box)return;
  box.innerHTML='<section class="card profile-empty"><p class="muted">Loading profile…</p></section>';
  const isSelf=member.id===user.id;
  if(tab==='overview'){
    const pinIds=pins.map(p=>p.post_id);
    const [{data:pinnedPosts},{data:recentPosts}]=await Promise.all([
      pinIds.length?sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').in('id',pinIds):Promise.resolve({data:[]}),
      sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').eq('user_id',member.id).order('created_at',{ascending:false}).limit(3)
    ]);
    const orderedPinned=pinIds.map(id=>(pinnedPosts||[]).find(p=>p.id===id)).filter(Boolean);
    box.innerHTML=`
      <section class="card profile-section">
        <div class="profile-section-head"><div><h2>Featured content</h2><p class="muted">${isSelf?'Pin up to three posts so brands see your best work first.':'The creator’s best work, selected for brands and collaborators.'}</p></div></div>
        ${orderedPinned.length?`<div class="featured-posts">${orderedPinned.map(p=>renderFeaturedPost(p,isSelf)).join('')}</div>`:`<div class="profile-empty"><h3>No featured posts yet</h3><p class="muted">${isSelf?'Open the Posts tab and pin your strongest content.':'This creator has not featured content yet.'}</p></div>`}
      </section>
      <section class="card profile-section">
        <div class="profile-section-head"><div><h2>Recent activity</h2><p class="muted">Latest posts and content.</p></div></div>
        ${(recentPosts||[]).length?`<div class="feed">${recentPosts.map(p=>renderSocialPost(p,[],[],[],{showPin:isSelf,pinned:pinIds.includes(p.id)})).join('')}</div>`:'<div class="profile-empty"><p class="muted">No posts yet.</p></div>'}
      </section>
      <section class="card profile-section">
        <div class="profile-section-head">
          <div><h2>Services</h2><p class="muted">What this creator offers to brands and collaborators.</p></div>
          ${isSelf?'<button class="primary" id="addServiceBtn">Add service</button>':''}
        </div>
        ${services.length?`<div class="service-grid">${services.map(s=>`<article class="service-card"><h3>${esc(s.name)}</h3><p>${esc(s.description||'')}</p>${s.rate?`<div class="service-rate">${esc(s.rate)}</div>`:''}${isSelf?`<div class="business-toolbar" style="margin-top:12px"><button class="secondary" data-edit-service="${s.id}">Edit</button><button class="secondary danger" data-delete-service="${s.id}">Delete</button></div>`:''}</article>`).join('')}</div>`:`<div class="profile-empty"><h3>No services listed yet</h3><p class="muted">${isSelf?'Add the ways brands can hire you.':'This creator has not listed services yet.'}</p></div>`}
      </section>
      <section class="card profile-section">
        <div class="profile-section-head"><div><h2>Work availability</h2><p class="muted">Quickly see what kinds of work this creator accepts.</p></div>${isSelf?'<button class="secondary" id="editAvailabilityBtn">Edit availability</button>':''}</div>
        <div class="availability-grid">
          <div class="availability-item"><span>Open to work</span><strong>${member.available_for_work!==false?'Yes':'No'}</strong></div>
          <div class="availability-item"><span>Long-term partnerships</span><strong>${member.accepting_long_term?'Yes':'No'}</strong></div>
          <div class="availability-item"><span>Short-term projects</span><strong>${member.accepting_short_term?'Yes':'No'}</strong></div>
          <div class="availability-item"><span>Remote work</span><strong>${member.remote_available?'Yes':'No'}</strong></div>
          <div class="availability-item"><span>Events</span><strong>${member.events_available?'Yes':'No'}</strong></div>
          <div class="availability-item"><span>Response time</span><strong>${esc(member.response_time||'Not listed')}</strong></div>
        </div>
      </section>
      <section class="card profile-section">
        <div class="profile-section-head"><div><h2>Deals, work & milestones</h2><p class="muted">A fun creator resume showing partnerships, roles, education, and achievements.</p></div>${isSelf?'<button class="primary" id="addPortfolioEntryBtn">Add experience</button>':''}</div>
        ${renderPortfolioEntries(entries,isSelf)}
      </section>`;
    bindFeedActions();bindProfileLinks();bindProfilePinActions(member.id);bindServiceActions(member.id);
    $('#addPortfolioEntryBtn')?.addEventListener('click',()=>openPortfolioEntryEditor(member.id));
    $('#addServiceBtn')?.addEventListener('click',()=>openServiceEditor(member.id));
    $('#editAvailabilityBtn')?.addEventListener('click',()=>openAvailabilityEditor(member))
  }else if(tab==='posts'){
    const [{data,error},{data:pinRows}]=await Promise.all([
      sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').eq('user_id',member.id).order('created_at',{ascending:false}),
      sb.from('profile_pinned_posts').select('post_id').eq('profile_id',member.id)
    ]);
    if(error)return box.innerHTML=`<section class="card profile-empty"><p class="muted">${esc(error.message)}</p></section>`;
    const pinnedIds=(pinRows||[]).map(x=>x.post_id);
    box.innerHTML=(data||[]).length?`<div class="feed">${data.map(p=>renderSocialPost(p,[],[],[],{showPin:isSelf,pinned:pinnedIds.includes(p.id)})).join('')}</div>`:`<section class="card profile-empty"><h2>No posts yet</h2></section>`;
    bindFeedActions();bindProfileLinks();bindProfilePinActions(member.id)
  }else if(tab==='media'){
    const {data,error}=await sb.from('posts').select('id,media_url,media_type').eq('user_id',member.id).not('media_url','is',null).order('created_at',{ascending:false});
    if(error)return box.innerHTML=`<section class="card profile-empty"><p class="muted">${esc(error.message)}</p></section>`;
    box.innerHTML=(data||[]).length?`<section class="card profile-section"><div class="profile-media-grid">${data.map(p=>p.media_type==='video'?`<video controls preload="metadata" src="${esc(p.media_url)}"></video>`:`<img loading="lazy" src="${esc(p.media_url)}" alt="Profile media">`).join('')}</div></section>`:`<section class="card profile-empty"><h2>No media yet</h2></section>`
  }else if(tab==='experience'){
    box.innerHTML=`<section class="card profile-section"><div class="profile-section-head"><div><h2>Deals & resume</h2><p class="muted">Partnerships, roles, education, collaborations, and creator milestones.</p></div>${isSelf?'<button class="primary" id="addPortfolioEntryBtn">Add experience</button>':''}</div>${renderPortfolioEntries(entries,isSelf)}</section>`;
    $('#addPortfolioEntryBtn')?.addEventListener('click',()=>openPortfolioEntryEditor(member.id));
    bindPortfolioActions(member.id)
  }else if(tab==='about'){
    box.innerHTML=`<section class="card profile-section">
      <div class="profile-section-head"><div><h2>About ${esc(member.full_name)}</h2></div></div>
      <p style="font-size:17px;line-height:1.65">${esc(member.bio||'No bio added yet.')}</p>
      <div class="profile-about-grid">
        <div class="profile-about-item"><strong>Creator type</strong><span>${esc(member.account_type||'creator')}</span></div>
        <div class="profile-about-item"><strong>Niche or industry</strong><span>${esc(member.niche||'Not listed')}</span></div>
        <div class="profile-about-item"><strong>Location</strong><span>${esc(member.location||'Not listed')}</span></div>
        <div class="profile-about-item"><strong>Member since</strong><span>${new Date(member.created_at).toLocaleDateString()}</span></div>
      </div>
    </section>`
  }else if(tab==='opportunities'){
    const {data,error}=await sb.from('opportunities').select('*').eq('business_id',member.id).eq('status','open').order('created_at',{ascending:false});
    if(error)return box.innerHTML=`<section class="card profile-empty"><p class="muted">${esc(error.message)}</p></section>`;
    box.innerHTML=(data||[]).length?`<div class="feed">${data.map(o=>`<article class="card opportunity"><h3>${esc(o.title)}</h3><p>${esc(o.description)}</p><div class="opportunity-meta">${o.compensation?`<span class="chip">${esc(o.compensation)}</span>`:''}${o.opportunity_type?`<span class="chip">${esc(o.opportunity_type)}</span>`:''}${o.platforms?`<span class="chip">${esc(o.platforms)}</span>`:''}</div><button class="primary" data-page="opportunities">View opportunity</button></article>`).join('')}</div>`:`<section class="card profile-empty"><h2>No open opportunities</h2></section>`;
    $$('[data-page="opportunities"]').forEach(b=>b.onclick=()=>setPage('opportunities'))
  }
}
function renderFeaturedPost(p,isSelf){
  return `<article class="featured-post">
    ${p.media_url?(p.media_type==='video'?`<video class="featured-post-media" controls preload="metadata" src="${esc(p.media_url)}"></video>`:`<img class="featured-post-media" src="${esc(p.media_url)}" alt="Featured content">`):''}
    <div class="featured-post-content"><span class="featured-label">📌 Featured</span>${p.content?`<p>${renderPostText(p.content)}</p>`:''}${p.link_url?`<a href="${esc(p.link_url)}" target="_blank" rel="noopener">Open link ↗</a>`:''}${isSelf?`<button class="secondary pin-control" data-unpin-profile-post="${p.id}" style="margin-top:10px">Unpin</button>`:''}</div>
  </article>`
}
function renderPortfolioEntries(entries,isSelf){
  if(!entries.length)return `<div class="profile-empty"><h3>No experience added yet</h3><p class="muted">${isSelf?'Add previous brand deals, creator work, education, achievements, or collaborations.':'This profile has not added experience yet.'}</p></div>`;
  const icons={deal:'🤝',experience:'💼',education:'🎓',achievement:'🏆',collaboration:'🎬'};
  return `<div class="portfolio-timeline">${entries.map(e=>`<article class="portfolio-entry">
    <div class="portfolio-icon">${icons[e.entry_type]||'✨'}</div>
    <div><div class="muted">${esc((e.entry_type||'experience').toUpperCase())}</div><h3>${esc(e.title)}</h3><strong>${esc(e.organization||'')}</strong>${e.start_date||e.end_date?`<div class="muted">${e.start_date?new Date(e.start_date+'T00:00:00').toLocaleDateString([],{month:'short',year:'numeric'}):''}${e.end_date?` – ${new Date(e.end_date+'T00:00:00').toLocaleDateString([],{month:'short',year:'numeric'})}`:' – Present'}</div>`:''}${e.deal_value?`<div class="portfolio-value">${esc(e.deal_value)}</div>`:''}${e.description?`<p>${esc(e.description)}</p>`:''}${e.external_url?`<a href="${esc(e.external_url)}" target="_blank" rel="noopener">View project ↗</a>`:''}</div>
    ${isSelf?`<div class="portfolio-entry-actions"><button class="secondary" data-edit-entry="${e.id}">Edit</button><button class="secondary danger" data-delete-entry="${e.id}">Delete</button></div>`:''}
  </article>`).join('')}</div>`
}
function bindProfilePinActions(profileId){
  $$('[data-pin-profile-post]').forEach(b=>b.onclick=async()=>{
    const {count}=await sb.from('profile_pinned_posts').select('*',{count:'exact',head:true}).eq('profile_id',profileId);
    if((count||0)>=3)return showToast('You can pin up to three posts');
    const {error}=await sb.from('profile_pinned_posts').insert({profile_id:profileId,post_id:b.dataset.pinProfilePost,position:(count||0)+1});
    if(error)return showToast(error.message);showToast('Post pinned');renderPublicProfile(profileId)
  });
  $$('[data-unpin-profile-post]').forEach(b=>b.onclick=async()=>{
    const postId=b.dataset.unpinProfilePost;
    const {error}=await sb.from('profile_pinned_posts').delete().eq('profile_id',profileId).eq('post_id',postId);
    if(error)return showToast(error.message);showToast('Post unpinned');renderPublicProfile(profileId)
  })
}
function bindPortfolioActions(profileId){
  $$('[data-edit-entry]').forEach(b=>b.onclick=async()=>{
    const {data,error}=await sb.from('profile_portfolio_entries').select('*').eq('id',b.dataset.editEntry).single();
    if(error)return showToast(error.message);openPortfolioEntryEditor(profileId,data)
  });
  $$('[data-delete-entry]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this profile entry?'))return;
    const {error}=await sb.from('profile_portfolio_entries').delete().eq('id',b.dataset.deleteEntry).eq('profile_id',user.id);
    if(error)return showToast(error.message);showToast('Entry deleted');renderPublicProfile(profileId)
  })
}
function openPortfolioEntryEditor(profileId,entry=null){
  modal(entry?'Edit experience':'Add experience',`<div class="form-grid">
    <div><label>Type</label><select class="field" id="entryType"><option value="deal">Brand deal</option><option value="collaboration">Collaboration</option><option value="experience">Work experience</option><option value="education">Education</option><option value="achievement">Achievement</option></select></div>
    <div><label>Organization or brand</label><input class="field" id="entryOrganization" value="${esc(entry?.organization||'')}"></div>
    <div class="wide"><label>Title</label><input class="field" id="entryTitle" value="${esc(entry?.title||'')}" placeholder="UGC Campaign, Creator Partner, Marketing Intern..."></div>
    <div><label>Start date</label><input class="field" id="entryStart" type="date" value="${esc(entry?.start_date||'')}"></div>
    <div><label>End date</label><input class="field" id="entryEnd" type="date" value="${esc(entry?.end_date||'')}"></div>
    <div><label>Deal value or result</label><input class="field" id="entryValue" value="${esc(entry?.deal_value||'')}" placeholder="$3,500 · 2.1M views · 15 videos"></div>
    <div><label>Project link</label><input class="field" id="entryUrl" value="${esc(entry?.external_url||'')}" placeholder="https://"></div>
    <div class="wide"><label>Description</label><textarea class="field" id="entryDescription">${esc(entry?.description||'')}</textarea></div>
  </div><button class="primary" id="saveEntryBtn" style="margin-top:14px">${entry?'Save entry':'Add to profile'}</button>`);
  setTimeout(()=>{
    $('#entryType').value=entry?.entry_type||'deal';
    $('#saveEntryBtn').onclick=async()=>{
      const payload={profile_id:profileId,entry_type:$('#entryType').value,organization:$('#entryOrganization').value.trim()||null,title:$('#entryTitle').value.trim(),start_date:$('#entryStart').value||null,end_date:$('#entryEnd').value||null,deal_value:$('#entryValue').value.trim()||null,external_url:$('#entryUrl').value.trim()||null,description:$('#entryDescription').value.trim()||null};
      if(!payload.title)return showToast('Add a title');
      const result=entry
        ?await sb.from('profile_portfolio_entries').update(payload).eq('id',entry.id).eq('profile_id',user.id)
        :await sb.from('profile_portfolio_entries').insert(payload);
      if(result.error)return showToast(result.error.message);
      closeModal();showToast(entry?'Entry updated':'Experience added');renderPublicProfile(profileId)
    }
  },0)
}

function bindServiceActions(profileId){
  $$('[data-edit-service]').forEach(b=>b.onclick=async()=>{
    const {data,error}=await sb.from('creator_services').select('*').eq('id',b.dataset.editService).single();
    if(error)return showToast(error.message);
    openServiceEditor(profileId,data)
  });
  $$('[data-delete-service]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this service?'))return;
    const {error}=await sb.from('creator_services').delete().eq('id',b.dataset.deleteService).eq('profile_id',user.id);
    if(error)return showToast(error.message);
    showToast('Service deleted');
    renderPublicProfile(profileId)
  })
}
function openServiceEditor(profileId,service=null){
  modal(service?'Edit service':'Add service',`<div class="service-editor-row">
    <div class="wide"><label>Service name</label><input class="field" id="serviceName" value="${esc(service?.name||'')}" placeholder="UGC videos, TikTok Shop, livestream integration..."></div>
    <div><label>Starting rate or pricing</label><input class="field" id="serviceRate" value="${esc(service?.rate||'')}" placeholder="$250+ or Contact for pricing"></div>
    <div><label>Category</label><input class="field" id="serviceCategory" value="${esc(service?.category||'')}" placeholder="UGC, Gaming, Editing..."></div>
    <div class="wide"><label>Description</label><textarea class="field" id="serviceDescription" placeholder="Explain exactly what a brand receives.">${esc(service?.description||'')}</textarea></div>
  </div><button class="primary" id="saveServiceBtn" style="margin-top:14px">${service?'Save service':'Add service'}</button>`);
  setTimeout(()=>$('#saveServiceBtn').onclick=async()=>{
    const payload={profile_id:profileId,name:$('#serviceName').value.trim(),rate:$('#serviceRate').value.trim()||null,category:$('#serviceCategory').value.trim()||null,description:$('#serviceDescription').value.trim()||null};
    if(!payload.name)return showToast('Add a service name');
    const result=service
      ?await sb.from('creator_services').update(payload).eq('id',service.id).eq('profile_id',user.id)
      :await sb.from('creator_services').insert(payload);
    if(result.error)return showToast(result.error.message);
    closeModal();
    showToast(service?'Service updated':'Service added');
    renderPublicProfile(profileId)
  },0)
}
function openAvailabilityEditor(member){
  modal('Edit work availability',`<div class="form-grid">
    <label><input type="checkbox" id="availableForWork" ${member.available_for_work!==false?'checked':''}> Open to work</label>
    <label><input type="checkbox" id="acceptingLongTerm" ${member.accepting_long_term?'checked':''}> Long-term partnerships</label>
    <label><input type="checkbox" id="acceptingShortTerm" ${member.accepting_short_term?'checked':''}> Short-term projects</label>
    <label><input type="checkbox" id="remoteAvailable" ${member.remote_available?'checked':''}> Remote work</label>
    <label><input type="checkbox" id="eventsAvailable" ${member.events_available?'checked':''}> Events and appearances</label>
    <div class="wide"><label>Typical response time</label><input class="field" id="responseTime" value="${esc(member.response_time||'')}" placeholder="Within 24 hours"></div>
  </div><button class="primary" id="saveAvailabilityBtn" style="margin-top:14px">Save availability</button>`);
  setTimeout(()=>$('#saveAvailabilityBtn').onclick=async()=>{
    const updates={
      available_for_work:$('#availableForWork').checked,
      accepting_long_term:$('#acceptingLongTerm').checked,
      accepting_short_term:$('#acceptingShortTerm').checked,
      remote_available:$('#remoteAvailable').checked,
      events_available:$('#eventsAvailable').checked,
      response_time:$('#responseTime').value.trim()||null
    };
    const {error}=await sb.from('profiles').update(updates).eq('id',user.id);
    if(error)return showToast(error.message);
    closeModal();
    showToast('Availability updated');
    renderPublicProfile(user.id)
  },0)
}

function normalizeProfileUrl(value){
  const clean=(value||'').trim();
  if(!clean)return null;
  if(/^https?:\/\//i.test(clean))return clean;
  return `https://${clean}`
}

function openCreatorProfileEditor(member){
  modal('Edit profile',`<div class="profile-edit-grid">
    <div><label>Display name</label><input class="field" id="creatorEditName" value="${esc(member.full_name||'')}"></div>
    <div><label>Username</label><input class="field" id="creatorEditUsername" value="${esc(member.username||'')}" placeholder="your.username"></div>
    <div class="wide"><label>Headline</label><input class="field" id="creatorEditHeadline" value="${esc(member.headline||'')}" placeholder="Gaming creator · UGC specialist · Streamer"></div>
    <div><label>Niche or industry</label><input class="field" id="creatorEditNiche" value="${esc(member.niche||'')}"></div>
    <div><label>Location</label><input class="field" id="creatorEditLocation" value="${esc(member.location||'')}"></div>
    <div class="wide"><label>Bio</label><textarea class="field" id="creatorEditBio">${esc(member.bio||'')}</textarea></div>

    <div>
      <label>Profile picture</label>
      <input class="field" id="creatorEditAvatar" type="file" accept="image/png,image/jpeg,image/webp">
      <img class="asset-preview" id="creatorAvatarPreview" src="${esc(member.avatar_url||EMPTY)}">
    </div>

    <div>
      <label>Banner image</label>
      <input class="field" id="creatorEditBanner" type="file" accept="image/png,image/jpeg,image/webp">
      <img class="banner-preview" id="creatorBannerPreview" src="${esc(member.banner_url||EMPTY)}">
    </div>

    <div><label>Website</label><input class="field" id="creatorEditWebsite" value="${esc(member.website_url||'')}"></div>
    <div><label>Instagram</label><input class="field" id="creatorEditInstagram" value="${esc(member.instagram_url||'')}"></div>
    <div><label>TikTok</label><input class="field" id="creatorEditTikTok" value="${esc(member.tiktok_url||'')}"></div>
    <div><label>YouTube</label><input class="field" id="creatorEditYouTube" value="${esc(member.youtube_url||'')}"></div>
    <div><label>Twitch</label><input class="field" id="creatorEditTwitch" value="${esc(member.twitch_url||'')}"></div>
    <div><label>X / Twitter</label><input class="field" id="creatorEditX" value="${esc(member.x_url||'')}"></div>
    <div><label>LinkedIn</label><input class="field" id="creatorEditLinkedIn" value="${esc(member.linkedin_url||'')}"></div>
    <div><label>Discord invite or profile</label><input class="field" id="creatorEditDiscord" value="${esc(member.discord_url||'')}"></div>
  </div>

  <div class="profile-save-status muted" id="profileSaveStatus"></div>
  <button class="primary" id="saveCreatorProfileBtn" style="margin-top:15px;width:100%">Save changes</button>`);

  setTimeout(()=>{
    const saveButton=$('#saveCreatorProfileBtn');
    const status=$('#profileSaveStatus');

    $('#creatorEditAvatar')?.addEventListener('change',event=>{
      const file=event.target.files?.[0];
      if(file)$('#creatorAvatarPreview').src=URL.createObjectURL(file)
    });

    $('#creatorEditBanner')?.addEventListener('change',event=>{
      const file=event.target.files?.[0];
      if(file)$('#creatorBannerPreview').src=URL.createObjectURL(file)
    });

    saveButton.onclick=async()=>{
      if(saveButton.disabled)return;

      const fullName=$('#creatorEditName').value.trim();
      const username=$('#creatorEditUsername').value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g,'')
        .replace(/^[._-]+|[._-]+$/g,'');

      if(!fullName)return showToast('Display name is required.');
      if(username.length<3)return showToast('Username must contain at least 3 characters.');

      saveButton.disabled=true;
      saveButton.textContent='Saving…';
      status.textContent='Saving your profile securely…';

      try{
        let avatar=member.avatar_url||null;
        let banner=member.banner_url||null;

        const avatarFile=$('#creatorEditAvatar').files?.[0];
        const bannerFile=$('#creatorEditBanner').files?.[0];

        const uploadWarnings=[];

        if(avatarFile){
          status.textContent='Optimizing and uploading profile picture…';
          try{
            avatar=await uploadProfileAsset(avatarFile,'avatar')
          }catch(uploadError){
            console.error(uploadError);
            uploadWarnings.push(`Profile picture: ${uploadError.message}`)
          }
        }

        if(bannerFile){
          status.textContent='Optimizing and uploading banner…';
          try{
            banner=await uploadProfileAsset(bannerFile,'banner')
          }catch(uploadError){
            console.error(uploadError);
            uploadWarnings.push(`Banner: ${uploadError.message}`)
          }
        }

        const updates={
          full_name:fullName,
          username,
          headline:$('#creatorEditHeadline').value.trim(),
          niche:$('#creatorEditNiche').value.trim(),
          location:$('#creatorEditLocation').value.trim(),
          bio:$('#creatorEditBio').value.trim(),
          avatar_url:avatar,
          banner_url:banner,
          website_url:normalizeProfileUrl($('#creatorEditWebsite').value),
          instagram_url:normalizeProfileUrl($('#creatorEditInstagram').value),
          tiktok_url:normalizeProfileUrl($('#creatorEditTikTok').value),
          youtube_url:normalizeProfileUrl($('#creatorEditYouTube').value),
          twitch_url:normalizeProfileUrl($('#creatorEditTwitch').value),
          x_url:normalizeProfileUrl($('#creatorEditX').value),
          linkedin_url:normalizeProfileUrl($('#creatorEditLinkedIn').value),
          discord_url:normalizeProfileUrl($('#creatorEditDiscord').value),
          updated_at:new Date().toISOString()
        };

        status.textContent='Saving changes…';

        const {data:updated,error}=await sb
          .from('profiles')
          .update(updates)
          .eq('id',user.id)
          .select('*')
          .single();

        if(error)throw error;
        if(!updated)throw new Error('The profile update was not returned by the database.');

        // Update the in-memory profile only after Supabase confirms the save.
        profile=updated;
        member=updated;
        syncIdentity();

        if(uploadWarnings.length){
          status.textContent='Profile text saved, but an image could not be uploaded.';
          showToast('Profile saved. One image upload needs attention.');
          alert(`Your profile details were saved.\n\n${uploadWarnings.join('\n')}`)
        }else{
          status.textContent='Saved successfully.';
          showToast('Profile changes saved')
        }
        closeModal();

        history.replaceState(
          {profileId:user.id},
          '',
          `/#/profile/${encodeURIComponent(updated.username||user.id)}`
        );

        await renderPublicProfile(user.id)
      }catch(error){
        console.error('Profile save failed:',error);

        if(/duplicate|unique/i.test(error.message||'')){
          status.textContent='That username is already taken.';
          showToast('That username is already taken. Choose another one.')
        }else if(/failed to fetch|network|load failed/i.test(error.message||'')){
          status.textContent='The browser could not reach Supabase. Your existing profile data is safe.';
          showToast('Could not reach Supabase. Check your connection and storage setup.')
        }else if(/not-null|null value in column/i.test(error.message||'')){
          status.textContent='One of the optional profile fields is still required by the database. Run the included SQL hotfix.';
          showToast('Run PROFILE-OPTIONAL-FIELDS-HOTFIX.sql in Supabase, then save again.')
        }else if(/row-level security|policy|permission/i.test(error.message||'')){
          status.textContent='Profile permissions need to be repaired in Supabase.';
          showToast('Profile save permission is missing. Run the included SQL repair.')
        }else{
          status.textContent=error.message||'The profile could not be saved.';
          showToast(error.message||'The profile could not be saved.')
        }
      }finally{
        saveButton.disabled=false;
        saveButton.textContent='Save changes'
      }
    }
  },0)
}
async function connectionsPage(){
  await loadSocial();

  const followedProfiles=follows
    .map(f=>members.find(m=>m.id===f.following_id))
    .filter(Boolean);

  let currentFilter='all';
  let currentSearch='';

  const followerCountResult=await sb.from('follows').select('*',{count:'exact',head:true}).eq('following_id',user.id);
  const followerCount=followerCountResult.count||0;

  main.innerHTML=`<div class="following-page">
    <section class="card following-hero">
      <div class="following-hero-top">
        <div>
          <h1 style="margin:0 0 6px">Following</h1>
          <p class="muted" style="margin:0">Keep up with creators, brands, and agencies you care about.</p>
        </div>
        <div class="following-stats">
          <div class="following-stat"><strong>${followedProfiles.length}</strong><span>Following</span></div>
          <div class="following-stat"><strong>${followerCount}</strong><span>Followers</span></div>
        </div>
      </div>
      <div class="following-toolbar">
        <input class="field" id="followingSearch" placeholder="Search who you follow">
        <div class="following-filters">
          <button class="following-filter active" data-following-filter="all">All</button>
          <button class="following-filter" data-following-filter="creator">Creators</button>
          <button class="following-filter" data-following-filter="brand">Brands</button>
          <button class="following-filter" data-following-filter="agency">Agencies</button>
        </div>
      </div>
    </section>

    ${followedProfiles.length?`
    <section>
      <div class="page-title" style="margin-bottom:10px"><div><h2>Recently active</h2><p class="muted">Quick access to people you follow.</p></div></div>
      <div class="active-strip" id="activeFollowingStrip"></div>
    </section>`:''}

    <section>
      <div class="page-title" style="margin-bottom:10px"><div><h2>Your following</h2><p class="muted">Message, view, or unfollow any profile.</p></div></div>
      <div class="following-list" id="followingList"></div>
    </section>

    <section>
      <div class="page-title" style="margin-bottom:10px"><div><h2>Suggested for you</h2><p class="muted">Public profiles you may want to follow next.</p></div></div>
      <div class="suggested-grid" id="followingSuggestions"></div>
    </section>
  </div>`;

  const getFiltered=()=>followedProfiles.filter(m=>{
    const matchesType=currentFilter==='all'||m.account_type===currentFilter;
    const text=`${m.full_name||''} ${m.username||''} ${m.headline||''} ${m.niche||''}`.toLowerCase();
    return matchesType&&text.includes(currentSearch);
  });

  const renderActive=()=>{
    const strip=$('#activeFollowingStrip');
    if(!strip)return;
    strip.innerHTML=followedProfiles.slice(0,10).map(m=>`<div class="active-person" data-profile-id="${m.id}">
      <div class="active-avatar-wrap">
        <img class="active-avatar" src="${esc(m.avatar_url||EMPTY)}">
        ${m.show_activity_status?'<span class="active-dot"></span>':''}
      </div>
      <div class="active-name">${esc(m.full_name)}</div>
      <div class="active-status">${m.show_activity_status?'Active recently':'Creator profile'}</div>
    </div>`).join('');
    bindProfileLinks()
  };

  const renderFollowing=()=>{
    const list=getFiltered();
    $('#followingList').innerHTML=list.length?list.map(m=>`<article class="card following-card">
      <img class="following-avatar" src="${esc(m.avatar_url||EMPTY)}">
      <div class="following-info">
        <button class="profile-link" data-profile-id="${m.id}">
          <h3>${esc(m.full_name)} ${m.is_verified?'<span class="verified">✓</span>':''}${m.is_founder?'<span class="badge">Founder</span>':''}</h3>
        </button>
        <div class="muted">@${esc(m.username||'member')} · ${esc(m.headline||m.account_type||'member')}</div>
        <div class="following-meta">
          <span class="chip">${esc(m.account_type||'member')}</span>
          ${m.niche?`<span class="chip">${esc(m.niche)}</span>`:''}
          ${m.location?`<span class="chip">${esc(m.location)}</span>`:''}
        </div>
      </div>
      <div class="following-actions">
        <button class="primary" data-message-user="${m.id}">Message</button>
        <button class="secondary" data-profile-id="${m.id}">View profile</button>
        <button class="secondary" data-unfollow-network="${m.id}">Following</button>
      </div>
    </article>`).join(''):`<section class="card empty-following"><h2>No matches</h2><p class="muted">Try another search or filter.</p></section>`;

    $$('[data-message-user]').forEach(b=>b.onclick=()=>startConversation(b.dataset.messageUser));
    $$('[data-unfollow-network]').forEach(b=>b.onclick=async()=>{
      const {error}=await sb.from('follows').delete().eq('follower_id',user.id).eq('following_id',b.dataset.unfollowNetwork);
      if(error)return showToast(error.message);
      showToast('Unfollowed');
      connectionsPage()
    });
    bindProfileLinks()
  };

  const suggestions=members
    .filter(m=>!follows.some(f=>f.following_id===m.id))
    .filter(m=>m.id!==user.id)
    .slice(0,6);

  $('#followingSuggestions').innerHTML=suggestions.length?suggestions.map(m=>`<article class="card suggested-card">
    <img class="avatar" src="${esc(m.avatar_url||EMPTY)}">
    <button class="profile-link" data-profile-id="${m.id}" style="margin-top:10px">
      <h3 style="margin:0">${esc(m.full_name)} ${m.is_verified?'<span class="verified">✓</span>':''}</h3>
    </button>
    <div class="muted">@${esc(m.username||'member')}</div>
    <p class="muted">${esc(m.headline||m.account_type||'member')}</p>
    <button class="primary" data-follow-suggestion="${m.id}" style="width:100%">Follow</button>
  </article>`).join(''):`<section class="card empty-following"><p class="muted">You already follow everyone available.</p></section>`;

  $$('[data-follow-suggestion]').forEach(b=>b.onclick=async()=>{
    const {error}=await sb.from('follows').insert({follower_id:user.id,following_id:b.dataset.followSuggestion});
    if(error)return showToast(error.message);
    showToast('Following member');
    connectionsPage()
  });

  $('#followingSearch').oninput=e=>{currentSearch=e.target.value.trim().toLowerCase();renderFollowing()};
  $$('[data-following-filter]').forEach(b=>b.onclick=()=>{
    currentFilter=b.dataset.followingFilter;
    $$('[data-following-filter]').forEach(x=>x.classList.toggle('active',x===b));
    renderFollowing()
  });

  renderActive();
  renderFollowing()
}
function renderRequests(){const el=$('#requestsList');if(!el)return;el.innerHTML=requests.length?requests.map(r=>`<div class="request row"><img class="avatar" src="${esc(r.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><strong>${esc(r.profiles?.full_name||'Member')}</strong><div class="muted">${esc(r.profiles?.headline||r.profiles?.account_type||'member')}</div></div><button class="primary" data-accept="${r.id}">Accept</button><button class="secondary" data-decline="${r.id}">Decline</button></div>`).join(''):'<p class="muted">No pending requests.</p>';$$('[data-accept]').forEach(b=>b.onclick=async()=>{await sb.from('connections').update({status:'accepted',responded_at:new Date().toISOString()}).eq('id',b.dataset.accept);showToast('Connection accepted');connectionsPage()});$$('[data-decline]').forEach(b=>b.onclick=async()=>{await sb.from('connections').delete().eq('id',b.dataset.decline);connectionsPage()})}


async function startConversation(otherId){
  if(!otherId||otherId===user.id)return;

  const {data:recipient,error:recipientError}=await sb
    .from('profiles')
    .select('allow_direct_messages,full_name')
    .eq('id',otherId)
    .single();

  if(recipientError)return showToast(recipientError.message);
  if(recipient?.allow_direct_messages===false){
    return showToast(`${recipient.full_name||'This member'} is not accepting new direct messages.`)
  }

  const {data,error}=await sb.rpc('get_or_create_conversation',{other_user:otherId});
  if(error)return showToast(error.message);
  activeConversation=data;
  setPage('messages')
}
function formatThreadTime(value){
  if(!value)return '';
  const d=new Date(value),now=new Date(),diff=now-d;
  if(diff<60000)return 'now';
  if(diff<86400000)return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  if(diff<604800000)return d.toLocaleDateString([],{weekday:'short'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'})
}
async function messagesPage(){
  await loadSocial();
  cleanupRealtimeChannels();
  main.innerHTML=`<div class="page-title"><div><h1>Messages</h1><p class="muted">Realtime conversations with creators, businesses, and agencies.</p></div></div>
  <section class="card thread-list">
    <div class="threads">
      <div class="inbox-head"><button class="primary" id="newMessageBtn" style="width:100%">New message</button></div>
      <div id="threadItems"></div>
    </div>
    <div class="chat" id="chatPanel"><div class="empty"><h2>Select a conversation</h2><p class="muted">Choose an existing chat or start a new one.</p></div></div>
  </section>`;
  $('#newMessageBtn').onclick=()=>{
    modal('New message',`<input class="field" id="messageMemberSearch" placeholder="Search creators, businesses, or agencies"><div id="messageMemberList" style="margin-top:10px;max-height:380px;overflow:auto"></div>`);
    const draw=()=>{
      const q=($('#messageMemberSearch').value||'').toLowerCase();
      const found=members.filter(m=>(m.full_name+' '+(m.username||'')+' '+(m.headline||'')+' '+(m.account_type||'')).toLowerCase().includes(q));
      $('#messageMemberList').innerHTML=found.length?found.map(m=>`<button class="secondary" data-start="${m.id}" style="width:100%;margin:5px 0;text-align:left;display:flex;align-items:center;gap:10px"><img class="avatar" src="${esc(m.avatar_url||EMPTY)}"><span><button class="profile-link" data-profile-id="${m.id}"><strong>${esc(m.full_name)}</strong></button><br><small class="muted">@${esc(m.username||'member')} · ${esc(m.headline||m.account_type||'member')}</small></span></button>`).join(''):'<p class="muted">No members found.</p>';
      $$('[data-start]').forEach(b=>b.onclick=()=>{closeModal();startConversation(b.dataset.start)});
    };
    $('#messageMemberSearch').oninput=draw;draw()
  };
  await renderThreads();
  subscribeInbox();
  if(activeConversation)openConversation(activeConversation)
}
async function renderThreads(){
  const [{data:rows,error},{data:prefs}]=await Promise.all([
    sb.from('conversation_members').select('conversation_id,conversations(id,updated_at)').eq('user_id',user.id),
    sb.from('conversation_preferences').select('*').eq('user_id',user.id)
  ]);
  if(error){$('#threadItems').innerHTML=`<p class="muted" style="padding:14px">${esc(error.message)}</p>`;return}
  const prefMap=new Map((prefs||[]).map(p=>[p.conversation_id,p]));
  const items=[];
  for(const row of rows||[]){
    const pref=prefMap.get(row.conversation_id);
    if(pref?.hidden_at)continue;
    const [{data:others},{data:last},{count:unread}]=await Promise.all([
      sb.from('conversation_members').select('profiles:conversation_members_user_id_fkey(*)').eq('conversation_id',row.conversation_id).neq('user_id',user.id).limit(1),
      sb.from('messages').select('body,created_at,sender_id').eq('conversation_id',row.conversation_id).order('created_at',{ascending:false}).limit(1).maybeSingle(),
      sb.from('messages').select('id',{count:'exact',head:true}).eq('conversation_id',row.conversation_id).neq('sender_id',user.id).is('read_at',null)
    ]);
    items.push({id:row.conversation_id,updated_at:last?.created_at||row.conversations?.updated_at,other:others?.[0]?.profiles,last,pref,unread:unread||0})
  }
  items.sort((a,b)=>(Number(b.pref?.is_pinned)-Number(a.pref?.is_pinned))||(new Date(b.updated_at)-new Date(a.updated_at)));
  conversations=items;
  $('#threadItems').innerHTML=items.length?items.map(i=>`<div class="thread ${activeConversation===i.id?'active':''}" data-conversation="${i.id}">
    <img class="thread-avatar" src="${esc(i.other?.avatar_url||EMPTY)}">
    <div class="thread-copy">
      <div class="thread-name"><button class="profile-link" data-profile-id="${i.other?.id||''}">${esc(i.other?.full_name||'Conversation')} ${i.other?.is_verified?'<span class="verified">✓</span>':''}</button> ${i.pref?.is_pinned?'<span class="pinned-mark">📌</span>':''}</div>
      <div class="thread-preview">${i.last?.sender_id===user.id?'You: ':''}${esc(i.last?.body||i.other?.headline||'Start the conversation')}</div>
    </div>
    <div style="text-align:right"><div class="thread-time">${formatThreadTime(i.updated_at)}</div><div class="thread-icons">${i.pref?.is_muted?'🔕':''}${i.unread?'<span class="unread-dot"></span>':''}</div></div>
  </div>`).join(''):'<p class="muted" style="padding:18px">No conversations yet.</p>';
  $$('[data-conversation]').forEach(b=>b.onclick=()=>openConversation(b.dataset.conversation));bindProfileLinks()
}
function cleanupRealtimeChannels(){
  [messageChannel,typingChannel,inboxChannel].forEach(ch=>{if(ch)sb.removeChannel(ch)});
  messageChannel=typingChannel=inboxChannel=null;
  clearTimeout(typingTimer)
}
function subscribeInbox(){
  if(inboxChannel)sb.removeChannel(inboxChannel);
  inboxChannel=sb.channel(`inbox:${user.id}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>renderThreads())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_preferences',filter:`user_id=eq.${user.id}`},()=>renderThreads())
    .subscribe()
}
async function markConversationRead(id){
  await sb.rpc('mark_conversation_read',{target_conversation:id});
  renderThreads();bindProfileLinks()
}
function renderMessageRows(msgs,other){
  return (msgs||[]).map(m=>`<div class="message-row ${m.sender_id===user.id?'me':''}">
    ${m.sender_id===user.id?'':`<img class="message-avatar" src="${esc(other?.avatar_url||EMPTY)}">`}
    <div class="bubble ${m.sender_id===user.id?'me':''}">${esc(m.body)}<div class="bubble-time">${new Date(m.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div></div>
  </div>`).join('')
}
async function openConversation(id){
  activeConversation=id;
  if(messageChannel)sb.removeChannel(messageChannel);
  if(typingChannel)sb.removeChannel(typingChannel);
  const [{data:msgs,error},{data:others},{data:pref}]=await Promise.all([
    sb.from('messages').select('*').eq('conversation_id',id).order('created_at'),
    sb.from('conversation_members').select('profiles:conversation_members_user_id_fkey(*)').eq('conversation_id',id).neq('user_id',user.id).limit(1),
    sb.from('conversation_preferences').select('*').eq('conversation_id',id).eq('user_id',user.id).maybeSingle()
  ]);
  if(error)return showToast(error.message);
  const other=others?.[0]?.profiles;
  currentChatOther=other;
  $('#chatPanel').innerHTML=`<div class="chat-head">
    <img class="chat-head-avatar" src="${esc(other?.avatar_url||EMPTY)}">
    <div class="chat-head-copy"><button class="profile-link" data-profile-id="${other?.id||''}"><strong>${esc(other?.full_name||'Conversation')} ${other?.is_verified?'<span class="verified">✓</span>':''}</strong></button><span id="chatPresence">@${esc(other?.username||'member')} · ${esc(other?.headline||other?.account_type||'member')}</span></div>
    <div class="chat-menu-wrap"><button class="chat-options-btn" id="chatMenuBtn" aria-label="Conversation options" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="chat-menu hidden" id="chatMenu">
        <button id="viewChatProfileBtn"><span>View profile</span></button>
        <button id="pinChatBtn"><span>${pref?.is_pinned?'Unpin chat':'Pin chat'}</span></button>
        <button id="muteChatBtn"><span>${pref?.is_muted?'Unmute chat':'Mute chat'}</span></button>
        <div class="chat-menu-divider"></div>
        <button class="danger" id="deleteChatBtn"><span>Delete conversation</span></button>
      </div>
    </div>
  </div>
  <div class="chat-body" id="chatBody">${renderMessageRows(msgs,other)}</div>
  <div class="typing-line" id="typingLine"></div>
  <div class="chat-compose"><textarea class="field" id="messageInput" rows="1" placeholder="Message ${esc(other?.full_name||'member')}"></textarea><button class="primary" id="sendMessageBtn">Send</button></div>`;
  $('#chatMenuBtn').onclick=event=>{
    event.stopPropagation();
    const menu=$('#chatMenu');
    const open=menu.classList.contains('hidden');
    menu.classList.toggle('hidden',!open);
    $('#chatMenuBtn').setAttribute('aria-expanded',String(open))
  };
  document.addEventListener('click',event=>{
    if(!event.target.closest('.chat-menu-wrap')){
      $('#chatMenu')?.classList.add('hidden');
      $('#chatMenuBtn')?.setAttribute('aria-expanded','false')
    }
  },{once:true});
  $('#viewChatProfileBtn').onclick=()=>{
    if(other?.id)openMemberProfile(other.id)
  };
  $('#pinChatBtn').onclick=()=>setConversationPreference(id,'is_pinned',!pref?.is_pinned);
  $('#muteChatBtn').onclick=()=>setConversationPreference(id,'is_muted',!pref?.is_muted);
  $('#deleteChatBtn').onclick=()=>deleteChatForMe(id);
  const input=$('#messageInput');
  input.oninput=()=>{
    input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';
    typingChannel?.send({type:'broadcast',event:'typing',payload:{user_id:user.id,is_typing:true}});
    clearTimeout(typingTimer);
    typingTimer=setTimeout(()=>typingChannel?.send({type:'broadcast',event:'typing',payload:{user_id:user.id,is_typing:false}}),1200)
  };
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendCurrentMessage(id)}};
  $('#sendMessageBtn').onclick=()=>sendCurrentMessage(id);
  messageChannel=sb.channel(`messages:${id}`)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${id}`},async payload=>{
      const m=payload.new;
      $('#chatBody').insertAdjacentHTML('beforeend',renderMessageRows([m],other));
      $('#chatBody').scrollTop=$('#chatBody').scrollHeight;
      if(m.sender_id!==user.id)await markConversationRead(id);
      renderThreads()
    }).subscribe();
  typingChannel=sb.channel(`typing:${id}`,{config:{broadcast:{self:false},presence:{key:user.id}}})
    .on('broadcast',{event:'typing'},({payload})=>{
      if(payload.user_id===user.id)return;
      $('#typingLine').innerHTML=payload.is_typing?`${esc(other?.full_name||'Member')} is typing <span class="typing-dots"><i></i><i></i><i></i></span>`:''
    })
    .on('presence',{event:'sync'},()=>{
      const state=typingChannel.presenceState();
      const otherOnline=Object.keys(state).some(key=>key!==user.id);
      $('#chatPresence').innerHTML=`${otherOnline?'<span class="online-dot"></span> Online':'@'+esc(other?.username||'member')+' · '+esc(other?.headline||other?.account_type||'member')}`
    })
    .subscribe(async status=>{if(status==='SUBSCRIBED')await typingChannel.track({user_id:user.id,online_at:new Date().toISOString()})});
  await markConversationRead(id);
  setTimeout(()=>{$('#chatBody').scrollTop=$('#chatBody').scrollHeight},0);
  renderThreads()
}
async function sendCurrentMessage(id){
  const input=$('#messageInput'),body=input.value.trim();
  if(!body)return;
  $('#sendMessageBtn').disabled=true;
  const {error}=await sb.rpc('send_message',{target_conversation:id,message_body:body});
  $('#sendMessageBtn').disabled=false;
  if(error)return showToast(error.message);
  input.value='';input.style.height='auto';
  typingChannel?.send({type:'broadcast',event:'typing',payload:{user_id:user.id,is_typing:false}})
}
async function setConversationPreference(id,column,value){
  const record={conversation_id:id,user_id:user.id,[column]:value,hidden_at:null,updated_at:new Date().toISOString()};
  const {error}=await sb.from('conversation_preferences').upsert(record,{onConflict:'conversation_id,user_id'});
  if(error)return showToast(error.message);
  showToast(value?(column==='is_pinned'?'Chat pinned':'Chat muted'):(column==='is_pinned'?'Chat unpinned':'Chat unmuted'));
  openConversation(id);renderThreads()
}
async function deleteChatForMe(id){
  if(!confirm('Remove this chat from your inbox? The other person will keep their copy.'))return;
  const {error}=await sb.from('conversation_preferences').upsert({conversation_id:id,user_id:user.id,hidden_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'conversation_id,user_id'});
  if(error)return showToast(error.message);
  activeConversation=null;cleanupRealtimeChannels();messagesPage();showToast('Chat removed')
}

async function opportunitiesPage(){
  const isBrand=profile.account_type==='brand';
  const {data:opps,error}=await sb.from('opportunities')
    .select('*,profiles!opportunities_business_id_fkey(full_name,avatar_url,is_verified,account_type)')
    .eq('status','open').order('created_at',{ascending:false});
  if(error){main.innerHTML=`<section class="card empty"><h2>Could not load opportunities</h2><p class="muted">${esc(error.message)}</p></section>`;return}
  let myApplications=[];
  if(!isBrand){
    const {data}=await sb.from('applications').select('opportunity_id,status').eq('applicant_id',user.id);
    myApplications=data||[];
  }
  let businessStats='';
  if(isBrand){
    const {data:mine}=await sb.from('opportunities').select('id,status').eq('business_id',user.id);
    const ids=(mine||[]).map(x=>x.id);
    let apps=[];
    if(ids.length){const {data}=await sb.from('applications').select('id,status,opportunity_id').in('opportunity_id',ids);apps=data||[]}
    businessStats=`<div class="dashboard-stats">
      <section class="card stat-card"><strong>${(mine||[]).filter(x=>x.status==='open').length}</strong><span class="muted">Open opportunities</span></section>
      <section class="card stat-card"><strong>${apps.length}</strong><span class="muted">Applications</span></section>
      <section class="card stat-card"><strong>${apps.filter(x=>x.status==='accepted').length}</strong><span class="muted">Accepted creators</span></section>
    </div>`;
  }
  main.innerHTML=`<div class="page-title"><div><h1>Opportunities</h1><p class="muted">Paid partnerships and creator work posted by registered brands.</p></div>${isBrand?'<button class="primary" id="createOpportunityBtn">Post opportunity</button>':''}</div>
    ${businessStats}<div class="feed" id="opportunityList"></div>`;
  const list=$('#opportunityList');
  list.innerHTML=(opps||[]).length?(opps||[]).map(o=>{
    const existing=myApplications.find(a=>a.opportunity_id===o.id);
    return `<article class="card opportunity">
      <div class="post-head opportunity-brand-head">
        <button class="profile-avatar-button" data-profile-id="${o.business_id}" aria-label="View ${esc(o.profiles?.full_name||'brand')} profile">
          <img class="avatar" src="${esc(o.profiles?.avatar_url||EMPTY)}">
        </button>
        <div>
          <h3>${esc(o.title)}</h3>
          <button class="profile-link opportunity-brand-link" data-profile-id="${o.business_id}">
            ${esc(o.profiles?.full_name||'Brand')} ${o.profiles?.is_verified?'<span class="verified">✓</span>':''}
          </button>
          <div class="muted">Brand opportunity</div>
        </div>
      </div>
      <p>${esc(o.description)}</p>
      <div class="opportunity-meta">
        ${o.compensation?`<span class="chip">${esc(o.compensation)}</span>`:''}
        ${o.opportunity_type?`<span class="chip">${esc(o.opportunity_type)}</span>`:''}
        ${o.platforms?`<span class="chip">${esc(o.platforms)}</span>`:''}
        ${o.location?`<span class="chip">${esc(o.location)}</span>`:''}
      </div>
      ${o.requirements?`<p><strong>Requirements:</strong> ${esc(o.requirements)}</p>`:''}
      ${o.deadline?`<div class="muted">Apply by ${new Date(o.deadline).toLocaleDateString()}</div>`:''}
      <div class="opportunity-footer">
        ${o.business_id===user.id?`<button class="secondary" data-view-applicants="${o.id}">View applicants</button><button class="secondary danger" data-close-opportunity="${o.id}">Close</button>`:
        isBrand?`<button class="secondary" data-profile-id="${o.business_id}">View brand</button>`:
        `<button class="secondary" data-profile-id="${o.business_id}">View brand</button>
         <button class="secondary" data-message-brand="${o.business_id}">Message brand</button>
         ${existing?`<button class="secondary" disabled>Application: ${esc(existing.status)}</button>`:`<button class="primary" data-apply="${o.id}">Apply</button>`}` }
      </div>
    </article>`
  }).join(''):`<section class="card empty"><h2>No opportunities yet</h2><p class="muted">${isBrand?'Post the first real opportunity for the community.':'Brands have not posted any opportunities yet.'}</p></section>`;
  if(isBrand)$('#createOpportunityBtn').onclick=openOpportunityForm;
  bindProfileLinks();
  $$('[data-message-brand]').forEach(b=>b.onclick=()=>startConversation(b.dataset.messageBrand));
  $$('[data-apply]').forEach(b=>b.onclick=()=>openApplicationForm(b.dataset.apply));
  $$('[data-view-applicants]').forEach(b=>b.onclick=()=>viewApplicants(b.dataset.viewApplicants));
  $$('[data-close-opportunity]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('opportunities').update({status:'closed'}).eq('id',b.dataset.closeOpportunity).eq('business_id',user.id);if(error)showToast(error.message);else{showToast('Opportunity closed');opportunitiesPage()}})
}
function openOpportunityForm(){
  if(profile?.account_type!=='brand'){
    return showToast('Only verified brand accounts can post opportunities.')
  }
  modal('Post an opportunity',`<div class="form-grid">
    <div class="wide"><label>Title</label><input class="field" id="oppTitle" placeholder="UGC creators for summer campaign"></div>
    <div><label>Opportunity type</label><select class="field" id="oppType"><option>Paid sponsorship</option><option>UGC project</option><option>Affiliate program</option><option>Ambassador program</option><option>Collaboration</option><option>Job or contract</option></select></div>
    <div><label>Compensation</label><input class="field" id="oppComp" placeholder="$500–$2,000"></div>
    <div><label>Platforms</label><input class="field" id="oppPlatforms" placeholder="TikTok, Instagram"></div>
    <div><label>Location</label><input class="field" id="oppLocation" placeholder="Remote or city"></div>
    <div class="wide"><label>Description</label><textarea class="field" id="oppDescription" placeholder="Describe the campaign and deliverables"></textarea></div>
    <div class="wide"><label>Requirements</label><textarea class="field" id="oppRequirements" placeholder="Audience, niche, follower count, location, age, etc."></textarea></div>
    <div><label>Creators needed</label><input class="field" id="oppSlots" type="number" min="1" value="1"></div>
    <div><label>Application deadline</label><input class="field" id="oppDeadline" type="date"></div>
  </div><button class="primary" id="publishOpportunityBtn" style="margin-top:14px">Publish opportunity</button>`);
  setTimeout(()=>$('#publishOpportunityBtn').onclick=async()=>{
    const record={
      business_id:user.id,title:$('#oppTitle').value.trim(),description:$('#oppDescription').value.trim(),
      opportunity_type:$('#oppType').value,compensation:$('#oppComp').value.trim()||null,
      platforms:$('#oppPlatforms').value.trim()||null,location:$('#oppLocation').value.trim()||null,
      requirements:$('#oppRequirements').value.trim()||null,creators_needed:Number($('#oppSlots').value)||1,
      deadline:$('#oppDeadline').value||null,status:'open'
    };
    if(!record.title||!record.description)return showToast('Add a title and description');
    const {error}=await sb.from('opportunities').insert(record);
    if(error)return showToast(error.message);
    closeModal();showToast('Opportunity published');opportunitiesPage()
  },0)
}
function openApplicationForm(opportunityId){
  modal('Apply to opportunity',`<label>Why are you a good fit?</label><textarea class="field" id="applicationMessage" placeholder="Introduce yourself and explain your fit"></textarea>
  <label>Portfolio or media kit link</label><input class="field" id="portfolioLink" placeholder="https://">
  <button class="primary" id="submitApplicationBtn" style="margin-top:14px">Submit application</button>`);
  setTimeout(()=>$('#submitApplicationBtn').onclick=async()=>{
    const message=$('#applicationMessage').value.trim();
    if(!message)return showToast('Add a short application message');
    const {error}=await sb.from('applications').insert({opportunity_id:opportunityId,applicant_id:user.id,message,portfolio_url:$('#portfolioLink').value.trim()||null,status:'pending'});
    if(error)return showToast(error.message);
    closeModal();showToast('Application submitted');opportunitiesPage()
  },0)
}
async function viewApplicants(opportunityId){
  const {data,error}=await sb.from('applications').select('*,profiles!applications_applicant_id_fkey(full_name,headline,avatar_url,is_verified)').eq('opportunity_id',opportunityId).order('created_at');
  if(error)return showToast(error.message);
  modal('Applicants',(data||[]).length?(data||[]).map(a=>`<div class="application">
    <div class="row"><img class="avatar" src="${esc(a.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><strong>${esc(a.profiles?.full_name||'Creator')} ${a.profiles?.is_verified?'<span class="verified">✓</span>':''}</strong><div class="muted">${esc(a.profiles?.headline||'')}</div></div><span class="chip">${esc(a.status)}</span></div>
    <p>${esc(a.message)}</p>${a.portfolio_url?`<a href="${esc(a.portfolio_url)}" target="_blank" rel="noopener">View portfolio</a>`:''}
    ${a.status==='pending'?`<div class="member-actions"><button class="primary" data-app-status="${a.id}" data-status="accepted">Accept</button><button class="secondary danger" data-app-status="${a.id}" data-status="declined">Decline</button></div>`:''}
  </div>`).join(''):'<p class="muted">No applications yet.</p>');
  setTimeout(()=>$$('[data-app-status]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('applications').update({status:b.dataset.status,reviewed_at:new Date().toISOString()}).eq('id',b.dataset.appStatus);if(error)showToast(error.message);else{showToast(`Application ${b.dataset.status}`);closeModal();opportunitiesPage()}}),0)
}

async function profilePage(){
  activeProfileId=user.id;
  await renderPublicProfile(user.id);
}
function profileCompletion(p){
  const fields=[p.full_name,p.headline,p.bio,p.niche,p.location,p.avatar_url,p.website_url||p.instagram_url||p.tiktok_url||p.youtube_url];
  const done=fields.filter(Boolean).length;
  return {percent:Math.round(done/fields.length*100),done,total:fields.length};
}
function strengthCard(){
  const s=profileCompletion(profile);
  const items=[
    ['Add a profile image',!!profile.avatar_url],
    ['Add a professional headline',!!profile.headline],
    ['Write your bio',!!profile.bio],
    ['Add your niche or industry',!!profile.niche],
    ['Add your location',!!profile.location],
    ['Add at least one link',!!(profile.website_url||profile.instagram_url||profile.tiktok_url||profile.youtube_url)]
  ];
  return `<section class="card profile-strength"><div class="strength-row"><strong>Profile strength</strong><strong>${s.percent}%</strong></div><div class="strength-bar"><span style="width:${s.percent}%"></span></div><div class="checklist">${items.map(i=>`<div class="checkitem ${i[1]?'done':''}">${i[1]?'✓':'○'} ${i[0]}</div>`).join('')}</div></section>`
}
async function prepareProfileImage(file,kind='avatar'){
  if(!file)throw new Error('Choose an image.');
  if(!file.type.startsWith('image/'))throw new Error('Choose a JPG, PNG, or WebP image.');
  if(file.size>12*1024*1024)throw new Error('Choose an image under 12 MB.');

  const maxWidth=kind==='banner'?1800:900;
  const maxHeight=kind==='banner'?700:900;

  return await new Promise((resolve,reject)=>{
    const image=new Image();
    const objectUrl=URL.createObjectURL(file);

    image.onload=()=>{
      try{
        let width=image.naturalWidth;
        let height=image.naturalHeight;
        const scale=Math.min(1,maxWidth/width,maxHeight/height);
        width=Math.max(1,Math.round(width*scale));
        height=Math.max(1,Math.round(height*scale));

        const canvas=document.createElement('canvas');
        canvas.width=width;
        canvas.height=height;
        const context=canvas.getContext('2d',{alpha:false});
        context.fillStyle='#ffffff';
        context.fillRect(0,0,width,height);
        context.drawImage(image,0,0,width,height);

        canvas.toBlob(blob=>{
          URL.revokeObjectURL(objectUrl);
          if(!blob)return reject(new Error('The selected image could not be processed.'));
          resolve(new File(
            [blob],
            `${kind}.jpg`,
            {type:'image/jpeg',lastModified:Date.now()}
          ))
        },'image/jpeg',kind==='banner'?.88:.9)
      }catch(error){
        URL.revokeObjectURL(objectUrl);
        reject(error)
      }
    };

    image.onerror=()=>{
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected image could not be opened.'))
    };

    image.src=objectUrl
  })
}

async function uploadProfileAsset(file,kind='avatar'){
  const optimized=await prepareProfileImage(file,kind);
  const path=`${user.id}/${kind}.jpg`;

  const uploadOnce=async()=>{
    const {error}=await sb.storage
      .from('profile-assets')
      .upload(path,optimized,{
        upsert:true,
        cacheControl:'3600',
        contentType:'image/jpeg'
      });

    if(error)throw error
  };

  try{
    await uploadOnce()
  }catch(error){
    // A short retry handles temporary browser/network failures.
    if(/failed to fetch|network|load failed/i.test(error?.message||String(error))){
      await new Promise(resolve=>setTimeout(resolve,900));
      try{
        await uploadOnce()
      }catch(retryError){
        throw new Error('Image upload could not reach Supabase. Check the profile-assets bucket and run the included storage repair SQL.')
      }
    }else{
      throw error
    }
  }

  const {data}=sb.storage.from('profile-assets').getPublicUrl(path);
  if(!data?.publicUrl)throw new Error('The uploaded image URL could not be created.');

  return `${data.publicUrl}?v=${Date.now()}`
}
function needsOnboarding(p){
  return !p.onboarding_completed;
}
let onboardingState={step:1,account_type:'creator',niche:'',platforms:[],full_name:'',headline:'',bio:'',location:'',website_url:'',avatar_url:null};
function launchOnboarding(){
  onboardingState={...onboardingState,account_type:profile.account_type||'creator',full_name:profile.full_name||'',headline:profile.headline||'',bio:profile.bio||'',location:profile.location||'',website_url:profile.website_url||'',avatar_url:profile.avatar_url||null};
  $('#onboarding').classList.remove('hidden');renderOnboarding();
}
function renderOnboarding(){
  $('#onboarding')?.scrollTo({top:0,behavior:'smooth'});
  const step=onboardingState.step;
  $('#onboardingStepLabel').textContent=`Step ${step} of 4`;
  $('#onboardingProgress').style.width=`${step*25}%`;
  const body=$('#onboardingBody');
  if(step===1){
    body.innerHTML=`<h1>Welcome to CreatorsIn</h1><p class="muted">What brings you here?</p><div class="choice-grid">
      ${[['creator','Creator','Build your profile, network, and apply to opportunities.'],['brand','Business','Find creators and post partnership opportunities.'],['agency','Agency','Represent talent and manage partnerships.']].map(x=>`<button class="choice ${onboardingState.account_type===x[0]?'active':''}" data-role="${x[0]}"><strong>${x[1]}</strong><div class="muted">${x[2]}</div></button>`).join('')}
    </div><div style="display:flex;justify-content:flex-end;margin-top:22px"><button class="primary" id="onboardingNext">Continue</button></div>`;
    $$('[data-role]').forEach(b=>b.onclick=()=>{onboardingState.account_type=b.dataset.role;renderOnboarding()});
  }else if(step===2){
    const creatorNiches=['Gaming','Fitness','Lifestyle','Beauty','Technology','Finance','Food','Travel','Sports','Music','Education','Other'];
    const businessNiches=['Gaming','Fitness','Fashion','Technology','Food & Beverage','Finance','Entertainment','Sports','Consumer Products','Agency Services','Other'];
    const options=onboardingState.account_type==='creator'?creatorNiches:businessNiches;
    body.innerHTML=`<h1>${onboardingState.account_type==='creator'?'What do you create?':'Tell us your industry'}</h1><p class="muted">This helps real members discover relevant profiles.</p><div class="choice-grid">${options.map(n=>`<button class="choice ${onboardingState.niche===n?'active':''}" data-niche="${esc(n)}">${esc(n)}</button>`).join('')}</div><div style="display:flex;justify-content:space-between;margin-top:22px"><button class="secondary" id="onboardingBack">Back</button><button class="primary" id="onboardingNext">Continue</button></div>`;
    $$('[data-niche]').forEach(b=>b.onclick=()=>{onboardingState.niche=b.dataset.niche;renderOnboarding()});
  }else if(step===3){
    body.innerHTML=`<h1>Build your professional profile</h1><div class="form-grid">
      <div class="wide"><label>${onboardingState.account_type==='creator'?'Full name':'Business or agency name'}</label><input class="field" id="obName" value="${esc(onboardingState.full_name)}"></div>
      <div class="wide"><label>Headline</label><input class="field" id="obHeadline" value="${esc(onboardingState.headline)}" placeholder="${onboardingState.account_type==='creator'?'Gaming creator and streamer':'Fitness apparel brand'}"></div>
      <div><label>Location</label><input class="field" id="obLocation" value="${esc(onboardingState.location)}"></div>
      <div><label>Website</label><input class="field" id="obWebsite" value="${esc(onboardingState.website_url)}" placeholder="https://"></div>
      <div class="wide"><label>Bio</label><textarea class="field" id="obBio">${esc(onboardingState.bio)}</textarea></div>
    </div><div style="display:flex;justify-content:space-between;margin-top:22px"><button class="secondary" id="onboardingBack">Back</button><button class="primary" id="onboardingNext">Continue</button></div>`;
  }else{
    body.innerHTML=`<h1>Add your ${onboardingState.account_type==='creator'?'profile photo':'logo'}</h1><p class="muted">A real photo or logo builds trust. You can change it later.</p><label class="upload-box" for="onboardingPhoto"><strong>Choose image</strong><div class="file-note">JPG, PNG, or WebP · maximum 6 MB</div><input id="onboardingPhoto" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="onboardingPhotoStatus" class="muted" style="margin-top:12px">${onboardingState.avatar_url?'Image ready':''}</div><div style="display:flex;justify-content:space-between;margin-top:22px"><button class="secondary" id="onboardingBack">Back</button><button class="primary" id="finishOnboarding">Finish setup</button></div>`;
    $('#onboardingPhoto').onchange=async e=>{try{$('#onboardingPhotoStatus').textContent='Uploading…';onboardingState.avatar_url=await uploadProfileAsset(e.target.files[0],'avatar');$('#onboardingPhotoStatus').textContent='Image uploaded successfully.'}catch(err){$('#onboardingPhotoStatus').textContent=err.message}}
  }
  $('#onboardingBack')?.addEventListener('click',()=>{saveOnboardingInputs();onboardingState.step--;renderOnboarding()});
  $('#onboardingNext')?.addEventListener('click',()=>{saveOnboardingInputs();if(step===2&&!onboardingState.niche)return showToast('Choose a niche or industry');if(step===3&&!onboardingState.full_name)return showToast('Add your name');onboardingState.step++;renderOnboarding()});
  $('#finishOnboarding')?.addEventListener('click',finishOnboarding);
}
function saveOnboardingInputs(){
  if($('#obName'))onboardingState.full_name=$('#obName').value.trim();
  if($('#obHeadline'))onboardingState.headline=$('#obHeadline').value.trim();
  if($('#obLocation'))onboardingState.location=$('#obLocation').value.trim();
  if($('#obWebsite'))onboardingState.website_url=$('#obWebsite').value.trim();
  if($('#obBio'))onboardingState.bio=$('#obBio').value.trim();
}
async function finishOnboarding(){
  const updates={account_type:onboardingState.account_type,niche:onboardingState.niche||null,full_name:onboardingState.full_name||profile.full_name,headline:onboardingState.headline||null,bio:onboardingState.bio||null,location:onboardingState.location||null,website_url:onboardingState.website_url||null,avatar_url:onboardingState.avatar_url||null,onboarding_completed:true};
  const {error}=await sb.from('profiles').update(updates).eq('id',user.id);
  if(error)return showToast(error.message);
  profile={...profile,...updates};syncIdentity();$('#onboarding').classList.add('hidden');showToast('Welcome to CreatorsIn');setPage('feed')
}
function legalCopy(type){
  const copy={
    terms:'CreatorsIn Early Access Terms: Use the platform lawfully, post only content you own or have permission to share, and do not impersonate people or businesses. Accounts may be suspended for abuse, spam, fraud, or harmful activity.',
    privacy:'Privacy: CreatorsIn stores account, profile, post, connection, message, opportunity, and application information in Supabase to operate the platform. Do not post sensitive personal information publicly.',
    community:'Community Guidelines: Be truthful, professional, respectful, and safe. No fake identities, fraudulent opportunities, harassment, hate, threats, spam, or misleading claims.',
    verification:'Verification: The Founder badge is reserved for the CreatorsIn founder. Verified Creator, Business, and Agency badges are granted only after manual review.'
  };
  modal(type[0].toUpperCase()+type.slice(1),`<p>${esc(copy[type])}</p>`)
}
$$('[data-legal]').forEach(b=>b.onclick=()=>legalCopy(b.dataset.legal));

function applyThemeChoice(choice){
  localStorage.setItem('creatorsin-theme-choice',choice);
  const resolved=choice==='system'
    ?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
    :choice;
  document.documentElement.dataset.theme=resolved;
  document.body.classList.toggle('dark',resolved==='dark');
  localStorage.setItem('cin_theme',resolved);
  
  $$('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===choice));
}
function setSwitchState(button,value){
  if(!button)return;
  button.classList.toggle('on',Boolean(value));
  button.setAttribute('aria-pressed',String(Boolean(value)))
}
function openSettings(){
  $('#settingsWrap').classList.remove('hidden');
  $('#settingsEmail').textContent=user?.email||profile?.email||'';
  const choice=localStorage.getItem('creatorsin-theme-choice')||'light';
  applyThemeChoice(choice);

  setSwitchState($('#dmSwitch'),profile?.allow_direct_messages!==false);
  setSwitchState($('#activitySwitch'),profile?.show_activity_status===true);
  setSwitchState($('#networkNotifSwitch'),profile?.network_notifications!==false);
  setSwitchState($('#messageNotifSwitch'),profile?.message_notifications!==false);
}
function closeSettings(){
  $('#settingsWrap').classList.add('hidden');
}
async function saveProfilePreference(column,value,button,successMessage){
  if(button)button.classList.add('settings-saving');
  const {error}=await sb.from('profiles').update({[column]:value}).eq('id',user.id);
  if(button)button.classList.remove('settings-saving');
  if(error){
    setSwitchState(button,!value);
    return showToast(error.message)
  }
  profile[column]=value;
  setSwitchState(button,value);
  showToast(successMessage)
}
function initializeSettings(){
  const choice=localStorage.getItem('creatorsin-theme-choice')||'light';
  applyThemeChoice(choice);

  $('#closeSettingsBtn')?.addEventListener('click',closeSettings);
  $('#settingsWrap')?.addEventListener('click',event=>{
    if(event.target.id==='settingsWrap')closeSettings()
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      closeSettings();
      closeNotificationCenter()
    }
  });
  $$('[data-theme-choice]').forEach(button=>{
    button.onclick=()=>applyThemeChoice(button.dataset.themeChoice)
  });

  const dbSwitches=[
    ['dmSwitch','allow_direct_messages','Direct message preference saved'],
    ['activitySwitch','show_activity_status','Activity status preference saved'],
    ['networkNotifSwitch','network_notifications','Network notification preference saved'],
    ['messageNotifSwitch','message_notifications','Message notification preference saved']
  ];
  dbSwitches.forEach(([id,column,message])=>{
    const button=$('#'+id);
    if(!button)return;
    button.onclick=()=>{
      const next=!button.classList.contains('on');
      setSwitchState(button,next);
      saveProfilePreference(column,next,button,message)
    }
  });

  $('#openProfileSettingsBtn')?.addEventListener('click',()=>{
    closeSettings();
    setPage('profile')
  });
  $$('[data-settings-legal]').forEach(button=>{
    button.onclick=()=>legalCopy(button.dataset.settingsLegal)
  });
  $('#settingsSignOutBtn')?.addEventListener('click',async()=>{
    const button=$('#settingsSignOutBtn');
    button.disabled=true;
    button.textContent='Signing out…';
    await sb.auth.signOut();
    location.assign('/')
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
    if((localStorage.getItem('creatorsin-theme-choice')||'light')==='system'){
      applyThemeChoice('system')
    }
  });
}
function closeNotificationCenter(){
  $('#notificationCenterWrap')?.classList.add('hidden')
}
async function getNotificationSummary(){
  if(!user)return {items:[],count:0};

  const tasks=[];

  if(profile?.message_notifications!==false){
    tasks.push(
      sb.from('messages')
        .select('id,sender_id,conversation_id,content,created_at')
        .neq('sender_id',user.id)
        .is('read_at',null)
        .order('created_at',{ascending:false})
        .limit(10)
        .then(({data,error})=>error?[]:(data||[]).map(row=>({
          type:'message',
          icon:'💬',
          title:'Unread message',
          copy:row.content||'You received a new message.',
          created_at:row.created_at,
          page:'messages'
        })))
    )
  }

  if(profile?.network_notifications!==false){
    tasks.push(
      sb.from('follows')
        .select('follower_id,created_at,profiles:follows_follower_id_fkey(full_name)')
        .eq('following_id',user.id)
        .order('created_at',{ascending:false})
        .limit(10)
        .then(({data,error})=>error?[]:(data||[]).map(row=>({
          type:'follow',
          icon:'👤',
          title:`${row.profiles?.full_name||'Someone'} followed you`,
          copy:'View your network and discover their profile.',
          created_at:row.created_at,
          page:'connections'
        })))
    )
  }

  const groups=await Promise.all(tasks);
  const items=groups.flat()
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
    .slice(0,15);

  return {items,count:items.length}
}
async function refreshNotificationWidget(){
  if(!user)return;
  const {count}=await getNotificationSummary();
  const badge=$('#notificationCount');
  if(!badge)return;
  badge.textContent=count>99?'99+':String(count);
  badge.classList.toggle('hidden',count===0)
}
async function openNotificationCenter(){
  if(!user)return scrollToPublicAuth('login');
  const wrap=$('#notificationCenterWrap');
  const body=$('#notificationCenterBody');
  wrap.classList.remove('hidden');
  body.innerHTML='<p class="muted">Loading notifications…</p>';

  const {items}=await getNotificationSummary();

  body.innerHTML=items.length
    ?items.map(item=>`<div class="notification-item">
      <div class="notification-symbol">${item.icon}</div>
      <div><strong>${esc(item.title)}</strong><div class="muted">${esc(item.copy)} · ${formatRelativeTime(item.created_at)}</div></div>
      <button class="secondary" data-notification-page="${item.page}">Open</button>
    </div>`).join('')
    :'<div class="empty"><h3>You are all caught up</h3><p class="muted">New messages and network activity will appear here.</p></div>';

  $$('[data-notification-page]').forEach(button=>{
    button.onclick=()=>{
      closeNotificationCenter();
      setPage(button.dataset.notificationPage)
    }
  })
}
async function openMemberProfile(memberId,{push=true}={}){
  if(!memberId)return;
  activeProfileId=memberId;
  activeProfileTab='posts';
  await renderPublicProfile(memberId);
  if(push){
    const target=memberId===user.id?profile:(members.find(m=>m.id===memberId)||null);
    if(target?.username)history.pushState({profileId:memberId},'',`/#/profile/${encodeURIComponent(target.username)}`);
  }
}
function bindProfileLinks(){
  $$('[data-profile-id]').forEach(el=>{
    el.onclick=e=>{
      e.stopPropagation();
      openMemberProfile(el.dataset.profileId);
    };
  });
}

async function routeFromLocation(){
  const hashMatch=location.hash.match(/^#\/profile\/(.+)$/);
  let slug=hashMatch?.[1]?decodeURIComponent(hashMatch[1]):'';

  // Support old profile links once, then convert them to safe hash URLs.
  if(!slug){
    const legacyPath=decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g,''));
    if(legacyPath && legacyPath!=='index.html')slug=legacyPath
  }

  if(!slug)return false;

  const {data,error}=await sb.from('profiles')
    .select('id,username')
    .eq('username',slug)
    .maybeSingle();

  if(error||!data)return false;

  history.replaceState(
    {profileId:data.id},
    '',
    `/#/profile/${encodeURIComponent(data.username)}`
  );

  await openMemberProfile(data.id,{push:false});
  return true
}
window.addEventListener('popstate',async event=>{
  if(event.state?.profileId)await openMemberProfile(event.state.profileId,{push:false});
  else if(!(await routeFromLocation()))setPage('feed')
});

window.addEventListener('hashchange',async()=>{
  if(!(await routeFromLocation()))setPage('feed')
});


function publicPostText(text){
  return esc(text||'').replace(/(^|\s)@([A-Za-z0-9_.-]+)/g,'$1<span class="mention">@$2</span>').replace(/\n/g,'<br>');
}
function scrollToPublicAuth(mode='signup'){
  setAuthMode(mode);
  document.querySelector('.public-auth-side')?.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>$('#emailInput')?.focus(),350)
}
async function renderPublicHome(){
  gate.classList.remove('hidden');
  document.querySelector('header')?.classList.add('hidden');
  document.querySelector('.layout')?.classList.add('hidden');

  $('#publicLoginBtn')?.addEventListener('click',()=>scrollToPublicAuth('login'));
  $('#publicSignupBtn')?.addEventListener('click',()=>scrollToPublicAuth('signup'));
  $('#heroLoginBtn')?.addEventListener('click',()=>scrollToPublicAuth('login'));
  $('#heroSignupBtn')?.addEventListener('click',()=>scrollToPublicAuth('signup'));

  const feed=$('#publicFeed');
  if(!feed)return;

  const [{data:posts,error},{data:likes},{data:comments},{data:reposts}]=await Promise.all([
    sb.from('posts').select('id,user_id,content,media_url,media_type,link_url,created_at,profiles:posts_user_id_fkey(full_name,username,headline,account_type,avatar_url,is_verified,is_founder)').order('created_at',{ascending:false}).limit(30),
    sb.from('post_likes').select('post_id'),
    sb.from('post_comments').select('post_id'),
    sb.from('post_reposts').select('post_id')
  ]);

  if(error){
    feed.innerHTML=`<section class="card public-empty"><h3>Creator content is waiting</h3><p class="muted">Join or log in to explore CreatorsIn.</p></section>`;
    return
  }

  if(!(posts||[]).length){
    feed.innerHTML=`<section class="card public-empty"><h2>Be one of the first creators to post</h2><p class="muted">The feed only shows genuine content from registered accounts.</p><button class="primary" id="emptyFeedSignup">Create your profile</button></section>`;
    $('#emptyFeedSignup')?.addEventListener('click',()=>scrollToPublicAuth('signup'));
    return
  }

  feed.innerHTML=posts.map(p=>{
    const likeCount=(likes||[]).filter(x=>x.post_id===p.id).length;
    const commentCount=(comments||[]).filter(x=>x.post_id===p.id).length;
    const repostCount=(reposts||[]).filter(x=>x.post_id===p.id).length;
    return `<article class="card public-post">
      <div class="public-post-head">
        <img src="${esc(p.profiles?.avatar_url||EMPTY)}" alt="${esc(p.profiles?.full_name||'Creator')}">
        <div style="min-width:0;flex:1">
          <strong>${esc(p.profiles?.full_name||'Creator')} ${p.profiles?.is_verified?'<span class="verified">✓</span>':''}${p.profiles?.is_founder?'<span class="badge">Founder</span>':''}</strong>
          <div class="muted">@${esc(p.profiles?.username||'member')} · ${esc(p.profiles?.headline||p.profiles?.account_type||'creator')} · ${formatRelativeTime(p.created_at)}</div>
        </div>
      </div>
      ${p.content?`<div class="public-post-copy"><p>${publicPostText(p.content)}</p></div>`:''}
      ${p.link_url?`<a class="public-post-link" href="${esc(p.link_url)}" target="_blank" rel="noopener"><strong>Open shared link ↗</strong><br>${esc(p.link_url)}</a>`:''}
      ${p.media_url?(p.media_type==='video'
        ?`<video class="public-post-media" controls playsinline preload="metadata" src="${esc(p.media_url)}"></video>`
        :`<img class="public-post-media" loading="lazy" src="${esc(p.media_url)}" alt="Creator content">`):''}
      <div class="public-engagement">
        <span>♡ ${likeCount}</span>
        <span>↩ ${commentCount}</span>
        <span>⟳ ${repostCount}</span>
      </div>
    </article>`
  }).join('')
}



function focusHomeComposer(mode='text'){
  setPage('feed');
  setTimeout(()=>{
    const text=$('#postText');
    const input=$('#postMediaInput');
    if(mode==='text'){
      text?.focus();
      text?.scrollIntoView({behavior:'smooth',block:'center'});
      return
    }
    if(input){
      if(mode==='camera')input.setAttribute('capture','environment');
      else input.removeAttribute('capture');
      input.click()
    }
  },150)
}
function openCreateMenu(){
  modal('Create',`<div class="create-choice-grid">
    <button class="create-choice" data-create-mode="text"><span class="create-choice-icon">✎</span><span><strong>Write a post</strong><br><span class="muted">Share a thought, update, link, or opportunity.</span></span></button>
    <button class="create-choice" data-create-mode="camera"><span class="create-choice-icon">◉</span><span><strong>Take a photo</strong><br><span class="muted">Open your phone or device camera.</span></span></button>
    <button class="create-choice" data-create-mode="upload"><span class="create-choice-icon">▧</span><span><strong>Upload photo or video</strong><br><span class="muted">Choose existing media from your device.</span></span></button>
  </div>`);
  setTimeout(()=>$$('[data-create-mode]').forEach(button=>button.onclick=()=>{const mode=button.dataset.createMode;closeModal();focusHomeComposer(mode)}),0)
}
function toggleSideMoreMenu(force){
  const menu=$('#sideMoreMenu'),button=$('#sideMoreBtn');
  if(!menu||!button)return;
  const open=typeof force==='boolean'?force:menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!open);
  button.setAttribute('aria-expanded',String(open))
}
async function refreshSideInboxCount(){
  if(!user)return;
  const {count,error}=await sb.from('messages').select('*',{count:'exact',head:true}).neq('sender_id',user.id).is('read_at',null);
  const badge=$('#sideInboxCount');
  if(!badge||error)return;
  badge.textContent=count>99?'99+':String(count||0);
  badge.classList.toggle('hidden',!(count||0))
}

function installLaunchControls(){
  $('#sideCreateBtn')?.addEventListener('click',openCreateMenu);
  $('#sideCreatePostBtn')?.addEventListener('click',openCreateMenu);
  $('#sideMoreBtn')?.addEventListener('click',event=>{event.stopPropagation();toggleSideMoreMenu()});
  $('#sideSettingsBtn')?.addEventListener('click',()=>{toggleSideMoreMenu(false);openSettings()});
  $('#sideNotificationsBtn')?.addEventListener('click',()=>{toggleSideMoreMenu(false);openNotificationCenter()});
  $('#sideLogoutBtn')?.addEventListener('click',async()=>{await sb.auth.signOut();location.assign('/')});
  document.addEventListener('click',event=>{if(!event.target.closest('#sideMoreMenu')&&!event.target.closest('#sideMoreBtn'))toggleSideMoreMenu(false)});
  document.addEventListener('click',event=>{
    const pageButton=event.target.closest('[data-page]');
    if(pageButton){
      event.preventDefault();
      setPage(pageButton.dataset.page);
      return
    }

    const profileButton=event.target.closest('[data-profile-id]');
    if(profileButton){
      event.preventDefault();
      openMemberProfile(profileButton.dataset.profileId);
      return
    }

    const authButton=event.target.closest('[data-auth]');
    if(authButton){
      event.preventDefault();
      setAuthMode(authButton.dataset.auth);
      return
    }
  });

  $('#settingsBtn')?.addEventListener('click',openSettings);

  $('#notificationsBtn')?.addEventListener('click',openNotificationCenter);
$('#closeNotificationCenter')?.addEventListener('click',closeNotificationCenter);
$('#notificationCenterWrap')?.addEventListener('click',event=>{if(event.target.id==='notificationCenterWrap')closeNotificationCenter()});

  document.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button||button.disabled)return;
    if(
      button.id||
      button.dataset.page||
      button.dataset.profileId||
      button.dataset.auth||
      [...button.attributes].some(a=>a.name.startsWith('data-'))
    )return;

    const form=button.closest('form');
    if(form)return;

    // No silent controls at launch.
    if(!button.onclick){
      showToast('This action is not available yet.');
    }
  });
}


function showStartupError(error){
  gate.classList.add('hidden');
  document.querySelector('header')?.classList.remove('hidden');
  document.querySelector('.layout')?.classList.remove('hidden');

  main.innerHTML=`<section class="card empty" style="max-width:760px;margin:30px auto">
    <h1>We could not finish loading your account</h1>
    <p class="muted">${esc(error?.message||'An unexpected startup error occurred.')}</p>
    <div style="display:flex;gap:9px;justify-content:center;flex-wrap:wrap;margin-top:16px">
      <button class="primary" id="retryStartupBtn">Try again</button>
      <button class="secondary" id="startupLogoutBtn">Log out</button>
    </div>
  </section>`;

  $('#retryStartupBtn').onclick=()=>location.reload();
  $('#startupLogoutBtn').onclick=async()=>{
    await sb.auth.signOut();
    location.assign('/')
  };
}

async function runLaunchPreflight(){
  const requiredTables=[
    'profiles','posts','post_likes','post_comments','post_reposts',
    'follows','opportunities','applications','conversations',
    'conversation_members','messages','creator_services',
    'profile_portfolio_entries','profile_pinned_posts'
  ];

  const missing=[];

  for(const table of requiredTables){
    const {error}=await sb.from(table).select('*',{head:true,count:'exact'}).limit(1);
    if(error && /does not exist|schema cache|relation/i.test(error.message||'')){
      missing.push(table)
    }
  }

  if(missing.length){
    console.error('CreatorsIn missing tables:',missing);
    showToast(`Setup incomplete: ${missing.length} database table${missing.length===1?' is':'s are'} missing.`);
  }

  return missing;
}

async function init(){
  if(!window.__creatorsInLaunchControls){window.__creatorsInLaunchControls=true;installLaunchControls()}
  const {data}=await sb.auth.getSession();
  if(!data.session){
    user=null;
    await renderPublicHome();
    return
  }
  user=data.session.user;
  gate.classList.add('hidden');
  document.querySelector('header')?.classList.remove('hidden');
  document.querySelector('.layout')?.classList.remove('hidden');

  try{
    await ensureProfile();
    syncIdentity();
    await runLaunchPreflight();
    await loadSocial();
    initializeSettings();
    await refreshNotificationWidget();
    await refreshSideInboxCount();

    if(needsOnboarding(profile))launchOnboarding();
    else if(!(await routeFromLocation()))setPage('feed');
  }catch(error){
    console.error(error);
    showStartupError(error);
    return
  }
  sb.channel('messages-live').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>{
    if(activeConversation&&payload.new.conversation_id===activeConversation)openConversation(activeConversation);refreshNotificationWidget();refreshSideInboxCount()
  }).subscribe()
}
sb.auth.onAuthStateChange((_e,s)=>{if(s?.user&&!user){user=s.user;init()}else if(!s?.user&&user)location.reload()});
init();
})()
function formatRelativeTime(value){
  if(!value)return '';
  const date=new Date(value);
  const seconds=Math.max(0,Math.floor((Date.now()-date.getTime())/1000));
  if(seconds<60)return 'now';
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return `${minutes}m`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `${hours}h`;
  const days=Math.floor(hours/24);
  if(days<7)return `${days}d`;
  const sameYear=date.getFullYear()===new Date().getFullYear();
  return date.toLocaleDateString(undefined,sameYear?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'});
}

;