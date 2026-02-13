import React from 'react';

function formatPhoneNumber(phone) {
  if (!phone) return '-';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const part1 = digits.slice(4, 9);
    const part2 = digits.slice(9);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }
  if (digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const part1 = digits.slice(2, 7);
    const part2 = digits.slice(7);
    return `(${ddd}) ${part1}-${part2}`;
  }
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2);
    const part1 = digits.slice(2, 6);
    const part2 = digits.slice(6);
    return `(${ddd}) ${part1}-${part2}`;
  }
  return phone;
}

function maskPhone(phone) {
  if (!phone) return '-';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  const last = digits.slice(-4);
  if (digits.startsWith('55') && digits.length >= 12) {
    return `+55 (••) •••••-${last}`;
  }
  return `(**) •••••-${last}`;
}

export function MaskedPhone({ phone, mask = false }) {
  const display = mask ? maskPhone(phone) : formatPhoneNumber(phone);
  return <span>{display}</span>;
}
