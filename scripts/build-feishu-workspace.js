const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const cliScript = "C:\\Users\\jayomaxel\\AppData\\Roaming\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js";
const statePath = path.resolve("feishu-build-state.json");
const resultPath = path.resolve("feishu-build-result.json");
const ownerOpenId = "ou_10aa90c9cba9aaa057c8a36fd5c9e547";

function parseFirstJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`No JSON found in CLI output: ${text}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error(`Incomplete JSON in CLI output: ${text}`);
}

function run(args) {
  const result = spawnSync(process.execPath, [cliScript, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    },
  });
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`lark-cli failed (${args.slice(0, 2).join(" ")}):\n${combined}`);
  }
  const envelope = parseFirstJson(combined);
  if (envelope.ok === false) throw new Error(JSON.stringify(envelope, null, 2));
  return envelope.data || envelope;
}

function findValue(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key]) return value[key];
  }
  for (const nested of Object.values(value)) {
    const found = findValue(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function saveState(state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function option(name, hue, lightness = "Lighter") {
  return { name, hue, lightness };
}

const memberFields = [
  { type: "text", name: "姓名", description: "成员真实姓名" },
  { type: "user", name: "飞书成员", multiple: false },
  { type: "select", name: "年级", multiple: false, options: [option("大一", "Wathet"), option("大二", "Blue"), option("大三", "Purple"), option("大四", "Carmine"), option("研究生", "Green"), option("指导教师", "Orange")] },
  { type: "datetime", name: "加入日期", style: { format: "yyyy-MM-dd" } },
  { type: "select", name: "成长阶段", multiple: false, default_value: ["观察成员"], options: [option("观察成员", "Gray"), option("正式成员", "Blue"), option("核心成员", "Green"), option("负责人候选", "Purple"), option("负责人", "Orange")] },
  { type: "select", name: "兴趣方向", multiple: true, options: [option("AI Coding", "Blue"), option("Agent", "Purple"), option("前端", "Turquoise"), option("后端", "Green"), option("数据与模型", "Carmine"), option("产品与设计", "Orange"), option("社区运营", "Yellow")] },
  { type: "text", name: "技能标签" },
  { type: "text", name: "当前参与项目" },
  { type: "select", name: "成员状态", multiple: false, default_value: ["活跃"], options: [option("活跃", "Green"), option("低活跃", "Yellow"), option("暂休", "Gray"), option("已退出", "Red")] },
  { type: "select", name: "组织信用", multiple: false, default_value: ["正常"], options: [option("正常", "Green"), option("待沟通", "Yellow"), option("观察中", "Orange"), option("受限", "Red")] },
  { type: "datetime", name: "最近沟通", style: { format: "yyyy-MM-dd" } },
  { type: "text", name: "成长记录" },
  { type: "updated_at", name: "更新时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const projectFields = [
  { type: "text", name: "项目名称" },
  { type: "auto_number", name: "项目编号", style: { rules: [{ type: "text", text: "PRJ-" }, { type: "created_time", date_format: "yyyyMM" }, { type: "incremental_number", length: 3 }] } },
  { type: "select", name: "项目状态", multiple: false, default_value: ["想法池"], options: [option("想法池", "Gray"), option("待立项", "Yellow"), option("孵化中", "Wathet"), option("开发中", "Blue"), option("待展示", "Purple"), option("已完成", "Green"), option("暂停", "Orange"), option("已归档", "Gray", "Light")] },
  { type: "user", name: "项目负责人", multiple: false },
  { type: "user", name: "项目成员", multiple: true },
  { type: "select", name: "项目类型", multiple: false, options: [option("自由探索", "Blue"), option("社区共建", "Green"), option("竞赛科研", "Purple"), option("校企合作", "Orange"), option("内部工具", "Turquoise")] },
  { type: "text", name: "问题与价值假设" },
  { type: "text", name: "Git 仓库", style: { type: "url" } },
  { type: "text", name: "Demo 地址", style: { type: "url" } },
  { type: "datetime", name: "立项日期", style: { format: "yyyy-MM-dd" } },
  { type: "datetime", name: "计划交付", style: { format: "yyyy-MM-dd" } },
  { type: "number", name: "完成度", style: { type: "progress", percentage: true, color: "Blue" }, default_value: 0 },
  { type: "text", name: "本周进展" },
  { type: "select", name: "风险状态", multiple: false, default_value: ["正常"], options: [option("正常", "Green"), option("需关注", "Yellow"), option("受阻", "Red")] },
  { type: "text", name: "下一步行动" },
  { type: "updated_at", name: "最近更新", style: { format: "yyyy-MM-dd HH:mm" } },
];

const contributionFields = [
  { type: "text", name: "贡献标题" },
  { type: "datetime", name: "贡献日期", style: { format: "yyyy-MM-dd" } },
  { type: "user", name: "贡献成员", multiple: false },
  { type: "select", name: "贡献类型", multiple: false, options: [option("技术分享", "Blue"), option("项目推进", "Green"), option("帮助成员", "Turquoise"), option("教程文档", "Purple"), option("公共维护", "Orange"), option("活动组织", "Yellow"), option("风险担当", "Carmine")] },
  { type: "text", name: "贡献说明" },
  { type: "text", name: "关联项目" },
  { type: "text", name: "证明链接", style: { type: "url" } },
  { type: "select", name: "影响范围", multiple: false, options: [option("个人", "Gray"), option("项目组", "Blue"), option("全工作室", "Green"), option("校内外", "Purple")] },
  { type: "checkbox", name: "已确认" },
  { type: "created_by", name: "记录人" },
  { type: "created_at", name: "记录时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const resourceFields = [
  { type: "text", name: "使用事项" },
  { type: "datetime", name: "使用时间", style: { format: "yyyy-MM-dd HH:mm" } },
  { type: "user", name: "使用人", multiple: false },
  { type: "select", name: "资源类型", multiple: false, options: [option("Codex 共享账号", "Blue"), option("OpenAI API", "Green"), option("云服务器", "Purple"), option("域名与部署", "Turquoise"), option("充值卡与 Credit", "Orange"), option("其他公共资源", "Gray")] },
  { type: "text", name: "所属项目" },
  { type: "text", name: "用途说明" },
  { type: "number", name: "预计消耗 USD", style: { type: "currency", precision: 2, currency_code: "USD" } },
  { type: "number", name: "实际消耗 USD", style: { type: "currency", precision: 2, currency_code: "USD" } },
  { type: "checkbox", name: "已提前沟通" },
  { type: "select", name: "异常状态", multiple: false, default_value: ["正常"], options: [option("正常", "Green"), option("待核对", "Yellow"), option("异常处理中", "Orange"), option("已关闭", "Gray")] },
  { type: "text", name: "异常说明" },
  { type: "text", name: "后续处置" },
  { type: "created_at", name: "登记时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const activityFields = [
  { type: "text", name: "活动名称" },
  { type: "select", name: "活动类型", multiple: false, options: [option("轻量周会", "Wathet"), option("技术分享", "Blue"), option("Demo Day", "Purple"), option("新人训练", "Green"), option("复盘会议", "Orange"), option("招新活动", "Yellow")] },
  { type: "datetime", name: "开始时间", style: { format: "yyyy-MM-dd HH:mm" } },
  { type: "user", name: "负责人", multiple: false },
  { type: "user", name: "参与成员", multiple: true },
  { type: "select", name: "参与范围", multiple: false, options: [option("项目组", "Blue"), option("全工作室", "Green"), option("公开活动", "Purple")] },
  { type: "text", name: "资料链接", style: { type: "url" } },
  { type: "text", name: "录屏链接", style: { type: "url" } },
  { type: "select", name: "活动状态", multiple: false, default_value: ["筹备中"], options: [option("筹备中", "Yellow"), option("报名中", "Blue"), option("已完成", "Green"), option("已取消", "Gray")] },
  { type: "text", name: "活动复盘" },
  { type: "text", name: "后续行动" },
  { type: "updated_at", name: "更新时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const decisionFields = [
  { type: "text", name: "问题或决策标题" },
  { type: "select", name: "类型", multiple: false, options: [option("问题", "Red"), option("建议", "Blue"), option("组织决策", "Purple"), option("制度变更", "Orange"), option("风险事件", "Carmine")] },
  { type: "user", name: "提出人", multiple: false },
  { type: "datetime", name: "提出时间", style: { format: "yyyy-MM-dd HH:mm" } },
  { type: "select", name: "影响范围", multiple: false, options: [option("个人", "Gray"), option("项目组", "Blue"), option("全工作室", "Green"), option("公共资源", "Orange")] },
  { type: "select", name: "紧急程度", multiple: false, default_value: ["普通"], options: [option("普通", "Gray"), option("重要", "Yellow"), option("紧急", "Red")] },
  { type: "select", name: "处理状态", multiple: false, default_value: ["待讨论"], options: [option("待讨论", "Yellow"), option("处理中", "Blue"), option("已决策", "Purple"), option("已完成", "Green"), option("已归档", "Gray")] },
  { type: "text", name: "背景与事实" },
  { type: "text", name: "备选方案" },
  { type: "text", name: "最终决策" },
  { type: "user", name: "决策人", multiple: true },
  { type: "user", name: "执行负责人", multiple: false },
  { type: "datetime", name: "完成期限", style: { format: "yyyy-MM-dd" } },
  { type: "datetime", name: "复盘日期", style: { format: "yyyy-MM-dd" } },
  { type: "text", name: "执行结果" },
  { type: "updated_at", name: "更新时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const rootPages = [
  {
    key: "portal",
    title: "00 工作室门户",
    content: (baseUrl) => `<title>00 工作室门户</title>
