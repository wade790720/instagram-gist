export const t = (key: string, ...args: (string | number)[]) => chrome.i18n.getMessage(key, args.map(String)) || key;

export const when = (ts?: number) => (ts ? new Date(ts).toLocaleString() : t('never'));
