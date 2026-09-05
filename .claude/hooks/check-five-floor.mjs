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
    return {DOCS, GATES, AFTER, SITE, BOARD_DECO, USERS, ME, CHAT, AVATARS};`)();
} catch (e) {
  errs.push(`資料表區段有語法／執行錯誤，遊戲一定開不起來：${e.message}`);
  report(); process.exit(2);
}
const { DOCS, GATES, AFTER, SITE, BOARD_DECO, USERS, ME, CHAT, AVATARS } = tables;

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
  if (!docIds.has(id) && !GATES.some(g => g.id === id) && !['board_index','notes','chat','end'].includes(id))
    errs.push(`SITE 有「${id}」，但 DOCS／GATES 都沒有——是不是刪掉內容後忘了清？`);

/* ---------- 三之二、茶水間 ---------- */
/* 今天的劇情全在 CHAT 裡，這裡把「貼出去的連結點不開」「沒有人講話的段落」
   「終章送不出去」這幾種會直接卡死流程的錯抓出來。 */
const sceneIds = new Set();
let hasEnd = false;
for (const sc of CHAT ?? []) {
  if (sceneIds.has(sc.id)) errs.push(`CHAT 有兩段都叫「${sc.id}」，後面那段永遠不會播（chatFired 以 id 去重）。`);
  sceneIds.add(sc.id);
  if (typeof sc.when !== 'function') errs.push(`CHAT「${sc.id}」沒有 when()，永遠不會被排進佇列。`);
  if (!sc.steps?.length) errs.push(`CHAT「${sc.id}」沒有任何 steps。`);
  /* 選擇泡泡（{ask,opts}）把後續台詞收在 opts[].then 裡，一起攤平檢查 */
  const flat = [];
  for (const st of sc.steps ?? []) {
    flat.push(st);
    for (const o of st.opts ?? []) {
      if (!o.c) errs.push(`CHAT「${sc.id}」的選擇「${st.ask}」有一個選項沒有文字。`);
      if (o.v === undefined) errs.push(`CHAT「${sc.id}」的選擇「${st.ask}」有一個選項沒有 v，picks 會記成 undefined。`);
      if (o.end) hasEnd = true;
      flat.push(...(o.then ?? []));
    }
    if (st.opts && !st.ask)
      errs.push(`CHAT「${sc.id}」有一組選項卻沒有 ask，選完不知道要記到 picks 的哪一格。`);
    if (st.opts && !st.opts.length)
      errs.push(`CHAT「${sc.id}」的選擇「${st.ask}」沒有任何選項，播到這裡會卡死。`);
  }
  for (const st of flat) {
    if (st.share && !docIds.has(st.share))
      errs.push(`CHAT「${sc.id}」貼出的連結「${st.share}」不在 DOCS 裡，點下去會是空白頁。`);
    if (st.u && !known.has(st.u))
      errs.push(`CHAT「${sc.id}」的發話者「${st.u}」不在 USERS 裡，聊天室只會顯示帳號。`);
    if (st.u && !AVATARS[st.u])
      errs.push(`CHAT「${sc.id}」的發話者「${st.u}」沒有 AVATARS 頭像設定。`);
    if (st.end) hasEnd = true;
  }
}
if (!hasEnd)
  errs.push('CHAT 裡沒有任何一步標了 end:1，玩家走完全部流程也進不了終幕。');
/* 每一份文件都要有人在某一段把它貼出來，或是它自己是玩家找得到的入口。
   `share` 是現在唯一的「交到玩家手上」的方式（我的最愛分頁已停用）。 */
{
  const shared = new Set();
  for (const sc of CHAT ?? [])
    for (const st of sc.steps ?? []) {
      if (st.share) shared.add(st.share);
      for (const o of st.opts ?? [])
        for (const t of o.then ?? []) if (t.share) shared.add(t.share);
    }
  for (const d of DOCS) {
    if (d.filler || d.skin === 'wulou' || d.skin === 'inbox') continue;  // 板上翻得到／信箱本身是關卡
    if (!shared.has(d.id) && d.id !== 'blog')
      errs.push(`DOCS「${d.id}」不在板上、也沒有任何一段 CHAT 把它貼出來，玩家沒有路可以走到它。`);
  }
}
/* 每一次推進 prog 都該有人在群組裡反應，不然玩家會不知道發生了什麼 */
for (const id in AFTER) {
  const at = AFTER[id].unlockAt;
  const src2 = CHAT.map(sc => String(sc.when)).join(' | ');
  if (!src2.includes(`prog>=${at}`) && !src2.includes(`prog >= ${at}`))
    errs.push(`過「${id}」之後 prog 會變成 ${at}，但 CHAT 裡沒有任何一段是等這個值的——這一步過完聊天室會是安靜的。`);
}

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
