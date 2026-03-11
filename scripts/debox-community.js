#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEBOX_API_BASE = 'https://open.debox.pro/openapi';
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const DEFAULT_GROUP_URL_PREFIX = 'https://m.debox.pro/group?id=';
const DEFAULT_BATCH_DELAY_MS = 650;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

let cachedConfig = null;
let cliArgs = [];

class CliError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CliError';
    Object.assign(this, details);
  }
}

class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, details);
  }
}

function setCliArgs(args) { cliArgs = Array.isArray(args) ? args : []; }
function hasFlag(flag) { return cliArgs.includes(flag); }
function getArg(flag) {
  const index = cliArgs.indexOf(flag);
  if (index === -1) return null;
  const value = cliArgs[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CliError(`Missing value for ${flag}`, { code: 'ARG_MISSING', flag });
  }
  return value;
}

function getIntArg(flag, defaultValue) {
  const rawValue = getArg(flag);
  if (rawValue === null) return defaultValue;
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) {
    throw new CliError(`Invalid integer for ${flag}: ${rawValue}`, {
      code: 'ARG_INVALID',
      flag,
      value: rawValue
    });
  }
  return parsedValue;
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}
function safeText(value, fallback = '-') {
  const text = firstDefined(value);
  return text === null ? fallback : String(text);
}
function toBoolean(...values) {
  for (const value of values) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
  }
  return false;
}
function toInt(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsedValue = Number.parseInt(String(value), 10);
    if (!Number.isNaN(parsedValue)) return parsedValue;
  }
  return 0;
}
function toArray(value) { return Array.isArray(value) ? value : []; }
function truncateEnd(value, maxLength) {
  const text = safeText(value, '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
function truncateMiddle(value, startLength = 10, endLength = 6) {
  const text = safeText(value, '-');
  if (text.length <= startLength + endLength + 3) return text;
  return `${text.slice(0, startLength)}...${text.slice(-endLength)}`;
}
function escapeXml(value) {
  return safeText(value, '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '\'': '&apos;',
    '"': '&quot;'
  }[char]));
}

function groupIdToUrl(groupId) {
  const normalizedGroupId = safeText(groupId, '').trim();
  if (!normalizedGroupId) return null;
  if (normalizedGroupId.startsWith('http://') || normalizedGroupId.startsWith('https://')) return normalizedGroupId;
  return `${DEFAULT_GROUP_URL_PREFIX}${encodeURIComponent(normalizedGroupId)}`;
}

function extractGroupId(groupValue) {
  const candidate = safeText(groupValue, '').trim();
  if (!candidate) return null;
  try {
    const parsedUrl = new URL(candidate);
    return parsedUrl.searchParams.get('id')
      || parsedUrl.searchParams.get('group_id')
      || parsedUrl.pathname.split('/').filter(Boolean).pop()
      || candidate;
  } catch (_) {
    return candidate;
  }
}

function loadConfig(options = {}) {
  if (cachedConfig && !options.reload) return cachedConfig;
  const config = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const parsedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!isObject(parsedConfig)) throw new Error('config.json must contain a top-level JSON object');
      Object.assign(config, parsedConfig);
    } catch (error) {
      throw new CliError(`Invalid config.json at ${CONFIG_FILE}: ${error.message}`, {
        code: 'INVALID_CONFIG',
        configPath: CONFIG_FILE
      });
    }
  }
  if (process.env.DEBOX_API_KEY) config.apiKey = process.env.DEBOX_API_KEY;
  if (process.env.DEBOX_DEFAULT_GROUP_URL) config.defaultGroupUrl = process.env.DEBOX_DEFAULT_GROUP_URL;
  if (process.env.DEBOX_DEFAULT_GROUP) config.defaultGroupId = process.env.DEBOX_DEFAULT_GROUP;
  if (process.env.DEBOX_DEFAULT_CHAIN_ID) config.defaultChainId = Number.parseInt(process.env.DEBOX_DEFAULT_CHAIN_ID, 10);
  if (process.env.DEBOX_BATCH_DELAY_MS) config.defaultBatchDelayMs = Number.parseInt(process.env.DEBOX_BATCH_DELAY_MS, 10);
  if (!config.defaultGroupUrl && config.defaultGroupId) config.defaultGroupUrl = groupIdToUrl(config.defaultGroupId);
  cachedConfig = config;
  return cachedConfig;
}

