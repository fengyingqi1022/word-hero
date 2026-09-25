# 单词小勇士：技术设计文档

> 文档版本：1.0  
> 对应产品文档：`PRODUCT_SPEC.md` 1.0  
> 技术阶段：MVP（第一版）  
> 文档状态：可进入实现

---

## 1. 文档目的

本文档定义“单词小勇士”第一版的技术实现方式，包括运行架构、代码模块、IndexedDB 数据库、CSV 导入、学习队列、掌握状态机、间隔复习、发音、备份恢复、错误处理和测试策略。

产品规则以 `PRODUCT_SPEC.md` 为准；本文档负责把这些规则转化为可编码、可测试的技术约定。

---

## 2. 技术目标与约束

### 2.1 技术目标

1. 最终可交付为一个自包含的 `index.html`。
2. 不依赖服务器数据库或用户账号。
3. 同一份前端代码同时支持电脑浏览器和 iPad Safari。
4. 在 10,000 个单词及相应学习记录规模下保持流畅。
5. 所有核心学习数据在每次提交后立即持久化。
6. 核心算法为纯函数或低副作用模块，能够自动化测试。
7. 数据格式带版本号，可以向后迁移。

### 2.2 技术约束

- 运行时仅使用 HTML、CSS 和原生 JavaScript。
- 不使用 React、Vue 等框架。
- 不需要 Node.js 才能运行最终产品。
- 不从 CDN 加载运行时依赖。
- 不上传孩子的词库、答案和学习记录。
- 第一版不实现自动云同步。
- 第一版不保证完全离线启动。
- 第一版不使用自动语音识别。

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────┐
│                 UI / View Layer              │
│  选择孩子｜首页｜学习｜结果｜词包｜报告｜设置  │
└──────────────────────┬───────────────────────┘
                       │ commands / view models
┌──────────────────────▼───────────────────────┐
│              Application Services            │
│ ProfileService   PackService   SessionService │
│ ReviewEngine     StatsService  BackupService  │
└──────────────┬───────────────┬───────────────┘
               │               │
┌──────────────▼───────┐ ┌─────▼────────────────┐
│ Platform Adapters    │ │ Persistence Layer     │
│ CSV / Speech / Files │ │ IndexedDB Repository  │
└──────────────────────┘ └──────────────────────┘
```

### 3.1 架构原则

- UI 不直接读写 IndexedDB。
- UI 不直接计算复习日期或掌握状态。
- `ReviewEngine` 只接收数据并返回状态变化，不操作 DOM。
- `SessionService` 负责生成和维护本轮队列。
- 所有写入通过 Repository 和事务完成。
- CSV、备份文件和语音能力作为平台适配器隔离。

---

## 4. 技术选型

| 领域 | 选择 | 原因 |
|---|---|---|
| 页面 | 单页应用 | 页面少、状态共享多、无需后端路由。 |
| 语言 | 原生 JavaScript，ES2020+ | 无运行时框架依赖，现代目标浏览器均支持。 |
| 样式 | 原生 CSS、CSS Variables | 易于单文件打包和响应式适配。 |
| 持久化 | IndexedDB | 适合结构化数据和较多学习记录，优于把所有数据塞进 `localStorage`。 |
| 小型偏好 | `localStorage` | 只保存当前档案 ID、主题等非关键少量信息。 |
| CSV | 内置状态机解析器 | 只需要少量字段；避免 CDN 和运行时第三方依赖，同时支持引号和字段内逗号。 |
| 发音 | Web Speech Synthesis | 无需自建音频库，支持设备可用的英语语音。 |
| 文件读取 | `<input type="file" multiple>`、File API | 同时适配电脑和 iPad 的文件选择器。 |
| 文件导出 | Blob、Object URL、`download` | 生成本地 JSON 备份文件。 |
| ID | `crypto.randomUUID()` | 浏览器原生生成稳定唯一标识。 |
| 日期 | 本地日历字符串 `YYYY-MM-DD` | 产品按“天”复习，避免时区和小时造成错误。 |

### 4.1 第三方依赖政策

第一版不引入运行时第三方库。如果实现过程中决定使用 CSV 库，必须：

1. 固定版本；
2. 将代码随产品一起打包；
3. 不从 CDN 加载；
4. 记录许可证；
5. 仍然保持最终产物可离线解析本地 CSV。

---

## 5. 交付与源码组织

### 5.1 最终交付物

```text
dist/
└── index.html
```

该文件包含应用所需的 HTML、CSS 和 JavaScript。CSV 词包及 JSON 备份由用户单独保管，不属于程序文件。

### 5.2 推荐开发目录

```text
src/
├── index.html
├── styles/
│   ├── tokens.css
│   ├── layout.css
│   └── components.css
├── core/
│   ├── config.js
│   ├── dates.js
│   ├── normalize.js
│   ├── answer-evaluator.js
│   └── review-engine.js
├── data/
│   ├── db.js
│   ├── repositories.js
│   └── migrations.js
├── services/
│   ├── profile-service.js
│   ├── pack-service.js
│   ├── session-service.js
│   ├── stats-service.js
│   ├── csv-service.js
│   ├── speech-service.js
│   └── backup-service.js
├── views/
│   ├── profile-view.js
│   ├── home-view.js
│   ├── study-view.js
│   ├── result-view.js
│   ├── packs-view.js
│   ├── report-view.js
│   └── settings-view.js
└── app.js

