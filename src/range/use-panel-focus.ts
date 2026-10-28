import {useEffect, type RefObject} from 'react';

export function usePanelFocus(ref: RefObject<HTMLElement>, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    (panel?.querySelector<HTMLElement>('[data-panel-autofocus]') ?? panel)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault(); close(); return;}
      if (event.key !== 'Tab') return;
      // Closed disclosures and inactive tab panels must not become trap endpoints.
      const elements = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,textarea:not(:disabled),[tabindex="0"]') ?? [])
        .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'));
      if (!elements.length) {event.preventDefault(); panel?.focus(); return;}
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {event.preventDefault(); first.focus();}
    };
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus({preventScroll: true});};
  }, [active, close, ref]);
}