function isBusinessOk(payload) {
  if (!isObject(payload)) return true;
  if (payload.success !== undefined) return toBoolean(payload.success);
  if (payload.code !== undefined) return [0, 1, 200, '0', '1', '200'].includes(payload.code);
  return true;
}

function normalizeApiResponse({ endpoint, status, payload }) {
  const wrappedPayload = isObject(payload) && (
    Object.prototype.hasOwnProperty.call(payload, 'data')
    || Object.prototype.hasOwnProperty.call(payload, 'code')
    || Object.prototype.hasOwnProperty.call(payload, 'success')
    || Object.prototype.hasOwnProperty.call(payload, 'message')
    || Object.prototype.hasOwnProperty.call(payload, 'msg')
  );
  return {
    ok: status >= 200 && status < 300 && isBusinessOk(payload),
    endpoint,
    status,
    code: isObject(payload) ? firstDefined(payload.code, payload.status) : null,
    message: safeText(isObject(payload) ? firstDefined(payload.message, payload.msg, payload.error_message) : null, ''),
    data: wrappedPayload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload,
    raw: payload
  };
}

function buildErrorDetails(error) {
  return {
    message: safeText(error.message, 'Unknown error'),
    code: firstDefined(error.code, null),
    status: firstDefined(error.status, null),
    endpoint: firstDefined(error.endpoint, null)
  };
}

function formatErrorLine(errorDetails) {
  return [
    errorDetails.endpoint ? `endpoint=${errorDetails.endpoint}` : null,
    errorDetails.status !== null ? `status=${errorDetails.status}` : null,
    errorDetails.code !== null ? `code=${errorDetails.code}` : null
  ].filter(Boolean).join(', ');
}

function isNoActivityError(error, endpoint) {
  const status = firstDefined(error && error.status, error && error.code, null);
  return error && error.endpoint === endpoint && (status === 400 || status === '400');
}

async function request(method, endpoint, params = {}, headers = {}) {
  const config = loadConfig();
  const url = new URL(`${DEBOX_API_BASE}${endpoint}`);
  if (method === 'GET') {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'X-API-KEY': config.apiKey } : {}),
        ...headers
      },
      body: method === 'POST' && Object.keys(params).length > 0 ? JSON.stringify(params) : undefined,
      signal: controller.signal
    });

    const responseText = await response.text();
    let parsedPayload = {};
    if (responseText.trim()) {
      try {
        parsedPayload = JSON.parse(responseText);
      } catch (_) {
        throw new ApiError('Failed to parse API response as JSON', {
          endpoint,
          status: response.status,
          bodyPreview: responseText.slice(0, 300)
        });
      }
    }

    const normalizedResponse = normalizeApiResponse({
      endpoint,
      status: response.status,
      payload: parsedPayload
    });

    if (!normalizedResponse.ok) {
      throw new ApiError(
        normalizedResponse.message || `Request failed with HTTP ${response.status}`,
        normalizedResponse
      );
    }

    return normalizedResponse;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError('Request timed out', { endpoint, code: 'ETIMEDOUT' });
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Request failed', { endpoint, code: error.code });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGroupInfo(response, groupUrl) {
  const data = isObject(response.data) ? response.data : {};
  return {
    ok: true,
    command: 'info',
    groupUrl,
    group: {
      id: safeText(firstDefined(data.gid, data.group_id, data.id, extractGroupId(groupUrl))),
      name: safeText(firstDefined(data.group_name, data.name)),
      memberCount: toInt(data.group_number, data.member_count, data.members),
      maxMembers: firstDefined(data.maximum, data.max_member_count, null),
      createdAt: safeText(firstDefined(data.create_time, data.created_at), '-'),
      isCharge: toBoolean(data.is_charge),
      subchannelCount: toInt(data.subchannel_number, data.subchannel_count),
      moderators: toArray(data.mod_info).map((mod) => ({
        name: safeText(firstDefined(mod.name, mod.nickname)),
        userId: safeText(firstDefined(mod.uid, mod.user_id)),
        wallet: safeText(firstDefined(mod.wallet_address, mod.wallet))
      })),
      raw: data
    },
    meta: { endpoint: response.endpoint, status: response.status, code: response.code }
  };
}

