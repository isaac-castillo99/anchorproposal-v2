'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '@/app/(dashboard)/templates/templates.module.css';

export function TemplatePreviewFrame({
  html,
  pageSize = 'LETTER',
}: {
  html: string;
  pageSize?: string;
}) {
  const paperRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.45);
  const [natural, setNatural] = useState({
    width: pageSize === 'A4' ? 794 : 816,
    height: pageSize === 'A4' ? 1123 : 1056,
  });

  const fit = useCallback(() => {
    const paper = paperRef.current;
    const page = frameRef.current?.contentDocument?.querySelector('.page') as HTMLElement | null;
    if (!paper) return;
    const width = page?.offsetWidth || (pageSize === 'A4' ? 794 : 816);
    const height = Math.max(
      page?.scrollHeight || 0,
      page?.offsetHeight || 0,
      pageSize === 'A4' ? 1123 : 1056,
    );
    const next = paper.clientWidth > 0 ? paper.clientWidth / width : 1;
    setNatural({ width, height });
    setScale(next > 0 ? next : 1);
  }, [pageSize]);

  useEffect(() => {
    fit();
    const node = paperRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(node);
    return () => observer.disconnect();
  }, [html, fit]);

  return (
    <div ref={paperRef} className={styles.paper} style={{ height: Math.max(1, Math.round(natural.height * scale)) }}>
      {html ? (
        <iframe
          ref={frameRef}
          sandbox="allow-same-origin"
          srcDoc={html}
          title="Resume preview"
          scrolling="no"
          onLoad={fit}
          style={{
            width: natural.width,
            height: natural.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      ) : null}
    </div>
  );
}
