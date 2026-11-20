// Anonim statistika: qaysi sohada va holatda nechta murojaat bo‘lganini sanaydi.
// SAQLANMAYDI: foydalanuvchi matni, ariza ma’lumotlari, IP manzil, cookie, brauzer ma’lumoti.
// Faqat sanoqlar: holat bo‘yicha ochilishlar, yasalgan hujjatlar, doiradan tashqari so‘rovlar, kunlar kesimida.
//
// Takroriy sanashning oldini olish (bir kishi bir kunda bir holatni bir marta): IP va holat
// tasodifiy kalit bilan HMAC qilinadi, iz faqat xotirada turadi va har kuni kalit bilan birga o‘chiriladi.
// Diskka hech qachon yozilmaydi — undan IP ni tiklab bo‘lmaydi.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP_DAYS = 400;
const MAX_SEEN = 200_000;
// Toshkent vaqti (UTC+5, yozgi vaqt yo‘q) bo‘yicha kun
export const dayOf = (ms = Date.now()) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);

const empty = now => ({ v: 1, since: dayOf(now), opens: {}, docs: {}, analyze: { total: 0, outOfScope: 0 }, days: {} });
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const SAFE_ID = /^[a-z0-9_]{1,40}$/;

// Fayl faqat server start() orqali ulanadi (attachFile): ilovani import qilgan testlar va skriptlar diskka yozmaydi
export const DEFAULT_FILE = process.env.STATS_FILE || join(ROOT, "data", "stats.json");

export function createStats({ file = null, enabled = process.env.STATS !== "0", now = () => Date.now(), flushMs = 30_000 } = {}){
  let data = empty(now());
  const load = f => {
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      if (d && d.v === 1) data = { ...empty(now()), ...d, analyze: { ...empty(now()).analyze, ...d.analyze } };
    } catch {}
  };
  if (enabled && file) load(file);
  let dirty = false, day = dayOf(now()), salt = randomBytes(32), seen = new Set();
  const rotate = () => { const d = dayOf(now()); if (d !== day){ day = d; salt = randomBytes(32); seen = new Set(); } };
  // true — birinchi marta (sanaladi), false — bugun shu kishidan allaqachon sanalgan
  const first = (...parts) => {
    rotate();
    const h = createHmac("sha256", salt).update(parts.join("|")).digest("base64url").slice(0, 22);
    if (seen.has(h)) return false;
    if (seen.size >= MAX_SEEN) seen.clear();
    seen.add(h); return true;
  };
  const today = () => { const d = (data.days[day] ||= { opens: {}, docs: 0, outOfScope: 0 }); return d; };
  const prune = () => {
    const cut = dayOf(now() - KEEP_DAYS * 864e5);
    for (const k of Object.keys(data.days)) if (k < cut) delete data.days[k];
  };

  function record(kind, { scenario, domain, ip = "" } = {}){
    if (!enabled) return false;
    rotate();
    if (kind === "open"){
      if (!SAFE_ID.test(scenario || "") || !SAFE_ID.test(domain || "")) return false;
      if (!first("open", ip, scenario)) return false;
      inc(data.opens, scenario); inc(today().opens, domain);
    } else if (kind === "doc"){
      if (!SAFE_ID.test(scenario || "")) return false;
      if (!first("doc", ip, scenario)) return false;
      inc(data.docs, scenario); today().docs++;
    } else if (kind === "analyze"){
      if (!first("analyze", ip, scenario || "")) return false;
      data.analyze.total++;
      if (scenario === "boshqa"){ data.analyze.outOfScope++; today().outOfScope++; }
    } else return false;
    dirty = true;
    return true;
  }

  function flush(){
    if (!enabled || !dirty || !file) return;
    prune();
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, file);            // atomar: yarim yozilgan fayl qolmaydi
      dirty = false;
    } catch (e){ console.warn("[stats] saqlab bo‘lmadi:", e.code || e.message); }
  }
  let timer = null;
  const arm = () => { if (enabled && file && flushMs && !timer){ timer = setInterval(flush, flushMs); timer.unref(); } };
  arm();
  // Serverni ishga tushirishda: mavjud sanoqlarni yuklab, faylga yozishni yoqish
  function attachFile(f){ if (!enabled || !f) return; file = f; load(f); arm(); }

  // Ommaviy ko‘rinish: holatlar → sohalar, kunlar ketma-ketligi
  function summary({ scenarioDomain = {}, days = 30 } = {}){
    const byDomain = {};
    for (const [s, n] of Object.entries(data.opens)){ const d = scenarioDomain[s]; if (d) inc(byDomain, d, n); }
    const docsByDomain = {};
    for (const [s, n] of Object.entries(data.docs)){ const d = scenarioDomain[s]; if (d) inc(docsByDomain, d, n); }
    const series = [];
    for (let i = days - 1; i >= 0; i--){
      const k = dayOf(now() - i * 864e5), d = data.days[k];
      series.push({ day: k, opens: d ? Object.values(d.opens).reduce((a, b) => a + b, 0) : 0, docs: d?.docs || 0 });
    }
    const total = Object.values(data.opens).reduce((a, b) => a + b, 0);
    return {
      enabled, since: data.since, total,
      documents: Object.values(data.docs).reduce((a, b) => a + b, 0),
      analyzed: data.analyze.total, outOfScope: data.analyze.outOfScope,
      byDomain, docsByDomain, byScenario: { ...data.opens }, series
    };
  }
  return { record, flush, summary, attachFile, close(){ if (timer) clearInterval(timer); flush(); }, _data: () => data };
}

export const stats = createStats();
