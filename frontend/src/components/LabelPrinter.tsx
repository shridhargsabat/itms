import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  createContext,
  type ReactNode,
  useContext,
} from 'react';
import { cn } from '@/lib/utils';

export type LabelPrinterStage = 'processing' | 'printing' | 'complete';
export type LabelFeedMotion = 'smooth' | 'stepped';
export type LabelPaperEdge = 'zigzag' | 'straight';

export type LabelPrinterRootProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> & {
  /** Disables all stage transitions when false. */
  animate?: boolean;
  children: ReactNode;
  /** Controls whether the paper feeds continuously or one line at a time. */
  feedMotion?: LabelFeedMotion;
  /** Current state of the printer. */
  stage: LabelPrinterStage;
  /** Zigzag tear-off edge (receipt-style) or straight cut (label roll). */
  paperEdge?: LabelPaperEdge;
  /** Smaller paper/profile for QR labels (vs a tall receipt). */
  compact?: boolean;
};

type LabelPrinterMachineProps = ComponentPropsWithoutRef<'div'>;
type LabelPrinterHeaderProps = ComponentPropsWithoutRef<'div'>;
type LabelPrinterScreenProps = ComponentPropsWithoutRef<'div'>;
type LabelPrinterOutputProps = ComponentPropsWithoutRef<'div'>;
type LabelPrinterPaperProps = ComponentPropsWithoutRef<'article'>;

export type LabelPrinterStatusProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /** Custom status content. Defaults to a label derived from the current stage. */
  children?: ReactNode;
};

type LabelPrinterContextValue = {
  animate: boolean;
  compact: boolean;
  feedMotion: LabelFeedMotion;
  paperEdge: LabelPaperEdge;
  shouldMove: boolean;
  stage: LabelPrinterStage;
};

const LabelPrinterContext = createContext<LabelPrinterContextValue | null>(
  null,
);

const easeOut = [0.23, 1, 0.32, 1] as const;
const easeInOut = [0.77, 0, 0.175, 1] as const;

const receiptToothCount = 40;
const receiptToothDepth = 4;
const receiptToothPoints = Array.from(
  { length: receiptToothCount * 2 },
  (_, index) => {
    const x = 100 - ((index + 1) * 100) / (receiptToothCount * 2);
    const y = index % 2 === 0 ? '100%' : `calc(100% - ${receiptToothDepth}px)`;

    return `${x}% ${y}`;
  },
).join(', ');
const zigzagClipPath = `polygon(0 0, 100% 0, 100% calc(100% - ${receiptToothDepth}px), ${receiptToothPoints})`;

const printingTransformKeyframes = [
  'translateY(calc(-100% + 2px))',
  'translateY(-91%)',
  'translateY(-91%)',
  'translateY(-81%)',
  'translateY(-81%)',
  'translateY(-70%)',
  'translateY(-70%)',
  'translateY(-58%)',
  'translateY(-58%)',
  'translateY(-45%)',
  'translateY(-45%)',
  'translateY(-32%)',
  'translateY(-32%)',
  'translateY(-20%)',
  'translateY(-20%)',
  'translateY(-10%)',
  'translateY(-10%)',
  'translateY(-3%)',
  'translateY(-3%)',
  'translateY(0%)',
];

const printingKeyframeTimes = [
  0, 0.075, 0.105, 0.18, 0.21, 0.285, 0.315, 0.39, 0.42, 0.495, 0.525, 0.6,
  0.63, 0.705, 0.735, 0.81, 0.84, 0.915, 0.945, 1,
];

const statusLabels: Record<LabelPrinterStage, ReactNode> = {
  processing: 'Generating label',
  printing: 'Printing label',
  complete: 'Label printed',
};

function useLabelPrinter(component: string) {
  const context = useContext(LabelPrinterContext);

  if (!context) {
    throw new Error(`${component} must be used inside LabelPrinter.Root.`);
  }

  return context;
}

function LabelPrinterRoot({
  'aria-label': ariaLabel = 'Label printer',
  animate = true,
  children,
  className,
  compact = true,
  feedMotion = 'stepped',
  paperEdge = 'zigzag',
  stage,
  ...props
}: LabelPrinterRootProps) {
  const shouldReduceMotion = useReducedMotion();
  const context = {
    animate,
    compact,
    feedMotion,
    paperEdge,
    shouldMove: animate && !shouldReduceMotion,
    stage,
  };

  return (
    <LabelPrinterContext.Provider value={context}>
      <section
        aria-label={ariaLabel}
        className={cn(
          'relative isolate flex w-full max-w-sm flex-col items-center',
          className,
        )}
        data-stage={stage}
        {...props}
      >
        {children}
      </section>
    </LabelPrinterContext.Provider>
  );
}

function LabelPrinterMachine({
  children,
  className,
  ...props
}: LabelPrinterMachineProps) {
  return (
    <div
      className={cn(
        'relative isolate w-full overflow-hidden rounded-[1.5rem] glass-card p-3 pb-6 shadow-[0_20px_36px_-20px_rgba(2,6,23,0.45),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(2,6,23,0.15)]',
        className,
      )}
      {...props}
    >
      {children}
      <div
        aria-hidden="true"
        className="absolute inset-x-6 bottom-3 z-40 h-2 rounded-[0.25rem] border border-edge2 bg-elevated2 shadow-inner"
      />
    </div>
  );
}

