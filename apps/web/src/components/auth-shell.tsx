import Image from 'next/image';
import Link from 'next/link';
import { MonitorDown } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';

type AuthShellProps = {
  watermark: string;
  children: React.ReactNode;
  className?: string;
};

export function AuthShell({ watermark, children, className }: AuthShellProps) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden overflow-y-auto bg-primary-deep text-white">
      {/* Hero image */}
      <div className="pointer-events-none absolute inset-0 select-none">
        <Image
          src="/auth-proposal-stand.webp"
          alt=""
          fill
          priority
          className="object-cover object-left opacity-35 motion-safe:md:animate-auth-drift"
          sizes="(max-width: 768px) 100vw, 1200px"
          quality={70}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-primary-deep/95 via-primary/88 to-primary-light/75 mix-blend-multiply" />
        <div className="absolute inset-0 auth-geo opacity-40" />
        {/* Geometric accent frames — desktop only */}
        <div className="hidden sm:block absolute left-[8%] top-[18%] h-48 w-48 border border-white/10 rotate-12 motion-safe:animate-auth-fade" />
        <div className="hidden sm:block absolute left-[14%] top-[28%] h-64 w-64 border border-white/10 -rotate-6" />
      </div>

      {/* Watermark */}
      <div
        className="pointer-events-none absolute inset-x-0 top-[18%] sm:top-[22%] text-center select-none motion-safe:animate-auth-fade overflow-hidden"
        aria-hidden
      >
        <p className="font-display text-[clamp(2.75rem,12vw,9rem)] leading-none font-semibold text-white/[0.07] tracking-tight whitespace-nowrap">
          {watermark}
        </p>
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 sm:px-10 py-5 sm:py-6">
        <BrandMark variant="light" href="/login" />
        <Link href="/download" aria-label="Download the Windows app" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-xs sm:text-sm text-white/90 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          <MonitorDown size={16}/><span className="hidden sm:inline">Download for Windows</span><span className="sm:hidden">Download</span>
        </Link>
      </header>

      {/* Form stage */}
      <main
        className={cn(
          'relative z-10 flex min-h-[calc(100dvh-5rem)] items-center justify-center sm:justify-end px-4 sm:px-12 lg:px-20 pb-12 sm:pb-16',
          className,
        )}
      >
        <div className="w-full max-w-md motion-safe:animate-auth-rise">{children}</div>
      </main>
    </div>
  );
}