tests/
├── unit/
├── integration/
└── e2e/

scripts/
└── build.mjs

dist/
└── index.html
```

开发时保持模块化；构建脚本将 CSS 和 JavaScript 内联进最终 `index.html`。如果第一版直接在一个 HTML 内实现，也必须按照上述模块顺序分区，并避免跨模块直接修改内部状态。

---

## 6. 应用启动流程

```text
加载 index.html
→ 执行运行环境检查
→ 打开 IndexedDB
→ 执行必要的数据迁移
→ 确认两个默认档案存在
→ 加载上次选择的档案
→ 查询今日到期任务和当前词包
→ 渲染选择孩子页或学习首页
```

### 6.1 运行环境检查

启动时检查：

- IndexedDB 是否可用
- File API 是否可用
- `crypto.randomUUID` 是否可用；不可用时使用安全的本地替代 ID 生成器
- `speechSynthesis` 是否可用
- 当前存储是否可以完成最小读写测试

IndexedDB 不可用时，不允许开始正式学习，以免产生无法保存的进度。应用应显示可理解的错误和恢复建议。

---

## 7. 配置常量

所有可调整业务参数集中在 `CONFIG` 中，不得散落在 UI 代码里。

```js
const CONFIG = {
  schemaVersion: 1,
  dbName: 'word-hero-db',
  reviewIntervalsDays: [1, 2, 4, 7, 15, 30, 60],
  longTermReviewDays: 90,
  masteryCorrectStreak: 2,
  requeueGap: 3,
  defaultNewWordsByGrade: {
    grade5: 10,
    grade9: 15,
  },
  questionWeights: {
    meaningToEnglish: 0.5,
    audioToEnglish: 0.3,
    englishToMeaning: 0.2,
  },
  newWordsPerSessionMin: 1,
  newWordsPerSessionMax: 50,
  activeIdleTimeoutMs: 120000,
};
```

测试不应依赖硬编码日期；时间通过可注入的 `Clock` 提供。

---

## 8. IndexedDB 设计

### 8.1 数据库

- 数据库名称：`word-hero-db`
- 初始数据库版本：`1`
- 逻辑数据版本：`schemaVersion = 1`

IndexedDB 版本用于对象仓库和索引迁移；`schemaVersion` 用于备份数据结构和业务迁移。

### 8.2 对象仓库

#### `meta`

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 主键，例如 `schemaVersion`。 |
| `value` | any | 对应值。 |

#### `profiles`

主键：`id`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 档案 ID。 |
| `name` | string | 姓名或昵称。 |
| `grade` | `grade5 \| grade9 \| custom` | 年级。 |
| `avatarColor` | string | 头像颜色 token。 |
| `settings` | object | 每轮新词数、发音等设置。 |
| `createdAt` | ISO timestamp | 创建时间。 |
| `updatedAt` | ISO timestamp | 更新时间。 |

#### `packs`

主键：`id`

索引：

- `byProfileId`：`profileId`
- `byProfileOrder`：`[profileId, order]`
- `byProfileStatus`：`[profileId, status]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 词包 ID。 |
| `profileId` | string | 所属孩子。 |
| `name` | string | 显示名称。 |
| `sourceFileName` | string | 原 CSV 文件名。 |
| `status` | string | `locked/available/active/completed/archived`。 |
| `order` | number | 顺序，从 0 开始。 |
| `wordCount` | number | 有效单词数量缓存。 |
| `completedAt` | timestamp/null | 首次通关时间。 |
| `createdAt` | timestamp | 创建时间。 |
| `updatedAt` | timestamp | 更新时间。 |

#### `words`

主键：复合键 `[profileId, wordKey]`

索引：`byProfileId`：`profileId`

| 字段 | 类型 | 说明 |
|---|---|---|
| `profileId` | string | 所属孩子。 |
| `wordKey` | string | 规范化英文。 |
| `word` | string | 用于展示的标准英文。 |
| `meaning` | string | 合并后的中文释义。 |
| `meaningParts` | string[] | 去重后的释义数组。 |
| `createdAt` | timestamp | 创建时间。 |
| `updatedAt` | timestamp | 更新时间。 |

#### `packWords`

用于表达词包与单词的多对多关系。