function normalizeMembership(response, wallet, groupUrl) {
  const data = isObject(response.data) ? response.data : {};
  return {
    ok: true,
    command: 'check-member',
    wallet,
    groupUrl,
    isMember: toBoolean(data.joined, data.is_join, response.raw && response.raw.joined, response.raw && response.raw.is_join),
    joinTime: safeText(firstDefined(data.join_time, data.joined_at), ''),
    raw: data,
    meta: { endpoint: response.endpoint, status: response.status, code: response.code }
  };
}

function normalizeUser(response) {
  const data = isObject(response.data) ? response.data : {};
  return {
    id: safeText(firstDefined(data.user_id, data.uid)),
    nickname: safeText(firstDefined(data.nickname, data.name)),
    wallet: safeText(firstDefined(data.wallet_address, data.wallet)),
    avatar: safeText(firstDefined(data.avatar, data.pic), ''),
    bio: safeText(firstDefined(data.bio, data.introduction)),
    level: firstDefined(data.level, '-'),
    raw: data
  };
}

function normalizeVoteStats(response, wallet, groupUrl) {
  const data = isObject(response.data) ? response.data : {};
  return {
    ok: true,
    command: 'vote-stats',
    wallet,
    groupUrl,
    groupId: extractGroupId(groupUrl),
    count: toInt(data.vote_number, data.count, data.vote_count, data.total_count, data.total),
    votes: toArray(firstDefined(data.votes, data.vote_list, [])),
    noActivity: Boolean(response.noActivity),
    message: safeText(response.message, ''),
    raw: data,
    meta: { endpoint: response.endpoint, status: response.status, code: response.code }
  };
}

function normalizeLotteryStats(response, wallet, groupUrl) {
  const data = isObject(response.data) ? response.data : {};
  return {
    ok: true,
    command: 'lottery-stats',
    wallet,
    groupUrl,
    groupId: extractGroupId(groupUrl),
    count: toInt(data.luckDraw_total, data.count, data.lottery_count, data.lucky_draw_count, data.total),
    winCount: toInt(data.luckDraw_win_total, data.win_count, data.win_total),
    draws: toArray(firstDefined(data.draws, data.lucky_draw_list, [])),
    noActivity: Boolean(response.noActivity),
    message: safeText(response.message, ''),
    raw: data,
    meta: { endpoint: response.endpoint, status: response.status, code: response.code }
  };
}

function normalizePraiseStats(response, wallet) {
  const data = isObject(response.data) ? response.data : {};
  return {
    ok: true,
    command: 'praise-info',
    wallet,
    praise: {
      receivedCount: toInt(data.receive_praise_total, data.received_count, data.total_likes),
      sentCount: toInt(data.send_praise_total, data.sent_count),
      raw: data
    },
    meta: { endpoint: response.endpoint, status: response.status, code: response.code }
  };
}

async function groupInfo(groupUrl) {
  const response = await request('GET', '/group/info', { group_invite_url: groupUrl });
  return normalizeGroupInfo(response, groupUrl);
}

async function checkMember(walletAddress, groupUrl, chainId = 1) {
  const response = await request('GET', '/group/is_join', {
    walletAddress,
    wallet_address: walletAddress,
    url: groupUrl,
    group_invite_url: groupUrl,
    chain_id: chainId
  });
  return normalizeMembership(response, walletAddress, groupUrl);
}

async function userInfo(userId) {
  const response = await request('GET', '/user/info', { user_id: userId });
  return {
    ok: true,
    command: 'user-info',
    user: normalizeUser(response),
    meta: { endpoint: response.endpoint, status: response.status, code: response.code }
  };
}

async function voteStats(walletAddress, groupUrl, chainId = 1) {
  try {
    const response = await request('GET', '/vote/info', {
      walletAddress,
      wallet_address: walletAddress,
      group_invite_url: groupUrl,
      group_id: extractGroupId(groupUrl),
      chain_id: chainId
    });
    return normalizeVoteStats(response, walletAddress, groupUrl);
  } catch (error) {
    if (isNoActivityError(error, '/vote/info')) {
      return normalizeVoteStats({
        endpoint: '/vote/info',
        status: error.status || 400,
        code: error.code || 400,
        message: '群组暂无投票活动',
        data: { count: 0 },
        noActivity: true
      }, walletAddress, groupUrl);
    }
    throw error;
  }
}

