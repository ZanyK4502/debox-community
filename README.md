# Debox-community

一个面向 **OpenClaw** 的 **DeBox 社区管理 Skill**，用于查询群组信息、验证成员身份、统计投票/抽奖参与情况，并生成个人数据报告。

这个项目的目标不是做一个花哨的 demo，而是提供一套 **能真正用于社区运营和成员筛查** 的 DeBox 工具链。


## 这个 Skill 能做什么？

目前支持这些能力：

- 查询 **DeBox 群组信息**
- 验证某个钱包是否为 **群成员**
- 查询某个钱包在群内的 **投票统计**
- 查询某个钱包在群内的 **抽奖统计**
- 做一体化的 **综合验证**
- 生成 **个人数据报告**
- 生成 **图片版个人报告**

适合这些场景：

- 社区运营筛选成员
- 验证活动参与资格
- 检查钱包是否满足某个群的要求
- 快速查看用户在群内的投票 / 抽奖参与情况
- 生成可展示的个人数据海报


## 功能概览

### 1）群组信息查询
输入群链接，返回群名称、群 ID、成员数量等基础信息。

### 2）成员验证
验证某个钱包是否加入了指定 DeBox 群组。

### 3）投票统计
查询某个钱包在指定群中的投票参与次数。

### 4）抽奖统计
查询某个钱包在指定群中的抽奖参与次数、中奖次数与中奖率。

### 5）综合验证
把成员状态、投票要求、抽奖要求放在一起检查，输出是否通过。

### 6）个人数据报告
根据 `user_id` 生成文字版个人数据报告。

### 7）图片版个人报告
根据 `user_id` 生成图片版个人报告，适合展示和分享。



## 项目结构

```text
debox-community/
├── SKILL.md
├── README.md
├── package.json
├── package-lock.json
├── config.example.json
├── ClawBot.png
├── references/
│   └── api.md
└── scripts/
    └── debox-community.js
```

### 文件说明

- `SKILL.md`：OpenClaw Skill 说明与触发逻辑
- `README.md`：项目说明文档
- `package.json`：Node.js 项目配置
- `config.example.json`：配置示例文件
- `ClawBot.png`：图片版个人报告使用的 logo 资源
- `references/api.md`：DeBox API 参考资料
- `scripts/debox-community.js`：主脚本，负责实际功能执行



## 环境要求

- Node.js **18+**
- npm
- OpenClaw
- 可用的 **DeBox API Key**



## 安装方式

### 方式一：作为 OpenClaw Workspace Skill 使用

将项目放到：

```bash
~/.openclaw/workspace/skills/debox-community
```

然后安装依赖：

```bash
cd ~/.openclaw/workspace/skills/debox-community
npm install
```



## 配置方式

你可以用 **环境变量** 或 **配置文件** 两种方式配置 API Key。

### 方式一：环境变量（推荐）

```bash
export DEBOX_API_KEY="your-debox-api-key"
```

### 方式二：配置文件

先复制示例配置：

```bash
cp config.example.json config.json
```

然后编辑 `config.json`：

```json
{
  "apiKey": "your-debox-api-key",
  "defaultGroupUrl": "https://m.debox.pro/group?id=your-group-id"
}
```



## 在 OpenClaw 中启用

如果你想让 OpenClaw 自动调用这个 Skill，确保在 `openclaw.json` 中启用它，并注入环境变量，例如：

```json
{
  "skills": {
    "entries": {
      "debox-community": {
        "enabled": true,
        "env": {
          "DEBOX_API_KEY": "your-debox-api-key"
        }
      }
    }
  }
}
```

修改后重启 OpenClaw：

```bash
openclaw gateway restart
```

然后在 Dashboard 的 Skills 页面里确认它处于 `eligible` 状态。



## 命令行用法

主脚本：

```bash
node scripts/debox-community.js
```

查看帮助

```bash
node scripts/debox-community.js
```

以 JSON 形式输出

```bash
node scripts/debox-community.js --json
```



## 使用示例

### 1）查询群组信息

```bash
node scripts/debox-community.js info \
  --url "https://m.debox.pro/group?id=xxxxx"
```



2）验证成员是否在群

```bash
node scripts/debox-community.js check-member \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx"
```



3）查询投票统计

```bash
node scripts/debox-community.js vote-stats \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx"
```

JSON 输出：

```bash
node scripts/debox-community.js vote-stats \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx" \
  --json
```



4）查询抽奖统计

```bash
node scripts/debox-community.js lottery-stats \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx"
```

JSON 输出：

```bash
node scripts/debox-community.js lottery-stats \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx" \
  --json
```



5）综合验证

```bash
node scripts/debox-community.js verify \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx" \
  --min-votes 1 \
  --min-lotteries 1
```

