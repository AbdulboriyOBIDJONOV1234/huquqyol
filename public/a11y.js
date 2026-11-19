// Qulaylik: shrift o‘lchami va ovozli o‘qish (keksalar va ko‘rishi zaif foydalanuvchilar uchun).
// Ovoz brauzerning o‘zida sintez qilinadi (Web Speech API): matn serverga yuborilmaydi.
import { toCyrillic } from "./translit.js";

/* ---------- Shrift o‘lchami ---------- */
// 0 — oddiy, 1 — katta, 2 — juda katta, 3 — eng katta. Cookie: server sahifani shu o‘lchamda chizadi (sakrash bo‘lmaydi).
export const FS_LEVELS = 4;
const FS_COOKIE = "hy_fs";
export function getFs(){
  const v = Number(document.documentElement.dataset.fs || /(?:^|;\s*)hy_fs=([0-3])/.exec(document.cookie)?.[1] || 0);
  return v >= 0 && v < FS_LEVELS ? v : 0;
}
export function setFs(level){
  const v = Math.max(0, Math.min(FS_LEVELS - 1, Number(level) || 0));
  if (v) document.documentElement.dataset.fs = String(v); else delete document.documentElement.dataset.fs;
  document.cookie = `${FS_COOKIE}=${v}; Max-Age=${365 * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return v;
}

/* ---------- Ovozli o‘qish ---------- */
const synth = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window ? window.speechSynthesis : null;
export const ttsSupported = () => !!synth;

let voices = [];
const loadVoices = () => { voices = synth ? synth.getVoices() : []; };
if (synth){ loadVoices(); synth.addEventListener?.("voiceschanged", loadVoices); }
const waitVoices = () => voices.length || !synth ? Promise.resolve() : new Promise(r => { const done = () => { loadVoices(); r(); }; synth.addEventListener?.("voiceschanged", done, { once:true }); setTimeout(done, 1200); });
const byLang = re => voices.filter(v => re.test(v.lang.replace("_", "-")));
// Tabiiy (Natural/Online) ovozlar odatda tushunarliroq
const best = list => list.find(v => /natural|online|neural/i.test(v.name)) || list.find(v => v.localService) || list[0] || null;

// Til bo‘yicha ovoz: uz → o‘zbekcha; bo‘lmasa rus ovozi (matn kirillga o‘giriladi). ru → ruscha.
export async function pickVoice(lang){
  await waitVoices();
  if (lang === "ru"){ const v = best(byLang(/^ru/i)); return v ? { voice:v, mode:"native" } : { voice:null, mode:"default" }; }
  const uz = best(byLang(/^uz/i));
  if (uz) return { voice:uz, mode:"native" };
  const ru = best(byLang(/^ru/i));
  return ru ? { voice:ru, mode:"ru" } : { voice:null, mode:"default" };
}

// O‘qish uchun matnni tozalash: belgilar, qisqartmalar, telefon raqamlari
function clean(text, lang){
  let s = String(text ?? "")
    .replace(/[↗↓→←✓✎]/g, " ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/(\d)-(?=\d)/g, "$1 ")                    // 200-06-00 → «200 06 00», minus deb o‘qilmaydi
    .replace(/_{3,}/g, " ")                            // imzo chizig‘i
    .replace(/\s+/g, " ").trim();
  if (lang !== "ru") s = s.replace(/\bsh\.(?=\s|,)/g, "shahri").replace(/\bt\.(?=\s|,)/g, "tumani").replace(/\bш\.(?=\s|,)/g, "шаҳри").replace(/\bт\.(?=\s|,)/g, "тумани");
  return s;
}
// Rus ovozi o‘zbekcha kirill harflarini o‘qiy olishi uchun yaqin tovushga almashtirish
const forRuVoice = s => toCyrillic(s).replace(/ў/g, "у").replace(/Ў/g, "У").replace(/қ/g, "к").replace(/Қ/g, "К").replace(/ғ/g, "г").replace(/Ғ/g, "Г").replace(/ҳ/g, "х").replace(/Ҳ/g, "Х");

// Uzun matn gaplarga bo‘linadi: ayrim brauzerlar uzun ovozni o‘rtasida to‘xtatadi
function chunks(text, max = 220){
  const out = [];
  for (const sent of text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text]){
    let s = sent.trim(); if (!s) continue;
    while (s.length > max){ const cut = s.lastIndexOf(" ", max); const at = cut > 40 ? cut : max; out.push(s.slice(0, at)); s = s.slice(at).trim(); }
    if (s) out.push(s);
  }
  return out;
}

const READING = "tts-reading";
let session = 0, current = null;
const mark = el => { document.querySelectorAll("." + READING).forEach(x => x.classList.remove(READING)); if (el){ el.classList.add(READING);
  const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight) el.scrollIntoView({ block:"center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } };

// items: [{ text, el? }] — el o‘qilayotganda belgilanadi. onState("playing" | "paused" | "ended" | "error")
export async function speak(items, { lang = "uz", rate = 1, onState = () => {} } = {}){
  if (!synth) return { ok:false, mode:"none" };
  stop();
  const id = ++session;
  const { voice, mode } = await pickVoice(lang);
  if (id !== session) return { ok:false, mode };
  const queue = [];
  for (const it of items){
    let txt = clean(it.text, lang); if (!txt) continue;
    if (mode === "ru") txt = forRuVoice(txt);
    for (const c of chunks(txt)) queue.push({ text:c, el:it.el || null });
  }
  if (!queue.length) return { ok:false, mode };
  const langTag = lang === "ru" || mode === "ru" ? "ru-RU" : "uz-UZ";
  current = { onState };
  onState("playing");
  queue.forEach((q, i) => {
    const u = new SpeechSynthesisUtterance(q.text);
    u.lang = voice?.lang || langTag; if (voice) u.voice = voice; u.rate = rate; u.pitch = 1;
    u.onstart = () => { if (id === session) mark(q.el); };
    u.onend = () => { if (id === session && i === queue.length - 1){ mark(null); current = null; onState("ended"); } };
    u.onerror = e => { if (id === session && e.error !== "interrupted" && e.error !== "canceled"){ mark(null); current = null; onState("error"); } };
    synth.speak(u);
  });
  return { ok:true, mode };
}
export function pause(){ if (!synth || !current) return; if (synth.paused){ synth.resume(); current.onState("playing"); } else { synth.pause(); current.onState("paused"); } }
export function stop(){
  if (!synth) return;
  session++;
  const c = current; current = null;
  synth.cancel(); mark(null);
  c?.onState("ended");
}
export const isSpeaking = () => !!current;