async function lotteryStats(walletAddress, groupUrl, chainId = 1) {
  try {
    const response = await request('GET', '/lucky_draw/info', {
      walletAddress,
      wallet_address: walletAddress,
      group_invite_url: groupUrl,
      group_id: extractGroupId(groupUrl),
      chain_id: chainId
    });
    return normalizeLotteryStats(response, walletAddress, groupUrl);
  } catch (error) {
    if (isNoActivityError(error, '/lucky_draw/info')) {
      return normalizeLotteryStats({
        endpoint: '/lucky_draw/info',
        status: error.status || 400,
        code: error.code || 400,
        message: '群组暂无抽奖活动',
        data: { count: 0 },
        noActivity: true
      }, walletAddress, groupUrl);
    }
    throw error;
  }
}

async function praiseInfo(walletAddress, chainId = 1) {
  const response = await request('GET', '/moment/praise_info', {
    wallet_address: walletAddress,
    chain_id: chainId
  });
  return normalizePraiseStats(response, walletAddress);
}

async function userProfile(userId, chainId = 1) {
  const userResult = await userInfo(userId);
  const user = userResult.user;
  let praise = { receivedCount: 0, sentCount: 0, raw: {} };
  if (user.wallet && user.wallet !== '-') {
    try {
      praise = (await praiseInfo(user.wallet, chainId)).praise;
    } catch (_) {
      // Keep profile generation resilient.
    }
  }
  return { ok: true, command: 'profile', user, praise };
}

async function verify(options) {
  const { wallet, groupUrl, minVotes = 0, minLotteries = 0, chainId = 1 } = options;
  const result = {
    ok: true,
    command: 'verify',
    wallet,
    groupUrl,
    thresholds: { minVotes, minLotteries },
    passed: false,
    checks: {
      isMember: false,
      votesPassed: minVotes <= 0,
      lotteriesPassed: minLotteries <= 0
    }
  };

  try {
    const memberResult = await checkMember(wallet, groupUrl, chainId);
    result.checks.isMember = memberResult.isMember;
    result.checks.joinTime = memberResult.joinTime || undefined;
  } catch (error) {
    result.checks.memberError = buildErrorDetails(error);
  }

  if (minVotes > 0) {
    try {
      const voteResult = await voteStats(wallet, groupUrl, chainId);
      result.checks.voteCount = voteResult.count;
      result.checks.votesPassed = voteResult.count >= minVotes;
      result.checks.voteNoActivity = voteResult.noActivity;
    } catch (error) {
      result.checks.voteCount = 0;
      result.checks.votesPassed = false;
      result.checks.voteError = buildErrorDetails(error);
    }
  }

  if (minLotteries > 0) {
    try {
      const lotteryResult = await lotteryStats(wallet, groupUrl, chainId);
      result.checks.lotteryCount = lotteryResult.count;
      result.checks.lotteriesPassed = lotteryResult.count >= minLotteries;
      result.checks.lotteryNoActivity = lotteryResult.noActivity;
    } catch (error) {
      result.checks.lotteryCount = 0;
      result.checks.lotteriesPassed = false;
      result.checks.lotteryError = buildErrorDetails(error);
    }
  }

  result.passed = result.checks.isMember && result.checks.votesPassed && result.checks.lotteriesPassed;
  return result;
}

async function batchVerify(file, groupUrl, options = {}) {
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : DEFAULT_BATCH_DELAY_MS;
  const wallets = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((wallet) => wallet.trim()).filter(Boolean);
  const results = [];

  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index];
    try {
      results.push(await verify({
        wallet,
        groupUrl,
        minVotes: options.minVotes,
        minLotteries: options.minLotteries,
        chainId: options.chainId
      }));
    } catch (error) {
      results.push({
        ok: false,
        command: 'verify',
        wallet,
        groupUrl,
        passed: false,
        error: buildErrorDetails(error)
      });
    }

    // Keep requests serial and comfortably below 100 RPM.
    if (index < wallets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const passed = results.filter((item) => item.passed).length;
  return {
    ok: true,
    command: 'batch-verify',
    groupUrl,
    delayMs,
    total: results.length,
    passed,
    failed: results.length - passed,
    results
  };
}

