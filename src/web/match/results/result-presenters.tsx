import { useEffect, useRef, useState } from 'react';
import { Triangle, Layers, Fingerprint, ShieldCheck, Database } from 'lucide-react';
import { sizeConsistency, type Result } from '../../../domain/matching/group';
export function LazyReleaseDetails({
  children,
  flat = false,
  ...props
}: {
  children: React.ReactNode[];
  className: string;
  flat?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  if (flat) return <div className="flat-result">{children[1]}</div>;
  return (
    <details {...props} onToggle={(event) => setOpened(event.currentTarget.open)}>
      {children[0]}
      {opened && children[1]}
    </details>
  );
}

export function ReleaseGroupWatermark({ name }: { name: string }) {
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = text.current;
    if (!element) return;
    const container = element.parentElement;
    if (!container) return;
    const fit = () => {
      element.style.fontSize = '';
      const natural = element.scrollWidth;
      const available = container.clientWidth;
      if (natural > available) {
        const size = parseFloat(getComputedStyle(element).fontSize);
        element.style.fontSize = `${(size * available) / natural}px`;
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    fit();
    return () => observer.disconnect();
  }, [name]);
  return (
    <span className="release-group-watermark" aria-hidden="true">
      <span ref={text}>{name}</span>
    </span>
  );
}
export function SizeConsistency({ rows, allowed }: { rows: Result[]; allowed: number }) {
  const stats = sizeConsistency(rows, allowed / 100);
  if (stats.known < 2 || stats.agree === stats.known) return null;
  const label =
    stats.known < 2
      ? 'Not enough reported sizes'
      : `${stats.agree}/${stats.known} sizes within ${allowed}%${!stats.majority ? ' · no majority' : ''}${stats.outliers.length ? ` · ${stats.outliers.length} outlier${stats.outliers.length === 1 ? '' : 's'}` : ''}`;
  return (
    <span
      className={`size-consistency ${stats.outliers.length ? 'has-outliers' : ''}`}
      title={`${label}${stats.missing ? ` · ${stats.missing} missing size` : ''}. Counts are listings.`}
      aria-label={`${label}${stats.missing ? ` · ${stats.missing} missing size` : ''}`}
    >
      <Layers size={12} />
      <span>
        {stats.agree}/{stats.known}
      </span>
      {stats.outliers.length > 0 && <Triangle size={10} />}
    </span>
  );
}
export function MatchEvidence({ evidence, rows }: { evidence: string; rows: Result[] }) {
  if (evidence === 'single') return null;
  const known = rows.map((r) => r.size).filter((size) => size > 0);
  const complete = known.length === rows.length;
  const delta =
    known.length > 1 ? ((Math.max(...known) - Math.min(...known)) / Math.max(...known)) * 100 : 0;
  const label =
    evidence === 'hash'
      ? 'Same infohash'
      : evidence === 'release'
        ? 'High confidence · release metadata and size agree'
        : complete
          ? `Release match · size spread ${delta.toFixed(1)}%`
          : 'Release match · size missing';
  return (
    <span
      className={`match-evidence evidence-${evidence}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {evidence === 'hash' ? (
        <Fingerprint size={14} />
      ) : evidence === 'release' ? (
        <ShieldCheck size={15} />
      ) : (
        <>
          <Triangle size={12} />
          <span>{complete ? `${delta.toFixed(1)}%` : '?'}</span>
        </>
      )}
    </span>
  );
}
export function IndexerIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  const [tint, setTint] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setFailed(false);
    setTint(false);
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth) inspect(image);
  }, [src]);
  function inspect(image: HTMLImageElement) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 32, 32);
      const { data } = context.getImageData(0, 0, 32, 32);
      let weight = 0,
        brightness = 0,
        chroma = 0,
        transparent = 0,
        brightWeight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]! / 255;
        if (alpha < 0.1) transparent++;
        if (alpha < 0.2) continue;
        const r = data[i]!,
          g = data[i + 1]!,
          b = data[i + 2]!;
        if (Math.max(r, g, b) > 140) brightWeight += alpha;
        weight += alpha;
        brightness += (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha;
        chroma += (Math.max(r, g, b) - Math.min(r, g, b)) * alpha;
      }
      // Limit tinting to dark neutral artwork with transparent surroundings.
      setTint(
        weight > 0 &&
          transparent > (data.length / 4) * 0.05 &&
          brightness / weight < 90 &&
          chroma / weight < 18 &&
          brightWeight / weight < 0.02,
      );
    } catch {
      setTint(false);
    }
  }
  return (
    <span className="result-indexer-icon" aria-hidden="true">
      {src && !failed ? (
        <img
          ref={imageRef}
          className={tint ? 'icon-neutral-tint' : undefined}
          src={src}
          alt=""
          loading="lazy"
          onLoad={(e) => inspect(e.currentTarget)}
          onError={() => setFailed(true)}
        />
      ) : (
        <Database size={12} />
      )}
    </span>
  );
}
