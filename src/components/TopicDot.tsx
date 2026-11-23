import { cn } from '@/lib/utils';

// Skips hues 10-40, which sit next to the destructive red (25) and would read as an error.
const hue = (s: string) => (40 + [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 330, 7)) % 360;

export const TopicDot = ({ cat, className }: { cat?: string; className?: string }) => (
  <span
    aria-hidden
    className={cn('inline-block size-2 shrink-0 rounded-full', className)}
    style={{ background: cat ? `oklch(0.7 0.115 ${hue(cat)})` : 'var(--muted-foreground)', opacity: cat ? 1 : 0.4 }}
  />
);
