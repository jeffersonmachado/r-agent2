/** @type {import('tailwindcss').Config} */
// Tailwind CSS 4.x usa principalmente @theme no CSS
// Este arquivo é mantido para compatibilidade e configurações adicionais se necessário
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  // No Tailwind 4.x, a maioria da configuração é feita via CSS usando @theme
  // Veja src/index.css para as definições de tema
}

