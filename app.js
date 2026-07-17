(() => {
'use strict';
const cfg=window.CREATORSIN_CONFIG||{};
const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const main=$('#main'), gate=$('#authGate'), toast=$('#toast');
let authMode='signup', user=null, profile=null, members=[], connections=[], requests=[], follows=[], conversations=[], activeConversation=null, messageChannel=null, typingChannel=null, inboxChannel=null, typingTimer=null, currentChatOther=null;
const EMPTY='data:image/svg+xml;charset=utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="60" fill="#dceeff"/><circle cx="60" cy="45" r="22" fill="#58aaff"/><path d="M22 110c8-29 23-42 38-42s30 13 38 42" fill="#58aaff"/></svg>');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showToast(t){toast.textContent=t;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200)}
function modal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modalWrap').classList.remove('hidden')}
function closeModal(){$('#modalWrap').classList.add('hidden')}
$('#modalClose').onclick=closeModal;$('#modalWrap').onclick=e=>{if(e.target.id==='modalWrap')closeModal()};
function setTheme(next){document.documentElement.dataset.theme=next;localStorage.setItem('cin_theme',next);$('#themeBtn').textContent=next==='dark'?'☀':'☾'}
setTheme(localStorage.getItem('cin_theme')||'light');$('#themeBtn').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');