function printGroupInfo(result) {
  const group = result.group;
  console.log('\n========================================');
  console.log('        群组信息');
  console.log('========================================\n');
  console.log('群组名称:', group.name);
  console.log('群组 ID:', group.id);
  console.log('成员数量:', group.memberCount, '/', group.maxMembers ?? '∞');
  console.log('创建时间:', group.createdAt);
  console.log('收费群:', group.isCharge ? '是' : '否');
  console.log('子频道数:', group.subchannelCount);
  if (group.moderators.length > 0) {
    console.log('\n管理员信息:');
    group.moderators.forEach((mod, index) => {
      console.log(`  ${index + 1}. ${mod.name}`);
      console.log(`     用户ID: ${mod.userId}`);
      console.log(`     钱包: ${mod.wallet}`);
    });
  }
  console.log('\n========================================');
}

function printCheckMember(result) {
  console.log('\n========================================');
  console.log('        成员验证');
  console.log('========================================\n');
  console.log('钱包地址:', result.wallet);
  console.log('群组链接:', result.groupUrl);
  console.log('验证结果:', result.isMember ? '已加入群组' : '未加入群组');
  if (result.joinTime) console.log('加入时间:', result.joinTime);
  console.log('\n========================================');
}

function printUserInfo(result) {
  const user = result.user;
  console.log('\n========================================');
  console.log('        用户信息');
  console.log('========================================\n');
  console.log('用户ID:', user.id);
  console.log('昵称:', user.nickname);
  console.log('钱包地址:', user.wallet);
  console.log('头像:', user.avatar || '-');
  console.log('简介:', user.bio);
  console.log('等级:', user.level);
  console.log('\n========================================');
}

function printVoteStats(result) {
  console.log('\n========================================');
  console.log('        投票统计');
  console.log('========================================\n');
  console.log('钱包地址:', result.wallet);
  console.log('群组链接:', result.groupUrl);
  console.log('群组 ID:', result.groupId || '-');
  if (result.noActivity) {
    console.log('状态:', result.message || '群组暂无投票活动');
    console.log('投票次数: 0');
  } else {
    console.log('投票次数:', result.count);
  }
  console.log('\n========================================');
}

function printLotteryStats(result) {
  console.log('\n========================================');
  console.log('        抽奖统计');
  console.log('========================================\n');
  console.log('钱包地址:', result.wallet);
  console.log('群组链接:', result.groupUrl);
  console.log('群组 ID:', result.groupId || '-');
  if (result.noActivity) {
    console.log('状态:', result.message || '群组暂无抽奖活动');
    console.log('抽奖次数: 0');
    console.log('中奖次数: 0');
  } else {
    console.log('抽奖次数:', result.count);
    console.log('中奖次数:', result.winCount);
  }
  console.log('\n========================================');
}

function printPraiseInfo(result) {
  console.log('\n========================================');
  console.log('        点赞信息');
  console.log('========================================\n');
  console.log('钱包地址:', result.wallet);
  console.log('收到点赞:', result.praise.receivedCount);
  console.log('发出点赞:', result.praise.sentCount);
  console.log('\n========================================');
}

function padReportLine(label, value) {
  const text = safeText(value);
  return `║  ${label}${text.padEnd(Math.max(0, 34 - label.length))}║`;
}

function printProfile(result) {
  const { user, praise } = result;
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║        DeBox 个人数据报告             ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(padReportLine('昵称：', user.nickname));
  console.log(padReportLine('用户ID：', user.id));
  console.log(padReportLine('钱包：', truncateMiddle(user.wallet, 10, 6)));
  console.log(padReportLine('等级：Lv.', user.level));
  console.log('╠════════════════════════════════════════╣');
  console.log(padReportLine('收到点赞：', praise.receivedCount));
  console.log(padReportLine('发出点赞：', praise.sentCount));
  console.log('╚════════════════════════════════════════╝');
}

