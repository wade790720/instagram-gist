// Dev only (`npm run dev`): a fake `chrome` with sample data, so the UI runs as a plain web page.
// main.tsx loads this only when import.meta.env.DEV and chrome.storage is missing.
import zh from '../../public/_locales/zh_TW/messages.json';

const msgs = zh as Record<string, { message: string }>;
const cats = ['好友', '行銷商業', '科技資訊', '藝術設計', '攝影剪輯', '生活休閒', '音樂影視'];
const names = ['angiewong_98', 'pb_design_lab', 'aiposthub', 'kevin_learn', 'plantica_jp', 'jessie.chu51', 'harryspeaks_', 'tenten.co', 'maxstudio.biz', 'growithfyn', 'olga.passione', 'joshuavermillion'];
const following = Array.from({ length: 48 }, (_, i) => ({
  id: String(i), username: names[i % names.length] + (i >= names.length ? i : ''), name: ['Angie Wong', '設計實驗室｜AI × 設計', 'AI郵報', '凱文設計 Kevin', 'plantica', '朱德淮'][i % 6],
  private: i % 3 === 0, verified: false, pic: '', cat: i % 9 === 8 ? undefined : cats[i % cats.length],
}));
const saved = Array.from({ length: 24 }, (_, i) => ({
  id: 's' + i, code: 'C' + i, user: names[i % names.length], type: (['image', 'video', 'carousel'] as const)[i % 3], takenAt: 0, pic: '',
  caption: ['留言「LEARN」，我把整份資源發給你。看完先存起來，下次卡關時會用到。', '這七個指令讓 Claude 進入創辦人模式：從市場、槓桿、流量、系統等方向思考。', '銷售 = 痛點情境 + 解決方案。三個真實案例拆解。'][i % 3],
  alt: '', cat: cats[(i % 4) + 1],
  // Sample covers in IG's usual shapes (4:5, 1:1, 9:16, 3:4); i % 7 === 6 has none, to show the caption fallback.
  ...(i % 7 === 6 ? { thumb: '' } : sampleCover(i, [1350, 1080, 1920, 1440][i % 4])),
}));
function sampleCover(i: number, h: number) {
  const a = (i * 53) % 360, b = (a + 70) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(0.62 0.14 ${a})"/><stop offset="1" stop-color="oklch(0.4 0.12 ${b})"/></linearGradient></defs><rect width="1080" height="${h}" fill="url(#g)"/></svg>`;
  return { thumb: `data:image/svg+xml,${encodeURIComponent(svg)}`, w: 1080, h };
}
const summaries = {
  行銷商業: [{ id: 'd1', text: '• 銷售公式：痛點情境 + 解決方案，先描述讀者的處境再給方法 [1][3]\n• 開場 3 秒用反差鉤子留住陌生人 [2]\n• 留言關鍵字換資源，提高互動與觸及 [4]', sourceIds: ['s1', 's5', 's9', 's13'], notes: ['收斂成固定公式'], at: Date.now() }],
};
// Placeholder avatars: a coloured circle per name, so the list looks like real data.
const avatars = Object.fromEntries([...names].map((n, i) => [n, `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="oklch(0.72 0.12 ${(i * 47) % 360})"/><text x="20" y="26" font-size="16" text-anchor="middle" fill="white" font-family="sans-serif">${n[0].toUpperCase()}</text></svg>`)}`]));
let store: Record<string, unknown> = {
  following, saved, summaries, avatars,
  settings: { apiKey: 'dev', lang: 'zh' },
  lastSync: { saved: Date.now() - 36e5, following: Date.now() - 864e5 },
};

Object.assign(globalThis, {
  chrome: {
    i18n: {
      getMessage: (k: string, a: string[] = []) => (msgs[k]?.message || '').replace(/\$(\d)/g, (_, i) => a[i - 1] ?? ''),
      getUILanguage: () => 'zh-TW',
    },
    storage: {
      local: {
        get: async () => structuredClone(store),
        set: async (v: Record<string, unknown>) => { store = { ...store, ...structuredClone(v) }; },
        clear: async () => { store = {}; },
      },
    },
  },
});