<p>这里是 AI Coding Studio 的工作入口。工作室以自由探索为起点，以公开协作为方法，以责任与传承保证长期运行。</p>
<callout background-color="light-yellow" border-color="yellow"><p><b>最重要的共识：</b>允许犯错，也允许试验失败；涉及公共资源、团队承诺和他人权益时，必须留下记录并主动沟通。</p></callout>
<h1>从哪里开始</h1>
<table><thead><tr><th>你现在要做什么</th><th>进入哪里</th></tr></thead><tbody>
<tr><td>刚加入工作室</td><td>阅读「02 新人入门与成长路径」并完成 7 天入门清单</td></tr>
<tr><td>提出或参加项目</td><td>阅读「03 项目立项与交付 SOP」，在项目库登记</td></tr>
<tr><td>使用 Codex、API 或服务器</td><td>阅读「04 公共资源使用 SOP」，在资源台账留痕</td></tr>
<tr><td>分享经验或帮助成员</td><td>沉淀到「05 技术知识库」，并记录社区贡献</td></tr>
<tr><td>组织活动或形成决策</td><td>使用活动台账、会议模板和问题决策表</td></tr>
</tbody></table>
<h1>运行机制</h1>
<p><b>自由探索。</b>成员可以自主学习、发起项目和选择合作伙伴，不以完成老师或企业任务作为留在社区的条件。</p>
<p><b>过程透明。</b>正式项目、公共资源使用、组织决策和可复用成果需要进入公共系统，避免信息只存在于个人聊天中。</p>
<p><b>贡献建立信任。</b>贡献不限于代码，也包括帮助新人、维护文档、组织活动、复盘失败和主动承担问题。</p>
<p><b>信任带来权限。</b>更高权限意味着更大的责任，不是身份奖励。权限可以因角色变化、长期失联或信用风险而调整。</p>
<h1>工作室运营中台</h1>
<p>成员、项目、贡献、资源、活动和组织决策统一在多维表格中管理。</p>
${baseUrl ? `<bookmark name="AI Coding Studio｜工作室运营中台" href="${baseUrl}"></bookmark>` : `<p><b>入口名称：</b>AI Coding Studio｜工作室运营中台</p>`}
<h1>维护信息</h1>
<p><b>当前维护人：</b><cite type="user" user-id="${ownerOpenId}"></cite></p>
<p><b>当前版本：</b>V1.0。规则根据真实运行问题迭代，任何成员都可以提出修改建议。</p>`,
  },
  {
    key: "charter",
    title: "01 组织章程与社区规则",
    content: () => `<title>01 组织章程与社区规则</title>
