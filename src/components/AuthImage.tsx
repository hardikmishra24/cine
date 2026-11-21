import React, { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { authedMediaUrl } from '../lib/apiClient';

interface AuthImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}

export function AuthImage({ src, alt, className = '', fallbackTitle }: AuthImageProps) {
  const [resolved, setResolved] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!src) {
      setResolved('');
      return;
    }
    authedMediaUrl(src)
      .then((u) => {
        if (active) setResolved(u);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [src]);

  if (!src || failed || !resolved) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#16171D] to-[#0E0F14] text-[#6B7080] p-4 text-center ${className}`}
      >
        <ImageIcon className="w-5 h-5 mb-1.5 opacity-60" />
        <span className="text-[11px] line-clamp-2 max-w-[180px]">
          {fallbackTitle || alt || 'Archival frame'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
