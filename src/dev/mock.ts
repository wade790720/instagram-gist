import zh from '../../public/_locales/zh_TW/messages.json';
import en from '../../public/_locales/en/messages.json';
import { putCover } from '@/lib/thumbs';

// ?lang=en previews the English UI with English sample data (used by scripts/store-shots.mjs).
const english = new URLSearchParams(globalThis.location?.search).get('lang') === 'en'; // tests run in Node: no location
const msgs = (english ? en : zh) as Record<string, { message: string }>;
const cats = english
  ? ['Friends', 'Marketing', 'Tech', 'Design', 'Photography', 'Lifestyle', 'Music']
  : ['好友', '行銷商業', '科技資訊', '藝術設計', '攝影剪輯', '生活休閒', '音樂影視'];
const names = ['angiewong_98', 'pb_design_lab', 'aiposthub', 'kevin_learn', 'plantica_jp', 'jessie.chu51', 'harryspeaks_', 'tenten.co', 'maxstudio.biz', 'growithfyn', 'olga.passione', 'joshuavermillion'];
const following = Array.from({ length: 48 }, (_, i) => ({
  id: String(i), username: names[i % names.length] + (i >= names.length ? i : ''), name: ['Angie Wong', '設計實驗室｜AI × 設計', 'AI郵報', '凱文設計 Kevin', 'plantica', '朱德淮'][i % 6],
  private: i % 3 === 0, mutual: i % 2 === 0, verified: false, pic: '', cat: i % 9 === 8 ? undefined : cats[i % cats.length],
}));
const saved = Array.from({ length: 24 }, (_, i) => ({
  id: 's' + i, code: 'C' + i, user: names[i % names.length], type: (['image', 'video', 'carousel'] as const)[i % 3], takenAt: 0, pic: '',
  caption: (english
    ? ['Comment "LEARN" and I will send you the full guide. Save this for the next time you get stuck.', 'Seven prompts that make your assistant think like a founder: market, leverage, traffic, systems.', 'Sales = pain point + solution. Three real examples, broken down.']
    : ['留言「LEARN」，我把整份資源發給你。看完先存起來，下次卡關時會用到。', '這七個指令讓 Claude 進入創辦人模式：從市場、槓桿、流量、系統等方向思考。', '銷售 = 痛點情境 + 解決方案。三個真實案例拆解。'])[i % 3],
  alt: '', cat: cats[(i % 4) + 1],
  ...(i % 7 === 6 ? { thumb: '' } : { thumb: 'mock', w: 1080, h: [1350, 1080, 1920, 1440][i % 4] }),
}));
function sampleCover(i: number, h: number) {
  const a = (i * 53) % 360, b = (a + 70) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(0.62 0.14 ${a})"/><stop offset="1" stop-color="oklch(0.4 0.12 ${b})"/></linearGradient></defs><rect width="1080" height="${h}" fill="url(#g)"/></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
}
const summaries = {
  行銷商業: [{ id: 'd1', text: '• 重點｜銷售公式：痛點情境 + 解決方案，先描述讀者的處境，再給可以照做的方法 [1][3]\n• 做法｜開場鉤子：\n   ◦ 前 3 秒用反差句留住陌生人，例如「我花了三年才發現」[2]\n   ◦ 字卡第一張只放一句話，字級要大到手機上不用放大 [3]\n• 照做｜今天就試：把最近一支影片的開頭改成反差句，比較 3 秒留存 [2]\n• 留意｜留言換資源：回覆要用私訊送出，避免被當成垃圾留言 [4]', sourceIds: ['s1', 's5', 's9', 's13'], notes: ['收斂成固定公式'], at: Date.now() }, { id: 'd2', title: '編輯筆記', sourceIds: ['s1', 's5', 's9', 's13'], at: Date.now(), text: '先講處境，再給方法', edited: {
    thesis: '內容能不能賣，取決於前 3 秒有沒有說中讀者的處境，而不是方法多完整。',
    chapters: [
      { claim: '先說中痛點，方法才有人聽', points: [{ text: '銷售公式是痛點情境加解決方案', sources: [1, 3, 4], kind: 'principle' as const }, { text: '三個真實案例都先寫處境再給做法', sources: [3], kind: 'case' as const }] },
      { claim: '開場只做一件事：留住陌生人', points: [{ text: '開場三步', sources: [2], kind: 'principle' as const, steps: ['說出讀者的處境', '丟一句反差', '承諾看完能得到什麼'] }, { text: '字卡第一張只放一句話', sources: [3], kind: 'principle' as const }] },
    ],
    tensions: [{ a: { text: '開頭要立刻給答案', sources: [1] }, b: { text: '先製造懸念再給答案', sources: [2] } }],
    actions: ['把最近一支影片的第一句改成反差句'],
    resources: [{ text: '行銷免費直播，2026/5/30', sources: [4] }],
    thin: 2,
  } }],
};
const avatars = Object.fromEntries([...names].map((n, i) => [n, `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="oklch(0.72 0.12 ${(i * 47) % 360})"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="white" font-family="sans-serif">${n[0].toUpperCase()}</text></svg>`)}`]));
let store: Record<string, unknown> = {
  following, saved, summaries, avatars,
  settings: { apiKey: 'dev', lang: english ? 'en' : 'zh' },
  lastSync: { saved: Date.now() - 36e5, following: Date.now() - 864e5 },
};

Object.assign(globalThis, {
  chrome: {
    i18n: {
      getMessage: (k: string, a: string[] = []) => (msgs[k]?.message || '').replace(/\$(\d)/g, (_, i) => a[i - 1] ?? ''),
      getUILanguage: () => (english ? 'en' : 'zh-TW'),
    },
    storage: {
      local: {
        get: async () => structuredClone(store),
        set: async (v: Record<string, unknown>) => { store = { ...store, ...structuredClone(v) }; },
        clear: async () => { store = {}; },
        remove: async (keys: string[]) => { for (const k of keys) delete store[k]; },
      },
    },
  },
});

// Covers go into the real cover cache, so useThumb reads them the way it reads synced ones. Node (npm test) has no Cache API.
if (globalThis.caches) for (const [i, p] of saved.entries()) if ('h' in p) await putCover(p.id, sampleCover(i, p.h));
