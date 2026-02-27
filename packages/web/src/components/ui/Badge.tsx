import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'danger';
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ children, variant = 'primary', className, ...props }, ref) => {
    const variantStyles = {
      primary: 'badge-primary',
      secondary: 'badge-secondary',
      accent: 'badge-accent',
      success: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
      warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
      danger: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    };

    return (
      <span
        ref={ref}
        className={cn('badge', variantStyles[variant], className)}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