<h1>工作室定位</h1>
<p>AI Coding Studio 是由教师支持、学生共同建设的开放技术社区。工作室提供同伴、资源、场地和公开展示机会，成员自主决定探索方向。工作室不是学生外包团队，也不以服从任务为核心评价标准。</p>
<h1>共同原则</h1>
<p><b>开放。</b>鼓励不同基础、不同方向的成员参与，尊重合理分歧。</p>
<p><b>诚实。</b>不伪造进展，不隐瞒公共资源异常，不把 AI 输出冒充自己的判断。</p>
<p><b>协作。</b>重要信息进入公共空间，成果尽可能可复用，问题尽早暴露。</p>
<p><b>责任。</b>允许试错，但当行为影响团队时，需要主动说明、修复影响并参与复盘。</p>
<p><b>传承。</b>核心成员不仅完成自己的事情，也要帮助下一批成员具备独立行动能力。</p>
<h1>成员成长阶段</h1>
<table><thead><tr><th>阶段</th><th>基本状态</th><th>可获得权限</th><th>主要责任</th></tr></thead><tbody>
<tr><td>观察成员</td><td>入门与双向了解</td><td>阅读资料、参加活动、加入开放项目</td><td>完成入门、遵守底线、保持沟通</td></tr>
<tr><td>正式成员</td><td>能独立参与项目</td><td>使用一般资源、参与项目共建</td><td>留下过程记录、按承诺交付或提前说明</td></tr>
<tr><td>核心成员</td><td>持续贡献且值得信任</td><td>发起正式项目、维护公共资料、参与治理</td><td>带新人、维护规则、处理团队问题</td></tr>
<tr><td>负责人候选</td><td>能组织人与资源</td><td>参与权限、预算和招新决策</td><td>主持协作、培养接班人、完成交接</td></tr>
</tbody></table>
<h1>组织底线</h1>
<ul><li>不得将共享账号、密钥、充值卡或内部资料交给工作室之外的人。</li><li>不得未经沟通使用明确保留的付费余额、充值卡或高成本资源。</li><li>不得长期占用公共资源影响其他成员正常使用。</li><li>不得在项目中冒用他人成果、伪造进度或隐瞒重大风险。</li><li>发生问题后不得删除记录、推诿责任或通过沉默规避沟通。</li></ul>
<h1>规则变更 SOP</h1>
<ol><li seq="auto">任何成员在问题与组织决策表提出建议，说明背景、影响和备选方案。</li><li seq="auto">涉及一般协作方式，由负责人和相关成员讨论后试运行。</li><li seq="auto">涉及成员权益、公共预算或权限边界，应公开说明并保留讨论期。</li><li seq="auto">试运行后复盘，确认保留、修改或撤销。</li><li seq="auto">最终规则更新到知识库，并记录生效日期和负责人。</li></ol>
<h1>退出与暂停</h1>
<p>成员可主动暂停或退出。退出前应交接正在承担的项目、公共账号和文档权限。长期失联或持续违反底线时，工作室可先暂停其公共资源权限，再进行事实核对和沟通；处理结果以保护团队和恢复信任为目标。</p>`,
  },
  {
    key: "onboarding",
    title: "02 新人入门与成长路径",
    content: () => `<title>02 新人入门与成长路径</title>
