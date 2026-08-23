#!/usr/bin/env node
/* 五樓：存檔後的資料表一致性 + 自足性檢查。
   由 .claude/settings.json 的 PostToolUse hook 呼叫。
   有問題就 exit 2，訊息走 stderr 回饋給 Claude。 */
import { readFileSync } from 'node:fs';

const TARGET = '五樓_單人版.html';

/* hook 從 stdin 收到一包 JSON，裡面有這次改的檔案 */
const raw = await new Promise(r => {
  let s = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => s += d); process.stdin.on('end', () => r(s));
});
let filePath = '';
try { filePath = JSON.parse(raw || '{}')?.tool_input?.file_path ?? ''; } catch {}
const norm = filePath.split(String.fromCharCode(92)).join('/');
 if (!norm.endsWith(TARGET)) process.exit(0);

let src;
try { src = readFileSync(filePath, 'utf8'); } catch { process.exit(0); }
const errs = [];

/* ---------- 一、自足性：不能有任何外部資源 ---------- */
const forbidden = [
  [/<script[^>]+\bsrc\s*=/i,                    '<script src=…>：外部腳本'],
  [/<link[^>]+\bhref\s*=\s*["']https?:/i,       '<link href="http…">：外部樣式表'],
  [/<(?:img|iframe|video|audio|source)[^>]+\bsrc\s*=\s*["']https?:/i, '外部媒體資源'],
  [/@import\s+url\(\s*["']?https?:/i,           '@import url(http…)：外部 CSS'],
  [/\bfetch\s*\(/,                              'fetch(：執行期網路請求'],
  [/\bXMLHttpRequest\b/,                        'XMLHttpRequest：執行期網路請求'],
  [/<script[^>]+\btype\s*=\s*["']module["']/i,  'type="module"：從 file:// 開會被 CORS 擋掉'],
];
for (const [re, why] of forbidden) {
  const m = src.match(re);
  if (m) {
    const line = src.slice(0, m.index).split('\n').length;
    errs.push(`自足性：第 ${line} 行出現${why}。這個檔要能離線用 file:// 直接打開，不可依賴外部資源。`);
  }
}

/* ---------- 二、把資料表那段切出來單獨執行 ---------- */
const a = src.indexOf('const TODAY=');
const b = src.indexOf('let prog=0');
if (a < 0 || b < 0 || b <= a) {
  errs.push('找不到資料表區段（const TODAY= … let prog=0）。若已重構過檔案結構，請同步更新 .claude/hooks/check-five-floor.mjs 的切法。');
  report(); process.exit(errs.length ? 2 : 0);
}
let tables;
try {
  tables = new Function(`${src.slice(a, b)}
    return {DOCS, GATES, AFTER, SITE, BOARD_DECO, USERS, ME};`)();
} catch (e) {
  errs.push(`資料表區段有語法／執行錯誤，遊戲一定開不起來：${e.message}`);
  report(); process.exit(2);
}
const { DOCS, GATES, AFTER, SITE, BOARD_DECO, USERS, ME } = tables;

/* 真正會被指派到的 prog 值 = 0 ∪ AFTER.unlockAt ∪ 程式裡寫死的 prog=N */
const reachable = new Set([0]);
for (const k in AFTER) reachable.add(AFTER[k].unlockAt);
for (const m of src.matchAll(/\bprog\s*=\s*(\d+)/g)) reachable.add(Number(m[1]));

const docIds = new Set(DOCS.map(d => d.id));
const known  = new Set([...Object.keys(USERS), '']);

/* ---------- 三、逐條檢查 ---------- */
for (const d of DOCS) {
  if (!SITE[d.id])
    errs.push(`DOCS「${d.id}」沒有對應的 SITE 條目，分頁標籤與網址會是空的。`);
  if (!reachable.has(d.at))
    errs.push(`DOCS「${d.id}」的 at=${d.at} 永遠不會到達（實際可達的 prog：${[...reachable].sort((x,y)=>x-y).join(', ')}），這份文件玩家看不到。`);
  if (d.skin === 'wulou' && !d.idx)
    errs.push(`DOCS「${d.id}」是 wulou 板串卻沒有 idx，不會出現在板首頁。`);

  const posts = d.posts ?? [];
  const rids = new Set(posts.filter(p => p.rid && !p.del).map(p => p.rid));
  for (const p of posts) {
    if (p.at !== undefined && !reachable.has(p.at))
      errs.push(`DOCS「${d.id}」${p.f || '(刪除樓)'} 的 at=${p.at} 永遠不會到達，這一樓玩家看不到。`);
    if (p.del && p.rid && !rids.has(p.rid))
      errs.push(`DOCS「${d.id}」有個刪除樓標了 rid「${p.rid}」，但找不到對應的還原樓層，在板務後台還原後會是空的。`);
    if (p.u && !known.has(p.u))
      errs.push(`DOCS「${d.id}」${p.f} 的發文者「${p.u}」不在 USERS 裡，板上只會顯示帳號、沒有名字。`);
  }
}

for (const g of GATES) {
  if (!SITE[g.id])  errs.push(`GATES「${g.id}」沒有對應的 SITE 條目。`);
  if (!AFTER[g.id]) errs.push(`GATES「${g.id}」沒有對應的 AFTER 條目，過關後不知道要把 prog 推到哪，流程會卡死。`);
  for (const f of g.fields ?? [])
    if (!f.locked && !(f.answer?.length))
      errs.push(`GATES「${g.id}」的欄位「${f.label}」沒有 answer，永遠過不了關。`);
}
for (const id in AFTER)
  if (!GATES.some(g => g.id === id))
    errs.push(`AFTER 有「${id}」，但 GATES 裡沒有這一關。`);
for (const id in SITE)
  if (!docIds.has(id) && !GATES.some(g => g.id === id) && !['board_index','notes','board','end'].includes(id))
    errs.push(`SITE 有「${id}」，但 DOCS／GATES 都沒有——是不是刪掉內容後忘了清？`);

/* idx.ts 撞值 → 板上排序不穩定 */
const seenTs = new Map();
for (const r of [...DOCS.filter(d => d.idx).map(d => ({ n: d.id, ts: d.idx.ts })),
                 ...BOARD_DECO.map(x => ({ n: `裝飾串「${x.label}」`, ts: x.ts }))]) {
  if (seenTs.has(r.ts))
    errs.push(`板首頁排序鍵 ts=${r.ts} 重複：${seenTs.get(r.ts)} 與 ${r.n}，兩者在板上的先後會不穩定。`);
  else seenTs.set(r.ts, r.n);
}

function report() {
  if (!errs.length) return;
  console.error(`【五樓資料檢查】發現 ${errs.length} 個問題，請修好再繼續：\n` +
    errs.map((e, i) => `  ${i + 1}. ${e}`).join('\n'));
}
report();
process.exit(errs.length ? 2 : 0);
