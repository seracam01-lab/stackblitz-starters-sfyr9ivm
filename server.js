const fs=require('fs'), path=require('path'), http=require('http');
const PORT=parseInt(process.env.PHOTO_FINISH_PORT||process.env.PORT||'8000',10), ROOT=__dirname;
const rooms=new Map();
const statusFile=path.join(ROOT,'tunnel-status.json');
const tunnelFile=path.join(ROOT,'tunnel-url.txt');
function room(id){ if(!rooms.has(id)) rooms.set(id,{signals:[],seq:0,timer:{running:false,startAt:0,elapsed:0},clients:{}}); return rooms.get(id); }
function readBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>2e6)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function sendJson(res,obj,code=200){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
function serveFile(req,res,u){let p=u.pathname==='/'?'/index.html':u.pathname;const f=path.normalize(path.join(ROOT,p));if(!f.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden')}fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}const ext=path.extname(f),types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(d)})}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
 try{
  if(u.pathname==='/api/info'){
   // StackBlitz/WebContainer: use the public preview host automatically.
   // Windows launcher version can still override this with tunnel-url.txt.
   let publicUrl='';
   try{publicUrl=fs.readFileSync(tunnelFile,'utf8').trim()}catch(e){}
   if(!publicUrl){
     const host=(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
     let proto=(req.headers['x-forwarded-proto']||'').split(',')[0].trim();
     if(!proto) proto=(host.includes('localhost')||host.startsWith('127.0.0.1'))?'http':'https';
     if(host) publicUrl=proto+'://'+host;
   }
   return sendJson(res,{
     publicUrl,
     state: publicUrl ? 'ready' : 'connecting',
     message: publicUrl ? 'HTTPS พร้อม - สแกน QR ได้' : 'กำลังตรวจ URL ของเว็บ...',
     lastError:'',
     server:true
   });
  }
  if(u.pathname==='/api/heartbeat'&&req.method==='POST'){
   const b=await readBody(req), r=room(b.sid); r.clients[b.role]={lastSeen:Date.now(),clientId:b.clientId}; return sendJson(res,{ok:true});
  }
  if(u.pathname==='/api/room'){
   const sid=u.searchParams.get('sid')||'',r=room(sid),now=Date.now();
   const mainOnline=!!(r.clients.main&&now-r.clients.main.lastSeen<5000), cam2Online=!!(r.clients.cam2&&now-r.clients.cam2.lastSeen<5000);
   return sendJson(res,{timer:r.timer,mainOnline,cam2Online});
  }
  if(u.pathname==='/api/signal'&&req.method==='POST'){
   const b=await readBody(req),r=room(b.sid); r.seq++; r.signals.push({seq:r.seq,from:b.from,to:b.to,type:b.type,data:b.data,ts:Date.now()}); if(r.signals.length>300)r.signals.splice(0,r.signals.length-300); return sendJson(res,{ok:true,seq:r.seq});
  }
  if(u.pathname==='/api/signals'){
   const sid=u.searchParams.get('sid')||'',to=u.searchParams.get('to')||'',after=Number(u.searchParams.get('after')||0),r=room(sid); return sendJson(res,{signals:r.signals.filter(x=>x.seq>after&&x.to===to),lastSeq:r.seq});
  }
  if(u.pathname==='/api/timer'&&req.method==='POST'){
   const b=await readBody(req),r=room(b.sid); if(b.action==='start'){r.timer={running:true,startAt:Date.now()+250,elapsed:0}} else if(b.action==='stop'){if(r.timer.running)r.timer.elapsed=Math.max(0,Date.now()-r.timer.startAt);r.timer.running=false} return sendJson(res,{ok:true,timer:r.timer});
  }
  return serveFile(req,res,u);
 }catch(e){console.error(e);return sendJson(res,{ok:false,error:e.message},500)}
});
server.listen(PORT,'0.0.0.0',()=>console.log('SERVER_READY http://localhost:'+PORT));
