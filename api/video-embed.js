const ALLOWED_HOSTS=new Set([
  'tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'
]);

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control',status===200
    ?'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
    :'no-store');
  res.end(JSON.stringify(body));
}

function safeTikTokUrl(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!ALLOWED_HOSTS.has(url.hostname.toLowerCase()))return null;
    return url
  }catch{return null}
}

function videoIdFromUrl(value){
  try{return new URL(value).pathname.match(/\/video\/(\d+)/)?.[1]||null}
  catch{return null}
}

module.exports=async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return send(res,405,{error:'Method not allowed'})
  }

  const input=Array.isArray(req.query?.url)?req.query.url[0]:req.query?.url;
  const initial=safeTikTokUrl(input);
  if(!initial)return send(res,400,{error:'A valid TikTok URL is required'});

  try{
    const resolvedResponse=await fetch(initial.toString(),{
      redirect:'follow',
      headers:{
        'User-Agent':'Mozilla/5.0 (compatible; CreatorsInEmbed/1.0)',
        'Accept':'text/html,application/xhtml+xml'
      }
    });

    const canonical=safeTikTokUrl(resolvedResponse.url)||initial;
    let videoId=videoIdFromUrl(canonical.toString());
    let metadata=null;

    const oembedResponse=await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonical.toString())}`,
      {headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0 (compatible; CreatorsInEmbed/1.0)'}}
    );

    if(oembedResponse.ok){
      metadata=await oembedResponse.json();
      if(!videoId&&typeof metadata.html==='string'){
        videoId=metadata.html.match(/data-video-id=["'](\d+)["']/)?.[1]||null
      }
    }

    if(!videoId){
      const page=await resolvedResponse.text();
      videoId=page.match(/\/video\/(\d{10,})/)?.[1]||
        page.match(/"itemId":"(\d{10,})"/)?.[1]||null
    }

    if(!videoId)return send(res,422,{
      error:'TikTok did not expose a playable video ID',
      canonicalUrl:canonical.toString()
    });

    return send(res,200,{
      provider:'tiktok',
      videoId,
      canonicalUrl:canonical.toString(),
      title:metadata?.title||'TikTok video',
      embedUrl:`https://www.tiktok.com/player/v1/${videoId}?autoplay=0&loop=0&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=1&music_info=1&description=1&rel=0&native_context_menu=1&closed_caption=1`
    })
  }catch(error){
    console.error('TikTok embed resolution failed:',error);
    return send(res,502,{error:'Could not load this TikTok video'})
  }
};
