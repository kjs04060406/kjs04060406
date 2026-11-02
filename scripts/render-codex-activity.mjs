import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sessions = process.argv[2] || join(process.env.CODEX_HOME || join(process.env.USERPROFILE || '', '.codex'), 'sessions');
const claudeSessions = join(process.env.USERPROFILE || '', '.claude', 'projects');
const timeZone = 'Asia/Seoul';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = timestamp => dateFormat.format(new Date(timestamp));
const today = dayKey(Date.now());
const daily = new Map();

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
  });
}

async function countSession(path) {
  let previous = 0;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"token_count"')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
    const total = Number(event.payload.info?.total_token_usage?.total_tokens);
    if (!Number.isFinite(total) || total < 0 || !event.timestamp) continue;
    const increment = total >= previous ? total - previous : total;
    previous = total;
    if (increment > 0) {
      const date = dayKey(event.timestamp);
      daily.set(date, (daily.get(date) || 0) + increment);
    }
  }
}

for (const path of filesUnder(sessions)) await countSession(path);

const claudeMessages = new Map();
async function countClaudeSession(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'assistant' || !event.message?.usage || !event.timestamp) continue;
    const id = event.message.id || event.requestId;
    if (!id || !Number.isFinite(Date.parse(event.timestamp))) continue;
    const usage = event.message.usage;
    const tokens = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']
      .reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
    if (tokens <= 0) continue;
    const previous = claudeMessages.get(id);
    if (!previous || tokens > previous.tokens) claudeMessages.set(id, { date: dayKey(event.timestamp), tokens });
  }
}
for (const path of filesUnder(claudeSessions)) await countClaudeSession(path);
const claudeDaily = new Map();
for (const { date, tokens } of claudeMessages.values()) claudeDaily.set(date, (claudeDaily.get(date) || 0) + tokens);

const sorted = [...daily].sort(([a], [b]) => a.localeCompare(b));
if (!sorted.length) throw new Error(`토큰 기록을 찾지 못했습니다: ${sessions}`);
const first = sorted[0][0];
const firstClaude = [...claudeDaily.keys()].sort()[0] || '9999-12-31';
const total = sorted.reduce((sum, [, tokens]) => sum + tokens, 0);
const activeDays = sorted.length;
const formatter = new Intl.NumberFormat('ko-KR');
const end = new Date(`${today}T12:00:00Z`);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 26 * 7);
const days = [];
for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
  const key = date.toISOString().slice(0, 10);
  days.push({ date: key, weekday: date.getUTCDay() });
}

const palette = ['#2b2b2b', '#123a72', '#1556a6', '#2f7edb', '#65a8f5'];
const claudePalette = ['#2b2b2b', '#603319', '#99502b', '#ce7543', '#f3a36a'];
function level(day, maximum) {
  if (!day.known) return 'unknown';
  if (!day.tokens) return '0';
  return String(Math.min(4, Math.max(1, Math.ceil(4 * Math.log1p(day.tokens) / Math.log1p(maximum)))));
}
const assetDir = join(repo, 'assets');
mkdirSync(assetDir, { recursive: true });
for (const [product, colors] of [['codex', palette], ['claude', claudePalette]]) {
  for (const [name, fill] of [['unknown', '#202020'], ...colors.map((value, index) => [String(index), value])]) {
    writeFileSync(join(assetDir, `${product}-level-${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" rx="2" fill="${fill}"/></svg>\n`);
  }
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
for (const label of weekdays) {
  writeFileSync(join(assetDir, `codex-weekday-${label}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="12" viewBox="0 0 30 12"><text x="0" y="10" fill="#f0f6fc" font-family="'Mona Sans VF',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif" font-size="12">${label}</text></svg>\n`);
}
const columns = Math.ceil(days.length / 7);
const monthWidth = 30 + columns * 12;
const monthLabels = [];
const monthNames = [];
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const startMidnight = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
for (let month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); month <= end; month.setUTCMonth(month.getUTCMonth() + 1)) {
  const column = Math.max(0, Math.floor((month - startMidnight) / (7 * 24 * 60 * 60 * 1000)));
  const x = Math.min(30 + column * 12, monthWidth - 25);
  const name = monthFormat.format(month);
  monthNames.push(name);
  monthLabels.push(`<text x="${x}" y="12">${name}</text>`);
}
writeFileSync(join(assetDir, 'codex-months.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${monthWidth}" height="18" viewBox="0 0 ${monthWidth} 18"><g fill="#f0f6fc" font-family="'Mona Sans VF',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif" font-size="12">${monthLabels.join('')}</g></svg>\n`);
function graph(product, counts, firstDate) {
  const series = days.map(day => ({ ...day, tokens: counts.get(day.date) || 0, known: day.date >= firstDate && day.date <= today }));
  const maximum = Math.max(...series.filter(day => day.known).map(day => day.tokens), 1);
  const rows = weekdays.map((label, weekday) => {
    const cells = series.filter(day => day.weekday === weekday).map(day => {
      const tooltip = day.known ? `${day.date}: ${formatter.format(day.tokens)} tokens` : `${day.date}: 로컬 기록 없음`;
      return `<img src="assets/${product}-level-${level(day, maximum)}.svg" width="12" height="12" alt="" title="${tooltip}">`;
    }).join('');
    return `<div><img src="assets/codex-weekday-${label}.svg" width="30" height="12" alt="${label}">${cells}</div>`;
  });
  return `<div><img src="assets/codex-months.svg" width="${monthWidth}" height="18" alt="${monthNames.join(' ')}"></div>\n${rows.join('\n')}`;
}

const readmePath = join(repo, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const begin = '<!-- CODEX_ACTIVITY_START -->';
const finish = '<!-- CODEX_ACTIVITY_END -->';
if (!readme.includes(begin) || !readme.includes(finish)) throw new Error('README 갱신 표식을 찾지 못했습니다.');
const section = `${begin}\n<table align="center"><tr><td valign="top"><h3>Codex</h3>\n${graph('codex', daily, first)}</td><td valign="top"><h3>Claude</h3>\n${graph('claude', claudeDaily, firstClaude)}</td></tr></table>\n${finish}`;
writeFileSync(readmePath, readme.replace(new RegExp(`${begin}[\\s\\S]*?${finish}`), section));
console.log(JSON.stringify({ first, today, activeDays, total, files: filesUnder(sessions).length, claudeFirst: firstClaude, claudeMessages: claudeMessages.size }));