主键：复合键 `[packId, wordKey]`

索引：

- `byPackPosition`：`[packId, position]`
- `byWord`：`[profileId, wordKey]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `packId` | string | 词包 ID。 |
| `profileId` | string | 所属孩子，用于安全过滤。 |
| `wordKey` | string | 规范化英文。 |
| `position` | number | CSV 中原始顺序。 |
| `archived` | boolean | 是否从当前版本词包中移除。 |

#### `progress`

主键：复合键 `[profileId, wordKey]`

索引：

- `byProfileDueDate`：`[profileId, nextReviewDate]`
- `byProfileMastery`：`[profileId, currentlyMastered]`
- `byProfileLongTerm`：`[profileId, longTermMastered]`

| 字段 | 类型 | 初始值 | 说明 |
|---|---|---:|---|
| `profileId` | string | - | 所属孩子。 |
| `wordKey` | string | - | 单词键。 |
| `introduced` | boolean | false | 是否看过认识卡。 |
| `currentlyMastered` | boolean | false | 当前是否掌握。 |
| `longTermMastered` | boolean | false | 是否完成长期阶段。 |
| `consecutiveCorrect` | number | 0 | 连续无提示正确次数。 |
| `hasEnglishInputSuccess` | boolean | false | 本轮掌握周期内是否成功输入过英文。 |
| `reviewStage` | number/null | null | 0～6；未掌握时为 null。 |
| `nextReviewDate` | string/null | null | 本地日期 `YYYY-MM-DD`。 |
| `firstSeenAt` | timestamp/null | null | 首次展示时间。 |
| `lastReviewedAt` | timestamp/null | null | 最近答题时间。 |
| `correctCount` | number | 0 | 完全正确次数。 |
| `fuzzyCount` | number | 0 | 模糊次数。 |
| `wrongCount` | number | 0 | 错误次数。 |
| `updatedAt` | timestamp | - | 更新时间。 |

#### `attempts`

主键：自增 `id`

索引：

- `byProfileTimestamp`：`[profileId, timestamp]`
- `byProfileWord`：`[profileId, wordKey]`
- `bySessionId`：`sessionId`

记录每次已提交答题。字段包括：

- `profileId`
- `wordKey`
- `sessionId`
- `timestamp`
- `localDate`
- `questionType`
- `rawAnswer`（可选；第一版可只保存在设备本地）
- `normalizedAnswer`
- `result`：`correct/fuzzy/wrong/revealed`
- `hintLevel`
- `responseDurationMs`
- `reviewStageBefore`
- `reviewStageAfter`

#### `sessions`

主键：`id`

索引：`byProfileStartedAt`：`[profileId, startedAt]`

保存本轮摘要和恢复信息：

- `profileId`
- `status`：`active/completed/abandoned`
- `startedAt`
- `endedAt`
- `taskQueue`
- `currentIndex`
- `summary`

### 8.3 数据隔离约束

1. 所有与孩子有关的查询必须显式传入 `profileId`。
2. Repository 不提供“不带 `profileId` 获取全部学习数据”的普通业务方法。
3. 对 `words`、`progress` 的写入必须使用 `[profileId, wordKey]` 复合键。
4. `pack.profileId`、`packWord.profileId` 和目标档案必须在事务中一致。
5. 恢复备份时也要执行相同的关系校验。

---

## 9. Repository 与事务边界

### 9.1 Repository 接口示例

```js
ProfileRepository.get(profileId)
ProfileRepository.list()
ProfileRepository.update(profile)

PackRepository.listByProfile(profileId)
PackRepository.getActive(profileId)
PackRepository.importPack(profileId, parsedPack, mode)
PackRepository.updatePack(profileId, packId, parsedPack)
PackRepository.deleteUnstartedPack(profileId, packId)
PackRepository.switchActivePack(profileId, packId)
PackRepository.completeAndUnlockNext(profileId, packId)

WordRepository.get(profileId, wordKey)
WordRepository.listByPack(profileId, packId)

