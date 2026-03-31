'use strict';

const DEFAULT_BEAUTY_SERVICES = [
  {
    id: 'svc-beauty-unhas-gel',
    code: 'UNHAS_GEL_PROMO',
    name: 'Unhas em Gel Promocional',
    durationMinutes: 90,
    price: 79.9,
    promotionalPrice: 59.9,
    category: 'nails',
    active: true,
  },
  {
    id: 'svc-beauty-spa-maos',
    code: 'SPA_MAOS',
    name: 'Spa das Maos',
    durationMinutes: 45,
    price: 49.9,
    promotionalPrice: null,
    category: 'nails',
    active: true,
  },
  {
    id: 'svc-beauty-brow-design',
    code: 'DESIGN_SOBRANCELHAS',
    name: 'Design de Sobrancelhas',
    durationMinutes: 30,
    price: 35,
    promotionalPrice: null,
    category: 'brows',
    active: true,
  },
];

function listBeautyServices() {
  return DEFAULT_BEAUTY_SERVICES.map((item) => ({ ...item }));
}

function getBeautyServiceByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  return listBeautyServices().find((item) => String(item.code || '').trim().toUpperCase() === normalized) || null;
}

module.exports = {
  DEFAULT_BEAUTY_SERVICES,
  listBeautyServices,
  getBeautyServiceByCode,
};
