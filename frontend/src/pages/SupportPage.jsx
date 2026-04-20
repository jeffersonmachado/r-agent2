import React from 'react';
import { SupportPage as SupportPageImpl } from './SupportPage.impl';

// CrudPageBase permanece na implementação principal (SupportPage.impl).
export function SupportPage(props) {
	return <SupportPageImpl {...props} />;
}