<h1>入门目标</h1>
<p>入门不是考试，而是让新人知道社区如何协作、资源如何使用、遇到问题如何求助，并完成一次真实的小型行动。</p>
<h1>加入后 7 天</h1>
<checkbox done="false">完善成员档案：兴趣方向、技能标签和可投入时间</checkbox>
<checkbox done="false">阅读工作室门户、组织章程和公共资源使用 SOP</checkbox>
<checkbox done="false">完成 Git 与 AI Coding 基础环境准备</checkbox>
<checkbox done="false">参加一次新人交流或与一名核心成员沟通</checkbox>
<checkbox done="false">选择一个开放项目、学习主题或小型实践</checkbox>
<checkbox done="false">在知识库或群聊分享一条可复用的学习记录</checkbox>
<h1>第一个 30 天</h1>
<p>新人至少完成一次可展示的小成果。成果可以是 Demo、Bug 修复、教程、调研、自动化脚本或对公共项目的改进。重点不是规模，而是能说明问题、过程、AI 的作用、自己的判断和下一步。</p>
<h1>如何获得帮助</h1>
<p>提问时尽量包含目标、已经尝试的做法、当前现象、关键报错和希望得到的帮助。不会整理问题不影响求助，但需要愿意补充信息并反馈最后如何解决。</p>
<h1>成长观察</h1>
<p>工作室关注行动方式而非一次结果：是否主动探索，是否能把问题讲清楚，是否与团队保持沟通，是否能判断 AI 输出，是否愿意分享和承担。技术基础较弱不是淘汰理由，长期失联、反复失信且拒绝沟通才会影响成员权限。</p>`,
  },
  {
    key: "projects",
    title: "03 项目立项与交付 SOP",
    content: () => `<title>03 项目立项与交付 SOP</title>
<h1>项目生命周期</h1>
<table><thead><tr><th>阶段</th><th>完成标准</th><th>主要记录</th></tr></thead><tbody>
<tr><td>想法池</td><td>能说明想解决什么问题、为谁创造价值</td><td>一句话想法和发起人</td></tr>
<tr><td>待立项</td><td>负责人、首个验证目标和预计周期明确</td><td>立项模板</td></tr>
<tr><td>孵化中</td><td>完成需求验证或最小技术验证</td><td>实验结果和是否继续</td></tr>
<tr><td>开发中</td><td>任务可拆分，仓库、负责人和节奏明确</td><td>项目库周更新</td></tr>
<tr><td>待展示</td><td>Demo 可运行，说明材料完整</td><td>展示链接和讲解人</td></tr>
<tr><td>已完成/归档</td><td>成果、经验和遗留问题已沉淀</td><td>项目复盘</td></tr>
</tbody></table>
<h1>立项条件</h1>
<p>正式立项至少需要一名明确负责人、一个两到四周内可验证的目标、一个公开记录入口，以及对资源需求的初步判断。不要求一开始就有完整商业计划或成熟技术方案。</p>
<h1>项目角色</h1>
<p><b>负责人。</b>维护目标和节奏，组织讨论，及时暴露风险；负责人不等于承担全部代码。</p>
<p><b>项目成员。</b>对自己承诺的事项负责，无法完成时尽早说明并协商调整。</p>
<p><b>指导者。</b>提供关键反馈、资源与边界建议，不替代学生做全部决定。</p>
<h1>轻量周更新</h1>
<p>每个开发中项目每周只需在项目库更新四项：本周完成、当前风险、下一步行动、需要的帮助。没有进展也如实写明原因，不要求制作形式化周报。</p>
<h1>变更与暂停</h1>
<p>项目目标、负责人或资源需求发生明显变化时，应更新项目库并通知相关成员。连续两周无人推进且没有说明的项目进入暂停；暂停不是失败，恢复时重新确认负责人和下一验证目标。</p>
<h1>交付与复盘</h1>
<p>交付至少包含可访问的代码或成果、运行或展示说明、AI 参与方式、关键判断、未解决问题和下一步建议。复盘关注事实与系统改进，不以寻找个人过错为目的。</p>`,
  },
  {
    key: "resources",
    title: "04 公共资源使用 SOP",
    content: () => `<title>04 公共资源使用 SOP</title>
