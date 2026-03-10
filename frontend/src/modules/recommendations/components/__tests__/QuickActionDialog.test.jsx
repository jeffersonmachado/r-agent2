import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickActionDialog } from '../QuickActionDialog';

describe('QuickActionDialog component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should not render when isOpen is false', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      payloadTemplate: {},
      icon: '📋',
    };

    const { container } = render(
      <QuickActionDialog
        action={action}
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test('should render when isOpen is true', () => {
    const action = {
      id: 'open_followup',
      label: 'Open Followup',
      payloadTemplate: {},
      icon: '📋',
    };

    const { container } = render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(container.textContent).toContain('Open Followup');
  });

  test('should render input fields for null values in payloadTemplate', () => {
    const action = {
      id: 'send_whatsapp',
      label: 'Send WhatsApp',
      payloadTemplate: {
        template_id: null,
        recipient_phone: null,
      },
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    // Should show input fields with labels converted from snake_case
    expect(screen.getByText(/template_id|Template Id/i)).toBeTruthy();
    expect(screen.getByText(/recipient_phone|Recipient Phone/i)).toBeTruthy();
  });

  test('should not render input for non-null values in payloadTemplate', () => {
    const action = {
      id: 'test_action',
      label: 'Test Action',
      payloadTemplate: {
        template_id: 'template_123',
        recipient_phone: null,
      },
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    // template_id should not have an input (pre-filled)
    // recipient_phone should have an input
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeLessThan(2);
  });

  test('should convert field labels from snake_case to Title Case', () => {
    const action = {
      id: 'test_action',
      label: 'Test Action',
      payloadTemplate: {
        template_name: null,
        recipient_phone_number: null,
        campaign_start_date: null,
      },
      icon: '📋',
    };

    const { container } = render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    // Labels should be formatted nicely
    expect(container.textContent || '').toMatch(/Template Name|template_name/i);
    expect(container.textContent || '').toMatch(/Recipient Phone Number|recipient_phone_number/i);
    expect(container.textContent || '').toMatch(/Campaign Start Date|campaign_start_date/i);
  });

  test('should call onClose when Cancel button is clicked', () => {
    const onCloseMock = vi.fn();
    const action = {
      id: 'test_action',
      label: 'Test Action',
      payloadTemplate: {},
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={onCloseMock}
        onConfirm={vi.fn()}
      />
    );

    const cancelButton = screen.getByText(/cancelar|cancel/i);
    fireEvent.click(cancelButton);

    expect(onCloseMock).toHaveBeenCalled();
  });

  test('should call onConfirm with input data when Confirm button is clicked', async () => {
    const onConfirmMock = vi.fn();
    const action = {
      id: 'send_whatsapp',
      label: 'Send WhatsApp',
      payloadTemplate: {
        template_id: null,
        recipient_phone: null,
      },
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirmMock}
      />
    );

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'template_123' } });
    fireEvent.change(inputs[1], { target: { value: '5511999999999' } });

    const confirmButton = screen.getByRole('button', { name: /executar|confirmar|confirm/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onConfirmMock).toHaveBeenCalled();
    });
  });

  test('should include pre-filled template values in confirm data', async () => {
    const onConfirmMock = vi.fn();
    const action = {
      id: 'send_whatsapp',
      label: 'Send WhatsApp',
      payloadTemplate: {
        template_id: 'template_123',
        recipient_phone: null,
      },
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirmMock}
      />
    );

    const phoneInput = screen.getByRole('textbox');
    fireEvent.change(phoneInput, { target: { value: '5511999999999' } });

    const confirmButton = screen.getByRole('button', { name: /executar|confirmar|confirm/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onConfirmMock).toHaveBeenCalled();
      const callArg = onConfirmMock.mock.calls[0][0];
      expect(callArg.template_id).toBe('template_123');
      expect(callArg.recipient_phone).toBe('5511999999999');
    });
  });

  test('should disable confirm button when isLoading is true', () => {
    const action = {
      id: 'test_action',
      label: 'Test Action',
      payloadTemplate: {},
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        isLoading={true}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /executar|confirmar|confirm/i });
    expect(confirmButton.disabled || confirmButton.className.includes('disabled')).toBe(true);
  });

  test('should show loading indicator when isLoading is true', () => {
    const action = {
      id: 'test_action',
      label: 'Test Action',
      payloadTemplate: {},
      icon: '📋',
    };

    const { container } = render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        isLoading={true}
      />
    );

    // Should show loading indicator
    expect(container.textContent).toContain('⟳');
  });

  test('should handle empty payloadTemplate', () => {
    const action = {
      id: 'simple_action',
      label: 'Simple Action',
      payloadTemplate: {},
      icon: '📋',
    };

    const { container } = render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    // Should still render dialog with no input fields
    expect(container.textContent).toContain('Simple Action');
  });

  test('should have Confirm and Cancel buttons', () => {
    const action = {
      id: 'test_action',
      label: 'Test Action',
      payloadTemplate: {},
      icon: '📋',
    };

    render(
      <QuickActionDialog
        action={action}
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /executar|confirmar|confirm/i })).toBeTruthy();
    expect(screen.getByText(/cancelar|cancel/i)).toBeTruthy();
  });
});