ProgressRepository.get(profileId, wordKey)
ProgressRepository.listDue(profileId, localDate)
ProgressRepository.applyAttempt(attempt, transition)
```

### 9.2 必须原子执行的事务

以下操作必须在单个读写事务中完成：

1. 导入一个词包：写入 `packs`、`words`、`packWords` 和初始 `progress`。
2. 提交一道题：写入 `attempts`、更新 `progress`、更新 `sessions`。
3. 词包通关：更新当前词包状态并解锁下一个词包。
4. 删除尚未开始的词包：更新 `packs`、`packWords` 和受影响的 `sessions`，保留 `progress`。
5. 切换当前词包：同一事务中撤下旧 `active`、激活目标词包并终止旧的新词会话。
6. 完整恢复：验证通过后替换所有业务仓库数据。

任何事务失败都不得留下部分写入。

---

## 10. 日期与时间处理

### 10.1 时间表示

- 事件时间使用 UTC ISO timestamp，例如答题时间和导入时间。
- 复习到期日使用设备当地日期字符串 `YYYY-MM-DD`。
- 不使用 `toISOString().slice(0, 10)` 生成当地日期，因为它基于 UTC。
- 统一通过 `DateService` 生成、比较和增加当地日历天数。

### 10.2 DateService 接口

```js
DateService.todayLocal()
DateService.addLocalDays(localDate, days)
DateService.compareLocalDates(a, b)
DateService.toTimestamp(date)
```

增加天数时使用本地日历日期构造，避免夏令时或时区变化导致少一天、多一天。

### 10.3 设备日期变化

- 如果设备日期向前调整，到期任务按新的今天正常出现。
- 如果设备日期向后调整，不允许生成负间隔。
- `nextReviewDate` 不因单纯打开应用而改变，只在有效答题状态转换后改变。

---

## 11. 单词与答案规范化

### 11.1 单词键

```js
function normalizeWordKey(value) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
}
```

`wordKey` 用于去重和主键；原始、经过清理但保留正常大小写的 `word` 用于显示。

### 11.2 英文答案

比较前执行：

1. Unicode NFKC 规范化；
2. 去除首尾空格；
3. 转小写；
4. 合并连续空格；
5. 移除末尾句号、问号和感叹号。

### 11.3 编辑距离

- 使用标准 Levenshtein Distance。
- 标准答案规范化后长度大于 3 且编辑距离为 1：`fuzzy`。
- 其他不相等情况：`wrong`。
- 编辑距离只用于结果分类和差异提示，不用于判定完全正确。
- 字符差异高亮算法需要安全转义输出，不得拼接未经处理的 HTML。

---

## 12. CSV 解析与导入管线

### 12.1 文件选择

```html
<input
  type="file"
  accept=".csv,text/csv"
  multiple
>
```

电脑端额外实现 drag-and-drop。拖入文件后仍走同一套校验管线。

### 12.2 导入管线

```text
选择文件
→ 按文件名自然排序
→ 读取 UTF-8 文本
→ 移除 BOM
→ CSV 状态机解析
→ 表头映射
→ 行级校验
→ 单文件内部去重
→ 与目标孩子现有词库比较
→ 展示导入预览
→ 用户确认导入模式
→ IndexedDB 原子写入
→ 输出导入报告
```

### 12.3 CSV 状态机

解析器至少支持：

- `CRLF` 和 `LF` 换行
- 双引号包裹字段
- 字段中的逗号
- 字段中的换行
- 用两个双引号表示字段中的一个双引号
- UTF-8 BOM
- 空行

禁止使用简单的 `line.split(',')`。

### 12.4 文件编码

浏览器使用 `File.text()` 读取。若文本包含大量 Unicode 替换字符或关键表头无法识别，提示用户将文件另存为 UTF-8 CSV。第一版不承诺自动识别 GBK 等编码。

### 12.5 自然排序

使用：

```js
new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
```

因此 `2_词包.csv` 排在 `10_词包.csv` 前。

### 12.6 导入预览模型

```js
{
  fileName,
  proposedPackName,
  validRows,
  emptyRows,
  duplicateRows,
  mergedMeanings,
  errors: [{ rowNumber, code, message }],
  existingPackMatch,
}
```

### 12.7 重复释义合并

1. 将中文释义按中文分号和英文分号拆分。
2. 去除首尾空格和空项。
3. 保留首次出现顺序并去重。
4. 使用中文分号重新连接用于显示。

### 12.8 同名词包更新

- 不仅依赖文件名自动覆盖，必须让用户明确选择。
- 更新时以 `wordKey` 对齐旧记录。
- 不变单词保留 `progress`。
- 新单词创建初始 `progress`。
- 移除单词只把对应 `packWords.archived` 设为 `true`。
- 若单词仍属于其他词包，绝不删除它的 `words` 或 `progress`。
- 已有 `progress` 整条记录保持不变，尤其不得写入或重算 `nextReviewDate`。
- 已通关词包不做覆盖更新，避免新增词无法进入新词队列。

### 12.9 删除与切换词包

- 词包第一次完成新词介绍时写入 `startedAt`；只有 `startedAt = null` 的未通关词包可删除。
- 删除仅移除 `packs` 和对应 `packWords`，不删除 `words` 或 `progress`。
- 切换时目标词包成为唯一 `active`，原 `active` 变为 `available`。
- 删除和切换都不得读写已有单词的复习阶段与 `nextReviewDate`。

---

## 13. 单词掌握状态机

### 13.1 状态

```text
UNSEEN
  │ 展示认识卡
  ▼
LEARNING
  │ 连续两次无提示正确，且至少一次输入英文
  ▼
