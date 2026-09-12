import { ReactNode } from 'react';

type Props = {
  text: string;
  className?: string;
  children?: ReactNode;
};

export function TooltipInfo({ text, className = '', children }: Props) {
  return (
    <span className={`tooltip-wrap ${className}`.trim()} tabIndex={0} aria-label={text}>
      <span className="tooltip-trigger">{children ?? '?'}</span>
      <span role="tooltip" className="tooltip-bubble">{text}</span>
    </span>
  );
}
