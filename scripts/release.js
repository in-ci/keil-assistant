#!/usr/bin/env node

/**
 * Keil Assistant - 一键发布自动化脚本 (One-click GitHub Release Automation)
 *
 * 功能：
 * 1. 验证工作区状态与代码规范、执行单元测试；
 * 2. 自动打包生成 .vsix 安装包；
 * 3. 自动从 CHANGELOG.md 提取当前版本的变更说明；
 * 4. 自动创建附注 Git Tag 并推送到 GitHub 远程仓库；
 * 5. 通过 Git 凭据管理器或环境变量安全获取 GitHub 授权 Token；
 * 6. 调用 GitHub 官方 REST API 创建 Release 并上传 .vsix 资产。
 *
 * 用法：
 *   pnpm run release              # 标准完整发布流程
 *   pnpm run release --dry-run    # 演练模式（仅检查与构建，不创建 Tag、不调用 GitHub API 发布）
 *   pnpm run release --skip-tests # 跳过单元测试阶段
 *   pnpm run release --skip-build # 跳过本地打包阶段（复用已生成的 .vsix）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const cp = require('child_process');

// 终端彩色高亮工具
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(msg) {
  console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`);
}
function success(msg) {
  console.log(`${colors.green}✔${colors.reset} ${colors.bright}${msg}${colors.reset}`);
}
function warn(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}
function error(msg) {
  console.error(`${colors.red}✖ ${msg}${colors.reset}`);
}
function step(title) {
  console.log(`\n${colors.bright}${colors.blue}==>${colors.reset} ${colors.bright}${title}${colors.reset}`);
}

function execCmd(command, args = [], options = {}) {
  const fullCmd = [command, ...args].join(' ');
  const res = cp.spawnSync(fullCmd, {
    stdio: options.silent ? 'pipe' : 'inherit',
    shell: true,
    encoding: 'utf8',
    ...options
  });
  if (res.status !== 0) {
    const err = new Error(`Command failed [exit ${res.status}]: ${fullCmd}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    err.status = res.status;
    throw err;
  }
  return res.stdout ? res.stdout.trim() : '';
}

function getRepoInfo() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  let repoUrl = (pkg.repository && pkg.repository.url) || '';
  if (!repoUrl) {
    try {
      repoUrl = execCmd('git', ['remote', 'get-url', 'origin'], { silent: true });
    } catch (e) {
      // fallback
    }
  }
  // 解析形如 https://github.com/owner/repo.git 或 git@github.com:owner/repo.git
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
  if (!match) {
    throw new Error(`Cannot parse GitHub owner and repository name from URL: ${repoUrl}`);
  }
  return {
    owner: match[1],
    repo: match[2],
    version: pkg.version,
    name: pkg.name,
    displayName: pkg.displayName || pkg.name
  };
}

function getGithubToken() {
  // 1. 优先从环境变量读取
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return Promise.resolve(process.env.GITHUB_TOKEN.trim());
  }

  // 2. 从 Git 凭据管理器（Git Credential Manager）获取
  return new Promise((resolve, reject) => {
    const p = cp.spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', code => {
      const line = out.split('\n').find(l => l.startsWith('password='));
      if (line) {
        resolve(line.slice('password='.length).trim());
      } else {
        reject(new Error('未在系统 Git 凭据管理器或 GITHUB_TOKEN 环境变量中找到 GitHub 访问凭据。'));
      }
    });
    p.stdin.write('protocol=https\nhost=github.com\n\n');
  });
}

function requestJson(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Keil-Assistant-Release-Bot',
        ...(options.headers || {})
      }
    };

    const req = https.request(reqOptions, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error(`GitHub API Error [HTTP ${res.statusCode}]: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

function uploadAsset(uploadUrl, filePath, token) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const rawUrl = uploadUrl.replace(/\{(\?name,label|.*)\}/, `?name=${encodeURIComponent(fileName)}`);
    const u = new URL(rawUrl);

    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Keil-Assistant-Release-Bot',
        'Authorization': `token ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`上传 Release 资产失败 [HTTP ${res.statusCode}]: ${body}`));
        }
      });
    });

    req.on('error', reject);
    const stream = fs.createReadStream(filePath);
    stream.pipe(req);
  });
}

function extractChangelog(version) {
  if (!fs.existsSync('CHANGELOG.md')) {
    return `Release v${version}`;
  }
  const content = fs.readFileSync('CHANGELOG.md', 'utf8');
  // 匹配类似 ## [v2.0.0] 或 ## [2.0.0] 的小节
  const escapedVer = version.replace(/\./g, '\\.');
  const regex = new RegExp(`##\\s*\\[v?${escapedVer}\\][^\n]*\n([\\s\\S]*?)(?=\\n##\\s*\\[|\\Z)`, 'i');
  const match = content.match(regex);
  if (match) {
    let notes = match[1].trim();
    // 移除尾部水平分隔线 ***
    notes = notes.replace(/\n\*{3,}\s*$/, '').trim();
    return notes;
  }
  return `Release v${version}`;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const skipTests = args.includes('--skip-tests');
  const skipBuild = args.includes('--skip-build');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
${colors.bright}Keil Assistant 一键自动化发布工具${colors.reset}

用法:
  pnpm run release [选项]

选项:
  --dry-run       演练模式：执行全部检查与打包，但不推送到 Git 远程与 GitHub Release
  --skip-tests    跳过运行单元测试 (vscode-test)
  --skip-build    跳过本地打包步骤，复用已有 .vsix 文件
  --help, -h      显示帮助信息
`);
    process.exit(0);
  }

  console.log(`\n${colors.bright}${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.bright}  🚀 Keil Assistant 自动化一键发布  ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}========================================${colors.reset}`);

  // 1. 获取项目与仓库元信息
  step('1. 检查项目元数据与仓库配置');
  const info = getRepoInfo();
  const tagName = `v${info.version}`;
  const vsixFileName = `${info.name}-${info.version}.vsix`;
  const vsixPath = path.resolve(vsixFileName);
  log(`项目名称: ${info.name} (${info.displayName})`);
  log(`目标版本: ${info.version} (Tag: ${tagName})`);
  log(`GitHub 仓库: ${info.owner}/${info.repo}`);
  if (isDryRun) {
    warn('当前为 [演练模式 (--dry-run)]，将不会修改远程 Git 与发布线上 Release');
  }

  // 2. 检查 Git 工作区状态
  step('2. 检查 Git 工作区状态');
  const currentBranch = execCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { silent: true });
  log(`当前工作分支: ${currentBranch}`);
  const gitStatus = execCmd('git', ['status', '--porcelain'], { silent: true });
  if (gitStatus) {
    warn('当前工作区存在未提交的更改:');
    console.log(gitStatus);
    warn('建议先提交所有代码改动后再执行发布。继续执行发布流程...');
  } else {
    success('Git 工作区干净');
  }

  // 3. 运行代码检查与单元测试
  step('3. 执行类型检查与质量验证');
  log('正在执行: pnpm run check (tsc + oxlint)...');
  execCmd('pnpm', ['run', 'check']);
  success('TypeScript 类型检查与 Oxlint 扫描 0 错误 0 警告');

  if (!skipTests) {
    log('正在执行: pnpm test (单元测试套件)...');
    execCmd('pnpm', ['test']);
    success('全套单元测试顺利通过');
  } else {
    warn('已跳过单元测试 (--skip-tests)');
  }

  // 4. 打包 VSIX
  step('4. 构建 VSIX 安装包');
  if (!skipBuild) {
    log('正在执行: pnpm run package (vsce 打包)...');
    execCmd('pnpm', ['run', 'package']);
    success(`VSIX 安装包构建完成: ${vsixFileName}`);
  } else {
    warn(`已跳过本地构建 (--skip-build)，使用现有安装包`);
  }

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`找不到构建生成的 VSIX 文件: ${vsixPath}`);
  }
  const vsixStat = fs.statSync(vsixPath);
  success(`确认安装包资产: ${vsixFileName} (${(vsixStat.size / 1024).toFixed(1)} KB)`);

  // 5. 提取变更日志
  step('5. 提取版本更新日志');
  const changelogNotes = extractChangelog(info.version);
  log(`成功解析 v${info.version} 变更说明 (${changelogNotes.length} 字符):`);
  console.log(`${colors.dim}----------------------------------------${colors.reset}`);
  console.log(changelogNotes.slice(0, 300) + (changelogNotes.length > 300 ? '\n...(略)' : ''));
  console.log(`${colors.dim}----------------------------------------${colors.reset}`);

  // 6. Git 标签创建与推送
  step('6. Git 标签与远程分支同步');
  const existingTags = execCmd('git', ['tag', '-l', tagName], { silent: true });
  if (!existingTags) {
    if (!isDryRun) {
      log(`创建 Git 附注标签: ${tagName}...`);
      execCmd('git', ['tag', '-a', tagName, '-m', `Release ${tagName}`]);
      success(`成功创建本地标签: ${tagName}`);
    } else {
      warn(`[Dry-Run] 模拟创建标签: ${tagName}`);
    }
  } else {
    log(`本地已存在标签: ${tagName}`);
  }

  if (!isDryRun) {
    log(`推送分支 [${currentBranch}] 和标签 [${tagName}] 至 GitHub...`);
    execCmd('git', ['push', 'origin', currentBranch]);
    execCmd('git', ['push', 'origin', tagName]);
    success('分支与标签已全部推送到 GitHub 远程仓库');
  } else {
    warn(`[Dry-Run] 模拟推送分支与标签至 GitHub`);
  }

  // 7. GitHub API 认证
  step('7. GitHub 授权与鉴权校验');
  let token = '';
  if (!isDryRun) {
    token = await getGithubToken();
    const user = await requestJson('https://api.github.com/user', {
      headers: { 'Authorization': `token ${token}` }
    });
    if (!user || !user.login) {
      throw new Error('GitHub 鉴权失败，无法识别当前用户身份');
    }
    success(`成功以 GitHub 用户身份鉴权: ${colors.bright}${user.login}${colors.reset}`);
  } else {
    warn(`[Dry-Run] 跳过 GitHub API 鉴权`);
  }

  // 8. 创建或更新 Release
  step('8. 发布 GitHub Release');
  const releaseTitle = `Keil Assistant ${tagName}`;
  const releaseBody = `## 🚀 ${releaseTitle} 发布日志\n\n${changelogNotes}\n\n---\n\n### 📦 快速安装 (VSIX)\n1. 下载下方 Assets 中的 \`${vsixFileName}\`；\n2. 打开 VS Code，按下 \`Ctrl+Shift+P\`；\n3. 选择 \`Extensions: Install from VSIX...\` 并载入本文件即可。\n`;

  if (isDryRun) {
    warn('[Dry-Run] 模拟发布完成！以下是待发布的 Release 正文预览:');
    console.log(releaseBody);
    return;
  }

  // 检查 Release 是否已存在
  const repoApi = `https://api.github.com/repos/${info.owner}/${info.repo}`;
  log(`检查线上是否已存在 Release: ${tagName}...`);
  let release = await requestJson(`${repoApi}/releases/tags/${tagName}`, {
    headers: { 'Authorization': `token ${token}` }
  });

  if (!release) {
    log(`正在创建全新 Release: ${tagName}...`);
    release = await requestJson(`${repoApi}/releases`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      }
    }, {
      tag_name: tagName,
      target_commitish: currentBranch,
      name: releaseTitle,
      body: releaseBody,
      draft: false,
      prerelease: false
    });
    success(`Release 创建成功! Release ID: ${release.id}`);
  } else {
    log(`检测到已存在 Release (ID: ${release.id})，正在更新描述...`);
    release = await requestJson(`${repoApi}/releases/${release.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      }
    }, {
      name: releaseTitle,
      body: releaseBody
    });
    success(`Release 信息更新成功!`);
  }

  // 9. 上传 VSIX 资产
  step('9. 上传 VSIX 资产包到 Release');
  // 若已存在同名资产，先清理旧资产
  if (release.assets && release.assets.length > 0) {
    const existingAsset = release.assets.find(a => a.name === vsixFileName);
    if (existingAsset) {
      log(`发现同名已有资产 (ID: ${existingAsset.id})，正在清理旧版本...`);
      await requestJson(`${repoApi}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `token ${token}` }
      });
      success('旧资产已清理完成');
    }
  }

  log(`正在上传安装包: ${vsixFileName} (${(vsixStat.size / 1024).toFixed(1)} KB)...`);
  const uploadedAsset = await uploadAsset(release.upload_url, vsixPath, token);
  success(`安装包上传成功! 资产 ID: ${uploadedAsset.id}`);

  // 10. 完成汇报
  console.log(`\n${colors.bright}${colors.green}========================================${colors.reset}`);
  console.log(`${colors.bright}${colors.green}  🎉 发布成功 (Release Published Successfully)!  ${colors.reset}`);
  console.log(`${colors.bright}${colors.green}========================================${colors.reset}`);
  console.log(`\n🔗 ${colors.bright}Release 页面:${colors.reset} ${colors.cyan}${release.html_url}${colors.reset}`);
  console.log(`⬇️  ${colors.bright}VSIX 下载直链:${colors.reset} ${colors.cyan}${uploadedAsset.browser_download_url}${colors.reset}\n`);
}

main().catch(err => {
  error(`发布失败: ${err.message}`);
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
});
