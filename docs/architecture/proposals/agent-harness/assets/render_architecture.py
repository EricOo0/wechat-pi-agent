"""Render a proposal, deliberately separate from the implemented architecture."""
from pathlib import Path
from html import escape

out = Path(__file__).resolve().parent / 'architecture.svg'
parts=[]
def emit(s): parts.append(s)
def box(x,y,w,h,fill='#fff',stroke='#b7c5d5',rx=12,dash=False):
    emit(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"'+(' stroke-dasharray="7 5"' if dash else '')+'/>')
def txt(x,y,s,size=20,color='#33455b',bold=False,anchor='middle'):
    emit(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{650 if bold else 400}" text-anchor="{anchor}">{escape(s)}</text>')
def card(id,x,y,w,h,title,lines,color='#355f96',fill='#fff'):
    emit(f'<g id="{id}">');box(x,y,w,h,fill,color)
    txt(x+w/2,y+34,title,24,color,True)
    for i,s in enumerate(lines):txt(x+w/2,y+67+28*i,s,18)
    emit('</g>')
def line(id,d,dash=False,end=True):
    emit(f'<path id="{id}" d="{d}" fill="none" stroke="{("#788ba6" if dash else "#315c79")}" stroke-width="2.5" stroke-linejoin="round"'+(' stroke-dasharray="7 5"' if dash else '')+(f' marker-end="url(#{"dep" if dash else "flow"})"' if end else '')+'/>')
def label(x,y,s):
    w=len(s)*18+22;box(x-w/2,y-19,w,27,'#fff','none',4);txt(x,y,s,17)

emit('<svg xmlns="http://www.w3.org/2000/svg" width="2100" height="1760" viewBox="0 0 2100 1760" role="img" aria-labelledby="title desc">')
emit('<title id="title">建议架构：面向会话的 Agent Harness</title><desc id="desc">消息交互通过统一命令事件契约接入 Harness。Orchestrator 管理会话与并发，Runtime 执行 Agent Loop，能力模块和职责化存储接口提供支撑。为待实现方案。</desc>')
emit('<defs><marker id="flow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L9 5 L0 10 Z" fill="#315c79"/></marker><marker id="dep" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L9 5 L0 10 Z" fill="#788ba6"/></marker></defs>')
emit('<g font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">')
box(0,0,2100,1760,'#fff','none',0)
txt(1050,65,'面向会话的 Agent Harness',44,'#193655',True)
txt(1050,105,'建议架构 · 渠道解耦 · 目标驱动 · 长程执行 · 证据验证',24,'#697e95')
box(1820,33,235,55,'#fff4d8','#dec077');txt(1937,69,'设计方案 · 尚未实现',19,'#91671f',True)

# Host-side messaging boundary.
box(25,150,415,1240,'#e9f5f1','#4e998b')
txt(232,189,'消息交互模块',28,'#247566',True)
txt(232,217,'拥有渠道协议与可靠交付',18,'#527d73')
card('surfaces',50,245,365,95,'微信 / Web / CLI',['对话入口与呈现'],'#378578')
card('ingress',50,390,365,150,'接收与路由',['身份 · 去重 · 附件接收','渠道会话 ↔ Harness Session','持久 Inbox / 接收确认'],'#378578')
card('delivery',50,635,365,155,'输出呈现与投递',['状态 / 审批 / 流式文本','最终回复 → 持久 Outbox','分段 · typing · 发送重试'],'#378578')
card('delivery-stores',50,850,365,100,'渠道存储接口',['Inbox / Outbox / 会话映射'],'#378578')
box(50,990,365,175,'#f8fcfa','#abcdbf')
txt(232,1025,'解耦边界',23,'#247566',True)
txt(232,1060,'渠道不依赖 Pi 会话或工具类型',18)
txt(232,1091,'Agent 不感知微信协议与发送 API',18)
txt(232,1133,'可靠接收与投递可继续使用 SQLite',17,'#5b7167')
card('goal-user-controls',50,1210,365,140,'长程任务交互',['进度 / 证据 / 阻塞原因','修改目标 / 暂停 / 恢复 / 取消'],'#378578')

# Harness runtime/control boundary.
box(490,150,1260,1240,'#f7f9fd','#6e87ab')
txt(1120,189,'Harness 内核与能力模块',29,'#294d7d',True)
txt(1120,219,'进程内接口起步；统一命令与事件也可通过 RPC 暴露',18,'#637995')
box(515,245,1210,375,'#e7effc','#749bd1')
txt(1120,282,'Agent Orchestrator · 会话与运行控制',28,'#315d97',True)
for x,t,s in [(535,'Session 管理','创建 / 恢复 / 关闭'),(835,'输入与控制','启动 / 排队 / steer / 取消'),(1135,'执行协调','运行句柄 / 审批答复 / 并发额度')]:
    box(x,307,280 if x!=1135 else 570,66,'#fff','#afc4e1',8)
    if x==1135:
        txt(x+285,331,t,20,'#315d97',True);txt(x+285,357,s,17)
    else:txt(x+140,331,t,20,'#315d97',True);txt(x+140,357,s,17)
box(535,394,1170,167,'#fff6e1','#caa159')
txt(1120,429,'Goal Controller · 长程目标控制',25,'#967027',True)
for x,t,s in [(550,'目标与计划','目标版本 / 约束 / 里程碑'),(837,'持续推进','续跑 / 等待唤醒 / 重规划'),(1124,'进展与验收','阶段证据 / 停滞检测'),(1411,'停止与恢复','预算 / 阻塞 / 检查点')]:
    box(x,447,275,66,'#fff','#dbc48e',7)
    txt(x+137,473,t,20,'#967027',True);txt(x+137,499,s,16)
txt(1120,544,'读取进展与验证结果 → 继续 / 调整 / 等待 / 暂停 / 完成',18,'#967027')
txt(1120,592,'每个 Session 一个运行所有者；会话内有序，不同会话可限额并行',19,'#315d97')
emit('<g transform="translate(0 190)">')
box(515,495,1210,175,'#eee9fa','#9c82bc')
txt(1120,530,'Agent Runtime · 单次 Run 的 Agent Loop',28,'#6b4e91',True)
for x,title in [(535,'获取上下文'),(835,'模型调用'),(1135,'工具执行'),(1435,'继续 / 完成')]:
    box(x,552,250,47,'#fff','#b5a3ce',7);txt(x+125,583,title,21,'#654989',True)
txt(1120,637,'执行一次 Run 并返回进展与产物；Run 结束不等于 Goal 完成。模型接入复用 Pi SDK。',18,'#654989')

box(515,730,1210,370,'#f2f7f8','#9eb8bb')
txt(1120,765,'可组合能力 · 明确接口与生命周期',25,'#416d73',True)
cards=[
('context',535,790,'Context Manager',['目标 / 约束 / 当前里程碑','压缩 / 工作状态 / 证据引用','恢复后核对真实状态']),
('skills',835,790,'Skill Registry',['发现 / 优先级','按需加载 / 调用记录']),
('memory',1135,790,'Memory Service',['加载 / 检索','明细提炼 / 总览合并']),
('artifacts',1435,790,'Artifact Service',['用户文件 / Agent 产物','模型附件与远端引用']),
('tool-policy',535,945,'Tool & Permission',['工具注册 / 校验 / 执行分派','审批 / 授权 / 策略']),
('execution',935,945,'Execution Environment',['文件 / 进程 / 网络能力','沙箱选择 / 取消 / 资源清理']),
('verify',1335,945,'Verification',['约束检查 / 阶段验收 / 完成检查','测试与产物证据 / 按需语义审查','通过 / 失败 / 无法确认'])]
for id,x,y,t,ls in cards:card(id,x,y,270 if y==790 else 370,135,t,ls,'#416d73')
txt(1120,1140,'模型输入由 Context Manager 统一组装；Runtime 通过能力接口访问资源与工具',18,'#607a80')
txt(1120,1173,'任务工作状态持续更新；用户长期记忆独立管理；验证结论通过接口返回目标控制器',17,'#607a80')
emit('</g>')

# External dependency / execution boundaries.
emit('<g transform="translate(0 190)">')
card('models',1825,505,245,125,'外部模型服务',['模型推理 / 流式响应','默认 Codex，可替换'],'#506a9a')
box(1815,900,265,195,'#faf5ef','#b59167',12,True)
txt(1947,936,'执行环境边界',24,'#937047',True)
txt(1947,974,'本地沙箱 / 远端沙箱',19)
txt(1947,1009,'Seatbelt / bubblewrap',18)
txt(1947,1052,'实现受控执行接口',17,'#937047')
box(1800,1215,280,225,'#fff','#ccd5e0')
txt(1940,1251,'运行与存储的关系',23,'#405d81',True)
txt(1940,1290,'输入直接唤醒会话执行',18)
txt(1940,1327,'存储不作为 Loop 轮询中心',17)
txt(1940,1364,'关键边界等待可靠保存',18)
txt(1940,1401,'流式增量 / 指标可异步写入',17)

# Shared persistence and observer services, intentionally not a queue in front of Runtime.
box(490,1255,1260,230,'#faedf0','#bb8190')
txt(1120,1292,'职责化存储接口与观测',27,'#9f556b',True)
for x,t,s in [(515,'Session Store','会话事件 / 历史恢复'),(757,'Goal / Task Store','目标版本 / 计划 / 检查点'),(999,'Artifact Store','原件 / 产物 / 证据'),(1241,'Permission Store','授权状态 / 消费 / 审计'),(1483,'Event / Trace','执行记录 / 进度观测')]:
    card('store-'+str(x),x,1313,225,95,t,[s],'#9f556b')
txt(1120,1442,'可替换实现：SQLite · JSONL / Markdown · 文件系统',21,'#9f556b',True)
txt(1120,1470,'恢复目标与检查点；先核对外部副作用，不盲目重放工具调用',17,'#9f556b')
box(25,1255,415,230,'#fff5df','#c4a462')
txt(232,1292,'后台任务与管理',26,'#9e772c',True)
txt(232,1335,'记忆整理等任务：持久化 / 重试',19)
txt(232,1370,'使用能力接口，独立于聊天 Loop',18)
txt(232,1420,'Trace Admin：订阅事件 / 查询状态',18)
txt(232,1456,'与消息交互、核心运行分别解耦',17,'#937749')
emit('</g>')

# Few explicitly routed connectors; no ambiguous shared junctions.
line('surface-receive','M232 340 V390')
line('input-orchestrator','M415 455 H463 V337 H515');label(468,375,'统一输入')
line('orchestrator-runtime','M1055 620 V685');label(975,657,'启动 / 续跑')
line('runtime-progress','M1210 685 V620');label(1320,657,'进展 / 证据 / 停止原因')
line('runtime-events','M515 773 H467 V704 H415');label(467,748,'运行事件')
line('reply-surface','M50 712 H37 V285 H50');
line('channel-write','M232 790 V850',True)
emit('<g transform="translate(0 190)">')
line('runtime-capabilities','M1120 670 V730',True);label(1200,708,'按需调用')
line('runtime-provider','M1725 568 H1825');label(1780,552,'模型请求')
line('execution-sandbox','M1305 1013 H1320 V1120 H1775 V1000 H1815',True)
label(1600,1114,'受控执行')
line('harness-store','M1120 1200 V1255',True);label(1240,1234,'读写 / 检查点 / 事件')
txt(1045,1531,'实线：输入、控制与输出   ·   虚线：能力与存储接口   ·   本图表达设计边界，不代表当前代码已完成重构',18,'#718196')
emit('</g>')
emit('</g></svg>')
out.write_text('\n'.join(parts),encoding='utf-8')
print(out)
