import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sessions = process.argv[2] || join(process.env.CODEX_HOME || join(process.env.USERPROFILE || '', '.codex'), 'sessions');
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

const sorted = [...daily].sort(([a], [b]) => a.localeCompare(b));
if (!sorted.length) throw new Error(`토큰 기록을 찾지 못했습니다: ${sessions}`);
const first = sorted[0][0];
const total = sorted.reduce((sum, [, tokens]) => sum + tokens, 0);
const activeDays = sorted.length;
const formatter = new Intl.NumberFormat('ko-KR');
const end = new Date(`${today}T12:00:00Z`);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 364);
start.setUTCDate(start.getUTCDate() - start.getUTCDay());
const days = [];
for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
  const key = date.toISOString().slice(0, 10);
  days.push({ date: key, tokens: daily.get(key) || 0, known: key >= first && key <= today, weekday: date.getUTCDay() });
}

const known = days.filter(day => day.known);
const max = Math.max(...known.map(day => day.tokens), 1);
const palette = ['#2b2b2b', '#123a72', '#1556a6', '#2f7edb', '#65a8f5'];
function color(day) {
  if (!day.known) return '#202020';
  if (!day.tokens) return palette[0];
  const level = Math.min(4, Math.max(1, Math.ceil(4 * Math.log1p(day.tokens) / Math.log1p(max))));
  return palette[level];
}
const cell = 12, gap = 3, left = 43, top = 77;
const weeks = Math.ceil(days.length / 7);
const width = left + weeks * (cell + gap) + 20;
const monthLabels = days.flatMap((day, index) => {
  if (day.date.slice(8) !== '01') return [];
  return [`<text x="${left + Math.floor(index / 7) * (cell + gap)}" y="${top - 12}" fill="#aaa" font-size="11">${Number(day.date.slice(5, 7))}월</text>`];
});
const cells = days.map((day, index) => {
  const x = left + Math.floor(index / 7) * (cell + gap);
  const y = top + day.weekday * (cell + gap);
  const title = day.known ? `${day.date}: ${formatter.format(day.tokens)} tokens` : `${day.date}: 로컬 기록 없음`;
  return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${color(day)}"><title>${title}</title></rect>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="218" viewBox="0 0 ${width} 218" role="img" aria-label="Codex 토큰 활동, 로컬 기록 ${first}부터 ${today}까지">
<rect width="100%" height="100%" rx="12" fill="#151515"/>
<text x="20" y="30" fill="#f5f5f5" font-family="Arial,sans-serif" font-size="18" font-weight="bold">Codex 토큰 활동</text>
<text x="20" y="49" fill="#aaa" font-family="Arial,sans-serif" font-size="12">로컬 기록 ${first}부터 · ${formatter.format(total)} tokens · 활동 ${activeDays}일</text>
<g font-family="Arial,sans-serif">${monthLabels.join('')}<text x="20" y="${top + 27}" fill="#888" font-size="10">월</text><text x="20" y="${top + 57}" fill="#888" font-size="10">수</text><text x="20" y="${top + 87}" fill="#888" font-size="10">금</text>${cells.join('')}</g>
<text x="20" y="203" fill="#888" font-family="Arial,sans-serif" font-size="11">서울 시간 기준 · 회색(진함): 로컬 기록 없음 · 수치는 계정 전체 통계와 다를 수 있습니다</text>
</svg>\n`;
const asset = join(repo, 'assets', 'codex-activity.svg');
const csv = join(repo, 'data', 'codex-daily.csv');
mkdirSync(dirname(asset), { recursive: true });
mkdirSync(dirname(csv), { recursive: true });
writeFileSync(asset, svg);
writeFileSync(csv, `date,tokens\n${sorted.map(([date, tokens]) => `${date},${tokens}`).join('\n')}\n`);

const readmePath = join(repo, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const begin = '<!-- CODEX_ACTIVITY_START -->';
const finish = '<!-- CODEX_ACTIVITY_END -->';
if (!readme.includes(begin) || !readme.includes(finish)) throw new Error('README 갱신 표식을 찾지 못했습니다.');
const latest = sorted.slice(-14).reverse();
const section = `${begin}\n![Codex 토큰 활동](assets/codex-activity.svg)\n\n로컬 세션 기록 기준: **${first}–${today}** · **${formatter.format(total)} tokens** · **${activeDays}일 활동**  \n[날짜별 전체 수치](data/codex-daily.csv)\n\n| 날짜 (KST) | 토큰 |\n| --- | ---: |\n${latest.map(([date, tokens]) => `| ${date} | ${formatter.format(tokens)} |`).join('\n')}\n${finish}`;
writeFileSync(readmePath, readme.replace(new RegExp(`${begin}[\\s\\S]*?${finish}`), section));
console.log(JSON.stringify({ first, today, activeDays, total, files: filesUnder(sessions).length }));
