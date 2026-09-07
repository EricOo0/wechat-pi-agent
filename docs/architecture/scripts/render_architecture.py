"""Generate the editable architecture SVG. Coordinates are explicit for stable routing."""
from pathlib import Path
from html import escape

OUT = Path(__file__).resolve().parents[1] / 'layered-architecture-v3.svg'
p = []
def add(s): p.append(s)
def rect(x,y,w,h,fill='#fff',stroke='#a9b8cc',rx=12,sw=1.5):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
def text(x,y,s,size=20,color='#26364a',weight=400,anchor='middle'):
    add(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(s)}</text>')
def card(id,x,y,w,h,title,lines=(),color='#385d90'):
    add(f'<g id="{id}">'); rect(x,y,w,h,stroke=color)
    text(x+w/2,y+33,title,24,color,650)
    for i,line in enumerate(lines): text(x+w/2,y+64+i*27,line,18)
    add('</g>')
def path(id,d,dashed=False,color=None,end=True):
    c=color or ('#647a9e' if dashed else '#254860')
    add(f'<path id="{id}" d="{d}" fill="none" stroke="{c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"'+(' stroke-dasharray="7 6"' if dashed else '')+(f' marker-end="url(#{"dashArrow" if dashed else "arrow"})"' if end else '')+'/>')
def label(x,y,s):
    w=len(s)*18+20;rect(x-w/2,y-18,w,25,'#ffffff','none',4);text(x,y,s,17)
def layer(n,y,h,title,sub,bg,color):
    rect(25,y,1595,h,bg,color,14,1)
    rect(25,y,190,h,color,color,14)
    text(120,y+42,str(n),32,'#fff',700)
    text(120,y+80,title,24,'#fff',650)
    if sub: text(120,y+108,sub,15,'#fff')

add('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1540" viewBox="0 0 2000 1540" role="img" aria-labelledby="title desc">')
add('<title id="title">微信 × Pi Agent 技术架构</title><desc id="desc">六层架构，展示微信消息接入、任务调度、回复投递、会话与记忆管理，以及内部 Agent Runtime、领域、存储和工具沙箱。</desc>')
add('<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="#254860"/></marker><marker id="dashArrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="#647a9e"/></marker></defs>')
add('<g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">')
rect(0,0,2000,1540,'#fff','none',0)
text(1000,65,'微信 × Pi Agent 技术架构',43,'#142c50',700)
text(1000,103,'系统分层 · 模块协作 · 主要数据流',23,'#617187')
layer(1,135,125,'用户界面','对话与管理','#eef2f8','#526b91')
layer(2,305,130,'渠道与接口层','协议与交互','#e6f5ee','#247c70')
layer(3,485,325,'应用编排层','协调与调度','#e9f2ff','#336eb4')
layer(4,865,215,'核心能力层','系统内部能力','#f0eafa','#7858a0')
layer(5,1150,145,'领域层','核心模型与规则','#fff3dc','#b17d23')
layer(6,1335,135,'基础设施层','存储与观测','#f9e9ee','#ac596e')

card('wechat',285,155,925,80,'微信',['用户对话'])
card('admin-ui',1310,155,275,80,'Trace Admin',['管理与观测'])
card('receive',285,328,235,85,'微信渠道 · 接收',['协议转换 · 消息接收'], '#247c70')
card('send',1050,328,235,85,'微信渠道 · 发送',['文本回复 · 渠道发送'], '#247c70')
card('admin-api',1340,328,245,85,'管理接口',['查询 · 健康检查'], '#247c70')

text(265,512,'对话处理',17,'#336eb4',650,'start')
card('ingest',285,530,240,90,'消息处理',['校验 · 去重 · 入队'])
card('turn',705,530,265,90,'任务调度',['领取 · 路由 · 执行协调'])
card('delivery',1165,530,280,90,'回复投递',['发送 · 失败重试'])
text(265,669,'生命周期与后台任务',17,'#336eb4',650,'start')
card('session',285,695,280,90,'会话管理',['创建 / 关联 · 结束 / 归档'])
card('memory-job',1115,695,330,90,'记忆任务管理',['后台整理调度'])

card('files',250,900,280,140,'用户文件',['保存 · 查询 · 选用','模型附件适配'],'#7858a0')
card('runtime',605,900,365,140,'Agent Runtime',['上下文 / Skills / 压缩','模型与工具循环 · Pi SDK'],'#7858a0')
card('memory',1040,900,255,140,'用户记忆',['总览加载 · 历史检索','明细提炼 · 总览合并'],'#7858a0')
card('tools',1340,900,250,140,'权限与工具管理',['授权确认 · 权限校验','执行策略 · 受控工具'],'#7858a0')
text(930,1069,'Agent 按需使用文件、记忆与工具',17,'#7858a0')

