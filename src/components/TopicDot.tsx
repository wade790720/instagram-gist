import { cn } from '@/lib/utils';

// Linear-style label dot: each topic gets a stable hue from its name, same lightness and chroma
// for all (LCH), so no topic looks more important than another.
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 360, 7);

export const TopicDot = ({ cat, className }: { cat?: string; className?: string }) => (
  <span
    aria-hidden
    className={cn('inline-block size-2 shrink-0 rounded-full', className)}
    style={{ background: cat ? `oklch(0.7 0.13 ${hue(cat)})` : 'var(--muted-foreground)', opacity: cat ? 1 : 0.4 }}
  />
);
