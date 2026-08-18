const fs=require('fs'),path=require('path'),cp=require('child_process'),net=require('net');
const ROOT=__dirname,exe=path.join(ROOT,'cloudflared.exe'),statusFile=path.join(ROOT,'tunnel-status.json'),urlFile=path.join(ROOT,'tunnel-url.txt');
let PORT=0,serverProc=null,tunnelProc=null,retry=null,opened=false;
function status(state,message,lastError='',publicUrl=''){try{fs.writeFileSync(statusFile,JSON.stringify({state,message,lastError,publicUrl,updatedAt:Date.now(),port:PORT}))}catch(e){}}
function findPort(start=8000,end=8099){return new Promise((resolve,reject)=>{let p=start;const next=()=>{if(p>end)return reject(new Error('No free port 8000-8099'));const s=net.createServer();s.once('error',()=>{p++;next()});s.once('listening',()=>s.close(()=>resolve(p)));s.listen(p,'127.0.0.1')};next()})}
function openBrowser(){if(opened)return;opened=true;setTimeout(()=>{try{cp.spawn('cmd.exe',['/c','start','','http://localhost:'+PORT],{detached:true,stdio:'ignore',windowsHide:true}).unref()}catch(e){}},700)}
function startServer(){
 console.log('[SERVER] Starting FULL API server on port',PORT);
 serverProc=cp.spawn(process.execPath,[path.join(ROOT,'server.js')],{env:{...process.env,PHOTO_FINISH_PORT:String(PORT)},stdio:['ignore','pipe','pipe'],windowsHide:true});
 serverProc.stdout.on('data',b=>{const s=b.toString();process.stdout.write(s);if(s.includes('SERVER_READY')){openBrowser();startTunnel()}});
 serverProc.stderr.on('data',b=>process.stderr.write(b));serverProc.on('exit',code=>{console.log('\n[SERVER] stopped code='+code);if(code!==0)status('error','Local server stopped','exit '+code)})
}
function startTunnel(){
 clearTimeout(retry);try{fs.unlinkSync(urlFile)}catch(e){}status('connecting','Creating HTTPS secure connection...');
 if(!fs.existsSync(exe)){status('error','cloudflared.exe not found',exe);return}
 console.log('[TUNNEL] Connecting HTTPS to local port '+PORT);
 const args=['tunnel','--url','http://127.0.0.1:'+PORT,'--protocol','http2','--edge-ip-version','auto','--no-autoupdate'];let got=false,last='';
 tunnelProc=cp.spawn(exe,args,{cwd:ROOT,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
 const scan=b=>{const s=b.toString();process.stdout.write(s);last=(last+s).slice(-3500);const m=s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);if(m&&!got){got=true;fs.writeFileSync(urlFile,m[0]);status('ready','HTTPS ready - scan QR','',m[0]);console.log('\n======================================================');console.log(' HTTPS_READY '+m[0]);console.log(' FULL_API_READY /api/timer /api/room /api/signal');console.log(' FINAL_PRO_READY recording replay PDF');console.log('======================================================\n')}};
 tunnelProc.stdout.on('data',scan);tunnelProc.stderr.on('data',scan);tunnelProc.on('error',e=>status('error','Cloudflare Tunnel could not start',e.message));tunnelProc.on('exit',code=>{if(got){status('retrying','HTTPS disconnected - reconnecting...',last);retry=setTimeout(startTunnel,4000)}else status('error','Secure connection failed',last||('exit '+code))})
}
(async()=>{try{fs.unlinkSync(statusFile)}catch(e){}try{fs.unlinkSync(urlFile)}catch(e){}console.log('PHOTO FINISH ATHLETICS - FINAL PRO');console.log('Node',process.version);try{PORT=await findPort();console.log('[AUTO PORT] Selected',PORT);startServer()}catch(e){console.error('[ERROR]',e.message);status('error','No free local port',e.message)}})();
process.on('SIGINT',()=>{try{tunnelProc&&tunnelProc.kill()}catch(e){}try{serverProc&&serverProc.kill()}catch(e){}process.exit()});
