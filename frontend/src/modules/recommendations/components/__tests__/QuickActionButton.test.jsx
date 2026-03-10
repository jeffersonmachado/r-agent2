import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickActionButton } from '../QuickActionButton';

describe('QuickActionButton component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should render button with action label', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      variant: 'primary',
      icon: '📋',
    };

    render(
      <QuickActionButton
        action={action}
        onExecute={vi.fn()}
      />
    );

    expect(screen.getByText('Open Followup')).toBeTruthy();
  });

  test('should call onExecute when clicked', () => {
    const onExecuteMock = vi.fn();
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      variant: 'primary',
      icon: '📋',
    };

    render(
      <QuickActionButton
        action={action}
        onExecute={onExecuteMock}
      />
    );

    const button = screen.getByText('Open Followup');
    fireEvent.click(button);

    expect(onExecuteMock).toHaveBeenCalled();
  });

  test('should apply variant class', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      variant: 'primary',
      icon: '📋',
    };

    const { container } = render(
      <QuickActionButton
        action={action}
        onExecute={vi.fn()}
      />
    );

    const button = container.querySelector('button');
    expect(button.className).toContain('bg-blue-600');
  });

  test('should show loading spinner when isLoading is true', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      variant: 'primary',
      icon: '📋',
    };

    const { container } = render(
      <QuickActionButton
        action={action}
        onExecute={vi.fn()}
        isLoading={true}
      />
    );

    // Should show loading indicator (spinner animation)
    expect(container.textContent).toContain('⟳');
  });

  test('should disable button when disabled prop is true', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      variant: 'primary',
      icon: '📋',
    };

    render(
      <QuickActionButton
        action={action}
        onExecute={vi.fn()}
        disabled={true}
      />
    );

    const button = screen.getByRole('button');
    expect(button.disabled).toBe(true);
  });

  test('should render icon if provided', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      variant: 'primary',
      icon: '📋',
    };

    const { container } = render(
      <QuickActionButton
        action={action}
        onExecute={vi.fn()}
      />
    );

    expect(container.textContent).toContain('📋');
  });

  test('should handle different action variants', () => {
    const variants = ['primary', 'secondary', 'warning', 'error', 'info'];
    const expectedClassByVariant = {
      primary: 'bg-blue-600',
      secondary: 'bg-gray-200',
      warning: 'bg-yellow-500',
      error: 'bg-red-600',
      info: 'bg-sky-500',
    };

    variants.forEach((variant) => {
      const action = {
        id: `action_${variant}`,
        label: `Action ${variant}`,
        variant,
        icon: '📋',
      };

      const { container } = render(
        <QuickActionButton
          action={action}
          onExecute={vi.fn()}
        />
      );

      const button = container.querySelector('button');
      expect(button.className).toContain(expectedClassByVariant[variant]);
    });
  });
});