function LabelPrinterHeader({
  children,
  className,
  ...props
}: LabelPrinterHeaderProps) {
  return (
    <div
      className={cn(
        'relative z-10 flex h-10 items-start justify-between',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function LabelPrinterScreen({
  children,
  className,
  ...props
}: LabelPrinterScreenProps) {
  return (
    <div
      className={cn(
        'relative z-10 isolate overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-100 shadow-inner after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[inherit] after:shadow-[inset_0_0_20px_4px_rgba(2,6,23,0.55)] after:content-[""]',
        className,
      )}
      {...props}
    >
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function StatusIndicator({
  animate,
  move,
  stage,
}: {
  animate: boolean;
  move: boolean;
  stage: LabelPrinterStage;
}) {
  const isComplete = stage === 'complete';

  return (
    <span
      aria-hidden="true"
      className="relative grid size-5 shrink-0 place-items-center"
    >
      <AnimatePresence initial={false} mode="sync">
        {isComplete ? (
          <motion.span
            animate={{ opacity: 1, transform: 'scale(1)' }}
            className="col-start-1 row-start-1 grid place-items-center text-emerald-400"
            exit={{
              opacity: animate ? 0 : 1,
              transform: move ? 'scale(0.96)' : 'scale(1)',
            }}
            initial={{
              opacity: animate ? 0 : 1,
              transform: move ? 'scale(0.94)' : 'scale(1)',
            }}
            key="complete"
            transition={{ duration: animate ? 0.16 : 0, ease: easeOut }}
          >
            <CheckCircle2 className="fill-current" size={18} />
          </motion.span>
        ) : (
          <motion.span
            animate={{ opacity: 1, transform: 'scale(1)' }}
            className="col-start-1 row-start-1 grid place-items-center text-slate-300"
            exit={{
              opacity: animate ? 0 : 1,
              transform: move ? 'scale(0.96)' : 'scale(1)',
            }}
            initial={{
              opacity: animate ? 0 : 1,
              transform: move ? 'scale(0.94)' : 'scale(1)',
            }}
            key="working"
            transition={{ duration: animate ? 0.16 : 0, ease: easeOut }}
          >
            <LoaderCircle
              className={cn(animate && 'animate-spin motion-reduce:animate-none')}
              size={18}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function LabelPrinterStatus({
  children,
  className,
  ...props
}: LabelPrinterStatusProps) {
  const { animate, shouldMove, stage } = useLabelPrinter(
    'LabelPrinter.Status',
  );

  return (
    <div
      className={cn('flex min-w-0 items-center gap-2', className)}
      {...props}
    >
      <StatusIndicator animate={animate} move={shouldMove} stage={stage} />
      <div
        aria-live="polite"
        className="grid min-w-0 flex-1 items-center"
        role="status"
      >
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            className="col-start-1 row-start-1 truncate text-xs font-medium leading-none text-slate-200"
            exit={{
              opacity: animate ? 0 : 1,
              transform: shouldMove ? 'translateY(-4px)' : 'translateY(0px)',
            }}
            initial={{
              opacity: animate ? 0 : 1,
              transform: shouldMove ? 'translateY(4px)' : 'translateY(0px)',
            }}
            key={stage}
            transition={{ duration: animate ? 0.18 : 0, ease: easeOut }}
          >
            {children ?? statusLabels[stage]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function LabelPrinterPaper({
  children,
  className,
  style,
  ...props
}: LabelPrinterPaperProps) {
  const { paperEdge } = useLabelPrinter('LabelPrinter.Paper');
  const clipPath =
    paperEdge === 'zigzag' ? zigzagClipPath : 'polygon(0 0, 100% 0, 100% 100%, 0 100%)';

  return (
    <article
      className={cn(
        'relative z-10 bg-white px-5 py-4 font-mono text-slate-900',
        className,
      )}
      style={{ clipPath, ...style }}
      {...props}
    >
      {children}
    </article>
  );
}

function LabelPrinterOutput({
  children,
  className,
  ...props
}: LabelPrinterOutputProps) {
  const { animate, compact, feedMotion, shouldMove, stage } = useLabelPrinter(
    'LabelPrinter.Output',
  );
  const isPaperVisible = stage !== 'processing';
  const shouldUseSteppedFeed =
    feedMotion === 'stepped' && stage === 'printing' && shouldMove;

  return (
    <div
      className={cn(
        'relative z-50 -mt-4 w-[calc(80%+3rem)] max-w-full overflow-hidden px-6',
        compact ? 'h-44' : 'h-[32rem]',
        className,
      )}
      {...props}
    >
      {isPaperVisible ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 -top-1 z-20 h-2 bg-black/40 blur-[6px]"
        />
      ) : null}

      <motion.div
        animate={{
          opacity: isPaperVisible ? 1 : 0,
          transform:
            stage === 'printing' && shouldMove
              ? shouldUseSteppedFeed
                ? printingTransformKeyframes
                : 'translateY(0%)'
              : isPaperVisible || !shouldMove
                ? 'translateY(0%)'
                : 'translateY(calc(-100% + 2px))',
        }}
        aria-hidden={stage !== 'complete'}
        className="relative isolate before:pointer-events-none before:absolute before:inset-x-3 before:top-3 before:bottom-4 before:z-0 before:rounded-sm before:shadow-[0_8px_24px_rgba(2,6,23,0.35)] before:content-['']"
        initial={false}
        transition={{
          opacity: { duration: animate ? 0.16 : 0, ease: easeOut },
          transform: {
            duration: shouldMove ? 1.75 : 0,
            ease: shouldUseSteppedFeed ? 'linear' : easeInOut,
            times: shouldUseSteppedFeed ? printingKeyframeTimes : undefined,
          },
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

export const LabelPrinter = {
  Header: LabelPrinterHeader,
  Machine: LabelPrinterMachine,
  Output: LabelPrinterOutput,
  Paper: LabelPrinterPaper,
  Root: LabelPrinterRoot,
  Screen: LabelPrinterScreen,
  Status: LabelPrinterStatus,
};