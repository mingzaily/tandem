import iconUrl from '../assets/tandem-icon.svg';

/** Same arrangement as the reference home page: a 50px icon, then the name beside it. */
export function BrandLockup() {
  return (
    <div className="flex h-[50px] items-center gap-[9px]">
      <img
        src={iconUrl}
        alt=""
        draggable={false}
        className="pointer-events-none size-[50px] shrink-0 select-none drop-shadow-[0_2px_3.65px_rgba(0,0,0,0.15)]"
      />
      <span className="select-none text-[33px] font-extrabold leading-none tracking-[-0.035em] text-[var(--text-primary)]">
        Tandem
        <span aria-hidden className="text-[var(--brand-mark-accent)]">.</span>
      </span>
    </div>
  );
}