<h1>适用范围</h1>
<p>本 SOP 适用于共享 Codex/ChatGPT 账号、OpenAI API、充值卡与 Credit、云服务器、域名、部署平台以及由工作室统一购买或申请的其他资源。</p>
<callout background-color="light-red" border-color="red" text-color="red"><p><b>付费余额、充值卡和重置卡不是普通共享额度。</b>任何可能进入付费余额或消耗一次性资产的操作，必须先获得负责人明确确认。</p></callout>
<h1>一般使用流程</h1>
<ol><li seq="auto">确认用途属于学习、工作室项目或经同意的探索。</li><li seq="auto">使用前或使用后及时在公共资源台账登记使用人、用途、所属项目和预计消耗。</li><li seq="auto">发现消耗明显高于预期、可能影响他人或即将进入付费余额时，立即停止并沟通。</li><li seq="auto">使用完成后补充实际消耗和异常情况。</li></ol>
<h1>必须提前沟通的情况</h1>
<ul><li>使用付费余额、充值卡、Credit、重置卡或其他一次性资产。</li><li>预计会明显占用共享账号周额度，影响其他成员使用。</li><li>运行高并发、长时间自动任务或大规模数据处理。</li><li>把资源用于工作室之外的个人长期项目或外部合作。</li><li>需要共享密钥、改变账号安全设置或新增第三方授权。</li></ul>
<h1>额度异常处理 SOP</h1>
<ol><li seq="auto">先止损：暂停相关任务，必要时临时退出共享账号或撤销密钥。</li><li seq="auto">保留事实：记录时间、余额变化、相关项目和可见日志，不先做公开归罪。</li><li seq="auto">内部说明：实际使用人应在发现或收到通知后 24 小时内主动联系负责人。</li><li seq="auto">核对影响：确认实际消耗、是否需要补救、是否涉及安全风险。</li><li seq="auto">形成处理：补充登记、调整权限、归还或补偿资源，并记录后续措施。</li><li seq="auto">完成复盘：判断规则、提醒或技术隔离是否需要改进。</li></ol>
<h1>责任原则</h1>
<p>主动说明问题默认按学习与修复处理，不以处罚为第一目的。未授权使用公共资产已经发生后，继续隐瞒、删除记录或拒绝沟通，会被视为组织信用问题，并可能暂时限制公共资源权限。</p>
<h1>账号安全</h1>
<p>共享账号密码和 API 密钥仅发给有当前使用需要的成员，不得转发给外部人员。负责人应在换届、成员退出、安全事件和权限调整后更新凭证，并保留资源清单和责任人。</p>`,
  },
  {
    key: "knowledge",
    title: "05 技术知识库",
    content: () => `<title>05 技术知识库</title>
<h1>知识库收录什么</h1>
<p>收录能帮助其他成员更快行动的内容，包括 AI Coding 实践、Prompt 与 Agent 经验、前后端开发、数据与模型、部署运维、项目案例、踩坑记录和工具使用方法。</p>
<h1>一篇有用的技术记录</h1>
<p>至少说明适用场景、目标、环境或前提、关键步骤、结果、踩坑和参考链接。AI 可以参与整理，但作者需要确认内容可复现，不能把未经验证的 AI 输出直接当作团队规范。</p>
<h1>推荐结构</h1>
<table><thead><tr><th>部分</th><th>要回答的问题</th></tr></thead><tbody>
<tr><td>背景</td><td>为什么要做，适用于什么场景</td></tr>
<tr><td>结论</td><td>最终推荐什么，什么情况下不推荐</td></tr>
<tr><td>实践</td><td>关键步骤、代码或配置是什么</td></tr>
<tr><td>验证</td><td>如何确认它有效，有哪些限制</td></tr>
<tr><td>复盘</td><td>AI 做了什么，人的判断在哪里</td></tr>
</tbody></table>
<h1>维护规则</h1>
<p>过时内容不直接删除，先标注适用版本或迁移到归档。对安全、公共资源和新人环境有明显影响的教程，发布前至少由另一名成员快速复核。项目结束后，负责人应把最可复用的经验沉淀到这里。</p>`,
  },
  {
    key: "meetings",
    title: "06 活动、会议与复盘",
    content: () => `<title>06 活动、会议与复盘</title>