MASTERED_CURRENT
  │ 通过 1/2/4/7/15/30/60 天阶段
  ▼
MASTERED_LONG_TERM
```

错误转移：

```text
LEARNING --错误/看答案--> LEARNING，连续正确清零
MASTERED_CURRENT --错误/看答案--> LEARNING，阶段重置
MASTERED_LONG_TERM --错误/看答案--> LEARNING，长期掌握取消
```

模糊结果不算正确，并触发当前轮补救练习。

### 13.2 当前掌握判定

```js
const canBecomeMastered =
  progress.consecutiveCorrect >= CONFIG.masteryCorrectStreak &&
  progress.hasEnglishInputSuccess;
```

`hasEnglishInputSuccess` 在以下情况重置为 `false`：

- 新建进度；
- 已掌握单词答错或查看答案，重新进入学习；
- 家长重置学习进度。

### 13.3 少量单词词包

队列重排优先间隔 3 道其他题。如果没有足够题目：

- 将该单词放到当前队列末尾；
- 第二次测试尽量切换题型；
- 不要求等待固定分钟数。

因此只有 1～3 个单词的词包仍可在一次学习中通关。

---

## 14. 复习阶段算法

### 14.1 阶段语义

`reviewStage` 表示“当前正在等待完成的阶段”：

| `reviewStage` | 本次到期前的间隔 |
|---:|---:|
| 0 | 1 天 |
| 1 | 2 天 |
| 2 | 4 天 |
| 3 | 7 天 |
| 4 | 15 天 |
| 5 | 30 天 |
| 6 | 60 天 |

首次达到当前掌握时：

```js
reviewStage = 0;
nextReviewDate = addLocalDays(today, 1);
```

### 14.2 到期复习完全正确

```js
function passScheduledReview(progress, today) {
  if (progress.reviewStage === 6) {
    progress.longTermMastered = true;
    progress.nextReviewDate = addLocalDays(today, 90);
    return;
  }

  progress.reviewStage += 1;
  const days = CONFIG.reviewIntervalsDays[progress.reviewStage];
  progress.nextReviewDate = addLocalDays(today, days);
}
```

### 14.3 模糊结果

模糊包括轻微拼写错误、使用提示后答对或中文自评“有点模糊”。处理规则：

1. 保持 `currentlyMastered = true`，避免把接近正确等同于完全遗忘。
2. 设置本轮临时标记 `needsRemediation = true`。
3. 放回当前队列稍后再次测试。
4. 本轮后续无提示答对时，清除临时标记。
5. 复习阶段回退一级，最低为阶段 0；下一次日期使用回退后阶段对应的间隔。

```js
reviewStage = Math.max((reviewStage ?? 0) - 1, 0);
nextReviewDate = addLocalDays(
  today,
  CONFIG.reviewIntervalsDays[reviewStage]
);
```

这一定义消除了“回退一级”和“固定第二天复习”同时存在时的歧义：实现以“回退一级后的阶段间隔”为准。阶段 0 或 1 的模糊结果会很快再次复习；高阶段单词不会因为一次接近正确而完全归零。

### 14.4 错误或查看答案

```js
currentlyMastered = false;
longTermMastered = false;
consecutiveCorrect = 0;
hasEnglishInputSuccess = false;
reviewStage = null;
nextReviewDate = null;
```

单词进入本轮补救队列。重新满足“两次无提示正确且至少一次输入英文”后，重新从 1 天阶段开始。

### 14.5 词包通关检查

每次单词新达到 `currentlyMastered = true` 后执行：

```text
读取当前 active 词包的全部未归档单词
→ 检查每个单词的 currentlyMastered
→ 若全部为 true，则在同一事务中：
   1. active 词包设为 completed
   2. 记录 completedAt
   3. 下一个 locked 词包设为 available
