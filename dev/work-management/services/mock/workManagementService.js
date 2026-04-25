import { mockWorkManagementData } from '../../data/mockData.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function loadWorkManagementData() {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(clone(mockWorkManagementData));
    }, 180);
  });
}