async function downloadBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function createAvatarBuffer(user) {
  const displayName = safeText(firstDefined(user.nickname, user.id), '?');
  const avatarUrl = user.avatar || '';
  const circleMask = Buffer.from('<svg width="80" height="80"><circle cx="40" cy="40" r="40" fill="white"/></svg>');
  if (avatarUrl) {
    try {
      const avatarBuffer = await downloadBuffer(avatarUrl);
      return await sharp(avatarBuffer)
        .resize(80, 80, { fit: 'cover' })
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch (_) {
      // Fall back to the placeholder avatar.
    }
  }
  const avatarInitial = escapeXml(Array.from(displayName)[0] || '?');
  return Buffer.from(`<svg width="80" height="80"><circle cx="40" cy="40" r="40" fill="#07C160"/><text x="40" y="51" font-family="Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="#ffffff">${avatarInitial}</text></svg>`);
}

async function loadLogoBuffer() {
  const logoPath = path.join(__dirname, '..', 'ClawBot.png');
  if (!fs.existsSync(logoPath)) return null;
  return sharp(logoPath).resize(50, 50, { fit: 'contain' }).png().toBuffer();
}

async function generateProfileImage(result, outputPath) {
  const { user, praise } = result;
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  const avatarBuffer = await createAvatarBuffer(user);
  const logoBuffer = await loadLogoBuffer();
  const cardSvg = Buffer.from('<svg width="460" height="360"><rect x="0" y="0" width="460" height="360" rx="16" fill="rgba(255,255,255,0.95)"/></svg>');
  const avatarBorder = Buffer.from('<svg width="86" height="86"><circle cx="43" cy="43" r="42" fill="none" stroke="#07C160" stroke-width="3"/></svg>');
  const textSvg = Buffer.from(`<svg width="460" height="300"><text x="230" y="45" font-family="Arial, sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#333333">DeBox Profile Report</text><text x="200" y="105" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#333333">${escapeXml(truncateEnd(user.nickname, 18))}</text><text x="200" y="130" font-family="Arial, sans-serif" font-size="14" fill="#888888">Lv.${escapeXml(user.level)}</text><text x="200" y="155" font-family="Arial, sans-serif" font-size="12" fill="#07C160">${escapeXml(truncateMiddle(user.wallet, 8, 6))}</text><rect x="20" y="175" width="420" height="85" rx="10" fill="#f5f5f5"/><text x="230" y="200" font-family="Arial, sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="#333333">Social Stats</text><text x="120" y="240" font-family="Arial, sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#07C160">${praise.receivedCount}</text><text x="120" y="255" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#888888">Received</text><text x="230" y="240" font-family="Arial, sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#f06292">${praise.sentCount}</text><text x="230" y="255" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#888888">Sent</text><text x="360" y="240" font-family="Arial, sans-serif" font-size="11" fill="#999999">ID: ${escapeXml(truncateEnd(user.id, 20))}</text></svg>`);
  const layers = [
    { input: cardSvg, top: 20, left: 20 },
    { input: avatarBuffer, top: 95, left: 50 },
    { input: avatarBorder, top: 92, left: 47 },
    { input: textSvg, top: 20, left: 20 }
  ];
  if (logoBuffer) layers.push({ input: logoBuffer, top: 335, left: 225 });
  await sharp({ create: { width: 500, height: 400, channels: 4, background: '#07C160' } })
    .composite(layers)
    .png()
    .toFile(resolvedOutputPath);
  return resolvedOutputPath;
}

function printVerify(result) {
  console.log('\n========================================');
  console.log('        综合验证');
  console.log('========================================\n');
  console.log('钱包地址:', result.wallet);
  console.log('群组链接:', result.groupUrl);
  console.log('验证结果:', result.passed ? '通过' : '未通过');
  console.log('是否群成员:', result.checks.isMember ? '是' : '否');
  console.log('投票要求:', result.checks.votesPassed ? '通过' : '未通过');
  console.log('抽奖要求:', result.checks.lotteriesPassed ? '通过' : '未通过');
  if (result.checks.voteCount !== undefined) console.log('投票次数:', result.checks.voteCount);
  if (result.checks.lotteryCount !== undefined) console.log('抽奖次数:', result.checks.lotteryCount);
  if (result.checks.memberError) console.log('成员验证错误:', result.checks.memberError.message);
  if (result.checks.voteError) console.log('投票查询错误:', result.checks.voteError.message);
  if (result.checks.lotteryError) console.log('抽奖查询错误:', result.checks.lotteryError.message);
  console.log('\n========================================');
}

function printBatchVerify(result) {
  console.log('\n========================================');
  console.log('        批量验证结果');
  console.log('========================================\n');
  console.log('总计:', result.total);
  console.log('通过:', result.passed);
  console.log('未通过:', result.failed);
  console.log('请求间隔:', `${result.delayMs}ms`);
  result.results.forEach((item, index) => {
    console.log(`${index + 1}. ${item.passed ? 'PASS' : 'FAIL'} ${item.wallet}`);
    if (item.error) console.log(`   错误: ${item.error.message}`);
    if (item.checks) {
      console.log(`   成员: ${item.checks.isMember ? '是' : '否'}`);
      console.log(`   投票: ${item.checks.votesPassed ? '通过' : '未通过'}`);
      console.log(`   抽奖: ${item.checks.lotteriesPassed ? '通过' : '未通过'}`);
    }
  });
  console.log('\n========================================');
}

function outputResult(result, printer, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printer(result);
}

function printCliError(error) {
  const details = buildErrorDetails(error);
  if (details.code === 'INVALID_CONFIG' || details.code === 'ARG_MISSING' || details.code === 'ARG_INVALID' || details.code === 'MISSING_API_KEY') {
    console.error(`配置/参数错误: ${details.message}`);
    return;
  }
  if (details.status === 401 || details.code === 401) {
    console.error('认证错误: API Key 无效或缺失。');
  } else if (details.status === 429 || details.code === 429) {
    console.error('限流错误: 请求过于频繁，请稍后重试。');
  } else if (details.code === 'ETIMEDOUT') {
    console.error('网络错误: 请求超时。');
  } else {
    console.error(`请求失败: ${details.message}`);
  }
  const location = formatErrorLine(details);
  if (location) console.error(location);
}

function requireApiKey(config, command) {
  if (!config.apiKey) {
    throw new CliError(`DEBOX_API_KEY is required for "${command}". Set it via environment variable or ${CONFIG_FILE}`, {
      code: 'MISSING_API_KEY'
    });
  }
}

function resolveGroupUrl(config, options = {}) {
  const groupUrl = firstDefined(
    getArg(options.primaryFlag || '--group-url'),
    options.allowUrlAlias ? getArg('--url') : null,
    groupIdToUrl(getArg('--group-id')),
    config.defaultGroupUrl,
    groupIdToUrl(config.defaultGroupId)
  );
  if (!groupUrl && options.required !== false) {
    throw new CliError('Missing group URL. Use --group-url, --url, or configure defaultGroupUrl in config.json', {
      code: 'ARG_MISSING',
      flag: options.primaryFlag || '--group-url'
    });
  }
  return groupUrl;
}

async function main() {
  setCliArgs(process.argv.slice(2));
  const command = cliArgs[0] && !cliArgs[0].startsWith('--') ? cliArgs[0] : null;
  const jsonMode = hasFlag('--json');

  if (!command || command === 'help' || hasFlag('--help') || hasFlag('-h')) {
    outputResult({
      ok: true,
      command: 'help',
      commands: ['info', 'check-member', 'user-info', 'vote-stats', 'lottery-stats', 'praise-info', 'profile', 'verify', 'batch-verify']
    }, () => {
      console.log('DeBox Community Management CLI');
      console.log('');
      console.log('Commands: info, check-member, user-info, vote-stats, lottery-stats, praise-info, profile, verify, batch-verify');
      console.log('Global flags: --json, --chain-id N');
    }, jsonMode);
    return;
  }

  try {
    const config = loadConfig();
    const chainId = getIntArg('--chain-id', Number.isFinite(config.defaultChainId) ? config.defaultChainId : 1);

    switch (command) {
      case 'info':
        requireApiKey(config, command);
        outputResult(await groupInfo(resolveGroupUrl(config, { primaryFlag: '--url', allowUrlAlias: true })), printGroupInfo, jsonMode);
        return;
      case 'check-member': {
        requireApiKey(config, command);
        const wallet = getArg('--wallet');
        if (!wallet) throw new CliError('Usage: debox-community check-member --wallet "0x..." --group-url "..."', { code: 'ARG_MISSING', flag: '--wallet' });
        outputResult(await checkMember(wallet, resolveGroupUrl(config), chainId), printCheckMember, jsonMode);
        return;
      }
      case 'user-info': {
        requireApiKey(config, command);
        const userId = getArg('--user-id');
        if (!userId) throw new CliError('Usage: debox-community user-info --user-id "xxx"', { code: 'ARG_MISSING', flag: '--user-id' });
        outputResult(await userInfo(userId), printUserInfo, jsonMode);
        return;
      }
      case 'vote-stats': {
        requireApiKey(config, command);
        const wallet = getArg('--wallet');
        if (!wallet) throw new CliError('Usage: debox-community vote-stats --wallet "0x..." --group-url "..."', { code: 'ARG_MISSING', flag: '--wallet' });
        outputResult(await voteStats(wallet, resolveGroupUrl(config), chainId), printVoteStats, jsonMode);
        return;
      }
      case 'lottery-stats': {
        requireApiKey(config, command);
        const wallet = getArg('--wallet');
        if (!wallet) throw new CliError('Usage: debox-community lottery-stats --wallet "0x..." --group-url "..."', { code: 'ARG_MISSING', flag: '--wallet' });
        outputResult(await lotteryStats(wallet, resolveGroupUrl(config), chainId), printLotteryStats, jsonMode);
        return;
      }
      case 'praise-info': {
        requireApiKey(config, command);
        const wallet = getArg('--wallet');
        if (!wallet) throw new CliError('Usage: debox-community praise-info --wallet "0x..."', { code: 'ARG_MISSING', flag: '--wallet' });
        outputResult(await praiseInfo(wallet, chainId), printPraiseInfo, jsonMode);
        return;
      }
      case 'profile': {
        requireApiKey(config, command);
        const userId = getArg('--user-id');
        if (!userId) throw new CliError('Usage: debox-community profile --user-id "xxx" [--image] [--output "profile.png"]', { code: 'ARG_MISSING', flag: '--user-id' });
        const result = await userProfile(userId, chainId);
        if (hasFlag('--image')) result.imagePath = await generateProfileImage(result, getArg('--output') || 'profile.png');
        outputResult(result, printProfile, jsonMode);
        if (result.imagePath && !jsonMode) console.log(`图片已保存: ${result.imagePath}`);
        return;
      }
      case 'verify': {
        requireApiKey(config, command);
        const wallet = getArg('--wallet');
        if (!wallet) throw new CliError('Usage: debox-community verify --wallet "0x..." --group-url "..." [--min-votes N] [--min-lotteries N]', { code: 'ARG_MISSING', flag: '--wallet' });
        outputResult(await verify({
          wallet,
          groupUrl: resolveGroupUrl(config),
          minVotes: getIntArg('--min-votes', 0),
          minLotteries: getIntArg('--min-lotteries', 0),
          chainId
        }), printVerify, jsonMode);
        return;
      }
      case 'batch-verify': {
        requireApiKey(config, command);
        const file = getArg('--file');
        if (!file) throw new CliError('Usage: debox-community batch-verify --file wallets.txt --group-url "..." [--min-votes N] [--min-lotteries N] [--delay-ms 650]', { code: 'ARG_MISSING', flag: '--file' });
        outputResult(await batchVerify(file, resolveGroupUrl(config), {
          minVotes: getIntArg('--min-votes', 0),
          minLotteries: getIntArg('--min-lotteries', 0),
          chainId,
          delayMs: getIntArg('--delay-ms', Number.isFinite(config.defaultBatchDelayMs) ? config.defaultBatchDelayMs : DEFAULT_BATCH_DELAY_MS)
        }), printBatchVerify, jsonMode);
        return;
      }
      default:
        throw new CliError(`Unknown command: ${command}`, { code: 'UNKNOWN_COMMAND' });
    }
  } catch (error) {
    const payload = { ok: false, command: command || null, error: buildErrorDetails(error) };
    if (jsonMode) {
      console.error(JSON.stringify(payload, null, 2));
    } else {
      printCliError(error);
    }
    process.exit(1);
  }
}

module.exports = {
  ApiError,
  CliError,
  batchVerify,
  checkMember,
  extractGroupId,
  generateProfileImage,
  getArg,
  getIntArg,
  groupIdToUrl,
  groupInfo,
  hasFlag,
  loadConfig,
  lotteryStats,
  normalizeApiResponse,
  praiseInfo,
  request,
  setCliArgs,
  userInfo,
  userProfile,
  verify,
  voteStats
};

if (require.main === module) {
  main();
}