```

已通关词包不因之后的错误回退为未通关。

---

## 15. 学习会话与队列

### 15.1 会话任务结构

```js
{
  id,
  profileId,
  wordKey,
  source: 'review' | 'new' | 'remediation',
  kind: 'intro' | 'question',
  questionType,
  attemptNumber,
  needsEnglishInput,
}
```

### 15.2 初始队列生成

```text
查询所有 nextReviewDate <= today 的到期词
→ 按逾期天数、错误次数、最近学习时间排序
→ 生成复习题
→ 判断是否允许加入新词
→ 从 active 词包按 position 获取未介绍新词
→ 为每个新词生成 intro + 首次 question
→ 对题目做受约束的交错排列
```

如果到期词数大于 `newWordsPerSession * 2`，本轮只生成复习任务。

### 15.3 题型选择

题型选择器接收：

- 单词当前状态
- 上一次题型
- 是否需要满足英文输入条件
- 语音是否可用
- 配置权重

规则优先级：

1. 尚未成功输入过英文的学习周期，强制选择英文输入题。
2. 语音不可用时排除听写题。
3. 避免连续两次使用相同题型。
4. 其余按 50/30/20 权重抽样。

为保证测试可重复，随机数生成器应可注入；测试使用固定种子或固定返回值。

### 15.4 重新入队

```js
function requeue(task, queue, currentIndex) {
  const target = Math.min(currentIndex + 1 + CONFIG.requeueGap, queue.length);
  queue.splice(target, 0, createFollowUpTask(task));
}
```

如果剩余任务少于 3 个，任务进入队尾。跟进任务尽量使用不同题型。

### 15.5 提交一道题

```text
冻结提交按钮，防止重复提交
→ AnswerEvaluator 生成结果
→ ReviewEngine 计算状态转换
→ 构造 attempt
→ 单个 IndexedDB 事务写 attempt/progress/session
→ 检查词包是否通关
→ 根据结果决定是否重新入队
→ 渲染反馈
→ 用户点击下一个
```

只有事务成功后才把界面推进到下一题。事务失败时保留当前题和输入，允许重试。

---

## 16. 发音服务

### 16.1 接口

```js
SpeechService.isAvailable()
SpeechService.loadVoices()
SpeechService.speak(text, { rate })
SpeechService.stop()
```

### 16.2 语音选择

1. 优先语言为 `en-US` 或 `en-GB` 的本地语音。
2. 其次选择任意 `en-*` 语音。
3. 没有英语语音时返回不可用状态。
4. 监听 `voiceschanged`，因为 Safari 和其他浏览器可能异步提供语音列表。

### 16.3 并发与失败

- 播放新发音前先调用 `speechSynthesis.cancel()`。
- 页面切换、孩子切换或离开学习页时停止朗读。
- 朗读超时或报错时恢复按钮状态。
- 听写题开始前确认语音可用，否则替换为看中文输入英文题。

---

## 17. UI 状态管理

### 17.1 单一应用状态

```js
const appState = {
  route,
  activeProfileId,
  activeProfile,
  activePack,
  dashboard,
  session,
  capabilities,
  busy,
  error,
};
```

业务真相保存在 IndexedDB；`appState` 只保存当前页面需要的投影和短期 UI 状态。

### 17.2 路由

第一版可以使用 hash 路由：

```text
#/profiles
#/home
#/study
#/result
#/packs
#/report
#/settings
```

路由守卫：

- 未选择孩子时，除 `#/profiles` 外全部重定向到选择页。
- 没有 active session 时进入 `#/study`，先生成会话。
- 切换孩子前停止语音并保存当前 session。

### 17.3 防重复操作

导入、提交答案、恢复备份、删除和重置期间：

- 禁用触发按钮；
- 显示处理中状态；
- 操作完成或失败后恢复；
- 同一个 command 不允许并行执行。

---

## 18. 响应式与可访问性

### 18.1 布局断点

- 小屏：小于 600px，单列布局。
- 中屏：600～1023px，适配 iPad 竖屏和横屏。
- 大屏：大于等于 1024px，内容居中并限制最大宽度。

### 18.2 触摸与键盘

- 交互目标最小 44 × 44 CSS px。
- 输入题按 Enter 提交；反馈态按 Enter 进入下一题。
- 焦点必须有明显样式。
- 弹窗打开后焦点进入弹窗，关闭后回到触发按钮。
- iPad 软键盘弹出时，输入框和提交按钮不能被遮挡。

### 18.3 视觉状态

- 正确、模糊、错误同时使用颜色、图标和文字。
- 不使用红绿颜色作为唯一差异。
- 尊重 `prefers-reduced-motion`，减少非必要动画。
- 通关动画不得阻塞继续操作。

---

## 19. 学习统计

### 19.1 聚合策略

- 当前词包进度从 `packWords + progress` 查询。
- 七天正确率从 `attempts.byProfileTimestamp` 查询并聚合。
- 高频错词从指定时间范围内的 attempt 计数生成。
- 首页只查询必要摘要，不加载全部答题历史。

### 19.2 学习时长

使用活动计时器：

- 页面可见且最近 2 分钟有点击、键盘或触摸操作时计时。
- 页面进入后台或超过 2 分钟无操作时暂停。
- 每 30 秒或页面隐藏时保存累计时长。

### 19.3 连续学习天数

按 `attempt.localDate` 去重生成学习日期集合。某日存在至少一次已提交答题即算学习一天。

---

## 20. 备份格式与恢复

### 20.1 文件结构

```json
{
  "format": "word-hero-backup",
  "schemaVersion": 1,
  "exportedAt": "UTC ISO timestamp",
  "appVersion": "1.0.0",
  "data": {
    "profiles": [],
    "packs": [],
    "words": [],
    "packWords": [],
    "progress": [],
    "attempts": [],
    "sessions": []
  }
}
```

