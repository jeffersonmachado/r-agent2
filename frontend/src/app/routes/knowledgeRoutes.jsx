import {
  ChatPage,
  GenerateSystemPage,
  KnowledgeBasePage,
  PlanUsagePage,
  ProductDocsPage,
  QaPage,
  RAGDocumentsPage,
  RpaReplaysPage,
  RpaSeedsPage,
  RpaTestPage,
  WebScrapingPage,
} from '../lazyRoutes';
import { isRoutePath } from './matchers';

export const knowledgeRoutes = [
  { key: 'knowledge-base', matches: ({ currentPath }) => isRoutePath(currentPath, '/knowledge-base'), render: () => <KnowledgeBasePage /> },
  { key: 'product-docs', matches: ({ currentPath }) => isRoutePath(currentPath, '/product-docs'), render: () => <ProductDocsPage /> },
  { key: 'rag-documents', matches: ({ currentPath }) => isRoutePath(currentPath, '/rag-documents'), render: () => <RAGDocumentsPage /> },
  { key: 'web-scraping', matches: ({ currentPath }) => isRoutePath(currentPath, '/web-scraping'), render: () => <WebScrapingPage /> },
  { key: 'rpa-test', matches: ({ currentPath }) => isRoutePath(currentPath, '/rpa-test'), render: () => <RpaTestPage /> },
  { key: 'rpa-replays', matches: ({ currentPath }) => isRoutePath(currentPath, '/rpa-replays'), render: () => <RpaReplaysPage /> },
  { key: 'rpa-seeds', matches: ({ currentPath }) => isRoutePath(currentPath, '/rpa-seeds'), render: () => <RpaSeedsPage /> },
  { key: 'chat', matches: ({ currentPath }) => isRoutePath(currentPath, '/chat'), render: () => <ChatPage /> },
  { key: 'qa', matches: ({ currentPath }) => isRoutePath(currentPath, '/qa'), render: () => <QaPage /> },
  { key: 'generate-system', matches: ({ currentPath }) => isRoutePath(currentPath, '/generate-system'), render: () => <GenerateSystemPage /> },
  { key: 'plan-usage', matches: ({ currentPath }) => isRoutePath(currentPath, '/plan-usage'), render: () => <PlanUsagePage /> },
];
