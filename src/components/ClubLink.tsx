import { ArrowUpRightFromSquare, Xmark } from '@gravity-ui/icons';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export const CLUB_URL = 'https://www.skool.com/wonderpocket/about';
// Classroom of the same community; lessons have no stable per-lesson URL yet.
export const CLASSROOM_URL = 'https://www.skool.com/wonderpocket/classroom';

export function ClubLink({ className, onClose }: { className?: string; onClose?: () => void }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 text-sm text-muted-foreground', className)}>
      <span className="min-w-0 flex-1">{t('clubLine')}</span>
      <Button variant="outline" size="sm" asChild data-icon="end">
        <a href={CLUB_URL} target="_blank" rel="noreferrer">{t('clubButton')}<ArrowUpRightFromSquare /></a>
      </Button>
      {onClose && (
        <Button variant="ghost" size="icon-sm" aria-label={t('close')} title={t('close')} onClick={onClose}><Xmark /></Button>
      )}
    </div>
  );
}
