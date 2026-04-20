import React from 'react';
import { RAGDocumentsPage as RAGDocumentsPageImpl } from './RAGDocumentsPage.impl';

// CrudPageBase permanece na implementação principal (RAGDocumentsPage.impl).
export function RAGDocumentsPage(props) {
	return <RAGDocumentsPageImpl {...props} />;
}