建议文件名：

```text
单词小勇士备份_YYYY-MM-DD.json
```

### 20.2 导出流程

```text
读取所有仓库快照
→ 生成备份对象
→ JSON.stringify
→ 创建 application/json Blob
→ 触发浏览器下载/保存
→ 保存 lastBackupAt
```

### 20.3 恢复验证

恢复前验证：

1. JSON 可解析。
2. `format` 正确。
3. `schemaVersion` 受支持或存在迁移函数。
4. 必填集合存在且为数组。
5. 恰好包含两个有效档案，或能明确映射到两个档案槽位。
6. 所有 `profileId`、`packId` 和 `wordKey` 引用完整。
7. 枚举值、日期和数字范围有效。
8. 不存在跨档案的词包关系。

### 20.4 原子恢复

- 先在内存中完成全部验证和迁移。
- 获取现有数据快照或至少保持事务未提交。
- 在覆盖事务中清空并写入所有业务仓库。
- 任一写入失败则中止整个事务，保留原数据。
- 成功后重载应用状态。

第一版只提供“完整覆盖恢复”，不实现复杂合并恢复。

---

## 21. 数据迁移

每次数据库结构升级：

1. 在 IndexedDB `onupgradeneeded` 中创建或修改对象仓库和索引。
2. 对需要遍历转换的大量数据使用可恢复的应用级迁移。
3. 迁移前不删除旧字段。
4. 迁移成功后更新 `schemaVersion`。
5. 迁移失败时提示用户，不允许用空数据库覆盖旧数据。

迁移函数命名示例：

```js
migrateV1ToV2(data)
migrateV2ToV3(data)
```

所有迁移必须有旧数据样本测试。

---

## 22. 错误模型与日志

### 22.1 错误类型

```js
AppError
├── code
├── userMessage
├── technicalMessage
├── recoverable
└── cause
```

错误码示例：

- `DB_OPEN_FAILED`
- `DB_WRITE_FAILED`
- `CSV_MISSING_HEADER`
- `CSV_INVALID_ROW`
- `IMPORT_TRANSACTION_FAILED`
- `BACKUP_INVALID_FORMAT`
- `BACKUP_UNSUPPORTED_VERSION`
- `RESTORE_TRANSACTION_FAILED`
- `SPEECH_UNAVAILABLE`

### 22.2 用户消息

- 用户只看到原因、影响和下一步。
- CSV 行错误应包含文件名和行号。
- 存储写入失败时不得继续显示“学习完成”。
- 可恢复错误提供“重试”。

### 22.3 本地诊断日志

第一版可以在内存中保留最近 100 条非敏感诊断事件，不上传。不要记录孩子完整答案或备份内容到控制台。

---

## 23. 安全与隐私

1. 所有 CSV 和备份文本通过 `textContent` 显示，不使用未转义的 `innerHTML`。
2. 不执行 CSV 或备份中包含的任何代码或标记。
3. 对文件大小、行数和字符串长度设置合理上限，防止页面被异常文件拖垮。
4. 建议默认上限：单文件 10 MB、单文件 10,000 行、单字段 2,000 字符。
5. 超限时拒绝导入并给出原因。
6. 不向外部分析服务发送学习数据。
7. 不申请麦克风权限。
8. 删除档案数据和完整恢复必须二次确认。
9. 应用部署时使用 HTTPS，并设置合理的 Content Security Policy。

建议 CSP 起点：

```text
default-src 'self';
img-src 'self' data:;
style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-inline';
connect-src 'none';
media-src 'self' blob:;
object-src 'none';
base-uri 'none';
frame-ancestors 'none'
```

若静态托管平台不能设置响应头，可使用等效的 `<meta http-equiv>`，但 `frame-ancestors` 等能力仍应由响应头配置。

---

## 24. 性能设计

1. 词包列表和报告只查询当前档案。
2. 使用 IndexedDB 索引查询到期词，不全表扫描。
3. 大批量导入每 200～500 行让出一次事件循环，更新进度提示。
4. 导入写入使用单个事务和批量请求。
5. 不在每次按键时写 IndexedDB，只在提交答案时写入。
6. 报告页聚合期间显示骨架或加载状态。
7. 超长词表使用分页或虚拟列表；第一版词包详情每页建议 100 条。
8. `attempts` 长期增长时仍通过索引按日期范围查询。

---

## 25. 测试策略

### 25.1 单元测试

必须覆盖：

- `normalizeWordKey`
- 英文答案规范化
- Levenshtein 分类
- 本地日期增加和比较
- 复习阶段 0～6 的正确升级
- 模糊回退
- 错误重置
- 两次无提示正确的掌握条件
- 题型选择约束
- CSV 引号、逗号、换行、BOM 和空行
- 重复释义合并