rect(242,1170,650,108,'#fff9ec','#d9b778',8)
rect(912,1170,687,108,'#fff9ec','#d9b778',8)
text(567,1196,'对话领域',19,'#94661d',650)
text(1255,1196,'用户资源与授权领域',19,'#94661d',650)
for x,title,sub in [(265,'会话','归属 · 生命周期'),(475,'执行','任务 · 执行记录'),(685,'投递','回复 · 投递规则'),(935,'记忆','明细 · 总览'),(1150,'文件','用户文件 · 文件引用'),(1365,'权限','主体 · 授权规则')]:
    rect(x,1207,200,58,'#fff','#dfc797',6)
    text(x+100,1231,title,20,'#855a19',650);text(x+100,1254,sub,15)
card('database',250,1355,420,92,'数据库',['SQLite · 业务状态 / 索引 / 任务队列'],'#ac596e')
card('filesystem',695,1355,420,92,'文件系统',['用户文件 · 会话历史 · 记忆'],'#ac596e')
card('observability',1140,1355,450,92,'日志与观测',['Trace · 日志 · 指标'],'#ac596e')

card('provider',1695,1080,250,115,'外部模型服务',['默认 Codex','由 Pi SDK 访问'])
rect(1695,880,250,170,'#faf7ff','#7858a0',12)
add('<rect x="1687" y="872" width="266" height="186" rx="16" fill="none" stroke="#7858a0" stroke-dasharray="6 5"/>')
text(1820,916,'工具执行子进程',23,'#7858a0',650)
text(1820,948,'OS 沙箱',21,'#7858a0',650)
text(1820,980,'macOS · Seatbelt',18)
text(1820,1009,'Linux · bubblewrap',18)
text(1820,1035,'文件访问 · 网络限制',17)
text(1820,855,'本机执行边界',18,'#7858a0')

# Connections are explicit. No auto-layout or implicit joints.
path('user-input','M 400 235 V 328');label(447,286,'用户消息')
path('user-reply','M 1168 328 V 235');label(1220,286,'文本回复')
path('admin-query','M 1430 235 V 328',True)
path('admin-response','M 1510 328 V 235',True);label(1480,285,'查询 / 展示')
path('receive-ingest','M 405 413 V 530')
path('ingest-turn','M 525 575 H 705');label(615,563,'Turn 队列')
path('turn-outbox','M 970 575 H 1165');label(1065,563,'Outbox')
path('delivery-channel','M 1305 530 V 462 H 1168 V 413');label(1270,451,'待发回复')
path('ingest-session','M 405 620 V 695',True);label(458,652,'创建 / 关联')
path('turn-session','M 705 598 H 640 V 724 H 565',True);label(645,681,'会话控制')
# A deliberate bridge prevents the archival flow from joining the runtime call.
path('archive-memory','M 565 750 H 823 Q 838 726 853 750 H 1115');label(994,739,'归档入队')
path('turn-runtime','M 838 620 V 900',True);label(884,844,'执行 / 结果')
path('job-memory','M 1278 785 V 843 H 1168 V 900',True);label(1305,839,'整理任务')
path('sandbox-call','M 1590 970 H 1695',True);label(1642,957,'受控执行')
path('model-call','M 788 1040 V 1118 H 1695',True);label(1250,1107,'模型调用')
# Layer relationships: domain rules are consumed, not a persistence gateway.
path('capability-domain','M 540 1080 V 1150',True)
label(635,1103,'使用模型与规则')
# Shared infrastructure access lane stays left of all domain/model cards.
path('application-infrastructure','M 300 810 V 830 H 230 V 1318 H 465 V 1335',True)
path('capability-infrastructure','M 310 1080 V 1095 H 230',True,end=False)
add('<circle cx="230" cy="1095" r="4" fill="#647a9e"/>')
label(401,843,'基础设施访问')
label(416,1310,'通过接口读写与记录')
# Separate outer lane for Admin queries; jump over model / sandbox connectors.
path('admin-storage','M 1585 371 H 1978 V 1403 H 1590',True)
text(1965,650,'状态与 Trace 查询',17,'#647a9e',400,'end')

rect(1695,1250,250,150,'#fff','#c8d0dc')
text(1820,1281,'图例',21,'#344c70',650)
path('legend-flow','M 1717 1310 H 1770');text(1850,1316,'主要业务流',17)
path('legend-call','M 1717 1347 H 1770',True);text(1850,1353,'调用 / 依赖 / 查询',17)
text(1820,1382,'跨线拱桥表示不相连',15,'#697b90')
text(1000,1509,'分层展示职责，同层模块可协作；队列箭头表示持久化交接，typing 等辅助交互省略。',18,'#64748b')
add('</g></svg>')
OUT.write_text('\n'.join(p),encoding='utf-8')
print(OUT)