JSON 输出：

```bash
node scripts/debox-community.js verify \
  --wallet "0xabc..." \
  --group-url "https://m.debox.pro/group?id=xxxxx" \
  --min-votes 1 \
  --min-lotteries 1 \
  --json
```



6）批量验证

先准备一个 `wallets.txt` 文件，每行一个钱包地址：

```Plain text
0x111...
0x222...
0x333...
```

然后执行：

```bash
node scripts/debox-community.js batch-verify \
  --file wallets.txt \
  --group-url "https://m.debox.pro/group?id=xxxxx"
```

你也可以自定义请求间隔：

```bash
node scripts/debox-community.js batch-verify \
  --file wallets.txt \
  --group-url "https://m.debox.pro/group?id=xxxxx" \
  --delay-ms 650
```



7）生成文字版个人报告

```bash
node scripts/debox-community.js profile \
  --user-id "your_user_id"
```



8）生成图片版个人报告

```bash
node scripts/debox-community.js profile \
  --user-id "your_user_id" \
  --image
```

指定输出文件名

```bash
node scripts/debox-community.js profile \
  --user-id "your_user_id" \
  --image \
  --output "my-profile.png"
```



## JSON 输出示例

### 投票统计示例

```json
{
  "wallet": "0xabc...",
  "groupId": "xxxxx",
  "voteStats": {
    "totalVotes": 2
  }
}
```

抽奖统计示例

```bash
{
  "wallet": "0xabc...",
  "groupId": "xxxxx",
  "lotteryStats": {
    "totalParticipated": 2,
    "totalWon": 1,
    "winRate": "50%"
  }
}
```

综合验证示例

```json
{
  "wallet": "0xabc...",
  "groupId": "xxxxx",
  "verification": {
    "passed": true,
    "checks": {
      "isMember": true,
      "voteCount": 2,
      "votesPassed": true,
      "lotteryCount": 2,
      "lotteriesPassed": true
    },
    "thresholds": {
      "minVotes": 1,
      "minLotteries": 1
    }
  }
}
```



关于 `user_id`

`profile` 功能依赖 `user_id`。
 这不是简单看个人主页昵称或钱包地址就一定能直接获得的字段。

如果你当前拿不到 `user_id`，建议：

- 先优先使用群组查询 / 成员验证 / 投票统计 / 抽奖统计 / 综合验证这些功能
- 后续再通过 DeBox 官方授权流程或相关开发方式获取 `user_id`

这一点需要根据 DeBox 的实际接口与账户体系来处理。



## 常见问题

### 1）为什么 Skill 在 OpenClaw 里显示 blocked？

通常是因为没有配置：

- `DEBOX_API_KEY`

配置好后重启 OpenClaw，并刷新 Skills 页面。



### 2）为什么明明参与过投票/抽奖，却显示 0？

这个项目曾遇到过 DeBox 返回字段映射问题。
 当前版本已经修复常见字段映射：

- 投票统计映射自 `vote_number`
- 抽奖统计映射自 `luckDraw_total`
- 中奖次数映射自 `luckDraw_win_total`

如果你仍然遇到问题，建议优先检查：

- 群链接是否正确
- 钱包地址是否正确
- API Key 是否有效
- DeBox 接口返回是否发生变化



### 3）为什么上传 GitHub 时不能带 `node_modules/`？

因为 `node_modules/` 体积大，而且可以通过 `npm install` 重新安装。
 正常上传源码时，应该忽略：

- `node_modules/`
- `config.json`
- 真实 API key
- 测试输出图片



## 开发说明

### 安装依赖

```bash
npm install
```

语法检查

```bash
node --check scripts/debox-community.js
```

测试

```bash
npm test
```



## 目前状态

当前版本已经完成这些关键修复：

- 修复投票统计字段映射错误
- 修复抽奖统计字段映射错误
- 修复综合验证中统计值误判为 0 的问题
- 增加 `--json` 输出模式
- 优化配置读取逻辑
- 优化图片生成逻辑，避免固定临时文件冲突
- 重写 `SKILL.md`，更适合 OpenClaw 自动调用



## 注意事项

请不要把这些内容提交到 GitHub：

- 真实 `DEBOX_API_KEY`
- `config.json`
- `node_modules/`
- 测试输出图片

如果你的 API Key 已经暴露，请尽快去 DeBox 开发者后台重置。



## 致谢

这个项目是在真实排错、真实调试、真实社区验证需求中一点点改出来的。

 如果你也在折腾 OpenClaw Skill、DeBox 社区自动化、或者 Web3 社区工具，欢迎交流。  
 
 [**Debox 官方开发者文档**](https://docs.debox.pro/zh/UserGuide)     [**OpenClaw 官方开发者文档**](https://docs.openclaw.ai/) 
