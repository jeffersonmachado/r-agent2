import React from 'react';
import { useRouter } from '../hooks/useRouter';

const WorkManagementUnavailable = () => (
  <section className="card">
    <h2>Work Management indisponivel</h2>
    <p>Este modulo nao esta empacotado no build atual.</p>
  </section>
);

const workManagementModulePath = '../../../dev/work-management/App.jsx';

const LazyWorkManagementApp = React.lazy(() =>
  import(/* @vite-ignore */ workManagementModulePath)
    .then((mod) => ({ default: mod.default }))
    .catch(() => ({ default: WorkManagementUnavailable })),
);

export function WorkManagementPage() {
  const { currentPath, navigate } = useRouter();
  return (
    <React.Suspense fallback={<section className="card"><p>Carregando Work Management...</p></section>}>
      <LazyWorkManagementApp currentPath={currentPath} navigate={navigate} />
    </React.Suspense>
  );
}

export default WorkManagementPage;