### 25.2 集成测试

必须覆盖：

- IndexedDB 初始化和迁移
- 单词提交事务
- 多 CSV 导入事务
- 更新词包保留进度
- 通关词包和解锁下一个词包的原子操作
- 两个 `profileId` 的数据隔离
- 导出后恢复数据等价性
- 无效备份不修改现有数据

### 25.3 端到端测试

主要流程：

1. 选择五年级孩子，导入多个词包并开始学习。
2. 用小词包在同一轮完成通关并立即进入下一包。
3. 选择初三孩子，确认看不到另一孩子的词包和进度。
4. 模拟日期推进，完成完整复习阶段。
5. 在学习中刷新页面，确认已提交进度存在。
6. 导出、清空、恢复并比较核心数据。
7. 模拟语音不可用并完成替代题型。

### 25.4 真实设备测试

至少测试：

- 一台 iPad Safari：文件选择、软键盘、横竖屏、发音、添加到主屏幕、备份保存和恢复。
- 一台 Windows 或 macOS 电脑：文件选择、多选、拖放、键盘操作和备份下载。
- Chrome 或 Edge 桌面版。
- Safari 桌面版（如果可获得）。

### 25.5 时间测试

测试环境通过 `Clock` 注入日期，不通过修改真实设备时间完成自动化测试。

---

## 26. 技术验收标准

- [ ] 最终生产目录仅需一个可运行的 `index.html`。
- [ ] 页面不依赖 CDN 或后端接口。
- [ ] IndexedDB 中两个孩子的数据使用 `profileId` 隔离。
- [ ] 所有答题提交使用原子事务。
- [ ] 刷新页面后已提交记录不丢失。
- [ ] CSV 解析支持合法引号、逗号和换行。
- [ ] 复习阶段不存在多一天、少一天或阶段越界。
- [ ] 小词包可以同一轮通关，大词包可以跨多天继续。
- [ ] 已通关词包不会因旧词答错而重新锁定。
- [ ] 发音不可用时听写题能够自动降级。
- [ ] 有效备份可以完整恢复，无效备份不会修改现有数据。
- [ ] 核心算法具备自动化测试。
- [ ] iPad 和电脑真实设备验收通过。

---

## 27. 实施顺序

### 阶段 1：基础骨架

- 页面外壳与路由
- IndexedDB 初始化
- 两个默认档案
- 设置和响应式基础样式

### 阶段 2：词库

- CSV 解析器
- 多文件导入与预览
- 词包、单词、重复合并和排序
- 词包管理页

### 阶段 3：学习核心

- 答案判定
- 状态机和复习算法
- 学习队列
- 三种题型、提示和发音
- 词包通关与解锁

### 阶段 4：报告与可靠性

- 学习报告
- 备份和恢复
- 中断恢复
- 错误状态与数据保护

### 阶段 5：测试与发布

- 自动化测试
- iPad 和电脑真实设备测试
- 构建自包含 `index.html`
- 静态 HTTPS 发布

每个阶段结束后先通过对应测试，再进入下一阶段。

---

## 28. 技术决策记录

### TD-001：IndexedDB 而非只使用 localStorage

原因：学习记录、答题历史和多词包数据具有结构和规模；IndexedDB 支持索引、事务和较大容量。

### TD-002：最终单文件，开发时模块化

原因：兼顾家长使用简单和代码可维护性。最终用户只接触 `index.html`，开发者仍可分模块测试。

### TD-003：内置 CSV 状态机解析器

原因：避免运行时依赖和网络请求，同时正确处理字段内逗号和引号。

### TD-004：本地日期驱动复习

原因：产品按天安排复习，不需要精确小时；本地日期更符合用户对“今天到期”的理解。

### TD-005：词包通关不可逆

原因：旧词遗忘应该影响单词复习状态，但不应让后续已经解锁的内容突然被锁住。

### TD-006：模糊结果回退一级

原因：模糊代表记忆变弱但不等于完全遗忘。回退一级并进行本轮补救，比直接重置全部阶段更合理。

### TD-007：第一版完整覆盖恢复

原因：跨设备合并会引入冲突解决和重复历史等复杂问题；完整覆盖更容易验证且更安全。

---

## 29. 开发开始前检查清单

- [ ] 产品 Spec 与技术设计版本一致。
- [ ] 确认第一版最终产物为静态单页网页。
- [ ] 创建两个测试 CSV：小词包和百词词包。
- [ ] 准备包含逗号、引号、空行、重复词和错误行的 CSV 测试样本。
- [ ] 冻结 `CONFIG` 第一版默认值。
- [ ] 先实现并测试日期、答案判定和复习状态机。
- [ ] 再开发页面，避免 UI 先行导致规则散落。
- [ ] 在实现备份前冻结数据库 v1 结构。
