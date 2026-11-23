import {
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Vec2,
  computeDirectionalScale,
  computeSpecularAngle,
  generateLiquidDisplacementMap,
} from '@/lib/liquid-glass-shader';
import { getResolvedTheme, onThemeChanged } from '@/lib/theme';
import { THEME_REGISTRY } from '@/lib/theme-registry';
import { cn } from '@/lib/utils';

export const LIQUID_GLASS_FILTER_ID = 'itms-liquid-glass-refract';

/** Reactive hook: true only when the active resolved theme has `glass: true` (light, dark, system). */
export function useIsLiquidGlassTheme(): boolean {
  const [isGlass, setIsGlass] = useState<boolean>(() => THEME_REGISTRY[getResolvedTheme()].glass);

  useEffect(() => {
    const sync = () => setIsGlass(THEME_REGISTRY[getResolvedTheme()].glass);
    sync();
    return onThemeChanged(sync);
  }, []);

  return isGlass;
}

/**
 * Shared SVG displacement filter bank ported from rdev/liquid-glass-react.
 * Mounted once at the root of Layout / LegacyLogin so every `.glass-card` and
 * `<LiquidGlassSurface>` can reference `url(#itms-liquid-glass-refract)` without
 * duplicating 40KB SVG filter trees per card.
 */
