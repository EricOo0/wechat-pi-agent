export function modelSettingsPage(csrf: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模型与账户</title>
<style>body{font:15px system-ui;background:#10141d;color:#edf1f7;max-width:900px;margin:36px auto;padding:0 20px}a{color:#9dc5ff}section{background:#1b2331;padding:22px;border-radius:14px;margin:20px 0}select,input,button{font:inherit;padding:10px;margin:6px 8px 6px 0;border-radius:6px;border:1px solid #536078;background:#111927;color:inherit;max-width:100%}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#a5b1c4}#error{color:#ffb5ad}label{display:block}h1{font-size:26px}</style>
<a href="/admin">← Trace</a><h1>模型与账户</h1><p class="muted">设置后续任务的模型。账户登录在本机完成，请勿把密钥发到微信。</p><p id="error" role="alert"></p>
<section><h2>当前模型</h2><p id="current">加载中…</p><label>供应商 <select id="providers"></select></label><button id="check">检查认证并加载模型</button><label>模型 <select id="models"><option value="">先检查供应商认证</option></select></label><button id="save">应用到后续任务</button><p class="muted">运行中的任务保持原模型。切换供应商后，后续请求会向目标供应商提供本会话上下文。</p></section>
<section><h2>账户认证</h2><p>使用上方选定的供应商；登录成功不会自动切换模型。</p><button id="login">首次认证</button><button id="reauth">重新认证 / 更换账户</button><div id="ops"></div><hr><div id="operation"></div></section>
<section><h2>帮助</h2><pre>-help 或 /help：总帮助
/provider：供应商列表
/provider &lt;供应商&gt;：认证检查和模型列表
/provider &lt;供应商&gt; &lt;模型ID&gt;：跨供应商切换
/model：当前供应商的模型
/auth &lt;供应商&gt; login / reauth：本机认证
每条命令支持 -help / --help。其他文本原样交给 Agent。</pre></section>
<script>
const csrf=${JSON.stringify(csrf)};const $=id=>document.getElementById(id);let revision=0,opId=null,promptId=null;
function error(e){$('error').textContent=e.message||String(e);}
async function api(path,body,method){const r=await fetch('/admin/api/'+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Local-Control':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data;}
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
async function reload(){const data=await api('models');revision=data.selection.revision;$('current').textContent=data.selection.providerId+' / '+data.selection.modelId;$('providers').replaceChildren(...data.providers.map(p=>option(p.id,p.name+' ('+p.id+') · '+(p.configured?'已配置认证':'未配置认证'))));$('providers').value=data.selection.providerId;await ops();}
async function ops(){const list=await api('auth');$('ops').replaceChildren(...list.map(o=>{const b=document.createElement('button');b.textContent=o.providerId+' · '+o.status+' · '+o.id.slice(0,8);b.onclick=()=>{opId=o.id;promptId=null;void poll().catch(error);};return b;}));}
$('providers').onchange=()=>{$('models').replaceChildren(option('','先检查供应商认证'));};
$('check').onclick=()=>void api('models/'+encodeURIComponent($('providers').value)).then(models=>{$('models').replaceChildren(...models.map(m=>option(m.id,m.name+' ('+m.id+')')));$('error').textContent='';}).catch(error);
$('save').onclick=()=>{const providerId=$('providers').value,modelId=$('models').value;if(!modelId){error(new Error('请先检查认证并选择模型'));return;}void api('selection',{providerId,modelId,expectedRevision:revision},'PUT').then(async()=>{await reload();$('error').textContent='已保存，后续任务生效。';}).catch(error);};
async function start(action){const op=await api('auth',{provider:$('providers').value,action});opId=op.id;promptId=null;await ops();await poll();}
$('login').onclick=()=>void start('login').catch(error);$('reauth').onclick=()=>void start('reauth').catch(error);
async function poll(){if(!opId)return;const op=await api('auth/'+opId);const panel=$('operation');if(op.promptId&&op.promptId===promptId)return;promptId=op.promptId||null;panel.replaceChildren();const info=document.createElement('p');info.textContent=op.providerId+' · '+op.status+(op.error?' · '+op.error:'');panel.append(info);
if(op.status==='WAITING_LOCAL'){for(const method of op.methods){const b=document.createElement('button');b.textContent=method==='oauth'?'浏览器登录':'API Key 认证';b.onclick=()=>void api('auth/'+op.id+'/begin',{method}).then(poll).catch(error);panel.append(b);}}
for(const event of op.events||[]){const p=document.createElement('p');p.textContent=event.message||event.instructions||event.userCode||'';panel.append(p);const url=event.url||event.verificationUri;if(url&&/^https?:\\/\\//.test(url)){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开官方认证页面';panel.append(a);}}
if(op.prompt){const label=document.createElement('label');label.textContent=op.prompt.message;const input=op.prompt.type==='select'?document.createElement('select'):document.createElement('input');if(op.prompt.type==='select')for(const item of op.prompt.options)input.append(option(item.id,item.label));else{input.type='password';input.autocomplete='off';input.placeholder='仅在本机提交';}label.append(input);panel.append(label);const b=document.createElement('button');b.textContent='提交认证输入';b.onclick=()=>{const value=input.value;input.value='';void api('auth/'+op.id+'/input',{promptId:op.promptId,value}).then(()=>{promptId=null;return poll();}).catch(error);};panel.append(b);}
if(!['SUCCEEDED','FAILED','EXPIRED','CANCELLED','COMMITTING'].includes(op.status)){const b=document.createElement('button');b.textContent='取消';b.onclick=()=>void api('auth/'+op.id+'/cancel',{}).then(poll).catch(error);panel.append(b);}}
void reload().catch(error);setInterval(()=>{void poll().catch(error);},1500);
</script></html>`;
}
