export const TRACE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WeChat Pi Agent · Traces</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0d12; --panel:#121621; --line:#252b3a; --muted:#8992a7; --text:#edf1f7; --accent:#7c9cff; --ok:#46d39a; --bad:#ff6b7a; }
    * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif }
    header { height:58px; display:flex; align-items:center; gap:18px; padding:0 20px; border-bottom:1px solid var(--line); background:#0e1119 }
    header strong { font-size:16px } header .tab { color:var(--accent); border-bottom:2px solid var(--accent); height:58px; display:flex; align-items:center }
    main { display:grid; grid-template-columns:340px minmax(0,1fr); height:calc(100vh - 58px) }
    aside { border-right:1px solid var(--line); overflow:auto; background:#0e1119 }
    .aside-head { position:sticky; top:0; z-index:2; padding:14px 16px; background:#0e1119; border-bottom:1px solid var(--line); display:flex; justify-content:space-between }
    .trace-item { width:100%; text-align:left; border:0; border-bottom:1px solid var(--line); padding:13px 16px; background:transparent; color:inherit; cursor:pointer }
    .trace-item:hover,.trace-item.active { background:#171c29 }.trace-title { display:flex; justify-content:space-between; gap:8px }.trace-prompt { color:#c3cad8; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; margin-top:5px }.meta { color:var(--muted); font-size:12px; margin-top:4px }
    .status { font-size:11px; font-weight:700 }.status-succeeded,.status-reply_pending { color:var(--ok) }.status-failed,.status-dead_letter { color:var(--bad) }
    article { overflow:auto; padding:22px 26px 60px }.empty { color:var(--muted); padding:60px 20px; text-align:center }
    .detail-head h1 { font-size:20px; margin:0 0 7px }.badges { display:flex; flex-wrap:wrap; gap:7px }.badge { background:#1b2130; border:1px solid var(--line); border-radius:999px; padding:3px 9px; color:#cbd3e3; font-size:12px }
    .tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:22px 0 18px }.tabs button { border:0; padding:10px 13px; color:var(--muted); background:transparent; cursor:pointer }.tabs button.active { color:var(--accent); border-bottom:2px solid var(--accent) }
    .panel { display:none }.panel.active { display:block }.card { background:var(--panel); border:1px solid var(--line); border-radius:9px; padding:14px 16px; margin:0 0 14px }.card h2 { font-size:13px; color:var(--muted); margin:0 0 9px; text-transform:uppercase; letter-spacing:.05em }
    pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; color:#dce3ef }.prompt { max-height:62vh; overflow:auto }
    @media(max-width:800px){ main{grid-template-columns:1fr} aside{height:38vh;border-right:0;border-bottom:1px solid var(--line)} article{height:62vh;padding:16px} }
  </style>
</head>
<body>
<header><strong>WeChat Pi Agent</strong><span class="tab">Traces</span><span id="summary" class="meta"></span></header>
<main><aside><div class="aside-head"><span>最近请求</span><button id="refresh">刷新</button></div><div id="trace-list"></div></aside><article id="detail"><div class="empty">选择一条轨迹查看 System Prompt、工具调用和结果</div></article></main>
<script>
  const listNode = document.getElementById('trace-list');
  const detailNode = document.getElementById('detail');
  const summaryNode = document.getElementById('summary');
  let selectedId = '';
  function text(tag, value, className) { const node=document.createElement(tag); node.textContent=value == null ? '' : String(value); if(className) node.className=className; return node; }
  function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
  async function loadList() {
    const response = await fetch('/debug/traces?limit=100');
    const traces = await response.json();
    listNode.replaceChildren(); summaryNode.textContent = traces.length + ' retained traces';
    traces.forEach(function(trace) {
      const button=document.createElement('button'); button.className='trace-item' + (trace.turnId===selectedId?' active':'');
      const title=document.createElement('div'); title.className='trace-title'; title.append(text('strong', trace.turnId)); title.append(text('span', trace.status, 'status status-'+String(trace.status).toLowerCase()));
      button.append(title, text('div', trace.userPrompt, 'trace-prompt'), text('div', trace.provider+'/'+trace.modelId+' · '+formatDate(trace.capturedAt), 'meta'));
      button.addEventListener('click', function(){ void loadDetail(trace.turnId); }); listNode.append(button);
    });
    if (!selectedId && traces[0]) await loadDetail(traces[0].turnId);
  }
  function card(titleValue, bodyValue, extraClass) {
    const node=document.createElement('section'); node.className='card'; node.append(text('h2', titleValue)); const pre=text('pre', bodyValue); if(extraClass) pre.className=extraClass; node.append(pre); return node;
  }
  function activateTab(name) {
    document.querySelectorAll('.tabs button').forEach(function(node){ node.classList.toggle('active', node.dataset.tab===name); });
    document.querySelectorAll('.panel').forEach(function(node){ node.classList.toggle('active', node.id==='panel-'+name); });
  }
  async function loadDetail(turnId) {
    selectedId=turnId; await loadListSelection();
    const response=await fetch('/debug/traces/'+encodeURIComponent(turnId)); if(!response.ok){ detailNode.replaceChildren(text('div','Trace not found','empty')); return; }
    const payload=await response.json(); const trace=payload.trace; const details=payload.details;
    detailNode.replaceChildren();
    const head=document.createElement('div'); head.className='detail-head'; head.append(text('h1', trace.turnId));
    const badges=document.createElement('div'); badges.className='badges'; [trace.status,trace.provider+'/'+trace.modelId,(trace.tools||[]).length+' tools',(trace.skills||[]).length+' skills',formatDate(trace.capturedAt)].forEach(function(value){badges.append(text('span',value,'badge'));}); head.append(badges); detailNode.append(head);
    const tabs=document.createElement('div'); tabs.className='tabs'; [['overview','Overview'],['system','System Prompt'],['steps','Steps / Tools']].forEach(function(item){ const button=text('button',item[1]); button.dataset.tab=item[0]; button.addEventListener('click',function(){activateTab(item[0]);}); tabs.append(button); }); detailNode.append(tabs);
    const overview=document.createElement('div'); overview.id='panel-overview'; overview.className='panel active'; overview.append(card('User Prompt',trace.userPrompt),card('Final Response',trace.finalResponse||trace.errorMessage||'(running)'),card('Images',((details.message&&details.message.images)||[]).map(function(image){return image.mimeType+' · '+image.bytes+' bytes · '+image.path;}).join('\\n')||'(none)'),card('Tools',(trace.tools||[]).join('\\n')||'(none)'),card('Skills',(trace.skills||[]).map(function(skill){return skill.name+' — '+skill.description;}).join('\\n\\n')||'(none)')); detailNode.append(overview);
    const system=document.createElement('div'); system.id='panel-system'; system.className='panel'; system.append(card('Actual Pi System Prompt Snapshot',trace.systemPrompt,'prompt')); detailNode.append(system);
    const steps=document.createElement('div'); steps.id='panel-steps'; steps.className='panel'; steps.append(card('Agent Events / Tool Calls',JSON.stringify(details.steps||[],null,2),'prompt')); detailNode.append(steps);
    activateTab('overview');
  }
  async function loadListSelection(){ document.querySelectorAll('.trace-item').forEach(function(node){ node.classList.toggle('active', node.querySelector('strong').textContent===selectedId); }); }
  document.getElementById('refresh').addEventListener('click',function(){void loadList();});
  void loadList(); setInterval(function(){void loadList();},10000);
</script>
</body>
</html>`;
