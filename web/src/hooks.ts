import { useCallback, useEffect, useRef, useState } from 'react';

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = () => {
      setVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);
  return visible;
}

/**
 * Run `task` now and then every `intervalMs` while the tab is visible (SPEC §6: the dashboard
 * refreshes every 5 s while open). Hidden tabs stop polling and refresh once on return.
 * A new `task` identity (e.g. another day range) restarts the cycle with an immediate run.
 * The next run is scheduled only after the previous one settles, so slow responses never pile up.
 */
export function usePolling(task: () => Promise<void>, intervalMs: number, enabled = true): boolean {
  const visible = usePageVisible();
  const active = enabled && visible;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      await task().catch(() => undefined);
      if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, intervalMs, task]);
  return active;
}

/** Copy text; `copied` stays true for a moment so the button can say "คัดลอกแล้ว". */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // The Clipboard API needs a secure context (e.g. not http://<LAN IP>): let the user copy.
        window.prompt('คัดลอกลิงก์นี้', text);
        return;
      }
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, resetMs);
    },
    [resetMs],
  );
  return { copied, copy };
}