export function LiquidGlassFilterBank({
  displacementScale = 28,
  aberrationIntensity = 2,
}: {
  displacementScale?: number;
  aberrationIntensity?: number;
}) {
  const isGlass = useIsLiquidGlassTheme();
  const mapUrl = useMemo(() => (isGlass ? generateLiquidDisplacementMap(160, 160) : ''), [isGlass]);

  if (!isGlass) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed h-0 w-0 overflow-hidden opacity-0"
      width="0"
      height="0"
    >
      <defs>
        <filter
          id={LIQUID_GLASS_FILTER_ID}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="DISPLACEMENT_MAP"
            href={mapUrl}
            preserveAspectRatio="none"
          />
          <feColorMatrix
            in="DISPLACEMENT_MAP"
            type="matrix"
            values="0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0"
            result="EDGE_INTENSITY"
          />
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA type="discrete" tableValues={`0 ${aberrationIntensity * 0.05} 1`} />
          </feComponentTransfer>

          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

          {/* Red channel displacement */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={displacementScale}
            xChannelSelector="R"
            yChannelSelector="B"
            result="RED_DISPLACED"
          />
          <feColorMatrix
            in="RED_DISPLACED"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="RED_CHANNEL"
          />

          {/* Green channel displacement */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={displacementScale * (1 - aberrationIntensity * 0.05)}
            xChannelSelector="R"
            yChannelSelector="B"
            result="GREEN_DISPLACED"
          />
          <feColorMatrix
            in="GREEN_DISPLACED"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="GREEN_CHANNEL"
          />

          {/* Blue channel displacement */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={displacementScale * (1 - aberrationIntensity * 0.1)}
            xChannelSelector="R"
            yChannelSelector="B"
            result="BLUE_DISPLACED"
          />
          <feColorMatrix
            in="BLUE_DISPLACED"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="BLUE_CHANNEL"
          />

          {/* Screen-blend RGB channels for Apple-style chromatic edge refraction */}
          <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED" />
          <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED" />
          <feGaussianBlur
            in="RGB_COMBINED"
            stdDeviation={Math.max(0.1, 0.5 - aberrationIntensity * 0.1)}
            result="ABERRATED_BLURRED"
          />
          <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />

          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
          <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
        </filter>
      </defs>
    </svg>
  );
}

export interface LiquidGlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'header' | 'aside';
  variant?: 'card' | 'chrome' | 'dense';
  /**
   * Opt-in Apple elastic cursor stretch. Keep FALSE on containers that host
   * position:fixed or position:sticky descendants (Modal, Layout, DataTable).
   */
  elastic?: boolean;
  elasticity?: number;
  /** Render top radial hover/active highlight sheen (rdev/liquid-glass-react style). */
  interactive?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<'card' | 'chrome' | 'dense', string> = {
  card: 'glass-card',
  chrome: 'glass-chrome',
  dense: 'glass-dense',
};

export function LiquidGlassSurface({
  as: Tag = 'div',
  variant = 'card',
  elastic = false,
  elasticity = 0.12,
  interactive = false,
  className,
  style,
  children,
  onPointerMove,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onPointerUp,
  ...rest
}: LiquidGlassSurfaceProps) {
  const isGlass = useIsLiquidGlassTheme();
  const ref = useRef<HTMLElement | null>(null);
  const [mouseOffset, setMouseOffset] = useState<Vec2>({ x: 0, y: 0 });
  const [elasticScale, setElasticScale] = useState<string>('scale(1)');
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      onPointerMove?.(e);
      if (!isGlass) return;
      const el = ref.current;
      const rect = el?.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : 280;
      const height = rect && rect.height > 0 ? rect.height : 120;
      const left = rect ? rect.left : 0;
      const top = rect ? rect.top : 0;

      const offsetX = Math.max(-50, Math.min(50, ((e.clientX - (left + width / 2)) / width) * 100));
      const offsetY = Math.max(-50, Math.min(50, ((e.clientY - (top + height / 2)) / height) * 100));
      setMouseOffset({ x: offsetX, y: offsetY });

      if (elastic && rect) {
        setElasticScale(computeDirectionalScale({ x: e.clientX, y: e.clientY }, rect, elasticity));
      }
    },
    [isGlass, elastic, elasticity, onPointerMove],
  );

  const handlePointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      onPointerLeave?.(e);
      setHovered(false);
      setActive(false);
      if (isGlass) {
        setMouseOffset({ x: 0, y: 0 });
        if (elastic) setElasticScale('scale(1)');
      }
    },
    [isGlass, elastic, onPointerLeave],
  );

  if (!isGlass) {
    return (
      <Tag className={cn(VARIANT_CLASS[variant], className)} style={style} {...rest}>
        {children}
      </Tag>
    );
  }

  const spec = computeSpecularAngle(mouseOffset);
  const specularGradient = `linear-gradient(${spec.angleDeg}deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${spec.stop1Opacity.toFixed(3)}) ${spec.stop1Pct}%, rgba(255,255,255,${spec.stop2Opacity.toFixed(3)}) ${spec.stop2Pct}%, rgba(255,255,255,0) 100%)`;

  const mergedStyle: CSSProperties = {
    ...style,
    ...(elastic && elasticScale !== 'scale(1)' ? { transform: elasticScale } : {}),
  };

  const xorMaskStyle: CSSProperties = {
    borderRadius: 'inherit',
    padding: '1.25px',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    background: specularGradient,
  };

  return (
    <Tag
      ref={ref as never}
      data-liquid-glass="active"
      className={cn('relative', VARIANT_CLASS[variant], className)}
      style={mergedStyle}
      onPointerMove={handlePointerMove}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        setHovered(true);
      }}
      onPointerLeave={handlePointerLeave}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        setActive(true);
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        setActive(false);
      }}
      {...rest}
    >
      {/* rdev/liquid-glass-react dual xor-masked specular edge layers */}
      <span
        aria-hidden="true"
        data-testid="liquid-glass-specular"
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] mix-blend-screen opacity-40"
        style={xorMaskStyle}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] mix-blend-overlay opacity-75"
        style={xorMaskStyle}
      />
      {interactive && (
        <span
          aria-hidden="true"
          data-testid="liquid-glass-sheen"
          className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] mix-blend-overlay transition-opacity duration-200"
          style={{
            opacity: active ? 0.55 : hovered ? 0.35 : 0,
            backgroundImage:
              'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 65%)',
          }}
        />
      )}
      {children}
    </Tag>
  );
}