function setAuthMode(mode){authMode=mode;$$('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===mode));$('#authTitle').textContent=mode==='signup'?'Create your account':'Welcome back';$('#emailBtn').textContent=mode==='signup'?'Create account':'Log in';$('#nameInput').classList.toggle('hidden',mode==='login');$('#typeInput').classList.toggle('hidden',mode==='login');$('#authMsg').textContent=''}
$$('[data-auth]').forEach(b=>b.onclick=()=>setAuthMode(b.dataset.auth));
async function oauth(provider){const {error}=await sb.auth.signInWithOAuth({provider,options:{redirectTo:cfg.SITE_URL||location.origin}});if(error)$('#authMsg').textContent=error.message}
$('#googleBtn').onclick=()=>oauth('google');$('#appleBtn').onclick=()=>oauth('apple');
$('#emailBtn').onclick=async()=>{const email=$('#emailInput').value.trim(),password=$('#passwordInput').value,name=$('#nameInput').value.trim(),account_type=$('#typeInput').value;$('#authMsg').textContent='';if(password.length<8)return $('#authMsg').textContent='Password must be at least 8 characters.';let result;if(authMode==='signup'){if(!name)return $('#authMsg').textContent='Enter your full name.';result=await sb.auth.signUp({email,password,options:{data:{full_name:name,account_type},emailRedirectTo:cfg.SITE_URL||location.origin}})}else result=await sb.auth.signInWithPassword({email,password});if(result.error)return $('#authMsg').textContent=result.error.message;if(!result.data.session)$('#authMsg').textContent='Check your email to confirm your account.'};
$('#logoutBtn').onclick=async()=>{await sb.auth.signOut();location.reload()};

async function ensureProfile(){const md=user.user_metadata||{};await sb.from('profiles').upsert({id:user.id,email:user.email,full_name:md.full_name||md.name||user.email.split('@')[0],account_type:md.account_type||'creator',avatar_url:md.avatar_url||md.picture||null},{onConflict:'id'});const {data}=await sb.from('profiles').select('*').eq('id',user.id).single();profile=data}
function syncIdentity(){if(!profile)return;$('#sideName').textContent=profile.full_name;$('#sideType').textContent=(profile.is_founder?'Founder · ':'')+(profile.account_type||'creator');$('#sideAvatar').src=profile.avatar_url||EMPTY}
function setPage(page){
  $$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  const pages={feed,discover,connections:connectionsPage,opportunities:opportunitiesPage,messages:messagesPage,profile:profilePage};
  (pages[page]||feed)();
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
}
async function renderTimeline(filter){
  const list=$('#feedList');list.innerHTML='<section class="card empty"><p class="muted">Loading feed…</p></section>';
  try{
    const items=await loadTimeline(filter);
    if(!items.length){list.innerHTML=`<section class="card empty"><h2>No posts yet</h2><p class="muted">Follow real members or publish the first post.</p></section>`;return}
    const postIds=items.filter(x=>x.kind==='post').map(x=>x.id);
    let likes=[],comments=[];
    if(postIds.length){
      const [{data:l},{data:c}]=await Promise.all([
        sb.from('post_likes').select('post_id,user_id').in('post_id',postIds),
        sb.from('post_comments').select('id,post_id,user_id,content,created_at,profiles:post_comments_user_id_fkey(full_name,avatar_url,username)').in('post_id',postIds).order('created_at')
      ]);likes=l||[];comments=c||[];
    }
    list.innerHTML=items.map(item=>item.kind==='job'?renderJobFeedItem(item):renderSocialPost(item,likes,comments)).join('');
    bindFeedActions();
  }catch(e){list.innerHTML=`<section class="card empty"><h2>Could not load the feed</h2><p class="muted">${esc(e.message)}</p></section>`}
}
function renderSocialPost(p,likes,comments){
  const postLikes=likes.filter(x=>x.post_id===p.id),postComments=comments.filter(x=>x.post_id===p.id),liked=postLikes.some(x=>x.user_id===user.id);
  return `<article class="card social-post">
    <div class="social-post-header"><img class="avatar" src="${esc(p.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><strong>${esc(p.profiles?.full_name||'Member')} ${p.profiles?.is_verified?'<span class="verified">✓</span>':''}${p.profiles?.is_founder?'<span class="badge">Founder</span>':''}</strong><div class="muted">@${esc(p.profiles?.username||'member')} · ${new Date(p.created_at).toLocaleString()}</div></div>${p.user_id===user.id?`<button class="secondary danger" data-delete-post="${p.id}">Delete</button>`:''}</div>
    <div class="social-post-body">${p.content?`<p>${renderPostText(p.content)}</p>`:''}${p.link_url?`<a class="post-link" href="${esc(p.link_url)}" target="_blank" rel="noopener"><strong>Open link ↗</strong><br>${esc(p.link_url)}</a>`:''}</div>
    ${p.media_url?(p.media_type==='video'?`<video class="post-media" controls preload="metadata" src="${esc(p.media_url)}"></video>`:`<img class="post-media" loading="lazy" src="${esc(p.media_url)}" alt="Post media">`):''}
    <div class="post-actions"><button class="post-action ${liked?'active':''}" data-like="${p.id}">♡ ${postLikes.length}</button><button class="post-action" data-toggle-comments="${p.id}">↩ ${postComments.length}</button><button class="post-action" data-copy-post="${p.id}">↗ Share</button><button class="post-action" data-message-author="${p.user_id}">✉ Message</button></div>
    <div class="comments hidden" id="comments-${p.id}"><div>${postComments.map(c=>`<div class="comment-row"><img class="avatar" src="${esc(c.profiles?.avatar_url||EMPTY)}"><div class="comment-body"><strong>${esc(c.profiles?.full_name||'Member')}</strong><div>${renderPostText(c.content)}</div></div></div>`).join('')}</div><div class="comment-form"><input class="field" id="comment-input-${p.id}" placeholder="Write a reply"><button class="primary" data-comment="${p.id}">Reply</button></div></div>
  </article>`
}
function renderJobFeedItem(o){
  return `<article class="card social-post"><div class="social-post-header"><img class="avatar" src="${esc(o.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><strong>${esc(o.profiles?.full_name||'Business')} ${o.profiles?.is_verified?'<span class="verified">✓</span>':''}</strong><div class="muted">posted an opportunity · ${new Date(o.created_at).toLocaleString()}</div></div><span class="post-type">Opportunity</span></div><div class="social-post-body"><div class="job-card"><h3>${esc(o.title)}</h3><p>${esc(o.description)}</p><div class="job-meta">${o.compensation?`<span class="chip">${esc(o.compensation)}</span>`:''}${o.opportunity_type?`<span class="chip">${esc(o.opportunity_type)}</span>`:''}${o.platforms?`<span class="chip">${esc(o.platforms)}</span>`:''}${o.location?`<span class="chip">${esc(o.location)}</span>`:''}</div>${o.deadline?`<div class="muted">Apply by ${new Date(o.deadline).toLocaleDateString()}</div>`:''}<button class="primary" data-open-opportunity="${o.id}" style="margin-top:12px">View opportunity</button></div></div></article>`
}
function bindFeedActions(){
  $$('[data-like]').forEach(b=>b.onclick=async()=>{const post_id=b.dataset.like;const {data}=await sb.from('post_likes').select('post_id').eq('post_id',post_id).eq('user_id',user.id).maybeSingle();if(data)await sb.from('post_likes').delete().eq('post_id',post_id).eq('user_id',user.id);else await sb.from('post_likes').insert({post_id,user_id:user.id});renderTimeline(document.querySelector('[data-feed-filter].active')?.dataset.feedFilter||'for-you')});
  $$('[data-toggle-comments]').forEach(b=>b.onclick=()=>$('#comments-'+b.dataset.toggleComments).classList.toggle('hidden'));
  $$('[data-comment]').forEach(b=>b.onclick=async()=>{const post_id=b.dataset.comment,input=$('#comment-input-'+post_id),content=input.value.trim();if(!content)return;const {error}=await sb.from('post_comments').insert({post_id,user_id:user.id,content});if(error)return showToast(error.message);renderTimeline(document.querySelector('[data-feed-filter].active')?.dataset.feedFilter||'for-you')});
  $$('[data-copy-post]').forEach(b=>b.onclick=async()=>{await navigator.clipboard.writeText(`${location.origin}/?post=${b.dataset.copyPost}`);showToast('Post link copied')});
  $$('[data-message-author]').forEach(b=>b.onclick=()=>startConversation(b.dataset.messageAuthor));
  $$('[data-delete-post]').forEach(b=>b.onclick=async()=>{await sb.from('posts').delete().eq('id',b.dataset.deletePost).eq('user_id',user.id);showToast('Post deleted');renderTimeline(document.querySelector('[data-feed-filter].active')?.dataset.feedFilter||'for-you')});
  $$('[data-open-opportunity]').forEach(b=>b.onclick=()=>setPage('opportunities'));
}

async function loadSocial(){const [{data:m},{data:c},{data:r},{data:f}]=await Promise.all([sb.from('profiles').select('*').neq('id',user.id).order('created_at',{ascending:false}),sb.from('connections').select('*').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),sb.from('connections').select('*,profiles!connections_requester_id_fkey(*)').eq('addressee_id',user.id).eq('status','pending'),sb.from('follows').select('*').eq('follower_id',user.id)]);members=m||[];connections=c||[];requests=r||[];follows=f||[];renderRequestPreview()}
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
async function discover(){
  await loadSocial();
  main.innerHTML=`<div class="page-title"><div><h1>Discover</h1><p class="muted">Personalized recommendations based on your profile, niche, location, and account type.</p></div><input class="field" id="memberSearch" placeholder="Search all members" style="max-width:300px"></div>
    <section id="recommendedSection">
      <div class="page-title" style="margin-top:0"><div><h2>Recommended for you</h2><p class="muted">A smaller, more relevant group of members to explore.</p></div></div>
      <div class="grid" id="recommendedGrid"></div>
    </section>
    <section class="hidden" id="searchResultsSection">
      <div class="page-title"><div><h2>Search results</h2><p class="muted">Members matching your search.</p></div><button class="secondary" id="clearMemberSearch">Clear search</button></div>
      <div class="grid" id="memberGrid"></div>
    </section>`;

  const renderCards=(list,target)=>{
    $(target).innerHTML=list.length?list.map(m=>{
      const rel=relationship(m.id);
      const isFollowing=follows.some(f=>f.following_id===m.id);
      const connectionAction=rel?.status==='accepted'
        ?`<button class="primary" data-message-user="${m.id}">Message</button>`
        :rel?.status==='pending'
          ?`<button class="secondary" disabled>${rel.requester_id===user.id?'Request sent':'Respond in Network'}</button>`
          :`<button class="secondary" data-connect="${m.id}">Connect</button>`;
      const followAction=isFollowing
        ?`<button class="secondary" data-unfollow="${m.id}">Following</button>`
        :`<button class="primary" data-follow="${m.id}">Follow</button>`;
      return `<article class="card member">
        <div class="member-top">
          <img class="avatar" src="${esc(m.avatar_url||EMPTY)}">
          <div>
            <h3 style="margin:0">${esc(m.full_name)} ${m.is_verified?'<span class="verified">✓</span>':''}${m.is_founder?'<span class="badge">Founder</span>':''}</h3>
            <div class="muted">@${esc(m.username||'member')} · ${esc(m.headline||m.account_type||'member')}</div>
          </div>
        </div>
        <p class="muted">${esc(m.bio||'New member')}</p>
        <div class="chip" style="margin-bottom:12px">${esc(memberRecommendationReason(m))}</div>
        <div class="member-actions">${followAction}${connectionAction}<button class="secondary" data-view="${m.id}">View profile</button></div>
      </article>`
    }).join(''):`<section class="card empty"><h2>No recommendations yet</h2><p class="muted">Complete your niche, location, and headline so CreatorsIn can recommend relevant members.</p></section>`;
    bindDiscover()
  };

  renderCards(recommendedMembers(),'#recommendedGrid');

  const search=$('#memberSearch');
  const runSearch=()=>{
    const q=search.value.trim().toLowerCase();
    if(!q){
      $('#recommendedSection').classList.remove('hidden');
      $('#searchResultsSection').classList.add('hidden');
      return;
    }
    const filtered=members.filter(m=>
      (m.full_name+' '+(m.username||'')+' '+(m.headline||'')+' '+(m.niche||'')+' '+(m.location||'')+' '+(m.account_type||''))
      .toLowerCase().includes(q)
    );
    $('#recommendedSection').classList.add('hidden');
    $('#searchResultsSection').classList.remove('hidden');
    renderCards(filtered,'#memberGrid')
  };
  search.oninput=runSearch;
  $('#clearMemberSearch').onclick=()=>{search.value='';runSearch();search.focus()}
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
function showMember(id){const m=members.find(x=>x.id===id);if(!m)return;modal(m.full_name,`<div class="row"><img class="avatar" style="width:82px;height:82px" src="${esc(m.avatar_url||EMPTY)}"><div><strong>${esc(m.headline||m.account_type)}</strong><p class="muted">${esc(m.bio||'No bio yet.')}</p></div></div>`)}

async function connectionsPage(){
  await loadSocial();
  const accepted=connections.filter(c=>c.status==='accepted').map(c=>members.find(m=>m.id===(c.requester_id===user.id?c.addressee_id:c.requester_id))).filter(Boolean);
  const followed=follows.map(f=>members.find(m=>m.id===f.following_id)).filter(Boolean);
  main.innerHTML=`<div class="page-title"><div><h1>My network</h1><p class="muted">People you follow, your connections, and pending requests.</p></div></div>
    <section class="card" style="padding:18px"><h2>Pending requests</h2><div id="requestsList"></div></section>
    <h2>Following</h2>
    <div class="grid">${followed.length?followed.map(m=>`<article class="card member"><div class="member-top"><img class="avatar" src="${esc(m.avatar_url||EMPTY)}"><div><strong>${esc(m.full_name)}</strong><div class="muted">@${esc(m.username||'member')} · ${esc(m.headline||m.account_type)}</div></div></div><div class="member-actions"><button class="primary" data-message-user="${m.id}">Message</button><button class="secondary" data-unfollow-network="${m.id}">Following</button></div></article>`).join(''):`<section class="card empty"><h2>You are not following anyone yet</h2><button class="primary" data-page="discover">Discover members</button></section>`}</div>
    <h2>Connections</h2>
    <div class="grid">${accepted.length?accepted.map(m=>`<article class="card member"><div class="member-top"><img class="avatar" src="${esc(m.avatar_url||EMPTY)}"><div><strong>${esc(m.full_name)}</strong><div class="muted">${esc(m.headline||m.account_type)}</div></div></div><div class="member-actions"><button class="primary" data-message-user="${m.id}">Message</button></div></article>`).join(''):`<section class="card empty"><h2>No connections yet</h2><button class="primary" data-page="discover">Discover members</button></section>`}</div>`;
  renderRequests();
  $$('[data-message-user]').forEach(b=>b.onclick=()=>startConversation(b.dataset.messageUser));
  $$('[data-unfollow-network]').forEach(b=>b.onclick=async()=>{
    const {error}=await sb.from('follows').delete().eq('follower_id',user.id).eq('following_id',b.dataset.unfollowNetwork);
    if(error)showToast(error.message);else{showToast('Unfollowed');connectionsPage()}
  });
  $$('[data-page]').forEach(b=>b.onclick=()=>setPage(b.dataset.page))
}
function renderRequests(){const el=$('#requestsList');if(!el)return;el.innerHTML=requests.length?requests.map(r=>`<div class="request row"><img class="avatar" src="${esc(r.profiles?.avatar_url||EMPTY)}"><div style="flex:1"><strong>${esc(r.profiles?.full_name||'Member')}</strong><div class="muted">${esc(r.profiles?.headline||r.profiles?.account_type||'member')}</div></div><button class="primary" data-accept="${r.id}">Accept</button><button class="secondary" data-decline="${r.id}">Decline</button></div>`).join(''):'<p class="muted">No pending requests.</p>';$$('[data-accept]').forEach(b=>b.onclick=async()=>{await sb.from('connections').update({status:'accepted',responded_at:new Date().toISOString()}).eq('id',b.dataset.accept);showToast('Connection accepted');connectionsPage()});$$('[data-decline]').forEach(b=>b.onclick=async()=>{await sb.from('connections').delete().eq('id',b.dataset.decline);connectionsPage()})}
function renderRequestPreview(){const el=$('#requestPreview');if(!el)return;el.innerHTML=requests.length?requests.slice(0,3).map(r=>`<div class="request"><strong>${esc(r.profiles?.full_name||'Member')}</strong><div class="muted">Wants to connect</div></div>`).join(''):'No pending requests.'}
$('#notificationsBtn').onclick=()=>setPage('connections');

async function startConversation(otherId){
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
      $('#messageMemberList').innerHTML=found.length?found.map(m=>`<button class="secondary" data-start="${m.id}" style="width:100%;margin:5px 0;text-align:left;display:flex;align-items:center;gap:10px"><img class="avatar" src="${esc(m.avatar_url||EMPTY)}"><span><strong>${esc(m.full_name)}</strong><br><small class="muted">@${esc(m.username||'member')} · ${esc(m.headline||m.account_type||'member')}</small></span></button>`).join(''):'<p class="muted">No members found.</p>';
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
      <div class="thread-name">${esc(i.other?.full_name||'Conversation')} ${i.other?.is_verified?'<span class="verified">✓</span>':''} ${i.pref?.is_pinned?'<span class="pinned-mark">📌</span>':''}</div>
      <div class="thread-preview">${i.last?.sender_id===user.id?'You: ':''}${esc(i.last?.body||i.other?.headline||'Start the conversation')}</div>
    </div>
    <div style="text-align:right"><div class="thread-time">${formatThreadTime(i.updated_at)}</div><div class="thread-icons">${i.pref?.is_muted?'🔕':''}${i.unread?'<span class="unread-dot"></span>':''}</div></div>
  </div>`).join(''):'<p class="muted" style="padding:18px">No conversations yet.</p>';
  $$('[data-conversation]').forEach(b=>b.onclick=()=>openConversation(b.dataset.conversation))
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
  renderThreads()
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
    <div class="chat-head-copy"><strong>${esc(other?.full_name||'Conversation')} ${other?.is_verified?'<span class="verified">✓</span>':''}</strong><span id="chatPresence">@${esc(other?.username||'member')} · ${esc(other?.headline||other?.account_type||'member')}</span></div>
    <div class="chat-menu-wrap"><button class="icon-btn" id="chatMenuBtn" aria-label="Chat options">•••</button>
      <div class="chat-menu hidden" id="chatMenu">
        <button id="pinChatBtn">${pref?.is_pinned?'Unpin chat':'Pin chat'}</button>
        <button id="muteChatBtn">${pref?.is_muted?'Unmute chat':'Mute chat'}</button>
        <button class="danger" id="deleteChatBtn">Delete chat</button>
      </div>
    </div>
  </div>
  <div class="chat-body" id="chatBody">${renderMessageRows(msgs,other)}</div>
  <div class="typing-line" id="typingLine"></div>
  <div class="chat-compose"><textarea class="field" id="messageInput" rows="1" placeholder="Message ${esc(other?.full_name||'member')}"></textarea><button class="primary" id="sendMessageBtn">Send</button></div>`;
  $('#chatMenuBtn').onclick=()=>$('#chatMenu').classList.toggle('hidden');
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
  const isBusiness=['brand','agency'].includes(profile.account_type);
  const {data:opps,error}=await sb.from('opportunities')
    .select('*,profiles!opportunities_business_id_fkey(full_name,avatar_url,is_verified,account_type)')
    .eq('status','open').order('created_at',{ascending:false});
  if(error){main.innerHTML=`<section class="card empty"><h2>Could not load opportunities</h2><p class="muted">${esc(error.message)}</p></section>`;return}
  let myApplications=[];
  if(!isBusiness){
    const {data}=await sb.from('applications').select('opportunity_id,status').eq('applicant_id',user.id);
    myApplications=data||[];
  }
  let businessStats='';
  if(isBusiness){
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
  main.innerHTML=`<div class="page-title"><div><h1>Opportunities</h1><p class="muted">Real partnerships posted by registered businesses and agencies.</p></div>${isBusiness?'<button class="primary" id="createOpportunityBtn">Post opportunity</button>':''}</div>
    ${businessStats}<div class="feed" id="opportunityList"></div>`;
  const list=$('#opportunityList');
  list.innerHTML=(opps||[]).length?(opps||[]).map(o=>{
    const existing=myApplications.find(a=>a.opportunity_id===o.id);
    return `<article class="card opportunity">
      <div class="post-head"><img class="avatar" src="${esc(o.profiles?.avatar_url||EMPTY)}"><div><h3>${esc(o.title)}</h3><div class="muted">${esc(o.profiles?.full_name||'Business')} ${o.profiles?.is_verified?'<span class="verified">✓</span>':''}</div></div></div>
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
        isBusiness?'<span class="muted">Business accounts cannot apply.</span>':
        existing?`<button class="secondary" disabled>Application: ${esc(existing.status)}</button>`:`<button class="primary" data-apply="${o.id}">Apply</button>`}
      </div>
    </article>`
  }).join(''):`<section class="card empty"><h2>No opportunities yet</h2><p class="muted">${isBusiness?'Post the first real opportunity for the community.':'Businesses have not posted any opportunities yet.'}</p></section>`;
  if(isBusiness)$('#createOpportunityBtn').onclick=openOpportunityForm;
  $$('[data-apply]').forEach(b=>b.onclick=()=>openApplicationForm(b.dataset.apply));
  $$('[data-view-applicants]').forEach(b=>b.onclick=()=>viewApplicants(b.dataset.viewApplicants));
  $$('[data-close-opportunity]').forEach(b=>b.onclick=async()=>{const {error}=await sb.from('opportunities').update({status:'closed'}).eq('id',b.dataset.closeOpportunity).eq('business_id',user.id);if(error)showToast(error.message);else{showToast('Opportunity closed');opportunitiesPage()}})
}
function openOpportunityForm(){
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
  const {data}=await sb.from('profiles').select('*').eq('id',user.id).single();
  profile=data;syncIdentity();
  main.innerHTML=strengthCard()+`<section class="card profile">
    <div class="profile-hero"></div>
    <div class="profile-row">
      <img class="avatar" src="${esc(profile.avatar_url||EMPTY)}">
      <div>
        <h1>${esc(profile.full_name)} ${profile.is_verified?'<span class="verified">✓</span>':''}${profile.is_founder?'<span class="badge">Founder</span>':''}</h1>
        <div class="muted">${esc(profile.headline||profile.account_type)}</div>
        <div class="muted">${esc(profile.location||'')}</div>
      </div>
      <button class="primary" id="editProfileBtn">Edit profile</button>
    </div>
    <p>${esc(profile.bio||'Add a bio to tell the community about yourself.')}</p>
    <div class="opportunity-meta">
      ${profile.niche?`<span class="chip">${esc(profile.niche)}</span>`:''}
      ${profile.website_url?`<a class="chip" href="${esc(profile.website_url)}" target="_blank" rel="noopener">Website</a>`:''}
      ${profile.instagram_url?`<a class="chip" href="${esc(profile.instagram_url)}" target="_blank" rel="noopener">Instagram</a>`:''}
      ${profile.tiktok_url?`<a class="chip" href="${esc(profile.tiktok_url)}" target="_blank" rel="noopener">TikTok</a>`:''}
      ${profile.youtube_url?`<a class="chip" href="${esc(profile.youtube_url)}" target="_blank" rel="noopener">YouTube</a>`:''}
    </div>
  </section>`;
  $('#editProfileBtn').onclick=()=>modal('Edit profile',`
    <div class="form-grid">
      <div><label>Full name or business name</label><input class="field" id="editName" value="${esc(profile.full_name)}"></div>
      <div><label>Account type</label><select class="field" id="editType"><option value="creator">Creator</option><option value="brand">Business</option><option value="agency">Agency</option></select></div>
      <div class="wide"><label>Headline</label><input class="field" id="editHeadline" value="${esc(profile.headline||'')}"></div>
      <div><label>Niche or industry</label><input class="field" id="editNiche" value="${esc(profile.niche||'')}"></div>
      <div><label>Location</label><input class="field" id="editLocation" value="${esc(profile.location||'')}"></div>
      <div class="wide"><label>Bio</label><textarea class="field" id="editBio">${esc(profile.bio||'')}</textarea></div>
      <div class="wide"><label>Profile photo or logo</label><label class="upload-box" for="editAvatarFile"><strong>Upload image</strong><div class="file-note">JPG, PNG, or WebP · maximum 6 MB</div><input id="editAvatarFile" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="editAvatarStatus" class="file-note">${profile.avatar_url?'Current image saved':''}</div></div>
      <div><label>Website</label><input class="field" id="editWebsite" value="${esc(profile.website_url||'')}"></div>
      <div><label>Instagram</label><input class="field" id="editInstagram" value="${esc(profile.instagram_url||'')}"></div>
      <div><label>TikTok</label><input class="field" id="editTikTok" value="${esc(profile.tiktok_url||'')}"></div>
      <div><label>YouTube</label><input class="field" id="editYouTube" value="${esc(profile.youtube_url||'')}"></div>
    </div>
    <button class="primary" id="saveProfileBtn" style="margin-top:14px">Save changes</button>`);
  setTimeout(()=>{
    $('#editType').value=profile.account_type||'creator';
    $('#saveProfileBtn').onclick=async()=>{
      let uploadedAvatar=profile.avatar_url||null;
      const file=$('#editAvatarFile')?.files?.[0];
      if(file){try{$('#editAvatarStatus').textContent='Uploading…';uploadedAvatar=await uploadProfileAsset(file,'avatar')}catch(err){return showToast(err.message)}}
      const updates={
        full_name:$('#editName').value.trim(),
        account_type:$('#editType').value,
        headline:$('#editHeadline').value.trim()||null,
        niche:$('#editNiche').value.trim()||null,
        location:$('#editLocation').value.trim()||null,
        bio:$('#editBio').value.trim()||null,
        avatar_url:uploadedAvatar,
        website_url:$('#editWebsite').value.trim()||null,
        instagram_url:$('#editInstagram').value.trim()||null,
        tiktok_url:$('#editTikTok').value.trim()||null,
        youtube_url:$('#editYouTube').value.trim()||null
      };
      const {error}=await sb.from('profiles').update(updates).eq('id',user.id);
      if(error)return showToast(error.message);
      closeModal();showToast('Profile updated');profilePage()
    }
  },0)
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
async function uploadProfileAsset(file,kind='avatar'){
  if(!file)throw new Error('Choose an image.');
  if(!file.type.startsWith('image/'))throw new Error('Choose a JPG, PNG, or WebP image.');
  if(file.size>6*1024*1024)throw new Error('Choose an image under 6 MB.');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
  const path=`${user.id}/${kind}-${Date.now()}.${ext}`;
  const {error}=await sb.storage.from('profile-assets').upload(path,file,{upsert:true,contentType:file.type});
  if(error)throw error;
  const {data}=sb.storage.from('profile-assets').getPublicUrl(path);
  return data.publicUrl;
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
  $$('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===choice));
}
function openSettings(){
  $('#settingsWrap').classList.remove('hidden');
  $('#settingsEmail').textContent=user?.email||profile?.email||'';
  const discoverable=profile?.is_discoverable!==false;
  $('#discoverableSwitch').classList.toggle('on',discoverable);
  const choice=localStorage.getItem('creatorsin-theme-choice')||'system';
  applyThemeChoice(choice);
}
function closeSettings(){
  $('#settingsWrap').classList.add('hidden');
}
function toggleLocalSetting(button,key,defaultValue=false){
  const current=localStorage.getItem(key);
  const value=current===null?defaultValue:current==='true';
  const next=!value;
  localStorage.setItem(key,String(next));
  button.classList.toggle('on',next);
}
function initializeSettings(){
  const choice=localStorage.getItem('creatorsin-theme-choice')||'system';
  applyThemeChoice(choice);

  $('#settingsBtn')?.addEventListener('click',openSettings);
  $('#closeSettingsBtn')?.addEventListener('click',closeSettings);
  $('#settingsWrap')?.addEventListener('click',e=>{if(e.target.id==='settingsWrap')closeSettings()});
  $$('[data-theme-choice]').forEach(b=>b.onclick=()=>applyThemeChoice(b.dataset.themeChoice));

  $('#discoverableSwitch')?.addEventListener('click',async()=>{
    const next=!$('#discoverableSwitch').classList.contains('on');
    const {error}=await sb.from('profiles').update({is_discoverable:next}).eq('id',user.id);
    if(error)return showToast(error.message);
    profile.is_discoverable=next;
    $('#discoverableSwitch').classList.toggle('on',next);
    showToast(next?'Profile is visible in Discover':'Profile hidden from Discover');
  });

  const localSwitches=[
    ['dmSwitch','creatorsin-allow-dms',true],
    ['activitySwitch','creatorsin-show-activity',false],
    ['connectionNotifSwitch','creatorsin-connection-notifs',true],
    ['messageNotifSwitch','creatorsin-message-notifs',true]
  ];
  localSwitches.forEach(([id,key,def])=>{
    const btn=$('#'+id);
    if(!btn)return;
    const stored=localStorage.getItem(key);
    const value=stored===null?def:stored==='true';
    btn.classList.toggle('on',value);
    btn.onclick=()=>toggleLocalSetting(btn,key,def);
  });

  $('#openProfileSettingsBtn')?.addEventListener('click',()=>{closeSettings();setPage('profile')});
  $$('[data-settings-legal]').forEach(b=>b.onclick=()=>legalCopy(b.dataset.settingsLegal));
  $('#settingsSignOutBtn')?.addEventListener('click',async()=>{await sb.auth.signOut();location.reload()});

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
    if((localStorage.getItem('creatorsin-theme-choice')||'system')==='system')applyThemeChoice('system')
  });
}

async function init(){const {data}=await sb.auth.getSession();if(!data.session){gate.classList.remove('hidden');return}user=data.session.user;gate.classList.add('hidden');await ensureProfile();syncIdentity();await loadSocial();initializeSettings();if(needsOnboarding(profile))launchOnboarding();else setPage('feed');sb.channel('messages-live').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>{if(activeConversation&&payload.new.conversation_id===activeConversation)openConversation(activeConversation)}).subscribe()}
sb.auth.onAuthStateChange((_e,s)=>{if(s?.user&&!user){user=s.user;init()}else if(!s?.user&&user)location.reload()});
init();
})();