<h1>基本节奏</h1>
<table><thead><tr><th>活动</th><th>建议频率</th><th>目的</th><th>是否强制</th></tr></thead><tbody>
<tr><td>项目轻量周会</td><td>每周或按项目需要</td><td>同步进展、风险和协作需求</td><td>仅对活跃项目必要</td></tr>
<tr><td>技术分享</td><td>每两周一次</td><td>沉淀方法、促进跨方向交流</td><td>自愿报名</td></tr>
<tr><td>Demo Day</td><td>每月一次</td><td>展示成果、获得反馈、发现合作</td><td>开放参与</td></tr>
<tr><td>社区复盘</td><td>每月或事件后</td><td>改进规则、资源与协作方式</td><td>相关人参与</td></tr>
<tr><td>成员成长沟通</td><td>每月或按需</td><td>了解方向、困难与支持需求</td><td>非打分谈话</td></tr>
</tbody></table>
<h1>会议原则</h1>
<p>没有明确目的、输入和需要形成的结果时不开会。能在文档中异步完成的，不要求所有人同步在线。会议纪要只记录结论、行动项、负责人和截止时间，不追求逐字记录。</p>
<h1>复盘原则</h1>
<p>复盘先还原事实，再分析系统原因，最后形成可执行改进。问题涉及个人时，应区分能力不足、信息不足、承诺失误和诚信问题，避免用一次失败给成员贴永久标签。</p>`,
  },
  {
    key: "handover",
    title: "07 换届与负责人交接",
    content: () => `<title>07 换届与负责人交接</title>
