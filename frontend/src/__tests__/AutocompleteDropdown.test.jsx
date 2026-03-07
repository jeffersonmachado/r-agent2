import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutocompleteDropdown } from '../components/AutocompleteDropdown';

describe('AutocompleteDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executa busca com debounce e mostra resultados', async () => {
    const fetchOptions = vi.fn(async () => [{ id: '1', label: 'Maria' }]);
    const onSelect = vi.fn();

    function Harness() {
      const [value, setValue] = React.useState('');
      return (
        <AutocompleteDropdown
          value={value}
          onInputChange={setValue}
          onSelect={onSelect}
          fetchOptions={fetchOptions}
          ariaLabel="Responsável"
        />
      );
    }

    render(
      <Harness />,
    );

    fireEvent.focus(screen.getByLabelText('Responsável'));
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'ma' } });

    await waitFor(() => expect(fetchOptions).toHaveBeenCalledWith('ma'));
    expect(await screen.findByText('Maria')).toBeInTheDocument();
  });

  it('permite seleção por teclado', async () => {
    const fetchOptions = vi.fn(async () => [
      { id: '1', label: 'Maria' },
      { id: '2', label: 'Marcos' },
    ]);
    const onSelect = vi.fn();

    render(
      <AutocompleteDropdown
        value="ma"
        onInputChange={() => {}}
        onSelect={onSelect}
        fetchOptions={fetchOptions}
        ariaLabel="Equipe"
      />,
    );

    const input = screen.getByLabelText('Equipe');
    fireEvent.focus(input);
    await waitFor(() => expect(fetchOptions).toHaveBeenCalled());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
  });
});