<h1>负责人候选标准</h1>
<p>候选人不以代码水平或一次比赛成绩决定。优先观察持续沟通、组织推进、公共意识、处理冲突、培养新人和完成交接的能力。</p>
<h1>交接周期</h1>
<p>建议在正式换届前至少 30 天开始。前任负责说明背景、风险和隐性工作；候选人实际主持项目、活动或成员沟通；教师提供监督与兜底，但不替代学生完成全部交接。</p>
<h1>必须交接的内容</h1>
<checkbox done="false">成员名单、成员状态和核心成员培养情况</checkbox>
<checkbox done="false">活跃项目、暂停项目、负责人和当前风险</checkbox>
<checkbox done="false">公共账号、API、服务器、域名、预算和到期时间</checkbox>
<checkbox done="false">飞书、GitHub、部署平台及其他管理员权限</checkbox>
<checkbox done="false">合作教师、校内部门、企业或社区联系人</checkbox>
<checkbox done="false">招新、培训、活动和学期运行节奏</checkbox>
<checkbox done="false">未解决问题、历史事件和不宜公开的敏感事项</checkbox>
<h1>交接完成标准</h1>
<p>新负责人能够独立找到关键资料、召集成员、查看项目与资源状态，并处理一次真实组织事项。完成后记录交接日期、双方确认和仍需跟进的问题；旧负责人保留一段时间的咨询角色，但不再成为所有事情的唯一入口。</p>`,
  },
];

const childPages = [
  { parent: "onboarding", key: "newcomer_30d", title: "新人 30 天成长记录模板", content: () => `<title>新人 30 天成长记录模板</title><h1>基本信息</h1><p><b>姓名：</b></p><p><b>加入日期：</b></p><p><b>感兴趣方向：</b></p><p><b>伙伴或对接人：</b></p><h1>本月行动</h1><checkbox done="false">完成工作室入门清单</checkbox><checkbox done="false">加入一个项目或确定一个学习主题</checkbox><checkbox done="false">完成一个可展示的小成果</checkbox><checkbox done="false">分享一次可复用经验</checkbox><h1>成长记录</h1><p><b>我解决了什么问题：</b></p><p><b>AI 帮助了什么：</b></p><p><b>我做出的关键判断：</b></p><p><b>遇到的困难与需要的支持：</b></p><p><b>下一个 30 天计划：</b></p>` },
  { parent: "projects", key: "project_proposal", title: "项目立项模板", content: () => `<title>项目立项模板</title><p><b>项目名称：</b></p><p><b>负责人：</b></p><p><b>项目成员：</b></p><p><b>预计周期：</b></p><h1>问题与目标</h1><p><b>要解决的问题：</b></p><p><b>目标用户：</b></p><p><b>为什么值得做：</b></p><p><b>两到四周内的首个验证目标：</b></p><h1>方案与边界</h1><p><b>最小可行方案：</b></p><p><b>暂时不做什么：</b></p><p><b>需要的公共资源：</b></p><p><b>主要风险：</b></p><h1>完成定义</h1><checkbox done="false">项目库完成登记</checkbox><checkbox done="false">仓库或工作入口已创建</checkbox><checkbox done="false">Demo 或验证方式明确</checkbox><checkbox done="false">负责人和下一步行动明确</checkbox>` },
  { parent: "projects", key: "project_weekly", title: "项目轻量周更新模板", content: () => `<title>项目轻量周更新模板</title><p><b>项目：</b></p><p><b>周期：</b></p><p><b>更新人：</b></p><h1>本周状态</h1><p><b>完成了什么：</b></p><p><b>当前风险或阻塞：</b></p><p><b>下周最重要的一步：</b></p><p><b>需要谁提供什么帮助：</b></p><p><b>项目状态是否需要调整：</b>继续 / 变更 / 暂停 / 待展示</p>` },
  { parent: "projects", key: "project_review", title: "项目复盘模板", content: () => `<title>项目复盘模板</title><h1>结果摘要</h1><p><b>原目标：</b></p><p><b>实际结果：</b></p><p><b>成果链接：</b></p><h1>过程复盘</h1><p><b>做对了什么：</b></p><p><b>哪里与预期不同：</b></p><p><b>最关键的技术或产品判断：</b></p><p><b>AI 参与了什么，哪些内容由人验证：</b></p><h1>组织复盘</h1><p><b>协作和沟通哪里有效：</b></p><p><b>资源、权限或流程哪里需要改进：</b></p><p><b>可以沉淀到知识库的内容：</b></p><p><b>下一步：</b>继续迭代 / 维护 / 暂停 / 归档</p>` },
  { parent: "resources", key: "resource_incident", title: "公共资源异常事件复盘模板", content: () => `<title>公共资源异常事件复盘模板</title><h1>事件事实</h1><p><b>发现时间：</b></p><p><b>涉及资源：</b></p><p><b>异常表现与实际影响：</b></p><p><b>相关使用人与项目：</b></p><h1>处置过程</h1><p><b>采取的止损动作：</b></p><p><b>事实核对结果：</b></p><p><b>沟通与责任说明：</b></p><p><b>补救或补偿：</b></p><h1>根因与改进</h1><p><b>直接原因：</b></p><p><b>规则、提醒、权限或技术隔离上的系统原因：</b></p><checkbox done="false">资源台账已补全</checkbox><checkbox done="false">相关凭证或权限已处理</checkbox><checkbox done="false">规则或阈值已更新</checkbox><checkbox done="false">相关成员已收到结论</checkbox>` },
  { parent: "meetings", key: "meeting_notes", title: "会议纪要模板", content: () => `<title>会议纪要模板</title><p><b>会议主题：</b></p><p><b>时间：</b></p><p><b>参与人：</b></p><p><b>主持与记录：</b></p><h1>需要解决的问题</h1><p></p><h1>关键事实与分歧</h1><p></p><h1>形成的结论</h1><p></p><h1>行动项</h1><table><thead><tr><th>行动</th><th>负责人</th><th>截止时间</th><th>完成标准</th></tr></thead><tbody><tr><td></td><td></td><td></td><td></td></tr></tbody></table><h1>暂未决定</h1><p></p>` },
  { parent: "handover", key: "handover_checklist", title: "负责人交接清单模板", content: () => `<title>负责人交接清单模板</title><p><b>交接周期：</b></p><p><b>前任负责人：</b></p><p><b>新负责人：</b></p><p><b>教师或见证人：</b></p><h1>组织与项目</h1><checkbox done="false">核心成员和培养对象逐一说明</checkbox><checkbox done="false">全部活跃与暂停项目已核对</checkbox><checkbox done="false">本学期活动与招新节奏已说明</checkbox><h1>资源与权限</h1><checkbox done="false">公共账号和密钥清单已更新</checkbox><checkbox done="false">服务器、域名、预算和到期时间已核对</checkbox><checkbox done="false">飞书、GitHub 和部署平台管理员已调整</checkbox><h1>风险与关系</h1><checkbox done="false">未解决问题和敏感事项已单独说明</checkbox><checkbox done="false">教师、校内部门和外部联系人已引荐</checkbox><h1>完成确认</h1><p><b>仍需跟进事项：</b></p><p><b>正式交接日期：</b></p><p><b>双方确认：</b></p>` },
];

function ensureBase(state) {
  if (!state.base || !state.base.token) {
    console.log("Creating operations base...");
    const created = run(["base", "+base-create", "--as", "user", "--format", "json", "--name", "AI Coding Studio｜工作室运营中台", "--time-zone", "Asia/Shanghai", "--table-name", "成员档案", "--fields", JSON.stringify(memberFields)]);
    const token = findValue(created, ["base_token", "app_token"]);
    if (!token) throw new Error(`Base token missing: ${JSON.stringify(created)}`);
    state.base = {
      token,
      url: findValue(created, ["url"]),
      tables: { "成员档案": findValue(created, ["table_id"]) || null },
    };
    saveState(state);
  }

  const tables = [
    ["项目库", projectFields],
    ["社区贡献", contributionFields],
    ["公共资源使用记录", resourceFields],
    ["活动与培训", activityFields],
    ["问题与组织决策", decisionFields],
  ];
  for (const [name, fields] of tables) {
    if (state.base.tables[name]) continue;
    console.log(`Creating table: ${name}`);
    const created = run(["base", "+table-create", "--as", "user", "--format", "json", "--base-token", state.base.token, "--name", name, "--fields", JSON.stringify(fields)]);
    state.base.tables[name] = findValue(created, ["table_id"]) || "created";
    saveState(state);
  }
}

function ensureWiki(state) {
  if (!state.wiki || !state.wiki.spaceId) {
    console.log("Creating studio wiki...");
    const created = run(["wiki", "+space-create", "--as", "user", "--format", "json", "--name", "AI Coding Studio｜工作室知识库", "--description", "自由探索、公开协作、责任与传承：工作室规则、项目 SOP、公共资源、技术知识与换届交接中心"]);
    const spaceId = findValue(created, ["space_id"]);
    if (!spaceId) throw new Error(`Wiki space id missing: ${JSON.stringify(created)}`);
    state.wiki = { spaceId, pages: {} };
    saveState(state);
  }

  for (const page of rootPages) {
    if (state.wiki.pages[page.key]) continue;
    console.log(`Creating page: ${page.title}`);
    const created = run(["wiki", "+node-create", "--as", "user", "--format", "json", "--space-id", state.wiki.spaceId, "--title", page.title]);
    const nodeToken = findValue(created, ["node_token"]);
    const objToken = findValue(created, ["obj_token"]);
    if (!nodeToken || !objToken) throw new Error(`Wiki node tokens missing: ${JSON.stringify(created)}`);
    run(["docs", "+update", "--as", "user", "--format", "json", "--doc", objToken, "--command", "overwrite", "--content", page.content(state.base.url)]);
    state.wiki.pages[page.key] = { title: page.title, nodeToken, objToken };
    saveState(state);
  }

  for (const page of childPages) {
    if (state.wiki.pages[page.key]) continue;
    const parent = state.wiki.pages[page.parent];
    if (!parent) throw new Error(`Missing parent page: ${page.parent}`);
    console.log(`Creating template: ${page.title}`);
    const created = run(["wiki", "+node-create", "--as", "user", "--format", "json", "--parent-node-token", parent.nodeToken, "--title", page.title]);
    const nodeToken = findValue(created, ["node_token"]);
    const objToken = findValue(created, ["obj_token"]);
    if (!nodeToken || !objToken) throw new Error(`Wiki child tokens missing: ${JSON.stringify(created)}`);
    run(["docs", "+update", "--as", "user", "--format", "json", "--doc", objToken, "--command", "overwrite", "--content", page.content(state.base.url)]);
    state.wiki.pages[page.key] = { title: page.title, nodeToken, objToken, parent: page.parent };
    saveState(state);
  }
}

function main() {
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : { version: 1, createdAt: new Date().toISOString() };
  ensureBase(state);
  ensureWiki(state);
  const portal = state.wiki.pages.portal;
  const result = {
    status: "complete",
    base: {
      name: "AI Coding Studio｜工作室运营中台",
      token: state.base.token,
      url: state.base.url || null,
      tables: Object.keys(state.base.tables),
    },
    wiki: {
      name: "AI Coding Studio｜工作室知识库",
      spaceId: state.wiki.spaceId,
      portalNodeToken: portal.nodeToken,
      portalUrl: `https://feishu.cn/wiki/${portal.nodeToken}`,
      pages: Object.values(state.wiki.pages).map((page) => page.title),
    },
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main();
